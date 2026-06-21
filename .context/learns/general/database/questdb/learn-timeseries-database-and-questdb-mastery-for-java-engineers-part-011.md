# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-011.md

# Write-Ahead Log, Durability, and WAL Apply Pipeline

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Part: `011`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami QuestDB sebagai production-grade time-series database, bukan sekadar endpoint ingestion.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas out-of-order data dan late arrival. Sekarang kita masuk ke salah satu mekanisme paling penting di QuestDB modern: **Write-Ahead Log (WAL)**.

Tujuan utama part ini adalah membuat kamu bisa menjawab:

1. Apa sebenarnya yang terjadi saat QuestDB menerima write?
2. Apa perbedaan antara write accepted, committed to WAL, applied to table, dan visible/efficient for query?
3. Mengapa WAL penting untuk concurrent writes, recovery, replication, deduplication, dan out-of-order handling?
4. Bagaimana membaca gejala production seperti WAL lag, table suspended, apply job lambat, disk penuh, dan schema conflict?
5. Bagaimana Java ingestion service harus bereaksi terhadap WAL-related failure?
6. Apa operational invariant yang harus dijaga agar QuestDB tetap sehat?

Part ini bukan hanya menjelaskan definisi WAL. Kita akan melihat WAL sebagai **durability boundary, concurrency boundary, failure isolation layer, dan replication substrate**.

---

## 2. Problem yang Sedang Diselesaikan

Time-series workload tampak sederhana:

```text
producer -> database -> query
```

Tetapi production workload tidak sesederhana itu.

Kamu mungkin punya:

```text
hundreds/thousands of producers
high insert throughput
out-of-order data
late replay
retry storm
schema evolution
replication requirement
dashboards querying hot data
backfill writing old partitions
```

Kalau setiap write langsung dimasukkan ke final table layout secara synchronous, database akan mudah bottleneck karena harus melakukan terlalu banyak pekerjaan di critical write path:

```text
validate row
resolve symbols
write column files
merge out-of-order data
update metadata
handle concurrency
preserve durability
possibly deduplicate
possibly replicate
make query-visible
```

Masalah utamanya:

```text
write path harus cepat,
tetapi storage layout final harus tetap benar, durable, queryable, dan recoverable.
```

WAL adalah mekanisme untuk memisahkan dua hal:

```text
1. accepting durable intent to write
2. applying that intent into optimized table storage
```

Dengan pemisahan ini, QuestDB bisa menerima write secara lebih concurrent dan resilient, sementara apply ke storage bisa dilakukan secara asynchronous.

---

## 3. Mental Model Utama

### 3.1 WAL sebagai “durable queue internal per table”

Mental model paling berguna:

```text
WAL table = table dengan internal durable append log
```

Write masuk ke WAL dulu, lalu background apply job menerapkan data itu ke table storage.

```text
Producer
   |
   v
Ingestion endpoint
   |
   v
WAL segment / sequencer   <-- durability boundary
   |
   v
WAL apply job             <-- asynchronous materialization
   |
   v
Native table partitions   <-- query-optimized storage
```

Jadi, WAL bukan sekadar file recovery. WAL adalah buffer durable yang memungkinkan QuestDB mengelola concurrency, late data, dedup, dan replication dengan lebih terstruktur.

---

### 3.2 Write accepted tidak sama dengan fully applied

Ini invariant penting.

Dalam sistem WAL-based:

```text
accepted by ingestion endpoint
!= fully merged into final storage layout
```

Ada beberapa state konseptual:

```text
received
validated enough to append
committed to WAL
sequenced
pending apply
being applied
applied to table
query-visible / query-efficient
```

Sebagai application engineer, kamu tidak boleh menganggap bahwa “HTTP 200 dari ingestion” berarti semua downstream query langsung melihat data dengan latency nol dan storage sudah fully compacted.

Biasanya visibility cepat, tetapi secara arsitektural kamu harus tetap memahami adanya pipeline.

---

### 3.3 WAL mengubah write path menjadi pipeline

Tanpa WAL, write path cenderung sinkron:

```text
client write -> storage mutation -> response
```

Dengan WAL:

```text
client write -> durable log append -> response
                  |
                  v
             async apply -> table storage
```

Konsekuensi:

- ingestion throughput bisa lebih tinggi,
- concurrent writer lebih aman,
- recovery lebih jelas,
- replication punya log source,
- tetapi kamu sekarang punya pipeline health yang harus dimonitor.

WAL bukan fitur gratis. Ia menambah state machine internal.

---

## 4. Konsep Inti

### 4.1 Durability boundary

Durability boundary adalah titik ketika sistem bisa berkata:

```text
Kalau proses crash setelah titik ini, data tetap bisa dipulihkan.
```

Dalam WAL-based database, boundary ini biasanya berada pada saat write sudah masuk ke log yang durable.

Secara konseptual:

```text
before WAL commit -> crash may lose write
WAL committed     -> crash can replay/apply write
after apply       -> write materialized into table storage
```

Untuk Java producer, ini berarti error handling harus membedakan:

```text
request definitely failed
request definitely accepted
request outcome unknown
```

Kategori terakhir sangat penting. Kalau network timeout terjadi setelah server menerima dan commit WAL, retry bisa menghasilkan duplicate kecuali ingestion idempotent.

---

### 4.2 Sequencing

Write dari banyak producer tidak boleh diterapkan sembarangan.

Database perlu ordering internal:

```text
writer A sends batch 10
writer B sends batch 11
writer C sends batch 12
```

Sequencer menentukan urutan transaksi/log apply agar table state konsisten.

Mental model:

```text
many producers -> WAL entries -> sequencer order -> apply pipeline
```

Sequencing tidak berarti data event-time harus selalu increasing. Sequencing adalah **ordering of write transactions**, bukan ordering of event timestamps.

Ini penting untuk membedakan:

```text
transaction order = kapan database menerima write
event time        = kapan event terjadi menurut domain
```

---

### 4.3 WAL segment

WAL biasanya disimpan dalam segment/log files.

Secara konseptual:

```text
wal/
  table_x/
    wal1/
      segment_0
      segment_1
    wal2/
      segment_0
```

Kamu tidak perlu menghafal detail layout internal untuk memakai QuestDB, tetapi kamu perlu memahami implikasinya:

- WAL menggunakan disk.
- WAL bisa bertumbuh jika apply tertinggal.
- WAL cleanup bergantung pada apply/release state.
- Disk full bisa membuat ingestion gagal atau table masuk state bermasalah.

---

### 4.4 Apply job

Apply job adalah worker yang membaca WAL dan menerapkan perubahan ke table storage.

Pekerjaan apply bisa termasuk:

- resolve schema metadata,
- write column files,
- update partition,
- merge out-of-order data,
- handle dedup,
- update transaction metadata,
- make data visible to query path,
- cleanup WAL yang sudah aman dibuang.

Apply job adalah tempat banyak biaya diserap.

Kalau workload mostly in-order append, apply relatif murah.

Kalau workload banyak late data, duplicate, schema changes, atau wide rows, apply bisa menjadi bottleneck.

---

### 4.5 WAL lag

WAL lag adalah jarak antara:

```text
latest committed WAL transaction
```

and

```text
latest applied table transaction
```

Secara intuitif:

```text
WAL lag = apply pipeline is behind ingestion pipeline
```

Lag bisa dilihat dalam beberapa bentuk:

```text
transaction lag
row lag
time lag
byte/disk lag
freshness lag
```

Dari sisi user/API, yang paling penting sering kali adalah:

```text
freshness lag = now - newest query-visible event / applied transaction
```

Namun untuk operator, byte lag dan transaction lag juga penting karena berkaitan dengan disk pressure.

---

## 5. QuestDB-Specific Mechanics

### 5.1 WAL table vs non-WAL table

Dalam QuestDB modern, table time-series yang partitioned dan memiliki designated timestamp biasanya dibuat sebagai WAL-enabled table by default.

WAL-enabled table penting untuk fitur seperti:

- concurrent writes,
- crash recovery,
- replication,
- deduplication,
- out-of-order ingestion handling,
- materialized view update chain.

Non-WAL table lebih sederhana, tetapi kehilangan banyak kemampuan produksi modern.

Untuk seri ini, default mental model kita:

```text
production time-series table should be WAL-enabled
```

---

### 5.2 WAL and designated timestamp

Designated timestamp tetap menjadi axis utama.

WAL mencatat write transaction, tetapi table storage tetap diorganisasi berdasarkan timestamp dan partition.

```text
WAL order       = order of committed writes
partition order = order by designated timestamp interval
query filter    = usually by designated timestamp range
```

Ini berarti write yang datang belakangan tetapi punya timestamp lama dapat menyebabkan apply job menyentuh partition lama.

Contoh:

```text
now = 2026-06-21T12:00:00Z
incoming event timestamp = 2026-05-01T10:00:00Z
```

WAL commit-nya baru, tetapi storage target-nya partition lama.

Inilah kenapa late arrival dan WAL apply sangat berkaitan.

---

### 5.3 WAL and out-of-order ingestion

Untuk in-order data:

```text
append to WAL -> apply to current/hot partition -> mostly append
```

Untuk out-of-order data:

```text
append to WAL -> apply needs merge into older timestamp range
```

Potential cost:

```text
old partition read
merge/reorder
rewrite/split/squash
update metadata
possibly dedup
```

Jadi ingestion endpoint bisa tetap menerima write, tetapi apply job yang membayar sebagian besar biaya O3.

Ini adalah alasan kenapa kita butuh memonitor WAL apply lag, bukan hanya client-side ingestion success.

---

### 5.4 WAL and deduplication

Deduplication pada WAL table memungkinkan database menghindari duplicate berdasarkan key tertentu.

Biasanya dedup key mencakup:

```sql
UPSERT KEYS(ts, device_id, metric_name)
```

Designated timestamp harus termasuk dalam upsert key.

Kenapa?

Karena dalam time-series, timestamp adalah bagian dari identity observasi.

Tanpa timestamp, database tidak tahu apakah dua event dari device yang sama adalah:

```text
same observation retried
```

atau

```text
two valid observations at different times
```

WAL membantu karena write transaction bisa diproses dengan metadata dan ordering yang dibutuhkan untuk dedup.

---

### 5.5 WAL and replication

Replication butuh sumber perubahan yang durable dan ordered.

WAL secara alami menyediakan itu:

```text
primary WAL -> replicate log/change stream -> replica apply
```

Jadi replication bukan hanya “copy files”. Ia butuh pemahaman transaksi, urutan perubahan, dan table state.

Implication:

- table harus cocok dengan replication requirements,
- reference/non-time-series table mungkin perlu strategi terpisah,
- replication lag adalah bentuk lain dari apply lag,
- failover client perlu memahami writable endpoint.

---

### 5.6 WAL and materialized views

Materialized view yang incremental membutuhkan perubahan baru untuk diterapkan ke hasil pre-computed.

WAL membantu memberikan stream perubahan yang bisa dipakai untuk update incremental.

Pipeline konseptual:

```text
raw table WAL apply
   |
   v
materialized view refresh/apply
   |
   v
serving query reads pre-aggregated data
```

Jika raw WAL apply tertinggal, materialized view juga dapat tertinggal.

Freshness chain:

```text
producer event time
-> ingestion receive time
-> WAL commit time
-> raw table apply time
-> materialized view refresh time
-> dashboard read time
```

SLO dashboard harus mempertimbangkan seluruh chain ini.

---

## 6. Java Engineer Perspective

### 6.1 Client success semantics

Java ingestion service biasanya melihat tiga kategori outcome:

```java
sealed interface IngestOutcome {}
record Accepted() implements IngestOutcome {}
record Rejected(String reason) implements IngestOutcome {}
record Unknown(Throwable cause) implements IngestOutcome {}
```

Kategori `Unknown` adalah yang paling berbahaya.

Contoh:

```text
client sends batch
server commits WAL
network drops before response reaches client
client sees timeout
```

Apakah batch masuk?

```text
unknown
```

Jika client retry tanpa idempotency, duplicate bisa muncul.

Karena itu, ingestion design harus punya salah satu:

1. dedup keys di QuestDB,
2. deterministic event id/key,
3. replay-safe upstream topic,
4. correction/duplicate cleanup process.

---

### 6.2 Retry policy must assume ambiguity

Bad retry model:

```java
catch (Exception e) {
    sendAgain(batch);
}
```

Better model:

```java
try {
    sender.send(batch);
    metrics.accepted.increment();
} catch (TransientNetworkException e) {
    // outcome may be unknown
    retryWithIdempotency(batch);
} catch (ServerRejectedException e) {
    // likely bad data/schema/auth; do not blind retry
    deadLetter(batch, e);
} catch (BackpressureException e) {
    slowDownOrBuffer(batch);
}
```

Retry policy must classify errors:

```text
transient retryable
permanent invalid data
capacity/backpressure
unknown outcome
operator intervention required
```

---

### 6.3 Ingestion freshness is not just client throughput

A Java service might report:

```text
sent rows/sec = 500k
error rate = 0%
```

But QuestDB might have:

```text
WAL apply lag increasing
query freshness degrading
WAL disk usage growing
```

That means your producer is not “healthy” from system perspective.

A good ingestion service should track:

```text
rows attempted/sec
rows accepted/sec
flush latency
retry count
dropped/DLQ count
oldest buffered event age
newest event timestamp sent
QuestDB freshness query result
WAL/table health indicator
```

Do not stop at client success rate.

---

### 6.4 Bounded buffer and WAL lag feedback

If QuestDB apply pipeline is behind, continuing to push full speed can turn lag into disk exhaustion.

A better architecture:

```text
producer threads
   |
   v
bounded queue
   |
   v
ingestion workers
   |
   v
QuestDB
   |
   v
health poller -> adaptive throttle
```

Pseudo-policy:

```text
if WAL lag normal:
    ingest at target rate
elif WAL lag warning:
    reduce batch rate, increase coalescing, pause backfill
elif WAL lag critical:
    stop non-critical producers, keep only high-priority live stream
elif table suspended:
    stop writes to table, alert operator, route to durable buffer/DLQ
```

This is not just database operation. It is application-level flow control.

---

## 7. WAL State Machine Mental Model

A simplified state machine for a WAL-enabled table:

```text
ACTIVE
  |
  | apply error / severe schema conflict / storage failure
  v
SUSPENDED
  |
  | operator fix + resume
  v
ACTIVE
```

For each write batch:

```text
CREATED_BY_PRODUCER
  -> SENT
  -> RECEIVED
  -> WAL_COMMITTED
  -> PENDING_APPLY
  -> APPLYING
  -> APPLIED
  -> QUERY_VISIBLE
```

Failure can happen at each boundary:

```text
before sent                 -> safe to retry
sent but no response         -> unknown outcome
WAL committed but not applied -> lag/freshness issue
apply failed                 -> table suspension or apply error
applied but query slow        -> query/storage/index/cardinality issue
```

This model is extremely useful during incidents.

Instead of saying:

```text
QuestDB is slow
```

Ask:

```text
Which state transition is slow or broken?
```

---

## 8. Failure Modes

### 8.1 WAL apply lag increasing

Symptoms:

```text
client writes succeed
queries miss latest data or become stale
WAL disk usage grows
apply transaction behind writer transaction
```

Likely causes:

```text
ingest rate > apply capacity
O3 storm
large backfill running with live ingestion
slow disk
too many wide columns
dedup cost high
partition too coarse
resource starvation
```

Immediate actions:

```text
pause backfill
reduce ingestion rate
separate late lane from live lane
check disk IO
check hottest tables
check recent schema changes
check query load competing for resources
```

Long-term fixes:

```text
partition tuning
producer ordering improvement
batch by timestamp range
separate raw/backfill table
increase IO capacity
reduce row width
improve dedup key design
```

---

### 8.2 Table suspended

A suspended table is a serious operational signal.

Conceptually:

```text
QuestDB stopped applying WAL for this table because continuing may be unsafe or impossible.
```

Possible causes:

```text
schema mismatch
metadata conflict
storage error
disk full
corrupt/inconsistent state
apply failure after bad write
```

Operator response:

```text
1. stop producers for that table
2. inspect table/WAL status
3. identify last failing transaction or schema operation
4. fix root cause
5. resume table if safe
6. validate freshness and row counts
7. replay missing data if needed
```

Application response:

```text
do not blind retry forever
route to durable buffer
alert operator
preserve original payloads for replay
```

---

### 8.3 Disk full due to WAL growth

WAL can grow when apply cannot keep up.

Symptoms:

```text
WAL files accumulating
disk usage increasing faster than raw table growth
ingestion starts failing
apply jobs failing
node instability
```

Root causes:

```text
apply lag
backfill storm
O3 merge cost
slow disk
large uncommitted/retry batches
replication lag preventing cleanup
```

Bad response:

```text
manually delete WAL files randomly
```

This can corrupt recovery semantics.

Better response:

```text
stop ingestion/backfill
free disk safely
increase capacity
allow apply to catch up
use documented recovery/resume procedures
validate table state
```

---

### 8.4 Schema change conflicts

Example:

Producer A sends:

```text
temperature=12.3
```

Producer B sends:

```text
temperature="12.3C"
```

If schema auto-creation/evolution is too permissive, the system may hit type conflict or rejected lines.

With WAL, bad schema changes may surface in apply path depending on timing and operation.

Prevention:

```text
explicit schema
producer contract tests
schema registry
reject unknown columns in gateway
DLQ invalid lines
controlled ALTER TABLE rollout
```

---

### 8.5 Replication lag

Replication lag means replica is behind primary.

Potential causes:

```text
primary WAL generation too fast
network bottleneck
replica apply slow
object/storage bottleneck
large O3/backfill transactions
```

Impact:

```text
read replica stale
failover data loss window increases
RPO worsens
analytics on replica inconsistent with primary
```

Operational response:

```text
measure replica freshness
avoid failover unless necessary
throttle non-critical ingestion
check network and replica IO
validate after catch-up
```

---

## 9. Operational Queries and Monitoring Concepts

Exact operational queries may evolve by QuestDB version, but the monitoring concepts remain stable.

You want visibility into:

```text
table status
WAL enabled/disabled
table suspended or active
writer transaction
sequencer transaction
applied transaction
WAL lag
row count by partition
newest timestamp visible
oldest pending event age
disk usage
apply error message
```

A practical freshness query:

```sql
SELECT
  now() - max(ts) AS freshness_lag
FROM sensor_readings;
```

For multi-tenant/device:

```sql
SELECT
  tenant_id,
  max(ts) AS newest_ts,
  now() - max(ts) AS freshness_lag
FROM sensor_readings
WHERE ts > dateadd('h', -1, now())
GROUP BY tenant_id;
```

Important: freshness lag based on `max(ts)` only works if event timestamps are close to real time. For late/backfilled historical data, use ingestion timestamp too.

Dual timestamp example:

```sql
SELECT
  now() - max(ingested_at) AS ingestion_visibility_lag,
  now() - max(event_ts) AS event_freshness_lag
FROM events;
```

---

## 10. Design Patterns

### 10.1 Live lane and backfill lane

Do not mix unlimited historical replay with live ingestion blindly.

Better:

```text
live producers -> live ingestion gateway -> QuestDB live table
backfill jobs  -> controlled backfill runner -> same table or staging table
```

Policy:

```text
live lane has priority
backfill is throttleable
backfill sorted by timestamp
backfill pauses if WAL lag grows
```

---

### 10.2 Staging table for risky replay

For risky historical correction:

```text
CSV/object source -> staging table -> validation queries -> insert into production table
```

Benefits:

- validate row count,
- validate timestamp range,
- validate symbol cardinality,
- detect duplicates,
- control final insert order,
- avoid polluting production table directly.

---

### 10.3 Idempotent batch contract

Every batch should be replayable.

Contract:

```text
same source data + same transformation + same dedup key = same final table state
```

This requires:

```text
stable timestamp
stable entity identity
stable metric identity
stable correction semantics
dedup/upsert keys where needed
```

---

### 10.4 WAL-aware circuit breaker

Your ingestion service should not only watch HTTP failures.

It should integrate database-side health:

```text
if table suspended:
    open breaker
if WAL lag > threshold:
    half-open / throttle
if disk pressure critical:
    open breaker for non-critical streams
if freshness lag normal:
    close breaker
```

This avoids turning a recoverable database lag into a full outage.

---

## 11. Java Implementation Sketch: WAL-Aware Ingestion Gateway

A simplified design:

```java
public final class QuestDbIngestionGateway {
    private final QuestDbSenderPool senderPool;
    private final IngestionQueue queue;
    private final QuestDbHealthProbe healthProbe;
    private final DeadLetterWriter deadLetterWriter;
    private final RateLimiter rateLimiter;

    public void ingest(TimeSeriesEvent event) {
        ValidationResult validation = validate(event);
        if (!validation.ok()) {
            deadLetterWriter.write(event, validation.reason());
            return;
        }

        HealthState health = healthProbe.current();
        if (health.tableSuspended(event.table())) {
            queue.persistForLater(event);
            return;
        }

        if (health.walLagCritical(event.table())) {
            if (event.priority() == Priority.LOW) {
                queue.persistForLater(event);
                return;
            }
            rateLimiter.reduce();
        }

        queue.offer(event);
    }
}
```

Worker loop:

```java
while (running) {
    Batch batch = queue.takeBatch(maxRows, maxWait);

    try {
        senderPool.send(batch);
        metrics.rowsAccepted(batch.size());
    } catch (RetryableException e) {
        queue.retryLater(batch);
        metrics.retry(batch.size());
    } catch (UnknownOutcomeException e) {
        // Must rely on dedup/idempotency before retrying.
        queue.retryWithIdempotency(batch);
        metrics.unknownOutcome(batch.size());
    } catch (PermanentDataException e) {
        deadLetterWriter.write(batch, e);
        metrics.deadLetter(batch.size());
    }
}
```

The key architectural point:

```text
QuestDB health is part of producer flow control.
```

---

## 12. Anti-Patterns

### 12.1 Treating WAL as invisible implementation detail

Bad:

```text
As long as inserts return success, the system is healthy.
```

Correct:

```text
Ingestion success + WAL apply health + query freshness + disk pressure define health.
```

---

### 12.2 Unlimited retry without dedup

Bad:

```text
network timeout -> resend batch forever
```

Consequence:

```text
duplicate rows
wrong aggregates
dashboard inflation
hard-to-debug historical corruption
```

Correct:

```text
retry only with idempotency boundary
```

---

### 12.3 Running large backfill during peak live ingestion

Bad:

```text
replay two years of data at max speed while dashboard and live ingestion run
```

Consequence:

```text
WAL lag
O3 storm
query latency spike
disk pressure
operator confusion
```

Correct:

```text
controlled backfill window, sorted batches, lag-aware throttle
```

---

### 12.4 Manual WAL file deletion

Bad:

```text
Disk full? Delete WAL files manually.
```

This is dangerous because WAL files encode recovery/apply state.

Correct:

```text
pause ingestion, free unrelated disk, follow documented recovery procedure, validate table state
```

---

### 12.5 Ignoring table suspension

Bad:

```text
Table suspended but producers keep sending.
```

Correct:

```text
stop writes for affected table, preserve payloads, fix root cause, resume safely
```

---

## 13. Production Checklist

Before relying on a WAL-enabled QuestDB table in production, verify:

### Table design

```text
[ ] table is WAL-enabled where required
[ ] table has designated timestamp
[ ] table is partitioned appropriately
[ ] dedup/upsert keys defined if retry/replay can duplicate data
[ ] schema evolution is controlled
```

### Ingestion design

```text
[ ] producer handles unknown outcome
[ ] retry policy is idempotent
[ ] invalid rows go to DLQ
[ ] batching is bounded
[ ] backfill can be throttled
[ ] live and historical lanes have separate controls
```

### Monitoring

```text
[ ] table active/suspended status monitored
[ ] WAL/apply lag monitored
[ ] disk usage monitored
[ ] freshness lag monitored
[ ] apply errors alerted
[ ] ingestion rate vs apply rate compared
```

### Operations

```text
[ ] runbook exists for WAL lag
[ ] runbook exists for table suspension
[ ] runbook exists for disk pressure
[ ] runbook exists for bad schema producer
[ ] recovery procedure tested
[ ] replay procedure tested
```

### Java service

```text
[ ] bounded queue exists
[ ] shutdown flushes safely
[ ] health probe includes QuestDB status
[ ] circuit breaker can pause low-priority ingestion
[ ] DLQ preserves original payload and error reason
[ ] metrics expose accepted/retry/unknown/rejected rows
```

---

## 14. Hands-On Lab

### Lab 1: Simulate unknown outcome

Goal: prove that network timeout creates ambiguous write state.

Steps:

1. Create a table with dedup keys.
2. Send a batch from Java.
3. Artificially interrupt client connection after sending.
4. Retry the same batch.
5. Query row count.
6. Compare behavior with and without dedup.

Expected lesson:

```text
retry safety must be designed, not assumed
```

---

### Lab 2: Create WAL lag with backfill

Goal: observe how historical data affects apply pipeline.

Steps:

1. Create partitioned WAL table.
2. Start live ingestion with current timestamps.
3. Start second job replaying old timestamps.
4. Monitor freshness and table/WAL status.
5. Throttle backfill.
6. Observe recovery.

Expected lesson:

```text
O3/backfill can hurt freshness even when live writes are accepted
```

---

### Lab 3: WAL-aware producer throttle

Goal: implement adaptive producer behavior.

Build:

```text
Java producer -> bounded queue -> QuestDB
              <- health poller
```

Policy:

```text
if freshness lag > threshold:
    reduce rate by 50%
if freshness lag critical:
    pause backfill
if freshness normal for N intervals:
    restore rate gradually
```

Expected lesson:

```text
flow control must include database-side health
```

---

## 15. Decision Framework

Use this when diagnosing QuestDB write-side issues:

```text
Are clients failing?
  yes -> ingestion endpoint/network/auth/schema/capacity issue
  no  -> continue

Are clients succeeding but queries stale?
  yes -> WAL/apply/materialized-view lag issue
  no  -> continue

Is WAL/apply lag growing?
  yes -> apply capacity < write workload
  no  -> continue

Is disk growing abnormally?
  yes -> WAL cleanup/apply/replication/backfill issue
  no  -> continue

Is only one table affected?
  yes -> table-specific schema/O3/cardinality/partition issue
  no  -> node-wide resource issue

Is workload historical/replay-heavy?
  yes -> sort/throttle/stage/backfill controls
  no  -> inspect live ingest rate, disk, query contention
```

---

## 16. Key Takeaways

WAL is not merely a recovery file. In QuestDB, WAL is a core part of the production write architecture.

The most important mental model:

```text
QuestDB write path is a pipeline:
client -> WAL -> apply -> table storage -> query freshness
```

Therefore, production health is not simply:

```text
insert success rate
```

It is:

```text
insert success
+ WAL apply health
+ freshness lag
+ disk pressure
+ table state
+ retry idempotency
```

For Java engineers, the key design shift is:

```text
producer success is not the same as system correctness
```

A serious ingestion service must handle:

- unknown outcome,
- idempotent retry,
- bounded buffering,
- QuestDB-side lag feedback,
- DLQ for invalid rows,
- pause/throttle for backfill,
- table suspension runbook.

Once you understand WAL, many QuestDB behaviors become easier to reason about:

```text
Why can ingestion succeed but dashboard freshness degrade?
Why can backfill affect live data freshness?
Why does dedup require careful keys?
Why should disk pressure be treated as write-path risk?
Why does replication need WAL-enabled time-series tables?
```

This part gives the foundation for the next topic: **deduplication and idempotent ingestion**.

---

## 17. What Comes Next

Next part:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-012.md
Deduplication and Idempotent Ingestion
```

We will go deeper into:

- duplicate as normal production condition,
- `DEDUP` and `UPSERT KEYS`,
- retry/replay/idempotency design,
- correction vs overwrite,
- dedup key selection,
- Java producer identity contract,
- exactly-once illusion vs practical correctness.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-010.md">⬅️ Part 010 — Out-of-Order Data and Late Arrival Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-012.md">Deduplication and Idempotent Ingestion ➡️</a>
</div>
