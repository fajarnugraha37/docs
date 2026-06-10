# Strict Coding Standards: Java + Kafka ksqlDB

> This standard is mandatory for LLM-assisted Java implementation that creates, deploys, modifies, or calls **ksqlDB** applications.
>
> It is an overlay on top of:
>
> - `strict-coding-standards__java_kafka.md`
> - `strict-coding-standards__java_kafka_stream.md`
> - `strict-coding-standards__java_http.md`
> - `strict-coding-standards__java_json.md`
> - `strict-coding-standards__java_error_handling.md`
> - `strict-coding-standards__java_telemetry.md`
>
> ksqlDB is not “just SQL”. ksqlDB statements are translated into long-running Kafka Streams applications. Treat every persistent query as production streaming code with schema, state, offset, partitioning, retry, observability, and migration consequences.

---

## 1. Scope

This file applies when Java code or repository artifacts interact with ksqlDB through any of the following:

- ksqlDB Java client
- ksqlDB REST API
- ksqlDB CLI scripts committed to the repository
- headless ksqlDB deployments
- CI/CD-managed ksqlDB migrations
- persistent queries using `CREATE STREAM AS SELECT` or `CREATE TABLE AS SELECT`
- push queries and pull queries from Java services
- ksqlDB-backed materialized views
- ksqlDB UDF/UDAF/UDTF written in Java
- ksqlDB schema, topic, stream, table, and query lifecycle management

This file does **not** replace Kafka Streams standards. If transformation logic requires custom Java processing, explicit state-store design, custom partitioning, external I/O, or advanced lifecycle control, use Kafka Streams directly instead of hiding complexity in ksqlDB.

---

## 2. Non-negotiable Principles

### 2.1 ksqlDB statements are deployable application code

Every production ksqlDB statement must be treated like source code:

- versioned in Git
- peer-reviewed
- tested against realistic topics/schemas
- deployed through CI/CD
- observable after deployment
- reversible or safely replaceable
- documented with source topics, output topics, key semantics, and processing guarantee

**Forbidden:** creating or changing production streams, tables, persistent queries, or connectors manually from an interactive console without a tracked deployment artifact.

### 2.2 ksqlDB is for stream processing, not arbitrary service logic

Allowed:

- filtering streams
- projections
- stateless enrichment
- stream-table joins
- table-table joins when semantics are clear
- aggregations and windows
- materialized read models
- real-time denormalized topics
- simple SQL-level event transformation

Restricted:

- complex business workflows
- multi-step state machines
- regulatory/audit-critical decision logic
- large branching policy logic
- external service calls
- side effects outside Kafka
- workflows requiring human-in-the-loop decisions

Forbidden by default:

- treating ksqlDB as the only source of truth for business state
- using ad-hoc push queries as production workflow orchestration
- encoding irreversible business decisions in unreviewed SQL strings inside Java code
- using ksqlDB to mutate external systems

---

## 3. Version and Compatibility Rules

### 3.1 ksqlDB server version must be explicit

Every repository using ksqlDB must document:

```text
ksqlDB server version: <version>
Confluent Platform version: <version if applicable>
Kafka broker version: <version>
Schema Registry version: <version>
ksqlDB Java client version: <version>
Serialization formats: AVRO | PROTOBUF | JSON_SR | JSON | KAFKA | DELIMITED
Processing guarantee: at_least_once | exactly_once_v2
Deployment mode: interactive | headless | CI-managed REST/CLI
```

**Forbidden:** “works with latest ksqlDB” without a tested version matrix.

### 3.2 Prefer the official Java client for Java applications

For Java applications that programmatically interact with ksqlDB, prefer the official ksqlDB Java client.

Allowed Java client use cases:

- execute one approved statement
- run controlled pull query
- run bounded push query with cancellation
- insert rows into existing streams when explicitly approved
- list/describe streams, tables, topics, and queries for admin/health tooling

Restricted:

- creating production streams/tables from normal application request paths
- executing user-generated SQL
- embedding long SQL strings directly inside service methods
- executing DDL/DML outside deployment flow

Forbidden:

- raw string-concatenated SQL with user input
- runtime query generation without allow-listed templates
- application path that creates/drops/terminates persistent queries based on normal user traffic

### 3.3 REST API use must be deliberate

The ksqlDB REST API may be used when the Java client cannot express a required operation or for deployment automation.

Rules:

- Set `Content-Type: application/vnd.ksql.v1+json`.
- Use `/ksql` for statements/commands.
- Use `/query-stream` for streaming query results.
- Treat streaming responses as long-lived resources.
- Configure connect timeout, request timeout, read/stream timeout policy, and cancellation.
- Do not log raw SQL containing secrets or tenant-sensitive predicates.

Forbidden:

- unbounded REST streaming response without cancellation
- REST client created per request
- missing timeout
- missing authentication/TLS
- ad-hoc curl scripts as production deployment mechanism unless wrapped by CI with review and audit

---

## 4. Architecture Decision Matrix

| Need                                  |                  Preferred Tool | ksqlDB allowed? | Notes                                             |
| ------------------------------------- | ------------------------------: | --------------: | ------------------------------------------------- |
| SQL-like stream projection/filter     |                          ksqlDB |             Yes | Good fit.                                         |
| Simple stream aggregation/window      |                          ksqlDB |             Yes | Require window/grace/retention review.            |
| Materialized read model from Kafka    |                          ksqlDB |             Yes | Pull queries must be key-oriented.                |
| Complex Java state machine            |         Kafka Streams / service |      Usually no | Keep logic explicit and testable.                 |
| External HTTP/database call per event |     Service / connector pattern |              No | ksqlDB queries must not do external side effects. |
| Custom state-store logic              |                   Kafka Streams |      Usually no | ksqlDB hides internals.                           |
| Regulatory decision logic             |      Java service + audit model |      Restricted | SQL alone is usually too opaque.                  |
| BI/offline analytics                  | Warehouse / lakehouse / OLAP DB |      Usually no | ksqlDB is for streaming operational workloads.    |
| Ad-hoc exploration                    |                          CLI/UI | Yes in non-prod | Must not become production dependency.            |

---

## 5. Repository Layout Rules

A repository owning ksqlDB artifacts should use a predictable structure:

```text
ksql/
  README.md
  environments/
    dev.properties
    uat.properties
    prod.properties
  migrations/
    V001__create_sources.sql
    V002__create_read_models.sql
    V003__upgrade_customer_status_v2.sql
  queries/
    customer_status_view.sql
    compliance_case_metrics.sql
  tests/
    fixtures/
      input-events.jsonl
      expected-output.jsonl
    query-contracts.md
```

Rules:

- SQL statements must be committed as files, not hidden in Java strings.
- Each SQL file must contain exactly one deployable concern or a clearly ordered migration group.
- Every persistent query must have a name, owner, source topic(s), output topic(s), key, value format, and upgrade policy.
- Java code may reference SQL resources by classpath path, not duplicate SQL literals.

Forbidden:

- anonymous SQL string blobs in application methods
- no-owner persistent query
- no-output-topic documentation
- production statements that differ from committed artifact

---

## 6. SQL Statement Standards

### 6.1 DDL must be explicit

Every `CREATE STREAM` and `CREATE TABLE` must explicitly define:

- Kafka topic name
- key format if relevant
- value format
- key column semantics
- timestamp column if event time is used
- partitions/replication expectation if topic creation is managed by ksqlDB
- schema compatibility expectation

Example:

```sql
CREATE STREAM order_events (
  order_id STRING KEY,
  customer_id STRING,
  status STRING,
  event_time BIGINT
) WITH (
  KAFKA_TOPIC = 'orders.events.v1',
  KEY_FORMAT = 'KAFKA',
  VALUE_FORMAT = 'AVRO',
  TIMESTAMP = 'event_time'
);
```

Forbidden:

- implicit topic naming for production output unless documented
- missing key semantics
- using processing time when event time is required
- using unversioned topic names for public/event-contract topics

### 6.2 DML must have ownership metadata

Every persistent query must be documented with:

```text
Query name:
Purpose:
Owner team/service:
Source stream/table:
Source topic(s):
Output stream/table:
Output topic:
Key:
Value format:
Processing guarantee:
Expected event-time behavior:
Window/grace/retention if applicable:
Upgrade strategy:
Rollback/roll-forward strategy:
Monitoring metric(s):
```

### 6.3 One statement per Java client call

When using `executeStatement()` from Java:

- send exactly one statement per call
- track the statement ID/query ID returned by ksqlDB
- do not assume returned `CompletableFuture` means full query catch-up or output correctness
- follow with explicit verification if needed

Forbidden:

- multiple statements in one Java client request
- treating accepted statement as “fully processed”
- fire-and-forget production DDL/DML without verification

---

## 7. Stream and Table Semantics

### 7.1 Use STREAM for event facts

Use `STREAM` for immutable event facts:

- commands
- domain events
- status changes
- measurements
- audit events
- click/activity events

Rules:

- Events must be append-only.
- Event time must be explicit when ordering/windowing matters.
- Event keys must be stable for partitioning and joins.
- Null/tombstone semantics must be documented.

### 7.2 Use TABLE for latest state / changelog semantics

Use `TABLE` for keyed state:

- latest customer profile
- latest case status
- latest account configuration
- aggregate counts
- materialized views

Rules:

- Table key must represent identity.
- Upsert/tombstone semantics must be understood.
- Pull queries should target materialized tables with efficient key lookups.
- Do not use table semantics when every event matters independently.

### 7.3 Materialization must be intentional

Rules:

- A materialized table must have documented storage/state-store implications.
- Pull-query consumers must know whether table is queryable/materialized.
- State-store size must be bounded by retention/window/key cardinality design.

Forbidden:

- large unbounded materialized table without capacity estimate
- creating tables only because pull query is convenient
- table scan from Java request path

---

## 8. Topic, Key, Partitioning, and Repartition Rules

### 8.1 Keys are part of the contract

Every stream/table must define:

- logical key
- physical key serialization
- partitioning reason
- join/group-by compatibility
- repartition impact

Forbidden:

- relying on random/null keys for joined/aggregated streams
- changing key without migration plan
- repartitioning high-volume streams without capacity review

### 8.2 Repartitioning is restricted

`PARTITION BY`, `GROUP BY`, joins, and aggregations may trigger repartitioning.

Rules:

- Identify generated repartition topics.
- Estimate traffic amplification.
- Document expected partitions.
- Verify cleanup and retention.
- Verify key format after repartition.

Forbidden:

- accidental repartition topic explosion
- repartitioning sensitive payload into unmanaged topics
- grouping by high-cardinality unbounded field without capacity review

---

## 9. Serialization and Schema Registry Rules

### 9.1 Prefer schema-managed formats

Preferred:

- `AVRO`
- `PROTOBUF`
- `JSON_SR`

Restricted:

- plain `JSON`
- `KAFKA` for keys only when intentionally primitive/string
- `DELIMITED` for legacy ingestion only

Forbidden by default:

- unversioned JSON contracts for production service-to-service streams
- schema evolution without compatibility check
- changing field meaning without topic/schema versioning

### 9.2 Schema evolution must be reviewed

Every schema change must answer:

- Is it backward compatible?
- Is it forward compatible?
- Are defaults needed?
- Are consumers tolerant of missing fields?
- Are nullability and optionality explicit?
- Does the output topic require a new version?

---

## 10. Persistent Query Standards

### 10.1 Persistent query lifecycle

Persistent queries are production workloads.

Required lifecycle states:

```text
PROPOSED -> REVIEWED -> DEPLOYED -> MONITORED -> SUPERSEDED -> TERMINATED
```

Rules:

- Persistent query must be declared in a migration artifact.
- Query ID must be captured after deployment.
- Query status must be monitored.
- Output topic health must be monitored.
- Termination must be intentional and documented.

Forbidden:

- orphan persistent queries
- duplicate persistent query producing equivalent topic without ownership
- terminating query without understanding downstream consumers

### 10.2 Persistent query upgrade protocol

When changing a running persistent query:

1. Create a new versioned output stream/table/topic if output contract changes.
2. Deploy new query side-by-side when possible.
3. Validate output parity or intended delta.
4. Move consumers explicitly.
5. Terminate old query only after cutover.
6. Keep rollback/roll-forward path documented.

Restricted:

- replacing query in-place
- reusing output topic with incompatible schema
- relying on manual offset reset in production

Forbidden:

- editing production query behavior without migration artifact
- silently changing output topic schema
- deleting old query before downstream consumers are migrated

---

## 11. Pull Query Standards

Pull queries are for materialized state lookups, not general SQL analytics.

Rules:

- Prefer key lookup.
- Always set client-side timeout.
- Always bound result size.
- Do not issue pull-query bursts without rate limiting.
- Do not table-scan from request path.
- Use dedicated materialized view if access pattern is not efficient.

Allowed:

```sql
SELECT *
FROM customer_status_view
WHERE customer_id = 'C123';
```

Restricted:

```sql
SELECT *
FROM customer_status_view
WHERE region = 'WEST';
```

Forbidden by default:

```sql
SELECT *
FROM customer_status_view;
```

Java rules:

- Map result rows to explicit DTOs.
- Do not expose raw row maps across service boundary.
- Handle zero-row, one-row, and multiple-row cases explicitly.
- Treat timeout as expected failure mode.

---

## 12. Push Query Standards

Push queries are subscriptions over long-lived connections.

Rules:

- Use only for live subscriptions, diagnostics, or controlled streaming consumers.
- Always provide cancellation.
- Always provide max duration or lifecycle owner.
- Apply backpressure or downstream buffering limits.
- Do not run unbounded push queries per user/session without capacity review.
- Do not use push query as replacement for Kafka consumer group when durable consumption is required.

Forbidden:

- push query from HTTP request thread without cancellation
- one push query per tenant/user with no capacity model
- push query used for reliable event processing that must survive service restart

---

## 13. Java Client Standards

### 13.1 Client lifecycle

Rules:

- Create ksqlDB client as lifecycle-managed singleton/component.
- Configure server URL, authentication, TLS, timeouts, and client options centrally.
- Close client on application shutdown.
- Do not create client per request.
- Do not mutate shared client configuration after startup.

### 13.2 Async behavior

The Java client uses asynchronous APIs for many operations.

Rules:

- Do not block event-loop/reactive threads with `.get()`/`.join()`.
- Propagate cancellation when caller abandons request.
- Apply timeout around futures.
- Preserve exception cause.
- Convert client errors into application-level failure types.

Forbidden:

- `.join()` in request thread without timeout
- swallowing `CompletableFuture` exceptions
- ignoring interrupted state when blocking cannot be avoided

### 13.3 SQL parameterization policy

ksqlDB does not make arbitrary SQL string construction safe.

Rules:

- Use allow-listed SQL templates.
- Validate stream/table/query identifiers against an allow-list.
- Treat values and identifiers differently.
- Do not concatenate user-controlled identifiers.
- Do not expose SQL endpoint to users.

Forbidden:

```java
String sql = "SELECT * FROM " + request.getStreamName() + " EMIT CHANGES";
```

Allowed pattern:

```java
enum QueryTemplate {
    CUSTOMER_STATUS_BY_ID("SELECT * FROM customer_status_view WHERE customer_id = '%s';");
}
```

Even with templates, values must be validated/escaped according to the ksqlDB query mechanism available in the project. Prefer fixed query shapes with strongly typed DTO inputs.

---

## 14. Processing Guarantees

### 14.1 Default is at-least-once

Rules:

- Assume at-least-once unless `processing.guarantee` is explicitly configured and verified.
- Downstream consumers must be idempotent.
- Output topics may contain duplicates under at-least-once behavior.
- Aggregation output consumers must tolerate reprocessing semantics.

### 14.2 Exactly-once is restricted

`exactly_once_v2` may be used only when:

- Kafka broker version supports it.
- ksqlDB/Confluent Platform version supports it.
- query state/output requires it.
- downstream and upstream semantics are compatible.
- performance cost is accepted.
- operational runbook exists.

Important limitation:

- Exactly-once stream processing does not make external consumers or systems exactly-once by magic.
- End-to-end exactly-once requires every stage to participate in the guarantee or be idempotent.

Forbidden:

- claiming end-to-end exactly-once solely because ksqlDB has `exactly_once_v2`
- using exactly-once as a substitute for idempotency keys

---

## 15. Time, Window, and Late Event Rules

### 15.1 Event time must be explicit

For event-driven systems, use event time when business semantics depend on occurrence time.

Rules:

- Specify timestamp column when needed.
- Define event-time source.
- Define lateness behavior.
- Define window type: tumbling, hopping, session.
- Define grace period and retention where applicable.

Forbidden:

- relying on processing time for audit/regulatory timelines unless explicitly justified
- changing window size/grace without downstream review

### 15.2 Windowed outputs require special contract

Document:

- window start/end
- key format
- late event behavior
- duplicate/update behavior
- retention
- output compaction/deletion policy

---

## 16. Joins

### 16.1 Join semantics must be reviewed

Every join must document:

- stream-stream, stream-table, or table-table
- join key
- repartition requirement
- window if stream-stream
- null/non-match behavior
- expected cardinality
- source topic ordering assumptions
- state-store size estimate

Forbidden:

- joining on fields with incompatible partitioning without acknowledging repartition
- joining high-cardinality streams without state capacity review
- table-table join used as hidden relational database replacement

---

## 17. Error Handling and Processing Log

Rules:

- Enable and monitor processing logs for production ksqlDB deployments.
- Treat deserialization errors, schema errors, and processing errors as operational signals.
- Define poison-event behavior.
- Define whether bad records are skipped, logged, routed, or stop deployment.
- Track query status and failed tasks.

Forbidden:

- ignoring processing log
- hiding deserialization errors behind generic application errors
- no alert on persistent query failure
- allowing continuous data loss without metric/alert

---

## 18. Security Standards

Rules:

- Use TLS for ksqlDB server communication in production.
- Use managed secrets for API keys/passwords.
- Do not log credentials, raw secrets, or sensitive SQL predicates.
- Restrict who can create/drop/terminate streams, tables, topics, connectors, and queries.
- Use service identity with least privilege.
- Apply Kafka ACLs for source/output/internal topics.
- Protect Schema Registry credentials.
- Sanitize query labels, comments, and metadata.

Forbidden:

- hardcoded ksqlDB credentials
- admin credentials in application runtime unless required and justified
- user-controlled SQL execution
- open ksqlDB REST endpoint without authentication
- exposing internal query names or topology details to untrusted clients

---

## 19. Observability Standards

Every production ksqlDB workload must expose or document:

- query ID
- query state/status
- input topic lag
- output topic production rate
- error rate
- deserialization failure count
- processing log volume
- state store size if applicable
- pull query latency
- push query connection count
- ksqlDB server CPU/memory
- Kafka Streams task failure/rebalance indicators

Java application callers must log:

- ksqlDB operation type
- statement/query template name, not raw full SQL if sensitive
- query ID when available
- duration
- result count for bounded queries
- timeout/cancellation
- error class
- correlation ID / trace ID

Forbidden:

- logging full payload rows with PII/secrets
- metric labels containing raw SQL, tenant ID, user ID, or unbounded stream/table names
- no dashboard/runbook for persistent queries

---

## 20. Performance Standards

### 20.1 Capacity review required for persistent queries

Every persistent query must have a basic capacity note:

```text
Input topics:
Input event rate:
Input partitions:
Output topics:
Output event rate estimate:
Stateful? yes/no
State estimate:
Repartition topics:
Window retention:
Expected lag threshold:
Scaling strategy:
```

### 20.2 Pull queries are not OLTP by default

Rules:

- Prefer key lookup.
- Rate limit request path usage.
- Cache only if correctness allows.
- Monitor latency and concurrency.
- Avoid table scans.

### 20.3 Avoid query explosion

Forbidden:

- generating one persistent query per tenant/user/customer
- creating topic per small customer without platform approval
- one push query per browser tab/session without capacity model
- materializing every possible read view “just in case”

---

## 21. Deployment Standards

### 21.1 Production deployment must be reproducible

Allowed production deployment modes:

- headless ksqlDB with reviewed SQL file
- CI/CD executing reviewed SQL through Java client/REST/CLI
- platform-managed deployment with audited change record

Forbidden:

- manual console-only production changes
- modifying production query through emergency CLI without follow-up migration artifact
- no environment parity check

### 21.2 Environment properties must be externalized

Externalize:

- bootstrap servers
- ksqlDB server URL
- Schema Registry URL
- credentials
- topic prefix/suffix if environment-specific
- processing guarantee
- security protocol
- replication factor / partitions if applicable

Do not externalize business SQL semantics in a way that production behavior differs from reviewed code.

---

## 22. Testing Standards

Required test categories:

1. **SQL syntax validation**
   - statements parse and execute against test ksqlDB
2. **Schema compatibility test**
   - input/output schemas registered and compatible
3. **Golden event test**
   - input events produce expected output events
4. **Late/out-of-order event test**
   - window/grace behavior validated
5. **Duplicate event test**
   - idempotency/aggregation behavior understood
6. **Bad record test**
   - malformed payload behavior verified
7. **Query upgrade test**
   - old and new query behavior compared where relevant
8. **Java client test**
   - timeout, cancellation, error mapping, row mapping
9. **Security test**
   - no user-generated SQL, credentials protected
10. **Observability test**

- query IDs/errors/metrics/logs available

Preferred tools:

- Testcontainers for Kafka/Schema Registry/ksqlDB where feasible
- integration test topics with deterministic names
- schema fixtures
- JSON/Avro/Protobuf golden records
- contract tests for DTO mapping

Forbidden:

- testing only by visual CLI inspection
- no assertion on output topic
- no test for schema evolution
- no test for timeout/cancellation on pull/push query Java client

---

## 23. Java UDF/UDAF/UDTF Standards

Java user-defined functions are restricted.

Allowed only when:

- built-in ksqlDB functions are insufficient
- function is deterministic unless explicitly documented
- no external I/O
- no hidden mutable global state
- no random/time dependency unless explicit
- null behavior is tested
- serialization/typing is tested
- performance benchmark exists for high-throughput use

Forbidden:

- UDF making HTTP/database calls
- UDF reading files/secrets at runtime
- UDF with unbounded cache
- UDF hiding business rules that should live in reviewed Java service
- UDF logging sensitive input values

---

## 24. Anti-patterns

Forbidden or must trigger review:

- “It is just SQL, no test needed.”
- SQL strings generated from user input.
- Persistent query created manually in production.
- Pull query used as general API database.
- Push query used as durable consumer.
- One query per tenant/user.
- Output topic schema changed silently.
- Materialized table with no capacity estimate.
- Join without key/repartition review.
- Window without event-time/grace review.
- Exactly-once claim without downstream idempotency.
- No processing log monitoring.
- No timeout on Java client call.
- `executeStatement()` treated as proof that all output is ready.
- ksqlDB UDF with external side effects.
- Console-created query with no Git artifact.

---

## 25. Required Design Note for Every ksqlDB Change

Every LLM-generated ksqlDB change must include this note:

```markdown
## ksqlDB Design Note

### Purpose

### Why ksqlDB instead of Kafka Streams / service code?

### Source streams/tables/topics

### Output streams/tables/topics

### Key and partitioning

### Serialization and schema evolution

### Stream/table semantics

### Query type

- [ ] Persistent
- [ ] Pull
- [ ] Push

### Processing guarantee

### Time/window/grace behavior

### State/materialization impact

### Repartition/internal topic impact

### Failure and poison-record behavior

### Deployment/migration plan

### Rollback/roll-forward plan

### Observability plan

### Tests added
```

If the LLM cannot fill this note, it must not generate the implementation as final.

---

## 26. Reviewer Checklist

A reviewer must reject the change if any answer is missing:

### ksqlDB fit

- [ ] Is ksqlDB the right tool for this logic?
- [ ] Is business logic simple enough for SQL-level stream processing?
- [ ] Are external side effects absent?

### Query lifecycle

- [ ] Are SQL artifacts versioned?
- [ ] Is deployment reproducible?
- [ ] Is query ID/state monitored?
- [ ] Is upgrade/rollback plan clear?

### Schema and topics

- [ ] Are source and output topics named explicitly?
- [ ] Are formats explicit?
- [ ] Are schemas compatible?
- [ ] Is key semantics documented?

### Performance

- [ ] Are repartitions identified?
- [ ] Are state stores/materialized views justified?
- [ ] Are pull queries key-oriented?
- [ ] Are push queries bounded/cancellable?

### Correctness

- [ ] Is event time correct?
- [ ] Are window/grace semantics correct?
- [ ] Are duplicates/retries handled?
- [ ] Is processing guarantee explicit?

### Java client

- [ ] Is client lifecycle-managed?
- [ ] Are timeouts configured?
- [ ] Are futures handled safely?
- [ ] Is SQL generation allow-listed?
- [ ] Are rows mapped to DTOs explicitly?

### Security

- [ ] No user-generated SQL?
- [ ] TLS/auth enabled?
- [ ] Secrets not logged?
- [ ] ACLs and credentials least-privilege?

### Observability

- [ ] Processing log monitored?
- [ ] Metrics/logs/traces available?
- [ ] Alerting covers query failure and lag?

### Tests

- [ ] Golden input/output tests exist?
- [ ] Schema compatibility tested?
- [ ] Failure/late/duplicate tests exist?
- [ ] Java client timeout/cancellation tested?

---

## 27. LLM Prompt Contract

When implementing ksqlDB-related Java code or SQL, the LLM must follow this contract:

```text
You are modifying Java + ksqlDB code.

Before writing code or SQL:
1. Identify whether this is persistent query, pull query, push query, UDF, admin operation, or deployment automation.
2. Identify source topics, output topics, stream/table semantics, key, serialization format, and schema evolution impact.
3. Decide whether ksqlDB is the right tool instead of Kafka Streams/service code.
4. State processing guarantee and idempotency assumptions.
5. State timeout/cancellation behavior for Java client calls.
6. State deployment and rollback/roll-forward plan.

During implementation:
- Do not embed unreviewed SQL blobs in service methods.
- Do not concatenate user-controlled SQL identifiers.
- Do not create/terminate production persistent queries from normal request paths.
- Do not use push queries as durable consumers.
- Do not use pull queries as general table scans.
- Always configure timeouts and handle CompletableFuture failures.
- Always map rows to explicit DTOs.
- Always add tests for golden events, schema compatibility, and failure behavior.

After implementation:
- Provide ksqlDB Design Note.
- Provide reviewer checklist answers.
- List generated/changed streams, tables, topics, and persistent queries.
```

---

## 28. Source Anchors

Use these primary references when reviewing or updating this standard:

- Confluent ksqlDB overview: https://docs.confluent.io/platform/current/ksqldb/overview.html
- ksqlDB architecture and query lifecycle: https://docs.confluent.io/platform/current/ksqldb/operate-and-deploy/how-it-works.html
- ksqlDB query concepts: https://docs.confluent.io/platform/current/ksqldb/concepts/queries.html
- ksqlDB Java client: https://docs.confluent.io/platform/current/ksqldb/developer-guide/java-client/java-client.html
- ksqlDB REST API: https://docs.confluent.io/platform/current/ksqldb/developer-guide/ksqldb-rest-api/overview.html
- ksqlDB processing guarantees: https://docs.confluent.io/platform/current/ksqldb/operate-and-deploy/processing-guarantees.html
- ksqlDB pull query reference: https://docs.confluent.io/platform/current/ksqldb/developer-guide/ksqldb-reference/select-pull-query.html
- ksqlDB performance guidelines: https://docs.confluent.io/platform/current/ksqldb/operate-and-deploy/performance-guidelines.html
