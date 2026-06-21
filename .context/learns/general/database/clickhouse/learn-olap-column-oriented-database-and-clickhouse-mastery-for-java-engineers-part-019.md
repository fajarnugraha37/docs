# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-019.md

# Part 019 — Updates, Deletes, Deduplication, and Mutable Analytics

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **019 / 034**  
> Fokus: memahami perubahan data di ClickHouse: update, delete, deduplication, latest-state modeling, tombstone, mutable analytics, dan correctness model untuk sistem produksi.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita membahas table engines beyond basic `MergeTree`:

- `MergeTree`;
- `ReplacingMergeTree`;
- `SummingMergeTree`;
- `AggregatingMergeTree`;
- `CollapsingMergeTree`;
- `ReplicatedMergeTree`;
- `Distributed`;
- `Kafka`;
- `S3`;
- `Null`;
- `Buffer`;
- dan engine lain.

Sekarang kita fokus ke pertanyaan yang hampir selalu muncul ketika engineer OLTP mulai memakai ClickHouse:

> “Bagaimana cara update/delete data?”

Jawaban pendeknya:

> Bisa, tetapi jangan mulai dari mindset OLTP.

ClickHouse adalah database OLAP column-oriented yang sangat kuat untuk append-heavy analytical workloads. Perubahan data tetap didukung, tetapi cost model-nya berbeda dari OLTP row store.

Di OLTP, update satu row biasanya natural:

```sql
UPDATE cases
SET status = 'CLOSED'
WHERE case_id = ?;
```

Di ClickHouse, jika kamu memakai pola update seperti itu dalam skala besar dan frekuensi tinggi, kamu bisa membuat:

- mutation queue menumpuk;
- parts direwrite;
- merge backlog;
- disk I/O melonjak;
- query performance turun;
- cluster tidak stabil;
- hasil query membingungkan karena proses perubahan asynchronous.

Part ini akan membangun mental model yang benar:

1. physical mutation;
2. logical mutation;
3. append-only correction;
4. latest-state table;
5. deduplication;
6. tombstone;
7. delete lifecycle;
8. retention;
9. privacy deletion;
10. regulatory auditability.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. menjelaskan kenapa update/delete di ClickHouse berbeda dari OLTP;
2. membedakan `ALTER UPDATE/DELETE`, lightweight delete, TTL, drop partition, replacing, collapsing, dan tombstone model;
3. mendesain append-first mutable analytics;
4. memilih antara raw event table, current-state table, correction event, delete marker, dan mutation;
5. memahami deduplication pada insert dan engine-level replacement;
6. memahami risiko `FINAL`;
7. mendesain idempotent ingestion dari Java service;
8. menangani late events, duplicate events, corrections, and retractions;
9. membangun deletion strategy untuk retention, GDPR/privacy, dan operational cleanup;
10. membuat production checklist agar mutation tidak menjadi sumber insiden.

---

## 2. Mental Model Utama: ClickHouse Suka Menambah Data, Bukan Mengubah Row Kecil

### 2.1 OLTP Update Mental Model

Dalam OLTP row store:

```text
find row by primary key
lock row
change value
update index
commit transaction
```

Update adalah operasi normal.

### 2.2 ClickHouse MergeTree Mental Model

Dalam ClickHouse MergeTree:

```text
insert block
→ create immutable part
→ background merge parts
→ read column files with sparse index
```

Data part bersifat immutable secara praktis. Jika kamu ingin “mengubah” data yang sudah masuk, engine harus melakukan bentuk rewrite/mark/collapse/replace.

Jadi update/delete bukan “ubah cell kecil”.  
Lebih tepat:

```text
menghasilkan versi/correction/tombstone baru
atau
menjadwalkan pekerjaan background untuk menandai/rewrite data lama
```

### 2.3 Pertanyaan Utama

Ketika ada data berubah, jangan langsung bertanya:

> “Bagaimana SQL UPDATE-nya?”

Tanya dulu:

1. Apakah perubahan ini harus mengubah historical truth?
2. Apakah perubahan ini current-state saja?
3. Apakah perubahan ini correction event?
4. Apakah query lama harus berubah hasil?
5. Apakah data harus physically deleted?
6. Apakah deletion karena retention, privacy, atau bug cleanup?
7. Apakah update terjadi sering?
8. Apakah update per-row, per-partition, atau per-batch?
9. Apakah raw audit trail harus dipertahankan?
10. Apakah query dapat membaca latest version secara logical?

Jawaban pertanyaan itu menentukan pola desain.

---

## 3. Taxonomy Perubahan Data

Perubahan data di analytics biasanya masuk salah satu kategori berikut.

### 3.1 Append New Event

Contoh:

```text
CASE_OPENED
CASE_ASSIGNED
CASE_CLOSED
PAYMENT_AUTHORIZED
API_REQUEST_COMPLETED
```

Strategi:

```text
Insert row baru ke raw event table.
```

Ini ideal untuk ClickHouse.

### 3.2 Correct Wrong Event

Contoh:

```text
event sebelumnya salah severity
timestamp salah
amount salah
dimension salah
```

Strategi bisa:

1. insert correction event;
2. insert replacement version;
3. rebuild affected partition;
4. mutation jika sangat terbatas;
5. delete + reinsert jika aman.

### 3.3 Current State Change

Contoh:

```text
case status changed OPEN → CLOSED
user plan changed free → pro
merchant risk bucket changed LOW → HIGH
```

Strategi:

1. append state change event;
2. update latest-state table via `ReplacingMergeTree`;
3. query with `argMax`;
4. materialize current snapshot;
5. never rewrite all historical events unless semantics require it.

### 3.4 Delete for Retention

Contoh:

```text
delete logs older than 90 days
delete raw events older than 7 years
```

Strategi:

1. partition drop;
2. TTL;
3. lifecycle storage policy.

### 3.5 Delete for Privacy/Compliance

Contoh:

```text
delete user personal data
erase email/phone/name
remove customer data on request
```

Strategi:

1. design PII minimization;
2. isolate PII from fact table;
3. pseudonymize/anonymize;
4. lightweight delete/mutation for targeted removal;
5. rebuild if necessary;
6. document eventual physical removal semantics.

### 3.6 Delete Bad Batch

Contoh:

```text
duplicate ingestion batch
corrupt data loaded for 2026-06-01
wrong tenant_id
```

Strategi:

1. drop partition if batch aligns with partition;
2. delete by batch_id with mutation/lightweight delete;
3. reload partition from source of truth;
4. maintain batch metadata.

### 3.7 Deduplicate Retried Insert

Contoh:

```text
network timeout after insert
client retries same batch
same events inserted twice
```

Strategi:

1. insert deduplication token;
2. event_id uniqueness modeling;
3. `ReplacingMergeTree`;
4. materialized dedup table;
5. query-level `uniq`/`argMax` when appropriate.

---

## 4. Physical Mutation vs Logical Mutation

### 4.1 Physical Mutation

Physical mutation means ClickHouse actually changes existing stored data representation.

Examples:

```sql
ALTER TABLE events
UPDATE severity = 'HIGH'
WHERE case_id = '...';
```

```sql
ALTER TABLE events
DELETE WHERE tenant_id = 42;
```

Or lightweight delete:

```sql
DELETE FROM events
WHERE tenant_id = 42
  AND user_id = 1001;
```

Physical mutation can be expensive because it may require rewriting or marking rows in existing parts.

### 4.2 Logical Mutation

Logical mutation means existing rows remain, but query semantics interpret latest/correct row.

Examples:

```text
insert new version
insert correction event
insert tombstone
insert cancel row
compute latest by version
aggregate with sign
filter deleted flag
```

Example:

```sql
INSERT INTO case_state_versions
VALUES
(tenant_id, case_id, 'OPEN',  version=1, deleted=0),
(tenant_id, case_id, 'CLOSED', version=2, deleted=0);
```

Query:

```sql
SELECT
    tenant_id,
    case_id,
    argMax(status, version) AS status
FROM case_state_versions
GROUP BY
    tenant_id,
    case_id;
```

This avoids rewriting old data.

### 4.3 Rule of Thumb

Use physical mutation for:

- rare correction;
- bounded partition repair;
- compliance deletion;
- administrative cleanup;
- small data sets;
- planned maintenance windows.

Use logical mutation for:

- frequent updates;
- current-state modeling;
- append-only auditability;
- CDC streams;
- event correction;
- late-arriving data;
- user-facing analytics with predictable ingestion.

---

## 5. ALTER UPDATE and ALTER DELETE Mutations

### 5.1 What They Do

ClickHouse supports mutations via `ALTER TABLE ... UPDATE` and `ALTER TABLE ... DELETE`.

Example update:

```sql
ALTER TABLE case_events
UPDATE severity_at_event = 'HIGH'
WHERE tenant_id = 10
  AND case_id = '00000000-0000-0000-0000-000000000001';
```

Example delete:

```sql
ALTER TABLE case_events
DELETE
WHERE tenant_id = 10
  AND batch_id = 'bad-batch-2026-06-01';
```

These operations are not OLTP-style row updates. They schedule mutation work over affected parts.

### 5.2 Why Mutations Are Expensive

A mutation can require:

- scanning affected parts;
- rewriting column files;
- creating new mutated parts;
- updating metadata;
- competing with background merges;
- increasing disk I/O;
- creating backlog;
- affecting query performance.

If predicate touches many parts, mutation becomes large.

### 5.3 Mutation Queue

Mutations are asynchronous. You must monitor them.

Example:

```sql
SELECT
    database,
    table,
    mutation_id,
    command,
    create_time,
    is_done,
    latest_failed_part,
    latest_fail_reason,
    parts_to_do
FROM system.mutations
WHERE database = currentDatabase()
ORDER BY create_time DESC;
```

### 5.4 When ALTER UPDATE Is Reasonable

Use `ALTER UPDATE` if:

- correction is rare;
- affected data is small;
- predicate is selective;
- operation can run async;
- backlog is monitored;
- correction cannot be modeled logically;
- rebuild/reinsert is harder.

Examples:

- fix a small bad dimension value;
- update a small recent partition;
- repair a known limited batch.

### 5.5 When ALTER UPDATE Is Dangerous

Dangerous if:

- used for every status change;
- used per user action;
- affects large historical partitions;
- happens continuously;
- predicate not aligned with partition/sort key;
- cluster already has merge backlog;
- dashboard depends on immediate result;
- mutation storm occurs.

### 5.6 Java Anti-Pattern

Bad Java service pattern:

```java
caseRepository.updateStatusInClickHouse(caseId, "CLOSED");
```

called for every lifecycle transition.

Better pattern:

```text
write case state change event
insert latest-state version row
serve current state from current-state table/query
```

---

## 6. Lightweight Deletes

### 6.1 Concept

Lightweight delete uses `DELETE FROM table WHERE ...` syntax and marks rows as deleted rather than immediately physically removing them. Physical removal happens later through merges/cleanup.

Example:

```sql
DELETE FROM events
WHERE tenant_id = 10
  AND user_id = 123;
```

### 6.2 Why It Exists

It is often more practical than full delete mutations for targeted deletion because it avoids immediate full rewrite in the same way. But it still has cost and operational semantics.

### 6.3 Important Semantics

After lightweight delete:

- rows are logically hidden from queries;
- storage may not immediately shrink;
- physical cleanup is eventual;
- projections may have special restrictions/settings;
- many deletes can still create overhead;
- delete masks/metadata can affect read path.

### 6.4 When To Use

Use lightweight delete for:

- targeted privacy deletion;
- removing a limited set of users/entities;
- operational cleanup where physical removal can be eventual;
- smaller delete predicates.

### 6.5 When Not To Use

Avoid as routine high-frequency delete mechanism.

Do not use for:

- constant per-event correction;
- massive retention cleanup;
- large time-range deletion;
- replacing proper partition lifecycle;
- frequent user-facing state changes.

### 6.6 Retention Alternative

If deleting old data:

```sql
ALTER TABLE events DROP PARTITION '202606';
```

or TTL is often better than row-level delete.

---

## 7. TTL and Partition Drop

### 7.1 TTL

TTL defines data lifecycle rules.

Example:

```sql
CREATE TABLE logs
(
    timestamp DateTime64(3),
    service LowCardinality(String),
    level LowCardinality(String),
    message String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (service, timestamp)
TTL timestamp + INTERVAL 90 DAY;
```

This means rows older than 90 days become eligible for deletion.

### 7.2 TTL Is Not Instant

TTL is applied during background merges. It is lifecycle automation, not immediate deletion guarantee.

### 7.3 DROP PARTITION

If data is partitioned by month:

```sql
ALTER TABLE logs DROP PARTITION 202601;
```

This is efficient because it removes whole partition parts.

### 7.4 Retention Strategy

For retention:

| Need | Preferred Strategy |
|---|---|
| Delete old monthly data | monthly partition + drop partition |
| Rolling retention | TTL |
| Archive cold data | TTL to volume/storage policy |
| Delete one user | lightweight delete / mutation |
| Delete bad batch aligned to partition | drop partition |
| Delete bad batch not aligned | delete/mutation by batch_id |
| Rebuild whole period | drop partition + reload |

### 7.5 Partition Alignment

Good partition key can make retention cheap.

Example:

```sql
PARTITION BY toYYYYMM(event_time)
```

If retention is monthly, this is good.

Bad:

```sql
PARTITION BY cityHash64(user_id) % 1024
```

Now deleting old month is scattered across partitions.

---

## 8. Deduplication: Different Meanings

“Deduplication” can mean different things.

### 8.1 Insert Deduplication

Prevent same insert block from being inserted twice.

Use case:

```text
client inserts batch
network timeout
client retries same batch
ClickHouse avoids duplicate batch
```

This is batch/block-level deduplication behavior, often tied to replicated tables and deduplication tokens.

### 8.2 Event-Level Deduplication

Prevent same business event from being counted twice.

Use case:

```text
event_id repeated in two different batches
producer emits duplicate events
stream replay overlaps
```

This requires data model.

### 8.3 Engine-Level Deduplication

`ReplacingMergeTree` keeps one row among duplicates by sorting key/version during merge.

### 8.4 Query-Level Deduplication

Use:

```sql
uniq(event_id)
```

or:

```sql
argMax(value, version)
```

or:

```sql
row_number style logic
```

to compute logical unique result.

### 8.5 Materialized Deduplication

Create refined table from raw events, keeping latest/unique event per key.

---

## 9. Insert Deduplication and Retry Safety

### 9.1 The Timeout Problem

Java app sends insert:

```text
INSERT batch A
```

Then connection times out.

Possibilities:

1. insert failed before reaching server;
2. insert succeeded but response lost;
3. insert partially processed depending path;
4. insert queued async;
5. insert failed on some replicas.

If app blindly retries, duplicates may occur unless idempotency exists.

### 9.2 Deduplication Token

For retryable inserts, use stable insert deduplication tokens where supported/applicable.

Concept:

```text
batch_id = deterministic ID of payload
retry uses same batch_id
server can identify duplicate insert block
```

Java ingestion should maintain:

- batch id;
- source partition/offset range;
- content hash;
- tenant id;
- event count;
- min/max event time;
- retry count.

### 9.3 Kafka Consumer Example

Batch identity:

```text
topic=case-events
partition=7
offset_start=120000
offset_end=120999
```

Use that as idempotency metadata.

### 9.4 Event ID

Every event should have a stable `event_id` when business dedup matters.

```sql
CREATE TABLE raw_events
(
    tenant_id UInt64,
    event_id UUID,
    event_time DateTime64(3),
    event_type LowCardinality(String),
    payload String,
    ingest_batch_id String,
    ingest_time DateTime64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, event_type, event_id);
```

If duplicate event can arrive in different batches, block dedup is insufficient. Use event-level strategy.

---

## 10. ReplacingMergeTree for Deduplication and Latest State

### 10.1 Basic Pattern

```sql
CREATE TABLE events_dedup
(
    tenant_id UInt64,
    event_id UUID,
    event_time DateTime64(3),
    event_type LowCardinality(String),
    payload String,
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_id);
```

If duplicate `event_id` appears, latest `version` wins during merge.

### 10.2 Important Warning

If `ORDER BY` includes `event_time` and duplicate event has slightly different event_time:

```sql
ORDER BY (tenant_id, event_time, event_id)
```

then duplicate identity may not match if event_time differs.

For replacement identity, sorting key must include the identity columns in the way engine uses to find duplicates.

### 10.3 Query Options

Option 1: Use `FINAL`.

```sql
SELECT *
FROM events_dedup FINAL
WHERE tenant_id = 10;
```

Potentially expensive.

Option 2: Use `argMax`.

```sql
SELECT
    tenant_id,
    event_id,
    argMax(event_type, version) AS event_type,
    argMax(payload, version) AS payload,
    max(version) AS version
FROM events_dedup
WHERE tenant_id = 10
GROUP BY
    tenant_id,
    event_id;
```

Option 3: Maintain refined deduped table.

```text
raw_events
→ dedup process
→ clean_events
```

### 10.4 When ReplacingMergeTree Is Good

- CDC upsert;
- latest snapshot;
- idempotent event replacement;
- occasional duplicate correction;
- current-state table;
- deduped serving table.

### 10.5 When It Is Not Enough

Not enough if:

- you need immediate uniqueness;
- you cannot tolerate duplicates before merge;
- dashboard cannot use `argMax`/`FINAL`;
- duplicate identity is poorly modeled;
- updates modify sorting key;
- delete/tombstone semantics not modeled.

---

## 11. Tombstone Pattern

### 11.1 What Is a Tombstone?

A tombstone is a row indicating that an entity/event should be considered deleted or inactive.

Example:

```sql
CREATE TABLE case_state_versions
(
    tenant_id UInt64,
    case_id UUID,
    status LowCardinality(String),
    deleted UInt8,
    updated_at DateTime64(3),
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
ORDER BY (tenant_id, case_id);
```

Insert active state:

```text
case_id=A, status=OPEN, deleted=0, version=1
```

Insert tombstone:

```text
case_id=A, status='', deleted=1, version=2
```

Query current non-deleted:

```sql
SELECT *
FROM
(
    SELECT
        tenant_id,
        case_id,
        argMax(status, version) AS status,
        argMax(deleted, version) AS deleted,
        max(version) AS version
    FROM case_state_versions
    GROUP BY
        tenant_id,
        case_id
)
WHERE deleted = 0;
```

### 11.2 Use Case

Tombstone is useful for:

- CDC deletes;
- soft delete;
- current-state view;
- logical deletion;
- retraction;
- preserving audit trail.

### 11.3 Tombstone vs Physical Delete

Tombstone:

- preserves history;
- query filters latest deleted state;
- good for audit/current state;
- does not remove physical data.

Physical delete:

- removes/hides data;
- needed for privacy/retention;
- can be expensive;
- may be eventual.

### 11.4 Regulatory Perspective

For enforcement/case systems, tombstone can be defensible for logical lifecycle:

```text
case withdrawn
record superseded
assignment revoked
decision reversed
```

But tombstone is not enough for legal erasure if physical removal/anonymization is required.

---

## 12. Correction Event Pattern

### 12.1 Instead of Updating Old Event

Suppose event was inserted:

```text
CASE_CLASSIFIED severity=LOW
```

Later discovered wrong; should be `HIGH`.

Do not immediately mutate historical row.

Insert correction:

```text
CASE_CLASSIFICATION_CORRECTED
old_severity=LOW
new_severity=HIGH
reason=manual_review
effective_time=...
```

### 12.2 Query Semantics

For audit report:

- show original and correction;
- reconstruct final classification based on latest correction;
- preserve who corrected and why.

For operational report:

- use current state table derived from events.

### 12.3 Why This Is Powerful

Correction events preserve:

- history;
- accountability;
- lineage;
- temporal reasoning;
- replayability;
- defensibility.

This is often superior for regulatory systems.

### 12.4 Derived Current State

Raw events:

```text
CASE_OPENED
CASE_CLASSIFIED LOW
CASE_CLASSIFICATION_CORRECTED HIGH
CASE_ASSIGNED
```

Current state table:

```text
case_id=A, current_severity=HIGH, version=...
```

This separation is fundamental.

---

## 13. Mutable Analytics Models

There are several ways to model mutable data.

### 13.1 Immutable Event Log + Derived Views

Pattern:

```text
raw immutable events
→ materialized/derived current state
→ rollups/serving tables
```

Best for:

- auditability;
- regulatory systems;
- replay;
- late corrections;
- lifecycle analytics.

### 13.2 Versioned Fact Table

Pattern:

```text
same business key
multiple versions
latest wins
```

Use:

- `ReplacingMergeTree`;
- `argMax`;
- version columns.

Best for:

- upsert/CDC-like data;
- latest snapshots;
- corrected facts.

### 13.3 Sign-Based Fact Table

Pattern:

```text
positive row adds
negative row retracts
```

Use:

- `CollapsingMergeTree`;
- explicit `sign`;
- sum with sign.

Best for:

- event retraction;
- accounting-like reversals;
- state cancellation.

### 13.4 Physical Mutation

Pattern:

```text
rewrite/delete rows in place
```

Best for:

- exceptional repairs;
- administrative deletes;
- privacy deletion;
- batch cleanup.

### 13.5 Full Rebuild

Pattern:

```text
drop affected partition/table
reload from source of truth
rebuild derived tables
```

Best for:

- large correction;
- logic changes;
- derived table bugs;
- materialized view redesign.

---

## 14. CDC Modeling in ClickHouse

### 14.1 CDC Event Types

A CDC stream may contain:

```text
INSERT
UPDATE
DELETE
```

Each record may include:

- primary key;
- before values;
- after values;
- operation type;
- commit timestamp;
- transaction id;
- sequence;
- source table;
- source LSN/binlog offset.

### 14.2 Raw CDC Table

```sql
CREATE TABLE user_cdc_raw
(
    source_table LowCardinality(String),
    op LowCardinality(String),
    user_id UInt64,
    before_payload String,
    after_payload String,
    commit_time DateTime64(3),
    source_lsn String,
    ingest_time DateTime64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(commit_time)
ORDER BY (source_table, commit_time, user_id, source_lsn);
```

This preserves source change history.

### 14.3 Current Snapshot Table

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

Insert one row per CDC event, including tombstones.

### 14.4 Query Current

```sql
SELECT *
FROM
(
    SELECT
        user_id,
        argMax(country, version) AS country,
        argMax(plan, version) AS plan,
        argMax(deleted, version) AS deleted
    FROM user_current
    GROUP BY user_id
)
WHERE deleted = 0;
```

### 14.5 Key Requirement

Version must be deterministic and ordered according to source truth.

Bad version:

```text
ingest_time generated by ClickHouse
```

Better version:

```text
source commit timestamp + sequence
LSN/binlog offset
monotonic source version
```

---

## 15. Late Arriving Events

### 15.1 What Is Late Event?

An event arrives after the time period it belongs to.

Example:

```text
event_time = 2026-05-10
ingest_time = 2026-06-21
```

### 15.2 Why It Matters

If rollup for May already computed, late event can make dashboard wrong.

### 15.3 Strategies

#### Strategy A: Query Raw Data Directly

Late event naturally appears if query scans raw table.

Cost may be high.

#### Strategy B: Incremental Materialized View

If MV groups by event_time, late event updates appropriate aggregate state or summing row.

Works if target table can merge correctly.

#### Strategy C: Rebuild Window

Define correction window:

```text
last 7 days can change
older data frozen
```

Run scheduled rebuild for recent partitions.

#### Strategy D: Watermark

Only publish final reports after watermark:

```text
Daily report final after T+3 days
```

#### Strategy E: Correction Event

If event is too late or report already locked, insert correction event and show adjustment.

### 15.4 Regulatory Reporting

Regulatory reports often need:

- preliminary report;
- final report;
- amended report;
- audit trail of corrections.

Do not silently rewrite historical numbers without versioning/report snapshot.

---

## 16. Duplicate Events

### 16.1 Sources of Duplicate

Duplicates can come from:

- retry after timeout;
- Kafka replay;
- producer bug;
- CDC connector restart;
- backfill overlap;
- batch reprocessing;
- materialized view re-run;
- manual reinsert.

### 16.2 Duplicate Types

| Type | Example | Strategy |
|---|---|---|
| Same batch duplicate | client retries same insert | insert dedup token |
| Same event duplicate | same event_id different batch | event_id + Replacing/argMax |
| Semantic duplicate | two events represent same business fact | business key dedup |
| Duplicate aggregate | rollup reinserted twice | idempotent rebuild/drop partition |
| Duplicate CDC update | same LSN replay | source offset/version dedup |

### 16.3 Event ID Strategy

Good event id:

```text
deterministic from source event identity
stable across retry
unique within tenant/source
not generated randomly on retry
```

Bad:

```java
UUID.randomUUID()
```

generated every time ingestion retries the same event.

Better:

```text
hash(tenant_id, source_system, source_event_id)
```

or source-provided immutable event id.

---

## 17. Idempotent Backfill

Backfill often causes duplicates if not designed.

### 17.1 Bad Backfill

```text
INSERT historical data for May
Oops wrong transform
INSERT May again
```

Now May duplicated.

### 17.2 Safer Patterns

#### Pattern A: Drop Partition and Reload

```sql
ALTER TABLE events DROP PARTITION 202605;

INSERT INTO events
SELECT ...
WHERE event_time >= '2026-05-01'
  AND event_time < '2026-06-01';
```

Good if partition aligns.

#### Pattern B: Load Into Shadow Table

```text
events_shadow_202605
validate counts/checksums
swap/rename or insert after cleanup
```

#### Pattern C: Include batch_id and Delete Bad Batch

```sql
ALTER TABLE events
DELETE WHERE backfill_batch_id = 'bf-2026-05-v1';
```

Then reload.

#### Pattern D: ReplacingMergeTree With Version

Load corrected rows with higher version.

#### Pattern E: Aggregate Table Rebuild

For rollups:

```text
drop affected aggregate partition
recompute from raw
insert fresh aggregate
```

### 17.3 Backfill Metadata

Maintain table:

```sql
CREATE TABLE ingestion_batches
(
    batch_id String,
    source String,
    tenant_id UInt64,
    min_event_time DateTime64(3),
    max_event_time DateTime64(3),
    rows UInt64,
    checksum String,
    status LowCardinality(String),
    created_at DateTime64(3),
    completed_at Nullable(DateTime64(3))
)
ENGINE = MergeTree
ORDER BY (source, created_at, batch_id);
```

This is operationally valuable.

---

## 18. Deletes for Privacy and PII

### 18.1 Design Principle: Minimize PII in Fact Tables

Best deletion strategy is avoiding unnecessary PII in ClickHouse fact tables.

Bad event table:

```text
user_email
phone_number
full_name
address
message_text_with_pii
```

Better:

```text
user_id
pseudonymous_user_key
country
plan
coarse_region
```

Keep PII in a controlled dimension store with stricter lifecycle.

### 18.2 Pseudonymization

Use stable pseudonymous IDs:

```text
user_key = HMAC(secret, source_user_id)
```

Benefits:

- analytics can group user activity;
- raw PII not stored;
- deletion may be handled by deleting mapping;
- reduces exposure.

Caution:

- pseudonymization is not always anonymization;
- regulatory requirements vary;
- re-identification risk must be evaluated.

### 18.3 Right to Erasure

If user data must be removed:

Options:

1. lightweight delete rows by user;
2. delete/mutation to anonymize columns;
3. remove mapping from identity service;
4. rebuild affected partitions;
5. encrypt per-user data and delete keys;
6. avoid storing PII in first place.

### 18.4 Physical Removal Expectations

ClickHouse lightweight delete hides rows quickly but physical removal may be eventual. Full deletion may require merge/cleanup behavior. For strict compliance, define:

- logical deletion time;
- physical purge process;
- verification query;
- backup deletion policy;
- derived table deletion;
- materialized view target deletion;
- object storage/raw file deletion.

### 18.5 Derived Data

Deleting from raw table is not enough if data was copied to:

- aggregate tables;
- materialized view targets;
- dictionaries;
- exported reports;
- S3 files;
- backups;
- caches;
- BI extracts.

Privacy deletion must be system-wide.

---

## 19. Deletes for Retention

### 19.1 Use Partitions

If retention is time-based, partition by time.

```sql
PARTITION BY toYYYYMM(event_time)
```

Then:

```sql
ALTER TABLE events DROP PARTITION 202401;
```

### 19.2 Use TTL

```sql
TTL event_time + INTERVAL 365 DAY
```

### 19.3 Use Tiered Retention

Example:

```text
raw logs: 30 days
parsed logs: 90 days
hourly metrics: 1 year
daily aggregates: 5 years
regulatory audit: 7 years
```

Different tables, different TTLs.

### 19.4 Retention as Architecture

Do not put all data into one table and hope TTL solves everything.

Design:

```text
raw_high_volume_events
refined_events
hourly_rollups
daily_rollups
audit_events
```

with different retention and storage policies.

---

## 20. Mutations and Projections

If table has projections, deletes/mutations may have additional behavior or restrictions depending settings and ClickHouse version.

Key point:

> Every additional physical representation of data must be updated/handled during mutation.

So projections can increase:

- mutation cost;
- delete complexity;
- storage overhead;
- rebuild complexity.

Before adding projections to mutable tables, ask:

1. Will this table receive deletes?
2. Will this table receive updates?
3. Can projection be rebuilt?
4. Is query benefit worth mutation cost?
5. Does version support desired lightweight delete behavior with projections?

---

## 21. Mutable Tables and Materialized Views

### 21.1 MV Insert-Time Semantics

Materialized views process inserted rows. They do not automatically “undo” old derived rows when source table is later mutated unless you explicitly design for it.

Example:

```text
raw_events insert count=1
MV inserts aggregate count=1 into rollup
later raw_events row deleted
rollup still has count=1 unless corrected
```

This is critical.

### 21.2 Correction Strategy for MVs

If source data is corrected after insertion:

Options:

1. rebuild affected aggregate partitions from raw;
2. use sign/retraction rows in aggregate;
3. insert compensating negative aggregate;
4. design rollup from correction events;
5. avoid mutating raw after MV, use append correction model.

### 21.3 Materialized View Backfill Warning

If you backfill source table with MV active, target table receives rows.

If you re-run backfill, target may duplicate unless you:

- drop target partition;
- use idempotent engine;
- use version/dedup;
- load through controlled process;
- disable/recreate MV carefully.

### 21.4 Rule

For every MV, document:

```text
What happens if source row is corrected?
What happens if source row is deleted?
What happens if source row is reinserted?
How do we rebuild target?
```

---

## 22. Mutable Aggregates

### 22.1 Additive Corrections

If metric is additive, correction can be expressed as delta.

Example:

Original wrong amount:

```text
amount = 100
```

Correct amount:

```text
amount = 120
```

Insert correction delta:

```text
delta_amount = +20
```

For deletion/retraction:

```text
delta_amount = -100
```

Aggregate query sums deltas.

### 22.2 Sign Column

```sql
CREATE TABLE revenue_events
(
    tenant_id UInt64,
    event_time DateTime64(3),
    order_id UUID,
    amount Decimal(18, 2),
    sign Int8
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, order_id);
```

Query:

```sql
SELECT
    toDate(event_time) AS day,
    sum(amount * sign) AS revenue
FROM revenue_events
GROUP BY day;
```

### 22.3 Non-Additive Corrections

Distinct count and quantiles are harder to retract.

If unique user event was wrong, subtracting distinct state is not generally simple.

Strategies:

- rebuild affected partition/window;
- maintain exact set if small;
- use correction window;
- avoid finalizing reports too early;
- store raw and recompute aggregates.

### 22.4 Regulatory Metrics

For official reports, prefer:

- versioned report snapshots;
- correction ledger;
- rebuildable raw source;
- documented amendments.

Avoid silent mutable aggregate changes with no audit trail.

---

## 23. `FINAL`: Correctness vs Cost

### 23.1 What FINAL Does

`FINAL` forces ClickHouse to apply final merge-like logic at query time for engines such as `ReplacingMergeTree` and `CollapsingMergeTree`.

Example:

```sql
SELECT *
FROM case_current_state FINAL
WHERE tenant_id = 10;
```

This can produce logically deduplicated/collapsed result.

### 23.2 Why FINAL Can Be Expensive

`FINAL` may require additional processing because engine cannot simply read rows as-is.

Cost depends on:

- table size;
- filtering selectivity;
- sort key;
- partitioning;
- number of parts;
- selected columns;
- version-specific optimizations;
- query pattern.

### 23.3 When FINAL Is Acceptable

Potentially acceptable if:

- table is small;
- query is highly selective by key;
- used for admin/debug;
- used in offline batch;
- benchmark proves acceptable;
- `FINAL` is applied after partition/key pruning.

### 23.4 When FINAL Is Dangerous

Dangerous if:

- used on large dashboard scans;
- used in every API query;
- query filters poorly;
- table has many parts;
- concurrency high;
- query spans many partitions.

### 23.5 Alternative

Use:

```sql
argMax(..., version)
```

or precomputed current serving table.

Example:

```sql
SELECT
    tenant_id,
    case_id,
    argMax(status, version) AS status,
    max(version) AS version
FROM case_current_state
WHERE tenant_id = 10
GROUP BY
    tenant_id,
    case_id;
```

---

## 24. Querying Latest State Safely

### 24.1 Latest Value By Version

```sql
SELECT
    case_id,
    argMax(status, version) AS status,
    argMax(assignee_user_id, version) AS assignee_user_id,
    max(version) AS latest_version
FROM case_state_versions
WHERE tenant_id = 10
GROUP BY case_id;
```

### 24.2 Latest Non-Deleted State

```sql
SELECT *
FROM
(
    SELECT
        case_id,
        argMax(status, version) AS status,
        argMax(deleted, version) AS deleted,
        max(version) AS latest_version
    FROM case_state_versions
    WHERE tenant_id = 10
    GROUP BY case_id
)
WHERE deleted = 0;
```

### 24.3 Latest State With Tuple

Sometimes use tuple to keep fields from same version.

```sql
SELECT
    case_id,
    argMax(
        tuple(status, assignee_user_id, deleted),
        version
    ) AS latest_tuple
FROM case_state_versions
GROUP BY case_id;
```

Then extract tuple fields.

This avoids independent `argMax` returning fields from different rows if version ties/logic is unclear.

### 24.4 Version Tie

Always define tie-breaking.

Bad:

```text
two rows same entity same version different status
```

Better:

- version unique;
- include sequence;
- use source offset;
- use `(commit_time, sequence)` logic;
- validate duplicates.

---

## 25. Java Ingestion Design for Mutability

### 25.1 Event Envelope

A robust event envelope:

```json
{
  "tenantId": 10,
  "eventId": "stable-id",
  "entityType": "CASE",
  "entityId": "case-uuid",
  "operation": "CASE_ASSIGNED",
  "eventTime": "2026-06-21T10:30:00.123Z",
  "sourceSystem": "case-service",
  "sourceSequence": 887122,
  "sourceTransactionId": "tx-123",
  "schemaVersion": 3,
  "producerTimestamp": "...",
  "ingestionBatchId": "topic-7-120000-120999"
}
```

Important fields:

- stable event id;
- business entity id;
- event time;
- source ordering;
- schema version;
- batch id;
- operation type.

### 25.2 Current-State Row

For `ReplacingMergeTree`:

```json
{
  "tenantId": 10,
  "caseId": "case-uuid",
  "status": "ASSIGNED",
  "assigneeUserId": 123,
  "updatedAt": "2026-06-21T10:30:00.123Z",
  "version": 887122,
  "deleted": 0
}
```

Version must be deterministic and monotonic for the entity.

### 25.3 Retry Model

Java ingestion should support:

- deterministic batch IDs;
- retry with same dedup token;
- bounded retry;
- DLQ;
- idempotent reprocessing;
- batch metadata;
- reconciliation queries;
- no random event ID on retry.

### 25.4 Avoid Row-by-Row Mutation

Bad:

```java
for (CaseUpdate update : updates) {
    clickHouse.execute("ALTER TABLE case_current UPDATE status = ? WHERE case_id = ?");
}
```

Better:

```java
batchInsert(caseStateVersions);
```

---

## 26. Reconciliation

Mutable analytics needs reconciliation.

### 26.1 Count Reconciliation

Compare source and ClickHouse:

```sql
SELECT
    toDate(event_time) AS day,
    count() AS rows,
    uniq(event_id) AS unique_events
FROM raw_events
WHERE event_time >= today() - 7
GROUP BY day
ORDER BY day;
```

### 26.2 Duplicate Detection

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

### 26.3 Current-State Duplicate Check

```sql
SELECT
    tenant_id,
    case_id,
    count() AS versions,
    uniq(version) AS unique_versions
FROM case_current_state
GROUP BY
    tenant_id,
    case_id
HAVING count() > uniq(version)
LIMIT 100;
```

### 26.4 Mutation Monitoring

```sql
SELECT
    database,
    table,
    mutation_id,
    command,
    is_done,
    parts_to_do,
    latest_fail_reason
FROM system.mutations
WHERE is_done = 0;
```

### 26.5 Deleted Row Validation

After delete request:

```sql
SELECT count()
FROM events
WHERE tenant_id = 10
  AND user_id = 123;
```

But remember:

- logical visibility may be gone;
- physical bytes may remain until cleanup;
- derived tables need separate checks.

---

## 27. Mutable Analytics Architecture Patterns

### 27.1 Pattern A: Immutable Raw + Current State

```text
case_events_raw: MergeTree
case_current_state: ReplacingMergeTree
daily_case_rollup: Aggregating/SummingMergeTree
```

Best general pattern.

### 27.2 Pattern B: Raw + Correction Ledger + Rebuildable Rollups

```text
raw_events
correction_events
rollups rebuilt for affected windows
report snapshots versioned
```

Best for official reporting.

### 27.3 Pattern C: CDC Raw + Snapshot

```text
source_cdc_raw
current_snapshot
analytics_events
```

Best for OLTP-to-OLAP sync.

### 27.4 Pattern D: Delta Facts

```text
fact_deltas(amount, sign)
sum(amount * sign)
```

Best for additive metrics with corrections.

### 27.5 Pattern E: Physical Mutation Maintenance

```text
rare ALTER DELETE/UPDATE
monitored mutation queue
maintenance window
```

Best for exceptional cleanup.

---

## 28. Regulatory / Case Lifecycle Example

### 28.1 Requirements

- Every case lifecycle event must be auditable.
- Current dashboard must show latest status.
- Historical report must show severity at event time.
- Corrections must be traceable.
- Deleted/withdrawn cases must not appear in operational backlog.
- Official reports may need amendments.

### 28.2 Raw Events

```sql
CREATE TABLE case_events_raw
(
    tenant_id UInt64,
    event_id UUID,
    case_id UUID,
    event_time DateTime64(3),
    event_type LowCardinality(String),
    severity_at_event LowCardinality(String),
    status_after_event LowCardinality(String),
    actor_user_id UInt64,
    correction_of_event_id Nullable(UUID),
    reason String,
    ingest_batch_id String,
    ingest_time DateTime64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_type, event_time, case_id, event_id);
```

This table is immutable.

### 28.3 Current State

```sql
CREATE TABLE case_current_state
(
    tenant_id UInt64,
    case_id UUID,
    status LowCardinality(String),
    current_severity LowCardinality(String),
    assignee_user_id UInt64,
    deleted UInt8,
    updated_at DateTime64(3),
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
ORDER BY (tenant_id, case_id);
```

### 28.4 Current Backlog Query

```sql
SELECT
    status,
    current_severity,
    count() AS cases
FROM
(
    SELECT
        case_id,
        argMax(status, version) AS status,
        argMax(current_severity, version) AS current_severity,
        argMax(deleted, version) AS deleted
    FROM case_current_state
    WHERE tenant_id = 10
    GROUP BY case_id
)
WHERE deleted = 0
GROUP BY
    status,
    current_severity;
```

### 28.5 Correction Event

Instead of mutating old event:

```text
event_type = CASE_SEVERITY_CORRECTED
correction_of_event_id = previous_event_id
old_value = LOW
new_value = HIGH
reason = manual_quality_review
```

Derived current state gets new version.

### 28.6 Official Report Snapshot

```sql
CREATE TABLE monthly_case_report_snapshots
(
    tenant_id UInt64,
    report_month Date,
    report_version UInt32,
    generated_at DateTime64(3),
    jurisdiction LowCardinality(String),
    severity LowCardinality(String),
    opened_cases UInt64,
    closed_cases UInt64,
    amendment_reason String
)
ENGINE = MergeTree
ORDER BY (tenant_id, report_month, report_version, jurisdiction, severity);
```

This avoids silently changing previously submitted reports.

---

## 29. Product Analytics Example

### 29.1 Duplicate Product Events

If product event ingestion retries:

```text
event_id = stable from frontend/server
```

Raw table:

```sql
CREATE TABLE product_events_raw
(
    tenant_id UInt64,
    event_id UUID,
    event_time DateTime64(3),
    user_id UInt64,
    event_name LowCardinality(String),
    session_id UUID,
    ingest_batch_id String,
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_id);
```

If dashboard cannot tolerate duplicates before merge, query with `argMax` or create refined deduped table.

### 29.2 Deleting User Data

Better design:

- fact table stores pseudonymous user key;
- PII in separate controlled store;
- deletion removes mapping and optionally deletes facts;
- aggregate reports may remain if anonymized and allowed.

### 29.3 Late Events

Define dashboard:

```text
last 3 days mutable
older data finalized
```

Rollups for last 3 days are rebuilt periodically.

---

## 30. Observability Example

Logs are usually append-only and high volume.

### 30.1 Retention

```sql
TTL timestamp + INTERVAL 30 DAY
```

or monthly/drop partition.

### 30.2 Bad Idea

Updating log rows to change parsed field continuously.

Better:

- parse at ingestion;
- if parser bug, rebuild affected period;
- keep raw message if needed;
- version parser output table if necessary.

### 30.3 Delete by Service/Tenant

If one tenant requests deletion:

```sql
DELETE FROM logs
WHERE tenant_id = 10;
```

But for massive tenant data, partitioning by tenant+time may be considered carefully, or rebuild/drop strategy. Avoid over-partitioning.

---

## 31. Operational Runbook for Mutations

### 31.1 Before Mutation

Ask:

1. How many rows affected?
2. How many parts affected?
3. Is predicate aligned with partition/sort key?
4. Can we drop/reload partition instead?
5. Can we use logical correction?
6. Is there an MV target to repair?
7. Is there a backup/source of truth?
8. Is cluster merge backlog healthy?
9. Is this during low traffic?
10. Is rollback plan defined?

### 31.2 Estimate Scope

```sql
SELECT
    partition,
    count() AS parts,
    sum(rows) AS rows,
    formatReadableSize(sum(bytes_on_disk)) AS bytes
FROM system.parts
WHERE database = currentDatabase()
  AND table = 'case_events_raw'
  AND active
GROUP BY partition
ORDER BY partition;
```

Estimate rows:

```sql
SELECT count()
FROM case_events_raw
WHERE tenant_id = 10
  AND batch_id = 'bad-batch';
```

### 31.3 Run Mutation

```sql
ALTER TABLE case_events_raw
DELETE WHERE tenant_id = 10
  AND batch_id = 'bad-batch';
```

### 31.4 Monitor

```sql
SELECT
    mutation_id,
    command,
    create_time,
    is_done,
    parts_to_do,
    latest_fail_reason
FROM system.mutations
WHERE table = 'case_events_raw'
ORDER BY create_time DESC;
```

### 31.5 Verify

```sql
SELECT count()
FROM case_events_raw
WHERE tenant_id = 10
  AND batch_id = 'bad-batch';
```

### 31.6 Repair Derived Tables

If rollups/MVs were affected:

```text
drop aggregate partitions
recompute from raw
validate counts
```

---

## 32. Decision Matrix

| Need | Preferred Pattern | Avoid |
|---|---|---|
| New event | Insert into MergeTree | UPDATE existing rows |
| Current status change | Append version to ReplacingMergeTree | Per-event ALTER UPDATE |
| Correct historical fact | Correction event / replacement version / rebuild | Silent mutation without audit |
| Delete old data | TTL / DROP PARTITION | Row delete over huge range |
| Delete specific user | Lightweight delete / mutation / anonymization | Assuming TTL solves privacy |
| Dedup retry batch | Insert dedup token | Random event IDs per retry |
| Dedup business event | event_id + Replacing/argMax/refined table | Counting raw duplicates blindly |
| Fix aggregate bug | Rebuild affected aggregate window | UPDATE aggregate rows ad hoc |
| Retract additive event | sign/delta event | Physical delete if audit needed |
| Non-additive correction | Rebuild window | Negative distinct count |
| CDC upsert | raw CDC + Replacing current snapshot | Mirroring OLTP UPDATEs |
| Official report correction | versioned report snapshot/amendment | Overwrite submitted numbers |

---

## 33. Common Anti-Patterns

### 33.1 Treating ClickHouse Like PostgreSQL

Bad:

```sql
UPDATE row whenever business object changes
```

Good:

```text
append event/version
derive current state
```

### 33.2 Using ReplacingMergeTree as Unique Constraint

`ReplacingMergeTree` is eventual. It does not reject duplicates at insert time.

### 33.3 Using FINAL Everywhere

`FINAL` can be useful, but uncontrolled dashboard-wide `FINAL` can be expensive.

### 33.4 Deleting Retention Row-by-Row

Use partition drop or TTL for time retention.

### 33.5 Mutating Raw Table Without Fixing Rollups

Raw delete does not automatically undo previously inserted aggregate rows.

### 33.6 No Stable Event ID

Without stable event ID, dedup is guesswork.

### 33.7 No Batch Metadata

Without batch metadata, bad batch cleanup is painful.

### 33.8 Random UUID on Retry

If retry generates new UUID, duplicate detection fails.

### 33.9 Ignoring Late Events

Dashboards silently drift or become inconsistent.

### 33.10 Storing Too Much PII in Fact Tables

Deletion becomes expensive and risky.

---

## 34. Production Checklist

### Data Modeling

- [ ] Is this append-only, current-state, corrected, or deletable data?
- [ ] Is raw source of truth preserved?
- [ ] Are event IDs stable?
- [ ] Is version monotonic and deterministic?
- [ ] Is tombstone semantics defined?
- [ ] Are correction events modeled?
- [ ] Are PII columns minimized?

### Update Strategy

- [ ] Can update be represented as new event/version?
- [ ] Is `ALTER UPDATE` truly necessary?
- [ ] Is update scope bounded?
- [ ] Are affected partitions known?
- [ ] Is mutation queue monitored?

### Delete Strategy

- [ ] Is deletion retention, privacy, or bad data cleanup?
- [ ] Can partition drop handle it?
- [ ] Can TTL handle it?
- [ ] Is lightweight delete appropriate?
- [ ] Are derived tables/caches/backups handled?
- [ ] Is physical purge expectation documented?

### Deduplication

- [ ] Is retry idempotent?
- [ ] Are dedup tokens stable?
- [ ] Is event-level dedup required?
- [ ] Is `ReplacingMergeTree` key correct?
- [ ] Are duplicates detectable with queries?
- [ ] Is dashboard safe before merge?

### Materialized Views / Rollups

- [ ] What happens if raw row is deleted?
- [ ] What happens if raw row is corrected?
- [ ] Can aggregate be rebuilt?
- [ ] Are non-additive metrics handled correctly?
- [ ] Are report snapshots versioned if needed?

### Java Application

- [ ] Does producer emit stable IDs?
- [ ] Does ingestion batch deterministically?
- [ ] Are retries safe?
- [ ] Is DLQ available?
- [ ] Is source offset stored?
- [ ] Are schema versions tracked?
- [ ] Does query layer avoid uncontrolled `FINAL`?
- [ ] Are heavy mutation operations blocked from request path?

---

## 35. Exercises

### Exercise 1: Case Status Update

Requirement:

```text
Case status changes 100,000 times/day.
Dashboard shows current count by status.
Audit requires full history.
```

Question:

- Should you run `ALTER UPDATE` for each status change?
- What tables do you design?

Expected:

```text
No ALTER UPDATE per change.
Use raw case_events MergeTree + case_current_state ReplacingMergeTree/versioned table.
Dashboard reads latest state.
Audit reads raw events.
```

### Exercise 2: Bad Backfill

Requirement:

```text
A May 2026 backfill was loaded twice.
```

Question:

- How do you repair?

Expected options:

1. if partition aligned and source available: drop May partition and reload;
2. if batch_id available: delete bad batch;
3. if ReplacingMergeTree with event_id/version: load corrected higher version and query latest;
4. rebuild derived rollups.

### Exercise 3: User Erasure

Requirement:

```text
User 123 requests deletion.
Their events exist in raw events and daily rollups.
```

Question:

- Is deleting raw rows enough?

Expected:

```text
No. Need handle raw, derived tables, dictionaries, caches, exports, backups, identity mapping, and physical/logical deletion expectations.
```

### Exercise 4: Duplicate Kafka Replay

Requirement:

```text
Consumer replays offsets 1,000,000 to 1,100,000.
```

Question:

- What makes replay safe?

Expected:

```text
stable event IDs, deterministic batch IDs, source offset metadata, dedup strategy, and reconciliation.
```

### Exercise 5: Distinct Count Correction

Requirement:

```text
One day of user_id data was wrong. DAU rollup uses uniqState.
```

Question:

- Can you subtract wrong unique users easily?

Expected:

```text
Usually no. Rebuild affected rollup window from corrected raw data.
```

---

## 36. Summary

ClickHouse supports updates and deletes, but the best production designs avoid treating it like OLTP.

Core principles:

1. Prefer append-first modeling.
2. Preserve immutable raw events when audit/replay matters.
3. Use `ReplacingMergeTree` for eventual latest/dedup semantics, not immediate uniqueness.
4. Use tombstones for logical deletion/current-state streams.
5. Use correction events for auditability.
6. Use physical mutations for rare, bounded, operational corrections.
7. Use lightweight deletes for targeted logical deletion, understanding physical cleanup is eventual.
8. Use TTL/drop partition for retention.
9. Design stable event IDs and batch IDs for idempotent ingestion.
10. Always repair/rebuild derived tables when raw data changes.
11. Avoid uncontrolled `FINAL`.
12. Model privacy deletion as system-wide lifecycle, not one table operation.

Practical sentence:

> In ClickHouse, mutable analytics is usually not “change the old row”; it is “append the truth needed to derive the correct answer.”

---

## 37. Referensi Belajar Lanjutan

Gunakan dokumentasi resmi ClickHouse sesuai versi yang dipakai:

1. ClickHouse Docs — Updating data overview.
2. ClickHouse Docs — Working with updates.
3. ClickHouse Docs — ReplacingMergeTree guide.
4. ClickHouse Docs — Lightweight deletes.
5. ClickHouse Docs — Delete mutations.
6. ClickHouse Docs — Avoid mutations.
7. ClickHouse Docs — Deduplicating inserts on retries.
8. ClickHouse Docs — Deduplication strategies.
9. ClickHouse Docs — TTL.
10. ClickHouse Docs — system.mutations.
11. ClickHouse Docs — MergeTree table engine.
12. ClickHouse Docs — ReplacingMergeTree.
13. ClickHouse Docs — CollapsingMergeTree.
14. ClickHouse Docs — Materialized views and backfilling.

---

## 38. Status Seri

Part ini adalah:

```text
Part 019 / 034
```

Seri belum selesai.

Part berikutnya:

```text
Part 020 — Distributed ClickHouse I: Shards, Replicas, Distributed Tables, and Query Routing
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-018.md">⬅️ Part 018 — ClickHouse Table Engines Beyond Basic MergeTree</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-020.md">Part 020 — Distributed ClickHouse I: Shards, Replicas, Distributed Tables, and Query Routing ➡️</a>
</div>
