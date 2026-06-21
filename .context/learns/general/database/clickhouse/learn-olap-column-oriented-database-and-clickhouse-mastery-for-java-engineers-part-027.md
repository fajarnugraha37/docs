# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-027.md

# Part 027 — Java Integration I: JDBC, HTTP, Native Clients, Types, Batching, and Query APIs

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **027 / 034**  
> Fokus: membangun integrasi Java ↔ ClickHouse yang production-safe: client choice, JDBC, Java client, HTTP interface, data types, batching, idempotent inserts, query APIs, streaming results, retries, timeouts, and observability.

---

## 0. Posisi Part Ini Dalam Seri

Kita sudah membahas ClickHouse dari sisi database:

- OLAP model;
- storage;
- MergeTree internals;
- ingestion;
- aggregation;
- materialized views;
- distributed architecture;
- performance engineering;
- data modeling patterns.

Sekarang kita masuk ke sisi Java application.

Sebagai Java software engineer, kamu tidak cukup tahu SQL ClickHouse. Kamu harus tahu bagaimana menaruh ClickHouse dalam sistem backend:

```text
Spring Boot / Java service
→ client/driver
→ query builder / repository
→ connection management
→ insert batching
→ retry/idempotency
→ result streaming
→ metrics/logging/tracing
→ API guardrails
→ ClickHouse cluster
```

ClickHouse sering dipakai untuk:

- analytics API;
- dashboard backend;
- ingestion service;
- observability pipeline;
- reporting/export service;
- regulatory case analytics;
- product analytics;
- fraud/monitoring systems.

Integrasi yang salah bisa membuat masalah besar:

- row-by-row inserts;
- retry duplicates;
- heap OOM karena result besar;
- unbounded dashboard queries;
- arbitrary SQL injection;
- connection storms;
- query timeout tanpa cancellation;
- `SELECT *` returning millions of rows;
- hidden `FINAL`;
- no query_id;
- no batch metadata;
- no freshness contract.

Part ini adalah fondasi Java integration.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. memahami pilihan integrasi Java: JDBC, official Java client, HTTP, and ecosystem tools;
2. memilih client berdasarkan use case: dashboard query, ingestion, export, internal service, BI integration;
3. memahami ClickHouse data type mapping ke Java;
4. menghindari masalah `DateTime`, timezone, `Decimal`, unsigned integer, `Nullable`, `UUID`, `LowCardinality`, Array/Map/JSON;
5. mendesain batch insert yang benar;
6. mendesain idempotent retry untuk insert;
7. memahami server-side async insert vs client-side batching;
8. membangun query API dengan guardrails;
9. streaming result secara aman tanpa membuat Java heap meledak;
10. menerapkan timeout, cancellation, query_id, compression, and per-query settings;
11. mendesain repository/service layer untuk ClickHouse tanpa membawa mindset OLTP repository;
12. membuat production checklist Java ↔ ClickHouse.

---

## 2. Mental Model Utama: ClickHouse Bukan OLTP Repository

Banyak Java engineer otomatis membuat pattern seperti:

```java
interface CaseRepository {
    Case findById(UUID id);
    void save(Case c);
    void updateStatus(UUID id, Status status);
    List<Case> findBySomething(...);
}
```

Untuk ClickHouse, pattern itu sering salah.

ClickHouse lebih cocok diperlakukan sebagai:

```text
analytical read model
append-heavy event/fact store
serving table backend
rollup query engine
large-result export engine
```

Bukan:

```text
primary transactional entity repository
```

Jadi Java integration sebaiknya memiliki interface seperti:

```java
interface CaseAnalyticsQueryService {
    CaseBacklogSummary getBacklogSummary(TenantId tenant, TimeRange range, Dimensions dims);
    List<CaseLifecyclePoint> getLifecycleTrend(TenantId tenant, TimeRange range, Grouping grouping);
    ExportJobId requestCaseExport(ExportRequest request);
}
```

dan ingestion seperti:

```java
interface CaseEventIngestionService {
    void ingestBatch(List<CaseLifecycleEvent> events, IngestionMetadata metadata);
}
```

Bukan:

```java
void updateCaseStatusInClickHouse(UUID caseId, String status);
```

ClickHouse integration harus dibuat query-family-aware dan workload-aware.

---

## 3. Java Integration Options

### 3.1 Official Java Client

ClickHouse official Java client menyediakan API Java untuk komunikasi dengan ClickHouse. Dokumentasi resmi menyatakan Java client mengabstraksi detail network communication dan current implementation mendukung HTTP interface.

Use cases:

- application-level queries;
- inserts;
- custom service integration;
- direct control over request settings;
- non-JDBC usage;
- performance-oriented internal services.

### 3.2 JDBC Driver

ClickHouse JDBC driver mengimplementasikan standard JDBC interface dan menggunakan latest Java client di bawahnya. Dokumentasi resmi ClickHouse merekomendasikan memakai latest Java client langsung jika membutuhkan performance/direct access, sementara JDBC cocok untuk compatibility dengan ecosystem JDBC.

Use cases:

- Spring JDBC;
- simple SQL execution;
- BI/tooling compatibility;
- existing JDBC abstraction;
- migration from JDBC-heavy codebase;
- admin/internal tools.

### 3.3 HTTP Interface Directly

ClickHouse punya HTTP interface yang mudah dipakai.

Use cases:

- simple ingestion;
- language-agnostic integration;
- curl/debugging;
- bulk inserts using formats;
- custom HTTP clients;
- service-to-service controlled calls.

### 3.4 Native TCP?

Historically ClickHouse has native protocol, but for Java official docs around current Java client emphasize HTTP support. Always check the client version and official docs because Java client ecosystem evolves.

### 3.5 Ecosystem Connectors

For big pipelines:

- Kafka Connect;
- Spark connector;
- Flink connector;
- Debezium/CDC pipelines;
- ClickPipes;
- Airbyte/Fivetran/ETL tools;
- BI tools.

Java service should not always be the ingestion engine. For large streaming/CDC pipelines, a connector or dedicated ingestion service may be more appropriate.

---

## 4. Choosing Client by Use Case

### 4.1 Dashboard Query API

Recommended:

- official Java client or JDBC;
- strict query templates;
- query_id;
- timeout;
- selected columns;
- limited result rows;
- per-query settings;
- streaming result for medium outputs;
- rollup/serving tables.

Avoid:

- arbitrary SQL from frontend;
- unbounded result;
- `SELECT *`;
- synchronous export;
- no query_id.

### 4.2 High-Throughput Ingestion Service

Recommended:

- official Java client / HTTP formats / JDBC batch depending team and benchmark;
- large batches;
- idempotent event IDs;
- deterministic batch IDs;
- compression;
- retry with dedup;
- backpressure;
- batch metrics.

Avoid:

- row-by-row inserts;
- small batches;
- random event_id per retry;
- mutating existing rows per event.

### 4.3 Export Service

Recommended:

- async job;
- streaming output;
- write to object storage;
- long timeout profile;
- separate user/profile/compute group;
- progress tracking.

Avoid:

- returning huge CSV synchronously through REST controller;
- loading all rows into Java List.

### 4.4 Admin/BI Integration

Recommended:

- JDBC compatibility;
- strict user profiles;
- quotas;
- read-only users;
- max execution time;
- max memory/result limits.

Avoid:

- giving BI production superuser credentials;
- allowing arbitrary joins over raw tables without limits.

### 4.5 Regulatory Report Generation

Recommended:

- controlled query service;
- snapshot result table;
- source watermark;
- checksum;
- reproducibility metadata;
- async generation;
- validation queries.

Avoid:

- relying on live ad-hoc query as official report artifact.

---

## 5. Dependency and Versioning Strategy

Exact Maven coordinates/versions change over time. Always check official docs and Maven Central for the version you use.

Conceptual dependencies:

```xml
<!-- JDBC driver -->
<dependency>
  <groupId>com.clickhouse</groupId>
  <artifactId>clickhouse-jdbc</artifactId>
  <version>${clickhouse.jdbc.version}</version>
</dependency>
```

```xml
<!-- Java client -->
<dependency>
  <groupId>com.clickhouse</groupId>
  <artifactId>clickhouse-client</artifactId>
  <version>${clickhouse.client.version}</version>
</dependency>
```

Possible companion HTTP implementation modules may be required depending version.

### 5.1 Version Rule

Pin versions intentionally.

Do not rely on random transitive driver version.

Track:

- ClickHouse server version;
- Java client version;
- JDBC driver version;
- Spring Boot version;
- JDK version;
- serialization libraries;
- connection pool if used.

### 5.2 Compatibility Testing

Have integration tests that cover:

- connection;
- insert;
- query;
- DateTime64;
- Decimal;
- Nullable;
- UUID;
- arrays/maps if used;
- error handling;
- timeout;
- retry behavior.

---

## 6. Connection URL and Settings

### 6.1 JDBC URL Example

Conceptual:

```text
jdbc:ch:http://localhost:8123/default
jdbc:ch:https://<host>:8443/analytics
```

Properties:

```java
Properties props = new Properties();
props.setProperty("user", "analytics_user");
props.setProperty("password", "secret");
```

Some docs/examples use `username`; verify exact property names for your driver version.

### 6.2 Per-Query Settings

ClickHouse allows many settings per query.

Examples:

- `max_execution_time`;
- `max_memory_usage`;
- `send_progress_in_http_headers`;
- `async_insert`;
- `wait_for_async_insert`;
- `insert_quorum`;
- `max_result_rows`;
- `result_overflow_mode`;
- `query_id`.

Do not put all settings globally. Different workload classes need different settings.

### 6.3 Query ID

Always set `query_id`.

Pattern:

```text
service/query-family/tenant/request-id
```

Example:

```text
case-analytics/backlog-summary/tenant-10/req-abc123
```

Benefits:

- trace query in `system.query_log`;
- kill query if needed;
- correlate Java logs and ClickHouse logs;
- debug distributed query fragments.

### 6.4 Compression

Use compression for large result/insert if supported by your client.

Trade-off:

- less network;
- more CPU.

For remote/cloud connections, compression is often beneficial.

---

## 7. Data Type Mapping: Core Types

ClickHouse types do not map perfectly to Java.

### 7.1 Integer Types

ClickHouse:

```text
Int8, Int16, Int32, Int64
UInt8, UInt16, UInt32, UInt64, UInt128, UInt256
```

Java signed primitives:

```text
byte, short, int, long
```

Problem:

```text
Java has no unsigned long primitive.
```

Mapping:

| ClickHouse | Java common mapping |
|---|---|
| Int8 | byte / Byte |
| Int16 | short / Short |
| Int32 | int / Integer |
| Int64 | long / Long |
| UInt8 | short/int |
| UInt16 | int |
| UInt32 | long |
| UInt64 | BigInteger or careful long if domain fits |
| UInt128/UInt256 | BigInteger/String depending use |

### 7.2 Recommendation

For IDs from Java systems, if values fit signed `long`, consider `UInt64` only if you consciously handle mapping.

For cross-language IDs:

- `UUID`;
- `String`;
- `UInt64` with careful mapping;
- `FixedString` rarely.

### 7.3 Decimal

ClickHouse:

```text
Decimal(P, S)
```

Java:

```java
BigDecimal
```

Use for:

- money;
- financial amounts;
- exact ratios requiring fixed precision.

Avoid `Double` for money.

### 7.4 Float

ClickHouse:

```text
Float32, Float64
```

Java:

```java
float, double
```

Use for:

- measurements;
- approximate metrics;
- sensor values.

Not for money.

---

## 8. Date, DateTime, DateTime64, and Timezones

### 8.1 Types

ClickHouse:

```text
Date
Date32
DateTime
DateTime64(precision)
```

Java:

```java
LocalDate
LocalDateTime
Instant
OffsetDateTime
ZonedDateTime
```

### 8.2 Recommended Domain Rule

For event timestamps:

```java
Instant
```

or `OffsetDateTime` in API layer, normalized to UTC.

For business date:

```java
LocalDate
```

with explicit business timezone.

### 8.3 Avoid Ambiguous LocalDateTime

`LocalDateTime` has no timezone. It can be dangerous for event time across services.

Use only when timezone is defined externally and consistently.

### 8.4 DateTime64

Use `DateTime64(3)` for millisecond precision if events need it.

Example:

```sql
event_time DateTime64(3, 'UTC')
```

or decide server/session timezone carefully.

### 8.5 Business Day

If dashboard uses Jakarta business day:

```text
day = toDate(event_time, 'Asia/Jakarta')
```

Consider materialized column:

```sql
event_date_jakarta Date MATERIALIZED toDate(event_time, 'Asia/Jakarta')
```

if used often.

### 8.6 Java Serialization

Be consistent:

- API accepts ISO-8601 with timezone;
- convert to Instant;
- bind as timestamp in UTC;
- query with explicit boundaries.

---

## 9. UUID, String, LowCardinality, Enum

### 9.1 UUID

ClickHouse has `UUID`.

Java:

```java
java.util.UUID
```

Good for:

- event_id;
- request_id;
- trace_id if UUID-shaped;
- case_id.

### 9.2 String

Use for:

- free text;
- payload;
- IDs not numeric/UUID;
- labels with high cardinality;
- raw JSON.

### 9.3 LowCardinality(String)

ClickHouse optimization for repeated strings.

Use for:

- event_type;
- status;
- severity;
- country;
- service;
- environment;
- route group;
- plan;
- device type.

Java still sends/receives as String.

### 9.4 Enum

ClickHouse Enum can be efficient, but schema evolution can be less flexible.

For fast-changing business values, `LowCardinality(String)` is often easier operationally.

---

## 10. Nullable

### 10.1 ClickHouse Nullable

```sql
Nullable(String)
Nullable(UInt64)
```

Java:

- boxed types;
- Optional at boundary;
- null handling.

### 10.2 Cost

Nullable adds null map and can complicate query logic.

### 10.3 Recommendation

Use Nullable only when null has real semantic meaning.

For unknown category:

```sql
country LowCardinality(String) DEFAULT 'UNKNOWN'
```

may be better than:

```sql
country Nullable(String)
```

if product semantics allow.

### 10.4 Java DTO

Avoid primitive for nullable columns.

Bad:

```java
long assigneeUserId;
```

if nullable.

Good:

```java
Long assigneeUserId;
```

or domain type.

---

## 11. Array, Map, Tuple, JSON

### 11.1 Array

Java mapping:

```java
List<T>
T[]
```

Use carefully. `ARRAY JOIN` can explode rows.

### 11.2 Map

ClickHouse `Map(String, String)` can store long-tail attributes.

Java:

```java
Map<String, String>
```

Good for:

- optional attributes;
- debugging;
- long-tail metadata.

Not good for hot filters/group-by.

### 11.3 Tuple

Useful internally for query expressions, less common in Java DTOs.

### 11.4 JSON

ClickHouse has JSON/semi-structured support evolving over versions.

Design rule remains:

```text
hot fields → physical columns
long-tail fields → JSON/Map
```

### 11.5 Java Payload Strategy

For ingestion:

```java
record EventPayload(
    Map<String, String> properties,
    String rawJson
) {}
```

But do not force every dashboard query to parse `rawJson`.

---

## 12. Insert Strategies

### 12.1 Bad: Row-by-Row Insert

```java
for (Event e : events) {
    jdbcTemplate.update("INSERT INTO events VALUES (?, ?, ...)", ...);
}
```

This creates many small inserts/parts and kills ClickHouse performance.

### 12.2 Good: Batch Insert

Batch rows into large inserts.

ClickHouse official guidance recommends large batches; documentation around bulk inserts recommends at least 1,000 rows and ideally 10,000–100,000 rows per insert for many workloads.

### 12.3 Batch Dimensions

Batch by:

- row count;
- byte size;
- max wait time;
- partition;
- shard;
- tenant if needed;
- source offset range.

Example:

```text
flush when:
  rows >= 50,000
  or bytes >= 50 MB
  or age >= 2 seconds
```

Tune based on workload.

### 12.4 Insert Formats

Common formats:

- `JSONEachRow`;
- `CSV`;
- `TabSeparated`;
- `RowBinary`;
- `Native`;
- `Parquet` via files;
- JDBC prepared/batch style.

Binary formats can be more efficient but more complex. JSONEachRow is convenient but CPU/string-heavy.

### 12.5 Use Input Function for JDBC Batch

Some JDBC examples use ClickHouse `input()` table function for typed batch inserts:

```sql
INSERT INTO events
SELECT *
FROM input('tenant_id UInt64, event_id UUID, event_time DateTime64(3), event_name String')
```

Then bind parameters.

Check current driver docs/examples for exact recommended API.

---

## 13. Client-Side Batching Architecture

### 13.1 Component

```text
EventReceiver
→ Validator
→ BatchBuffer
→ ClickHouseWriter
→ Retry/DLQ
→ Metrics
```

### 13.2 BatchBuffer

Group events by:

- target table;
- tenant/shard if app routing;
- partition bucket;
- schema version;
- source topic/partition.

### 13.3 Flush Policy

```java
if (rows >= maxRows || bytes >= maxBytes || age >= maxAge) {
    flush();
}
```

### 13.4 Backpressure

If ClickHouse slow:

- stop accepting unlimited events;
- slow consumer;
- pause Kafka consumption;
- queue bounded;
- DLQ invalid records;
- alert.

### 13.5 Metrics

Track:

- batch rows;
- batch bytes;
- flush latency;
- insert duration;
- retry count;
- failed rows;
- queue depth;
- ClickHouse error code;
- part count indirectly;
- ingestion lag.

---

## 14. Asynchronous Inserts

### 14.1 Concept

ClickHouse async inserts shift some batching responsibility to server: incoming inserts go to in-memory buffer and flush to storage later.

### 14.2 Benefits

- can help when client cannot batch enough;
- reduces small part creation;
- simplifies some application paths.

### 14.3 Risks

- durability/visibility semantics differ depending settings;
- if not waiting, client success may mean accepted to buffer, not flushed;
- error handling changes;
- memory buffer pressure;
- harder exact acknowledgement semantics.

### 14.4 Settings Concept

Typical settings include:

```text
async_insert = 1
wait_for_async_insert = 1 or 0
```

If `wait_for_async_insert=1`, client waits until data is flushed. If `0`, client may get success earlier.

Always verify exact behavior in your version.

### 14.5 Recommendation

Use client-side batching as primary architecture for critical pipelines.

Use async inserts when:

- workload suits it;
- semantics understood;
- metrics monitored;
- retries/idempotency still designed.

---

## 15. Idempotent Insert and Retry Design

### 15.1 The Timeout Problem

Client sends insert. Timeout happens.

Unknown:

- request never reached server;
- server inserted data but response lost;
- partially routed distributed insert;
- async insert accepted but not flushed;
- insert failed after some work.

Retry without idempotency can duplicate.

### 15.2 Required Fields

Every row/event should have:

- stable event_id;
- source system;
- source sequence/offset;
- batch_id;
- ingest_time;
- schema_version.

### 15.3 Batch ID

For Kafka:

```text
topic=case-events
partition=7
offset_start=120000
offset_end=120999
```

For file:

```text
s3://bucket/path/file.parquet + checksum
```

For API batch:

```text
producer_id + deterministic payload hash
```

### 15.4 Retry Rule

Retry same batch with same identity.

Do not regenerate event IDs.

### 15.5 Dedup Strategy

Options:

- ClickHouse insert dedup token where applicable;
- ReplacingMergeTree by event_id/version;
- query-level `argMax`;
- refined dedup table;
- batch metadata and cleanup;
- source offset commit only after safe insert.

### 15.6 Java Retry Policy

Retry only safe operations.

For insert:

```text
safe if idempotency is designed
```

For select:

```text
safe usually, but avoid retry storm
```

Implement:

- exponential backoff;
- jitter;
- max attempts;
- circuit breaker;
- DLQ;
- cancellation.

---

## 16. Query API Design

### 16.1 Do Not Expose Raw SQL From Frontend

Bad:

```http
POST /query
{ "sql": "SELECT ..." }
```

unless internal/admin with strict controls.

### 16.2 Use Query Families

Define query families:

```text
case_backlog_summary
case_lifecycle_trend
case_drilldown
product_event_trend
api_latency_dashboard
log_search
export_events
```

Each family has:

- source table;
- allowed metrics;
- allowed dimensions;
- required filters;
- max range;
- result limit;
- sync/async mode;
- exact/approx policy.

### 16.3 Request DTO

```java
record AnalyticsRequest(
    long tenantId,
    Instant from,
    Instant to,
    List<String> dimensions,
    List<String> metrics,
    Map<String, String> filters,
    int limit
) {}
```

### 16.4 Validate Before SQL

Validation:

- tenant required;
- time range bounded;
- dimensions whitelisted;
- no too many high-cardinality dimensions;
- metrics whitelisted;
- limit bounded;
- export threshold enforced.

### 16.5 SQL Builder

Use safe SQL construction.

Do not concatenate raw user input into SQL identifiers or expressions.

Maintain whitelist:

```java
Map<String, String> dimensionSql = Map.of(
    "day", "toDate(event_time)",
    "jurisdiction", "jurisdiction",
    "severity", "severity_at_event"
);
```

Only use values from map.

---

## 17. Parameter Binding and SQL Injection

### 17.1 Values

Bind values using prepared statements/client parameters where supported.

```sql
WHERE tenant_id = ?
  AND event_time >= ?
  AND event_time < ?
```

### 17.2 Identifiers Cannot Be Arbitrarily Bound

Columns, table names, order expressions often cannot be parameter-bound like values.

Use whitelist.

Bad:

```java
sql += " GROUP BY " + request.getGroupBy();
```

Good:

```java
String groupBy = allowedDimensions.get(request.dimension());
```

### 17.3 Table Routing

Do not allow user-chosen table name.

Route via query family:

```java
CASE_BACKLOG -> case_current_state
CASE_TREND -> daily_case_rollup
```

### 17.4 Sort Fields

Whitelist sort fields and directions.

---

## 18. Result Streaming

### 18.1 Problem

Bad:

```java
List<Row> rows = jdbcTemplate.query(...);
return rows;
```

for large result.

Can cause:

- Java heap growth;
- GC pressure;
- slow response;
- timeout;
- app crash.

### 18.2 Better

- stream rows;
- process incrementally;
- write to output stream;
- write to object storage;
- paginate/keyset for UI;
- limit result.

### 18.3 Synchronous API Result Size

For dashboard:

```text
small JSON response only
```

For large export:

```text
async job
```

### 18.4 DTO Allocation

Mapping millions of rows into rich Java objects is expensive.

For export:

- stream raw CSV/JSON/Parquet if possible;
- avoid object-per-cell overhead;
- use buffered IO.

---

## 19. Timeouts and Cancellation

### 19.1 Timeout Layers

Timeouts exist at:

- HTTP client;
- JDBC socket;
- connection pool;
- query setting `max_execution_time`;
- load balancer;
- Java controller;
- frontend;
- async job timeout.

They must align.

### 19.2 Bad Timeout Behavior

Java HTTP request times out at 10s, but ClickHouse query continues for 5 minutes.

Then client retries.

Now cluster runs duplicate heavy queries.

### 19.3 Better

- set server query timeout;
- propagate query_id;
- cancel query on client cancellation when possible;
- avoid retrying expensive timed-out queries;
- use async job for long work.

### 19.4 Query Kill

Operationally:

```sql
KILL QUERY WHERE query_id = '...';
```

Your runbook can use query_id from Java logs.

---

## 20. Connection Management

### 20.1 Do You Need a Pool?

For JDBC, connection pools are common. But ClickHouse is not OLTP; you may not need huge pool sizes.

Too many connections/concurrent queries can overload cluster.

### 20.2 Pool Size

Set pool based on:

- allowed API concurrency;
- ClickHouse capacity;
- query cost;
- workload class.

Do not use default massive pool blindly.

### 20.3 Multiple Hosts

In cluster/cloud:

- configure multiple endpoints if supported;
- use load balancer;
- avoid all traffic to one coordinator node;
- handle failover.

### 20.4 Separate Clients by Workload

Use separate clients/profiles:

```text
dashboardClient
ingestionClient
exportClient
adminClient
```

with different timeouts/settings/users.

---

## 21. Observability from Java

### 21.1 Log Every Query Family

Log:

- query_id;
- query family;
- tenant;
- time range;
- dimensions;
- metrics;
- duration;
- result rows;
- exception;
- ClickHouse host;
- retry count.

Do not log sensitive raw SQL values if they contain PII.

### 21.2 Metrics

Expose:

- request count by query family;
- latency p50/p95/p99;
- error count by ClickHouse error code;
- timeout count;
- result row count;
- insert batch rows;
- insert duration;
- ingest lag;
- retry count;
- DLQ count.

### 21.3 Tracing

Add trace spans:

```text
analytics.validate
analytics.build_sql
clickhouse.query
clickhouse.deserialize
analytics.serialize_response
```

This separates DB time from Java serialization time.

### 21.4 Correlation

Set ClickHouse `query_id` equal or related to trace/request ID.

Then join Java logs with ClickHouse `system.query_log`.

---

## 22. Spring Boot Architecture Example

### 22.1 Layers

```text
Controller
→ AnalyticsService
→ QueryValidator
→ QueryPlanner
→ SqlRenderer
→ ClickHouseClientGateway
→ ResultMapper/Streamer
```

### 22.2 Avoid

```text
Controller directly builds SQL string
```

### 22.3 Query Family Metadata

```java
enum QueryFamily {
    CASE_BACKLOG_SUMMARY,
    CASE_LIFECYCLE_TREND,
    CASE_DRILLDOWN,
    CASE_EXPORT
}
```

Metadata:

```java
record QueryPolicy(
    String sourceTable,
    Set<String> allowedDimensions,
    Set<String> allowedMetrics,
    Duration maxRange,
    int maxResultRows,
    ExecutionMode mode
) {}
```

### 22.4 Query Planning

Request:

```json
{
  "tenantId": 10,
  "from": "2026-01-01T00:00:00Z",
  "to": "2026-07-01T00:00:00Z",
  "dimensions": ["day", "jurisdiction"],
  "metrics": ["opened_cases"]
}
```

Planner chooses:

```text
daily_case_rollup
```

not raw events.

---

## 23. Example: Case Lifecycle Trend API

### 23.1 Request DTO

```java
record CaseLifecycleTrendRequest(
    long tenantId,
    Instant from,
    Instant to,
    List<String> groupBy,
    List<String> eventTypes
) {}
```

### 23.2 Allowed Dimensions

```java
Map<String, String> DIMENSIONS = Map.of(
    "day", "day",
    "jurisdiction", "jurisdiction",
    "severity", "severity",
    "caseType", "case_type"
);
```

### 23.3 SQL Template

```sql
SELECT
    {dimensions},
    sum(opened_count) AS opened_count,
    sum(closed_count) AS closed_count
FROM daily_case_lifecycle_rollup
WHERE tenant_id = {tenant_id}
  AND day >= {from_day}
  AND day < {to_day}
  {event_filters}
GROUP BY {dimensions}
ORDER BY {dimensions}
LIMIT {limit}
```

### 23.4 Validation

- max range 5 years for rollup;
- raw table not used;
- dimensions whitelisted;
- limit capped;
- tenant required.

### 23.5 Query ID

```text
case-analytics/case-lifecycle-trend/tenant-10/req-uuid
```

---

## 24. Example: Ingestion Service Batch Insert

### 24.1 Event DTO

```java
record CaseLifecycleEvent(
    long tenantId,
    UUID eventId,
    UUID caseId,
    Instant eventTime,
    String eventType,
    String jurisdiction,
    String severityAtEvent,
    long actorUserId,
    String ingestBatchId,
    int schemaVersion
) {}
```

### 24.2 Batch Metadata

```java
record BatchMetadata(
    String source,
    String sourcePartition,
    long offsetStart,
    long offsetEnd,
    String batchId,
    Instant receivedAt
) {}
```

### 24.3 Insert Design

- validate all rows;
- group by target table/partition if useful;
- write batch;
- retry with same batchId;
- commit Kafka offset only after safe insert;
- record ingestion batch table.

### 24.4 Batch Table

```sql
CREATE TABLE ingestion_batches
(
    batch_id String,
    source LowCardinality(String),
    partition_id String,
    offset_start UInt64,
    offset_end UInt64,
    row_count UInt64,
    status LowCardinality(String),
    started_at DateTime64(3),
    completed_at Nullable(DateTime64(3)),
    error String
)
ENGINE = MergeTree
ORDER BY (source, started_at, batch_id);
```

---

## 25. Error Handling

### 25.1 Error Classes

Classify errors:

| Error | Retry? |
|---|---|
| network timeout on SELECT | maybe, with backoff |
| network timeout on INSERT | only if idempotent |
| syntax error | no |
| unknown column | no, migration/schema issue |
| memory limit exceeded | no immediate retry; query too heavy |
| too many parts | no blind retry; ingestion/merge issue |
| server overloaded | retry with backoff/circuit breaker |
| auth error | no |
| quota exceeded | no/after delay depending policy |

### 25.2 DLQ

Invalid records should go to DLQ with:

- reason;
- original payload;
- schema version;
- source offset;
- timestamp;
- retry status.

### 25.3 Partial Failure

For batch insert, know whether driver/server gives all-or-nothing behavior for your path. Design idempotency anyway.

---

## 26. Formats and Serialization

### 26.1 JSONEachRow

Pros:

- easy;
- human-readable;
- flexible.

Cons:

- larger payload;
- parsing CPU;
- type mistakes at runtime.

### 26.2 CSV/TSV

Pros:

- compact-ish;
- simple.

Cons:

- escaping/null/time issues;
- schema order sensitive.

### 26.3 RowBinary/Native

Pros:

- efficient;
- typed;
- lower parsing overhead.

Cons:

- more complex;
- client support/implementation details.

### 26.4 Parquet

Good for:

- batch load;
- object storage;
- data lake;
- exports.

Less common for small streaming inserts directly from Java service.

### 26.5 Recommendation

Start with maintainable format, benchmark, then optimize.

For high-throughput ingestion, consider binary formats/client APIs after correctness is solid.

---

## 27. Security

### 27.1 Credentials

Use:

- dedicated ClickHouse users per workload;
- secret manager;
- TLS;
- least privilege;
- no admin credentials in app.

### 27.2 Users

Example users:

```text
analytics_dashboard_user
analytics_export_user
analytics_ingestion_user
analytics_admin_user
```

### 27.3 Permissions

Dashboard user:

- SELECT only on serving tables;
- no raw PII tables if not needed;
- query limits.

Ingestion user:

- INSERT into target tables;
- maybe SELECT minimal health;
- no DROP/ALTER.

Export user:

- SELECT with controlled profile.

### 27.4 SQL Injection

Whitelisting is mandatory for dynamic identifiers.

### 27.5 PII

Do not log raw SQL with PII values.

Mask sensitive filters.

---

## 28. Testing Strategy

### 28.1 Unit Tests

- query validation;
- SQL rendering with whitelisted dimensions;
- time range boundary;
- type conversion;
- result mapping.

### 28.2 Integration Tests

Use test ClickHouse container/environment.

Test:

- create schema;
- insert batch;
- query results;
- DateTime64 precision;
- Decimal precision;
- nullable mapping;
- duplicate retry;
- query timeout if possible.

### 28.3 Load Tests

Test:

- insert throughput;
- dashboard concurrency;
- export streaming;
- retry behavior;
- backpressure.

### 28.4 Golden Query Tests

For metrics correctness, store small datasets and expected outputs.

Examples:

- DAU distinct over multiple days;
- case lifecycle opened/closed;
- correction event;
- tombstone;
- late event.

---

## 29. Java Integration Anti-Patterns

### 29.1 Row-by-Row Insert

Causes small parts and bad performance.

### 29.2 Random Event IDs on Retry

Breaks dedup.

### 29.3 Exposing Arbitrary SQL

Security and resource disaster.

### 29.4 Loading Huge Result into List

Java heap OOM.

### 29.5 No Query ID

Production debugging pain.

### 29.6 No Timeout Alignment

Client times out but server query keeps running.

### 29.7 Blind Retry

Amplifies load and duplicates inserts.

### 29.8 One Connection Pool for All Workloads

Dashboard/export/ingestion interfere.

### 29.9 Treating ClickHouse Like JPA Entity Store

Wrong abstraction.

### 29.10 No Schema Compatibility Plan

App deploy writes columns not yet available across cluster.

---

## 30. Production Checklist

### Client Choice

- [ ] Use JDBC only where JDBC compatibility is useful.
- [ ] Use official Java client/direct API where control/performance matters.
- [ ] HTTP/direct format chosen intentionally.
- [ ] Driver/client versions pinned and tested.

### Types

- [ ] DateTime/timezone policy documented.
- [ ] Decimal uses BigDecimal.
- [ ] Unsigned integers handled safely.
- [ ] Nullable mapped to boxed/domain types.
- [ ] UUID mapped correctly.
- [ ] Hot strings use LowCardinality in schema.
- [ ] JSON/Map not used for hot filters.

### Inserts

- [ ] Batch size policy exists.
- [ ] Row-by-row inserts forbidden.
- [ ] Stable event_id exists.
- [ ] Stable batch_id exists.
- [ ] Retry idempotency exists.
- [ ] DLQ exists.
- [ ] Backpressure exists.
- [ ] Insert metrics exist.
- [ ] Async insert semantics understood if used.

### Queries

- [ ] Query families defined.
- [ ] Raw SQL not exposed to users.
- [ ] Dimensions/metrics whitelisted.
- [ ] Tenant/time filters required.
- [ ] Max range/result enforced.
- [ ] Query_id propagated.
- [ ] Timeout/cancellation configured.
- [ ] Results streamed or bounded.
- [ ] Export is async.

### Operations

- [ ] Java logs correlate with `system.query_log`.
- [ ] Workload users/profiles separated.
- [ ] Connection pool sizes controlled.
- [ ] Multiple hosts/load balancing configured.
- [ ] Error classes mapped to retry/no-retry.
- [ ] Schema migration compatibility tested.
- [ ] Security credentials managed.

---

## 31. Exercises

### Exercise 1: Insert Retry

A Java service inserts 50,000 events and times out. It retries with new UUID event IDs.

Question:

```text
What can go wrong?
```

Expected:

```text
Duplicate business events cannot be deduplicated because identities changed. Use stable event IDs and batch IDs.
```

### Exercise 2: Dashboard Query Builder

Frontend sends:

```json
{
  "groupBy": "user_id, session_id, trace_id",
  "from": "2021-01-01",
  "to": "2026-01-01"
}
```

Question:

```text
Should backend run it?
```

Expected:

```text
No for synchronous dashboard. Validate dimensions/range, reject or route to async export/offline flow.
```

### Exercise 3: DateTime Bug

Java sends `LocalDateTime` from server in Jakarta timezone but ClickHouse interprets UTC.

Question:

```text
What is risk?
```

Expected:

```text
Events shift time buckets. Use Instant/OffsetDateTime and explicit timezone boundaries.
```

### Exercise 4: Result OOM

Endpoint returns 5 million rows as JSON list.

Question:

```text
How to redesign?
```

Expected:

```text
Aggregate/limit/page, or async export streaming to object storage. Do not load all rows into heap.
```

### Exercise 5: JDBC vs Java Client

Question:

```text
When is JDBC fine and when might direct Java client be better?
```

Expected:

```text
JDBC fine for compatibility/simple SQL/Spring tools. Direct Java client better for performance/control/direct API in specialized services.
```

---

## 32. Summary

Java integration with ClickHouse is not just about connecting a driver.

Core principles:

1. Treat ClickHouse as analytical read model and append-heavy store, not OLTP entity repository.
2. Choose JDBC, Java client, or HTTP based on workload.
3. Be explicit about type mapping, especially time, decimal, unsigned, nullable, UUID.
4. Batch inserts; never row-by-row.
5. Design idempotency before adding retries.
6. Use stable event IDs and batch IDs.
7. Build query APIs around query families and guardrails.
8. Stream or async large results.
9. Align timeouts and cancellation.
10. Propagate query_id for observability.
11. Separate users/clients by workload.
12. Test with realistic data, concurrency, and failure modes.

Practical sentence:

> The database may be columnar, but your Java integration is where correctness, idempotency, and operational safety are either preserved or destroyed.

---

## 33. Referensi Belajar Lanjutan

Gunakan dokumentasi resmi sesuai versi yang kamu pakai:

1. ClickHouse Docs — Java client.
2. ClickHouse Docs — JDBC driver.
3. ClickHouse Docs — Java integration.
4. ClickHouse Docs — HTTP interface.
5. ClickHouse Docs — Input and output formats.
6. ClickHouse Docs — Inserting data.
7. ClickHouse Docs — Bulk inserts.
8. ClickHouse Docs — Selecting an insert strategy.
9. ClickHouse Docs — Asynchronous inserts.
10. ClickHouse Docs — Data types.
11. ClickHouse Docs — DateTime and DateTime64.
12. ClickHouse Docs — Decimal.
13. ClickHouse Docs — UUID.
14. ClickHouse Docs — Query settings.
15. ClickHouse Docs — system.query_log.
16. ClickHouse Docs — Security/users/access control.

---

## 34. Status Seri

Part ini adalah:

```text
Part 027 / 034
```

Seri belum selesai.

Part berikutnya:

```text
Part 028 — Java Integration II: Spring Boot Analytics Service, Query Builder, Exports, and Operational Patterns
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-026.md">⬅️ Part 026 — Data Modeling Patterns: Events, Metrics, Logs, Traces, Audits, and Case Lifecycles</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-028.md">Part 028 — Java Integration II: Spring Boot Analytics Service, Query Builder, Exports, and Operational Patterns ➡️</a>
</div>
