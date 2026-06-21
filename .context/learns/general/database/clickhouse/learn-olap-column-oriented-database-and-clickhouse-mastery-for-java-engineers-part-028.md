# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-028.md

# Part 028 — Java Integration II: Spring Boot Analytics Service, Query Builder, Exports, and Operational Patterns

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **028 / 034**  
> Fokus: membangun analytics service berbasis Java/Spring Boot di atas ClickHouse: query family architecture, safe query builder, validation, streaming, async exports, caching, workload isolation, testing, observability, and operational runbooks.

---

## 0. Posisi Part Ini Dalam Seri

Part 027 membahas fondasi integrasi Java:

- pilihan client;
- JDBC vs Java client vs HTTP;
- type mapping;
- batching;
- retries;
- idempotency;
- query_id;
- streaming;
- timeout;
- security.

Part 028 ini naik satu level: bagaimana membangun **analytics service** yang production-ready.

Masalah yang sering terjadi bukan karena ClickHouse tidak cepat, tetapi karena service layer membiarkan query liar:

```text
Frontend bisa pilih dimensi apa pun.
BI user bisa scan 5 tahun raw table.
Export dijalankan synchronous.
Query timeout di Java, tetapi tetap berjalan di server.
Retry membuat query storm.
No query_id.
No query family.
No cost guardrail.
No freshness model.
```

Maka target part ini:

> Membuat ClickHouse accessible sebagai produk analytics yang aman, predictable, auditable, dan maintainable.

Kita akan membangun mental model dan pattern yang cocok untuk Java tech lead/backend engineer.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. mendesain Spring Boot analytics service di atas ClickHouse;
2. membedakan query endpoint, ingestion endpoint, export job, and report job;
3. membuat query family metadata;
4. membangun safe query builder berbasis whitelist;
5. menerapkan validation sebelum SQL dibuat;
6. merancang sync vs async execution;
7. membuat export pipeline yang tidak membebani heap Java;
8. menerapkan caching berdasarkan freshness watermark;
9. menerapkan query_id, logging, metrics, tracing;
10. mengelola timeout, cancellation, retry, and backpressure;
11. membuat integration test untuk metric correctness;
12. membuat operational runbook untuk query lambat, export stuck, and ingestion lag;
13. mendesain service layer untuk regulatory/case analytics;
14. menghindari anti-pattern raw SQL endpoint dan generic repository.

---

## 2. Mental Model Utama: Analytics Service adalah Semantic Gateway

Jangan jadikan Spring Boot service hanya proxy SQL:

```text
HTTP request
→ concatenate SQL
→ ClickHouse
→ return rows
```

Itu berbahaya.

Analytics service harus menjadi **semantic gateway**:

```text
HTTP request
→ validate business intent
→ choose query family
→ choose serving table
→ enforce tenant/security/time range
→ render safe SQL from whitelist
→ execute with workload policy
→ stream/map result
→ attach freshness/metadata
→ log query_id and metrics
```

Dengan begitu, ClickHouse tidak terekspos sebagai raw database, tetapi sebagai backend analytics product.

---

## 3. Architecture Overview

### 3.1 High-Level Components

```text
Controller
  ↓
Request Validator
  ↓
Query Family Resolver
  ↓
Query Planner
  ↓
SQL Renderer
  ↓
ClickHouse Gateway
  ↓
Result Mapper / Streamer
  ↓
Response Builder
```

Supporting components:

```text
Freshness Service
Export Job Service
Cache Service
Security/Tenant Scope Service
Query Metrics Recorder
Backpressure/Circuit Breaker
Schema Metadata Registry
```

### 3.2 Package Structure Example

```text
com.example.analytics
  ├── api
  │   ├── CaseAnalyticsController
  │   ├── ProductAnalyticsController
  │   └── ExportController
  ├── application
  │   ├── AnalyticsQueryService
  │   ├── ExportJobService
  │   └── ReportGenerationService
  ├── query
  │   ├── QueryFamily
  │   ├── QueryPolicy
  │   ├── QueryPlanner
  │   ├── SqlRenderer
  │   ├── DimensionRegistry
  │   ├── MetricRegistry
  │   └── QueryValidationException
  ├── clickhouse
  │   ├── ClickHouseGateway
  │   ├── ClickHouseQueryExecutor
  │   ├── ClickHouseInsertWriter
  │   └── ClickHouseSettings
  ├── export
  │   ├── ExportJob
  │   ├── ExportWriter
  │   └── ObjectStorageExportSink
  ├── freshness
  │   └── FreshnessService
  └── observability
      ├── QueryIdFactory
      ├── AnalyticsMetrics
      └── QueryAuditLogger
```

### 3.3 Key Design Rule

Do not spread SQL across controllers.

Centralize:

- query templates;
- dimensions;
- metrics;
- table routing;
- limits;
- settings;
- query family ownership.

---

## 4. Query Family

### 4.1 Definition

A query family is a known class of analytical question.

Examples:

```text
CASE_BACKLOG_SUMMARY
CASE_LIFECYCLE_TREND
CASE_DRILLDOWN
CASE_SLA_DISTRIBUTION
PRODUCT_EVENT_TREND
PRODUCT_DAU
API_LATENCY_DASHBOARD
LOG_SEARCH
AUDIT_SUBJECT_HISTORY
EXPORT_CASE_EVENTS
OFFICIAL_CASE_REPORT
```

Each query family has:

- source table;
- allowed dimensions;
- allowed metrics;
- required filters;
- max time range;
- max result rows;
- execution mode;
- freshness model;
- approximate/exact policy;
- workload profile.

### 4.2 Java Enum

```java
public enum QueryFamily {
    CASE_BACKLOG_SUMMARY,
    CASE_LIFECYCLE_TREND,
    CASE_DRILLDOWN,
    PRODUCT_EVENT_TREND,
    API_LATENCY_DASHBOARD,
    LOG_SEARCH,
    EXPORT_CASE_EVENTS,
    OFFICIAL_CASE_REPORT
}
```

### 4.3 Query Policy

```java
public record QueryPolicy(
    QueryFamily family,
    String sourceTable,
    Set<String> requiredFilters,
    Set<String> allowedDimensions,
    Set<String> allowedMetrics,
    Duration maxTimeRange,
    int maxDimensions,
    int maxResultRows,
    ExecutionMode executionMode,
    FreshnessPolicy freshnessPolicy,
    WorkloadClass workloadClass
) {}
```

### 4.4 Execution Mode

```java
public enum ExecutionMode {
    SYNC,
    ASYNC_EXPORT,
    ASYNC_REPORT
}
```

### 4.5 Workload Class

```java
public enum WorkloadClass {
    DASHBOARD,
    DRILLDOWN,
    LOG_SEARCH,
    EXPORT,
    REPORT,
    ADMIN
}
```

---

## 5. Dimension Registry

### 5.1 Why Needed?

User request may say:

```json
"groupBy": ["day", "jurisdiction"]
```

But SQL must be controlled:

```sql
toDate(event_time) AS day,
jurisdiction
```

Do not let arbitrary strings become SQL.

### 5.2 Dimension Definition

```java
public record DimensionDef(
    String name,
    String selectExpression,
    String groupByExpression,
    Cardinality cardinality,
    boolean allowedInSync,
    Set<QueryFamily> families
) {}
```

### 5.3 Cardinality

```java
public enum Cardinality {
    LOW,
    MEDIUM,
    HIGH,
    VERY_HIGH
}
```

### 5.4 Registry Example

```java
Map<String, DimensionDef> caseDimensions = Map.of(
    "day", new DimensionDef(
        "day",
        "day",
        "day",
        Cardinality.LOW,
        true,
        Set.of(QueryFamily.CASE_LIFECYCLE_TREND)
    ),
    "jurisdiction", new DimensionDef(
        "jurisdiction",
        "jurisdiction",
        "jurisdiction",
        Cardinality.LOW,
        true,
        Set.of(QueryFamily.CASE_LIFECYCLE_TREND, QueryFamily.CASE_BACKLOG_SUMMARY)
    ),
    "caseId", new DimensionDef(
        "caseId",
        "case_id",
        "case_id",
        Cardinality.VERY_HIGH,
        false,
        Set.of(QueryFamily.CASE_DRILLDOWN)
    )
);
```

### 5.5 Rule

High-cardinality dimensions should not be allowed in dashboard queries unless:

- query is highly filtered;
- result bounded;
- table is designed for it;
- execution mode is async.

---

## 6. Metric Registry

### 6.1 Metric Definition

```java
public record MetricDef(
    String name,
    String expression,
    boolean approximate,
    Set<QueryFamily> families
) {}
```

### 6.2 Examples

For rollup table:

```java
Map<String, MetricDef> metrics = Map.of(
    "openedCases", new MetricDef(
        "openedCases",
        "sum(opened_count) AS opened_cases",
        false,
        Set.of(QueryFamily.CASE_LIFECYCLE_TREND)
    ),
    "closedCases", new MetricDef(
        "closedCases",
        "sum(closed_count) AS closed_cases",
        false,
        Set.of(QueryFamily.CASE_LIFECYCLE_TREND)
    ),
    "uniqueCases", new MetricDef(
        "uniqueCases",
        "uniqMerge(cases) AS unique_cases",
        true,
        Set.of(QueryFamily.CASE_SLA_DISTRIBUTION)
    )
);
```

### 6.3 Why Metric Registry Matters

It prevents:

- user injecting aggregate expressions;
- wrong metric finalization;
- summing non-additive metrics;
- approximate metric being used where exact required;
- using raw table for metric that has rollup.

---

## 7. Request Validation

### 7.1 Validation Before SQL

Do not build SQL before validation.

Validate:

- tenant scope;
- time range;
- dimensions;
- metrics;
- filters;
- max result;
- execution mode;
- access control;
- query family compatibility;
- high-cardinality combination;
- raw table access permission.

### 7.2 Example Request

```java
public record AnalyticsQueryRequest(
    long tenantId,
    Instant from,
    Instant to,
    List<String> dimensions,
    List<String> metrics,
    Map<String, Object> filters,
    int limit
) {}
```

### 7.3 Validator Pseudocode

```java
void validate(AnalyticsQueryRequest request, QueryPolicy policy) {
    requireTenant(request.tenantId());
    requireTimeRange(request.from(), request.to());

    if (Duration.between(request.from(), request.to()).compareTo(policy.maxTimeRange()) > 0) {
        throw new QueryValidationException("Time range too large for " + policy.family());
    }

    if (request.dimensions().size() > policy.maxDimensions()) {
        throw new QueryValidationException("Too many dimensions");
    }

    for (String dim : request.dimensions()) {
        DimensionDef def = dimensionRegistry.get(dim);
        if (def == null || !def.families().contains(policy.family())) {
            throw new QueryValidationException("Dimension not allowed: " + dim);
        }
        if (def.cardinality() == Cardinality.VERY_HIGH && policy.executionMode() == ExecutionMode.SYNC) {
            throw new QueryValidationException("High-cardinality dimension requires export");
        }
    }

    for (String metric : request.metrics()) {
        MetricDef def = metricRegistry.get(metric);
        if (def == null || !def.families().contains(policy.family())) {
            throw new QueryValidationException("Metric not allowed: " + metric);
        }
    }

    if (request.limit() > policy.maxResultRows()) {
        throw new QueryValidationException("Limit too large");
    }
}
```

### 7.4 Good Error Message

Bad:

```text
Query rejected.
```

Good:

```text
This query groups by high-cardinality field caseId over 180 days. Use case drilldown endpoint or export job.
```

---

## 8. Query Planner

### 8.1 Role

Planner chooses:

- source table;
- selected dimensions;
- selected metrics;
- filters;
- grouping;
- ordering;
- limit;
- settings;
- sync vs async.

### 8.2 Example Planning Decision

Request:

```text
CASE_LIFECYCLE_TREND
from=2026-01-01
to=2026-06-01
dimensions=[day,jurisdiction]
metrics=[openedCases,closedCases]
```

Planner chooses:

```text
table = daily_case_lifecycle_rollup
time column = day
execution = sync
```

Request:

```text
CASE_LIFECYCLE_TREND
dimensions=[caseId]
range=5 years
```

Planner rejects or routes to export/drilldown.

### 8.3 Planner Output

```java
public record PlannedQuery(
    QueryFamily family,
    String sql,
    Map<String, Object> parameters,
    QuerySettings settings,
    ExecutionMode mode,
    WorkloadClass workloadClass
) {}
```

---

## 9. Safe SQL Renderer

### 9.1 Build from Whitelisted Pieces

SQL renderer should only assemble:

- table name from policy;
- select expressions from dimension/metric registry;
- predicates from approved filters;
- order by from whitelist;
- bound values as parameters.

### 9.2 Example Rendered SQL

```sql
SELECT
    day,
    jurisdiction,
    sum(opened_count) AS opened_cases,
    sum(closed_count) AS closed_cases
FROM daily_case_lifecycle_rollup
WHERE tenant_id = ?
  AND day >= ?
  AND day < ?
GROUP BY
    day,
    jurisdiction
ORDER BY
    day,
    jurisdiction
LIMIT 10000
```

### 9.3 Avoid Identifier Injection

Never:

```java
sql += " GROUP BY " + String.join(",", request.dimensions());
```

Instead:

```java
List<String> groupBy = request.dimensions().stream()
    .map(dimensionRegistry::get)
    .map(DimensionDef::groupByExpression)
    .toList();
```

### 9.4 Filter Registry

Filters also need whitelist.

```java
public record FilterDef(
    String name,
    String columnExpression,
    FilterOperator operator,
    Class<?> valueType,
    Set<QueryFamily> families
) {}
```

Examples:

```text
jurisdiction IN (...)
severity IN (...)
event_type IN (...)
service = ...
level IN (...)
case_id = ...
```

---

## 10. Query Settings by Workload

### 10.1 Dashboard Settings

```text
max_execution_time: short
max_result_rows: small
max_memory_usage: bounded
readonly: true
```

Goal:

```text
fail fast, protect cluster
```

### 10.2 Export Settings

```text
max_execution_time: longer
max_result_rows: larger or streaming
max_memory_usage: controlled
lower priority
```

Goal:

```text
finish heavy job without hurting dashboards
```

### 10.3 Admin/Report Settings

```text
controlled, auditable, often async
```

### 10.4 Ingestion Settings

```text
insert-focused
async_insert if used
wait_for_async_insert decision
compression
```

### 10.5 Java Representation

```java
public record QuerySettings(
    Duration maxExecutionTime,
    long maxMemoryBytes,
    int maxResultRows,
    boolean readonly,
    String profile
) {}
```

Exact mapping to ClickHouse settings depends on client.

---

## 11. Query ID Strategy

### 11.1 Format

```text
<service>/<family>/<tenant>/<request-id>
```

Example:

```text
case-analytics/CASE_LIFECYCLE_TREND/tenant-10/01HZABC
```

### 11.2 Requirements

- globally unique enough;
- not too long;
- no sensitive data;
- included in Java logs;
- sent to ClickHouse;
- returned in error response for support if appropriate.

### 11.3 Benefits

With query_id:

```sql
SELECT *
FROM system.query_log
WHERE query_id = 'case-analytics/...';
```

You can debug:

- duration;
- read bytes;
- memory;
- exception;
- query text;
- distributed fragments.

---

## 12. Sync Query Flow

### 12.1 Flow

```text
HTTP request
→ auth/tenant validation
→ query validation
→ plan
→ execute with query_id/settings
→ map result
→ attach freshness
→ return response
```

### 12.2 Response Metadata

Include:

```json
{
  "data": [...],
  "meta": {
    "queryId": "...",
    "freshness": {
      "maxEventTime": "...",
      "maxIngestTime": "..."
    },
    "approximate": false,
    "source": "daily_case_lifecycle_rollup"
  }
}
```

### 12.3 Why Metadata Matters

Users need to know:

- data freshness;
- approximate/exact;
- source;
- report version if relevant;
- query id for support.

---

## 13. Async Export Flow

### 13.1 Why Async

Large exports should not be synchronous.

Problems with sync export:

- request timeout;
- Java heap;
- client disconnect;
- retry duplicates;
- cluster overload;
- no progress tracking.

### 13.2 Flow

```text
POST /exports
→ validate request
→ create export_job row
→ enqueue job
→ worker executes ClickHouse query
→ streams result to object storage
→ updates job status
→ user downloads file
```

### 13.3 Export Job Table

OLTP database can store job metadata.

```sql
export_jobs
  id
  tenant_id
  requested_by
  query_family
  request_json
  status
  created_at
  started_at
  completed_at
  output_uri
  error_message
```

This should live in transactional DB, not necessarily ClickHouse.

### 13.4 ClickHouse Export Audit Table

ClickHouse audit can record export event:

```sql
CREATE TABLE analytics_export_audit
(
    tenant_id UInt64,
    export_id UUID,
    requested_by String,
    requested_at DateTime64(3),
    completed_at Nullable(DateTime64(3)),
    query_family LowCardinality(String),
    status LowCardinality(String),
    output_uri String,
    row_count UInt64
)
ENGINE = MergeTree
ORDER BY (tenant_id, requested_at, export_id);
```

### 13.5 Streaming

Worker should stream:

```text
ClickHouse response → object storage output stream
```

not:

```text
ClickHouse → List<Row> in heap → CSV string → upload
```

### 13.6 Export Limits

Even async exports need limits:

- max date range;
- max output size;
- max concurrent jobs per tenant;
- max jobs per user;
- allowed fields;
- audit logging.

---

## 14. Official Report Generation

### 14.1 Difference from Export

Export:

```text
user asks for data extract
```

Official report:

```text
system generates reproducible business/regulatory artifact
```

### 14.2 Flow

```text
validate source watermarks
check no active mutation/rebuild
run controlled query
write report_snapshot table
compute checksum
record report_run metadata
publish/report
```

### 14.3 Report Snapshot

```sql
INSERT INTO official_case_report_snapshots
SELECT
    tenant_id,
    '2026-06' AS report_period,
    1 AS report_version,
    now64(3) AS generated_at,
    source_watermark,
    jurisdiction,
    severity,
    opened_cases,
    closed_cases,
    backlog_cases,
    checksum,
    '' AS amendment_reason
FROM ...
```

### 14.4 Java Report Service

Responsibilities:

- choose report version;
- ensure idempotency;
- lock report period during generation;
- validate row counts;
- handle amendments;
- store metadata;
- produce artifact.

---

## 15. Freshness Service

### 15.1 Why Needed

Analytics data may lag.

Expose freshness instead of pretending real-time.

### 15.2 Watermark Table

```sql
CREATE TABLE ingestion_watermarks
(
    pipeline LowCardinality(String),
    tenant_id UInt64,
    max_event_time DateTime64(3),
    max_ingest_time DateTime64(3),
    updated_at DateTime64(3),
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
ORDER BY (pipeline, tenant_id);
```

### 15.3 Query Freshness

```sql
SELECT
    argMax(max_event_time, version) AS max_event_time,
    argMax(max_ingest_time, version) AS max_ingest_time
FROM ingestion_watermarks
WHERE pipeline = 'case-events'
  AND tenant_id = 10;
```

### 15.4 API Metadata

Return:

```json
"freshness": {
  "maxEventTime": "2026-06-21T10:25:00Z",
  "maxIngestTime": "2026-06-21T10:25:15Z",
  "status": "FRESH"
}
```

### 15.5 Cache Key

Use watermark in cache key:

```text
queryFamily + tenant + params + maxIngestBucket
```

---

## 16. Caching Strategy

### 16.1 What to Cache

Good candidates:

- dashboard summaries;
- low-cardinality rollup results;
- metadata;
- official report results;
- freshness watermarks.

Bad candidates:

- huge raw exports;
- high-cardinality personalized queries;
- queries with sensitive unscoped data;
- constantly changing current state without watermark.

### 16.2 Cache Key

Include:

- tenant;
- query family;
- parameters;
- access scope;
- time bucket;
- freshness watermark;
- approximate/exact version;
- schema/report version.

### 16.3 TTL

Set based on freshness need.

Example:

```text
dashboard cache TTL = 30s
official report cache = indefinite by report version
metadata cache = 5m
```

### 16.4 Avoid Security Bug

Cache must include tenant and permission scope.

Never share cached response across tenants accidentally.

---

## 17. Backpressure and Circuit Breaker

### 17.1 Signals

- ClickHouse timeout rate high;
- memory limit exceeded;
- query queue/concurrency high;
- export queue too long;
- ingestion lag high;
- replica lag high;
- circuit breaker open.

### 17.2 Dashboard Behavior

If ClickHouse overloaded:

- serve cached data;
- reduce refresh;
- hide expensive widgets;
- show delayed freshness;
- fail fast for noncritical query.

### 17.3 Export Behavior

If export system overloaded:

- queue job;
- estimate delay;
- reject if quota exceeded;
- do not run unlimited parallel exports.

### 17.4 Java Circuit Breaker

Use circuit breaker per workload, not one global.

```text
dashboard breaker
export breaker
ingestion breaker
report breaker
```

---

## 18. Cancellation and Client Disconnect

### 18.1 Problem

Client disconnects, but ClickHouse query continues.

### 18.2 Strategy

- set server max_execution_time;
- propagate query_id;
- cancel query if request cancelled;
- avoid starting heavy sync query;
- use async jobs for long-running work.

### 18.3 Spring MVC / WebFlux

Depending stack:

- detect request cancellation;
- close response stream;
- call cancellation on client if supported;
- as fallback, issue `KILL QUERY WHERE query_id = ...`.

### 18.4 Caution

Killing query requires permission and must not kill unrelated query_id. Use unique query_id.

---

## 19. Streaming Export Implementation Pattern

### 19.1 Pseudocode

```java
public ExportResult runExport(ExportJob job) {
    String queryId = queryIdFactory.forExport(job.id());

    try (InputStream in = clickHouseGateway.queryAsStream(job.sql(), queryId, job.settings());
         OutputStream out = objectStorage.openUpload(job.outputKey())) {

        long bytes = in.transferTo(out);

        return ExportResult.success(bytes);
    } catch (Exception e) {
        return ExportResult.failed(e);
    }
}
```

### 19.2 Important Details

- use buffered streams;
- set timeout long enough;
- use backpressure;
- record rows/bytes if possible;
- handle partial upload cleanup;
- retry carefully;
- avoid duplicate export artifacts or mark versions.

### 19.3 Output Formats

Common export formats:

- CSV;
- JSONEachRow;
- Parquet;
- TSV;
- Arrow depending tooling.

Choose based on consumer.

### 19.4 Export Manifest

For large exports, write manifest:

```json
{
  "exportId": "...",
  "tenantId": 10,
  "queryFamily": "EXPORT_CASE_EVENTS",
  "generatedAt": "...",
  "format": "CSV",
  "files": [
    {"uri": "...", "bytes": 123456}
  ],
  "rowCount": 1000000,
  "checksum": "..."
}
```

---

## 20. Multi-Tenant Security

### 20.1 Tenant Filter Must Be Mandatory

Every query must include tenant scope unless endpoint is admin/global.

Do not rely only on frontend.

### 20.2 Tenant Scope Service

```java
TenantScope scope = tenantScopeService.resolve(authenticatedUser);
```

Validator ensures:

```text
request.tenantId in scope.allowedTenants
```

### 20.3 Database Row Policies

ClickHouse row policies can provide defense-in-depth, but application should still enforce tenant filters.

### 20.4 Export Security

Exports can leak lots of data.

Require:

- permission check;
- audit event;
- field whitelist;
- PII masking;
- expiry link;
- object storage ACL;
- download audit.

---

## 21. Schema Evolution

### 21.1 Additive Changes

Safe pattern:

```text
1. Add column with DEFAULT on ClickHouse.
2. Verify schema across cluster.
3. Deploy Java producer writing optional field.
4. Deploy query using field.
5. Backfill if needed.
```

### 21.2 Breaking Changes

Use versioning:

```text
new table or new column
dual-write
backfill
switch readers
retire old
```

### 21.3 Event Schema Version

In events:

```sql
schema_version UInt16
```

Parser can handle versions.

### 21.4 Query Compatibility

Query builder should know which schema/table version supports which dimension/metric.

### 21.5 Migration Safety

Do not deploy Java code that writes new column before DDL completed on cluster.

---

## 22. Testing Analytics Correctness

### 22.1 Golden Dataset

Create small deterministic dataset.

Example case lifecycle:

```text
case A opened day1 severity LOW
case A assigned day2
case B opened day1 severity HIGH
case A corrected severity HIGH day3
case C opened day2 then deleted
```

Expected metrics:

- opened by day;
- current backlog;
- severity at event;
- current severity;
- correction behavior.

### 22.2 Test Raw vs Rollup

Verify rollup query equals raw query for controlled dataset.

### 22.3 Late Event Test

Insert event with old event_time and new ingest_time. Verify rollup/snapshot strategy.

### 22.4 Duplicate Event Test

Insert same event twice. Verify dedup/report behavior.

### 22.5 Export Test

Ensure export:

- respects tenant;
- respects field whitelist;
- streams;
- records audit;
- creates manifest.

---

## 23. Integration Testing with ClickHouse

### 23.1 Test Container

Use ClickHouse container in integration tests if feasible.

Test:

- DDL creation;
- insert batch;
- query mapping;
- DateTime64 precision;
- Decimal precision;
- Nullable;
- UUID;
- Map/Array if used;
- error handling.

### 23.2 SQL Snapshot Tests

Store expected SQL output from renderer.

Ensure no unsafe SQL concatenation.

### 23.3 Performance Smoke Test

Small performance smoke:

- batch insert 10k rows;
- query rollup;
- stream export sample.

Not a full benchmark, but catches row-by-row mistakes.

---

## 24. Observability

### 24.1 Application Metrics

Per query family:

- request count;
- p50/p95/p99 latency;
- errors;
- timeout;
- result rows;
- cache hit ratio;
- export queued/running/failed;
- insert batch size;
- insert duration;
- retry count;
- DLQ count.

### 24.2 ClickHouse Correlation

Every query log event should correlate with app log via query_id.

### 24.3 Structured Log Example

```json
{
  "event": "clickhouse_query_finished",
  "queryId": "case-analytics/CASE_LIFECYCLE_TREND/tenant-10/req-123",
  "family": "CASE_LIFECYCLE_TREND",
  "tenantId": 10,
  "durationMs": 142,
  "resultRows": 120,
  "cacheHit": false
}
```

### 24.4 Periodic Query Log Import

Some teams ingest ClickHouse `system.query_log` into observability stack or another ClickHouse table for long-term analysis.

---

## 25. Operational Runbooks

### 25.1 Slow Dashboard

1. Get query_id from response/log.
2. Check app latency breakdown.
3. Check ClickHouse `system.query_log`.
4. Check read_rows/read_bytes/memory/result_rows.
5. Check cache hit/miss.
6. Check if query used raw table instead of rollup.
7. Check replica lag/merges/mutations.
8. Apply short-term cache/degrade if needed.
9. Create optimization ticket with evidence.

### 25.2 Export Stuck

1. Check export job status.
2. Check query_id in ClickHouse.
3. Check result streaming/upload.
4. Check object storage errors.
5. Check query memory/time.
6. Check if client disconnected.
7. Mark job failed/retry if idempotent.
8. Cleanup partial output.

### 25.3 Ingestion Lag

1. Check source lag.
2. Check batch buffer queue.
3. Check insert error rate.
4. Check ClickHouse insert duration.
5. Check distributed queue/replication queue.
6. Check too many parts.
7. Apply backpressure or scale ingestion.
8. Preserve offsets for replay.

### 25.4 High Error Rate

Classify:

- validation rejection;
- timeout;
- memory limit;
- syntax/schema;
- auth;
- network;
- ClickHouse overload.

Each has different remediation.

---

## 26. Regulatory Case Analytics Service Example

### 26.1 Endpoints

```text
GET /tenants/{tenantId}/cases/backlog/summary
GET /tenants/{tenantId}/cases/lifecycle/trend
GET /tenants/{tenantId}/cases/{caseId}/timeline
POST /tenants/{tenantId}/cases/export
POST /tenants/{tenantId}/reports/monthly-case-report
GET /tenants/{tenantId}/reports/monthly-case-report/{period}/{version}
```

### 26.2 Table Routing

| Endpoint | Table |
|---|---|
| backlog summary | case_current_state / backlog snapshot |
| lifecycle trend | daily_case_lifecycle_rollup |
| timeline | case_events_by_case |
| export | case_lifecycle_events |
| monthly report | official_case_report_snapshots |
| report generation | rollup + snapshot write |

### 26.3 Sync vs Async

Sync:

- backlog summary;
- lifecycle trend;
- case timeline with bounded case_id.

Async:

- export;
- official report generation;
- large historical recomputation.

### 26.4 Freshness

Backlog:

```text
fresh within 2 minutes
```

Official report:

```text
snapshot version
```

Export:

```text
generated_at and source watermark
```

---

## 27. Product Analytics Service Example

### 27.1 Endpoints

```text
GET /analytics/events/trend
GET /analytics/users/dau
GET /analytics/funnel
POST /analytics/events/export
```

### 27.2 Table Routing

| Query | Table |
|---|---|
| event trend | daily_product_event_rollup |
| DAU | daily_active_users AggregatingMergeTree |
| funnel | specialized funnel table or raw with strict range |
| export | raw product_events async |

### 27.3 Guardrails

- funnel range limited;
- high-cardinality group by rejected;
- user/session drilldown requires specific endpoint;
- DAU uses `uniqMerge`, not sum of daily uniques.

---

## 28. Observability Service Example

### 28.1 Endpoints

```text
GET /services/{service}/latency
GET /services/{service}/errors
GET /logs/search
GET /traces/{traceId}
POST /logs/export
```

### 28.2 Table Routing

| Endpoint | Table |
|---|---|
| latency | api_latency_1m |
| errors | logs rollup / logs raw recent |
| log search | logs with strict time/service |
| trace detail | spans_by_trace |
| export | logs raw async |

### 28.3 Guardrails

- service + time required;
- raw log search max range;
- message regex limited;
- trace lookup by trace_id;
- export async;
- payload fields excluded by default.

---

## 29. Anti-Patterns

### 29.1 Generic `/query` Endpoint

Unless internal and heavily controlled, avoid.

### 29.2 Controller Builds SQL

Leads to injection, duplication, no policy.

### 29.3 Frontend Chooses Table/Column

Security and performance disaster.

### 29.4 No Query Family

Cannot monitor or optimize product behavior.

### 29.5 Synchronous Exports

Heap/timeouts/retry storm.

### 29.6 No Freshness Metadata

Users assume real-time.

### 29.7 No Cache Scope

Tenant data leak risk.

### 29.8 No Query ID

Incident debugging becomes guesswork.

### 29.9 One User/Profile for Everything

Dashboards, exports, ingestion interfere.

### 29.10 Ignoring Metric Semantics

Query builder sums non-additive metrics incorrectly.

---

## 30. Production Checklist

### Architecture

- [ ] Analytics service is semantic gateway, not SQL proxy.
- [ ] Query families defined.
- [ ] Query policies defined.
- [ ] Dimension registry exists.
- [ ] Metric registry exists.
- [ ] Workload classes defined.
- [ ] Sync vs async rules defined.

### Validation

- [ ] Tenant filter mandatory.
- [ ] Time range bounded.
- [ ] Dimensions whitelisted.
- [ ] Metrics whitelisted.
- [ ] High-cardinality dimensions guarded.
- [ ] Result limits enforced.
- [ ] Raw table access restricted.

### Execution

- [ ] Query_id propagated.
- [ ] Per-workload settings used.
- [ ] Timeout aligned.
- [ ] Cancellation supported.
- [ ] Connection pools sized.
- [ ] Separate clients/users by workload.
- [ ] Results streamed or bounded.

### Export/Report

- [ ] Large exports async.
- [ ] Export audit recorded.
- [ ] Object storage output used.
- [ ] Report snapshots versioned.
- [ ] Source watermark/checksum recorded.
- [ ] Partial outputs cleaned.

### Freshness/Caching

- [ ] Freshness watermark available.
- [ ] API returns freshness metadata.
- [ ] Cache key includes tenant/scope/params/watermark.
- [ ] Cache TTL per query family.

### Observability

- [ ] Metrics per query family.
- [ ] Logs include query_id.
- [ ] Traces separate DB and serialization time.
- [ ] Errors classified.
- [ ] Runbooks exist.

### Testing

- [ ] SQL renderer tested.
- [ ] Validation tested.
- [ ] Golden metric tests exist.
- [ ] Integration tests use ClickHouse.
- [ ] Export streaming tested.
- [ ] Duplicate/late/correction cases tested.

---

## 31. Exercises

### Exercise 1: Design Query Policy

For endpoint:

```text
GET /cases/lifecycle/trend
```

Define:

- source table;
- allowed dimensions;
- metrics;
- max time range;
- sync/async mode.

Expected:

```text
source: daily_case_lifecycle_rollup
dimensions: day, jurisdiction, severity, case_type
metrics: opened_count, closed_count, escalated_count
max range: maybe 5 years on rollup
mode: sync
```

### Exercise 2: Reject Dangerous Query

Request asks:

```text
group by case_id over 3 years in dashboard
```

Expected:

```text
reject or route to async export/drilldown; case_id is very high cardinality.
```

### Exercise 3: Export Design

How would you export 100M rows?

Expected:

```text
async job, stream ClickHouse result to object storage, audit, manifest, limits, no heap materialization.
```

### Exercise 4: Freshness Cache

Dashboard cache currently key = tenant + params.

What is missing?

Expected:

```text
freshness watermark or version; otherwise stale cache semantics unclear.
```

### Exercise 5: Debug Slow Endpoint

API returns query_id.

What do you check?

Expected:

```text
Java logs/traces, system.query_log by query_id, read_rows/read_bytes/memory/result_rows, table health, cache hit/miss, replica lag.
```

---

## 32. Summary

A production Java analytics service should protect both users and ClickHouse.

Core principles:

1. Make service a semantic gateway, not SQL proxy.
2. Model query families explicitly.
3. Validate before rendering SQL.
4. Whitelist dimensions, metrics, filters, tables, and sort fields.
5. Separate dashboard, drilldown, export, report, and ingestion workloads.
6. Use async jobs for large exports and official reports.
7. Stream large outputs; do not load them into heap.
8. Expose freshness and query metadata.
9. Use query_id everywhere.
10. Cache with tenant/scope/watermark-safe keys.
11. Add backpressure and circuit breakers.
12. Test metric correctness, not only SQL syntax.

Practical sentence:

> ClickHouse gives you analytical power; the Java service decides whether that power becomes a reliable product or an expensive footgun.

---

## 33. Referensi Belajar Lanjutan

Gunakan dokumentasi resmi dan referensi implementasi sesuai versi yang kamu pakai:

1. ClickHouse Docs — Java client.
2. ClickHouse Docs — JDBC driver.
3. ClickHouse Docs — HTTP interface.
4. ClickHouse Docs — Query settings.
5. ClickHouse Docs — system.query_log.
6. ClickHouse Docs — Access control and users.
7. ClickHouse Docs — Quotas and settings profiles.
8. ClickHouse Docs — Input/output formats.
9. ClickHouse Docs — Asynchronous inserts.
10. ClickHouse Docs — Selecting an insert strategy.
11. ClickHouse Docs — Materialized views.
12. ClickHouse Docs — AggregatingMergeTree.
13. ClickHouse Docs — Query optimization.
14. Spring Boot Docs — Observability.
15. Micrometer Docs — Metrics.
16. OpenTelemetry Docs — Tracing.

---

## 34. Status Seri

Part ini adalah:

```text
Part 028 / 034
```

Seri belum selesai.

Part berikutnya:

```text
Part 029 — Production Ingestion Pipelines: Kafka, CDC, Backfills, Validation, and Reconciliation
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-027.md">⬅️ Part 027 — Java Integration I: JDBC, HTTP, Native Clients, Types, Batching, and Query APIs</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-029.md">Part 029 — Production Ingestion Pipelines: Kafka, CDC, Backfills, Validation, and Reconciliation ➡️</a>
</div>
