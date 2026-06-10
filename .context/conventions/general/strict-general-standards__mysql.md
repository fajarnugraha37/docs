# Strict General Standards: MySQL

> This document is a mandatory implementation standard for LLM/code agents designing, modifying, reviewing, or generating MySQL schema, SQL, migrations, repositories, queries, indexes, and operational database code.

---

## 1. Purpose

MySQL is not merely generic SQL. Production MySQL behavior depends heavily on version, storage engine, SQL mode, InnoDB transaction semantics, indexes, collations, replication, online DDL support, and operational configuration.

An LLM/code agent MUST treat MySQL as a transactional engine with specific correctness and availability constraints.

The goal is to ensure generated MySQL work is:

- correct under InnoDB concurrency;
- explicit about schema invariants;
- safe under production migrations;
- compatible with the target MySQL major version;
- secure by default;
- performant for the real query pattern;
- resilient under replication, failover, retries, and operational limits.

---

## 2. Scope

This standard applies to:

- MySQL schema design;
- InnoDB table design;
- SQL query design;
- indexing;
- foreign keys and constraints;
- transactions and isolation;
- generated columns;
- JSON usage;
- migrations and online DDL;
- repository/DAO implementation;
- outbox/inbox tables;
- audit and retention;
- replication-aware application behavior;
- backup, restore, monitoring, and production readiness.

Use `strict-general-standards__oltp_database_design.md` for generic OLTP principles and this document for MySQL-specific enforcement.

---

## 3. Core Principle

> MySQL implementation MUST be explicit about version, storage engine, SQL mode, collation, transaction semantics, and migration behavior.

A MySQL design is invalid if it depends on implicit defaults that can vary between environments.

A MySQL design is also invalid if it assumes PostgreSQL, Oracle, or ANSI SQL behavior without verifying MySQL/InnoDB semantics.

---

## 4. Mandatory Language

The terms below are normative:

- **MUST**: required.
- **MUST NOT**: prohibited.
- **SHOULD**: recommended unless there is documented justification.
- **MAY**: optional, but must not violate mandatory rules.

---

## 5. Version and Engine Policy

### 5.1 Version Rule

LLM/code agents MUST identify the target MySQL version before generating version-sensitive syntax.

Default enterprise guidance:

- Prefer MySQL LTS versions for production unless the organization explicitly accepts Innovation releases.
- Do not target MySQL 8.0 for new production work unless there is a project constraint and lifecycle risk is accepted.
- If the target is unknown, generate conservative MySQL 8.4 LTS-compatible SQL unless a feature requires newer behavior.
- Document minimum version for generated columns, check constraints, JSON functions, invisible indexes, common table expressions, window functions, and online DDL options.

### 5.2 Storage Engine Rule

Production transactional tables MUST use InnoDB unless a specific exception is documented.

Every generated table SHOULD explicitly specify:

```sql
ENGINE = InnoDB
```

Do not rely on server default storage engine for critical schema.

### 5.3 SQL Mode Rule

LLM/code agents MUST assume strict SQL mode for production.

Schema and query examples MUST NOT depend on permissive behavior such as silent truncation, invalid date coercion, or implicit value conversion.

Recommended production posture includes strict behavior and explicit validation at application boundaries.

---

## 6. Required Design Inputs

Before generating MySQL artifacts, the LLM/code agent MUST identify or state assumptions for:

1. MySQL version.
2. Storage engine.
3. SQL mode.
4. Character set and collation.
5. Workload type.
6. Table size and growth.
7. Write/read ratio.
8. Required invariants.
9. Transaction boundary.
10. Concurrency conflict model.
11. Access paths and sort patterns.
12. Migration downtime tolerance.
13. Replication/failover topology.
14. Backup/restore requirements.

If unknown, the output MUST state assumptions and choose safer defaults.

---

## 7. Schema Design Rules

### 7.1 Table Definition

Every production table MUST define:

- primary key;
- explicit storage engine;
- explicit character set/collation at schema or table level;
- required `NOT NULL` columns;
- timestamps where lifecycle tracking is required;
- business unique constraints where uniqueness matters.

Example:

```sql
CREATE TABLE license_application (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_no VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_license_application_application_no (application_no),
  KEY ix_license_application_status_created_at (status, created_at)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;
```

### 7.2 Naming

Recommended conventions:

- tables and columns: `snake_case`;
- primary key: `id` or `<table>_id`, one convention per project;
- foreign key column: `<referenced_table>_id`;
- indexes: `ix_<table>_<columns>`;
- unique constraints/indexes: `uq_<table>_<columns>`;
- foreign keys: `fk_<child>_<parent>`.

Important constraints MUST be explicitly named.

### 7.3 Primary Keys

Every InnoDB table MUST have a primary key.

Primary key choice matters because InnoDB uses clustered indexes.

Rules:

- Use compact, stable, immutable primary keys.
- Avoid very wide primary keys unless the table is naturally small.
- Avoid random primary keys for high-write hot tables unless the trade-off is accepted.
- Do not expose auto-increment IDs as authorization boundaries.
- Use business unique keys separately from surrogate keys.

### 7.4 Auto Increment

`AUTO_INCREMENT` MAY be used for surrogate keys.

Rules:

- Use unsigned integer type sized for expected growth.
- Do not assume gapless IDs.
- Do not use ID sequence as business ordering proof.
- Do not build security assumptions from monotonic IDs.

### 7.5 Foreign Keys

Foreign keys SHOULD be used within the same database ownership boundary to enforce referential integrity.

Foreign keys MUST define explicit referential actions.

Rules:

- Referencing and referenced columns must be indexed correctly.
- Parent referenced keys should be primary or unique keys.
- Avoid nonstandard foreign key references to non-unique keys.
- Do not use foreign keys across microservice ownership boundaries.
- Be careful with cascades on large hierarchies.
- Do not use physical cascade semantics for soft-delete workflows unless explicitly intended.

### 7.6 Nullability

Columns MUST be `NOT NULL` unless absence is a valid business state.

Do not rely on default nullable behavior.

Bad:

```sql
email VARCHAR(255)
```

Good:

```sql
email VARCHAR(255) NOT NULL
```

Nullable columns MUST document whether null means unknown, not applicable, not yet provided, redacted, or intentionally empty.

### 7.7 CHECK Constraints

Use `CHECK` constraints only when supported and enforced by the target MySQL version.

Even when using `CHECK`, critical validation MUST also exist at application boundaries for user-facing error quality.

---

## 8. Character Set and Collation Rules

### 8.1 UTF-8 Rule

Use `utf8mb4`, not legacy `utf8`.

Default table/database settings SHOULD be explicit:

```sql
DEFAULT CHARSET = utf8mb4
COLLATE = utf8mb4_0900_ai_ci
```

Choose collation intentionally:

- case/accent insensitive for user-friendly search;
- case/accent sensitive for identifiers where exact comparison matters;
- binary collation for tokens, hashes, and opaque identifiers.

### 8.2 Unique Constraint and Collation

LLM/code agents MUST consider collation when creating unique keys.

A case-insensitive collation means these may be considered equal:

```text
User@example.com
user@example.com
```

For exact tokens/API keys, use binary-safe types/collations.

### 8.3 Length Semantics

Do not assume character count equals byte count.

Index length limits, prefix indexes, and storage impact MUST be considered for large `VARCHAR`, `TEXT`, and `utf8mb4` columns.

---

## 9. Data Type Rules

| Requirement           | Preferred Type                                               | Avoid                               |
| --------------------- | ------------------------------------------------------------ | ----------------------------------- |
| surrogate integer key | `BIGINT UNSIGNED`                                            | small `INT` without growth analysis |
| money/calculation     | `DECIMAL(p,s)`                                               | `FLOAT`, `DOUBLE`                   |
| instant timestamp     | `TIMESTAMP(6)` or `DATETIME(6)` with defined timezone policy | ambiguous local time                |
| date only             | `DATE`                                                       | timestamp at midnight               |
| boolean               | `BOOLEAN`/`TINYINT(1)` with semantics                        | string flags                        |
| JSON document         | `JSON` + generated/indexed columns for queried scalar keys   | JSON stored as text                 |
| binary token/hash     | `VARBINARY`, `BINARY`, `BLOB`                                | collation-sensitive text            |
| enum-like value       | constrained lookup/reference or controlled `VARCHAR`         | free text                           |

### 9.1 Timestamp Policy

MySQL `TIMESTAMP` and `DATETIME` have different timezone behavior. The LLM MUST state which semantic is intended.

Common policy:

- Store UTC instants.
- Use `TIMESTAMP(6)` or `DATETIME(6)` consistently.
- Convert at application boundary.
- Do not store timezone-naive user-facing local time unless local-time semantics are required.

### 9.2 DECIMAL Rule

Use `DECIMAL` for money and exact quantities.

Do not use floating point for financial values or regulatory calculations.

### 9.3 TEXT/BLOB Rule

Large `TEXT`/`BLOB` columns SHOULD be separated when they are rarely read with the main row.

Do not include large columns in hot list queries.

---

## 10. JSON and Generated Columns

### 10.1 JSON Rule

MySQL `JSON` MAY be used for:

- integration payload snapshots;
- sparse metadata;
- evolving optional attributes;
- audit payloads.

It MUST NOT be used as a substitute for core relational modeling when fields are frequently filtered, joined, constrained, or authorized.

### 10.2 JSON Indexing Rule

MySQL JSON columns are not indexed directly like normal scalar columns. When a JSON scalar must be searched frequently, use generated columns or functional indexes when supported by the target version.

Example:

```sql
CREATE TABLE integration_message (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payload JSON NOT NULL,
  case_id VARCHAR(64) GENERATED ALWAYS AS (json_unquote(json_extract(payload, '$.caseId'))) STORED,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_integration_message_case_id (case_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
```

### 10.3 JSON Validation

Critical JSON structure MUST be validated at the application boundary.

Database-generated columns MAY be used to project important keys for indexing and constraint enforcement.

---

## 11. Index Design

### 11.1 General Rule

Every index MUST be justified by:

- a query predicate;
- a join path;
- a sort/group path;
- a uniqueness rule;
- a foreign key requirement.

Indexes add write cost and storage. Do not index every column.

### 11.2 Composite Index Rules

Composite index order MUST match query access pattern.

For:

```sql
WHERE tenant_id = ? AND status = ?
ORDER BY created_at DESC, id DESC
```

Use:

```sql
KEY ix_case_tenant_status_created_id (tenant_id, status, created_at, id)
```

Rules:

- Put equality predicates first.
- Then range/sort columns when useful.
- Do not create redundant left-prefix indexes.
- Verify with `EXPLAIN`.

### 11.3 Covering Indexes

Covering indexes MAY be used for hot read paths.

Do not create huge covering indexes with many volatile columns.

### 11.4 Prefix Indexes

Prefix indexes MAY be used for long string columns only when selectivity is measured.

A prefix unique index may not enforce full-value uniqueness. Avoid unless semantics are correct.

### 11.5 Invisible Indexes

Invisible indexes MAY be used to test index removal impact when supported.

LLM output MUST NOT rely on invisible indexes as a substitute for proper query review.

### 11.6 Foreign Key Indexes

Foreign key columns MUST have compatible indexes.

Do not assume MySQL-created implicit indexes are stable design documentation; define clear indexes where they are important.

---

## 12. Query Design

### 12.1 Required Query Rules

Generated MySQL SQL MUST:

- use parameter binding;
- avoid string concatenation for values;
- avoid `SELECT *` in production paths;
- include deterministic order for pagination;
- avoid unbounded result sets;
- avoid N+1 query patterns;
- avoid implicit type conversions in predicates;
- avoid function-wrapping indexed columns unless supported by a generated/functional index;
- include `EXPLAIN` guidance for performance-sensitive queries.

### 12.2 Pagination

Offset pagination MAY be used for small lists.

Keyset pagination SHOULD be used for large tables.

Bad:

```sql
SELECT id, case_no, status
FROM case_file
ORDER BY created_at DESC
LIMIT 50 OFFSET 100000;
```

Good:

```sql
SELECT id, case_no, status, created_at
FROM case_file
WHERE tenant_id = ?
  AND (created_at < ? OR (created_at = ? AND id < ?))
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

### 12.3 Locking Reads

Use locking reads only inside short transactions.

```sql
SELECT id
FROM job_queue
WHERE status = 'READY'
ORDER BY priority DESC, created_at ASC
LIMIT 10
FOR UPDATE SKIP LOCKED;
```

Rules:

- Keep transaction short.
- Update claimed rows immediately.
- Configure lock wait behavior.
- Consider starvation/fairness.
- Do not use locking reads for long user workflows.

### 12.4 Upsert

Use `INSERT ... ON DUPLICATE KEY UPDATE` only when the merge behavior is truly intended.

Do not use upsert to hide conflicting business commands.

Idempotency example:

```sql
INSERT INTO idempotency_key (`key`, request_hash, created_at)
VALUES (?, ?, CURRENT_TIMESTAMP(6))
ON DUPLICATE KEY UPDATE `key` = `key`;
```

Application code MUST still check whether existing request hash matches.

---

## 13. Transaction and Concurrency Rules

### 13.1 Transaction Boundary

Every write flow MUST define its transaction boundary.

Do not keep transactions open while:

- calling external services;
- waiting for user input;
- reading/writing large files;
- performing slow network I/O;
- publishing external messages without outbox pattern.

### 13.2 Isolation Level

MySQL/InnoDB default isolation is commonly `REPEATABLE READ`. LLM/code agents MUST not assume PostgreSQL-style `READ COMMITTED` behavior.

Generated code MUST specify whether the design depends on:

- consistent reads;
- locking reads;
- gap locks/next-key locks;
- phantom prevention;
- replication consistency.

If changing isolation level, document why and what anomalies become possible or prevented.

### 13.3 Optimistic Locking

Use version columns for long-lived user-edited records.

```sql
UPDATE case_file
SET status = ?,
    version = version + 1,
    updated_at = CURRENT_TIMESTAMP(6)
WHERE id = ?
  AND version = ?;
```

Application MUST check affected row count.

### 13.4 Deadlock Handling

Deadlocks are possible in correct transactional systems.

Generated write code MUST support safe retry for idempotent commands:

- bounded retries;
- backoff/jitter;
- observability;
- no duplicate external side effects;
- deterministic lock ordering where practical.

### 13.5 Lock Waits

Long lock waits MUST be treated as operational signals.

Do not hide them with infinite retry loops.

---

## 14. Migration and Online DDL Rules

### 14.1 Production Safety

Before generating a migration, the LLM MUST identify:

- target MySQL version;
- table size;
- write rate;
- DDL algorithm support;
- lock behavior;
- replication impact;
- rollback plan;
- application compatibility window;
- whether backfill is required.

### 14.2 Expand/Contract Pattern

Use expand/contract for non-trivial changes:

1. Add nullable/new structure.
2. Deploy compatible code.
3. Backfill in batches.
4. Validate.
5. Add constraints/indexes.
6. Switch reads/writes.
7. Remove old fields later.

### 14.3 Online DDL

Do not assume all `ALTER TABLE` operations are online.

When generating DDL for large production tables, specify desired algorithm/lock when appropriate and verify support:

```sql
ALTER TABLE case_file
  ADD INDEX ix_case_status_created_at (status, created_at),
  ALGORITHM=INPLACE,
  LOCK=NONE;
```

If the operation may copy/rebuild the table, document operational risk.

### 14.4 Backfill Rules

Backfills MUST be batched.

Bad:

```sql
UPDATE huge_table SET new_col = compute_value(old_col);
```

Good:

```text
Backfill by primary key range with limited batch size, commit per batch, monitor replica lag and lock waits.
```

### 14.5 Foreign Key Migration

Adding/dropping foreign keys can affect online DDL behavior.

For large tables, migration MUST document:

- parent/child table size;
- existing indexes;
- lock behavior;
- cascade impact;
- validation strategy;
- rollback strategy.

---

## 15. Replication and Failover Awareness

LLM/code agents MUST consider replication when generating production MySQL designs.

Rules:

- Do not read-after-write from replicas unless consistency model supports it.
- Document whether a read must go to primary.
- Monitor replica lag for read scaling designs.
- Ensure statements are deterministic for replication mode.
- Avoid relying on non-deterministic behavior in replicated writes.
- Use GTID/binlog assumptions only when known.
- Ensure migrations are safe under replication lag.

For user-facing write flows, return success only after the write outcome is known according to the application consistency requirement.

---

## 16. Outbox and Integration Tables

For reliable publication after a MySQL transaction, use transactional outbox.

Minimum table:

```sql
CREATE TABLE outbox_event (
  id CHAR(36) NOT NULL,
  aggregate_type VARCHAR(128) NOT NULL,
  aggregate_id VARCHAR(128) NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  event_version INT NOT NULL,
  payload JSON NOT NULL,
  trace_id VARCHAR(128) NULL,
  occurred_at TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  published_at TIMESTAMP(6) NULL,
  publish_attempts INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  PRIMARY KEY (id),
  KEY ix_outbox_unpublished (published_at, created_at, id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
```

Rules:

- Insert outbox event in the same transaction as domain state change.
- Poll unpublished rows with bounded batch size.
- Use idempotent publisher and idempotent consumer.
- Avoid external broker calls inside the DB transaction.

---

## 17. Security Rules

### 17.1 Least Privilege

Use separate accounts for:

- migrations;
- application runtime;
- read-only/reporting;
- backup/restore;
- administrative operations.

Application accounts MUST NOT have broad DDL/admin privileges in production.

### 17.2 SQL Injection Prevention

All generated application SQL MUST use prepared statements or safe query builders.

Identifiers such as table/column names cannot be value-bound parameters; if dynamic identifiers are required, use allowlists.

### 17.3 Sensitive Data

Sensitive columns MUST define:

- classification;
- masking/redaction behavior;
- encryption requirement if applicable;
- audit access requirement;
- retention/deletion rule.

Do not log raw SQL values containing secrets or personal data.

### 17.4 DEFINER Objects

Views, procedures, functions, and triggers with `DEFINER` semantics MUST be reviewed for privilege escalation and migration portability.

---

## 18. Connection Management

Application code MUST use bounded connection pooling.

Rules:

- Do not open a new connection per query.
- Configure connection, query, and lock wait timeouts.
- Keep transactions short.
- Avoid session state assumptions when using proxies/pools.
- Clean up temporary tables/session variables before returning pooled connections.
- Monitor connection saturation.

---

## 19. Performance and Operations

### 19.1 EXPLAIN Required

Performance-sensitive queries MUST be reviewed with `EXPLAIN` or `EXPLAIN ANALYZE` when supported and safe.

### 19.2 Statistics and Optimizer

Generated designs MUST not assume indexes are always chosen.

Consider:

- selectivity;
- stale statistics;
- data skew;
- implicit conversions;
- collation effects;
- range vs equality predicates;
- left-prefix index rules.

### 19.3 Large Tables

Large/hot tables MUST have a plan for:

- archiving;
- partitioning where justified;
- online schema changes;
- index bloat/fragmentation;
- backup/restore time;
- purge behavior;
- replica lag.

### 19.4 Partitioning

Partitioning MAY be used for retention and large time-based data.

Partitioning MUST NOT be used as a generic performance cure.

Before partitioning, document:

- partition key;
- pruning behavior;
- primary/unique key implications;
- foreign key limitations;
- retention procedure;
- automation for future partitions;
- query compatibility.

---

## 20. MySQL Anti-Patterns

LLM/code agents MUST avoid:

1. Generating MySQL SQL without target version.
2. Relying on default storage engine.
3. Using legacy `utf8` instead of `utf8mb4`.
4. Missing primary keys on InnoDB tables.
5. Treating auto-increment IDs as gapless or secure.
6. Business uniqueness enforced only in application code.
7. Ambiguous nullable columns.
8. Financial values stored as floating point.
9. `SELECT *` in production paths.
10. Offset pagination on large tables.
11. Implicit type conversion in predicates.
12. Function-wrapping indexed columns without generated/functional index support.
13. Indexing every column.
14. Huge covering indexes on write-heavy tables.
15. JSON used as the whole domain model.
16. Assuming JSON columns are directly indexed like scalar columns.
17. Long transactions around remote calls.
18. No deadlock retry logic.
19. Unsafe `ALTER TABLE` on large production tables.
20. Big unbatched backfills.
21. Read-after-write from replicas without consistency handling.
22. App user with DDL/admin privileges.
23. Trigger-hidden business workflows.
24. Ignoring collation in uniqueness/security-sensitive comparisons.
25. Assuming MySQL behaves like PostgreSQL.

---

## 21. Review Checklist

A MySQL change is acceptable only if all relevant items are true:

- [ ] Target MySQL version is known or assumptions are stated.
- [ ] InnoDB is explicitly used for transactional tables.
- [ ] SQL mode assumptions are safe.
- [ ] Charset/collation is explicit.
- [ ] Primary key exists and is appropriate for InnoDB clustering.
- [ ] Business uniqueness is enforced.
- [ ] Nullability has business meaning.
- [ ] Foreign keys and referential actions are intentional.
- [ ] Data types match precision and semantic requirements.
- [ ] JSON usage is justified and indexed through generated/functional mechanisms when queried.
- [ ] Indexes map to real query/constraint patterns.
- [ ] Queries are parameterized and bounded.
- [ ] Pagination is deterministic.
- [ ] Transaction boundaries are explicit and short.
- [ ] Deadlock/lock wait behavior is handled.
- [ ] Migration includes online DDL/lock/backfill/rollback considerations.
- [ ] Replication/read-after-write assumptions are documented.
- [ ] App privileges are least-privilege.
- [ ] Operational monitoring is considered.

---

## 22. Acceptance Criteria for LLM Output

When generating MySQL code, the LLM MUST include:

1. Version and engine assumptions.
2. Explicit InnoDB table definitions for transactional tables.
3. Explicit charset/collation when creating schemas/tables.
4. Primary keys and required unique constraints.
5. Parameterized query examples.
6. Indexes justified by access paths.
7. Transaction boundary and concurrency notes.
8. Migration safety notes for non-trivial DDL.
9. Replication/read consistency notes when relevant.
10. Security/privilege notes for production use.

---

## 23. Enforcement Snippet for LLM/Code Agent

Use this before generating MySQL artifacts:

```text
Before generating MySQL code, identify target MySQL version, storage engine, SQL mode, charset/collation, workload, invariants, table size, access paths, transaction boundary, migration downtime tolerance, and replication topology.
Use InnoDB explicitly for transactional tables.
Use utf8mb4 intentionally.
Generate bounded parameterized SQL.
Justify every index by query, constraint, or foreign key.
For production DDL, document algorithm/lock behavior, backfill plan, rollback, and replica impact.
Never assume MySQL behaves like PostgreSQL or generic ANSI SQL.
```

---

## 24. References

- MySQL Documentation Home: https://dev.mysql.com/doc/
- MySQL 8.4 Reference Manual: https://dev.mysql.com/doc/refman/8.4/en/
- MySQL 9.7 Reference Manual: https://dev.mysql.com/doc/refman/9.7/en/
- MySQL 8.0 Release Notes / EOL notice: https://dev.mysql.com/doc/relnotes/mysql/8.0/en/
- MySQL 8.4 Release Notes: https://dev.mysql.com/doc/relnotes/mysql/8.4/en/
- MySQL InnoDB Benefits: https://dev.mysql.com/doc/refman/9.7/en/innodb-benefits.html
- MySQL InnoDB Online DDL: https://dev.mysql.com/doc/refman/9.7/en/innodb-online-ddl-operations.html
- MySQL Foreign Key Constraints: https://dev.mysql.com/doc/refman/9.7/en/create-table-foreign-keys.html
- MySQL How MySQL Uses Indexes: https://dev.mysql.com/doc/refman/9.7/en/mysql-indexes.html
- MySQL CREATE TABLE: https://dev.mysql.com/doc/refman/9.7/en/create-table.html
