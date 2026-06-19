# learn-sql-mastery-for-java-engineers-part-014.md

# Part 14 — Advanced Modelling: State Machines, Workflows, and Regulatory Case Data

> Seri: SQL Mastery for Java Engineers  
> Bagian: 014 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-013.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-015.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas schema design dan normalization secara umum.

Bagian ini menerapkan prinsip itu ke modelling yang lebih sulit dan realistis:

```text
state machines
workflow
assignment lifecycle
approval
decision
SLA
audit trail
temporal truth
regulatory case data
```

Topik ini penting karena banyak aplikasi enterprise tidak hanya menyimpan entity sederhana.

Mereka menyimpan proses:

- case masuk
- case divalidasi
- case ditugaskan
- evidence diterima
- review dilakukan
- decision dibuat
- approval diminta
- SLA dihitung
- escalation terjadi
- case ditutup
- audit harus bisa menjelaskan semuanya

Kesalahan umum:

- semua workflow disimpan sebagai satu kolom `status`
- semua approval disimpan sebagai boolean
- history tidak lengkap
- current state dan event history tidak konsisten
- assignment hanya `assigned_user_id` di table utama
- SLA hanya `due_date` tanpa calendar/rule version
- decision overwrite tanpa versioning
- audit hanya `updated_at`
- JSON menyimpan core workflow
- schema terlalu generic dan kehilangan domain
- schema terlalu rigid dan tidak bisa evolve

Bagian ini membantu kamu mendesain data model yang:

- menjaga current state
- menyimpan history
- mendukung query operasional
- mendukung audit/regulatory review
- aman terhadap concurrency
- tidak berubah menjadi spaghetti schema
- tetap bisa diakses dari Java service secara masuk akal

Kalimat inti:

> Workflow data bukan hanya “status sekarang”; workflow data adalah jejak fakta yang harus menjelaskan bagaimana sistem sampai ke status sekarang.

---

## 1. State vs Event vs Command

Sebelum modelling, bedakan tiga konsep.

### 1.1 State

State adalah kondisi saat ini.

Contoh:

```text
case.status = UNDER_REVIEW
case.priority = HIGH
assignment.ended_at IS NULL
decision.status = APPROVED
```

State bagus untuk query operasional:

```sql
SELECT *
FROM cases
WHERE status = 'UNDER_REVIEW';
```

### 1.2 Event

Event adalah fakta bahwa sesuatu terjadi pada waktu tertentu.

Contoh:

```text
CASE_OPENED
CASE_ASSIGNED
CASE_ESCALATED
EVIDENCE_RECEIVED
DECISION_APPROVED
SLA_BREACHED
```

Event bagus untuk:

- audit
- history
- temporal analysis
- replay
- debugging
- compliance
- outbox/integration

### 1.3 Command

Command adalah permintaan melakukan perubahan.

Contoh:

```text
OpenCase
AssignCase
EscalateCase
ApproveDecision
CloseCase
```

Command bisa berhasil atau gagal.

Database biasanya menyimpan state dan event. Command kadang disimpan untuk idempotency/audit.

---

## 2. Current State + History Pattern

Pattern yang sangat umum:

```text
current_state_table
history/event_table
```

Contoh:

```sql
cases (
    id,
    tenant_id,
    status,
    priority,
    opened_at,
    closed_at
)

case_status_transitions (
    id,
    tenant_id,
    case_id,
    from_status,
    to_status,
    transitioned_at,
    transitioned_by,
    reason
)
```

### 2.1 Mengapa Tidak Hanya State?

Jika hanya punya:

```sql
cases.status
```

Kamu bisa tahu status sekarang, tapi tidak tahu:

- kapan status berubah
- siapa yang mengubah
- alasan
- status sebelumnya
- berapa kali escalated
- apakah pernah reopened
- berapa lama di tiap status
- apakah SLA breach terjadi sebelum closed
- apakah transition valid

### 2.2 Mengapa Tidak Hanya Event?

Jika hanya punya event:

```sql
case_events
```

Untuk query current open cases, kamu harus reconstruct state dari event. Ini bisa mahal dan kompleks.

Hybrid sering paling praktis:

- current table untuk read/write workflow cepat
- event/history table untuk audit/analytics

---

## 3. State Machine Modelling

State machine terdiri dari:

```text
states
transitions
rules
guards
side effects
```

Contoh states:

```text
OPEN
UNDER_REVIEW
ESCALATED
PENDING_DECISION
CLOSED
CANCELLED
```

Allowed transitions:

```text
OPEN -> UNDER_REVIEW
UNDER_REVIEW -> ESCALATED
UNDER_REVIEW -> PENDING_DECISION
ESCALATED -> PENDING_DECISION
PENDING_DECISION -> CLOSED
OPEN -> CANCELLED
```

### 3.1 Simple Current State Column

```sql
status TEXT NOT NULL
CHECK (status IN (
    'OPEN',
    'UNDER_REVIEW',
    'ESCALATED',
    'PENDING_DECISION',
    'CLOSED',
    'CANCELLED'
))
```

Good for current state.

But it does not enforce allowed transitions.

### 3.2 Allowed Transition Table

```sql
CREATE TABLE case_statuses (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    terminal BOOLEAN NOT NULL,
    sort_order INTEGER NOT NULL UNIQUE
);

CREATE TABLE allowed_case_status_transitions (
    from_status TEXT NOT NULL REFERENCES case_statuses(code),
    to_status TEXT NOT NULL REFERENCES case_statuses(code),
    requires_reason BOOLEAN NOT NULL DEFAULT FALSE,
    requires_approval BOOLEAN NOT NULL DEFAULT FALSE,

    PRIMARY KEY (from_status, to_status)
);
```

This makes transition rules data-driven.

### 3.3 Transition History Table

```sql
CREATE TABLE case_status_transitions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    transitioned_at TIMESTAMPTZ NOT NULL,
    transitioned_by UUID NOT NULL,
    reason TEXT,

    FOREIGN KEY (tenant_id, case_id)
        REFERENCES cases (tenant_id, id),

    FOREIGN KEY (from_status, to_status)
        REFERENCES allowed_case_status_transitions (from_status, to_status),

    CHECK (from_status <> to_status)
);
```

Now only allowed transition pairs can be inserted.

But current table update still needs to be coordinated.

---

## 4. Guarded State Transition

A safe transition should:

1. read current state
2. verify allowed transition
3. update current state
4. insert transition history
5. insert audit/outbox if needed
6. commit atomically

PostgreSQL-style concept:

```sql
WITH current_case AS (
    SELECT
        id,
        tenant_id,
        status AS from_status
    FROM cases
    WHERE id = :case_id
      AND tenant_id = :tenant_id
),
allowed AS (
    SELECT
        cc.id,
        cc.tenant_id,
        cc.from_status
    FROM current_case cc
    JOIN allowed_case_status_transitions ast
      ON ast.from_status = cc.from_status
     AND ast.to_status = :to_status
),
updated AS (
    UPDATE cases c
    SET
        status = :to_status,
        version = version + 1
    FROM allowed a
    WHERE c.id = a.id
      AND c.tenant_id = a.tenant_id
      AND c.status = a.from_status
    RETURNING c.id, c.tenant_id, a.from_status
)
INSERT INTO case_status_transitions (
    id,
    tenant_id,
    case_id,
    from_status,
    to_status,
    transitioned_at,
    transitioned_by,
    reason
)
SELECT
    :transition_id,
    tenant_id,
    id,
    from_status,
    :to_status,
    :transitioned_at,
    :user_id,
    :reason
FROM updated;
```

Then application checks inserted row count.

If 0:

- case not found
- transition not allowed
- concurrent state change happened

In many production systems, this logic is easier to implement with `SELECT ... FOR UPDATE` plus explicit application validation inside transaction.

---

## 5. State Machine: Database vs Application

Where should transition rules live?

### 5.1 In Application

Pros:

- expressive
- easy to test in Java
- can involve complex policy
- integrates authorization/context
- easier refactor

Cons:

- multiple writers can bypass
- harder for SQL/manual/batch writes
- race unless guarded by DB conditions
- drift across services

### 5.2 In Database Tables/Constraints

Pros:

- central rule
- inspectable
- can FK transition history
- useful for reporting/admin
- all writers see same allowed transition set

Cons:

- cannot express all guards
- may become too generic
- changes require data governance
- application still needs UX validation

### 5.3 Practical Hybrid

Use database for:

- valid status values
- allowed transition pairs
- transition history integrity
- uniqueness/idempotency
- current state constraints

Use application for:

- authorization
- contextual guards
- workflow orchestration
- user-facing errors
- external policy checks
- side effect orchestration

---

## 6. Workflow Modelling

Workflow is broader than state machine.

A workflow may include:

- tasks
- assignees
- approvals
- deadlines
- comments
- documents
- decisions
- escalations
- rework loops
- parallel steps
- delegation
- role-based permissions

A single `status` column may not represent all of this.

### 6.1 Workflow Instance

```sql
CREATE TABLE workflow_instances (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    workflow_type TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,

    FOREIGN KEY (tenant_id, case_id)
        REFERENCES cases (tenant_id, id),

    CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED', 'FAILED')),
    CHECK (completed_at IS NULL OR completed_at >= started_at)
);
```

### 6.2 Workflow Task

```sql
CREATE TABLE workflow_tasks (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    workflow_instance_id UUID NOT NULL REFERENCES workflow_instances(id),
    task_type TEXT NOT NULL,
    status TEXT NOT NULL,
    assigned_to UUID,
    created_at TIMESTAMPTZ NOT NULL,
    due_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    CHECK (status IN ('OPEN', 'CLAIMED', 'COMPLETED', 'CANCELLED')),
    CHECK (completed_at IS NULL OR completed_at >= created_at)
);
```

This separates:

- case status
- workflow instance status
- task status

They are related but not identical.

---

## 7. Avoid One Giant Status

Bad:

```text
case.status =
OPEN
ASSIGNED
REVIEWING
WAITING_FOR_EVIDENCE
EVIDENCE_RECEIVED
PENDING_APPROVAL
APPROVED
REJECTED
SLA_BREACHED
ESCALATED
CLOSED
```

This may mix:

- lifecycle state
- task state
- event occurrence
- SLA condition
- decision result
- assignment status
- approval status

Better separate dimensions:

```text
case.status
case.priority
workflow_task.status
decision.status
sla.status
assignment active interval
escalation events
```

A giant status field becomes unmaintainable because not all combinations are mutually exclusive.

Example:

```text
A case can be UNDER_REVIEW and SLA_BREACHED and assigned and pending evidence.
```

Those are not one dimension.

---

## 8. Assignment Lifecycle

Naive:

```sql
cases.assigned_officer_id
```

Works only for:

- one current officer
- no history
- no roles
- no multiple assignment
- no reassignment audit

Better:

```sql
CREATE TABLE case_assignments (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    officer_id UUID NOT NULL,
    assignment_role TEXT NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL,
    assigned_by UUID NOT NULL,
    ended_at TIMESTAMPTZ,
    ended_by UUID,
    end_reason TEXT,

    FOREIGN KEY (tenant_id, case_id)
        REFERENCES cases (tenant_id, id),

    CHECK (assignment_role IN ('PRIMARY', 'SUPPORTING', 'REVIEWER')),
    CHECK (ended_at IS NULL OR ended_at > assigned_at),
    CHECK (
        (ended_at IS NULL AND ended_by IS NULL)
        OR
        (ended_at IS NOT NULL AND ended_by IS NOT NULL)
    )
);
```

Conditional uniqueness:

```sql
CREATE UNIQUE INDEX uq_case_assignments_one_active_primary
ON case_assignments (tenant_id, case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

### 8.1 Current Assignment Query

```sql
SELECT
    case_id,
    officer_id
FROM case_assignments
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

### 8.2 Assignment History Query

```sql
SELECT *
FROM case_assignments
WHERE case_id = :case_id
ORDER BY assigned_at;
```

---

## 9. Reassignment Transaction

To reassign primary officer:

1. end existing primary assignment
2. insert new assignment
3. write event/outbox
4. commit

Within transaction:

```sql
UPDATE case_assignments
SET
    ended_at = :reassigned_at,
    ended_by = :user_id,
    end_reason = 'REASSIGNED'
WHERE tenant_id = :tenant_id
  AND case_id = :case_id
  AND assignment_role = 'PRIMARY'
  AND ended_at IS NULL;

INSERT INTO case_assignments (
    id,
    tenant_id,
    case_id,
    officer_id,
    assignment_role,
    assigned_at,
    assigned_by
)
VALUES (
    :assignment_id,
    :tenant_id,
    :case_id,
    :new_officer_id,
    'PRIMARY',
    :reassigned_at,
    :user_id
);
```

The partial unique index protects against two active primary assignments.

Concurrency concern:

If two reassignments happen concurrently, the unique index and row locks matter. You may also lock case row or active assignment row.

---

## 10. Approval Modelling

Naive:

```sql
decision_approved BOOLEAN
approved_by UUID
approved_at TIMESTAMPTZ
```

This supports one approval only.

But many workflows require:

- multiple approval levels
- approve/reject/rework
- comments
- delegation
- approval history
- quorum
- role-based approvals
- current pending approval task

Better:

```sql
CREATE TABLE approval_requests (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    request_type TEXT NOT NULL,
    status TEXT NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL,
    requested_by UUID NOT NULL,
    completed_at TIMESTAMPTZ,

    FOREIGN KEY (tenant_id, case_id)
        REFERENCES cases (tenant_id, id),

    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    CHECK (completed_at IS NULL OR completed_at >= requested_at)
);

CREATE TABLE approval_actions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    approval_request_id UUID NOT NULL REFERENCES approval_requests(id),
    action TEXT NOT NULL,
    acted_by UUID NOT NULL,
    acted_at TIMESTAMPTZ NOT NULL,
    comment TEXT,

    CHECK (action IN ('APPROVE', 'REJECT', 'REQUEST_CHANGES', 'CANCEL'))
);
```

The request has current status; actions preserve history.

---

## 11. Decision Modelling

Decision is often a domain artifact, not just status.

Naive:

```sql
cases.decision_status
cases.decision_text
```

Better:

```sql
CREATE TABLE case_decisions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    decision_type TEXT NOT NULL,
    status TEXT NOT NULL,
    drafted_at TIMESTAMPTZ NOT NULL,
    drafted_by UUID NOT NULL,
    issued_at TIMESTAMPTZ,
    issued_by UUID,
    decision_text TEXT NOT NULL,
    version INTEGER NOT NULL,

    FOREIGN KEY (tenant_id, case_id)
        REFERENCES cases (tenant_id, id),

    CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'VOIDED')),
    CHECK (version > 0),
    CHECK (issued_at IS NULL OR issued_at >= drafted_at)
);
```

If decision revisions matter:

```sql
CREATE TABLE case_decision_versions (
    decision_id UUID NOT NULL,
    version INTEGER NOT NULL,
    decision_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    created_by UUID NOT NULL,

    PRIMARY KEY (decision_id, version)
);
```

Avoid overwriting decision text if legal audit requires historical text.

---

## 12. SLA Modelling

SLA/deadline modelling is often underestimated.

Naive:

```sql
cases.due_date DATE
```

But regulatory SLA may depend on:

- jurisdiction
- case type
- priority
- business days
- holidays
- pause/resume
- rule version
- timezone
- event that started SLA
- extension approval
- breach calculation time

Better:

```sql
CREATE TABLE case_slas (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    sla_type TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    due_local_date DATE NOT NULL,
    timezone TEXT NOT NULL,
    rule_version TEXT NOT NULL,
    calendar_id TEXT NOT NULL,
    completed_at TIMESTAMPTZ,

    FOREIGN KEY (tenant_id, case_id)
        REFERENCES cases (tenant_id, id),

    CHECK (status IN ('ACTIVE', 'COMPLETED', 'BREACHED', 'CANCELLED', 'PAUSED')),
    CHECK (due_at > started_at),
    CHECK (completed_at IS NULL OR completed_at >= started_at)
);
```

This preserves enough information for audit.

---

## 13. SLA Pause/Resume

If SLA can pause:

```sql
CREATE TABLE case_sla_pauses (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    sla_id UUID NOT NULL REFERENCES case_slas(id),
    paused_at TIMESTAMPTZ NOT NULL,
    resumed_at TIMESTAMPTZ,
    reason TEXT NOT NULL,

    CHECK (resumed_at IS NULL OR resumed_at > paused_at)
);
```

Potential invariant:

```text
No overlapping pause intervals per SLA.
```

Requires exclusion constraint/trigger/application lock.

Calculating effective due time becomes more complex. Do not hide this complexity in one nullable `paused_at` column if multiple pauses are possible.

---

## 14. Calendar Modelling

Business days require calendar.

```sql
CREATE TABLE business_calendars (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    timezone TEXT NOT NULL
);

CREATE TABLE business_calendar_days (
    calendar_id TEXT NOT NULL REFERENCES business_calendars(id),
    calendar_date DATE NOT NULL,
    is_business_day BOOLEAN NOT NULL,
    holiday_name TEXT,

    PRIMARY KEY (calendar_id, calendar_date)
);
```

This supports:

- jurisdiction-specific holidays
- business-day SLA
- historical calendar correction
- report reproducibility
- testing

Do not compute all business-day logic ad hoc in Java without storing rule/calendar identity if audit matters.

---

## 15. Escalation Modelling

Escalation can be:

- current state
- event
- workflow task
- SLA consequence
- manual action
- automatic rule result

Naive:

```sql
cases.escalated BOOLEAN
```

This loses:

- when escalated
- why
- by whom
- from what severity
- whether resolved
- repeated escalations
- escalation level

Better:

```sql
CREATE TABLE case_escalations (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    escalation_level TEXT NOT NULL,
    escalated_at TIMESTAMPTZ NOT NULL,
    escalated_by UUID,
    escalation_reason TEXT NOT NULL,
    resolved_at TIMESTAMPTZ,
    resolved_by UUID,
    resolution_note TEXT,

    FOREIGN KEY (tenant_id, case_id)
        REFERENCES cases (tenant_id, id),

    CHECK (escalation_level IN ('LEVEL_1', 'LEVEL_2', 'LEVEL_3')),
    CHECK (resolved_at IS NULL OR resolved_at >= escalated_at)
);
```

If only one active escalation per case/level:

```sql
CREATE UNIQUE INDEX uq_case_escalations_one_active_level
ON case_escalations (tenant_id, case_id, escalation_level)
WHERE resolved_at IS NULL;
```

---

## 16. Evidence and Chain of Custody

Regulatory evidence needs integrity.

Basic evidence table:

```sql
CREATE TABLE case_evidences (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    evidence_type TEXT NOT NULL,
    storage_uri TEXT NOT NULL,
    sha256_hash BYTEA NOT NULL,
    size_bytes BIGINT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    received_by UUID NOT NULL,

    CHECK (size_bytes > 0)
);
```

Chain of custody:

```sql
CREATE TABLE evidence_custody_events (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    evidence_id UUID NOT NULL REFERENCES case_evidences(id),
    event_type TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    actor_id UUID NOT NULL,
    location TEXT,
    note TEXT,

    CHECK (event_type IN ('RECEIVED', 'TRANSFERRED', 'ACCESSED', 'SEALED', 'UNSEALED', 'DISPOSED'))
);
```

This supports audit:

```text
Who had access?
When was evidence transferred?
Was hash stable?
Was evidence sealed?
```

---

## 17. Notes, Comments, and Audit

Notes are domain data.

Audit log is technical record.

Do not confuse:

```sql
case_notes
```

with:

```sql
audit_events
```

Case note:

```text
User intentionally records a comment as part of case process.
```

Audit event:

```text
System records that a row was created/updated/deleted.
```

Both may be required.

Case note table:

```sql
CREATE TABLE case_notes (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    note_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    created_by UUID NOT NULL,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID
);
```

Audit event table:

```sql
CREATE TABLE audit_events (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    actor_id UUID,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    metadata JSONB NOT NULL
);
```

---

## 18. Audit Event Design

Audit event should answer:

```text
Who did what, to which entity, when, from where, and why?
```

Potential schema:

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
    ip_address TEXT,
    user_agent TEXT,
    reason TEXT,
    metadata JSONB NOT NULL,

    CHECK (actor_type IN ('USER', 'SYSTEM', 'SERVICE')),
    CHECK (length(trim(action)) > 0),
    CHECK (length(trim(entity_type)) > 0)
);
```

Consider:

- immutable append-only
- partitioning by time
- retention policy
- PII handling
- tamper evidence
- indexing by entity
- indexing by actor
- correlation id/request id
- timezone
- metadata schema version

---

## 19. Outbox Event Design

Outbox event is integration artifact.

```sql
CREATE TABLE outbox_events (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ,
    publish_attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
);
```

Outbox differs from audit:

- audit is for human/compliance trace
- outbox is for reliable message publication

They can overlap but should not be confused.

Outbox rows are written in same transaction as state change.

Publisher later sends events and marks `published_at`.

---

## 20. Idempotency Command Table

For APIs/messages:

```sql
CREATE TABLE idempotency_keys (
    tenant_id UUID NOT NULL,
    key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    response_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,

    PRIMARY KEY (tenant_id, key),

    CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED'))
);
```

Use cases:

- prevent duplicate command execution
- return same response for retry
- detect same key with different payload
- handle timeout ambiguity

Idempotency modelling is part of database design, not just HTTP middleware.

---

## 21. Versioning Domain Records

Some records should not be overwritten.

Examples:

- decision text
- legal notice
- submitted form
- signed document
- regulatory report
- policy/rule used for calculation

Pattern:

```sql
CREATE TABLE case_decisions (
    id UUID PRIMARY KEY,
    case_id UUID NOT NULL,
    current_version INTEGER NOT NULL
);

CREATE TABLE case_decision_versions (
    decision_id UUID NOT NULL REFERENCES case_decisions(id),
    version INTEGER NOT NULL,
    decision_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    created_by UUID NOT NULL,

    PRIMARY KEY (decision_id, version)
);
```

Versioning gives:

- historical truth
- diff ability
- rollback/reissue
- legal defensibility

---

## 22. Effective-Dated Reference Data

Reference data can change over time.

Example: SLA rule changes.

Bad:

```sql
case_slas.sla_days = 5
```

without knowing which rule produced it.

Better:

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
rule_id UUID NOT NULL REFERENCES sla_rules(id)
```

or at least `rule_version`.

This allows explaining why deadline was calculated that way.

---

## 23. Snapshot vs Reference

Sometimes you should store reference ID.

Sometimes you should snapshot value.

Example:

```sql
case_decisions(
    officer_id,
    officer_name_snapshot
)
```

Why snapshot?

If officer changes name later, decision document may need historical display name at issue time.

Guideline:

- use FK to current entity for relationship
- store snapshot if legal/historical document must preserve value-at-time

Be explicit.

---

## 24. Temporal Truth

There are multiple time concepts:

```text
valid time: when fact is true in domain
transaction time: when database recorded it
event time: when event occurred
processing time: when system processed event
reported time: when external source reported it
```

Example:

```sql
event_occurred_at
reported_at
received_at
recorded_at
```

Do not collapse all into `created_at`.

Regulatory systems often need distinctions.

Example:

```sql
CREATE TABLE external_case_events (
    id UUID PRIMARY KEY,
    source_system TEXT NOT NULL,
    source_event_id TEXT NOT NULL,
    event_occurred_at TIMESTAMPTZ NOT NULL,
    source_reported_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (source_system, source_event_id)
);
```

---

## 25. Corrections and Amendments

Regulatory data often cannot simply be updated.

Instead of overwriting:

```sql
UPDATE case_decisions SET decision_text = ...
```

Use correction/amendment:

```sql
CREATE TABLE case_decision_amendments (
    id UUID PRIMARY KEY,
    decision_id UUID NOT NULL REFERENCES case_decisions(id),
    amendment_number INTEGER NOT NULL,
    amended_at TIMESTAMPTZ NOT NULL,
    amended_by UUID NOT NULL,
    reason TEXT NOT NULL,
    amended_text TEXT NOT NULL,

    UNIQUE (decision_id, amendment_number)
);
```

Or version table.

The right model depends on legal semantics:

- correction replaces previous?
- amendment adds to previous?
- void/reissue?
- visible to external parties?
- audit trail required?

---

## 26. Workflow Task Assignment vs Case Assignment

Do not confuse:

```text
case assigned to officer
```

with:

```text
workflow task assigned to user
```

Case assignment:

```text
responsibility for case
```

Task assignment:

```text
responsibility for a specific step
```

Schema:

```sql
case_assignments(...)
workflow_tasks(...)
workflow_task_assignments(...)
```

A case may have primary officer but a task may be assigned to reviewer.

If collapsed into `cases.assigned_to`, workflow becomes ambiguous.

---

## 27. Queue Modelling

Operational systems often need queues.

Naive:

```sql
cases.queue_name
```

Maybe enough for simple case.

Better if queue membership has history and priority:

```sql
CREATE TABLE case_queue_entries (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    queue_code TEXT NOT NULL,
    entered_at TIMESTAMPTZ NOT NULL,
    exited_at TIMESTAMPTZ,
    priority INTEGER NOT NULL,
    reason TEXT,

    CHECK (exited_at IS NULL OR exited_at >= entered_at)
);
```

Current queue entries:

```sql
WHERE exited_at IS NULL
```

One active queue entry per case/queue:

```sql
CREATE UNIQUE INDEX uq_case_queue_one_active
ON case_queue_entries (tenant_id, case_id, queue_code)
WHERE exited_at IS NULL;
```

---

## 28. Modelling Business Rules as Data

Some rules benefit from tables.

Example escalation rule:

```sql
CREATE TABLE escalation_rules (
    id UUID PRIMARY KEY,
    jurisdiction_code TEXT NOT NULL,
    priority TEXT NOT NULL,
    max_hours_before_escalation INTEGER NOT NULL,
    escalation_level TEXT NOT NULL,
    valid_from DATE NOT NULL,
    valid_to DATE,

    CHECK (max_hours_before_escalation > 0),
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);
```

Benefits:

- audit rule version
- change without code deploy if governed
- report why escalation happened
- test rule data
- compare old/new rules

Risks:

- accidental rule changes
- complex rule engine in SQL
- poor governance
- lack of type safety

Use data-driven rules for stable tabular policy, not arbitrary code logic.

---

## 29. Avoid Over-Generalized Workflow Engine Schema

Generic workflow schema:

```sql
entities
states
transitions
attributes
tasks
variables
```

can become too abstract.

Problems:

- weak typing
- hard queries
- poor constraints
- everything becomes string
- business meaning hidden
- report complexity
- Java code full of casts
- performance unpredictable

A good system may use workflow tables, but core domain facts should remain explicit.

Prefer:

```text
explicit case tables for domain facts
workflow tables for orchestration
event/audit tables for history
```

Do not erase domain into generic metadata too early.

---

## 30. Read Models for Workflow

Complex workflow often needs read models.

Example:

```sql
CREATE TABLE case_work_queue_read_model (
    tenant_id UUID NOT NULL,
    case_id UUID PRIMARY KEY,
    case_number TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    primary_officer_id UUID,
    primary_officer_name TEXT,
    current_task_id UUID,
    current_task_type TEXT,
    sla_due_at TIMESTAMPTZ,
    evidence_count INTEGER NOT NULL,
    last_activity_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
```

This is denormalized.

It is acceptable if:

- source of truth remains normalized
- updates are transactional or eventually consistent by design
- rebuild process exists
- drift monitoring exists
- consumers know freshness semantics

---

## 31. Rebuildable Projections

A read model should ideally be rebuildable.

Sources:

- cases
- assignments
- evidence
- tasks
- transitions
- SLA
- events

Projection table can be rebuilt:

```text
TRUNCATE projection
INSERT SELECT from source of truth
```

or incrementally updated from events.

If read model cannot be rebuilt and is not source of truth, it is risky.

---

## 32. Data Correction Workflow

Production data will need correction.

Design correction workflows:

- who can correct
- what can be corrected
- old value stored?
- reason required?
- approval required?
- effective date?
- notification/outbox?
- audit event?
- external report impact?

Correction table:

```sql
CREATE TABLE data_corrections (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    correction_type TEXT NOT NULL,
    reason TEXT NOT NULL,
    requested_by UUID NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    applied_at TIMESTAMPTZ,
    status TEXT NOT NULL,

    CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'APPLIED', 'CANCELLED'))
);
```

For regulated systems, correction itself is a first-class fact.

---

## 33. Privacy, Redaction, and Retention

Regulatory systems may need retain data and also protect privacy.

Naive:

```sql
UPDATE parties SET legal_name = NULL WHERE id = :id;
```

Need model:

- redaction reason
- redacted_at
- redacted_by
- original stored encrypted elsewhere?
- legal hold?
- retention policy?
- irreversible deletion?
- audit visibility?

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

And current table may store:

```sql
legal_name TEXT,
legal_name_redacted BOOLEAN NOT NULL DEFAULT FALSE
```

This is domain/legal dependent.

---

## 34. Modelling Attachments and Documents

Documents are often not just files.

They may have:

- metadata
- storage location
- hash
- version
- classification
- access policy
- signature
- generated from template
- issued_at
- served_at
- revoked_at

Schema:

```sql
CREATE TABLE documents (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    document_type TEXT NOT NULL,
    status TEXT NOT NULL,
    storage_uri TEXT NOT NULL,
    sha256_hash BYTEA NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    issued_at TIMESTAMPTZ,

    CHECK (status IN ('DRAFT', 'ISSUED', 'REVOKED')),
    CHECK (version > 0)
);

CREATE TABLE case_documents (
    case_id UUID NOT NULL,
    document_id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    relationship_type TEXT NOT NULL,

    PRIMARY KEY (tenant_id, case_id, document_id, relationship_type)
);
```

---

## 35. Modelling Notifications

Notification is not the same as event.

Event:

```text
Case closed.
```

Notification:

```text
Email/SMS/in-app message sent to user about case closure.
```

Schema:

```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    recipient_id UUID NOT NULL,
    channel TEXT NOT NULL,
    notification_type TEXT NOT NULL,
    status TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    failure_reason TEXT,

    CHECK (channel IN ('EMAIL', 'SMS', 'IN_APP')),
    CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'CANCELLED'))
);
```

Do not rely only on external provider logs if notification delivery is part of regulatory proof.

---

## 36. Operational Tables vs Domain Tables

Separate:

```text
domain tables
operational/job tables
integration tables
audit tables
projection/read model tables
```

Examples:

Domain:

```text
cases
case_assignments
case_decisions
```

Operational:

```text
import_batches
job_runs
outbox_events
processed_events
```

Audit:

```text
audit_events
case_status_transitions
```

Projection:

```text
case_work_queue_read_model
```

Clear separation helps reasoning and retention.

---

## 37. Mini Case Study: End-to-End Case Workflow Model

Core tables:

```text
cases
case_status_transitions
case_assignments
workflow_instances
workflow_tasks
case_evidences
case_decisions
approval_requests
case_slas
audit_events
outbox_events
```

The case lifecycle might be:

1. insert `cases`
2. insert `case_status_transitions` OPEN
3. create workflow instance
4. create review task
5. assign primary officer
6. receive evidence
7. create decision draft
8. request approval
9. approve decision
10. issue decision
11. update case status CLOSED
12. insert outbox CASE_CLOSED

Each step writes facts, not just flags.

---

## 38. Mini Case Study: Case Closure Transaction

```sql
BEGIN;

SELECT
    id,
    status
FROM cases
WHERE tenant_id = :tenant_id
  AND id = :case_id
FOR UPDATE;

-- Java validates status and required decision approval

UPDATE cases
SET
    status = 'CLOSED',
    closed_at = :closed_at,
    version = version + 1
WHERE tenant_id = :tenant_id
  AND id = :case_id;

INSERT INTO case_status_transitions (
    id,
    tenant_id,
    case_id,
    from_status,
    to_status,
    transitioned_at,
    transitioned_by,
    reason
)
VALUES (
    :transition_id,
    :tenant_id,
    :case_id,
    :old_status,
    'CLOSED',
    :closed_at,
    :user_id,
    :reason
);

UPDATE workflow_tasks
SET
    status = 'COMPLETED',
    completed_at = :closed_at
WHERE tenant_id = :tenant_id
  AND case_id = :case_id
  AND task_type = 'FINAL_REVIEW'
  AND status IN ('OPEN', 'CLAIMED');

INSERT INTO audit_events (...);

INSERT INTO outbox_events (...);

COMMIT;
```

Review questions:

- what if task update affects 0 rows?
- what if old_status already CLOSED?
- should closure require issued decision?
- should close be idempotent?
- should outbox event include snapshot?
- what locks are held and for how long?

---

## 39. Mini Case Study: SLA Breach Detection

Batch job detects breaches.

```sql
INSERT INTO case_sla_breach_events (
    id,
    tenant_id,
    sla_id,
    case_id,
    breached_at,
    rule_version
)
SELECT
    gen_random_uuid(),
    s.tenant_id,
    s.id,
    s.case_id,
    :detected_at,
    s.rule_version
FROM case_slas s
WHERE s.status = 'ACTIVE'
  AND s.due_at < :detected_at
ON CONFLICT (sla_id)
DO NOTHING;
```

Then update status:

```sql
UPDATE case_slas
SET status = 'BREACHED'
WHERE status = 'ACTIVE'
  AND due_at < :detected_at;
```

Better transaction may combine.

Constraint:

```sql
UNIQUE (sla_id)
```

on breach event if one breach per SLA.

Questions:

- breach time is due_at or detected_at?
- if job runs late, what should breached_at be?
- should status be ACTIVE/BREACHED or computed?
- can SLA be completed after breach?
- should breach event be idempotent?

---

## 40. Mini Case Study: Approval Workflow

Approval request:

```sql
INSERT INTO approval_requests (
    id,
    tenant_id,
    case_id,
    request_type,
    status,
    requested_at,
    requested_by
)
VALUES (
    :approval_request_id,
    :tenant_id,
    :case_id,
    'DECISION_APPROVAL',
    'PENDING',
    now(),
    :user_id
);
```

Approve:

```sql
BEGIN;

UPDATE approval_requests
SET
    status = 'APPROVED',
    completed_at = :approved_at
WHERE id = :approval_request_id
  AND tenant_id = :tenant_id
  AND status = 'PENDING';

-- check affected rows = 1

INSERT INTO approval_actions (
    id,
    tenant_id,
    approval_request_id,
    action,
    acted_by,
    acted_at,
    comment
)
VALUES (
    :action_id,
    :tenant_id,
    :approval_request_id,
    'APPROVE',
    :user_id,
    :approved_at,
    :comment
);

UPDATE case_decisions
SET status = 'APPROVED'
WHERE id = :decision_id
  AND status = 'PENDING_APPROVAL';

INSERT INTO audit_events (...);

COMMIT;
```

Guard every state update.

---

## 41. Design Checklist for Workflow Data

```text
[ ] What is the current state?
[ ] What is the event/history?
[ ] Is this state, event, task, or command?
[ ] Are multiple simultaneous states possible?
[ ] Is one status column mixing dimensions?
[ ] What transitions are allowed?
[ ] What facts need audit?
[ ] What facts need current query speed?
[ ] Which writes must be atomic?
[ ] Which facts are append-only?
[ ] Which facts can be corrected?
[ ] Which facts need versioning?
[ ] What is idempotency key?
[ ] What is external source identity?
[ ] What is valid time vs recorded time?
[ ] What requires legal snapshot?
[ ] What read model is needed?
[ ] Can projection be rebuilt?
```

---

## 42. Schema Smells in Workflow Systems

```text
[ ] one giant status with unrelated meanings
[ ] assigned_user_id without assignment history
[ ] approved boolean without approval action table
[ ] due_date without rule/calendar/timezone
[ ] decision_text overwritten without versioning
[ ] audit only updated_at/updated_by
[ ] events stored as untyped JSON only
[ ] external IDs stored directly on main table despite multiple sources
[ ] retry/idempotency handled only in memory
[ ] workflow engine tables hide all domain facts
[ ] soft delete without audit or uniqueness strategy
[ ] no outbox despite publishing events
[ ] no source-of-truth distinction for read models
```

---

## 43. Practical Exercises

### Exercise 1 — Split Giant Status

Given:

```text
status = WAITING_APPROVAL_AND_SLA_BREACHED
```

Split into:

```text
case.status
approval_request.status
case_sla.status
case_escalations
```

Explain which facts can be true simultaneously.

### Exercise 2 — Model Assignment History

Replace:

```sql
cases.assigned_officer_id
```

with:

```sql
case_assignments(case_id, officer_id, role, assigned_at, ended_at)
```

Add constraint for one active primary assignment.

### Exercise 3 — Model SLA with Audit

Design table that stores:

- due_at
- due_local_date
- timezone
- rule_version
- calendar_id
- status
- completed_at

Explain why each exists.

### Exercise 4 — Approval Actions

Replace:

```sql
approved BOOLEAN,
approved_by,
approved_at
```

with:

```text
approval_requests
approval_actions
```

Explain how rejection/rework is represented.

### Exercise 5 — Outbox

For `CASE_CLOSED`, design outbox row written in same transaction as `cases.status = CLOSED`.

---

## 44. Koneksi ke Part Berikutnya

Bagian ini menyelesaikan blok correctness modelling:

- DML
- constraints
- schema design
- advanced workflow modelling

Part berikutnya, `part-015`, akan masuk ke performance foundation:

- indexes
- B-tree mental model
- selectivity
- cardinality
- access paths
- index scan vs table scan
- composite indexes
- covering indexes
- write overhead

Setelah kamu tahu cara memodelkan data dengan benar, tahap berikutnya adalah membuat query terhadap model itu berjalan efisien.

---

## 45. Ringkasan Bagian Ini

Hal penting dari part 014:

1. Workflow data harus membedakan state, event, dan command.
2. Current state + history adalah pattern praktis untuk sistem audit-heavy.
3. State machine bukan hanya kolom status; perlu allowed transitions dan transition history.
4. Workflow bisa membutuhkan task, approval, SLA, assignment, decision, dan event table.
5. One giant status sering mencampur beberapa dimensi yang seharusnya terpisah.
6. Assignment dengan lifecycle layak menjadi table sendiri.
7. Approval boolean tidak cukup untuk approval workflow serius.
8. Decision/legal artifacts sering perlu versioning.
9. SLA modelling membutuhkan timezone, calendar, rule version, dan pause/resume jika domain memerlukannya.
10. Escalation biasanya event/lifecycle, bukan boolean.
11. Evidence membutuhkan chain-of-custody dan integrity metadata jika regulatory.
12. Audit event berbeda dari business note dan outbox event.
13. Idempotency key adalah bagian dari data model untuk retry-safe systems.
14. Effective-dated reference data membantu menjelaskan keputusan historis.
15. Snapshot value valid jika dokumen/legal truth harus preserve value-at-time.
16. Temporal truth punya valid/event/processing/recorded time yang berbeda.
17. Read models boleh denormalized jika rebuildable dan source of truth jelas.
18. Workflow schema terlalu generic bisa menghapus domain meaning.
19. Correction/redaction/retention perlu first-class modelling dalam regulated systems.
20. Advanced modelling harus selalu kembali ke grain, invariant, history, and query needs.

Kalimat inti:

> Sistem workflow yang baik tidak hanya tahu “status sekarang”; ia dapat membuktikan siapa melakukan apa, kapan, berdasarkan rule apa, dan bagaimana fakta itu memengaruhi state saat ini.

---

## 46. Referensi

1. PostgreSQL Documentation — Constraints.  
   https://www.postgresql.org/docs/current/ddl-constraints.html

2. PostgreSQL Documentation — Range Types.  
   https://www.postgresql.org/docs/current/rangetypes.html

3. PostgreSQL Documentation — Exclusion Constraints.  
   https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-EXCLUSION

4. PostgreSQL Documentation — WITH Queries.  
   https://www.postgresql.org/docs/current/queries-with.html

5. PostgreSQL Documentation — JSON Types.  
   https://www.postgresql.org/docs/current/datatype-json.html

6. Martin Fowler — Temporal Patterns and Event Sourcing articles.  
   https://martinfowler.com/eaaDev/EventSourcing.html  
   https://martinfowler.com/eaaDev/TemporalProperty.html

7. Microsoft SQL Server Documentation — Temporal Tables.  
   https://learn.microsoft.com/en-us/sql/relational-databases/tables/temporal-tables

8. Oracle Database Documentation — Flashback and Temporal Features.  
   https://docs.oracle.com/en/database/oracle/oracle-database/23/adfns/flashback.html

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
- `learn-sql-mastery-for-java-engineers-part-007.md`
- `learn-sql-mastery-for-java-engineers-part-008.md`
- `learn-sql-mastery-for-java-engineers-part-009.md`
- `learn-sql-mastery-for-java-engineers-part-010.md`
- `learn-sql-mastery-for-java-engineers-part-011.md`
- `learn-sql-mastery-for-java-engineers-part-012.md`
- `learn-sql-mastery-for-java-engineers-part-013.md`
- `learn-sql-mastery-for-java-engineers-part-014.md`

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-015.md` — Index Fundamentals: B-Trees, Selectivity, Cardinality, and Access Paths

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-013.md">⬅️ Part 13 — Schema Design and Normalization</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-015.md">Part 15 — Index Fundamentals: B-Trees, Selectivity, Cardinality, and Access Paths ➡️</a>
</div>
