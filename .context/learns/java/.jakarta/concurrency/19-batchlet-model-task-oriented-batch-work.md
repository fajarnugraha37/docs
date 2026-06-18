# Part 19 — Batchlet Model: Task-Oriented Batch Work

> Series: `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
> File: `19-batchlet-model-task-oriented-batch-work.md`  
> Fokus: memahami `Batchlet` bukan sebagai "cara termudah membuat batch", tetapi sebagai model eksekusi task-oriented yang harus dirancang agar stop-aware, restart-aware, observable, auditable, dan aman terhadap side effect.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan perbedaan fundamental antara **batchlet step** dan **chunk-oriented step**.
2. Menentukan kapan `Batchlet` adalah pilihan desain yang tepat, dan kapan ia adalah smell.
3. Mendesain batchlet yang:
   - bisa dihentikan secara kooperatif,
   - aman terhadap restart,
   - tidak menghasilkan duplicate side effect,
   - punya audit trail,
   - punya observability yang cukup,
   - tidak menyembunyikan long-running transaction.
4. Memahami lifecycle `Batchlet`:
   - artifact creation,
   - property injection,
   - `process()` execution,
   - `stop()` signal,
   - exit status,
   - runtime status.
5. Mengimplementasikan pola batchlet untuk workload seperti:
   - file movement,
   - report generation,
   - reconciliation,
   - external API sync,
   - cache warm-up,
   - maintenance job,
   - regulatory case recalculation.
6. Menghindari anti-pattern umum:
   - infinite loop tanpa stop check,
   - transaksi raksasa,
   - side effect non-idempotent,
   - restart dari awal tanpa guard,
   - hidden orchestration di Java code,
   - `Thread.sleep()`/polling liar tanpa governance,
   - menyamakan `Batchlet` dengan scheduler.

---

## 2. Problem yang Diselesaikan Batchlet

Jakarta Batch memiliki dua model step utama:

1. **Batchlet-oriented step**  
   Cocok untuk pekerjaan yang secara alami adalah satu task utuh.

2. **Chunk-oriented step**  
   Cocok untuk pekerjaan yang secara alami adalah stream/bulk item processing: read → process → write → checkpoint.

Batchlet menjawab problem seperti:

> "Saya punya pekerjaan batch yang bukan natural `ItemReader`/`ItemProcessor`/`ItemWriter`, tetapi tetap ingin dijalankan melalui runtime batch yang punya job repository, start/stop/restart, parameter, status, dan operator API."

Contoh pekerjaan yang sering cocok untuk batchlet:

- generate satu file report besar,
- compress/move/archive file,
- call stored procedure yang sudah atomic di database,
- trigger external system export,
- perform pre-validation terhadap input manifest,
- build search index snapshot,
- rotate atau compact data tertentu,
- reconcile aggregate count antar sistem,
- send notification summary setelah batch lain selesai,
- clean temporary staging area,
- acquire/release distributed lock untuk job graph tertentu.

Namun batchlet juga sering disalahgunakan untuk:

- membaca jutaan row dalam loop manual,
- melakukan retry tanpa checkpoint,
- memanggil API eksternal tanpa idempotency,
- membuka satu transaksi selama berjam-jam,
- membuat multi-step business process di dalam satu method `process()`.

Itu bukan masalah API-nya. Itu masalah **model eksekusi**.

---

## 3. Mental Model: Batchlet sebagai Command yang Dikelola Runtime Batch

Cara berpikir yang tepat:

```text
Batchlet = managed command artifact executed as a batch step
```

Bukan:

```text
Batchlet = tempat menaruh semua logic batch dalam satu method panjang
```

Batchlet punya bentuk seperti command:

```text
Input:
  - job parameters
  - step properties
  - durable state eksternal jika diperlukan

Execution:
  - process() berjalan di thread batch runtime
  - stop() dapat dipanggil dari thread lain sebagai sinyal stop

Output:
  - exit status string
  - side effects yang harus idempotent/auditable
  - persisted operational evidence
```

Perbedaan penting:

| Aspek | Batchlet | Chunk Step |
|---|---|---|
| Unit kerja natural | task utuh | item/chunk |
| Checkpoint bawaan | tidak seperti chunk | built-in per checkpoint |
| Restart granularity | harus didesain manual | lebih natural via checkpoint |
| Stop handling | `stop()` + cooperative flag | runtime dan artifact chunk punya lifecycle lebih kaya |
| Cocok untuk | file/report/procedure/orchestration kecil | large item processing |
| Risiko utama | monolith step, duplicate side effect | tuning chunk/retry/skip kompleks |

Mental model top-tier:

> Pakai batchlet ketika pekerjaan punya atomic task boundary yang jelas. Jika kamu mulai membuat reader-loop-writer manual di dalam batchlet, biasanya kamu sedang membuat ulang chunk step secara lebih buruk.

---

## 4. API Inti `Batchlet`

Di Jakarta Batch 2.1, artifact batchlet mengimplementasikan interface:

```java
package jakarta.batch.api;

public interface Batchlet {
    String process() throws Exception;
    void stop() throws Exception;
}
```

Maknanya:

- `process()` melakukan pekerjaan utama batchlet.
- return value `String` menjadi exit status step, kecuali runtime/step logic mengaturnya secara lain.
- `stop()` dipanggil oleh batch runtime sebagai bagian dari `JobOperator.stop(executionId)`.
- `stop()` dipanggil pada thread yang berbeda dari thread yang menjalankan `process()`.

Konsekuensi desain:

1. `stop()` tidak boleh diasumsikan berjalan di thread yang sama.
2. state yang dibaca oleh `process()` dan ditulis oleh `stop()` harus thread-safe/visible.
3. `stop()` sebaiknya cepat, tidak blocking lama.
4. `process()` harus secara berkala memeriksa stop flag jika pekerjaannya panjang.
5. `stop()` bukan magic kill. Ia hanya callback agar artifact bisa menghentikan pekerjaannya secara kooperatif.

Contoh minimal:

```java
import jakarta.batch.api.Batchlet;
import jakarta.inject.Named;
import java.util.concurrent.atomic.AtomicBoolean;

@Named("simpleBatchlet")
public class SimpleBatchlet implements Batchlet {

    private final AtomicBoolean stopRequested = new AtomicBoolean(false);

    @Override
    public String process() throws Exception {
        while (!stopRequested.get()) {
            // do bounded work
            break;
        }
        return stopRequested.get() ? "STOPPED" : "COMPLETED";
    }

    @Override
    public void stop() throws Exception {
        stopRequested.set(true);
    }
}
```

Contoh ini belum production-grade, tetapi menunjukkan invariant utama:

```text
stop() sets a visible signal
process() cooperatively observes the signal
```

---

## 5. Batchlet dalam JSL

Batchlet dipakai dalam JSL sebagai step:

```xml
<job id="daily-maintenance" xmlns="https://jakarta.ee/xml/ns/jakartaee" version="2.1">
    <step id="cleanup-temp-files">
        <batchlet ref="tempFileCleanupBatchlet">
            <properties>
                <property name="retentionDays" value="7"/>
                <property name="baseDir" value="/app/data/tmp"/>
            </properties>
        </batchlet>
        <next on="COMPLETED" to="generate-summary"/>
        <fail on="FAILED"/>
    </step>

    <step id="generate-summary">
        <batchlet ref="summaryReportBatchlet"/>
    </step>
</job>
```

Hal penting:

- JSL mendefinisikan **execution graph**.
- Batchlet mendefinisikan **artifact behavior** untuk node tertentu.
- Jangan pindahkan graph kompleks ke dalam satu batchlet jika JSL bisa mengekspresikannya lebih jelas.

Bad smell:

```java
public String process() {
    validateInput();
    if (...) {
        importA();
        if (...) {
            callExternalB();
        } else {
            generateC();
        }
    }
    cleanup();
    notifyUsers();
    return "COMPLETED";
}
```

Lebih baik:

```text
validate-input step
  -> import step
  -> decision
  -> external-call step OR generate step
  -> cleanup step
  -> notify step
```

Prinsip:

> Business execution graph sebaiknya terlihat di JSL atau control plane, bukan terkubur di `process()`.

---

## 6. Property Injection dan Parameter

Batchlet biasanya membutuhkan konfigurasi runtime:

- tanggal proses,
- tenant/agency,
- file path,
- retention period,
- dry-run flag,
- batch size internal,
- API endpoint alias,
- report template id,
- correlation id.

Dalam Jakarta Batch, artifact dapat menerima property dari JSL. Contoh umum:

```java
import jakarta.batch.api.BatchProperty;
import jakarta.batch.api.Batchlet;
import jakarta.inject.Inject;
import jakarta.inject.Named;

@Named("retentionCleanupBatchlet")
public class RetentionCleanupBatchlet implements Batchlet {

    @Inject
    @BatchProperty(name = "retentionDays")
    private String retentionDays;

    @Override
    public String process() throws Exception {
        int days = Integer.parseInt(retentionDays);
        // cleanup using days
        return "COMPLETED";
    }

    @Override
    public void stop() throws Exception {
        // signal stop
    }
}
```

Namun untuk production-grade design, jangan biarkan string property tersebar tanpa validasi.

Lebih baik buat config object:

```java
public record CleanupConfig(
        int retentionDays,
        boolean dryRun,
        String targetArea
) {
    public static CleanupConfig from(String retentionDays, String dryRun, String targetArea) {
        int parsedDays = Integer.parseInt(retentionDays);
        if (parsedDays < 1 || parsedDays > 3650) {
            throw new IllegalArgumentException("retentionDays must be between 1 and 3650");
        }
        return new CleanupConfig(
                parsedDays,
                Boolean.parseBoolean(dryRun),
                requireNonBlank(targetArea, "targetArea")
        );
    }

    private static String requireNonBlank(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }
}
```

Batchlet:

```java
@Named("retentionCleanupBatchlet")
public class RetentionCleanupBatchlet implements Batchlet {

    @Inject @BatchProperty(name = "retentionDays")
    private String retentionDays;

    @Inject @BatchProperty(name = "dryRun")
    private String dryRun;

    @Inject @BatchProperty(name = "targetArea")
    private String targetArea;

    private final AtomicBoolean stopRequested = new AtomicBoolean(false);

    @Override
    public String process() throws Exception {
        CleanupConfig config = CleanupConfig.from(retentionDays, dryRun, targetArea);
        // execute with validated config
        return "COMPLETED";
    }

    @Override
    public void stop() {
        stopRequested.set(true);
    }
}
```

Mental model:

```text
JSL/property/job parameter = external input
external input must be validated like API input
```

Dalam sistem regulatory/compliance, parameter batch bisa menentukan data mana yang diproses. Parameter salah bisa sama berbahayanya dengan API request salah.

---

## 7. Exit Status vs Batch Status

Ada dua jenis status yang harus dibedakan:

1. **Batch status**  
   Status runtime standar seperti started, completed, failed, stopping, stopped.

2. **Exit status**  
   String domain/flow status yang bisa dipakai untuk transition.

Contoh exit status:

- `COMPLETED`
- `NO_INPUT`
- `COMPLETED_WITH_WARNINGS`
- `VALIDATION_FAILED`
- `STOPPED`
- `SKIPPED_BY_POLICY`
- `PARTIAL_EXTERNAL_FAILURE`

Jangan semua hal dijadikan `FAILED`.

Contoh:

```java
@Override
public String process() throws Exception {
    Manifest manifest = loadManifest();
    if (manifest.isEmpty()) {
        return "NO_INPUT";
    }

    ValidationResult result = validate(manifest);
    if (!result.isValid()) {
        writeValidationReport(result);
        return "VALIDATION_FAILED";
    }

    runTask(manifest);
    return "COMPLETED";
}
```

JSL:

```xml
<step id="validate-manifest">
    <batchlet ref="manifestValidationBatchlet"/>
    <next on="COMPLETED" to="process-file"/>
    <end on="NO_INPUT"/>
    <fail on="VALIDATION_FAILED"/>
</step>
```

Prinsip:

```text
Batch status tells operator whether runtime succeeded.
Exit status tells job graph what business route to take.
```

---

## 8. Stop Semantics: `stop()` Bukan Kill Switch

`JobOperator.stop(executionId)` meminta runtime menghentikan job execution. Untuk batchlet, runtime akan memanggil `stop()` pada artifact. Namun `stop()` tidak otomatis membatalkan operasi blocking yang sedang terjadi.

Jika `process()` sedang:

- menunggu JDBC query tanpa query timeout,
- menunggu HTTP call tanpa socket timeout,
- melakukan `Thread.sleep(1 hour)`,
- menunggu lock yang tidak punya timeout,
- melakukan native I/O blocking,

maka `stop()` mungkin hanya menyalakan flag, tetapi thread utama tetap stuck.

Production-grade stop design:

```text
1. stop() sets visible cancellation flag
2. process() checks flag at safe boundaries
3. blocking calls have timeout
4. long loops are broken into bounded units
5. resources are closed/cancelled if supported
6. side effects are committed only at safe boundaries
7. final state is recorded durably
```

Contoh stop-aware batchlet:

```java
@Named("externalExportBatchlet")
public class ExternalExportBatchlet implements Batchlet {

    private final AtomicBoolean stopRequested = new AtomicBoolean(false);

    @Inject
    private ExportService exportService;

    @Override
    public String process() throws Exception {
        ExportPlan plan = exportService.loadPlan();

        for (ExportUnit unit : plan.units()) {
            if (stopRequested.get()) {
                exportService.recordStopped(plan.id(), unit.id());
                return "STOPPED";
            }

            exportService.exportUnitWithTimeout(unit);
            exportService.markUnitDone(unit.id());
        }

        return "COMPLETED";
    }

    @Override
    public void stop() {
        stopRequested.set(true);
        exportService.requestStop();
    }
}
```

`exportService.requestStop()` bisa digunakan untuk:

- cancel HTTP request jika client mendukung,
- close stream,
- update stop marker di database,
- signal worker internal.

Tetapi tetap hati-hati: `stop()` dipanggil dari thread lain. Jangan melakukan operasi berat atau blocking panjang di sana.

---

## 9. Thread Safety dalam Batchlet

Karena `stop()` bisa dipanggil dari thread berbeda, field yang dipakai untuk komunikasi harus thread-safe.

Aman:

```java
private final AtomicBoolean stopRequested = new AtomicBoolean(false);
```

Atau:

```java
private volatile boolean stopRequested;
```

Tidak aman:

```java
private boolean stopRequested;
```

Kenapa?

```text
process() thread may not observe update from stop() thread reliably.
```

Gunakan `AtomicBoolean` ketika:

- butuh compare-and-set,
- butuh ekspresi intention yang jelas,
- ada beberapa state transition.

Gunakan `volatile` ketika:

- hanya butuh visibility flag sederhana.

Contoh state lebih kaya:

```java
enum StopState {
    RUNNING,
    STOP_REQUESTED,
    CLEANING_UP,
    STOPPED
}

private final AtomicReference<StopState> state =
        new AtomicReference<>(StopState.RUNNING);
```

Namun jangan over-engineer. Untuk banyak batchlet, `AtomicBoolean` cukup.

---

## 10. Transaction Boundary pada Batchlet

Salah satu kesalahan paling berbahaya:

```java
@Transactional
public String process() {
    for (...) {
        updateDatabase();
        callExternalApi();
        writeFile();
    }
    return "COMPLETED";
}
```

Masalah:

- transaksi bisa hidup terlalu lama,
- lock tertahan,
- undo/redo membengkak,
- timeout transaksi,
- external side effect tidak rollback,
- restart menjadi tidak jelas,
- stop menjadi sulit.

Batchlet tidak memiliki checkpoint transaction model seperti chunk step. Jadi kamu harus mendesain sendiri boundary transaksinya.

Pattern yang lebih aman:

```text
process()
  load durable plan
  for each bounded unit:
    if stop requested: return STOPPED
    transaction 1: reserve unit
    external side effect with idempotency key
    transaction 2: record result
```

Contoh:

```java
@Override
public String process() throws Exception {
    List<WorkUnit> units = workUnitRepository.findPendingUnits(jobExecutionId());

    for (WorkUnit unit : units) {
        if (stopRequested.get()) {
            return "STOPPED";
        }

        WorkReservation reservation = workUnitService.reserve(unit.id());
        if (!reservation.acquired()) {
            continue;
        }

        ExternalResult result = externalGateway.call(
                unit.payload(),
                unit.idempotencyKey()
        );

        workUnitService.recordResult(unit.id(), result);
    }

    return "COMPLETED";
}
```

Di sini transaction berada di service method kecil:

```java
@Transactional
public WorkReservation reserve(String unitId) {
    // lock/update status PENDING -> IN_PROGRESS
}

@Transactional
public void recordResult(String unitId, ExternalResult result) {
    // status IN_PROGRESS -> DONE/FAILED
}
```

Prinsip:

> Dalam batchlet, transaction boundary harus dibuat eksplisit dan kecil. Jangan biarkan satu `process()` menjadi satu transaksi raksasa.

---

## 11. Restartability dalam Batchlet

Chunk step punya checkpoint model natural. Batchlet tidak otomatis tahu progress internal kamu.

Jika batchlet gagal setelah 70% pekerjaan selesai, apa yang terjadi saat restart?

Kemungkinan buruk:

```text
Restart starts from beginning
  -> duplicate external calls
  -> duplicate generated file
  -> duplicate notification
  -> inconsistent report
```

Maka batchlet panjang harus punya state durable sendiri.

State minimal:

```text
job_execution_id
business_job_key
unit_id
status: PENDING | IN_PROGRESS | DONE | FAILED | SKIPPED
attempt_count
last_error
idempotency_key
updated_at
```

Contoh table:

```sql
CREATE TABLE BATCH_EXPORT_UNIT (
    BUSINESS_JOB_KEY      VARCHAR2(100) NOT NULL,
    UNIT_ID               VARCHAR2(100) NOT NULL,
    STATUS                VARCHAR2(30)  NOT NULL,
    IDEMPOTENCY_KEY       VARCHAR2(150) NOT NULL,
    ATTEMPT_COUNT         NUMBER        DEFAULT 0 NOT NULL,
    LAST_ERROR_CODE       VARCHAR2(100),
    LAST_ERROR_MESSAGE    VARCHAR2(1000),
    CREATED_AT            TIMESTAMP     NOT NULL,
    UPDATED_AT            TIMESTAMP     NOT NULL,
    CONSTRAINT PK_BATCH_EXPORT_UNIT PRIMARY KEY (BUSINESS_JOB_KEY, UNIT_ID),
    CONSTRAINT UK_BATCH_EXPORT_UNIT_IDEMP UNIQUE (IDEMPOTENCY_KEY)
);
```

Restart logic:

```java
List<WorkUnit> units = repository.findUnitsToRun(businessJobKey);
```

Query-nya tidak mengambil semua unit, tetapi hanya:

```sql
WHERE STATUS IN ('PENDING', 'FAILED_RETRYABLE', 'IN_PROGRESS_RECOVERABLE')
```

Untuk unit `IN_PROGRESS`, perlu recovery policy:

- jika job sebelumnya mati mendadak, mark sebagai recoverable,
- jika external side effect punya idempotency key, retry aman,
- jika tidak aman, butuh manual review.

Mental model:

```text
Batchlet restartability is not automatic progress memory.
It must be encoded as durable business progress.
```

---

## 12. Idempotency untuk Batchlet

Batchlet sering melakukan side effect yang besar:

- generate file,
- kirim email,
- call external API,
- update status case,
- publish event,
- archive data.

Jika proses gagal di tengah, restart akan mengulang. Tanpa idempotency, sistem bisa rusak.

### 12.1 Idempotency by Natural Key

Contoh: satu report per `agency + reportDate`.

```text
report_key = agency + ':' + report_date
```

Jika report sudah ada untuk key tersebut, jangan generate duplicate.

### 12.2 Idempotency by Request Key

External API:

```text
idempotency_key = business_job_key + ':' + unit_id
```

Kirim key ini ke downstream jika downstream mendukung idempotency.

### 12.3 Idempotency by Dedup Table

Jika downstream tidak mendukung idempotency:

```sql
CREATE TABLE OUTBOUND_EFFECT_LOG (
    IDEMPOTENCY_KEY VARCHAR2(150) PRIMARY KEY,
    EFFECT_TYPE     VARCHAR2(50) NOT NULL,
    STATUS          VARCHAR2(30) NOT NULL,
    RESPONSE_REF     VARCHAR2(200),
    CREATED_AT      TIMESTAMP NOT NULL
);
```

Flow:

```text
1. insert effect log PENDING with unique idempotency key
2. perform side effect
3. update effect log DONE
4. on restart, inspect effect log
```

Caveat:

- Jika crash terjadi setelah side effect sukses tetapi sebelum update log DONE, state ambiguous.
- Maka butuh downstream query/reconciliation jika memungkinkan.

### 12.4 Idempotency by Atomic Rename

File generation:

```text
write to report.tmp
fsync/close
rename report.tmp -> report.csv atomically
```

Restart:

```text
if final report exists and checksum matches -> skip
if tmp exists -> delete/regenerate
```

---

## 13. Kapan Batchlet Cocok

Gunakan batchlet jika pekerjaan:

1. Punya task boundary yang jelas.
2. Tidak natural sebagai item stream.
3. Bisa dibuat stop-aware dengan safe points.
4. Bisa dibuat restart-aware dengan durable state sederhana.
5. Tidak membutuhkan skip/retry item-level yang kompleks.
6. Lebih mudah dipahami sebagai command daripada chunk.

Contoh cocok:

### 13.1 File Manifest Validation

```text
Input: manifest.csv
Task: validate file list, checksum, count, naming convention
Output: validation report
```

Tidak perlu chunk jika hanya validasi metadata file.

### 13.2 Trigger Stored Procedure

```text
Task: call DB procedure that internally recalculates summary table
```

Cocok jika procedure:

- punya transaction boundary jelas,
- bisa timeout,
- punya audit log,
- bisa rerun aman.

### 13.3 Generate Report Snapshot

```text
Task: generate one monthly PDF/CSV report for agency
```

Cocok jika output key jelas dan generation idempotent.

### 13.4 Cleanup Temporary Area

```text
Task: delete temp files older than N days
```

Cocok jika deletion policy jelas dan dry-run tersedia.

### 13.5 Pre/Post Step Orchestration

```text
pre-step: acquire lock
post-step: release lock / notify
```

Cocok jika batchlet kecil dan jelas.

---

## 14. Kapan Batchlet Tidak Cocok

Jangan gunakan batchlet jika pekerjaan sebenarnya:

1. Membaca jutaan record item-by-item.
2. Membutuhkan checkpoint per N item.
3. Membutuhkan skip/retry item-level.
4. Membutuhkan partitioning natural per range/hash.
5. Butuh reader/processor/writer separation.
6. Memiliki progress yang harus dilanjutkan secara halus setelah failure.
7. Membutuhkan commit interval tuning.

Contoh tidak cocok:

```java
public String process() {
    List<Customer> customers = customerRepository.findAll();
    for (Customer customer : customers) {
        enrich(customer);
        update(customer);
    }
    return "COMPLETED";
}
```

Ini seharusnya chunk step:

```text
ItemReader<Customer>
ItemProcessor<Customer, EnrichedCustomer>
ItemWriter<EnrichedCustomer>
commit-interval=100/500/1000
checkpoint
skip/retry policy
```

Prinsip:

> Jika kamu mulai bertanya “berapa commit interval yang ideal untuk loop di batchlet?”, jawabannya sering: gunakan chunk step.

---

## 15. Pattern: Stop-Aware Long Task

Batchlet untuk pekerjaan panjang harus punya safe points.

```java
@Named("caseAgeingRecalculationBatchlet")
public class CaseAgeingRecalculationBatchlet implements Batchlet {

    private final AtomicBoolean stopRequested = new AtomicBoolean(false);

    @Inject
    private CaseAgeingService caseAgeingService;

    @Override
    public String process() throws Exception {
        RecalculationPlan plan = caseAgeingService.preparePlan();

        for (CaseBucket bucket : plan.buckets()) {
            if (stopRequested.get()) {
                caseAgeingService.recordStop(plan.id(), bucket.id());
                return "STOPPED";
            }

            caseAgeingService.recalculateBucket(bucket.id());
        }

        return "COMPLETED";
    }

    @Override
    public void stop() {
        stopRequested.set(true);
    }
}
```

Service:

```java
@Transactional
public void recalculateBucket(String bucketId) {
    // bounded DB update
    // short transaction
    // status update
}
```

Important invariant:

```text
Each bucket must be safely repeatable or durably marked done.
```

Jika satu bucket masih terlalu besar, batchlet boundary salah. Gunakan chunk atau partitioned batch.

---

## 16. Pattern: File Movement Batchlet

Skenario:

```text
Move accepted files from inbound/ to processing/
Validate checksum
Write manifest result
```

Desain buruk:

```java
Files.move(source, target);
return "COMPLETED";
```

Masalah:

- file target mungkin sudah ada,
- crash saat move,
- duplicate processing,
- tidak ada manifest,
- restart tidak tahu mana yang sudah dipindah.

Desain lebih aman:

```text
1. Read input manifest
2. Validate every source file exists
3. Validate checksum
4. Insert file movement plan rows
5. For each row:
   - if stop requested, return STOPPED
   - move source -> target.tmp or processing/name
   - verify checksum after move
   - mark row MOVED
6. Return COMPLETED
```

Contoh code skeleton:

```java
@Named("fileMovementBatchlet")
public class FileMovementBatchlet implements Batchlet {

    private final AtomicBoolean stopRequested = new AtomicBoolean(false);

    @Inject
    private FileMovementService service;

    @Override
    public String process() throws Exception {
        MovementPlan plan = service.loadOrCreatePlan();

        for (MovementItem item : service.findPendingItems(plan.id())) {
            if (stopRequested.get()) {
                service.recordPlanStopped(plan.id());
                return "STOPPED";
            }

            service.moveOneItem(item);
        }

        return service.hasFailures(plan.id())
                ? "COMPLETED_WITH_WARNINGS"
                : "COMPLETED";
    }

    @Override
    public void stop() {
        stopRequested.set(true);
    }
}
```

File movement service:

```java
public void moveOneItem(MovementItem item) throws IOException {
    Path source = item.sourcePath();
    Path target = item.targetPath();
    Path tempTarget = target.resolveSibling(target.getFileName() + ".tmp");

    if (Files.exists(target) && checksumMatches(target, item.expectedChecksum())) {
        repository.markMoved(item.id());
        return;
    }

    Files.deleteIfExists(tempTarget);
    Files.move(source, tempTarget, StandardCopyOption.REPLACE_EXISTING);

    if (!checksumMatches(tempTarget, item.expectedChecksum())) {
        repository.markFailed(item.id(), "CHECKSUM_MISMATCH");
        return;
    }

    Files.move(tempTarget, target, StandardCopyOption.ATOMIC_MOVE);
    repository.markMoved(item.id());
}
```

Catatan:

- `ATOMIC_MOVE` tidak selalu didukung lintas filesystem.
- Jika tidak didukung, desain harus punya recovery check.
- File operation harus diperlakukan sebagai side effect non-transactional.

---

## 17. Pattern: Report Generation Batchlet

Skenario:

```text
Generate monthly enforcement ageing report for agency
```

Design goals:

- satu report per agency/month,
- restart tidak membuat duplicate,
- output punya checksum,
- operator bisa lihat status,
- report bisa diregenerate controlled.

Durable table:

```sql
CREATE TABLE REPORT_GENERATION (
    REPORT_KEY       VARCHAR2(150) PRIMARY KEY,
    AGENCY_CODE      VARCHAR2(30) NOT NULL,
    REPORT_MONTH     VARCHAR2(7)  NOT NULL,
    STATUS           VARCHAR2(30) NOT NULL,
    OUTPUT_PATH      VARCHAR2(500),
    CHECKSUM_SHA256  VARCHAR2(64),
    ATTEMPT_COUNT    NUMBER DEFAULT 0 NOT NULL,
    LAST_ERROR       VARCHAR2(1000),
    CREATED_AT       TIMESTAMP NOT NULL,
    UPDATED_AT       TIMESTAMP NOT NULL
);
```

Batchlet:

```java
@Named("monthlyReportBatchlet")
public class MonthlyReportBatchlet implements Batchlet {

    private final AtomicBoolean stopRequested = new AtomicBoolean(false);

    @Inject
    private ReportGenerationService service;

    @Inject @BatchProperty(name = "agencyCode")
    private String agencyCode;

    @Inject @BatchProperty(name = "reportMonth")
    private String reportMonth;

    @Override
    public String process() throws Exception {
        ReportRequest request = ReportRequest.of(agencyCode, reportMonth);
        ReportState state = service.loadOrCreate(request);

        if (state.isCompletedAndFileValid()) {
            return "ALREADY_COMPLETED";
        }

        if (stopRequested.get()) {
            return "STOPPED";
        }

        service.markRunning(request.key());

        Path tempFile = service.generateToTempFile(request, this::isStopRequested);

        if (stopRequested.get()) {
            service.markStopped(request.key());
            service.cleanupTempFile(tempFile);
            return "STOPPED";
        }

        service.publishFinalReport(request, tempFile);
        service.markCompleted(request.key());

        return "COMPLETED";
    }

    private boolean isStopRequested() {
        return stopRequested.get();
    }

    @Override
    public void stop() {
        stopRequested.set(true);
    }
}
```

`generateToTempFile` harus mengecek stop callback pada safe points:

```java
public Path generateToTempFile(ReportRequest request, BooleanSupplier stopRequested) {
    Path temp = tempPathFor(request);

    try (ReportWriter writer = openWriter(temp)) {
        for (ReportSection section : sections(request)) {
            if (stopRequested.getAsBoolean()) {
                break;
            }
            writer.writeSection(section);
        }
    }

    return temp;
}
```

Prinsip:

```text
Never expose partial output as final output.
```

---

## 18. Pattern: External API Trigger Batchlet

Skenario:

```text
Trigger downstream system to export dataset and poll until ready
```

Ini cocok batchlet jika:

- external operation adalah satu task besar,
- downstream punya operation id,
- polling punya timeout,
- restart bisa resume by operation id.

Bad design:

```java
String operationId = api.startExport();
while (!api.isDone(operationId)) {
    Thread.sleep(5000);
}
api.download(operationId);
return "COMPLETED";
```

Masalah:

- operation id hilang jika crash,
- sleep tidak stop-aware,
- polling tidak punya deadline,
- 429/5xx tidak terklasifikasi,
- restart membuat export baru.

Better design:

```text
1. Create/reuse durable external operation record
2. Start external operation only if not started
3. Store operation id
4. Poll with deadline and stop checks
5. Download result idempotently
6. Mark completed
```

Code skeleton:

```java
@Named("externalExportPollingBatchlet")
public class ExternalExportPollingBatchlet implements Batchlet {

    private final AtomicBoolean stopRequested = new AtomicBoolean(false);

    @Inject
    private ExternalExportService service;

    @Override
    public String process() throws Exception {
        ExportOperation op = service.loadOrStartOperation();

        while (!stopRequested.get()) {
            ExportStatus status = service.fetchStatus(op.operationId());

            switch (status.state()) {
                case COMPLETED -> {
                    service.downloadIfNeeded(op.operationId());
                    service.markCompleted(op.operationId());
                    return "COMPLETED";
                }
                case FAILED -> {
                    service.markFailed(op.operationId(), status.reason());
                    return "FAILED_EXTERNAL";
                }
                case RUNNING -> service.waitBeforeNextPoll(stopRequested::get);
            }
        }

        service.markStopped(op.operationId());
        return "STOPPED";
    }

    @Override
    public void stop() {
        stopRequested.set(true);
        service.requestStop();
    }
}
```

Stop-aware wait:

```java
public void waitBeforeNextPoll(BooleanSupplier stopRequested) throws InterruptedException {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
    while (System.nanoTime() < deadline) {
        if (stopRequested.getAsBoolean()) {
            return;
        }
        Thread.sleep(250);
    }
}
```

Lebih baik lagi: gunakan scheduled/polling dengan bounded wait atau client timeout. Jangan menunggu selamanya.

---

## 19. Pattern: Maintenance Batchlet

Maintenance batchlet sering dipakai untuk:

- cleanup temp rows,
- purge old logs,
- recompute summary,
- compact staging table,
- refresh materialized data,
- rebuild cache.

Risiko utama:

- lock besar,
- delete besar,
- undo/redo pressure,
- blocking request traffic,
- tidak ada progress,
- tidak ada throttle.

Contoh cleanup DB yang lebih aman:

```java
@Named("auditStagingCleanupBatchlet")
public class AuditStagingCleanupBatchlet implements Batchlet {

    private static final int DELETE_BATCH_SIZE = 1_000;

    private final AtomicBoolean stopRequested = new AtomicBoolean(false);

    @Inject
    private AuditStagingCleanupService service;

    @Override
    public String process() throws Exception {
        int totalDeleted = 0;

        while (!stopRequested.get()) {
            int deleted = service.deleteNextBatch(DELETE_BATCH_SIZE);
            totalDeleted += deleted;

            service.recordProgress(totalDeleted);

            if (deleted == 0) {
                return "COMPLETED";
            }

            service.smallPauseForBackpressure();
        }

        return "STOPPED";
    }

    @Override
    public void stop() {
        stopRequested.set(true);
    }
}
```

Transactional service:

```java
@Transactional
public int deleteNextBatch(int limit) {
    // DB-specific implementation
    // delete only bounded set
    // commit after each batch
}
```

Note:

- Kalau logic sudah menjadi item deletion dengan checkpoint dan skip/retry, chunk step bisa lebih tepat.
- Kalau hanya bounded cleanup sederhana, batchlet masih reasonable.

---

## 20. Batchlet vs ManagedExecutorService

Pertanyaan penting:

> Kenapa tidak cukup pakai `ManagedExecutorService` untuk background task?

Perbandingan:

| Aspek | ManagedExecutorService | Jakarta Batch Batchlet |
|---|---|---|
| Tujuan | async execution primitive | durable batch job step |
| Job repository | tidak built-in | built-in concept |
| Start/stop/restart | harus dibuat sendiri | runtime punya API |
| Parameterized execution | manual | job parameters/JSL |
| Operator control | manual | `JobOperator` |
| Step graph | manual | JSL |
| Restartability | manual | framework-level plus artifact design |
| Cocok untuk | request offload, short async task | background batch workload |

Gunakan `ManagedExecutorService` ketika:

- task pendek,
- tidak butuh job repository,
- tidak butuh restart setelah server restart,
- hasil bisa dikembalikan ke request/promise/future,
- kapasitas dikontrol executor.

Gunakan Batchlet ketika:

- workload harus terlihat sebagai job,
- operator perlu stop/restart/query,
- execution punya parameter,
- status harus persisted,
- job graph punya step,
- ada kebutuhan audit batch.

---

## 21. Batchlet vs Scheduler

Scheduler menjawab:

```text
When should work start?
```

Batchlet menjawab:

```text
How should this batch step execute under batch runtime?
```

Jangan campur:

```java
@Schedule(hour = "1")
public void run() {
    hugeMaintenanceLogic();
}
```

Lebih baik:

```text
scheduler trigger -> JobOperator.start(jobName, parameters)
Jakarta Batch runtime -> execute batchlet/chunk steps
```

Dengan ini:

- schedule bisa tetap sederhana,
- batch execution punya job repository,
- operator bisa melihat job execution,
- restart bisa dilakukan,
- batch parameters tercatat,
- failure tidak tersembunyi di scheduler log.

---

## 22. Batchlet vs Workflow Engine

Batchlet bukan workflow engine.

Jika logic kamu memiliki:

- human approval,
- long waiting state berhari-hari,
- timer event kompleks,
- compensation antar banyak service,
- business-visible state machine,
- manual intervention task,
- SLA lifecycle,
- escalation flow,

maka jangan paksa semuanya ke batchlet.

Batchlet cocok untuk:

```text
bounded technical/business processing step
```

Workflow engine cocok untuk:

```text
long-running business process with explicit state transitions
```

Dalam regulatory case management:

- enforcement case lifecycle: workflow/state machine.
- nightly recalculation of overdue cases: batch.
- one step to generate escalation candidate list: batchlet/chunk depending shape.
- officer approval of escalation: workflow/human task.

---

## 23. Designing Batchlet as a Small State Machine

Batchlet yang production-grade biasanya punya internal state sederhana:

```text
INITIALIZING
VALIDATING
RUNNING
STOPPING
CLEANING_UP
COMPLETED
FAILED
```

Namun state ini tidak selalu harus menjadi enum di code. Yang penting adalah durable evidence.

Contoh state model:

```sql
CREATE TABLE BATCH_TASK_STATE (
    BUSINESS_KEY   VARCHAR2(150) PRIMARY KEY,
    STEP_NAME      VARCHAR2(100) NOT NULL,
    STATUS         VARCHAR2(30) NOT NULL,
    CURRENT_PHASE  VARCHAR2(50),
    PROGRESS_TEXT  VARCHAR2(500),
    ATTEMPT_COUNT  NUMBER DEFAULT 0 NOT NULL,
    LAST_ERROR     VARCHAR2(1000),
    UPDATED_AT     TIMESTAMP NOT NULL
);
```

Batchlet updates:

```java
service.updatePhase(key, "VALIDATING", "Validating input manifest");
service.updatePhase(key, "RUNNING", "Moving files");
service.updatePhase(key, "CLEANING_UP", "Deleting temp files");
```

Operator UI bisa menampilkan:

```text
Job: daily-file-ingestion
Step: move-files
Status: RUNNING
Phase: Moving files
Progress: 172/900 files moved
```

Prinsip:

> Batch repository tells runtime state. Business progress table tells meaningful progress.

---

## 24. Logging, Metrics, Audit untuk Batchlet

### 24.1 Logging

Log harus mengandung:

- job name,
- job execution id,
- step execution id,
- business key,
- correlation id,
- phase,
- record/unit id jika ada,
- attempt count,
- error classification.

Contoh log:

```text
INFO batchlet=monthlyReport jobExecutionId=81231 step=generate-report agency=CEA reportMonth=2026-06 phase=GENERATE started
INFO batchlet=monthlyReport jobExecutionId=81231 agency=CEA output=/reports/CEA-2026-06.csv checksum=... completed
```

Jangan log:

- token,
- password,
- PII mentah,
- payload besar,
- full exception berulang ribuan kali tanpa aggregation.

### 24.2 Metrics

Metrics penting:

```text
batchlet_execution_duration_seconds
batchlet_stop_requested_total
batchlet_completed_total
batchlet_failed_total
batchlet_exit_status_total{exit_status="..."}
batchlet_unit_processed_total
batchlet_external_call_duration_seconds
batchlet_retry_total
```

### 24.3 Audit

Audit harus menjawab:

- siapa yang start job,
- kapan job start/stop/restart,
- parameter apa yang digunakan,
- input apa yang diproses,
- output apa yang dihasilkan,
- apa yang gagal,
- apakah ada manual override,
- apakah restart menghasilkan duplicate atau tidak.

Contoh audit event:

```json
{
  "eventType": "BATCH_STEP_COMPLETED",
  "jobName": "monthly-enforcement-report",
  "stepName": "generate-report",
  "jobExecutionId": 81231,
  "businessKey": "CEA:2026-06",
  "requestedBy": "system:scheduler",
  "executedBy": "batch-runtime",
  "exitStatus": "COMPLETED",
  "outputChecksum": "...",
  "timestamp": "2026-06-17T01:10:11Z"
}
```

---

## 25. Error Classification dalam Batchlet

Jangan hanya:

```java
catch (Exception e) {
    return "FAILED";
}
```

Klasifikasikan error:

| Error | Meaning | Exit Status | Retry? | Operator Action |
|---|---|---|---|---|
| Invalid parameter | input salah | `VALIDATION_FAILED` | no | fix params |
| Missing file | input belum tersedia | `INPUT_NOT_FOUND` | maybe | check upstream |
| Checksum mismatch | data integrity issue | `INTEGRITY_FAILED` | no | investigate |
| HTTP 429 | rate limit | `TEMPORARY_DOWNSTREAM_LIMIT` | yes | retry later |
| HTTP 401 | auth/config issue | `AUTH_FAILED` | no/after fix | rotate credentials |
| DB timeout | transient/load | `TEMPORARY_DB_FAILURE` | yes | check DB |
| Stop requested | operator stop | `STOPPED` | restartable | restart if needed |

Code pattern:

```java
@Override
public String process() throws Exception {
    try {
        return execute();
    } catch (InvalidBatchParameterException e) {
        audit.validationFailed(e);
        return "VALIDATION_FAILED";
    } catch (InputIntegrityException e) {
        audit.integrityFailed(e);
        return "INTEGRITY_FAILED";
    } catch (TemporaryDownstreamException e) {
        audit.temporaryFailure(e);
        throw e; // let runtime mark failed if restart/retry managed outside
    }
}
```

Decision:

- return exit status untuk business route yang expected,
- throw exception untuk unexpected technical failure yang harus menandai step failed.

Jangan menelan exception technical lalu return `COMPLETED_WITH_WARNINGS` hanya agar job terlihat hijau.

---

## 26. Testing Batchlet

Batchlet testing harus mencakup lebih dari unit test happy path.

### 26.1 Unit Test Process Logic

Pisahkan logic ke service agar mudah dites.

```java
@Test
void shouldReturnNoInputWhenManifestEmpty() {
    // given
    service.stubManifest(emptyManifest());

    // when
    String status = batchlet.process();

    // then
    assertEquals("NO_INPUT", status);
}
```

### 26.2 Stop Test

Test bahwa stop flag benar-benar dihormati.

```java
@Test
void shouldStopBetweenUnits() throws Exception {
    var batchlet = new ExportBatchlet(service);

    service.afterFirstUnit(() -> {
        try {
            batchlet.stop();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    });

    String status = batchlet.process();

    assertEquals("STOPPED", status);
    assertEquals(1, service.completedUnits());
}
```

### 26.3 Restart Test

Simulasikan crash setelah side effect:

```text
run 1:
  unit A done
  crash before unit A marked done

run 2:
  detect idempotency key
  reconcile unit A
  continue unit B
```

### 26.4 Timeout Test

Pastikan blocking external call punya timeout.

### 26.5 Duplicate Start Test

Pastikan dua execution dengan business key sama tidak merusak output.

### 26.6 Parameter Validation Test

Test parameter kosong, invalid date, unauthorized agency, path traversal, dan range terlalu besar.

---

## 27. Security Considerations

Batchlet sering dijalankan oleh scheduler/system identity, tetapi parameter bisa berasal dari user/admin/operator.

Perhatikan:

1. Validasi authorization saat start job.
2. Jangan percaya job parameter.
3. Jangan log sensitive parameter.
4. Jangan menerima arbitrary file path tanpa allowlist.
5. Jangan membiarkan operator menjalankan job untuk agency/tenant yang tidak berwenang.
6. Jangan menggunakan user session sebagai identitas eksekusi long-running job.
7. Simpan `requestedBy` dan `executedBy` secara terpisah.

Contoh model identity:

```text
requestedBy = officerA
approvedBy  = supervisorB
executedBy  = system:batch-runtime
businessScope = agency:CEA
reason = monthly regulatory report
```

Ini lebih defensible daripada:

```text
executedBy = officerA
```

karena job mungkin berjalan 2 jam setelah officer logout.

---

## 28. Batchlet di Cluster/Kubernetes

Masalah cluster:

- dua node bisa menerima start request,
- pod bisa mati saat batchlet running,
- rolling deployment bisa menghentikan job,
- local filesystem bisa hilang,
- stop signal butuh graceful shutdown,
- output path harus shared/durable.

Guideline:

1. Gunakan job repository shared.
2. Gunakan business key uniqueness untuk mencegah duplicate logical job.
3. Jangan simpan progress hanya di memory.
4. Jangan bergantung pada local pod filesystem untuk output final.
5. Gunakan temp file lokal hanya jika bisa diregenerate.
6. Pastikan shutdown hook/runtime stop memberi waktu cleanup.
7. Desain restart setelah pod eviction.

Untuk EKS/Kubernetes:

```text
pod termination -> app server shutdown -> batch runtime should stop jobs -> batchlet.stop() -> cooperative cleanup
```

Namun jangan mengandalkan ini 100% karena pod bisa mati paksa. Durable progress tetap wajib.

---

## 29. Advanced Design: Batchlet sebagai Adapter ke Existing Engine

Kadang sistem sudah punya engine internal:

- report engine,
- file transfer engine,
- reconciliation engine,
- index rebuild engine,
- external export engine.

Batchlet bisa menjadi thin adapter:

```java
@Named("reportEngineBatchlet")
public class ReportEngineBatchlet implements Batchlet {

    private final AtomicBoolean stopRequested = new AtomicBoolean(false);

    @Inject
    private ReportEngine engine;

    @Override
    public String process() throws Exception {
        EngineResult result = engine.run(new EngineCommand(...), stopRequested::get);
        return switch (result.status()) {
            case COMPLETED -> "COMPLETED";
            case NO_INPUT -> "NO_INPUT";
            case STOPPED -> "STOPPED";
            case COMPLETED_WITH_WARNINGS -> "COMPLETED_WITH_WARNINGS";
            case FAILED -> throw new IllegalStateException(result.errorSummary());
        };
    }

    @Override
    public void stop() {
        stopRequested.set(true);
        engine.requestStop();
    }
}
```

Ini bagus jika:

- engine punya contract jelas,
- engine stop-aware,
- engine tidak membuat thread liar,
- engine expose metrics/progress,
- engine bisa resume/reconcile.

Batchlet menjadi boundary antara Jakarta Batch runtime dan domain engine.

---

## 30. Advanced Design: Batchlet + Outbox

Untuk side effect eksternal, batchlet bisa menulis outbox alih-alih langsung mengirim.

Flow:

```text
batchlet step:
  compute messages/events/files to send
  write outbox records transactionally
  return COMPLETED

outbox dispatcher:
  send externally with retry/idempotency
```

Kapan ini lebih baik:

- external side effect butuh retry independen,
- batch tidak boleh menunggu API lambat,
- downstream punya rate limit,
- audit side effect harus kuat,
- perlu decouple compute dari delivery.

Contoh:

```java
@Override
public String process() throws Exception {
    List<NotificationCommand> commands = service.buildNotificationCommands();
    service.writeOutbox(commands);
    return commands.isEmpty() ? "NO_NOTIFICATION" : "COMPLETED";
}
```

Keuntungan:

- batchlet tetap bounded,
- external delivery punya worker terpisah,
- retry storm lebih mudah dikontrol,
- outbox bisa dipantau.

Trade-off:

- completion batchlet bukan berarti external delivery selesai,
- perlu status tambahan untuk end-to-end business completion.

---

## 31. Anti-Patterns

### 31.1 God Batchlet

Satu batchlet melakukan semua tahap besar.

Gejala:

- `process()` ratusan/ribuan baris,
- banyak `if/else` flow,
- sulit restart per fase,
- operator tidak tahu sedang di tahap mana.

Solusi:

- pecah menjadi beberapa step,
- gunakan JSL transition,
- gunakan decision jika perlu routing.

### 31.2 Manual Chunk in Batchlet

Loop jutaan row dalam batchlet.

Solusi:

- gunakan chunk step.

### 31.3 Non-Cooperative Stop

`stop()` kosong atau hanya log.

```java
@Override
public void stop() {
    log.info("stop requested");
}
```

Solusi:

- visible flag,
- safe point,
- timeout blocking call.

### 31.4 Long Transaction Batchlet

Satu transaksi untuk seluruh `process()`.

Solusi:

- transaction per bounded unit,
- chunk step jika item-oriented.

### 31.5 Duplicate Side Effects on Restart

Tidak ada idempotency key atau output uniqueness.

Solusi:

- business key,
- dedup table,
- outbox,
- reconciliation.

### 31.6 Scheduler as Batch Runtime

Scheduler menjalankan logic besar langsung.

Solusi:

- scheduler hanya trigger `JobOperator.start()`.

### 31.7 Swallowing Exceptions

```java
catch (Exception e) {
    log.error("failed", e);
    return "COMPLETED";
}
```

Solusi:

- klasifikasi error,
- return expected business exit status,
- throw unexpected technical failure.

### 31.8 Local-Only Progress

Progress disimpan di field memory.

Solusi:

- durable progress table,
- checkpoint-like design.

### 31.9 Hidden Threads

Batchlet membuat thread sendiri untuk parallelism.

Solusi:

- gunakan partitioning,
- managed executor dengan governance,
- atau external orchestration.

### 31.10 Path Injection

Job parameter langsung jadi filesystem path.

Solusi:

- allowlist logical location,
- canonical path validation,
- no arbitrary absolute path.

---

## 32. Decision Checklist: Batchlet atau Bukan?

Gunakan checklist ini sebelum memilih batchlet:

### Nature of Work

- [ ] Apakah workload adalah task utuh, bukan item stream besar?
- [ ] Apakah output/side effect punya boundary jelas?
- [ ] Apakah step bisa dijelaskan dalam satu kalimat?

### Stop

- [ ] Apakah `process()` punya safe points?
- [ ] Apakah blocking call punya timeout?
- [ ] Apakah `stop()` mengirim signal yang visible?
- [ ] Apakah cleanup aman jika stop terjadi?

### Restart

- [ ] Apakah progress penting disimpan durable?
- [ ] Apakah restart tidak mengulang side effect berbahaya?
- [ ] Apakah output final bisa dibedakan dari output partial?
- [ ] Apakah duplicate start dicegah dengan business key?

### Transaction

- [ ] Apakah tidak ada transaksi raksasa?
- [ ] Apakah transaction boundary kecil dan eksplisit?
- [ ] Apakah external side effect tidak dicampur naïf dengan DB transaction?

### Observability

- [ ] Apakah job/step/business key muncul di log?
- [ ] Apakah progress terlihat?
- [ ] Apakah metrics tersedia?
- [ ] Apakah audit menjawab siapa/kapan/apa/mengapa/hasil?

### Security

- [ ] Apakah parameter divalidasi?
- [ ] Apakah authorization start job jelas?
- [ ] Apakah sensitive value tidak masuk log?
- [ ] Apakah requestedBy dan executedBy dibedakan?

Jika banyak jawaban “tidak”, jangan langsung memakai batchlet. Ubah desainnya dulu.

---

## 33. End-to-End Mini Case Study: Regulatory Escalation Candidate Snapshot

### 33.1 Scenario

Sistem regulatory case management perlu membuat snapshot kandidat escalation setiap malam:

```text
- Ambil semua case aktif yang melewati SLA tertentu.
- Hitung severity dan ageing bucket.
- Simpan snapshot candidate list.
- Generate summary report.
- Tidak mengubah actual case state.
```

Ini bisa menjadi batchlet jika:

- hanya membuat snapshot aggregate,
- query/procedure sudah bounded,
- output satu snapshot per date,
- restart idempotent.

Jika harus memproses jutaan case item-by-item dengan skip/retry, gunakan chunk.

### 33.2 Business Key

```text
business_key = escalation-snapshot:{agency}:{snapshot_date}
```

### 33.3 Tables

```sql
CREATE TABLE ESCALATION_SNAPSHOT_RUN (
    BUSINESS_KEY      VARCHAR2(150) PRIMARY KEY,
    AGENCY_CODE       VARCHAR2(30) NOT NULL,
    SNAPSHOT_DATE     DATE NOT NULL,
    STATUS            VARCHAR2(30) NOT NULL,
    TOTAL_CANDIDATES  NUMBER,
    REPORT_PATH       VARCHAR2(500),
    CHECKSUM_SHA256   VARCHAR2(64),
    REQUESTED_BY      VARCHAR2(100),
    EXECUTED_BY       VARCHAR2(100),
    CREATED_AT        TIMESTAMP NOT NULL,
    UPDATED_AT        TIMESTAMP NOT NULL
);

CREATE TABLE ESCALATION_SNAPSHOT_ITEM (
    BUSINESS_KEY      VARCHAR2(150) NOT NULL,
    CASE_ID           VARCHAR2(100) NOT NULL,
    AGEING_DAYS       NUMBER NOT NULL,
    SEVERITY          VARCHAR2(30) NOT NULL,
    REASON_CODE       VARCHAR2(100) NOT NULL,
    CREATED_AT        TIMESTAMP NOT NULL,
    CONSTRAINT PK_ESC_SNAPSHOT_ITEM PRIMARY KEY (BUSINESS_KEY, CASE_ID)
);
```

### 33.4 Batchlet Skeleton

```java
@Named("escalationSnapshotBatchlet")
public class EscalationSnapshotBatchlet implements Batchlet {

    private final AtomicBoolean stopRequested = new AtomicBoolean(false);

    @Inject @BatchProperty(name = "agencyCode")
    private String agencyCode;

    @Inject @BatchProperty(name = "snapshotDate")
    private String snapshotDate;

    @Inject
    private EscalationSnapshotService service;

    @Override
    public String process() throws Exception {
        SnapshotRequest request = SnapshotRequest.parse(agencyCode, snapshotDate);

        SnapshotRun run = service.loadOrCreateRun(request);
        if (run.isCompletedAndValid()) {
            return "ALREADY_COMPLETED";
        }

        service.markRunning(request.businessKey());

        if (stopRequested.get()) {
            service.markStopped(request.businessKey());
            return "STOPPED";
        }

        service.rebuildSnapshotItems(request);

        if (stopRequested.get()) {
            service.markStopped(request.businessKey());
            return "STOPPED";
        }

        ReportOutput report = service.generateReport(request);
        service.markCompleted(request.businessKey(), report);

        return "COMPLETED";
    }

    @Override
    public void stop() {
        stopRequested.set(true);
    }
}
```

### 33.5 Safety Notes

`rebuildSnapshotItems` harus idempotent:

```text
delete snapshot items for business_key
insert deterministic snapshot items
```

Atau:

```text
insert merge/upsert by business_key + case_id
```

Output report:

```text
write temp -> checksum -> atomic publish final
```

Audit:

```text
BATCH_ESCALATION_SNAPSHOT_CREATED
business_key
agency
snapshot_date
total_candidates
checksum
requested_by
executed_by
```

Regulatory defensibility:

- snapshot tidak diam-diam mengubah case,
- candidate criteria tercatat,
- output bisa direkonstruksi,
- rerun punya key yang jelas,
- duplicate dicegah.

---

## 34. Practical Implementation Template

Berikut template batchlet production-oriented:

```java
@Named("templateTaskBatchlet")
public class TemplateTaskBatchlet implements Batchlet {

    private final AtomicBoolean stopRequested = new AtomicBoolean(false);

    @Inject @BatchProperty(name = "businessDate")
    private String businessDate;

    @Inject @BatchProperty(name = "scope")
    private String scope;

    @Inject
    private TemplateTaskService service;

    @Override
    public String process() throws Exception {
        TaskRequest request = validateAndBuildRequest();
        service.auditStarted(request);

        try {
            TaskState state = service.loadOrInitialize(request);

            if (state.completedAndValid()) {
                service.auditAlreadyCompleted(request);
                return "ALREADY_COMPLETED";
            }

            service.markRunning(request);

            String exitStatus = executeStopAware(request);

            service.auditFinished(request, exitStatus);
            return exitStatus;

        } catch (ExpectedBusinessException e) {
            service.auditBusinessFailure(request, e);
            return e.exitStatus();

        } catch (Exception e) {
            service.auditTechnicalFailure(request, e);
            throw e;
        }
    }

    private TaskRequest validateAndBuildRequest() {
        return TaskRequest.of(businessDate, scope);
    }

    private String executeStopAware(TaskRequest request) throws Exception {
        for (TaskPhase phase : service.phases(request)) {
            if (stopRequested.get()) {
                service.markStopped(request);
                return "STOPPED";
            }

            service.executePhase(request, phase);
        }

        return "COMPLETED";
    }

    @Override
    public void stop() {
        stopRequested.set(true);
        service.requestStop();
    }
}
```

Template service principles:

```java
public class TemplateTaskService {

    @Transactional
    public TaskState loadOrInitialize(TaskRequest request) {
        // create durable task row if absent
    }

    @Transactional
    public void markRunning(TaskRequest request) {
        // status transition with optimistic lock
    }

    @Transactional
    public void executePhase(TaskRequest request, TaskPhase phase) {
        // bounded, idempotent phase
    }

    @Transactional
    public void markStopped(TaskRequest request) {
        // record stop point
    }

    public void requestStop() {
        // cancel client/stream if supported; do not block too long
    }
}
```

---

## 35. Ringkasan Mental Model

Batchlet adalah pilihan yang kuat ketika kamu punya task batch yang:

- bukan stream item besar,
- punya task boundary jelas,
- butuh dijalankan dalam Jakarta Batch runtime,
- butuh operator visibility,
- butuh start/stop/restart semantics,
- butuh parameter dan audit.

Namun batchlet bukan shortcut untuk menghindari chunk model.

Ingat formula ini:

```text
Batchlet = task-oriented step + cooperative stop + explicit restart design + idempotent side effects + observable progress
```

Jika salah satu bagian hilang, batchlet masih bisa berjalan di dev, tetapi rapuh di production.

Top-tier engineer tidak bertanya hanya:

```text
Can I put this code in process()?
```

Mereka bertanya:

```text
What happens if this stops halfway?
What happens if it restarts?
What if operator clicks stop?
What if pod dies?
What if output already exists?
What if external API succeeded but DB update failed?
What if two executions start with same business key?
What evidence do we have for audit?
```

Jawaban atas pertanyaan-pertanyaan itulah yang membedakan batchlet sederhana dari batchlet enterprise-grade.

---

## 36. Latihan / Thought Experiment

### Latihan 1 — Batchlet atau Chunk?

Untuk setiap workload, tentukan apakah lebih cocok batchlet atau chunk:

1. Generate satu file PDF monthly summary.
2. Update 5 juta customer record berdasarkan rule baru.
3. Delete temporary file lebih tua dari 30 hari.
4. Call external API untuk 200.000 postal code.
5. Validate satu manifest file berisi daftar file input.
6. Recalculate aggregate case ageing by agency using stored procedure.

Jelaskan alasan berdasarkan:

- unit kerja,
- checkpoint,
- restartability,
- side effect,
- observability.

### Latihan 2 — Stop Design

Desain stop-aware batchlet untuk:

```text
archive old correspondence files to object storage
```

Tentukan:

- safe point,
- stop flag,
- timeout,
- durable progress,
- idempotency key,
- final audit event.

### Latihan 3 — Restart Failure

Sebuah batchlet:

```text
1. generate report file
2. upload to external document system
3. update database with document id
```

Crash terjadi setelah upload sukses tetapi sebelum DB update.

Pertanyaan:

- bagaimana restart mendeteksi apakah upload sudah terjadi?
- key apa yang harus dipakai?
- apakah perlu reconciliation API?
- apa status yang ditampilkan ke operator?

### Latihan 4 — Regulatory Defensibility

Untuk batchlet `escalationSnapshotBatchlet`, rancang audit event yang cukup untuk menjawab:

- siapa yang memulai job,
- parameter apa yang dipakai,
- rule version apa yang digunakan,
- berapa candidate yang dihasilkan,
- output mana yang dipublikasikan,
- apakah ada rerun,
- apakah hasil rerun sama atau berbeda.

---

## 37. Checklist Produksi Batchlet

Sebelum deploy batchlet ke production:

- [ ] Nama job dan step jelas.
- [ ] JSL menunjukkan flow, bukan seluruh logic tersembunyi di code.
- [ ] Parameter divalidasi.
- [ ] Authorization start job jelas.
- [ ] Business key didefinisikan.
- [ ] Duplicate logical job dicegah.
- [ ] `stop()` implemented.
- [ ] `process()` mengecek stop flag.
- [ ] Blocking calls punya timeout.
- [ ] Transaksi kecil dan bounded.
- [ ] Side effect idempotent atau punya reconciliation.
- [ ] Output partial tidak dipublikasikan sebagai final.
- [ ] Restart behavior dites.
- [ ] Crash behavior dites.
- [ ] Metrics tersedia.
- [ ] Logs punya correlation/job/step/business key.
- [ ] Audit event tersedia.
- [ ] Sensitive data tidak masuk logs/parameters.
- [ ] Cluster/pod failure dipertimbangkan.
- [ ] Operator tahu kapan harus restart vs abandon vs manual review.

---

## 38. Koneksi ke Part Berikutnya

Part ini membahas `Batchlet`, yaitu model task-oriented.

Part berikutnya akan membahas model yang lebih cocok untuk high-volume item processing:

```text
Part 20 — Chunk-Oriented Processing: Reader, Processor, Writer
```

Di sana fokusnya akan bergeser dari:

```text
one task with explicit stop/restart design
```

menjadi:

```text
many items processed through reader -> processor -> writer with checkpoint, transaction boundary, skip/retry, and commit interval
```

---

## 39. Referensi Resmi dan Rujukan Lanjutan

- Jakarta Batch 2.1 Specification — API, JSL, runtime model, batchlet/chunk concepts.
- Jakarta Batch 2.1 API — `jakarta.batch.api.Batchlet`, `process()`, `stop()`.
- Jakarta EE 11 Release — Jakarta Batch 2.1 included in platform.
- Jakarta Batch project page — overview of Java API and XML-based Job Specification Language.
- Jakarta Batch 2.2 / Jakarta EE 12 — under development; treat as future-facing, not production baseline unless using compatible implementation knowingly.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./18-jsl-job-specification-language-execution-graph.md">⬅️ Part 18 — JSL Deep Dive: Job XML as Execution Graph</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./20-chunk-oriented-processing-reader-processor-writer.md">Part 20 — Chunk-Oriented Processing: Reader, Processor, Writer ➡️</a>
</div>
