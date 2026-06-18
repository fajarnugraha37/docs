# Part 27 — Batch Listeners and Cross-Cutting Behavior

> Series: `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
> File: `27-batch-listeners-cross-cutting-behavior.md`  
> Scope: Java 8–25, Java EE/Jakarta EE Batch, Jakarta Batch 2.x, enterprise production workload design.

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Memahami listener Jakarta Batch sebagai **lifecycle interception point**, bukan sekadar callback teknis.
2. Membedakan listener yang tepat untuk:
   - observability,
   - audit,
   - cleanup,
   - notification,
   - error enrichment,
   - runtime diagnostics,
   - business rule extension.
3. Mengetahui jenis-jenis listener pada Jakarta Batch:
   - `JobListener`,
   - `StepListener`,
   - `ChunkListener`,
   - `ItemReadListener`,
   - `ItemProcessListener`,
   - `ItemWriteListener`,
   - `SkipReadListener`,
   - `SkipProcessListener`,
   - `SkipWriteListener`,
   - `RetryReadListener`,
   - `RetryProcessListener`,
   - `RetryWriteListener`,
   - partition-related listener/collaboration interfaces.
4. Mendesain listener yang aman terhadap:
   - transaction boundary,
   - restart,
   - retry,
   - skip,
   - duplicate invocation,
   - failure during listener execution,
   - cluster execution,
   - audit correctness.
5. Menghindari anti-pattern umum: **business logic hidden in listener**.
6. Menyusun listener sebagai bagian dari **batch observability and governance layer**.

---

## 2. Problem yang Diselesaikan

Dalam batch production, kita tidak cukup hanya tahu bahwa job selesai atau gagal. Kita perlu tahu:

- job dimulai oleh siapa,
- parameter apa yang digunakan,
- input apa yang diproses,
- step mana yang lambat,
- chunk mana yang gagal,
- item mana yang di-skip,
- retry terjadi karena apa,
- output apa yang dihasilkan,
- apakah cleanup berjalan,
- apakah failure meninggalkan partial side effect,
- apakah job bisa di-restart dengan aman,
- apakah audit evidence cukup untuk investigasi.

Jika semua itu dimasukkan ke dalam reader/processor/writer, core batch logic menjadi kotor. Jika semua itu dimasukkan ke dalam service bisnis, service menjadi terlalu sadar detail batch lifecycle.

**Listener menyelesaikan problem ini dengan memberi hook pada titik lifecycle tertentu.**

Namun listener juga membawa risiko besar:

- listener dipanggil berkali-kali karena retry/restart,
- listener bisa berjalan dalam transaction boundary tertentu,
- listener failure bisa menggagalkan job,
- listener bisa diam-diam melakukan side effect non-idempotent,
- listener bisa membuat behavior batch sulit dipahami karena logic tersebar.

Jadi listener harus diperlakukan sebagai **cross-cutting extension point with strict boundaries**.

---

## 3. Mental Model

### 3.1 Listener adalah observer terhadap lifecycle, bukan pemilik lifecycle

Bayangkan Jakarta Batch runtime seperti state machine:

```text
Job
 ├── beforeJob
 ├── Step A
 │    ├── beforeStep
 │    ├── beforeChunk
 │    │    ├── beforeRead / afterRead / onReadError
 │    │    ├── beforeProcess / afterProcess / onProcessError
 │    │    ├── beforeWrite / afterWrite / onWriteError
 │    │    ├── retry callbacks
 │    │    ├── skip callbacks
 │    │    └── commit / rollback
 │    ├── afterChunk or onError
 │    └── afterStep
 ├── Step B
 └── afterJob
```

Listener mengamati atau memperkaya titik-titik ini.

Core principle:

```text
Reader/Processor/Writer/Batchlet = domain work
Listener                         = lifecycle side concern
JobOperator/control plane         = runtime governance
Job repository                    = execution state
Audit store                       = defensible evidence
Metrics/tracing                   = operational visibility
```

Jika listener mulai menentukan hasil bisnis utama, biasanya desain mulai kabur.

---

### 3.2 Listener bukan transaction-free zone

Listener tidak boleh diasumsikan selalu di luar transaksi atau selalu di dalam transaksi. Behavior detail bisa bergantung pada jenis listener, implementasi runtime, dan titik eksekusi.

Prinsip aman:

```text
Do not perform irreversible side effects in listener
unless the side effect is idempotent, audited, and safe under retry/restart.
```

Contoh side effect berisiko:

- mengirim email di `afterWrite`,
- memanggil external API di `afterProcess`,
- menghapus file di `afterStep`,
- menandai job sebagai success di sistem eksternal dari `afterJob`,
- menulis audit final tanpa mempertimbangkan restart.

Lebih aman:

- listener mencatat event ke durable outbox,
- outbox diproses terpisah secara idempotent,
- status final dihitung dari repository + audit state,
- external notification memakai idempotency key.

---

### 3.3 Listener adalah tempat bagus untuk telemetry, buruk untuk business mutation

Listener ideal untuk:

- metrics,
- trace span,
- structured log,
- audit event,
- cleanup resource teknis,
- diagnostic enrichment,
- counting skipped/retried items,
- progress snapshot,
- notification request enqueue.

Listener buruk untuk:

- rule utama validasi bisnis,
- menentukan record mana boleh diproses,
- mengubah aggregate bisnis utama,
- melakukan irreversible external side effect,
- menjalankan workflow kompleks,
- menyembunyikan branching logic yang tidak terlihat di JSL.

---

## 4. Jenis Listener dalam Jakarta Batch

Jakarta Batch menyediakan listener untuk beberapa level lifecycle.

### 4.1 Job-level listener

Digunakan untuk lifecycle seluruh job.

Konsep:

```java
public class MyJobListener implements JobListener {
    @Override
    public void beforeJob() throws Exception {
        // job is about to start
    }

    @Override
    public void afterJob() throws Exception {
        // job has finished, failed, stopped, etc.
    }
}
```

Use case:

- mencatat job started/completed,
- membuat root trace/correlation,
- membaca job parameters untuk audit,
- membuat execution manifest,
- mengirim notification final,
- menghitung summary final,
- cleanup global.

Hati-hati:

- `afterJob` bukan berarti success; cek batch status/exit status.
- `afterJob` bisa terpanggil untuk job failed/stopped.
- Jika job di-restart, job execution baru dapat memiliki listener invocation baru.
- Jangan asumsikan satu job instance hanya punya satu `afterJob` sepanjang waktu.

---

### 4.2 Step-level listener

Digunakan untuk lifecycle per step.

```java
public class MyStepListener implements StepListener {
    @Override
    public void beforeStep() throws Exception {
        // step is about to start
    }

    @Override
    public void afterStep() throws Exception {
        // step ended
    }
}
```

Use case:

- step metrics,
- step-level audit,
- setup resource step,
- cleanup resource step,
- computing step summary,
- persisting step manifest,
- validating step precondition.

Hati-hati:

- step bisa gagal sebelum memproses item.
- step bisa restart.
- partitioned step dapat memiliki beberapa execution context.
- cleanup harus idempotent.

---

### 4.3 Chunk-level listener

Digunakan untuk lifecycle chunk.

```java
public class MyChunkListener implements ChunkListener {
    @Override
    public void beforeChunk() throws Exception {
        // before chunk transaction/work begins
    }

    @Override
    public void afterChunk() throws Exception {
        // after chunk successfully completes
    }

    @Override
    public void onError(Exception ex) throws Exception {
        // chunk error occurred
    }
}
```

Use case:

- chunk duration metrics,
- chunk throughput measurement,
- chunk retry/rollback diagnostics,
- progress sampling,
- memory pressure observation,
- transaction failure diagnosis.

Hati-hati:

- chunk can be retried.
- `afterChunk` is not a place for non-idempotent business side effects.
- `onError` may fire many times for the same logical item/chunk depending on retry.

---

### 4.4 Item read listener

Titik hook sekitar pembacaan item.

```java
public class MyReadListener implements ItemReadListener {
    @Override
    public void beforeRead() throws Exception {}

    @Override
    public void afterRead(Object item) throws Exception {}

    @Override
    public void onReadError(Exception ex) throws Exception {}
}
```

Use case:

- count read attempts,
- log malformed input,
- capture source offset,
- record file line number,
- diagnose reader bottleneck.

Hati-hati:

- reader error bisa terjadi sebelum item terbentuk.
- jangan akses item detail kalau item belum valid.
- read retry dapat membuat callback muncul lebih dari sekali.

---

### 4.5 Item process listener

Titik hook sekitar transformasi/validasi item.

```java
public class MyProcessListener implements ItemProcessListener {
    @Override
    public void beforeProcess(Object item) throws Exception {}

    @Override
    public void afterProcess(Object item, Object result) throws Exception {}

    @Override
    public void onProcessError(Object item, Exception ex) throws Exception {}
}
```

Use case:

- processing duration per item type,
- validation error audit,
- counting filtered item,
- diagnostic context for bad records,
- rule failure classification.

Hati-hati:

- processor may return `null` to filter item.
- item may be processed again after rollback/retry.
- do not mutate input in listener unless explicitly designed.

---

### 4.6 Item write listener

Titik hook sekitar penulisan chunk.

```java
public class MyWriteListener implements ItemWriteListener {
    @Override
    public void beforeWrite(List<Object> items) throws Exception {}

    @Override
    public void afterWrite(List<Object> items) throws Exception {}

    @Override
    public void onWriteError(List<Object> items, Exception ex) throws Exception {}
}
```

Use case:

- write batch size metrics,
- write latency,
- failed chunk diagnostics,
- DB/external writer error enrichment,
- output manifest update.

Hati-hati:

- `afterWrite` can be before or around transaction completion depending on runtime semantics; do not assume irreversible commit to external world.
- if transaction rolls back after listener side effect, audit/notification can lie.
- do not send one email per item here.

---

### 4.7 Skip listeners

Skip listener dipanggil ketika item dilewati karena konfigurasi skip.

Jenis umum:

- skip read,
- skip process,
- skip write.

Use case:

- record skipped item,
- classify invalid input,
- write error report,
- update skip counters,
- generate regulatory evidence for partial success.

Hati-hati:

- skipped item tetap harus bisa dilacak.
- jangan hanya log text bebas; gunakan structured error record.
- skip harus menjawab: “kenapa record ini tidak diproses, siapa yang mengizinkan, dan apakah boleh diproses ulang?”

---

### 4.8 Retry listeners

Retry listener dipakai untuk observe retry attempt.

Use case:

- count transient failure,
- detect retry storm,
- capture downstream instability,
- measure eventual recovery,
- classify retryable error.

Hati-hati:

- retry listener bisa sangat noisy.
- log per retry tanpa sampling bisa membanjiri log.
- retry event bukan final failure.
- retry side effect harus idempotent.

---

### 4.9 Partition-related callbacks and collaborators

Partitioning memiliki interface tambahan seperti:

- partition mapper,
- partition plan,
- partition collector,
- partition analyzer,
- partition reducer.

Mereka bukan listener dalam arti sederhana, tetapi sering berperan sebagai cross-cutting coordination hooks.

Use case:

- collect partition metrics,
- aggregate partition exit status,
- detect skew,
- decide final step result,
- coordinate partial failure.

Hati-hati:

- partition callbacks harus aman terhadap parallel execution.
- aggregation harus deterministic.
- jangan bergantung pada ordering kecuali dijamin oleh desain sendiri.

---

## 5. Listener Declaration di JSL

Listener biasanya dideklarasikan di JSL pada level job/step/chunk.

Contoh konseptual:

```xml
<job id="case-ageing-recalculation" xmlns="https://jakarta.ee/xml/ns/jakartaee" version="2.1">

    <listeners>
        <listener ref="jobAuditListener"/>
        <listener ref="jobMetricsListener"/>
    </listeners>

    <step id="load-cases">
        <listeners>
            <listener ref="stepAuditListener"/>
            <listener ref="stepMetricsListener"/>
        </listeners>

        <chunk item-count="100">
            <reader ref="caseReader"/>
            <processor ref="caseProcessor"/>
            <writer ref="caseWriter"/>

            <listeners>
                <listener ref="chunkMetricsListener"/>
                <listener ref="skipAuditListener"/>
                <listener ref="retryMetricsListener"/>
            </listeners>
        </chunk>
    </step>
</job>
```

Mental model:

```text
JSL declares where listener attaches.
Implementation decides what listener does.
Governance decides what listener is allowed to do.
```

---

## 6. Listener dan Dependency Injection

Dalam Jakarta EE, listener bisa menjadi artifact yang dikelola container tergantung runtime dan konfigurasi.

Contoh:

```java
@Named("jobAuditListener")
public class JobAuditListener implements JobListener {

    @Inject
    AuditService auditService;

    @Inject
    JobContext jobContext;

    @Override
    public void beforeJob() {
        auditService.recordJobStarted(jobContext.getExecutionId());
    }

    @Override
    public void afterJob() {
        auditService.recordJobFinished(jobContext.getExecutionId(), jobContext.getBatchStatus());
    }
}
```

Prinsip:

- listener boleh memakai service, tetapi service harus batch-safe.
- jangan menyimpan mutable state instance jika listener bisa reused atau dipakai concurrent.
- gunakan `JobContext` dan `StepContext` untuk execution-specific state.
- jangan mengandalkan static mutable state.

---

## 7. JobContext dan StepContext dalam Listener

`JobContext` dan `StepContext` menyediakan akses ke execution context.

Contoh konseptual:

```java
@Inject
JobContext jobContext;

@Inject
StepContext stepContext;
```

Informasi yang umum dibutuhkan:

- job name,
- execution id,
- batch status,
- exit status,
- transient user data,
- step name,
- step metrics,
- persistent user data.

Mental model:

```text
JobContext = identity and state of current job execution
StepContext = identity and state of current step execution
```

Namun jangan mencampur:

```text
context data != business database state
context data != audit evidence by itself
context data != external side-effect guarantee
```

Untuk audit production, context digunakan untuk menghubungkan event, bukan sebagai satu-satunya evidence store.

---

## 8. Listener Ordering

Jika beberapa listener dipasang pada lifecycle point yang sama, ordering bisa menjadi isu penting.

Contoh:

```xml
<listeners>
    <listener ref="correlationListener"/>
    <listener ref="metricsListener"/>
    <listener ref="auditListener"/>
</listeners>
```

Pertanyaan desain:

- Apakah listener B bergantung pada state yang dibuat listener A?
- Apakah ordering dijamin oleh spesifikasi/runtime?
- Apakah jika listener A gagal, listener B tetap boleh berjalan?
- Apakah listener harus composable?

Best practice:

```text
Listener should not depend on another listener's side effects unless explicitly documented and tested.
```

Lebih baik:

- satu listener orchestration kecil memanggil component internal secara deterministic,
- atau gunakan service komposit,
- atau deklarasikan dependency secara eksplisit di kode, bukan implisit dari urutan XML.

Contoh lebih aman:

```java
@Named("batchLifecycleObserver")
public class BatchLifecycleObserver implements JobListener {

    @Inject CorrelationService correlationService;
    @Inject MetricsService metricsService;
    @Inject BatchAuditService auditService;

    @Override
    public void beforeJob() {
        correlationService.initializeForCurrentJob();
        metricsService.jobStarted();
        auditService.jobStarted();
    }

    @Override
    public void afterJob() {
        try {
            metricsService.jobFinished();
        } finally {
            auditService.jobFinished();
            correlationService.clear();
        }
    }
}
```

---

## 9. Transaction Boundary dan Listener Side Effects

### 9.1 Problem

Listener sering dipakai untuk menulis audit:

```java
@Override
public void afterWrite(List<Object> items) {
    auditService.recordWritten(items);
}
```

Kelihatannya benar. Tapi ada pertanyaan kritis:

- Apakah write sudah committed?
- Apakah audit berada di transaction yang sama?
- Jika audit berhasil tapi chunk rollback, audit menjadi salah?
- Jika chunk berhasil tapi audit gagal, apakah job gagal?
- Jika job restart, apakah audit double?

### 9.2 Model yang lebih aman

Untuk item/chunk event:

```text
core write happens inside chunk transaction
listener records minimal idempotent technical event
final audit is derived from durable committed state
```

Contoh pola:

```java
@Override
public void afterWrite(List<Object> items) {
    for (Object item : items) {
        progressRecorder.markAttemptedWrite(currentExecutionId(), stableItemKey(item));
    }
}
```

Tapi untuk audit final:

```text
derive from:
- business table committed rows,
- job repository final status,
- error/skip table,
- output manifest,
- item-level idempotency table.
```

### 9.3 Outbox pattern untuk side effect

Jika listener perlu mengirim notification:

Jangan:

```java
@Override
public void afterJob() {
    emailClient.send("Batch complete");
}
```

Lebih aman:

```java
@Override
public void afterJob() {
    notificationOutbox.enqueueIfAbsent(
        "BATCH_JOB_FINISHED",
        jobContext.getExecutionId(),
        buildPayload()
    );
}
```

Lalu worker terpisah mengirim email secara idempotent.

---

## 10. Error Handling dalam Listener

Listener bisa throw exception. Ini berbahaya karena listener yang tadinya hanya observability dapat menggagalkan job.

### 10.1 Klasifikasi listener failure

| Jenis listener | Jika gagal, job harus gagal? | Contoh |
|---|---:|---|
| Security precondition | Ya | user tidak authorized menjalankan job |
| Input manifest validation | Ya | checksum input tidak valid |
| Metrics emission | Tidak | Prometheus push gagal |
| Debug logging | Tidak | log sink lambat |
| Audit mandatory | Tergantung regulasi | audit DB down |
| Notification | Biasanya tidak | email gagal |
| Cleanup temporary resource | Tergantung dampak | file lock tidak dilepas |

### 10.2 Fail-open vs fail-closed

Untuk setiap listener, tentukan policy:

```text
fail-closed: listener failure fails job
fail-open: listener failure logged but job continues
fail-deferred: listener failure creates remediation task
```

Contoh fail-open metrics:

```java
@Override
public void afterChunk() {
    try {
        metricsService.recordChunkCompleted();
    } catch (Exception ex) {
        logger.warn("Failed to record chunk metric", ex);
    }
}
```

Contoh fail-closed precondition:

```java
@Override
public void beforeStep() throws Exception {
    if (!inputManifestService.isValid()) {
        throw new IllegalStateException("Input manifest is invalid");
    }
}
```

### 10.3 Jangan swallow semua exception secara membabi-buta

Anti-pattern:

```java
try {
    doEverything();
} catch (Exception ignored) {
}
```

Ini membuat audit hilang dan diagnosis mustahil.

Lebih baik:

```java
try {
    auditService.recordEvent(event);
} catch (Exception ex) {
    logger.error("Mandatory audit event failed: {}", event.id(), ex);
    throw ex;
}
```

atau:

```java
try {
    metricsService.emit(metric);
} catch (Exception ex) {
    logger.warn("Optional metric emission failed: {}", metric.name(), ex);
}
```

---

## 11. Idempotency dalam Listener

Karena listener bisa terpanggil ulang saat retry/restart, side effect listener harus idempotent.

### 11.1 Idempotency key

Gunakan key stabil:

```text
jobExecutionId + stepExecutionId + chunkSequence
jobInstanceId + stepName + partitionId + itemBusinessKey + eventType
fileName + lineNumber + eventType
externalCorrelationId + eventType
```

Contoh:

```java
public void recordSkip(String itemKey, String reason) {
    String idempotencyKey = String.join(":",
        jobContext.getExecutionId().toString(),
        stepContext.getStepName(),
        itemKey,
        "SKIPPED"
    );

    skipAuditRepository.insertIfAbsent(idempotencyKey, itemKey, reason);
}
```

### 11.2 Jangan pakai timestamp sebagai identity

Buruk:

```text
skip-2026-06-17T10:15:23.392Z
```

Timestamp berubah saat retry.

Lebih baik:

```text
jobInstance=CASE_RECALC_2026_06_17
step=validate-case
item=CASE-2026-000123
event=SKIPPED
```

---

## 12. Listener untuk Metrics

### 12.1 Metrics minimal

Job-level:

- job started count,
- job completed count,
- job failed count,
- job stopped count,
- job duration,
- job active gauge.

Step-level:

- step duration,
- step status,
- read count,
- process count,
- write count,
- skip count,
- retry count,
- rollback count.

Chunk-level:

- chunk duration,
- chunk size,
- chunk success/failure,
- write duration,
- commit latency if measurable.

Item-level, hati-hati cardinality:

- item type,
- error category,
- source type,
- not item id as metric label.

### 12.2 Cardinality trap

Buruk:

```text
batch_item_failed_total{caseId="CASE-2026-000123"}
```

Jika ada jutaan case, metric backend rusak.

Lebih baik:

```text
batch_item_failed_total{job="case-ageing", step="validate", reason="INVALID_STATUS"}
```

Detail item masuk audit/error table, bukan metric label.

### 12.3 Contoh metrics listener

```java
@Named("stepMetricsListener")
public class StepMetricsListener implements StepListener {

    @Inject StepContext stepContext;
    @Inject BatchMetrics metrics;

    private long startedAtNanos;

    @Override
    public void beforeStep() {
        startedAtNanos = System.nanoTime();
        metrics.incrementStepStarted(stepContext.getStepName());
    }

    @Override
    public void afterStep() {
        long durationNanos = System.nanoTime() - startedAtNanos;
        metrics.recordStepDuration(stepContext.getStepName(), durationNanos);
        metrics.incrementStepFinished(
            stepContext.getStepName(),
            String.valueOf(stepContext.getBatchStatus())
        );
    }
}
```

Caveat:

- Jika listener instance reused, field mutable bisa salah.
- Lebih aman simpan start time di `StepContext` transient user data jika tersedia/tepat.
- Untuk partitioned/concurrent step, pastikan state tidak shared.

---

## 13. Listener untuk Audit

### 13.1 Audit berbeda dari log

Log menjawab:

```text
Apa yang terjadi secara teknis?
```

Audit menjawab:

```text
Apa yang terjadi secara bisnis/operasional, siapa/apa yang memulai, atas otorisasi apa, input-output apa, dan apakah evidence cukup untuk dipertanggungjawabkan?
```

### 13.2 Job audit event minimal

Job started:

```json
{
  "eventType": "BATCH_JOB_STARTED",
  "jobName": "case-ageing-recalculation",
  "jobInstanceId": "case-ageing-2026-06-17",
  "jobExecutionId": 88421,
  "requestedBy": "fajar",
  "approvedBy": "ops-lead",
  "parametersHash": "sha256:...",
  "inputManifestId": "manifest-20260617-001",
  "correlationId": "corr-...",
  "occurredAt": "2026-06-17T10:00:00Z"
}
```

Job completed:

```json
{
  "eventType": "BATCH_JOB_COMPLETED",
  "jobExecutionId": 88421,
  "batchStatus": "COMPLETED",
  "exitStatus": "COMPLETED_WITH_SKIPS",
  "readCount": 100000,
  "writeCount": 99920,
  "skipCount": 80,
  "outputManifestId": "out-20260617-001",
  "occurredAt": "2026-06-17T10:18:33Z"
}
```

### 13.3 Audit listener pattern

```java
@Named("jobAuditListener")
public class JobAuditListener implements JobListener {

    @Inject JobContext jobContext;
    @Inject BatchAuditService auditService;

    @Override
    public void beforeJob() {
        auditService.recordJobStarted(
            JobStartedEvent.from(jobContext)
        );
    }

    @Override
    public void afterJob() {
        auditService.recordJobEnded(
            JobEndedEvent.from(jobContext)
        );
    }
}
```

Audit service harus punya:

- idempotency key,
- immutable append-only event design,
- parameter masking,
- payload size control,
- failure policy jelas.

---

## 14. Listener untuk Correlation dan MDC

Batch job sering berjalan di luar request thread. Jadi correlation harus dibuat atau dibawa dari job request.

### 14.1 Correlation source

Sumber correlation:

- request yang start job,
- job request table,
- scheduler trigger,
- file manifest,
- external event,
- generated job execution correlation.

### 14.2 MDC pattern

```java
@Named("correlationListener")
public class CorrelationListener implements JobListener {

    @Inject JobContext jobContext;
    @Inject CorrelationRepository correlationRepository;

    @Override
    public void beforeJob() {
        String correlationId = correlationRepository.findOrCreate(jobContext.getExecutionId());
        MDC.put("correlationId", correlationId);
        MDC.put("jobExecutionId", String.valueOf(jobContext.getExecutionId()));
        MDC.put("jobName", jobContext.getJobName());
    }

    @Override
    public void afterJob() {
        MDC.remove("jobName");
        MDC.remove("jobExecutionId");
        MDC.remove("correlationId");
    }
}
```

Caveat:

- MDC berbasis `ThreadLocal`.
- Batch runtime bisa menjalankan step/partition/chunk pada thread berbeda.
- Untuk parallel processing, correlation perlu dipasang di listener yang lebih dekat dengan execution thread, bukan hanya `beforeJob`.
- Jika memakai virtual threads, jangan asumsikan semua library ThreadLocal behavior ideal; uji propagation.

---

## 15. Listener untuk Notification

Notification umum:

- job started,
- job failed,
- job completed with skips,
- job stopped,
- job exceeded SLA,
- partition failed,
- input invalid.

### 15.1 Jangan kirim langsung dari listener bila tidak idempotent

Buruk:

```java
@Override
public void afterJob() {
    slackClient.send("Job done");
}
```

Masalah:

- listener retry dapat mengirim duplikat,
- network failure menggagalkan job,
- notification sukses tapi job transaction/audit belum final,
- sulit di-replay.

Lebih baik:

```java
@Override
public void afterJob() {
    notificationOutbox.enqueueIfAbsent(
        NotificationEvent.jobFinished(jobContext)
    );
}
```

### 15.2 Notification severity

| Event | Severity | Channel |
|---|---|---|
| job completed success | info | dashboard/email digest |
| completed with skips | warning | ops channel + report |
| job failed | error | pager/ops channel |
| stop requested | info/warning | audit + ops |
| retry storm | warning | alert |
| audit write failed | critical | pager |

---

## 16. Listener untuk Resource Setup dan Cleanup

Listener sering dipakai untuk setup/cleanup:

- create temp directory,
- open technical resource,
- prepare output manifest,
- acquire lock,
- release lock,
- move file from staging to archive/quarantine,
- close diagnostic scope.

### 16.1 Cleanup must be idempotent

Contoh:

```java
@Override
public void afterStep() {
    tempFileService.deleteIfExists(stepTempDirectory());
}
```

Bukan:

```java
@Override
public void afterStep() {
    Files.delete(path); // throws if already deleted
}
```

### 16.2 Cleanup must respect failure state

Jika step gagal, file mungkin harus masuk quarantine, bukan dihapus.

```java
@Override
public void afterStep() {
    if (stepContext.getBatchStatus() == BatchStatus.COMPLETED) {
        fileService.archive(inputFile());
    } else {
        fileService.quarantine(inputFile(), failureReason());
    }
}
```

### 16.3 Jangan release lock sembarangan

Jika lock memiliki ownership token:

```java
lockService.releaseIfOwner(lockName, ownerToken);
```

Bukan:

```java
lockService.release(lockName);
```

Karena pada cluster, node lain mungkin sudah mengambil lock baru.

---

## 17. Listener dalam Partitioned Step

Partitioned step mengubah semua asumsi listener:

- multiple partitions run concurrently,
- callbacks can happen in parallel,
- ordering is not globally deterministic,
- counters must be thread-safe or partition-local,
- aggregation must be explicit.

### 17.1 Wrong model

```text
There is one step, so there is one listener state.
```

### 17.2 Better model

```text
There is one logical step,
but many partition executions.
Each partition needs local state,
and final aggregation must be deterministic.
```

### 17.3 Partition-safe metrics

Avoid mutable shared field:

```java
private int readCount;
```

Better:

```java
metrics.increment("read", tagsForCurrentPartition());
```

or use partition-local context:

```java
stepContext.setTransientUserData(new PartitionMetrics());
```

with caution around runtime behavior.

---

## 18. Listener dan Restart Semantics

Restart adalah tempat banyak listener bug muncul.

### 18.1 What can happen on restart

- job execution id changes,
- job instance may be same,
- completed step may be skipped depending on restart behavior,
- failed step may execute again,
- listener for repeated step can fire again,
- item-level listener can fire for item already partially handled,
- output/audit/notification can duplicate if not idempotent.

### 18.2 Restart-safe listener invariant

```text
For every listener side effect, repeated invocation must either:
1. produce the same final state, or
2. be safely ignored, or
3. create a new explicitly versioned attempt record.
```

### 18.3 Attempt vs fact

Bedakan:

```text
ATTEMPTED_TO_WRITE item X
COMMITTED item X
SKIPPED item X
NOTIFIED job finished
```

Jika listener hanya tahu attempt, jangan catat sebagai final fact.

---

## 19. Listener dan Skip/Retry Detail

### 19.1 Skip audit record

Untuk skipped item, simpan:

- job instance id,
- job execution id,
- step name,
- partition id,
- item key,
- source location,
- exception class,
- normalized reason code,
- raw error message sanitized,
- occurred at,
- retry attempts before skip,
- operator action required.

### 19.2 Retry metric

Untuk retry, simpan agregat:

- retry count by exception category,
- retry count by step,
- retry success-after-n-attempts,
- retry exhausted count,
- downstream dependency name.

Jangan simpan high-cardinality item id sebagai metric label.

### 19.3 Poison item detection

Jika item yang sama selalu gagal:

```text
retry attempts exhausted -> skip if allowed -> error report -> optional quarantine
```

Jika tidak boleh skip:

```text
retry attempts exhausted -> step failure -> job failure -> operator remediation
```

Listener membantu evidence, bukan mengganti policy.

---

## 20. Listener dan Exit Status

Listener kadang ingin mengubah exit status.

Contoh:

```java
@Override
public void afterStep() {
    if (hasSkips()) {
        stepContext.setExitStatus("COMPLETED_WITH_SKIPS");
    }
}
```

Ini bisa valid, tetapi harus hati-hati.

### 20.1 Exit status is a contract

Exit status dipakai oleh:

- JSL transition,
- operator dashboard,
- audit report,
- restart decision,
- notification severity,
- downstream job.

Jadi exit status harus:

- stable,
- documented,
- finite set,
- tested,
- not arbitrary exception message.

### 20.2 Good exit status vocabulary

```text
COMPLETED
COMPLETED_WITH_SKIPS
COMPLETED_WITH_WARNINGS
FAILED_INPUT_VALIDATION
FAILED_DOWNSTREAM_UNAVAILABLE
FAILED_DATA_CONFLICT
STOPPED_BY_OPERATOR
STOPPED_BY_SLA_WINDOW
```

Bad:

```text
Error at line 123 because blah blah NullPointerException...
```

Detail masuk error table/log, bukan exit status.

---

## 21. Cross-Cutting Listener Architecture

Untuk production system, hindari listener tersebar tanpa pola.

### 21.1 Suggested architecture

```text
JSL
 └── lifecycle listener references
       ├── BatchCorrelationListener
       ├── BatchMetricsListener
       ├── BatchAuditListener
       ├── BatchNotificationListener
       └── BatchResourceCleanupListener

Listener
 └── small adapter from Jakarta Batch lifecycle to internal service

Internal services
 ├── AuditService
 ├── MetricsService
 ├── NotificationOutbox
 ├── ManifestService
 ├── ErrorReportService
 └── LockService
```

### 21.2 Listener should be thin

Listener should:

- read context,
- create event object,
- call service,
- apply failure policy.

Listener should not:

- contain complex business branching,
- query many unrelated tables,
- call external APIs directly,
- do large transformations,
- manage big mutable state.

---

## 22. Example: Production-Grade Skip Audit Listener

### 22.1 Error event model

```java
public record BatchItemErrorEvent(
    String idempotencyKey,
    long jobExecutionId,
    String jobName,
    String stepName,
    String itemKey,
    String sourceLocation,
    String phase,
    String reasonCode,
    String exceptionClass,
    String sanitizedMessage
) {}
```

### 22.2 Listener

```java
@Named("skipAuditListener")
public class SkipAuditListener implements SkipProcessListener {

    @Inject JobContext jobContext;
    @Inject StepContext stepContext;
    @Inject BatchErrorAuditService errorAuditService;
    @Inject ItemKeyExtractor itemKeyExtractor;
    @Inject ErrorClassifier errorClassifier;

    @Override
    public void onSkipProcessItem(Object item, Exception ex) throws Exception {
        String itemKey = itemKeyExtractor.extract(item);
        String reasonCode = errorClassifier.classify(ex);

        String idempotencyKey = String.join(":",
            String.valueOf(jobContext.getInstanceId()),
            stepContext.getStepName(),
            itemKey,
            "PROCESS_SKIP",
            reasonCode
        );

        BatchItemErrorEvent event = new BatchItemErrorEvent(
            idempotencyKey,
            jobContext.getExecutionId(),
            jobContext.getJobName(),
            stepContext.getStepName(),
            itemKey,
            itemKeyExtractor.sourceLocation(item),
            "PROCESS",
            reasonCode,
            ex.getClass().getName(),
            sanitize(ex.getMessage())
        );

        errorAuditService.insertIfAbsent(event);
    }

    private String sanitize(String message) {
        if (message == null) return "";
        return message.length() > 500 ? message.substring(0, 500) : message;
    }
}
```

### 22.3 Kenapa desain ini lebih aman

- Ada idempotency key.
- Ada reason code stabil.
- Message disanitasi.
- Item identity stabil.
- Audit event terstruktur.
- Tidak mengirim external notification langsung.
- Tidak memakai timestamp sebagai identity.
- Tidak menyimpan PII raw tanpa kontrol.

---

## 23. Example: Job Finalization Listener dengan Outbox

```java
@Named("jobFinalizationListener")
public class JobFinalizationListener implements JobListener {

    @Inject JobContext jobContext;
    @Inject BatchSummaryService summaryService;
    @Inject NotificationOutbox notificationOutbox;
    @Inject BatchAuditService auditService;

    @Override
    public void beforeJob() {
        auditService.recordJobStartedIfAbsent(jobContext.getExecutionId());
    }

    @Override
    public void afterJob() {
        BatchSummary summary = summaryService.computeSummary(jobContext.getExecutionId());

        auditService.recordJobFinishedIfAbsent(summary);

        if (summary.requiresNotification()) {
            notificationOutbox.enqueueIfAbsent(
                summary.notificationKey(),
                summary.toNotificationPayload()
            );
        }
    }
}
```

Key idea:

```text
afterJob computes/records final state,
but notification delivery is deferred and idempotent.
```

---

## 24. Testing Listener

Listener sering tidak dites cukup, padahal efeknya besar.

### 24.1 Unit tests

Test:

- event mapping,
- idempotency key generation,
- exception classification,
- sanitization,
- fail-open/fail-closed behavior,
- status mapping,
- exit status vocabulary.

### 24.2 Integration tests

Test:

- listener invocation in real batch runtime,
- listener with retry,
- listener with skip,
- listener with rollback,
- listener with restart,
- listener with partitioned step,
- listener failure behavior,
- job repository state correctness.

### 24.3 Restart tests

Scenario:

```text
1. start job
2. process N items
3. fail item X
4. verify listener recorded expected event
5. restart job
6. verify duplicate event not created
7. verify final audit summary correct
```

### 24.4 Partition tests

Scenario:

```text
1. create 4 partitions
2. partition 2 has poison records
3. partition 3 is slow
4. verify listener metrics per partition
5. verify aggregate summary deterministic
6. verify no shared mutable state corruption
```

---

## 25. Operational Dashboard dari Listener Data

Listener dapat memberi data untuk dashboard.

### 25.1 Job dashboard

Columns:

- job name,
- instance id,
- execution id,
- requested by,
- status,
- exit status,
- start time,
- end time,
- duration,
- progress,
- read/write/skip/retry,
- input manifest,
- output manifest,
- action buttons.

### 25.2 Step dashboard

Columns:

- step name,
- status,
- duration,
- read count,
- write count,
- skip count,
- retry count,
- rollback count,
- bottleneck phase,
- last error.

### 25.3 Error dashboard

Columns:

- item key,
- source location,
- step,
- phase,
- reason code,
- exception class,
- retry attempts,
- skipped/fatal,
- remediation status.

Listener bukan satu-satunya sumber data, tetapi hook yang sangat baik untuk mengisi operational evidence.

---

## 26. Anti-Patterns

### 26.1 Business logic hidden in listener

Buruk:

```java
@Override
public void afterProcess(Object item, Object result) {
    if (item instanceof Case c && c.isHighRisk()) {
        enforcementService.escalate(c);
    }
}
```

Masalah:

- JSL tidak menunjukkan escalation logic.
- Processor/writer tidak terlihat melakukan side effect.
- Retry/restart bisa menggandakan escalation.
- Testing sulit.
- Audit reasoning kabur.

Lebih baik:

- escalation adalah output eksplisit writer,
- atau outbox event dari processor/writer,
- listener hanya observe.

---

### 26.2 Sending external API call per item from listener

Buruk:

```java
@Override
public void afterWrite(List<Object> items) {
    for (Object item : items) {
        externalApi.notify(item);
    }
}
```

Masalah:

- no rate limit,
- no idempotency,
- transaction mismatch,
- retry duplicates,
- slow listener slows batch,
- external failure breaks internal batch unpredictably.

Lebih baik:

```text
writer writes outbox rows
separate rate-limited dispatcher sends external notifications
```

---

### 26.3 Mutable shared listener state

Buruk:

```java
private int count;

@Override
public void afterRead(Object item) {
    count++;
}
```

Masalah:

- not thread-safe,
- wrong under partition,
- wrong if listener reused,
- lost under restart.

Lebih baik:

- runtime metrics,
- atomic counters only if local and justified,
- StepContext metrics,
- durable summary table.

---

### 26.4 Logging everything at item level

Buruk:

```java
logger.info("Processed item {}", item);
```

Masalah:

- log explosion,
- PII leakage,
- cost,
- slow I/O,
- unsearchable noise.

Lebih baik:

- aggregate metrics,
- sampled debug logs,
- structured error table for failed/skipped items,
- trace only for selected correlation.

---

### 26.5 Listener failure ignored silently

Buruk:

```java
catch (Exception ignored) {}
```

Masalah:

- missing audit,
- false sense of success,
- impossible forensic investigation.

Lebih baik:

- classify listener criticality,
- log structured warning/error,
- fail job for mandatory evidence failure,
- enqueue remediation for deferred side effect.

---

## 27. Best Practices

1. Treat listener as **lifecycle adapter**, not business service.
2. Keep listener thin.
3. Make side effects idempotent.
4. Define fail-open/fail-closed per listener.
5. Avoid high-cardinality metric labels.
6. Use structured audit records, not free text logs.
7. Use stable idempotency keys.
8. Avoid mutable shared state.
9. Test retry/restart/partition behavior.
10. Do not send external notification directly unless explicitly idempotent and acceptable.
11. Keep exit status vocabulary finite and documented.
12. Use outbox for external side effects.
13. Separate audit, metrics, notification, and cleanup concerns.
14. Avoid dependency between listener ordering unless explicitly controlled.
15. Design listener behavior as part of operational governance.

---

## 28. Production Checklist

Sebelum listener dianggap production-ready, jawab ini:

### Lifecycle

- [ ] Listener dipasang di lifecycle point yang tepat?
- [ ] Tidak ada business logic utama tersembunyi?
- [ ] Behavior listener terdokumentasi?

### Transaction and side effect

- [ ] Apakah listener melakukan side effect?
- [ ] Side effect idempotent?
- [ ] Ada idempotency key?
- [ ] Aman terhadap rollback?
- [ ] Aman terhadap restart?

### Error handling

- [ ] Fail-open/fail-closed jelas?
- [ ] Mandatory audit failure menggagalkan job atau membuat remediation?
- [ ] Optional metrics failure tidak menggagalkan job?
- [ ] Exception tidak ditelan diam-diam?

### Observability

- [ ] Metrics tidak high-cardinality?
- [ ] Audit terstruktur?
- [ ] Correlation id tersedia?
- [ ] Skip/retry reason code jelas?
- [ ] Dashboard bisa membaca event?

### Concurrency

- [ ] Tidak ada mutable shared state berbahaya?
- [ ] Aman untuk partitioned step?
- [ ] Aman untuk parallel execution?

### Security

- [ ] Parameter sensitif dimasking?
- [ ] PII tidak bocor ke log/metric?
- [ ] Audit menyimpan actor/effective identity?

### Testing

- [ ] Unit test event mapping?
- [ ] Integration test listener invocation?
- [ ] Retry test?
- [ ] Skip test?
- [ ] Restart test?
- [ ] Partition test?

---

## 29. Thought Experiment

Bayangkan batch `bulk-correspondence-generation`:

- membaca 500.000 recipient,
- menghasilkan PDF,
- menulis document record,
- mengirim notification,
- sebagian recipient invalid,
- external document service kadang timeout,
- job bisa di-restart.

Pertanyaan:

1. Listener mana yang kamu pasang di job level?
2. Listener mana yang kamu pasang di step level?
3. Listener mana yang mencatat invalid recipient?
4. Apakah email dikirim dari `afterWrite`?
5. Apa idempotency key untuk notification?
6. Apa exit status jika 500.000 dibaca, 499.800 sukses, 200 skipped?
7. Jika restart setelah 300.000 recipient, bagaimana listener mencegah double notification?
8. Jika metrics backend down, apakah job gagal?
9. Jika audit DB down, apakah job gagal?
10. Bagaimana dashboard menunjukkan progress dan partial success?

Jawaban top-tier biasanya akan memisahkan:

```text
batch core work      -> reader/processor/writer
skip/error evidence  -> skip listener + error table
metrics              -> metrics listener
notification intent  -> outbox, not direct send
final summary        -> afterJob + repository/business state
external delivery    -> separate idempotent dispatcher
```

---

## 30. Ringkasan

Jakarta Batch listener adalah mekanisme penting untuk mengamati dan memperkaya batch lifecycle. Ia sangat berguna untuk observability, audit, notification intent, cleanup, diagnostics, skip/retry evidence, dan runtime governance.

Namun listener juga bisa menjadi sumber production failure jika dipakai untuk business logic tersembunyi, side effect non-idempotent, mutable shared state, external API call langsung, atau audit yang tidak transaction-aware.

Mental model utama:

```text
Listener observes lifecycle.
Reader/processor/writer performs domain work.
Control plane governs execution.
Repository stores runtime state.
Audit store records defensible evidence.
Outbox handles external side effects.
```

Listener yang baik bersifat:

- thin,
- explicit,
- idempotent,
- restart-safe,
- partition-safe,
- observable,
- audited,
- tested under failure.

Jika listener mulai menjadi tempat “magic behavior”, desain batch menjadi sulit dipahami, sulit diuji, dan sulit dipertanggungjawabkan.

---

## 31. Referensi Resmi dan Lanjutan

- Jakarta Batch 2.1 Specification
- Jakarta Batch API: `jakarta.batch.api.listener`
- Jakarta Batch API: `jakarta.batch.api.chunk.listener`
- Jakarta Batch API: `jakarta.batch.runtime.context.JobContext`
- Jakarta Batch API: `jakarta.batch.runtime.context.StepContext`
- Jakarta EE 11 Platform Specification
- Jakarta EE Tutorial: Batch Processing
- MicroProfile Metrics untuk metrik operasional
- MicroProfile Telemetry/OpenTelemetry untuk tracing modern

---

## 32. Status Seri

Seri belum selesai.

Part yang sudah dibahas sampai file ini:

```text
Part 0  - Orientation
Part 1  - History Java EE Concurrency to Jakarta Concurrency
Part 2  - Container Integrity
Part 3  - ManagedExecutorService
Part 4  - ManagedScheduledExecutorService
Part 5  - ManagedThreadFactory
Part 6  - ContextService and Context Propagation
Part 7  - Transactions Across Asynchronous Boundaries
Part 8  - Security, Identity, and Authorization in Async Execution
Part 9  - CDI, Interceptors, Events, and Async Boundaries
Part 10 - CompletableFuture in Jakarta EE
Part 11 - Virtual Threads and Jakarta EE Managed Concurrency
Part 12 - Structured Concurrency and Scoped Values
Part 13 - Concurrency Control, Backpressure, Bulkheads
Part 14 - Cancellation, Timeout, Retry, Interruption
Part 15 - Observability for Managed Async Workloads
Part 16 - Production Failure Modes in Jakarta Concurrency
Part 17 - Jakarta Batch Mental Model
Part 18 - JSL Deep Dive
Part 19 - Batchlet Model
Part 20 - Chunk-Oriented Processing
Part 21 - Checkpointing, Restartability, Idempotency
Part 22 - Skip, Retry, Rollback, Exception Classification
Part 23 - Batch Transactions and Database Integration
Part 24 - Partitioning: Parallel Batch at Scale
Part 25 - Split, Flow, Decision, Complex Job Graphs
Part 26 - JobOperator, Job Repository, Runtime Control Plane
Part 27 - Batch Listeners and Cross-Cutting Behavior
```

Part berikutnya:

```text
Part 28 - File, CSV, XML, JSON, and Large Payload Batch Processing
File    - 28-file-csv-xml-json-large-payload-batch-processing.md
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 26 — JobOperator, Job Repository, and Runtime Control Plane](./26-joboperator-job-repository-runtime-control-plane.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 28 — File, CSV, XML, JSON, and Large Payload Batch Processing](./28-file-csv-xml-json-large-payload-batch-processing.md)

</div>