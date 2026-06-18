# Part 24 — Partitioning: Parallel Batch at Scale

> Series: `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
> File: `24-partitioning-parallel-batch-at-scale.md`  
> Scope: Java 8–25, Java EE/Jakarta EE Batch, Jakarta Batch 2.x, enterprise/container runtime  
> Status: Advanced material, non-repetitive continuation from Part 17–23

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami partitioning di Jakarta Batch bukan sebagai “multi-threading biasa”, tetapi sebagai **parallel execution topology** yang harus tetap menjaga correctness, restartability, auditability, dan capacity governance.
2. Membedakan parallelism yang aman dari parallelism yang hanya memindahkan bottleneck ke database, connection pool, external API, lock manager, atau storage.
3. Mendesain partitioning strategy berdasarkan karakter data:
   - range partitioning,
   - hash partitioning,
   - tenant/module partitioning,
   - time-window partitioning,
   - dynamic partitioning,
   - hybrid partitioning.
4. Memahami artifact partitioning Jakarta Batch:
   - `PartitionMapper`,
   - `PartitionPlan`,
   - `PartitionReducer`,
   - `PartitionCollector`,
   - `PartitionAnalyzer`.
5. Menentukan `partitions` dan `threads` secara rasional, bukan berdasarkan angka tebak-tebakan.
6. Mengenali failure modes partitioning:
   - duplicate processing,
   - skew,
   - hotspot,
   - lost aggregation,
   - partition restart ambiguity,
   - distributed overload,
   - non-idempotent writer corruption.
7. Mendesain partitioned batch yang production-grade untuk sistem regulasi, case management, data sync, reconciliation, recalculation, atau bulk correspondence.

---

## 2. Problem yang Diselesaikan oleh Partitioning

Pada batch biasa, step chunk-oriented berjalan seperti ini:

```text
read item -> process item -> write chunk -> checkpoint -> repeat
```

Model ini bagus karena sederhana, checkpointable, dan transaction-bounded. Namun ketika data sangat besar atau workload terlalu lambat, satu execution lane mungkin tidak cukup.

Contoh:

```text
10,000,000 case records
average processing = 20 ms/item
single lane total = 200,000 seconds ≈ 55.5 hours
```

Jika SLA batch hanya 4 jam, single-lane chunk processing tidak cukup. Partitioning mencoba memecah input menjadi beberapa segmen yang bisa diproses paralel:

```text
Partition 0 -> records 0000000 - 0999999
Partition 1 -> records 1000000 - 1999999
Partition 2 -> records 2000000 - 2999999
...
```

Secara ideal:

```text
single lane duration / number of effective parallel lanes
```

Namun realita production tidak linear.

Jika batch bottleneck-nya adalah CPU murni, parallelism mungkin membantu sampai batas core CPU. Jika bottleneck-nya database, parallelism bisa mempercepat sampai titik tertentu lalu mulai memperburuk lock, I/O, undo/redo, connection pool, buffer cache, dan query contention. Jika bottleneck-nya external API, partitioning tanpa rate limit bisa langsung menghasilkan 429, blacklist, atau SLA violation.

Jadi partitioning menyelesaikan problem:

```text
single-lane batch terlalu lambat
```

Tetapi memperkenalkan problem baru:

```text
parallel correctness + parallel capacity + parallel recovery
```

Top 1% engineer tidak bertanya:

> “Berapa thread supaya cepat?”

Tetapi bertanya:

> “Bagaimana workload ini dipartisi agar independent, bounded, restartable, idempotent, observable, dan tidak menghancurkan shared resources?”

---

## 3. Mental Model: Partitioning sebagai Banyak Step Execution Anak

Partitioned step bukan sekadar satu step yang diberi multi-thread.

Lebih tepatnya:

```text
Parent Step
  ├── Partition 0 -> child execution context + properties
  ├── Partition 1 -> child execution context + properties
  ├── Partition 2 -> child execution context + properties
  └── Partition N -> child execution context + properties
```

Setiap partition adalah execution lane yang diberi parameter/properties sendiri.

Contoh:

```text
partition 0:
  minCaseId = 1
  maxCaseId = 100000

partition 1:
  minCaseId = 100001
  maxCaseId = 200000

partition 2:
  minCaseId = 200001
  maxCaseId = 300000
```

Reader di setiap partition membaca subset data masing-masing:

```sql
SELECT *
FROM CASE_RECORD
WHERE CASE_ID BETWEEN :minCaseId AND :maxCaseId
ORDER BY CASE_ID
```

Dengan demikian, correctness bergantung pada properti berikut:

1. **Completeness**  
   Semua data yang harus diproses tercakup oleh partition.

2. **Disjointness**  
   Tidak ada item yang diproses oleh lebih dari satu partition, kecuali writer memang idempotent terhadap duplicate.

3. **Determinism**  
   Definisi partition stabil untuk job execution/restart tertentu.

4. **Boundedness**  
   Setiap partition punya batas kerja yang jelas.

5. **Restartability**  
   Jika partition gagal, batch bisa melanjutkan tanpa kehilangan atau menggandakan efek secara merusak.

6. **Capacity safety**  
   Parallelism tidak boleh melebihi kapasitas database/API/thread/connection/resource downstream.

---

## 4. Istilah Penting

### 4.1 Partition

Partition adalah segmen kerja dari step yang sama.

Contoh segmen:

```text
case_id 1..100000
case_id 100001..200000
case_id 200001..300000
```

atau:

```text
agency = CEA
agency = ROM
agency = CPDS
```

atau:

```text
created_month = 2025-01
created_month = 2025-02
created_month = 2025-03
```

### 4.2 Partition Count

Jumlah total partition.

```text
partitions = 16
```

Artinya ada 16 unit logical work.

### 4.3 Thread Count

Jumlah worker thread yang boleh menjalankan partition secara paralel.

```text
threads = 4
```

Artinya dari 16 partition, maksimal 4 berjalan bersamaan.

Ini distinction penting:

```text
partitions != threads
```

Bisa saja:

```text
partitions = 64
threads = 8
```

Artinya partition dibuat lebih granular daripada jumlah worker agar load balancing lebih baik.

### 4.4 Partition Properties

Properties adalah parameter unik untuk partition.

Contoh:

```text
partitionId=7
minId=700001
maxId=800000
agency=CEA
shardKey=7
```

Artifact seperti reader/processor/writer dapat membaca properties ini untuk menentukan subset kerja.

### 4.5 Parent Thread dan Child Partition Thread

Partitioning punya parent control flow dan child execution flow.

Artifact seperti reducer/analyzer dapat berjalan pada parent/control side, sedangkan reader/processor/writer berjalan pada masing-masing partition execution.

---

## 5. Jakarta Batch Partitioning Artifacts

Jakarta Batch menyediakan beberapa artifact untuk partitioned step.

Secara konseptual:

```text
PartitionMapper  -> membuat PartitionPlan secara dinamis
PartitionPlan    -> mendefinisikan jumlah partition, jumlah thread, dan properties tiap partition
PartitionReducer -> lifecycle/aggregation control pada awal/akhir/rollback partitioned step
PartitionCollector -> mengirim intermediate result dari partition
PartitionAnalyzer  -> menerima dan menganalisis hasil dari collector
```

Jakarta Batch tutorial menjelaskan bahwa `PartitionMapper` menyediakan jumlah partition, jumlah thread, dan properties untuk setiap partition ketika informasi partition hanya diketahui saat runtime. `PartitionReducer`, `PartitionCollector`, dan `PartitionAnalyzer` adalah artifact opsional untuk lifecycle dan agregasi hasil partitioned execution.

---

## 6. Bentuk JSL Partitioning

Ada dua pendekatan besar:

1. Static partition plan di JSL.
2. Dynamic partition plan via `PartitionMapper`.

### 6.1 Static Partition Plan

Contoh konseptual:

```xml
<job id="case-ageing-job" xmlns="https://jakarta.ee/xml/ns/jakartaee" version="2.1">
  <step id="recalculate-case-ageing">
    <chunk item-count="500">
      <reader ref="caseAgeingReader"/>
      <processor ref="caseAgeingProcessor"/>
      <writer ref="caseAgeingWriter"/>
    </chunk>

    <partition>
      <plan partitions="4" threads="4">
        <properties partition="0">
          <property name="minId" value="1"/>
          <property name="maxId" value="100000"/>
        </properties>
        <properties partition="1">
          <property name="minId" value="100001"/>
          <property name="maxId" value="200000"/>
        </properties>
        <properties partition="2">
          <property name="minId" value="200001"/>
          <property name="maxId" value="300000"/>
        </properties>
        <properties partition="3">
          <property name="minId" value="300001"/>
          <property name="maxId" value="400000"/>
        </properties>
      </plan>
    </partition>
  </step>
</job>
```

Static plan cocok jika pembagian kerja stabil dan kecil.

Kelemahannya:

- sulit jika range berubah terus,
- tidak adaptif terhadap jumlah data,
- tidak mudah menangani skew,
- XML menjadi panjang.

### 6.2 Dynamic Partition Plan via Mapper

Dynamic mapper cocok ketika range harus dihitung saat job mulai.

```xml
<job id="case-ageing-job" xmlns="https://jakarta.ee/xml/ns/jakartaee" version="2.1">
  <step id="recalculate-case-ageing">
    <chunk item-count="500">
      <reader ref="caseAgeingReader"/>
      <processor ref="caseAgeingProcessor"/>
      <writer ref="caseAgeingWriter"/>
    </chunk>

    <partition>
      <mapper ref="caseAgeingPartitionMapper"/>
      <collector ref="caseAgeingPartitionCollector"/>
      <analyzer ref="caseAgeingPartitionAnalyzer"/>
      <reducer ref="caseAgeingPartitionReducer"/>
    </partition>
  </step>
</job>
```

Dynamic mapper memungkinkan:

- menghitung min/max ID saat runtime,
- membagi berdasarkan tenant aktif,
- membaca manifest input,
- membuat range berdasarkan histogram,
- menyesuaikan thread count berdasarkan parameter job,
- menurunkan parallelism saat maintenance window sempit atau DB sedang berat.

---

## 7. PartitionMapper Deep Dive

`PartitionMapper` bertugas membuat `PartitionPlan`.

Secara mental:

```text
Input:
  job parameters
  database metadata
  manifest
  runtime capacity config

Output:
  partition count
  thread count
  partition properties[]
```

Contoh skeleton:

```java
import jakarta.batch.api.partition.PartitionMapper;
import jakarta.batch.api.partition.PartitionPlan;
import jakarta.batch.runtime.context.JobContext;
import jakarta.inject.Inject;
import jakarta.inject.Named;

@Named
public class CaseAgeingPartitionMapper implements PartitionMapper {

    @Inject
    JobContext jobContext;

    @Inject
    CaseRangeService rangeService;

    @Override
    public PartitionPlan mapPartitions() throws Exception {
        long minId = rangeService.findMinCaseId();
        long maxId = rangeService.findMaxCaseId();

        int partitions = 32;
        int threads = 8;

        return new CaseRangePartitionPlan(minId, maxId, partitions, threads);
    }
}
```

`PartitionPlan` dapat dibuat sebagai implementation sendiri.

```java
import jakarta.batch.api.partition.PartitionPlan;
import java.util.Properties;

public class CaseRangePartitionPlan implements PartitionPlan {

    private final Properties[] partitionProperties;
    private final int threads;

    public CaseRangePartitionPlan(long minId, long maxId, int partitions, int threads) {
        this.threads = threads;
        this.partitionProperties = buildRanges(minId, maxId, partitions);
    }

    @Override
    public int getPartitions() {
        return partitionProperties.length;
    }

    @Override
    public int getThreads() {
        return threads;
    }

    @Override
    public Properties[] getPartitionProperties() {
        return partitionProperties;
    }

    private Properties[] buildRanges(long minId, long maxId, int partitions) {
        Properties[] result = new Properties[partitions];
        long total = maxId - minId + 1;
        long size = (long) Math.ceil(total / (double) partitions);

        for (int i = 0; i < partitions; i++) {
            long start = minId + i * size;
            long end = Math.min(maxId, start + size - 1);

            Properties p = new Properties();
            p.setProperty("partitionId", String.valueOf(i));
            p.setProperty("minId", String.valueOf(start));
            p.setProperty("maxId", String.valueOf(end));
            result[i] = p;
        }

        return result;
    }
}
```

Important nuance:

```text
PartitionMapper should create a deterministic plan for a job execution.
```

Jika job direstart, runtime dan implementation akan mengelola state sesuai job repository, tetapi desain partition properties tetap harus tidak bergantung pada kondisi volatile yang bisa berubah ambigu.

Contoh buruk:

```text
Partition 0 = first 100k unprocessed rows currently visible
Partition 1 = next 100k unprocessed rows currently visible
```

Jika ada insert/update concurrent, definisi “first/next” bisa berubah.

Lebih baik:

```text
Partition 0 = ID range 1..100000 captured at job start
Partition 1 = ID range 100001..200000 captured at job start
```

atau:

```text
Partition based on immutable manifest table generated before processing.
```

---

## 8. Membaca Partition Properties di Reader

Reader perlu mengetahui subset data untuk partition-nya.

Di Jakarta Batch, artifact bisa mengakses context/properties melalui batch runtime context. Implementasi detail bisa berbeda, tetapi pola umumnya seperti ini:

```java
import jakarta.batch.api.chunk.AbstractItemReader;
import jakarta.batch.runtime.context.StepContext;
import jakarta.inject.Inject;
import jakarta.inject.Named;
import java.io.Serializable;

@Named
public class CaseAgeingReader extends AbstractItemReader {

    @Inject
    StepContext stepContext;

    private long currentId;
    private long maxId;

    @Override
    public void open(Serializable checkpoint) throws Exception {
        String minIdValue = stepContext.getProperties().getProperty("minId");
        String maxIdValue = stepContext.getProperties().getProperty("maxId");

        long minId = Long.parseLong(minIdValue);
        this.maxId = Long.parseLong(maxIdValue);

        if (checkpoint != null) {
            this.currentId = (Long) checkpoint;
        } else {
            this.currentId = minId;
        }
    }

    @Override
    public Object readItem() throws Exception {
        if (currentId > maxId) {
            return null;
        }

        CaseRecord record = findCaseByIdOrNextAvailable(currentId, maxId);

        if (record == null) {
            currentId = maxId + 1;
            return null;
        }

        currentId = record.getCaseId() + 1;
        return record;
    }

    @Override
    public Serializable checkpointInfo() throws Exception {
        return currentId;
    }
}
```

Catatan desain:

- checkpoint harus partition-local,
- state reader tidak boleh static/shared antar partition,
- reader harus deterministic terhadap range partition,
- reader perlu tahan terhadap sparse ID,
- query harus selalu punya ordering stabil.

---

## 9. PartitionPlan: `partitions` vs `threads`

Ini salah satu sumber miskonsepsi paling umum.

```text
partitions = jumlah work unit logical
threads    = jumlah work unit yang boleh aktif bersamaan
```

Contoh:

```text
partitions = 64
threads = 8
```

Runtime dapat menjalankan 8 partition sekaligus. Ketika satu selesai, partition berikutnya bisa diproses.

Kenapa partitions sering lebih besar dari threads?

Karena data tidak selalu seimbang.

Misal:

```text
Partition 0 = 1,000,000 rows
Partition 1 = 10,000 rows
Partition 2 = 8,000 rows
Partition 3 = 12,000 rows
```

Jika hanya 4 partition dan 4 thread, 3 thread selesai cepat lalu idle, sementara partition 0 masih lama.

Dengan partitions lebih granular:

```text
64 partitions, 8 threads
```

Skew lebih mudah terserap karena worker bisa mengambil partition lain setelah selesai.

Namun terlalu banyak partitions juga tidak gratis:

- metadata job repository lebih banyak,
- overhead startup lebih tinggi,
- logging lebih ramai,
- checkpoint lebih banyak,
- connection churn bisa meningkat,
- agregasi lebih kompleks.

Rule of thumb awal:

```text
partitions = threads * 4 sampai threads * 16
```

Tetapi ini hanya starting point. Harus divalidasi dengan benchmark dan observability.

---

## 10. Strategi Partitioning

### 10.1 Range Partitioning

Membagi berdasarkan range numerik atau temporal.

Contoh:

```text
case_id 1..100000
case_id 100001..200000
case_id 200001..300000
```

Atau:

```text
created_date 2025-01-01..2025-01-31
created_date 2025-02-01..2025-02-28
```

Kelebihan:

- mudah dipahami,
- query sederhana,
- restart mudah,
- audit mudah.

Kekurangan:

- data bisa skew,
- ID range tidak selalu sama dengan row count,
- tanggal tertentu bisa jauh lebih padat.

Cocok untuk:

- sequential primary key,
- append-only records,
- audit table,
- historical processing,
- case ageing by ID/date.

### 10.2 Hash Partitioning

Membagi berdasarkan hash/modulo.

```sql
WHERE MOD(CASE_ID, :partitionCount) = :partitionId
```

Kelebihan:

- distribusi sering lebih merata,
- mudah membuat disjoint partitions,
- cocok untuk banyak row dengan ID tersebar.

Kekurangan:

- query bisa kurang index-friendly,
- sulit memanfaatkan range scan,
- restart tetap mudah tetapi audit range kurang intuitif,
- DB mungkin full scan jika expression tidak didukung index/function-based index.

Cocok untuk:

- workload dengan ID besar dan evenly distributed,
- recalculation tanpa urutan bisnis,
- item independent.

### 10.3 Tenant/Agency/Module Partitioning

Membagi berdasarkan domain boundary.

```text
agency = CEA
agency = ROM
agency = CPDS
```

atau:

```text
module = APPLICATION
module = CASE
module = COMPLIANCE
```

Kelebihan:

- natural untuk audit dan ownership,
- bisa menerapkan fairness per tenant/module,
- failure satu tenant tidak selalu menggagalkan tenant lain,
- cocok dengan regulatory systems.

Kekurangan:

- skew sangat mungkin,
- tenant besar bisa mendominasi,
- partition count terbatas oleh jumlah tenant/module,
- bisa butuh nested partitioning.

Cocok untuk:

- multi-agency platform,
- multi-tenant batch,
- reporting per unit organisasi,
- compliance recalculation per module.

### 10.4 Time-Window Partitioning

Membagi berdasarkan waktu.

```text
2024-Q1
2024-Q2
2024-Q3
2024-Q4
```

atau:

```text
per day/per week/per month
```

Kelebihan:

- natural untuk historical/archive/audit,
- cocok untuk retention jobs,
- mudah menjelaskan progress,
- bisa align dengan DB partitioning fisik.

Kekurangan:

- volume per waktu tidak selalu merata,
- hot period bisa dominan,
- data late-arriving harus diperhitungkan.

Cocok untuk:

- audit trail cleanup,
- archival,
- reconciliation by period,
- monthly statement generation.

### 10.5 Manifest-Based Partitioning

Sebelum batch berjalan, sistem membuat manifest work units.

```text
BATCH_WORK_ITEM
  job_request_id
  work_item_id
  partition_id
  business_key
  status
```

Partition membaca dari manifest:

```sql
SELECT *
FROM BATCH_WORK_ITEM
WHERE JOB_REQUEST_ID = :jobRequestId
  AND PARTITION_ID = :partitionId
ORDER BY WORK_ITEM_ID
```

Kelebihan:

- sangat deterministic,
- restart sangat jelas,
- duplicate detection mudah,
- audit kuat,
- bisa menggabungkan berbagai filter kompleks sebelum eksekusi.

Kekurangan:

- butuh tahap materialization,
- storage tambahan,
- lifecycle manifest harus dikelola.

Cocok untuk:

- regulatory batch defensible,
- external API sync,
- bulk correspondence,
- high-value processing,
- job yang harus bisa dibuktikan input set-nya.

### 10.6 Hybrid Partitioning

Contoh:

```text
tenant -> date range -> hash bucket
```

atau:

```text
agency -> module -> ID range
```

Kelebihan:

- lebih fleksibel,
- bisa mengatasi skew,
- bisa align dengan fairness dan capacity.

Kekurangan:

- complexity meningkat,
- observability harus lebih baik,
- job parameter dan audit lebih kompleks.

Cocok untuk sistem enterprise besar.

---

## 11. Skew: Musuh Utama Partitioning

Skew berarti pembagian kerja tidak seimbang.

Contoh:

```text
Partition 0: 5,000,000 records
Partition 1: 50,000 records
Partition 2: 60,000 records
Partition 3: 45,000 records
```

Total duration ditentukan oleh partition paling lambat:

```text
job duration ≈ max(partition duration)
```

Bukan rata-rata.

### 11.1 Penyebab Skew

- ID range tidak sebanding dengan row count.
- Tenant tertentu jauh lebih besar.
- Date range tertentu punya volume peak.
- Beberapa item memerlukan external API call lebih berat.
- Beberapa item terkena lock/conflict lebih sering.
- Data quality issue terkonsentrasi pada segment tertentu.

### 11.2 Deteksi Skew

Metrics yang perlu direkam per partition:

```text
partition_id
input_count
processed_count
skipped_count
retried_count
duration
avg_item_time
max_item_time
db_time
api_time
commit_count
rollback_count
```

Jika satu partition jauh lebih lama, jangan langsung menambah thread. Cari penyebab skew.

### 11.3 Mengurangi Skew

Strategi:

1. Gunakan partitions lebih banyak daripada threads.
2. Gunakan histogram sebelum membuat range.
3. Gunakan manifest-based work item distribution.
4. Gunakan hash bucket untuk data besar.
5. Pecah tenant besar menjadi sub-partition.
6. Batasi tenant kecil agar tidak menciptakan overhead berlebihan.
7. Gunakan dynamic partition mapper berdasarkan row count aktual.

Contoh tenant-aware hybrid:

```text
CEA -> 16 partitions
ROM -> 4 partitions
CPDS -> 2 partitions
Others -> 1 partition each
```

---

## 12. Hotspot dan Shared Resource Contention

Partitioning membuat lebih banyak work berjalan bersamaan. Ini bisa menciptakan hotspot.

### 12.1 Database Hotspot

Gejala:

- DB CPU naik tinggi,
- buffer busy waits,
- row lock contention,
- connection pool exhausted,
- query latency naik,
- undo/redo meningkat,
- batch makin lambat meski thread ditambah.

Penyebab:

- semua partition update table/index yang sama,
- semua writer commit bersamaan,
- semua partition scan index yang sama,
- semua partition memperebutkan sequence/table counter,
- commit interval terlalu kecil atau terlalu besar,
- partition boundaries tidak align dengan index access path.

Mitigasi:

- kurangi `threads`, bukan hanya `partitions`,
- pastikan query partition memakai index,
- hindari update hot row/global counter,
- gunakan idempotent upsert dengan natural key,
- atur commit interval,
- gunakan staging table per partition jika perlu,
- merge hasil setelah parallel phase.

### 12.2 Connection Pool Hotspot

Jika setiap partition butuh koneksi DB:

```text
batch_threads <= allocated_batch_connection_budget
```

Jangan menghitung hanya total pool size.

Misal:

```text
Hikari pool total = 80
request traffic needs = 50
admin/report needs = 10
safe batch budget = 20
```

Maka:

```text
partition threads <= 20 / connections_per_partition
```

Jika satu partition memakai reader connection + writer connection + lookup connection, budget harus dikalikan.

### 12.3 External API Hotspot

Jika setiap partition memanggil external API:

```text
threads * item_rate_per_thread <= API rate limit
```

Contoh:

```text
API limit = 300 req/min
safe budget = 250 req/min
threads = 10
max per thread = 25 req/min
```

Tanpa global rate limiter, partitioning dapat membuat 10 worker masing-masing merasa aman tetapi totalnya melampaui limit.

---

## 13. Partitioning dan Transaction Boundary

Setiap partition menjalankan chunk transaction sendiri.

Contoh:

```text
Partition 0:
  chunk 1 -> tx A
  chunk 2 -> tx B

Partition 1:
  chunk 1 -> tx C
  chunk 2 -> tx D
```

Konsekuensi:

1. Tidak ada global transaction besar untuk seluruh partition.
2. Partial commit antar partition adalah normal.
3. Restart harus menerima fakta bahwa beberapa partition/chunk sudah commit.
4. Writer harus idempotent.
5. Aggregation harus tahan terhadap partial result.

Anti-pattern:

```text
Mengharapkan semua partition commit atau rollback sebagai satu transaksi atomik.
```

Batch skala besar tidak boleh didesain seperti single ACID transaction raksasa. Desain yang benar adalah:

```text
bounded local transaction + checkpoint + idempotency + reconciliation
```

---

## 14. Partitioning dan Restartability

Partitioned step harus bisa menjawab:

1. Partition mana yang berhasil?
2. Partition mana yang gagal?
3. Checkpoint terakhir partition gagal di mana?
4. Side effect apa yang sudah terjadi?
5. Apakah aman menjalankan ulang partition tertentu?

### 14.1 Restart Scenario

Misal:

```text
Partition 0: completed
Partition 1: completed
Partition 2: failed after chunk 17
Partition 3: running when JVM crashed
```

Saat restart:

```text
Partition 0 should not corrupt data if considered completed
Partition 1 should not corrupt data if considered completed
Partition 2 should resume from checkpoint or safely replay
Partition 3 should resume/replay based on checkpoint
```

### 14.2 Idempotent Writer untuk Partitioned Batch

Contoh writer aman:

```sql
MERGE INTO CASE_AGEING_RESULT r
USING (
  SELECT :case_id AS case_id,
         :job_execution_id AS job_execution_id,
         :ageing_bucket AS ageing_bucket
  FROM dual
) s
ON (r.case_id = s.case_id)
WHEN MATCHED THEN UPDATE SET
  r.ageing_bucket = s.ageing_bucket,
  r.updated_by_job_execution_id = s.job_execution_id,
  r.updated_at = CURRENT_TIMESTAMP
WHEN NOT MATCHED THEN INSERT (
  case_id,
  ageing_bucket,
  created_by_job_execution_id,
  created_at
) VALUES (
  s.case_id,
  s.ageing_bucket,
  s.job_execution_id,
  CURRENT_TIMESTAMP
)
```

Atau gunakan unique key:

```text
(job_request_id, business_key)
```

untuk mencegah duplicate output.

### 14.3 Checkpoint Harus Partition-Local

Jangan simpan checkpoint global seperti:

```text
lastProcessedId = 500000
```

Jika ada 8 partition, itu ambigu.

Lebih baik:

```text
partition 0 -> lastProcessedId = 100000
partition 1 -> lastProcessedId = 200000
partition 2 -> lastProcessedId = 250500
...
```

---

## 15. PartitionCollector dan PartitionAnalyzer

Collector dan analyzer berguna untuk mengirim hasil intermediate dari partition ke control point.

Mental model:

```text
Partition 0 -> collector -> analyzer
Partition 1 -> collector -> analyzer
Partition 2 -> collector -> analyzer
```

Contoh data yang bisa dikirim:

```text
processedCount
skippedCount
errorCount
totalAmount
maxTimestamp
warningSummary
```

### 15.1 Collector

Collector berjalan di partition side dan mengembalikan object serializable.

```java
import jakarta.batch.api.partition.PartitionCollector;
import jakarta.inject.Named;
import java.io.Serializable;

@Named
public class CaseAgeingPartitionCollector implements PartitionCollector {

    private long processed;
    private long skipped;
    private long failed;

    public void incrementProcessed() {
        processed++;
    }

    public void incrementSkipped() {
        skipped++;
    }

    public void incrementFailed() {
        failed++;
    }

    @Override
    public Serializable collectPartitionData() throws Exception {
        return new PartitionSummary(processed, skipped, failed);
    }
}
```

### 15.2 Analyzer

Analyzer menerima data dari collector dan dapat menganalisis hasil.

```java
import jakarta.batch.api.partition.PartitionAnalyzer;
import jakarta.batch.runtime.BatchStatus;
import jakarta.inject.Named;
import java.io.Serializable;
import java.util.concurrent.atomic.AtomicLong;

@Named
public class CaseAgeingPartitionAnalyzer implements PartitionAnalyzer {

    private final AtomicLong totalProcessed = new AtomicLong();
    private final AtomicLong totalSkipped = new AtomicLong();
    private final AtomicLong totalFailed = new AtomicLong();

    @Override
    public void analyzeCollectorData(Serializable data) throws Exception {
        PartitionSummary summary = (PartitionSummary) data;
        totalProcessed.addAndGet(summary.processed());
        totalSkipped.addAndGet(summary.skipped());
        totalFailed.addAndGet(summary.failed());
    }

    @Override
    public void analyzeStatus(BatchStatus batchStatus, String exitStatus) throws Exception {
        // observe partition completion/failure status
    }
}
```

### 15.3 Hal yang Harus Diwaspadai

- Analyzer bisa menerima hasil dari banyak partition; pastikan thread-safety jika implementation memanggil paralel.
- Data collector harus kecil dan serializable.
- Jangan kirim list jutaan item melalui collector.
- Untuk detail besar, tulis ke table audit/summary per partition, lalu analyzer hanya membaca summary.

---

## 16. PartitionReducer

Reducer menerima lifecycle callback untuk partitioned step.

Gunanya:

- inisialisasi aggregation,
- final merge,
- cleanup,
- rollback action,
- write final summary.

Mental model:

```text
begin partitioned step
  run partitions
  collect/analyze results
end partitioned step
```

Contoh penggunaan:

1. Membuat record `BATCH_STEP_SUMMARY` saat step mulai.
2. Mengunci job request agar tidak ada duplicate execution.
3. Menggabungkan staging output per partition ke final table.
4. Menandai manifest sebagai completed.
5. Menulis summary audit.

Anti-pattern:

- reducer melakukan processing utama,
- reducer membaca ulang semua output jutaan row tanpa batching,
- reducer menjadi single bottleneck besar,
- reducer menutupi failure partition.

---

## 17. Static vs Dynamic Partitioning

### 17.1 Static Partitioning Cocok Jika

- data distribution stabil,
- range diketahui di awal desain,
- volume kecil-menengah,
- audit simplicity lebih penting daripada adaptivitas,
- tidak banyak tenant/dimensi.

### 17.2 Dynamic Partitioning Cocok Jika

- volume berubah setiap run,
- tenant/module aktif berubah,
- data skew signifikan,
- input berasal dari manifest/file,
- thread count perlu dikontrol dari parameter atau config,
- job harus adaptif terhadap maintenance window.

### 17.3 Jangan Terlalu Dinamis

Dynamic bukan berarti nondeterministic.

Buruk:

```text
Saat restart, mapper membuat partition berbeda karena data berubah.
```

Lebih baik:

1. Saat job start, buat `job_request_id`.
2. Materialize work unit ke table manifest.
3. Partition mapper membaca manifest yang sudah fixed.
4. Restart memakai manifest yang sama.

---

## 18. Capacity Planning untuk Partitioning

Pertanyaan sizing:

1. Berapa lama SLA batch?
2. Berapa item total?
3. Berapa rata-rata waktu per item?
4. Bottleneck-nya CPU, DB, network, API, file I/O, atau lock?
5. Berapa connection pool budget untuk batch?
6. Berapa rate limit downstream?
7. Berapa core CPU tersedia?
8. Apakah batch berjalan bersama traffic online?
9. Apakah batch boleh memperlambat request latency?
10. Apakah ada maintenance window?

### 18.1 Formula Kasar Throughput

```text
required_throughput = total_items / allowed_duration_seconds
```

Jika:

```text
items = 10,000,000
window = 4 hours = 14,400 seconds
```

Maka:

```text
required_throughput = 694 items/sec
```

Jika satu worker memproses:

```text
50 items/sec
```

Maka minimal worker ideal:

```text
694 / 50 = 13.88 -> 14 threads
```

Tetapi tambahkan safety factor:

```text
threads = 16 atau 20
```

Lalu validasi terhadap resource budget.

### 18.2 Connection Pool Bound

Jika:

```text
connections_per_partition = 1
safe_batch_connection_budget = 12
```

Maka:

```text
threads <= 12
```

Meski throughput formula butuh 16 thread, DB budget hanya aman 12. Pilihannya:

- optimasi per-worker throughput,
- tambah window,
- tambah DB capacity,
- pecah job di waktu berbeda,
- gunakan staging/precomputation,
- kurangi work per item.

### 18.3 API Rate Limit Bound

Jika:

```text
external API safe rate = 250 req/min = 4.16 req/sec
1 item = 1 API call
```

Maka seluruh batch tidak boleh lebih dari 4.16 item/sec untuk API-bound step.

Menambah partition tidak akan membuat aman. Perlu:

- global rate limiter,
- cache,
- dedup,
- batching API jika tersedia,
- defer/retry queue,
- separate API sync stage.

---

## 19. Fairness dalam Partitioning

Tanpa fairness, tenant/module besar bisa mendominasi semua worker.

Contoh:

```text
CEA: 9,000,000 records
ROM: 100,000 records
CPDS: 50,000 records
```

Jika partitioning hanya berdasarkan global ID, semua thread mungkin mengerjakan CEA dulu. ROM/CPDS selesai sangat telat meski kecil.

Fairness strategy:

1. Partition per tenant terlebih dahulu.
2. Beri quota thread per tenant.
3. Pecah tenant besar menjadi sub-partitions.
4. Jalankan tenant kecil lebih awal.
5. Gunakan priority/fair scheduling jika runtime mendukung atau orchestrate lewat job terpisah.

Contoh:

```text
Thread budget = 12
CEA max = 8
ROM max = 2
CPDS max = 2
```

Jakarta Batch partitioning standar tidak selalu memberi advanced scheduler fairness. Jika fairness sangat penting, bisa gunakan desain:

```text
separate job per tenant + external control plane
```

atau:

```text
manifest table + work claiming with fairness policy
```

---

## 20. Partitioning dan Ordering

Parallelism menghancurkan asumsi global ordering.

Jika single-lane batch memproses:

```text
1, 2, 3, 4, 5
```

Partitioned batch bisa menyelesaikan:

```text
Partition 3 selesai dulu
Partition 1 selesai kedua
Partition 0 selesai ketiga
```

Jangan gunakan partitioning jika correctness bergantung pada global order, kecuali:

1. ordering hanya dibutuhkan di dalam partition,
2. ada final merge/sort phase,
3. output bersifat commutative,
4. dependency graph dipisahkan menjadi phase-phase.

Contoh buruk:

```text
Process enforcement escalation strictly by chronological event order across all cases.
```

Jika event antar case independent, bisa partition per case. Jika event global order penting, parallelism harus sangat hati-hati.

---

## 21. Partitioning dengan Dependency Antar Item

Partitioning paling aman jika item independent.

```text
case A does not affect case B
```

Jika ada dependency:

```text
case A must be processed before case B
```

maka perlu strategi:

1. Partition berdasarkan dependency group.
2. Process dependency graph per group.
3. Gunakan multi-step job:
   - step 1: compute prerequisites,
   - step 2: partition independent work,
   - step 3: merge/reconcile.
4. Jangan menjalankan dependent items di partition berbeda secara bebas.

---

## 22. Partitioning dan Data Mutation Selama Job Berjalan

Pertanyaan penting:

> Apakah input set batch boleh berubah saat job berjalan?

Jika batch membaca live table dan user/application masih menulis data, masalah muncul:

- item baru masuk ke range yang sudah diproses,
- item berubah status saat sedang diproses,
- item pindah partition karena field partition key berubah,
- query pagination berubah,
- restart menjadi ambigu.

Solusi:

### 22.1 Snapshot by Predicate

Capture cutoff:

```text
job_start_time = 2026-06-17T22:00:00+07:00
```

Reader:

```sql
WHERE created_at <= :jobStartTime
```

### 22.2 Manifest Table

Materialize input set:

```sql
INSERT INTO BATCH_WORK_ITEM(job_request_id, business_key, partition_id, status)
SELECT :jobRequestId, case_id, MOD(case_id, :partitionCount), 'PENDING'
FROM CASE_RECORD
WHERE eligible = 'Y'
```

Batch membaca manifest, bukan live eligibility predicate.

### 22.3 Status Claiming

Jika memakai work claiming:

```sql
UPDATE BATCH_WORK_ITEM
SET status = 'PROCESSING', claimed_by = :partitionId
WHERE job_request_id = :jobRequestId
  AND partition_id = :partitionId
  AND status = 'PENDING'
```

Tetapi hati-hati: ini mulai mirip queue/worker pattern, bukan pure Jakarta Batch partition range.

---

## 23. Partitioning Design untuk Regulatory Case Management

Misal job:

```text
Nightly enforcement escalation recalculation
```

Input:

- active cases,
- current stage,
- last activity date,
- SLA rules,
- enforcement flags,
- pending appeal,
- correspondence status.

Correctness requirement:

- setiap case dihitung tepat sekali secara efektif,
- audit tahu job mana yang menghitung,
- restart tidak menggandakan escalation,
- escalation side effect harus idempotent,
- user online tidak boleh terganggu,
- case urgent tidak boleh tertunda karena tenant besar.

### 23.1 Recommended Architecture

```text
Step 1: Prepare manifest
  - select eligible cases using cutoff timestamp
  - assign partition_id
  - insert BATCH_WORK_ITEM

Step 2: Partitioned chunk processing
  - each partition reads its work items
  - processor evaluates escalation rules
  - writer upserts result and emits outbox event if needed

Step 3: Aggregate summary
  - total processed
  - total escalated
  - total skipped
  - total errors

Step 4: Notification/report
  - notify ops/business
```

### 23.2 Why Manifest is Better Here

Because regulatory workloads need defensibility:

```text
What exactly was processed?
Why was this case escalated?
Was it included in the job input set?
Did restart process it twice?
What rule version was used?
Who/what initiated the job?
```

A manifest gives evidence.

---

## 24. Example: Manifest-Based Partition Mapper

### 24.1 Manifest Table

```sql
CREATE TABLE BATCH_WORK_ITEM (
  JOB_REQUEST_ID        VARCHAR2(64) NOT NULL,
  WORK_ITEM_ID          NUMBER GENERATED BY DEFAULT AS IDENTITY,
  BUSINESS_KEY          VARCHAR2(100) NOT NULL,
  PARTITION_ID          NUMBER NOT NULL,
  STATUS                VARCHAR2(30) NOT NULL,
  ATTEMPT_COUNT         NUMBER DEFAULT 0 NOT NULL,
  LAST_ERROR_CODE       VARCHAR2(100),
  LAST_ERROR_MESSAGE    VARCHAR2(1000),
  CREATED_AT            TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  UPDATED_AT            TIMESTAMP,
  CONSTRAINT PK_BATCH_WORK_ITEM PRIMARY KEY (JOB_REQUEST_ID, WORK_ITEM_ID),
  CONSTRAINT UK_BATCH_WORK_ITEM_BUSINESS UNIQUE (JOB_REQUEST_ID, BUSINESS_KEY)
);

CREATE INDEX IDX_BWI_PARTITION_STATUS
ON BATCH_WORK_ITEM (JOB_REQUEST_ID, PARTITION_ID, STATUS, WORK_ITEM_ID);
```

### 24.2 Prepare Manifest

```sql
INSERT INTO BATCH_WORK_ITEM (
  JOB_REQUEST_ID,
  BUSINESS_KEY,
  PARTITION_ID,
  STATUS
)
SELECT
  :jobRequestId,
  c.CASE_ID,
  MOD(c.CASE_ID, :partitionCount),
  'PENDING'
FROM CASE_RECORD c
WHERE c.STATUS = 'ACTIVE'
  AND c.CREATED_AT <= :cutoffTime;
```

### 24.3 Mapper Reads Partition Count

```java
@Named
public class ManifestPartitionMapper implements PartitionMapper {

    @Inject
    JobContext jobContext;

    @Override
    public PartitionPlan mapPartitions() {
        String jobRequestId = String.valueOf(jobContext.getProperties().get("jobRequestId"));
        int partitions = Integer.parseInt(String.valueOf(jobContext.getProperties().get("partitionCount")));
        int threads = Integer.parseInt(String.valueOf(jobContext.getProperties().get("threadCount")));

        Properties[] props = new Properties[partitions];

        for (int i = 0; i < partitions; i++) {
            Properties p = new Properties();
            p.setProperty("jobRequestId", jobRequestId);
            p.setProperty("partitionId", String.valueOf(i));
            props[i] = p;
        }

        return new SimplePartitionPlan(props, threads);
    }
}
```

```java
public class SimplePartitionPlan implements PartitionPlan {

    private final Properties[] properties;
    private final int threads;

    public SimplePartitionPlan(Properties[] properties, int threads) {
        this.properties = properties;
        this.threads = threads;
    }

    @Override
    public int getPartitions() {
        return properties.length;
    }

    @Override
    public int getThreads() {
        return threads;
    }

    @Override
    public Properties[] getPartitionProperties() {
        return properties;
    }
}
```

---

## 25. Example: Partition Reader with Manifest

```java
@Named
public class ManifestCaseReader extends AbstractItemReader {

    @Inject
    StepContext stepContext;

    @Inject
    WorkItemRepository workItemRepository;

    private String jobRequestId;
    private int partitionId;
    private long lastWorkItemId;

    @Override
    public void open(Serializable checkpoint) throws Exception {
        this.jobRequestId = stepContext.getProperties().getProperty("jobRequestId");
        this.partitionId = Integer.parseInt(stepContext.getProperties().getProperty("partitionId"));

        if (checkpoint != null) {
            this.lastWorkItemId = (Long) checkpoint;
        } else {
            this.lastWorkItemId = 0L;
        }
    }

    @Override
    public Object readItem() throws Exception {
        WorkItem item = workItemRepository.findNextPending(
            jobRequestId,
            partitionId,
            lastWorkItemId
        );

        if (item == null) {
            return null;
        }

        lastWorkItemId = item.workItemId();
        return item;
    }

    @Override
    public Serializable checkpointInfo() throws Exception {
        return lastWorkItemId;
    }
}
```

Repository query:

```sql
SELECT *
FROM BATCH_WORK_ITEM
WHERE JOB_REQUEST_ID = :jobRequestId
  AND PARTITION_ID = :partitionId
  AND WORK_ITEM_ID > :lastWorkItemId
ORDER BY WORK_ITEM_ID
FETCH FIRST 1 ROW ONLY
```

Note:

- Jangan hanya filter `STATUS = 'PENDING'` jika status berubah dan checkpoint memakai `lastWorkItemId`; desain ini harus dipikirkan hati-hati.
- Jika writer mengubah status item, reader masih harus bisa melanjutkan berdasarkan monotonic ID.
- Jika skip/retry butuh reprocess item tertentu, gunakan error handling strategy jelas.

---

## 26. Partitioning dan Writer Design

Writer partitioned batch harus menghindari shared mutable bottleneck.

### 26.1 Buruk: Global Counter Row

```sql
UPDATE JOB_SUMMARY
SET PROCESSED_COUNT = PROCESSED_COUNT + :chunkSize
WHERE JOB_REQUEST_ID = :jobRequestId
```

Jika semua partition update row yang sama setiap chunk, row menjadi hotspot.

### 26.2 Lebih Baik: Partition Summary Row

```sql
MERGE INTO JOB_PARTITION_SUMMARY s
USING dual
ON (
  s.JOB_REQUEST_ID = :jobRequestId
  AND s.PARTITION_ID = :partitionId
)
WHEN MATCHED THEN UPDATE SET
  s.PROCESSED_COUNT = s.PROCESSED_COUNT + :processedCount,
  s.UPDATED_AT = CURRENT_TIMESTAMP
WHEN NOT MATCHED THEN INSERT (
  JOB_REQUEST_ID,
  PARTITION_ID,
  PROCESSED_COUNT,
  UPDATED_AT
) VALUES (
  :jobRequestId,
  :partitionId,
  :processedCount,
  CURRENT_TIMESTAMP
)
```

Final reducer/analyzer dapat merge:

```sql
SELECT SUM(PROCESSED_COUNT)
FROM JOB_PARTITION_SUMMARY
WHERE JOB_REQUEST_ID = :jobRequestId
```

### 26.3 Staging Per Partition

Untuk output besar:

```text
BATCH_OUTPUT_STAGE(job_request_id, partition_id, business_key, result, status)
```

Lalu final step merge ke target table.

Keuntungan:

- failure isolation,
- auditability,
- retry safety,
- no global lock per item,
- easier reconciliation.

---

## 27. Partitioning dan Error Handling

Error handling harus partition-aware.

### 27.1 Skip Limit Global vs Partition Local

Jika skip limit diterapkan per step, kamu perlu memahami apakah implementation menghitung global atau partition-specific sesuai runtime behavior. Untuk defensible design, jangan hanya bergantung pada limit abstrak. Rekam error per partition dan total.

### 27.2 Poison Data dalam Satu Partition

Jika satu partition punya banyak poison records:

```text
Partition 7 fails repeatedly
others completed
```

Jangan restart semua tanpa analisis.

Playbook:

1. Inspect `partitionId=7`.
2. Query error table by jobRequestId + partitionId.
3. Classify error:
   - data invalid,
   - rule bug,
   - DB constraint,
   - external dependency,
   - timeout.
4. Fix data/code/config.
5. Restart job.
6. Verify only affected work is replayed safely.

### 27.3 Error Table

```sql
CREATE TABLE BATCH_ITEM_ERROR (
  JOB_REQUEST_ID      VARCHAR2(64) NOT NULL,
  PARTITION_ID        NUMBER NOT NULL,
  WORK_ITEM_ID        NUMBER,
  BUSINESS_KEY        VARCHAR2(100),
  ERROR_CLASS         VARCHAR2(255),
  ERROR_CODE          VARCHAR2(100),
  ERROR_MESSAGE       VARCHAR2(2000),
  STACK_HASH          VARCHAR2(64),
  RETRYABLE_FLAG      CHAR(1),
  SKIPPABLE_FLAG      CHAR(1),
  CREATED_AT          TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

---

## 28. Partitioning dengan Virtual Threads

Java 21+ Virtual Threads membuat blocking I/O lebih murah. Namun dalam Jakarta Batch partitioning, virtual threads tidak menghapus constraints berikut:

- database connection tetap terbatas,
- transaction tetap punya cost,
- external API tetap punya rate limit,
- lock tetap bisa contention,
- writer tetap harus idempotent,
- checkpoint tetap harus benar,
- job repository tetap shared state,
- container lifecycle tetap harus dihormati.

Virtual threads bisa membantu jika runtime/container mendukung konfigurasi managed resources berbasis virtual thread atau jika batch runtime memanfaatkan virtual threads secara aman.

Tetapi jangan berpikir:

```text
virtual threads -> partitions boleh 10,000
```

Yang benar:

```text
virtual threads reduce thread cost, not downstream resource cost
```

Untuk batch CPU-bound, virtual threads hampir tidak membantu. Untuk I/O-bound dengan banyak waiting, mungkin membantu, tetapi tetap perlu global capacity control.

---

## 29. Observability untuk Partitioned Batch

Minimum metrics per job:

```text
job_execution_id
job_request_id
step_name
partition_count
thread_count
active_partitions
completed_partitions
failed_partitions
total_processed
total_skipped
total_retried
total_failed
oldest_running_partition_duration
```

Per partition:

```text
partition_id
status
start_time
end_time
duration
input_count
processed_count
write_count
skip_count
retry_count
rollback_count
checkpoint_count
last_checkpoint
avg_chunk_duration
p95_chunk_duration
last_error
```

Logs harus mengandung:

```text
jobExecutionId
stepExecutionId
jobRequestId
partitionId
chunkNumber
businessKey when relevant
correlationId
```

Contoh log:

```text
INFO batch.partition.chunk.completed \
  jobRequestId=AGE-20260617-001 \
  jobExecutionId=81231 \
  step=recalculate-case-ageing \
  partitionId=7 \
  chunk=42 \
  read=500 \
  written=500 \
  skipped=0 \
  durationMs=1830
```

---

## 30. Testing Partitioned Batch

### 30.1 Correctness Tests

- semua item tercakup,
- tidak ada overlap antar partition,
- output sama dengan single-thread baseline,
- ordering tidak diasumsikan global,
- writer idempotent saat item diproses ulang.

### 30.2 Restart Tests

Simulasikan crash:

```text
after partition start
after chunk read
after writer success before checkpoint
after checkpoint
after some partitions complete
during reducer
```

Verifikasi:

- no missing item,
- no destructive duplicate,
- completed partition tidak corrupt,
- failed partition bisa resume,
- summary akurat.

### 30.3 Skew Tests

Dataset:

```text
partition 0: huge
partition 1..N: small
```

Verifikasi:

- job tidak stuck tanpa observability,
- partitions > threads membantu,
- dashboard menunjukkan skew.

### 30.4 Capacity Tests

Uji dengan:

```text
threads = 1, 2, 4, 8, 16, 32
```

Plot:

- throughput,
- DB CPU,
- connection usage,
- lock wait,
- p95 chunk duration,
- error rate,
- request latency jika traffic online berjalan.

Cari knee point:

```text
thread count setelah ini tidak menambah throughput, hanya menambah contention
```

Itulah batas aman.

---

## 31. Anti-Patterns

### 31.1 Partitioning Tanpa Disjointness

```text
Partition 0 and 1 can read same rows
```

Akibat:

- duplicate side effect,
- inconsistent summary,
- race condition,
- constraint violation.

### 31.2 Partitioning Live Query Tanpa Snapshot

```sql
WHERE status = 'PENDING'
```

Saat status berubah selama job, input set menjadi tidak stabil.

### 31.3 Threads Sama dengan Partitions Besar

```text
partitions = 500
threads = 500
```

Tanpa capacity analysis, ini bisa menghancurkan DB/API.

### 31.4 Global Shared Mutable State

```java
static long processedCount;
```

Akibat:

- race condition,
- wrong count,
- classloader leak,
- restart ambiguity.

### 31.5 Non-Idempotent Writer

```text
insert correspondence every time item processed
```

Restart bisa mengirim surat/email ganda.

### 31.6 Partitioning untuk Dependency-Ordered Work

Jika item saling bergantung dan tidak dipisah dengan benar, parallelism merusak correctness.

### 31.7 Menganggap Partitioning Selalu Lebih Cepat

Kadang partitioning memperlambat karena:

- DB contention,
- lock wait,
- more checkpoint overhead,
- cache miss,
- API throttling,
- reducer bottleneck.

---

## 32. Best Practices

1. Mulai dari correctness, baru performance.
2. Pastikan partition coverage lengkap dan disjoint.
3. Gunakan manifest untuk workload high-value/regulatory.
4. Buat partitions lebih banyak dari threads untuk mengurangi skew.
5. Batasi threads berdasarkan bottleneck paling sempit.
6. Jangan biarkan partitioned batch mengambil seluruh DB pool.
7. Writer harus idempotent.
8. Checkpoint harus partition-local.
9. Gunakan summary per partition, bukan global hot row.
10. Instrument metrics per partition.
11. Uji restart dengan crash injection.
12. Uji throughput dengan beberapa thread count.
13. Jangan asumsikan global ordering.
14. Gunakan cutoff/snapshot untuk input yang berubah.
15. Pastikan job parameter dan partition properties diaudit.
16. Untuk external API, pakai global rate limiter.
17. Untuk tenant besar, pecah menjadi sub-partition.
18. Untuk tenant kecil, gabungkan agar overhead rendah.
19. Jangan simpan business logic utama di analyzer/reducer.
20. Dokumentasikan partition strategy sebagai bagian dari operational runbook.

---

## 33. Production Checklist

Sebelum menjalankan partitioned batch di production:

```text
[ ] Apakah input set deterministic?
[ ] Apakah partition coverage lengkap?
[ ] Apakah partition saling disjoint?
[ ] Apakah ada snapshot/cutoff/manifest?
[ ] Apakah writer idempotent?
[ ] Apakah checkpoint partition-local?
[ ] Apakah restart sudah diuji?
[ ] Apakah duplicate execution aman?
[ ] Apakah thread count sesuai DB pool budget?
[ ] Apakah external API rate limit dikontrol global?
[ ] Apakah skew sudah dianalisis?
[ ] Apakah summary per partition tersedia?
[ ] Apakah logs punya jobExecutionId + partitionId?
[ ] Apakah dashboard menunjukkan active/completed/failed partitions?
[ ] Apakah reducer tidak menjadi bottleneck?
[ ] Apakah error table menyimpan partitionId dan businessKey?
[ ] Apakah operator tahu cara stop/restart job?
[ ] Apakah batch aman terhadap pod/server restart?
[ ] Apakah batch tidak mengganggu online traffic?
[ ] Apakah audit dapat menjawab input, output, error, dan restart history?
```

---

## 34. Thought Experiment

Kamu punya job:

```text
Recalculate compliance risk score untuk 12 juta licence records.
Window: 5 jam.
DB shared dengan aplikasi online.
External API dipanggil hanya untuk 15% records.
API limit: 300 req/min.
DB pool total: 100 connections.
Online traffic butuh minimal 60 connections.
Report/audit butuh 10 connections.
```

Pertanyaan desain:

1. Berapa safe DB connection budget untuk batch?
2. Apakah partitioning murni berdasarkan `licence_id` cukup?
3. Bagaimana menangani 15% records yang butuh external API?
4. Apakah API call sebaiknya dilakukan dalam step yang sama?
5. Apakah perlu manifest?
6. Bagaimana mendesain idempotency key?
7. Metrics apa yang wajib ada?
8. Bagaimana membuktikan tidak ada licence yang terlewat?

Jawaban yang mature kemungkinan:

- DB budget batch maksimal sekitar 30 connections, mungkin lebih rendah untuk safety.
- Partition count bisa 128 atau 256, thread count awal 12–20 tergantung benchmark.
- API-bound work sebaiknya dipisah atau diberi global rate limiter.
- Manifest sangat disarankan untuk audit dan restart.
- Writer memakai upsert berdasarkan `(job_request_id, licence_id)` atau target natural key.
- Summary per partition wajib.
- Input count manifest dibandingkan processed/skipped/failed count.

---

## 35. Ringkasan

Partitioning adalah salah satu fitur paling kuat dalam Jakarta Batch, tetapi juga salah satu yang paling mudah disalahgunakan.

Mental model yang benar:

```text
partitioning = deterministic decomposition of work + bounded parallel execution + partition-local checkpoint + idempotent side effects + observable recovery
```

Bukan:

```text
partitioning = tambah thread agar cepat
```

Hal terpenting:

1. `partitions` adalah logical work units.
2. `threads` adalah parallel execution capacity.
3. Partition harus lengkap, disjoint, deterministic, dan bounded.
4. Skew menentukan durasi akhir.
5. Resource paling sempit menentukan thread count aman.
6. Restartability tanpa idempotency adalah ilusi.
7. Manifest-based partitioning sering paling defensible untuk sistem regulasi.
8. Collector/analyzer/reducer berguna untuk agregasi, tetapi jangan menjadi tempat business logic utama.
9. Observability per partition adalah syarat operasional, bukan nice-to-have.
10. Partitioning yang baik membuat batch lebih cepat; partitioning yang buruk membuat failure lebih paralel.

---

## 36. Koneksi ke Part Berikutnya

Part berikutnya membahas:

```text
Part 25 — Split, Flow, Decision, and Complex Job Graphs
```

Jika partitioning adalah cara memecah satu step menjadi beberapa lane paralel, maka `split`, `flow`, dan `decision` adalah cara membentuk job-level execution graph yang lebih kompleks:

- beberapa flow berjalan paralel,
- hasil satu step menentukan step berikutnya,
- failure bisa diarahkan ke compensation path,
- batch job mulai menyerupai workflow ringan.

Di sana kita akan membedakan dengan jelas:

```text
partition parallelism inside a step
vs
split parallelism across flows
vs
workflow orchestration across business states
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./23-batch-transactions-and-database-integration.md">⬅️ Part 23 — Batch Transactions and Database Integration</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./25-split-flow-decision-complex-job-graphs.md">Part 25 — Split, Flow, Decision, and Complex Job Graphs ➡️</a>
</div>
