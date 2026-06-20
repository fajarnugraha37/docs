# learn-aws-cloud-architecture-mastery-for-java-engineers-part-015.md

# Part 015 — Workflow and Orchestration: Step Functions for Long-Running Business Processes

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami AWS pada level arsitektur produksi  
> Fokus bagian ini: memakai AWS Step Functions sebagai workflow engine untuk proses bisnis panjang, distributed orchestration, human approval, retry/compensation, auditability, dan failure modelling.

---

## 0. Posisi Part Ini dalam Seri

Di Part 014 kita membahas event integration: SQS, SNS, EventBridge, Kinesis, dan Step Functions sebagai salah satu pilihan integrasi. Part ini memperbesar satu topik: **workflow orchestration**.

Kenapa ini pantas menjadi bagian sendiri?

Karena banyak sistem produksi gagal bukan karena tidak punya queue, topic, atau event bus, tetapi karena **proses bisnisnya tidak punya bentuk eksplisit**.

Contoh proses bisnis:

- case diterima;
- dokumen divalidasi;
- risk score dihitung;
- officer diminta review;
- jika butuh informasi tambahan, applicant diminta melengkapi;
- jika lolos threshold, case auto-approved;
- jika tidak, masuk escalation;
- setelah keputusan final, sistem mengirim notifikasi, menyimpan audit evidence, dan menutup case.

Jika proses seperti ini hanya tersebar di controller, cron job, queue consumer, database status flag, dan beberapa callback service, cepat atau lambat sistem akan sulit dijelaskan:

- status sebenarnya ada di mana?
- step mana yang sedang berjalan?
- step mana yang gagal?
- apakah retry aman?
- apakah user action yang sama boleh dikirim dua kali?
- siapa yang menyetujui transisi?
- apa bukti bahwa proses mengikuti policy?
- bagaimana melanjutkan proses setelah partial outage?

Step Functions membantu karena ia memaksa kita menyatakan proses sebagai **state machine**.

Namun, Step Functions bukan peluru ajaib. Ia bagus untuk workflow yang butuh orchestration eksplisit, tetapi buruk jika dipakai untuk semua flow internal kecil, semua branching trivial, atau business logic yang seharusnya tetap berada di domain service.

Target Part 015: Anda mampu membedakan **workflow state** dari **domain state**, memilih Standard vs Express workflow, mendesain retry/catch/compensation, melakukan human approval, membuat workflow observable, dan membangun model defensible untuk regulated business process.

---

## 1. Mental Model: Workflow bukan Sekadar “Urutan Lambda”

Cara pemula melihat Step Functions:

> “Step Functions itu buat menjalankan beberapa Lambda berurutan.”

Cara engineer produksi melihat Step Functions:

> “Step Functions adalah durable orchestration layer yang menyimpan execution state, menentukan transisi, mengatur retry/catch, menghubungkan service, dan memberi riwayat eksekusi untuk proses yang melibatkan beberapa side effect.”

Perbedaan ini besar.

Jika Anda menganggap Step Functions hanya sebagai glue antar Lambda, Anda cenderung membuat workflow seperti ini:

```text
Lambda A -> Lambda B -> Lambda C -> Lambda D
```

Padahal yang lebih penting adalah kontrak proses:

```text
CaseSubmitted
  -> ValidateInput
  -> ClassifyRisk
  -> DecideRoute
      -> LowRiskAutoApprove
      -> MediumRiskOfficerReview
      -> HighRiskEscalation
  -> RecordDecision
  -> NotifyParties
  -> CloseOrAwaitMoreInfo
```

Step Functions bagus ketika proses memiliki karakteristik:

1. **Long-running**: proses bisa berjalan menit, jam, hari, atau lebih lama.
2. **Multi-step**: ada banyak langkah dengan dependency dan branching.
3. **Durable state**: state execution harus bertahan meskipun compute transient mati.
4. **Retry-aware**: beberapa step boleh retry, beberapa tidak.
5. **Human-in-the-loop**: proses perlu approval/manual review.
6. **External integration**: ada third-party, legacy system, atau async callback.
7. **Auditability**: perlu riwayat jelas tentang langkah yang terjadi.
8. **Compensation**: jika step tertentu gagal, perlu undo/logical compensation.
9. **Operational visibility**: tim operasi perlu melihat stuck execution.

Step Functions kurang cocok jika:

1. flow terlalu kecil dan sinkron;
2. latency path sangat ketat;
3. setiap transisi adalah micro-step internal yang lebih baik menjadi code function;
4. payload besar dipindahkan antar state;
5. domain model seharusnya dikuasai application service, bukan workflow definition;
6. Anda hanya ingin “menghindari menulis kode”.

Rule of thumb:

> Gunakan Step Functions untuk **process orchestration**, bukan untuk menggantikan semua business logic.

---

## 2. Orchestration vs Choreography

Dalam distributed system, ada dua pola besar koordinasi: orchestration dan choreography.

### 2.1 Orchestration

Ada satu komponen yang mengatur urutan:

```text
Workflow Orchestrator
  -> call Service A
  -> wait result
  -> call Service B
  -> branch
  -> call Service C
```

Kelebihan:

- flow eksplisit;
- mudah dilihat dan diaudit;
- retry/catch bisa terpusat;
- cocok untuk long-running business process;
- lebih mudah menjawab “sekarang proses ada di step mana?”;
- cocok untuk regulated workflow.

Kekurangan:

- orchestrator bisa menjadi coupling point;
- workflow definition bisa membesar;
- jika terlalu banyak domain logic masuk workflow, sistem menjadi kaku;
- versioning workflow perlu disiplin.

### 2.2 Choreography

Setiap service bereaksi terhadap event:

```text
Case Service emits CaseSubmitted
Validation Service reacts -> emits CaseValidated
Risk Service reacts -> emits RiskClassified
Decision Service reacts -> emits DecisionMade
Notification Service reacts -> emits NotificationSent
```

Kelebihan:

- service autonomy lebih tinggi;
- cocok untuk domain event propagation;
- publisher tidak perlu tahu subscriber;
- bagus untuk projection, integration, analytics, dan side effects yang longgar.

Kekurangan:

- end-to-end process sulit dilihat;
- debugging butuh correlation id dan tracing matang;
- failure recovery tersebar;
- business process bisa tersembunyi di banyak consumer;
- sulit menjelaskan audit trail jika tidak didesain sejak awal.

### 2.3 Kapan memilih Step Functions?

Gunakan orchestration saat:

- proses memiliki owner jelas;
- sequence penting;
- ada decision gate;
- ada human approval;
- perlu retry berbeda per step;
- perlu timeout/heartbeat;
- perlu audit trail end-to-end;
- perlu kompensasi eksplisit.

Gunakan choreography saat:

- event adalah fakta domain yang ingin disebar;
- consumer independen;
- urutan tidak sepenuhnya dikendalikan pusat;
- publisher tidak perlu tahu efek downstream;
- Anda ingin extensibility untuk subscriber baru.

Pada sistem besar, sering digunakan hybrid:

```text
Step Functions orchestrates core process
  -> emits domain events at milestones
  -> downstream services react asynchronously
```

Contoh:

```text
Case workflow:
  Validate -> RiskScore -> Review -> Decision

Milestone events:
  CaseValidated
  CaseReviewRequired
  CaseApproved
  CaseRejected
  CaseClosed
```

Workflow mengatur **process correctness**. Event mengatur **system integration**.

---

## 3. AWS Step Functions Core Concepts

Step Functions memiliki beberapa konsep utama.

### 3.1 State Machine

State machine adalah definisi workflow.

Ia menjelaskan:

- state awal;
- state-state berikutnya;
- transisi;
- input/output antar state;
- retry/catch;
- timeout;
- branching;
- terminal state.

State machine adalah **process definition**.

### 3.2 Execution

Execution adalah satu instansiasi state machine.

Jika state machine adalah class, execution adalah object instance.

Contoh:

```text
State machine: CaseReviewWorkflow
Execution 1: case-1001
Execution 2: case-1002
Execution 3: case-1003
```

Execution memiliki:

- input awal;
- current state;
- execution history;
- status;
- start time;
- end time;
- output/error.

### 3.3 State

State adalah node dalam workflow.

State bisa berupa:

- Task;
- Choice;
- Wait;
- Parallel;
- Map;
- Pass;
- Succeed;
- Fail.

Setiap state sebaiknya mewakili **meaningful process step**, bukan setiap baris kode.

Buruk:

```text
TrimName -> ParseDate -> ValidateEmail -> CheckLength -> SaveField
```

Lebih baik:

```text
ValidateSubmission
```

Detail field validation tetap berada di service code.

### 3.4 Amazon States Language

Step Functions workflow ditulis dengan Amazon States Language, yaitu JSON-based state machine definition.

Contoh minimal:

```json
{
  "Comment": "Minimal case workflow",
  "StartAt": "ValidateCase",
  "States": {
    "ValidateCase": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:ap-southeast-1:123456789012:function:validate-case",
      "Next": "DecideRoute"
    },
    "DecideRoute": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.riskLevel",
          "StringEquals": "LOW",
          "Next": "AutoApprove"
        },
        {
          "Variable": "$.riskLevel",
          "StringEquals": "HIGH",
          "Next": "Escalate"
        }
      ],
      "Default": "ManualReview"
    },
    "AutoApprove": {
      "Type": "Succeed"
    },
    "ManualReview": {
      "Type": "Succeed"
    },
    "Escalate": {
      "Type": "Succeed"
    }
  }
}
```

Di dunia nyata, state machine sebaiknya tidak hanya benar secara sintaks, tetapi juga benar secara domain, operasional, keamanan, biaya, dan audit.

---

## 4. Standard vs Express Workflows

Step Functions memiliki dua tipe besar workflow: **Standard** dan **Express**.

### 4.1 Standard Workflow

Standard cocok untuk:

- long-running process;
- human approval;
- retry/catch yang perlu audit jelas;
- business workflow;
- order processing;
- case management;
- saga orchestration;
- proses yang memerlukan execution history durable.

Karakter penting:

- execution bisa berjalan lama;
- cocok untuk exactly-once workflow execution semantics pada level orchestration;
- memiliki execution history yang bisa diperiksa;
- mendukung callback pattern;
- mendukung `.sync` integration pattern;
- mendukung activities;
- cocok untuk audit dan troubleshooting.

Untuk regulated process, Standard biasanya default yang lebih aman.

### 4.2 Express Workflow

Express cocok untuk:

- high-volume short-duration workflow;
- event processing cepat;
- request orchestration singkat;
- data transformation pipeline ringan;
- synchronous microservice orchestration yang pendek.

Express memiliki model biaya dan karakteristik berbeda.

Perhatikan batas penting: Express tidak mendukung beberapa capability yang biasa dibutuhkan workflow panjang seperti callback `.waitForTaskToken`, job-run `.sync`, activities, dan Distributed Map tidak didukung di Express sesuai dokumentasi pemilihan workflow type AWS.

### 4.3 Synchronous vs Asynchronous Express

Express bisa dijalankan:

- asynchronous;
- synchronous.

Synchronous Express cocok untuk API-style orchestration singkat, misalnya API Gateway memanggil workflow dan menunggu output.

Namun, jangan salah pakai Synchronous Express untuk proses yang sebenarnya long-running.

Jika proses bisa menunggu user, sistem eksternal, manual approval, atau SLA jam/hari, gunakan Standard.

### 4.4 Decision Matrix

| Kebutuhan | Pilihan Umum |
|---|---|
| Human approval | Standard |
| Proses berjalan hari/bulan | Standard |
| Butuh callback token | Standard |
| Audit execution detail | Standard |
| High-volume short workflow | Express |
| API orchestration cepat | Synchronous Express |
| Event enrichment ringan | Express |
| Saga business process | Standard |
| Distributed map skala besar | Standard |
| Workflow harus murah untuk volume sangat tinggi | Evaluasi Express |

Rule of thumb:

> Jika workflow mewakili proses bisnis penting, pilih Standard kecuali ada alasan kuat memilih Express.

---

## 5. State Types dalam Step Functions

### 5.1 Task State

Task state menjalankan unit kerja.

Task bisa:

- memanggil Lambda;
- memanggil AWS service integration;
- menjalankan activity worker;
- memanggil HTTP endpoint;
- menunggu callback token;
- memulai nested workflow.

Task harus mewakili **unit kerja yang meaningful**.

Contoh Task:

```text
ValidateCaseInput
CalculateRiskScore
CreateReviewAssignment
WaitForOfficerDecision
RecordFinalDecision
SendDecisionNotification
```

Jangan terlalu granular:

```text
ReadCase
ReadApplicant
ReadDocument
ReadPolicy
ReadOfficer
```

Kecuali masing-masing adalah remote side effect dengan failure/retry berbeda.

### 5.2 Choice State

Choice state menentukan branch berdasarkan input.

Contoh:

```text
if riskScore < 30 -> AutoApprove
if riskScore < 70 -> ManualReview
else -> EscalatedReview
```

Choice bagus untuk routing yang jelas dan explainable.

Namun jangan memindahkan semua business rule ke ASL jika rule-nya kompleks, sering berubah, atau butuh domain abstraction. Untuk rule kompleks, lebih baik panggil policy/rule service lalu workflow hanya membaca hasil:

```json
{
  "route": "MANUAL_REVIEW",
  "reasonCodes": ["MISSING_DOCUMENT", "HIGH_RISK_SECTOR"],
  "policyVersion": "2026-06-01"
}
```

Workflow melakukan branch berdasarkan `route`, bukan menghitung seluruh policy logic.

### 5.3 Wait State

Wait state menunda eksekusi.

Cocok untuk:

- menunggu cooling period;
- menunggu SLA window;
- retry bisnis non-teknis;
- follow-up setelah X hari;
- deadline reminder.

Namun jangan gunakan Wait untuk polling agresif. Jika proses menunggu event eksternal, lebih baik pakai callback token, EventBridge, atau event-driven continuation.

### 5.4 Parallel State

Parallel menjalankan beberapa branch secara concurrent dan menunggu semua selesai.

Contoh:

```text
RunBackgroundChecks:
  - CheckIdentity
  - CheckSanctions
  - CheckCreditExposure
  - CheckPriorEnforcement
```

Parallel cocok jika branch independen dan semua hasil dibutuhkan.

Risiko:

- partial failure;
- semua branch menghasilkan output besar;
- downstream service overload;
- retry beberapa branch memperbesar side effect.

Parallel tidak otomatis berarti aman. Anda tetap perlu idempotency dan compensation.

### 5.5 Map State

Map menjalankan step yang sama untuk banyak item.

Contoh:

```text
For each uploaded document:
  ExtractMetadata
  RunMalwareScan
  ClassifyDocument
  StoreResult
```

Map ada dua pola besar:

- Inline Map untuk koleksi kecil/menengah;
- Distributed Map untuk skala besar.

Gunakan Map hanya jika item processing memang independen. Jika ada ordering, aggregation kompleks, atau locking antar item, desain perlu lebih hati-hati.

### 5.6 Pass State

Pass meneruskan input atau membuat transformasi sederhana.

Gunakan untuk:

- placeholder;
- shaping input;
- memberi default;
- testing workflow.

Jangan membuat Pass state berlebihan hanya agar diagram terlihat detail.

### 5.7 Succeed dan Fail State

Succeed mengakhiri workflow sukses.

Fail mengakhiri workflow gagal.

Pada proses bisnis, “rejected” belum tentu failure teknis. Misalnya:

```text
CaseRejectedByPolicy -> Succeed
```

Sedangkan failure teknis:

```text
CannotRecordDecision -> Fail
```

Ini penting untuk observability.

Jangan mencampur domain negative outcome dengan technical failure.

---

## 6. Input, Output, Payload, dan Data Shaping

Step Functions membawa data antar state sebagai JSON.

Ini berguna, tapi juga sering menjadi sumber desain buruk.

### 6.1 Jangan Anggap Workflow sebagai Database

Buruk:

```json
{
  "case": {
    "id": "CASE-123",
    "applicant": { "...": "..." },
    "documents": [ huge document metadata ],
    "allExtractedText": "...megabytes..."
  }
}
```

Lebih baik:

```json
{
  "caseId": "CASE-123",
  "tenantId": "TENANT-7",
  "correlationId": "corr-abc",
  "workflowVersion": "v3",
  "evidenceBucket": "case-evidence-prod",
  "documentManifestKey": "tenants/TENANT-7/cases/CASE-123/manifest.json"
}
```

Workflow input sebaiknya membawa:

- identifier;
- routing result;
- small state summary;
- references ke object besar di S3/DynamoDB/RDS;
- metadata audit.

Payload besar sebaiknya disimpan di storage yang sesuai, bukan dibawa antar state.

### 6.2 InputPath, Parameters, ResultPath, OutputPath

Step Functions mendukung data shaping.

Gunanya:

- hanya mengirim field yang dibutuhkan ke task;
- menghindari output task menimpa seluruh state;
- menyimpan result ke sub-field;
- mengurangi payload antar state.

Mental model:

```text
InputPath   -> pilih bagian input untuk state
Parameters  -> bentuk payload ke task
ResultPath  -> tempat menyimpan output task
OutputPath  -> pilih output state untuk state berikutnya
```

Contoh pola:

```json
"CalculateRiskScore": {
  "Type": "Task",
  "Resource": "arn:aws:lambda:ap-southeast-1:123456789012:function:calculate-risk",
  "Parameters": {
    "caseId.$": "$.caseId",
    "tenantId.$": "$.tenantId",
    "correlationId.$": "$.correlationId"
  },
  "ResultPath": "$.risk",
  "Next": "RouteByRisk"
}
```

Output menjadi:

```json
{
  "caseId": "CASE-123",
  "tenantId": "TENANT-7",
  "correlationId": "corr-abc",
  "risk": {
    "score": 82,
    "level": "HIGH",
    "reasonCodes": ["HIGH_VALUE", "PRIOR_INCIDENT"]
  }
}
```

Ini jauh lebih terkendali daripada membiarkan setiap Lambda mengubah shape sesuka hati.

### 6.3 JSONPath vs JSONata

Step Functions mendukung mekanisme transformasi data. Yang penting secara arsitektur bukan hafalan sintaks, tetapi prinsip:

- transformasi sederhana boleh di workflow;
- transformasi kompleks lebih baik di code;
- policy/business rule kompleks jangan tersebar sebagai ekspresi workflow yang sulit dites;
- hasil transformasi harus stabil sebagai contract antar step.

---

## 7. Retry: Technical Retry vs Business Retry

Retry adalah salah satu alasan utama memakai Step Functions. Namun retry yang salah bisa menghancurkan sistem.

### 7.1 Technical Retry

Technical retry cocok untuk error transient:

- throttling;
- network timeout;
- service unavailable;
- temporary downstream failure;
- optimistic lock conflict yang aman diulang;
- dependency belum siap.

Contoh:

```json
"Retry": [
  {
    "ErrorEquals": [
      "Lambda.ServiceException",
      "Lambda.AWSLambdaException",
      "Lambda.SdkClientException",
      "States.Timeout"
    ],
    "IntervalSeconds": 2,
    "MaxAttempts": 3,
    "BackoffRate": 2.0
  }
]
```

Prinsip:

- retry harus bounded;
- gunakan exponential backoff;
- jangan retry semua error;
- setiap retried operation harus idempotent atau safe;
- pastikan downstream punya kapasitas menerima retry;
- observability harus menunjukkan retry count.

### 7.2 Business Retry

Business retry adalah pengulangan karena kondisi bisnis belum terpenuhi.

Contoh:

- dokumen belum lengkap;
- approval belum diberikan;
- external agency belum mengirim response;
- case perlu di-review lagi setelah applicant mengirim tambahan informasi.

Jangan campur business retry dengan technical retry.

Technical retry:

```text
Call failed because service unavailable -> retry after seconds/minutes
```

Business retry:

```text
Applicant belum upload dokumen -> wait until event/deadline
```

Business retry sebaiknya terlihat sebagai state eksplisit:

```text
RequestMoreInformation -> WaitForApplicantResponse -> RevalidateSubmission
```

Bukan disembunyikan dalam retry policy.

### 7.3 Retry Amplification

Misalnya workflow memanggil Lambda. Lambda memanggil DynamoDB dengan SDK retry. Step Functions juga retry Lambda.

Jika:

- Step Functions retry 3x;
- Lambda internal retry 3x;
- SDK retry 3x;

maka satu logical step bisa menghasilkan banyak attempt downstream.

```text
1 workflow task
  x 3 Step Functions retries
  x 3 Lambda/service retries
  x 3 SDK retries
= 27 backend attempts
```

Untuk sistem regulated/financial, ini berbahaya jika operation bukan idempotent.

Desain retry harus dilihat end-to-end.

---

## 8. Catch: Mengubah Error menjadi Jalur Proses

Catch menangkap error dan mengarahkan workflow ke state lain.

Contoh:

```json
"CheckSanctions": {
  "Type": "Task",
  "Resource": "arn:aws:lambda:ap-southeast-1:123456789012:function:check-sanctions",
  "Retry": [
    {
      "ErrorEquals": ["States.Timeout"],
      "IntervalSeconds": 5,
      "MaxAttempts": 2,
      "BackoffRate": 2
    }
  ],
  "Catch": [
    {
      "ErrorEquals": ["SanctionsServiceUnavailable"],
      "ResultPath": "$.sanctionsError",
      "Next": "RouteToManualReview"
    },
    {
      "ErrorEquals": ["States.ALL"],
      "ResultPath": "$.technicalError",
      "Next": "FailWorkflow"
    }
  ],
  "Next": "ContinueRiskAssessment"
}
```

Catch dapat dipakai untuk:

- fallback;
- manual review;
- compensation;
- dead-letter business process;
- incident escalation;
- final failure recording.

Namun, jangan mengubah semua failure menjadi success.

Buruk:

```text
Jika payment gagal, catch lalu continue sebagai sukses.
```

Lebih baik:

```text
PaymentFailed -> RecordFailure -> NotifyOps -> MarkCaseBlocked
```

Jalur proses boleh terus berjalan, tetapi status domain harus jujur.

---

## 9. Timeout dan Heartbeat

Timeout menjawab: “berapa lama step boleh berjalan sebelum dianggap gagal?”

Heartbeat menjawab: “apakah worker masih hidup saat mengerjakan task panjang?”

### 9.1 Timeout

Setiap Task yang memanggil compute/network sebaiknya punya timeout eksplisit.

Tanpa timeout, failure bisa menjadi stuck wait.

Pertanyaan desain:

- SLA step ini berapa lama?
- jika timeout, apakah retry aman?
- apakah timeout berarti dependency lambat atau payload terlalu besar?
- apakah user perlu diberi status pending?
- apakah workflow harus escalate?

### 9.2 Heartbeat

Heartbeat berguna untuk task panjang yang dikerjakan worker eksternal/activity.

Jika worker tidak mengirim heartbeat dalam interval yang diharapkan, Step Functions dapat menganggap task gagal.

Pola ini cocok untuk:

- batch processing lama;
- human-system bridge;
- legacy worker;
- external job yang dipantau.

Namun jangan pakai heartbeat sebagai pengganti observability worker. Worker tetap perlu metrics/logs/traces.

---

## 10. Callback Pattern dan Task Token

Callback pattern adalah fitur penting untuk proses panjang.

Step Functions dapat pause di sebuah Task, lalu menunggu pihak eksternal memanggil kembali dengan task token.

Pola umum:

```text
Step Functions starts review task
  -> sends task token to review service / queue / email workflow
  -> waits
Officer approves/rejects
  -> application calls SendTaskSuccess or SendTaskFailure with token
  -> workflow continues
```

AWS mendokumentasikan callback task sebagai cara pause workflow sampai task token dikembalikan, misalnya untuk human approval, third-party integration, atau legacy system. Untuk Standard Workflow, callback dapat menunggu hingga batas durasi eksekusi workflow.

### 10.1 Kapan Menggunakan Callback?

Gunakan callback ketika:

- proses menunggu manusia;
- proses menunggu sistem eksternal yang tidak bisa dipanggil sinkron;
- third-party mengirim result melalui webhook;
- legacy batch selesai di waktu tidak pasti;
- Anda ingin workflow tetap durable saat compute worker mati.

### 10.2 Human Approval Pattern

Contoh regulatory case:

```text
CreateReviewAssignment
  -> WaitForOfficerDecision(callback token)
  -> RouteByDecision
```

Review assignment service menyimpan:

```json
{
  "caseId": "CASE-123",
  "taskToken": "opaque-token",
  "assignedTo": "officer-9",
  "decisionStatus": "PENDING",
  "deadline": "2026-06-25T17:00:00+07:00"
}
```

Saat officer approve:

```text
POST /case-reviews/{reviewId}/decision
```

Service:

1. validasi officer punya hak;
2. validasi review masih pending;
3. simpan decision secara idempotent;
4. panggil Step Functions `SendTaskSuccess`;
5. jika token sudah dipakai, jangan menggandakan decision;
6. tulis audit log.

### 10.3 Task Token Security

Task token harus diperlakukan seperti secret sementara.

Jangan:

- kirim task token mentah ke browser jika tidak perlu;
- log token penuh;
- simpan token tanpa encryption;
- biarkan siapa pun memanggil callback endpoint;
- jadikan token sebagai satu-satunya authorizer.

Lebih aman:

- token disimpan server-side;
- user/action memakai review id;
- service memvalidasi authorization;
- service mengambil token dari storage;
- service memanggil Step Functions;
- audit mencatat actor dan decision.

Task token adalah capability untuk melanjutkan workflow. Perlakukan sebagai sensitive capability.

---

## 11. Activities vs Lambda/Service Integration

Step Functions Activities adalah pola worker polling.

Worker eksternal melakukan polling ke Step Functions untuk mengambil task, mengerjakan, lalu mengirim result.

Cocok untuk:

- worker di environment non-AWS;
- legacy processing;
- task panjang;
- sistem yang tidak mudah dipanggil via Lambda/API.

Namun untuk banyak sistem modern, pola yang lebih umum:

- Lambda task;
- ECS task/service;
- AWS service integration;
- SQS callback worker;
- HTTP task;
- EventBridge integration.

Pilih activity jika polling worker memang model paling natural.

Jangan pakai activity hanya karena “terlihat seperti worker queue”; SQS mungkin lebih cocok jika Anda hanya butuh work distribution.

---

## 12. Service Integrations: Jangan Semua Lewat Lambda

Step Functions bisa mengintegrasikan banyak AWS service secara langsung.

Contoh:

- invoke Lambda;
- publish SNS;
- send SQS message;
- put EventBridge event;
- start ECS task;
- start Glue job;
- put item DynamoDB;
- start nested Step Functions execution.

### 12.1 Lambda as Glue Anti-Pattern

Buruk:

```text
Step Functions -> Lambda -> SQS SendMessage
Step Functions -> Lambda -> DynamoDB PutItem
Step Functions -> Lambda -> SNS Publish
```

Jika Lambda hanya meneruskan parameter ke AWS SDK, pertimbangkan service integration langsung.

Manfaat:

- lebih sedikit code;
- lebih sedikit IAM runtime;
- lebih sedikit cold start;
- lebih sedikit failure point;
- workflow lebih eksplisit.

Namun tetap gunakan Lambda/Java service jika:

- ada domain logic;
- perlu validasi kompleks;
- perlu transformasi non-trivial;
- perlu transaksi aplikasi;
- perlu akses database internal;
- perlu library khusus;
- perlu side effect yang tidak tersedia sebagai service integration.

### 12.2 Integration Pattern

Beberapa service integration memiliki pola:

- request-response;
- run a job and wait `.sync`;
- wait for callback `.waitForTaskToken`.

Pilihan pattern memengaruhi durasi, observability, dan retry.

Contoh:

```text
Start ECS task and wait until complete -> .sync
Send message and wait for worker callback -> .waitForTaskToken
Invoke Lambda and wait response -> request-response
```

---

## 13. Saga Pattern dan Compensation

Dalam distributed systems, tidak ada transaksi ACID besar antar semua service.

Jika proses memiliki beberapa side effect, Anda perlu model compensation.

### 13.1 Contoh Side Effect

Workflow approval:

1. reserve case number;
2. create assignment;
3. notify officer;
4. create external agency request;
5. record decision;
6. issue permit;
7. notify applicant.

Jika step 6 gagal setelah step 1-5 berhasil, apa yang harus dilakukan?

Jawabannya bukan selalu rollback teknis.

Seringnya compensation adalah:

- mark as failed;
- cancel pending assignment;
- send correction notification;
- create remediation task;
- write reversal record;
- prevent duplicate issuance;
- escalate to operator.

### 13.2 Compensation bukan Undo Sempurna

Dalam sistem bisnis, compensation biasanya logical.

Contoh:

```text
Payment captured -> refund
Permit issued -> revoke
Notification sent -> send correction
Assignment created -> close/cancel assignment
External request sent -> send cancellation if supported
```

Tidak semua side effect bisa di-undo.

Maka desain harus punya tabel:

| Step | Side Effect | Idempotency Key | Retry Safe? | Compensation | Manual Escalation? |
|---|---|---|---|---|---|
| Create assignment | DB insert | caseId + assignmentType | yes | cancel assignment | yes |
| Notify officer | email/message | notificationId | maybe | send correction | no |
| Request agency check | external API | requestId | depends | cancel request | yes |
| Issue decision | DB status update | decisionId | yes | reversal decision | yes |

### 13.3 Saga in Step Functions

Step Functions dapat mengekspresikan saga:

```text
ReserveResource
  -> ChargeFee
  -> CreatePermit
  -> NotifyApplicant

If CreatePermit fails:
  -> RefundFee
  -> ReleaseResource
  -> MarkCaseFailed
```

Tetapi jangan membuat workflow terlalu penuh nested compensation jika domain service lebih cocok mengelola beberapa invariant lokal.

Pattern yang baik:

- workflow mengatur urutan dan compensation path;
- domain service menjaga invariant lokal;
- setiap operation punya idempotency key;
- setiap compensation juga idempotent;
- audit log mencatat original action dan compensation action.

---

## 14. Workflow State vs Domain State

Ini salah satu konsep paling penting.

### 14.1 Workflow State

Workflow state menjawab:

> Eksekusi proses sedang berada di step mana?

Contoh:

```text
ValidateCase
WaitForOfficerDecision
NotifyApplicant
CompensateExternalRequest
```

### 14.2 Domain State

Domain state menjawab:

> Entitas bisnis berada pada status apa?

Contoh:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
REQUEST_FOR_INFORMATION
APPROVED
REJECTED
CLOSED
```

Workflow state tidak selalu sama dengan domain state.

Contoh:

```text
Workflow state: SendApprovalNotification
Domain state: APPROVED
```

atau:

```text
Workflow state: WaitForOfficerDecision
Domain state: UNDER_REVIEW
```

### 14.3 Jangan Menjadikan Step Functions sebagai Source of Truth Domain

Buruk:

```text
Status case hanya diketahui dari current Step Functions state.
```

Kenapa buruk?

- query domain sulit;
- reporting sulit;
- migration sulit;
- workflow versioning memengaruhi domain status;
- jika workflow execution selesai, domain status tetap harus hidup;
- external system butuh status domain, bukan state teknis workflow.

Lebih baik:

- domain service/database menyimpan case status;
- Step Functions menyimpan execution progress;
- workflow memperbarui domain status melalui domain service;
- milestone events diterbitkan dari domain transition.

### 14.4 Invariant

Untuk regulated workflow:

```text
Domain state transition harus valid meskipun workflow retry/callback/redrive terjadi.
```

Artinya service harus menolak transisi ilegal.

Contoh:

```text
APPROVED -> UNDER_REVIEW  // invalid kecuali reversal process khusus
REJECTED -> APPROVED      // invalid tanpa reopen/reassessment
UNDER_REVIEW -> APPROVED  // valid jika decision recorded
```

Workflow boleh memanggil domain service, tetapi domain service tetap penjaga invariant.

---

## 15. Idempotency dalam Workflow

Step Functions bisa retry. AWS service bisa retry. Lambda bisa retry. Operator bisa redrive. User bisa klik dua kali.

Maka setiap side effect harus didesain idempotent.

### 15.1 Idempotency Key

Idempotency key harus stabil untuk logical operation.

Contoh:

```text
caseId + operationName + workflowExecutionId
caseId + decisionAttemptId
caseId + documentId + extractionVersion
caseId + notificationType + recipient
```

Jangan pakai random UUID baru setiap retry jika tujuannya mencegah duplikasi.

Buruk:

```java
String idempotencyKey = UUID.randomUUID().toString();
```

Lebih baik:

```java
String idempotencyKey = caseId + ":record-final-decision:" + decisionId;
```

### 15.2 Idempotent Domain Operation

Contoh pseudo-code:

```java
DecisionResult recordDecision(RecordDecisionCommand cmd) {
    var existing = decisionRepository.findByIdempotencyKey(cmd.idempotencyKey());
    if (existing.isPresent()) {
        return existing.get().toResult();
    }

    var caseAggregate = caseRepository.load(cmd.caseId());
    caseAggregate.recordDecision(cmd.decision(), cmd.actor(), cmd.policyVersion());

    decisionRepository.insertWithUniqueIdempotencyKey(cmd);
    caseRepository.save(caseAggregate);
    auditLog.append(...);

    return DecisionResult.created(...);
}
```

Database harus punya unique constraint atau conditional write untuk idempotency key.

### 15.3 Idempotency Table

Untuk workflow side effects, Anda bisa memiliki tabel:

```text
idempotency_key
operation_name
entity_id
status
request_hash
response_snapshot
created_at
updated_at
```

Rules:

- same key + same request -> return previous result;
- same key + different request -> reject as conflict;
- in-progress too long -> recover/escalate;
- failed retriable -> allow retry;
- failed non-retriable -> route to manual handling.

### 15.4 Step Functions Redrive

Step Functions mendukung redrive untuk me-restart eksekusi yang gagal pada kondisi tertentu. Saat redrive, retry attempt untuk state tertentu dapat di-reset sesuai dokumentasi. Ini berarti idempotency tetap harus aman bahkan setelah operator menjalankan redrive.

Jangan mengandalkan “workflow hanya jalan sekali” sebagai jaminan bisnis.

---

## 16. Human-in-the-Loop Workflow

Human approval adalah use case utama untuk regulatory systems, case management, financial operation, procurement, dan compliance.

### 16.1 Human Task bukan Sekadar Email

Human task minimal memerlukan:

- assignment id;
- assignee atau role/group;
- due date;
- priority;
- required action;
- allowed decisions;
- supporting evidence;
- authorization check;
- audit record;
- callback mechanism;
- escalation policy.

Email hanya notification channel. Source of truth tetap task/assignment store.

### 16.2 Pattern

```text
Workflow:
  CreateReviewTask
  WaitForReviewDecision(callback token)
  RouteByDecision

Review Service:
  stores task
  controls authorization
  captures decision
  calls SendTaskSuccess/Failure
```

### 16.3 Decision Contract

Output human decision harus structured:

```json
{
  "decision": "APPROVE",
  "actorId": "officer-123",
  "actorRole": "SENIOR_REVIEWER",
  "decisionAt": "2026-06-20T09:30:00+07:00",
  "reasonCodes": ["DOCUMENTS_VALID", "RISK_ACCEPTABLE"],
  "commentRef": "s3://audit-comments/...",
  "policyVersion": "policy-2026-06"
}
```

Jangan hanya:

```json
{ "approved": true }
```

Untuk audit, alasan dan policy version sering lebih penting daripada boolean.

### 16.4 Deadline dan Escalation

Human approval harus punya timeout/deadline.

Pola:

```text
CreateReviewTask
WaitForReviewDecision
  if timeout -> EscalateReview
  if rejected -> RecordRejection
  if approved -> Continue
```

Namun Step Functions callback timeout saja tidak cukup. Review service juga harus tahu deadline untuk menampilkan SLA dan mencegah action setelah expired.

### 16.5 Concurrent Decision Problem

Dua officer bisa mencoba memutuskan task yang sama.

Solusi:

- optimistic locking;
- conditional update `status = PENDING`;
- idempotency key per decision;
- audit both attempted and accepted action;
- only one accepted terminal decision.

Workflow tidak boleh menjadi satu-satunya lock.

---

## 17. Long-Running Workflow dan Versioning

Workflow panjang bisa berjalan saat Anda deploy versi baru.

Pertanyaan:

- execution lama memakai definisi lama atau baru?
- apakah callback lama masih valid?
- apakah task output v1 kompatibel dengan step v2?
- apakah domain status enum berubah?
- bagaimana migration execution yang sudah berjalan?

### 17.1 Versioning Strategy

Prinsip:

1. Treat state machine definition as versioned contract.
2. Jangan breaking change terhadap running execution.
3. Gunakan alias/version jika butuh controlled rollout.
4. Simpan workflowVersion di input/domain state.
5. Buat task code backward compatible untuk periode transisi.
6. Jangan rename state sembarangan jika observability/runbook bergantung pada nama state.

### 17.2 Forward-Compatible Payload

Payload antar step harus toleran:

- consumer mengabaikan unknown field;
- required field jelas;
- enum versioned;
- default behavior aman;
- schema didokumentasikan.

### 17.3 Running Execution Migration

Ada beberapa opsi:

1. Biarkan execution lama selesai di definisi lama.
2. Cancel dan restart dengan workflow baru jika aman.
3. Buat state khusus migration/compatibility.
4. Gunakan domain service untuk menyerap perbedaan.

Untuk regulated workflow, jangan migration execution tanpa audit dan approval.

---

## 18. Nested Workflows

Workflow besar bisa memanggil workflow kecil.

Contoh:

```text
CaseReviewWorkflow
  -> DocumentProcessingWorkflow
  -> RiskAssessmentWorkflow
  -> HumanReviewWorkflow
  -> NotificationWorkflow
```

Kelebihan:

- modular;
- reusable;
- ownership lebih jelas;
- testing lebih mudah;
- failure boundary lebih terlihat.

Risiko:

- observability lebih kompleks;
- input/output contract antar workflow harus stabil;
- retry parent terhadap child harus idempotent;
- biaya dan state transition meningkat;
- debugging perlu correlation id.

Gunakan nested workflow jika sub-process memang meaningful dan reusable, bukan hanya untuk merapikan diagram.

---

## 19. Workflow Observability

Workflow yang tidak observable akan menjadi black box.

### 19.1 Apa yang Harus Diobservasi?

Minimal:

- started executions;
- succeeded executions;
- failed executions;
- timed-out executions;
- aborted executions;
- execution duration;
- state transition count;
- per-state failure rate;
- per-state retry count;
- executions stuck in waiting states;
- callback age;
- human task SLA breach;
- compensation count;
- redrive count.

### 19.2 Correlation ID

Setiap execution harus punya correlation id.

Contoh input:

```json
{
  "caseId": "CASE-123",
  "tenantId": "TENANT-7",
  "correlationId": "corr-20260620-abc",
  "initiatedBy": "user-55",
  "workflowVersion": "case-review-v3"
}
```

Semua task, logs, events, audit records, dan notifications harus membawa correlation id.

### 19.3 Logging Strategy

Jangan log payload sensitif penuh.

Log yang baik:

```json
{
  "event": "workflow_step_completed",
  "workflow": "CaseReviewWorkflow",
  "executionId": "...",
  "state": "CalculateRiskScore",
  "caseId": "CASE-123",
  "tenantId": "TENANT-7",
  "correlationId": "corr-abc",
  "durationMs": 842,
  "outcome": "SUCCESS"
}
```

Jangan:

```text
Full applicant data, documents, token, secrets, task token, PII
```

### 19.4 Dashboards

Dashboard workflow sebaiknya menjawab:

- berapa proses masuk hari ini?
- berapa yang selesai?
- berapa yang gagal?
- step mana paling sering gagal?
- berapa yang menunggu human approval?
- berapa yang melewati SLA?
- apakah compensation meningkat?
- tenant mana terdampak?

### 19.5 Alerts

Alert yang berguna:

- failure rate meningkat;
- timeout meningkat;
- callback wait age terlalu lama;
- DLQ terkait workflow tidak kosong;
- executions stuck melewati threshold;
- state transition throttling;
- downstream dependency error;
- compensation count tinggi.

Jangan alert untuk setiap failure individual jika workflow memang punya expected business rejection. Bedakan technical failure dari domain outcome.

---

## 20. Security Model untuk Step Functions

Step Functions bukan hanya flow diagram. Ia punya IAM role, access ke service, payload, logs, callbacks, dan audit implications.

### 20.1 Execution Role

State machine menggunakan IAM role untuk memanggil resources.

Prinsip:

- least privilege;
- role per state machine atau per domain boundary;
- batasi resource ARN;
- batasi action;
- gunakan condition jika memungkinkan;
- jangan role all-powerful untuk semua workflow.

Buruk:

```text
states-role-prod has AdministratorAccess
```

Lebih baik:

```text
CaseReviewWorkflowRole:
  can invoke specific Lambda functions
  can send messages to specific SQS queues
  can put events to specific EventBridge bus
  can call specific Step Functions callback APIs only where needed
```

### 20.2 Task Role vs Workflow Role

Jika Step Functions memanggil Lambda, Lambda juga punya execution role.

Ada dua level permission:

1. Step Functions boleh invoke Lambda.
2. Lambda boleh melakukan side effect tertentu.

Jangan memberi Step Functions semua permission jika side effect sebenarnya dilakukan Lambda.

### 20.3 Callback Endpoint Authorization

Untuk human approval callback:

- user auth dilakukan oleh application service;
- application service memeriksa role/tenant/case assignment;
- token tidak dipercaya sebagai identity;
- Step Functions callback API hanya dipanggil oleh backend role;
- audit mencatat actor manusia.

### 20.4 Sensitive Data

Jangan simpan PII besar/secrets dalam workflow input/output.

Kenapa?

- execution history bisa terlihat oleh operator yang punya akses;
- logs bisa menyimpan payload;
- payload sulit dihapus selektif;
- exposure blast radius membesar.

Gunakan reference:

```json
{
  "caseId": "CASE-123",
  "evidenceRef": "s3://bucket/key",
  "piiRef": "customer-profile-id"
}
```

### 20.5 Tenant Isolation

Jika workflow multi-tenant:

- tenantId wajib ada di input;
- domain service memvalidasi tenantId;
- resource path/bucket prefix tenant-aware;
- metrics/logs tenant-aware tetapi tidak leak PII;
- IAM condition bisa digunakan untuk beberapa resource pattern;
- jangan mengandalkan client-provided tenantId tanpa auth context.

---

## 21. Cost Model

Step Functions punya biaya berdasarkan tipe workflow dan usage. Detail angka berubah, jadi desain harus berpusat pada driver biaya.

### 21.1 Cost Drivers

Driver biaya utama:

- jumlah execution;
- jumlah state transition;
- durasi dan memory untuk Express;
- jumlah retry;
- Map/Distributed Map scale;
- logging volume;
- downstream calls;
- Lambda duration/cold start;
- data transfer/log ingestion.

### 21.2 State Explosion

Jika satu proses kecil dibuat menjadi 80 state, biaya dan kompleksitas naik.

Gunakan state untuk business-relevant step, bukan micro-step internal.

### 21.3 Retry Cost

Retry tidak gratis:

- menambah state transition;
- menambah downstream call;
- menambah logs;
- bisa memperpanjang execution;
- bisa menimbulkan duplicate side effect.

Cost optimization tidak boleh menghilangkan reliability, tetapi retry harus sadar biaya.

### 21.4 Express vs Standard Cost Trade-off

Express bisa lebih cocok untuk high-volume short workflow, tetapi Standard lebih cocok untuk audit-heavy long-running workflow.

Jangan pilih Express hanya karena terlihat murah. Hitung:

- durasi;
- volume;
- logs;
- kebutuhan audit;
- support callback;
- failure recovery;
- compliance requirement.

---

## 22. Quotas dan Scaling Constraints

Step Functions adalah managed service, tetapi tetap punya quota.

Dokumentasi AWS mencatat quota untuk hal-hal seperti jumlah state machine, ukuran definisi state machine, ukuran request, state transition throttling, HTTP task duration, dan Distributed Map parallelism.

Arsitektur harus memperhitungkan:

- state transition rate;
- start execution rate;
- callback API rate;
- payload size;
- definition size;
- Map concurrency;
- downstream service quotas;
- account/region boundaries.

Jangan hanya bertanya:

> “Step Functions bisa scale?”

Tanya:

> “Apakah seluruh chain workflow, task service, database, queue, callback endpoint, IAM, dan quota mampu menahan peak dan retry storm?”

### 22.1 Quota-Aware Design

Checklist:

- hitung peak execution per second;
- hitung average state transition per execution;
- hitung worst-case retry transition;
- hitung callback rate;
- hitung downstream write rate;
- set concurrency controls;
- batasi Map concurrency;
- gunakan queue buffer jika perlu;
- request quota increase sebelum go-live;
- buat load test dengan workflow realistis.

---

## 23. Workflow untuk Regulated Case Management

Sekarang kita buat mental model yang dekat dengan domain Anda: enforcement lifecycle / complex case management.

### 23.1 Domain Scenario

Sebuah regulatory platform menerima case submission dari internal officer atau external portal.

Proses:

1. case submitted;
2. input validation;
3. document validation;
4. duplicate detection;
5. risk classification;
6. routing decision;
7. manual review jika perlu;
8. escalation untuk high-risk;
9. legal/compliance review;
10. final decision;
11. notification;
12. audit evidence sealing;
13. case closure.

### 23.2 State Machine Sketch

```text
StartCaseWorkflow
  -> ValidateSubmission
  -> CheckRequiredDocuments
  -> DetectDuplicateCase
  -> CalculateRisk
  -> RouteCase
      LOW      -> AutoApproveEligibilityCheck
      MEDIUM   -> CreateOfficerReviewTask -> WaitForOfficerDecision
      HIGH     -> CreateEscalationTask -> WaitForSeniorDecision
  -> RecordDecision
  -> NotifyParties
  -> SealAuditEvidence
  -> CloseCase
```

### 23.3 Domain Status Mapping

| Workflow State | Domain Status |
|---|---|
| ValidateSubmission | SUBMITTED |
| CheckRequiredDocuments | SUBMITTED |
| CreateOfficerReviewTask | UNDER_REVIEW |
| WaitForOfficerDecision | UNDER_REVIEW |
| CreateEscalationTask | ESCALATED |
| WaitForSeniorDecision | ESCALATED |
| RecordDecision | DECISION_PENDING_RECORDING |
| NotifyParties | DECISION_RECORDED |
| SealAuditEvidence | CLOSING |
| CloseCase | CLOSED |

Domain status harus disimpan di case service/database, bukan hanya inferred dari Step Functions.

### 23.4 Audit Evidence

Untuk setiap major transition:

```json
{
  "caseId": "CASE-123",
  "fromStatus": "UNDER_REVIEW",
  "toStatus": "APPROVED",
  "actor": "officer-123",
  "actorType": "HUMAN",
  "workflowExecutionArn": "...",
  "workflowState": "RecordDecision",
  "correlationId": "corr-abc",
  "policyVersion": "policy-2026-06",
  "reasonCodes": ["SUFFICIENT_EVIDENCE"],
  "timestamp": "2026-06-20T10:00:00+07:00"
}
```

Audit trail tidak boleh hanya berupa Step Functions execution history. Execution history membantu, tetapi domain audit log harus dirancang eksplisit.

### 23.5 Reopen/Reassessment

Regulatory workflow jarang benar-benar linear.

Ada kasus:

- applicant mengajukan appeal;
- evidence baru ditemukan;
- decision perlu direvisi;
- case perlu reopened;
- enforcement action perlu escalated setelah closure.

Jangan memaksa satu execution untuk hidup selamanya.

Pola lebih baik:

```text
CaseInitialReviewWorkflow
CaseAppealWorkflow
CaseReassessmentWorkflow
EnforcementActionWorkflow
```

Domain aggregate menghubungkan semua workflow execution.

---

## 24. Java Implementation Patterns

Step Functions sering memanggil Java service melalui Lambda, ECS, API, atau event/queue.

### 24.1 Java Lambda Task Handler

Pola handler:

```java
public final class ValidateCaseHandler implements RequestHandler<ValidateCaseRequest, ValidateCaseResult> {

    private static final CaseService caseService = Bootstrap.caseService();

    @Override
    public ValidateCaseResult handleRequest(ValidateCaseRequest request, Context context) {
        requireNonNull(request.caseId(), "caseId is required");
        requireNonNull(request.tenantId(), "tenantId is required");
        requireNonNull(request.correlationId(), "correlationId is required");

        return caseService.validateSubmission(request);
    }
}
```

Prinsip:

- request/response typed;
- validate required fields;
- propagate correlation id;
- service operation idempotent jika memiliki side effect;
- jangan membuat AWS clients per invocation;
- jangan log PII penuh;
- exception taxonomy jelas.

### 24.2 Exception Mapping

Java exception harus dipetakan ke error yang bisa ditangani Step Functions.

Contoh:

```java
class MissingRequiredDocumentException extends RuntimeException {}
class PolicyEvaluationUnavailableException extends RuntimeException {}
class DuplicateCaseDetectedException extends RuntimeException {}
class NonRetriableCaseValidationException extends RuntimeException {}
```

Namun di Lambda, nama error yang diterima Step Functions bergantung pada runtime/integration. Pastikan error name bisa dicocokkan dengan Catch/Retry.

Jangan hanya throw `RuntimeException` untuk semua hal.

### 24.3 Domain Service Endpoint Pattern

Untuk ECS/EC2 Java service, Step Functions bisa:

- memanggil API via API Gateway/HTTP task;
- mengirim command ke SQS;
- memanggil Lambda adapter;
- memakai EventBridge callback.

Pola callback via SQS:

```text
Step Functions -> SQS message with task token
Java worker consumes
Java worker processes
Java worker calls SendTaskSuccess/Failure
```

Worker harus:

- idempotent;
- menyimpan progress;
- memperlakukan task token sebagai secret;
- handle duplicate SQS delivery;
- avoid calling callback twice;
- handle callback failure.

### 24.4 Step Functions Client in Java

Contoh penggunaan SDK v2 untuk callback:

```java
var client = SfnClient.builder()
    .region(Region.AP_SOUTHEAST_1)
    .build();

client.sendTaskSuccess(SendTaskSuccessRequest.builder()
    .taskToken(taskToken)
    .output(objectMapper.writeValueAsString(result))
    .build());
```

Untuk failure:

```java
client.sendTaskFailure(SendTaskFailureRequest.builder()
    .taskToken(taskToken)
    .error("OfficerDecisionRejected")
    .cause("Officer rejected the case with reason code INSUFFICIENT_EVIDENCE")
    .build());
```

Catatan:

- jangan log token;
- output harus kecil;
- serialize JSON stabil;
- retry callback API dengan hati-hati;
- jika `SendTaskSuccess` gagal karena token invalid/expired, domain service harus tahu apakah decision sudah final atau perlu operator review.

---

## 25. Error Taxonomy untuk Workflow

Buat error taxonomy eksplisit.

### 25.1 Technical Transient

Contoh:

- timeout;
- throttling;
- connection reset;
- dependency 503;
- temporary capacity issue.

Action:

- retry bounded;
- backoff;
- alert jika threshold;
- no domain status change kecuali stuck/pending.

### 25.2 Technical Permanent

Contoh:

- bad configuration;
- IAM access denied;
- invalid resource ARN;
- missing secret;
- schema mismatch;
- KMS deny.

Action:

- do not retry indefinitely;
- fail fast;
- alert ops;
- mark workflow technical failure;
- preserve input for redrive.

### 25.3 Business Expected

Contoh:

- insufficient evidence;
- duplicate case;
- failed eligibility;
- applicant missing document;
- risk too high for auto-approval.

Action:

- route to expected branch;
- not counted as technical failure;
- update domain status;
- notify user/officer.

### 25.4 Business Exceptional

Contoh:

- policy conflict;
- inconsistent case state;
- officer not authorized;
- decision after deadline;
- duplicate final decision attempt.

Action:

- reject operation;
- audit attempt;
- manual escalation;
- possible incident.

---

## 26. Testing Strategy

Workflow harus dites pada beberapa level.

### 26.1 Definition Validation

Pastikan state machine valid secara sintaks dan deployable.

### 26.2 Contract Test per Task

Setiap task punya input/output schema.

Test:

- required fields;
- optional fields;
- unknown fields;
- version compatibility;
- error mapping.

### 26.3 Path Test

Uji path utama:

- low-risk auto approve;
- medium-risk manual review;
- high-risk escalation;
- missing document;
- duplicate case;
- technical failure;
- compensation path.

### 26.4 Idempotency Test

Simulasikan:

- same task invoked twice;
- callback sent twice;
- retry after partial DB write;
- workflow redrive;
- duplicate external event;
- user double click.

### 26.5 Failure Injection

Simulasikan:

- downstream timeout;
- access denied;
- invalid payload;
- dependency unavailable;
- callback expired;
- officer decision race;
- state transition throttling;
- Map partial failure.

### 26.6 Production-like Test

Sebelum go-live:

- load test execution rate;
- test quotas;
- test observability;
- test runbook;
- test redrive;
- test audit evidence;
- test IAM least privilege;
- test rollback/versioning.

---

## 27. Anti-Patterns

### 27.1 Workflow as Code Dump

Terlalu banyak logic dipindahkan ke ASL sampai workflow sulit dibaca.

Solusi:

- workflow untuk process routing;
- domain service untuk domain logic.

### 27.2 Lambda Glue Everywhere

Semua step Lambda kecil hanya memanggil AWS SDK.

Solusi:

- gunakan service integration langsung jika tidak ada domain logic.

### 27.3 No Idempotency

Workflow retry tapi operation menggandakan side effect.

Solusi:

- idempotency key;
- conditional write;
- unique constraint;
- response snapshot.

### 27.4 Business Failure Counted as Technical Failure

Case rejected dianggap workflow failed.

Solusi:

- domain negative outcome harus `Succeed` dengan status domain yang benar.

### 27.5 Technical Failure Hidden as Success

Dependency gagal tapi workflow tetap sukses tanpa mencatat masalah.

Solusi:

- explicit failure branch;
- compensation;
- alert;
- audit.

### 27.6 Payload Bloat

Workflow membawa seluruh document/customer data.

Solusi:

- pass references;
- store large payload in S3/database;
- keep workflow payload small.

### 27.7 No Versioning Plan

Workflow panjang berubah saat execution lama masih berjalan.

Solusi:

- version/alias;
- backward-compatible task;
- migration strategy.

### 27.8 Token Leakage

Task token dilog atau dikirim ke client.

Solusi:

- server-side token storage;
- redact logs;
- auth via domain service.

### 27.9 Workflow as Source of Truth

Case status hanya diketahui dari execution state.

Solusi:

- domain status in domain database;
- workflow state as process execution state.

### 27.10 No Operational Runbook

Saat execution stuck, operator tidak tahu apa yang harus dilakukan.

Solusi:

- define runbook per failure state;
- dashboard;
- redrive procedure;
- escalation path.

---

## 28. ADR Template untuk Step Functions Workflow

Gunakan template ini ketika mendesain workflow produksi.

```md
# ADR: Use AWS Step Functions for <Workflow Name>

## Context

- Business process:
- Criticality:
- Expected volume:
- Average duration:
- Maximum duration:
- Human approval needed:
- External systems involved:
- Audit/compliance requirements:

## Decision

We will implement <workflow> using AWS Step Functions <Standard/Express>.

## Why Step Functions

- Durable execution:
- Explicit state machine:
- Retry/catch requirement:
- Human callback requirement:
- Auditability:
- Service integration:

## Workflow Type

- Selected type:
- Reason:
- Why not the alternative:

## State Machine Boundary

In workflow:
- Process sequencing
- Branching
- Retry/catch
- Compensation path

In domain services:
- Domain validation
- Invariants
- Persistence
- Authorization
- Audit log

## Input/Output Contract

Required input:
- caseId
- tenantId
- correlationId
- workflowVersion

Large payload storage:
- S3/database references only

## Idempotency

- Idempotency key strategy:
- Side effects:
- Duplicate callback handling:
- Redrive safety:

## Error Handling

- Transient technical errors:
- Permanent technical errors:
- Expected business outcomes:
- Exceptional business outcomes:

## Compensation

| Step | Side effect | Compensation | Idempotent? |
|---|---|---|---|

## Security

- Execution role:
- Callback token handling:
- PII handling:
- Tenant isolation:
- Log redaction:

## Observability

- Metrics:
- Logs:
- Traces:
- Dashboards:
- Alerts:
- Runbooks:

## Cost and Quotas

- Expected executions/day:
- State transitions/execution:
- Peak start rate:
- Callback rate:
- Quota risks:
- Cost drivers:

## Versioning

- Version/alias strategy:
- Running execution compatibility:
- Migration plan:

## Consequences

Positive:
- ...

Negative:
- ...

Open risks:
- ...
```

---

## 29. Production Checklist

Sebelum workflow dianggap production-ready:

### 29.1 Design

- [ ] Workflow boundary jelas.
- [ ] Domain state dan workflow state dipisahkan.
- [ ] Standard vs Express dipilih dengan alasan jelas.
- [ ] State granularity tidak terlalu kasar/halus.
- [ ] Human task model jelas.
- [ ] Compensation path didesain.
- [ ] Workflow versioning plan ada.

### 29.2 Data Contract

- [ ] Input schema terdokumentasi.
- [ ] Output schema terdokumentasi.
- [ ] Payload tidak membawa data besar.
- [ ] PII/secrets tidak tersimpan di execution history/logs.
- [ ] Correlation id selalu ada.
- [ ] Tenant id selalu ada jika multi-tenant.

### 29.3 Idempotency

- [ ] Semua side effect punya idempotency key.
- [ ] Callback double-submit aman.
- [ ] Retry aman.
- [ ] Redrive aman.
- [ ] External API call punya duplicate handling.

### 29.4 Error Handling

- [ ] Retry hanya untuk error yang tepat.
- [ ] Retry bounded.
- [ ] Catch branch jelas.
- [ ] Business rejection bukan technical failure.
- [ ] Technical failure tidak disembunyikan.
- [ ] Timeout eksplisit.

### 29.5 Security

- [ ] Execution role least privilege.
- [ ] Task roles least privilege.
- [ ] Callback token tidak bocor.
- [ ] Logs redacted.
- [ ] CloudTrail/Audit enabled.
- [ ] Authorization human approval dilakukan di domain service.

### 29.6 Observability

- [ ] Metrics tersedia.
- [ ] Logs structured.
- [ ] Dashboard ada.
- [ ] Alerts meaningful.
- [ ] Runbook tersedia.
- [ ] Stuck execution bisa ditemukan.
- [ ] SLA human task bisa dipantau.

### 29.7 Operational Readiness

- [ ] Quota dihitung.
- [ ] Load test dilakukan.
- [ ] Redrive procedure diuji.
- [ ] Deployment rollback diuji.
- [ ] Version compatibility diuji.
- [ ] Compensation diuji.

---

## 30. Latihan Praktis

### Exercise 1 — Model Workflow

Ambil proses bisnis berikut:

```text
Case submitted -> validate -> risk classify -> manual review if medium/high -> final decision -> notify -> close
```

Buat:

- domain statuses;
- workflow states;
- mapping workflow state ke domain status;
- expected business outcomes;
- technical failure paths.

### Exercise 2 — Retry Design

Untuk setiap task:

| Task | Error | Retry? | Catch? | Compensation? |
|---|---|---|---|---|
| ValidateSubmission | bad input | no | business branch | no |
| CalculateRisk | service timeout | yes | manual review | no |
| RecordDecision | DB conflict | maybe | fail/escalate | no |
| NotifyApplicant | email provider down | yes | queue retry | maybe |

Lengkapi tabel untuk workflow Anda.

### Exercise 3 — Idempotency Keys

Tentukan idempotency key untuk:

- create review task;
- record decision;
- send notification;
- request external agency check;
- seal audit evidence;
- close case.

### Exercise 4 — Human Approval Callback

Desain API:

```http
POST /review-tasks/{id}/decision
```

Tentukan:

- auth rule;
- request body;
- idempotency rule;
- domain status transition;
- callback token handling;
- audit log;
- error responses.

### Exercise 5 — Workflow Review

Ambil workflow yang sudah ada di organisasi Anda. Tanyakan:

- apakah process state eksplisit?
- apakah retry aman?
- apakah operator tahu step yang stuck?
- apakah business rejection dibedakan dari technical failure?
- apakah audit trail cukup untuk regulator?
- apakah workflow terlalu banyak/terlalu sedikit state?

---

## 31. Ringkasan Mental Model

Step Functions adalah alat untuk membuat proses bisnis dan distributed orchestration menjadi eksplisit.

Hal yang harus Anda ingat:

1. Step Functions cocok untuk durable multi-step workflow.
2. Standard workflow biasanya tepat untuk long-running business process dan audit-heavy flow.
3. Express cocok untuk short high-volume orchestration.
4. Workflow state bukan domain state.
5. Domain service tetap harus menjaga invariant.
6. Retry tanpa idempotency adalah sumber duplicate side effect.
7. Callback token berguna untuk human approval/external integration, tetapi harus diamankan.
8. Business rejection bukan technical failure.
9. Compensation biasanya logical, bukan rollback sempurna.
10. Observability, audit, versioning, dan runbook harus didesain sejak awal.
11. Workflow harus membawa identifier/reference, bukan payload besar.
12. Step Functions tidak menggantikan domain model; ia mengorkestrasi proses.

Jika Anda memahami bagian ini, Anda mulai bisa mendesain workflow seperti engineer senior/staff: bukan hanya menggambar kotak dan panah, tetapi mendefinisikan **state, contract, invariant, failure, retry, audit, cost, dan operability**.

---

## 32. Referensi Resmi

Referensi utama untuk bagian ini:

- AWS Step Functions Developer Guide — What is Step Functions?
- AWS Step Functions — Choosing workflow type: Standard vs Express.
- AWS Step Functions — Service integration patterns.
- AWS Step Functions — Task state.
- AWS Step Functions — Parallel state.
- AWS Step Functions — Error handling with Retry and Catch.
- AWS Step Functions — Human approval tutorial.
- AWS Step Functions — Service quotas.
- AWS Step Functions — Redrive executions.
- AWS Lambda — Best practices and idempotency guidance.
- AWS SDK for Java 2.x — Step Functions client and runtime integration.

---

## 33. Apa Berikutnya?

Part berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-016.md
```

Judul:

```text
Security Architecture I: Network, Identity, Encryption, Secret, dan Isolation
```

Setelah workflow, kita masuk ke security architecture yang lebih menyeluruh: bagaimana network boundary, identity boundary, encryption boundary, secret boundary, dan isolation model disusun agar workload AWS aman dan defensible.

---

## Status Seri

Seri belum selesai.

Anda sudah menyelesaikan:

- Part 000 — AWS Cloud Architecture Mastery Overview
- Part 001 — AWS Mental Model
- Part 002 — AWS Account Architecture
- Part 003 — IAM Deep Model
- Part 004 — Credentials for Java Applications
- Part 005 — Networking in AWS
- Part 006 — AWS DNS and Traffic Entry
- Part 007 — Compute Choices
- Part 008 — EC2 Production Architecture
- Part 009 — ECS and Fargate for Java Services
- Part 010 — Lambda for Java Engineers
- Part 011 — Storage Architecture
- Part 012 — Application Data on AWS
- Part 013 — DynamoDB for System Designers
- Part 014 — Event Integration on AWS
- Part 015 — Workflow and Orchestration

Bagian berikutnya adalah Part 016.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-014.md">⬅️ Part 014 — Event Integration on AWS: SQS, SNS, EventBridge, Kinesis, Step Functions</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-016.md">Part 016 — Security Architecture I: Network, Identity, Encryption, Secret, dan Isolation ➡️</a>
</div>
