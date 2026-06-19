# learn-sql-mastery-for-java-engineers-part-023.md

# Part 23 — Temporal Data, Auditability, and Historical Truth

> Seri: SQL Mastery for Java Engineers  
> Bagian: 023 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-022.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-024.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas views, materialized views, dan read models.

Sekarang kita membahas salah satu topik paling penting untuk sistem enterprise dan regulated systems: **temporal data** dan **historical truth**.

Banyak bug serius terjadi karena sistem hanya menyimpan “nilai sekarang”.

Contoh:

```sql
cases(status, assigned_officer_id, risk_score, due_at)
```

Ini menjawab:

```text
Apa kondisi sekarang?
```

Tetapi tidak menjawab:

```text
Kapan status berubah?
Siapa yang mengubah?
Apa status sebelumnya?
Apa alasan perubahan?
Apa nilai due_at saat decision dibuat?
Rule version apa yang dipakai?
Kapan data sebenarnya terjadi?
Kapan sistem menerima data?
Kapan sistem mencatat data?
Apakah data pernah dikoreksi?
Apa yang diketahui sistem pada tanggal tertentu?
Apa yang benar secara domain pada tanggal tertentu?
Apa yang pernah dilaporkan ke regulator?
```

Dalam sistem biasa, pertanyaan ini penting untuk debugging.

Dalam sistem regulated, pertanyaan ini bisa menentukan audit, compliance, legal liability, dan kepercayaan data.

Bagian ini membahas:

- temporal thinking
- event time vs recorded time
- valid time vs transaction time
- current state vs history
- audit trail
- bitemporal modelling
- effective-dated records
- corrections and amendments
- snapshotting
- temporal constraints
- historical reporting
- Java implications
- design checklist

Kalimat inti:

> Data historis yang baik tidak hanya menyimpan “apa nilai lama”; ia menyimpan kapan fakta itu berlaku, kapan sistem mengetahuinya, siapa/apa yang mengubahnya, dan bagaimana koreksi dilakukan tanpa menghancurkan jejak kebenaran.

---

## 1. Temporal Data: Mengapa Sulit?

Waktu terlihat sederhana:

```sql
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Tapi realitas domain punya banyak jenis waktu:

```text
case opened time
event occurred time
external system reported time
system received time
database recorded time
decision issued time
decision effective time
SLA start time
SLA due time
assignment valid from/to
correction requested time
correction applied time
report generated time
report submitted time
```

Jika semuanya disebut `created_at`, kamu kehilangan makna.

Temporal modelling dimulai dari memberi nama waktu dengan benar.

---

## 2. Empat Jenis Waktu Penting

### 2.1 Event Time

Kapan event terjadi di dunia/domain.

```text
Evidence received by officer at 2026-06-01 09:00.
```

Column:

```sql
occurred_at TIMESTAMPTZ
```

### 2.2 Reported Time

Kapan external source melaporkan event.

```text
External agency reported case at 2026-06-01 11:00.
```

Column:

```sql
reported_at TIMESTAMPTZ
```

### 2.3 Received Time

Kapan sistem kamu menerima data.

```text
Our API received payload at 2026-06-01 11:05.
```

Column:

```sql
received_at TIMESTAMPTZ
```

### 2.4 Recorded Time

Kapan database mencatat row.

```text
DB inserted event row at 2026-06-01 11:05:03.
```

Column:

```sql
recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

Jangan menggabungkan semuanya menjadi satu `created_at`.

---

## 3. Valid Time vs Transaction Time

Dua konsep temporal paling penting:

### 3.1 Valid Time

Kapan fakta benar dalam domain.

Example:

```text
Officer A assigned to case C1 from June 1 to June 10.
```

Columns:

```sql
valid_from TIMESTAMPTZ NOT NULL
valid_to TIMESTAMPTZ
```

### 3.2 Transaction Time

Kapan database mengetahui/mencatat fakta.

Example:

```text
Assignment for June 1 was entered into database on June 3.
```

Columns:

```sql
recorded_from TIMESTAMPTZ NOT NULL
recorded_to TIMESTAMPTZ
```

Valid time menjawab:

```text
Apa yang benar di dunia pada waktu X?
```

Transaction time menjawab:

```text
Apa yang database ketahui pada waktu Y?
```

Keduanya berbeda.

---

## 4. Contoh Valid vs Recorded

Suppose:

```text
Officer A sebenarnya assigned sejak 2026-06-01.
Tapi data baru dimasukkan ke sistem pada 2026-06-03.
```

Valid time:

```text
valid_from = 2026-06-01
```

Recorded time:

```text
recorded_at = 2026-06-03
```

Jika report pada 2026-06-02 dibuat dari database, report tidak tahu assignment tersebut.

Jika report pada 2026-06-04 ditanya “siapa assigned pada 2026-06-02 secara domain?”, jawabannya Officer A.

Jika ditanya “apa yang sistem tahu pada 2026-06-02?”, jawabannya belum tahu.

Ini bukan detail kecil. Ini historical truth.

---

## 5. Current State vs History

Current state table:

```sql
cases (
    id,
    status,
    current_primary_officer_id,
    updated_at
)
```

History table:

```sql
case_status_transitions (
    case_id,
    from_status,
    to_status,
    transitioned_at,
    transitioned_by,
    reason
)
```

Current state cepat untuk query operasional.

History menjelaskan bagaimana current state terjadi.

Pattern umum:

```text
current state + append-only history
```

Gunakan ketika:

- current reads frequent
- audit/history required
- state transition meaningful
- regulatory traceability needed

---

## 6. Append-Only History

Append-only berarti tidak mengupdate/menghapus history normalnya.

Example:

```sql
CREATE TABLE case_status_transitions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    transitioned_at TIMESTAMPTZ NOT NULL,
    transitioned_by UUID NOT NULL,
    reason TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    FOREIGN KEY (tenant_id, case_id)
        REFERENCES cases (tenant_id, id),

    CHECK (from_status IS DISTINCT FROM to_status)
);
```

Append-only memberi:

- audit trail
- sequence of facts
- easier investigation
- less accidental history rewrite
- event-like semantics

Corrections should usually be new rows, not destructive updates.

---

## 7. `created_at` dan `updated_at` Tidak Cukup

Common table:

```sql
cases (
    id,
    status,
    created_at,
    updated_at
)
```

This does not tell:

- who changed status
- previous status
- reason
- whether status changed multiple times
- whether updated_at was due to status or typo fix
- what values changed
- effective date
- correction history

`updated_at` adalah operational metadata, bukan audit history.

Use it for:

- cache invalidation
- synchronization
- optimistic ordering
- projection scans, carefully

Do not use it as full audit trail.

---

## 8. Technical Audit vs Business History

### 8.1 Technical Audit

Records row-level mutation:

```text
cases row updated:
old JSON -> new JSON
changed_by
changed_at
```

Useful for:

- forensic debugging
- detecting accidental changes
- compliance evidence
- admin accountability

### 8.2 Business History

Records domain event:

```text
Case escalated from UNDER_REVIEW to ESCALATED by Officer A because SLA risk.
```

Useful for:

- user timeline
- regulatory history
- business reporting
- workflow reasoning

Both can coexist.

Do not replace business history with generic audit JSON only.

---

## 9. Audit Table Design

Technical audit example:

```sql
CREATE TABLE audit_events (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    actor_id UUID,
    actor_type TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    request_id TEXT,
    old_values JSONB,
    new_values JSONB,
    metadata JSONB NOT NULL,

    CHECK (actor_type IN ('USER', 'SYSTEM', 'SERVICE'))
);
```

Important indexes:

```sql
CREATE INDEX idx_audit_entity_time
ON audit_events (tenant_id, entity_type, entity_id, occurred_at DESC, id DESC);

CREATE INDEX idx_audit_actor_time
ON audit_events (tenant_id, actor_id, occurred_at DESC, id DESC);
```

Audit table is usually append-heavy and large. Plan partitioning/retention.

---

## 10. Business Timeline Table

For case timeline:

```sql
CREATE TABLE case_timeline_events (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    event_at TIMESTAMPTZ NOT NULL,
    actor_id UUID,
    title TEXT NOT NULL,
    description TEXT,
    payload JSONB NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    FOREIGN KEY (tenant_id, case_id)
        REFERENCES cases (tenant_id, id)
);
```

Examples:

```text
CASE_OPENED
CASE_ASSIGNED
EVIDENCE_RECEIVED
CASE_ESCALATED
DECISION_ISSUED
CASE_CLOSED
```

This is user/business-facing timeline, not raw row mutation audit.

---

## 11. Effective-Dated Records

Effective-dated record stores fact valid over interval.

Example assignment:

```sql
CREATE TABLE case_assignments (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    officer_id UUID NOT NULL,
    assignment_role TEXT NOT NULL,
    valid_from TIMESTAMPTZ NOT NULL,
    valid_to TIMESTAMPTZ,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (valid_to IS NULL OR valid_to > valid_from)
);
```

Query current:

```sql
WHERE valid_from <= now()
  AND (valid_to IS NULL OR valid_to > now())
```

Query at time:

```sql
WHERE valid_from <= :as_of
  AND (valid_to IS NULL OR valid_to > :as_of)
```

Use half-open intervals:

```text
[valid_from, valid_to)
```

---

## 12. Why Half-Open Intervals

Use:

```text
valid_from inclusive
valid_to exclusive
```

If assignment A ends exactly when B starts:

```text
A: [2026-06-01 09:00, 2026-06-10 17:00)
B: [2026-06-10 17:00, null)
```

No overlap and no gap.

Avoid inclusive end:

```text
valid_to inclusive
```

because boundary comparisons become messy.

Half-open intervals are standard for temporal modelling.

---

## 13. Preventing Overlap

Requirement:

```text
One case cannot have two active PRIMARY assignments at same time.
```

Need no-overlap constraint per case/role.

PostgreSQL exclusion constraint concept:

```sql
EXCLUDE USING gist (
    tenant_id WITH =,
    case_id WITH =,
    assignment_role WITH =,
    tstzrange(valid_from, valid_to) WITH &&
)
WHERE (assignment_role = 'PRIMARY');
```

This is vendor-specific.

Alternatives:

- trigger to check overlap
- serializable transaction
- lock case row and check before insert
- current assignment table + history table
- discrete time slots with unique constraint

Temporal no-overlap is cross-row invariant and must be designed.

---

## 14. Current Row + History Rows

Alternative to pure effective-dated query:

```sql
cases(current_primary_officer_id)
case_assignment_history(...)
```

When assignment changes:

1. update current pointer
2. close old history row
3. insert new history row
4. commit atomically

Pros:

- current query fast
- history available
- simple API reads

Cons:

- redundancy
- must keep current/history consistent
- correction complexity

This pattern is common and practical.

---

## 15. Status History

Status transition history:

```sql
CREATE TABLE case_status_transitions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    transitioned_at TIMESTAMPTZ NOT NULL,
    transitioned_by UUID NOT NULL,
    reason TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (from_status IS DISTINCT FROM to_status)
);
```

Current state:

```sql
cases.status
```

Transition transaction:

```sql
BEGIN;

SELECT status
FROM cases
WHERE id = :case_id
FOR UPDATE;

UPDATE cases
SET status = :to_status
WHERE id = :case_id;

INSERT INTO case_status_transitions (...);

COMMIT;
```

This keeps current and history aligned.

---

## 16. Reconstructing State from Events

If event table is source of truth, current state can be derived.

Example:

```sql
SELECT to_status
FROM case_status_transitions
WHERE case_id = :case_id
ORDER BY transitioned_at DESC, id DESC
LIMIT 1;
```

But reconstructing for many rows can be expensive.

Options:

- current state table
- materialized projection
- event sourcing snapshot
- periodic state rebuild

Event-sourced systems require discipline. Most SQL systems use hybrid current + history.

---

## 17. Correction vs Update

Suppose case status transition was entered with wrong reason.

Bad:

```sql
UPDATE case_status_transitions
SET reason = 'corrected reason'
WHERE id = :transition_id;
```

Maybe acceptable for typo? Maybe not.

Regulated systems often need correction record:

```sql
CREATE TABLE case_status_transition_corrections (
    id UUID PRIMARY KEY,
    transition_id UUID NOT NULL REFERENCES case_status_transitions(id),
    corrected_at TIMESTAMPTZ NOT NULL,
    corrected_by UUID NOT NULL,
    correction_reason TEXT NOT NULL,
    old_values JSONB NOT NULL,
    new_values JSONB NOT NULL
);
```

Then either:

- keep original immutable and correction row modifies interpretation
- create replacement transition
- mark original superseded
- store amended version

Policy matters.

---

## 18. Amendment vs Correction vs Reversal

Distinguish:

### 18.1 Correction

Fix erroneous data.

```text
The officer ID was entered incorrectly.
```

### 18.2 Amendment

Add/change legal/document content while preserving original.

```text
Decision amended with additional paragraph.
```

### 18.3 Reversal

Undo previous business action with new action.

```text
Penalty decision reversed on appeal.
```

Different domain semantics require different schemas.

Do not model all as generic update.

---

## 19. Superseding Records

Pattern:

```sql
CREATE TABLE case_decision_versions (
    decision_id UUID NOT NULL,
    version INTEGER NOT NULL,
    decision_text TEXT NOT NULL,
    effective_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    created_by UUID NOT NULL,
    superseded_at TIMESTAMPTZ,
    superseded_by_version INTEGER,

    PRIMARY KEY (decision_id, version)
);
```

Current version:

```sql
WHERE superseded_at IS NULL
```

or current pointer in parent:

```sql
case_decisions.current_version
```

Versioning is safer for legal artifacts than overwrite.

---

## 20. Snapshotting

Snapshot stores data as it was at a point in time.

Example report snapshot:

```sql
CREATE TABLE monthly_report_snapshots (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    report_month DATE NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    generated_by UUID NOT NULL,
    report_version TEXT NOT NULL,
    data JSONB NOT NULL,

    UNIQUE (tenant_id, report_month, report_version)
);
```

Snapshot needed when:

- report must be reproducible
- source data can change
- external submission must be preserved
- legal document must show old values
- rule version matters

A materialized view is not enough if it can refresh and lose old output.

---

## 21. Snapshot as JSON vs Normalized Rows

JSON snapshot:

Pros:

- easy preserve exact output
- flexible schema
- good for submitted document payload
- simple versioning

Cons:

- hard query
- weak constraints
- large storage
- migration/analysis hard

Normalized snapshot rows:

Pros:

- queryable
- typed
- constraints
- easier reporting comparison

Cons:

- more schema work
- harder to preserve exact external payload
- schema evolves

Often use both:

- normalized report rows for analytics
- JSON/document blob for exact submitted artifact

---

## 22. Effective-Dated Reference Data

Reference data changes over time.

Example SLA rule:

```sql
CREATE TABLE sla_rules (
    id UUID PRIMARY KEY,
    jurisdiction_code TEXT NOT NULL,
    case_type TEXT NOT NULL,
    priority TEXT NOT NULL,
    business_days INTEGER NOT NULL,
    valid_from DATE NOT NULL,
    valid_to DATE,
    rule_version TEXT NOT NULL,

    CHECK (business_days > 0),
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);
```

Case SLA stores:

```sql
sla_rule_id UUID NOT NULL REFERENCES sla_rules(id)
```

or snapshot:

```sql
rule_version TEXT NOT NULL,
business_days_at_calculation INTEGER NOT NULL
```

Why?

If rule changes later, old SLA calculation must remain explainable.

---

## 23. Effective-Dated Query

Find rule effective on date:

```sql
SELECT *
FROM sla_rules
WHERE jurisdiction_code = :jurisdiction
  AND case_type = :case_type
  AND priority = :priority
  AND valid_from <= :date
  AND (valid_to IS NULL OR valid_to > :date)
ORDER BY valid_from DESC
LIMIT 1;
```

Index:

```sql
CREATE INDEX idx_sla_rules_lookup
ON sla_rules (
    jurisdiction_code,
    case_type,
    priority,
    valid_from DESC
);
```

Need no-overlap invariant for same key interval.

---

## 24. No-Overlap Reference Rules

Requirement:

```text
For same jurisdiction/case_type/priority, valid intervals must not overlap.
```

PostgreSQL exclusion concept:

```sql
EXCLUDE USING gist (
    jurisdiction_code WITH =,
    case_type WITH =,
    priority WITH =,
    daterange(valid_from, valid_to) WITH &&
);
```

Alternative:

- trigger
- serializable transaction
- admin workflow lock
- validate in migration
- discrete version numbers

Overlap in reference data creates ambiguous historical answers.

---

## 25. Bitemporal Modelling

Bitemporal data tracks both:

```text
valid time
transaction/recorded time
```

Example table:

```sql
CREATE TABLE officer_assignments_bitemporal (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    officer_id UUID NOT NULL,

    valid_from TIMESTAMPTZ NOT NULL,
    valid_to TIMESTAMPTZ,

    recorded_from TIMESTAMPTZ NOT NULL,
    recorded_to TIMESTAMPTZ,

    recorded_by UUID NOT NULL,
    correction_reason TEXT,

    CHECK (valid_to IS NULL OR valid_to > valid_from),
    CHECK (recorded_to IS NULL OR recorded_to > recorded_from)
);
```

Questions answerable:

```text
Who was assigned on June 2?
Who did the system believe was assigned on June 3?
When did we learn correction?
What changed retroactively?
```

Bitemporal is powerful but complex. Use when needed, not by default.

---

## 26. Bitemporal Example

Initial record entered June 3:

```text
valid_from = June 1
valid_to = null
recorded_from = June 3
recorded_to = null
officer = A
```

On June 5, correction says officer was actually B from June 1 to June 4.

You do not overwrite blindly. You close recorded version:

```text
A record: recorded_to = June 5
```

Then insert corrected records:

```text
B valid June 1-June 4, recorded_from June 5
A valid June 4-null, recorded_from June 5
```

Now system can answer both:

```text
What did we believe on June 4?
What do we now believe about June 2?
```

---

## 27. Temporal Query Types

### 27.1 Current

```sql
WHERE valid_to IS NULL
```

### 27.2 As-Of Valid Time

```sql
WHERE valid_from <= :as_of
  AND (valid_to IS NULL OR valid_to > :as_of)
```

### 27.3 As-Known-At Transaction Time

```sql
WHERE recorded_from <= :known_at
  AND (recorded_to IS NULL OR recorded_to > :known_at)
```

### 27.4 Bitemporal As-Of

```sql
WHERE valid_from <= :valid_as_of
  AND (valid_to IS NULL OR valid_to > :valid_as_of)
  AND recorded_from <= :known_at
  AND (recorded_to IS NULL OR recorded_to > :known_at)
```

This is advanced but critical in some domains.

---

## 28. Temporal Tables / System-Versioned Tables

Some databases support system-versioned temporal tables.

SQL Server, Oracle, MariaDB/MySQL variants, and others have temporal features with different semantics.

They can automatically preserve row versions over transaction/system time.

Benefits:

- less custom audit code
- as-of queries
- automatic history
- database-managed consistency

Limitations:

- vendor-specific
- may track transaction time, not domain valid time
- schema changes/history management
- retention
- performance/storage
- not replacement for business events
- not always capture actor/reason

Use temporal tables if they match your needs, but understand which time dimension they track.

---

## 29. Event Sourcing vs Temporal Tables

Event sourcing:

```text
Store domain events as source of truth.
State derived from events.
```

Temporal tables:

```text
Store row versions over time.
Current row remains table-like.
```

Event sourcing answers:

```text
What domain events happened?
```

Temporal tables answer:

```text
What row looked like at time X?
```

They are related but not same.

Do not choose event sourcing just because you need audit. Business history tables may be enough.

---

## 30. Audit Immutability

Audit/history tables should be protected.

Options:

- restricted permissions
- append-only policy
- no update/delete grants
- triggers preventing update/delete
- partition retention controls
- cryptographic hash chain for tamper evidence
- WORM storage/external archive
- database audit features

Example trigger preventing update/delete:

```sql
CREATE FUNCTION prevent_audit_modification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'audit table is append-only';
END;
$$;
```

But superusers can bypass many controls. Real tamper evidence may require external systems.

---

## 31. Hash Chains for Tamper Evidence

For high-assurance audit, store hash chain:

```text
current_hash = hash(previous_hash + event_payload + timestamp)
```

Table:

```sql
audit_events(
    id,
    sequence_number,
    previous_hash,
    event_hash,
    payload,
    occurred_at
)
```

Benefits:

- tampering detectable if chain verified
- external anchoring possible

Challenges:

- concurrency ordering
- sequence bottleneck
- key management
- verification tooling
- operational complexity

Use only when compliance/security requires.

---

## 32. Time Zone Strategy

Use `TIMESTAMPTZ` or equivalent for instants.

Store actual moments in UTC-aware type.

For business/legal date, also store local date/timezone if relevant.

Example:

```sql
opened_at TIMESTAMPTZ NOT NULL,
deadline_local_date DATE NOT NULL,
deadline_timezone TEXT NOT NULL,
deadline_at TIMESTAMPTZ NOT NULL
```

Why both?

- legal deadline may be defined by local calendar date
- daylight saving/timezone rules matter
- instant alone may not explain local legal date
- local date alone may not order global events

Do not store local date-time without knowing timezone if it represents actual instant.

---

## 33. `now()` Semantics

Database functions differ.

PostgreSQL:

- `now()` / `current_timestamp` returns transaction start time
- `clock_timestamp()` returns actual current clock time

This matters in long transactions.

If all rows in transaction should have same timestamp, `now()` is good.

If measuring duration/actual event, maybe not.

Java app time vs DB time:

- DB time consistent inside DB
- app time may vary across servers
- external event time may come from payload

Choose intentionally.

---

## 34. Ordering Events

Timestamps may tie.

Do not rely only on timestamp for deterministic order.

Use tie-breaker:

```sql
ORDER BY occurred_at, id
```

or sequence:

```sql
case_sequence_number
```

For per-case timeline:

```sql
CREATE TABLE case_events (
    case_id UUID NOT NULL,
    sequence_number BIGINT NOT NULL,
    event_type TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,

    PRIMARY KEY (case_id, sequence_number)
);
```

Generating per-case sequence under concurrency requires lock/serialization/counter.

If exact order matters, model it.

---

## 35. Late Arriving Events

External events can arrive late.

Example:

```text
event_occurred_at = June 1
received_at = June 5
```

If report for June 1 already generated, what happens?

Options:

- correction/amendment report
- restate historical metrics
- include in next report as late event
- maintain as-known-at reporting
- flag late arrival
- regulatory policy determines

Schema should store both occurred_at and received_at.

Otherwise you cannot reason about lateness.

---

## 36. Backdated Changes

Backdated effective date:

```text
Assignment entered today but effective last week.
```

Danger:

- changes historical reports
- affects SLA calculations
- may conflict with existing intervals
- may require approvals
- may need correction reason

Model:

```sql
valid_from
recorded_at
recorded_by
backdate_reason
approved_by
approved_at
```

Backdating should often be controlled workflow, not ordinary update.

---

## 37. Historical Reporting

Report questions:

### 37.1 Current Report

```text
How many cases are open now?
```

### 37.2 As-Of Domain Report

```text
How many cases were open on June 1 according to current corrected knowledge?
```

### 37.3 As-Known-At Report

```text
What did the system report as open on June 1, based on what was known then?
```

These are different.

Make report semantics explicit.

---

## 38. Current Corrected vs Previously Published

Suppose monthly report submitted on July 1.

On July 5, correction changes June case status.

Questions:

```text
Should June report change?
Should July report include correction?
Should amendment be submitted?
Should dashboard show corrected June?
Should audit preserve old submitted report?
```

Database must support policy.

Usually:

- published report snapshot remains
- correction record stored
- amended report generated if required
- current analytics may show corrected view

---

## 39. Temporal Constraints

Constraints for temporal data:

```sql
CHECK (valid_to IS NULL OR valid_to > valid_from)
CHECK (recorded_to IS NULL OR recorded_to > recorded_from)
CHECK (effective_to IS NULL OR effective_to > effective_from)
```

No-overlap:

- exclusion constraint
- trigger
- serializable transaction
- lock parent

No-gap:

- harder
- may need trigger/procedure
- often not necessary unless domain demands

One-current-row:

```sql
CREATE UNIQUE INDEX uq_current_rule
ON rules (jurisdiction_code, case_type, priority)
WHERE valid_to IS NULL;
```

This ensures one open-ended current rule, not no-overlap across history.

---

## 40. Temporal Indexing

Common indexes:

Current rows:

```sql
CREATE INDEX idx_assignments_current
ON case_assignments (tenant_id, case_id)
WHERE valid_to IS NULL;
```

As-of query:

```sql
CREATE INDEX idx_assignments_as_of
ON case_assignments (tenant_id, case_id, valid_from, valid_to);
```

History timeline:

```sql
CREATE INDEX idx_case_status_transitions_timeline
ON case_status_transitions (tenant_id, case_id, transitioned_at DESC, id DESC);
```

Audit entity:

```sql
CREATE INDEX idx_audit_entity_time
ON audit_events (tenant_id, entity_type, entity_id, occurred_at DESC, id DESC);
```

Large append-only audit:

```sql
-- BRIN for huge time-correlated table, PostgreSQL-specific
CREATE INDEX idx_audit_occurred_brin
ON audit_events
USING BRIN (occurred_at);
```

Temporal data grows quickly; indexing must be intentional.

---

## 41. Partitioning Temporal Tables

Audit/events/history tables often grow without bound.

Partition by time:

```text
audit_events_2026_01
audit_events_2026_02
...
```

Benefits:

- faster retention/drop old partitions
- smaller indexes per partition
- maintenance easier
- query pruning by date

Caveats:

- queries must include time predicate
- global uniqueness harder in some DBs
- partition management
- migrations more complex
- foreign keys limitations vary

Partitioning is covered later, but temporal design should anticipate growth.

---

## 42. Retention Policy

Historical data may need retention.

Questions:

```text
How long keep audit logs?
How long keep raw external payloads?
Can PII be deleted?
What about legal hold?
What about report snapshots?
What about backups?
What about read models/search indexes?
```

Retention is not just deleting rows.

Schema may need:

```sql
retention_until DATE
legal_hold BOOLEAN
deleted_at TIMESTAMPTZ
redacted_at TIMESTAMPTZ
```

Compliance requirements drive design.

---

## 43. Redaction vs Deletion in History

If PII must be erased but audit preserved:

Options:

- redact fields in audit payload
- tokenize/pseudonymize
- encrypt per subject and destroy key
- keep non-PII metadata
- store reference to redaction event
- separate sensitive data from immutable audit metadata

Example:

```sql
CREATE TABLE redaction_events (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    field_name TEXT NOT NULL,
    redacted_at TIMESTAMPTZ NOT NULL,
    redacted_by UUID NOT NULL,
    reason TEXT NOT NULL
);
```

Immutable audit and privacy rights can conflict. Design with legal/security input.

---

## 44. Java Time Types

Use proper Java types:

```text
Instant -> exact moment
OffsetDateTime -> moment with offset
LocalDate -> date without time
LocalDateTime -> local date-time without zone
ZonedDateTime -> date-time with zone rules
```

Common mappings:

```text
TIMESTAMPTZ <-> Instant / OffsetDateTime
DATE <-> LocalDate
TIME <-> LocalTime
```

Avoid:

- storing instant as string
- using `LocalDateTime` for global instant without timezone
- relying on server default timezone
- converting silently in JSON serialization
- mixing app time and DB time unknowingly

Be explicit at API boundary.

---

## 45. Clock Sources

Possible clock sources:

- database clock
- application server clock
- external event payload clock
- user-provided time
- message broker timestamp

Use cases:

```text
recorded_at -> DB clock
event_occurred_at -> payload/domain
received_at -> app or DB at ingestion
submitted_at -> external source
```

Ensure NTP/time sync for app servers.

For audit, DB-generated recorded_at often more trustworthy than client-provided timestamp.

---

## 46. Time Precision

Different systems have different timestamp precision.

Problems:

- Java nanoseconds vs DB microseconds
- MySQL timestamp precision config
- JSON milliseconds
- ordering ties
- optimistic cursor issues
- equality comparisons fail

Avoid relying on exact timestamp equality across systems.

Use:

```text
range comparisons
tie-breaker IDs
sequence numbers
```

For pagination:

```sql
ORDER BY occurred_at DESC, id DESC
```

not only `occurred_at`.

---

## 47. Temporal Testing

Test time explicitly.

Use fixed clocks in Java:

```java
Clock fixedClock = Clock.fixed(...);
```

Test:

- time zone conversion
- DST transitions
- end-of-day deadlines
- leap year
- boundary interval `[from, to)`
- late arriving event
- backdated correction
- report snapshot immutability
- as-of query
- tie ordering
- transaction timestamp behavior

Temporal bugs often hide at boundaries.

---

## 48. Daylight Saving Time

DST can break naive date arithmetic.

Example:

```text
Add 24 hours
```

is not always same as:

```text
next local day at same local time
```

Business deadline:

```text
5 business days in Asia/Jakarta
```

needs calendar/timezone rules.

Store:

- timezone
- local date if legal
- computed instant
- rule version/calendar id

Do not hardcode `+ 24 hours` for legal deadlines unless domain says exactly 24 hours.

---

## 49. Business Calendar

Business-day SLA:

```sql
CREATE TABLE business_calendars (
    id TEXT PRIMARY KEY,
    timezone TEXT NOT NULL,
    description TEXT NOT NULL
);

CREATE TABLE business_calendar_days (
    calendar_id TEXT NOT NULL REFERENCES business_calendars(id),
    calendar_date DATE NOT NULL,
    is_business_day BOOLEAN NOT NULL,
    holiday_name TEXT,

    PRIMARY KEY (calendar_id, calendar_date)
);
```

SLA stores:

```sql
calendar_id TEXT NOT NULL
rule_version TEXT NOT NULL
due_local_date DATE NOT NULL
due_at TIMESTAMPTZ NOT NULL
```

This preserves calculation basis.

---

## 50. Mini Case Study: Case Timeline

Tables:

```sql
cases
case_status_transitions
case_assignments
case_evidences
case_decisions
case_timeline_events
audit_events
```

Timeline query:

```sql
SELECT
    event_at,
    event_type,
    title,
    description,
    actor_id
FROM case_timeline_events
WHERE tenant_id = :tenant_id
  AND case_id = :case_id
ORDER BY event_at ASC, id ASC;
```

Index:

```sql
CREATE INDEX idx_case_timeline
ON case_timeline_events (tenant_id, case_id, event_at ASC, id ASC);
```

Timeline should be user-facing and semantically curated.

Technical audit remains separate.

---

## 51. Mini Case Study: Decision Versioning

```sql
CREATE TABLE case_decisions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    current_version INTEGER NOT NULL,
    status TEXT NOT NULL
);

CREATE TABLE case_decision_versions (
    decision_id UUID NOT NULL REFERENCES case_decisions(id),
    version INTEGER NOT NULL,
    decision_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    created_by UUID NOT NULL,
    effective_at TIMESTAMPTZ,
    reason TEXT,

    PRIMARY KEY (decision_id, version)
);
```

Do not overwrite issued decision text.

If amendment:

```sql
INSERT INTO case_decision_versions(version = current_version + 1, ...);
UPDATE case_decisions SET current_version = current_version + 1;
```

same transaction.

---

## 52. Mini Case Study: SLA Historical Truth

SLA row:

```sql
CREATE TABLE case_slas (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    sla_type TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    due_local_date DATE NOT NULL,
    timezone TEXT NOT NULL,
    calendar_id TEXT NOT NULL,
    rule_version TEXT NOT NULL,
    rule_id UUID,
    status TEXT NOT NULL,
    completed_at TIMESTAMPTZ,
    calculated_at TIMESTAMPTZ NOT NULL,
    calculation_inputs JSONB NOT NULL,

    CHECK (due_at > started_at)
);
```

This can explain:

```text
why due date was set
which rule
which calendar
when calculated
what inputs
```

For regulated SLA, this is better than only `due_at`.

---

## 53. Mini Case Study: Late External Event

```sql
CREATE TABLE external_case_events (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    source_system TEXT NOT NULL,
    source_event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    reported_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    payload JSONB NOT NULL,

    UNIQUE (tenant_id, source_system, source_event_id)
);
```

This supports:

- deduplication
- late event detection
- as-reported audit
- replay
- source reconciliation

Do not discard original payload if it is needed for audit.

---

## 54. Mini Case Study: Historical Assignment Query

Assignment table:

```sql
case_assignments(
    case_id,
    officer_id,
    valid_from,
    valid_to
)
```

Who was primary officer at time X?

```sql
SELECT officer_id
FROM case_assignments
WHERE tenant_id = :tenant_id
  AND case_id = :case_id
  AND assignment_role = 'PRIMARY'
  AND valid_from <= :as_of
  AND (valid_to IS NULL OR valid_to > :as_of)
ORDER BY valid_from DESC
LIMIT 1;
```

If more than one row returns, invariant failed.

Add no-overlap enforcement.

---

## 55. Mini Case Study: Report Snapshot vs Live Query

Live query:

```sql
SELECT status, COUNT(*)
FROM cases
WHERE tenant_id = :tenant_id
GROUP BY status;
```

Report snapshot:

```sql
INSERT INTO report_snapshots (
    id,
    tenant_id,
    report_period,
    generated_at,
    data
)
VALUES (
    :id,
    :tenant_id,
    :period,
    now(),
    :json_output
);
```

Live query changes as data changes.

Snapshot preserves submitted truth.

Use both for different purposes.

---

## 56. Anti-Patterns

```text
[ ] only created_at/updated_at for audit-heavy domain
[ ] status overwritten without transition history
[ ] decision text overwritten after issue
[ ] due_at stored without rule/calendar/version
[ ] external event occurred_at confused with received_at
[ ] local date-time stored without timezone for instant
[ ] inclusive interval end causing overlap bugs
[ ] history table updated destructively
[ ] correction done by UPDATE without correction record
[ ] published report not snapshotted
[ ] materialized view used as historical proof
[ ] no tie-breaker in event ordering
[ ] no retention/redaction design for audit
[ ] read model contains stale PII after source redaction
[ ] no as-of semantics defined for report
```

---

## 57. Temporal Design Checklist

```text
[ ] What time concepts exist in domain?
[ ] Is this current state, event, effective-dated fact, or snapshot?
[ ] Do we need valid time?
[ ] Do we need recorded/transaction time?
[ ] Do we need bitemporal answers?
[ ] Are intervals half-open?
[ ] Are no-overlap constraints needed?
[ ] Do we need current table plus history?
[ ] Are corrections destructive or append-only?
[ ] Are legal artifacts versioned?
[ ] Are reports snapshotted?
[ ] Are rule/calendar versions stored?
[ ] Is timezone/local date represented correctly?
[ ] Is event ordering deterministic?
[ ] Are late events handled?
[ ] Are retention/redaction/legal hold requirements modelled?
[ ] Are temporal queries indexed?
[ ] Are temporal edge cases tested?
```

---

## 58. Practical Exercises

### Exercise 1 — Identify Time Types

For external event ingestion, define:

```text
occurred_at
reported_at
received_at
recorded_at
```

Explain each.

### Exercise 2 — Assignment As-Of Query

Write query for officer assigned at `:as_of` using `[valid_from, valid_to)`.

### Exercise 3 — Status History

Design current + transition table for case status.

### Exercise 4 — Correction

Instead of updating issued decision text, design version/amendment table.

### Exercise 5 — Report Snapshot

Explain why monthly submitted report should be snapshotted even if source tables keep history.

---

## 59. Koneksi ke Part Berikutnya

Part ini membahas temporal data, auditability, and historical truth.

Part berikutnya, `part-024`, akan membahas security:

- permissions
- roles
- least privilege
- row-level security
- SQL injection
- parameter binding
- data protection
- encryption
- masking/redaction
- audit/security operations
- Java secure data access

Temporal truth menjawab “apa yang terjadi dan kapan”. Security menjawab “siapa boleh melihat atau mengubah apa”.

---

## 60. Ringkasan Bagian Ini

Hal penting dari part 023:

1. Temporal data lebih dari `created_at` dan `updated_at`.
2. Event time, reported time, received time, and recorded time bisa berbeda.
3. Valid time menjawab kapan fakta benar di domain.
4. Transaction/recorded time menjawab kapan sistem tahu.
5. Current state cepat untuk operasi; history menjelaskan perubahan.
6. Append-only history lebih aman untuk audit.
7. Technical audit dan business history berbeda.
8. Effective-dated records memakai interval waktu, idealnya half-open `[from, to)`.
9. Temporal no-overlap adalah cross-row invariant yang perlu constraint/lock/trigger/serializable.
10. Corrections, amendments, and reversals punya makna domain berbeda.
11. Versioning penting untuk legal artifacts.
12. Snapshots diperlukan untuk report/submission reproducibility.
13. Effective-dated reference data menjaga historical rule correctness.
14. Bitemporal modelling kuat tapi kompleks.
15. Temporal/system-versioned database features berguna tetapi bukan pengganti business history.
16. Audit immutability butuh permissions/process, kadang tamper-evidence.
17. Timezone, local date, and instants harus dimodelkan eksplisit.
18. Event ordering butuh tie-breaker atau sequence.
19. Late arriving/backdated events harus punya policy.
20. Retention/redaction/legal hold adalah bagian dari temporal data design.

Kalimat inti:

> Sistem yang matang tidak hanya menyimpan state; ia menyimpan cukup konteks temporal untuk menjelaskan apa yang benar, kapan benar, kapan diketahui, siapa mengubahnya, dan bagaimana koreksi dilakukan.

---

## 61. Referensi

1. PostgreSQL Documentation — Date/Time Types.  
   https://www.postgresql.org/docs/current/datatype-datetime.html

2. PostgreSQL Documentation — Range Types.  
   https://www.postgresql.org/docs/current/rangetypes.html

3. PostgreSQL Documentation — Exclusion Constraints.  
   https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-EXCLUSION

4. PostgreSQL Documentation — System Columns / MVCC Concepts.  
   https://www.postgresql.org/docs/current/mvcc.html

5. SQL Server Documentation — Temporal Tables.  
   https://learn.microsoft.com/en-us/sql/relational-databases/tables/temporal-tables

6. Oracle Database Documentation — Flashback Technology.  
   https://docs.oracle.com/en/database/oracle/oracle-database/23/adfns/flashback.html

7. Martin Fowler — Temporal Patterns.  
   https://martinfowler.com/eaaDev/TemporalProperty.html

8. Martin Fowler — Event Sourcing.  
   https://martinfowler.com/eaaDev/EventSourcing.html

9. Java Documentation — `java.time` Package.  
   https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/time/package-summary.html

10. ISO SQL:2011 introduced system-versioned temporal table concepts; vendor implementations vary.

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

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-024.md` — Security: Permissions, Row-Level Security, SQL Injection, and Data Protection
