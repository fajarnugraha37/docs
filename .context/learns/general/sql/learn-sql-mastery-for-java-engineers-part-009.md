# learn-sql-mastery-for-java-engineers-part-009.md

# Part 9 — Set Operations: UNION, INTERSECT, EXCEPT

> Seri: SQL Mastery for Java Engineers  
> Bagian: 009 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-008.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-010.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas query composition dengan subquery, derived table, CTE, dan recursive CTE.

Bagian ini membahas bentuk composition lain: **set operations**.

Set operations menggabungkan hasil beberapa query bukan berdasarkan relationship seperti join, tetapi berdasarkan operasi antar himpunan/barisan hasil:

```sql
UNION
UNION ALL
INTERSECT
EXCEPT
```

Contoh:

```sql
SELECT case_id
FROM case_evidences

UNION

SELECT case_id
FROM case_status_transitions
WHERE to_status = 'ESCALATED';
```

Makna:

> Case yang punya evidence atau pernah escalated.

Set operations sangat berguna untuk:

- menggabungkan beberapa sumber data dengan shape sama
- membuat feed dari beberapa event table
- reconciliation
- membandingkan dataset
- mencari missing rows
- deduplication
- audit validation
- migration verification
- query alternatif untuk `OR`
- membedakan “A or B”, “A and B”, dan “A but not B”

Namun set operations juga punya banyak nuance:

- `UNION` menghapus duplicate
- `UNION ALL` mempertahankan duplicate
- column count harus sama
- type antar column harus compatible
- nama column output biasanya diambil dari query pertama
- `ORDER BY` berlaku untuk hasil final kecuali pakai subquery
- `INTERSECT` dan `EXCEPT` punya duplicate semantics
- tidak semua vendor mendukung semua operator dengan cara sama
- set semantics SQL berbeda dari mathematical set karena SQL punya bag/multiset behavior

Kalimat inti:

> Set operations adalah cara berpikir “gabungkan, iris, atau kurangi result set” tanpa harus memaksa semuanya menjadi join.

---

## 1. Mental Model: Join vs Set Operation

### 1.1 Join

Join menggabungkan column dari beberapa relation berdasarkan predicate.

```sql
SELECT
    c.id,
    c.case_number,
    e.id AS evidence_id
FROM cases c
JOIN case_evidences e
  ON e.case_id = c.id;
```

Output melebar:

```text
case columns + evidence columns
```

Join berpotensi memperbanyak row karena matching combinations.

### 1.2 Set Operation

Set operation menggabungkan row dari beberapa query dengan shape compatible.

```sql
SELECT case_id
FROM case_evidences

UNION

SELECT case_id
FROM case_status_transitions
WHERE to_status = 'ESCALATED';
```

Output tidak melebar; output tetap shape yang sama:

```text
case_id
```

Set operation menumpuk atau membandingkan result sets.

### 1.3 Analogi

Join:

```text
horizontal combination
```

Set operation:

```text
vertical combination / set comparison
```

---

## 2. Syarat Dasar Set Operation

Setiap query dalam set operation harus memiliki:

1. jumlah column yang sama
2. urutan column yang compatible
3. tipe data yang bisa dicocokkan/cast
4. makna column yang sebaiknya sama

Contoh valid:

```sql
SELECT
    case_id,
    occurred_at,
    'EVIDENCE_RECEIVED' AS activity_type
FROM case_evidences

UNION ALL

SELECT
    case_id,
    transitioned_at AS occurred_at,
    'STATUS_TRANSITION' AS activity_type
FROM case_status_transitions;
```

Kedua query menghasilkan:

```text
case_id, occurred_at, activity_type
```

Contoh tidak valid:

```sql
SELECT
    case_id,
    received_at
FROM case_evidences

UNION

SELECT
    case_id,
    from_status,
    to_status
FROM case_status_transitions;
```

Jumlah column berbeda.

---

## 3. UNION

`UNION` menggabungkan result set dan menghapus duplicate.

```sql
SELECT case_id
FROM case_evidences

UNION

SELECT case_id
FROM case_status_transitions
WHERE to_status = 'ESCALATED';
```

Jika hasil pertama:

```text
C1
C2
C2
C3
```

Hasil kedua:

```text
C2
C4
```

`UNION` menghasilkan:

```text
C1
C2
C3
C4
```

Duplicate dihapus.

### 3.1 Kapan UNION Cocok

Gunakan `UNION` ketika:

- kamu ingin unique result
- duplicate tidak bermakna
- query merepresentasikan logical OR antar sumber
- kamu ingin deduplicate secara eksplisit
- kamu menggabungkan entity ID dari beberapa sumber

Contoh:

> Case yang punya evidence atau punya enforcement action.

```sql
SELECT case_id
FROM case_evidences

UNION

SELECT case_id
FROM enforcement_actions;
```

Output grain:

```text
one row per distinct case_id
```

---

## 4. UNION ALL

`UNION ALL` menggabungkan result set tanpa menghapus duplicate.

```sql
SELECT case_id
FROM case_evidences

UNION ALL

SELECT case_id
FROM case_status_transitions
WHERE to_status = 'ESCALATED';
```

Jika hasil pertama:

```text
C1
C2
C2
C3
```

Hasil kedua:

```text
C2
C4
```

`UNION ALL` menghasilkan:

```text
C1
C2
C2
C3
C2
C4
```

Duplicate dipertahankan.

### 4.1 Kapan UNION ALL Cocok

Gunakan `UNION ALL` ketika:

- duplicate bermakna
- kamu sedang membuat event/activity feed
- kamu ingin menghitung total occurrences
- kamu menggabungkan log rows
- sumber data sudah mutually exclusive
- performance penting dan dedup tidak perlu
- kamu akan aggregate setelahnya dengan definisi jelas

Contoh activity feed:

```sql
SELECT
    case_id,
    received_at AS occurred_at,
    'EVIDENCE_RECEIVED' AS activity_type
FROM case_evidences

UNION ALL

SELECT
    case_id,
    transitioned_at AS occurred_at,
    'STATUS_TRANSITION' AS activity_type
FROM case_status_transitions

UNION ALL

SELECT
    case_id,
    issued_at AS occurred_at,
    'ENFORCEMENT_ACTION_ISSUED' AS activity_type
FROM enforcement_actions
WHERE issued_at IS NOT NULL;
```

Jika satu case punya 3 evidence dan 2 transitions, feed harus punya 5 activity rows. `UNION ALL` benar.

---

## 5. UNION vs UNION ALL: Correctness dan Performance

`UNION` biasanya membutuhkan deduplication.

Deduplication dapat melibatkan:

- sort
- hash aggregate
- memory
- temp disk
- CPU
- comparison cost

`UNION ALL` lebih murah karena hanya append result sets.

Prinsip:

> Gunakan `UNION ALL` secara default jika duplicate memang valid atau sumber sudah mutually exclusive. Gunakan `UNION` hanya jika deduplication adalah bagian dari definisi hasil.

Jangan memakai `UNION` hanya karena takut duplicate tanpa memahami metric/entity.

---

## 6. INTERSECT

`INTERSECT` mengambil row yang muncul di kedua result set.

```sql
SELECT case_id
FROM case_evidences

INTERSECT

SELECT case_id
FROM case_status_transitions
WHERE to_status = 'ESCALATED';
```

Makna:

> Case yang punya evidence dan pernah escalated.

Jika A:

```text
C1
C2
C3
```

B:

```text
C2
C3
C4
```

A `INTERSECT` B:

```text
C2
C3
```

### 6.1 Kapan INTERSECT Cocok

Gunakan `INTERSECT` untuk:

- mencari overlap antar dataset
- reconciliation
- validation
- “entity satisfying both source membership”
- membandingkan hasil dua query

Contoh:

> Case yang ada di import staging dan juga sudah ada di production.

```sql
SELECT case_number_normalized
FROM staging_cases
WHERE batch_id = :batch_id

INTERSECT

SELECT case_number_normalized
FROM cases
WHERE tenant_id = :tenant_id;
```

---

## 7. EXCEPT

`EXCEPT` mengambil row dari result set pertama yang tidak ada di result set kedua.

PostgreSQL/SQL standard:

```sql
SELECT case_id
FROM case_evidences

EXCEPT

SELECT case_id
FROM case_assignments;
```

Makna:

> Case yang punya evidence tetapi tidak punya assignment.

If A:

```text
C1
C2
C3
```

B:

```text
C2
C4
```

A `EXCEPT` B:

```text
C1
C3
```

Oracle uses `MINUS` historically for similar operation.

### 7.1 Kapan EXCEPT Cocok

Gunakan `EXCEPT` untuk:

- missing data
- reconciliation
- migration validation
- “expected minus actual”
- finding gaps
- comparing query results
- data quality checks

Contoh:

> Case di staging yang belum ada di production.

```sql
SELECT case_number_normalized
FROM staging_cases
WHERE batch_id = :batch_id

EXCEPT

SELECT case_number_normalized
FROM cases
WHERE tenant_id = :tenant_id;
```

---

## 8. EXCEPT vs NOT EXISTS

Requirement:

> Cases with no evidence.

Using `NOT EXISTS`:

```sql
SELECT
    c.id
FROM cases c
WHERE NOT EXISTS (
    SELECT 1
    FROM case_evidences e
    WHERE e.case_id = c.id
);
```

Using `EXCEPT`:

```sql
SELECT id
FROM cases

EXCEPT

SELECT case_id
FROM case_evidences;
```

Both can be valid.

### 8.1 Prefer NOT EXISTS When

- you need columns from parent
- correlated conditions are needed
- null-safety matters
- query is entity-centric
- readability is clearer

### 8.2 Prefer EXCEPT When

- comparing two sets directly
- doing reconciliation
- both sides have same shape
- you want “A minus B” expressed literally
- ad-hoc validation
- migration comparison

Example with multiple columns:

```sql
SELECT
    tenant_id,
    case_number_normalized
FROM staging_cases

EXCEPT

SELECT
    tenant_id,
    case_number_normalized
FROM cases;
```

This is very natural for dataset comparison.

---

## 9. Duplicate Semantics: DISTINCT vs ALL

Standard set operations usually have distinct behavior by default:

```sql
UNION
INTERSECT
EXCEPT
```

They remove duplicates according to set semantics.

Many databases support `ALL` variants:

```sql
UNION ALL
INTERSECT ALL
EXCEPT ALL
```

Support varies by vendor.

### 9.1 UNION ALL

Widely supported.

### 9.2 INTERSECT ALL

Preserves duplicate counts according to multiset intersection.

If A:

```text
C1
C1
C1
C2
```

B:

```text
C1
C1
C3
```

A `INTERSECT ALL` B:

```text
C1
C1
```

because min count of C1 is 2.

### 9.3 EXCEPT ALL

Subtracts duplicate counts.

If A:

```text
C1
C1
C1
C2
```

B:

```text
C1
C1
C3
```

A `EXCEPT ALL` B:

```text
C1
C2
```

because 3 - 2 = 1 C1 remains.

Vendor support differs. For business SQL, `UNION ALL` is most commonly used among `ALL` variants.

---

## 10. Column Names in Set Operations

Output column names usually come from the first query.

```sql
SELECT
    received_at AS occurred_at,
    'EVIDENCE' AS activity_type
FROM case_evidences

UNION ALL

SELECT
    transitioned_at AS transition_time,
    'TRANSITION' AS type
FROM case_status_transitions;
```

Final output columns likely:

```text
occurred_at
activity_type
```

Names from second query are ignored for final result.

Best practice:

- alias columns clearly in first query
- keep aliases semantically aligned in all branches
- use CTE wrapper if needed

```sql
WITH case_activities AS (
    SELECT
        case_id,
        received_at AS occurred_at,
        'EVIDENCE_RECEIVED' AS activity_type
    FROM case_evidences

    UNION ALL

    SELECT
        case_id,
        transitioned_at AS occurred_at,
        'STATUS_TRANSITION' AS activity_type
    FROM case_status_transitions
)
SELECT
    case_id,
    occurred_at,
    activity_type
FROM case_activities
ORDER BY occurred_at DESC;
```

---

## 11. Type Compatibility

Column positions must be type-compatible.

```sql
SELECT
    case_id,
    received_at AS occurred_at
FROM case_evidences

UNION ALL

SELECT
    case_id,
    transitioned_at AS occurred_at
FROM case_status_transitions;
```

Good if both:

```text
case_id UUID
occurred_at TIMESTAMPTZ
```

If one branch returns text date:

```sql
SELECT
    case_id,
    received_at::text AS occurred_at
FROM case_evidences

UNION ALL

SELECT
    case_id,
    transitioned_at
FROM case_status_transitions;
```

The database may coerce type or error. Even if it works, output type may become text, breaking ordering/time semantics.

Always align types intentionally.

```sql
SELECT
    case_id,
    received_at::timestamptz AS occurred_at
FROM ...
```

or fix schema.

---

## 12. ORDER BY with Set Operations

This is important.

```sql
SELECT case_id, received_at AS occurred_at
FROM case_evidences

UNION ALL

SELECT case_id, transitioned_at AS occurred_at
FROM case_status_transitions

ORDER BY occurred_at DESC;
```

`ORDER BY` applies to final combined result.

If you want to order/limit each branch before union, use subquery/CTE.

Example:

```sql
(
    SELECT
        case_id,
        received_at AS occurred_at,
        'EVIDENCE' AS activity_type
    FROM case_evidences
    ORDER BY received_at DESC
    LIMIT 100
)

UNION ALL

(
    SELECT
        case_id,
        transitioned_at AS occurred_at,
        'TRANSITION' AS activity_type
    FROM case_status_transitions
    ORDER BY transitioned_at DESC
    LIMIT 100
)

ORDER BY occurred_at DESC
LIMIT 100;
```

Vendor syntax around parentheses may vary.

### 12.1 Global Top-N Feed

If building global activity feed, often:

1. take recent rows from each source
2. union all
3. order final
4. limit final

```sql
WITH recent_evidence AS (
    SELECT
        case_id,
        received_at AS occurred_at,
        'EVIDENCE_RECEIVED' AS activity_type
    FROM case_evidences
    ORDER BY received_at DESC
    LIMIT 500
),
recent_transitions AS (
    SELECT
        case_id,
        transitioned_at AS occurred_at,
        'STATUS_TRANSITION' AS activity_type
    FROM case_status_transitions
    ORDER BY transitioned_at DESC
    LIMIT 500
),
activities AS (
    SELECT * FROM recent_evidence
    UNION ALL
    SELECT * FROM recent_transitions
)
SELECT *
FROM activities
ORDER BY occurred_at DESC
LIMIT 100;
```

This is an approximation unless branch limits are sufficiently high and all sources considered. For exact feed, you may need a unified event table/read model.

---

## 13. LIMIT with Set Operations

`LIMIT` at the end applies to final set.

```sql
SELECT ...
FROM source_a

UNION ALL

SELECT ...
FROM source_b

LIMIT 10;
```

This means 10 rows from combined result, not 10 per source.

If you need 10 per source, limit inside each branch with subquery/CTE.

---

## 14. UNION as Alternative to OR

Query with OR:

```sql
SELECT
    id,
    case_number
FROM cases
WHERE tenant_id = :tenant_id
  AND (
      status = 'ESCALATED'
      OR priority = 'CRITICAL'
  );
```

Alternative:

```sql
SELECT
    id,
    case_number
FROM cases
WHERE tenant_id = :tenant_id
  AND status = 'ESCALATED'

UNION

SELECT
    id,
    case_number
FROM cases
WHERE tenant_id = :tenant_id
  AND priority = 'CRITICAL';
```

Why might this help?

- each branch can use different index
- predicate simpler
- clearer separation
- dedup handles cases satisfying both conditions

Why might this be worse?

- scans table/index twice
- dedup cost
- more verbose
- optimizer may already handle OR well

Use only when it improves clarity or measured performance.

If duplicate should be preserved, use `UNION ALL`, but for OR semantics unique entities are usually desired, so `UNION` is often correct.

---

## 15. UNION ALL for Event Feed

Suppose activity sources:

```text
case_evidences
case_status_transitions
enforcement_actions
case_notes
```

You want one activity feed.

```sql
WITH activities AS (
    SELECT
        case_id,
        received_at AS occurred_at,
        'EVIDENCE_RECEIVED' AS activity_type,
        id AS source_id
    FROM case_evidences

    UNION ALL

    SELECT
        case_id,
        transitioned_at AS occurred_at,
        'STATUS_TRANSITION' AS activity_type,
        id AS source_id
    FROM case_status_transitions

    UNION ALL

    SELECT
        case_id,
        issued_at AS occurred_at,
        'ENFORCEMENT_ACTION_ISSUED' AS activity_type,
        id AS source_id
    FROM enforcement_actions
    WHERE issued_at IS NOT NULL
)
SELECT
    case_id,
    occurred_at,
    activity_type,
    source_id
FROM activities
WHERE case_id = :case_id
ORDER BY occurred_at DESC, activity_type, source_id;
```

Use `UNION ALL` because each row is an event occurrence. Duplicate timestamps are not duplicates.

Need deterministic ordering:

```sql
ORDER BY occurred_at DESC, activity_type, source_id
```

---

## 16. Feed Design: UNION ALL vs Unified Event Table

UNION ALL feed is useful if:

- sources are few
- volume moderate
- query not too frequent
- fields align easily
- feed is not core high-throughput feature

Unified event table may be better if:

- feed is high traffic
- many event sources
- need global ordering
- need cursor pagination
- need authorization filtering
- need retention/archive
- need search
- need event replay
- need consistent schema

Unified table:

```sql
CREATE TABLE case_activity_events (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    activity_type TEXT NOT NULL,
    source_table TEXT NOT NULL,
    source_id UUID NOT NULL,
    payload JSONB NOT NULL
);
```

Then query:

```sql
SELECT
    case_id,
    occurred_at,
    activity_type,
    source_id
FROM case_activity_events
WHERE case_id = :case_id
ORDER BY occurred_at DESC, id DESC
LIMIT 100;
```

Set operation can be a stepping stone toward read model design.

---

## 17. INTERSECT vs EXISTS for “Both Conditions”

Requirement:

> Cases that have evidence and have enforcement action.

Using `INTERSECT`:

```sql
SELECT case_id
FROM case_evidences

INTERSECT

SELECT case_id
FROM enforcement_actions;
```

Using `EXISTS`:

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
    FROM enforcement_actions ea
    WHERE ea.case_id = c.id
);
```

Use `INTERSECT` when set comparison itself is the focus.

Use `EXISTS` when query is case-centric and you need case columns/filter scope.

In multi-tenant systems, be careful:

```sql
SELECT tenant_id, case_id
FROM case_evidences

INTERSECT

SELECT tenant_id, case_id
FROM enforcement_actions;
```

Include tenant_id if IDs are not globally unique or to make boundary explicit.

---

## 18. EXCEPT for Data Quality

Requirement:

> Evidence rows referencing cases that do not exist.

If FK is not enforced or checking staging:

```sql
SELECT
    tenant_id,
    case_id
FROM staging_evidences

EXCEPT

SELECT
    tenant_id,
    id AS case_id
FROM cases;
```

This finds `(tenant_id, case_id)` present in staging_evidences but absent in cases.

Alternative:

```sql
SELECT
    e.tenant_id,
    e.case_id
FROM staging_evidences e
WHERE NOT EXISTS (
    SELECT 1
    FROM cases c
    WHERE c.tenant_id = e.tenant_id
      AND c.id = e.case_id
);
```

Both valid.

`EXCEPT` is compact for set difference.

`NOT EXISTS` is more flexible if you need more columns from staging rows.

---

## 19. Reconciliation Pattern: Expected vs Actual

Expected cases:

```sql
SELECT
    tenant_id,
    case_number_normalized
FROM staging_cases
WHERE batch_id = :batch_id
```

Actual cases:

```sql
SELECT
    tenant_id,
    case_number_normalized
FROM cases
WHERE source_batch_id = :batch_id
```

Missing actual:

```sql
SELECT
    tenant_id,
    case_number_normalized
FROM staging_cases
WHERE batch_id = :batch_id

EXCEPT

SELECT
    tenant_id,
    case_number_normalized
FROM cases
WHERE source_batch_id = :batch_id;
```

Unexpected actual:

```sql
SELECT
    tenant_id,
    case_number_normalized
FROM cases
WHERE source_batch_id = :batch_id

EXCEPT

SELECT
    tenant_id,
    case_number_normalized
FROM staging_cases
WHERE batch_id = :batch_id;
```

Matched:

```sql
SELECT
    tenant_id,
    case_number_normalized
FROM staging_cases
WHERE batch_id = :batch_id

INTERSECT

SELECT
    tenant_id,
    case_number_normalized
FROM cases
WHERE source_batch_id = :batch_id;
```

This is extremely useful for migration/import validation.

---

## 20. Set Operations and NULL

Set operations compare rows for duplicate elimination/matching.

Unlike `WHERE col = NULL`, set duplicate semantics often treat nulls as not distinct for purposes of duplicate elimination in many databases.

Example:

```sql
SELECT NULL

UNION

SELECT NULL;
```

Typically returns one NULL row.

But vendor details can vary in edge cases. More importantly, think semantically:

If a key column can be NULL in set comparison, what does that mean?

Example:

```sql
SELECT case_id
FROM staging_evidences

EXCEPT

SELECT id
FROM cases;
```

If `staging_evidences.case_id` can be NULL, then NULL may appear in result as “missing case_id”.

That might be useful for data quality, or it might pollute result. Handle explicitly:

```sql
SELECT case_id
FROM staging_evidences
WHERE case_id IS NOT NULL

EXCEPT

SELECT id
FROM cases;
```

And separately:

```sql
SELECT *
FROM staging_evidences
WHERE case_id IS NULL;
```

---

## 21. Set Operations and Duplicates in Data Quality

Suppose staging has duplicate case numbers.

```sql
SELECT case_number_normalized
FROM staging_cases

EXCEPT

SELECT case_number_normalized
FROM cases;
```

This only tells which distinct case numbers are missing.

It does not tell duplicate count.

For duplicate quality, use aggregation:

```sql
SELECT
    case_number_normalized,
    COUNT(*) AS duplicate_count
FROM staging_cases
GROUP BY case_number_normalized
HAVING COUNT(*) > 1;
```

Set operations are not replacement for aggregate data quality checks.

---

## 22. Set Operations and Column Semantics

This query is syntactically valid:

```sql
SELECT
    case_number,
    status
FROM cases

UNION

SELECT
    officer_code,
    full_name
FROM officers;
```

If types compatible, database may allow it.

But semantically it is nonsense:

```text
case_number/status
union
officer_code/full_name
```

Set operation requires not only type compatibility, but meaning compatibility.

Correct feed example:

```sql
SELECT
    case_id,
    occurred_at,
    activity_type
FROM evidence_activity

UNION ALL

SELECT
    case_id,
    occurred_at,
    activity_type
FROM transition_activity;
```

Same column meanings.

---

## 23. Set Operations with Tags/Labels

Requirement:

> Build set of case IDs matching any of several independent criteria.

Criteria:

- high priority
- escalated
- has enforcement action
- overdue SLA

Use `UNION`:

```sql
WITH matching_cases AS (
    SELECT id AS case_id
    FROM cases
    WHERE priority = 'CRITICAL'

    UNION

    SELECT id AS case_id
    FROM cases
    WHERE status = 'ESCALATED'

    UNION

    SELECT case_id
    FROM enforcement_actions

    UNION

    SELECT case_id
    FROM case_slas
    WHERE completed_at IS NULL
      AND due_at < now()
)
SELECT
    c.id,
    c.case_number,
    c.status,
    c.priority
FROM cases c
JOIN matching_cases mc
  ON mc.case_id = c.id
ORDER BY c.opened_at DESC;
```

This expresses OR across heterogeneous sources.

If you need reasons/labels, use `UNION ALL` with reason column.

```sql
WITH case_flags AS (
    SELECT
        id AS case_id,
        'CRITICAL_PRIORITY' AS flag
    FROM cases
    WHERE priority = 'CRITICAL'

    UNION ALL

    SELECT
        id AS case_id,
        'ESCALATED_STATUS' AS flag
    FROM cases
    WHERE status = 'ESCALATED'

    UNION ALL

    SELECT
        case_id,
        'HAS_ENFORCEMENT_ACTION' AS flag
    FROM enforcement_actions
)
SELECT *
FROM case_flags;
```

Then aggregate flags per case if needed.

---

## 24. Flag Aggregation after UNION ALL

```sql
WITH case_flags AS (
    SELECT
        id AS case_id,
        'CRITICAL_PRIORITY' AS flag
    FROM cases
    WHERE priority = 'CRITICAL'

    UNION ALL

    SELECT
        id AS case_id,
        'ESCALATED_STATUS' AS flag
    FROM cases
    WHERE status = 'ESCALATED'

    UNION ALL

    SELECT
        case_id,
        'HAS_ENFORCEMENT_ACTION' AS flag
    FROM enforcement_actions
),
flag_counts AS (
    SELECT
        case_id,
        COUNT(*) AS flag_count
    FROM case_flags
    GROUP BY case_id
)
SELECT
    c.id,
    c.case_number,
    fc.flag_count
FROM cases c
JOIN flag_counts fc
  ON fc.case_id = c.id
ORDER BY fc.flag_count DESC, c.opened_at DESC;
```

If enforcement_actions can have multiple rows per case and you want only one flag per case, dedupe that branch:

```sql
SELECT DISTINCT
    case_id,
    'HAS_ENFORCEMENT_ACTION' AS flag
FROM enforcement_actions
```

Again, define metric.

---

## 25. Set Operations and CTE Composition

CTE makes set operations readable.

```sql
WITH evidence_cases AS (
    SELECT DISTINCT
        case_id
    FROM case_evidences
),
escalated_cases AS (
    SELECT DISTINCT
        case_id
    FROM case_status_transitions
    WHERE to_status = 'ESCALATED'
),
cases_with_both AS (
    SELECT case_id FROM evidence_cases
    INTERSECT
    SELECT case_id FROM escalated_cases
)
SELECT
    c.id,
    c.case_number
FROM cases c
JOIN cases_with_both b
  ON b.case_id = c.id;
```

This is verbose but very clear for audit/reconciliation.

---

## 26. Set Operations in Data Migration

Migration validation often asks:

```text
Are source and target equivalent?
What is missing?
What is extra?
What changed?
```

### 26.1 Missing Rows

```sql
SELECT
    source_id,
    normalized_name
FROM source_customers

EXCEPT

SELECT
    source_id,
    normalized_name
FROM target_customers;
```

### 26.2 Extra Rows

```sql
SELECT
    source_id,
    normalized_name
FROM target_customers

EXCEPT

SELECT
    source_id,
    normalized_name
FROM source_customers;
```

### 26.3 Changed Attributes

If comparing whole row projection:

```sql
SELECT
    customer_id,
    normalized_name,
    status,
    updated_at
FROM source_projection

EXCEPT

SELECT
    customer_id,
    normalized_name,
    status,
    updated_at
FROM target_projection;
```

This finds rows not exactly matching.

For detailed diff, join by key and compare columns.

Set operation tells “different”; join comparison tells “which column differs”.

---

## 27. Set Operations vs Full Outer Join for Diff

Set operations:

```sql
source EXCEPT target
target EXCEPT source
```

Good for row-level equality.

Full outer join:

```sql
SELECT
    s.id AS source_id,
    t.id AS target_id,
    s.status AS source_status,
    t.status AS target_status
FROM source_cases s
FULL OUTER JOIN target_cases t
  ON t.case_number = s.case_number
WHERE s.id IS NULL
   OR t.id IS NULL
   OR s.status IS DISTINCT FROM t.status;
```

Good for explaining differences per column.

Use both:

- set operations for quick validation
- full outer join for diagnostic detail

---

## 28. Parentheses and Precedence

Set operations have precedence rules that vary/require care.

Example:

```sql
query_a
UNION
query_b
INTERSECT
query_c
```

Do not rely on memory.

Use parentheses/CTEs for clarity:

```sql
WITH a_or_b AS (
    SELECT ... FROM a
    UNION
    SELECT ... FROM b
),
c AS (
    SELECT ... FROM c
)
SELECT *
FROM a_or_b

INTERSECT

SELECT *
FROM c;
```

When mixing set operations, prefer CTEs.

---

## 29. Set Operations and ORDER BY Column References

After set operation, `ORDER BY` can usually reference output column names or ordinal positions, depending vendor.

Prefer output names:

```sql
SELECT
    case_id,
    occurred_at,
    activity_type
FROM activities
ORDER BY occurred_at DESC, case_id;
```

Avoid ordinal:

```sql
ORDER BY 2 DESC
```

because it becomes fragile when select list changes.

---

## 30. Set Operations and Security Scope

Always apply tenant/security filters in every branch.

Bad:

```sql
SELECT id AS case_id
FROM cases
WHERE tenant_id = :tenant_id
  AND priority = 'CRITICAL'

UNION

SELECT case_id
FROM enforcement_actions;
```

Second branch lacks tenant filter. It may leak or mix tenants.

Correct:

```sql
SELECT id AS case_id
FROM cases
WHERE tenant_id = :tenant_id
  AND priority = 'CRITICAL'

UNION

SELECT case_id
FROM enforcement_actions
WHERE tenant_id = :tenant_id;
```

Security filters must be branch-complete.

---

## 31. Set Operations and Java DTO Mapping

For activity feed DTO:

```java
record CaseActivityDto(
    UUID caseId,
    Instant occurredAt,
    String activityType,
    UUID sourceId
) {}
```

SQL:

```sql
WITH activities AS (
    SELECT
        case_id,
        received_at AS occurred_at,
        'EVIDENCE_RECEIVED' AS activity_type,
        id AS source_id
    FROM case_evidences
    WHERE case_id = :case_id

    UNION ALL

    SELECT
        case_id,
        transitioned_at AS occurred_at,
        'STATUS_TRANSITION' AS activity_type,
        id AS source_id
    FROM case_status_transitions
    WHERE case_id = :case_id
)
SELECT
    case_id,
    occurred_at,
    activity_type,
    source_id
FROM activities
ORDER BY occurred_at DESC, activity_type, source_id;
```

Ensure:

- all branches return same types
- aliases match DTO
- activity_type values map to enum
- ordering deterministic
- pagination stable if used
- source_id uniqueness may only be unique within activity_type, so cursor may need `(occurred_at, activity_type, source_id)`

---

## 32. Performance Considerations

Set operation performance depends on:

- number of rows per branch
- duplicate elimination cost
- sort/hash memory
- indexes supporting branch filters
- final order by
- limit pushdown possibilities
- type casts
- parallelism
- branch selectivity
- materialization

Heuristics:

1. Use `UNION ALL` when dedup not needed.
2. Filter each branch early.
3. Project only needed columns.
4. Avoid type casts in set branches unless necessary.
5. Limit branch rows only if semantically safe.
6. Use CTEs to make branch meaning clear.
7. Inspect execution plan for heavy set queries.
8. Consider read model for frequent union-all feed.

---

## 33. Common Set Operation Bugs

### Bug 1 — Using UNION When UNION ALL Needed

Activity feed loses duplicate events if rows identical.

### Bug 2 — Using UNION ALL When UNION Needed

Entity list contains duplicates.

### Bug 3 — Branch Missing Tenant Filter

Security/data isolation bug.

### Bug 4 — Type Coercion to Text

Timestamp/numeric semantics lost.

### Bug 5 — Misaligned Columns

Column positions match syntactically but meanings differ.

### Bug 6 — ORDER BY Assumed Per Branch

Final ordering differs from expectation.

### Bug 7 — LIMIT Applied Globally Instead of Per Branch

Unexpected source distribution.

### Bug 8 — EXCEPT Hides Duplicate Count

Set difference works on distinct rows unless ALL variant.

### Bug 9 — NULL Key Mixed Into Reconciliation

Missing-key records need separate validation.

### Bug 10 — Using Set Operation When Join Explains Diff Better

Set operation says row differs, not why.

---

## 34. Mini Case Study: Case Activity Feed

Requirement:

> Show timeline of a case from evidence, status transition, and enforcement action.

```sql
WITH activities AS (
    SELECT
        case_id,
        received_at AS occurred_at,
        'EVIDENCE_RECEIVED' AS activity_type,
        id AS source_id
    FROM case_evidences
    WHERE case_id = :case_id

    UNION ALL

    SELECT
        case_id,
        transitioned_at AS occurred_at,
        'STATUS_TRANSITION' AS activity_type,
        id AS source_id
    FROM case_status_transitions
    WHERE case_id = :case_id

    UNION ALL

    SELECT
        case_id,
        issued_at AS occurred_at,
        'ENFORCEMENT_ACTION_ISSUED' AS activity_type,
        id AS source_id
    FROM enforcement_actions
    WHERE case_id = :case_id
      AND issued_at IS NOT NULL
)
SELECT
    case_id,
    occurred_at,
    activity_type,
    source_id
FROM activities
ORDER BY occurred_at ASC, activity_type, source_id;
```

Why `UNION ALL`?

Because each row is an event occurrence.

If two events happen at same timestamp, both must appear.

---

## 35. Mini Case Study: Import Reconciliation

Requirement:

> Validate staging cases against production cases for a batch.

Missing in production:

```sql
SELECT
    tenant_id,
    case_number_normalized
FROM staging_cases
WHERE batch_id = :batch_id
  AND case_number_normalized IS NOT NULL

EXCEPT

SELECT
    tenant_id,
    case_number_normalized
FROM cases
WHERE source_batch_id = :batch_id;
```

Extra in production:

```sql
SELECT
    tenant_id,
    case_number_normalized
FROM cases
WHERE source_batch_id = :batch_id

EXCEPT

SELECT
    tenant_id,
    case_number_normalized
FROM staging_cases
WHERE batch_id = :batch_id
  AND case_number_normalized IS NOT NULL;
```

Invalid staging rows:

```sql
SELECT *
FROM staging_cases
WHERE batch_id = :batch_id
  AND case_number_normalized IS NULL;
```

Duplicate staging rows:

```sql
SELECT
    tenant_id,
    case_number_normalized,
    COUNT(*) AS duplicate_count
FROM staging_cases
WHERE batch_id = :batch_id
GROUP BY tenant_id, case_number_normalized
HAVING COUNT(*) > 1;
```

Set operations plus aggregation create strong reconciliation coverage.

---

## 36. Mini Case Study: Cases Matching Any Risk Signal

Requirement:

> Find cases that match any risk signal and show why.

Signals:

- critical priority
- escalated status
- overdue SLA
- enforcement action exists

```sql
WITH risk_flags AS (
    SELECT
        id AS case_id,
        'CRITICAL_PRIORITY' AS flag
    FROM cases
    WHERE tenant_id = :tenant_id
      AND priority = 'CRITICAL'

    UNION ALL

    SELECT
        id AS case_id,
        'ESCALATED_STATUS' AS flag
    FROM cases
    WHERE tenant_id = :tenant_id
      AND status = 'ESCALATED'

    UNION ALL

    SELECT
        case_id,
        'OVERDUE_SLA' AS flag
    FROM case_slas
    WHERE tenant_id = :tenant_id
      AND completed_at IS NULL
      AND due_at < now()

    UNION ALL

    SELECT DISTINCT
        case_id,
        'HAS_ENFORCEMENT_ACTION' AS flag
    FROM enforcement_actions
    WHERE tenant_id = :tenant_id
),
flag_counts AS (
    SELECT
        case_id,
        COUNT(*) AS flag_count
    FROM risk_flags
    GROUP BY case_id
)
SELECT
    c.id,
    c.case_number,
    fc.flag_count
FROM cases c
JOIN flag_counts fc
  ON fc.case_id = c.id
ORDER BY fc.flag_count DESC, c.opened_at DESC;
```

If you need actual flag list, use array/string aggregation depending vendor.

---

## 37. Mini Case Study: Compare Two Report Queries

Requirement:

> Verify that old report and new report return same case IDs.

```sql
WITH old_report AS (
    SELECT id AS case_id
    FROM cases
    WHERE status = 'OPEN'
      AND priority IN ('HIGH', 'CRITICAL')
),
new_report AS (
    SELECT id AS case_id
    FROM cases
    WHERE status IN ('OPEN', 'UNDER_REVIEW')
      AND risk_score >= 80
)
SELECT
    'OLD_MINUS_NEW' AS diff_type,
    case_id
FROM (
    SELECT case_id FROM old_report
    EXCEPT
    SELECT case_id FROM new_report
) d

UNION ALL

SELECT
    'NEW_MINUS_OLD' AS diff_type,
    case_id
FROM (
    SELECT case_id FROM new_report
    EXCEPT
    SELECT case_id FROM old_report
) d;
```

This is powerful for safe report migration.

---

## 38. Review Checklist: Set Operations

```text
[ ] Are all branches returning the same number of columns?
[ ] Are corresponding columns semantically the same?
[ ] Are corresponding types compatible intentionally?
[ ] Are aliases defined clearly in first branch?
[ ] Is UNION or UNION ALL correct?
[ ] Are duplicates meaningful?
[ ] Is deduplication part of business definition?
[ ] Are tenant/security filters applied in every branch?
[ ] Is ORDER BY intended for final result?
[ ] Is LIMIT intended globally or per branch?
[ ] Are NULL keys handled intentionally?
[ ] Is INTERSECT/EXCEPT supported by target vendor?
[ ] Would EXISTS/NOT EXISTS be clearer?
[ ] Would FULL OUTER JOIN explain differences better?
[ ] Is performance acceptable with dedup/sort/hash cost?
```

---

## 39. Decision Guide

Use:

```text
UNION
```

when:

```text
A or B, unique entities desired
```

Use:

```text
UNION ALL
```

when:

```text
append events/rows, duplicates meaningful or impossible
```

Use:

```text
INTERSECT
```

when:

```text
entities common to A and B
```

Use:

```text
EXCEPT
```

when:

```text
entities in A but not B
```

Use:

```text
EXISTS
```

when:

```text
parent row should qualify if child exists
```

Use:

```text
NOT EXISTS
```

when:

```text
parent row should qualify if child does not exist
```

Use:

```text
JOIN
```

when:

```text
you need columns from related rows
```

Use:

```text
FULL OUTER JOIN
```

when:

```text
you need side-by-side diff details
```

---

## 40. Practical Exercises

### Exercise 1 — Activity Feed

Build timeline from notes and evidence.

```sql
WITH activities AS (
    SELECT
        case_id,
        created_at AS occurred_at,
        'NOTE_CREATED' AS activity_type,
        id AS source_id
    FROM case_notes
    WHERE case_id = :case_id

    UNION ALL

    SELECT
        case_id,
        received_at AS occurred_at,
        'EVIDENCE_RECEIVED' AS activity_type,
        id AS source_id
    FROM case_evidences
    WHERE case_id = :case_id
)
SELECT *
FROM activities
ORDER BY occurred_at DESC, activity_type, source_id;
```

### Exercise 2 — Missing Case Numbers

```sql
SELECT case_number_normalized
FROM staging_cases
WHERE batch_id = :batch_id

EXCEPT

SELECT case_number_normalized
FROM cases
WHERE tenant_id = :tenant_id;
```

### Exercise 3 — Cases in Both Sources

```sql
SELECT case_id
FROM case_evidences

INTERSECT

SELECT case_id
FROM enforcement_actions;
```

### Exercise 4 — OR Rewrite

Original:

```sql
SELECT id
FROM cases
WHERE tenant_id = :tenant_id
  AND (
      status = 'ESCALATED'
      OR priority = 'CRITICAL'
  );
```

Union alternative:

```sql
SELECT id
FROM cases
WHERE tenant_id = :tenant_id
  AND status = 'ESCALATED'

UNION

SELECT id
FROM cases
WHERE tenant_id = :tenant_id
  AND priority = 'CRITICAL';
```

Discuss whether deduplication is desired.

---

## 41. Koneksi ke Part Berikutnya

Part ini membahas set operations.

Part berikutnya, `part-010`, akan membahas window functions:

- `OVER`
- `PARTITION BY`
- `ORDER BY`
- `ROW_NUMBER`
- `RANK`
- `DENSE_RANK`
- running totals
- moving averages
- top-N per group
- latest row per entity
- analytical SQL without collapsing rows like `GROUP BY`

Window functions adalah salah satu fitur yang membedakan SQL biasa dari SQL profesional.

---

## 42. Ringkasan Bagian Ini

Hal penting dari part 009:

1. Join menggabungkan column secara horizontal; set operation menggabungkan/membandingkan rows secara vertikal.
2. Semua branch set operation harus punya jumlah column sama dan type compatible.
3. `UNION` menghapus duplicate.
4. `UNION ALL` mempertahankan duplicate dan biasanya lebih murah.
5. Gunakan `UNION ALL` untuk event/activity feed.
6. Gunakan `UNION` untuk logical OR dengan unique entities.
7. `INTERSECT` mencari overlap antara result sets.
8. `EXCEPT` mencari row di A yang tidak ada di B.
9. `EXCEPT` sangat berguna untuk reconciliation/migration validation.
10. `NOT EXISTS` sering lebih aman daripada anti-query dengan `NOT IN`.
11. Output column names biasanya dari branch pertama.
12. `ORDER BY` dan `LIMIT` di akhir berlaku untuk hasil final.
13. Branch-level ordering/limit perlu subquery/CTE.
14. Tenant/security filter harus ada di setiap branch.
15. Set operations bisa menyembunyikan duplicate count; gunakan aggregation untuk data quality.
16. Untuk diff detail, full outer join sering lebih explanatory.
17. Type compatibility tidak cukup; column semantics juga harus cocok.
18. Set operations adalah alat penting untuk audit, reconciliation, feed, dan report migration.

Kalimat inti:

> Set operations membantu kamu berpikir dalam bentuk result set: gabungkan, iris, atau kurangi kumpulan fakta tanpa memaksa semuanya menjadi join.

---

## 43. Referensi

1. PostgreSQL Documentation — Combining Queries: UNION, INTERSECT, EXCEPT.  
   https://www.postgresql.org/docs/current/queries-union.html

2. PostgreSQL Documentation — SELECT.  
   https://www.postgresql.org/docs/current/sql-select.html

3. MySQL 8.4 Reference Manual — UNION Clause.  
   https://dev.mysql.com/doc/refman/8.4/en/union.html

4. SQL Server Documentation — Set Operators: UNION, EXCEPT, INTERSECT.  
   https://learn.microsoft.com/en-us/sql/t-sql/language-elements/set-operators-union-transact-sql

5. Oracle Database SQL Language Reference — Set Operators.  
   https://docs.oracle.com/en/database/oracle/oracle-database/23/sqlrf/The-UNION-ALL-INTERSECT-MINUS-Operators.html

---

## 44. Status Seri

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

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-010.md` — Window Functions: Professional-Grade SQL Analytics


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-008.md">⬅️ Part 8 — Subqueries, Derived Tables, CTEs, and Query Composition</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-010.md">Part 10 — Window Functions: Professional-Grade SQL Analytics ➡️</a>
</div>
