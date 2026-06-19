# learn-kafka-event-streaming-mastery-for-java-engineers-part-015.md

# Part 015 — Kafka Connect in Production: Scaling, Failure, DLQ, Offset, and Operational Control

> Seri: Kafka, Kafka ksqlDB, Kafka Connect, dan Event Streaming Mastery untuk Java Software Engineer  
> Part: 015 dari 034  
> Status seri: belum selesai  
> Fokus: menjalankan Kafka Connect sebagai runtime produksi yang reliable, observable, recoverable, dan governable

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami Kafka Connect bukan sebagai “plugin runner”, tetapi sebagai **distributed integration runtime**.
2. Menjelaskan bagaimana worker, connector, dan task diskalakan dalam mode produksi.
3. Memahami failure mode Kafka Connect: task failed, connector stuck, worker mati, sink lambat, schema error, poison record, credential expired, dan offset corrupt secara praktis.
4. Mendesain konfigurasi error handling, retry, tolerance, dan dead letter queue secara aman.
5. Mengerti konsekuensi offset source dan sink connector.
6. Memahami bagaimana Kafka Connect melakukan rebalancing ketika worker bergabung/keluar.
7. Menentukan kapan perlu scale task, worker, topic partition, atau downstream sink.
8. Membuat operational control plane: pause, resume, restart, rolling upgrade, inspect status, dan recovery.
9. Menyusun runbook production untuk incident Kafka Connect.
10. Menghindari anti-pattern Kafka Connect yang sering muncul di sistem enterprise.

---

## 2. Mental Model Utama

Kafka Connect di production harus dipahami sebagai:

```text
Kafka Connect = distributed runtime untuk memindahkan data antar sistem
                dengan task parallelism,
                offset tracking,
                converter,
                transform,
                retry/error handling,
                dan lifecycle control.
```

Bukan:

```text
Kafka Connect = library sederhana untuk copy data dari A ke B
```

atau:

```text
Kafka Connect = magic ETL yang otomatis benar
```

Kafka Connect tetap tunduk pada hukum dasar distributed systems:

1. Source bisa mengirim duplicate.
2. Sink bisa menerima duplicate.
3. Worker bisa mati kapan saja.
4. Downstream bisa throttling.
5. Schema bisa berubah.
6. Credentials bisa expire.
7. Rebalance bisa terjadi saat load tinggi.
8. Offset bisa tertinggal, maju, atau tidak sesuai ekspektasi operasional.
9. Error yang diabaikan bukan berarti hilang; biasanya hanya berpindah ke tempat lain.

Kafka Connect production mastery adalah kemampuan menjawab pertanyaan ini:

> Jika connector ini berhenti, lambat, duplicate, atau salah memproses data, bagaimana kita tahu, bagaimana kita membatasi dampak, bagaimana kita recover, dan bagaimana kita membuktikan data pipeline tetap benar?

---

## 3. Recap dari Part 014

Di Part 014 kita sudah membahas building block Kafka Connect:

| Komponen | Makna |
|---|---|
| Source Connector | Membaca dari sistem eksternal lalu menulis ke Kafka |
| Sink Connector | Membaca dari Kafka lalu menulis ke sistem eksternal |
| Worker | JVM process yang menjalankan connector dan task |
| Task | Unit paralelisme aktual |
| Converter | Mengubah data antara Kafka Connect internal data model dan bytes Kafka |
| SMT | Single Message Transform untuk transformasi ringan per record |
| Internal Topics | Topic untuk config, offset, dan status Connect |
| REST API | Control plane untuk membuat, update, pause, resume, restart connector |

Part 015 mengambil semua konsep itu dan membahasnya dari sisi production.

---

## 4. Kafka Connect Production Architecture

### 4.1 Mode production: distributed mode

Di production, Kafka Connect biasanya dijalankan dalam **distributed mode**.

Dalam mode ini:

1. Ada beberapa worker process.
2. Semua worker memakai `group.id` yang sama.
3. Connector dan task didistribusikan ke worker.
4. Jika worker mati, task akan dipindahkan ke worker lain.
5. Config, offset, dan status disimpan di Kafka internal topics.

Mental model:

```text
              +-------------------+
              | Kafka Connect     |
              | REST API          |
              +---------+---------+
                        |
      +-----------------+-----------------+
      |                 |                 |
+-----v-----+     +-----v-----+     +-----v-----+
| Worker A  |     | Worker B  |     | Worker C  |
| tasks     |     | tasks     |     | tasks     |
+-----+-----+     +-----+-----+     +-----+-----+
      |                 |                 |
      +-----------------+-----------------+
                        |
                 +------v------+
                 | Kafka       |
                 | internal    |
                 | topics      |
                 +-------------+
```

Kafka Connect distributed mode bukan active-passive. Semua worker bisa aktif menjalankan task.

---

### 4.2 Internal topics adalah state store Connect

Distributed Connect bergantung pada beberapa internal topics:

| Topic | Fungsi |
|---|---|
| Config topic | Menyimpan konfigurasi connector dan task |
| Offset topic | Menyimpan offset source connector |
| Status topic | Menyimpan status connector dan task |

Contoh konfigurasi worker:

```properties
bootstrap.servers=kafka-1:9092,kafka-2:9092,kafka-3:9092

group.id=connect-prod

config.storage.topic=connect-prod-configs
offset.storage.topic=connect-prod-offsets
status.storage.topic=connect-prod-status

config.storage.replication.factor=3
offset.storage.replication.factor=3
status.storage.replication.factor=3
```

Aturan production:

```text
Internal topics Connect harus dianggap critical state.
Jangan treat sebagai disposable topic.
```

Jika internal topics rusak, hilang, salah retention, atau salah replication factor, Connect cluster bisa kehilangan state.

---

### 4.3 Internal topics harus compacted

Config, offset, dan status topic menyimpan latest value berdasarkan key. Karena itu internal topics Connect lazim memakai cleanup policy compaction.

Contoh ideal:

```text
connect-prod-configs   cleanup.policy=compact
connect-prod-offsets   cleanup.policy=compact
connect-prod-status    cleanup.policy=compact
```

Risiko jika retention salah:

| Salah konfigurasi | Dampak |
|---|---|
| Offset topic terhapus karena delete retention pendek | Source connector bisa re-read dari awal atau gagal menentukan posisi |
| Config topic hilang | Connector definitions hilang |
| Status topic hilang | Observability status terganggu |
| Replication factor 1 | Worker state rentan hilang jika broker/disk gagal |

---

## 5. Worker, Connector, dan Task Scaling

### 5.1 Apa yang sebenarnya diskalakan?

Di Kafka Connect ada beberapa level scaling:

```text
Scale worker   = menambah JVM process Connect
Scale task     = menambah parallel execution unit connector
Scale topic    = menambah Kafka partition
Scale sink     = menambah kapasitas downstream
Scale source   = menambah kapasitas sistem sumber
```

Kesalahan umum:

```text
Menambah worker tidak otomatis menaikkan throughput jika tasks.max tetap 1.
```

Atau:

```text
Menambah tasks.max tidak membantu jika topic source hanya punya 1 partition untuk sink connector.
```

---

### 5.2 `tasks.max`

`tasks.max` adalah batas maksimum task yang boleh dibuat connector.

Contoh:

```json
{
  "name": "orders-jdbc-sink",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSinkConnector",
    "topics": "orders.events.v1",
    "tasks.max": "4",
    "connection.url": "jdbc:postgresql://db/orders",
    "insert.mode": "upsert",
    "pk.mode": "record_key",
    "pk.fields": "order_id"
  }
}
```

Tapi `tasks.max=4` hanya berarti:

```text
Connector boleh membuat sampai 4 task.
```

Bukan berarti pasti ada 4 task efektif.

Jumlah task aktual tergantung connector implementation dan input/output constraints.

---

### 5.3 Scaling sink connector

Sink connector membaca dari Kafka topic.

Batas paralelisme utama:

```text
effective sink parallelism <= jumlah partition topic yang dibaca
```

Contoh:

```text
Topic orders.events.v1 punya 3 partition
Sink connector tasks.max=10
```

Hasil realistis:

```text
Maksimal 3 task aktif efektif membaca partition.
```

Karena satu partition dalam consumer group hanya bisa dimiliki satu task pada satu waktu.

---

### 5.4 Scaling source connector

Source connector membaca dari sistem eksternal.

Batas paralelisme tergantung connector:

| Source | Faktor paralelisme |
|---|---|
| JDBC source polling table | Jumlah table/query, mode connector, partitioning query |
| Debezium CDC | Biasanya stream database log berurutan; paralelisme terbatas oleh log source |
| S3/object source | Jumlah file/object yang bisa dibagi ke task |
| HTTP/API source | Rate limit API, pagination, connector support |
| MQTT source | Topic subscription dan protocol behavior |

Tidak semua source bisa diskalakan hanya dengan `tasks.max`.

---

### 5.5 Worker count vs task count

Misal:

```text
Worker count = 3
Total connector tasks = 12
```

Connect akan mencoba mendistribusikan task ke worker.

Contoh assignment:

```text
Worker A: 4 tasks
Worker B: 4 tasks
Worker C: 4 tasks
```

Jika Worker C mati:

```text
Worker A: 6 tasks
Worker B: 6 tasks
```

Throughput mungkin turun atau latency naik karena resource per worker lebih padat.

Production implication:

```text
Jangan hanya sizing untuk normal condition.
Sizing juga harus mempertimbangkan N-1 failure.
```

---

## 6. Connect Rebalancing

### 6.1 Mengapa Connect rebalance?

Connect cluster akan rebalance saat:

1. Worker baru bergabung.
2. Worker keluar/mati.
3. Connector dibuat.
4. Connector dihapus.
5. Connector config berubah.
6. Task config berubah.
7. Worker restart.

Rebalance berarti ownership connector/task dihitung ulang.

---

### 6.2 Eager vs incremental cooperative rebalance

Secara historis, banyak runtime distributed melakukan eager rebalance:

```text
Semua task stop -> assignment ulang -> semua task start lagi
```

Masalahnya:

```text
Stop-the-world effect.
```

Incremental cooperative rebalance bertujuan mengurangi gangguan dengan memindahkan hanya task yang perlu dipindah.

Mental model:

```text
Eager rebalance:
  everyone stops, then everyone gets new work

Cooperative rebalance:
  only necessary tasks are revoked/transferred gradually
```

Operational implication:

```text
Rolling restart Connect cluster jauh lebih aman jika rebalance tidak selalu menghentikan semua task.
```

Tetap saja, cooperative rebalance bukan berarti tidak ada impact. Task tertentu tetap bisa restart, sink transaction bisa terganggu, dan source connector tertentu bisa mengalami pause.

---

### 6.3 Delayed rebalance

Connect dapat menunda rebalance saat worker hilang sementara.

Tujuannya:

```text
Jika worker restart cepat, jangan langsung pindahkan semua task.
```

Ini berguna untuk rolling restart atau transient failure.

Tapi trade-off-nya:

| Setting terlalu pendek | Setting terlalu panjang |
|---|---|
| Task cepat dipindah, tapi restart singkat bisa memicu churn | Task di worker mati bisa idle lebih lama sebelum dipindahkan |

Runbook harus jelas:

```text
Apakah kita lebih butuh fast failover atau rebalance stability?
```

---

## 7. Offset Semantics dalam Kafka Connect

Offset adalah salah satu area paling berbahaya karena source dan sink connector punya makna offset yang berbeda.

---

### 7.1 Sink connector offset

Sink connector adalah consumer Kafka.

Offset-nya adalah offset Kafka topic yang sudah dibaca/diproses.

Skenario:

```text
Kafka topic -> sink connector -> external database
```

Pertanyaan penting:

```text
Kapan offset Kafka dicommit?
```

Jika offset dicommit sebelum data aman tertulis ke sink:

```text
Risk: data loss at sink
```

Jika offset dicommit setelah data tertulis ke sink:

```text
Risk: duplicate write jika crash sebelum commit
```

Karena itu sink connector production harus didesain dengan asumsi:

```text
Duplicate delivery ke sink mungkin terjadi.
```

Solusi:

1. Upsert dengan primary key stabil.
2. Idempotent write.
3. Natural deduplication di sink.
4. Transactional sink jika connector dan sink mendukung.
5. External idempotency key.

---

### 7.2 Source connector offset

Source connector offset bukan Kafka consumer offset. Ini posisi baca di sistem eksternal.

Contoh:

| Source | Offset mungkin berupa |
|---|---|
| JDBC incrementing | Last seen incrementing id |
| JDBC timestamp | Last timestamp |
| Debezium MySQL | Binlog file + position atau GTID |
| Debezium PostgreSQL | LSN |
| File source | File path + byte position |
| S3 source | Object key + position |

Offset source disimpan di Connect offset internal topic.

Mental model:

```text
Source offset = bukti posisi terakhir membaca sistem eksternal
```

Bukan:

```text
Source offset = offset Kafka topic output
```

---

### 7.3 Source connector failure window

Source connector melakukan dua hal:

```text
1. Read from source
2. Produce to Kafka
3. Store source offset
```

Jika crash terjadi di antara langkah tersebut, duplicate atau gap bisa muncul tergantung connector semantics.

Ideal source connector production harus:

1. Tidak advance offset sebelum record aman diproduce ke Kafka.
2. Mampu retry produce.
3. Menghasilkan key stabil agar duplicate bisa dikenali downstream.
4. Memiliki source offset yang benar-benar merepresentasikan posisi durable.

---

### 7.4 Offset reset adalah tindakan berisiko

Mengubah offset Connect bukan operasi ringan.

Contoh risiko:

| Tindakan | Risiko |
|---|---|
| Reset source offset ke awal | Re-ingest data besar, duplicate, overload downstream |
| Skip offset maju | Data hilang dari pipeline |
| Delete offset internal topic | Connector kehilangan posisi |
| Mengganti connector name | Connector bisa memakai offset namespace baru |
| Mengubah key fields | Sink idempotency rusak |

Prinsip:

```text
Offset operation harus dianggap production migration, bukan debugging biasa.
```

---

## 8. Error Handling

Kafka Connect error handling harus dibagi menjadi beberapa kategori.

---

### 8.1 Jenis error

| Error | Contoh | Strategi |
|---|---|---|
| Retriable transient error | DB timeout, network glitch | Retry dengan backoff |
| Permanent record error | Schema salah, field invalid | DLQ atau fail fast |
| Connector config error | Wrong credential, missing topic | Fix config, restart |
| Downstream capacity error | Sink throttling | Backpressure, scale sink, reduce rate |
| Serialization/converter error | Invalid Avro/JSON | DLQ jika memungkinkan, schema governance |
| Transform error | SMT gagal parse field | DLQ/fail depending criticality |
| Infrastructure error | Worker OOM, disk full | Fix platform |

---

### 8.2 Fail fast vs tolerate errors

Ada dua filosofi:

#### Fail fast

```text
Jika ada record salah, hentikan connector.
```

Cocok untuk:

1. Financial posting.
2. Regulatory audit trail.
3. Case lifecycle critical stream.
4. Data pipeline dengan zero tolerance terhadap silent data quality issue.

Kelebihan:

```text
Error terlihat cepat.
```

Kekurangan:

```text
Satu poison record bisa menghentikan pipeline.
```

#### Tolerate and route

```text
Jika ada record salah, kirim ke DLQ dan lanjutkan.
```

Cocok untuk:

1. Analytics pipeline.
2. Non-critical enrichment.
3. Search indexing.
4. Pipeline dengan recovery async.

Kelebihan:

```text
Pipeline tetap berjalan.
```

Kekurangan:

```text
Data bisa diam-diam menumpuk di DLQ jika tidak dimonitor.
```

---

### 8.3 `errors.tolerance`

Konfigurasi umum:

```properties
errors.tolerance=none
```

Artinya:

```text
Error menyebabkan task gagal.
```

Atau:

```properties
errors.tolerance=all
```

Artinya:

```text
Error tertentu ditoleransi dan processing berlanjut.
```

Bahaya besar:

```text
errors.tolerance=all tanpa DLQ dan monitoring = silent data loss / silent data exclusion.
```

Jangan gunakan tolerance all hanya agar dashboard hijau.

---

### 8.4 Dead Letter Queue

DLQ adalah topic Kafka tempat record yang gagal diproses dirutekan.

Contoh konfigurasi sink connector:

```properties
errors.tolerance=all
errors.deadletterqueue.topic.name=dlq.orders-search-sink.v1
errors.deadletterqueue.context.headers.enable=true
errors.log.enable=true
errors.log.include.messages=false
```

Prinsip DLQ yang benar:

```text
DLQ bukan tempat sampah.
DLQ adalah control point untuk triage, correction, replay, dan governance.
```

DLQ harus punya:

1. Owner.
2. Retention policy.
3. Alerting.
4. Dashboard.
5. Triage workflow.
6. Reprocessing strategy.
7. Data privacy handling.
8. Runbook.

Tanpa itu, DLQ hanya menyembunyikan kegagalan.

---

### 8.5 DLQ topic design

Contoh naming:

```text
dlq.<source-or-sink-name>.<domain>.<version>
```

Contoh:

```text
dlq.orders-search-sink.orders.v1
dlq.case-cdc-source.enforcement.v1
dlq.payment-warehouse-sink.finance.v1
```

Metadata yang perlu ada:

1. Original topic.
2. Original partition.
3. Original offset.
4. Connector name.
5. Task id.
6. Error class.
7. Error message.
8. Stack trace jika aman.
9. Timestamp failure.
10. Schema id jika memakai Schema Registry.
11. Correlation id / event id jika ada.

Sebagian metadata dapat tersedia via headers tergantung konfigurasi dan connector behavior.

---

### 8.6 DLQ reprocessing

Ada beberapa strategi reprocessing:

#### Manual fix and replay

```text
DLQ record -> inspect -> fix data/config/schema -> produce ulang ke original topic atau repair topic
```

#### Repair topic

```text
DLQ -> repair service -> corrected topic -> downstream sink
```

#### Side-channel correction event

Untuk domain event, sering lebih aman membuat event koreksi:

```text
CaseStatusCorrectionIssued
```

daripada mengubah event lama.

#### Skip with audit

Untuk data non-critical, kadang record bisa ditandai skipped dengan justifikasi.

Tapi untuk sistem regulatory/case management:

```text
Skip harus menghasilkan audit trail eksplisit.
```

---

## 9. Retry and Backoff

### 9.1 Retry tidak selalu aman

Retry membantu untuk transient error, tetapi berbahaya untuk permanent error.

Contoh transient:

```text
Database temporarily unavailable
HTTP 503
Network timeout
Broker leader election
```

Contoh permanent:

```text
Column does not exist
Invalid enum value
Schema incompatible
Primary key missing
Permission denied
```

Retry permanent error hanya menghasilkan:

```text
lebih banyak log, delay lebih panjang, dan incident lebih lambat dipahami.
```

---

### 9.2 Retry storm

Jika banyak task retry bersamaan ke sink yang sedang lemah:

```text
Sink overload -> timeout -> retry -> more load -> worse overload
```

Ini retry storm.

Mitigasi:

1. Exponential backoff.
2. Jitter jika tersedia.
3. Limit retry duration.
4. Circuit breaker di custom connector/service jika perlu.
5. Pause connector saat sink incident.
6. Reduce task count sementara.
7. Rate limiting / quota.

---

### 9.3 Pause connector sebagai operational backpressure

Jika downstream sink sakit, kadang pilihan terbaik:

```text
Pause sink connector
biarkan Kafka topic menahan backlog
recovery sink
resume connector secara terkendali
```

Ini salah satu alasan Kafka berguna sebagai buffer durable.

Tapi backlog punya konsekuensi:

1. Consumer lag naik.
2. Storage Kafka bertambah.
3. Retention risk jika backlog terlalu lama.
4. Catch-up burst bisa membebani sink lagi.

Resume harus dikontrol.

---

## 10. Connector Lifecycle Control

Kafka Connect biasanya dikontrol via REST API.

---

### 10.1 Check connector status

Contoh:

```bash
curl -s http://connect:8083/connectors/orders-jdbc-sink/status | jq
```

Output konseptual:

```json
{
  "name": "orders-jdbc-sink",
  "connector": {
    "state": "RUNNING",
    "worker_id": "connect-1:8083"
  },
  "tasks": [
    {
      "id": 0,
      "state": "RUNNING",
      "worker_id": "connect-2:8083"
    },
    {
      "id": 1,
      "state": "FAILED",
      "worker_id": "connect-3:8083",
      "trace": "..."
    }
  ]
}
```

Important distinction:

```text
Connector RUNNING tidak selalu berarti semua task RUNNING.
```

Alert harus melihat task state, bukan hanya connector state.

---

### 10.2 Pause connector

```bash
curl -X PUT http://connect:8083/connectors/orders-jdbc-sink/pause
```

Gunakan saat:

1. Downstream maintenance.
2. Sink overload.
3. Data quality incident.
4. Prevent bad writes.
5. Menunggu schema fix.

---

### 10.3 Resume connector

```bash
curl -X PUT http://connect:8083/connectors/orders-jdbc-sink/resume
```

Sebelum resume:

1. Pastikan root cause fixed.
2. Cek backlog size.
3. Cek sink capacity.
4. Cek DLQ growth.
5. Cek retention runway.

---

### 10.4 Restart connector/task

Restart semua:

```bash
curl -X POST http://connect:8083/connectors/orders-jdbc-sink/restart
```

Restart task tertentu:

```bash
curl -X POST http://connect:8083/connectors/orders-jdbc-sink/tasks/1/restart
```

Restart bukan root-cause fix. Restart hanya valid jika:

1. Error transient.
2. Config sudah diperbaiki.
3. Credential sudah diperbarui.
4. Downstream sudah pulih.
5. Connector implementation punya bug state sementara.

Anti-pattern:

```text
Cron restart connector setiap 5 menit agar terlihat sehat.
```

Itu menutupi bug atau kapasitas yang salah.

---

## 11. Production Configuration Patterns

### 11.1 Worker configuration baseline

Contoh worker distributed mode:

```properties
bootstrap.servers=kafka-1:9092,kafka-2:9092,kafka-3:9092

group.id=connect-prod

key.converter=io.confluent.connect.avro.AvroConverter
key.converter.schema.registry.url=https://schema-registry:8081
value.converter=io.confluent.connect.avro.AvroConverter
value.converter.schema.registry.url=https://schema-registry:8081

config.storage.topic=connect-prod-configs
offset.storage.topic=connect-prod-offsets
status.storage.topic=connect-prod-status

config.storage.replication.factor=3
offset.storage.replication.factor=3
status.storage.replication.factor=3

offset.flush.interval.ms=10000

plugin.path=/usr/share/java,/opt/connectors

rest.port=8083
rest.advertised.host.name=connect-1
```

Catatan:

1. Replication factor internal topics minimal mengikuti criticality cluster.
2. Converter harus konsisten dengan serialization strategy organisasi.
3. Plugin path harus immutable dalam deployment image jika memungkinkan.
4. Jangan mount plugin manual di production tanpa version control.

---

### 11.2 Sink connector error handling baseline

Untuk pipeline non-critical yang boleh lanjut dengan DLQ:

```properties
errors.tolerance=all
errors.deadletterqueue.topic.name=dlq.orders-search-sink.v1
errors.deadletterqueue.context.headers.enable=true
errors.log.enable=true
errors.log.include.messages=false
```

Untuk pipeline critical:

```properties
errors.tolerance=none
```

Atau gunakan DLQ hanya jika governance-nya matang:

```text
Critical pipeline + DLQ tanpa alert = unacceptable
```

---

### 11.3 JDBC sink idempotency baseline

Misalnya event `OrderUpdated` ditulis ke table projection:

```properties
connector.class=io.confluent.connect.jdbc.JdbcSinkConnector
topics=orders.events.v1
tasks.max=4

insert.mode=upsert
pk.mode=record_key
pk.fields=order_id

auto.create=false
auto.evolve=false
```

Kenapa `upsert`?

```text
Karena sink connector bisa mengirim duplicate setelah crash/retry.
```

Kenapa `auto.create=false` dan `auto.evolve=false` di banyak production enterprise?

```text
Karena perubahan schema database harus dikontrol via migration, bukan otomatis oleh connector runtime.
```

---

### 11.4 JDBC source caveat

JDBC source polling dengan timestamp/incrementing mode sering terlihat sederhana.

Tapi ada risiko:

| Mode | Risiko |
|---|---|
| Incrementing | Update pada row lama tidak terlihat |
| Timestamp | Clock precision, same timestamp, late commit |
| Timestamp+incrementing | Lebih baik, tetap butuh kolom yang benar |
| Bulk | Mahal, duplicate besar, tidak incremental |

Untuk event-driven integration serius, CDC/outbox sering lebih defensible daripada polling table generik.

---

## 12. Deployment Model

### 12.1 Immutable worker image

Production Kafka Connect sebaiknya memakai image yang berisi:

1. Kafka Connect runtime.
2. Connector plugins versi spesifik.
3. Monitoring agent.
4. Security configuration template.
5. Health check.

Jangan mengandalkan:

```text
SSH ke worker lalu copy jar connector manual
```

Risikonya:

1. Worker tidak identik.
2. Rebalance memindahkan task ke worker yang tidak punya plugin.
3. Incident sulit direproduksi.
4. Upgrade tidak deterministic.

---

### 12.2 Plugin version governance

Connector plugin adalah dependency produksi.

Harus punya:

1. Version pinning.
2. Compatibility matrix.
3. Change log review.
4. Security vulnerability scanning.
5. Rollback path.
6. Staging test.
7. Rebalance impact test.

Contoh inventory:

```text
Plugin: confluentinc-kafka-connect-jdbc
Version: 10.7.x
Used by: orders-jdbc-sink, case-jdbc-source
Owner: Data Platform
Upgrade window: monthly
Rollback: image tag connect-prod-2026-06-01
```

---

### 12.3 Kubernetes deployment caveat

Kafka Connect di Kubernetes umum digunakan, tapi ada risiko:

1. Pod restart menyebabkan worker leave/join group.
2. Rolling deployment memicu rebalance.
3. Plugin mount via PVC bisa tidak konsisten.
4. Resource limit terlalu rendah menyebabkan OOMKilled.
5. Liveness probe terlalu agresif bisa membunuh worker saat GC/slow startup.
6. REST advertised host salah membuat status/control terganggu.

Prinsip:

```text
Treat Connect worker as stateful runtime from coordination perspective,
meskipun worker process-nya stateless secara lokal.
```

State-nya ada di Kafka internal topics, tapi task ownership tetap sensitif terhadap restart.

---

## 13. Observability Kafka Connect

### 13.1 Apa yang harus dimonitor?

Minimal:

1. Connector state.
2. Task state.
3. Task failure count.
4. Worker rebalance count.
5. Source record poll rate.
6. Source record write rate.
7. Sink record read rate.
8. Sink record send/write rate.
9. Error count.
10. DLQ produce count.
11. DLQ produce failure count.
12. Retry count.
13. Batch size.
14. Offset commit failure.
15. Consumer lag untuk sink connector.
16. Worker JVM heap.
17. Worker CPU.
18. Worker GC pause.
19. Worker REST availability.
20. Internal topic health.

---

### 13.2 Status RUNNING tidak cukup

Connector bisa `RUNNING`, tapi:

1. Salah satu task `FAILED`.
2. Throughput nol.
3. DLQ bertambah cepat.
4. Sink latency meningkat.
5. Lag terus naik.
6. Offset tidak maju.
7. Worker sering rebalance.

Karena itu alert harus berbasis behavior, bukan hanya state.

Better alert examples:

```text
Task FAILED for > 2 minutes
DLQ records > 0 for critical connector
Consumer lag increasing for 15 minutes
No records written while input lag increasing
Rebalance count spike after deployment
Offset commit failure > threshold
Sink write latency p95 > SLO
```

---

### 13.3 DLQ monitoring

DLQ harus diperlakukan sebagai production signal.

Metric penting:

1. DLQ records per minute.
2. DLQ by connector.
3. DLQ by error class.
4. DLQ by schema id.
5. DLQ age oldest untriaged.
6. DLQ replay success/failure.
7. DLQ retention runway.

Anti-pattern:

```text
DLQ exists, nobody watches it.
```

---

## 14. Capacity Planning

### 14.1 Throughput formula sederhana

Untuk sink connector:

```text
throughput = min(
  Kafka read throughput,
  task processing throughput,
  sink write throughput,
  network throughput,
  serialization/deserialization throughput
)
```

Untuk source connector:

```text
throughput = min(
  source read throughput,
  task processing throughput,
  Kafka produce throughput,
  serialization throughput,
  source rate limit
)
```

---

### 14.2 Menentukan bottleneck

| Gejala | Kemungkinan bottleneck |
|---|---|
| Consumer lag naik, sink CPU tinggi | Sink bottleneck |
| Worker CPU 100%, sink normal | Transform/converter CPU bottleneck |
| Worker heap naik/OOM | Batch terlalu besar, connector memory issue |
| Kafka produce latency tinggi | Kafka broker/network bottleneck |
| DLQ naik karena timeout | Sink unstable atau rate terlalu tinggi |
| Rebalance sering | Worker instability/resource/probe issue |
| Task idle padahal backlog ada | Partition/task assignment/config issue |

---

### 14.3 Scaling decision tree

Jika sink lag naik:

```text
1. Apakah task semua RUNNING?
2. Apakah topic partition cukup?
3. Apakah tasks.max < partition count?
4. Apakah worker CPU/memory penuh?
5. Apakah sink write latency tinggi?
6. Apakah sink punya connection pool cukup?
7. Apakah sink throttling/rate limit?
8. Apakah batch config terlalu kecil?
9. Apakah DLQ/retry menahan processing?
```

Jangan langsung menambah partition sebelum tahu bottleneck.

---

## 15. Failure Modes dan Cara Berpikir

### 15.1 Task FAILED

Kemungkinan penyebab:

1. Bad record.
2. Schema error.
3. Converter error.
4. Sink unavailable.
5. Authentication failure.
6. Connector bug.
7. Missing plugin dependency.
8. Config invalid.

Runbook:

```text
1. Ambil connector status.
2. Baca task trace.
3. Cek worker logs sekitar failure timestamp.
4. Klasifikasikan transient/permanent.
5. Cek apakah record masuk DLQ.
6. Jika config issue, update config.
7. Jika bad record, triage/replay/skip sesuai policy.
8. Restart task hanya setelah root cause jelas.
```

---

### 15.2 Connector RUNNING tapi data tidak mengalir

Kemungkinan:

1. Source tidak punya data baru.
2. Source query salah.
3. Offset sudah maju melewati data.
4. Topic input kosong.
5. Task stuck.
6. Sink blocked tapi tidak fail.
7. Backpressure internal.
8. Network hang.
9. Credential expired tapi connector tidak fail cepat.

Runbook:

```text
1. Cek input rate.
2. Cek output rate.
3. Cek offset movement.
4. Cek consumer lag untuk sink.
5. Cek source system activity.
6. Cek task thread dump jika perlu.
7. Cek logs untuk retry loop.
```

---

### 15.3 DLQ spike

Kemungkinan:

1. Producer upstream deploy schema baru.
2. Schema Registry compatibility gagal/berubah.
3. SMT tidak cocok dengan field baru.
4. Sink constraint berubah.
5. Data quality issue upstream.
6. Null key masuk ke sink yang butuh key.
7. Enum value baru tidak didukung.

Runbook:

```text
1. Group DLQ by error class.
2. Ambil sample DLQ record.
3. Cek original topic/partition/offset.
4. Cek deployment upstream terbaru.
5. Cek schema version terbaru.
6. Cek connector config change.
7. Putuskan: pause connector, continue with DLQ, rollback upstream, atau update sink/schema.
8. Tentukan replay strategy.
```

---

### 15.4 Sink overload

Gejala:

1. Lag naik.
2. Sink latency naik.
3. Retry meningkat.
4. Connection timeout.
5. DLQ mungkin naik.
6. Worker thread blocked.

Mitigasi:

1. Pause connector.
2. Scale sink.
3. Reduce tasks.
4. Reduce batch size atau increase batch tergantung sink behavior.
5. Add rate limiting.
6. Resume bertahap.
7. Monitor catch-up.

---

### 15.5 Worker OOM

Kemungkinan:

1. Batch terlalu besar.
2. Record terlalu besar.
3. Connector memory leak.
4. Too many tasks per worker.
5. Converter/SMT menghasilkan object besar.
6. Heap limit terlalu kecil.
7. Sink client buffering.

Runbook:

```text
1. Ambil heap dump jika feasible.
2. Cek record size.
3. Cek task density per worker.
4. Cek recent plugin/config change.
5. Naikkan memory hanya jika root cause masuk akal.
6. Kurangi task per worker atau batch.
7. Upgrade connector jika ada known leak.
```

---

## 16. Sink-Specific Caveats

### 16.1 JDBC sink

Risiko:

1. Duplicate write.
2. Primary key mismatch.
3. Deadlock database.
4. Transaction too large.
5. Schema auto-evolve tidak terkendali.
6. Database connection pool exhaustion.
7. Upsert semantics berbeda antar database.
8. Delete/tombstone behavior tidak sesuai ekspektasi.

Production advice:

```text
Gunakan stable key dan idempotent upsert jika mungkin.
Jangan rely pada insert-only kecuali event benar-benar unique dan sink bisa enforce uniqueness.
```

---

### 16.2 Search sink: Elasticsearch/OpenSearch

Risiko:

1. Indexing lag.
2. Mapping conflict.
3. Document id salah sehingga duplicate document.
4. Bulk rejection.
5. Hot shard.
6. Refresh interval cost.
7. Event ordering vs search document latest state.

Production advice:

```text
Gunakan document id deterministik dari business key.
Anggap search index sebagai projection yang bisa dibangun ulang.
```

---

### 16.3 Object storage sink

Risiko:

1. Small file problem.
2. Exactly-once illusion.
3. Partitioning path buruk.
4. Late event handling.
5. Schema evolution membuat reader analytics rusak.
6. Reprocessing menghasilkan duplicate files.

Production advice:

```text
Desain object sink sebagai append dataset dengan compaction/curation downstream.
Jangan anggap object storage sink seperti database transactional row store.
```

---

## 17. Source-Specific Caveats

### 17.1 JDBC source polling

Cocok untuk:

1. Reference data non-critical.
2. Low-volume integration.
3. Table dengan timestamp/incrementing column yang jelas.

Kurang cocok untuk:

1. High-integrity event stream.
2. Semua perubahan termasuk delete.
3. Transaction boundary penting.
4. Regulatory reconstruction.

Masalah umum:

```text
Polling table ≠ true event capture
```

---

### 17.2 CDC source

CDC lebih kuat untuk menangkap perubahan database log, tapi tetap punya risiko:

1. Snapshot besar.
2. Schema drift.
3. Log retention database tidak cukup.
4. Replication slot bloat.
5. Tombstone semantics.
6. Transaction ordering.
7. Table filtering salah.
8. PII leak dari raw CDC topics.

CDC akan dibahas khusus di Part 016.

---

## 18. Security and Secrets in Production Connect

Kafka Connect sering menyimpan credential untuk banyak sistem:

1. Database username/password.
2. API token.
3. Cloud access key.
4. TLS keystore/truststore password.
5. Schema Registry credential.
6. Sink service credentials.

Prinsip:

```text
Connector config adalah sensitive operational asset.
```

Hindari:

```json
{
  "connection.password": "plain-text-password"
}
```

Gunakan secret provider jika platform mendukung:

```properties
config.providers=file,env
config.providers.file.class=org.apache.kafka.common.config.provider.FileConfigProvider
config.providers.env.class=org.apache.kafka.common.config.provider.EnvVarConfigProvider
```

Contoh referensi:

```properties
connection.password=${file:/opt/secrets/db.properties:password}
```

Aturan governance:

1. Jangan log connector config penuh.
2. Mask secret di UI/API logs.
3. Rotate credentials terjadwal.
4. Test restart setelah secret rotation.
5. Separate principal per connector/domain.
6. Audit siapa mengubah connector config.

---

## 19. Change Management

### 19.1 Connector config change bukan hal kecil

Mengubah config bisa menyebabkan:

1. Task restart.
2. Rebalance.
3. Offset behavior berubah.
4. Topic output berubah.
5. Schema berubah.
6. Sink write mode berubah.
7. Duplicate atau data gap.

Perubahan ini harus melalui review.

---

### 19.2 Checklist sebelum update connector

Sebelum update:

```text
[ ] Apa connector name?
[ ] Source atau sink?
[ ] Apa task count sekarang?
[ ] Apa lag sekarang?
[ ] Apa DLQ rate sekarang?
[ ] Config apa yang berubah?
[ ] Apakah offset namespace berubah?
[ ] Apakah topic input/output berubah?
[ ] Apakah schema berubah?
[ ] Apakah sink idempotency tetap valid?
[ ] Apakah rollback config tersedia?
[ ] Apakah impact rebalance diterima?
[ ] Apakah window deployment aman?
```

---

### 19.3 Rollback problem

Rollback connector tidak selalu mengembalikan data state.

Contoh:

1. Connector versi baru sudah menulis data ke sink dengan format baru.
2. Offset sudah maju.
3. DLQ sudah menerima record.
4. Schema baru sudah terdaftar.
5. Topic baru sudah dibuat.

Rollback harus memikirkan:

```text
code/config state + data state + offset state + schema state
```

---

## 20. Regulatory and Case Management Perspective

Untuk sistem enforcement lifecycle/case management, Kafka Connect sering dipakai untuk:

1. Ingest evidence metadata dari object store.
2. Sink case projection ke search index.
3. Sink audit stream ke archival storage.
4. CDC dari legacy case database.
5. Publish reference data dari master data system.
6. Load curated events ke analytics/warehouse.

Hal yang harus dijaga:

### 20.1 Auditability

Setiap connector critical harus bisa menjawab:

```text
Data apa yang diproses?
Kapan diproses?
Dari mana asalnya?
Ke mana dikirim?
Jika gagal, masuk ke mana?
Siapa yang memperbaiki?
Apakah replay dilakukan?
```

### 20.2 No silent skip

Untuk regulatory stream:

```text
errors.tolerance=all tanpa DLQ + alert + triage = governance failure
```

### 20.3 Correction over mutation

Jika event salah sudah masuk sink, jangan selalu “edit diam-diam”.

Lebih defensible:

```text
Original event tetap ada.
Correction event diterbitkan.
Projection memperhitungkan correction.
Audit trail menjelaskan perubahan.
```

### 20.4 Retention runway

Jika sink berhenti 3 hari, apakah Kafka topic masih menyimpan data cukup lama?

Pertanyaan wajib:

```text
retention.ms > worst-case outage + detection delay + recovery delay + replay delay
```

---

## 21. Production Runbook Templates

### 21.1 Connector failed runbook

```text
Incident: Kafka Connect connector/task FAILED

1. Identify connector
   - name
   - source/sink
   - owner
   - criticality

2. Inspect status
   - connector state
   - task states
   - failed task trace
   - worker id

3. Inspect logs
   - worker logs
   - connector-specific logs
   - stack trace

4. Classify error
   - transient
   - permanent bad record
   - config/credential
   - downstream outage
   - infrastructure

5. Contain
   - pause connector if bad writes possible
   - prevent DLQ overflow
   - notify downstream/upstream owner

6. Recover
   - fix config/credential/schema/sink
   - restart task/connector
   - replay DLQ if needed

7. Validate
   - task running
   - lag decreasing
   - DLQ stable
   - sink data correct

8. Close
   - document root cause
   - create prevention action
   - update alert/runbook
```

---

### 21.2 DLQ spike runbook

```text
Incident: DLQ spike

1. Check DLQ rate and volume
2. Group by connector and error class
3. Sample failed records
4. Identify original topic/partition/offset
5. Check upstream deployments and schema changes
6. Decide containment:
   - continue with DLQ
   - pause connector
   - rollback upstream
   - update connector/schema/sink
7. Define replay strategy
8. Validate no further DLQ growth
9. Record audit decision
```

---

### 21.3 Sink lag runbook

```text
Incident: Sink connector lag increasing

1. Confirm lag by connector/task/topic/partition
2. Check task state
3. Check sink latency/error/throttling
4. Check worker CPU/memory/GC
5. Check DLQ/retry count
6. Check recent deployment/config/schema change
7. Decide action:
   - scale tasks
   - scale workers
   - scale sink
   - pause connector
   - reduce rate
   - repartition only if proven needed
8. Monitor catch-up and sink stability
```

---

## 22. Anti-Patterns

### Anti-pattern 1 — Treating Connect as fire-and-forget ETL

Buruk:

```text
Buat connector, selama status RUNNING berarti selesai.
```

Benar:

```text
Connector adalah production service dengan SLO, owner, monitoring, alert, runbook, dan lifecycle management.
```

---

### Anti-pattern 2 — `errors.tolerance=all` tanpa DLQ

Buruk:

```properties
errors.tolerance=all
```

Tanpa:

```properties
errors.deadletterqueue.topic.name=...
```

Benar:

```text
Jika tolerate error, harus ada routing, observability, dan triage.
```

---

### Anti-pattern 3 — DLQ tanpa owner

Buruk:

```text
DLQ ada, tapi tidak ada yang bertanggung jawab.
```

Benar:

```text
Setiap DLQ punya owner, retention, alert, dan reprocess policy.
```

---

### Anti-pattern 4 — Menambah worker untuk semua performance problem

Buruk:

```text
Lag naik -> tambah worker.
```

Benar:

```text
Cari bottleneck: partition, task, worker CPU, sink capacity, source limit, retry, DLQ, converter, network.
```

---

### Anti-pattern 5 — Menggunakan SMT untuk business logic kompleks

SMT cocok untuk transformasi ringan:

1. Rename field.
2. Drop field.
3. Insert metadata.
4. Route topic sederhana.

SMT buruk untuk:

1. Rule bisnis kompleks.
2. External lookup.
3. Stateful enrichment.
4. Multi-step validation.
5. Regulatory decision logic.

Gunakan Kafka Streams/service khusus untuk logic kompleks.

---

### Anti-pattern 6 — Auto-create/evolve schema/database sembarangan

Buruk:

```text
Connector otomatis membuat/mengubah table production.
```

Benar:

```text
Schema database production dikelola via migration dan review.
```

---

### Anti-pattern 7 — Connector name berubah tanpa memahami offset

Buruk:

```text
Rename connector agar lebih rapi.
```

Dampak:

```text
Offset namespace bisa berubah; source bisa re-read atau kehilangan posisi tergantung connector.
```

Benar:

```text
Treat rename sebagai migration.
```

---

## 23. Design Trade-Offs

### 23.1 Fail fast vs DLQ

| Faktor | Fail Fast | DLQ |
|---|---|---|
| Visibility | Tinggi | Bergantung alert |
| Availability | Rendah untuk poison record | Lebih tinggi |
| Data integrity | Ketat | Butuh governance |
| Operational load | Incident cepat | Triage backlog |
| Cocok untuk | Critical stream | Non-critical / recoverable stream |

---

### 23.2 More tasks vs downstream safety

| More tasks | Risiko |
|---|---|
| Throughput naik | Sink overload |
| Lag turun | DB deadlock / rate limit |
| Parallel write | Ordering per key bisa tergantung partition/sink semantics |
| Better resource use | Lebih banyak connection/client |

---

### 23.3 Pause vs let it fail

| Pause connector | Let it fail |
|---|---|
| Menghindari bad writes | Error visible |
| Backlog naik di Kafka | Pipeline berhenti jelas |
| Butuh resume plan | Bisa butuh restart/recovery |
| Cocok untuk downstream maintenance | Cocok untuk permanent correctness violation |

---

## 24. Java Engineer Perspective

Sebagai Java engineer, Kafka Connect mengurangi kebutuhan menulis integration boilerplate. Tapi kamu tetap perlu memahami hal-hal yang biasanya tersembunyi:

1. Connector adalah JVM workload.
2. Converter/SMT bisa mahal secara CPU dan memory.
3. Sink client library bisa punya connection pool sendiri.
4. Thread dump dan heap dump kadang diperlukan.
5. Classpath/plugin isolation bisa menjadi masalah.
6. Dependency conflict antar connector bisa terjadi.
7. Serialization exception tidak selalu muncul di producer/consumer app, bisa muncul di Connect converter.
8. Offset/commit semantics tetap harus dipahami seperti consumer biasa.

Jika kamu menulis custom connector, kamu harus lebih hati-hati lagi:

1. Implement source offset dengan benar.
2. Jangan melakukan blocking call tanpa timeout.
3. Jangan menyimpan state penting hanya di memory.
4. Pastikan task stop dengan graceful.
5. Buat retry behavior eksplisit.
6. Jangan swallow exception.
7. Tulis integration test dengan Kafka dan sistem eksternal fake/realistic.

---

## 25. Production Readiness Checklist

Sebelum connector dianggap production-ready:

```text
Ownership
[ ] Connector punya owner team
[ ] Upstream owner jelas
[ ] Downstream owner jelas
[ ] On-call path jelas

Configuration
[ ] Connector config direview
[ ] tasks.max sesuai partition/source/sink capacity
[ ] Converter sesuai standar organisasi
[ ] Secret tidak plain text
[ ] Connector plugin version pinned

Data correctness
[ ] Key design jelas
[ ] Sink idempotency jelas
[ ] Duplicate handling jelas
[ ] Offset semantics dipahami
[ ] Schema compatibility dipahami
[ ] Delete/tombstone behavior dipahami

Error handling
[ ] errors.tolerance dipilih sadar
[ ] DLQ dikonfigurasi jika diperlukan
[ ] DLQ punya owner
[ ] DLQ punya alert
[ ] Replay strategy jelas

Observability
[ ] Connector/task state monitored
[ ] Throughput monitored
[ ] Lag monitored
[ ] Error rate monitored
[ ] DLQ monitored
[ ] Worker resource monitored
[ ] Rebalance monitored

Operations
[ ] Pause/resume runbook ada
[ ] Restart runbook ada
[ ] Offset/reset policy ada
[ ] Rollback plan ada
[ ] Upgrade plan ada
[ ] Capacity plan ada

Compliance
[ ] PII handling jelas
[ ] Retention policy jelas
[ ] Audit trail untuk correction/replay ada
[ ] Access control sesuai domain
```

---

## 26. Latihan / Thought Exercises

### Latihan 1 — Sink duplicate

Sebuah JDBC sink menulis event `CaseStatusChanged` ke table `case_status_projection` dengan `insert.mode=insert`.

Task crash setelah write sukses ke DB tapi sebelum offset commit.

Pertanyaan:

1. Apa yang terjadi saat task restart?
2. Apakah duplicate mungkin?
3. Bagaimana desain sink agar idempotent?
4. Apa primary key yang tepat?
5. Apakah event id atau case id yang lebih cocok sebagai key projection?

---

### Latihan 2 — DLQ untuk stream critical

Connector critical menulis audit event ke archival storage.

Tim mengusulkan:

```properties
errors.tolerance=all
errors.deadletterqueue.topic.name=dlq.audit-archive.v1
```

Pertanyaan:

1. Apakah ini aman?
2. Alert apa yang wajib?
3. Siapa owner DLQ?
4. Berapa retention DLQ?
5. Bagaimana replay dilakukan?
6. Apakah connector harus pause saat DLQ > 0?

---

### Latihan 3 — Scaling sink connector

Topic `case.events.v1` punya 6 partition. Sink connector punya:

```properties
tasks.max=2
```

Lag naik terus. Worker CPU rendah. Sink database CPU rendah.

Pertanyaan:

1. Apa bottleneck paling mungkin?
2. Apakah menambah worker membantu?
3. Apakah menaikkan `tasks.max` membantu?
4. Batas maksimal task efektif berapa?
5. Setelah menaikkan task, apa risiko ke database?

---

### Latihan 4 — Connector rename

Connector `legacy-case-jdbc-source` ingin diganti nama menjadi `case-reference-source`.

Pertanyaan:

1. Apakah ini hanya perubahan kosmetik?
2. Bagaimana dampaknya pada offset?
3. Bagaimana cara migrasi aman?
4. Apa yang harus diuji di staging?

---

## 27. Ringkasan

Kafka Connect production mastery bukan tentang hafal daftar connector. Intinya adalah memahami Connect sebagai distributed runtime yang punya state, ownership, offset, rebalancing, failure mode, dan operational control.

Prinsip utama:

1. Worker menjalankan task; task adalah unit paralelisme aktual.
2. Menambah worker tidak otomatis menaikkan throughput jika task/partition/source/sink menjadi bottleneck.
3. Internal topics Connect adalah critical state dan harus dikonfigurasi dengan replication serta compaction yang benar.
4. Sink connector harus diasumsikan bisa menulis duplicate; idempotency sangat penting.
5. Source connector offset merepresentasikan posisi di sistem eksternal, bukan offset Kafka output.
6. `errors.tolerance=all` tanpa DLQ dan monitoring adalah anti-pattern serius.
7. DLQ adalah workflow operasional, bukan tempat sampah.
8. Pause/resume/restart adalah control plane penting, tapi tidak menggantikan root-cause analysis.
9. Connector status `RUNNING` tidak cukup; task state, throughput, lag, DLQ, dan offset movement harus dimonitor.
10. Untuk sistem regulatory/case management, silent skip dan ungoverned replay adalah risiko defensibility.

---

## 28. Koneksi ke Part Berikutnya

Part berikutnya adalah:

```text
learn-kafka-event-streaming-mastery-for-java-engineers-part-016.md
```

Judul:

```text
CDC with Kafka: Database Logs, Debezium Mental Model, Outbox, and Ordering
```

Di Part 016 kita akan masuk ke salah satu use case paling penting Kafka Connect: **Change Data Capture**.

Kita akan membahas:

1. Mengapa polling database sering tidak cukup.
2. Apa itu log-based CDC.
3. Snapshot vs streaming phase.
4. Transaction log, LSN/binlog/GTID mental model.
5. Insert/update/delete representation.
6. Tombstone dan delete semantics.
7. Debezium mental model.
8. Outbox pattern untuk menghindari dual-write.
9. Ordering dan transaction boundary.
10. CDC untuk legacy integration dan microservice eventing.

---

## 29. Status Seri

```text
Status: belum selesai
Progress: Part 000 sampai Part 015 selesai
Total rencana: Part 000 sampai Part 034
Sisa: Part 016 sampai Part 034
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-014.md">⬅️ Part 014 — Kafka Connect Fundamentals: Source, Sink, Workers, Tasks, Converters</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-016.md">Part 016 — CDC with Kafka: Database Logs, Debezium Mental Model, Outbox, and Ordering ➡️</a>
</div>
