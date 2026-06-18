# learn-java-bpmn-camunda-process-orchestration-engineering
# Part 1 — BPMN 2.0 Deep Semantics: Bukan Diagram, Tapi Execution Contract

> Status seri: **Part 1 dari 30**  
> Prasyarat: Part 0 — Orientation: Dari CRUD Engineer ke Process Orchestration Engineer  
> Target pembaca: Java engineer yang sudah kuat di backend, persistence, reliability, deployment, messaging, dan ingin naik ke process orchestration engineering.

---

## 0. Tujuan Part Ini

Pada Part 0 kita sudah membangun orientasi: BPMN dan Camunda bukan sekadar tool untuk menggambar flow approval. BPMN adalah cara membuat **business process menjadi explicit, executable, observable, dan governable**.

Part ini masuk lebih dalam ke inti BPMN:

> BPMN bukan hanya diagram. BPMN adalah **kontrak eksekusi**.

Artinya, saat kita menggambar start event, task, gateway, event, dan end event, kita sebenarnya sedang mendefinisikan:

1. kapan process instance dimulai,
2. bagaimana token bergerak,
3. kapan proses menunggu,
4. kapan proses bercabang,
5. kapan proses bergabung,
6. kapan proses gagal,
7. kapan proses selesai,
8. event apa yang bisa mengubah jalur proses,
9. data apa yang tersedia di setiap tahap,
10. dan apa yang harus dilakukan engine saat runtime.

BPMN 2.0 adalah standard dari OMG untuk Business Process Model and Notation. OMG menyediakan dokumen spesifikasi BPMN 2.0 dan BPMN 2.0.2 sebagai standard formal; Camunda menyediakan dokumentasi praktis untuk elemen BPMN yang dapat dieksekusi di Camunda 8. Referensi resmi penting: OMG BPMN specification, BPMN 2.0.2, Camunda BPMN primer, Camunda BPMN coverage, Camunda events, dan Camunda workflow patterns.  
Sumber utama: OMG BPMN 2.0 specification, OMG BPMN 2.0.2, Camunda BPMN primer, Camunda BPMN coverage, Camunda BPMN events, Camunda workflow patterns.  

Catatan versi: implementasi runtime tidak selalu mendukung seluruh elemen BPMN standard. Camunda 8 documentation secara eksplisit membedakan elemen yang didukung untuk modeling dan elemen yang didukung untuk execution. Jadi mental model yang benar adalah:

```text
BPMN standard
  != semua engine mendukung semua element
  != semua element cocok dipakai di production
  != semua diagram valid adalah diagram yang baik
```

---

## 1. Problem Utama: Banyak Engineer Mengira BPMN Itu Flowchart

Kesalahan paling awal adalah menyamakan BPMN dengan flowchart.

Flowchart biasanya menjawab:

```text
Apa urutan langkahnya?
```

BPMN executable menjawab:

```text
Apa yang terjadi pada process instance saat runtime?
Siapa atau apa yang sedang menunggu?
Event apa yang bisa melanjutkan proses?
Data apa yang menentukan jalur?
Apa yang terjadi kalau ada timeout, error, cancel, compensation, atau parallel path?
```

Perbedaan ini besar.

Contoh flowchart sederhana:

```text
Receive Application -> Review -> Approve? -> Issue License / Reject
```

Sebagai flowchart, itu cukup.

Sebagai BPMN executable, itu belum cukup. Kita harus tahu:

1. apakah `Receive Application` start event atau service task?
2. apakah `Review` user task atau service task?
3. siapa assignee/candidate group-nya?
4. apakah approval decision disimpan sebagai process variable?
5. apakah `Approve?` exclusive gateway?
6. apa default flow jika data approval kosong?
7. apakah `Issue License` idempotent?
8. bagaimana kalau service `Issue License` gagal?
9. apakah rejection mengirim email?
10. apakah ada SLA review?
11. apakah ada escalation kalau review tidak selesai 5 hari?
12. apakah proses bisa dicancel oleh applicant?
13. apakah proses bisa reopened?
14. apakah ada audit trail untuk alasan approve/reject?

BPMN yang production-grade harus menjawab pertanyaan tersebut.

---

## 2. Mental Model Paling Penting: Token Flow

BPMN dieksekusi dengan mental model **token**.

Token bukan token security, bukan JWT, bukan OAuth token.

Token di BPMN adalah konsep eksekusi:

> Token merepresentasikan posisi aktif dari sebuah process instance di dalam model BPMN.

Bayangkan process instance seperti case hidup. Token adalah “titik hidup” yang sedang bergerak di diagram.

Contoh:

```text
(Start) -> [Validate Application] -> [Review Application] -> (End)
```

Saat process instance dibuat:

```text
Token berada di Start Event
```

Lalu token bergerak:

```text
Start Event
  -> Validate Application
  -> Review Application
  -> End Event
```

Kalau task bersifat synchronous/instant dari sudut pandang engine, token bisa langsung lanjut.

Kalau task adalah wait state, token berhenti sampai ada event/command yang melanjutkan.

---

## 3. Token Flow Bukan Sekadar Urutan Langkah

Token flow mengandung beberapa konsekuensi:

### 3.1 Process Instance Bisa Memiliki Banyak Token

Saat parallel gateway melakukan split, satu process instance bisa punya lebih dari satu token aktif.

```text
                  -> [Check Documents] ->
(Start) -> + split                     + join -> [Finalize] -> (End)
                  -> [Check Payment]  ->
```

Setelah parallel split:

```text
Process Instance A
  token 1: Check Documents
  token 2: Check Payment
```

Artinya satu case bisa punya beberapa pekerjaan aktif secara bersamaan.

### 3.2 Token Bisa Menunggu

Contoh user task:

```text
(Start) -> [Officer Review] -> (End)
```

Saat token masuk `Officer Review`, engine membuat task untuk user. Token berhenti di situ sampai task completed.

```text
Process Instance A
  active token: Officer Review
  wait state: yes
  waiting for: human task completion
```

### 3.3 Token Bisa Dibatalkan

Interrupting boundary event dapat membatalkan activity yang sedang aktif.

```text
(Start) -> [Wait for Payment] -> [Issue Receipt] -> (End)
                |
             timer 7 days
                v
           [Cancel Application] -> (End)
```

Jika timer boundary bersifat interrupting:

```text
Token di Wait for Payment dibatalkan
Token pindah ke Cancel Application
```

### 3.4 Token Bisa Melahirkan Jalur Tambahan Tanpa Membatalkan Jalur Utama

Non-interrupting boundary event bisa membuat token tambahan, tetapi activity utama tetap aktif.

```text
(Start) -> [Officer Review] -> [Decision] -> (End)
                |
        non-interrupting timer 3 days
                v
          [Send Reminder]
```

Setelah 3 hari:

```text
Token utama masih di Officer Review
Token tambahan menjalankan Send Reminder
```

### 3.5 Token Bisa Mati

Token berakhir saat mencapai end event. Process instance selesai jika tidak ada lagi token aktif.

```text
Token count == 0 => process instance completed
```

Kecuali ada semantics khusus seperti terminate end event yang membunuh seluruh token dalam scope tertentu.

---

## 4. Execution Contract: Apa yang Dimaksud “Kontrak Eksekusi”?

BPMN sebagai kontrak eksekusi berarti diagram mendefinisikan aturan runtime.

Contoh:

```text
[Review Application] -> <Approved?> -> [Issue License]
                           |
                           v
                       [Reject Application]
```

Kalau gateway `Approved?` punya expression:

```text
= approvalDecision = "APPROVED"
```

maka kontraknya adalah:

```text
Jika process variable approvalDecision bernilai APPROVED,
token harus masuk ke Issue License.
```

Jika expression lain:

```text
= approvalDecision = "REJECTED"
```

maka token masuk ke Reject Application.

Jika tidak ada expression yang match dan tidak ada default flow, process bisa gagal runtime.

Ini bukan hanya visual. Ini kontrak.

---

## 5. BPMN Harus Dibaca dalam 4 Layer

Satu diagram BPMN yang baik dapat dibaca minimal dalam 4 layer.

### 5.1 Business Layer

Pertanyaan:

```text
Apa proses bisnisnya?
Siapa melakukan apa?
Keputusan bisnis apa yang diambil?
Apa outcome-nya?
```

Contoh:

```text
Applicant submits application.
Officer reviews application.
Supervisor approves.
System issues license.
```

### 5.2 Execution Layer

Pertanyaan:

```text
Apa yang dilakukan engine?
Kapan token wait?
Kapan job dibuat?
Kapan task created?
Kapan message ditunggu?
Kapan timer scheduled?
```

### 5.3 Integration Layer

Pertanyaan:

```text
Worker apa yang dipanggil?
External system apa yang disentuh?
Apakah call idempotent?
Apa retry policy-nya?
Apa side effect-nya?
```

### 5.4 Governance Layer

Pertanyaan:

```text
Apa yang bisa diaudit?
Siapa bertanggung jawab?
Apa alasan keputusan?
Apa SLA-nya?
Bagaimana repair dilakukan?
Bagaimana menjelaskan case ini 2 tahun lagi?
```

Top 1% engineer tidak hanya membaca BPMN dari business layer. Mereka membaca keempat layer sekaligus.

---

## 6. Core Runtime Concepts

Sebelum mempelajari elemen BPMN satu per satu, kita harus memahami istilah runtime utama.

### 6.1 Process Definition

Process definition adalah model BPMN yang sudah dideploy ke engine.

```text
BPMN file
  -> deploy
  -> process definition version
```

Contoh:

```text
license-application-process:v1
license-application-process:v2
license-application-process:v3
```

Process definition adalah blueprint.

### 6.2 Process Instance

Process instance adalah satu eksekusi konkret dari process definition.

Contoh:

```text
Process definition: license-application-process:v3
Process instance: Application A-2026-000123
```

Kalau ada 10.000 application, maka bisa ada 10.000 process instance.

### 6.3 Element Instance

Element instance adalah instance runtime dari satu BPMN element.

Misalnya:

```text
Process instance A masuk ke user task Officer Review.
Maka ada element instance untuk Officer Review.
```

Ini penting untuk observability, debugging, dan correlation.

### 6.4 Job

Dalam Camunda 8, service task biasanya menghasilkan job yang diambil oleh worker.

```text
Token enters service task
  -> engine creates job
  -> worker activates job
  -> worker executes logic
  -> worker completes/fails job
  -> token continues or incident created
```

### 6.5 User Task

User task adalah pekerjaan manusia.

```text
Token enters user task
  -> task created
  -> human sees task
  -> human claims/completes task
  -> token continues
```

### 6.6 Variable

Variable adalah data runtime process.

Contoh:

```json
{
  "applicationId": "APP-001",
  "riskLevel": "HIGH",
  "approvalDecision": "APPROVED"
}
```

Variable mempengaruhi routing, assignment, expression, worker input, dan output.

### 6.7 Incident

Incident adalah kondisi runtime yang membuat process instance tidak bisa melanjutkan tanpa intervensi/perbaikan.

Contoh:

```text
Service task gagal setelah semua retry habis.
Expression gateway error karena variable tidak ada.
Message correlation salah.
Worker melempar error teknis terus menerus.
```

Incident bukan sama dengan business rejection. Incident adalah operational failure.

---

## 7. BPMN Element Groups

BPMN memiliki banyak elemen, tetapi secara mental kita bisa kelompokkan menjadi beberapa kategori besar.

```text
BPMN Elements
├── Events
│   ├── Start Event
│   ├── Intermediate Event
│   └── End Event
├── Activities
│   ├── Task
│   ├── Subprocess
│   └── Call Activity
├── Gateways
│   ├── Exclusive
│   ├── Parallel
│   ├── Inclusive
│   └── Event-based
├── Flows
│   ├── Sequence Flow
│   ├── Message Flow
│   └── Association
├── Data
│   ├── Variables
│   ├── Data Object
│   └── Data Store
└── Collaboration
    ├── Pool
    ├── Lane
    └── Participant
```

Untuk executable BPMN, yang paling penting pada awalnya:

1. events,
2. tasks,
3. gateways,
4. subprocesses,
5. sequence flow,
6. variables.

---

## 8. Sequence Flow: Jalan yang Dilalui Token

Sequence flow adalah garis yang menghubungkan satu BPMN element ke element lain.

```text
(Start) -> [Validate] -> [Review] -> (End)
```

Sequence flow menentukan jalur token dalam satu process/pool.

### 8.1 Sequence Flow Bukan Message Flow

Sequence flow berarti:

```text
Token dalam process yang sama bergerak dari A ke B.
```

Message flow berarti:

```text
Ada komunikasi antar participant/pool.
```

Kesalahan umum:

```text
Menggunakan sequence flow antar dua organisasi/sistem berbeda.
```

Dalam BPMN collaboration, antar participant seharusnya menggunakan message flow, bukan sequence flow.

### 8.2 Conditional Sequence Flow

Sequence flow keluar dari gateway biasanya punya condition.

Contoh:

```text
<Approved?>
  -- approvalDecision = APPROVED --> [Issue License]
  -- approvalDecision = REJECTED --> [Reject Application]
```

Expression harus diperlakukan sebagai production code.

Artinya:

1. harus jelas,
2. harus testable,
3. harus punya default behavior,
4. harus robust terhadap null/missing variable,
5. tidak boleh terlalu kompleks.

### 8.3 Default Flow

Default flow adalah fallback jika tidak ada condition yang cocok.

```text
<Decision?>
  -- approved --> [Approve]
  -- rejected --> [Reject]
  -- default --> [Manual Review]
```

Dalam production, default flow sering menjadi safety net.

Tetapi default flow juga bisa menyembunyikan data error kalau dipakai sembarangan.

Rule praktis:

```text
Gunakan default flow hanya jika fallback itu memang business-valid.
Jangan gunakan default flow untuk menyembunyikan invalid state.
```

---

## 9. Events: “Something Happens”

Event merepresentasikan sesuatu yang terjadi.

Dalam BPMN, event bukan task. Event bukan pekerjaan. Event adalah kejadian.

Contoh event:

```text
Application submitted
Payment received
Timer expired
Message received
Error occurred
Case cancelled
Review completed
```

Camunda documentation menjelaskan event sebagai sesuatu yang terjadi; process dapat bereaksi terhadap event catching atau mengeluarkan event throwing. Catching message event, misalnya, membuat token melanjutkan saat message diterima sesuai criteria di XML process model.

### 9.1 Catching vs Throwing Event

Catching event:

```text
Process menunggu sesuatu terjadi.
```

Throwing event:

```text
Process menyatakan/mengirim sesuatu terjadi.
```

Contoh:

```text
Intermediate message catch event:
  process waits for PaymentReceived message

Intermediate message throw event:
  process emits NotificationRequested message
```

### 9.2 Start Event

Start event menentukan bagaimana process instance dimulai.

Contoh:

```text
None start event
Message start event
Timer start event
```

None start event biasanya berarti process dimulai oleh API command.

Message start event berarti process dimulai karena message tertentu diterima.

Timer start event berarti process dimulai berdasarkan jadwal.

### 9.3 Intermediate Event

Intermediate event terjadi di tengah proses.

Contoh:

```text
Wait for payment confirmation
Wait until 7 days
Wait for external agency response
Send message to another process
```

### 9.4 Boundary Event

Boundary event ditempel pada activity.

Mental model:

```text
Selama activity ini aktif, event ini boleh terjadi.
Jika terjadi, jalankan behavior boundary event.
```

Contoh:

```text
[Wait for Payment]
   boundary timer: 7 days
```

Artinya:

```text
Selama Wait for Payment aktif,
kalau 7 hari lewat,
jalur timeout dijalankan.
```

Boundary event bisa:

1. interrupting,
2. non-interrupting.

### 9.5 End Event

End event menandai akhir token path.

Tapi ada beberapa jenis end event:

1. none end,
2. terminate end,
3. error end,
4. message end,
5. escalation end,
6. compensation end.

End event bukan selalu “process selesai normal”.

---

## 10. Activity: Work Happens Here

Activity adalah sesuatu yang dilakukan.

Jenis activity paling umum:

```text
Task
Subprocess
Call Activity
```

Task adalah unit kerja atomic dari perspektif BPMN.

Subprocess adalah kumpulan langkah di dalam process.

Call activity memanggil process lain.

---

## 11. Task Semantics

Task bukan sekadar kotak.

Task menjawab:

```text
Siapa/apa yang mengerjakan?
Apakah engine menunggu?
Apakah task menghasilkan job?
Apakah manusia harus complete task?
Apakah ada side effect?
Apakah task idempotent?
Apa input/output-nya?
```

### 11.1 Service Task

Service task berarti pekerjaan otomatis.

Dalam Camunda 8, service task biasanya terkait job worker.

Contoh:

```text
[Validate Application]
[Generate PDF]
[Call Payment API]
[Send Email]
[Sync to External System]
```

Mental model runtime:

```text
Token enters service task
  -> engine creates job of type X
  -> worker activates job
  -> worker executes Java code
  -> worker completes job with variables
  -> token continues
```

### 11.2 User Task

User task berarti pekerjaan manusia.

Contoh:

```text
[Officer Review]
[Supervisor Approval]
[Applicant Resubmission]
```

Mental model runtime:

```text
Token enters user task
  -> task appears in tasklist/custom UI
  -> assigned/candidate group resolved
  -> human completes task
  -> variables submitted
  -> token continues
```

### 11.3 Business Rule Task

Business rule task mengevaluasi decision.

Contoh:

```text
[Determine Risk Level]
[Calculate Required Approval Level]
[Determine SLA Category]
```

Biasanya dipadukan dengan DMN.

### 11.4 Script Task

Script task menjalankan script.

Di production, script task harus sangat hati-hati.

Rule praktis:

```text
Gunakan script task untuk transformasi kecil dan aman.
Jangan masukkan business logic besar ke script task.
```

### 11.5 Receive Task

Receive task menunggu message.

Namun intermediate message catch event sering lebih eksplisit untuk modeling event-driven wait.

### 11.6 Send Task

Send task mengirim sesuatu.

Namun di architecture modern, send task sering direpresentasikan sebagai service task yang worker-nya mengirim message/email/API call agar reliability dan observability bisa dikontrol.

---

## 12. Gateway: Routing Token, Bukan “Business Decision” Itu Sendiri

Gateway mengontrol aliran token.

Gateway bukan tempat ideal untuk menyimpan decision logic yang kompleks.

Gateway seharusnya menjawab:

```text
Berdasarkan hasil keputusan/data yang sudah tersedia,
jalur mana yang diambil token?
```

Decision logic kompleks sebaiknya berada di:

1. domain service,
2. DMN decision table,
3. rules engine,
4. explicit previous task.

Gateway hanya routing.

---

## 13. Exclusive Gateway: Satu Jalur Dipilih

Exclusive gateway memilih satu jalur.

```text
<Is application complete?>
  -- yes --> [Review Application]
  -- no  --> [Request Missing Documents]
```

Mental model:

```text
Evaluate outgoing conditions in defined order/engine semantics.
Take one matching path.
```

Best practice:

1. nama gateway berupa pertanyaan,
2. outgoing flow berupa jawaban,
3. condition simple,
4. sediakan fallback jika business-valid,
5. jangan nested terlalu dalam.

Contoh baik:

```text
Gateway: Is application complete?
Flow 1: Yes
Flow 2: No
```

Contoh buruk:

```text
Gateway: Check
Flow 1: x == true && y != null && z.size() > 3 && status != "A"
Flow 2: else
```

Masalahnya bukan expression-nya saja, tetapi hilangnya business readability.

---

## 14. Parallel Gateway: Semua Jalur Berjalan

Parallel gateway melakukan AND-split atau AND-join.

```text
                  -> [Review Documents] ->
(Start) -> + split                      + join -> [Finalize]
                  -> [Check Payment]   ->
```

Pada split:

```text
1 token masuk
N token keluar
```

Pada join:

```text
N token harus datang
baru 1 token keluar
```

### 14.1 Bahaya Parallel Join

Parallel join bisa deadlock jika tidak semua token akan sampai.

Contoh buruk:

```text
(Start) -> <Need extra review?>
             yes -> [Extra Review] -> + join -> [Finalize]
             no  -----------------> + join
```

Jika join mengharapkan token dari jalur yang tidak pernah dibuat, process bisa stuck tergantung model.

Rule praktis:

```text
Gunakan parallel join hanya untuk join token yang pasti dibuat oleh parallel split yang sama atau struktur yang benar-benar terkontrol.
```

---

## 15. Inclusive Gateway: Beberapa Jalur Dipilih Berdasarkan Kondisi

Inclusive gateway memilih satu atau lebih jalur.

Contoh:

```text
<Which checks are required?>
  -- need document check --> [Document Check]
  -- need payment check  --> [Payment Check]
  -- need risk check     --> [Risk Check]
```

Jika semua true, semua berjalan.

Jika hanya satu true, satu berjalan.

Inclusive join harus menunggu jalur yang memang diaktifkan.

Inclusive gateway powerful tetapi lebih sulit dipahami dan diuji.

Rule praktis:

```text
Gunakan inclusive gateway hanya jika kebutuhan bisnis benar-benar N-of-M dynamic path.
Kalau semua jalur selalu berjalan, gunakan parallel gateway.
Kalau hanya satu jalur, gunakan exclusive gateway.
```

---

## 16. Event-based Gateway: Jalur Ditentukan Oleh Event yang Terjadi Lebih Dulu

Event-based gateway menunggu salah satu event.

Contoh:

```text
<Event race>
  -> message: PaymentReceived -> [Issue Receipt]
  -> timer: 7 days            -> [Cancel Application]
```

Mental model:

```text
Process menunggu beberapa kemungkinan event.
Event pertama yang terjadi menang.
Jalur lain dibatalkan.
```

Ini cocok untuk:

1. payment received vs timeout,
2. applicant response vs deadline,
3. external agency reply vs escalation timer,
4. cancellation request vs completion.

Event-based gateway adalah modeling tool yang sangat kuat untuk business race.

---

## 17. Subprocess Semantics

Subprocess adalah activity yang berisi flow internal.

Ada beberapa jenis:

1. embedded subprocess,
2. event subprocess,
3. call activity.

### 17.1 Embedded Subprocess

Embedded subprocess hidup di dalam process yang sama.

```text
[Review Application Subprocess]
  ├── Assign Officer
  ├── Officer Review
  └── Supervisor Approval
```

Cocok untuk:

1. grouping visual,
2. local scope,
3. boundary event di level group,
4. menyembunyikan detail tanpa membuat process baru.

### 17.2 Event Subprocess

Event subprocess dipicu oleh event di dalam scope tertentu.

Contoh:

```text
Main process berjalan.
Jika cancellation message diterima kapan pun dalam scope,
jalankan cancellation handler.
```

Cocok untuk cross-cutting event:

1. cancellation,
2. timeout,
3. escalation,
4. error handling,
5. applicant withdrawal.

### 17.3 Call Activity

Call activity memanggil process definition lain.

```text
Main Process
  -> [Call Approval Process]
  -> Continue
```

Cocok untuk reusable process.

Tetapi call activity menambah complexity:

1. version binding,
2. variable mapping,
3. parent-child lifecycle,
4. error propagation,
5. observability lintas process.

---

## 18. Wait State: Konsep Paling Kritis untuk Long-running Process

Wait state adalah titik saat engine menyimpan state dan proses berhenti sampai ada trigger berikutnya.

Contoh wait state:

1. user task,
2. receive task,
3. message catch event,
4. timer event,
5. service task job waiting for worker,
6. external task pattern,
7. async continuation pada engine tertentu.

Mental model:

```text
At wait state:
  process state persisted
  token does not move
  engine waits for command/event/time/worker
```

Ini yang membedakan workflow engine dari plain Java call stack.

Dalam Java biasa:

```java
submitApplication();
validate();
review();
approve();
issueLicense();
```

Kalau `review()` butuh 3 hari, Java thread tidak boleh menunggu 3 hari.

Workflow engine menyimpan state:

```text
Process instance persisted at Officer Review.
No Java thread blocked for 3 days.
When officer completes task, token continues.
```

Ini fundamental.

---

## 19. BPMN vs Java Call Stack

BPMN long-running process tidak sama dengan Java call stack.

Java call stack:

```text
method A calls method B calls method C
state lives in memory/stack/heap
execution duration: milliseconds/seconds/minutes
failure model: exception/transaction rollback
```

BPMN process:

```text
token moves across persisted wait states
state lives in engine + variables + domain DB
execution duration: seconds/days/months/years
failure model: retry/incident/error/escalation/compensation/manual repair
```

Karena itu, jangan berpikir:

```text
BPMN = visual Java method
```

Lebih tepat:

```text
BPMN = durable business state machine plus event routing plus work coordination
```

---

## 20. BPMN vs Database Status Column

Banyak sistem enterprise punya status seperti:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
PENDING_PAYMENT
APPROVED
REJECTED
CANCELLED
```

Lalu developer bertanya:

> Kalau sudah ada status column, kenapa perlu BPMN?

Jawabannya:

Status column hanya menyimpan state entity.

BPMN menyimpan:

1. state proses,
2. active work,
3. pending event,
4. timer,
5. parallel branches,
6. responsibility,
7. routing condition,
8. history path,
9. escalation rule,
10. operational incident.

Contoh:

```text
Status: UNDER_REVIEW
```

Tidak menjawab:

1. officer siapa yang sedang review?
2. apakah supervisor approval sudah paralel berjalan?
3. apakah payment check masih pending?
4. apakah SLA timer sudah aktif?
5. apakah reminder sudah dikirim?
6. apakah external agency response sedang ditunggu?
7. jalur apa yang membuat case masuk UNDER_REVIEW?
8. apakah ada incident di generate-document step?

BPMN menjawab itu dengan execution state.

Namun bukan berarti status column tidak perlu. Domain status tetap penting untuk query bisnis dan UX.

Arsitektur mature biasanya punya dua layer:

```text
BPMN process state
  = orchestration/runtime state

Domain entity state
  = business-readable aggregate state
```

Keduanya harus disinkronkan secara hati-hati.

---

## 21. BPMN XML: Diagram yang Bisa Dieksekusi

BPMN diagram biasanya disimpan sebagai XML.

Contoh minimal:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions
    xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Definitions_Application"
    targetNamespace="http://example.com/bpmn">

  <bpmn:process id="licenseApplicationProcess" isExecutable="true">

    <bpmn:startEvent id="StartEvent_ApplicationSubmitted" name="Application submitted">
      <bpmn:outgoing>Flow_Start_To_Validate</bpmn:outgoing>
    </bpmn:startEvent>

    <bpmn:serviceTask id="Task_ValidateApplication" name="Validate application">
      <bpmn:incoming>Flow_Start_To_Validate</bpmn:incoming>
      <bpmn:outgoing>Flow_Validate_To_Review</bpmn:outgoing>
    </bpmn:serviceTask>

    <bpmn:userTask id="Task_OfficerReview" name="Officer reviews application">
      <bpmn:incoming>Flow_Validate_To_Review</bpmn:incoming>
      <bpmn:outgoing>Flow_Review_To_End</bpmn:outgoing>
    </bpmn:userTask>

    <bpmn:endEvent id="EndEvent_Completed" name="Application processed">
      <bpmn:incoming>Flow_Review_To_End</bpmn:incoming>
    </bpmn:endEvent>

    <bpmn:sequenceFlow id="Flow_Start_To_Validate"
                       sourceRef="StartEvent_ApplicationSubmitted"
                       targetRef="Task_ValidateApplication" />

    <bpmn:sequenceFlow id="Flow_Validate_To_Review"
                       sourceRef="Task_ValidateApplication"
                       targetRef="Task_OfficerReview" />

    <bpmn:sequenceFlow id="Flow_Review_To_End"
                       sourceRef="Task_OfficerReview"
                       targetRef="EndEvent_Completed" />

  </bpmn:process>
</bpmn:definitions>
```

Beberapa poin penting:

1. `process id` adalah identifier process definition.
2. `isExecutable="true"` menunjukkan process dimaksudkan untuk execution.
3. setiap element punya `id` dan optional `name`.
4. `sequenceFlow` menghubungkan `sourceRef` ke `targetRef`.
5. diagram visual hanyalah representasi dari XML model.
6. engine membaca XML, bukan gambar PNG.

---

## 22. BPMN XML dengan Extension Elements

Engine seperti Camunda menambahkan extension element untuk kebutuhan execution.

Contoh konseptual service task Camunda 8:

```xml
<bpmn:serviceTask id="Task_GenerateDocument" name="Generate document">
  <bpmn:extensionElements>
    <zeebe:taskDefinition type="generate-document" />
  </bpmn:extensionElements>
  <bpmn:incoming>Flow_Previous</bpmn:incoming>
  <bpmn:outgoing>Flow_Next</bpmn:outgoing>
</bpmn:serviceTask>
```

Artinya:

```text
Saat token masuk service task ini,
engine membuat job dengan type generate-document.
Worker yang subscribe ke type itu akan mengeksekusi pekerjaan.
```

Extension element adalah jembatan antara BPMN standard dan runtime engine tertentu.

Konsekuensi:

```text
BPMN portable secara notasi,
tetapi executable semantics sering engine-specific.
```

---

## 23. Valid BPMN vs Executable BPMN vs Good BPMN

Tiga hal ini berbeda.

### 23.1 Valid BPMN

Valid BPMN berarti model sesuai syntax/metamodel BPMN.

Tetapi valid belum tentu bisa dieksekusi oleh engine tertentu.

### 23.2 Executable BPMN

Executable BPMN berarti engine bisa menjalankannya.

Tetapi executable belum tentu bagus.

### 23.3 Good BPMN

Good BPMN berarti:

1. business-readable,
2. executable,
3. testable,
4. operable,
5. auditable,
6. evolvable,
7. resilient,
8. tidak over-modeled,
9. tidak menyembunyikan failure,
10. cocok dengan domain.

Contoh:

```text
Valid BPMN:
  diagram syntax benar

Executable BPMN:
  bisa dideploy dan dijalankan

Good BPMN:
  2 tahun lagi auditor, developer, operator, dan business owner masih bisa memahami apa yang terjadi
```

---

## 24. Token Flow Walkthrough: Application Approval

Kita gunakan process sederhana:

```text
(Start: Application submitted)
  -> [Validate application]
  -> <Is complete?>
       yes -> [Officer review]
               -> <Approved?>
                    yes -> [Issue license] -> (End: License issued)
                    no  -> [Reject application] -> (End: Application rejected)
       no  -> [Request missing documents]
               -> (End: Waiting for resubmission)
```

### 24.1 Instance Dimulai

```text
Process instance: APP-001
Token: StartEvent_ApplicationSubmitted
Variables:
  applicationId = APP-001
```

### 24.2 Token Masuk Validate Application

```text
Token enters Task_ValidateApplication
Engine creates job: validate-application
Worker executes validation
Worker completes job with variables:
  isComplete = true
```

### 24.3 Token Masuk Gateway Is Complete?

```text
Gateway evaluates:
  isComplete = true
```

Token mengambil jalur `yes`.

### 24.4 Token Masuk Officer Review

```text
Token enters user task Officer Review
Task created for candidate group: officer
Process waits
```

Saat ini:

```text
No Java thread is blocked.
State is persisted.
Human work is pending.
```

### 24.5 Officer Complete Task

Officer submits:

```json
{
  "approvalDecision": "APPROVED",
  "reviewRemarks": "All requirements met"
}
```

Token lanjut ke gateway `Approved?`.

### 24.6 Gateway Approved?

```text
approvalDecision == APPROVED
```

Token masuk `Issue license`.

### 24.7 Issue License

```text
Engine creates job: issue-license
Worker calls license service
Worker completes job
Token moves to end event
```

### 24.8 Process Completed

```text
No active token remains.
Process instance completed.
```

---

## 25. Same Diagram, Different Runtime Meaning

Dua diagram bisa terlihat mirip tetapi runtime semantics berbeda.

### 25.1 Timer Boundary vs Timer Intermediate

Model A:

```text
[Officer Review]
   boundary timer 5 days -> [Escalate]
```

Artinya:

```text
Timer berjalan selama Officer Review aktif.
Kalau review selesai sebelum 5 hari, timer hilang.
```

Model B:

```text
[Officer Review] -> (Timer 5 days) -> [Escalate]
```

Artinya:

```text
Setelah Officer Review selesai,
process menunggu 5 hari,
baru escalate.
```

Visualnya sama-sama punya timer, tetapi semantics sangat berbeda.

### 25.2 Interrupting vs Non-interrupting Boundary

Interrupting:

```text
Timer terjadi -> activity utama dibatalkan
```

Non-interrupting:

```text
Timer terjadi -> jalur tambahan berjalan, activity utama tetap aktif
```

Ini sangat penting untuk SLA reminder.

Reminder biasanya non-interrupting.

Timeout final biasanya interrupting.

---

## 26. BPMN as Contract Between Roles

BPMN yang baik menjadi kontrak antara banyak role.

### 26.1 Business Owner

Mereka melihat:

```text
Apakah proses bisnis benar?
Apakah approval path benar?
Apakah escalation benar?
```

### 26.2 Developer

Developer melihat:

```text
Service task mana yang perlu worker?
Variable apa yang dibutuhkan?
External call apa yang terjadi?
```

### 26.3 QA

QA melihat:

```text
Scenario apa yang harus diuji?
Happy path apa?
Error path apa?
Timer path apa?
```

### 26.4 Operator

Operator melihat:

```text
Jika process stuck, di mana?
Jika incident, apa penyebabnya?
Retry atau repair apa yang aman?
```

### 26.5 Auditor

Auditor melihat:

```text
Siapa mengambil keputusan?
Kapan?
Berdasarkan data apa?
Apakah SLA dilanggar?
Apakah ada manual override?
```

Karena itu, BPMN tidak boleh dibuat hanya untuk developer.

---

## 27. Expression Semantics: Routing yang Bisa Menjadi Bug Besar

Gateway condition sering terlihat kecil, tetapi bisa menjadi sumber incident besar.

Contoh:

```text
= riskLevel = "HIGH"
```

Pertanyaan:

1. apakah `riskLevel` selalu ada?
2. apakah value uppercase?
3. apakah bisa `HIGH_RISK`?
4. apakah null akan error?
5. apakah ada default flow?
6. apakah value berasal dari DMN, user input, atau service task?
7. apakah contract-nya terdokumentasi?

Rule:

```text
Expression gateway harus sesederhana mungkin.
Semakin kompleks expression, semakin besar indikasi decision logic belum dimodelkan dengan benar.
```

Contoh yang lebih baik:

```text
[Determine risk category]
  -> sets riskCategory = LOW | MEDIUM | HIGH

<Risk category?>
  LOW    -> standard review
  MEDIUM -> supervisor review
  HIGH   -> committee review
```

Decision dibuat explicit sebelum gateway.

---

## 28. Event Semantics: Waiting Is a First-class Concept

Dalam backend biasa, waiting sering tersembunyi:

1. cron polling,
2. DB status check,
3. scheduler job,
4. retry queue,
5. manual support script.

Dalam BPMN, waiting harus explicit.

Contoh:

```text
[Send payment instruction]
  -> (Wait for PaymentReceived message)
  -> [Issue receipt]
```

Ini jauh lebih jelas daripada:

```text
status = PENDING_PAYMENT
cron checks payment table every 5 minutes
if payment found then update status
```

Bukan berarti cron salah. Tetapi kalau waiting adalah bagian dari business process, BPMN membuatnya visible.

---

## 29. BPMN dan Time

Time adalah first-class concern dalam process orchestration.

Contoh process tanpa time:

```text
Submit -> Review -> Approve -> End
```

Dalam real world:

```text
Submit
  -> Review within 5 working days
  -> Reminder after 3 days
  -> Escalate after 5 days
  -> Auto-close if applicant does not respond within 14 days
```

BPMN memungkinkan time dimodelkan eksplisit:

1. timer start event,
2. timer intermediate catch event,
3. timer boundary event,
4. event subprocess timer,
5. cycle timer.

Namun time juga kompleks:

1. timezone,
2. working day,
3. public holiday,
4. daylight saving time,
5. SLA pause/resume,
6. manual extension,
7. retrospective repair.

Karena itu, timer BPMN harus didesain dengan business calendar strategy.

---

## 30. Message Semantics: Correlation Is Everything

Message event membutuhkan correlation.

Contoh:

```text
Process waits for PaymentReceived.
```

Pertanyaan:

```text
PaymentReceived untuk process instance yang mana?
```

Jawabannya: correlation key.

Contoh:

```text
correlationKey = applicationId
```

Message:

```json
{
  "messageName": "PaymentReceived",
  "correlationKey": "APP-001",
  "variables": {
    "paymentReference": "PAY-987"
  }
}
```

Jika correlation key salah:

1. message tidak match,
2. message match process yang salah,
3. duplicate event terjadi,
4. process stuck,
5. audit kacau.

Rule:

```text
Correlation key adalah contract antar sistem.
Jangan treat sebagai detail teknis kecil.
```

---

## 31. Boundary Event Semantics: Exception Handling untuk Activity Scope

Boundary event menjawab:

```text
Apa yang harus terjadi jika event X terjadi saat activity Y masih aktif?
```

Contoh:

```text
[Applicant Resubmission]
   boundary timer 14 days -> [Close Application]
```

Artinya:

```text
Jika applicant tidak resubmit dalam 14 hari,
activity Applicant Resubmission dibatalkan,
dan process masuk Close Application.
```

Boundary event cocok untuk:

1. timeout,
2. cancellation,
3. error handling,
4. escalation,
5. compensation trigger,
6. message interruption.

Namun boundary event bisa membuat diagram sulit jika terlalu banyak.

Rule:

```text
Gunakan boundary event untuk event yang benar-benar melekat pada activity scope.
Gunakan event subprocess untuk event yang berlaku lintas banyak activity dalam scope lebih besar.
```

---

## 32. End Event Semantics: Tidak Semua End Sama

End event bisa punya semantics berbeda.

### 32.1 None End Event

Normal end.

```text
Application completed.
```

### 32.2 Terminate End Event

Mengakhiri semua token dalam scope.

Cocok untuk:

```text
Case cancelled, all parallel work must stop.
```

Bahaya:

```text
Bisa membunuh token lain yang masih punya work penting.
```

### 32.3 Error End Event

Melempar BPMN error ke boundary/error handler.

Cocok untuk business error dalam subprocess.

### 32.4 Message End Event

Mengirim message saat process/path selesai.

### 32.5 Escalation End Event

Menghasilkan escalation.

### 32.6 Compensation End Event

Menandai compensation behavior.

Rule:

```text
Pilih end event berdasarkan semantics, bukan karena “ingin selesai”.
```

---

## 33. Modeling “Happy Path” vs “Complete Runtime Path”

Diagram awal sering hanya happy path:

```text
Submit -> Review -> Approve -> Issue -> End
```

Production process butuh:

```text
Submit
  -> Validate
    -> incomplete -> request correction
    -> complete -> review
       -> timeout reminder
       -> escalation
       -> approve
       -> reject
       -> request more info
       -> applicant withdrawal
       -> system error
       -> manual repair
```

Namun jangan langsung menggambar semua exception di satu diagram besar.

Strategi yang baik:

1. model happy path dulu,
2. identifikasi wait state,
3. tambahkan business exception,
4. tambahkan timeout/SLA,
5. tambahkan technical failure handling,
6. refactor ke subprocess/call activity,
7. validasi readability.

---

## 34. BPMN Complexity Budget

Setiap BPMN model punya complexity budget.

Semakin banyak:

1. gateway,
2. boundary event,
3. parallel path,
4. inclusive join,
5. message event,
6. event subprocess,
7. compensation,
8. call activity,
9. variable mapping,
10. version binding,

semakin sulit model dipahami, diuji, dan dioperasikan.

Top engineer tidak bangga membuat diagram rumit.

Top engineer membuat complexity menjadi explicit, isolated, dan justified.

Rule:

```text
Jika diagram sulit dibaca, mungkin model terlalu besar atau abstraction level tercampur.
```

---

## 35. Diagram Abstraction Level

Satu diagram sebaiknya berada pada satu level abstraksi.

Contoh buruk:

```text
Submit Application
  -> Validate JSON schema
  -> Check field applicant.name not null
  -> Officer Review
  -> SELECT * FROM PAYMENT
  -> Supervisor Approval
  -> HTTP POST /license
```

Ini mencampur business dan implementation detail.

Contoh lebih baik:

```text
Submit Application
  -> Validate application
  -> Officer reviews application
  -> Supervisor approves application
  -> Issue license
```

Implementation detail berada di worker/domain service.

Namun model juga tidak boleh terlalu abstrak:

```text
Process Application -> End
```

Tidak berguna.

Rule:

```text
BPMN utama harus menjelaskan business lifecycle.
Detail teknis masuk subprocess, worker, atau dokumentasi task contract.
```

---

## 36. BPMN Naming Semantics

Nama element sangat penting.

Camunda best practice menyarankan element BPMN diberi nama dari perspektif bisnis: activities memakai verb, events menjelaskan state/kejadian bisnis, gateway berupa pertanyaan, dan flow conditions sebagai jawaban.

### 36.1 Activity Naming

Baik:

```text
Validate application
Review submitted documents
Approve license issuance
Generate license document
Notify applicant
```

Buruk:

```text
Do validation
Service Task 1
Check
API Call
Process data
```

### 36.2 Event Naming

Baik:

```text
Application submitted
Payment received
Review deadline reached
Application withdrawn
License issued
```

Buruk:

```text
Start
Timer
Message
End
```

### 36.3 Gateway Naming

Baik:

```text
Is application complete?
Is payment required?
Was application approved?
Is additional review needed?
```

Buruk:

```text
Decision
Check status
Gateway 1
Condition
```

### 36.4 Sequence Flow Naming

Baik:

```text
Yes
No
Approved
Rejected
Additional information required
```

Buruk:

```text
flow1
true
false
path A
```

---

## 37. BPMN as Living Documentation

BPMN bisa menjadi documentation yang selalu sinkron dengan runtime jika executable.

Tetapi ini hanya benar jika:

1. diagram yang dipakai business sama dengan yang dideploy,
2. nama element jelas,
3. worker side effects terdokumentasi,
4. variable contract jelas,
5. versioning dikelola,
6. operational changes tidak dilakukan diam-diam,
7. manual repair tercatat.

Jika tidak, BPMN menjadi gambar palsu.

```text
Diagram says A -> B -> C
System actually does A -> cron -> hidden script -> DB patch -> B -> C
```

Itu bukan living documentation.

Itu misleading documentation.

---

## 38. Common Semantic Bugs in BPMN

### 38.1 Gateway Without Exhaustive Conditions

```text
<Decision?>
  approved -> A
  rejected -> B
```

Variable value ternyata `PENDING_INFO`.

Akibat:

```text
No matching sequence flow.
Incident/runtime error.
```

### 38.2 Parallel Join Without Guaranteed Tokens

Parallel join menunggu token yang tidak pernah dibuat.

Akibat:

```text
Process stuck.
```

### 38.3 Timer Modeled After Task Instead of Boundary

Reminder/escalation salah waktu.

### 38.4 Non-idempotent Service Task

Worker melakukan side effect, crash sebelum complete job.

Akibat:

```text
Job retried.
Side effect duplicate.
```

### 38.5 Message Correlation Too Broad

Correlation pakai applicantId, padahal satu applicant bisa punya banyak application.

Akibat:

```text
Message correlated to wrong process.
```

### 38.6 User Task as Passive Status

User task dibuat hanya agar status terlihat.

Akibat:

```text
Tasklist penuh task palsu.
Process state tidak merepresentasikan work nyata.
```

### 38.7 Process Variable as Data Lake

Semua payload disimpan di process variable.

Akibat:

1. performance turun,
2. sensitive data leak,
3. versioning sulit,
4. audit noise,
5. migration sakit.

---

## 39. Token Simulation Exercise

Untuk menjadi kuat di BPMN, biasakan mensimulasikan token secara manual.

Ambil model:

```text
(Start)
  -> [Validate]
  -> <Complete?>
       no  -> [Request Info] -> (Wait for Resubmission Message) -> [Validate]
       yes -> + parallel split
               -> [Check Payment] ->
               -> [Risk Review]   ->
             + parallel join
             -> <Approved?>
                  yes -> [Issue License] -> (End)
                  no  -> [Reject] -> (End)
```

Pertanyaan simulasi:

1. token awal ada di mana?
2. task mana wait state?
3. berapa token setelah parallel split?
4. apa yang terjadi jika Check Payment selesai tapi Risk Review belum?
5. apa yang terjadi jika message resubmission datang sebelum process menunggu?
6. apa yang terjadi jika `approved` variable null?
7. apakah `Request Info` end atau loop?
8. apakah process bisa infinite loop?
9. apakah ada SLA untuk resubmission?
10. apakah `Issue License` idempotent?

Jika engineer bisa menjawab ini, ia mulai membaca BPMN sebagai runtime contract.

---

## 40. Process Instance Lifecycle

Process instance lifecycle secara sederhana:

```text
Created
  -> Active
  -> Waiting / Running / Incident
  -> Completed / Terminated / Cancelled
```

Lebih detail:

```text
Process definition deployed
  -> process instance created
  -> token enters start event
  -> token traverses sequence flow
  -> activities/events/gateways executed
  -> wait states persisted
  -> external commands/events complete work
  -> incidents may happen
  -> all tokens end or process terminated
```

Untuk Camunda 8, service work biasanya asynchronous via job workers.

Untuk Camunda 7, banyak semantics bergantung pada transaction boundaries, async continuation, job executor, dan embedded engine behavior.

Tetapi mental model token tetap berguna untuk keduanya.

---

## 41. BPMN and Transactions

BPMN transaction tidak sama dengan database transaction.

Database transaction:

```text
BEGIN
  update table A
  insert table B
COMMIT / ROLLBACK
```

BPMN long-running process:

```text
Day 1: submit application
Day 2: review
Day 5: payment
Day 6: issue license
```

Tidak mungkin semua itu berada dalam satu DB transaction.

Karena itu BPMN process menggunakan:

1. persisted wait state,
2. retry,
3. compensation,
4. manual repair,
5. eventual consistency,
6. audit trail.

Rule:

```text
Jangan desain BPMN seperti satu ACID transaction panjang.
Desain BPMN sebagai long-running consistency protocol.
```

---

## 42. BPMN and Determinism

BPMN process harus cukup deterministic agar bisa dioperasikan.

Deterministic bukan berarti semua outcome sama.

Deterministic berarti:

```text
Dengan state, variables, events, dan model version yang sama,
engine behavior bisa dipahami dan dijelaskan.
```

Sumber non-determinism:

1. race event,
2. parallel worker completion,
3. external system response,
4. time,
5. human action,
6. message ordering,
7. retry timing.

BPMN tidak menghilangkan non-determinism, tetapi membuat titik-titiknya explicit.

---

## 43. Business State vs Execution State

Contoh:

```text
Domain status: PENDING_REVIEW
```

Execution state bisa berbeda-beda:

```text
Token at Officer Review user task
Token at Supervisor Review user task
Token at parallel Document Check and Risk Check
Token waiting for external agency response
Token stuck at incident before review task creation
```

Semua bisa terlihat sebagai `PENDING_REVIEW` di domain.

Karena itu, jangan pakai domain status sebagai satu-satunya sumber kebenaran untuk orchestration.

Sebaliknya, jangan pakai BPMN state sebagai satu-satunya domain state untuk semua query bisnis.

Gunakan keduanya dengan boundary jelas.

---

## 44. BPMN and Audit Semantics

BPMN memberi audit struktur:

1. path yang dilewati,
2. task yang aktif,
3. task yang selesai,
4. decision gateway yang diambil,
5. timestamps,
6. variables saat routing,
7. actor yang menyelesaikan task,
8. incidents,
9. retries,
10. manual operations.

Namun audit yang defensible tetap butuh desain eksplisit.

BPMN engine history saja biasanya tidak cukup untuk regulatory audit.

Kita tetap butuh domain audit seperti:

```text
Officer A approved application APP-001
at 2026-06-17T10:12:00+07:00
with reason: requirements fulfilled
based on checklist version v4
under process definition licenseApplication:v7
from task OfficerReview
correlationId: ...
```

BPMN memberi skeleton. Domain audit memberi legal/business explanation.

---

## 45. BPMN and Testing Semantics

Karena BPMN adalah execution contract, BPMN harus diuji.

Minimal test dimensions:

1. happy path,
2. each gateway branch,
3. no matching gateway condition,
4. timer path,
5. message path,
6. boundary event path,
7. error path,
8. retry exhausted path,
9. compensation path,
10. cancellation path,
11. version compatibility path.

Test mindset:

```text
Bukan hanya “worker method works”.
Tetapi “process token reaches expected state under expected events”.
```

---

## 46. BPMN and Java Engineer Mindset

Sebagai Java engineer, ada beberapa pergeseran mental.

### 46.1 Dari Method Call ke Durable Command

Java biasa:

```java
licenseService.issue(applicationId);
```

BPMN worker:

```text
Job activated: issue-license
Worker receives variables
Worker performs side effect idempotently
Worker completes job
```

### 46.2 Dari Exception ke Failure Taxonomy

Java biasa:

```java
throw new RuntimeException("failed");
```

BPMN production:

```text
Is this technical failure?
Retryable?
Non-retryable?
Business error?
Escalation?
Compensation trigger?
Manual repair required?
```

### 46.3 Dari Local Transaction ke Process Consistency

Java biasa:

```java
@Transactional
public void approve() { ... }
```

BPMN:

```text
Approval may span user task, domain DB update, notification, document generation, external API sync.
Some parts succeed, others fail.
Need recovery model.
```

### 46.4 Dari Synchronous Stack Trace ke Process Trace

Java biasa:

```text
stack trace tells path
```

BPMN:

```text
process history + element instances + variables + worker logs + correlation IDs tell path
```

---

## 47. Practical BPMN Reading Algorithm

Saat diberi BPMN diagram, baca dengan urutan ini:

### Step 1 — Identify Process Boundary

```text
Apa process-nya?
Apa start dan end-nya?
Apa business object utama?
```

### Step 2 — Identify Wait States

```text
Di mana process berhenti?
Menunggu siapa/apa?
```

### Step 3 — Identify Decisions

```text
Gateway apa saja?
Variable/decision apa yang dipakai?
Apakah conditions exhaustive?
```

### Step 4 — Identify Parallelism

```text
Ada split/join?
Ada multi-instance?
Ada race condition?
```

### Step 5 — Identify Events

```text
Message apa yang ditunggu?
Timer apa yang dijadwalkan?
Boundary event apa yang bisa interrupt?
```

### Step 6 — Identify Side Effects

```text
Service task mana melakukan external side effect?
Apakah idempotent?
Apa retry policy?
```

### Step 7 — Identify Failure Paths

```text
Apa yang terjadi saat worker gagal?
Saat message tidak datang?
Saat timer expired?
Saat human tidak action?
```

### Step 8 — Identify Audit Points

```text
Decision mana yang perlu reason?
Actor mana yang perlu dicatat?
Data apa yang perlu snapshot?
```

### Step 9 — Identify Versioning Risk

```text
Jika process berubah, apa running instance terdampak?
Worker masih compatible?
Variables masih compatible?
```

### Step 10 — Identify Operational Runbook

```text
Kalau stuck, operator melihat apa?
Retry dari mana?
Repair apa yang aman?
```

---

## 48. Example: Bad BPMN and Why It Fails

Diagram:

```text
(Start)
  -> [Process Application]
  -> <Status?>
      -> [Approve]
      -> [Reject]
  -> (End)
```

Masalah:

1. `Process Application` terlalu generic.
2. gateway `Status?` tidak punya semantic bisnis.
3. outgoing flow tidak jelas condition-nya.
4. tidak ada user task eksplisit.
5. tidak ada wait state.
6. tidak ada SLA.
7. tidak ada error path.
8. tidak ada message/timer.
9. tidak jelas approve/reject dilakukan siapa.
10. tidak jelas external side effect.

Ini mungkin valid diagram, tetapi lemah sebagai execution contract.

---

## 49. Example: Better BPMN Contract

```text
(Start: Application submitted)
  -> [Validate application]
  -> <Is application complete?>
       No  -> [Request missing information]
              -> (Wait for applicant resubmission)
              -> [Validate application]
       Yes -> [Assign reviewing officer]
              -> [Officer reviews application]
                    boundary non-interrupting timer 3 days -> [Send review reminder]
                    boundary interrupting timer 5 days -> [Escalate overdue review]
              -> [Determine approval route]
              -> <Is supervisor approval required?>
                    Yes -> [Supervisor approves application]
                    No  -> [Prepare decision]
              -> <Was application approved?>
                    Approved -> [Issue license]
                              -> [Notify applicant of approval]
                              -> (End: License issued)
                    Rejected -> [Notify applicant of rejection]
                              -> (End: Application rejected)
```

Ini lebih baik karena:

1. business steps explicit,
2. wait state explicit,
3. timeout explicit,
4. decision points clear,
5. user responsibility visible,
6. system side effects separable,
7. loop resubmission modeled,
8. audit points visible.

Tetapi masih perlu worker contracts, variable contracts, error handling, testing, and runbooks.

---

## 50. BPMN Semantic Checklist

Gunakan checklist ini saat review diagram BPMN.

### 50.1 Process Boundary

- Apakah process punya start dan end yang jelas?
- Apakah process mewakili business lifecycle yang meaningful?
- Apakah process terlalu besar?
- Apakah process terlalu kecil?

### 50.2 Token Flow

- Apakah semua path bisa mencapai end atau valid wait state?
- Apakah ada path yang bisa deadlock?
- Apakah parallel split/join benar?
- Apakah loop punya exit condition?

### 50.3 Wait State

- Apakah semua wait state intentional?
- Apakah wait state punya owner?
- Apakah wait state punya timeout/SLA jika dibutuhkan?

### 50.4 Gateway

- Apakah gateway bernama pertanyaan bisnis?
- Apakah outgoing flow bernama jawaban?
- Apakah conditions exhaustive?
- Apakah default flow business-valid?
- Apakah decision logic terlalu kompleks?

### 50.5 Events

- Apakah message event punya correlation key jelas?
- Apakah timer event punya timezone/business calendar strategy?
- Apakah boundary event interrupting/non-interrupting sudah benar?
- Apakah event subprocess lebih tepat daripada banyak boundary event?

### 50.6 Tasks

- Apakah service task punya worker owner?
- Apakah worker idempotent?
- Apakah user task punya assignment rule?
- Apakah task input/output jelas?

### 50.7 Variables

- Apakah variable minimal?
- Apakah sensitive data tidak disimpan sembarangan?
- Apakah variable schema versioned?
- Apakah gateway expression robust terhadap missing value?

### 50.8 Failure Handling

- Apakah technical failure dibedakan dari business error?
- Apakah retry policy jelas?
- Apakah incident handling jelas?
- Apakah compensation dibutuhkan?
- Apakah manual repair aman?

### 50.9 Audit

- Apakah decision reason dicatat?
- Apakah actor dicatat?
- Apakah timestamps cukup?
- Apakah process version bisa dilacak?
- Apakah manual override governance jelas?

### 50.10 Operability

- Apakah operator tahu cara membaca stuck instance?
- Apakah dashboard/metric tersedia?
- Apakah runbook tersedia?
- Apakah alerting punya signal yang benar?

---

## 51. Ringkasan Mental Model

BPMN harus dipahami sebagai runtime language untuk process orchestration.

Mental model utamanya:

```text
Process definition = blueprint
Process instance   = satu eksekusi nyata
Token              = posisi aktif eksekusi
Activity           = work
Event              = sesuatu yang terjadi
Gateway            = routing token
Wait state         = persisted pause
Variable           = process data contract
Incident           = operational failure requiring attention
```

Kalimat paling penting:

```text
BPMN bukan gambar flow.
BPMN adalah kontrak eksekusi untuk long-running business process.
```

Jika Anda bisa membaca diagram dan menjawab:

1. token ada di mana,
2. apa yang ditunggu,
3. siapa mengerjakan,
4. event apa yang bisa terjadi,
5. variable apa yang memutuskan jalur,
6. apa yang terjadi saat gagal,
7. bagaimana audit menjelaskan keputusan,
8. bagaimana operator memperbaiki instance,

maka Anda mulai berpikir seperti process orchestration engineer.

---

## 52. Latihan Mandiri

### Latihan 1 — Token Trace

Ambil proses berikut:

```text
Submit Application
  -> Validate
  -> Complete?
      No -> Request Correction -> Wait Resubmission -> Validate
      Yes -> Review
             -> Approve?
                 Yes -> Issue License -> End
                 No  -> Reject -> End
```

Jawab:

1. Di mana wait state?
2. Variable apa yang dibutuhkan gateway?
3. Apa yang terjadi jika applicant tidak resubmit?
4. Apa yang terjadi jika issue license gagal?
5. Apakah reject perlu compensation?
6. Apakah review perlu SLA?

### Latihan 2 — Event Design

Desain event untuk:

```text
Applicant bisa menarik aplikasi kapan saja sebelum license issued.
```

Pertanyaan:

1. boundary event atau event subprocess?
2. interrupting atau non-interrupting?
3. apa yang terjadi pada parallel tasks?
4. domain status berubah menjadi apa?
5. audit apa yang dicatat?

### Latihan 3 — Gateway Refactoring

Diberikan gateway condition:

```text
riskScore > 80 && applicantType == "CORPORATE" && hasPreviousViolation == true && amount > 1000000
```

Refactor agar business-readable.

Hint:

```text
Gunakan decision task sebelum gateway.
Gateway cukup membaca decision result.
```

---

## 53. Apa yang Tidak Dibahas di Part Ini

Part ini belum membahas detail:

1. simbol BPMN satu per satu secara exhaustive,
2. Camunda 7 API,
3. Camunda 8 Java Client coding,
4. worker implementation,
5. DMN,
6. timer calendar implementation,
7. Kubernetes deployment,
8. production incident repair.

Semua itu akan masuk di part berikutnya.

---

## 54. Penutup Part 1

Part 1 membentuk dasar semantik BPMN.

Anda sekarang harus mulai melihat BPMN sebagai:

```text
Business-readable process model
+ executable runtime contract
+ durable state machine
+ event routing model
+ human/system work coordinator
+ audit skeleton
```

Dengan mental model ini, Part 2 akan jauh lebih mudah.

---

# Status Seri

Seri **belum selesai**.

Saat ini selesai:

- Part 0 — Orientation: Dari CRUD Engineer ke Process Orchestration Engineer
- Part 1 — BPMN 2.0 Deep Semantics: Bukan Diagram, Tapi Execution Contract

Berikutnya:

- Part 2 — BPMN Core Elements: Events, Tasks, Gateways, Subprocesses

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-bpmn-camunda-part-00-orientation.md">⬅️ Part 0 — Orientation: Dari CRUD Engineer ke Process Orchestration Engineer</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-bpmn-camunda-part-02-bpmn-core-elements-events-tasks-gateways-subprocesses.md">Part 2 — BPMN Core Elements: Events, Tasks, Gateways, Subprocesses ➡️</a>
</div>
