
# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-027.md

# Part 027 — Failure Modes and Incident Response

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Part: `027`  
> Fokus: failure modes Elasticsearch, incident response, triage, mitigation, recovery, dan post-incident hardening  
> Target pembaca: Java software engineer / tech lead yang harus mampu menangani Elasticsearch incident secara sistematis di production.

---

## 0. Posisi Part Ini Dalam Seri

Part 026 membahas **observability dan production operations**: metrics, logs, dashboards, alerts, dan runbooks.

Part 027 melanjutkan dari sana. Jika Part 026 menjawab:

```text
Apa yang harus kita lihat?
```

Maka Part 027 menjawab:

```text
Ketika sesuatu rusak, bagaimana kita berpikir, memutuskan, memitigasi, memulihkan, dan mencegah kejadian berulang?
```

Part ini akan membahas failure modes yang paling sering dan paling berbahaya pada Elasticsearch production:

- red/yellow cluster;
- unassigned shards;
- disk watermark;
- circuit breaker;
- rejected execution;
- high JVM memory pressure;
- long GC pause;
- high CPU;
- hot spotting / hot shard;
- task queue backlog;
- mapping explosion;
- slow query incident;
- bulk indexing storm;
- indexing lag;
- stale search result;
- alias/migration mistake;
- corrupt relevance after deployment;
- permission leak;
- split-brain historical context dan modern coordination;
- recovery playbooks;
- post-incident hardening.

Tujuan akhir: Anda tidak hanya tahu “apa error-nya”, tetapi bisa menyusun tindakan dengan urutan yang benar.

---

## 1. Core Thesis

Incident response Elasticsearch yang baik harus memisahkan tiga hal:

```text
1. Symptom
   Apa yang terlihat rusak?

2. Mechanism
   Kenapa secara teknis hal itu bisa terjadi?

3. Control
   Tombol apa yang aman ditekan sekarang?
```

Contoh:

```text
Symptom:
Search API timeout.

Mechanism:
Search thread pool rejected karena wildcard query mahal + hot shard + CPU tinggi.

Control:
Disable wildcard feature flag, throttle tenant tertentu, pause export, lalu investigasi query pattern.
```

Engineer yang belum matang sering lompat dari symptom ke tindakan acak:

```text
Search lambat → restart node.
```

Itu berbahaya. Restart node bisa memperparah incident jika cluster sedang shard relocation, disk pressure, atau heap pressure.

Top-tier engineer berpikir:

```text
Apa blast radius?
Apa data safety risk?
Apa user-facing risk?
Apa tindakan reversible?
Apa tindakan yang mengurangi tekanan tanpa memperbesar recovery cost?
```

---

## 2. Incident Response Principles

### 2.1 Stabilize Before Optimize

Saat incident, tujuan pertama bukan mencari solusi sempurna.

Tujuan pertama:

```text
menghentikan kerusakan bertambah buruk.
```

Contoh tindakan stabilisasi:

- disable feature flag query mahal;
- pause backfill/reindex/export;
- throttle bulk indexer;
- reduce traffic;
- fail fast expensive endpoint;
- route read-only workload;
- increase disk headroom;
- restore alias yang benar;
- rollback deployment.

Optimization dilakukan setelah sistem stabil.

---

### 2.2 Prefer Reversible Controls

Saat panik, pilih tindakan yang mudah dibalik.

Lebih aman:

```text
disable highlight feature flag
pause bulk job
reduce indexer concurrency
rollback alias
set index to read-only temporarily if needed
```

Lebih berisiko:

```text
delete index
force merge hot index
restart many nodes
change shard allocation blindly
increase heap blindly
change mapping manually
```

---

### 2.3 Protect Data and Security First

Urutan prioritas:

```text
1. Stop data/security leak.
2. Preserve data integrity.
3. Restore availability.
4. Restore latency.
5. Restore freshness.
6. Optimize cost/performance.
```

Jika ada dugaan permission leak, jangan hanya “fix latency”. Security incident punya prioritas khusus.

---

### 2.4 Do Not Let Retries Become A DDoS

Banyak outage Elasticsearch diperparah oleh retry storm.

Jika ES overloaded dan semua client retry tanpa backoff:

```text
overload → timeout → retry → more overload → more timeout
```

Saat incident, periksa:

- retry policy Java client;
- API gateway retry;
- frontend retry;
- indexer retry;
- job scheduler retry;
- export retry.

Gunakan backoff + jitter + retry budget.

---

### 2.5 Separate User Search From Heavy Workloads

Interactive search, bulk indexing, export, reindex, and analytics-like aggregations adalah workload berbeda.

Saat incident, identifikasi apakah heavy workload sedang mengganggu user search.

Mitigasi umum:

```text
pause export
pause reindex
throttle backfill
disable broad aggregation
prioritize exact identifier search
```

---

## 3. Triage Framework: First 15 Minutes

Saat alert muncul, gunakan urutan yang konsisten.

```text
1. Confirm impact
   Endpoint apa? Tenant apa? Semua user atau sebagian?

2. Check cluster health
   green/yellow/red? unassigned shards?

3. Check API symptoms
   latency? errors? timeouts? zero-result spike?

4. Check ES saturation
   CPU, heap, disk, IO, thread pools, rejected requests.

5. Check recent changes
   deploy, mapping change, reindex, bulk import, traffic spike.

6. Check workload type
   search? indexing? export? aggregation? autocomplete?

7. Apply reversible mitigation
   rollback, throttle, pause job, disable feature.

8. Preserve evidence
   slow logs, hot threads, metrics snapshots, request fingerprints.

9. Communicate status
   impact, mitigation, ETA unknown if not known, next update owner.

10. Start incident log
   timestamps, decisions, commands, observations.
```

Do not start with random commands. Triage first.

---

## 4. Severity Model

A practical severity model:

### SEV-1

```text
- cluster red affecting production data
- search unavailable for major user group
- confirmed or suspected unauthorized data exposure
- write/indexing fully blocked for critical system
- data loss suspected
```

### SEV-2

```text
- major latency degradation
- cluster yellow with redundancy risk
- sustained rejected requests
- indexing freshness SLA breached
- important search surface degraded
- critical tenant affected
```

### SEV-3

```text
- non-critical search slow
- autocomplete degraded
- DLQ growth but bounded
- isolated tenant issue
- warning threshold sustained
```

### SEV-4

```text
- cleanup issue
- deprecated field usage
- old index retention overdue
- minor relevance regression
```

Severity should be based on user/domain impact, not just metric value.

---

## 5. Failure Mode: Red Cluster

### 5.1 What It Means

A red cluster means at least one primary shard is unassigned. Some data may be unavailable. Search and indexing can fail for affected indices.

### 5.2 Symptoms

```text
cluster health red
unassigned primary shards
search failures for some indices
indexing failures
application 5xx
partial results
Kibana/monitoring warnings
```

### 5.3 Common Causes

- node failure;
- disk full / watermark;
- allocation rules impossible;
- missing data tier;
- corrupt shard;
- index created with impossible replica/allocation settings;
- cluster state issue;
- snapshot/restore problem;
- manual allocation mistake.

### 5.4 First Checks

```http
GET /_cluster/health?pretty
GET /_cat/shards?v
GET /_cluster/allocation/explain
GET /_cat/nodes?v
GET /_cluster/pending_tasks
```

Questions:

```text
Which index has unassigned primary?
Which shard?
Why allocation failed?
Is node missing?
Is disk full?
Is allocation disabled?
Is data tier missing?
Is there a recent index creation/migration?
```

### 5.5 Mitigation

Safe-ish first actions:

```text
- stop heavy indexing/search if cluster unstable
- restore missing node if node failure is transient
- free disk/add capacity if disk watermark
- fix allocation filters/tier requirement
- restore from snapshot if shard data lost
- close/delete non-critical broken index only if explicitly safe
```

Avoid:

```text
- deleting indices without business approval
- blindly rerouting stale primary
- restarting many nodes simultaneously
- changing allocation settings without understanding explain output
```

### 5.6 Recovery Checklist

```text
[ ] identify affected indices
[ ] identify primary shard cause
[ ] confirm data safety risk
[ ] resolve allocation blocker
[ ] monitor shard initialization
[ ] verify cluster health
[ ] verify application search/indexing
[ ] run data reconciliation if needed
[ ] document root cause
```

---

## 6. Failure Mode: Yellow Cluster

### 6.1 What It Means

A yellow cluster means all primary shards are assigned, but one or more replica shards are unassigned.

Data is generally available, but redundancy is reduced. If another node fails, data availability risk increases.

### 6.2 Common Causes

- single-node cluster with replicas > 0;
- insufficient nodes for replica allocation;
- disk watermark;
- allocation awareness/zone rules;
- missing tier;
- delayed allocation after node restart;
- shard count too high;
- index template sets replicas incorrectly.

### 6.3 Response

Yellow is not always urgent in dev, but in production it needs investigation.

Commands:

```http
GET /_cluster/health?pretty
GET /_cat/shards?v
GET /_cluster/allocation/explain
```

Mitigation:

```text
- add node/capacity
- lower replica count only if acceptable
- fix allocation rules
- free disk
- wait for delayed allocation if node returning
- correct template for future indices
```

### 6.4 Anti-Pattern

```text
Cluster yellow → set replicas to 0 everywhere.
```

That may hide the symptom while removing redundancy. Use only if explicitly acceptable.

---

## 7. Failure Mode: Unassigned Shards

Unassigned shards directly affect cluster health. Elastic documents common reasons such as node failures, configuration, insufficient resources, or allocation rules preventing placement.

### 7.1 Diagnosis

Use allocation explain:

```http
GET /_cluster/allocation/explain
```

Typical outputs may reveal:

```text
- disk threshold exceeded
- allocation disabled
- same shard copy already exists on node
- awareness constraint not satisfied
- node does not match include/exclude filters
- missing data tier
- shard store not found
```

### 7.2 Decision Tree

```text
Unassigned shard
|
+-- primary?
|   +-- high severity; data unavailable
|
+-- replica?
|   +-- redundancy risk
|
+-- allocation explain says disk?
|   +-- free/add disk
|
+-- allocation explain says filter/tier?
|   +-- fix settings or add tier node
|
+-- node left recently?
|   +-- wait/recover node or allocate replacement
|
+-- shard data missing?
    +-- restore snapshot or accept data loss through explicit process
```

### 7.3 Recovery Hardening

After resolving:

- review shard size/count;
- review disk capacity;
- review replica/zone policy;
- review ILM/data tier settings;
- review node failure process;
- review snapshot restore readiness.

---

## 8. Failure Mode: Disk Watermark

### 8.1 Mechanism

Elasticsearch uses disk watermarks to avoid running nodes out of disk. When disk usage is high, shard allocation can be restricted; at flood-stage risk, writes can be blocked for affected indices.

### 8.2 Symptoms

```text
cluster yellow/red
unassigned shards
index read-only block
indexing failures
disk usage high
shard relocation not happening
watermark errors in logs
```

### 8.3 Common Causes

- retention too long;
- ILM delete phase not working;
- bulk import/backfill;
- too many replicas;
- too many old indices;
- snapshots/local files consuming disk;
- segment merge requiring extra disk;
- high update/delete churn;
- large n-gram fields;
- shard imbalance.

### 8.4 Immediate Mitigation

Potential controls:

```text
- delete safe old indices after approval
- reduce replica temporarily for non-critical indices
- add disk/nodes
- move shards if possible
- pause indexing/backfill
- fix ILM
- snapshot then delete historical data if policy allows
```

Avoid:

```text
- deleting unknown indices
- force merge while disk critically low
- ignoring read-only index blocks
```

### 8.5 Hardening

- capacity forecasting;
- ILM retention review;
- index size dashboard;
- disk alerts before watermark;
- shard balance review;
- avoid uncontrolled dynamic fields;
- review analyzer/index expansion.

---

## 9. Failure Mode: Circuit Breaker Errors

### 9.1 Mechanism

Elasticsearch uses circuit breakers to prevent nodes from running out of JVM heap. If Elasticsearch estimates an operation would exceed a breaker, it stops the operation and returns an error. Elastic notes that the parent breaker defaults to triggering at 95% JVM memory usage and recommends reducing memory pressure if usage is consistently above 85%.

### 9.2 Symptoms

```text
circuit_breaking_exception
data too large
search failures
aggregation failures
bulk failures
high heap
GC pressure
request breaker tripped
fielddata breaker tripped
parent breaker tripped
```

### 9.3 Common Causes

- aggregation too broad;
- high-cardinality terms aggregation;
- huge result size;
- large terms filter;
- fielddata on text field;
- script_score memory pressure;
- too many concurrent heavy queries;
- bulk request too large;
- mapping explosion;
- too many shards/segments.

### 9.4 Immediate Mitigation

```text
- reduce/disable heavy aggregation
- cap page size/result size
- reduce bulk batch size
- throttle concurrent queries
- disable expensive feature flag
- clear bad traffic source
- add capacity if sustained
- fix fielddata usage
```

Avoid:

```text
- increasing breaker limits blindly
- retrying same huge request
- ignoring high heap root cause
```

### 9.5 Hardening

- query complexity limits;
- aggregation allowlist;
- max bucket controls;
- field mapping review;
- no text field sorting/aggs without keyword;
- bulk size guardrail;
- load tests for facets/export.

---

## 10. Failure Mode: Rejected Requests

### 10.1 Mechanism

Rejected requests indicate Elasticsearch thread pool queues are full or overloaded. Rejections are backpressure signals.

### 10.2 Symptoms

```text
EsRejectedExecutionException
429 responses
bulk rejected
search rejected
thread_pool.search.rejected increasing
thread_pool.write.rejected increasing
API timeout/error
```

### 10.3 Common Causes

- traffic spike;
- expensive queries;
- export jobs;
- bulk indexing storm;
- too many concurrent clients;
- hot shard;
- CPU/IO saturation;
- heap/GC pressure;
- small cluster capacity;
- retry storm.

### 10.4 Response

For search rejections:

```text
1. Identify query type/fingerprint.
2. Disable expensive feature if recent.
3. Throttle clients/tenants.
4. Pause exports.
5. Check hot nodes/shards.
6. Check CPU/heap/IO.
```

For write rejections:

```text
1. Reduce bulk concurrency.
2. Reduce bulk batch size.
3. Pause backfill/reindex.
4. Check merge pressure.
5. Check disk/heap.
6. Retry with backoff and jitter.
```

### 10.5 Hardening

- bounded client concurrency;
- retry budget;
- adaptive throttling;
- separate export workload;
- query guardrails;
- tenant quotas;
- autoscaling/capacity planning.

---

## 11. Failure Mode: High JVM Memory Pressure

### 11.1 Symptoms

```text
heap_used_percent high
old GC frequent
long GC pauses
circuit breaker trips
node slow/unresponsive
search latency high
rejections
cluster instability
```

High memory pressure causes Elasticsearch to spend CPU reclaiming memory through garbage collection, reducing CPU available for user requests and increasing response time.

### 11.2 Common Causes

- too many shards;
- too many segments;
- mapping explosion;
- high-cardinality aggregations;
- fielddata;
- large result windows;
- huge bulk requests;
- large cluster state;
- query cache/request cache pressure;
- script-heavy workload;
- many concurrent queries.

### 11.3 Immediate Mitigation

```text
- stop/pause heavy queries
- pause backfill/reindex
- reduce bulk size
- disable problematic aggregation
- reduce concurrency
- add nodes if capacity issue
- clear runaway workload
```

Avoid:

```text
- manually clearing caches as primary fix without root cause
- increasing heap beyond recommended patterns blindly
- restarting node before understanding cluster state
```

### 11.4 Hardening

- shard count review;
- mapping limits;
- aggregation limits;
- query result limits;
- index lifecycle cleanup;
- load testing;
- memory dashboard by node/index/query type.

---

## 12. Failure Mode: Long GC Pause

### 12.1 Symptoms

```text
node temporarily disappears
search timeout
cluster coordination instability
master election / node left logs
latency spikes
GC logs show long pause
```

### 12.2 Mechanism

When JVM pauses too long, Elasticsearch node cannot respond in time. Other nodes may treat it as unhealthy.

### 12.3 Common Causes

- heap pressure;
- old generation full;
- large object allocation;
- too many shards/segments;
- aggregation memory pressure;
- fielddata;
- bad JVM/heap sizing;
- host memory pressure/swap.

### 12.4 Response

```text
1. Check heap/GC metrics.
2. Check recent query/indexing spike.
3. Check circuit breakers.
4. Check shard/segment count.
5. Reduce workload pressure.
6. Review JVM/host settings after stabilization.
```

### 12.5 Hardening

- avoid swapping;
- proper heap sizing;
- reduce shard count;
- limit expensive aggregations;
- monitor old GC time;
- keep heap pressure below danger range.

---

## 13. Failure Mode: High CPU

### 13.1 Symptoms

```text
CPU high on one/many nodes
search latency high
indexing latency high
hot threads show busy operations
thread pool queue grows
```

### 13.2 Diagnosis

Use:

```http
GET /_nodes/hot_threads
GET /_nodes/stats
GET /_cat/thread_pool?v
```

Questions:

```text
One node or all nodes?
Search or indexing?
Query phase or fetch phase?
Merge running?
GC consuming CPU?
Recent deployment?
Traffic spike?
```

### 13.3 Causes

- expensive wildcard/regexp/fuzzy;
- script_score;
- large aggregations;
- nested queries;
- high indexing rate;
- segment merge;
- compression/decompression;
- GC;
- hot shard;
- too many concurrent searches.

### 13.4 Mitigation

```text
- throttle expensive traffic
- disable feature flag
- pause indexing/backfill
- reduce export concurrency
- add capacity
- optimize query/mapping later
```

---

## 14. Failure Mode: Hot Spotting / Hot Shard

### 14.1 Mechanism

Hot spotting occurs when resource utilization is unevenly distributed across nodes. Elastic documents that ongoing significantly unique utilization can create bottlenecks.

### 14.2 Symptoms

```text
one node CPU 95%, others 30%
one node search queue high
one node disk IO high
one shard receives most writes/queries
tenant-specific latency
routing-specific imbalance
```

### 14.3 Common Causes

- routing by tenant where one tenant huge;
- time-based index only current shard hot;
- skewed document IDs/routing keys;
- shard size imbalance;
- query pattern targets one shard;
- uneven shard allocation;
- node hardware mismatch;
- tier mismatch.

### 14.4 Diagnosis

```http
GET /_cat/shards?v
GET /_cat/nodes?v
GET /_nodes/stats
GET /_nodes/hot_threads
```

Check:

```text
Which shard is on hot node?
Which index?
Which tenant/routing key?
Search or write hot?
Is shard much larger?
Are replicas serving reads?
```

### 14.5 Mitigation

Short-term:

```text
- throttle noisy tenant
- move/relocate shard if safe
- add replica for read-heavy workload
- reduce heavy query path
- pause write-heavy job
```

Long-term:

```text
- redesign routing
- split index
- adjust shard count
- isolate tenants
- use time-based rollover
- review data tier placement
```

---

## 15. Failure Mode: Task Queue Backlog

### 15.1 Symptoms

```text
pending tasks high
cluster state updates delayed
management operations slow
shard allocation delayed
index creation slow
mapping update slow
```

### 15.2 Causes

- master pressure;
- too many index/mapping changes;
- mapping explosion;
- shard churn;
- ILM operations backlog;
- node instability;
- allocation problems;
- heavy management operations.

### 15.3 Diagnosis

```http
GET /_cluster/pending_tasks
GET /_tasks?detailed=true&actions=*
GET /_cat/thread_pool?v
```

### 15.4 Mitigation

```text
- stop creating many indices rapidly
- stop dynamic field explosion
- pause migrations/backfills if causing churn
- fix allocation blocker
- reduce shard count long-term
- stabilize nodes
```

---

## 16. Failure Mode: Mapping Explosion

### 16.1 Mechanism

Mapping explosion happens when an index has too many fields or deeply nested fields, increasing memory and cluster-state overhead. Elastic warns that too many fields can cause out-of-memory errors and difficult recovery situations.

### 16.2 Symptoms

```text
Limit of total fields [X] has been exceeded
mapping update slow
cluster state large
Kibana Discover slow
heap pressure
indexing failures
field_caps slow
search latency degraded
```

### 16.3 Common Causes

- dynamic mapping on arbitrary JSON;
- user-defined metadata keys;
- logs with unbounded field names;
- map/object fields expanded as individual fields;
- typo field names;
- deeply nested documents;
- multi-tenant custom attributes;
- indexing request payloads directly.

### 16.4 Immediate Mitigation

```text
- stop source producing new fields
- set dynamic: false/strict for affected paths if possible
- use flattened field for arbitrary key-value objects
- reject unknown fields at application boundary
- create new cleaned index if mapping already exploded
```

Often existing exploded mapping cannot be “unexploded” in-place. You may need a new index and reindex.

### 16.5 Hardening

```text
- explicit mappings
- dynamic templates with limits
- index.mapping.total_fields.limit with governance
- flattened for arbitrary metadata
- source payload validation
- field naming contract
- mapping diff checks in CI
```

---

## 17. Failure Mode: Slow Query Incident

### 17.1 Symptoms

```text
specific endpoint slow
slow log spike
ES took high
search thread pool busy
one query fingerprint dominates latency
```

### 17.2 Common Causes

- wildcard/prefix/regexp on large field;
- broad query + high-cardinality aggregation;
- deep pagination;
- large `from + size`;
- sort on expensive field;
- script_score;
- nested query on large nested arrays;
- highlighting huge fields;
- too many shards;
- query against many indices;
- permission filter huge terms list.

### 17.3 Diagnosis

```text
1. Compare API total vs ES took.
2. Check slow logs.
3. Capture query fingerprint.
4. Use profile API on representative query.
5. Check query phase vs fetch phase.
6. Check affected index/shards.
7. Check recent feature changes.
```

### 17.4 Mitigation

```text
- disable problematic query feature
- add minimum prefix length
- cap facets/page size
- force search_after/PIT instead of deep pagination
- reduce highlight
- throttle user/tenant
- route export to async job
```

### 17.5 Hardening

- query allowlist/DSL builder;
- query complexity scoring;
- slow query tests;
- top query benchmark;
- frontend guardrails;
- endpoint-specific limits.

---

## 18. Failure Mode: Bulk Indexing Storm

### 18.1 Symptoms

```text
write queue grows
write rejections
merge pressure high
disk IO high
refresh time high
search latency degraded
bulk latency high
```

### 18.2 Causes

- backfill too aggressive;
- reindex job launched during peak;
- batch import;
- retry storm;
- too many indexer instances;
- bulk size too large;
- refresh interval too low;
- replica count high during bulk load;
- analyzer expensive;
- n-gram fields.

### 18.3 Immediate Mitigation

```text
- pause/throttle backfill
- reduce bulk concurrency
- reduce bulk batch size
- increase refresh interval if acceptable
- temporarily reduce replicas for new bulk load if safe
- stop retry storm
```

### 18.4 Hardening

- adaptive bulk throttling;
- backfill runbook;
- off-peak scheduling;
- workload isolation;
- item-level failure metrics;
- freshness SLA-aware ingestion.

---

## 19. Failure Mode: Indexing Lag / Stale Search Results

### 19.1 Symptoms

```text
user updates data but search still old
freshness SLA breached
event lag high
bulk failures
DLQ growing
source/ES version mismatch
```

### 19.2 Causes

- event not produced;
- consumer lag;
- indexer down;
- bulk partial failure;
- mapper parsing error;
- alias points wrong index;
- refresh interval / refresh issue;
- out-of-order events;
- delete events missed;
- source-of-truth projection bug.

### 19.3 Diagnosis

Trace one entity:

```text
source update timestamp
outbox event timestamp
consumer timestamp
bulk request timestamp
bulk item result
ES document version
search visibility timestamp
```

### 19.4 Mitigation

```text
- restart/fix indexer if down
- reprocess DLQ
- replay events
- rebuild affected docs from source
- fix mapping/projection bug
- correct alias
```

### 19.5 Hardening

- end-to-end freshness metric;
- reconciliation job;
- DLQ alert;
- deterministic document ID;
- fetch-latest-on-event;
- versioning/out-of-order handling.

---

## 20. Failure Mode: Alias / Migration Mistake

### 20.1 Symptoms

```text
search returns old data
writes go to old index
reads go to empty index
some services see v1, others v2
rollback fails
document count suddenly drops
```

### 20.2 Causes

- read alias swapped, write alias not swapped;
- app queries physical index;
- alias points to multiple indices unintentionally;
- missing `is_write_index`;
- deployment config overrides alias;
- migration script partial failure;
- old index deleted too early.

### 20.3 Diagnosis

```http
GET /_alias/cases-search-read
GET /_alias/cases-search-write
GET /_cat/aliases?v
GET /_cat/indices?v
```

Check:

```text
read alias target
write alias target
is_write_index
physical index doc count
application config
recent migration log
```

### 20.4 Mitigation

```text
- atomically fix aliases
- stop writers briefly if needed
- replay missed events
- restore old index if deleted and snapshot exists
- rollback app config if physical index used
```

### 20.5 Hardening

- alias checks in startup;
- migration preflight;
- post-cutover smoke tests;
- no physical index in app config;
- alias swap script with verification.

---

## 21. Failure Mode: Corrupt Relevance After Deployment

### 21.1 Symptoms

```text
exact case number no longer top
important cases disappear
zero-result rate spike
new noisy results
user complaints after analyzer/ranking deploy
click-through drops
support tickets
```

### 21.2 Causes

- analyzer change;
- synonym change;
- boost change;
- function score bug;
- field name mismatch;
- query builder regression;
- ranking signal missing;
- stale ranking field;
- permission filter accidentally too strict;
- multi_match fields changed.

### 21.3 Immediate Mitigation

```text
- rollback ranking/query feature flag
- swap alias back if index migration caused it
- disable synonym set if possible
- restore previous query template
- force exact identifier fallback
```

### 21.4 Diagnosis

Use:

```text
golden query failures
query explain/profile
top-K diff
zero-result query list
field coverage check
analyzer _analyze comparison
```

### 21.5 Hardening

- golden query test suite;
- analyzer contract tests;
- relevance canary;
- top query shadow evaluation;
- ranking changes behind feature flags;
- domain expert review for critical queries.

---

## 22. Failure Mode: Permission Leak

### 22.1 Symptoms

```text
unauthorized document in hit
restricted facet count visible
highlight exposes sensitive text
autocomplete suggests restricted entity
export includes inaccessible data
cross-tenant result appears
```

### 22.2 Severity

Treat as SEV-1 or high security incident until proven otherwise.

### 22.3 Causes

- missing tenant filter;
- permission filter in `should` instead of `filter/must`;
- post_filter used incorrectly;
- aggregation not permission-filtered;
- stale permission field;
- alias points to admin index;
- source filtering missing;
- autocomplete index not permission-aware;
- export path bypasses search API guardrail.

### 22.4 Immediate Mitigation

```text
- disable affected search surface
- rollback deployment
- restore known-good alias/query template
- disable autocomplete/export if implicated
- preserve logs/evidence
- notify security/compliance process
```

Do not just patch silently if there is confirmed exposure.

### 22.5 Hardening

- mandatory tenant/security filter in query builder;
- query contract tests;
- permission matrix tests;
- facet/highlight/suggest/export security tests;
- source filtering;
- restricted logging;
- sampled audit.

---

## 23. Historical Failure Mode: Split Brain

### 23.1 Concept

Split brain historically refers to two groups of nodes both believing they can act as master/cluster authority, leading to divergent cluster states.

Modern Elasticsearch coordination has improved significantly compared to old versions, but the mental model remains useful:

```text
Cluster coordination failure can lead to serious data/availability risk.
```

### 23.2 Modern Operational Lessons

- use supported versions;
- configure master-eligible nodes correctly;
- avoid unstable networks;
- do not run production with fragile node topology;
- monitor master elections/node joins/leaves;
- avoid simultaneous restarts;
- understand quorum/coordination behavior for your version.

### 23.3 Symptoms To Watch

```text
frequent master election
nodes leaving/joining
cluster state publication slow
pending tasks high
coordination warnings
```

### 23.4 Response

```text
- stabilize network/nodes
- avoid mass restarts
- check master-eligible nodes
- check JVM/GC pauses
- check CPU pressure on master nodes
- escalate to platform/infra
```

---

## 24. Failure Mode: Snapshot / Restore Surprise

### 24.1 Symptoms

```text
snapshot failed
restore too slow
missing repository access
restore index name conflict
old snapshot lacks needed index
recovery exceeds RTO
```

### 24.2 Causes

- snapshots not tested;
- repository credentials expired;
- incompatible version/path;
- too much data;
- no restore runbook;
- index aliases not restored as expected;
- security/system indices misunderstood;
- storage throughput insufficient.

### 24.3 Hardening

- scheduled restore drills;
- snapshot success alerts;
- repository monitoring;
- RPO/RTO documented;
- restore scripts;
- alias restore validation;
- selective restore plan.

Part 028 will cover backup/restore/DR in more depth.

---

## 25. Incident Command Structure

For serious incident, define roles:

```text
Incident Commander:
  coordinates and makes priority decisions.

Operations Lead:
  runs ES/platform diagnostics and mitigations.

Application Lead:
  handles Java API, feature flags, traffic shaping.

Comms Lead:
  updates stakeholders.

Scribe:
  records timeline, commands, decisions.
```

Small teams may combine roles, but responsibilities should still be clear.

---

## 26. Communication Template

During incident:

```text
Status:
Search latency is elevated for case search.

Impact:
Investigators may see timeout on broad full-text queries. Exact case-number search still works.

Suspected cause:
Recent facet rollout causing expensive aggregations.

Mitigation:
Facet feature disabled. Monitoring recovery.

Next update:
At HH:MM or when status changes.
```

Avoid unsupported claims like:

```text
Everything is fixed
```

until metrics and smoke tests confirm.

---

## 27. Safe Command Practices

When running ES operational commands:

1. Record command and timestamp.
2. Prefer read-only diagnostic commands first.
3. Understand target index/alias.
4. Avoid wildcard destructive commands.
5. Use dry-run/explain where available.
6. Confirm production environment.
7. Have rollback command ready.

Dangerous patterns:

```http
DELETE /*
PUT /*/_settings ...
POST /_cluster/reroute ...
```

Use explicit names.

---

## 28. Diagnostic Command Kit

### Cluster

```http
GET /_cluster/health?pretty
GET /_cluster/stats?pretty
GET /_cluster/pending_tasks
GET /_cluster/allocation/explain
```

### Nodes

```http
GET /_cat/nodes?v
GET /_nodes/stats
GET /_nodes/hot_threads
```

### Shards

```http
GET /_cat/shards?v
GET /_cat/allocation?v
```

### Indices

```http
GET /_cat/indices?v
GET /{index}/_stats
GET /{index}/_segments
GET /{index}/_settings
GET /{index}/_mapping
```

### Thread Pools

```http
GET /_cat/thread_pool?v
GET /_nodes/stats/thread_pool
```

### Tasks

```http
GET /_tasks?detailed=true&actions=*
```

### Aliases

```http
GET /_cat/aliases?v
GET /_alias/{alias}
```

### Query Diagnosis

```http
GET /{index}/_search?profile=true
GET /{index}/_explain/{id}
```

---

## 29. Playbook: Search Latency Spike

### Symptoms

```text
Search p95/p99 up
timeouts
slow logs spike
user complaints
```

### First Checks

```text
API total vs ES took
affected endpoint/query type
cluster health
thread pool rejected
CPU/heap/disk
slow logs
recent deploy
heavy jobs
```

### Mitigation

```text
- disable expensive query features
- pause export/backfill
- throttle noisy tenant
- reduce page/facet/highlight
- rollback query deployment
```

### Recovery

```text
- confirm latency returns
- review slow query fingerprints
- add guardrail
- benchmark fixed query
```

---

## 30. Playbook: Indexing Stopped

### Symptoms

```text
freshness lag grows
bulk success drops
DLQ grows
updates not searchable
```

### First Checks

```text
indexer health
event consumer lag
bulk errors
write alias
write thread pool rejection
mapping errors
disk watermark
```

### Mitigation

```text
- fix indexer
- correct alias
- pause bad producer
- reprocess DLQ
- replay missed events
- reduce bulk pressure
```

### Recovery

```text
- verify lag decreases
- sample updated entities
- reconciliation job
```

---

## 31. Playbook: Cluster Red

### Symptoms

```text
cluster red
primary unassigned
search/indexing failures
```

### First Checks

```text
affected index/shard
allocation explain
node status
disk
recent node loss
snapshot availability
```

### Mitigation

```text
- restore missing node if possible
- free/add disk
- fix allocation rules
- restore from snapshot if data lost
- stop heavy workload
```

### Recovery

```text
- wait for shards assigned
- verify docs/search
- reconcile affected data
```

---

## 32. Playbook: Circuit Breaker

### Symptoms

```text
circuit_breaking_exception
data too large
heap high
query failures
```

### First Checks

```text
which breaker
heap pressure
query fingerprint
aggregation/result size
bulk size
fielddata
recent rollout
```

### Mitigation

```text
- reduce query/bulk size
- disable aggregation
- throttle concurrency
- block bad query pattern
- add capacity if sustained
```

### Recovery

```text
- verify heap drops
- add query guardrail
- fix mapping/fielddata issue
```

---

## 33. Playbook: Mapping Explosion

### Symptoms

```text
total fields limit exceeded
indexing failures
cluster state/mapping slow
heap pressure
```

### First Checks

```text
affected index
mapping field count
recent source payload change
dynamic mapping paths
field names pattern
```

### Mitigation

```text
- stop bad producer
- reject unknown fields
- set dynamic false/strict for future index
- create cleaned index
- reindex with flattened/controlled mapping
```

### Recovery

```text
- verify indexing resumes
- add mapping tests
- enforce payload contract
```

---

## 34. Playbook: Permission Leak

### Symptoms

```text
unauthorized hit/facet/highlight/suggestion/export
cross-tenant result
```

### First Checks

```text
affected endpoint
user principal
query DSL
alias target
permission fields
recent deployment/migration
logs for exposure scope
```

### Mitigation

```text
- disable endpoint/feature
- rollback query/index alias
- restore mandatory filters
- preserve evidence
- escalate security
```

### Recovery

```text
- patch tests
- run permission matrix
- audit exposure
- post-incident review
```

---

## 35. Java-Side Incident Controls

Your Java service should have runtime controls:

```text
feature flags:
- enableFacets
- enableHighlight
- enableFuzzy
- enableWildcard
- enableAutocomplete
- enableVectorSearch
- enableExport

limits:
- maxPageSize
- maxFacetCount
- maxExportRows
- maxConcurrentSearchPerTenant
- maxBulkInflight
- maxPermissionScopes

timeouts:
- searchTimeout
- bulkTimeout
- exportTimeout

routing:
- readAlias
- shadowAlias
- useNewRankingModel
```

These controls let you mitigate without redeploying.

---

## 36. Java Bulk Indexer Incident Pattern

Bad pattern:

```java
while (true) {
    try {
        bulkIndex(batch);
    } catch (Exception e) {
        bulkIndex(batch); // immediate retry
    }
}
```

Better pattern:

```java
BulkResult result = bulkIndex(batch);

if (result.hasRetriableFailures()) {
    retryWithBackoffAndJitter(result.retriableItems());
}

if (result.hasPermanentFailures()) {
    sendToDlq(result.permanentFailures());
}

if (result.rejectedRate() > threshold) {
    throttle.down();
}
```

Principles:

- partial success aware;
- retry only retriable failures;
- DLQ permanent failures;
- adaptive throttle;
- metrics for all outcomes;
- idempotent document IDs.

---

## 37. Java Search API Incident Pattern

Add defensive query building:

```java
public SearchPlan plan(SearchRequest request, UserContext user) {
    requireTenant(user);
    requirePermissionContext(user);

    QueryMode mode = classify(request);

    if (mode == QueryMode.WILDCARD && !featureFlags.wildcardEnabled()) {
        throw new BadRequestException("Wildcard search temporarily unavailable");
    }

    if (request.pageSize() > limits.maxPageSize()) {
        throw new BadRequestException("Page size too large");
    }

    if (request.facets().size() > limits.maxFacetCount()) {
        throw new BadRequestException("Too many facets");
    }

    return buildSafePlan(request, user);
}
```

The goal is to avoid letting arbitrary user input become arbitrary Elasticsearch workload.

---

## 38. Post-Incident Hardening

Every incident should produce at least one of:

- new alert;
- better dashboard;
- query guardrail;
- mapping test;
- relevance test;
- permission test;
- capacity adjustment;
- runbook update;
- feature flag;
- DLQ/reconciliation improvement;
- load test;
- migration process change.

If postmortem only says:

```text
Be more careful next time.
```

It failed.

---

## 39. Failure Mode Matrix

| Failure Mode | Primary Symptom | Immediate Control | Long-Term Fix |
|---|---|---|---|
| Red cluster | primary unassigned | resolve allocation / restore | capacity, snapshots, allocation policy |
| Yellow cluster | replica unassigned | fix replica allocation | zone/capacity/template |
| Disk watermark | writes blocked/shards unassigned | free/add disk, pause writes | ILM, retention, forecasting |
| Circuit breaker | data too large errors | reduce expensive request | query limits, mapping fixes |
| Rejected search | 429/timeouts | throttle/disable query | capacity, guardrails |
| Rejected write | bulk failures | reduce bulk pressure | adaptive indexer |
| High heap | GC/circuit breaker | reduce workload | shard/mapping/query redesign |
| Hot shard | one node overloaded | throttle/reroute | routing/shard redesign |
| Mapping explosion | field limit exceeded | stop bad producer | explicit mapping/flattened |
| Slow query | slow logs | disable feature | query optimization |
| Bulk storm | write pressure | pause/throttle | backfill governance |
| Stale result | freshness lag | replay/reindex | reconciliation |
| Alias mistake | wrong data | fix alias | migration preflight |
| Relevance regression | bad ranking | rollback query/index | golden tests |
| Permission leak | unauthorized data | disable/rollback | security test matrix |

---

## 40. Exercises

### Exercise 1 — Red Cluster Triage

Given:

```text
cluster health: red
unassigned_shards: 3
allocation explain: disk threshold exceeded
affected index: cases-search-v009
```

Answer:

1. What is the immediate risk?
2. What commands do you run next?
3. What actions are safe?
4. What actions are dangerous?
5. What hardening should follow?

---

### Exercise 2 — Circuit Breaker Incident

Given:

```text
circuit_breaking_exception
heap 91%
recent deployment added 12 facets
slow logs show large terms aggregation
```

Answer:

1. Likely cause.
2. Immediate mitigation.
3. Long-term fix.
4. What tests/guardrails should be added?

---

### Exercise 3 — Hot Tenant

Given:

```text
tenant-a latency p99 = 7s
tenant-b latency p99 = 600ms
one node CPU 98%
shard for tenant-a index on hot node
```

Answer:

1. What is the failure mode?
2. What short-term mitigation is possible?
3. What architecture change might be needed?

---

### Exercise 4 — Permission Leak

Given:

```text
hits are correct
facet count includes restricted cases
query uses post_filter for permission
```

Answer:

1. Why is this a leak?
2. How should query be changed?
3. What test should prevent recurrence?

---

## 41. Summary

Elasticsearch incidents are rarely solved by memorizing one command. They require a disciplined model:

```text
symptom → mechanism → control → recovery → hardening
```

The most important operational lessons:

1. Cluster green is not enough.
2. Red/yellow cluster must be diagnosed via shard allocation.
3. Disk, heap, CPU, and thread pools are connected.
4. Rejections are backpressure, not just errors to retry.
5. Circuit breakers protect the cluster; do not bypass them blindly.
6. Mapping explosion is usually a governance failure.
7. Slow queries need query fingerprinting and guardrails.
8. Bulk storms need adaptive throttling.
9. Stale search requires end-to-end freshness tracing.
10. Alias mistakes are preventable with migration preflight.
11. Relevance regression is a production incident.
12. Permission leaks are security incidents, including facets/highlights/suggestions/exports.
13. Incident response must produce hardening, not just recovery.

Top-tier Elasticsearch engineering is the ability to preserve user trust under failure.

---

## 42. What Comes Next

Part 028 will cover:

```text
Backup, Restore, Disaster Recovery, and Data Repair
```

Topics:

- snapshot repository;
- snapshot lifecycle management;
- restore strategy;
- partial restore;
- cross-cluster restore;
- disaster recovery planning;
- RPO/RTO;
- rebuild-from-source-of-truth strategy;
- snapshot vs reindex-from-canonical-store;
- data consistency verification;
- repair pipeline;
- operational drills;
- DR failure modes.

---

## References

- Elastic Docs — Red or yellow cluster health status: https://www.elastic.co/docs/troubleshoot/elasticsearch/red-yellow-cluster-status
- Elastic Docs — Diagnose unassigned shards: https://www.elastic.co/docs/troubleshoot/elasticsearch/diagnose-unassigned-shards
- Elastic Docs — Circuit breaker errors: https://www.elastic.co/docs/troubleshoot/elasticsearch/circuit-breaker-errors
- Elastic Docs — High JVM memory pressure: https://www.elastic.co/docs/troubleshoot/elasticsearch/high-jvm-memory-pressure
- Elastic Docs — Mapping explosion: https://www.elastic.co/docs/troubleshoot/elasticsearch/mapping-explosion
- Elastic Docs — Hot spotting: https://www.elastic.co/docs/troubleshoot/elasticsearch/hotspotting
- Elastic Docs — Rejected requests: https://www.elastic.co/docs/troubleshoot/elasticsearch/rejected-requests
- Elastic Docs — Task queue backlog: https://www.elastic.co/docs/troubleshoot/elasticsearch/task-queue-backlog
- Elastic Docs — Fix common cluster issues: https://www.elastic.co/docs/troubleshoot/elasticsearch/fix-common-cluster-issues
- Elastic Docs — Size your shards: https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/size-shards


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-026.md">⬅️ Part 026 — Observability and Production Operations</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-028.md">Part 028 — Backup, Restore, Disaster Recovery, and Data Repair ➡️</a>
</div>
