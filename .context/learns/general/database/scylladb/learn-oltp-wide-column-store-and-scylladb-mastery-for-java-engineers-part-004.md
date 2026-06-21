# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-004.md

# Part 004 — ScyllaDB Architecture: Shard-per-Core, Seastar, Reactor, dan Shared-Nothing Node

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `004`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: memahami arsitektur internal ScyllaDB per node — shard-per-core, Seastar, shared-nothing, reactor model, scheduling, memory ownership, cross-shard cost, dan implikasi ke Java service/driver.

---

## 0. Posisi Part Ini dalam Seri

Di part 003 kita membahas arsitektur cluster level:

```text
partition key -> token -> token range -> replica set -> coordinator -> consistency level
```

Part 003 melihat cluster sebagai kumpulan node.

Part ini membuka isi satu node ScyllaDB.

ScyllaDB kompatibel dengan Cassandra/CQL pada level API dan data model, tetapi arsitektur eksekusinya sangat berbeda dari Apache Cassandra yang berbasis JVM. Perbedaan ini bukan kosmetik. Ini memengaruhi:

- p99 latency,
- throughput,
- CPU utilization,
- memory behavior,
- scheduling,
- client routing,
- observability,
- operational tuning,
- cara kita membaca bottleneck.

Mental model part ini:

```text
Cluster-level distribution decides which node owns data.
Node-level shard architecture decides which CPU core serves data.
```

Jika part 003 menjawab:

```text
Data ini berada di node mana?
```

part 004 menjawab:

```text
Di dalam node itu, shard/core mana yang bertanggung jawab?
```

---

## 1. Kenapa ScyllaDB Dibuat Berbeda dari Cassandra?

Apache Cassandra membuktikan model wide-column distributed database sangat berguna:

- scale-out,
- tunable consistency,
- high write throughput,
- CQL,
- multi-DC replication,
- partition-oriented modeling.

Tetapi Cassandra klasik dibangun di atas JVM dan concurrency model yang lebih tradisional. Pada hardware modern dengan banyak core, NVMe cepat, dan network cepat, bottleneck dapat muncul dari:

- garbage collection,
- lock contention,
- shared mutable state,
- thread scheduling overhead,
- cache-line bouncing,
- kernel overhead,
- unbounded queues,
- inefficient per-core utilization,
- unpredictable latency spikes.

ScyllaDB mengambil pendekatan berbeda:

```text
Cassandra-compatible API/data model
+
C++ engine
+
Seastar asynchronous framework
+
shard-per-core shared-nothing architecture
```

Tujuan utamanya:

```text
predictable low latency + high throughput + high core utilization
```

---

## 2. Shard-per-Core in One Sentence

Satu node ScyllaDB membagi dirinya menjadi shard internal, biasanya satu shard per CPU core.

```text
Node
├── Shard 0 / Core 0
├── Shard 1 / Core 1
├── Shard 2 / Core 2
├── Shard 3 / Core 3
...
```

Setiap shard memiliki resource dan execution context sendiri.

Simplifikasi:

```text
one CPU core -> one reactor thread -> one shard of the database
```

Seastar documentation describes a shared-nothing SMP model where each core runs independently; memory, data structures, and CPU time are not shared, and inter-core communication uses explicit message passing. ScyllaDB applies this model to database execution.

---

## 3. Shared-Nothing: Prinsip Dasar

Shared-nothing berarti setiap shard/core mengelola state-nya sendiri sebisa mungkin.

Bukan:

```text
many threads -> shared data structures -> locks
```

Tetapi:

```text
core 0 owns data structure A
core 1 owns data structure B
core 2 owns data structure C
communication via message passing
```

Tujuannya menghindari:

- locks,
- mutex contention,
- cache-line bouncing,
- false sharing,
- unpredictable scheduler interference.

### 3.1 Kenapa Locks Mahal?

Di hardware modern, cost lock bukan hanya instruksi lock itu sendiri.

Cost bisa berasal dari:

```text
core 0 modifies cache line
core 1 needs same cache line
cache coherence protocol transfers ownership
core 2 waits
memory barrier prevents reordering
scheduler context switch happens
```

Semakin banyak core, semakin mahal shared mutable state.

Shared-nothing mencoba menghindari pola ini.

---

## 4. Reactor Model

Seastar menggunakan reactor model.

Sederhana:

```text
Each core runs an event loop.
The event loop handles asynchronous tasks.
Tasks voluntarily yield via futures/promises.
```

Bukan model:

```text
one request -> one blocking thread
```

Tetapi:

```text
one core event loop -> many asynchronous continuations
```

Konseptual:

```text
while (running) {
    process_ready_network_events();
    process_ready_disk_events();
    run_scheduled_tasks();
    poll_timers();
    submit_async_io();
}
```

ScyllaDB membangun database engine di atas pola ini.

### 4.1 Java Engineer Analogy

Kalau familiar dengan Netty:

```text
Netty event loop group
```

atau Node.js:

```text
event loop
```

atau reactive runtime:

```text
non-blocking continuations
```

maka Seastar punya kemiripan ide: jangan block thread; jalankan async state machine.

Tetapi Seastar lebih dekat ke hardware:

- per-core reactor,
- explicit memory ownership,
- custom scheduler,
- kernel-bypass/advanced IO ideas depending platform,
- database engine aware of per-core execution.

Jangan samakan mentah-mentah dengan Java reactive stack. Prinsipnya mirip, constraint-nya lebih low-level.

---

## 5. Per-Shard Ownership

Setiap shard menangani subset token/data.

Konseptual:

```text
partition key -> token -> node replica -> shard id
```

Di cluster level, token menentukan node replica.

Di node level, token juga dapat menentukan shard mana yang seharusnya melayani partition tersebut.

```text
CASE-123
  -> token T
  -> replica node Node B
  -> owning shard Shard 7 on Node B
```

Ini penting untuk performa.

Jika request masuk ke Node B tapi koneksi client mendarat ke shard 2, sementara data milik shard 7, ScyllaDB perlu melakukan cross-shard forwarding.

```text
Client connection -> Shard 2
Shard 2 forwards to Shard 7
Shard 7 executes
Shard 7 returns to Shard 2
Shard 2 returns to client
```

Shard-aware driver berusaha menghindari ini dengan mengirim request langsung ke shard yang tepat.

---

## 6. Cross-Shard Communication Cost

Cross-shard communication tidak gratis.

Ia menambah:

- scheduling hop,
- message passing overhead,
- cache locality loss,
- queueing,
- latency variance.

Diagram buruk:

```text
Client
  |
  v
Node B / Shard 2
  |
  v
Node B / Shard 7
  |
  v
Storage/data owned by Shard 7
```

Diagram lebih baik:

```text
Client
  |
  v
Node B / Shard 7
  |
  v
Storage/data owned by Shard 7
```

Dari perspektif average latency, hop ekstra mungkin terlihat kecil. Dari perspektif p99/p999, hop ekstra dan queueing bisa signifikan.

---

## 7. Token-Aware vs Shard-Aware Routing

### 7.1 Token-Aware

Token-aware driver tahu:

```text
partition key -> token -> replica node
```

Jadi ia bisa memilih node yang tepat.

### 7.2 Shard-Aware

Shard-aware driver tahu lebih jauh:

```text
partition key -> token -> replica node -> shard/core
```

Jadi ia bisa memilih koneksi ke shard yang tepat pada node tersebut.

ScyllaDB Java driver documentation states that the driver is shard-aware and can select a connection to a particular shard based on the token, reducing latency because the server does not need to pass data between shards.

### 7.3 Why This Matters for Java

Jika Java service menggunakan driver yang tidak shard-aware, database masih bisa bekerja, tetapi:

- request bisa mengalami cross-shard forwarding,
- p99 latency lebih buruk,
- CPU usage lebih tinggi,
- beberapa shard bisa menerima lebih banyak connection work,
- observability lebih sulit.

Aplikasi ScyllaDB production sebaiknya tidak memperlakukan driver sebagai “generic Cassandra client” tanpa mengecek shard awareness, driver version, dan load balancing policy.

---

## 8. Request Path with Shard Awareness

Contoh query:

```sql
SELECT status, version
FROM case_current_by_id
WHERE case_id = ?;
```

Flow ideal:

```text
1. Java app binds case_id.
2. Driver computes routing key.
3. Driver computes token.
4. Driver selects replica node.
5. Driver selects connection to target shard on that node.
6. Request arrives at owning shard.
7. Shard executes read locally.
8. Response returns.
```

Flow non-ideal:

```text
1. Driver sends request to arbitrary node/shard.
2. Coordinator computes replica set.
3. Request forwarded to owning node.
4. Request lands on non-owning shard.
5. Cross-shard forward to owning shard.
6. Owning shard executes.
7. Response hops back.
```

Perbedaan ini menjelaskan kenapa driver configuration adalah bagian dari database architecture, bukan detail library biasa.

---

## 9. CPU Pinning

ScyllaDB sangat memperhatikan mapping CPU core ke shard.

CPU pinning berarti proses/thread/shard diikat ke CPU tertentu agar:

- cache locality lebih baik,
- scheduler tidak memindahkan thread sembarangan,
- latency lebih predictable,
- per-core ownership stabil.

ScyllaDB menyediakan tooling untuk melihat mapping CPU ke shard.

Operational implication:

```text
Changing CPU topology, container limits, hyperthreading config, or cpuset can affect shard layout and performance.
```

Jika menjalankan ScyllaDB di container/dev environment tanpa memahami CPU pinning, hasil benchmark bisa misleading.

---

## 10. Memory Ownership

Shared-nothing juga berarti memory ownership didesain per shard.

Alih-alih semua thread mengakses heap global, ScyllaDB berusaha menjaga data structure tetap dekat dengan shard yang memilikinya.

Manfaat:

- locality,
- fewer locks,
- fewer cache bounces,
- predictable allocation behavior.

Kontras dengan JVM:

```text
large shared heap
garbage collection
object graph movement/marking
GC pause/pressure
```

ScyllaDB sebagai C++/Seastar engine tidak memakai JVM GC seperti Cassandra. Ini salah satu alasan latency predictability bisa lebih baik.

Namun bukan berarti tidak ada memory pressure. Memory pressure tetap ada, hanya bentuknya berbeda:

- cache pressure,
- memtable pressure,
- allocator pressure,
- compaction memory,
- read amplification,
- large rows,
- large partitions,
- large result pages.

---

## 11. Per-Shard Scheduling

Setiap shard memiliki scheduler sendiri untuk mengatur task seperti:

- foreground reads,
- foreground writes,
- compaction,
- streaming,
- repair,
- flush,
- maintenance tasks.

Database tidak hanya mengeksekusi user query. Ia juga melakukan pekerjaan internal.

Jika background work tidak diatur, p99 foreground query bisa rusak.

ScyllaDB architecture emphasizes custom schedulers for CPU and I/O processing in the shard-per-core design.

### 11.1 Why Scheduling Matters

Bayangkan shard menerima:

```text
- user read requests,
- writes,
- compaction work,
- streaming from node bootstrap,
- repair tasks,
- cache population,
- tombstone-heavy reads.
```

Jika semuanya berebut CPU/IO tanpa prioritas, foreground latency naik.

Scheduling bertujuan menjaga fairness dan isolasi workload relatif.

---

## 12. IO Scheduling

Disk modern seperti NVMe sangat cepat, tapi tetap bukan infinite resource.

ScyllaDB perlu mengatur:

- read IO,
- write IO,
- commitlog IO,
- SSTable flush,
- compaction IO,
- streaming IO,
- repair IO.

IO scheduler membantu agar background IO tidak sepenuhnya memakan kapasitas foreground request.

Dari sisi application engineer, ini berarti:

```text
Jika p99 naik saat compaction/repair/streaming, jangan langsung menyimpulkan query model salah.
Tapi query model buruk juga bisa memperburuk background pressure.
```

---

## 13. Commitlog, Memtable, SSTable dalam Konteks Shard

Part storage internals akan dibahas lebih detail di part 006. Di sini cukup pahami:

```text
Each shard has its own portion of write/read/storage work.
```

Satu write ke partition tertentu seharusnya diarahkan ke shard pemilik partition.

Shard tersebut menangani:

- mutation,
- memtable update,
- commitlog coordination,
- flush participation,
- SSTable ownership/access,
- cache.

Ini membuat database bisa menggunakan banyak core secara parallel asalkan data model menyebarkan token/partition.

---

## 14. Parallelism: Cluster x Node x Shard

ScyllaDB scalability bekerja di beberapa level:

```text
Level 1: many partitions
Level 2: spread across token ranges
Level 3: spread across nodes
Level 4: spread across shards/cores inside each node
Level 5: async IO and scheduling inside shard
```

Jika workload punya banyak partition key dengan distribusi baik:

```text
many keys -> many tokens -> many nodes -> many shards
```

Jika workload punya satu hot key:

```text
one key -> one token -> one replica set -> limited shard path
```

Shard-per-core tidak menyelamatkan model dengan satu hot partition ekstrem.

---

## 15. Hot Shard

Selain hot partition, ada hot shard.

Hot shard terjadi ketika satu shard/core menerima beban tidak proporsional.

Penyebab:

- hot partition,
- token distribution skew,
- driver routing imbalance,
- non-shard-aware connections,
- large partition on one shard,
- compaction pressure localized,
- uneven data distribution,
- tenant skew,
- bad bucketing.

Gejala:

```text
one shard CPU high
other shards idle
p99 high for subset keys
node average CPU looks okay
cluster average looks okay
```

Ini penting:

> Average node CPU can hide one pegged shard.

Jika node 32 core punya satu shard 100% CPU dan lainnya 20%, dashboard node-level bisa terlihat “tidak penuh”, tetapi query untuk token di shard itu lambat.

---

## 16. Why Per-Core Metrics Matter

Untuk ScyllaDB, observability harus melihat per-shard/per-core signal.

Node-level metrics berguna, tapi tidak cukup.

Perlu melihat:

- per-shard CPU,
- per-shard latency,
- per-shard queue length,
- per-shard cache behavior,
- per-shard compaction pressure,
- per-shard IO pressure,
- per-shard request distribution.

Jika hanya melihat:

```text
node CPU = 45%
```

kita bisa melewatkan:

```text
shard 17 CPU = 100%
```

Top-tier troubleshooting melihat distribusi, bukan hanya average.

---

## 17. Cache Locality

Shared-nothing architecture membantu cache locality.

Jika shard yang sama sering mengakses data miliknya sendiri, CPU cache dan memory locality lebih baik.

Cross-shard/cross-core access dapat merusak locality karena data harus berpindah antar cache/core.

Locality matters for:

- p99 latency,
- CPU efficiency,
- predictable throughput.

Application-level connection routing bisa mempengaruhi locality melalui shard-aware driver.

---

## 18. ScyllaDB vs Cassandra: Architecture Contrast

High-level contrast:

| Area | Apache Cassandra Classic | ScyllaDB |
|---|---|---|
| Language/runtime | Java/JVM | C++ |
| Async engine | JVM/thread based architecture | Seastar async framework |
| Concurrency | More shared-state/thread-pool oriented | shard-per-core shared-nothing |
| GC | JVM GC considerations | no JVM GC |
| CPU model | traditional multi-threading | one reactor thread per core/shard |
| Client optimization | token-aware drivers | shard-aware drivers |
| Latency goal | good distributed DB latency | predictable low p99 focus |
| API/model | CQL/Cassandra | Cassandra-compatible CQL plus Scylla features |

This table is intentionally simplified. Cassandra has evolved significantly too. The point is not “Cassandra bad, Scylla good.” The point is:

```text
ScyllaDB's internal performance model is different enough that engineers must learn it explicitly.
```

---

## 19. What Shard-per-Core Does Not Mean

### 19.1 It Does Not Mean One Partition Can Use All Cores

A single partition usually maps to a specific shard path.

If one partition is extremely hot, it cannot automatically use all cores as if it were parallelized across the whole node.

### 19.2 It Does Not Mean No Queues

There are still queues:

- network queues,
- per-shard task queues,
- IO queues,
- driver queues,
- application queues.

Shared-nothing reduces some contention, but does not remove queueing theory.

### 19.3 It Does Not Mean Infinite Low Latency

Latency can still rise due to:

- hot key,
- large partitions,
- tombstones,
- compaction debt,
- repair/streaming,
- disk saturation,
- network issues,
- bad driver routing,
- bad consistency choice,
- large pages,
- oversized payloads,
- client overload.

### 19.4 It Does Not Mean Application Can Ignore Backpressure

A fast database can be overloaded faster.

If Java service produces unbounded concurrent requests, ScyllaDB can still return timeouts/overloaded errors.

---

## 20. Seastar Future/Continuation Mental Model

Seastar programming model uses futures/continuations.

Conceptually:

```text
do_read()
  .then(process_result)
  .then(send_response)
```

Instead of blocking:

```text
read_from_disk(); // waits
process_result();
```

The reactor can do other work while IO is pending.

This is how a single core can manage many in-flight operations without one thread per request.

Java analogy:

```java
CompletableFuture
```

or reactive chain:

```java
Mono<T>.flatMap(...)
```

But with important caveat:

```text
Seastar is engineered as low-level runtime for high-performance servers.
```

It is not just application-level async syntax.

---

## 21. Blocking Is Poisonous in Reactor Systems

In event-loop/reactor systems, blocking a reactor thread hurts all tasks on that shard/core.

If a task blocks:

```text
Shard event loop cannot process other ready events.
```

ScyllaDB internals avoid blocking operations by design.

Java engineers should recognize similar principle in their own services:

- do not block Netty event loop,
- do not do blocking JDBC/file IO on reactive event loop,
- do not run CPU-heavy serialization on event loop,
- do not create callback chains with hidden blocking.

A ScyllaDB-backed Java service should not ruin end-to-end latency with application-side blocking.

---

## 22. Connection Model Implications

Because shard-aware routing may need connections to specific shards, connection pool configuration matters.

Bad mental model:

```text
More connections always better.
```

Better:

```text
Enough connections to cover nodes/shards and concurrency,
but not so many that connection overhead and queueing become harmful.
```

Driver defaults are usually designed with this in mind, but production engineers should inspect:

- driver version,
- shard awareness enabled,
- local DC,
- load balancing policy,
- contact points,
- reconnection policy,
- pooling,
- request timeout,
- speculative execution,
- retry policy,
- metrics.

---

## 23. Load Balancers Can Break Topology Intelligence

Putting a generic TCP load balancer between application and ScyllaDB can hide cluster topology from the driver.

If driver cannot see real nodes, it may lose:

- token-aware routing,
- shard-aware routing,
- node health awareness,
- local DC awareness,
- per-host pooling,
- schema/topology metadata accuracy.

This can increase coordinator forwarding and latency.

Rule of thumb:

```text
ScyllaDB drivers should connect to cluster nodes as database nodes, not as anonymous backend pool members.
```

There are advanced deployment patterns, but never assume ordinary L4/L7 load balancing is harmless.

---

## 24. Local DC Awareness

Shard awareness optimizes inside node.

Token awareness optimizes node selection.

DC awareness optimizes region selection.

For multi-DC:

```text
local app -> local DC nodes -> local shards
```

Wrong configuration can cause:

- cross-region reads,
- high latency,
- unexpected consistency behavior,
- higher egress cost,
- failover surprises.

Java driver local datacenter setting is production-critical.

---

## 25. Scheduling Groups and Workload Isolation

ScyllaDB has mechanisms for scheduling and workload prioritization. Conceptually, background and foreground work should not be treated equally.

Even without going into every ScyllaDB knob, understand categories:

```text
foreground reads/writes
compaction
streaming
repair
maintenance
```

Production operation requires balancing them.

If repair consumes too much IO/CPU, user p99 suffers.

If compaction starves, read amplification and disk usage grow.

If streaming is too aggressive, normal traffic suffers.

If foreground traffic is unbounded, maintenance never catches up.

---

## 26. The “One Shard Is Burning” Incident Pattern

Common incident:

```text
Dashboard:
cluster CPU average 48%
disk average okay
overall QPS normal

User impact:
p99 for one endpoint spikes
only certain tenants/cases affected
timeouts concentrated on a few keys

Root cause:
one partition/bucket maps to one shard
that shard is pegged
```

Debug path:

```text
1. Identify slow query/table.
2. Identify partition keys affected.
3. Estimate key frequency.
4. Map keys to token/shard if possible.
5. Check per-shard metrics.
6. Check partition size/tombstones.
7. Check driver routing.
8. Check recent workload skew.
9. Mitigate with throttling/bucketing/query limit.
10. Plan data model change if structural.
```

The key insight:

```text
A distributed database can be locally overloaded in a tiny part of its topology.
```

---

## 27. The “Non-Shard-Aware Client” Pattern

Symptoms:

- increased p99 after driver change,
- higher CPU for same QPS,
- more cross-shard forwarding,
- uneven shard load,
- connection count strange,
- more coordinator work.

Causes:

- using generic Cassandra driver without Scylla extensions,
- shard awareness disabled,
- wrong port/config,
- NAT/source-port behavior interfering,
- connection through load balancer,
- old driver version,
- driver metadata not refreshed.

Mitigation:

- use supported ScyllaDB driver/version,
- verify shard awareness,
- avoid topology-hiding LB,
- configure local DC,
- inspect driver metrics,
- test p99 under realistic load.

---

## 28. The “Async App, Blocking Bottleneck” Pattern

Java service uses async driver but still blocks elsewhere:

```java
CompletionStage<ResultSet> future = session.executeAsync(stmt);

// later:
future.toCompletableFuture().get(); // blocks request thread
```

Blocking may be fine in bounded servlet model if deliberate, but dangerous if it occurs in event loop/reactive path.

Other hidden bottlenecks:

- JSON serialization on event loop,
- logging huge payloads synchronously,
- blocking auth call,
- synchronized cache,
- unbounded executor,
- bounded executor with huge queue,
- retry without backoff,
- parallel stream over large result set.

End-to-end architecture matters.

A shard-aware ScyllaDB driver cannot fix a Java service with broken concurrency control.

---

## 29. Backpressure Across Layers

ScyllaDB architecture is optimized, but backpressure must exist across all layers:

```text
HTTP ingress
  -> application worker/event loop
  -> business executor
  -> driver request queue
  -> TCP connection
  -> ScyllaDB shard
  -> disk/network
```

If any layer has unbounded queue, overload becomes latency rather than rejection.

Better:

- bounded concurrency per endpoint,
- bounded DB in-flight requests,
- per-tenant rate limiting,
- timeout budgets,
- circuit breaker,
- retry budget,
- bulkhead,
- overload response,
- queue length metrics.

---

## 30. Query Shape Still Dominates

Shard-per-core improves execution efficiency. It does not make bad query shapes good.

Bad:

```sql
SELECT * FROM events WHERE tenant_id = ? ALLOW FILTERING;
```

Bad:

```text
read 1 million clustering rows then filter in application
```

Bad:

```text
single daily bucket for tenant with 200k writes/sec
```

Bad:

```text
page size 50,000 rows for interactive API
```

Good:

```text
bounded partition read
known partition key
reasonable clustering range
small page size
good cardinality
bucketed hot entities
idempotent writes
```

Architecture helps most when data model cooperates.

---

## 31. Memory and Large Result Sets

Large result sets hurt multiple layers:

- ScyllaDB shard memory,
- network buffer,
- driver memory,
- Java heap,
- GC,
- JSON serialization,
- HTTP response,
- client/browser.

ScyllaDB can be fast, but if you ask for 100 MB result page, p99 will suffer.

Use:

- LIMIT,
- paging,
- narrow columns,
- query-specific tables,
- streaming carefully,
- separate export path from interactive path.

Never design an interactive endpoint whose success depends on pulling unbounded partitions.

---

## 32. Tail Latency and Queueing

Even if each shard is efficient, queueing theory still applies.

When utilization approaches saturation, latency increases non-linearly.

Simplified intuition:

```text
utilization 50% -> low queueing
utilization 70% -> manageable
utilization 85% -> tail grows
utilization 95% -> p99 explodes
```

This is why:

- headroom matters,
- per-shard headroom matters,
- retry storms are dangerous,
- background work needs control,
- hot shards are severe.

---

## 33. Capacity Planning with Shards

Capacity is not only:

```text
cluster has N nodes
```

It is:

```text
nodes x shards x per-shard sustainable workload
```

But not every workload uses all shards evenly.

Capacity planning inputs:

- number of nodes,
- cores per node,
- shard count,
- RF,
- CL,
- read/write ratio,
- row size,
- partition distribution,
- hot key distribution,
- compaction strategy,
- retention/TTL,
- client concurrency,
- expected p99 target.

Naive planning:

```text
Node can do X ops/sec, so 10 nodes can do 10X.
```

Better:

```text
For this key distribution and CL/RF, do requests spread across nodes/shards?
What is hottest partition/bucket?
What is hottest tenant?
What is per-shard p99 at expected load?
```

---

## 34. Operational Tuning Boundaries

ScyllaDB has many tunable aspects, but production tuning should not be guesswork.

Principle:

```text
Tune only after identifying bottleneck layer.
```

Examples:

| Symptom | Possible Layer |
|---|---|
| One shard CPU 100% | hot key, bad routing, local compaction |
| All shards CPU high | cluster underprovisioned or query expensive |
| Disk high | compaction, read amplification, large scans |
| Network high | large results, repair/streaming, cross-DC |
| Driver timeout | DB slow, client queueing, network, bad timeout budget |
| High GC in Java | result size, object churn, blocking, heap pressure |
| Uneven node load | token distribution, routing, topology, workload skew |

Do not solve every problem by increasing timeout. That often converts failure into hidden queueing.

---

## 35. ScyllaDB in Containers

For learning/dev, containers are convenient.

For production-like performance testing, containers can distort:

- CPU pinning,
- cpuset visibility,
- disk IO,
- network path,
- clock,
- memory limits,
- NUMA topology,
- kernel settings.

This does not mean “never use containers.” It means:

```text
Do not infer production latency from casual Docker setup.
```

For serious benchmarking, control hardware, OS, disk, network, CPU, and driver.

---

## 36. NUMA Awareness Preview

On multi-socket machines, NUMA matters:

```text
core local memory access faster
remote socket memory access slower
```

Shared-nothing helps locality, but wrong placement/config can still hurt.

Operationally:

- know hardware topology,
- avoid accidental cross-socket memory penalties,
- follow ScyllaDB setup recommendations,
- benchmark on realistic hardware.

We will revisit node sizing and OS tuning in operations parts.

---

## 37. Java Service Design Implications

### 37.1 Prefer Explicit Async Boundaries

If using async driver, propagate async carefully.

Bad:

```java
ResultSet rs = session.execute(stmt); // blocking in high-concurrency endpoint
```

Maybe acceptable in simple bounded worker model, but be explicit.

Better for high concurrency:

```java
CompletionStage<AsyncResultSet> result =
    session.executeAsync(boundStatement);
```

Then ensure downstream code does not block event loops.

### 37.2 Bound In-Flight Requests

Bad:

```java
for (Key key : keys) {
    futures.add(session.executeAsync(query.bind(key)));
}
return CompletableFuture.allOf(futures...);
```

If `keys` is 10,000, this is self-inflicted overload.

Better:

```text
limit concurrency
batch logically only when safe
use paging
design better table
avoid unbounded fanout
```

### 37.3 Expose Query Shape in Method Names

Bad:

```java
List<Event> searchEvents(EventFilter filter);
```

Better:

```java
List<Event> findLatestEventsByCase(CaseId caseId, int limit);
List<Event> findEventsByCaseAndDay(CaseId caseId, LocalDate day, PageToken token);
```

### 37.4 Record Consistency and Idempotency

Repository methods should document:

```text
read CL
write CL
idempotent or not
timeout semantics
source-of-truth or derived table
```

---

## 38. Practical Architecture Example

Use case:

```text
Read current case status by case_id at high QPS.
```

Table:

```sql
CREATE TABLE case_current_by_id (
    case_id text PRIMARY KEY,
    status text,
    version bigint,
    updated_at timestamp
);
```

Request path:

```text
Java app
  -> Scylla Java driver
  -> compute token(case_id)
  -> select replica node
  -> select shard connection
  -> owning shard reads partition
  -> response
```

If everything aligns:

```text
low hops
good locality
bounded read
predictable latency
```

If not:

```text
wrong driver/load balancer
  -> arbitrary node
  -> coordinator forwarding
  -> non-owning shard
  -> cross-shard hop
  -> higher p99
```

Even same CQL can have different latency depending on routing.

---

## 39. Practical Hot Tenant Example

Use case:

```text
Append events by tenant.
```

Bad table:

```sql
CREATE TABLE tenant_events (
    tenant_id text,
    event_time timestamp,
    event_id uuid,
    payload text,
    PRIMARY KEY (tenant_id, event_time, event_id)
);
```

One huge tenant:

```text
tenant_id = "BANK_BIG"
writes = 80k/sec
```

All writes for that tenant target same partition key.

Cluster-level:

```text
one token
one replica set
```

Node-level:

```text
owning shard(s) overloaded
```

Better:

```sql
CREATE TABLE tenant_events_by_bucket (
    tenant_id text,
    bucket_day date,
    bucket_id int,
    event_time timestamp,
    event_id uuid,
    payload text,
    PRIMARY KEY ((tenant_id, bucket_day, bucket_id), event_time, event_id)
);
```

Now:

```text
tenant traffic split across bucket_id
many partition keys
many tokens
many shards/nodes
```

Trade-off:

```text
read tenant/day requires querying multiple buckets and merging.
```

This is a deliberate load-shaping decision.

---

## 40. Practical Derived View Example

Use case:

```text
List open cases by assignee.
```

Table:

```sql
CREATE TABLE open_cases_by_assignee_bucket (
    assignee_id text,
    bucket_day date,
    bucket_id int,
    priority int,
    case_id text,
    due_at timestamp,
    status text,
    PRIMARY KEY ((assignee_id, bucket_day, bucket_id), priority, due_at, case_id)
);
```

Potential hot assignee:

```text
assignee_id = team_queue_large
```

Shard-per-core implication:

```text
If no bucket_id, one large team queue may hot-spot.
With bucket_id, load spreads.
```

But UI read complexity rises:

```text
query N buckets
merge/sort
limit
handle duplicates/stale derived rows
```

Again: architecture helps if model accounts for skew.

---

## 41. Debugging Checklist: Is It Shard/Node/Cluster/Application?

When p99 rises, classify.

### Application

```text
[ ] Java GC high?
[ ] thread pool saturated?
[ ] event loop blocked?
[ ] request fanout increased?
[ ] retry rate increased?
[ ] payload size increased?
[ ] driver queueing?
```

### Driver

```text
[ ] shard awareness enabled?
[ ] token awareness working?
[ ] local DC correct?
[ ] contact points valid?
[ ] connection pool healthy?
[ ] topology metadata fresh?
[ ] speculative execution causing extra load?
[ ] retry policy safe?
```

### Query

```text
[ ] full partition key?
[ ] bounded clustering range?
[ ] page size sane?
[ ] tombstones scanned?
[ ] large partition?
[ ] ALLOW FILTERING?
[ ] too many buckets/fanout?
```

### ScyllaDB Node/Shard

```text
[ ] one shard pegged?
[ ] one node overloaded?
[ ] compaction backlog?
[ ] repair/streaming running?
[ ] disk IO saturated?
[ ] cache hit drop?
[ ] cross-shard forwarding high?
```

### Cluster

```text
[ ] node down/degraded?
[ ] topology change?
[ ] uneven ownership?
[ ] cross-DC latency?
[ ] RF/CL mismatch?
[ ] repair overdue?
```

---

## 42. What to Measure in Development

Even local/dev experiments can measure useful things:

- query shape,
- partition size growth,
- key distribution,
- repository method semantics,
- paging behavior,
- retry/idempotency behavior,
- result payload size,
- concurrency limits,
- driver metrics wiring.

Do not over-trust local latency numbers, but do validate design assumptions early.

---

## 43. What to Measure in Load Test

Production-like load test should include:

```text
[ ] realistic key distribution
[ ] hot tenants/entities
[ ] RF/CL matching production
[ ] driver shard awareness
[ ] same local DC setting
[ ] realistic row size
[ ] realistic partition size
[ ] realistic TTL/delete behavior
[ ] compaction active
[ ] dataset larger than memory if production is
[ ] bounded/unbounded fanout scenarios
[ ] retry behavior
[ ] p99/p999
[ ] per-shard metrics
[ ] client-side latency
```

The goal is not just maximum throughput.

Goal:

```text
Can the system sustain expected workload while preserving p99 and correctness assumptions?
```

---

## 44. Design Review Questions

For any ScyllaDB-backed service, ask:

```text
1. Does driver support ScyllaDB shard awareness?
2. Is local datacenter configured?
3. Are contact points real nodes, not topology-hiding LB?
4. Are repository methods partition-oriented?
5. Are hot keys identified?
6. Is bucketing needed?
7. Is fanout bounded?
8. Are retries idempotent?
9. Are per-shard metrics monitored?
10. Is p99 measured client-side and server-side?
11. Is compaction/repair impact tested?
12. Is Java app backpressure implemented?
13. Are page sizes controlled?
14. Is source-of-truth separated from derived views?
15. Is timeout budget aligned end-to-end?
```

---

## 45. Advanced Mental Model: Locality Stack

Think of locality as layered:

```text
Business entity locality:
  case_id / tenant_id / user_id

CQL locality:
  partition key + clustering key

Cluster locality:
  token range + replica node

Node locality:
  shard/core ownership

CPU locality:
  cache/memory affinity

Client locality:
  driver connection to correct node/shard
```

A good design aligns these layers.

Bad design breaks locality:

```text
arbitrary filters
large scans
wrong driver routing
load balancer hiding topology
hot tenant without bucket
large partition
blocking app code
```

ScyllaDB architecture rewards locality discipline.

---

## 46. Summary

ScyllaDB's performance model comes from its shard-per-core, Seastar-based, shared-nothing architecture.

Key lessons:

1. ScyllaDB is Cassandra-compatible at API/model level, but internally different.
2. A node is divided into shards, usually one per CPU core.
3. Each shard owns data/execution context to avoid shared-state contention.
4. Seastar uses reactor-style asynchronous execution.
5. Cross-shard communication adds cost and latency variance.
6. Shard-aware drivers reduce unnecessary cross-shard forwarding.
7. Token awareness chooses the right node; shard awareness chooses the right core.
8. Per-shard metrics matter because node averages hide hot shards.
9. Shard-per-core does not fix hot partitions.
10. Data model still dominates load distribution.
11. Java services must implement bounded concurrency and retry safety.
12. Generic load balancers can break topology-aware routing.
13. CPU/memory/locality concerns are part of database architecture.
14. Production performance requires aligned query shape, driver config, and operational visibility.

---

## 47. Review Questions

1. Apa perbedaan token-aware dan shard-aware routing?
2. Kenapa cross-shard forwarding menambah latency?
3. Apa arti shared-nothing dalam konteks Seastar/ScyllaDB?
4. Kenapa lock contention dan cache bouncing berbahaya di multi-core system?
5. Apa itu reactor model?
6. Kenapa blocking operation buruk di event loop/reactor?
7. Kenapa node-level CPU average bisa menipu?
8. Apa itu hot shard?
9. Kenapa shard-per-core tidak otomatis menyelesaikan hot partition?
10. Mengapa Java driver configuration bagian dari architecture?
11. Apa risiko generic load balancer di depan ScyllaDB?
12. Bagaimana bucketing membantu menyebarkan load ke banyak shard?
13. Apa trade-off bucketing terhadap read path?
14. Apa saja layer locality dari business entity sampai CPU cache?
15. Apa yang harus dicek jika p99 naik setelah driver upgrade?
16. Bagaimana unbounded async fanout di Java bisa merusak ScyllaDB?
17. Apa beda performance problem di application, driver, query, shard, node, cluster?
18. Mengapa per-shard metrics penting untuk incident analysis?
19. Apa hubungan compaction/repair dengan foreground latency?
20. Apa yang harus diuji dalam production-like load test?

---

## 48. Practical Exercise

Ambil use case:

```text
User opens dashboard showing latest 50 notifications.
```

Rancang secara konseptual:

```text
1. Partition key kandidat.
2. Clustering key kandidat.
3. Apakah user tertentu bisa hot?
4. Apakah perlu bucket?
5. Bagaimana query latest 50 jika bucketed?
6. Apa consistency level read/write?
7. Apakah table source-of-truth atau derived view?
8. Apakah Java method async atau blocking?
9. Berapa page size?
10. Bagaimana membatasi fanout?
11. Bagaimana retry write notification dibuat idempotent?
12. Metrik apa yang dicek jika hanya sebagian user lambat?
13. Bagaimana memastikan driver shard-aware?
14. Apa risiko jika aplikasi lewat load balancer generic?
15. Apa yang terjadi jika satu shard pegged?
```

Tulis jawaban sebelum lanjut ke part 005.

---

## 49. Preview Part 005

Part berikutnya akan membahas modern ScyllaDB data distribution:

```text
tablets
token ranges
tablet replica placement
elasticity
rebalancing
node add/remove
relationship between partition, token, tablet, node, shard
```

Part 003 memberi model ring/token klasik.

Part 004 membuka mesin per node.

Part 005 akan menyatukan keduanya dengan konsep tablets dan distribusi data modern di ScyllaDB.

---

# End of Part 004

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-003.md">⬅️ Part 003 — Dynamo Lineage: Ring, Token, Replication, Coordinator, Gossip</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-005.md">Part 005 — Tablets, VNodes, Token Ranges, dan Data Distribution Modern ScyllaDB ➡️</a>
</div>
