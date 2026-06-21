# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-002.md

# Part 002 — Distributed OLTP Constraints: Latency, Throughput, Availability, Consistency

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `002`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: memahami constraint fundamental sistem OLTP terdistribusi sebelum masuk lebih dalam ke ScyllaDB internals, CQL, data modeling, dan Java driver.

---

## 0. Posisi Part Ini dalam Seri

Di part sebelumnya kita membangun mental model bahwa wide-column store bukan SQL, bukan document database, bukan cache, dan bukan OLAP columnar database.

Part ini membahas pertanyaan yang lebih fundamental:

> Kenapa database seperti ScyllaDB punya konsep partition, replica, consistency level, coordinator, timeout, repair, quorum, dan data model yang sangat eksplisit?

Jawabannya bukan karena ScyllaDB “aneh”. Jawabannya karena ScyllaDB hidup di domain yang berbeda:

- data tersebar di banyak node,
- request dilayani oleh node berbeda,
- replica bisa tidak selalu sinkron sempurna,
- network bisa lambat atau putus sebagian,
- client bisa timeout walaupun server tetap menyelesaikan operasi,
- satu key bisa panas,
- satu shard bisa overload,
- satu data model yang salah bisa membuat seluruh cluster terlihat buruk.

Kalau SQL database single-node dapat dipahami terutama lewat:

```text
tables -> indexes -> joins -> transactions -> query optimizer
```

maka ScyllaDB harus dipahami lewat:

```text
partition -> replica -> coordinator -> consistency level -> storage engine -> repair -> client retry
```

Part ini sengaja belum masuk terlalu dalam ke syntax CQL. Tujuannya adalah membentuk “physics” sistem terdistribusi di kepala kita.

---

## 1. Apa Itu Distributed OLTP?

OLTP berarti online transaction processing: sistem yang melayani operasi kecil, sering, dan latency-sensitive.

Contoh operasi OLTP:

- create order,
- update payment state,
- read user session state,
- append device telemetry,
- fetch latest case events,
- write audit event,
- check idempotency key,
- store notification inbox item,
- update lifecycle state,
- lookup current enforcement case status.

Karakteristik umum OLTP:

| Karakteristik | Makna |
|---|---|
| Banyak request kecil | Request biasanya membaca/menulis sedikit entity, bukan scan besar |
| Latency-sensitive | p95/p99 penting, bukan hanya average |
| Concurrent | Banyak user/service menulis/membaca bersamaan |
| Correctness-sensitive | Salah state bisa berdampak bisnis, hukum, atau operasional |
| Always-on | Downtime mahal |
| Write-heavy atau mixed | Banyak workload punya write rate tinggi |
| Access pattern stabil | Biasanya query diketahui dari use case aplikasi |

Distributed OLTP berarti data dan request tidak ditangani oleh satu mesin saja, tetapi oleh cluster.

```text
Client/App
   |
   v
Driver
   |
   v
Coordinator node
   |
   +--> Replica A
   +--> Replica B
   +--> Replica C
```

Begitu data tersebar, constraint-nya berubah total.

Masalah bukan lagi hanya:

```text
Apakah query ini pakai index?
```

Tapi juga:

```text
Replica mana yang punya data?
Berapa replica harus menjawab?
Bagaimana kalau replica lambat?
Bagaimana kalau client timeout?
Bagaimana kalau write sukses di sebagian replica?
Bagaimana kalau read memilih replica yang belum punya data terbaru?
Bagaimana kalau partition key membuat satu node/shard panas?
```

---

## 2. Realitas Dasar: Distributed Systems Are Systems of Partial Truth

Dalam sistem single-node, failure sering tampak binary:

```text
database up
database down
```

Dalam distributed database, failure lebih sering partial:

```text
node A sehat
node B lambat
node C reachable dari sebagian node saja
network antar rack bermasalah
disk satu node saturated
satu shard CPU pegged
driver masih connected ke node yang overloaded
coordinator timeout tapi replica sudah menulis data
```

Ini menyebabkan state observasi berbeda-beda tergantung siapa yang melihat.

Contoh:

```text
Client melihat: write timeout.
Coordinator melihat: dua replica sudah ack, satu replica belum.
Replica A melihat: write applied.
Replica B melihat: write applied.
Replica C melihat: belum menerima write.
```

Pertanyaan penting:

> Apakah write itu sukses?

Jawabannya tergantung consistency level dan response yang diterima client. Lebih dalam lagi: bahkan ketika client menerima timeout, operasi mungkin sudah terjadi di beberapa replica.

Inilah salah satu konsep paling penting untuk application engineer:

> Timeout bukan bukti bahwa operasi gagal.

Timeout hanya berarti:

```text
Client tidak menerima jawaban dalam batas waktu yang ditentukan.
```

Bukan:

```text
Server pasti tidak mengeksekusi operasi.
```

Konsekuensi untuk Java service:

- retry write yang tidak idempotent bisa menggandakan efek,
- retry counter increment bisa salah,
- retry insert audit event tanpa idempotency key bisa membuat duplikasi,
- retry state transition tanpa version guard bisa menimpa state baru,
- “catch timeout then assume failed” adalah bug correctness.

---

## 3. Latency: Average Tidak Cukup

Distributed OLTP harus dipikirkan dalam percentiles.

Misalnya:

```text
p50 = 2 ms
p95 = 8 ms
p99 = 40 ms
p999 = 300 ms
```

Average mungkin terlihat bagus:

```text
avg = 4 ms
```

Tapi user dan downstream service merasakan tail latency.

Jika satu API endpoint melakukan 10 operasi database serial, probabilitas terkena tail meningkat.

Misal probabilitas satu operasi berada di tail p99 adalah 1%.

Untuk 10 operasi serial:

```text
probability at least one p99-ish event ≈ 1 - 0.99^10
                                  ≈ 9.56%
```

Artinya endpoint yang tampak “hanya memanggil query cepat” bisa punya p95/p99 buruk karena composition.

### 3.1 Latency Budget

Jangan mulai dari “ScyllaDB bisa berapa ops/sec?”

Mulai dari:

```text
API SLO: p99 <= 150 ms
Network gateway: 10 ms
Auth/middleware: 10 ms
Business logic: 20 ms
Downstream calls: 40 ms
Database budget: 40 ms
Serialization/logging: 10 ms
Safety margin: 20 ms
```

Kalau database budget 40 ms, maka query design, consistency level, retry policy, page size, dan fanout harus tunduk pada budget itu.

### 3.2 Latency dalam ScyllaDB Bukan Satu Angka

Satu request bisa punya beberapa latency layer:

```text
Java service latency
  -> driver queueing latency
  -> network to coordinator
  -> coordinator scheduling latency
  -> replica request latency
  -> storage read/write path latency
  -> compaction/cache/IO effect
  -> response aggregation latency
  -> network back to client
```

Ketika p99 naik, penyebabnya bisa di:

- client thread pool,
- driver connection pool,
- DNS/load balancer,
- coordinator node,
- replica node,
- satu shard,
- disk IO,
- compaction backlog,
- tombstone scan,
- large partition,
- GC di aplikasi Java,
- bad retry storm.

Top 1% engineer tidak bertanya:

```text
Kenapa DB lambat?
```

Mereka bertanya:

```text
Di layer mana latency bertambah?
Apakah semua queries terdampak atau query tertentu?
Apakah semua partitions terdampak atau key tertentu?
Apakah semua nodes terdampak atau shard tertentu?
Apakah ini read path, write path, compaction, network, atau client backpressure?
```

---

## 4. Throughput: Cluster Scale Tidak Menghapus Bottleneck Lokal

Distributed database bisa scale out, tetapi hanya jika workload bisa didistribusikan.

Ideal:

```text
100 partitions/sec -> spread across many token ranges -> many nodes -> many shards
```

Buruk:

```text
100,000 writes/sec -> same partition key -> same replica set -> same shard path
```

Cluster 30 node tetap bisa terlihat lambat kalau workload terkonsentrasi pada satu partition.

### 4.1 Throughput Global vs Throughput Per Partition

ScyllaDB kuat untuk throughput tinggi jika data model menyebarkan beban.

Tapi setiap partition punya batas praktis.

Contoh anti-pattern:

```sql
CREATE TABLE tenant_events (
    tenant_id text,
    event_time timestamp,
    event_id uuid,
    payload text,
    PRIMARY KEY (tenant_id, event_time, event_id)
);
```

Kalau ada tenant besar dengan 50,000 writes/sec, semua writes tenant itu masuk ke partition yang sama jika tidak ada bucket.

Lebih sehat:

```sql
CREATE TABLE tenant_events_by_bucket (
    tenant_id text,
    bucket_date date,
    bucket_id int,
    event_time timestamp,
    event_id uuid,
    payload text,
    PRIMARY KEY ((tenant_id, bucket_date, bucket_id), event_time, event_id)
);
```

Dengan bucketing, beban bisa disebar.

### 4.2 Throughput Read vs Write Berbeda

Write path biasanya:

```text
append commitlog -> update memtable -> replicate -> ack
```

Read path bisa lebih mahal:

```text
check cache/memtable/SSTables -> merge versions -> handle tombstones -> reconcile replicas -> return
```

Workload yang tampak “hanya read by key” bisa menjadi mahal bila:

- partition terlalu besar,
- banyak tombstone,
- compaction tertinggal,
- query scan terlalu banyak clustering rows,
- page size terlalu besar,
- data tidak cache-friendly,
- read consistency membutuhkan beberapa replica.

---

## 5. Availability: Apa yang Sebenarnya Dimaksud “Available”?

Available bukan hanya proses database hidup.

Untuk satu request, availability berarti:

```text
Ada cukup replica yang reachable dan mampu menjawab sesuai consistency level dalam batas waktu.
```

Jika replication factor = 3:

- CL ONE butuh 1 replica menjawab,
- CL QUORUM butuh 2 replica menjawab,
- CL ALL butuh 3 replica menjawab.

Jadi availability berbeda tergantung consistency level.

### 5.1 Failure Tolerance by Consistency Level

Misalnya RF=3 dalam satu DC.

| Consistency Level | Ack yang dibutuhkan | Bisa tolerate berapa replica down? | Catatan |
|---|---:|---:|---|
| ONE | 1 | 2 | Availability tinggi, stale read risk lebih besar |
| QUORUM | 2 | 1 | Balance umum |
| ALL | 3 | 0 | Strict tapi fragile |

Ini simplifikasi, karena latency dan overload juga penting. Replica yang “up tapi sangat lambat” bisa terasa seperti unavailable dari perspektif client timeout.

### 5.2 Availability Bukan Correctness

CL ONE bisa membuat sistem lebih available, tetapi tidak otomatis benar untuk semua use case.

Contoh:

```text
write CL ONE
read CL ONE
```

Bisa terjadi:

```text
Write masuk ke replica A.
Read berikutnya diarahkan ke replica B.
Replica B belum menerima write.
Read mengembalikan data lama/null.
```

Untuk beberapa use case ini tidak masalah:

- telemetry,
- metrics,
- eventual timeline,
- non-critical cache-like read,
- idempotency logs yang divalidasi ulang.

Untuk use case lain bisa fatal:

- payment state,
- case lifecycle status,
- enforcement decision,
- duplicate prevention,
- authorization state,
- regulatory audit state.

---

## 6. Consistency: Bukan Satu Tombol “Strong vs Eventual”

Consistency di ScyllaDB/Cassandra-family adalah tunable per operasi.

Pertanyaan yang benar bukan:

```text
Apakah database ini strongly consistent?
```

Pertanyaan yang lebih tepat:

```text
Untuk query dan write ini:
- replication factor berapa?
- write consistency level apa?
- read consistency level apa?
- apakah read dan write quorum overlap?
- apakah multi-DC?
- apakah ada clock/order assumption?
- apakah operasi butuh conditional update?
```

### 6.1 Quorum Overlap

Untuk RF=3:

```text
QUORUM = floor(3 / 2) + 1 = 2
```

Jika write CL=QUORUM dan read CL=QUORUM:

```text
write touches at least 2 replicas
read touches at least 2 replicas
```

Dua set dari ukuran 2 dalam total 3 replica pasti overlap minimal 1 replica.

```text
Write replicas: A, B
Read replicas:  B, C
Overlap: B
```

Ini membantu read melihat write terbaru, dengan catatan sistem melakukan reconciliation berdasarkan timestamp/version semantics.

### 6.2 Namun Quorum Bukan Transaksi SQL

QUORUM tidak berarti:

- serializable isolation,
- multi-row transaction,
- multi-partition atomicity,
- constraint enforcement global,
- no lost update otomatis,
- no concurrent write conflict otomatis.

ScyllaDB/Cassandra style correctness sangat bergantung pada:

- data model,
- partition boundary,
- timestamp semantics,
- consistency level,
- LWT jika perlu conditional correctness,
- idempotency,
- application-level invariant design.

---

## 7. PACELC Lebih Berguna daripada CAP untuk Desain Harian

CAP sering disalahgunakan.

CAP bicara saat network partition:

```text
Consistency vs Availability under Partition
```

Tapi desain harian lebih sering menghadapi pertanyaan PACELC:

```text
If Partition occurs: choose Availability or Consistency.
Else: choose Latency or Consistency.
```

Untuk distributed OLTP, trade-off harian sering bukan “partition besar”, tetapi:

- read CL ONE vs LOCAL_QUORUM,
- write CL ONE vs LOCAL_QUORUM,
- LWT vs normal write,
- multi-DC local read vs global read,
- synchronous derived table update vs async repair,
- low latency vs stronger freshness.

Contoh:

```text
Use case: user notification badge count
Choice: low latency, eventual consistency acceptable
Possible CL: LOCAL_ONE/ONE, derived aggregate repairable
```

Contoh lain:

```text
Use case: enforcement case final state transition
Choice: correctness over raw latency
Possible design: partition-local state, conditional transition, idempotency key, QUORUM/LOCAL_QUORUM, audit append
```

---

## 8. The Three Questions: Correctness, Freshness, Durability

Saat mendesain setiap access pattern, tanyakan tiga hal.

### 8.1 Correctness

```text
Apa invariant yang tidak boleh dilanggar?
```

Contoh:

- case tidak boleh pindah dari CLOSED ke IN_PROGRESS,
- payment tidak boleh captured dua kali,
- username tidak boleh duplicate,
- audit event tidak boleh hilang,
- enforcement decision harus immutable setelah approval,
- SLA timer tidak boleh mundur.

### 8.2 Freshness

```text
Seberapa baru data harus terlihat?
```

Pilihan:

| Freshness Need | Contoh | Implikasi |
|---|---|---|
| Eventually fresh | analytics-ish view, feed, metrics | CL rendah mungkin cukup |
| Read-your-write | user submit lalu langsung lihat hasil | CL/design harus mendukung |
| Monotonic read | user tidak boleh melihat state mundur | butuh session strategy/versioning |
| Strong conditional | duplicate prevention/state transition | LWT atau app-level guard |

### 8.3 Durability

```text
Setelah client menerima sukses, berapa salinan yang harus sudah menerima write?
```

Write CL menentukan ack threshold, bukan jumlah total replica yang akhirnya akan punya data.

Durability juga dipengaruhi:

- commitlog,
- replication factor,
- node failure,
- hinted handoff,
- repair,
- backup,
- disk failure,
- multi-DC replication.

---

## 9. Failure Matrix untuk Distributed OLTP

Berikut matrix awal. Nanti akan dibahas lebih dalam di part failure modelling.

| Failure | Gejala di aplikasi | Risiko correctness | Respons engineering |
|---|---|---|---|
| Read timeout | API lambat/error | Mungkin tidak ada state change | Retry read jika aman |
| Write timeout | API error | Write mungkin sudah applied sebagian | Retry hanya jika idempotent |
| Unavailable | Immediate failure | Operasi tidak bisa memenuhi CL | Fail fast atau degrade |
| Overloaded | Error/timeout sporadis | Retry storm memperburuk | Backoff, throttle, investigate hot spot |
| Node down | Sebagian request gagal/lambat | Depends CL/RF | Repair/recover node |
| Replica stale | Read data lama | Business state salah | CL, repair, versioning |
| Hot partition | p99 buruk untuk subset key | SLA subset user/tenant rusak | Bucket/remodel |
| Tombstone storm | Read timeout tinggi | Data lifecycle bug | TTL/delete redesign |
| Compaction debt | Latency naik, disk naik | Recovery lambat | Tuning/capacity |
| Clock skew | LWW anomaly | Newer logical state overwritten | NTP, app version, LWT |

---

## 10. Write Timeout Ambiguity

Ini sangat penting.

Misal:

```text
RF = 3
Write CL = QUORUM
```

Client menulis ke coordinator. Coordinator mengirim ke 3 replica.

Timeline:

```text
t0: coordinator sends write to A, B, C
t1: A applies write
t2: B applies write
t3: network response from B delayed
t4: client timeout fires
t5: B response reaches coordinator
```

Client mungkin menerima timeout, padahal write telah memenuhi quorum atau hampir memenuhi quorum.

Variasi lain:

```text
A applied
B not applied
C not applied
client timeout
```

Dalam kedua skenario, error yang dilihat client bisa mirip.

Karena itu, retry write harus diperlakukan dengan hati-hati.

### 10.1 Safe Retry Requires Idempotency

Idempotent berarti operasi yang sama bisa dijalankan lebih dari sekali tanpa mengubah hasil akhir secara salah.

Contoh relatif aman:

```sql
INSERT INTO audit_events_by_case (
    case_id,
    event_time,
    event_id,
    event_type,
    payload
) VALUES (?, ?, ?, ?, ?);
```

Jika `event_id` stabil dan primary key mencakup event identity, retry akan menulis row yang sama.

Contoh tidak aman:

```sql
UPDATE account_counters
SET count = count + 1
WHERE account_id = ?;
```

Retry bisa menggandakan count.

### 10.2 Java Implication

Jangan buat abstraction seperti:

```java
repository.save(entity);
```

lalu semua timeout dianggap sama.

Lebih sehat:

```java
repository.insertIdempotentEvent(commandId, event);
repository.transitionCaseWithExpectedVersion(caseId, expectedVersion, newState);
repository.upsertCurrentSnapshot(snapshot);
repository.incrementCounterUnsafeUnlessExplicitlyAccepted(...);
```

Method name dan contract harus menyatakan retry safety.

---

## 11. Read Timeout dan Stale Read

Read timeout biasanya lebih mudah dari write timeout karena read tidak mengubah state. Namun read retry tetap bisa punya masalah:

- retry ke replica berbeda bisa membaca versi berbeda,
- read-after-write bisa gagal jika CL rendah,
- pagination bisa melihat perubahan antar page,
- application cache bisa menyimpan stale/null result,
- fallback path bisa memperkuat inconsistency.

Contoh buruk:

```java
Optional<UserProfile> profile = repository.findById(userId);
if (profile.isEmpty()) {
    repository.createDefaultProfile(userId);
}
```

Jika read stale/null karena CL rendah atau replica lag, aplikasi bisa membuat duplicate/default state yang salah.

Lebih baik:

```text
- create profile dengan idempotency/conditional insert,
- baca dengan CL yang sesuai,
- gunakan state machine eksplisit,
- jangan jadikan null read sebagai bukti ketiadaan absolut kecuali model mendukung.
```

---

## 12. Consistency Level Selection by Use Case

Tidak semua operasi harus QUORUM. Tidak semua operasi boleh ONE.

### 12.1 Event Append

```text
Use case: append immutable event
Correctness: no duplicate logical event
Freshness: eventual acceptable
Durability: depends severity
```

Possible design:

- stable event_id,
- idempotent insert,
- CL LOCAL_QUORUM for important audit,
- CL LOCAL_ONE for high-volume telemetry if acceptable,
- repair/backfill pipeline.

### 12.2 Current State Read

```text
Use case: read current case status
Correctness: important
Freshness: should not go backward
```

Possible design:

- current state table partitioned by case_id,
- version column,
- write with expected version or LWT if needed,
- read LOCAL_QUORUM,
- maybe cache only with short TTL and version check.

### 12.3 Unique Constraint

```text
Use case: unique username/reference number
Correctness: strict uniqueness
```

Possible design:

- reservation table,
- LWT `IF NOT EXISTS`,
- avoid normal insert at CL QUORUM as uniqueness guarantee,
- understand LWT cost.

### 12.4 Feed/Timeline

```text
Use case: notification feed
Correctness: eventual ordering acceptable
Freshness: seconds-level okay
```

Possible design:

- partition by user + time bucket,
- clustering by time,
- idempotent event identity,
- lower CL maybe acceptable,
- derived table repair possible.

---

## 13. Availability vs Consistency in Multi-DC

Multi-DC introduces additional trade-off:

```text
Jakarta app -> Jakarta DC
Singapore app -> Singapore DC
```

If every request requires global quorum across DC, latency rises and regional partition hurts availability.

Common production pattern:

```text
NetworkTopologyStrategy
RF per DC
LOCAL_QUORUM for local strong-ish behavior
async/eventual cross-DC convergence
```

But active-active writes to the same logical entity across DC can conflict.

Questions:

```text
Can the same entity be written in multiple regions?
If yes, what is conflict resolution?
Is last-write-wins acceptable?
Is there a home region per entity?
Can writes be routed to owner region?
Can state transitions be partition-local and version-guarded?
```

For regulatory/case-management-like systems, a safer pattern is often:

```text
home region/tenant ownership
local quorum within owner DC
replicate read copies elsewhere
explicit failover procedure
```

rather than casual active-active mutation everywhere.

---

## 14. The Latency/Correctness Decision Grid

Use grid berikut ketika memilih desain.

| Requirement | Prefer | Avoid |
|---|---|---|
| Ultra-low latency, stale acceptable | CL ONE/LOCAL_ONE, denormalized table | LWT, multi-DC quorum |
| Read-your-write important | LOCAL_QUORUM read/write, session routing | read CL ONE after write CL ONE |
| Strict uniqueness | LWT/reservation table | normal insert + hope |
| High write throughput | idempotent append, good partitioning | counters, LWT on hot key |
| Ordered per entity lifecycle | single partition per entity or bucketed lifecycle design | multi-partition unconstrained updates |
| Huge tenant workload | bucketing, rate limits | tenant_id-only partition key |
| Data retention with TTL | TWCS-like thinking, bucketed time data | random TTL in huge mixed table |
| Regulatory audit | immutable append + durable CL + backup | overwrite-only current state |

---

## 15. Service-Level Thinking: Database SLO Is Not Enough

A ScyllaDB cluster might be healthy by database metrics, but the service still fails SLO because:

- service issues too many sequential queries,
- driver pool saturated,
- wrong consistency level for endpoint budget,
- retry policy amplifies load,
- app thread pool blocked,
- serialization payload too large,
- unbounded futures create memory pressure,
- downstream service timeout shorter than DB timeout,
- circuit breaker missing.

### 15.1 Endpoint Budget Example

Bad:

```java
public CaseDetails getCaseDetails(String caseId) {
    Case c = caseRepo.find(caseId);
    List<Event> events = eventRepo.findLatest(caseId);
    List<Task> tasks = taskRepo.findOpen(caseId);
    List<Comment> comments = commentRepo.findLatest(caseId);
    List<Attachment> attachments = attachmentRepo.find(caseId);
    return assemble(c, events, tasks, comments, attachments);
}
```

This endpoint has 5 DB calls. If serial, p99 compounds.

Better options:

- parallelize bounded reads,
- precompute read model,
- split endpoint,
- cache low-risk components,
- design table matching UI query,
- reduce consistency for non-critical panels,
- use page limits explicitly.

### 15.2 Bounded Concurrency

Never let Java service create unbounded DB pressure:

```text
incoming HTTP RPS
  x DB calls per request
  x retry multiplier
  x page count
  x fanout
```

If each request fans out to 20 partitions and retries twice under load, the database sees a very different workload from the nominal RPS.

---

## 16. Coordinated Omission and Benchmark Lies

A benchmark can lie if it stops sending requests while waiting for slow responses. This hides tail latency.

Bad mental model:

```text
I sent 10k requests/sec and average latency was fine.
```

Questions:

```text
Was arrival rate fixed?
Was p99 measured under sustained load?
Was warmup included?
Was compaction active?
Was repair active?
Was dataset larger than memory?
Was tombstone behavior represented?
Was key distribution realistic?
Were hot tenants simulated?
Was client colocated with DB?
Was driver shard-aware?
Were retries included in measured latency?
```

A production-like ScyllaDB benchmark must model:

- key distribution,
- partition size,
- row size,
- read/write ratio,
- consistency level,
- dataset size,
- TTL/delete behavior,
- time-series windows,
- compaction,
- multi-node topology,
- client concurrency,
- tail latency.

---

## 17. Data Model as Load-Shaping Mechanism

In SQL, data model often starts from conceptual relationships.

In ScyllaDB, data model is also load-shaping.

A primary key determines:

```text
which partitions exist
how large each partition becomes
which nodes own data
which shards serve requests
which reads are local/range scans
which queries are impossible
which keys become hot
```

So data model is a performance control plane.

Bad primary key:

```sql
PRIMARY KEY (tenant_id, created_at)
```

If tenant traffic is skewed, one tenant can dominate.

Better:

```sql
PRIMARY KEY ((tenant_id, bucket_day, bucket_id), created_at, entity_id)
```

But this creates query complexity:

```text
To query one tenant day, read N buckets and merge.
```

There is no free lunch. You exchange:

```text
write distribution
```

for:

```text
read fanout and merge complexity
```

A top engineer makes that trade explicit.

---

## 18. Modeling Invariants in a Non-Relational Distributed Database

SQL often gives tools like:

- foreign key,
- unique constraint,
- transaction,
- isolation level,
- check constraint.

ScyllaDB gives different primitives:

- partition-level atomicity,
- tunable consistency,
- LWT/CAS,
- primary-key uniqueness,
- idempotent writes,
- timestamp-based conflict resolution,
- denormalized tables,
- repair,
- application-level workflows.

This means invariant modeling must move closer to application design.

Example invariant:

```text
A case can only transition:
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED -> CLOSED
```

Naive ScyllaDB write:

```sql
UPDATE case_current
SET status = 'CLOSED'
WHERE case_id = ?;
```

Problem:

- concurrent transitions can race,
- stale writer can overwrite newer state,
- retry ambiguity,
- no transition validation at DB level.

Safer options:

1. LWT:

```sql
UPDATE case_current
SET status = 'CLOSED', version = ?
WHERE case_id = ?
IF status = 'APPROVED' AND version = ?;
```

2. Append-only events + deterministic projection:

```text
case_events_by_case
case_current_by_case
```

3. Application command handler with expected version:

```text
transition(command_id, case_id, expected_version, target_status)
```

4. One writer per aggregate via queue/actor-like partition ownership.

Choice depends on throughput, correctness, latency, and operational complexity.

---

## 19. When Lower Consistency Is Actually Correct

Do not blindly maximize consistency. It can increase latency and reduce availability without improving user value.

Examples where eventual consistency can be correct:

- last seen timestamp,
- device heartbeat,
- analytics counter,
- read receipt,
- notification badge count,
- search/read model update,
- recommendation activity,
- non-authoritative cache table,
- operational telemetry.

The correctness trick is to make the model explicit:

```text
This table is derived.
This table can be rebuilt.
This table may lag.
This table is not source of truth.
This table is not used for enforcement decisions.
```

Then Java code should reflect it:

```java
interface NotificationBadgeReadModel {
    // Eventually consistent. May lag behind inbox by seconds.
    BadgeCount getBadgeCount(UserId userId);
}
```

Not:

```java
int getUnreadCount(UserId userId);
```

The latter sounds authoritative.

---

## 20. When Stronger Consistency Is Still Not Enough

Even LOCAL_QUORUM read/write does not solve:

- uniqueness across arbitrary partitions,
- multi-entity transaction,
- global ordering,
- cross-table atomicity,
- compare-and-set without LWT,
- business transition validation,
- external side effect coordination,
- exactly-once processing.

Example:

```text
Create user:
1. reserve username
2. create user profile
3. create audit event
4. send welcome email
```

No single normal CQL mutation makes this an atomic distributed transaction across all tables and external systems.

You need a workflow pattern:

- reservation row with LWT,
- idempotent command ID,
- outbox/event log,
- compensating action,
- retry-safe steps,
- reconciliation job,
- observable state machine.

---

## 21. Important Distinction: Source of Truth vs Serving View

In ScyllaDB designs, you often maintain multiple tables:

```text
case_events_by_case
case_current_by_case
cases_by_assignee
cases_by_status_bucket
cases_by_due_date_bucket
```

Not all tables have the same authority.

Classify each table:

| Table Type | Meaning | Recovery |
|---|---|---|
| Source of truth | Authoritative record | Must be durable and correct |
| Current snapshot | Optimized latest state | Can sometimes rebuild from events |
| Lookup index | Supports access pattern | Rebuild from source table/event log |
| Feed/timeline | User-facing derived view | Repair/backfill possible |
| Cache-like table | Low-authority acceleration | Can expire/recompute |

This classification determines:

- consistency level,
- retry policy,
- backup priority,
- repair urgency,
- alert severity,
- Java repository naming,
- incident response.

---

## 22. Backpressure: Availability Protection Mechanism

A distributed DB can be killed by clients trying too hard to “recover”.

Failure sequence:

```text
1. one partition becomes hot
2. latency rises
3. clients timeout
4. clients retry immediately
5. load doubles
6. more timeouts
7. thread pools fill
8. entire service degrades
```

This is a retry storm.

Better:

- bounded concurrency,
- exponential backoff with jitter,
- idempotency classification,
- circuit breakers,
- bulkheads,
- adaptive throttling,
- per-tenant rate limiting,
- reject early instead of queueing forever,
- observe retry counts as first-class metric.

In Java:

```text
CompletableFuture explosion is not backpressure.
Reactive streams without bounded demand is not backpressure.
Executor queue length is not a recovery plan.
```

---

## 23. Read/Write Path Intuition Without Internals Yet

We will cover internals later, but keep this simplified intuition.

### Write Path

```text
client -> coordinator -> replicas -> commitlog/memtable -> ack
```

Cost drivers:

- number of replicas required by CL,
- network round trip,
- coordinator scheduling,
- replica scheduling,
- commitlog pressure,
- memtable pressure,
- batch size,
- row size,
- LWT or normal write.

### Read Path

```text
client -> coordinator -> selected replicas -> memtable/SSTables/cache -> reconcile -> return
```

Cost drivers:

- partition size,
- clustering range size,
- number of SSTables touched,
- tombstones scanned,
- cache hit/miss,
- page size,
- consistency level,
- read repair/reconciliation,
- cross-shard/node path.

This is why a write-optimized workload can still collapse due to bad reads.

---

## 24. Practical Decision Checklist for Every New Query

Before creating a table or repository method, answer:

```text
1. What exact query must be served?
2. What is the maximum expected QPS?
3. What is the key distribution?
4. What is the largest expected partition?
5. What is the hottest expected partition?
6. What is the read/write ratio?
7. What freshness is required?
8. What correctness invariant is involved?
9. Is the write idempotent?
10. Is retry safe?
11. What CL is needed for read and write?
12. What happens if client sees timeout?
13. What happens if replica is stale?
14. Can this table be rebuilt?
15. What is the retention policy?
16. Will TTL/delete create tombstones?
17. How will this be observed?
18. What is the failure-mode fallback?
```

If a design cannot answer these, it is not production-ready.

---

## 25. Example: Regulatory Case Timeline

Suppose we need:

```text
- append case lifecycle event
- read latest 100 events by case
- read current case state
- list open cases by assignee
- enforce valid state transition
```

Possible tables:

```sql
case_events_by_case
case_current_by_case
open_cases_by_assignee_bucket
case_transition_commands
```

### 25.1 Append Event

```text
Correctness:
- event must not duplicate logical command
- event should be durable
- event ordering per case matters
```

Design:

```text
partition: case_id or case_id + bucket if long lifecycle
clustering: event_time + event_id or version
write: idempotent event_id
CL: LOCAL_QUORUM for authoritative audit event
```

### 25.2 Read Latest Events

```text
Correctness:
- latest view should be reasonably fresh
- pagination must be stable enough
```

Design:

```text
query within case partition
limit 100
avoid unbounded scan
```

### 25.3 Current State

```text
Correctness:
- cannot regress state
- cannot accept invalid transition
```

Design choices:

```text
LWT on current row
or command serialization per case
or expected version write with audit reconciliation
```

### 25.4 Open Cases by Assignee

This is a derived access pattern.

```text
source: case_current/case_events
derived view: open_cases_by_assignee_bucket
risk: derived table can lag or diverge
```

Need:

- idempotent update,
- cleanup old assignee/status,
- reconciliation job,
- clear authority boundary.

---

## 26. What “Top 1%” Means Here

Untuk ScyllaDB, top-tier engineer bukan orang yang hafal semua CQL command.

Top-tier engineer mampu:

- memetakan business invariant ke storage invariant,
- mendesain partition key berdasarkan load distribution,
- memilih consistency level per use case,
- memahami ambiguity timeout,
- menulis Java client code yang retry-safe,
- membedakan source-of-truth vs derived view,
- mendesain observability berdasarkan failure mode,
- memprediksi hot partition sebelum production incident,
- membangun migration plan tanpa data corruption,
- menjelaskan trade-off latency/availability/consistency ke stakeholder,
- menyusun runbook untuk repair, node failure, and overload,
- tidak memakai ScyllaDB seperti relational database.

---

## 27. Common Misconceptions

### Misconception 1: “QUORUM berarti datanya selalu benar.”

Lebih tepat:

```text
QUORUM meningkatkan kemungkinan read/write overlap dan freshness, tetapi tidak memberi serializable multi-row transaction.
```

### Misconception 2: “Timeout berarti gagal.”

Lebih tepat:

```text
Timeout berarti client tidak menerima response tepat waktu. Operasi bisa saja sudah diterapkan.
```

### Misconception 3: “Kalau cluster besar, semua query akan cepat.”

Lebih tepat:

```text
Cluster besar membantu jika workload tersebar. Hot partition tetap hot.
```

### Misconception 4: “Denormalization itu buruk.”

Dalam wide-column store:

```text
Denormalization adalah alat desain utama, selama consistency dan repair plan jelas.
```

### Misconception 5: “ALLOW FILTERING membantu sementara.”

Lebih tepat:

```text
ALLOW FILTERING sering menyembunyikan data model yang salah dan bisa menjadi production hazard.
```

### Misconception 6: “Retry policy menyelesaikan transient failures.”

Lebih tepat:

```text
Retry tanpa idempotency dan backpressure bisa memperburuk correctness dan availability.
```

---

## 28. Engineering Heuristics

Gunakan heuristik berikut:

```text
If correctness matters, design the invariant first.
If latency matters, reduce fanout.
If throughput matters, distribute partitions.
If freshness matters, choose CL deliberately.
If retry is needed, make writes idempotent.
If data is duplicated, define source of truth.
If table is derived, define rebuild path.
If TTL is heavy, design for tombstones and compaction.
If tenant traffic is skewed, bucket early.
If operation spans many partitions, question the model.
```

---

## 29. Minimal Vocabulary Before Moving On

Pastikan istilah ini sudah mulai terasa natural:

| Term | Working Definition |
|---|---|
| Partition | Unit data locality and distribution by partition key |
| Replica | Copy of partition data on a node |
| Coordinator | Node receiving client request and coordinating replica responses |
| Consistency Level | Number/scope of replica responses required |
| RF | Number of replicas per data item |
| Quorum | Majority of replicas |
| Tail latency | High percentile latency, e.g. p99 |
| Hot partition | Partition receiving disproportionate load |
| Idempotency | Safe repeated execution of same logical operation |
| Tombstone | Delete marker retained for correctness before compaction |
| Derived table | Table maintained for access pattern, not necessarily source of truth |
| LWT | Conditional transaction/CAS mechanism |
| Repair | Anti-entropy process to synchronize replicas |

---

## 30. Summary

Distributed OLTP database design is an exercise in explicit trade-offs.

ScyllaDB gives you powerful primitives:

- partitioned storage,
- replication,
- tunable consistency,
- high-throughput write path,
- shard-per-core execution,
- CQL-compatible wide-column model,
- Java driver ecosystem,
- operational mechanisms like repair, backup, and observability.

But those primitives require discipline.

The most important lessons from this part:

1. Distributed failure is often partial, not binary.
2. Timeout does not prove failure.
3. Availability depends on requested consistency level.
4. QUORUM helps but is not a SQL transaction.
5. Latency must be reasoned in p95/p99, not average.
6. Throughput depends on distribution, not only cluster size.
7. Data model shapes physical load.
8. Idempotency is mandatory for safe retries.
9. Source-of-truth and derived views must be explicit.
10. Application correctness must be designed with database semantics, not assumed.

---

## 31. Review Questions

Gunakan pertanyaan ini untuk menguji pemahaman:

1. Mengapa timeout pada write tidak boleh otomatis dianggap gagal?
2. Apa beda availability pada CL ONE vs CL QUORUM?
3. Kenapa cluster besar tidak menyelesaikan hot partition?
4. Apa risiko read CL ONE setelah write CL ONE?
5. Apa yang dimaksud quorum overlap?
6. Kenapa quorum bukan serializable transaction?
7. Bagaimana retry bisa memperburuk incident?
8. Apa perbedaan source-of-truth table dan derived table?
9. Kapan eventual consistency bisa benar secara bisnis?
10. Kapan LWT dibutuhkan?
11. Apa hubungan data model dengan load distribution?
12. Kenapa p99 lebih penting daripada average untuk OLTP?
13. Apa yang harus diketahui sebelum memilih consistency level?
14. Mengapa active-active multi-region writes berbahaya?
15. Apa yang harus tertulis dalam contract repository method Java agar retry safety jelas?

---

## 32. Practical Exercise

Ambil satu use case dari sistem nyata:

```text
User submits a case for regulatory review.
```

Coba tulis:

```text
1. Apa source-of-truth event?
2. Apa current state table?
3. Apa derived table untuk list by reviewer?
4. Apa invariant state transition?
5. Apakah write idempotent?
6. Apa consistency level untuk append event?
7. Apa consistency level untuk read current state?
8. Apa yang terjadi jika write timeout?
9. Apa yang terjadi jika derived table update gagal?
10. Bagaimana sistem melakukan reconciliation?
```

Jangan tulis CQL dulu. Tulis correctness dan failure model lebih dulu.

---

## 33. Preview Part 003

Part berikutnya akan masuk ke lineage arsitektur Dynamo/Cassandra-style:

```text
ring
token
partitioner
replication
coordinator
gossip
snitch
hinted handoff
read repair
anti-entropy
```

Kita akan memahami bagaimana request bergerak secara fisik di cluster sebelum masuk ke ScyllaDB-specific architecture.

Setelah part 003, istilah seperti “coordinator”, “replica”, “token range”, dan “quorum” tidak lagi abstrak.

---

# End of Part 002


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-001.md">⬅️ Part 001 — Wide-Column Store Mental Model: Bukan SQL, Bukan Document DB, Bukan OLAP Columnar</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-003.md">Part 003 — Dynamo Lineage: Ring, Token, Replication, Coordinator, Gossip ➡️</a>
</div>
