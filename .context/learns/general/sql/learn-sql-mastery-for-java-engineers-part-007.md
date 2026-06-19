# learn-sql-mastery-for-java-engineers-part-007.md

# Part 7 — Aggregation, GROUP BY, HAVING, and Analytical Thinking

> Seri: SQL Mastery for Java Engineers  
> Bagian: 007 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-006.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-008.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas join dan bagaimana join dapat mengubah grain hasil query.

Bagian ini membahas operasi yang juga mengubah grain secara eksplisit: **aggregation**.

Aggregation adalah cara SQL menjawab pertanyaan seperti:

```text
Berapa jumlah case per status?
Berapa evidence per case?
Berapa rata-rata durasi penyelesaian case?
Berapa case yang overdue per jurisdiction?
Berapa enforcement action yang issued per bulan?
Berapa officer yang memiliki lebih dari 20 active case?
```

Aggregation terlihat sederhana:

```sql
SELECT status, COUNT(*)
FROM cases
GROUP BY status;
```

Namun di production, aggregation adalah sumber bug serius:

- `COUNT(*)` vs `COUNT(column)`
- duplicate karena join
- group grain salah
- `WHERE` vs `HAVING`
- null handling
- average yang salah karena denominator salah
- sum inflated karena one-to-many join
- report mismatch dengan dashboard lain
- time bucket salah karena timezone
- conditional aggregation tidak konsisten
- `DISTINCT` dipakai sebagai plester
- grouping column tidak sesuai business grain
- metric tidak defensible untuk audit/regulatory reporting

Bagian ini bertujuan membuat kamu memahami:

- aggregate functions
- `GROUP BY`
- group grain
- `HAVING`
- conditional aggregation
- distinct aggregation
- null behavior
- aggregation setelah join
- pre-aggregation
- reporting correctness
- analytical thinking
- Java DTO mapping untuk aggregate result
- checklist review query aggregate

---

## 1. Mental Model: Aggregation Mengubah Grain

Query detail:

```sql
SELECT
    id,
    case_number,
    status
FROM cases;
```

Grain:

```text
one row per case
```

Aggregation:

```sql
SELECT
    status,
    COUNT(*) AS case_count
FROM cases
GROUP BY status;
```

Grain berubah menjadi:

```text
one row per status
```

Ini prinsip utama:

> `GROUP BY` mengubah grain dari row detail menjadi row per group.

Sebelum menulis aggregate query, jawab:

```text
Satu row hasil query merepresentasikan group apa?
```

Contoh:

```sql
GROUP BY status
```

Hasil:

```text
one row per status
```

```sql
GROUP BY jurisdiction_code, status
```

Hasil:

```text
one row per jurisdiction-status combination
```

```sql
GROUP BY date_trunc('month', opened_at)
```

Hasil:

```text
one row per opened month
```

Jika grain group tidak jelas, metric hampir pasti rawan salah.

---

## 2. Contoh Schema

Kita gunakan domain regulatory/case-management.

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    jurisdiction_code TEXT NOT NULL,
    case_number TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    assigned_officer_id UUID
);

CREATE TABLE case_assignments (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL REFERENCES cases(id),
    officer_id UUID NOT NULL,
    assignment_role TEXT NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ
);

CREATE TABLE case_evidences (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL REFERENCES cases(id),
    evidence_type TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE enforcement_actions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL REFERENCES cases(id),
    action_type TEXT NOT NULL,
    status TEXT NOT NULL,
    issued_at TIMESTAMPTZ
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

---

## 3. Aggregate Functions

Aggregate function mengambil banyak row dan menghasilkan satu value per group.

Common aggregate:

```sql
COUNT
SUM
AVG
MIN
MAX
```

Lainnya tergantung vendor:

```sql
STRING_AGG / GROUP_CONCAT / LISTAGG
ARRAY_AGG
JSON_AGG
BOOL_AND
BOOL_OR
PERCENTILE_CONT
STDDEV
VARIANCE
```

Bagian ini fokus pada fondasi.

---

## 4. COUNT(*)

`COUNT(*)` menghitung jumlah row.

```sql
SELECT COUNT(*) AS total_cases
FROM cases;
```

Output:

```text
one row, one value: total number of case rows
```

Jika pakai filter:

```sql
SELECT COUNT(*) AS open_case_count
FROM cases
WHERE status = 'OPEN';
```

Makna:

```text
jumlah row cases dengan status OPEN
```

Jika table `cases` benar-benar one row per case, maka ini jumlah case.

Jika query sudah join ke child table, `COUNT(*)` menghitung joined rows, bukan parent entities.

---

## 5. COUNT(column)

`COUNT(column)` menghitung row di mana `column IS NOT NULL`.

Contoh:

```sql
SELECT
    COUNT(*) AS total_cases,
    COUNT(closed_at) AS cases_with_closed_at
FROM cases;
```

Jika data:

```text
id | closed_at
1  | NULL
2  | 2026-01-01
3  | NULL
```

Hasil:

```text
COUNT(*) = 3
COUNT(closed_at) = 1
```

Ini penting untuk metric.

Query:

```sql
SELECT COUNT(closed_at)
FROM cases;
```

bukan “jumlah case”, tetapi “jumlah case yang `closed_at`-nya tidak NULL”.

---

## 6. COUNT(DISTINCT ...)

```sql
SELECT COUNT(DISTINCT status)
FROM cases;
```

Menghitung jumlah status berbeda.

Dalam join, `COUNT(DISTINCT parent_id)` kadang digunakan untuk menghindari duplicate.

Contoh:

```sql
SELECT COUNT(DISTINCT c.id)
FROM cases c
JOIN case_evidences e
  ON e.case_id = c.id;
```

Makna:

```text
jumlah case yang punya evidence
```

Namun sering lebih jelas dan mungkin lebih efisien memakai `EXISTS` untuk existence.

```sql
SELECT COUNT(*)
FROM cases c
WHERE EXISTS (
    SELECT 1
    FROM case_evidences e
    WHERE e.case_id = c.id
);
```

`COUNT(DISTINCT ...)` valid, tetapi jangan gunakan untuk menutupi join explosion tanpa memahami penyebabnya.

---

## 7. SUM

`SUM` menjumlahkan nilai numeric.

Contoh:

```sql
SELECT
    SUM(penalty_amount) AS total_penalty
FROM enforcement_actions
WHERE status = 'ISSUED';
```

### 7.1 SUM dan NULL

`SUM(column)` mengabaikan NULL.

Jika semua value NULL, hasil bisa NULL.

Gunakan:

```sql
COALESCE(SUM(penalty_amount), 0) AS total_penalty
```

jika domain menginginkan 0.

Namun ingat:

> Mengubah NULL menjadi 0 adalah keputusan domain.

### 7.2 SUM Setelah Join Bisa Inflated

Misalnya satu enforcement action join ke banyak notes:

```sql
SELECT
    SUM(ea.penalty_amount) AS total_penalty
FROM enforcement_actions ea
JOIN enforcement_action_notes n
  ON n.action_id = ea.id
WHERE ea.status = 'ISSUED';
```

Jika satu action punya 3 notes, penalty amount dihitung 3 kali.

Solusi:

- jangan join notes jika tidak diperlukan
- pre-aggregate notes
- aggregate actions sebelum join
- use `EXISTS` jika hanya butuh action yang punya notes

---

## 8. AVG

`AVG` menghitung rata-rata dari non-null values.

```sql
SELECT
    AVG(EXTRACT(EPOCH FROM (closed_at - opened_at)) / 86400.0) AS avg_days_to_close
FROM cases
WHERE status = 'CLOSED'
  AND closed_at IS NOT NULL;
```

### 8.1 AVG dan Denominator

`AVG(column)` membagi dengan jumlah non-null `column`.

Jika hanya closed cases punya duration, pastikan denominator sesuai business question.

Question A:

```text
Rata-rata durasi closed cases
```

Filter closed cases.

Question B:

```text
Rata-rata durasi semua cases, open case dihitung sampai hari ini
```

Butuh expression berbeda:

```sql
SELECT
    AVG(EXTRACT(EPOCH FROM (COALESCE(closed_at, now()) - opened_at)) / 86400.0)
FROM cases;
```

Pertanyaan metric harus jelas.

### 8.2 AVG Setelah Join Bisa Salah

Jika case join ke evidence, case dengan banyak evidence akan berbobot lebih besar.

Bad:

```sql
SELECT
    AVG(EXTRACT(EPOCH FROM (c.closed_at - c.opened_at)) / 86400.0)
FROM cases c
JOIN case_evidences e
  ON e.case_id = c.id
WHERE c.status = 'CLOSED';
```

Case dengan 10 evidence dihitung 10 kali.

Better if question is “closed cases that have evidence”:

```sql
SELECT
    AVG(EXTRACT(EPOCH FROM (c.closed_at - c.opened_at)) / 86400.0)
FROM cases c
WHERE c.status = 'CLOSED'
  AND EXISTS (
      SELECT 1
      FROM case_evidences e
      WHERE e.case_id = c.id
  );
```

---

## 9. MIN and MAX

```sql
SELECT
    MIN(opened_at) AS first_case_opened_at,
    MAX(opened_at) AS latest_case_opened_at
FROM cases;
```

Grouped:

```sql
SELECT
    jurisdiction_code,
    MIN(opened_at) AS first_case_opened_at,
    MAX(opened_at) AS latest_case_opened_at
FROM cases
GROUP BY jurisdiction_code;
```

### 9.1 MIN/MAX Does Not Return Whole Row

This is a common bug.

```sql
SELECT
    jurisdiction_code,
    MAX(opened_at) AS latest_opened_at,
    case_number
FROM cases
GROUP BY jurisdiction_code;
```

Invalid in standard SQL unless `case_number` is grouped or functionally dependent depending vendor.

Even if a database allows non-standard behavior, `case_number` may not correspond to the row with max opened_at.

To get latest row per group, use window function or join back.

Example with window:

```sql
SELECT
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
WHERE rn = 1;
```

Window functions are covered in part 010.

---

## 10. GROUP BY

`GROUP BY` defines group grain.

```sql
SELECT
    status,
    COUNT(*) AS total
FROM cases
GROUP BY status;
```

Each group contains rows with same status.

### 10.1 Group by Multiple Columns

```sql
SELECT
    jurisdiction_code,
    status,
    COUNT(*) AS total
FROM cases
GROUP BY jurisdiction_code, status;
```

Grain:

```text
one row per jurisdiction-status combination
```

### 10.2 Group by Expression

```sql
SELECT
    date_trunc('month', opened_at) AS opened_month,
    COUNT(*) AS total
FROM cases
GROUP BY date_trunc('month', opened_at)
ORDER BY opened_month;
```

Grain:

```text
one row per opened month
```

But timezone matters. More later.

### 10.3 SELECT Column Must Match Group Grain

In grouped query, every selected expression must be either:

- grouped
- aggregated
- functionally dependent on grouped columns, if database supports/recognizes it

Bad:

```sql
SELECT
    status,
    case_number,
    COUNT(*)
FROM cases
GROUP BY status;
```

`case_number` is not one value per status.

What should database return for status OPEN if many case_numbers exist?

---

## 11. Group Grain and Reporting Semantics

Business question:

> Berapa case per status?

Group:

```sql
GROUP BY status
```

Business question:

> Berapa case per status per jurisdiction?

Group:

```sql
GROUP BY jurisdiction_code, status
```

Business question:

> Berapa case per month berdasarkan tanggal pembukaan?

Group:

```sql
GROUP BY month_bucket
```

Business question:

> Berapa case per officer berdasarkan active primary assignment?

Group likely based on assignment relation:

```sql
GROUP BY officer_id
```

But need define active assignment and ensure one active primary per case.

Aggregation design starts from business grain:

```text
Metric entity: what is counted/summed/averaged?
Group dimension: by what dimensions?
Time basis: event time, opened time, closed time, transition time?
Filter basis: current state or historical event?
```

---

## 12. WHERE vs HAVING

`WHERE` filters rows before grouping.

`HAVING` filters groups after aggregation.

Example:

```sql
SELECT
    status,
    COUNT(*) AS total
FROM cases
WHERE tenant_id = :tenant_id
GROUP BY status
HAVING COUNT(*) > 10;
```

Logical flow:

1. filter rows by tenant
2. group by status
3. count rows per status
4. keep groups with count > 10

### 12.1 WHERE for Row Predicate

```sql
WHERE status IN ('OPEN', 'ESCALATED')
```

### 12.2 HAVING for Aggregate Predicate

```sql
HAVING COUNT(*) > 10
```

### 12.3 Common Mistake

Bad:

```sql
SELECT
    status,
    COUNT(*)
FROM cases
GROUP BY status
HAVING status = 'OPEN';
```

This works in some databases, but semantically row filter belongs in `WHERE`:

```sql
SELECT
    status,
    COUNT(*)
FROM cases
WHERE status = 'OPEN'
GROUP BY status;
```

Use `HAVING` only for conditions on groups/aggregates, unless there is a specific reason.

---

## 13. Conditional Aggregation

Conditional aggregation calculates multiple metrics in one grouped query.

Example:

```sql
SELECT
    jurisdiction_code,
    COUNT(*) AS total_cases,
    COUNT(*) FILTER (WHERE status = 'OPEN') AS open_cases,
    COUNT(*) FILTER (WHERE status = 'CLOSED') AS closed_cases,
    COUNT(*) FILTER (WHERE priority = 'CRITICAL') AS critical_cases
FROM cases
GROUP BY jurisdiction_code;
```

`FILTER` is PostgreSQL/SQL standard style supported by some databases.

Portable pattern:

```sql
SELECT
    jurisdiction_code,
    COUNT(*) AS total_cases,
    SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS open_cases,
    SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END) AS closed_cases,
    SUM(CASE WHEN priority = 'CRITICAL' THEN 1 ELSE 0 END) AS critical_cases
FROM cases
GROUP BY jurisdiction_code;
```

### 13.1 Conditional Count with SUM(CASE)

```sql
SUM(CASE WHEN condition THEN 1 ELSE 0 END)
```

Counts rows satisfying condition.

### 13.2 Conditional Sum

```sql
SUM(CASE
        WHEN status = 'ISSUED' THEN penalty_amount
        ELSE 0
    END) AS issued_penalty_amount
```

Be careful with NULL amount:

```sql
SUM(CASE
        WHEN status = 'ISSUED' THEN COALESCE(penalty_amount, 0)
        ELSE 0
    END)
```

But again, deciding NULL -> 0 is domain choice.

---

## 14. Conditional Aggregation for Dashboard Metrics

Requirement:

> Per jurisdiction, show total, open, escalated, closed, critical open cases.

```sql
SELECT
    jurisdiction_code,
    COUNT(*) AS total_cases,
    SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS open_cases,
    SUM(CASE WHEN status = 'ESCALATED' THEN 1 ELSE 0 END) AS escalated_cases,
    SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END) AS closed_cases,
    SUM(CASE
            WHEN status = 'OPEN' AND priority = 'CRITICAL' THEN 1
            ELSE 0
        END) AS critical_open_cases
FROM cases
WHERE tenant_id = :tenant_id
GROUP BY jurisdiction_code
ORDER BY jurisdiction_code;
```

Review:

```text
Grain: one row per jurisdiction.
Metric base: cases table.
Scope: tenant.
Current state: status current, not transition history.
```

If question is historical, this query is wrong.

---

## 15. Aggregation and NULL

### 15.1 COUNT Ignores NULL for Column

```sql
COUNT(closed_at)
```

counts closed_at non-null.

### 15.2 SUM/AVG Ignore NULL

```sql
AVG(risk_score)
```

averages only cases with risk_score not null.

Question:

```text
Should unrated cases be excluded from average?
Or counted as zero?
Or reported separately?
```

Better dashboard:

```sql
SELECT
    COUNT(*) AS total_cases,
    COUNT(risk_score) AS rated_cases,
    COUNT(*) - COUNT(risk_score) AS unrated_cases,
    AVG(risk_score) AS avg_risk_score_among_rated
FROM cases;
```

This makes denominator explicit.

---

## 16. Aggregation with LEFT JOIN

Requirement:

> Show every case and evidence count.

```sql
SELECT
    c.id,
    c.case_number,
    COUNT(e.id) AS evidence_count
FROM cases c
LEFT JOIN case_evidences e
  ON e.case_id = c.id
GROUP BY c.id, c.case_number;
```

Why `COUNT(e.id)`, not `COUNT(*)`?

For a case with no evidence, `LEFT JOIN` produces one row with `e.id NULL`.

`COUNT(*)` would count that row as 1.

`COUNT(e.id)` counts non-null evidence ids, so returns 0.

Example:

```text
C1 has 2 evidence -> joined rows 2 -> COUNT(e.id)=2
C2 has 0 evidence -> joined row 1 with e.id NULL -> COUNT(e.id)=0, COUNT(*)=1
```

This is a crucial pattern.

---

## 17. Aggregation After Multiple LEFT JOINs

Bad:

```sql
SELECT
    c.id,
    COUNT(e.id) AS evidence_count,
    COUNT(a.id) AS assignment_count
FROM cases c
LEFT JOIN case_evidences e
  ON e.case_id = c.id
LEFT JOIN case_assignments a
  ON a.case_id = c.id
GROUP BY c.id;
```

If C1 has:

```text
2 evidences
3 assignments
```

Joined rows:

```text
6
```

Counts:

```text
COUNT(e.id)=6
COUNT(a.id)=6
```

Wrong.

Solution: pre-aggregate each child.

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
  ON ac.case_id = c.id;
```

---

## 18. Pre-Aggregation Pattern

Pre-aggregation means:

```text
Aggregate child relation to parent grain before joining to parent.
```

Pattern:

```sql
WITH child_summary AS (
    SELECT
        parent_id,
        COUNT(*) AS child_count
    FROM child_table
    GROUP BY parent_id
)
SELECT
    p.id,
    COALESCE(cs.child_count, 0) AS child_count
FROM parent p
LEFT JOIN child_summary cs
  ON cs.parent_id = p.id;
```

Use when:

- output grain is parent
- child relation is one-to-many
- need count/sum/min/max per parent
- joining multiple child relations
- avoiding count inflation
- making metric explicit

Pre-aggregation is one of the most important SQL reporting patterns.

---

## 19. HAVING Examples

### 19.1 Officers with More Than 20 Active Cases

```sql
SELECT
    a.officer_id,
    COUNT(*) AS active_case_count
FROM case_assignments a
WHERE a.assignment_role = 'PRIMARY'
  AND a.ended_at IS NULL
GROUP BY a.officer_id
HAVING COUNT(*) > 20
ORDER BY active_case_count DESC;
```

Grain:

```text
one row per officer
```

`WHERE` filters active primary assignment rows before grouping.

`HAVING` filters officers after count.

### 19.2 Jurisdictions with Critical Case Volume

```sql
SELECT
    jurisdiction_code,
    COUNT(*) AS critical_case_count
FROM cases
WHERE tenant_id = :tenant_id
  AND priority = 'CRITICAL'
  AND status IN ('OPEN', 'ESCALATED')
GROUP BY jurisdiction_code
HAVING COUNT(*) >= 10;
```

---

## 20. Aggregation and Time Bucketing

Monthly count:

```sql
SELECT
    date_trunc('month', opened_at) AS opened_month,
    COUNT(*) AS total_cases
FROM cases
GROUP BY date_trunc('month', opened_at)
ORDER BY opened_month;
```

### 20.1 Timezone Problem

If business month is based on Asia/Jakarta, but `opened_at` is stored as `TIMESTAMPTZ`, grouping by UTC month may be wrong for boundary cases.

Example:

```text
2026-01-01 00:30 Asia/Jakarta
= 2025-12-31 17:30 UTC
```

UTC month: December 2025  
Jakarta business month: January 2026

Need timezone-aware bucket.

PostgreSQL-style:

```sql
SELECT
    date_trunc('month', opened_at AT TIME ZONE 'Asia/Jakarta') AS opened_month_jakarta,
    COUNT(*) AS total_cases
FROM cases
GROUP BY date_trunc('month', opened_at AT TIME ZONE 'Asia/Jakarta')
ORDER BY opened_month_jakarta;
```

But this expression may not be sargable for filtering. Usually filter by instant range, then group by local bucket.

```sql
WHERE opened_at >= :start_utc
  AND opened_at <  :end_utc
```

Then group using local transformation for display/reporting.

### 20.2 Calendar Table

For regulatory reporting, consider calendar dimension:

```text
calendar_date
jurisdiction_code
is_business_day
month_key
quarter_key
holiday_name
```

This avoids scattering date logic across queries.

---

## 21. Aggregation and Missing Groups

Suppose dashboard wants all statuses, even zero counts.

Query:

```sql
SELECT
    status,
    COUNT(*) AS total
FROM cases
GROUP BY status;
```

If no case has status `CANCELLED`, there is no row for `CANCELLED`.

If you need zero rows, join from dimension table.

```sql
SELECT
    s.code AS status,
    COUNT(c.id) AS total
FROM case_statuses s
LEFT JOIN cases c
  ON c.status = s.code
 AND c.tenant_id = :tenant_id
GROUP BY s.code
ORDER BY s.sort_order;
```

Notice tenant filter is in `ON`, not `WHERE`, otherwise statuses with zero cases disappear.

This is another important `LEFT JOIN` filter placement case.

---

## 22. Aggregation and Percentages

Requirement:

> Percentage of open cases that are critical per jurisdiction.

```sql
SELECT
    jurisdiction_code,
    COUNT(*) AS open_cases,
    SUM(CASE WHEN priority = 'CRITICAL' THEN 1 ELSE 0 END) AS critical_open_cases,
    SUM(CASE WHEN priority = 'CRITICAL' THEN 1 ELSE 0 END) * 100.0
        / NULLIF(COUNT(*), 0) AS critical_open_percentage
FROM cases
WHERE status = 'OPEN'
GROUP BY jurisdiction_code;
```

Use `NULLIF` to avoid division by zero.

```sql
NULLIF(COUNT(*), 0)
```

If denominator is 0, result becomes NULL.

Then decide presentation:

- NULL = not applicable/no open cases
- 0 = explicitly zero percent

Do not blindly coalesce unless domain wants it.

---

## 23. Aggregation and Ratio Correctness

Average of percentages can be wrong.

Example:

Jurisdiction A:

```text
1 critical / 1 open = 100%
```

Jurisdiction B:

```text
1 critical / 100 open = 1%
```

Average of percentages:

```text
(100% + 1%) / 2 = 50.5%
```

Overall percentage:

```text
2 critical / 101 open = 1.98%
```

Both answer different questions.

For global metric, aggregate numerator and denominator first:

```sql
WITH per_jurisdiction AS (
    SELECT
        jurisdiction_code,
        COUNT(*) AS open_cases,
        SUM(CASE WHEN priority = 'CRITICAL' THEN 1 ELSE 0 END) AS critical_open_cases
    FROM cases
    WHERE status = 'OPEN'
    GROUP BY jurisdiction_code
)
SELECT
    SUM(critical_open_cases) * 100.0 / NULLIF(SUM(open_cases), 0) AS global_percentage
FROM per_jurisdiction;
```

Analytical thinking matters.

---

## 24. Aggregation and Current vs Historical Metrics

Question A:

> How many cases are currently escalated?

```sql
SELECT COUNT(*)
FROM cases
WHERE status = 'ESCALATED';
```

Question B:

> How many cases were escalated during January 2026?

```sql
SELECT COUNT(DISTINCT case_id)
FROM case_status_transitions
WHERE to_status = 'ESCALATED'
  AND transitioned_at >= :start
  AND transitioned_at < :end;
```

Question C:

> How many escalation events occurred during January 2026?

```sql
SELECT COUNT(*)
FROM case_status_transitions
WHERE to_status = 'ESCALATED'
  AND transitioned_at >= :start
  AND transitioned_at < :end;
```

B and C differ:

- B counts cases
- C counts events

If one case escalated twice, B counts 1, C counts 2.

Always define metric entity.

---

## 25. Aggregation and Distinct Business Entities

Requirement:

> Count parties involved in open cases.

Naive:

```sql
SELECT COUNT(*)
FROM cases c
JOIN case_parties cp
  ON cp.case_id = c.id
WHERE c.status = 'OPEN';
```

This counts case-party relationships, not distinct parties.

If a party appears in multiple open cases, count differs.

Distinct parties:

```sql
SELECT COUNT(DISTINCT cp.party_id)
FROM cases c
JOIN case_parties cp
  ON cp.case_id = c.id
WHERE c.status = 'OPEN';
```

Case-party relationships:

```sql
SELECT COUNT(*)
FROM cases c
JOIN case_parties cp
  ON cp.case_id = c.id
WHERE c.status = 'OPEN';
```

Both may be valid. They answer different questions.

---

## 26. Aggregation and Deduplication

Sometimes source data has duplicates.

Bad instinct:

```sql
SELECT COUNT(DISTINCT case_number)
FROM staging_cases;
```

This gives a number, but does not explain duplicate problem.

For data quality, report duplicates:

```sql
SELECT
    tenant_id,
    case_number_normalized,
    COUNT(*) AS duplicate_count
FROM staging_cases
GROUP BY tenant_id, case_number_normalized
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;
```

Then decide:

- reject import
- choose latest
- merge duplicates
- send to manual review
- create exception table

Aggregation is useful for data quality investigation, not just dashboards.

---

## 27. Aggregation and GROUP BY Functional Dependency

Some databases allow selecting non-grouped columns if functionally dependent on grouped primary key.

Example PostgreSQL may allow:

```sql
SELECT
    c.id,
    c.case_number,
    COUNT(e.id)
FROM cases c
LEFT JOIN case_evidences e
  ON e.case_id = c.id
GROUP BY c.id;
```

Because `case_number` is functionally dependent on primary key `c.id`.

Other databases may require:

```sql
GROUP BY c.id, c.case_number
```

For portability and readability, grouping selected non-aggregates explicitly can be clearer.

But for large queries, understanding functional dependency helps.

---

## 28. Aggregation and Rollups

Some databases support:

```sql
ROLLUP
CUBE
GROUPING SETS
```

Example:

```sql
SELECT
    jurisdiction_code,
    status,
    COUNT(*) AS total
FROM cases
GROUP BY ROLLUP (jurisdiction_code, status);
```

Can produce:

- per jurisdiction + status
- per jurisdiction total
- grand total

Useful for reports.

But output contains subtotal rows, so downstream code must interpret NULL/grouping indicators carefully.

This series will revisit analytical SQL later. For now, know that basic `GROUP BY` can be extended for multi-level summaries.

---

## 29. Aggregation and JSON/Array Aggregation

Sometimes you want one row per case with list of evidence IDs.

PostgreSQL-style:

```sql
SELECT
    c.id,
    c.case_number,
    JSON_AGG(e.id ORDER BY e.received_at) AS evidence_ids
FROM cases c
LEFT JOIN case_evidences e
  ON e.case_id = c.id
GROUP BY c.id, c.case_number;
```

Caveat:

For case with no evidence, JSON aggregation may produce `[null]` depending expression.

Better:

```sql
SELECT
    c.id,
    c.case_number,
    COALESCE(
        JSON_AGG(e.id ORDER BY e.received_at) FILTER (WHERE e.id IS NOT NULL),
        '[]'
    ) AS evidence_ids
FROM cases c
LEFT JOIN case_evidences e
  ON e.case_id = c.id
GROUP BY c.id, c.case_number;
```

Vendor-specific.

Use carefully because nested aggregates can hide row multiplication and produce large payloads.

---

## 30. Aggregation and Materialized Summaries

For high-traffic dashboards, real-time aggregation over large tables may be expensive.

Options:

- materialized view
- summary table
- incremental counters
- event-driven projection
- OLAP warehouse
- cache
- approximate metrics

Example summary table:

```sql
CREATE TABLE case_daily_metrics (
    tenant_id UUID NOT NULL,
    metric_date DATE NOT NULL,
    jurisdiction_code TEXT NOT NULL,
    opened_cases INTEGER NOT NULL,
    closed_cases INTEGER NOT NULL,
    escalated_cases INTEGER NOT NULL,

    PRIMARY KEY (tenant_id, metric_date, jurisdiction_code)
);
```

Trade-offs:

- faster reads
- more complex writes
- eventual consistency possible
- need rebuild/backfill strategy
- metric definition must be versioned
- corrections need recomputation

For regulatory reporting, metric lineage matters.

---

## 31. Aggregation and Java DTOs

DTO:

```java
record CaseStatusCount(
    String status,
    long total
) {}
```

Query:

```sql
SELECT
    status,
    COUNT(*) AS total
FROM cases
WHERE tenant_id = :tenant_id
GROUP BY status
ORDER BY status;
```

Mapping:

```java
String status = rs.getString("status");
long total = rs.getLong("total");
```

For numeric sums:

```java
BigDecimal totalPenalty = rs.getBigDecimal("total_penalty");
```

For nullable aggregate:

```java
BigDecimal avgRiskScore = rs.getBigDecimal("avg_risk_score");
if (rs.wasNull()) { ... }
```

Be careful:

- SQL `COUNT(*)` may return `long`, not int
- `AVG(NUMERIC)` returns numeric/BigDecimal depending driver
- `SUM` of integer may widen type depending database
- null aggregate result must be handled
- aliases should match DTO fields

---

## 32. Aggregation Performance Basics

Aggregation cost depends on:

- number of input rows
- group cardinality
- sort/hash aggregate choice
- memory availability
- indexes
- parallelism
- filtering selectivity
- join multiplication before aggregation
- distinct aggregate cost
- spilling to disk
- time bucket expression
- data distribution

Basic performance heuristics:

1. Filter early with `WHERE`.
2. Avoid unnecessary joins before aggregation.
3. Pre-aggregate one-to-many children.
4. Use indexes to reduce input rows.
5. Avoid `COUNT(DISTINCT ...)` on huge joins if possible.
6. Consider summary tables for repeated expensive reports.
7. Inspect execution plan for heavy queries.

---

## 33. Common Aggregation Bugs

### Bug 1 — COUNT(*) on LEFT JOIN

```sql
SELECT
    c.id,
    COUNT(*) AS evidence_count
FROM cases c
LEFT JOIN case_evidences e
  ON e.case_id = c.id
GROUP BY c.id;
```

Cases with no evidence return 1.

Use:

```sql
COUNT(e.id)
```

### Bug 2 — Inflated Count from Multiple Joins

Joining multiple child tables before count.

Use pre-aggregation.

### Bug 3 — AVG After Join

Parent rows weighted by number of child rows.

Use `EXISTS` or preselect parent rows.

### Bug 4 — WHERE Instead of HAVING

Aggregate condition in wrong place.

### Bug 5 — HAVING Instead of WHERE

Row filter applied after grouping, causing unnecessary work and confusing semantics.

### Bug 6 — Time Bucket in Wrong Timezone

UTC grouping for local regulatory month.

### Bug 7 — Missing Zero Groups

Dimension values with no facts disappear.

Use dimension table left join.

### Bug 8 — DISTINCT as Patch

`COUNT(DISTINCT ...)` without understanding metric entity.

### Bug 9 — Non-Grouped Column

Selecting column not part of group grain.

### Bug 10 — Average of Averages

Incorrect global metrics.

Aggregate numerator/denominator.

---

## 34. Mini Case Study: Dashboard by Status

### Requirement

> For a tenant, show total cases per status.

Query:

```sql
SELECT
    status,
    COUNT(*) AS total_cases
FROM cases
WHERE tenant_id = :tenant_id
GROUP BY status
ORDER BY status;
```

Grain:

```text
one row per status
```

Potential issue:

- statuses with zero cases absent

If need all statuses:

```sql
SELECT
    s.code AS status,
    COUNT(c.id) AS total_cases
FROM case_statuses s
LEFT JOIN cases c
  ON c.status = s.code
 AND c.tenant_id = :tenant_id
GROUP BY s.code, s.sort_order
ORDER BY s.sort_order;
```

---

## 35. Mini Case Study: Evidence Count per Case

Requirement:

> Show all open cases with evidence count.

```sql
SELECT
    c.id,
    c.case_number,
    COUNT(e.id) AS evidence_count
FROM cases c
LEFT JOIN case_evidences e
  ON e.case_id = c.id
WHERE c.status = 'OPEN'
GROUP BY c.id, c.case_number
ORDER BY c.case_number;
```

If also need assignment count, do not join assignment directly. Pre-aggregate.

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

---

## 36. Mini Case Study: SLA Breach Count

Assume table:

```sql
CREATE TABLE case_slas (
    case_id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ
);
```

Requirement:

> Count open SLA breaches per jurisdiction.

Need join case for jurisdiction and status.

```sql
SELECT
    c.jurisdiction_code,
    COUNT(*) AS breached_open_slas
FROM case_slas s
JOIN cases c
  ON c.id = s.case_id
WHERE c.tenant_id = :tenant_id
  AND c.status <> 'CLOSED'
  AND s.completed_at IS NULL
  AND s.due_at < now()
GROUP BY c.jurisdiction_code
ORDER BY breached_open_slas DESC;
```

Review:

```text
Metric entity: SLA row.
Group: jurisdiction.
Current status: cases.status.
Breach definition: incomplete and due_at < now.
```

Potential nuance:

- status `CANCELLED`?
- due_at timezone?
- completed_at after due_at?
- paused SLA?
- business day calendar?
- historical vs current breach?

---

## 37. Mini Case Study: Officer Workload

Requirement:

> Active primary case count per officer.

```sql
SELECT
    a.officer_id,
    COUNT(*) AS active_primary_case_count
FROM case_assignments a
WHERE a.assignment_role = 'PRIMARY'
  AND a.ended_at IS NULL
GROUP BY a.officer_id
ORDER BY active_primary_case_count DESC;
```

Assumption:

```text
one active primary assignment row corresponds to one active primary case assignment
```

If data can contain duplicate active primary assignment for same case/officer, count inflated.

Constraint needed:

```sql
CREATE UNIQUE INDEX uq_case_assignments_one_active_primary
ON case_assignments (case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

If only open cases should count:

```sql
SELECT
    a.officer_id,
    COUNT(*) AS active_open_primary_case_count
FROM case_assignments a
JOIN cases c
  ON c.id = a.case_id
WHERE a.assignment_role = 'PRIMARY'
  AND a.ended_at IS NULL
  AND c.status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED')
GROUP BY a.officer_id;
```

Now metric entity is assignment joined to current case state.

---

## 38. Mini Case Study: Escalation Events vs Escalated Cases

Requirement A:

> Number of escalation events per month.

```sql
SELECT
    date_trunc('month', transitioned_at) AS month,
    COUNT(*) AS escalation_events
FROM case_status_transitions
WHERE to_status = 'ESCALATED'
GROUP BY date_trunc('month', transitioned_at)
ORDER BY month;
```

Requirement B:

> Number of distinct cases escalated per month.

```sql
SELECT
    date_trunc('month', transitioned_at) AS month,
    COUNT(DISTINCT case_id) AS escalated_cases
FROM case_status_transitions
WHERE to_status = 'ESCALATED'
GROUP BY date_trunc('month', transitioned_at)
ORDER BY month;
```

If one case escalates twice in same month:

- A counts 2
- B counts 1

If one case escalates in two different months:

- B counts it once in each month

If requirement is “first escalation month per case”, use pre-aggregation:

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
    date_trunc('month', first_escalated_at) AS month,
    COUNT(*) AS first_time_escalated_cases
FROM first_escalation
GROUP BY date_trunc('month', first_escalated_at)
ORDER BY month;
```

Metric definitions matter.

---

## 39. Aggregation Review Checklist

```text
[ ] What is the output grain?
[ ] What entity is being counted/summed/averaged?
[ ] What are the grouping dimensions?
[ ] Is the metric current-state or historical?
[ ] Is the time basis opened_at, closed_at, issued_at, transitioned_at, or received_at?
[ ] Is timezone/business calendar handled correctly?
[ ] Are NULL values excluded intentionally?
[ ] Is COUNT(*) or COUNT(column) correct?
[ ] Is DISTINCT necessary and justified?
[ ] Is there any join before aggregation?
[ ] Can join multiply rows?
[ ] Should child tables be pre-aggregated?
[ ] Should EXISTS replace join?
[ ] Are zero-count groups required?
[ ] Should denominator be explicit?
[ ] Is HAVING used only for group filters?
[ ] Does DTO mapping handle numeric/null types correctly?
[ ] Is this query suitable for live OLTP, or should it be a summary/read model?
```

---

## 40. Analytical Thinking Checklist

Before building a metric, define:

```text
Metric name:
Business definition:
Entity counted:
Time basis:
Filter/scope:
Grouping dimensions:
Numerator:
Denominator:
Null handling:
Duplicate handling:
Timezone/calendar:
Current vs historical:
Data freshness:
Expected reconciliation source:
Owner:
Version:
```

Example:

```text
Metric name: critical_open_case_percentage
Entity counted: case
Scope: tenant + jurisdiction
Numerator: open cases with priority CRITICAL
Denominator: all open cases
Time basis: current state at query time
Null handling: priority is NOT NULL
Duplicate handling: cases table one row per case
Timezone: not applicable
Freshness: real-time OLTP
```

For regulatory reporting, this definition is as important as SQL.

---

## 41. Practical Exercises

### Exercise 1 — COUNT Left Join

Question:

```sql
SELECT
    c.id,
    COUNT(*) AS evidence_count
FROM cases c
LEFT JOIN case_evidences e
  ON e.case_id = c.id
GROUP BY c.id;
```

What is wrong?

Answer:

Cases with no evidence return 1. Use `COUNT(e.id)`.

---

### Exercise 2 — Fix Inflated Count

Bad:

```sql
SELECT
    c.id,
    COUNT(e.id) AS evidence_count,
    COUNT(a.id) AS assignment_count
FROM cases c
LEFT JOIN case_evidences e ON e.case_id = c.id
LEFT JOIN case_assignments a ON a.case_id = c.id
GROUP BY c.id;
```

Fix with pre-aggregation:

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

---

### Exercise 3 — Current vs Historical

Question:

> Count currently escalated cases.

```sql
SELECT COUNT(*)
FROM cases
WHERE status = 'ESCALATED';
```

Question:

> Count escalation events last month.

```sql
SELECT COUNT(*)
FROM case_status_transitions
WHERE to_status = 'ESCALATED'
  AND transitioned_at >= :start
  AND transitioned_at < :end;
```

Question:

> Count distinct cases escalated last month.

```sql
SELECT COUNT(DISTINCT case_id)
FROM case_status_transitions
WHERE to_status = 'ESCALATED'
  AND transitioned_at >= :start
  AND transitioned_at < :end;
```

---

### Exercise 4 — Zero Groups

Question:

> Show all statuses and counts, including zero.

Use dimension table left join:

```sql
SELECT
    s.code,
    COUNT(c.id) AS total
FROM case_statuses s
LEFT JOIN cases c
  ON c.status = s.code
 AND c.tenant_id = :tenant_id
GROUP BY s.code, s.sort_order
ORDER BY s.sort_order;
```

---

## 42. Koneksi ke Part Berikutnya

Part ini membahas aggregation dan group-level reasoning.

Part berikutnya, `part-008`, akan membahas:

- subqueries
- derived tables
- CTEs
- correlated subqueries
- recursive CTEs
- `EXISTS` vs `IN`
- query decomposition
- CTE readability vs performance

Aggregation sering menjadi lebih mudah dan benar ketika dipecah dengan CTE/derived table.

Contoh dari bagian ini:

```sql
WITH evidence_counts AS (...)
SELECT ...
```

Part berikutnya akan membuat teknik query composition ini jauh lebih matang.

---

## 43. Ringkasan Bagian Ini

Hal penting dari part 007:

1. Aggregation mengubah grain.
2. `GROUP BY` mendefinisikan satu row per group.
3. `COUNT(*)` menghitung row; `COUNT(column)` menghitung non-null values.
4. `COUNT(*)` pada `LEFT JOIN` dapat menghasilkan count salah.
5. `SUM`, `AVG`, `MIN`, `MAX` mengabaikan NULL dengan nuance masing-masing.
6. `AVG` harus dipahami denominator-nya.
7. Join sebelum aggregation dapat menggandakan row dan menginflasi metric.
8. Pre-aggregation adalah pattern penting untuk child relation.
9. `WHERE` memfilter row sebelum grouping.
10. `HAVING` memfilter group setelah aggregation.
11. Conditional aggregation memungkinkan banyak metric dalam satu query.
12. Time bucketing harus memperhatikan timezone/business calendar.
13. Missing groups perlu dimension table jika ingin zero counts.
14. Percentages harus punya numerator dan denominator eksplisit.
15. Average of averages sering salah untuk global metric.
16. Current-state metric dan historical-event metric berbeda.
17. `COUNT(DISTINCT ...)` valid, tapi harus mencerminkan metric entity.
18. Metric definition harus terdokumentasi untuk reporting defensibility.

Kalimat inti:

> Aggregation yang benar dimulai dari mendefinisikan grain, entity yang dihitung, dan denominator; SQL-nya hanya implementasi dari definisi metric tersebut.

---

## 44. Referensi

1. PostgreSQL Documentation — Aggregate Functions.  
   https://www.postgresql.org/docs/current/functions-aggregate.html

2. PostgreSQL Documentation — GROUP BY and HAVING.  
   https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-GROUP

3. PostgreSQL Documentation — SELECT.  
   https://www.postgresql.org/docs/current/sql-select.html

4. PostgreSQL Documentation — Date/Time Functions, `date_trunc`.  
   https://www.postgresql.org/docs/current/functions-datetime.html

5. MySQL 8.4 Reference Manual — Aggregate Functions.  
   https://dev.mysql.com/doc/refman/8.4/en/aggregate-functions.html

6. SQL Server Documentation — Aggregate Functions.  
   https://learn.microsoft.com/en-us/sql/t-sql/functions/aggregate-functions-transact-sql

7. Oracle Database SQL Language Reference — Aggregate Functions.  
   https://docs.oracle.com/en/database/oracle/oracle-database/23/sqlrf/Aggregate-Functions.html

---

## 45. Status Seri

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

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-008.md` — Subqueries, Derived Tables, CTEs, and Query Composition

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-006.md">⬅️ Part 6 — Joins from First Principles</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-008.md">Part 8 — Subqueries, Derived Tables, CTEs, and Query Composition ➡️</a>
</div>
