# learn-sql-mastery-for-java-engineers-part-010.md

# Part 10 — Window Functions: Professional-Grade SQL Analytics

> Seri: SQL Mastery for Java Engineers  
> Bagian: 010 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-009.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-011.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas set operations:

```sql
UNION
UNION ALL
INTERSECT
EXCEPT
```

Bagian ini membahas salah satu fitur SQL paling powerful untuk engineer profesional: **window functions**.

Window functions memungkinkan kamu menghitung nilai analitis lintas beberapa row **tanpa meng-collapse row detail** seperti `GROUP BY`.

Contoh:

```sql
SELECT
    case_id,
    status,
    transitioned_at,
    ROW_NUMBER() OVER (
        PARTITION BY case_id
        ORDER BY transitioned_at DESC
    ) AS transition_rank
FROM case_status_transitions;
```

Dengan window functions, kamu bisa menjawab pertanyaan seperti:

- status transition terbaru per case
- top 3 case terbaru per jurisdiction
- running total enforcement actions per month
- officer workload rank per jurisdiction
- previous status sebelum status saat ini
- time between two events
- percent contribution per jurisdiction
- moving average case volume
- first/last event per case
- deduplication dengan rule deterministic
- pagination cursor support
- analytical report tanpa kehilangan row detail

Tanpa window functions, engineer sering memakai:

- correlated subquery berulang
- self join rumit
- aggregate + join back
- `DISTINCT ON` vendor-specific
- application-side post-processing
- query yang salah grain

Window functions memberikan cara yang lebih ekspresif, composable, dan sering lebih efisien.

Kalimat inti:

> `GROUP BY` merangkum banyak row menjadi lebih sedikit row; window function menghitung nilai lintas row sambil tetap mempertahankan setiap row.

---

## 1. Problem: GROUP BY Menghilangkan Detail Row

Misalnya kita punya transitions:

```text
case_id | from_status   | to_status     | transitioned_at
--------+---------------+---------------+------------------------
C1      | NULL          | OPEN          | 2026-01-01 09:00:00Z
C1      | OPEN          | UNDER_REVIEW  | 2026-01-02 10:00:00Z
C1      | UNDER_REVIEW  | ESCALATED     | 2026-01-04 11:00:00Z
C2      | NULL          | OPEN          | 2026-01-03 09:00:00Z
C2      | OPEN          | CLOSED        | 2026-01-05 12:00:00Z
```

Jika ingin latest transition timestamp per case:

```sql
SELECT
    case_id,
    MAX(transitioned_at) AS latest_transitioned_at
FROM case_status_transitions
GROUP BY case_id;
```

Hasil:

```text
case_id | latest_transitioned_at
C1      | 2026-01-04 11:00:00Z
C2      | 2026-01-05 12:00:00Z
```

Kita kehilangan:

- from_status
- to_status
- transition id
- transitioned_by
- reason
- row detail lain

Jika ingin row lengkap dari latest transition, `GROUP BY` saja tidak cukup.

Window function menyelesaikan ini.

---

## 2. ROW_NUMBER untuk Latest Row per Group

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

Makna:

- `PARTITION BY case_id`: hitung ranking terpisah untuk setiap case.
- `ORDER BY transitioned_at DESC, id DESC`: transition terbaru mendapat rank 1.
- `ROW_NUMBER()`: memberi nomor 1, 2, 3, ...
- `WHERE rn = 1`: ambil latest row per case.

Grain akhir:

```text
one row per case
```

Ini pattern sangat penting.

---

## 3. Syntax Dasar Window Function

General syntax:

```sql
function_name(...) OVER (
    PARTITION BY ...
    ORDER BY ...
    frame_clause
)
```

Contoh:

```sql
ROW_NUMBER() OVER (
    PARTITION BY jurisdiction_code
    ORDER BY opened_at DESC
)
```

Bagian penting:

```text
function_name
OVER
PARTITION BY
ORDER BY
window frame
```

Tidak semua window function butuh semua bagian.

---

## 4. PARTITION BY

`PARTITION BY` membagi row menjadi kelompok analitis, tetapi tidak meng-collapse row.

Contoh:

```sql
SELECT
    id,
    jurisdiction_code,
    case_number,
    opened_at,
    COUNT(*) OVER (
        PARTITION BY jurisdiction_code
    ) AS cases_in_same_jurisdiction
FROM cases;
```

Jika ada 100 case di `ID-JKT`, setiap row case `ID-JKT` akan memiliki:

```text
cases_in_same_jurisdiction = 100
```

Tetapi semua row case tetap muncul.

Ini berbeda dari:

```sql
SELECT
    jurisdiction_code,
    COUNT(*)
FROM cases
GROUP BY jurisdiction_code;
```

yang menghasilkan satu row per jurisdiction.

---

## 5. ORDER BY dalam OVER

`ORDER BY` di dalam `OVER` menentukan urutan analitis di dalam partition.

```sql
SELECT
    id,
    jurisdiction_code,
    case_number,
    opened_at,
    ROW_NUMBER() OVER (
        PARTITION BY jurisdiction_code
        ORDER BY opened_at DESC, id DESC
    ) AS newest_rank_in_jurisdiction
FROM cases;
```

Untuk setiap jurisdiction:

```text
case terbaru -> rank 1
case berikutnya -> rank 2
...
```

Penting:

> `ORDER BY` di dalam `OVER` tidak sama dengan `ORDER BY` final result.

Query result akhir tetap tidak dijamin urut kecuali ada `ORDER BY` luar.

```sql
SELECT ...
FROM ...
ORDER BY jurisdiction_code, newest_rank_in_jurisdiction;
```

---

## 6. Window Function Tidak Mengubah Jumlah Row

Jika input query menghasilkan 1.000 row, window function biasanya tetap menghasilkan 1.000 row, hanya menambah computed columns.

Contoh:

```sql
SELECT
    id,
    case_number,
    status,
    COUNT(*) OVER () AS total_rows_in_result
FROM cases
WHERE status = 'OPEN';
```

Jika ada 250 open cases, setiap row punya:

```text
total_rows_in_result = 250
```

Ini berguna untuk pagination metadata, tetapi hati-hati performance karena database tetap harus mengetahui total.

---

## 7. ROW_NUMBER, RANK, DENSE_RANK

Tiga ranking function paling umum:

```sql
ROW_NUMBER()
RANK()
DENSE_RANK()
```

Misalnya score:

```text
case | risk_score
A    | 100
B    | 90
C    | 90
D    | 80
```

### 7.1 ROW_NUMBER

```text
A 1
B 2
C 3
D 4
```

Tidak ada ties. Setiap row dapat nomor unik berdasarkan ordering.

### 7.2 RANK

```text
A 1
B 2
C 2
D 4
```

Ties mendapat rank sama, rank berikutnya melompat.

### 7.3 DENSE_RANK

```text
A 1
B 2
C 2
D 3
```

Ties mendapat rank sama, rank berikutnya tidak melompat.

---

## 8. Kapan Memakai ROW_NUMBER vs RANK vs DENSE_RANK

Use `ROW_NUMBER` when:

- kamu perlu memilih satu row deterministic
- latest row per group
- deduplication with rule
- pagination internal
- top 1 exact row

Use `RANK` when:

- ranking kompetitif dengan gaps
- jika ada tie, rank berikutnya melompat
- leaderboard style

Use `DENSE_RANK` when:

- ranking group nilai unik tanpa gaps
- top N distinct values
- reporting buckets

Contoh top 3 risk score distinct per jurisdiction:

```sql
WITH ranked AS (
    SELECT
        c.*,
        DENSE_RANK() OVER (
            PARTITION BY jurisdiction_code
            ORDER BY risk_score DESC
        ) AS risk_rank
    FROM cases c
    WHERE risk_score IS NOT NULL
)
SELECT *
FROM ranked
WHERE risk_rank <= 3;
```

Jika banyak case dengan score sama, hasil bisa lebih dari 3 row per jurisdiction.

---

## 9. Deterministic Ordering dalam Window Function

Buruk:

```sql
ROW_NUMBER() OVER (
    PARTITION BY case_id
    ORDER BY transitioned_at DESC
)
```

Jika dua transition punya `transitioned_at` sama, database bebas menentukan urutan.

Lebih baik:

```sql
ROW_NUMBER() OVER (
    PARTITION BY case_id
    ORDER BY transitioned_at DESC, id DESC
)
```

Tambahkan tie-breaker stable.

Rule:

> Jika memakai `ROW_NUMBER` untuk memilih satu row, `ORDER BY` harus deterministic.

Tanpa deterministic ordering, hasil bisa berubah antar execution, plan, atau database version.

---

## 10. Latest Row per Entity Pattern

Pattern:

```sql
WITH ranked AS (
    SELECT
        x.*,
        ROW_NUMBER() OVER (
            PARTITION BY entity_id
            ORDER BY event_time DESC, id DESC
        ) AS rn
    FROM events x
)
SELECT *
FROM ranked
WHERE rn = 1;
```

Contoh latest assignment per case:

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
    case_id,
    officer_id,
    assignment_role,
    assigned_at
FROM ranked_assignments
WHERE rn = 1;
```

Caveat:

If requirement is “current active primary assignment”, use predicate and constraint:

```sql
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL
```

Latest assignment and current assignment are not always same concept.

---

## 11. Top-N per Group

Requirement:

> Top 3 newest cases per jurisdiction.

```sql
WITH ranked_cases AS (
    SELECT
        c.*,
        ROW_NUMBER() OVER (
            PARTITION BY jurisdiction_code
            ORDER BY opened_at DESC, id DESC
        ) AS rn
    FROM cases c
)
SELECT
    jurisdiction_code,
    id,
    case_number,
    opened_at
FROM ranked_cases
WHERE rn <= 3
ORDER BY jurisdiction_code, rn;
```

Grain:

```text
up to 3 rows per jurisdiction
```

If ties should all be included, use `RANK` or `DENSE_RANK`.

---

## 12. Deduplication with Rule

Staging import has duplicates:

```text
source_system, source_case_id, imported_at
```

Requirement:

> Keep latest row per `(source_system, source_case_id)`.

```sql
WITH ranked_staging AS (
    SELECT
        s.*,
        ROW_NUMBER() OVER (
            PARTITION BY source_system, source_case_id
            ORDER BY imported_at DESC, id DESC
        ) AS rn
    FROM staging_cases s
)
SELECT *
FROM ranked_staging
WHERE rn = 1;
```

This is deterministic deduplication.

But do not confuse deduplication with data quality.

Also produce duplicate report:

```sql
SELECT
    source_system,
    source_case_id,
    COUNT(*) AS duplicate_count
FROM staging_cases
GROUP BY source_system, source_case_id
HAVING COUNT(*) > 1;
```

---

## 13. LAG and LEAD

`LAG` reads value from previous row in window order.

`LEAD` reads value from next row.

Example transitions:

```sql
SELECT
    case_id,
    to_status,
    transitioned_at,
    LAG(to_status) OVER (
        PARTITION BY case_id
        ORDER BY transitioned_at, id
    ) AS previous_status,
    LAG(transitioned_at) OVER (
        PARTITION BY case_id
        ORDER BY transitioned_at, id
    ) AS previous_transitioned_at
FROM case_status_transitions;
```

Use cases:

- compare current row to previous row
- detect status jumps
- compute duration between events
- find gaps
- validate sequence
- identify regressions
- audit trail analysis

---

## 14. Duration Between Events

```sql
SELECT
    case_id,
    to_status,
    transitioned_at,
    transitioned_at
      - LAG(transitioned_at) OVER (
            PARTITION BY case_id
            ORDER BY transitioned_at, id
        ) AS duration_since_previous_transition
FROM case_status_transitions;
```

First row per case has no previous transition, so result is NULL.

This is correct.

Question:

```text
What should duration be for first transition?
NULL?
0?
time since case opened?
```

Do not coalesce without domain decision.

---

## 15. Detecting Invalid Transitions

Suppose transition table has:

```text
from_status
to_status
transitioned_at
```

We can compare declared `from_status` to previous `to_status`.

```sql
WITH sequenced AS (
    SELECT
        t.*,
        LAG(to_status) OVER (
            PARTITION BY case_id
            ORDER BY transitioned_at, id
        ) AS actual_previous_status
    FROM case_status_transitions t
)
SELECT *
FROM sequenced
WHERE actual_previous_status IS NOT NULL
  AND from_status IS DISTINCT FROM actual_previous_status;
```

This detects inconsistent audit trail.

Use `IS DISTINCT FROM` if available for null-safe comparison.

---

## 16. FIRST_VALUE and LAST_VALUE

`FIRST_VALUE` returns first value in window frame.

```sql
SELECT
    case_id,
    to_status,
    transitioned_at,
    FIRST_VALUE(to_status) OVER (
        PARTITION BY case_id
        ORDER BY transitioned_at, id
    ) AS first_status
FROM case_status_transitions;
```

`LAST_VALUE` is tricky because default frame often ends at current row, not whole partition.

Bad surprise:

```sql
LAST_VALUE(to_status) OVER (
    PARTITION BY case_id
    ORDER BY transitioned_at, id
) AS last_status
```

This may return current row's status, not final status.

Use explicit frame:

```sql
LAST_VALUE(to_status) OVER (
    PARTITION BY case_id
    ORDER BY transitioned_at, id
    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
) AS final_status
```

Window frames matter.

---

## 17. Window Frames

For aggregate window functions, frame defines subset of rows within partition used for current row.

Common frame:

```sql
ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
```

Meaning:

```text
from first row in partition to current row
```

Running total:

```sql
SELECT
    occurred_at,
    amount,
    SUM(amount) OVER (
        ORDER BY occurred_at, id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS running_total
FROM payments;
```

Without explicit frame, default differs depending function/order/vendor. For professional SQL, specify frame when correctness matters.

---

## 18. ROWS vs RANGE

`ROWS` counts physical rows relative to current row.

`RANGE` uses logical peer groups based on `ORDER BY` value.

Example:

```sql
SUM(amount) OVER (
    ORDER BY occurred_at
    RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
)
```

If multiple rows have same `occurred_at`, they may be included together as peers.

For deterministic running totals, prefer:

```sql
ORDER BY occurred_at, id
ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
```

This avoids peer ambiguity.

---

## 19. Running Totals

Requirement:

> Running count of opened cases by date.

First aggregate per day:

```sql
WITH daily_opened AS (
    SELECT
        opened_at::date AS opened_date,
        COUNT(*) AS opened_cases
    FROM cases
    GROUP BY opened_at::date
)
SELECT
    opened_date,
    opened_cases,
    SUM(opened_cases) OVER (
        ORDER BY opened_date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS cumulative_opened_cases
FROM daily_opened
ORDER BY opened_date;
```

Note:

- first aggregate to one row per day
- then window running total over daily rows

Do not run window over raw cases if metric is daily count.

---

## 20. Moving Average

Requirement:

> 7-day moving average of opened cases.

```sql
WITH daily_opened AS (
    SELECT
        opened_at::date AS opened_date,
        COUNT(*) AS opened_cases
    FROM cases
    GROUP BY opened_at::date
)
SELECT
    opened_date,
    opened_cases,
    AVG(opened_cases) OVER (
        ORDER BY opened_date
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
    ) AS moving_avg_7d
FROM daily_opened
ORDER BY opened_date;
```

Caveat:

If some dates have zero cases and are missing from `daily_opened`, moving average is over existing rows, not calendar days.

For accurate calendar moving average, join to calendar table.

---

## 21. Percent of Total

Requirement:

> Per jurisdiction, show case count and percentage of all cases.

```sql
WITH jurisdiction_counts AS (
    SELECT
        jurisdiction_code,
        COUNT(*) AS case_count
    FROM cases
    GROUP BY jurisdiction_code
)
SELECT
    jurisdiction_code,
    case_count,
    case_count * 100.0 / SUM(case_count) OVER () AS percent_of_total
FROM jurisdiction_counts
ORDER BY case_count DESC;
```

`SUM(case_count) OVER ()` calculates total across all grouped rows.

This avoids separate total query.

---

## 22. Percent Within Partition

Requirement:

> Per status within jurisdiction, percentage of jurisdiction total.

```sql
WITH status_counts AS (
    SELECT
        jurisdiction_code,
        status,
        COUNT(*) AS case_count
    FROM cases
    GROUP BY jurisdiction_code, status
)
SELECT
    jurisdiction_code,
    status,
    case_count,
    case_count * 100.0
        / SUM(case_count) OVER (
            PARTITION BY jurisdiction_code
        ) AS percent_within_jurisdiction
FROM status_counts
ORDER BY jurisdiction_code, status;
```

Grain:

```text
one row per jurisdiction-status
```

Window:

```text
sum case_count per jurisdiction
```

---

## 23. NTILE and Percentile Buckets

`NTILE(n)` divides ordered rows into n buckets.

Example:

```sql
SELECT
    id,
    case_number,
    risk_score,
    NTILE(4) OVER (
        ORDER BY risk_score DESC
    ) AS risk_quartile
FROM cases
WHERE risk_score IS NOT NULL;
```

Use cases:

- quartiles
- deciles
- rough segmentation
- workload distribution

Caveat:

`NTILE` distributes row counts, not value ranges.

If many rows have same risk_score, they can be split across buckets.

For precise percentile analytics, use percentile functions if available.

---

## 24. Window Aggregates vs GROUP BY

GROUP BY:

```sql
SELECT
    jurisdiction_code,
    COUNT(*) AS case_count
FROM cases
GROUP BY jurisdiction_code;
```

Result:

```text
one row per jurisdiction
```

Window aggregate:

```sql
SELECT
    id,
    case_number,
    jurisdiction_code,
    COUNT(*) OVER (
        PARTITION BY jurisdiction_code
    ) AS case_count_in_jurisdiction
FROM cases;
```

Result:

```text
one row per case, with jurisdiction count attached
```

Use `GROUP BY` when you want summary rows.

Use window aggregate when you want detail rows plus summary context.

---

## 25. Combining GROUP BY and Window Functions

Common pattern:

1. group raw data
2. apply window over grouped result

Example:

```sql
WITH monthly_counts AS (
    SELECT
        date_trunc('month', opened_at) AS opened_month,
        COUNT(*) AS opened_cases
    FROM cases
    GROUP BY date_trunc('month', opened_at)
)
SELECT
    opened_month,
    opened_cases,
    SUM(opened_cases) OVER (
        ORDER BY opened_month
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS cumulative_opened_cases
FROM monthly_counts
ORDER BY opened_month;
```

This is analytically clean.

Do not mix raw and grouped grain accidentally.

---

## 26. Filtering on Window Function Result

You generally cannot use window function directly in `WHERE` at same query level because `WHERE` logically runs before `SELECT`.

Bad:

```sql
SELECT
    c.*,
    ROW_NUMBER() OVER (
        PARTITION BY jurisdiction_code
        ORDER BY opened_at DESC
    ) AS rn
FROM cases c
WHERE rn <= 3;
```

Use CTE/derived table:

```sql
WITH ranked AS (
    SELECT
        c.*,
        ROW_NUMBER() OVER (
            PARTITION BY jurisdiction_code
            ORDER BY opened_at DESC, id DESC
        ) AS rn
    FROM cases c
)
SELECT *
FROM ranked
WHERE rn <= 3;
```

Some databases support `QUALIFY`:

```sql
SELECT ...
QUALIFY ROW_NUMBER() OVER (...) <= 3;
```

But `QUALIFY` is not universal.

---

## 27. Window Functions and Pagination

`ROW_NUMBER` can implement offset-like pagination:

```sql
WITH numbered AS (
    SELECT
        c.*,
        ROW_NUMBER() OVER (
            ORDER BY opened_at DESC, id DESC
        ) AS rn
    FROM cases c
    WHERE status = 'OPEN'
)
SELECT *
FROM numbered
WHERE rn BETWEEN 101 AND 150
ORDER BY rn;
```

This is clear but still may require ranking many rows.

For large scrolling, keyset pagination is often better.

Window pagination is useful for:

- reports
- stable snapshots
- admin pages
- when row numbers are required

---

## 28. Window Functions and Deduping Staging Data

Requirement:

> Import latest row for each external key.

```sql
WITH ranked AS (
    SELECT
        s.*,
        ROW_NUMBER() OVER (
            PARTITION BY source_system, source_case_id
            ORDER BY imported_at DESC, id DESC
        ) AS rn
    FROM staging_cases s
    WHERE batch_id = :batch_id
)
SELECT *
FROM ranked
WHERE rn = 1;
```

Then insert/upsert.

But also report duplicates:

```sql
SELECT
    source_system,
    source_case_id,
    COUNT(*) AS duplicate_count
FROM staging_cases
WHERE batch_id = :batch_id
GROUP BY source_system, source_case_id
HAVING COUNT(*) > 1;
```

Deduping without reporting duplicates may hide integration problems.

---

## 29. Window Functions and SCD / Effective-Dated Data

Requirement:

> For each event, find previous event time for same case.

```sql
SELECT
    case_id,
    event_type,
    occurred_at,
    LAG(occurred_at) OVER (
        PARTITION BY case_id
        ORDER BY occurred_at, id
    ) AS previous_occurred_at
FROM case_activity_events;
```

Requirement:

> Build validity intervals from point-in-time status changes.

```sql
SELECT
    case_id,
    to_status AS status,
    transitioned_at AS valid_from,
    LEAD(transitioned_at) OVER (
        PARTITION BY case_id
        ORDER BY transitioned_at, id
    ) AS valid_to
FROM case_status_transitions;
```

This creates intervals:

```text
[valid_from, valid_to)
```

For latest row, `valid_to` is NULL.

This is powerful for temporal analysis.

---

## 30. Window Functions and Audit Queries

Requirement:

> Find cases where status moved from CLOSED to UNDER_REVIEW without reopen event.

```sql
WITH sequenced AS (
    SELECT
        t.*,
        LAG(to_status) OVER (
            PARTITION BY case_id
            ORDER BY transitioned_at, id
        ) AS previous_to_status
    FROM case_status_transitions t
)
SELECT *
FROM sequenced
WHERE previous_to_status = 'CLOSED'
  AND to_status = 'UNDER_REVIEW';
```

Then join to approvals/reopen events if needed.

Window functions are excellent for audit trail validation.

---

## 31. Window Functions and Workload Ranking

Requirement:

> Rank officers by active primary case count per jurisdiction.

First aggregate workload:

```sql
WITH officer_workload AS (
    SELECT
        c.jurisdiction_code,
        a.officer_id,
        COUNT(*) AS active_case_count
    FROM case_assignments a
    JOIN cases c
      ON c.id = a.case_id
    WHERE a.assignment_role = 'PRIMARY'
      AND a.ended_at IS NULL
      AND c.status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED')
    GROUP BY c.jurisdiction_code, a.officer_id
)
SELECT
    jurisdiction_code,
    officer_id,
    active_case_count,
    RANK() OVER (
        PARTITION BY jurisdiction_code
        ORDER BY active_case_count DESC
    ) AS workload_rank
FROM officer_workload
ORDER BY jurisdiction_code, workload_rank;
```

This is a typical professional analytical SQL pattern:

```text
aggregate -> rank aggregate result
```

---

## 32. Window Functions and Latest Non-Null Value

Some databases support `IGNORE NULLS`, many do not.

Problem:

> Carry forward last known risk score.

Without vendor-specific support, this can be complex.

Simpler example with latest risk assessment:

```sql
WITH ranked_assessments AS (
    SELECT
        ra.*,
        ROW_NUMBER() OVER (
            PARTITION BY case_id
            ORDER BY assessed_at DESC, id DESC
        ) AS rn
    FROM risk_assessments ra
    WHERE risk_score IS NOT NULL
)
SELECT *
FROM ranked_assessments
WHERE rn = 1;
```

If you need carry-forward over time series, consider:

- window functions with advanced frame
- recursive CTE
- time-series database features
- application processing
- materialized state table

---

## 33. Window Functions and DISTINCT

Be careful combining `DISTINCT` and window functions.

```sql
SELECT DISTINCT
    case_id,
    ROW_NUMBER() OVER (
        PARTITION BY case_id
        ORDER BY transitioned_at
    ) AS rn
FROM case_status_transitions;
```

`ROW_NUMBER` makes rows distinct because rn differs.

Usually, if you need deduplication, rank first then filter.

```sql
WITH ranked AS (
    SELECT
        t.*,
        ROW_NUMBER() OVER (
            PARTITION BY case_id, to_status
            ORDER BY transitioned_at, id
        ) AS rn
    FROM case_status_transitions t
)
SELECT *
FROM ranked
WHERE rn = 1;
```

---

## 34. Window Functions and NULL Ordering

If ordering column nullable:

```sql
ROW_NUMBER() OVER (
    PARTITION BY case_id
    ORDER BY completed_at DESC
)
```

Where do NULLs appear?

Vendor/default may differ.

Use explicit NULL handling if important:

```sql
ROW_NUMBER() OVER (
    PARTITION BY case_id
    ORDER BY completed_at DESC NULLS LAST, id DESC
)
```

If vendor lacks `NULLS LAST`:

```sql
ORDER BY
    CASE WHEN completed_at IS NULL THEN 1 ELSE 0 END,
    completed_at DESC,
    id DESC
```

---

## 35. Performance Considerations

Window functions often require:

- partitioning
- sorting
- memory
- temp files
- large intermediate results

Performance depends on:

- number of rows
- partition cardinality
- order by columns
- indexes
- filtering before window
- frame size
- parallelism
- work memory / temp disk
- whether query can stream sorted data

Heuristics:

1. Filter rows before window when semantically valid.
2. Partition by columns carefully.
3. Order deterministically but not with unnecessary columns.
4. Use indexes matching partition/order where helpful.
5. Avoid window over huge raw data if pre-aggregation is possible.
6. Check execution plan for sort/spill.
7. Consider materialized summary for repeated analytics.

Example index for latest transition per case:

```sql
CREATE INDEX idx_transitions_case_time_id
ON case_status_transitions (case_id, transitioned_at DESC, id DESC);
```

This can help queries partitioned by case and ordered by transitioned_at, depending database planner.

---

## 36. Window Function Execution Order

Logical order simplified:

```text
FROM
WHERE
GROUP BY
HAVING
WINDOW FUNCTIONS
SELECT
ORDER BY
LIMIT
```

More precisely, window functions are evaluated after grouping/aggregation and before final ordering/limit.

This is why:

- window functions cannot be used in `WHERE` same level
- they can operate over grouped result if query grouped
- final `ORDER BY` is separate from window `ORDER BY`

Example:

```sql
WITH monthly_counts AS (
    SELECT
        date_trunc('month', opened_at) AS month,
        COUNT(*) AS count
    FROM cases
    GROUP BY date_trunc('month', opened_at)
)
SELECT
    month,
    count,
    SUM(count) OVER (ORDER BY month) AS running_count
FROM monthly_counts;
```

---

## 37. Window Functions vs Self Join

Previous row via self join is possible but clumsy.

Self join approach:

```sql
SELECT ...
FROM transitions current
LEFT JOIN transitions previous
  ON previous.case_id = current.case_id
 AND previous.transitioned_at < current.transitioned_at
...
```

Hard to get immediate previous row without more logic.

Window approach:

```sql
LAG(to_status) OVER (
    PARTITION BY case_id
    ORDER BY transitioned_at, id
)
```

Clearer and usually better.

---

## 38. Window Functions vs Correlated Subquery

Latest evidence per case via correlated subquery:

```sql
SELECT
    c.id,
    (
        SELECT e.id
        FROM case_evidences e
        WHERE e.case_id = c.id
        ORDER BY e.received_at DESC, e.id DESC
        LIMIT 1
    ) AS latest_evidence_id
FROM cases c;
```

Window approach:

```sql
WITH ranked_evidence AS (
    SELECT
        e.*,
        ROW_NUMBER() OVER (
            PARTITION BY e.case_id
            ORDER BY e.received_at DESC, e.id DESC
        ) AS rn
    FROM case_evidences e
)
SELECT
    c.id,
    re.id AS latest_evidence_id
FROM cases c
LEFT JOIN ranked_evidence re
  ON re.case_id = c.id
 AND re.rn = 1;
```

Which is better depends on:

- number of cases
- index on evidence
- selectivity
- database optimizer
- whether you need many columns
- whether you only need page of cases
- lateral join availability

For page of cases, lateral can be efficient. For bulk reporting, window/aggregation can be clearer.

---

## 39. Mini Case Study: Latest Transition per Open Case

Requirement:

> Show open cases and their latest status transition.

```sql
WITH open_cases AS (
    SELECT
        id,
        case_number,
        opened_at
    FROM cases
    WHERE status = 'OPEN'
),
ranked_transitions AS (
    SELECT
        t.*,
        ROW_NUMBER() OVER (
            PARTITION BY t.case_id
            ORDER BY t.transitioned_at DESC, t.id DESC
        ) AS rn
    FROM case_status_transitions t
    JOIN open_cases oc
      ON oc.id = t.case_id
)
SELECT
    oc.id,
    oc.case_number,
    rt.to_status AS latest_transition_status,
    rt.transitioned_at AS latest_transitioned_at
FROM open_cases oc
LEFT JOIN ranked_transitions rt
  ON rt.case_id = oc.id
 AND rt.rn = 1
ORDER BY oc.opened_at DESC, oc.id DESC;
```

Notes:

- `open_cases` scopes parent first.
- `ranked_transitions` only ranks transitions for open cases.
- final grain one row per open case.

---

## 40. Mini Case Study: Time in Each Status

Requirement:

> For each case, calculate how long it stayed in each status transition interval.

```sql
WITH status_intervals AS (
    SELECT
        case_id,
        to_status AS status,
        transitioned_at AS valid_from,
        LEAD(transitioned_at) OVER (
            PARTITION BY case_id
            ORDER BY transitioned_at, id
        ) AS valid_to
    FROM case_status_transitions
)
SELECT
    case_id,
    status,
    valid_from,
    valid_to,
    COALESCE(valid_to, now()) - valid_from AS duration_in_status
FROM status_intervals
ORDER BY case_id, valid_from;
```

Caveats:

- `now()` makes query time-dependent.
- For historical report, use report cutoff timestamp.
- If transition order invalid, duration invalid.
- If duplicate timestamps, tie-breaker id matters.
- If transitions missing, intervals wrong.

For regulatory defensibility, report should specify cutoff time.

---

## 41. Mini Case Study: Officer Workload Percentile

Requirement:

> Compute active workload percentile by officer.

First workload:

```sql
WITH workload AS (
    SELECT
        officer_id,
        COUNT(*) AS active_case_count
    FROM case_assignments
    WHERE assignment_role = 'PRIMARY'
      AND ended_at IS NULL
    GROUP BY officer_id
)
SELECT
    officer_id,
    active_case_count,
    CUME_DIST() OVER (
        ORDER BY active_case_count
    ) AS workload_cume_dist,
    PERCENT_RANK() OVER (
        ORDER BY active_case_count
    ) AS workload_percent_rank
FROM workload
ORDER BY active_case_count DESC;
```

`CUME_DIST` and `PERCENT_RANK` are useful but require statistical interpretation.

For operational dashboards, simpler rank may be easier to explain.

---

## 42. Mini Case Study: SLA Breach Sequence

Requirement:

> For each case, show sequence number of SLA breaches.

```sql
SELECT
    case_id,
    breached_at,
    ROW_NUMBER() OVER (
        PARTITION BY case_id
        ORDER BY breached_at, id
    ) AS breach_sequence_number
FROM case_sla_breaches
ORDER BY case_id, breach_sequence_number;
```

Requirement:

> Find cases with repeated breaches within 7 days.

```sql
WITH sequenced AS (
    SELECT
        b.*,
        LAG(breached_at) OVER (
            PARTITION BY case_id
            ORDER BY breached_at, id
        ) AS previous_breached_at
    FROM case_sla_breaches b
)
SELECT *
FROM sequenced
WHERE previous_breached_at IS NOT NULL
  AND breached_at < previous_breached_at + INTERVAL '7 days';
```

---

## 43. Common Window Function Bugs

### Bug 1 — Missing Tie-Breaker

```sql
ORDER BY transitioned_at DESC
```

when timestamps can tie.

### Bug 2 — Assuming Window ORDER BY Sorts Final Result

It does not. Add final `ORDER BY`.

### Bug 3 — Filtering Window Result in WHERE

Use CTE/subquery.

### Bug 4 — LAST_VALUE Default Frame Surprise

Use explicit frame.

### Bug 5 — Running Total with RANGE Peer Ambiguity

Use `ROWS` and deterministic order.

### Bug 6 — Moving Average Missing Zero Dates

Use calendar table.

### Bug 7 — Ranking Raw Rows Instead of Aggregated Metric

Aggregate first, rank second.

### Bug 8 — Deduping Without Reporting Duplicates

Window dedupe hides data quality issue.

### Bug 9 — Window Over Huge Unfiltered Data

Filter/pre-aggregate first if valid.

### Bug 10 — Treating Latest as Current

Latest row is not always current valid row.

---

## 44. Window Function Review Checklist

```text
[ ] What is the input grain?
[ ] What is the output grain?
[ ] Does the window function preserve row count?
[ ] What is the partition?
[ ] What is the ordering?
[ ] Is ordering deterministic?
[ ] Are NULL ordering rules explicit?
[ ] Is frame needed?
[ ] Should frame be ROWS or RANGE?
[ ] Are you ranking raw rows or aggregated rows?
[ ] Are you filtering window result in outer query?
[ ] Is latest row equivalent to business current row?
[ ] Does the query need final ORDER BY?
[ ] Could pre-filtering reduce rows safely?
[ ] Is there supporting index for partition/order?
[ ] Is the result mapped correctly to Java DTO?
```

---

## 45. Decision Guide

Use `GROUP BY` when:

```text
you want one row per group
```

Use window aggregate when:

```text
you want detail rows plus group-level metric
```

Use `ROW_NUMBER` when:

```text
you need deterministic single row selection or sequence
```

Use `RANK` when:

```text
ties should share rank with gaps
```

Use `DENSE_RANK` when:

```text
ties should share rank without gaps
```

Use `LAG/LEAD` when:

```text
you need previous/next row comparison
```

Use explicit frame when:

```text
running total, moving average, FIRST/LAST value, or cumulative calculation
```

Use calendar table when:

```text
time-series analytics needs missing zero periods
```

---

## 46. Practical Exercises

### Exercise 1 — Latest Evidence per Case

```sql
WITH ranked_evidence AS (
    SELECT
        e.*,
        ROW_NUMBER() OVER (
            PARTITION BY case_id
            ORDER BY received_at DESC, id DESC
        ) AS rn
    FROM case_evidences e
)
SELECT *
FROM ranked_evidence
WHERE rn = 1;
```

### Exercise 2 — Top 5 Officers by Workload per Jurisdiction

```sql
WITH workload AS (
    SELECT
        c.jurisdiction_code,
        a.officer_id,
        COUNT(*) AS active_case_count
    FROM case_assignments a
    JOIN cases c
      ON c.id = a.case_id
    WHERE a.assignment_role = 'PRIMARY'
      AND a.ended_at IS NULL
    GROUP BY c.jurisdiction_code, a.officer_id
),
ranked AS (
    SELECT
        workload.*,
        ROW_NUMBER() OVER (
            PARTITION BY jurisdiction_code
            ORDER BY active_case_count DESC, officer_id
        ) AS rn
    FROM workload
)
SELECT *
FROM ranked
WHERE rn <= 5;
```

### Exercise 3 — Status Duration

```sql
WITH intervals AS (
    SELECT
        case_id,
        to_status AS status,
        transitioned_at AS valid_from,
        LEAD(transitioned_at) OVER (
            PARTITION BY case_id
            ORDER BY transitioned_at, id
        ) AS valid_to
    FROM case_status_transitions
)
SELECT
    case_id,
    status,
    valid_from,
    valid_to,
    COALESCE(valid_to, :report_cutoff) - valid_from AS duration
FROM intervals;
```

### Exercise 4 — Running Monthly Total

```sql
WITH monthly AS (
    SELECT
        date_trunc('month', opened_at) AS month,
        COUNT(*) AS opened_cases
    FROM cases
    GROUP BY date_trunc('month', opened_at)
)
SELECT
    month,
    opened_cases,
    SUM(opened_cases) OVER (
        ORDER BY month
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS cumulative_opened_cases
FROM monthly
ORDER BY month;
```

---

## 47. Koneksi ke Part Berikutnya

Bagian ini menyelesaikan lapisan utama query power:

- filtering
- joins
- aggregation
- subqueries/CTEs
- set operations
- window functions

Part berikutnya, `part-011`, akan bergeser dari membaca data ke mengubah data:

- `INSERT`
- `UPDATE`
- `DELETE`
- UPSERT
- `MERGE`
- `RETURNING`
- affected rows
- idempotency
- safe state transitions
- batch writes
- write correctness dari Java

Ini penting karena SQL mastery bukan hanya membaca/reporting, tetapi juga mengubah fakta secara aman.

---

## 48. Ringkasan Bagian Ini

Hal penting dari part 010:

1. Window functions menghitung nilai lintas row tanpa meng-collapse row detail.
2. `GROUP BY` mengubah grain; window function biasanya mempertahankan grain.
3. `OVER` mendefinisikan konteks window.
4. `PARTITION BY` membagi row ke kelompok analitis.
5. `ORDER BY` dalam window menentukan urutan analitis, bukan final result order.
6. `ROW_NUMBER` cocok untuk latest/top/dedup deterministic.
7. `RANK` dan `DENSE_RANK` menangani ties secara berbeda.
8. Tie-breaker penting untuk deterministic result.
9. `LAG` dan `LEAD` sangat berguna untuk audit trail dan event sequence.
10. Window frames penting untuk running total, moving average, dan `LAST_VALUE`.
11. Gunakan `ROWS` untuk running calculation deterministic.
12. Aggregate dulu, window kemudian, untuk metric seperti rank workload.
13. Filter hasil window function dengan CTE/subquery.
14. Latest row tidak selalu sama dengan current valid row.
15. Missing dates harus ditangani dengan calendar table untuk time-series analytics.
16. Window functions sangat kuat untuk reporting, deduplication, audit, and temporal analysis.
17. Performance window function dipengaruhi sorting, partitioning, memory, dan index.

Kalimat inti:

> Window functions memungkinkan kamu menambahkan konteks analitis ke setiap row tanpa kehilangan detail row itu sendiri.

---

## 49. Referensi

1. PostgreSQL Documentation — Window Functions.  
   https://www.postgresql.org/docs/current/functions-window.html

2. PostgreSQL Documentation — Window Function Tutorial.  
   https://www.postgresql.org/docs/current/tutorial-window.html

3. PostgreSQL Documentation — SELECT.  
   https://www.postgresql.org/docs/current/sql-select.html

4. MySQL 8.4 Reference Manual — Window Functions.  
   https://dev.mysql.com/doc/refman/8.4/en/window-functions.html

5. SQL Server Documentation — OVER Clause.  
   https://learn.microsoft.com/en-us/sql/t-sql/queries/select-over-clause-transact-sql

6. SQL Server Documentation — Ranking Functions.  
   https://learn.microsoft.com/en-us/sql/t-sql/functions/ranking-functions-transact-sql

7. Oracle Database SQL Language Reference — Analytic Functions.  
   https://docs.oracle.com/en/database/oracle/oracle-database/23/sqlrf/Analytic-Functions.html

---

## 50. Status Seri

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
- `learn-sql-mastery-for-java-engineers-part-009.md`
- `learn-sql-mastery-for-java-engineers-part-010.md`

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-011.md` — Data Modification: INSERT, UPDATE, DELETE, UPSERT, MERGE
