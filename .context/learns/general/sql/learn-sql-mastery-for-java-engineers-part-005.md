# learn-sql-mastery-for-java-engineers-part-005.md

# Part 5 — Filtering Deep Dive: Predicates, Ranges, Pattern Matching, and Sargability

> Seri: SQL Mastery for Java Engineers  
> Bagian: 005 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-004.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-006.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas query dasar:

```sql
SELECT
FROM
WHERE
ORDER BY
LIMIT
```

Sekarang kita memperdalam bagian yang paling menentukan correctness dan performance query dasar: **filtering**.

Filtering di SQL terlihat sederhana:

```sql
WHERE status = 'OPEN'
```

Tapi di production, filter adalah titik temu antara:

- domain semantics
- tipe data
- `NULL`
- three-valued logic
- index usage
- selectivity
- authorization
- time range
- collation
- case sensitivity
- query planner
- Java parameter binding
- pagination
- multi-tenancy
- reporting correctness

Contoh:

```sql
SELECT
    id,
    case_number
FROM cases
WHERE lower(case_number) = lower(:case_number);
```

Query ini terlihat benar secara fungsional, tetapi bisa bermasalah secara performa jika tidak ada expression index.

Contoh lain:

```sql
WHERE opened_at BETWEEN :start AND :end
```

Terlihat natural, tetapi bisa salah untuk timestamp range jika `:end` adalah akhir tanggal yang inclusive.

Contoh lain:

```sql
WHERE id NOT IN (
    SELECT case_id FROM assignments
)
```

Bisa salah jika subquery menghasilkan `NULL`.

Contoh lain:

```sql
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
```

Bisa sangat performan atau sangat lambat tergantung index, selectivity, dan urutan kolom index.

Bagian ini bertujuan membuat kamu mampu menulis predicate yang:

1. benar secara semantik
2. aman terhadap `NULL`
3. stabil terhadap edge case
4. dapat memanfaatkan index
5. mudah direview
6. sesuai domain
7. cocok dengan parameter Java
8. tidak menutupi bug data model

---

## 1. Mental Model: WHERE adalah Predicate, Bukan If Statement Biasa

Dalam Java:

```java
if (case.status() == CaseStatus.OPEN) {
    result.add(case);
}
```

Dalam SQL:

```sql
WHERE status = 'OPEN'
```

Terlihat mirip, tetapi tidak sama.

SQL predicate memiliki karakteristik:

- dievaluasi terhadap tuple
- memakai three-valued logic: `TRUE`, `FALSE`, `UNKNOWN`
- hanya `TRUE` yang lolos `WHERE`
- optimizer boleh reorder predicate
- evaluation order tidak boleh diasumsikan untuk side effect
- predicate dapat dipushdown ke scan/index/join
- predicate dapat menggunakan statistics
- predicate bisa sargable atau tidak
- predicate bisa dipengaruhi collation/type conversion

Jangan berpikir `WHERE` seperti sequence of imperative checks.

Pikirkan:

> `WHERE` menyatakan kondisi kebenaran yang harus dipenuhi tuple agar menjadi bagian dari relation hasil.

---

## 2. Contoh Schema

Kita pakai schema domain regulatory/case-management.

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    jurisdiction_code TEXT NOT NULL,
    case_number TEXT NOT NULL,
    case_number_normalized TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    risk_score NUMERIC(5, 2),
    opened_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    assigned_officer_id UUID,

    CONSTRAINT uq_cases_tenant_case_number
    UNIQUE (tenant_id, case_number_normalized),

    CONSTRAINT ck_cases_status_valid
    CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED', 'CANCELLED')),

    CONSTRAINT ck_cases_priority_valid
    CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),

    CONSTRAINT ck_cases_risk_score_range
    CHECK (risk_score IS NULL OR (risk_score >= 0 AND risk_score <= 100)),

    CONSTRAINT ck_cases_time_order
    CHECK (closed_at IS NULL OR closed_at >= opened_at)
);
```

Potential indexes:

```sql
CREATE INDEX idx_cases_tenant_status_opened
ON cases (tenant_id, status, opened_at DESC, id DESC);

CREATE INDEX idx_cases_tenant_priority
ON cases (tenant_id, priority);

CREATE INDEX idx_cases_opened_at
ON cases (opened_at);

CREATE INDEX idx_cases_assigned_officer
ON cases (assigned_officer_id);

CREATE INDEX idx_cases_case_number_normalized
ON cases (tenant_id, case_number_normalized);
```

Index detail akan dibahas dalam part 015–018, tetapi part ini mulai membangun intuition.

---

## 3. Equality Predicate

Equality adalah predicate paling umum.

```sql
WHERE status = 'OPEN'
```

atau:

```sql
WHERE id = :case_id
```

### 3.1 Equality pada Key

```sql
SELECT
    id,
    case_number,
    status
FROM cases
WHERE id = :case_id;
```

Jika `id` primary key, expected cardinality:

```text
0 or 1 row
```

Ini predicate sangat selektif.

Java handling:

```text
0 row -> not found
1 row -> found
>1 row -> impossible; invariant broken
```

### 3.2 Equality pada Non-Key

```sql
WHERE status = 'OPEN'
```

Expected cardinality bisa besar.

Jika 70% case `OPEN`, predicate ini low-selectivity. Index pada `status` saja mungkin tidak berguna.

Jika 1% case `ESCALATED`, predicate:

```sql
WHERE status = 'ESCALATED'
```

mungkin selective.

Performance predicate tidak hanya bergantung pada operator, tetapi juga distribusi data.

### 3.3 Equality dan Type Matching

Buruk:

```sql
WHERE id::text = :case_id_text
```

Lebih baik:

```sql
WHERE id = :case_id_uuid
```

Java:

```java
ps.setObject(1, caseId); // UUID
```

bukan memaksa semua parameter menjadi string.

Type mismatch bisa:

- menyebabkan cast
- membuat index tidak dipakai
- menghasilkan plan buruk
- menimbulkan error vendor-specific
- membuat comparison semantics berubah

---

## 4. Inequality Predicate

Contoh:

```sql
WHERE status <> 'CLOSED'
```

atau:

```sql
WHERE risk_score > 80
```

### 4.1 Inequality dan NULL

```sql
WHERE status <> 'CLOSED'
```

Jika `status NULL`, hasil predicate:

```text
UNKNOWN
```

Row tidak lolos.

Jika maksudnya termasuk NULL:

```sql
WHERE status <> 'CLOSED'
   OR status IS NULL
```

Tapi lebih baik tanya: kenapa status nullable?

### 4.2 Inequality Biasanya Kurang Selektif

```sql
WHERE status <> 'CLOSED'
```

Jika sebagian besar status bukan closed, index mungkin kurang efektif.

Predicate negatif seperti:

```sql
<> 
!=
NOT
NOT LIKE
NOT IN
```

sering lebih sulit dioptimalkan daripada predicate positif.

Lebih baik jika domain memungkinkan:

```sql
WHERE status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED')
```

Selain lebih jelas, selectivity bisa lebih baik diperkirakan.

---

## 5. Comparison Predicate: `<`, `<=`, `>`, `>=`

Contoh:

```sql
WHERE opened_at >= :start_inclusive
```

```sql
WHERE risk_score >= 80
```

Comparison predicate sering cocok dengan B-tree index.

Contoh:

```sql
CREATE INDEX idx_cases_opened_at
ON cases (opened_at);
```

Query:

```sql
SELECT
    id,
    case_number,
    opened_at
FROM cases
WHERE opened_at >= TIMESTAMPTZ '2026-01-01 00:00:00+00';
```

Database bisa menggunakan index range scan jika planner menganggap menguntungkan.

### 5.1 Range dengan Lower dan Upper Bound

```sql
WHERE opened_at >= :start_inclusive
  AND opened_at <  :end_exclusive
```

Ini pattern utama untuk timestamp.

### 5.2 Range pada Numeric

```sql
WHERE risk_score >= 80
  AND risk_score <= 100
```

Jika `risk_score` nullable, row dengan `NULL` tidak lolos.

Jika risk_score belum calculated dan harus ditampilkan terpisah, query harus eksplisit:

```sql
WHERE risk_score IS NULL
   OR risk_score >= 80
```

Namun ini mengubah makna.

---

## 6. BETWEEN

`BETWEEN` bersifat inclusive di kedua sisi.

```sql
WHERE risk_score BETWEEN 80 AND 100
```

sama dengan:

```sql
WHERE risk_score >= 80
  AND risk_score <= 100
```

### 6.1 BETWEEN Cocok Untuk Domain Diskrit atau Date-only

Cocok:

```sql
WHERE filing_date BETWEEN DATE '2026-01-01' AND DATE '2026-01-31'
```

Karena `DATE` tidak punya time-of-day.

Cocok:

```sql
WHERE risk_score BETWEEN 80 AND 100
```

Jika 100 inclusive memang valid.

### 6.2 BETWEEN Berbahaya Untuk Timestamp Period

Risky:

```sql
WHERE opened_at BETWEEN TIMESTAMPTZ '2026-01-01 00:00:00+00'
                    AND TIMESTAMPTZ '2026-01-31 00:00:00+00'
```

Tidak mencakup semua 31 Januari.

Better:

```sql
WHERE opened_at >= TIMESTAMPTZ '2026-01-01 00:00:00+00'
  AND opened_at <  TIMESTAMPTZ '2026-02-01 00:00:00+00'
```

### 6.3 BETWEEN dan String

```sql
WHERE case_number BETWEEN 'C-100' AND 'C-200'
```

Ini lexicographic, bukan numeric-aware.

Hasil bisa mengejutkan:

```text
C-100
C-1000
C-101
...
C-2
```

Jika butuh range numeric, simpan numeric component terpisah.

---

## 7. IN Predicate

```sql
WHERE status IN ('OPEN', 'ESCALATED')
```

Lebih readable daripada:

```sql
WHERE status = 'OPEN'
   OR status = 'ESCALATED'
```

### 7.1 IN untuk Set Kecil

Cocok:

```sql
WHERE priority IN ('HIGH', 'CRITICAL')
```

### 7.2 IN dengan Parameter List dari Java

Dengan Spring/jOOQ/MyBatis, gunakan mekanisme parameterized list, jangan string concat.

Buruk:

```java
String sql = "WHERE status IN (" + statusesCsv + ")";
```

Risiko:

- SQL injection
- quoting bug
- empty list bug
- plan instability
- type mismatch

Gunakan library support:

- jOOQ `.in(statuses)`
- Spring NamedParameterJdbcTemplate `IN (:statuses)`
- temporary table untuk list besar
- array binding jika vendor mendukung
- table-valued parameter di SQL Server
- staging table untuk batch besar

### 7.3 Empty IN List

Apa arti:

```sql
WHERE status IN ()
```

Tidak valid di banyak database.

Jika list kosong, pilihan domain:

```text
return no rows
ignore filter
throw validation error
```

Jangan biarkan SQL generator menghasilkan syntax invalid.

Untuk “return no rows”:

```sql
WHERE 1 = 0
```

Atau handle di aplikasi sebelum query.

### 7.4 Large IN List

`IN` dengan ribuan value bisa bermasalah:

- SQL text besar
- parse cost
- plan cache buruk
- parameter limit
- network overhead
- optimizer estimation sulit

Alternatif:

- temporary table
- staging table
- join ke values table
- array parameter/vendor-specific
- table-valued parameter
- batch query

Contoh PostgreSQL-style with `VALUES`:

```sql
SELECT c.*
FROM cases c
JOIN (
    VALUES
        ('00000000-0000-0000-0000-000000000001'::uuid),
        ('00000000-0000-0000-0000-000000000002'::uuid)
) AS ids(id)
  ON ids.id = c.id;
```

Untuk ribuan data, temp table sering lebih baik.

---

## 8. NOT IN dan NULL Trap

Ini salah satu bug SQL klasik.

Risky:

```sql
SELECT
    c.id,
    c.case_number
FROM cases c
WHERE c.id NOT IN (
    SELECT assigned.case_id
    FROM case_assignments assigned
);
```

Jika subquery menghasilkan `NULL`, hasil bisa menjadi kosong/tidak sesuai.

Kenapa?

```sql
x NOT IN (1, 2, NULL)
```

sama dengan:

```sql
x <> 1 AND x <> 2 AND x <> NULL
```

`x <> NULL` adalah `UNKNOWN`.

Maka keseluruhan bisa `UNKNOWN`, bukan `TRUE`.

### 8.1 Gunakan NOT EXISTS

Lebih aman:

```sql
SELECT
    c.id,
    c.case_number
FROM cases c
WHERE NOT EXISTS (
    SELECT 1
    FROM case_assignments a
    WHERE a.case_id = c.id
);
```

### 8.2 NOT IN Masih Bisa Aman Jika Non-Nullable Dijamin

Jika subquery column `NOT NULL`, `NOT IN` bisa aman secara semantik.

Tetap, `NOT EXISTS` sering lebih jelas untuk anti-join.

---

## 9. EXISTS Predicate

`EXISTS` mengecek apakah subquery menghasilkan minimal satu row.

Contoh:

```sql
SELECT
    c.id,
    c.case_number
FROM cases c
WHERE EXISTS (
    SELECT 1
    FROM case_events e
    WHERE e.case_id = c.id
      AND e.event_type = 'ESCALATED'
);
```

Makna:

> Ambil case yang pernah punya event ESCALATED.

### 9.1 EXISTS untuk Existence, Bukan COUNT

Buruk:

```sql
WHERE (
    SELECT COUNT(*)
    FROM case_events e
    WHERE e.case_id = c.id
      AND e.event_type = 'ESCALATED'
) > 0
```

Lebih baik:

```sql
WHERE EXISTS (
    SELECT 1
    FROM case_events e
    WHERE e.case_id = c.id
      AND e.event_type = 'ESCALATED'
)
```

`EXISTS` bisa berhenti setelah menemukan satu row.

### 9.2 NOT EXISTS untuk Anti-Join

```sql
SELECT
    c.id,
    c.case_number
FROM cases c
WHERE NOT EXISTS (
    SELECT 1
    FROM case_assignments a
    WHERE a.case_id = c.id
      AND a.ended_at IS NULL
);
```

Makna:

> Case yang tidak punya active assignment.

Ini menjaga grain one row per case karena tidak join child row ke output.

---

## 10. LIKE Predicate

`LIKE` digunakan untuk pattern matching sederhana.

```sql
WHERE case_number LIKE 'CASE-2026-%'
```

Wildcard:

```text
% -> any sequence
_ -> single character
```

Contoh:

```sql
WHERE legal_name LIKE 'PT %'
```

### 10.1 Prefix Search

```sql
WHERE case_number LIKE 'CASE-2026-%'
```

Ini prefix search.

B-tree index bisa membantu di beberapa database/collation/operator class, tergantung vendor.

### 10.2 Contains Search

```sql
WHERE case_number LIKE '%2026%'
```

Leading wildcard biasanya tidak bisa memakai B-tree index biasa secara efektif.

Alternatif:

- full-text search
- trigram index, PostgreSQL-specific
- search engine seperti Elasticsearch/OpenSearch
- separate normalized search table
- prefix tokenization
- dedicated search service

### 10.3 Escaping Wildcards

Jika user input bisa mengandung `%` atau `_`, harus escape.

Misalnya user mencari literal:

```text
CASE_001
```

`_` di LIKE berarti satu karakter apa saja.

Gunakan escape sesuai vendor:

```sql
WHERE case_number LIKE :pattern ESCAPE '\'
```

Aplikasi harus membangun pattern dengan escaping benar.

---

## 11. ILIKE / Case-Insensitive Matching

PostgreSQL punya `ILIKE` untuk case-insensitive LIKE.

```sql
WHERE legal_name ILIKE 'pt %'
```

Vendor lain punya pendekatan berbeda:

- collation case-insensitive
- lower/upper function
- generated normalized column
- full-text index
- specific operator/type

### 11.1 lower(column) Pattern

```sql
WHERE lower(legal_name) LIKE lower(:pattern)
```

Masalah: function pada column dapat menghambat index biasa.

Solusi PostgreSQL expression index:

```sql
CREATE INDEX idx_parties_lower_legal_name
ON parties (lower(legal_name));
```

Atau simpan normalized column:

```sql
legal_name_normalized TEXT NOT NULL
```

dan query:

```sql
WHERE legal_name_normalized LIKE :normalized_pattern
```

---

## 12. Regex Predicate

Beberapa database mendukung regex.

PostgreSQL:

```sql
WHERE case_number ~ '^CASE-[0-9]{4}-[0-9]+$'
```

Regex berguna untuk:

- validation
- ad-hoc cleanup
- pattern search kompleks

Tapi hati-hati:

- bisa mahal
- index support terbatas
- regex dari user bisa menyebabkan performance issue
- syntax vendor-specific
- collation/case rules bisa berbeda

Untuk validation domain, lebih baik check constraint jika pattern stabil:

```sql
CHECK (case_number ~ '^CASE-[0-9]{4}-[0-9]+$')
```

Vendor-specific, tapi kuat.

---

## 13. IS NULL / IS NOT NULL

```sql
WHERE assigned_officer_id IS NULL
```

Makna:

> case belum punya assigned officer, jika model memang menggunakan NULL untuk unassigned.

Tetapi hati-hati: nullable FK sebagai state sering kalah ekspresif dibanding assignment table historis.

```sql
WHERE closed_at IS NULL
```

Makna umum:

> case belum closed.

Pastikan konsisten dengan status.

Jika status `CLOSED`, `closed_at` harus non-null.

Constraint:

```sql
CHECK (
    (status = 'CLOSED' AND closed_at IS NOT NULL)
    OR
    (status <> 'CLOSED')
)
```

---

## 14. IS DISTINCT FROM

Beberapa database mendukung null-safe comparison.

PostgreSQL:

```sql
WHERE value IS DISTINCT FROM :value
```

Ini memperlakukan `NULL` sebagai comparable.

Truth:

```text
NULL IS DISTINCT FROM NULL -> FALSE
NULL IS DISTINCT FROM 1    -> TRUE
1 IS DISTINCT FROM 1       -> FALSE
1 IS DISTINCT FROM 2       -> TRUE
```

Berguna untuk change detection.

Contoh:

```sql
UPDATE cases
SET priority = :new_priority
WHERE id = :case_id
  AND priority IS DISTINCT FROM :new_priority;
```

Ini update hanya jika value benar-benar berubah, termasuk null-safe.

Vendor support berbeda.

---

## 15. Boolean Predicate

Jika column boolean:

```sql
WHERE active = TRUE
```

atau:

```sql
WHERE active
```

Tergantung style/vendor.

Untuk nullable boolean:

```sql
WHERE active = TRUE
```

tidak sama dengan:

```sql
WHERE active IS NOT FALSE
```

Karena `NULL`.

Jika active nullable:

```text
TRUE
FALSE
NULL
```

Apa arti NULL?

Lebih baik hindari nullable boolean kecuali tiga state memang valid.

---

## 16. Predicate on Derived Expressions

Contoh:

```sql
WHERE closed_at - opened_at > INTERVAL '30 days'
```

Semantik jelas, tetapi index pada `closed_at` atau `opened_at` mungkin tidak langsung membantu.

Jika sering dibutuhkan, opsi:

- generated column
- materialized view
- expression index
- precomputed duration
- report table

Contoh generated/precomputed concept:

```sql
case_duration_days INTEGER
```

Namun precomputed value harus dijaga konsisten.

Jangan materialize semua hal terlalu dini. Ukur workload.

---

## 17. Sargability: Konsep Kunci Filtering Performance

Sargability berasal dari istilah “Search ARGument ABLE”.

Sederhananya:

> Predicate sargable adalah predicate yang memungkinkan database menggunakan access path seperti index secara efektif.

Contoh sargable:

```sql
WHERE opened_at >= :start
  AND opened_at < :end
```

Dengan index:

```sql
CREATE INDEX idx_cases_opened_at
ON cases (opened_at);
```

Contoh kurang sargable:

```sql
WHERE DATE(opened_at) = :date
```

Karena fungsi diterapkan ke column.

Database harus menghitung `DATE(opened_at)` untuk banyak row, kecuali ada expression index.

---

## 18. Sargable vs Non-Sargable Examples

### 18.1 Date Filtering

Non-sargable:

```sql
WHERE CAST(opened_at AS DATE) = DATE '2026-01-01'
```

Sargable:

```sql
WHERE opened_at >= TIMESTAMPTZ '2026-01-01 00:00:00+00'
  AND opened_at <  TIMESTAMPTZ '2026-01-02 00:00:00+00'
```

### 18.2 Case-Insensitive Search

Potentially non-sargable:

```sql
WHERE lower(email) = lower(:email)
```

Sargable with normalized column:

```sql
WHERE email_normalized = :email_normalized
```

or with expression index:

```sql
CREATE INDEX idx_users_lower_email
ON users (lower(email));
```

### 18.3 Math on Column

Non-sargable:

```sql
WHERE risk_score + 10 >= 90
```

Sargable equivalent:

```sql
WHERE risk_score >= 80
```

### 18.4 Function on Column

Non-sargable:

```sql
WHERE extract(year from opened_at) = 2026
```

Sargable:

```sql
WHERE opened_at >= TIMESTAMPTZ '2026-01-01 00:00:00+00'
  AND opened_at <  TIMESTAMPTZ '2027-01-01 00:00:00+00'
```

### 18.5 Leading Wildcard

Often non-sargable with B-tree:

```sql
WHERE case_number LIKE '%2026%'
```

Sargable/prefix-friendly:

```sql
WHERE case_number LIKE 'CASE-2026-%'
```

depending on database/collation/index support.

---

## 19. Predicate Simplification

Terkadang predicate bisa ditulis lebih sederhana dan lebih sargable.

Buruk:

```sql
WHERE NOT (status <> 'OPEN')
```

Lebih baik:

```sql
WHERE status = 'OPEN'
```

Buruk:

```sql
WHERE risk_score + 5 > 85
```

Lebih baik:

```sql
WHERE risk_score > 80
```

Buruk:

```sql
WHERE COALESCE(priority, 'NORMAL') = 'HIGH'
```

Jika priority seharusnya not null:

```sql
priority TEXT NOT NULL
```

Lalu:

```sql
WHERE priority = 'HIGH'
```

Jika `NULL` punya arti domain, tulis eksplisit.

---

## 20. Predicate and Index Column Order

Misalnya index:

```sql
CREATE INDEX idx_cases_tenant_status_opened
ON cases (tenant_id, status, opened_at DESC);
```

Query cocok:

```sql
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
ORDER BY opened_at DESC
LIMIT 50
```

Karena equality pada leading columns lalu order/range pada berikutnya.

Query kurang cocok:

```sql
WHERE status = 'OPEN'
ORDER BY opened_at DESC
```

Karena leading column `tenant_id` tidak difilter.

Index composite mengikuti left-prefix principle, meskipun optimizer vendor bisa punya kemampuan tambahan seperti skip scan di beberapa database.

Detail index akan dibahas di part 015.

Intuisi untuk sekarang:

> Predicate dan ORDER BY harus dipikirkan bersama index, terutama pada query list/search utama.

---

## 21. Selectivity

Selectivity adalah seberapa banyak row yang lolos filter.

Predicate highly selective:

```sql
WHERE id = :id
```

Mungkin 1 dari jutaan.

Predicate low selective:

```sql
WHERE status = 'OPEN'
```

Jika 80% row open.

Index paling berguna saat predicate cukup selective atau membantu ordering/limit.

Contoh:

```sql
WHERE status = 'OPEN'
ORDER BY opened_at DESC
LIMIT 50
```

Walaupun `status = 'OPEN'` low selective, index `(status, opened_at DESC)` bisa tetap berguna karena database dapat mengambil 50 terbaru tanpa sort seluruh row.

---

## 22. Filter Authorization dan Performance

Multi-tenant/regulatory query biasanya punya mandatory scope.

```sql
WHERE tenant_id = :tenant_id
  AND jurisdiction_code = :jurisdiction_code
  AND status = 'OPEN'
```

Index harus mempertimbangkan scope ini.

Potential index:

```sql
CREATE INDEX idx_cases_tenant_jurisdiction_status_opened
ON cases (tenant_id, jurisdiction_code, status, opened_at DESC, id DESC);
```

Jika semua query selalu tenant-scoped, `tenant_id` hampir selalu leading column.

Security predicate bukan hanya correctness. Ia juga bagian dari access path.

---

## 23. Optional Filters dalam Search API

Search API sering punya filter opsional:

```text
status optional
priority optional
assignedOfficer optional
openedFrom optional
openedTo optional
keyword optional
```

Naive SQL:

```sql
WHERE (:status IS NULL OR status = :status)
  AND (:priority IS NULL OR priority = :priority)
  AND (:assigned_officer_id IS NULL OR assigned_officer_id = :assigned_officer_id)
```

Ini mudah, tetapi bisa membuat optimizer sulit memilih index karena predicate penuh OR dan parameter-dependent.

Alternatif:

1. dynamic SQL aman dengan parameter binding
2. query builder seperti jOOQ
3. beberapa query khusus untuk filter umum
4. search table/read model
5. partial indexes untuk common cases

Dynamic SQL aman:

```java
List<String> predicates = new ArrayList<>();
MapSqlParameterSource params = new MapSqlParameterSource();

predicates.add("tenant_id = :tenantId");
params.addValue("tenantId", tenantId);

if (status != null) {
    predicates.add("status = :status");
    params.addValue("status", status.name());
}

if (priority != null) {
    predicates.add("priority = :priority");
    params.addValue("priority", priority.name());
}
```

Jangan dynamic SQL dengan string input mentah.

---

## 24. OR Predicate

`OR` bisa membuat index usage lebih kompleks.

Contoh:

```sql
WHERE status = 'OPEN'
   OR priority = 'CRITICAL'
```

Makna jelas:

> Case open atau critical.

Performance bisa bervariasi:

- bitmap OR index scan
- full scan
- union plan
- predicate expansion

Kadang lebih baik split:

```sql
SELECT id, case_number
FROM cases
WHERE status = 'OPEN'

UNION

SELECT id, case_number
FROM cases
WHERE priority = 'CRITICAL';
```

Tapi ini hanya lebih baik jika didukung data/index dan hasil set semantics sesuai.

Jangan rewrite tanpa measurement.

### 24.1 OR dengan Tenant Scope

Buruk karena scope bisa salah:

```sql
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
   OR priority = 'CRITICAL'
```

Karena precedence:

```text
(tenant_id = :tenant_id AND status = 'OPEN')
OR priority = 'CRITICAL'
```

Ini bisa membocorkan data tenant lain.

Benar:

```sql
WHERE tenant_id = :tenant_id
  AND (
      status = 'OPEN'
      OR priority = 'CRITICAL'
  )
```

Security bug sering muncul dari parentheses yang hilang.

---

## 25. Filtering Text: Normalization Strategy

Untuk identifier/searchable text, tentukan strategi.

### 25.1 Case Number

Input user:

```text
case-2026-001
CASE-2026-001
 Case-2026-001 
```

Jika domain case-insensitive, simpan normalized:

```sql
case_number TEXT NOT NULL,
case_number_normalized TEXT NOT NULL
```

Constraint:

```sql
UNIQUE (tenant_id, case_number_normalized)
```

Query:

```sql
WHERE tenant_id = :tenant_id
  AND case_number_normalized = :case_number_normalized
```

Java normalization harus konsisten:

```text
trim
uppercase/lowercase
collapse spaces?
remove separators?
unicode normalization?
```

Pilih sesuai domain.

### 25.2 Legal Name Search

Legal name search lebih kompleks:

- case sensitivity
- punctuation
- abbreviation
- whitespace
- aliases
- transliteration
- accent sensitivity
- company suffix

SQL `LIKE` mungkin tidak cukup. Pertimbangkan:

- full-text search
- trigram
- search service
- normalized search tokens
- party alias table

---

## 26. Filtering JSON

Contoh PostgreSQL-style:

```sql
WHERE payload ->> 'eventType' = 'CASE_ESCALATED'
```

Jika sering dipakai, ini tanda `event_type` sebaiknya column.

Better hybrid:

```sql
event_type TEXT NOT NULL,
payload JSONB NOT NULL
```

Query:

```sql
WHERE event_type = 'CASE_ESCALATED'
```

JSON filter bisa diindex dengan fitur khusus, tetapi:

- vendor-specific
- statistics bisa terbatas
- constraint lebih sulit
- query readability turun
- schema drift rawan

Gunakan JSON untuk fleksibilitas, bukan untuk core predicate utama tanpa alasan kuat.

---

## 27. Filtering with Timezone and Business Date

Query:

```sql
WHERE opened_at >= :start
  AND opened_at < :end
```

Ini benar untuk instant range.

Namun business question sering berbunyi:

> case yang dibuka pada tanggal 2026-01-01 waktu Jakarta.

Maka aplikasi harus mengubah local date range ke instant range.

Jakarta offset saat ini UTC+07 tanpa DST.

Konseptual:

```text
2026-01-01T00:00:00 Asia/Jakarta
to
2026-01-02T00:00:00 Asia/Jakarta
```

diubah ke UTC instant:

```text
2025-12-31T17:00:00Z
to
2026-01-01T17:00:00Z
```

Query:

```sql
WHERE opened_at >= TIMESTAMPTZ '2025-12-31 17:00:00+00'
  AND opened_at <  TIMESTAMPTZ '2026-01-01 17:00:00+00'
```

Jangan cast timestamp ke date di database tanpa sadar timezone.

---

## 28. Filtering Current State vs History

Current state table:

```sql
WHERE status = 'ESCALATED'
```

History table:

```sql
WHERE event_type = 'ESCALATED'
```

Business question berbeda:

1. Case yang saat ini escalated.
2. Case yang pernah escalated.
3. Case yang pertama kali escalated dalam periode tertentu.
4. Case yang escalated lebih dari dua kali.
5. Case yang escalated lalu closed.

Predicate harus mengikuti pertanyaan.

Contoh current:

```sql
SELECT id
FROM cases
WHERE status = 'ESCALATED';
```

Contoh ever escalated:

```sql
SELECT c.id
FROM cases c
WHERE EXISTS (
    SELECT 1
    FROM case_status_transitions t
    WHERE t.case_id = c.id
      AND t.to_status = 'ESCALATED'
);
```

Contoh escalated in period:

```sql
SELECT DISTINCT t.case_id
FROM case_status_transitions t
WHERE t.to_status = 'ESCALATED'
  AND t.transitioned_at >= :start
  AND t.transitioned_at < :end;
```

`DISTINCT` di sini bisa valid karena output grain one row per case, sementara transitions grain one row per transition.

---

## 29. Filtering Active Rows

Common pattern:

```sql
WHERE ended_at IS NULL
```

Makna:

```text
active row
```

Contoh:

```sql
SELECT
    case_id,
    officer_id
FROM case_assignments
WHERE ended_at IS NULL;
```

Jika active row sering dicari, partial index berguna di PostgreSQL:

```sql
CREATE INDEX idx_case_assignments_active
ON case_assignments (case_id)
WHERE ended_at IS NULL;
```

Untuk invariant one active primary assignment:

```sql
CREATE UNIQUE INDEX uq_case_assignments_one_active_primary
ON case_assignments (case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

Filtering dan constraint saling terkait.

---

## 30. Filtering Soft-Deleted Rows

Soft delete:

```sql
deleted_at TIMESTAMPTZ
```

Query active:

```sql
WHERE deleted_at IS NULL
```

Risiko:

- lupa filter, deleted row muncul
- unique constraint harus partial
- index harus partial
- report harus jelas include/exclude deleted
- legal retention tetap perlu hard purge/anonymization

PostgreSQL-style partial unique:

```sql
CREATE UNIQUE INDEX uq_cases_active_case_number
ON cases (tenant_id, case_number_normalized)
WHERE deleted_at IS NULL;
```

Pertanyaan domain:

```text
Jika case soft-deleted, boleh create case_number sama lagi?
Apakah audit tetap refer ke row lama?
Apakah deleted row visible ke admin?
```

---

## 31. Filtering and Constraint Alignment

Jika query mengasumsikan:

```sql
WHERE status = 'OPEN'
```

maka database harus menjaga status valid.

Jika query mengasumsikan active assignment:

```sql
WHERE ended_at IS NULL
```

maka desain harus menjelaskan `NULL` berarti active.

Jika query mengasumsikan one active primary:

```sql
LEFT JOIN active_primary_assignment
```

maka constraint harus mencegah lebih dari satu active primary.

Top 1% SQL engineer menyelaraskan:

```text
predicate
constraint
index
domain rule
Java model
test data
monitoring
```

---

## 32. Common Filtering Bugs

### Bug 1 — `= NULL`

```sql
WHERE closed_at = NULL
```

Tidak benar. Gunakan:

```sql
WHERE closed_at IS NULL
```

### Bug 2 — `NOT IN` dengan NULL

Gunakan `NOT EXISTS`.

### Bug 3 — Date Range Inclusive Salah

Gunakan `[start, end)`.

### Bug 4 — OR Tanpa Parentheses

Bisa menyebabkan security leak.

### Bug 5 — Function pada Column

```sql
WHERE DATE(opened_at) = :date
```

Menghambat index dan timezone ambiguity.

### Bug 6 — Implicit Cast

```sql
WHERE id = '123'
```

Padahal `id` numeric/uuid.

### Bug 7 — Leading Wildcard LIKE

```sql
LIKE '%abc%'
```

Tidak cocok dengan B-tree biasa.

### Bug 8 — Optional Filter dengan OR Semua

```sql
(:param IS NULL OR col = :param)
```

Mudah tapi bisa buruk untuk optimizer.

### Bug 9 — Filtering Child Table Mengubah Grain

```sql
SELECT c.*
FROM cases c
JOIN assignments a ON a.case_id = c.id
WHERE a.ended_at IS NULL;
```

Jika lebih dari satu active assignment, case duplicate. Gunakan constraint atau `EXISTS`.

### Bug 10 — DISTINCT Menutupi Predicate/Join Bug

```sql
SELECT DISTINCT c.*
```

Jangan langsung pakai. Cari penyebab duplicate.

---

## 33. Mini Case Study: Search Case by Case Number

### 33.1 Requirement

> User mencari case number. Input bisa lowercase/uppercase dan ada spasi sekitar.

### 33.2 Bad Query

```sql
SELECT
    id,
    case_number,
    status
FROM cases
WHERE lower(case_number) = lower(:input);
```

Masalah:

- function pada column
- tidak tenant-scoped
- tidak jelas normalization
- possible full scan
- duplicate antar tenant

### 33.3 Better Design

Schema:

```sql
case_number TEXT NOT NULL,
case_number_normalized TEXT NOT NULL,
UNIQUE (tenant_id, case_number_normalized)
```

Query:

```sql
SELECT
    id,
    case_number,
    status
FROM cases
WHERE tenant_id = :tenant_id
  AND case_number_normalized = :case_number_normalized;
```

Java:

```text
normalize input:
trim
uppercase
domain-specific formatting
```

Index:

```sql
CREATE UNIQUE INDEX uq_cases_tenant_case_number_normalized
ON cases (tenant_id, case_number_normalized);
```

---

## 34. Mini Case Study: Open Case Queue

Requirement:

> Tampilkan 50 open cases terbaru untuk tenant tertentu.

Query:

```sql
SELECT
    id,
    case_number,
    priority,
    opened_at
FROM cases
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
ORDER BY opened_at DESC, id DESC
LIMIT 50;
```

Potential index:

```sql
CREATE INDEX idx_cases_tenant_status_opened_id
ON cases (tenant_id, status, opened_at DESC, id DESC);
```

Kenapa bagus:

- tenant filter leading
- status equality
- order by cocok
- limit bisa berhenti cepat

Tambahan:

Jika hanya open cases yang sering diakses, PostgreSQL partial index:

```sql
CREATE INDEX idx_cases_open_queue
ON cases (tenant_id, opened_at DESC, id DESC)
WHERE status = 'OPEN';
```

Trade-off:

- lebih kecil
- lebih fokus
- vendor-specific
- hanya membantu query dengan predicate status OPEN

---

## 35. Mini Case Study: Cases Without Active Assignment

Requirement:

> Tampilkan open cases yang belum punya active primary assignment.

Risky join:

```sql
SELECT
    c.id,
    c.case_number
FROM cases c
LEFT JOIN case_assignments a
  ON a.case_id = c.id
WHERE c.status = 'OPEN'
  AND a.ended_at IS NULL;
```

Masalah:

- row tanpa assignment memiliki `a.ended_at NULL`, sehingga lolos
- row dengan active assignment juga lolos
- predicate tidak membedakan absence vs active
- jika assignment historis ada, bisa salah

Better anti-join:

```sql
SELECT
    c.id,
    c.case_number
FROM cases c
WHERE c.status = 'OPEN'
  AND NOT EXISTS (
      SELECT 1
      FROM case_assignments a
      WHERE a.case_id = c.id
        AND a.assignment_role = 'PRIMARY'
        AND a.ended_at IS NULL
  );
```

Makna jelas:

> Tidak ada active primary assignment.

Potential index:

```sql
CREATE INDEX idx_case_assignments_active_primary_case
ON case_assignments (case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

---

## 36. Mini Case Study: Monthly Regulatory Report

Requirement:

> Semua case yang dibuka selama Januari 2026 berdasarkan timezone Asia/Jakarta.

Application computes:

```text
start = 2026-01-01T00:00:00+07
end   = 2026-02-01T00:00:00+07
```

Converted to UTC:

```text
start = 2025-12-31T17:00:00Z
end   = 2026-01-31T17:00:00Z
```

Query:

```sql
SELECT
    id,
    case_number,
    opened_at
FROM cases
WHERE opened_at >= :start_inclusive
  AND opened_at <  :end_exclusive
ORDER BY opened_at ASC, id ASC;
```

Avoid:

```sql
WHERE DATE(opened_at) BETWEEN DATE '2026-01-01' AND DATE '2026-01-31'
```

because timezone and sargability issues.

---

## 37. Mini Case Study: Optional Search Filters

Requirement:

> Search cases by tenant, optional status, optional priority, optional assigned officer.

Better dynamic predicate approach:

Base:

```sql
SELECT
    id,
    case_number,
    status,
    priority,
    assigned_officer_id,
    opened_at
FROM cases
WHERE tenant_id = :tenant_id
```

Add only provided filters:

```sql
AND status = :status
```

```sql
AND priority = :priority
```

```sql
AND assigned_officer_id = :assigned_officer_id
```

Final example:

```sql
SELECT
    id,
    case_number,
    status,
    priority,
    assigned_officer_id,
    opened_at
FROM cases
WHERE tenant_id = :tenant_id
  AND status = :status
  AND priority = :priority
ORDER BY opened_at DESC, id DESC
LIMIT :limit;
```

Avoid one-size-fits-all:

```sql
WHERE tenant_id = :tenant_id
  AND (:status IS NULL OR status = :status)
  AND (:priority IS NULL OR priority = :priority)
  AND (:assigned_officer_id IS NULL OR assigned_officer_id = :assigned_officer_id)
```

This can be acceptable for small systems, but should be reviewed when performance matters.

---

## 38. Java Integration Patterns

### 38.1 Use Typed Parameters

UUID:

```java
params.addValue("caseId", caseId);
```

Timestamp:

```java
params.addValue("startInclusive", Timestamp.from(startInstant));
```

Decimal:

```java
params.addValue("minRiskScore", new BigDecimal("80.00"));
```

Avoid passing everything as string.

### 38.2 Normalize Before Query

```java
String normalizedCaseNumber = normalizeCaseNumber(input);
```

Then:

```sql
WHERE case_number_normalized = :normalizedCaseNumber
```

### 38.3 Validate Filter Semantics

If status list empty:

```text
return empty result
```

or:

```text
reject request
```

Do not generate invalid SQL.

### 38.4 Cap Limit

```java
int limit = Math.min(requestedLimit, 100);
```

Never allow arbitrary large limit.

### 38.5 Keep Cursor and Filter Coupled

Cursor from keyset pagination is valid only for same filter/sort.

Cursor should encode:

- last sort key
- filter hash/version
- direction
- maybe tenant scope
- expiry/signature if exposed externally

---

## 39. Filtering Review Checklist

```text
[ ] Apa grain query?
[ ] Predicate domain-nya jelas?
[ ] Apakah filter mandatory authorization/tenant/jurisdiction ada?
[ ] Apakah NULL ditangani benar?
[ ] Apakah NOT IN aman dari NULL?
[ ] Apakah date range memakai [start, end)?
[ ] Apakah timestamp timezone sudah benar?
[ ] Apakah parameter type cocok dengan column?
[ ] Apakah ada function/cast pada column?
[ ] Apakah predicate sargable?
[ ] Apakah LIKE memakai leading wildcard?
[ ] Apakah user wildcard di-escape?
[ ] Apakah OR diberi parentheses?
[ ] Apakah optional filter dibuat dengan aman?
[ ] Apakah index mendukung filter utama?
[ ] Apakah selectivity masuk akal?
[ ] Apakah DISTINCT dipakai untuk alasan benar?
[ ] Apakah query mengubah grain lewat join?
```

---

## 40. Predicate Design Checklist

Untuk setiap predicate:

```text
[ ] Apakah predicate positif lebih baik daripada negatif?
[ ] Apakah equality/range sesuai tipe data?
[ ] Apakah predicate mencerminkan business question?
[ ] Apakah absence of row lebih cocok dimodelkan dengan NOT EXISTS?
[ ] Apakah current vs historical state dibedakan?
[ ] Apakah active row definition jelas?
[ ] Apakah soft delete difilter konsisten?
[ ] Apakah collation/case sensitivity sesuai domain?
[ ] Apakah normalization dilakukan sekali dan konsisten?
[ ] Apakah predicate didukung constraint?
```

---

## 41. Performance Investigation Checklist

Jika filter lambat:

```text
[ ] Berapa row total table?
[ ] Berapa row yang lolos predicate?
[ ] Apakah statistics up-to-date?
[ ] Apakah index yang relevan ada?
[ ] Apakah predicate memakai function/cast pada column?
[ ] Apakah parameter type menyebabkan implicit cast?
[ ] Apakah filter low-selectivity?
[ ] Apakah ORDER BY + LIMIT bisa dibantu index?
[ ] Apakah OR membuat plan buruk?
[ ] Apakah IN list terlalu besar?
[ ] Apakah query tenant-scoped?
[ ] Apakah read model lebih cocok?
[ ] Apakah full-text/search engine lebih cocok?
```

---

## 42. Latihan

### Latihan 1 — Perbaiki Date Filter

Buruk:

```sql
WHERE DATE(opened_at) = DATE '2026-01-01'
```

Lebih baik:

```sql
WHERE opened_at >= TIMESTAMPTZ '2026-01-01 00:00:00+00'
  AND opened_at <  TIMESTAMPTZ '2026-01-02 00:00:00+00'
```

Jika business date Jakarta, ubah local date ke UTC range di aplikasi.

### Latihan 2 — Perbaiki NOT IN

Buruk:

```sql
WHERE id NOT IN (
    SELECT case_id
    FROM case_assignments
)
```

Lebih aman:

```sql
WHERE NOT EXISTS (
    SELECT 1
    FROM case_assignments a
    WHERE a.case_id = cases.id
)
```

### Latihan 3 — Perbaiki OR Scope

Buruk:

```sql
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
   OR priority = 'CRITICAL'
```

Benar:

```sql
WHERE tenant_id = :tenant_id
  AND (
      status = 'OPEN'
      OR priority = 'CRITICAL'
  )
```

### Latihan 4 — Perbaiki Case-Insensitive Search

Buruk:

```sql
WHERE lower(case_number) = lower(:input)
```

Lebih baik:

```sql
WHERE tenant_id = :tenant_id
  AND case_number_normalized = :normalized_input
```

dengan unique/index:

```sql
CREATE UNIQUE INDEX uq_cases_tenant_case_number_normalized
ON cases (tenant_id, case_number_normalized);
```

### Latihan 5 — Identify Sargability Problem

Query:

```sql
SELECT *
FROM cases
WHERE extract(year from opened_at) = 2026;
```

Masalah:

- function pada column
- kemungkinan tidak memakai index `opened_at`
- timezone ambiguity

Better:

```sql
WHERE opened_at >= TIMESTAMPTZ '2026-01-01 00:00:00+00'
  AND opened_at <  TIMESTAMPTZ '2027-01-01 00:00:00+00'
```

---

## 43. Koneksi ke Part Berikutnya

Part ini memperdalam filtering dan predicate.

Part berikutnya, `part-006`, akan membahas **joins from first principles**.

Kenapa filtering harus dipahami sebelum join?

Karena join sebenarnya juga predicate:

```sql
JOIN assignments a ON a.case_id = c.id
```

`ON a.case_id = c.id` adalah predicate yang menentukan kombinasi tuple mana yang valid.

Banyak bug join berasal dari filter yang salah tempat:

- filter di `WHERE` padahal harus di `ON`
- `LEFT JOIN` berubah menjadi `INNER JOIN`
- filter child table menggandakan parent
- predicate join tidak lengkap
- nullable relationship tidak dipahami
- anti-join salah pakai `NOT IN`

Dengan memahami predicate, kita siap memahami join secara benar.

---

## 44. Ringkasan Bagian Ini

Hal penting dari part 005:

1. `WHERE` adalah predicate terhadap tuple.
2. SQL predicate memakai three-valued logic.
3. Equality pada key berbeda karakteristiknya dari equality pada low-cardinality column.
4. Type matching penting untuk correctness dan index usage.
5. `BETWEEN` inclusive; hati-hati untuk timestamp.
6. Gunakan `[start, end)` untuk time range.
7. `IN` bagus untuk set kecil, tapi perlu handling empty/large list.
8. `NOT IN` berbahaya jika ada `NULL`; gunakan `NOT EXISTS`.
9. `EXISTS` cocok untuk existence check.
10. `LIKE 'prefix%'` berbeda dari `LIKE '%contains%'`.
11. Case-insensitive search perlu strategy: collation, normalized column, atau expression index.
12. Function/cast pada column sering membuat predicate non-sargable.
13. Sargability adalah kemampuan predicate memakai access path seperti index.
14. `OR` harus hati-hati, terutama dengan tenant/security predicate.
15. Optional filter sederhana bisa menyulitkan optimizer.
16. JSON filter sebaiknya tidak menjadi core predicate tanpa alasan kuat.
17. Timezone harus diselesaikan sebelum filtering timestamp.
18. Current state dan historical state membutuhkan predicate berbeda.
19. Soft delete dan active row harus difilter konsisten.
20. Predicate harus selaras dengan constraint, index, Java model, dan domain rule.

Kalimat inti:

> Filtering yang baik bukan hanya memilih row yang benar hari ini; ia mengekspresikan predicate domain yang jelas, aman terhadap NULL dan timezone, serta dapat dieksekusi database secara efisien pada data production.

---

## 45. Referensi

1. PostgreSQL Documentation — Comparison Functions and Operators.  
   https://www.postgresql.org/docs/current/functions-comparison.html

2. PostgreSQL Documentation — Pattern Matching.  
   https://www.postgresql.org/docs/current/functions-matching.html

3. PostgreSQL Documentation — Indexes and Operator Classes.  
   https://www.postgresql.org/docs/current/indexes-opclass.html

4. PostgreSQL Documentation — Partial Indexes.  
   https://www.postgresql.org/docs/current/indexes-partial.html

5. PostgreSQL Documentation — Expression Indexes.  
   https://www.postgresql.org/docs/current/indexes-expressional.html

6. PostgreSQL Documentation — Row and Array Comparisons.  
   https://www.postgresql.org/docs/current/functions-comparisons.html

7. MySQL 8.4 Reference Manual — Comparison Functions and Operators.  
   https://dev.mysql.com/doc/refman/8.4/en/comparison-operators.html

8. MySQL 8.4 Reference Manual — Pattern Matching.  
   https://dev.mysql.com/doc/refman/8.4/en/pattern-matching.html

9. SQL Server Documentation — Search Condition.  
   https://learn.microsoft.com/en-us/sql/t-sql/queries/search-condition-transact-sql

10. Oracle Database SQL Language Reference — Conditions.  
    https://docs.oracle.com/en/database/oracle/oracle-database/23/sqlrf/Conditions.html

---

## 46. Status Seri

Seri belum selesai.

Bagian selesai:

- `learn-sql-mastery-for-java-engineers-part-000.md`
- `learn-sql-mastery-for-java-engineers-part-001.md`
- `learn-sql-mastery-for-java-engineers-part-002.md`
- `learn-sql-mastery-for-java-engineers-part-003.md`
- `learn-sql-mastery-for-java-engineers-part-004.md`
- `learn-sql-mastery-for-java-engineers-part-005.md`

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-006.md` — Joins from First Principles


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-004.md">⬅️ Part 4 — Basic Query Semantics: SELECT, FROM, WHERE, ORDER BY, LIMIT</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-006.md">Part 6 — Joins from First Principles ➡️</a>
</div>
