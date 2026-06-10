# Strict General Standards: OLTP Database Design

> This document is a mandatory implementation standard for LLM/code agents designing, modifying, reviewing, or generating OLTP database structures, queries, migrations, repositories, and transaction flows.

---

## 1. Purpose

OLTP database design is about preserving business correctness under concurrent writes, failures, retries, partial execution, and long-term schema evolution.

An LLM/code agent MUST treat the OLTP database as a consistency boundary, not merely a persistence detail.

The goal is to ensure that every generated database change is:

- correct under concurrency;
- explicit about invariants;
- safe to migrate;
- measurable under production load;
- recoverable after failure;
- maintainable over years of schema evolution.

---

## 2. Scope

This standard applies to:

- relational OLTP schema design;
- transaction design;
- constraints;
- indexing;
- isolation level decisions;
- query design;
- migration scripts;
- audit tables;
- soft delete / temporal data;
- optimistic and pessimistic locking;
- repository and DAO implementation;
- service-layer interaction with the database;
- outbox/inbox tables used for reliable integration;
- operational concerns such as backup, restore, vacuum, partitioning, and monitoring.

This standard does not cover analytical dimensional modeling; use `strict-general-standards__olap_database_design.md` for OLAP/data warehouse design.

---

## 3. Core Principle

> OLTP design MUST optimize for correctness of current operational state before query convenience, report convenience, or developer convenience.

A design that is fast but can violate business invariants is invalid.

A design that appears simple but hides cross-row, cross-table, or cross-service consistency assumptions is invalid.

---

## 4. Mandatory Language

The terms below are normative:

- **MUST**: required.
- **MUST NOT**: prohibited.
- **SHOULD**: recommended unless there is documented justification.
- **MAY**: optional, but must not violate mandatory rules.

---

## 5. OLTP vs OLAP Boundary

LLM/code agents MUST identify whether the requested table/query is OLTP or OLAP before implementation.

| Dimension          | OLTP                          | OLAP                                         |
| ------------------ | ----------------------------- | -------------------------------------------- |
| Primary workload   | Short transactions            | Large scans and aggregations                 |
| Data shape         | Normalized operational model  | Dimensional or denormalized analytical model |
| Writes             | Frequent small writes         | Batch/stream ingestion, append-heavy         |
| Query pattern      | Point lookup, small joins     | Aggregation, grouping, time windows          |
| Correctness target | Current invariant correctness | Historical analytical correctness            |
| Latency target     | Low write/read latency        | Large query throughput                       |
| Common schema      | 3NF-ish, aggregate-oriented   | Star/snowflake, wide facts, columnar         |

If a requirement asks for reports, dashboards, trends, historical aggregation, or cross-domain analytics, the LLM MUST NOT overload OLTP tables without first proposing an analytical read model, materialized view, CDC pipeline, or OLAP store.

---

## 6. Required Design Inputs

Before designing an OLTP database change, the LLM/code agent MUST infer or document:

1. Business entity and lifecycle.
2. Business invariants.
3. Write commands.
4. Read paths.
5. Cardinality and expected growth.
6. Transaction boundaries.
7. Concurrency model.
8. Required auditability.
9. Retention and archival rules.
10. Failure and retry behavior.
11. Ownership boundary in a monolith or microservice.

If these are unknown, the implementation MUST include explicit assumptions.

---

## 7. Data Ownership Rule

Every OLTP table MUST have one clear owner:

- one bounded context;
- one application module;
- one microservice; or
- one schema owner.

The owner is responsible for:

- writes;
- invariants;
- lifecycle transitions;
- migrations;
- retention;
- audit semantics;
- public read/write API.

### Prohibited

```text
Multiple services directly writing the same operational table.
```

```text
Shared database tables used as integration contracts between services.
```

```text
Reporting teams mutating OLTP data to satisfy analytics needs.
```

---

## 8. Schema Design Rules

### 8.1 Tables

Tables MUST represent stable business concepts, not UI screens, API response shapes, or temporary implementation convenience.

Good:

```text
case
case_assignment
case_status_history
case_document
```

Bad:

```text
dashboard_case_card
case_page_data
frontend_case_view
```

### 8.2 Primary Keys

Every table MUST have a primary key.

Primary keys SHOULD be:

- immutable;
- meaningless to business users unless the business identifier is truly immutable;
- stable across migrations;
- safe for foreign key references.

Natural keys MAY be used only if:

- the business guarantees immutability;
- format changes are unlikely;
- key reuse is impossible;
- privacy exposure is acceptable.

Otherwise, use surrogate keys and add a unique constraint for the business identifier.

### 8.3 Foreign Keys

Foreign keys SHOULD be used for intra-owner relational integrity.

Foreign keys MUST NOT cross microservice database ownership boundaries.

When foreign keys are intentionally omitted, the design MUST document:

- why DB-level referential integrity is not possible;
- where integrity is enforced;
- how orphan records are detected;
- how repair is performed.

### 8.4 Nullability

Columns MUST be `NOT NULL` unless absence is a real business state.

Nullable columns MUST distinguish:

- unknown;
- not applicable;
- not yet provided;
- intentionally empty;
- deleted/redacted.

If the meaning is ambiguous, use an explicit status/state column or separate table.

### 8.5 Constraints

Business invariants that can be enforced by the database SHOULD be encoded as constraints:

- `NOT NULL`;
- `UNIQUE`;
- `CHECK`;
- `FOREIGN KEY`;
- exclusion constraints where supported;
- generated columns where appropriate.

Application-only validation is insufficient for critical invariants because concurrent writes, multiple clients, migrations, and manual operations can bypass application code.

---

## 9. Normalization Rules

OLTP schemas SHOULD default to normalized design.

The LLM/code agent MUST avoid storing the same mutable fact in multiple tables unless there is a documented synchronization strategy.

### Required Normalization Questions

Before adding a duplicated column, answer:

1. What is the source of truth?
2. Is the duplicate immutable snapshot data or mutable derived data?
3. How is it updated?
4. What happens when update fails midway?
5. How is divergence detected?
6. Is a generated column, view, index, or query join better?

### Acceptable Denormalization

Denormalization is allowed only when:

- the fact is an immutable snapshot at the time of transaction;
- read performance has been measured as a real bottleneck;
- the duplicated value is derived and rebuildable;
- consistency lag is acceptable and documented;
- reconciliation exists.

---

## 10. Transaction Design

### 10.1 Transaction Boundary

A transaction MUST cover exactly the set of writes required to preserve one consistency boundary.

It MUST NOT include:

- remote API calls;
- long-running file processing;
- user think time;
- message broker waiting;
- external email/SMS sending;
- expensive report generation.

### 10.2 Transaction Size

Transactions SHOULD be short.

Long transactions increase:

- lock duration;
- deadlock probability;
- MVCC bloat;
- replication lag;
- rollback cost;
- operational risk.

### 10.3 Atomicity Rule

If a command changes multiple tables to represent one business transition, those changes MUST be atomic.

Example:

```text
Case status changes from OPEN to CLOSED
+ insert status history
+ update current status
+ write audit event
+ write outbox event
```

These writes MUST be in one database transaction if they belong to the same OLTP owner.

---

## 11. Isolation and Concurrency

### 11.1 Isolation Must Be Intentional

The LLM/code agent MUST NOT rely on vague assumptions such as “the database handles concurrency.”

Every critical write flow MUST specify the concurrency strategy:

- unique constraint;
- optimistic locking;
- pessimistic lock;
- serializable transaction;
- idempotency key;
- compare-and-set update;
- queue/partition serialization;
- advisory lock where justified.

### 11.2 Optimistic Locking

Use optimistic locking when conflicts are expected to be rare.

Required column pattern:

```sql
version bigint not null default 0
```

Update pattern:

```sql
update case_record
set status = :new_status,
    version = version + 1,
    updated_at = current_timestamp
where id = :id
  and version = :expected_version;
```

If zero rows are updated, the application MUST return a conflict result such as HTTP `409 Conflict` or domain-level concurrency error.

### 11.3 Pessimistic Locking

Use pessimistic locking when:

- conflicts are common;
- duplicate processing is dangerous;
- inventory/capacity counters are modified;
- strict ordering is required.

The lock scope MUST be minimal.

Bad:

```sql
select * from case_record for update;
```

Better:

```sql
select id, status, version
from case_record
where id = :id
for update;
```

### 11.4 Serializable Isolation

Serializable isolation MAY be used for high-value invariants, but the code MUST handle serialization failures by retrying the whole transaction safely.

The retry MUST be bounded and idempotent.

---

## 12. Idempotency

Every externally retriable command MUST have idempotency protection.

Examples:

- payment creation;
- case submission;
- document upload finalization;
- event processing;
- retryable REST POST;
- message consumer processing.

Recommended table:

```sql
create table idempotency_key (
  key_value varchar(200) primary key,
  request_hash varchar(128) not null,
  response_ref varchar(200),
  status varchar(30) not null,
  created_at timestamp not null,
  expires_at timestamp not null
);
```

Idempotency MUST verify that the same key is not reused for a different request payload.

---

## 13. State Machine Persistence

Any entity with lifecycle states MUST use explicit state modeling.

Required:

- current state column;
- allowed transition rules;
- transition actor;
- transition timestamp;
- transition reason where applicable;
- status history table for auditable domains.

Bad:

```text
status is just a string updated anywhere.
```

Good:

```text
only transition command handlers update status;
state transition is validated;
history is inserted atomically;
audit/outbox is emitted atomically.
```

---

## 14. Audit Design

For regulatory, financial, identity, security, or case-management domains, audit MUST be designed explicitly.

Audit records SHOULD include:

- actor type;
- actor id;
- tenant id;
- action;
- entity type;
- entity id;
- old value where allowed;
- new value where allowed;
- reason;
- request/correlation id;
- source IP/device where appropriate;
- timestamp;
- outcome.

Audit logs MUST NOT leak secrets, passwords, tokens, raw credentials, or unnecessary personal data.

Audit tables SHOULD be append-only.

---

## 15. Temporal and Historical Data

The LLM/code agent MUST distinguish:

- current state;
- historical state;
- event history;
- audit log;
- analytical fact.

These are not interchangeable.

Example:

| Need                      | Proper Model                      |
| ------------------------- | --------------------------------- |
| current case status       | column on case table              |
| previous statuses         | status history table              |
| who changed it and why    | audit table                       |
| dashboard count per month | OLAP fact/materialized read model |

---

## 16. Soft Delete

Soft delete MUST NOT be added casually.

Allowed only when required for:

- recovery;
- auditability;
- legal hold;
- business lifecycle;
- referential safety;
- retention workflow.

Soft delete requires:

- explicit `deleted_at`;
- explicit `deleted_by` if user action;
- query filters;
- unique constraint strategy;
- retention/purge process;
- restore rules;
- audit event.

Bad:

```sql
is_deleted boolean default false
```

Better:

```sql
deleted_at timestamp null,
deleted_by varchar(100) null,
deletion_reason varchar(500) null
```

But if deletion is a domain state, use a state machine instead.

---

## 17. Indexing Standards

### 17.1 Every Index Must Justify a Query

Indexes MUST be created for known query patterns, constraints, joins, or ordering needs.

The LLM MUST NOT add indexes “just in case.”

Each non-constraint index SHOULD document:

- query it supports;
- column order rationale;
- expected selectivity;
- write overhead;
- whether it supports sort/order-by;
- whether it is partial/filtered;
- whether it is redundant.

### 17.2 Composite Index Column Order

Composite index order MUST be based on:

1. equality filters;
2. range filters;
3. ordering;
4. covering columns where supported and justified.

Bad:

```sql
create index idx_case_created_status on case_record(created_at, status);
```

For query:

```sql
where status = ? and created_at >= ? order by created_at desc
```

Better:

```sql
create index idx_case_status_created on case_record(status, created_at desc);
```

### 17.3 Foreign Key Indexes

Foreign key columns SHOULD be indexed when:

- parent deletes/updates occur;
- joins are common;
- child lookup by parent is common.

### 17.4 Low-Cardinality Indexes

Low-cardinality indexes such as boolean flags SHOULD NOT be added unless combined with selective columns or implemented as partial indexes.

---

## 18. Query Standards

Queries MUST be designed for predictable plans.

Required:

- avoid `select *` in application queries;
- use pagination for list endpoints;
- avoid unbounded result sets;
- avoid N+1 query patterns;
- use bind parameters;
- avoid string-concatenated SQL;
- check execution plan for high-risk queries;
- avoid functions on indexed columns unless expression indexes exist;
- avoid implicit type casts that break index usage.

Bad:

```sql
where lower(email) = lower(:email)
```

Better:

```sql
where normalized_email = :normalized_email
```

or use a supported expression/case-insensitive index.

---

## 19. Pagination

Offset pagination MAY be used for small, non-critical admin lists.

Keyset pagination SHOULD be used for large or user-facing lists.

Keyset pagination requires stable ordering:

```sql
where (created_at, id) < (:last_created_at, :last_id)
order by created_at desc, id desc
limit :limit;
```

The ordering columns MUST be indexed.

---

## 20. Migration Standards

Migrations MUST be:

- versioned;
- repeatable only where safe;
- backward-compatible when rolling deployment is possible;
- tested on realistic data volume;
- reversible or have a rollback plan;
- explicit about locks and expected duration.

### 20.1 Expand-Contract Pattern

For zero/low downtime deployments, use expand-contract:

1. Add nullable column/table/index.
2. Deploy code that writes both old and new shape if needed.
3. Backfill in batches.
4. Validate parity.
5. Switch reads.
6. Stop old writes.
7. Drop old shape in later deployment.

### 20.2 Prohibited Migration Behavior

Migrations MUST NOT:

- rewrite huge tables during peak traffic without plan;
- add `NOT NULL` with default on massive table without engine-specific impact analysis;
- drop columns immediately after code change;
- rename columns/tables without compatibility plan;
- run unbounded backfill in one transaction;
- depend on manual production edits as normal procedure.

---

## 21. Outbox and Integration Tables

If an OLTP transaction must publish an event, use a transactional outbox.

The event publication intent MUST be written in the same transaction as the business state change.

Recommended columns:

```sql
create table outbox_event (
  id varchar(100) primary key,
  aggregate_type varchar(100) not null,
  aggregate_id varchar(100) not null,
  event_type varchar(200) not null,
  payload jsonb not null,
  headers jsonb null,
  status varchar(30) not null,
  created_at timestamp not null,
  published_at timestamp null,
  retry_count int not null default 0
);
```

The outbox processor MUST be idempotent and observable.

---

## 22. Partitioning

Partitioning MUST solve a specific operational problem:

- retention/purge;
- archival;
- very large table maintenance;
- query pruning;
- write distribution;
- backup/restore strategy.

Partitioning MUST NOT be used as a substitute for proper indexing or data lifecycle design.

Partition key selection MUST consider:

- common query filters;
- retention boundary;
- skew;
- hot partitions;
- unique constraints;
- foreign key support;
- migration complexity.

---

## 23. Multi-Tenancy

Multi-tenant OLTP schemas MUST enforce tenant isolation in the database access path.

Required:

- tenant id on tenant-scoped tables;
- composite unique constraints including tenant id;
- tenant filter in repository layer;
- tests proving cross-tenant access fails;
- audit includes tenant id;
- backup/restore story for tenant-specific recovery if required.

Bad:

```sql
select * from document where id = :id;
```

Better:

```sql
select * from document where tenant_id = :tenant_id and id = :id;
```

---

## 24. Security

OLTP database design MUST follow least privilege.

Required:

- separate application DB user from migration/admin users;
- no shared superuser credentials;
- secrets stored outside source code;
- SQL injection prevention via bind parameters;
- sensitive fields encrypted or tokenized where required;
- row-level security where appropriate and supported;
- audit for privileged operations;
- backup encryption;
- controlled access to replicas and dumps.

---

## 25. Operational Readiness

Every critical OLTP table/workload SHOULD define:

- expected row growth;
- high-cardinality identifiers;
- retention period;
- archive strategy;
- backup/restore expectation;
- RPO/RTO requirement;
- vacuum/statistics/maintenance expectations;
- replication impact;
- slow query monitoring;
- deadlock monitoring;
- connection pool sizing.

---

## 26. Repository/DAO Standards

Application code MUST NOT scatter SQL state transitions across random services.

Repository methods SHOULD align with domain operations:

Bad:

```text
updateStatus(id, status)
```

Better:

```text
transitionCaseStatus(caseId, expectedVersion, fromStatus, toStatus, actor, reason)
```

The latter exposes invariants and concurrency expectations.

---

## 27. Testing Requirements

OLTP database changes require tests for:

- constraints;
- transaction rollback;
- duplicate request/idempotency;
- optimistic lock conflict;
- state transition validity;
- tenant isolation;
- migration correctness;
- query pagination;
- repository SQL parameterization;
- cascade/delete behavior;
- audit insertion.

High-risk changes SHOULD include concurrency tests.

---

## 28. Common Anti-Patterns

The LLM/code agent MUST reject or flag:

1. Table-per-screen design.
2. Shared database across services.
3. No primary key.
4. No foreign keys inside a single ownership boundary.
5. String status with no transition control.
6. Audit by overwriting current row only.
7. Soft delete without purge/restore rules.
8. JSON blob for frequently queried relational fields.
9. Index-every-column strategy.
10. Offset pagination on massive datasets.
11. Long transaction around external API calls.
12. Application-only uniqueness checks without DB constraint.
13. Dual-write to DB and message broker without outbox.
14. Migration that requires downtime but is presented as safe.
15. Reporting queries directly hammering OLTP tables.
16. Tenant id missing from tenant-scoped unique constraints.
17. Unbounded background backfill.
18. Repository methods that bypass domain invariants.

---

## 29. Design Decision Algorithm

When asked to design or modify OLTP storage, the LLM MUST follow this sequence:

1. Identify owner and business boundary.
2. Identify invariants.
3. Identify lifecycle/state transitions.
4. Choose normalized schema.
5. Add constraints for enforceable invariants.
6. Define transaction boundary.
7. Define concurrency control.
8. Define idempotency if command is retriable.
9. Define audit/history requirements.
10. Define query patterns.
11. Add indexes only for known access paths.
12. Define migration strategy.
13. Define operational concerns.
14. Define tests.
15. Flag residual risks.

---

## 30. Acceptance Criteria

An OLTP design is acceptable only if:

- every table has an owner;
- every table has a primary key;
- business invariants are enforced as close to the database as practical;
- transaction boundaries are explicit;
- concurrency behavior is explicit;
- retry/idempotency behavior is explicit for external commands;
- indexes map to query patterns;
- migrations are safe for realistic data volume;
- audit/history is adequate for the domain;
- tenant/security boundaries are enforced;
- operational growth and retention are considered;
- tests cover failure and concurrency cases.

---

## 31. Enforcement Snippet for LLM/Code Agent

```text
Before producing OLTP database code, identify invariants, transaction boundaries, concurrency strategy, constraints, indexes, migration safety, and operational risks. Reject table designs based only on UI/API shape. Do not generate schema changes that rely only on application validation for critical invariants. Do not publish events from a transaction without an outbox or equivalent reliability mechanism. Every table must have an owner, primary key, retention expectation, and migration strategy.
```

---

## 32. References

- PostgreSQL Documentation: Concurrency Control and Transaction Isolation — https://www.postgresql.org/docs/current/mvcc.html
- PostgreSQL Documentation: Transaction Isolation — https://www.postgresql.org/docs/current/transaction-iso.html
- PostgreSQL Documentation: Constraints — https://www.postgresql.org/docs/current/ddl-constraints.html
- PostgreSQL Documentation: Indexes — https://www.postgresql.org/docs/current/indexes.html
- PostgreSQL Documentation: Explicit Locking — https://www.postgresql.org/docs/current/explicit-locking.html
- PostgreSQL Documentation: Partitioning — https://www.postgresql.org/docs/current/ddl-partitioning.html
- Martin Fowler: Patterns of Enterprise Application Architecture — https://martinfowler.com/eaaCatalog/
- Microservices.io: Transactional Outbox Pattern — https://microservices.io/patterns/data/transactional-outbox.html
- OWASP SQL Injection Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
