# learn-kafka-event-streaming-mastery-for-java-engineers-part-033.md

# Part 033 — Advanced Design Review: Kafka Architecture Decision Records and Trade-Off Analysis

> Seri: Kafka Event Streaming Mastery for Java Engineers  
> Bagian: 033 dari 034  
> Status seri: belum selesai  
> Fokus: mengubah pengetahuan Kafka menjadi keputusan arsitektur yang defensible, eksplisit, bisa di-review, bisa diuji, dan bisa dioperasikan.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menulis **Architecture Decision Record** atau ADR untuk keputusan Kafka yang tidak dangkal.
2. Membedakan keputusan teknis kecil dari keputusan arsitektural yang berdampak panjang.
3. Menilai apakah Kafka memang dibutuhkan atau hanya dipakai karena trend.
4. Menentukan topic boundary, partitioning, schema, retention, delivery semantics, consumer model, dan deployment model dengan trade-off yang jelas.
5. Membuat review checklist untuk Kafka architecture sebelum masuk production.
6. Memasukkan failure modelling sebagai bagian wajib dari design review.
7. Menghubungkan keputusan Kafka dengan business invariant, auditability, operability, regulatory defensibility, dan cost.
8. Menghindari Kafka architecture yang terlihat modern tetapi rapuh secara semantik.

Part ini sengaja tidak banyak membahas API baru. Kita sudah membahas log, producer, consumer, partition, schema, Connect, CDC, ksqlDB, Kafka Streams, observability, performance, failure modelling, EDA, governance, deployment, dan multi-region. Sekarang pertanyaannya berubah:

> Bagaimana semua pengetahuan itu dipakai untuk membuat keputusan arsitektur yang bisa dipertanggungjawabkan?

Engineer menengah biasanya bisa menjawab:

```text
Bagaimana cara mengirim event ke Kafka?
```

Engineer senior harus bisa menjawab:

```text
Mengapa sistem ini membutuhkan Kafka?
Apa invariant yang harus dijaga?
Apa yang terjadi saat duplicate, late event, schema break, consumer lag, broker failover, atau regional failover?
Keputusan mana yang masih reversible dan mana yang mahal untuk diubah?
Bagaimana kita membuktikan bahwa desain ini aman untuk bisnis?
```

---

## 2. Mental Model Utama

### 2.1 ADR bukan dokumentasi setelah selesai

ADR bukan catatan kosmetik. ADR adalah **rekaman keputusan**.

ADR yang baik menjawab:

1. Apa masalah yang sedang diselesaikan?
2. Keputusan apa yang diambil?
3. Alternatif apa yang ditolak?
4. Mengapa alternatif itu ditolak?
5. Trade-off apa yang diterima?
6. Failure mode apa yang sudah dipertimbangkan?
7. Apa konsekuensi operasionalnya?
8. Bagaimana keputusan ini akan diuji dan dimonitor?
9. Kapan keputusan ini harus ditinjau ulang?

Kafka memperbesar nilai ADR karena banyak keputusan Kafka bersifat **sticky**:

- partition key sulit diganti tanpa migrasi,
- topic semantic sulit diperbaiki setelah banyak consumer bergantung,
- schema compatibility buruk akan merusak banyak tim,
- retention salah bisa menghilangkan kemampuan replay,
- consumer side effect tidak idempotent bisa merusak data eksternal,
- multi-region topology salah bisa menghasilkan duplicate, conflict, dan failover palsu.

### 2.2 Keputusan Kafka adalah keputusan kontrak, bukan hanya konfigurasi

Kafka architecture bukan kumpulan config. Kafka architecture adalah kumpulan kontrak.

Contoh:

```properties
acks=all
min.insync.replicas=2
replication.factor=3
```

Ini bukan sekadar config. Ini kontrak durability:

```text
Producer dianggap berhasil hanya jika record direplikasi ke cukup banyak in-sync replica.
Jika jumlah ISR turun di bawah threshold, write harus gagal daripada menerima write yang durability-nya lemah.
```

Contoh lain:

```text
Topic: enforcement.case.lifecycle.v1
Key: caseId
```

Ini bukan sekadar naming. Ini kontrak ordering:

```text
Semua event untuk satu case harus masuk ke partition yang sama agar consumer dapat membangun timeline case secara berurutan.
Throughput paralel terjadi antar-case, bukan di dalam satu case.
```

### 2.3 Top 1% Kafka engineer berpikir dengan invariant

Jangan mulai design review dari tool. Mulai dari invariant.

Invariant adalah kondisi yang harus tetap benar walau sistem gagal.

Contoh invariant Kafka:

```text
Untuk satu caseId, lifecycle event harus diproses sesuai urutan offset partition.
```

```text
Keputusan enforcement tidak boleh diterapkan dua kali walaupun consumer crash setelah side effect tetapi sebelum offset commit.
```

```text
Consumer baru harus bisa membangun ulang read model dari awal selama retention window compliance masih berlaku.
```

```text
Schema baru tidak boleh membuat consumer versi lama gagal membaca event yang masih ada di topic.
```

```text
DLQ tidak boleh menjadi kuburan event tanpa ownership dan replay procedure.
```

Jika invariant tidak ditulis, design review akan turun menjadi debat preferensi.

---

## 3. Kapan Keputusan Kafka Perlu ADR?

Tidak semua perubahan perlu ADR. Tetapi keputusan berikut hampir selalu perlu ADR:

1. Memperkenalkan Kafka sebagai dependency arsitektur baru.
2. Membuat topic publik antar domain/tim.
3. Menentukan partition key untuk event penting.
4. Menentukan retention policy untuk event yang perlu replay/audit.
5. Memilih Avro vs Protobuf vs JSON Schema.
6. Memilih compatibility mode.
7. Memilih Kafka Connect vs custom service.
8. Memilih CDC vs application-emitted domain event.
9. Memilih outbox pattern.
10. Memilih ksqlDB vs Kafka Streams vs Flink/Spark/custom consumer.
11. Memilih delivery semantics dan idempotency model.
12. Membuat compacted topic sebagai source of truth/reference state.
13. Membuat multi-region Kafka topology.
14. Menentukan managed Kafka vs self-managed.
15. Menentukan DLQ/retry/replay strategy.
16. Menentukan governance process untuk topic/schema/access.
17. Mengubah topic semantic yang sudah memiliki consumer eksternal.

Rule of thumb:

> Jika keputusan Kafka akan memengaruhi lebih dari satu service, lebih dari satu tim, replayability, ordering, durability, atau compliance, tulis ADR.

---

## 4. Struktur ADR Kafka yang Disarankan

Gunakan struktur berikut untuk keputusan Kafka yang serius.

```markdown
# ADR-XXX: <Judul Keputusan>

## Status
Proposed | Accepted | Superseded | Deprecated

## Date
YYYY-MM-DD

## Context
Masalah, domain, constraints, dan invariant bisnis.

## Decision
Keputusan yang diambil secara eksplisit.

## Alternatives Considered
Alternatif yang dievaluasi dan alasan ditolak.

## Kafka Design Details
Topic, key, partitioning, schema, retention, delivery semantics, ACL, consumer group, Connect/Streams/ksqlDB detail.

## Failure Modes
Duplicate, loss, reordering, lag, schema break, poison event, broker failure, consumer crash, regional failover.

## Operational Consequences
Monitoring, alert, runbook, ownership, SLO, capacity, cost.

## Security and Compliance
ACL, PII, retention, auditability, encryption, data residency.

## Migration and Rollout
Compatibility, backfill, dual-write period, feature flag, rollback.

## Validation Plan
Tests, chaos scenario, replay test, load test, schema compatibility test.

## Consequences
Benefits, risks, accepted trade-offs, known debt.

## Review Date / Reversal Trigger
Kapan keputusan ini harus dievaluasi ulang.
```

### 4.1 Bagian paling sering hilang: Failure Modes

ADR Kafka tanpa failure-mode section hampir selalu terlalu optimistis.

Minimal tanyakan:

1. Apa yang terjadi jika producer retry setelah timeout?
2. Apa yang terjadi jika broker menerima write tetapi producer tidak menerima ack?
3. Apa yang terjadi jika consumer crash setelah side effect tetapi sebelum offset commit?
4. Apa yang terjadi jika schema baru deploy sebelum consumer siap?
5. Apa yang terjadi jika satu partition menjadi hot?
6. Apa yang terjadi jika DLQ membesar?
7. Apa yang terjadi jika consumer tertinggal 6 jam?
8. Apa yang terjadi jika topic perlu di-replay dari awal?
9. Apa yang terjadi jika region primer down?
10. Apa yang terjadi jika event yang sudah diterbitkan ternyata salah secara bisnis?

---

## 5. Decision Framework: Should We Use Kafka?

Sebelum membahas partition atau schema, tanyakan dulu apakah Kafka memang tepat.

### 5.1 Kafka cocok ketika

Kafka masuk akal jika sistem membutuhkan beberapa karakteristik berikut:

1. Banyak consumer independen perlu membaca event yang sama.
2. Event perlu disimpan cukup lama untuk replay.
3. Producer dan consumer perlu dipisah secara waktu dan deployment.
4. Throughput event tinggi.
5. Ordering per key penting.
6. Data pipeline perlu menghubungkan operational dan analytical systems.
7. CDC/outbox dibutuhkan untuk menghindari dual-write.
8. Read model/projection perlu dibangun ulang.
9. Audit timeline perlu direkonstruksi.
10. Event-driven workflow lebih cocok daripada synchronous orchestration.

### 5.2 Kafka sering tidak cocok ketika

Kafka bukan solusi default untuk semua komunikasi service.

Kafka bisa berlebihan jika:

1. Hanya ada request-response sederhana.
2. Caller butuh immediate answer.
3. Volume rendah dan tidak perlu replay.
4. Tidak ada consumer independen.
5. Ordering/event history tidak penting.
6. Tim belum siap mengoperasikan schema, DLQ, lag, idempotency, dan observability.
7. Data sangat sensitif dan retention/replay justru menjadi liability.
8. Workflow membutuhkan strict synchronous transaction boundary lintas sistem.

### 5.3 Decision question

Gunakan pertanyaan ini:

```text
Jika Kafka dihapus dari desain ini, kemampuan apa yang benar-benar hilang?
```

Jawaban yang buruk:

```text
Agar sistem lebih scalable.
```

Jawaban yang lebih baik:

```text
Kita kehilangan kemampuan untuk membuat beberapa consumer independen membangun projection dari event lifecycle case yang sama, melakukan replay untuk audit reconstruction selama 7 tahun, dan menghindari coupling synchronous antara case service, notification service, SLA monitor, dan analytics pipeline.
```

---

## 6. Topic Boundary Decision

Topic boundary adalah salah satu keputusan paling penting.

### 6.1 Topic bukan table

Kesalahan umum:

```text
Satu table = satu topic.
```

Ini kadang benar untuk CDC raw stream, tetapi buruk untuk domain event.

Topic domain event harus menjawab:

1. Event ini tentang fakta bisnis apa?
2. Siapa pemilik event ini?
3. Consumer apa yang boleh bergantung pada event ini?
4. Apakah event ini public contract atau internal implementation detail?
5. Apakah event ini raw, curated, atau derived?

### 6.2 Contoh boundary buruk

```text
user-events
case-events
status-events
updates
entity-changes
```

Masalah:

- terlalu generik,
- semantic contract tidak jelas,
- sulit mengatur ownership,
- sulit menentukan retention,
- sulit menentukan schema evolution,
- consumer harus mengerti terlalu banyak variasi event.

### 6.3 Contoh boundary lebih baik

```text
enforcement.case.lifecycle.v1
enforcement.case.assignment.v1
enforcement.case.sla.v1
enforcement.evidence.ingested.v1
enforcement.decision.recorded.v1
```

Lebih baik karena:

- domain jelas,
- event family jelas,
- consumer expectation jelas,
- policy retention bisa berbeda,
- ownership bisa diberikan ke bounded context tertentu.

### 6.4 ADR questions untuk topic boundary

```text
Apakah topic ini public atau private?
Apakah topic ini raw, curated, atau derived?
Siapa producer authoritative?
Siapa consumer yang diketahui saat ini?
Apakah consumer masa depan boleh bergantung pada topic ini?
Apa event family yang masuk ke topic ini?
Apa event yang tidak boleh masuk?
Apa retention/compaction policy-nya?
Apa strategi deprecation?
```

---

## 7. Partitioning Decision

Partition key menentukan ordering, scaling, dan failure blast radius.

### 7.1 Mulai dari ordering domain

Jangan mulai dari throughput. Mulai dari ordering domain.

Pertanyaan:

```text
Event apa yang harus diproses berurutan relatif terhadap event lain?
```

Jika jawabannya:

```text
Semua event untuk satu case harus berurutan.
```

Maka key kandidat:

```text
caseId
```

Jika jawabannya:

```text
Semua transaksi untuk satu account harus berurutan.
```

Maka key kandidat:

```text
accountId
```

### 7.2 Partition key decision matrix

| Candidate Key | Ordering Guarantee | Parallelism | Hot Key Risk | Use Case |
|---|---|---:|---:|---|
| `caseId` | Semua event per case ordered | Tinggi jika banyak case | Rendah/sedang | Case lifecycle |
| `tenantId` | Semua event tenant ordered | Buruk jika tenant sedikit | Tinggi | Jarang cocok |
| `userId` | Semua event user ordered | Tinggi jika user banyak | Sedang | User activity |
| `entityType` | Lemah | Rendah | Tinggi | Biasanya buruk |
| null key | Tidak ada ordering per entity | Tinggi | Rendah | Fire-and-forget telemetry |

### 7.3 Hal yang harus ditulis di ADR

```text
Chosen partition key: caseId
Reason: case lifecycle projection membutuhkan ordering per case.
Rejected alternative: tenantId karena tenant besar dapat menciptakan hot partition dan ordering per tenant tidak diperlukan.
Rejected alternative: null key karena event untuk case yang sama bisa masuk partition berbeda dan timeline projection dapat salah.
Consequence: throughput satu case dibatasi satu partition, tetapi parallelism antar-case tetap tinggi.
```

### 7.4 Partition count sebagai keputusan jangka panjang

Partition count memengaruhi:

- max consumer parallelism,
- broker resource usage,
- file handle,
- metadata size,
- rebalance duration,
- recovery time,
- ordering saat partition count dinaikkan.

ADR harus menjawab:

```text
Berapa partition awal?
Berapa throughput target per partition?
Apakah key distribution cukup seimbang?
Apa rencana jika throughput naik 10x?
Apa dampak menaikkan partition count terhadap key-to-partition mapping?
```

---

## 8. Schema Decision

Schema adalah kontrak jangka panjang.

### 8.1 JSON string bukan strategi governance

Mengirim JSON bebas ke Kafka mungkin cepat di awal, tetapi biasanya mahal setelah banyak producer/consumer.

Risiko:

- tidak ada compatibility enforcement,
- typo field baru ketahuan di runtime,
- consumer gagal setelah event sudah published,
- tidak ada schema registry/catalog,
- sulit generate typed Java model,
- sulit audit perubahan kontrak.

### 8.2 Avro vs Protobuf vs JSON Schema

| Format | Kuat Untuk | Risiko / Trade-off |
|---|---|---|
| Avro | Kafka ecosystem, schema evolution, compact binary | Kurang natural untuk non-JVM jika tim belum familiar |
| Protobuf | Polyglot contract, gRPC ecosystem, typed contract | Evolution rules harus dipahami serius |
| JSON Schema | Human-readable, transisi dari JSON | Payload lebih besar, discipline tetap perlu |

### 8.3 Compatibility mode sebagai policy

Schema Registry dapat memvalidasi compatibility antar versi schema. Compatibility bukan detail tool; ini policy integrasi.

ADR harus menyatakan:

```text
Compatibility mode: BACKWARD_TRANSITIVE
Reason: consumer baru harus dapat membaca semua event lama dalam retention window.
Consequence: producer tidak boleh menghapus/merename field secara breaking tanpa versi topic baru.
```

Atau:

```text
Compatibility mode: FULL_TRANSITIVE
Reason: rolling upgrade producer dan consumer dilakukan independen, dan consumer lama maupun baru perlu membaca event lintas versi.
```

### 8.4 Schema ADR checklist

```text
Format apa yang dipilih?
Mengapa format itu cocok untuk producer/consumer landscape?
Subject naming strategy apa yang dipakai?
Compatibility mode apa yang dipakai?
Apakah compatibility transitive diperlukan?
Bagaimana field optional/default ditangani?
Bagaimana enum evolution ditangani?
Bagaimana PII diberi tanda?
Bagaimana breaking change dilakukan?
Apakah perlu topic versi baru?
```

---

## 9. Retention and Compaction Decision

Retention menentukan apakah Kafka hanya transport atau juga replay substrate.

### 9.1 Pertanyaan utama

```text
Berapa lama event harus dapat dibaca ulang?
```

Bukan:

```text
Berapa lama disk cukup?
```

Disk adalah constraint. Retention adalah kebutuhan domain/operasional.

### 9.2 Retention model

| Model | Cocok Untuk | Risiko |
|---|---|---|
| Time-based retention | Event stream historis terbatas | Replay hanya dalam window |
| Size-based retention | Membatasi disk | Retention time tidak stabil saat volume naik |
| Compact | Latest state per key | Tidak menyimpan semua history |
| Compact + delete | Latest state dalam window tertentu | Perlu pahami tombstone/delete retention |
| Long retention | Audit/replay kuat | Cost/storage/PII risk |

### 9.3 ADR example

```text
Topic enforcement.case.lifecycle.v1 menggunakan retention 7 tahun.
Reason: sistem harus mampu merekonstruksi timeline case untuk audit dan dispute handling.
Consequence: storage cost lebih tinggi, PII classification wajib, encryption/ACL ketat, dan delete/redaction strategy harus didefinisikan.
Rejected alternative: 30 hari karena tidak memenuhi kebutuhan audit regulatory.
```

### 9.4 Compaction decision

Compaction cocok untuk:

- reference data,
- latest status per entity,
- changelog topic,
- cache warmup,
- materialized view reconstruction.

Compaction tidak cocok jika:

- semua history harus disimpan,
- event adalah audit log,
- key tidak stabil,
- tombstone semantics tidak jelas,
- consumer membutuhkan setiap intermediate transition.

---

## 10. Delivery Semantics Decision

Delivery semantics bukan hanya config producer. Ini end-to-end behavior.

### 10.1 Pisahkan tiga level guarantee

```text
Kafka write guarantee
Kafka read/commit guarantee
External side-effect guarantee
```

Contoh:

```text
Producer idempotence + acks=all
```

Tidak otomatis membuat:

```text
Database sink exactly-once
```

### 10.2 Decision matrix

| Requirement | Kafka Strategy | Application Strategy |
|---|---|---|
| Duplicate acceptable | At-least-once | Idempotent handler optional |
| Duplicate harmful | At-least-once | Idempotency key wajib |
| Kafka-to-Kafka processing | Transactions / EOS | Consume-process-produce atomicity |
| Kafka-to-DB side effect | Manual commit after side effect | Idempotency table/inbox/upsert |
| Kafka-to-HTTP side effect | Retry with dedup key | Idempotent API contract |

### 10.3 ADR harus eksplisit tentang duplicate

Tulis seperti ini:

```text
This design assumes duplicate delivery is possible.
Consumers must deduplicate using eventId.
Side-effect tables must enforce uniqueness on eventId or commandId.
Offset commit happens only after durable side effect succeeds.
```

Jangan tulis:

```text
Kafka guarantees exactly once, so duplicates are not a concern.
```

Itu misleading.

---

## 11. Consumer Scaling Decision

Consumer scaling ditentukan oleh partition, processing cost, side-effect latency, dan ordering requirement.

### 11.1 Pertanyaan review

```text
Berapa consumer instance maksimum yang berguna?
Apakah jumlah partition cukup?
Apakah processing CPU-bound, I/O-bound, atau external-service-bound?
Apakah ordering per key membatasi concurrency?
Apakah consumer boleh parallel process records dalam satu partition?
Jika ya, bagaimana ordering dan commit dijaga?
```

### 11.2 Parallel processing di consumer

Default Kafka consumer poll loop memproses record secara sequential dalam aplikasi. Banyak tim mencoba mempercepat dengan thread pool.

Risiko:

- offset commit mendahului record yang belum selesai,
- ordering per partition rusak,
- crash menyebabkan gap recovery sulit,
- backpressure tidak terlihat,
- poison event bisa menahan offset lama.

ADR harus menjelaskan concurrency model:

```text
Consumer tidak melakukan parallel processing dalam partition karena ordering per case harus dijaga.
Scaling dilakukan dengan menambah partition dan consumer instance.
```

Atau:

```text
Consumer boleh parallel process record lintas key dengan per-key executor dan offset commit barrier.
Kompleksitas ini diterima karena processing eksternal lambat dan ordering hanya diperlukan per entityId.
```

---

## 12. Connect vs Custom Service Decision

Kafka Connect sangat baik untuk integrasi standar. Custom service baik untuk logic domain.

### 12.1 Kafka Connect cocok ketika

1. Source/sink adalah sistem umum: JDBC, S3, Elasticsearch, object storage, Debezium, search index.
2. Transformasi ringan cukup.
3. Tidak banyak branching domain logic.
4. Operasional task/offset/restart lebih penting daripada custom code.
5. Team ingin standardized integration runtime.

### 12.2 Custom service cocok ketika

1. Logic domain kompleks.
2. Perlu decisioning, enrichment, validation, atau workflow state.
3. Perlu idempotency khusus.
4. Perlu transactional side effect yang sangat spesifik.
5. Perlu observability domain-level yang tidak mudah dilakukan di Connect.

### 12.3 ADR example

```text
Decision: Use Debezium PostgreSQL connector + Outbox Event Router for case lifecycle publication.
Reason: event emission must be atomic with database transaction; custom dual-write producer would risk inconsistency.
Rejected alternative: application writes directly to Kafka after DB commit because crash between DB commit and Kafka publish can lose event.
Consequence: outbox table management, connector monitoring, and schema governance become operational responsibilities.
```

---

## 13. ksqlDB vs Kafka Streams vs Custom Consumer Decision

### 13.1 ksqlDB cocok untuk

- declarative stream/table transformations,
- simple to medium joins/aggregations,
- materialized views,
- SQL-oriented teams,
- fast iteration,
- operationally managed query runtime.

### 13.2 Kafka Streams cocok untuk

- Java-native stream processing,
- complex topology,
- embedded application logic,
- stronger testing with TopologyTestDriver,
- custom processors,
- stateful processing with app-level routing.

### 13.3 Custom consumer cocok untuk

- simple event handling,
- imperative side effect,
- integration with domain services,
- workflow transitions,
- external API calls,
- cases where stream-table abstraction is unnecessary.

### 13.4 Decision smell

Buruk:

```text
We use Kafka Streams because it is more powerful.
```

Lebih baik:

```text
We use Kafka Streams because SLA breach detection requires keyed state, event-time timers, testable topology, and custom handling for regulatory calendar exceptions that are difficult to express safely in ksqlDB.
```

---

## 14. CDC vs Application Event Decision

CDC dan domain event sering tertukar.

### 14.1 CDC raw stream

CDC raw stream merepresentasikan perubahan table.

Contoh:

```text
case_status table row changed from OPEN to ESCALATED
```

Kelebihan:

- capture dekat dengan database commit,
- baik untuk replication/integration,
- bisa menghindari polling,
- cocok untuk raw data pipeline.

Kekurangan:

- semantic domain sering tipis,
- table schema bocor ke consumer,
- perubahan internal database bisa breaking,
- tidak selalu menjelaskan mengapa perubahan terjadi.

### 14.2 Application domain event

Domain event merepresentasikan fakta bisnis.

Contoh:

```text
CaseEscalatedDueToSlaBreach
```

Kelebihan:

- semantic jelas,
- consumer tidak perlu tahu table internal,
- cocok untuk workflow/audit,
- event name membawa business meaning.

Kekurangan:

- perlu discipline aplikasi,
- berisiko dual-write jika tidak pakai outbox,
- perlu schema dan lifecycle event governance.

### 14.3 Hybrid terbaik: outbox

Outbox menggabungkan domain semantics dengan atomicity database transaction.

```text
Application writes business data + outbox event in one DB transaction.
CDC connector publishes outbox event to Kafka.
```

ADR harus menyebut:

- outbox table schema,
- event routing,
- deduplication key,
- connector ownership,
- retry and DLQ,
- ordering guarantee,
- replay behavior.

---

## 15. Single Cluster vs Multi-Cluster Decision

### 15.1 Single cluster cocok jika

- satu region cukup,
- RPO/RTO tidak menuntut regional failover,
- governance lebih sederhana,
- latency intra-region rendah,
- data residency tidak memaksa pemisahan.

### 15.2 Multi-cluster cocok jika

- DR regional wajib,
- data residency berbeda,
- organisasi besar butuh isolation,
- blast radius perlu dipisah,
- workload analytics dan operational perlu dipisah,
- migration/upgrade membutuhkan bridge.

### 15.3 Multi-region questions

```text
Apakah tujuannya DR, locality, migration, atau active-active?
Apakah consumer offset perlu diterjemahkan?
Apakah topic name sama atau diberi prefix region?
Bagaimana duplicate antar-region ditangani?
Bagaimana conflict ditangani jika dua region produce event untuk entity yang sama?
Apa RPO/RTO yang diuji, bukan hanya diklaim?
```

---

## 16. Managed vs Self-Hosted Decision

### 16.1 Managed Kafka mengurangi apa?

Managed Kafka biasanya mengurangi beban:

- provisioning broker,
- patching,
- broker replacement,
- control-plane operation,
- basic monitoring integration,
- availability infrastructure.

### 16.2 Managed Kafka tidak menghapus apa?

Managed Kafka tidak menghapus tanggung jawab aplikasi:

- topic design,
- partition key,
- schema compatibility,
- idempotent consumer,
- DLQ ownership,
- lag handling,
- retry strategy,
- event semantic,
- cost control,
- governance,
- data retention decision.

### 16.3 ADR harus jujur

Jangan tulis:

```text
Managed Kafka means no operational burden.
```

Tulis:

```text
Managed Kafka reduces broker lifecycle burden but application/platform teams remain responsible for topic governance, schema evolution, consumer lag, access control, event semantics, and cost attribution.
```

---

## 17. Cost-Risk-Performance Trade-off

Kafka decision review harus mengaitkan cost, risk, dan performance.

### 17.1 Contoh trade-off

| Decision | Benefit | Cost | Risk |
|---|---|---|---|
| Long retention | Replay/audit kuat | Storage tinggi | PII exposure lebih lama |
| More partitions | More parallelism | More metadata/resource overhead | Rebalance/ops complexity |
| `acks=all` | Durability lebih kuat | Latency lebih tinggi | Write unavailable saat ISR rendah |
| Compression zstd | Network/disk hemat | CPU lebih tinggi | Latency jika CPU bottleneck |
| EOS Kafka Streams | Atomic read-process-write | Complexity/overhead | Salah paham external side effect |
| Multi-region active-active | Local availability | Sangat kompleks | Conflict/duplicate/order issue |

### 17.2 Cost bukan hanya cloud bill

Kafka cost meliputi:

- broker storage,
- network egress,
- replication overhead,
- schema governance effort,
- consumer maintenance,
- DLQ handling,
- on-call burden,
- incident blast radius,
- migration cost,
- cognitive load antar tim.

---

## 18. Failure-Mode Section Template

Gunakan template ini di setiap ADR Kafka serius.

```markdown
## Failure Modes

### Producer duplicate
Cause: retry after timeout or unknown ack.
Mitigation: idempotent producer; eventId; consumer deduplication.

### Consumer duplicate side effect
Cause: crash after side effect before offset commit.
Mitigation: idempotency table keyed by eventId; commit after side effect.

### Reordering
Cause: wrong partition key, partition count change, parallel processing inside partition.
Mitigation: key by caseId; no intra-partition parallelism; migration plan for partition changes.

### Data loss
Cause: insufficient replication/acks/min ISR, unclean leader election, retention too short.
Mitigation: replication.factor=3, min.insync.replicas=2, acks=all, unclean leader election disabled, retention aligned to replay requirement.

### Schema break
Cause: incompatible schema published.
Mitigation: Schema Registry compatibility, CI schema check, contract test.

### Poison event
Cause: semantically invalid but schema-valid event.
Mitigation: validation, retry budget, DLQ with ownership, replay procedure.

### Lag explosion
Cause: downstream outage, hot partition, slow consumer, large replay.
Mitigation: lag alert, pause/resume, autoscaling within partition limit, backpressure, capacity buffer.

### Regional failover
Cause: primary region unavailable.
Mitigation: tested failover runbook, offset translation validation, duplicate-safe consumers.
```

---

## 19. Example ADR 1: Enforcement Lifecycle Events

```markdown
# ADR-033-01: Publish Enforcement Case Lifecycle Events via Kafka

## Status
Accepted

## Context
The enforcement platform needs to expose case lifecycle transitions to downstream systems:

- SLA monitoring
- assignment workload analytics
- notification service
- audit timeline projection
- regulatory reporting
- case search indexing

The core business invariant is:

> For a given caseId, lifecycle transitions must be reconstructable in order for the full compliance retention period.

Synchronous integration would couple the case service to multiple downstream systems and would make audit replay difficult.

## Decision
Publish case lifecycle domain events to Kafka topic:

```text
enforcement.case.lifecycle.v1
```

Partition key:

```text
caseId
```

Schema format:

```text
Avro with Schema Registry
```

Compatibility:

```text
BACKWARD_TRANSITIVE
```

Retention:

```text
7 years
```

Delivery semantics:

```text
At-least-once delivery with consumer idempotency required.
```

## Alternatives Considered

### REST callbacks to each downstream system
Rejected because downstream coupling would increase latency, failure propagation, and deployment coordination.

### Shared database read access
Rejected because it leaks internal case service persistence model and does not provide immutable event history.

### Generic case-updated topic
Rejected because it lacks business semantics and forces consumers to infer lifecycle meaning from generic payload diffs.

## Kafka Design Details

Topic:

```text
enforcement.case.lifecycle.v1
```

Events:

```text
CaseOpened
CaseAssigned
CaseEscalated
CaseSuspended
CaseDecisionRecorded
CaseClosed
CaseReopened
```

Envelope fields:

```text
eventId
caseId
eventType
eventVersion
occurredAt
publishedAt
correlationId
causationId
tenantId
actorType
actorId
sourceSystem
```

Partitioning:

```text
key = caseId
```

Reason:

```text
Timeline reconstruction requires per-case ordering.
```

## Failure Modes

### Duplicate event delivery
Consumers must deduplicate by eventId.

### Consumer crash after side effect
Consumers that write to DB/search/notification tables must use idempotency keys.

### Schema evolution
Breaking changes require new topic version.

### Incorrect event
Correction must be emitted as a new event. Historical event mutation is forbidden.

### Hot case
A single high-activity case may be bounded by one partition throughput. Accepted because per-case ordering is more important than intra-case parallelism.

## Operational Consequences

Alerts:

- consumer lag by group
- lag time for audit projection
- DLQ count
- schema compatibility failure
- topic storage growth

Runbooks:

- replay audit projection
- replay DLQ
- pause consumer during downstream outage
- schema rollback

## Security and Compliance

- Topic contains regulatory case data.
- ACL limited to approved producer/consumer principals.
- PII fields must be classified in schema documentation.
- Retention is 7 years.
- Redaction requires separate correction/redaction event, not physical mutation of existing event except where legal deletion process requires platform-level handling.

## Validation Plan

- Schema compatibility test in CI.
- Replay test from earliest offset into empty projection DB.
- Duplicate event test.
- Consumer crash after side-effect test.
- Lag recovery test.
- Poison event DLQ test.

## Consequences

Benefits:

- downstream decoupling
- audit replay
- consistent lifecycle event contract
- scalable consumer onboarding

Costs:

- schema governance required
- storage cost for long retention
- idempotent consumer discipline required
- event correction process required
```

---

## 20. Example ADR 2: CDC Outbox Integration

```markdown
# ADR-033-02: Use Transactional Outbox for Case Event Publication

## Status
Accepted

## Context
The case service uses a relational database as its transactional system of record. We need to publish domain events to Kafka without losing events or creating inconsistent state.

The failure to avoid:

```text
DB commit succeeds, Kafka publish fails, downstream systems never observe the state transition.
```

## Decision
Use transactional outbox:

1. Case service writes domain state and outbox row in the same database transaction.
2. Debezium captures outbox table changes.
3. Outbox Event Router routes records to Kafka domain topics.
4. Consumers process event idempotently.

## Alternatives Considered

### Publish directly to Kafka after DB commit
Rejected because crash between DB commit and Kafka publish loses event.

### Publish to Kafka before DB commit
Rejected because Kafka event may be visible for a database transaction that later rolls back.

### Poll domain tables periodically
Rejected because it is less precise, often misses semantic event meaning, and creates unnecessary DB load.

## Kafka Design Details

Outbox table fields:

```text
id
aggregate_type
aggregate_id
event_type
payload
schema_version
occurred_at
correlation_id
causation_id
```

Routing:

```text
aggregate_type + event_type -> target topic
aggregate_id -> Kafka key
```

## Failure Modes

### Debezium connector down
Outbox rows accumulate; alert on connector status and outbox age.

### Duplicate publish
Consumers deduplicate using eventId.

### Bad payload
Event routed to DLQ; owning team must fix or replay.

### Schema break
CI compatibility test and Schema Registry compatibility enforcement.

## Operational Consequences

- Connector is production-critical.
- Outbox table growth must be monitored.
- Connector offset topics are critical state.
- DLQ ownership belongs to producing domain team.

## Validation Plan

- Kill app after DB commit simulation.
- Kill connector and verify catch-up.
- Duplicate event test.
- Schema compatibility test.
- Replay from outbox topic into clean consumer.
```

---

## 21. Example ADR 3: ksqlDB vs Kafka Streams for SLA Breach Detection

```markdown
# ADR-033-03: Use Kafka Streams for SLA Breach Detection

## Status
Accepted

## Context
The regulatory case platform must detect SLA breach based on:

- case opened time
- assignment state
- suspension intervals
- jurisdiction-specific business calendar
- priority level
- manual extension events
- closure events

The logic is stateful, event-time dependent, and requires detailed test coverage.

## Decision
Use Kafka Streams application written in Java.

Input topics:

```text
enforcement.case.lifecycle.v1
enforcement.case.assignment.v1
enforcement.case.sla-policy.v1
```

Output topics:

```text
enforcement.case.sla-breach.v1
enforcement.case.sla-state.v1
```

State stores:

```text
case-sla-state-store
jurisdiction-calendar-store
```

## Alternatives Considered

### ksqlDB
Rejected because jurisdiction calendar and extension logic require custom Java logic and deterministic unit tests beyond simple SQL transformations.

### Batch job
Rejected because SLA breach detection must happen near-real-time.

### Custom consumer without Kafka Streams
Rejected because state restoration, changelog, partition-task mapping, and topology testing would need to be rebuilt manually.

## Failure Modes

### Late event
Use event-time timestamp extractor and grace period. Late events beyond grace are routed to semantic review DLQ.

### State restoration storm
Use standby replicas and monitor restore time.

### Duplicate breach event
Output event includes deterministic breachId derived from caseId + slaPolicyVersion + breachType.

### Wrong calendar version
Calendar events are versioned and effective-dated.

## Validation Plan

- TopologyTestDriver unit tests.
- Event-time tests.
- Late event tests.
- Rebalance/restart state restore tests.
- Replay full lifecycle topic into empty state directory.
```

---

## 22. Review Checklist for Kafka ADR

Use checklist ini sebelum menerima desain Kafka.

### 22.1 Business and semantic checklist

```text
[ ] Masalah bisnis jelas.
[ ] Kafka capability yang dibutuhkan eksplisit.
[ ] Event adalah fakta, bukan command ambigu.
[ ] Owner topic jelas.
[ ] Consumer contract jelas.
[ ] Public/private topic boundary jelas.
[ ] Correction strategy jelas.
```

### 22.2 Topic and partition checklist

```text
[ ] Topic name mengikuti convention.
[ ] Topic boundary tidak terlalu generik.
[ ] Partition key dipilih berdasarkan ordering domain.
[ ] Hot key risk dianalisis.
[ ] Partition count awal dijelaskan.
[ ] Rencana growth dijelaskan.
[ ] Dampak menaikkan partition count dipahami.
```

### 22.3 Schema checklist

```text
[ ] Serialization format dipilih dan dijustifikasi.
[ ] Schema Registry/compatibility enforcement digunakan.
[ ] Compatibility mode dijelaskan.
[ ] Breaking change strategy dijelaskan.
[ ] Field optional/default rules jelas.
[ ] PII classification jelas.
```

### 22.4 Delivery and processing checklist

```text
[ ] Delivery semantics tidak dilebih-lebihkan.
[ ] Duplicate handling eksplisit.
[ ] Idempotency key jelas.
[ ] Offset commit strategy jelas.
[ ] External side effect semantics jelas.
[ ] Retry dan DLQ strategy jelas.
[ ] Replay procedure jelas.
```

### 22.5 Operations checklist

```text
[ ] Consumer lag alert jelas.
[ ] DLQ alert dan owner jelas.
[ ] Broker/topic metrics jelas.
[ ] Runbook tersedia.
[ ] Capacity estimate tersedia.
[ ] Load test plan tersedia.
[ ] Failure injection scenario tersedia.
```

### 22.6 Security and compliance checklist

```text
[ ] ACL producer/consumer jelas.
[ ] Data classification jelas.
[ ] Retention sesuai policy.
[ ] Encryption requirement jelas.
[ ] Audit requirement jelas.
[ ] Data residency dipertimbangkan.
[ ] Redaction/deletion procedure dijelaskan.
```

---

## 23. Design Smells

Waspadai tanda-tanda ini:

### 23.1 “Kafka karena scalable”

Scalability terlalu umum. Harus dijelaskan:

```text
Scalable dalam dimensi apa?
Producer throughput?
Consumer parallelism?
Fan-out consumer?
Replay?
Decoupling deployment?
Data integration?
```

### 23.2 “Exactly once jadi tidak perlu idempotency”

Ini hampir selalu salah untuk external side effect.

Kafka EOS membantu Kafka-to-Kafka read-process-write. Jika consumer memanggil database/API eksternal, idempotency tetap harus dipikirkan.

### 23.3 “Satu topic untuk semua event”

Biasanya menghasilkan:

- schema union kacau,
- consumer filtering berlebihan,
- retention tidak cocok untuk semua event,
- ownership tidak jelas,
- DLQ tidak jelas.

### 23.4 “DLQ menyelesaikan poison event”

DLQ hanya memindahkan masalah. Tanpa owner dan replay procedure, DLQ adalah kuburan.

### 23.5 “Retention default cukup”

Retention harus berasal dari kebutuhan replay/audit/recovery, bukan default platform.

### 23.6 “Consumer bisa discale tanpa batas”

Consumer group parallelism dibatasi partition count. Side-effect system juga bisa menjadi bottleneck.

### 23.7 “Multi-region active-active untuk availability”

Active-active sering menciptakan problem conflict, duplicate, ordering, dan failback. Jangan gunakan tanpa invariant dan conflict model yang kuat.

---

## 24. Production Readiness Review Template

Sebelum go-live Kafka architecture, review ini harus bisa dijawab.

```markdown
# Kafka Production Readiness Review

## Domain
- Domain owner:
- Service owner:
- Topic owner:
- Data classification:

## Topics
| Topic | Purpose | Key | Partitions | Retention | Cleanup | Owner |
|---|---|---|---:|---|---|---|

## Schemas
| Subject | Format | Compatibility | Owner | Breaking Change Process |
|---|---|---|---|---|

## Producers
| Producer | Topic | Acks | Idempotence | Transactional | Error Handling |
|---|---|---|---|---|---|

## Consumers
| Consumer Group | Topic | Commit Strategy | Idempotency | DLQ | Replay Safe |
|---|---|---|---|---|---|

## Failure Modes
| Failure | Expected Behavior | Mitigation | Test Evidence |
|---|---|---|---|

## Observability
| Signal | Metric | Alert Threshold | Owner | Runbook |
|---|---|---|---|---|

## Security
| Principal | Permission | Resource | Justification |
|---|---|---|---|

## Rollout
- Backfill needed?
- Dual-run needed?
- Rollback plan?
- Schema compatibility verified?
- Load test completed?
- Replay test completed?
```

---

## 25. Thought Exercises

### Exercise 1 — Topic boundary

Kamu membangun sistem regulatory case. Ada event:

- case opened,
- case assigned,
- evidence uploaded,
- SLA breached,
- decision recorded,
- notification sent.

Pertanyaan:

```text
Apakah semua event ini masuk satu topic atau beberapa topic?
Apa boundary-nya?
Apa retention masing-masing?
Apa partition key masing-masing?
```

Jawaban matang biasanya memisahkan event berdasarkan semantic family dan retention need, bukan sekadar memasukkan semua ke `case-events`.

### Exercise 2 — Exactly-once claim

Sebuah tim menulis ADR:

```text
We use Kafka transactions, therefore our email notification consumer is exactly-once.
```

Review:

```text
Apa yang salah?
Apa yang harus ditambahkan?
```

Hint:

```text
Email adalah external side effect. Kafka transaction tidak bisa rollback email yang sudah terkirim.
```

### Exercise 3 — Partition key review

Tim memilih `tenantId` sebagai key untuk semua event.

Pertanyaan:

```text
Apa ordering yang mereka dapat?
Apa parallelism yang hilang?
Apa hot partition risk?
Apa key alternatif?
```

### Exercise 4 — CDC vs domain event

Tim ingin expose perubahan table `case_status_history` langsung ke semua consumer.

Pertanyaan:

```text
Apakah ini raw CDC, integration event, atau domain event?
Apa risiko membiarkan consumer bergantung pada table internal?
Apakah outbox lebih cocok?
```

### Exercise 5 — Retention conflict

Security team ingin retention 7 hari untuk mengurangi PII exposure. Audit team ingin replay 7 tahun.

Pertanyaan:

```text
Apa opsi desain?
Apakah semua field harus berada di event yang long-retention?
Apakah bisa pisahkan PII reference dari audit fact?
Apakah tokenization/redaction/event minimization diperlukan?
```

---

## 26. Ringkasan

Kafka architecture review bukan hanya bertanya:

```text
Apakah producer dan consumer bisa jalan?
```

Pertanyaan yang benar:

```text
Apakah desain ini menjaga invariant bisnis saat duplicate, crash, lag, schema evolution, replay, dan failover terjadi?
```

Poin utama:

1. Kafka decision harus ditulis sebagai kontrak, bukan hanya config.
2. ADR diperlukan untuk keputusan yang memengaruhi topic, schema, partitioning, retention, delivery, CDC, stream processing, multi-region, dan governance.
3. Mulai dari invariant: ordering, durability, idempotency, replayability, auditability, privacy, dan operability.
4. Topic boundary menentukan semantic contract antar tim.
5. Partition key menentukan ordering domain dan scaling model.
6. Schema compatibility adalah governance mechanism, bukan formalitas.
7. Retention menentukan kemampuan replay dan audit.
8. Exactly-once harus dibatasi maknanya; external side effect tetap butuh idempotency.
9. Kafka Connect, ksqlDB, Kafka Streams, dan custom consumer harus dipilih berdasarkan shape masalah, bukan preferensi tool.
10. Multi-region adalah keputusan consistency, bukan hanya availability.
11. Failure-mode section wajib ada di ADR Kafka yang serius.
12. Production readiness harus menyertakan observability, runbook, replay test, load test, security, dan ownership.

---

## 27. Status Seri

Progress saat ini:

```text
Part 000 sampai Part 033 selesai.
```

Seri belum selesai.

Part berikutnya adalah bagian terakhir:

```text
learn-kafka-event-streaming-mastery-for-java-engineers-part-034.md
```

Judul:

```text
Capstone: Build a Production-Grade Kafka-Based Enforcement Lifecycle Platform
```

Di Part 034, semua konsep akan disatukan menjadi desain end-to-end production-grade untuk enforcement lifecycle platform berbasis Kafka.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-032.md">⬅️ Part 032 — Governance, Platform Engineering, and Team Operating Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-034.md">Part 034 — Capstone: Build a Production-Grade Kafka-Based Enforcement Lifecycle Platform ➡️</a>
</div>
