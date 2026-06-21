# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-011.md

# Part 011 — Error Handling Semantics: BPMN Error, Job Failure, Incident, Escalation, and Business Rejection

> Seri: **learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering**  
> Level: Advanced / Staff+ Engineering  
> Fokus: Camunda 8 / Zeebe, Java 8–25, production-grade workflow correctness  
> Status seri: **belum selesai**  
> Part sebelumnya: `part-010 — Process Instantiation, Business Keys, Correlation Keys, and Message Design`  
> Part berikutnya: `part-012 — Timers, Deadlines, SLA, Escalation, and Time Semantics`

---

## 0. Tujuan Part Ini

Di part sebelumnya kita membahas bagaimana proses dimulai dan bagaimana instance menerima sinyal eksternal melalui business key, correlation key, dan message. Sekarang kita masuk ke salah satu area yang paling sering membuat sistem workflow gagal di production: **error semantics**.

Banyak engineer menganggap error handling di workflow engine hanya berarti:

```text
try-catch → retry → kalau gagal, throw error
```

Di Camunda 8/Zeebe, pemikiran itu terlalu dangkal.

Error handling di distributed process orchestration harus menjawab pertanyaan yang lebih berat:

1. Apakah kegagalan ini teknis atau bisnis?
2. Apakah proses boleh otomatis retry?
3. Apakah proses harus berhenti untuk human repair?
4. Apakah kegagalan harus terlihat sebagai incident operasional?
5. Apakah kegagalan harus dimodelkan secara eksplisit di BPMN?
6. Apakah ini harus menjadi BPMN error, job failure, incident, escalation, compensation, atau normal business path?
7. Apakah side effect eksternal sudah terjadi sebagian?
8. Apakah retry akan aman, berbahaya, atau menghasilkan double execution?
9. Siapa yang harus memperbaiki: worker, operator, user, supervisor, atau process owner?
10. Bagaimana keputusan error ini bisa diaudit secara defensible?

Part ini bertujuan membentuk mental model yang tajam untuk membedakan semua itu.

---

## 1. Premis Utama: Error Handling di Workflow Bukan Error Handling di Method Java

Di Java biasa, error sering dilihat sebagai masalah local control flow:

```java
try {
    service.call();
} catch (Exception e) {
    log.error("failed", e);
    throw e;
}
```

Di workflow orchestration, error adalah bagian dari **business state evolution**.

Sebuah error bisa berarti:

- sistem eksternal sementara tidak tersedia;
- input process variable rusak;
- user memilih opsi yang secara bisnis ditolak;
- approval gagal karena rule domain;
- payment sudah berhasil tapi callback gagal;
- document tidak ditemukan;
- task terlambat;
- regulator harus melakukan manual review;
- proses tidak bisa lanjut karena bug model;
- worker versi baru tidak kompatibel dengan instance lama;
- correlation message salah tujuan;
- data sudah berubah sejak process instance dibuat.

Semua ini tidak boleh diperlakukan sama.

**Top 1% mental model:**

> Error handling dalam Camunda 8 adalah proses mengklasifikasikan deviasi dari expected path menjadi kategori runtime yang tepat, agar engine, worker, operator, dan business stakeholder tahu siapa yang harus bertindak dan apa konsekuensi state-nya.

---

## 2. Lima Kategori Deviasi dalam Camunda 8

Untuk berpikir jernih, pisahkan deviasi menjadi lima kategori besar.

```text
1. Technical transient failure
2. Technical persistent failure
3. Business negative outcome
4. Business exceptional but recoverable path
5. Process/model/data defect
```

### 2.1 Technical Transient Failure

Contoh:

- HTTP 503 dari service eksternal
- database connection timeout
- temporary DNS failure
- rate limit sementara
- message broker unavailable
- token service timeout

Makna:

> Pekerjaan yang sama mungkin berhasil jika dicoba ulang nanti.

Biasanya cocok dengan:

```text
Fail job with retries > 0
```

Bukan BPMN error.

### 2.2 Technical Persistent Failure

Contoh:

- endpoint salah konfigurasi
- credential expired
- schema variable tidak valid
- worker code bug
- API contract berubah
- database constraint selalu gagal

Makna:

> Retry otomatis tidak menyelesaikan akar masalah. Perlu intervention atau deployment fix.

Biasanya cocok dengan:

```text
Fail job until retries = 0 → incident
```

### 2.3 Business Negative Outcome

Contoh:

- applicant tidak eligible
- payment declined
- document validation failed
- user rejected approval
- screening result failed
- license renewal not allowed

Makna:

> Sistem berjalan benar. Hasilnya negatif secara bisnis.

Biasanya bukan `FailJob` dan bukan incident.

Cocok dengan:

```text
Complete job with business result variable
```

atau jika model butuh explicit alternate path:

```text
Throw BPMN error
```

Tetapi hati-hati: BPMN error bukan “semua hasil negatif”.

### 2.4 Business Exceptional but Recoverable Path

Contoh:

- user melewati threshold risiko
- case membutuhkan supervisor review
- external verification mismatch
- payment requires manual verification
- address cannot be automatically resolved
- compliance flag raised

Makna:

> Ini bukan bug. Ini jalur bisnis khusus yang harus terlihat dalam model.

Cocok dengan:

```text
BPMN error
Boundary event
Escalation
Event subprocess
Manual review task
```

### 2.5 Process/Model/Data Defect

Contoh:

- BPMN model salah route
- variable mandatory tidak pernah diset
- worker tidak ada untuk job type baru
- incompatible process version
- output mapping error
- correlation key salah desain

Makna:

> Ada defect dalam process/application design.

Cocok dengan:

```text
Incident + engineering fix + process repair/migration
```

Bukan business rejection.

---

## 3. Peta Mekanisme Error Camunda 8

Di Camunda 8/Zeebe, beberapa mekanisme utama yang sering tertukar:

| Mekanisme | Dipakai Untuk | Siapa yang Menangani | Efek Runtime |
|---|---|---|---|
| Complete Job | Pekerjaan sukses, termasuk hasil bisnis negatif yang normal | Process model lanjut | Token bergerak lanjut |
| Fail Job dengan retries > 0 | Technical failure yang masih bisa retry | Engine retry nanti | Job bisa diaktifkan ulang |
| Fail Job dengan retries = 0 | Failure tidak bisa lanjut otomatis | Operator/engineer | Incident dibuat, process berhenti di titik itu |
| Throw BPMN Error | Business exception yang dimodelkan | BPMN boundary/error handler | Token mengikuti error path |
| Escalation | Non-critical escalation ke scope lebih tinggi | BPMN escalation catcher / human process | Bisa lanjut tanpa dianggap failure fatal |
| Timer Boundary | Deadline/timeout bisnis | BPMN model | Token berpindah karena waktu |
| Compensation | Undo/reversal bisnis | BPMN compensation handler | Side effect dikompensasi |
| Cancel Process Instance | Termination administratif/operasional | Operator/API | Instance berhenti |

Kesalahan umum adalah memakai satu mekanisme untuk semua kasus.

Contoh buruk:

```text
Semua exception Java → BPMN error
```

atau:

```text
Semua business rejection → FailJob
```

atau:

```text
Semua external API failure → incident langsung
```

Model yang benar membedakan **runtime failure**, **business outcome**, dan **business exception**.

---

## 4. Command Outcome dari Perspektif Worker

Ketika worker menerima job, secara konseptual ia punya beberapa hasil utama.

```text
[Activated Job]
      |
      +--> CompleteJob
      |
      +--> FailJob(retries > 0)
      |
      +--> FailJob(retries = 0)
      |
      +--> ThrowError(errorCode)
      |
      +--> Timeout / worker crash / no response
```

### 4.1 CompleteJob

Dipakai jika worker berhasil menyelesaikan kewajibannya.

Ini tidak selalu berarti “semua kondisi bisnis positif”.

Contoh:

```json
{
  "eligibility": {
    "status": "NOT_ELIGIBLE",
    "reasonCode": "AGE_BELOW_REQUIREMENT"
  }
}
```

Worker bisa complete job dengan variable seperti ini. Lalu BPMN memakai exclusive gateway untuk menentukan path.

### 4.2 FailJob

Dipakai jika worker tidak berhasil menyelesaikan kewajiban teknisnya.

Contoh:

- tidak bisa connect ke external API;
- request timeout;
- temporary auth server issue;
- database deadlock;
- invalid technical state.

Fail job memiliki retry count. Jika retry masih ada, job akan dicoba lagi. Jika retry habis, incident dibuat.

### 4.3 Throw BPMN Error

Dipakai jika worker ingin menyatakan:

> Secara teknis worker berjalan, tetapi outcome ini adalah exceptional business path yang BPMN model harus tangani.

Contoh:

- `DOCUMENT_REJECTED`
- `PAYMENT_DECLINED`
- `KYC_MISMATCH`
- `LICENSE_SUSPENDED`
- `REQUIRES_MANUAL_REVIEW`

BPMN error harus punya handler yang masuk akal, biasanya boundary error event pada service task/subprocess.

### 4.4 Timeout / Crash

Jika worker crash setelah activate job dan tidak mengirim complete/fail/error command, Zeebe tidak langsung tahu business outcome-nya. Ketika timeout habis, job bisa diaktifkan lagi oleh worker lain.

Inilah salah satu sumber duplicate execution.

Karena itu, timeout bukan sekadar konfigurasi teknis. Timeout adalah bagian dari correctness design.

---

## 5. Job Failure Semantics

Job failure adalah pesan dari worker ke engine:

> Saya tidak bisa menyelesaikan job ini sekarang. Tolong engine putuskan apakah job dicoba lagi atau menjadi incident berdasarkan remaining retries.

Secara konseptual:

```text
FailJob(jobKey, retries, retryBackoff, errorMessage)
```

### 5.1 Retry Count Bukan Jumlah Percobaan Masa Lalu

`retries` adalah jumlah retry tersisa setelah fail command.

Contoh:

```text
Initial retries: 3
Attempt 1 fails → set retries = 2
Attempt 2 fails → set retries = 1
Attempt 3 fails → set retries = 0 → incident
```

Jangan salah mengira `retries` sebagai counter attempt yang otomatis selalu dikurangi dengan benar oleh custom code. Worker perlu disiplin membaca dan mengurangi retry jika menggunakan API manual.

### 5.2 Retry Backoff

Retry backoff memberi jeda sebelum job diaktifkan lagi.

Gunakan untuk:

- API rate limit;
- downstream service recovery;
- temporary outage;
- avoiding retry storm.

Backoff yang terlalu kecil bisa membuat incident lebih parah.

Backoff yang terlalu besar bisa menyembunyikan failure.

### 5.3 Error Message

Error message bukan tempat dump stack trace raksasa atau PII.

Baik:

```text
External verification service returned HTTP 503. correlationId=abc, attempt=2, retryable=true
```

Buruk:

```text
Full request body: { name, NRIC, address, salary, ... }
```

Incident message harus membantu diagnosis tanpa membocorkan data sensitif.

---

## 6. Incident Semantics

Incident adalah sinyal bahwa process instance tidak bisa lanjut otomatis.

Untuk job-related incident, biasanya terjadi ketika:

```text
job failed with retries = 0
```

Makna incident:

> Engine berhenti di titik tertentu karena perlu correction, intervention, atau retry manual setelah akar masalah diperbaiki.

Incident bukan “error log”. Incident adalah **runtime stop condition**.

### 6.1 Incident Bukan Dead Letter Queue Biasa

Dalam messaging system, dead letter queue sering berarti message diparkir terpisah.

Dalam Zeebe, incident tetap terkait dengan process instance. Token process berhenti di titik itu. Setelah incident diselesaikan dan retry dinaikkan, process bisa lanjut.

Ini sangat penting untuk audit:

```text
Process instance tidak hilang.
State-nya berhenti secara eksplisit.
Operator bisa melihat di mana dan kenapa.
```

### 6.2 Kapan Incident Baik

Incident baik untuk:

- bug worker;
- invalid process data;
- unavailable dependency berkepanjangan;
- credential/config error;
- schema mismatch;
- unexpected exception;
- model deployment mismatch;
- case yang harus diperbaiki admin.

Incident buruk untuk:

- payment declined normal;
- applicant rejected normal;
- user memilih “reject”;
- approval membutuhkan supervisor;
- SLA expired yang memang dimodelkan.

Jika business outcome normal menghasilkan incident, berarti model Anda salah.

### 6.3 Incident Resolution Flow

Typical job-related incident resolution:

```text
1. Buka Operate
2. Identifikasi process instance dan failed element
3. Baca error message dan variable relevan
4. Tentukan root cause
5. Fix root cause:
   - update variable
   - fix config
   - deploy worker fix
   - restore downstream service
6. Increase retries / resolve incident
7. Observe process continuation
8. Catat audit/remediation
```

Incident resolution tanpa root cause fix hanya membuat job gagal lagi.

---

## 7. BPMN Error Semantics

BPMN error bukan Java exception.

BPMN error adalah business-level signal yang dilempar dari activity dan ditangkap oleh error boundary/event subprocess pada BPMN model.

Makna:

> Activity tidak selesai melalui happy path, tetapi proses tahu jalur alternatif yang harus diambil.

Contoh model:

```text
[Verify Document Service Task]
        |
        | happy path
        v
[Continue]

Boundary Error: DOCUMENT_INVALID
        |
        v
[Request Document Re-upload]
```

### 7.1 BPMN Error Harus Dimodelkan

Jika worker throw BPMN error tetapi tidak ada catcher yang cocok, hasilnya bisa menjadi problem runtime.

Karena itu, jangan throw BPMN error sebagai pengganti generic exception.

Gunakan BPMN error hanya jika:

1. error code stabil;
2. process model memang punya jalur penanganan;
3. business stakeholder bisa memahami deviasi tersebut;
4. deviasi itu bukan sekadar technical failure;
5. token harus pindah ke path alternatif.

### 7.2 BPMN Error Code sebagai Contract

Error code adalah contract antara worker dan BPMN model.

Baik:

```text
DOCUMENT_INVALID
PAYMENT_DECLINED
KYC_MISMATCH
APPLICATION_NOT_ELIGIBLE
```

Buruk:

```text
RuntimeException
NullPointerException
HTTP_500
UNKNOWN_ERROR
```

`HTTP_500` adalah technical failure, bukan business path.

### 7.3 BPMN Error vs Complete with Status

Ada dua cara memodelkan hasil negatif:

#### Opsi A — Complete job with status

```text
Service Task → Exclusive Gateway → approved/rejected/manual-review
```

Cocok jika outcome adalah variasi normal.

#### Opsi B — Throw BPMN Error

```text
Service Task + Boundary Error → exception path
```

Cocok jika outcome adalah exception terhadap responsibility activity.

Rule of thumb:

```text
Jika activity secara bisnis berhasil menghasilkan keputusan, complete dengan status.
Jika activity tidak bisa memenuhi kontrak bisnis normalnya karena kondisi khusus, throw BPMN error.
```

Contoh:

- Eligibility check returns `ELIGIBLE` / `NOT_ELIGIBLE`: complete + gateway.
- Document verification cannot proceed because document is corrupted: BPMN error `DOCUMENT_UNREADABLE`.
- Payment authorization declined by bank: tergantung domain, bisa complete + status atau BPMN error jika payment activity contract adalah “authorize or route to recovery”.

---

## 8. Escalation Semantics

Escalation adalah mekanisme BPMN untuk memberi sinyal ke scope lebih tinggi bahwa ada kondisi yang perlu perhatian, tetapi tidak selalu fatal.

Perbedaan utama:

```text
BPMN Error  → critical deviation; current path usually interrupted.
Escalation  → non-critical notification/deviation; can be caught by higher scope.
```

Contoh escalation:

- case risk score tinggi;
- SLA mendekati deadline;
- supervisor perlu diberi tahu;
- fraud suspicion membutuhkan parallel review;
- document mismatch but process can continue with flag.

Escalation cocok untuk workflow organisasi:

```text
[Review Application]
    |
    +-- Escalation: HIGH_RISK_CASE --> [Supervisor Awareness / Additional Review]
```

Jangan gunakan incident untuk semua kebutuhan escalation. Incident berarti engine tidak bisa lanjut otomatis. Escalation berarti proses tahu jalur organisasi untuk menangani kondisi tersebut.

---

## 9. Business Rejection Bukan Error Teknis

Salah satu anti-pattern paling umum:

```java
if (!eligible) {
    throw new RuntimeException("Not eligible");
}
```

Lalu worker auto-fail, retry, akhirnya incident.

Ini salah karena `not eligible` bukan technical failure. Sistem berhasil menghitung eligibility.

Lebih baik:

```java
EligibilityResult result = eligibilityService.check(applicationId);

client.newCompleteCommand(job.getKey())
    .variables(Map.of(
        "eligibilityStatus", result.status(),
        "eligibilityReason", result.reasonCode()
    ))
    .send()
    .join();
```

Kemudian BPMN:

```text
[Check Eligibility]
        |
        v
[Gateway: eligibilityStatus]
    | ELIGIBLE       → Continue
    | NOT_ELIGIBLE   → Reject Application
    | MANUAL_REVIEW  → Human Review
```

Business rejection harus bisa diaudit sebagai business decision, bukan sebagai system incident.

---

## 10. Error Taxonomy untuk Java Worker

Production worker sebaiknya punya taxonomy eksplisit.

Contoh:

```text
WorkerException
├── RetryableTechnicalException
├── NonRetryableTechnicalException
├── BusinessErrorException
├── BusinessResultException? (hindari jika bisa pakai return object)
├── ContractViolationException
├── SecurityViolationException
└── UnknownWorkerException
```

Tetapi jangan terlalu banyak class jika tidak memberi decision value.

Yang penting adalah mapping ke outcome:

| Exception / Condition | Outcome Zeebe | Catatan |
|---|---|---|
| HTTP 503 | Fail job retries-1 + backoff | retryable |
| HTTP 429 | Fail job retries-1 + longer backoff | rate limit |
| HTTP 400 due invalid request variable | Fail job retries=0 / incident | likely contract/data bug |
| Business rule rejected | Complete with status atau BPMN error | not incident |
| Data not found but expected | BPMN error atau incident | depends domain |
| NullPointerException | Fail job retries=0 or retries-1 | bug, usually incident eventually |
| Unauthorized due expired token | Fail job with retry if refresh possible | technical |
| Forbidden due permission design | incident/security defect | non-retryable |
| Duplicate external request detected | Complete with previous result | idempotency |

### 10.1 Mapping Layer

Jangan biarkan exception mentah langsung menentukan Zeebe command.

Lebih baik punya `JobOutcomeMapper`.

```java
public final class JobOutcomeMapper {

    public JobOutcome map(Throwable error, ActivatedJob job) {
        if (error instanceof RetryableDownstreamException) {
            return JobOutcome.failRetryable(
                job.getRetries() - 1,
                "Downstream unavailable",
                Duration.ofSeconds(30)
            );
        }

        if (error instanceof BusinessBpmnErrorException bpmn) {
            return JobOutcome.throwBpmnError(
                bpmn.errorCode(),
                bpmn.message(),
                bpmn.variables()
            );
        }

        if (error instanceof ContractViolationException) {
            return JobOutcome.failNonRetryable(
                "Worker contract violation: " + safeMessage(error)
            );
        }

        return JobOutcome.failRetryable(
            Math.max(0, job.getRetries() - 1),
            "Unexpected worker failure: " + safeClassName(error),
            Duration.ofSeconds(10)
        );
    }
}
```

Tujuannya: error policy tidak tersebar di semua handler.

---

## 11. Fail Fast vs Retry: Decision Framework

Tidak semua error layak retry.

Gunakan pertanyaan ini:

### 11.1 Apakah input yang sama bisa berhasil jika dicoba lagi?

Jika ya, retry masuk akal.

Contoh:

```text
HTTP 503, timeout, connection reset
```

Jika tidak:

```text
missing mandatory variable, invalid schema, unsupported enum
```

retry hanya membuang resource.

### 11.2 Apakah retry aman terhadap side effect?

Jika job melakukan external call non-idempotent, retry bisa berbahaya.

Contoh:

```text
create payment
issue license
send email
create external case
```

Retry aman hanya jika ada idempotency key, dedup, atau reconciliation.

### 11.3 Apakah error perlu human repair?

Jika perlu, incident lebih tepat daripada retry 100 kali.

### 11.4 Apakah business stakeholder perlu melihat path ini di diagram?

Jika ya, gunakan BPMN path: error, escalation, gateway, timer, user task.

### 11.5 Apakah error terjadi karena bug deployment?

Jika ya, incident + fix deployment + retry/resolution.

---

## 12. Java Worker Template: Explicit Outcome Pattern

Daripada menulis handler seperti ini:

```java
public void handle(ActivatedJob job) {
    service.doWork(job);
    complete(job);
}
```

Gunakan pattern outcome eksplisit.

```java
public interface WorkerUseCase<I, O> {
    WorkerDecision<O> execute(I input);
}

public sealed interface WorkerDecision<O>
        permits WorkerDecision.Completed,
                WorkerDecision.BpmnError,
                WorkerDecision.RetryableFailure,
                WorkerDecision.NonRetryableFailure {

    record Completed<O>(O output) implements WorkerDecision<O> {}

    record BpmnError<O>(
            String errorCode,
            String errorMessage,
            Map<String, Object> variables
    ) implements WorkerDecision<O> {}

    record RetryableFailure<O>(
            String safeMessage,
            Duration backoff
    ) implements WorkerDecision<O> {}

    record NonRetryableFailure<O>(
            String safeMessage
    ) implements WorkerDecision<O> {}
}
```

Untuk Java 8, karena belum ada sealed interface dan record, gunakan class biasa:

```java
public abstract class WorkerDecision<O> {

    public static final class Completed<O> extends WorkerDecision<O> {
        private final O output;
        public Completed(O output) { this.output = output; }
        public O output() { return output; }
    }

    public static final class BpmnError<O> extends WorkerDecision<O> {
        private final String errorCode;
        private final String errorMessage;
        private final Map<String, Object> variables;
        // constructor + getters
    }

    public static final class RetryableFailure<O> extends WorkerDecision<O> {
        private final String safeMessage;
        private final Duration backoff;
        // constructor + getters
    }

    public static final class NonRetryableFailure<O> extends WorkerDecision<O> {
        private final String safeMessage;
        // constructor + getters
    }
}
```

Kemudian adapter Zeebe:

```java
public final class ZeebeJobResponder {

    private final CamundaClient client;
    private final ObjectMapper objectMapper;

    public void respond(ActivatedJob job, WorkerDecision<?> decision) {
        if (decision instanceof WorkerDecision.Completed<?> completed) {
            client.newCompleteCommand(job.getKey())
                    .variables(toMap(completed.output()))
                    .send()
                    .join();
            return;
        }

        if (decision instanceof WorkerDecision.BpmnError<?> error) {
            client.newThrowErrorCommand(job.getKey())
                    .errorCode(error.errorCode())
                    .errorMessage(error.errorMessage())
                    .variables(error.variables())
                    .send()
                    .join();
            return;
        }

        if (decision instanceof WorkerDecision.RetryableFailure<?> failure) {
            int remainingRetries = Math.max(0, job.getRetries() - 1);
            client.newFailCommand(job.getKey())
                    .retries(remainingRetries)
                    .errorMessage(failure.safeMessage())
                    .retryBackoff(failure.backoff())
                    .send()
                    .join();
            return;
        }

        if (decision instanceof WorkerDecision.NonRetryableFailure<?> failure) {
            client.newFailCommand(job.getKey())
                    .retries(0)
                    .errorMessage(failure.safeMessage())
                    .send()
                    .join();
            return;
        }

        throw new IllegalArgumentException("Unsupported worker decision: " + decision);
    }
}
```

Kenapa pattern ini kuat?

Karena domain logic tidak langsung tahu API Zeebe. Domain logic hanya membuat keputusan. Adapter yang menerjemahkan ke Zeebe command.

---

## 13. BPMN Error Design Rules

### 13.1 Error Code Harus Stabil

Jangan gunakan error code dari message exception mentah.

Buruk:

```text
java.lang.IllegalArgumentException: address must not be null
```

Baik:

```text
ADDRESS_UNVERIFIABLE
DOCUMENT_INVALID
PAYMENT_DECLINED
```

### 13.2 Error Code Harus Terbatas

Jangan buat ratusan error code untuk variasi kecil.

Lebih baik:

```text
DOCUMENT_INVALID
```

Dengan variable detail:

```json
{
  "documentValidation": {
    "reasonCode": "EXPIRED",
    "field": "expiryDate"
  }
}
```

Daripada:

```text
DOCUMENT_EXPIRED
DOCUMENT_BLURRY
DOCUMENT_WRONG_FORMAT
DOCUMENT_NAME_MISMATCH
DOCUMENT_MISSING_SIGNATURE
...
```

Terlalu banyak error code membuat BPMN sulit dibaca.

### 13.3 Error Boundary Harus Dekat dengan Responsibility

Jika error berasal dari `Verify Document`, boundary error biasanya ditempel di task/subprocess yang melakukan verifikasi dokumen.

Jangan tangkap semua error di root process kalau recovery path sebenarnya local.

### 13.4 Jangan Campur Technical Error dan BPMN Error

`DATABASE_DOWN` bukan BPMN error.

`HTTP_TIMEOUT` bukan BPMN error.

`NULL_POINTER` bukan BPMN error.

Kecuali domain Anda secara eksplisit memodelkan technical outage sebagai business path, misalnya:

```text
External registry unavailable → manual registry check
```

Dalam kasus itu error code lebih baik domain-oriented:

```text
REGISTRY_CHECK_UNAVAILABLE
```

bukan:

```text
HTTP_503
```

---

## 14. Incident Design Rules

### 14.1 Incident Harus Actionable

Incident message harus menjawab:

1. job type apa;
2. process instance mana;
3. failure category apa;
4. retryable atau tidak;
5. safe next action apa;
6. correlation id untuk log;
7. external reference id jika ada.

Contoh:

```text
VERIFY_ADDRESS failed: OneMap API returned 401 after token refresh. category=AUTH_CONFIG_ERROR, retryable=false, correlationId=..., externalRequestId=...
```

### 14.2 Incident Jangan Berisi PII

Hindari:

```text
Applicant S1234567A address 10 Example Street failed validation
```

Gunakan reference:

```text
Address verification failed for applicationId=APP-2026-000123, field=postalCode, reason=INVALID_FORMAT
```

### 14.3 Incident Harus Punya Ownership

Setiap incident category harus punya owner:

| Category | Owner |
|---|---|
| Contract violation | Engineering |
| Downstream unavailable | Platform/Integration team |
| Invalid business data | Operations / Case officer |
| Auth config error | DevOps / Security |
| Worker code bug | Service team |
| BPMN model bug | Process engineering team |

Incident tanpa owner menjadi backlog gelap.

### 14.4 Incident Tidak Boleh Jadi Normal Queue

Jika setiap hari ada ribuan incident yang “normal”, desain proses salah.

Normal business exceptions harus dimodelkan sebagai BPMN path, bukan incident.

---

## 15. Escalation vs Error vs Incident

Gunakan tabel ini sebagai anchor.

| Kondisi | BPMN Error | Escalation | Incident |
|---|---:|---:|---:|
| Technical API timeout | Tidak | Tidak | Jika retry habis |
| Payment declined | Mungkin | Tidak | Tidak |
| Case high risk | Tidak biasanya | Ya | Tidak |
| Missing mandatory variable | Tidak | Tidak | Ya |
| User rejects approval | Tidak biasanya | Tidak | Tidak |
| Supervisor must review | Tidak | Ya / gateway | Tidak |
| Downstream config broken | Tidak | Tidak | Ya |
| Document invalid | Ya / complete+gateway | Mungkin | Tidak |
| Deadline approaching | Tidak | Ya / timer | Tidak |
| Deadline missed | Timer path | Escalation possible | Tidak, kecuali model bug |
| Worker crashed | Tidak | Tidak | Bisa, setelah retry exhaustion |

### Practical Rule

```text
If the process knows what to do, model it.
If the engine cannot proceed because something is broken, incident it.
If management/human awareness is needed but not fatal, escalate it.
If this is a normal business decision, complete and route it.
```

---

## 16. Retry Policy Engineering

Retry policy bukan angka random.

### 16.1 Retry Berdasarkan Failure Class

Contoh:

| Failure | Retries | Backoff | Outcome Akhir |
|---|---:|---:|---|
| HTTP 503 | 5 | exponential 10s–5m | incident jika habis |
| HTTP 429 | 8 | longer backoff | incident jika habis |
| DNS failure | 5 | 30s–2m | incident |
| Invalid variable schema | 0 | none | incident langsung |
| Business rejection | 0 | none | complete/error path |
| External duplicate detected | 0 | none | complete using previous result |
| Auth token expired | internal refresh first | none | retry only if refresh fails |
| Forbidden | 0 | none | incident/security defect |

### 16.2 Retry Storm

Retry storm terjadi ketika banyak job gagal dan retry terlalu cepat.

Gejala:

- downstream makin down;
- worker CPU tinggi;
- gateway pressure;
- broker command volume naik;
- incident meledak;
- logs bising;
- operator tidak tahu mana root cause.

Mitigasi:

- exponential backoff;
- circuit breaker di worker;
- per-job-type concurrency limit;
- rate limit worker;
- bulkhead per downstream;
- pause worker deployment;
- fail fast non-retryable errors;
- alert berdasarkan root cause, bukan per job.

### 16.3 Retry Budget

Retry budget menjawab:

> Berapa lama process boleh menunggu technical recovery sebelum human/operator perlu tahu?

Contoh:

```text
Document verification service:
- 5 retries
- 30s, 1m, 2m, 5m, 10m
- total retry window ±18.5 minutes
- after that incident
```

Jika SLA task 15 menit, retry window 18 menit mungkin terlalu panjang.

---

## 17. Business Error Payload

Saat throw BPMN error, jangan hanya kirim string.

Kirim variable yang bisa dipakai downstream.

Contoh:

```json
{
  "documentError": {
    "code": "DOCUMENT_INVALID",
    "reasonCode": "EXPIRED",
    "humanMessage": "The uploaded identity document is expired.",
    "detectedAt": "2026-06-21T10:15:30Z",
    "source": "document-verification-worker",
    "canUserFix": true
  }
}
```

BPMN path bisa memakai variable ini untuk:

- render form;
- decide manual review;
- notify applicant;
- write audit trail;
- generate letter;
- route to officer.

### Payload Rules

1. Jangan masukkan stack trace.
2. Jangan masukkan PII berlebihan.
3. Gunakan reason code stabil.
4. Pisahkan human message dari machine code.
5. Sertakan source dan timestamp.
6. Sertakan remediation hint jika useful.

---

## 18. Error Handling untuk External API

External API adalah sumber failure paling umum.

### 18.1 HTTP Status Mapping

Contoh mapping umum:

| HTTP Status | Meaning | Zeebe Outcome |
|---|---|---|
| 200/201 | Success | Complete |
| 202 | Accepted async | Complete + wait message / store reference |
| 400 | Bad request | Incident jika request dibentuk dari variable internal; BPMN path jika business validation from external |
| 401 | Auth failure | refresh token; jika tetap gagal incident |
| 403 | Permission/config issue | incident/security defect |
| 404 | Depends | BPMN error if domain not found; incident if endpoint/config wrong |
| 409 | Conflict | idempotency/reconciliation; may complete previous result |
| 422 | Business validation | complete+status or BPMN error |
| 429 | Rate limit | fail retryable with backoff |
| 500 | Server error | fail retryable |
| 503 | unavailable | fail retryable |
| timeout | unknown | retry/reconcile; careful with side effect |

### 18.2 Timeout Ambiguity

Timeout does not mean the external system did not process the request.

For non-idempotent external calls:

```text
request sent → external system committed → response lost/timeout
```

If worker retries blindly, duplicate side effect may happen.

Correct design:

- send idempotency key;
- store external request record;
- query by reference before retry;
- reconcile unknown status;
- complete job if previous success found;
- only create new request if safe.

---

## 19. Error Handling with Outbox/Inbox

Untuk side effect penting, gunakan outbox/inbox pattern.

### 19.1 Worker with Outbox

```text
Zeebe job activated
   ↓
Worker validates input
   ↓
DB transaction:
   - create/update business state
   - insert outbox command with idempotency key
   ↓
Complete Zeebe job OR continue after dispatcher?
```

Ada beberapa desain:

#### Design A — Worker directly calls external API

Simple, tetapi risk duplicate lebih tinggi.

#### Design B — Worker writes outbox, dispatcher calls external API

Lebih robust, tetapi process completion semantics harus jelas.

#### Design C — Worker starts external command, process waits for callback message

Cocok untuk async external system.

```text
[Send Request Worker]
        ↓ complete with externalRequestId
[Wait for Callback Message]
        ↓
[Continue]
```

### 19.2 Inbox for Callback

Callback handler harus idempotent:

```text
receive callback
  ↓
check callbackId/messageId
  ↓
if duplicate: acknowledge
  ↓
persist event
  ↓
publish Zeebe message with correlation key and messageId
```

Jika publish message gagal setelah persist, retry publisher. Jangan hilangkan callback.

---

## 20. Error Handling in Regulatory / Case Management Context

Dalam sistem regulatory, error handling bukan hanya uptime. Ia menyangkut defensibility.

Contoh domain:

```text
Application submitted
→ Screening
→ Officer review
→ External registry check
→ Decision
→ Appeal
→ Enforcement escalation
```

### 20.1 Business Rejection

Applicant tidak memenuhi kriteria.

Outcome:

```text
Complete screening task with result=REJECTED
Route to rejection notice generation
```

Audit:

```text
who/what rule rejected, when, based on what evidence/version
```

### 20.2 External Registry Unavailable

Registry API down.

Outcome:

```text
Fail job with retry/backoff
Incident if outage exceeds retry budget
Optional timer/escalation if SLA impacted
```

### 20.3 Registry Mismatch

Registry returns different data.

Outcome:

```text
BPMN error or complete with status=DATA_MISMATCH
Route to manual review
```

### 20.4 Officer Needs Supervisor

Outcome:

```text
Escalation / user task assignment to supervisor
```

Not incident.

### 20.5 Model Bug Causes Wrong Route

Outcome:

```text
Incident / process modification / migration / audit note
```

Potentially governance issue.

---

## 21. Error Handling and Process Versioning

Error semantics must survive versioning.

### 21.1 Stable Error Codes Across Versions

If process v1 catches:

```text
DOCUMENT_INVALID
```

Worker v2 should not suddenly throw:

```text
DOC_BAD
```

unless process model v2 is deployed and old instances are protected.

### 21.2 Worker Compatibility

Running process instances may still create job types and expect error codes from old model.

Therefore worker deployment must consider:

- old process versions;
- old variable schemas;
- old error codes;
- old retry policy;
- old business path.

### 21.3 Error Code Deprecation

Use staged deprecation:

```text
Phase 1: support old and new error code
Phase 2: migrate/complete old process instances
Phase 3: remove old error code from worker
Phase 4: remove old BPMN catch path
```

---

## 22. Error Handling and Observability

Every failure path must be observable.

### 22.1 Required Log Fields

Worker logs should include:

```text
processInstanceKey
jobKey
elementId
bpmnProcessId
processDefinitionVersion
jobType
workerName
correlationId
businessKey/applicationId
tenantId if applicable
failureCategory
zeebeOutcome
remainingRetries
externalSystem
externalReferenceId
```

### 22.2 Metrics

Useful metrics:

```text
worker_jobs_completed_total{jobType}
worker_jobs_failed_total{jobType, failureCategory}
worker_bpmn_errors_total{jobType, errorCode}
worker_incident_candidates_total{jobType}
worker_retry_backoff_seconds{jobType}
worker_external_call_latency_seconds{system}
worker_external_call_failures_total{system, status}
process_business_rejections_total{processId, reasonCode}
```

### 22.3 Alerting

Do not alert on every individual failure.

Alert on:

- incident count increasing;
- retry exhaustion rate;
- failure rate by job type;
- downstream outage affecting many process instances;
- business rejection anomaly;
- BPMN error spike;
- exporter lag hiding incidents;
- stuck user task due escalation bug.

---

## 23. Testing Error Semantics

A mature Camunda 8 project tests not only happy path.

### 23.1 Test Matrix

| Scenario | Expected Outcome |
|---|---|
| external API 503 | fail job, retry remains |
| external API 503 until retries exhausted | incident |
| business validation failed | complete+gateway or BPMN error |
| missing mandatory variable | incident/non-retryable failure |
| duplicate external request | complete with previous result |
| timeout after external success | reconciliation before retry |
| BPMN error code caught | route to boundary path |
| BPMN error code not caught | should fail model test/design review |
| retryable exception with backoff | job not immediately retried |
| human rejection | normal business path, no incident |

### 23.2 Contract Test for Error Codes

Maintain a test that verifies worker error codes exist in BPMN model.

Pseudo approach:

```text
1. Parse BPMN XML
2. Extract error codes from boundary/error events
3. Extract worker-declared error codes
4. Fail build if worker throws code not modelled
5. Warn if BPMN catches code no worker can throw
```

This is extremely valuable in large teams.

---

## 24. Anti-Patterns

### 24.1 Throwing Java Exception for Business Rejection

Bad:

```java
if (!approved) throw new RuntimeException("Rejected");
```

Why bad:

- creates retry/incident incorrectly;
- pollutes operational dashboards;
- hides business decision;
- confuses support team.

### 24.2 BPMN Error for Technical Outage

Bad:

```text
HTTP_503 → BPMN Error → Manual Review
```

Why bad:

- user sees business path for system outage;
- no retry budget;
- no incident ownership;
- operational failure becomes business workload.

### 24.3 Infinite Retries

Bad:

```text
retries = 999999
```

Why bad:

- hides persistent failure;
- overloads downstream;
- delays SLA breach visibility;
- makes recovery ambiguous.

### 24.4 Incident as Business Queue

Bad:

```text
Every suspicious case becomes incident.
```

Why bad:

- Operate becomes business inbox;
- operators become case officers;
- engine incident loses meaning;
- audit separation is broken.

### 24.5 Error Codes Coupled to Java Class Names

Bad:

```text
com.example.PaymentDeclinedException
```

Why bad:

- leaks implementation;
- unstable across refactor;
- unreadable to business/process owners.

### 24.6 Stack Trace in Process Variables

Bad:

```json
{
  "error": "full stack trace..."
}
```

Why bad:

- payload bloat;
- possible secret leak;
- bad searchability;
- projection/storage pollution.

### 24.7 Catch-All Boundary Error

A catch-all BPMN error can be useful at subprocess boundary, but dangerous if used carelessly.

Bad:

```text
Any error → generic manual review
```

Why bad:

- technical bug becomes manual work;
- root cause hidden;
- process loses semantic precision.

---

## 25. Production Error Handling Checklist

### 25.1 Worker Checklist

- [ ] Worker distinguishes business result, BPMN error, retryable failure, non-retryable failure.
- [ ] Worker has explicit error taxonomy.
- [ ] Worker does not throw raw exception into process semantics.
- [ ] Worker maps HTTP/downstream errors intentionally.
- [ ] Worker uses idempotency key for side-effecting calls.
- [ ] Worker logs processInstanceKey/jobKey/jobType/correlationId.
- [ ] Worker redacts sensitive error detail.
- [ ] Worker has retry/backoff policy per failure category.
- [ ] Worker does not retry non-retryable contract violations forever.
- [ ] Worker supports old process versions where required.

### 25.2 BPMN Checklist

- [ ] Business negative outcomes are modelled as normal paths where appropriate.
- [ ] BPMN errors have clear catchers.
- [ ] Error codes are stable and documented.
- [ ] Escalation is used for non-fatal organizational attention.
- [ ] Timer paths model deadlines instead of relying on incidents.
- [ ] Manual repair paths are explicit when business-owned.
- [ ] Technical failures do not become misleading business paths.
- [ ] Incident-producing failures have owner and runbook.

### 25.3 Operations Checklist

- [ ] Incident categories are documented.
- [ ] Operators know when to update variables vs retry vs escalate.
- [ ] Incident messages are actionable.
- [ ] Dashboards separate technical failures and business rejections.
- [ ] Alert thresholds avoid noise.
- [ ] Runbooks include root cause examples.
- [ ] Recovery is tested.

---

## 26. Design Heuristics

Use these heuristics during design review.

### Heuristic 1 — “Would the business draw this path?”

If yes, model it in BPMN.

If no, it may be technical failure or internal implementation detail.

### Heuristic 2 — “Can the same input succeed later?”

If yes, retry may be appropriate.

If no, fail fast or route as business outcome.

### Heuristic 3 — “Does this require human business judgment or technical repair?”

Business judgment → user task/escalation/manual review.  
Technical repair → incident/runbook.

### Heuristic 4 — “Is retry safe after partial side effect?”

If not, design idempotency/reconciliation before enabling retry.

### Heuristic 5 — “Will this look embarrassing in an audit?”

If business rejection appears as `RuntimeException`, yes.

If regulatory decision is hidden in stack trace, yes.

If incident resolution has no reason recorded, yes.

### Heuristic 6 — “Can support distinguish symptom from cause?”

If every error says `Failed to process job`, no.

### Heuristic 7 — “Does the model still make sense six months later?”

If error codes are implementation names, no.

---

## 27. Reference Example: Address Verification Worker

Scenario:

```text
Application process needs to verify applicant address using external address registry.
```

Possible outcomes:

| Condition | Outcome |
|---|---|
| address verified | Complete with `addressVerification.status=VERIFIED` |
| postal code invalid | Complete with `status=INVALID` or BPMN error `ADDRESS_INVALID` |
| address registry timeout | Fail job retryable |
| registry unavailable for long time | Incident after retries exhausted |
| applicant address mismatch | BPMN error `ADDRESS_MISMATCH` or complete+manual review status |
| registry returns malformed response | Incident / contract violation |
| API credential expired | Incident/security config |
| rate limit | Fail job retryable with longer backoff |

Pseudo worker decision:

```java
public WorkerDecision<AddressVerificationOutput> verify(AddressVerificationInput input) {
    ValidationResult validation = validator.validate(input);
    if (!validation.valid()) {
        return new WorkerDecision.Completed<>(
            AddressVerificationOutput.invalid(validation.reasonCode())
        );
    }

    try {
        RegistryResponse response = registryClient.verify(input.toRegistryRequest());

        if (response.verified()) {
            return new WorkerDecision.Completed<>(
                AddressVerificationOutput.verified(response.referenceId())
            );
        }

        if (response.mismatch()) {
            return new WorkerDecision.BpmnError<>(
                "ADDRESS_MISMATCH",
                "Address registry returned mismatch",
                Map.of("addressMismatch", response.toSafeVariables())
            );
        }

        return new WorkerDecision.Completed<>(
            AddressVerificationOutput.manualReview(response.reasonCode())
        );

    } catch (RateLimitException e) {
        return new WorkerDecision.RetryableFailure<>(
            "Address registry rate limit",
            Duration.ofMinutes(2)
        );
    } catch (RegistryUnavailableException e) {
        return new WorkerDecision.RetryableFailure<>(
            "Address registry unavailable",
            Duration.ofSeconds(30)
        );
    } catch (MalformedRegistryResponseException e) {
        return new WorkerDecision.NonRetryableFailure<>(
            "Address registry response contract violation"
        );
    }
}
```

This is not just cleaner code. It preserves semantic correctness.

---

## 28. Reference Example: Regulatory Enforcement Escalation

Scenario:

```text
A compliance case is reviewed. If risk score is high, supervisor must be informed, but the case may continue.
```

Wrong design:

```text
High risk → FailJob → Incident
```

Why wrong:

- high risk is not system failure;
- operator should not repair it;
- business process knows how to handle it.

Better design:

```text
[Calculate Risk]
      |
      v
[Gateway]
  | LOW/MEDIUM → Continue Review
  | HIGH       → Supervisor Review / Escalation Path
```

Or escalation event if it must notify higher scope while continuing.

Audit benefit:

```text
The case was escalated due to HIGH_RISK score by policy version X at time Y.
```

Not:

```text
RuntimeException: high risk
```

---

## 29. How to Decide: Complete vs BPMN Error vs FailJob vs Incident

Use this decision tree:

```text
Worker receives job
   |
   v
Can worker parse required variables?
   | no
   v
FailJob retries=0 → incident (contract/data defect)
   |
  yes
   v
Does business operation execute and produce a valid business outcome?
   | yes
   v
Is the outcome part of normal business decision space?
   | yes
   v
CompleteJob with result variables → BPMN gateway/path
   |
  no, exceptional business path
   v
Throw BPMN Error if model catches it
   |
   v
Did technical dependency fail transiently?
   | yes
   v
FailJob retries-1 + backoff
   |
  no
   v
Is failure non-retryable technical/config/model defect?
   | yes
   v
FailJob retries=0 → incident
   |
   v
Unknown unexpected failure
   |
   v
FailJob retries-1 or retries=0 depending policy, with safe message
```

Memorize this tree. It prevents most workflow error handling mistakes.

---

## 30. Relation to Previous Parts

This part connects strongly to earlier parts:

- From Part 002: Zeebe records command outcomes; worker decisions become stream records.
- From Part 004: BPMN semantics determine whether token follows normal path, boundary error, timer, or event subprocess.
- From Part 006: worker lifecycle affects timeout and retry behavior.
- From Part 007: idempotency determines whether retry is safe.
- From Part 008: variable contract determines whether failures are business or contract defects.
- From Part 010: correlation and message design determine whether external async failures become recoverable or lost.

Error handling cannot be designed in isolation.

---

## 31. Staff-Level Questions You Should Be Able to Answer

After this part, you should be able to answer:

1. Why is BPMN error not the same as Java exception?
2. When should worker complete job with negative status instead of throw BPMN error?
3. When should retry be disabled immediately?
4. Why is incident not a business queue?
5. How do you design retry backoff for external API outage?
6. How do you prevent duplicate side effect during retry?
7. What fields must be logged for a failed worker job?
8. How do you make error codes stable across process versions?
9. How do you distinguish high-risk case escalation from technical failure?
10. How do you test that worker-thrown BPMN errors are caught by model?
11. What happens when job timeout expires but external side effect may have succeeded?
12. Why is `RuntimeException("Rejected")` a workflow design smell?
13. How do you design incident ownership and runbook?
14. How do you prevent retry storm?
15. How do you make error handling audit-defensible?

---

## 32. Key Takeaways

1. Camunda 8 error handling is semantic state modelling, not just Java exception handling.
2. `CompleteJob`, `FailJob`, `ThrowError`, `Incident`, `Escalation`, and `Timer` mean different things.
3. Business rejection is usually not a technical failure.
4. BPMN error is a process-modelled business exception, not a generic exception.
5. Incident means the engine cannot proceed automatically and needs intervention.
6. Escalation means attention is needed, not necessarily failure.
7. Retry is only safe if the operation is retryable and side effects are controlled.
8. Error codes are contracts between workers and BPMN models.
9. Incident messages must be actionable and safe.
10. Production-grade worker design requires explicit error taxonomy and outcome mapping.
11. Audit-defensible systems distinguish business decisions from system failures.
12. Top-level Camunda 8 engineers design error semantics before writing worker code.

---

## 33. Mini Exercise

Design error handling for this scenario:

```text
A license renewal process calls an external compliance registry.

Possible outcomes:
1. Registry says applicant is clear.
2. Registry says applicant is under investigation.
3. Registry is temporarily unavailable.
4. Registry returns malformed JSON.
5. Registry says applicant ID does not exist.
6. Request times out after being sent.
7. Worker receives process variable without applicantId.
```

For each outcome, decide:

```text
CompleteJob?
Throw BPMN Error?
FailJob with retries?
Incident?
Escalation?
Timer/manual review?
```

Suggested answer pattern:

| Outcome | Mechanism | Reason |
|---|---|---|
| Clear | CompleteJob | normal positive result |
| Under investigation | BPMN path / escalation / manual review | business exceptional path |
| Temporarily unavailable | FailJob retryable | transient technical failure |
| Malformed JSON | Incident | contract/integration defect |
| Applicant ID not found | domain-dependent: BPMN error or business result | may be business data mismatch |
| Timeout after send | retry only with idempotency/reconciliation | side effect unknown |
| Missing applicantId | Incident | process variable contract defect |

---

## 34. Penutup

Error handling adalah salah satu pembeda terbesar antara engineer yang “bisa menjalankan Camunda” dan engineer yang bisa membangun orchestration platform yang tahan production.

Di Camunda 8/Zeebe, setiap error decision harus menjawab:

```text
Apakah ini business outcome, business exception, organizational escalation, technical retry, atau operational incident?
```

Jika jawabannya kabur, model dan worker akan kabur juga.

Part berikutnya akan masuk ke **time semantics**: timer, deadline, SLA, escalation berbasis waktu, retry timeout vs business timeout, dan bagaimana memodelkan regulatory deadlines tanpa menjadikan incident sebagai pengganti process design.

---

# Status Seri

Seri **belum selesai**.

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-012.md
```

Judul:

```text
Part 012 — Timers, Deadlines, SLA, Escalation, and Time Semantics
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-010.md">⬅️ Part 010 — Process Instantiation, Business Keys, Correlation Keys, and Message Design</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-012.md">Part 012 — Timers, Deadlines, SLA, Escalation, and Time Semantics ➡️</a>
</div>
