# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-012.md

# Deduplication and Idempotent Ingestion

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Part: `012`  
> Fokus: deduplication, idempotency, retry, replay, correction, and production ingestion safety  
> Target pembaca: Java software engineer / tech lead yang membangun ingestion pipeline time-series dengan QuestDB

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita membahas WAL: write ke QuestDB bukan sekadar `insert success`, tetapi pipeline:

```text
client
-> WAL
-> apply job
-> table storage
-> query freshness
```

Part ini melanjutkan satu masalah produksi yang hampir selalu muncul setelah WAL dan retry masuk ke desain:

> Bagaimana memastikan data time-series tetap benar ketika producer melakukan retry, broker melakukan replay, network gagal di tengah request, atau historical backfill dijalankan ulang?

Tujuan part ini:

1. Memahami kenapa duplicate adalah kondisi normal dalam sistem distributed, bukan bug langka.
2. Membedakan duplicate, retry, replay, late arrival, correction, dan revision.
3. Mendesain idempotency key untuk event time-series.
4. Memahami mental model deduplication QuestDB menggunakan `DEDUP` dan `UPSERT KEYS`.
5. Menentukan di mana idempotency harus terjadi: producer, ingestion gateway, broker, database, atau query layer.
6. Membuat retry/backfill aman tanpa menghasilkan double counting.
7. Menyusun checklist produksi untuk ingestion idempotent.

Part ini tidak akan mengulang teori Kafka exactly-once, transaksi database umum, atau general distributed systems. Fokusnya adalah penerapan pada QuestDB dan time-series workload.

---

## 2. Problem yang Diselesaikan

Bayangkan service Java mengirim telemetry ke QuestDB:

```text
payment-service emits:
  service=payment
  endpoint=/charge
  status=200
  latency_ms=81
  ts=2026-06-21T10:15:03.120Z
```

Producer mengirim batch ke QuestDB. Network timeout terjadi.

Pertanyaan sulitnya:

```text
Apakah batch sudah diterima QuestDB?
Apakah sebagian diterima?
Apakah aman retry?
Kalau retry, apakah metric akan dobel?
Kalau batch dari Kafka direplay, apakah query dashboard berubah?
Kalau event lama dikoreksi, apakah harus overwrite atau append revision?
```

Dalam distributed system, failure sering terjadi pada boundary yang tidak memberi jawaban pasti:

```text
client sends request
server receives request
server writes WAL
server returns response
response lost
client sees timeout
```

Dari sisi client:

```text
timeout != write failed
```

Timeout hanya berarti:

```text
client does not know the outcome
```

Tanpa idempotency, pilihan producer buruk semua:

| Pilihan | Risiko |
|---|---|
| Tidak retry | Data hilang |
| Retry | Data dobel |
| Retry lalu dedup query-side | Query mahal dan raw data kotor |
| Simpan local state semua event | Kompleks dan rentan |

Idempotent ingestion bertujuan membuat operasi berikut aman:

```text
send(event)
send(event) again
send(event) again from replay
send(event) again after crash recovery
```

Hasil akhirnya tetap satu fakta logis.

---

## 3. Mental Model Utama

### 3.1 Idempotency adalah properti operasi, bukan fitur database saja

Operasi idempotent berarti:

```text
apply(x) once  == apply(x) many times
```

Untuk time-series:

```text
insert observation O once == insert same observation O many times
```

Tetapi ini hanya benar kalau sistem tahu bahwa dua row adalah observation yang sama.

Karena itu, idempotency membutuhkan identity.

```text
idempotency = stable identity + deterministic write semantics
```

Tanpa stable identity, database hanya melihat banyak row yang mirip.

---

### 3.2 Duplicate berbeda dari correction

Ini sangat penting.

Duplicate:

```text
same logical observation
same timestamp
same identity dimensions
same value intent
```

Correction:

```text
same logical observation identity
but value is intentionally changed
```

Revision:

```text
same business subject
new version of truth
history of corrections matters
```

Late arrival:

```text
observation arrives after newer observations
but it may still be first arrival of that observation
```

Replay:

```text
source system sends historical events again
some are already stored
some may be missing
some may be corrected
```

Kalau semua dianggap duplicate, correction hilang.
Kalau semua dianggap new event, metric dobel.

---

### 3.3 Time-series identity hampir selalu mencakup timestamp

Dalam QuestDB deduplication, designated timestamp adalah bagian penting dari identity.

Secara domain, ini masuk akal:

```text
sensor_id=S1, metric=temp, ts=10:00:00
```

berbeda dari:

```text
sensor_id=S1, metric=temp, ts=10:00:01
```

Walaupun sensor dan metric sama, observation berbeda.

Jadi time-series dedup key biasanya berbentuk:

```text
(timestamp, entity_id, metric_name, source_id, optional_sequence)
```

Bukan hanya:

```text
(entity_id, metric_name)
```

Jika key terlalu sempit, data valid akan overwrite.
Jika key terlalu lebar, duplicate tidak akan terdeteksi.

---

## 4. Vocabulary Produksi

Gunakan istilah berikut secara konsisten dalam desain dan incident review.

| Istilah | Makna | Contoh |
|---|---|---|
| Duplicate | Event sama masuk lebih dari sekali | Retry setelah timeout |
| Idempotency key | Identitas stabil untuk mengenali event sama | `ts + device_id + metric` |
| Retry | Pengiriman ulang karena failure/timeout | HTTP ILP timeout |
| Replay | Pengiriman ulang dari sumber historis | Kafka offset reset |
| Backfill | Load data historis yang belum/lama ada | Import 2 tahun CSV |
| Correction | Pembaruan nilai untuk observation yang sama | Sensor mengirim revised reading |
| Revision | Fakta baru yang merekam perubahan | `revision_no=2` appended |
| Upsert | Insert or replace logical row | QuestDB dedup apply |
| Exactly once | Klaim sistemik yang sering terlalu disederhanakan | Producer + broker + DB atomicity |
| Effectively once | Hasil akhir tampak satu kali melalui idempotency | Retry aman |

Dalam sistem nyata, target praktis biasanya bukan “exactly once end-to-end”, tetapi:

```text
effectively-once result under retry and replay
```

---

## 5. Kenapa Duplicate Normal di Time-Series Pipeline

Duplicate bisa muncul dari banyak titik.

### 5.1 Producer retry

```text
Java service -> QuestDB HTTP ILP
request timeout
producer retries same batch
```

Kalau request pertama sebenarnya sudah masuk WAL, retry akan membuat duplicate kecuali dedup aktif.

---

### 5.2 Broker replay

```text
Kafka topic retained 7 days
consumer group reset offset
old messages consumed again
```

Replay sering sengaja dilakukan untuk recovery atau reprocessing. Database harus siap.

---

### 5.3 Consumer crash after write before offset commit

```text
consume message offset 100
write to QuestDB success
process crashes before committing offset
restart consumes offset 100 again
```

Ini salah satu sumber duplicate paling klasik.

---

### 5.4 Load balancer / client failover

```text
client sends to endpoint A
A becomes unavailable after receiving write
client retries to endpoint B
```

Dalam HA atau multi-endpoint setup, duplicate prevention tetap harus domain-aware.

---

### 5.5 Manual backfill repeated

```text
operator runs import_2026_01.sh
job fails at 80%
operator reruns from beginning
```

Tanpa idempotency, 80% pertama menjadi duplicate.

---

### 5.6 Device offline replay

IoT device sering menyimpan buffer lokal lalu mengirim ulang saat online.

```text
device offline 3 hours
sends buffered samples
connection drops
sends buffer again
```

Ini harus dianggap normal, bukan exceptional.

---

## 6. QuestDB Deduplication Mental Model

QuestDB mendukung deduplication untuk WAL table melalui konsep:

```sql
DEDUP UPSERT KEYS (...)
```

Mental modelnya:

```text
For a WAL-enabled table,
rows with same upsert key represent same logical observation.
When duplicate key arrives, QuestDB keeps one logical row according to dedup/upsert semantics.
```

Design implication:

1. Table harus dirancang dengan designated timestamp.
2. Table harus WAL-enabled.
3. `UPSERT KEYS` harus mencerminkan logical identity.
4. Timestamp harus menjadi bagian key.
5. Producer harus mengirim timestamp deterministik, bukan `now()` acak saat retry.

Contoh konseptual:

```sql
CREATE TABLE sensor_readings (
    ts TIMESTAMP,
    tenant SYMBOL,
    device_id SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    unit SYMBOL,
    quality SYMBOL,
    source SYMBOL
) TIMESTAMP(ts)
PARTITION BY DAY
WAL
DEDUP UPSERT KEYS(ts, tenant, device_id, metric);
```

Key:

```text
ts + tenant + device_id + metric
```

Artinya, untuk satu device dan metric pada timestamp tertentu, hanya ada satu observation logis.

---

## 7. Cara Memilih `UPSERT KEYS`

### 7.1 Mulai dari pertanyaan domain

Jangan mulai dari kolom. Mulai dari pertanyaan:

```text
Apa yang membuat dua row merepresentasikan observation yang sama?
```

Untuk metric sensor:

```text
same tenant
same device
same metric
same event timestamp
```

Untuk trade market data:

```text
same venue
same symbol
same trade_id
same exchange timestamp
```

Untuk application metrics:

```text
same service
same instance
same metric
same bucket timestamp
```

Untuk order book snapshot:

```text
same venue
same instrument
same book_side
same price_level
same snapshot timestamp
```

---

### 7.2 Include timestamp kecuali ada event ID global

Umumnya:

```text
UPSERT KEYS(ts, dimensions...)
```

Jika sumber memiliki immutable event ID global, key dapat mencakup event ID:

```text
UPSERT KEYS(event_id)
```

Tetapi pada QuestDB/time-series, timestamp tetap penting untuk partitioning dan query semantics.

Praktik aman:

```text
Use timestamp + natural identity dimensions.
Use event_id only if it is stable, globally unique, and semantically correct.
```

---

### 7.3 Jangan masukkan measured value ke key

Buruk:

```sql
DEDUP UPSERT KEYS(ts, device_id, metric, value)
```

Kenapa buruk?

Jika retry membawa value sama, duplicate terdeteksi.
Tetapi jika correction membawa value berbeda, database menganggap itu row baru.

Idempotency key harus mengidentifikasi observation, bukan isi measurement.

```text
identity != value
```

---

### 7.4 Jangan masukkan volatile metadata ke key

Buruk:

```sql
DEDUP UPSERT KEYS(ts, device_id, metric, ingestion_node, batch_id)
```

`ingestion_node` dan `batch_id` berubah antar retry, sehingga duplicate lolos.

Kolom seperti ini boleh disimpan sebagai metadata, tetapi biasanya bukan bagian identity.

---

### 7.5 Jangan terlalu sempit

Buruk:

```sql
DEDUP UPSERT KEYS(ts, device_id)
```

Jika satu device mengirim banyak metric pada timestamp sama:

```text
temp
pressure
humidity
```

mereka akan saling overwrite.

---

### 7.6 Jangan terlalu lebar

Buruk:

```sql
DEDUP UPSERT KEYS(ts, tenant, device_id, metric, firmware_version, gateway_id, trace_id)
```

Jika `trace_id` berubah per retry, duplicate tidak terdeteksi.
Jika `firmware_version` berubah karena enrichment berbeda, observation menjadi ganda.

---

## 8. Pattern Key per Domain

### 8.1 IoT metric sample

```sql
DEDUP UPSERT KEYS(ts, tenant, device_id, metric)
```

Cocok jika setiap device hanya punya satu nilai per metric per timestamp.

Jika sensor punya channel:

```sql
DEDUP UPSERT KEYS(ts, tenant, device_id, channel, metric)
```

---

### 8.2 Market trade

Jika exchange menyediakan trade ID:

```sql
DEDUP UPSERT KEYS(venue, instrument, trade_id)
```

Atau lebih konservatif:

```sql
DEDUP UPSERT KEYS(ts, venue, instrument, trade_id)
```

Jika trade ID tidak stabil:

```sql
DEDUP UPSERT KEYS(ts, venue, instrument, price, size, side)
```

Namun memasukkan price/size sebagai key bisa bermasalah jika correction terjadi. Untuk market data, pahami contract source sebelum menentukan key.

---

### 8.3 Application counter bucket

Untuk pre-bucketed metrics:

```sql
DEDUP UPSERT KEYS(bucket_ts, service, instance, metric, label_hash)
```

Jika setiap flush mengirim delta, jangan dedup sebagai overwrite kecuali semantics memang “value for bucket”.

Counter delta dan bucket aggregate berbeda.

```text
counter delta event: append fact
bucket aggregate: upsert fact
```

---

### 8.4 State snapshot

```sql
DEDUP UPSERT KEYS(ts, entity_id, state_name)
```

Untuk latest-state query, bisa juga menyimpan state transitions append-only lalu query `LATEST ON`. Tetapi jika snapshot dikirim ulang, dedup berguna.

---

### 8.5 Regulatory audit/event trail

Biasanya jangan overwrite.

Gunakan append-only:

```text
event_id as immutable identity
revision event as new row
correction as separate correcting event
```

Untuk audit defensibility, correction sering harus preserve history, bukan mengganti masa lalu.

---

## 9. Duplicate vs Correction Policy

Sebelum mengaktifkan dedup, putuskan policy.

### 9.1 Policy A: duplicate overwrite is acceptable

Cocok untuk:

```text
sensor reading final value
bucketed aggregate
latest known measurement
market data vendor correction where final truth matters
```

Model:

```text
same key + new value => replace logical row
```

Kelebihan:

- Query sederhana.
- Raw table mencerminkan latest truth.
- Retry/replay aman.

Kekurangan:

- History correction hilang.
- Sulit audit perubahan nilai.

---

### 9.2 Policy B: correction as new revision

Cocok untuk:

```text
audit trail
compliance data
financial adjustment history
case management lifecycle events
```

Model:

```text
same business subject + higher revision_no => new row
```

Key:

```sql
DEDUP UPSERT KEYS(event_id, revision_no)
```

Atau tanpa dedup di raw table, lalu serving view memilih latest revision.

Kelebihan:

- History lengkap.
- Defensible.
- Bisa menjawab “apa yang diketahui saat itu?”.

Kekurangan:

- Query lebih kompleks.
- Butuh latest-view/materialized view.

---

### 9.3 Policy C: raw append + derived deduped serving table

Cocok untuk workload kritis dengan audit dan dashboard cepat.

Architecture:

```text
raw_events_append_only
        |
        v
validated_deduped_measurements
        |
        v
materialized rollups / APIs
```

Raw menyimpan semua arrival.
Serving table menyimpan logical truth.

Ini lebih mahal, tetapi sering paling aman untuk enterprise.

---

## 10. Producer-Side Idempotency Design di Java

### 10.1 Jangan generate timestamp baru saat retry

Buruk:

```java
sender.timestampColumn("ts", Instant.now());
```

Jika retry terjadi, timestamp berubah. Database melihat event berbeda.

Benar:

```java
Instant eventTime = observation.eventTime();
sender.timestampColumn("ts", eventTime);
```

Timestamp harus berasal dari event domain, bukan waktu retry.

---

### 10.2 Bentuk event object harus immutable

Contoh:

```java
public record SensorReadingEvent(
    Instant eventTime,
    String tenant,
    String deviceId,
    String metric,
    double value,
    String unit,
    String source,
    String eventId
) {}
```

Retry harus mengirim object yang sama secara logis.

---

### 10.3 Pisahkan idempotency identity dari payload

Contoh:

```java
public record ObservationKey(
    Instant eventTime,
    String tenant,
    String deviceId,
    String metric
) {}

public record ObservationPayload(
    double value,
    String unit,
    String quality,
    String source
) {}
```

Dengan pemisahan ini, review desain lebih jelas:

```text
Which fields identify the observation?
Which fields describe the observation?
Which fields are volatile metadata?
```

---

### 10.4 Hash key untuk DLQ/debug, bukan pengganti domain key

Boleh membuat hash:

```java
String idempotencyHash = sha256(key.tenant(), key.deviceId(), key.metric(), key.eventTime().toString());
```

Tetapi jangan menjadikan hash sebagai satu-satunya desain domain tanpa kemampuan debugging.

Raw columns tetap harus ada agar query dan incident review bisa menjawab:

```text
Duplicate apa?
Dari tenant mana?
Device apa?
Timestamp berapa?
Metric apa?
```

---

## 11. Retry Semantics: Unknown Outcome Problem

Dalam HTTP/TCP ingestion, ada failure yang jelas dan tidak jelas.

| Kondisi | Makna | Aman retry? |
|---|---|---|
| Client validation error | Data salah sebelum dikirim | Tidak, kirim DLQ |
| Server rejects schema/type | Data tidak sesuai contract | Tidak otomatis |
| Network timeout | Outcome unknown | Ya, jika idempotent |
| Connection reset after send | Outcome unknown | Ya, jika idempotent |
| 5xx transient | Server mungkin belum commit | Ya, jika idempotent + backoff |
| Disk full | Retry cepat memperburuk | Tidak, circuit break |
| WAL suspended | Retry cepat memperburuk | Tidak, route/runbook |

Rule:

```text
If outcome is unknown, retry only if duplicate is safe.
```

Jika duplicate tidak safe, producer harus memilih antara data loss dan double count. Itu desain buruk.

---

## 12. Broker + QuestDB Idempotency

### 12.1 Consumer crash scenario

Pipeline:

```text
Kafka -> Java consumer -> QuestDB
```

Failure:

```text
poll offset 100
write to QuestDB success
crash before offset commit
restart
poll offset 100 again
write again
```

Idempotent ingestion membuat ini aman.

Tanpa dedup, kamu terpaksa melakukan offset commit sebelum write atau setelah write:

| Commit Timing | Risiko |
|---|---|
| Commit before write | Data loss jika crash sebelum write |
| Commit after write | Duplicate jika crash setelah write |

Dengan dedup:

```text
commit after write + retry/reconsume safe
```

Ini pattern umum yang paling praktis.

---

### 12.2 Kafka exactly-once tidak otomatis mencakup QuestDB

Kafka transaction bisa menjamin relasi antara consume-process-produce ke Kafka topic lain.

Tetapi write ke QuestDB adalah external side effect.

Kecuali ada atomic transaction yang mencakup broker offset dan database write, end-to-end exactly-once tetap tidak otomatis.

Praktik realistis:

```text
at-least-once delivery + idempotent sink = effectively-once result
```

---

### 12.3 Offset bukan idempotency key domain

Jangan gunakan Kafka offset sebagai identity utama observation:

```text
topic + partition + offset
```

Itu hanya identity pesan broker, bukan identity domain.

Masalah:

- Backfill dari file tidak punya offset sama.
- Repartition topic mengubah partition/offset.
- Sumber yang sama bisa dikirim ke topic berbeda.
- Correction event butuh semantics domain.

Offset berguna untuk lineage/debug, bukan primary logical key.

---

## 13. Backfill and Replay Strategy

### 13.1 Backfill harus rerunnable

Backfill produksi harus memenuhi invariant:

```text
Running the same backfill twice must not corrupt logical result.
```

Jika tidak, operator akan takut rerun job dan recovery menjadi manual berbahaya.

---

### 13.2 Sort by timestamp when possible

Untuk QuestDB, historical data sebaiknya dimuat dalam urutan timestamp sebisa mungkin agar mengurangi out-of-order cost.

Backfill idempotent bukan hanya soal duplicate. Juga soal write amplification.

Recommended:

```text
1. Validate file/source.
2. Normalize timestamp.
3. Sort/group by partition interval.
4. Load partition by partition.
5. Use dedup keys.
6. Validate row count/logical count.
7. Mark backfill manifest complete.
```

---

### 13.3 Backfill manifest

Untuk job besar, simpan manifest:

```text
source_name
source_version
date_range_start
date_range_end
partition
row_count_input
row_count_accepted
hash/checksum
started_at
completed_at
status
```

Manifest bukan pengganti database dedup, tetapi membantu operasi:

```text
Apa yang sudah dimuat?
Apa yang gagal?
Apa yang aman diulang?
```

---

### 13.4 Reconcile logical count, not only physical inserted count

Karena dedup bisa overwrite/drop duplicate, jumlah row inserted tidak selalu sama dengan input row.

Validasi harus berbasis logical expectation:

```sql
SELECT
  tenant,
  device_id,
  metric,
  count(*)
FROM sensor_readings
WHERE ts >= '2026-01-01T00:00:00Z'
  AND ts <  '2026-02-01T00:00:00Z'
GROUP BY tenant, device_id, metric;
```

Bandingkan dengan source-of-truth count per key/time bucket.

---

## 14. Query-Side Dedup: Kapan Boleh?

Kadang raw table sengaja append-only, lalu query memilih latest revision.

Contoh:

```sql
SELECT *
FROM readings_raw
LATEST ON received_at
PARTITION BY ts, tenant, device_id, metric;
```

Atau membuat derived table/materialized view.

Query-side dedup boleh jika:

1. Raw history memang harus disimpan.
2. Duplicate volume masih terkendali.
3. Query serving tidak membaca raw duplicate setiap saat.
4. Ada materialized/derived latest truth layer.

Query-side dedup buruk jika:

```text
Every dashboard query has to scan duplicate raw rows forever.
```

Untuk high-volume telemetry, dedup sebaiknya sedekat mungkin dengan write/serving boundary.

---

## 15. Correction Modeling Patterns

### 15.1 Overwrite correction

Table:

```sql
CREATE TABLE measurements (
    ts TIMESTAMP,
    device_id SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    corrected BOOLEAN,
    source SYMBOL
) TIMESTAMP(ts)
PARTITION BY DAY
WAL
DEDUP UPSERT KEYS(ts, device_id, metric);
```

Correction untuk key sama akan mengganti value.

Cocok untuk:

```text
latest truth only
```

---

### 15.2 Append correction event

Table:

```sql
CREATE TABLE measurement_events (
    ts TIMESTAMP,
    device_id SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    event_type SYMBOL,       -- ORIGINAL / CORRECTION
    revision INT,
    received_at TIMESTAMP,
    source SYMBOL
) TIMESTAMP(received_at)
PARTITION BY DAY
WAL;
```

Di sini designated timestamp bisa `received_at` jika audit arrival menjadi axis utama, sedangkan event timestamp disimpan sebagai `ts`.

Cocok untuk:

```text
regulatory defensibility
arrival history
correction audit
```

---

### 15.3 Dual table: raw audit + serving truth

Raw:

```text
measurement_arrivals
```

Serving:

```text
measurement_current_truth
```

Flow:

```text
raw append -> validation/reconciliation -> deduped serving table
```

Ini pattern paling kuat untuk sistem enterprise yang butuh audit dan query cepat.

---

## 16. Idempotency Boundary Design

Tentukan boundary eksplisit.

### 16.1 Producer-only idempotency

Producer memastikan tidak mengirim duplicate.

Masalah:

- Producer bisa crash.
- Multiple producer instance.
- Replay/backfill tetap bisa duplicate.
- Database tetap tidak terlindungi dari manual import.

Jarang cukup.

---

### 16.2 Broker-level idempotency

Broker mengontrol delivery.

Masalah:

- External sink tetap side effect.
- Backfill bypass broker.
- Manual replay tetap terjadi.

Berguna, tetapi bukan akhir cerita.

---

### 16.3 Database-level dedup

Database mengenali logical duplicate.

Kuat untuk retry/replay, tetapi harus didukung key benar.

Risiko:

- Salah key menyebabkan overwrite salah atau duplicate lolos.
- Tidak menyelesaikan semantic correction jika policy belum jelas.

---

### 16.4 Layered idempotency

Desain produksi yang baik biasanya layered:

```text
producer deterministic event
+ broker at-least-once durable delivery
+ ingestion gateway validation
+ QuestDB dedup/upsert keys
+ reconciliation queries
```

Ini bukan overengineering untuk high-volume time-series; ini minimum agar retry aman.

---

## 17. Anti-Patterns

### Anti-pattern 1: “QuestDB cepat, jadi duplicate tidak masalah”

Kecepatan tidak memperbaiki kebenaran data.

Jika duplicate masuk raw metrics, semua aggregate bisa salah:

```text
sum, count, rate, avg, percentile, alert threshold
```

---

### Anti-pattern 2: timestamp memakai `now()` di ingestion gateway

Ini menghancurkan idempotency dan event-time semantics.

```text
same event retried at different time = different logical row
```

---

### Anti-pattern 3: key memasukkan batch_id

Retry batch baru berarti `batch_id` baru.
Duplicate tidak terdeteksi.

---

### Anti-pattern 4: dedup semua table tanpa domain review

Tidak semua data boleh overwrite.
Audit trail dan lifecycle events sering harus append-only.

---

### Anti-pattern 5: menggunakan Kafka offset sebagai domain identity

Offset adalah transport identity, bukan observation identity.

---

### Anti-pattern 6: correction dianggap duplicate biasa

Jika correction harus diaudit, overwrite diam-diam berbahaya.

---

### Anti-pattern 7: query-side dedup di semua dashboard

Ini memindahkan biaya dan kompleksitas ke setiap query.

---

## 18. Failure Modes

### 18.1 Duplicate storm setelah incident

Penyebab:

```text
consumer group reset
producer retries too aggressively
backfill rerun from start
```

Dampak:

- Write amplification.
- WAL backlog.
- Query result berubah jika dedup tidak aktif.
- Storage tumbuh cepat.

Mitigasi:

1. Pause producer/backfill.
2. Cek dedup key/table policy.
3. Batasi replay per partition/time range.
4. Validasi logical count.
5. Resume bertahap.

---

### 18.2 Silent overwrite karena key terlalu sempit

Gejala:

```text
row count lower than expected
some metrics disappear
latest value looks valid but incomplete
```

Penyebab:

```text
UPSERT KEYS(ts, device_id) but multiple metrics per device/timestamp
```

Mitigasi:

- Stop ingestion.
- Create corrected table with proper keys.
- Replay from source if possible.
- Compare per metric counts.

---

### 18.3 Duplicate not deduped because key too wide

Gejala:

```text
count doubles after retry/replay
same observation differs only in batch_id or trace_id
```

Mitigasi:

- Remove volatile columns from key.
- Rebuild serving table.
- Keep volatile metadata as non-key columns.

---

### 18.4 Correction lost because overwrite policy wrong

Gejala:

```text
Cannot reconstruct original value.
Audit question cannot be answered.
```

Mitigasi:

- Use raw append table for future arrivals.
- Add revision/correction event model.
- Rebuild from source audit if available.

---

## 19. Production Design Checklist

Sebelum mengaktifkan high-volume ingestion, jawab ini.

### Identity

```text
[ ] Apa logical identity satu observation?
[ ] Apakah timestamp termasuk identity?
[ ] Apakah key terlalu sempit?
[ ] Apakah key terlalu lebar?
[ ] Apakah ada volatile field dalam key?
[ ] Apakah measured value masuk key secara tidak sengaja?
```

### Timestamp

```text
[ ] Timestamp berasal dari event domain?
[ ] Retry memakai timestamp yang sama?
[ ] Time precision cukup?
[ ] Clock skew ditangani?
```

### Retry

```text
[ ] Network timeout dianggap unknown outcome?
[ ] Retry safe karena dedup aktif?
[ ] Backoff dan circuit breaker ada?
[ ] Invalid data masuk DLQ, bukan retry tak terbatas?
```

### Broker

```text
[ ] Offset commit dilakukan setelah write?
[ ] Reconsume aman?
[ ] Kafka offset tidak menjadi domain key utama?
[ ] Replay plan terdokumentasi?
```

### Correction

```text
[ ] Duplicate dan correction dibedakan?
[ ] Overwrite policy diterima domain?
[ ] Jika audit diperlukan, raw history disimpan?
[ ] Serving truth punya definisi jelas?
```

### Backfill

```text
[ ] Backfill rerunnable?
[ ] Data disortir/group by time partition?
[ ] Manifest ada?
[ ] Reconciliation query ada?
```

### Operations

```text
[ ] Duplicate storm runbook ada?
[ ] WAL lag dipantau?
[ ] Row count/logical count dipantau?
[ ] Schema/key changes direview seperti breaking change?
```

---

## 20. Java Implementation Sketch

Berikut sketch ingestion gateway sederhana.

```java
public record ObservationKey(
    Instant ts,
    String tenant,
    String deviceId,
    String metric
) {}

public record Observation(
    ObservationKey key,
    double value,
    String unit,
    String quality,
    String source
) {}

public final class ObservationValidator {
    public void validate(Observation obs) {
        if (obs.key().ts() == null) {
            throw new IllegalArgumentException("event timestamp is required");
        }
        if (obs.key().tenant() == null || obs.key().tenant().isBlank()) {
            throw new IllegalArgumentException("tenant is required");
        }
        if (obs.key().deviceId() == null || obs.key().deviceId().isBlank()) {
            throw new IllegalArgumentException("deviceId is required");
        }
        if (obs.key().metric() == null || obs.key().metric().isBlank()) {
            throw new IllegalArgumentException("metric is required");
        }
        if (!Double.isFinite(obs.value())) {
            throw new IllegalArgumentException("value must be finite");
        }
    }
}
```

Ingestion loop concept:

```java
public final class QuestDbObservationWriter {
    private final ObservationValidator validator = new ObservationValidator();

    public void writeBatch(List<Observation> observations) {
        for (Observation obs : observations) {
            validator.validate(obs);
        }

        // Pseudocode; actual Sender API details depend on client version/config.
        // Important part: use obs.key().ts(), not Instant.now().
        for (Observation obs : observations) {
            ObservationKey key = obs.key();

            // sender.table("sensor_readings")
            //     .symbol("tenant", key.tenant())
            //     .symbol("device_id", key.deviceId())
            //     .symbol("metric", key.metric())
            //     .doubleColumn("value", obs.value())
            //     .symbol("unit", obs.unit())
            //     .symbol("quality", obs.quality())
            //     .symbol("source", obs.source())
            //     .at(key.ts());
        }

        // sender.flush();
    }
}
```

Retry policy:

```text
validation error -> DLQ
schema/type error -> DLQ + alert
network timeout -> retry with same observations
5xx transient -> retry with backoff
disk/WAL pressure -> circuit break + alert
```

---

## 21. SQL Table Examples

### 21.1 Deduped sensor readings

```sql
CREATE TABLE sensor_readings (
    ts TIMESTAMP,
    tenant SYMBOL,
    device_id SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    unit SYMBOL,
    quality SYMBOL,
    source SYMBOL,
    received_at TIMESTAMP
) TIMESTAMP(ts)
PARTITION BY DAY
WAL
DEDUP UPSERT KEYS(ts, tenant, device_id, metric);
```

Use when:

```text
same device + metric + timestamp = one logical reading
correction can overwrite latest truth
```

---

### 21.2 Append-only arrival audit

```sql
CREATE TABLE sensor_reading_arrivals (
    received_at TIMESTAMP,
    event_ts TIMESTAMP,
    tenant SYMBOL,
    device_id SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    unit SYMBOL,
    quality SYMBOL,
    source SYMBOL,
    producer_id SYMBOL,
    batch_id SYMBOL,
    event_id VARCHAR
) TIMESTAMP(received_at)
PARTITION BY DAY
WAL;
```

Use when:

```text
arrival history matters
retry/replay/correction must be auditable
```

---

### 21.3 Deduped serving table from raw events

```sql
CREATE TABLE sensor_readings_serving (
    ts TIMESTAMP,
    tenant SYMBOL,
    device_id SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    unit SYMBOL,
    quality SYMBOL,
    source SYMBOL,
    source_event_id VARCHAR,
    applied_at TIMESTAMP
) TIMESTAMP(ts)
PARTITION BY DAY
WAL
DEDUP UPSERT KEYS(ts, tenant, device_id, metric);
```

Use when:

```text
raw audit and fast serving are both needed
```

---

## 22. Practical Decision Framework

Use this decision tree.

```text
Is duplicate possible?
  yes -> continue
  no  -> you are probably wrong; continue anyway

Can same logical observation be identified deterministically?
  yes -> define UPSERT KEYS
  no  -> create event_id/source sequence or accept append-only semantics

Should correction overwrite prior value?
  yes -> use deduped serving table
  no  -> use append-only revisions + latest view

Can producer retry after unknown outcome?
  yes -> require idempotency
  no  -> expect data loss or manual reconciliation

Can backfill be rerun safely?
  yes -> production-ready
  no  -> not production-ready
```

---

## 23. Hands-On Lab

### Lab 1: Duplicate-safe sensor ingestion

Design table:

```sql
CREATE TABLE lab_sensor_readings (
    ts TIMESTAMP,
    device_id SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    source SYMBOL
) TIMESTAMP(ts)
PARTITION BY DAY
WAL
DEDUP UPSERT KEYS(ts, device_id, metric);
```

Insert same logical row multiple times.

Expected:

```text
logical row count remains one per key
```

Then insert same timestamp/device but different metric.

Expected:

```text
both metrics survive
```

If not, key is wrong.

---

### Lab 2: Key too narrow

Create table with:

```sql
DEDUP UPSERT KEYS(ts, device_id)
```

Insert:

```text
ts=10:00, device=S1, metric=temp
_ts=10:00, device=S1, metric=pressure
```

Observe overwrite/collision risk.

---

### Lab 3: Key too wide

Create table with:

```sql
DEDUP UPSERT KEYS(ts, device_id, metric, batch_id)
```

Insert same event with different `batch_id`.

Observe duplicate not removed.

---

### Lab 4: Retry simulation in Java

Implement producer that:

1. Builds immutable observation list.
2. Sends batch.
3. Simulates timeout after send.
4. Retries same observations.
5. Validates logical count.

The test passes only if retry does not double logical result.

---

## 24. Summary

Deduplication bukan fitur kosmetik. Untuk time-series, deduplication adalah bagian dari correctness model.

Key ideas:

1. Duplicate normal terjadi karena retry, replay, crash, backfill, dan failover.
2. Timeout berarti outcome unknown, bukan failure pasti.
3. Idempotency butuh stable identity.
4. Dalam time-series, identity hampir selalu mencakup timestamp.
5. `UPSERT KEYS` harus merepresentasikan logical observation, bukan payload atau transport metadata.
6. Duplicate berbeda dari correction.
7. Correction bisa overwrite, append revision, atau diproses lewat raw+serving dual table.
8. Kafka exactly-once tidak otomatis membuat QuestDB write exactly-once.
9. Backfill harus rerunnable.
10. Desain terbaik biasanya layered: deterministic producer, durable broker, validation gateway, QuestDB dedup, reconciliation.

Invariant produksi:

```text
A time-series ingestion pipeline is not production-safe until retry and replay are safe.
```

---

## 25. Bridge ke Part Berikutnya

Setelah deduplication dan idempotent ingestion, kita akan masuk ke SQL temporal.

Part berikutnya:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-013.md
SQL for Time-Series: Range, Latest, Sampling, and Temporal Semantics
```

Di sana kita akan membahas bagaimana data yang sudah aman masuk ke QuestDB dibaca secara benar:

```text
time range query
latest state query
SAMPLE BY
fill semantics
calendar bucket vs fixed bucket
timezone correctness
query guardrails
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-011.md">⬅️ Ahead Log, Durability, and WAL Apply Pipeline</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-013.md">Part 013 — SQL for Time-Series: Range, Latest, Sampling, and Temporal Semantics ➡️</a>
</div>
