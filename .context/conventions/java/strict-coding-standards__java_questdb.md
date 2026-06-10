# Strict Coding Standards: Java + QuestDB

> This document is an enforceable implementation standard for LLM code agents and human reviewers working on Java applications that integrate with QuestDB.
>
> QuestDB must be treated as a high-throughput time-series / analytical database, not as a general OLTP relational database. These rules are intentionally strict because incorrect ingestion, timestamp, partition, retry, or schema decisions can silently corrupt time-series meaning or create severe operational cost.

---

## 1. Scope

This standard applies to Java code that:

- ingests data into QuestDB using the official QuestDB Java ILP client;
- queries QuestDB using PostgreSQL Wire Protocol through JDBC/PostgreSQL-compatible drivers;
- manages QuestDB schema, partitions, designated timestamps, and retention from Java services;
- exports/imports data through REST/HTTP, PGWire, CSV, Parquet, or operational tooling;
- participates in observability, metrics, market data, event stream analytics, audit/event append workloads, or time-series reporting.

This standard must be used together with:

- `strict-coding-standards__java_best_practices.md`
- `strict-coding-standards__java_anti_pattern.md`
- `strict-coding-standards__java_jdbc.md`
- `strict-coding-standards__java_postgresql.md`
- `strict-coding-standards__java_http.md`
- `strict-coding-standards__java_network.md`
- `strict-coding-standards__java_json.md`
- `strict-coding-standards__java_time_date.md`
- `strict-coding-standards__java_number.md`
- `strict-coding-standards__java_telemetry.md`
- `strict-coding-standards__java_security.md`

---

## 2. Version and Compatibility Policy

### 2.1 QuestDB Server Version Must Be Explicit

Every module using QuestDB MUST document:

- QuestDB server version or supported version range;
- whether the deployment is OSS, Enterprise, Cloud, or BYOC;
- whether WAL tables are required;
- whether nanosecond timestamp precision is required;
- whether ILP over HTTP, ILP over TCP, PGWire, REST, or mixed access is used;
- whether high availability / replication / multi-endpoint ingestion is enabled.

Forbidden:

```text
"QuestDB latest"
"QuestDB compatible"
"Postgres-compatible, so any PostgreSQL behavior is fine"
```

Required:

```text
QuestDB server: 9.4.x
Ingestion: official Java ILP client over HTTP
Query path: PGWire via PostgreSQL JDBC driver
Timestamp precision: microsecond unless explicitly changed to nanosecond
Schema mode: explicit DDL, no production auto-create tables
```

### 2.2 Dependency Version Pinning

All Java dependencies MUST be pinned through Gradle version catalog, Maven dependency management, or platform/BOM.

Allowed:

```kotlin
dependencies {
    implementation("org.questdb:questdb-client:<pinned-version>")
    implementation("org.postgresql:postgresql:<pinned-version>")
}
```

Forbidden:

```kotlin
implementation("org.questdb:questdb-client:+")
implementation("org.postgresql:postgresql:latest.release")
```

### 2.3 Client Choice Matrix

| Use Case                       |                        Preferred Access Path | Notes                                          |
| ------------------------------ | -------------------------------------------: | ---------------------------------------------- |
| High-throughput ingestion      |            QuestDB Java ILP client over HTTP | Default for production write-heavy workloads   |
| Legacy ingestion compatibility |                                 ILP over TCP | Allowed only when justified; HTTP is preferred |
| Query / analytics              | PGWire via JDBC/PostgreSQL-compatible driver | Recommended query path                         |
| Low-volume inserts             |                              PGWire `INSERT` | Restricted; not for high-throughput ingestion  |
| Admin/query scripts            |                      REST/HTTP API or PGWire | Must be operationally controlled               |
| OLTP transactional mutation    |                                  Not QuestDB | Use PostgreSQL/Oracle/etc. instead             |

---

## 3. Architectural Rules

### 3.1 QuestDB Is an Analytical Time-Series Store

QuestDB MUST be used for:

- append-heavy event/time-series ingestion;
- telemetry, market data, financial ticks, IoT, logs/metrics-like datasets;
- analytical queries over time windows;
- `SAMPLE BY`, `LATEST ON`, `ASOF JOIN`, time-bucketed aggregates, and time-series joins;
- fast exploratory/query workloads over immutable or mostly immutable data.

QuestDB MUST NOT be used as:

- the system of record for transactional business state;
- a replacement for relational OLTP updates;
- a queue;
- a distributed lock store;
- a session store;
- a cache;
- a general mutable workflow database;
- a source of authorization truth.

### 3.2 Java Service Boundary

QuestDB code MUST be isolated behind an adapter/repository/gateway boundary.

Required package shape:

```text
com.example.marketdata.questdb
  QuestDbTickIngestionGateway.java
  QuestDbMarketDataQueryRepository.java
  QuestDbSchemaInitializer.java
  QuestDbClientConfig.java
```

Forbidden:

```text
service classes directly constructing ILP lines
controller calling QuestDB JDBC directly
business domain object depending on QuestDB client classes
```

### 3.3 Read and Write Paths Must Be Separated

Write path and query path MUST be separated because their correctness properties differ.

Allowed:

```text
IngestionGateway -> QuestDB ILP Sender
QueryRepository -> PGWire JDBC
```

Forbidden:

```text
one generic QuestDbRepository with insert/update/query/delete methods
```

Reason: ingestion has batching, retry, idempotency, deduplication, and timestamp correctness concerns; querying has result size, timeout, paging, and analytical correctness concerns.

---

## 4. Ingestion Standards

### 4.1 Use First-Party ILP Client for Production Ingestion

Production high-throughput ingestion MUST use QuestDB first-party ILP clients, preferably ILP over HTTP for modern deployments.

Allowed:

```java
try (Sender sender = Sender.builder(Sender.Transport.HTTP)
        .address("questdb.example.internal:9000")
        .autoFlushRows(5_000)
        .retryTimeoutMillis(10_000)
        .build()) {

    sender.table("market_ticks")
            .symbol("instrument", "EURUSD")
            .doubleColumn("bid", 1.08452d)
            .doubleColumn("ask", 1.08455d)
            .atNow();

    sender.flush();
}
```

The exact builder API may vary by client version. Code MUST follow the pinned client documentation.

### 4.2 Do Not Hand-Roll ILP Unless Explicitly Approved

Forbidden by default:

```java
String line = table + ",symbol=" + symbol + " price=" + price + " " + timestamp;
socket.write(line.getBytes(StandardCharsets.UTF_8));
```

Manual ILP encoding is allowed only when all of these are true:

- official client cannot be used;
- escaping rules are fully tested;
- timestamp precision is explicit;
- retry behavior is documented;
- malformed-line handling is tested;
- security review approves the transport and credentials.

### 4.3 Natural Batching, Not Artificial Latency

Ingestion batching MUST follow workload shape.

Allowed:

- flush after bounded row count;
- flush after bounded time window;
- flush at message batch boundary;
- flush during shutdown;
- flush after transactional outbox batch.

Forbidden:

- unbounded in-memory ingestion buffer;
- fixed sleep to accumulate rows without backpressure;
- per-row blocking flush in high-throughput path unless latency requirement explicitly demands it;
- dropping rows silently on failed flush.

### 4.4 Ingestion Backpressure

Every ingestion path MUST define behavior when QuestDB is slow/unavailable.

Required decision:

```text
When QuestDB ingestion fails:
- retry for N seconds
- then write to durable retry topic/table/file OR fail upstream request OR return backpressure
- never silently drop events
```

Forbidden:

```java
try {
    sender.flush();
} catch (Exception ignored) {
}
```

### 4.5 Retry and Duplicate Semantics

QuestDB ingestion retry may create duplicates unless deduplication or idempotent upstream design is used.

Every retrying ingestion flow MUST document:

- whether duplicate rows are acceptable;
- whether table-level deduplication is enabled;
- deduplication key columns;
- retry timeout;
- batch boundaries;
- failure routing.

Forbidden:

```text
"Retry is safe because QuestDB is fast."
```

Required:

```text
Retry safety:
- Duplicates are not acceptable.
- Table has deduplication configured on instrument + venue + event_id + timestamp.
- Producer retries for 10 seconds.
- After retry timeout, event is persisted to Kafka DLQ.
```

### 4.6 Multi-Endpoint Ingestion

Multiple QuestDB ILP endpoints are RESTRICTED.

Allowed only when:

- QuestDB version supports multi-URL client behavior;
- HA/replication semantics are understood;
- OSS split-brain/divergent primary risk is explicitly handled;
- retry timeout is configured for failover expectations;
- monitoring identifies active target.

Forbidden:

```text
Configure many OSS QuestDB primaries and let the client write anywhere.
```

### 4.7 Auto-Created Tables and Columns

Production services MUST NOT rely on uncontrolled auto-create tables/columns.

Allowed in development:

```text
line.auto.create.new.tables=true
line.auto.create.new.columns=true
```

Production default:

```text
line.auto.create.new.tables=false
line.auto.create.new.columns=false
```

Exception requires:

- schema governance policy;
- quarantine for unknown columns;
- alerting on rejected lines;
- table naming allow-list;
- migration plan.

### 4.8 Malformed Line Handling

The ingestion adapter MUST treat malformed row failures as data quality incidents.

Required:

- capture table name;
- capture source system;
- capture safe event ID / offset / correlation ID;
- capture error class;
- do not log full sensitive row by default;
- route rejected event to DLQ/quarantine.

Forbidden:

```text
Log raw ILP lines containing secrets, user data, or credentials.
```

---

## 5. Timestamp Standards

### 5.1 Every Time-Series Table Must Have a Designated Timestamp

Every table intended for time-series queries MUST have a designated timestamp column.

Required schema design note:

```text
Table: market_ticks
Designated timestamp: event_ts
Timestamp meaning: exchange event timestamp, not ingestion timestamp
Precision: nanosecond/microsecond policy documented
Partition: DAY
Out-of-order tolerance: configured at table/database level
```

Forbidden:

```text
Use server ingestion time as timestamp without domain decision.
```

### 5.2 Event Time vs Ingestion Time

The code MUST distinguish:

- event time: when the event happened in the source domain;
- ingestion time: when this service received/sent the row;
- processing time: when transformation occurred;
- query time: when data is read.

Required Java model:

```java
public record TickEvent(
        String instrument,
        BigDecimal bid,
        BigDecimal ask,
        Instant eventTime,
        Instant receivedAt,
        String sourceEventId) {
}
```

Forbidden:

```java
sender.atNow(); // when source event time is available and semantically required
```

### 5.3 Precision Must Be Explicit

Every timestamp boundary MUST specify precision:

- milliseconds;
- microseconds;
- nanoseconds.

Forbidden:

```java
long ts = instant.toEpochMilli();
sender.timestampColumn("ts", ts); // unclear unit
```

Required:

```java
long epochMicros = Math.addExact(
        Math.multiplyExact(instant.getEpochSecond(), 1_000_000L),
        instant.getNano() / 1_000L
);
```

If using QuestDB client timestamp helper APIs, use those helpers consistently and document the precision expected by the client.

### 5.4 Time Zone Policy

Storage timestamp MUST be UTC instant-like data.

Allowed:

- store event timestamp in UTC;
- store source timezone/market/session separately if business-relevant;
- apply timezone only at query/report boundary.

Forbidden:

- storing local wall-clock time as the only timestamp;
- using JVM default timezone;
- parsing date/time without explicit formatter and zone policy;
- using `LocalDateTime` for cross-system event timestamp.

---

## 6. Schema and Table Design

### 6.1 Table Naming

Table names MUST be stable, lowercase, and domain-specific.

Allowed:

```text
market_ticks
trade_events
order_book_snapshots
sensor_readings
service_latency_samples
```

Forbidden:

```text
data
events
temp
NewTable
metrics2
```

### 6.2 Column Naming

Column names MUST be lowercase snake case and semantically stable.

Allowed:

```text
event_ts
instrument
venue
bid_price
ask_price
source_event_id
received_at
```

Forbidden:

```text
time
value
x
data
payload_json
```

Exception: `payload_json` is allowed only for explicitly semi-structured raw capture tables.

### 6.3 Symbol vs String

Use SYMBOL only for bounded/repeated categorical values.

Good candidates:

- instrument;
- venue;
- region;
- service_name;
- host;
- metric_name;
- event_type.

Poor candidates:

- request ID;
- UUID;
- email;
- free text;
- high-cardinality user ID without analysis justification;
- raw URL;
- stack trace;
- JSON payload.

Every symbol column MUST document expected cardinality.

Required:

```text
Column: instrument SYMBOL
Expected cardinality: ~20,000 active symbols
Query pattern: filter by instrument + time range
Index policy: reviewed for version-specific symbol index options
```

### 6.4 Numeric Type Policy

For Java mapping:

| Domain Value |                                                       Java Type | QuestDB Type Guidance        |
| ------------ | --------------------------------------------------------------: | ---------------------------- |
| price        | `BigDecimal` in domain, encoded as scaled long/double by policy | Avoid silent precision loss  |
| quantity     |                                     `BigDecimal` or scaled long | Define scale                 |
| latency      |                                      `long` nanos/micros/millis | Unit in column name          |
| count        |                                                          `long` | Avoid int overflow           |
| ratio        |                                                        `double` | Accept approximate semantics |
| money        |                                   scaled long or decimal policy | Do not blindly use double    |

Forbidden:

```java
.doubleColumn("amount", monetaryAmount.doubleValue())
```

Allowed only if precision loss has been reviewed:

```java
.doubleColumn("mid_price", midPrice.doubleValue())
```

Preferred for exact financial values:

```text
price_e8 LONG -- price scaled by 100_000_000
quantity_e8 LONG
```

### 6.5 JSON Payload Policy

QuestDB tables should not become opaque JSON dumps unless the table is explicitly designed as raw ingestion/staging.

Allowed:

```text
raw_vendor_events(payload_json STRING, event_ts TIMESTAMP, source SYMBOL)
```

Forbidden:

```text
All analytical columns hidden inside payload_json while queries need bid/ask/venue/instrument.
```

### 6.6 Partitioning Policy

Every time-series table MUST define partition policy based on:

- ingestion rate;
- retention/delete granularity;
- query time range;
- expected table size;
- out-of-order ingestion profile.

Allowed examples:

```text
PARTITION BY DAY  -- high-rate tick/events, common daily retention
PARTITION BY MONTH -- lower-rate historical analytics
```

Forbidden:

```text
Partition by HOUR because it sounds faster.
Partition by YEAR for high-rate time-series with daily deletes.
```

### 6.7 WAL Table Policy

For modern QuestDB deployments, WAL table usage MUST be decided explicitly.

Required review:

- Is ingestion concurrent?
- Is out-of-order ingestion expected?
- Are schema changes concurrent with ingestion?
- What is the durability/availability requirement?
- What is the operational procedure for stuck WAL apply jobs?

Forbidden:

```text
Create table with default WAL/no-WAL behavior without knowing the default for the deployed QuestDB version.
```

---

## 7. Query Standards

### 7.1 PGWire/JDBC Query Path

Java query code SHOULD use PGWire through JDBC/PostgreSQL-compatible drivers unless there is a documented reason to use REST/HTTP.

Required:

```java
try (Connection connection = dataSource.getConnection();
     PreparedStatement statement = connection.prepareStatement(sql)) {
    statement.setString(1, instrument);
    statement.setTimestamp(2, Timestamp.from(from));
    statement.setTimestamp(3, Timestamp.from(to));
    try (ResultSet rs = statement.executeQuery()) {
        // map rows
    }
}
```

Forbidden:

```java
String sql = "select * from ticks where instrument = '" + instrument + "'";
```

### 7.2 QuestDB Is PostgreSQL-Compatible, Not PostgreSQL

Do not assume all PostgreSQL features behave the same.

Every non-trivial query MUST be verified against QuestDB documentation/runtime.

Forbidden assumptions:

- PostgreSQL DDL support is identical;
- PostgreSQL transaction semantics are identical;
- PostgreSQL indexes are identical;
- PostgreSQL extensions are available;
- PostgreSQL JDBC metadata behavior is complete;
- PostgreSQL JSON/array/operator behavior is identical.

### 7.3 Time Range Required for Large Tables

Queries over large time-series tables MUST include bounded time range unless explicitly approved.

Allowed:

```sql
SELECT instrument, avg(bid_price)
FROM market_ticks
WHERE event_ts >= ? AND event_ts < ?
SAMPLE BY 1m;
```

Forbidden by default:

```sql
SELECT * FROM market_ticks;
SELECT count(*) FROM market_ticks;
```

### 7.4 SELECT Column Policy

Application queries MUST select explicit columns.

Forbidden:

```sql
SELECT * FROM market_ticks WHERE event_ts >= ?;
```

Allowed:

```sql
SELECT event_ts, instrument, bid_price, ask_price
FROM market_ticks
WHERE instrument = ? AND event_ts >= ? AND event_ts < ?;
```

### 7.5 Query Limits

Every user-facing query MUST have:

- bounded time range;
- row limit or aggregation;
- timeout;
- explicit sort if order matters;
- memory/cardinality review for group-by queries.

### 7.6 Pagination

Offset pagination over very large analytical result sets is RESTRICTED.

Preferred:

- time-window pagination;
- keyset-like pagination using timestamp + deterministic tie-breaker;
- export workflow for large offline result;
- aggregation instead of raw row pagination.

Forbidden:

```sql
SELECT ... FROM ticks ORDER BY event_ts LIMIT 100 OFFSET 10000000;
```

### 7.7 Analytical SQL Review

Queries using these features MUST have tests with realistic data shape:

- `SAMPLE BY`;
- `ASOF JOIN`;
- `LATEST ON`;
- `FILL`;
- window functions;
- lateral joins;
- joins over high-cardinality columns;
- unnest/array expansion;
- timezone-aware sample buckets;
- long retention scans.

---

## 8. JDBC / PGWire Standards

### 8.1 Use DataSource and Pooling Carefully

Query-heavy applications MAY use HikariCP or framework-managed pooling.

Every pool config MUST document:

- maximum pool size;
- QuestDB PGWire connection limit;
- application replica count;
- query timeout;
- connection timeout;
- leak detection policy;
- dashboard/metric names.

Forbidden:

```java
DriverManager.getConnection(...) // scattered through application code
```

### 8.2 Prepared Statements

Runtime values MUST use bind parameters.

Allowed:

```sql
WHERE instrument = ? AND event_ts BETWEEN ? AND ?
```

Restricted:

Dynamic table/column/sort identifiers. These must use allow-list mapping.

Forbidden:

```java
String sql = "ORDER BY " + request.getSort();
```

Allowed:

```java
String sortColumn = switch (request.sort()) {
    case EVENT_TIME -> "event_ts";
    case BID_PRICE -> "bid_price";
};
```

### 8.3 Fetch Size and Large Result Sets

Large result queries MUST be streamed or bounded.

Required:

- set fetch size if supported/beneficial for the selected driver;
- avoid materializing unbounded `List`;
- write export response as streaming body with backpressure;
- close `ResultSet`, `Statement`, and `Connection`.

Forbidden:

```java
return jdbcTemplate.queryForList("select * from huge_table");
```

### 8.4 Transactions

QuestDB integration code MUST NOT assume OLTP transaction semantics.

Forbidden:

```java
connection.setAutoCommit(false);
// insert/update multiple business objects and expect QuestDB to behave as OLTP source of truth
```

Allowed:

- use PostgreSQL/Oracle/etc. for transactional state;
- write derived event/time-series rows to QuestDB asynchronously;
- use outbox + ingestion worker for reliable propagation.

---

## 9. Mutation and Update Policy

### 9.1 Append-First Model

QuestDB table design MUST prefer append-only or mostly append-only data.

Allowed:

```text
new event row for corrected observation
correction event table
latest-state materialization in separate OLTP database
```

Restricted:

- `UPDATE`;
- `DELETE`;
- frequent point corrections;
- large historical mutation;
- row-by-row cleanup.

### 9.2 Deletion and Retention

Retention MUST be partition-aware where possible.

Required:

```text
Retention: keep market_ticks for 90 days
Delete method: drop partitions / partition lifecycle policy, not row-by-row delete
Impact: dashboard queries only require last 30 days
```

Forbidden:

```sql
DELETE FROM market_ticks WHERE event_ts < now() - 90d;
```

unless reviewed and proven safe for the specific table size/version.

---

## 10. Idempotency and Deduplication

### 10.1 Source Event Identity

Every ingestion pipeline MUST carry a source identity when duplicate handling matters.

Examples:

```text
source_event_id
exchange_sequence
source_partition + source_offset
sensor_id + sequence_no
trace_id + span_id + metric timestamp
```

### 10.2 Deduplication Contract

If using QuestDB deduplication, the table definition and ingestion adapter MUST document:

- deduplication enabled or not;
- deduplication key columns;
- timestamp column;
- duplicate resolution semantics;
- retry interaction;
- test dataset proving duplicates are removed as expected.

### 10.3 At-Most-Once vs At-Least-Once

Every ingestion pipeline MUST choose a delivery model:

| Model            | Behavior                    | Required Controls                                         |
| ---------------- | --------------------------- | --------------------------------------------------------- |
| At-most-once     | no retry after failed batch | acceptable data loss documented                           |
| At-least-once    | retry may duplicate         | idempotency/deduplication or duplicate-tolerant analytics |
| Effectively-once | retry + deduplication       | tested dedup key and failure replay                       |

Forbidden:

```text
"Exactly-once" claim without deduplication/failure test.
```

---

## 11. Concurrency and Threading

### 11.1 Sender Ownership

QuestDB `Sender` lifecycle MUST be explicit.

Allowed patterns:

- one sender per ingestion worker;
- bounded sender pool with clear ownership;
- sender created in application startup and closed on shutdown;
- sender created for batch job and closed via try-with-resources.

Forbidden:

- create sender per row;
- share sender across threads without documented thread-safety guarantee;
- never close sender;
- flush from multiple threads without ownership.

### 11.2 Shutdown

Shutdown MUST flush or intentionally discard buffered rows based on policy.

Required:

```java
public void stop() {
    try {
        sender.flush();
    } finally {
        sender.close();
    }
}
```

If data may be discarded on shutdown, it MUST be documented and acceptable.

### 11.3 Backpressure and Queues

If ingestion uses internal queues:

- queue must be bounded;
- full queue behavior must be explicit;
- metrics must expose queue size and dropped/rejected events;
- shutdown must drain or persist remaining items;
- poison events must not block the whole ingestion pipeline.

Forbidden:

```java
BlockingQueue<Event> queue = new LinkedBlockingQueue<>(); // unbounded
```

---

## 12. Security Standards

### 12.1 Credentials

QuestDB credentials MUST come from approved secret/config mechanism:

- AWS Secrets Manager;
- SSM Parameter Store SecureString;
- Kubernetes Secret mounted as env/file;
- Vault;
- platform secret manager.

Forbidden:

```java
String password = "quest";
String url = "http://admin:password@questdb:9000";
```

### 12.2 TLS

Production remote QuestDB access MUST use TLS unless network architecture explicitly provides equivalent protection and has security approval.

Forbidden:

- trust-all certificates;
- disabled hostname verification;
- plaintext public network ingestion;
- logging auth tokens or connection strings.

### 12.3 SQL Injection

All query values MUST use bind parameters.

All dynamic identifiers MUST use allow-list mapping.

Forbidden:

```java
String table = request.getTable();
String sql = "select * from " + table;
```

Allowed:

```java
String table = switch (request.dataset()) {
    case MARKET_TICKS -> "market_ticks";
    case ORDER_BOOK -> "order_book_snapshots";
};
```

### 12.4 Multi-Tenant Safety

If QuestDB stores tenant-specific data, every query MUST include tenant/resource constraints unless table is physically tenant-scoped.

Required:

```sql
WHERE tenant_id = ? AND event_ts >= ? AND event_ts < ?
```

Forbidden:

```text
Rely on frontend to filter tenant data.
```

---

## 13. Observability Standards

### 13.1 Ingestion Metrics

Every ingestion adapter MUST emit:

- rows accepted by application;
- rows sent to QuestDB;
- rows failed/rejected;
- flush count;
- flush latency;
- retry count;
- retry exhaustion count;
- queue depth if queued;
- active endpoint if multi-URL;
- duplicate/dedup-related counts if available;
- last successful flush timestamp.

### 13.2 Query Metrics

Every query adapter MUST emit:

- query name/template ID;
- duration;
- row count;
- timeout count;
- error code/category;
- result-size bucket;
- whether query was export/raw/aggregate;
- time-range width;
- tenant/dataset as low-cardinality labels only.

Forbidden high-cardinality labels:

- raw SQL;
- user ID;
- request ID;
- table name from user input;
- instrument if cardinality is high;
- exception message as label.

### 13.3 Logging

Logs MUST include:

- operation name;
- dataset/table logical name;
- source system;
- row count;
- duration;
- correlation ID;
- error category.

Logs MUST NOT include:

- raw credentials;
- full sensitive rows;
- raw SQL with secrets;
- raw ILP line if it may contain sensitive data;
- large payloads.

### 13.4 Tracing

Tracing spans SHOULD distinguish:

```text
questdb.ingest.flush
questdb.query.execute
questdb.schema.migrate
questdb.export.stream
```

Span attributes MUST be low-cardinality.

---

## 14. Performance Standards

### 14.1 Benchmark Before Tuning

Performance changes MUST include evidence:

- ingestion rows/sec;
- p50/p95/p99 flush latency;
- query p50/p95/p99 latency;
- CPU/memory usage;
- network throughput;
- disk I/O if available;
- table size and cardinality;
- query plan if applicable.

Forbidden:

```text
Increase batch size because bigger is faster.
Add more threads because ingestion is slow.
```

### 14.2 Insert Performance

Do:

- use first-party ILP client;
- batch naturally;
- avoid per-row connection setup;
- avoid per-row flush in high-throughput path;
- encode numeric/time values without unnecessary allocation;
- avoid `BigDecimal.toString()` in hot path unless required;
- pre-normalize symbols where possible.

Do not:

- build ILP with string concatenation in hot loops;
- allocate JSON per row for structured columns;
- perform blocking network calls from event-loop threads;
- use PGWire `INSERT` for high-throughput ingestion.

### 14.3 Query Performance

Do:

- restrict by time range;
- use designated timestamp semantics;
- select only needed columns;
- use time-series SQL functions appropriately;
- pre-aggregate where needed;
- test with realistic cardinality and time span;
- limit user-controlled query width.

Do not:

- expose arbitrary SQL endpoint to users;
- allow unbounded group-by cardinality;
- query years of data for an interactive dashboard;
- page through raw events with huge offsets;
- load entire result into memory.

---

## 15. Testing Standards

### 15.1 Test Categories

Required tests:

- schema creation/migration tests;
- ingestion mapping tests;
- timestamp precision tests;
- retry/deduplication tests;
- malformed row tests;
- query mapping tests;
- time range boundary tests;
- timezone/DST tests when using `SAMPLE BY` with timezone;
- large result streaming tests;
- failure/unavailable QuestDB tests;
- security tests for SQL injection and dynamic identifiers.

### 15.2 Testcontainers / Integration Tests

Integration tests SHOULD run against real QuestDB container/version when practical.

Required test metadata:

```text
QuestDB version used in test
ILP transport used
PGWire driver version
schema setup script
expected timestamp precision
```

### 15.3 Golden Dataset

Complex analytical queries MUST have golden datasets with:

- known time windows;
- out-of-order rows;
- duplicate rows when relevant;
- missing intervals;
- multiple symbols/categories;
- DST boundary if timezone logic is used;
- high-cardinality sample if cardinality matters.

### 15.4 Failure Testing

Must test:

- QuestDB unavailable at startup;
- QuestDB unavailable during flush;
- timeout during query;
- malformed ILP row;
- rejected column/table when auto-create disabled;
- duplicate replay;
- partial batch failure behavior;
- shutdown flush behavior.

---

## 16. Migration and Schema Change Standards

### 16.1 Schema Changes Are Code Changes

Every schema change MUST include:

- DDL;
- migration owner;
- rollout plan;
- backward compatibility review;
- query impact;
- retention impact;
- ingestion compatibility;
- rollback/roll-forward plan.

### 16.2 Column Addition

Adding a column MUST define:

- type;
- nullable/default behavior;
- old producers behavior;
- old consumers behavior;
- whether ILP auto column creation is allowed;
- whether dashboard/query expects it immediately.

### 16.3 Type Change

Changing column type is RESTRICTED.

Preferred:

- create new column;
- dual-write if necessary;
- backfill if required;
- migrate queries;
- deprecate old column;
- drop old column only after retention/approval.

### 16.4 Table Rename / Split

Must include:

- alias/view strategy if supported;
- ingestion route change;
- query compatibility;
- dashboard update;
- retention of old table;
- export/backfill plan.

---

## 17. Framework Integration Rules

### 17.1 Spring Boot

Spring Boot integration MUST use typed configuration.

Allowed:

```java
@ConfigurationProperties(prefix = "app.questdb")
public record QuestDbProperties(
        String ilpAddress,
        Duration retryTimeout,
        int autoFlushRows,
        String jdbcUrl,
        String username,
        String password) {
}
```

Forbidden:

```java
@Value("${questdb.url}") String url; // scattered across classes
```

### 17.2 Quarkus

Quarkus integration MUST respect event-loop/blocking rules.

Forbidden:

- JDBC query on event-loop thread;
- blocking flush inside reactive pipeline without isolation;
- global mutable sender without lifecycle management.

### 17.3 Reactive Java

Reactive ingestion MUST define:

- backpressure behavior;
- scheduler/thread boundary;
- batch window;
- flush trigger;
- cancellation behavior;
- retry policy;
- shutdown drain policy.

Forbidden:

```java
flux.doOnNext(event -> sender.flush()) // blocking call in reactive chain without scheduler policy
```

---

## 18. Common Anti-Patterns

Forbidden unless explicitly approved:

1. Treating QuestDB as PostgreSQL.
2. Treating QuestDB as OLTP source of truth.
3. Using PGWire `INSERT` for high-throughput ingestion.
4. Building ILP manually with string concatenation.
5. Using ingestion time when source event time exists.
6. Mixing milliseconds/microseconds/nanoseconds without tests.
7. Relying on JVM default timezone.
8. Auto-creating production tables/columns without schema governance.
9. Unbounded query APIs.
10. `SELECT *` on large tables.
11. Returning millions of rows into `List`.
12. Claiming exactly-once ingestion without deduplication test.
13. Ignoring flush failures.
14. Sharing sender across threads without ownership proof.
15. Creating sender or JDBC connection per row.
16. Logging raw ILP rows with sensitive data.
17. Dynamic SQL table/column from user input.
18. Using QuestDB for locks, sessions, workflow state, or transactional account balance.
19. No metrics for ingestion failures.
20. No integration test against real QuestDB behavior.

---

## 19. Required Code Review Checklist

A QuestDB-related PR MUST answer:

### Architecture

- [ ] Is QuestDB the right storage for this use case?
- [ ] Is the use case append/time-series/analytical rather than OLTP?
- [ ] Are read and write paths separated?
- [ ] Is QuestDB hidden behind adapter/repository/gateway boundary?

### Version / Dependency

- [ ] Is QuestDB server version documented?
- [ ] Are Java dependencies pinned?
- [ ] Is ILP/PGWire transport choice justified?
- [ ] Are version-specific features verified?

### Ingestion

- [ ] Is official Java ILP client used for high-throughput ingestion?
- [ ] Is sender lifecycle managed?
- [ ] Is flush behavior explicit?
- [ ] Is retry behavior explicit?
- [ ] Is duplicate/dedup behavior documented?
- [ ] Are malformed rows handled safely?
- [ ] Is shutdown flush/drain behavior tested?

### Timestamp

- [ ] Is designated timestamp defined?
- [ ] Is event time vs ingestion time clear?
- [ ] Is precision explicit?
- [ ] Are timezone assumptions explicit?
- [ ] Are DST/time boundary tests present if relevant?

### Schema

- [ ] Are table/column names stable and meaningful?
- [ ] Is partition strategy justified?
- [ ] Are symbol columns cardinality-reviewed?
- [ ] Are exact numeric values encoded safely?
- [ ] Is auto-create behavior safe for the environment?

### Query

- [ ] Are queries parameterized?
- [ ] Are dynamic identifiers allow-listed?
- [ ] Are time ranges bounded?
- [ ] Are result sizes bounded/streamed?
- [ ] Are analytical queries tested with realistic data?

### Security

- [ ] Are credentials externalized?
- [ ] Is TLS/auth configured for production?
- [ ] Is SQL injection prevented?
- [ ] Is tenant isolation enforced?
- [ ] Are logs redacted?

### Observability

- [ ] Are ingestion metrics present?
- [ ] Are query metrics present?
- [ ] Are errors categorized?
- [ ] Are high-cardinality telemetry labels avoided?
- [ ] Are alerts defined for flush failure/retry exhaustion/query timeout?

### Testing

- [ ] Are integration tests run against real QuestDB version?
- [ ] Are retry/failure cases tested?
- [ ] Are precision and dedup tests present?
- [ ] Are large result tests present?

---

## 20. LLM Prompt Contract

When implementing Java + QuestDB code, the LLM MUST follow this contract:

```text
You are implementing Java code that integrates with QuestDB.

Before coding:
1. Identify whether this is ingestion, query, schema, export, or operational code.
2. State the QuestDB server version or required version range.
3. Choose the access path:
   - official Java ILP client over HTTP for high-throughput ingestion;
   - PGWire/JDBC for query;
   - restricted alternatives only with justification.
4. Define timestamp semantics: event time vs ingestion time, precision, timezone policy.
5. Define duplicate/retry behavior.
6. Define schema/table/partition/symbol assumptions.
7. Define timeout, backpressure, and failure behavior.

While coding:
- do not hand-roll ILP unless explicitly approved;
- do not concatenate SQL values;
- do not use dynamic table/column names without allow-list mapping;
- do not rely on default timezone or unclear timestamp units;
- do not use QuestDB as OLTP source of truth;
- do not ignore flush/query failures;
- do not create clients/connections per row/request;
- do not log raw sensitive rows.

After coding:
- add tests for timestamp precision, ingestion mapping, query mapping, retry/dedup/failure behavior;
- add metrics/logging/tracing for ingestion and query operations;
- document schema and operational assumptions.
```

---

## 21. References

- QuestDB Java client documentation: https://questdb.com/docs/ingestion/clients/java/
- QuestDB ingestion overview: https://questdb.com/docs/ingestion/overview/
- QuestDB ILP overview: https://questdb.com/docs/ingestion/ilp/overview/
- QuestDB ILP/HTTP configuration: https://questdb.com/docs/configuration/ingestion/
- QuestDB PostgreSQL Wire Protocol: https://questdb.com/docs/query/pgwire/overview/
- QuestDB Java PGWire guide: https://questdb.com/docs/query/pgwire/java/
- QuestDB download/current version page: https://questdb.com/download/
- QuestDB release notes / releases: https://github.com/questdb/questdb/releases
- OWASP SQL Injection Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
- Java time package: https://docs.oracle.com/javase/8/docs/api/java/time/package-summary.html
- PostgreSQL JDBC driver documentation: https://jdbc.postgresql.org/documentation/
