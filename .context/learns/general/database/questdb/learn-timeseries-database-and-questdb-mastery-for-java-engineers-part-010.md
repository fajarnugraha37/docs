# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-010.md

# Part 010 — Out-of-Order Data and Late Arrival Engineering

> Target pembaca: Java software engineer / tech lead yang ingin memahami time-series ingestion secara produksi, bukan hanya berhasil insert data ke QuestDB.
>
> Fokus part ini: memahami **out-of-order data**, **late arrival**, **event-time correctness**, dan bagaimana mendesain pipeline agar QuestDB tetap cepat, benar, dan operasional walaupun data datang tidak urut.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu harus bisa:

1. Membedakan **in-order**, **out-of-order**, **late arrival**, **replay**, dan **correction**.
2. Menjelaskan kenapa out-of-order data adalah kondisi normal pada distributed systems.
3. Memahami efek out-of-order ingestion terhadap storage engine QuestDB.
4. Mendesain Java ingestion pipeline yang toleran terhadap data telat tanpa membuat write path kacau.
5. Menentukan kapan data perlu disortir di producer, kapan cukup diserahkan ke QuestDB, dan kapan perlu jalur backfill terpisah.
6. Membuat SLA ingestion yang memisahkan **freshness**, **completeness**, dan **correctness**.
7. Menyusun runbook untuk O3 storm, replay historis, clock skew, dan producer yang mengirim timestamp salah.

---

## 2. Problem yang Sedang Diselesaikan

Pada sistem time-series, banyak engineer pemula mengasumsikan data akan masuk seperti ini:

```text
10:00:00.001
10:00:00.002
10:00:00.003
10:00:00.004
10:00:00.005
```

Di produksi, data sering masuk seperti ini:

```text
10:00:00.004
10:00:00.001
10:00:00.005
09:59:58.120
10:00:00.003
10:00:02.900
09:48:11.250
```

Alasannya banyak:

- event dibuat di device edge yang clock-nya berbeda;
- network delay tidak stabil;
- Kafka partition ordering hanya menjamin order dalam partition key tertentu;
- producer melakukan retry;
- batch dikirim ulang;
- file historis diimport ulang;
- exchange / sensor / partner data provider mengirim correction;
- service restart dan flush buffer lama;
- mobile/offline device mengirim backlog;
- queue menahan message lama lalu melepasnya sekaligus;
- timestamp berasal dari upstream system, bukan dari waktu QuestDB menerima row.

Masalahnya bukan hanya “apakah QuestDB bisa menerima data telat?”. Pertanyaan sebenarnya:

```text
Berapa besar biaya fisik, memori, disk, query visibility, dan operational risk ketika data telat diterima?
```

Out-of-order data bukan sekadar variasi urutan row. Ia mengubah sifat write path:

```text
append-only fast path
    berubah menjadi
merge/reorder/rewrite path
```

Dan perubahan ini punya konsekuensi besar.

---

## 3. Istilah Dasar yang Harus Tepat

### 3.1 In-order data

Data disebut **in-order** jika timestamp row baru lebih baru atau sama dengan tail yang sudah ditulis pada table/partition terkait.

Contoh:

```text
existing tail: 10:00:10.000
new rows:
10:00:10.001
10:00:10.002
10:00:10.003
```

Ini adalah jalur terbaik untuk ingestion.

Mental model:

```text
new data tinggal ditambahkan di ujung file/partition
```

---

### 3.2 Out-of-order / O3 data

Data disebut **out-of-order** jika row datang dengan timestamp lebih lama dari data yang sudah committed/diterima sebelumnya.

Contoh:

```text
existing tail: 10:00:10.000
new row:       10:00:05.500
```

Data ini masih valid secara domain, tetapi tidak bisa selalu ditulis sebagai append sederhana.

Mental model:

```text
row harus disisipkan ke posisi temporal yang benar
```

---

### 3.3 Late arrival

**Late arrival** adalah out-of-order data yang terlambat relatif terhadap SLA domain.

Contoh:

```text
sensor event time:    10:00:00
QuestDB receive time: 10:07:30
lateness:             7m30s
```

Late arrival bukan hanya masalah teknis. Ia masalah kontrak bisnis:

```text
Apakah dashboard boleh berubah 7 menit ke belakang?
Apakah alert boleh dihitung ulang?
Apakah laporan regulatory boleh menerima correction setelah window ditutup?
```

---

### 3.4 Replay

**Replay** adalah pengiriman ulang data lama secara sengaja.

Contoh:

- replay Kafka topic;
- import ulang CSV historis;
- recovery dari dead-letter queue;
- rebuild QuestDB dari raw event store;
- re-ingest setelah schema bug diperbaiki.

Replay bisa menghasilkan duplicate jika ingestion tidak idempotent.

---

### 3.5 Correction

**Correction** adalah data baru yang merevisi fakta lama.

Contoh market data:

```text
trade_id=ABC123 originally price=100.25
later correction price=100.20
```

Correction bukan duplicate biasa. Ia butuh semantic policy:

- overwrite row lama;
- simpan versi baru;
- simpan correction event terpisah;
- exclude corrected rows dari query tertentu;
- rekalkulasi materialized view / rollup.

---

## 4. Mental Model Utama: Time-Series Write Path Memiliki Dua Mode

Untuk reasoning sederhana, anggap QuestDB punya dua mode tulis:

```text
1. Fast append path
2. O3 merge path
```

### 4.1 Fast append path

```text
producer sends rows mostly sorted by timestamp
        ↓
QuestDB appends to hot partition
        ↓
minimal merge/rewrite
        ↓
high throughput, low memory pressure
```

Ini ideal untuk:

- live telemetry;
- market ticks yang sudah time-ordered;
- application metrics;
- device gateway yang melakukan local ordering;
- Kafka consumer yang consume partition dengan key temporal yang masuk akal.

---

### 4.2 O3 merge path

```text
producer sends older rows
        ↓
QuestDB must place them into earlier temporal position
        ↓
partition may need merge/split/rewrite/compact
        ↓
write amplification increases
        ↓
WAL apply/query visibility may lag
```

Ini normal, tetapi tidak gratis.

Prinsip penting:

```text
QuestDB can handle out-of-order data.
That does not mean out-of-order data has zero cost.
```

---

## 5. Kenapa Out-of-Order Data Normal di Distributed Systems

### 5.1 Network tidak mempertahankan global order

Jika dua device mengirim event:

```text
Device A event at 10:00:01
Device B event at 10:00:02
```

Tidak ada jaminan QuestDB menerima A sebelum B.

Network path, retry, queue, TLS overhead, DNS, connection reuse, dan batch flush bisa mengubah urutan arrival.

---

### 5.2 Kafka ordering bukan global ordering

Kafka menjaga order per partition, bukan global across topic.

Jika event time tersebar di banyak partition:

```text
partition-0: 10:00:05, 10:00:06
partition-1: 09:59:58, 10:00:01
partition-2: 10:00:03, 09:59:59
```

Consumer paralel yang menulis ke QuestDB akan menghasilkan arrival order campuran.

Bukan bug. Itu konsekuensi desain.

---

### 5.3 Batch flush mengubah order

Producer Java sering melakukan:

```text
buffer rows
flush every N rows or T milliseconds
```

Jika beberapa thread punya buffer berbeda, flush order tidak sama dengan event time order.

---

### 5.4 Clock skew

Distributed system tidak punya satu jam sempurna.

Contoh:

```text
service-a clock: 10:00:00
service-b clock: 09:59:55
service-c clock: 10:00:04
```

Jika timestamp event berasal dari local clock masing-masing service, QuestDB akan melihat data seperti out-of-order walaupun arrival order normal.

---

### 5.5 Offline / edge backlog

IoT device bisa offline 2 jam lalu mengirim backlog.

```text
receive time: 12:00
rows contain timestamps: 10:00 - 11:59
```

Secara domain, data ini benar. Secara storage, ini historical insert.

---

## 6. QuestDB-Specific Mechanics: Apa yang Terjadi Saat O3

QuestDB mendukung out-of-order ingestion. Ketika data telat datang, engine perlu menjaga data tetap secara temporal pada storage/query layer.

Secara konseptual:

```text
incoming O3 rows
        ↓
sort / merge against existing temporal data
        ↓
write new fragments or split partition if needed
        ↓
compact/squash later when applicable
```

QuestDB documentation menjelaskan bahwa saat out-of-order data masuk ke partition yang sudah ada, QuestDB dapat melakukan **partition splitting** untuk menghindari rewrite seluruh partition, dan split tersebut kemudian dapat di-squash/compact. Operasi ini adalah optimisasi write performance, tetapi tetap menunjukkan bahwa O3 write lebih mahal daripada append biasa.

---

## 7. Why O3 Costs More: Write Amplification

### 7.1 Append-only cost

Append path kira-kira:

```text
write new rows once
update metadata
return/commit
```

Cost relatif:

```text
O(new_rows)
```

---

### 7.2 O3 merge cost

O3 path bisa membutuhkan:

```text
read existing data range
sort incoming rows
merge with old rows
write merged fragments
update partition metadata
possibly split partition
possibly compact later
```

Cost relatif:

```text
O(new_rows + affected_existing_rows + metadata + compaction)
```

Jadi bukan jumlah row baru saja yang penting, tetapi:

```text
berapa banyak data lama yang disentuh oleh row telat itu?
```

---

### 7.3 Partition size matters

Jika partition sangat besar, data telat yang menyentuh partition tersebut bisa berdampak lebih mahal.

Contoh:

```text
PARTITION BY MONTH
1 partition = 2 billion rows
late row masuk ke tengah bulan
```

Dibanding:

```text
PARTITION BY DAY
1 partition = 70 million rows
late row masuk ke satu hari tertentu
```

Bukan berarti `DAY` selalu benar. Artinya partition granularity harus mempertimbangkan O3 profile.

Rule of thumb:

```text
Semakin sering data telat jauh ke belakang,
semakin penting membatasi ukuran affected partition.
```

---

## 8. Event Time vs Ingestion Time

Ini salah satu keputusan paling penting.

### 8.1 Event time

Event time adalah waktu kejadian di domain.

Contoh:

```text
machine sensor observed temperature at 10:00:05
trade executed at 09:30:00.123456789
service emitted metric sample for 12:01:00 bucket
```

Jika designated timestamp memakai event time, query akan benar secara domain:

```sql
SELECT avg(temp)
FROM sensor_readings
WHERE ts BETWEEN '2026-06-21T10:00:00Z' AND '2026-06-21T11:00:00Z';
```

Tapi ingestion bisa out-of-order karena event datang terlambat.

---

### 8.2 Ingestion time

Ingestion time adalah waktu QuestDB atau ingestion service menerima row.

Jika designated timestamp memakai ingestion time, write path lebih mudah append-only.

Tapi query domain bisa salah:

```text
sensor measured at 10:00 but received at 10:15
```

Jika query “berapa suhu jam 10?” memakai ingestion time, event tersebut jatuh ke jam 10:15.

---

### 8.3 Dual timestamp pattern

Untuk banyak sistem produksi, gunakan dua timestamp:

```sql
CREATE TABLE sensor_readings (
    ts TIMESTAMP,              -- event time, designated timestamp
    received_at TIMESTAMP,     -- ingestion receive time
    device_id SYMBOL,
    site_id SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    quality SYMBOL
) TIMESTAMP(ts)
PARTITION BY DAY WAL;
```

Dengan pola ini:

- `ts` dipakai untuk semantics dan partitioning;
- `received_at` dipakai untuk freshness analysis, delay monitoring, dan operational debugging.

Query latency/freshness:

```sql
SELECT
    site_id,
    approx_percentile(dateadd('s', 0, received_at) - ts, 0.95) AS p95_lateness
FROM sensor_readings
WHERE received_at > dateadd('m', -15, now())
SAMPLE BY 1m;
```

Catatan: fungsi dan ekspresi timestamp perlu disesuaikan dengan SQL QuestDB aktual yang digunakan; contoh di atas lebih ditujukan sebagai pola konseptual.

---

## 9. Late Arrival SLA

Jangan hanya berkata:

```text
Sistem menerima late data.
```

Itu terlalu kabur.

Definisikan SLA seperti ini:

```text
99.9% event arrive within 30 seconds of event time.
99.99% event arrive within 5 minutes.
Events older than 24 hours are routed to backfill lane.
Events older than 30 days require explicit correction workflow.
```

Kenapa perlu?

Karena strategi ingestion berbeda untuk masing-masing bucket:

| Lateness | Strategy |
|---:|---|
| 0–5s | normal live ingestion |
| 5s–5m | normal ingestion with O3 tolerance |
| 5m–24h | controlled late lane / lower priority |
| 24h–30d | backfill lane, sorted/batched by partition |
| >30d | manual correction/governed replay |

Tanpa SLA, semua kasus bercampur di satu write path dan incident menjadi sulit dianalisis.

---

## 10. Designing Producer-Side Ordering

QuestDB bisa menangani O3, tetapi producer tetap harus membantu jika murah.

### 10.1 Single-thread ordered producer

Untuk workload sederhana:

```text
read event
validate
send to QuestDB
```

Jika source sudah ordered, jangan rusak order dengan parallelism yang tidak perlu.

---

### 10.2 Multi-thread producer hazard

Anti-pattern:

```java
parallelStream().forEach(event -> sender.row(...));
```

Masalah:

- order tidak terkontrol;
- Sender lifecycle bisa tidak thread-safe tergantung penggunaan;
- flush timing acak;
- error handling sulit;
- backpressure tidak jelas.

Lebih baik:

```text
multiple producer threads
        ↓
bounded queue
        ↓
partition-aware/order-aware ingestion workers
        ↓
QuestDB
```

---

### 10.3 Micro-sorting buffer

Jika data telat hanya beberapa detik, Java ingestion service bisa memakai buffer kecil:

```text
accept events
buffer for 1-5 seconds
sort by event timestamp
flush ordered batch
```

Contoh mental model:

```java
class TimeOrderedBuffer {
    private final Duration maxHold = Duration.ofSeconds(3);
    private final PriorityQueue<Event> byEventTime = new PriorityQueue<>(Comparator.comparing(Event::eventTime));

    void accept(Event e) {
        byEventTime.add(e);
    }

    List<Event> drainReady(Instant now) {
        Instant watermark = now.minus(maxHold);
        List<Event> ready = new ArrayList<>();
        while (!byEventTime.isEmpty() && byEventTime.peek().eventTime().isBefore(watermark)) {
            ready.add(byEventTime.poll());
        }
        return ready;
    }
}
```

Trade-off:

| Benefit | Cost |
|---|---|
| less O3 | adds ingestion latency |
| smoother write path | memory buffer needed |
| fewer partition rewrites | late events beyond buffer still O3 |
| better batch locality | more complex failure handling |

Rule:

```text
Micro-sort hanya layak jika extra latency bisa diterima oleh product/SLO.
```

---

## 11. Watermark Thinking

Watermark adalah estimasi bahwa:

```text
kebanyakan event dengan timestamp <= T sudah datang
```

Dalam stream processing, watermark sering dipakai untuk menutup window. Dalam QuestDB ingestion, watermark berguna untuk membagi lane:

```text
if event_time >= now - live_lag_budget:
    live lane
else:
    late lane
```

Contoh:

```java
Duration liveLagBudget = Duration.ofMinutes(2);
Instant watermark = Instant.now().minus(liveLagBudget);

if (event.eventTime().isBefore(watermark)) {
    lateLane.publish(event);
} else {
    liveLane.publish(event);
}
```

Tujuan bukan menolak late data, tetapi menghindari semua jenis data mengganggu jalur live ingestion.

---

## 12. Live Lane vs Backfill Lane

### 12.1 Live lane

Karakteristik:

- low latency;
- mostly in-order;
- small lateness;
- high priority;
- feeds dashboard/alert near real-time.

Design:

```text
source → validation → micro-sort optional → QuestDB ILP HTTP
```

---

### 12.2 Late lane

Karakteristik:

- data telat beberapa menit/jam;
- masih otomatis;
- priority lebih rendah;
- bisa throttled;
- sebaiknya partition-aware.

Design:

```text
source → classify as late → batch by day/hour partition → sort → ingest with rate limit
```

---

### 12.3 Backfill lane

Karakteristik:

- data historis besar;
- replay/import;
- bisa menyentuh banyak partition;
- berisiko mengganggu live workload.

Design:

```text
raw source/file/object store
        ↓
partition planner
        ↓
sort by timestamp
        ↓
batch loader
        ↓
QuestDB during controlled window / throttled path
```

Strong recommendation:

```text
Jangan mencampur massive historical backfill dengan live ingestion tanpa throttle dan observability.
```

---

## 13. Backfill Strategy yang Aman

Backfill historis adalah sumber O3 storm paling umum.

### 13.1 Salah: replay random order

```text
read files by device_id
send all rows device by device
```

Jika tiap device punya data 2 tahun, order global terhadap table bisa sangat buruk.

Contoh:

```text
device-1: Jan 2024 → Dec 2025
device-2: Jan 2024 → Dec 2025
device-3: Jan 2024 → Dec 2025
```

Setelah device-1 selesai sampai Dec 2025, device-2 mulai lagi dari Jan 2024. Itu O3 besar.

---

### 13.2 Benar: batch by time partition

Lebih baik:

```text
all devices Jan 1 2024
all devices Jan 2 2024
all devices Jan 3 2024
...
```

Atau untuk `PARTITION BY HOUR`:

```text
all entities for 10:00-11:00
then 11:00-12:00
then 12:00-13:00
```

Tujuan:

```text
maximize temporal locality
minimize rewriting old partitions repeatedly
```

---

### 13.3 Sort before ingest

Sebelum ingest batch besar:

```text
sort by designated timestamp ascending
```

Jika dedup key ada:

```text
sort by timestamp, then stable identity key
```

Ini mengurangi O3 cost dan memudahkan troubleshooting.

---

### 13.4 Separate backfill table pattern

Untuk backfill berisiko tinggi, pertimbangkan:

```text
load into staging table
validate counts/ranges/checksums
then swap/copy/merge according to chosen strategy
```

Pattern:

```sql
CREATE TABLE readings_backfill_staging (...)
TIMESTAMP(ts)
PARTITION BY DAY WAL;
```

Validasi:

```sql
SELECT min(ts), max(ts), count()
FROM readings_backfill_staging;

SELECT device_id, count()
FROM readings_backfill_staging
SAMPLE BY 1d;
```

Catatan: strategi final merge tergantung versi QuestDB, volume, dedup policy, dan apakah table final sudah menerima live writes.

---

## 14. Deduplication and O3

Retry dan replay sering menghasilkan duplicate.

Jika table memakai WAL dan dedup/upsert key:

```sql
CREATE TABLE trades (
    ts TIMESTAMP_NS,
    venue SYMBOL,
    symbol SYMBOL,
    trade_id VARCHAR,
    price DOUBLE,
    size DOUBLE
) TIMESTAMP(ts)
PARTITION BY DAY WAL
DEDUP UPSERT KEYS(ts, venue, trade_id);
```

Kenapa `ts` masuk key?

Karena QuestDB dedup membutuhkan designated timestamp sebagai bagian dari upsert key untuk table time-series.

Mental model:

```text
idempotency key = timestamp + stable domain identity
```

Tapi hati-hati:

- Jika upstream correction mengubah timestamp, key lama tidak match.
- Jika trade_id tidak stabil, dedup gagal.
- Jika key terlalu lebar, ingestion overhead meningkat.
- Jika domain sebenarnya butuh versioning, overwrite bisa menghilangkan audit trail.

---

## 15. Correction Policy

Correction adalah kasus yang perlu keputusan semantik.

### 15.1 Overwrite latest fact

Cocok untuk:

- telemetry correction sederhana;
- feed provider mengirim same identity dengan value revised;
- query hanya butuh latest corrected truth.

Pattern:

```text
dedup/upsert key identifies canonical fact
new row replaces duplicate identity
```

Risk:

- history of correction hilang;
- audit sulit;
- materialized rollup mungkin perlu refresh tergantung mekanisme.

---

### 15.2 Append correction event

Cocok untuk:

- regulatory/audit;
- financial correction trail;
- investigation use case;
- data lineage.

Schema example:

```sql
CREATE TABLE trade_events (
    ts TIMESTAMP_NS,
    received_at TIMESTAMP,
    venue SYMBOL,
    symbol SYMBOL,
    trade_id VARCHAR,
    event_type SYMBOL, -- NEW, CANCEL, CORRECT
    revision INT,
    price DOUBLE,
    size DOUBLE
) TIMESTAMP(ts)
PARTITION BY DAY WAL;
```

Query layer harus memilih effective fact.

---

### 15.3 Hybrid: raw events + serving corrected table

Arsitektur lebih kuat:

```text
raw_trade_events      = immutable audit log in QuestDB/object storage
corrected_trades      = serving table with dedup/upsert
rollup_ohlc_1m        = derived view/table
```

Ini memisahkan:

```text
audit correctness
serving simplicity
query performance
```

---

## 16. Clock Skew Engineering

Out-of-order sering berasal dari clock skew.

### 16.1 Detect skew

Simpan `received_at`:

```sql
CREATE TABLE app_metrics (
    ts TIMESTAMP,
    received_at TIMESTAMP,
    service SYMBOL,
    instance_id SYMBOL,
    metric SYMBOL,
    value DOUBLE
) TIMESTAMP(ts)
PARTITION BY DAY WAL;
```

Analisis:

```sql
SELECT
    service,
    instance_id,
    min(received_at - ts) AS min_delay,
    max(received_at - ts) AS max_delay,
    avg(received_at - ts) AS avg_delay
FROM app_metrics
WHERE received_at > dateadd('h', -1, now())
GROUP BY service, instance_id;
```

Jika `received_at - ts` negatif besar, event timestamp berada di masa depan relatif terhadap ingestion service.

---

### 16.2 Reject impossible future timestamps

Java validation:

```java
Duration maxFutureSkew = Duration.ofSeconds(30);
Instant now = clock.instant();

if (event.eventTime().isAfter(now.plus(maxFutureSkew))) {
    rejectToDlq(event, "event_time_too_far_in_future");
}
```

Future timestamp bisa merusak partitioning dan query expectation.

---

### 16.3 Clamp? Usually no

Jangan diam-diam mengganti event timestamp menjadi `now()`.

Itu membuat write path lebih enak, tetapi merusak correctness.

Lebih baik:

```text
store original event_time
store received_at
classify/reject according to policy
```

---

## 17. Operational Metrics for O3

Kamu perlu mengamati gejala O3, bukan hanya rows/sec.

Monitor:

```text
ingestion_rate
commit_latency
WAL apply lag
table suspended status
partition split count / SHOW PARTITIONS evidence
memory pressure
O3 memory usage
query visibility delay
late event distribution
DLQ count by reason
disk write throughput
compaction/squash maintenance need
```

Minimal app-side metrics:

```text
events_received_total
events_sent_to_questdb_total
events_rejected_total{reason}
events_late_total{bucket}
event_lateness_ms histogram
questdb_flush_latency_ms histogram
questdb_flush_failure_total
queue_depth
oldest_buffered_event_age_ms
```

---

## 18. O3 Storm: Failure Mode

### 18.1 What is O3 storm?

O3 storm terjadi ketika banyak data telat/historis masuk sekaligus dan menyentuh partition lama secara besar-besaran.

Sumber umum:

- Kafka replay tanpa throttle;
- device backlog masif;
- CSV import salah urutan;
- retry loop setelah outage;
- producer bug mengirim timestamp lama;
- clock skew massal;
- backfill dicampur dengan live lane.

---

### 18.2 Symptoms

Gejala:

```text
ingestion accepted but query visibility delayed
WAL apply falling behind
disk write throughput high
memory pressure increases
queries over affected partitions slower
partition split fragments visible
live dashboard freshness degrades
```

---

### 18.3 Immediate response

Runbook:

```text
1. Identify which table is affected.
2. Stop or throttle suspicious producer/backfill job.
3. Check lateness distribution from app metrics.
4. Check WAL/table health.
5. Determine whether live lane is impacted.
6. Pause non-critical backfill.
7. Let WAL apply catch up.
8. Resume with partition-aware sorted batches.
```

Do not blindly restart QuestDB unless you know the bottleneck. Restart may hide the symptom but not fix incoming O3 pattern.

---

## 19. Query Correctness Under Late Data

Late data can change past query results.

Example:

```sql
SELECT avg(value)
FROM sensor_readings
WHERE ts BETWEEN '2026-06-21T10:00:00Z' AND '2026-06-21T10:05:00Z';
```

At 10:06, result = 42.0.

At 10:10, late rows for 10:02 arrive. Result becomes 41.7.

This is correct, but product behavior must acknowledge it.

---

## 20. Freshness vs Completeness vs Correctness

These are different.

### 20.1 Freshness

```text
How recent is the data visible to query?
```

Example SLA:

```text
p99 visible within 5 seconds of ingestion
```

---

### 20.2 Completeness

```text
Have all expected events for a time window arrived?
```

Example:

```text
99.9% devices reported for 10:00-10:05 window
```

---

### 20.3 Correctness

```text
Does the result reflect the intended event-time truth, including corrections and late arrivals?
```

Example:

```text
daily report finalizes only after 2-hour lateness window
```

Do not mix these in one metric.

A dashboard might be fresh but incomplete.
A report might be complete but not fresh.
A corrected table might be correct but slower to finalize.

---

## 21. Window Finalization Policy

Untuk reporting/alerting, tentukan kapan window dianggap final.

Example:

```text
Live dashboard window: updates continuously, may revise last 15 minutes.
Operational alert window: closes after 2 minutes.
Billing/reporting window: closes after 24 hours.
Regulatory report: supports correction workflow after close.
```

Materialized views/rollups harus mengikuti policy ini.

Jika rollup `1m` dibuat terlalu cepat, late data bisa membuat rollup tidak sesuai raw data kecuali sistem refresh/repair mendukungnya.

---

## 22. Java Ingestion Pattern: Classify Before Send

Jangan langsung kirim semua event ke QuestDB.

Gunakan classification layer:

```java
enum IngestionLane {
    LIVE,
    LATE,
    BACKFILL,
    REJECT
}

record Classification(
    IngestionLane lane,
    String reason
) {}

Classification classify(Event event, Instant now) {
    if (event.eventTime() == null) {
        return new Classification(IngestionLane.REJECT, "missing_event_time");
    }

    if (event.eventTime().isAfter(now.plus(Duration.ofSeconds(30)))) {
        return new Classification(IngestionLane.REJECT, "future_timestamp");
    }

    Duration lateness = Duration.between(event.eventTime(), now);

    if (lateness.compareTo(Duration.ofMinutes(2)) <= 0) {
        return new Classification(IngestionLane.LIVE, "within_live_budget");
    }

    if (lateness.compareTo(Duration.ofHours(24)) <= 0) {
        return new Classification(IngestionLane.LATE, "within_late_budget");
    }

    return new Classification(IngestionLane.BACKFILL, "historical_backfill_required");
}
```

Then:

```text
LIVE      → high priority ILP sender
LATE      → throttled ILP sender / sorted batches
BACKFILL  → controlled job
REJECT    → DLQ + alert if rate spikes
```

---

## 23. Java Pattern: Bounded Queue and Backpressure

If QuestDB slows due to O3, app must not accumulate infinite memory.

Use bounded queues:

```java
BlockingQueue<Event> queue = new ArrayBlockingQueue<>(100_000);

boolean accepted = queue.offer(event, 100, TimeUnit.MILLISECONDS);
if (!accepted) {
    rejectToDlq(event, "ingestion_queue_full");
}
```

Policy options:

| Policy | Use when |
|---|---|
| block producer | source can tolerate slowdown |
| drop low-value metrics | telemetry is lossy by design |
| DLQ | data must not be lost |
| route to object storage | historical recovery required |
| shed tenant | multi-tenant protection needed |

Do not let O3 transform into JVM OOM.

---

## 24. Java Pattern: Partition-Aware Backfill Planner

Backfill should be planned by time partitions.

Pseudo-code:

```java
record TimeSlice(Instant fromInclusive, Instant toExclusive) {}

List<TimeSlice> planDailySlices(Instant from, Instant to) {
    List<TimeSlice> slices = new ArrayList<>();
    Instant cursor = from.truncatedTo(ChronoUnit.DAYS);

    while (cursor.isBefore(to)) {
        Instant next = cursor.plus(1, ChronoUnit.DAYS);
        slices.add(new TimeSlice(cursor, next));
        cursor = next;
    }
    return slices;
}
```

Then for each slice:

```text
read raw events for that slice
sort by event_time
send in bounded batches
validate count
move to next slice
```

---

## 25. Table Design for O3-Prone Workloads

If workload has frequent late data:

1. Use a sensible partition size.
2. Avoid giant monthly partitions unless data volume is small.
3. Keep row width controlled.
4. Avoid unnecessary sparse columns.
5. Use `SYMBOL` only for bounded dimensions.
6. Define dedup key if retry/replay is expected.
7. Store `received_at` for lateness analysis.
8. Separate raw and serving tables for corrections.

Example telemetry table:

```sql
CREATE TABLE sensor_readings (
    ts TIMESTAMP,
    received_at TIMESTAMP,
    tenant_id SYMBOL,
    site_id SYMBOL,
    device_id SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    unit SYMBOL,
    quality SYMBOL,
    source_event_id VARCHAR
) TIMESTAMP(ts)
PARTITION BY DAY WAL
DEDUP UPSERT KEYS(ts, tenant_id, device_id, metric, source_event_id);
```

Caveat:

```text
source_event_id as VARCHAR may be high-volume; validate whether it belongs in the table or in raw/audit store.
```

---

## 26. `maxUncommittedRows` and Commit Strategy Concept

QuestDB exposes table/global settings that influence commit behavior, including maximum uncommitted rows. The exact tuning depends on version, ingestion method, row width, O3 profile, and hardware.

Mental model:

```text
larger uncommitted buffer
    → fewer commits
    → potentially better batch/O3 efficiency
    → more memory at risk
    → longer visibility delay before commit

smaller uncommitted buffer
    → more frequent commits
    → lower buffered memory
    → potentially more write amplification under O3
```

Do not tune blindly.

Tune by measuring:

```text
ingestion throughput
WAL apply lag
memory usage
query visibility delay
disk write amplification
```

---

## 27. Partition Split and Squash Operational Awareness

When out-of-order rows land in existing partitions, QuestDB may split partitions to reduce rewrite cost. This is good for write performance, but it can leave partition fragments that may later need squashing/compaction.

Operational implication:

```text
O3 is not only an ingestion concern.
It leaves physical traces in storage layout.
```

Use partition inspection commands where appropriate, and plan maintenance if heavily fragmented partitions affect performance or manageability.

Conceptual runbook:

```text
1. Inspect affected partitions.
2. Identify whether split count correlates with backfill/O3 storm.
3. Stop the source of random historical writes.
4. Let ingestion stabilize.
5. Squash/compact partitions if needed and supported for your version/use case.
6. Validate query latency and disk layout after maintenance.
```

---

## 28. Common Anti-Patterns

### Anti-pattern 1: Using ingestion time as designated timestamp to avoid O3

Looks faster. Produces wrong domain queries.

Use dual timestamp instead.

---

### Anti-pattern 2: Kafka replay directly into live table without throttle

Replay can overwhelm WAL apply and partition merge.

Use backfill lane.

---

### Anti-pattern 3: Sorting by entity instead of timestamp during backfill

Bad:

```text
all rows for device A for 2 years
then all rows for device B for 2 years
```

Good:

```text
all rows for all devices for Jan 1
then Jan 2
then Jan 3
```

---

### Anti-pattern 4: No `received_at`

Without receive time, you cannot measure lateness.

Then every O3 issue becomes guesswork.

---

### Anti-pattern 5: Treating late data as error

Late data may be normal domain behavior.

Classify it. Do not blindly reject it.

---

### Anti-pattern 6: No finalization policy

If dashboard/report consumers assume old windows never change, late data will look like inconsistency.

Document mutable windows.

---

### Anti-pattern 7: Backfill during peak traffic

Historical replay competes with live ingestion and query workloads.

Schedule/throttle it.

---

## 29. Domain Example: IoT Offline Device

Scenario:

```text
10,000 devices
5% can be offline for up to 3 hours
normal sample interval: 10 seconds
when online, device uploads backlog
```

Naive design:

```text
all uploads go to same live sender
```

Failure:

```text
backlog creates O3 storm
live dashboard freshness degrades
ingestion queue grows
```

Better design:

```text
ingestion gateway
    ↓
classify lateness
    ↓
LIVE lane for <= 2 minutes
LATE lane for <= 6 hours, throttled, sorted by ts/device
BACKFILL lane for > 6 hours
```

Schema:

```sql
CREATE TABLE device_metrics (
    ts TIMESTAMP,
    received_at TIMESTAMP,
    tenant_id SYMBOL,
    site_id SYMBOL,
    device_id SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    battery DOUBLE,
    quality SYMBOL
) TIMESTAMP(ts)
PARTITION BY DAY WAL;
```

Dashboard copy:

```text
Latest 15 minutes may revise as offline device data arrives.
Daily reports finalize after 6 hours.
```

This is not UI fluff. It is product-level consistency semantics.

---

## 30. Domain Example: Market Data Corrections

Scenario:

```text
exchange sends trades in nanosecond timestamp
some corrections arrive later
analytics require both real-time and corrected historical view
```

Design:

```text
raw_trade_events      immutable event feed
corrected_trades      deduplicated serving table
ohlc_1m               materialized/derived aggregate
```

Raw table:

```sql
CREATE TABLE raw_trade_events (
    ts TIMESTAMP_NS,
    received_at TIMESTAMP,
    venue SYMBOL,
    symbol SYMBOL,
    trade_id VARCHAR,
    event_type SYMBOL,
    revision INT,
    price DOUBLE,
    size DOUBLE
) TIMESTAMP(ts)
PARTITION BY DAY WAL;
```

Serving table:

```sql
CREATE TABLE corrected_trades (
    ts TIMESTAMP_NS,
    received_at TIMESTAMP,
    venue SYMBOL,
    symbol SYMBOL,
    trade_id VARCHAR,
    price DOUBLE,
    size DOUBLE
) TIMESTAMP(ts)
PARTITION BY DAY WAL
DEDUP UPSERT KEYS(ts, venue, trade_id);
```

The raw table preserves audit. The serving table optimizes query.

---

## 31. Hands-On Lab

### Lab 1 — Create an O3-prone table

```sql
CREATE TABLE readings_o3_lab (
    ts TIMESTAMP,
    received_at TIMESTAMP,
    device_id SYMBOL,
    value DOUBLE
) TIMESTAMP(ts)
PARTITION BY DAY WAL;
```

---

### Lab 2 — Insert mostly ordered rows

Insert rows in timestamp order.

Observe:

```text
fast ingestion
simple query visibility
stable partition layout
```

---

### Lab 3 — Insert late rows

Insert rows with timestamps 30 minutes earlier than current tail.

Observe:

```text
whether query results for past window change
whether ingestion/apply latency changes
whether partition inspection shows split fragments
```

---

### Lab 4 — Add `received_at`

Run query to estimate lateness distribution.

Concept:

```sql
SELECT
    device_id,
    count(),
    min(received_at - ts),
    max(received_at - ts)
FROM readings_o3_lab
WHERE received_at > dateadd('h', -1, now())
GROUP BY device_id;
```

---

### Lab 5 — Simulate Java micro-sort

Write a small Java program that:

1. generates events with random lateness;
2. sends them unsorted;
3. sends them with 3-second micro-sort;
4. compares flush latency and query visibility.

Expected learning:

```text
Producer-side ordering is a performance tool,
not a correctness replacement.
```

---

## 32. Production Checklist

Before accepting out-of-order workloads, answer:

```text
Timestamp semantics
[ ] What is designated timestamp: event time or ingestion time?
[ ] Is received_at stored separately?
[ ] What future timestamp skew is allowed?

Lateness
[ ] What is p95/p99 lateness expectation?
[ ] What is maximum automatic late window?
[ ] What happens beyond late window?

Ingestion lanes
[ ] Is live ingestion separated from backfill?
[ ] Are late rows throttled?
[ ] Are historical imports sorted by timestamp/partition?

Idempotency
[ ] Can producers retry safely?
[ ] Is dedup/upsert key defined when needed?
[ ] Are corrections modeled explicitly?

Partitioning
[ ] Does partition granularity match O3 profile?
[ ] Are partitions too large for frequent late writes?
[ ] Is TTL aligned with partition size?

Observability
[ ] Is lateness histogram emitted?
[ ] Is WAL/apply lag monitored?
[ ] Are DLQ reasons counted?
[ ] Are queue depths monitored?

Operations
[ ] Is there an O3 storm runbook?
[ ] Is there a controlled backfill procedure?
[ ] Is there a partition maintenance procedure?
[ ] Are dashboard/report finalization semantics documented?
```

---

## 33. Key Takeaways

1. Out-of-order data is normal in distributed systems.
2. QuestDB supports O3, but O3 is not free.
3. In-order append is the fast path; O3 merge is the more expensive path.
4. Event time gives domain correctness; ingestion time gives easier append behavior but often wrong semantics.
5. Use dual timestamp: `ts` for event time, `received_at` for operational analysis.
6. Define late arrival SLA explicitly.
7. Separate live, late, and backfill lanes.
8. Sort historical data by timestamp/partition before ingest.
9. Use dedup/upsert when retry/replay can create duplicates.
10. Corrections require semantic policy, not just database mechanics.
11. Monitor lateness, WAL/apply lag, queue depth, and partition fragmentation.
12. Product consumers must know whether past windows can revise.

---

## 34. Mental Model Final

The strongest way to think about O3 is:

```text
Out-of-order data is not a database feature checkbox.
It is a workload shape that must be budgeted.
```

A production-grade QuestDB ingestion architecture does not ask only:

```text
Can QuestDB ingest late data?
```

It asks:

```text
How late?
How often?
How much?
Into which partitions?
With what idempotency?
With what query visibility SLA?
With what correction semantics?
With what recovery/runbook?
```

That is the difference between “QuestDB works in a demo” and “QuestDB remains stable under real-world distributed time.”

---

## 35. References

- QuestDB documentation — Time partitions and partition splitting/squashing.
- QuestDB documentation — Time-series optimizations and out-of-order behavior.
- QuestDB documentation — Schema design essentials and out-of-order write guidance.
- QuestDB documentation — Capacity planning and O3 memory considerations.
- QuestDB documentation — Deduplication.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-009.md">⬅️ Part 009 — Schema Evolution and Type Safety</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-011.md">Ahead Log, Durability, and WAL Apply Pipeline ➡️</a>
</div>
