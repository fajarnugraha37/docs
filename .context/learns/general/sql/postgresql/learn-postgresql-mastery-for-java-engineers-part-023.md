# learn-postgresql-mastery-for-java-engineers-part-023.md

# Part 023 — Full Text Search PostgreSQL

> Seri: `learn-postgresql-mastery-for-java-engineers`  
> Bagian: `023 / 034`  
> Fokus: memahami PostgreSQL Full Text Search sebagai mesin pencarian internal yang cukup kuat untuk banyak kebutuhan aplikasi, sekaligus mengetahui batasnya sebelum memindahkan beban ke Elasticsearch/OpenSearch/Lucene-based search engine.

---

## 0. Posisi Part Ini dalam Seri

Di bagian sebelumnya kita sudah membahas:

- storage model,
- MVCC,
- WAL,
- memory,
- planner,
- statistics,
- index,
- locking,
- constraint,
- JSONB,
- partitioning,
- vacuum,
- write path,
- read path,
- function/trigger/server-side logic.

Sekarang kita masuk ke salah satu kemampuan PostgreSQL yang sering diremehkan: **Full Text Search**.

Banyak engineer langsung berpikir:

```text
Butuh search? Pakai Elasticsearch.
```

Itu tidak selalu salah, tetapi sering terlalu cepat.

Untuk banyak aplikasi backend, terutama:

- case management,
- regulatory enforcement,
- internal admin console,
- document metadata search,
- comments/notes search,
- ticketing,
- audit search,
- knowledge-base ringan,
- search atas entity bisnis yang tetap transactional,

PostgreSQL Full Text Search sering cukup baik, lebih sederhana, lebih konsisten, dan lebih murah secara operasional.

Tetapi PostgreSQL FTS juga bukan pengganti universal untuk search engine khusus. Kita perlu memahami **apa problem yang diselesaikan**, **bagaimana mekanismenya**, **bagaimana index bekerja**, dan **di mana batasnya**.

---

## 1. Masalah yang Diselesaikan Full Text Search

Search teks terlihat sederhana:

```sql
SELECT *
FROM cases
WHERE description ILIKE '%late payment%';
```

Tetapi pendekatan seperti ini punya beberapa masalah:

1. Lambat untuk data besar.
2. Sulit memakai index B-tree biasa karena wildcard di awal pattern.
3. Tidak memahami kata dasar.
4. Tidak memahami ranking relevansi.
5. Tidak memahami stop words.
6. Tidak memahami tokenisasi.
7. Tidak bisa membedakan kata penting dan tidak penting.
8. Tidak nyaman untuk query multi-term.
9. Tidak punya model dokumen.
10. Sulit dikombinasikan dengan relevance ordering.

Contoh:

```text
User search: "violations payment overdue"
```

Dengan `ILIKE`, kita hanya mencocokkan substring. PostgreSQL tidak tahu bahwa:

- `violation` dan `violations` terkait,
- `payment` mungkin lebih penting daripada kata penghubung,
- `overdue` mungkin muncul di field `title` atau `description`,
- hasil yang match di title mungkin lebih relevan daripada hasil yang hanya match di body,
- hasil harus diberi ranking.

Full Text Search memberi model yang lebih baik:

```text
raw text
  -> parsed into tokens
  -> normalized into lexemes
  -> stored as tsvector
  -> queried using tsquery
  -> matched using @@ operator
  -> ranked using ts_rank / ts_rank_cd
  -> optionally highlighted using ts_headline
```

---

## 2. Mental Model Utama

PostgreSQL Full Text Search punya dua tipe inti:

```text
tsvector = representasi dokumen yang sudah diproses

tsquery  = representasi query pencarian yang sudah diproses
```

Query pencarian tidak langsung dibandingkan dengan string mentah.

Yang dibandingkan adalah:

```text
document lexemes @@ query lexemes
```

Contoh konseptual:

```text
Text:
"The customer submitted multiple payment violations."

Setelah diproses:
'custom':2 'multipl':4 'payment':5 'submit':3 'violat':6
```

Kata seperti `the` bisa hilang sebagai stop word. Kata seperti `submitted` menjadi bentuk dasar `submit`. Kata seperti `violations` menjadi `violat` tergantung configuration/stemmer.

PostgreSQL tidak mencari substring mentah. Ia mencari **lexeme**.

---

## 3. Komponen Full Text Search

Secara besar, FTS PostgreSQL terdiri dari:

1. Document.
2. Parser.
3. Token.
4. Dictionary.
5. Lexeme.
6. Text search configuration.
7. `tsvector`.
8. `tsquery`.
9. Match operator `@@`.
10. Ranking.
11. Highlighting.
12. Index.

Mari kita uraikan satu per satu.

---

## 4. Document

Dalam FTS, document bukan berarti file `.pdf` atau `.docx` saja.

Document adalah unit teks yang ingin dicari.

Contoh document:

```text
case title + case summary + violation notes
```

Atau:

```text
article title + article body
```

Atau:

```text
customer complaint subject + message + resolution
```

Dalam database relasional, document sering dibangun dari beberapa kolom.

Contoh:

```sql
SELECT
    title || ' ' || summary || ' ' || notes AS document
FROM enforcement_case;
```

Tetapi dalam produksi, kita harus hati-hati terhadap `NULL`:

```sql
SELECT
    coalesce(title, '') || ' ' ||
    coalesce(summary, '') || ' ' ||
    coalesce(notes, '') AS document
FROM enforcement_case;
```

Karena string concatenation dengan `NULL` bisa menghasilkan `NULL`.

---

## 5. Parser, Token, Dictionary, Lexeme

FTS tidak bekerja langsung pada kalimat.

Pipeline konseptualnya:

```text
Raw document
  -> parser splits into tokens
  -> token classified by type
  -> dictionary normalizes token
  -> lexeme produced
  -> tsvector stores lexemes and positions
```

Contoh:

```sql
SELECT to_tsvector('english', 'The customers were submitting payment violations');
```

Output kira-kira:

```text
'custom':2 'payment':5 'submit':4 'violat':6
```

Hal yang terjadi:

- `The` dibuang sebagai stop word.
- `customers` dinormalisasi menjadi `custom`.
- `submitting` menjadi `submit`.
- `violations` menjadi `violat`.
- posisi kata disimpan.

Posisi penting untuk ranking dan phrase/proximity behavior.

---

## 6. Text Search Configuration

Configuration menentukan bagaimana teks diproses.

Contoh:

```sql
SELECT to_tsvector('english', 'running runs runner');
```

Configuration `english` akan memakai aturan bahasa Inggris.

Untuk bahasa lain:

```sql
SELECT to_tsvector('simple', 'running runs runner');
```

`simple` lebih literal dan tidak melakukan stemming bahasa Inggris dengan cara yang sama.

Perbedaan configuration bisa mengubah hasil search secara drastis.

### 6.1 Kenapa Configuration Penting

Misalnya aplikasi regulatory kamu punya dokumen dalam bahasa Indonesia dan Inggris.

Jika semua dipaksa memakai `english`, hasilnya bisa buruk untuk bahasa Indonesia.

Contoh problem:

```text
"pemeriksaan", "diperiksa", "memeriksa"
```

PostgreSQL built-in configuration tidak selalu punya stemming yang ideal untuk semua bahasa/domain.

Maka pilihan configuration adalah keputusan domain.

### 6.2 Default Text Search Configuration

PostgreSQL punya parameter:

```sql
SHOW default_text_search_config;
```

Tetapi untuk aplikasi produksi, jangan terlalu bergantung pada default session jika ingin deterministic behavior.

Lebih aman:

```sql
to_tsvector('english', body)
```

Daripada:

```sql
to_tsvector(body)
```

Karena default bisa berubah per database/session.

---

## 7. `tsvector`

`tsvector` adalah representasi dokumen yang sudah siap dicari.

Contoh:

```sql
SELECT to_tsvector('english', 'The quick brown fox jumps over the lazy dog');
```

Hasilnya adalah daftar lexeme + posisi.

Secara mental:

```text
tsvector = inverted-search-friendly representation of a document
```

Ia bukan string biasa.

### 7.1 Membuat `tsvector` dari Satu Kolom

```sql
SELECT to_tsvector('english', description)
FROM case_note;
```

### 7.2 Membuat `tsvector` dari Banyak Kolom

```sql
SELECT to_tsvector(
    'english',
    coalesce(title, '') || ' ' ||
    coalesce(summary, '') || ' ' ||
    coalesce(description, '')
)
FROM enforcement_case;
```

### 7.3 Bobot Field

Tidak semua field punya bobot yang sama.

Match di `title` biasanya lebih penting daripada match di `body`.

PostgreSQL mendukung weight:

```sql
SELECT
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C')
FROM enforcement_case;
```

Weight umum:

```text
A = paling penting
B = penting
C = normal
D = paling rendah
```

Contoh domain:

```text
case_number     -> A
case_title      -> A
respondent_name -> A/B
summary         -> B
notes           -> C
raw_payload     -> D
```

---

## 8. `tsquery`

`tsquery` adalah representasi query pencarian.

Contoh:

```sql
SELECT to_tsquery('english', 'payment & violation');
```

Operator umum:

```text
&   AND
|   OR
!   NOT
<-> phrase adjacency
:*  prefix matching
```

Contoh:

```sql
SELECT to_tsquery('english', 'payment & violation');
```

Artinya document harus mengandung payment dan violation.

```sql
SELECT to_tsquery('english', 'payment | overdue');
```

Artinya document mengandung payment atau overdue.

```sql
SELECT to_tsquery('english', 'payment & !resolved');
```

Artinya document mengandung payment tetapi tidak mengandung resolved.

---

## 9. `plainto_tsquery`, `phraseto_tsquery`, dan `websearch_to_tsquery`

Untuk input user biasa, jangan langsung memasukkan string user ke `to_tsquery`.

Kenapa?

Karena `to_tsquery` mengharapkan syntax query FTS.

Input ini valid:

```sql
SELECT to_tsquery('english', 'payment & violation');
```

Tapi input user seperti ini bisa error:

```text
payment violation overdue
```

Untuk user-facing search, gunakan fungsi yang lebih aman.

### 9.1 `plainto_tsquery`

```sql
SELECT plainto_tsquery('english', 'payment violation overdue');
```

Ini mengubah plain text menjadi query dengan AND antar term.

Cocok untuk search sederhana.

### 9.2 `phraseto_tsquery`

```sql
SELECT phraseto_tsquery('english', 'late payment');
```

Cocok untuk phrase-like search.

### 9.3 `websearch_to_tsquery`

```sql
SELECT websearch_to_tsquery('english', '"late payment" OR violation -resolved');
```

Lebih cocok untuk user yang terbiasa dengan gaya search engine.

Biasanya untuk aplikasi admin/internal search, `websearch_to_tsquery` adalah pilihan ergonomic.

---

## 10. Operator Match `@@`

FTS match memakai operator `@@`.

Contoh:

```sql
SELECT id, title
FROM enforcement_case
WHERE to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, ''))
      @@ plainto_tsquery('english', 'payment violation');
```

Mental model:

```text
tsvector @@ tsquery
```

Artinya:

```text
apakah dokumen ini memenuhi query search?
```

---

## 11. Contoh Tabel Case Management

Kita akan pakai contoh domain regulatory/case management.

```sql
CREATE TABLE enforcement_case (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id       bigint NOT NULL,
    case_number     text NOT NULL,
    title           text NOT NULL,
    summary         text,
    respondent_name text,
    status          text NOT NULL,
    severity        text NOT NULL,
    opened_at       timestamptz NOT NULL DEFAULT now(),
    closed_at       timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
```

Naive search:

```sql
SELECT id, case_number, title
FROM enforcement_case
WHERE title ILIKE '%late payment%'
   OR summary ILIKE '%late payment%'
   OR respondent_name ILIKE '%late payment%';
```

FTS search:

```sql
SELECT id, case_number, title
FROM enforcement_case
WHERE
    to_tsvector(
        'english',
        coalesce(case_number, '') || ' ' ||
        coalesce(title, '') || ' ' ||
        coalesce(summary, '') || ' ' ||
        coalesce(respondent_name, '')
    ) @@ websearch_to_tsquery('english', 'late payment');
```

Lebih baik, tetapi belum optimal karena `to_tsvector(...)` dihitung saat query.

---

## 12. Generated Column untuk Search Vector

Untuk produksi, sering lebih baik menyimpan `tsvector` sebagai generated column.

```sql
ALTER TABLE enforcement_case
ADD COLUMN search_vector tsvector
GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(case_number, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(respondent_name, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'C')
) STORED;
```

Lalu:

```sql
CREATE INDEX enforcement_case_search_vector_gin_idx
ON enforcement_case
USING GIN (search_vector);
```

Query:

```sql
SELECT id, case_number, title
FROM enforcement_case
WHERE search_vector @@ websearch_to_tsquery('english', 'late payment');
```

Keuntungan:

1. Query lebih bersih.
2. `tsvector` tidak dihitung ulang setiap search.
3. Index lebih mudah dipakai.
4. Consistency dijaga oleh generated column.
5. Tidak perlu trigger manual untuk update vector.

Trade-off:

1. Write menjadi lebih mahal.
2. Storage bertambah.
3. Perubahan expression generated column perlu migration.
4. Semua update field sumber bisa memperbarui vector.

---

## 13. Expression Index vs Stored Generated Column

Ada dua pendekatan umum.

### 13.1 Expression Index

```sql
CREATE INDEX enforcement_case_fts_expr_idx
ON enforcement_case
USING GIN (
    (
        setweight(to_tsvector('english', coalesce(case_number, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(respondent_name, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(summary, '')), 'C')
    )
);
```

Query harus cocok dengan expression:

```sql
WHERE
    (
        setweight(to_tsvector('english', coalesce(case_number, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(respondent_name, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(summary, '')), 'C')
    ) @@ websearch_to_tsquery('english', :q)
```

Kekurangan: verbose dan rawan tidak match expression.

### 13.2 Stored Generated Column

```sql
ALTER TABLE enforcement_case
ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (...) STORED;

CREATE INDEX ... USING GIN (search_vector);
```

Query:

```sql
WHERE search_vector @@ websearch_to_tsquery('english', :q)
```

Lebih nyaman untuk aplikasi.

### 13.3 Kapan Pilih Mana?

Gunakan generated column jika:

- search adalah fitur penting,
- expression cukup kompleks,
- query dipakai di banyak tempat,
- ingin mengurangi risiko ORM menghasilkan expression berbeda,
- ingin search vector bisa diobservasi langsung.

Gunakan expression index jika:

- search sederhana,
- ingin menghindari kolom tambahan,
- expression jarang berubah,
- query ditulis secara eksplisit dan terkendali.

---

## 14. GIN Index untuk Full Text Search

FTS umumnya memakai GIN index.

Mental model GIN:

```text
lexeme -> daftar row/document yang mengandung lexeme tersebut
```

Contoh:

```text
'payment'   -> row 1, row 5, row 9, row 20
'violation' -> row 1, row 2, row 9
'overdue'   -> row 5, row 9
```

Query:

```text
payment & violation
```

PostgreSQL bisa mengambil posting list untuk `payment` dan `violation`, lalu melakukan intersection.

Ini berbeda dari B-tree yang cocok untuk ordering/equality/range atas nilai scalar.

---

## 15. GIN vs GiST untuk Text Search

PostgreSQL mendukung GIN dan GiST untuk text search.

Secara umum:

```text
GIN  = biasanya lebih baik untuk lookup FTS read-heavy
GiST = lebih fleksibel, bisa lossy, kadang berguna untuk kombinasi tertentu
```

Untuk kebanyakan aplikasi FTS biasa:

```sql
CREATE INDEX ... USING GIN (search_vector);
```

adalah default yang masuk akal.

Tapi GIN punya trade-off:

1. Write overhead lebih tinggi.
2. Index bisa besar.
3. Update-heavy table bisa menanggung cost tinggi.
4. Pending list/maintenance behavior perlu dipahami untuk beban tulis tinggi.

---

## 16. Ranking dengan `ts_rank` dan `ts_rank_cd`

Matching saja tidak cukup.

Search perlu urutan relevansi.

```sql
SELECT
    id,
    case_number,
    title,
    ts_rank(search_vector, websearch_to_tsquery('english', :q)) AS rank
FROM enforcement_case
WHERE search_vector @@ websearch_to_tsquery('english', :q)
ORDER BY rank DESC
LIMIT 20;
```

`ts_rank` menghitung relevansi berdasarkan lexeme frequency, position, weight, dan normalization option.

`ts_rank_cd` adalah cover density ranking, yang memperhatikan kedekatan term.

Contoh:

```sql
SELECT
    id,
    title,
    ts_rank_cd(search_vector, websearch_to_tsquery('english', :q)) AS rank
FROM enforcement_case
WHERE search_vector @@ websearch_to_tsquery('english', :q)
ORDER BY rank DESC
LIMIT 20;
```

### 16.1 Ranking Tidak Sama dengan Business Ordering

Dalam aplikasi nyata, hasil search sering perlu kombinasi:

```text
relevance score
+ recency
+ severity
+ status
+ tenant visibility
+ user permission
```

Contoh:

```sql
SELECT
    id,
    case_number,
    title,
    severity,
    opened_at,
    ts_rank_cd(search_vector, q.query) AS rank
FROM enforcement_case c
CROSS JOIN websearch_to_tsquery('english', :q) AS q(query)
WHERE c.tenant_id = :tenant_id
  AND c.status <> 'DELETED'
  AND c.search_vector @@ q.query
ORDER BY
    ts_rank_cd(c.search_vector, q.query) DESC,
    c.opened_at DESC
LIMIT 20;
```

Perhatikan `CROSS JOIN` untuk menghitung query sekali.

---

## 17. Highlighting dengan `ts_headline`

Search UI sering perlu menampilkan snippet.

```sql
SELECT
    id,
    title,
    ts_headline('english', summary, websearch_to_tsquery('english', :q)) AS snippet
FROM enforcement_case
WHERE search_vector @@ websearch_to_tsquery('english', :q)
LIMIT 20;
```

`ts_headline` dapat menandai bagian teks yang match.

Tetapi hati-hati:

1. Ini bisa mahal untuk banyak row.
2. Gunakan setelah filtering/limit bila mungkin.
3. Jangan generate headline untuk ribuan hasil sekaligus.
4. Perhatikan escaping HTML di aplikasi.

Pattern yang lebih aman:

```sql
WITH q AS (
    SELECT websearch_to_tsquery('english', :search) AS query
), matched AS (
    SELECT
        c.id,
        c.title,
        c.summary,
        ts_rank_cd(c.search_vector, q.query) AS rank,
        q.query
    FROM enforcement_case c
    CROSS JOIN q
    WHERE c.tenant_id = :tenant_id
      AND c.search_vector @@ q.query
    ORDER BY rank DESC
    LIMIT 20
)
SELECT
    id,
    title,
    ts_headline('english', summary, query) AS snippet,
    rank
FROM matched;
```

---

## 18. Combining Structured Filters and Full Text Search

FTS hampir selalu dikombinasikan dengan filter terstruktur.

Contoh:

```sql
SELECT id, case_number, title
FROM enforcement_case
WHERE tenant_id = :tenant_id
  AND status IN ('OPEN', 'UNDER_REVIEW')
  AND severity IN ('HIGH', 'CRITICAL')
  AND search_vector @@ websearch_to_tsquery('english', :q)
ORDER BY opened_at DESC
LIMIT 50;
```

Masalah: index mana yang dipakai?

Kamu mungkin punya:

```sql
CREATE INDEX enforcement_case_tenant_status_idx
ON enforcement_case (tenant_id, status, opened_at DESC);

CREATE INDEX enforcement_case_search_vector_gin_idx
ON enforcement_case USING GIN (search_vector);
```

Planner bisa memilih:

1. GIN search dulu lalu filter tenant/status.
2. B-tree tenant/status dulu lalu filter search.
3. Bitmap combine beberapa index.

Keputusan tergantung statistics dan selectivity.

### 18.1 Multi-tenant Problem

Jika semua tenant ada dalam satu tabel, GIN index global bisa bermasalah.

Contoh:

```text
Tenant A: 90% data
Tenant B: 0.1% data
```

Search untuk tenant kecil mungkin tetap melihat posting list global besar.

Solusi yang mungkin:

1. Tambahkan filter tenant yang sangat selektif.
2. Buat partial index untuk tenant besar atau status aktif.
3. Partition by tenant class atau waktu jika workload cocok.
4. Pisahkan search table/projection.
5. Gunakan external search engine jika isolation/search scale butuh lebih kuat.

### 18.2 Partial GIN Index

Jika hanya case aktif yang sering dicari:

```sql
CREATE INDEX enforcement_case_active_search_gin_idx
ON enforcement_case
USING GIN (search_vector)
WHERE status IN ('OPEN', 'UNDER_REVIEW');
```

Query harus menyertakan predicate yang kompatibel:

```sql
WHERE status IN ('OPEN', 'UNDER_REVIEW')
  AND search_vector @@ websearch_to_tsquery('english', :q)
```

Keuntungan:

- index lebih kecil,
- write overhead lebih rendah untuk row yang tidak relevan,
- search aktif lebih cepat.

Trade-off:

- query archived/closed tidak bisa memakai partial index itu,
- predicate harus konsisten,
- butuh governance query.

---

## 19. Prefix Search

Kadang user mengetik sebagian kata:

```text
viol
```

FTS biasa mencari lexeme penuh.

Prefix query:

```sql
SELECT to_tsquery('english', 'viol:*');
```

Contoh:

```sql
SELECT id, title
FROM enforcement_case
WHERE search_vector @@ to_tsquery('english', :prefix || ':*');
```

Tetapi jangan langsung concat input user tanpa validasi.

Lebih aman buat helper di aplikasi yang:

1. trim input,
2. split term,
3. escape karakter khusus,
4. batasi panjang term,
5. batasi jumlah term,
6. ubah menjadi query prefix yang valid.

Prefix search bisa mahal jika prefix terlalu pendek.

Contoh buruk:

```text
a:*
```

Itu bisa match sangat banyak lexeme.

Guardrail:

```text
minimum prefix length >= 3 atau 4
maximum terms <= 5
statement_timeout rendah untuk endpoint search
limit wajib
```

---

## 20. Phrase Search

Untuk pencarian frasa:

```sql
SELECT phraseto_tsquery('english', 'late payment');
```

Atau dengan operator adjacency:

```sql
SELECT to_tsquery('english', 'late <-> payment');
```

Phrase search membutuhkan posisi lexeme.

FTS PostgreSQL dapat menangani phrase matching, tetapi jangan samakan dengan semua kemampuan proximity search engine khusus.

---

## 21. Fuzzy Search dan Typo: `pg_trgm`

Full Text Search bukan fuzzy matching utama.

Jika user mengetik typo:

```text
paymant violaton
```

FTS mungkin gagal.

Untuk typo/similarity, PostgreSQL punya extension `pg_trgm`.

Aktifkan:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Index trigram:

```sql
CREATE INDEX enforcement_case_title_trgm_idx
ON enforcement_case
USING GIN (title gin_trgm_ops);
```

Query:

```sql
SELECT id, title
FROM enforcement_case
WHERE title % :q
ORDER BY similarity(title, :q) DESC
LIMIT 20;
```

Atau untuk `ILIKE`:

```sql
SELECT id, title
FROM enforcement_case
WHERE title ILIKE '%' || :q || '%'
LIMIT 20;
```

Dengan trigram index, substring/similarity search bisa jauh lebih baik.

### 21.1 FTS vs Trigram

Gunakan FTS untuk:

```text
kata, lexeme, stemming, ranking dokumen
```

Gunakan trigram untuk:

```text
typo, substring, partial name, fuzzy title matching
```

Sering keduanya dikombinasikan:

```sql
WITH q AS (
    SELECT
        websearch_to_tsquery('english', :q) AS tsq,
        :q::text AS raw
)
SELECT
    c.id,
    c.title,
    ts_rank_cd(c.search_vector, q.tsq) AS fts_rank,
    similarity(c.title, q.raw) AS title_similarity
FROM enforcement_case c
CROSS JOIN q
WHERE c.tenant_id = :tenant_id
  AND (
      c.search_vector @@ q.tsq
      OR c.title % q.raw
      OR c.case_number ILIKE '%' || q.raw || '%'
  )
ORDER BY
    (ts_rank_cd(c.search_vector, q.tsq) * 10 + similarity(c.title, q.raw)) DESC
LIMIT 20;
```

Tapi hati-hati: query seperti ini bisa sulit dioptimalkan jika terlalu luas.

---

## 22. Search untuk Identifier: Jangan Paksa FTS

FTS buruk untuk beberapa jenis pencarian:

```text
CASE-2026-000123
INV/REG/2026/07
john.doe@example.com
+62-812-xxxx
NIK/account number/reference code
```

Identifier sering butuh exact/prefix/substring search, bukan stemming.

Gunakan:

1. B-tree untuk exact lookup.
2. B-tree pattern ops untuk prefix tertentu.
3. Trigram untuk substring/fuzzy.
4. Normalized search column.

Contoh:

```sql
CREATE INDEX enforcement_case_case_number_idx
ON enforcement_case (case_number);
```

Untuk normalized identifier:

```sql
ALTER TABLE enforcement_case
ADD COLUMN case_number_normalized text
GENERATED ALWAYS AS (
    lower(regexp_replace(case_number, '[^a-zA-Z0-9]', '', 'g'))
) STORED;

CREATE INDEX enforcement_case_case_number_normalized_idx
ON enforcement_case (case_number_normalized);
```

Jangan memaksa `CASE-2026-000123` masuk FTS sebagai solusi utama.

---

## 23. Search Projection Table

Untuk sistem kompleks, search document sering tidak cocok berada langsung di tabel utama.

Contoh `enforcement_case` punya banyak related table:

- case,
- parties,
- violations,
- notes,
- documents,
- assigned officers,
- tags,
- workflow state,
- latest action.

Membuat `search_vector` langsung di tabel case bisa sulit karena data berasal dari banyak tabel.

Solusi: search projection table.

```sql
CREATE TABLE enforcement_case_search_projection (
    case_id       bigint PRIMARY KEY,
    tenant_id     bigint NOT NULL,
    status        text NOT NULL,
    severity      text NOT NULL,
    opened_at     timestamptz NOT NULL,
    search_text   text NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english', search_text)
    ) STORED,
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX enforcement_case_search_projection_tenant_idx
ON enforcement_case_search_projection (tenant_id, status, opened_at DESC);

CREATE INDEX enforcement_case_search_projection_fts_idx
ON enforcement_case_search_projection USING GIN (search_vector);
```

Projection update bisa dilakukan lewat:

1. synchronous update di application service,
2. trigger,
3. outbox + background worker,
4. scheduled refresh,
5. materialized view refresh untuk kasus tertentu.

### 23.1 Trade-off Projection Table

Keuntungan:

- search document lebih eksplisit,
- tabel utama tidak dipenuhi logic search,
- bisa menggabungkan banyak entity,
- bisa dioptimalkan khusus search,
- bisa punya lifecycle refresh sendiri.

Kekurangan:

- consistency complexity,
- potensi stale search result,
- butuh rebuild path,
- butuh observability,
- butuh backfill/migration strategy.

Pattern production:

```text
source tables are truth
search projection is derived
projection must be rebuildable
```

---

## 24. Trigger vs Application-managed Search Vector

Ada beberapa cara menjaga search vector.

### 24.1 Generated Column

Cocok jika semua input ada dalam row yang sama.

```text
simple, deterministic, safe
```

### 24.2 Trigger

Cocok jika butuh transform lebih kompleks.

Tapi trigger punya risiko:

- logic tersembunyi,
- deployment lebih kompleks,
- debugging lebih sulit,
- write path lebih mahal,
- risiko recursive update,
- coupling antar tabel.

### 24.3 Application-managed Projection

Cocok jika search document adalah agregasi banyak entity.

```text
Java service writes domain state
Java service / worker updates search projection
```

Lebih eksplisit, tetapi harus menangani consistency.

### 24.4 Outbox-driven Projection

Pattern yang sering kuat:

```text
Transaction writes domain data + outbox event
Background projector consumes event
Search projection updated asynchronously
```

Trade-off:

- domain write tetap cepat,
- search eventual consistency,
- projection rebuildable,
- butuh idempotency.

---

## 25. FTS dan Transactional Consistency

Keunggulan PostgreSQL FTS dibanding external search engine:

```text
search index bisa berada dalam database transaction yang sama
```

Jika search vector/generated column berada di tabel yang sama, maka setelah commit:

```text
data + search vector visible bersama-sama
```

Tidak ada dual-write ke sistem eksternal.

Ini penting untuk:

- regulatory case search,
- audit search,
- admin workflow,
- correctness-sensitive internal tooling.

External search engine sering punya eventual consistency:

```text
DB commit sukses
search index update belum selesai
user search belum melihat data
```

Itu tidak selalu buruk, tetapi harus disadari.

---

## 26. Bahasa, Stemming, Stop Words, dan Domain Vocabulary

FTS bukan hanya index. Ia juga language processing.

Masalah umum:

1. Bahasa dokumen campuran.
2. Istilah hukum/regulasi tidak boleh distem sembarangan.
3. Acronym penting.
4. Stop word default mungkin membuang kata yang penting secara domain.
5. Nama orang/perusahaan tidak boleh dinormalisasi seperti kata biasa.
6. Nomor dokumen butuh search berbeda.

Contoh:

```text
"No Action Letter"
```

Kata `no` bisa dianggap stop word dalam beberapa konfigurasi, padahal secara legal frasa itu penting.

Solusi:

1. Pisahkan identifier search dari full-text search.
2. Gunakan configuration yang sesuai.
3. Gunakan dictionary custom bila perlu.
4. Simpan field penting dengan weight tinggi.
5. Kombinasikan FTS + trigram + exact lookup.
6. Uji search relevance dengan corpus nyata.

---

## 27. Security dan Permission Filtering

Search tidak boleh membocorkan data.

Query search harus selalu memasukkan permission boundary:

```sql
SELECT id, title
FROM enforcement_case
WHERE tenant_id = :tenant_id
  AND search_vector @@ websearch_to_tsquery('english', :q)
LIMIT 20;
```

Jika user hanya boleh melihat subset case:

```sql
SELECT c.id, c.title
FROM enforcement_case c
JOIN case_acl acl
  ON acl.case_id = c.id
WHERE acl.user_id = :user_id
  AND c.search_vector @@ websearch_to_tsquery('english', :q)
LIMIT 20;
```

Jangan lakukan:

```text
search semua data dulu, filter permission di Java setelahnya
```

Itu berbahaya karena:

1. bisa leak metadata,
2. ranking bisa terpengaruh data yang tidak boleh terlihat,
3. pagination salah,
4. performa buruk,
5. audit sulit.

Permission harus menjadi bagian query database.

---

## 28. Pagination Search Result

Search result biasanya diurutkan dengan relevance.

```sql
ORDER BY rank DESC, id DESC
LIMIT 20 OFFSET 1000;
```

Masalah offset tetap berlaku:

- semakin jauh halaman, semakin mahal,
- ranking bisa berubah saat data berubah,
- hasil bisa duplicate/missing.

Untuk banyak search UI, offset kecil masih acceptable.

Untuk deep pagination, gunakan cursor/keyset pattern:

```sql
ORDER BY rank DESC, id DESC
```

Lalu simpan last seen:

```text
last_rank
last_id
```

Tetapi keyset dengan computed rank tidak selalu mudah. Untuk admin search, sering cukup:

```text
limit hasil search ke 100/500 pertama
paksa user refine query/filter
```

Ini lebih realistis daripada mendukung infinite deep search di PostgreSQL.

---

## 29. Observability untuk FTS

Yang perlu dilihat:

1. Apakah GIN index dipakai?
2. Berapa row estimate vs actual?
3. Apakah query melakukan sequential scan?
4. Apakah filter structured terlalu lemah?
5. Apakah ranking dihitung untuk terlalu banyak row?
6. Apakah `ts_headline` mahal?
7. Apakah GIN index terlalu besar?
8. Apakah write latency naik karena GIN update?
9. Apakah vacuum/autovacuum tertinggal?
10. Apakah query search masuk slow log?

Gunakan:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT ...;
```

Contoh yang ingin dilihat:

```text
Bitmap Index Scan on enforcement_case_search_vector_gin_idx
Bitmap Heap Scan on enforcement_case
```

Red flag:

```text
Seq Scan on enforcement_case
Rows Removed by Filter: sangat besar
Execution Time: tinggi
```

---

## 30. Performance Pitfalls

### 30.1 Menghitung `to_tsvector` Saat Query

Buruk untuk tabel besar:

```sql
WHERE to_tsvector('english', body) @@ plainto_tsquery('english', :q)
```

Tanpa expression index yang cocok, ini bisa scan besar.

### 30.2 Tidak Memakai `coalesce`

```sql
to_tsvector('english', title || ' ' || body)
```

Jika `body` null, hasil concatenation bisa null.

Gunakan:

```sql
to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
```

### 30.3 Search Tanpa `LIMIT`

Search endpoint harus punya limit.

```sql
LIMIT 20
```

atau:

```sql
LIMIT 50
```

Jangan return semua hasil.

### 30.4 Ranking Semua Row

Buruk:

```sql
SELECT *, ts_rank(search_vector, q)
FROM big_table
ORDER BY ts_rank(search_vector, q) DESC;
```

Ranking harus setelah filter match.

### 30.5 `ts_headline` untuk Terlalu Banyak Row

Generate snippet hanya untuk row yang akan ditampilkan.

### 30.6 Query User Tidak Dibatasi

User bisa memasukkan query sangat panjang.

Guardrail:

- max length,
- max tokens,
- statement timeout,
- rate limit,
- minimum prefix length,
- required tenant/filter.

### 30.7 Search Global pada Tabel Multi-tenant Besar

Harus ada tenant/security filter.

### 30.8 Menganggap FTS Bisa Menggantikan Semua Search

FTS tidak ideal untuk:

- autocomplete kompleks,
- typo tolerance tinggi,
- semantic search,
- faceted search skala besar,
- cross-index relevance tuning kompleks,
- multilingual stemming canggih,
- distributed search besar,
- highlighting/snippet kompleks pada dokumen besar.

---

## 31. Java Integration Pattern

### 31.1 Query dengan JDBC Named Parameter Concept

Dengan Spring JDBC atau jOOQ, bentuk query sebaiknya eksplisit.

```sql
WITH q AS (
    SELECT websearch_to_tsquery('english', :search_query) AS query
)
SELECT
    c.id,
    c.case_number,
    c.title,
    c.status,
    c.severity,
    c.opened_at,
    ts_rank_cd(c.search_vector, q.query) AS rank
FROM enforcement_case c
CROSS JOIN q
WHERE c.tenant_id = :tenant_id
  AND c.status = ANY(:statuses)
  AND c.search_vector @@ q.query
ORDER BY rank DESC, c.opened_at DESC
LIMIT :limit;
```

### 31.2 Jangan Bangun `to_tsquery` String Mentah Sembarangan

Buruk:

```java
String sql = "... to_tsquery('english', '" + userInput + "')";
```

Lebih aman:

```sql
websearch_to_tsquery('english', ?)
```

Dengan bind parameter.

### 31.3 DTO Result

Search result biasanya bukan entity penuh.

Gunakan projection DTO:

```java
public record CaseSearchResult(
    long id,
    String caseNumber,
    String title,
    String status,
    String severity,
    Instant openedAt,
    double rank
) {}
```

Jangan langsung hydrate entity graph besar hanya untuk search page.

### 31.4 Hibernate Caveat

Hibernate/JPA tidak selalu nyaman untuk fitur PostgreSQL FTS.

Pilihan lebih baik:

1. native query,
2. jOOQ,
3. Spring JDBC,
4. repository khusus search.

Search adalah access pattern khusus; jangan memaksa semua lewat ORM entity model.

---

## 32. Example: Production-grade Case Search Query

```sql
WITH q AS (
    SELECT websearch_to_tsquery('english', :search_query) AS query
), matched AS (
    SELECT
        c.id,
        c.case_number,
        c.title,
        c.summary,
        c.status,
        c.severity,
        c.opened_at,
        ts_rank_cd(c.search_vector, q.query) AS rank,
        q.query
    FROM enforcement_case c
    CROSS JOIN q
    WHERE c.tenant_id = :tenant_id
      AND c.status = ANY(:statuses)
      AND c.search_vector @@ q.query
    ORDER BY
        ts_rank_cd(c.search_vector, q.query) DESC,
        c.opened_at DESC,
        c.id DESC
    LIMIT :limit
)
SELECT
    id,
    case_number,
    title,
    status,
    severity,
    opened_at,
    rank,
    ts_headline('english', coalesce(summary, ''), query) AS snippet
FROM matched;
```

Properties:

1. Query parsing dilakukan sekali di CTE `q`.
2. Tenant filter wajib.
3. Status filter wajib.
4. FTS match memakai GIN index.
5. Ranking hanya untuk matched rows.
6. Headline hanya untuk limited rows.
7. Stable tie-breaker: `opened_at`, `id`.
8. Cocok untuk DTO, bukan entity hydration.

---

## 33. Relevance Tuning

Search relevance jarang benar dari awal.

Kamu perlu test corpus nyata.

Buat table test expectation:

```sql
CREATE TABLE search_relevance_test_case (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    query text NOT NULL,
    expected_case_id bigint NOT NULL,
    min_expected_rank int,
    notes text
);
```

Lalu buat evaluasi manual/otomatis:

```text
Query: "late payment"
Expected top results: cases about overdue payment violations

Query: "no action letter"
Expected: legal no-action letter cases, not generic action notes

Query: "ACME 2026-001"
Expected: exact case number / respondent name high rank
```

Relevance tuning bukan hanya SQL problem. Ini domain problem.

Hal yang bisa disesuaikan:

1. field weight,
2. configuration,
3. exact match boost,
4. trigram similarity boost,
5. recency boost,
6. severity boost,
7. status filter,
8. stop words/dictionary,
9. query rewriting.

---

## 34. When PostgreSQL FTS Is Enough

PostgreSQL FTS biasanya cukup jika:

1. Search berada di data transactional yang sama.
2. Volume masih dalam batas satu database/node yang sehat.
3. Query search relatif sederhana.
4. Ranking tidak perlu sangat canggih.
5. Bahasa/domain terbatas.
6. User internal/admin, bukan public web-scale search.
7. Latency target masuk akal.
8. Search harus konsisten dengan transaction.
9. Operasional simplicity lebih penting daripada fitur search canggih.
10. Team tidak ingin menambah sistem distributed search.

Contoh cocok:

```text
Cari case berdasarkan title/summary/respondent/note.
Cari ticket internal.
Cari audit event by description.
Cari document metadata.
Cari policy article internal.
Cari comments/notes dalam admin app.
```

---

## 35. When to Use Elasticsearch/OpenSearch Instead

Gunakan search engine khusus jika butuh:

1. Dataset search sangat besar dan distributed.
2. Relevance tuning kompleks.
3. Faceted search berat.
4. Autocomplete/suggestion canggih.
5. Typo tolerance kuat.
6. Synonym management kompleks.
7. Multi-language analysis serius.
8. Search atas dokumen sangat besar.
9. Highlighting kompleks.
10. Near-real-time indexing acceptable.
11. Analytics/search aggregation besar.
12. Search traffic tinggi dan perlu scale terpisah dari OLTP.

Tetapi ingat: external search engine menambah masalah:

1. dual-write,
2. eventual consistency,
3. reindex pipeline,
4. schema mapping berbeda,
5. operational cluster,
6. security duplication,
7. backup/restore terpisah,
8. incident class baru.

Keputusan bukan:

```text
PostgreSQL vs Elasticsearch
```

Keputusan yang lebih benar:

```text
Apakah search requirement cukup transactional/local/simple sehingga PostgreSQL cukup,
atau sudah menjadi dedicated search product dengan kebutuhan ranking/scale/analyzer yang kompleks?
```

---

## 36. Failure Modelling untuk FTS

### 36.1 Query Search Mendadak Lambat

Kemungkinan:

1. GIN index tidak dipakai.
2. Query expression tidak match index.
3. Search term terlalu umum.
4. Structured filter tidak selektif.
5. Ranking/headline terlalu mahal.
6. Statistics stale.
7. Tabel/index bloat.
8. Workload write-heavy membuat GIN maintenance berat.
9. Tenant besar mendominasi index.
10. Query user terlalu panjang/luas.

Runbook:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT ...;
```

Cek:

```sql
SELECT *
FROM pg_stat_user_indexes
WHERE relname = 'enforcement_case';
```

Cek slow query pattern di `pg_stat_statements`.

### 36.2 Search Tidak Menemukan Data yang Seharusnya Ada

Kemungkinan:

1. Configuration salah.
2. Stop word membuang term penting.
3. Stemming mengubah term tak terduga.
4. Search vector belum update.
5. Projection stale.
6. Permission filter mengecualikan row.
7. Query memakai `AND` terlalu ketat.
8. User mencari identifier yang tidak cocok untuk FTS.

Debug:

```sql
SELECT to_tsvector('english', :document);
SELECT websearch_to_tsquery('english', :query);
```

Bandingkan lexeme dokumen dan query.

### 36.3 Write Latency Naik Setelah Tambah FTS

Kemungkinan:

1. Generated `tsvector` mahal.
2. GIN index update mahal.
3. Banyak field sumber berubah sering.
4. Table update-heavy.
5. GIN pending list/maintenance pressure.
6. Vacuum tertinggal.

Solusi:

1. Kurangi field yang masuk search.
2. Pisahkan projection asynchronous.
3. Partial GIN index.
4. Avoid update field search bila tidak perlu.
5. Tune autovacuum untuk tabel.
6. Review write path.

### 36.4 Search Result Bocor Antar Tenant/User

Kemungkinan:

1. Tenant filter lupa.
2. ACL filter dilakukan di Java setelah search.
3. Search projection tidak membawa permission boundary.
4. Cache key tidak include tenant/user.
5. RLS tidak diterapkan atau tidak diuji.

Solusi:

1. Permission filter di SQL.
2. Test security query.
3. Cache key mencakup tenant/user/scope.
4. Audit search access.
5. Gunakan RLS bila model cocok.

---

## 37. Checklist Desain Full Text Search

Sebelum implementasi, jawab:

```text
Apa entity yang dicari?
```

```text
Field mana yang masuk document?
```

```text
Field mana yang exact identifier dan tidak boleh FTS?
```

```text
Bahasa/configuration apa yang dipakai?
```

```text
Apakah butuh stemming?
```

```text
Apakah butuh typo/fuzzy search?
```

```text
Apakah butuh highlight/snippet?
```

```text
Apakah hasil harus transactionally consistent?
```

```text
Apakah search document berasal dari satu tabel atau banyak tabel?
```

```text
Apakah generated column cukup atau perlu projection table?
```

```text
Apa permission boundary?
```

```text
Apa filter wajib? tenant/status/date?
```

```text
Apa order result? rank saja atau rank + recency/business priority?
```

```text
Berapa limit maksimal?
```

```text
Bagaimana mencegah expensive query dari input user?
```

```text
Bagaimana mengukur relevance?
```

```text
Bagaimana rebuild search projection/index?
```

```text
Apa runbook jika search lambat?
```

---

## 38. Reference Implementation Ringkas

### 38.1 Table

```sql
CREATE TABLE enforcement_case (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id       bigint NOT NULL,
    case_number     text NOT NULL,
    title           text NOT NULL,
    summary         text,
    respondent_name text,
    status          text NOT NULL,
    severity        text NOT NULL,
    opened_at       timestamptz NOT NULL DEFAULT now(),
    search_vector   tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(case_number, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(respondent_name, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(summary, '')), 'C')
    ) STORED
);
```

### 38.2 Indexes

```sql
CREATE INDEX enforcement_case_search_gin_idx
ON enforcement_case
USING GIN (search_vector);

CREATE INDEX enforcement_case_tenant_status_opened_idx
ON enforcement_case (tenant_id, status, opened_at DESC, id DESC);

CREATE UNIQUE INDEX enforcement_case_tenant_case_number_uq
ON enforcement_case (tenant_id, case_number);
```

### 38.3 Query

```sql
WITH q AS (
    SELECT websearch_to_tsquery('english', :search_query) AS query
), matched AS (
    SELECT
        c.id,
        c.case_number,
        c.title,
        c.summary,
        c.status,
        c.severity,
        c.opened_at,
        ts_rank_cd(c.search_vector, q.query) AS rank,
        q.query
    FROM enforcement_case c
    CROSS JOIN q
    WHERE c.tenant_id = :tenant_id
      AND c.status = ANY(:statuses)
      AND c.search_vector @@ q.query
    ORDER BY rank DESC, c.opened_at DESC, c.id DESC
    LIMIT :limit
)
SELECT
    id,
    case_number,
    title,
    status,
    severity,
    opened_at,
    rank,
    ts_headline('english', coalesce(summary, ''), query) AS snippet
FROM matched;
```

### 38.4 Guardrail di Aplikasi

```java
public record SearchRequest(
    long tenantId,
    String query,
    List<String> statuses,
    int limit
) {
    public SearchRequest {
        if (query == null || query.isBlank()) {
            throw new IllegalArgumentException("Search query is required");
        }
        if (query.length() > 200) {
            throw new IllegalArgumentException("Search query is too long");
        }
        if (limit < 1 || limit > 50) {
            throw new IllegalArgumentException("Invalid search limit");
        }
    }
}
```

Database search tetap butuh application guardrail.

---

## 39. Latihan

### Latihan 1 — Basic FTS

Buat tabel `article`:

```sql
CREATE TABLE article (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title text NOT NULL,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
```

Tambahkan generated `search_vector`, GIN index, dan query search.

### Latihan 2 — Weighted Search

Buat title memiliki weight `A`, body weight `C`.

Bandingkan ranking ketika kata yang sama muncul di title vs body.

### Latihan 3 — Case Search

Implementasikan search untuk `enforcement_case` dengan:

- tenant filter,
- status filter,
- ranking,
- snippet,
- limit.

Jalankan:

```sql
EXPLAIN (ANALYZE, BUFFERS)
```

Lihat apakah GIN index dipakai.

### Latihan 4 — FTS vs Trigram

Aktifkan `pg_trgm`, buat trigram index untuk `title`, dan bandingkan:

```sql
WHERE search_vector @@ websearch_to_tsquery(...)
```

vs

```sql
WHERE title % :q
```

Untuk typo dan substring.

### Latihan 5 — Projection Table

Buat search projection untuk case yang menggabungkan:

- case title,
- respondent name,
- violation names,
- latest note.

Tentukan bagaimana projection diupdate.

---

## 40. Ringkasan Mental Model

PostgreSQL Full Text Search bukan `LIKE` yang lebih cepat.

FTS adalah pipeline:

```text
raw text
  -> parse
  -> normalize
  -> lexeme
  -> tsvector
  -> tsquery
  -> @@ match
  -> rank
  -> optional headline
```

Desain yang baik memisahkan:

```text
identifier search
full-text search
fuzzy/trigram search
permission filter
business ranking
projection lifecycle
```

PostgreSQL FTS sangat kuat ketika search dekat dengan data transactional dan requirement masih dalam domain OLTP/internal search.

Tetapi begitu requirement berubah menjadi search product kompleks, external search engine bisa lebih masuk akal.

Engineer yang matang tidak bertanya:

```text
Search pakai PostgreSQL atau Elasticsearch?
```

Ia bertanya:

```text
Apa consistency requirement-nya?
Apa shape dokumennya?
Apa query behavior-nya?
Apa ranking expectation-nya?
Apa scale dan latency target-nya?
Apa cost operasional tambahan yang bisa diterima?
```

---

## 41. Koneksi ke Part Berikutnya

Part berikutnya adalah:

```text
Part 024 — Extensions: pg_stat_statements, pg_trgm, btree_gin, uuid, PostGIS, dan Ekosistem
```

Di Part 023 ini kita sudah menyentuh `pg_trgm` sebagai pendamping FTS. Di Part 024 kita akan membahas extension system PostgreSQL lebih luas: bagaimana extension memperluas database engine, apa risiko governance/security-nya, bagaimana memilih extension, dan bagaimana extension seperti `pg_stat_statements`, `pg_trgm`, `btree_gin`, `btree_gist`, `citext`, `uuid-ossp`, dan PostGIS masuk ke desain sistem produksi.

---

## Status Seri

Seri belum selesai.

Progress saat ini:

```text
Selesai: Part 000 sampai Part 023
Belum:   Part 024 sampai Part 034
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-022.md">⬅️ Part 022 — Stored Procedures, Functions, Triggers, dan Server-side Logic</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-024.md">Part 024 — Extensions: pg_stat_statements, pg_trgm, btree_gin, uuid, PostGIS, dan Ekosistem ➡️</a>
</div>
