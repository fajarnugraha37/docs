# Strict General Standards: Kafka ksqlDB / KSQL

> Canonical product name: **ksqlDB**.  
> File name follows the requested `kafka_ksql` naming because many teams still refer to the SQL layer as KSQL. Implementation text SHOULD use `ksqlDB` unless referring to legacy KSQL specifically.

## 1. Purpose

This standard defines mandatory rules for designing, implementing, deploying, and reviewing ksqlDB/KSQL usage in systems generated, modified, or reviewed by an LLM/code agent.

ksqlDB MUST be treated as a Kafka-native stream/table processing layer for declarative stream transformations, materialized views, and real-time query patterns. It MUST NOT be treated as a general-purpose OLTP database, service domain layer, workflow engine, or unrestricted replacement for application code.

## 2. Scope

This standard applies to:

- ksqlDB streams.
- ksqlDB tables.
- Persistent queries.
- Push queries.
- Pull queries.
- CTAS/CSAS statements.
- Joins, aggregations, windows, repartitioning, and materialized views.
- ksqlDB REST API usage.
- ksqlDB CI/CD and operations.
- Kafka topics created or consumed by ksqlDB.

## 3. Non-negotiable principles

1. **Stream and table semantics must be explicit**  
   A stream is an unbounded sequence of events. A table is current state by key. LLM MUST not use them interchangeably.

2. **ksqlDB is not the domain service**  
   Business invariants, authorization, command validation, and transaction boundaries belong in application/domain services.

3. **Persistent queries are production workloads**  
   Persistent queries MUST be versioned, tested, monitored, and deployed through a controlled process.

4. **Keys determine correctness**  
   Joins, aggregations, materialized tables, partitioning, and pull queries depend on correct key design.

5. **Repartitioning is a cost and correctness decision**  
   `PARTITION BY` and implicit repartitioning MUST be justified and monitored.

6. **Event time must be deliberate**  
   Windowed processing MUST define timestamp source, grace period, late events, and timezone semantics.

7. **Result topics are contracts**  
   Topics created by CSAS/CTAS MUST follow naming, schema, retention, ACL, and ownership standards.

8. **State stores are operational state**  
   Materialized views and RocksDB state need disk, restoration, changelog, monitoring, and capacity planning.

## 4. Required design questions before implementation

Before generating ksqlDB statements or architecture, the LLM MUST answer:

- What problem is being solved: transformation, filtering, enrichment, aggregation, materialized view, query API, or monitoring?
- Is the input modeled as a stream or table?
- What is the Kafka key and why?
- What are the input topics, formats, and schemas?
- What output topics are created?
- What query type is used: persistent, push, or pull?
- Is the result replayable and deterministic?
- Are timestamps event-time, ingestion-time, or processing-time?
- How are late/out-of-order events handled?
- What retention/compaction is required?
- How are schema changes handled?
- What is the state store size expectation?
- What is the failure/restart behavior?
- How is correctness validated?

If these are missing, the LLM MUST NOT present the ksqlDB design as production-ready.

## 5. ksqlDB usage decision rule

Use ksqlDB when:

- transformation is declarative and stream/table-shaped
- materialized view is keyed and queryable
- filtering/routing is straightforward
- aggregation/windowing is understandable in SQL form
- enrichment uses Kafka table/stream inputs
- operational team can monitor query/state health

Prefer Kafka Streams, Flink, or application service when:

- complex custom logic is required
- fine-grained error handling is required
- external service/database calls are required inside processing
- sophisticated state machine transitions are required
- authorization/domain invariants are involved
- testing/debugging SQL would be harder than code
- exactly-once side effects outside Kafka are required

Forbidden:

```text
Use ksqlDB to implement command validation, authorization, and domain state transition rules.
```

## 6. Stream vs table standards

### 6.1 Stream

Use stream for:

- events/facts over time
- append-like event history
- event replay
- time-windowed processing
- event filtering/routing
- stream-stream joins

Rules:

- Stream names SHOULD be plural or event-like.
- Stream rows SHOULD represent facts/events, not current state snapshots unless explicitly modeled.
- Stream key MUST be correct for ordering and joins.

Example:

```sql
CREATE STREAM application_events (
  event_id VARCHAR KEY,
  aggregate_id VARCHAR,
  event_type VARCHAR,
  event_version INTEGER,
  occurred_at BIGINT,
  payload STRUCT<status VARCHAR, applicant_id VARCHAR>
) WITH (
  KAFKA_TOPIC = 'event.licensing.application.lifecycle',
  VALUE_FORMAT = 'JSON',
  TIMESTAMP = 'occurred_at'
);
```

### 6.2 Table

Use table for:

- current state by key
- compacted topics
- lookup/enrichment
- materialized aggregate state
- pull query serving

Rules:

- Table MUST have a key.
- Table topic SHOULD be compacted when representing current state.
- Updates MUST be idempotent by key.
- Table is not a full OLTP database substitute.

Example:

```sql
CREATE TABLE application_status_by_id AS
SELECT
  aggregate_id,
  LATEST_BY_OFFSET(payload->status) AS status,
  MAX(event_version) AS latest_version
FROM application_events
GROUP BY aggregate_id
EMIT CHANGES;
```

## 7. Query type standards

### 7.1 Persistent query

Persistent queries continuously process data and write to backing Kafka topics.

Use for:

- long-running transformations
- derived streams/tables
- materialized views
- production read models

Rules:

- MUST be deployed as code.
- MUST have stable output topic names.
- MUST have monitoring.
- MUST define reset/rebuild procedure.
- MUST define schema compatibility.

### 7.2 Push query

Push queries subscribe to ongoing changes and may return an indefinite/chunked response.

Use for:

- live UI updates
- operational dashboards
- event subscriptions
- asynchronous flows

Rules:

- MUST not be used as a normal request/response lookup.
- MUST have client cancellation/timeout behavior.
- MUST protect against unbounded fan-out.
- MUST be authenticated/authorized at API boundary.

### 7.3 Pull query

Pull queries retrieve current state from a materialized view and return finite results.

Use for:

- keyed request/response reads
- UI initial page state
- low-latency lookup by key

Rules:

- MUST query materialized views/tables suitable for pull query.
- MUST not be used for arbitrary analytical scans.
- MUST define freshness expectations.
- MUST handle view rebuild/unavailability.

## 8. Naming standards

Recommended naming:

```text
STREAM:  <domain>_<event_or_stream_name>_s
TABLE:   <domain>_<state_or_view_name>_t
QUERY:   <domain>_<purpose>_q
TOPIC:   derived.<domain>.<purpose>
```

Examples:

```text
licensing_application_events_s
licensing_application_status_t
licensing_application_status_q
derived.licensing.application-status
```

Rules:

- Names MUST identify domain and purpose.
- Do not use temporary names in production.
- Output topic names MUST be explicit for production CTAS/CSAS.
- Query names MUST be stable enough for monitoring.

## 9. Topic and schema standards

Every ksqlDB input/output topic MUST define:

- owner
- schema format
- key format
- value format
- retention policy
- compaction policy
- partition count
- ACLs
- compatibility rules

Rules:

1. Do not rely on auto-created production topics.
2. Do not use schema-less JSON for governed contracts unless explicitly accepted.
3. Output topics from CTAS/CSAS are public contracts if consumed by other systems.
4. Topic cleanup policy MUST match stream/table semantics.
5. Schema Registry SHOULD be used for production contracts.

## 10. Key and repartition standards

Correct keying is mandatory.

Rules:

- Declare key columns deliberately.
- Use `PARTITION BY` only when required and justified.
- Repartitioned intermediate topics MUST be understood and monitored.
- Joins MUST have compatible keys and formats.
- Aggregations MUST group by stable keys.
- Pull query tables MUST be keyed for lookup access.
- Random keys are forbidden for stateful processing.

Before using `PARTITION BY`, document:

- old key
- new key
- why repartition is required
- generated/internal topic impact
- ordering impact
- storage/network cost

## 11. Time and windowing standards

Windowed queries MUST explicitly define time semantics.

Required decisions:

- event-time field
- timestamp extraction
- timezone normalization
- window type: tumbling, hopping, session
- window size
- grace period
- late event behavior
- retention
- output update semantics

Rules:

1. Do not use processing time accidentally.
2. Do not ignore late events unless business allows it.
3. Window size MUST match business question.
4. Grace period MUST be documented.
5. Downstream consumers MUST understand that aggregate results may update as late events arrive.

## 12. Join standards

Every join MUST document:

- stream-table, stream-stream, or table-table
- join key
- join window, if applicable
- null/missing side behavior
- late event behavior
- cardinality expectations
- repartitioning cost
- result correctness assumptions

Rules:

- Do not join on non-key fields without explicit repartition strategy.
- Do not implement complex many-to-many enrichment without capacity review.
- Do not assume relational database join semantics fully apply.
- External database lookup inside ksqlDB is not allowed.

## 13. Materialized view standards

Materialized views MUST be treated as operational read models.

Rules:

- Define owner and consumers.
- Define rebuild procedure.
- Define freshness SLA.
- Define state size estimate.
- Define changelog topic behavior.
- Define RocksDB/local state disk requirements.
- Define pull query access pattern, if any.
- Monitor restoration time.

Do not use materialized views as the only authoritative source for domain state.

## 14. Deployment standards

ksqlDB statements MUST be deployed through CI/CD.

Required:

- SQL files in version control.
- Environment-specific variables separated from SQL logic.
- Validation in lower environment.
- Schema compatibility checks.
- Query naming/versioning.
- Rollback/rebuild procedure.
- Output topic ownership.
- Migration notes for breaking changes.

Forbidden:

```text
Manually create production persistent query from CLI without version control.
```

## 15. Reset and rebuild standards

For every persistent query/materialized view, document:

- how to stop query
- how to reset offsets/state
- how to delete/recreate output topics, if required
- how to replay input topics
- expected rebuild duration
- consumer impact
- data correctness validation

Rules:

- Rebuild MUST not surprise downstream consumers.
- Output topic deletion MUST require approval.
- Replay MUST be deterministic or differences must be explained.

## 16. Security standards

Rules:

- ksqlDB REST API MUST be protected.
- Kafka ACLs MUST restrict input/output/internal topics.
- Queries MUST not expose PII accidentally.
- Sensitive fields MUST be masked or excluded.
- Pull/push query access MUST be authorized at the API boundary.
- ksqlDB service principal MUST use least privilege.
- Logs MUST not leak payloads with sensitive data.

## 17. Observability requirements

Every production ksqlDB deployment MUST monitor:

- server health
- persistent query status
- input lag
- processing rate
- error rate
- failed records
- internal topic health
- state store disk usage
- state restoration time
- query restart count
- consumer group lag
- output topic throughput
- pull query latency
- push query connection count

Dashboards MUST include:

- query health
- lag and throughput
- state store capacity
- errors and restarts
- output freshness
- consumer-facing query latency

## 18. Testing requirements

LLM-generated ksqlDB work MUST include or request tests for:

- stream/table schema creation
- key correctness
- value format compatibility
- filter behavior
- aggregation correctness
- join correctness
- window/late event behavior
- repartition behavior
- output topic shape
- schema evolution
- replay determinism
- pull query result
- push query cancellation
- state rebuild

## 19. Common anti-patterns

### 19.1 ksqlDB as domain service

Bad:

```text
ksqlDB validates command authorization and decides state transitions.
```

Required:

- Domain service handles command validation, authorization, and transaction.
- ksqlDB may derive read models/events after committed facts.

### 19.2 Stream/table confusion

Bad:

```text
Use stream to answer current status by scanning all historical events for each request.
```

Required:

- Build keyed table/materialized view.

### 19.3 Arbitrary query API

Bad:

```text
Expose ksqlDB pull queries directly as public flexible SQL endpoint.
```

Required:

- Put controlled API boundary in front.
- Expose only approved query patterns.

### 19.4 Hidden repartition explosion

Bad:

```sql
CREATE STREAM x AS SELECT * FROM a JOIN b ON a.non_key = b.non_key EMIT CHANGES;
```

Required:

- Define keys and repartition consciously.
- Estimate intermediate topic and state cost.

### 19.5 Manual production query drift

Bad:

```text
Hotfix query in production CLI, forget to commit SQL.
```

Required:

- SQL-as-code.
- Drift detection.

## 20. LLM implementation checklist

Before finalizing ksqlDB work, the LLM MUST verify:

- [ ] Use case is appropriate for ksqlDB.
- [ ] Stream vs table semantics are explicit.
- [ ] Query type is explicit: persistent, push, or pull.
- [ ] Input/output topics are explicit.
- [ ] Key design is correct.
- [ ] Repartitioning is justified.
- [ ] Time/window semantics are defined.
- [ ] Join assumptions are documented.
- [ ] Schema/format compatibility is defined.
- [ ] Output topics are named and owned.
- [ ] Security/ACLs are considered.
- [ ] Observability is defined.
- [ ] Reset/rebuild procedure is documented.

## 21. Enforcement snippet for LLM/code agent

```text
When implementing ksqlDB/KSQL:
1. First decide whether each input is a stream or table.
2. Define key, topic, schema format, timestamp semantics, and query type.
3. Use persistent queries for derived topics/views, push queries for live subscriptions, and pull queries for keyed current-state reads.
4. Do not use ksqlDB for domain command validation, authorization, or OLTP state transitions.
5. Explicitly justify repartitioning, joins, windows, and materialized views.
6. Treat SQL statements and output topics as production contracts.
7. Require monitoring for query health, lag, errors, state store size, and output freshness.
8. If rebuild/replay behavior is unknown, mark the design incomplete.
```

## 22. Acceptance criteria

A ksqlDB design or implementation is acceptable only if:

- It uses ksqlDB for the right class of problem.
- Stream/table semantics are correct.
- Keys and repartitioning are deliberate.
- Query type is appropriate.
- Time/window behavior is explicit.
- Output topics are governed contracts.
- State and replay behavior are operable.
- Security and observability are included.

## 23. References

- Confluent ksqlDB documentation.
- Confluent ksqlDB streams and tables documentation.
- Confluent ksqlDB push and pull query documentation.
- Confluent ksqlDB materialized views documentation.
- Apache Kafka documentation.
- Internal standards: `strict-general-standards__kafka.md`, `strict-general-standards__event_design.md`, `strict-general-standards__command_design.md`, `strict-general-standards__security_design.md`.
