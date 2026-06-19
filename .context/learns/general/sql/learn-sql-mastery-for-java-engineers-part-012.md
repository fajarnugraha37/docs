# learn-sql-mastery-for-java-engineers-part-012.md

# Part 12 — Constraints as Business Invariants

> Seri: SQL Mastery for Java Engineers  
> Bagian: 012 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-011.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-013.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas DML:

```sql
INSERT
UPDATE
DELETE
UPSERT
MERGE
```

Sekarang kita membahas alasan mengapa write path bisa aman: **constraints**.

Constraint sering dianggap sebagai “validasi database”.

Itu terlalu sempit.

Constraint adalah cara database mengeksekusi invariant bisnis.

Invariant adalah aturan yang harus selalu benar, apa pun jalur perubahan datanya.

Contoh invariant:

```text
Case number harus unik dalam tenant.
Case status harus salah satu nilai valid.
Closed case harus punya closed_at.
Assignment aktif tidak boleh punya ended_at.
Satu case hanya boleh punya satu active primary assignment.
Evidence harus selalu milik case yang ada.
Penalty amount tidak boleh negatif.
Tanggal selesai tidak boleh sebelum tanggal mulai.
External event tidak boleh diproses dua kali.
```

Kalau invariant hanya ada di Java service, invariant bisa dilanggar oleh:

- service lain
- batch job
- migration
- manual SQL
- admin tool
- import script
- old app version
- test fixture
- concurrent requests
- data repair
- ETL process
- ORM bug
- retry duplicate
- integration consumer

Constraint membuat database menjadi penjaga terakhir kebenaran.

Kalimat inti:

> Business rule yang harus selalu benar sebaiknya berada sedekat mungkin dengan data, bukan hanya di layer aplikasi yang kebetulan menulis hari ini.

---

## 1. Constraint sebagai Executable Domain Rule

Aplikasi Java bisa punya validasi:

```java
if (amount.signum() < 0) {
    throw new InvalidAmountException();
}
```

Tetapi database constraint:

```sql
CHECK (amount >= 0)
```

memastikan semua writer tunduk pada rule yang sama.

Aplikasi validation tetap penting untuk:

- user experience
- pesan error yang ramah
- fail fast
- workflow-specific validation
- authorization
- cross-system validation
- rule yang berubah dinamis
- expensive validation

Database constraint penting untuk:

- invariant permanen
- concurrency safety
- integritas referensial
- uniqueness
- non-nullability
- domain range
- state consistency
- idempotency key
- audit defensibility

Gunakan keduanya, tetapi jangan bergantung hanya pada aplikasi untuk invariant inti.

---

## 2. Jenis Constraint Utama

Constraint utama dalam relational database:

```text
NOT NULL
CHECK
UNIQUE
PRIMARY KEY
FOREIGN KEY
EXCLUSION / no-overlap constraints
DEFERRABLE constraints
PARTIAL UNIQUE indexes
```

Selain itu ada constraint-like mechanisms:

```text
generated columns
domain types
enum types
triggers
row-level security
materialized validation queries
application-level validation
```

Bagian ini fokus pada constraint sebagai desain domain.

---

## 3. NOT NULL: Value Wajib Ada

```sql
status TEXT NOT NULL
```

`NOT NULL` adalah constraint paling sederhana tapi sangat penting.

Ia menyatakan:

```text
Setiap row harus punya value untuk kolom ini.
```

### 3.1 NOT NULL sebagai Domain Statement

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_number TEXT NOT NULL,
    status TEXT NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL
);
```

Makna:

- case selalu punya tenant
- case selalu punya nomor
- case selalu punya status
- case selalu punya waktu pembukaan

Jika salah satu boleh null, tanyakan:

```text
Apa arti null?
Unknown?
Not applicable?
Belum ditentukan?
Legacy missing?
Temporary during migration?
```

Jika tidak bisa dijelaskan, jangan nullable.

---

## 4. Nullable Bukan Default Aman

Banyak schema buruk dimulai dari:

```sql
status TEXT NULL
created_at TIMESTAMPTZ NULL
amount NUMERIC NULL
```

“Biar fleksibel” sering berarti:

```text
Biar data invalid masuk dulu.
```

Nullable menambah kompleksitas:

- query harus handle `IS NULL`
- aggregate bisa mengabaikan value
- index selectivity berubah
- application mapping perlu wrapper
- business meaning ambigu
- report perlu interpretasi
- three-valued logic muncul

Rule praktis:

> Kolom harus `NOT NULL` kecuali ada alasan domain yang jelas untuk null.

---

## 5. CHECK Constraint

`CHECK` memastikan ekspresi bernilai true untuk setiap row.

Contoh:

```sql
CHECK (amount >= 0)
```

```sql
CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED', 'CANCELLED'))
```

```sql
CHECK (closed_at IS NULL OR closed_at >= opened_at)
```

### 5.1 CHECK untuk Domain Range

```sql
risk_score NUMERIC(5, 2),
CHECK (risk_score IS NULL OR (risk_score >= 0 AND risk_score <= 100))
```

Jika `risk_score` nullable karena belum calculated, constraint mengizinkan null tapi membatasi value non-null.

### 5.2 CHECK untuk Enum-like Values

```sql
status TEXT NOT NULL,
CONSTRAINT ck_cases_status_valid
CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED', 'CANCELLED'))
```

Ini lebih kuat daripada Java enum saja.

### 5.3 CHECK untuk Relationship antar Kolom

```sql
CONSTRAINT ck_cases_time_order
CHECK (closed_at IS NULL OR closed_at >= opened_at)
```

Makna:

```text
Jika closed_at ada, tidak boleh sebelum opened_at.
```

### 5.4 CHECK dengan NULL

CHECK constraint dianggap lolos jika expression bernilai `TRUE` atau `UNKNOWN` di banyak database.

Contoh:

```sql
CHECK (amount >= 0)
```

Jika `amount NULL`, expression `amount >= 0` adalah `UNKNOWN`, sehingga constraint bisa lolos.

Jika amount wajib ada dan non-negative:

```sql
amount NUMERIC(19, 2) NOT NULL,
CHECK (amount >= 0)
```

Jangan lupa `NOT NULL`.

---

## 6. CHECK Constraint dan Status Lifecycle

Naive:

```sql
status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
closed_at TIMESTAMPTZ
```

Ini masih mengizinkan:

```text
status = CLOSED, closed_at = NULL
status = OPEN, closed_at = 2026-01-01
```

Tambahkan consistency rule:

```sql
CONSTRAINT ck_cases_closed_at_consistent
CHECK (
    (status = 'CLOSED' AND closed_at IS NOT NULL)
    OR
    (status <> 'CLOSED' AND closed_at IS NULL)
)
```

Namun perhatikan domain:

- Apakah `CANCELLED` juga terminal dan butuh `closed_at`?
- Apakah `closed_at` berarti terminal_at?
- Apakah perlu `terminal_at` daripada `closed_at`?
- Apakah closed_at boleh ada untuk migrated legacy row?

Constraint memaksa kamu memperjelas domain language.

---

## 7. CHECK Constraint Bukan Pengganti State Machine Lengkap

Constraint bisa membatasi valid state saat ini, tetapi sulit memvalidasi transition history.

Contoh valid current states:

```sql
CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED'))
```

Tapi rule transition:

```text
OPEN -> UNDER_REVIEW allowed
UNDER_REVIEW -> ESCALATED allowed
ESCALATED -> CLOSED allowed
CLOSED -> OPEN not allowed except reopen workflow
```

Ini tidak mudah dijaga dengan simple CHECK karena CHECK melihat satu row saat ini, bukan previous state.

Options:

- application service transition rules
- stored procedure/function
- trigger
- transition table with constraints
- event sourcing/state machine
- row locking + guarded update
- reference table of allowed transitions

Example allowed transitions table:

```sql
CREATE TABLE allowed_case_status_transitions (
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    PRIMARY KEY (from_status, to_status)
);
```

Transition insert can FK to allowed transitions if modeled carefully.

---

## 8. UNIQUE Constraint

`UNIQUE` memastikan tidak ada dua row dengan value sama pada column/set column tertentu.

```sql
CONSTRAINT uq_cases_tenant_case_number
UNIQUE (tenant_id, case_number_normalized)
```

Makna:

```text
Dalam satu tenant, case_number_normalized tidak boleh duplicate.
```

Ini business invariant.

### 8.1 Unique is Concurrency Control

Aplikasi check:

```sql
SELECT 1
FROM cases
WHERE tenant_id = :tenant_id
  AND case_number_normalized = :case_number;
```

lalu insert jika tidak ada.

Concurrent requests bisa race.

Unique constraint menyelesaikan:

```sql
UNIQUE (tenant_id, case_number_normalized)
```

Jika dua transaksi insert case number sama, hanya satu yang berhasil.

Inilah alasan invariant uniqueness harus ada di database.

---

## 9. Unique Constraint vs Unique Index

Banyak database mengimplementasikan unique constraint dengan unique index.

Secara desain:

- unique constraint menyatakan rule relational/business
- unique index adalah struktur fisik enforcing uniqueness
- beberapa vendor mendukung unique index dengan fitur lebih seperti partial/expression

Contoh PostgreSQL partial unique index:

```sql
CREATE UNIQUE INDEX uq_case_assignments_one_active_primary
ON case_assignments (case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

Ini bukan standard `UNIQUE CONSTRAINT` biasa, tapi sangat berguna untuk invariant conditional.

---

## 10. Unique dan NULL

Nullable unique column bisa mengizinkan banyak NULL di banyak database.

```sql
email TEXT UNIQUE
```

Bisa berarti:

```text
banyak row dengan email NULL diizinkan
```

Jika email wajib unik dan wajib ada:

```sql
email_normalized TEXT NOT NULL UNIQUE
```

Jika email optional tapi kalau ada harus unik:

```sql
email_normalized TEXT UNIQUE
```

Ini mungkin benar.

Jika ingin hanya satu NULL, vendor-specific solution diperlukan.

Selalu jelaskan semantics NULL.

---

## 11. Composite UNIQUE

Composite unique menjaga kombinasi.

```sql
UNIQUE (tenant_id, case_number_normalized)
```

Bukan:

```sql
UNIQUE (case_number_normalized)
```

jika case number hanya unik per tenant.

Composite unique umum untuk:

- tenant-scoped business key
- jurisdiction-scoped reference number
- external source identity
- many-to-many relationship uniqueness
- versioned records
- effective dated data

Example external ref:

```sql
PRIMARY KEY (tenant_id, source_system, source_case_id)
```

---

## 12. PRIMARY KEY

Primary key adalah identifier utama row.

```sql
id UUID PRIMARY KEY
```

Properties:

- unique
- not null
- referenced by foreign keys
- stable identity
- often clustered/physically significant depending vendor
- central to joins

### 12.1 Surrogate vs Natural Primary Key

Surrogate:

```sql
id UUID PRIMARY KEY
```

Natural/business key:

```sql
PRIMARY KEY (tenant_id, case_number_normalized)
```

Hybrid common:

```sql
id UUID PRIMARY KEY,
UNIQUE (tenant_id, case_number_normalized)
```

This gives:

- stable technical joins via id
- business uniqueness via unique constraint

For many systems, this hybrid is best.

---

## 13. Primary Key Should Be Stable

Do not use value as PK if it can change.

Bad:

```sql
case_number TEXT PRIMARY KEY
```

if case number can be corrected.

Better:

```sql
id UUID PRIMARY KEY,
case_number TEXT NOT NULL,
UNIQUE (tenant_id, case_number_normalized)
```

Business key can change through controlled process; technical identity remains stable.

---

## 14. FOREIGN KEY

Foreign key ensures child references existing parent.

```sql
case_id UUID NOT NULL REFERENCES cases(id)
```

Makna:

```text
Every case_note must belong to an existing case.
```

### 14.1 FK Is Not a Join

FK is constraint. Join is query operation.

FK says:

```text
if case_notes.case_id is non-null, it must exist in cases.id
```

Join says:

```sql
JOIN cases c ON c.id = n.case_id
```

You can join without FK, and FK can exist without a query joining.

But FK makes joins semantically trustworthy.

---

## 15. Foreign Key and Orphan Prevention

Without FK:

```sql
INSERT INTO case_notes (case_id, ...)
VALUES ('non-existent-case', ...);
```

Database accepts orphan.

With FK, database rejects.

Orphan rows cause:

- broken reports
- failed joins
- inconsistent UI
- impossible audit
- cleanup burden
- data trust erosion

Use FK unless there is a strong operational reason not to, and document that reason.

---

## 16. Foreign Key Actions

On parent delete/update, FK can specify action.

Common:

```text
ON DELETE RESTRICT / NO ACTION
ON DELETE CASCADE
ON DELETE SET NULL
ON DELETE SET DEFAULT
```

### 16.1 RESTRICT / NO ACTION

Prevents deleting parent if child exists.

Good for core business data.

### 16.2 CASCADE

Deletes children automatically.

Good for dependent technical rows, dangerous for audit records.

Example acceptable:

```text
temporary import batch -> staging rows
```

Example dangerous:

```text
case -> evidence -> audit trail
```

### 16.3 SET NULL

Sets child FK to NULL.

Only valid if child can exist without parent.

Be careful: can create semantically incomplete row.

---

## 17. Composite Foreign Key

For multi-tenant consistency:

```sql
CREATE TABLE cases (
    tenant_id UUID NOT NULL,
    id UUID NOT NULL,
    PRIMARY KEY (tenant_id, id)
);

CREATE TABLE case_notes (
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    FOREIGN KEY (tenant_id, case_id)
        REFERENCES cases (tenant_id, id)
);
```

This prevents note in tenant A referencing case in tenant B.

If using globally unique UUIDs, cross-tenant issue is less likely but composite FK can still encode domain boundary strongly.

---

## 18. Many-to-Many Constraints

Join table:

```sql
CREATE TABLE case_parties (
    case_id UUID NOT NULL REFERENCES cases(id),
    party_id UUID NOT NULL REFERENCES parties(id),
    role TEXT NOT NULL,

    PRIMARY KEY (case_id, party_id, role)
);
```

This prevents duplicate relationship.

If party can have only one role per case:

```sql
PRIMARY KEY (case_id, party_id)
```

The key encodes business rule.

Ask:

```text
Can same party appear twice in same case?
Can same party have multiple roles?
Are roles time-bound?
Is role history needed?
```

Constraint depends on domain.

---

## 19. Conditional Uniqueness with Partial Unique Index

Requirement:

> A case can have many assignments over time, but at most one active primary assignment.

Table:

```sql
CREATE TABLE case_assignments (
    id UUID PRIMARY KEY,
    case_id UUID NOT NULL REFERENCES cases(id),
    officer_id UUID NOT NULL REFERENCES officers(id),
    assignment_role TEXT NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,

    CHECK (assignment_role IN ('PRIMARY', 'SUPPORTING')),
    CHECK (ended_at IS NULL OR ended_at > assigned_at)
);
```

Invariant:

```text
Only one active primary assignment per case.
```

PostgreSQL-style:

```sql
CREATE UNIQUE INDEX uq_case_assignments_one_active_primary
ON case_assignments (case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

This is powerful.

Application check alone is race-prone.

---

## 20. Conditional Uniqueness Without Partial Index

Not all databases support partial unique index.

Alternatives:

- filtered index in SQL Server
- function-based/generated column unique
- trigger
- separate current assignment table
- materialized current state
- application lock, less ideal
- serializable transaction, with care

Alternative design:

```sql
CREATE TABLE case_current_primary_assignments (
    case_id UUID PRIMARY KEY REFERENCES cases(id),
    officer_id UUID NOT NULL REFERENCES officers(id),
    assigned_at TIMESTAMPTZ NOT NULL
);
```

History table separately:

```sql
CREATE TABLE case_assignment_history (...);
```

Now one current primary per case is enforced by primary key.

This is often portable and clear.

---

## 21. Exclusion Constraints / No Overlap

Some invariants are about ranges.

Requirement:

> One officer cannot have overlapping active duty intervals.

PostgreSQL supports exclusion constraints with range types.

Conceptual:

```sql
EXCLUDE USING gist (
    officer_id WITH =,
    duty_period WITH &&
)
```

Meaning:

```text
For same officer, duty_period ranges must not overlap.
```

This is vendor-specific but extremely powerful.

Without exclusion constraint, alternatives:

- trigger to check overlap
- serializable transaction
- application-level lock
- range table with careful locking
- redesigned schedule model

Range invariants are hard under concurrency; database-level support is valuable.

---

## 22. Deferrable Constraints

Normally constraints are checked immediately.

Deferrable constraints can be checked at transaction commit.

Use cases:

- circular references
- batch reordering
- complex graph insert
- temporary intermediate invalid state within transaction

Example concept:

```sql
FOREIGN KEY (...) REFERENCES ...
DEFERRABLE INITIALLY DEFERRED
```

Then within transaction:

```sql
BEGIN;
-- insert rows that temporarily reference each other
COMMIT; -- check constraints here
```

Do not overuse. Immediate constraints are easier to reason about.

---

## 23. Constraint Naming

Bad:

```sql
CHECK (status IN (...))
```

Database may generate name like:

```text
cases_status_check
```

Better:

```sql
CONSTRAINT ck_cases_status_valid
CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED', 'CANCELLED'))
```

Good names:

```text
pk_cases
uq_cases_tenant_case_number
fk_case_notes_case
ck_cases_status_valid
ck_cases_closed_at_consistent
uq_case_assignments_one_active_primary
```

Why names matter:

- error mapping
- debugging
- migration diff
- monitoring
- logs
- documentation
- support diagnosis

Java exception mapper can inspect constraint name.

---

## 24. Constraint Violation Handling in Java

Database error:

```text
violates unique constraint "uq_cases_tenant_case_number"
```

Application maps to:

```text
Case number already exists.
```

Example conceptual mapper:

```java
if (constraintName.equals("uq_cases_tenant_case_number")) {
    throw new DuplicateCaseNumberException(...);
}
```

Do not expose raw SQL error to user.

But preserve details in logs/observability.

Common mappings:

| Constraint | Domain Error |
|---|---|
| `uq_cases_tenant_case_number` | duplicate case number |
| `fk_case_notes_case` | case not found |
| `ck_cases_status_valid` | invalid status |
| `ck_cases_time_order` | closed_at before opened_at |
| `uq_case_assignments_one_active_primary` | case already has active primary officer |
| `nn_cases_opened_at` or not-null | required field missing |

Frameworks like Spring wrap database exceptions, but vendor-specific extraction may be needed.

---

## 25. Constraint as Documentation

A schema with constraints documents domain better than comments alone.

Weak schema:

```sql
CREATE TABLE cases (
    id TEXT,
    status TEXT,
    opened_at TEXT,
    closed_at TEXT
);
```

Strong schema:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_number TEXT NOT NULL,
    case_number_normalized TEXT NOT NULL,
    status TEXT NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,

    CONSTRAINT uq_cases_tenant_case_number
    UNIQUE (tenant_id, case_number_normalized),

    CONSTRAINT ck_cases_status_valid
    CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED', 'CANCELLED')),

    CONSTRAINT ck_cases_time_order
    CHECK (closed_at IS NULL OR closed_at >= opened_at)
);
```

Reviewers can infer domain rules from schema.

---

## 26. Constraint and Query Simplification

If database guarantees:

```sql
status TEXT NOT NULL
CHECK (status IN ('OPEN', 'CLOSED'))
```

Then query can avoid defensive nonsense:

```sql
WHERE status IS NOT NULL
  AND status IN ('OPEN', 'CLOSED')
```

Constraints let humans and optimizer reason better.

If FK guarantees every note has case, certain joins are semantically reliable.

If unique guarantees one active assignment, DTO mapping can expect one row.

Constraint improves both correctness and query clarity.

---

## 27. Constraint and Optimizer

Database optimizers may use constraints for planning.

Examples:

- primary key uniqueness
- foreign key relationships
- not-null
- check constraints for partition pruning
- uniqueness for join cardinality
- exclusion/partial indexes for access paths

But do not rely too much without checking vendor behavior.

Still, constraints give optimizer more truthful metadata.

---

## 28. Constraint Validation on Existing Data

Adding constraint to existing table may fail if data violates it.

Example:

```sql
ALTER TABLE cases
ADD CONSTRAINT ck_cases_status_valid
CHECK (status IN ('OPEN', 'CLOSED'));
```

If existing row has `status = 'OPNE'`, migration fails.

Process:

1. detect invalid data
2. clean/fix data
3. add constraint
4. validate constraint

PostgreSQL supports `NOT VALID` then `VALIDATE CONSTRAINT` for some constraints.

Concept:

```sql
ALTER TABLE cases
ADD CONSTRAINT ck_cases_status_valid
CHECK (status IN (...)) NOT VALID;

ALTER TABLE cases
VALIDATE CONSTRAINT ck_cases_status_valid;
```

This can reduce locking impact in some cases.

Vendor behavior differs.

---

## 29. Backfilling NOT NULL Safely

Want to make column not null:

```sql
ALTER TABLE cases
ALTER COLUMN priority SET NOT NULL;
```

If existing nulls, fails.

Safe-ish sequence:

1. add column nullable
2. backfill in batches
3. add default if needed
4. validate no nulls
5. set not null

Example:

```sql
ALTER TABLE cases ADD COLUMN priority TEXT;

UPDATE cases
SET priority = 'NORMAL'
WHERE priority IS NULL;

ALTER TABLE cases
ALTER COLUMN priority SET DEFAULT 'NORMAL';

ALTER TABLE cases
ALTER COLUMN priority SET NOT NULL;
```

For large tables, backfill batch and monitor.

---

## 30. Adding UNIQUE Safely

Before adding unique:

```sql
SELECT
    tenant_id,
    case_number_normalized,
    COUNT(*) AS duplicate_count
FROM cases
GROUP BY tenant_id, case_number_normalized
HAVING COUNT(*) > 1;
```

If duplicates exist, decide:

- merge
- reject
- mark inactive
- create exception
- choose canonical
- fix source

Then add unique constraint/index.

For large tables, use online/concurrent index build if vendor supports.

PostgreSQL:

```sql
CREATE UNIQUE INDEX CONCURRENTLY uq_cases_tenant_case_number_idx
ON cases (tenant_id, case_number_normalized);
```

Then attach as constraint if desired, depending vendor.

---

## 31. Constraint and Migrations

Constraints are schema changes with operational impact.

Adding FK can:

- scan child table
- lock tables
- fail on invalid data
- slow writes
- require index on child
- expose orphan data
- affect delete/update behavior

Adding unique can:

- scan/sort table
- fail on duplicates
- lock writes if not online
- require storage

Adding check can:

- validate existing rows
- fail on bad data
- lock/scan depending vendor

Migration plan must include:

```text
data audit
cleanup
backfill
constraint creation
validation
rollback/fix-forward
monitoring
application compatibility
```

---

## 32. Constraint vs Trigger

Constraints are preferred when rule can be expressed declaratively.

Use constraint for:

- not null
- uniqueness
- referential integrity
- simple row-level check
- conditional uniqueness if supported
- no-overlap if exclusion supported

Use trigger when:

- rule depends on complex cross-table logic
- need audit side effects
- need derived table maintenance
- vendor lacks declarative constraint
- temporal overlap check unsupported

Trigger downsides:

- hidden behavior
- harder to reason about
- can affect performance
- recursion/ordering issues
- harder migration/testing
- vendor-specific
- ORM unaware

Prefer declarative constraint first.

---

## 33. Constraint vs Application Validation

Application validation:

```text
good UX, workflow-specific, early error
```

Database constraint:

```text
final authority, concurrency-safe, all writers covered
```

Do both.

Example:

Java validates status enum before insert.

Database still has:

```sql
CHECK (status IN (...))
```

Java checks duplicate case number for friendly UI.

Database still has:

```sql
UNIQUE (tenant_id, case_number_normalized)
```

Java checks active assignment before assigning.

Database still has:

```sql
UNIQUE WHERE active primary
```

Application validation without DB constraint is advisory, not authoritative.

---

## 34. Constraint and Authorization

Constraints do not replace authorization.

Constraint:

```text
case belongs to tenant
```

Authorization:

```text
this user may access this tenant/case
```

Do not expect FK/unique/check to enforce user permissions.

Authorization can be enforced by:

- application service
- row-level security
- views
- stored procedures
- database roles

Constraint ensures data shape/invariants, not actor permission.

---

## 35. Constraint and Soft Delete

Soft delete complicates uniqueness.

Requirement:

> Active case numbers unique, but deleted cases may keep old number.

Schema:

```sql
deleted_at TIMESTAMPTZ
```

PostgreSQL partial unique:

```sql
CREATE UNIQUE INDEX uq_cases_active_case_number
ON cases (tenant_id, case_number_normalized)
WHERE deleted_at IS NULL;
```

If database lacks partial unique, options:

- include deleted marker in unique key, but semantics tricky
- generated column active_case_number
- separate archive table
- hard purge before reuse
- application logic plus locks, less ideal

Soft delete is not free.

---

## 36. Constraint and Multi-Tenancy

Always decide tenant scope of keys.

Bad:

```sql
UNIQUE (case_number_normalized)
```

if case number only unique per tenant.

Good:

```sql
UNIQUE (tenant_id, case_number_normalized)
```

FK should also protect tenant consistency when needed.

Bad:

```sql
case_id REFERENCES cases(id)
```

if ids can collide or tenant boundary must be encoded.

Better:

```sql
FOREIGN KEY (tenant_id, case_id)
REFERENCES cases (tenant_id, id)
```

Multi-tenancy is a data invariant, not just service filter.

---

## 37. Constraint and Idempotency

Idempotency often uses unique constraint.

```sql
CREATE TABLE processed_events (
    tenant_id UUID NOT NULL,
    event_id UUID NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL,

    PRIMARY KEY (tenant_id, event_id)
);
```

Process event:

```sql
INSERT INTO processed_events (
    tenant_id,
    event_id,
    processed_at
)
VALUES (
    :tenant_id,
    :event_id,
    now()
)
ON CONFLICT (tenant_id, event_id)
DO NOTHING;
```

If insert succeeds, process.

If conflict, skip/replay result.

The unique constraint is the concurrency-safe idempotency gate.

---

## 38. Constraint and Case-Insensitive Uniqueness

Requirement:

> Email unique case-insensitively.

Option 1: normalized column.

```sql
email_original TEXT NOT NULL,
email_normalized TEXT NOT NULL UNIQUE,
CHECK (email_normalized = lower(email_normalized))
```

Application sets normalized.

Option 2: expression unique index.

```sql
CREATE UNIQUE INDEX uq_users_lower_email
ON users (lower(email));
```

Vendor-specific.

Option 3: case-insensitive collation/type.

Vendor-specific.

Normalized column is portable and explicit.

---

## 39. Constraint and Derived Values

If a derived value must be consistent, consider generated column.

Example:

```sql
case_number_normalized TEXT GENERATED ALWAYS AS (...) STORED
```

Vendor-specific syntax.

Benefit:

- avoids app forgetting to set normalized value
- can index generated value
- keeps derivation central

Alternative:

- application computes
- trigger computes
- expression index

Choose based on vendor support and operational simplicity.

---

## 40. Constraint and Temporal Validity

Requirement:

> Assignment ended_at must be after assigned_at.

```sql
CHECK (ended_at IS NULL OR ended_at > assigned_at)
```

Requirement:

> No overlapping active assignment intervals for same case/role.

Simple CHECK cannot compare multiple rows.

Options:

- exclusion constraint
- trigger
- current assignment table
- transaction with lock
- temporal model redesign

Know which invariants are row-local vs cross-row.

---

## 41. Row-Local vs Cross-Row Invariants

Row-local invariant:

```text
closed_at >= opened_at
amount >= 0
status in valid set
```

Can use CHECK.

Cross-row invariant:

```text
case number unique per tenant
one active assignment per case
no overlapping validity ranges
foreign key parent exists
```

Need:

- UNIQUE
- FOREIGN KEY
- EXCLUSION
- partial unique
- trigger
- transaction isolation/locking

Cross-row invariants are where application-only validation fails most under concurrency.

---

## 42. Constraint Design Checklist

For each table:

```text
[ ] What is the primary key?
[ ] What are business keys?
[ ] Which columns are required?
[ ] Which values have finite domain?
[ ] Which numeric/date ranges are valid?
[ ] Which columns depend on each other?
[ ] Which relationships are mandatory?
[ ] Which relationships are optional?
[ ] What should happen on parent delete?
[ ] Which uniqueness rules are tenant-scoped?
[ ] Which uniqueness rules are conditional?
[ ] Are there temporal no-overlap rules?
[ ] Are soft-deleted rows included in uniqueness?
[ ] Are constraint names explicit?
[ ] Can Java map constraint violations to domain errors?
```

---

## 43. Constraint Review Checklist for Pull Requests

```text
[ ] Are NOT NULL constraints used for required fields?
[ ] Are CHECK constraints used for local domain rules?
[ ] Are UNIQUE constraints used for business identity?
[ ] Are FKs present for references?
[ ] Are FK delete actions intentional?
[ ] Are tenant boundaries encoded?
[ ] Are nullable columns justified?
[ ] Is there any application-only invariant that should be DB constraint?
[ ] Are indexes needed for FK columns?
[ ] Are constraints named clearly?
[ ] Does migration handle existing invalid data?
[ ] Does migration avoid long locks where possible?
[ ] Are tests covering constraint violations?
```

---

## 44. Constraint Testing

Test constraints explicitly.

Example integration tests:

```text
cannot insert duplicate case number in same tenant
can insert same case number in different tenant
cannot insert invalid status
cannot close case with closed_at before opened_at
cannot insert note for missing case
cannot insert second active primary assignment
can insert historical primary assignment after ended_at set
```

Do not only test happy path.

Constraint tests protect future refactors and migrations.

---

## 45. Mini Case Study: Case Table

Strong schema:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    jurisdiction_code TEXT NOT NULL,
    case_number TEXT NOT NULL,
    case_number_normalized TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT uq_cases_tenant_case_number
    UNIQUE (tenant_id, case_number_normalized),

    CONSTRAINT ck_cases_status_valid
    CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED', 'CANCELLED')),

    CONSTRAINT ck_cases_priority_valid
    CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),

    CONSTRAINT ck_cases_time_order
    CHECK (closed_at IS NULL OR closed_at >= opened_at),

    CONSTRAINT ck_cases_closed_at_consistent
    CHECK (
        (status = 'CLOSED' AND closed_at IS NOT NULL)
        OR
        (status <> 'CLOSED' AND closed_at IS NULL)
    ),

    CONSTRAINT ck_cases_version_non_negative
    CHECK (version >= 0)
);
```

Review:

- technical identity via id
- tenant-scoped business key
- valid status/priority
- time order
- closed consistency
- optimistic lock version safe

Question:

- Is cancelled terminal?
- Should cancelled_at be separate?
- Is closed_at name too specific?
- Should status be reference table?
- Should jurisdiction_code FK?

Constraints reveal domain questions.

---

## 46. Mini Case Study: Assignment Table

```sql
CREATE TABLE case_assignments (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    officer_id UUID NOT NULL,
    assignment_role TEXT NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,

    CONSTRAINT fk_case_assignments_case
    FOREIGN KEY (tenant_id, case_id)
    REFERENCES cases (tenant_id, id),

    CONSTRAINT fk_case_assignments_officer
    FOREIGN KEY (tenant_id, officer_id)
    REFERENCES officers (tenant_id, id),

    CONSTRAINT ck_case_assignments_role_valid
    CHECK (assignment_role IN ('PRIMARY', 'SUPPORTING')),

    CONSTRAINT ck_case_assignments_time_order
    CHECK (ended_at IS NULL OR ended_at > assigned_at)
);
```

Conditional uniqueness:

```sql
CREATE UNIQUE INDEX uq_case_assignments_one_active_primary
ON case_assignments (tenant_id, case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

This encodes:

```text
At most one active primary assignment per tenant-case.
```

---

## 47. Mini Case Study: External Reference Idempotency

```sql
CREATE TABLE case_external_refs (
    tenant_id UUID NOT NULL,
    source_system TEXT NOT NULL,
    source_case_id TEXT NOT NULL,
    case_id UUID NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,

    CONSTRAINT pk_case_external_refs
    PRIMARY KEY (tenant_id, source_system, source_case_id),

    CONSTRAINT fk_case_external_refs_case
    FOREIGN KEY (tenant_id, case_id)
    REFERENCES cases (tenant_id, id),

    CONSTRAINT ck_case_external_refs_time_order
    CHECK (last_seen_at >= first_seen_at),

    CONSTRAINT ck_case_external_refs_source_system_not_blank
    CHECK (length(trim(source_system)) > 0),

    CONSTRAINT ck_case_external_refs_source_case_id_not_blank
    CHECK (length(trim(source_case_id)) > 0)
);
```

The primary key is idempotency key.

It prevents duplicate external mappings.

---

## 48. Mini Case Study: Soft Delete Notes

```sql
CREATE TABLE case_notes (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    note_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    created_by UUID NOT NULL,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID,

    CONSTRAINT fk_case_notes_case
    FOREIGN KEY (tenant_id, case_id)
    REFERENCES cases (tenant_id, id),

    CONSTRAINT ck_case_notes_text_not_blank
    CHECK (length(trim(note_text)) > 0),

    CONSTRAINT ck_case_notes_delete_consistent
    CHECK (
        (deleted_at IS NULL AND deleted_by IS NULL)
        OR
        (deleted_at IS NOT NULL AND deleted_by IS NOT NULL)
    ),

    CONSTRAINT ck_case_notes_delete_after_create
    CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);
```

Constraint ensures delete metadata consistency.

---

## 49. Practical Exercises

### Exercise 1 — Add Business Key

Requirement:

> Case number unique per tenant.

```sql
ALTER TABLE cases
ADD CONSTRAINT uq_cases_tenant_case_number
UNIQUE (tenant_id, case_number_normalized);
```

Before adding:

```sql
SELECT
    tenant_id,
    case_number_normalized,
    COUNT(*)
FROM cases
GROUP BY tenant_id, case_number_normalized
HAVING COUNT(*) > 1;
```

### Exercise 2 — Prevent Invalid Status

```sql
ALTER TABLE cases
ADD CONSTRAINT ck_cases_status_valid
CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED', 'CANCELLED'));
```

### Exercise 3 — One Active Primary Assignment

```sql
CREATE UNIQUE INDEX uq_case_assignments_one_active_primary
ON case_assignments (case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

### Exercise 4 — Note Delete Metadata

```sql
CHECK (
    (deleted_at IS NULL AND deleted_by IS NULL)
    OR
    (deleted_at IS NOT NULL AND deleted_by IS NOT NULL)
)
```

### Exercise 5 — Composite FK

```sql
FOREIGN KEY (tenant_id, case_id)
REFERENCES cases (tenant_id, id)
```

Explain why this is stronger than only `case_id REFERENCES cases(id)` in tenant-sensitive designs.

---

## 50. Koneksi ke Part Berikutnya

Part ini membahas constraints sebagai invariant.

Part berikutnya, `part-013`, akan membahas schema design dan normalization:

- entity vs attribute
- functional dependency
- normal forms
- denormalization
- reference tables
- history tables
- current state vs event history
- relationship modelling
- schema evolution trade-offs

Constraints adalah alat untuk menjaga invariant. Normalization adalah cara menyusun relation agar invariant natural dan data tidak redundan secara berbahaya.

---

## 51. Ringkasan Bagian Ini

Hal penting dari part 012:

1. Constraint adalah executable business invariant.
2. Application validation penting, tetapi tidak cukup untuk invariant inti.
3. `NOT NULL` menyatakan value wajib ada.
4. Nullable column harus punya makna domain eksplisit.
5. `CHECK` menjaga row-local domain rules.
6. `CHECK` dengan NULL membutuhkan pemahaman three-valued logic.
7. `UNIQUE` menjaga business identity dan concurrency safety.
8. Composite unique penting untuk tenant-scoped keys.
9. Primary key harus stable.
10. Foreign key mencegah orphan data.
11. FK actions adalah business policy, bukan convenience.
12. Composite FK bisa menjaga tenant consistency.
13. Partial unique index menjaga conditional uniqueness seperti one active primary assignment.
14. Exclusion/no-overlap constraint berguna untuk temporal invariants jika vendor mendukung.
15. Deferrable constraints berguna untuk kasus tertentu, tapi jangan overuse.
16. Constraint names penting untuk debugging dan Java exception mapping.
17. Constraint migration perlu audit existing data.
18. Soft delete memperumit uniqueness.
19. Idempotency sering ditegakkan dengan unique key.
20. Cross-row invariants harus dijaga database bila memungkinkan.
21. Constraint tests harus eksplisit.

Kalimat inti:

> Jika sebuah aturan harus selalu benar untuk data, jadikan ia constraint database bila memungkinkan; validasi aplikasi adalah lapisan pertama, constraint adalah garis pertahanan terakhir.

---

## 52. Referensi

1. PostgreSQL Documentation — Constraints.  
   https://www.postgresql.org/docs/current/ddl-constraints.html

2. PostgreSQL Documentation — Indexes, Unique Indexes, Partial Indexes.  
   https://www.postgresql.org/docs/current/indexes-unique.html  
   https://www.postgresql.org/docs/current/indexes-partial.html

3. PostgreSQL Documentation — Exclusion Constraints.  
   https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-EXCLUSION

4. PostgreSQL Documentation — ALTER TABLE.  
   https://www.postgresql.org/docs/current/sql-altertable.html

5. MySQL 8.4 Reference Manual — CREATE TABLE and Constraints.  
   https://dev.mysql.com/doc/refman/8.4/en/create-table.html

6. SQL Server Documentation — Unique Constraints and Check Constraints.  
   https://learn.microsoft.com/en-us/sql/relational-databases/tables/unique-constraints-and-check-constraints

7. Oracle Database SQL Language Reference — Constraints.  
   https://docs.oracle.com/en/database/oracle/oracle-database/23/sqlrf/constraint.html

8. Spring Framework Documentation — DataAccessException hierarchy.  
   https://docs.spring.io/spring-framework/reference/data-access/dao.html

---

## 53. Status Seri

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

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-013.md` — Schema Design and Normalization

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-011.md">⬅️ Part 11 — Data Modification: INSERT, UPDATE, DELETE, UPSERT, MERGE</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-013.md">Part 13 — Schema Design and Normalization ➡️</a>
</div>
