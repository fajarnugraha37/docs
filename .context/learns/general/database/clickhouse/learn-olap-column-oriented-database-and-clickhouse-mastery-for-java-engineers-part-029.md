# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-029.md

# Part 029 — Production Ingestion Pipelines: Kafka, CDC, Backfills, Validation, and Reconciliation

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **029 / 034**  
> Fokus: membangun ingestion pipeline ClickHouse yang production-grade: Kafka, CDC, object storage, batch backfill, idempotency, validation, reconciliation, DLQ, replay, schema evolution, and operational runbooks.

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 028 kita sudah membahas:

- data modeling;
- table engines;
- materialized views;
- distributed ClickHouse;
- performance engineering;
- Java integration;
- Spring Boot analytics service;
- query builder;
- async export.

Sekarang kita fokus ke sisi yang menentukan apakah data di ClickHouse bisa dipercaya:

> ingestion pipeline.

Banyak sistem ClickHouse gagal bukan karena query-nya, tetapi karena data pipeline-nya:

- event duplicate;
- event hilang;
- retry tidak idempotent;
- Kafka offset sudah di-commit sebelum insert benar-benar aman;
- CDC delete tidak dimodelkan;
- late events merusak rollup;
- backfill double count;
- materialized view target duplicate;
- schema evolution tidak kompatibel;
- DLQ tidak ada;
- validation lemah;
- reconciliation tidak pernah dilakukan;
- dashboards tidak punya watermark.

Di OLAP, query cepat tanpa data benar itu tidak berguna.

Part ini membahas ingestion sebagai sistem produksi, bukan sekadar `INSERT INTO`.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. mendesain ingestion architecture untuk ClickHouse dari Kafka, CDC, object storage, and Java services;
2. memahami pilihan direct insert, Kafka engine, Java consumer, ClickPipes/managed connector, and batch load;
3. menerapkan idempotent ingestion dengan event_id, batch_id, source offset, and dedup strategy;
4. membedakan raw, staging, refined, serving, and reconciliation tables;
5. menangani late events, duplicate events, out-of-order data, and poison messages;
6. mendesain DLQ dan replay;
7. mendesain CDC raw table, current snapshot table, tombstones, and version ordering;
8. melakukan backfill secara aman tanpa double count;
9. membangun validation and reconciliation queries;
10. mengelola schema evolution;
11. memonitor ingestion lag, batch health, ClickHouse insert errors, and part count;
12. membuat runbook untuk pipeline stuck, duplicate, missing data, and bad backfill.

---

## 2. Mental Model Utama: Ingestion Pipeline adalah Contract, Bukan Plumbing

Ingestion bukan hanya transport data.

Ingestion adalah kontrak antara:

```text
source system
→ event identity
→ schema
→ ordering
→ delivery guarantee
→ validation
→ transformation
→ ClickHouse table semantics
→ query correctness
```

Jika kontrak ini tidak jelas, masalah akan muncul di dashboard:

```text
angka berubah-ubah
data hilang
count double
report tidak reproducible
dashboard stale
rollup salah
```

A production ingestion pipeline harus menjawab:

1. Apa sumber kebenaran?
2. Apa identitas event/fact?
3. Apakah delivery at-least-once, at-most-once, or effectively-once?
4. Bagaimana retry dilakukan?
5. Kapan offset/source progress dianggap aman?
6. Bagaimana duplicate dideteksi?
7. Bagaimana event invalid ditangani?
8. Bagaimana schema berubah?
9. Bagaimana late event masuk ke rollup?
10. Bagaimana data direkonsiliasi?

---

## 3. Ingestion Source Types

### 3.1 Application Events

Source:

```text
Java/Spring services emit domain events
```

Examples:

- case opened;
- payment authorized;
- user signed up;
- feature used;
- API request completed.

Usually through:

- Kafka;
- outbox;
- HTTP ingestion API;
- batch file.

### 3.2 CDC

Source:

```text
database change stream
```

Examples:

- PostgreSQL WAL;
- MySQL binlog;
- Debezium;
- transactional outbox table;
- managed CDC connector.

CDC contains:

- INSERT;
- UPDATE;
- DELETE;
- transaction ordering;
- source offset/LSN.

### 3.3 Logs/Observability

Source:

- OpenTelemetry collector;
- Fluent Bit;
- Vector;
- Kafka;
- log agent;
- file/object storage.

### 3.4 Object Storage Batch

Source:

- Parquet files in S3/GCS/Azure Blob;
- CSV exports;
- archived raw events;
- data lake tables;
- daily extracts.

### 3.5 Direct API Inserts

Source:

- backend service writes directly to ClickHouse;
- scheduled job;
- internal batch processor.

Good for controlled volume. Risky if every request inserts row-by-row.

---

## 4. Ingestion Architecture Options

### 4.1 Direct Java Insert

```text
Java service → ClickHouse
```

Good for:

- simple controlled pipeline;
- internal service;
- moderate volume;
- low transformation complexity.

Risks:

- row-by-row insert;
- retry duplicate;
- app latency coupled to ClickHouse;
- no buffer during outage unless implemented;
- source event loss if not durable.

Use only with batching, idempotency, and backpressure.

### 4.2 Kafka + Java Consumer + ClickHouse

```text
Source services
→ Kafka
→ Java ingestion consumer
→ ClickHouse batch insert
```

Good for:

- durable buffer;
- replay;
- transformation;
- validation;
- DLQ;
- controlled batching;
- backpressure via consumer pause.

Risks:

- consumer complexity;
- offset commit correctness;
- duplicate/retry design;
- schema evolution;
- operations.

This is often the best pattern for Java teams that need control.

### 4.3 Kafka Engine + Materialized View

```text
Kafka topic
→ ClickHouse Kafka engine table
→ Materialized View
→ MergeTree target
```

Good for:

- simpler direct topic-to-table ingestion;
- limited transformation;
- ClickHouse-owned consumption.

Risks:

- poison message handling;
- schema evolution;
- offset/retry semantics;
- complex business validation harder;
- operational debugging different.

### 4.4 Managed Connector / ClickPipes

```text
Source/Kafka/object storage
→ managed ingestion
→ ClickHouse
```

Good for:

- managed operations;
- faster setup;
- less code;
- common source integrations.

Risks:

- provider-specific behavior;
- less transformation control;
- cost;
- debugging opacity;
- governance review.

### 4.5 Object Storage Batch Load

```text
S3/Parquet
→ INSERT INTO ClickHouse SELECT FROM s3(...)
```

Good for:

- backfill;
- historical load;
- daily batch;
- lake integration.

Risks:

- small files;
- schema drift;
- duplicate loads;
- partial backfill;
- validation needed.

### 4.6 Hybrid

Production systems often combine:

```text
Kafka stream for recent events
Object storage archive for replay/backfill
ClickHouse serving tables for queries
```

This is powerful because source data is replayable.

---

## 5. Recommended Reference Architecture

For many Java teams:

```text
OLTP / domain services
→ transactional outbox or event publisher
→ Kafka
→ Java ingestion service
→ raw_events MergeTree
→ materialized views / batch jobs
→ refined tables / rollups / snapshots
→ analytics API
```

Also:

```text
Kafka topic / raw files
→ object storage archive
→ backfill/replay source
```

Key tables:

```text
raw_events
ingestion_batches
dead_letter_events
ingestion_watermarks
reconciliation_results
refined_events
rollup_tables
current_state_tables
report_snapshots
```

This separates:

- raw evidence;
- operational metadata;
- refined query model;
- serving performance;
- report correctness.

---

## 6. Raw, Staging, Refined, Serving

### 6.1 Raw Table

Purpose:

- preserve source data;
- replay/debug;
- audit lineage.

Characteristics:

- append-only;
- minimal transformation;
- stable event ID;
- raw payload optional;
- source offset stored.

### 6.2 Staging Table

Purpose:

- temporary load area;
- batch validation;
- schema normalization;
- shadow load.

Characteristics:

- short retention;
- may be dropped/reloaded;
- not queried by product.

### 6.3 Refined Table

Purpose:

- cleaned, typed, normalized events/facts.

Characteristics:

- hot fields promoted;
- invalid records excluded or corrected;
- queryable but not always optimized for dashboards.

### 6.4 Serving Table

Purpose:

- fast dashboard/API/report query.

Examples:

- rollups;
- current state;
- snapshots;
- top-N tables.

### 6.5 Why This Layering Helps

If bug appears:

- raw can replay;
- refined can rebuild;
- serving can regenerate;
- reports can version/amend.

Without layers, correction becomes dangerous.

---

## 7. Event Identity and Idempotency

### 7.1 Event ID

Every event needs stable identity.

Good event_id:

```text
stable across retry
unique per source business event
deterministic if source lacks ID
tenant-scoped if necessary
```

Bad event_id:

```java
UUID.randomUUID()
```

generated inside retry loop.

### 7.2 Batch ID

Batch identity tracks ingestion unit.

Kafka batch:

```text
topic + partition + offset_start + offset_end
```

File batch:

```text
path + checksum + row range
```

API batch:

```text
producer + payload hash + sequence
```

### 7.3 Source Offset

Store:

- Kafka topic;
- partition;
- offset;
- Debezium source offset;
- WAL LSN;
- binlog file/position;
- file path;
- row number.

### 7.4 Ingestion Metadata Columns

```sql
source_system LowCardinality(String),
source_topic String,
source_partition UInt32,
source_offset UInt64,
ingest_batch_id String,
ingest_time DateTime64(3),
schema_version UInt16
```

### 7.5 Idempotency Rule

Retry should insert same event identity.

Then duplicates can be handled by:

- insert dedup token;
- `ReplacingMergeTree`;
- query-level dedup;
- refined dedup process;
- partition reload.

---

## 8. Kafka Consumer Offset Commit Semantics

### 8.1 Bad Pattern

```text
consume message
commit offset
insert into ClickHouse
```

If insert fails after commit, data lost.

### 8.2 Better Pattern

```text
consume batch
validate
insert batch into ClickHouse
verify/ack insert
commit offsets
```

### 8.3 Timeout Ambiguity

If insert times out, not clear if it succeeded.

Therefore:

- retry idempotently;
- use stable event_id/batch_id;
- optionally check ingestion_batches;
- commit only after safe outcome.

### 8.4 Batch Offset Metadata

For each batch:

```sql
CREATE TABLE ingestion_batches
(
    batch_id String,
    source LowCardinality(String),
    topic String,
    partition UInt32,
    offset_start UInt64,
    offset_end UInt64,
    row_count UInt64,
    status LowCardinality(String),
    started_at DateTime64(3),
    completed_at Nullable(DateTime64(3)),
    error String
)
ENGINE = MergeTree
ORDER BY (source, topic, partition, offset_start);
```

### 8.5 Commit Strategy

Commit Kafka offset after:

- batch persisted safely;
- failure handled into DLQ if invalid;
- batch metadata updated.

Do not commit before durable handling.

---

## 9. Java Kafka Consumer Architecture

### 9.1 Pipeline

```text
poll records
→ group into batch
→ validate schema
→ transform to ClickHouse rows
→ insert batch
→ update batch metadata/watermark
→ commit offsets
```

### 9.2 Consumer Loop Pseudocode

```java
while (running) {
    ConsumerRecords<K, V> records = consumer.poll(Duration.ofMillis(500));

    List<EventRow> rows = validatorAndMapper.map(records);

    BatchMetadata batch = BatchMetadata.from(records);

    try {
        batchRepository.markStarted(batch);
        clickHouseWriter.insert(rows, batch);
        watermarkService.update(rows, batch);
        batchRepository.markCompleted(batch);
        consumer.commitSync();
    } catch (ValidationException e) {
        dlqWriter.write(records, e);
        batchRepository.markFailed(batch, e);
        consumer.commitSync(); // only if invalid records safely captured
    } catch (TransientClickHouseException e) {
        retryOrPause(e);
        // do not commit offsets until safe
    }
}
```

### 9.3 Backpressure

If ClickHouse slow:

- pause Kafka partitions;
- reduce poll;
- lower concurrency;
- buffer bounded;
- do not accumulate infinite heap.

### 9.4 Consumer Parallelism

Parallelism dimensions:

- Kafka partitions;
- consumer instances;
- ClickHouse insert concurrency;
- shard routing.

Avoid too much insert concurrency producing small parts.

---

## 10. Validation

### 10.1 Validation Layers

1. Transport-level: valid JSON/Avro/Protobuf.
2. Schema-level: required fields.
3. Type-level: parseable timestamp/UUID/Decimal.
4. Business-level: valid event_type/status.
5. Referential-ish: known tenant/source.
6. Ingestion-level: event_id/batch_id present.
7. Range-level: event_time not absurd.

### 10.2 Validation Failures

Examples:

- missing event_id;
- invalid event_time;
- schema_version unsupported;
- status unknown;
- tenant missing;
- payload too large;
- impossible timestamp;
- invalid decimal.

### 10.3 DLQ Decision

Invalid data should not block whole pipeline forever.

Options:

- reject individual record to DLQ;
- reject whole batch to DLQ;
- quarantine tenant/source;
- use default/UNKNOWN for non-critical field;
- alert.

### 10.4 Validation Table

```sql
CREATE TABLE ingestion_validation_errors
(
    error_time DateTime64(3),
    source LowCardinality(String),
    batch_id String,
    event_id String,
    error_code LowCardinality(String),
    error_message String,
    raw_payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(error_time)
ORDER BY (source, error_time, error_code);
```

---

## 11. Dead Letter Queue

### 11.1 Purpose

DLQ stores records that cannot be processed safely.

DLQ must preserve enough information to:

- inspect;
- fix;
- replay;
- audit;
- measure failure.

### 11.2 DLQ Record

Fields:

```text
source
topic/partition/offset
event_id
batch_id
schema_version
error_code
error_message
raw_payload
first_seen_at
last_seen_at
retry_count
status
```

### 11.3 Where To Store DLQ

Options:

- Kafka DLQ topic;
- object storage;
- OLTP table;
- ClickHouse table for analytics over failures;
- combination.

For replay, Kafka/object storage is often better than ClickHouse alone.

### 11.4 DLQ Workflow

```text
invalid record → DLQ
alert if threshold
engineer fixes schema/producer/mapper
replay DLQ records
mark resolved
```

### 11.5 Anti-Pattern

DLQ exists but nobody monitors or reprocesses it.

---

## 12. Schema Evolution

### 12.1 Versioned Event Schema

Every event has:

```text
schema_version
```

Consumer supports versions.

### 12.2 Additive Change

Example:

```text
add field device_type
```

Safe path:

1. Add ClickHouse column with DEFAULT.
2. Deploy consumer that handles field optional.
3. Deploy producer emitting field.
4. Backfill if needed.
5. Update analytics query.

### 12.3 Breaking Change

Example:

```text
rename severity to risk_level
```

Options:

- support both fields;
- create new schema version;
- map old to new in consumer;
- dual-write columns temporarily;
- backfill/refine.

### 12.4 Schema Registry

Use schema registry for Avro/Protobuf/JSON Schema if possible.

### 12.5 Compatibility Rules

Prefer backward/forward compatibility:

- adding optional fields;
- not removing required fields abruptly;
- not changing type incompatibly;
- maintaining enum compatibility.

### 12.6 ClickHouse DDL Timing

Do not deploy producer/consumer writing new column before DDL is applied across cluster.

---

## 13. CDC Ingestion

### 13.1 CDC Raw Table

```sql
CREATE TABLE cdc_raw
(
    source_system LowCardinality(String),
    source_table LowCardinality(String),
    op LowCardinality(String),

    primary_key String,

    commit_time DateTime64(3),
    source_lsn String,
    source_tx_id String,
    source_sequence UInt64,

    before_payload String,
    after_payload String,

    ingest_time DateTime64(3),
    ingest_batch_id String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(commit_time)
ORDER BY (source_table, commit_time, primary_key, source_sequence);
```

### 13.2 Current Snapshot from CDC

```sql
CREATE TABLE user_current
(
    user_id UInt64,
    country LowCardinality(String),
    plan LowCardinality(String),
    deleted UInt8,
    commit_time DateTime64(3),
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
ORDER BY user_id;
```

### 13.3 Version Ordering

Version should reflect source order, not ingest order.

Good:

- LSN;
- binlog position;
- commit timestamp + sequence;
- transaction order.

Bad:

- `now()` at ingestion;
- consumer local counter not persisted.

### 13.4 Deletes

CDC delete should become tombstone:

```text
deleted = 1
```

not silently ignored.

### 13.5 CDC Anti-Patterns

- treating CDC update as ClickHouse `ALTER UPDATE`;
- ignoring delete events;
- using ingest_time as version;
- not storing raw CDC;
- no way to rebuild current snapshot.

---

## 14. Object Storage Backfill

### 14.1 Use Case

Load historical data:

```text
S3 Parquet files → ClickHouse
```

### 14.2 Backfill Manifest

Use manifest file/table:

```text
file_uri
partition
row_count
checksum
min_event_time
max_event_time
schema_version
status
```

### 14.3 Manifest Table

```sql
CREATE TABLE backfill_manifest
(
    backfill_id String,
    file_uri String,
    partition_id String,
    row_count UInt64,
    checksum String,
    min_event_time DateTime64(3),
    max_event_time DateTime64(3),
    status LowCardinality(String),
    started_at Nullable(DateTime64(3)),
    completed_at Nullable(DateTime64(3)),
    error String
)
ENGINE = MergeTree
ORDER BY (backfill_id, partition_id, file_uri);
```

### 14.4 Load Pattern

```text
create shadow table
load files
validate counts/checksums
swap or insert into target
rebuild rollups
mark manifest complete
```

### 14.5 Simple Load Example

```sql
INSERT INTO events
SELECT *
FROM s3(
    'https://bucket/path/2026/06/*.parquet',
    'Parquet'
);
```

But production backfill needs tracking/validation.

### 14.6 Backfill Idempotency

Avoid:

```text
run same INSERT twice
```

unless target dedup handles it.

Safer:

- drop partition then reload;
- load into shadow table;
- use batch_id;
- use ReplacingMergeTree;
- validate before commit.

---

## 15. Backfill Strategies

### 15.1 Drop Partition and Reload

Best when:

- partition aligns with backfill range;
- source data complete;
- downtime/consistency acceptable.

```sql
ALTER TABLE events DROP PARTITION 202606;

INSERT INTO events
SELECT ...
WHERE event_time >= '2026-06-01'
  AND event_time < '2026-07-01';
```

### 15.2 Shadow Table

```text
events_shadow
load
validate
swap/rename or insert into final
```

Good for high confidence.

### 15.3 Batch ID Delete/Reload

If data tagged:

```sql
ALTER TABLE events DELETE WHERE ingest_batch_id = 'bf-202606-v1';
```

Then reload.

Use carefully; mutation cost matters.

### 15.4 ReplacingMergeTree Version

Load corrected rows with higher version.

Good for dedup/current semantics.

### 15.5 Rebuild Serving Tables

After raw backfill:

```text
drop rollup partition
recompute from raw
validate
```

Do not assume materialized view will automatically backfill historical target unless designed.

---

## 16. Late Events

### 16.1 Definition

Event arrives after its event_time window.

```text
event_time = 2026-05-10
ingest_time = 2026-06-21
```

### 16.2 Impact

Late events can affect:

- raw queries;
- rollups;
- snapshots;
- official reports;
- freshness watermarks.

### 16.3 Strategies

#### Recompute Window

Keep last N days mutable:

```text
rebuild last 7 days rollups periodically
```

#### Watermark

Only finalize report after lateness threshold:

```text
daily report final at T+3 days
```

#### Correction Ledger

Official report amended by correction records.

#### Aggregate State MVs

If MV target uses mergeable states and receives late event, it can update correct bucket eventually.

Need validation.

### 16.4 API Metadata

Expose:

```text
data complete through event_time X
```

not just ingest_time.

---

## 17. Materialized Views in Ingestion Pipelines

### 17.1 MV as Insert-Time Transform

```text
insert raw block
→ MV query executes
→ target table receives transformed rows
```

### 17.2 Good Use

- parse raw to refined;
- compute rollup;
- route to multiple tables;
- normalize fields.

### 17.3 Caveats

- if raw row later deleted, target not automatically undone;
- if MV fails, ingestion may fail depending setup;
- backfill may duplicate target;
- schema changes affect MV;
- heavy MV increases insert cost.

### 17.4 Recommended Pattern

Use explicit target tables.

```sql
CREATE MATERIALIZED VIEW mv_events_to_daily_rollup
TO daily_rollup
AS SELECT ...
```

Avoid relying on hidden target unless you intentionally choose it.

### 17.5 Backfill with MV

Options:

1. Insert historical data into source table while MV active.
2. Directly insert into target table from historical query.
3. Recreate MV after backfill.
4. Use shadow target and swap.

Choose deliberately.

---

## 18. Reconciliation

### 18.1 Why Needed

Even with good design, ingestion can fail.

Reconciliation detects:

- missing data;
- duplicate data;
- count mismatch;
- late lag;
- bad batch;
- rollup mismatch;
- CDC snapshot drift.

### 18.2 Source vs ClickHouse Counts

Example Kafka/source batch count:

```text
expected rows per topic/partition/time
```

ClickHouse:

```sql
SELECT
    toDate(event_time) AS day,
    count() AS rows,
    uniq(event_id) AS unique_events
FROM raw_events
WHERE event_time >= today() - 7
GROUP BY day;
```

### 18.3 Batch Reconciliation

```sql
SELECT
    ingest_batch_id,
    count() AS rows,
    min(event_time),
    max(event_time)
FROM raw_events
GROUP BY ingest_batch_id
ORDER BY ingest_batch_id DESC
LIMIT 100;
```

Compare with `ingestion_batches.row_count`.

### 18.4 Duplicate Detection

```sql
SELECT
    tenant_id,
    event_id,
    count() AS c
FROM raw_events
GROUP BY
    tenant_id,
    event_id
HAVING c > 1
ORDER BY c DESC
LIMIT 100;
```

### 18.5 Rollup vs Raw

```sql
WITH raw AS
(
    SELECT
        toDate(event_time) AS day,
        count() AS opened
    FROM case_lifecycle_events
    WHERE event_type = 'CASE_OPENED'
      AND tenant_id = 10
    GROUP BY day
),
roll AS
(
    SELECT
        day,
        sum(opened_count) AS opened
    FROM daily_case_lifecycle_rollup
    WHERE tenant_id = 10
    GROUP BY day
)
SELECT
    raw.day,
    raw.opened AS raw_opened,
    roll.opened AS rollup_opened,
    raw.opened - roll.opened AS diff
FROM raw
FULL OUTER JOIN roll USING day
ORDER BY day;
```

### 18.6 CDC Snapshot Reconciliation

Compare OLTP current count by status with ClickHouse current snapshot.

Run periodically.

---

## 19. Ingestion Watermarks

### 19.1 What Is Watermark?

Watermark indicates data completeness/freshness.

Examples:

```text
max event_time ingested
max source offset processed
max commit_time processed
max batch completed
```

### 19.2 Watermark Table

```sql
CREATE TABLE ingestion_watermarks
(
    pipeline LowCardinality(String),
    source LowCardinality(String),
    tenant_id UInt64,
    source_partition String,
    max_source_offset UInt64,
    max_event_time DateTime64(3),
    max_ingest_time DateTime64(3),
    updated_at DateTime64(3),
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
ORDER BY (pipeline, source, tenant_id, source_partition);
```

### 19.3 Use

- API freshness;
- alerting;
- report finalization;
- reconciliation;
- cache key;
- backfill progress.

### 19.4 Watermark Caution

Max event time alone can be misleading if events arrive out-of-order.

Keep source offsets and lateness metrics too.

---

## 20. Monitoring and Alerts

### 20.1 Pipeline Metrics

Track:

- source lag;
- consumer lag;
- batch size;
- insert duration;
- insert error rate;
- retries;
- DLQ count;
- validation error count;
- watermark delay;
- ClickHouse part count;
- distribution/replication queue;
- MV target freshness;
- backfill progress.

### 20.2 Alert Examples

- ingestion lag > 5 min;
- DLQ count > threshold;
- duplicate rate > threshold;
- batch insert p95 > threshold;
- rows ingested suddenly drops to zero;
- part count grows too fast;
- rollup diff != 0 after allowed window;
- watermarks stale;
- schema validation failures spike.

### 20.3 Dashboard

Build ingestion dashboard:

```text
source lag
batches/min
rows/min
insert latency
DLQ/min
watermark
ClickHouse errors
reconciliation status
```

---

## 21. Handling Bad Data

### 21.1 Bad Single Records

Send to DLQ.

### 21.2 Bad Batch

Mark batch failed. Do not commit offset until safe.

### 21.3 Bad Producer Version

Quarantine schema version/source. Alert producer team.

### 21.4 Bad Historical Backfill

Options:

- drop partition and reload;
- delete by batch_id;
- load correction version;
- rebuild serving tables.

### 21.5 Bad Rollup

Usually rebuild from raw.

Do not patch aggregates manually unless you fully understand metric semantics.

---

## 22. Runbook: Missing Data

Symptoms:

```text
dashboard missing expected events
```

Check:

1. Source produced event?
2. Kafka topic has event?
3. Consumer processed offset?
4. DLQ contains event?
5. `raw_events` has event_id?
6. Refined table has event?
7. Rollup includes event bucket?
8. API queries correct time zone/table?
9. Replica/distributed queue lag?
10. Freshness watermark?

Queries:

```sql
SELECT *
FROM raw_events
WHERE event_id = '...';
```

```sql
SELECT *
FROM ingestion_validation_errors
WHERE event_id = '...';
```

```sql
SELECT *
FROM ingestion_batches
WHERE batch_id = '...';
```

---

## 23. Runbook: Duplicate Data

Symptoms:

```text
counts doubled
```

Check:

1. Duplicate event_id?
2. Same batch inserted twice?
3. Backfill repeated?
4. MV target duplicated?
5. Raw vs rollup mismatch?
6. Event_id generated randomly on retry?
7. ReplacingMergeTree not finalized?

Queries:

```sql
SELECT
    event_id,
    count()
FROM raw_events
GROUP BY event_id
HAVING count() > 1
ORDER BY count() DESC
LIMIT 100;
```

```sql
SELECT
    ingest_batch_id,
    count()
FROM raw_events
GROUP BY ingest_batch_id
ORDER BY count() DESC;
```

Fix:

- dedup via refined table;
- drop/reload partition;
- delete duplicate batch;
- rebuild rollups;
- fix producer identity.

---

## 24. Runbook: Pipeline Stuck

Symptoms:

```text
consumer lag increasing
no new rows in ClickHouse
```

Check:

- consumer logs;
- ClickHouse insert errors;
- validation error spike;
- DLQ;
- schema mismatch;
- ClickHouse availability;
- too many parts;
- replication queue;
- network;
- object storage if backfill.

Immediate actions:

- pause problematic partition/source;
- route invalid records to DLQ if safe;
- throttle;
- increase batch size if too many parts;
- rollback schema change;
- scale consumer if ClickHouse healthy.

---

## 25. Runbook: Bad Backfill

Symptoms:

```text
historical counts wrong after backfill
```

Check:

- manifest;
- loaded files;
- row counts;
- checksums;
- duplicate batch IDs;
- target partitions;
- rollup rebuild status;
- materialized view behavior.

Fix options:

1. drop affected partitions and reload;
2. use shadow table validated load;
3. delete by backfill_id;
4. rebuild serving tables;
5. create correction report if official report affected.

---

## 26. Regulatory Case Lifecycle Pipeline Example

### 26.1 Source

Case service emits outbox events:

```text
CASE_OPENED
CASE_CLASSIFIED
CASE_ASSIGNED
CASE_ESCALATED
CASE_DECIDED
CASE_CLOSED
CASE_REOPENED
CASE_CORRECTED
```

### 26.2 Pipeline

```text
case-service DB transaction
→ outbox row
→ Debezium/Kafka
→ case-ingestion-service
→ ClickHouse raw case_lifecycle_events
→ current state table
→ daily rollups
→ official report snapshots
```

### 26.3 Event Requirements

Each event has:

- tenant_id;
- event_id;
- case_id;
- event_type;
- event_time;
- source_sequence;
- schema_version;
- actor;
- event-time dimensions;
- correction fields if any.

### 26.4 Validation

- tenant exists;
- case_id valid UUID;
- event_type allowed;
- event_time not too far future;
- severity in allowed set;
- schema_version supported;
- event_id present.

### 26.5 Reconciliation

Daily:

- source outbox count vs ClickHouse raw count;
- raw opened count vs rollup opened count;
- current state count vs OLTP current case count;
- report snapshot checksum.

### 26.6 Official Reports

Monthly report waits until:

- ingestion watermark past period end + lateness threshold;
- reconciliation passes;
- no active rebuild/mutation;
- snapshot created.

---

## 27. Product Analytics Pipeline Example

### 27.1 Source

Frontend/backend events → Kafka.

### 27.2 Risks

- duplicate frontend events;
- missing anonymous/user merge;
- late mobile events;
- schema drift;
- high-volume event storm;
- PII leakage in properties.

### 27.3 Design

- stable event_id from client/server;
- ingestion service validates;
- raw product_events;
- daily rollup with `uniqState`;
- DLQ invalid events;
- PII scrubbing;
- late window rebuild.

### 27.4 Reconciliation

- events per source per hour;
- unique event_id count;
- DAU raw vs rollup;
- schema version distribution;
- DLQ by event_name/version.

---

## 28. Observability Pipeline Example

### 28.1 Source

OpenTelemetry/FluentBit/Vector → Kafka or direct ClickHouse.

### 28.2 Logs

High volume. Need:

- batching;
- retention TTL;
- service/time sort key;
- payload size limits;
- PII scrubbing;
- DLQ for parse errors.

### 28.3 Metrics

Need cardinality control.

Reject/limit labels like:

- request_id;
- user_id;
- session_id;
- full URL with IDs.

### 28.4 Traces

Need sampling and trace_id access path.

### 28.5 Reconciliation

Observability may tolerate loss differently than regulatory events. Define SLO explicitly.

---

## 29. Operational Anti-Patterns

### 29.1 Commit Offset Before Durable Insert

Data loss.

### 29.2 No Stable Event ID

No dedup.

### 29.3 Backfill Without Manifest

No auditability/restartability.

### 29.4 Direct Raw Backfill Twice

Double count.

### 29.5 MV Target Not Rebuilt After Raw Correction

Rollup remains wrong.

### 29.6 DLQ Without Monitoring

Silent data loss.

### 29.7 Schema Change Without Compatibility

Pipeline stuck.

### 29.8 Watermark Based Only on Ingest Time

Misleading completeness.

### 29.9 Row-by-Row Inserts

Small parts and cluster overload.

### 29.10 Treating At-Least-Once as Exactly-Once

Duplicates will happen unless designed out.

---

## 30. Production Checklist

### Source Contract

- [ ] Source of truth identified.
- [ ] Event/fact identity stable.
- [ ] Schema versioned.
- [ ] Source offset/sequence stored.
- [ ] Event time and ingest time stored.
- [ ] Delivery guarantee documented.

### Ingestion

- [ ] Batching implemented.
- [ ] Retry idempotent.
- [ ] Offset commit after safe insert.
- [ ] Backpressure exists.
- [ ] DLQ exists and monitored.
- [ ] Validation implemented.
- [ ] Batch metadata stored.
- [ ] Watermark updated.

### ClickHouse Tables

- [ ] Raw table append-only.
- [ ] Refined table strategy defined.
- [ ] Serving/rollup tables defined.
- [ ] Materialized view behavior documented.
- [ ] Dedup strategy defined.
- [ ] Late event strategy defined.
- [ ] Retention/TTL defined.

### Backfill

- [ ] Manifest exists.
- [ ] Shadow table or partition strategy defined.
- [ ] Idempotency defined.
- [ ] Validation counts/checksums.
- [ ] Rollups rebuilt.
- [ ] Report impact assessed.

### Reconciliation

- [ ] Source vs ClickHouse count checks.
- [ ] Duplicate detection.
- [ ] Raw vs rollup checks.
- [ ] CDC snapshot checks.
- [ ] Alerting on mismatch.
- [ ] Reconciliation history stored.

### Operations

- [ ] Lag metrics.
- [ ] Insert latency metrics.
- [ ] DLQ metrics.
- [ ] Part count monitoring.
- [ ] Replication/distribution queues monitored.
- [ ] Runbooks documented.
- [ ] Replay process tested.

---

## 31. Exercises

### Exercise 1: Kafka Offset Commit

A consumer commits Kafka offset before ClickHouse insert succeeds.

Question:

```text
What can go wrong?
```

Expected:

```text
If insert fails after commit, data is lost. Commit only after safe insert or durable DLQ handling.
```

### Exercise 2: Duplicate Retry

Insert batch times out and service retries with same rows but new event_id.

Expected:

```text
Dedup impossible. Use stable event_id and batch_id.
```

### Exercise 3: Late Event Rollup

Event for May arrives in June. Dashboard uses daily rollup.

Expected:

```text
Need MV that updates May bucket, or rebuild late window, or correction/amendment strategy.
```

### Exercise 4: Backfill Double Count

Historical Parquet load is accidentally run twice.

Expected:

```text
Need manifest/idempotency/drop partition/shadow table/batch_id cleanup and rollup rebuild.
```

### Exercise 5: CDC Delete

CDC emits delete for user. Ingestion ignores it.

Expected:

```text
Current snapshot remains wrong. Model delete as tombstone with version.
```

---

## 32. Summary

Production ingestion is where analytical correctness is won or lost.

Core principles:

1. Ingestion is a contract, not plumbing.
2. Stable event_id and batch_id are mandatory for idempotency.
3. Kafka offsets should be committed only after data is safely handled.
4. Raw tables preserve replay and auditability.
5. Refined and serving tables can be rebuilt from raw.
6. CDC needs raw change log, source ordering, and tombstones.
7. Backfills require manifests, validation, and idempotency.
8. Late events require watermark/rebuild/correction strategy.
9. Materialized views do not automatically undo old derived rows.
10. DLQ must be monitored and replayable.
11. Reconciliation is a first-class production process.
12. Java ingestion services need backpressure, retries, metrics, and runbooks.

Practical sentence:

> In ClickHouse, fast queries are valuable only if the ingestion pipeline makes the data trustworthy.

---

## 33. Referensi Belajar Lanjutan

Gunakan dokumentasi resmi sesuai versi dan deployment:

1. ClickHouse Docs — Inserting data.
2. ClickHouse Docs — Selecting an insert strategy.
3. ClickHouse Docs — Bulk inserts.
4. ClickHouse Docs — Asynchronous inserts.
5. ClickHouse Docs — Deduplicating inserts on retries.
6. ClickHouse Docs — Kafka table engine.
7. ClickHouse Docs — Materialized views.
8. ClickHouse Docs — Backfilling data.
9. ClickHouse Docs — S3 table function.
10. ClickHouse Docs — ReplacingMergeTree.
11. ClickHouse Docs — Lightweight deletes and mutations.
12. ClickHouse Docs — system.parts.
13. ClickHouse Docs — system.query_log.
14. Debezium Docs — Change data capture concepts.
15. Kafka Docs — Consumer offsets and delivery semantics.

---

## 34. Status Seri

Part ini adalah:

```text
Part 029 / 034
```

Seri belum selesai.

Part berikutnya:

```text
Part 030 — Operations I: Deployment, Configuration, Monitoring, Alerting, and Day-2 Runbooks
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-028.md">⬅️ Part 028 — Java Integration II: Spring Boot Analytics Service, Query Builder, Exports, and Operational Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-030.md">Part 030 — Operations I: Deployment, Configuration, Monitoring, Alerting, and Day-2 Runbooks ➡️</a>
</div>
