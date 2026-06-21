# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-027.md

# Pipeline Architecture with Kafka/RabbitMQ Without Repeating Messaging Theory

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Part: `027`  
> Target pembaca: Java software engineer / tech lead  
> Fokus: bagaimana menempatkan Kafka/RabbitMQ di depan QuestDB secara benar untuk replay, buffering, backpressure, isolation, dan operability tanpa mengulang teori broker yang sudah pernah dibahas di seri Kafka/RabbitMQ.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas:

- ingestion model QuestDB,
- Java ILP client,
- schema contract,
- out-of-order data,
- WAL,
- idempotency,
- SQL temporal,
- materialized view,
- observability,
- security,
- dan integration pattern Java.

Part ini menjawab pertanyaan arsitektural yang sering muncul di production:

> Kalau saya sudah punya Kafka/RabbitMQ, bagaimana menyalurkan event ke QuestDB tanpa membuat pipeline rapuh, duplikatif, sulit di-replay, atau membingungkan secara ownership?

Yang penting: Kafka/RabbitMQ bukan syarat wajib sebelum QuestDB.

Broker berguna bila ada kebutuhan:

- replay,
- decoupling producer/consumer,
- smoothing burst,
- multi-subscriber,
- ordered partition processing,
- durability sebelum database,
- transform/enrichment sebelum write,
- atau isolation antara domain event dan storage-specific ingestion.

Tetapi broker juga menambah:

- latency,
- operational surface,
- duplicate risk,
- schema drift surface,
- monitoring surface,
- reprocessing complexity,
- dan failure modes baru.

Target part ini adalah membangun decision framework:

```text
Should data flow be:

producer -> QuestDB

or

producer -> Kafka/RabbitMQ -> ingestion service -> QuestDB

or

producer -> Kafka/RabbitMQ -> Kafka Connect / sink connector -> QuestDB
```

---

## 2. Prinsip Utama: Broker Is Not the Database

Salah satu kesalahan paling umum dalam pipeline time-series adalah mencampur peran:

```text
Kafka/RabbitMQ = transport / buffer / replay / fan-out
QuestDB        = queryable time-series store
Java service   = contract enforcement / transformation / operational boundary
```

Broker bukan tempat utama untuk query analitik temporal.

QuestDB bukan broker.

Java ingestion service bukan sekadar adapter; ia adalah control boundary.

Kalau peran ini kabur, pipeline biasanya berubah menjadi sistem yang sulit dijelaskan:

```text
Producer publishes event.
Kafka stores event.
Consumer transforms event.
QuestDB stores metric.
Materialized view stores rollup.
Dashboard queries rollup.
Alert reads latest view.
Backfill replays Kafka.
Correction writes new event.
```

Pertanyaannya:

```text
Which layer owns truth?
Which layer owns replay?
Which layer owns dedup?
Which layer owns schema validation?
Which layer owns freshness SLO?
Which layer owns correction semantics?
```

Tanpa jawaban eksplisit, incident response menjadi kacau.

---

## 3. QuestDB Ingestion Grounding

QuestDB ingestion produksi umumnya diarahkan ke ILP/first-party clients untuk throughput tinggi. PGWire/JDBC lebih cocok untuk query dan low-volume SQL insert. Artinya, bila Kafka/RabbitMQ berada di depan QuestDB, consumer layer sebaiknya menulis ke QuestDB melalui ILP client, bukan menjadikan QuestDB sebagai generic JDBC sink kecuali volume dan semantics-nya memang sederhana.

QuestDB juga memiliki Kafka connector ecosystem, termasuk QuestDB Kafka sink connector yang membaca Kafka topic dan menulis ke QuestDB table. Ini berguna untuk pipeline standar, tetapi bukan pengganti desain contract, dedup key, timestamp semantics, dan error routing.

Mental model:

```text
Kafka topic / RabbitMQ queue is not a QuestDB table.

A broker message must be interpreted into:
- target table,
- designated timestamp,
- symbols,
- fields,
- dedup identity,
- quality state,
- error policy,
- and lifecycle policy.
```

---

## 4. Three Canonical Pipeline Shapes

### 4.1 Direct Ingestion

```text
producer service
    -> QuestDB ILP
```

Cocok bila:

- producer sedikit,
- throughput stabil,
- replay tidak kritis,
- data bisa hilang sebagian tanpa business disaster,
- latency sangat penting,
- tidak butuh fan-out,
- ingestion service bisa menanggung retry/backpressure.

Kelebihan:

- arsitektur sederhana,
- latency rendah,
- lebih sedikit moving parts,
- lebih mudah diamati.

Kekurangan:

- replay sulit,
- producer perlu tahu QuestDB/ILP contract,
- QuestDB incident langsung berdampak ke producer,
- burst harus ditangani producer.

Pattern ini cocok untuk:

- internal telemetry sederhana,
- local/edge collection,
- low-volume service metrics,
- PoC,
- single bounded domain.

Anti-pattern:

```text
Every business service writes directly to QuestDB using its own table naming, timestamp choice, symbol set, and retry policy.
```

Itu akan menghasilkan schema sprawl.

---

### 4.2 Broker + Custom Java Ingestion Service

```text
producer services
    -> Kafka/RabbitMQ
    -> Java ingestion service
    -> QuestDB ILP
```

Ini biasanya pattern paling fleksibel untuk enterprise Java systems.

Cocok bila:

- butuh replay,
- butuh transform/enrichment,
- butuh validation,
- banyak producer,
- schema contract perlu dikontrol,
- ingestion ke QuestDB harus dilindungi dari producer buruk,
- perlu DLQ,
- perlu tenant enforcement,
- perlu custom idempotency/correction semantics,
- perlu metrics dan runbook yang jelas.

Java ingestion service berperan sebagai:

```text
contract boundary
+ transformation boundary
+ backpressure boundary
+ idempotency boundary
+ observability boundary
+ security boundary
+ failure isolation boundary
```

Kelebihan:

- paling kontrollable,
- error handling fleksibel,
- bisa menerapkan business-specific validation,
- bisa punya per-topic/per-table routing,
- bisa melakukan late lane/backfill lane separation,
- bisa memberi freshness metrics yang meaningful.

Kekurangan:

- perlu development/operational ownership,
- bug di ingestion service bisa merusak data,
- perlu testing serius,
- perlu capacity planning consumer.

Pattern ini cocok untuk:

- regulated telemetry,
- financial market data,
- industrial IoT,
- multi-tenant platform,
- application observability internal,
- pipeline dengan correction/replay.

---

### 4.3 Broker + Kafka Connect / Sink Connector

```text
producer services
    -> Kafka
    -> Kafka Connect QuestDB sink
    -> QuestDB
```

Cocok bila:

- data sudah bersih,
- mapping topic-to-table relatif sederhana,
- tidak banyak custom business validation,
- tim ingin operationally standard Kafka Connect pipeline,
- throughput dan schema mapping sesuai kemampuan connector,
- transformation bisa ditangani SMT atau upstream.

Kelebihan:

- tidak perlu menulis consumer Java sendiri,
- deploy/scale via Kafka Connect,
- cocok untuk streaming integration standar,
- dapat memakai ekosistem Kafka Connect.

Kekurangan:

- custom error semantics terbatas,
- transformation kompleks menjadi sulit,
- debugging bisa lebih tidak langsung,
- connector configuration menjadi production-critical,
- schema contract tetap harus didesain di luar connector.

Pattern ini cocok untuk:

- topic telemetry standar,
- schema stabil,
- ingestion pipeline yang tidak butuh custom domain logic,
- centralized data platform.

Anti-pattern:

```text
Using a sink connector to hide unresolved domain modeling questions.
```

Connector dapat mengirim data; ia tidak otomatis membuat data benar.

---

## 5. Kafka vs RabbitMQ in Front of QuestDB

Karena teori Kafka/RabbitMQ sudah dibahas di seri lain, di sini kita hanya bahas konsekuensi untuk QuestDB.

### 5.1 Kafka Fit

Kafka cocok bila pipeline butuh:

- durable ordered log,
- replay jangka panjang,
- consumer group parallelism,
- topic partitioning by series/entity,
- backfill from historical offset,
- multiple downstream consumers,
- high-throughput streaming.

Kafka sangat cocok sebagai replay buffer sebelum QuestDB.

Contoh:

```text
market-ticks topic
    key = instrument_id
    value = tick event

consumer group = questdb-market-ingestor
    partition assignment preserves ordering per instrument_id
    writes trades/quotes/order_book tables
```

Kelemahan:

- at-least-once delivery umum berarti duplicate normal,
- consumer commit harus selaras dengan QuestDB write semantics,
- replay bisa membanjiri QuestDB,
- partition key buruk dapat merusak ordering dan parallelism,
- schema evolution perlu disiplin.

### 5.2 RabbitMQ Fit

RabbitMQ cocok bila pipeline butuh:

- command/task delivery,
- routing exchange,
- short-lived buffering,
- operational work queue,
- per-message acknowledgement,
- low-latency dispatch,
- simpler topology untuk bounded workloads.

RabbitMQ lebih cocok untuk operational telemetry atau task-driven ingestion, bukan long-term replay log.

Contoh:

```text
factory telemetry collector
    -> RabbitMQ topic exchange
    -> questdb-ingestion queue
    -> Java ingestion workers
    -> QuestDB ILP
```

Kelemahan:

- replay jangka panjang bukan kekuatan utama,
- ordering per entity lebih sulit dijamin pada scale-out consumer,
- queue backlog bukan historical data lake,
- message TTL/dead-letter policy harus sangat jelas.

### 5.3 Decision Shortcut

```text
Need replay days/weeks/months?        -> Kafka
Need multiple streaming consumers?    -> Kafka
Need partitioned ordered log?         -> Kafka
Need operational task queue?          -> RabbitMQ
Need routing/exchange semantics?      -> RabbitMQ
Need simple short buffer?             -> RabbitMQ or direct
Need ultra simple low-latency path?    -> Direct ILP
```

---

## 6. Topic/Queue Design for QuestDB

A broker topic should not blindly mirror database tables.

There are three common mapping styles.

### 6.1 Topic per Domain Event

```text
machine-measurement-events
trade-events
quote-events
application-request-metrics
```

Then ingestion service maps domain event to one or more QuestDB tables.

Pros:

- clean domain boundary,
- replay source remains domain-oriented,
- QuestDB schema can evolve separately.

Cons:

- ingestion service needs transformation logic,
- more code.

Best for enterprise systems.

### 6.2 Topic per Target Table

```text
questdb.trades
questdb.quotes
questdb.sensor_readings
```

Pros:

- simple routing,
- easier connector usage,
- less transformation.

Cons:

- producers leak storage concerns,
- harder to change QuestDB schema,
- topic becomes database-coupled.

Best for controlled data platform pipelines, not broad service autonomy.

### 6.3 Topic per Signal Class

```text
metrics.raw
events.raw
states.raw
ticks.raw
```

Pros:

- scalable taxonomy,
- allows common validation per class,
- flexible downstream routing.

Cons:

- can become generic dumping ground,
- requires strong schema registry.

Best for observability/telemetry platforms with strong governance.

---

## 7. Partition Key Design

For Kafka, partition key impacts:

- ordering,
- parallelism,
- consumer locality,
- late event grouping,
- dedup behavior,
- replay cost,
- hot partition risk.

For QuestDB ingestion, common keys:

```text
instrument_id
sensor_id
device_id
tenant_id + device_id
service + endpoint
site + machine_id
```

Bad keys:

```text
random UUID per event
current timestamp
tenant_id only for huge tenant
constant key
```

### 7.1 Key by Series Identity

The safest default is:

```text
Kafka key = time-series identity
```

Example:

```text
sensor_id = plant-7.line-2.press-44
```

Benefits:

- preserves order per sensor,
- makes duplicate/replay behavior more predictable,
- balances if identity cardinality is high enough,
- aligns with QuestDB `SYMBOL` identity.

### 7.2 Composite Key

For multi-tenant systems:

```text
tenant_id + ':' + device_id
```

But beware tenant skew:

```text
Tenant A has 80% of traffic.
Keying only by tenant_id creates hot Kafka partition.
```

Better:

```text
tenant_id + ':' + stable_series_id
```

---

## 8. Consumer Commit Semantics

This is one of the most important sections.

Naive consumer logic:

```text
read message
write to QuestDB
commit offset
```

Looks simple, but each step can fail.

### 8.1 Failure Matrix

| Step | Failure | Result |
|---|---|---|
| Read message | consumer crashes before write | message redelivered |
| Write to QuestDB | timeout unknown outcome | maybe written, maybe not |
| Write succeeded | crash before commit | message redelivered; duplicate possible |
| Commit succeeded | later data invalid | cannot replay unless offset retained |
| QuestDB WAL accepted | apply delayed | offset committed but query not fresh yet |

The key invariant:

```text
Kafka/RabbitMQ consumer must assume at-least-once delivery into QuestDB.
```

Therefore QuestDB ingestion must be idempotent or duplicates must be acceptable by design.

### 8.2 Offset Commit After Flush

With batched ILP:

```text
poll N records
validate/transform
write batch to ILP sender
flush
commit offsets
```

But flush success may still not equal long-term query freshness if WAL apply is delayed.

Operationally:

```text
commit offset after QuestDB accepts the write boundary,
monitor freshness separately.
```

Do not wait for dashboard query visibility per message unless your system explicitly requires synchronous read-after-write.

### 8.3 Ambiguous Outcome

If ILP write times out:

```text
The consumer may not know whether QuestDB received the batch.
```

The correct response is not “assume failed and write again blindly” unless duplicate handling is safe.

Correct design:

```text
stable dedup key
+ safe replay
+ bounded retry
+ DLQ for non-transient failures
+ metrics for ambiguous retries
```

---

## 9. Idempotency Boundary Across Broker and QuestDB

Idempotency can be implemented at several layers:

```text
producer event_id
broker key + offset
ingestion service deterministic mapping
QuestDB DEDUP / UPSERT KEYS
raw immutable table + serving dedup view
```

### 9.1 Broker Offset Is Not a Business Identity

Kafka offset is stable only within a topic partition log. It is not a good domain dedup key if:

- topic is re-created,
- event is copied to another topic,
- event is backfilled from file,
- RabbitMQ is used,
- multiple producers emit equivalent facts.

Better identity:

```text
tenant_id
+ series_id
+ event_time
+ source_event_id or measurement_id
```

For market ticks:

```text
venue + instrument + trade_id + event_time
```

For sensor readings:

```text
device_id + sensor_id + event_time + measurement_seq
```

For application metrics:

```text
service + instance + metric_name + bucket_start + dimensions_hash
```

### 9.2 Duplicate vs Correction

Duplicate:

```text
same fact delivered more than once
```

Correction:

```text
new information changes previously stored fact
```

Never mix them without explicit policy.

Possible strategies:

```text
DEDUP overwrite same key
append revision row
raw immutable + serving latest correction
correction table joined at query time
```

---

## 10. Backpressure Architecture

A broker gives buffering, but buffering is not infinite safety.

You need explicit backpressure design:

```text
producer -> broker backlog -> consumer lag -> QuestDB WAL lag -> query freshness lag -> dashboard/API stale
```

The pipeline must define which layer slows down first.

### 10.1 Backpressure Signals

From broker:

- Kafka consumer lag,
- RabbitMQ queue depth,
- oldest message age,
- redelivery count,
- DLQ size.

From ingestion service:

- batch flush latency,
- retry count,
- bounded queue utilization,
- dropped/invalid event count,
- records/sec in/out,
- transform latency.

From QuestDB:

- accepted write throughput,
- WAL pending rows,
- WAL apply lag,
- suspended tables,
- disk utilization,
- O3 pressure,
- query freshness.

### 10.2 Backpressure Decision Tree

```text
Is broker lag increasing?
  yes -> Is QuestDB accept latency increasing?
       yes -> reduce consumers / batch better / protect QuestDB
       no  -> ingestion service CPU/transform bottleneck

Is QuestDB WAL lag increasing?
  yes -> database apply cannot keep up; adding consumers may worsen it

Is disk time-to-full decreasing fast?
  yes -> stop/reduce ingestion before data loss

Is DLQ growing?
  yes -> producer/schema/data quality incident, not capacity incident
```

### 10.3 Avoid “Scale Consumers Until Death”

A common mistake:

```text
Kafka lag is high -> increase consumer replicas
```

This can worsen QuestDB if bottleneck is database write/apply/disk.

Correct logic:

```text
Scale consumers only if QuestDB has write/apply headroom.
```

---

## 11. Replay and Backfill Strategy

Replay is one of the main reasons to put Kafka before QuestDB.

But replay is dangerous because it can:

- create duplicates,
- trigger O3 storms,
- overwrite corrected data,
- bypass validation changes,
- overload WAL apply,
- make dashboard freshness worse,
- fill disk.

### 11.1 Live Lane vs Replay Lane

Separate live ingestion from replay/backfill.

```text
Kafka live topic
    -> live ingestion service
    -> QuestDB

Kafka historical topic / replay job
    -> replay ingestion service
    -> QuestDB
```

Benefits:

- throttle replay independently,
- isolate metrics,
- use different batch size,
- use different error policy,
- pause replay without affecting live data.

### 11.2 Sort Historical Backfill When Possible

QuestDB can handle out-of-order data, but historical replay in random timestamp order increases merge/rewrite work.

Backfill principle:

```text
Load historical data in timestamp/partition-friendly order when possible.
```

For Kafka replay, ordering is constrained by topic partition order. If replay is heavily out-of-time-order, consider:

- topic repartitioning by time bucket + series,
- offline sorted files + CSV/import path,
- replay window throttling,
- temporary table then validate/merge,
- per-partition batch scheduling.

### 11.3 Replay Safety Checklist

Before replay:

```text
[ ] Is dedup key correct?
[ ] Is target table DEDUP-enabled if overwrite expected?
[ ] Is disk headroom enough?
[ ] Is WAL headroom enough?
[ ] Is TTL going to delete replayed data unexpectedly?
[ ] Are materialized views affected?
[ ] Is live ingestion protected?
[ ] Is replay throttled?
[ ] Is query freshness monitored separately?
[ ] Is rollback strategy defined?
```

---

## 12. DLQ Design

DLQ is not a trash can.

A DLQ is a controlled quarantine for records that cannot be safely written.

Common DLQ categories:

```text
invalid_schema
invalid_timestamp
unknown_metric
forbidden_symbol_value
cardinality_budget_exceeded
unsupported_unit
parse_error
questdb_non_retryable_error
retry_exhausted
security_violation
```

DLQ record should include:

```json
{
  "sourceTopic": "sensor-readings",
  "sourcePartition": 12,
  "sourceOffset": 99128811,
  "errorClass": "invalid_timestamp",
  "errorMessage": "event_time is 9 days in future",
  "receivedAt": "2026-06-21T12:00:00Z",
  "rawPayload": "...",
  "contractVersion": "sensor-reading-v3",
  "targetTable": "sensor_readings"
}
```

DLQ must have owner and process:

```text
Detect -> classify -> fix producer or mapping -> replay DLQ -> verify QuestDB rows -> close incident
```

Anti-pattern:

```text
Silently skip invalid data and only log an error.
```

Logs disappear. DLQ is an operational data structure.

---

## 13. Transformation Boundary

Where should transformation happen?

Possible places:

```text
producer
broker stream processor
Kafka Connect SMT
custom Java ingestion service
QuestDB SQL/materialized view
query API
```

### 13.1 Producer-Side Transformation

Good for:

- domain-owned semantics,
- canonical event construction,
- unit normalization at source.

Bad for:

- storage-specific table concerns,
- QuestDB symbol/index decisions,
- central validation that must be consistent across producers.

### 13.2 Ingestion-Service Transformation

Good for:

- table routing,
- validation,
- symbol normalization,
- enrichment from reference data,
- quality flags,
- dedup identity,
- DLQ.

This is often the best boundary.

### 13.3 QuestDB-Side Transformation

Good for:

- rollups,
- materialized views,
- temporal analytics,
- latest state views,
- serving projections.

Bad for:

- fixing malformed producer contracts,
- high-cardinality normalization,
- security/tenant validation.

---

## 14. Reference Architecture: Kafka to QuestDB

```text
              +----------------+
              | Java Producers |
              +----------------+
                       |
                       v
              +----------------+
              | Kafka Topics   |
              | raw domain log |
              +----------------+
                       |
                       v
          +-------------------------+
          | QuestDB Ingestion Svc   |
          | - validate              |
          | - normalize             |
          | - classify timestamp    |
          | - enforce schema        |
          | - enforce cardinality   |
          | - batch ILP             |
          | - retry/DLQ             |
          | - emit metrics          |
          +-------------------------+
             |                 |
             v                 v
      +--------------+     +-----------+
      | QuestDB ILP  |     | DLQ Topic |
      +--------------+     +-----------+
             |
             v
      +----------------+
      | QuestDB Tables |
      | raw + rollups  |
      +----------------+
             |
             v
      +----------------+
      | Query APIs     |
      | Dashboards     |
      | Alerts         |
      +----------------+
```

Key characteristics:

- Kafka owns replay.
- Ingestion service owns contract enforcement.
- QuestDB owns queryable time-series storage.
- DLQ owns invalid/retry-exhausted records.
- Query APIs own user-facing guardrails.

---

## 15. Reference Architecture: RabbitMQ to QuestDB

```text
              +------------------+
              | Edge Collectors  |
              +------------------+
                       |
                       v
              +------------------+
              | RabbitMQ Exchange|
              +------------------+
                 |       |       |
                 v       v       v
             queues by site / signal class
                 |
                 v
        +----------------------+
        | Java Ingestion Worker|
        | ack after ILP flush  |
        +----------------------+
                 |
                 v
              QuestDB
```

RabbitMQ-specific considerations:

- use manual acknowledgements,
- cap prefetch,
- define redelivery policy,
- define DLX/dead-letter exchange,
- watch oldest message age,
- avoid unbounded requeue loops,
- use idempotent writes because redelivery is normal.

Example acknowledgement policy:

```text
valid transient QuestDB error:
    retry with bounded attempts or requeue with delay

invalid event:
    reject to DLQ, no requeue

ambiguous write timeout:
    retry only if idempotency key is safe

consumer crash after write before ack:
    message redelivered; QuestDB dedup must handle it
```

---

## 16. Java Ingestion Service Design

### 16.1 Package Structure

```text
com.example.telemetry.ingestion
├── consumer
│   ├── KafkaTelemetryConsumer.java
│   └── RabbitTelemetryConsumer.java
├── contract
│   ├── TelemetryEvent.java
│   ├── SchemaVersion.java
│   └── ValidationResult.java
├── transform
│   ├── QuestDbRowMapper.java
│   ├── SymbolNormalizer.java
│   └── TimestampClassifier.java
├── writer
│   ├── QuestDbBatchWriter.java
│   ├── IlpSenderFactory.java
│   └── RetryPolicy.java
├── dlq
│   ├── DeadLetterPublisher.java
│   └── DeadLetterRecord.java
├── metrics
│   ├── IngestionMetrics.java
│   └── FreshnessTracker.java
└── config
    └── IngestionProperties.java
```

### 16.2 Consumer Loop Pseudocode

```java
while (running) {
    ConsumerRecords<String, byte[]> records = kafka.poll(Duration.ofMillis(500));

    Batch batch = new Batch();

    for (ConsumerRecord<String, byte[]> record : records) {
        try {
            TelemetryEvent event = decoder.decode(record.value());
            ValidationResult validation = validator.validate(event);

            if (!validation.isValid()) {
                dlq.publish(record, validation.error());
                continue;
            }

            QuestDbRow row = mapper.toQuestDbRow(event);
            batch.add(row, record);
        } catch (Exception e) {
            dlq.publish(record, e);
        }
    }

    try {
        questDbWriter.writeAndFlush(batch.rows());
        kafka.commitSync(batch.offsets());
        metrics.recordSuccess(batch);
    } catch (TransientQuestDbException e) {
        retryOrPause(batch, e);
    } catch (NonRetryableQuestDbException e) {
        dlq.publishAll(batch.records(), e);
        kafka.commitSync(batch.offsets());
    }
}
```

Important nuance:

```text
Commit only records whose handling outcome is durable:
- written/accepted by QuestDB, or
- intentionally DLQ'd.
```

### 16.3 Batch Sizing

Batch sizing should consider:

- ILP flush latency,
- max acceptable consumer processing delay,
- memory footprint,
- Kafka max poll interval,
- QuestDB write acceptance,
- WAL lag,
- O3 risk.

Naive large batch:

```text
higher throughput but larger ambiguous outcome on failure
```

Naive tiny batch:

```text
lower latency but high overhead and poor throughput
```

Production pattern:

```text
flush when:
- rows >= maxRowsPerBatch
- bytes >= maxBytesPerBatch
- elapsed >= maxFlushInterval
- partition assignment revoked
- shutdown begins
```

---

## 17. Connector vs Custom Consumer Decision Matrix

| Need | Kafka Connect Sink | Custom Java Consumer |
|---|---:|---:|
| Simple topic-to-table mapping | Strong | Strong |
| Complex validation | Weak/Medium | Strong |
| Domain-specific DLQ | Medium | Strong |
| Custom correction semantics | Weak | Strong |
| Easy platform deployment | Strong | Medium |
| Fine-grained backpressure | Medium | Strong |
| Multi-table routing | Depends | Strong |
| Tenant-specific policy | Weak/Medium | Strong |
| Low engineering effort | Strong | Weak |
| Full code-level observability | Medium | Strong |

Default guidance:

```text
Use connector when mapping is boring.
Use custom Java consumer when correctness is domain-specific.
```

---

## 18. Freshness SLO Across Broker and QuestDB

Freshness is not the same as consumer lag.

End-to-end freshness:

```text
now - max(event_time visible in queryable QuestDB table)
```

Pipeline freshness decomposition:

```text
producer delay
+ broker queue delay
+ consumer processing delay
+ QuestDB accept delay
+ WAL apply delay
+ materialized view refresh delay
+ query API/cache delay
```

Define SLO per table/signal:

```text
raw telemetry visible within 10s p95
rollup visible within 30s p95
alerting latest state visible within 5s p95
backfill allowed to lag by hours
```

Metrics should include:

```text
broker_oldest_message_age
consumer_lag_records
consumer_processing_latency
questdb_flush_latency
questdb_wal_pending_rows
questdb_table_freshness_seconds
materialized_view_freshness_seconds
end_to_end_freshness_seconds
```

---

## 19. Multi-Consumer and Multi-Table Routing

One event can produce multiple QuestDB writes.

Example application request event:

```text
request event
  -> request_latency_raw
  -> http_status_counter_raw
  -> user_journey_step_raw
```

This raises consistency questions:

```text
If write 1 succeeds and write 2 fails, what happens?
```

Options:

1. Treat each target table independently.
2. Write to raw table only, derive other tables via materialized views/jobs.
3. Retry entire batch idempotently.
4. DLQ whole event if any target fails.

Recommended default:

```text
Prefer one canonical raw write, then derive serving projections.
```

Multi-table writes are valid, but they increase failure complexity.

---

## 20. Ordering Guarantees and QuestDB

QuestDB can ingest out-of-order data, but ordering still matters for cost and semantics.

Broker ordering helps:

- reduce O3 cost,
- preserve state transition sequence,
- make correction logic deterministic,
- simplify dedup.

But broker ordering is usually only per partition/key.

Therefore:

```text
If order matters per series, partition broker by series identity.
```

Do not assume global event order.

Global order is usually unnecessary and expensive.

---

## 21. Handling Late Data in Broker Pipelines

Late data should be classified before writing.

Example classification:

```text
if event_time > now + futureSkewLimit:
    DLQ invalid_future_timestamp

else if event_time < now - maxLiveLateness:
    route to late lane

else:
    route to live lane
```

Late lane can use:

- lower concurrency,
- larger batch sorted by time,
- different materialized view refresh strategy,
- throttled replay,
- additional validation.

Do not let unlimited late replay compete with live ingestion unless you explicitly accept freshness degradation.

---

## 22. Schema Registry and Contract Evolution

A broker pipeline makes schema evolution more visible because messages persist and can be replayed.

If consumers change mapping, replaying old messages may produce different QuestDB rows.

You need:

```text
message schema version
mapping version
target table version
unit version
dedup key version
```

Example:

```json
{
  "schemaVersion": "sensor-reading-v3",
  "mappingVersion": "questdb-sensor-v2",
  "eventTime": "2026-06-21T12:00:00Z",
  "deviceId": "press-44",
  "metric": "temperature",
  "unit": "celsius",
  "value": 71.2
}
```

Replay must choose:

```text
Use historical mapping for historical truth?
Use latest mapping for normalized current truth?
```

Both are valid, but must be explicit.

---

## 23. Security Boundary

Broker-to-QuestDB pipeline creates several trust boundaries:

```text
producer -> broker
broker -> consumer
consumer -> QuestDB
consumer -> DLQ
consumer -> metrics/logs
```

Security rules:

- producer should not write arbitrary QuestDB table names,
- table routing should be allow-listed,
- tenant ID should be verified, not trusted blindly,
- symbols should be normalized,
- DLQ should protect sensitive payloads,
- ingestion service credential should have only necessary QuestDB permissions where available,
- connector credentials must be rotated and scoped.

For Open Source deployments without fine-grained RBAC, network and service boundary become even more important.

---

## 24. Operational Dashboards

A good pipeline dashboard has four lanes:

### 24.1 Broker Lane

```text
records in/sec
bytes in/sec
consumer lag
oldest message age
rebalance count
DLQ count
```

### 24.2 Ingestion Service Lane

```text
records consumed/sec
records written/sec
validation failure/sec
batch size
flush latency p95/p99
retry count
bounded queue utilization
```

### 24.3 QuestDB Lane

```text
WAL pending rows
WAL lag
suspended table count
disk usage
disk time-to-full
query freshness
O3 indicators
```

### 24.4 Product/Data Lane

```text
latest event time by tenant/device/symbol
dashboard freshness
alert freshness
expected vs actual series count
row count by table/partition
```

The fourth lane is often missing, and it is the one users care about.

---

## 25. Incident Playbooks

### 25.1 Kafka Lag Increasing

```text
1. Check QuestDB flush latency.
2. Check WAL pending rows.
3. Check consumer CPU/memory.
4. Check validation/DLQ rate.
5. Check broker partition skew.
6. Scale consumers only if QuestDB is not bottlenecked.
7. If QuestDB is bottlenecked, reduce ingestion concurrency or throttle replay.
```

### 25.2 DLQ Spike

```text
1. Classify error type.
2. Identify producer/schema version.
3. Stop bad producer if necessary.
4. Confirm no table pollution occurred.
5. Patch producer or mapper.
6. Replay DLQ after validation.
```

### 25.3 QuestDB WAL Lag Increasing

```text
1. Pause replay/backfill consumers first.
2. Reduce live consumer concurrency if needed.
3. Check disk and CPU.
4. Check O3/late data rate.
5. Check materialized view refresh pressure.
6. Avoid scaling consumers blindly.
```

### 25.4 Duplicate Explosion

```text
1. Identify source topic/partition/offset range.
2. Check retry timeout window.
3. Verify dedup key.
4. Verify table DEDUP setting.
5. Stop consumer if duplicates still accumulating.
6. Decide cleanup vs rebuild table from replay.
```

---

## 26. Anti-Patterns

### Anti-Pattern 1: Kafka as Excuse for No Backpressure

```text
Kafka can buffer it.
```

Yes, until backlog becomes unrecoverable within freshness SLO.

### Anti-Pattern 2: Connector as Architecture

```text
We installed a connector, therefore the pipeline is designed.
```

No. Connector is implementation. Architecture is ownership of semantics and failure modes.

### Anti-Pattern 3: Offset as Dedup Key

Kafka offset is not portable business identity.

### Anti-Pattern 4: Replaying Everything at Full Speed

Historical replay can destroy live freshness.

### Anti-Pattern 5: Direct Producer Table Control

Letting producers choose QuestDB table/column names dynamically is schema pollution waiting to happen.

### Anti-Pattern 6: Scaling Consumers on Every Lag Alert

Consumer lag can be caused by QuestDB bottleneck. More consumers may worsen it.

### Anti-Pattern 7: Treating DLQ as Permanent Storage

DLQ needs owner, retention, replay process, and privacy controls.

---

## 27. Production Checklist

### 27.1 Design Checklist

```text
[ ] Is broker needed, or direct ILP is enough?
[ ] Is Kafka/RabbitMQ selected for the right reason?
[ ] Is source topic domain-oriented or table-oriented by design?
[ ] Is partition/routing key aligned with series identity?
[ ] Is target QuestDB table mapping explicit?
[ ] Is designated timestamp clearly defined?
[ ] Is dedup identity stable across replay?
[ ] Is correction semantics explicit?
[ ] Is schema version tracked?
[ ] Is unit/version normalization defined?
```

### 27.2 Consumer Checklist

```text
[ ] Manual offset/ack policy is explicit.
[ ] Offset/ack occurs only after durable outcome.
[ ] Retry is bounded.
[ ] Ambiguous write outcome is safe.
[ ] DLQ exists for invalid/non-retryable messages.
[ ] Batch flush policy is defined.
[ ] Rebalance/shutdown flush is handled.
[ ] Consumer scaling respects QuestDB headroom.
```

### 27.3 QuestDB Checklist

```text
[ ] Target tables are pre-created for production.
[ ] Auto schema creation policy is controlled.
[ ] Partitioning matches workload.
[ ] Dedup is configured if retry/replay can duplicate.
[ ] WAL health is monitored.
[ ] Disk time-to-full is monitored.
[ ] Materialized view freshness is monitored.
[ ] Query freshness is monitored.
```

### 27.4 Replay Checklist

```text
[ ] Replay lane is separate from live lane.
[ ] Replay is throttled.
[ ] Replay respects timestamp/partition locality where possible.
[ ] Duplicate/correction behavior is safe.
[ ] Disk/WAL headroom is enough.
[ ] Rollups/materialized views impact is understood.
[ ] Replay success can be reconciled.
```

---

## 28. Final Mental Model

A mature QuestDB pipeline is not:

```text
broker -> database
```

It is:

```text
source of events
-> durable transport / routing / replay boundary
-> semantic ingestion boundary
-> time-series storage boundary
-> serving/query boundary
-> operational feedback loop
```

The important question is not:

```text
Can Kafka/RabbitMQ send data to QuestDB?
```

It can.

The important questions are:

```text
Can the pipeline replay safely?
Can it retry safely?
Can it reject bad data safely?
Can it preserve timestamp semantics?
Can it maintain freshness under burst?
Can it protect QuestDB from producer mistakes?
Can operators know where delay is accumulating?
Can the architecture explain which layer owns truth?
```

If the answer is yes, broker + QuestDB becomes a powerful architecture:

```text
Kafka/RabbitMQ = resilience and decoupling
Java ingestion service = correctness and control
QuestDB = queryable time-series truth
```

---

## 29. What Comes Next

Part berikutnya akan membahas:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-028.md
Backfill, Replay, and Historical Data Loading
```

Di part itu kita akan masuk lebih dalam ke operasi historis:

- bulk loading,
- replay strategy,
- sorted vs unsorted load,
- temporary tables,
- validation/reconciliation,
- dedup during backfill,
- O3 risk,
- migration dari TSDB lama,
- dan cutover produksi.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-026.md">⬅️ Part 026 — Java Application Integration Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-028.md">Part 028 — Backfill, Replay, and Historical Data Loading ➡️</a>
</div>
