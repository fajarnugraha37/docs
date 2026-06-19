# learn-sql-mastery-for-java-engineers-part-008.md

# Part 8 — Subqueries, Derived Tables, CTEs, and Query Composition

> Seri: SQL Mastery for Java Engineers  
> Bagian: 008 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-007.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-009.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas aggregation dan bagaimana `GROUP BY` mengubah grain.

Bagian ini membahas cara menyusun query kompleks secara bertahap: **query composition**.

Dalam SQL production, query jarang selalu sederhana. Kamu sering perlu:

- filter parent berdasarkan child existence
- menghitung summary dulu lalu join ke parent
- memilih latest row per group
- memecah query besar agar reviewable
- membuat intermediate relation
- menghindari join explosion
- membandingkan data antar tahap
- membangun read model/reporting query
- mengekspresikan workflow hierarchy
- membuat query recursive untuk tree/graph ringan

Teknik utama:

```text
subquery
derived table
common table expression / CTE
correlated subquery
EXISTS
IN
recursive CTE
```

Tujuan bagian ini bukan sekadar mengenal syntax, tetapi memahami:

- kapan memakai subquery
- kapan memakai join
- kapan memakai `EXISTS`
- kapan memakai CTE
- kapan CTE membantu readability
- kapan CTE bisa mengganggu performance
- bagaimana menjaga grain di setiap tahap
- bagaimana menulis query kompleks yang bisa direview
- bagaimana menghindari query spaghetti
- bagaimana berpikir seperti membuat pipeline relation

Kalimat kunci:

> Query composition adalah seni memecah pertanyaan besar menjadi beberapa relation antara yang grain-nya jelas.

---

## 1. Mental Model: Query Result adalah Relation Baru

Dari part sebelumnya:

```sql
SELECT
    case_id,
    COUNT(*) AS evidence_count
FROM case_evidences
GROUP BY case_id
```

Hasilnya bukan sekadar “result set”.

Secara mental, hasilnya adalah relation baru:

```text
EvidenceCount(case_id, evidence_count)
```

Relation itu bisa dipakai lagi:

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
    c.case_number,
    COALESCE(ec.evidence_count, 0) AS evidence_count
FROM cases c
LEFT JOIN evidence_counts ec
  ON ec.case_id = c.id;
```

Ini inti query composition.

SQL memungkinkan kamu membangun relation dari relation lain.

---

## 2. Mengapa Query Composition Penting

Tanpa composition, engineer sering menulis query monolitik:

```sql
SELECT ...
FROM ...
JOIN ...
JOIN ...
JOIN ...
WHERE ...
GROUP BY ...
HAVING ...
ORDER BY ...
```

Masalah query monolitik:

- grain sulit dilacak
- join explosion tersembunyi
- aggregate salah
- predicate tersebar
- logic sulit dites
- sulit direview
- sulit dioptimasi
- sulit debug
- mudah menambahkan `DISTINCT` sebagai plester
- sulit map ke DTO

Query composition membantu:

- memecah tahap
- menamai intermediate result
- menjaga grain
- mengisolasi aggregation
- memisahkan filtering dan enrichment
- membuat query lebih mirip pipeline
- membantu reviewer memahami intent
- memungkinkan reuse di view/materialized view

Namun composition juga bisa disalahgunakan dan membuat query lambat/rumit. Karena itu kita perlu prinsip.

---

## 3. Jenis Subquery

Subquery adalah query di dalam query.

Jenis umum:

```text
scalar subquery
row subquery
table subquery / derived table
correlated subquery
subquery in IN
subquery in EXISTS
subquery in FROM
subquery in SELECT
subquery in WHERE
```

Contoh sederhana:

```sql
SELECT
    id,
    case_number
FROM cases
WHERE id IN (
    SELECT case_id
    FROM case_evidences
);
```

Subquery:

```sql
SELECT case_id
FROM case_evidences
```

menghasilkan set case_id.

---

## 4. Scalar Subquery

Scalar subquery menghasilkan satu value.

Contoh:

```sql
SELECT
    c.id,
    c.case_number,
    (
        SELECT COUNT(*)
        FROM case_evidences e
        WHERE e.case_id = c.id
    ) AS evidence_count
FROM cases c;
```

Subquery di `SELECT` menghasilkan satu angka per row case.

Grain output:

```text
one row per case
```

### 4.1 Kapan Scalar Subquery Cocok

Cocok untuk:

- count child per parent pada query kecil/sedang
- lookup single value
- readability
- query ad-hoc
- when optimizer can decorrelate efficiently

Namun hati-hati:

- bisa dieksekusi per row jika optimizer tidak mengubahnya
- bisa mahal untuk banyak parent
- kadang pre-aggregation lebih jelas

Alternative:

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
    c.case_number,
    COALESCE(ec.evidence_count, 0) AS evidence_count
FROM cases c
LEFT JOIN evidence_counts ec
  ON ec.case_id = c.id;
```

Untuk report besar, pre-aggregation sering lebih jelas.

---

## 5. Scalar Subquery Must Return One Row

Contoh berbahaya:

```sql
SELECT
    c.id,
    (
        SELECT a.officer_id
        FROM case_assignments a
        WHERE a.case_id = c.id
          AND a.ended_at IS NULL
    ) AS active_officer_id
FROM cases c;
```

Jika satu case punya dua active assignments, subquery mengembalikan lebih dari satu row dan query error di banyak database.

Ini bagus karena mengungkap invariant problem.

Jika kamu menambahkan:

```sql
LIMIT 1
```

```sql
SELECT
    c.id,
    (
        SELECT a.officer_id
        FROM case_assignments a
        WHERE a.case_id = c.id
          AND a.ended_at IS NULL
        ORDER BY a.assigned_at DESC
        LIMIT 1
    ) AS active_officer_id
FROM cases c;
```

Maka query jalan, tapi mungkin menutupi data corruption.

Tanyakan:

```text
Apakah business rule memang memilih latest?
Atau seharusnya hanya boleh satu active assignment?
```

Jika hanya boleh satu, enforce dengan constraint.

---

## 6. Subquery in WHERE with IN

```sql
SELECT
    c.id,
    c.case_number
FROM cases c
WHERE c.id IN (
    SELECT e.case_id
    FROM case_evidences e
);
```

Makna:

> Ambil case yang case_id-nya muncul di evidence.

Ini seperti semi join.

Namun `IN` memiliki nuance dengan `NULL`.

Jika subquery menghasilkan duplicate, semantik `IN` tidak berubah.

```text
C1 in (C1, C1, C1) -> TRUE
```

### 6.1 IN vs EXISTS

Equivalent intent:

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

`EXISTS` sering lebih jelas untuk existence.

Use `IN` when:

- subquery is independent and returns simple set
- values are non-null
- readability is good

Use `EXISTS` when:

- correlated condition is natural
- null-safety matters
- checking existence
- multiple predicates on child
- avoiding duplicate amplification

---

## 7. Subquery with NOT IN

Berbahaya jika subquery dapat menghasilkan NULL.

Risky:

```sql
SELECT
    c.id,
    c.case_number
FROM cases c
WHERE c.id NOT IN (
    SELECT a.case_id
    FROM case_assignments a
);
```

Jika `a.case_id` nullable dan ada NULL, result bisa salah.

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

Untuk anti-join, default-kan ke `NOT EXISTS`.

---

## 8. EXISTS

`EXISTS` mengecek apakah subquery menghasilkan minimal satu row.

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

Subquery ini correlated karena mengacu ke `c.id`.

Makna:

> Untuk setiap case, cek apakah ada evidence dengan case_id yang sama.

### 8.1 EXISTS tidak peduli SELECT List

Di dalam `EXISTS`, ini umum:

```sql
SELECT 1
```

Karena value tidak dipakai. Yang penting ada row.

```sql
EXISTS (SELECT 1 ...)
```

sama intent-nya dengan:

```sql
EXISTS (SELECT * ...)
```

Tetapi `SELECT 1` membuat intent lebih jelas.

### 8.2 EXISTS untuk Multiple Conditions

```sql
SELECT
    c.id,
    c.case_number
FROM cases c
WHERE EXISTS (
    SELECT 1
    FROM case_status_transitions t
    WHERE t.case_id = c.id
      AND t.to_status = 'ESCALATED'
      AND t.transitioned_at >= :start
      AND t.transitioned_at < :end
);
```

Makna:

> Case yang pernah escalated dalam periode tertentu.

Grain tetap one row per case.

---

## 9. NOT EXISTS

`NOT EXISTS` mengecek absence.

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

Makna:

> Case yang tidak punya active primary assignment.

Ini sering lebih baik daripada left join + null filter karena intent absence lebih langsung.

---

## 10. Correlated Subquery

Correlated subquery bergantung pada row query luar.

Contoh:

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

Subquery mengacu ke `c.id`.

### 10.1 Performance Mental Model

Naive mental model:

```text
for each case:
    run subquery
```

Database optimizer sering bisa mengubah correlated subquery menjadi semi join/anti join.

Tapi tidak selalu.

Jika query lambat:

- cek execution plan
- cek index pada correlated predicate
- pertimbangkan rewrite ke join/pre-aggregation
- cek selectivity
- cek statistics

Index penting:

```sql
CREATE INDEX idx_case_evidences_case_id
ON case_evidences (case_id);
```

### 10.2 Correlated Subquery in SELECT

```sql
SELECT
    c.id,
    c.case_number,
    (
        SELECT MAX(e.received_at)
        FROM case_evidences e
        WHERE e.case_id = c.id
    ) AS latest_evidence_received_at
FROM cases c;
```

Alternative pre-aggregation:

```sql
WITH latest_evidence AS (
    SELECT
        case_id,
        MAX(received_at) AS latest_evidence_received_at
    FROM case_evidences
    GROUP BY case_id
)
SELECT
    c.id,
    c.case_number,
    le.latest_evidence_received_at
FROM cases c
LEFT JOIN latest_evidence le
  ON le.case_id = c.id;
```

Pre-aggregation makes grain explicit.

---

## 11. Derived Table / Subquery in FROM

Derived table adalah subquery di `FROM`.

```sql
SELECT
    c.id,
    c.case_number,
    ec.evidence_count
FROM cases c
LEFT JOIN (
    SELECT
        case_id,
        COUNT(*) AS evidence_count
    FROM case_evidences
    GROUP BY case_id
) ec
  ON ec.case_id = c.id;
```

Subquery `ec` adalah relation sementara:

```text
EvidenceCount(case_id, evidence_count)
```

Grain `ec`:

```text
one row per case_id
```

Derived table cocok untuk:

- pre-aggregation
- ranking
- filtering after window function
- isolating complex expression
- making group grain explicit
- avoiding join explosion

---

## 12. Derived Table Must Have Alias

SQL biasanya mengharuskan subquery di `FROM` punya alias.

```sql
FROM (
    SELECT ...
) AS ec
```

Alias bukan formalitas. Alias menamai relation sementara.

Gunakan alias bermakna:

```sql
evidence_counts
latest_assignment
open_cases
ranked_transitions
```

Bukan:

```sql
x
t1
sub
```

kecuali query sangat kecil.

---

## 13. CTE: Common Table Expression

CTE memakai `WITH`.

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
    c.case_number,
    COALESCE(ec.evidence_count, 0) AS evidence_count
FROM cases c
LEFT JOIN evidence_counts ec
  ON ec.case_id = c.id;
```

CTE membuat query kompleks lebih terstruktur.

Mental model:

```text
WITH relation_a AS (...)
SELECT ...
FROM relation_a
```

CTE seperti memberi nama untuk intermediate relation.

---

## 14. CTE untuk Readability

Tanpa CTE:

```sql
SELECT
    c.id,
    c.case_number,
    COALESCE(ec.evidence_count, 0) AS evidence_count,
    COALESCE(ac.assignment_count, 0) AS assignment_count
FROM cases c
LEFT JOIN (
    SELECT case_id, COUNT(*) AS evidence_count
    FROM case_evidences
    GROUP BY case_id
) ec ON ec.case_id = c.id
LEFT JOIN (
    SELECT case_id, COUNT(*) AS assignment_count
    FROM case_assignments
    GROUP BY case_id
) ac ON ac.case_id = c.id
WHERE c.status = 'OPEN';
```

Dengan CTE:

```sql
WITH evidence_counts AS (
    SELECT
        case_id,
        COUNT(*) AS evidence_count
    FROM case_evidences
    GROUP BY case_id
),
assignment_counts AS (
    SELECT
        case_id,
        COUNT(*) AS assignment_count
    FROM case_assignments
    GROUP BY case_id
)
SELECT
    c.id,
    c.case_number,
    COALESCE(ec.evidence_count, 0) AS evidence_count,
    COALESCE(ac.assignment_count, 0) AS assignment_count
FROM cases c
LEFT JOIN evidence_counts ec
  ON ec.case_id = c.id
LEFT JOIN assignment_counts ac
  ON ac.case_id = c.id
WHERE c.status = 'OPEN';
```

Lebih mudah direview karena setiap tahap punya nama.

---

## 15. CTE sebagai Pipeline Relation

Contoh query dashboard:

```sql
WITH scoped_cases AS (
    SELECT
        id,
        jurisdiction_code,
        status,
        priority,
        opened_at
    FROM cases
    WHERE tenant_id = :tenant_id
),
open_cases AS (
    SELECT *
    FROM scoped_cases
    WHERE status = 'OPEN'
),
jurisdiction_metrics AS (
    SELECT
        jurisdiction_code,
        COUNT(*) AS open_cases,
        SUM(CASE WHEN priority = 'CRITICAL' THEN 1 ELSE 0 END) AS critical_open_cases
    FROM open_cases
    GROUP BY jurisdiction_code
)
SELECT
    jurisdiction_code,
    open_cases,
    critical_open_cases,
    critical_open_cases * 100.0 / NULLIF(open_cases, 0) AS critical_percentage
FROM jurisdiction_metrics
ORDER BY jurisdiction_code;
```

Pipeline:

```text
cases
-> scoped_cases
-> open_cases
-> jurisdiction_metrics
-> final projection
```

Setiap CTE punya grain:

```text
scoped_cases: one row per case
open_cases: one row per open case
jurisdiction_metrics: one row per jurisdiction
final: one row per jurisdiction
```

Ini sangat penting.

---

## 16. CTE Performance: Optimization Fence atau Inline?

Behavior CTE berbeda antar database dan versi.

Di beberapa database/versi, CTE bisa menjadi optimization fence: database materialize CTE dulu, lalu query luar membaca hasilnya.

Di PostgreSQL modern, non-recursive side-effect-free CTE dapat di-inline oleh planner dalam banyak kasus, tetapi ada opsi `MATERIALIZED` dan `NOT MATERIALIZED`.

Implication:

CTE bisa:

- membantu readability
- menghindari repeated computation jika materialized
- menghambat predicate pushdown jika materialized
- membuat plan lebih buruk jika dipakai tanpa sadar
- membuat plan lebih baik jika memaksa materialization untuk subquery mahal yang dipakai berkali-kali

Prinsip:

> Gunakan CTE untuk clarity, tetapi cek execution plan untuk query performance-critical.

Jangan berasumsi CTE selalu cepat atau selalu lambat.

---

## 17. MATERIALIZED / NOT MATERIALIZED Concept

PostgreSQL-style:

```sql
WITH expensive_summary AS MATERIALIZED (
    SELECT
        case_id,
        COUNT(*) AS evidence_count
    FROM case_evidences
    GROUP BY case_id
)
SELECT ...
```

or:

```sql
WITH filtered_cases AS NOT MATERIALIZED (
    SELECT *
    FROM cases
    WHERE tenant_id = :tenant_id
)
SELECT ...
```

Use cases:

- `MATERIALIZED`: compute once, reuse multiple times, prevent repeated evaluation
- `NOT MATERIALIZED`: allow optimizer to push predicates and inline

Vendor-specific. Use only when you understand planner behavior.

---

## 18. CTE Reuse

CTE can be referenced multiple times.

Example:

```sql
WITH open_cases AS (
    SELECT
        id,
        jurisdiction_code,
        priority
    FROM cases
    WHERE status = 'OPEN'
)
SELECT
    (SELECT COUNT(*) FROM open_cases) AS total_open_cases,
    (SELECT COUNT(*) FROM open_cases WHERE priority = 'CRITICAL') AS critical_open_cases;
```

This is readable but may or may not be optimal depending materialization.

Alternative conditional aggregation:

```sql
SELECT
    COUNT(*) AS total_open_cases,
    SUM(CASE WHEN priority = 'CRITICAL' THEN 1 ELSE 0 END) AS critical_open_cases
FROM cases
WHERE status = 'OPEN';
```

Often simpler and efficient.

Composition should not replace simpler aggregate when simpler is clearer.

---

## 19. CTE for Stepwise Debugging

CTEs make complex query debuggable.

Example:

```sql
WITH scoped_cases AS (...),
active_assignments AS (...),
evidence_counts AS (...),
final_result AS (...)
SELECT *
FROM final_result;
```

During debugging:

```sql
WITH scoped_cases AS (...)
SELECT *
FROM scoped_cases
LIMIT 100;
```

Then inspect next stage.

This is valuable in incident analysis and report reconciliation.

---

## 20. Query Composition and Grain Comments

For complex query, add comments.

```sql
WITH
-- Grain: one row per case visible to current tenant
scoped_cases AS (
    SELECT
        id,
        case_number,
        jurisdiction_code,
        status,
        opened_at
    FROM cases
    WHERE tenant_id = :tenant_id
),

-- Grain: one row per case, evidence count
evidence_counts AS (
    SELECT
        case_id,
        COUNT(*) AS evidence_count
    FROM case_evidences
    WHERE tenant_id = :tenant_id
    GROUP BY case_id
)

SELECT
    sc.id,
    sc.case_number,
    COALESCE(ec.evidence_count, 0) AS evidence_count
FROM scoped_cases sc
LEFT JOIN evidence_counts ec
  ON ec.case_id = sc.id;
```

In production SQL files, comments can be correctness tools.

---

## 21. Subquery in SELECT vs Join to Derived Table

Two ways to get evidence count:

### 21.1 Scalar Subquery

```sql
SELECT
    c.id,
    c.case_number,
    (
        SELECT COUNT(*)
        FROM case_evidences e
        WHERE e.case_id = c.id
    ) AS evidence_count
FROM cases c
WHERE c.status = 'OPEN';
```

### 21.2 Pre-Aggregated Join

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
    c.case_number,
    COALESCE(ec.evidence_count, 0) AS evidence_count
FROM cases c
LEFT JOIN evidence_counts ec
  ON ec.case_id = c.id
WHERE c.status = 'OPEN';
```

### 21.3 Which is Better?

Depends.

Scalar subquery can be fine when:

- parent row count small
- good index on child
- optimizer decorrelates
- query is simple

Pre-aggregated join can be better when:

- many parent rows
- child table large
- multiple child aggregates needed
- avoiding repeated lookup
- report query needs explicit stages
- you need join to multiple summaries

Always inspect plan for critical query.

---

## 22. Subquery in WHERE vs Join

Requirement:

> Cases that have at least one evidence.

Option A:

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

Option B:

```sql
SELECT DISTINCT
    c.id,
    c.case_number
FROM cases c
JOIN case_evidences e
  ON e.case_id = c.id;
```

Prefer A for existence.

Why?

- preserves grain
- no duplicate parent rows
- intent clearer
- no `DISTINCT` patch
- often optimizer can implement as semi join

---

## 23. CTE and Authorization Scope

A good pattern is to scope data early.

```sql
WITH scoped_cases AS (
    SELECT
        id,
        case_number,
        status,
        priority,
        opened_at
    FROM cases
    WHERE tenant_id = :tenant_id
      AND jurisdiction_code = :jurisdiction_code
)
SELECT
    id,
    case_number,
    status
FROM scoped_cases
WHERE status = 'OPEN';
```

This makes security/tenant boundary visible.

But be careful: if CTE materialization prevents predicate pushdown, performance may vary. Still, readability and safety often justify explicit scoped relation in complex queries.

For strict security, prefer database-enforced RLS or views when appropriate.

---

## 24. CTE and Pre-Aggregation to Avoid Join Explosion

Requirement:

> Open cases with evidence count, assignment count, and latest transition time.

```sql
WITH scoped_cases AS (
    SELECT
        id,
        case_number,
        opened_at
    FROM cases
    WHERE tenant_id = :tenant_id
      AND status = 'OPEN'
),
evidence_counts AS (
    SELECT
        case_id,
        COUNT(*) AS evidence_count
    FROM case_evidences
    WHERE tenant_id = :tenant_id
    GROUP BY case_id
),
assignment_counts AS (
    SELECT
        case_id,
        COUNT(*) AS assignment_count
    FROM case_assignments
    WHERE tenant_id = :tenant_id
    GROUP BY case_id
),
latest_transition AS (
    SELECT
        case_id,
        MAX(transitioned_at) AS latest_transitioned_at
    FROM case_status_transitions
    WHERE tenant_id = :tenant_id
    GROUP BY case_id
)
SELECT
    sc.id,
    sc.case_number,
    COALESCE(ec.evidence_count, 0) AS evidence_count,
    COALESCE(ac.assignment_count, 0) AS assignment_count,
    lt.latest_transitioned_at
FROM scoped_cases sc
LEFT JOIN evidence_counts ec
  ON ec.case_id = sc.id
LEFT JOIN assignment_counts ac
  ON ac.case_id = sc.id
LEFT JOIN latest_transition lt
  ON lt.case_id = sc.id
ORDER BY sc.opened_at DESC, sc.id DESC;
```

Each CTE returns one row per case, so final joins preserve one row per case.

---

## 25. CTE for Latest Row per Group

Requirement:

> Latest status transition per case.

Aggregation gives timestamp:

```sql
SELECT
    case_id,
    MAX(transitioned_at) AS latest_transitioned_at
FROM case_status_transitions
GROUP BY case_id;
```

But if you need full row, use window function:

```sql
WITH ranked_transitions AS (
    SELECT
        t.*,
        ROW_NUMBER() OVER (
            PARTITION BY t.case_id
            ORDER BY t.transitioned_at DESC, t.id DESC
        ) AS rn
    FROM case_status_transitions t
)
SELECT
    case_id,
    from_status,
    to_status,
    transitioned_at
FROM ranked_transitions
WHERE rn = 1;
```

This pattern will be deeper in part 010.

Key idea:

```text
rank in CTE, filter in outer query
```

Because window function result is not available in same-level `WHERE`.

---

## 26. CTE for Pagination Parent First

Requirement:

> Page 50 open cases, then include evidence count.

```sql
WITH page_cases AS (
    SELECT
        id,
        case_number,
        opened_at
    FROM cases
    WHERE tenant_id = :tenant_id
      AND status = 'OPEN'
    ORDER BY opened_at DESC, id DESC
    LIMIT :limit
),
evidence_counts AS (
    SELECT
        e.case_id,
        COUNT(*) AS evidence_count
    FROM case_evidences e
    JOIN page_cases pc
      ON pc.id = e.case_id
    GROUP BY e.case_id
)
SELECT
    pc.id,
    pc.case_number,
    pc.opened_at,
    COALESCE(ec.evidence_count, 0) AS evidence_count
FROM page_cases pc
LEFT JOIN evidence_counts ec
  ON ec.case_id = pc.id
ORDER BY pc.opened_at DESC, pc.id DESC;
```

Why this is good:

- pagination happens at parent grain
- evidence aggregation only for page cases
- avoids joining child before limit
- final grain one row per case

---

## 27. LATERAL Subquery / APPLY Preview

Some databases support lateral joins.

PostgreSQL:

```sql
SELECT
    c.id,
    c.case_number,
    latest_evidence.id AS latest_evidence_id,
    latest_evidence.received_at
FROM cases c
LEFT JOIN LATERAL (
    SELECT
        e.id,
        e.received_at
    FROM case_evidences e
    WHERE e.case_id = c.id
    ORDER BY e.received_at DESC, e.id DESC
    LIMIT 1
) latest_evidence
  ON TRUE;
```

SQL Server has `CROSS APPLY` / `OUTER APPLY`.

Use case:

- top-1 child per parent
- correlated derived table
- per-row limited lookup
- latest related record

This is powerful but vendor-specific.

Alternative: window function CTE.

---

## 28. Recursive CTE

Recursive CTE lets SQL traverse hierarchical/recursive structures.

Example domain:

```text
organization_units
- id
- parent_id
- name
```

Query descendants:

```sql
WITH RECURSIVE org_tree AS (
    SELECT
        id,
        parent_id,
        name,
        0 AS depth
    FROM organization_units
    WHERE id = :root_id

    UNION ALL

    SELECT
        child.id,
        child.parent_id,
        child.name,
        parent.depth + 1 AS depth
    FROM organization_units child
    JOIN org_tree parent
      ON child.parent_id = parent.id
)
SELECT
    id,
    parent_id,
    name,
    depth
FROM org_tree
ORDER BY depth, name;
```

### 28.1 How Recursive CTE Works

Recursive CTE has:

1. anchor query
2. recursive query
3. union between them

Anchor:

```sql
SELECT ... WHERE id = :root_id
```

Recursive term:

```sql
SELECT child...
FROM organization_units child
JOIN org_tree parent ON ...
```

The database repeatedly applies recursive term until no new rows.

---

## 29. Recursive CTE for Case Escalation Chain

Suppose escalation can link to previous escalation.

```sql
CREATE TABLE escalation_events (
    id UUID PRIMARY KEY,
    case_id UUID NOT NULL,
    previous_escalation_id UUID REFERENCES escalation_events(id),
    escalation_level TEXT NOT NULL,
    escalated_at TIMESTAMPTZ NOT NULL
);
```

Trace chain:

```sql
WITH RECURSIVE escalation_chain AS (
    SELECT
        id,
        previous_escalation_id,
        escalation_level,
        escalated_at,
        0 AS depth
    FROM escalation_events
    WHERE id = :latest_escalation_id

    UNION ALL

    SELECT
        prev.id,
        prev.previous_escalation_id,
        prev.escalation_level,
        prev.escalated_at,
        ec.depth + 1 AS depth
    FROM escalation_events prev
    JOIN escalation_chain ec
      ON prev.id = ec.previous_escalation_id
)
SELECT *
FROM escalation_chain
ORDER BY depth;
```

Use with care:

- prevent cycles
- limit depth
- index parent/reference column
- understand performance
- not replacement for graph database for complex graph traversal

---

## 30. Recursive CTE Cycle Protection

Recursive queries can loop if data has cycles.

Some databases support `CYCLE` clause. Otherwise manually track path.

PostgreSQL-style array path:

```sql
WITH RECURSIVE org_tree AS (
    SELECT
        id,
        parent_id,
        name,
        ARRAY[id] AS path,
        0 AS depth
    FROM organization_units
    WHERE id = :root_id

    UNION ALL

    SELECT
        child.id,
        child.parent_id,
        child.name,
        parent.path || child.id,
        parent.depth + 1
    FROM organization_units child
    JOIN org_tree parent
      ON child.parent_id = parent.id
    WHERE NOT child.id = ANY(parent.path)
      AND parent.depth < 100
)
SELECT *
FROM org_tree;
```

Cycle protection matters in user-maintained hierarchies.

---

## 31. Query Decomposition Strategy

When facing complex business question, decompose.

Example requirement:

> Show open cases for tenant, with current primary officer, evidence count, latest status transition, and whether escalated in last 30 days.

Decompose:

```text
1. scoped open cases
2. active primary assignment
3. officer names
4. evidence counts per case
5. latest transition per case
6. escalation existence in last 30 days
7. final projection
```

SQL:

```sql
WITH scoped_cases AS (
    SELECT
        id,
        case_number,
        opened_at
    FROM cases
    WHERE tenant_id = :tenant_id
      AND status = 'OPEN'
),
active_primary_assignment AS (
    SELECT
        case_id,
        officer_id
    FROM case_assignments
    WHERE tenant_id = :tenant_id
      AND assignment_role = 'PRIMARY'
      AND ended_at IS NULL
),
evidence_counts AS (
    SELECT
        case_id,
        COUNT(*) AS evidence_count
    FROM case_evidences
    WHERE tenant_id = :tenant_id
    GROUP BY case_id
),
latest_transition AS (
    SELECT
        case_id,
        MAX(transitioned_at) AS latest_transitioned_at
    FROM case_status_transitions
    WHERE tenant_id = :tenant_id
    GROUP BY case_id
),
recent_escalations AS (
    SELECT DISTINCT
        case_id
    FROM case_status_transitions
    WHERE tenant_id = :tenant_id
      AND to_status = 'ESCALATED'
      AND transitioned_at >= :thirty_days_ago
)
SELECT
    sc.id,
    sc.case_number,
    o.full_name AS primary_officer_name,
    COALESCE(ec.evidence_count, 0) AS evidence_count,
    lt.latest_transitioned_at,
    CASE WHEN re.case_id IS NOT NULL THEN TRUE ELSE FALSE END AS escalated_recently
FROM scoped_cases sc
LEFT JOIN active_primary_assignment apa
  ON apa.case_id = sc.id
LEFT JOIN officers o
  ON o.id = apa.officer_id
LEFT JOIN evidence_counts ec
  ON ec.case_id = sc.id
LEFT JOIN latest_transition lt
  ON lt.case_id = sc.id
LEFT JOIN recent_escalations re
  ON re.case_id = sc.id
ORDER BY sc.opened_at DESC, sc.id DESC;
```

Review each CTE grain.

Potential issue:

- `active_primary_assignment` must be one row per case
- enforce with partial unique index
- `recent_escalations` uses DISTINCT one row per case
- `latest_transition` returns one row per case but only timestamp, not full row

---

## 32. Avoiding CTE Spaghetti

CTE can improve clarity, but too many CTEs can become spaghetti.

Smells:

- 15+ CTEs with unclear names
- CTEs depend on many previous CTEs unpredictably
- same filter repeated inconsistently
- grain not documented
- CTE names like `a`, `b`, `final2`
- CTEs used to hide bad data model
- performance impossible to reason about
- business logic duplicated across reports

Better:

- name each stage by relation meaning
- comment grain
- keep each CTE focused
- avoid unnecessary CTEs
- consider view/materialized view for stable concepts
- break into tested database view if reused
- move repeated metrics to semantic layer/read model
- inspect execution plan

---

## 33. CTE Naming Guidelines

Good CTE names:

```text
scoped_cases
open_cases
active_primary_assignments
evidence_counts
latest_transitions
ranked_assignments
monthly_case_metrics
first_escalations
case_page
```

Bad names:

```text
tmp
x
data
cte1
cte2
final_final
foo
```

Name by relation meaning, not technical accident.

---

## 34. Composition Pattern Catalog

### 34.1 Existence

```sql
WHERE EXISTS (...)
```

Use for:

```text
parent has child
```

### 34.2 Absence

```sql
WHERE NOT EXISTS (...)
```

Use for:

```text
parent lacks child
```

### 34.3 Pre-Aggregation

```sql
WITH child_counts AS (
    SELECT parent_id, COUNT(*) ...
)
```

Use for:

```text
one row per parent with child summary
```

### 34.4 Ranking then Filtering

```sql
WITH ranked AS (
    SELECT ..., ROW_NUMBER() OVER (...) AS rn
)
SELECT ...
WHERE rn = 1
```

Use for:

```text
latest/top row per group
```

### 34.5 Parent Pagination First

```sql
WITH page AS (
    SELECT parent...
    ORDER BY ...
    LIMIT ...
)
SELECT ...
FROM page
LEFT JOIN ...
```

Use for:

```text
avoid limiting child-joined rows
```

### 34.6 Recursive Traversal

```sql
WITH RECURSIVE tree AS (...)
```

Use for:

```text
hierarchy traversal
```

### 34.7 Scoped Data

```sql
WITH scoped AS (
    SELECT ...
    WHERE tenant_id = :tenant
)
```

Use for:

```text
make authorization/tenant boundary explicit
```

---

## 35. Composition and Testing

Complex query should be testable at intermediate stage.

For each CTE:

```text
Can I run this CTE alone?
Do I know its grain?
Do I know expected row count?
Do I know uniqueness?
Do I know nullability?
Do I know whether it can duplicate parent?
```

Example test queries:

```sql
-- Check active_primary_assignment duplicates
SELECT
    case_id,
    COUNT(*)
FROM active_primary_assignment
GROUP BY case_id
HAVING COUNT(*) > 1;
```

For production validation, convert to direct query:

```sql
SELECT
    case_id,
    COUNT(*)
FROM case_assignments
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL
GROUP BY case_id
HAVING COUNT(*) > 1;
```

If this returns rows, final query may duplicate case.

---

## 36. Composition and Materialized Views

If a CTE pipeline becomes a stable concept, consider view/materialized view.

Example:

```sql
CREATE VIEW case_current_primary_assignment AS
SELECT
    case_id,
    officer_id
FROM case_assignments
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

But only safe if invariant ensures one row per case.

Materialized view:

```sql
CREATE MATERIALIZED VIEW case_evidence_counts AS
SELECT
    case_id,
    COUNT(*) AS evidence_count
FROM case_evidences
GROUP BY case_id;
```

Trade-offs:

- view centralizes logic
- materialized view improves read performance
- refresh strategy required
- dependency management needed
- stale data possible
- permissions can be simplified
- query plan may be hidden

---

## 37. Composition and Java Code

Avoid building complex SQL by unsafe string concatenation.

Use:

- jOOQ for type-safe SQL composition
- MyBatis with careful dynamic SQL
- Spring NamedParameterJdbcTemplate
- query objects/specifications with caution
- database views for stable query contracts
- repository methods with explicit SQL for critical queries

For optional filters, dynamic SQL must preserve parameter binding.

Bad:

```java
sql += " AND status = '" + status + "'";
```

Good conceptual pattern:

```java
if (status != null) {
    predicates.add("status = :status");
    params.addValue("status", status.name());
}
```

For very complex analytical SQL, keeping SQL in `.sql` files can improve reviewability.

---

## 38. Composition Decision Matrix

| Need | Prefer |
|---|---|
| parent has child | `EXISTS` |
| parent lacks child | `NOT EXISTS` |
| child count per parent | pre-aggregation CTE/derived table |
| latest child per parent | window function CTE or lateral |
| many optional filters | safe dynamic SQL/query builder |
| all dimension values including zero | dimension table + left join |
| recursive hierarchy | recursive CTE |
| repeated report logic | view/materialized view |
| high-frequency expensive metric | summary table/read model |
| avoid child join pagination bug | parent page CTE first |
| compare two datasets | full outer join / set operations |

---

## 39. Common Composition Bugs

### Bug 1 — CTE Grain Not Known

```sql
WITH active_assignment AS (...)
SELECT ...
```

But active_assignment returns multiple rows per case.

### Bug 2 — CTE Hides Bad Join

A CTE can make query look clean while preserving row multiplication.

### Bug 3 — Scalar Subquery Returns Multiple Rows

A supposedly single value is not constrained.

### Bug 4 — NOT IN with NULL

Use `NOT EXISTS`.

### Bug 5 — CTE Materialization Hurts Pushdown

Performance regression after refactor.

### Bug 6 — DISTINCT in CTE Hides Data Quality Problem

Deduping without understanding duplicate source.

### Bug 7 — Pagination After Child Join

Limit applies to joined rows.

### Bug 8 — Recursive CTE Without Cycle Protection

Can loop or explode.

### Bug 9 — Optional Filter OR Pattern Kills Plan

`(:param IS NULL OR col = :param)` everywhere.

### Bug 10 — Repeated Business Logic Across CTEs

Slightly different definitions create inconsistent reports.

---

## 40. Mini Case Study: Case List Read Query

Requirement:

> Show paginated open cases with evidence count and active primary officer.

```sql
WITH page_cases AS (
    SELECT
        id,
        case_number,
        opened_at
    FROM cases
    WHERE tenant_id = :tenant_id
      AND status = 'OPEN'
    ORDER BY opened_at DESC, id DESC
    LIMIT :limit
),
evidence_counts AS (
    SELECT
        e.case_id,
        COUNT(*) AS evidence_count
    FROM case_evidences e
    JOIN page_cases pc
      ON pc.id = e.case_id
    GROUP BY e.case_id
),
active_primary_assignment AS (
    SELECT
        a.case_id,
        a.officer_id
    FROM case_assignments a
    JOIN page_cases pc
      ON pc.id = a.case_id
    WHERE a.assignment_role = 'PRIMARY'
      AND a.ended_at IS NULL
)
SELECT
    pc.id,
    pc.case_number,
    pc.opened_at,
    o.full_name AS primary_officer_name,
    COALESCE(ec.evidence_count, 0) AS evidence_count
FROM page_cases pc
LEFT JOIN evidence_counts ec
  ON ec.case_id = pc.id
LEFT JOIN active_primary_assignment apa
  ON apa.case_id = pc.id
LEFT JOIN officers o
  ON o.id = apa.officer_id
ORDER BY pc.opened_at DESC, pc.id DESC;
```

Review:

```text
page_cases: one row per case
evidence_counts: one row per case
active_primary_assignment: must be one row per case
final: one row per case if invariant holds
```

Constraint needed:

```sql
CREATE UNIQUE INDEX uq_case_assignments_one_active_primary
ON case_assignments (case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

---

## 41. Mini Case Study: Cases with No Evidence and No Active Assignment

Requirement:

> Find open cases that have no evidence and no active primary assignment.

```sql
SELECT
    c.id,
    c.case_number
FROM cases c
WHERE c.tenant_id = :tenant_id
  AND c.status = 'OPEN'
  AND NOT EXISTS (
      SELECT 1
      FROM case_evidences e
      WHERE e.case_id = c.id
  )
  AND NOT EXISTS (
      SELECT 1
      FROM case_assignments a
      WHERE a.case_id = c.id
        AND a.assignment_role = 'PRIMARY'
        AND a.ended_at IS NULL
  )
ORDER BY c.opened_at DESC, c.id DESC;
```

Why good:

- grain one row per case
- no join multiplication
- absence semantics explicit
- no `NOT IN` null trap

---

## 42. Mini Case Study: First Escalation per Case

Requirement:

> For each case, show first escalation timestamp.

```sql
WITH first_escalation AS (
    SELECT
        case_id,
        MIN(transitioned_at) AS first_escalated_at
    FROM case_status_transitions
    WHERE to_status = 'ESCALATED'
    GROUP BY case_id
)
SELECT
    c.id,
    c.case_number,
    fe.first_escalated_at
FROM cases c
LEFT JOIN first_escalation fe
  ON fe.case_id = c.id;
```

If need full transition row:

```sql
WITH ranked_escalations AS (
    SELECT
        t.*,
        ROW_NUMBER() OVER (
            PARTITION BY t.case_id
            ORDER BY t.transitioned_at ASC, t.id ASC
        ) AS rn
    FROM case_status_transitions t
    WHERE t.to_status = 'ESCALATED'
)
SELECT
    c.id,
    c.case_number,
    re.transitioned_at AS first_escalated_at,
    re.from_status,
    re.to_status
FROM cases c
LEFT JOIN ranked_escalations re
  ON re.case_id = c.id
 AND re.rn = 1;
```

---

## 43. Mini Case Study: Organization Hierarchy Scope

Requirement:

> Show cases assigned to officers under a manager's organization subtree.

Assume:

```sql
officers(id, manager_officer_id, full_name)
case_assignments(case_id, officer_id, ended_at)
```

Recursive CTE:

```sql
WITH RECURSIVE officer_tree AS (
    SELECT
        id,
        manager_officer_id,
        full_name,
        0 AS depth
    FROM officers
    WHERE id = :manager_officer_id

    UNION ALL

    SELECT
        child.id,
        child.manager_officer_id,
        child.full_name,
        parent.depth + 1
    FROM officers child
    JOIN officer_tree parent
      ON child.manager_officer_id = parent.id
),
active_assigned_cases AS (
    SELECT DISTINCT
        a.case_id
    FROM case_assignments a
    JOIN officer_tree ot
      ON ot.id = a.officer_id
    WHERE a.ended_at IS NULL
)
SELECT
    c.id,
    c.case_number,
    c.status
FROM cases c
JOIN active_assigned_cases aac
  ON aac.case_id = c.id
ORDER BY c.opened_at DESC;
```

Review:

- `officer_tree`: one row per officer in subtree
- `active_assigned_cases`: one row per case due to `DISTINCT`
- final: one row per case if case_id unique

Potential issue:

- recursive cycle
- very large subtree
- assignment duplicates
- `DISTINCT` may hide multiple active assignments; maybe valid if metric is cases

---

## 44. Practical Exercises

### Exercise 1 — Replace JOIN with EXISTS

Bad if only need cases:

```sql
SELECT DISTINCT
    c.id,
    c.case_number
FROM cases c
JOIN case_evidences e
  ON e.case_id = c.id;
```

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
);
```

### Exercise 2 — Pre-Aggregate Child Counts

Bad:

```sql
SELECT
    c.id,
    COUNT(e.id),
    COUNT(a.id)
FROM cases c
LEFT JOIN case_evidences e ON e.case_id = c.id
LEFT JOIN case_assignments a ON a.case_id = c.id
GROUP BY c.id;
```

Better:

```sql
WITH evidence_counts AS (
    SELECT case_id, COUNT(*) AS evidence_count
    FROM case_evidences
    GROUP BY case_id
),
assignment_counts AS (
    SELECT case_id, COUNT(*) AS assignment_count
    FROM case_assignments
    GROUP BY case_id
)
SELECT
    c.id,
    COALESCE(ec.evidence_count, 0) AS evidence_count,
    COALESCE(ac.assignment_count, 0) AS assignment_count
FROM cases c
LEFT JOIN evidence_counts ec ON ec.case_id = c.id
LEFT JOIN assignment_counts ac ON ac.case_id = c.id;
```

### Exercise 3 — Identify CTE Grain

```sql
WITH active_assignments AS (
    SELECT
        case_id,
        officer_id
    FROM case_assignments
    WHERE ended_at IS NULL
)
SELECT
    c.id,
    aa.officer_id
FROM cases c
LEFT JOIN active_assignments aa
  ON aa.case_id = c.id;
```

Question:

```text
Is final grain one row per case?
```

Answer:

Only if active_assignments has at most one row per case. Otherwise final duplicates cases.

### Exercise 4 — Recursive CTE Risk

What can go wrong?

```sql
WITH RECURSIVE tree AS (...)
```

Answer:

- cycle
- unbounded depth
- huge result
- missing index
- duplicate traversal paths
- incorrect anchor
- incorrect recursive join predicate

---

## 45. Query Composition Checklist

```text
[ ] What is the business question?
[ ] Can it be decomposed into named relation stages?
[ ] What is the grain of each stage?
[ ] Does each CTE/derived table return expected uniqueness?
[ ] Are child relations pre-aggregated before joining?
[ ] Is EXISTS better than JOIN?
[ ] Is NOT EXISTS better than NOT IN?
[ ] Are authorization/tenant filters applied consistently?
[ ] Is pagination done at correct grain?
[ ] Is DISTINCT justified?
[ ] Are scalar subqueries guaranteed to return one row?
[ ] Are correlated subqueries indexed?
[ ] Could CTE materialization affect performance?
[ ] Is recursive CTE cycle-safe?
[ ] Would a view/materialized view/read model be better?
[ ] Is the final DTO grain correct?
```

---

## 46. Koneksi ke Part Berikutnya

Part ini membahas query composition.

Part berikutnya, `part-009`, akan membahas set operations:

- `UNION`
- `UNION ALL`
- `INTERSECT`
- `EXCEPT`
- duplicate handling
- type compatibility
- reconciliation
- comparison queries
- set operations vs joins

Set operations adalah cara lain menyusun query kompleks, tetapi berbasis operasi antar result sets, bukan relationship join.

---

## 47. Ringkasan Bagian Ini

Hal penting dari part 008:

1. Hasil query adalah relation baru yang bisa dikomposisi.
2. Subquery bisa muncul di `SELECT`, `WHERE`, atau `FROM`.
3. Scalar subquery harus menghasilkan satu value.
4. `IN` cocok untuk set membership, tetapi hati-hati dengan NULL dan list besar.
5. `NOT EXISTS` lebih aman untuk anti-join daripada `NOT IN`.
6. `EXISTS` menjaga grain parent dan cocok untuk existence.
7. Derived table adalah subquery di `FROM` yang menjadi relation sementara.
8. CTE memberi nama pada intermediate relation.
9. CTE membantu readability, debugging, dan pre-aggregation.
10. CTE bisa berpengaruh pada performance tergantung database/version.
11. Pre-aggregation mencegah join explosion.
12. Parent pagination sebaiknya dilakukan sebelum join child.
13. Window function sering dipakai dalam CTE untuk latest/top row per group.
14. Recursive CTE berguna untuk hierarchy, tetapi butuh cycle/depth protection.
15. Setiap CTE harus punya grain yang jelas.
16. Query kompleks harus dipikirkan sebagai pipeline relation.
17. Composition yang baik membuat SQL lebih defensible dan reviewable.

Kalimat inti:

> Query composition yang baik bukan sekadar memecah SQL panjang; ia membangun pipeline relation yang setiap tahapnya punya grain, predicate, dan invariant yang jelas.

---

## 48. Referensi

1. PostgreSQL Documentation — WITH Queries / Common Table Expressions.  
   https://www.postgresql.org/docs/current/queries-with.html

2. PostgreSQL Documentation — Subquery Expressions.  
   https://www.postgresql.org/docs/current/functions-subquery.html

3. PostgreSQL Documentation — Table Expressions.  
   https://www.postgresql.org/docs/current/queries-table-expressions.html

4. PostgreSQL Documentation — SELECT.  
   https://www.postgresql.org/docs/current/sql-select.html

5. PostgreSQL Documentation — LATERAL Subqueries.  
   https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-LATERAL

6. MySQL 8.4 Reference Manual — Subqueries.  
   https://dev.mysql.com/doc/refman/8.4/en/subqueries.html

7. MySQL 8.4 Reference Manual — WITH Common Table Expressions.  
   https://dev.mysql.com/doc/refman/8.4/en/with.html

8. SQL Server Documentation — WITH common_table_expression.  
   https://learn.microsoft.com/en-us/sql/t-sql/queries/with-common-table-expression-transact-sql

9. Oracle Database SQL Language Reference — Subqueries.  
   https://docs.oracle.com/en/database/oracle/oracle-database/23/sqlrf/Using-Subqueries.html

---

## 49. Status Seri

Seri belum selesai.

Bagian selesai:

- `learn-sql-mastery-for-java-engineers-part-000.md`
- `learn-sql-mastery-for-java-engineers-part-001.md`
- `learn-sql-mastery-for-java-engineers-part-002.md`
- `learn-sql-mastery-for-java-engineers-part-003.md`
- `learn-sql-mastery-for-java-engineers-part-004.md`
- `learn-sql-mastery-for-java-engineers-part-005.md`
- `learn-sql-mastery-for-java-engineers-part-006.md`
- `learn-sql-mastery-for-java-engineers-part-007.md`
- `learn-sql-mastery-for-java-engineers-part-008.md`

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-009.md` — Set Operations: UNION, INTERSECT, EXCEPT

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-007.md">⬅️ Part 7 — Aggregation, GROUP BY, HAVING, and Analytical Thinking</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-009.md">Part 9 — Set Operations: UNION, INTERSECT, EXCEPT ➡️</a>
</div>
