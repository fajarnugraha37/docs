# Part 31 — Performance Engineering for Jakarta Batch

**Series:** `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
**File:** `31-performance-engineering-jakarta-batch.md`  
**Scope:** Java 8–25, Java EE/Jakarta EE batch runtime, Jakarta Batch 2.1 baseline, Jakarta EE 11 platform context  
**Audience:** senior/backend/platform engineers designing production-grade batch workloads in enterprise Java systems

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami bahwa performance batch bukan sekadar “lebih banyak thread” atau “commit lebih besar”.
2. Membaca batch sebagai **flow of bounded work**: read → process → write → commit → checkpoint → observe → recover.
3. Membedakan bottleneck CPU-bound, DB-bound, I/O-bound, API-bound, lock-bound, pool-bound, GC-bound, dan coordination-bound.
4. Menentukan commit interval, fetch size, JDBC batch size, partition count, dan pool size dengan reasoning, bukan trial acak.
5. Mendesain batch yang cepat **dan** tetap restartable, idempotent, observable, fair terhadap workload lain, dan aman terhadap database shared.
6. Menyusun benchmark methodology yang tidak menipu.
7. Membuat worksheet capacity planning untuk workload batch production.
8. Mengerti interaksi Jakarta Batch dengan Java 8–25, termasuk virtual threads, GC modern, dan container-managed execution.

Bagian ini tidak akan mengulang dasar `ItemReader`, `ItemProcessor`, `ItemWriter`, checkpoint, partitioning, retry/skip, atau transaksi secara panjang karena sudah dibahas di Part 20–24. Fokus kita sekarang adalah **engineering performance sebagai sistem produksi**.

---

## 2. Problem yang Diselesaikan

Banyak batch job terlihat sederhana:

```text
ambil 5 juta record → transform → update DB → generate report
```

Namun di production, masalahnya biasanya bukan “cara loop”. Masalahnya adalah:

```text
Bagaimana memproses jutaan unit kerja dalam waktu terbatas,
tanpa membunuh database,
tanpa membuat request latency naik,
tanpa menghasilkan duplicate side effect,
tanpa kehilangan restartability,
dan tetap bisa dijelaskan saat audit/incident review?
```

Performance batch adalah desain terhadap beberapa constraint sekaligus:

| Constraint | Pertanyaan Kritis |
|---|---|
| Time window | Berapa lama job boleh berjalan? |
| Throughput | Berapa item per detik yang harus selesai? |
| Latency per item/chunk | Berapa lama setiap chunk mengikat resource? |
| Resource | CPU, memory, DB connection, network, file I/O, API quota |
| Contention | Apakah batch bersaing dengan online request? |
| Recovery | Apa yang terjadi jika mati di tengah jalan? |
| Audit | Bisakah kita membuktikan apa yang diproses, gagal, skipped, retried? |
| Safety | Apakah speed-up menyebabkan duplicate update atau lost update? |

Engineer level top tidak hanya bertanya:

```text
Bagaimana membuat batch lebih cepat?
```

Tetapi bertanya:

```text
Batas aman throughput sistem ini berapa,
bottleneck aktualnya apa,
dan apa trade-off jika kita menaikkan parallelism, commit interval, atau batch size?
```

---

## 3. Mental Model: Batch Performance sebagai Pipeline Bounded

Jakarta Batch chunk-oriented processing secara konseptual bekerja seperti ini:

```text
+-----------+      +--------------+      +-----------+      +-------------+
| read item | ---> | process item | ---> | aggregate | ---> | write chunk |
+-----------+      +--------------+      +-----------+      +-------------+
                                                              |
                                                              v
                                                       +-------------+
                                                       | commit tx   |
                                                       +-------------+
                                                              |
                                                              v
                                                       +-------------+
                                                       | checkpoint  |
                                                       +-------------+
```

Dalam Jakarta Batch, chunk processing membaca item satu per satu, memprosesnya, mengumpulkannya, lalu ketika jumlah item mencapai commit interval, runtime memanggil writer dan commit transaksi chunk tersebut. Ini adalah pusat dari performance model: **setiap chunk adalah unit kerja, unit transaksi, unit retry/rollback tertentu, dan unit checkpoint**.

Performance batch tidak cukup dianalisis per item. Kita harus melihat beberapa level:

```text
item      = unit data/business processing
chunk     = unit transaksi + writer call + checkpoint boundary
step      = unit stage dalam job
partition = unit parallel shard
job       = unit governed execution
cluster   = unit distributed capacity + contention
```

### 3.1 Formula Dasar Throughput

Secara sederhana:

```text
throughput ≈ completed_items / elapsed_time
```

Untuk chunk:

```text
items_per_second ≈ commit_interval / chunk_duration_seconds
```

Jika commit interval = 500 dan rata-rata chunk selesai 2 detik:

```text
throughput ≈ 500 / 2 = 250 item/detik
```

Jika ada 4 partition yang benar-benar paralel dan tidak saling contention:

```text
total_throughput ≈ 4 × 250 = 1000 item/detik
```

Namun kata kuncinya adalah **jika tidak saling contention**. Dalam production, partition sering tidak linear karena bottleneck bergeser ke DB, connection pool, lock, API quota, disk, GC, atau downstream.

### 3.2 Amdahl-like Thinking untuk Batch

Jika hanya sebagian workload bisa diparalelkan, speed-up terbatas.

Misalnya:

```text
10% setup/aggregation serial
90% item processing parallelizable
```

Maka walaupun partition ditambah terus, bagian 10% tetap membatasi total runtime.

```text
max theoretical speedup ≈ 1 / serial_fraction
                         ≈ 1 / 0.10
                         ≈ 10x
```

Dalam praktik, lebih rendah karena overhead:

- connection acquisition
- lock contention
- GC pressure
- serialization/deserialization
- checkpoint metadata update
- network latency
- downstream throttling
- log volume
- coordination antar partition

### 3.3 Little’s Law untuk Batch

Little’s Law:

```text
L = λ × W
```

Di batch:

```text
in_flight_work = throughput × average_time_in_system
```

Jika target throughput 1000 item/detik dan rata-rata item butuh 2 detik dari read sampai write, maka sistem perlu menampung sekitar:

```text
in_flight ≈ 1000 × 2 = 2000 item
```

Jika memory/queue/pool tidak cukup, sistem akan menekan resource. Jika in-flight terlalu besar, latency dan recovery blast radius naik.

Top-tier batch engineering selalu menanyakan:

```text
Berapa banyak work boleh in-flight pada saat yang sama?
```

Bukan hanya:

```text
Berapa thread yang bisa saya buat?
```

---

## 4. Performance Objective: Jangan Mulai dari Tuning, Mulai dari SLO

Sebelum tuning, tetapkan target.

Contoh requirement buruk:

```text
Batch harus cepat.
```

Contoh requirement lebih baik:

```text
Nightly case ageing recalculation harus memproses maksimal 3 juta case
antara 01:00–04:00, tanpa menaikkan p95 latency online search lebih dari 20%,
dan harus restartable tanpa duplicate escalation.
```

### 4.1 Batch Performance SLO

Tentukan minimal:

| SLO | Contoh |
|---|---|
| Completion window | selesai < 3 jam |
| Throughput | >= 280 item/detik sustained |
| Error budget | failed/skipped < 0.1% dengan evidence |
| Retry budget | retry max 3 per item, global retry storm guard |
| DB impact | DB CPU < 70%, active sessions batch < 20 |
| Pool impact | batch pakai max 20 dari 100 connection |
| Online impact | request p95 tidak naik > 20% |
| Recovery | restart dari checkpoint < 15 menit setelah failure |
| Observability | dashboard item/sec, chunk duration, retries, queue, partition skew |

### 4.2 Throughput Target dari Window

Jika input 5 juta item, window 2 jam:

```text
required_throughput = 5,000,000 / (2 × 60 × 60)
                    ≈ 694 item/detik
```

Tambahkan margin, misalnya 30%:

```text
target_throughput ≈ 694 × 1.3
                  ≈ 902 item/detik
```

Lalu tanya:

```text
Apakah DB, API, disk, connection pool, CPU, dan memory bisa sustain 900 item/detik?
```

Jika external API limit hanya 300 request/menit, maka target mustahil bila 1 item = 1 API call.

```text
300/min = 5/detik
```

Tidak ada tuning Java yang bisa mengubah quota external API. Solusinya bukan tambah partition, tetapi:

- caching
- batching API jika tersedia
- prefetch
- delta processing
- SLA renegotiation
- split window
- async outbox
- reduce calls per item

---

## 5. Bottleneck Taxonomy

Performance tuning tanpa bottleneck taxonomy biasanya berubah menjadi tebak-tebakan.

### 5.1 CPU-bound

Gejala:

- CPU application node tinggi
- DB/API tidak terlalu sibuk
- thread aktif banyak dan runnable
- GC mungkin ikut naik karena alokasi object
- item processor dominan

Contoh:

- complex validation
- crypto/signature verification
- PDF generation
- XML canonicalization
- JSON transformation besar
- rules evaluation

Tuning utama:

- optimasi algorithm
- reduce allocation
- cache immutable metadata
- partition sesuai core CPU
- jangan over-parallelize
- gunakan profiler/JFR

Rule of thumb:

```text
CPU-bound parallelism ≈ jumlah core efektif
```

Jika node punya 8 vCPU, 64 partition CPU-bound sering membuat context switching dan cache contention, bukan speed-up.

### 5.2 DB-bound

Gejala:

- DB CPU/IO tinggi
- wait event DB meningkat
- connection pool penuh
- chunk duration naik walau CPU app rendah
- lock wait/deadlock/undo pressure

Contoh:

- update jutaan row
- join kompleks per item
- N+1 query dalam processor
- commit interval terlalu besar/kecil
- index buruk
- lock overlap antar partition

Tuning utama:

- query plan/index
- keyset scanning
- JDBC fetch size
- JDBC batch size
- commit interval
- partition by non-overlapping key range
- reduce round-trip
- avoid per-item SELECT if preloading possible
- separate pool/bulkhead

### 5.3 I/O-bound File

Gejala:

- CPU rendah
- disk/network storage throughput tinggi
- reader/writer menunggu
- compression/decompression bottleneck

Contoh:

- membaca CSV besar dari network share
- menulis export file besar
- gzip compression
- object storage latency

Tuning utama:

- streaming
- buffered I/O
- local staging
- avoid small writes
- tune buffer size
- parallelize by file/range jika aman
- manifest/checksum terpisah

### 5.4 External API-bound

Gejala:

- thread banyak menunggu HTTP
- 429/503 meningkat
- latency downstream naik
- retry storm
- throughput mentok di quota

Tuning utama:

- global rate limiter
- concurrency limiter
- bulkhead
- idempotency key
- retry budget
- circuit breaker
- token refresh caching
- outbox/inbox
- reconciliation

### 5.5 Lock-bound

Gejala:

- DB lock wait tinggi
- deadlock muncul saat partition ditambah
- throughput turun ketika parallelism naik
- row/table/block contention

Tuning utama:

- partition by disjoint key ranges
- deterministic ordering
- reduce transaction duration
- smaller commit interval
- skip locked / claim table pattern jika sesuai
- avoid updating same summary row from all partitions

### 5.6 Pool-bound

Gejala:

- app thread menunggu connection
- DB tidak terlalu sibuk tetapi pool exhausted
- chunk duration didominasi acquire connection
- online request ikut lambat

Tuning utama:

- separate datasource/pool for batch jika perlu
- cap partition count
- reduce connection hold time
- avoid opening multiple connections per item
- measure acquisition time

### 5.7 GC-bound / Allocation-bound

Gejala:

- GC pause atau CPU GC tinggi
- allocation rate tinggi
- object churn dari parsing/DTO mapping
- memory naik per chunk/partition

Tuning utama:

- streaming parser
- avoid collecting entire file/result set
- reuse immutable metadata
- reduce intermediate DTOs
- tune chunk size
- watch large object allocation
- Java 17/21+ GC selection and JFR analysis

### 5.8 Coordination-bound

Gejala:

- partition banyak tapi progress tidak linear
- repository update/metadata contention
- reducer/analyzer bottleneck
- final aggregation lama

Tuning utama:

- reduce per-item coordination
- aggregate per partition then merge
- avoid shared mutable counters in DB
- batch metrics updates
- minimize central lock

---

## 6. Commit Interval Engineering

Commit interval adalah salah satu knob paling penting dalam Jakarta Batch.

Secara konseptual:

```xml
<chunk item-count="500">
    <reader ref="reader"/>
    <processor ref="processor"/>
    <writer ref="writer"/>
</chunk>
```

`item-count=500` berarti runtime akan membentuk chunk 500 item sebelum writer dipanggil dan transaksi chunk dikomit, kecuali terjadi akhir data atau policy lain.

### 6.1 Commit Interval Terlalu Kecil

Misalnya `item-count=1`.

Dampak:

- banyak transaksi kecil
- commit overhead tinggi
- writer sering dipanggil
- DB round-trip tinggi
- checkpoint update sering
- throughput rendah

Kelebihan:

- recovery sangat presisi
- lock duration kecil
- memory kecil
- duplicate replay minimal

Cocok untuk:

- side effect sangat mahal jika diulang
- item besar
- operasi rawan konflik
- SLA recovery sangat ketat

### 6.2 Commit Interval Terlalu Besar

Misalnya `item-count=100_000`.

Dampak:

- transaksi lama
- lock lama
- undo/redo besar
- memory chunk besar
- rollback mahal
- restart replay besar
- writer memegang list besar
- kemungkinan timeout transaksi

Kelebihan:

- commit overhead lebih kecil
- writer bisa melakukan batch operation besar
- throughput bisa naik jika DB mampu

Cocok hanya jika:

- item kecil
- writer idempotent
- DB mampu
- transaksi tidak menahan lock kritis
- memory cukup
- failure replay acceptable

### 6.3 Commit Interval sebagai Trade-off

| Commit Interval | Throughput | Recovery Granularity | Lock Duration | Memory | Rollback Cost |
|---:|---|---|---|---|---|
| kecil | rendah–sedang | bagus | rendah | rendah | rendah |
| medium | biasanya optimal | cukup | cukup | cukup | cukup |
| besar | bisa tinggi, bisa buruk | buruk | tinggi | tinggi | tinggi |

Tidak ada angka universal. Angka harus ditemukan melalui benchmark yang realistis.

### 6.4 Cara Menentukan Awal Commit Interval

Mulai dari klasifikasi item:

| Item Type | Starting Commit Interval |
|---|---:|
| heavy CPU item | 10–100 |
| DB update moderate | 100–1000 |
| simple insert/update | 500–5000 |
| large payload/blob | 1–50 |
| external API call | biasanya kecil, atau writer outbox |
| file export simple | 1000–10000 |

Lalu ukur:

```text
chunk_duration
writer_duration
commit_duration
rollback_cost
memory_per_chunk
DB wait
lock wait
restart replay size
```

### 6.5 Formula Awal

Misalnya target chunk duration aman adalah 1–5 detik. Jika rata-rata item end-to-end 5 ms dan writer batch efisien:

```text
commit_interval ≈ target_chunk_duration_ms / avg_item_ms
                ≈ 2000 / 5
                ≈ 400
```

Mulai dari 400 atau 500, lalu benchmark.

Namun jika writer melakukan JDBC batch yang optimal di 1000 rows, mulai dari 1000.

### 6.6 Chunk Duration sebagai Guardrail

Daripada terobsesi pada item-count, engineer senior melihat chunk duration:

```text
p50 chunk duration
p95 chunk duration
p99 chunk duration
max chunk duration
```

Jika p99 chunk = 90 detik, risiko besar:

- transaction timeout
- lock duration buruk
- restart replay mahal
- graceful shutdown sulit
- pod termination dapat memutus transaksi besar

Untuk banyak enterprise workload, chunk p95 di kisaran 1–10 detik lebih operasional daripada chunk 5 menit. Tetapi ini tergantung workload.

---

## 7. JDBC Fetch Size, JDBC Batch Size, dan Commit Interval

Tiga hal ini sering dicampur, padahal berbeda.

| Knob | Berlaku di | Fungsi |
|---|---|---|
| JDBC fetch size | read/query | berapa row diambil per round-trip/fetch dari DB driver |
| JDBC batch size | write/update | berapa statement dikirim sebagai batch ke DB |
| Batch commit interval | Jakarta Batch chunk | berapa item per transaksi/checkpoint |

### 7.1 Fetch Size

Fetch size mempengaruhi reader ketika membaca result set besar.

Terlalu kecil:

- banyak round-trip
- overhead network tinggi

Terlalu besar:

- memory naik
- cursor/resource lebih berat
- latency awal bisa naik

Contoh reader JDBC streaming:

```java
public class CaseReader extends AbstractItemReader {

    private Connection connection;
    private PreparedStatement statement;
    private ResultSet resultSet;

    @Override
    public void open(Serializable checkpoint) throws Exception {
        connection = dataSource.getConnection();
        statement = connection.prepareStatement(
            """
            select case_id, status, last_activity_date
            from case_table
            where case_id > ?
            order by case_id
            """,
            ResultSet.TYPE_FORWARD_ONLY,
            ResultSet.CONCUR_READ_ONLY
        );
        statement.setFetchSize(1000);
        statement.setLong(1, checkpoint == null ? 0L : (Long) checkpoint);
        resultSet = statement.executeQuery();
    }

    @Override
    public Object readItem() throws Exception {
        if (!resultSet.next()) {
            return null;
        }
        long id = resultSet.getLong("case_id");
        return new CaseInput(
            id,
            resultSet.getString("status"),
            resultSet.getDate("last_activity_date").toLocalDate()
        );
    }
}
```

Catatan: behavior fetch size bergantung database/driver. Oracle, PostgreSQL, MySQL, SQL Server punya detail berbeda. Jangan menganggap satu nilai universal.

### 7.2 JDBC Batch Size

Writer sering melakukan:

```java
for (Object item : items) {
    ps.setLong(1, item.id());
    ps.setString(2, item.newStatus());
    ps.addBatch();
}
ps.executeBatch();
```

Jika chunk berisi 1000 item, tidak berarti harus satu `executeBatch()` raksasa. Bisa dibagi:

```java
private static final int JDBC_BATCH_SIZE = 200;

@Override
public void writeItems(List<Object> items) throws Exception {
    int pending = 0;
    for (Object object : items) {
        CaseUpdate item = (CaseUpdate) object;
        statement.setString(1, item.newStatus());
        statement.setLong(2, item.caseId());
        statement.addBatch();
        pending++;

        if (pending % JDBC_BATCH_SIZE == 0) {
            statement.executeBatch();
        }
    }

    if (pending % JDBC_BATCH_SIZE != 0) {
        statement.executeBatch();
    }
}
```

### 7.3 Relationship yang Aman

Tidak harus:

```text
fetch_size == jdbc_batch_size == commit_interval
```

Contoh konfigurasi masuk akal:

```text
commit_interval = 1000
fetch_size      = 2000
jdbc_batch_size = 200
```

Artinya:

- reader mengambil data cukup efisien dari DB
- chunk transaction memproses 1000 item
- writer mengirim update dalam sub-batch 200 statement

### 7.4 Tanda Batch Size Terlalu Besar

- driver memory naik
- DB parse/execute latency naik
- lock duration naik
- undo/redo spike
- batch failure sulit didiagnosis per item
- timeout writer

### 7.5 Tanda Batch Size Terlalu Kecil

- round-trip tinggi
- DB CPU parsing tinggi
- network overhead tinggi
- throughput rendah

---

## 8. Partition Count Engineering

Partitioning sudah dibahas pada Part 24. Di sini fokusnya performance.

### 8.1 Partition Count Bukan Thread Count Sembarangan

Partition count harus mempertimbangkan:

```text
available app CPU
DB connection pool
DB max active sessions
downstream API quota
lock overlap
input skew
memory per partition
job repository overhead
observability cardinality
```

Jika tiap partition butuh 1 DB connection dan pool batch hanya 10, maka partition count 50 tidak membuat 50 partition benar-benar berjalan. Sisanya antre atau membuat pool exhaustion.

### 8.2 Starting Point

| Workload | Starting Partition Count |
|---|---:|
| CPU-bound | <= core efektif |
| DB-heavy update | 2–8, tergantung DB capacity |
| read-only export | 2–16, tergantung storage/network |
| API-bound | berdasarkan quota dan latency |
| file-per-partition | berdasarkan jumlah file dan disk bandwidth |
| mixed workload | mulai konservatif, ukur bottleneck |

### 8.3 API-bound Partition Formula

Jika API quota 600 request/menit = 10 request/detik, dan rata-rata latency 500 ms:

```text
required_concurrency ≈ rate × latency
                     ≈ 10/s × 0.5s
                     ≈ 5 concurrent calls
```

Maka partition/worker concurrency di sekitar 5–8 mungkin cukup. Partition 50 hanya akan menghasilkan 429 dan retry storm.

### 8.4 DB-bound Partition Formula Kasar

Jika DB mampu sustain 2000 update/detik untuk workload ini, dan satu partition dengan commit interval tertentu menghasilkan 300 update/detik:

```text
partition_needed ≈ 2000 / 300 ≈ 6.7
```

Mulai dari 6 atau 7, lalu ukur DB wait/lock/pool.

Namun jika partition saling mengupdate index hot block atau summary row yang sama, throughput tidak linear.

### 8.5 Partition Skew

Partition count tinggi tidak berguna jika data tidak seimbang.

Contoh buruk:

```text
partition 1: case_id 1 - 1,000,000
partition 2: case_id 1,000,001 - 2,000,000
...
```

Jika case_id lama punya banyak child rows dan case_id baru ringan, partition awal jauh lebih berat.

Mitigasi:

- partition by estimated cost, bukan row count saja
- histogram/statistics
- hash partitioning untuk sebaran merata
- dynamic work claiming
- split heavy tenant/module
- measure per-partition throughput

### 8.6 Partition Count Tuning Experiment

Jangan hanya tes 1 nilai. Gunakan ladder:

```text
partition = 1, 2, 4, 8, 12, 16
```

Untuk setiap nilai ukur:

```text
items/sec
chunk p95/p99
DB CPU
DB wait
connection acquisition p95
lock wait
GC allocation rate
retry count
skipped/error count
online p95 latency
```

Pilih titik sebelum diminishing return.

Contoh hasil:

| Partition | Items/sec | DB CPU | Lock Wait | Online p95 Impact | Keputusan |
|---:|---:|---:|---:|---:|---|
| 1 | 250 | 20% | low | none | terlalu lambat |
| 2 | 480 | 35% | low | none | baik |
| 4 | 900 | 55% | low | +5% | baik |
| 8 | 1300 | 78% | medium | +18% | mungkin batas atas |
| 12 | 1350 | 90% | high | +45% | buruk |
| 16 | 1200 | 95% | high | +70% | collapse |

Titik aman mungkin 4 atau 8, bukan 16.

---

## 9. Reader Performance

Reader yang buruk akan membuat seluruh pipeline buruk.

### 9.1 Anti-pattern: OFFSET Pagination Besar

```sql
select *
from case_table
order by case_id
offset 5000000 rows fetch next 1000 rows only
```

Pada banyak DB, offset besar mahal karena DB tetap harus melewati banyak row.

### 9.2 Keyset Pagination

Lebih baik:

```sql
select case_id, status, last_activity_date
from case_table
where case_id > :last_case_id
order by case_id
fetch next :page_size rows only
```

Checkpoint menyimpan `last_case_id`.

Kelebihan:

- stabil untuk data besar
- cocok restart
- tidak makin lambat seiring offset naik
- deterministic jika key immutable

Caveat:

- harus punya ordering key stabil
- data insert/update concurrent harus dipikirkan
- untuk snapshot consistency, perlu cutoff parameter

### 9.3 Snapshot/Cutoff Strategy

Untuk batch regulatory, sering lebih aman memakai cutoff:

```sql
where created_at < :job_cutoff_time
  and case_id > :last_case_id
order by case_id
```

Dengan begitu job instance punya input boundary stabil.

### 9.4 Claim Table Pattern

Untuk distributed/dynamic workload:

```sql
update batch_work_item
set status = 'CLAIMED', claimed_by = :worker, claimed_at = current_timestamp
where id in (
    select id
    from batch_work_item
    where status = 'PENDING'
    order by priority, id
    fetch first :n rows only
)
```

Caveat:

- SQL berbeda antar DB
- perlu handling stuck claimed items
- perlu idempotency
- bisa menjadi coordination bottleneck jika tidak diindeks

### 9.5 Reader Jangan Melakukan Business Work Berat

Reader harus bertugas mengambil item. Jika reader juga melakukan 5 query child table per item, bottleneck tersembunyi.

Lebih baik:

- reader membaca key/input minimal
- processor enrichment dilakukan dengan strategi batch/cache
- writer melakukan update bulk

---

## 10. Processor Performance

Processor idealnya deterministic dan bebas side effect.

```text
input item -> output item atau null
```

### 10.1 Processor Purity

Processor yang pure lebih mudah:

- diparalelkan
- dites
- di-retry
- di-skip
- di-cache
- di-profile

Processor buruk:

```java
public Object processItem(Object item) {
    callExternalApi(item);      // side effect
    updateDatabase(item);       // side effect
    sendEmail(item);            // side effect
    return transform(item);
}
```

Jika chunk rollback, side effect sudah terlanjur terjadi.

### 10.2 Reduce Per-item DB Query

Anti-pattern:

```java
for each item:
    select config
    select user
    select module
    select policy
```

Mitigasi:

- preload reference data once per step
- cache immutable config
- join di reader jika cocok
- batch lookup by keys per chunk
- local map keyed by code

### 10.3 Object Allocation

Processor sering membuat object berlapis:

```text
Entity -> DTO -> DomainModel -> ViewModel -> UpdateCommand
```

Untuk jutaan item, alokasi object bisa menjadi bottleneck.

Optimasi:

- gunakan record/value object ringan
- hindari string concatenation besar per item
- hindari parsing tanggal berulang jika bisa
- reuse formatter immutable/thread-safe
- hindari JSON serialization dalam hot path kecuali perlu
- hindari logging per item

### 10.4 CPU Profiling

Gunakan JFR/profiler untuk menjawab:

```text
method apa yang makan CPU?
allocation site mana yang terbesar?
lock mana yang sering contend?
GC pressure dari object apa?
```

Jangan optimasi berdasarkan feeling.

---

## 11. Writer Performance

Writer adalah tempat banyak side effect terjadi. Performance writer harus tetap idempotent.

### 11.1 Batch Update

Contoh writer idempotent dengan status transition guarded:

```java
public class CaseEscalationWriter extends AbstractItemWriter {

    @Resource(lookup = "java:app/jdbc/BatchDS")
    private DataSource dataSource;

    @Override
    public void writeItems(List<Object> items) throws Exception {
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement(
                 """
                 update case_table
                 set escalation_status = ?,
                     escalation_reason = ?,
                     updated_at = current_timestamp
                 where case_id = ?
                   and escalation_status <> ?
                 """)) {

            int count = 0;
            for (Object object : items) {
                EscalationDecision decision = (EscalationDecision) object;
                statement.setString(1, decision.newStatus());
                statement.setString(2, decision.reason());
                statement.setLong(3, decision.caseId());
                statement.setString(4, decision.newStatus());
                statement.addBatch();

                if (++count % 200 == 0) {
                    statement.executeBatch();
                }
            }

            if (count % 200 != 0) {
                statement.executeBatch();
            }
        }
    }
}
```

Guard condition membuat repeated execution tidak selalu merusak state.

### 11.2 Upsert dengan Idempotency Key

Untuk insert side effect:

```sql
insert into notification_outbox (
    idempotency_key,
    case_id,
    notification_type,
    payload,
    status,
    created_at
)
values (?, ?, ?, ?, 'PENDING', current_timestamp)
on conflict (idempotency_key) do nothing
```

Untuk Oracle, bisa memakai `MERGE` atau unique constraint + handle duplicate key.

### 11.3 Avoid Per-item Commit

Writer tidak boleh melakukan commit manual per item dalam managed transaction chunk, kecuali step memang didesain non-transactional dengan alasan kuat. Biarkan runtime mengelola transaksi chunk.

### 11.4 Writer Error Diagnosability

Jika batch update 1000 item gagal, error bisa sulit dilacak. Untuk observability:

- log chunk id/partition id/range
- simpan first/last item key
- bila batch failure, fallback diagnostic mode untuk identify offending item
- jangan log payload sensitif
- gunakan error table dengan item key dan reason

---

## 12. Database Pool Pressure

Batch sering berjalan di sistem yang juga melayani request online. Jika batch mengambil semua connection, request ikut lambat.

### 12.1 Separate Pool / Bulkhead

Pertimbangkan datasource khusus batch:

```text
OnlineDS: max 80 connections
BatchDS : max 20 connections
```

Ini bukan selalu berarti DB total connection bertambah tanpa batas. Ini cara membatasi batch agar tidak mencuri kapasitas online.

### 12.2 Pool Sizing Rule

Jika partition count 8 dan tiap partition butuh:

- 1 connection reader
- 1 connection writer
- kadang 1 connection enrichment

Maka worst-case bisa:

```text
8 × 2 atau 8 × 3 = 16–24 connections
```

Namun desain baik biasanya menghindari memegang banyak connection bersamaan.

### 12.3 Measure Acquisition Time

Tambahkan metric:

```text
db.connection.acquire.duration
```

Jika acquire p95 naik, batch mungkin pool-bound.

### 12.4 Jangan Samakan App Pool dengan DB Capacity

Pool 100 bukan berarti DB mampu 100 active heavy batch sessions. DB bisa collapse jauh sebelum pool penuh.

Gunakan:

- DB CPU
- active sessions
- wait events
- IOPS
- redo generation
- lock wait
- query elapsed time

---

## 13. Transaction Timeout, Lock Duration, Undo/Redo Pressure

### 13.1 Transaction Timeout

Chunk yang terlalu lama bisa kena transaction timeout.

Mitigasi:

- kecilkan commit interval
- optimasi writer
- kurangi partition lock conflict
- perbaiki query plan
- jangan masukkan external API call dalam transaction chunk

### 13.2 Lock Duration

Semakin lama chunk transaction, semakin lama lock ditahan.

Jika online request perlu row yang sama, latency naik.

Design:

- update disjoint keys
- short chunk transaction
- avoid summary row hot update
- schedule heavy update off-peak
- use staging table then controlled merge

### 13.3 Undo/Redo Pressure

Batch update besar menghasilkan undo/redo besar.

Gejala:

- DB IO naik
- archive log pressure
- replication lag
- undo tablespace pressure
- commit latency naik

Mitigasi:

- commit interval moderat
- batch window
- index review
- update only changed rows
- reduce unnecessary column updates
- partition table strategy jika ada
- coordinate with DBA

### 13.4 Update Only When Changed

Buruk:

```sql
update case_table
set status = :new_status
where case_id = :id
```

Lebih baik:

```sql
update case_table
set status = :new_status
where case_id = :id
  and status <> :new_status
```

Ini mengurangi redo, trigger, lock impact, dan audit noise.

---

## 14. Memory and GC Engineering Java 8–25

Batch sering memproses volume besar. Kesalahan memory paling umum adalah menyimpan terlalu banyak state.

### 14.1 Memory per Chunk

Jika satu item output rata-rata 10 KB dan commit interval 5000:

```text
chunk_memory ≈ 10 KB × 5000 = 50 MB per partition
```

Jika 8 partition:

```text
≈ 400 MB hanya untuk item output
```

Belum termasuk:

- input object
- intermediate object
- JDBC driver buffer
- logging strings
- persistence context
- caches
- JSON/XML parser buffers

### 14.2 JPA Persistence Context Trap

Jika memakai JPA dalam batch dan tidak clear persistence context, memory bisa terus naik.

Pattern:

```java
if (count % batchSize == 0) {
    entityManager.flush();
    entityManager.clear();
}
```

Namun dalam Jakarta Batch managed transaction, harus hati-hati dengan boundary chunk. Untuk high-volume write, JDBC sering lebih predictable daripada JPA.

### 14.3 Java 8 vs 11/17/21/25

Java 8:

- GC default lama berbeda
- G1 tersedia tetapi behavior lebih tua
- tidak ada virtual threads
- observability JFR historis berbeda lisensi/availability tergantung distribusi lama

Java 11:

- G1 default
- JFR lebih umum
- better container awareness dibanding era lama

Java 17:

- LTS modern baseline banyak enterprise
- GC dan JIT lebih matang

Java 21:

- virtual threads final
- generational ZGC tersedia
- runtime observability lebih baik

Java 25:

- Java 25 membawa evolusi language/runtime terbaru; structured concurrency masih preview sesuai JEP terkait
- batch production tetap harus memakai feature preview dengan governance ketat jika digunakan

### 14.4 Virtual Threads dan Batch Performance

Virtual threads membantu jika bottleneck adalah blocking I/O dan banyak task menunggu.

Tidak membantu jika bottleneck adalah:

- DB CPU
- DB lock
- external API quota
- CPU-bound processing
- single hot row
- bad query plan
- memory pressure

Virtual threads dapat membuat lebih banyak blocking task hidup bersamaan. Tanpa capacity limit, ini justru bisa memperbesar pressure ke DB/API.

Mental model:

```text
virtual threads reduce cost of waiting,
they do not increase downstream capacity.
```

### 14.5 Logging Per Item

Logging jutaan item adalah performance killer dan storage killer.

Buruk:

```java
log.info("Processed item {}", id);
```

Lebih baik:

```text
per chunk: partition, range, count, duration, retries, failures
per failed item: sanitized key + reason
per job: summary metrics
```

---

## 15. Benchmark Methodology yang Tidak Menipu

Benchmark batch yang buruk memberi confidence palsu.

### 15.1 Jangan Benchmark dengan 1000 Row Jika Production 50 Juta

Masalah production sering muncul setelah:

- index cache tidak cukup
- offset membesar
- DB statistics berbeda
- undo/redo pressure muncul
- GC old gen naik
- partition skew terlihat
- archive log/replication lag muncul

Gunakan skala representatif.

### 15.2 Dataset Harus Mirip Production

Perhatikan:

- distribusi status
- jumlah child rows
- tenant/module skew
- ukuran payload
- null/invalid data
- old vs new cases
- duplicate keys
- referential constraints
- index selectivity

### 15.3 Warm-up dan Cold Run

Ukur dua jenis:

| Run | Tujuan |
|---|---|
| cold run | melihat behavior awal, cache miss, startup cost |
| warm run | melihat sustained throughput |

Jangan hanya melaporkan warm run terbaik.

### 15.4 Benchmark Matrix

Contoh matrix:

| Variable | Values |
|---|---|
| commit interval | 100, 500, 1000, 5000 |
| partition count | 1, 2, 4, 8, 12 |
| JDBC fetch size | 500, 1000, 5000 |
| JDBC batch size | 100, 200, 500 |

Jangan full Cartesian product jika terlalu banyak. Mulai dari baseline, ubah satu knob, lalu fokus ke area sensitif.

### 15.5 Metrics yang Harus Dikumpulkan

Batch metrics:

```text
items.read.count
items.processed.count
items.written.count
items.skipped.count
items.retried.count
chunks.completed.count
chunk.duration
reader.duration
processor.duration
writer.duration
commit.duration
checkpoint.duration
partition.throughput
partition.lag
job.elapsed
```

App/runtime metrics:

```text
CPU
heap used
GC pause
GC allocation rate
thread count
virtual thread count if relevant
connection pool active/idle/pending/acquire time
HTTP client active/pending
```

DB metrics:

```text
DB CPU
active sessions
wait events
lock wait
IOPS
redo generation
undo usage
query elapsed
execution plan
rows examined vs returned
```

External API metrics:

```text
request rate
latency p50/p95/p99
429/5xx count
retry count
circuit breaker state
quota remaining
```

### 15.6 Report Format

Benchmark report minimal:

```text
workload: case ageing recalculation
input size: 5,000,000 cases
run environment: UAT-like DB, 4 app pods, 8 vCPU each
config: commit=1000, partitions=8, fetch=2000, jdbcBatch=200
elapsed: 1h 38m
throughput avg: 850 items/sec
throughput p10/p90 by partition: 690/940 items/sec
DB CPU avg/max: 62%/78%
connection acquire p95: 40ms
chunk p95/p99: 4.2s/8.9s
retry count: 1,230
skip count: 214
online p95 impact: +9%
restart test: killed pod at 40%; resumed from checkpoint; duplicate side effects 0
```

---

## 16. Capacity Planning Worksheet

Gunakan worksheet ini sebelum production rollout.

### 16.1 Input Volume

```text
Total item count: ______________________
Average item payload size: ______________
Max item payload size: __________________
Expected growth per month: ______________
Worst-case backlog: _____________________
```

### 16.2 Time Window

```text
Allowed start time: _____________________
Allowed end time: _______________________
Total available seconds: ________________
Required throughput: ____________________ items/sec
Safety margin: __________________________ %
Target throughput: ______________________ items/sec
```

Formula:

```text
required_throughput = total_items / available_seconds
target_throughput   = required_throughput × (1 + safety_margin)
```

### 16.3 Workload Classification

```text
CPU-bound?          yes/no
DB-bound?           yes/no
File I/O-bound?     yes/no
External API-bound? yes/no
Lock-sensitive?     yes/no
Memory-heavy?       yes/no
```

Dominant bottleneck:

```text
_________________________________________
```

### 16.4 Configuration Candidate

```text
commit interval: ________________________
partition count: ________________________
JDBC fetch size: ________________________
JDBC batch size: ________________________
batch DB pool max: ______________________
API concurrency limit: __________________
API rate limit: _________________________
transaction timeout: ____________________
job timeout/deadline: ___________________
```

### 16.5 Resource Budget

```text
App CPU budget: _________________________
App memory budget: ______________________
DB CPU budget: __________________________
DB active session budget: _______________
DB connection budget: ___________________
External API quota: _____________________
Disk/network throughput: ________________
```

### 16.6 Recovery Budget

```text
Max acceptable replay after failure: _____ items
Max restart time: _______________________
Max duplicate side effects allowed: ______
Checkpoint size: ________________________
Idempotency mechanism: __________________
```

### 16.7 Online Impact Budget

```text
Online p95 latency max increase: _________ %
Online DB connection reserved: __________
Batch allowed schedule: _________________
Emergency stop process tested? __________
```

---

## 17. Practical Tuning Playbook

### 17.1 Step 1 — Establish Baseline

Run with conservative config:

```text
partition = 1
commit interval = moderate
logging = normal summary only
```

Measure:

- throughput
- chunk duration
- DB metrics
- CPU
- memory
- retry/skip

This tells you single-lane capacity.

### 17.2 Step 2 — Identify Dominant Bottleneck

Ask:

```text
Where does time go?
```

Break chunk duration into:

```text
reader time
processor time
writer time
commit time
checkpoint time
waiting time
```

### 17.3 Step 3 — Tune Commit Interval

Try:

```text
100 → 500 → 1000 → 5000
```

Observe:

- throughput improvement
- chunk duration
- rollback cost
- memory
- DB lock/undo/redo

Stop increasing when:

- throughput no longer improves materially
- chunk p99 too high
- transaction timeout risk
- memory/GC rises
- lock/online impact rises

### 17.4 Step 4 — Tune JDBC Fetch/Batch

For reader:

```text
fetch size 500, 1000, 2000, 5000
```

For writer:

```text
executeBatch size 100, 200, 500, 1000
```

DB driver-specific behavior matters.

### 17.5 Step 5 — Tune Partition Count

Try:

```text
1 → 2 → 4 → 8 → 12
```

Stop at point before DB/API/lock/pool contention dominates.

### 17.6 Step 6 — Test Failure and Restart at Load

Performance tuning without failure test is incomplete.

Test:

- kill app pod mid-job
- DB connection timeout
- writer exception mid-chunk
- retryable external API 503
- poison item
- stop job during heavy chunk
- restart job

Measure:

- duplicate side effects
- replay size
- restart duration
- stuck locks
- repository consistency

### 17.7 Step 7 — Test Online Coexistence

Run batch while online traffic simulation is active.

Measure:

- online p95/p99
- DB active sessions
- connection pool pending
- lock wait
- CPU headroom

Batch yang cepat tetapi merusak online SLA belum production-ready.

---

## 18. Performance Patterns

### 18.1 Staging Table Pattern

Gunakan staging untuk memisahkan read/compute dan final mutation.

```text
read source → compute result → write staging → validate → merge/apply
```

Kelebihan:

- auditable
- restartable
- can review before apply
- reduce lock duration on final table
- easier reconciliation

### 18.2 Delta Processing

Daripada proses semua data:

```text
process only changed since last successful cutoff
```

Butuh:

- reliable change marker
- cutoff timestamp
- idempotent re-run
- handling late changes

### 18.3 Precomputed Work Item Table

Buat table:

```text
batch_work_item(job_instance_id, item_key, status, partition_key, attempt_count, error_code)
```

Kelebihan:

- deterministic input set
- easier restart
- dynamic claiming
- progress visible
- retry/skip per item traceable

### 18.4 Bulkhead Pool

Pisahkan capacity:

```text
online executor / datasource
batch executor / datasource
external API client pool
```

### 18.5 Adaptive Throttling

Batch menurunkan throughput saat DB/API pressure tinggi.

Pseudo:

```text
if DB_CPU > 75% or online_p95 > threshold:
    reduce partition concurrency or sleep between chunks
else if headroom available:
    cautiously increase
```

Jakarta Batch tidak memberi adaptive throttling portable out-of-the-box. Ini perlu desain di control plane atau batch artifact.

### 18.6 Two-phase External Side Effect

Jangan panggil external side effect langsung dalam processor.

Gunakan:

```text
batch writes outbox rows → separate sender sends with rate limit → reconciliation
```

Performance lebih terkontrol dan recovery lebih aman.

---

## 19. Performance Anti-Patterns

### 19.1 “Tambah Partition Sampai Cepat”

Parallelism tanpa capacity model menyebabkan:

- DB collapse
- API 429 storm
- lock wait
- retry storm
- noisy neighbor problem

### 19.2 Huge Commit Interval untuk Semua Job

Commit interval besar bisa menaikkan throughput, tetapi juga menaikkan:

- rollback blast radius
- memory
- lock duration
- undo/redo pressure
- restart replay

### 19.3 Per-item Logging

Membunuh throughput, memenuhi storage, dan membuat log tidak berguna.

### 19.4 JPA Entity Loop Tanpa Flush/Clear

Memory leak-like behavior dalam batch besar.

### 19.5 OFFSET Pagination

Makin jauh job berjalan, makin lambat.

### 19.6 External API Call Dalam Chunk Transaction

Transaksi DB terbuka sambil menunggu network. Ini buruk untuk lock, timeout, dan recovery.

### 19.7 Shared Summary Row Hotspot

Semua partition update row yang sama:

```sql
update batch_summary set processed_count = processed_count + 1
```

Ini membuat lock hotspot.

Lebih baik aggregate per partition lalu merge.

### 19.8 Benchmark Tanpa Failure

Batch yang cepat tetapi tidak restartable adalah liability.

### 19.9 Batch Menggunakan Pool Online Tanpa Limit

Membuat request user menjadi korban job background.

### 19.10 Common Pool / Unmanaged Threads di Server

Untuk Jakarta EE, gunakan managed resources dan governance container. Java concurrency primitive harus dipakai dengan sadar terhadap container contract.

---

## 20. Observability untuk Performance Engineering

### 20.1 Metrics Minimal

```text
batch_job_elapsed_seconds
batch_job_items_total{status="read|processed|written|skipped|failed"}
batch_chunk_duration_seconds{job,step,partition}
batch_reader_duration_seconds
batch_processor_duration_seconds
batch_writer_duration_seconds
batch_commit_duration_seconds
batch_checkpoint_duration_seconds
batch_partition_items_per_second
batch_retry_total{exception}
batch_skip_total{exception}
batch_db_connection_acquire_seconds
batch_external_api_latency_seconds
batch_external_api_status_total
```

### 20.2 Cardinality Control

Jangan pakai item id sebagai metric label.

Buruk:

```text
batch_item_duration{case_id="123"}
```

Baik:

```text
batch_chunk_duration{job="case-aging", step="evaluate", partition="07"}
```

### 20.3 Dashboard Layout

Dashboard batch performance:

```text
Row 1: Job status, elapsed, ETA, items/sec, completion %
Row 2: Chunk p50/p95/p99, read/process/write breakdown
Row 3: Partition throughput, partition lag, skew
Row 4: DB CPU, active sessions, pool active/pending, lock wait
Row 5: Retry/skip/error, top exception classes
Row 6: GC, heap, CPU, thread/virtual-thread count
Row 7: Online SLA impact
```

### 20.4 ETA Calculation

```text
eta_seconds = remaining_items / current_smoothed_throughput
```

Gunakan moving average, bukan instantaneous rate.

### 20.5 Performance Regression Alert

Alert jika:

- throughput turun > 30% dari baseline
- chunk p95 naik > 2x baseline
- DB acquire p95 > threshold
- partition skew ratio > 3x
- retry rate > normal
- online p95 impact > allowed

---

## 21. Case Study: Nightly Regulatory Case Ageing Recalculation

### 21.1 Requirement

```text
Input: 3,600,000 active cases
Window: 01:00–04:00 = 3 hours = 10,800 seconds
Target: finish within 2.5 hours with 30 min buffer
Online impact: p95 search latency + max 15%
DB: shared Oracle/PostgreSQL-like RDBMS
Side effect: update case ageing bucket and create escalation outbox if threshold crossed
Recovery: restart without duplicate escalation
```

Required throughput:

```text
3,600,000 / (2.5 × 3600)
= 3,600,000 / 9,000
= 400 item/sec
```

Add 30% margin:

```text
target ≈ 520 item/sec
```

### 21.2 Design

```text
Step 1: Build deterministic work item set with cutoff timestamp
Step 2: Partition work by hash(case_id) into 8 partitions
Step 3: Chunk process with commit interval 1000
Step 4: Reader keyset scans work item table
Step 5: Processor computes ageing bucket, no side effect
Step 6: Writer batch-updates changed cases only + inserts escalation outbox with idempotency key
Step 7: Outbox sender separate, rate-limited
Step 8: Dashboard monitors throughput, DB, retries, online impact
```

### 21.3 Candidate Config

```text
partition count = 8
commit interval = 1000
fetch size = 2000
jdbc batch size = 200
batch pool max = 16
transaction timeout = 60s
chunk p95 target < 5s
```

### 21.4 Idempotency Key

```text
job_type + cutoff_date + case_id + escalation_type
```

Unique constraint:

```sql
unique (idempotency_key)
```

### 21.5 Performance Test Result Example

```text
partition=1  -> 95 item/sec, DB CPU 18%
partition=4  -> 360 item/sec, DB CPU 48%, online impact +3%
partition=8  -> 670 item/sec, DB CPU 68%, online impact +9%
partition=12 -> 720 item/sec, DB CPU 84%, online impact +22%, lock wait medium
```

Decision:

```text
Use partition=8 because it meets target with acceptable online impact.
```

### 21.6 Failure Test

Kill node at 55%:

Expected:

- incomplete chunk rolled back
- checkpoint resumes last committed chunk
- repeated items update safely due to guarded update
- duplicate escalation prevented by idempotency key
- outbox sender resumes independently

Success criteria:

```text
duplicate escalation = 0
case ageing final count correct
job restart completes
error evidence available
```

---

## 22. Advanced Topic: Adaptive Commit Interval?

Jakarta Batch standard configuration is mostly declarative/static. Some implementations support custom checkpoint algorithms. However, dynamic tuning must be handled carefully.

Adaptive commit idea:

```text
if chunk_duration > target:
    reduce chunk size
if chunk_duration < target and DB headroom exists:
    increase chunk size
```

Risks:

- harder restart reasoning
- inconsistent chunk replay size
- hard benchmark comparison
- implementation-specific behavior
- operator confusion

For most enterprise systems, prefer:

```text
static conservative config + adaptive throttling at job/control-plane level
```

Rather than changing checkpoint behavior dynamically unless you have strong reason and test coverage.

---

## 23. Jakarta Batch vs Kubernetes Job Performance

Sometimes performance issue is not in Jakarta Batch but in execution placement.

Jakarta Batch inside app server is good when:

- job needs Jakarta EE services
- job shares transaction/security/CDI/runtime
- job controlled by app admin UI
- job needs restartability through batch repository
- job part of enterprise application lifecycle

Kubernetes Job/CronJob may be better when:

- workload is isolated CLI-style
- heavy CPU/memory batch should not share app server
- different scaling/resource limits needed
- deployment cadence independent
- containerized data processing tool

Hybrid:

```text
Jakarta app creates governed job request → Kubernetes Job executes worker → app tracks state/audit
```

But this adds distributed orchestration complexity.

---

## 24. Java 8–25 Practical Guidance

### 24.1 Java 8

- Jakarta namespace may not be available depending platform generation.
- Batch often via Java EE 7/8 / JSR 352 implementations.
- No virtual threads.
- Be conservative with thread/concurrency.
- Use JDBC streaming and chunk tuning carefully.

### 24.2 Java 11/17

- Better baseline for modern enterprise.
- G1 default and mature.
- JFR generally available.
- Jakarta EE 9/10 migration common.

### 24.3 Java 21

- Virtual threads final.
- Jakarta Concurrency 3.1 includes support for requesting virtual threads in managed resource definitions in Jakarta EE 11 context.
- Use virtual threads for blocking I/O only with strict downstream capacity limits.

### 24.4 Java 25

- Modern runtime improvements continue.
- Structured concurrency remains preview as of Java 25 JEP 505.
- Treat preview features carefully in regulated/enterprise workloads.
- Batch performance still dominated by data model, DB, I/O, and side effect design more than language feature alone.

---

## 25. Production Readiness Checklist

### Performance Target

- [ ] Total item count known.
- [ ] Required throughput calculated.
- [ ] Safety margin defined.
- [ ] Batch window defined.
- [ ] Online impact budget defined.

### Bottleneck

- [ ] CPU/DB/API/file/lock/pool/GC bottleneck classified.
- [ ] Metrics confirm bottleneck.
- [ ] Tuning is based on measurement.

### Chunk

- [ ] Commit interval benchmarked.
- [ ] Chunk p95/p99 acceptable.
- [ ] Transaction timeout margin sufficient.
- [ ] Rollback/replay size acceptable.

### Reader

- [ ] Reader uses keyset/cursor/claiming strategy appropriate to DB.
- [ ] No large OFFSET pagination for huge data.
- [ ] Checkpoint state is compact and sufficient.
- [ ] Fetch size tuned.

### Processor

- [ ] Processor is deterministic.
- [ ] Side effects avoided.
- [ ] Reference data cached/preloaded safely.
- [ ] Allocation hotspots known.

### Writer

- [ ] JDBC batch size tuned.
- [ ] Writes are idempotent or guarded.
- [ ] Duplicate side effects prevented.
- [ ] Writer failure diagnosable.

### Partition

- [ ] Partition count benchmarked.
- [ ] Partition skew measured.
- [ ] Partition keys disjoint or conflict-safe.
- [ ] Pool/DB/API capacity respected.

### DB

- [ ] DB CPU/wait/lock/redo/undo measured.
- [ ] Query plans reviewed.
- [ ] Batch pool isolated or capped.
- [ ] Online workload protected.

### Failure

- [ ] Stop tested.
- [ ] Restart tested.
- [ ] Kill/redeploy tested.
- [ ] Duplicate side effects tested.
- [ ] Retry storm tested.

### Observability

- [ ] Dashboard exists.
- [ ] Chunk/partition metrics exist.
- [ ] DB pool metrics exist.
- [ ] Error classification visible.
- [ ] ETA and skew visible.

---

## 26. Ringkasan

Performance engineering untuk Jakarta Batch adalah disiplin sistem, bukan sekadar tuning angka.

Poin utama:

1. **Mulai dari SLO**, bukan dari commit interval atau partition count.
2. **Throughput harus dihitung dari volume dan window**.
3. **Bottleneck harus diklasifikasi**: CPU, DB, file, API, lock, pool, GC, coordination.
4. **Commit interval adalah trade-off** antara throughput, recovery granularity, lock duration, memory, dan rollback cost.
5. **Fetch size, JDBC batch size, dan commit interval adalah knob berbeda**.
6. **Partition count harus mengikuti downstream capacity**, bukan ambisi parallelism.
7. **Writer harus idempotent**, karena performance tanpa restart safety berbahaya.
8. **Batch harus coexist dengan online workload**.
9. **Benchmark harus realistis**, dengan dataset, failure, restart, dan online traffic simulation.
10. **Virtual threads bukan pengganti capacity control**.
11. **Observability adalah bagian dari performance**, bukan add-on.

Kalimat inti:

```text
Batch yang baik bukan hanya cepat selesai.
Batch yang baik selesai dalam window, memakai resource secara terkendali,
aman saat gagal, bisa restart, tidak merusak online SLA,
dan meninggalkan evidence yang dapat dipercaya.
```

---

## 27. Latihan / Thought Experiment

### Latihan 1 — Hitung Throughput

Input:

```text
12 juta item
window 4 jam
safety margin 25%
```

Pertanyaan:

1. Berapa required throughput?
2. Berapa target throughput dengan margin?
3. Jika 1 partition menghasilkan 350 item/sec, berapa partition teoritis dibutuhkan?
4. Apa metrik yang harus dicek sebelum menaikkan partition?

### Latihan 2 — Commit Interval

Kamu punya job:

```text
item size output rata-rata 30 KB
commit interval 5000
partition 10
```

Pertanyaan:

1. Berapa estimasi memory minimal hanya untuk output chunk?
2. Apa risiko GC?
3. Apa alternatif konfigurasi?

### Latihan 3 — External API Limit

API limit:

```text
1200 request/minute
avg latency 400 ms
1 item = 1 request
```

Pertanyaan:

1. Berapa request/sec?
2. Berapa concurrency teoritis cukup?
3. Apakah partition 100 masuk akal?
4. Bagaimana desain retry agar tidak melanggar quota?

### Latihan 4 — DB Contention

Partition count dinaikkan dari 4 ke 12.

Hasil:

```text
throughput naik 900 → 1050 item/sec
DB CPU naik 55% → 88%
lock wait naik 10x
online p95 naik 40%
```

Pertanyaan:

1. Apakah partition 12 layak?
2. Apa bottleneck yang muncul?
3. Tuning apa yang lebih masuk akal?

### Latihan 5 — Restart Safety

Writer melakukan insert notification tanpa unique idempotency key. Job mati setelah writer berhasil tetapi sebelum checkpoint commit terlihat selesai.

Pertanyaan:

1. Apa risiko saat restart?
2. Bagaimana desain idempotency key?
3. Apakah commit interval kecil menyelesaikan masalah ini sepenuhnya?

---

## 28. Referensi Resmi dan Relevan

- Jakarta Batch 2.1 Specification — chunk-oriented processing, commit interval, checkpoint, partition, job model.  
  <https://jakarta.ee/specifications/batch/2.1/jakarta-batch-spec-2.1>

- Jakarta Batch 2.1 API.  
  <https://jakarta.ee/specifications/batch/2.1/apidocs/>

- Jakarta Batch 2.1 `ItemReader` API — `open(Serializable checkpoint)` dan `checkpointInfo()`.  
  <https://jakarta.ee/specifications/batch/2.1/apidocs/jakarta.batch/jakarta/batch/api/chunk/itemreader>

- Jakarta Batch 2.1 overview.  
  <https://jakarta.ee/specifications/batch/2.1/>

- Jakarta EE 11 release page — platform context, Batch 2.1, Concurrency 3.1, Virtual Threads support in managed resources.  
  <https://jakarta.ee/release/11/>

- Jakarta Concurrency project overview — concurrency without compromising container integrity.  
  <https://jakarta.ee/specifications/concurrency/>

- OpenJDK JEP 444 — Virtual Threads.  
  <https://openjdk.org/jeps/444>

- OpenJDK JEP 505 — Structured Concurrency, preview in Java 25.  
  <https://openjdk.org/jeps/505>

---

## 29. Posisi dalam Seri

Kita sudah menyelesaikan bagian performance engineering untuk Jakarta Batch.

Bagian berikutnya:

```text
Part 32 — Security, Audit, and Compliance for Batch Workloads
File: 32-security-audit-compliance-batch-workloads.md
```

Seri belum selesai. Kita berada di Part 31 dari 35.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./30-clustered-jakarta-batch-distributed-execution.md">⬅️ Part 30 — Clustered Jakarta Batch and Distributed Execution Concerns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./32-security-audit-compliance-batch-workloads.md">Part 32 — Security, Audit, and Compliance for Batch Workloads ➡️</a>
</div>
