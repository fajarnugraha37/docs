# learn-sql-mastery-for-java-engineers-part-006.md

# Part 6 — Joins from First Principles

> Seri: SQL Mastery for Java Engineers  
> Bagian: 006 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-005.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-007.md`

---

## 0. Tujuan Bagian Ini

Bagian ini membahas salah satu inti SQL: **join**.

Join adalah mekanisme untuk menggabungkan fakta dari beberapa relation.

Sebagai Java engineer, sangat mudah memahami join secara keliru sebagai:

```text
load parent object with child collection
```

Padahal join bukan object graph loading.

Join menghasilkan **relation baru** dari kombinasi tuple yang memenuhi predicate tertentu.

Contoh:

```sql
SELECT
    c.id,
    c.case_number,
    a.officer_id
FROM cases c
JOIN case_assignments a
  ON a.case_id = c.id;
```

Query ini bukan “ambil case dan assignment-nya” seperti object navigation.

Query ini menghasilkan relation baru dengan grain:

```text
one row per matching case-assignment pair
```

Jika satu case punya 3 assignment, case itu muncul 3 kali.

Itu bukan bug database. Itu semantik join.

Bagian ini bertujuan membuat kamu memahami:

- apa itu join secara relasional
- inner join
- left join
- right join
- full outer join
- cross join
- self join
- semi join
- anti join
- join predicate
- join cardinality
- row multiplication
- join explosion
- grain shift
- filter placement: `ON` vs `WHERE`
- null behavior dalam outer join
- join correctness untuk sistem Java
- join sebagai graph relationship
- kapan join harus diganti `EXISTS`, pre-aggregation, atau query terpisah

---

## 1. Mental Model Utama: Join Menghasilkan Kombinasi Tuple

Misal ada relation:

```text
cases
+---------+-------------+
| id      | case_number |
+---------+-------------+
| C1      | CASE-001    |
| C2      | CASE-002    |
+---------+-------------+
```

Dan relation:

```text
case_assignments
+---------+---------+------------+
| id      | case_id | officer_id |
+---------+---------+------------+
| A1      | C1      | O1         |
| A2      | C1      | O2         |
| A3      | C2      | O3         |
+---------+---------+------------+
```

Query:

```sql
SELECT
    c.id AS case_id,
    c.case_number,
    a.id AS assignment_id,
    a.officer_id
FROM cases c
JOIN case_assignments a
  ON a.case_id = c.id;
```

Hasil:

```text
+---------+-------------+---------------+------------+
| case_id | case_number | assignment_id | officer_id |
+---------+-------------+---------------+------------+
| C1      | CASE-001    | A1            | O1         |
| C1      | CASE-001    | A2            | O2         |
| C2      | CASE-002    | A3            | O3         |
+---------+-------------+---------------+------------+
```

Grain hasil:

```text
one row per assignment matched to case
```

Bukan one row per case.

Ini prinsip pertama join.

---

## 2. Join Bukan Pointer Dereference

Dalam Java:

```java
case.getAssignments()
```

terasa seperti navigasi parent ke children.

Dalam SQL:

```sql
JOIN case_assignments a ON a.case_id = c.id
```

adalah matching value antar relation.

Foreign key bukan pointer. Foreign key adalah constraint bahwa value `a.case_id` harus ada di `cases.id`.

Join adalah operasi query yang memakai value itu untuk membangun kombinasi row.

Implikasi:

- database tidak “menempelkan object”
- satu parent bisa menghasilkan banyak row
- relationship direction tidak membatasi arah query
- join bisa terjadi tanpa foreign key
- foreign key bisa ada tetapi join tetap salah jika predicate tidak lengkap
- join bisa valid secara syntax tetapi salah secara grain

---

## 3. Join Predicate

Join predicate biasanya ada di `ON`.

```sql
JOIN case_assignments a
  ON a.case_id = c.id
```

Predicate:

```text
a.case_id = c.id
```

Ini menentukan pasangan tuple mana yang cocok.

Join predicate bisa sederhana:

```sql
ON a.case_id = c.id
```

Atau composite:

```sql
ON r.tenant_id = c.tenant_id
AND r.case_number = c.case_number
```

Atau range-based:

```sql
ON e.occurred_at >= p.valid_from
AND e.occurred_at <  p.valid_to
```

Atau multiple condition:

```sql
ON a.case_id = c.id
AND a.assignment_role = 'PRIMARY'
AND a.ended_at IS NULL
```

Join predicate adalah bagian dari correctness. Predicate tidak lengkap dapat menghasilkan duplicate, false match, atau data leak.

---

## 4. Domain Schema yang Digunakan

Kita gunakan schema konseptual berikut.

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_number TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE officers (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    officer_code TEXT NOT NULL,
    full_name TEXT NOT NULL,
    active BOOLEAN NOT NULL
);

CREATE TABLE case_assignments (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL REFERENCES cases(id),
    officer_id UUID NOT NULL REFERENCES officers(id),
    assignment_role TEXT NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,

    CHECK (assignment_role IN ('PRIMARY', 'SUPPORTING')),
    CHECK (ended_at IS NULL OR ended_at > assigned_at)
);

CREATE TABLE case_evidences (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL REFERENCES cases(id),
    evidence_type TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE case_status_transitions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL REFERENCES cases(id),
    from_status TEXT,
    to_status TEXT NOT NULL,
    transitioned_at TIMESTAMPTZ NOT NULL
);
```

Catatan multi-tenant:

Walaupun `case_assignments.case_id` reference ke `cases.id`, pada sistem multi-tenant biasanya tetap penting menjaga tenant consistency. Dalam beberapa desain, FK composite `(tenant_id, case_id)` lebih defensible.

---

## 5. INNER JOIN

`INNER JOIN` menghasilkan hanya pasangan row yang match.

```sql
SELECT
    c.id,
    c.case_number,
    a.officer_id
FROM cases c
INNER JOIN case_assignments a
  ON a.case_id = c.id;
```

`INNER JOIN` sering ditulis singkat:

```sql
JOIN case_assignments a
  ON a.case_id = c.id
```

Makna:

> Ambil hanya case yang punya minimal satu assignment match.

Jika case tidak punya assignment, case tersebut tidak muncul.

---

## 6. INNER JOIN dan Data Loss yang Tidak Disadari

Business question:

> Tampilkan semua open case.

Query salah:

```sql
SELECT
    c.id,
    c.case_number,
    a.officer_id
FROM cases c
JOIN case_assignments a
  ON a.case_id = c.id
WHERE c.status = 'OPEN';
```

Jika ada open case yang belum assigned, row itu hilang.

`JOIN` berarti hanya matched rows.

Jika requirement adalah “semua open case, assignment jika ada”, gunakan `LEFT JOIN`.

```sql
SELECT
    c.id,
    c.case_number,
    a.officer_id
FROM cases c
LEFT JOIN case_assignments a
  ON a.case_id = c.id
WHERE c.status = 'OPEN';
```

Namun ini masih bisa duplicate jika case punya banyak assignment.

---

## 7. LEFT JOIN

`LEFT JOIN` mempertahankan semua row dari left relation.

```sql
SELECT
    c.id,
    c.case_number,
    a.officer_id
FROM cases c
LEFT JOIN case_assignments a
  ON a.case_id = c.id;
```

Makna:

> Semua case muncul. Jika ada assignment match, tampilkan assignment. Jika tidak ada, kolom assignment menjadi NULL.

Contoh:

```text
cases:
C1
C2
C3

assignments:
A1 -> C1
A2 -> C1
A3 -> C2
```

Hasil left join:

```text
C1 A1
C1 A2
C2 A3
C3 NULL
```

Grain:

```text
one row per matching case-assignment pair, plus one row for case with no assignment
```

Bukan one row per case.

---

## 8. LEFT JOIN dan Filter Placement: ON vs WHERE

Ini salah satu sumber bug paling umum.

### 8.1 Requirement

> Tampilkan semua case dan active primary assignment jika ada.

### 8.2 Query Salah / Berisiko

```sql
SELECT
    c.id,
    c.case_number,
    a.officer_id
FROM cases c
LEFT JOIN case_assignments a
  ON a.case_id = c.id
WHERE a.assignment_role = 'PRIMARY'
  AND a.ended_at IS NULL;
```

Masalah:

Filter terhadap `a.assignment_role` di `WHERE` membuat unmatched row hilang.

Untuk case tanpa assignment, `a.assignment_role` adalah NULL.

Predicate:

```sql
a.assignment_role = 'PRIMARY'
```

menjadi `UNKNOWN`, sehingga row tidak lolos.

`LEFT JOIN` berubah efektif menjadi `INNER JOIN`.

### 8.3 Query Benar

```sql
SELECT
    c.id,
    c.case_number,
    a.officer_id
FROM cases c
LEFT JOIN case_assignments a
  ON a.case_id = c.id
 AND a.assignment_role = 'PRIMARY'
 AND a.ended_at IS NULL;
```

Filter yang menentukan row assignment mana yang boleh match diletakkan di `ON`.

Sekarang semua case tetap muncul. Assignment hanya muncul jika active primary.

---

## 9. Rule of Thumb: Filter Kanan pada LEFT JOIN

Jika memakai `LEFT JOIN`:

- predicate yang membatasi row kanan yang boleh match biasanya letakkan di `ON`
- predicate yang membatasi row kiri biasanya letakkan di `WHERE`

Contoh:

```sql
SELECT
    c.id,
    c.case_number,
    a.officer_id
FROM cases c
LEFT JOIN case_assignments a
  ON a.case_id = c.id
 AND a.assignment_role = 'PRIMARY'
 AND a.ended_at IS NULL
WHERE c.status = 'OPEN';
```

Makna:

- hanya open cases dari sisi kiri
- assignment kanan hanya active primary jika ada
- open case tanpa active primary tetap muncul

Jika kamu menaruh:

```sql
WHERE a.assignment_role = 'PRIMARY'
```

maka case tanpa assignment hilang.

---

## 10. LEFT JOIN untuk Mencari Missing Relationship

Requirement:

> Cari case yang belum punya assignment.

Pola umum:

```sql
SELECT
    c.id,
    c.case_number
FROM cases c
LEFT JOIN case_assignments a
  ON a.case_id = c.id
WHERE a.id IS NULL;
```

Ini mencari row kiri yang tidak punya match kanan.

Namun untuk kondisi tambahan, hati-hati.

Requirement:

> Cari case yang belum punya active primary assignment.

Lebih jelas pakai `NOT EXISTS`:

```sql
SELECT
    c.id,
    c.case_number
FROM cases c
WHERE NOT EXISTS (
    SELECT 1
    FROM case_assignments a
    WHERE a.case_id = c.id
      AND a.assignment_role = 'PRIMARY'
      AND a.ended_at IS NULL
);
```

Kenapa lebih baik?

- grain tetap one row per case
- tidak ada ambiguity outer join null
- predicate absence lebih eksplisit
- aman dari duplicate child row
- biasanya optimizer bisa mengubah ke anti join

---

## 11. RIGHT JOIN

`RIGHT JOIN` mempertahankan semua row dari right relation.

```sql
SELECT
    c.id,
    c.case_number,
    a.id AS assignment_id
FROM cases c
RIGHT JOIN case_assignments a
  ON a.case_id = c.id;
```

Makna:

> Semua assignment muncul, case muncul jika match.

Namun `RIGHT JOIN` jarang diperlukan. Hampir selalu bisa ditulis ulang sebagai `LEFT JOIN` dengan menukar urutan table.

Lebih readable:

```sql
SELECT
    c.id,
    c.case_number,
    a.id AS assignment_id
FROM case_assignments a
LEFT JOIN cases c
  ON c.id = a.case_id;
```

Style praktis:

> Gunakan `LEFT JOIN` secara konsisten. Hindari `RIGHT JOIN` kecuali ada alasan kuat.

---

## 12. FULL OUTER JOIN

`FULL OUTER JOIN` mempertahankan semua row dari kedua sisi.

```sql
SELECT
    c.id AS case_id,
    i.case_number AS imported_case_number
FROM cases c
FULL OUTER JOIN imported_case_refs i
  ON i.case_number = c.case_number;
```

Makna:

- row yang match muncul bersama
- row hanya di kiri muncul dengan kanan NULL
- row hanya di kanan muncul dengan kiri NULL

Use case:

- reconciliation
- data comparison
- migration validation
- import matching
- audit gap detection

Contoh:

```sql
SELECT
    c.case_number AS internal_case_number,
    s.case_number AS source_case_number
FROM cases c
FULL OUTER JOIN staging_cases s
  ON s.tenant_id = c.tenant_id
 AND s.case_number = c.case_number
WHERE c.id IS NULL
   OR s.case_number IS NULL;
```

Makna:

> Tampilkan case yang hanya ada di salah satu sisi.

Tidak semua database mendukung `FULL OUTER JOIN` secara langsung, misalnya beberapa versi MySQL tidak punya native full outer join.

---

## 13. CROSS JOIN

`CROSS JOIN` menghasilkan cartesian product.

```sql
SELECT
    c.id,
    p.priority
FROM cases c
CROSS JOIN case_priorities p;
```

Jika `cases` 1.000 row dan `case_priorities` 4 row, hasil 4.000 row.

Use case valid:

- generate combinations
- calendar table
- matrix report
- test data
- exhaustive pairing
- dimensional analysis

Contoh generate SLA matrix:

```sql
SELECT
    j.jurisdiction_code,
    p.priority
FROM jurisdictions j
CROSS JOIN case_priorities p;
```

Hasil:

```text
all jurisdiction-priority combinations
```

Namun accidental cross join sangat berbahaya.

---

## 14. Accidental Cross Join

Buruk:

```sql
SELECT
    c.id,
    a.id
FROM cases c
JOIN case_assignments a
  ON c.tenant_id = a.tenant_id;
```

Jika tenant punya 10.000 cases dan 50.000 assignments, hasil bisa ratusan juta row.

Join predicate tidak cukup.

Seharusnya:

```sql
ON a.tenant_id = c.tenant_id
AND a.case_id = c.id
```

Atau jika `case_id` globally unique:

```sql
ON a.case_id = c.id
```

Tapi dalam multi-tenant system, composite predicate sering lebih defensible.

---

## 15. Self Join

Self join adalah join table dengan dirinya sendiri.

Use case:

- hierarchy
- compare records
- find duplicates
- previous/next relationship
- transitions
- temporal overlap

Contoh officer manager hierarchy:

```sql
SELECT
    o.full_name AS officer_name,
    manager.full_name AS manager_name
FROM officers o
LEFT JOIN officers manager
  ON manager.id = o.manager_officer_id;
```

Contoh mencari duplicate case number normalized dalam staging:

```sql
SELECT
    s1.id AS row_1,
    s2.id AS row_2,
    s1.case_number_normalized
FROM staging_cases s1
JOIN staging_cases s2
  ON s1.tenant_id = s2.tenant_id
 AND s1.case_number_normalized = s2.case_number_normalized
 AND s1.id < s2.id;
```

`self join` butuh alias jelas. Tanpa alias, query sulit dibaca.

---

## 16. Semi Join

Semi join secara konsep:

> Ambil row dari left side jika ada match di right side, tetapi jangan gandakan row left.

SQL biasanya mengekspresikan semi join dengan `EXISTS`.

Requirement:

> Ambil case yang punya evidence.

Buruk jika hanya ingin case:

```sql
SELECT
    c.id,
    c.case_number
FROM cases c
JOIN case_evidences e
  ON e.case_id = c.id;
```

Jika satu case punya 10 evidence, case muncul 10 kali.

Bisa pakai `DISTINCT`:

```sql
SELECT DISTINCT
    c.id,
    c.case_number
FROM cases c
JOIN case_evidences e
  ON e.case_id = c.id;
```

Tapi lebih tepat:

```sql
SELECT
    c.id,
    c.case_number
FROM cases c
WHERE EXISTS (
    SELECT 1
    FROM case_evidences e
    WHERE e.case_id = c.id
);
```

Grain tetap one row per case.

---

## 17. Anti Join

Anti join secara konsep:

> Ambil row dari left side jika tidak ada match di right side.

SQL biasanya mengekspresikannya dengan `NOT EXISTS`.

Requirement:

> Ambil case yang tidak punya evidence.

```sql
SELECT
    c.id,
    c.case_number
FROM cases c
WHERE NOT EXISTS (
    SELECT 1
    FROM case_evidences e
    WHERE e.case_id = c.id
);
```

Alternatif left join:

```sql
SELECT
    c.id,
    c.case_number
FROM cases c
LEFT JOIN case_evidences e
  ON e.case_id = c.id
WHERE e.id IS NULL;
```

Keduanya bisa valid. `NOT EXISTS` sering lebih jelas dan lebih aman terhadap duplicate/NULL complexity.

Hindari `NOT IN` jika nullable mungkin muncul.

---

## 18. Join Cardinality

Join cardinality adalah hubungan jumlah row antar relation.

Jenis umum:

```text
one-to-one
one-to-many
many-to-one
many-to-many
```

### 18.1 One-to-One Join

Contoh:

```text
cases
case_confidential_details
```

Satu case maksimal satu confidential detail.

Schema:

```sql
CREATE TABLE case_confidential_details (
    case_id UUID PRIMARY KEY REFERENCES cases(id),
    sealed_reason TEXT NOT NULL
);
```

Join:

```sql
SELECT
    c.id,
    c.case_number,
    d.sealed_reason
FROM cases c
LEFT JOIN case_confidential_details d
  ON d.case_id = c.id;
```

Jika constraint benar, grain tetap one row per case.

### 18.2 One-to-Many Join

```text
cases -> case_evidences
```

Join:

```sql
SELECT
    c.id,
    c.case_number,
    e.id AS evidence_id
FROM cases c
JOIN case_evidences e
  ON e.case_id = c.id;
```

Grain berubah menjadi one row per evidence.

### 18.3 Many-to-Many Join

```text
cases -> case_parties -> parties
```

Join table:

```sql
case_parties(case_id, party_id, role)
```

Query:

```sql
SELECT
    c.id AS case_id,
    p.id AS party_id,
    cp.role
FROM cases c
JOIN case_parties cp
  ON cp.case_id = c.id
JOIN parties p
  ON p.id = cp.party_id;
```

Grain:

```text
one row per case-party-role relationship
```

### 18.4 Many-to-Many Explosion

If one case has many parties and many evidences, joining both directly multiplies.

```sql
SELECT
    c.id,
    p.id AS party_id,
    e.id AS evidence_id
FROM cases c
JOIN case_parties cp ON cp.case_id = c.id
JOIN parties p ON p.id = cp.party_id
JOIN case_evidences e ON e.case_id = c.id;
```

If:

```text
3 parties
5 evidences
```

Result:

```text
15 rows
```

Maybe valid if you need all combinations. Usually not.

---

## 19. Join Explosion

Join explosion terjadi saat beberapa one-to-many relation di-join langsung ke parent.

Example:

```text
case C1:
- 3 assignments
- 5 evidences
- 4 notes
```

Query:

```sql
SELECT
    c.id,
    a.id AS assignment_id,
    e.id AS evidence_id,
    n.id AS note_id
FROM cases c
JOIN case_assignments a ON a.case_id = c.id
JOIN case_evidences e ON e.case_id = c.id
JOIN case_notes n ON n.case_id = c.id
WHERE c.id = :case_id;
```

Rows:

```text
3 × 5 × 4 = 60
```

This may cause:

- inflated counts
- duplicate DTOs
- huge memory use
- slow query
- wrong reports
- pagination impossible
- false perception of data volume
- accidental cartesian-like behavior

---

## 20. Fixing Join Explosion with Pre-Aggregation

Requirement:

> One row per case with counts of assignments, evidences, and notes.

Wrong:

```sql
SELECT
    c.id,
    COUNT(a.id) AS assignment_count,
    COUNT(e.id) AS evidence_count,
    COUNT(n.id) AS note_count
FROM cases c
LEFT JOIN case_assignments a ON a.case_id = c.id
LEFT JOIN case_evidences e ON e.case_id = c.id
LEFT JOIN case_notes n ON n.case_id = c.id
GROUP BY c.id;
```

Counts inflated.

Better:

```sql
WITH assignment_counts AS (
    SELECT
        case_id,
        COUNT(*) AS assignment_count
    FROM case_assignments
    GROUP BY case_id
),
evidence_counts AS (
    SELECT
        case_id,
        COUNT(*) AS evidence_count
    FROM case_evidences
    GROUP BY case_id
),
note_counts AS (
    SELECT
        case_id,
        COUNT(*) AS note_count
    FROM case_notes
    GROUP BY case_id
)
SELECT
    c.id,
    c.case_number,
    COALESCE(ac.assignment_count, 0) AS assignment_count,
    COALESCE(ec.evidence_count, 0) AS evidence_count,
    COALESCE(nc.note_count, 0) AS note_count
FROM cases c
LEFT JOIN assignment_counts ac ON ac.case_id = c.id
LEFT JOIN evidence_counts ec ON ec.case_id = c.id
LEFT JOIN note_counts nc ON nc.case_id = c.id;
```

Each child relation is reduced to one row per case before join.

---

## 21. Fixing Join Explosion with EXISTS

Requirement:

> One row per case that has evidence and has notes.

Wrong:

```sql
SELECT
    c.id,
    c.case_number
FROM cases c
JOIN case_evidences e ON e.case_id = c.id
JOIN case_notes n ON n.case_id = c.id;
```

Duplicates.

Better:

```sql
SELECT
    c.id,
    c.case_number
FROM cases c
WHERE EXISTS (
    SELECT 1
    FROM case_evidences e
    WHERE e.case_id = c.id
)
AND EXISTS (
    SELECT 1
    FROM case_notes n
    WHERE n.case_id = c.id
);
```

Grain remains one row per case.

---

## 22. Fixing Join Explosion with Window Function

Requirement:

> One row per case with latest assignment.

Use window function:

```sql
WITH ranked_assignments AS (
    SELECT
        a.*,
        ROW_NUMBER() OVER (
            PARTITION BY a.case_id
            ORDER BY a.assigned_at DESC, a.id DESC
        ) AS rn
    FROM case_assignments a
)
SELECT
    c.id,
    c.case_number,
    ra.officer_id,
    ra.assigned_at
FROM cases c
LEFT JOIN ranked_assignments ra
  ON ra.case_id = c.id
 AND ra.rn = 1;
```

This chooses one child row per parent.

But ask:

> If there are multiple active assignments, is choosing latest a business rule or masking data corruption?

If rule is one active primary assignment, enforce with constraint:

```sql
CREATE UNIQUE INDEX uq_case_assignments_one_active_primary
ON case_assignments (case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

---

## 23. Join and Aggregation Bugs

Requirement:

> Count evidence per open case.

Correct:

```sql
SELECT
    c.id,
    COUNT(e.id) AS evidence_count
FROM cases c
LEFT JOIN case_evidences e
  ON e.case_id = c.id
WHERE c.status = 'OPEN'
GROUP BY c.id;
```

Now add assignments to display officer:

```sql
SELECT
    c.id,
    a.officer_id,
    COUNT(e.id) AS evidence_count
FROM cases c
LEFT JOIN case_evidences e
  ON e.case_id = c.id
LEFT JOIN case_assignments a
  ON a.case_id = c.id
WHERE c.status = 'OPEN'
GROUP BY c.id, a.officer_id;
```

Now count may be split or inflated depending assignment cardinality.

Better:

1. aggregate evidence separately
2. choose current assignment separately
3. join one-row-per-case derived relations

```sql
WITH evidence_counts AS (
    SELECT
        case_id,
        COUNT(*) AS evidence_count
    FROM case_evidences
    GROUP BY case_id
),
active_primary_assignment AS (
    SELECT
        case_id,
        officer_id
    FROM case_assignments
    WHERE assignment_role = 'PRIMARY'
      AND ended_at IS NULL
)
SELECT
    c.id,
    c.case_number,
    apa.officer_id,
    COALESCE(ec.evidence_count, 0) AS evidence_count
FROM cases c
LEFT JOIN active_primary_assignment apa
  ON apa.case_id = c.id
LEFT JOIN evidence_counts ec
  ON ec.case_id = c.id
WHERE c.status = 'OPEN';
```

This assumes active_primary_assignment one row per case. Enforce it.

---

## 24. Composite Join Predicates

In multi-tenant systems, join predicate often needs tenant.

Risky:

```sql
SELECT
    c.id,
    a.id AS assignment_id
FROM cases c
JOIN case_assignments a
  ON a.case_id = c.id;
```

If `id` globally unique, this is logically okay.

But safer design may use composite tenant-aware consistency:

```sql
ON a.tenant_id = c.tenant_id
AND a.case_id = c.id
```

Even better, schema constraint:

```sql
UNIQUE (tenant_id, id)
```

and composite FK:

```sql
FOREIGN KEY (tenant_id, case_id)
REFERENCES cases (tenant_id, id)
```

This prevents cross-tenant corruption.

Join predicate should reflect domain boundaries, not just technical key.

---

## 25. Non-Equi Joins

Join predicate does not have to be equality.

Example: effective-dated legal rule.

```sql
SELECT
    e.id AS event_id,
    r.rule_code
FROM case_events e
JOIN legal_rules r
  ON r.jurisdiction_code = e.jurisdiction_code
 AND e.occurred_at >= r.valid_from
 AND e.occurred_at <  r.valid_to;
```

Grain depends on rule overlap.

If rules overlap, one event can match multiple rules.

Need constraint to prevent overlap:

```text
For each jurisdiction and rule type, validity ranges must not overlap.
```

Some databases support exclusion constraints for this.

Non-equi join is powerful but easy to get wrong.

---

## 26. Temporal Joins

Requirement:

> Join assignment that was active when event occurred.

```sql
SELECT
    e.id AS event_id,
    a.officer_id
FROM case_events e
JOIN case_assignments a
  ON a.case_id = e.case_id
 AND e.occurred_at >= a.assigned_at
 AND (
      a.ended_at IS NULL
      OR e.occurred_at < a.ended_at
 );
```

This is temporal join.

Important details:

- use half-open intervals `[assigned_at, ended_at)`
- handle `ended_at IS NULL` as still active
- ensure assignment ranges do not overlap if one active officer expected
- indexes may need `(case_id, assigned_at, ended_at)`
- query can be expensive at scale

Temporal correctness is crucial for audit.

---

## 27. Join and NULL

Join predicate with equality:

```sql
ON a.case_id = c.id
```

If either side NULL, equality is `UNKNOWN`, not match.

For inner join, row dropped.

For left join, left row preserved with right columns NULL if no match.

### 27.1 NULL in Join Key Usually Smell

If relationship required:

```sql
case_id UUID NOT NULL REFERENCES cases(id)
```

If nullable:

```sql
case_id UUID REFERENCES cases(id)
```

Then row may not join to parent.

This may be valid for staging data, but should be explicit.

### 27.2 Null-Safe Join

Some databases support null-safe equality.

PostgreSQL:

```sql
ON a.optional_code IS NOT DISTINCT FROM b.optional_code
```

MySQL:

```sql
ON a.optional_code <=> b.optional_code
```

Use carefully. Joining NULL-to-NULL often has surprising semantics.

---

## 28. NATURAL JOIN and USING

SQL supports `USING`:

```sql
SELECT
    c.id,
    c.case_number
FROM cases c
JOIN case_assignments a
  USING (id);
```

But this is wrong if both have `id` but mean different entities.

`USING` can be useful when column names intentionally match:

```sql
JOIN tenant_settings ts
  USING (tenant_id)
```

`NATURAL JOIN` joins automatically on same-named columns.

Avoid `NATURAL JOIN` in production SQL.

Why?

- schema changes can silently change join predicate
- same column name may not mean same domain
- reviewability is poor
- accidental extra join condition possible

Prefer explicit `ON`.

---

## 29. Join Order in SQL Text vs Execution Plan

SQL text:

```sql
FROM cases c
JOIN case_assignments a ON a.case_id = c.id
JOIN officers o ON o.id = a.officer_id
```

Logical result is defined by joins.

Physical execution order may differ.

Optimizer can choose:

- join assignments first
- filter cases first
- use index nested loop
- use hash join
- use merge join
- reorder inner joins
- push predicates

For outer joins, optimizer has fewer reorder freedoms because semantics preserve unmatched rows.

Part 017 will cover execution plans.

For now:

> Write SQL for semantic clarity first. Then inspect plan for performance.

---

## 30. Join Algorithms: Brief Preview

Database may implement join physically using:

### 30.1 Nested Loop Join

For each row on outer side, find matching rows on inner side.

Good when:

- outer side small
- inner side indexed
- highly selective lookup

### 30.2 Hash Join

Build hash table from one side, probe with other.

Good when:

- large equality join
- no useful index
- enough memory

### 30.3 Merge Join

Both sides sorted by join key, then merge.

Good when:

- inputs already sorted
- range/equality join
- large ordered data

You do not choose algorithm in normal SQL. Optimizer chooses.

But schema, index, statistics, and query shape influence choice.

---

## 31. Join and Indexes

For common join:

```sql
JOIN case_assignments a
  ON a.case_id = c.id
```

Index on child FK often important:

```sql
CREATE INDEX idx_case_assignments_case_id
ON case_assignments (case_id);
```

Foreign key constraint does not always automatically create index on referencing column, depending vendor. Primary/unique key on referenced side usually has index, but child side may need explicit index.

Why child FK index matters:

- join performance
- delete/update parent FK checks
- cascade operations
- locking behavior
- lookup child rows by parent

For active assignment query:

```sql
ON a.case_id = c.id
AND a.assignment_role = 'PRIMARY'
AND a.ended_at IS NULL
```

Potential PostgreSQL partial index:

```sql
CREATE INDEX idx_case_assignments_active_primary_by_case
ON case_assignments (case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

Index design will be covered later, but join predicate should hint at needed index.

---

## 32. Join and Java DTO Mapping

DTO:

```java
record CaseListItem(
    UUID caseId,
    String caseNumber,
    UUID officerId
) {}
```

If SQL:

```sql
SELECT
    c.id AS case_id,
    c.case_number,
    a.officer_id
FROM cases c
LEFT JOIN case_assignments a
  ON a.case_id = c.id
 AND a.ended_at IS NULL;
```

This only maps cleanly if there is at most one active assignment per case.

If not, Java receives duplicate case rows.

Common ORM/JDBC symptoms:

- duplicate DTOs in list
- parent object overwritten by last child
- `Map<caseId, DTO>` hides duplicate silently
- pagination count mismatch
- UI shows duplicates
- `DISTINCT` added without understanding
- memory blowup when joining child collections

Rule:

> Before mapping join result to DTO, confirm output grain matches DTO grain.

---

## 33. ORM Joins vs SQL Joins

Hibernate/JPA example:

```java
@Query("""
    select c
    from Case c
    join fetch c.assignments
    where c.status = :status
""")
List<Case> findCasesWithAssignments(CaseStatus status);
```

Underlying SQL may produce multiple rows per case.

ORM then deduplicates entity identity in persistence context, but:

- SQL result still multiplied
- pagination with fetch join collection is dangerous
- memory usage can explode
- count query differs
- duplicate root entities can appear depending query/result handling
- N+1 might be fixed but replaced with cartesian explosion

SQL mastery remains necessary.

---

## 34. Pagination with Joins

Query:

```sql
SELECT
    c.id,
    c.case_number,
    e.id AS evidence_id
FROM cases c
JOIN case_evidences e
  ON e.case_id = c.id
WHERE c.status = 'OPEN'
ORDER BY c.opened_at DESC
LIMIT 50;
```

What does `LIMIT 50` limit?

```text
50 joined rows
```

Not 50 cases.

If one case has 50 evidence rows, page may contain one case.

Correct approach for parent pagination:

1. page parent IDs first
2. fetch children separately or join after limiting parents

Example:

```sql
WITH page_cases AS (
    SELECT
        id,
        case_number,
        opened_at
    FROM cases
    WHERE status = 'OPEN'
    ORDER BY opened_at DESC, id DESC
    LIMIT 50
)
SELECT
    pc.id,
    pc.case_number,
    e.id AS evidence_id
FROM page_cases pc
LEFT JOIN case_evidences e
  ON e.case_id = pc.id
ORDER BY pc.opened_at DESC, pc.id DESC, e.received_at DESC;
```

Still multiple rows per case, but parent page is correct.

Alternative: fetch evidences in second query:

```sql
SELECT *
FROM case_evidences
WHERE case_id IN (:page_case_ids);
```

Then assemble in Java.

---

## 35. When Not to Join

Do not join automatically.

Avoid join when:

- you only need existence -> use `EXISTS`
- you need count -> pre-aggregate
- you need latest child -> rank/window or constrained current table
- you need multiple child collections -> consider separate queries
- you need search -> maybe search index/read model
- you need authorization -> maybe RLS/view/policy
- join would break pagination
- join would inflate data transfer
- ORM fetch join would explode rows

SQL mastery includes knowing when *not* to join.

---

## 36. Join as Graph Traversal

Relations form graph:

```text
cases
  -> case_assignments
      -> officers
  -> case_evidences
  -> case_parties
      -> parties
  -> case_status_transitions
```

A join query traverses graph edges.

Example:

```sql
SELECT
    c.case_number,
    o.full_name
FROM cases c
JOIN case_assignments a
  ON a.case_id = c.id
JOIN officers o
  ON o.id = a.officer_id
WHERE a.assignment_role = 'PRIMARY'
  AND a.ended_at IS NULL;
```

Graph path:

```text
cases -> case_assignments -> officers
```

But unlike object graph traversal, SQL traversal can multiply rows at every edge.

At each edge, ask:

```text
Is this one-to-one, one-to-many, or many-to-many?
Does this edge preserve grain?
Does this edge require filter?
Does this edge require constraint?
```

---

## 37. Join Review Checklist

For every join:

```text
[ ] What is the output grain?
[ ] What is the join type: inner, left, full?
[ ] Why this join type?
[ ] What rows are intentionally excluded?
[ ] What rows are intentionally preserved?
[ ] Is the join predicate complete?
[ ] Are tenant/jurisdiction predicates needed?
[ ] Is this one-to-one, one-to-many, or many-to-many?
[ ] Can this join multiply rows?
[ ] Is row multiplication expected?
[ ] Are filters on the right side of LEFT JOIN in ON or WHERE correctly?
[ ] Is DISTINCT hiding a join problem?
[ ] Would EXISTS be clearer?
[ ] Would pre-aggregation be safer?
[ ] Would a separate query be better?
[ ] Does DTO grain match SQL grain?
[ ] Does pagination happen before or after multiplication?
[ ] Are supporting indexes present?
```

---

## 38. Join Bug Checklist

Look for these bug patterns:

```text
[ ] INNER JOIN used when unmatched parent rows should remain.
[ ] LEFT JOIN followed by WHERE right_table.column = ...
[ ] Join predicate missing tenant_id or key component.
[ ] Join one-to-many but DTO expects one parent row.
[ ] Multiple one-to-many joins causing explosion.
[ ] COUNT inflated due to joined child rows.
[ ] DISTINCT used without explaining why duplicates happen.
[ ] Pagination applied after child join.
[ ] NOT IN used instead of NOT EXISTS.
[ ] NATURAL JOIN used in production query.
[ ] Self join without clear aliases.
[ ] Temporal join with overlapping ranges.
[ ] Nullable join keys not understood.
```

---

## 39. Mini Case Study: Current Primary Officer

### 39.1 Requirement

> Show all open cases and their current primary officer if one exists.

### 39.2 Bad Query

```sql
SELECT
    c.id,
    c.case_number,
    o.full_name
FROM cases c
LEFT JOIN case_assignments a
  ON a.case_id = c.id
LEFT JOIN officers o
  ON o.id = a.officer_id
WHERE c.status = 'OPEN'
  AND a.assignment_role = 'PRIMARY'
  AND a.ended_at IS NULL;
```

Bug:

- `WHERE a.assignment_role = 'PRIMARY'` removes unassigned cases.
- If multiple active primary assignments exist, duplicate cases.
- Constraint assumption not visible.

### 39.3 Better Query

```sql
SELECT
    c.id,
    c.case_number,
    o.full_name AS primary_officer_name
FROM cases c
LEFT JOIN case_assignments a
  ON a.case_id = c.id
 AND a.assignment_role = 'PRIMARY'
 AND a.ended_at IS NULL
LEFT JOIN officers o
  ON o.id = a.officer_id
WHERE c.status = 'OPEN'
ORDER BY c.opened_at DESC, c.id DESC;
```

Supporting invariant:

```sql
CREATE UNIQUE INDEX uq_case_assignments_one_active_primary
ON case_assignments (case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

Now query grain is one row per open case.

---

## 40. Mini Case Study: Evidence Count with Officer

### 40.1 Requirement

> Show open cases, current primary officer, and evidence count.

### 40.2 Bad Query

```sql
SELECT
    c.id,
    c.case_number,
    o.full_name,
    COUNT(e.id) AS evidence_count
FROM cases c
LEFT JOIN case_assignments a
  ON a.case_id = c.id
 AND a.assignment_role = 'PRIMARY'
 AND a.ended_at IS NULL
LEFT JOIN officers o
  ON o.id = a.officer_id
LEFT JOIN case_evidences e
  ON e.case_id = c.id
WHERE c.status = 'OPEN'
GROUP BY c.id, c.case_number, o.full_name;
```

This can be correct only if active primary assignment is at most one row per case.

If not, evidence count can be inflated.

### 40.3 Better Query

```sql
WITH evidence_counts AS (
    SELECT
        case_id,
        COUNT(*) AS evidence_count
    FROM case_evidences
    GROUP BY case_id
),
active_primary_assignment AS (
    SELECT
        case_id,
        officer_id
    FROM case_assignments
    WHERE assignment_role = 'PRIMARY'
      AND ended_at IS NULL
)
SELECT
    c.id,
    c.case_number,
    o.full_name AS primary_officer_name,
    COALESCE(ec.evidence_count, 0) AS evidence_count
FROM cases c
LEFT JOIN active_primary_assignment apa
  ON apa.case_id = c.id
LEFT JOIN officers o
  ON o.id = apa.officer_id
LEFT JOIN evidence_counts ec
  ON ec.case_id = c.id
WHERE c.status = 'OPEN'
ORDER BY c.opened_at DESC, c.id DESC;
```

But still enforce:

```sql
CREATE UNIQUE INDEX uq_case_assignments_one_active_primary
ON case_assignments (case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

---

## 41. Mini Case Study: Reconciliation with FULL OUTER JOIN

Requirement:

> Compare cases in internal database with cases from external staging import.

```sql
SELECT
    c.case_number AS internal_case_number,
    s.case_number AS source_case_number,
    CASE
        WHEN c.id IS NULL THEN 'MISSING_INTERNAL'
        WHEN s.case_number IS NULL THEN 'MISSING_SOURCE'
        ELSE 'MATCHED'
    END AS reconciliation_status
FROM cases c
FULL OUTER JOIN staging_cases s
  ON s.tenant_id = c.tenant_id
 AND s.case_number_normalized = c.case_number_normalized
WHERE c.id IS NULL
   OR s.case_number IS NULL;
```

Use case:

- migration validation
- external source reconciliation
- data quality audit

If database does not support full outer join, emulate with `LEFT JOIN UNION ALL RIGHT/LEFT anti join`.

---

## 42. Mini Case Study: Temporal Assignment at Event Time

Requirement:

> For each case event, show the officer who was primary assignment at the time of the event.

```sql
SELECT
    e.id AS event_id,
    e.case_id,
    e.occurred_at,
    a.officer_id
FROM case_events e
LEFT JOIN case_assignments a
  ON a.case_id = e.case_id
 AND a.assignment_role = 'PRIMARY'
 AND e.occurred_at >= a.assigned_at
 AND (
      a.ended_at IS NULL
      OR e.occurred_at < a.ended_at
 )
ORDER BY e.occurred_at;
```

This query is only safe as one row per event if active primary assignment intervals do not overlap.

Need invariant:

```text
For a given case_id and role PRIMARY, assignment time ranges cannot overlap.
```

If not enforced, one event may join multiple assignments.

---

## 43. Practical Exercises

### Exercise 1 — Determine Grain

Query:

```sql
SELECT
    c.id,
    e.id AS evidence_id
FROM cases c
JOIN case_evidences e
  ON e.case_id = c.id;
```

Answer:

```text
one row per case-evidence pair
```

### Exercise 2 — Fix LEFT JOIN Filter

Bad:

```sql
SELECT
    c.id,
    a.officer_id
FROM cases c
LEFT JOIN case_assignments a
  ON a.case_id = c.id
WHERE a.ended_at IS NULL;
```

Better if requirement is “all cases, active assignment if any”:

```sql
SELECT
    c.id,
    a.officer_id
FROM cases c
LEFT JOIN case_assignments a
  ON a.case_id = c.id
 AND a.ended_at IS NULL;
```

### Exercise 3 — Replace Join with EXISTS

Bad if only need cases with evidence:

```sql
SELECT
    c.id
FROM cases c
JOIN case_evidences e
  ON e.case_id = c.id;
```

Better:

```sql
SELECT
    c.id
FROM cases c
WHERE EXISTS (
    SELECT 1
    FROM case_evidences e
    WHERE e.case_id = c.id
);
```

### Exercise 4 — Avoid Count Inflation

Bad:

```sql
SELECT
    c.id,
    COUNT(e.id) AS evidence_count
FROM cases c
JOIN case_evidences e ON e.case_id = c.id
JOIN case_assignments a ON a.case_id = c.id
GROUP BY c.id;
```

Better:

```sql
WITH evidence_counts AS (
    SELECT
        case_id,
        COUNT(*) AS evidence_count
    FROM case_evidences
    GROUP BY case_id
)
SELECT
    c.id,
    COALESCE(ec.evidence_count, 0) AS evidence_count
FROM cases c
LEFT JOIN evidence_counts ec
  ON ec.case_id = c.id;
```

---

## 44. Koneksi ke Part Berikutnya

Part ini membahas join dan bagaimana relation dapat digabung.

Part berikutnya, `part-007`, akan membahas **aggregation**:

- `COUNT`
- `SUM`
- `AVG`
- `MIN`
- `MAX`
- `GROUP BY`
- `HAVING`
- conditional aggregation
- duplicate amplification
- group grain
- reporting correctness

Aggregation sangat terkait dengan join karena banyak kesalahan aggregate muncul setelah join mengubah multiplicity.

Jika join mengubah grain dan kamu tidak sadar, aggregate hampir pasti salah.

---

## 45. Ringkasan Bagian Ini

Hal penting dari part 006:

1. Join menghasilkan relation baru dari kombinasi tuple.
2. Join bukan object graph loading.
3. Join predicate menentukan pasangan row yang match.
4. `INNER JOIN` menghilangkan unmatched rows.
5. `LEFT JOIN` mempertahankan left rows, tetapi filter kanan di `WHERE` bisa membatalkan outer behavior.
6. Gunakan predicate kanan pada `ON` jika ingin membatasi match dalam `LEFT JOIN`.
7. `RIGHT JOIN` biasanya bisa diganti dengan `LEFT JOIN`.
8. `FULL OUTER JOIN` berguna untuk reconciliation.
9. `CROSS JOIN` menghasilkan cartesian product dan harus disengaja.
10. Self join butuh alias dan predicate jelas.
11. `EXISTS` adalah bentuk semi join yang menjaga grain left side.
12. `NOT EXISTS` adalah bentuk anti join yang aman untuk absence.
13. Join cardinality menentukan apakah grain berubah.
14. Multiple one-to-many joins dapat menyebabkan join explosion.
15. Pre-aggregation mencegah count inflation.
16. Window function dapat memilih satu child row per parent.
17. Composite join predicate penting untuk tenant/domain boundary.
18. Temporal join membutuhkan interval semantics dan overlap constraints.
19. Pagination setelah child join membatasi joined rows, bukan parent rows.
20. DTO grain harus cocok dengan SQL result grain.
21. ORM fetch join tetap menghasilkan SQL row multiplication.
22. Mengetahui kapan tidak join adalah bagian dari SQL mastery.

Kalimat inti:

> Join yang benar dimulai dari pertanyaan grain: satu row hasil query merepresentasikan apa setelah relation digabung?

---

## 46. Referensi

1. PostgreSQL Documentation — Joined Tables.  
   https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-JOIN

2. PostgreSQL Documentation — Table Expressions.  
   https://www.postgresql.org/docs/current/queries-table-expressions.html

3. PostgreSQL Documentation — Subquery Expressions, EXISTS.  
   https://www.postgresql.org/docs/current/functions-subquery.html

4. PostgreSQL Documentation — Indexes.  
   https://www.postgresql.org/docs/current/indexes.html

5. PostgreSQL Documentation — Partial Indexes.  
   https://www.postgresql.org/docs/current/indexes-partial.html

6. MySQL 8.4 Reference Manual — JOIN Clause.  
   https://dev.mysql.com/doc/refman/8.4/en/join.html

7. Microsoft SQL Server Documentation — FROM plus JOIN.  
   https://learn.microsoft.com/en-us/sql/t-sql/queries/from-transact-sql

8. Oracle Database SQL Language Reference — Joins.  
   https://docs.oracle.com/en/database/oracle/oracle-database/23/sqlrf/Joins.html

---

## 47. Status Seri

Seri belum selesai.

Bagian selesai:

- `learn-sql-mastery-for-java-engineers-part-000.md`
- `learn-sql-mastery-for-java-engineers-part-001.md`
- `learn-sql-mastery-for-java-engineers-part-002.md`
- `learn-sql-mastery-for-java-engineers-part-003.md`
- `learn-sql-mastery-for-java-engineers-part-004.md`
- `learn-sql-mastery-for-java-engineers-part-005.md`
- `learn-sql-mastery-for-java-engineers-part-006.md`

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-007.md` — Aggregation, GROUP BY, HAVING, and Analytical Thinking


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-005.md">⬅️ Part 5 — Filtering Deep Dive: Predicates, Ranges, Pattern Matching, and Sargability</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-007.md">Part 7 — Aggregation, GROUP BY, HAVING, and Analytical Thinking ➡️</a>
</div>
