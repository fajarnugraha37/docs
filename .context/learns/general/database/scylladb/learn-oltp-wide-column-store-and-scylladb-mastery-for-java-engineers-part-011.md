# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-011.md

# Part 011 — Time-Series Modeling di ScyllaDB

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `011`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: mendesain workload time-series/timeline/event-log di ScyllaDB: time bucket, latest-N reads, range reads, event time vs write time, late arrivals, out-of-order writes, TTL, retention, tombstone, compaction, Java repository/API design, dan operational failure modes.

---

## 0. Posisi Part Ini dalam Seri

Part 010 membahas partition sizing, cardinality, hot partition, dan bucketing secara umum.

Part ini menerapkan prinsip tersebut ke salah satu workload paling natural untuk ScyllaDB:

```text
time-series / timeline / event-log data
```

Contoh:

- device telemetry,
- audit events,
- case lifecycle events,
- user notifications,
- login attempts,
- transaction events,
- application metrics,
- fraud signals,
- timeline feed,
- enforcement action history,
- workflow state transition history,
- IoT sensor readings,
- operational heartbeat.

Workload time-series cocok dengan ScyllaDB karena:

```text
writes are append-heavy
queries are often by entity + time range
data can be bucketed by time
clustering order can serve latest/range reads
retention can align with time windows
```

Tetapi time-series juga sering gagal karena:

```text
wrong partition bucket
hot entity
unbounded partition
TTL tombstone storm
late arrivals
range query too broad
read fanout too high
compaction mismatch
payload too large
```

---

## 1. Time-Series ≠ Satu Pola

“Time-series” adalah keluarga workload, bukan satu desain.

Bedakan minimal empat tipe:

### 1.1 Entity Timeline

```text
events by case_id
notifications by user_id
transactions by account_id
```

Query:

```text
latest N by entity
range by entity/time
```

### 1.2 High-Volume Telemetry

```text
device metrics
sensor readings
application metrics
```

Query:

```text
recent readings by device
range by device/time
downsampled aggregate
```

### 1.3 Audit/Event Log

```text
case lifecycle audit
command execution history
security audit
```

Query:

```text
append immutable event
read full history by entity
read latest events
export for compliance
```

### 1.4 Feed/Inbox

```text
notifications by user
activity feed
message inbox metadata
```

Query:

```text
latest N
mark read
expire old items
```

Each has different constraints.

Do not copy one schema for all time-series workloads.

---

## 2. Core Shape

Most ScyllaDB time-series tables follow this shape:

```sql
CREATE TABLE events_by_entity_bucket (
    entity_id uuid,
    bucket_time date_or_text,
    event_time timestamp,
    event_id uuid,
    payload text,
    PRIMARY KEY ((entity_id, bucket_time), event_time, event_id)
) WITH CLUSTERING ORDER BY (event_time DESC, event_id ASC);
```

Mental model:

```text
partition key = entity + time bucket
clustering = event time + tie-breaker
```

Benefits:

- data grouped by entity and bounded time window,
- latest reads are efficient,
- range reads within bucket,
- retention aligns with bucket,
- partition growth bounded.

But this is only starting point.

You must tune:

- bucket granularity,
- clustering order,
- tie-breaker,
- event time vs write time,
- hash bucket if hot,
- retention/TTL,
- read fanout,
- payload size.

---

## 3. Event Time vs Write Time

This is one of the most important decisions.

### 3.1 Event Time

Event time is when the business/sensor event actually happened.

Example:

```text
sensor reading measured at 10:00:01
case approved at 14:03:22
payment authorized at 18:30:00
```

### 3.2 Write Time

Write time is when the system ingested/wrote the event.

Example:

```text
server received event at 10:05:30
batch replay wrote historical event today
offline device synced yesterday's readings
```

They can differ.

### 3.3 Bucket by Event Time

Pros:

- natural for time range queries,
- retention by event age,
- audit/business semantics,
- query by “what happened between T1 and T2”.

Cons:

- late arrivals write into old buckets,
- old buckets may receive writes after compaction assumptions,
- TTL/retention can be tricky,
- backfill touches historical partitions.

### 3.4 Bucket by Write Time

Pros:

- ingestion locality,
- writes mostly hit current bucket,
- easier operational write pattern,
- good for append ingestion logs.

Cons:

- query by event time may need filtering/index/extra table,
- business time range harder,
- retention by event age less direct.

### 3.5 Dual-Time Modeling

Sometimes store both:

```sql
event_time timestamp,
ingested_at timestamp
```

And choose table based on query:

```text
events_by_entity_event_month
events_by_ingest_day
```

If you need both access patterns at scale, you may need two tables/projections.

---

## 4. Clustering Order: DESC vs ASC

### 4.1 DESC for Latest-N

If common query:

```text
latest 50 events by user/case/device
```

Use:

```sql
WITH CLUSTERING ORDER BY (event_time DESC, event_id ASC)
```

Query:

```sql
SELECT *
FROM notifications_by_user_day
WHERE tenant_id = ?
  AND user_id = ?
  AND bucket_day = ?
LIMIT 50;
```

### 4.2 ASC for Replay

If common query:

```text
replay events from oldest to newest
```

Use ASC or query ranges carefully.

Audit/event sourcing may prefer version/order ASC for replay, while UI latest view prefers DESC.

Options:

1. One table ASC and reverse in UI? Not always efficient for latest.
2. One table DESC for UI and export uses range/pages.
3. Two tables: one for latest serving, one for replay/export.
4. Use event_version and query by range.

Choose based on dominant access pattern and correctness.

---

## 5. Tie-Breaker

Never use timestamp alone as clustering key if collisions possible.

Bad:

```sql
PRIMARY KEY ((case_id, bucket_day), event_time)
```

Two events at same timestamp collide.

Better:

```sql
PRIMARY KEY ((case_id, bucket_day), event_time, event_id)
```

or:

```sql
PRIMARY KEY ((case_id, bucket_day), event_version, event_id)
```

Tie-breaker options:

- UUID,
- timeuuid,
- command_id,
- event_id,
- sequence/version.

For strict business order, prefer event_version.

For observational telemetry order, event_time + event_id can be enough.

---

## 6. Time Bucket Granularity

Bucket granularity determines partition size and read fanout.

Common buckets:

```text
minute
hour
day
week
month
version range
```

### 6.1 Formula

```text
rows_per_partition = writes_per_second_per_entity * seconds_per_bucket
bytes_per_partition = rows_per_partition * average_row_size
```

### 6.2 Example: Device Telemetry

```text
device writes = 100/sec
row size = 300 B
```

Day bucket:

```text
100 * 86400 = 8.64M rows
~2.6 GB/day/device
```

Too large.

Hour bucket:

```text
100 * 3600 = 360k rows
~108 MB/hour/device
```

Maybe acceptable.

Minute bucket:

```text
100 * 60 = 6k rows
~1.8 MB/min/device
```

Smaller, but read last hour requires 60 partitions.

### 6.3 Example: Case Events

```text
normal case = 100 events/month
large case = 100k events/month
row = 2 KB
```

Month bucket:

```text
normal: 200 KB/month
large: 200 MB/month
```

Maybe acceptable depending read/repair.

If extreme case:

```text
5M events/month * 2 KB = 10 GB/month
```

Need smaller bucket or version bucket.

---

## 7. Time Bucket Decision Matrix

| Workload | Write Rate | Common Read | Bucket Candidate |
|---|---:|---|---|
| User notifications | low/medium | latest/day | day |
| Case audit events | low/medium, skewed | latest/history by case | month or version bucket |
| Device telemetry | high | last minutes/hours | hour/minute |
| Login attempts | medium | recent by user/IP | day/hour |
| Payment events | high | by merchant/time | hour + hash bucket |
| Metrics | very high | downsample/aggregate | minute/hour + OLAP |
| Heartbeat | high | latest only | current state + recent time table |

Bucket should follow both write rate and read window.

---

## 8. Latest-N Reads Across Buckets

Suppose table:

```sql
PRIMARY KEY ((user_id, bucket_day), notification_time, notification_id)
WITH CLUSTERING ORDER BY (notification_time DESC, notification_id ASC)
```

To read latest 50:

```text
1. query today LIMIT 50
2. if fewer than 50, query yesterday
3. continue bounded number of days
```

Pseudo:

```java
List<Notification> result = new ArrayList<>();
LocalDate day = today;

while (result.size() < limit && daysChecked < maxDays) {
    Page page = repo.findByUserDay(userId, day, limit - result.size());
    result.addAll(page.items());
    day = day.minusDays(1);
}
```

This is acceptable if:

```text
maxDays bounded
partition query efficient
limit small
```

Not acceptable if:

```text
search 365 days in online request
```

For sparse feeds, consider index of active buckets:

```text
notification_bucket_index_by_user
```

or store current/recent feed differently.

---

## 9. Active Bucket Index

Sparse time-series problem:

```text
Some users have notifications only once/month.
Latest 50 might scan many empty day buckets.
```

Solution: maintain active bucket index.

```sql
CREATE TABLE notification_buckets_by_user (
    tenant_id uuid,
    user_id uuid,
    bucket_day date,
    last_notification_time timestamp,
    count_estimate int,
    PRIMARY KEY ((tenant_id, user_id), bucket_day)
) WITH CLUSTERING ORDER BY (bucket_day DESC);
```

Then latest read:

```text
1. read recent active bucket days
2. query those buckets
3. merge/fill limit
```

Trade-off:

- extra write per active bucket,
- derived metadata,
- cleanup/TTL,
- consistency lag.

Use only if sparse bucket scanning is real problem.

---

## 10. Range Query Within Buckets

Query by time range:

```text
from = 2026-06-01T00:00
to   = 2026-06-03T00:00
```

If bucket = day:

```text
query 2026-06-01
query 2026-06-02
```

For each bucket:

```sql
SELECT *
FROM events_by_entity_day
WHERE entity_id = ?
  AND bucket_day = ?
  AND event_time >= ?
  AND event_time < ?;
```

Need to adjust range per bucket:

```text
day1: max(from, day_start) to min(to, day_end)
day2: ...
```

Fanout is number of buckets in range.

Online API must limit range.

Batch/export can handle more with throttling.

---

## 11. Out-of-Order Writes

Time-series data often arrives out of order.

Examples:

- mobile device offline sync,
- sensor network delay,
- message retry,
- backfill,
- event replay,
- batch import,
- multi-region ingestion.

If clustering by event_time, out-of-order writes insert into older clustering positions.

This is fine logically, but affects:

- old buckets receiving writes,
- compaction assumptions,
- “latest” query if event_time is old,
- ordering semantics,
- duplicate detection,
- retention.

### 11.1 Design Questions

```text
Can event arrive late?
How late?
Should late event appear in historical order?
Should it affect current state?
Should it be accepted after retention window?
Should it update derived aggregates?
```

For regulatory audit, late event may need explicit correction event rather than silently inserting old event.

For telemetry, late reading may be accepted within lateness window.

---

## 12. Late Arrival Policy

Define policy:

| Policy | Meaning |
|---|---|
| accept always | historical correction allowed |
| accept within lateness window | e.g. 7 days |
| store as correction event | preserve audit timeline |
| reject after cutoff | data quality |
| store in quarantine | manual review |
| write by ingest time | avoid old bucket writes |

The database schema should support policy.

Example:

```text
lateness window = 7 days
bucket by event_day
TTL = 30 days
```

If event arrives 40 days late, what happens?

Do not let it silently write expired/tombstone-heavy bucket without policy.

---

## 13. Event Time vs Version for Audit

For audit/lifecycle systems, strict event order may be business order, not wall-clock order.

Example:

```text
event_version = 10 APPROVED
event_time = 10:00:01

event_version = 11 CLOSED
event_time = 09:59:59 due to clock skew
```

If clustering by event_time, order looks wrong.

For audit state machine:

```sql
PRIMARY KEY ((tenant_id, case_id, version_bucket), event_version, event_id)
```

Store event_time as column.

This separates:

```text
business sequence = event_version
observed timestamp = event_time
```

For regulatory defensibility, this is often better.

---

## 14. Version Bucket for Event Logs

If every case event has monotonic `event_version`:

```text
version_bucket = floor(event_version / 10000)
```

Table:

```sql
CREATE TABLE case_events_by_case_version_bucket (
    tenant_id uuid,
    case_id uuid,
    version_bucket bigint,
    event_version bigint,
    event_id uuid,
    event_time timestamp,
    event_type text,
    actor_id uuid,
    payload text,
    PRIMARY KEY ((tenant_id, case_id, version_bucket), event_version, event_id)
) WITH CLUSTERING ORDER BY (event_version ASC, event_id ASC);
```

Pros:

- bounded rows per partition,
- deterministic ordering,
- easy replay,
- late clock does not reorder lifecycle,
- latest bucket known from current state version.

Latest read:

```text
current_version from case_current
current_bucket = current_version / 10000
query current bucket DESC? 
```

If table ASC, latest read from end is not as natural. You may choose DESC:

```sql
WITH CLUSTERING ORDER BY (event_version DESC, event_id ASC)
```

or maintain separate latest view.

---

## 15. Time-Series with Current Snapshot

Many time-series workloads also need latest current value.

Example:

```text
device readings
```

Tables:

```text
device_readings_by_device_hour
device_current_reading_by_device
```

Current table:

```sql
CREATE TABLE device_current_reading_by_id (
    tenant_id uuid,
    device_id uuid,
    reading_time timestamp,
    value double,
    status text,
    PRIMARY KEY ((tenant_id, device_id))
);
```

Event table:

```sql
CREATE TABLE device_readings_by_device_hour (
    tenant_id uuid,
    device_id uuid,
    bucket_hour timestamp,
    reading_time timestamp,
    reading_id uuid,
    value double,
    status text,
    PRIMARY KEY ((tenant_id, device_id, bucket_hour), reading_time, reading_id)
);
```

Write path:

```text
append reading
update current if reading_time newer
```

Correctness issue:

```text
late old reading should not overwrite current newer reading
```

Need:

- application compare,
- LWT if strict,
- timestamp/version check,
- stream processor maintaining current.

---

## 16. Latest Table vs Query Latest from Event Table

Two approaches.

### 16.1 Query Latest from Event Table

Pros:

- fewer writes,
- source table only,
- simple if recent bucket known.

Cons:

- sparse buckets,
- bucket scanning,
- latest across hash buckets requires merge,
- p99 may vary.

### 16.2 Maintain Current/Latest Table

Pros:

- O(1) lookup,
- stable API latency,
- avoids bucket scan,
- good for dashboards.

Cons:

- extra write,
- consistency between event/current,
- late arrival handling,
- reconciliation needed.

Use current/latest table when latest read is high-QPS or strict latency.

---

## 17. TTL-Heavy Time-Series

TTL is common in time-series:

```text
keep last 7 days
keep sessions for 1 hour
keep notifications for 30 days
keep login attempts for 90 days
```

TTL creates tombstones when data expires.

Design principles:

1. Align TTL with time buckets.
2. Avoid querying expired ranges.
3. Avoid mixing TTL and non-TTL data in same table if access differs.
4. Use compaction strategy suitable for time-windowed expiration.
5. Monitor tombstone warnings.
6. Keep partitions bounded.

Bad:

```text
one partition per user forever with TTL rows across years
```

Better:

```text
user_id + bucket_day with TTL 30 days
```

After 30 days, whole day buckets age out together.

---

## 18. default_time_to_live vs Per-Write TTL

Table-level:

```sql
WITH default_time_to_live = 2592000
```

Per-write:

```sql
INSERT ... USING TTL 2592000
```

Use table-level TTL when all rows share same retention.

Use per-write TTL when expiration differs, but be careful with random TTLs causing scattered tombstones.

For compliance/audit:

```text
do not use TTL on authoritative audit table unless retention policy explicitly allows.
```

Legal hold can invalidate automatic deletion.

---

## 19. TTL and Legal Hold

Regulatory systems often have retention exceptions:

```text
case under investigation
legal hold
appeal period
audit preservation
```

If table has TTL, data may expire automatically despite hold unless design accounts for it.

Options:

- no TTL on authoritative table,
- derived/serving views TTL only,
- archive to compliant storage before expiry,
- per-case retention metadata and explicit deletion workflow,
- separate legal-hold table.

Rule:

```text
TTL is operational deletion policy encoded in schema.
Treat it as compliance-sensitive.
```

---

## 20. Time Window Compaction Preview

Time-series tables often benefit from time-window compaction strategies because data is written and expired by time windows.

Conceptually:

```text
SSTables grouped by time window
old windows compacted less
expired windows easier to purge
```

But compaction strategy must match:

- write time pattern,
- TTL,
- late arrivals,
- query pattern,
- bucket design.

If late writes frequently target old windows, time-window assumptions weaken.

Deep compaction strategy discussion is part 016, but for time-series remember:

```text
compaction and bucket design are connected.
```

---

## 21. Time Bucket and Compaction Alignment

If bucket = day and TTL = 30 days:

```text
day partitions expire in similar timeframe
```

Good.

If TTL random per row:

```text
expiration scattered
```

More tombstone complexity.

If bucket = month and TTL = 7 days:

```text
month partition contains many expired and live rows
```

Query may scan tombstones unless range constrained.

Choose bucket and TTL together.

---

## 22. Wide Time Partition Anti-Pattern

Bad:

```sql
CREATE TABLE events_by_tenant (
    tenant_id uuid,
    event_time timestamp,
    event_id uuid,
    payload text,
    PRIMARY KEY (tenant_id, event_time, event_id)
);
```

Problems:

- tenant partition unbounded,
- huge tenant hot,
- TTL tombstones accumulate,
- old range queries expensive,
- compaction/repair large,
- adding nodes does not split tenant partition.

Better:

```sql
PRIMARY KEY ((tenant_id, bucket_day, bucket_id), event_time, event_id)
```

or for lower rate:

```sql
PRIMARY KEY ((tenant_id, bucket_day), event_time, event_id)
```

---

## 23. Global Time Partition Anti-Pattern

Bad:

```sql
PRIMARY KEY (bucket_day, event_time, event_id)
```

For all events.

Problem:

```text
all writes for current day hit same partition
```

Even though bucket_day changes daily, current day becomes hot.

If querying global events by day, add hash bucket:

```sql
PRIMARY KEY ((bucket_day, bucket_id), event_time, event_id)
```

But global time queries become bucket fanout.

For very high-volume global streams, consider:

- Kafka/object storage,
- OLAP,
- partitioned event lake,
- ScyllaDB only for entity-specific lookup.

---

## 24. Multi-Dimensional Time Query

Requirement:

```text
find events by tenant, event_type, time range
```

Possible table:

```sql
PRIMARY KEY ((tenant_id, event_type, bucket_day, bucket_id), event_time, event_id)
```

Good if:

- event_type is part of access pattern,
- cardinality and heat okay,
- bucket_id controls hot type,
- query bounded by day.

But if users can filter by arbitrary dimensions:

```text
tenant, type, actor, status, region, free text
```

ScyllaDB table explosion or search system needed.

Query-first means each dimension combination must be justified.

---

## 25. Latest-N with Sparse Data

Problem:

```text
read latest 50 by case
case has events over years
bucket by month
current month has 0 events
previous month 0
...
```

Naive latest read scans many empty buckets.

Solutions:

1. Use current state table containing latest_event_version/time.
2. Maintain active bucket index.
3. Use version bucket and current version.
4. Keep latest_events_by_case small derived table.
5. Accept bounded scan only if sparse rare.

Example derived latest table:

```sql
CREATE TABLE latest_case_events_by_case (
    tenant_id uuid,
    case_id uuid,
    event_version bigint,
    event_id uuid,
    event_time timestamp,
    event_type text,
    payload text,
    PRIMARY KEY ((tenant_id, case_id), event_version, event_id)
) WITH CLUSTERING ORDER BY (event_version DESC, event_id ASC)
  AND default_time_to_live = 0;
```

But this table can grow unless capped/managed. ScyllaDB does not enforce “keep only latest 100” automatically. Application cleanup creates tombstones.

Alternative:

```text
current state stores latest pointers; latest read queries source bucket.
```

---

## 26. Downsampling and Aggregation

High-volume time-series often needs aggregates:

```text
avg per minute
count per hour
max per day
```

Do not compute by scanning raw events in online API.

Options:

- maintain aggregate table,
- stream processor,
- OLAP database,
- periodic batch,
- approximate sketch.

Aggregate table example:

```sql
CREATE TABLE device_metric_1m_by_device_day (
    tenant_id uuid,
    device_id uuid,
    bucket_day date,
    minute timestamp,
    metric_name text,
    count_value bigint,
    sum_value double,
    min_value double,
    max_value double,
    PRIMARY KEY ((tenant_id, device_id, bucket_day), metric_name, minute)
);
```

But counters/aggregates need idempotency and retry design.

For analytics-heavy workloads, ClickHouse/OLAP may be more appropriate.

---

## 27. Raw vs Aggregated Retention

Common pattern:

```text
raw data: 7 days
minute aggregate: 30 days
hour aggregate: 1 year
daily aggregate: 7 years
```

Tables:

```text
raw_events_by_entity_hour
metric_1m_by_entity_day
metric_1h_by_entity_month
metric_1d_by_entity_year
```

Each table has different:

- row size,
- bucket,
- TTL,
- compaction,
- query pattern.

Do not store all retention levels in one table.

---

## 28. Deduplication in Time-Series

Events can be retried.

Use stable event identity.

Bad:

```text
event_id generated new on each ingest attempt
```

Good:

```text
event_id from producer
command_id
sensor sequence number
external transaction id
```

Primary key includes stable identity:

```sql
PRIMARY KEY ((tenant_id, device_id, bucket_hour), reading_time, reading_id)
```

If same reading can have same reading_time but different retry, reading_id dedupes.

If strict dedupe needed globally:

```text
idempotency table by event_id
```

But high-volume LWT dedupe can be expensive.

Often dedupe is eventual/downstream unless strict.

---

## 29. Time-Series and Clock Skew

Clock skew affects:

- event_time ordering,
- bucket assignment,
- TTL if based on timestamp,
- latest current update,
- conflict resolution if custom timestamp used.

Mitigations:

- use server ingestion time for operational ordering,
- store event_time separately,
- use monotonic sequence per entity,
- validate event_time within acceptable range,
- NTP discipline,
- reject/quarantine impossible timestamps.

Regulatory audit should record:

```text
event_time
ingested_at
actor/system clock source
correlation_id
```

---

## 30. Querying Across Time Zones

Use UTC instants for storage.

For business day buckets, be explicit.

Example:

```text
bucket_day_utc
```

or:

```text
bucket_day_local_jurisdiction
```

If regulatory due date follows local jurisdiction day, bucket by that business date may be correct.

But store enough metadata:

```text
jurisdiction_timezone
business_date
event_time_utc
```

Avoid ambiguous local date-time as primary time.

Java:

```text
Instant for event_time
LocalDate for bucket_day if explicitly business date
ZoneId in business logic
```

---

## 31. Java Time Types

Recommended:

- `Instant` for absolute event/ingest time,
- `LocalDate` for day buckets,
- `YearMonth` represented as text/int carefully,
- avoid legacy `java.util.Date` if possible,
- avoid timezone-naive `LocalDateTime` for absolute events.

Bucket functions must be deterministic.

Example:

```java
LocalDate bucketDayUtc(Instant t) {
    return t.atZone(ZoneOffset.UTC).toLocalDate();
}
```

For month:

```java
String bucketMonthUtc(Instant t) {
    YearMonth ym = YearMonth.from(t.atZone(ZoneOffset.UTC));
    return ym.toString(); // 2026-06
}
```

Ensure all services use same bucket calculation.

---

## 32. Bucket Function Versioning

If bucket calculation changes, chaos can happen.

Example:

```text
old: bucket_day UTC
new: bucket_day Asia/Jakarta
```

Same event maps to different partition.

This affects:

- idempotency,
- reads,
- deletes,
- reconciliation,
- backfill.

Treat bucket function as schema contract.

If changing:

- create new table or bucket_version,
- dual-write,
- backfill,
- migrate carefully.

---

## 33. Time-Series API Design

Good API:

```http
GET /devices/{deviceId}/readings?from=2026-06-21T10:00:00Z&to=2026-06-21T11:00:00Z&limit=1000&cursor=...
```

With hard limits:

```text
max range = 1 hour online
max rows = 1000
```

Bad API:

```http
GET /events?tenantId=T&from=2020&to=2026
```

as synchronous online query.

Use async export for large ranges.

Expose query constraints to clients.

---

## 34. Time-Series Repository Design

Repository mirrors bucket.

```java
interface DeviceReadingRepository {
    CompletionStage<Void> appendReading(
        TenantId tenantId,
        DeviceId deviceId,
        Instant readingTime,
        ReadingId readingId,
        ReadingPayload payload
    );

    CompletionStage<Page<DeviceReading>> findReadingsByDeviceHour(
        TenantId tenantId,
        DeviceId deviceId,
        Instant bucketHour,
        Instant fromInclusive,
        Instant toExclusive,
        int limit,
        PageCursor cursor
    );
}
```

Service method can orchestrate multiple buckets:

```java
CompletionStage<Page<DeviceReading>> findReadingsByRange(
    TenantId tenantId,
    DeviceId deviceId,
    Instant from,
    Instant to,
    int limit,
    RangeCursor cursor
);
```

Keep repository low-level and explicit. Keep service responsible for bounded fanout.

---

## 35. Bounded Range Reader Algorithm

Algorithm:

```text
1. Validate range <= max online range.
2. Compute bucket list.
3. For each bucket, query bounded range.
4. Limit concurrency.
5. Merge/order results.
6. Stop at limit.
7. Return cursor containing bucket progress.
```

Pseudo:

```java
if (Duration.between(from, to).compareTo(MAX_ONLINE_RANGE) > 0) {
    throw new RangeTooLargeException();
}

List<Bucket> buckets = bucketPlanner.bucketsBetween(from, to);

return bucketQueryExecutor.queryBounded(
    buckets,
    maxConcurrency,
    limit,
    cursor
);
```

Do not issue unbounded parallel queries for every bucket in multi-year range.

---

## 36. Fanout Control in Java

If range crosses 168 hourly buckets, do not blindly execute 168 concurrent queries.

Use:

```text
maxConcurrency = 4 or 8
limit rows
deadline budget
retry budget
```

If limit reached early, stop.

If query is export, use batch job with throttle.

Java anti-pattern:

```java
List<CompletableFuture<?>> futures = buckets.stream()
    .map(bucket -> repo.query(bucket))
    .toList();

return CompletableFuture.allOf(...);
```

without bound.

---

## 37. Pagination Across Buckets

Cursor must carry:

- current bucket,
- clustering key position,
- direction,
- remaining buckets,
- maybe per-bucket positions if merge across buckets.

Simpler for time-ordered range:

```text
process buckets sequentially in time order
cursor = bucket + last clustering key
```

For hash-bucket merge:

```text
cursor may need per-bucket last key
```

This is a major cost of hash bucketing.

Keep bucket count small for interactive reads.

---

## 38. Time-Series and Tombstones

Tombstones appear from:

- TTL expiry,
- explicit deletes,
- overwrites,
- collection updates,
- range deletes.

Time-series with TTL can create many tombstones if query scans expired data.

Avoid:

```text
query old buckets after TTL expiry
```

Prefer:

```text
bucket expiry aligned with TTL
range validation
drop/archive old buckets by retention policy
```

For source audit data, avoid TTL unless allowed.

---

## 39. Delete by Time Range

Range delete:

```sql
DELETE FROM events_by_entity_day
WHERE entity_id = ?
  AND bucket_day = ?
  AND event_time < ?;
```

This can create range tombstones.

Use carefully.

For retention, TTL/time-windowed compaction is often better than frequent range deletes.

For explicit deletion/legal request, design dedicated workflow and understand tombstone/repair implications.

---

## 40. Late Delete and Zombie Risk

Distributed deletes require tombstones to propagate before purge.

If data has replicas and a replica missed delete, tombstone prevents old data resurrection during repair.

If tombstone purged before repair, zombie data risk exists.

Time-series retention must coordinate:

- TTL,
- gc_grace_seconds,
- repair schedule,
- compaction,
- backup/restore,
- legal deletion policy.

Deep delete/tombstone discussion is part 015, but time-series designs must anticipate it.

---

## 41. Materialized Views/Indexes for Time-Series

Avoid assuming secondary index can answer:

```text
find all events by event_type/time
```

at high scale.

Better:

```text
events_by_entity_time
events_by_type_day_bucket
events_by_actor_day_bucket
```

as explicit derived tables if access pattern is important.

But every derived table adds:

- write amplification,
- storage,
- consistency/reconciliation,
- retention,
- tombstones.

Use external search/OLAP for broad exploration.

---

## 42. Multi-Tenant Time-Series

Common table:

```sql
CREATE TABLE tenant_events_by_hour_bucket (
    tenant_id uuid,
    bucket_hour timestamp,
    bucket_id int,
    event_time timestamp,
    event_id uuid,
    event_type text,
    payload text,
    PRIMARY KEY ((tenant_id, bucket_hour, bucket_id), event_time, event_id)
);
```

This supports:

```text
events by tenant/hour
```

But for largest tenants, bucket_count may be high.

For small tenants, high bucket count hurts reads.

Options:

- fixed moderate bucket count,
- adaptive tenant bucket count,
- separate table for mega tenants,
- route mega tenant to dedicated cluster/keyspace,
- split product/API,
- aggregate top-N separately.

---

## 43. Multi-Region Time-Series

Questions:

```text
Where are events written?
Can same entity receive events in multiple regions?
Is event order global or regional?
What is conflict behavior?
What CL?
What bucket timezone?
```

If active-active ingestion:

- event_id must be globally unique,
- event_time clocks may differ,
- ordering by timestamp can be misleading,
- duplicate detection more complex.

For strict entity lifecycle, prefer single writer/home region per entity.

For telemetry, active-active append may be acceptable if dedupe/order tolerance exists.

---

## 44. Time-Series Load Testing

Load test must include:

- realistic key distribution,
- hot entities/tenants,
- row size,
- bucket calculation,
- late arrivals,
- TTL expiry if relevant,
- read latest-N,
- read range across buckets,
- compaction active,
- dataset beyond cache,
- p99/p999,
- Java fanout behavior,
- retry behavior.

Do not benchmark only:

```text
uniform random device_id, no TTL, small row, write-only
```

unless production is actually that.

---

## 45. Observability for Time-Series Tables

Metrics/questions:

```text
[ ] writes/sec per table
[ ] reads/sec per query shape
[ ] p99 latest-N read
[ ] p99 range read
[ ] rows returned per query
[ ] buckets queried per request
[ ] fanout concurrency
[ ] hottest entity/tenant/user/device
[ ] partition size distribution
[ ] tombstone warnings
[ ] TTL expiry rate
[ ] compaction backlog
[ ] disk growth by table
[ ] late arrival rate
[ ] out-of-order rate
[ ] dedupe collision/duplicate rate
[ ] current snapshot lag
```

Application metrics should include bucket/fanout info, not only endpoint latency.

---

## 46. Failure Modes

### 46.1 Hot Current Bucket

Current day/hour bucket receives almost all writes.

Mitigation:

- hash bucket,
- smaller time bucket,
- rate limit,
- separate ingestion path,
- stream buffer.

### 46.2 Sparse Latest Scan

Latest query scans too many empty buckets.

Mitigation:

- active bucket index,
- current/latest pointer,
- latest derived table.

### 46.3 Tombstone Storm

TTL expires huge volume and reads scan expired rows.

Mitigation:

- align bucket/TTL/compaction,
- avoid old bucket reads,
- tune compaction,
- reduce TTL randomness.

### 46.4 Late Arrival Flood

Backfill writes old buckets heavily.

Mitigation:

- throttle backfill,
- separate ingest path,
- monitor compaction,
- maybe write by ingest time and project later.

### 46.5 Hash Bucket Fanout p99

Too many bucket queries.

Mitigation:

- reduce online query scope,
- precompute top-N,
- use version bucket,
- split read model.

### 46.6 Current Snapshot Regressed by Old Event

Late event overwrites current state.

Mitigation:

- compare event_time/version,
- LWT/expected version,
- monotonic sequence,
- ignore/quarantine old event for current.

---

## 47. Example: Notifications by User

Requirement:

```text
write notifications
read latest 50
expire after 30 days
some users high-volume
```

Schema:

```sql
CREATE TABLE notifications_by_user_day (
    tenant_id uuid,
    user_id uuid,
    bucket_day date,
    notification_time timestamp,
    notification_id uuid,
    notification_type text,
    title text,
    body text,
    read_at timestamp,
    PRIMARY KEY ((tenant_id, user_id, bucket_day), notification_time, notification_id)
) WITH CLUSTERING ORDER BY (notification_time DESC, notification_id ASC)
  AND default_time_to_live = 2592000;
```

If high-volume user:

```sql
PRIMARY KEY ((tenant_id, user_id, bucket_day, bucket_id), notification_time, notification_id)
```

But latest read fanout increases.

Alternative:

- digest notifications,
- cap per user,
- latest top-N table,
- separate read status table.

Read status update caution:

```text
updating read_at in same notification row creates write churn
```

Maybe separate:

```text
notification_read_state_by_user
```

depending workload.

---

## 48. Example: Case Lifecycle Events

Requirement:

```text
immutable audit event
strict lifecycle order
read latest 100
export complete history
no TTL
```

Use version bucket:

```sql
CREATE TABLE case_events_by_case_version_bucket (
    tenant_id uuid,
    case_id uuid,
    version_bucket bigint,
    event_version bigint,
    event_id uuid,
    event_time timestamp,
    event_type text,
    actor_id uuid,
    command_id uuid,
    payload text,
    PRIMARY KEY ((tenant_id, case_id, version_bucket), event_version, event_id)
) WITH CLUSTERING ORDER BY (event_version DESC, event_id ASC);
```

Current state:

```sql
CREATE TABLE case_current_by_id (
    tenant_id uuid,
    case_id uuid,
    status text,
    version bigint,
    current_version_bucket bigint,
    updated_at timestamp,
    PRIMARY KEY ((tenant_id, case_id))
);
```

Latest read:

```text
read current state -> current_version_bucket
query current bucket LIMIT 100
if fewer, previous bucket
```

Export:

```text
iterate version_bucket from 0..current
use ASC or reverse depending table/order
```

If export needs ASC and latest needs DESC, evaluate table order or separate export path.

---

## 49. Example: Device Telemetry

Requirement:

```text
100 readings/sec/device
read last 15 minutes
retain raw 7 days
aggregate for 1 year
```

Raw schema:

```sql
CREATE TABLE device_readings_by_device_minute (
    tenant_id uuid,
    device_id uuid,
    bucket_minute timestamp,
    reading_time timestamp,
    reading_id uuid,
    value double,
    quality text,
    PRIMARY KEY ((tenant_id, device_id, bucket_minute), reading_time, reading_id)
) WITH CLUSTERING ORDER BY (reading_time ASC, reading_id ASC)
  AND default_time_to_live = 604800;
```

Rows per minute:

```text
100 * 60 = 6000 rows
```

Read last 15 minutes:

```text
15 partitions
```

May be okay if bounded.

If many devices queried together, do not fanout across thousands in online API. Use aggregate/OLAP.

Aggregate table:

```text
device_metric_1m_by_device_day
```

or external analytics.

---

## 50. Example: Login Attempts

Requirement:

```text
store login attempts by user and IP
read recent failed attempts by user
expire after 90 days
```

By user:

```sql
CREATE TABLE login_attempts_by_user_day (
    tenant_id uuid,
    user_id uuid,
    bucket_day date,
    attempt_time timestamp,
    attempt_id uuid,
    ip inet,
    success boolean,
    reason text,
    PRIMARY KEY ((tenant_id, user_id, bucket_day), attempt_time, attempt_id)
) WITH CLUSTERING ORDER BY (attempt_time DESC, attempt_id ASC)
  AND default_time_to_live = 7776000;
```

By IP if needed:

```sql
CREATE TABLE login_attempts_by_ip_day (
    tenant_id uuid,
    ip inet,
    bucket_day date,
    attempt_time timestamp,
    attempt_id uuid,
    user_id uuid,
    success boolean,
    reason text,
    PRIMARY KEY ((tenant_id, ip, bucket_day), attempt_time, attempt_id)
) WITH CLUSTERING ORDER BY (attempt_time DESC, attempt_id ASC)
  AND default_time_to_live = 7776000;
```

Each access pattern has own table.

IP hotness risk:

```text
NAT/proxy/shared IP can be hot
```

Maybe add bucket_id if needed.

---

## 51. Design Checklist

For each time-series table:

```text
[ ] Is primary query by entity + time?
[ ] Is bucket based on event time, write time, or version?
[ ] Is bucket granularity justified by rows/bytes/QPS?
[ ] Is clustering order aligned with latest/range query?
[ ] Is tie-breaker present?
[ ] Are late arrivals possible?
[ ] Is lateness policy defined?
[ ] Is TTL used?
[ ] Is TTL compliant with retention/legal hold?
[ ] Is compaction strategy aligned?
[ ] Is hash bucket needed for hot entities?
[ ] Is read fanout bounded?
[ ] Is cursor design feasible?
[ ] Is latest/current table needed?
[ ] Are aggregates required?
[ ] Are broad analytics/search offloaded?
[ ] Are Java time/bucket functions deterministic?
[ ] Are bucket function changes versioned?
[ ] Are tombstones monitored?
[ ] Is backfill throttled?
```

---

## 52. Common Misconceptions

### Misconception 1: “Time-series means partition by timestamp.”

No. Usually partition by entity + time bucket. Timestamp alone can create hot global partitions.

### Misconception 2: “Day bucket is always good.”

No. Depends on write rate and read window.

### Misconception 3: “TTL solves retention for free.”

No. TTL creates tombstones and compliance implications.

### Misconception 4: “Latest query can just scan buckets backward forever.”

No. Online scans must be bounded. Use active bucket/current pointer if sparse.

### Misconception 5: “Event time and write time are the same.”

Often false. Late arrivals/backfills matter.

### Misconception 6: “Timestamp order is business order.”

Not for state machines or regulatory audit. Use version/sequence if needed.

### Misconception 7: “Hash bucket only affects writes.”

It also affects reads, cursors, deletes, reconciliation, idempotency.

### Misconception 8: “ScyllaDB time-series replaces OLAP.”

ScyllaDB is good for partitioned OLTP time access, not arbitrary analytical scans.

---

## 53. Mental Model Compression

Time-series ScyllaDB design is about aligning:

```text
entity locality
+
time/version bucket
+
bounded partition size
+
clustering order
+
retention/TTL
+
read fanout
+
late-arrival policy
```

A healthy time-series table answers:

```text
Which entity?
Which bucket?
Which time/version range?
How many rows?
What happens when data is late or expired?
```

---

## 54. Summary

Time-series modeling is a natural fit for ScyllaDB when designed explicitly.

Key lessons:

1. Time-series workloads vary: telemetry, audit, feed, event logs.
2. Most designs use entity + time/version bucket as partition key.
3. Bucket by event time, write time, or version deliberately.
4. Clustering order should match latest/range/replay needs.
5. Always include tie-breaker.
6. Bucket size is chosen by rows, bytes, QPS, and read window.
7. Latest-N across buckets must be bounded.
8. Sparse latest reads may need active bucket index/current pointer.
9. Late arrivals require explicit policy.
10. Audit order often needs version, not timestamp.
11. TTL-heavy tables need bucket/compaction alignment.
12. Legal hold and TTL can conflict.
13. Hash bucket spreads heat but increases fanout/cursor complexity.
14. Current/latest table may be needed for high-QPS latest lookup.
15. Aggregations should be precomputed or moved to OLAP/stream systems.
16. Java bucket functions must be deterministic and versioned.
17. Time-series APIs must enforce range/limit constraints.
18. Observability must include bucket/fanout/hot entity/tombstone metrics.

---

## 55. Review Questions

1. Apa beda event time dan write time?
2. Kapan bucket by event time lebih baik?
3. Kapan bucket by write time lebih baik?
4. Kapan version bucket lebih baik dari time bucket?
5. Kenapa timestamp saja tidak cukup sebagai clustering key?
6. Bagaimana memilih bucket granularity?
7. Apa risiko day bucket untuk high-volume device?
8. Bagaimana latest-N dibaca dari bucketed table?
9. Apa masalah sparse latest query?
10. Apa itu active bucket index?
11. Bagaimana late arrivals memengaruhi compaction dan query?
12. Kenapa audit lifecycle sebaiknya memakai event_version?
13. Apa risiko TTL-heavy workload?
14. Bagaimana TTL berkonflik dengan legal hold?
15. Kenapa timestamp partition key global buruk?
16. Apa trade-off hash bucket pada time-series?
17. Bagaimana cursor berubah jika bucketed by hash?
18. Kapan current/latest table dibutuhkan?
19. Kapan aggregate table atau OLAP dibutuhkan?
20. Apa metrik penting untuk time-series table?

---

## 56. Practical Exercise

Design tiga time-series workloads:

### A. Case Audit Events

```text
- strict lifecycle order
- no TTL
- read latest 100
- export full history
- huge cases possible
```

Tentukan:

```text
time bucket or version bucket
primary key
clustering order
current pointer
export strategy
late event policy
```

### B. Device Telemetry

```text
- 200 readings/sec/device
- read last 10 minutes
- retain raw 7 days
- aggregate hourly for 1 year
```

Tentukan:

```text
bucket granularity
raw table
aggregate table
TTL
range API limit
fanout
```

### C. User Notifications

```text
- read latest 50
- expire after 30 days
- some users high-volume
- mark as read
```

Tentukan:

```text
bucket day/hour
hash bucket or not
read status model
TTL impact
latest query algorithm
hot user mitigation
```

---

## 57. Preview Part 012

Part berikutnya membahas multi-access-pattern design:

```text
duplicate tables
fanout writes
derived views
application-maintained indexes
source-of-truth vs read model
sync vs async projection
idempotent denormalization
backfill and reconciliation
```

Part 011 fokus pada time-series/timeline.

Part 012 akan memperluas ke desain banyak access pattern dalam satu domain tanpa mengandalkan SQL join/index.

---

# End of Part 011


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-010.md">⬅️ Part 010 — Partition Sizing, Cardinality, Hot Partition, dan Bucketing</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-012.md">Part 012 — Multi-Access-Pattern Design: Duplicate Tables, Fanout, dan Derived Views ➡️</a>
</div>
