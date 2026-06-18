# learn-java-bpmn-camunda-process-orchestration-engineering

# Part 15 — Subprocess, Call Activity, Reusable Process, and Process Composition

> Seri: Java BPMN, Camunda, dan Process Orchestration Engineering  
> Target pembaca: senior Java engineer / tech lead / solution architect yang ingin mendesain workflow system yang production-grade, auditable, maintainable, dan tahan perubahan.  
> Fokus Java: Java 8 hingga Java 25, dengan penekanan pada arsitektur worker, kontrak proses, reliability, dan evolusi sistem.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 14, kita sudah membangun fondasi berikut:

1. apa itu process orchestration,
2. apa arti BPMN sebagai execution contract,
3. elemen-elemen inti BPMN,
4. disiplin modeling production-ready,
5. perbedaan Camunda 7 dan Camunda 8,
6. internals Zeebe,
7. Java client dan worker engineering,
8. idempotency dan retry,
9. process variables,
10. error, incident, escalation, compensation,
11. human workflow,
12. DMN,
13. message correlation,
14. timer, SLA, dan concurrency.

Sekarang kita masuk ke pertanyaan arsitektural yang sering terlihat sederhana tetapi paling sering merusak workflow system jangka panjang:

> Bagaimana memecah process model yang besar menjadi bagian-bagian yang reusable, composable, testable, dan tetap mudah dioperasikan?

Di BPMN, alat utamanya adalah:

1. embedded subprocess,
2. event subprocess,
3. call activity,
4. reusable process,
5. process composition,
6. parent-child process relationship,
7. variable mapping,
8. version binding,
9. error propagation,
10. process library governance.

Part ini bukan sekadar membahas simbol subprocess. Fokusnya adalah **composition discipline**.

---

## 1. Masalah Dasar: Workflow Besar Pasti Ingin Dipecah

Dalam sistem regulatory/case management, proses nyata jarang linear.

Contoh proses application review:

```text
Receive application
  -> Validate submission
  -> Check eligibility
  -> Request missing document if needed
  -> Assign officer
  -> Perform risk screening
  -> Request external agency input
  -> Perform officer assessment
  -> Route to supervisor approval
  -> Generate decision letter
  -> Notify applicant
  -> Update registry
  -> Archive case
```

Kalau semua dibuat dalam satu diagram, awalnya terlihat mudah. Setelah beberapa bulan, proses mulai bertambah:

```text
- expedited lane
- appeal lane
- rework lane
- missing document lane
- manual override lane
- external agency timeout lane
- supervisor escalation lane
- director approval lane
- compensation path
- audit repair path
- historical version path
- new policy effective date path
```

Akhirnya diagram berubah menjadi:

```text
                     +--------------------+
                     | external response  |
                     +--------------------+
                              |
Receive -> Validate -> Gateway -> Gateway -> Gateway -> Gateway -> Notify
     \        \          \          \          \          \
      \        \          Timer      Error      Appeal     Rework
       \        \                                      
        Missing Docs -> More Gateways -> More Timers -> More Tasks
```

Ini bukan lagi process model. Ini visual debt.

Masalahnya bukan karena BPMN buruk. Masalahnya adalah kita belum punya prinsip komposisi.

---

## 2. Mental Model Utama: Composition Is Boundary Design

Memecah process bukan sekadar “agar diagram lebih rapi”. Memecah process berarti membuat boundary.

Boundary selalu punya konsekuensi:

| Boundary | Pertanyaan |
|---|---|
| Execution boundary | Apakah lifecycle-nya terpisah? |
| Transaction boundary | Apakah kegagalan child process mempengaruhi parent? |
| Variable boundary | Data apa yang boleh lewat? |
| Ownership boundary | Tim/domain mana yang memiliki subprocess? |
| Version boundary | Apakah parent harus ikut berubah saat child berubah? |
| Audit boundary | Apakah audit parent dan child harus dipisah? |
| Operational boundary | Siapa memperbaiki incident di child? |
| Security boundary | Siapa boleh melihat/menjalankan child? |

Top 1% engineer tidak bertanya:

> “Ini bisa dijadikan subprocess tidak?”

Mereka bertanya:

> “Apakah bagian ini punya lifecycle, ownership, data contract, failure model, dan versioning boundary yang layak dipisahkan?”

---

## 3. Jenis Komposisi dalam BPMN

Secara praktis, kita punya beberapa cara menyusun proses:

```text
Main Process
  |
  +-- Embedded Subprocess
  |      - hidup dalam process yang sama
  |      - dipakai untuk grouping / scoped behavior
  |      - tidak reusable lintas process
  |
  +-- Event Subprocess
  |      - aktif karena event tertentu
  |      - bisa interrupting atau non-interrupting
  |      - cocok untuk exceptional/reactive behavior
  |
  +-- Call Activity
  |      - memanggil process lain
  |      - reusable lintas process
  |      - punya process definition sendiri
  |
  +-- Message-based Composition
  |      - parent dan child tidak dipanggil langsung
  |      - komunikasi via message/event
  |      - coupling lebih loose
```

Camunda 8 mendokumentasikan subprocess sebagai container elemen, dan elemen yang didukung mencakup embedded subprocess, call activity, event subprocess, dan ad-hoc subprocess. Call activity adalah reusable subprocess yang memanggil process lain yang dieksternalisasi sebagai BPMN terpisah. Embedded subprocess dipakai untuk mengelompokkan elemen di process yang sama, sedangkan event subprocess dipicu oleh event. Referensi resmi Camunda menyebut call activity sebagai cara untuk mereferensikan process lain, bukan sekadar collapsed diagram dalam file yang sama. 

---

## 4. Embedded Subprocess

### 4.1 Apa Itu Embedded Subprocess?

Embedded subprocess adalah subprocess yang hidup di dalam process yang sama.

Mental model:

```text
Parent process instance
  |
  +-- same process definition
      |
      +-- embedded subprocess scope
```

Embedded subprocess bukan process terpisah. Ia adalah scope internal.

Contoh:

```text
Application Review Process
  -> [Embedded Subprocess: Validate Submission]
       -> Check mandatory fields
       -> Check document completeness
       -> Check duplicate application
  -> Continue review
```

Validasi submission bisa dimodelkan sebagai embedded subprocess jika:

1. ia bagian natural dari parent process,
2. tidak perlu dipakai ulang oleh banyak process lain,
3. tidak punya lifecycle independent,
4. tidak perlu versioning terpisah,
5. tidak perlu ownership berbeda.

---

### 4.2 Kapan Memakai Embedded Subprocess?

Gunakan embedded subprocess ketika Anda ingin:

1. mengelompokkan beberapa activity dalam satu business phase,
2. memberi boundary event pada sekelompok activity,
3. membuat diagram lebih readable,
4. membuat scope variable lokal,
5. membuat error/timer/cancel boundary untuk phase tertentu,
6. menunjukkan bahwa beberapa step adalah satu logical unit.

Contoh yang baik:

```text
Main Process
  -> Embedded Subprocess: Collect Missing Documents
       -> Notify applicant
       -> Wait for resubmission
       -> Validate resubmitted documents
       -> If incomplete, request again
  -> Continue assessment
```

Mengapa cocok sebagai embedded subprocess?

Karena collect missing documents adalah phase dalam process utama. Ia tidak harus menjadi process reusable sendiri kecuali banyak process lain juga memakainya dengan lifecycle yang sama.

---

### 4.3 Embedded Subprocess sebagai Scope Boundary

Embedded subprocess dapat dipakai sebagai boundary untuk:

1. timer,
2. error,
3. escalation,
4. compensation,
5. variable mapping/scope,
6. logical phase cancellation.

Contoh:

```text
Application Review
  -> Embedded Subprocess: Officer Assessment
       -> Assign officer
       -> Review facts
       -> Prepare recommendation
       -> Submit recommendation
     Boundary Timer: Assessment SLA breached
       -> Escalate to supervisor
```

Timer boundary pada subprocess berarti:

```text
Jika phase Officer Assessment terlalu lama,
trigger escalation untuk seluruh phase tersebut,
bukan hanya untuk satu task kecil.
```

Ini sering lebih baik daripada menempelkan timer pada setiap user task.

---

### 4.4 Embedded Subprocess Anti-pattern

Anti-pattern 1 — menggunakan embedded subprocess hanya agar diagram terlihat “collapsed”.

```text
Bad:
Main Process
  -> Subprocess: Everything Else
```

Kalau subprocess hanya menyembunyikan kompleksitas tanpa boundary semantics, Anda tidak menyelesaikan masalah. Anda hanya memindahkan kekacauan ke halaman lain.

Anti-pattern 2 — embedded subprocess berisi multiple abstraction level.

```text
Validate Application
  -> Check field X not null
  -> Call external API
  -> Supervisor approval
  -> Send email
  -> Update registry
```

Ini mencampur:

1. validation,
2. integration,
3. human approval,
4. notification,
5. registry update.

Subprocess harus punya satu alasan bisnis yang jelas.

Anti-pattern 3 — embedded subprocess dipakai untuk reusable logic lintas process.

Jika 7 process berbeda butuh “Generate Decision Letter” dengan behavior yang sama, embedded subprocess tidak cukup. Anda akan copy-paste model. Gunakan call activity atau worker/domain service, tergantung kebutuhan.

---

## 5. Event Subprocess

### 5.1 Apa Itu Event Subprocess?

Event subprocess adalah subprocess yang dipicu oleh event.

Bisa berada:

1. di level process,
2. di dalam embedded subprocess.

Mental model:

```text
Main Process is running
  |
  +-- Event occurs
        |
        +-- Event Subprocess starts
```

Event subprocess cocok untuk behavior yang bersifat reactive.

Contoh:

```text
While application is under review:
  applicant withdraws application
    -> event subprocess handles withdrawal
```

Atau:

```text
While enforcement case is active:
  urgent suspension order arrives
    -> event subprocess triggers urgent path
```

---

### 5.2 Interrupting vs Non-interrupting Event Subprocess

Ada dua tipe besar:

```text
Interrupting event subprocess
  -> menghentikan flow yang sedang berjalan
  -> menjalankan exceptional path

Non-interrupting event subprocess
  -> flow utama tetap berjalan
  -> subprocess tambahan berjalan paralel
```

Contoh interrupting:

```text
Application Review
  -> Officer Assessment
  -> Supervisor Approval
  -> Decision

Event Subprocess: Applicant Withdrawal
  Trigger: withdrawal message
  Behavior: interrupt main process
  Steps:
    -> mark case withdrawn
    -> notify officer
    -> archive application
```

Mengapa interrupting?

Karena setelah applicant withdraw, review normal tidak boleh lanjut.

Contoh non-interrupting:

```text
Application Review
  -> Officer Assessment
  -> Supervisor Approval
  -> Decision

Event Subprocess: Additional Document Received
  Trigger: document uploaded message
  Behavior: do not interrupt main review
  Steps:
    -> attach document
    -> notify assigned officer
```

Mengapa non-interrupting?

Karena dokumen tambahan bisa diterima tanpa menghentikan assessment.

---

### 5.3 Event Subprocess vs Boundary Event

Sering bingung:

> Kapan pakai event subprocess, kapan pakai boundary event?

Rule of thumb:

| Situasi | Pilihan |
|---|---|
| Event hanya relevan untuk satu task/subprocess tertentu | Boundary event |
| Event relevan untuk seluruh process atau phase besar | Event subprocess |
| Event harus memiliki flow handling yang kompleks | Event subprocess |
| Event hanya timeout kecil dari task tertentu | Boundary timer |
| Event bisa terjadi kapan saja selama process aktif | Event subprocess |

Contoh:

```text
Boundary event:
Wait for payment
  Boundary timer: payment deadline expired
```

Karena timer hanya relevan saat process sedang menunggu payment.

```text
Event subprocess:
Applicant withdraws application
```

Karena withdrawal bisa terjadi di banyak titik selama application masih aktif.

---

### 5.4 Event Subprocess Anti-pattern

Anti-pattern 1 — semua exceptional path dijadikan event subprocess.

Kalau error hanya terjadi pada satu service task, gunakan error boundary di task/subprocess tersebut. Jangan menaruh global event subprocess hanya karena “kelihatan clean”.

Anti-pattern 2 — non-interrupting event subprocess mengubah data utama tanpa concurrency control.

Contoh buruk:

```text
Main flow updates application status.
Non-interrupting event subprocess also updates application status.
```

Hasilnya race condition.

Gunakan:

1. domain aggregate version,
2. optimistic locking,
3. command table,
4. explicit transition rule,
5. event timestamp comparison,
6. audit snapshot.

Anti-pattern 3 — event subprocess tanpa security validation.

Contoh:

```text
Message: withdraw-application
Correlation key: applicationId
```

Kalau correlation message diterima dari external channel tanpa actor validation, siapa pun bisa memicu withdrawal. Event subprocess adalah behavior sensitif, bukan sekadar message handler.

---

## 6. Call Activity

### 6.1 Apa Itu Call Activity?

Call activity adalah elemen BPMN yang memanggil process lain.

Mental model:

```text
Parent Process Instance
  -> Call Activity
       -> Child Process Instance
            -> child flow runs
       <- child completes
  -> Parent continues
```

Call activity berbeda dari embedded subprocess:

| Aspek | Embedded Subprocess | Call Activity |
|---|---|---|
| Process definition | sama dengan parent | process lain |
| Reusable | tidak lintas process | ya |
| Versioning | ikut parent | bisa punya versi sendiri |
| Ownership | biasanya sama | bisa berbeda |
| Operational visibility | bagian parent | child process terlihat sebagai instance sendiri |
| Coupling | lebih tight | lebih explicit contract |
| Use case | grouping/phase | reusable business process |

---

### 6.2 Kapan Memakai Call Activity?

Gunakan call activity ketika bagian proses:

1. dipakai ulang oleh banyak parent process,
2. punya lifecycle bisnis yang cukup mandiri,
3. punya audit trail sendiri,
4. punya owner domain sendiri,
5. punya versioning sendiri,
6. punya error/compensation behavior sendiri,
7. bisa dites sebagai process contract tersendiri,
8. layak terlihat di operation dashboard sebagai child process.

Contoh yang cocok:

```text
Application Process
  -> Call Activity: Collect Payment
  -> Call Activity: Generate Decision Letter
  -> Call Activity: Notify Applicant
```

Tapi hati-hati. Tidak semua reusable step harus menjadi call activity.

Kadang lebih baik sebagai Java domain service:

```text
Service Task: calculateRiskScore
  -> Java worker calls RiskScoringService
```

Kalau hanya computation kecil, jangan dijadikan process.

---

### 6.3 Call Activity sebagai Process Contract

Call activity harus diperlakukan seperti API contract.

Ia punya:

1. input contract,
2. output contract,
3. error contract,
4. version contract,
5. audit contract,
6. ownership contract,
7. SLA contract.

Contoh:

```yaml
Called process: collect-payment-process
Inputs:
  applicationId: string
  applicantId: string
  paymentType: enum[APPLICATION_FEE, RENEWAL_FEE]
  amount: decimal
  currency: string
  dueAt: instant

Outputs:
  paymentStatus: enum[PAID, EXPIRED, WAIVED, FAILED]
  receiptNo: string?
  paidAt: instant?

Business errors:
  PAYMENT_EXPIRED
  PAYMENT_WAIVED
  PAYMENT_CANCELLED

Technical failures:
  payment-gateway-timeout
  payment-status-unavailable

SLA:
  payment must complete before dueAt

Owner:
  revenue/payment domain team
```

Jika call activity tidak punya contract, itu bukan composition. Itu coupling tersembunyi.

---

### 6.4 Call Activity Input/Output Mapping

Parent process tidak boleh melempar semua variable ke child process secara sembarangan.

Bad:

```text
Parent variables:
  application
  applicant
  documents
  officer
  risk
  payment
  decision
  internalFlags
  debugInfo
  entireCaseSnapshot

Call child with all variables
```

Masalah:

1. child process tahu terlalu banyak,
2. sensitive data bocor,
3. contract tidak jelas,
4. child menjadi tergantung variable parent,
5. parent sulit evolve,
6. audit sulit dibaca,
7. incident repair berbahaya.

Better:

```text
Parent -> Child input:
  applicationId
  applicantId
  paymentType
  amount
  currency
  dueAt
```

Output:

```text
Child -> Parent output:
  paymentStatus
  receiptNo
  paidAt
```

Prinsip:

> Call activity boundary harus narrow, explicit, stable, dan business-readable.

---

### 6.5 Variable Mapping Pattern

Gunakan struktur DTO yang eksplisit.

```java
public record CollectPaymentInput(
    String applicationId,
    String applicantId,
    String paymentType,
    BigDecimal amount,
    String currency,
    Instant dueAt
) {}

public record CollectPaymentOutput(
    String paymentStatus,
    String receiptNo,
    Instant paidAt
) {}
```

Untuk Java 8, gunakan class biasa:

```java
public final class CollectPaymentInput {
    private final String applicationId;
    private final String applicantId;
    private final String paymentType;
    private final BigDecimal amount;
    private final String currency;
    private final Instant dueAt;

    public CollectPaymentInput(
            String applicationId,
            String applicantId,
            String paymentType,
            BigDecimal amount,
            String currency,
            Instant dueAt) {
        this.applicationId = applicationId;
        this.applicantId = applicantId;
        this.paymentType = paymentType;
        this.amount = amount;
        this.currency = currency;
        this.dueAt = dueAt;
    }

    public String getApplicationId() { return applicationId; }
    public String getApplicantId() { return applicantId; }
    public String getPaymentType() { return paymentType; }
    public BigDecimal getAmount() { return amount; }
    public String getCurrency() { return currency; }
    public Instant getDueAt() { return dueAt; }
}
```

Jangan biarkan child process membaca variable parent seperti global map.

---

## 7. Parent-Child Lifecycle

### 7.1 Synchronous Mental Model

Call activity biasanya dipahami seperti ini:

```text
Parent waits while child runs.
Child completes.
Parent continues.
```

Tapi runtime-nya tidak sama dengan Java method call.

```java
// This is NOT the right mental model
PaymentResult result = collectPayment(input);
continueProcess(result);
```

Lebih tepat:

```text
Parent process enters call activity.
Engine creates/starts child process.
Parent token waits at call activity.
Child process progresses over time.
Child may wait for humans, timers, messages, workers.
Child completes or fails.
Parent token resumes.
```

Call activity bisa berjalan menit, hari, bulan, atau tahun.

---

### 7.2 Failure Propagation

Pertanyaan penting:

> Jika child process gagal, apa yang terjadi pada parent?

Ada beberapa kemungkinan:

1. child mengalami technical incident,
2. child melempar BPMN error,
3. child berakhir dengan business outcome tertentu,
4. child dibatalkan,
5. child timeout,
6. parent dibatalkan saat child masih berjalan.

Desain harus eksplisit.

Contoh:

```text
Parent: Application Review
  -> Call Activity: Collect Payment
       Error boundary: PAYMENT_EXPIRED
          -> Mark application as payment expired
       Error boundary: PAYMENT_CANCELLED
          -> Cancel application
       Technical incident:
          -> Operator repair, parent remains waiting
```

Jangan campur business outcome dengan technical failure.

---

### 7.3 Parent Cancellation

Jika parent process dibatalkan saat child process aktif, apa yang harus terjadi?

Kemungkinan desain:

1. child ikut dibatalkan,
2. child tetap berjalan,
3. child diberi cancellation message,
4. child melakukan compensation,
5. child masuk manual review.

Dalam many workflow engine, call activity lifecycle biasanya terkait parent. Tetapi Anda tetap harus mendesain external side effect.

Contoh:

```text
Parent application cancelled.
Child payment process already created payment order in external gateway.
```

Pertanyaan:

1. Apakah payment order harus dibatalkan?
2. Bagaimana jika payment sudah berhasil?
3. Siapa mengirim refund?
4. Apa audit state-nya?
5. Apakah parent boleh hilang sebelum child selesai clean-up?

Top 1% engineer tidak hanya bertanya apakah call activity bisa dibatalkan. Mereka bertanya apakah side effect child sudah punya cancellation/compensation contract.

---

## 8. Version Binding dan Resource Evolution

### 8.1 Masalah Versioning Call Activity

Misal parent process `application-review` memanggil child process `collect-payment`.

Hari ini:

```text
application-review v5
  calls collect-payment v2
```

Besok deploy:

```text
collect-payment v3
```

Pertanyaan:

> Parent process v5 yang masih running harus memanggil collect-payment v2 atau v3?

Jawaban yang salah:

> Yang terbaru saja.

Kenapa salah?

Karena running process bisa punya asumsi variable, error code, SLA, dan output contract lama.

Jika child process berubah breaking, parent lama bisa rusak.

---

### 8.2 Latest Binding vs Deployment/Version Binding

Secara konsep, ada beberapa style binding:

```text
Latest binding
  -> panggil versi terbaru dari child process

Deployment binding
  -> panggil versi child yang dideploy bersama parent

Version tag binding
  -> panggil versi child dengan tag tertentu

Explicit version binding
  -> panggil numeric version tertentu
```

Camunda 8 menyediakan resource binding untuk linked resources seperti call activities, business rule tasks, dan user tasks/forms. Dokumentasi Camunda menjelaskan bahwa pemilihan binding seperti `latest` dan `deployment` membantu deploy versi baru tanpa mengganggu live process dan mencegah production outage. Versi modern juga mengenal konsep version tag untuk deployed BPMN/DMN/forms sebagai label user-defined untuk resource version.

---

### 8.3 Binding Strategy

Gunakan prinsip berikut:

| Situasi | Binding yang cocok |
|---|---|
| Child process sangat stable dan backward-compatible | latest dapat diterima |
| Parent dan child dirilis sebagai satu unit | deployment binding |
| Parent butuh policy/process version tertentu | version tag binding |
| Regulated process dengan audit ketat | hindari implicit latest untuk breaking process |
| Child process sering berubah | gunakan explicit compatibility contract |

Contoh:

```text
Application review process v10
  calls generate-decision-letter tagged "2026-Q2-policy"
```

Ini lebih auditable daripada:

```text
Application review process always calls latest generate-decision-letter
```

Karena 2 tahun kemudian auditor bisa bertanya:

> Decision letter ini dibuat berdasarkan template/process versi mana?

---

### 8.4 Backward-Compatible Child Process Change

Backward-compatible change:

1. menambah optional input,
2. menambah optional output,
3. menambah internal task tanpa mengubah output,
4. memperbaiki bug internal tanpa mengubah contract,
5. menambah branch yang hanya aktif untuk input baru,
6. menjaga error code lama tetap ada.

Breaking change:

1. rename input variable,
2. rename output variable,
3. ubah enum output,
4. hapus BPMN error code,
5. ubah timing/SLA behavior,
6. ubah compensation semantics,
7. ubah meaning field tanpa nama berubah,
8. ubah authorization assumption.

Rule:

> Process composition harus punya semantic versioning discipline, bukan hanya BPMN deployment version.

---

## 9. Reusable Process Design

### 9.1 Apa yang Layak Dijadikan Reusable Process?

Tidak semua common flow layak dijadikan reusable process.

Layak jika punya:

1. business identity yang jelas,
2. input/output contract yang stabil,
3. lifecycle yang cukup independent,
4. owner yang jelas,
5. audit value sendiri,
6. operational value sendiri,
7. penggunaan lintas parent process,
8. failure/compensation logic sendiri.

Contoh reusable process yang baik:

```text
collect-payment-process
request-missing-documents-process
generate-decision-letter-process
conduct-multi-agency-consultation-process
perform-supervisor-approval-process
send-notification-process
archive-case-record-process
```

Tapi beberapa di atas masih perlu diuji. Misalnya `send-notification-process` bisa jadi terlalu kecil untuk process jika hanya satu email. Tetapi jika notification punya:

1. template selection,
2. multi-channel delivery,
3. retry,
4. bounce handling,
5. audit,
6. human fallback,
7. regulatory acknowledgement,

maka process reusable masuk akal.

---

### 9.2 Reusable Process vs Java Service

Pertanyaan penting:

> Ini reusable process atau reusable service?

Gunakan matrix berikut:

| Kriteria | Java Service | Reusable Process |
|---|---|---|
| Durasi | ms-detik | menit-hari-bulan |
| Human task | tidak | ya |
| Timer/SLA | biasanya tidak | ya |
| Message wait | jarang | ya |
| Audit flow | minimal | penting |
| Business visibility | rendah | tinggi |
| Failure repair | technical | business/operational |
| Versioned policy | bisa, tapi tersembunyi | eksplisit |
| Example | calculate fee | collect payment |

Contoh:

```text
calculateFee(applicationType, period)
```

Ini Java service/DMN, bukan process.

```text
Collect payment from applicant before due date, handle expiry, receipt, retry, waiver, and audit.
```

Ini reusable process.

---

### 9.3 Reusable Process Should Not Be Too Generic

Anti-pattern umum:

```text
generic-approval-process
```

Input:

```json
{
  "entityType": "APPLICATION",
  "entityId": "APP-001",
  "approvalType": "SUPERVISOR",
  "approvalRules": {...},
  "taskLabels": {...},
  "dynamicForms": {...},
  "callbackEvents": {...}
}
```

Masalah:

1. process menjadi mini workflow engine di atas workflow engine,
2. behavior sulit dipahami dari diagram,
3. audit menjadi generik dan miskin konteks,
4. rules tersebar di JSON,
5. testing meledak kombinatorial,
6. business tidak bisa membaca process,
7. ownership kabur.

Lebih baik:

```text
supervisor-approval-process
committee-approval-process
director-approval-process
appeal-review-approval-process
```

Atau gunakan satu process approval reusable tetapi dengan contract terbatas dan taxonomy yang jelas, bukan “dynamic everything”.

---

## 10. Process Composition Patterns

### 10.1 Phase Composition Pattern

Gunakan embedded subprocess untuk phase internal.

```text
Application Review Process
  -> Embedded Subprocess: Intake
  -> Embedded Subprocess: Assessment
  -> Embedded Subprocess: Decision
  -> Embedded Subprocess: Closure
```

Cocok jika:

1. semua phase bagian dari satu process lifecycle,
2. tidak perlu reuse lintas process,
3. ingin diagram lebih readable,
4. ingin boundary timer/error per phase.

---

### 10.2 Reusable Capability Pattern

Gunakan call activity untuk capability lintas process.

```text
Application Review
  -> Call: Request Missing Documents

Renewal Review
  -> Call: Request Missing Documents

Appeal Review
  -> Call: Request Missing Documents
```

Child process:

```text
Request Missing Documents
  -> Generate request
  -> Notify applicant
  -> Wait for upload
  -> Validate completeness
  -> Return result
```

Output:

```text
DOCUMENTS_RECEIVED
DOCUMENTS_NOT_RECEIVED
REQUEST_CANCELLED
```

---

### 10.3 Shared Human Approval Pattern

```text
Parent Process
  -> Call Activity: Supervisor Approval
       Inputs:
         caseId
         approvalContext
         requiredRole
         dueAt
       Outputs:
         decision
         decisionReason
         decidedBy
         decidedAt
```

Cocok jika approval memang seragam lintas process.

Namun hindari menjadikan semua approval sama jika secara domain berbeda:

```text
Bad:
One approval process for supervisor, legal, director, finance, enforcement, external agency.
```

Karena approval legal, finance, dan enforcement sering punya evidence, permission, SLA, dan audit requirement berbeda.

---

### 10.4 External Consultation Pattern

Regulatory systems sering butuh external agency consultation.

```text
Parent: Application Review
  -> Call Activity: Conduct External Agency Consultation
       -> Send consultation request
       -> Wait for response
       -> Reminder timer
       -> Escalation timer
       -> Timeout handling
       -> Return consultation outcome
```

Ini cocok sebagai reusable process jika banyak process membutuhkan consultation.

Contract:

```yaml
Inputs:
  consultationId
  caseId
  agencyCode
  requestPayloadRef
  dueAt

Outputs:
  status: RESPONDED | NO_RESPONSE | WITHDRAWN | ERROR
  responseRef: string?
  respondedAt: instant?
  responseClassification: enum?
```

---

### 10.5 Notification Process Pattern

Ada dua pilihan.

Simple notification:

```text
Service Task: send email
```

Complex notification:

```text
Call Activity: Send Regulatory Notification
  -> Resolve recipient
  -> Select template
  -> Generate PDF
  -> Send email
  -> Wait for delivery callback
  -> Retry failed delivery
  -> Escalate after repeated failure
  -> Store proof of delivery
```

Kalau notification butuh proof-of-delivery dan audit, call activity masuk akal.

---

### 10.6 Document Generation Pattern

```text
Call Activity: Generate Decision Letter
  -> Load template version
  -> Merge data
  -> Generate PDF
  -> Validate mandatory clauses
  -> Store document
  -> Return documentRef
```

Mengapa reusable process?

Karena dalam regulated environment, document generation bisa punya:

1. template version,
2. policy effective date,
3. approval requirement,
4. watermark,
5. officer signature,
6. document storage,
7. audit trail,
8. re-generation rule,
9. legal clause verification.

---

## 11. Process Library Governance

### 11.1 Kenapa Perlu Governance?

Begitu reusable process dibuat, ia akan dipakai banyak parent.

Tanpa governance, akan muncul:

1. duplicate child process,
2. breaking change tanpa notice,
3. variable contract berubah diam-diam,
4. parent lama rusak,
5. ownership kabur,
6. incident tidak jelas siapa yang handle,
7. audit sulit karena process version tidak terkontrol.

Process library harus diperlakukan seperti API library.

---

### 11.2 Metadata untuk Reusable Process

Setiap reusable process harus punya metadata minimal:

```yaml
processId: collect-payment-process
name: Collect Payment
ownerTeam: Revenue Platform
businessOwner: Finance Operations
technicalOwner: Workflow Engineering
status: ACTIVE
versionPolicy: SEMVER_WITH_VERSION_TAG
compatibleParents:
  - application-review-process
  - renewal-review-process
inputs:
  - applicationId
  - applicantId
  - amount
  - currency
  - dueAt
outputs:
  - paymentStatus
  - receiptNo
  - paidAt
businessErrors:
  - PAYMENT_EXPIRED
  - PAYMENT_CANCELLED
  - PAYMENT_WAIVED
sla:
  responseTime: until dueAt
observability:
  dashboard: payment-workflow-dashboard
runbook: runbooks/collect-payment.md
security:
  sensitiveVariables:
    - applicantId
  allowedStartBy:
    - workflow-engine
```

---

### 11.3 Review Checklist untuk Reusable Process

Sebelum process dijadikan reusable, cek:

```text
[ ] Apakah business purpose jelas?
[ ] Apakah owner jelas?
[ ] Apakah input/output explicit?
[ ] Apakah variable minimal?
[ ] Apakah error contract jelas?
[ ] Apakah cancellation behavior jelas?
[ ] Apakah compensation behavior jelas?
[ ] Apakah version binding strategy jelas?
[ ] Apakah parent compatibility diuji?
[ ] Apakah audit trail cukup?
[ ] Apakah security boundary jelas?
[ ] Apakah runbook tersedia?
[ ] Apakah dashboard/metrics tersedia?
[ ] Apakah ada test scenario untuk happy path, error path, timeout, cancellation?
```

---

## 12. Error Propagation dalam Composition

### 12.1 Child Outcome Harus Dibedakan

Child process bisa selesai dengan beberapa cara:

```text
1. Completed successfully
2. Completed with business negative outcome
3. Thrown BPMN error
4. Stuck as incident
5. Cancelled by parent
6. Cancelled by external event
7. Timed out
```

Jangan jadikan semuanya technical exception.

Contoh buruk:

```text
Child collect payment fails.
Parent incident.
```

Padahal payment expired adalah business outcome normal.

Lebih baik:

```text
Child collect payment:
  - PAID -> complete normally
  - EXPIRED -> BPMN error PAYMENT_EXPIRED or output status EXPIRED
  - GATEWAY_DOWN -> technical incident/retry
```

---

### 12.2 BPMN Error vs Output Status

Kapan child harus mengembalikan output status, kapan melempar BPMN error?

Gunakan prinsip:

| Situasi | Output Status | BPMN Error |
|---|---|---|
| Outcome adalah bagian normal dari business scenario | cocok | bisa tapi tidak selalu perlu |
| Outcome mengubah path parent secara exceptional | bisa | cocok |
| Parent harus menangkap dan route khusus | kurang eksplisit | cocok |
| Ada banyak outcome yang harus dievaluasi DMN/gateway | cocok | kurang cocok |
| Failure teknis | tidak | tidak, gunakan fail/retry/incident |

Contoh output status:

```text
Call: External Consultation
Output: consultationStatus = RESPONDED | NO_RESPONSE | NOT_REQUIRED
Parent gateway decides next path.
```

Contoh BPMN error:

```text
Call: Collect Payment
Throws: PAYMENT_EXPIRED
Parent catches boundary error and cancels application.
```

Keduanya valid. Yang penting konsisten dan documented.

---

### 12.3 Error Code Governance

Business error code harus stabil.

Bad:

```text
ERR_001
ERR_PAYMENT
PAYMENT_FAIL
PAYMENT_EXPIRED_V2
```

Better:

```text
PAYMENT_EXPIRED
PAYMENT_CANCELLED_BY_APPLICANT
DOCUMENT_SUBMISSION_EXPIRED
CONSULTATION_NO_RESPONSE
APPROVAL_REJECTED
```

Error code adalah contract lintas process. Treat it like API enum.

---

## 13. Cancellation dan Compensation Across Call Activity

### 13.1 Cancellation Bukan Rollback

Jika parent membatalkan child, external side effect child mungkin sudah terjadi.

Contoh:

```text
Generate decision letter child process:
  -> PDF already generated
  -> Document stored
  -> Notification not yet sent

Parent process cancelled.
```

Apakah PDF dihapus?

Mungkin tidak. Dalam regulated system, lebih baik statusnya menjadi superseded/cancelled daripada dihapus.

```text
Document status:
  GENERATED
  CANCELLED_BEFORE_ISSUANCE
  ISSUED
  SUPERSEDED
```

---

### 13.2 Compensation Contract

Reusable process dengan side effect harus mendefinisikan compensation behavior.

Contoh:

```yaml
Process: generate-decision-letter
Side effects:
  - creates document record
  - stores PDF object
  - reserves document number

Compensation:
  - mark document as CANCELLED_BEFORE_ISSUANCE
  - release number if policy allows
  - keep audit record

Non-compensatable:
  - if document already issued to applicant, must generate revocation/supersession notice
```

Jangan berkata “rollback document”. Dalam business process, rollback sering tidak legal atau tidak audit-safe.

---

### 13.3 Parent-Child Compensation Design

Pattern:

```text
Parent Process
  -> Call Generate Decision Letter
  -> Call Send Decision Notification
  -> Error occurs after notification
  -> Compensation:
       - do not delete notification
       - create correction notice
       - mark case requires manual review
```

Business correction lebih penting daripada technical rollback.

---

## 14. Message-based Composition vs Call Activity

### 14.1 Call Activity Creates Tighter Coupling

Call activity berarti parent tahu child process ID dan menunggu child selesai.

```text
Parent -> Call Child -> Wait -> Continue
```

Ini bagus untuk synchronous business dependency.

Namun kadang coupling ini terlalu kuat.

Contoh:

```text
Application Review must notify Analytics Process.
```

Parent tidak perlu menunggu analytics.

Gunakan event/message:

```text
Application Review publishes CaseSubmitted event.
Analytics process starts via message/event.
```

---

### 14.2 Decision Matrix

| Kriteria | Call Activity | Message-based Composition |
|---|---|---|
| Parent harus menunggu child selesai | ya | tidak selalu |
| Child adalah bagian mandatory parent outcome | ya | kadang |
| Parent butuh output langsung | ya | tidak ideal |
| Loose coupling | kurang | lebih |
| Audit parent-child chain | jelas | perlu correlation design |
| Failure propagation | langsung | harus didesain via message/status |
| Best for | reusable subprocess | event-driven side process |

Contoh call activity:

```text
Application cannot proceed until payment is completed.
```

Contoh message-based:

```text
After decision issued, notify analytics/reporting/archive asynchronously.
```

---

## 15. Avoiding Distributed Monolith Process Composition

Workflow composition bisa berubah menjadi distributed monolith jika:

1. parent memanggil terlalu banyak child process,
2. child process saling memanggil tanpa batas,
3. variable besar dipass antar process,
4. semua process harus deploy bersama,
5. version binding kacau,
6. failure propagation tidak jelas,
7. incident child membuat seluruh landscape macet,
8. ownership lintas tim tidak jelas.

Contoh distributed monolith:

```text
application-review
  -> call validation
      -> call document-check
          -> call identity-check
              -> call notification
  -> call risk
      -> call scoring
          -> call external-consultation
  -> call approval
      -> call assignment
      -> call notification
  -> call decision
      -> call document-generation
      -> call archive
      -> call notification
```

Semua “reusable”, tetapi sistem jadi sulit dipahami.

Better:

```text
Application Review Process
  - owns main lifecycle
  - calls only major business capabilities
  - uses Java services/DMN for small computations
  - uses messages for side processes
  - keeps contracts narrow
```

---

## 16. Composition Depth Rule

Gunakan aturan praktis:

```text
Depth 0: Parent process
Depth 1: Business capability child process
Depth 2: Rare, only if child itself owns complex lifecycle
Depth 3+: design smell unless strongly justified
```

Jika process composition sampai 4 level, tanya:

1. Apakah kita membuat workflow microservice spaghetti?
2. Apakah ada domain boundary yang salah?
3. Apakah computation kecil dijadikan process?
4. Apakah reusable process terlalu generic?
5. Apakah parent-child relationship seharusnya event-based?

---

## 17. Java Architecture untuk Composition

### 17.1 Package Structure

Contoh struktur worker app:

```text
com.example.workflow
  applicationreview
    worker
      StartReviewWorker.java
      CompleteAssessmentWorker.java
    variables
      ApplicationReviewVariables.java
    process
      ApplicationReviewProcessClient.java

  payment
    worker
      CreatePaymentOrderWorker.java
      CheckPaymentStatusWorker.java
    variables
      CollectPaymentInput.java
      CollectPaymentOutput.java
    process
      CollectPaymentContract.java

  shared
    camunda
      CamundaClientConfig.java
      JobFailureMapper.java
      VariableMapper.java
    reliability
      IdempotencyService.java
      OutboxService.java
```

Jangan semua worker ditaruh di:

```text
com.example.camunda.workers
```

Karena composition boundary domain akan hilang.

---

### 17.2 Contract Class per Called Process

Buat contract eksplisit:

```java
public final class CollectPaymentProcessContract {
    public static final String PROCESS_ID = "collect-payment-process";

    public static final String VAR_INPUT = "collectPaymentInput";
    public static final String VAR_OUTPUT = "collectPaymentOutput";

    public static final String ERROR_PAYMENT_EXPIRED = "PAYMENT_EXPIRED";
    public static final String ERROR_PAYMENT_CANCELLED = "PAYMENT_CANCELLED";

    private CollectPaymentProcessContract() {}
}
```

Untuk Java modern:

```java
public final class CollectPaymentProcessContract {
    public static final String PROCESS_ID = "collect-payment-process";
    public static final String VERSION_TAG = "2026-Q2";

    public static final String ERROR_PAYMENT_EXPIRED = "PAYMENT_EXPIRED";
    public static final String ERROR_PAYMENT_CANCELLED = "PAYMENT_CANCELLED";

    public record Input(
        String applicationId,
        String applicantId,
        BigDecimal amount,
        String currency,
        Instant dueAt
    ) {}

    public record Output(
        String status,
        String receiptNo,
        Instant paidAt
    ) {}

    private CollectPaymentProcessContract() {}
}
```

Tujuannya agar contract tidak tersebar sebagai string literal di worker.

---

### 17.3 Mapping Parent Variables to Child Input

```java
public final class CollectPaymentInputMapper {

    public CollectPaymentProcessContract.Input fromApplicationReview(
            ApplicationReviewVariables vars,
            PaymentPolicy policy) {

        return new CollectPaymentProcessContract.Input(
                vars.applicationId(),
                vars.applicantId(),
                policy.amountFor(vars.applicationType()),
                "SGD",
                vars.paymentDueAt()
        );
    }
}
```

Jangan lakukan mapping ad hoc di BPMN expression terlalu kompleks.

Bad:

```text
= {
  applicationId: app.id,
  applicantId: app.parties[0].id,
  amount: if app.type = "X" then 100 else if app.type = "Y" then 200 else 300,
  dueAt: date and time(today()) + duration("P14D")
}
```

Expression boleh dipakai, tetapi policy kompleks lebih baik di DMN atau Java service.

---

## 18. Testing Process Composition

### 18.1 Apa yang Harus Diuji?

Composition testing harus menjawab:

1. parent mengirim input yang benar ke child,
2. child menghasilkan output yang sesuai contract,
3. parent membaca output dengan benar,
4. BPMN error child ditangkap parent,
5. technical incident child tidak disalahartikan sebagai business outcome,
6. cancellation behavior benar,
7. version binding sesuai,
8. child process tetap backward-compatible untuk parent lama,
9. security/authorization boundary benar,
10. audit trail parent-child lengkap.

---

### 18.2 Contract Test untuk Called Process

Test minimal:

```text
Given valid CollectPaymentInput
When collect-payment-process completes with PAID
Then CollectPaymentOutput contains paymentStatus=PAID and receiptNo
```

```text
Given payment due date passed
When collect-payment-process runs
Then it throws/returns PAYMENT_EXPIRED according to contract
```

```text
Given payment gateway unavailable
When create-payment-order worker fails
Then job retry/incident occurs, not PAYMENT_EXPIRED
```

---

### 18.3 Parent Integration Test

```text
Given application-review-process at payment step
When collect-payment child returns PAID
Then parent continues to assessment
```

```text
Given application-review-process at payment step
When collect-payment child returns/throws PAYMENT_EXPIRED
Then parent marks application as expired and notifies applicant
```

---

### 18.4 Compatibility Test Matrix

Untuk reusable process, buat matrix:

| Parent version | Child version | Expected |
|---|---|---|
| application-review v5 | collect-payment v2 | pass |
| application-review v5 | collect-payment v3 | pass if backward-compatible |
| application-review v6 | collect-payment v3 | pass |
| renewal-review v2 | collect-payment v3 | pass |

Jika tidak ada compatibility matrix, deployment child process baru bisa merusak parent process lama.

---

## 19. Observability untuk Parent-Child Process

### 19.1 Correlation Fields

Minimal log fields:

```text
processInstanceKey
processDefinitionId
parentProcessInstanceKey
childProcessInstanceKey
businessKey
caseId
applicationId
calledProcessId
callActivityId
jobType
jobKey
correlationId
actorId
```

Tanpa correlation field, incident child process sulit ditelusuri ke parent case.

---

### 19.2 Dashboard

Dashboard composition harus menunjukkan:

1. parent process backlog,
2. child process backlog,
3. call activity wait duration,
4. child incident count,
5. child completion rate,
6. business outcome distribution,
7. version distribution,
8. SLA breach by child process,
9. top failing called process,
10. parent processes blocked by child incidents.

Pertanyaan operasional penting:

```text
Which parent process instances are currently waiting for collect-payment?
Which child process version is causing most incidents?
Which called process causes longest delay?
How many applications are blocked by external consultation?
```

---

## 20. Security Boundary dalam Composition

Reusable process sering mengakses data lintas domain.

Contoh:

```text
Application Review calls Generate Decision Letter.
Generate Decision Letter needs applicant data, officer decision, legal clause, template version.
```

Pertanyaan security:

1. Apakah child process boleh menerima full applicant profile?
2. Apakah cukup menerima applicantId dan mengambil data sendiri dengan permission service account?
3. Apakah child process menyimpan PII sebagai variable?
4. Apakah Tasklist menampilkan variable sensitif?
5. Apakah operator child process boleh melihat data parent?
6. Apakah child process logs mengandung sensitive data?

Prinsip:

> Process composition tidak boleh menjadi jalur bypass authorization/data minimization.

---

## 21. Regulatory Case Management Example

### 21.1 Landscape

Kita desain process landscape:

```text
application-review-process
  -> call request-missing-documents-process
  -> call conduct-external-consultation-process
  -> call supervisor-approval-process
  -> call generate-decision-letter-process
  -> call send-decision-notification-process
```

Tapi tidak semua step dijadikan call activity.

Internal service task:

```text
- calculate application fee
- validate postal code
- classify application type
- check duplicate application
```

DMN:

```text
- determine required documents
- determine approval level
- determine SLA days
- determine risk lane
```

Message-based side process:

```text
- analytics reporting
- search index update
- async archival event
```

Embedded subprocess:

```text
- Intake phase
- Assessment phase
- Decision phase
```

---

### 21.2 Parent Process Sketch

```text
Application Review Process

Start: Application Submitted
  -> Embedded Subprocess: Intake
       -> Validate submission
       -> Determine required documents via DMN
       -> If incomplete:
            Call Request Missing Documents
  -> Embedded Subprocess: Assessment
       -> Risk screening
       -> If external consultation required:
            Call Conduct External Consultation
       -> Officer assessment
  -> Embedded Subprocess: Decision
       -> Determine approval level via DMN
       -> Call Supervisor Approval
       -> Call Generate Decision Letter
       -> Call Send Decision Notification
  -> End: Application Completed
```

---

### 21.3 Request Missing Documents Child

```text
Request Missing Documents Process

Start
  -> Generate missing document request
  -> Notify applicant
  -> Wait for document upload
       Boundary timer: submission due date expired
          -> Return DOCUMENT_NOT_RECEIVED
  -> Validate documents
  -> If still incomplete:
       -> Notify applicant again or return INCOMPLETE
  -> Return DOCUMENTS_RECEIVED
```

Input:

```yaml
caseId
applicantId
missingDocumentTypes
dueAt
requestReason
```

Output:

```yaml
documentRequestStatus: RECEIVED | EXPIRED | CANCELLED | INCOMPLETE
receivedDocumentRefs
completedAt
```

---

### 21.4 External Consultation Child

```text
Conduct External Consultation Process

Start
  -> Send consultation request to agency
  -> Wait for response message
       Boundary timer: reminder due
          -> Send reminder
       Boundary timer: consultation due
          -> Escalate / mark no response
  -> Classify response
  -> Return consultation outcome
```

Input:

```yaml
caseId
agencyCode
consultationType
requestPayloadRef
dueAt
```

Output:

```yaml
consultationStatus: RESPONDED | NO_RESPONSE | WITHDRAWN
responseRef
responseClassification
respondedAt
```

---

### 21.5 Supervisor Approval Child

```text
Supervisor Approval Process

Start
  -> Create approval task
  -> Wait for supervisor decision
       Boundary timer: approval SLA breach
          -> Escalate to manager
  -> Return decision
```

Input:

```yaml
caseId
officerRecommendation
approvalLevel
dueAt
```

Output:

```yaml
approvalDecision: APPROVED | REJECTED | RETURNED_FOR_REWORK
approvalReason
decidedBy
decidedAt
```

---

### 21.6 Why This Composition Works

Karena setiap child process punya:

1. business purpose jelas,
2. input/output jelas,
3. lifecycle sendiri,
4. SLA sendiri,
5. audit sendiri,
6. error/outcome sendiri,
7. owner potensial sendiri,
8. reusable potential.

Parent tetap readable:

```text
Intake -> Assessment -> Decision -> Closure
```

Child process menyimpan detail behavior masing-masing tanpa membuat parent menjadi spaghetti.

---

## 22. Design Smells dalam Subprocess dan Call Activity

### 22.1 Smell: Subprocess Name Terlalu Umum

Bad:

```text
Handle Request
Process Data
Do Approval
Common Process
Generic Flow
```

Better:

```text
Request Missing Documents
Conduct External Consultation
Perform Supervisor Approval
Generate Decision Letter
Send Decision Notification
```

---

### 22.2 Smell: Child Process Membutuhkan Semua Variable Parent

Jika child butuh semua variable parent, boundary-nya salah.

Solusi:

1. persempit input,
2. child mengambil data sendiri dari domain API by ID,
3. pisahkan domain data dan process data,
4. gunakan documentRef/payloadRef untuk data besar,
5. gunakan contract DTO.

---

### 22.3 Smell: Reusable Process Penuh Gateway Dynamic

Jika process reusable punya banyak gateway berdasarkan `processType`, `entityType`, `scenarioCode`, `featureFlag`, dan `approvalMode`, kemungkinan ia terlalu generic.

---

### 22.4 Smell: Call Activity untuk Task yang Sebenarnya Atomic

Bad:

```text
Call Activity: Format Date
Call Activity: Calculate Fee
Call Activity: Fetch User Name
```

Ini Java service/DMN, bukan process.

---

### 22.5 Smell: Parent Tidak Tahu Child Bisa Menghasilkan Apa

Jika parent hanya punya:

```text
Call child
Continue
```

Tanpa explicit output/error handling, composition berbahaya.

---

### 22.6 Smell: No Version Strategy

Jika call activity selalu latest tanpa compatibility guarantee, production incident tinggal menunggu waktu.

---

### 22.7 Smell: Event Subprocess Mengubah Main State Diam-diam

Non-interrupting event subprocess yang mengubah status utama tanpa coordination adalah race condition.

---

### 22.8 Smell: Nested Call Activity Terlalu Dalam

Jika operator harus membuka 5 process instance untuk memahami satu case, composition sudah terlalu dalam.

---

## 23. Practical Modeling Rules

Gunakan aturan berikut saat desain:

### Rule 1 — One Subprocess, One Business Meaning

Subprocess harus bisa diberi nama business action yang jelas.

```text
Good: Conduct External Consultation
Bad: Handle Miscellaneous Steps
```

### Rule 2 — Do Not Hide Complexity Without Semantics

Collapsed subprocess tanpa boundary semantics adalah kosmetik.

### Rule 3 — Prefer Embedded for Phase, Call Activity for Capability

```text
Embedded subprocess = phase internal
Call activity = reusable capability
```

### Rule 4 — Child Process Contract Must Be Narrow

Pass IDs and required context, not full aggregate dump.

### Rule 5 — Error Contract Is Part of API

Business error code harus documented dan stable.

### Rule 6 — Version Binding Must Be Intentional

Implicit latest hanya aman jika ada backward compatibility guarantee.

### Rule 7 — Avoid Deep Nesting

Composition depth > 2 harus dipertanyakan.

### Rule 8 — Side Effect Requires Compensation Story

Kalau child membuat side effect, harus ada cancellation/compensation behavior.

### Rule 9 — Observability Must Cross Parent-Child Boundary

Log correlation wajib.

### Rule 10 — Reusability Must Be Earned

Jangan reusable terlalu cepat. Duplikasi kecil kadang lebih murah daripada generic process yang salah.

---

## 24. Advanced Topic: Ad-hoc Subprocess

Camunda 8 versi modern juga mulai mendukung ad-hoc subprocess. Ad-hoc subprocess berguna ketika urutan task tidak fully deterministic di awal dan dapat dipilih saat runtime oleh manusia, rule, service, atau bahkan AI agent. Namun ini advanced dan berbahaya jika dipakai untuk menggantikan process discipline.

Gunakan ad-hoc subprocess jika:

1. ada set aktivitas yang valid,
2. urutan dapat fleksibel,
3. completion condition jelas,
4. audit setiap aktivitas tetap wajib,
5. authorization jelas,
6. tidak merusak regulatory defensibility.

Jangan gunakan ad-hoc subprocess untuk:

1. menghindari modeling,
2. membuat process “bebas melakukan apa saja”,
3. menyembunyikan business rule,
4. membuat AI menentukan tindakan tanpa guardrail,
5. mengganti case management model tanpa governance.

Dalam regulatory system, ad-hoc behavior harus sangat hati-hati karena auditor perlu tahu:

```text
Why was this activity selected?
Who selected it?
Was it allowed under policy?
Was mandatory step skipped?
What evidence supported the selection?
```

---

## 25. Relation to Java 8–25

### 25.1 Java 8

Di Java 8, fokus:

1. explicit DTO class,
2. immutable object dengan final fields,
3. Optional hati-hati untuk DTO serialization,
4. ExecutorService untuk worker concurrency,
5. careful shutdown hook,
6. no records/sealed classes.

### 25.2 Java 11/17

Di Java 11/17:

1. better HTTP client if needed,
2. var untuk local clarity tapi jangan abuse,
3. stronger baseline runtime,
4. records tersedia sejak Java 16,
5. sealed classes sejak Java 17 dapat membantu modeling outcome.

Contoh outcome:

```java
public sealed interface PaymentOutcome
        permits PaymentOutcome.Paid, PaymentOutcome.Expired, PaymentOutcome.Cancelled {

    record Paid(String receiptNo, Instant paidAt) implements PaymentOutcome {}
    record Expired(Instant expiredAt) implements PaymentOutcome {}
    record Cancelled(String reason) implements PaymentOutcome {}
}
```

### 25.3 Java 21/25

Di Java 21+:

1. records cocok untuk variable contract,
2. sealed interfaces cocok untuk outcome/error modeling,
3. virtual threads bisa dipertimbangkan untuk I/O-heavy worker,
4. structured concurrency berguna untuk internal fan-out dalam worker, tetapi jangan mencampur dengan BPMN-level parallelism tanpa alasan,
5. pattern matching membuat classification lebih readable.

Contoh:

```java
switch (outcome) {
    case PaymentOutcome.Paid paid -> completeWithPaid(job, paid);
    case PaymentOutcome.Expired expired -> throwPaymentExpired(job, expired);
    case PaymentOutcome.Cancelled cancelled -> throwPaymentCancelled(job, cancelled);
}
```

Tetapi ingat:

> Java concurrency modern tidak menghapus kebutuhan idempotency dan process-level consistency.

---

## 26. Worked Example: Approval Reusable Process

### 26.1 Problem

Beberapa process butuh approval:

1. new application approval,
2. renewal approval,
3. appeal approval,
4. enforcement action approval.

Apakah kita buat satu reusable approval process?

---

### 26.2 Naive Generic Approval

```text
Generic Approval Process
Inputs:
  entityType
  entityId
  approvalType
  approvalRules
  formConfig
  allowedActions
  escalationConfig
  callbackConfig
```

Ini fleksibel, tapi terlalu generic.

Masalah:

1. policy tersembunyi di config,
2. diagram tidak menjelaskan business meaning,
3. testing sulit,
4. audit generik,
5. approval legal dan operational bercampur,
6. authorization bisa bocor.

---

### 26.3 Better Design

Pisahkan approval family:

```text
supervisor-approval-process
committee-approval-process
director-approval-process
legal-clearance-process
enforcement-approval-process
```

Atau:

```text
approval-common-process
```

hanya jika contract benar-benar stabil:

```yaml
Inputs:
  caseId
  approvalContextRef
  approvalLevel
  candidateGroup
  dueAt
  allowedDecisionCodes

Outputs:
  decisionCode
  decisionReason
  decidedBy
  decidedAt
```

Business rules tetap di DMN:

```text
DetermineApprovalLevel.dmn
DetermineCandidateGroup.dmn
DetermineEscalationPath.dmn
```

Process approval tidak menerima arbitrary rules JSON.

---

### 26.4 Parent Usage

```text
Application Review
  -> DMN Determine Approval Level
  -> Call Supervisor Approval
  -> Gateway decision
       APPROVED -> Generate letter
       RETURNED_FOR_REWORK -> Rework
       REJECTED -> Generate rejection letter
```

---

## 27. Worked Example: External Consultation Composition

### 27.1 Requirements

External consultation:

1. send request to agency,
2. wait for response,
3. remind after 7 working days,
4. escalate after 14 working days,
5. continue with no-response after 21 working days,
6. accept late response but mark as late,
7. support multiple agencies,
8. audit every outbound/inbound message.

---

### 27.2 Parent Design

Parent application review does not need all details.

```text
Application Review
  -> Determine agencies required
  -> Multi-instance Call Activity: Conduct External Consultation
  -> Aggregate consultation outcomes
  -> Continue assessment
```

---

### 27.3 Child Design

```text
Conduct External Consultation
  -> Send request
  -> Wait for response
       Non-interrupting timer: send reminder
       Interrupting timer: consultation deadline
  -> Classify response
  -> Complete

Event Subprocess: Late response received
  -> attach late response
  -> notify officer
```

---

### 27.4 Output Contract

```yaml
agencyCode: string
consultationStatus: RESPONDED | NO_RESPONSE | LATE_RESPONSE | CANCELLED
responseClassification: NO_OBJECTION | OBJECTION | CONDITIONAL | UNKNOWN
responseRef: string?
respondedAt: instant?
late: boolean
```

Parent aggregates output:

```text
If any OBJECTION -> route to senior officer
If all NO_OBJECTION -> continue normal approval
If NO_RESPONSE and policy allows -> continue with no-response note
```

This is good composition:

1. child owns consultation lifecycle,
2. parent owns application decision,
3. output contract is clear,
4. late response handled without corrupting parent flow.

---

## 28. Production Runbook for Call Activity Incident

When parent is stuck at call activity:

```text
1. Identify parent process instance.
2. Identify call activity element ID.
3. Identify child process instance key.
4. Check child state.
5. Check child incidents.
6. Determine if issue is:
   - technical worker failure
   - missing variable
   - wrong input contract
   - external dependency outage
   - BPMN model bug
   - authorization issue
   - version mismatch
7. Decide repair path:
   - retry job
   - correct variable
   - cancel child
   - complete manual task
   - migrate instance
   - start replacement child process
   - cancel parent with audit reason
8. Record repair action.
9. Verify parent resumed or reached expected state.
10. Add regression test if model/contract bug.
```

Never repair child process without understanding parent expectation.

---

## 29. Final Checklist: Subprocess and Composition Design Review

Gunakan checklist ini setiap kali mendesain subprocess/call activity.

### 29.1 Embedded Subprocess Checklist

```text
[ ] Apakah ini phase internal parent?
[ ] Apakah namanya punya business meaning jelas?
[ ] Apakah abstraction level konsisten?
[ ] Apakah ada boundary event yang memang relevan untuk seluruh phase?
[ ] Apakah variable lokal digunakan jika perlu?
[ ] Apakah subprocess tidak hanya menyembunyikan spaghetti?
[ ] Apakah flow masih readable saat expanded?
```

### 29.2 Event Subprocess Checklist

```text
[ ] Event apa yang memicu subprocess?
[ ] Apakah event bisa terjadi selama seluruh process atau hanya satu phase?
[ ] Interrupting atau non-interrupting?
[ ] Jika non-interrupting, bagaimana concurrency dikontrol?
[ ] Apakah event source diautentikasi/diotorisasi?
[ ] Apakah event duplicate/stale ditangani?
[ ] Apakah audit reason jelas?
```

### 29.3 Call Activity Checklist

```text
[ ] Apakah child process benar-benar reusable business capability?
[ ] Apakah input/output contract explicit?
[ ] Apakah sensitive data diminimalkan?
[ ] Apakah business error contract stabil?
[ ] Apakah technical failure tidak dicampur dengan business outcome?
[ ] Apakah cancellation behavior jelas?
[ ] Apakah compensation behavior jelas?
[ ] Apakah version binding strategy intentional?
[ ] Apakah compatibility test tersedia?
[ ] Apakah owner child process jelas?
[ ] Apakah runbook child process tersedia?
[ ] Apakah dashboard parent-child tersedia?
```

### 29.4 Composition Landscape Checklist

```text
[ ] Apakah parent process tetap readable?
[ ] Apakah composition depth tidak berlebihan?
[ ] Apakah tidak ada circular call dependency?
[ ] Apakah child process tidak terlalu generic?
[ ] Apakah small computations tidak dijadikan process?
[ ] Apakah parent-child correlation field tersedia?
[ ] Apakah incident child bisa ditelusuri ke case/business key?
[ ] Apakah audit parent-child lengkap?
[ ] Apakah deployment/versioning aman untuk running instances?
```

---

## 30. Key Takeaways

1. Subprocess bukan alat kosmetik untuk menyembunyikan diagram besar. Ia adalah boundary semantic.
2. Embedded subprocess cocok untuk phase internal dan scoped behavior.
3. Event subprocess cocok untuk behavior reactive yang bisa terjadi selama process/phase aktif.
4. Call activity cocok untuk reusable business capability dengan contract yang jelas.
5. Reusable process harus diperlakukan seperti API: input, output, error, SLA, version, owner, runbook.
6. Jangan pass semua variable parent ke child process.
7. Jangan membuat generic process yang menjadi mini-engine di atas engine.
8. Version binding adalah keputusan production safety, bukan detail deployment kecil.
9. Parent-child failure propagation harus eksplisit.
10. Side effect child process membutuhkan cancellation/compensation story.
11. Message-based composition lebih cocok untuk loose coupling dan side processes.
12. Java code harus mencerminkan process contract melalui DTO, constants, mappers, tests, dan idempotency logic.
13. Workflow composition yang baik membuat sistem lebih mudah dibaca, diuji, diaudit, dan dioperasikan.
14. Workflow composition yang buruk menciptakan distributed monolith yang lebih sulit daripada monolith biasa.

---

## 31. Latihan Praktis

Ambil satu process besar, misalnya:

```text
Application Review Process
```

Pisahkan menjadi:

1. embedded subprocess,
2. call activity,
3. Java service,
4. DMN decision,
5. message-based side process.

Untuk setiap kandidat pemecahan, tulis:

```yaml
name:
type: embedded | call-activity | java-service | dmn | message-based
reason:
inputs:
outputs:
errors:
owner:
versioning:
compensation:
observability:
```

Lalu cek apakah desain Anda mengurangi complexity atau hanya memindahkannya.

---

## 32. Penutup

Part ini membahas salah satu kemampuan yang membedakan engineer biasa dan engineer yang matang dalam workflow architecture: kemampuan membuat boundary yang tepat.

BPMN memberi banyak alat: subprocess, call activity, event subprocess, boundary event, message, timer, compensation. Tetapi alat-alat ini tidak otomatis menghasilkan arsitektur yang baik.

Arsitektur yang baik lahir dari keputusan eksplisit tentang:

1. lifecycle,
2. ownership,
3. data contract,
4. failure model,
5. versioning,
6. audit,
7. observability,
8. security,
9. operability.

Jika Anda bisa menjelaskan setiap call activity sebagai business capability dengan contract yang jelas, Anda sedang bergerak ke level workflow engineering yang jauh lebih matang.

---

## 33. Status Seri

Selesai:

- Part 0 — Orientation: Dari CRUD Engineer ke Process Orchestration Engineer
- Part 1 — BPMN 2.0 Deep Semantics: Bukan Diagram, Tapi Execution Contract
- Part 2 — BPMN Core Elements: Events, Tasks, Gateways, Subprocesses
- Part 3 — BPMN Modeling Discipline: Membuat Process Model yang Bisa Hidup di Production
- Part 4 — Camunda Landscape: Camunda 7 vs Camunda 8
- Part 5 — Camunda 8 Runtime Internals: Zeebe Mental Model
- Part 6 — Java Client Engineering: From API Call to Production-grade Worker
- Part 7 — Job Worker Reliability: Idempotency, Retry, Backoff, Poison Jobs
- Part 8 — Process Variables: Data Contract, Scope, Serialization, and Governance
- Part 9 — BPMN Error, Technical Failure, Incident, Escalation, and Compensation
- Part 10 — Human Workflow: User Task, Assignment, Forms, SLA, and Authorization
- Part 11 — DMN and Decision Engineering: Separating Flow from Decision Logic
- Part 12 — Message Correlation and Event-driven Process Design
- Part 13 — Timers, SLA, Timeout, Expiry, and Scheduled Process Behavior
- Part 14 — Multi-instance, Parallelism, Fan-out/Fan-in, and Concurrency Control
- Part 15 — Subprocess, Call Activity, Reusable Process, and Process Composition

Belum selesai.

Berikutnya:

- Part 16 — Saga and Long-running Transaction Engineering with BPMN

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-bpmn-camunda-process-orchestration-engineering](./learn-java-bpmn-camunda-part-14-multi-instance-parallelism-fan-out-fan-in-concurrency-control.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Learn Java BPMN, Camunda, and Process Orchestration Engineering](./learn-java-bpmn-camunda-part-16-saga-long-running-transaction-engineering-with-bpmn.md)
