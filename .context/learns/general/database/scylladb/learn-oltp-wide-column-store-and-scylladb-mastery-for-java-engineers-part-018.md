# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-018.md

# Part 018 — Counters, Atomicity Boundaries, Static Columns, Collections, dan UDT

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `018`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: memahami fitur CQL yang sering terlihat sederhana tetapi memiliki cost model dan correctness semantics khusus: counters, atomicity boundary, static columns, collections, frozen/non-frozen values, UDT, retry ambiguity, tombstones, schema evolution, dan Java mapping pitfalls.

---

## 0. Posisi Part Ini dalam Seri

Part 017 membahas alternate access path:

```text
secondary indexes
local secondary indexes
materialized views
explicit derived tables
```

Part ini membahas fitur data modeling CQL yang sering dipakai untuk “mempermudah” schema:

```text
counter
static column
collection
UDT
frozen value
```

Fitur-fitur ini berguna, tetapi berbahaya jika dipakai dengan mental model SQL/JSON/ORM.

Kesalahan umum:

```text
1. memakai counter untuk exact business money/count
2. retry counter increment setelah timeout
3. menyimpan unbounded list/map/set dalam satu row
4. overwrite collection besar setiap update
5. memakai UDT seperti nested document besar
6. mengandalkan static column tanpa memahami partition scope
7. mengira update beberapa row/table atomic
8. memakai mapper Java yang menulis null/collection penuh
```

Part ini mengajarkan batasnya.

---

## 1. CQL Feature Convenience vs Production Cost

CQL menyediakan fitur yang terlihat nyaman:

```sql
views counter
tags set<text>
attributes map<text, text>
address frozen<address_type>
case_type text static
```

Tetapi di distributed LSM storage:

```text
convenience != free
```

Setiap fitur punya konsekuensi:

- read path,
- write path,
- tombstone lifecycle,
- retry semantics,
- compaction,
- schema evolution,
- Java serialization,
- concurrency model.

Top-tier engineer bertanya:

```text
What is the storage and failure semantics of this feature?
```

bukan hanya:

```text
Can CQL syntax express it?
```

---

## 2. Atomicity Boundary: Dasar Sebelum Fitur

Sebelum membahas counters/collections, kita harus jelas tentang atomicity boundary.

Di ScyllaDB/Cassandra-style database:

```text
single mutation to one row/partition has certain atomicity properties
but system is not general multi-table SQL transaction engine
```

Normal write:

```sql
UPDATE table
SET a = ?, b = ?
WHERE pk = ?;
```

Kolom `a` dan `b` dalam mutation yang sama diterapkan sebagai satu logical mutation untuk row/partition tersebut.

Tetapi:

```text
write table A
write table B
```

bukan transaksi atomic umum.

Dan:

```text
read-modify-write without LWT
```

bisa race.

### 2.1 Atomicity Questions

Untuk setiap desain, tanya:

```text
1. Apakah invariant berada dalam satu row?
2. Apakah invariant berada dalam satu partition?
3. Apakah invariant melibatkan banyak table?
4. Apakah perlu compare-and-set?
5. Apakah retry bisa duplicate?
6. Apakah conflict bisa diselesaikan eventual?
```

Jika invariant lebih luas daripada satu row/partition, fitur CQL kecil tidak otomatis menyelamatkan.

---

## 3. Counters

Counter adalah tipe khusus untuk increment/decrement.

Example:

```sql
CREATE TABLE page_views_by_url (
    url text PRIMARY KEY,
    views counter
);
```

Increment:

```sql
UPDATE page_views_by_url
SET views = views + 1
WHERE url = ?;
```

Counter terlihat ideal untuk:

```text
views
likes
counts
metrics
dashboard numbers
```

Tetapi counter punya semantics khusus.

---

## 4. Counter Table Restrictions

Counter columns tidak bisa dicampur bebas dengan regular columns seperti table biasa.

Biasanya counter table berisi:

```text
primary key columns
counter columns
```

Bukan arbitrary regular payload columns.

Example:

```sql
CREATE TABLE case_counts_by_status (
    tenant_id uuid,
    bucket_day date,
    status text,
    count_value counter,
    PRIMARY KEY ((tenant_id, bucket_day), status)
);
```

Counter update:

```sql
UPDATE case_counts_by_status
SET count_value = count_value + 1
WHERE tenant_id = ?
  AND bucket_day = ?
  AND status = ?;
```

---

## 5. Counter Retry Ambiguity

Counter increment is not idempotent.

If client sends:

```sql
count_value = count_value + 1
```

and gets timeout, outcome unknown.

Possible:

```text
increment applied
increment not applied
increment applied but response lost
```

If client retries:

```text
could increment twice
```

This is the core counter danger.

Consistency level does not fix this.

LWT usually not used to make counter increment exactly once at high throughput.

---

## 6. Counter Example: Bad Exact Business Count

Requirement:

```text
exact count of open regulatory cases by status
```

Naive:

```sql
UPDATE case_counts_by_status
SET count_value = count_value + 1
WHERE tenant_id = ? AND bucket_day = ? AND status = 'OPEN';
```

When case closes:

```sql
UPDATE case_counts_by_status
SET count_value = count_value - 1
WHERE tenant_id = ? AND bucket_day = ? AND status = 'OPEN';
```

Problems:

- retry can double increment/decrement,
- partial failure across state update and counter update,
- missed decrement creates drift,
- concurrent transitions,
- reconciliation needed,
- legal/operational correctness questionable.

Better options:

- derive count from idempotent events,
- periodic batch recompute,
- aggregate projection with event_id dedupe,
- OLAP/ClickHouse,
- approximate count with documented semantics.

---

## 7. When Counters Are Acceptable

Counters can be acceptable when:

```text
1. approximate count is okay
2. over/under-count from retry is tolerable
3. reconciliation exists
4. not used for money/legal invariant
5. QPS/partition heat is controlled
6. users understand semantics
```

Examples:

- approximate page views,
- non-critical popularity score,
- metrics preview,
- eventually corrected dashboard,
- rate-ish counters with tolerance.

Not good for:

- account balance,
- inventory decrement,
- legal case count,
- command execution exactly-once,
- payment amount,
- quota enforcement without careful protocol.

---

## 8. Sharded Counters

To avoid hot counter partition, shard counter:

```sql
CREATE TABLE page_views_by_url_shard (
    url text,
    shard_id int,
    views counter,
    PRIMARY KEY ((url, shard_id))
);
```

Increment:

```text
shard_id = hash(request_id) % N
increment one shard
```

Read:

```text
read N shards
sum in application
```

Trade-off:

- spreads writes,
- read fanout,
- retry ambiguity remains,
- changing N complex,
- exactness still hard.

Sharded counter improves heat, not idempotency.

---

## 9. Idempotent Counting Alternative

Instead of counter increment, store idempotent events:

```sql
CREATE TABLE case_status_events_by_day (
    tenant_id uuid,
    bucket_day date,
    event_id uuid,
    case_id uuid,
    old_status text,
    new_status text,
    event_time timestamp,
    PRIMARY KEY ((tenant_id, bucket_day), event_time, event_id)
);
```

Then aggregate via stream/batch:

```text
event_id ensures dedupe
count projection can be rebuilt
```

For dashboard:

```text
count may lag but can be corrected
```

For exact legal report:

```text
run batch/OLAP over source events
```

This often beats counters for correctness.

---

## 10. Counter Decision Checklist

Before using counter:

```text
[ ] Is exactness required?
[ ] What happens on timeout retry?
[ ] Can duplicate increment happen?
[ ] Is decrement required?
[ ] Can counter drift be reconciled?
[ ] Is write key hot?
[ ] Is sharding needed?
[ ] Is read fanout acceptable?
[ ] Is CL chosen deliberately?
[ ] Is this better served by events/OLAP?
```

If exactness matters, avoid simple counter.

---

## 11. Static Columns

Static columns store one value per partition, shared by all clustering rows.

Example:

```sql
CREATE TABLE case_events_by_case_month (
    tenant_id uuid,
    case_id uuid,
    bucket_month text,
    event_version bigint,
    event_id uuid,
    case_title text static,
    case_type text static,
    event_type text,
    payload text,
    PRIMARY KEY ((tenant_id, case_id, bucket_month), event_version, event_id)
);
```

Here:

```text
case_title and case_type exist once per partition
```

not once per event row.

---

## 12. Static Column Use Cases

Static columns are useful for:

```text
partition-level metadata
small repeated values
partition summary
header info
```

Examples:

- case metadata for event partition,
- device metadata for readings partition,
- bucket summary,
- parent object small fields.

Good when:

- partition is bounded,
- static value applies to all rows,
- value is small,
- update frequency low,
- query commonly needs metadata with rows.

---

## 13. Static Column Pitfalls

### 13.1 Hidden Partition Coupling

Static column belongs to partition, not entity globally.

If partition key includes bucket:

```text
(case_id, bucket_month)
```

then static column duplicated per month.

Changing case title means updating every month partition if you expect consistency.

### 13.2 Frequent Static Updates

If static column changes often, it creates writes/tombstones across partitions.

### 13.3 Large Static Payload

Do not store huge JSON/static blob as partition metadata.

### 13.4 Misunderstood Scope

Static column is not global per `case_id` if partition key is `(case_id, bucket_month)`.

Scope is full partition key.

---

## 14. Static Column Example: Good

Table:

```sql
CREATE TABLE device_readings_by_device_hour (
    tenant_id uuid,
    device_id uuid,
    bucket_hour timestamp,
    reading_time timestamp,
    reading_id uuid,
    device_type text static,
    unit text static,
    value double,
    PRIMARY KEY ((tenant_id, device_id, bucket_hour), reading_time, reading_id)
);
```

If `device_type` and `unit` rarely change and apply to readings in that hour, okay.

But if device metadata changes independently, better store:

```text
device_current_by_id
```

and join in application if needed.

---

## 15. Collections

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

Collections are tempting because they feel like JSON arrays/maps.

Rule:

```text
Collections are for small bounded values, not unbounded child tables.
```

---

## 16. Set

Set stores unique values.

Example:

```sql
CREATE TABLE user_profile_by_id (
    user_id uuid PRIMARY KEY,
    roles set<text>
);
```

Use if:

- small number of roles/tags,
- bounded cardinality,
- not frequently rewritten wholesale,
- not queried independently at scale.

Bad:

```text
all followers of user
all case tags if can be thousands and queried by tag
all notification IDs
```

Use child table for unbounded relation.

---

## 17. List

List preserves order and allows append/prepend/index operations.

But list can be problematic:

- duplicate values allowed,
- position-based operations can be expensive/ambiguous,
- append retry may duplicate,
- large list tombstones,
- not good for unbounded log/feed.

Bad:

```sql
comments list<text>
```

for case comments.

Better:

```sql
case_comments_by_case (
  case_id,
  comment_time,
  comment_id,
  ...
)
```

as clustering rows.

---

## 18. Map

Map stores key-value pairs.

Good:

```text
small metadata map
feature flags
bounded attributes
```

Bad:

```text
large arbitrary JSON object
dynamic unbounded per-user settings with hundreds/thousands keys
queryable attributes
```

If map keys are query dimensions, model explicitly.

---

## 19. Frozen vs Non-Frozen Collections

Frozen collection is stored as single value.

Example:

```sql
metadata frozen<map<text, text>>
```

Updating any part generally rewrites whole value.

Non-frozen collection can store elements more granularly.

Trade-off:

```text
frozen:
  simpler single value
  whole-value overwrite
  good for small immutable-ish object

non-frozen:
  element-level operations
  more cells/tombstones
  still dangerous if unbounded
```

Use frozen for small value objects.

Use separate table for growing/mutable collections.

---

## 20. Collection Tombstones

Collections can create tombstones.

Examples:

```sql
UPDATE users SET tags = tags - {'old'} WHERE user_id = ?;
```

removes element.

Replacing whole collection:

```sql
UPDATE users SET tags = {'a', 'b'} WHERE user_id = ?;
```

may tombstone previous collection entries.

Repeated full replacement of large collections is tombstone-heavy.

Java mappers often accidentally do full collection replacement.

---

## 21. Collection Retry Ambiguity

Some collection operations are not idempotent.

Example list append:

```sql
UPDATE cases
SET comments = comments + ['new comment']
WHERE case_id = ?;
```

If timeout and retry:

```text
comment may be appended twice
```

Better:

```text
comment_id as clustering key in child table
```

Idempotent insert by stable comment_id.

Set add is more idempotent logically if same value, but still be careful with semantics and timestamps.

---

## 22. Collection Size Limits

Even if CQL allows collection, production should impose application limits.

Example:

```text
tags <= 20
attributes <= 50
roles <= 20
```

Enforce in Java.

Do not let a user create:

```text
10,000 map entries
```

inside one row.

Large collection behaves like hidden wide row with tombstone issues.

---

## 23. Collection Query Limitations

Collections are not substitute for indexes/search.

If requirement:

```text
find all cases where tags contains 'fraud'
```

Do not just store:

```sql
tags set<text>
```

and expect scalable query.

Options:

- explicit `cases_by_tag_day_bucket`,
- search index,
- OLAP/reporting,
- bounded admin scan if tiny.

---

## 24. Child Table Alternative

Instead of:

```sql
comments list<frozen<comment_type>>
```

Use:

```sql
CREATE TABLE case_comments_by_case (
    tenant_id uuid,
    case_id uuid,
    comment_time timestamp,
    comment_id uuid,
    author_id uuid,
    body text,
    PRIMARY KEY ((tenant_id, case_id), comment_time, comment_id)
) WITH CLUSTERING ORDER BY (comment_time DESC, comment_id ASC);
```

Benefits:

- bounded/paged reads,
- idempotent insert by comment_id,
- no list append duplicate,
- independent TTL/delete,
- better large/unbounded scale.

---

## 25. Collection Decision Checklist

Use collection only if:

```text
[ ] maximum size is small and enforced
[ ] not an unbounded child relation
[ ] not queried independently at scale
[ ] update pattern is understood
[ ] retry semantics safe
[ ] tombstone cost acceptable
[ ] Java mapper does not overwrite accidentally
```

If any false, use table.

---

## 26. User-Defined Types (UDT)

UDT defines structured value.

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
CREATE TABLE user_profile_by_id (
    user_id uuid PRIMARY KEY,
    display_name text,
    address frozen<address_type>
);
```

UDT feels like embedded object.

Good for:

- small value object,
- stable schema,
- not queried independently,
- written/read as unit,
- bounded size.

---

## 27. UDT Pitfalls

### 27.1 Schema Evolution

Adding fields to UDT is possible depending DB/version support, but rolling schema changes across services can be tricky.

Java serialization/mapping must handle missing/new fields.

### 27.2 Overwrite Tombstones

Frozen UDT overwrite replaces whole value and can create tombstone/old value lifecycle.

### 27.3 Query Limitations

If you need query by `address.city`, UDT is wrong access model.

### 27.4 Large Nested Object

Do not use UDT as document database object.

---

## 28. UDT Versioning Pattern

For stable value object:

```sql
CREATE TYPE money_type (
    amount_minor bigint,
    currency text
);
```

Use:

```sql
amount frozen<money_type>
```

But for evolving object, consider explicit columns:

```sql
amount_minor bigint,
currency text
```

Simpler for Java, CQL, schema evolution, query/display.

Often explicit columns beat UDT in production.

---

## 29. Frozen UDT vs Columns

Frozen UDT:

```text
groups fields semantically
written as one value
harder partial update/query/evolution
```

Columns:

```text
more verbose
easier update/query/evolution
clearer mapping
```

For core business fields, prefer explicit columns.

For small embedded metadata, UDT can be okay.

---

## 30. Nested UDT/Collections

CQL can express nested structures, but production should be conservative.

Bad:

```text
map<text, frozen<list<frozen<complex_udt>>>>
```

This is a document database inside a cell.

Problems:

- large values,
- serialization,
- tombstones,
- update amplification,
- Java mapping complexity,
- schema evolution.

If structure is complex and growing, model as tables or store document in appropriate system/object storage.

---

## 31. Blob

Blob stores binary data.

Use for small binary values:

- hash,
- token,
- compact encoded metadata,
- cryptographic value.

Avoid:

- large PDFs,
- images,
- evidence files,
- video,
- huge serialized Java objects.

Use object storage for large binary and store reference/hash in ScyllaDB.

Blob in ScyllaDB participates in row size, compaction, repair, backup.

---

## 32. Atomicity and Collections

A mutation updating multiple collection elements in one row may be atomic at row mutation level, but not a general transaction.

Do not build complex multi-step collection state machine without LWT/versioning.

Example:

```text
remove item from set A and add to set B
```

if across rows/tables, not atomic.

If in same row, still consider concurrency and retry.

---

## 33. Atomicity and Static Columns

Static and clustering row updates in same partition can be included in a batch/mutation, but design carefully.

Example:

```text
increment partition summary
append event row
```

If summary uses counter/static and event append fails/timeout, correctness tricky.

Often better:

- append event source,
- derive summary asynchronously,
- use current snapshot row separately.

---

## 34. Batches and Atomicity

CQL batch is not JDBC batch performance trick.

For same partition, it can group mutations with atomicity semantics, but not arbitrary SQL transaction across broad data.

Do not use batch to compensate for bad data model.

For collections/counters:

- counter batches have special restrictions,
- logged batch across many partitions can hurt.

Batch deep dive was previewed earlier and will appear in write pipeline part.

---

## 35. Java Mapping Pitfalls

### 35.1 Null vs Unset

Null often means delete/tombstone.

Unset means do not modify.

Java mapper must distinguish:

```text
field absent in PATCH request
field explicitly set to null/delete
```

### 35.2 Full Object Save

Bad:

```java
repository.save(entity)
```

writes all columns, collections, UDTs.

This can:

- overwrite values,
- write null tombstones,
- replace collections,
- race with other writers,
- create huge mutation.

Better:

```text
command-specific update statements
```

### 35.3 Mutable Collections

Passing mutable Java collections can cause unintended replacement.

Use immutable DTOs and explicit operations.

---

## 36. Java Type Mapping

Common mappings:

| CQL | Java |
|---|---|
| counter | Long on read, special update statement |
| set<text> | Set<String> |
| list<text> | List<String> |
| map<text,text> | Map<String,String> |
| frozen<UDT> | UDTValue or mapped class |
| blob | ByteBuffer |
| timestamp | Instant |
| date | LocalDate |

Rules:

- do not expose CQL collection as arbitrary mutable domain collection,
- enforce size limits,
- validate payload byte size,
- avoid serializing unknown maps blindly.

---

## 37. Domain Modeling Guidance

### Good Use of Set

```text
roles set<text> with max 10 roles
```

### Bad Use of Set

```text
followers set<uuid>
```

Use:

```text
followers_by_user
```

### Good Use of Map

```text
small metadata map max 20 keys
```

### Bad Use of Map

```text
all dynamic case fields with query needs
```

Use explicit columns/search.

### Good Use of UDT

```text
money amount/currency small immutable
```

### Bad Use of UDT

```text
entire case object nested deeply
```

Use tables/columns.

---

## 38. Regulatory Case Examples

### 38.1 Case Tags

If max 10 display tags only:

```sql
tags set<text>
```

may be fine.

If query cases by tag:

```sql
CREATE TABLE cases_by_tag_day_bucket (
    tenant_id uuid,
    tag text,
    bucket_day date,
    bucket_id int,
    updated_at timestamp,
    case_id uuid,
    title text,
    PRIMARY KEY ((tenant_id, tag, bucket_day, bucket_id), updated_at, case_id)
);
```

### 38.2 Case Comments

Do not use list.

Use table:

```sql
case_comments_by_case
```

### 38.3 Case Attributes

If arbitrary metadata only displayed:

```sql
attributes map<text, text>
```

with strict max.

If searchable/filterable:

```text
search projection or explicit tables
```

### 38.4 Money/Penalty

Prefer explicit:

```sql
penalty_amount_minor bigint,
penalty_currency text
```

over floating point or complex UDT if core business field.

---

## 39. Counter Example: Notification Badge

Requirement:

```text
unread notification count
```

Counter approach:

```text
increment on notification
decrement on mark read
```

Problems:

- retry double count,
- mark-read batch partial,
- read state drift,
- multi-device concurrency.

Alternative:

- store notifications/read state,
- compute approximate badge asynchronously,
- reconcile count periodically,
- badge is best-effort.

If product demands exact unread count, design source/read-state carefully and expect cost.

---

## 40. Counter Example: Rate Limit

Requirement:

```text
max 100 actions/minute per user
```

Counter may seem natural.

But exact distributed rate limiting with ScyllaDB counter can be tricky due retry/concurrency.

Alternatives:

- Redis/token bucket for real-time limit,
- local limiter + async audit,
- ScyllaDB event log for enforcement audit,
- approximate sliding window if acceptable.

Use right system.

---

## 41. Static Column Example: Partition Header

Case event partition:

```sql
CREATE TABLE case_events_by_case_version_bucket (
    tenant_id uuid,
    case_id uuid,
    version_bucket bigint,
    event_version bigint,
    event_id uuid,
    case_ref text static,
    jurisdiction text static,
    event_type text,
    payload text,
    PRIMARY KEY ((tenant_id, case_id, version_bucket), event_version, event_id)
);
```

Works if:

```text
case_ref/jurisdiction stable for that bucket
```

But if jurisdiction changes, all buckets may need update or event rows may show old header.

Maybe better:

```text
store jurisdiction in event row as historical fact
```

or read current from `case_current_by_id`.

---

## 42. UDT Example: Address Snapshot

If each case has respondent address snapshot:

```sql
CREATE TYPE address_snapshot_type (
    line1 text,
    line2 text,
    city text,
    postal_code text,
    country text
);
```

Use in event:

```sql
respondent_address frozen<address_snapshot_type>
```

Good if:

- immutable snapshot,
- small,
- not queried independently,
- event payload needs it.

If address changes and must be queried by city, use explicit projection/search.

---

## 43. Feature Interaction Matrix

| Feature | Main Benefit | Main Risk |
|---|---|---|
| Counter | easy increment/decrement | retry ambiguity, drift |
| Static column | partition metadata | misunderstood scope, update duplication |
| Set | small unique collection | unbounded growth, tombstones |
| List | ordered small collection | append retry duplicates, tombstones |
| Map | small key-value metadata | document anti-pattern, overwrite cost |
| Frozen UDT | value object | whole-value overwrite, schema evolution |
| Blob | binary value | large payload, compaction/backup cost |

---

## 44. Correctness Matrix

| Requirement | Good Pattern | Avoid |
|---|---|---|
| exact money balance | transactional system/event ledger | counter |
| audit history | append table | list collection |
| comments | child table | list<comment> |
| tags display only | small set | unbounded tag set |
| search by tag | cases_by_tag table/search | collection scan |
| uniqueness | mapping table + LWT | secondary index alone |
| current count approximate | async aggregate/counter maybe | exact counter assumption |
| current state transition | LWT version/single writer | last-write-wins |

---

## 45. Performance Matrix

| Pattern | Read Cost | Write Cost | Operational Risk |
|---|---|---|---|
| small set | low | low/moderate | size drift |
| large set | high | high | tombstones |
| list append | grows | retry risk | duplicates |
| child table | bounded/paged | predictable | more schema |
| counter | low read | special write | drift/hot key |
| UDT small | low | whole rewrite | evolution |
| blob large | high | high | storage/backup |

---

## 46. API Design Implications

Avoid generic endpoints:

```http
PATCH /cases/{id}
{
  "tags": [...],
  "attributes": {...},
  "comments": [...]
}
```

This encourages full overwrite.

Prefer explicit commands:

```http
POST /cases/{id}/tags/{tag}
DELETE /cases/{id}/tags/{tag}
POST /cases/{id}/comments
PATCH /cases/{id}/attributes/{key}
```

Each maps to clear CQL operation with known tombstone/retry semantics.

---

## 47. Schema Evolution

Collections/UDTs make schema evolution harder.

Questions:

```text
What if field added to UDT?
What if map key renamed?
What if collection max size changes?
What if Java class version differs?
What if old rows lack field?
```

Explicit columns/tables often make evolution clearer.

For UDT:

- version DTOs,
- tolerate missing fields,
- deploy schema before code,
- avoid changing meaning of existing field.

---

## 48. Observability

Monitor:

```text
counter drift indicators
counter update timeout/retry
collection sizes
large row warnings
tombstone warnings
mutation size
read latency by collection-heavy table
UDT/blob payload size
mapper null writes
rows rejected by size validation
```

Application-level metrics:

```text
tags_count_per_case
attributes_count_per_case
comment_write_idempotency_conflicts
counter_reconciliation_delta
```

---

## 49. Testing

Test:

```text
1. counter timeout and retry behavior
2. collection add/remove idempotency
3. list append duplicate on retry
4. full collection replacement tombstones
5. null vs unset mapper behavior
6. UDT schema evolution
7. max collection size enforcement
8. large payload rejection
9. concurrent updates to same collection
10. static column scope across buckets
```

Do not only test happy-path CQL.

---

## 50. Decision Framework

Before using counter/static/collection/UDT:

```text
1. Is this bounded?
2. Is it updated frequently?
3. Is it queried independently?
4. Is retry idempotent?
5. Does timeout ambiguity matter?
6. Does it create tombstones?
7. Can it be represented as child table?
8. Does schema evolve?
9. Does Java mapper preserve intent?
10. Is exact correctness needed?
```

If uncertain, prefer explicit table and command-specific statements.

---

## 51. Common Misconceptions

### Misconception 1: “Counter is safe for exact count.”

Not under timeout/retry/partial failure unless additional protocol/reconciliation exists.

### Misconception 2: “List is good for comments/events.”

Unbounded list is bad. Use clustering rows.

### Misconception 3: “Map is like JSON document.”

It is not a general document model.

### Misconception 4: “UDT makes schema cleaner with no downside.”

UDT affects evolution, overwrite, mapping.

### Misconception 5: “Static column is per entity.”

Static column is per partition key, not necessarily entity.

### Misconception 6: “Null means no change.”

In CQL updates, null can mean delete/tombstone; use unset/omit.

### Misconception 7: “Collection update is always idempotent.”

List append and full replacement can be problematic.

### Misconception 8: “Blob is fine for files.”

Large binary belongs in object storage.

---

## 52. Mental Model Compression

Remember:

```text
Counter:
  easy arithmetic, hard exactness.

Collection:
  small bounded convenience, not child table.

UDT:
  small value object, not document database.

Static column:
  partition metadata, not global entity metadata.

Atomicity:
  local mutation boundary, not general transaction.
```

If feature hides unbounded growth or business invariant, do not use it.

---

## 53. Summary

Counters, collections, static columns, and UDTs are useful but sharp tools.

Key lessons:

1. Counter increments are not idempotent.
2. Counter timeout + retry can double increment.
3. Counters are poor for exact business-critical counts.
4. Sharded counters reduce heat but not retry ambiguity.
5. Static columns are scoped to partition key.
6. Static columns are good for small partition metadata.
7. Collections must be small and bounded.
8. Lists are usually bad for unbounded comments/events.
9. Collection overwrites/removals create tombstones.
10. Frozen values rewrite whole object.
11. UDTs are good for small stable value objects.
12. UDTs are not document modeling.
13. Blob should not store large files.
14. Java mappers must distinguish null vs unset.
15. Generic full-object save creates tombstones and races.
16. Explicit child tables often beat collections.
17. Explicit event/aggregate pipelines often beat counters.
18. API design should expose command-specific operations.

---

## 54. Review Questions

1. Kenapa counter increment tidak idempotent?
2. Apa yang terjadi jika counter update timeout lalu di-retry?
3. Kapan counter masih acceptable?
4. Apa itu sharded counter dan apa trade-off-nya?
5. Kenapa exact count lebih baik dari event-derived aggregate?
6. Apa scope static column?
7. Kenapa static column pada bucketed table bisa terduplikasi?
8. Kapan set<text> aman?
9. Kenapa list buruk untuk comments/events?
10. Apa bahaya full collection replacement?
11. Apa beda frozen dan non-frozen collection?
12. Kapan map<text,text> aman?
13. Kenapa UDT bukan document database?
14. Apa risiko UDT schema evolution?
15. Kenapa explicit columns sering lebih baik dari UDT?
16. Apa risiko blob besar?
17. Kenapa null vs unset penting di Java driver?
18. Mengapa generic save(entity) buruk?
19. Bagaimana API command-specific mengurangi tombstone?
20. Kapan child table lebih baik daripada collection?

---

## 55. Practical Exercise

Untuk regulatory case management, desain model untuk:

```text
1. case tags
2. case comments
3. case dynamic attributes
4. penalty amount/currency
5. respondent address snapshot
6. notification unread count
7. dashboard case count by status
8. device telemetry latest value
9. partition-level case event metadata
10. evidence file metadata
```

Untuk tiap item, pilih:

```text
counter
static column
collection
UDT
explicit columns
child table
external object storage
derived aggregate
```

Jelaskan:

```text
why
max size
update pattern
retry safety
tombstone risk
schema evolution
Java mapping
API operation
monitoring metric
```

---

## 56. Preview Part 019

Part berikutnya masuk ke Java client engineering:

```text
Java Client Engineering I:
driver architecture,
session lifecycle,
prepared statements,
token-aware routing,
shard-aware routing,
execution profiles,
timeouts,
basic async patterns,
mapping repository to CQL access paths.
```

Part 018 menutup banyak fitur CQL data modeling.

Part 019 mulai menghubungkan semua desain ini ke implementasi Java production-grade.

---

# End of Part 018


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-017.md">⬅️ Part 017 — Secondary Indexes, Local Secondary Indexes, dan Materialized Views</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-019.md">Part 019 — Java Client Engineering I: Driver Architecture, Session Lifecycle, Prepared Statements, Routing, dan Async Basics ➡️</a>
</div>
