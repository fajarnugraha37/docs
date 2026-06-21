# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-021.md

# Part 021 — Sharding Deep Dive: Horizontal Scale Without Magical Thinking

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 021 dari 035  
> Fokus: sharding, shard key, targeted query, scatter-gather, range/hashed/compound shard key, tenant distribution, zones, resharding, transactions, unique constraints, dan failure modelling  
> Target pembaca: Java software engineer yang ingin memahami horizontal scaling MongoDB secara arsitektural, bukan hanya konfigurasi cluster

---

## 0. Posisi Part Ini Dalam Seri

Part 020 membahas replication dan high availability. Replica set menyelesaikan masalah:

```text
availability
failover
read redundancy
durability improvement
```

Namun replica set tidak menyelesaikan semua masalah scale.

Jika satu replica set terlalu besar atau terlalu sibuk, kita butuh membagi data dan load ke beberapa unit fisik/logis. Di MongoDB, mekanisme itu adalah:

```text
sharding
```

Sharding memungkinkan data collection didistribusikan ke banyak shard. Tetapi sharding bukan “tombol scale horizontal” yang otomatis membuat semua hal cepat. Sharding memindahkan kompleksitas dari satu node ke desain distribusi data.

Kalimat paling penting:

> Sharding adalah keputusan data placement. Begitu salah memilih shard key, hampir semua query, write, transaction, dan operational behavior akan membayar biayanya.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu harus mampu:

1. Menjelaskan kenapa sharding dibutuhkan.
2. Memahami komponen sharded cluster: shard, `mongos`, config server, chunks, balancer.
3. Menjelaskan shard key sebagai lifetime architecture decision.
4. Membedakan range shard key, hashed shard key, dan compound shard key.
5. Menilai shard key berdasarkan cardinality, frequency, monotonicity, query targeting, dan write distribution.
6. Membedakan targeted query vs scatter-gather query.
7. Mendesain shard key untuk multi-tenant workload.
8. Memahami zone sharding untuk region/jurisdiction/data residency.
9. Memahami risiko sharding terhadap unique constraint.
10. Memahami biaya transaksi di sharded cluster.
11. Membaca failure mode sharded cluster dari perspektif Java application.
12. Membuat checklist shard key design sebelum production.

---

## 2. Kapan Sharding Dibutuhkan

Sharding biasanya dipertimbangkan ketika satu replica set tidak lagi cukup untuk:

```text
data size
write throughput
read throughput
working set
storage growth
regional/data residency placement
tenant isolation
operational manageability
```

Contoh:

```text
cases collection:
  2 billion documents
  30 TB data
  write-heavy audit-like updates
  hot tenants with large operational queries
```

Atau:

```text
audit_events collection:
  20 billion events
  append-heavy
  queries by tenant/case/time
  retention 7 years
```

Namun sharding bukan langkah pertama.

Sebelum sharding, pastikan sudah benar:

1. data model,
2. bounded document,
3. indexes,
4. query shape,
5. pagination,
6. archival,
7. hot/cold separation,
8. materialized summaries,
9. read/write concern,
10. connection pool/backpressure.

Sharding memperbesar kapasitas, tetapi tidak menyelamatkan query shape buruk.

---

## 3. Sharding Bukan Pengganti Index

Kesalahan umum:

```text
Query lambat karena collection besar.
Mari shard.
```

Jika query tidak punya index yang tepat, sharding bisa memperburuk:

```text
dulu scan satu replica set
sekarang scan semua shard
```

Contoh buruk:

```javascript
db.cases.find({ partyName: /john/i })
```

Tanpa search/index strategy, sharded cluster mungkin melakukan scatter-gather ke semua shard.

Sharding menjawab:

```text
where data lives
```

Index menjawab:

```text
how data is found within shard
```

Keduanya diperlukan.

---

## 4. Komponen Sharded Cluster

Sharded cluster terdiri dari:

```text
mongos
config servers
shards
```

### 4.1 `mongos`

`mongos` adalah query router.

Aplikasi Java biasanya connect ke `mongos`, bukan langsung ke shard.

`mongos` bertugas:

- menerima command,
- melihat metadata distribusi data,
- menentukan shard target,
- mengirim query/write ke shard terkait,
- menggabungkan hasil jika perlu.

### 4.2 Config Server

Config server menyimpan metadata cluster:

- database/collection sharding metadata,
- shard key metadata,
- chunk ranges,
- zone metadata,
- balancer metadata.

Config server adalah bagian kritis dari cluster.

### 4.3 Shard

Shard menyimpan subset data.

Dalam production, setiap shard biasanya adalah replica set.

```text
Shard A = Replica Set A
Shard B = Replica Set B
Shard C = Replica Set C
```

---

## 5. Diagram Mental

```text
Java Application
      |
      v
+-------------+
| mongos      |
| query router|
+-------------+
   |     |     |
   |     |     |
   v     v     v
+-----+ +-----+ +-----+
| S1  | | S2  | | S3  |
| RS  | | RS  | | RS  |
+-----+ +-----+ +-----+
   ^
   |
+----------------+
| Config Servers |
+----------------+
```

Aplikasi tidak memilih shard secara manual.

Aplikasi memengaruhi shard targeting melalui:

```text
query filter
shard key
collection design
```

---

## 6. Shard Key

Shard key adalah field atau kombinasi field yang digunakan untuk mendistribusikan dokumen ke shard.

Contoh:

```javascript
{ tenantId: 1 }
```

atau:

```javascript
{ tenantId: 1, caseId: 1 }
```

atau:

```javascript
{ tenantId: 1, createdAt: 1 }
```

atau hashed:

```javascript
{ caseId: "hashed" }
```

Shard key menentukan:

1. data distribution,
2. write distribution,
3. query targeting,
4. chunk split behavior,
5. balancing behavior,
6. unique index constraints,
7. transaction routing,
8. tenant isolation,
9. future resharding complexity.

Shard key adalah salah satu keputusan paling sulit di MongoDB architecture.

---

## 7. Kualitas Shard Key

Shard key yang baik biasanya punya:

```text
high cardinality
good distribution
supports common queries
avoids hot shard
stable and immutable
appears in targeted queries
matches data residency needs if relevant
```

Shard key yang buruk:

```text
low cardinality
monotonic hot insert
not used in queries
highly skewed
mutable
unknown at insert time
too broad for tenant distribution
breaks unique invariants
```

---

## 8. Cardinality

Cardinality = jumlah nilai berbeda.

Low cardinality contoh:

```text
status: OPEN/CLOSED/ESCALATED
region: APAC/EMEA/AMER
priority: HIGH/MEDIUM/LOW
```

Shard key `{ status: 1 }` buruk:

```text
hanya sedikit nilai
data tidak tersebar baik
hot status bisa dominan
```

High cardinality contoh:

```text
caseId
customerId
tenantId + caseId
accountId
eventId
```

Tetapi high cardinality saja tidak cukup.

`caseId` mungkin tersebar baik, tetapi query umum mungkin selalu by `tenantId` dan `status`, bukan `caseId`.

---

## 9. Frequency / Distribution

Frequency = seberapa seimbang jumlah dokumen per nilai shard key.

Contoh:

```text
tenantId:
  tenant A = 90% data
  tenant B-Z = 10% total
```

Walau `tenantId` cardinality 30, distribusinya buruk.

Shard key `{ tenantId: 1 }` dapat membuat tenant A mendominasi satu shard.

Untuk multi-tenant platform, jangan langsung pilih `tenantId` tanpa melihat tenant skew.

Alternatif:

```javascript
{ tenantId: 1, caseId: 1 }
```

atau hashed suffix strategy, tergantung query.

---

## 10. Monotonicity

Monotonic shard key meningkat terus:

```text
createdAt
sequenceNumber
ObjectId timestamp-like pattern
auto-increment id
```

Jika shard key range-based monotonic, write baru cenderung masuk ke range terakhir, bisa menyebabkan hot shard.

Contoh buruk untuk write-heavy:

```javascript
{ createdAt: 1 }
```

Semua insert terbaru menuju chunk paling akhir.

Namun `createdAt` bagus untuk range query. Jadi trade-off:

```text
query locality vs write distribution
```

Solusi bisa berupa compound key:

```javascript
{ tenantId: 1, createdAt: 1 }
```

atau hashed component:

```javascript
{ tenantId: 1, caseId: "hashed" }
```

Tergantung query pattern.

---

## 11. Targeted Query vs Scatter-Gather

### 11.1 Targeted Query

Query dapat diarahkan ke shard tertentu jika filter mengandung shard key atau prefix shard key yang cukup.

Contoh shard key:

```javascript
{ tenantId: 1, caseId: 1 }
```

Targeted query:

```javascript
db.cases.find({
  tenantId: "t1",
  caseId: "C-123"
})
```

`mongos` tahu shard target.

### 11.2 Scatter-Gather

Jika query tidak punya shard key condition:

```javascript
db.cases.find({
  status: "OPEN"
})
```

`mongos` harus bertanya ke banyak/semua shard.

Scatter-gather tidak selalu salah, tetapi berbahaya untuk hot user-facing query.

Prinsip:

```text
Hot operational queries should be targeted.
Rare analytics can be scatter-gather if controlled.
```

---

## 12. Compound Shard Key Prefix

Jika shard key:

```javascript
{ tenantId: 1, caseId: 1 }
```

Query dengan:

```javascript
{ tenantId: "t1" }
```

bisa menargetkan subset/range shard terkait tenant, tergantung distribusi.

Query dengan:

```javascript
{ caseId: "C-123" }
```

tanpa `tenantId` tidak menggunakan prefix awal, sehingga targeting bisa buruk.

Ini mirip compound index prefix concept, tetapi untuk routing.

Desain shard key harus mengikuti access pattern.

---

## 13. Range Sharding

Range sharding mendistribusikan data berdasarkan range nilai shard key.

Contoh shard key:

```javascript
{ tenantId: 1, createdAt: 1 }
```

Data dibagi menjadi chunks:

```text
tenant A, Jan-Feb -> shard 1
tenant A, Mar-Apr -> shard 2
tenant B, Jan-Mar -> shard 3
...
```

Kelebihan:

- range query bisa efisien,
- locality untuk range tertentu,
- zone sharding lebih natural.

Kekurangan:

- risk hot range,
- skew jika key distribution tidak seimbang,
- monotonic insert hotspot,
- tenant besar bisa mendominasi.

---

## 14. Hashed Sharding

Hashed sharding menggunakan hash dari field untuk distribusi.

Contoh:

```javascript
{ caseId: "hashed" }
```

Kelebihan:

- distribusi write lebih merata,
- mengurangi hotspot pada monotonik/random-like key,
- bagus untuk equality lookup by hashed field.

Kekurangan:

- range query pada original field tidak efisien untuk targeting,
- locality hilang,
- query harus include hashed field untuk targeted lookup,
- tenant locality bisa hilang jika hashed hanya caseId.

Contoh:

```javascript
db.cases.find({ caseId: "C-123" })
```

targeted.

Tetapi:

```javascript
db.cases.find({
  createdAt: { $gte: start, $lt: end }
})
```

scatter.

---

## 15. Compound Hashed Shard Key

Dalam banyak workload, compound key lebih realistis.

Contoh:

```javascript
{ tenantId: 1, caseId: "hashed" }
```

Tujuan:

- tenantId untuk tenant scoping,
- hashed caseId untuk distribution within tenant.

Trade-off:

- query by tenantId only mungkin menyentuh banyak chunks,
- query by tenantId + caseId targeted,
- large tenant bisa tersebar,
- small tenants tetap manageable.

Untuk multi-tenant case management, ini sering lebih menarik daripada `{ tenantId: 1 }` saja jika ada tenant besar.

---

## 16. Shard Key Untuk Multi-Tenant System

Multi-tenant options:

### 16.1 `{ tenantId: 1 }`

Pros:

- tenant isolation simple,
- tenant-targeted queries easy,
- zone per tenant possible.

Cons:

- tenant skew,
- one huge tenant can hot shard,
- tenant cannot split easily if key range pinned,
- low cardinality if few tenants.

### 16.2 `{ tenantId: 1, caseId: 1 }`

Pros:

- tenant prefix,
- better distribution within tenant if caseId varied,
- targeted by tenant + case.

Cons:

- tenant-wide queries may scan multiple ranges/chunks,
- caseId monotonic/random behavior matters.

### 16.3 `{ tenantId: 1, caseId: "hashed" }`

Pros:

- large tenant distributed,
- equality by case targeted,
- tenant scoped design preserved.

Cons:

- range by caseId not useful,
- tenant-wide status query may touch many chunks,
- dashboards may need summaries.

### 16.4 `{ tenantId: 1, createdAt: 1 }`

Pros:

- tenant time-range queries good,
- archival/time-window operations good.

Cons:

- hot newest writes per tenant,
- large active tenant hot range,
- equality by caseId may be less targeted unless tenant/time known.

### 16.5 `{ region: 1, tenantId: 1, caseId: ... }`

Pros:

- data residency / jurisdiction.

Cons:

- region low cardinality,
- region hotspot possible,
- more complex query requirements.

---

## 17. Shard Key By Collection, Not Database

Each sharded collection can have different shard key.

Example:

```text
cases:
  { tenantId: 1, caseId: "hashed" }

case_audit_events:
  { tenantId: 1, caseId: 1, sequence: 1 }
  or { tenantId: 1, eventId: "hashed" }
  depending access pattern

outbox_events:
  maybe not sharded initially
  or { bucket: 1, availableAt: 1 }

case_search_documents:
  depends on search architecture

dashboard_summaries:
  { tenantId: 1 }
```

Do not force one shard key for all collections.

---

## 18. Shard Key and Access Pattern Matrix

Before selecting shard key, list query shapes.

Example `cases` hot queries:

```text
Q1: get case by tenantId + caseId
Q2: worklist by tenantId + status + assigneeId + dueAt
Q3: search by tenantId + caseNumber
Q4: dashboard by tenantId + status
Q5: archive by tenantId + closedAt range
Q6: admin by region + tenantId
```

Candidate shard keys:

```text
A: { tenantId: 1 }
B: { tenantId: 1, caseId: "hashed" }
C: { tenantId: 1, status: 1 }
D: { tenantId: 1, closedAt: 1 }
E: { caseId: "hashed" }
```

Evaluate:

```text
Does Q1 target?
Does Q2 target?
Does Q3 target?
Does Q4 scatter?
Does write distribute?
Does tenant skew hurt?
Does data residency work?
Does unique caseNumber per tenant work?
```

Shard key choice is multi-objective optimization.

---

## 19. Targeted Worklist Problem

Worklist query:

```javascript
db.cases.find({
  tenantId: "t1",
  status: "OPEN",
  assigneeId: "u1"
}).sort({ dueAt: 1 }).limit(50)
```

If shard key:

```javascript
{ tenantId: 1, caseId: "hashed" }
```

The query includes `tenantId` but not `caseId`.

For a large tenant, data might be distributed across many chunks/shards. `mongos` may need target many shards for tenant range depending metadata.

Index within each shard still helps:

```javascript
{ tenantId: 1, status: 1, assigneeId: 1, dueAt: 1 }
```

But results may be merged across shards.

Options:

1. Accept if performance okay.
2. Materialize worklist collection sharded by `{ tenantId, assigneeId }`.
3. Use shard key `{ tenantId, assigneeId, dueAt }` for worklist collection.
4. Keep `cases` optimized for case lookup and use projection collection for worklist.
5. Limit large tenant complexity with zone/tenant strategy.

This shows why one collection may not serve all access patterns perfectly.

---

## 20. Dedicated Collection For Different Distribution

If `cases` document is best sharded for case lookup, but worklist is best distributed differently:

```text
cases:
  { tenantId: 1, caseId: "hashed" }

case_worklist_items:
  { tenantId: 1, assigneeId: 1, dueAt: 1 }
```

Then command updates both:

- synchronously if required,
- asynchronously if eventual worklist acceptable,
- via outbox/change stream projection.

Trade-off:

```text
more write complexity
better read targeting
clearer workload isolation
```

At scale, separate read projection is often better than forcing one collection to satisfy every query.

---

## 21. Chunk

MongoDB partitions sharded collection data into chunks based on shard key ranges.

Conceptual:

```text
chunk 1: tenantId A - tenantId C
chunk 2: tenantId D - tenantId F
...
```

For compound/hashing, chunk ranges are over shard key value space.

Chunks can split as data grows and move between shards.

As application engineer, you mostly care about:

- does data distribute?
- does balancing cause operational impact?
- do queries target minimal chunks?
- do jumbo chunks or skew exist?

---

## 22. Balancer

Balancer moves chunks between shards to keep cluster balanced.

Balancing consumes resources.

During heavy workload, chunk migrations can affect latency.

Operationally:

```text
bulk import
backfill
archive
balancer activity
index builds
```

can interact.

For large migrations, coordinate with platform/DBA:

- schedule,
- throttle,
- monitor,
- pause if needed,
- avoid peak traffic.

---

## 23. Jumbo Chunks and Skew

A jumbo chunk is a chunk too large to move/split normally due to distribution constraints.

Causes can include:

- shard key low cardinality,
- many documents with same shard key value,
- poor distribution,
- large tenant under one key.

Example:

```javascript
{ tenantId: 1 }
```

If tenant A has massive data, all same `tenantId` range may become problematic.

Lesson:

```text
Shard key must allow large logical groups to split if they can grow huge.
```

---

## 24. Zones / Zone Sharding

Zone sharding allows associating ranges of shard key values with specific shards.

Use cases:

```text
data residency
jurisdiction
regional locality
tenant placement
premium tenant isolation
cold/hot storage
```

Example shard key:

```javascript
{ region: 1, tenantId: 1, caseId: 1 }
```

Zone:

```text
region=EU -> EU shards
region=US -> US shards
region=APAC -> APAC shards
```

This can support regulatory data residency, but field ordering matters.

If region is first, region-based placement is natural, but region has low cardinality and may create distribution issues unless combined well.

---

## 25. Data Residency Design

For regulatory systems, data location can be a hard requirement.

Questions:

```text
Must EU tenant data stay in EU?
Can metadata cross region?
Can search index cross region?
Can backup cross region?
Can audit logs cross region?
Can support staff from another region access?
```

Shard key/zone design is only one piece.

Need align:

- application routing,
- storage,
- backups,
- search indexes,
- analytics,
- observability,
- support tooling,
- encryption keys,
- retention policies.

MongoDB zone sharding can help placement, but application architecture must preserve boundary too.

---

## 26. Resharding

Resharding means changing shard key/distribution.

This is possible in modern MongoDB versions, but it is still a serious operational activity.

Why reshard?

- wrong initial shard key,
- workload changed,
- tenant skew appeared,
- new query pattern dominates,
- data residency requirement changed,
- write hotspot.

Do not treat resharding as cheap escape hatch.

Plan as:

```text
capacity event
migration event
risk event
```

Before choosing initial shard key, ask:

```text
If data grows 100x, can this key still split?
If one tenant grows 100x, what happens?
If worklist query becomes dominant, what happens?
If region law changes, what happens?
```

---

## 27. Unique Constraints In Sharded Collections

Unique indexes in sharded collection have restrictions. General principle:

```text
uniqueness must be enforceable within shard key routing
```

If you need unique `caseNumber` per tenant:

```text
unique(tenantId, caseNumber)
```

Shard key should align so uniqueness can be enforced.

If shard key is `{ caseId: "hashed" }`, enforcing uniqueness on `{ tenantId, caseNumber }` globally may not be straightforward.

Design natural keys and shard keys together.

For application invariants:

```text
caseNumber unique per tenant
externalReference unique per source per tenant
active assignment unique per case
idempotency commandId unique per tenant
```

Check how they interact with sharding before production.

---

## 28. Sharding and Transactions

MongoDB supports transactions in sharded clusters, but multi-shard transactions have higher cost than single-shard operations.

Best case:

```text
transaction targets one shard
```

Worst case:

```text
transaction touches many shards
```

Multi-shard transaction costs:

- routing complexity,
- coordination,
- latency,
- failure modes,
- retry complexity,
- commit uncertainty,
- resource retention.

Design goal:

```text
Keep hot transactional boundaries within one shard when possible.
```

This often means shard key should include aggregate/tenant identity used by transactional writes.

Example:

```text
case transition updates:
  cases
  case_audit_events
  outbox_events
```

If all include `{ tenantId, caseId }` shard targeting, transaction may be more localized. If collections are sharded differently, transaction may cross shards.

---

## 29. Sharding and Change Streams

Change streams can operate on collection/database/cluster levels depending configuration/support.

In sharded cluster, change event ordering and resume behavior must be understood carefully.

Application design:

- persist resume tokens,
- handle shard/cluster topology changes,
- assume consumers can lag,
- use idempotent projection updates,
- monitor lag,
- do not make critical command success depend on async change stream consumer.

For high-volume sharded collections, change stream consumers must be capacity-tested.

---

## 30. Sharding and Aggregation

Aggregation on sharded collection can run partially on shards and merge results.

Efficient when:

- early `$match` targets shards,
- `$match` uses shard key,
- local shard filtering reduces data,
- group/sort data volume is bounded.

Expensive when:

- no shard key filter,
- `$lookup` across sharded collections poorly targeted,
- `$group` global over huge data,
- `$sort` global without limit/index,
- `$facet` over broad collection.

Aggregation pipeline design from Part 011-012 becomes more important under sharding.

---

## 31. Sharding and `$lookup`

`$lookup` in sharded environments requires careful design.

Questions:

```text
Are both collections sharded?
Do join fields include shard key?
Can lookup be targeted?
How many documents fan out?
Is this hot path?
Should data be embedded/denormalized instead?
Should there be a read projection?
```

If every request does cross-shard `$lookup`, sharding may amplify latency.

Operational read models are often better:

```text
pre-join / denormalized fields / materialized projection
```

---

## 32. Sharding and Sorting

If query hits multiple shards and sorts globally:

```javascript
db.cases.find({ tenantId: "t1", status: "OPEN" })
  .sort({ dueAt: 1 })
  .limit(50)
```

Each shard may return sorted candidates, and `mongos` merges.

This can be okay if shard targeting and limit are controlled.

But if query is broad:

```javascript
db.cases.find({ status: "OPEN" })
  .sort({ dueAt: 1 })
  .limit(50)
```

All shards participate.

At scale, always ask:

```text
How many shards does this query hit?
How many candidates per shard?
Where is sort performed?
Can index support sort on each shard?
Can result be limited early?
```

---

## 33. Shard Key Immutability

Shard key fields should be stable.

If shard key field changes, document may need to move between shards or operation may have restrictions/complexity depending MongoDB version and conditions.

Application design principle:

```text
Do not choose mutable business state as shard key.
```

Bad:

```javascript
{ status: 1, tenantId: 1 }
```

because `status` changes frequently.

Better:

- tenant ID,
- stable aggregate ID,
- region if immutable,
- createdAt if immutable but consider monotonicity,
- stable customer/account ID.

---

## 34. Shard Key Availability At Insert

Shard key value must be known when inserting document.

If later you discover:

```text
tenantId unknown at creation
region assigned later
caseId generated later
```

then shard key design may fail.

For systems with staged creation:

```text
draft -> submitted -> assigned tenant/region
```

ensure shard key fields exist from first insert or use different collection for draft.

---

## 35. Hashed Key and Range Queries

Suppose shard key:

```javascript
{ eventId: "hashed" }
```

Query:

```javascript
db.events.find({
  occurredAt: { $gte: start, $lt: end }
})
```

This cannot target based on `eventId`.

If most queries are time range, hashed eventId is poor for query targeting.

For audit/time-series-like data, access patterns matter:

```text
by caseId + sequence?
by tenantId + time?
by actorId + time?
by global time range?
```

You may need:

- different collection,
- materialized time buckets,
- archive store,
- search/analytics system,
- compound shard key.

---

## 36. Audit Events Shard Key Example

Access patterns:

```text
A1: get audit events for one case ordered by sequence
A2: get audit events by tenant and date range
A3: compliance search by actor/action/time
A4: append new audit event
```

Candidate shard keys:

### Candidate A

```javascript
{ tenantId: 1, caseId: 1, sequence: 1 }
```

Good:

- per-case audit read targeted,
- ordered sequence within case,
- tenant boundary.

Risk:

- one huge case can become hot/large,
- append to same case may hotspot for extreme cases.

### Candidate B

```javascript
{ tenantId: 1, occurredAt: 1 }
```

Good:

- tenant time-range query.

Risk:

- hot latest range,
- per-case read may scatter within tenant time.

### Candidate C

```javascript
{ tenantId: 1, eventId: "hashed" }
```

Good:

- write distribution.

Risk:

- poor locality for case audit.

There is no universally right answer. Pick based on dominant use case and failure tolerance.

---

## 37. Case Collection Shard Key Example

Workload:

```text
get by caseId: frequent
worklist by assignee/status: frequent
dashboard by status: frequent
search by party: frequent but can use search projection
archive by closedAt: batch
```

Possible design:

```text
cases:
  shard by { tenantId: 1, caseId: "hashed" }

case_worklist_items:
  shard by { tenantId: 1, assigneeId: 1, dueAt: 1 }

case_dashboard_summaries:
  shard by { tenantId: 1 }

case_search_documents:
  search-specific architecture

case_archive_records:
  shard by { tenantId: 1, closedAt: 1 }
```

This avoids forcing `cases` to answer every query optimally.

---

## 38. Single Collection Purism Is Expensive

A common mistake:

```text
Everything about case must be in cases collection.
```

At scale, different access patterns may need different placement.

Document database allows denormalized/projection collections.

This is not failure. It is deliberate read/write model design.

The cost is synchronization:

- command updates,
- outbox,
- change streams,
- reconciliation,
- idempotency,
- lag metrics.

The benefit is scalable targeted access.

---

## 39. Sharding and Tenant Isolation

Tenant isolation options:

```text
shared sharded collection
database per tenant
cluster per tenant
hybrid
```

Sharding can distribute tenant data, but not automatically isolate noisy tenants.

If one tenant runs huge import, it can still affect shared cluster.

Need:

- tenant-level throttling,
- workload isolation,
- zones,
- dedicated shards for large tenants,
- separate collections/databases for premium tenants,
- operational quotas.

Shard key helps placement, but application must enforce fairness.

---

## 40. Dedicated Shards For Large Tenants

For very large tenants:

```text
tenant A -> dedicated shard zone
small tenants -> shared shards
```

Pros:

- isolate noisy large tenant,
- capacity planning easier,
- regulatory/commercial boundary.

Cons:

- operational complexity,
- uneven utilization,
- migration complexity,
- query routing design,
- cost.

This can be valuable in enterprise SaaS.

---

## 41. Sharding and Archival

Archival can reduce hot data pressure.

If shard key includes time:

```javascript
{ tenantId: 1, closedAt: 1 }
```

archival by closedAt range can be efficient.

But if primary case collection is sharded by caseId hash, archival by date may touch many shards.

Possible solution:

- maintain archive candidate projection by tenant/date,
- batch by shard-aware key,
- archive off-peak,
- use closed cases collection with time-oriented shard key,
- move old data to separate collection optimized for retention.

Again, different lifecycle data may need different placement.

---

## 42. Sharding and Java Application Code

Java app usually connects to `mongos`.

Connection considerations:

```text
connect to multiple mongos routers if possible
pool sizing per mongos
server selection timeout
retry policy
operation timeouts
observability of command target/duration
```

Application code should not need shard-specific logic for normal CRUD.

But repository design should include shard key in filters.

Bad:

```java
findCaseById(caseId)
```

Better:

```java
findCaseByTenantAndCaseId(tenantId, caseId)
```

If shard key includes tenantId, every hot query should include tenantId.

This is also a security boundary.

---

## 43. Mandatory Tenant Filter

In multi-tenant sharded systems:

```text
tenantId is both security scope and routing scope.
```

Repository APIs should require tenantId.

Bad:

```java
Optional<CaseDocument> findByCaseId(String caseId);
```

Better:

```java
Optional<CaseDocument> findByTenantIdAndCaseId(TenantId tenantId, CaseId caseId);
```

For search:

```java
CasePage searchCases(TenantId tenantId, CaseSearchMode mode, Cursor cursor);
```

Never rely on caller remembering tenant filter.

---

## 44. Scatter-Gather Guardrails

Some scatter-gather queries may be allowed for admin/reporting.

Guardrails:

1. not user-facing hot path,
2. bounded time range,
3. max limit,
4. async job,
5. rate limited,
6. monitored,
7. separate role/endpoint,
8. no arbitrary regex,
9. off-peak if heavy,
10. explain reviewed.

Example:

```text
global compliance report across all tenants
```

This may legitimately touch all shards, but should be async with explicit SLA.

---

## 45. Sharded Cluster Failure Modes

Additional failure modes beyond replica set:

```text
mongos unavailable
config server issue
chunk migration impact
balancer overload
one shard down
one shard lagging
scatter query slow due to one shard
jumbo chunks
metadata refresh delay
multi-shard transaction uncertainty
zone misconfiguration
```

Application impact:

- some queries fail,
- some tenants affected more than others,
- broad queries slow due to slowest shard,
- writes to certain shard fail,
- latency uneven by tenant/key,
- transaction retries increase.

---

## 46. One Shard Slow Makes Global Query Slow

For scatter-gather:

```text
query latency = often bounded by slowest involved shard
```

If 9 shards respond in 20ms and 1 shard responds in 2s, global query may take around 2s.

Targeted queries isolate blast radius.

This is a key argument for shard-key-aware API design.

---

## 47. Observability For Sharded Workloads

Measure by:

```text
operation
collection
query shape
tenant
shard targeting if available
duration
docs examined
keys examined
number of shards involved
result count
errors by shard
```

Business-level:

```text
tenant A latency
tenant B latency
large tenant import activity
dashboard freshness by tenant
projection lag by shard
```

Cluster-level:

```text
chunk distribution
balancer activity
shard storage
shard CPU/disk
replication lag per shard
mongos latency
config server health
```

---

## 48. Shard Key Review Checklist

Before choosing shard key:

```text
[ ] What are top 10 query shapes?
[ ] Which are hot user-facing?
[ ] Which must be targeted?
[ ] What are top write paths?
[ ] Is key immutable?
[ ] Is key available at insert?
[ ] Cardinality high enough?
[ ] Distribution balanced?
[ ] Any tenant skew?
[ ] Any monotonic hotspot?
[ ] Does key support data residency?
[ ] Does key support unique constraints?
[ ] Does key localize transactions?
[ ] Does key work for archival?
[ ] What happens if largest tenant grows 100x?
[ ] What happens if query pattern changes?
[ ] Can projections solve conflicting patterns?
[ ] What is resharding fallback?
```

---

## 49. Candidate Evaluation Template

```text
Collection:
Candidate shard key:
Top queries targeted:
Top queries scatter:
Write distribution:
Largest tenant behavior:
Monotonic risk:
Unique constraint impact:
Transaction impact:
Zone/data residency support:
Archival support:
Operational risk:
Alternative projection needed:
Verdict:
```

Example:

```text
Collection:
  cases

Candidate shard key:
  { tenantId: 1, caseId: "hashed" }

Top queries targeted:
  get by tenantId + caseId
  update case by tenantId + caseId

Top queries scatter/partial:
  tenant worklist by status/assignee
  tenant dashboard by status

Write distribution:
  good within large tenant

Largest tenant behavior:
  can distribute across shards

Monotonic risk:
  low if caseId hash

Unique constraint impact:
  need review for tenantId + caseNumber

Transaction impact:
  good if related records include tenantId + caseId

Zone support:
  tenant-level zone possible if tenantId prefix, but hashed suffix details require planning

Alternative projection:
  case_worklist_items, dashboard summaries

Verdict:
  good for case-centric command/read, not sufficient alone for worklist/dashboard
```

---

## 50. Practical Exercise

You are designing MongoDB for a regulatory case platform.

Workload:

```text
Tenants:
  40 tenants
  2 huge tenants, 38 small tenants

Data:
  500M cases after 5 years
  20B audit events
  5B outbox/event records before retention cleanup

Hot queries:
  get case by tenant + caseId
  transition case state
  worklist by tenant + assignee + status + dueAt
  audit by tenant + caseId + sequence
  dashboard by tenant + status
  archive closed cases by tenant + closedAt
  search by party/document text

Requirements:
  EU tenant data must stay in EU
  strict audit
  command retry idempotency
  dashboard may lag 30 seconds
  search may lag 60 seconds
```

Design:

1. collections,
2. shard key per collection,
3. indexes per hot query,
4. which queries are targeted,
5. which projections are needed,
6. zone strategy,
7. unique constraints,
8. transaction locality,
9. archival strategy,
10. observability metrics.

Suggested direction:

```text
cases:
  shard by tenant + caseId hashed
  command/state targeted by tenant+case

case_audit_events:
  shard by tenant + caseId + sequence
  or tenant + event bucket depending volume/skew

case_worklist_items:
  shard by tenant + assignee + dueAt/status depending query

case_dashboard_summaries:
  shard by tenant

case_archive_records:
  shard by tenant + closedAt

case_search_documents:
  search-specific; not necessarily same placement as cases

outbox_events:
  shard by processing bucket/status/availableAt only if volume requires;
  otherwise carefully indexed non-sharded or tenant-aware sharding
```

---

## 51. Common Sharding Anti-Patterns

### 51.1 Sharding Too Early

Adds complexity before workload demands it.

### 51.2 Sharding Too Late

Data too large, downtime/resharding painful.

### 51.3 Shard Key Not In Queries

Creates scatter-gather for hot operations.

### 51.4 Low Cardinality Shard Key

Causes poor distribution.

### 51.5 Monotonic Shard Key For Write-Heavy Workload

Creates hot shard.

### 51.6 TenantId Only With Huge Tenant Skew

One tenant dominates.

### 51.7 Forcing One Collection To Serve All Access Patterns

Leads to impossible shard key.

### 51.8 Ignoring Unique Constraint Rules

Find out too late that invariant is hard to enforce.

### 51.9 Treating Resharding As Easy

It is possible, but still a serious operation.

### 51.10 Global Secondary Reads Plus Scatter Queries

Creates slow, stale, hard-to-debug behavior.

---

## 52. Senior-Level Heuristics

```text
If query does not include shard key, assume scatter until proven otherwise.

If a query is hot and scatter-gather, redesign.

If shard key has low cardinality, reject it early.

If largest tenant cannot split, tenantId-only is dangerous.

If shard key is mutable, reject it.

If writes are monotonic into one range, expect hotspot.

If one collection has conflicting access patterns, create projection collections.

If unique business invariant matters, design it with shard key.

If transaction crosses shards on hot path, challenge the model.

If data residency is required, zone strategy must be designed before production.

If sharding is proposed to fix a bad query, fix the query first.
```

---

## 53. Summary

Sharding is MongoDB’s horizontal scaling mechanism, but it is not magic.

Key lessons:

1. Sharding distributes data and load, but query/index design still matters.
2. Shard key controls data placement and routing.
3. Good shard key needs cardinality, distribution, immutability, and query alignment.
4. Targeted queries are the goal for hot paths.
5. Scatter-gather can be acceptable only for controlled workloads.
6. Range sharding preserves locality but can hotspot.
7. Hashed sharding distributes writes but hurts range locality.
8. Compound shard keys are often necessary for real systems.
9. Multi-tenant systems must account for tenant skew.
10. Zone sharding can support jurisdiction/data residency, but requires whole-system design.
11. Unique constraints and transactions must be considered before choosing shard key.
12. Different collections can and often should use different shard keys.
13. Projection collections solve conflicting access patterns.
14. Sharded cluster failure modes include routers, config metadata, chunk movement, and slow shards.
15. Sharding requires observability by tenant, query shape, and shard involvement.

The most important sentence:

> A shard key is not a database tuning option; it is a long-lived architecture boundary that shapes how your system reads, writes, scales, fails, and complies.

---

## 54. Bridge to Part 022

Part 022 will focus on:

- multi-tenancy models,
- tenant isolation trade-offs,
- index strategy with tenantId,
- shard key with tenant,
- noisy neighbor problem,
- per-tenant retention,
- per-tenant encryption,
- tenant-level backup/restore,
- authorization filters,
- query guardrails,
- data residency,
- regulatory audit requirements,
- case access control modelling,
- defensible deletion and retention.

Nama file berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-022.md
```

Judul berikutnya:

```text
Part 022 — Multi-Tenancy, Data Isolation, and Regulatory Boundaries
```

---

## 55. Status Seri

Selesai sampai bagian ini:

```text
Part 000 — Orientation: Why Document Database Exists, and When It Is the Wrong Tool
Part 001 — Document Database Mental Model: Aggregate, Boundary, Locality, and Shape
Part 002 — BSON, JSON, Document Structure, and Type Semantics
Part 003 — MongoDB Core Architecture: Database, Collection, Document, Replica Set, Shard
Part 004 — CRUD Semantics: Insert, Find, Update, Delete Without SQL Thinking
Part 005 — Query Model: Thinking in Predicates, Shapes, and Access Paths
Part 006 — Indexing Deep Dive I: B-Tree Mental Model, Compound Indexes, and Explain Plans
Part 007 — Indexing Deep Dive II: Multikey, Partial, Sparse, TTL, Unique, Text, Geo, Clustered
Part 008 — Data Modelling I: Embed vs Reference Decision Framework
Part 009 — Data Modelling II: Patterns for Real Systems
Part 010 — Schema Design for Java Applications: Entities, DTOs, POJOs, Records, and Immutability
Part 011 — Aggregation Pipeline I: Mental Model and Core Stages
Part 012 — Aggregation Pipeline II: Advanced Transformations, Joins, Windows, and Reports
Part 013 — Transactions, Atomicity, Consistency, and Retryable Writes
Part 014 — Concurrency Control and State Machines in MongoDB
Part 015 — Java Driver Mastery I: Connection, Client Lifecycle, CRUD, Codecs
Part 016 — Java Driver Mastery II: Transactions, Sessions, Change Streams, Monitoring
Part 017 — Spring Data MongoDB: Power, Abstractions, and Leaky Boundaries
Part 018 — Performance Engineering I: Query, Index, Memory, Working Set
Part 019 — Performance Engineering II: Write Path, Bulk Operations, Hotspots, and Backpressure
Part 020 — Replication, High Availability, Read Scaling, and Failure Modes
Part 021 — Sharding Deep Dive: Horizontal Scale Without Magical Thinking
```

Seri belum selesai. Masih lanjut ke Part 022 sampai Part 035.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-020.md">⬅️ Part 020 — Replication, High Availability, Read Scaling, and Failure Modes</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-022.md">Part 022 — Multi-Tenancy, Data Isolation, and Regulatory Boundaries ➡️</a>
</div>
