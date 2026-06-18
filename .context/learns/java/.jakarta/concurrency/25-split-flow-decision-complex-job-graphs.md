# Part 25 — Split, Flow, Decision, and Complex Job Graphs

> Seri: `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
> File: `25-split-flow-decision-complex-job-graphs.md`  
> Fokus: Jakarta Batch JSL sebagai execution graph, bukan sekadar XML urutan step.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membaca JSL Jakarta Batch sebagai **graph eksekusi**: node, edge, transition, terminal state, dan routing.
2. Membedakan penggunaan `step`, `flow`, `split`, dan `decision` secara konseptual dan praktis.
3. Mendesain batch job kompleks tanpa membuat XML spaghetti.
4. Memahami konsekuensi paralelisme pada `split` terhadap transaction, resource usage, checkpoint, restart, audit, dan observability.
5. Menggunakan `exit status` sebagai **kontrak antar node**, bukan string acak.
6. Merancang decision logic yang deterministic, auditable, restart-safe, dan tidak menyembunyikan business process besar di dalam `Decider`.
7. Menentukan kapan Jakarta Batch cukup, dan kapan kompleksitas sudah lebih cocok untuk workflow engine/BPMN/orchestrator eksternal.

---

## 2. Problem yang Diselesaikan

Pada batch sederhana, alur biasanya seperti ini:

```text
read -> process -> write -> done
```

Atau:

```text
stepA -> stepB -> stepC
```

Namun sistem enterprise jarang sesederhana itu. Dalam regulatory/case-management platform, job bisa memiliki kebutuhan seperti:

```text
1. Validate input manifest
2. Jika invalid -> stop dengan status BUSINESS_REJECTED
3. Jika valid -> proses data utama
4. Secara paralel:
   - generate audit summary
   - generate exception report
   - notify downstream registry
5. Jika exception terlalu banyak -> route ke manual review
6. Jika aman -> publish final output
7. Jika publish gagal transient -> retry/restart-safe
8. Jika publish gagal permanen -> fail secara eksplisit
```

Kalau semua ini ditulis sebagai kode imperatif besar dalam satu batchlet:

```java
public String process() {
    validate();
    if (...) {
        ...
    }
    runA();
    runB();
    runC();
    if (...) {
        ...
    }
    publish();
    return "COMPLETED";
}
```

maka runtime kehilangan banyak hal penting:

- visibility per step,
- restart point yang jelas,
- operational control,
- audit boundary,
- transition reason,
- metrics per phase,
- partial failure model,
- ability to stop/restart dengan benar.

JSL graph menyelesaikan ini dengan membuat alur batch menjadi **deklaratif**.

Namun graph yang terlalu rumit juga bisa menjadi masalah baru:

- XML sulit dibaca,
- terlalu banyak status string,
- decision logic tersebar,
- restart behavior tidak jelas,
- parallel split membuat resource contention,
- flow menyerupai BPMN tetapi tanpa governance BPMN.

Bagian ini membahas cara mendesain graph yang cukup ekspresif, tetapi tetap terkontrol.

---

## 3. Mental Model: Job sebagai Directed Execution Graph

Jangan pikirkan JSL sebagai file konfigurasi. Pikirkan sebagai graph:

```text
Node = step | flow | split | decision
Edge = transition: next | end | fail | stop
State = batch status + exit status
Runtime = graph interpreter + repository + artifact invoker
```

Secara mental:

```text
            ┌─────────────┐
            │ validate    │
            └──────┬──────┘
                   │ exitStatus
                   ▼
            ┌─────────────┐
            │ decision    │
            └──────┬──────┘
        VALID      │      INVALID
          ┌────────┴────────┐
          ▼                 ▼
   ┌─────────────┐    ┌─────────────┐
   │ main chunk  │    │ reject/end  │
   └──────┬──────┘    └─────────────┘
          ▼
   ┌─────────────┐
   │ split       │
   └──────┬──────┘
          ▼ all flows complete
   ┌─────────────┐
   │ publish     │
   └─────────────┘
```

Graph ini memiliki beberapa invariant:

1. **Node harus punya tanggung jawab jelas.**  
   Jangan membuat satu node melakukan seluruh business process.

2. **Edge harus punya alasan eksplisit.**  
   Transition tidak boleh hanya `COMPLETED -> next`; sering kali perlu business meaning.

3. **Exit status harus menjadi kontrak.**  
   Contoh: `VALID`, `INVALID_MANIFEST`, `PARTIAL_SUCCESS`, `TOO_MANY_ERRORS`, `READY_TO_PUBLISH`.

4. **Parallel branch harus independen atau terkoordinasi dengan jelas.**  
   Kalau dua flow dalam split menulis resource yang sama tanpa boundary, itu race condition enterprise.

5. **Restart harus bisa dijelaskan dari graph.**  
   Operator harus bisa bertanya: “Jika job gagal di node ini, restart mulai dari mana, dan side effect mana yang mungkin sudah terjadi?”

---

## 4. Primitive Utama dalam JSL Graph

Jakarta Batch JSL menyediakan beberapa building block utama:

| Primitive | Makna | Cocok untuk |
|---|---|---|
| `step` | Unit kerja eksekusi | Chunk/batchlet konkret |
| `flow` | Sequence execution elements sebagai unit | Mengelompokkan alur terkait |
| `split` | Beberapa flow berjalan paralel | Parallel branch yang relatif independen |
| `decision` | Routing berdasarkan hasil sebelumnya | Conditional flow |
| `next` | Lanjut ke node lain | Normal transition |
| `end` | Job selesai normal dengan optional exit status | Terminal success/controlled completion |
| `fail` | Job gagal | Terminal failure |
| `stop` | Job berhenti dan bisa restart ke target tertentu | Controlled stop/restart |

Spesifikasi Jakarta Batch mendefinisikan bahwa `flow` dapat berisi `step`, `flow`, `decision`, dan `split`; sedangkan `split` berisi beberapa `flow` yang berjalan secara concurrent dan split dianggap selesai setelah semua flow selesai.

---

## 5. Flow: Mengelompokkan Sequence sebagai Unit

### 5.1 Apa itu Flow?

`flow` adalah sequence dari execution elements yang diperlakukan sebagai satu unit transisi.

Contoh konseptual:

```text
flow: ingestionFlow
  validateFile
  loadStaging
  validateStaging

setelah ingestionFlow selesai -> mainProcessingStep
```

Flow membantu ketika beberapa step selalu berjalan bersama dan secara mental membentuk satu fase.

### 5.2 Contoh JSL Flow

```xml
<job id="caseAgeingJob" xmlns="https://jakarta.ee/xml/ns/jakartaee" version="2.1">

    <flow id="ingestionFlow" next="processCases">
        <step id="validateManifest" next="loadStaging">
            <batchlet ref="validateManifestBatchlet"/>
        </step>

        <step id="loadStaging" next="validateStaging">
            <chunk item-count="500">
                <reader ref="stagingFileReader"/>
                <processor ref="stagingRecordProcessor"/>
                <writer ref="stagingRecordWriter"/>
            </chunk>
        </step>

        <step id="validateStaging">
            <batchlet ref="validateStagingBatchlet"/>
        </step>
    </flow>

    <step id="processCases">
        <chunk item-count="200">
            <reader ref="caseReader"/>
            <processor ref="caseAgeingProcessor"/>
            <writer ref="caseAgeingWriter"/>
        </chunk>
    </step>

</job>
```

### 5.3 Kapan Memakai Flow?

Gunakan `flow` ketika:

- beberapa step membentuk satu fase konseptual,
- kamu ingin graph job lebih mudah dibaca,
- kamu ingin mengurangi transition antar step di level job utama,
- ada reusable phase yang bisa dipahami sebagai satu block,
- kamu ingin memisahkan subgraph tanpa menyembunyikan eksekusi.

Jangan gunakan `flow` hanya untuk mempercantik XML jika grouping tidak punya makna operasional.

### 5.4 Flow Boundary

Flow memiliki boundary penting:

```text
Di dalam flow:
  stepA -> stepB -> decisionC

Di luar flow:
  flowX -> nextGlobalStep
```

Step dalam flow sebaiknya tidak diperlakukan sebagai node global sembarangan. Secara desain, flow membuat subgraph dengan internal transition.

Mental model:

```text
flow bukan hanya folder XML.
flow adalah subgraph yang punya internal consistency.
```

---

## 6. Split: Parallel Flow, Bukan Parallel Step Acak

### 6.1 Apa itu Split?

`split` menjalankan beberapa `flow` secara paralel. Setiap flow di dalam split berjalan sendiri, dan split selesai setelah semua flow selesai.

Contoh:

```text
mainProcessing selesai
        |
        v
      split
   /     |      \
report audit notify
   \     |      /
        v
 publishOutput
```

### 6.2 Contoh JSL Split

```xml
<split id="postProcessingSplit" next="publishResult">

    <flow id="auditSummaryFlow">
        <step id="generateAuditSummary">
            <batchlet ref="auditSummaryBatchlet"/>
        </step>
    </flow>

    <flow id="exceptionReportFlow">
        <step id="generateExceptionReport">
            <batchlet ref="exceptionReportBatchlet"/>
        </step>
    </flow>

    <flow id="notificationPreparationFlow">
        <step id="prepareNotifications">
            <chunk item-count="100">
                <reader ref="notificationReader"/>
                <processor ref="notificationProcessor"/>
                <writer ref="notificationWriter"/>
            </chunk>
        </step>
    </flow>

</split>
```

### 6.3 Split Bukan Partitioning

Ini perbedaan penting.

| Aspek | Split | Partitioning |
|---|---|---|
| Unit paralel | Flow berbeda | Partisi dari step yang sama |
| Tujuan | Branch berbeda berjalan paralel | Scale-out workload homogen |
| Contoh | report + notification + summary | process case ID range 1-1000, 1001-2000 |
| State | Tiap flow punya step state berbeda | Tiap partition punya partition state |
| Desain | Parallel orchestration | Parallel data decomposition |

Split:

```text
A, B, C adalah jenis pekerjaan berbeda
```

Partition:

```text
A1, A2, A3 adalah pecahan dari pekerjaan yang sama
```

### 6.4 Resource Risk pada Split

Split terlihat sederhana, tetapi operationally berbahaya jika tidak dihitung.

Misal:

```text
Flow A: baca DB besar
Flow B: generate report DB besar
Flow C: call API eksternal
```

Jika semua berjalan bersamaan:

- DB pool bisa penuh,
- query saling mengganggu,
- API rate limit terpukul,
- memory naik karena report generation,
- CPU spike,
- transaction wait meningkat,
- batch job lain ikut lambat,
- request latency user terdampak.

Jadi pertanyaan desain sebelum split:

```text
Apakah parallelism ini benar-benar mengurangi critical path,
atau hanya memindahkan bottleneck ke resource bersama?
```

### 6.5 Split Safety Checklist

Sebelum memakai `split`, jawab:

- Apakah setiap flow menulis resource yang berbeda?
- Jika menulis resource sama, apakah ada partition key/lock/idempotency?
- Apakah total connection usage masih aman?
- Apakah setiap flow punya timeout?
- Apakah setiap flow punya observability?
- Apakah failure satu flow harus menggagalkan semua job?
- Apakah flow lain aman jika satu flow gagal?
- Apakah restart setelah partial split failure aman?
- Apakah output setiap flow punya manifest/status sendiri?

---

## 7. Decision: Routing Berdasarkan Execution Result

### 7.1 Apa itu Decision?

`decision` adalah node yang menjalankan artifact `Decider`. Ia memilih next transition berdasarkan informasi execution sebelumnya.

Mental model:

```text
previous execution result -> Decider -> exit status -> transition
```

Contoh:

```text
validateManifest exitStatus = VALID
  -> processData

validateManifest exitStatus = INVALID_MANIFEST
  -> end rejected
```

### 7.2 API Decider

Secara konseptual, decider menerima array `StepExecution` dan mengembalikan status string.

Contoh:

```java
import jakarta.batch.api.Decider;
import jakarta.batch.runtime.StepExecution;
import jakarta.inject.Named;

@Named
public class ManifestValidationDecider implements Decider {

    @Override
    public String decide(StepExecution[] executions) throws Exception {
        StepExecution previous = executions[executions.length - 1];
        String exitStatus = previous.getExitStatus();

        if ("VALID".equals(exitStatus)) {
            return "ROUTE_PROCESS";
        }

        if ("INVALID_MANIFEST".equals(exitStatus)) {
            return "ROUTE_REJECT";
        }

        return "ROUTE_FAIL";
    }
}
```

### 7.3 Contoh JSL Decision

```xml
<step id="validateManifest" next="manifestDecision">
    <batchlet ref="validateManifestBatchlet"/>
</step>

<decision id="manifestDecision" ref="manifestValidationDecider">
    <next on="ROUTE_PROCESS" to="processData"/>
    <end on="ROUTE_REJECT" exit-status="REJECTED_INVALID_MANIFEST"/>
    <fail on="ROUTE_FAIL" exit-status="FAILED_MANIFEST_VALIDATION"/>
</decision>

<step id="processData">
    <chunk item-count="500">
        <reader ref="dataReader"/>
        <processor ref="dataProcessor"/>
        <writer ref="dataWriter"/>
    </chunk>
</step>
```

### 7.4 Decider Harus Tipis

Decider bukan tempat business processing besar.

Decider yang baik:

```text
membaca fakta yang sudah dihasilkan step sebelumnya
mengklasifikasikan hasil
mengembalikan routing status
```

Decider yang buruk:

```text
membaca 1 juta row
call external API
mengubah database
mengirim email
membuat keputusan dengan side effect besar
```

Rule praktis:

```text
Decider decides.
Step does work.
```

### 7.5 Decision Harus Deterministic

Untuk restartability, decision sebaiknya deterministic.

Buruk:

```java
if (Math.random() > 0.5) return "A";
if (LocalTime.now().isAfter(...)) return "B";
```

Lebih baik:

```java
Job parameter + persisted validation summary + previous exit status -> route
```

Kenapa?

Pada restart, kamu ingin hasil routing bisa dijelaskan dan diulang.

---

## 8. Transition: next, end, fail, stop

### 8.1 `next`

`next` berarti lanjut ke node lain.

```xml
<next on="COMPLETED" to="nextStep"/>
```

Gunakan untuk alur normal.

### 8.2 `end`

`end` mengakhiri job secara normal/controlled.

Contoh:

```xml
<end on="NO_DATA" exit-status="COMPLETED_NO_DATA"/>
```

Ini berguna saat job memang tidak perlu dilanjutkan, tetapi bukan failure.

Contoh kasus:

- tidak ada file yang perlu diproses,
- manifest kosong tapi valid,
- batch window tidak aktif,
- semua data sudah diproses sebelumnya.

### 8.3 `fail`

`fail` mengakhiri job sebagai failure.

```xml
<fail on="SCHEMA_INVALID" exit-status="FAILED_SCHEMA_INVALID"/>
```

Gunakan jika operator/monitoring harus melihat job sebagai gagal.

Contoh:

- file corrupt,
- mandatory parameter hilang,
- database invariant rusak,
- external dependency critical unavailable,
- data inconsistency tidak boleh di-skip.

### 8.4 `stop`

`stop` mengakhiri job dalam status stopped dan dapat diarahkan untuk restart dari node tertentu.

Contoh konseptual:

```xml
<stop on="WAITING_APPROVAL" restart="manualReviewStep" exit-status="STOPPED_WAITING_APPROVAL"/>
```

Gunakan untuk controlled pause.

Contoh:

- batch butuh approval manual,
- exception rate melebihi threshold,
- reconciliation harus dicek operator,
- downstream maintenance window belum selesai.

Namun hati-hati: `stop` bukan pengganti workflow human task. Kalau approval dan SLA sangat kompleks, pertimbangkan workflow engine.

---

## 9. Exit Status sebagai Kontrak

### 9.1 Batch Status vs Exit Status

Sederhananya:

```text
Batch status = status lifecycle runtime
Exit status  = semantic result dari step/job
```

Batch status biasanya seperti:

```text
STARTING, STARTED, STOPPING, STOPPED, FAILED, COMPLETED, ABANDONED
```

Exit status bisa domain-specific:

```text
VALID
INVALID_MANIFEST
NO_DATA
PARTIAL_SUCCESS
TOO_MANY_SKIPS
READY_TO_PUBLISH
WAITING_APPROVAL
```

### 9.2 Jangan Pakai Status Acak

Buruk:

```text
OK
DONE
SUCCESS
FAILED2
ERR_X
NEXT
```

Lebih baik:

```text
VALIDATION_PASSED
VALIDATION_FAILED_SCHEMA
VALIDATION_FAILED_BUSINESS_RULE
NO_ELIGIBLE_RECORDS
PROCESSED_WITH_WARNINGS
EXCEPTION_THRESHOLD_EXCEEDED
READY_FOR_PUBLICATION
```

### 9.3 Exit Status Naming Convention

Gunakan konvensi:

```text
<PHASE>_<RESULT>[_<REASON>]
```

Contoh:

```text
MANIFEST_VALID
MANIFEST_INVALID_SCHEMA
STAGING_LOADED
STAGING_REJECTED_DUPLICATE_KEYS
PROCESSING_COMPLETED
PROCESSING_PARTIAL_SUCCESS
PROCESSING_TOO_MANY_SKIPS
PUBLISH_READY
PUBLISH_BLOCKED_RECONCILIATION_FAILED
```

### 9.4 Exit Status Registry

Untuk job besar, buat registry:

```java
public final class CaseAgeingExitStatus {
    private CaseAgeingExitStatus() {}

    public static final String MANIFEST_VALID = "MANIFEST_VALID";
    public static final String MANIFEST_INVALID_SCHEMA = "MANIFEST_INVALID_SCHEMA";
    public static final String NO_ELIGIBLE_RECORDS = "NO_ELIGIBLE_RECORDS";
    public static final String PROCESSING_COMPLETED = "PROCESSING_COMPLETED";
    public static final String PROCESSING_PARTIAL_SUCCESS = "PROCESSING_PARTIAL_SUCCESS";
    public static final String EXCEPTION_THRESHOLD_EXCEEDED = "EXCEPTION_THRESHOLD_EXCEEDED";
    public static final String READY_TO_PUBLISH = "READY_TO_PUBLISH";
    public static final String PUBLISH_FAILED = "PUBLISH_FAILED";
}
```

Walaupun JSL menggunakan string, kode Java tidak harus menyebar string literal.

---

## 10. Pattern: Validation Gate

### 10.1 Problem

Sebelum proses besar dimulai, batch harus validasi input.

Jika valid:

```text
continue
```

Jika invalid:

```text
end/fail dengan alasan jelas
```

### 10.2 Graph

```text
validateManifest -> decision
                    ├─ MANIFEST_VALID -> loadData
                    ├─ MANIFEST_EMPTY -> end COMPLETED_NO_DATA
                    └─ MANIFEST_INVALID -> fail FAILED_INVALID_MANIFEST
```

### 10.3 JSL

```xml
<step id="validateManifest" next="manifestGate">
    <batchlet ref="validateManifestBatchlet"/>
</step>

<decision id="manifestGate" ref="manifestGateDecider">
    <next on="ROUTE_LOAD" to="loadData"/>
    <end on="ROUTE_NO_DATA" exit-status="COMPLETED_NO_DATA"/>
    <fail on="ROUTE_INVALID" exit-status="FAILED_INVALID_MANIFEST"/>
</decision>

<step id="loadData">
    <chunk item-count="1000">
        <reader ref="inputReader"/>
        <processor ref="inputProcessor"/>
        <writer ref="stagingWriter"/>
    </chunk>
</step>
```

### 10.4 Kenapa Ini Bagus?

Karena validation menjadi explicit gate:

- operator tahu kenapa job berhenti,
- invalid input tidak diproses sebagian,
- no-data bukan failure,
- downstream step tidak perlu defensif berlebihan,
- audit lebih jelas.

---

## 11. Pattern: Parallel Post-Processing

### 11.1 Problem

Setelah main processing selesai, ada beberapa pekerjaan independen:

- generate audit summary,
- generate exception report,
- prepare notification,
- produce reconciliation file.

Jika dijalankan sequential, critical path panjang.

### 11.2 Graph

```text
processMain
    |
    v
postProcessingSplit
    ├─ auditFlow
    ├─ reportFlow
    └─ notificationFlow
    |
    v
publishResult
```

### 11.3 JSL

```xml
<step id="processMain" next="postProcessingSplit">
    <chunk item-count="250">
        <reader ref="mainReader"/>
        <processor ref="mainProcessor"/>
        <writer ref="mainWriter"/>
    </chunk>
</step>

<split id="postProcessingSplit" next="postProcessingDecision">

    <flow id="auditFlow">
        <step id="generateAuditSummary">
            <batchlet ref="auditSummaryBatchlet"/>
        </step>
    </flow>

    <flow id="reportFlow">
        <step id="generateExceptionReport">
            <batchlet ref="exceptionReportBatchlet"/>
        </step>
    </flow>

    <flow id="notificationFlow">
        <step id="prepareNotifications">
            <chunk item-count="100">
                <reader ref="notificationReader"/>
                <processor ref="notificationProcessor"/>
                <writer ref="notificationWriter"/>
            </chunk>
        </step>
    </flow>

</split>

<decision id="postProcessingDecision" ref="postProcessingDecider">
    <next on="POST_PROCESSING_OK" to="publishResult"/>
    <stop on="POST_PROCESSING_REVIEW_REQUIRED"
          restart="manualReviewStep"
          exit-status="STOPPED_REVIEW_REQUIRED"/>
    <fail on="POST_PROCESSING_FAILED" exit-status="FAILED_POST_PROCESSING"/>
</decision>
```

### 11.4 Hidden Cost

Split membuat pekerjaan paralel, tetapi juga membuat failure semantics lebih sulit:

```text
Jika auditFlow sukses, reportFlow gagal, notificationFlow sukses:
- Apakah job restart menjalankan semua flow lagi?
- Apakah report saja yang rerun?
- Apakah audit summary idempotent?
- Apakah notification preparation menghasilkan duplicate?
```

Karena itu, setiap branch split harus punya output idempotent.

---

## 12. Pattern: Exception Threshold Routing

### 12.1 Problem

Chunk step dapat menyelesaikan proses dengan sejumlah skipped records. Namun business mungkin punya threshold.

Contoh:

```text
Jika skipped <= 100, lanjut publish partial success.
Jika skipped > 100, stop untuk manual review.
Jika fatal validation issue, fail.
```

### 12.2 Step Menghasilkan Summary

Step writer/listener menyimpan summary:

```text
job_execution_id = 123
processed_count = 100000
success_count   = 99880
skip_count      = 120
fatal_count     = 0
```

### 12.3 Decider Membaca Summary

```java
@Named
public class ExceptionThresholdDecider implements Decider {

    @Inject
    BatchSummaryRepository summaryRepository;

    @Override
    public String decide(StepExecution[] executions) throws Exception {
        long jobExecutionId = executions[executions.length - 1].getJobExecutionId();
        BatchSummary summary = summaryRepository.findByJobExecutionId(jobExecutionId);

        if (summary.fatalCount() > 0) {
            return "ROUTE_FAIL_FATAL";
        }

        if (summary.skipCount() > 100) {
            return "ROUTE_MANUAL_REVIEW";
        }

        if (summary.skipCount() > 0) {
            return "ROUTE_PUBLISH_PARTIAL";
        }

        return "ROUTE_PUBLISH_FULL";
    }
}
```

### 12.4 JSL

```xml
<decision id="exceptionThresholdDecision" ref="exceptionThresholdDecider">
    <next on="ROUTE_PUBLISH_FULL" to="publishFullResult"/>
    <next on="ROUTE_PUBLISH_PARTIAL" to="publishPartialResult"/>
    <stop on="ROUTE_MANUAL_REVIEW"
          restart="manualReviewStep"
          exit-status="STOPPED_EXCEPTION_THRESHOLD_EXCEEDED"/>
    <fail on="ROUTE_FAIL_FATAL" exit-status="FAILED_FATAL_PROCESSING_ERROR"/>
</decision>
```

### 12.5 Regulatory Insight

Dalam sistem regulasi, partial success harus bisa dijelaskan:

```text
Bukan hanya "job completed".
Tetapi:
- berapa record diproses,
- berapa sukses,
- berapa skipped,
- kenapa skipped,
- siapa yang review,
- kapan dipublish,
- apakah skipped records masuk remediation queue.
```

Exit status dan decision route harus mendukung defensibility.

---

## 13. Pattern: Controlled Stop for Manual Review

### 13.1 Problem

Tidak semua kondisi harus `FAILED`. Ada kondisi yang membutuhkan manual action.

Contoh:

- high exception rate,
- reconciliation mismatch,
- suspicious data pattern,
- pending approval,
- output generated but not approved.

### 13.2 Graph

```text
processData -> reconcile -> decision
                          ├─ OK -> publish
                          ├─ MISMATCH -> stop waiting manual review
                          └─ FATAL -> fail
```

### 13.3 JSL

```xml
<step id="reconcileOutput" next="reconciliationDecision">
    <batchlet ref="reconciliationBatchlet"/>
</step>

<decision id="reconciliationDecision" ref="reconciliationDecider">
    <next on="RECONCILIATION_OK" to="publishOutput"/>
    <stop on="RECONCILIATION_REVIEW_REQUIRED"
          restart="manualReviewCompletedStep"
          exit-status="STOPPED_RECONCILIATION_REVIEW_REQUIRED"/>
    <fail on="RECONCILIATION_FATAL" exit-status="FAILED_RECONCILIATION_FATAL"/>
</decision>

<step id="manualReviewCompletedStep" next="publishOutput">
    <batchlet ref="manualReviewCompletionBatchlet"/>
</step>
```

### 13.4 Governance

Kalau memakai controlled stop untuk manual review, jangan lupa:

- siapa yang boleh restart,
- evidence review disimpan di mana,
- parameter restart divalidasi,
- job tidak boleh direstart sebelum approval sah,
- audit harus menghubungkan job execution dengan approval record.

---

## 14. Complex Graph Example: Regulatory Case Escalation Batch

### 14.1 Scenario

Job nightly untuk enforcement/case management:

1. Validate job window.
2. Load eligible cases.
3. Jika tidak ada case, end `COMPLETED_NO_ELIGIBLE_CASES`.
4. Process escalation rules.
5. Split post-processing:
   - generate audit summary,
   - generate officer workload report,
   - prepare correspondence outbox.
6. Reconcile result.
7. Jika mismatch, stop for review.
8. Jika OK, publish escalation result.
9. End.

### 14.2 Graph

```text
validateWindow
      |
      v
eligibilityDecision
  ├─ NO_WINDOW      -> end COMPLETED_OUTSIDE_WINDOW
  ├─ WINDOW_OPEN    -> loadEligibleCases
  └─ CONFIG_INVALID -> fail FAILED_INVALID_CONFIG

loadEligibleCases
      |
      v
caseAvailabilityDecision
  ├─ NO_CASES -> end COMPLETED_NO_ELIGIBLE_CASES
  └─ HAS_CASES -> processEscalation

processEscalation
      |
      v
postProcessingSplit
  ├─ auditSummaryFlow
  ├─ workloadReportFlow
  └─ correspondencePreparationFlow
      |
      v
reconcile
      |
      v
reconciliationDecision
  ├─ OK       -> publish
  ├─ REVIEW   -> stop restart=manualReviewCompleted
  └─ FATAL    -> fail
```

### 14.3 JSL Skeleton

```xml
<job id="caseEscalationNightlyJob"
     xmlns="https://jakarta.ee/xml/ns/jakartaee"
     version="2.1">

    <step id="validateWindow" next="eligibilityDecision">
        <batchlet ref="validateWindowBatchlet"/>
    </step>

    <decision id="eligibilityDecision" ref="eligibilityDecider">
        <end on="ROUTE_OUTSIDE_WINDOW" exit-status="COMPLETED_OUTSIDE_WINDOW"/>
        <next on="ROUTE_LOAD_CASES" to="loadEligibleCases"/>
        <fail on="ROUTE_INVALID_CONFIG" exit-status="FAILED_INVALID_CONFIG"/>
    </decision>

    <step id="loadEligibleCases" next="caseAvailabilityDecision">
        <chunk item-count="500">
            <reader ref="eligibleCaseReader"/>
            <processor ref="eligibleCaseProcessor"/>
            <writer ref="eligibleCaseStagingWriter"/>
        </chunk>
    </step>

    <decision id="caseAvailabilityDecision" ref="caseAvailabilityDecider">
        <end on="ROUTE_NO_CASES" exit-status="COMPLETED_NO_ELIGIBLE_CASES"/>
        <next on="ROUTE_PROCESS_CASES" to="processEscalation"/>
        <fail on="ROUTE_STAGE_INVALID" exit-status="FAILED_STAGING_INVALID"/>
    </decision>

    <step id="processEscalation" next="postProcessingSplit">
        <chunk item-count="200">
            <reader ref="stagedCaseReader"/>
            <processor ref="escalationRuleProcessor"/>
            <writer ref="escalationDecisionWriter"/>
        </chunk>
    </step>

    <split id="postProcessingSplit" next="reconcileEscalationOutput">

        <flow id="auditSummaryFlow">
            <step id="generateAuditSummary">
                <batchlet ref="generateAuditSummaryBatchlet"/>
            </step>
        </flow>

        <flow id="workloadReportFlow">
            <step id="generateWorkloadReport">
                <batchlet ref="generateWorkloadReportBatchlet"/>
            </step>
        </flow>

        <flow id="correspondencePreparationFlow">
            <step id="prepareCorrespondenceOutbox">
                <chunk item-count="100">
                    <reader ref="correspondenceCandidateReader"/>
                    <processor ref="correspondenceCommandProcessor"/>
                    <writer ref="correspondenceOutboxWriter"/>
                </chunk>
            </step>
        </flow>

    </split>

    <step id="reconcileEscalationOutput" next="reconciliationDecision">
        <batchlet ref="reconcileEscalationOutputBatchlet"/>
    </step>

    <decision id="reconciliationDecision" ref="reconciliationDecider">
        <next on="ROUTE_PUBLISH" to="publishEscalationResult"/>
        <stop on="ROUTE_MANUAL_REVIEW"
              restart="manualReviewCompleted"
              exit-status="STOPPED_MANUAL_REVIEW_REQUIRED"/>
        <fail on="ROUTE_FATAL" exit-status="FAILED_RECONCILIATION_FATAL"/>
    </decision>

    <step id="manualReviewCompleted" next="publishEscalationResult">
        <batchlet ref="manualReviewCompletionBatchlet"/>
    </step>

    <step id="publishEscalationResult">
        <batchlet ref="publishEscalationResultBatchlet"/>
    </step>

</job>
```

### 14.4 Kenapa Graph Ini Lebih Baik daripada Satu Batchlet Besar?

Karena setiap fase punya:

- lifecycle sendiri,
- status sendiri,
- metric sendiri,
- checkpoint/restart boundary sendiri,
- audit event sendiri,
- operational interpretation sendiri.

Operator bisa tahu:

```text
Job stopped karena reconciliation review required,
bukan karena NullPointerException random di tengah method process().
```

---

## 15. Restart Semantics pada Complex Graph

Complex graph harus selalu dijelaskan dari perspektif restart.

Pertanyaan wajib:

```text
Jika job gagal pada node X, apa yang terjadi saat restart?
```

### 15.1 Failure di Sequential Step

```text
validate -> load -> process -> publish
```

Jika `process` gagal:

- `validate` dan `load` sudah selesai,
- restart biasanya lanjut dari failed step,
- `process` harus checkpointed/idempotent,
- `publish` belum berjalan.

### 15.2 Failure di Split

```text
split:
  flowA completed
  flowB failed
  flowC completed
```

Pertanyaan:

- Apakah restart mengulang seluruh split?
- Apakah runtime/vendor tracking per branch cukup?
- Apakah branch completed aman jika dijalankan ulang?
- Apakah output branch punya dedup key?

Design safe:

```text
Setiap branch split menghasilkan output dengan key:
(jobInstanceId, branchName, logicalOutputKey)
```

Writer menggunakan upsert/idempotent insert.

### 15.3 Failure setelah Split sebelum Publish

Jika split selesai, lalu reconciliation gagal:

- post-processing output sudah ada,
- publish belum terjadi,
- restart reconciliation harus aman,
- reconciliation harus membaca output persisted, bukan transient memory.

### 15.4 Controlled Stop dan Restart Target

Jika job stop untuk manual review:

- stop reason harus persisted,
- manual review result harus persisted,
- restart target harus memvalidasi approval,
- restart parameter harus dicek.

Jangan membuat restart target langsung publish tanpa guard.

---

## 16. Observability untuk Complex Graph

Graph kompleks butuh observability per node dan per edge.

### 16.1 Metrics

Minimal:

```text
batch_job_execution_total{job, status, exit_status}
batch_step_duration_seconds{job, step}
batch_step_read_count{job, step}
batch_step_write_count{job, step}
batch_step_skip_count{job, step}
batch_decision_route_total{job, decision, route}
batch_split_branch_duration_seconds{job, split, flow}
batch_split_branch_status_total{job, split, flow, status}
```

### 16.2 Logs

Log transition penting:

```json
{
  "event": "batch.transition",
  "job": "caseEscalationNightlyJob",
  "jobExecutionId": 92831,
  "from": "reconciliationDecision",
  "route": "ROUTE_MANUAL_REVIEW",
  "to": "manualReviewCompleted",
  "terminalAction": "STOP",
  "exitStatus": "STOPPED_MANUAL_REVIEW_REQUIRED",
  "correlationId": "job-92831"
}
```

### 16.3 Audit

Audit bukan debug log. Audit harus menjawab:

- siapa/apa yang memulai job,
- parameter apa yang dipakai,
- input manifest mana,
- route decision apa yang terjadi,
- output apa yang dihasilkan,
- siapa approve manual restart,
- kapan publish dilakukan,
- record mana yang gagal/skipped.

### 16.4 Dashboard Graph

Untuk job graph kompleks, dashboard ideal menampilkan:

```text
[validateWindow] COMPLETED
       |
[eligibilityDecision] ROUTE_LOAD_CASES
       |
[loadEligibleCases] COMPLETED read=10,000 write=9,980 skip=20
       |
[processEscalation] COMPLETED
       |
[postProcessingSplit]
  - auditSummaryFlow: COMPLETED
  - workloadReportFlow: COMPLETED
  - correspondencePreparationFlow: FAILED
```

Operator tidak seharusnya membaca raw XML untuk memahami posisi job.

---

## 17. Testing Complex Job Graphs

### 17.1 Test Level

Graph kompleks butuh beberapa level test:

1. Unit test artifact:
   - batchlet,
   - reader,
   - processor,
   - writer,
   - decider.

2. Contract test exit status:
   - input tertentu menghasilkan exit status tertentu.

3. Graph route test:
   - exit status X membawa ke node Y.

4. Restart test:
   - gagal di step tertentu lalu restart.

5. Split idempotency test:
   - branch completed lalu branch lain gagal.

6. Operational test:
   - stop, restart, abandon.

### 17.2 Decider Test

```java
class ManifestGateDeciderTest {

    @Test
    void shouldRouteToLoadWhenManifestValid() throws Exception {
        StepExecution execution = fakeStepExecution("MANIFEST_VALID");
        ManifestGateDecider decider = new ManifestGateDecider();

        String route = decider.decide(new StepExecution[] { execution });

        assertEquals("ROUTE_LOAD", route);
    }
}
```

### 17.3 Exit Status Contract Test

Buat test yang memastikan status string tidak berubah sembarangan.

```java
@Test
void exitStatusShouldRemainStable() {
    assertEquals("MANIFEST_VALID", CaseAgeingExitStatus.MANIFEST_VALID);
    assertEquals("STOPPED_MANUAL_REVIEW_REQUIRED", CaseAgeingExitStatus.STOPPED_MANUAL_REVIEW_REQUIRED);
}
```

Ini terlihat sederhana, tetapi penting jika status dipakai dashboard/alert/audit/report.

### 17.4 Restart Scenario Matrix

| Scenario | Expected |
|---|---|
| fail before split | restart from failed step |
| fail in one split branch | no duplicate side effect from completed branch |
| fail after split before publish | post-processing output reused safely |
| stop for review | restart only after valid approval |
| publish fails transient | retry/restart does not double-publish |
| decision route changes after restart | blocked unless based on persisted facts |

---

## 18. Anti-Patterns

### 18.1 XML Spaghetti

Gejala:

- terlalu banyak step di satu file,
- status string tidak konsisten,
- transition meloncat-loncat,
- decision terlalu banyak,
- tidak ada naming convention.

Solusi:

- kelompokkan dengan flow,
- beri nama fase,
- dokumentasikan graph,
- batasi jumlah decision per job,
- pindahkan workflow kompleks ke workflow engine jika perlu.

### 18.2 Decider sebagai Business Processor

Buruk:

```text
Decider membaca data besar, memproses rule, menulis DB, mengirim notifikasi, lalu return route.
```

Solusi:

```text
Step memproses dan persist facts.
Decider membaca facts dan route.
```

### 18.3 Split untuk Semua Hal

Buruk:

```text
Karena split bisa parallel, semua flow dibuat parallel.
```

Konsekuensi:

- DB overload,
- API rate limit,
- sulit debug,
- restart rumit,
- output duplicate.

Solusi:

- parallel hanya jika resource dan dependency mendukung,
- hitung capacity,
- gunakan bulkhead,
- pastikan branch idempotent.

### 18.4 Exit Status Tidak Bermakna

Buruk:

```text
COMPLETED, COMPLETED2, DONE, OK, SUCCESS, PARTIAL, ERROR
```

Solusi:

```text
PROCESSING_PARTIAL_SUCCESS
RECONCILIATION_REVIEW_REQUIRED
PUBLISH_BLOCKED_DUPLICATE_OUTPUT
```

### 18.5 Menggunakan Batch sebagai BPMN Murah

Jika job sudah memiliki:

- human task banyak,
- timer event kompleks,
- SLA escalation,
- approval multi-level,
- compensation graph kompleks,
- long-running business process berminggu-minggu,

maka Jakarta Batch mungkin bukan tool utama. Gunakan workflow engine, dan batch menjadi worker untuk bulk step.

---

## 19. Jakarta Batch vs Workflow Engine

### 19.1 Jakarta Batch Cocok Jika

- pekerjaan bulk/background,
- lifecycle relatif bounded,
- restart berbasis checkpoint,
- graph mostly technical processing,
- human interaction minimal,
- job punya start/end jelas,
- data processing dominan.

### 19.2 Workflow Engine Cocok Jika

- proses bisnis long-running,
- banyak human task,
- banyak approval/escalation,
- SLA/timer event kompleks,
- compensation business-level,
- state harus terlihat sebagai process instance,
- perubahan flow sering dilakukan oleh business/process analyst.

### 19.3 Hybrid Pattern

Sering kali desain terbaik:

```text
Workflow engine:
  orchestrates business process

Jakarta Batch:
  executes bulk technical work
```

Contoh:

```text
BPMN: Enforcement Campaign Process
  -> task: approve campaign
  -> service task: start Jakarta Batch job
  -> wait: batch completed event
  -> gateway: success/partial/failure
  -> human task: review exceptions
  -> service task: publish final enforcement actions
```

Dengan begitu:

- workflow menangani human/business lifecycle,
- batch menangani bulk processing yang restartable.

---

## 20. Production Design Heuristics

### 20.1 Keep Graph Shallow

Kalau graph terlalu dalam, operator sulit memahami.

Prefer:

```text
5-10 major nodes + flow grouping
```

daripada:

```text
50 tiny steps dengan transition rumit
```

### 20.2 Make Decision Output Business-Readable

Decision route harus bisa dijelaskan ke BA/operator.

Buruk:

```text
ROUTE_7
```

Baik:

```text
ROUTE_MANUAL_REVIEW_EXCEPTION_THRESHOLD
```

### 20.3 Persist Facts Before Decision

Jangan membuat decision berdasarkan transient memory.

Baik:

```text
step writes validation_summary
Decider reads validation_summary
```

### 20.4 Design Split Branch Output as Idempotent

Setiap branch split harus aman terhadap rerun.

Gunakan key:

```text
job_instance_id + branch_name + logical_output_key
```

### 20.5 Separate Technical Failure from Business Outcome

Contoh:

```text
Technical failure:
  DB unavailable -> FAILED_DB_UNAVAILABLE

Business outcome:
  no eligible cases -> COMPLETED_NO_ELIGIBLE_CASES
  exception threshold exceeded -> STOPPED_REVIEW_REQUIRED
```

Jangan semua diperlakukan sebagai `FAILED`.

---

## 21. Checklist Desain Complex Job Graph

Sebelum finalisasi JSL graph, cek:

### Graph Shape

- [ ] Apakah setiap node punya tanggung jawab jelas?
- [ ] Apakah flow digunakan untuk grouping yang bermakna?
- [ ] Apakah split hanya digunakan untuk branch yang layak paralel?
- [ ] Apakah decision hanya melakukan routing?
- [ ] Apakah graph bisa digambar dalam satu halaman?

### Exit Status

- [ ] Apakah exit status punya naming convention?
- [ ] Apakah status domain-specific tetapi tetap stabil?
- [ ] Apakah status didokumentasikan?
- [ ] Apakah dashboard/alert/audit memakai status yang sama?

### Restartability

- [ ] Apakah failure setiap node punya restart behavior jelas?
- [ ] Apakah split branch idempotent?
- [ ] Apakah publish step idempotent?
- [ ] Apakah manual stop punya restart guard?

### Resource Control

- [ ] Apakah split tidak melebihi DB pool?
- [ ] Apakah external API rate limit dihormati?
- [ ] Apakah memory/CPU branch berat dihitung?
- [ ] Apakah job paralel lain terdampak?

### Observability

- [ ] Apakah setiap node punya metric duration/status?
- [ ] Apakah decision route dilog/audit?
- [ ] Apakah split branch terlihat per flow?
- [ ] Apakah operator tahu posisi job saat gagal?

### Governance

- [ ] Siapa boleh start/stop/restart?
- [ ] Apakah controlled stop butuh approval?
- [ ] Apakah restart parameter divalidasi?
- [ ] Apakah audit cukup untuk regulatory review?

---

## 22. Ringkasan

`flow`, `split`, dan `decision` membuat Jakarta Batch mampu memodelkan job yang lebih kompleks daripada urutan step linear. Namun kekuatan ini harus dipakai dengan disiplin.

Inti mental model:

```text
JSL adalah execution graph.
Step melakukan pekerjaan.
Flow mengelompokkan subgraph.
Split menjalankan flow paralel.
Decision memilih route berdasarkan fakta.
Transition menentukan lifecycle outcome.
Exit status adalah kontrak antar node dan operator.
```

Desain yang baik membuat batch job:

- readable,
- restartable,
- auditable,
- observable,
- operationally controllable,
- tidak overload resource,
- tidak menyembunyikan workflow bisnis kompleks dalam XML.

Desain yang buruk membuat JSL menjadi XML spaghetti yang sulit di-debug, sulit direstart, dan rawan side effect ganda.

Top-tier engineer tidak hanya bertanya:

```text
Bagaimana cara membuat flow jalan?
```

Tetapi:

```text
Apa invariant graph ini?
Apa arti setiap transition?
Apa yang terjadi jika branch ini gagal?
Apakah rerun aman?
Apakah operator bisa memahami statusnya?
Apakah ini batch graph atau sebenarnya business workflow?
```

---

## 23. Latihan / Thought Experiment

### Latihan 1 — Draw the Graph

Ambil job berikut:

```text
- validate file
- load file
- if no records, end
- process records
- generate report and audit summary in parallel
- if report mismatch, stop for review
- else publish output
```

Gambarkan graph-nya dengan node:

```text
step, flow, split, decision, end, stop, fail
```

Lalu definisikan exit status untuk setiap decision.

### Latihan 2 — Split Risk Analysis

Kamu punya split dengan tiga flow:

```text
A: generate PDF report, memory heavy
B: query database for audit summary, DB heavy
C: call external API, rate limited
```

Jawab:

- resource bottleneck apa yang mungkin muncul?
- apakah semua harus parallel?
- metric apa yang perlu dipasang?
- apa yang terjadi jika C gagal setelah A dan B sukses?

### Latihan 3 — Decider Purity

Sebuah decider saat ini:

```text
- membaca 500 ribu row
- menghitung summary
- update database
- mengirim email
- return route
```

Refactor desainnya menjadi:

```text
step -> persisted facts -> decider -> route -> step
```

### Latihan 4 — Batch or Workflow?

Sebuah proses memiliki:

- batch load data,
- 3 level approval,
- SLA reminder,
- manual correction,
- re-run partial records,
- final publication.

Tentukan bagian mana yang cocok untuk Jakarta Batch dan bagian mana yang cocok untuk workflow engine.

---

## 24. Referensi

- Jakarta Batch 2.1 Specification — JSL, flow, split, decision, transition semantics.
- Jakarta EE Tutorial — Batch Processing, flow/split/decision overview.
- Jakarta Batch API — `Decider`, `JobOperator`, `StepExecution`, batch runtime concepts.
- Jakarta EE 11 Platform — baseline modern Jakarta EE yang memuat Batch 2.1.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 24 — Partitioning: Parallel Batch at Scale](./24-partitioning-parallel-batch-at-scale.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 26 — JobOperator, Job Repository, and Runtime Control Plane](./26-joboperator-job-repository-runtime-control-plane.md)
