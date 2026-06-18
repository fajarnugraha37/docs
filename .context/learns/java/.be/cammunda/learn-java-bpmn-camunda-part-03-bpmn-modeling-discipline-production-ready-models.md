# learn-java-bpmn-camunda-process-orchestration-engineering

# Part 3 — BPMN Modeling Discipline: Membuat Process Model yang Bisa Hidup di Production

> Seri: Java BPMN, Camunda, and Process Orchestration Engineering  
> Target: Java 8 hingga Java 25  
> Level: Advanced  
> Fokus: modeling discipline, production readiness, maintainability, auditability, operability, dan evolvability process model

---

## 0. Tujuan Part Ini

Pada Part 0 kita membangun orientasi: BPMN bukan sekadar diagram, tetapi cara mengekspresikan long-running business process secara eksplisit.

Pada Part 1 kita masuk ke execution semantics: token, wait state, event, gateway, task, dan bagaimana BPMN dibaca sebagai execution contract.

Pada Part 2 kita membahas elemen inti BPMN: events, tasks, gateways, subprocesses, boundary events, compensation, dan multi-instance.

Sekarang kita masuk ke hal yang lebih sulit dan sering membedakan engineer biasa dari engineer yang matang: **discipline dalam membuat model BPMN yang benar-benar bisa hidup di production**.

Karena di production, masalah BPMN jarang berbentuk:

```text
Saya tidak tahu simbol BPMN apa ini.
```

Masalah production biasanya berbentuk:

```text
Process sudah jalan 8 bulan, ada 19.000 instance aktif, model baru butuh perubahan besar,
sebagian instance lama masih pakai versi lama, ada task stuck, SLA breach,
worker sempat gagal, auditor minta alasan kenapa kasus X berubah status,
dan business minta diagramnya tetap mudah dipahami.
```

Itulah fokus part ini.

Kita akan belajar bagaimana membuat BPMN yang:

1. bisa dibaca manusia,
2. bisa dieksekusi engine,
3. bisa dites developer,
4. bisa dipahami business analyst,
5. bisa dioperasikan support team,
6. bisa diaudit regulator,
7. bisa berubah tanpa menghancurkan running instances,
8. tidak menjadi distributed spaghetti.

---

## 1. Mental Model Utama: BPMN Model adalah Product Artifact, Bukan Sekadar Diagram

BPMN model dalam sistem production harus diperlakukan seperti kombinasi dari:

```text
business contract
+ executable configuration
+ integration topology
+ audit map
+ operational surface
+ change-management artifact
```

Artinya, ketika kita menggambar BPMN, kita sebenarnya sedang menentukan:

1. **urutan keputusan bisnis**,
2. **siapa yang bertanggung jawab di tiap titik**,
3. **kapan sistem boleh menunggu**,
4. **kapan sistem harus otomatis**,
5. **apa yang terjadi kalau gagal**,
6. **apa yang terjadi kalau waktu habis**,
7. **apa yang bisa diperbaiki manual**,
8. **apa yang harus terekam untuk audit**,
9. **apa yang akan sulit diubah nanti**.

BPMN yang buruk bukan hanya sulit dibaca. Ia membuat sistem sulit dioperasikan.

BPMN yang baik bukan hanya cantik. Ia membuat business process bisa dikendalikan.

---

## 2. Bedakan Empat Level Model

Salah satu kesalahan paling umum adalah mencampur semua detail ke dalam satu diagram.

Engineer sering menggambar BPMN seperti ini:

```text
Receive Application
 -> Validate JSON
 -> Query Applicant Table
 -> Check Field A
 -> Check Field B
 -> Call Service X
 -> Map DTO
 -> Save Table Y
 -> Send Email
 -> Update Status
 -> Generate Audit
 -> Notify Officer
```

Ini bukan process model yang sehat. Ini sudah berubah menjadi low-level program flow.

Dalam production-grade BPMN, kita harus membedakan empat level.

---

### 2.1 Level 1 — Business Process Model

Ini adalah model yang bisa dibaca stakeholder bisnis.

Contoh:

```text
Application Submitted
 -> Check Application Completeness
 -> Request Missing Information?
 -> Assess Application
 -> Approve or Reject
 -> Notify Applicant
```

Karakteristik:

1. memakai bahasa bisnis,
2. tidak terlalu teknis,
3. menunjukkan keputusan penting,
4. menunjukkan human responsibility,
5. menunjukkan business wait state,
6. cocok untuk discussion dan sign-off.

Level ini menjawab:

```text
Apa perjalanan bisnis dari awal sampai akhir?
```

---

### 2.2 Level 2 — Executable Orchestration Model

Ini adalah model yang akan dieksekusi engine.

Contoh:

```text
Application Submitted
 -> Validate Submission
 -> Create Case Record
 -> Assign Completeness Review Task
 -> Wait for Officer Review
 -> Gateway: Complete?
      yes -> Start Assessment Subprocess
      no  -> Send Resubmission Request
 -> Wait for Applicant Resubmission
```

Karakteristik:

1. tetap business-readable,
2. mulai memuat service task,
3. memuat wait state eksplisit,
4. memuat message/timer boundary,
5. memuat error path yang relevan,
6. cukup detail untuk runtime.

Level ini menjawab:

```text
Bagaimana engine mengoordinasikan proses ini?
```

---

### 2.3 Level 3 — Technical Worker Flow

Ini bukan BPMN utama. Ini biasanya ada di Java code, sequence diagram, atau design note.

Contoh worker `validate-submission`:

```text
1. Load application draft.
2. Validate mandatory fields.
3. Validate applicant identity.
4. Validate document references.
5. Persist validation result.
6. Return normalized process variables.
```

Karakteristik:

1. detail teknis,
2. berada di Java/Spring service,
3. bisa diuji unit test,
4. tidak perlu digambar sebagai 20 service task kecil di BPMN.

Level ini menjawab:

```text
Apa yang dilakukan worker ketika engine memberi job?
```

---

### 2.4 Level 4 — Infrastructure/Operations Model

Ini menjelaskan deployment/runtime topology.

Contoh:

```text
Camunda Gateway
 -> Java Worker Deployment A
 -> Application DB
 -> Document Service
 -> Notification Service
 -> Audit Service
 -> External Agency API
```

Karakteristik:

1. bukan BPMN,
2. menjelaskan runtime dependencies,
3. penting untuk capacity planning,
4. penting untuk incident analysis,
5. penting untuk security review.

Level ini menjawab:

```text
Di production, komponen apa saja yang terlibat dan bagaimana failure menyebar?
```

---

## 3. Rule Fundamental: Satu Diagram, Satu Level Abstraksi

BPMN menjadi buruk ketika satu diagram mencampur:

```text
business approval
+ SQL update
+ HTTP retry
+ email template rendering
+ JSON mapping
+ SLA escalation
+ Kafka publish
+ admin repair path
```

Semua hal itu penting, tetapi tidak semuanya harus berada pada level BPMN yang sama.

Prinsipnya:

```text
BPMN harus menampilkan flow bisnis dan orchestration boundary.
Java code harus menampilkan detail algoritmik/teknis.
Architecture diagram harus menampilkan dependency dan deployment.
Runbook harus menampilkan repair procedure.
Audit model harus menampilkan evidentiary record.
```

Jika semua dipaksa masuk ke BPMN, hasilnya bukan transparency, tetapi noise.

---

## 4. Happy Path First, Tapi Jangan Happy Path Only

Cara modeling yang sehat biasanya dimulai dari happy path.

Contoh application approval:

```text
Start: Application Submitted
 -> Review Completeness
 -> Assess Application
 -> Approve Application
 -> Notify Applicant
 -> End
```

Ini baik sebagai skeleton awal. Tetapi tidak cukup untuk production.

Setelah happy path jelas, kita harus menambahkan:

1. missing information,
2. applicant timeout,
3. officer reassignment,
4. rejection,
5. withdrawal,
6. duplicate submission,
7. external service failure,
8. document generation failure,
9. notification failure,
10. manual repair path,
11. appeal/reopen possibility,
12. SLA breach escalation.

Tetapi jangan menambahkan semua exception sekaligus sampai diagram hancur. Gunakan pendekatan layered refinement.

---

## 5. Layered Refinement: Cara Praktis Membuat BPMN Besar Tanpa Berantakan

Gunakan urutan ini.

---

### 5.1 Draft 1 — Business Skeleton

Tulis hanya 5–9 langkah utama.

```text
Application Submitted
 -> Completeness Review
 -> Technical Assessment
 -> Decision
 -> Notification
 -> Closure
```

Tujuannya bukan executable dulu. Tujuannya adalah memastikan business lifecycle benar.

Pertanyaan review:

1. Apakah urutan besar benar?
2. Apakah ada lifecycle besar yang hilang?
3. Apakah start dan end jelas?
4. Apakah semua aktor utama terlihat?
5. Apakah proses ini punya satu tujuan bisnis yang jelas?

---

### 5.2 Draft 2 — Wait States

Tambahkan titik tunggu.

```text
Application Submitted
 -> System Validation
 -> Wait for Officer Completeness Review
 -> Wait for Applicant Resubmission if incomplete
 -> Wait for Assessor Decision
 -> Wait for Payment if approved conditionally
 -> Notify Applicant
 -> End
```

Wait state adalah titik paling penting dalam BPMN karena instance bisa hidup lama di sana.

Pertanyaan review:

1. Di mana engine harus berhenti dan menunggu manusia?
2. Di mana engine harus menunggu event eksternal?
3. Di mana engine harus menunggu waktu tertentu?
4. Di mana instance mungkin stuck?
5. Siapa pemilik stuck state itu?

---

### 5.3 Draft 3 — Business Alternatives

Tambahkan cabang bisnis utama.

```text
Completeness Review
 -> Complete? yes -> Assessment
 -> Complete? no  -> Request Missing Info

Assessment
 -> Recommend Approve? yes -> Approval Decision
 -> Recommend Reject?  yes -> Rejection Decision
```

Pertanyaan review:

1. Apakah gateway mewakili keputusan bisnis yang nyata?
2. Apakah setiap outgoing path punya condition yang jelas?
3. Apakah ada default path?
4. Apakah path “other/unknown” perlu incident atau manual review?
5. Apakah path rejection/withdrawal/expiry jelas?

---

### 5.4 Draft 4 — Time Behavior

Tambahkan timer untuk deadline, reminder, escalation, expiry.

```text
Wait for Applicant Resubmission
 -> boundary timer: 7 days -> Send Reminder
 -> boundary timer: 14 days -> Escalate
 -> boundary timer: 30 days -> Auto Close as No Response
```

Pertanyaan review:

1. Apakah timer interrupting atau non-interrupting?
2. Apakah deadline berdasarkan calendar day atau working day?
3. Timezone apa yang digunakan?
4. Apa yang terjadi jika timer fire bersamaan dengan user action?
5. Apakah auto-close legally allowed?

---

### 5.5 Draft 5 — Technical Failure Handling

Tambahkan error/incident/compensation di boundary yang tepat.

```text
Generate Decision Letter
 -> success -> Send Notification
 -> failure -> Incident / Manual Repair

Publish Approval Event
 -> failure -> Retry
 -> exhausted -> Incident
```

Pertanyaan review:

1. Failure mana yang business error?
2. Failure mana yang technical retry?
3. Failure mana yang harus jadi incident?
4. Failure mana yang bisa dikompensasi?
5. Failure mana yang butuh human intervention?

---

### 5.6 Draft 6 — Reusability and Composition

Pecah bagian besar menjadi subprocess/call activity.

Contoh:

```text
Main Process: Application Lifecycle
  -> Call Activity: Completeness Review
  -> Call Activity: Assessment
  -> Call Activity: Decision Issuance
  -> Call Activity: Notification
```

Pertanyaan review:

1. Apakah subprocess punya tujuan tunggal?
2. Apakah variable contract jelas?
3. Apakah error propagation jelas?
4. Apakah version binding aman?
5. Apakah reuse benar-benar mengurangi kompleksitas?

---

## 6. Naming Discipline: Nama Adalah Contract

Nama element BPMN bukan kosmetik. Nama adalah cara manusia memahami runtime state.

Ketika production support membuka Operate/Cockpit dan melihat instance stuck di activity tertentu, nama activity menentukan apakah mereka paham apa yang terjadi.

Buruk:

```text
Task 1
Check
Process Data
Service Call
Gateway 3
```

Baik:

```text
Validate Submitted Application
Create Case Record
Wait for Officer Completeness Review
Is Application Complete?
Request Missing Information from Applicant
Generate Approval Letter
Notify Applicant of Rejection
```

Camunda best practice juga menekankan penamaan BPMN dari perspektif bisnis: activities sebaiknya memakai verb, events menggambarkan state bisnis, dan gateway berbentuk pertanyaan dengan kondisi outgoing flow yang jelas.

---

## 7. Naming Rules Praktis

### 7.1 Activity Name: Verb + Business Object

Gunakan pola:

```text
<Verb> <Business Object>
```

Contoh:

```text
Validate Application
Create Case Record
Assign Review Task
Assess Application
Generate Decision Letter
Send Approval Notification
Archive Case Documents
```

Hindari:

```text
Validation
Case
Notification
Processing
```

Kenapa?

Karena activity harus menjelaskan tindakan.

---

### 7.2 User Task Name: Wait for + Actor/Decision

Untuk user task, sering lebih jelas jika nama menunjukkan proses sedang menunggu manusia.

Contoh:

```text
Wait for Officer Completeness Review
Wait for Supervisor Approval
Wait for Applicant Resubmission
Wait for Legal Review
```

Atau jika ingin action-oriented:

```text
Review Application Completeness
Approve Enforcement Recommendation
Submit Missing Documents
```

Keduanya bisa dipakai. Pilih satu style dan konsisten.

Untuk production operations, `Wait for ...` sering sangat membantu karena menunjukkan wait state.

---

### 7.3 Gateway Name: Pertanyaan, Bukan Aksi

Gateway bukan action. Gateway memilih path.

Baik:

```text
Is Application Complete?
Is Applicant Eligible?
Does Case Require Legal Review?
Was Payment Received?
Has Deadline Expired?
```

Buruk:

```text
Check Completeness
Validate Eligibility
Payment
Legal Review
```

Outgoing sequence flow harus menjawab pertanyaan gateway.

Contoh:

```text
Gateway: Is Application Complete?
  -> Yes
  -> No
```

Atau lebih eksplisit:

```text
Gateway: Does Case Require Legal Review?
  -> Requires Legal Review
  -> Does Not Require Legal Review
```

---

### 7.4 Event Name: State atau Trigger

Start event:

```text
Application Submitted
Appeal Received
Payment Received
Daily SLA Check Triggered
```

Intermediate catch event:

```text
Applicant Resubmission Received
External Agency Response Received
Payment Confirmation Received
```

Timer:

```text
Resubmission Deadline Reached
Review SLA Breached
Reminder Due
```

End event:

```text
Application Approved
Application Rejected
Application Withdrawn
Case Closed
```

End event harus menyatakan outcome, bukan sekadar `End`.

---

## 8. Business Language vs Technical Language

BPMN sebaiknya menggunakan business language untuk flow utama.

Buruk:

```text
POST /applications/{id}/validate
Update APP_STATUS = PENDING_REVIEW
Call EmailService.send()
Insert AUDIT_TRAIL
```

Baik:

```text
Validate Application Submission
Mark Application Ready for Review
Notify Officer of New Application
Record Application Submission Audit
```

Tetapi jangan salah paham: technical detail tetap penting. Hanya tempatnya bukan selalu di BPMN utama.

Gunakan:

1. BPMN untuk business orchestration,
2. Java worker design untuk technical execution,
3. sequence diagram untuk system integration,
4. runbook untuk operational repair,
5. API contract untuk interface detail.

---

## 9. Process Boundary: Kesalahan Terbesar Ada di Sini

Menentukan boundary process adalah keputusan arsitektural.

Pertanyaan paling penting:

```text
Satu process instance merepresentasikan apa?
```

Contoh jawaban:

```text
Satu application submission.
Satu enforcement case.
Satu appeal request.
Satu renewal cycle.
Satu payment collection attempt.
Satu document resubmission request.
```

Jawaban ini menentukan:

1. business key,
2. process lifetime,
3. ownership,
4. audit scope,
5. variable scope,
6. versioning impact,
7. correlation strategy,
8. repair strategy.

---

## 10. Jangan Membuat Process Boundary Berdasarkan Endpoint

Buruk:

```text
Process: Submit Application API
Process: Update Application API
Process: Approve Application API
Process: Send Email API
```

Ini bukan business process. Ini API orchestration yang terlalu sempit.

Lebih baik:

```text
Process: Application Lifecycle
  includes submission, review, decision, notification, closure
```

Atau jika terlalu besar:

```text
Process: Application Intake
Process: Application Assessment
Process: Decision Issuance
Process: Appeal Handling
```

Boundary harus mengikuti business lifecycle, bukan controller method.

---

## 11. Jangan Membuat Process Boundary Terlalu Besar

Sebaliknya, jangan membuat satu process untuk seluruh universe.

Buruk:

```text
Regulatory Platform Master Process
 -> application
 -> renewal
 -> amendment
 -> appeal
 -> enforcement
 -> payment
 -> inspection
 -> legal review
 -> prosecution
 -> closure
```

Ini akan menjadi monster model.

Masalahnya:

1. sulit dibaca,
2. sulit dites,
3. sulit versioning,
4. sulit migrate running instance,
5. ownership tidak jelas,
6. setiap CR berisiko menyentuh semua bagian,
7. operational triage sulit.

Lebih baik pecah berdasarkan bounded lifecycle:

```text
Application Lifecycle Process
Renewal Lifecycle Process
Appeal Process
Enforcement Case Process
Inspection Process
Document Request Process
Payment Collection Process
Notification Process
```

Hubungkan dengan call activity, message, atau domain event.

---

## 12. Boundary Heuristic: Kapan Satu Process, Kapan Pecah?

Gunakan pertanyaan ini.

### 12.1 Tetap Satu Process Jika

1. lifecycle-nya punya satu business outcome utama,
2. aktor dan data utamanya sama,
3. proses butuh visibility end-to-end,
4. versioning-nya biasanya berubah bersama,
5. error handling-nya saling tergantung,
6. audit narasinya harus satu cerita.

Contoh:

```text
Application from submission to decision.
```

---

### 12.2 Pecah Menjadi Subprocess Jika

1. bagian itu reusable,
2. bagian itu punya complexity sendiri,
3. bagian itu punya SLA sendiri,
4. bagian itu punya owner berbeda,
5. bagian itu bisa berubah lebih sering,
6. bagian itu ingin dites dan dirilis terpisah,
7. bagian itu punya failure handling yang berbeda.

Contoh:

```text
Document Verification Subprocess
Payment Collection Subprocess
Legal Review Subprocess
Notification Subprocess
```

---

### 12.3 Gunakan Message/Event Jika

1. proses lain bisa hidup independen,
2. tidak perlu parent menunggu secara synchronous,
3. ownership beda,
4. domain event lebih natural,
5. coupling harus longgar.

Contoh:

```text
Application Approved
 -> publish event
 -> downstream License Issuance process starts
```

---

## 13. Process Granularity: Jangan Terlalu Fine-grained, Jangan Terlalu Coarse-grained

Granularity BPMN harus berada di level orchestration, bukan level function call.

Terlalu fine-grained:

```text
Parse JSON
Validate Field A
Validate Field B
Validate Field C
Map DTO
Save Entity
Flush Transaction
```

Terlalu coarse-grained:

```text
Process Application
```

Yang sehat:

```text
Validate Application Submission
Create Application Case
Route Application for Review
Wait for Completeness Review
Request Missing Information
Assess Application
Issue Decision
Notify Applicant
Close Application
```

Aturan praktis:

```text
Jika business stakeholder tidak peduli detail itu, mungkin jangan jadikan activity BPMN utama.
Jika operations/audit perlu melihat state itu, mungkin perlu activity BPMN.
```

---

## 14. BPMN sebagai State Visibility Map

Dalam workflow system, pertanyaan penting bukan hanya:

```text
Apa step berikutnya?
```

Tetapi:

```text
Jika instance berhenti sekarang, state apa yang terlihat?
```

Contoh:

```text
Wait for Applicant Resubmission
```

Ini state yang jelas.

Bandingkan dengan:

```text
Process Application
```

Jika instance stuck di `Process Application`, tidak ada yang tahu apakah sedang validasi, menunggu dokumen, menunggu officer, atau gagal kirim email.

Production-grade BPMN harus membuat wait state penting terlihat.

---

## 15. Wait State Discipline

Wait state adalah titik di mana proses bisa berhenti lama.

Jenis wait state:

1. user task,
2. message catch event,
3. timer event,
4. receive task,
5. event-based gateway,
6. external job activation point,
7. async continuation dalam Camunda 7,
8. service task job dalam Camunda 8.

Setiap wait state harus punya jawaban untuk:

```text
Apa yang ditunggu?
Siapa pemiliknya?
Berapa lama boleh menunggu?
Apa yang terjadi jika tidak datang?
Bagaimana support tahu ini stuck atau normal?
Apakah ada SLA?
Apakah bisa di-repair?
```

Jika tidak bisa menjawab, model belum siap production.

---

## 16. Modeling SLA dengan Benar

SLA bukan hanya angka. SLA adalah behavior.

Buruk:

```text
Officer Review Task
```

Tanpa informasi apa pun tentang waktu.

Lebih baik:

```text
Wait for Officer Review
  boundary timer 3 working days -> Send Reminder
  boundary timer 5 working days -> Escalate to Supervisor
  boundary timer 10 working days -> Flag SLA Breach
```

Tetapi hati-hati: tidak semua SLA harus dimodelkan sebagai timer BPMN.

---

### 16.1 SLA yang Cocok Dimodelkan di BPMN

Gunakan BPMN timer jika timer mengubah jalannya proses.

Contoh:

1. auto-close application setelah 30 hari tidak ada response,
2. escalate task ke supervisor setelah 5 hari,
3. send reminder setelah 7 hari,
4. cancel reservation setelah payment timeout.

---

### 16.2 SLA yang Lebih Cocok sebagai Monitoring/Reporting

Jangan paksa semua SLA menjadi timer event jika hanya untuk report.

Contoh:

1. average completion time,
2. officer productivity,
3. aging dashboard,
4. monthly compliance report,
5. internal KPI yang tidak mengubah process path.

Ini bisa dihitung dari history/audit data.

---

## 17. Timer Discipline

Timer adalah salah satu penyebab model menjadi kacau.

Kesalahan umum:

```text
Setiap user task diberi 5 timer boundary:
reminder 1, reminder 2, escalation 1, escalation 2, auto close.
```

Akibat:

1. diagram penuh noise,
2. banyak race condition,
3. banyak active timers,
4. sulit dioperasikan,
5. sulit dijelaskan ke business.

Lebih baik gunakan pola yang jelas.

---

### 17.1 Pattern: Reminder Subprocess

Daripada menempel banyak timer di main flow, buat subprocess khusus reminder.

```text
Wait for Applicant Resubmission
  non-interrupting boundary timer every 7 days
      -> Send Resubmission Reminder
```

Atau:

```text
Call Activity: Manage Resubmission Reminder
```

Main process tetap bersih.

---

### 17.2 Pattern: SLA Monitor Event Subprocess

Untuk SLA kompleks:

```text
Event Subprocess: Review SLA Monitoring
  Timer: Review Deadline Reached
  -> Escalate Review Task
  -> Record SLA Breach
```

Ini membuat SLA behavior terlihat tetapi tidak mengotori happy path.

---

### 17.3 Pattern: Explicit Expiry Outcome

Jika timer mengakhiri proses, outcome harus eksplisit.

```text
Wait for Applicant Resubmission
  interrupting timer 30 days
    -> Mark Application as Withdrawn Due to No Response
    -> Notify Applicant of Closure
    -> End: Application Closed Due to No Response
```

Jangan langsung timer ke end event tanpa business action.

---

## 18. Gateway Discipline

Gateway adalah sumber spaghetti nomor satu.

Gateway yang baik punya:

1. satu pertanyaan jelas,
2. outgoing condition jelas,
3. default path jika perlu,
4. tidak mencampur banyak keputusan,
5. tidak menyembunyikan side effect.

Buruk:

```text
Gateway: Check Application
  -> approved
  -> rejected
  -> incomplete
  -> payment
  -> legal
  -> manual
  -> error
```

Ini terlalu banyak konsep dalam satu gateway.

Lebih baik:

```text
Gateway: Is Application Complete?
  -> No -> Request Missing Information
  -> Yes -> Assess Eligibility

Gateway: Is Applicant Eligible?
  -> No -> Reject Application
  -> Yes -> Determine Approval Conditions

Gateway: Are Approval Conditions Required?
  -> Yes -> Request Payment / Documents
  -> No -> Approve Application
```

Satu gateway, satu pertanyaan.

---

## 19. Gateway Smells

Waspadai tanda berikut.

### 19.1 Gateway Tanpa Nama

Jika gateway tidak punya nama, reviewer harus membaca condition expression teknis.

Itu buruk.

---

### 19.2 Gateway dengan Nama Aksi

```text
Validate Application
```

Ini seharusnya task, bukan gateway.

---

### 19.3 Gateway dengan Banyak Cabang Tidak Setara

Contoh:

```text
Gateway: What Next?
  -> approve
  -> reject
  -> error
  -> retry
  -> wait
  -> manual
```

Ini mencampur business outcome, technical failure, dan operational repair.

---

### 19.4 Gateway Setelah Setiap Task

Jika setiap task diikuti gateway, mungkin model terlalu imperative.

BPMN bukan flowchart Java method.

---

## 20. User Task Discipline

User task bukan sekadar “screen”.

User task adalah business wait state yang menyatakan:

```text
Process menunggu keputusan/tindakan manusia.
```

User task harus punya:

1. actor/candidate group,
2. assignment rule,
3. completion condition,
4. form/data contract,
5. authorization rule,
6. due date/follow-up date jika relevan,
7. possible outcomes,
8. audit fields,
9. reassignment rule,
10. cancellation behavior.

---

## 21. Jangan Jadikan User Task sebagai Status Table

Buruk:

```text
User Task: Pending
User Task: In Progress
User Task: Waiting
User Task: Done
```

Ini bukan task. Ini status.

Task harus menyatakan action:

```text
Review Application Completeness
Approve Enforcement Recommendation
Submit Missing Information
Confirm Payment Exception
```

Jika yang Anda butuhkan hanya status, simpan status di domain model atau process state, bukan user task palsu.

---

## 22. Task Outcome Discipline

User task sering punya beberapa outcome.

Contoh completeness review:

```text
Officer completes task with outcome:
- COMPLETE
- INCOMPLETE
- DUPLICATE
- WITHDRAWN_BY_APPLICANT
- NEED_SUPERVISOR_REVIEW
```

Model gateway setelah task harus membaca outcome ini secara jelas.

```text
Gateway: What is Completeness Review Outcome?
  -> Complete
  -> Incomplete
  -> Duplicate
  -> Requires Supervisor Review
```

Jangan gunakan boolean jika domain outcome lebih kaya.

Buruk:

```text
isApproved = true/false
```

Padahal false bisa berarti:

1. rejected,
2. incomplete,
3. withdrawn,
4. duplicate,
5. expired,
6. pending supervisor,
7. invalid submission.

Boolean sering menyembunyikan business semantics.

---

## 23. Service Task Discipline

Service task mewakili kerja otomatis.

Tetapi tidak semua function call harus menjadi service task.

Service task cocok jika:

1. activity penting secara business/operational,
2. activity punya failure handling sendiri,
3. activity memanggil external dependency,
4. activity punya side effect penting,
5. activity butuh observability sendiri,
6. activity butuh retry/incident sendiri.

Contoh cocok:

```text
Create Case Record
Generate Decision Letter
Publish Approval Event
Send Applicant Notification
Validate Applicant with External Registry
```

Contoh terlalu kecil:

```text
Trim Applicant Name
Map DTO
Format Date
Set Boolean Flag
```

Detail kecil seperti ini cukup di Java code.

---

## 24. External Side Effect Must Be Explicit Enough

Jika service task memanggil external system dengan side effect, sebaiknya terlihat di BPMN.

Contoh:

```text
Issue Digital License
Notify External Registry
Collect Payment
Cancel Existing License
```

Kenapa?

Karena side effect adalah titik risiko.

Pertanyaan yang harus dijawab:

1. Apakah call idempotent?
2. Apa retry strategy?
3. Apa yang terjadi jika response timeout tapi side effect berhasil?
4. Apakah ada compensation?
5. Apakah audit perlu merekam request/response reference?
6. Apakah manual repair tersedia?

---

## 25. Process Variables Discipline

Process variable bukan database utama.

Process variable adalah working memory untuk engine.

Simpan hanya data yang diperlukan untuk:

1. routing,
2. task display,
3. message correlation,
4. decision evaluation,
5. worker input,
6. audit-relevant process context.

Jangan simpan:

1. seluruh application payload besar,
2. full document binary,
3. full email body besar,
4. raw external API response besar,
5. PII yang tidak perlu,
6. entity graph kompleks,
7. data yang sudah ada di domain DB.

Gunakan reference:

```json
{
  "applicationId": "APP-2026-000123",
  "caseId": "CASE-2026-000991",
  "applicantId": "APPL-88421",
  "reviewOutcome": "INCOMPLETE",
  "resubmissionDeadline": "2026-07-17T17:00:00+08:00"
}
```

Bukan:

```json
{
  "entireApplication": { ... 500 fields ... },
  "allDocumentsBase64": [ ... ],
  "fullAuditTrail": [ ... ],
  "externalRegistryFullResponse": { ... }
}
```

---

## 26. Variable Contract per Activity

Setiap activity penting harus punya contract.

Contoh:

```text
Activity: Assess Application Eligibility

Input variables:
- applicationId
- applicantId
- licenceType
- submittedAt

Output variables:
- eligibilityOutcome
- eligibilityReasons
- requiresLegalReview
- requiresSupervisorApproval

Possible BPMN errors:
- ApplicantRecordNotFound
- ExternalRegistryUnavailableAfterRetries
```

Ini membantu:

1. worker implementation,
2. testing,
3. troubleshooting,
4. migration,
5. audit,
6. onboarding developer baru.

---

## 27. Variable Naming

Gunakan nama business-oriented dan stabil.

Baik:

```text
applicationId
caseId
applicantId
reviewOutcome
decisionOutcome
paymentStatus
requiresLegalReview
resubmissionDeadline
```

Buruk:

```text
x
flag
data
payload
result
status
isOk
response
```

`status` terlalu generik. Status apa?

Lebih baik:

```text
applicationStatus
paymentStatus
reviewStatus
notificationStatus
```

---

## 28. Domain State vs Process State

Ini sangat penting.

Domain state adalah state entity bisnis di database aplikasi.

Contoh:

```text
Application.status = PENDING_REVIEW
Case.status = UNDER_INVESTIGATION
Payment.status = PAID
```

Process state adalah posisi token/process instance di BPMN.

Contoh:

```text
Process instance waiting at Review Application Completeness.
Process instance waiting at Payment Confirmation Received.
Process instance has incident at Generate Decision Letter.
```

Keduanya tidak sama.

Kesalahan umum:

```text
Anggap BPMN state cukup, jadi domain status tidak perlu.
```

Atau sebaliknya:

```text
Anggap domain status cukup, jadi process state tidak perlu.
```

Dalam sistem serius, biasanya keduanya dibutuhkan.

---

## 29. Hubungan Sehat antara Domain State dan Process State

Gunakan rule ini:

```text
Domain state menjawab: bisnis entity sedang dalam status apa?
Process state menjawab: orchestration sedang menunggu/mengeksekusi step apa?
```

Contoh:

```text
Application.status = PENDING_APPLICANT_RESUBMISSION
Process state = Wait for Applicant Resubmission
```

Mereka selaras tetapi tidak identik.

Domain status dipakai untuk:

1. search/filter UI,
2. reporting,
3. authorization,
4. integration,
5. business invariant.

Process state dipakai untuk:

1. workflow execution,
2. waiting point,
3. incident repair,
4. operational visibility,
5. orchestration logic.

---

## 30. Jangan Menaruh Semua Business Logic di BPMN

BPMN harus mengatur flow, bukan menggantikan domain model.

Buruk:

```text
Gateway dengan FEEL expression raksasa:
applicant.age > 21 and applicant.hasCertificate and
not applicant.hasPreviousViolation and payment.amount >= requiredAmount and
licenseType in [...]
```

Lebih baik:

```text
Service Task: Evaluate Application Eligibility
Gateway: Is Applicant Eligible?
```

Eligibility rule bisa berada di:

1. DMN,
2. domain service,
3. rules engine,
4. policy service.

BPMN cukup memakai outcome.

---

## 31. Jangan Menaruh Semua Flow di Java Code

Sebaliknya, jangan sembunyikan process di Java.

Buruk:

```java
if (complete) {
  if (eligible) {
    if (paymentRequired) {
      ...
    } else {
      ...
    }
  } else {
    ...
  }
}
```

Jika logic ini adalah business process yang long-running, butuh human task, timer, audit, dan visibility, maka ia lebih baik eksplisit di BPMN.

Rule:

```text
BPMN untuk long-running orchestration.
Java untuk deterministic computation dan side-effect implementation.
DMN/rules untuk decision table/policy.
Database untuk source of truth entity.
```

---

## 32. Pool, Lane, dan Actor Discipline

Pool dan lane membantu menunjukkan responsibility.

Namun jangan berlebihan.

Gunakan lane jika:

1. actor responsibility penting,
2. handoff antar role penting,
3. audit perlu melihat siapa melakukan apa,
4. business ingin memahami ownership.

Contoh lane:

```text
Applicant
System
Officer
Supervisor
External Agency
```

Tetapi di executable BPMN, lane biasanya visual/organizational. Authorization tidak otomatis selesai hanya karena ada lane.

Jangan menganggap:

```text
Task ada di lane Supervisor, berarti hanya supervisor yang bisa complete.
```

Authorization tetap harus diimplementasikan di task assignment, identity, backend API, dan application security.

---

## 33. Lane Anti-pattern

Terlalu banyak lane:

```text
Junior Officer
Senior Officer
Assistant Manager
Manager
Director
System A
System B
System C
Applicant
Agency A
Agency B
Agency C
```

Diagram menjadi sulit dibaca.

Jika terlalu banyak aktor, pertimbangkan:

1. high-level collaboration diagram,
2. separate subprocess per actor group,
3. use candidate group metadata,
4. document authorization outside BPMN.

---

## 34. Modeling Human Responsibility

Dalam regulatory/case-management system, responsibility penting.

Setiap human decision harus jelas:

1. siapa bisa membuat keputusan,
2. siapa bisa merekomendasikan,
3. siapa bisa approve,
4. siapa bisa reject,
5. siapa bisa override,
6. siapa bisa reopen,
7. siapa bisa cancel,
8. siapa bisa reassign.

BPMN harus menunjukkan decision points besar.

Audit log harus menyimpan:

```text
actor
role
decision
reason
timestamp
previous state
new state
case/application id
process instance id
supporting document/reference
```

BPMN memberi struktur. Audit table memberi evidence.

---

## 35. Modeling for Auditability

Auditability tidak muncul otomatis hanya karena proses memakai BPMN.

BPMN membantu karena flow eksplisit, tetapi audit yang defensible butuh data tambahan.

Pertanyaan audit:

1. Siapa melakukan action?
2. Kapan action dilakukan?
3. Dalam step proses apa action dilakukan?
4. Apa input saat keputusan dibuat?
5. Apa output keputusan?
6. Apa alasan keputusan?
7. Apakah ada override?
8. Apakah SLA dilanggar?
9. Apakah ada retry/failure/repair?
10. Apakah versi proses yang digunakan diketahui?
11. Apakah versi decision rule diketahui?
12. Apakah data berubah setelah keputusan?

Production-grade BPMN harus mendukung pertanyaan ini.

---

## 36. Audit Event Design

Setiap activity penting dapat menghasilkan audit event domain.

Contoh:

```text
APPLICATION_SUBMITTED
COMPLETENESS_REVIEW_COMPLETED
MISSING_INFORMATION_REQUESTED
APPLICANT_RESUBMITTED_DOCUMENTS
ASSESSMENT_COMPLETED
SUPERVISOR_APPROVAL_COMPLETED
DECISION_LETTER_GENERATED
APPLICATION_APPROVED
APPLICATION_REJECTED
APPLICATION_CLOSED_DUE_TO_NO_RESPONSE
```

Audit event harus punya struktur stabil:

```json
{
  "auditEventId": "AUD-2026-000001",
  "eventType": "COMPLETENESS_REVIEW_COMPLETED",
  "applicationId": "APP-2026-000123",
  "caseId": "CASE-2026-000991",
  "processDefinitionId": "application-lifecycle",
  "processDefinitionVersion": 7,
  "processInstanceKey": "2251799813685251",
  "elementId": "ReviewApplicationCompleteness",
  "actorUserId": "u12345",
  "actorRole": "OFFICER",
  "decision": "INCOMPLETE",
  "reasonCode": "MISSING_DOCUMENT",
  "occurredAt": "2026-06-17T09:15:30+08:00"
}
```

---

## 37. Modeling for Operability

Production support tidak membaca source code dulu. Mereka melihat:

1. process instance state,
2. incidents,
3. job failures,
4. task backlog,
5. variables,
6. logs,
7. metrics,
8. audit trail.

BPMN model harus membantu mereka menjawab:

```text
Instance ini sedang menunggu apa?
Apakah ini normal?
Berapa lama sudah menunggu?
Siapa harus action?
Apakah ada SLA breach?
Apakah worker gagal?
Apakah bisa retry?
Apakah perlu cancel?
Apakah perlu migrate?
Apakah data aman diperbaiki manual?
```

Jika model tidak mendukung pertanyaan ini, model belum production-ready.

---

## 38. Operationally Meaningful Activity IDs

Selain nama visual, BPMN element punya ID.

Nama visual bisa berubah, tetapi ID sering masuk ke logs, incidents, metrics, dan code.

Buruk:

```text
Activity_0abc123
Gateway_1xyz987
Event_09kllp2
```

Baik:

```text
ValidateApplicationSubmission
ReviewApplicationCompleteness
Gateway_IsApplicationComplete
RequestMissingInformation
WaitForApplicantResubmission
GenerateDecisionLetter
NotifyApplicantOfDecision
```

Jika ID autogenerated, production log menjadi sulit dibaca.

Discipline:

1. set ID manual untuk element penting,
2. gunakan PascalCase atau snake_case konsisten,
3. jangan sering ganti ID tanpa alasan,
4. treat ID sebagai contract dengan worker/test/monitoring.

---

## 39. Versioning Discipline sejak Awal

BPMN versioning bukan masalah nanti. Ia harus dipikirkan sejak model pertama.

Karena process instance bisa hidup lama.

Contoh:

```text
Version 1 deployed January.
10.000 instances started.
Version 2 deployed March.
3.000 old instances still running on Version 1.
Business asks to change review path.
```

Pertanyaan:

1. Apakah instance lama tetap jalan di v1?
2. Apakah instance lama harus migrate ke v2?
3. Apakah variable schema compatible?
4. Apakah worker masih support v1 job types?
5. Apakah task UI masih support old task forms?
6. Apakah audit bisa membedakan v1 dan v2?

Jika tidak dipikir sejak awal, deployment process baru bisa merusak instance lama secara halus.

---

## 40. Backward-Compatible BPMN Change

Biasanya relatif aman:

1. mengganti label visual tanpa mengganti element ID,
2. menambah documentation,
3. menambah non-disruptive monitoring,
4. menambah optional variable dengan default,
5. memperbaiki expression tanpa mengubah path besar,
6. memperbaiki worker implementation kompatibel.

Tetapi tetap perlu test.

---

## 41. Breaking BPMN Change

Berisiko:

1. menghapus activity tempat instance lama mungkin sedang menunggu,
2. mengganti element ID,
3. mengganti job type,
4. mengganti variable wajib,
5. mengubah gateway condition secara fundamental,
6. menghapus message catch event,
7. mengganti correlation key,
8. mengubah subprocess contract,
9. mengganti user task form contract,
10. mengubah compensation path.

Breaking change harus punya migration strategy.

---

## 42. Model for Change: Extension Points

Buat model dengan titik perubahan yang wajar.

Contoh:

```text
Assess Application
 -> Determine Required Reviews
 -> Parallel Reviews
 -> Consolidate Review Outcome
```

Jika nanti ada review tambahan, Anda bisa menambah path di area review, bukan mengubah seluruh process.

Gunakan subprocess untuk area yang sering berubah:

```text
Call Activity: Conduct Eligibility Assessment
Call Activity: Conduct Legal Review
Call Activity: Conduct Payment Collection
```

Tetapi jangan membuat extension point palsu di semua tempat. Terlalu banyak abstraction juga buruk.

---

## 43. Model Ownership

Setiap BPMN process harus punya owner.

Minimal:

```text
Business owner: siapa pemilik policy/process?
Technical owner: siapa pemilik implementation?
Operations owner: siapa yang support production?
Data owner: siapa pemilik data utama?
Security owner: siapa review access?
```

Tanpa ownership, BPMN menjadi yatim.

Gejala BPMN yatim:

1. tidak ada yang berani mengubah,
2. tidak ada yang tahu kenapa gateway dibuat,
3. worker berubah tanpa update diagram,
4. business rule tersebar,
5. production support hanya retry tanpa paham impact.

---

## 44. Modeling Review Ritual

BPMN harus direview dari beberapa sudut.

### 44.1 Business Review

Pertanyaan:

1. Apakah process sesuai policy?
2. Apakah actor benar?
3. Apakah decision points benar?
4. Apakah SLA benar?
5. Apakah outcome lengkap?
6. Apakah exception business lengkap?

---

### 44.2 Engineering Review

Pertanyaan:

1. Apakah model executable?
2. Apakah variable contract jelas?
3. Apakah worker type jelas?
4. Apakah idempotency dipikirkan?
5. Apakah external side effect aman?
6. Apakah message correlation aman?
7. Apakah timer behavior jelas?
8. Apakah error handling tepat?

---

### 44.3 Operations Review

Pertanyaan:

1. Bagaimana tahu instance stuck?
2. Apa incident yang mungkin terjadi?
3. Apa retry strategy?
4. Apa manual repair strategy?
5. Apa alert yang diperlukan?
6. Apa dashboard yang diperlukan?
7. Apa runbook yang diperlukan?

---

### 44.4 Audit/Security Review

Pertanyaan:

1. Apakah decision terekam?
2. Apakah actor terekam?
3. Apakah reason code wajib?
4. Apakah privileged action terkendali?
5. Apakah PII minimization diterapkan?
6. Apakah process variable aman?
7. Apakah admin repair terekam?

---

## 45. Design Documentation di Sekitar BPMN

BPMN saja tidak cukup.

Untuk production, sertakan dokumen pendamping.

Minimal:

```text
1. Process overview
2. BPMN model
3. Element catalog
4. Variable contract
5. Worker catalog
6. Message catalog
7. Timer/SLA catalog
8. Error/incident catalog
9. Authorization matrix
10. Audit event mapping
11. Versioning/migration note
12. Operations runbook
```

---

## 46. Element Catalog Template

Gunakan tabel seperti ini.

| Element ID | Name | Type | Owner | Input | Output | Failure Handling | Audit Event |
|---|---|---|---|---|---|---|---|
| ValidateApplicationSubmission | Validate Application Submission | Service Task | System | applicationId | validationOutcome | incident on technical failure | APPLICATION_VALIDATED |
| ReviewApplicationCompleteness | Review Application Completeness | User Task | Officer | applicationId, documents | reviewOutcome, reasonCode | reassignment/escalation | COMPLETENESS_REVIEW_COMPLETED |
| WaitForApplicantResubmission | Wait for Applicant Resubmission | Message Catch/User Task equivalent | Applicant | applicationId | resubmittedDocumentIds | timeout auto-close | APPLICANT_RESUBMITTED |

Ini membuat model bisa dimengerti lintas role.

---

## 47. Worker Catalog Template

| Job Type | Worker Service | Idempotency Key | External Dependency | Retry | BPMN Error | Incident Condition |
|---|---|---|---|---|---|---|
| validate-application-submission | application-worker | applicationId + elementInstanceKey | Application DB | 3 technical retries | InvalidSubmission | DB unavailable after retries |
| generate-decision-letter | document-worker | decisionId | Document Service | 5 retries | TemplateNotFound | document service unavailable |
| send-applicant-notification | notification-worker | notificationRequestId | Email/SMS Gateway | retry with backoff | NotificationRejected | retry exhausted |

Worker catalog mencegah job type menjadi tribal knowledge.

---

## 48. Message Catalog Template

| Message Name | Correlation Key | Published By | Consumed By | TTL | Duplicate Handling | Late Message Handling |
|---|---|---|---|---|---|---|
| ApplicantResubmissionReceived | applicationId | Portal API | Application Process | 30 days | dedup by submissionId | reject or create incident |
| PaymentConfirmed | paymentReference | Payment Service | Payment Subprocess | 7 days | dedup by paymentEventId | ignore if case closed |
| ExternalAgencyResponseReceived | requestId | Agency Connector | Assessment Process | 14 days | dedup by agencyResponseId | manual review |

Message behavior harus eksplisit karena correlation failure adalah salah satu sumber incident terbesar.

---

## 49. Timer/SLA Catalog Template

| Timer | Attached To | Type | Duration/Date | Interrupting | Business Meaning | Action |
|---|---|---|---|---|---|---|
| ResubmissionReminderDue | WaitForApplicantResubmission | Boundary Timer | every 7 days | No | applicant has not responded | send reminder |
| ResubmissionDeadlineReached | WaitForApplicantResubmission | Boundary Timer | 30 days | Yes | applicant failed to respond | close application |
| OfficerReviewSLABreached | ReviewApplicationCompleteness | Boundary Timer | 5 working days | No | review overdue | escalate to supervisor |

Tanpa catalog, timer mudah salah interpretasi.

---

## 50. Error/Incident Catalog Template

| Failure | Type | Where | Engine Action | Business Action | Manual Repair |
|---|---|---|---|---|---|
| External registry unavailable | Technical | ValidateApplicantWithRegistry | retry then incident | none until resolved | retry job after service recovers |
| Applicant not found | Business | ValidateApplicantWithRegistry | BPMN error | reject/ask correction | officer review |
| Decision letter template missing | Configuration | GenerateDecisionLetter | incident | pause issuance | upload template then retry |
| Payment rejected | Business | CollectPayment | BPMN error | request new payment | applicant action |

Perbedaan business error vs technical incident harus jelas.

---

## 51. Diagram Readability Rules

BPMN yang sulit dibaca biasanya sulit dioperasikan.

Rules praktis:

1. flow utama kiri ke kanan,
2. start di kiri, end di kanan,
3. jangan crossing sequence flow jika bisa dihindari,
4. gunakan subprocess untuk complexity lokal,
5. gunakan event subprocess untuk cross-cutting event,
6. jangan terlalu banyak label teknis,
7. jangan lebih dari 7–9 major blocks di satu view,
8. gateway harus diberi nama,
9. end event harus diberi nama outcome,
10. gunakan annotation secukupnya,
11. hindari loop visual yang membingungkan,
12. gunakan collapsed subprocess untuk readability.

---

## 52. The 7±2 Rule untuk High-level Model

High-level diagram sebaiknya punya sekitar 5–9 blok utama.

Contoh application lifecycle:

```text
1. Receive Application
2. Validate Submission
3. Review Completeness
4. Assess Application
5. Decide Outcome
6. Issue Decision
7. Notify Applicant
8. Close Case
```

Detail masing-masing bisa masuk subprocess.

Jika satu diagram punya 40 activity di level yang sama, kemungkinan abstraction-nya salah.

---

## 53. Modeling Loops dengan Hati-hati

Loop umum dalam business process:

```text
Request Missing Information
 -> Wait for Resubmission
 -> Review Completeness Again
```

Ini wajar.

Tetapi harus ada boundary:

1. maksimal berapa kali?
2. batas waktu?
3. apakah semua field bisa direquest ulang?
4. apakah officer harus memberi reason?
5. apakah applicant bisa withdraw?
6. apakah system auto-close?

Tanpa boundary, loop bisa infinite secara business.

---

## 54. Loop Counter dan Attempt Tracking

Untuk loop production, simpan variable eksplisit.

```json
{
  "resubmissionAttempt": 2,
  "maxResubmissionAttempts": 3,
  "lastResubmissionRequestedAt": "2026-06-17T10:00:00+08:00"
}
```

Gateway:

```text
Has Applicant Exceeded Resubmission Limit?
  -> Yes: Close Application / Escalate
  -> No: Request Missing Information Again
```

Loop tanpa counter sulit diaudit.

---

## 55. Modeling Cancellation

Business process sering bisa dibatalkan.

Contoh:

1. applicant withdraws application,
2. officer cancels duplicate case,
3. payment expires,
4. external agency revokes request,
5. admin cancels mistaken process.

Cancellation harus eksplisit.

Pattern:

```text
Event Subprocess: Application Withdrawal Received
  -> Cancel Active Review Tasks
  -> Mark Application Withdrawn
  -> Notify Relevant Parties
  -> End: Application Withdrawn
```

Jika cancellation bisa terjadi dari banyak state, event subprocess lebih bersih daripada menempel boundary event di semua activity.

---

## 56. Modeling Reopen

Reopen adalah sumber kompleksitas.

Pertanyaan:

1. Reopen dari state apa saja?
2. Siapa boleh reopen?
3. Apakah process instance lama dilanjutkan atau process baru dibuat?
4. Apakah audit chain harus satu atau baru?
5. Apakah SLA reset?
6. Apakah decision lama tetap valid?
7. Apakah downstream effects harus dikompensasi?

Jangan menambahkan `Reopen` sebagai panah balik sembarangan.

Lebih sehat:

```text
Closed Application
 -> Message: Reopen Approved
 -> Start Reopen Process
 -> Review Reopen Reason
 -> Restore Case to Appropriate Stage
```

Kadang process baru lebih aman daripada resurrect instance lama.

---

## 57. Modeling Repair Path

Tidak semua repair harus ada di BPMN.

Ada tiga jenis repair.

### 57.1 Business Repair

Contoh:

```text
Officer corrects wrong review outcome before final approval.
```

Ini bisa dimodelkan sebagai task/path.

---

### 57.2 Operational Repair

Contoh:

```text
Document service was down, retry Generate Decision Letter job.
```

Ini biasanya runbook/Operate action, bukan BPMN path.

---

### 57.3 Data Repair

Contoh:

```text
Wrong applicant ID stored due to migration bug.
```

Ini harus sangat controlled, audited, mungkin lewat admin tool, bukan hidden BPMN gateway.

---

## 58. Jangan Campur Business Exception dan Technical Exception

Contoh business exception:

```text
Applicant is not eligible.
Required document is missing.
Payment was rejected.
Application was withdrawn.
Deadline expired.
```

Contoh technical exception:

```text
Database timeout.
External API 503.
Network failure.
Serialization error.
Worker crashed.
Template file unavailable.
```

Business exception biasanya menjadi BPMN path.

Technical exception biasanya retry/incident.

Jangan modelkan:

```text
Gateway: Is Database Down?
```

Kecuali downtime itu memang punya business process khusus seperti disaster recovery/manual queue.

---

## 59. Error Boundary Event Discipline

Boundary error event cocok jika worker bisa menyatakan business error.

Contoh:

```text
Service Task: Validate Applicant Eligibility
  boundary error ApplicantNotEligible
    -> Prepare Rejection Decision
```

Tetapi jangan gunakan BPMN error untuk semua Java exception.

Buruk:

```text
catch(Exception e) -> throw BPMN Error "SystemError"
```

Ini menyembunyikan incident teknis sebagai business path.

Lebih baik:

```text
Known business condition -> BPMN error
Unexpected technical failure -> fail job/retry/incident
```

---

## 60. Compensation Discipline

Compensation bukan rollback database.

Compensation adalah business action untuk mengurangi/menetralkan efek dari action sebelumnya.

Contoh:

```text
Issue License
 -> later process fails
 -> Revoke Issued License
```

Atau:

```text
Collect Payment
 -> approval cannot proceed
 -> Initiate Refund
```

Pertanyaan compensation:

1. Apakah action sebelumnya benar-benar bisa dibalik?
2. Apakah compensation butuh approval?
3. Apakah compensation bisa gagal?
4. Apakah compensation idempotent?
5. Apakah compensation memiliki audit event sendiri?
6. Apakah compensation mengubah legal/business state?

Jangan menggambar compensation hanya karena terlihat canggih.

---

## 61. Modeling Parallelism

Parallelism di BPMN harus punya alasan bisnis atau performa.

Contoh alasan bisnis:

```text
Legal Review and Technical Review can happen independently.
```

Contoh alasan performa:

```text
Fetch data from three independent external systems.
```

Tetapi parallelism membawa risiko:

1. race condition,
2. duplicate updates,
3. partial failure,
4. join stuck,
5. inconsistent outcome,
6. hard-to-debug incidents.

Jangan gunakan parallel gateway hanya untuk terlihat efisien.

---

## 62. Join Discipline

Jika split parallel, pikirkan join.

Pertanyaan:

1. Apakah semua branch harus selesai?
2. Apakah satu rejection cukup untuk stop?
3. Apakah ada timeout per branch?
4. Apakah branch bisa dibatalkan?
5. Apakah partial result boleh dipakai?
6. Apakah join menunggu branch yang mungkin tidak pernah aktif?

Untuk approval committee, sering butuh multi-instance dengan completion condition, bukan parallel gateway statis.

---

## 63. Multi-instance Discipline

Multi-instance cocok untuk:

1. review oleh banyak officer,
2. approval oleh beberapa agency,
3. document verification per document,
4. notification per recipient,
5. external check per external registry.

Tetapi harus jelas:

1. input collection,
2. sequential atau parallel,
3. output collection,
4. completion condition,
5. partial failure handling,
6. cancellation behavior,
7. audit per item.

Contoh:

```text
Multi-instance Task: Conduct Agency Review
Input: requiredAgencyReviews[]
Completion: all required agencies responded OR deadline reached
Output: agencyReviewResults[]
```

---

## 64. Business Key Discipline

Business key adalah anchor manusia.

Contoh:

```text
applicationId = APP-2026-000123
caseId = CASE-2026-000991
paymentReference = PAY-2026-00421
```

Engine key biasanya technical.

Business key membuat logs, audit, UI, dan operations bisa bicara bahasa yang sama.

Setiap process instance harus punya business identifier yang jelas.

---

## 65. Correlation Discipline

Untuk message event, correlation key harus stabil.

Buruk:

```text
correlationKey = applicantName
correlationKey = email
correlationKey = timestamp
```

Baik:

```text
correlationKey = applicationId
correlationKey = paymentReference
correlationKey = externalRequestId
correlationKey = caseId
```

Pertanyaan correlation:

1. Apakah key unique?
2. Apakah key stable?
3. Apakah sender dan receiver sepakat?
4. Apakah duplicate message bisa terjadi?
5. Apakah message bisa datang sebelum process menunggu?
6. Apakah message bisa datang setelah process selesai?
7. Apakah TTL benar?

---

## 66. Modeling Events That Arrive Early or Late

Event-driven workflow selalu punya race.

Contoh:

```text
PaymentConfirmed event arrives before process reaches Wait for Payment.
```

Atau:

```text
ApplicantResubmissionReceived arrives after application auto-closed.
```

Model harus punya strategy.

Opsi:

1. message buffering with TTL,
2. correlation table,
3. idempotent API command,
4. reject late event,
5. start compensation/reopen process,
6. manual review queue.

Jangan asumsi event selalu datang saat engine siap.

---

## 67. Modeling for Testing

BPMN yang baik mudah dites.

Setiap gateway path harus punya scenario.

Contoh:

```text
Scenario 1: Complete application -> assessment -> approved.
Scenario 2: Incomplete application -> request info -> resubmitted -> approved.
Scenario 3: Incomplete application -> no response -> auto close.
Scenario 4: Applicant ineligible -> rejection.
Scenario 5: Document generation fails -> incident -> retry -> success.
Scenario 6: Legal review required -> legal approval -> final approval.
Scenario 7: Applicant withdraws during assessment -> withdrawn.
```

Jika Anda tidak bisa menulis scenario untuk path, mungkin path tidak jelas.

---

## 68. Golden Path dan Golden Failure Path

Jangan hanya test happy path.

Untuk workflow, failure path sering lebih penting.

Minimal test:

1. happy path,
2. main rejection path,
3. missing information loop,
4. timeout path,
5. message correlation path,
6. technical incident path,
7. retry success after failure,
8. duplicate message,
9. late message,
10. process cancellation.

Top engineer tidak hanya bertanya “apakah jalan?” tetapi “bagaimana rusaknya?”

---

## 69. Modeling for Security

BPMN sering memperlihatkan process, tetapi security ada di beberapa layer.

Security questions:

1. Siapa boleh start process?
2. Siapa boleh see task?
3. Siapa boleh claim task?
4. Siapa boleh complete task?
5. Siapa boleh choose outcome?
6. Siapa boleh override?
7. Siapa boleh cancel process?
8. Siapa boleh retry incident?
9. Siapa boleh modify variable?
10. Siapa boleh migrate instance?

Jangan menaruh semua security assumption di diagram.

Buat authorization matrix.

---

## 70. Authorization Matrix Template

| Action | Role | Condition | Audit Required |
|---|---|---|---|
| Start Application Process | Applicant | owns draft application | yes |
| Review Completeness | Officer | assigned/candidate group | yes |
| Approve Recommendation | Supervisor | not same as maker if four-eyes applies | yes |
| Retry Technical Incident | Support Engineer | incident category allowed | yes |
| Cancel Process | Admin | approved operational request | yes |
| Reassign Task | Team Lead | within same unit | yes |

This matrix is not optional for serious workflow systems.

---

## 71. Modeling Four-eyes Principle

Four-eyes principle:

```text
The same person must not both prepare and approve a decision.
```

Model:

```text
Prepare Recommendation
 -> Approve Recommendation
```

But implementation needs:

1. store maker user id,
2. exclude maker from approver candidates,
3. validate at completion time,
4. audit both actions,
5. handle delegation/reassignment.

BPMN shows the separation. Code enforces it.

---

## 72. Modeling Dynamic Assignment

Assignment can depend on:

1. case type,
2. risk score,
3. officer workload,
4. region,
5. licence type,
6. conflict of interest,
7. delegation period,
8. user availability.

Do not encode all assignment rules in BPMN gateways.

Better:

```text
Service Task: Determine Review Assignment
User Task: Review Application Completeness
```

Assignment service returns:

```json
{
  "candidateGroups": ["LICENSING_OFFICER"],
  "assignee": null,
  "priority": "HIGH",
  "dueDate": "2026-06-24T17:00:00+08:00"
}
```

---

## 73. Modeling Priority

Priority should not be random.

Priority can be based on:

1. statutory deadline,
2. case severity,
3. risk score,
4. VIP/urgent marker,
5. appeal deadline,
6. enforcement impact,
7. public safety concern.

If priority affects workflow, show it.

Example:

```text
Determine Case Priority
 -> Gateway: Is Case High Priority?
      yes -> Assign Senior Officer and Short SLA
      no  -> Assign Standard Queue
```

If priority only affects task sorting, keep it in task metadata.

---

## 74. Avoiding Workflow as Distributed Monolith

A BPMN process can become distributed monolith if it controls every detail of every service.

Symptoms:

1. every microservice action is a BPMN task,
2. all teams must change central process for local changes,
3. process variables contain data from all domains,
4. central workflow knows too much,
5. service autonomy disappears,
6. deployment coupling increases,
7. BPMN becomes integration god.

Healthy orchestration:

```text
BPMN coordinates business milestones.
Services own domain logic and data.
Events communicate state transitions.
Workers adapt process commands to service calls.
```

---

## 75. Avoiding Workflow as Anemic Status Tracker

Opposite anti-pattern: BPMN exists but does nothing meaningful.

Symptoms:

1. process only mirrors status column,
2. all decisions happen outside engine,
3. no timer,
4. no message correlation,
5. no human task lifecycle,
6. no incident management,
7. no value over custom status table.

If BPMN only says:

```text
Submitted -> Processing -> Completed
```

Ask whether a simple state machine is enough.

---

## 76. BPMN and State Machine Hybrid

In complex regulatory systems, BPMN and state machine often coexist.

Example:

```text
Application domain state machine:
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED -> REJECTED -> WITHDRAWN

BPMN process:
Submission received -> validate -> completeness review -> assessment -> approval -> notification
```

The state machine protects entity invariants.

The BPMN process coordinates long-running actions.

This hybrid is often stronger than choosing only one.

---

## 77. Business Invariants Must Not Depend Only on Diagram Shape

Example invariant:

```text
A rejected application cannot be approved unless reopened by authorized role.
```

Do not rely only on BPMN path to enforce this.

Also enforce in domain service:

```java
application.approve(...) should reject invalid transition.
```

Why?

Because actions may come from:

1. BPMN worker,
2. admin API,
3. migration script,
4. batch repair,
5. integration event,
6. future process version.

Domain invariants belong in domain model/service.

---

## 78. BPMN Model as Communication Tool

Good BPMN reduces ambiguity between:

1. business user,
2. BA,
3. developer,
4. tester,
5. support,
6. auditor,
7. security reviewer,
8. project manager.

But only if it is readable.

A technically executable BPMN that business cannot understand loses half its value.

A business-readable BPMN that engine cannot execute is still useful as documentation, but not enough for orchestration.

The best model is intentionally layered:

```text
High-level business model for alignment.
Executable BPMN for runtime.
Technical specs for workers and integration.
Operational docs for production.
```

---

## 79. Production Modeling Checklist

Sebelum model dianggap siap, jawab checklist berikut.

### 79.1 Purpose

```text
[ ] Process punya tujuan bisnis yang jelas.
[ ] Start condition jelas.
[ ] End outcomes jelas.
[ ] Satu instance merepresentasikan entity/lifecycle yang jelas.
```

### 79.2 Readability

```text
[ ] Nama activity business-readable.
[ ] Gateway berbentuk pertanyaan.
[ ] End event menyatakan outcome.
[ ] Flow utama mudah diikuti.
[ ] Diagram tidak mencampur terlalu banyak level abstraksi.
```

### 79.3 Execution

```text
[ ] Semua service task punya job type/worker jelas.
[ ] Semua user task punya assignment rule.
[ ] Semua message event punya correlation key.
[ ] Semua timer punya business meaning.
[ ] Semua gateway punya condition/default path.
```

### 79.4 Data

```text
[ ] Variable contract jelas.
[ ] Variable tidak menyimpan payload besar tanpa alasan.
[ ] Sensitive data diminimalkan.
[ ] Domain DB tetap source of truth.
[ ] Variable schema versioning dipikirkan.
```

### 79.5 Failure

```text
[ ] Business error dipisahkan dari technical failure.
[ ] Retry strategy jelas.
[ ] Incident condition jelas.
[ ] Compensation diperlukan/tidak diperlukan sudah diputuskan.
[ ] Manual repair path/runbook tersedia.
```

### 79.6 Time

```text
[ ] SLA utama dimodelkan atau dimonitor.
[ ] Timer interrupting/non-interrupting jelas.
[ ] Deadline timezone/calendar jelas.
[ ] Expiry outcome jelas.
[ ] Race dengan user action/event dipikirkan.
```

### 79.7 Security and Audit

```text
[ ] Task authorization jelas.
[ ] Privileged operation jelas.
[ ] Audit event mapping tersedia.
[ ] Decision reason code jelas.
[ ] Four-eyes/delegation rule jelas jika relevan.
```

### 79.8 Versioning

```text
[ ] Running instance behavior saat deployment baru jelas.
[ ] Breaking change diidentifikasi.
[ ] Worker compatibility dipikirkan.
[ ] Migration strategy ada jika diperlukan.
[ ] Process version terekam untuk audit.
```

### 79.9 Operations

```text
[ ] Support bisa tahu instance menunggu apa.
[ ] Incident triage jelas.
[ ] Dashboard metric didefinisikan.
[ ] Alert rule didefinisikan.
[ ] Runbook tersedia untuk failure umum.
```

---

## 80. Worked Example: Application Approval Process

Mari mulai dari model buruk.

### 80.1 Bad Model

```text
Start
 -> Process Application
 -> Check
 -> Update
 -> Email
 -> End
```

Masalah:

1. tidak jelas process instance merepresentasikan apa,
2. tidak ada actor,
3. tidak ada wait state,
4. tidak ada outcome,
5. tidak ada SLA,
6. tidak ada error handling,
7. tidak ada audit points,
8. tidak ada variable contract,
9. tidak operable.

---

### 80.2 Better High-level Model

```text
Application Submitted
 -> Validate Application Submission
 -> Review Application Completeness
 -> Assess Application
 -> Decide Application Outcome
 -> Notify Applicant of Decision
 -> Application Closed
```

Lebih baik, tetapi masih kurang exception.

---

### 80.3 Production-aware Model

```text
Application Submitted
 -> Validate Application Submission
 -> Gateway: Is Submission Valid?
      No  -> Reject Invalid Submission
      Yes -> Create Application Case
 -> Wait for Officer Completeness Review
 -> Gateway: Is Application Complete?
      No  -> Request Missing Information
              -> Wait for Applicant Resubmission
                  -> boundary timer 30 days: Close Due to No Response
                  -> Applicant Resubmission Received -> Review Application Completeness Again
      Yes -> Assess Application Eligibility
 -> Gateway: Is Applicant Eligible?
      No  -> Prepare Rejection Decision
      Yes -> Determine Approval Requirements
 -> Gateway: Is Supervisor Approval Required?
      Yes -> Wait for Supervisor Approval
      No  -> Generate Decision Letter
 -> Generate Decision Letter
      technical failure -> retry/incident
 -> Notify Applicant of Decision
 -> End: Application Approved or Rejected
```

Ini mulai production-aware karena:

1. valid/invalid path ada,
2. missing info loop ada,
3. timeout ada,
4. assessment outcome ada,
5. approval requirement ada,
6. document generation failure dipikirkan,
7. notification eksplisit,
8. outcome end event jelas.

---

## 81. Worked Example: Enforcement Case Process

High-level:

```text
Case Created
 -> Triage Case
 -> Assign Investigation Officer
 -> Conduct Investigation
 -> Determine Enforcement Recommendation
 -> Supervisor Review
 -> Issue Enforcement Decision
 -> Monitor Compliance
 -> Close Case
```

Production concerns:

1. complaint withdrawal,
2. duplicate case merge,
3. evidence request timeout,
4. external agency input,
5. legal review,
6. urgent suspension,
7. appeal,
8. non-compliance escalation,
9. audit defensibility,
10. confidentiality/security.

Modeling strategy:

```text
Main Process: Enforcement Case Lifecycle
  -> Subprocess: Case Triage
  -> Subprocess: Investigation
  -> Subprocess: Enforcement Decision
  -> Subprocess: Compliance Monitoring

Event Subprocesses:
  -> Case Withdrawal / Duplicate Closure
  -> Urgent Suspension Trigger
  -> Appeal Received
  -> External Agency Response Received
```

Kenapa event subprocess?

Karena beberapa event bisa terjadi di banyak state. Jika dipasang sebagai boundary event di semua activity, diagram hancur.

---

## 82. Diagram Smells

### 82.1 Spaghetti Sequence Flow

Gejala:

1. banyak crossing arrows,
2. gateway nested dalam gateway,
3. panah balik tidak jelas,
4. impossible to explain in 2 minutes.

Solusi:

1. extract subprocess,
2. split process,
3. use event subprocess,
4. simplify gateway decisions,
5. separate business and technical concerns.

---

### 82.2 Giant Gateway

Gejala:

```text
Gateway dengan 8+ outgoing branches.
```

Solusi:

1. pecah menjadi beberapa gateway bertahap,
2. gunakan DMN untuk decision,
3. return normalized decision outcome,
4. route berdasarkan outcome.

---

### 82.3 Technical Micro-task Explosion

Gejala:

```text
BPMN berisi DTO mapping, SQL update, string formatting, logging.
```

Solusi:

1. gabungkan dalam service task meaningful,
2. pindahkan detail ke Java worker,
3. dokumentasikan worker internals di design note.

---

### 82.4 Hidden Business Logic in Worker

Gejala:

```text
BPMN hanya Process Application, semua approval/rejection di Java if/else.
```

Solusi:

1. expose major decision points di BPMN,
2. gunakan DMN/domain service untuk decision,
3. gateway route berdasarkan business outcome.

---

### 82.5 Variable Dumping Ground

Gejala:

```text
processVariables.put("payload", entireEverything);
```

Solusi:

1. define variable contract,
2. store references,
3. keep domain data in domain DB,
4. minimize PII.

---

### 82.6 No Operational Path

Gejala:

1. no incident strategy,
2. no retry classification,
3. no support visibility,
4. no runbook.

Solusi:

1. define failure catalog,
2. define metrics,
3. define repair procedures,
4. model business errors explicitly.

---

## 83. BPMN Modeling Decision Matrix

| Situation | Prefer |
|---|---|
| Human approval needed | User task |
| Wait for external event | Message catch event |
| Deadline changes process path | Timer event |
| Reusable process fragment | Call activity/subprocess |
| Complex policy decision | DMN/rule service + gateway |
| Technical retry | Worker retry/incident |
| Business rejection | BPMN path/error |
| External side effect | Explicit service task |
| Large data manipulation | Java/domain service |
| Entity invariant | Domain model/state machine |
| Cross-cutting cancellation | Event subprocess |
| Reporting-only SLA | Monitoring/history query |
| Process-changing SLA | BPMN timer |

---

## 84. How Top Engineers Review BPMN

Engineer biasa bertanya:

```text
Apakah diagramnya benar?
```

Engineer matang bertanya:

```text
Apa invariant proses ini?
Apa yang bisa stuck?
Apa yang bisa duplicate?
Apa yang bisa terlambat?
Apa yang bisa gagal setelah side effect?
Apa yang harus diaudit?
Apa yang berubah kalau policy berubah?
Apa yang terjadi pada instance lama?
Apa yang support lihat jam 2 pagi?
Apa yang business tidak boleh kompromikan?
```

BPMN review bukan estetika. BPMN review adalah failure modeling.

---

## 85. Practical Modeling Workflow

Gunakan workflow kerja ini saat membuat BPMN baru.

```text
1. Define business objective.
2. Define process instance meaning.
3. Define start event and end outcomes.
4. Draw happy path in 5–9 steps.
5. Identify wait states.
6. Identify human actors.
7. Identify major business decisions.
8. Identify time/SLA behavior.
9. Identify external side effects.
10. Identify message/event interactions.
11. Identify business exceptions.
12. Identify technical failures.
13. Define variable contract.
14. Define worker catalog.
15. Define audit events.
16. Define authorization matrix.
17. Define test scenarios.
18. Define operations runbook.
19. Review for readability.
20. Review for versioning/migration.
```

---

## 86. Java Engineer Perspective: Where Code Belongs

Dalam Java project, struktur sehat bisa seperti ini.

```text
src/main/resources/bpmn/
  application-lifecycle.bpmn
  document-verification.bpmn
  payment-collection.bpmn

src/main/java/com/example/workflow/
  ApplicationWorkflowClient.java
  ProcessVariableMapper.java
  WorkflowConstants.java

src/main/java/com/example/workers/application/
  ValidateApplicationSubmissionWorker.java
  CreateCaseRecordWorker.java
  AssessEligibilityWorker.java
  GenerateDecisionLetterWorker.java
  NotifyApplicantWorker.java

src/main/java/com/example/domain/application/
  Application.java
  ApplicationStatus.java
  ApplicationService.java
  ApplicationRepository.java

src/main/java/com/example/audit/
  AuditEventPublisher.java
  AuditEvent.java

src/test/java/com/example/workflow/
  ApplicationLifecycleProcessTest.java
  ApplicationLifecycleFailurePathTest.java
```

Separation:

```text
BPMN = orchestration contract.
Worker = adapter from workflow job to domain service.
Domain service = business invariant and state mutation.
Repository = persistence.
Audit = evidence.
Tests = path confidence.
```

---

## 87. Java 8 hingga Java 25 Consideration

Modeling discipline tidak terlalu berubah antara Java 8 dan Java 25, tetapi implementation style berubah.

### Java 8

1. common in legacy Camunda 7 systems,
2. external task workers often imperative,
3. CompletableFuture available but limited style,
4. avoid overcomplicated async worker logic,
5. focus on idempotency and transaction boundaries.

### Java 11/17

1. common enterprise baseline,
2. better HTTP client from Java 11,
3. stronger container runtime support,
4. Spring Boot 2/3 depending version,
5. good baseline for Camunda worker services.

### Java 21/25

1. virtual threads become relevant for IO-heavy workers,
2. structured concurrency may help orchestration inside worker code,
3. records/sealed classes improve variable/result modeling,
4. pattern matching improves decision mapping,
5. still do not confuse Java concurrency with BPMN orchestration.

Important:

```text
Virtual threads can improve worker implementation concurrency.
They do not remove the need for BPMN wait states, idempotency, correlation, or audit.
```

---

## 88. Example: Worker Result Modeling in Modern Java

For Java 17+:

```java
public sealed interface CompletenessReviewResult
        permits CompletenessReviewResult.Complete,
                CompletenessReviewResult.Incomplete,
                CompletenessReviewResult.Duplicate {

    record Complete() implements CompletenessReviewResult {}

    record Incomplete(List<String> missingDocumentCodes,
                      String reasonCode) implements CompletenessReviewResult {}

    record Duplicate(String duplicateApplicationId) implements CompletenessReviewResult {}
}
```

Then map to process variable:

```java
Map<String, Object> variables = switch (result) {
    case CompletenessReviewResult.Complete ignored -> Map.of(
            "completenessOutcome", "COMPLETE"
    );
    case CompletenessReviewResult.Incomplete incomplete -> Map.of(
            "completenessOutcome", "INCOMPLETE",
            "missingDocumentCodes", incomplete.missingDocumentCodes(),
            "reasonCode", incomplete.reasonCode()
    );
    case CompletenessReviewResult.Duplicate duplicate -> Map.of(
            "completenessOutcome", "DUPLICATE",
            "duplicateApplicationId", duplicate.duplicateApplicationId()
    );
};
```

The BPMN gateway should route on `completenessOutcome`.

This is cleaner than boolean flags.

---

## 89. The Most Important Invariants

Untuk BPMN production, invariants lebih penting daripada diagram shape.

Contoh invariants:

```text
Every process instance has exactly one business key.
Every human decision has actor, timestamp, outcome, and reason.
Every external side effect has idempotency key.
Every message correlation uses stable key.
Every timer has defined business meaning.
Every business error has defined path.
Every technical failure has retry/incident strategy.
Every process version is auditable.
Every long-running wait state has owner and SLA.
Every manual repair is audited.
```

Jika invariants ini dijaga, model cenderung sehat.

---

## 90. Summary

BPMN modeling discipline adalah kemampuan untuk menjaga agar process model tetap:

1. readable,
2. executable,
3. testable,
4. operable,
5. auditable,
6. secure,
7. evolvable.

Inti Part 3:

```text
Do not model BPMN as a drawing.
Model BPMN as a production contract.
```

Production-grade BPMN bukan diagram yang paling penuh. Ia adalah diagram yang paling jelas boundary-nya:

```text
apa yang menjadi flow,
apa yang menjadi decision,
apa yang menjadi wait state,
apa yang menjadi domain logic,
apa yang menjadi technical failure,
apa yang menjadi audit evidence,
apa yang menjadi operational repair.
```

Engineer yang kuat tidak hanya tahu simbol BPMN. Ia bisa membuat process model yang tetap masuk akal setelah:

1. policy berubah,
2. worker gagal,
3. event datang terlambat,
4. SLA breach,
5. instance lama masih running,
6. auditor meminta explanation,
7. support harus repair production,
8. business meminta extension baru.

Itulah discipline yang akan membuat BPMN/Camunda menjadi engineering asset, bukan liability.

---

## 91. Checklist Cepat Part 3

Simpan checklist ini saat review model BPMN:

```text
[ ] Satu process instance merepresentasikan lifecycle yang jelas.
[ ] Diagram punya satu level abstraction.
[ ] Happy path jelas.
[ ] Exception path utama jelas.
[ ] Wait state punya owner, SLA, dan timeout strategy.
[ ] Gateway adalah pertanyaan bisnis.
[ ] User task adalah action manusia, bukan status palsu.
[ ] Service task cukup penting untuk terlihat di orchestration.
[ ] External side effect punya idempotency/failure strategy.
[ ] Variable contract minimal dan jelas.
[ ] Domain state dan process state tidak dicampur.
[ ] Message correlation key stabil.
[ ] Timer punya business meaning.
[ ] Business error dan technical failure dipisahkan.
[ ] Audit event mapping tersedia.
[ ] Authorization matrix tersedia.
[ ] Versioning impact dipikirkan.
[ ] Operations runbook bisa dibuat dari model.
```

---

## 92. Apa yang Akan Dibahas di Part 4

Part 4 akan masuk ke:

```text
Camunda Landscape: Camunda 7 vs Camunda 8
```

Kita akan membahas:

1. Camunda 7 embedded/database-centric architecture,
2. Camunda 8 Zeebe/log-stream/cloud-native architecture,
3. job executor vs job worker,
4. transaction model difference,
5. operational difference,
6. BPMN coverage difference,
7. migration reality,
8. kapan memilih Camunda 7, Camunda 8, Flowable, Temporal, Conductor, atau custom state machine.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 2 — BPMN Core Elements: Events, Tasks, Gateways, Subprocesses](./learn-java-bpmn-camunda-part-02-bpmn-core-elements-events-tasks-gateways-subprocesses.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 4 — Camunda Landscape: Camunda 7 vs Camunda 8](./learn-java-bpmn-camunda-part-04-camunda-landscape-camunda-7-vs-camunda-8.md)
