# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-026.md

# Part 026 — Java Application Integration Patterns

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Fokus: bagaimana mengintegrasikan QuestDB ke aplikasi Java secara production-grade: ingestion service, query service, API boundary, retry, backpressure, schema contract, observability, dan failure containment.

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membahas storage, partitioning, ingestion protocol, WAL, deduplication, query semantics, materialized view, deployment, observability, failure runbook, backup/DR, dan security.

Part ini menyatukan semuanya dari perspektif aplikasi Java.

Target setelah menyelesaikan part ini:

1. Bisa mendesain boundary antara aplikasi Java dan QuestDB.
2. Bisa membedakan kapan aplikasi harus menulis via ILP, kapan boleh via PGWire/JDBC.
3. Bisa membangun ingestion gateway yang aman terhadap retry, burst, duplicate, schema drift, dan backpressure.
4. Bisa membangun query service yang mencegah unbounded scan, tenant leak, cardinality explosion, dan dashboard query storm.
5. Bisa menempatkan QuestDB dalam arsitektur Spring Boot / JVM production service tanpa menjadikannya dependency yang rapuh.
6. Bisa mendefinisikan test strategy: unit, contract, integration, load, failure simulation.
7. Bisa melakukan architecture review Java + QuestDB dengan checklist yang realistis.

Dokumentasi QuestDB menegaskan prinsip integrasi penting: untuk ingestion throughput tinggi, gunakan first-party clients berbasis ILP; PGWire direkomendasikan untuk query, dan dapat dipakai untuk insert volume rendah. Jadi pola Java yang benar biasanya memisahkan **write path via ILP** dan **read path via JDBC/PGWire**.

---

## 2. Masalah yang Sering Terjadi Saat Integrasi QuestDB dari Java

Banyak kegagalan integrasi bukan karena QuestDB lambat, tetapi karena aplikasi Java memperlakukan QuestDB seperti PostgreSQL biasa atau seperti queue.

Contoh kegagalan umum:

```text
1. Semua write dilakukan via JDBC INSERT per row.
2. Producer retry tanpa idempotency key.
3. Timestamp memakai Instant.now() di gateway, bukan event timestamp dari source.
4. Query API menerima arbitrary SQL dari client internal.
5. Dashboard endpoint tidak mewajibkan time range.
6. Tenant hanya disaring di frontend.
7. Metric name, unit, dan dimension tidak divalidasi.
8. Backpressure tidak ada; kalau QuestDB lambat, memory Java membengkak.
9. Batching terlalu agresif; data freshness rusak.
10. Batching terlalu kecil; network dan flush overhead tinggi.
11. Schema auto-create dibiarkan terbuka untuk semua producer.
12. Health check hanya memeriksa TCP port, bukan freshness/WAL lag.
13. Query service mengembalikan jutaan row ke frontend.
14. Kafka consumer commit offset sebelum write outcome jelas.
15. Retry storm terjadi saat QuestDB degraded.
```

Akar masalahnya adalah tidak adanya boundary design.

Java service harus menjawab pertanyaan berikut:

```text
Apa yang boleh ditulis?
Dengan timestamp mana?
Dengan identity mana?
Dengan schema versi mana?
Dengan retry policy apa?
Jika QuestDB lambat, siapa yang menahan tekanan?
Jika query terlalu luas, siapa yang menolak?
Jika tenant mencoba akses data tenant lain, siapa yang memblokir?
Jika data late/replayed, siapa yang menentukan semantics?
```

---

## 3. Mental Model Utama

Integrasi Java + QuestDB bukan sekadar dependency client library. Ini adalah desain empat boundary:

```text
Java + QuestDB integration =
    write contract boundary
  + read contract boundary
  + operational boundary
  + failure containment boundary
```

### 3.1 Write Contract Boundary

Menentukan apa yang boleh masuk ke QuestDB.

```text
domain event
-> validation
-> timestamp selection
-> schema mapping
-> cardinality guard
-> dedup identity
-> ILP serialization
-> batching/flush
-> retry/backpressure
-> QuestDB WAL/storage
```

Boundary ini harus mencegah bad producer merusak table.

### 3.2 Read Contract Boundary

Menentukan apa yang boleh dibaca dari QuestDB.

```text
API request
-> tenant authorization
-> query template selection
-> time range validation
-> dimension validation
-> result limit
-> query timeout
-> JDBC/PGWire
-> result shaping
-> response
```

Boundary ini harus mencegah arbitrary expensive query.

### 3.3 Operational Boundary

Menentukan bagaimana aplikasi memahami kesehatan QuestDB.

```text
QuestDB reachable?             insufficient
QuestDB writable?              better
WAL apply healthy?             better
freshness within SLA?          production-relevant
query latency within SLO?      production-relevant
storage headroom safe?         production-relevant
```

### 3.4 Failure Containment Boundary

Menentukan dampak QuestDB outage terhadap sistem lain.

```text
QuestDB degraded should not automatically:
- crash all producers
- leak memory in Java
- block unrelated business transactions
- commit Kafka offsets incorrectly
- create duplicate storm
- expose stale dashboard as fresh truth
```

---

## 4. Recommended Java Integration Topology

Untuk sistem produksi, hindari setiap service menulis langsung ke QuestDB tanpa governance.

Pola yang direkomendasikan:

```text
[Domain Services]
      |
      | domain events / telemetry events
      v
[Broker or Internal Event Bus]  optional but common
      |
      v
[QuestDB Ingestion Service]
      |
      | ILP HTTP/TCP
      v
[QuestDB]
      ^
      | PGWire/JDBC
      |
[QuestDB Query Service]
      ^
      |
[Dashboards / APIs / Analysts / Internal Apps]
```

### Kenapa Ingestion Service Dipisah?

Karena ingestion ke TSDB butuh aturan lintas-producer:

```text
- schema validation
- unit normalization
- timestamp validation
- tenant/device validation
- cardinality budget
- batching policy
- retry policy
- DLQ
- observability
- backfill path
```

Kalau setiap service langsung menulis ke QuestDB, maka governance tersebar dan incident lebih sulit dikendalikan.

### Kenapa Query Service Dipisah?

Karena query time-series mudah menjadi mahal.

Query service memberi:

```text
- bounded query templates
- tenant isolation
- time range limit
- aggregation/downsample selection
- materialized view routing
- pagination/windowing
- query timeout
- result size limit
- caching policy bila diperlukan
```

---

## 5. Write Path Pattern: Java Ingestion Gateway

### 5.1 Tanggung Jawab Ingestion Gateway

Ingestion gateway bukan hanya wrapper ILP client.

Tanggung jawabnya:

```text
1. Accept internal telemetry/event messages.
2. Validate producer identity.
3. Validate event type and schema version.
4. Normalize timestamp, unit, and dimensions.
5. Enforce cardinality budget.
6. Map event to QuestDB table/columns.
7. Create stable dedup identity when needed.
8. Serialize to ILP.
9. Batch and flush safely.
10. Handle retry and ambiguous outcome.
11. Route invalid events to DLQ.
12. Expose freshness, queue depth, retry, and error metrics.
```

### 5.2 Write Path Flow

```text
Kafka / HTTP / gRPC / internal queue
        |
        v
EventEnvelope
        |
        v
SchemaValidator
        |
        v
TimestampPolicy
        |
        v
CardinalityGuard
        |
        v
QuestDbTableMapper
        |
        v
IlpBatcher
        |
        v
QuestDB Sender
        |
        v
WAL / table storage
```

### 5.3 Event Envelope

Gunakan envelope yang eksplisit.

```java
public record TelemetryEnvelope(
    String producer,
    String schemaName,
    int schemaVersion,
    String tenantId,
    String sourceId,
    String eventId,
    Instant eventTime,
    Instant observedAt,
    Map<String, String> dimensions,
    Map<String, Object> values
) {}
```

Catatan:

```text
- eventTime: waktu kejadian domain.
- observedAt: waktu source mengamati/membentuk event.
- ingestion time: bisa ditambahkan oleh gateway, tetapi jangan menggantikan eventTime.
- eventId: berguna untuk dedup/replay/correlation.
```

Jangan kirim entity bisnis mentah ke QuestDB.

Contoh buruk:

```java
public record OrderEntity(
    String id,
    String customerName,
    String address,
    String phone,
    String status,
    BigDecimal amount,
    Instant updatedAt
) {}
```

Contoh lebih benar untuk time-series fact:

```java
public record OrderStatusChangedMetric(
    String tenantId,
    String orderType,
    String region,
    String status,
    Instant changedAt,
    long count
) {}
```

---

## 6. ILP Sender Lifecycle di Java

### 6.1 Prinsip

ILP sender sebaiknya:

```text
- dibuat sebagai long-lived component
- reuse connection
- flush secara eksplisit/periodik
- close secara graceful saat shutdown
- tidak dibuat per event
- tidak dipakai tanpa backpressure boundary
```

Bad pattern:

```java
for (Metric m : metrics) {
    try (Sender sender = Sender.fromConfig(config)) {
        sender.table("metrics")
              .symbol("tenant", m.tenant())
              .doubleColumn("value", m.value())
              .at(m.timestamp(), ChronoUnit.NANOS);
    }
}
```

Masalah:

```text
- connection churn
- flush overhead tinggi
- throughput buruk
- failure handling buruk
- observability buruk
```

Better pattern secara konseptual:

```java
@Component
public final class QuestDbWriter implements AutoCloseable {
    private final Sender sender;
    private final ScheduledExecutorService flusher;

    public QuestDbWriter(QuestDbConfig config) {
        this.sender = Sender.fromConfig(config.ilpConfig());
        this.flusher = Executors.newSingleThreadScheduledExecutor();
        this.flusher.scheduleAtFixedRate(this::safeFlush, 100, 100, TimeUnit.MILLISECONDS);
    }

    public void write(DeviceSample sample) {
        sender.table("device_samples")
              .symbol("tenant_id", sample.tenantId())
              .symbol("device_id", sample.deviceId())
              .symbol("metric", sample.metric())
              .doubleColumn("value", sample.value())
              .timestampColumn("observed_at", sample.observedAt(), ChronoUnit.MICROS)
              .at(sample.eventTime(), ChronoUnit.MICROS);
    }

    private void safeFlush() {
        try {
            sender.flush();
        } catch (Exception e) {
            // increment metric, trip circuit breaker, or trigger retry strategy
        }
    }

    @Override
    public void close() {
        flusher.shutdown();
        safeFlush();
        sender.close();
    }
}
```

Catatan: API detail dapat berubah antar versi client; pattern lifecycle-nya yang penting.

### 6.2 Flush Policy

Flush policy harus menyeimbangkan throughput dan freshness.

```text
Flush too often:
- low latency
- low batching efficiency
- high network overhead
- more CPU overhead

Flush too rarely:
- better throughput
- worse freshness
- larger ambiguous batch on failure
- more memory pressure
```

Contoh policy:

```text
flush when:
- batch row count >= 10_000
- or batch bytes >= 1 MB
- or elapsed time >= 100 ms
- or shutdown requested
```

Untuk workload dashboard near-real-time, elapsed flush penting.

Untuk historical backfill, row/byte batching lebih dominan.

---

## 7. Backpressure Pattern

Java service harus punya bounded buffer.

```text
producer threads
   -> bounded queue
   -> ingestion worker(s)
   -> ILP sender
   -> QuestDB
```

Jangan gunakan unbounded queue.

Bad pattern:

```java
BlockingQueue<Event> queue = new LinkedBlockingQueue<>(); // unbounded by default
```

Better:

```java
BlockingQueue<Event> queue = new ArrayBlockingQueue<>(100_000);
```

Saat queue penuh, pilihan policy harus eksplisit:

```text
1. block producer
2. reject request with 429/503
3. shed non-critical telemetry
4. spill to durable local queue
5. route to broker/DLQ
```

Tidak ada pilihan universal. Pilih berdasarkan criticality.

### 7.1 Policy Matrix

| Event Type | Saat QuestDB Lambat | Rekomendasi |
|---|---:|---|
| audit/regulatory fact | tidak boleh hilang | broker/durable buffer, backpressure upstream |
| business KPI event | sebaiknya tidak hilang | broker + retry + DLQ |
| observability debug metric | boleh sampling/drop | bounded queue + drop policy |
| market tick | tidak boleh hilang, high volume | broker/replay log + idempotent sink |
| dashboard derived metric | bisa dihitung ulang | drop/recompute dari raw |

---

## 8. Retry, Ambiguous Outcome, and Idempotency

Retry write ke QuestDB tidak boleh diasumsikan selalu safe.

Kegagalan jaringan dapat terjadi setelah QuestDB menerima sebagian batch.

```text
client sends batch
QuestDB accepts some/all rows
network fails before client sees success
client retries batch
=> duplicate risk
```

Solusi:

```text
- gunakan dedup table untuk stream yang perlu idempotent
- desain stable key
- pisahkan duplicate-safe raw table dari correction semantics
- jangan commit Kafka offset sebelum outcome sesuai policy
```

### 8.1 Retry Classification

| Failure | Retry? | Catatan |
|---|---:|---|
| transient network timeout | yes | butuh idempotency/dedup |
| QuestDB 5xx / unavailable | yes with backoff | jangan retry storm |
| invalid schema/type | no automatic retry | DLQ dan alert |
| cardinality violation by gateway | no | producer bug |
| table suspended | pause + alert | jangan flood |
| disk full | pause | operator action |

### 8.2 Exponential Backoff dengan Jitter

```java
Duration nextDelay(int attempt) {
    long baseMs = 100;
    long maxMs = 30_000;
    long exp = Math.min(maxMs, baseMs * (1L << Math.min(attempt, 10)));
    long jitter = ThreadLocalRandom.current().nextLong(0, exp / 2 + 1);
    return Duration.ofMillis(exp / 2 + jitter);
}
```

Retry tanpa jitter menciptakan synchronized retry storm.

---

## 9. Kafka Consumer to QuestDB Pattern

Walaupun Kafka sudah pernah dibahas di seri lain, integrasi ke QuestDB punya detail khusus.

### 9.1 Safe Consumer Flow

```text
poll records
-> validate/map
-> write batch to QuestDB
-> flush
-> commit offsets only after write policy satisfied
```

Pseudocode:

```java
while (running) {
    ConsumerRecords<String, TelemetryEnvelope> records = consumer.poll(Duration.ofMillis(500));

    List<TelemetryEnvelope> valid = new ArrayList<>();
    for (var record : records) {
        ValidationResult result = validator.validate(record.value());
        if (result.ok()) {
            valid.add(record.value());
        } else {
            dlq.publish(record, result.reason());
        }
    }

    try {
        questDbWriter.writeBatch(valid);
        questDbWriter.flush();
        consumer.commitSync();
    } catch (TransientQuestDbException e) {
        // do not commit; pause/retry/backoff
        pausePartitionsWithBackoff();
    } catch (PermanentMappingException e) {
        // route affected records to DLQ, commit only after policy
    }
}
```

### 9.2 Offset Commit Semantics

```text
Commit before QuestDB write:
- faster
- can lose data if process crashes after commit before write

Commit after QuestDB write:
- at-least-once into QuestDB
- can duplicate after ambiguous outcome
- requires dedup/idempotency
```

For serious data, choose:

```text
Kafka at-least-once + QuestDB dedup/upsert key
```

or:

```text
Kafka replayable raw event log + rebuildable QuestDB projection
```

---

## 10. Query Path Pattern: Java Query Service via JDBC/PGWire

QuestDB supports PGWire, so Java can query using PostgreSQL JDBC driver or compatible clients.

Tetapi jangan memperlakukan QuestDB sebagai PostgreSQL penuh.

Prinsip query service:

```text
- no arbitrary SQL from request
- query templates only
- mandatory tenant scope
- mandatory time range
- bounded result size
- explicit aggregation level
- timeout
- cancellation where possible
- materialized view routing
```

### 10.1 Query Request Model

Contoh request internal:

```java
public record SeriesQueryRequest(
    String tenantId,
    String metric,
    List<String> deviceIds,
    Instant fromInclusive,
    Instant toExclusive,
    Duration bucket,
    int maxPoints
) {}
```

Validation:

```java
public void validate(SeriesQueryRequest req) {
    if (req.fromInclusive() == null || req.toExclusive() == null) {
        throw new BadRequest("time range is required");
    }
    if (!req.fromInclusive().isBefore(req.toExclusive())) {
        throw new BadRequest("invalid time range");
    }
    if (Duration.between(req.fromInclusive(), req.toExclusive()).compareTo(Duration.ofDays(31)) > 0) {
        throw new BadRequest("time range too large");
    }
    if (req.deviceIds().size() > 500) {
        throw new BadRequest("too many series requested");
    }
    if (req.maxPoints() > 10_000) {
        throw new BadRequest("too many points requested");
    }
}
```

### 10.2 Query Template

```sql
SELECT
    ts,
    device_id,
    avg(value) AS avg_value
FROM device_samples
WHERE tenant_id = ?
  AND metric = ?
  AND ts >= ?
  AND ts < ?
  AND device_id IN (...)
SAMPLE BY 1m
FILL(NULL);
```

Catatan:

```text
- tenant_id wajib
- metric wajib jika table narrow
- time range wajib
- bucket eksplisit
- jumlah device dibatasi
```

### 10.3 Latest State Query

```sql
SELECT *
FROM device_state
WHERE tenant_id = ?
LATEST ON ts PARTITION BY device_id;
```

Hati-hati:

```text
filter placement matters.
```

Kalau ingin latest state hanya untuk device tertentu, filter harus dirancang agar semantics benar dan cost terkendali.

---

## 11. Connection Pooling

PGWire/JDBC query service biasanya memakai connection pool seperti HikariCP.

Prinsip:

```text
- pool kecil dan terkendali
- query timeout wajib
- connection timeout pendek
- jangan izinkan dashboard membuka ratusan koneksi
- pisahkan analytical/internal users dari API pool bila perlu
```

Contoh konfigurasi konseptual:

```yaml
spring:
  datasource:
    url: jdbc:postgresql://questdb.internal:8812/qdb
    username: app_query
    password: ${QUESTDB_QUERY_PASSWORD}
    hikari:
      maximum-pool-size: 10
      minimum-idle: 2
      connection-timeout: 2000
      validation-timeout: 1000
      idle-timeout: 30000
      max-lifetime: 300000
```

Query timeout di code:

```java
try (PreparedStatement ps = connection.prepareStatement(sql)) {
    ps.setQueryTimeout(5); // seconds
    // bind parameters
    try (ResultSet rs = ps.executeQuery()) {
        // stream/collect bounded result
    }
}
```

Catatan: pastikan timeout semantics benar dengan driver dan server version yang digunakan. Selalu test cancellation behavior.

---

## 12. Query Result Shaping

Jangan selalu return raw rows.

Untuk API/dashboard, bentuk result sebaiknya domain-specific.

```java
public record TimeSeriesPoint(
    Instant timestamp,
    String series,
    Double value
) {}

public record TimeSeriesResponse(
    Instant from,
    Instant to,
    Duration bucket,
    boolean partial,
    Instant dataFreshness,
    List<TimeSeriesPoint> points
) {}
```

Tambahkan metadata:

```text
- query range
- bucket
- whether result is partial
- freshness watermark
- source: raw/materialized_view
- max points applied
```

Ini penting agar frontend tidak salah menafsirkan data stale atau downsampled sebagai raw truth.

---

## 13. Materialized View Routing dari Java

Query service harus memilih source berdasarkan time range dan bucket.

Contoh routing:

```text
range <= 6h and bucket <= 10s       -> raw table
range <= 7d and bucket >= 1m        -> mv_1m
range <= 90d and bucket >= 1h       -> mv_1h
range > 90d                         -> cold/Parquet/lakehouse path or reject
```

Pseudocode:

```java
enum QuerySource {
    RAW,
    ROLLUP_1M,
    ROLLUP_1H,
    COLD
}

QuerySource chooseSource(Duration range, Duration bucket) {
    if (range.compareTo(Duration.ofHours(6)) <= 0 && bucket.compareTo(Duration.ofSeconds(10)) <= 0) {
        return QuerySource.RAW;
    }
    if (range.compareTo(Duration.ofDays(7)) <= 0 && bucket.compareTo(Duration.ofMinutes(1)) >= 0) {
        return QuerySource.ROLLUP_1M;
    }
    if (range.compareTo(Duration.ofDays(90)) <= 0 && bucket.compareTo(Duration.ofHours(1)) >= 0) {
        return QuerySource.ROLLUP_1H;
    }
    return QuerySource.COLD;
}
```

Jangan biarkan client memilih table bebas.

---

## 14. Tenant Isolation in Java Query Service

Tenant isolation tidak boleh hanya frontend concern.

Query service harus menyuntikkan tenant dari auth context, bukan dari request body yang bisa dipalsukan.

Bad:

```java
String tenantId = request.tenantId();
```

Better:

```java
String tenantId = securityContext.currentTenantId();
```

SQL template harus selalu mengandung tenant predicate.

```sql
WHERE tenant_id = ?
  AND ts >= ?
  AND ts < ?
```

Untuk admin/multi-tenant query, gunakan endpoint berbeda dengan permission eksplisit dan audit log.

---

## 15. Time Handling in Java

Time-series correctness sering rusak oleh handling waktu yang asal.

### 15.1 Gunakan Instant untuk Event Time

```java
Instant eventTime = payload.eventTime();
```

Jangan pakai:

```java
LocalDateTime.now()
```

untuk event timestamp produksi karena ambiguous timezone.

### 15.2 Simpan UTC

QuestDB timestamp pada praktiknya harus diperlakukan sebagai UTC event time.

Timezone digunakan untuk query presentation atau calendar aggregation, bukan untuk raw event storage.

### 15.3 Nanosecond vs Microsecond

Java `Instant` memiliki seconds + nanos, tapi banyak sistem hanya micro/millisecond precision.

Policy harus eksplisit:

```text
- source precision: millis/micros/nanos
- storage column: TIMESTAMP or TIMESTAMP_NS
- rounding/truncation rule
- dedup key impact
```

Jika source hanya millisecond, jangan berpura-pura nanosecond accuracy.

---

## 16. Schema Contract in Java

### 16.1 Registry Ringan

Buat registry internal:

```java
public record QuestDbTableContract(
    String tableName,
    String timestampColumn,
    List<SymbolColumn> symbols,
    List<ValueColumn> values,
    List<String> upsertKeys,
    Duration maxLateArrival,
    CardinalityBudget cardinalityBudget
) {}
```

Contoh:

```java
QuestDbTableContract DEVICE_SAMPLES = new QuestDbTableContract(
    "device_samples",
    "ts",
    List.of(
        new SymbolColumn("tenant_id", 10_000),
        new SymbolColumn("device_id", 5_000_000),
        new SymbolColumn("metric", 500)
    ),
    List.of(
        new ValueColumn("value", ColumnType.DOUBLE),
        new ValueColumn("quality", ColumnType.SHORT),
        new ValueColumn("observed_at", ColumnType.TIMESTAMP)
    ),
    List.of("tenant_id", "device_id", "metric", "ts"),
    Duration.ofHours(24),
    new CardinalityBudget(...)
);
```

### 16.2 Producer Contract Test

Setiap producer harus punya test yang memastikan mapping stabil.

```java
@Test
void mapsDeviceSampleToQuestDbColumns() {
    DeviceSample sample = sampleFixture();
    IlpLine line = mapper.toIlp(sample);

    assertThat(line.table()).isEqualTo("device_samples");
    assertThat(line.symbols()).containsKeys("tenant_id", "device_id", "metric");
    assertThat(line.fields()).containsKeys("value", "quality", "observed_at");
    assertThat(line.timestamp()).isEqualTo(sample.eventTime());
}
```

Jangan hanya test bahwa code tidak throw exception.

Test semantic mapping.

---

## 17. DLQ Pattern

Invalid event tidak boleh hilang diam-diam.

DLQ record minimal:

```java
public record IngestionDlqRecord(
    String producer,
    String schemaName,
    int schemaVersion,
    String tenantId,
    String eventId,
    Instant eventTime,
    Instant failedAt,
    String failureCode,
    String failureMessage,
    String payloadHash,
    String rawPayloadLocation
) {}
```

Failure code contoh:

```text
UNKNOWN_SCHEMA
UNSUPPORTED_SCHEMA_VERSION
INVALID_TIMESTAMP
TIMESTAMP_TOO_OLD
TIMESTAMP_TOO_FUTURE
UNKNOWN_METRIC
UNIT_MISMATCH
SYMBOL_CARDINALITY_LIMIT
TYPE_MISMATCH
MAPPING_ERROR
QUESTDB_REJECTED_LINE
```

DLQ harus actionable.

Jangan hanya log stacktrace.

---

## 18. Health Checks from Java

### 18.1 Liveness

Liveness hanya berarti aplikasi hidup.

```text
/livez -> JVM can respond
```

Jangan jadikan QuestDB unreachable sebagai alasan container ingestion service langsung restart terus-menerus. Itu bisa memperburuk outage.

### 18.2 Readiness

Readiness berarti service boleh menerima traffic.

Untuk ingestion service:

```text
ready if:
- config loaded
- queue below threshold
- QuestDB writer not in open circuit
- DLQ reachable if required
```

Untuk query service:

```text
ready if:
- JDBC pool healthy
- QuestDB query probe success
- query latency below threshold maybe
```

### 18.3 Freshness Health

Freshness adalah health paling penting untuk TSDB.

Contoh probe:

```text
SELECT max(ts) FROM device_samples WHERE tenant_id = 'synthetic_probe';
```

Atau dari metrics exporter:

```text
questdb_ingestion_freshness_lag_seconds{table="device_samples"}
```

Jangan menganggap `SELECT 1` cukup.

---

## 19. Observability Metrics in Java

Ingestion service harus expose:

```text
input_events_total
input_events_invalid_total
input_events_dlq_total
questdb_write_rows_total
questdb_write_failures_total
questdb_flush_duration_seconds
questdb_batch_rows
questdb_batch_bytes
questdb_retry_total
questdb_circuit_breaker_state
questdb_queue_depth
questdb_queue_oldest_age_seconds
questdb_event_time_lag_seconds
questdb_ingestion_time_lag_seconds
```

Query service harus expose:

```text
questdb_query_requests_total
questdb_query_failures_total
questdb_query_duration_seconds{query_class="..."}
questdb_query_result_rows
questdb_query_rejected_total{reason="range_too_large"}
questdb_query_timeout_total
questdb_query_source_total{source="raw|mv_1m|mv_1h"}
```

Metrics harus diberi label terbatas. Jangan label dengan `device_id` high-cardinality.

---

## 20. Circuit Breaker Pattern

Saat QuestDB degraded, aplikasi harus mengurangi tekanan.

State sederhana:

```text
CLOSED     normal writes
OPEN       reject/pause writes temporarily
HALF_OPEN  allow small probe writes
```

Trigger open:

```text
- consecutive flush failures > N
- queue oldest age > threshold
- QuestDB returns repeated 5xx
- WAL freshness lag beyond critical threshold
- disk full signal from monitoring integration
```

Policy saat open:

```text
- Kafka consumer pause partitions
- HTTP ingestion endpoint returns 503/429
- non-critical telemetry dropped/sampled
- critical event path spills to durable queue
```

---

## 21. Spring Boot Architecture Example

### 21.1 Package Structure

```text
com.company.telemetry
  ├── api
  │   ├── TelemetryIngestionController.java
  │   └── TimeSeriesQueryController.java
  ├── application
  │   ├── IngestionUseCase.java
  │   ├── QueryUseCase.java
  │   └── BackfillUseCase.java
  ├── domain
  │   ├── TelemetryEnvelope.java
  │   ├── DeviceSample.java
  │   ├── MetricDefinition.java
  │   └── QueryRequest.java
  ├── questdb
  │   ├── QuestDbWriter.java
  │   ├── QuestDbQueryRepository.java
  │   ├── QuestDbTableMapper.java
  │   └── QuestDbHealthProbe.java
  ├── schema
  │   ├── SchemaRegistry.java
  │   ├── ContractValidator.java
  │   └── CardinalityGuard.java
  ├── dlq
  │   └── IngestionDlqPublisher.java
  └── config
      ├── QuestDbProperties.java
      └── TelemetryProperties.java
```

Key idea:

```text
QuestDB-specific code stays behind adapters.
Domain/application layer does not build raw ILP lines or raw SQL freely.
```

### 21.2 Write Adapter Interface

```java
public interface TimeSeriesWriter {
    void write(DeviceSample sample);
    void writeBatch(List<DeviceSample> samples);
    void flush();
}
```

### 21.3 Query Adapter Interface

```java
public interface TimeSeriesReader {
    TimeSeriesResponse querySeries(SeriesQueryRequest request);
    LatestStateResponse latestState(LatestStateRequest request);
}
```

This allows tests to mock QuestDB without hiding integration risks.

---

## 22. API Design Guardrails

### 22.1 Avoid Generic Query Endpoint

Bad:

```http
POST /questdb/query
{
  "sql": "select * from device_samples"
}
```

This creates:

```text
- exfiltration risk
- unbounded scan risk
- tenant leak risk
- no query class metrics
- no stable performance contract
```

Better:

```http
GET /tenants/{tenantId}/devices/{deviceId}/metrics/{metric}/series?from=...&to=...&bucket=1m
```

or internal endpoint:

```http
POST /timeseries/query
{
  "metric": "temperature_celsius",
  "devices": ["d1", "d2"],
  "from": "2026-06-21T00:00:00Z",
  "to": "2026-06-21T01:00:00Z",
  "bucket": "PT1M"
}
```

### 22.2 Enforce Point Budget

```text
estimated_points = series_count × bucket_count
```

Reject if too high.

Example:

```java
long bucketCount = Duration.between(from, to).dividedBy(bucket);
long estimatedPoints = bucketCount * seriesCount;

if (estimatedPoints > 100_000) {
    throw new BadRequest("query result too large; increase bucket or reduce series/range");
}
```

This protects both QuestDB and frontend.

---

## 23. Handling Backfill from Java

Backfill is not normal ingestion with bigger batch.

Backfill needs separate lane.

```text
live ingestion lane:
- low latency
- small flush interval
- bounded delay
- protects freshness

backfill lane:
- sorted by timestamp where possible
- partition-aware
- rate-limited
- resumable
- dedup-safe
- monitored separately
```

Java backfill service should track progress:

```java
public record BackfillCheckpoint(
    String jobId,
    String source,
    Instant from,
    Instant to,
    Instant lastEventTimeWritten,
    long rowsWritten,
    Instant updatedAt
) {}
```

Backfill must be pausable.

```text
Do not let historical replay starve live ingestion.
```

---

## 24. Testing Strategy

### 24.1 Unit Tests

Test:

```text
- timestamp selection
- schema mapping
- symbol/value mapping
- unit conversion
- cardinality guard
- query request validation
- query source routing
```

### 24.2 Contract Tests

Test producer compatibility:

```text
- schema version accepted
- required dimensions present
- field types stable
- unit unchanged
- dedup key stable
```

### 24.3 Integration Tests

Use real QuestDB container when possible.

Test:

```text
- ILP write visible via PGWire query
- late event ingestion
- duplicate retry behavior
- query templates
- materialized view freshness if used
- timestamp precision
```

### 24.4 Load Tests

Test with realistic:

```text
- row rate
- symbol cardinality
- row width
- late arrival distribution
- query concurrency
- dashboard query mix
```

### 24.5 Failure Simulation

Simulate:

```text
- QuestDB down
- network timeout
- invalid line
- disk pressure if possible in staging
- slow query
- DLQ unavailable
- Kafka rebalance during flush
- duplicate batch retry
```

---

## 25. Common Anti-Patterns

### Anti-Pattern 1: QuestDB as Generic PostgreSQL

Symptom:

```text
ORM entities, JDBC INSERT, arbitrary WHERE, no time range.
```

Fix:

```text
Use ILP for high-throughput writes and query templates over PGWire.
```

### Anti-Pattern 2: Every Service Writes Directly

Symptom:

```text
many services each define table/schema independently.
```

Fix:

```text
central ingestion contract or gateway.
```

### Anti-Pattern 3: Unbounded Internal Queue

Symptom:

```text
QuestDB slowdown becomes Java OOM.
```

Fix:

```text
bounded queues, backpressure, circuit breaker.
```

### Anti-Pattern 4: Frontend Controls Query Shape

Symptom:

```text
frontend sends range, group, table, filters freely.
```

Fix:

```text
query classes and server-side guardrails.
```

### Anti-Pattern 5: No DLQ

Symptom:

```text
invalid telemetry disappears into logs.
```

Fix:

```text
actionable DLQ with failure code and payload reference.
```

### Anti-Pattern 6: No Freshness Concept

Symptom:

```text
service returns stale data with 200 OK and no metadata.
```

Fix:

```text
freshness watermark in response and metrics.
```

### Anti-Pattern 7: Schema Auto-Creation in Production Without Gate

Symptom:

```text
new typo column created by bad producer.
```

Fix:

```text
schema validation before write, controlled migration path.
```

---

## 26. Production Checklist

### Write Path

```text
[ ] Ingestion path uses ILP for high-throughput writes.
[ ] Sender lifecycle is long-lived and gracefully closed.
[ ] Flush policy balances latency and throughput.
[ ] Internal queue is bounded.
[ ] Backpressure policy is explicit.
[ ] Retry uses exponential backoff with jitter.
[ ] Idempotency/dedup policy is defined.
[ ] Invalid events go to DLQ.
[ ] Timestamp policy is explicit.
[ ] Schema contract exists.
[ ] Cardinality guard exists.
[ ] Metrics expose queue depth, flush latency, retry, failure, freshness.
```

### Read Path

```text
[ ] Query path uses PGWire/JDBC or approved client.
[ ] No arbitrary SQL endpoint.
[ ] Tenant predicate is server-side enforced.
[ ] Time range is mandatory.
[ ] Result size limit exists.
[ ] Query timeout exists.
[ ] Query classes are observable.
[ ] Materialized view routing is explicit.
[ ] Freshness metadata is returned where relevant.
[ ] Connection pool is bounded.
```

### Operational

```text
[ ] Liveness/readiness/freshness checks are separate.
[ ] Circuit breaker behavior is defined.
[ ] QuestDB outage does not crash unrelated business paths.
[ ] Kafka offset commit policy is safe.
[ ] Backfill has separate lane and rate limit.
[ ] Load test includes realistic cardinality.
[ ] Failure simulation includes ambiguous write outcome.
```

---

## 27. Architecture Review Questions

Use these questions in design review:

```text
1. What is the event timestamp and where is it sourced?
2. Is ingestion event-time or gateway-time based?
3. What makes a row unique for retry/replay?
4. Is duplicate a bug, overwrite, or revision?
5. What happens if QuestDB is down for 10 minutes?
6. Where do events accumulate during outage?
7. Is the buffer bounded?
8. Who owns schema evolution?
9. Can a producer create a new column accidentally?
10. What is the highest-cardinality symbol?
11. What is the maximum query time range?
12. Can client request raw data for 1 year?
13. How is tenant isolation enforced?
14. What is the freshness SLA?
15. How is freshness measured?
16. How are invalid events investigated?
17. Are query sources raw or materialized views?
18. What is the Kafka offset commit policy?
19. How is backfill separated from live ingestion?
20. What is the rollback plan for a bad producer release?
```

---

## 28. Summary

QuestDB integration from Java is not merely:

```text
add dependency
open connection
write rows
run SQL
```

A production-grade integration is:

```text
write contract
+ read contract
+ schema governance
+ timestamp correctness
+ backpressure
+ retry/idempotency
+ query guardrails
+ observability
+ failure containment
```

The central engineering lesson:

```text
QuestDB can ingest and query time-series data very efficiently,
but Java application boundaries decide whether the system remains safe under change, burst, replay, late data, bad producers, and operational failures.
```

For Java engineers, the winning pattern is usually:

```text
ILP-based ingestion service
+ PGWire/JDBC-based query service
+ bounded APIs
+ schema contract
+ operational metrics
+ explicit failure policies
```

---

## 29. What Comes Next

Next part:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-027.md
Pipeline Architecture with Kafka/RabbitMQ Without Repeating Messaging Theory
```

Part berikutnya akan membahas bagaimana menempatkan QuestDB di belakang broker/event stream tanpa mengulang teori Kafka/RabbitMQ yang sudah dibahas di seri lain. Fokusnya adalah pipeline boundary: replay, ordering, idempotency, lag, backfill, dual-write avoidance, and serving-store semantics.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-025.md">⬅️ Part 025 — Security, Access, and Multi-Tenant Boundaries</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-027.md">Pipeline Architecture with Kafka/RabbitMQ Without Repeating Messaging Theory ➡️</a>
</div>
