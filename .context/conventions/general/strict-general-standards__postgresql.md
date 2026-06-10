# Strict General Standards: PostgreSQL

> This document is a mandatory implementation standard for LLM/code agents designing, modifying, reviewing, or generating PostgreSQL schema, SQL, migrations, repositories, queries, indexes, and operational database code.

---

## 1. Purpose

PostgreSQL is not just a generic SQL database. It is a relational, transactional, MVCC-based database with rich constraints, indexes, JSONB, extensions, partitioning, row-level security, logical replication, and production-sensitive DDL behavior.

An LLM/code agent MUST treat PostgreSQL as a correctness and concurrency boundary, not as a passive persistence layer.

The goal is to ensure generated PostgreSQL work is:

- correct under concurrent reads/writes;
- explicit about invariants and constraints;
- safe to migrate in production;
- observable and explainable;
- secure by default;
- performant for the real access path;
- compatible with PostgreSQL semantics, not merely ANSI SQL assumptions.

---

## 2. Scope

This standard applies to:

- PostgreSQL table design;
- SQL query design;
- constraints and indexes;
- transactions and isolation;
- MVCC-aware concurrency logic;
- migrations and rollback strategy;
- JSONB usage;
- partitioning;
- functions, triggers, views, and materialized views;
- row-level security;
- connection pooling;
- repository/DAO implementation;
- outbox/inbox tables;
- audit, retention, and archival patterns;
- backup, restore, monitoring, and production readiness.

Use `strict-general-standards__oltp_database_design.md` for generic OLTP principles and this document for PostgreSQL-specific enforcement.

---

## 3. Core Principle

> PostgreSQL implementation MUST encode data invariants as close to the data as practical, while avoiding migration, locking, and query patterns that harm production availability.

A PostgreSQL design is invalid if it relies only on application memory to protect persistent invariants that the database can safely enforce.

A PostgreSQL design is also invalid if it adds constraints or indexes without considering lock behavior, table size, write amplification, bloat, vacuum, and rollback/retry behavior.

---

## 4. Mandatory Language

The terms below are normative:

- **MUST**: required.
- **MUST NOT**: prohibited.
- **SHOULD**: recommended unless there is documented justification.
- **MAY**: optional, but must not violate mandatory rules.

---

## 5. Version Policy

LLM/code agents MUST identify the PostgreSQL major version before using version-sensitive features.

Default enterprise guidance:

- Prefer supported PostgreSQL versions only.
- Do not generate syntax based on development/beta versions unless the user explicitly asks.
- When version is unknown, target conservative PostgreSQL 14+ compatibility unless the project context indicates a newer baseline.
- If using a feature introduced after the assumed baseline, document the minimum PostgreSQL version.

Examples of version-sensitive areas:

- generated columns;
- partitioning behavior;
- `MERGE`;
- `NULLS NOT DISTINCT` unique indexes;
- JSON path features;
- `CREATE INDEX CONCURRENTLY` caveats;
- logical replication capabilities;
- collation behavior;
- identity columns;
- planner improvements.

---

## 6. Required Design Inputs

Before generating PostgreSQL artifacts, the LLM/code agent MUST identify or state assumptions for:

1. PostgreSQL version.
2. Workload type: OLTP, reporting, mixed, queue-like, event/outbox, audit, search.
3. Table size now and expected growth.
4. Write/read ratio.
5. Critical invariants.
6. Required transaction boundaries.
7. Access paths and filtering/sorting patterns.
8. Expected concurrency conflicts.
9. Retention, archival, and deletion rules.
10. Migration constraints: downtime allowed or zero/near-zero downtime.
11. Existing connection pool/proxy setup.
12. Backup/restore and rollback expectation.

If unknown, the output MUST include explicit assumptions and choose safer defaults.

---

## 7. Schema Design Rules

### 7.1 Tables

Tables MUST represent durable domain facts or state, not UI payloads.

Good:

```sql
case_file
case_assignment
case_status_history
case_document
```

Bad:

```sql
case_page_grid
frontend_case_response
report_screen_cache
```

Temporary convenience tables MAY exist only if their lifecycle, ownership, cleanup, and access pattern are explicit.

### 7.2 Naming

Names MUST be consistent and predictable.

Recommended conventions:

- table names: singular or plural, but one convention per database;
- columns: `snake_case`;
- primary key: `id` or `<table>_id`, one convention per project;
- foreign key: `<referenced_table>_id`;
- timestamps: `created_at`, `updated_at`, `deleted_at`, `effective_from`, `effective_to`;
- boolean: `is_`, `has_`, `can_`, `should_` prefix;
- constraints and indexes: explicit names for non-trivial objects.

LLM/code agents MUST NOT generate random, framework-derived names for important constraints or indexes when migrations need maintainability.

### 7.3 Primary Keys

Every table MUST have a primary key unless it is a deliberate pure junction table with a composite primary key.

Use identity columns or UUIDs according to system needs:

- identity/bigint keys are good for locality and compact indexes;
- UUIDs are good for distributed ID generation and external-safe references;
- random UUIDs can increase index write amplification;
- time-sortable IDs MAY be used only when the project accepts the dependency and collision semantics.

Primary keys MUST be immutable.

### 7.4 Business Identifiers

Business identifiers MUST be protected with `UNIQUE` constraints when uniqueness is required.

Do not confuse surrogate primary key with business uniqueness.

Bad:

```sql
CREATE TABLE license_application (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_no TEXT NOT NULL
);
```

Good:

```sql
CREATE TABLE license_application (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_no TEXT NOT NULL,
  CONSTRAINT uq_license_application_application_no UNIQUE (application_no)
);
```

### 7.5 Foreign Keys

Foreign keys SHOULD be used within the same database ownership boundary.

Foreign keys MUST NOT be used across microservice-owned databases.

Every foreign key decision MUST specify delete/update behavior:

- `RESTRICT` or `NO ACTION` for preserved references;
- `CASCADE` only for true lifecycle ownership;
- `SET NULL` only when orphan-like state is valid;
- soft-delete flows MUST NOT rely on physical `ON DELETE CASCADE` semantics.

### 7.6 Nullability

Columns MUST be `NOT NULL` unless absence is a real business state.

Nullable columns MUST have a documented meaning.

When absence has multiple meanings, use explicit state:

```sql
verification_status TEXT NOT NULL CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED'))
```

instead of ambiguous nullable timestamps/flags.

### 7.7 Constraints

PostgreSQL constraints SHOULD be used for invariants that are stable and local to the row/table relationship:

- `NOT NULL`;
- `UNIQUE`;
- `CHECK`;
- `FOREIGN KEY`;
- `EXCLUDE` constraints for non-overlap rules;
- partial unique indexes for conditional uniqueness.

Application-only validation is insufficient for persistent invariants.

Bad:

```sql
-- Application checks active assignment uniqueness before insert.
```

Good:

```sql
CREATE UNIQUE INDEX uq_case_active_assignee
ON case_assignment (case_id)
WHERE ended_at IS NULL;
```

---

## 8. Data Types

### 8.1 Type Selection

LLM/code agents MUST select PostgreSQL-native types intentionally.

| Requirement                 | Preferred Type                             | Avoid                                        |
| --------------------------- | ------------------------------------------ | -------------------------------------------- |
| money/calculation           | `numeric(p,s)`                             | `float`, `double precision`                  |
| timestamp instant           | `timestamptz`                              | local timestamp without timezone assumptions |
| date only                   | `date`                                     | timestamp at midnight                        |
| enumerated stable small set | PostgreSQL enum or constrained text        | unconstrained text                           |
| flexible structured data    | `jsonb` with constraints/indexes           | JSON strings in text columns                 |
| binary                      | `bytea` or external object storage pointer | base64 text by default                       |
| IP/network                  | `inet`, `cidr`                             | plain text                                   |
| UUID                        | `uuid`                                     | `varchar(36)`                                |

### 8.2 Timestamp Rules

Use `timestamptz` for instants.

Use `date` for date-only business concepts.

Use `timestamp without time zone` only when representing local civil time with explicit timezone context stored elsewhere.

Never store local time without clarifying timezone semantics.

### 8.3 Enum Rules

PostgreSQL enums MAY be used when:

- values are stable;
- order semantics are acceptable;
- migrations for adding values are manageable;
- application and database deployments are coordinated.

Use constrained text or lookup tables when values change often or are tenant-configurable.

### 8.4 JSONB Rules

`jsonb` MAY be used for:

- external payload snapshots;
- sparse metadata;
- integration envelope storage;
- evolving non-core attributes;
- audit payloads;
- temporary compatibility during migration.

`jsonb` MUST NOT be used to avoid relational modeling for core searchable/joinable business fields.

When using `jsonb`, the design MUST define:

- which keys are required;
- which keys are indexed;
- expected query operators;
- migration/version strategy;
- validation boundary;
- maximum payload size expectation.

Good hybrid model:

```sql
CREATE TABLE integration_message (
  id UUID PRIMARY KEY,
  source_system TEXT NOT NULL,
  message_type TEXT NOT NULL,
  business_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_integration_message_payload_case_id
ON integration_message ((payload ->> 'caseId'));
```

---

## 9. Index Design

### 9.1 General Rule

Every index MUST be justified by a query, constraint, or ordering requirement.

An index is not free. It adds:

- write cost;
- disk usage;
- vacuum/reindex considerations;
- planner complexity;
- migration cost;
- bloat risk.

### 9.2 Index Required Inputs

Before adding an index, the LLM/code agent MUST identify:

1. Query pattern.
2. Predicate columns.
3. Sort columns.
4. Join columns.
5. Cardinality/selectivity.
6. Whether the index supports uniqueness or performance.
7. Whether partial/expression/index-only support is needed.
8. Whether the index can be created concurrently in production.

### 9.3 B-tree Defaults

Use B-tree for equality/range/sort operations on scalar ordered values.

Examples:

```sql
CREATE INDEX ix_case_status_created_at
ON case_file (status, created_at DESC);
```

### 9.4 Composite Index Rules

Composite index column order MUST follow access patterns.

Good for:

```sql
WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC
```

Index:

```sql
CREATE INDEX ix_case_tenant_status_created_at
ON case_file (tenant_id, status, created_at DESC);
```

Do not blindly create all permutations.

### 9.5 Partial Indexes

Use partial indexes for common filtered subsets.

```sql
CREATE INDEX ix_case_open_by_assignee
ON case_file (assignee_id, created_at DESC)
WHERE status IN ('OPEN', 'IN_REVIEW');
```

The query predicate MUST match the partial index predicate sufficiently for planner use.

### 9.6 Expression Indexes

Expression indexes MAY be used for normalized lookup.

```sql
CREATE INDEX ix_user_email_lower
ON app_user ((lower(email)));
```

The query MUST use the same expression.

### 9.7 GIN/GiST/BRIN Rules

Use specialized indexes intentionally:

- `GIN` for `jsonb`, arrays, full-text search;
- `GiST`/`SP-GiST` for geometric/range/specialized operators;
- `BRIN` for very large naturally ordered append-heavy tables;
- `B-tree` for most OLTP equality/range lookups.

Do not add GIN indexes to large high-write tables without measuring write impact.

### 9.8 Index Naming

Index names SHOULD encode purpose:

```text
ix_<table>_<columns>
uq_<table>_<business_key>
gin_<table>_<jsonb_column>
brin_<table>_<time_column>
```

---

## 10. Query Design

### 10.1 Required Query Rules

Generated SQL MUST:

- use parameter binding;
- avoid string concatenation for values;
- avoid `SELECT *` in production paths;
- include deterministic ordering for pagination;
- avoid unbounded result sets;
- avoid hidden N+1 query patterns;
- avoid function-wrapping indexed columns unless supported by expression indexes;
- use `EXPLAIN (ANALYZE, BUFFERS)` for performance-sensitive changes in review.

### 10.2 Pagination

Offset pagination MAY be used for small administrative lists.

Keyset pagination SHOULD be used for large or high-traffic lists.

Bad:

```sql
SELECT * FROM case_file
ORDER BY created_at DESC
OFFSET 100000 LIMIT 50;
```

Good:

```sql
SELECT id, case_no, status, created_at
FROM case_file
WHERE (created_at, id) < ($1, $2)
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

### 10.3 Locking Reads

Use row locks only when required.

Allowed:

```sql
SELECT id
FROM job_queue
WHERE status = 'READY'
ORDER BY priority DESC, created_at ASC
FOR UPDATE SKIP LOCKED
LIMIT 10;
```

Rules:

- `FOR UPDATE` MUST be inside a short transaction.
- Locked rows MUST be updated/processed quickly.
- `SKIP LOCKED` MAY be used for queue-like processing, but fairness/starvation must be considered.
- Do not use table locks for ordinary business updates.

### 10.4 Upsert

Use `INSERT ... ON CONFLICT` only when conflict target and merge semantics are correct.

```sql
INSERT INTO idempotency_key (key, request_hash, created_at)
VALUES ($1, $2, now())
ON CONFLICT (key) DO NOTHING;
```

Do not use upsert to hide conflicting business commands.

### 10.5 CTE Rules

CTEs MUST be used for readability or data-modifying statement composition, not as a magical performance improvement.

For performance-sensitive SQL, validate with actual execution plans.

---

## 11. Transaction and Concurrency Rules

### 11.1 Transaction Boundary

Every write flow MUST define its transaction boundary.

A transaction MUST contain only work that must commit atomically.

Do not hold database transactions while:

- calling remote services;
- waiting for user input;
- doing long file operations;
- performing slow network I/O;
- publishing events directly to external brokers without outbox pattern.

### 11.2 Isolation Level

Default `READ COMMITTED` is acceptable for many PostgreSQL OLTP workloads.

Use higher isolation only with explicit reason:

- `REPEATABLE READ` for stable snapshot semantics;
- `SERIALIZABLE` for stronger anomaly prevention;
- transaction retry logic for serialization failures.

Any use of `REPEATABLE READ` or `SERIALIZABLE` MUST include retry handling for serialization failures.

### 11.3 Optimistic Locking

Use optimistic locking when users or services update long-lived business objects.

```sql
UPDATE case_file
SET status = $new_status,
    version = version + 1,
    updated_at = now()
WHERE id = $id
  AND version = $expected_version;
```

The application MUST check affected row count.

### 11.4 Pessimistic Locking

Use pessimistic locking only for short critical sections where conflict is expected and must be serialized.

The LLM MUST document:

- locked table/rows;
- lock order;
- timeout behavior;
- deadlock retry behavior.

### 11.5 Deadlock and Serialization Retry

Generated code MUST treat these as retryable only when the command is idempotent or safely replayable:

- deadlock detected;
- serialization failure;
- transient connection failure before commit outcome is known.

Retry loops MUST have:

- max attempts;
- jitter/backoff;
- observability;
- idempotency protection for externally visible effects.

---

## 12. Migration Rules

### 12.1 Production Safety

Migrations MUST be designed for table size and lock behavior.

Before generating a migration, identify:

- table size;
- write rate;
- lock level;
- whether operation rewrites table;
- whether backfill is required;
- rollback plan;
- deployment order;
- application compatibility window.

### 12.2 Expand/Contract Pattern

For non-trivial changes, use expand/contract:

1. Add new nullable column/table/index.
2. Deploy code that dual-writes or supports both forms.
3. Backfill in batches.
4. Validate data.
5. Enforce `NOT NULL`/constraints.
6. Switch reads.
7. Remove old column/code later.

### 12.3 Adding Columns

Adding a nullable column is usually safer than adding a mandatory column with heavy default/backfill.

Do not add `NOT NULL` immediately to large populated tables without a safe plan.

Preferred pattern:

```sql
ALTER TABLE case_file ADD COLUMN risk_level TEXT;

-- backfill in batches outside a single huge transaction

ALTER TABLE case_file
  ADD CONSTRAINT chk_case_file_risk_level
  CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')) NOT VALID;

ALTER TABLE case_file VALIDATE CONSTRAINT chk_case_file_risk_level;

ALTER TABLE case_file ALTER COLUMN risk_level SET NOT NULL;
```

### 12.4 Index Creation

Production indexes on large write-active tables SHOULD use `CREATE INDEX CONCURRENTLY`.

Rules:

- Do not wrap `CREATE INDEX CONCURRENTLY` inside a transaction block.
- Monitor invalid indexes after failed concurrent index creation.
- Consider write amplification and build duration.
- Validate query planner usage after creation.

### 12.5 Dropping Objects

Dropping columns/indexes/tables MUST be delayed until:

- no deployed code references them;
- metrics/logs confirm unused;
- rollback window has passed;
- backup/restore implications are understood.

---

## 13. Partitioning

Partitioning MAY be used for:

- large time-series/audit/event tables;
- retention management;
- archival/drop-by-partition;
- improving maintenance operations;
- reducing index size per partition.

Partitioning MUST NOT be used as a default performance fix.

Before partitioning, document:

- partition key;
- partition interval/list strategy;
- query pruning behavior;
- unique constraint limitations;
- index strategy;
- retention/drop procedure;
- partition creation automation;
- migration strategy from non-partitioned table.

Bad:

```text
Partition every table by tenant because it sounds scalable.
```

Good:

```text
Partition audit_event by event_month because retention is monthly and most queries filter by created_at.
```

---

## 14. JSONB and Semi-Structured Data

### 14.1 JSONB Valid Use

Use `jsonb` for edge payloads, metadata, and snapshots.

Do not use `jsonb` as the main domain model when:

- values participate in constraints;
- values are frequently joined;
- values are updated independently;
- values are central to authorization;
- values need strong type guarantees.

### 14.2 JSONB Indexing

Use correct index type:

```sql
CREATE INDEX gin_message_payload
ON integration_message USING GIN (payload);
```

For scalar extraction, expression index may be better:

```sql
CREATE INDEX ix_message_payload_case_id
ON integration_message ((payload ->> 'caseId'));
```

### 14.3 JSONB Validation

Critical JSONB structure MUST be validated at the application boundary and SHOULD be guarded with database checks where practical.

Example:

```sql
ALTER TABLE integration_message
ADD CONSTRAINT chk_payload_object
CHECK (jsonb_typeof(payload) = 'object');
```

---

## 15. Functions, Triggers, and Stored Logic

### 15.1 Allowed Uses

PostgreSQL functions/triggers MAY be used for:

- audit stamping;
- denormalized derived fields;
- invariant enforcement not expressible as simple constraints;
- outbox insertion within the same transaction;
- partition maintenance;
- security-barrier views or RLS helpers.

### 15.2 Prohibited Uses

LLM/code agents MUST NOT hide complex business workflows in triggers unless explicitly justified.

Prohibited:

```text
A trigger sends HTTP requests to an external system.
```

```text
A trigger silently changes workflow state without application visibility.
```

```text
A trigger performs slow cross-table batch work on every row update.
```

### 15.3 Trigger Requirements

Every trigger MUST document:

- firing event;
- row vs statement level;
- before vs after;
- idempotency;
- recursion risk;
- performance impact;
- test coverage.

---

## 16. Outbox and Integration Tables

For reliable event publishing from PostgreSQL-backed services, use transactional outbox when external broker publication must correspond to committed database state.

Minimum outbox fields:

```sql
CREATE TABLE outbox_event (
  id UUID PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  payload JSONB NOT NULL,
  trace_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  publish_attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX ix_outbox_unpublished
ON outbox_event (created_at, id)
WHERE published_at IS NULL;
```

Rules:

- Insert outbox row in the same transaction as domain state change.
- Publisher MUST be idempotent.
- Consumers MUST be idempotent.
- Do not publish external messages directly inside the DB transaction without outbox unless failure semantics are explicitly accepted.

---

## 17. Security Rules

### 17.1 Least Privilege

Application roles MUST have only required privileges.

Recommended separation:

- migration role: DDL privileges;
- application role: DML privileges only;
- read-only/report role: restricted read;
- admin role: operational use only.

### 17.2 Schema Privileges

Do not grant broad `PUBLIC` privileges unintentionally.

Generated setup scripts SHOULD explicitly manage schema ownership and privileges.

### 17.3 Row-Level Security

RLS MAY be used for tenant isolation or policy enforcement, but MUST be tested carefully.

RLS rules MUST define:

- tenant context source;
- bypass roles;
- policy for SELECT/INSERT/UPDATE/DELETE;
- migration/backfill behavior;
- performance impact;
- test cases for cross-tenant denial.

### 17.4 Sensitive Data

Sensitive columns MUST specify:

- classification;
- masking/redaction behavior;
- encryption requirement if applicable;
- audit access requirement;
- retention/deletion rule.

Do not log raw sensitive data in SQL traces.

---

## 18. Connection Management

PostgreSQL connections are not free. Application code MUST use pooling.

Rules:

- Use bounded connection pools.
- Configure statement/query timeouts.
- Configure idle-in-transaction timeout.
- Do not keep transactions open across request boundaries.
- Use PgBouncer/connection proxy only with awareness of transaction/session pooling limitations.
- Avoid session-level state when using transaction pooling.

LLM-generated repositories MUST not open unmanaged connections per query.

---

## 19. Performance and Maintenance

### 19.1 Vacuum and Bloat Awareness

High-update/delete tables MUST consider:

- autovacuum behavior;
- dead tuples;
- bloat;
- HOT updates;
- fillfactor;
- long-running transactions blocking cleanup;
- index bloat.

Do not design queue tables with constant churn without cleanup/vacuum strategy.

### 19.2 Explain Plans

Performance-sensitive query changes MUST include plan verification guidance:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT ...;
```

For production, use safe sampling/staging or query statistics rather than blindly running heavy analyze queries.

### 19.3 Statistics

If queries filter on correlated columns, consider extended statistics.

Do not assume the planner understands every cross-column relationship.

### 19.4 Materialized Views

Materialized views MAY be used for expensive derived reads.

They MUST define:

- refresh method;
- refresh frequency;
- staleness tolerance;
- unique index requirement for concurrent refresh where applicable;
- ownership and monitoring.

---

## 20. PostgreSQL Anti-Patterns

LLM/code agents MUST avoid:

1. Treating PostgreSQL as generic SQL without version/engine semantics.
2. Missing primary keys.
3. Business uniqueness only in application code.
4. Ambiguous nullable columns.
5. Unbounded `SELECT *` queries.
6. Offset pagination for huge result sets.
7. Indexing every column.
8. Creating large production indexes without concurrency/lock plan.
9. Adding `NOT NULL`/default/backfill in one unsafe migration.
10. Using JSONB for all domain data.
11. Storing timestamps without timezone semantics.
12. Holding DB transactions while calling remote services.
13. Ignoring serialization/deadlock retry requirements.
14. Using triggers for hidden business workflows.
15. One database user with superuser-like privileges for the app.
16. Long-running idle transactions.
17. Missing query timeout.
18. Table partitioning without pruning/retention model.
19. Cross-service shared PostgreSQL tables.
20. Assuming successful commit outcome after network failure without idempotency.

---

## 21. Review Checklist

A PostgreSQL change is acceptable only if all relevant items are true:

- [ ] PostgreSQL version assumptions are stated.
- [ ] Tables represent stable business concepts.
- [ ] Primary keys and business unique constraints are explicit.
- [ ] Foreign key behavior is intentional.
- [ ] Nullability has business meaning.
- [ ] Constraints enforce persistent invariants where practical.
- [ ] Data types are PostgreSQL-appropriate.
- [ ] Indexes map to real query/constraint patterns.
- [ ] Large index creation uses safe production strategy.
- [ ] Queries are parameterized and bounded.
- [ ] Pagination is deterministic.
- [ ] Transaction boundary is explicit.
- [ ] Locking strategy is explicit if used.
- [ ] Retry behavior exists for serialization/deadlock where needed.
- [ ] Migration lock/backfill/rollback risk is documented.
- [ ] JSONB usage is justified and indexed/validated if queried.
- [ ] Security roles are least-privilege.
- [ ] Connection pool/timeouts are considered.
- [ ] Observability and maintenance concerns are addressed.

---

## 22. Acceptance Criteria for LLM Output

When generating PostgreSQL code, the LLM MUST include:

1. DDL or SQL that matches PostgreSQL semantics.
2. Explicit constraints for invariants.
3. Indexes justified by access paths.
4. Migration safety notes for non-trivial DDL.
5. Transaction boundary and concurrency behavior.
6. Parameterized query examples.
7. Version assumptions when feature-dependent.
8. Security/privilege notes for production use.
9. Performance verification guidance for non-trivial queries.

---

## 23. Enforcement Snippet for LLM/Code Agent

Use this before generating PostgreSQL artifacts:

```text
Before generating PostgreSQL code, identify PostgreSQL version, workload, invariants, table size, access paths, transaction boundary, concurrency conflicts, migration downtime tolerance, and security role model.
Encode stable invariants using constraints where practical.
Generate bounded parameterized SQL.
Justify every index by query or constraint.
For production DDL, document lock behavior, backfill strategy, rollback, and compatibility window.
Never use JSONB, triggers, partitioning, or higher isolation as default shortcuts without explicit reason.
```

---

## 24. References

- PostgreSQL Documentation — Current Version: https://www.postgresql.org/docs/current/index.html
- PostgreSQL Documentation — MVCC / Concurrency Control: https://www.postgresql.org/docs/current/mvcc.html
- PostgreSQL Documentation — Transaction Isolation: https://www.postgresql.org/docs/current/transaction-iso.html
- PostgreSQL Documentation — Explicit Locking: https://www.postgresql.org/docs/current/explicit-locking.html
- PostgreSQL Documentation — CREATE TABLE: https://www.postgresql.org/docs/current/sql-createtable.html
- PostgreSQL Documentation — CREATE INDEX: https://www.postgresql.org/docs/current/sql-createindex.html
- PostgreSQL Documentation — ALTER TABLE: https://www.postgresql.org/docs/current/sql-altertable.html
- PostgreSQL Documentation — Table Partitioning: https://www.postgresql.org/docs/current/ddl-partitioning.html
- PostgreSQL Documentation — JSON Types: https://www.postgresql.org/docs/current/datatype-json.html
- PostgreSQL Documentation — Row Security Policies: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
