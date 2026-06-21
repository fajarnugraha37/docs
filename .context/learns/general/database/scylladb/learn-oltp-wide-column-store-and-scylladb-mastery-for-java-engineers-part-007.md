# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-007.md

# Part 007 — CQL Deep Dive I: Keyspace, Table, Types, DDL, DML

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `007`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: memahami CQL sebagai interface utama ScyllaDB/Cassandra-compatible database — keyspace, replication, table DDL, primary key syntax, data types, static columns, collections, UDT, INSERT/UPDATE/DELETE, TTL, timestamp, dan schema agreement.

---

## 0. Posisi Part Ini dalam Seri

Sampai part 006 kita sudah membangun mental model dari bawah:

```text
Part 003: cluster distribution
partition key -> token -> replica set

Part 004: ScyllaDB node internals
node -> shard/core -> shard-aware execution

Part 005: modern data distribution
table -> tablets -> tablet replicas -> nodes/shards

Part 006: storage engine
commitlog -> memtable -> SSTable -> compaction
```

Sekarang kita masuk ke bahasa yang digunakan aplikasi:

```text
CQL
```

CQL terlihat seperti SQL, tetapi jangan tertipu.

CQL bukan relational SQL.

CQL adalah bahasa untuk mendefinisikan dan mengakses data dalam model wide-column terdistribusi.

Kalimat penting:

```text
CQL syntax can look familiar.
CQL semantics are distributed wide-column semantics.
```

Jika kamu membawa asumsi SQL terlalu jauh, kamu akan membuat desain ScyllaDB yang buruk.

---

## 1. Apa Itu CQL?

CQL adalah Cassandra Query Language.

ScyllaDB kompatibel dengan banyak aspek Apache Cassandra/CQL, sehingga aplikasi dan driver Cassandra-style dapat digunakan dengan ScyllaDB, walaupun ada detail versi/fitur yang perlu diperhatikan.

CQL menyediakan:

- DDL untuk keyspace/table/type/index,
- DML untuk insert/update/delete/select,
- primary key modeling,
- consistency-level interaction via driver/session,
- TTL/timestamp features,
- collection/UDT support,
- materialized view/index features,
- user/role/security features tergantung konfigurasi.

CQL tidak menyediakan:

- arbitrary joins,
- relational foreign keys,
- SQL optimizer general-purpose,
- global secondary index seperti RDBMS B-tree,
- multi-table transaction umum,
- ad-hoc analytical scanning yang murah,
- constraint system seperti relational database.

---

## 2. CQL Mental Model

Dalam SQL, kamu sering berpikir:

```text
schema -> normalize -> indexes -> optimizer chooses plan
```

Dalam CQL/ScyllaDB, kamu harus berpikir:

```text
query pattern -> table -> primary key -> partition key -> clustering -> bounded read/write
```

CQL table bukan hanya logical relation. Ia adalah physical access path.

Contoh SQL mindset:

```sql
SELECT *
FROM cases
WHERE assignee_id = ?
  AND status = ?
ORDER BY due_at
LIMIT 50;
```

Di SQL, mungkin kamu membuat index:

```text
(status, assignee_id, due_at)
```

Di ScyllaDB, kamu kemungkinan membuat table khusus:

```sql
CREATE TABLE open_cases_by_assignee_bucket (
    assignee_id text,
    bucket_day date,
    bucket_id int,
    due_at timestamp,
    case_id uuid,
    priority int,
    status text,
    title text,
    PRIMARY KEY ((assignee_id, bucket_day, bucket_id), due_at, case_id)
) WITH CLUSTERING ORDER BY (due_at ASC, case_id ASC);
```

Ini bukan hanya “index”. Ini adalah materialized access path yang dikelola aplikasi.

---

## 3. Keyspace

Keyspace adalah namespace dan replication boundary.

Di SQL, keyspace mirip database/schema secara kasar. Tetapi di ScyllaDB, keyspace juga menentukan replication strategy.

Contoh:

```sql
CREATE KEYSPACE regulatory_ks
WITH replication = {
    'class': 'NetworkTopologyStrategy',
    'dc_jakarta': 3
};
```

Untuk multi-DC:

```sql
CREATE KEYSPACE regulatory_ks
WITH replication = {
    'class': 'NetworkTopologyStrategy',
    'dc_jakarta': 3,
    'dc_singapore': 3
};
```

### 3.1 Keyspace Design Questions

Sebelum membuat keyspace:

```text
1. Apa environment? dev/staging/prod?
2. Apa data center names?
3. Apa replication factor per DC?
4. Apakah data residency berbeda?
5. Apakah workload butuh isolation?
6. Apakah backup/restore boundary per keyspace penting?
7. Apakah schema lifecycle sama?
8. Apakah tenant isolation perlu keyspace terpisah?
```

### 3.2 Keyspace-per-Tenant?

Kadang ada ide:

```text
one tenant = one keyspace
```

Ini jarang menjadi default yang baik.

Risiko:

- terlalu banyak schema objects,
- operational overhead,
- migration complexity,
- monitoring complexity,
- connection/schema metadata overhead,
- backup/restore complexity,
- compaction/repair planning lebih rumit.

Lebih umum:

```text
shared keyspace + tenant_id in partition key
```

Kecuali ada alasan kuat:

- regulatory isolation,
- backup/restore per tenant,
- encryption/key management,
- different lifecycle,
- very few large tenants,
- hard tenancy boundary requirement.

---

## 4. Replication Strategy

CQL keyspace replication strategy menentukan replica placement.

### 4.1 SimpleStrategy

Contoh:

```sql
CREATE KEYSPACE dev_ks
WITH replication = {
    'class': 'SimpleStrategy',
    'replication_factor': 1
};
```

Gunakan untuk:

- local development,
- simple test,
- temporary demo.

Jangan jadikan default production.

### 4.2 NetworkTopologyStrategy

Production default biasanya:

```sql
CREATE KEYSPACE app_ks
WITH replication = {
    'class': 'NetworkTopologyStrategy',
    'dc1': 3
};
```

Multi-DC:

```sql
CREATE KEYSPACE app_ks
WITH replication = {
    'class': 'NetworkTopologyStrategy',
    'dc_jakarta': 3,
    'dc_singapore': 3
};
```

Mengapa penting:

- topology-aware,
- RF per DC,
- mendukung LOCAL_QUORUM,
- lebih cocok dengan failure domain.

### 4.3 Replication Factor

RF=3 umum untuk production karena menyeimbangkan:

- durability,
- availability,
- cost.

Tapi RF bukan formula universal.

Pertimbangkan:

- criticality data,
- disk cost,
- write amplification,
- multi-DC,
- repair cost,
- read/write CL,
- failure tolerance.

---

## 5. Durable Writes

Keyspace dapat memiliki opsi durable writes.

Secara umum production menginginkan durable writes aktif.

Jika durable writes dimatikan, commitlog behavior dapat berubah dan crash safety terpengaruh.

Untuk sistem enforcement/regulatory/case management:

```text
Do not casually disable durable writes.
```

Durability adalah bagian dari correctness posture.

---

## 6. Table

Table adalah physical access path.

Contoh minimal:

```sql
CREATE TABLE case_current_by_id (
    case_id uuid PRIMARY KEY,
    status text,
    version bigint,
    assignee_id text,
    updated_at timestamp
);
```

Primary key di sini:

```text
partition key = case_id
no clustering columns
```

Cocok untuk:

```text
read current case state by case_id
```

Tidak cocok untuk:

```text
list cases by assignee
list cases by status
list cases by due date
```

Untuk itu, buat table lain.

---

## 7. Primary Key Syntax

CQL primary key syntax punya makna fisik.

### 7.1 Simple Primary Key

```sql
CREATE TABLE users_by_id (
    user_id uuid PRIMARY KEY,
    email text,
    display_name text
);
```

Equivalent conceptual:

```text
PRIMARY KEY ((user_id))
```

Partition key:

```text
user_id
```

No clustering key.

### 7.2 Composite Primary Key

```sql
CREATE TABLE events_by_case (
    case_id uuid,
    event_time timestamp,
    event_id uuid,
    event_type text,
    payload text,
    PRIMARY KEY (case_id, event_time, event_id)
);
```

Important:

```text
first column before comma = partition key if no extra parentheses
remaining columns = clustering columns
```

So:

```text
partition key = case_id
clustering = event_time, event_id
```

### 7.3 Composite Partition Key

```sql
CREATE TABLE events_by_case_month (
    case_id uuid,
    bucket_month text,
    event_time timestamp,
    event_id uuid,
    event_type text,
    payload text,
    PRIMARY KEY ((case_id, bucket_month), event_time, event_id)
);
```

Here:

```text
partition key = (case_id, bucket_month)
clustering = event_time, event_id
```

Parentheses matter.

### 7.4 Common Mistake

This:

```sql
PRIMARY KEY (case_id, bucket_month, event_time)
```

means:

```text
partition key = case_id
clustering = bucket_month, event_time
```

Not:

```text
partition key = (case_id, bucket_month)
```

To make composite partition key:

```sql
PRIMARY KEY ((case_id, bucket_month), event_time)
```

This mistake can create huge partitions.

---

## 8. Partition Key

Partition key determines:

- token,
- replica set,
- tablet/range,
- data locality,
- distribution,
- hot key risk,
- maximum partition growth.

Good partition key properties:

- high cardinality,
- aligned with query,
- bounded partition size,
- distributes load,
- supports locality needed by read.

Bad partition key examples:

```text
status
country
boolean flag
tenant_id only for huge tenants
date only
global category
```

Good examples depend on access pattern:

```text
case_id
user_id + bucket_day
tenant_id + bucket_day + bucket_id
assignee_id + due_date_bucket + bucket_id
device_id + bucket_hour
```

---

## 9. Clustering Columns

Clustering columns determine ordering inside partition.

Example:

```sql
PRIMARY KEY ((case_id, bucket_month), event_time, event_id)
WITH CLUSTERING ORDER BY (event_time DESC, event_id ASC);
```

Clustering columns support:

- sorting within partition,
- range query within partition,
- latest-N query,
- stable pagination,
- uniqueness within partition.

### 9.1 Clustering Order

Default order is ascending.

You can specify:

```sql
WITH CLUSTERING ORDER BY (event_time DESC);
```

Useful for latest-first reads:

```sql
SELECT *
FROM events_by_case_month
WHERE case_id = ?
  AND bucket_month = ?
LIMIT 100;
```

If clustering order descending by event_time, latest events are physically/read-order friendly.

### 9.2 Clustering Column Restrictions

CQL queries must respect primary key order.

Given:

```sql
PRIMARY KEY ((case_id, bucket_month), event_time, event_id)
```

Good:

```sql
WHERE case_id = ?
  AND bucket_month = ?
```

Good range:

```sql
WHERE case_id = ?
  AND bucket_month = ?
  AND event_time >= ?
  AND event_time < ?
```

Good exact then range:

```sql
WHERE case_id = ?
  AND bucket_month = ?
  AND event_time = ?
  AND event_id > ?
```

Bad:

```sql
WHERE case_id = ?
  AND bucket_month = ?
  AND event_id = ?
```

because it skips `event_time`.

---

## 10. Static Columns

Static columns store one value per partition, shared by all clustering rows.

Example:

```sql
CREATE TABLE case_events_by_case (
    case_id uuid,
    event_time timestamp,
    event_id uuid,
    case_type text static,
    jurisdiction text static,
    event_type text,
    payload text,
    PRIMARY KEY (case_id, event_time, event_id)
);
```

Here:

```text
case_type and jurisdiction are partition-level values.
```

Use static columns for:

- small partition metadata,
- repeated data shared by rows in same partition,
- avoiding duplication inside bounded partition.

Avoid static columns when:

- partition is unbounded,
- static value changes frequently,
- different access pattern needs separate table,
- it creates hidden coupling.

---

## 11. Data Types

Common CQL types:

| Type | Use |
|---|---|
| text/varchar | strings |
| ascii | ASCII-only string |
| int | 32-bit integer |
| bigint | 64-bit integer |
| varint | arbitrary precision integer |
| float/double | floating point |
| decimal | decimal value |
| boolean | true/false |
| uuid | random UUID |
| timeuuid | time-based UUID |
| timestamp | date-time instant |
| date | date without time |
| time | time of day |
| inet | IP address |
| blob | binary data |
| duration | duration value |

### 11.1 UUID vs TimeUUID

`uuid`:

```text
general unique identifier
```

`timeuuid`:

```text
time-based UUID, can help time ordering
```

For event ordering, you may use:

- timestamp + uuid,
- event_version,
- timeuuid,
- logical sequence.

Do not rely blindly on wall-clock time for business ordering if strict ordering matters.

### 11.2 Timestamp

CQL `timestamp` stores a point in time.

Application concern:

- timezone conversion,
- Java `Instant` preferred for absolute instants,
- avoid local date-time ambiguity,
- clock skew matters for write timestamps/conflicts,
- business date may need separate `date`.

### 11.3 Decimal vs Double

For money/regulated numeric values:

```text
avoid floating point for exact money
```

Use decimal/integer minor units depending domain.

Example:

```text
amount_minor bigint
currency text
```

often better than floating money.

---

## 12. Collections

CQL collections:

```text
list<T>
set<T>
map<K,V>
```

Examples:

```sql
tags set<text>
attributes map<text, text>
comments list<text>
```

Collections are convenient for small bounded values.

They are dangerous for unbounded child data.

### 12.1 Good Collection Use

```text
small fixed-size tags
small metadata map
small list of flags
small set of roles
```

### 12.2 Bad Collection Use

```text
all user notifications
all case comments
all audit events
all attachments
all lifecycle history
```

Those should be separate clustering rows/table.

### 12.3 Frozen Collections

`frozen` means collection is serialized as a single value.

Example:

```sql
metadata frozen<map<text, text>>
```

Changing one element may require rewriting whole frozen value.

Non-frozen collections can have per-element storage semantics, but can create tombstone/update complexity.

Rule:

```text
If collection can grow without a small hard limit, do not use collection.
```

---

## 13. User-Defined Types

UDT allows structured values.

Example:

```sql
CREATE TYPE address_type (
    line1 text,
    city text,
    postal_code text,
    country text
);
```

Use:

```sql
CREATE TABLE users_by_id (
    user_id uuid PRIMARY KEY,
    name text,
    address frozen<address_type>
);
```

UDT is useful for:

- small embedded value object,
- stable shape,
- not queried independently,
- bounded size.

Avoid UDT when:

- fields are query dimensions,
- object grows,
- object changes independently,
- versioning is unstable,
- compatibility across services is hard.

For Java services, UDT creates serialization/versioning coupling.

---

## 14. Blob

`blob` can store binary data.

Use carefully.

ScyllaDB is not object storage.

Avoid storing:

- large PDFs,
- images,
- video,
- massive evidence files,
- huge serialized objects.

Better:

```text
object storage for large binary
ScyllaDB for metadata, hash, URI, lifecycle, ACL, audit link
```

Example:

```sql
CREATE TABLE evidence_files_by_case (
    case_id uuid,
    uploaded_at timestamp,
    file_id uuid,
    object_uri text,
    sha256 text,
    content_type text,
    size_bytes bigint,
    PRIMARY KEY (case_id, uploaded_at, file_id)
);
```

---

## 15. INSERT

CQL insert:

```sql
INSERT INTO case_current_by_id (
    case_id,
    status,
    version,
    updated_at
) VALUES (?, ?, ?, ?);
```

In Cassandra-compatible semantics, INSERT and UPDATE are both upsert-like mutations unless conditional logic is used.

Meaning:

```text
If row does not exist, create it.
If row exists, update specified columns.
```

This surprises SQL engineers.

### 15.1 INSERT Is Not Always “Fail If Exists”

This:

```sql
INSERT INTO users_by_id (user_id, email)
VALUES (?, ?);
```

does not automatically fail if `user_id` exists.

To enforce insert-if-absent:

```sql
INSERT INTO users_by_id (user_id, email)
VALUES (?, ?)
IF NOT EXISTS;
```

That uses LWT/conditional semantics and has performance cost.

---

## 16. UPDATE

CQL update:

```sql
UPDATE case_current_by_id
SET status = ?,
    version = ?,
    updated_at = ?
WHERE case_id = ?;
```

It writes mutation for specified columns.

It does not require previous row to exist.

This can create row if primary key specified and no row existed, depending columns/tombstones.

### 16.1 Partial Update

You can update one column:

```sql
UPDATE case_current_by_id
SET assignee_id = ?
WHERE case_id = ?;
```

But partial updates need domain care.

If multiple services update different columns independently, you may create hidden race/cell-level last-write-wins behavior.

Better:

- define ownership per column/table,
- use command handler,
- use version field/LWT for state transitions,
- avoid many writers to same row without protocol.

---

## 17. DELETE

Delete writes tombstone.

Examples:

```sql
DELETE FROM case_current_by_id
WHERE case_id = ?;
```

Delete specific columns:

```sql
DELETE assignee_id
FROM case_current_by_id
WHERE case_id = ?;
```

Delete range within partition:

```sql
DELETE FROM events_by_case_month
WHERE case_id = ?
  AND bucket_month = ?
  AND event_time < ?;
```

Range deletes can create range tombstones.

### 17.1 Delete Is a Write

Do not treat delete as free.

It affects:

- tombstones,
- read path,
- compaction,
- repair,
- zombie risk if repair/gc grace mishandled.

For high-volume lifecycle expiration, prefer time-bucketed tables and compaction strategy aligned with TTL/retention.

---

## 18. SELECT

Basic:

```sql
SELECT status, version
FROM case_current_by_id
WHERE case_id = ?;
```

Good because full partition key.

Range within partition:

```sql
SELECT *
FROM events_by_case_month
WHERE case_id = ?
  AND bucket_month = ?
  AND event_time >= ?
  AND event_time < ?
LIMIT 100;
```

Good because:

- full partition key,
- clustering range,
- limit.

Bad:

```sql
SELECT *
FROM case_current_by_id
WHERE status = 'OPEN';
```

unless status is part of primary key or indexed/materialized view designed for this.

### 18.1 SELECT * Discipline

Avoid `SELECT *` in service code unless row shape is small and intentional.

Prefer explicit columns:

```sql
SELECT status, version, updated_at
FROM case_current_by_id
WHERE case_id = ?;
```

Benefits:

- less network,
- less Java heap,
- clearer contract,
- safer schema evolution.

---

## 19. WHERE Rules

CQL WHERE clause is constrained by primary key.

General rules:

1. Partition key must be specified for efficient single-partition query.
2. Composite partition key requires all components unless using special cases/token queries.
3. Clustering columns must be restricted in order.
4. Range condition usually allowed on last restricted clustering component.
5. You cannot skip earlier clustering columns.
6. Non-key filtering is not allowed unless indexed or `ALLOW FILTERING`.

Given:

```sql
PRIMARY KEY ((tenant_id, bucket_day, bucket_id), created_at, case_id)
```

Good:

```sql
WHERE tenant_id = ?
  AND bucket_day = ?
  AND bucket_id = ?
```

Good:

```sql
WHERE tenant_id = ?
  AND bucket_day = ?
  AND bucket_id = ?
  AND created_at >= ?
  AND created_at < ?
```

Bad:

```sql
WHERE tenant_id = ?
  AND bucket_day = ?
```

because composite partition key missing `bucket_id`.

Bad:

```sql
WHERE tenant_id = ?
  AND bucket_day = ?
  AND bucket_id = ?
  AND case_id = ?
```

because skips `created_at`.

---

## 20. ALLOW FILTERING

`ALLOW FILTERING` tells database:

```text
I accept that this query may scan/filter data inefficiently.
```

Example:

```sql
SELECT *
FROM cases_by_assignee
WHERE assignee_id = ?
  AND status = 'OPEN'
ALLOW FILTERING;
```

It may work in dev and fail in production.

`ALLOW FILTERING` is sometimes acceptable for:

- tiny tables,
- admin-only bounded data,
- one-off controlled maintenance,
- explicit offline job with limits.

It is usually unacceptable for:

- online API,
- tenant-scale query,
- unbounded table,
- high-QPS path,
- latency-sensitive path.

Rule:

```text
If production endpoint needs ALLOW FILTERING, data model is probably wrong.
```

---

## 21. LIMIT

Always think about limits.

```sql
SELECT *
FROM events_by_case_month
WHERE case_id = ?
  AND bucket_month = ?
LIMIT 100;
```

Limit controls returned rows, but not always total work if query must skip tombstones or scan broad ranges.

Better:

- bounded partition,
- clustering range,
- limit,
- page size,
- no tombstone-heavy scan.

LIMIT is necessary but not sufficient.

---

## 22. ORDER BY

CQL `ORDER BY` works only within partition and follows clustering column design.

Given:

```sql
PRIMARY KEY ((case_id, bucket_month), event_time, event_id)
WITH CLUSTERING ORDER BY (event_time DESC, event_id ASC);
```

You can get latest events efficiently.

But CQL cannot arbitrarily sort global table by any column like SQL.

Bad expectation:

```sql
SELECT *
FROM cases
ORDER BY updated_at DESC
LIMIT 100;
```

In ScyllaDB, model a table for that access pattern.

---

## 23. TTL

TTL sets expiration.

Insert with TTL:

```sql
INSERT INTO idempotency_keys_by_command (
    command_id,
    created_at,
    entity_id
) VALUES (?, ?, ?)
USING TTL 86400;
```

Update with TTL:

```sql
UPDATE sessions_by_token
USING TTL 3600
SET user_id = ?, updated_at = ?
WHERE token = ?;
```

### 23.1 TTL Design Rules

Use TTL when:

- data naturally expires,
- retention is short/bounded,
- query avoids expired tombstone scans,
- compaction strategy matches expiration pattern.

Avoid TTL when:

- authoritative audit data,
- legal hold may override deletion,
- random expiration creates tombstone churn,
- table mixes permanent and expiring data badly,
- you need explicit deletion workflow.

For regulatory systems, TTL must be aligned with retention policy and legal/compliance needs.

---

## 24. Timestamp

CQL supports write timestamp:

```sql
INSERT INTO table (...)
VALUES (...)
USING TIMESTAMP ?;
```

This controls mutation timestamp used in conflict resolution.

Be careful.

If application supplies timestamps incorrectly:

- older writes may be ignored,
- newer stale writes may overwrite valid state,
- clock skew can cause anomalies,
- retry with different timestamp can change behavior.

Default server-side/client-side timestamp behavior depends on driver/config.

### 24.1 Application-Supplied Timestamp

Use only if you understand:

- idempotency,
- event time vs write time,
- conflict resolution,
- clock source,
- retry behavior,
- ordering requirements.

For business ordering, prefer explicit version/sequence where needed.

---

## 25. Batch

CQL supports batch:

```sql
BEGIN BATCH
INSERT INTO table1 (...) VALUES (...);
INSERT INTO table2 (...) VALUES (...);
APPLY BATCH;
```

But batch in Cassandra/ScyllaDB is often misunderstood.

It is not a general performance optimization.

Batch can be appropriate when:

- mutations belong to same partition,
- atomicity/logical grouping is needed within supported semantics,
- batch size is small.

Danger:

- batching many partitions,
- using batch to improve throughput,
- huge batches,
- cross-node coordinator pressure,
- logged batch overhead.

Deep batching discussion is part 022.

For now:

```text
Do not use CQL batch as JDBC batch replacement.
```

---

## 26. Lightweight Transactions Preview

Conditional statements:

```sql
INSERT INTO users_by_email (email, user_id)
VALUES (?, ?)
IF NOT EXISTS;
```

or:

```sql
UPDATE case_current_by_id
SET status = ?, version = ?
WHERE case_id = ?
IF status = ? AND version = ?;
```

These are LWT/CAS operations.

Use for:

- uniqueness,
- compare-and-set,
- conditional state transition.

Cost:

- more coordination,
- higher latency,
- lower throughput,
- not suitable for hot high-QPS path unless carefully justified.

Deep LWT is part 014.

---

## 27. Counters Preview

Counters:

```sql
CREATE TABLE page_views_by_url (
    url text PRIMARY KEY,
    views counter
);
```

Update:

```sql
UPDATE page_views_by_url
SET views = views + 1
WHERE url = ?;
```

Counters have special semantics and limitations.

Be careful with retries:

```text
timeout + retry can double increment
```

Counters are not a free exact analytics solution.

Deep counters are part 018.

---

## 28. Table Options

CQL table options affect storage/behavior.

Examples:

```sql
WITH compaction = {'class': 'SizeTieredCompactionStrategy'}
AND compression = {'sstable_compression': 'LZ4Compressor'}
AND default_time_to_live = 0
AND gc_grace_seconds = 864000;
```

Common options:

- compaction,
- compression,
- caching,
- default TTL,
- gc_grace_seconds,
- clustering order,
- bloom filter fp chance,
- speculative retry options depending version,
- tablets-related options depending version.

Do not copy table options blindly.

Options encode workload assumptions.

---

## 29. Naming Conventions

Use table names that reveal access pattern.

Good:

```text
case_current_by_id
case_events_by_case_month
open_cases_by_assignee_day_bucket
idempotency_keys_by_command
notifications_by_user_day
tenant_events_by_tenant_day_bucket
```

Bad:

```text
cases
events
data
records
lookup
main_table
```

CQL table name should answer:

```text
What query is this table for?
```

This is especially important because one logical entity often has multiple physical tables.

---

## 30. Source of Truth vs Derived Table in CQL Names

Name derived tables explicitly.

Example:

```text
case_events_by_case_month        authoritative event log
case_current_by_id               current snapshot
open_cases_by_assignee_bucket    derived serving view
```

Maybe document in schema comments/external docs:

```text
source_of_truth: case_events_by_case_month
rebuildable: open_cases_by_assignee_bucket
```

CQL itself will not enforce this. Your engineering process must.

---

## 31. Schema Agreement

Schema changes are distributed metadata changes.

When you run:

```sql
ALTER TABLE ...
```

all nodes must learn the new schema.

Schema agreement means the cluster converged on same schema version.

Operational rules:

- avoid rapid repeated schema changes,
- deploy migrations carefully,
- maintain backward/forward compatibility,
- do not deploy app that assumes new column before schema exists,
- do not drop column while old app still writes it,
- monitor schema agreement.

Deep schema evolution is part 023.

---

## 32. ALTER TABLE

Examples:

```sql
ALTER TABLE case_current_by_id
ADD escalation_level int;
```

Adding a nullable column is generally easier than changing primary key.

Important:

```text
You cannot casually change primary key of existing table.
```

If access pattern changes, create new table and migrate/backfill.

Bad expectation:

```sql
ALTER TABLE cases ADD INDEX-LIKE PRIMARY KEY BY status;
```

No. Need new table:

```text
cases_by_status_bucket
```

### 32.1 Drop Column

```sql
ALTER TABLE case_current_by_id
DROP old_field;
```

Dropping column has storage/schema implications.

Be careful:

- old data/tombstones,
- old app versions,
- serialization expectations,
- backup/restore,
- rollback.

---

## 33. CREATE INDEX Preview

CQL:

```sql
CREATE INDEX ON case_current_by_id (status);
```

Do not equate this to SQL B-tree index.

Secondary indexes in ScyllaDB/Cassandra-style systems have different cost model and constraints.

Use carefully.

Often better:

```text
dedicated table for access pattern
```

Deep indexes/materialized views are part 017.

---

## 34. Materialized View Preview

CQL supports materialized views in some Cassandra-compatible systems.

Conceptually:

```text
base table -> automatically maintained alternate primary key view
```

But views have complexity:

- consistency,
- build/backfill,
- write amplification,
- operational behavior,
- limitations.

ScyllaDB materialized views will be covered later.

For top-tier design, do not use MV as magic replacement for explicit data modeling.

---

## 35. CQL Is Not a Query Optimizer Contract

SQL mindset:

```text
Write query, optimizer finds plan.
```

CQL mindset:

```text
Design table to make query obvious.
```

If query does not map to primary key/index/view, database will not invent efficient distributed plan.

This is a feature, not a bug.

It forces predictability.

Distributed OLTP at scale prefers:

```text
known query -> known partition -> known replica -> bounded work
```

over:

```text
ad-hoc query -> cluster scan -> unpredictable p99
```

---

## 36. Java Driver Mapping

CQL types map to Java types.

Examples:

| CQL | Java typical |
|---|---|
| text | String |
| uuid | UUID |
| timestamp | Instant |
| date | LocalDate |
| time | LocalTime/long depending driver |
| int | Integer/int |
| bigint | Long/long |
| boolean | Boolean/boolean |
| decimal | BigDecimal |
| blob | ByteBuffer |
| list/set/map | Java collections |
| UDT | mapped object/UDTValue depending driver |

Java design tips:

- use `Instant` for absolute timestamp,
- avoid `Date` if modern Java time available,
- avoid mutable shared collections,
- validate payload size before writing,
- avoid mapping huge result sets into lists,
- use prepared statements,
- bind values with correct types.

---

## 37. Prepared Statements

Use prepared statements for application queries.

Benefits:

- query parsing/planning reuse,
- driver metadata,
- routing key extraction,
- type safety-ish binding,
- less string construction,
- safer from injection-like mistakes,
- better performance.

Bad:

```java
String cql = "SELECT * FROM case_current_by_id WHERE case_id = " + id;
session.execute(cql);
```

Good:

```java
PreparedStatement ps = session.prepare(
    "SELECT status, version, updated_at FROM case_current_by_id WHERE case_id = ?"
);
BoundStatement bs = ps.bind(caseId);
session.execute(bs);
```

Prepared statement should be prepared once and reused, not prepared per request.

---

## 38. Consistency Level Is Usually Driver-Side

CQL text itself often does not include consistency level.

Java driver statement/session config controls it.

Example conceptual:

```java
BoundStatement stmt = ps.bind(caseId)
    .setConsistencyLevel(DefaultConsistencyLevel.LOCAL_QUORUM);
```

Consistency level should be part of repository contract.

Example:

```java
CaseCurrent readAuthoritative(CaseId id); // LOCAL_QUORUM
CaseCurrent readPossiblyStale(CaseId id); // LOCAL_ONE
```

Do not hide everything behind generic CRUD.

---

## 39. CQL Anti-Patterns

### 39.1 Generic CRUD Repository

Bad:

```java
interface CrudRepository<T, ID> {
    T save(T t);
    Optional<T> findById(ID id);
    List<T> findAll();
    List<T> findBy(Map<String, Object> filters);
}
```

ScyllaDB needs access-pattern-specific repositories.

### 39.2 One Table Per Entity

Bad:

```text
cases table handles all case queries
```

Better:

```text
case_current_by_id
case_events_by_case_month
open_cases_by_assignee_bucket
cases_by_status_bucket
cases_due_by_day_bucket
```

### 39.3 Unbounded SELECT

Bad:

```sql
SELECT * FROM events_by_case WHERE case_id = ?;
```

without limit/range and with unbounded partition.

### 39.4 Misplaced Composite Key Parentheses

Bad:

```sql
PRIMARY KEY (tenant_id, bucket_day, created_at)
```

when intended:

```sql
PRIMARY KEY ((tenant_id, bucket_day), created_at)
```

### 39.5 Blind TTL

Bad:

```sql
default_time_to_live = 2592000
```

on mixed authoritative and derived data without retention analysis.

### 39.6 Cross-Partition Batch for Throughput

Bad:

```sql
BEGIN BATCH
INSERT partition A
INSERT partition B
INSERT partition C
...
APPLY BATCH;
```

as performance trick.

---

## 40. Example Schema: Case Lifecycle

### 40.1 Authoritative Event Log

```sql
CREATE TABLE case_events_by_case_month (
    case_id uuid,
    bucket_month text,
    event_version bigint,
    event_id uuid,
    event_time timestamp,
    event_type text,
    actor_id uuid,
    payload text,
    PRIMARY KEY ((case_id, bucket_month), event_version, event_id)
) WITH CLUSTERING ORDER BY (event_version DESC, event_id ASC);
```

Why:

- partition by case + month,
- clustering by version for deterministic order,
- latest/range reads bounded,
- event_id for uniqueness/tie-break,
- append-friendly.

### 40.2 Current State

```sql
CREATE TABLE case_current_by_id (
    case_id uuid PRIMARY KEY,
    status text,
    version bigint,
    assignee_id uuid,
    priority int,
    updated_at timestamp,
    last_event_id uuid
);
```

Why:

- read by case_id,
- small row,
- current snapshot,
- may be updated by command handler.

### 40.3 Derived Assignee View

```sql
CREATE TABLE open_cases_by_assignee_day_bucket (
    assignee_id uuid,
    bucket_day date,
    bucket_id int,
    due_at timestamp,
    case_id uuid,
    priority int,
    status text,
    title text,
    PRIMARY KEY ((assignee_id, bucket_day, bucket_id), due_at, case_id)
) WITH CLUSTERING ORDER BY (due_at ASC, case_id ASC);
```

Why:

- list open cases by assignee,
- bucket avoids hot/large partition,
- derived/rebuildable.

---

## 41. Example Queries

### 41.1 Read Current Case

```sql
SELECT status, version, assignee_id, priority, updated_at
FROM case_current_by_id
WHERE case_id = ?;
```

Properties:

- single partition,
- bounded row,
- good for LOCAL_QUORUM if authoritative.

### 41.2 Latest Events for Case/Month

```sql
SELECT event_version, event_id, event_time, event_type, actor_id, payload
FROM case_events_by_case_month
WHERE case_id = ?
  AND bucket_month = ?
LIMIT 100;
```

Properties:

- single partition,
- clustering order DESC,
- bounded result.

### 41.3 Open Cases by Assignee

```sql
SELECT due_at, case_id, priority, status, title
FROM open_cases_by_assignee_day_bucket
WHERE assignee_id = ?
  AND bucket_day = ?
  AND bucket_id = ?
LIMIT 50;
```

To query all buckets:

```text
issue N bounded queries
merge client-side
limit final result
```

This is deliberate fanout, not accidental scan.

---

## 42. Handling “Find by Status”

Requirement:

```text
Find latest 100 OPEN cases globally.
```

Bad:

```sql
SELECT * FROM case_current_by_id WHERE status = 'OPEN' ALLOW FILTERING;
```

Better:

```sql
CREATE TABLE open_cases_by_status_day_bucket (
    status text,
    bucket_day date,
    bucket_id int,
    updated_at timestamp,
    case_id uuid,
    title text,
    assignee_id uuid,
    PRIMARY KEY ((status, bucket_day, bucket_id), updated_at, case_id)
) WITH CLUSTERING ORDER BY (updated_at DESC, case_id ASC);
```

But ask:

```text
Is global OPEN list actually needed?
Who uses it?
How many rows?
How fresh?
How paginated?
How many buckets?
What is cleanup when case closes?
Can stale rows appear?
How reconcile?
```

Data model follows product/access requirements.

---

## 43. Handling Idempotency Keys

Use case:

```text
Prevent duplicate command execution.
```

Table:

```sql
CREATE TABLE command_idempotency_by_id (
    command_id uuid PRIMARY KEY,
    entity_id uuid,
    command_type text,
    created_at timestamp,
    status text
) WITH default_time_to_live = 86400;
```

Strict insert:

```sql
INSERT INTO command_idempotency_by_id (
    command_id,
    entity_id,
    command_type,
    created_at,
    status
) VALUES (?, ?, ?, ?, ?)
IF NOT EXISTS;
```

This uses LWT.

Design questions:

- Is 24h TTL enough?
- What about retry after TTL?
- Is command_id client-generated?
- Is this table source-of-truth?
- What happens on LWT timeout?
- What CL/SERIAL CL?
- What metrics detect contention?

---

## 44. Handling Sessions

Use case:

```text
session by token
```

Table:

```sql
CREATE TABLE sessions_by_token (
    token text PRIMARY KEY,
    user_id uuid,
    created_at timestamp,
    expires_at timestamp,
    metadata map<text, text>
) WITH default_time_to_live = 3600;
```

Good if:

- session rows small,
- TTL aligned,
- reads by token,
- expiration expected.

Cautions:

- TTL creates tombstones,
- high churn table needs compaction/retention care,
- metadata map must be bounded,
- auth systems may need stronger revocation semantics.

---

## 45. CQL Review Checklist

For each table:

```text
[ ] Does name reveal access pattern?
[ ] Is partition key explicit and high-cardinality?
[ ] Is partition size bounded?
[ ] Are clustering columns aligned with sort/range query?
[ ] Are composite partition key parentheses correct?
[ ] Are static columns justified?
[ ] Are collections bounded?
[ ] Are UDTs stable and small?
[ ] Are blobs avoided for large files?
[ ] Is TTL intentional?
[ ] Is delete/tombstone behavior understood?
[ ] Is table source-of-truth or derived?
[ ] Are reads bounded by LIMIT/range?
[ ] Is ALLOW FILTERING absent from online path?
[ ] Are table options chosen for workload?
[ ] Is schema migration plan known?
```

For each query:

```text
[ ] Full partition key supplied?
[ ] Clustering restrictions in order?
[ ] Result size bounded?
[ ] Page size controlled?
[ ] Consistency level chosen?
[ ] Prepared statement used?
[ ] Retry safety known?
[ ] Timeout semantics documented?
```

---

## 46. Mental Model Compression

Remember:

```text
CQL table = physical query path.
Primary key = distribution + storage ordering contract.
Partition key = where data lives.
Clustering key = how data is ordered inside partition.
```

And:

```text
CQL looks like SQL but does not behave like relational SQL.
```

If a query is important, design a table for it.

---

## 47. Summary

CQL is the operational language of ScyllaDB, but its semantics are wide-column and distributed.

Key lessons:

1. Keyspace defines namespace and replication.
2. NetworkTopologyStrategy is production-oriented.
3. Table is a physical access path.
4. Primary key syntax determines partition and clustering behavior.
5. Parentheses in composite primary key matter enormously.
6. Partition key controls distribution and hot partition risk.
7. Clustering key controls ordering/range inside partition.
8. Static columns are per-partition values.
9. Collections and UDTs are for small bounded structures.
10. INSERT and UPDATE are upsert-like mutations.
11. DELETE writes tombstones.
12. TTL creates expiration/tombstone behavior.
13. SELECT must follow primary key/query model.
14. ALLOW FILTERING is a production smell.
15. LIMIT helps but does not fix bad query shape.
16. BATCH is not JDBC batch replacement.
17. LWT/counters/indexes require special care.
18. Schema changes are distributed operations.
19. Java repositories should be access-pattern-specific.
20. Prepared statements and explicit consistency are mandatory production habits.

---

## 48. Review Questions

1. Apa perbedaan CQL dan SQL secara mental model?
2. Apa fungsi keyspace?
3. Kenapa NetworkTopologyStrategy biasanya lebih cocok untuk production?
4. Apa arti RF?
5. Apa perbedaan RF dan CL?
6. Apa arti `PRIMARY KEY (a, b, c)`?
7. Apa arti `PRIMARY KEY ((a, b), c)`?
8. Kenapa parentheses di composite partition key sangat penting?
9. Apa fungsi clustering column?
10. Apa fungsi clustering order?
11. Apa itu static column?
12. Kapan collection aman digunakan?
13. Kapan UDT sebaiknya dihindari?
14. Kenapa INSERT tidak otomatis fail jika row sudah ada?
15. Kenapa DELETE adalah write?
16. Kenapa TTL tidak gratis?
17. Kenapa `ALLOW FILTERING` berbahaya?
18. Kenapa `LIMIT` tidak cukup untuk memperbaiki query buruk?
19. Kenapa batch bukan performance optimization umum?
20. Bagaimana consistency level dikontrol dari Java driver?

---

## 49. Practical Exercise

Design CQL schema untuk:

```text
Regulatory case management:
- read current case by id
- append case event
- read latest 100 events by case
- list open cases by assignee
- prevent duplicate command execution
```

Tuliskan:

```text
1. Table names.
2. CREATE TABLE for each.
3. Partition key.
4. Clustering key.
5. Which table is source-of-truth?
6. Which table is derived?
7. Query for each access pattern.
8. Consistency level candidate.
9. TTL usage, if any.
10. Tombstone risk.
11. Idempotency strategy.
12. Which queries require fanout?
13. What limits/page size?
14. What Java repository methods?
15. What schema migration concerns?
```

---

## 50. Preview Part 008

Part berikutnya akan membedah primary key design lebih dalam:

```text
partition key
composite partition key
clustering key
clustering order
query validity rules
range query
cardinality
hot partition
large partition
pagination
physical query shape
```

Part 007 memperkenalkan CQL syntax.

Part 008 akan menjadikan primary key design sebagai skill utama.

---

# End of Part 007

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-006.md">⬅️ Part 006 — Storage Engine Internals: Commitlog, Memtable, SSTable, Cache, dan Flush</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-008.md">Part 008 — Primary Key Design: Partition Key, Clustering Key, dan Physical Query Shape ➡️</a>
</div>
