# learn-java-bpmn-camunda-process-orchestration-engineering

# Part 2 — BPMN Core Elements: Events, Tasks, Gateways, Subprocesses

> Seri: Java BPMN, Camunda, dan Process Orchestration Engineering  
> Target: Software engineer Java 8–25 yang ingin memahami BPMN bukan sebagai gambar, tetapi sebagai bahasa eksekusi untuk long-running business process.  
> Fokus Part 2: memahami elemen inti BPMN secara runtime: event, task, gateway, subprocess, sequence flow, message flow, boundary behavior, dan bagaimana elemen-elemen ini membentuk model proses yang aman untuk production.

---

## 0. Posisi Part Ini Dalam Seri

Pada Part 0 kita membentuk orientasi besar: kenapa process orchestration berbeda dari CRUD, queue consumer, batch job, state machine, dan rules engine.

Pada Part 1 kita membahas BPMN sebagai **execution contract**: process instance, token flow, wait state, event, activity, gateway, XML, dan perbedaan antara diagram yang valid, executable, dan operable.

Part 2 masuk ke elemen inti BPMN.

Tujuannya bukan menghafal simbol, tetapi memahami:

1. apa arti setiap elemen terhadap token;
2. kapan token berhenti;
3. kapan token bercabang;
4. kapan token bergabung;
5. kapan proses menunggu manusia, waktu, pesan, atau external worker;
6. kapan failure dianggap technical failure;
7. kapan failure dianggap business outcome;
8. kapan subprocess sebaiknya dipakai;
9. kapan sebuah model mulai berbahaya untuk production.

BPMN mudah terlihat karena bentuknya visual. Tetapi complexity-nya ada di **semantics**.

Dua diagram bisa tampak mirip, tetapi punya konsekuensi runtime yang sangat berbeda.

Contoh:

```text
[Submit Application] -> [Verify Documents] -> [Approve]
```

Terlihat sederhana.

Tetapi pertanyaan engineering-nya banyak:

- Apakah `Submit Application` dilakukan oleh manusia atau sistem?
- Apakah `Verify Documents` synchronous atau asynchronous?
- Apakah verification boleh gagal?
- Jika gagal, apakah retry atau balik ke applicant?
- Jika officer diam selama 7 hari, apa yang terjadi?
- Apakah approval perlu maker-checker?
- Apakah process bisa dibatalkan?
- Apakah process bisa direopen?
- Apakah ada audit trail untuk alasan approval?
- Apakah proses masih valid jika rules berubah minggu depan?

Part ini membantu membaca elemen BPMN dengan kacamata seperti itu.

---

## 1. Peta Besar Elemen BPMN

Dalam BPMN, elemen-elemen inti biasanya bisa dipahami melalui beberapa kelompok besar:

| Kelompok | Fungsi | Contoh |
|---|---|---|
| Event | Sesuatu yang terjadi | start event, timer event, message event, error event |
| Activity | Sesuatu yang dilakukan | task, subprocess, call activity |
| Gateway | Keputusan atau sinkronisasi flow | exclusive, parallel, inclusive, event-based |
| Flow | Hubungan antar elemen | sequence flow, message flow, association |
| Data | Informasi yang dipakai proses | data object, data store, variables di engine |
| Swimlane | Responsibility/ownership | pool, lane |
| Artifact | Penjelasan tambahan | annotation, group |

Dalam executable BPMN, fokus utama biasanya adalah:

```text
Event + Activity + Gateway + Flow + Data Contract
```

Swimlane dan artifact penting untuk komunikasi, tetapi belum tentu semua punya efek runtime di engine.

Mental model dasarnya:

```text
Process instance memiliki token.
Token bergerak melalui sequence flow.
Event menangkap atau melempar sesuatu.
Activity menjalankan kerja.
Gateway menentukan cabang atau join.
Subprocess mengelompokkan flow yang lebih kecil.
Boundary event mengubah nasib activity yang sedang berjalan.
```

---

## 2. Event: “Sesuatu Terjadi”

Event adalah elemen BPMN yang merepresentasikan sesuatu yang terjadi selama proses.

Event bukan pekerjaan utama. Event adalah trigger, signal, interruption, notification, timer, error, escalation, atau completion marker.

Secara visual, event umumnya berbentuk lingkaran.

Secara runtime, event menjawab pertanyaan:

```text
Apa yang dapat memulai proses?
Apa yang dapat membuat proses menunggu?
Apa yang dapat mengganggu activity?
Apa yang dapat mengakhiri cabang proses?
Apa yang dapat dikirim keluar oleh proses?
```

Event punya beberapa dimensi penting:

1. posisinya;
2. jenisnya;
3. apakah catching atau throwing;
4. apakah interrupting atau non-interrupting;
5. apakah memengaruhi satu activity, satu subprocess, atau seluruh process instance.

---

## 3. Event Berdasarkan Posisi

### 3.1 Start Event

Start event menandai awal process instance.

Contoh:

```text
(Start) -> [Validate Application] -> [Create Case]
```

Start event menjawab:

```text
Apa yang menyebabkan process instance dibuat?
```

Jenis start event yang umum:

| Start Event | Arti |
|---|---|
| None Start Event | Proses dimulai secara eksplisit oleh API/UI/engine command |
| Message Start Event | Proses dimulai ketika message tertentu diterima |
| Timer Start Event | Proses dimulai berdasarkan jadwal |
| Conditional Start Event | Proses dimulai ketika kondisi terpenuhi |
| Signal Start Event | Proses dimulai oleh broadcast signal |
| Error Start Event | Umumnya dipakai dalam event subprocess |
| Escalation Start Event | Umumnya dipakai dalam event subprocess |

#### None Start Event

None start event adalah awal paling sederhana.

Biasanya dipakai ketika aplikasi Java memanggil API engine untuk membuat process instance.

Contoh domain:

```text
Applicant submits licensing application.
Backend validates request.
Backend starts BPMN process instance.
```

BPMN:

```text
(None Start) -> [Initial Completeness Check]
```

Cocok ketika:

- proses dimulai dari UI;
- proses dimulai dari REST API;
- proses dimulai dari backend service;
- ada command eksplisit seperti `submitApplication()`.

Tidak cocok ketika:

- proses harus mulai otomatis karena event eksternal;
- proses harus mulai terjadwal;
- proses harus mulai dari message broker tanpa command manual.

#### Message Start Event

Message start event membuat process instance ketika message tertentu diterima.

Contoh:

```text
(Message: PaymentReceived) -> [Issue Receipt] -> [Continue Processing]
```

Cocok ketika:

- external system mengirim event;
- process instance belum ada sebelumnya;
- incoming message adalah pemicu awal business process.

Contoh:

```text
External payment provider sends `PaymentReceived`.
System starts `PostPaymentFulfilmentProcess`.
```

Design concern:

- message name harus stabil;
- correlation key harus jelas;
- duplicate message harus aman;
- message TTL harus dipikirkan;
- source event harus bisa diaudit.

#### Timer Start Event

Timer start event memulai proses berdasarkan waktu.

Contoh:

```text
Every day 02:00 -> [Scan Expiring Cases] -> [Create Escalation Tasks]
```

Cocok untuk:

- daily batch orchestration;
- reminder generation;
- periodic compliance check;
- scheduled report;
- cleanup flow.

Tetapi hati-hati: timer start event bukan pengganti scheduler enterprise yang sangat kompleks. Jika scheduling logic bergantung pada business calendar, public holiday, agency-specific cut-off, dan retry policy kompleks, sering kali scheduler domain service tetap dibutuhkan.

Pattern yang lebih sehat:

```text
Timer Start Event
  -> [Ask Domain Service: Which cases need action?]
  -> [For each case, start/continue process]
```

Bukan:

```text
Timer Start Event
  -> giant BPMN with complex date calculation everywhere
```

### 3.2 Intermediate Event

Intermediate event terjadi di tengah proses.

Ada dua kategori besar:

1. catching intermediate event;
2. throwing intermediate event.

#### Catching Intermediate Event

Catching event membuat proses menunggu sesuatu.

Contoh:

```text
[Send Payment Request]
  -> (Wait for PaymentReceived message)
  -> [Issue License]
```

Runtime behavior:

- token berhenti di event;
- process instance masuk wait state;
- engine menunggu message/timer/signal/condition;
- setelah event terjadi, token lanjut.

Ini sangat penting untuk long-running process.

Tanpa catching event, engineer sering membuat polling job manual atau status table yang terus dicek.

Dengan BPMN:

```text
Proses bisa eksplisit berkata:
"Saya sedang menunggu pembayaran."
```

#### Throwing Intermediate Event

Throwing event membuat proses mengirim/memicu sesuatu.

Contoh:

```text
[Approve Application]
  -> (Throw Message: ApplicationApproved)
  -> [Generate Certificate]
```

Runtime behavior:

- token sampai ke event;
- event dipancarkan/dilempar;
- token lanjut.

Tergantung engine dan event type, efeknya bisa berupa message, signal, escalation, atau event lain.

### 3.3 Boundary Event

Boundary event dipasang pada activity.

Artinya:

```text
Selama activity ini berjalan, sesuatu bisa terjadi di batas activity tersebut.
```

Contoh:

```text
        +-------------------+
        | User Task: Review |
        +-------------------+
             | normal complete
             v
          [Approve]

Boundary Timer on Review:
  if 5 days passed -> [Escalate]
```

Boundary event sangat penting untuk:

- timeout;
- escalation;
- cancellation;
- error handling;
- compensation;
- alternative flow;
- exception path.

Boundary event bisa:

1. interrupting;
2. non-interrupting.

#### Interrupting Boundary Event

Interrupting boundary event membatalkan activity yang ditempeli.

Contoh:

```text
[Officer Review]
  boundary timer after 7 days -> [Escalate to Supervisor]
```

Jika timer aktif:

```text
Officer Review dibatalkan.
Token pindah ke Escalate to Supervisor.
```

Cocok jika:

- task lama tidak boleh diselesaikan lagi;
- setelah timeout, ownership berpindah;
- proses harus keluar dari activity saat exception terjadi.

#### Non-interrupting Boundary Event

Non-interrupting boundary event tidak membatalkan activity utama.

Contoh:

```text
[Officer Review]
  non-interrupting timer every 2 days -> [Send Reminder]
```

Jika timer aktif:

```text
Officer Review tetap berjalan.
Cabang reminder tambahan dibuat.
```

Cocok untuk:

- reminder;
- notification;
- parallel escalation visibility;
- audit note;
- follow-up task yang tidak membatalkan task utama.

Risiko:

- bisa membuat banyak cabang paralel;
- timer berulang bisa menghasilkan noise;
- reminder spam;
- model menjadi sulit dibaca.

### 3.4 End Event

End event menandai akhir sebuah path.

Jenis end event:

| End Event | Arti |
|---|---|
| None End Event | Cabang selesai secara normal |
| Message End Event | Mengirim message saat selesai |
| Error End Event | Melempar BPMN error |
| Escalation End Event | Melempar escalation |
| Terminate End Event | Mengakhiri seluruh process/subprocess scope |
| Compensation End Event | Memicu compensation |
| Signal End Event | Broadcast signal |

#### None End Event

Akhir normal.

```text
[Issue License] -> (End)
```

Aman untuk path sederhana.

#### Terminate End Event

Terminate end event menghentikan seluruh scope.

Contoh:

```text
[Application Withdrawn] -> (Terminate End)
```

Berbahaya jika dipakai sembarangan.

Karena terminate dapat mematikan cabang paralel lain yang mungkin masih punya pekerjaan penting.

Gunakan ketika business meaning-nya jelas:

```text
Application is withdrawn, so all ongoing review tasks, reminders, and pending subprocesses must stop.
```

Jangan gunakan hanya karena “ingin cepat selesai”.

#### Error End Event

Error end event melempar BPMN error ke boundary/error handler di scope atas.

Cocok untuk business error yang dimodelkan.

Contoh:

```text
[Validate Eligibility]
  -> not eligible
  -> (Error End: ApplicantNotEligible)
```

Ini berbeda dari Java exception teknis seperti `NullPointerException`, `SocketTimeoutException`, atau database unavailable.

Business error adalah outcome bisnis yang bisa dijelaskan.

Technical exception adalah failure sistem yang perlu retry/incident.

---

## 4. Event Berdasarkan Sifat: Catching vs Throwing

Event bisa dipahami sebagai input atau output.

```text
Catching event  = menunggu/menerima sesuatu.
Throwing event  = mengirim/melempar sesuatu.
```

| Event | Catching | Throwing |
|---|---|---|
| Message | Wait for message | Send message |
| Timer | Wait until time | Tidak umum sebagai throwing |
| Error | Catch error | Throw error |
| Escalation | Catch escalation | Throw escalation |
| Signal | Catch signal | Throw signal |
| Compensation | Catch compensation | Throw compensation |
| Conditional | Wait for condition | Tidak umum sebagai throwing |

Contoh message catching:

```text
[Request Payment]
  -> (Catch Message: PaymentReceived)
  -> [Fulfil Order]
```

Contoh message throwing:

```text
[Approve Case]
  -> (Throw Message: CaseApproved)
  -> [Archive Case]
```

Top 1% habit:

Jangan hanya bertanya “event apa yang cocok?”

Tanyakan:

```text
Apakah proses sedang menunggu dunia luar?
Atau proses sedang memberi tahu dunia luar?
Apakah event ini harus idempotent?
Apakah event ini broadcast atau targeted?
Apakah event ini punya correlation key?
Apakah event ini bisa datang sebelum proses siap menerima?
```

---

## 5. Message Event

Message event merepresentasikan komunikasi spesifik antara participant/process/system.

Message biasanya targeted, bukan broadcast.

Contoh:

```text
PaymentReceived for applicationId = A123
```

Message event membutuhkan desain korelasi.

### 5.1 Message Start Event

```text
(Message Start: ApplicationSubmitted)
  -> [Create Case]
```

Artinya process instance dibuat karena message masuk.

### 5.2 Intermediate Message Catch Event

```text
[Send Request for Information]
  -> (Wait Message: ApplicantSubmittedInfo)
  -> [Review Additional Info]
```

Artinya process instance sudah ada dan menunggu message.

### 5.3 Boundary Message Event

```text
[Wait for Officer Review]
  boundary message: ApplicantWithdrawn
  -> [Cancel Application]
```

Artinya selama officer review berjalan, applicant bisa menarik application.

### 5.4 Message Design Checklist

Untuk setiap message event, harus jelas:

1. message name;
2. producer;
3. consumer;
4. correlation key;
5. business identifier;
6. duplicate handling;
7. TTL;
8. replay behavior;
9. authorization;
10. audit trail;
11. payload schema;
12. versioning;
13. error behavior jika tidak ada process instance yang cocok.

Contoh buruk:

```text
Message name: update
Correlation key: id
Payload: anything
```

Contoh lebih baik:

```text
Message name: ApplicantAdditionalInformationSubmitted
Correlation key: applicationReferenceNo
Payload:
  applicationReferenceNo
  submissionId
  submittedBy
  submittedAt
  documentRefs
  declarationVersion
```

---

## 6. Timer Event

Timer event merepresentasikan waktu.

Timer bisa digunakan sebagai:

1. start event;
2. intermediate catch event;
3. boundary event;
4. event subprocess trigger.

### 6.1 Timer Start Event

```text
Every day at 01:00
  -> [Find Overdue Reviews]
  -> [Create Escalations]
```

### 6.2 Intermediate Timer Event

```text
[Send Reminder]
  -> (Wait 3 days)
  -> [Send Second Reminder]
```

### 6.3 Boundary Timer Event

```text
[Officer Review]
  boundary timer: 5 working days
  -> [Escalate]
```

### 6.4 Timer Engineering Concerns

Timer terlihat sederhana, tetapi production concern-nya berat:

- timezone;
- daylight saving time;
- business day vs calendar day;
- public holiday;
- agency-specific SLA;
- timer volume;
- rescheduling;
- process migration;
- clock skew;
- delayed engine processing;
- overloaded cluster;
- duplicate downstream effect after timeout.

### 6.5 Calendar Time vs Business Time

BPMN timer biasanya bagus untuk waktu teknis:

```text
PT15M
P3D
R/PT1H
2026-06-30T17:00:00+07:00
```

Tetapi business SLA sering seperti ini:

```text
5 working days excluding public holidays and agency closure days.
If submitted after 17:00, count from next working day.
If case category is high risk, SLA is 2 working days.
```

Ini bukan sekadar timer.

Pattern yang lebih baik:

```text
[Calculate Due Date in Domain Service]
  -> dueAt variable
  -> (Timer waits until dueAt)
```

Jangan menyebarkan business calendar logic ke banyak expression BPMN.

---

## 7. Error Event

Error event merepresentasikan business error yang dimodelkan.

Contoh:

```text
ApplicantNotEligible
PaymentRejected
DocumentInvalid
DuplicateApplicationDetected
```

Error event tidak sama dengan Java exception teknis.

### 7.1 Technical Exception

Contoh:

```text
Database timeout
HTTP 503
JSON parse failure
Redis unavailable
NullPointerException
```

Respons normal:

```text
retry -> retry exhausted -> incident/manual repair
```

### 7.2 Business Error

Contoh:

```text
Applicant age below requirement
License category not allowed
Payment provider confirms payment failed
Mandatory document missing after deadline
```

Respons normal:

```text
BPMN error -> modeled alternative path
```

### 7.3 Boundary Error Event

```text
+--------------------------+
| Subprocess: Assess Case  |
+--------------------------+
       boundary error: AssessmentRejected
              -> [Notify Rejection]
```

Artinya jika dalam subprocess ada error `AssessmentRejected`, proses keluar ke path rejection.

### 7.4 Error End Event

```text
[Check Eligibility]
  -> not eligible
  -> (Error End: NotEligible)
```

Error ini akan ditangkap oleh boundary error di scope luar jika ada.

Jika tidak ada handler, process bisa masuk incident/failed state tergantung engine behavior.

### 7.5 Error Modeling Rule

Gunakan BPMN error jika:

- failure adalah bagian dari business model;
- business user bisa memahami outcome-nya;
- ada path yang jelas setelah error;
- error bukan bug/infrastruktur;
- error perlu terlihat di model.

Jangan gunakan BPMN error untuk:

- database down;
- timeout sementara;
- serialization bug;
- worker crash;
- missing config;
- programming error.

---

## 8. Escalation Event

Escalation event merepresentasikan situasi yang perlu perhatian atau penanganan di level lebih tinggi, tetapi tidak selalu error fatal.

Contoh:

```text
ReviewOverdue
HighRiskCaseDetected
SupervisorApprovalRequired
RepeatedSubmissionFailure
```

Perbedaan error vs escalation:

| Aspek | Error | Escalation |
|---|---|---|
| Makna | Ada kondisi salah/invalid yang dimodelkan | Ada kondisi yang perlu perhatian/naik level |
| Dampak | Sering mengubah path utama | Bisa interrupting atau non-interrupting |
| Contoh | Applicant not eligible | Review overdue |
| Tone bisnis | Failure/outcome negatif | Alert/exception management |

Contoh:

```text
[Officer Review]
  non-interrupting escalation after 3 days
  -> [Notify Supervisor]
```

Officer review tetap bisa lanjut, tetapi supervisor diberi tahu.

Escalation cocok untuk case management dan regulatory workflow karena banyak proses tidak langsung gagal, tetapi perlu naik level.

---

## 9. Signal Event

Signal adalah broadcast.

Jika message targeted, signal lebih seperti:

```text
Hei semua process instance yang menunggu signal X, signal X terjadi.
```

Contoh penggunaan:

```text
PolicyChanged
SystemMaintenanceStarted
AgencyClosureDeclared
```

Tetapi signal harus hati-hati.

Karena broadcast bisa punya efek luas dan sulit dikontrol.

Pertanyaan sebelum memakai signal:

1. Apakah semua process instance harus tahu event ini?
2. Apakah event ini memang broadcast?
3. Bagaimana menghindari impact yang tidak diinginkan?
4. Apakah message targeted lebih aman?
5. Bagaimana audit-nya?
6. Apakah replay signal dibutuhkan?

Dalam banyak sistem enterprise, message/event targeted lebih aman daripada signal global.

---

## 10. Conditional Event

Conditional event menunggu kondisi tertentu menjadi true.

Contoh:

```text
Wait until riskScore > 80
Wait until all documents received
Wait until outstandingFee == 0
```

Conditional event bisa terlihat menarik, tetapi harus hati-hati.

Jika kondisi bergantung pada external domain state, lebih aman untuk explicit event/message:

```text
DocumentService publishes DocumentsCompleted
Process catches DocumentsCompleted message
```

Daripada:

```text
Process silently waits until documentsCompleted == true
```

Kenapa?

Karena explicit event lebih jelas:

- siapa producer;
- kapan terjadi;
- payload apa;
- correlation key apa;
- retry/replay bagaimana;
- audit-nya bagaimana.

Conditional event cocok jika kondisi adalah bagian dari process variable yang jelas dikelola oleh engine/application.

---

## 11. Compensation Event

Compensation event dipakai untuk membatalkan atau mengimbangi pekerjaan bisnis yang sudah dilakukan.

Compensation bukan rollback database.

Rollback terjadi dalam transaksi teknis singkat.

Compensation terjadi dalam bisnis nyata setelah side effect sudah terjadi.

Contoh:

```text
Payment captured -> later order cancelled -> refund payment
Certificate issued -> later application revoked -> revoke certificate
Notification sent -> later correction needed -> send correction notice
External record created -> later process failed -> mark external record cancelled
```

### 11.1 Compensation Mental Model

```text
Action sudah terjadi.
Dunia luar sudah berubah.
Kita tidak bisa pura-pura action itu tidak pernah terjadi.
Kita membuat action baru yang mengoreksi dampaknya.
```

### 11.2 Compensation Design Questions

1. Apa side effect yang sudah terjadi?
2. Apakah side effect reversible?
3. Apakah reversal punya aturan bisnis?
4. Apakah compensation idempotent?
5. Apakah compensation bisa gagal?
6. Apakah compensation butuh approval manusia?
7. Apakah compensation perlu audit reason?
8. Apakah compensation mengirim notifikasi?
9. Apakah external system mendukung reversal?
10. Apakah reversal legal/regulatory valid?

Compensation adalah topik besar dan akan dibahas lebih dalam di bagian saga.

---

## 12. Activity: “Sesuatu Dikerjakan”

Activity adalah pekerjaan yang dilakukan dalam proses.

Activity bisa berupa:

1. task;
2. subprocess;
3. call activity.

Activity menjawab:

```text
Apa yang harus dilakukan saat token sampai di sini?
```

Activity bisa:

- langsung selesai;
- menunggu external worker;
- menunggu manusia;
- menjalankan subprocess;
- memanggil process lain;
- menghasilkan failure;
- menghasilkan variables;
- memicu event.

---

## 13. Task

Task adalah unit kerja atomik dari sudut pandang BPMN.

“Atomik” di sini bukan berarti ACID transaction. Maksudnya: BPMN tidak membuka detail internal task tersebut di diagram utama.

Contoh:

```text
[Validate Applicant]
[Generate Certificate]
[Send Email]
[Review Application]
[Calculate Risk]
```

Jenis task umum:

| Task | Arti |
|---|---|
| Service Task | Pekerjaan otomatis oleh sistem/worker |
| User Task | Pekerjaan oleh manusia |
| Manual Task | Pekerjaan manual di luar sistem |
| Business Rule Task | Evaluasi decision/rule |
| Script Task | Script dijalankan engine/runtime |
| Send Task | Mengirim message |
| Receive Task | Menunggu message |
| Call Activity | Memanggil process lain |

---

## 14. Service Task

Service task merepresentasikan pekerjaan otomatis.

Di Camunda 8, service task umumnya menghasilkan job yang diambil oleh worker berdasarkan job type.

Contoh:

```text
[Validate Documents]
[Call Payment Gateway]
[Generate PDF]
[Sync to External Registry]
[Send Notification]
```

### 14.1 Service Task Runtime Mental Model

```text
Token arrives at service task.
Engine creates job.
Worker activates job.
Worker executes code.
Worker completes/fails/throws BPMN error.
If completed, token continues.
If failed, retry/incident handling applies.
If BPMN error thrown, modeled error path applies.
```

### 14.2 Service Task Design Rule

A service task should usually map to a meaningful business operation, not a tiny technical line of code.

Bad:

```text
[Parse JSON] -> [Map DTO] -> [Call Repository] -> [Set Status] -> [Return Response]
```

Better:

```text
[Validate Application Submission]
```

Internal Java code may parse JSON, map DTO, call repository, and set status, but BPMN should not become code-level flowchart.

### 14.3 Service Task Granularity

Too coarse:

```text
[Process Application]
```

Problem:

- hides business decisions;
- hides audit points;
- hides failure location;
- hard to operate.

Too fine:

```text
[Read Applicant]
-> [Read Documents]
-> [Check Document Count]
-> [Check Postal Code]
-> [Check Name]
-> [Check Date]
```

Problem:

- BPMN becomes code;
- too many jobs;
- too much operational noise;
- hard to change.

Healthy:

```text
[Perform Completeness Check]
-> [Calculate Risk Category]
-> [Assign Review Route]
```

Each task represents a meaningful process step.

### 14.4 Service Task Contract

Every service task should have a clear contract:

```text
Task name:
Job type:
Input variables:
Output variables:
Business side effects:
Idempotency key:
Retry policy:
BPMN errors:
Technical failure handling:
Timeout expectation:
Observability fields:
Owner service:
```

Example:

```text
Task name: Generate Certificate Draft
Job type: certificate.generate-draft.v1
Input:
  applicationId
  applicantId
  licenseCategory
  approvedAt
Output:
  certificateDraftId
  documentRef
Business side effect:
  stores draft PDF metadata in document service
Idempotency key:
  processInstanceKey + elementInstanceKey
BPMN errors:
  CertificateTemplateNotConfigured
Technical failures:
  DocumentServiceUnavailable, StorageTimeout
Retry:
  3 attempts, exponential backoff
```

---

## 15. User Task

User task merepresentasikan pekerjaan manusia.

Contoh:

```text
[Review Application]
[Approve Appeal]
[Provide Clarification]
[Supervisor Endorsement]
[Legal Officer Assessment]
```

User task adalah wait state.

Runtime behavior:

```text
Token arrives at user task.
Task is created for human actor/group.
Process waits.
Human completes task through UI/API.
Variables may be submitted.
Token continues.
```

### 15.1 User Task Is Not Just “Status”

Bad design:

```text
[Pending Review]
```

Sebagai user task tanpa action jelas.

Better:

```text
[Review Application Completeness]
[Assess Eligibility]
[Approve Rejection Letter]
```

User task harus merepresentasikan **work to be done**, bukan hanya status.

### 15.2 Good User Task Has Decision Contract

Untuk setiap user task, harus jelas:

1. siapa yang boleh melihat task;
2. siapa yang boleh claim;
3. siapa yang boleh complete;
4. action apa yang tersedia;
5. fields apa yang wajib;
6. variables apa yang dihasilkan;
7. audit reason apa yang diperlukan;
8. SLA berapa lama;
9. apa yang terjadi jika overdue;
10. apa yang terjadi jika reassigned;
11. apa yang terjadi jika process cancelled;
12. apakah task bisa delegated;
13. apakah maker-checker rule berlaku.

Example:

```text
User Task: Assess Eligibility
Candidate group: licensing-officer
Actions:
  - recommendApprove
  - recommendReject
  - requestMoreInfo
Required fields:
  - assessmentOutcome
  - assessmentReason
  - checklistVersion
  - assessedAt
Output variables:
  - eligibilityAssessment.outcome
  - eligibilityAssessment.reasonCode
  - eligibilityAssessment.officerUserId
  - eligibilityAssessment.completedAt
SLA:
  5 working days
Escalation:
  non-interrupting reminder at day 3
  interrupting escalation at day 7
```

### 15.3 User Task and Authorization

BPMN assignment is not enough for enterprise authorization.

Example:

```text
candidateGroup = senior-officer
```

This does not automatically solve:

- field-level permission;
- case ownership;
- conflict of interest;
- maker-checker separation;
- agency boundary;
- regional office boundary;
- confidentiality classification;
- impersonation/auditing;
- delegated authority.

Pattern:

```text
BPMN handles task lifecycle.
Domain authorization service decides whether user may perform action.
Task UI calls backend.
Backend validates authorization before completing task.
```

Jangan percaya hanya pada UI filtering.

---

## 16. Manual Task

Manual task merepresentasikan pekerjaan manual yang tidak dikelola oleh sistem.

Contoh:

```text
[Conduct Physical Inspection]
[Call Applicant by Phone]
[Verify Original Document at Counter]
```

Manual task biasanya tidak dieksekusi oleh engine.

Namun dalam executable workflow, manual task sering kurang berguna jika tidak ada mekanisme completion.

Jika pekerjaan manusia perlu dilacak, SLA dihitung, dan audit disimpan, gunakan user task atau custom external task pattern.

Manual task cocok sebagai dokumentasi proses, bukan selalu sebagai runtime element.

---

## 17. Business Rule Task

Business rule task merepresentasikan evaluasi decision/rule.

Biasanya terhubung dengan DMN atau decision service.

Contoh:

```text
[Determine Risk Category]
[Evaluate Eligibility]
[Calculate Required Approval Level]
[Determine SLA]
```

### 17.1 BPMN vs DMN Responsibility

BPMN menjawab:

```text
Urutan prosesnya apa?
```

DMN/rule menjawab:

```text
Keputusan bisnisnya apa berdasarkan input tertentu?
```

Bad:

```text
Exclusive gateway dengan 20 kondisi kompleks tersebar di BPMN.
```

Better:

```text
[Evaluate Application Eligibility] as business rule task
  -> returns eligibilityResult
Gateway only routes based on eligibilityResult.outcome
```

### 17.2 Rule Evaluation Contract

Business rule task harus punya:

- decision id;
- decision version/policy version;
- input variables;
- output variables;
- hit policy;
- fallback behavior;
- audit trace;
- owner policy;
- effective date.

Dalam regulatory systems, decision version sangat penting.

Pertanyaan audit:

```text
At the time this case was assessed, which rule version was used?
What input values were used?
Which rule matched?
Who approved the rule configuration?
```

---

## 18. Script Task

Script task menjalankan script dalam process engine/runtime.

Script task bisa praktis, tetapi sering berbahaya untuk production-grade systems.

Risiko:

- logic tersembunyi di BPMN XML;
- sulit ditest seperti Java code;
- sulit direview;
- sulit diobservasi;
- bisa berbeda behavior antar runtime;
- bisa menjadi tempat business logic liar;
- security concern.

Gunakan script task hanya untuk transformasi kecil yang aman, atau hindari jika standar engineering menuntut logic berada di codebase Java yang versioned, tested, reviewed, dan observable.

Pattern lebih sehat:

```text
[Map Submission to Case Data] as service task
```

Daripada script panjang di BPMN.

---

## 19. Send Task dan Receive Task

### 19.1 Send Task

Send task merepresentasikan pengiriman message.

Contoh:

```text
[Send Approval Notification]
```

Tetapi dalam banyak engine modern, send task bisa direalisasikan sebagai service task yang memanggil notification service atau message publisher.

Yang penting adalah semantic-nya:

```text
Proses mengirim sesuatu ke pihak lain.
```

### 19.2 Receive Task

Receive task menunggu message.

Contoh:

```text
[Wait for Payment Confirmation]
```

Namun secara modeling, intermediate message catch event sering lebih ekspresif.

Perbandingan:

```text
Receive Task: Wait for Payment Confirmation
Intermediate Message Event: PaymentReceived
```

Event biasanya lebih jelas ketika yang terjadi adalah event eksternal.

Receive task bisa dipakai jika organisasi ingin menggambarkan “aktivitas menerima” sebagai task.

---

## 20. Gateway: Decision, Branching, and Synchronization

Gateway mengontrol aliran token.

Gateway bukan tempat utama business logic.

Gateway sebaiknya membaca hasil decision, bukan melakukan decision kompleks secara tersembunyi.

Jenis gateway utama:

| Gateway | Fungsi |
|---|---|
| Exclusive Gateway | Pilih satu path |
| Parallel Gateway | Jalankan semua path / tunggu semua path |
| Inclusive Gateway | Pilih satu atau lebih path / tunggu path aktif |
| Event-based Gateway | Pilih berdasarkan event yang terjadi pertama |
| Complex Gateway | Logic sinkronisasi kompleks, jarang disarankan |

---

## 21. Exclusive Gateway

Exclusive gateway memilih satu path.

Simbol umum: diamond dengan X atau kosong.

Contoh:

```text
[Evaluate Eligibility]
  -> <Eligible?>
      yes -> [Continue Review]
      no  -> [Reject Application]
```

Runtime behavior:

```text
Token masuk.
Engine mengevaluasi outgoing sequence flow conditions.
Satu path dipilih.
Token lanjut ke path itu.
```

### 21.1 Exclusive Gateway Rule

Exclusive gateway harus punya kondisi yang:

1. mutually exclusive;
2. collectively complete;
3. punya default path jika perlu;
4. mudah dibaca;
5. berdasarkan variable yang jelas.

Bad:

```text
if applicant.age > 18 && application.type == 'A' && risk.score < 50 && officer.role != null && ...
```

Better:

```text
[Determine Eligibility Outcome]
  -> eligibilityOutcome = APPROVED | REJECTED | MORE_INFO_REQUIRED

Gateway:
  APPROVED -> ...
  REJECTED -> ...
  MORE_INFO_REQUIRED -> ...
```

### 21.2 Common Exclusive Gateway Bug

Tidak ada condition yang match.

Akibat:

- process stuck;
- incident;
- unexpected failure;
- silent wrong route jika default salah.

Checklist:

```text
For every possible decision output, is there a path?
Is there a default path?
Should default path be error handling or manual review?
```

---

## 22. Parallel Gateway

Parallel gateway menjalankan semua path paralel atau menunggu semua path selesai.

Contoh split:

```text
          -> [Check Documents] ->
[Start] --                       --> [Join] -> [Continue]
          -> [Check Payment]   ->
```

Runtime behavior split:

```text
One token enters.
Multiple tokens are created.
All outgoing paths run.
```

Runtime behavior join:

```text
Gateway waits until all expected incoming tokens arrive.
Then one token continues.
```

### 22.1 Parallel Gateway Use Cases

Cocok untuk:

- independent checks;
- parallel approvals;
- parallel notifications;
- document generation + external sync;
- independent agency review.

### 22.2 Parallel Gateway Danger: Deadlock

Jika join menunggu token yang tidak pernah datang, process stuck.

Bad pattern:

```text
Parallel split into A and B.
Path B has condition that may skip.
Parallel join still waits for B.
```

Jika path conditional, mungkin inclusive gateway lebih cocok.

### 22.3 Parallel Does Not Mean Unlimited Technical Concurrency

BPMN parallel berarti logical parallelism.

Tetapi engineering harus mempertimbangkan:

- worker capacity;
- external API rate limit;
- database lock;
- transaction conflict;
- order dependency;
- idempotency;
- failure isolation.

Jangan hanya karena BPMN bisa parallel, semua proses dibuat fan-out besar.

---

## 23. Inclusive Gateway

Inclusive gateway memilih satu atau lebih path berdasarkan condition.

Contoh:

```text
[Assess Required Reviews]
  -> <Which reviews required?>
      legal required      -> [Legal Review]
      finance required    -> [Finance Review]
      technical required  -> [Technical Review]
  -> inclusive join
```

Runtime behavior:

```text
One token enters.
Engine evaluates all outgoing conditions.
One or more paths may be activated.
Join waits only for activated paths.
```

### 23.1 Inclusive Gateway Use Cases

Cocok untuk:

- dynamic review routing;
- optional approval path;
- multi-agency process;
- conditionally required checks;
- risk-based branching.

### 23.2 Inclusive Gateway Complexity

Inclusive gateway lebih sulit dari exclusive/parallel.

Risiko:

- sulit dipahami business user;
- join behavior membingungkan;
- condition overlap;
- path activation tidak jelas;
- testing combinatorial explosion.

Jika jumlah kombinasi besar, pertimbangkan:

```text
[Determine Required Reviews]
  -> multi-instance over requiredReviewTypes
```

Daripada banyak branch inclusive.

---

## 24. Event-based Gateway

Event-based gateway memilih path berdasarkan event yang terjadi pertama.

Contoh:

```text
[Send Request for Information]
  -> <Wait for one of events>
      ApplicantResponded -> [Review Response]
      DeadlineExpired    -> [Close as No Response]
      ApplicantWithdrawn -> [Cancel Application]
```

Runtime behavior:

```text
Token arrives at event-based gateway.
Process waits for multiple possible events.
The first event that happens wins.
Other event subscriptions are cancelled.
```

### 24.1 Use Cases

Cocok untuk race antar event bisnis:

- applicant responds vs deadline expires;
- payment received vs payment expired;
- external approval received vs timeout;
- cancellation received vs process continues.

### 24.2 Event-based Gateway vs Exclusive Gateway

Exclusive gateway memilih berdasarkan data yang sudah ada.

Event-based gateway memilih berdasarkan event masa depan yang belum terjadi.

```text
Exclusive:
  We already know the answer.

Event-based:
  We wait to see what happens first.
```

### 24.3 Common Mistake

Menggunakan exclusive gateway untuk sesuatu yang sebenarnya belum diketahui.

Bad:

```text
<Applicant will respond?>
  yes -> wait response
  no -> close
```

Proses tidak bisa tahu masa depan.

Better:

```text
Event-based gateway:
  ApplicantResponded message
  ResponseDeadline timer
```

---

## 25. Complex Gateway

Complex gateway dipakai untuk behavior branching/join yang kompleks.

Dalam practice, complex gateway jarang direkomendasikan karena:

- sulit dipahami;
- sulit dites;
- sulit dimonitor;
- engine support bisa berbeda;
- business user sulit melakukan review;
- behavior-nya tidak obvious.

Jika butuh complex gateway, sering kali model perlu direstrukturisasi.

Alternatif:

- DMN untuk decision;
- multi-instance dengan completion condition;
- subprocess;
- explicit state tracking;
- domain service untuk aggregation logic;
- split process into clearer units.

Top 1% habit:

```text
If the gateway is too complex to explain in one paragraph,
move the decision into a tested decision component or remodel the process.
```

---

## 26. Sequence Flow

Sequence flow menghubungkan elemen dalam satu process/pool.

Sequence flow menunjukkan urutan token bergerak.

```text
[Task A] -> [Task B] -> [Task C]
```

Sequence flow bisa punya condition.

```text
<Eligibility?>
  [eligible] -> [Continue]
  [not eligible] -> [Reject]
```

### 26.1 Sequence Flow Is Control Flow

Sequence flow bukan data flow.

Jangan menganggap arrow berarti data dikirim seperti API call.

Arrow berarti token bergerak.

Data dibawa sebagai process variables atau mapping, tergantung engine.

### 26.2 Conditional Sequence Flow

Conditional sequence flow harus sederhana.

Bad:

```text
${applicant != null && applicant.age >= 21 && risk.score < 70 && docs.every(d -> d.valid) && ...}
```

Better:

```text
${eligibilityOutcome == "ELIGIBLE"}
```

Decision logic berada di task sebelumnya.

---

## 27. Message Flow

Message flow menunjukkan komunikasi antar participant/pool.

Message flow tidak sama dengan sequence flow.

Sequence flow:

```text
within one process
```

Message flow:

```text
between participants/processes/systems
```

Contoh:

```text
Applicant Pool --message--> Agency Process Pool
Payment Gateway Pool --message--> Licensing Process Pool
```

Dalam executable BPMN, message flow sering menjadi dokumentasi collaboration, sedangkan runtime correlation diatur lewat message events/API.

Engineering concern:

```text
Message flow in diagram must correspond to actual integration contract.
```

Kalau diagram berkata ada message dari Payment Gateway, harus ada:

- endpoint/topic;
- schema;
- auth;
- correlation key;
- retry;
- duplicate handling;
- audit;
- ownership.

---

## 28. Association

Association menghubungkan annotation/data artifact dengan elemen BPMN.

Association tidak menggerakkan token.

Contoh:

```text
[Assess Application] --- annotation: "Officer must check policy version effective at submission date"
```

Association berguna untuk komunikasi, tetapi jangan bergantung pada annotation untuk runtime behavior.

Jika sesuatu penting untuk execution, modelkan sebagai BPMN behavior atau implementasi code.

---

## 29. Subprocess

Subprocess adalah activity yang berisi flow internal.

Subprocess membantu mengelompokkan detail.

Jenis penting:

1. embedded subprocess;
2. event subprocess;
3. call activity;
4. transaction subprocess;
5. ad-hoc subprocess.

---

## 30. Embedded Subprocess

Embedded subprocess berada di dalam process yang sama.

Contoh:

```text
+--------------------------------+
| Subprocess: Perform Assessment |
|                                |
| [Check Documents]              |
| -> [Calculate Risk]            |
| -> [Officer Review]            |
+--------------------------------+
```

Runtime:

```text
Token enters subprocess.
Internal flow executes.
When subprocess completes, token exits.
```

### 30.1 Use Cases

Cocok untuk:

- mengurangi clutter diagram utama;
- mengelompokkan steps yang punya boundary event sama;
- membuat scope untuk error handling;
- membuat scope untuk compensation;
- memperjelas phase proses.

Contoh phase:

```text
[Submission Intake]
[Assessment]
[Approval]
[Issuance]
[Closure]
```

Masing-masing bisa jadi embedded subprocess.

### 30.2 Boundary Event on Subprocess

Subprocess sangat berguna karena bisa ditempeli boundary event.

Contoh:

```text
Subprocess: Assessment Phase
  boundary timer: assessment SLA exceeded
  -> Escalate Assessment

Subprocess: Assessment Phase
  boundary error: fatal assessment rejection
  -> Reject Application
```

Artinya semua activity di dalam assessment phase berbagi exception handling yang sama.

### 30.3 Embedded Subprocess Anti-pattern

Bad:

```text
Subprocess: Do Everything
```

Jika subprocess terlalu besar, ia hanya menyembunyikan kompleksitas.

Good subprocess punya boundary konseptual:

```text
Perform Completeness Check
Conduct Risk Assessment
Obtain Multi-party Approval
Issue Final Decision
```

---

## 31. Event Subprocess

Event subprocess dipicu oleh event.

Ia berada dalam process atau subprocess scope.

Contoh:

```text
Main process:
  [Review Application] -> [Approve] -> [Issue]

Event subprocess:
  Start Event: ApplicantWithdrawn
  -> [Cancel Application]
  -> [Notify Officer]
```

Event subprocess bisa interrupting atau non-interrupting.

### 31.1 Interrupting Event Subprocess

Jika event terjadi, main scope dihentikan.

Cocok untuk:

- cancellation;
- withdrawal;
- fatal business event;
- process replaced;
- agency closes case.

Contoh:

```text
ApplicantWithdrawn interrupts entire process.
```

### 31.2 Non-interrupting Event Subprocess

Jika event terjadi, main process tetap berjalan dan subprocess tambahan dijalankan.

Cocok untuk:

- add note;
- notify supervisor;
- receive supplementary document;
- update contextual data;
- handle side event.

### 31.3 Event Subprocess vs Boundary Event

Boundary event melekat pada activity tertentu.

Event subprocess berlaku untuk scope lebih luas.

```text
Boundary event:
  While this task/subprocess is active, handle event.

Event subprocess:
  While this scope is active, handle event.
```

Gunakan event subprocess jika event bisa terjadi di banyak titik dalam fase proses.

Contoh:

```text
Applicant can withdraw application anytime before final issuance.
```

Daripada memasang boundary withdrawal pada setiap task, lebih baik event subprocess di scope yang tepat.

---

## 32. Call Activity

Call activity memanggil process lain.

Contoh:

```text
[Application Process]
  -> Call Activity: [Run Payment Collection Process]
  -> [Continue]
```

Call activity dipakai untuk process reuse.

### 32.1 Use Cases

Cocok untuk:

- reusable approval process;
- reusable payment process;
- reusable document generation process;
- reusable notification process;
- reusable compliance screening process.

### 32.2 Embedded Subprocess vs Call Activity

| Aspek | Embedded Subprocess | Call Activity |
|---|---|---|
| Lokasi | Di dalam process yang sama | Process definition lain |
| Reuse | Rendah | Tinggi |
| Versioning | Ikut process parent | Punya version sendiri |
| Debugging | Lebih lokal | Perlu trace parent-child |
| Contract | Internal | Harus eksplisit |
| Cocok untuk | Grouping detail | Reusable business process |

### 32.3 Call Activity Contract

Call activity harus punya contract yang jelas:

```text
Called process id:
Version binding:
Input variables:
Output variables:
Business errors:
Escalations:
Cancellation behavior:
Timeout behavior:
Ownership:
SLA:
```

Tanpa contract, call activity menjadi hidden coupling.

### 32.4 Versioning Risk

Jika parent process memanggil latest version dari child process, perilaku parent bisa berubah tanpa parent redeploy.

Jika parent mengikat fixed version, bug fix child process mungkin tidak otomatis dipakai.

Tidak ada jawaban universal.

Guideline:

```text
Use fixed version for high-risk regulated flows.
Use latest/version tag carefully for low-risk reusable utility flows.
Make version binding explicit.
```

---

## 33. Transaction Subprocess

Transaction subprocess merepresentasikan aktivitas yang perlu diperlakukan sebagai transaksi bisnis.

Dalam BPMN, transaction subprocess berkaitan dengan cancel/compensation semantics.

Namun jangan salah paham:

```text
BPMN transaction subprocess bukan database transaction ACID multi-system.
```

Ia lebih cocok untuk modeling business transaction yang punya compensation/cancel behavior.

Contoh:

```text
Book appointment
Reserve payment
Generate booking reference
If transaction cancelled -> release reservation
```

Dalam distributed systems modern, konsep saga biasanya lebih practical daripada berharap transaction subprocess menyelesaikan distributed transaction.

---

## 34. Ad-hoc Subprocess

Ad-hoc subprocess merepresentasikan sekumpulan aktivitas yang urutannya tidak sepenuhnya ditentukan.

Cocok untuk knowledge work/case management:

```text
During investigation, officer may perform:
  - request document
  - call applicant
  - consult legal
  - perform site visit
  - add case note
  - request supervisor input
```

Tidak semua case mengikuti urutan sama.

Ad-hoc subprocess berguna untuk proses yang lebih fleksibel.

Tetapi harus dijaga agar tidak menjadi “anything goes”.

Governance tetap perlu:

- allowed actions;
- authorization;
- audit;
- completion condition;
- mandatory checks;
- SLA;
- case status consistency.

---

## 35. Multi-instance Activity

Multi-instance bukan gateway, tetapi sangat penting.

Multi-instance menjalankan activity untuk banyak item.

Contoh:

```text
For each required document -> [Verify Document]
For each agency -> [Agency Review]
For each committee member -> [Collect Vote]
```

Jenis:

1. sequential multi-instance;
2. parallel multi-instance.

### 35.1 Sequential Multi-instance

```text
Verify document 1
then document 2
then document 3
```

Cocok jika:

- order penting;
- resource terbatas;
- external system rate limited;
- result sebelumnya memengaruhi berikutnya.

### 35.2 Parallel Multi-instance

```text
Verify all documents in parallel
```

Cocok jika:

- setiap item independent;
- worker capacity cukup;
- external dependency kuat;
- result aggregation jelas.

### 35.3 Completion Condition

Multi-instance bisa selesai sebelum semua instance selesai jika completion condition terpenuhi.

Contoh:

```text
Committee vote: stop when 3 approvals reached.
```

Atau:

```text
Reject immediately when one mandatory reviewer rejects.
```

Hati-hati: partial completion punya audit dan cancellation consequence.

Pertanyaan:

- Apa yang terjadi pada task lain yang belum selesai?
- Apakah mereka dicancel?
- Apakah user diberi tahu?
- Apakah result partial valid?
- Apakah audit menyimpan vote yang belum masuk?

---

## 36. Pool dan Lane

Pool merepresentasikan participant.

Lane merepresentasikan role/unit dalam participant.

Contoh:

```text
Pool: Applicant
Pool: Licensing Agency
Pool: Payment Provider

Lane inside Licensing Agency:
  Intake Officer
  Assessment Officer
  Supervisor
  Legal Officer
```

### 36.1 Pool

Pool bagus untuk collaboration diagram.

Message flow antar pool menunjukkan komunikasi antar participant.

Dalam executable process, biasanya satu pool adalah process yang dijalankan oleh engine.

Pool lain bisa external participant yang tidak dieksekusi oleh engine.

### 36.2 Lane

Lane membantu menunjukkan responsibility.

Tetapi lane tidak boleh dianggap otomatis sebagai authorization.

Jika task berada di lane “Supervisor”, engine belum tentu otomatis membatasi task hanya untuk supervisor kecuali assignment/authorization diimplementasikan.

Rule:

```text
Lane is communication.
Assignment is runtime metadata.
Authorization is application/security logic.
```

---

## 37. Data Objects, Data Store, and Process Variables

BPMN punya data object dan data store sebagai modeling artifact.

Camunda/engine runtime biasanya memakai process variables sebagai data runtime.

Jangan samakan:

```text
Data object in diagram != automatically good variable design.
```

### 37.1 Data Object

Data object menunjukkan informasi yang dipakai/dihasilkan activity.

Contoh:

```text
Application Form
Assessment Report
Decision Letter
Payment Receipt
```

### 37.2 Data Store

Data store menunjukkan tempat data disimpan.

Contoh:

```text
Case Database
Document Repository
Audit Store
Payment Ledger
```

### 37.3 Process Variable

Process variable adalah runtime data yang dibawa process instance.

Guideline:

```text
Store only what process needs to route, wait, decide, correlate, and audit minimally.
Do not store full domain aggregate blindly.
Do not store large document payload.
Do not store secrets.
Do not store PII unless necessary and governed.
```

---

## 38. Element Selection: Which BPMN Element Should I Use?

### 38.1 Human Work

Gunakan user task jika:

```text
Ada manusia yang harus mengambil action, dan action itu perlu dilacak.
```

Jangan gunakan service task untuk pura-pura human action.

### 38.2 System Work

Gunakan service task jika:

```text
Sistem/worker melakukan pekerjaan otomatis.
```

Pastikan worker idempotent.

### 38.3 Business Decision

Gunakan business rule task/DMN jika:

```text
Keputusan bisnis cukup kompleks, sering berubah, atau perlu audit rule.
```

Gateway hanya routing berdasarkan hasil.

### 38.4 One of Many Branches

Gunakan exclusive gateway jika:

```text
Hanya satu path boleh dipilih, dan data keputusan sudah tersedia.
```

### 38.5 All Branches

Gunakan parallel gateway jika:

```text
Semua path harus berjalan.
```

### 38.6 Some Branches

Gunakan inclusive gateway jika:

```text
Satu atau lebih path bisa berjalan berdasarkan condition.
```

### 38.7 Wait for Future Event

Gunakan event-based gateway jika:

```text
Proses menunggu salah satu dari beberapa event masa depan.
```

### 38.8 Timeout on Task

Gunakan boundary timer jika:

```text
Task/subprocess punya batas waktu.
```

### 38.9 Event Can Happen Anytime in Scope

Gunakan event subprocess jika:

```text
Event bisa terjadi di banyak titik dalam process/subprocess scope.
```

### 38.10 Reusable Process

Gunakan call activity jika:

```text
Ada process reusable dengan lifecycle dan contract sendiri.
```

---

## 39. Regulatory Case Management Example

Kita ambil contoh regulatory licensing application.

### 39.1 Bad Model

```text
[Submit]
 -> [Review]
 -> [Approve?]
    yes -> [Issue]
    no  -> [Reject]
 -> [End]
```

Masalah:

- tidak jelas siapa review;
- tidak jelas completeness vs eligibility vs risk;
- tidak ada timeout;
- tidak ada request more info;
- tidak ada withdrawal;
- tidak ada audit reason;
- tidak ada external checks;
- tidak ada maker-checker;
- tidak ada error path;
- tidak ada SLA;
- tidak ada compensation;
- tidak ada integration boundary.

### 39.2 Better Model

```text
(None Start: Application Submitted)
  -> [Create Case Record]                         service task
  -> [Perform Completeness Check]                 service/business rule task
  -> <Complete?>                                  exclusive gateway
       no  -> [Request More Information]          user/service task
              -> <Wait applicant response or deadline> event-based gateway
                    ApplicantResponded -> [Perform Completeness Check]
                    DeadlineExpired    -> [Close as Incomplete]
       yes -> [Determine Risk Category]           business rule task
              -> <Risk Route>                     exclusive gateway
                    low    -> [Officer Assessment] user task
                    medium -> [Senior Officer Assessment] user task
                    high   -> [Multi-agency Review] subprocess/multi-instance
  -> [Supervisor Approval]                        user task
  -> <Approved?>                                  exclusive gateway
       yes -> [Generate Certificate]              service task
              -> [Notify Applicant]              service task/message
              -> (End: Issued)
       no  -> [Generate Rejection Letter]         service task
              -> [Notify Applicant]              service task/message
              -> (End: Rejected)

Event subprocess within active application scope:
  Message Start: ApplicantWithdrawn
    -> [Cancel Open Tasks]
    -> [Record Withdrawal]
    -> [Notify Officer]
    -> (Terminate End)
```

Lebih baik karena:

- business phases terlihat;
- human work eksplisit;
- event eksternal eksplisit;
- timeout bisa dimodelkan;
- routing berbasis decision;
- high-risk flow bisa dipisah;
- withdrawal bisa terjadi lintas scope;
- audit point jelas;
- system task punya boundary;
- process outcome jelas.

---

## 40. BPMN Element Smells

### 40.1 Gateway Smells

| Smell | Masalah | Perbaikan |
|---|---|---|
| Gateway condition terlalu panjang | Business logic tersembunyi | Pindahkan ke DMN/service task |
| Banyak nested gateway | Sulit dibaca/test | Refactor subprocess/decision task |
| No default path | Risk incident | Tambahkan default/manual review/error path |
| Parallel join setelah conditional path | Deadlock risk | Pakai inclusive join atau remodel |
| Complex gateway | Sulit dipahami | Pakai explicit model/DMN/multi-instance |

### 40.2 Task Smells

| Smell | Masalah | Perbaikan |
|---|---|---|
| Task bernama `Process Data` | Tidak bermakna | Gunakan nama business operation |
| Task terlalu teknis | BPMN jadi code flowchart | Naikkan level abstraksi |
| Task terlalu besar | Failure/audit tidak jelas | Pecah per business milestone |
| User task bernama status | Tidak ada action | Ubah menjadi action-oriented task |
| Script task panjang | Logic tidak governed | Pindah ke Java service/worker |

### 40.3 Event Smells

| Smell | Masalah | Perbaikan |
|---|---|---|
| Timer di banyak tempat | Timer explosion | Centralize SLA calculation/event subprocess |
| Message tanpa correlation key jelas | Correlation failure | Definisikan business key |
| Signal dipakai untuk targeted event | Broadcast risk | Pakai message event |
| Error untuk technical exception | Wrong recovery semantics | Gunakan retry/incident |
| Terminate event sembarangan | Cabang penting mati | Pakai explicit cancellation model |

### 40.4 Subprocess Smells

| Smell | Masalah | Perbaikan |
|---|---|---|
| `Do Everything` subprocess | Menyembunyikan kompleksitas | Pecah phase |
| Call activity tanpa contract | Hidden coupling | Definisikan input/output/error/version |
| Nested subprocess terlalu dalam | Debugging sulit | Flatten atau split process |
| Reusable process terlalu generic | Tidak ada ownership jelas | Buat process spesifik per capability |

---

## 41. Mapping BPMN Elements to Java Engineering

### 41.1 Service Task to Java Worker

```text
BPMN Service Task
  -> job type
  -> Java worker handler
  -> domain service call
  -> idempotency check
  -> output variables
  -> complete/fail/throw error
```

Pseudo-design:

```java
public final class GenerateCertificateWorker {
    public void handle(Job job) {
        // 1. Read variables
        // 2. Validate contract
        // 3. Create idempotency key
        // 4. Check if already processed
        // 5. Call domain service
        // 6. Persist side effect safely
        // 7. Complete job with minimal variables
        // 8. On business rejection, throw BPMN error
        // 9. On technical failure, fail job for retry
    }
}
```

The important thing is not the syntax. The important thing is the contract.

### 41.2 User Task to Java Backend

```text
BPMN User Task
  -> task visible in Tasklist/custom UI
  -> user opens case screen
  -> backend loads domain data
  -> user submits action
  -> backend validates authorization/business rules
  -> backend completes task through engine API
  -> process continues
```

Do not let frontend complete user tasks directly without backend authorization in serious enterprise systems.

### 41.3 Gateway to Java/DMN Decision Output

```text
Java/DMN calculates:
  eligibilityOutcome = ELIGIBLE | NOT_ELIGIBLE | MORE_INFO_REQUIRED

Gateway routes:
  eligibilityOutcome == ELIGIBLE -> continue
  eligibilityOutcome == NOT_ELIGIBLE -> reject
  eligibilityOutcome == MORE_INFO_REQUIRED -> request info
```

Gateway should not become a second hidden rule engine.

### 41.4 Timer to Domain SLA Service

```text
Java SLA service calculates dueAt.
BPMN timer waits until dueAt.
```

This keeps calendar complexity testable in Java.

### 41.5 Message Event to Integration Layer

```text
External event received
  -> validate schema/auth
  -> deduplicate
  -> map to process message
  -> publish/correlate to engine
  -> audit inbound message
```

Do not let raw external payload directly mutate process variables without validation.

---

## 42. Java 8–25 Considerations

BPMN concepts are language-independent, tetapi Java runtime choice memengaruhi worker architecture.

### 42.1 Java 8

Jika masih ada Java 8:

- hindari library modern yang butuh Java 17+;
- worker mungkin berjalan di Spring Boot lama;
- HTTP client memakai OkHttp/Apache HttpClient;
- concurrency masih thread pool klasik;
- observability harus dipasang manual;
- TLS/cert compatibility harus dicek;
- Camunda 8 client compatibility harus diperiksa sesuai versi library.

Strategy:

```text
Keep Java 8 systems behind adapter service if direct modern Camunda client is not feasible.
```

### 42.2 Java 11/17

Java 11/17 sering jadi baseline enterprise.

Cocok untuk:

- Spring Boot 2/3 boundary;
- mature worker service;
- standard observability;
- reliable HTTP/gRPC client;
- container runtime stability.

### 42.3 Java 21/25

Java 21/25 membuka opsi:

- virtual threads;
- structured concurrency;
- better GC/runtime behavior;
- modern TLS/security;
- newer Spring Boot compatibility;
- improved container ergonomics.

Tetapi virtual threads tidak otomatis membuat workflow system aman.

Tetap perlu:

- rate limiting;
- backpressure;
- idempotency;
- external dependency protection;
- bounded concurrency;
- graceful shutdown.

Rule:

```text
Virtual threads improve blocking efficiency.
They do not remove business concurrency constraints.
```

---

## 43. Element-by-Element Production Checklist

### 43.1 Start Event Checklist

```text
[ ] What starts this process?
[ ] Who/what is allowed to start it?
[ ] Is start idempotent?
[ ] What is the business key?
[ ] Can duplicate start happen?
[ ] What variables are required at start?
[ ] What audit record is created?
[ ] What version of process is used?
```

### 43.2 Service Task Checklist

```text
[ ] What job type maps to this task?
[ ] What worker owns it?
[ ] What input variables are required?
[ ] What output variables are produced?
[ ] Is worker idempotent?
[ ] What side effects happen?
[ ] What technical failures are retried?
[ ] What business errors are modeled?
[ ] What timeout applies?
[ ] What metrics/logs/traces exist?
```

### 43.3 User Task Checklist

```text
[ ] Who can see it?
[ ] Who can claim it?
[ ] Who can complete it?
[ ] What actions are allowed?
[ ] What fields are mandatory?
[ ] What audit reason is required?
[ ] What SLA applies?
[ ] What happens if overdue?
[ ] Can it be reassigned/delegated?
[ ] Is maker-checker required?
```

### 43.4 Gateway Checklist

```text
[ ] Is gateway decision already known at this point?
[ ] Are conditions simple?
[ ] Are paths mutually exclusive if exclusive gateway?
[ ] Are all cases covered?
[ ] Is there a default path?
[ ] Could this be better as DMN?
[ ] Could this gateway deadlock?
[ ] Are conditions testable?
```

### 43.5 Message Event Checklist

```text
[ ] What is the message name?
[ ] Who publishes it?
[ ] Who consumes it?
[ ] What is the correlation key?
[ ] What happens if duplicate?
[ ] What happens if no process is waiting?
[ ] What is TTL?
[ ] What is schema version?
[ ] Is inbound message authenticated?
[ ] Is inbound message audited?
```

### 43.6 Timer Checklist

```text
[ ] Is this calendar time or business time?
[ ] Which timezone applies?
[ ] Are holidays excluded?
[ ] Who calculates due date?
[ ] Can timer be changed after creation?
[ ] What happens after timeout?
[ ] Is timeout interrupting or non-interrupting?
[ ] What happens to open tasks?
[ ] How many timers can exist at peak?
```

### 43.7 Subprocess Checklist

```text
[ ] What business phase does this subprocess represent?
[ ] Does it reduce complexity or hide it?
[ ] What boundary events apply?
[ ] What variables enter/exit?
[ ] What errors can propagate?
[ ] Is it reusable? If yes, should it be call activity?
[ ] What is its completion condition?
```

---

## 44. Practical Design Exercise

Assume a regulatory agency has this process:

```text
Applicant submits application.
System checks completeness.
If incomplete, applicant has 14 days to submit missing documents.
If applicant does not respond, application is closed.
If complete, officer reviews.
High-risk applications need legal review and supervisor approval.
Applicant can withdraw anytime before final decision.
If approved, certificate is generated and applicant is notified.
If rejected, rejection letter is generated and applicant is notified.
```

### 44.1 Identify Elements

| Requirement | BPMN Element |
|---|---|
| Applicant submits application | None/message start event |
| System checks completeness | Service task/business rule task |
| If incomplete | Exclusive gateway |
| Applicant has 14 days | Event-based gateway or boundary timer |
| Applicant submits documents | Message catch event |
| No response | Timer event |
| Officer reviews | User task |
| High-risk needs legal review | Exclusive gateway + subprocess/user task |
| Legal and supervisor approval | Parallel/inclusive/multi-instance depending rule |
| Applicant can withdraw anytime | Event subprocess |
| Approved | Gateway path |
| Generate certificate | Service task |
| Notify applicant | Service task/message event |
| Rejected | Gateway path |
| Generate rejection letter | Service task |

### 44.2 Candidate Model

```text
Start: ApplicationSubmitted
  -> Service Task: Create Case
  -> Service Task: Check Completeness
  -> Gateway: Is Complete?
       No:
         -> Service Task: Request Missing Documents
         -> Event-based Gateway:
              Message: MissingDocumentsSubmitted -> Check Completeness
              Timer: 14 days -> Service Task: Close as Incomplete -> End
       Yes:
         -> Business Rule Task: Determine Risk Category
         -> Gateway: High Risk?
              No:
                -> User Task: Officer Review
              Yes:
                -> Subprocess: High Risk Assessment
                     -> User Task: Officer Review
                     -> Parallel:
                          -> User Task: Legal Review
                          -> User Task: Supervisor Approval
                     -> Join
         -> Gateway: Decision?
              Approved:
                -> Service Task: Generate Certificate
                -> Service Task: Notify Approval
                -> End: Issued
              Rejected:
                -> Service Task: Generate Rejection Letter
                -> Service Task: Notify Rejection
                -> End: Rejected

Event Subprocess in main process scope:
  Message Start: ApplicantWithdrawn
    -> Service Task: Record Withdrawal
    -> Service Task: Notify Internal Parties
    -> Terminate End
```

### 44.3 Design Questions

This model is still not finished. A senior engineer asks:

1. Is `ApplicationSubmitted` a none start from our backend or message start from external portal?
2. What is the business key?
3. What happens if applicant submits missing documents after deadline?
4. Is 14 days calendar or working days?
5. Can officer review be reassigned?
6. What if legal review rejects but supervisor approves?
7. Is legal review mandatory for all high-risk categories or only some?
8. Does withdrawal require officer acknowledgement?
9. Can withdrawal happen after certificate generation but before notification?
10. What compensation is needed if certificate generated but process later cancelled?
11. What variables are stored in engine vs domain DB?
12. What audit trail proves decision reason?
13. What happens if notification service fails?
14. What happens if document service is down?
15. What process version applies to applications submitted before policy change?

That is the difference between drawing BPMN and engineering BPMN.

---

## 45. Mental Model Summary

BPMN core elements can be summarized like this:

```text
Event:
  Something happens.

Task:
  Something is done.

Gateway:
  Flow branches or synchronizes.

Subprocess:
  A smaller process is grouped inside a larger process.

Call Activity:
  Another process is invoked.

Boundary Event:
  Something can happen while an activity is active.

Event Subprocess:
  Something can happen while a scope is active.

Sequence Flow:
  Token moves within the same process.

Message Flow:
  Participants communicate.
```

But production-grade understanding is deeper:

```text
Event = trigger/wait/interrupt/throw contract.
Task = work contract.
Gateway = routing/synchronization contract.
Subprocess = scoping/abstraction/error boundary contract.
Message = integration/correlation contract.
Timer = time/SLA contract.
User task = human responsibility/audit contract.
Service task = worker/idempotency/retry contract.
```

---

## 46. Top 1% Takeaways

1. BPMN elements are not decorations. Each element changes runtime behavior.
2. User task means human wait state, not status label.
3. Service task means external/system work with reliability contract.
4. Gateway should route, not hide complex policy logic.
5. Timer is easy to draw but hard to operate correctly.
6. Message event without correlation strategy is incomplete design.
7. Boundary event is one of the most important tools for real exception handling.
8. Event subprocess is powerful for cross-cutting events like cancellation/withdrawal.
9. Subprocess should express meaningful phase/scope, not hide chaos.
10. Call activity creates reuse, but also versioning and coupling concerns.
11. Error event is for business errors, not infrastructure failure.
12. Compensation is business correction, not database rollback.
13. Parallelism in BPMN is logical; production concurrency still needs control.
14. Good BPMN is understandable by business, executable by engine, testable by developer, and explainable to auditor.
15. The right question is not “which BPMN shape should I use?” but “what runtime contract am I creating?”

---

## 47. Referensi Utama

Referensi ini berguna untuk validasi lanjutan:

1. OMG BPMN 2.0 / 2.0.2 specification materials.
2. Camunda BPMN reference.
3. Camunda 8 documentation for BPMN elements, workflow patterns, user tasks, event subprocesses, and task testing.
4. Camunda 8 Java Client documentation.

Gunakan dokumentasi resmi untuk memeriksa support detail per versi engine, karena tidak semua elemen BPMN punya tingkat support yang sama di semua engine/version.

---

## 48. Status Seri

Selesai sejauh ini:

- Part 0 — Orientation: Dari CRUD Engineer ke Process Orchestration Engineer
- Part 1 — BPMN 2.0 Deep Semantics: Bukan Diagram, Tapi Execution Contract
- Part 2 — BPMN Core Elements: Events, Tasks, Gateways, Subprocesses

Belum selesai.

Berikutnya:

- Part 3 — BPMN Modeling Discipline: Membuat Process Model yang Bisa Hidup di Production

