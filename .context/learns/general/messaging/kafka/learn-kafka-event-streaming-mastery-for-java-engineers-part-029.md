# learn-kafka-event-streaming-mastery-for-java-engineers-part-029.md

# Part 029 — Data Platform Patterns: Lakehouse, Object Storage, Analytics, Search, and Feature Pipelines

> Seri: **Kafka Event Streaming Mastery for Java Engineers**  
> Bagian: **029 dari 034**  
> Status seri: **belum selesai**  
> Fokus: bagaimana Kafka menjadi backbone antara operational systems, analytical platforms, object storage/lakehouse, search index, ML/feature systems, dan governance layer.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami perbedaan antara **operational stream**, **analytical stream**, **raw event**, **curated event**, dan **derived event**.
2. Mendesain pipeline Kafka menuju **object storage**, **lakehouse**, **warehouse**, **search engine**, dan **feature platform** tanpa mengacaukan semantics Kafka.
3. Menjelaskan kenapa Kafka bukan pengganti data lake, data warehouse, search index, atau feature store.
4. Menentukan kapan data harus tetap berada di Kafka, kapan harus disinkronkan ke sistem lain, dan kapan perlu dibentuk ulang.
5. Memahami risiko sink connector: duplicate write, late event, ordering mismatch, schema drift, backfill, retention mismatch, dan partial failure.
6. Membuat mental model **raw → validated → enriched → projected → served** untuk data streaming platform.
7. Mendesain replay dan backfill dengan aman tanpa merusak downstream analytics/search/ML pipeline.
8. Memahami hubungan Kafka dengan lineage, catalog, governance, schema registry, dan data quality.
9. Menghindari anti-pattern umum: “semua topic langsung dikirim ke lake”, “Kafka sebagai database analytics”, “search index sebagai source of truth”, dan “feature pipeline tanpa time semantics”.
10. Mampu membuat design review untuk Kafka data platform patterns secara defensible.

---

## 2. Mental Model Utama

Kafka sering diposisikan sebagai jembatan antara **systems of record** dan **systems of insight**.

Tetapi cara berpikir yang benar bukan:

```text
Database -> Kafka -> everywhere
```

Mental model yang lebih akurat:

```text
Operational facts
    -> durable event streams
        -> validation / normalization
            -> enrichment / aggregation
                -> serving projections
                    -> analytics / search / ML / audit / monitoring
```

Kafka adalah **streaming backbone**, bukan akhir dari perjalanan data.

Kafka kuat untuk:

- menangkap perubahan sebagai event,
- menyimpan log jangka pendek/menengah,
- memungkinkan replay,
- menghubungkan banyak consumer,
- menjalankan stream processing,
- mempertahankan ordering per key,
- menjadi transport data low-latency.

Kafka tidak ideal sebagai:

- query engine ad-hoc skala besar,
- long-term cheap archive tanpa tiered/object-storage strategy,
- OLAP warehouse,
- full-text search engine,
- vector database,
- feature store lengkap,
- master data management system,
- source of truth untuk semua domain.

Prinsipnya:

```text
Kafka carries and coordinates data movement.
Other systems specialize in serving, querying, archiving, searching, or training from that data.
```

---

## 3. Peta Besar Kafka dalam Data Platform

Bayangkan organisasi memiliki banyak sistem:

```text
Operational systems:
- case management
- payment
- account
- enforcement
- notification
- identity
- document service
- CRM
- ERP

Data serving systems:
- object storage / data lake
- lakehouse table format
- data warehouse
- search index
- cache
- graph database
- feature store
- monitoring / SIEM
- dashboarding platform
```

Kafka biasanya duduk di tengah:

```text
[Operational DB / App Events / CDC]
              |
              v
          [Kafka Topics]
              |
  +-----------+------------+--------------+--------------+
  |                        |              |              |
  v                        v              v              v
Object Storage         Warehouse       Search        ML Features
Lakehouse              BI/OLAP         Index         Online/Offline
```

Tetapi pipeline yang matang jarang memakai satu topic langsung ke semua sistem.

Biasanya ada layer:

```text
raw topics
  -> validated topics
      -> curated topics
          -> enriched topics
              -> serving-specific topics
```

Contoh untuk enforcement case:

```text
raw.case-events
  -> validated.case-events
      -> curated.case-lifecycle-events
          -> enriched.case-lifecycle-with-officer-region
              -> search.case-index-events
              -> lakehouse.case-event-facts
              -> feature.case-risk-signals
              -> audit.case-timeline-events
```

---

## 4. Operational Stream vs Analytical Stream

### 4.1 Operational Stream

Operational stream digunakan untuk menjalankan proses bisnis.

Karakteristik:

- latency rendah,
- ordering per entity penting,
- event semantics harus domain-specific,
- idempotency penting,
- consumer sering melakukan side effect,
- failure harus cepat ditangani,
- topic retention sering disesuaikan dengan kebutuhan replay operasional.

Contoh:

```text
case.created
case.assigned
case.escalated
case.decision.recorded
case.evidence.received
```

Operational consumer:

```text
case-escalation-service
notification-service
audit-projection-service
workflow-orchestrator
```

### 4.2 Analytical Stream

Analytical stream digunakan untuk insight, reporting, ML, dan historical analysis.

Karakteristik:

- volume besar,
- retention panjang biasanya di luar Kafka,
- event-time correctness penting,
- schema evolution harus kompatibel dengan analytics,
- late arrival perlu ditangani,
- sering butuh denormalisasi,
- sink biasanya object storage, warehouse, atau lakehouse.

Contoh:

```text
case_event_fact
case_assignment_fact
case_sla_breach_fact
case_decision_fact
case_evidence_fact
```

### 4.3 Mengapa Tidak Disatukan?

Operational event sering terlalu domain/behavioral untuk analytics langsung.

Analytical event sering terlalu lebar, denormalized, dan reporting-oriented untuk proses bisnis.

Kesalahan umum:

```text
Satu topic dipakai untuk:
- workflow
- audit
- BI
- search
- ML
- integration eksternal
```

Akibat:

- schema menjadi kompromi buruk,
- semua consumer takut breaking change,
- event menjadi terlalu besar,
- ordering semantics tidak jelas,
- retention policy konflik,
- producer tidak tahu siapa sebenarnya consumer-nya,
- topic berubah menjadi shared database table.

Prinsip:

```text
Operational streams model business facts.
Analytical streams model facts for measurement and inquiry.
Serving streams model facts for a target read model.
```

---

## 5. Raw, Validated, Curated, Enriched, Derived Topics

### 5.1 Raw Topics

Raw topic berisi data sedekat mungkin dengan sumbernya.

Contoh:

```text
raw.postgres.public.case
raw.crm.case_updates
raw.partner.complaint_events
raw.webhook.payment_notifications
```

Kegunaan:

- forensics,
- reprocessing,
- debugging,
- recovery dari transform bug,
- audit asal data,
- menyimpan bentuk asli sebelum canonicalization.

Risiko:

- schema bisa jelek,
- data bisa tidak valid,
- PII bisa bocor,
- naming tidak domain-friendly,
- event belum tentu meaningful.

Raw topic biasanya tidak boleh dikonsumsi bebas oleh banyak tim.

### 5.2 Validated Topics

Validated topic berisi data yang sudah lolos basic validation.

Validasi bisa mencakup:

- schema compatibility,
- required field,
- type correctness,
- tenant id valid,
- timestamp valid,
- event id valid,
- duplicate detection dasar,
- poison event quarantine.

Contoh:

```text
validated.case-events
validated.payment-events
validated.partner-complaints
```

### 5.3 Curated Topics

Curated topic adalah stream yang sudah disesuaikan dengan canonical domain model.

Contoh:

```text
curated.case-lifecycle-events
curated.case-assignment-events
curated.case-evidence-events
curated.case-decision-events
```

Karakteristik:

- nama event domain-specific,
- schema stabil,
- ownership jelas,
- compatibility policy ketat,
- bisa dipakai banyak consumer,
- dokumentasi tersedia.

### 5.4 Enriched Topics

Enriched topic menambahkan konteks dari stream/table lain.

Contoh:

```text
case.assigned
  + officer.profile
  + office.region
  + case.category
  -> enriched.case-assignment-events
```

Kegunaan:

- analytics lebih mudah,
- search indexing lebih langsung,
- feature generation lebih efisien,
- downstream tidak perlu join ke banyak sistem.

Risiko:

- enrichment bisa stale,
- join semantics bisa salah,
- data lineage menjadi lebih kompleks,
- perubahan reference data bisa memicu reprocessing.

### 5.5 Derived Topics

Derived topic adalah hasil agregasi, join, projection, atau transformation.

Contoh:

```text
case-sla-status-by-case-id
case-risk-score-updated
case-officer-workload-summary
case-region-daily-metrics
```

Derived topic harus punya ownership dan contract seperti topic lain.

Jangan berpikir:

```text
Derived topic cuma internal hasil processing.
```

Kalau ada consumer lain yang bergantung padanya, derived topic sudah menjadi API.

---

## 6. Kafka to Object Storage

Object storage seperti S3, GCS, atau Azure Blob sering menjadi landing zone jangka panjang untuk event.

Kafka cocok mengalirkan data ke object storage karena:

- Kafka menyimpan stream low-latency,
- object storage murah untuk retention panjang,
- object storage cocok untuk batch analytics,
- file dapat dibaca oleh Spark, Trino, Flink, warehouse external table, atau lakehouse engine.

### 6.1 Pattern Umum

```text
Kafka topic
  -> S3/GCS/Azure Blob sink connector
      -> partitioned files
          -> data lake / lakehouse table
```

Contoh layout:

```text
s3://company-lake/raw/case-events/year=2026/month=06/day=19/hour=10/part-0001.parquet
s3://company-lake/curated/case-lifecycle/year=2026/month=06/day=19/part-0001.parquet
```

### 6.2 Format File

Format umum:

| Format | Cocok untuk | Catatan |
|---|---|---|
| JSON | debugging, raw landing | besar, kurang efisien |
| Avro | row-based, schema evolution | bagus untuk event record |
| Parquet | analytics columnar | efisien untuk query OLAP |
| ORC | analytics Hadoop/Hive ecosystem | mirip Parquet dalam tujuan |

Untuk analytics modern, Parquet sering lebih efisien karena columnar.

Tetapi raw archive kadang tetap memakai Avro/JSON untuk mempertahankan fidelity event.

### 6.3 Partitioning Object Storage

Ada dua jenis partitioning yang sering tertukar:

```text
Kafka partition != object storage partition path
```

Kafka partition:

```text
case-events-0
case-events-1
case-events-2
```

Object storage partition path:

```text
year=2026/month=06/day=19/hour=10
region=west/category=fraud
```

Kafka partition adalah unit ordering dan parallelism.

Object storage partition path adalah unit query pruning dan file organization.

Salah desain object storage partition bisa menyebabkan:

- terlalu banyak small files,
- query scan terlalu besar,
- skewed partition,
- sulit backfill,
- sulit compaction file,
- biaya metadata tinggi.

### 6.4 Exactly-Once ke Object Storage?

Jangan menyederhanakan menjadi “Kafka exactly once berarti sink exactly once”.

Kafka-to-object-storage semantics tergantung connector, file commit protocol, deterministic partitioner, dan behavior object storage.

Beberapa connector menyediakan stronger semantics dengan syarat tertentu, misalnya deterministic partitioning dan commit interval yang stabil.

Tetapi dari perspektif arsitektur, tetap desain downstream agar tahan terhadap:

- duplicate file,
- partial file,
- late file,
- reprocessed file,
- schema evolution,
- partition overwrite,
- object visibility delay,
- task restart.

### 6.5 Small Files Problem

Streaming sink sering menghasilkan banyak file kecil.

Penyebab:

- flush terlalu sering,
- partition path terlalu granular,
- topic terlalu banyak,
- task parallelism tinggi,
- traffic rendah per partition,
- late event membuat banyak path aktif,
- retry menghasilkan fragmentasi.

Dampak:

- query lambat,
- metadata overhead tinggi,
- compaction job mahal,
- warehouse/lakehouse table menjadi berat.

Mitigasi:

- gunakan file rolling policy yang masuk akal,
- batch berdasarkan waktu/size,
- hindari partition path terlalu granular,
- jalankan compaction/optimize job,
- pisahkan raw landing dan curated table,
- gunakan lakehouse table format bila perlu ACID/metadata management.

---

## 7. Kafka and Lakehouse

Lakehouse biasanya menggabungkan object storage dengan table format yang menyediakan metadata, schema evolution, snapshot, dan transactional table operations.

Contoh ekosistem umum:

```text
Apache Iceberg
Delta Lake
Apache Hudi
```

Kafka tidak menggantikan lakehouse.

Kafka menyediakan stream perubahan.

Lakehouse menyediakan long-term analytical table.

### 7.1 Pattern

```text
Operational DB / app events
  -> Kafka raw topics
      -> validation/enrichment
          -> Kafka curated analytical topics
              -> lakehouse table ingestion
                  -> BI / ML / batch analytics / audit reconstruction
```

### 7.2 Mengapa Tidak Langsung dari DB ke Lakehouse?

Bisa, tetapi Kafka memberi beberapa manfaat:

- multiple consumer real-time,
- replay intermediate,
- transform stream sebelum landing,
- decoupling producer dan sink,
- CDC stream bisa dipakai untuk operational integration juga,
- schema governance lebih eksplisit,
- low-latency analytics.

Namun Kafka juga menambah complexity:

- topic governance,
- connector operations,
- schema compatibility,
- lag monitoring,
- duplicate/late event handling,
- cost.

Decision rule:

```text
Jika hanya butuh nightly batch report, Kafka mungkin berlebihan.
Jika butuh event dipakai banyak downstream real-time + replay + integration, Kafka masuk akal.
```

### 7.3 Raw Table vs Curated Table

Raw lake table:

- bentuk mendekati event asli,
- cocok untuk replay/forensics,
- retention panjang,
- tidak selalu enak untuk BI.

Curated lake table:

- schema bersih,
- typed,
- domain-oriented,
- partitioned untuk query,
- cocok untuk analytics.

Serving table:

- dibentuk untuk use case spesifik,
- bisa denormalized,
- bisa aggregate,
- tidak selalu cocok sebagai canonical truth.

---

## 8. Kafka to Warehouse

Data warehouse cocok untuk:

- BI,
- dashboard,
- ad-hoc analytics,
- dimensional modelling,
- reporting,
- historical aggregation,
- business metrics.

Kafka cocok memberi low-latency ingestion ke warehouse.

Pattern:

```text
Kafka curated analytical topic
  -> warehouse sink connector / ingestion service
      -> staging table
          -> merge/upsert into fact/dimension tables
```

### 8.1 Insert-Only Fact Table

Event log cocok menjadi fact table append-only.

Contoh:

```text
case_event_fact(
  event_id,
  case_id,
  event_type,
  event_time,
  ingestion_time,
  actor_id,
  tenant_id,
  payload,
  schema_version
)
```

Kelebihan:

- audit-friendly,
- replay-friendly,
- duplicate bisa dideteksi lewat event_id,
- history tidak hilang.

### 8.2 Upsert Dimension Table

Compacted topic atau CDC stream sering dipakai untuk dimension table.

Contoh:

```text
officer_profile_current
case_current_status
region_reference
```

Warehouse sink harus jelas apakah:

- insert only,
- upsert by key,
- delete by tombstone,
- merge by event_time,
- latest ingestion wins,
- latest event_time wins.

### 8.3 Late Event Problem

Event bisa datang terlambat.

Jika warehouse aggregate langsung berdasarkan ingestion time, hasil bisa salah.

Contoh:

```text
Case decision event_time: 2026-06-18 23:59
Ingested to Kafka:       2026-06-19 00:05
Warehouse loaded:        2026-06-19 00:06
```

Pertanyaan:

- masuk report tanggal 18 atau 19?
- apakah dashboard kemarin perlu dikoreksi?
- apakah SLA calculation memakai event_time atau ingestion_time?
- apakah late correction diizinkan?

Top 1% engineer mendefinisikan ini eksplisit, bukan membiarkan default sink menentukan behavior.

---

## 9. Kafka to Search Index

Search engine seperti Elasticsearch/OpenSearch/Solr cocok untuk:

- full-text search,
- faceted search,
- filtering cepat,
- operational dashboard,
- case lookup,
- investigation UI,
- denormalized read model.

Kafka cocok sebagai sumber update search index.

Pattern:

```text
case lifecycle events
  -> stream processor builds search document update
      -> search.case-index-events
          -> search sink connector
              -> Elasticsearch/OpenSearch index
```

### 9.1 Search Index Bukan Source of Truth

Search index adalah projection.

Jika index rusak:

```text
rebuild from Kafka / lakehouse / source of truth
```

Jangan desain workflow bisnis yang hanya bergantung pada search index sebagai canonical state.

### 9.2 Document ID dan Idempotency

Agar sink ke search aman, document ID harus deterministic.

Contoh:

```text
document_id = case_id
```

atau untuk event history index:

```text
document_id = event_id
```

Tanpa deterministic ID, retry bisa membuat duplicate document.

### 9.3 Full Replacement vs Partial Update

Ada dua pendekatan:

#### Full document replacement

```text
case_id -> full denormalized case search document
```

Kelebihan:

- idempotent,
- mudah rebuild,
- state jelas.

Kekurangan:

- event processor harus punya state lengkap,
- payload besar,
- update bisa mahal.

#### Partial update

```text
case_assigned -> update assignee fields only
case_escalated -> update escalation fields only
```

Kelebihan:

- payload kecil,
- lebih langsung.

Kekurangan:

- ordering penting,
- partial failure bisa membuat dokumen inconsistent,
- rebuild lebih sulit,
- duplicate/late event bisa merusak state jika tidak idempotent.

Untuk regulatory/case management, full projection sering lebih defensible untuk critical search document, sementara partial update bisa dipakai untuk non-critical fields dengan version check.

### 9.4 Version Guard

Agar late event tidak menimpa state baru:

```text
case_version
state_sequence
last_event_time
last_event_offset
```

Search update sebaiknya menolak update jika version lebih lama.

Contoh invariant:

```text
A search document may only move forward by case_version.
A stale event must not overwrite newer searchable state.
```

---

## 10. Kafka for Feature Pipelines

Feature pipeline mengubah event menjadi sinyal untuk model ML, risk scoring, recommendation, fraud detection, atau prioritization.

Contoh enforcement/case management:

```text
case.created
case.evidence.received
case.assigned
case.escalated
case.decision.recorded
```

Dapat menghasilkan feature:

```text
number_of_prior_cases_by_subject_last_90d
average_response_time_by_officer_last_30d
count_of_evidence_updates_last_7d
case_category_escalation_rate
subject_recent_compliance_score
```

### 10.1 Online vs Offline Features

Offline feature:

- untuk training,
- dihitung dari historical data,
- biasanya di lakehouse/warehouse,
- batch atau streaming-to-lake.

Online feature:

- untuk real-time inference,
- latency rendah,
- disimpan di online store/cache,
- dihitung dari stream.

Masalah besar:

```text
training-serving skew
```

Artinya feature yang dipakai saat training tidak sama dengan feature yang dipakai saat inference.

Kafka membantu karena event stream yang sama bisa menjadi basis offline dan online feature, tetapi hanya jika transformation logic, timestamp semantics, dan schema dijaga.

### 10.2 Event Time Matters

Feature berbasis window harus memakai event time yang benar.

Contoh:

```text
count_cases_last_30_days(subject_id)
```

Pertanyaan:

- 30 hari berdasarkan waktu kejadian atau waktu ingestion?
- bagaimana late event mempengaruhi feature?
- apakah feature historical bisa direkonstruksi point-in-time?
- apakah data masa depan bocor ke training set?

Jika salah, model bisa terlihat bagus di training tetapi gagal di production.

### 10.3 Point-in-Time Correctness

Untuk ML, point-in-time correctness berarti feature pada waktu T hanya boleh memakai informasi yang tersedia sampai T.

Kafka offset dan event_time dapat membantu merekonstruksi state, tetapi kamu harus menyimpan metadata:

```text
event_time
ingestion_time
source_transaction_time
processing_time
feature_computation_time
source_offset
source_topic
source_partition
source_schema_version
```

Tanpa metadata itu, audit ML dan debugging model menjadi sulit.

---

## 11. Stream-Table Duality dalam Data Platform

Konsep penting:

```text
A stream is a sequence of changes.
A table is the current state obtained by applying those changes.
```

Kafka event stream:

```text
case.created
case.assigned
case.escalated
case.resolved
```

Current case table:

```text
case_id -> latest status, assignee, SLA, region, priority
```

Dalam data platform, kamu sering butuh keduanya:

| Kebutuhan | Bentuk Data |
|---|---|
| Audit history | Stream/event log |
| Current dashboard | Table/projection |
| Search document | Denormalized table/document |
| ML training | Historical fact + point-in-time features |
| Real-time alerting | Stream/windowed aggregation |
| Regulatory review | Event timeline + derived state snapshots |

Kesalahan umum adalah hanya menyimpan current state dan kehilangan event history.

Kesalahan lain adalah hanya menyimpan event history dan memaksa semua query menghitung ulang dari awal.

Prinsip:

```text
Keep immutable facts.
Build mutable projections.
Know which one is authoritative for each question.
```

---

## 12. Lambda vs Kappa Architecture

### 12.1 Lambda Architecture

Lambda architecture memisahkan batch layer dan speed layer.

```text
Batch path:
all historical data -> batch compute -> serving view

Speed path:
new events -> stream compute -> real-time view
```

Kelebihan:

- batch bisa menghitung ulang dari full history,
- speed layer memberi low latency.

Kekurangan:

- dua code path,
- consistency sulit,
- hasil batch dan speed bisa berbeda,
- biaya operasional tinggi.

### 12.2 Kappa Architecture

Kappa architecture mencoba menggunakan stream sebagai jalur utama.

```text
all data as log
  -> stream processing
      -> serving view
```

Reprocessing dilakukan dengan replay log.

Kelebihan:

- satu mental model,
- pipeline lebih sederhana,
- replay-driven.

Kekurangan:

- Kafka retention/log storage harus cukup,
- replay besar bisa mahal,
- stream processor harus deterministic,
- tidak semua analytics cocok streaming-only,
- historical correction bisa rumit.

### 12.3 Practical Hybrid

Dalam praktik modern, sering lebih realistis memakai hybrid:

```text
Kafka for low-latency event movement
Object storage/lakehouse for long-term history
Stream processing for operational projection
Batch/lakehouse processing for large historical recompute
```

Ini bukan kegagalan desain.

Ini pengakuan bahwa sistem punya kebutuhan latency, cost, dan query yang berbeda.

---

## 13. Backfill dan Replay Strategy

Backfill adalah mengisi ulang data historis.

Replay adalah membaca ulang stream dari offset lama.

Keduanya terlihat sederhana, tetapi bisa merusak downstream jika tidak didesain.

### 13.1 Jenis Backfill

#### Source backfill

Mengambil ulang dari database/source system.

```text
DB -> CDC/snapshot -> Kafka
```

#### Kafka replay

Consumer membaca ulang topic dari offset awal.

```text
Kafka topic offset 0 -> rebuild projection
```

#### Lakehouse replay

Membaca historical event/fact dari object storage/lakehouse lalu publish ulang atau rebuild table.

```text
lakehouse event archive -> processing job -> new serving table/topic
```

### 13.2 Jangan Replay ke Topic Produksi Sembarangan

Jika kamu replay historical event ke topic yang sama, consumer operasional bisa mengira event lama adalah event baru.

Bahaya:

- notifikasi terkirim ulang,
- SLA dihitung ulang salah,
- search index revert,
- workflow state mundur,
- alert palsu,
- external API dipanggil ulang,
- ML feature berubah tanpa kontrol.

Pattern yang lebih aman:

```text
source topic -> replay job -> replay namespace topic -> validate -> controlled swap
```

Contoh:

```text
curated.case-events
  -> replay.case-events.v20260619
      -> rebuild.case-search-index.v2
          -> blue/green index switch
```

### 13.3 Replay Metadata

Event replay harus membawa metadata:

```text
original_event_id
original_event_time
original_topic
original_partition
original_offset
replay_job_id
replay_time
replay_reason
```

Consumer harus bisa membedakan:

```text
live event vs replayed event
```

atau topic replay harus dipisahkan total agar consumer live tidak terdampak.

### 13.4 Idempotency untuk Backfill

Backfill aman jika sink idempotent.

Contoh:

```text
warehouse fact table: unique(event_id)
search index: document_id = case_id or event_id
feature store: key = feature_name + entity_id + feature_time
object storage: deterministic path + commit protocol
```

---

## 14. Data Quality dalam Kafka Data Platform

Data quality bukan hanya validasi schema.

Schema menjawab:

```text
Apakah bentuk data sesuai?
```

Data quality menjawab:

```text
Apakah data masuk akal, lengkap, konsisten, tepat waktu, dan dapat dipercaya?
```

### 14.1 Dimensi Data Quality

| Dimensi | Pertanyaan |
|---|---|
| Validity | Apakah field sesuai constraint? |
| Completeness | Apakah field penting terisi? |
| Timeliness | Apakah event terlalu terlambat? |
| Uniqueness | Apakah event duplicate? |
| Consistency | Apakah status valid terhadap state machine? |
| Accuracy | Apakah nilai benar terhadap sumber otoritatif? |
| Lineage | Dari mana data berasal? |
| Freshness | Seberapa baru data projection? |

### 14.2 Data Quality Topic

Daripada hanya log error, buat stream kualitas data.

Contoh:

```text
data-quality.case-events.violations
```

Payload:

```json
{
  "violation_id": "dqv-001",
  "source_event_id": "evt-123",
  "rule_id": "CASE_STATUS_TRANSITION_INVALID",
  "severity": "HIGH",
  "detected_at": "2026-06-19T10:15:00Z",
  "source_topic": "curated.case-events",
  "source_partition": 4,
  "source_offset": 88123,
  "details": {
    "from_status": "CLOSED",
    "to_status": "ASSIGNED"
  }
}
```

Dengan ini data quality menjadi observable dan auditable.

### 14.3 Quarantine Pattern

Bad data jangan selalu dibuang.

Pattern:

```text
input topic
  -> validator
      -> valid topic
      -> quarantine topic
```

Contoh:

```text
raw.partner-case-events
  -> validated.partner-case-events
  -> quarantine.partner-case-events
```

Quarantine harus punya:

- alasan penolakan,
- original payload,
- schema version,
- source metadata,
- retryability flag,
- owner,
- SLA remediation.

---

## 15. Lineage, Catalog, dan Governance

Kafka data platform cepat tumbuh menjadi ratusan topic.

Tanpa catalog, engineer akan bertanya:

```text
Topic ini milik siapa?
Boleh saya consume?
Schema mana yang benar?
Field ini artinya apa?
Apakah ada PII?
Berapa retention-nya?
Apakah topic ini deprecated?
Apa downstream impact jika berubah?
```

### 15.1 Metadata yang Harus Ada

Untuk setiap topic:

```text
topic_name
owner_team
domain
classification
contains_pii
contains_sensitive_data
schema_subject
compatibility_policy
retention_policy
cleanup_policy
producer_apps
consumer_apps
SLO
contact
runbook
created_at
deprecation_status
```

Untuk setiap field penting:

```text
field_name
business_definition
data_type
nullable
PII classification
allowed_values
unit
source_of_truth
```

### 15.2 Lineage Graph

Lineage menjawab:

```text
Dari mana data berasal?
Ke mana data mengalir?
Transformasi apa yang terjadi?
Siapa terdampak kalau field berubah?
```

Contoh lineage:

```text
postgres.case_table
  -> raw.postgres.case
      -> curated.case-lifecycle-events
          -> enriched.case-lifecycle-events
              -> lakehouse.case_event_fact
              -> search.case-index-events
              -> feature.case-risk-signals
```

Tanpa lineage, perubahan kecil bisa memecahkan dashboard, search, ML, dan audit tanpa diketahui.

---

## 16. Schema Evolution untuk Analytics dan Lakehouse

Schema evolution untuk stream consumer sudah dibahas di Part 010.

Dalam data platform, ada tambahan masalah:

- table schema evolution,
- partition evolution,
- nullable column,
- default values,
- backfill historical data,
- derived table compatibility,
- query compatibility,
- downstream dashboard assumptions.

### 16.1 Additive Change

Menambah optional field biasanya aman untuk stream.

Tapi untuk warehouse/lakehouse:

- apakah column ditambahkan otomatis?
- apakah dashboard melihat null?
- apakah old partitions punya field itu?
- apakah backfill diperlukan?

### 16.2 Rename Field

Rename field biasanya breaking.

Lebih aman:

```text
add new field
populate both old and new
migrate consumers
mark old deprecated
remove after contract window
```

### 16.3 Change Meaning

Mengubah meaning field tanpa mengubah nama adalah lebih berbahaya daripada breaking schema.

Contoh:

```text
risk_score originally 0-100
risk_score changed to 0.0-1.0
```

Schema mungkin tetap valid, tetapi analytics rusak.

Gunakan:

```text
risk_score_v2
risk_score_scale
model_version
feature_version
```

---

## 17. Serving-Specific Topic Design

Satu curated topic tidak harus langsung masuk ke semua sink.

Buat topic yang sesuai kebutuhan serving.

### 17.1 Search Serving Topic

```text
search.case-index-events
```

Berisi:

- document id,
- operation type,
- full document atau patch,
- version,
- routing key,
- index name/version,
- event metadata.

### 17.2 Warehouse Serving Topic

```text
warehouse.case-event-facts
```

Berisi:

- fact row stable,
- event id,
- event time,
- dimensions,
- measures,
- schema version.

### 17.3 Feature Serving Topic

```text
feature.case-risk-signals
```

Berisi:

- entity id,
- feature name,
- feature value,
- feature timestamp,
- computation metadata,
- source offsets,
- model/feature version.

### 17.4 Audit Serving Topic

```text
audit.case-timeline-events
```

Berisi:

- immutable timeline item,
- actor,
- causation,
- previous/next state,
- evidence references,
- redaction policy,
- retention classification.

Prinsip:

```text
Do not make every sink reverse-engineer business intent from one generic topic.
```

---

## 18. Idempotency per Sink Type

| Sink | Idempotency Strategy |
|---|---|
| Object storage | deterministic path, transactional commit protocol, compaction job |
| Warehouse fact | unique event_id, merge strategy |
| Warehouse dimension | primary key + version/event_time guard |
| Search index | deterministic document_id + version guard |
| Feature store | entity_id + feature_name + feature_time + feature_version |
| Cache | key overwrite with monotonic version |
| Graph DB | deterministic node/edge id |
| Notification | dedupe by notification intent id |

Idempotency harus dirancang secara eksplisit.

Kafka tidak bisa otomatis membuat semua sink idempotent.

---

## 19. Retention Mismatch

Kafka retention sering lebih pendek daripada kebutuhan analytics/audit.

Contoh:

```text
Kafka topic retention: 7 days
Audit requirement: 7 years
```

Solusi bukan sekadar menaikkan Kafka retention tujuh tahun.

Pertimbangkan:

- object storage archive,
- lakehouse immutable table,
- tiered storage jika cocok,
- audit projection,
- event hash/checksum,
- schema snapshot,
- replay policy,
- deletion/redaction policy.

### 19.1 Retention Decision Matrix

| Data | Kafka Retention | Long-Term Store |
|---|---:|---|
| Operational command/event | hari-minggu | audit/lake jika perlu |
| Raw CDC | hari-minggu/bulan | object storage |
| Curated domain event | minggu/bulan | lakehouse/audit archive |
| Compacted reference topic | panjang/compact | source DB/lake snapshot |
| Search serving event | pendek | rebuildable dari source |
| Feature event | sesuai online need | offline feature store/lake |

---

## 20. Privacy, Redaction, and Right-to-Erasure

Kafka event bersifat append-only.

Ini bertabrakan dengan kebutuhan privasi jika event berisi PII.

### 20.1 Prinsip PII dalam Kafka

1. Jangan masukkan PII jika tidak diperlukan.
2. Pisahkan identifier teknis dari personal data.
3. Tokenize atau pseudonymize bila memungkinkan.
4. Gunakan reference ke secure data store untuk field sensitif.
5. Terapkan ACL topic ketat.
6. Klasifikasikan topic berdasarkan sensitivity.
7. Rancang redaction event dan downstream deletion.

### 20.2 Redaction Event

Daripada mengubah event lama, publish correction/redaction event.

```text
case.personal-data-redacted
```

Payload:

```json
{
  "event_id": "evt-redact-001",
  "subject_id": "subj-123",
  "redaction_reason": "RETENTION_POLICY_EXPIRED",
  "fields_redacted": ["full_name", "phone_number", "address"],
  "effective_time": "2026-06-19T00:00:00Z"
}
```

Downstream projections harus tahu cara menerapkannya:

- search index menghapus field,
- lakehouse menandai row/column redacted,
- feature store menghapus atau recompute feature,
- audit view menampilkan redacted marker.

### 20.3 Hard Delete Tidak Sederhana

Kafka compacted topic dengan tombstone bisa menghapus latest value untuk key, tetapi tidak sama dengan menghapus semua jejak historis dari semua log segment, sink, backup, object storage, search index, dan warehouse.

Privacy compliance harus didesain end-to-end, bukan hanya Kafka config.

---

## 21. Example Architecture: Enforcement Data Platform

### 21.1 Input Sources

```text
case-service app events
assignment-service app events
evidence-service app events
workflow-service events
PostgreSQL CDC for legacy case tables
partner complaint webhook
identity/reference data CDC
```

### 21.2 Kafka Topic Layers

```text
raw.legacy.case-cdc
raw.partner.complaints
raw.identity.officer-cdc

validated.case-events
validated.partner-complaints
validated.officer-reference

curated.case-lifecycle-events
curated.case-assignment-events
curated.case-evidence-events
curated.case-decision-events

enriched.case-lifecycle-events

audit.case-timeline-events
search.case-index-events
warehouse.case-event-facts
feature.case-risk-signals
```

### 21.3 Processing Components

```text
validator-service
canonicalizer-service
enrichment-kafka-streams-app
audit-projection-service
search-projection-service
feature-streaming-app
warehouse-sink-connect
s3/lakehouse-sink-connect
```

### 21.4 Sink Systems

```text
Object storage / lakehouse:
- raw archive
- curated fact tables
- audit reconstruction datasets

Warehouse:
- SLA dashboard
- operational metrics
- compliance report

Search:
- case search
- investigation UI
- evidence discovery

Feature store:
- case risk scoring
- workload prediction
- escalation likelihood
```

### 21.5 Key Invariants

```text
Every domain event has event_id.
Every case event has case_id.
Every state transition has previous_state and new_state.
Every projection update is idempotent.
Every sink can be rebuilt from upstream durable source.
Every serving model declares whether it is authoritative or derived.
Every PII field has classification and retention policy.
Every replay is isolated or explicitly marked.
```

---

## 22. Java Engineer Perspective

Sebagai Java engineer, kontribusi kamu bukan hanya membuat producer/consumer.

Kamu perlu memastikan:

1. Event model punya identity dan version.
2. Producer menghasilkan event yang deterministic dan traceable.
3. Consumer/sink idempotent.
4. Processing app menyimpan offset dan side effect secara aman.
5. Backfill/replay tidak memanggil side effect berbahaya.
6. Schema evolution diuji di CI.
7. Search/warehouse/feature sink punya version guard.
8. Observability mencakup lag, freshness, invalid record, DLQ, dan sink latency.
9. Data quality error menjadi event, bukan hanya log.
10. Pipeline bisa direbuild.

### 22.1 Event Envelope untuk Data Platform

Contoh envelope Java-friendly:

```json
{
  "event_id": "evt-123",
  "event_type": "CaseAssigned",
  "event_version": 3,
  "event_time": "2026-06-19T10:15:00Z",
  "ingestion_time": "2026-06-19T10:15:02Z",
  "tenant_id": "tenant-a",
  "correlation_id": "corr-777",
  "causation_id": "evt-122",
  "source_system": "case-service",
  "source_instance": "case-service-7d9c",
  "schema_subject": "curated.case-lifecycle-events-value",
  "schema_version": 12,
  "payload": {
    "case_id": "case-001",
    "previous_status": "OPEN",
    "new_status": "ASSIGNED",
    "assignee_id": "officer-9"
  }
}
```

### 22.2 Projection Metadata

Setiap projection record sebaiknya menyimpan:

```text
source_topic
source_partition
source_offset
source_event_id
source_event_time
projection_version
processed_at
processor_app_id
processor_app_version
```

Ini membuat debugging jauh lebih mudah.

---

## 23. Failure Modes

### 23.1 Sink Duplicate

Penyebab:

- connector restart,
- retry after timeout,
- offset committed setelah write,
- sink tidak idempotent,
- document ID random.

Mitigasi:

- deterministic IDs,
- unique constraints,
- upsert/merge,
- event_id dedupe,
- version guard.

### 23.2 Sink Lag

Penyebab:

- warehouse throttling,
- object storage slow commit,
- search cluster overloaded,
- connector task under-provisioned,
- large messages,
- schema errors.

Mitigasi:

- monitor sink latency,
- scale tasks,
- throttle upstream,
- split topic,
- tune batching,
- add DLQ/quarantine.

### 23.3 Schema Drift

Penyebab:

- producer bypass schema registry,
- manual change in source DB,
- CDC schema change,
- optional field misused,
- semantic change without version bump.

Mitigasi:

- compatibility checks,
- contract testing,
- schema review,
- field-level docs,
- data quality rules.

### 23.4 Late Event Overwrites Current State

Penyebab:

- sink uses ingestion order,
- no event_time/version guard,
- replay mixed with live traffic,
- partition key wrong.

Mitigasi:

- monotonic version,
- event_time policy,
- replay isolation,
- key by entity,
- reject stale projection updates.

### 23.5 Rebuild Impossible

Penyebab:

- Kafka retention expired,
- no lake archive,
- transformation code changed without versioning,
- schema unavailable,
- old reference data missing.

Mitigasi:

- raw archive,
- schema retention,
- versioned processing jobs,
- reference snapshots,
- deterministic replay plan.

---

## 24. Design Trade-Offs

### 24.1 One Topic to Many Sinks vs Serving-Specific Topics

One topic to many sinks:

- simpler at first,
- fewer transformations,
- lower operational overhead.

But:

- sinks become tightly coupled,
- schema becomes overloaded,
- search/warehouse/ML needs conflict.

Serving-specific topics:

- more topics,
- more processing,
- more governance.

But:

- clearer contracts,
- better sink semantics,
- easier evolution,
- easier debugging.

### 24.2 Raw Archive Everything vs Curate Before Archive

Archive everything:

- maximum fidelity,
- useful for forensics,
- high storage and privacy risk.

Curate before archive:

- cleaner data,
- lower risk,
- easier analytics.

But:

- raw evidence might be lost,
- transform bug harder to recover.

Practical answer:

```text
Archive raw selectively with strict access + also archive curated data for broad analytics.
```

### 24.3 Kafka Retention vs Lake Retention

Long Kafka retention:

- replay easier,
- fewer systems.

But:

- broker storage cost,
- operational risk,
- not optimized for OLAP archive.

Lake retention:

- cheaper long-term,
- analytics-friendly.

But:

- replay path more complex,
- file/table semantics differ from Kafka offsets.

---

## 25. Anti-Patterns

### Anti-Pattern 1 — Kafka sebagai Data Warehouse

Gejala:

```text
Semua analytics query ingin langsung consume Kafka dari offset 0.
```

Masalah:

- Kafka bukan ad-hoc query engine,
- replay mahal,
- consumer lambat mengganggu platform,
- retention tidak cocok.

### Anti-Pattern 2 — Semua Topic Langsung ke Lake

Gejala:

```text
Mirror semua topic ke S3 tanpa klasifikasi.
```

Masalah:

- PII bocor,
- data kotor masuk lake,
- schema chaos,
- lineage tidak jelas,
- storage menjadi data swamp.

### Anti-Pattern 3 — Search Index sebagai Source of Truth

Gejala:

```text
Kalau butuh status case, baca Elasticsearch saja.
```

Masalah:

- index bisa stale,
- partial update bisa hilang,
- search schema bukan domain schema,
- audit sulit.

### Anti-Pattern 4 — Feature Pipeline Tanpa Event-Time Semantics

Gejala:

```text
Feature dihitung berdasarkan processing time karena lebih mudah.
```

Masalah:

- training-serving skew,
- late event salah,
- model leakage,
- audit ML sulit.

### Anti-Pattern 5 — Replay ke Production Topic Tanpa Isolation

Gejala:

```text
Set consumer offset ke awal dan publish ulang ke topic live.
```

Masalah:

- side effect terulang,
- notifikasi terkirim lagi,
- state mundur,
- analytics double count.

### Anti-Pattern 6 — Generic Analytics Event

Gejala:

```text
analytics.event
```

Payload:

```json
{"entity":"case","action":"update","data":{...}}
```

Masalah:

- semantics tidak jelas,
- schema governance lemah,
- downstream reverse-engineering,
- susah lineage,
- susah compatibility.

---

## 26. Checklist Desain Kafka Data Platform

Gunakan checklist ini saat review arsitektur.

### 26.1 Topic Layering

- [ ] Apakah raw, curated, enriched, dan serving topic dipisah jelas?
- [ ] Apakah setiap topic punya owner?
- [ ] Apakah setiap topic punya retention/cleanup policy?
- [ ] Apakah topic yang berisi PII diklasifikasikan?
- [ ] Apakah topic serving tidak memaksa semua sink memakai bentuk yang sama?

### 26.2 Sink Semantics

- [ ] Apakah sink idempotent?
- [ ] Apakah document/row/file key deterministic?
- [ ] Apakah late event bisa menimpa state baru?
- [ ] Apakah retry aman?
- [ ] Apakah partial failure terdeteksi?
- [ ] Apakah DLQ/quarantine tersedia?

### 26.3 Replay and Backfill

- [ ] Apakah replay dipisahkan dari live path?
- [ ] Apakah replay metadata disimpan?
- [ ] Apakah consumer bisa membedakan replay vs live jika perlu?
- [ ] Apakah sink bisa rebuild?
- [ ] Apakah raw archive tersedia?
- [ ] Apakah schema lama masih tersedia?

### 26.4 Data Quality

- [ ] Apakah validasi lebih dari sekadar schema?
- [ ] Apakah invalid record masuk quarantine?
- [ ] Apakah data quality violation menjadi event/metric?
- [ ] Apakah freshness diukur?
- [ ] Apakah completeness diukur?
- [ ] Apakah duplicate event dideteksi?

### 26.5 Governance

- [ ] Apakah topic catalog tersedia?
- [ ] Apakah lineage diketahui?
- [ ] Apakah field critical punya definisi bisnis?
- [ ] Apakah consumer impact bisa diketahui?
- [ ] Apakah deprecation policy ada?
- [ ] Apakah schema compatibility diuji di CI?

---

## 27. Latihan / Thought Exercises

### Latihan 1 — Desain Topic Layer

Kamu punya event berikut:

```text
case created
case assigned
case evidence uploaded
case escalated
case decision issued
case reopened
```

Buat layer topic:

```text
raw
validated
curated
enriched
search
warehouse
feature
audit
```

Tentukan:

- key topic,
- retention,
- schema owner,
- sink target,
- PII classification.

### Latihan 2 — Search Projection

Desain search document untuk case management.

Pertanyaan:

1. Apakah update memakai full replacement atau partial update?
2. Apa document ID?
3. Bagaimana mencegah late event overwrite?
4. Bagaimana rebuild index dari Kafka/lake?
5. Apa yang terjadi saat redaction event datang?

### Latihan 3 — Warehouse Fact Table

Desain `case_event_fact`.

Tentukan:

- primary/unique key,
- event_time vs ingestion_time,
- dimensions,
- measures,
- schema version,
- duplicate handling,
- late event handling.

### Latihan 4 — Feature Pipeline

Desain feature:

```text
case_escalation_count_last_30d_by_subject
```

Tentukan:

- event source,
- entity key,
- window semantics,
- event time,
- late event policy,
- online/offline consistency,
- point-in-time correctness.

### Latihan 5 — Replay Plan

Search index rusak karena mapping bug selama 3 hari.

Buat plan:

- source of replay,
- topic replay namespace,
- validation step,
- index rebuild strategy,
- blue/green cutover,
- idempotency,
- verification metric.

---

## 28. Ringkasan

Kafka dalam data platform bukan hanya “pipe” dari database ke data lake.

Kafka adalah backbone untuk:

- moving facts,
- validating streams,
- enriching events,
- building projections,
- driving analytics,
- updating search indexes,
- producing ML features,
- enabling replay and audit.

Tetapi Kafka bukan pengganti:

- object storage,
- lakehouse,
- warehouse,
- search engine,
- feature store,
- governance catalog.

Desain matang memisahkan:

```text
raw data
validated data
curated domain events
enriched streams
serving-specific projections
long-term analytical storage
```

Ingat invariant utama:

```text
Kafka carries immutable facts and derived streams.
Serving systems are projections.
Every projection must be rebuildable or explicitly authoritative.
Every sink must be idempotent.
Every replay must be controlled.
Every schema change must respect downstream meaning.
Every event used for analytics must preserve time, identity, and lineage.
```

Jika kamu memahami ini, kamu tidak hanya bisa “mengirim data ke Kafka”, tetapi bisa membangun streaming data platform yang defensible, recoverable, observable, dan scalable.

---

## 29. Koneksi ke Part Berikutnya

Part ini membahas Kafka sebagai bagian dari data platform.

Part berikutnya akan membahas sisi deployment dan operations:

```text
Part 030 — Deployment and Operations: Bare Metal, VM, Kubernetes, Cloud, and Managed Kafka
```

Kita akan masuk ke pertanyaan praktis:

- Kafka sebaiknya dijalankan di mana?
- Apa trade-off self-managed vs managed Kafka?
- Bagaimana listener, storage, availability zone, rack awareness, rolling restart, upgrade, backup myth, dan disaster recovery dipikirkan?
- Kapan Kubernetes cocok dan kapan berbahaya?
- Bagaimana menilai Confluent Cloud, MSK, Event Hubs, dan managed Kafka lain secara arsitektural?

---

## 30. Status Seri

```text
Progress: Part 000 sampai Part 029 selesai.
Sisa: Part 030 sampai Part 034.
Seri belum selesai.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-028.md">⬅️ Part 028 — Kafka for Regulatory and Case Management Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-030.md">Part 030 — Deployment and Operations: Bare Metal, VM, Kubernetes, Cloud, and Managed Kafka ➡️</a>
</div>
