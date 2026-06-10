# Strict General Standards: Debezium CDC

> Canonical product name: **Debezium**.  
> File name intentionally follows the requested name `debenzium`, but all implementation, class names, connector names, documentation, and configuration comments MUST use `Debezium`.

## 1. Purpose

This standard defines mandatory rules for using Debezium as a Change Data Capture (CDC) platform in systems generated, modified, or reviewed by an LLM/code agent.

Debezium MUST be treated as a CDC mechanism that converts committed database changes into Kafka records. It MUST NOT be treated as a generic domain event framework, business workflow engine, audit replacement, or application messaging shortcut.

## 2. Scope

This standard applies when an implementation includes any of the following:

- Debezium source connectors.
- Database CDC from PostgreSQL, MySQL, Oracle, SQL Server, MongoDB, or other supported databases.
- Transactional outbox using Debezium.
- Debezium SMTs, especially outbox event router.
- CDC-driven read models, cache invalidation, search indexing, analytics ingestion, or integration events.
- Kafka Connect deployments running Debezium connectors.

## 3. Non-negotiable principles

1. **CDC is not automatically a domain event**  
   A row-level table change is a technical data-change event. A domain/integration event requires explicit semantic design.

2. **The database remains the source of committed truth**  
   Debezium observes committed changes. It MUST NOT be used to bypass aggregate invariants, transaction boundaries, or authorization rules.

3. **Outbox is mandatory for business events**  
   When downstream consumers need business-semantic events, use a transactional outbox table written in the same transaction as the state change.

4. **Connector configuration is production code**  
   Debezium connector configuration MUST be versioned, reviewed, tested, deployed through CI/CD, and rollback-aware.

5. **At-least-once must be assumed outside a proven boundary**  
   Consumers MUST be idempotent. Duplicate delivery, restart, rebalance, snapshot replay, and connector recovery MUST be safe.

6. **Ordering is scoped, not global**  
   LLM-generated designs MUST define the ordering key and state the exact ordering guarantee expected by consumers.

7. **CDC must be observable**  
   Connector lag, task failure, offset progress, snapshot state, schema-history health, DLQ/error counts, and Kafka topic health MUST be monitored.

8. **Schema change is a runtime event**  
   Database DDL can break CDC. Schema evolution MUST be planned, tested, and monitored.

## 4. Required design questions before implementation

Before generating Debezium code/config, the LLM MUST answer:

- What database engine and minimum version is being captured?
- Is the desired output table-level CDC or business-level integration events?
- Which tables are captured and why?
- Which tables are explicitly excluded and why?
- What is the connector ownership boundary?
- What is the initial snapshot strategy?
- What is the partition key and ordering scope?
- How are deletes represented?
- How are schema changes handled?
- What is the replay strategy?
- What is the consumer idempotency key?
- What is the operational recovery path if the connector loses its offset, replication slot, schema history, or binlog/WAL position?

If these answers are missing, the LLM MUST NOT generate production-ready CDC configuration. It may only generate a draft with explicit TODOs and risk notes.

## 5. CDC vs outbox decision rule

Use direct table CDC only when downstream consumers need one of these:

- Search index synchronization.
- Cache invalidation.
- Read-model projection.
- Analytics ingestion.
- Audit/replication-style data feed.
- Internal data lake/warehouse ingestion.

Use transactional outbox when downstream consumers need one of these:

- Business event semantics.
- Stable event contract independent of table schema.
- Cross-service integration.
- External partner integration.
- Notification workflow.
- Saga/workflow continuation.
- Regulatory/event history where event meaning matters.

Forbidden shortcut:

```text
Application updates business table
Debezium emits raw table CDC
Other service treats row change as domain event
```

Required instead:

```text
Application transaction:
  1. validate command
  2. update domain tables
  3. insert outbox event with explicit event type/payload
Debezium:
  4. captures outbox table only
  5. routes event to integration topic
Consumers:
  6. process idempotently
```

## 6. Mandatory connector ownership rules

1. Each connector MUST have a named owner team/service.
2. Each connector MUST have a documented source database, schema/table include list, topic naming convention, and downstream consumer list.
3. A connector MUST NOT capture every table by default.
4. A connector MUST NOT capture sensitive tables unless a data classification and masking/encryption decision is documented.
5. Connector config changes MUST go through the same review discipline as application code.
6. Connector secrets MUST NOT be stored in plain text in Git.
7. Connector service accounts MUST use least privilege.
8. Connector runtime MUST be deployed separately from application runtime.

## 7. Database engine requirements

### 7.1 PostgreSQL

When using Debezium with PostgreSQL:

- Logical replication prerequisites MUST be configured deliberately.
- Replication slot lifecycle MUST be monitored.
- WAL retention impact MUST be understood.
- Publication/table include list MUST be explicit.
- Long connector outage risk MUST be modeled because WAL can accumulate.
- Snapshot mode MUST be documented.
- Primary keys or replica identity behavior MUST be explicit for updates/deletes.

LLM MUST NOT generate PostgreSQL CDC config without considering:

- `plugin.name`
- slot name
- publication name
- table include list
- schema history storage
- heartbeat/lag monitoring
- replica identity implications

### 7.2 MySQL

When using Debezium with MySQL:

- Binary logging MUST be enabled with compatible format.
- Server ID and connector identity MUST be unique.
- Binlog retention MUST exceed maximum expected outage/recovery window.
- Snapshot locking implications MUST be documented.
- GTID/binlog position recovery MUST be understood.
- Table include list MUST be explicit.

LLM MUST NOT assume MySQL CDC has PostgreSQL-like semantics.

### 7.3 Other engines

For Oracle, SQL Server, MongoDB, or other connectors, the LLM MUST check engine-specific Debezium documentation and state the required database privileges, log retention behavior, snapshot semantics, and connector limitations.

## 8. Snapshot standards

Every Debezium connector MUST explicitly define initial snapshot behavior.

Required documentation:

- snapshot mode
- expected duration
- locking impact
- tables included
- expected record volume
- consumer readiness during snapshot
- replay/idempotency expectation
- validation method after snapshot
- rollback/restart behavior

Forbidden:

```text
Use default snapshot settings without documenting impact.
```

Allowed only for local development:

```text
snapshot.mode=initial
```

Production configuration MUST justify the selected mode.

## 9. Topic naming standards

Debezium-generated topics MUST follow an explicit naming convention.

Recommended pattern for raw CDC:

```text
cdc.<environment>.<database>.<schema>.<table>
```

Recommended pattern for outbox integration events:

```text
event.<domain>.<aggregate-or-capability>.<event-category>
```

Examples:

```text
cdc.prod.licensing.public.application
cdc.prod.case.public.enforcement_case

event.licensing.application.lifecycle
event.enforcement.case.lifecycle
```

Rules:

- Raw CDC topics MUST be distinguishable from business event topics.
- Topic names MUST NOT expose confidential table names if the topic namespace is shared outside the owning platform.
- Environment naming MUST be consistent.
- Topic naming MUST be stable; do not encode deployment version in topic names unless performing a deliberate migration.

## 10. Key and partitioning standards

Each Debezium-produced topic MUST define:

- message key
- partition key
- ordering scope
- consumer grouping model
- compaction/retention policy

Rules:

1. For entity/table CDC, key SHOULD be the primary key.
2. For outbox events, key SHOULD be `aggregate_id` or a stable business key matching the required ordering scope.
3. Do not use random UUID as Kafka key if consumers need per-aggregate ordering.
4. Do not use null keys unless order, compaction, and consumer behavior are intentionally irrelevant.
5. If ordering is needed across multiple aggregates, the design MUST justify why Kafka partition-level ordering is sufficient or insufficient.

## 11. Delete and tombstone standards

For captured tables, the design MUST state how deletes are represented.

Required decisions:

- physical delete vs soft delete
- delete event payload contract
- Kafka tombstone behavior
- compaction effect
- downstream projection deletion behavior
- audit retention requirement

Rules:

- Consumers MUST not ignore delete/tombstone records by accident.
- Compacted topics MUST be designed with tombstone retention behavior in mind.
- Soft delete MUST still have a clear semantic state transition.
- Delete behavior MUST be tested.

## 12. Schema evolution standards

Debezium schema evolution MUST be treated as a compatibility problem.

Rules:

1. Database DDL MUST be coordinated with connector and consumer compatibility.
2. Column rename MUST be treated as breaking unless a migration bridge is provided.
3. Column drop MUST be treated as breaking unless consumers are proven not to depend on it.
4. Type changes MUST be reviewed for serialization compatibility.
5. New nullable/additive columns are usually safer but still require validation.
6. Event/outbox schemas MUST evolve independently from database table schema.
7. Schema Registry or equivalent schema governance SHOULD be used for production.
8. Schema history topics/storage MUST be durable, backed up, and protected.

## 13. Outbox event table standard

When using Debezium outbox, the table MUST contain enough data to create a stable event contract.

Recommended columns:

```sql
CREATE TABLE outbox_event (
    event_id          UUID PRIMARY KEY,
    aggregate_type    VARCHAR(100) NOT NULL,
    aggregate_id      VARCHAR(200) NOT NULL,
    event_type        VARCHAR(200) NOT NULL,
    event_version     INTEGER NOT NULL,
    payload           JSONB NOT NULL,
    metadata          JSONB NULL,
    trace_id          VARCHAR(100) NULL,
    causation_id      VARCHAR(100) NULL,
    correlation_id    VARCHAR(100) NULL,
    actor_id          VARCHAR(100) NULL,
    occurred_at       TIMESTAMPTZ NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outbox_event_aggregate
    ON outbox_event (aggregate_type, aggregate_id, created_at);
```

For non-PostgreSQL databases, use equivalent types and timestamp precision.

Rules:

- `event_id` MUST be globally unique and used as the consumer idempotency key.
- `aggregate_id` MUST be used as Kafka key when per-aggregate ordering is required.
- `event_type` MUST be a past-tense business fact name, e.g. `ApplicationSubmitted`, not `SubmitApplication`.
- `payload` MUST be a contract payload, not a dump of the full internal row unless explicitly justified.
- `metadata` MUST carry trace/correlation/audit context when available.
- The outbox insert MUST be in the same transaction as the business state change.
- An outbox connector using EventRouter MUST capture the outbox table only unless multiple outbox tables share an identical structure and are intentionally supported.

## 14. Payload design standards

CDC payloads and outbox payloads MUST not be confused.

Raw CDC payload may include:

- before/after row values
- operation type
- source metadata
- transaction/order metadata

Outbox payload SHOULD include:

- business event fields
- semantic event version
- effective timestamp
- minimal data needed by consumers
- stable field names
- explicit null semantics

Forbidden outbox payloads:

```json
{
  "before": { "...": "full technical row" },
  "after": { "...": "full technical row" }
}
```

Unless the event is explicitly a data-replication event, not a business event.

## 15. SMT usage standards

Single Message Transformations are allowed only for simple routing, envelope shaping, field masking, or metadata manipulation.

Rules:

- SMTs MUST NOT contain business rules.
- SMT chains MUST be documented.
- Complex transformation MUST move to stream processor/service code.
- Regex-based routing MUST be tested.
- Field masking MUST be validated with test records.
- Outbox EventRouter configuration MUST be reviewed against the outbox schema.

## 16. Consumer safety requirements

Every consumer of Debezium-produced topics MUST be designed for:

- duplicates
- out-of-order records outside the partition key scope
- replay
- snapshot records
- schema evolution
- deletes/tombstones
- partial downstream failure
- restart during processing

Consumer MUST implement at least one idempotency strategy:

- processed event table keyed by `event_id`
- version monotonic update per aggregate
- upsert with deterministic state replacement
- compare-and-set/optimistic versioning
- exactly-once stream processing inside Kafka boundary, if valid

Consumer MUST NOT rely on “Debezium will never send duplicates”.

## 17. Error handling and DLQ standards

Debezium and Kafka Connect error behavior MUST be explicit.

Required decisions:

- fail-fast vs tolerate malformed records
- DLQ topic naming
- DLQ retention
- alert threshold
- reprocessing strategy
- poison record handling
- owner of remediation

DLQ records MUST include enough context to diagnose:

- connector name
- source topic
- source partition/offset
- error class/message
- payload or redacted payload
- timestamp
- trace/correlation if available

Never silently drop CDC records.

## 18. Security and privacy standards

Debezium pipelines MUST be data-classification aware.

Rules:

- Do not capture PII/secrets by default.
- Mask, hash, tokenize, encrypt, or exclude sensitive fields.
- Do not put credentials in connector config committed to Git.
- Use least-privilege database users.
- Protect Kafka topics with ACLs.
- Protect schema history topics.
- Protect connector REST APIs.
- Redact sensitive fields from logs and DLQs.
- Treat CDC topics as sensitive because they can reveal internal state transitions.

## 19. Observability requirements

Every production Debezium deployment MUST expose and alert on:

- connector status
- task status
- connector lag
- source log/binlog/WAL lag
- snapshot progress
- record throughput
- error count
- DLQ count
- last successful event timestamp
- replication slot/binlog retention risk
- Kafka produce errors
- schema history errors
- worker rebalance frequency

Required dashboards:

- Connector health dashboard.
- Lag and throughput dashboard.
- Error/DLQ dashboard.
- Source database impact dashboard.
- Consumer projection freshness dashboard.

## 20. Deployment and migration standards

Connector deployment MUST be safe and repeatable.

Rules:

1. Connector config MUST be stored as code.
2. Deployment MUST be environment-specific without copy-paste drift.
3. Connector name changes MUST be treated carefully because they can affect offsets/status/config identity.
4. Topic rename MUST be treated as a migration.
5. Adding a captured table MUST include snapshot and consumer readiness review.
6. Removing a captured table MUST include consumer impact review.
7. Connector upgrade MUST be tested with representative schema and data volume.
8. Rollback plan MUST define offset/schema-history impact.

## 21. Testing requirements

LLM-generated Debezium-related implementation MUST include or request tests for:

- connector config validation
- topic naming
- key selection
- outbox event insert in transaction
- EventRouter output shape
- snapshot behavior
- update event
- delete/tombstone event
- schema evolution scenario
- duplicate delivery handling
- consumer idempotency
- replay behavior
- DLQ behavior
- sensitive-field masking
- connector restart/rebalance scenario

## 22. Common anti-patterns

### 22.1 Raw table event as domain event

Bad:

```text
Consumer subscribes to cdc.customer table and treats every update as CustomerUpdated business event.
```

Why bad:

- Table schema leaks internal implementation.
- Multiple row changes may represent one business action.
- One row change may not have business significance.
- Consumer breaks when schema changes.

Required:

- Use outbox for semantic events.
- Use raw CDC only for projection/replication-style use cases.

### 22.2 Capture everything

Bad:

```text
table.include.list is omitted because all tables might be useful later.
```

Required:

- Explicit include list.
- Data classification review.
- Topic ownership.

### 22.3 No consumer idempotency

Bad:

```text
Consumer sends notification/email/payment side effect on every event without dedupe.
```

Required:

- Dedupe by event ID.
- Persist side-effect status.
- Make retries safe.

### 22.4 Business logic in SMT

Bad:

```text
Complex conditional business transformation in SMT chain.
```

Required:

- SMT for simple transformation only.
- Business rules in service/stream processor.

### 22.5 Unbounded replication log risk

Bad:

```text
Connector is down for days while source database retains WAL/binlog because slot is active.
```

Required:

- Monitor source log retention and connector lag.
- Alert before storage risk.
- Document recovery window.

## 23. LLM implementation checklist

Before finalizing any Debezium-related answer, the LLM MUST verify:

- [ ] Correct spelling `Debezium` is used in technical text.
- [ ] Raw CDC vs outbox use case is classified.
- [ ] Connector owner is stated.
- [ ] Source database/version is stated.
- [ ] Captured tables are explicit.
- [ ] Snapshot mode is explicit.
- [ ] Topic naming is explicit.
- [ ] Key/partition strategy is explicit.
- [ ] Delete/tombstone behavior is explicit.
- [ ] Schema evolution strategy is explicit.
- [ ] Consumers are idempotent.
- [ ] Sensitive fields are handled.
- [ ] Observability metrics are listed.
- [ ] Failure/recovery path is described.
- [ ] Connector config is treated as code.

## 24. Enforcement snippet for LLM/code agent

```text
When implementing Debezium CDC:
1. First classify the use case as raw CDC or semantic outbox event.
2. Never expose raw table CDC as a business event unless explicitly justified.
3. Always define connector owner, source DB, table include list, snapshot mode, topic naming, keying, delete handling, schema evolution, and consumer idempotency.
4. Treat connector config as production code.
5. Do not put business logic in SMTs.
6. Do not store credentials in Git.
7. Require observability for lag, task failure, DLQ/error count, and source log retention risk.
8. If any of these are unknown, generate a draft with explicit TODOs rather than pretending the CDC design is production-ready.
```

## 25. Acceptance criteria

A Debezium design or implementation is acceptable only if:

- It clearly distinguishes CDC from domain events.
- It uses transactional outbox for semantic integration events.
- It avoids capture-everything defaults.
- It defines snapshot, schema evolution, delete, and replay behavior.
- It makes consumers idempotent.
- It protects sensitive data.
- It is observable and operable.
- It has a documented recovery path.

## 26. References

- Debezium official documentation.
- Debezium Outbox Event Router documentation.
- Kafka Connect documentation.
- Kafka documentation.
- Enterprise Integration Patterns: Event Message.
- Internal standards: `strict-general-standards__event_design.md`, `strict-general-standards__kafka.md`, `strict-general-standards__kafka_connect.md`, `strict-general-standards__security_design.md`.
