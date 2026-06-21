# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-007.md

# Java Ingestion Client Deep Dive

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Part: `007`  
> Target pembaca: Java software engineer / tech lead yang ingin membangun ingestion path QuestDB yang stabil, cepat, observable, dan production-safe.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas model ingestion QuestDB secara umum: ILP, PGWire, REST, CSV, dan embedded Java. Part ini lebih spesifik: bagaimana **membangun ingestion client Java** yang tidak hanya “bisa insert”, tetapi mampu bertahan di kondisi produksi:

- traffic burst,
- network jitter,
- retry,
- backpressure,
- invalid record,
- duplicate delivery,
- failover endpoint,
- schema drift,
- latency/freshness requirement,
- dan deployment multi-instance.

Tujuan akhirnya: kamu bisa mendesain ingestion service Java yang predictable, measurable, recoverable, dan tidak diam-diam merusak QuestDB.

---

## 2. Problem yang Sedang Diselesaikan

Banyak engineer pertama kali memperlakukan QuestDB ingestion seperti ini:

```java
for (Metric m : metrics) {
    insert(m);
}
```

Secara konsep terlihat benar. Tapi untuk production time-series ingestion, pertanyaan yang sebenarnya adalah:

```text
Berapa banyak row dikumpulkan sebelum dikirim?
Kapan flush terjadi?
Apa yang terjadi jika flush gagal?
Apakah retry akan membuat duplicate?
Apakah producer boleh terus menerima event saat QuestDB lambat?
Bagaimana membedakan invalid data vs temporary outage?
Apakah satu Sender aman dipakai banyak thread?
Apakah semua service instance boleh membuat schema otomatis?
Bagaimana mengukur lag dari event-time ke visible query-time?
```

QuestDB cepat, tetapi kecepatan database tidak menghapus kebutuhan desain client. Di sistem time-series, client sering menjadi sumber masalah terbesar: flush terlalu sering, batch terlalu besar, timestamp salah, tag cardinality liar, retry tanpa idempotency, atau producer tidak punya backpressure.

---

## 3. Mental Model Utama

Ingestion client bukan sekadar library. Ia adalah **write-side control plane**.

```text
Domain event / metric
        ↓
Validation & normalization
        ↓
Timestamp decision
        ↓
Cardinality guard
        ↓
Batch buffer
        ↓
Flush policy
        ↓
Transport: HTTP ILP / TCP ILP
        ↓
QuestDB WAL / table writer
        ↓
Visibility to query
```

Setiap tahap memiliki failure mode. Jika semua responsibility dilempar ke database, failure akan muncul sebagai:

- schema kacau,
- WAL lag,
- data duplicate,
- ingestion latency tinggi,
- query hasilnya tampak “hilang”,
- memory pressure,
- atau data freshness tidak konsisten.

Client Java harus memutuskan empat hal besar:

1. **Apa yang boleh dikirim?**  
   Validasi, type normalization, symbol/cardinality guard.

2. **Kapan dikirim?**  
   Batch size, time-based flush, manual flush, transactional flush.

3. **Apa yang dilakukan ketika gagal?**  
   Retry, DLQ, circuit breaker, fallback, replay.

4. **Bagaimana mengukur apakah sehat?**  
   Metrics, logs, tracing, freshness lag, queue depth, error taxonomy.

---

## 4. QuestDB Java Client: Peran dan Batas

QuestDB menyediakan official client libraries untuk ingestion menggunakan InfluxDB Line Protocol. Untuk Java, jalur utamanya adalah ILP client, bukan JDBC insert.

Secara konseptual:

```text
Java ILP client:
  - optimized untuk write throughput
  - membangun ILP line/batch
  - mengirim lewat HTTP atau TCP
  - cocok untuk metric/event ingestion

JDBC / PGWire:
  - cocok untuk query SQL
  - cocok untuk admin / DDL / low-volume SQL
  - bukan jalur ideal untuk high-throughput ingestion
```

Pemisahan ini penting. JDBC terasa familiar untuk Java engineer, tetapi time-series ingestion bukan workload OLTP insert biasa. ILP memberi jalur yang lebih langsung, sederhana, dan throughput-oriented.

---

## 5. Transport Choice: HTTP ILP vs TCP ILP

QuestDB mendukung ILP melalui HTTP dan TCP. Untuk production Java application, default pilihan sebaiknya dipikirkan seperti ini:

```text
HTTP ILP:
  - feedback/error reporting lebih jelas
  - lebih mudah ditempatkan di balik proxy/load balancer
  - mendukung request/response semantics
  - lebih mudah diobservasi dengan HTTP tooling
  - umumnya pilihan default yang lebih aman

TCP ILP:
  - lebih minimalis
  - bisa sangat cepat
  - error feedback lebih terbatas
  - failure sering perlu dicari dari server logs
  - cocok jika tim benar-benar memahami operational trade-off-nya
```

Untuk sebagian besar sistem enterprise Java, **HTTP ILP lebih mudah dibuat reliable** karena client bisa menerima response error, membedakan beberapa jenis failure, dan mengintegrasikan retry/circuit breaker dengan lebih natural.

TCP ILP bukan salah. Tetapi TCP ILP menggeser lebih banyak responsibility observability ke operator. Jika ada invalid line atau schema conflict, sinyal error tidak senyaman HTTP.

---

## 6. Sender Lifecycle

Pola dasar client biasanya seperti ini:

```java
try (Sender sender = Sender.fromConfig("http::addr=localhost:9000;")) {
    sender.table("sensor_readings")
          .symbol("site", "factory-a")
          .symbol("device_id", "dev-001")
          .doubleColumn("temperature", 23.8)
          .longColumn("rpm", 1480)
          .atNow();

    sender.flush();
}
```

Namun production lifecycle tidak boleh membuat `Sender` per row.

Anti-pattern:

```java
for (Metric metric : metrics) {
    try (Sender sender = Sender.fromConfig(config)) {
        write(metric, sender);
        sender.flush();
    }
}
```

Masalah:

- membuka/menutup connection terlalu sering,
- flush terlalu kecil,
- throughput buruk,
- latency tidak stabil,
- pressure tinggi ke QuestDB,
- sulit mengatur retry dan metrics.

Pattern yang lebih sehat:

```text
Application start
    create ingestion component
    create one or more long-lived Sender instances
    receive/validate events
    append to bounded queue or local buffer
    batch writes
    flush by size/time/pressure
Application shutdown
    stop accepting new events
    drain bounded buffer
    final flush with timeout
    close Sender
```

Lifecycle harus eksplisit. `Sender` bukan util static untuk dipanggil sembarang tempat.

---

## 7. Threading Model

Pertanyaan penting: apakah satu `Sender` dipakai bersama banyak thread?

Untuk production design, lebih aman memakai model:

```text
many producer threads
        ↓
bounded queue / ring buffer / channel
        ↓
one ingestion worker owns one Sender
        ↓
QuestDB
```

Atau:

```text
partitioned producers by table/tenant/device-group
        ↓
N bounded queues
        ↓
N ingestion workers
        ↓
N Sender instances
        ↓
QuestDB
```

Model “one owner per Sender” mengurangi risiko concurrency bug, flush race, buffer interleaving, dan error handling ambigu.

Contoh arsitektur sederhana:

```text
HTTP API / Kafka Consumer / Scheduler
        ↓
MetricNormalizer
        ↓
CardinalityGuard
        ↓
BlockingQueue<IngestionRecord>
        ↓
QuestDbIngestionWorker
        ↓
Sender
        ↓
QuestDB HTTP ILP
```

Jika throughput butuh parallelism, parallelize berdasarkan ownership yang jelas:

- per table,
- per tenant group,
- per partition of Kafka topic,
- per metric family,
- atau consistent hash dari device id.

Jangan parallelize secara random tanpa memahami ordering dan duplicate behavior.

---

## 8. Batching Strategy

Batching adalah salah satu tuning paling penting.

Flush terlalu sering:

```text
row → flush
row → flush
row → flush
```

Dampaknya:

- banyak request kecil,
- overhead network tinggi,
- throughput rendah,
- CPU QuestDB terpakai untuk request overhead,
- latency per row bisa tampak rendah tetapi throughput buruk.

Flush terlalu jarang:

```text
1 juta row di buffer sebelum flush
```

Dampaknya:

- memory client membesar,
- data freshness buruk,
- jika flush gagal blast radius besar,
- shutdown drain lama,
- retry mahal.

Policy yang umum:

```text
flush jika rows >= N
atau bytes >= B
atau elapsed >= T
atau shutdown/drain
atau pressure signal
```

Contoh parameter awal untuk aplikasi Java moderate throughput:

```text
max_rows_per_batch: 5_000 - 50_000
max_flush_interval: 100ms - 2s
max_buffer_bytes: explicit limit
max_shutdown_drain_time: bounded
```

Nilai pasti harus diuji dengan dataset dan hardware sendiri. Jangan copy angka benchmark publik tanpa konteks.

---

## 9. Freshness vs Throughput

Ada trade-off fundamental:

```text
flush lebih sering  → freshness lebih baik, throughput lebih rendah
flush lebih jarang  → throughput lebih baik, freshness lebih buruk
```

Untuk dashboard real-time, mungkin freshness 1 detik cukup. Untuk trading analytics, mungkin puluhan milidetik penting. Untuk industrial telemetry, 5-30 detik mungkin masih acceptable.

Jangan memakai kata “real-time” tanpa angka. Definisikan:

```text
p95 event-to-visible latency <= 2s
p99 event-to-visible latency <= 10s
max tolerated data gap <= 60s
```

Lalu desain flush policy berdasarkan angka itu.

---

## 10. Timestamp Handling

ILP row dapat memakai timestamp eksplisit atau server/current time. Untuk time-series production, timestamp eksplisit biasanya lebih benar.

```java
sender.table("sensor_readings")
      .symbol("device_id", "dev-001")
      .doubleColumn("temperature", 23.8)
      .at(timestampNanos);
```

Mental model:

```text
atNow(): ingestion-time semantics
at(explicit): event-time semantics
```

Gunakan `atNow()` jika event memang berarti “observasi diterima sekarang”.  
Gunakan explicit timestamp jika event terjadi di device, exchange, service, atau upstream system pada waktu tertentu.

Kesalahan timestamp bisa lebih berbahaya daripada data hilang:

- data masuk ke partition masa depan,
- query range tidak menemukan data,
- TTL menghapus data terlalu cepat/lambat,
- out-of-order storm,
- ASOF join salah,
- rollup salah bucket.

Production client sebaiknya validasi timestamp:

```text
reject if timestamp too far in future
flag if timestamp too old
track skew by producer/device
normalize unit: millis/micros/nanos
store ingest timestamp if needed
```

Untuk event dari Java, hati-hati dengan unit:

```text
System.currentTimeMillis()       -> milliseconds
Instant.now().toEpochMilli()     -> milliseconds
Instant + nanos                  -> needs conversion
QuestDB TIMESTAMP_NS / ILP       -> commonly nanosecond epoch at wire level
```

Kesalahan ms vs ns adalah failure klasik.

---

## 11. Type Mapping dari Java ke QuestDB

Contoh mapping:

| Java Concept | QuestDB Column | Catatan |
|---|---|---|
| `String` finite dimension | `SYMBOL` | untuk tag/device/site/status berulang |
| `String` free text | `VARCHAR` / `STRING` | jangan jadi symbol jika cardinality liar |
| `double` metric | `DOUBLE` | default aman untuk banyak measurement |
| `long` counter | `LONG` | cocok untuk monotonic counter, count, sequence |
| `int` small value | `INT` | gunakan jika range jelas |
| `boolean` state | `BOOLEAN` | untuk flags |
| `Instant` event time | `TIMESTAMP` / `TIMESTAMP_NS` | pilih presisi sesuai domain |
| enum Java | `SYMBOL` | jika vocabulary bounded |
| JSON object | biasanya anti-pattern | flatten field penting; simpan raw hanya bila perlu |

Rule penting:

```text
Tag / dimension → symbol jika bounded dan sering difilter/grouped.
Measurement → numeric/boolean/string column.
Raw payload → jangan menjadi pusat model query.
```

---

## 12. Cardinality Guard di Client

Cardinality explosion sering berasal dari producer, bukan database.

Contoh buruk:

```text
symbol request_id=9f8a-...
symbol trace_id=...
symbol user_agent=Mozilla/...
symbol error_message="timeout on host x..."
```

Itu bukan dimension stabil. Itu high-cardinality payload.

Client Java sebaiknya punya guard:

```java
public final class CardinalityGuard {
    private final Set<String> allowedSymbolColumns = Set.of(
        "tenant_id", "site", "device_id", "metric", "status"
    );

    public void validateSymbol(String column, String value) {
        if (!allowedSymbolColumns.contains(column)) {
            throw new IllegalArgumentException("symbol column not allowed: " + column);
        }
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("blank symbol: " + column);
        }
        if (value.length() > 128) {
            throw new IllegalArgumentException("symbol too long: " + column);
        }
    }
}
```

Lebih advanced:

```text
per-column max distinct estimate
per-tenant cardinality quota
sampled HyperLogLog estimate
reject/route high-cardinality event to DLQ
alert on new symbol cardinality spike
```

Jangan tunggu database menjadi lambat untuk menyadari cardinality rusak.

---

## 13. Validation and Normalization Layer

Sebelum menulis ke QuestDB, client harus memisahkan:

```text
valid record
invalid record
temporarily unwriteable record
unknown/error record
```

Contoh validation:

```java
public record SensorReading(
    String tenantId,
    String site,
    String deviceId,
    Instant observedAt,
    Double temperature,
    Long rpm,
    String quality
) {}
```

Validasi:

```text
tenantId present
deviceId present
observedAt present
temperature finite, not NaN/Infinity
rpm non-negative if domain requires
quality in allowed enum
observedAt not > now + allowedSkew
observedAt not < retention lower bound unless backfill mode
```

Kenapa `NaN` dan `Infinity` penting? Karena data numeric dari sensor/analytics sering membawa nilai invalid. Tentukan policy:

```text
reject record
write NULL
write quality flag
route to dead-letter
```

Jangan biarkan setiap producer menafsirkan sendiri.

---

## 14. Retry Semantics

Retry harus menjawab dua pertanyaan:

```text
Apakah error transient?
Apakah retry aman secara idempotency?
```

Error transient:

- connection timeout,
- temporary 5xx,
- QuestDB restart,
- load balancer reset,
- network partition singkat.

Error permanent:

- invalid line format,
- unknown/disallowed column,
- type conflict,
- authentication failure,
- timestamp impossible,
- schema governance violation.

Retry permanent error hanya memperbesar noise. Permanent error harus masuk DLQ atau rejected metric stream.

Retry transient tanpa dedup bisa menciptakan duplicate. Maka ingestion design harus memilih salah satu:

```text
1. tolerate duplicate at query layer
2. enable QuestDB dedup/upsert keys
3. make upstream exactly-once enough for practical domain
4. use deterministic event id/correction model
```

Di TSDB, “at-least-once + idempotent write” biasanya lebih realistis daripada “exactly once end-to-end”.

---

## 15. Idempotency Boundary

Untuk QuestDB deduplication, designated timestamp biasanya harus menjadi bagian dari dedup/upsert key. Client harus memahami key tersebut sejak awal.

Contoh natural key untuk sensor:

```text
tenant_id + device_id + metric + observed_at
```

Contoh natural key untuk market trade:

```text
venue + symbol + trade_id + ts
```

Contoh natural key untuk application metric:

```text
service + instance + metric + bucket_start
```

Jika client tidak punya natural key, retry dapat menciptakan duplicate yang sulit dibersihkan.

Pattern:

```text
Event identity ditentukan di domain layer,
bukan di QuestDB saat sudah terlambat.
```

---

## 16. Backpressure

Backpressure menjawab: apa yang terjadi jika QuestDB atau network lebih lambat daripada producer?

Tanpa backpressure:

```text
producer terus menerima event
queue unbounded tumbuh
heap naik
GC pressure naik
service mati
semua data di memory hilang
```

Gunakan bounded queue:

```java
BlockingQueue<IngestionRecord> queue = new ArrayBlockingQueue<>(100_000);
```

Policy saat penuh:

| Policy | Cocok Untuk | Risiko |
|---|---|---|
| block producer | critical data | upstream latency naik |
| drop newest | non-critical metrics | kehilangan data baru |
| drop oldest | dashboard telemetry | gap historis kecil |
| spill to disk | high-value data | kompleksitas operasional |
| route to broker/DLQ | durable pipeline | latency naik |
| shed tenant | multi-tenant fairness | perlu policy bisnis |

Untuk regulatory/financial data, drop diam-diam hampir selalu salah. Untuk high-volume debug metrics, drop dengan counter eksplisit mungkin acceptable.

Backpressure harus terlihat di metrics:

```text
queue_depth
queue_remaining_capacity
dropped_records_total
blocked_producer_duration
flush_duration
retry_count
oldest_record_age
```

---

## 17. Ingestion Worker Pattern

Skeleton konseptual:

```java
public final class QuestDbIngestionWorker implements Runnable {
    private final BlockingQueue<IngestionRecord> queue;
    private final Sender sender;
    private final int maxRows;
    private final Duration maxInterval;
    private volatile boolean running = true;

    public void run() {
        List<IngestionRecord> batch = new ArrayList<>(maxRows);
        long lastFlushNanos = System.nanoTime();

        while (running || !queue.isEmpty()) {
            try {
                IngestionRecord first = queue.poll(50, TimeUnit.MILLISECONDS);
                if (first != null) {
                    batch.add(first);
                    queue.drainTo(batch, maxRows - batch.size());
                }

                boolean rowLimit = batch.size() >= maxRows;
                boolean timeLimit = Duration.ofNanos(System.nanoTime() - lastFlushNanos)
                                            .compareTo(maxInterval) >= 0;

                if (!batch.isEmpty() && (rowLimit || timeLimit || !running)) {
                    writeBatch(batch);
                    sender.flush();
                    batch.clear();
                    lastFlushNanos = System.nanoTime();
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                running = false;
            } catch (Exception e) {
                handleFlushFailure(batch, e);
                batch.clear();
                lastFlushNanos = System.nanoTime();
            }
        }
    }
}
```

Ini bukan copy-paste final, tetapi menggambarkan invariant:

```text
one worker owns the Sender
batch has bounded size
flush has bounded interval
shutdown drains queue
failure handling explicit
```

---

## 18. Handling Flush Failure

Ketika flush gagal, jangan langsung `batch.clear()` tanpa policy. Tentukan klasifikasi:

```text
Transient failure:
  retry with bounded exponential backoff
  maybe keep batch
  maybe pause intake
  circuit breaker open

Permanent failure:
  split batch to find bad record
  route bad records to DLQ
  continue after quarantine

Unknown failure:
  preserve batch if high-value
  log structured context
  alert
```

Batch failure sering membuat dilema: satu record buruk bisa menggagalkan batch. Strategi umum:

```text
on batch failure:
  if error indicates invalid data:
      binary split batch or validate all rows
      isolate bad record(s)
      DLQ bad record(s)
      retry good records
  else if transient:
      retry full batch
  else:
      stop ingestion worker and alert
```

Untuk high-throughput pipeline, binary split mahal tetapi berguna saat error jarang. Untuk data yang sudah tervalidasi ketat, permanent failure harus sangat jarang.

---

## 19. Dead-Letter Queue

DLQ bukan tempat sampah. DLQ adalah audit trail untuk record yang tidak bisa ditulis.

Isi DLQ minimal:

```json
{
  "source": "sensor-gateway-7",
  "table": "sensor_readings",
  "received_at": "2026-06-21T10:12:33Z",
  "event_timestamp": "2026-06-21T10:12:30Z",
  "reason": "INVALID_SYMBOL_CARDINALITY",
  "error": "symbol column request_id is not allowed",
  "payload": { }
}
```

DLQ harus punya:

- reason code,
- original payload,
- normalized payload jika ada,
- failure time,
- source identity,
- replay eligibility,
- tenant/domain key.

Jangan hanya log string error. Log hilang, tidak mudah di-replay, dan sering tidak cukup untuk rekonsiliasi.

---

## 20. Circuit Breaker

Jika QuestDB unavailable, client harus melindungi diri dan upstream.

State sederhana:

```text
CLOSED:
  normal writes

OPEN:
  writes paused/rejected/spooled
  fast fail producers

HALF_OPEN:
  test limited writes
  close if healthy
  reopen if failed
```

Trigger:

```text
N consecutive flush failures
flush latency > threshold for M windows
queue depth > critical threshold
oldest event age > freshness SLA
```

Action saat OPEN tergantung domain:

- stop consumer dari Kafka sementara,
- pause polling device gateway,
- return 503 to metric producers,
- spill local disk,
- route to broker,
- degrade dashboard freshness.

Circuit breaker harus menghindari retry storm.

---

## 21. Multi-Endpoint and Failover

QuestDB Java client mendukung konfigurasi lebih dari satu address pada versi modern tertentu. Secara arsitektural, ini berguna untuk:

```text
primary QuestDB endpoint unavailable
        ↓
client switches to another writable endpoint
        ↓
ingestion continues with reduced disruption
```

Namun failover bukan pengganti desain HA end-to-end. Pertanyaan yang tetap harus dijawab:

```text
Apakah endpoint kedua menerima write untuk table yang sama?
Apakah replication lag acceptable?
Apakah dedup aktif?
Apa yang terjadi pada in-flight batch?
Apakah producer retry bisa menulis batch sama ke dua endpoint?
Bagaimana query service tahu endpoint mana yang authoritative?
```

Untuk high-value data, failover harus diuji dengan failure injection, bukan diasumsikan bekerja karena config mendukung multiple addresses.

---

## 22. Schema Creation: Convenience vs Governance

ILP dapat membuat table/column otomatis tergantung konfigurasi dan mode. Ini berguna saat eksperimen, tetapi berbahaya di production.

Production recommendation:

```text
Dev / sandbox:
  auto table/column creation allowed

Staging:
  allowed only for controlled test

Production:
  prefer explicit DDL / migration
  reject unknown table/column at producer gateway
```

Masalah auto schema:

```text
temperature typo → temprature column baru
status as string today, symbol tomorrow → type conflict
new tenant sends arbitrary label → cardinality explosion
producer version mismatch → silent data fragmentation
```

Gunakan schema contract:

```yaml
table: sensor_readings
timestamp: observed_at
symbols:
  tenant_id: bounded
  site: bounded
  device_id: controlled
  quality: enum
columns:
  temperature: double nullable
  rpm: long nullable
  ingest_ts: timestamp
```

Java producer harus validasi terhadap contract tersebut.

---

## 23. Handling Multiple Tables

Satu service sering menulis ke beberapa table:

```text
sensor_readings
machine_state
device_heartbeat
ingestion_errors
```

Pilihan desain:

```text
one Sender, mixed tables:
  simple
  but failure blast radius can cross table

one worker/Sender per table:
  isolation better
  tuning per workload
  more resources

one worker per table group:
  compromise
```

Untuk production, pertimbangkan isolasi jika:

- satu table high-throughput,
- satu table punya schema sering berubah,
- satu table critical dan tidak boleh terpengaruh telemetry noisy,
- retention/partition berbeda jauh,
- failure policy berbeda.

---

## 24. Kafka Consumer to QuestDB Pattern

Karena kamu sudah punya konteks Kafka, kita tidak mengulang consumer group theory. Fokusnya di bridge design.

Pattern umum:

```text
Kafka topic partition
        ↓
consumer instance
        ↓
validate/normalize
        ↓
QuestDB ILP batch
        ↓
flush success
        ↓
commit Kafka offset
```

Invariant penting:

```text
Commit offset setelah batch berhasil durable/accepted.
```

Jika offset dicommit sebelum flush sukses, data bisa hilang. Jika flush sukses lalu commit gagal, data bisa ditulis ulang saat consumer restart. Maka dedup/idempotency penting.

Pseudo flow:

```text
poll records
normalize
write to Sender buffer
flush
if flush success:
    commit offsets
else:
    do not commit
    retry or pause partition
```

Untuk batch multi-partition, hati-hati commit partial. Lebih mudah menjaga satu ingestion worker per assigned partition atau tracking offset per partition secara eksplisit.

---

## 25. Query Visibility and Freshness Measurement

Flush success bukan selalu sama dengan “semua dashboard sudah melihat data dengan latency nol”. Ukur freshness end-to-end:

```text
event_time → producer_receive_time → client_flush_start → client_flush_success → query_visible_time
```

Tambahkan kolom jika perlu:

```sql
ingest_ts TIMESTAMP
```

Atau kirim metric khusus:

```text
questdb_ingestion_client_flush_duration_ms
questdb_ingestion_client_batch_rows
questdb_ingestion_client_oldest_event_age_ms
questdb_ingestion_client_queue_depth
questdb_ingestion_client_records_rejected_total
questdb_ingestion_client_records_written_total
```

Freshness query contoh:

```sql
SELECT
  max(observed_at) AS latest_observed,
  now() - max(observed_at) AS source_lag
FROM sensor_readings
WHERE tenant_id = 'tenant-a';
```

Jika menyimpan `ingest_ts`:

```sql
SELECT
  max(ingest_ts - observed_at) AS max_ingest_lag,
  avg(ingest_ts - observed_at) AS avg_ingest_lag
FROM sensor_readings
WHERE observed_at > dateadd('m', -5, now());
```

Bedakan:

```text
source lag: device/upstream terlambat
client lag: queue/batch/retry terlambat
QuestDB lag: accepted but apply/query visible delayed
query lag: dashboard range/filter/materialized view delay
```

---

## 26. Structured Logging

Log ingestion harus bisa menjawab incident:

```text
batch apa yang gagal?
berapa row?
table apa?
range timestamp apa?
tenant/device apa?
error permanent atau transient?
retry ke berapa?
offset Kafka berapa?
```

Contoh structured fields:

```text
component=questdb-ingestion-worker
table=sensor_readings
batch_rows=10000
batch_min_ts=2026-06-21T10:00:00Z
batch_max_ts=2026-06-21T10:00:05Z
flush_duration_ms=83
transport=http_ilp
attempt=1
result=success
```

Untuk failure:

```text
result=failure
error_class=TRANSIENT_NETWORK_TIMEOUT
retryable=true
queue_depth=87321
oldest_record_age_ms=4200
```

Jangan log seluruh payload untuk volume besar kecuali sampling atau DLQ. Hindari bocor PII/secrets.

---

## 27. Metrics yang Wajib Ada di Java Client

Minimum:

```text
records_received_total
records_validated_total
records_rejected_total
records_written_total
records_failed_total
batches_flushed_total
batch_rows_histogram
batch_bytes_histogram
flush_duration_histogram
flush_failures_total by reason
retry_attempts_total
queue_depth_gauge
oldest_queued_record_age_gauge
client_event_to_flush_lag_histogram
sender_reconnects_total
circuit_breaker_state
```

Untuk multi-tenant:

```text
records_rejected_total{tenant, reason}
queue_depth{worker}
flush_failures_total{table, reason}
```

Hati-hati label cardinality di metrics system. Jangan pakai `device_id` sebagai Prometheus label jika jumlah device besar.

---

## 28. Shutdown Semantics

Shutdown buruk menyebabkan data hilang.

Urutan sehat:

```text
1. stop accepting new input
2. pause Kafka / API / scheduler
3. let queue drain until timeout
4. flush remaining batch
5. close Sender
6. commit final offsets if relevant
7. exit
```

Jangan:

```text
kill process while batch in memory
close Sender without checking failure
commit upstream offsets before final flush
unbounded drain forever during deployment shutdown
```

Kubernetes note:

```text
terminationGracePeriodSeconds harus cukup untuk drain normal
preStop hook bisa pause intake
readiness probe harus false saat draining
```

---

## 29. Configuration Design

Contoh config ingestion service:

```yaml
questdb:
  ilp:
    protocol: http
    endpoints:
      - questdb-1.internal:9000
      - questdb-2.internal:9000
    auth:
      usernameRef: QUESTDB_USER
      passwordRef: QUESTDB_PASSWORD
    connectTimeoutMs: 2000
    requestTimeoutMs: 10000
    retryTimeoutMs: 30000

  ingestion:
    workers: 4
    maxRowsPerBatch: 10000
    maxFlushIntervalMs: 500
    queueCapacity: 200000
    shutdownDrainTimeoutSeconds: 30
    futureTimestampToleranceSeconds: 60
    oldTimestampWarningDays: 7
    allowAutoSchema: false
```

Config harus bisa berubah tanpa rebuild. Tapi jangan membuat semua parameter dynamic jika tidak ada operational discipline.

---

## 30. Security Considerations

Client Java harus memperlakukan QuestDB credentials seperti production secrets:

```text
no credentials in code
no credentials in logs
rotate credentials
TLS if crossing untrusted network
network allowlist
separate write credentials from query/admin credentials
```

Untuk multi-service environment:

```text
service A hanya boleh menulis table A/B
service B hanya query table C
admin DDL tidak dari ingestion service
```

Jika environment belum mendukung granular privilege yang dibutuhkan di semua surface, enforce tambahan di network/service layer.

---

## 31. Testing Strategy

Unit test:

```text
metric normalization
timestamp conversion
symbol validation
field type mapping
invalid payload rejection
batch split logic
retry classifier
```

Integration test:

```text
start QuestDB testcontainer/container
create schema explicitly
send ILP rows
query via JDBC
verify count/range/types
verify duplicate behavior if dedup enabled
```

Load test:

```text
generate realistic cardinality
generate realistic timestamp skew
generate bursts
generate invalid records
measure p95/p99 flush latency
measure event-to-visible lag
measure QuestDB WAL/table health
```

Failure injection:

```text
QuestDB restart during flush
network timeout
invalid schema line
disk pressure simulation
slow query concurrent with ingestion
Kafka consumer crash after flush before commit
```

Tanpa failure injection, retry design hanya teori.

---

## 32. Anti-Patterns

### Anti-pattern 1: JDBC Insert untuk Semua Data

```text
Karena Java familiar dengan JDBC, semua write lewat INSERT.
```

Masalah:

- throughput tidak optimal,
- overhead SQL tinggi,
- lebih sulit batching besar,
- tidak mengikuti design center QuestDB ingestion.

Gunakan ILP client untuk high-throughput write.

---

### Anti-pattern 2: Sender per Row

Masalah:

- connection churn,
- flush overhead,
- throughput buruk,
- resource waste.

Gunakan long-lived Sender owned by worker.

---

### Anti-pattern 3: Unbounded Queue

Masalah:

- failure berubah menjadi memory leak,
- GC storm,
- service mati,
- data hilang.

Gunakan bounded queue dan explicit overflow policy.

---

### Anti-pattern 4: Retry Semua Error

Masalah:

- invalid data diulang terus,
- QuestDB/log penuh noise,
- queue makin tertahan,
- incident makin lama.

Klasifikasikan transient vs permanent.

---

### Anti-pattern 5: Timestamp dari Server untuk Semua Event

Masalah:

- event-time semantics hilang,
- late data tidak terlihat sebagai late,
- ASOF/window query salah,
- replay mengubah waktu historis.

Gunakan explicit event timestamp bila domain memang punya waktu observasi.

---

### Anti-pattern 6: Semua String Jadi Symbol

Masalah:

- cardinality explosion,
- memory pressure,
- query/index behavior buruk.

Symbol hanya untuk dimension bounded/berulang/sering difilter.

---

### Anti-pattern 7: Tidak Ada DLQ

Masalah:

- data gagal hanya hilang di log,
- tidak bisa replay,
- audit buruk,
- sulit root cause.

DLQ record penting untuk production ingestion.

---

## 33. Reference Architecture: Java Ingestion Gateway

```text
                 ┌────────────────────┐
                 │  Producers          │
                 │  apps/devices/jobs  │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ Ingestion API /     │
                 │ Kafka Consumer      │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ Contract Validator  │
                 │ type/timestamp/tag  │
                 └─────────┬──────────┘
                           │
                 ┌─────────┴─────────┐
                 │                   │
                 ▼                   ▼
       ┌──────────────────┐  ┌──────────────────┐
       │ Bounded Queue     │  │ DLQ / Reject Log  │
       └────────┬─────────┘  └──────────────────┘
                │
                ▼
       ┌──────────────────┐
       │ Ingestion Worker  │
       │ owns Sender       │
       └────────┬─────────┘
                │
                ▼
       ┌──────────────────┐
       │ QuestDB HTTP ILP  │
       └────────┬─────────┘
                │
                ▼
       ┌──────────────────┐
       │ QuestDB WAL/Table │
       └──────────────────┘
```

Supporting components:

```text
metrics exporter
structured logger
circuit breaker
config provider
schema contract registry
replay tool
health/readiness endpoint
```

---

## 34. Production Checklist

Sebelum production:

```text
[ ] ingestion transport dipilih secara sadar: HTTP/TCP
[ ] Sender lifecycle long-lived, bukan per row
[ ] ownership Sender jelas per worker/thread
[ ] batching policy punya max rows, max bytes, max interval
[ ] queue bounded
[ ] overflow policy terdokumentasi
[ ] timestamp unit tervalidasi
[ ] future timestamp tolerance ada
[ ] old timestamp/backfill mode ada
[ ] symbol cardinality guard ada
[ ] schema contract eksplisit
[ ] unknown table/column policy jelas
[ ] retry classifier transient/permanent ada
[ ] DLQ tersedia
[ ] dedup/idempotency strategy jelas
[ ] Kafka offset commit setelah successful flush jika memakai Kafka
[ ] metrics client lengkap
[ ] structured logs cukup untuk incident
[ ] shutdown drain diuji
[ ] QuestDB restart during flush diuji
[ ] load test memakai cardinality realistis
[ ] failure injection pernah dilakukan
[ ] security credential tidak hardcoded
[ ] endpoint failover diuji jika digunakan
```

---

## 35. Hands-On Exercise

Buat mini ingestion service Java dengan requirement:

```text
Input:
  generated sensor readings 50k rows/sec
  1,000 devices
  10 sites
  fields: temperature, humidity, rpm
  explicit event timestamp

Output:
  QuestDB table sensor_readings

Constraints:
  p95 event-to-flush latency <= 1s
  bounded queue 100k records
  reject future timestamp > 60s
  reject unknown quality value
  DLQ invalid records to local file
  metrics exposed via Micrometer/Prometheus
```

Langkah:

1. Create table explicitly.
2. Implement `SensorReading` record.
3. Implement validator.
4. Implement bounded queue.
5. Implement one ingestion worker with one Sender.
6. Batch flush by `10_000 rows` or `500ms`.
7. Add metrics.
8. Simulate QuestDB restart while load berjalan.
9. Verify no unbounded memory growth.
10. Query latest data and event freshness.

Contoh query verifikasi:

```sql
SELECT count()
FROM sensor_readings
WHERE observed_at > dateadd('m', -1, now());
```

```sql
SELECT site, device_id, latest(temperature)
FROM sensor_readings
LATEST ON observed_at PARTITION BY site, device_id;
```

```sql
SELECT
  site,
  avg(temperature),
  min(temperature),
  max(temperature)
FROM sensor_readings
WHERE observed_at > dateadd('m', -10, now())
SAMPLE BY 1m;
```

---

## 36. Ringkasan

Java ingestion client untuk QuestDB harus diperlakukan sebagai komponen produksi, bukan helper library.

Prinsip utama:

```text
Use ILP for high-throughput ingestion.
Prefer HTTP ILP for feedback and operational simplicity unless TCP is deliberately chosen.
Keep Sender lifecycle long-lived and owned by a clear worker.
Batch intentionally.
Use bounded queues.
Validate timestamp, type, schema, and cardinality before sending.
Classify failures before retry.
Make retry idempotent or dedup-aware.
Measure freshness, queue depth, flush latency, and rejection reason.
Plan shutdown and failover.
```

QuestDB bisa menerima data sangat cepat, tetapi ingestion path yang buruk tetap bisa menghasilkan sistem yang rapuh. Engineer top-tier tidak hanya mengejar throughput; ia membangun **write path yang punya invariant, limit, observability, dan recovery story**.

---

## 37. Apa yang Berikutnya

Part berikutnya:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-008.md
Event Modeling for Time-Series: Metrics, Ticks, States, and Facts
```

Kita akan naik satu level dari client mechanics ke domain modeling: bagaimana membedakan metric sample, tick, event fact, state snapshot, correction, heartbeat, dan derived signal; lalu bagaimana menerjemahkannya menjadi table design yang benar di QuestDB.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-006.md">⬅️ Part 006 — Ingestion Model: ILP, PGWire, REST, CSV, and Embedded Java</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-008.md">Event Modeling for Time-Series: Metrics, Ticks, States, and Facts ➡️</a>
</div>
