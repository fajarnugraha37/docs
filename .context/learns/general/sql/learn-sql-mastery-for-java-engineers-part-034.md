# learn-sql-mastery-for-java-engineers-part-034.md

# Part 34 — Capstone: Designing and Operating a Regulatory Case Management Database

> Seri: SQL Mastery for Java Engineers  
> Bagian: 034 dari 034  
> Status seri: **selesai / bagian terakhir**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-033.md`  
> Bagian berikutnya: tidak ada — seri selesai

---

## 0. Tujuan Capstone

Ini adalah bagian terakhir dari seri **SQL Mastery for Java Engineers**.

Selama 34 bagian, kita membahas SQL dari fondasi sampai operasi production:

- relational thinking
- SQL semantics
- data types and NULL
- joins, aggregation, CTEs, set operations, window functions
- DML and constraints
- schema design and normalization
- state machines and workflows
- indexing and optimizer
- performance engineering
- transactions, locking, MVCC, deadlocks
- stored logic, views, read models
- temporal truth and auditability
- security
- JDBC, ORM, query builders
- migrations
- bulk data and reconciliation
- partitioning, sharding, replication
- operations, backup, restore, DR
- OLAP/reporting
- vendor differences
- design patterns and anti-patterns

Capstone ini menggabungkan semuanya dalam satu studi kasus:

```text
Designing and Operating a Regulatory Case Management Database
```

Kita akan mendesain database untuk sistem yang menangani regulatory cases, seperti:

- complaint/investigation case
- compliance review
- enforcement action
- audit finding
- licensing/permit issue
- regulatory decision
- SLA/deadline-driven case
- evidence/document workflow
- approval and decision lifecycle
- reporting to regulator/internal governance

Sistem seperti ini menuntut:

- correctness
- auditability
- temporal truth
- security
- operational reliability
- clear workflow
- reporting correctness
- migration safety
- Java integration discipline

Kalimat inti:

> Capstone ini bukan tentang membuat schema sebanyak mungkin, tetapi tentang menunjukkan cara berpikir desain database production: fakta apa yang benar, invariant mana yang harus ditegakkan, query apa yang penting, failure mode apa yang mungkin, dan bagaimana sistem tetap bisa diaudit serta dioperasikan.

---

## 1. Business Context

Kita desain sistem bernama:

```text
Regulatory Case Management System
```

Sistem ini dipakai oleh regulatory agency atau compliance organization untuk menangani case.

Contoh case:

```text
A complaint is received.
Case is opened.
Case is assigned to officer.
Evidence is collected.
Case is reviewed.
Decision is issued.
Case may be appealed/amended.
Case is closed.
Regulatory report is submitted monthly.
```

Stakeholders:

- intake officer
- investigator/reviewer
- supervisor
- decision approver
- compliance admin
- support user
- reporting analyst
- external agency
- auditor
- system integration worker

Quality attributes:

- no cross-tenant leakage
- every important transition auditable
- official report reproducible
- deadlines explainable
- sensitive data protected
- high-volume audit/event data manageable
- Java services can access data safely
- schema can evolve without downtime
- recovery after incident possible

---

## 2. Core Domain Questions

Before schema, ask questions.

### Case Identity

```text
What uniquely identifies a case?
Is case number tenant-scoped?
Can external agencies send their own IDs?
Can case numbers be corrected?
```

### Workflow

```text
What statuses exist?
Which transitions are allowed?
Who can perform transition?
Does transition require reason?
Can case reopen?
Can decision be amended?
```

### Assignment

```text
Can multiple officers be assigned?
Is there one primary officer?
Can assignments overlap?
Do we need assignment history?
```

### Evidence

```text
Is evidence stored in DB or object storage?
Need chain of custody?
Who can access?
Can evidence be redacted?
```

### SLA

```text
What deadline rules exist?
Are they business days?
Which calendar/timezone?
Can SLA pause/resume?
What if rules change?
```

### Audit and Reports

```text
What must be auditable?
What reports are official?
Are reports current-corrected or as-submitted?
Do we need amendment reports?
```

These questions drive schema.

---

## 3. High-Level Architecture

Recommended architecture:

```text
Java API service
  -> OLTP database
  -> outbox table
  -> event publisher
  -> read model/projection workers
  -> reporting/warehouse pipeline
  -> object storage for documents/evidence
  -> audit/security monitoring
```

Database roles:

```text
app_runtime_role
app_migration_role
reporting_role
support_role
audit_reader_role
security_admin_role
```

Data access:

```text
JPA/Hibernate or SQL-first repository for aggregate commands
jOOQ/MyBatis/JDBC for complex reads/reporting/bulk
Flyway/Liquibase for migrations
Testcontainers for integration tests
```

Design principle:

```text
OLTP database is source of truth for case state and history.
Read models and warehouse are derived and rebuildable.
Official reports are snapshotted.
External side effects use outbox/inbox.
```

---

## 4. Tenant Model

Assume shared-schema multi-tenancy.

Every tenant-scoped table has:

```sql
tenant_id UUID NOT NULL
```

Tenant table:

```sql
CREATE TABLE tenants (
    id UUID PRIMARY KEY,
    tenant_code TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED'))
);
```

Rules:

- all case data includes tenant_id
- tenant-scoped unique constraints
- composite tenant foreign keys
- indexes start with tenant_id for OLTP
- optional RLS for defense-in-depth
- exports/imports tenant-scoped
- audit includes tenant_id

---

## 5. Users, Officers, and Roles

Simplified user model:

```sql
CREATE TABLE users (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    id UUID NOT NULL,
    email_normalized TEXT NOT NULL,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, email_normalized),
    CHECK (status IN ('ACTIVE', 'DISABLED'))
);
```

Officer profile:

```sql
CREATE TABLE officers (
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    officer_code TEXT NOT NULL,
    department TEXT NOT NULL,
    active_from DATE NOT NULL,
    active_to DATE,

    PRIMARY KEY (tenant_id, user_id),
    UNIQUE (tenant_id, officer_code),
    FOREIGN KEY (tenant_id, user_id)
        REFERENCES users (tenant_id, id),
    CHECK (active_to IS NULL OR active_to > active_from)
);
```

Authorization may live in app/security service, but database role/grants still enforce least privilege.

---

## 6. Case Core Table

Main current-state table:

```sql
CREATE TABLE cases (
    tenant_id UUID NOT NULL,
    id UUID NOT NULL,
    case_number TEXT NOT NULL,
    case_number_normalized TEXT NOT NULL,
    case_type_code TEXT NOT NULL,
    jurisdiction_code TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    current_primary_officer_id UUID,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, case_number_normalized),

    FOREIGN KEY (tenant_id, current_primary_officer_id)
        REFERENCES users (tenant_id, id),

    CHECK (closed_at IS NULL OR closed_at >= opened_at),
    CHECK (
        (status <> 'CLOSED' AND closed_at IS NULL)
        OR
        (status = 'CLOSED' AND closed_at IS NOT NULL)
    )
);
```

Important points:

- current state is optimized for operational reads
- status current value is not enough; transitions stored separately
- `version` supports optimistic locking
- `case_number_normalized` supports enforced business uniqueness
- closed_at invariant is constrained

---

## 7. Reference Tables

Statuses:

```sql
CREATE TABLE case_statuses (
    status_code TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    is_terminal BOOLEAN NOT NULL
);
```

Allowed transitions:

```sql
CREATE TABLE allowed_case_status_transitions (
    from_status TEXT NOT NULL REFERENCES case_statuses(status_code),
    to_status TEXT NOT NULL REFERENCES case_statuses(status_code),
    requires_reason BOOLEAN NOT NULL DEFAULT false,
    supervisor_only BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (from_status, to_status),
    CHECK (from_status <> to_status)
);
```

Case type:

```sql
CREATE TABLE case_types (
    case_type_code TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true
);
```

Priority:

```sql
CREATE TABLE priorities (
    priority_code TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    priority_rank INTEGER NOT NULL UNIQUE
);
```

Reference tables make workflow/reporting explicit.

---

## 8. Case Status Transitions

Append-only history:

```sql
CREATE TABLE case_status_transitions (
    tenant_id UUID NOT NULL,
    id UUID NOT NULL,
    case_id UUID NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    transitioned_at TIMESTAMPTZ NOT NULL,
    transitioned_by UUID NOT NULL,
    reason TEXT,
    request_id TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),

    FOREIGN KEY (tenant_id, case_id)
        REFERENCES cases (tenant_id, id),

    FOREIGN KEY (from_status, to_status)
        REFERENCES allowed_case_status_transitions (from_status, to_status),

    FOREIGN KEY (tenant_id, transitioned_by)
        REFERENCES users (tenant_id, id),

    CHECK (from_status IS NULL OR from_status <> to_status)
);
```

Index:

```sql
CREATE INDEX idx_case_status_timeline
ON case_status_transitions (tenant_id, case_id, transitioned_at DESC, id DESC);
```

Why append-only?

- audit
- timeline
- debugging
- regulatory evidence
- transition analytics

---

## 9. Safe Status Transition Transaction

Command:

```text
transition case from UNDER_REVIEW to PENDING_DECISION
```

Transactional logic:

1. lock case row
2. validate current status
3. validate allowed transition
4. update current state/version
5. insert transition history
6. insert timeline event
7. insert outbox event
8. commit

SQL concept:

```sql
SELECT status, version
FROM cases
WHERE tenant_id = :tenant_id
  AND id = :case_id
FOR UPDATE;
```

Then:

```sql
UPDATE cases
SET status = :to_status,
    updated_at = now(),
    version = version + 1
WHERE tenant_id = :tenant_id
  AND id = :case_id
  AND status = :from_status;
```

Affected rows must be 1.

This protects correctness under concurrency.

---

## 10. Assignment Model

Assignment history:

```sql
CREATE TABLE case_assignments (
    tenant_id UUID NOT NULL,
    id UUID NOT NULL,
    case_id UUID NOT NULL,
    officer_id UUID NOT NULL,
    assignment_role TEXT NOT NULL,
    valid_from TIMESTAMPTZ NOT NULL,
    valid_to TIMESTAMPTZ,
    assigned_by UUID NOT NULL,
    reason TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),

    FOREIGN KEY (tenant_id, case_id)
        REFERENCES cases (tenant_id, id),

    FOREIGN KEY (tenant_id, officer_id)
        REFERENCES users (tenant_id, id),

    FOREIGN KEY (tenant_id, assigned_by)
        REFERENCES users (tenant_id, id),

    CHECK (assignment_role IN ('PRIMARY', 'SECONDARY', 'SUPERVISOR')),
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);
```

One active primary assignment:

```sql
CREATE UNIQUE INDEX uq_case_one_active_primary_assignment
ON case_assignments (tenant_id, case_id)
WHERE assignment_role = 'PRIMARY'
  AND valid_to IS NULL;
```

Current pointer in `cases.current_primary_officer_id` is denormalized for fast queues and must be updated in same transaction.

---

## 11. Evidence Metadata

Store binary/document content in object storage; DB stores metadata and integrity.

```sql
CREATE TABLE case_evidences (
    tenant_id UUID NOT NULL,
    id UUID NOT NULL,
    case_id UUID NOT NULL,
    evidence_type TEXT NOT NULL,
    title TEXT NOT NULL,
    storage_uri TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    recorded_by UUID NOT NULL,
    sensitivity_level TEXT NOT NULL,
    redacted_at TIMESTAMPTZ,

    PRIMARY KEY (tenant_id, id),

    FOREIGN KEY (tenant_id, case_id)
        REFERENCES cases (tenant_id, id),

    FOREIGN KEY (tenant_id, recorded_by)
        REFERENCES users (tenant_id, id),

    CHECK (sensitivity_level IN ('NORMAL', 'CONFIDENTIAL', 'RESTRICTED'))
);
```

Indexes:

```sql
CREATE INDEX idx_evidence_case
ON case_evidences (tenant_id, case_id, received_at DESC, id DESC);

CREATE INDEX idx_evidence_hash
ON case_evidences (tenant_id, content_hash);
```

Evidence access must be authorized and audited.

---

## 12. Evidence Chain of Custody

```sql
CREATE TABLE evidence_custody_events (
    tenant_id UUID NOT NULL,
    id UUID NOT NULL,
    evidence_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    actor_id UUID NOT NULL,
    event_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes TEXT,

    PRIMARY KEY (tenant_id, id),

    FOREIGN KEY (tenant_id, evidence_id)
        REFERENCES case_evidences (tenant_id, id),

    FOREIGN KEY (tenant_id, actor_id)
        REFERENCES users (tenant_id, id),

    CHECK (event_type IN ('RECEIVED', 'VIEWED', 'TRANSFERRED', 'REDACTED', 'ARCHIVED'))
);
```

For restricted evidence, even reads may be security audit events.

---

## 13. Notes vs Audit

Case notes are domain/user content.

```sql
CREATE TABLE case_notes (
    tenant_id UUID NOT NULL,
    id UUID NOT NULL,
    case_id UUID NOT NULL,
    note_text TEXT NOT NULL,
    visibility TEXT NOT NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,

    PRIMARY KEY (tenant_id, id),

    FOREIGN KEY (tenant_id, case_id)
        REFERENCES cases (tenant_id, id),

    FOREIGN KEY (tenant_id, created_by)
        REFERENCES users (tenant_id, id),

    CHECK (visibility IN ('INTERNAL', 'SUPERVISOR_ONLY', 'AUDIT_ONLY'))
);
```

Audit events are technical/security/domain trace.

Do not confuse note with audit.

---

## 14. SLA Rules

Effective-dated SLA rules:

```sql
CREATE TABLE sla_rules (
    id UUID PRIMARY KEY,
    jurisdiction_code TEXT NOT NULL,
    case_type_code TEXT NOT NULL,
    priority_code TEXT NOT NULL,
    business_days INTEGER NOT NULL,
    calendar_id TEXT NOT NULL,
    valid_from DATE NOT NULL,
    valid_to DATE,
    rule_version TEXT NOT NULL,

    CHECK (business_days > 0),
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);
```

Business calendar:

```sql
CREATE TABLE business_calendar_days (
    calendar_id TEXT NOT NULL,
    calendar_date DATE NOT NULL,
    is_business_day BOOLEAN NOT NULL,
    holiday_name TEXT,

    PRIMARY KEY (calendar_id, calendar_date)
);
```

Historical correctness requires storing rule used at calculation time.

---

## 15. Case SLA Obligations

```sql
CREATE TABLE case_sla_obligations (
    tenant_id UUID NOT NULL,
    id UUID NOT NULL,
    case_id UUID NOT NULL,
    sla_type TEXT NOT NULL,
    rule_id UUID NOT NULL REFERENCES sla_rules(id),
    rule_version TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    due_local_date DATE NOT NULL,
    timezone TEXT NOT NULL,
    calendar_id TEXT NOT NULL,
    status TEXT NOT NULL,
    completed_at TIMESTAMPTZ,
    paused_duration_seconds BIGINT NOT NULL DEFAULT 0,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    calculation_inputs JSONB NOT NULL,

    PRIMARY KEY (tenant_id, id),

    FOREIGN KEY (tenant_id, case_id)
        REFERENCES cases (tenant_id, id),

    CHECK (due_at > started_at),
    CHECK (status IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'BREACHED'))
);
```

This can answer:

```text
why this due date?
which rule?
which calendar?
what timezone?
what inputs?
```

---

## 16. SLA Events

```sql
CREATE TABLE case_sla_events (
    tenant_id UUID NOT NULL,
    id UUID NOT NULL,
    sla_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    event_at TIMESTAMPTZ NOT NULL,
    actor_id UUID,
    reason TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),

    FOREIGN KEY (tenant_id, sla_id)
        REFERENCES case_sla_obligations (tenant_id, id),

    CHECK (event_type IN ('STARTED', 'PAUSED', 'RESUMED', 'COMPLETED', 'BREACHED', 'CANCELLED'))
);
```

Use events to explain SLA lifecycle.

---

## 17. Decision and Versioning

Decision table:

```sql
CREATE TABLE case_decisions (
    tenant_id UUID NOT NULL,
    id UUID NOT NULL,
    case_id UUID NOT NULL,
    status TEXT NOT NULL,
    current_version INTEGER NOT NULL,
    issued_at TIMESTAMPTZ,
    issued_by UUID,

    PRIMARY KEY (tenant_id, id),

    FOREIGN KEY (tenant_id, case_id)
        REFERENCES cases (tenant_id, id),

    FOREIGN KEY (tenant_id, issued_by)
        REFERENCES users (tenant_id, id),

    CHECK (status IN ('DRAFT', 'UNDER_APPROVAL', 'ISSUED', 'AMENDED', 'REVOKED'))
);
```

Version table:

```sql
CREATE TABLE case_decision_versions (
    tenant_id UUID NOT NULL,
    decision_id UUID NOT NULL,
    version INTEGER NOT NULL,
    decision_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID NOT NULL,
    effective_at TIMESTAMPTZ,
    reason TEXT,
    content_hash TEXT NOT NULL,

    PRIMARY KEY (tenant_id, decision_id, version),

    FOREIGN KEY (tenant_id, decision_id)
        REFERENCES case_decisions (tenant_id, id),

    FOREIGN KEY (tenant_id, created_by)
        REFERENCES users (tenant_id, id)
);
```

Never overwrite issued decision text destructively.

---

## 18. Approval Workflow

```sql
CREATE TABLE approval_requests (
    tenant_id UUID NOT NULL,
    id UUID NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    requested_by UUID NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL,

    PRIMARY KEY (tenant_id, id),

    FOREIGN KEY (tenant_id, requested_by)
        REFERENCES users (tenant_id, id),

    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'))
);
```

Actions:

```sql
CREATE TABLE approval_actions (
    tenant_id UUID NOT NULL,
    id UUID NOT NULL,
    approval_request_id UUID NOT NULL,
    action TEXT NOT NULL,
    actor_id UUID NOT NULL,
    action_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    comment TEXT,

    PRIMARY KEY (tenant_id, id),

    FOREIGN KEY (tenant_id, approval_request_id)
        REFERENCES approval_requests (tenant_id, id),

    FOREIGN KEY (tenant_id, actor_id)
        REFERENCES users (tenant_id, id),

    CHECK (action IN ('APPROVED', 'REJECTED', 'CANCELLED'))
);
```

Application enforces:

```text
requester cannot approve own request
actor must have permission
only pending request can be approved
```

DB can support with constraints and guarded updates.

---

## 19. Timeline Read Model

Business timeline:

```sql
CREATE TABLE case_timeline_events (
    tenant_id UUID NOT NULL,
    id UUID NOT NULL,
    case_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    event_at TIMESTAMPTZ NOT NULL,
    actor_id UUID,
    title TEXT NOT NULL,
    description TEXT,
    payload JSONB NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),

    FOREIGN KEY (tenant_id, case_id)
        REFERENCES cases (tenant_id, id)
);
```

Index:

```sql
CREATE INDEX idx_case_timeline
ON case_timeline_events (tenant_id, case_id, event_at, id);
```

This is user-facing domain timeline, not raw technical audit.

---

## 20. Technical Audit Events

```sql
CREATE TABLE audit_events (
    tenant_id UUID NOT NULL,
    id UUID NOT NULL,
    actor_id UUID,
    actor_type TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    request_id TEXT,
    source_ip TEXT,
    old_values JSONB,
    new_values JSONB,
    metadata JSONB NOT NULL,

    PRIMARY KEY (tenant_id, id),

    CHECK (actor_type IN ('USER', 'SYSTEM', 'SERVICE'))
);
```

Partition by occurred_at for large scale.

Indexes:

```sql
CREATE INDEX idx_audit_entity_time
ON audit_events (tenant_id, entity_type, entity_id, occurred_at DESC, id DESC);

CREATE INDEX idx_audit_actor_time
ON audit_events (tenant_id, actor_id, occurred_at DESC, id DESC);
```

Audit retention/legal hold must be defined.

---

## 21. Outbox

```sql
CREATE TABLE outbox_events (
    tenant_id UUID NOT NULL,
    id UUID NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    event_version INTEGER NOT NULL,
    payload JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    publish_attempts INTEGER NOT NULL DEFAULT 0,
    last_publish_error TEXT,

    PRIMARY KEY (tenant_id, id)
);
```

Index:

```sql
CREATE INDEX idx_outbox_unpublished
ON outbox_events (created_at, id)
WHERE published_at IS NULL;
```

Publisher uses batch claim and idempotent publish.

---

## 22. Inbox

```sql
CREATE TABLE inbox_events (
    tenant_id UUID NOT NULL,
    source_system TEXT NOT NULL,
    source_event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    processing_status TEXT NOT NULL,

    PRIMARY KEY (tenant_id, source_system, source_event_id),

    CHECK (processing_status IN ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED'))
);
```

This prevents duplicate external event processing.

---

## 23. Import Staging

For external agency case import:

```sql
CREATE TABLE import_batches (
    tenant_id UUID NOT NULL,
    id UUID NOT NULL,
    source_system TEXT NOT NULL,
    source_file_hash TEXT,
    status TEXT NOT NULL,
    total_rows INTEGER,
    valid_rows INTEGER,
    invalid_rows INTEGER,
    inserted_rows INTEGER,
    updated_rows INTEGER,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    failure_reason TEXT,

    PRIMARY KEY (tenant_id, id)
);
```

Staging:

```sql
CREATE TABLE staging_case_import_rows (
    tenant_id UUID NOT NULL,
    import_batch_id UUID NOT NULL,
    row_number INTEGER NOT NULL,
    raw_payload JSONB NOT NULL,
    source_case_id TEXT,
    case_number_raw TEXT,
    status_raw TEXT,
    opened_at_raw TEXT,
    validation_status TEXT NOT NULL DEFAULT 'PENDING',
    validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,

    PRIMARY KEY (tenant_id, import_batch_id, row_number),

    FOREIGN KEY (tenant_id, import_batch_id)
        REFERENCES import_batches (tenant_id, id)
);
```

Import is staged, validated, reconciled, then applied.

---

## 24. External Identity Map

```sql
CREATE TABLE external_identity_map (
    tenant_id UUID NOT NULL,
    source_system TEXT NOT NULL,
    source_entity_type TEXT NOT NULL,
    source_entity_id TEXT NOT NULL,
    internal_entity_type TEXT NOT NULL,
    internal_entity_id UUID NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (
        tenant_id,
        source_system,
        source_entity_type,
        source_entity_id
    )
);
```

This supports:

- idempotency
- external reconciliation
- source traceability
- duplicate prevention

---

## 25. Reporting Snapshots

Official monthly report:

```sql
CREATE TABLE regulatory_report_snapshots (
    tenant_id UUID NOT NULL,
    id UUID NOT NULL,
    report_type TEXT NOT NULL,
    report_period TEXT NOT NULL,
    metric_version TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    generated_by UUID NOT NULL,
    data JSONB NOT NULL,
    artifact_uri TEXT,
    artifact_hash TEXT,

    PRIMARY KEY (tenant_id, id),

    UNIQUE (tenant_id, report_type, report_period, metric_version),

    FOREIGN KEY (tenant_id, generated_by)
        REFERENCES users (tenant_id, id)
);
```

Official reports should not be live regenerated.

---

## 26. Operational Read Model: Case Queue

For list page:

```sql
CREATE TABLE case_work_queue_read_model (
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    case_number TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    priority_rank INTEGER NOT NULL,
    current_primary_officer_id UUID,
    opened_at TIMESTAMPTZ NOT NULL,
    due_at TIMESTAMPTZ,
    is_overdue BOOLEAN NOT NULL,
    last_event_at TIMESTAMPTZ NOT NULL,

    PRIMARY KEY (tenant_id, case_id)
);
```

Index for queue:

```sql
CREATE INDEX idx_case_queue_by_status_priority
ON case_work_queue_read_model (
    tenant_id,
    status,
    priority_rank,
    due_at,
    opened_at,
    case_id
);
```

This avoids complex joins for frequent list endpoint.

Read model is derived and must be rebuildable/reconciled.

---

## 27. Analytical Fact Tables

Example case lifecycle fact:

```sql
CREATE TABLE fact_case_lifecycle (
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    opened_date DATE NOT NULL,
    closed_date DATE,
    case_type_code TEXT NOT NULL,
    jurisdiction_code TEXT NOT NULL,
    priority TEXT NOT NULL,
    opened_count INTEGER NOT NULL DEFAULT 1,
    closed_count INTEGER NOT NULL DEFAULT 0,
    days_to_close NUMERIC(10,2),
    sla_breached BOOLEAN,

    PRIMARY KEY (tenant_id, case_id)
);
```

Daily snapshot:

```sql
CREATE TABLE fact_case_daily_snapshot (
    tenant_id UUID NOT NULL,
    snapshot_date DATE NOT NULL,
    case_id UUID NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    officer_id UUID,
    age_days INTEGER NOT NULL,
    is_overdue BOOLEAN NOT NULL,

    PRIMARY KEY (tenant_id, snapshot_date, case_id)
);
```

Analytics separated from OLTP.

---

## 28. Security Design

Security layers:

### Database Roles

```text
app_runtime_role: limited DML
app_migration_role: DDL/migrations
reporting_role: SELECT reporting schema
audit_reader_role: SELECT audit
support_role: SELECT masked views
```

### Runtime App

- no superuser
- no schema owner
- no broad delete
- no raw sensitive table access unless required

### RLS

Optional tenant RLS:

```sql
tenant_id = current_setting('app.tenant_id')::uuid
```

with transaction-local setting.

### Views

Support view excludes sensitive fields.

### Exports

Every export audited.

### Evidence

Restricted evidence access logs read events.

Security is layered.

---

## 29. Index Strategy Summary

Critical indexes:

```sql
-- case lookup
CREATE UNIQUE INDEX uq_cases_number
ON cases (tenant_id, case_number_normalized);

-- queue current state
CREATE INDEX idx_cases_status_priority
ON cases (tenant_id, status, priority, opened_at DESC, id DESC);

-- assignments current
CREATE UNIQUE INDEX uq_case_one_active_primary_assignment
ON case_assignments (tenant_id, case_id)
WHERE assignment_role = 'PRIMARY'
  AND valid_to IS NULL;

-- status timeline
CREATE INDEX idx_status_transition_timeline
ON case_status_transitions (tenant_id, case_id, transitioned_at DESC, id DESC);

-- evidence list
CREATE INDEX idx_case_evidence_list
ON case_evidences (tenant_id, case_id, received_at DESC, id DESC);

-- outbox unpublished
CREATE INDEX idx_outbox_unpublished
ON outbox_events (created_at, id)
WHERE published_at IS NULL;
```

Index design follows query shape and invariants.

---

## 30. Transaction Patterns

### Close Case

In one transaction:

1. lock case
2. validate status
3. complete active SLA
4. update cases status/closed_at/version
5. insert status transition
6. insert timeline event
7. insert audit event
8. insert outbox event
9. commit

Do not publish external event before commit.

### Assign Officer

1. lock case
2. close previous active primary assignment
3. insert new assignment
4. update current pointer
5. insert timeline/audit/outbox
6. commit

Partial unique index protects one active primary.

### Issue Decision

1. validate approval
2. insert decision version
3. update decision current version/status
4. transition case
5. timeline/audit/outbox
6. commit

---

## 31. Java Service Boundary

Recommended service design:

```java
@Transactional
public void closeCase(CloseCaseCommand command) {
    CaseRecord caseRecord = caseRepository.lockById(command.tenantId(), command.caseId());

    casePolicy.validateClose(caseRecord, command.actor());

    int updated = caseRepository.closeCaseGuarded(...);
    if (updated != 1) {
        throw new ConcurrentModificationException();
    }

    transitionRepository.insert(...);
    timelineRepository.insert(...);
    auditRepository.insert(...);
    outboxRepository.insert(...);
}
```

Rules:

- command transaction short
- no external HTTP inside transaction
- affected row checked
- exceptions mapped
- idempotency key for retried commands
- all SQL parameterized
- tenant_id always included

---

## 32. Repository Strategy

Use hybrid data access.

### JPA/Hibernate

For small aggregate commands if team prefers ORM.

### jOOQ/MyBatis/JDBC

For:

- case queue query
- timeline query
- report query
- bulk import
- outbox publisher
- reconciliation
- complex analytical queries

Do not force complex reporting through ORM entity graph.

---

## 33. Query Examples

Case detail header:

```sql
SELECT
    c.id,
    c.case_number,
    c.status,
    c.priority,
    c.opened_at,
    c.closed_at,
    u.display_name AS primary_officer_name
FROM cases c
LEFT JOIN users u
  ON u.tenant_id = c.tenant_id
 AND u.id = c.current_primary_officer_id
WHERE c.tenant_id = :tenant_id
  AND c.id = :case_id;
```

Queue page keyset:

```sql
SELECT
    case_id,
    case_number,
    status,
    priority,
    due_at,
    opened_at
FROM case_work_queue_read_model
WHERE tenant_id = :tenant_id
  AND status = :status
  AND (
      :last_due_at IS NULL
      OR due_at > :last_due_at
      OR (due_at = :last_due_at AND case_id > :last_case_id)
  )
ORDER BY due_at ASC, case_id ASC
LIMIT :limit;
```

Timeline:

```sql
SELECT event_at, event_type, title, description, actor_id
FROM case_timeline_events
WHERE tenant_id = :tenant_id
  AND case_id = :case_id
ORDER BY event_at ASC, id ASC;
```

---

## 34. Migration Plan Example: Add Closed Reason

Goal:

```text
closed cases require closed_reason
```

Expand:

```sql
ALTER TABLE cases ADD COLUMN closed_reason TEXT;
```

Deploy app:

- writes closed_reason when closing
- reads nullable

Backfill:

```sql
UPDATE cases
SET closed_reason = 'UNKNOWN_LEGACY'
WHERE status = 'CLOSED'
  AND closed_reason IS NULL;
```

Validate:

```sql
SELECT COUNT(*)
FROM cases
WHERE status = 'CLOSED'
  AND closed_reason IS NULL;
```

Enforce:

```sql
ALTER TABLE cases
ADD CONSTRAINT ck_cases_closed_reason_required
CHECK (status <> 'CLOSED' OR closed_reason IS NOT NULL) NOT VALID;
```

Validate constraint.

Contract:

- remove fallback
- improve old values if needed

---

## 35. Bulk Import Workflow

External agency import:

1. create import batch
2. load file to staging
3. parse/normalize
4. validate shape
5. validate references
6. detect duplicates
7. generate reject report
8. insert/update target set-based
9. insert external identity map
10. reconcile counts
11. mark batch applied
12. audit import

Never import directly row-by-row into `cases`.

---

## 36. Reconciliation

Read model reconciliation:

```sql
SELECT COUNT(*)
FROM cases
WHERE tenant_id = :tenant_id
  AND status IN ('OPEN', 'UNDER_REVIEW');
```

Compare with:

```sql
SELECT COUNT(*)
FROM case_work_queue_read_model
WHERE tenant_id = :tenant_id
  AND status IN ('OPEN', 'UNDER_REVIEW');
```

External reconciliation:

```sql
SELECT source_case_id
FROM staging_source_case_ids
EXCEPT
SELECT source_entity_id
FROM external_identity_map
WHERE tenant_id = :tenant_id
  AND source_system = :source_system
  AND source_entity_type = 'CASE';
```

Reconciliation is production correctness monitoring.

---

## 37. Partitioning Strategy

Partition high-volume append-only tables by time:

- `audit_events`
- `outbox_events`
- `case_timeline_events` if huge
- import staging/history
- analytical snapshots

Example:

```text
audit_events_2026_01
audit_events_2026_02
...
```

Benefits:

- retention
- archive
- smaller indexes
- maintenance

Do not partition small OLTP tables prematurely.

---

## 38. Backup, Restore, and DR

Requirements:

```text
RPO: e.g. 5 minutes
RTO: e.g. 1 hour
PITR: at least 7/30 days depending policy
restore drill: monthly/quarterly
backup encryption: required
backup access audit: required
```

Runbooks:

- accidental delete
- bad migration
- failed primary
- restore to point-in-time
- replica failover
- disk full

Backup is not real until restore tested.

---

## 39. Observability

Application metrics:

- query duration by query name
- transaction duration
- pool active/idle/pending
- DB errors by SQLState
- deadlock/serialization retry count
- rows returned/affected
- outbox lag
- import/export job progress

Database metrics:

- top queries
- locks/blockers
- deadlocks
- CPU/IO
- replication lag
- disk growth
- vacuum/purge
- bloat
- backup status
- partition sizes

Use query comments:

```sql
/* app=case-service query=CaseQueue.findPage */
```

No PII in comments/logs.

---

## 40. Reporting Design

Operational reports:

- from read model/materialized views
- near real-time
- freshness displayed

Official regulatory reports:

- generated from consistent snapshot/fact tables
- stored in `regulatory_report_snapshots`
- metric version recorded
- artifact hash stored
- amendment workflow supported

Analytics:

- warehouse/data mart
- fact tables
- dimensions
- daily snapshots
- late-arriving correction policy

Do not let BI run arbitrary heavy query on OLTP primary.

---

## 41. Scaling Strategy

Initial:

- single primary database
- good schema/indexes
- connection pool discipline
- read models for hot lists
- async jobs for imports/exports
- outbox for integrations

As grows:

- read replica for reports/exports
- partition audit/outbox/history
- warehouse for analytics
- tenant-aware metrics
- dedicated resources for large tenants
- possibly tenant sharding/dedicated DB for huge tenants

Do not shard before query/schema/ops maturity.

---

## 42. Security and Privacy Lifecycle

PII/sensitive data:

- classify columns
- separate sensitive tables
- restrict grants
- mask support views
- audit access to restricted evidence
- encrypt specific secrets/fields if required
- retention/legal hold
- redaction workflow
- propagate redaction to read models/search/exports
- secure backups

Security review for every new table/read model/export.

---

## 43. Testing Strategy

Use real database via Testcontainers/integration env.

Test:

- migrations from previous schema
- constraints
- tenant composite FKs
- status transition transaction
- one active primary assignment race
- idempotency duplicate command
- outbox insertion in same transaction
- rollback behavior
- query plans for critical queries
- RLS if enabled
- exception mapping by constraint name
- import validation/reconciliation
- report snapshot immutability
- restore drill outside unit tests

Unit tests alone are insufficient.

---

## 44. Failure Modes and Mitigations

### Missing Tenant Filter

Mitigation:

- composite FKs
- query tests
- RLS defense-in-depth
- code review

### Double Assignment

Mitigation:

- partial unique active primary
- transaction lock
- reconciliation check

### Duplicate External Import

Mitigation:

- inbox/external identity map
- file hash/source event ID

### Lost Update

Mitigation:

- version column
- guarded update
- row lock

### Report Changed After Submission

Mitigation:

- snapshot with metric version

### Evidence Access Leak

Mitigation:

- grants/views
- app authorization
- audit read events
- masking/redaction

### Outbox Publisher Duplicate

Mitigation:

- idempotent consumers
- published_at/update with retry
- event IDs

---

## 45. Code Review Checklist for This System

```text
[ ] Does every tenant-scoped query include tenant_id?
[ ] Does every child FK include tenant_id?
[ ] Is the transaction boundary short?
[ ] Is transition guarded by current state?
[ ] Is affected row count checked?
[ ] Are critical invariants enforced in DB?
[ ] Are sensitive columns avoided in SELECT?
[ ] Are list queries bounded and deterministic?
[ ] Is pagination keyset where needed?
[ ] Does new query have index support?
[ ] Does migration use expand-contract if breaking?
[ ] Is audit/timeline/outbox written atomically?
[ ] Are reports snapshotted if official?
[ ] Are imports staged and reconciled?
[ ] Are logs free of PII?
[ ] Is error mapping domain-friendly?
```

---

## 46. Operational Runbooks to Maintain

At minimum:

```text
slow query incident
lock storm
deadlock spike
connection pool exhaustion
failed migration
bad data import
stuck outbox publisher
replica lag
disk growth/disk full
backup restore
accidental delete
RLS/access incident
partition maintenance failure
report correction/amendment
```

Each runbook needs owner, dashboard, steps, and escalation.

---

## 47. What Top Engineers Notice

A top-tier engineer sees more than tables.

They notice:

```text
This table has unclear grain.
This invariant is app-only and race-prone.
This status has no history.
This query paginates joined rows.
This index does not match ORDER BY.
This migration breaks rollback.
This export bypasses masking.
This report has no metric version.
This read model has no reconciliation.
This transaction calls external service.
This tenant FK is incomplete.
This audit table cannot be retained safely.
This backup has never been restored.
```

SQL mastery is attention to failure modes.

---

## 48. End-to-End Flow: Close Case

Final example.

User closes case.

### Step 1: API request

```text
POST /cases/{caseId}/close
Idempotency-Key: close-123
```

### Step 2: App validates command shape

- actor authenticated
- tenant known
- reason provided
- idempotency key present

### Step 3: Transaction

- insert/check idempotency command
- lock case
- validate permission
- validate status transition
- update `cases`
- complete SLA
- insert transition
- insert timeline
- insert audit
- insert outbox
- commit

### Step 4: After commit

- outbox publisher emits `CaseClosed`
- read model projection updates queue
- warehouse eventually updates facts
- official reports use snapshot policy

### Step 5: Observability

- query durations logged by name
- affected rows checked
- outbox lag monitored
- audit available
- command idempotent

This flow combines the whole series.

---

## 49. End-to-End Flow: Monthly Regulatory Report

1. Reporting job starts with metric version.
2. Reads from fact/snapshot tables using defined period/timezone.
3. Computes metrics with known numerator/denominator.
4. Validates row counts and reconciliation checks.
5. Stores report snapshot and artifact hash.
6. Audits generation.
7. Exports encrypted artifact.
8. If late correction arrives, amendment workflow creates new snapshot/version.

Live OLTP data is not the official report.

---

## 50. End-to-End Flow: External Agency Import

1. Receive file.
2. Create import batch.
3. Store file hash.
4. Load to staging.
5. Validate shape/reference/business rules.
6. Produce reject rows.
7. Deduplicate by source ID.
8. Apply valid rows set-based.
9. Insert external identity mappings.
10. Reconcile counts.
11. Mark batch applied.
12. Emit outbox event.
13. Audit import.

No direct blind upsert.

---

## 51. Final Master Checklist

For any serious SQL-backed system, ask:

```text
[ ] What are the core facts?
[ ] What is the grain of each table?
[ ] What invariants must never break?
[ ] Which invariants are database-enforced?
[ ] What is current state vs history?
[ ] What are temporal semantics?
[ ] What data is sensitive?
[ ] How is tenant isolation enforced?
[ ] What are critical query shapes?
[ ] What indexes support them?
[ ] What transactions must be atomic?
[ ] What commands need idempotency?
[ ] What events need outbox/inbox?
[ ] What read models are derived?
[ ] How are read models reconciled?
[ ] What reports are official snapshots?
[ ] How are migrations safely deployed?
[ ] How are imports/exports controlled?
[ ] What tables need partition/retention?
[ ] What observability exists?
[ ] Can backup be restored within RTO?
```

This checklist is the mindset of the whole series.

---

## 52. Rekomendasi Lanjutan Setelah Seri Ini

Seri SQL selesai, tetapi mastery berlanjut.

Rekomendasi materi lanjutan:

### 52.1 PostgreSQL Deep Dive

- MVCC internals
- vacuum/autovacuum
- planner statistics
- GIN/GiST/BRIN
- partitioning
- WAL/PITR
- replication
- extensions
- PostGIS
- pg_stat_statements
- performance tuning

### 52.2 Transaction Processing

- serializability theory
- snapshot isolation anomalies
- SSI
- distributed transactions
- sagas
- outbox/inbox
- concurrency testing

### 52.3 Data Modelling for Enterprise Systems

- temporal modelling
- bitemporal data
- audit design
- event sourcing
- workflow/state-machine modelling
- regulatory records

### 52.4 Data Engineering

- warehouse modelling
- dbt-style transformations
- CDC
- data quality
- lineage
- reconciliation
- lakehouse/OLAP engines

### 52.5 Database Reliability Engineering

- backup/restore drills
- HA/failover
- incident response
- capacity planning
- migrations at scale
- observability

### 52.6 Java Persistence Mastery

- Hibernate internals
- jOOQ advanced SQL
- JDBC driver behavior
- connection pool tuning
- transaction management
- Testcontainers integration

---

## 53. Ringkasan Capstone

Dalam capstone ini kita mendesain regulatory case management database dengan:

1. Tenant-scoped schema and composite FKs.
2. Current case state plus append-only transition history.
3. Explicit state machine reference tables.
4. Assignment history with one active primary invariant.
5. Evidence metadata and chain of custody.
6. SLA rules with effective dating and calculation traceability.
7. Decision versioning instead of destructive overwrite.
8. Approval workflow tables.
9. Domain timeline separate from technical audit.
10. Technical audit events with partitioning/retention plan.
11. Outbox/inbox for reliable integration.
12. Import staging and external identity mapping.
13. Official report snapshots with metric version.
14. Queue read model for operational list performance.
15. Analytical facts/snapshots for reporting.
16. Least privilege, RLS option, sensitive data separation, export audit.
17. Indexes based on query shape and invariants.
18. Transaction patterns for close/assign/issue flows.
19. Java repository/service boundary discipline.
20. Migration, import, reconciliation, partitioning, backup, and observability strategies.

Kalimat penutup:

> Database production yang baik adalah kombinasi dari model fakta yang benar, invariant yang ditegakkan, query yang terukur, transaksi yang aman, history yang bisa diaudit, akses yang dibatasi, perubahan yang kompatibel, dan operasi yang bisa dipulihkan.

---

## 54. Status Seri

Seri **SQL Mastery for Java Engineers** sudah selesai.

Semua bagian selesai:

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
- `learn-sql-mastery-for-java-engineers-part-029.md`
- `learn-sql-mastery-for-java-engineers-part-030.md`
- `learn-sql-mastery-for-java-engineers-part-031.md`
- `learn-sql-mastery-for-java-engineers-part-032.md`
- `learn-sql-mastery-for-java-engineers-part-033.md`
- `learn-sql-mastery-for-java-engineers-part-034.md`

Tidak ada bagian berikutnya.

---

## 55. Referensi

1. PostgreSQL Documentation.  
   https://www.postgresql.org/docs/current/

2. Jakarta Persistence Specification.  
   https://jakarta.ee/specifications/persistence/

3. Spring Framework Data Access Documentation.  
   https://docs.spring.io/spring-framework/reference/data-access.html

4. Flyway Documentation.  
   https://documentation.red-gate.com/fd

5. Liquibase Documentation.  
   https://docs.liquibase.com/

6. OWASP SQL Injection Prevention Cheat Sheet.  
   https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html

7. Martin Fowler — Evolutionary Database Design.  
   https://martinfowler.com/articles/evodb.html

8. Martin Fowler — Event Sourcing.  
   https://martinfowler.com/eaaDev/EventSourcing.html

9. Martin Fowler — CQRS.  
   https://martinfowler.com/bliki/CQRS.html

10. Kimball Group — Dimensional Modeling Techniques.  
    https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/

11. Martin Kleppmann — Designing Data-Intensive Applications.  
    https://dataintensive.net/

12. Vlad Mihalcea — High-Performance Java Persistence.  
    https://vladmihalcea.com/books/high-performance-java-persistence/

---

# Selesai

Selamat. Kamu telah menyelesaikan seri:

```text
SQL Mastery for Java Engineers
```

Jika materi ini dipelajari, dipraktikkan, dan digunakan untuk code review/design review, kamu tidak hanya akan “bisa SQL”, tetapi akan mampu mendesain, mengoptimalkan, mengamankan, mengubah, dan mengoperasikan database production dengan mental model engineer senior.
