# learn-sql-mastery-for-java-engineers-part-028.md

# Part 28 — Bulk Data, ETL, Import/Export, and Data Reconciliation

> Seri: SQL Mastery for Java Engineers  
> Bagian: 028 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-027.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-029.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas migrations and database change management: Flyway/Liquibase, expand-contract, zero-downtime migration, backfill, online index, dan change safety.

Sekarang kita membahas operasi data volume besar:

```text
bulk insert
bulk update
import
export
ETL
ELT
staging tables
validation
deduplication
reconciliation
batch jobs
large data movement
```

Banyak Java engineer terbiasa menulis:

```java
for (Row row : rows) {
    repository.save(row);
}
```

Untuk 100 rows, mungkin cukup.

Untuk 10 juta rows, ini bisa menghancurkan production:

- connection pool penuh
- transaction terlalu panjang
- locks terlalu lama
- WAL/redo membengkak
- replication lag
- index bloat
- memory app habis
- ORM persistence context bengkak
- partial import tidak jelas
- duplicate data
- data quality buruk
- reconciliation impossible
- export membocorkan PII
- user download timeout

Bulk data engineering berbeda dari CRUD.

Bagian ini membahas bagaimana top 1% engineer memperlakukan data movement sebagai operasi sistem, bukan loop.

Kalimat inti:

> Bulk data bukan hanya banyak INSERT; bulk data adalah pipeline yang harus idempotent, validated, observable, resumable, secure, dan reconciled.

---

## 1. Bulk Data vs OLTP CRUD

OLTP CRUD:

```text
one user action
small number of rows
low latency
strong transaction boundary
interactive response
```

Bulk data:

```text
many rows
long-running
high throughput
batch-oriented
failure-prone
needs resume
needs audit/reconciliation
can affect production load
```

Contoh bulk data:

- import CSV 5 juta customer
- load evidence metadata dari external agency
- nightly ETL to warehouse
- export regulatory report
- backfill normalized column
- merge duplicate parties
- import bank transactions
- sync reference data
- rebuild read model
- migrate table split
- replay outbox events
- delete/archive old data

Bulk workload harus didesain berbeda.

---

## 2. ETL vs ELT

### 2.1 ETL

Extract → Transform → Load

```text
source -> app/pipeline transforms -> database target
```

Transformasi terjadi sebelum load.

### 2.2 ELT

Extract → Load → Transform

```text
source -> raw/staging table -> SQL transforms into target
```

Transformasi terjadi di database/warehouse.

Untuk relational DB, ELT sering efektif:

- load raw data cepat ke staging
- validate with SQL
- deduplicate with SQL
- insert/update target set-based
- reconcile counts
- preserve raw input for audit

Pattern yang sering bagus:

```text
raw input file
import batch record
staging table
validation table
dedup/normalize
merge into target
reconciliation report
mark batch completed
```

---

## 3. Jangan Langsung Import ke Target Table

Bad:

```java
for (CsvRow row : csvRows) {
    insertIntoCases(row);
}
```

Problems:

- partial import sulit dilacak
- validation bercampur write target
- duplicate handling berantakan
- rollback giant transaction
- no raw audit
- no reconciliation
- hard resume
- app memory heavy
- one bad row can stop everything

Better:

```text
load to staging
validate
report errors
deduplicate
merge good rows
archive/reject bad rows
record batch status
```

Staging table adalah safety buffer.

---

## 4. Import Batch Table

Setiap import harus punya batch identity.

```sql
CREATE TABLE import_batches (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    source_system TEXT NOT NULL,
    source_file_name TEXT,
    source_file_hash TEXT,
    status TEXT NOT NULL,
    total_rows INTEGER,
    valid_rows INTEGER,
    invalid_rows INTEGER,
    inserted_rows INTEGER,
    updated_rows INTEGER,
    skipped_rows INTEGER,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    failure_reason TEXT,
    created_by UUID,

    CHECK (status IN (
        'RECEIVED',
        'LOADED',
        'VALIDATED',
        'APPLIED',
        'FAILED',
        'CANCELLED'
    ))
);
```

Batch table menjawab:

```text
File apa diimport?
Kapan?
Oleh siapa?
Berapa rows?
Berapa valid/invalid?
Berapa inserted/updated?
Status apa?
Jika gagal, gagal di mana?
```

Tanpa batch, import sulit diaudit.

---

## 5. Raw/Staging Table

Example staging for case import:

```sql
CREATE TABLE staging_case_import_rows (
    import_batch_id UUID NOT NULL REFERENCES import_batches(id),
    row_number INTEGER NOT NULL,
    raw_payload JSONB NOT NULL,

    case_number_raw TEXT,
    opened_at_raw TEXT,
    status_raw TEXT,
    priority_raw TEXT,
    officer_external_id_raw TEXT,

    case_number_normalized TEXT,
    opened_at TIMESTAMPTZ,
    status TEXT,
    priority TEXT,
    officer_id UUID,

    validation_status TEXT NOT NULL DEFAULT 'PENDING',
    validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,

    PRIMARY KEY (import_batch_id, row_number)
);
```

Design choices:

- keep raw values
- keep parsed/normalized values
- keep validation status
- keep errors
- preserve row number
- link to batch

Raw data preservation is critical for debugging and audit.

---

## 6. Load First, Validate Later

For large files, load into staging quickly.

Then validate using SQL.

Benefits:

- load is simple and fast
- validation set-based
- errors can be reported together
- bad rows don't stop entire import
- deduplication easier
- reconciliation possible

Example validation:

```sql
UPDATE staging_case_import_rows
SET
    validation_status = 'INVALID',
    validation_errors = validation_errors || '["missing_case_number"]'::jsonb
WHERE import_batch_id = :batch_id
  AND (case_number_raw IS NULL OR trim(case_number_raw) = '');
```

---

## 7. Validation Categories

Validate:

### 7.1 Shape

```text
required columns present
date format valid
number format valid
enum value recognized
string length allowed
```

### 7.2 Referential

```text
officer external ID exists
tenant exists
case type exists
jurisdiction exists
reference data valid at date
```

### 7.3 Business

```text
status transition allowed
opened_at before closed_at
priority valid for case type
SLA rule exists
duplicate case policy
```

### 7.4 Security

```text
tenant matches user/import context
source authorized
PII allowed
file type allowed
```

### 7.5 Reconciliation

```text
expected row count
hash matches
totals match source
duplicate count known
```

---

## 8. Validation Error Model

Do not stop at first error if user needs import report.

Store errors per row:

```json
[
  {"code": "missing_case_number", "message": "Case number is required"},
  {"code": "unknown_officer", "message": "Officer external ID not found"}
]
```

In SQL JSON style:

```sql
UPDATE staging_case_import_rows
SET validation_errors = validation_errors || jsonb_build_array(
    jsonb_build_object(
        'code', 'unknown_officer',
        'field', 'officer_external_id',
        'value', officer_external_id_raw
    )
)
WHERE ...
```

Or use separate error table:

```sql
CREATE TABLE staging_case_import_errors (
    import_batch_id UUID NOT NULL,
    row_number INTEGER NOT NULL,
    error_code TEXT NOT NULL,
    field_name TEXT,
    raw_value TEXT,
    message TEXT NOT NULL,

    PRIMARY KEY (import_batch_id, row_number, error_code, field_name)
);
```

Separate table is easier to query/report at scale.

---

## 9. Parsing and Normalization

Normalize in staging:

```sql
UPDATE staging_case_import_rows
SET
    case_number_normalized = upper(regexp_replace(trim(case_number_raw), '\s+', '', 'g')),
    status = upper(trim(status_raw)),
    priority = upper(trim(priority_raw))
WHERE import_batch_id = :batch_id;
```

Date parsing may be safer in app if format is complex.

Be explicit:

- timezone
- locale
- decimal separator
- date format
- encoding
- header names
- trim rules
- empty string vs NULL
- case normalization

Never assume CSV data is clean.

---

## 10. Deduplication Within Import

Duplicate rows in same file:

```sql
SELECT case_number_normalized, COUNT(*)
FROM staging_case_import_rows
WHERE import_batch_id = :batch_id
GROUP BY case_number_normalized
HAVING COUNT(*) > 1;
```

Mark duplicates:

```sql
WITH duplicates AS (
    SELECT
        import_batch_id,
        row_number,
        row_number() OVER (
            PARTITION BY case_number_normalized
            ORDER BY row_number
        ) AS rn
    FROM staging_case_import_rows
    WHERE import_batch_id = :batch_id
)
UPDATE staging_case_import_rows s
SET validation_status = 'INVALID'
FROM duplicates d
WHERE s.import_batch_id = d.import_batch_id
  AND s.row_number = d.row_number
  AND d.rn > 1;
```

Need business policy:

- first wins
- last wins
- reject all duplicates
- merge rows
- manual review

---

## 11. Deduplication Against Target

Check existing target:

```sql
SELECT s.row_number, c.id AS existing_case_id
FROM staging_case_import_rows s
JOIN cases c
  ON c.tenant_id = :tenant_id
 AND c.case_number_normalized = s.case_number_normalized
WHERE s.import_batch_id = :batch_id;
```

Policy:

```text
insert new only
update existing
upsert
skip existing
error on existing
merge if same external_id
```

Do not default to upsert without domain decision.

Upsert can overwrite good data with stale import.

---

## 12. Idempotent Import

If same file/request is retried, result should not duplicate data.

Techniques:

### 12.1 Source File Hash

```sql
UNIQUE (tenant_id, source_system, source_file_hash)
```

### 12.2 Source Row Key

```sql
UNIQUE (tenant_id, source_system, source_record_id)
```

### 12.3 Import Batch ID

Batch-specific staging rows.

### 12.4 Target External Reference

```sql
CREATE TABLE case_external_refs (
    tenant_id UUID NOT NULL,
    source_system TEXT NOT NULL,
    source_case_id TEXT NOT NULL,
    case_id UUID NOT NULL,

    PRIMARY KEY (tenant_id, source_system, source_case_id)
);
```

Idempotency must be designed before retries happen.

---

## 13. Source System Identity

Never rely only on human-readable names.

Use external IDs:

```text
source_system
source_record_id
source_version
source_event_id
```

Target mapping:

```sql
CREATE TABLE external_identity_map (
    tenant_id UUID NOT NULL,
    source_system TEXT NOT NULL,
    source_entity_type TEXT NOT NULL,
    source_entity_id TEXT NOT NULL,
    internal_entity_type TEXT NOT NULL,
    internal_entity_id UUID NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,

    PRIMARY KEY (
        tenant_id,
        source_system,
        source_entity_type,
        source_entity_id
    )
);
```

This supports reconciliation and idempotency.

---

## 14. Applying Staging to Target

Insert valid new cases:

```sql
INSERT INTO cases (
    id,
    tenant_id,
    case_number,
    case_number_normalized,
    status,
    priority,
    opened_at,
    created_at
)
SELECT
    gen_random_uuid(),
    :tenant_id,
    s.case_number_raw,
    s.case_number_normalized,
    s.status,
    s.priority,
    s.opened_at,
    now()
FROM staging_case_import_rows s
WHERE s.import_batch_id = :batch_id
  AND s.validation_status = 'VALID'
  AND NOT EXISTS (
      SELECT 1
      FROM cases c
      WHERE c.tenant_id = :tenant_id
        AND c.case_number_normalized = s.case_number_normalized
  );
```

Set-based insert is faster and more consistent than row loop.

---

## 15. Upsert Carefully

Upsert example:

```sql
INSERT INTO cases (
    tenant_id,
    case_number_normalized,
    status,
    priority,
    opened_at
)
SELECT ...
FROM staging_case_import_rows
WHERE ...
ON CONFLICT (tenant_id, case_number_normalized)
DO UPDATE
SET
    priority = EXCLUDED.priority,
    updated_at = now();
```

Danger:

- stale import overwrites newer manual update
- null import values overwrite existing values
- status changed unexpectedly
- audit/history bypassed
- optimistic conflict ignored

Safer:

```sql
DO UPDATE
SET priority = EXCLUDED.priority
WHERE cases.last_source_updated_at < EXCLUDED.last_source_updated_at;
```

or only update selected fields.

Upsert is a business rule, not just convenience.

---

## 16. Import Transaction Boundary

Options:

### 16.1 Whole Import One Transaction

Pros:

- all-or-nothing

Cons:

- huge transaction
- locks long
- rollback huge
- replication lag
- memory/WAL pressure

Suitable for small imports.

### 16.2 Stage/Validate/Apply in Phases

Each phase commits.

Pros:

- resumable
- observable
- lower lock time

Cons:

- partial state exists
- status machine needed
- cleanup needed

Usually better for large import.

### 16.3 Apply in Batches

Commit every N rows.

Pros:

- scalable
- recoverable

Cons:

- target partially applied
- need idempotency/reconciliation
- cannot simple rollback

Large imports should be explicitly resumable, not one giant transaction.

---

## 17. Batch Processing Pattern

```text
while true:
  select next batch of staging rows
  apply to target
  mark rows applied
  commit
  update progress
  sleep/throttle if needed
```

Staging row status:

```text
PENDING
VALID
INVALID
APPLYING
APPLIED
FAILED
SKIPPED
```

Add timestamps:

```text
validated_at
applied_at
failed_at
```

This supports resume after crash.

---

## 18. Avoid OFFSET in Batch Jobs

Bad:

```sql
SELECT *
FROM staging_rows
ORDER BY row_number
LIMIT 1000 OFFSET 1000000;
```

OFFSET gets slower.

Better keyset/cursor:

```sql
SELECT *
FROM staging_rows
WHERE import_batch_id = :batch_id
  AND row_number > :last_row_number
ORDER BY row_number
LIMIT 1000;
```

Or status-based claim:

```sql
SELECT *
FROM staging_rows
WHERE status = 'VALID'
ORDER BY row_number
LIMIT 1000
FOR UPDATE SKIP LOCKED;
```

---

## 19. Worker Claim Pattern

For parallel apply:

```sql
WITH next_rows AS (
    SELECT import_batch_id, row_number
    FROM staging_case_import_rows
    WHERE import_batch_id = :batch_id
      AND validation_status = 'VALID'
      AND apply_status = 'PENDING'
    ORDER BY row_number
    LIMIT 1000
    FOR UPDATE SKIP LOCKED
)
UPDATE staging_case_import_rows s
SET apply_status = 'APPLYING',
    applying_worker_id = :worker_id,
    applying_started_at = now()
FROM next_rows n
WHERE s.import_batch_id = n.import_batch_id
  AND s.row_number = n.row_number
RETURNING s.*;
```

Then worker applies and marks `APPLIED`.

Need recovery for stuck `APPLYING`.

---

## 20. Reconciliation

Reconciliation verifies target matches source expectation.

Types:

### 20.1 Count Reconciliation

```text
source rows: 1,000,000
loaded staging: 1,000,000
valid: 980,000
invalid: 20,000
inserted: 700,000
updated: 280,000
```

### 20.2 Sum Reconciliation

For financial data:

```text
source total amount = target total amount
```

### 20.3 Hash Reconciliation

Compare deterministic hash of key fields.

### 20.4 Sample Reconciliation

Random/manual sample.

### 20.5 Referential Reconciliation

Ensure mappings and FKs valid.

No import should be considered complete without reconciliation appropriate to domain.

---

## 21. Reconciliation Table

```sql
CREATE TABLE import_reconciliation_results (
    id UUID PRIMARY KEY,
    import_batch_id UUID NOT NULL REFERENCES import_batches(id),
    check_name TEXT NOT NULL,
    expected_value TEXT,
    actual_value TEXT,
    status TEXT NOT NULL,
    details JSONB,
    checked_at TIMESTAMPTZ NOT NULL,

    CHECK (status IN ('PASS', 'FAIL', 'WARNING'))
);
```

Examples:

```text
row_count_loaded
valid_count
duplicate_count
target_insert_count
amount_sum_match
orphan_reference_count
```

Store reconciliation results for audit.

---

## 22. Error Handling and Reject Files

For invalid rows, produce error report.

Fields:

```text
row_number
field_name
raw_value
error_code
message
```

Export reject file:

```csv
row_number,field,error_code,message
15,case_number,missing_case_number,Case number is required
27,officer_external_id,unknown_officer,Officer external id not found
```

This lets users correct and re-import.

Reject handling is product feature, not afterthought.

---

## 23. Import Security

Import is attack surface.

Risks:

- malicious CSV formula injection
- huge file DoS
- invalid encoding
- path traversal in filenames
- malware in uploaded file
- unauthorized tenant import
- PII ingestion not allowed
- duplicate data poisoning
- SQL injection via later dynamic use
- stored XSS if text displayed
- zip bombs

Controls:

- file size limit
- content type validation
- virus scan if needed
- strict parser
- encoding handling
- tenant authorization
- field validation
- no raw HTML rendering
- CSV export formula escaping
- audit import actions

---

## 24. CSV Formula Injection

If exported CSV contains cell:

```text
=HYPERLINK("http://evil", "click")
```

Spreadsheet may execute formula.

When exporting user-controlled text to CSV, prefix dangerous values:

- `=`
- `+`
- `-`
- `@`
- tab
- carriage return

Mitigation example:

```text
'=<formula>
```

or safe escaping depending policy.

CSV export security is often overlooked.

---

## 25. Export Design

Export is bulk read.

Questions:

```text
Who can export?
What columns?
How many rows?
What filters?
Is PII included?
Is audit recorded?
Is file encrypted?
How long available?
Can export be cancelled?
Does it run on primary or replica?
Is it snapshot-consistent?
Does it stream or async generate?
```

Small export can be synchronous.

Large export should be async job.

---

## 26. Synchronous vs Async Export

### 26.1 Synchronous

HTTP request generates response.

Good for:

- small data
- quick report
- low risk

Bad for:

- millions rows
- long-running DB read
- client disconnect
- timeout
- memory pressure

### 26.2 Async

Request creates export job.

Worker generates file to object storage.

User downloads later.

Benefits:

- resumable
- audit
- retry
- progress
- large data
- avoids HTTP timeout
- can throttle
- can run on replica/warehouse

For serious export, async is better.

---

## 27. Export Job Table

```sql
CREATE TABLE export_jobs (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    requested_by UUID NOT NULL,
    export_type TEXT NOT NULL,
    filters JSONB NOT NULL,
    status TEXT NOT NULL,
    row_count BIGINT,
    file_uri TEXT,
    file_hash TEXT,
    requested_at TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    failure_reason TEXT,

    CHECK (status IN (
        'REQUESTED',
        'RUNNING',
        'COMPLETED',
        'FAILED',
        'CANCELLED',
        'EXPIRED'
    ))
);
```

Store:

- who exported
- what filters
- when
- row count
- file hash
- status
- expiration

Export is security-relevant event.

---

## 28. Snapshot Consistency for Export

If export requires consistent snapshot:

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT ...
SELECT ...

COMMIT;
```

But long snapshot can affect MVCC cleanup and replication.

Alternatives:

- read replica
- report snapshot table
- materialized view
- warehouse
- export from immutable snapshot
- chunk by stable key and accept eventual semantics if documented

Define export semantics:

```text
as of job start
as of each row read
eventually consistent
from last reporting snapshot
```

---

## 29. Export Pagination/Streaming

Use keyset/cursor internally.

Bad:

```sql
LIMIT 10000 OFFSET :offset
```

Better:

```sql
WHERE id > :last_id
ORDER BY id
LIMIT 10000
```

For ordered export:

```sql
WHERE (created_at, id) > (:last_created_at, :last_id)
ORDER BY created_at, id
LIMIT 10000
```

Write each batch to file.

Do not hold all rows in memory.

---

## 30. Large Result Streaming from Java

JDBC streaming pattern:

```java
PreparedStatement ps = conn.prepareStatement(sql);
ps.setFetchSize(1000);
ResultSet rs = ps.executeQuery();

while (rs.next()) {
    writeRow(rs);
}
```

Caveats:

- driver-specific
- connection held
- transaction/snapshot held
- network interruptions
- output backpressure
- error midway
- partial file cleanup
- audit

Async export job can handle these better than request thread.

---

## 31. ETL to Warehouse

OLTP database is optimized for transactions.

Analytics warehouse is optimized for scans/aggregations.

ETL/ELT to warehouse:

```text
OLTP -> CDC/outbox/snapshot export -> lake/warehouse -> transformed marts
```

Benefits:

- heavy reports off OLTP
- historical analytics
- large joins/aggregations
- BI access
- separate security controls

Risks:

- data freshness lag
- semantic drift
- PII propagation
- reconciliation needed
- schema evolution
- duplicate events
- late arriving data

Warehouse data still needs governance.

---

## 32. CDC for Data Movement

Change Data Capture reads database log/changes.

Pros:

- near real-time
- captures inserts/updates/deletes
- less app coupling
- good for warehouse/search/sync

Cons:

- row-level, not domain-level
- schema evolution complexity
- deletes/redactions
- ordering
- transaction boundaries
- operational complexity
- downstream idempotency

CDC is not a replacement for domain events when semantics matter.

---

## 33. Outbox for Integration

Outbox stores domain events atomically with DB writes.

Good for:

- service integration
- projection updates
- search indexing
- downstream consumers
- event-driven read models

Outbox event:

```sql
CREATE TABLE outbox_events (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    event_version INTEGER NOT NULL,
    payload JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ
);
```

Publisher must handle duplicate publish and retry.

---

## 34. Import from External Events

For event imports, use inbox table.

```sql
CREATE TABLE inbox_events (
    tenant_id UUID NOT NULL,
    source_system TEXT NOT NULL,
    source_event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    processed_at TIMESTAMPTZ,
    processing_status TEXT NOT NULL,

    PRIMARY KEY (tenant_id, source_system, source_event_id)
);
```

This provides idempotency.

Processing:

1. insert inbox event
2. if duplicate, ignore or compare payload hash
3. process in transaction
4. mark processed

---

## 35. Data Quality Rules

Data quality dimensions:

```text
completeness
validity
uniqueness
consistency
accuracy
timeliness
referential integrity
conformance
```

Examples:

- required fields present
- date format valid
- status allowed
- no duplicate external ID
- officer exists
- opened_at <= closed_at
- amount totals match
- data received within expected window

Data quality should be measurable.

---

## 36. Data Quality Metrics

Store metrics:

```sql
CREATE TABLE data_quality_checks (
    id UUID PRIMARY KEY,
    check_name TEXT NOT NULL,
    scope TEXT NOT NULL,
    status TEXT NOT NULL,
    expected_value TEXT,
    actual_value TEXT,
    checked_at TIMESTAMPTZ NOT NULL,
    details JSONB
);
```

Examples:

```text
orphan_case_notes_count
duplicate_external_refs_count
null_required_fields_count
invalid_status_count
read_model_drift_count
```

Data quality monitoring prevents silent corruption.

---

## 37. Reconciliation Between Systems

If syncing from external system:

```text
source says 10,000 active cases
target has 9,998
```

Need reconcile.

Techniques:

- compare counts by partition/date/status
- compare checksums
- compare max updated_at
- compare list of IDs
- sample records
- full outer join on exported snapshots

Example:

```sql
SELECT source_id
FROM staging_source_ids
EXCEPT
SELECT source_case_id
FROM case_external_refs
WHERE source_system = :source;
```

And reverse:

```sql
SELECT source_case_id
FROM case_external_refs
WHERE source_system = :source
EXCEPT
SELECT source_id
FROM staging_source_ids;
```

Set operations are powerful for reconciliation.

---

## 38. Full Outer Reconciliation

```sql
SELECT
    COALESCE(s.source_id, t.source_case_id) AS source_id,
    CASE
        WHEN s.source_id IS NULL THEN 'MISSING_IN_SOURCE'
        WHEN t.source_case_id IS NULL THEN 'MISSING_IN_TARGET'
        WHEN s.hash <> t.hash THEN 'DIFFERENT'
        ELSE 'MATCH'
    END AS reconciliation_status
FROM staging_source_snapshot s
FULL OUTER JOIN target_snapshot t
  ON t.source_case_id = s.source_id;
```

Hash key fields:

```text
status|priority|opened_at|officer_id
```

Be careful with null normalization and ordering.

---

## 39. Checksums

Create deterministic hash:

```sql
md5(
    coalesce(status, '') || '|' ||
    coalesce(priority, '') || '|' ||
    coalesce(opened_at::text, '')
)
```

Caveats:

- text formatting differences
- timezone
- numeric scale
- nulls
- field ordering
- hash collision theoretically
- vendor functions differ

For high assurance, use stronger hash and canonical serialization.

---

## 40. Bulk Delete/Archive

Deleting millions rows can hurt production.

Risks:

- long locks
- bloat
- WAL/redo
- FK cascades
- replication lag
- vacuum pressure
- accidental data loss

Better:

- delete in batches
- archive first
- partition drop if time-partitioned
- soft delete + later purge
- retention policy
- legal hold checks
- audit
- validation

Batch delete:

```sql
DELETE FROM audit_events
WHERE id IN (
    SELECT id
    FROM audit_events
    WHERE occurred_at < :cutoff
    ORDER BY occurred_at
    LIMIT 10000
);
```

Repeat with throttle.

Partition drop is much faster if designed.

---

## 41. Archive Tables

Archive pattern:

```text
move old closed cases to archive schema/table
```

Questions:

- still queryable?
- same constraints?
- same security?
- same audit?
- how restore?
- reports need both current + archive?
- foreign keys across archive?
- application behavior?
- storage cost?
- retention policy?

Archive is not dumping forgotten data. It is lifecycle design.

---

## 42. Staging Index Strategy

During load:

- too many indexes slow insert
- no indexes slow validation/join

Strategy:

- staging table minimal indexes for load
- add indexes after load if needed
- index batch_id + lookup fields
- drop staging indexes after batch if temporary
- partition staging by batch/time for cleanup

Example:

```sql
CREATE INDEX idx_staging_case_batch_norm
ON staging_case_import_rows (import_batch_id, case_number_normalized);
```

Needed for duplicate checks and target joins.

---

## 43. Target Index Cost During Bulk Load

Inserting many rows into heavily indexed table is expensive.

Options:

- keep indexes if OLTP online
- load into staging then set-based insert
- disable/rebuild indexes only in offline/warehouse contexts
- partition load
- use bulk load optimized path
- reduce unnecessary indexes
- load during low traffic

In OLTP production, dropping target indexes for import is usually not acceptable.

---

## 44. WAL/Redo and Replication Lag

Bulk writes generate log volume.

Effects:

- replication lag
- disk pressure
- backup/PITR growth
- slower replicas
- IO saturation

Monitor:

```text
WAL/redo rate
replication lag
disk usage
checkpoint pressure
DB write latency
```

Throttle batch job if lag exceeds threshold.

---

## 45. Locking in Bulk Jobs

Bulk update/delete locks many rows.

Use:

- small batches
- indexed predicates
- deterministic order
- lock timeout
- skip locked for worker claims
- avoid long transaction
- monitor blockers
- schedule low traffic

Bulk job that “just updates old rows” can block user-facing operations.

---

## 46. ORM and Bulk Data

Avoid ORM per-row persistence for large imports.

Bad:

```java
for (CsvRow row : rows) {
    entityManager.persist(map(row));
}
```

If must use ORM:

```java
for (int i = 0; i < rows.size(); i++) {
    entityManager.persist(entity);
    if (i % batchSize == 0) {
        entityManager.flush();
        entityManager.clear();
    }
}
```

But for high volume, prefer:

- JDBC batch
- COPY/load
- staging table
- set-based SQL
- jOOQ batch
- database bulk tools

ORM is not ETL engine.

---

## 47. JDBC Batch Import

```java
try (PreparedStatement ps = conn.prepareStatement("""
    INSERT INTO staging_case_import_rows (
        import_batch_id,
        row_number,
        case_number_raw,
        opened_at_raw,
        status_raw,
        raw_payload
    )
    VALUES (?, ?, ?, ?, ?, ?::jsonb)
""")) {
    int count = 0;

    for (CsvRow row : rows) {
        ps.setObject(1, batchId);
        ps.setInt(2, row.number());
        ps.setString(3, row.caseNumber());
        ps.setString(4, row.openedAtRaw());
        ps.setString(5, row.status());
        ps.setString(6, row.rawJson());

        ps.addBatch();

        if (++count % 1000 == 0) {
            ps.executeBatch();
        }
    }

    ps.executeBatch();
}
```

Caveats:

- JSON binding vendor-specific
- transaction size
- error handling
- batch failure diagnostics
- commit frequency
- file streaming

---

## 48. COPY / Bulk Load

PostgreSQL `COPY`, MySQL `LOAD DATA`, SQL Server bulk copy, Oracle SQL*Loader/external tables.

Benefits:

- much faster than row inserts
- optimized parsing/loading
- lower overhead

Caveats:

- permissions
- file access
- error handling
- CSV quirks
- staging strongly recommended
- security of file location
- transaction/log volume
- cloud managed DB restrictions

Bulk load to staging, then validate/merge.

---

## 49. Temporary Tables

Temporary tables can help per-session processing.

Use cases:

- pass large ID lists
- stage intermediate result
- complex reconciliation
- batch update target from temp set

Caveats:

- session/connection scope
- connection pool interaction
- transaction behavior
- stats may be missing
- indexes needed
- cleanup
- not visible across workers

For multi-step jobs, permanent staging tables are often easier to observe/resume.

---

## 50. Import Observability

Track:

- rows read
- rows loaded
- parse errors
- validation errors
- duplicates
- rows inserted/updated/skipped
- batch duration
- DB latency
- lock waits
- retry count
- replication lag
- memory
- file size
- throughput rows/sec
- current phase
- ETA if useful
- failure reason

Expose status to users/admins.

---

## 51. Export Observability

Track:

- requested_by
- filters
- row count
- bytes written
- duration
- DB query duration
- storage upload duration
- failures
- cancellation
- expiration
- download count
- sensitive data included

Exports are both performance and security events.

---

## 52. Case Study: External Agency Case Import

Requirement:

```text
Import daily case file from external agency.
Must insert new cases, update priority if source newer, reject invalid rows, and reconcile counts.
```

Design:

1. create import batch
2. load CSV into staging
3. normalize fields
4. validate required fields
5. validate officer external IDs
6. detect duplicate source IDs
7. reject invalid rows
8. insert new cases
9. update existing only if source_updated_at newer
10. insert external identity refs
11. store reconciliation results
12. mark batch applied
13. generate reject report
14. audit import

This is robust and explainable.

---

## 53. Case Study: Rebuild Read Model

Read model drift detected.

Approach:

1. create new read model table `case_work_queue_read_model_v2`
2. populate from source with set-based SQL
3. validate row counts and sample
4. create indexes
5. switch app/view to v2
6. keep old table for rollback window
7. drop old later

For huge read model, build per tenant/partition.

Avoid deleting and rebuilding live read model in place if app depends on it.

---

## 54. Case Study: Regulatory Export

Requirement:

```text
Export monthly report with exact submitted data.
```

Design:

- generate report snapshot
- store normalized report rows
- store exact JSON/PDF/CSV artifact hash
- export from snapshot, not live tables
- audit requested_by/generated_by/downloaded_by
- encrypt file at rest
- expire download link
- preserve submitted version
- support amendment report if corrections happen

This links temporal truth + export security.

---

## 55. Case Study: Financial Reconciliation

Source file:

```text
transaction_id, amount, currency
```

Staging:

```sql
staging_transactions
```

Checks:

```text
row count
sum amount by currency
duplicate transaction_id
invalid currency
target missing
target extra
amount mismatch
```

Reconciliation SQL:

```sql
SELECT currency, SUM(amount)
FROM staging_transactions
GROUP BY currency;

SELECT currency, SUM(amount)
FROM target_transactions
WHERE import_batch_id = :batch_id
GROUP BY currency;
```

For money, use exact numeric/integer minor units, not double.

---

## 56. Anti-Patterns

```text
[ ] import directly into target with no staging
[ ] one transaction for 10M rows
[ ] ORM save loop for huge import
[ ] no import batch id
[ ] no raw input preserved
[ ] no reject/error report
[ ] upsert overwrites newer data
[ ] no idempotency key/source id
[ ] no reconciliation
[ ] OFFSET loop for batch processing
[ ] unbounded synchronous export
[ ] export logs sensitive filters/payload
[ ] CSV export vulnerable to formula injection
[ ] bulk delete without batching/retention/legal hold
[ ] no replication lag monitoring during bulk write
[ ] no progress/resume
[ ] no security review for imports/exports
```

---

## 57. Bulk Data Design Checklist

```text
[ ] What is source of data?
[ ] Is there import/export batch id?
[ ] Is operation idempotent?
[ ] Is raw input preserved?
[ ] Is staging used?
[ ] Are validations explicit?
[ ] Are invalid rows reported?
[ ] Is deduplication policy defined?
[ ] Is upsert policy safe?
[ ] Is processing batched/resumable?
[ ] Are transactions bounded?
[ ] Are indexes appropriate for staging/target?
[ ] Is reconciliation defined?
[ ] Is progress observable?
[ ] Are security/PII/export controls handled?
[ ] Is replication/DB load monitored?
[ ] Is rollback/fix-forward plan clear?
```

---

## 58. Practical Exercises

### Exercise 1 — Import Design

Design import for 1M CSV rows containing cases. Include batch table, staging, validation, dedup, apply, reconciliation.

### Exercise 2 — Idempotent External Event

Design inbox table with unique `(tenant_id, source_system, source_event_id)`.

### Exercise 3 — Reconciliation

Use `EXCEPT` to find source IDs missing in target and target IDs missing in source.

### Exercise 4 — Export Safety

Explain why large export should be async and audited.

### Exercise 5 — Bulk Delete

Design safe deletion of audit rows older than retention cutoff using batches and legal hold check.

---

## 59. Koneksi ke Part Berikutnya

Part ini membahas bulk data, ETL, import/export, and reconciliation.

Part berikutnya, `part-029`, akan membahas scaling database structures:

- partitioning
- sharding
- replication
- read replicas
- failover
- consistency trade-offs
- tenant partitioning
- large-table strategies
- distributed SQL patterns

Bulk data sering menjadi alasan pertama kita butuh partitioning, replication, dan architecture scaling.

---

## 60. Ringkasan Bagian Ini

Hal penting dari part 028:

1. Bulk data berbeda dari OLTP CRUD.
2. Import besar sebaiknya memakai batch identity dan staging table.
3. Raw input harus dipertahankan untuk audit/debugging.
4. Validasi harus eksplisit dan menghasilkan error report.
5. Deduplication policy adalah business rule.
6. Upsert bisa berbahaya jika overwrite data baru dengan source lama.
7. Idempotency membutuhkan source IDs, file hash, or command/event keys.
8. Set-based SQL lebih baik daripada per-row repository loop.
9. Large imports harus batched, resumable, and observable.
10. OFFSET buruk untuk batch iteration besar.
11. Reconciliation memastikan source and target match.
12. Export adalah security-sensitive bulk read.
13. Large exports sebaiknya async.
14. CSV export perlu mitigasi formula injection.
15. Warehouse/CDC/outbox adalah tools untuk data movement dengan trade-offs.
16. Bulk delete/archive harus mempertimbangkan locks, WAL, retention, legal hold.
17. ORM bukan ETL engine.
18. COPY/bulk load ke staging sering terbaik untuk volume besar.
19. Import/export metrics penting untuk operations.
20. Data movement yang matang memiliki validation, reconciliation, security, and runbook.

Kalimat inti:

> Bulk data pipeline yang baik tidak hanya cepat; ia bisa menjelaskan apa yang diproses, apa yang ditolak, apa yang berubah, apa yang cocok dengan source, dan bagaimana melanjutkan dengan aman setelah gagal.

---

## 61. Referensi

1. PostgreSQL Documentation — COPY.  
   https://www.postgresql.org/docs/current/sql-copy.html

2. PostgreSQL Documentation — INSERT.  
   https://www.postgresql.org/docs/current/sql-insert.html

3. PostgreSQL Documentation — Set Operations.  
   https://www.postgresql.org/docs/current/queries-union.html

4. PostgreSQL Documentation — Explicit Locking.  
   https://www.postgresql.org/docs/current/explicit-locking.html

5. MySQL Documentation — LOAD DATA.  
   https://dev.mysql.com/doc/refman/8.4/en/load-data.html

6. SQL Server Documentation — Bulk Import and Export.  
   https://learn.microsoft.com/en-us/sql/relational-databases/import-export/bulk-import-and-export-of-data-sql-server

7. Oracle Documentation — SQL*Loader.  
   https://docs.oracle.com/en/database/oracle/oracle-database/23/sutil/oracle-sql-loader.html

8. OWASP — CSV Injection.  
   https://owasp.org/www-community/attacks/CSV_Injection

9. Martin Fowler — Patterns of Enterprise Application Architecture, Batch Processing concepts.  
   https://martinfowler.com/books/eaa.html

---

## 62. Status Seri

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
- `learn-sql-mastery-for-java-engineers-part-011.md`
- `learn-sql-mastery-for-java-engineers-part-012.md`
- `learn-sql-mastery-for-java-engineers-part-013.md`
- `learn-sql-mastery-for-java-engineers-part-014.md`
- `learn-sql-mastery-for-java-engineers-part-015.md`
- `learn-sql-mastery-for-java-engineers-part-016.md`
- `learn-sql-mastery-for-java-engineers-part-017.md`
- `learn-sql-mastery-for-java-engineers-part-018.md`
- `learn-sql-mastery-for-java-engineers-part-019.md`
- `learn-sql-mastery-for-java-engineers-part-020.md`
- `learn-sql-mastery-for-java-engineers-part-021.md`
- `learn-sql-mastery-for-java-engineers-part-022.md`
- `learn-sql-mastery-for-java-engineers-part-023.md`
- `learn-sql-mastery-for-java-engineers-part-024.md`
- `learn-sql-mastery-for-java-engineers-part-025.md`
- `learn-sql-mastery-for-java-engineers-part-026.md`
- `learn-sql-mastery-for-java-engineers-part-027.md`
- `learn-sql-mastery-for-java-engineers-part-028.md`

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-029.md` — Partitioning, Sharding, Replication, and Scaling Patterns
