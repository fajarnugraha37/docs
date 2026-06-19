# learn-postgresql-mastery-for-java-engineers-part-024.md

# Part 024 — Extensions: pg_stat_statements, pg_trgm, btree_gin, uuid, PostGIS, dan Ekosistem

## Status Seri

- Nama seri: `learn-postgresql-mastery-for-java-engineers`
- Part: `024 dari 034`
- Status seri: **belum selesai**
- Fokus part ini: memahami PostgreSQL extension system sebagai mekanisme ekspansi capability database, sekaligus memahami risiko operasional, security, upgrade, dan governance ketika extension dipakai di production.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan apa itu extension di PostgreSQL dan kenapa extension bukan sekadar “plugin tambahan”.
2. Membedakan extension yang bersifat:
   - observability,
   - indexing/search,
   - data type,
   - cryptographic/UUID,
   - geospatial,
   - audit/security,
   - performance/diagnostic.
3. Menentukan kapan extension layak dipakai di sistem produksi.
4. Memahami risiko extension terhadap:
   - deployment,
   - migration,
   - managed database compatibility,
   - upgrade,
   - privilege model,
   - backup/restore,
   - vendor portability.
5. Menggunakan extension penting seperti:
   - `pg_stat_statements`,
   - `pg_trgm`,
   - `citext`,
   - `btree_gin`,
   - `btree_gist`,
   - `uuid-ossp`,
   - `pgcrypto`,
   - `hstore`,
   - PostGIS secara konseptual.
6. Mendesain governance extension untuk organisasi engineering.
7. Menghindari anti-pattern: memasang extension karena populer, bukan karena access pattern dan invariant membutuhkannya.

---

## 1. Mental Model: Extension adalah Perubahan Capability Database

PostgreSQL memiliki sistem extension untuk mengemas object database sebagai satu unit yang bisa diinstal, di-upgrade, dan dihapus. Object ini bisa berupa:

- function,
- operator,
- data type,
- index operator class,
- aggregate,
- view,
- schema object,
- background worker,
- hook ke planner/executor,
- shared library native.

Jadi extension bukan hanya “library SQL”. Beberapa extension benar-benar mengubah cara database bekerja atau menambah kemampuan internal.

Mental model paling penting:

```text
Extension = perubahan surface area dan behavior database
```

Artinya, ketika kamu menambahkan extension, kamu sedang menambah:

```text
API baru di database
  + object baru
  + dependency baru
  + upgrade concern baru
  + security concern baru
  + portability concern baru
```

Untuk engineer Java, analoginya bukan seperti menambahkan dependency kecil di kode aplikasi. Extension lebih mirip:

```text
Menambahkan module native ke runtime database yang menjadi bagian dari contract sistem.
```

Kalau aplikasi Java memakai function dari extension dalam query, index, constraint, generated column, trigger, atau migration, maka extension itu menjadi dependency schema.

---

## 2. Kenapa PostgreSQL Extension Penting?

PostgreSQL terkenal bukan hanya karena SQL engine-nya, tetapi karena ia adalah platform database yang extensible.

Tanpa extension, PostgreSQL tetap kuat. Dengan extension yang tepat, PostgreSQL bisa memperluas cakupan ke:

- query observability,
- fuzzy search,
- trigram similarity,
- case-insensitive text,
- geospatial computation,
- cryptographic functions,
- UUID generation,
- advanced indexing,
- audit logging,
- time-series,
- vector search,
- graph-like traversal,
- custom data type.

Namun extension harus diperlakukan sebagai keputusan arsitektural.

Pertanyaan yang harus ditanyakan:

```text
Apakah extension ini menyelesaikan masalah inti dengan lebih sederhana,
lebih benar, lebih cepat, atau lebih operable dibanding solusi alternatif?
```

Bukan:

```text
Apakah extension ini keren?
```

---

## 3. Core Commands untuk Extension

### 3.1 Melihat extension yang tersedia

```sql
SELECT *
FROM pg_available_extensions
ORDER BY name;
```

Contoh output konseptual:

```text
name                | default_version | installed_version | comment
--------------------+-----------------+-------------------+-----------------------------
pg_stat_statements  | 1.x             | 1.x               | track planning/execution stats
pg_trgm             | 1.x             | null              | trigram matching
citext              | 1.x             | null              | case-insensitive text type
uuid-ossp           | 1.x             | null              | UUID generation functions
```

### 3.2 Melihat extension yang sudah terpasang

```sql
SELECT *
FROM pg_extension
ORDER BY extname;
```

### 3.3 Mengaktifkan extension

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

### 3.4 Mengaktifkan extension di schema tertentu

```sql
CREATE SCHEMA IF NOT EXISTS ext;

CREATE EXTENSION IF NOT EXISTS pg_trgm
WITH SCHEMA ext;
```

Namun tidak semua extension aman atau cocok dipasang di schema non-default. Banyak tim memilih schema khusus seperti `extensions` atau `ext` untuk memisahkan object extension dari schema domain.

### 3.5 Upgrade extension

```sql
ALTER EXTENSION pg_trgm UPDATE;
```

Atau ke versi tertentu:

```sql
ALTER EXTENSION pg_trgm UPDATE TO '1.6';
```

### 3.6 Menghapus extension

```sql
DROP EXTENSION pg_trgm;
```

Jika object lain bergantung pada extension, command ini akan gagal kecuali memakai `CASCADE`.

```sql
DROP EXTENSION pg_trgm CASCADE;
```

`CASCADE` berbahaya karena bisa menghapus object dependent seperti index, function, constraint, atau view.

Production rule:

```text
Jangan pernah DROP EXTENSION CASCADE tanpa dependency review.
```

---

## 4. Extension sebagai Dependency Schema

Begitu schema memakai object dari extension, extension menjadi bagian dari kontrak database.

Contoh:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_customer_name_trgm
ON customer
USING gin (name gin_trgm_ops);
```

Sekarang index tersebut bergantung pada `pg_trgm`.

Contoh lain:

```sql
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE account (
    id uuid PRIMARY KEY,
    email citext NOT NULL UNIQUE
);
```

Sekarang tipe kolom `email` bergantung pada `citext`.

Contoh lain:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE booking (
    room_id uuid NOT NULL,
    period tstzrange NOT NULL,
    EXCLUDE USING gist (
        room_id WITH =,
        period WITH &&
    )
);
```

Sekarang constraint bergantung pada `btree_gist`.

Implikasinya:

1. Migration environment harus punya extension.
2. Test database harus punya extension.
3. CI database harus punya extension.
4. Local developer database harus punya extension.
5. Restore ke environment lain harus bisa install extension.
6. Cloud provider harus mendukung extension itu.
7. Major upgrade harus memvalidasi compatibility extension.

---

## 5. Kategori Extension yang Umum Dipakai

Kita bisa kelompokkan extension PostgreSQL menjadi beberapa kategori.

### 5.1 Observability dan diagnostics

Contoh:

- `pg_stat_statements`
- `auto_explain` (module, bukan selalu extension biasa)
- `pgstattuple`
- `pageinspect`

Tujuan:

- melihat query paling mahal,
- melihat planning/execution statistics,
- menganalisis bloat,
- menginspeksi page/index secara internal.

### 5.2 Search dan text matching

Contoh:

- `pg_trgm`
- `unaccent`
- full-text search bawaan core PostgreSQL

Tujuan:

- fuzzy search,
- autocomplete sederhana,
- similarity search,
- typo-tolerant lookup,
- case/accent normalization.

### 5.3 Data type

Contoh:

- `citext`
- `hstore`
- PostGIS types

Tujuan:

- tipe data khusus,
- operator khusus,
- indexing khusus.

### 5.4 Index operator support

Contoh:

- `btree_gin`
- `btree_gist`

Tujuan:

- memungkinkan operator B-tree-like dipakai di GIN/GiST,
- mendukung composite indexing untuk access method tertentu,
- mendukung exclusion constraint tertentu.

### 5.5 UUID dan cryptographic functions

Contoh:

- `uuid-ossp`
- `pgcrypto`

Tujuan:

- UUID generation,
- random bytes,
- hashing,
- cryptographic helper.

Catatan: PostgreSQL modern juga memiliki fungsi UUID bawaan tertentu, sehingga kebutuhan `uuid-ossp` harus dievaluasi ulang, bukan diasumsikan selalu perlu.

### 5.6 Geospatial

Contoh:

- PostGIS

Tujuan:

- geometry/geography types,
- spatial index,
- distance query,
- containment,
- intersection,
- GIS analytics.

### 5.7 Audit/security

Contoh:

- `pgaudit` di beberapa deployment,
- extension audit lain tergantung distribusi/provider.

Tujuan:

- audit SQL statement,
- compliance logging,
- security observability.

### 5.8 Domain-specific heavy extensions

Contoh:

- TimescaleDB untuk time-series,
- pgvector untuk vector similarity search,
- Citus untuk distributed PostgreSQL.

Ini sangat kuat, tetapi juga lebih besar implikasinya. Mereka bukan sekadar helper kecil; mereka bisa memengaruhi arsitektur keseluruhan.

---

## 6. pg_stat_statements: Extension Observability Paling Penting

`pg_stat_statements` hampir selalu menjadi extension pertama yang harus dipertimbangkan untuk PostgreSQL production.

Fungsinya: mengumpulkan statistik planning dan execution dari statement SQL yang berjalan di server.

Ia menjawab pertanyaan seperti:

```text
Query mana yang paling banyak total waktunya?
Query mana yang paling sering dieksekusi?
Query mana yang rata-rata lambat?
Query mana yang membaca paling banyak block?
Query mana yang paling banyak menulis WAL?
Query mana yang punya planning time tinggi?
```

Tanpa `pg_stat_statements`, diagnosis query sering hanya bergantung pada log lambat. Log lambat berguna, tetapi tidak cukup untuk melihat aggregate workload.

---

## 7. Mengaktifkan pg_stat_statements

`pg_stat_statements` biasanya membutuhkan preload library.

Di `postgresql.conf`:

```conf
shared_preload_libraries = 'pg_stat_statements'
```

Lalu restart PostgreSQL.

Kemudian:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

Kenapa perlu restart?

Karena extension ini membutuhkan shared memory dan hook sejak server start.

Di managed PostgreSQL, caranya berbeda tergantung provider:

- RDS memakai parameter group,
- Cloud SQL memakai database flags/extension support,
- Azure memakai server parameter,
- beberapa serverless provider membatasi extension tertentu.

Production implication:

```text
Tidak semua extension bisa diaktifkan hanya dengan CREATE EXTENSION.
```

Beberapa butuh:

- shared preload,
- superuser-like privilege,
- restart,
- provider-specific approval.

---

## 8. Query Dasar pg_stat_statements

### 8.1 Top query by total execution time

```sql
SELECT
    queryid,
    calls,
    total_exec_time,
    mean_exec_time,
    rows,
    query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

Interpretasi:

- `total_exec_time` tinggi berarti query menghabiskan banyak waktu secara agregat.
- Bisa karena sering dipanggil, bukan karena satu eksekusi lambat.

### 8.2 Top query by mean time

```sql
SELECT
    calls,
    mean_exec_time,
    max_exec_time,
    rows,
    query
FROM pg_stat_statements
WHERE calls > 10
ORDER BY mean_exec_time DESC
LIMIT 20;
```

Interpretasi:

- Query dengan mean tinggi bisa menjadi kandidat tuning.
- Namun mean bisa bias oleh outlier.

### 8.3 Top query by calls

```sql
SELECT
    calls,
    total_exec_time,
    mean_exec_time,
    query
FROM pg_stat_statements
ORDER BY calls DESC
LIMIT 20;
```

Query sangat sering dipanggil walau murah tetap bisa membebani database.

Contoh:

```text
SELECT current_user;
SELECT now();
SELECT setting FROM app_config WHERE key = $1;
```

Mungkin query murah, tapi bila dieksekusi jutaan kali per jam, caching atau batching bisa lebih berdampak daripada index tuning.

### 8.4 Top query by shared block reads

```sql
SELECT
    calls,
    shared_blks_read,
    shared_blks_hit,
    total_exec_time,
    query
FROM pg_stat_statements
ORDER BY shared_blks_read DESC
LIMIT 20;
```

Ini membantu menemukan query IO-heavy.

### 8.5 Top query by temp block usage

```sql
SELECT
    calls,
    temp_blks_read,
    temp_blks_written,
    mean_exec_time,
    query
FROM pg_stat_statements
ORDER BY temp_blks_written DESC
LIMIT 20;
```

Ini membantu menemukan sort/hash spill ke disk.

---

## 9. pg_stat_statements dan Normalized Query

`pg_stat_statements` menormalisasi literal menjadi placeholder.

Contoh beberapa query:

```sql
SELECT * FROM customer WHERE id = 'a';
SELECT * FROM customer WHERE id = 'b';
SELECT * FROM customer WHERE id = 'c';
```

Akan dikelompokkan seperti:

```sql
SELECT * FROM customer WHERE id = $1;
```

Ini sangat berguna untuk aggregate statistics.

Namun ada konsekuensi:

```text
pg_stat_statements menunjukkan query shape, bukan semua nilai parameter aktual.
```

Untuk parameter-sensitive query, kamu tetap butuh:

- `EXPLAIN (ANALYZE, BUFFERS)` dengan parameter representatif,
- slow query log,
- application trace,
- sample query payload,
- domain knowledge tentang skew.

---

## 10. pg_stat_statements dan Java Applications

Dalam aplikasi Java, `pg_stat_statements` sangat berguna karena ORM/JDBC sering menghasilkan query yang tidak terlihat jelas dari kode bisnis.

Contoh masalah:

1. Hibernate menghasilkan N+1 query.
2. Repository method terlihat kecil tapi memanggil query ribuan kali.
3. Pagination memakai `OFFSET` besar.
4. Lazy loading membaca table besar tanpa index cocok.
5. Batch insert tidak benar-benar batch.
6. Query generated oleh Criteria API terlalu kompleks.
7. Service health check terlalu sering query database.

Dengan `pg_stat_statements`, kamu bisa menemukan:

```text
Query shape yang paling mahal secara sistemik.
```

Bukan hanya query yang kebetulan muncul di log.

---

## 11. Keterbatasan pg_stat_statements

`pg_stat_statements` bukan silver bullet.

Keterbatasan:

1. Tidak menyimpan semua parameter literal.
2. Tidak menunjukkan full execution plan.
3. Statistik bisa reset.
4. Query text panjang bisa terpotong tergantung konfigurasi.
5. Tidak otomatis menjelaskan kenapa query lambat.
6. Query dengan plan berbeda bisa tergabung dalam satu queryid.
7. Perbedaan tenant/data skew tidak selalu terlihat.
8. Tidak menggantikan tracing aplikasi.

Gunakan bersama:

- `EXPLAIN (ANALYZE, BUFFERS)`
- logs,
- `pg_stat_activity`,
- `pg_locks`,
- APM tracing,
- application metrics,
- pool metrics.

---

## 12. pg_trgm: Trigram Search dan Similarity

`pg_trgm` menyediakan fungsi dan operator untuk trigram matching.

Trigram adalah potongan tiga karakter dari string.

Contoh konseptual:

```text
"postgres"
→ "pos", "ost", "stg", "tgr", "gre", "res"
```

Dengan trigram, PostgreSQL bisa melakukan:

- similarity search,
- fuzzy search,
- typo-tolerant lookup,
- `LIKE '%pattern%'` yang bisa di-index,
- `ILIKE '%pattern%'` dengan index yang sesuai.

Aktivasi:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

---

## 13. pg_trgm untuk LIKE/ILIKE

Tanpa trigram index:

```sql
SELECT *
FROM customer
WHERE name ILIKE '%john%';
```

Query ini biasanya sulit memakai B-tree karena wildcard di depan (`%john`).

Dengan `pg_trgm`:

```sql
CREATE INDEX idx_customer_name_trgm
ON customer
USING gin (name gin_trgm_ops);
```

Query:

```sql
SELECT *
FROM customer
WHERE name ILIKE '%john%';
```

bisa memanfaatkan GIN trigram index.

Mental model:

```text
B-tree cocok untuk prefix/range terurut.
Trigram cocok untuk substring/fuzzy matching.
```

---

## 14. pg_trgm untuk Similarity Search

Contoh:

```sql
SELECT
    id,
    name,
    similarity(name, 'jon smit') AS score
FROM customer
WHERE name % 'jon smit'
ORDER BY score DESC
LIMIT 20;
```

Operator `%` berarti cukup mirip berdasarkan threshold similarity.

Threshold bisa diatur:

```sql
SELECT set_limit(0.35);
```

Atau dengan parameter modern:

```sql
SET pg_trgm.similarity_threshold = 0.35;
```

Use case:

- mencari nama orang,
- mencari nama perusahaan,
- fuzzy lookup alamat,
- dedup kandidat customer,
- search case title,
- search nomor referensi yang tidak persis.

---

## 15. Kapan pg_trgm Cocok?

Cocok ketika:

1. Search berbasis substring.
2. Query memakai `LIKE '%...%'` atau `ILIKE '%...%'`.
3. Butuh fuzzy matching sederhana.
4. Dataset tidak sebesar search engine dedicated.
5. Search harus transactional dengan data OLTP.
6. Ranking sederhana cukup.
7. Structured filter tetap dominan.

Contoh:

```sql
SELECT id, name
FROM regulated_entity
WHERE jurisdiction = 'ID-JK'
  AND status = 'ACTIVE'
  AND name ILIKE '%mineral%'
ORDER BY name
LIMIT 50;
```

Kalau search selalu dibatasi structured filter kuat, PostgreSQL + `pg_trgm` sering cukup.

---

## 16. Kapan pg_trgm Tidak Cukup?

Tidak cocok jika kamu butuh:

1. Relevance ranking kompleks.
2. Multi-language stemming berat.
3. Synonym dictionary besar.
4. Faceting besar.
5. Search analytics.
6. Highlighting kompleks lintas field.
7. Distributed search skala besar.
8. Near-real-time indexing dengan ingest sangat besar.
9. Custom scoring seperti search engine.

Saat itu pertimbangkan:

- Elasticsearch,
- OpenSearch,
- Solr,
- dedicated search platform.

Tapi jangan buru-buru memindahkan semua search ke search engine. Search engine membawa consistency problem, indexing lag, operational overhead, dan duplicate data model.

---

## 17. citext: Case-insensitive Text Type

`citext` menyediakan tipe text case-insensitive.

Aktivasi:

```sql
CREATE EXTENSION IF NOT EXISTS citext;
```

Contoh:

```sql
CREATE TABLE app_user (
    id uuid PRIMARY KEY,
    email citext NOT NULL UNIQUE
);
```

Dengan `citext`, nilai berikut dianggap sama untuk comparison:

```text
Admin@Example.com
admin@example.com
ADMIN@example.com
```

Use case umum:

- email login,
- username case-insensitive,
- external identifier yang tidak case-sensitive.

---

## 18. citext vs lower(email) Expression Index

Alternatif tanpa `citext`:

```sql
CREATE UNIQUE INDEX uq_user_email_lower
ON app_user (lower(email));
```

Dan query:

```sql
SELECT *
FROM app_user
WHERE lower(email) = lower(?);
```

Perbandingan:

| Pendekatan | Kelebihan | Kekurangan |
|---|---|---|
| `citext` | Model eksplisit: kolom memang case-insensitive | Extension dependency, behavior type-specific |
| `lower()` index | Tidak perlu tipe khusus | Semua query harus konsisten memakai `lower()` |

Decision rule:

```text
Jika case-insensitive adalah invariant kolom, citext layak dipertimbangkan.
Jika hanya access pattern tertentu yang case-insensitive, expression index lebih fleksibel.
```

---

## 19. btree_gin

`btree_gin` menyediakan GIN operator classes untuk tipe data yang biasanya memakai B-tree semantics.

Aktivasi:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gin;
```

Kenapa ini berguna?

GIN biasanya kuat untuk data multi-value seperti:

- array,
- JSONB,
- full-text.

Namun kadang kamu ingin membuat index GIN composite yang menggabungkan:

- kolom scalar biasa,
- kolom array/JSONB/text-search.

Contoh konseptual:

```sql
CREATE INDEX idx_case_tags_tenant_gin
ON enforcement_case
USING gin (tenant_id, tags);
```

Tanpa operator class yang cocok, PostgreSQL mungkin tidak tahu cara mengindeks scalar tertentu dalam GIN.

Namun jangan langsung menganggap composite GIN selalu lebih baik.

Sering kali lebih baik memakai:

```sql
CREATE INDEX idx_case_tenant_status
ON enforcement_case (tenant_id, status);

CREATE INDEX idx_case_tags_gin
ON enforcement_case
USING gin (tags);
```

Planner bisa menggunakan bitmap combination bila cocok.

---

## 20. btree_gist

`btree_gist` menyediakan GiST operator classes untuk tipe yang biasanya memakai B-tree comparison.

Aktivasi:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

Use case paling penting: exclusion constraint yang menggabungkan equality scalar dengan range overlap.

Contoh booking:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE room_booking (
    id uuid PRIMARY KEY,
    room_id uuid NOT NULL,
    period tstzrange NOT NULL,
    EXCLUDE USING gist (
        room_id WITH =,
        period WITH &&
    )
);
```

Invariant:

```text
Untuk room yang sama, period booking tidak boleh overlap.
```

Ini sangat kuat karena race condition dicegah database, bukan hanya service Java.

Use case lain:

- resource allocation,
- assignment window,
- license validity,
- enforcement restriction period,
- officer scheduling,
- permit validity range.

---

## 21. uuid-ossp, pgcrypto, dan UUID Modern

Historically, banyak schema PostgreSQL memakai:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE event (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4()
);
```

Atau:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
```

Pada PostgreSQL modern, beberapa fungsi UUID sudah tersedia secara native. PostgreSQL 18 juga memperkenalkan `uuidv7()` sebagai UUID timestamp-ordered.

Decision rule:

```text
Jangan otomatis memakai uuid-ossp hanya karena tutorial lama.
Cek fungsi UUID native dan kebutuhan ordering/index locality.
```

---

## 22. UUID v4 vs UUID v7 untuk Primary Key

UUID v4:

- random,
- bagus untuk decentralization,
- buruk untuk locality B-tree karena insert tersebar.

UUID v7:

- timestamp-ordered,
- lebih baik untuk locality index,
- tetap memiliki randomness component,
- lebih ramah untuk insert-heavy table.

Trade-off:

| Jenis ID | Kelebihan | Risiko |
|---|---|---|
| Bigserial/identity | locality bagus, kecil | mudah ditebak, coordination DB-centric |
| UUID v4 | mudah generate distributed, tidak mudah ditebak | index fragmentation/random insert |
| UUID v7 | distributed + lebih ordered | timestamp leakage, butuh versi DB/tooling mendukung |

Untuk Java system modern, UUID v7 menarik untuk:

- event table,
- outbox,
- audit log,
- distributed write,
- table besar dengan primary key UUID.

Namun pastikan:

- driver/app type mapping aman,
- migration tooling support,
- database version support,
- observability tidak salah interpretasi.

---

## 23. pgcrypto

`pgcrypto` menyediakan cryptographic functions.

Aktivasi:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

Use case:

- random bytes,
- digest/hash,
- HMAC,
- password hashing helper,
- PGP encryption functions.

Contoh hashing:

```sql
SELECT digest('hello', 'sha256');
```

Contoh random UUID historis:

```sql
SELECT gen_random_uuid();
```

Namun hati-hati:

```text
Database cryptography bukan pengganti secret management yang benar.
```

Jangan menyimpan secret lalu merasa aman hanya karena memakai function crypto di database.

Pertanyaan penting:

1. Key disimpan di mana?
2. Siapa bisa membaca data sebelum/sesudah decrypt?
3. Apakah backup terenkripsi?
4. Apakah log bisa bocor?
5. Apakah aplikasi perlu query berdasarkan encrypted field?
6. Apakah encryption dilakukan app-side atau DB-side?

---

## 24. hstore

`hstore` adalah key-value type lama PostgreSQL.

Aktivasi:

```sql
CREATE EXTENSION IF NOT EXISTS hstore;
```

Contoh:

```sql
CREATE TABLE object_metadata (
    id uuid PRIMARY KEY,
    attributes hstore NOT NULL
);
```

Namun sejak JSONB matang, banyak use case `hstore` digantikan JSONB.

Kapan `hstore` masih relevan?

- key-value flat sederhana,
- legacy schema,
- extension-dependent ecosystem lama,
- operator hstore tertentu yang sudah digunakan.

Untuk desain baru, biasanya JSONB lebih fleksibel.

---

## 25. unaccent

`unaccent` membantu menghapus aksen/diacritics.

Aktivasi:

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;
```

Contoh:

```sql
SELECT unaccent('José');
-- Jose
```

Use case:

- search nama orang,
- search tempat,
- search company name,
- normalization untuk full-text search.

Contoh expression index:

```sql
CREATE INDEX idx_person_name_unaccent_lower
ON person (lower(unaccent(name)));
```

Namun ada caveat penting: tidak semua function aman langsung dipakai di expression index tergantung volatility dan definisinya. Untuk production, validasi dengan dokumentasi dan test `CREATE INDEX`.

Sering kali pattern yang lebih eksplisit:

```sql
ALTER TABLE person
ADD COLUMN name_search text GENERATED ALWAYS AS (lower(name)) STORED;
```

Lalu proses unaccent bisa dilakukan di aplikasi atau function immutable wrapper yang dikendalikan dengan hati-hati.

---

## 26. PostGIS: Ketika PostgreSQL Menjadi Spatial Database

PostGIS adalah extension besar yang menambahkan kemampuan geospatial ke PostgreSQL.

Ia menyediakan:

- geometry type,
- geography type,
- spatial functions,
- spatial index,
- coordinate system support,
- distance calculation,
- containment/intersection,
- GIS operations.

Contoh konseptual:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE facility (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    location geography(Point, 4326) NOT NULL
);

CREATE INDEX idx_facility_location
ON facility
USING gist (location);
```

Query:

```sql
SELECT id, name
FROM facility
WHERE ST_DWithin(
    location,
    ST_MakePoint(106.8456, -6.2088)::geography,
    5000
);
```

Artinya: cari facility dalam radius 5 km dari titik tertentu.

---

## 27. Kapan PostGIS Layak Dipakai?

Cocok ketika domain memiliki spatial invariant atau query seperti:

1. Lokasi fasilitas terdekat.
2. Area coverage.
3. Apakah titik berada dalam polygon yurisdiksi.
4. Distance calculation.
5. Route/proximity rule.
6. Regional enforcement boundary.
7. Permit berdasarkan wilayah.
8. Inspection assignment berdasarkan lokasi.

Jika geospatial hanya sekadar menyimpan lat/lon dan query jarang, dua kolom numeric mungkin cukup.

Decision rule:

```text
Jika spatial operation adalah bagian dari query/invariant, gunakan PostGIS.
Jika hanya display map sederhana, jangan buru-buru menambah PostGIS.
```

---

## 28. Extension untuk Audit: pgaudit dan Alternatif

Audit di PostgreSQL bisa dilakukan beberapa cara:

1. Application-level audit table.
2. Trigger-based audit table.
3. Logical decoding/change capture.
4. Log-based auditing.
5. Extension seperti `pgaudit` jika tersedia.

`pgaudit` tidak selalu tersedia di semua managed PostgreSQL. Bahkan saat tersedia, konfigurasinya bisa provider-specific.

Audit design harus menjawab:

```text
Apa yang diaudit?
Siapa actor-nya?
Apakah actor berasal dari DB user atau application user?
Apakah query SELECT juga perlu diaudit?
Apakah audit harus tamper-evident?
Apakah audit harus queryable?
Berapa retention-nya?
Apakah audit log ikut backup?
```

Untuk Java application, sering kali database hanya tahu satu user:

```text
app_user
```

Jadi audit berbasis DB role saja tidak cukup untuk mengetahui end-user. Kamu perlu membawa application actor ke audit mechanism, misalnya:

- explicit column `created_by`, `updated_by`,
- session variable lokal transaksi,
- audit trigger membaca setting custom,
- application audit event.

Contoh session setting:

```sql
SELECT set_config('app.actor_id', 'user-123', true);
```

Trigger bisa membaca:

```sql
current_setting('app.actor_id', true)
```

Tetapi ini harus dipakai disiplin di transaction boundary.

---

## 29. Extension dan Managed PostgreSQL

Di self-managed PostgreSQL, kamu bisa menginstal package OS dan mengaktifkan banyak extension.

Di managed PostgreSQL, extension dibatasi oleh provider.

Contoh provider:

- Amazon RDS/Aurora PostgreSQL,
- Google Cloud SQL,
- Azure Database for PostgreSQL,
- Supabase,
- Neon,
- Crunchy Bridge,
- DigitalOcean Managed PostgreSQL,
- EDB Postgres AI/Cloud,
- vendor serverless PostgreSQL lain.

Risiko:

1. Extension tersedia di provider A tapi tidak di provider B.
2. Versi extension berbeda antar provider.
3. Extension butuh `shared_preload_libraries` tetapi akses terbatas.
4. Extension butuh superuser, tetapi managed DB tidak memberi superuser penuh.
5. Extension upgrade mengikuti jadwal provider.
6. Restore ke local/test environment gagal karena extension tidak tersedia.

Architecture implication:

```text
Extension mengurangi portability jika tidak dikelola sebagai dependency eksplisit.
```

Bukan berarti jangan memakai extension. Artinya dependency harus sadar dan terdokumentasi.

---

## 30. Extension Governance

Untuk tim engineering serius, buat policy sederhana.

### 30.1 Extension proposal

Setiap extension baru harus punya proposal:

```text
Nama extension:
Problem yang diselesaikan:
Alternatif tanpa extension:
Object schema yang bergantung:
Provider support:
Local/dev/CI support:
Security review:
Operational review:
Upgrade concern:
Rollback strategy:
Owner:
```

### 30.2 Extension allowlist

Contoh allowlist organisasi:

```text
Allowed by default:
- pg_stat_statements
- pg_trgm
- citext
- btree_gist
- btree_gin
- pgcrypto

Allowed with review:
- postgis
- pgaudit
- pg_partman
- pgvector
- timescaledb

Not allowed without architecture approval:
- extensions requiring background workers
- extensions changing storage/distribution semantics
- experimental third-party C extensions
```

### 30.3 Migration ownership

Extension creation sebaiknya berada di migration awal atau baseline migration.

Contoh Flyway:

```sql
-- V001__enable_required_extensions.sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

Namun `pg_stat_statements` juga butuh server config, jadi migration saja tidak cukup.

---

## 31. Extension dalam Flyway/Liquibase

Problem umum:

```text
Migration sukses di local, gagal di CI/prod karena extension tidak tersedia.
```

Best practice:

1. Pisahkan migration extension dari migration domain.
2. Dokumentasikan prerequisite infrastructure.
3. Jalankan compatibility check saat bootstrap.
4. Jangan membuat extension diam-diam tanpa governance.
5. Untuk managed DB, pastikan extension sudah masuk allowlist provider.
6. Pastikan user migration punya privilege yang cukup.

Contoh migration defensif:

```sql
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_available_extensions
        WHERE name = 'pg_trgm'
    ) THEN
        RAISE EXCEPTION 'Required extension pg_trgm is not available';
    END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Ini memberi error eksplisit lebih awal.

---

## 32. Security Model Extension

Beberapa extension hanya membuat SQL object biasa. Beberapa extension memasang native code atau membutuhkan privilege tinggi.

Pertanyaan security:

1. Siapa boleh `CREATE EXTENSION`?
2. Apakah extension trusted?
3. Apakah extension membuat function `SECURITY DEFINER`?
4. Apakah extension bisa membaca file server?
5. Apakah extension bisa membuka network?
6. Apakah extension menjalankan C code?
7. Apakah extension punya CVE history?
8. Apakah extension di-maintain?
9. Apakah extension tersedia dari repository resmi/distribusi terpercaya?

Production rule:

```text
CREATE EXTENSION adalah privileged operation, bukan aktivitas aplikasi runtime.
```

Aplikasi Java sebaiknya tidak punya permission untuk membuat extension.

---

## 33. Extension dan Backup/Restore

Logical dump biasanya menyimpan statement seperti:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
```

Saat restore, target environment harus punya extension tersedia.

Failure mode:

```text
Backup valid, tetapi restore gagal karena extension tidak tersedia di target.
```

Ini sering terlupakan.

Restore drill harus mencakup:

1. Install extension packages.
2. Enable extension prerequisites.
3. Validate extension version.
4. Restore schema.
5. Restore data.
6. Run application compatibility tests.

Untuk physical backup, extension binary compatibility juga penting pada host target.

---

## 34. Extension dan Major Upgrade

Saat PostgreSQL major upgrade, extension harus diperiksa.

Checklist:

```sql
SELECT
    extname,
    extversion
FROM pg_extension
ORDER BY extname;
```

Lalu cek apakah extension punya update tersedia:

```sql
SELECT
    name,
    default_version,
    installed_version
FROM pg_available_extensions
WHERE installed_version IS NOT NULL
ORDER BY name;
```

Setelah upgrade PostgreSQL, mungkin perlu:

```sql
ALTER EXTENSION extension_name UPDATE;
```

Namun jangan dilakukan membabi buta tanpa membaca release notes extension.

Risiko:

1. Function behavior berubah.
2. Operator class berubah.
3. Index perlu rebuild.
4. Extension belum support major version baru.
5. Managed provider belum menyediakan versi baru.
6. Query plan berubah karena operator selectivity berubah.

---

## 35. Extension dan Index Rebuild

Beberapa extension menyediakan operator class untuk index.

Contoh:

```sql
CREATE INDEX idx_doc_body_trgm
ON document
USING gin (body gin_trgm_ops);
```

Jika extension/operator class berubah antar versi, mungkin perlu:

```sql
REINDEX INDEX CONCURRENTLY idx_doc_body_trgm;
```

Atau rebuild index tertentu.

Ini harus diuji pada staging dengan data realistis.

---

## 36. Extension dan Vendor Lock-in

PostgreSQL extension bisa menciptakan lock-in pada:

1. PostgreSQL itu sendiri dibanding database lain.
2. Specific PostgreSQL provider.
3. Specific PostgreSQL distribution.
4. Specific extension version.
5. Specific schema implementation.

Contoh:

- `citext` membuat schema tidak portable ke MySQL tanpa perubahan.
- PostGIS membuat domain sangat bergantung pada spatial PostgreSQL capability.
- `pg_trgm` membuat search behavior PostgreSQL-specific.
- TimescaleDB membuat time-series design bergantung pada extension.

Ini bukan selalu buruk.

Architecture rule:

```text
Lock-in yang sadar dan bernilai boleh.
Lock-in yang tidak disadari berbahaya.
```

Jika extension mengurangi kompleksitas aplikasi secara besar, meningkatkan correctness, dan mempercepat delivery, lock-in bisa masuk akal.

---

## 37. Extension Decision Framework

Sebelum memakai extension, jawab 10 pertanyaan ini.

### 37.1 Problem fit

```text
Masalah apa yang diselesaikan extension ini?
Apakah masalah itu nyata, sering, dan penting?
```

### 37.2 Alternative

```text
Apa alternatif tanpa extension?
Apakah alternatif itu lebih sederhana?
```

### 37.3 Correctness

```text
Apakah extension membantu menjaga invariant?
Atau hanya mempercantik query?
```

### 37.4 Performance

```text
Apakah extension memperbaiki access pattern utama?
Apakah ada benchmark dengan data realistis?
```

### 37.5 Operability

```text
Bagaimana extension dimonitor?
Bagaimana failure-nya terlihat?
```

### 37.6 Security

```text
Privilege apa yang dibutuhkan?
Apakah extension trusted?
```

### 37.7 Portability

```text
Apakah semua environment mendukung extension ini?
```

### 37.8 Upgrade

```text
Bagaimana extension di-upgrade?
Apakah upgrade PostgreSQL bergantung pada extension ini?
```

### 37.9 Rollback

```text
Jika extension harus dihapus, object apa yang terdampak?
```

### 37.10 Ownership

```text
Tim mana yang bertanggung jawab memahami dan mengoperasikan extension ini?
```

---

## 38. Practical Extension Matrix

| Extension | Kategori | Use Case | Risiko Utama |
|---|---|---|---|
| `pg_stat_statements` | Observability | Query aggregate stats | Butuh preload/config/restart |
| `pg_trgm` | Search/indexing | Fuzzy/substring search | GIN index size, write cost |
| `citext` | Data type | Case-insensitive text | Type dependency, collation nuance |
| `btree_gin` | Index support | Scalar ops in GIN | Misuse pada composite GIN |
| `btree_gist` | Index/constraint support | Exclusion constraint with scalar equality | GiST cost, modelling complexity |
| `uuid-ossp` | UUID | Legacy UUID generation | Mungkin tidak perlu di PG modern |
| `pgcrypto` | Crypto/UUID | Random, digest, crypto helper | Key management misunderstanding |
| `hstore` | Key-value | Legacy flat metadata | JSONB often better |
| `unaccent` | Text normalization | Accent-insensitive search | Index/volatility caveat |
| PostGIS | Geospatial | Spatial query/invariant | Heavy dependency, specialized ops |
| `pgaudit` | Audit | SQL audit logs | Provider support, log volume |

---

## 39. Case Study: Search Nama Entitas Regulasi

Misal sistem case management regulatory memiliki tabel:

```sql
CREATE TABLE regulated_entity (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    registration_number text,
    status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
```

User sering mencari nama entitas dengan substring dan typo ringan:

```sql
SELECT id, name, registration_number
FROM regulated_entity
WHERE tenant_id = :tenantId
  AND status = 'ACTIVE'
  AND name ILIKE '%' || :keyword || '%'
ORDER BY name
LIMIT 50;
```

Tanpa index yang cocok, query bisa scan banyak row.

Solusi dengan `pg_trgm`:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_regulated_entity_name_trgm
ON regulated_entity
USING gin (name gin_trgm_ops);

CREATE INDEX idx_regulated_entity_tenant_status
ON regulated_entity (tenant_id, status);
```

Kenapa dua index?

- B-tree membantu filter tenant/status.
- GIN trigram membantu substring search.
- Planner bisa memilih bitmap combination jika cost cocok.

Alternatif:

```sql
CREATE INDEX idx_regulated_entity_active_name_trgm
ON regulated_entity
USING gin (name gin_trgm_ops)
WHERE status = 'ACTIVE';
```

Jika hampir semua search hanya active, partial GIN bisa mengurangi index size.

Namun kalau tenant sangat banyak dan hot tenant dominan, kamu perlu benchmark dengan distribusi realistis.

---

## 40. Case Study: Case-insensitive Email Login

Requirement:

```text
Email login harus unik tanpa membedakan kapitalisasi.
```

Opsi 1: `citext`

```sql
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE app_user (
    id uuid PRIMARY KEY,
    email citext NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
```

Opsi 2: normalized column

```sql
CREATE TABLE app_user (
    id uuid PRIMARY KEY,
    email text NOT NULL,
    email_normalized text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_app_user_email_normalized UNIQUE (email_normalized),
    CONSTRAINT ck_email_normalized CHECK (email_normalized = lower(email))
);
```

Opsi 3: expression unique index

```sql
CREATE UNIQUE INDEX uq_app_user_email_lower
ON app_user (lower(email));
```

Decision:

- `citext`: paling bersih jika case-insensitive adalah property tipe.
- normalized column: eksplisit, portable, mudah dikontrol app.
- expression index: ringan, tapi query harus konsisten.

Untuk sistem regulasi/audit, normalized column sering lebih eksplisit dan mudah dijelaskan.

---

## 41. Case Study: Prevent Overlapping Assignments

Requirement:

```text
Satu investigator tidak boleh memiliki assignment aktif yang waktunya overlap
untuk case kategori tertentu.
```

Schema:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE investigator_assignment (
    id uuid PRIMARY KEY,
    investigator_id uuid NOT NULL,
    case_category text NOT NULL,
    assignment_period tstzrange NOT NULL,
    status text NOT NULL,
    EXCLUDE USING gist (
        investigator_id WITH =,
        case_category WITH =,
        assignment_period WITH &&
    )
    WHERE (status = 'ACTIVE')
);
```

Invariant ini sulit dijaga hanya di Java karena race condition:

```text
Transaction A cek tidak ada overlap.
Transaction B cek tidak ada overlap.
Keduanya insert.
Invariant rusak.
```

Dengan exclusion constraint, database menjaga invariant.

Jika conflict terjadi, aplikasi menangkap SQLSTATE dan memberi pesan domain:

```text
Investigator already has overlapping active assignment.
```

Ini contoh extension yang meningkatkan correctness, bukan sekadar performa.

---

## 42. Case Study: pg_stat_statements untuk Mendeteksi ORM N+1

Misal endpoint:

```text
GET /cases?status=OPEN
```

Tiba-tiba lambat.

APM menunjukkan endpoint memanggil database 501 kali.

`pg_stat_statements` menunjukkan:

```sql
SELECT * FROM case_note WHERE case_id = $1;
```

Dengan:

```text
calls = 500000
mean_exec_time = small
 total_exec_time = huge
```

Masalahnya bukan satu query lambat. Masalahnya query murah yang dipanggil terlalu banyak.

Fix mungkin bukan index, tapi:

- fetch join,
- batch fetch,
- query projection,
- endpoint contract berubah,
- read model,
- pagination child collection.

Ini contoh mengapa observability extension bisa mengubah diagnosis.

---

## 43. Anti-pattern Extension

### 43.1 Extension karena populer

```text
“Kita install PostGIS siapa tahu butuh lokasi.”
```

Salah. Extension harus menjawab kebutuhan nyata.

### 43.2 Extension tanpa environment parity

Local punya extension, production tidak.

Hasil:

```text
Migration gagal saat deploy.
```

### 43.3 Extension tanpa owner

Semua orang memakai, tidak ada yang paham upgrade/failure-nya.

### 43.4 Extension dipakai dalam domain critical tanpa test

Contoh:

- exclusion constraint kompleks,
- custom operator,
- cryptographic function,
- spatial predicate.

Harus diuji dengan edge case.

### 43.5 Menganggap extension menghilangkan kebutuhan modelling

`pg_trgm` tidak memperbaiki search domain yang buruk.
PostGIS tidak memperbaiki coordinate system yang salah.
`pgcrypto` tidak memperbaiki key management yang buruk.
`pg_stat_statements` tidak memperbaiki query tanpa ownership.

### 43.6 Terlalu banyak extension

Semakin banyak extension:

- semakin besar upgrade surface,
- semakin sulit restore,
- semakin banyak dependency,
- semakin tinggi security review cost.

---

## 44. Extension Review Checklist

Gunakan checklist ini sebelum approve extension.

```text
[ ] Problem jelas dan berulang
[ ] Alternatif tanpa extension sudah dievaluasi
[ ] Extension tersedia di semua environment
[ ] Extension support di cloud provider sudah diverifikasi
[ ] Privilege requirement dipahami
[ ] Perlu shared_preload_libraries atau tidak
[ ] Perlu restart atau tidak
[ ] Object dependency teridentifikasi
[ ] Backup/restore diuji
[ ] Upgrade path dipahami
[ ] Monitoring tersedia
[ ] Security risk direview
[ ] Owner ditentukan
[ ] Rollback strategy tersedia
[ ] Performance diuji dengan data realistis
[ ] Migration ditulis eksplisit
```

---

## 45. Runbook: Migration Gagal karena Extension Tidak Tersedia

Gejala:

```text
ERROR: extension "pg_trgm" is not available
DETAIL: Could not open extension control file ...
```

Diagnosis:

```sql
SELECT *
FROM pg_available_extensions
WHERE name = 'pg_trgm';
```

Jika tidak ada:

1. Di self-managed:
   - install package contrib,
   - pastikan versi sesuai PostgreSQL server.
2. Di managed DB:
   - cek daftar supported extension provider,
   - cek parameter/flag,
   - cek privilege user.
3. Di container local:
   - gunakan image PostgreSQL yang menyertakan contrib.
4. Di CI:
   - update service image/init script.

Prevention:

```sql
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_available_extensions
        WHERE name = 'pg_trgm'
    ) THEN
        RAISE EXCEPTION 'pg_trgm is required but unavailable';
    END IF;
END $$;
```

---

## 46. Runbook: Query Search Lambat setelah pg_trgm

Gejala:

```text
ILIKE '%keyword%' masih lambat walau sudah ada GIN trigram index.
```

Cek query:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM customer
WHERE name ILIKE '%abc%';
```

Kemungkinan penyebab:

1. Keyword terlalu pendek.
2. Selectivity terlalu rendah.
3. Planner memilih sequential scan karena hasil terlalu banyak.
4. Index belum dianalisis.
5. Query memakai expression berbeda dari index.
6. Collation/operator mismatch.
7. Table kecil sehingga sequential scan memang lebih murah.
8. GIN pending list besar.
9. Workload write-heavy membuat GIN maintenance berat.

Tindakan:

```sql
ANALYZE customer;
```

Cek index:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'customer';
```

Cek statistik penggunaan index:

```sql
SELECT
    relname,
    indexrelname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
WHERE relname = 'customer';
```

---

## 47. Runbook: pg_stat_statements Tidak Muncul

Gejala:

```text
ERROR: relation "pg_stat_statements" does not exist
```

Cek extension:

```sql
SELECT *
FROM pg_extension
WHERE extname = 'pg_stat_statements';
```

Jika belum:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

Jika error karena preload:

```sql
SHOW shared_preload_libraries;
```

Pastikan memuat `pg_stat_statements`.

Jika belum:

1. Ubah konfigurasi.
2. Restart PostgreSQL.
3. Create extension.
4. Validate view.

```sql
SELECT *
FROM pg_stat_statements
LIMIT 1;
```

Di managed DB, cek parameter group/flags.

---

## 48. Relationship dengan Part Sebelumnya

Part ini terkait langsung dengan:

- Part 009 — Planner Statistics
- Part 010 — EXPLAIN Mastery
- Part 012 — GIN/GiST/BRIN/SP-GiST
- Part 013 — Advanced Index Design
- Part 015 — Constraints as Invariants
- Part 016 — Schema Design PostgreSQL-specific
- Part 017 — JSONB
- Part 023 — Full Text Search

Extension memperluas kemampuan yang sudah kita bahas.

Contoh relasi:

```text
pg_trgm
  → memperluas indexing/search

btree_gist
  → memperluas exclusion constraint

citext
  → memperluas type system

pg_stat_statements
  → memperluas observability

PostGIS
  → memperluas type + operator + index + function domain
```

---

## 49. Prinsip Final

Extension yang baik memiliki satu atau lebih kualitas berikut:

1. Membuat invariant lebih kuat.
2. Membuat query penting jauh lebih efisien.
3. Membuat observability jauh lebih jelas.
4. Mengurangi kompleksitas aplikasi secara signifikan.
5. Menyediakan capability domain yang tidak realistis dibangun sendiri.

Extension yang buruk biasanya:

1. Dipasang tanpa problem jelas.
2. Tidak diuji di production-like environment.
3. Tidak didukung provider.
4. Tidak ada owner.
5. Menjadi dependency tersembunyi.
6. Mengunci arsitektur tanpa sadar.

Rule of thumb:

```text
Gunakan extension ketika ia memperkuat model sistem.
Jangan gunakan extension hanya karena ia tersedia.
```

---

## 50. Latihan

### Latihan 1 — Extension inventory

Jalankan:

```sql
SELECT
    extname,
    extversion,
    extnamespace::regnamespace AS schema
FROM pg_extension
ORDER BY extname;
```

Jawab:

1. Extension apa yang sudah terpasang?
2. Mana yang dipakai schema domain?
3. Mana yang hanya untuk observability?
4. Mana yang bisa menjadi upgrade risk?

### Latihan 2 — pg_stat_statements diagnosis

Jika tersedia, jalankan:

```sql
SELECT
    calls,
    total_exec_time,
    mean_exec_time,
    rows,
    query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```

Untuk setiap query, klasifikasikan:

```text
high total due to frequency
high total due to slow execution
high rows
possible N+1
possible missing index
possible bad query shape
```

### Latihan 3 — trigram index

Buat tabel dummy:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE customer_search_demo (
    id bigserial PRIMARY KEY,
    name text NOT NULL
);
```

Isi data, buat GIN trigram index, lalu bandingkan:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM customer_search_demo
WHERE name ILIKE '%abc%';
```

Sebelum dan sesudah index.

### Latihan 4 — exclusion constraint dengan btree_gist

Buat tabel booking dan coba insert overlap.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE booking_demo (
    id bigserial PRIMARY KEY,
    resource_id int NOT NULL,
    period tstzrange NOT NULL,
    EXCLUDE USING gist (
        resource_id WITH =,
        period WITH &&
    )
);
```

Coba:

```sql
INSERT INTO booking_demo (resource_id, period)
VALUES (1, tstzrange('2026-01-01 10:00+00', '2026-01-01 11:00+00'));

INSERT INTO booking_demo (resource_id, period)
VALUES (1, tstzrange('2026-01-01 10:30+00', '2026-01-01 11:30+00'));
```

Amati constraint violation.

---

## 51. Ringkasan

PostgreSQL extension system membuat PostgreSQL sangat fleksibel. Namun fleksibilitas ini harus dikelola sebagai bagian dari arsitektur produksi.

Key takeaway:

```text
Extension bukan dekorasi database.
Extension adalah dependency capability.
```

`pg_stat_statements` membantu observability query.

`pg_trgm` membantu substring/fuzzy search.

`citext` membantu modelling text case-insensitive.

`btree_gin` dan `btree_gist` memperluas index/operator support.

`pgcrypto` dan UUID-related functions membantu identifier/crypto use case, tetapi harus dipahami dalam konteks versi PostgreSQL modern.

PostGIS mengubah PostgreSQL menjadi spatial database yang sangat kuat, tetapi merupakan dependency domain besar.

Gunakan extension dengan prinsip:

```text
problem first,
access pattern first,
invariant first,
operability first,
then extension.
```

---

## 52. Referensi Resmi dan Lanjutan

- PostgreSQL Documentation — Additional Supplied Modules and Extensions
- PostgreSQL Documentation — `pg_stat_statements`
- PostgreSQL Documentation — `pg_trgm`
- PostgreSQL Documentation — `citext`
- PostgreSQL Documentation — `btree_gin`
- PostgreSQL Documentation — `btree_gist`
- PostgreSQL Documentation — `uuid-ossp`
- PostgreSQL Documentation — `pgcrypto`
- PostgreSQL Documentation — `hstore`
- PostgreSQL Documentation — `unaccent`
- PostGIS Documentation
- Cloud provider documentation for supported PostgreSQL extensions

---

## 53. Status Akhir Part

Kamu sudah menyelesaikan:

```text
Part 024 — Extensions: pg_stat_statements, pg_trgm, btree_gin, uuid, PostGIS, dan Ekosistem
```

Seri belum selesai.

Lanjut berikutnya:

```text
Part 025 — Observability: Logs, Metrics, pg_stat Views, dan Query Intelligence
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-023.md">⬅️ Part 023 — Full Text Search PostgreSQL</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-025.md">Part 025 — Observability: Logs, Metrics, `pg_stat` Views, dan Query Intelligence ➡️</a>
</div>
