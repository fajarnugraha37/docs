# learn-sql-mastery-for-java-engineers-part-004.md

# Part 4 — Basic Query Semantics: SELECT, FROM, WHERE, ORDER BY, LIMIT

> Seri: SQL Mastery for Java Engineers  
> Bagian: 004 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-003.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-005.md`

---

## 0. Tujuan Bagian Ini

Bagian ini membahas query dasar:

```sql
SELECT
FROM
WHERE
ORDER BY
LIMIT / OFFSET
```

Namun kita tidak akan mempelajarinya seperti template pemula.

Bukan seperti:

```sql
SELECT column
FROM table
WHERE condition;
```

Target bagian ini adalah memahami **semantik query dasar**.

Query paling sederhana sekalipun mengandung keputusan penting:

- relation apa yang menjadi sumber?
- satu row hasil query merepresentasikan apa?
- predicate apa yang menentukan row lolos?
- kolom apa yang diproyeksikan?
- apakah hasil punya urutan deterministic?
- apakah pagination stabil?
- apakah `WHERE` benar terhadap `NULL`?
- apakah query bisa memakai index?
- apakah query result cocok dengan DTO Java?
- apakah query aman ketika data membesar?

Contoh query:

```sql
SELECT
    id,
    case_number,
    status
FROM cases
WHERE status = 'OPEN'
ORDER BY opened_at DESC
LIMIT 50;
```

Query ini terlihat dasar. Tapi engineer senior akan bertanya:

```text
Apa grain-nya?
Apakah status valid dan constrained?
Apakah ORDER BY deterministic jika opened_at sama?
Apakah index mendukung status + opened_at?
Apakah LIMIT 50 tanpa cursor cukup?
Apakah result bisa berubah antar request?
Apakah query membaca dari primary atau replica?
Apakah created/opened timestamp timezone-safe?
Apakah DTO butuh kolom lain?
```

SQL dasar bukan berarti pemahaman dasar.

---

## 1. Mental Model: Query Menghasilkan Relation Baru

Dari part sebelumnya:

> Hasil query adalah relation baru.

Contoh:

```sql
SELECT
    id,
    case_number
FROM cases
WHERE status = 'OPEN';
```

Input relation:

```text
cases(id, case_number, status, opened_at, closed_at, ...)
```

Output relation:

```text
OpenCase(id, case_number)
```

Query bukan hanya mengambil data. Query membentuk relation baru dari relation lama.

Operasi yang terjadi secara konseptual:

```text
FROM    -> tentukan source relation
WHERE   -> filter tuple berdasarkan predicate
SELECT  -> project attribute/expression
ORDER BY -> urutkan output
LIMIT   -> ambil sebagian output
```

Dalam relational algebra:

```text
projection(selection(relation))
```

Namun SQL punya detail tambahan:

- duplicate tetap ada kecuali `DISTINCT`
- result ordering tidak dijamin tanpa `ORDER BY`
- `NULL` mengikuti three-valued logic
- physical execution order bisa berbeda dari logical semantics
- optimizer bebas memilih plan

---

## 2. Contoh Domain yang Akan Dipakai

Agar semua contoh konsisten, kita gunakan domain regulatory/case-management.

Schema sederhana:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    jurisdiction_code TEXT NOT NULL,
    case_number TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,

    CONSTRAINT uq_cases_jurisdiction_case_number
    UNIQUE (jurisdiction_code, case_number),

    CONSTRAINT ck_cases_status_valid
    CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED', 'CANCELLED')),

    CONSTRAINT ck_cases_priority_valid
    CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),

    CONSTRAINT ck_cases_time_order
    CHECK (closed_at IS NULL OR closed_at >= opened_at)
);
```

Contoh data konseptual:

```text
id | jurisdiction_code | case_number | status        | priority | opened_at
---+-------------------+-------------+---------------+----------+------------------------
1  | ID-JKT            | C-001       | OPEN          | HIGH     | 2026-01-01T09:00:00Z
2  | ID-JKT            | C-002       | CLOSED        | NORMAL   | 2026-01-02T09:00:00Z
3  | ID-BDG            | C-003       | ESCALATED     | CRITICAL | 2026-01-02T09:00:00Z
4  | ID-JKT            | C-004       | OPEN          | NORMAL   | 2026-01-03T09:00:00Z
5  | ID-BDG            | C-005       | UNDER_REVIEW  | HIGH     | 2026-01-04T09:00:00Z
```

---

## 3. SELECT: Projection, Bukan “Print Column”

`SELECT` menentukan output attributes.

Contoh:

```sql
SELECT
    id,
    case_number,
    status
FROM cases;
```

Output relation:

```text
(id, case_number, status)
```

`SELECT` adalah projection.

Ia menentukan bentuk hasil query.

---

## 4. SELECT *: Kapan Berbahaya

```sql
SELECT *
FROM cases;
```

Ini umum saat eksplorasi, tetapi buruk untuk production query.

Masalah:

1. mengambil kolom yang tidak perlu
2. coupling ke schema fisik
3. output berubah saat column ditambah
4. DTO mapping bisa rusak
5. data sensitif bisa ikut terbaca
6. network overhead
7. memory overhead
8. index-only scan bisa gagal
9. query review lebih sulit
10. API response bisa tidak sengaja membocorkan field

Contoh:

Hari ini table:

```text
id, case_number, status
```

Aplikasi memakai:

```sql
SELECT *
FROM cases;
```

Besok migration menambah:

```sql
internal_risk_note TEXT
```

Jika mapping atau serialization tidak hati-hati, field sensitif bisa ikut keluar.

Lebih aman:

```sql
SELECT
    id,
    case_number,
    status
FROM cases;
```

Prinsip:

> Production query harus mengambil kolom yang memang dibutuhkan.

---

## 5. SELECT Expression

`SELECT` tidak hanya memilih column. Ia bisa membuat expression.

Contoh:

```sql
SELECT
    id,
    case_number,
    status,
    opened_at,
    closed_at,
    closed_at - opened_at AS case_duration
FROM cases
WHERE status = 'CLOSED';
```

Contoh conditional expression:

```sql
SELECT
    id,
    case_number,
    CASE
        WHEN priority = 'CRITICAL' THEN 'Immediate attention'
        WHEN priority = 'HIGH' THEN 'High priority'
        ELSE 'Normal queue'
    END AS handling_hint
FROM cases;
```

Expression berguna, tapi jangan memindahkan business logic kompleks ke query ad-hoc tanpa governance.

Jika expression sama dipakai di banyak tempat, pertimbangkan:

- generated column
- view
- materialized view
- service-layer value object
- reference table
- database function, jika tepat

---

## 6. Alias: Nama Output Adalah Kontrak

```sql
SELECT
    id AS case_id,
    case_number AS reference_number,
    status AS current_status
FROM cases;
```

Alias penting karena output query sering menjadi contract untuk:

- Java DTO
- report
- BI dashboard
- API layer
- integration export
- stored procedure result
- test assertion

Contoh DTO:

```java
record CaseSummaryDto(
    UUID caseId,
    String referenceNumber,
    String currentStatus
) {}
```

Query harus selaras:

```sql
SELECT
    id AS case_id,
    case_number AS reference_number,
    status AS current_status
FROM cases;
```

Jangan anggap nama column internal selalu sama dengan nama output contract.

---

## 7. FROM: Source Relation

`FROM` menentukan sumber relation.

Contoh:

```sql
SELECT
    id,
    case_number
FROM cases;
```

`cases` adalah base table.

Tapi `FROM` bisa berasal dari:

- base table
- view
- subquery/derived table
- CTE
- function returning table
- joined relation
- foreign table
- materialized view

Contoh derived table:

```sql
SELECT
    open_cases.id,
    open_cases.case_number
FROM (
    SELECT
        id,
        case_number,
        opened_at
    FROM cases
    WHERE status = 'OPEN'
) AS open_cases
WHERE open_cases.opened_at >= TIMESTAMPTZ '2026-01-01 00:00:00+00';
```

Hasil subquery di `FROM` adalah relation baru.

---

## 8. FROM dan Grain

Query:

```sql
SELECT
    id,
    case_number
FROM cases;
```

Grain:

```text
one row per case
```

Karena source relation `cases` memiliki satu row per case.

Jika nanti `FROM` berisi join, grain bisa berubah. Itu dibahas detail di part 006.

Namun mulai sekarang, biasakan menulis:

```text
This query returns one row per ______.
```

Untuk query di atas:

```text
This query returns one row per case.
```

---

## 9. WHERE: Selection Predicate

`WHERE` memilih row yang predicate-nya `TRUE`.

Contoh:

```sql
SELECT
    id,
    case_number,
    status
FROM cases
WHERE status = 'OPEN';
```

Predicate:

```text
status = 'OPEN'
```

Dalam SQL three-valued logic:

- TRUE -> row lolos
- FALSE -> row tidak lolos
- UNKNOWN -> row tidak lolos

Karena itu `NULL` penting.

---

## 10. WHERE dengan AND / OR

Contoh:

```sql
SELECT
    id,
    case_number,
    priority,
    status
FROM cases
WHERE status = 'OPEN'
  AND priority IN ('HIGH', 'CRITICAL');
```

Makna:

> Case yang statusnya OPEN dan priority-nya HIGH atau CRITICAL.

Perhatikan grouping.

```sql
WHERE status = 'OPEN'
   OR status = 'ESCALATED'
  AND priority = 'CRITICAL'
```

Secara precedence, `AND` dievaluasi sebelum `OR`.

Query di atas berarti:

```text
status = 'OPEN'
OR
(status = 'ESCALATED' AND priority = 'CRITICAL')
```

Jika maksudnya:

```text
(status OPEN atau ESCALATED) dan priority CRITICAL
```

Tulis eksplisit:

```sql
WHERE status IN ('OPEN', 'ESCALATED')
  AND priority = 'CRITICAL';
```

atau:

```sql
WHERE (status = 'OPEN' OR status = 'ESCALATED')
  AND priority = 'CRITICAL';
```

Prinsip:

> Untuk query production, gunakan parentheses saat ada campuran `AND` dan `OR`, kecuali ekspresi sangat jelas.

---

## 11. WHERE dan NULL

Salah:

```sql
SELECT *
FROM cases
WHERE closed_at = NULL;
```

Benar:

```sql
SELECT *
FROM cases
WHERE closed_at IS NULL;
```

Untuk case yang belum closed:

```sql
SELECT
    id,
    case_number
FROM cases
WHERE closed_at IS NULL;
```

Untuk case yang sudah closed:

```sql
SELECT
    id,
    case_number
FROM cases
WHERE closed_at IS NOT NULL;
```

---

## 12. WHERE dan Date Range

Salah/berisiko:

```sql
SELECT *
FROM cases
WHERE opened_at BETWEEN TIMESTAMPTZ '2026-01-01 00:00:00+00'
                    AND TIMESTAMPTZ '2026-01-31 00:00:00+00';
```

Ini tidak mencakup sebagian besar tanggal 31 Januari.

Lebih aman:

```sql
SELECT *
FROM cases
WHERE opened_at >= TIMESTAMPTZ '2026-01-01 00:00:00+00'
  AND opened_at <  TIMESTAMPTZ '2026-02-01 00:00:00+00';
```

Pattern:

```text
[start_inclusive, end_exclusive)
```

Dalam Java:

```java
Instant startInclusive = Instant.parse("2026-01-01T00:00:00Z");
Instant endExclusive = Instant.parse("2026-02-01T00:00:00Z");
```

Query:

```sql
WHERE opened_at >= :start_inclusive
  AND opened_at <  :end_exclusive
```

---

## 13. WHERE dan Sargability Awal

Sargability berarti predicate dapat memanfaatkan index secara efektif.

Akan dibahas detail di part 005, tapi dasar pentingnya:

Buruk:

```sql
WHERE CAST(opened_at AS DATE) = DATE '2026-01-01'
```

Karena function/cast diterapkan ke column.

Lebih baik:

```sql
WHERE opened_at >= TIMESTAMPTZ '2026-01-01 00:00:00+00'
  AND opened_at <  TIMESTAMPTZ '2026-01-02 00:00:00+00'
```

Buruk:

```sql
WHERE lower(case_number) = lower(:case_number)
```

kecuali ada expression index.

Lebih baik jika case_number normalized:

```sql
WHERE case_number_normalized = :case_number_normalized
```

atau buat expression index sesuai vendor.

---

## 14. WHERE dan Parameter Binding

Jangan string-concat SQL dari input user.

Buruk:

```java
String sql = "SELECT * FROM cases WHERE case_number = '" + input + "'";
```

Risiko:

- SQL injection
- syntax error
- escaping bug
- plan cache buruk
- type mismatch

Benar:

```java
PreparedStatement ps = connection.prepareStatement("""
    SELECT
        id,
        case_number,
        status
    FROM cases
    WHERE case_number = ?
""");
ps.setString(1, caseNumber);
```

Dengan Spring JDBC:

```java
jdbcTemplate.query("""
    SELECT
        id,
        case_number,
        status
    FROM cases
    WHERE case_number = ?
""", rowMapper, caseNumber);
```

Untuk named parameter:

```java
namedParameterJdbcTemplate.query("""
    SELECT
        id,
        case_number,
        status
    FROM cases
    WHERE case_number = :caseNumber
""", params, rowMapper);
```

Parameter binding bukan hanya security. Ia juga membantu database memahami type.

---

## 15. ORDER BY: SQL Result Tidak Punya Urutan Tanpa ORDER BY

Ini prinsip penting:

> Tanpa `ORDER BY`, SQL tidak menjamin urutan hasil.

Query:

```sql
SELECT
    id,
    case_number
FROM cases
WHERE status = 'OPEN';
```

Mungkin hari ini hasilnya tampak terurut berdasarkan insert time.

Tapi itu kebetulan.

Besok hasil bisa berubah karena:

- index baru
- query plan berubah
- vacuum/maintenance
- parallel execution
- statistics berubah
- version database berubah
- data bertambah
- partitioning
- replica berbeda

Jika urutan penting, tulis `ORDER BY`.

---

## 16. ORDER BY Single Column

```sql
SELECT
    id,
    case_number,
    opened_at
FROM cases
WHERE status = 'OPEN'
ORDER BY opened_at DESC;
```

Makna:

> Urutkan open cases dari yang paling baru dibuka.

Namun jika dua case punya `opened_at` sama, urutan antar keduanya tidak deterministic.

Data contoh:

```text
C-002 opened_at 2026-01-02T09:00:00Z
C-003 opened_at 2026-01-02T09:00:00Z
```

Database bebas mengembalikan C-002 dulu atau C-003 dulu.

Untuk deterministic order, tambahkan tie-breaker.

---

## 17. ORDER BY Deterministic

Lebih baik:

```sql
SELECT
    id,
    case_number,
    opened_at
FROM cases
WHERE status = 'OPEN'
ORDER BY opened_at DESC, id DESC;
```

Sekarang urutan stabil selama `(opened_at, id)` unik secara efektif.

Untuk UI/feed/pagination, deterministic ordering sangat penting.

Prinsip:

> Jika hasil akan dipaginate, selalu gunakan ORDER BY deterministic.

---

## 18. ORDER BY Expression

```sql
SELECT
    id,
    case_number,
    priority
FROM cases
ORDER BY
    CASE priority
        WHEN 'CRITICAL' THEN 1
        WHEN 'HIGH' THEN 2
        WHEN 'NORMAL' THEN 3
        WHEN 'LOW' THEN 4
        ELSE 5
    END,
    opened_at DESC;
```

Ini berguna untuk custom business ordering.

Namun jika sering dipakai, pertimbangkan reference table:

```sql
CREATE TABLE case_priorities (
    code TEXT PRIMARY KEY,
    sort_order INTEGER NOT NULL UNIQUE
);
```

Lalu query join ke `sort_order`.

Business ordering yang tersebar di banyak query rawan tidak konsisten.

---

## 19. ORDER BY dan NULL

Jika column bisa `NULL`, posisi NULL dalam ordering berbeda antar vendor/default.

Contoh:

```sql
ORDER BY closed_at DESC;
```

Apakah NULL muncul di awal atau akhir? Vendor bisa berbeda.

Gunakan eksplisit jika penting:

```sql
ORDER BY closed_at DESC NULLS LAST;
```

PostgreSQL mendukung `NULLS FIRST/LAST`.

Jika vendor tidak mendukung, gunakan expression:

```sql
ORDER BY
    CASE WHEN closed_at IS NULL THEN 1 ELSE 0 END,
    closed_at DESC;
```

Makna harus jelas:

- open cases dengan `closed_at NULL` mau muncul di mana?
- closed cases mau diurutkan bagaimana?
- apakah NULL berarti unknown atau not applicable?

---

## 20. LIMIT: Membatasi Jumlah Row

```sql
SELECT
    id,
    case_number,
    opened_at
FROM cases
WHERE status = 'OPEN'
ORDER BY opened_at DESC, id DESC
LIMIT 50;
```

`LIMIT` berguna untuk:

- UI list
- preview
- sampling
- safety guard
- top-N query

Namun `LIMIT` tanpa `ORDER BY` biasanya tidak bermakna.

Buruk:

```sql
SELECT *
FROM cases
LIMIT 50;
```

Pertanyaan:

```text
50 row yang mana?
```

Database boleh mengembalikan 50 row apa saja sesuai plan.

Untuk debugging boleh. Untuk aplikasi production, biasanya tidak.

---

## 21. OFFSET: Pagination Sederhana tapi Bermasalah

```sql
SELECT
    id,
    case_number,
    opened_at
FROM cases
WHERE status = 'OPEN'
ORDER BY opened_at DESC, id DESC
LIMIT 50 OFFSET 100;
```

Artinya:

```text
Lewati 100 row pertama, ambil 50 row berikutnya.
```

Masalah:

1. semakin besar offset, semakin mahal
2. database tetap harus menemukan/melewati row sebelumnya
3. data bisa berubah antar page
4. item bisa duplicate/missing antar page
5. order harus deterministic
6. tidak cocok untuk infinite scroll besar

Contoh race:

- User buka page 1.
- Case baru masuk di urutan atas.
- User buka page 2.
- Beberapa item bergeser.
- User melihat duplicate atau melewatkan item.

OFFSET cocok untuk:

- dataset kecil
- admin internal sederhana
- report non-critical
- pagination dengan snapshot/transaction tertentu
- low-volume UI

Untuk high-scale feed/list, gunakan keyset pagination.

---

## 22. Keyset Pagination Dasar

Daripada:

```sql
LIMIT 50 OFFSET 1000
```

gunakan cursor berdasarkan last seen key.

Page pertama:

```sql
SELECT
    id,
    case_number,
    opened_at
FROM cases
WHERE status = 'OPEN'
ORDER BY opened_at DESC, id DESC
LIMIT 50;
```

Misalnya row terakhir punya:

```text
opened_at = 2026-01-10T09:00:00Z
id = 7bd...
```

Page berikutnya:

```sql
SELECT
    id,
    case_number,
    opened_at
FROM cases
WHERE status = 'OPEN'
  AND (
      opened_at < :last_opened_at
      OR (
          opened_at = :last_opened_at
          AND id < :last_id
      )
  )
ORDER BY opened_at DESC, id DESC
LIMIT 50;
```

Jika vendor mendukung row value comparison:

```sql
WHERE (opened_at, id) < (:last_opened_at, :last_id)
```

dengan `ORDER BY opened_at DESC, id DESC` perlu dipastikan semantics sesuai vendor.

Keyset pagination lebih stabil dan efisien untuk scrolling maju.

Kekurangan:

- sulit jump ke page 100
- cursor harus membawa sort key
- sorting harus deterministic
- lebih kompleks untuk arbitrary filter/sort
- backward pagination butuh handling tambahan

---

## 23. LIMIT dan Top-N per Group

Query:

```sql
SELECT *
FROM cases
ORDER BY opened_at DESC
LIMIT 10;
```

Mengambil 10 case terbaru secara global.

Tapi pertanyaan berbeda:

> Ambil 3 case terbaru per jurisdiction.

Tidak bisa pakai `LIMIT 3` biasa.

Butuh window function:

```sql
SELECT
    id,
    jurisdiction_code,
    case_number,
    opened_at
FROM (
    SELECT
        c.*,
        ROW_NUMBER() OVER (
            PARTITION BY jurisdiction_code
            ORDER BY opened_at DESC, id DESC
        ) AS rn
    FROM cases c
) ranked
WHERE rn <= 3
ORDER BY jurisdiction_code, opened_at DESC, id DESC;
```

Ini akan dibahas mendalam di part 010.

Pelajaran untuk sekarang:

> `LIMIT` membatasi result final, bukan “per group”, kecuali dikombinasikan dengan teknik lain.

---

## 24. DISTINCT: Menghapus Duplicate dengan Sadar

Walaupun bukan fokus utama part ini, `DISTINCT` sering muncul di query dasar.

```sql
SELECT DISTINCT status
FROM cases;
```

Output:

```text
OPEN
UNDER_REVIEW
ESCALATED
CLOSED
CANCELLED
```

Ini valid.

Namun:

```sql
SELECT DISTINCT
    c.id,
    c.case_number
FROM cases c
JOIN case_assignments a ON a.case_id = c.id;
```

Sering menjadi smell.

Kenapa duplicate muncul?

- karena satu case punya banyak assignment
- karena join mengubah grain
- karena query tidak sesuai pertanyaan

`DISTINCT` boleh, tapi harus ditanya:

```text
Apakah duplicate memang tidak bermakna?
Atau DISTINCT sedang menutupi join bug?
```

---

## 25. Logical Query Processing Order

Urutan penulisan SQL:

```sql
SELECT
FROM
WHERE
GROUP BY
HAVING
ORDER BY
LIMIT
```

Urutan logis:

```text
FROM
WHERE
GROUP BY
HAVING
SELECT
DISTINCT
ORDER BY
LIMIT
```

Untuk query dasar:

```text
FROM -> WHERE -> SELECT -> ORDER BY -> LIMIT
```

Contoh:

```sql
SELECT
    case_number,
    opened_at
FROM cases
WHERE status = 'OPEN'
ORDER BY opened_at DESC
LIMIT 10;
```

Logical steps:

1. `FROM cases`: mulai dari relation `cases`.
2. `WHERE status = 'OPEN'`: filter row.
3. `SELECT case_number, opened_at`: project output columns.
4. `ORDER BY opened_at DESC`: sort output.
5. `LIMIT 10`: ambil 10 row pertama dari hasil sort.

Penting:

> Optimizer tidak wajib menjalankan physical plan sesuai urutan logis ini.

Database bisa menggunakan index `(status, opened_at)` sehingga tidak sort semua row.

Semantik tetap sama.

---

## 26. Alias Visibility: Kenapa Alias SELECT Tidak Selalu Bisa Dipakai di WHERE

Contoh salah di banyak database:

```sql
SELECT
    id,
    closed_at - opened_at AS duration
FROM cases
WHERE duration > INTERVAL '7 days';
```

Karena secara logical, `WHERE` dievaluasi sebelum `SELECT`. Alias `duration` belum tersedia.

Gunakan subquery/CTE:

```sql
SELECT *
FROM (
    SELECT
        id,
        closed_at - opened_at AS duration
    FROM cases
    WHERE closed_at IS NOT NULL
) x
WHERE duration > INTERVAL '7 days';
```

atau ulang expression:

```sql
SELECT
    id,
    closed_at - opened_at AS duration
FROM cases
WHERE closed_at IS NOT NULL
  AND closed_at - opened_at > INTERVAL '7 days';
```

`ORDER BY` sering bisa memakai alias karena secara logical setelah SELECT:

```sql
SELECT
    id,
    closed_at - opened_at AS duration
FROM cases
WHERE closed_at IS NOT NULL
ORDER BY duration DESC;
```

Vendor detail bisa berbeda, tapi mental model logical order membantu.

---

## 27. Basic Query dan DTO Design

Misalnya Java DTO:

```java
record OpenCaseListItem(
    UUID caseId,
    String caseNumber,
    String priority,
    Instant openedAt
) {}
```

Query:

```sql
SELECT
    id AS case_id,
    case_number,
    priority,
    opened_at
FROM cases
WHERE status = 'OPEN'
ORDER BY opened_at DESC, id DESC
LIMIT :limit;
```

Review:

```text
Grain: one row per open case.
Projection: cocok dengan DTO.
Predicate: status = OPEN.
Ordering: deterministic karena opened_at + id.
Limit: parameterized.
Type mapping: id -> UUID, opened_at -> Instant.
```

Buruk:

```sql
SELECT *
FROM cases
WHERE status = 'OPEN'
LIMIT 50;
```

Masalah:

- order tidak jelas
- projection terlalu luas
- DTO coupling
- limit tanpa deterministic order
- tidak ada pagination cursor
- mengambil closed_at yang tidak perlu
- bisa mengambil internal fields

---

## 28. Basic Query dan Authorization

Query dasar sering terlihat seperti hanya data retrieval:

```sql
SELECT
    id,
    case_number,
    status
FROM cases
WHERE status = 'OPEN';
```

Tapi dalam aplikasi nyata, user tidak selalu boleh melihat semua case.

Authorization bisa masuk melalui:

- application-level predicate
- row-level security
- view
- tenant/jurisdiction filter
- join ke assignment/permission table
- session context
- separate database role

Contoh application predicate:

```sql
SELECT
    id,
    case_number,
    status
FROM cases
WHERE status = 'OPEN'
  AND jurisdiction_code = :user_jurisdiction;
```

Jika lupa filter authorization, query syntactically benar tetapi security-broken.

Prinsip:

> Query correctness mencakup data visibility, bukan hanya filter bisnis.

---

## 29. Basic Query dan Multi-Tenancy

Dalam multi-tenant system:

```sql
SELECT
    id,
    case_number
FROM cases
WHERE status = 'OPEN';
```

Mungkin salah karena tidak ada tenant filter.

Harus:

```sql
SELECT
    id,
    case_number
FROM cases
WHERE tenant_id = :tenant_id
  AND status = 'OPEN';
```

Multi-tenant bug sering fatal.

Pastikan:

- tenant_id NOT NULL
- index mencakup tenant_id
- unique constraint tenant-aware
- query selalu tenant-scoped
- RLS dipertimbangkan jika cocok
- integration/reporting tidak bypass scope

Contoh unique:

```sql
UNIQUE (tenant_id, case_number)
```

bukan:

```sql
UNIQUE (case_number)
```

jika case_number hanya unik per tenant.

---

## 30. Basic Query dan Read Replica

Query:

```sql
SELECT
    id,
    status
FROM cases
WHERE id = :case_id;
```

Jika diarahkan ke read replica, mungkin membaca data stale karena replication lag.

Masalah umum:

1. request update case
2. transaction commit di primary
3. redirect/read berikutnya ke replica
4. replica belum catch up
5. user melihat status lama

Untuk read-after-write consistency, strategi:

- baca dari primary setelah write
- session stickiness
- wait for replica LSN, jika vendor mendukung
- tolerate stale read di UI
- optimistic UI
- explicit consistency level
- event-driven refresh

Query dasar tetap punya consistency context.

---

## 31. Basic Query dan Isolation

Dalam transaksi:

```sql
BEGIN;

SELECT status
FROM cases
WHERE id = :case_id;

-- some business logic

SELECT status
FROM cases
WHERE id = :case_id;

COMMIT;
```

Apakah dua SELECT bisa melihat status berbeda?

Tergantung isolation level dan vendor.

Part 019 akan membahas detail.

Untuk sekarang pahami:

> SELECT tidak hidup di ruang hampa; hasilnya dipengaruhi transaction isolation dan snapshot visibility.

---

## 32. Basic Query dan Performance

Query dasar:

```sql
SELECT
    id,
    case_number,
    status
FROM cases
WHERE status = 'OPEN'
ORDER BY opened_at DESC, id DESC
LIMIT 50;
```

Index yang mungkin cocok:

```sql
CREATE INDEX idx_cases_status_opened_id
ON cases (status, opened_at DESC, id DESC);
```

Tapi index design bergantung pada:

- cardinality status
- jumlah open cases
- filter lain
- ordering
- selectivity
- table size
- write overhead
- query frequency

Jangan membuat index untuk setiap query kecil. Tapi pahami bahwa:

```text
WHERE + ORDER BY + LIMIT
```

sering dapat dioptimalkan dengan index yang selaras.

---

## 33. Basic Query dan Count

UI sering butuh:

```text
show first 50 open cases
show total count
```

Data query:

```sql
SELECT
    id,
    case_number,
    opened_at
FROM cases
WHERE status = 'OPEN'
ORDER BY opened_at DESC, id DESC
LIMIT 50;
```

Count query:

```sql
SELECT COUNT(*)
FROM cases
WHERE status = 'OPEN';
```

Masalah:

- count bisa mahal pada table besar
- count bisa berubah antara data query dan count query
- count exact mungkin tidak perlu
- count di replica bisa stale
- count dengan complex filter bisa membebani DB

Alternatif:

- approximate count
- cached count
- show “many results”
- count only on demand
- materialized summary
- background aggregation

Jangan otomatis menjalankan `COUNT(*)` besar untuk setiap list API tanpa mempertimbangkan biaya.

---

## 34. Basic Query dan Existence Check

Buruk:

```sql
SELECT COUNT(*)
FROM cases
WHERE case_number = :case_number;
```

lalu cek count > 0.

Untuk existence, lebih baik:

```sql
SELECT 1
FROM cases
WHERE case_number = :case_number
LIMIT 1;
```

atau:

```sql
SELECT EXISTS (
    SELECT 1
    FROM cases
    WHERE case_number = :case_number
);
```

Namun untuk insert uniqueness, jangan hanya existence check di aplikasi.

Gunakan unique constraint:

```sql
UNIQUE (jurisdiction_code, case_number)
```

Existence check + insert rentan race condition.

---

## 35. Basic Query dan Race Condition

Naive Java flow:

```text
1. SELECT to check if case_number exists
2. If not exists, INSERT new case
```

Race:

```text
Request A checks: not exists
Request B checks: not exists
Request A inserts
Request B inserts
```

Jika tidak ada unique constraint, duplicate terjadi.

Benar:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    jurisdiction_code TEXT NOT NULL,
    case_number TEXT NOT NULL,

    UNIQUE (jurisdiction_code, case_number)
);
```

Lalu aplikasi menangani duplicate key error atau memakai upsert.

Query dasar tidak boleh digunakan sebagai pengganti constraint.

---

## 36. Basic Query dan Read Model

Kadang query dasar terhadap table utama menjadi terlalu sering dan kompleks.

Contoh list API:

```text
case_number
status
priority
current_officer_name
evidence_count
latest_decision
sla_due_date
```

Jika setiap request join/aggregate banyak table, pertimbangkan read model:

```sql
CREATE TABLE case_list_read_model (
    case_id UUID PRIMARY KEY,
    case_number TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    current_officer_name TEXT,
    evidence_count INTEGER NOT NULL,
    latest_decision TEXT,
    sla_due_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL
);
```

Kemudian query dasar:

```sql
SELECT
    case_id,
    case_number,
    status,
    priority,
    current_officer_name,
    evidence_count,
    sla_due_at
FROM case_list_read_model
WHERE status = 'OPEN'
ORDER BY sla_due_at ASC NULLS LAST, case_id
LIMIT 50;
```

Trade-off:

- write/update complexity bertambah
- consistency bisa eventual
- read query lebih cepat/stabil
- reporting lebih mudah
- perlu rebuild strategy

Query dasar yang baik sering merupakan hasil desain read model yang baik.

---

## 37. Basic Query Style Guide

### 37.1 Gunakan huruf besar untuk keyword

```sql
SELECT
FROM
WHERE
ORDER BY
LIMIT
```

Bukan wajib secara teknis, tapi membantu readability.

### 37.2 Satu kolom per baris untuk projection panjang

```sql
SELECT
    id,
    case_number,
    jurisdiction_code,
    status,
    priority,
    opened_at
FROM cases;
```

### 37.3 Predicate kompleks dipecah baris

```sql
WHERE jurisdiction_code = :jurisdiction_code
  AND status IN ('OPEN', 'ESCALATED')
  AND opened_at >= :start_inclusive
  AND opened_at < :end_exclusive
```

### 37.4 Alias jelas

```sql
SELECT
    c.id AS case_id,
    c.case_number
FROM cases c;
```

### 37.5 Hindari ordinal ORDER BY

Buruk:

```sql
ORDER BY 2 DESC;
```

Lebih jelas:

```sql
ORDER BY opened_at DESC;
```

Ordinal mudah rusak saat projection berubah.

---

## 38. Common Mistakes

### Mistake 1 — Mengandalkan Urutan Tanpa ORDER BY

```sql
SELECT *
FROM cases
LIMIT 20;
```

Tidak deterministic.

### Mistake 2 — LIMIT Tanpa ORDER BY

```sql
SELECT *
FROM cases
WHERE status = 'OPEN'
LIMIT 20;
```

“20 open cases” yang mana?

### Mistake 3 — OFFSET Besar

```sql
LIMIT 50 OFFSET 100000;
```

Mahal dan tidak stabil.

### Mistake 4 — SELECT *

Production query tidak seharusnya mengambil semua kolom.

### Mistake 5 — Predicate Date Salah

```sql
WHERE created_at BETWEEN '2026-01-01' AND '2026-01-31'
```

Gunakan exclusive upper bound.

### Mistake 6 — NULL Comparison Salah

```sql
WHERE closed_at = NULL
```

Gunakan `IS NULL`.

### Mistake 7 — OR Tanpa Parentheses

```sql
WHERE status = 'OPEN'
   OR status = 'ESCALATED'
  AND priority = 'CRITICAL'
```

Ambigu untuk pembaca dan sering salah.

### Mistake 8 — Query Mengabaikan Tenant/Jurisdiction

```sql
WHERE status = 'OPEN'
```

Padahal user hanya boleh lihat jurisdiction tertentu.

### Mistake 9 — Count untuk Existence

```sql
SELECT COUNT(*)
```

Untuk existence, gunakan `EXISTS`.

### Mistake 10 — Query Check sebagai Constraint

SELECT sebelum INSERT tidak menggantikan unique constraint.

---

## 39. Checklist: Membaca Query Dasar

Saat melihat query:

```text
[ ] Apa grain hasil query?
[ ] Source relation dari FROM apa?
[ ] Apakah SELECT mengambil kolom secukupnya?
[ ] Apakah ada SELECT * di path production?
[ ] Predicate WHERE benar secara domain?
[ ] Predicate WHERE benar terhadap NULL?
[ ] Date/time range memakai [start, end)?
[ ] AND/OR diberi parentheses jika perlu?
[ ] Apakah authorization/tenant/jurisdiction filter ada?
[ ] Apakah ORDER BY ada jika urutan penting?
[ ] Apakah ORDER BY deterministic?
[ ] Apakah LIMIT dipakai bersama ORDER BY?
[ ] Apakah OFFSET masih masuk akal?
[ ] Apakah keyset pagination lebih cocok?
[ ] Apakah query memakai parameter binding?
[ ] Apakah type parameter cocok dengan column?
[ ] Apakah query result cocok dengan DTO/report?
```

---

## 40. Checklist: Menulis Query List API

Untuk endpoint list/search:

```text
[ ] Tentukan grain item response.
[ ] Tentukan filter wajib: tenant, jurisdiction, authorization.
[ ] Tentukan filter opsional.
[ ] Tentukan default sort.
[ ] Pastikan sort deterministic.
[ ] Tentukan limit maksimum.
[ ] Hindari SELECT *.
[ ] Gunakan keyset pagination jika data besar.
[ ] Pastikan index mendukung filter + sort utama.
[ ] Hindari count exact otomatis jika mahal.
[ ] Pastikan timestamp/timezone benar.
[ ] Pastikan query tidak join one-to-many tanpa sadar.
[ ] Test dengan duplicate sort key.
[ ] Test dengan data baru masuk antar page.
```

---

## 41. Mini Case Study: Open Case Queue

### 41.1 Requirement

> Tampilkan 50 open case terbaru untuk jurisdiction user.

### 41.2 Naive Query

```sql
SELECT *
FROM cases
WHERE status = 'OPEN'
LIMIT 50;
```

Masalah:

- `SELECT *`
- tidak ada jurisdiction filter
- tidak ada order
- limit arbitrary
- data sensitif bisa ikut
- hasil tidak deterministic
- tidak cocok untuk pagination

### 41.3 Better Query

```sql
SELECT
    id AS case_id,
    case_number,
    priority,
    opened_at
FROM cases
WHERE jurisdiction_code = :jurisdiction_code
  AND status = 'OPEN'
ORDER BY opened_at DESC, id DESC
LIMIT :limit;
```

Review:

```text
Grain: one row per case.
Authorization scope: jurisdiction_code.
Predicate: status OPEN.
Projection: only list fields.
Ordering: deterministic.
Limit: parameterized and should be capped.
```

Potential index:

```sql
CREATE INDEX idx_cases_jurisdiction_status_opened_id
ON cases (jurisdiction_code, status, opened_at DESC, id DESC);
```

---

## 42. Mini Case Study: Case Search by Date

### 42.1 Requirement

> Cari case yang dibuka selama Januari 2026.

### 42.2 Risky Query

```sql
SELECT
    id,
    case_number,
    opened_at
FROM cases
WHERE opened_at BETWEEN '2026-01-01' AND '2026-01-31';
```

Masalah:

- upper bound salah untuk timestamp
- literal timezone ambigu
- bisa kehilangan data 31 Januari setelah tengah malam

### 42.3 Better Query

```sql
SELECT
    id,
    case_number,
    opened_at
FROM cases
WHERE opened_at >= TIMESTAMPTZ '2026-01-01 00:00:00+00'
  AND opened_at <  TIMESTAMPTZ '2026-02-01 00:00:00+00'
ORDER BY opened_at ASC, id ASC;
```

Dalam aplikasi, parameterize:

```sql
WHERE opened_at >= :start_inclusive
  AND opened_at <  :end_exclusive
```

---

## 43. Mini Case Study: Stable Pagination

### 43.1 Requirement

> User dapat scroll open cases dari newest ke oldest.

### 43.2 Page 1

```sql
SELECT
    id,
    case_number,
    opened_at
FROM cases
WHERE status = 'OPEN'
ORDER BY opened_at DESC, id DESC
LIMIT 50;
```

Cursor response menyimpan last item:

```json
{
  "lastOpenedAt": "2026-01-10T09:00:00Z",
  "lastId": "7bd00000-0000-0000-0000-000000000000"
}
```

### 43.3 Page 2

```sql
SELECT
    id,
    case_number,
    opened_at
FROM cases
WHERE status = 'OPEN'
  AND (
      opened_at < :last_opened_at
      OR (
          opened_at = :last_opened_at
          AND id < :last_id
      )
  )
ORDER BY opened_at DESC, id DESC
LIMIT 50;
```

Requirement tambahan:

- `id` ordering harus konsisten
- cursor harus opaque di API jika public
- filter/sort di page 2 harus sama dengan page 1
- jika filter berubah, cursor invalid
- limit harus capped

---

## 44. Mini Case Study: Existence Check vs Constraint

### 44.1 Requirement

> Case number unik per jurisdiction.

### 44.2 Naive Flow

```sql
SELECT 1
FROM cases
WHERE jurisdiction_code = :jurisdiction_code
  AND case_number = :case_number
LIMIT 1;
```

Jika tidak ada, aplikasi insert.

Race condition tetap mungkin.

### 44.3 Correct Database Invariant

```sql
ALTER TABLE cases
ADD CONSTRAINT uq_cases_jurisdiction_case_number
UNIQUE (jurisdiction_code, case_number);
```

Insert:

```sql
INSERT INTO cases (
    id,
    jurisdiction_code,
    case_number,
    status,
    priority,
    opened_at
)
VALUES (
    :id,
    :jurisdiction_code,
    :case_number,
    'OPEN',
    'NORMAL',
    :opened_at
);
```

Jika duplicate, database menolak.

Aplikasi mapping error:

```text
duplicate case number in jurisdiction
```

Existence query boleh dipakai untuk UX pre-check, tetapi bukan correctness guarantee.

---

## 45. Latihan

### Latihan 1 — Tentukan Grain

Query:

```sql
SELECT
    id,
    case_number,
    status
FROM cases
WHERE priority = 'HIGH';
```

Jawaban:

```text
one row per high-priority case
```

### Latihan 2 — Perbaiki Query

Buruk:

```sql
SELECT *
FROM cases
WHERE opened_at BETWEEN '2026-01-01' AND '2026-01-31'
LIMIT 100;
```

Lebih baik:

```sql
SELECT
    id,
    case_number,
    status,
    opened_at
FROM cases
WHERE opened_at >= TIMESTAMPTZ '2026-01-01 00:00:00+00'
  AND opened_at <  TIMESTAMPTZ '2026-02-01 00:00:00+00'
ORDER BY opened_at DESC, id DESC
LIMIT 100;
```

### Latihan 3 — Tambahkan Authorization Scope

Query awal:

```sql
SELECT
    id,
    case_number
FROM cases
WHERE status = 'OPEN';
```

Jika user hanya boleh melihat satu jurisdiction:

```sql
SELECT
    id,
    case_number
FROM cases
WHERE jurisdiction_code = :jurisdiction_code
  AND status = 'OPEN';
```

### Latihan 4 — Ubah OFFSET ke Keyset

Offset:

```sql
SELECT
    id,
    case_number,
    opened_at
FROM cases
WHERE status = 'OPEN'
ORDER BY opened_at DESC, id DESC
LIMIT 50 OFFSET 500;
```

Keyset:

```sql
SELECT
    id,
    case_number,
    opened_at
FROM cases
WHERE status = 'OPEN'
  AND (
      opened_at < :last_opened_at
      OR (
          opened_at = :last_opened_at
          AND id < :last_id
      )
  )
ORDER BY opened_at DESC, id DESC
LIMIT 50;
```

---

## 46. Koneksi ke Part Berikutnya

Part ini membahas query dasar secara semantik.

Part berikutnya, `part-005`, akan memperdalam `WHERE`:

- comparison predicate
- `BETWEEN`
- `IN`
- `LIKE`
- pattern matching
- range query
- date filtering
- inclusive vs exclusive boundary
- sargability
- function pada column
- collation
- case sensitivity
- predicate simplification
- common filter bugs

Dengan kata lain, kita akan masuk dari “bagaimana query dasar bekerja” ke “bagaimana filter yang benar, aman, dan performan dibangun”.

---

## 47. Ringkasan Bagian Ini

Hal penting dari part 004:

1. Query menghasilkan relation baru.
2. `SELECT` adalah projection, bukan sekadar print column.
3. Hindari `SELECT *` di production path.
4. `FROM` menentukan source relation dan memengaruhi grain.
5. `WHERE` hanya meloloskan predicate yang bernilai TRUE.
6. Gunakan `IS NULL`, bukan `= NULL`.
7. Gunakan date range `[start, end)` untuk timestamp.
8. Gunakan parameter binding.
9. Tanpa `ORDER BY`, urutan hasil tidak dijamin.
10. `ORDER BY` untuk pagination harus deterministic.
11. `LIMIT` tanpa `ORDER BY` biasanya tidak bermakna untuk aplikasi.
12. `OFFSET` sederhana tapi mahal dan tidak stabil pada data besar/berubah.
13. Keyset pagination lebih cocok untuk scrolling besar.
14. `DISTINCT` bisa valid, tapi sering menjadi smell jika menutupi duplicate akibat join.
15. Logical query processing order berbeda dari physical execution.
16. Alias `SELECT` tidak selalu tersedia di `WHERE`.
17. Query dasar tetap harus mempertimbangkan authorization, tenancy, consistency, dan performance.
18. Existence check tidak menggantikan unique constraint.

Kalimat inti:

> Query dasar yang benar bukan hanya menghasilkan row; ia menghasilkan relation dengan grain, predicate, projection, ordering, visibility, dan consistency yang sengaja dirancang.

---

## 48. Referensi

1. PostgreSQL Documentation — Queries Overview.  
   https://www.postgresql.org/docs/current/queries.html

2. PostgreSQL Documentation — Select Lists.  
   https://www.postgresql.org/docs/current/queries-select-lists.html

3. PostgreSQL Documentation — Table Expressions.  
   https://www.postgresql.org/docs/current/queries-table-expressions.html

4. PostgreSQL Documentation — Sorting Rows.  
   https://www.postgresql.org/docs/current/queries-order.html

5. PostgreSQL Documentation — LIMIT and OFFSET.  
   https://www.postgresql.org/docs/current/queries-limit.html

6. PostgreSQL Documentation — Comparison Functions and Operators.  
   https://www.postgresql.org/docs/current/functions-comparison.html

7. MySQL 8.4 Reference Manual — SELECT Statement.  
   https://dev.mysql.com/doc/refman/8.4/en/select.html

8. Microsoft SQL Server Documentation — SELECT.  
   https://learn.microsoft.com/en-us/sql/t-sql/queries/select-transact-sql

9. Oracle Database SQL Language Reference — SELECT.  
   https://docs.oracle.com/en/database/oracle/oracle-database/23/sqlrf/SELECT.html

---

## 49. Status Seri

Seri belum selesai.

Bagian selesai:

- `learn-sql-mastery-for-java-engineers-part-000.md`
- `learn-sql-mastery-for-java-engineers-part-001.md`
- `learn-sql-mastery-for-java-engineers-part-002.md`
- `learn-sql-mastery-for-java-engineers-part-003.md`
- `learn-sql-mastery-for-java-engineers-part-004.md`

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-005.md` — Filtering Deep Dive: Predicates, Ranges, Pattern Matching, and Sargability
