# Part 24 — Spring Batch Architecture: Stateful Job Runtime, Restartability, and Operational Recovery

> Series: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `24-spring-batch-stateful-job-runtime.md`  
> Status seri: Part 24 dari 35 — **belum selesai**  
> Berikutnya: `25-spring-boot-actuator-micrometer-observability.md`

---

## 0. Tujuan Part Ini

Spring Batch sering disalahpahami sebagai sekadar framework untuk membaca file, memproses record, lalu menulis ke database. Itu terlalu dangkal.

Spring Batch sebenarnya adalah **stateful job runtime** untuk pekerjaan batch yang perlu:

1. dipantau,
2. diulang dengan aman,
3. dipulihkan setelah gagal,
4. dipartisi untuk throughput tinggi,
5. dikelola secara operasional,
6. memiliki metadata eksekusi yang dapat diaudit,
7. membedakan `job definition`, `job instance`, `job execution`, dan `step execution`,
8. mengontrol transaksi per chunk,
9. menangani skip/retry secara eksplisit,
10. dan menjaga agar side effect tidak berlipat saat restart.

Mental model paling penting:

```text
Spring Batch is not merely a loop.
Spring Batch is a restartable, state-tracked, transaction-aware execution engine.
```

Kalau sistem batch hanya dianggap `for each row -> process -> save`, maka desainnya mudah rusak saat:

- server mati di tengah proses,
- file sudah sebagian diproses,
- writer berhasil sebagian,
- external API timeout,
- job dijalankan dua kali,
- retry menyebabkan duplicate side effect,
- chunk rollback membuat item dibaca ulang,
- scheduler men-trigger job yang masih berjalan,
- atau operator ingin resume dari titik gagal.

Part ini tidak mengulang teori umum batch processing. Fokusnya adalah **cara Spring Batch memodelkan state, transaksi, restart, metadata, dan recovery**.

---

## 1. Kapan Spring Batch Layak Dipakai?

Spring Batch layak dipakai ketika pekerjaan memiliki karakteristik berikut:

| Sinyal | Makna |
|---|---|
| Ada banyak record | ribuan, jutaan, ratusan juta |
| Perlu restart | kalau gagal, tidak ingin mulai dari nol |
| Perlu metadata eksekusi | status, durasi, count, failure reason |
| Ada chunk transaction | commit per N item, bukan satu transaksi besar |
| Ada retry/skip | sebagian error boleh ditoleransi |
| Ada job parameter | periode, file name, tenant, agency, business date |
| Ada operational control | start, stop, restart, monitor |
| Ada audit/reconciliation | harus tahu item mana sukses/gagal |
| Ada scaling | partitioning, parallel step, remote chunking |

Spring Batch kurang tepat jika:

| Kasus | Alternatif Lebih Cocok |
|---|---|
| Real-time event processing | Kafka/Rabbit listener, stream processing |
| Workflow human approval | BPMN/Camunda/state machine |
| Short ad-hoc background task | `@Async`, scheduler sederhana, command table |
| ETL besar lintas data lake | dedicated ETL/data platform, Spark/Flink/Glue, dsb |
| Orchestration banyak dependency service | workflow orchestrator |

Namun batasnya tidak selalu tegas. Spring Batch kuat untuk **structured, restartable, repeatable, finite workload**.

---

## 2. Mental Model Besar Spring Batch

Spring Batch memecah pekerjaan menjadi beberapa konsep utama:

```text
Job
 └── Step 1
      ├── ItemReader
      ├── ItemProcessor
      └── ItemWriter
 └── Step 2
      └── Tasklet / Chunk

JobRepository
 ├── JobInstance
 ├── JobExecution
 ├── StepExecution
 └── ExecutionContext
```

Penjelasan singkat:

| Konsep | Arti |
|---|---|
| `Job` | definisi pekerjaan batch |
| `Step` | unit kerja dalam job |
| `JobInstance` | identitas logis job berdasarkan nama + identifying parameters |
| `JobExecution` | satu percobaan menjalankan job instance |
| `StepExecution` | satu percobaan menjalankan step |
| `ExecutionContext` | state persisted untuk restart |
| `JobRepository` | database metadata batch |
| `JobLauncher` | komponen untuk memulai job |
| `JobExplorer` | komponen untuk membaca metadata job |
| `JobOperator` | komponen operasional untuk start/stop/restart |

Perbedaan paling penting:

```text
Job = definition
JobInstance = logical run identity
JobExecution = actual attempt
StepExecution = actual attempt of a step
ExecutionContext = persisted restart state
```

Contoh:

```text
Job name       : dailyCustomerImport
Parameter      : businessDate=2026-06-21

JobInstance    : dailyCustomerImport + businessDate=2026-06-21
JobExecution 1 : failed at row 80,000
JobExecution 2 : restarted and completed
```

Job yang sama dengan parameter identifying sama bukan job baru. Itu instance yang sama. Kalau gagal, bisa direstart. Kalau sudah completed, biasanya tidak bisa dijalankan ulang dengan parameter yang sama kecuali desainnya memang mengizinkan.

---

## 3. Spring Batch sebagai Metadata-Backed Runtime

Komponen paling menentukan dalam Spring Batch adalah `JobRepository`.

`JobRepository` menyimpan metadata seperti:

- job instance,
- job execution,
- step execution,
- execution context,
- start time,
- end time,
- status,
- exit status,
- read count,
- write count,
- skip count,
- commit count,
- rollback count,
- failure exception.

Tanpa metadata, batch hanya loop biasa.

Dengan metadata, batch menjadi runtime yang bisa menjawab:

```text
Apakah job ini pernah dijalankan?
Apakah sukses?
Apakah gagal?
Step mana yang gagal?
Berapa item terbaca?
Berapa item tertulis?
Bisa restart dari mana?
Parameter apa yang dipakai?
Apakah execution context tersedia?
```

Ini sangat penting untuk sistem enterprise/regulatory karena batch sering menjadi bagian dari:

- data migration,
- reconciliation,
- report generation,
- notification campaign,
- archival,
- compliance data extraction,
- case state transition,
- SLA computation,
- eligibility recalculation,
- bulk approval/rejection,
- scheduled sync dengan external system.

---

## 4. Job, JobInstance, JobExecution: Jangan Dicampur

### 4.1 `Job`

`Job` adalah definisi.

Contoh konseptual:

```java
@Bean
Job importCustomersJob(JobRepository jobRepository, Step importCustomersStep) {
    return new JobBuilder("importCustomersJob", jobRepository)
            .start(importCustomersStep)
            .build();
}
```

`Job` belum berarti sedang berjalan. Ia hanya blueprint.

---

### 4.2 `JobInstance`

`JobInstance` adalah identitas logis dari job berdasarkan:

```text
job name + identifying job parameters
```

Contoh:

```text
importCustomersJob + file=customers-2026-06-21.csv
```

Jika parameter `file` adalah identifying parameter, maka file berbeda berarti `JobInstance` berbeda.

Jika parameter hanya `run.id` dan dibuat berbeda setiap run, maka setiap run menjadi instance baru. Ini kadang benar untuk ad-hoc job, tetapi salah untuk job yang seharusnya restartable berdasarkan business date/file.

**Kesalahan umum:** memakai `RunIdIncrementer` untuk semua job tanpa berpikir.

Akibat:

```text
Setiap eksekusi menjadi JobInstance baru.
Restart semantics menjadi kabur.
Job gagal tidak benar-benar di-restart, tetapi dibuat instance baru.
```

Untuk job operational enterprise, parameter harus dipikirkan:

| Parameter | Identifying? | Contoh |
|---|---:|---|
| `businessDate` | ya | `2026-06-21` |
| `fileName` | ya | `agency-a-cases.csv` |
| `tenantId` | ya | `CEA` |
| `requestedBy` | biasanya tidak | user operator |
| `traceId` | tidak | observability |
| `triggeredAt` | biasanya tidak | timestamp run |
| `dryRun` | tergantung semantics | ya jika output berbeda |

---

### 4.3 `JobExecution`

`JobExecution` adalah percobaan menjalankan sebuah `JobInstance`.

Satu `JobInstance` bisa punya beberapa `JobExecution` jika gagal lalu direstart.

```text
JobInstance: dailyImport + businessDate=2026-06-21

Execution 1: STARTED -> FAILED
Execution 2: STARTED -> COMPLETED
```

Status execution bukan hanya informasi log. Status itu mengontrol apakah job bisa direstart.

---

## 5. Step dan StepExecution

`Step` adalah unit kerja dalam job.

Ada beberapa jenis step utama:

1. chunk-oriented step,
2. tasklet step,
3. partitioned step,
4. flow step,
5. job step.

`StepExecution` menyimpan metadata eksekusi step:

- read count,
- write count,
- filter count,
- skip count,
- rollback count,
- commit count,
- start/end time,
- status,
- exit status,
- failure exceptions.

Step adalah tempat mayoritas engineering decision terjadi.

Contoh:

```java
@Bean
Step importCustomersStep(
        JobRepository jobRepository,
        PlatformTransactionManager transactionManager,
        ItemReader<CustomerRow> reader,
        ItemProcessor<CustomerRow, CustomerCommand> processor,
        ItemWriter<CustomerCommand> writer
) {
    return new StepBuilder("importCustomersStep", jobRepository)
            .<CustomerRow, CustomerCommand>chunk(500, transactionManager)
            .reader(reader)
            .processor(processor)
            .writer(writer)
            .build();
}
```

Makna penting:

```text
Chunk size 500 berarti Spring Batch akan read/process/write dalam unit transaksi 500 item.
```

Bukan berarti reader pasti membaca 500 item sekali call. Reader biasanya dipanggil item-by-item sampai chunk penuh atau data habis.

---

## 6. Chunk-Oriented Processing

Chunk-oriented processing adalah pola paling umum di Spring Batch.

Pipeline-nya:

```text
repeat until no more items:
    begin transaction
    read item 1
    process item 1
    read item 2
    process item 2
    ... until chunk size reached
    write chunk
    commit transaction
```

Secara konseptual:

```text
ItemReader      -> satu item setiap read()
ItemProcessor   -> transform/filter satu item
ItemWriter      -> tulis list/chunk item
Transaction     -> biasanya membungkus satu chunk
```

### 6.1 Reader

Reader bertanggung jawab mengambil item dari sumber:

- file,
- database,
- queue,
- API,
- object store,
- custom source.

Reader yang restartable harus menyimpan posisi baca ke `ExecutionContext`.

Contoh posisi:

```text
current.line=183000
last.id=987654
page.number=42
cursor.position=...
```

### 6.2 Processor

Processor mengubah item input menjadi item output.

Processor boleh:

- enrich,
- validate,
- map,
- normalize,
- filter.

Jika processor mengembalikan `null`, item dianggap filtered, bukan failed.

```java
class CustomerProcessor implements ItemProcessor<CustomerRow, CustomerCommand> {
    @Override
    public CustomerCommand process(CustomerRow item) {
        if (item.isInactive()) {
            return null; // filtered
        }
        return CustomerCommand.from(item);
    }
}
```

### 6.3 Writer

Writer menerima chunk item.

Writer harus didesain hati-hati karena sering menjadi tempat side effect:

- insert/update DB,
- kirim message,
- panggil external API,
- tulis file output,
- upload object.

Prinsip penting:

```text
Writer must be idempotent or protected by transaction/reconciliation mechanism.
```

Kalau writer melakukan external side effect non-transactional, restart bisa menyebabkan duplicate side effect.

---

## 7. Transaction Boundary dalam Chunk

Dalam chunk step, transaksi biasanya membungkus:

```text
read/process/write untuk satu chunk
```

Namun detailnya bergantung pada resource.

| Resource | Bisa ikut transaksi DB? | Catatan |
|---|---:|---|
| JDBC writer | ya | commit/rollback jelas |
| JPA writer | ya | persistence context per chunk |
| file reader | tidak secara DB | posisi baca disimpan di context |
| file writer | tidak penuh | perlu state dan rollback handling |
| HTTP call | tidak | butuh idempotency/outbox |
| message publish | tergantung broker/transaction | tetap perlu desain |

Failure model:

```text
Jika writer gagal, chunk rollback.
Item dalam chunk bisa dibaca ulang pada retry/restart.
```

Artinya processor dan writer tidak boleh mengasumsikan bahwa item hanya diproses sekali.

### 7.1 Chunk Size Trade-Off

Chunk size terlalu kecil:

- commit terlalu sering,
- metadata update sering,
- overhead transaksi tinggi,
- throughput rendah.

Chunk size terlalu besar:

- rollback mahal,
- memory besar,
- lock lebih lama,
- recovery granularity kasar,
- timeout lebih mungkin.

Heuristic:

| Workload | Chunk Size Awal |
|---|---:|
| DB simple insert/update | 500–5000 |
| Heavy validation | 100–1000 |
| External API | sangat kecil atau jangan langsung di chunk writer |
| Large object/file | kecil dan streaming-aware |
| Regulatory/audit-sensitive | lebih kecil untuk recovery granularity |

Tetapi angka final harus berdasarkan measurement.

---

## 8. ExecutionContext: State yang Membuat Restart Mungkin

`ExecutionContext` adalah map persisted yang bisa hidup di level:

- job,
- step.

Fungsinya menyimpan state yang diperlukan untuk restart.

Contoh:

```text
stepExecutionContext:
  current.line=183000
  last.processed.id=982341
  output.file.position=7742231

jobExecutionContext:
  input.file.checksum=abc123
  total.expected.records=500000
```

### 8.1 Jangan Menganggap ExecutionContext sebagai Tempat Data Besar

ExecutionContext bukan cache besar.

Simpan hanya state kecil:

- cursor,
- offset,
- last processed key,
- checksum,
- counters,
- checkpoint.

Jangan simpan:

- list ribuan ID,
- payload besar,
- object domain kompleks,
- data temporary besar,
- secret.

### 8.2 ExecutionContext dan Restart Contract

Agar restart benar:

```text
Reader harus resume dari posisi terakhir yang committed.
Writer harus aman jika chunk diproses ulang.
Processor harus deterministic atau punya compensation.
```

Kalau processor memanggil external API untuk enrichment, restart bisa menghasilkan hasil berbeda jika API berubah. Untuk data regulatory, sebaiknya enrichment result disimpan atau dibuat deterministic berdasarkan snapshot.

---

## 9. Restartability: Bukan Fitur Gratis

Spring Batch menyediakan mekanisme restart, tetapi job Anda harus didesain restartable.

Sebuah job restartable jika:

1. input stabil,
2. job parameters identik,
3. reader bisa resume,
4. writer idempotent/transactional,
5. processor deterministic,
6. side effect terlindungi,
7. metadata tidak corrupt,
8. state bisnis bisa menerima re-run sebagian.

### 9.1 Input Stability

Jika file input berubah antara run pertama dan restart, hasil bisa rusak.

Maka untuk file-based job:

- simpan checksum,
- simpan file size,
- simpan storage object version,
- jangan baca path mutable seperti `/incoming/latest.csv`,
- pindahkan file ke immutable processing location.

Contoh buruk:

```text
/input/customer.csv
```

Contoh lebih baik:

```text
/input/archive/customer-2026-06-21-v1.csv
checksum=sha256:...
```

### 9.2 Writer Idempotency

Writer idempotent artinya eksekusi ulang tidak menggandakan efek.

Contoh pola:

| Side Effect | Idempotency Strategy |
|---|---|
| DB insert | unique key + upsert/ignore duplicate |
| DB update | optimistic version or deterministic set |
| Message publish | outbox with unique event id |
| Email/SMS | notification table with unique business key |
| External API | idempotency key |
| File output | temp file + atomic rename |

### 9.3 Completed Step Default-nya Dilewati

Jika step sudah `COMPLETED`, pada restart step itu biasanya dilewati.

Ini bagus untuk step mahal yang sudah sukses.

Namun ada step yang harus selalu berjalan, misalnya cleanup atau validation ulang. Untuk itu ada opsi seperti `allowStartIfComplete`.

Gunakan dengan hati-hati.

---

## 10. Skip vs Retry: Dua Semantik Berbeda

Banyak engineer mencampur skip dan retry.

```text
Retry = coba lagi item/chunk yang sama karena error mungkin sementara.
Skip  = akui item gagal, catat, lanjutkan item berikutnya.
```

### 10.1 Retry

Cocok untuk error transient:

- deadlock,
- lock timeout,
- temporary network failure,
- HTTP 503,
- rate limit dengan backoff,
- broker temporary unavailable.

Tidak cocok untuk:

- format invalid,
- mandatory field kosong,
- business rule failed,
- duplicate business key permanen.

### 10.2 Skip

Cocok untuk item-level bad data:

- row CSV malformed,
- enum tidak dikenal,
- missing mandatory field,
- referensi tidak ditemukan dan memang boleh dilewati,
- data kualitas buruk yang perlu reject report.

Skip harus menghasilkan **reject evidence**.

Jangan skip diam-diam.

Minimal catat:

```text
jobExecutionId
stepExecutionId
item business key
input line / record id
error code
error message safe
raw value terbatas / masked
timestamp
```

### 10.3 Retry + Skip Interaction

Jika sebuah exception dikonfigurasi retry dan skip, Spring Batch akan mencoba retry sesuai policy dulu, lalu skip jika masih gagal dan skippable.

Ini bisa mengejutkan karena item terlihat “diproses berkali-kali”.

Design rule:

```text
Exception taxonomy harus jelas: transient -> retry, bad data -> skip, fatal -> fail.
```

---

## 11. Exception Taxonomy untuk Batch

Buat taxonomy eksplisit:

```java
sealed interface BatchItemFailure permits BadInputData, TransientDependencyFailure, FatalBatchFailure {}
```

Secara konseptual:

| Kategori | Aksi |
|---|---|
| Bad input item | skip + reject report |
| Transient dependency | retry + backoff |
| Fatal configuration | fail job |
| Data integrity impossible | fail job |
| External side effect uncertain | stop/fail and reconcile |
| Duplicate already processed | treat idempotently |

Contoh mapping:

```text
CsvParseException               -> skip
MissingMandatoryFieldException  -> skip
DeadlockLoserDataAccessException -> retry
CannotAcquireLockException      -> retry
HttpServerErrorException 503    -> retry
UnauthorizedException           -> fail
InvalidJobConfigurationException -> fail
```

---

## 12. Tasklet Step

Tasklet cocok untuk unit kerja yang bukan item-by-item chunk.

Contoh:

- cleanup temp directory,
- validate file exists,
- move file,
- call stored procedure,
- generate summary,
- create marker record,
- archive processed input.

Contoh:

```java
@Bean
Step validateInputFileStep(
        JobRepository jobRepository,
        PlatformTransactionManager transactionManager
) {
    return new StepBuilder("validateInputFileStep", jobRepository)
            .tasklet((contribution, chunkContext) -> {
                String file = (String) chunkContext
                        .getStepContext()
                        .getJobParameters()
                        .get("file");

                // validate existence, checksum, size, naming convention
                return RepeatStatus.FINISHED;
            }, transactionManager)
            .build();
}
```

Tasklet bukan excuse untuk menulis loop manual jutaan record tanpa metadata.

Jika tasklet melakukan long-running loop, Anda harus bertanya:

```text
Apakah ini seharusnya chunk step?
Bagaimana restart-nya?
Di mana checkpoint-nya?
Bagaimana skip/retry/count-nya?
```

---

## 13. Job Flow dan Conditional Transition

Job bisa punya flow bercabang berdasarkan `ExitStatus`.

Contoh konseptual:

```text
validateInput
  -> if COMPLETED: importData
  -> if NO_DATA: generateEmptyReport
  -> if FAILED: fail job

importData
  -> generateSummary
  -> archiveInput
```

Jangan campuradukkan:

| Konsep | Makna |
|---|---|
| `BatchStatus` | status teknis execution: STARTING, STARTED, COMPLETED, FAILED, STOPPED |
| `ExitStatus` | outcome step/job yang bisa dipakai untuk flow decision |

Contoh custom exit status:

```text
COMPLETED_WITH_SKIPS
NO_DATA
COMPLETED_WITH_WARNINGS
```

Gunakan custom exit status untuk operational clarity, bukan exception string.

---

## 14. Job Parameters: Identitas, Reproducibility, dan Audit

Job parameters harus didesain seperti API contract.

Contoh parameter:

```text
businessDate=2026-06-21
agency=CEA
inputFile=s3://bucket/import/customer-2026-06-21.csv
inputVersion=3HL4...
dryRun=false
requestedBy=fajar
```

Parameter yang baik:

- cukup untuk mereproduksi run,
- tidak berisi secret,
- membedakan instance secara benar,
- bisa diaudit,
- stabil untuk restart.

### 14.1 Identifying vs Non-Identifying Parameter

Identifying parameter menentukan `JobInstance`.

Contoh:

```text
businessDate=2026-06-21      identifying
inputFileVersion=abc123       identifying
requestedBy=fajar             non-identifying
traceId=xyz                   non-identifying
```

Kalau `requestedBy` identifying, operator berbeda bisa tanpa sengaja membuat instance berbeda untuk workload sama.

Kalau `inputFileVersion` non-identifying, file berbeda bisa dianggap instance sama. Itu berbahaya.

---

## 15. JobLauncher, JobExplorer, JobOperator

### 15.1 JobLauncher

`JobLauncher` memulai job.

Biasanya dipakai oleh:

- REST admin endpoint,
- scheduler,
- CLI runner,
- message-triggered launcher,
- orchestration layer.

### 15.2 JobExplorer

`JobExplorer` membaca metadata job repository tanpa mengubahnya.

Dipakai untuk:

- dashboard,
- monitoring,
- finding running executions,
- audit report,
- operator UI.

### 15.3 JobOperator

`JobOperator` menyediakan operasi level runtime:

- start,
- stop,
- restart,
- abandon,
- inspect.

Untuk production, `JobOperator` lebih cocok sebagai dasar admin capability dibanding langsung memanipulasi table metadata.

---

## 16. Preventing Duplicate Job Runs

Masalah umum:

```text
Scheduler men-trigger job setiap jam.
Job sebelumnya belum selesai.
Job baru berjalan paralel.
Data rusak/duplicate.
```

Strategi:

1. gunakan job parameter identifying yang benar,
2. cek running execution sebelum start,
3. gunakan distributed lock,
4. gunakan database unique constraint/command table,
5. desain job idempotent,
6. jangan bergantung hanya pada scheduler single node.

Pseudo-check:

```java
boolean alreadyRunning = jobExplorer.findRunningJobExecutions("dailyImportJob")
        .stream()
        .anyMatch(execution -> sameBusinessKey(execution, params));

if (alreadyRunning) {
    throw new JobAlreadyRunningForBusinessKeyException(...);
}
```

Namun check-then-start bisa race. Untuk multi-node, gunakan lock/unique command record.

---

## 17. Reader Design Patterns

### 17.1 File Reader

Untuk file:

- validasi file sebelum proses,
- simpan checksum,
- gunakan line number untuk restart,
- reject malformed line ke reject report,
- jangan overwrite input saat job berjalan,
- gunakan immutable storage path.

### 17.2 JDBC Paging Reader

Paging reader cocok untuk dataset besar.

Namun hati-hati:

```text
Jika sort key tidak stabil, restart/paging bisa skip/duplicate item.
```

Gunakan order by deterministic:

```sql
ORDER BY id ASC
```

Jangan order by kolom non-unique tanpa tiebreaker.

Buruk:

```sql
ORDER BY created_at
```

Lebih baik:

```sql
ORDER BY created_at, id
```

### 17.3 Cursor Reader

Cursor reader bisa efisien tapi memiliki constraint:

- koneksi panjang,
- restart complexity,
- timeout/lock risk,
- tergantung driver DB.

Untuk job panjang, paging/keyset sering lebih aman.

### 17.4 Keyset Reader

Untuk dataset sangat besar:

```sql
SELECT *
FROM case_record
WHERE id > :lastSeenId
ORDER BY id
FETCH FIRST :pageSize ROWS ONLY
```

Simpan `lastSeenId` di execution context.

Ini biasanya lebih stabil daripada offset pagination.

---

## 18. Processor Design Patterns

Processor yang baik:

- deterministic,
- stateless atau state kecil terkontrol,
- tidak melakukan write side effect,
- memisahkan validation dan transformation,
- menghasilkan command/output yang eksplisit,
- tidak menyembunyikan skip.

Contoh layering:

```text
RawRow
 -> syntactic validation
 -> normalized DTO
 -> semantic validation
 -> command/output item
```

Jangan lakukan ini di processor:

```java
public Output process(Input item) {
    externalClient.sendNotification(item); // side effect berbahaya
    return map(item);
}
```

Karena jika chunk rollback, processor bisa dipanggil ulang.

---

## 19. Writer Design Patterns

Writer adalah side-effect boundary.

### 19.1 Database Writer

Untuk DB writer:

- gunakan batch insert/update,
- pastikan unique key melindungi idempotency,
- hindari per-item flush,
- pilih chunk size sesuai lock/redo/undo capacity,
- catat rejected/failed item terpisah.

### 19.2 External API Writer

External API writer paling berbahaya.

Problem:

```text
Spring Batch transaction tidak bisa rollback external API.
```

Lebih aman:

```text
Batch job menulis command/outbox table.
Async dispatcher mengirim API dengan idempotency key.
```

Flow:

```text
Batch chunk transaction:
  write business update
  write outbound_command(idempotency_key, payload, status=PENDING)
commit

Dispatcher:
  read PENDING
  call external API with idempotency key
  mark SENT/FAILED
```

Ini jauh lebih recoverable.

### 19.3 File Writer

Untuk file output:

- tulis ke temp file,
- simpan position/state,
- atomic rename saat completed,
- delete/mark temp on failure sesuai policy,
- jangan expose partial output sebagai final.

---

## 20. Skip Report dan Reject Handling

Jika job mengizinkan skip, maka harus ada reject handling.

Reject record minimal:

```sql
CREATE TABLE batch_reject_record (
    id BIGINT PRIMARY KEY,
    job_execution_id BIGINT NOT NULL,
    step_execution_id BIGINT NOT NULL,
    job_name VARCHAR(200) NOT NULL,
    business_key VARCHAR(300),
    source_reference VARCHAR(500),
    error_code VARCHAR(100) NOT NULL,
    error_message VARCHAR(1000) NOT NULL,
    raw_payload_masked CLOB,
    created_at TIMESTAMP NOT NULL
);
```

Untuk regulatory/data quality context, skip tanpa reject report adalah audit gap.

Operational rule:

```text
COMPLETED_WITH_SKIPS is not the same as COMPLETED_CLEAN.
```

---

## 21. Partitioning

Partitioning membagi workload menjadi beberapa partition yang diproses paralel.

Contoh:

```text
Partition 1: id 1 - 1,000,000
Partition 2: id 1,000,001 - 2,000,000
Partition 3: id 2,000,001 - 3,000,000
```

Spring Batch model:

```text
Manager step
  -> Partitioner creates ExecutionContext per partition
  -> Worker step processes each partition
```

Partition context berisi range:

```text
minId=1
maxId=1000000
```

### 21.1 Partitioning Design Rule

Partition harus:

- tidak overlap,
- tidak meninggalkan gap,
- deterministik,
- seimbang jika mungkin,
- restartable,
- punya key range jelas.

Buruk:

```text
partition by random
partition by offset on changing data
```

Baik:

```text
partition by immutable id range
partition by tenant + id range
partition by business date shard
```

### 21.2 Partitioning vs Multi-threaded Step

| Teknik | Karakter |
|---|---|
| Multi-threaded step | lebih sederhana, tetapi reader/writer harus thread-safe |
| Partitioning | lebih eksplisit, setiap partition punya execution context |
| Remote partitioning | worker bisa di node berbeda |
| Remote chunking | manager membaca, worker memproses/menulis chunk |

Untuk enterprise production, partitioning sering lebih mudah diaudit daripada multi-threaded shared reader.

---

## 22. Parallel Steps

Parallel steps cocok jika step independen.

Contoh:

```text
Job:
  split:
    Step A: import customer
    Step B: import address
  then:
    Step C: reconcile
```

Syarat:

- tidak ada shared mutable state berbahaya,
- tidak menulis row/table yang saling lock berat,
- resource pool cukup,
- failure handling jelas,
- downstream step menunggu semua prerequisite.

Jangan paralelkan step hanya karena ingin cepat. Paralelisme bisa memindahkan bottleneck ke:

- DB connection pool,
- locks,
- disk IO,
- network,
- CPU,
- external API rate limit.

---

## 23. Remote Chunking dan Remote Partitioning

### 23.1 Remote Chunking

Manager membaca item dan mengirim chunk ke worker.

Cocok jika:

- reading centralized,
- processing/writing mahal,
- workload bisa didistribusikan.

Risiko:

- messaging complexity,
- duplicate chunk delivery,
- idempotency makin penting,
- observability lebih sulit,
- ordering tidak selalu terjaga.

### 23.2 Remote Partitioning

Manager membagi partition; worker membaca dan memproses partition sendiri.

Biasanya lebih scalable untuk DB/file shard karena worker bisa membaca range masing-masing.

Rule:

```text
Remote partitioning is usually easier to reason about than remote chunking when partitions are independent and input source supports range access.
```

---

## 24. Batch Metadata Schema dan Operational Tables

Spring Batch membutuhkan table metadata.

Umumnya ada table seperti:

```text
BATCH_JOB_INSTANCE
BATCH_JOB_EXECUTION
BATCH_JOB_EXECUTION_PARAMS
BATCH_STEP_EXECUTION
BATCH_JOB_EXECUTION_CONTEXT
BATCH_STEP_EXECUTION_CONTEXT
```

Jangan treat table ini sebagai detail tidak penting. Ini operational state.

Praktik production:

1. backup metadata sesuai kebutuhan,
2. jangan manual update kecuali emergency dengan runbook,
3. index sesuai query dashboard,
4. housekeeping metadata lama,
5. pisahkan metadata batch critical dari business table jika perlu,
6. monitor growth table context,
7. pastikan transaction isolation cukup.

### 24.1 Metadata Housekeeping

Jika job sering berjalan, metadata tumbuh cepat.

Housekeeping harus mempertimbangkan:

```text
Jangan hapus metadata job yang masih perlu restart.
Jangan hapus metadata yang masih perlu audit.
Jangan hapus parent execution tanpa child context.
```

Retention bisa berbasis:

- job name,
- status,
- age,
- audit requirement,
- business period.

---

## 25. Launching Batch Jobs dalam Spring Boot

Spring Boot bisa auto-run job saat startup jika konfigurasi mengizinkan.

Untuk production service, hati-hati:

```text
Aplikasi restart tidak selalu berarti batch harus jalan lagi.
```

Pattern yang lebih aman:

| Trigger | Cocok Untuk |
|---|---|
| CLI job app | batch one-shot container |
| Scheduler | recurring job dengan lock |
| REST admin endpoint | operator-controlled job |
| Message trigger | event-driven batch launch |
| Workflow orchestrator | dependency antar job kompleks |

### 25.1 One-Shot Batch Container

Untuk Kubernetes:

```text
Kubernetes CronJob -> Spring Boot batch app -> run job -> exit
```

Kelebihan:

- lifecycle sederhana,
- resource isolated,
- cocok untuk scheduled finite job.

Kekurangan:

- startup cost,
- monitoring perlu integrasi,
- restart policy harus dipikirkan.

### 25.2 Long-Running Batch Admin Service

```text
Spring Boot service tetap hidup
Scheduler/API memulai job
Actuator + dashboard memonitor
```

Kelebihan:

- operational API lebih mudah,
- job bisa diluncurkan manual,
- status bisa ditampilkan.

Kekurangan:

- perlu concurrency guard,
- scheduler multi-node issue,
- resource contention dengan app lain.

---

## 26. Scheduling Batch Jobs

Jangan menyamakan `@Scheduled` dengan batch runtime.

`@Scheduled` hanya trigger.

Spring Batch yang mengelola execution state.

Pattern:

```java
@Scheduled(cron = "0 0 2 * * *")
void launchDailyJob() {
    JobParameters params = new JobParametersBuilder()
            .addLocalDate("businessDate", LocalDate.now().minusDays(1), true)
            .toJobParameters();

    jobLauncher.run(dailyJob, params);
}
```

Tambahkan:

- distributed lock,
- already-running check,
- idempotent parameter,
- alert on failure,
- timeout expectation,
- backpressure if previous run still running.

---

## 27. Batch + Transaction + External Side Effects

Ini salah satu bagian paling berbahaya.

Contoh buruk:

```text
Chunk transaction:
  update database
  send email
  commit database
```

Jika email terkirim lalu DB rollback, state tidak konsisten.

Contoh buruk lain:

```text
Chunk transaction:
  update database
  call external API
  timeout uncertain
  rollback database
```

External API mungkin sudah berhasil walau client timeout.

Pattern lebih aman:

```text
Chunk transaction:
  validate item
  update business data
  insert outbox/notification_command
commit

Separate dispatcher:
  deliver side effect idempotently
```

Untuk regulatory system, side effect harus punya:

- business key,
- idempotency key,
- status,
- attempt count,
- last error,
- reconciliation path.

---

## 28. Batch + Domain Model

Batch jangan bypass semua domain invariant hanya demi cepat.

Namun batch juga tidak harus memanggil service per item jika itu membuat N+1 dan lambat.

Desain yang baik:

```text
Reader -> raw input
Processor -> validate/map to command
Writer -> bulk apply command through application service/repository designed for batch
```

Hindari dua ekstrem:

| Ekstrem | Masalah |
|---|---|
| Per item memanggil service online | lambat, side effect berulang, transaksi kecil berlebihan |
| Direct SQL update semua invariant | cepat tapi merusak aturan domain |

Solusi sering berupa **batch-specific application service**:

```java
interface CaseBatchTransitionService {
    BatchApplyResult applyTransitions(List<CaseTransitionCommand> commands);
}
```

Service ini tetap menjaga invariant, tetapi dioptimalkan untuk batch.

---

## 29. Batch untuk State Machine / Case Management

Untuk sistem case/regulatory, batch sering melakukan transisi status massal.

Contoh:

```text
PENDING_REVIEW -> OVERDUE
ACTIVE_LICENSE -> EXPIRED
DRAFT_APPLICATION -> AUTO_CANCELLED
CASE_OPEN -> SLA_BREACHED
```

Bahaya utama:

- stale read,
- concurrent user action,
- transition invalid,
- duplicate transition event,
- audit missing,
- notification duplicate,
- partial completion.

Pattern:

```text
Reader selects candidates by stable criteria.
Processor verifies transition still valid.
Writer applies transition with optimistic condition.
Writer records audit/event/outbox in same transaction.
Skipped conflict recorded as benign skip or filtered item.
```

SQL update harus conditional:

```sql
UPDATE case_record
SET status = 'EXPIRED', version = version + 1
WHERE id = ?
  AND status = 'ACTIVE_LICENSE'
  AND expiry_date < ?
  AND version = ?
```

Jika row count 0, artinya state berubah oleh proses lain. Itu bukan selalu fatal; bisa menjadi filtered/conflict record.

---

## 30. Batch Observability

Batch observability berbeda dari HTTP request observability.

Metrics penting:

| Metric | Makna |
|---|---|
| job duration | durasi total job |
| step duration | durasi per step |
| read count | item terbaca |
| write count | item tertulis |
| filter count | item difilter |
| skip count | item diskip |
| retry count | indikasi dependency instability |
| rollback count | indikasi error chunk |
| throughput items/sec | kapasitas aktual |
| lag business date | keterlambatan schedule |
| reject count by error code | data quality |

Log harus punya:

```text
jobName
jobInstanceId
jobExecutionId
stepExecutionId
businessDate/tenant/file
correlationId
```

Jangan log raw PII dari input batch.

---

## 31. Batch Testing Strategy

Testing Spring Batch harus mencakup:

1. unit test processor,
2. unit test validator,
3. slice/integration test reader,
4. integration test writer,
5. step test,
6. job flow test,
7. restart test,
8. skip/retry test,
9. duplicate launch test,
10. idempotency test.

### 31.1 Restart Test

Test paling penting tetapi sering dilupakan:

```text
Given job processes 1000 items
And it fails after item 650
When job is restarted
Then it resumes safely
And final output has exactly 1000 unique results
And no duplicate side effect exists
```

### 31.2 Skip Test

```text
Given input has 10 invalid rows
When job runs
Then job completes with COMPLETED_WITH_SKIPS
And reject table contains 10 records
And valid records are written
```

### 31.3 Retry Test

```text
Given database deadlock occurs twice
When job processes chunk
Then operation is retried
And eventually succeeds
And write count is correct
```

---

## 32. Performance Engineering untuk Spring Batch

Performance batch bukan hanya chunk size.

Cek bottleneck:

| Bottleneck | Tanda |
|---|---|
| DB read | slow query, high IO, full scan |
| DB write | lock wait, redo/undo pressure |
| CPU processor | high CPU, low IO |
| network/API | latency high, retry banyak |
| serialization | CPU/memory tinggi |
| metadata repository | high update contention |
| GC/memory | large chunk/object retention |
| partition imbalance | beberapa partition selesai jauh lebih lama |

Optimization hierarchy:

1. betulkan query/index,
2. stabilkan reader ordering,
3. batch write,
4. tuning chunk size,
5. reduce per-item object churn,
6. cache reference data safely,
7. partition workload,
8. parallelize with resource budget,
9. use staging tables,
10. redesign side-effect boundary.

### 32.1 Reference Data Cache

Batch sering lookup reference data.

Boleh cache jika:

- data kecil,
- snapshot konsisten,
- tidak berubah selama job,
- tenant-aware,
- memory cukup.

Jangan cache authorization/user-sensitive data sembarangan.

---

## 33. Operational Runbook

Setiap production batch penting harus punya runbook.

Minimal:

```text
Job name:
Purpose:
Schedule:
Expected duration:
Input source:
Output target:
Job parameters:
Restartable: yes/no
Safe to rerun: yes/no/with condition
How to check status:
How to stop:
How to restart:
How to identify duplicate run:
Where reject report is stored:
Common failure codes:
Escalation path:
Rollback/compensation strategy:
SLA/SLO:
```

Tanpa runbook, batch failure akan menjadi debugging manual saat incident.

---

## 34. Common Anti-Patterns

### 34.1 Manual Loop dalam `CommandLineRunner`

```java
for (Row row : rows) {
    process(row);
}
```

Masalah:

- tidak ada metadata,
- tidak restartable,
- tidak ada skip count,
- tidak ada step status,
- sulit monitor,
- failure recovery manual.

### 34.2 `RunIdIncrementer` untuk Semua Job

Akibat:

- restart semantics kabur,
- job gagal bisa dibuat run baru,
- duplicate processing risk.

### 34.3 External API Call Langsung di Writer

Akibat:

- duplicate side effect saat retry/restart,
- no rollback,
- timeout uncertain.

### 34.4 Skip Tanpa Reject Report

Akibat:

- data hilang diam-diam,
- audit gap,
- reconciliation sulit.

### 34.5 Partition Tanpa Deterministic Range

Akibat:

- item double processed,
- item missing,
- restart sulit.

### 34.6 Chunk Size Besar Tanpa Mengerti Rollback Cost

Akibat:

- rollback mahal,
- lock lama,
- memory tinggi,
- restart kasar.

### 34.7 Batch Metadata Dianggap Tidak Penting

Akibat:

- table membengkak,
- restart gagal,
- operator tidak tahu status,
- manual DB update berbahaya.

---

## 35. Design Blueprint: Import File Besar Secara Aman

Contoh blueprint enterprise:

```text
Job: importAgencyCaseFile
Parameters:
  agencyCode       identifying
  businessDate     identifying
  inputObjectKey   identifying
  inputVersion     identifying
  requestedBy      non-identifying

Steps:
  1. validateInputObjectStep
  2. stageRawRowsStep
  3. validateAndNormalizeStep
  4. applyBusinessChangesStep
  5. generateRejectReportStep
  6. publishOutboxStep or markOutboxReadyStep
  7. archiveInputStep
```

### Step 1 — Validate Input

- check object exists,
- checksum,
- size,
- naming convention,
- duplicate file submission.

### Step 2 — Stage Raw Rows

- read file,
- write raw rows to staging table,
- include line number,
- raw payload masked/encrypted if needed.

### Step 3 — Validate and Normalize

- parse domain fields,
- produce normalized staging,
- write reject records for bad rows.

### Step 4 — Apply Business Changes

- process valid rows,
- use conditional update/upsert,
- maintain audit,
- write domain events/outbox.

### Step 5 — Generate Reject Report

- generate file/report,
- expose to operator.

### Step 6 — Mark Outbox Ready

- do not send external notification inside main batch unless idempotent and required.

### Step 7 — Archive Input

- move input to archive location,
- mark job complete.

This blueprint is boring. That is good. Production batch should be boring, inspectable, and restartable.

---

## 36. Review Checklist untuk Spring Batch PR

Gunakan checklist ini saat review:

```text
[ ] Job parameters distinguish logical job instance correctly.
[ ] Identifying vs non-identifying parameters are intentional.
[ ] Job can be restarted safely after failure.
[ ] Input source is stable/immutable for restart.
[ ] Reader is restartable or explicitly non-restartable with reason.
[ ] Processor is deterministic and side-effect free.
[ ] Writer is transactional or idempotent.
[ ] External side effects use outbox/idempotency key.
[ ] Chunk size is justified.
[ ] Skip policy is explicit.
[ ] Retry policy is explicit.
[ ] Fatal exceptions fail the job.
[ ] Skipped records are captured in reject report.
[ ] Duplicate job launch is prevented.
[ ] Multi-node scheduler race is handled.
[ ] Partition ranges do not overlap or gap.
[ ] Metadata retention is considered.
[ ] Metrics/logging include job/step execution IDs.
[ ] Tests cover restart.
[ ] Tests cover skip/retry.
[ ] Operational runbook exists.
```

---

## 37. Java 8 hingga Java 25: Spring Batch Compatibility Perspective

Secara historis:

| Era | Java | Spring Batch | Catatan |
|---|---:|---|---|
| Legacy | Java 8 | Spring Batch 4.x | umum pada Spring Boot 2.x, `javax.*` ecosystem |
| Transition | Java 11/17 | Spring Batch 4.x/5.x | migrasi bertahap |
| Modern | Java 17+ | Spring Batch 5.x | mengikuti Spring Framework 6 baseline Java 17 |
| Current/Future | Java 17+ | Spring Batch 6.x | baseline Java 17 tetap, selaras Spring Framework 7 generation |
| Java 21–25 runtime | Java 21/25 | Batch modern | virtual thread bisa membantu beberapa execution path, tetapi batch bottleneck tetap DB/IO/transaction/resource |

Prinsip migrasi:

```text
Upgrade Spring Batch is not only dependency upgrade.
It is metadata schema, transaction behavior, Java baseline, Jakarta ecosystem, and operational compatibility upgrade.
```

Untuk legacy Java 8, banyak konsep tetap sama:

- job,
- step,
- chunk,
- repository,
- execution context,
- restart,
- skip/retry.

Namun API builder, baseline dependency, observability, Jakarta alignment, dan native/AOT context berubah pada generasi modern.

---

## 38. Intisari Mental Model

Jika harus merangkum Part 24 dalam beberapa kalimat:

```text
Spring Batch adalah runtime untuk finite workload yang perlu state, restart, metadata, transaksi, dan recovery.
```

```text
JobInstance adalah identitas logis; JobExecution adalah attempt; StepExecution adalah attempt per step; ExecutionContext adalah checkpoint.
```

```text
Chunk transaction membuat throughput dan recovery balance, tetapi item bisa diproses ulang saat rollback/restart.
```

```text
Retry untuk transient failure. Skip untuk bad item yang boleh ditolak. Fatal error harus menghentikan job.
```

```text
External side effect di batch harus idempotent atau dipisah lewat outbox/command table.
```

```text
Batch production yang baik bukan hanya cepat; ia harus restartable, observable, auditable, and boring under failure.
```

---

## 39. Latihan Praktis

### Latihan 1 — Identifying Parameters

Desain job parameter untuk job:

```text
monthlyLicenseExpiryComputation
```

Tentukan mana identifying dan non-identifying:

- month,
- agency,
- requestedBy,
- traceId,
- dryRun,
- recomputeMode,
- startedAt.

Jelaskan efeknya terhadap restart dan duplicate run.

---

### Latihan 2 — Restart Failure

Sebuah job membaca 1 juta row dari database dan update status case. Gagal setelah 600 ribu row.

Rancang:

1. reader strategy,
2. execution context,
3. writer idempotency,
4. restart behavior,
5. audit strategy.

---

### Latihan 3 — External API Side Effect

Sebuah batch harus mengirim 200 ribu notification ke external gateway.

Jelaskan kenapa langsung memanggil API dari writer berbahaya.

Desain alternatif dengan:

- notification command table,
- idempotency key,
- dispatcher,
- retry policy,
- reconciliation.

---

### Latihan 4 — Skip Report

Input file memiliki 5 juta row. Sekitar 2% invalid.

Desain reject report yang:

- aman dari PII leak,
- bisa diaudit,
- bisa dikirim ke business user,
- bisa direkonsiliasi ke line number/input record.

---

## 40. Penutup

Part ini membangun mental model Spring Batch sebagai **stateful execution runtime**, bukan loop processing biasa.

Setelah memahami ini, Anda harus bisa melihat batch job dari empat perspektif sekaligus:

1. **definition**: job/step/read/process/write,
2. **state**: instance/execution/context/status,
3. **transaction**: chunk/commit/rollback/retry/skip,
4. **operation**: monitor/restart/stop/reconcile/audit.

Bagian berikutnya akan masuk ke:

```text
25-spring-boot-actuator-micrometer-observability.md
```

Di sana kita akan membahas bagaimana Spring Boot Actuator, Micrometer, Observation API, health/readiness/liveness, metrics, traces, dan custom business observability dipakai untuk membuat Spring application benar-benar operable di production.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./23-spring-integration-enterprise-integration-patterns.md">⬅️ Part 23 — Spring Integration and Enterprise Integration Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./25-spring-boot-actuator-micrometer-observability.md">Part 25 — Spring Boot Actuator, Micrometer, Observability, and Runtime Operations ➡️</a>
</div>
