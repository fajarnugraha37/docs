# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-011.md

# Part 011 — Ingestion Architecture II: Streaming, CDC, Object Storage, and Batch Loads

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **011 / 034**  
> Tema: **mendesain pipeline ingestion ke ClickHouse yang scalable, recoverable, dan benar secara analitik**

---

## 0. Posisi Part Ini dalam Seri

Di Part 010 kita membahas ingestion dari sisi aplikasi/backend:

- insert path,
- batching,
- async insert,
- retry,
- idempotency,
- backpressure,
- small insert problem,
- dan pola Java ingestion component.

Part ini naik satu level ke **arsitektur pipeline data**.

Kita tidak lagi hanya bertanya:

> “Bagaimana service Java melakukan insert ke ClickHouse?”

Tetapi:

> “Bagaimana data dari banyak sistem — event stream, OLTP database, object storage, batch export, CDC, dan historical backfill — masuk ke ClickHouse dengan latency, correctness, dan operability yang jelas?”

Ini penting karena banyak sistem ClickHouse gagal bukan karena query engine lambat, tetapi karena ingestion architecture tidak punya model yang jelas untuk:

- duplicate events,
- retry ambiguity,
- late arriving data,
- schema evolution,
- replay,
- backfill,
- poison messages,
- source ordering,
- partial failure,
- dan data reconciliation.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Membedakan ingestion pattern utama ke ClickHouse:
   - direct application insert,
   - streaming ingestion,
   - CDC ingestion,
   - object storage ingestion,
   - batch load,
   - replay/backfill.

2. Mendesain pipeline yang sadar terhadap:
   - latency,
   - throughput,
   - freshness,
   - correctness,
   - replayability,
   - operability,
   - dan cost.

3. Memahami posisi ClickHouse dalam arsitektur data:
   - bukan message broker,
   - bukan OLTP source of truth,
   - bukan universal transformation engine,
   - tetapi analytical serving/storage engine.

4. Memilih ingestion mechanism berdasarkan kebutuhan:
   - Java batch writer,
   - Kafka table engine,
   - ClickPipes,
   - object storage table function,
   - external ETL/ELT tool,
   - custom ingestion service.

5. Mendesain correctness model untuk:
   - append-only event analytics,
   - mutable state analytics,
   - CDC-based analytics,
   - regulatory audit trails,
   - dan materialized aggregate pipelines.

6. Menghindari anti-pattern ingestion seperti:
   - streaming row-by-row directly to ClickHouse,
   - relying on exactly-once marketing slogans,
   - no replay path,
   - no dead-letter strategy,
   - no ingestion observability,
   - no source offset tracking,
   - no schema compatibility policy.

---

## 2. Mental Model Utama

### 2.1 ClickHouse is an analytical sink, not the pipeline itself

ClickHouse sangat kuat untuk:

- ingest batch besar,
- scan data columnar,
- aggregate cepat,
- query real-time analytics,
- menyimpan event/fact tables,
- menyajikan dashboard/reporting/API analytics.

Tetapi ClickHouse bukan pengganti penuh untuk:

- durable event log,
- workflow orchestrator,
- schema registry,
- CDC coordinator,
- data quality platform,
- distributed transaction manager,
- atau retry scheduler.

Dalam arsitektur yang matang, ClickHouse biasanya berada di ujung pipeline sebagai:

```text
source systems → ingestion pipeline → ClickHouse raw/refined/aggregate tables → analytics APIs/dashboards/reports
```

### 2.2 Ingestion is not only movement; it is semantic translation

Memindahkan data dari A ke B adalah bagian kecil.

Ingestion ke OLAP selalu mencakup keputusan semantik:

- Apa grain row target?
- Apakah data append-only atau mutable?
- Apa event time yang benar?
- Bagaimana duplicate dikenali?
- Bagaimana update/delete dari source direpresentasikan?
- Apakah late event boleh mengubah aggregate lama?
- Apakah pipeline bisa replay tanpa merusak hasil?
- Bagaimana schema lama dan baru hidup bersamaan?
- Bagaimana audit dan reconciliation dilakukan?

Jadi ingestion bukan hanya:

```text
consume → parse → insert
```

Tetapi:

```text
capture → validate → normalize → enrich → route → batch → insert → verify → repair/replay
```

### 2.3 Fast ingestion without replay is fragile

Pipeline yang cepat tetapi tidak bisa replay adalah hutang produksi.

Untuk analytics, kamu hampir pasti akan menghadapi:

- bug transformation,
- schema salah,
- duplicate messages,
- missing events,
- late events,
- corrupted batch,
- bad dimension mapping,
- timezone error,
- materialized view salah,
- requirement metric berubah,
- historical backfill.

Maka ingestion architecture harus punya **replay path** dari awal.

### 2.4 Exactly-once is less useful than deterministic repair

Banyak engineer terjebak mencari “exactly once”.

Dalam sistem nyata, yang lebih penting adalah:

- event memiliki stable identity,
- pipeline idempotent,
- retry aman,
- duplicate bisa diserap atau dikoreksi,
- data bisa direkonsiliasi,
- backfill bisa dijalankan ulang,
- aggregate bisa direbuild,
- dan hasil akhir bisa diverifikasi.

Dalam ClickHouse, sering kali model yang lebih kuat adalah:

```text
at-least-once ingestion + deterministic dedup/merge/rebuild strategy
```

daripada bergantung pada klaim exactly-once end-to-end yang sulit dibuktikan.

---

## 3. Source Data Patterns

Sebelum memilih ingestion mechanism, pahami jenis source.

### 3.1 Application events

Contoh:

- user clicked button,
- case status changed,
- API request completed,
- enforcement decision created,
- payment captured,
- workflow escalated.

Karakteristik:

- append-only,
- high volume,
- naturally time-based,
- sering cocok untuk ClickHouse,
- perlu event_id,
- perlu event_time dan ingestion_time,
- sering masuk via streaming atau batch writer.

Target table biasanya:

```sql
CREATE TABLE case_events
(
    event_id UUID,
    tenant_id UInt64,
    case_id UUID,
    event_time DateTime64(3),
    ingestion_time DateTime64(3),
    event_type LowCardinality(String),
    actor_type LowCardinality(String),
    actor_id UUID,
    from_state LowCardinality(String),
    to_state LowCardinality(String),
    payload_json String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_type, event_time, case_id);
```

### 3.2 Transactional snapshots

Contoh:

- current case state,
- current account balance,
- current user subscription,
- current investigation owner,
- current SLA status.

Karakteristik:

- mutable,
- source biasanya OLTP,
- analytics ingin latest state,
- bisa di-load via CDC atau periodic snapshot,
- sering perlu `ReplacingMergeTree` atau snapshot table.

Target table bisa berupa:

```sql
CREATE TABLE case_current_snapshot
(
    tenant_id UInt64,
    case_id UUID,
    version UInt64,
    updated_at DateTime64(3),
    status LowCardinality(String),
    severity LowCardinality(String),
    assigned_team LowCardinality(String),
    risk_score Decimal(10, 4)
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(updated_at)
ORDER BY (tenant_id, case_id);
```

Namun harus diingat:

- `ReplacingMergeTree` merge bersifat asynchronous.
- Query tanpa `FINAL` bisa melihat versi lama dan baru.
- `FINAL` mahal pada data besar.
- Untuk serving API yang sangat strict, perlu desain tambahan.

### 3.3 Change Data Capture events

CDC menangkap perubahan dari OLTP database.

Bentuk umumnya:

```json
{
  "op": "u",
  "table": "case",
  "primary_key": "...",
  "before": { ... },
  "after": { ... },
  "source_lsn": 123456789,
  "source_ts_ms": 1710000000000
}
```

CDC dapat dipakai untuk:

- membangun latest-state table,
- membangun audit trail,
- membangun slowly changing dimension,
- mereplikasi subset data ke ClickHouse,
- enrichment dimension lookup.

Tetapi CDC punya tantangan:

- ordering per key,
- schema evolution,
- deletes,
- transaction boundaries,
- snapshot + streaming handoff,
- duplicate delivery,
- source lag,
- partial table capture,
- semantic mismatch antara OLTP row dan OLAP fact.

### 3.4 Batch exports

Contoh:

- daily CSV export,
- hourly Parquet dump,
- historical archive,
- object storage files,
- vendor data drop,
- regulatory dataset.

Karakteristik:

- besar,
- lebih murah secara throughput,
- freshness rendah/sedang,
- cocok untuk backfill,
- mudah diverifikasi per file/batch,
- perlu manifest dan checkpoint.

### 3.5 Object storage lake data

Object storage seperti S3/GCS/Azure Blob sering menjadi staging layer.

Pola umum:

```text
source → object storage raw files → ClickHouse load/query → refined ClickHouse tables
```

Kelebihan:

- durable,
- replayable,
- murah,
- bisa dipakai untuk historical archive,
- batch-friendly,
- cocok untuk Parquet/Avro/CSV/JSONEachRow.

Kekurangan:

- latency biasanya lebih tinggi dari direct streaming,
- perlu manifest/checkpoint,
- small files bisa menjadi problem,
- schema drift perlu dikontrol,
- object listing bisa mahal/lambat bila tidak dirancang.

---

## 4. Ingestion Pattern Taxonomy

### 4.1 Pattern A — Direct application insert

```text
Java service → ClickHouse
```

Cocok jika:

- volume sedang,
- pipeline sederhana,
- event berasal langsung dari service,
- latency ingin rendah,
- service bisa melakukan batching,
- kehilangan data bisa dicegah dengan durable local/outbox mechanism.

Tidak cocok jika:

- banyak producer,
- butuh replay global,
- spike tinggi,
- network unreliable,
- event critical untuk audit,
- ingestion tidak boleh ikut lifecycle request path.

Risiko:

- coupling aplikasi ke ClickHouse,
- retry ambiguity,
- request latency terganggu,
- event hilang bila process crash sebelum flush,
- no central schema/version governance.

Mitigasi:

- transactional outbox,
- async ingestion worker,
- durable queue,
- stable event_id,
- batch flush,
- retry with dedup strategy,
- dead-letter table.

### 4.2 Pattern B — Streaming ingestion

```text
services → durable stream → ingestion consumer → ClickHouse
```

Cocok jika:

- banyak producer,
- volume tinggi,
- perlu decoupling,
- perlu replay,
- perlu backpressure,
- perlu consumer scaling,
- analytics freshness rendah-latency.

Bentuk:

```text
Java services
  → Kafka / Redpanda / Kinesis / Pulsar
  → ClickHouse Kafka engine / ClickPipes / custom consumer
  → raw table
  → materialized views / refined tables
```

Kelebihan:

- durable log,
- replayable,
- decoupled producers,
- offset/checkpoint,
- independent scaling,
- supports multiple consumers.

Tantangan:

- duplicate delivery,
- poison messages,
- schema registry,
- consumer lag,
- partition ordering,
- burst management,
- exactly-once assumptions,
- operational complexity.

### 4.3 Pattern C — CDC ingestion

```text
OLTP database → CDC connector → stream/object storage → ClickHouse
```

Cocok jika:

- analytics perlu data dari transactional DB,
- tidak ingin aplikasi menulis event manual,
- perlu latest-state replica,
- perlu audit row changes,
- ingin near-real-time reporting dari OLTP.

Tantangan besar:

- OLTP row bukan selalu OLAP fact,
- update/delete harus diterjemahkan,
- initial snapshot harus konsisten,
- out-of-order events harus ditangani,
- schema migration OLTP bisa merusak pipeline,
- PII bisa bocor ke analytical store.

### 4.4 Pattern D — Object storage batch load

```text
source → S3/GCS files → ClickHouse INSERT SELECT / table function
```

Cocok jika:

- historical backfill,
- periodic import,
- data lake integration,
- vendor files,
- large bulk loading,
- disaster recovery/rebuild.

Kelebihan:

- durable raw copy,
- easy replay,
- easy audit per file,
- cost efficient,
- natural batch boundary.

Tantangan:

- file manifest,
- partial load,
- schema drift,
- duplicate file processing,
- small files,
- partition alignment,
- validation before load.

### 4.5 Pattern E — Hybrid streaming + object storage

```text
stream → realtime ClickHouse
      → object storage archive
object storage → backfill/rebuild ClickHouse
```

Ini pola yang sering paling matang.

Real-time path memberi freshness.
Object storage memberi replay dan archive.

```text
                 ┌──────────────┐
                 │ Object Store  │ ← raw immutable archive
                 └──────┬───────┘
                        │
services → stream → ingestion → ClickHouse raw → refined/aggregate tables
                        │
                        └── checkpoints / DLQ / metrics
```

Dengan pola ini:

- dashboard mendapat data near-real-time,
- backfill bisa dilakukan dari raw files,
- bug transform bisa diperbaiki dengan replay,
- ClickHouse table bisa direbuild,
- audit lebih kuat.

---

## 5. ClickHouse Ingestion Mechanisms

### 5.1 HTTP / Native / JDBC client insert

Ini mekanisme yang cocok untuk custom ingestion service.

Contoh:

```text
Kafka consumer Java app → batch rows → ClickHouse HTTP insert
```

Kelebihan:

- kontrol penuh terhadap batching,
- kontrol retry/backpressure,
- mudah validasi sebelum insert,
- bisa enrich/route/custom transform,
- portable untuk self-managed atau cloud.

Kekurangan:

- kamu harus membangun offset management,
- DLQ,
- schema compatibility,
- monitoring,
- deployment scaling,
- consumer rebalance handling.

Cocok untuk engineering team yang ingin kontrol penuh.

### 5.2 Kafka table engine

ClickHouse menyediakan Kafka table engine untuk membaca dari Kafka sebagai table engine integrasi.

Pattern umumnya:

```sql
CREATE TABLE kafka_raw_events
(
    event_id UUID,
    tenant_id UInt64,
    event_time DateTime64(3),
    event_type String,
    payload String
)
ENGINE = Kafka
SETTINGS
    kafka_broker_list = 'broker1:9092,broker2:9092',
    kafka_topic_list = 'events',
    kafka_group_name = 'clickhouse-events-consumer',
    kafka_format = 'JSONEachRow';
```

Kemudian materialized view memindahkan data ke MergeTree table:

```sql
CREATE TABLE raw_events
(
    event_id UUID,
    tenant_id UInt64,
    event_time DateTime64(3),
    ingestion_time DateTime64(3) DEFAULT now64(3),
    event_type LowCardinality(String),
    payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_type, event_time, event_id);

CREATE MATERIALIZED VIEW mv_kafka_to_raw_events
TO raw_events
AS
SELECT
    event_id,
    tenant_id,
    event_time,
    now64(3) AS ingestion_time,
    event_type,
    payload
FROM kafka_raw_events;
```

Mental model:

```text
Kafka topic → Kafka engine virtual table → materialized view → MergeTree table
```

Kelebihan:

- simple path,
- fewer moving parts,
- native to ClickHouse,
- useful for straightforward streaming ingestion.

Tantangan:

- ingestion resource berjalan di ClickHouse server,
- transform logic berada di database,
- poison message handling perlu hati-hati,
- offset behavior harus dipahami,
- scaling ingestion mengikuti ClickHouse topology,
- operational ownership bercampur antara DB dan pipeline.

Gunakan jika:

- pipeline relatif sederhana,
- format stabil,
- team nyaman mengoperasikan ingestion di ClickHouse,
- workload query dan ingestion tidak saling mengganggu berlebihan.

Hindari jika:

- transform berat,
- enrichment kompleks,
- multi-stage validation,
- strict DLQ workflow,
- tenant-specific routing kompleks,
- ingestion harus isolated dari query cluster.

### 5.3 ClickPipes

ClickPipes adalah ingestion service terkelola di ClickHouse Cloud untuk ingest dari sumber seperti Kafka, object storage, Kinesis, Postgres CDC, dan sumber lain yang didukung.

Mental model:

```text
source connector → managed ingestion pipeline → ClickHouse Cloud table
```

Kelebihan:

- managed connector,
- mengurangi operational burden,
- cocok untuk cloud-native teams,
- source integration lebih mudah,
- lebih sedikit custom code.

Tantangan:

- fitur tergantung platform/cloud,
- kontrol detail lebih terbatas daripada custom pipeline,
- perlu memahami semantics masing-masing connector,
- vendor/platform coupling.

Cocok jika:

- memakai ClickHouse Cloud,
- ingin ingestion cepat tanpa membangun consumer sendiri,
- source termasuk connector yang didukung,
- tim ingin fokus ke modeling/querying.

### 5.4 S3 / object storage table functions

ClickHouse dapat membaca file dari object storage menggunakan table function seperti `s3`.

Contoh konsep:

```sql
INSERT INTO raw_events
SELECT
    event_id,
    tenant_id,
    parseDateTime64BestEffort(event_time, 3) AS event_time,
    now64(3) AS ingestion_time,
    event_type,
    payload
FROM s3(
    'https://bucket.s3.amazonaws.com/events/2026/06/*.jsonl',
    'JSONEachRow'
);
```

Atau untuk Parquet:

```sql
INSERT INTO raw_events
SELECT
    event_id,
    tenant_id,
    event_time,
    now64(3) AS ingestion_time,
    event_type,
    payload
FROM s3(
    'https://bucket.s3.amazonaws.com/events/date=2026-06-21/*.parquet',
    'Parquet'
);
```

Kelebihan:

- powerful untuk batch load,
- natural untuk backfill,
- bisa membaca format columnar seperti Parquet,
- cocok untuk data lake integration,
- mudah dibuat idempotent dengan manifest.

Tantangan:

- perlu kontrol file discovery,
- perlu load manifest,
- partial failure handling,
- duplicate file load risk,
- object listing cost,
- credentials/security,
- schema evolution per file.

### 5.5 File engine / local file import

Bisa digunakan untuk:

- development,
- small administrative loads,
- one-off import,
- testing schema.

Tidak ideal sebagai ingestion production utama kecuali kamu punya orchestration kuat.

### 5.6 External ETL/ELT tools

Contoh kategori:

- Airbyte/Fivetran-style connectors,
- Spark/Flink jobs,
- dbt-style transformations,
- Airflow/Dagster orchestration,
- custom batch jobs.

Cocok jika:

- transform kompleks,
- banyak source,
- workflow terjadwal,
- data quality checks,
- lineage,
- governance,
- cross-system joins sebelum load.

Risiko:

- latency lebih tinggi,
- operational complexity,
- tool-specific semantics,
- cost.

---

## 6. Streaming Ingestion Design

### 6.1 Basic streaming architecture

```text
Producer services
  → durable stream topic
  → ingestion consumer group
  → ClickHouse raw table
  → materialized views / aggregate tables
  → dashboards / APIs
```

Untuk ClickHouse, streaming ingestion hampir selalu harus tetap **batched**.

Buruk:

```text
1 Kafka message → 1 ClickHouse insert
```

Baik:

```text
many Kafka messages → batch by size/time/partition → 1 ClickHouse insert
```

### 6.2 Topic design for ClickHouse ingestion

Pertanyaan penting:

1. Apakah topic dipartition berdasarkan tenant?
2. Apakah ordering per entity penting?
3. Apakah event type dicampur dalam satu topic?
4. Apakah schema kompatibel antar event type?
5. Apakah payload raw disimpan juga?
6. Apakah topic retention cukup untuk replay?
7. Apakah compacted topic atau append-only topic?
8. Apakah ada dead-letter topic?

Untuk event analytics, pola umum:

```text
case.lifecycle.events.v1
case.assignment.events.v1
api.request.events.v1
billing.transaction.events.v1
```

Bukan:

```text
everything-events
```

Kecuali kamu punya envelope schema yang kuat dan routing layer matang.

### 6.3 Message envelope

Gunakan envelope standar.

Contoh:

```json
{
  "event_id": "018fb1f1-5d58-7d92-97ae-2c0f0fb5f20d",
  "event_type": "case.status_changed",
  "event_version": 3,
  "tenant_id": 42,
  "entity_type": "case",
  "entity_id": "6b07d94d-6e7e-45f7-9243-7e0f58a4e9d0",
  "event_time": "2026-06-21T10:15:30.123Z",
  "producer": "case-service",
  "producer_version": "2026.06.21-1",
  "trace_id": "...",
  "payload": {
    "from_state": "UNDER_REVIEW",
    "to_state": "ESCALATED",
    "reason_code": "RISK_THRESHOLD_EXCEEDED"
  }
}
```

Minimum fields untuk analytics-grade events:

| Field | Kenapa penting |
|---|---|
| `event_id` | deduplication dan audit |
| `event_type` | routing dan query filtering |
| `event_version` | schema evolution |
| `tenant_id` | multi-tenancy dan access path |
| `entity_id` | lifecycle reconstruction |
| `event_time` | analytical time |
| `producer` | lineage |
| `trace_id` | debugging end-to-end |
| `payload` | domain data |

Tambahkan di ingestion:

| Field | Kenapa penting |
|---|---|
| `ingestion_time` | freshness/lag analysis |
| `source_topic` | lineage |
| `source_partition` | replay/debug |
| `source_offset` | checkpoint/reconciliation |
| `raw_payload` | repair/backfill/debug |
| `ingestion_batch_id` | audit per batch |

### 6.4 Raw table design for streaming

Raw table harus menjaga fakta minimum dan lineage.

```sql
CREATE TABLE raw_stream_events
(
    event_id UUID,
    tenant_id UInt64,
    event_type LowCardinality(String),
    event_version UInt16,
    entity_type LowCardinality(String),
    entity_id UUID,
    event_time DateTime64(3, 'UTC'),
    ingestion_time DateTime64(3, 'UTC') DEFAULT now64(3),
    producer LowCardinality(String),
    trace_id String,

    source_topic LowCardinality(String),
    source_partition UInt32,
    source_offset UInt64,
    ingestion_batch_id UUID,

    payload_json String,
    raw_payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_type, event_time, entity_id, event_id);
```

Raw table bukan harus query serving utama.

Ia berfungsi sebagai:

- immutable analytical log,
- replay target,
- debug source,
- materialized view source,
- reconciliation base,
- audit layer.

### 6.5 Refined table design

Refined table berisi field yang sudah dipromosikan dari payload.

```sql
CREATE TABLE case_status_events
(
    event_id UUID,
    tenant_id UInt64,
    case_id UUID,
    event_time DateTime64(3, 'UTC'),
    ingestion_time DateTime64(3, 'UTC'),
    from_state LowCardinality(String),
    to_state LowCardinality(String),
    reason_code LowCardinality(String),
    actor_type LowCardinality(String),
    actor_id UUID,
    source_offset UInt64
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, to_state, event_time, case_id);
```

Transform bisa dilakukan:

- sebelum insert oleh ingestion service,
- di materialized view,
- atau batch job dari raw table.

Trade-off:

| Transform location | Kelebihan | Risiko |
|---|---|---|
| Producer | domain context kuat | coupling, inconsistent producers |
| Ingestion service | centralized validation | custom service complexity |
| Materialized view | dekat ke ClickHouse, fast | harder DLQ/debug for complex transform |
| Batch job | replayable, auditable | higher latency |

---

## 7. CDC Ingestion Design

### 7.1 CDC is not event sourcing

CDC menangkap perubahan row dari database.

Event sourcing menangkap event domain yang bermakna.

Contoh domain event:

```text
case.escalated
```

Contoh CDC event:

```text
UPDATE cases SET status='ESCALATED'
```

CDC bisa berguna, tetapi tidak selalu menggantikan domain event.

CDC memberi tahu bahwa row berubah.
Domain event memberi tahu kenapa perubahan terjadi.

Untuk analytics matang, sering butuh keduanya:

```text
domain events → behavior/lifecycle analytics
CDC → current dimensions/latest state/reference data
```

### 7.2 CDC target patterns

#### Pattern 1 — Append every change

```sql
CREATE TABLE case_cdc_events
(
    tenant_id UInt64,
    case_id UUID,
    op LowCardinality(String),
    source_lsn UInt64,
    source_timestamp DateTime64(3, 'UTC'),
    ingestion_time DateTime64(3, 'UTC'),
    before_json String,
    after_json String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(source_timestamp)
ORDER BY (tenant_id, case_id, source_lsn);
```

Cocok untuk:

- audit perubahan row,
- debugging,
- reconstruct history,
- compliance.

#### Pattern 2 — Latest state with ReplacingMergeTree

```sql
CREATE TABLE case_latest_from_cdc
(
    tenant_id UInt64,
    case_id UUID,
    version UInt64,
    deleted UInt8,
    updated_at DateTime64(3, 'UTC'),
    status LowCardinality(String),
    severity LowCardinality(String),
    owner_team LowCardinality(String)
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(updated_at)
ORDER BY (tenant_id, case_id);
```

Cocok untuk:

- current state analytics,
- dimension lookup,
- latest report.

Perhatian:

- versi lama bisa tetap muncul sampai merge,
- query strict perlu `FINAL` atau alternate design,
- delete harus dimodelkan eksplisit.

#### Pattern 3 — Slowly changing dimension

```sql
CREATE TABLE dim_case_status_history
(
    tenant_id UInt64,
    case_id UUID,
    valid_from DateTime64(3, 'UTC'),
    valid_to Nullable(DateTime64(3, 'UTC')),
    status LowCardinality(String),
    severity LowCardinality(String),
    version UInt64
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(valid_from)
ORDER BY (tenant_id, case_id, valid_from);
```

Cocok untuk:

- “status at time T”,
- historical reporting,
- regulatory audit,
- point-in-time analysis.

### 7.3 CDC initial snapshot problem

CDC biasanya memiliki dua fase:

```text
initial snapshot → continuous change stream
```

Masalah umum:

- snapshot tidak konsisten,
- changes terjadi saat snapshot berjalan,
- duplicate antara snapshot dan stream,
- missing handoff boundary,
- source transaction order tidak terjaga.

Pipeline CDC harus punya:

- snapshot marker,
- source offset/LSN,
- primary key,
- version ordering,
- dedup policy,
- reconciliation count.

### 7.4 Deletes in CDC

Deletes dapat dimodelkan beberapa cara.

#### Soft delete flag

```sql
deleted UInt8,
deleted_at Nullable(DateTime64(3))
```

Kelebihan:

- audit friendly,
- query bisa filter,
- tidak perlu mutation mahal.

#### Tombstone event

```text
op = 'd'
```

Cocok untuk append history.

#### Physical delete / mutation

Biasanya tidak ideal untuk high-volume CDC.

Gunakan hanya jika:

- compliance membutuhkan hard delete,
- volume kecil,
- retention-specific,
- dilakukan batch/terkontrol.

---

## 8. Object Storage and Batch Load Architecture

### 8.1 Why object storage matters

Object storage memberi pipeline kemampuan yang sulit didapat jika semua hanya streaming:

- immutable raw archive,
- replay dari file,
- historical backfill,
- batch validation,
- cost-effective retention,
- decoupling producer dan ClickHouse,
- disaster recovery.

### 8.2 Recommended file organization

Buruk:

```text
s3://analytics-bucket/events/random-file-1.json
s3://analytics-bucket/events/random-file-2.json
```

Baik:

```text
s3://analytics-bucket/raw/case_events/event_date=2026-06-21/hour=10/part-00001.parquet
s3://analytics-bucket/raw/case_events/event_date=2026-06-21/hour=10/part-00002.parquet
s3://analytics-bucket/raw/case_events/event_date=2026-06-21/hour=11/part-00001.parquet
```

Atau jika partition by ingestion time:

```text
s3://analytics-bucket/raw/case_events/ingest_date=2026-06-21/hour=10/part-00001.parquet
```

Pertanyaan penting:

- Apakah path berdasarkan event_time atau ingestion_time?
- Apakah late events akan masuk ke folder lama?
- Apakah downstream loader melakukan discovery by manifest atau listing?
- Apakah file format mendukung schema evolution?
- Apakah file size cukup besar?

### 8.3 File format choice

| Format | Kelebihan | Kekurangan | Use case |
|---|---|---|---|
| JSONEachRow | simple, human-readable | besar, parsing mahal | dev, low volume, flexible payload |
| CSV/TSV | simple, compact-ish | schema fragile | vendor export sederhana |
| Parquet | columnar, compressed, schema | lebih kompleks | batch/load/lakehouse |
| Avro | schema evolution, streaming-friendly | less query-efficient than Parquet | CDC/event interchange |
| Native ClickHouse format | cepat untuk CH | ecosystem terbatas | CH-to-CH transfer |

Untuk high-volume object storage batch, Parquet sering menjadi pilihan kuat.

### 8.4 Manifest-driven loading

Jangan hanya bergantung pada listing path.

Gunakan manifest:

```json
{
  "batch_id": "2026-06-21T10-case-events-0001",
  "dataset": "case_events",
  "schema_version": 3,
  "created_at": "2026-06-21T10:05:00Z",
  "event_date": "2026-06-21",
  "files": [
    {
      "uri": "s3://analytics-bucket/raw/case_events/event_date=2026-06-21/hour=10/part-00001.parquet",
      "row_count": 500000,
      "content_md5": "..."
    },
    {
      "uri": "s3://analytics-bucket/raw/case_events/event_date=2026-06-21/hour=10/part-00002.parquet",
      "row_count": 500000,
      "content_md5": "..."
    }
  ]
}
```

Manifest membantu:

- idempotency,
- audit,
- completeness check,
- retry,
- load checkpoint,
- reconciliation.

### 8.5 Load control table

Di ClickHouse atau operational DB, simpan status load.

```sql
CREATE TABLE ingestion_batches
(
    batch_id String,
    dataset LowCardinality(String),
    schema_version UInt16,
    source_uri String,
    expected_rows UInt64,
    loaded_rows UInt64,
    status LowCardinality(String),
    started_at DateTime64(3, 'UTC'),
    completed_at Nullable(DateTime64(3, 'UTC')),
    error_message String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(started_at)
ORDER BY (dataset, started_at, batch_id);
```

Status:

```text
DISCOVERED → VALIDATING → LOADING → LOADED → VERIFIED
                         ↘ FAILED → RETRYING
```

### 8.6 Idempotent batch load

Gunakan salah satu strategi:

#### Strategy A — load into staging then swap/insert

```text
file batch → staging table → validation → insert into final → mark loaded
```

#### Strategy B — include batch_id in final table

```sql
ingestion_batch_id String
```

Lalu duplicate bisa dideteksi.

#### Strategy C — partition replacement

Untuk batch yang mewakili full partition:

```text
load new partition → validate → replace/drop old partition
```

Harus sangat hati-hati agar tidak menghapus late data.

#### Strategy D — ReplacingMergeTree with deterministic key/version

Cocok bila duplicates per event_id bisa muncul.

---

## 9. Backfill and Replay

### 9.1 Backfill is a first-class operation

Backfill bukan emergency hack.

Backfill akan terjadi karena:

- table baru dibuat,
- materialized view baru dibuat,
- transform bug diperbaiki,
- metric definition berubah,
- historical data perlu dimuat,
- partition rusak,
- cluster migration,
- compliance request,
- data quality repair.

### 9.2 Backfill source hierarchy

Urutan sumber replay yang ideal:

1. Immutable raw object storage archive.
2. Durable stream with sufficient retention.
3. Raw ClickHouse table.
4. OLTP source snapshot.
5. Application logs.
6. Manual reconstruction.

Semakin ke bawah, semakin mahal dan semakin rawan salah.

### 9.3 Backfill design principles

1. Backfill harus bisa dibatasi per time range/partition.
2. Backfill harus punya batch_id.
3. Backfill harus tidak mengganggu ingestion real-time.
4. Backfill harus throttled.
5. Backfill harus observable.
6. Backfill harus idempotent.
7. Backfill harus bisa dihentikan dan dilanjutkan.
8. Backfill harus punya verification query.

### 9.4 Backfill table strategy

#### Strategy 1 — insert directly into final table

Sederhana, tetapi riskan.

Cocok jika:

- data kecil,
- no duplicate risk,
- target table append-only,
- validation sudah dilakukan.

#### Strategy 2 — staging table

Lebih aman.

```sql
CREATE TABLE staging_case_events AS case_events
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_type, event_time, case_id);
```

Flow:

```text
load staging → validate → insert final → verify → drop staging
```

#### Strategy 3 — parallel shadow table

Untuk rebuild besar:

```text
case_events_v1 → case_events_v2_shadow → validate → cutover view/API
```

Cocok untuk:

- schema redesign,
- sort key change,
- large historical rebuild,
- materialized view correction.

#### Strategy 4 — partition-level rebuild

```text
rebuild month 2026-05 → validate → replace partition
```

Cocok jika:

- data naturally partitioned by month,
- correction bounded,
- late events accounted for.

### 9.5 Backfill and materialized views

Materialized views di ClickHouse bekerja pada insert ke source table.

Jika MV baru dibuat setelah historical data sudah ada, historical data tidak otomatis diproses kecuali kamu menjalankan backfill.

Common pattern:

```text
1. Create target aggregate table.
2. Create MV for future inserts.
3. Backfill historical data manually with INSERT INTO target SELECT ... FROM source.
4. Validate counts/metrics.
```

Masalah umum:

- duplicate aggregate bila backfill dan live MV overlap,
- different transform logic antara MV dan backfill query,
- late events masuk saat backfill berjalan,
- no cutover boundary.

Gunakan boundary eksplisit:

```text
historical range: event_time < T
live MV: event_time >= T
```

Atau gunakan batch_id/rebuild strategy yang jelas.

---

## 10. Late Arriving Events

### 10.1 Late event definition

Late event adalah event yang `event_time`-nya berada di masa lalu, tetapi baru diterima sekarang.

Contoh:

```text
event_time     = 2026-06-10 10:00:00
ingestion_time = 2026-06-21 14:00:00
```

Late event muncul karena:

- mobile/offline clients,
- retry delay,
- network partition,
- CDC lag,
- batch export terlambat,
- producer outage,
- manual import,
- timezone bug.

### 10.2 Why late events are hard

Raw table append-only biasanya aman.

Masalah muncul pada:

- hourly/daily aggregates,
- materialized views,
- dashboards with closed periods,
- regulatory reports,
- SLA calculations,
- cohort/retention metrics.

Jika aggregate untuk `2026-06-10` sudah dianggap final, late event bisa mengubah hasil.

### 10.3 Strategies for late events

#### Strategy A — Always allow corrections

Aggregate lama bisa berubah.

Cocok untuk:

- operational dashboard,
- product analytics,
- observability.

Risiko:

- angka historis berubah,
- stakeholders bingung bila laporan tidak frozen.

#### Strategy B — Watermark/freeze window

Misal:

```text
Daily metric dianggap final setelah D+3.
```

Late event setelah window:

- masuk raw table,
- ditandai late,
- masuk correction table,
- tidak otomatis mengubah official report.

#### Strategy C — Correction ledger

Simpan correction terpisah.

```sql
CREATE TABLE metric_corrections
(
    correction_id UUID,
    metric_date Date,
    tenant_id UInt64,
    metric_name LowCardinality(String),
    delta_value Decimal(18, 4),
    reason String,
    created_at DateTime64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(metric_date)
ORDER BY (tenant_id, metric_name, metric_date);
```

#### Strategy D — Periodic recomputation

Untuk metric kompleks:

```text
raw events → nightly recompute last 7 days → replace aggregate partitions
```

Cocok untuk:

- late-heavy data,
- complex joins,
- mutable dimensions,
- strict reporting.

---

## 11. Duplicate Handling

### 11.1 Sources of duplicates

Duplicates bisa muncul dari:

- producer retry,
- consumer retry after timeout,
- stream redelivery,
- batch file reprocessing,
- backfill overlap,
- CDC snapshot + stream overlap,
- manual import,
- materialized view recreation.

### 11.2 Duplicate types

#### Exact duplicate

Semua field sama.

#### Semantic duplicate

event sama, payload mungkin sedikit berbeda.

#### Correction event

bukan duplicate, tetapi perubahan atas fakta sebelumnya.

#### Replay duplicate

event yang sama muncul lagi dari replay.

### 11.3 Dedup strategies

#### Strategy A — Stable `event_id`

Producer wajib membuat stable ID.

```text
event_id = deterministic UUID based on source + entity + version + event type
```

Atau generated sekali dan dipersist.

#### Strategy B — ReplacingMergeTree

```sql
ENGINE = ReplacingMergeTree(version)
ORDER BY (tenant_id, event_id)
```

Cocok jika query by event_id/dedup table, tetapi sorting by event_id bisa buruk untuk analytics jika dijadikan raw table utama.

Alternatif:

- raw append table,
- deduped serving table,
- aggregate dedup logic.

#### Strategy C — Aggregate with uniq

Untuk metric tertentu:

```sql
uniq(event_id)
```

Tetapi ini tidak menyelesaikan semua metric.

#### Strategy D — Pre-insert dedup in ingestion service

Consumer menyimpan recent event_id cache atau state store.

Risiko:

- state besar,
- TTL salah,
- tidak tahan replay jangka panjang.

#### Strategy E — Batch manifest idempotency

Untuk object storage:

```text
same batch_id cannot be loaded twice
```

### 11.4 Important design warning

Jangan memaksa satu table melayani semua tujuan:

- raw audit log,
- deduped event store,
- latest state,
- aggregate serving,
- regulatory report.

Lebih baik layering:

```text
raw append-only → refined typed → deduped/serving → aggregate/reporting
```

---

## 12. Poison Messages and Dead-Letter Strategy

### 12.1 Poison message

Poison message adalah message yang selalu gagal diproses.

Penyebab:

- invalid JSON,
- missing required field,
- unknown event_version,
- invalid enum,
- timestamp tidak bisa diparse,
- schema registry mismatch,
- payload terlalu besar,
- PII violation,
- transform bug.

### 12.2 Bad strategy

```text
consumer crashes → retries forever → lag grows → pipeline stops
```

### 12.3 Better strategy

```text
consume → validate
        → valid → batch insert
        → invalid recoverable → retry with limit
        → invalid permanent → DLQ + alert + continue
```

### 12.4 DLQ table in ClickHouse

```sql
CREATE TABLE ingestion_dead_letters
(
    dead_letter_id UUID,
    dataset LowCardinality(String),
    source_topic String,
    source_partition UInt32,
    source_offset UInt64,
    received_at DateTime64(3, 'UTC'),
    error_type LowCardinality(String),
    error_message String,
    raw_payload String,
    producer LowCardinality(String),
    event_type String,
    event_version UInt16
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(received_at)
ORDER BY (dataset, error_type, received_at);
```

DLQ harus punya:

- alerting,
- dashboard,
- owner,
- replay tool,
- retention policy,
- classification.

DLQ tanpa owner adalah tempat sampah permanen.

---

## 13. Schema Evolution

### 13.1 Schema evolution levels

Ada beberapa level schema:

1. Producer event schema.
2. Stream serialization schema.
3. Raw ClickHouse table schema.
4. Refined ClickHouse table schema.
5. Materialized view query schema.
6. Serving API response schema.
7. Dashboard/report metric schema.

Breaking change di satu layer bisa merusak pipeline.

### 13.2 Event versioning

Event harus punya:

```text
event_type
event_version
```

Contoh:

```text
case.status_changed.v1
case.status_changed.v2
```

Atau:

```json
{
  "event_type": "case.status_changed",
  "event_version": 2
}
```

### 13.3 Compatibility rules

Relatif aman:

- tambah optional field,
- tambah field dengan default,
- tambah enum value jika consumer tolerant,
- tambah payload nested field.

Berbahaya:

- rename field,
- ubah type field,
- ubah semantic field,
- hapus required field,
- ubah timezone meaning,
- ubah event_id generation,
- ubah grain event.

### 13.4 ClickHouse schema migration

Menambah kolom biasanya mudah:

```sql
ALTER TABLE raw_events
ADD COLUMN IF NOT EXISTS device_type LowCardinality(String) DEFAULT '';
```

Tetapi mengubah type besar bisa mahal/berisiko.

Best practice:

- add new column,
- dual write/dual read,
- backfill if needed,
- migrate query/API,
- deprecate old column later.

### 13.5 Raw payload retention

Menyimpan `raw_payload` atau object storage raw archive membantu saat schema berubah.

Tanpa raw payload, kamu tidak bisa memperbaiki transform lama jika field tidak pernah disimpan.

---

## 14. Freshness, Latency, and Watermarks

### 14.1 Different time concepts

| Time | Meaning |
|---|---|
| event_time | kapan kejadian domain terjadi |
| producer_time | kapan producer membuat event |
| broker_time | kapan masuk stream |
| ingestion_time | kapan ClickHouse menerima |
| processing_time | kapan transform berjalan |
| report_time | kapan metric disajikan |

Jangan campur semua sebagai `created_at`.

### 14.2 Freshness metric

```sql
SELECT
    tenant_id,
    max(event_time) AS max_event_time,
    max(ingestion_time) AS max_ingestion_time,
    now64(3) - max(ingestion_time) AS ingestion_staleness,
    max(ingestion_time) - max(event_time) AS event_to_ingest_lag
FROM raw_stream_events
GROUP BY tenant_id;
```

### 14.3 Pipeline lag dimensions

- producer lag,
- broker lag,
- consumer lag,
- insert lag,
- merge lag,
- materialized view lag,
- dashboard cache lag.

Freshness SLA harus spesifik:

Buruk:

```text
analytics must be real-time
```

Baik:

```text
P95 of accepted events visible in operational dashboard within 30 seconds.
Daily regulatory reports finalize at D+2 02:00 UTC.
```

### 14.4 Watermark

Watermark adalah estimasi bahwa semua event sebelum waktu tertentu sudah diterima.

Contoh:

```text
watermark = now() - 10 minutes
```

Untuk reporting:

```text
Only compute official aggregate for event_time < watermark.
```

Watermark membantu menangani late events tanpa pretending bahwa stream selalu ordered.

---

## 15. Transformation Architecture

### 15.1 Raw → refined → serving

Pola paling aman:

```text
raw table
  → refined typed table
  → aggregate / serving table
```

#### Raw table

- minimal loss,
- lineage fields,
- raw payload,
- append-only,
- debugging/replay.

#### Refined table

- typed columns,
- promoted hot fields,
- queryable,
- fewer raw inconsistencies.

#### Serving/aggregate table

- optimized for dashboard/API,
- pre-aggregated,
- often purpose-specific.

### 15.2 Where to enrich?

Enrichment contoh:

- tenant metadata,
- user role,
- case category,
- region,
- product plan,
- risk tier.

Pilihan:

1. Enrich at producer.
2. Enrich at ingestion service.
3. Enrich via ClickHouse dictionary.
4. Enrich in materialized view.
5. Enrich in batch job.
6. Enrich at query time.

Trade-off:

| Location | Freshness | Replayability | Complexity | Query speed |
|---|---:|---:|---:|---:|
| Producer | high | low/medium | distributed | high |
| Ingestion service | high | medium | centralized | high |
| Dictionary | medium/high | medium | DB config | high |
| MV | high | medium | SQL logic | high |
| Batch job | low/medium | high | orchestration | high |
| Query time | high | high | query cost | lower |

### 15.3 Avoid irreversible transform too early

Jika ingestion membuang raw data, kamu kehilangan kemampuan repair.

Bad:

```text
consume → transform → insert only transformed fields
```

Better:

```text
consume → validate → store raw + transformed fields
```

Atau:

```text
consume → object storage raw → ClickHouse refined
```

---

## 16. Ingestion Correctness Models

### 16.1 At-most-once

```text
message may be lost, never duplicated
```

Biasanya tidak cocok untuk audit/analytics penting.

Cocok hanya untuk:

- non-critical telemetry,
- approximate monitoring,
- temporary dev metrics.

### 16.2 At-least-once

```text
message will be delivered, may duplicate
```

Ini paling umum.

Butuh:

- event_id,
- dedup strategy,
- replay-safe aggregate,
- idempotent batch load.

### 16.3 Effectively-once

Praktisnya:

```text
at-least-once delivery + deterministic idempotent processing + verification
```

Ini target realistis.

### 16.4 Exactly-once end-to-end

Sulit karena melibatkan:

- producer,
- broker,
- consumer,
- network,
- ClickHouse insert,
- materialized view,
- merge behavior,
- query semantics,
- batch replay.

Jangan jadikan klaim exactly-once sebagai pengganti desain idempotency.

---

## 17. Regulatory / Case Management Example

Kita gunakan contoh domain yang dekat dengan lifecycle enforcement/case management.

### 17.1 Requirements

Sistem perlu menjawab:

1. Berapa case yang masuk per hari per tenant?
2. Berapa yang dieskalasi?
3. Median waktu dari `OPENED` ke `UNDER_REVIEW`?
4. P95 waktu dari `UNDER_REVIEW` ke `DECIDED`?
5. Berapa case yang melewati SLA?
6. Siapa actor/team yang paling sering melakukan reassignment?
7. Apa state case pada tanggal tertentu?
8. Apakah ada event yang hilang dari pipeline?
9. Apakah laporan bulanan bisa difinalisasi dan diaudit?

### 17.2 Source streams

```text
case.lifecycle.events.v1
case.assignment.events.v1
case.decision.events.v1
case.sla.events.v1
```

### 17.3 Raw ClickHouse table

```sql
CREATE TABLE raw_case_events
(
    event_id UUID,
    tenant_id UInt64,
    case_id UUID,
    event_type LowCardinality(String),
    event_version UInt16,
    event_time DateTime64(3, 'UTC'),
    ingestion_time DateTime64(3, 'UTC') DEFAULT now64(3),
    actor_id UUID,
    actor_type LowCardinality(String),
    source_topic LowCardinality(String),
    source_partition UInt32,
    source_offset UInt64,
    trace_id String,
    payload_json String,
    raw_payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_type, event_time, case_id, event_id);
```

### 17.4 Refined lifecycle table

```sql
CREATE TABLE case_lifecycle_transitions
(
    event_id UUID,
    tenant_id UInt64,
    case_id UUID,
    event_time DateTime64(3, 'UTC'),
    ingestion_time DateTime64(3, 'UTC'),
    from_state LowCardinality(String),
    to_state LowCardinality(String),
    transition_reason LowCardinality(String),
    actor_id UUID,
    actor_type LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, to_state, event_time, case_id);
```

### 17.5 Official monthly report model

Raw/refined tables may accept late events forever, but official monthly reports may freeze.

```text
Month M close rule:
- live data visible immediately,
- preliminary report generated D+1,
- final report frozen D+5,
- late events after D+5 go to correction ledger,
- correction report links back to raw event_id.
```

This is a business correctness model, not just a database setting.

### 17.6 Auditability fields

For regulatory defensibility, store:

- source system,
- event_id,
- source offset/LSN,
- ingestion time,
- producer version,
- schema version,
- transformation version,
- batch id,
- raw payload reference,
- correction reason.

Without these, analytics cannot be defended when numbers are questioned.

---

## 18. Observability for Ingestion Pipelines

### 18.1 Pipeline metrics

Track at least:

- events consumed per second,
- events inserted per second,
- bytes inserted per second,
- consumer lag,
- ClickHouse insert latency,
- ClickHouse insert error rate,
- batch size rows/bytes,
- DLQ count,
- validation error count,
- duplicate count,
- late event count,
- max event_time seen,
- freshness lag,
- parts created per minute,
- active parts per partition,
- background merge backlog.

### 18.2 ClickHouse-side observability

Useful system tables:

```sql
SELECT *
FROM system.query_log
WHERE type = 'QueryFinish'
  AND query_kind = 'Insert'
ORDER BY event_time DESC
LIMIT 20;
```

```sql
SELECT
    table,
    partition,
    count() AS active_parts,
    sum(rows) AS rows,
    formatReadableSize(sum(bytes_on_disk)) AS size
FROM system.parts
WHERE active
GROUP BY table, partition
ORDER BY active_parts DESC
LIMIT 20;
```

```sql
SELECT *
FROM system.merges
ORDER BY elapsed DESC;
```

```sql
SELECT *
FROM system.mutations
WHERE is_done = 0;
```

### 18.3 End-to-end reconciliation

For each dataset, periodically compare:

- source produced count,
- broker count,
- consumed count,
- inserted count,
- ClickHouse row count,
- DLQ count,
- duplicate count,
- late count.

Example reconciliation table:

```sql
CREATE TABLE ingestion_reconciliation
(
    dataset LowCardinality(String),
    window_start DateTime64(3, 'UTC'),
    window_end DateTime64(3, 'UTC'),
    source_count UInt64,
    consumed_count UInt64,
    inserted_count UInt64,
    dlq_count UInt64,
    duplicate_count UInt64,
    clickhouse_count UInt64,
    status LowCardinality(String),
    checked_at DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(window_start)
ORDER BY (dataset, window_start);
```

---

## 19. Failure Modes and Recovery

### 19.1 ClickHouse unavailable

Symptoms:

- insert errors,
- ingestion consumer lag grows,
- retry queue grows.

Good behavior:

- consumer pauses or slows,
- durable stream retains data,
- backoff with jitter,
- no message loss,
- alert fires,
- recovery resumes from offset.

Bad behavior:

- producer drops events,
- service request path blocks,
- infinite retry storm,
- unbounded memory queue,
- duplicate uncontrolled inserts.

### 19.2 Poison message blocks pipeline

Good behavior:

- classify error,
- route to DLQ,
- continue processing,
- alert owner,
- provide replay tool.

### 19.3 Schema mismatch

Good behavior:

- reject incompatible version,
- DLQ with event_version,
- support old and new schemas concurrently,
- migration plan.

Bad behavior:

- silently store null/default for required field,
- lose semantic data,
- break materialized view.

### 19.4 Duplicate batch load

Good behavior:

- manifest detects already loaded batch_id,
- load is skipped or idempotently replaced.

Bad behavior:

- counts double,
- dashboards inflate,
- no easy way to identify duplicate rows.

### 19.5 Late massive backfill

Good behavior:

- throttled inserts,
- staging table,
- partition-level operation,
- merge monitoring,
- query workload protection.

Bad behavior:

- backfill floods cluster,
- creates part explosion,
- merges fall behind,
- dashboard latency spikes.

### 19.6 Materialized view bug

Good behavior:

- raw table retained,
- target table rebuildable,
- transform version tracked,
- cutover strategy.

Bad behavior:

- only aggregate stored,
- raw events lost,
- no way to recompute.

---

## 20. Java Engineer Perspective

### 20.1 Custom streaming consumer responsibilities

If you build Java ingestion consumer, it owns:

- consuming records,
- parsing and validation,
- schema version routing,
- batching,
- backpressure,
- retry,
- offset commit policy,
- DLQ,
- ClickHouse client configuration,
- metrics,
- graceful shutdown,
- replay controls.

### 20.2 Offset commit rule

Do not commit source offset before insert success unless data is stored durably elsewhere.

Simplified rule:

```text
consume batch → validate → insert to ClickHouse → verify insert accepted → commit offset
```

But timeout ambiguity complicates this.

Therefore still need:

- idempotent events,
- batch_id,
- dedup strategy,
- safe retry.

### 20.3 Batch boundaries

A Java consumer can batch by:

- max rows,
- max bytes,
- max wait time,
- topic partition,
- ClickHouse target table,
- tenant/shard route,
- event_time partition.

Do not create one giant global batch if it mixes too many partitions and tables.

### 20.4 Graceful shutdown

On shutdown:

1. Stop polling new messages.
2. Flush current batch.
3. Commit offsets only for successful records.
4. Route failed records appropriately.
5. Close ClickHouse client.
6. Emit final metrics.

### 20.5 Backpressure policy

When ClickHouse slows down:

- reduce poll rate,
- pause partitions,
- increase batch interval within limit,
- reject non-critical producer traffic if direct path,
- avoid unbounded heap queue,
- alert before lag violates SLA.

### 20.6 Avoid hidden request-path coupling

Bad:

```java
handleBusinessRequest() {
    updateTransactionalDatabase();
    insertAnalyticsEventDirectlyToClickHouse();
    return response;
}
```

Better:

```text
request transaction → write domain state + outbox event → async relay → stream/ClickHouse
```

Or:

```text
request transaction → publish durable event → consumer → ClickHouse
```

Analytics ingestion should not make core business request fail unless business requires it.

---

## 21. Decision Matrix

### 21.1 Choose direct Java insert when

Use if:

- data originates in one/few services,
- throughput manageable,
- batching is implemented,
- replay needs are modest or handled by outbox,
- operational simplicity matters.

Avoid if:

- many producers,
- high criticality,
- replay/audit required,
- spikes large,
- producer should not know ClickHouse.

### 21.2 Choose streaming ingestion when

Use if:

- many producers,
- high throughput,
- low-latency analytics,
- durable replay,
- decoupling,
- multiple downstream consumers.

Avoid if:

- team cannot operate stream platform,
- data volume tiny,
- batch freshness is enough.

### 21.3 Choose CDC when

Use if:

- source data lives in OLTP DB,
- need latest state/dimensions,
- cannot emit all events from app,
- near-real-time operational reporting.

Avoid if:

- domain semantics are required but absent,
- OLTP schema changes frequently without governance,
- deletes/updates are not well understood.

### 21.4 Choose object storage batch when

Use if:

- historical data,
- large periodic loads,
- cheap durable archive,
- backfill/rebuild,
- data lake integration.

Avoid if:

- strict sub-second freshness,
- file lifecycle unmanaged,
- no manifest/checkpoint.

### 21.5 Choose hybrid when

Use if:

- you need low latency and replayability,
- analytics is business-critical,
- historical rebuild is expected,
- compliance/audit matters,
- long-term raw archive is valuable.

This is often the best architecture for serious systems.

---

## 22. Anti-Patterns

### 22.1 Row-by-row streaming inserts

```text
1 message = 1 insert
```

Consequence:

- too many parts,
- merge debt,
- poor throughput,
- unstable cluster.

### 22.2 No raw layer

Only storing aggregates means:

- no replay,
- no repair,
- no audit,
- no metric redefinition.

### 22.3 No event_id

Without stable event identity:

- dedup is guesswork,
- replay dangerous,
- duplicate correction hard.

### 22.4 CDC as domain event replacement

CDC tells what row changed, not necessarily why.

For lifecycle analytics, domain events are usually more meaningful.

### 22.5 Using ClickHouse as queue

ClickHouse is not a message broker.

Do not use it for:

- per-message acknowledgment,
- job dispatch,
- transactional queue semantics,
- consumer coordination.

### 22.6 No DLQ

One bad message should not stop the entire analytical pipeline.

### 22.7 Blind backfill into live table

Backfill without boundary can duplicate or corrupt aggregates.

### 22.8 Treating late events as impossible

Late events are inevitable.

Ignoring them creates silent correctness bugs.

### 22.9 Schema changes without versioning

Breaking producer change can silently destroy analytical correctness.

### 22.10 No reconciliation

If nobody compares source count and ClickHouse count, missing data may go unnoticed for months.

---

## 23. Production Checklist

Before declaring ingestion production-ready, answer these:

### Source and semantics

- [ ] What is the source of truth?
- [ ] Is data append-only, mutable, or snapshot?
- [ ] What is the row grain?
- [ ] What is the stable identity?
- [ ] What is event time?
- [ ] What is ingestion time?
- [ ] Are deletes represented?
- [ ] Are corrections represented?

### Delivery and retry

- [ ] Is delivery at-most-once, at-least-once, or effectively-once?
- [ ] What happens on ClickHouse timeout?
- [ ] Is retry idempotent?
- [ ] Is there a dedup strategy?
- [ ] Is there a batch_id?
- [ ] Is there source offset/LSN tracking?

### Batching and performance

- [ ] What is max rows per batch?
- [ ] What is max bytes per batch?
- [ ] What is max flush interval?
- [ ] Does batching avoid tiny inserts?
- [ ] Does batch mix too many partitions?
- [ ] Are insert errors observable?

### Replay and backfill

- [ ] Can raw data be replayed?
- [ ] Is object storage archive available?
- [ ] Is stream retention enough?
- [ ] Is backfill idempotent?
- [ ] Can materialized views be rebuilt?
- [ ] Is there staging/shadow strategy?

### Data quality

- [ ] Are required fields validated?
- [ ] Is schema version checked?
- [ ] Is DLQ implemented?
- [ ] Are invalid enum/type/timestamp handled?
- [ ] Are poison messages isolated?

### Observability

- [ ] Is source lag measured?
- [ ] Is ingestion lag measured?
- [ ] Is freshness measured?
- [ ] Are duplicates counted?
- [ ] Are late events counted?
- [ ] Are DLQ counts alerted?
- [ ] Are parts/merges monitored?

### Governance

- [ ] Is PII controlled?
- [ ] Is raw payload retention justified?
- [ ] Is tenant isolation preserved?
- [ ] Is lineage stored?
- [ ] Are official reports freeze/correction rules defined?

---

## 24. Exercises

### Exercise 1 — Choose ingestion pattern

For each case, choose direct insert, streaming, CDC, batch, or hybrid:

1. API request logs at 50k events/sec.
2. Daily regulatory report from OLTP cases table.
3. Product clickstream from mobile app.
4. Historical import of 3 years of transaction data.
5. Current customer plan dimension from PostgreSQL.
6. Case lifecycle audit requiring defensible replay.

For each, explain:

- source of truth,
- latency requirement,
- replay need,
- duplicate strategy,
- target table type.

### Exercise 2 — Design event envelope

Design an envelope for:

```text
case.assigned
case.escalated
case.decision_submitted
```

Include:

- event_id,
- tenant_id,
- case_id,
- event_time,
- actor,
- producer,
- schema version,
- trace id,
- payload,
- dedup key.

### Exercise 3 — Late event policy

Define policy for:

```text
Monthly enforcement SLA report
```

Answer:

- When is month closed?
- Are late events allowed to change official numbers?
- Is there correction ledger?
- How are stakeholders informed?
- How is raw data retained?

### Exercise 4 — Backfill plan

You created a wrong materialized view for daily escalation counts.

Design repair plan:

- how to stop wrong updates,
- how to create corrected target,
- how to backfill,
- how to avoid overlap,
- how to validate,
- how to cut over dashboards.

### Exercise 5 — Failure modeling

For a Kafka-to-ClickHouse pipeline, model failures:

- ClickHouse down,
- poison message,
- schema mismatch,
- duplicate retry,
- consumer crash after insert before offset commit,
- late event older than 30 days,
- object storage file loaded twice.

For each, define detection and recovery.

---

## 25. Summary

Part ini memperluas ingestion dari sekadar “cara insert data” menjadi **arsitektur pipeline analitik**.

Poin terpenting:

1. ClickHouse adalah analytical sink/serving engine, bukan pengganti seluruh pipeline.
2. Ingestion adalah semantic translation, bukan hanya data movement.
3. Streaming ingestion harus tetap batched.
4. CDC berguna, tetapi tidak sama dengan domain event.
5. Object storage sangat penting untuk replay, backfill, dan audit.
6. Raw layer memberi kemampuan repair dan defensibility.
7. Late events, duplicates, schema evolution, dan poison messages harus didesain sejak awal.
8. Exactly-once end-to-end sering kurang realistis; target yang lebih sehat adalah idempotent, replayable, verifiable ingestion.
9. Materialized views memerlukan backfill strategy yang eksplisit.
10. Pipeline tanpa observability dan reconciliation adalah risiko correctness.

Mental model akhirnya:

```text
sources
  → durable capture
  → validation/schema/versioning
  → batching/backpressure
  → raw append-only ClickHouse layer
  → refined typed layer
  → aggregate/serving layer
  → verification/replay/repair loop
```

Jika Part 010 membahas **bagaimana menulis ke ClickHouse dengan aman**, Part 011 membahas **bagaimana membangun sistem ingestion end-to-end yang bisa dipercaya**.

---

## 26. Referensi Resmi dan Bacaan Lanjutan

Topik yang relevan untuk eksplorasi lanjutan:

- ClickHouse Kafka table engine.
- ClickHouse Kafka integration guide.
- ClickHouse ClickPipes for Kafka and object storage.
- ClickHouse S3 integration and `s3` table function.
- ClickHouse materialized views.
- ClickHouse incremental materialized views.
- ClickHouse refreshable materialized views.
- ClickHouse best practices for inserts and asynchronous inserts.
- ClickHouse deduplication strategies.
- ClickHouse Java client and JDBC driver.

Gunakan dokumentasi resmi sebagai sumber utama karena detail fitur ingestion, connector, dan setting dapat berubah antar versi ClickHouse.

---

## 27. Status Seri

Part ini adalah:

```text
Part 011 dari 034
```

Seri **belum selesai**.

Part berikutnya:

```text
Part 012 — Query Execution Model: From SQL Text to Pipeline Execution
```



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-010.md">⬅️ Part 010 — Ingestion Architecture I: Inserts, Batching, Idempotency, and Backpressure</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-012.md">Part 012 — Query Execution Model: From SQL Text to Pipeline Execution ➡️</a>
</div>
