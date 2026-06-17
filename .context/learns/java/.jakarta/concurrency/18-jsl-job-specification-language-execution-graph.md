# Part 18 — JSL Deep Dive: Job XML as Execution Graph

> Series: `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
> File: `18-jsl-job-specification-language-execution-graph.md`  
> Fokus: memahami **Job Specification Language (JSL)** Jakarta Batch sebagai **execution graph** yang eksplisit, restartable, observable, dan operable — bukan sekadar XML konfigurasi.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Membaca JSL sebagai **graf eksekusi batch**: node, edge, transition, terminal state, dan decision point.
2. Membedakan peran elemen utama JSL:
   - `job`
   - `step`
   - `batchlet`
   - `chunk`
   - `flow`
   - `split`
   - `decision`
   - `next`
   - `end`
   - `fail`
   - `stop`
   - `properties`
   - `listeners`
   - `partition`
3. Memahami bagaimana `BatchStatus` dan `ExitStatus` memengaruhi transisi.
4. Mendesain JSL yang **mudah dibaca, aman di-restart, dan tidak berubah menjadi XML spaghetti**.
5. Menentukan boundary yang benar antara:
   - orchestration di JSL,
   - business logic di Java artifact,
   - runtime control di `JobOperator`,
   - operational policy di luar batch.
6. Menghindari anti-pattern seperti memasukkan terlalu banyak business decision ke XML atau menyembunyikan flow penting di listener.
7. Membuat job graph yang defensible untuk workload enterprise/regulatory: jelas, bisa diaudit, bisa dijelaskan, dan bisa dipulihkan.

---

## 2. Posisi Part Ini dalam Seri

Part sebelumnya membangun mental model Jakarta Batch:

- `Job` adalah definisi pekerjaan.
- `JobInstance` adalah job dengan parameter tertentu.
- `JobExecution` adalah attempt menjalankan job instance.
- `StepExecution` adalah attempt menjalankan sebuah step.
- Batch runtime menyimpan state di job repository.

Part ini masuk ke pertanyaan berikutnya:

> Bagaimana kita mendeskripsikan **bentuk eksekusi** job tersebut?

Jawabannya: dengan **JSL — Job Specification Language**.

JSL adalah XML yang menjelaskan struktur batch job. Tetapi cara berpikir top-tier engineer sebaiknya bukan:

> “JSL adalah file XML untuk konfigurasi batch.”

Melainkan:

> “JSL adalah deklarasi execution graph yang dipahami runtime, sehingga job bisa dijalankan, dipantau, dihentikan, gagal, selesai, dan di-restart secara konsisten.”

Perbedaan cara pikir ini penting. Kalau JSL dianggap sekadar konfigurasi, desainnya sering menjadi kumpulan step linear yang rapuh. Kalau JSL dianggap execution graph, kita mulai bertanya:

- node apa saja yang ada?
- edge apa saja yang mungkin?
- status apa yang membuat graph berpindah?
- kapan graph selesai?
- kapan graph gagal?
- kapan graph berhenti untuk restart?
- apa yang boleh paralel?
- apa yang harus serial?
- state apa yang harus durable?
- bagaimana operator memahami posisi eksekusi?

---

## 3. Mental Model Utama: JSL sebagai Directed Execution Graph

Bayangkan sebuah JSL bukan sebagai XML, tetapi sebagai graf berarah:

```text
          +----------------+
          | validate-input |
          +--------+-------+
                   |
                   v
          +----------------+
          | load-reference |
          +--------+-------+
                   |
                   v
          +----------------+
          | process-record |
          +--------+-------+
                   |
                   v
          +----------------+
          | generate-report|
          +--------+-------+
                   |
                   v
              COMPLETED
```

Dalam graf ini:

| Konsep Graph | Konsep JSL |
|---|---|
| Node | `step`, `flow`, `split`, `decision` |
| Edge | `next` attribute atau transition element |
| Terminal node | `end`, `fail`, `stop`, default completion |
| Conditional edge | transition berdasarkan `on` pattern terhadap exit status |
| Parallel branch | `split` berisi beberapa `flow` |
| Subgraph | `flow` |
| Runtime state | `JobExecution`, `StepExecution`, job repository |

Mental model ini mengubah desain.

JSL yang baik bukan hanya valid XML. JSL yang baik memiliki **shape** yang masuk akal:

- jalur sukses terlihat jelas,
- jalur failure terlihat jelas,
- stop/restart point terlihat jelas,
- parallelisme tidak liar,
- transition tidak membentuk loop ilegal,
- decision tidak menyembunyikan business process besar,
- setiap step punya purpose tunggal.

---

## 4. JSL Bukan Workflow Engine Penuh

Sebelum masuk detail, penting membatasi ekspektasi.

Jakarta Batch dapat mendeskripsikan execution graph batch. Namun ia bukan workflow engine penuh seperti BPMN engine.

### 4.1 Jakarta Batch Cocok untuk

- batch ingestion,
- bulk processing,
- nightly calculation,
- report generation,
- data migration,
- file import/export,
- background reconciliation,
- scheduled maintenance job,
- restartable processing,
- chunked database/file/API workload.

### 4.2 Jakarta Batch Tidak Ideal untuk

- long-running human workflow,
- approval process multi-hari/multi-minggu,
- dynamic case lifecycle kompleks,
- user task assignment,
- SLA timer per case,
- ad-hoc branching berdasarkan aksi manusia,
- process instance dengan ratusan state bisnis.

Untuk itu, BPMN/workflow engine atau domain state machine lebih cocok.

### 4.3 Rule of Thumb

Gunakan Jakarta Batch ketika pertanyaannya:

> “Bagaimana memproses banyak unit data secara durable, restartable, dan operable?”

Jangan gunakan Jakarta Batch sebagai pengganti workflow engine ketika pertanyaannya:

> “Bagaimana mengelola lifecycle bisnis yang panjang, interaktif, dan berubah berdasarkan aksi manusia?”

---

## 5. Struktur Minimal JSL

Sebuah job paling sederhana:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<job id="simpleJob" xmlns="https://jakarta.ee/xml/ns/jakartaee" version="2.0">
    <step id="helloStep">
        <batchlet ref="helloBatchlet" />
    </step>
</job>
```

Komponen penting:

| Elemen | Makna |
|---|---|
| `job` | Root definition untuk satu batch job |
| `id` | Nama logis job |
| namespace | Schema namespace Jakarta/JCP tergantung versi/API |
| `step` | Unit eksekusi utama |
| `batchlet` | Task-oriented artifact |
| `ref` | Nama artifact Java/CDI/batch artifact yang dipakai runtime |

Di Jakarta namespace modern, kamu akan melihat `jakarta.*` di API Java. Namun file JSL lama dari Java EE/JSR 352 sering memakai namespace `http://xmlns.jcp.org/xml/ns/javaee`. Di environment migrasi, namespace dan dukungan schema bisa dipengaruhi versi implementation.

Prinsip praktis:

- Untuk project baru Jakarta EE modern, gunakan namespace dan dependensi yang sesuai target runtime.
- Untuk migration project lama, jangan hanya rename package Java; verifikasi juga JSL namespace, artifact discovery, deployment packaging, dan runtime implementation.

---

## 6. Elemen `job`

`job` adalah root execution definition.

Contoh:

```xml
<job id="nightlyCaseAgeingJob"
     xmlns="https://jakarta.ee/xml/ns/jakartaee"
     version="2.0">

    <properties>
        <property name="defaultPageSize" value="500" />
        <property name="auditCategory" value="NIGHTLY_CASE_AGEING" />
    </properties>

    <step id="validateParameters" next="loadReferenceData">
        <batchlet ref="validateCaseAgeingParametersBatchlet" />
    </step>

    <step id="loadReferenceData" next="recalculateAgeing">
        <batchlet ref="loadReferenceDataBatchlet" />
    </step>

    <step id="recalculateAgeing" next="generateSummary">
        <chunk item-count="500">
            <reader ref="caseReader" />
            <processor ref="caseAgeingProcessor" />
            <writer ref="caseAgeingWriter" />
        </chunk>
    </step>

    <step id="generateSummary">
        <batchlet ref="caseAgeingSummaryBatchlet" />
    </step>
</job>
```

`job` dapat memuat:

- properties,
- listeners,
- steps,
- flows,
- splits,
- decisions,
- transitions.

### 6.1 Job ID sebagai Contract

`job id` bukan sekadar nama file. Ia menjadi contract operasional.

Contoh buruk:

```xml
<job id="job1" ...>
```

Contoh lebih baik:

```xml
<job id="nightlyCaseAgeingRecalculation" ...>
```

Nama job harus menjawab:

- workload apa yang dijalankan?
- domain apa?
- apakah periodic/ad-hoc?
- apakah job ini bisa dijalankan ulang?
- apakah operator bisa mengenalinya di dashboard?

Dalam sistem enterprise, job ID sering muncul di:

- job repository,
- log,
- metrics,
- dashboard,
- alert,
- audit trail,
- operational runbook.

Nama yang buruk akan menjadi biaya operasional bertahun-tahun.

---

## 7. Properties dan Parameters

JSL punya `properties`; runtime juga menerima job parameters saat job dimulai.

Keduanya berbeda.

| Konsep | Sumber | Sifat | Contoh |
|---|---|---|---|
| JSL properties | Dideklarasikan di XML | Relatif statis | chunk size default, mode step, artifact option |
| Job parameters | Diberikan saat start job | Dinamis per execution/instance | business date, agency id, file name, requestedBy |

### 7.1 JSL Properties

Contoh:

```xml
<step id="importFile">
    <properties>
        <property name="delimiter" value="," />
        <property name="encoding" value="UTF-8" />
    </properties>
    <batchlet ref="csvImportBatchlet" />
</step>
```

Properties cocok untuk konfigurasi artifact yang melekat pada step.

Misalnya:

- delimiter file,
- default fetch size,
- logical mode,
- output format,
- feature flag statis per job definition.

### 7.2 Job Parameters

Job parameters diberikan dari Java code:

```java
Properties parameters = new Properties();
parameters.setProperty("businessDate", "2026-06-17");
parameters.setProperty("agencyCode", "CEA");
parameters.setProperty("requestedBy", "system-scheduler");
parameters.setProperty("requestId", "REQ-20260617-0001");

JobOperator jobOperator = BatchRuntime.getJobOperator();
long executionId = jobOperator.start("nightlyCaseAgeingRecalculation", parameters);
```

Parameters cocok untuk nilai yang berubah setiap execution:

- business date,
- input file path,
- input manifest id,
- requested by,
- tenant/agency,
- dry-run flag,
- correlation id.

### 7.3 Jangan Menaruh Secret di Job Parameters

Anti-pattern:

```java
parameters.setProperty("apiPassword", "secret-value");
```

Kenapa buruk?

- parameter bisa tersimpan di job repository,
- bisa muncul di log/debug,
- bisa terbaca operator,
- bisa menjadi audit/security incident.

Lebih baik:

- parameter berisi secret alias/key,
- artifact mengambil secret dari secret manager/container resource,
- log masking diterapkan.

Contoh:

```java
parameters.setProperty("externalRegistryCredentialRef", "registry-sync-prod");
```

---

## 8. Step sebagai Node Eksekusi Utama

`step` adalah unit utama dalam JSL.

Ada dua bentuk utama:

1. batchlet step,
2. chunk step.

### 8.1 Batchlet Step

```xml
<step id="archiveOldFiles">
    <batchlet ref="archiveOldFilesBatchlet" />
</step>
```

Batchlet cocok untuk task yang bukan item-by-item chunk processing:

- generate report,
- call maintenance stored procedure,
- move file,
- validate manifest,
- send summary notification,
- rebuild search index segment,
- create output directory,
- cleanup temporary records.

### 8.2 Chunk Step

```xml
<step id="processCases">
    <chunk item-count="500">
        <reader ref="caseReader" />
        <processor ref="caseProcessor" />
        <writer ref="caseWriter" />
    </chunk>
</step>
```

Chunk cocok untuk banyak item homogen:

- read records,
- process/transform/validate,
- write result,
- commit per chunk,
- checkpoint progress.

### 8.3 Step ID sebagai Operational Contract

Nama step juga harus bermakna.

Buruk:

```xml
<step id="step1">
```

Lebih baik:

```xml
<step id="validateInputManifest">
<step id="readAndNormalizeApplicantRows">
<step id="writeEligibleCases">
<step id="publishReconciliationSummary">
```

Step ID akan muncul ketika operator bertanya:

> “Job stuck di mana?”

Jawaban `step3` tidak membantu.

Jawaban `publishReconciliationSummary` membantu.

---

## 9. Sequential Transition dengan `next`

Cara paling sederhana menghubungkan step:

```xml
<step id="validateInput" next="processInput">
    <batchlet ref="validateInputBatchlet" />
</step>

<step id="processInput" next="generateReport">
    <chunk item-count="100">
        <reader ref="inputReader" />
        <processor ref="inputProcessor" />
        <writer ref="inputWriter" />
    </chunk>
</step>

<step id="generateReport">
    <batchlet ref="generateReportBatchlet" />
</step>
```

Graph:

```text
validateInput -> processInput -> generateReport -> COMPLETED
```

Ini cocok untuk happy path linear.

Namun production workload jarang hanya happy path.

Kita butuh transition conditional.

---

## 10. Transition Element: `next`, `end`, `fail`, `stop`

Selain `next` attribute, JSL mendukung transition elements.

Secara konseptual:

| Transition | Efek |
|---|---|
| `next` | Lanjut ke node lain |
| `end` | Akhiri job sebagai completed |
| `fail` | Akhiri job sebagai failed |
| `stop` | Akhiri job sebagai stopped, biasanya restartable |

Transition biasanya dipilih berdasarkan `on` pattern terhadap exit status.

Contoh:

```xml
<step id="validateInput">
    <batchlet ref="validateInputBatchlet" />

    <next on="VALID" to="processInput" />
    <end on="EMPTY_INPUT" exit-status="NO_DATA" />
    <fail on="INVALID" exit-status="INVALID_INPUT" />
</step>
```

Graph:

```text
                  +----------------+
                  | validateInput  |
                  +---+------+-----+
                      |      |
            VALID ----+      +---- EMPTY_INPUT -> END(COMPLETED, NO_DATA)
                      |
                      v
              processInput

            INVALID -> FAIL(FAILED, INVALID_INPUT)
```

### 10.1 BatchStatus vs ExitStatus

Ini sangat penting.

`BatchStatus` adalah status lifecycle yang dipahami runtime:

- STARTING
- STARTED
- STOPPING
- STOPPED
- FAILED
- COMPLETED
- ABANDONED

`ExitStatus` adalah string semantik yang bisa digunakan untuk routing.

Contoh:

- `VALID`
- `INVALID`
- `NO_DATA`
- `PARTIAL_SUCCESS`
- `REQUIRES_MANUAL_REVIEW`
- `EXTERNAL_SYSTEM_UNAVAILABLE`

Mental model:

```text
BatchStatus = apa yang terjadi secara runtime
ExitStatus  = apa arti hasilnya untuk flow bisnis/operasional
```

Jangan mencampur keduanya.

Buruk:

```text
ExitStatus = FAILED
```

Lebih baik:

```text
BatchStatus = FAILED
ExitStatus  = EXTERNAL_REGISTRY_TIMEOUT
```

Atau:

```text
BatchStatus = COMPLETED
ExitStatus  = NO_ELIGIBLE_RECORDS
```

Karena “tidak ada data” bisa menjadi completion yang sah, bukan failure.

---

## 11. Pattern Matching pada Transition

Transition memakai nilai `on` untuk mencocokkan exit status.

Contoh:

```xml
<step id="classifyRecords">
    <batchlet ref="classifyRecordsBatchlet" />

    <next on="HAS_REJECTS" to="generateRejectReport" />
    <next on="ALL_VALID" to="processValidRecords" />
    <fail on="*" exit-status="UNEXPECTED_CLASSIFICATION_RESULT" />
</step>
```

`*` sering dipakai sebagai fallback.

Prinsip desain:

- Jangan hanya mengandalkan default transition untuk kondisi penting.
- Berikan fallback eksplisit untuk exit status tidak dikenal.
- Jangan membuat terlalu banyak magic string tersebar di artifact.

Sebaiknya definisikan constants di Java:

```java
public final class BatchExitStatuses {
    private BatchExitStatuses() {}

    public static final String VALID = "VALID";
    public static final String INVALID = "INVALID";
    public static final String EMPTY_INPUT = "EMPTY_INPUT";
    public static final String EXTERNAL_SYSTEM_UNAVAILABLE = "EXTERNAL_SYSTEM_UNAVAILABLE";
    public static final String PARTIAL_SUCCESS = "PARTIAL_SUCCESS";
}
```

Lalu pastikan string di JSL dan Java dijaga dengan test.

---

## 12. Setting Exit Status dari Batchlet

Contoh batchlet:

```java
import jakarta.batch.api.Batchlet;
import jakarta.enterprise.context.Dependent;
import jakarta.inject.Named;

@Named
@Dependent
public class ValidateInputBatchlet implements Batchlet {

    @Override
    public String process() throws Exception {
        ValidationResult result = validate();

        if (result.isInvalid()) {
            return "INVALID";
        }

        if (result.isEmpty()) {
            return "EMPTY_INPUT";
        }

        return "VALID";
    }

    @Override
    public void stop() throws Exception {
        // cooperative stop if needed
    }

    private ValidationResult validate() {
        // business validation here
        return ValidationResult.valid();
    }
}
```

`process()` dapat mengembalikan string exit status.

Jangan return string sembarangan.

Exit status adalah bagian dari graph contract.

---

## 13. Setting Exit Status dari Step Context

Kadang artifact ingin mengatur exit status secara eksplisit lewat context.

Contoh konseptual:

```java
import jakarta.batch.runtime.context.StepContext;
import jakarta.inject.Inject;

public class SomeArtifact {

    @Inject
    StepContext stepContext;

    public void markPartialSuccess() {
        stepContext.setExitStatus("PARTIAL_SUCCESS");
    }
}
```

Gunakan ini jika exit status ditentukan setelah beberapa operasi internal.

Namun hati-hati:

- jangan set exit status dari banyak tempat tanpa aturan jelas,
- jangan biarkan listener diam-diam override exit status penting,
- jangan jadikan exit status sebagai global mutable state yang membingungkan.

---

## 14. `end`: Completed tetapi dengan Makna Tertentu

`end` mengakhiri job sebagai completed.

Contoh:

```xml
<step id="detectInput">
    <batchlet ref="detectInputBatchlet" />

    <next on="FOUND" to="processInput" />
    <end on="NOT_FOUND" exit-status="NO_INPUT_FILE" />
</step>
```

Ini berarti:

- runtime status: completed,
- semantic result: no input file.

Kapan `end` cocok?

- no data to process,
- job already processed for business date,
- dry-run validation succeeded,
- optional downstream step not required,
- duplicate harmless request detected.

Jangan gunakan `end` untuk menyembunyikan error.

Buruk:

```xml
<end on="DB_ERROR" exit-status="COMPLETED_WITH_DB_ERROR" />
```

Kalau DB error membuat output tidak valid, job harus gagal atau stop, bukan completed.

---

## 15. `fail`: Failure yang Tidak Boleh Dianggap Sukses

`fail` mengakhiri job sebagai failed.

Contoh:

```xml
<step id="validateManifest">
    <batchlet ref="validateManifestBatchlet" />

    <next on="VALID" to="importRows" />
    <fail on="INVALID_SCHEMA" exit-status="INVALID_MANIFEST_SCHEMA" />
    <fail on="CHECKSUM_MISMATCH" exit-status="MANIFEST_CHECKSUM_MISMATCH" />
</step>
```

Gunakan `fail` ketika:

- input rusak,
- parameter invalid,
- business invariant dilanggar,
- output tidak bisa dipercaya,
- manual intervention diperlukan sebelum retry,
- side effect mungkin sebagian terjadi dan perlu investigasi.

Failure harus informatif.

Buruk:

```xml
<fail on="*" exit-status="FAILED" />
```

Lebih baik:

```xml
<fail on="INVALID_*" exit-status="VALIDATION_FAILED" />
<fail on="EXTERNAL_*" exit-status="EXTERNAL_DEPENDENCY_FAILED" />
<fail on="*" exit-status="UNEXPECTED_BATCH_EXIT_STATUS" />
```

---

## 16. `stop`: Controlled Stop dan Restart Point

`stop` mengakhiri job sebagai stopped.

Contoh:

```xml
<step id="checkMaintenanceWindow">
    <batchlet ref="checkMaintenanceWindowBatchlet" />

    <next on="OPEN" to="processRecords" />
    <stop on="CLOSING_SOON" restart="processRecords" exit-status="STOPPED_MAINTENANCE_WINDOW" />
</step>
```

`stop` berbeda dari `fail`.

| Aspek | `fail` | `stop` |
|---|---|---|
| Makna | Job gagal | Job berhenti terkendali |
| Restart | Bisa tergantung runtime/policy, tetapi failure perlu analisis | Memang diarahkan untuk restart |
| Operator signal | Ada error | Ada kondisi stop yang diprediksi |
| Contoh | invalid input, DB corruption, non-retryable error | maintenance window, stop requested, dependency temporarily unavailable |

`stop` cocok jika:

- ada kondisi sementara,
- job perlu dilanjutkan nanti,
- posisi restart bisa ditentukan,
- tidak ada invariant bisnis yang rusak.

Jangan gunakan `stop` untuk error yang tidak kamu pahami.

---

## 17. Batchlet vs Chunk dalam JSL Graph

JSL graph bisa mencampur batchlet dan chunk.

Contoh:

```xml
<job id="monthlyRevenueReconciliation" xmlns="https://jakarta.ee/xml/ns/jakartaee" version="2.0">

    <step id="validateBusinessDate" next="extractRevenueRows">
        <batchlet ref="validateBusinessDateBatchlet" />
    </step>

    <step id="extractRevenueRows" next="reconcileRevenueRows">
        <batchlet ref="extractRevenueRowsBatchlet" />
    </step>

    <step id="reconcileRevenueRows" next="generateReconciliationReport">
        <chunk item-count="1000">
            <reader ref="revenueRowReader" />
            <processor ref="revenueReconciliationProcessor" />
            <writer ref="revenueReconciliationWriter" />
        </chunk>
    </step>

    <step id="generateReconciliationReport" next="publishSummary">
        <batchlet ref="generateReconciliationReportBatchlet" />
    </step>

    <step id="publishSummary">
        <batchlet ref="publishSummaryBatchlet" />
    </step>
</job>
```

Mental model:

```text
validateBusinessDate
    -> extractRevenueRows
    -> reconcileRevenueRows(chunk)
    -> generateReconciliationReport
    -> publishSummary
```

Batchlet sering menjadi orchestration support step.

Chunk menjadi main data processing step.

---

## 18. Flow: Subgraph yang Dieksekusi sebagai Unit

`flow` adalah sequence dari execution elements yang dikelompokkan sebagai satu unit.

Contoh:

```xml
<flow id="prepareInputFlow" next="processInput">
    <step id="validateManifest" next="stageInputFile">
        <batchlet ref="validateManifestBatchlet" />
    </step>

    <step id="stageInputFile">
        <batchlet ref="stageInputFileBatchlet" />
    </step>
</flow>

<step id="processInput">
    <chunk item-count="500">
        <reader ref="inputReader" />
        <processor ref="inputProcessor" />
        <writer ref="inputWriter" />
    </chunk>
</step>
```

Graph:

```text
prepareInputFlow:
    validateManifest -> stageInputFile

prepareInputFlow -> processInput
```

### 18.1 Mengapa Flow Berguna?

Flow berguna untuk:

- mengelompokkan step terkait,
- membuat graph lebih readable,
- menggunakan group sebagai branch dalam split,
- memisahkan fase job:
  - preparation,
  - processing,
  - reporting,
  - cleanup.

### 18.2 Boundary Penting Flow

Step di dalam flow hanya boleh bertransisi dalam flow tersebut. Secara mental, flow adalah subgraph tertutup.

Artinya:

```text
Flow bukan hanya label visual.
Flow adalah boundary execution graph.
```

Ini bagus untuk modularitas, tetapi bisa membingungkan kalau kamu mencoba melompat keluar dari flow secara sembarangan.

---

## 19. Flow Design Pattern

### 19.1 Phase Flow

Cocok untuk job besar:

```xml
<job id="caseEscalationEvaluation" xmlns="https://jakarta.ee/xml/ns/jakartaee" version="2.0">

    <flow id="prepareEvaluation" next="runEvaluation">
        <step id="validateEvaluationWindow" next="loadEvaluationRules">
            <batchlet ref="validateEvaluationWindowBatchlet" />
        </step>
        <step id="loadEvaluationRules">
            <batchlet ref="loadEvaluationRulesBatchlet" />
        </step>
    </flow>

    <flow id="runEvaluation" next="finalizeEvaluation">
        <step id="evaluateCases">
            <chunk item-count="500">
                <reader ref="caseEvaluationReader" />
                <processor ref="caseEvaluationProcessor" />
                <writer ref="caseEvaluationWriter" />
            </chunk>
        </step>
    </flow>

    <flow id="finalizeEvaluation">
        <step id="generateEvaluationSummary" next="publishEvaluationMetrics">
            <batchlet ref="generateEvaluationSummaryBatchlet" />
        </step>
        <step id="publishEvaluationMetrics">
            <batchlet ref="publishEvaluationMetricsBatchlet" />
        </step>
    </flow>
</job>
```

Readable graph:

```text
prepareEvaluation -> runEvaluation -> finalizeEvaluation
```

Dalam setiap flow ada detail.

### 19.2 Optional Flow

```xml
<step id="detectRejects">
    <batchlet ref="detectRejectsBatchlet" />
    <next on="HAS_REJECTS" to="rejectReportFlow" />
    <next on="NO_REJECTS" to="successReportFlow" />
</step>

<flow id="rejectReportFlow">
    <step id="generateRejectReport" next="notifyOperations">
        <batchlet ref="generateRejectReportBatchlet" />
    </step>
    <step id="notifyOperations">
        <batchlet ref="notifyOperationsBatchlet" />
    </step>
</flow>

<flow id="successReportFlow">
    <step id="generateSuccessReport">
        <batchlet ref="generateSuccessReportBatchlet" />
    </step>
</flow>
```

Ini membuat optional branch eksplisit.

---

## 20. Split: Parallel Flow Execution

`split` menjalankan beberapa flow secara paralel.

Contoh:

```xml
<split id="parallelPreparation" next="mergePreparationResult">
    <flow id="loadReferenceFlow">
        <step id="loadReferenceData">
            <batchlet ref="loadReferenceDataBatchlet" />
        </step>
    </flow>

    <flow id="loadConfigurationFlow">
        <step id="loadRuntimeConfiguration">
            <batchlet ref="loadRuntimeConfigurationBatchlet" />
        </step>
    </flow>

    <flow id="validateExternalDependencyFlow">
        <step id="checkExternalRegistryAvailability">
            <batchlet ref="checkExternalRegistryAvailabilityBatchlet" />
        </step>
    </flow>
</split>

<step id="mergePreparationResult">
    <batchlet ref="mergePreparationResultBatchlet" />
</step>
```

Graph:

```text
                 +-------------------+
                 | parallelPreparation|
                 +---------+---------+
                           |
        +------------------+------------------+
        |                  |                  |
        v                  v                  v
 loadReferenceFlow   loadConfigurationFlow  validateExternalDependencyFlow
        |                  |                  |
        +------------------+------------------+
                           |
                           v
               mergePreparationResult
```

### 20.1 Split Bukan Partitioning

Perbedaan penting:

| Konsep | Tujuan |
|---|---|
| `split` | Menjalankan beberapa flow berbeda secara paralel |
| partitioning | Membagi step yang sama menjadi beberapa partisi data |

Contoh split:

- load reference data,
- validate external system,
- prepare output directory,

semuanya pekerjaan berbeda.

Contoh partitioning:

- process case ID 1–10000,
- process case ID 10001–20000,
- process case ID 20001–30000,

pekerjaan sama, data berbeda.

### 20.2 Risiko Split

Split meningkatkan concurrency. Itu berarti:

- butuh thread lebih banyak,
- bisa menambah tekanan DB pool,
- bisa menambah tekanan downstream API,
- error aggregation harus jelas,
- observability harus bisa melihat branch mana yang lambat/gagal.

Jangan gunakan split hanya karena “bisa paralel”. Gunakan split ketika:

- branch independen,
- tidak ada shared mutable state berbahaya,
- resource capacity cukup,
- benefit latency jelas,
- failure behavior jelas.

---

## 21. Decision: Conditional Routing dengan Decider

`decision` adalah node yang memakai Java artifact `Decider` untuk menentukan arah berikutnya.

Contoh JSL:

```xml
<step id="processRecords" next="routeAfterProcessing">
    <chunk item-count="500">
        <reader ref="recordReader" />
        <processor ref="recordProcessor" />
        <writer ref="recordWriter" />
    </chunk>
</step>

<decision id="routeAfterProcessing" ref="processingOutcomeDecider">
    <next on="HAS_REJECTS" to="generateRejectReport" />
    <next on="ALL_SUCCESS" to="generateSuccessReport" />
    <fail on="TOO_MANY_REJECTS" exit-status="REJECT_THRESHOLD_EXCEEDED" />
</decision>

<step id="generateRejectReport">
    <batchlet ref="generateRejectReportBatchlet" />
</step>

<step id="generateSuccessReport">
    <batchlet ref="generateSuccessReportBatchlet" />
</step>
```

Decider Java:

```java
import jakarta.batch.api.Decider;
import jakarta.batch.runtime.StepExecution;
import jakarta.enterprise.context.Dependent;
import jakarta.inject.Named;

@Named
@Dependent
public class ProcessingOutcomeDecider implements Decider {

    @Override
    public String decide(StepExecution[] executions) throws Exception {
        ProcessingSummary summary = readSummary(executions);

        if (summary.rejectRateExceedsThreshold()) {
            return "TOO_MANY_REJECTS";
        }

        if (summary.hasRejects()) {
            return "HAS_REJECTS";
        }

        return "ALL_SUCCESS";
    }

    private ProcessingSummary readSummary(StepExecution[] executions) {
        // Read from step metrics, persistent summary table, or execution context.
        return ProcessingSummary.allSuccess();
    }
}
```

### 21.1 Kapan Memakai Decision?

Gunakan decision ketika routing membutuhkan:

- aggregate hasil step sebelumnya,
- beberapa metric,
- business threshold,
- dynamic condition,
- pemeriksaan state eksternal yang ringan,
- logic yang terlalu kompleks untuk transition `on` biasa.

### 21.2 Kapan Tidak Memakai Decision?

Jangan gunakan decision untuk:

- memproses data berat,
- melakukan side effect besar,
- menjalankan business process panjang,
- menggantikan step,
- menyembunyikan domain workflow kompleks.

Decision sebaiknya ringan dan deterministik.

Mental model:

```text
Decision decides. Step does.
```

---

## 22. Transition dengan Decision vs Transition Langsung dari Step

Ada dua pendekatan:

### 22.1 Transition Langsung

```xml
<step id="validateInput">
    <batchlet ref="validateInputBatchlet" />
    <next on="VALID" to="processInput" />
    <fail on="INVALID" exit-status="INVALID_INPUT" />
</step>
```

Cocok jika step sendiri sudah tahu hasil routing sederhana.

### 22.2 Decision Node

```xml
<step id="processInput" next="routeProcessingOutcome">
    <chunk item-count="500">
        <reader ref="reader" />
        <processor ref="processor" />
        <writer ref="writer" />
    </chunk>
</step>

<decision id="routeProcessingOutcome" ref="processingOutcomeDecider">
    <next on="RETRY_LATER" to="prepareRetry" />
    <next on="GENERATE_REJECT_REPORT" to="generateRejectReport" />
    <next on="SUCCESS" to="generateSuccessReport" />
</decision>
```

Cocok jika:

- routing tidak boleh digabung ke processor/writer,
- hasil perlu dibaca dari summary table,
- ada threshold dan policy,
- kamu ingin graph lebih eksplisit.

---

## 23. JSL sebagai Public Contract antara Developer dan Operator

Di production, JSL bukan hanya untuk developer. Ia juga membantu operator memahami:

- tahapan job,
- posisi failure,
- apakah job bisa restart,
- apa arti exit status,
- apakah output valid,
- apakah perlu manual action.

Karena itu, desain JSL perlu operational readability.

### 23.1 Contoh JSL Buruk

```xml
<job id="jobA" ...>
    <step id="s1" next="s2"><batchlet ref="a"/></step>
    <step id="s2" next="s3"><batchlet ref="b"/></step>
    <step id="s3"><batchlet ref="c"/></step>
</job>
```

Masalah:

- tidak jelas domainnya,
- tidak jelas fase processing,
- tidak jelas failure path,
- artifact name tidak informatif,
- operator tidak bisa membaca maksudnya.

### 23.2 Contoh Lebih Baik

```xml
<job id="nightlyLicenceRenewalEligibilityEvaluation" ...>

    <step id="validateEvaluationParameters" next="loadEligibilityRules">
        <batchlet ref="validateEligibilityParametersBatchlet" />
    </step>

    <step id="loadEligibilityRules" next="evaluateRenewalApplications">
        <batchlet ref="loadEligibilityRulesBatchlet" />
    </step>

    <step id="evaluateRenewalApplications" next="routeEvaluationOutcome">
        <chunk item-count="500">
            <reader ref="renewalApplicationReader" />
            <processor ref="renewalEligibilityProcessor" />
            <writer ref="renewalEligibilityWriter" />
        </chunk>
    </step>

    <decision id="routeEvaluationOutcome" ref="renewalEvaluationOutcomeDecider">
        <next on="HAS_REJECTS" to="generateExceptionReport" />
        <next on="ALL_PROCESSED" to="publishEvaluationSummary" />
        <fail on="THRESHOLD_EXCEEDED" exit-status="RENEWAL_REJECT_THRESHOLD_EXCEEDED" />
    </decision>

    <step id="generateExceptionReport" next="publishEvaluationSummary">
        <batchlet ref="generateRenewalExceptionReportBatchlet" />
    </step>

    <step id="publishEvaluationSummary">
        <batchlet ref="publishRenewalEvaluationSummaryBatchlet" />
    </step>
</job>
```

Readable.

The graph tells a story.

---

## 24. Chunk Element in JSL

Chunk step paling umum:

```xml
<step id="importApplicants">
    <chunk item-count="100">
        <reader ref="applicantCsvReader" />
        <processor ref="applicantNormalizer" />
        <writer ref="applicantDatabaseWriter" />
    </chunk>
</step>
```

### 24.1 `item-count`

`item-count` menentukan ukuran chunk/checkpoint interval berbasis jumlah item.

Contoh:

```xml
<chunk item-count="500">
```

Artinya runtime memproses item dan commit/checkpoint kira-kira per 500 item, tergantung detail runtime dan error handling.

Trade-off:

| Item Count | Kelebihan | Kekurangan |
|---|---|---|
| kecil | restart loss kecil, lock pendek | overhead transaction tinggi |
| besar | throughput bisa lebih baik | rollback besar, memory/lock/undo pressure lebih besar |

Tidak ada angka universal.

Mulai dari 100–1000 untuk DB batch sering masuk akal, lalu ukur.

### 24.2 Reader/Processor/Writer Separation

```text
Reader    = ambil item berikutnya
Processor = transform/validate/classify
Writer    = persist side effect per chunk
```

Boundary ini harus dijaga.

Anti-pattern:

- reader melakukan write,
- processor call API non-idempotent,
- writer melakukan heavy business classification,
- listener mengubah data utama.

### 24.3 Optional Processor

Processor bisa tidak ada jika hanya copy/import sederhana.

```xml
<chunk item-count="1000">
    <reader ref="sourceReader" />
    <writer ref="targetWriter" />
</chunk>
```

Namun untuk enterprise workload, processor eksplisit sering membantu readability.

---

## 25. Error Handling di Chunk JSL

Chunk dapat memiliki policy seperti skip/retry/rollback.

Contoh konseptual:

```xml
<step id="importApplicants">
    <chunk item-count="100">
        <reader ref="applicantCsvReader" />
        <processor ref="applicantValidator" />
        <writer ref="applicantWriter" />

        <skippable-exception-classes>
            <include class="com.example.batch.InvalidApplicantRowException" />
            <exclude class="com.example.batch.ManifestCorruptionException" />
        </skippable-exception-classes>

        <retryable-exception-classes>
            <include class="com.example.batch.TransientDatabaseException" />
        </retryable-exception-classes>
    </chunk>
</step>
```

Detail skip/retry/rollback akan dibahas penuh di Part 22.

Untuk Part 18, yang penting adalah:

> JSL tidak hanya menentukan graph antar step, tetapi juga policy eksekusi di dalam step.

Namun jangan overuse.

Jika skip/retry policy terlalu kompleks, pembacanya akan kesulitan memahami apakah output valid.

---

## 26. Listeners di JSL

Listeners memungkinkan cross-cutting behavior.

Contoh:

```xml
<job id="importJob" xmlns="https://jakarta.ee/xml/ns/jakartaee" version="2.0">
    <listeners>
        <listener ref="jobAuditListener" />
        <listener ref="jobMetricsListener" />
    </listeners>

    <step id="importRows">
        <listeners>
            <listener ref="stepMetricsListener" />
        </listeners>

        <chunk item-count="500">
            <reader ref="rowReader" />
            <processor ref="rowProcessor" />
            <writer ref="rowWriter" />
        </chunk>
    </step>
</job>
```

Listeners cocok untuk:

- metrics,
- audit hooks,
- notification,
- setup/cleanup ringan,
- observability,
- summary capture.

Listeners tidak cocok untuk menyembunyikan main business logic.

Anti-pattern:

```text
Step name: processRows
Listener: secretlyApproveCasesListener
```

Jika listener mengubah business outcome utama, graph menjadi tidak jujur.

---

## 27. Partitioning di JSL: Preview Konseptual

Partitioning akan dibahas penuh di Part 24, tetapi JSL-nya perlu dikenali.

Contoh sederhana:

```xml
<step id="processCasesByPartition">
    <chunk item-count="500">
        <reader ref="casePartitionReader" />
        <processor ref="caseProcessor" />
        <writer ref="caseWriter" />
    </chunk>

    <partition>
        <plan partitions="4" threads="4">
            <properties partition="0">
                <property name="rangeStart" value="1" />
                <property name="rangeEnd" value="10000" />
            </properties>
            <properties partition="1">
                <property name="rangeStart" value="10001" />
                <property name="rangeEnd" value="20000" />
            </properties>
            <properties partition="2">
                <property name="rangeStart" value="20001" />
                <property name="rangeEnd" value="30000" />
            </properties>
            <properties partition="3">
                <property name="rangeStart" value="30001" />
                <property name="rangeEnd" value="40000" />
            </properties>
        </plan>
    </partition>
</step>
```

Mental model:

```text
Same step definition
    partition 0: range 1-10000
    partition 1: range 10001-20000
    partition 2: range 20001-30000
    partition 3: range 30001-40000
```

Partitioning adalah internal parallelization of a step.

Jangan bingung dengan split.

---

## 28. Inheritance dan Reuse di JSL

Beberapa implementation mendukung konsep inheritance/parent untuk step/job/flow sesuai spesifikasi dan implementasi terkait.

Contoh pola:

```xml
<step id="abstractImportStep" abstract="true">
    <chunk item-count="500">
        <reader ref="defaultReader" />
        <processor ref="defaultProcessor" />
        <writer ref="defaultWriter" />
    </chunk>
</step>

<step id="importApplicants" parent="abstractImportStep">
    <properties>
        <property name="inputType" value="APPLICANT" />
    </properties>
</step>
```

Manfaat:

- mengurangi duplikasi,
- standardisasi step policy,
- reusable job templates.

Risiko:

- graph sulit dibaca,
- behavior tersebar ke banyak file,
- operator/dev baru sulit memahami final resolved job,
- migration antar runtime bisa lebih sensitif.

Rule of thumb:

> Reuse JSL hanya jika mengurangi duplikasi tanpa mengorbankan readability execution graph.

Untuk sistem regulatory yang butuh defensibility, explicitness sering lebih berharga daripada DRY ekstrem.

---

## 29. Placement dan Packaging JSL

Dalam Jakarta Batch, file job XML biasanya diletakkan di lokasi yang dikenali runtime, seperti:

```text
META-INF/batch-jobs/<job-name>.xml
```

Contoh:

```text
src/main/resources/META-INF/batch-jobs/nightlyCaseAgeingRecalculation.xml
```

Lalu dipanggil:

```java
JobOperator jobOperator = BatchRuntime.getJobOperator();
long executionId = jobOperator.start("nightlyCaseAgeingRecalculation", parameters);
```

Nama yang diberikan ke `start()` mengacu ke job XML/job name sesuai runtime convention.

Checklist packaging:

- file berada di path yang benar,
- job id sesuai dengan nama yang dipakai operator,
- artifact `ref` dapat ditemukan CDI/batch runtime,
- namespace/schema sesuai runtime,
- semua class ada dalam deployment artifact,
- tidak ada duplikasi job id antar module yang bentrok.

---

## 30. Artifact Resolution: `ref` Bukan Detail Kecil

Contoh:

```xml
<batchlet ref="validateInputBatchlet" />
```

Runtime perlu menemukan artifact bernama `validateInputBatchlet`.

Biasanya artifact Java diberi nama:

```java
@Named("validateInputBatchlet")
@Dependent
public class ValidateInputBatchlet implements Batchlet {
    ...
}
```

Atau dengan default bean name tergantung CDI naming convention.

Prinsip:

- gunakan explicit `@Named("...")`,
- samakan dengan `ref` di JSL,
- hindari nama ambigu,
- test job startup,
- fail fast jika artifact tidak ditemukan.

Anti-pattern:

```xml
<batchlet ref="processor" />
```

Nama terlalu generic.

Lebih baik:

```xml
<batchlet ref="validateCaseImportManifestBatchlet" />
```

---

## 31. Designing Exit Status Taxonomy

Exit status adalah bahasa routing.

Jika tidak didesain, graph menjadi rawan.

### 31.1 Kategori Exit Status

Gunakan taxonomy:

```text
Success-like:
- COMPLETED
- NO_DATA
- ALREADY_PROCESSED
- DRY_RUN_VALID

Business validation:
- INVALID_INPUT
- INVALID_MANIFEST
- CHECKSUM_MISMATCH
- REJECT_THRESHOLD_EXCEEDED

Partial outcome:
- PARTIAL_SUCCESS
- HAS_REJECTS
- COMPLETED_WITH_WARNINGS

Retryable condition:
- EXTERNAL_SYSTEM_UNAVAILABLE
- TEMPORARY_DB_CONTENTION
- MAINTENANCE_WINDOW_CLOSED

Unexpected:
- UNEXPECTED_ERROR
- UNEXPECTED_EXIT_STATUS
```

### 31.2 Exit Status Jangan Terlalu Teknis

Buruk:

```text
NULL_POINTER_EXCEPTION
ORA_00054
HTTP_500
```

Lebih baik:

```text
UNEXPECTED_PROCESSING_ERROR
DATABASE_RESOURCE_BUSY
EXTERNAL_REGISTRY_UNAVAILABLE
```

Detail teknis tetap masuk log/diagnostic. Exit status menjadi semantic signal.

### 31.3 Exit Status Jangan Terlalu Umum

Buruk:

```text
ERROR
FAILED
NOT_OK
```

Tidak membantu routing dan operasi.

---

## 32. JSL Graph Design Method

Untuk mendesain JSL yang baik, jangan mulai dari XML.

Mulai dari graph.

### Step 1 — Definisikan Outcome Job

Pertanyaan:

- Apa arti sukses?
- Apa arti no-op?
- Apa arti partial success?
- Apa yang harus dianggap failed?
- Apa yang harus stopped/restartable?

Contoh:

```text
Job: nightlyCaseAgeingRecalculation

Outcomes:
- COMPLETED / ALL_CASES_RECALCULATED
- COMPLETED / NO_ELIGIBLE_CASES
- FAILED / INVALID_BUSINESS_DATE
- FAILED / CASE_DATA_INCONSISTENT
- STOPPED / MAINTENANCE_WINDOW_CLOSED
```

### Step 2 — Pecah Menjadi Fase

```text
Preparation
Processing
Post-processing
Notification
Cleanup
```

### Step 3 — Tentukan Step

```text
Preparation:
- validateParameters
- loadAgeingRules
- detectEligibleCases

Processing:
- recalculateCaseAgeing

Post-processing:
- generateAgeingSummary
- publishMetrics
```

### Step 4 — Tentukan Boundary Batchlet vs Chunk

```text
validateParameters       -> batchlet
loadAgeingRules          -> batchlet
detectEligibleCases      -> batchlet
recalculateCaseAgeing    -> chunk
generateAgeingSummary    -> batchlet
publishMetrics           -> batchlet
```

### Step 5 — Tentukan Transisi

```text
validateParameters:
- VALID -> loadAgeingRules
- INVALID -> fail

loadAgeingRules:
- LOADED -> detectEligibleCases
- NO_RULES -> fail

detectEligibleCases:
- HAS_CASES -> recalculateCaseAgeing
- NO_CASES -> end(NO_ELIGIBLE_CASES)

recalculateCaseAgeing:
- COMPLETED -> generateAgeingSummary
- PARTIAL_SUCCESS -> generateExceptionSummary
- FAILED -> fail
```

### Step 6 — Baru Tulis XML

Setelah graph jelas, JSL menjadi transcription, bukan brainstorming medium.

---

## 33. Example: Regulatory Case Ageing JSL

Contoh lengkap:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<job id="nightlyCaseAgeingRecalculation"
     xmlns="https://jakarta.ee/xml/ns/jakartaee"
     version="2.0">

    <properties>
        <property name="defaultChunkSize" value="500" />
        <property name="auditCategory" value="CASE_AGEING_RECALCULATION" />
    </properties>

    <listeners>
        <listener ref="batchJobAuditListener" />
        <listener ref="batchMetricsListener" />
    </listeners>

    <step id="validateParameters">
        <batchlet ref="validateCaseAgeingParametersBatchlet" />

        <next on="VALID" to="loadAgeingRules" />
        <fail on="INVALID_BUSINESS_DATE" exit-status="INVALID_BUSINESS_DATE" />
        <fail on="INVALID_AGENCY" exit-status="INVALID_AGENCY" />
        <fail on="*" exit-status="UNEXPECTED_PARAMETER_VALIDATION_RESULT" />
    </step>

    <step id="loadAgeingRules">
        <batchlet ref="loadAgeingRulesBatchlet" />

        <next on="LOADED" to="detectEligibleCases" />
        <fail on="NO_RULES" exit-status="AGEING_RULES_NOT_FOUND" />
        <fail on="*" exit-status="UNEXPECTED_RULE_LOADING_RESULT" />
    </step>

    <step id="detectEligibleCases">
        <batchlet ref="detectEligibleCasesBatchlet" />

        <next on="HAS_CASES" to="recalculateCaseAgeing" />
        <end on="NO_CASES" exit-status="NO_ELIGIBLE_CASES" />
        <fail on="*" exit-status="UNEXPECTED_ELIGIBILITY_DETECTION_RESULT" />
    </step>

    <step id="recalculateCaseAgeing" next="routeAfterRecalculation">
        <chunk item-count="500">
            <reader ref="eligibleCaseReader" />
            <processor ref="caseAgeingProcessor" />
            <writer ref="caseAgeingWriter" />
        </chunk>
    </step>

    <decision id="routeAfterRecalculation" ref="caseAgeingOutcomeDecider">
        <next on="ALL_SUCCESS" to="generateSuccessSummary" />
        <next on="HAS_RECORD_ERRORS" to="generateExceptionSummary" />
        <fail on="ERROR_THRESHOLD_EXCEEDED" exit-status="CASE_AGEING_ERROR_THRESHOLD_EXCEEDED" />
        <fail on="*" exit-status="UNEXPECTED_RECALCULATION_OUTCOME" />
    </decision>

    <step id="generateExceptionSummary" next="publishSummary">
        <batchlet ref="generateCaseAgeingExceptionSummaryBatchlet" />
    </step>

    <step id="generateSuccessSummary" next="publishSummary">
        <batchlet ref="generateCaseAgeingSuccessSummaryBatchlet" />
    </step>

    <step id="publishSummary">
        <batchlet ref="publishCaseAgeingSummaryBatchlet" />
    </step>
</job>
```

### 33.1 Graph View

```text
validateParameters
    VALID -> loadAgeingRules
    INVALID_* -> FAIL

loadAgeingRules
    LOADED -> detectEligibleCases
    NO_RULES -> FAIL

detectEligibleCases
    HAS_CASES -> recalculateCaseAgeing
    NO_CASES -> END(COMPLETED, NO_ELIGIBLE_CASES)

recalculateCaseAgeing
    -> routeAfterRecalculation

routeAfterRecalculation
    ALL_SUCCESS -> generateSuccessSummary -> publishSummary
    HAS_RECORD_ERRORS -> generateExceptionSummary -> publishSummary
    ERROR_THRESHOLD_EXCEEDED -> FAIL
```

### 33.2 Kenapa Desain Ini Baik?

- Parameter validation eksplisit.
- No data dianggap completed dengan exit status khusus.
- Chunk processing dipisah dari routing outcome.
- Decision node membaca summary, bukan processor yang menentukan seluruh graph.
- Exception summary dan success summary terpisah.
- Fallback `*` mencegah exit status tidak dikenal diam-diam dianggap sukses.
- Operator bisa menjelaskan job state dari step name.

---

## 34. Example: File Import dengan Quarantine Path

Scenario:

- validate manifest,
- validate file checksum,
- import rows,
- route outcome,
- move file ke archive atau quarantine.

```xml
<job id="licenceApplicationCsvImport"
     xmlns="https://jakarta.ee/xml/ns/jakartaee"
     version="2.0">

    <step id="validateInputManifest">
        <batchlet ref="validateInputManifestBatchlet" />

        <next on="VALID" to="verifyFileChecksum" />
        <fail on="MISSING_MANIFEST" exit-status="MISSING_INPUT_MANIFEST" />
        <fail on="INVALID_MANIFEST" exit-status="INVALID_INPUT_MANIFEST" />
    </step>

    <step id="verifyFileChecksum">
        <batchlet ref="verifyFileChecksumBatchlet" />

        <next on="MATCH" to="importCsvRows" />
        <fail on="MISMATCH" exit-status="INPUT_FILE_CHECKSUM_MISMATCH" />
    </step>

    <step id="importCsvRows" next="routeImportOutcome">
        <chunk item-count="250">
            <reader ref="licenceApplicationCsvReader" />
            <processor ref="licenceApplicationRowProcessor" />
            <writer ref="licenceApplicationWriter" />
        </chunk>
    </step>

    <decision id="routeImportOutcome" ref="csvImportOutcomeDecider">
        <next on="ALL_ACCEPTED" to="archiveInputFile" />
        <next on="HAS_REJECTS" to="generateRejectReport" />
        <fail on="TOO_MANY_REJECTS" exit-status="CSV_REJECT_THRESHOLD_EXCEEDED" />
    </decision>

    <step id="generateRejectReport" next="quarantineInputFile">
        <batchlet ref="generateCsvRejectReportBatchlet" />
    </step>

    <step id="quarantineInputFile">
        <batchlet ref="quarantineInputFileBatchlet" />
    </step>

    <step id="archiveInputFile">
        <batchlet ref="archiveInputFileBatchlet" />
    </step>
</job>
```

Graph tells clear business semantics:

```text
valid file + all rows accepted -> archive
valid file + some rejects -> reject report + quarantine
invalid manifest/checksum -> fail
```

---

## 35. Example: Parallel Preparation dengan Split

Scenario:

Sebelum processing besar, job perlu:

- load business rules,
- warm reference cache,
- verify downstream availability.

Ketiganya independen.

```xml
<job id="enforcementEscalationEvaluation"
     xmlns="https://jakarta.ee/xml/ns/jakartaee"
     version="2.0">

    <step id="validateEvaluationRequest" next="parallelPreparation">
        <batchlet ref="validateEvaluationRequestBatchlet" />
    </step>

    <split id="parallelPreparation" next="evaluateEscalationCandidates">
        <flow id="loadEscalationRulesFlow">
            <step id="loadEscalationRules">
                <batchlet ref="loadEscalationRulesBatchlet" />
            </step>
        </flow>

        <flow id="prepareReferenceDataFlow">
            <step id="prepareReferenceData">
                <batchlet ref="prepareReferenceDataBatchlet" />
            </step>
        </flow>

        <flow id="checkNotificationDependencyFlow">
            <step id="checkNotificationDependency">
                <batchlet ref="checkNotificationDependencyBatchlet" />
            </step>
        </flow>
    </split>

    <step id="evaluateEscalationCandidates" next="publishEscalationSummary">
        <chunk item-count="500">
            <reader ref="escalationCandidateReader" />
            <processor ref="escalationCandidateProcessor" />
            <writer ref="escalationDecisionWriter" />
        </chunk>
    </step>

    <step id="publishEscalationSummary">
        <batchlet ref="publishEscalationSummaryBatchlet" />
    </step>
</job>
```

### 35.1 Pertanyaan Wajib Sebelum Memakai Split

- Apakah branch benar-benar independen?
- Apakah semua branch idempotent?
- Apa yang terjadi jika satu branch gagal?
- Apakah DB pool cukup?
- Apakah downstream rate limit cukup?
- Apakah thread pool batch runtime cukup?
- Apakah log/metrics bisa membedakan branch?
- Apakah operator bisa tahu branch mana yang gagal?

Kalau tidak bisa menjawab, jangan pakai split dulu.

---

## 36. Designing for Restartability from JSL

JSL bukan hanya menentukan urutan. JSL menentukan restart behavior secara tidak langsung.

Pertanyaan restartability:

1. Jika job gagal di step X, step mana yang harus diulang?
2. Apakah step sebelumnya idempotent?
3. Apakah output step sebelumnya durable?
4. Apakah step berikutnya bisa membaca state intermediate?
5. Apakah `stop` transition mengarah ke restart point yang benar?
6. Apakah chunk checkpoint cukup sering?
7. Apakah file move/archive dilakukan terlalu awal?
8. Apakah notification dikirim sebelum semua data committed?

### 36.1 Bad Restart Design

```text
processRows -> sendNotifications -> generateSummary
```

Jika `generateSummary` gagal, restart bisa mengirim notification dua kali jika tidak idempotent.

Lebih baik:

```text
processRows -> generateSummary -> enqueueNotifications -> markJobComplete
```

Atau gunakan outbox:

```text
processRows writes notification intents
publishNotificationOutbox publishes idempotently
```

### 36.2 JSL Ordering Matters

Jangan menaruh irreversible side effect terlalu awal.

Urutan aman biasanya:

```text
validate -> process durable state -> generate durable summary -> publish side effects idempotently -> archive/cleanup
```

---

## 37. JSL dan Transaction Boundary

JSL tidak otomatis membuat seluruh job dalam satu transaksi.

Itu justru bagus.

Batch job besar tidak boleh satu transaksi panjang.

Pada chunk step, transaksi biasanya per chunk.

Pada batchlet, transaksi tergantung artifact/container/interceptor/resource usage.

Design implication:

- Setiap step harus valid sebagai unit recovery.
- Setiap chunk harus aman diulang.
- Writer harus idempotent atau deduplicated.
- Transition tidak boleh mengasumsikan semua job atomic.

Mental model:

```text
JSL graph controls execution order.
Transaction controls resource commit boundary.
Checkpoint controls restart boundary.
Idempotency controls duplicate safety.
```

Keempatnya berbeda.

---

## 38. JSL dan Observability

JSL yang baik memudahkan observability.

Step names menjadi metric labels.

Contoh metrics:

```text
batch_job_execution_duration_seconds{job="nightlyCaseAgeingRecalculation"}
batch_step_execution_duration_seconds{job="nightlyCaseAgeingRecalculation", step="recalculateCaseAgeing"}
batch_step_read_count{step="recalculateCaseAgeing"}
batch_step_write_count{step="recalculateCaseAgeing"}
batch_step_skip_count{step="recalculateCaseAgeing"}
batch_transition_count{from="detectEligibleCases", exitStatus="NO_CASES", to="END"}
```

Jika step namanya `step1`, metrics menjadi tidak berguna.

### 38.1 Audit-friendly JSL

Untuk regulatory system, JSL sebaiknya mendukung audit story:

```text
Job requested by scheduler for business date 2026-06-17.
validateParameters completed VALID.
loadAgeingRules completed LOADED using rule version R-2026-06.
detectEligibleCases completed HAS_CASES with 12,430 eligible cases.
recalculateCaseAgeing processed 12,430 cases, skipped 0, failed 0.
generateSuccessSummary produced manifest M-20260617-001.
publishSummary completed.
Job completed ALL_SUCCESS.
```

Desain JSL memengaruhi kualitas cerita audit.

---

## 39. JSL dan Operational Control Plane

Control plane biasanya menyediakan API/UI untuk:

- start job,
- stop job,
- restart job,
- inspect job execution,
- inspect step execution,
- view parameters,
- view exit status,
- download report,
- view audit trail.

JSL membantu control plane karena graph-nya diketahui.

### 39.1 Job Catalog

Sistem enterprise sebaiknya punya job catalog:

| Job ID | Purpose | Parameters | Restartable | Schedule | Owner |
|---|---|---|---|---|---|
| nightlyCaseAgeingRecalculation | Recalculate case ageing | businessDate, agency | yes | nightly | Case Ops |
| licenceApplicationCsvImport | Import application CSV | manifestId | yes | ad-hoc | Licensing Ops |
| enforcementEscalationEvaluation | Evaluate escalation candidates | businessDate | yes | nightly | Enforcement Ops |

Setiap JSL harus bisa dipetakan ke catalog.

---

## 40. XML Spaghetti: Gejala dan Pencegahan

### 40.1 Gejala XML Spaghetti

- Terlalu banyak transition dalam satu step.
- Exit status terlalu banyak dan tidak terdokumentasi.
- Decision chain panjang.
- Flow nested tanpa alasan kuat.
- Split dipakai untuk hal yang tidak independen.
- Listener mengubah routing secara tidak terlihat.
- Step ID generik.
- Business rules besar tersebar di XML.
- Tidak ada fallback transition.
- Operator tidak bisa menggambar graph tanpa membaca Java code.

### 40.2 Pencegahan

Gunakan prinsip:

```text
1 job = 1 clear workload
1 step = 1 clear responsibility
1 decision = 1 routing question
1 flow = 1 phase/subgraph
1 split = independent parallel flows only
exit status = stable semantic contract
```

### 40.3 Batasi Kompleksitas Graph

Jika graph sudah terlalu kompleks, mungkin kamu butuh:

- memecah job menjadi beberapa job,
- memakai job request/outbox orchestration,
- memakai workflow engine,
- memakai domain state machine,
- membuat control plane yang mengatur beberapa batch job.

Jangan memaksa seluruh lifecycle bisnis masuk ke satu JSL.

---

## 41. Testing JSL

JSL harus dites, bukan hanya artifact Java.

### 41.1 Test Validity

- XML valid.
- Namespace benar.
- Artifact `ref` resolvable.
- Step/flow/split/decision target ada.
- Tidak ada transition ke ID salah.
- Tidak ada duplicate ID.

### 41.2 Test Graph Path

Untuk setiap exit status penting:

```text
validateInput returns VALID -> processInput runs
validateInput returns EMPTY_INPUT -> job ends NO_DATA
validateInput returns INVALID -> job fails INVALID_INPUT
```

### 41.3 Test Restart

- gagal di step pertama,
- gagal di tengah chunk,
- gagal setelah writer commit,
- gagal setelah report generated,
- gagal sebelum notification,
- stop request di tengah chunk,
- restart after stopped.

### 41.4 Test Unknown Exit Status

Pastikan fallback aman.

```xml
<fail on="*" exit-status="UNEXPECTED_EXIT_STATUS" />
```

Tanpa fallback, behavior bisa membingungkan atau bergantung default runtime.

---

## 42. Versioning JSL

Batch job berubah seiring bisnis berubah.

Masalah:

- execution lama masih ada di repository,
- restart execution lama mungkin memakai definisi job baru,
- parameter lama mungkin tidak cocok,
- step ID berubah bisa merusak restartability/operability,
- report/audit lama perlu dijelaskan sesuai versi lama.

### 42.1 Strategi Versioning

#### Option A — Version in Job ID

```xml
<job id="nightlyCaseAgeingRecalculationV2" ...>
```

Kelebihan:

- eksplisit,
- aman untuk breaking change.

Kekurangan:

- job catalog bertambah,
- scheduler/control plane perlu update.

#### Option B — Version in Parameter

```text
job = nightlyCaseAgeingRecalculation
parameter ruleVersion = 2026-06
```

Kelebihan:

- cocok jika graph sama, rules berubah.

Kekurangan:

- tidak cocok jika graph berubah drastis.

#### Option C — Version in Artifact Logic

Artifact memilih behavior berdasarkan config/rule version.

Kelebihan:

- fleksibel.

Kekurangan:

- behavior lebih tersembunyi.

### 42.2 Rule

- Jika graph berubah breaking, pertimbangkan job ID baru.
- Jika rules berubah tapi graph sama, gunakan parameter/rule version.
- Jangan rename step ID sembarangan jika ada restart/reconciliation dependency.

---

## 43. JSL Review Checklist

Gunakan checklist ini saat code review.

### 43.1 Naming

- [ ] Job ID jelas dan domain-specific.
- [ ] Step ID menjelaskan action/outcome.
- [ ] Flow ID menjelaskan phase.
- [ ] Split ID menjelaskan parallel group.
- [ ] Decision ID menjelaskan routing question.
- [ ] Artifact ref jelas dan tidak generic.

### 43.2 Graph

- [ ] Happy path jelas.
- [ ] Failure path jelas.
- [ ] No-data path jelas.
- [ ] Partial-success path jelas jika relevan.
- [ ] Stop/restart path jelas jika relevan.
- [ ] Tidak ada transition target yang ambigu.
- [ ] Tidak ada complex hidden loop.

### 43.3 Exit Status

- [ ] Exit status taxonomy konsisten.
- [ ] Exit status tidak terlalu teknis.
- [ ] Exit status tidak terlalu generic.
- [ ] Fallback `*` tersedia untuk branch kritikal.
- [ ] Constants/test menjaga sinkronisasi Java dan XML.

### 43.4 Operational Safety

- [ ] Irreversible side effect ditempatkan aman.
- [ ] Notification idempotent.
- [ ] File archive/quarantine aman untuk restart.
- [ ] Job parameters tidak menyimpan secret.
- [ ] Audit listener tidak menyembunyikan business logic.
- [ ] Metrics bisa menggunakan job/step names.

### 43.5 Capacity

- [ ] Split hanya untuk branch independen.
- [ ] Partitioning tidak dipakai tanpa capacity planning.
- [ ] Chunk size punya alasan awal.
- [ ] DB/API pressure dipertimbangkan.

---

## 44. Anti-Patterns

### 44.1 “XML as Business Rule Dump”

Terlalu banyak routing rule bisnis di JSL.

Masalah:

- sulit dites,
- sulit refactor,
- sulit versioning,
- XML menjadi domain language palsu.

Lebih baik:

- business classification di Java artifact,
- JSL hanya routing high-level outcome.

### 44.2 “Everything Is a Batchlet”

Semua step dibuat batchlet berisi loop manual.

Masalah:

- kehilangan checkpoint chunk,
- restartability manual,
- skip/retry manual,
- metrics read/write/skip tidak natural.

Gunakan chunk untuk item processing.

### 44.3 “One Giant Chunk Step”

Satu chunk step melakukan semua hal:

- read,
- validate,
- enrich,
- write,
- report,
- notify,
- archive.

Masalah:

- restart sulit,
- side effect campur,
- observability buruk.

Pecah menjadi step yang meaningful.

### 44.4 “Split for Speed Without Capacity Model”

Memakai split/partition hanya agar cepat.

Masalah:

- DB pool exhausted,
- downstream 429,
- lock contention,
- retry storm,
- noisy neighbor.

Concurrency harus mengikuti capacity.

### 44.5 “No Fallback Transition”

Step mengembalikan exit status baru, XML tidak tahu.

Akibat:

- job flow tidak sesuai harapan,
- behavior runtime membingungkan,
- operator sulit diagnosis.

Gunakan fallback eksplisit.

### 44.6 “Listener Does the Real Work”

Listener menjalankan business side effect utama.

Masalah:

- graph bohong,
- restart behavior tidak jelas,
- audit sulit,
- testing sulit.

Listener untuk cross-cutting, bukan core workflow.

### 44.7 “Job Parameters as Data Payload”

Memasukkan payload besar ke parameter.

Masalah:

- repository bengkak,
- log bocor,
- query sulit,
- performance buruk.

Parameter harus pointer/identifier, bukan payload besar.

---

## 45. Design Heuristics untuk Top 1% Engineer

### 45.1 Make the Graph Honest

Jika sesuatu penting secara bisnis/operasional, munculkan sebagai step/decision/transition.

Jangan sembunyikan di listener atau helper.

### 45.2 Separate Doing from Deciding

- Step melakukan pekerjaan.
- Decision menentukan rute.
- Transition mengungkap konsekuensi.

### 45.3 Treat Exit Status as API

Exit status adalah contract antara Java artifact, JSL, operator, metrics, dan audit.

Version dan test seperti API.

### 45.4 Prefer Explicit over Clever

Dalam batch enterprise, readability dan recovery lebih penting daripada XML ringkas.

### 45.5 Design for Restart Before Performance

Batch yang cepat tapi tidak bisa dipulihkan adalah liability.

Urutan prioritas:

1. correctness,
2. idempotency,
3. restartability,
4. observability,
5. capacity safety,
6. throughput.

### 45.6 Do Not Confuse Batch Graph with Business Lifecycle

Batch graph adalah execution plan untuk workload.

Business lifecycle tetap sebaiknya dimodelkan di domain/state machine/workflow yang sesuai.

---

## 46. Mini Case Study: Salah Desain vs Benar Desain

### 46.1 Salah Desain

```xml
<job id="caseJob" ...>
    <step id="processEverything">
        <batchlet ref="caseBatchlet" />
    </step>
</job>
```

Di dalam `caseBatchlet`:

```text
validate parameters
load rules
find cases
process cases in loop
write DB
call notification API
generate report
archive file
send email
```

Masalah:

- tidak ada checkpoint,
- restart manual,
- operator hanya tahu gagal di `processEverything`,
- side effect bisa duplicate,
- audit story buruk,
- tidak ada read/write/skip metrics granular,
- sulit split/scale.

### 46.2 Lebih Baik

```text
validateParameters
loadRules
detectEligibleCases
processCases(chunk)
generateSummary
publishNotificationOutbox
archiveInput
```

JSL merepresentasikan fase nyata.

Artifact menjadi lebih kecil.

Restart path bisa didesain.

---

## 47. Practice: Cara Membaca JSL dalam 5 Menit

Ketika menerima JSL baru, lakukan ini:

1. Cari `job id`.
2. Tulis semua execution element:
   - step,
   - flow,
   - split,
   - decision.
3. Gambar happy path.
4. Gambar failure path.
5. Cari `end/fail/stop`.
6. Cari wildcard `*`.
7. Cari split/partition.
8. Tandai step yang punya side effect irreversible.
9. Tandai step chunk dan item-count.
10. Cocokkan artifact `ref` dengan class Java.
11. Lihat listener: apakah hanya cross-cutting?
12. Tanyakan: “kalau gagal di sini, restart dari mana dan apa yang terjadi?”

Kalau kamu tidak bisa menjawab nomor 12, JSL belum production-ready.

---

## 48. Thought Experiment

Bayangkan job berikut:

```text
import file -> process rows -> send notification -> archive file
```

Job gagal setelah notification terkirim tetapi sebelum archive file.

Pertanyaan:

1. Jika job di-restart, apakah notification terkirim lagi?
2. Apakah archive file idempotent?
3. Apakah process rows idempotent?
4. Apakah job bisa tahu row mana yang sudah diproses?
5. Apakah summary report akan double count?
6. Apakah operator bisa tahu apakah output sudah aman?
7. Apakah JSL menunjukkan side effect notification sebagai step eksplisit?

Desain lebih aman:

```text
validate file
import rows(chunk, idempotent writer)
generate import summary
write notification outbox
publish notification outbox(idempotent)
archive file(idempotent)
```

Dan setiap step punya exit status yang jelas.

---

## 49. Ringkasan

JSL adalah inti dari Jakarta Batch karena ia mendefinisikan execution graph job.

Cara pikir yang tepat:

```text
JSL = durable, restart-aware execution graph declaration
```

Bukan:

```text
JSL = XML config tempat menaruh urutan step
```

Hal paling penting dari Part 18:

1. `job` adalah root execution definition.
2. `step` adalah node kerja utama.
3. `batchlet` cocok untuk task-oriented step.
4. `chunk` cocok untuk item-oriented processing dengan checkpoint.
5. `next`, `end`, `fail`, dan `stop` membentuk edge dan terminal behavior.
6. `BatchStatus` adalah lifecycle status; `ExitStatus` adalah semantic routing status.
7. `flow` adalah subgraph yang berjalan sebagai unit.
8. `split` menjalankan flow paralel, bukan membagi data seperti partitioning.
9. `decision` menentukan routing, bukan tempat melakukan pekerjaan berat.
10. Naming job/step/flow/decision adalah operational contract.
11. Exit status harus didesain sebagai API.
12. JSL yang baik membuat happy path, failure path, no-op path, partial path, dan restart path terlihat.
13. Hindari XML spaghetti dan hidden business logic di listener.
14. Untuk workload enterprise/regulatory, graph harus bisa dijelaskan kepada developer, operator, auditor, dan incident responder.

---

## 50. Checklist Akhir Part 18

Sebuah JSL production-grade seharusnya memenuhi:

- [ ] Job ID jelas.
- [ ] Step ID jelas.
- [ ] Graph bisa digambar tanpa membaca seluruh Java code.
- [ ] Happy path eksplisit.
- [ ] Failure path eksplisit.
- [ ] No-data path eksplisit jika relevan.
- [ ] Partial-success path eksplisit jika relevan.
- [ ] Stop/restart path jelas jika digunakan.
- [ ] Exit status taxonomy konsisten.
- [ ] Wildcard fallback tersedia untuk branch kritikal.
- [ ] Chunk digunakan untuk item processing besar.
- [ ] Batchlet digunakan untuk task-oriented step.
- [ ] Split hanya untuk independent flows.
- [ ] Decision hanya untuk routing ringan.
- [ ] Listener tidak menyembunyikan business logic utama.
- [ ] Job parameters tidak membawa secret/payload besar.
- [ ] Side effect irreversible ditempatkan setelah durable state/summary.
- [ ] Restart behavior bisa dijelaskan step-by-step.

---

## 51. Materi Berikutnya

Part berikutnya:

```text
Part 19 — Batchlet Model: Task-Oriented Batch Work
File: 19-batchlet-model-task-oriented-batch-work.md
```

Fokus berikutnya:

- lifecycle `Batchlet`,
- `process()` dan `stop()`,
- cancellation-safe batchlet,
- batchlet untuk file movement, report generation, external maintenance, dan system task,
- kapan batchlet tepat,
- kapan batchlet berubah menjadi anti-pattern karena menyembunyikan loop besar dan restartability manual.
