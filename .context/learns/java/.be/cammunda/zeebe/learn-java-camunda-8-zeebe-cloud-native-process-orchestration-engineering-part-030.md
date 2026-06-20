# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-030.md

# Part 030 — Case Management and Regulatory Lifecycle Modelling with Camunda 8

> **Target pembaca:** software engineer / tech lead yang sudah memahami Java backend, distributed systems, workflow orchestration, Camunda 7, dan dasar Camunda 8/Zeebe dari part sebelumnya.  
> **Fokus:** memodelkan lifecycle kasus panjang, tidak selalu linear, banyak aktor, banyak dokumen, banyak keputusan, banyak SLA, banyak exception, dan harus bisa dipertanggungjawabkan secara audit/regulatory.  
> **Bukan fokus:** mengulang BPMN basic, Java basic, HTTP basic, persistence basic, atau generic microservice pattern.

---

## 0. Posisi Part Ini Dalam Series

Di part sebelumnya kita sudah membangun fondasi:

1. **Camunda 8 bukan Camunda 7 versi baru.**
2. Zeebe adalah distributed orchestration engine.
3. Worker Java harus dianggap sebagai executor eksternal yang retryable dan idempotent.
4. Operate/Tasklist/Optimize adalah read/projection surface, bukan sumber kebenaran tunggal untuk semua keputusan.
5. Variable, message, timer, user task, error, deployment, observability, testing, dan migration harus didesain sebagai production contract.

Part ini membawa semua itu ke domain yang lebih sulit: **case management** dan **regulatory lifecycle modelling**.

Dalam sistem enterprise biasa, workflow sering berupa:

```text
request received -> validate -> approve -> complete
```

Tetapi dalam regulatory/case management, bentuknya lebih seperti:

```text
case opened
  -> triage
  -> assign officer
  -> request documents
  -> wait applicant response
  -> perform review
  -> parallel verification
  -> issue query
  -> escalate
  -> suspend clock
  -> resume
  -> request legal input
  -> make decision
  -> appeal
  -> enforcement
  -> close
  -> reopen if new evidence
```

Ini bukan sekadar “workflow panjang”. Ini adalah **lifecycle of a regulated entity or matter**.

---

## 1. Core Problem: Case Management Tidak Sama Dengan Straight-Through Workflow

### 1.1 Straight-through workflow

Straight-through workflow cocok ketika:

- alurnya relatif jelas,
- variasi sedikit,
- sebagian besar bisa diotomasi,
- data input cukup lengkap,
- manusia hanya melakukan approval,
- output relatif final.

Contoh:

```text
Submit order -> payment -> fulfillment -> delivery
```

Atau:

```text
Submit request -> validate -> approve/reject -> notify
```

BPMN sangat cocok untuk pola seperti ini.

### 1.2 Case management

Case management berbeda. Sebuah case biasanya memiliki karakteristik:

| Karakteristik | Implikasi Engineering |
|---|---|
| Long-running | state harus durable, versioning harus hati-hati |
| Human-heavy | assignment, workload, delegation, audit penting |
| Evidence-driven | dokumen, bukti, catatan, attachment perlu lifecycle sendiri |
| Non-linear | tidak semua step bisa ditentukan di awal |
| Decision-heavy | reason, basis hukum, review path harus jelas |
| SLA-heavy | deadline, suspension, extension, escalation harus formal |
| Reopenable | case bisa dibuka lagi setelah close |
| Multi-party | applicant, officer, reviewer, legal, agency, external party |
| Regulated | audit trail dan explainability bukan optional |
| Exception-rich | banyak jalur “tidak normal” justru normal secara bisnis |

Poin penting:

> Case bukan hanya process instance. Case adalah aggregate/domain entity yang memiliki lifecycle, evidence, actor, decision, history, dan policy. BPMN/Zeebe membantu mengorkestrasi lifecycle itu, tetapi tidak boleh dipaksa menjadi seluruh case database.

---

## 2. Camunda 8 Untuk Case Management: Apa Yang Cocok dan Apa Yang Tidak

Camunda 8 dapat digunakan untuk mengorkestrasi proses yang melibatkan manusia, sistem, connector, worker, dan long-running state. User task di Camunda 8 menciptakan task instance dan process instance berhenti sampai task diselesaikan. Ini cocok untuk human workflow yang membutuhkan assignment dan completion semantics.

Namun, Camunda 8 tidak boleh diperlakukan sebagai:

- primary case database,
- document management system,
- full-text evidence store,
- authorization master,
- master data system,
- reporting warehouse tunggal,
- case note store tunggal,
- policy/rule repository tunggal.

Camunda 8 paling tepat menjadi:

```text
durable orchestration layer
```

yang mengkoordinasikan:

```text
case domain service
document service
identity/authorization service
notification service
external verification service
payment/revenue service
appeal service
enforcement service
audit/read model
```

### 2.1 Prinsip utama

Gunakan Camunda untuk:

- milestone workflow,
- waiting states,
- human task coordination,
- escalation,
- timers,
- external callbacks,
- lifecycle orchestration,
- operational visibility,
- incident handling,
- audit-oriented process trace.

Gunakan domain application untuk:

- case aggregate,
- domain invariant,
- detailed case state,
- evidence metadata,
- authorization decision,
- complex search,
- role hierarchy,
- document retention,
- legal basis,
- business rule versioning,
- final source of truth untuk case data.

---

## 3. Mental Model: Case = Domain Aggregate, Process = Orchestration State

Salah satu kesalahan paling umum adalah menyamakan:

```text
case status == BPMN node
```

Ini berbahaya.

### 3.1 Case status

Case status adalah domain-level abstraction.

Contoh:

```text
DRAFT
SUBMITTED
UNDER_TRIAGE
UNDER_REVIEW
PENDING_APPLICANT
PENDING_EXTERNAL_AGENCY
PENDING_LEGAL_REVIEW
APPROVED
REJECTED
UNDER_APPEAL
ENFORCEMENT_IN_PROGRESS
CLOSED
REOPENED
```

Status ini dipahami user, BA, regulator, auditor, dan reporting.

### 3.2 BPMN node

BPMN node adalah execution-level position.

Contoh:

```text
Task_RequestAdditionalDocument
Timer_WaitApplicantResponse
Gateway_DocumentReceived
Task_OfficerReview
Event_ExternalVerificationCallback
```

Node ini membantu orchestration engine mengetahui apa yang harus ditunggu atau dijalankan.

### 3.3 Kenapa tidak boleh 1:1?

Karena satu status case dapat terdiri dari banyak node.

Contoh:

```text
Case status: UNDER_REVIEW
```

Di dalamnya bisa ada:

- officer review user task,
- automated compliance screening,
- timer SLA,
- legal consultation subprocess,
- request-for-information loop,
- external verification callback,
- non-interrupting escalation reminder.

Sebaliknya, satu BPMN node belum tentu cukup untuk menjelaskan case status bisnis.

### 3.4 Pattern yang lebih sehat

Gunakan dua state layer:

```text
┌──────────────────────────────────────────────┐
│ Case Domain State                            │
│ - status                                     │
│ - subStatus                                  │
│ - assignedOfficer                            │
│ - regulatoryClock                            │
│ - evidenceState                              │
│ - decisionState                              │
│ - appealState                                │
│ - enforcementState                           │
└──────────────────────────────────────────────┘
                      ▲
                      │ synchronized through explicit commands/events
                      ▼
┌──────────────────────────────────────────────┐
│ Camunda Process Orchestration State          │
│ - active BPMN element                         │
│ - waiting user task                           │
│ - waiting message                             │
│ - timer active                                │
│ - incident                                    │
│ - process variables                           │
└──────────────────────────────────────────────┘
```

Camunda mengorkestrasi. Domain service menjaga invariant.

---

## 4. Apa Yang Dimaksud Regulatory Lifecycle?

Regulatory lifecycle adalah rangkaian keadaan dan tindakan yang mengubah posisi hukum/administratif suatu entity, application, license, complaint, inspection, investigation, appeal, atau enforcement case.

Contoh domain:

- application assessment,
- license renewal,
- salesperson registration,
- compliance review,
- complaint handling,
- investigation,
- audit response,
- enforcement action,
- appeal,
- suspension/reinstatement,
- document rectification,
- examination eligibility,
- continuing professional education review.

### 4.1 Struktur umum

Banyak regulatory lifecycle memiliki pola:

```text
Intake
  -> Triage
  -> Assignment
  -> Completeness Check
  -> Substantive Review
  -> Clarification / RFI
  -> External Verification
  -> Internal Recommendation
  -> Approval / Rejection / Conditional Approval
  -> Notification
  -> Appeal Window
  -> Appeal Handling
  -> Enforcement / Closure
  -> Archival / Retention
```

Tetapi hampir selalu ada variasi:

- urgent path,
- exceptional approval,
- legal review,
- committee review,
- applicant non-response,
- extension request,
- withdrawal,
- partial approval,
- split decision,
- reopened case,
- related case impact,
- linked entity impact.

---

## 5. Process-Oriented vs Case-Oriented Thinking

### 5.1 Process-oriented thinking

Pertanyaan utamanya:

```text
What is the next step?
```

Cocok untuk:

- onboarding,
- fulfillment,
- payment,
- verification,
- approval flow sederhana.

### 5.2 Case-oriented thinking

Pertanyaan utamanya:

```text
Given everything we know about this case, what actions are legally, operationally, and procedurally allowed now?
```

Ini lebih sulit karena “next step” bisa bergantung pada:

- status evidence,
- SLA clock,
- officer role,
- conflict of interest,
- applicant response,
- linked cases,
- previous decision,
- statutory deadline,
- active appeal,
- external agency response,
- policy version,
- risk score,
- management override.

### 5.3 Konsekuensi desain

Jika proses terlalu linear, model akan gagal menghadapi real-world exceptions.

Jika model terlalu fleksibel, audit dan operasional sulit dikontrol.

Yang dibutuhkan adalah **controlled flexibility**.

---

## 6. Controlled Flexibility: Kunci Case Management Production-Grade

Controlled flexibility berarti sistem memberi ruang untuk variasi, tetapi semua variasi tetap:

- tercatat,
- diberi alasan,
- dibatasi role,
- divalidasi invariant,
- terlihat di audit,
- bisa direkonstruksi,
- bisa dijelaskan.

Contoh tindakan fleksibel:

```text
Request additional document
Assign legal review
Escalate to manager
Suspend case clock
Resume case clock
Transfer officer
Link related case
Reopen case
Withdraw application
Override recommendation
```

Semua ini tidak boleh hanya menjadi tombol bebas.

Harus ada:

```text
action + actor + reason + legal basis + timestamp + before/after state + related evidence
```

---

## 7. BPMN Modelling Styles Untuk Case Management

Ada beberapa pendekatan.

### 7.1 Monolithic end-to-end process

Semua lifecycle dimodelkan dalam satu BPMN besar.

```text
Open -> Triage -> Review -> Query -> Decision -> Appeal -> Enforcement -> Close
```

Kelebihan:

- mudah melihat gambaran besar,
- satu process instance untuk satu case,
- timeline utama jelas.

Kekurangan:

- model cepat menjadi besar,
- perubahan kecil berisiko besar,
- semua variasi masuk satu diagram,
- sulit modularize,
- sulit reuse,
- sulit testing.

Gunakan hanya jika lifecycle relatif stabil dan variasi terbatas.

### 7.2 Master process + call activities

Gunakan process utama sebagai lifecycle skeleton, lalu detail sebagai subprocess/process terpisah.

```text
Case Lifecycle
  -> Call Activity: Intake
  -> Call Activity: Completeness Check
  -> Call Activity: Review
  -> Call Activity: Decision
  -> Call Activity: Appeal
  -> Call Activity: Closure
```

Kelebihan:

- modular,
- phase boundary jelas,
- KPI phase lebih mudah,
- sub-process bisa versioned,
- easier review.

Kekurangan:

- butuh governance antar process,
- variable mapping harus disiplin,
- error propagation harus jelas.

Ini biasanya pola paling sehat untuk enterprise regulatory workflow.

### 7.3 Case aggregate + many small orchestration processes

Case state disimpan di domain service. Camunda process digunakan untuk flow tertentu.

Contoh process:

```text
Application Intake Process
Document Request Process
Officer Review Process
Appeal Process
Enforcement Notice Process
```

Kelebihan:

- domain case lebih kuat,
- process lebih kecil,
- lifecycle non-linear lebih mudah,
- cocok untuk custom case UI.

Kekurangan:

- korelasi antar process harus matang,
- visibility perlu custom read model,
- risk duplicate/contradictory processes.

Cocok jika case sangat dinamis.

### 7.4 Event-driven case orchestration

Domain event memicu process atau message correlation.

```text
CaseSubmitted
DocumentUploaded
OfficerAssigned
ClarificationRequested
ClarificationReceived
DecisionApproved
AppealSubmitted
```

Kelebihan:

- decoupled,
- scalable,
- mudah integrasi dengan domain event log.

Kekurangan:

- observability lebih sulit,
- ordering dan idempotency harus kuat,
- model mental lebih kompleks.

Cocok untuk platform case management besar.

### 7.5 Ad-hoc subprocess for controlled optional work

Camunda 8 mendukung ad-hoc subprocess. Ad-hoc subprocess memungkinkan elemen di dalam subprocess dijalankan dalam urutan bebas, bisa dieksekusi beberapa kali, atau dilewati. Ini relevan untuk case management karena banyak pekerjaan investigatif dan review tidak selalu linear. Camunda docs menjelaskan bahwa elemen di dalam ad-hoc subprocess tidak memakai start/end event dan dapat dijalankan multiple times, any order, or skipped; implementasinya bisa internal Zeebe atau dikendalikan job worker.

Pola ini cocok untuk:

```text
Investigation Workbench
  - Review financial documents
  - Request applicant clarification
  - Ask legal opinion
  - Run risk screening
  - Schedule interview
  - Link related case
  - Prepare recommendation
```

Kelebihan:

- fleksibel,
- cocok untuk semi-structured work,
- bisa tetap bounded di dalam phase.

Kekurangan:

- harus hati-hati dengan audit,
- completion condition harus jelas,
- worker yang mengontrol activation harus idempotent,
- task availability tidak boleh bertentangan dengan authorization domain.

Catatan penting: docs Camunda menyebut ad-hoc subprocess memiliki constraint harus memiliki minimal satu activity dan tidak boleh memiliki start/end events. Ada juga perilaku khusus jika job worker mengendalikan ad-hoc subprocess: job bisa direcreate selama eksekusi dan completion bisa menerima rejection seperti `NOT_FOUND` jika state sudah berubah.

---

## 8. Case Domain Model: Jangan Mulai Dari BPMN

Untuk case management, jangan mulai dengan menggambar diagram.

Mulai dari domain model.

### 8.1 Core aggregate

Contoh:

```java
public final class RegulatoryCase {
    private final CaseId caseId;
    private CaseStatus status;
    private CasePhase phase;
    private OfficerId assignedOfficer;
    private RegulatoryClock clock;
    private EvidenceBundle evidenceBundle;
    private DecisionDraft decisionDraft;
    private AppealState appealState;
    private EnforcementState enforcementState;
    private List<CaseEvent> eventHistory;
}
```

Bukan berarti harus seperti ini literal, tetapi mental modelnya penting.

### 8.2 Invariant

Contoh invariant:

```text
A closed case cannot accept new document unless reopened.
A decision cannot be issued before completeness check is passed.
An appeal cannot be accepted outside appeal window unless extension is approved.
An officer cannot approve their own recommendation if segregation of duties applies.
A case clock cannot be resumed if it is not suspended.
A rejection decision must have reason code and legal basis.
An enforcement notice must reference a valid decision.
```

Invariant seperti ini **tidak boleh hanya ada di BPMN**.

BPMN dapat mencegah sebagian path, tetapi domain service tetap harus menjaga kebenaran.

### 8.3 Commands

Case domain sebaiknya diekspos lewat command eksplisit:

```text
SubmitCase
AssignOfficer
MarkCompletenessPassed
RequestAdditionalInformation
ReceiveAdditionalInformation
SuspendRegulatoryClock
ResumeRegulatoryClock
CreateRecommendation
ApproveDecision
RejectDecision
FileAppeal
AcceptAppeal
RejectAppeal
StartEnforcement
CloseCase
ReopenCase
```

Worker Camunda memanggil command ini.

User action dari task UI juga akhirnya menjadi command.

### 8.4 Events

Setiap command menghasilkan event:

```text
CaseSubmitted
OfficerAssigned
CompletenessPassed
AdditionalInformationRequested
ApplicantResponded
ClockSuspended
ClockResumed
RecommendationCreated
DecisionApproved
DecisionRejected
AppealFiled
EnforcementStarted
CaseClosed
```

Events ini dapat dipakai untuk:

- audit,
- read model,
- message correlation,
- external integration,
- process analytics,
- timeline UI.

---

## 9. Process Model as Lifecycle Skeleton

Setelah domain model jelas, baru tentukan BPMN skeleton.

Contoh high-level skeleton:

```text
[Case Submitted]
      |
      v
[Intake Phase]
      |
      v
[Completeness Check]
      |
      +-- incomplete --> [Request Additional Information] --> wait response --> back
      |
      v
[Substantive Review]
      |
      +-- need external verification --> wait callback --> continue
      +-- need legal review --> legal subprocess --> continue
      |
      v
[Decision Phase]
      |
      +-- approve
      +-- reject
      +-- conditional approve
      |
      v
[Notify Outcome]
      |
      v
[Appeal Window Timer]
      |
      +-- appeal received --> [Appeal Process]
      +-- no appeal --> [Closure]
```

### 9.1 BPMN should encode stable lifecycle, not every UI click

Jangan modelkan:

```text
Officer opens page
Officer clicks tab
Officer sorts document
Officer adds comment
Officer edits draft field
Officer previews letter
```

Modelkan:

```text
Officer review completed
Clarification requested
Recommendation submitted
Decision approved
```

BPMN sebaiknya merepresentasikan **business commitments** dan **durable waiting points**, bukan micro-interaction.

---

## 10. Phase-Based Modelling

Camunda best practice reporting menyarankan penambahan business milestones dan business phases ke process model agar KPI lebih bermakna. Untuk case management, ini sangat berguna.

### 10.1 Phase

Phase adalah periode yang memiliki durasi.

Contoh:

```text
Intake Phase
Completeness Phase
Review Phase
Decision Phase
Appeal Phase
Enforcement Phase
Closure Phase
```

Dalam BPMN, phase bisa dimodelkan sebagai embedded subprocess atau call activity.

### 10.2 Milestone

Milestone adalah titik yang terjadi sekali.

Contoh:

```text
Case submitted
Completeness passed
Review completed
Decision issued
Appeal window expired
Case closed
```

Dalam BPMN, milestone bisa berupa intermediate event atau meaningful activity yang meninggalkan trace.

### 10.3 Why phase matters

Tanpa phase, reporting hanya tahu total duration.

Dengan phase, kita bisa menjawab:

```text
Berapa lama case menunggu applicant?
Berapa lama case berada di officer review?
Berapa lama legal review?
Berapa lama external agency response?
Di phase mana backlog terbesar?
Apakah SLA breach karena applicant delay atau internal delay?
```

---

## 11. Regulatory Clock: Jangan Samakan Dengan Timer Sederhana

Case regulatory sering punya deadline yang bisa:

- mulai saat submission,
- mulai setelah completeness accepted,
- pause saat menunggu applicant,
- resume saat applicant response,
- diperpanjang oleh manager,
- berbeda untuk case type tertentu,
- berbeda berdasarkan risk level,
- memiliki statutory deadline dan internal target deadline.

### 11.1 Regulatory clock model

Jangan hanya pakai timer BPMN:

```text
P30D
```

Untuk case yang regulated, buat domain object:

```java
public final class RegulatoryClock {
    private Instant startedAt;
    private Instant dueAt;
    private ClockStatus status; // RUNNING, SUSPENDED, BREACHED, COMPLETED
    private List<ClockSuspension> suspensions;
    private List<ClockExtension> extensions;
}
```

### 11.2 BPMN timer sebagai enforcement mechanism

BPMN timer tetap berguna untuk:

- reminder,
- escalation,
- breach detection,
- appeal window expiry,
- auto-close,
- timeout external response.

Tetapi timer bukan satu-satunya sumber perhitungan deadline.

Pattern:

```text
Domain service calculates deadline
Camunda process schedules timer based on calculated deadline
On timer fired, worker revalidates current domain state
If still breached -> escalate
If already resolved -> no-op or skip
```

### 11.3 Kenapa revalidation wajib?

Karena dalam distributed system:

- case mungkin sudah selesai,
- clock mungkin sudah suspended,
- deadline mungkin sudah extended,
- timer event bisa masih aktif di old process version,
- projection bisa lag,
- duplicate message bisa terjadi.

Jadi timer handler harus idempotent dan state-aware.

---

## 12. Assignment, Ownership, and Segregation of Duties

Regulatory case sering memiliki aturan:

- case harus punya assigned officer,
- reviewer tidak boleh sama dengan preparer,
- approver harus punya grade tertentu,
- legal input hanya oleh legal group,
- urgent case harus manager-visible,
- conflict-of-interest harus dideklarasikan,
- reassignment harus ada reason.

### 12.1 Camunda user task assignment

Camunda user task mendukung assignee, candidate users, candidate groups, scheduling, variable mappings, and forms. Dalam Camunda 8.8+, candidate groups sebaiknya merujuk ke group IDs, bukan group names.

Gunakan Camunda assignment untuk task routing, tetapi jangan jadikan itu satu-satunya authorization check.

### 12.2 Domain authorization tetap wajib

Sebelum user menyelesaikan task:

```text
UI -> Case API -> authorize command -> mutate case -> complete task/message
```

Atau:

```text
UI -> Task API -> complete task -> worker validates command
```

Tetapi lebih aman jika domain command authorization dilakukan eksplisit.

### 12.3 Assignment state

Pisahkan:

```text
task assignee
case owner
case officer
case reviewer
case approver
```

Jangan anggap semuanya sama.

Contoh:

| Concept | Meaning |
|---|---|
| case owner | unit/officer yang bertanggung jawab atas lifecycle |
| task assignee | user yang sedang melakukan task tertentu |
| reviewer | user yang melakukan substantive review |
| approver | user yang mengesahkan decision |
| watcher | user/group yang perlu visibility |
| escalation owner | user/group yang menangani breach |

---

## 13. Evidence and Document Lifecycle

Case management hampir selalu document/evidence-heavy.

### 13.1 Jangan simpan dokumen di process variables

Process variable cukup menyimpan reference:

```json
{
  "caseId": "CASE-2026-000123",
  "evidenceBundleId": "EVB-88991",
  "requiredDocumentSetId": "DOCSET-004",
  "latestSubmissionId": "SUB-7712"
}
```

Dokumen asli disimpan di document service/object storage/DMS.

### 13.2 Evidence states

Contoh:

```text
REQUESTED
SUBMITTED
UNDER_REVIEW
ACCEPTED
REJECTED
SUPERSEDED
WITHDRAWN
EXPIRED
```

### 13.3 Evidence audit

Untuk regulatory defensibility, setiap evidence action harus punya:

```text
documentId
version
checksum/hash
uploadedBy
uploadedAt
sourceChannel
acceptedBy
acceptedAt
rejectionReason
supersededBy
retentionPolicy
```

### 13.4 BPMN interaction

BPMN cukup mengorkestrasi:

```text
Request document
Wait document submitted message
Review document
Accept/reject document
Continue or ask again
```

Jangan masukkan semua file-level operation ke BPMN.

---

## 14. Decision Modelling

Regulatory case ujungnya sering keputusan.

Keputusan tidak boleh hanya berupa:

```json
{ "approved": true }
```

Minimal perlu:

```json
{
  "decisionType": "REJECTED",
  "reasonCodes": ["INSUFFICIENT_DOCUMENTS", "FAILED_ELIGIBILITY"],
  "legalBasis": ["REG-12.3", "POLICY-2026-04"],
  "effectiveDate": "2026-07-01",
  "decidedBy": "user-123",
  "decisionVersion": 3
}
```

### 14.1 Draft vs final decision

Pisahkan:

```text
draft recommendation
submitted recommendation
reviewed recommendation
approved decision
issued decision
notified decision
effective decision
```

BPMN bisa punya:

```text
Prepare Recommendation -> Review Recommendation -> Approve Decision -> Issue Notice
```

### 14.2 Decision invariants

Contoh:

```text
Rejected decision must have at least one reason code.
Approved decision with condition must have condition list.
Decision cannot be issued before approval.
Decision cannot be edited after issuance except via correction workflow.
Appeal can only target issued decision.
```

### 14.3 DMN / rules

Jika decision memiliki rule table, bisa gunakan decision service/rules engine/DMN, tetapi untuk seri ini prinsip utamanya:

- rule result bukan decision final,
- human/legal approval bisa tetap diperlukan,
- rule version harus tercatat,
- decision explanation harus tersimpan.

---

## 15. Appeal Lifecycle

Appeal bukan sekadar path lain setelah rejection.

Appeal memiliki lifecycle sendiri:

```text
Appeal window opened
Appeal filed
Appeal admissibility checked
Appeal accepted/rejected
Appeal review assigned
Appeal hearing scheduled
Appeal decision made
Original decision upheld/varied/overturned
Applicant notified
Case updated
```

### 15.1 Appeal window

Bisa dimodelkan dengan event-based gateway:

```text
Wait appeal message
or
Timer appeal window expiry
```

Tetapi tetap revalidate di domain:

```text
isAppealAllowed(caseId, filedAt)
```

### 15.2 Appeal as subprocess or separate process

Jika appeal sederhana:

```text
Decision -> Appeal Window -> Appeal Subprocess -> Closure
```

Jika appeal kompleks dan bisa berjalan lama:

```text
Main case process closes decision phase
Appeal process starts separately and links to original case
```

### 15.3 Appeal effect

Appeal bisa:

- suspend enforcement,
- not suspend enforcement,
- alter decision,
- create new decision version,
- reopen case,
- create linked enforcement review.

Ini lebih cocok dikelola oleh domain service, sedangkan Camunda mengorkestrasi step.

---

## 16. Enforcement Lifecycle

Enforcement sering muncul setelah non-compliance atau failed obligation.

Contoh:

```text
Non-compliance detected
Create enforcement case
Issue notice
Wait response
Review representation
Impose penalty
Monitor payment/compliance
Escalate legal action
Close enforcement
```

### 16.1 Enforcement is often related but separate

Jangan selalu lanjutkan enforcement di process instance application asli.

Lebih sehat:

```text
ApplicationCase
    └── may create EnforcementCase
```

Karena enforcement punya:

- case number sendiri,
- officer sendiri,
- SLA sendiri,
- evidence sendiri,
- decision sendiri,
- appeal sendiri,
- closure sendiri.

### 16.2 BPMN relationship

Gunakan message/event:

```text
DecisionRejected/ObligationBreached -> Start Enforcement Process
```

atau worker:

```text
CreateEnforcementCaseWorker
```

---

## 17. Suspension, Resumption, Withdrawal, Reopen

Case management banyak memiliki lifecycle control.

### 17.1 Suspension

Suspension berarti case dihentikan sementara karena alasan sah:

```text
waiting applicant
waiting court outcome
waiting external agency
pending legal clarification
force majeure
```

Suspension harus menyimpan:

```text
reason
startedAt
startedBy
legalBasis
expectedResumeCondition
documents
```

BPMN pattern:

```text
Review Phase
  -> Need applicant input?
      -> Suspend clock
      -> Request input
      -> Wait message or timer
      -> Resume clock
```

### 17.2 Withdrawal

Withdrawal berbeda dari rejection.

```text
Applicant withdraws application
```

BPMN harus bisa interrupt current review.

Pattern:

```text
event subprocess triggered by WithdrawalRequested message
  -> validate withdrawal
  -> cancel active tasks
  -> close case as withdrawn
```

### 17.3 Reopen

Reopen harus hati-hati.

Pertanyaan:

```text
Reopen creates new process instance?
Modify old process instance?
Start correction subprocess?
Create linked case?
```

Umumnya, untuk audit defensibility:

```text
closed case remains closed
reopen creates new lifecycle segment or linked case
```

Jika harus reopen same case, simpan `caseVersion` atau `lifecycleIteration`.

---

## 18. Case Actions: Dynamic But Governed

Untuk case yang kompleks, user sering butuh tombol action dinamis:

```text
Request Info
Add Internal Note
Assign Legal Review
Suspend Case
Resume Case
Escalate
Transfer
Close
Reopen
Issue Warning
Create Enforcement Case
```

### 18.1 Jangan hardcode action hanya di UI

Action availability harus dari backend/domain:

```http
GET /cases/{caseId}/available-actions
```

Response:

```json
[
  {
    "action": "REQUEST_INFORMATION",
    "label": "Request information",
    "requiresReason": true,
    "requiresDocument": false,
    "allowed": true
  },
  {
    "action": "CLOSE_CASE",
    "allowed": false,
    "reason": "Pending review task is still active"
  }
]
```

### 18.2 Camunda interaction

Action bisa:

1. complete user task,
2. publish message,
3. start subprocess,
4. create job side effect,
5. update domain state only,
6. modify process instance if strictly needed.

### 18.3 Action ledger

Setiap action harus tercatat:

```text
caseActionId
caseId
actor
role
actionType
reason
inputPayloadHash
beforeState
afterState
processInstanceKey
taskKey
timestamp
```

---

## 19. BPMN Pattern Catalog for Regulatory Case

### 19.1 Intake + validation

```text
Message Start: Case Submitted
  -> Validate Submission
  -> Create Case Record
  -> Completeness Check
```

Design note:

- validation teknis bisa worker,
- completeness bisnis bisa human task,
- case record harus dibuat idempotently.

### 19.2 Request for information loop

```text
Review
  -> Need Info?
      -> Request Info
      -> Suspend Clock
      -> Wait Applicant Response
      -> Resume Clock
      -> Re-review
```

Important:

- loop count limit,
- deadline per request,
- non-response path,
- document versioning,
- all request/response stored outside process variable.

### 19.3 Parallel verification

```text
Substantive Review
  -> Parallel Gateway
      -> Internal Review
      -> External Verification
      -> Risk Screening
  -> Join
```

Important:

- partial result policy,
- timeout per external dependency,
- cancellation if case withdrawn,
- idempotent external request.

### 19.4 Legal review optional subprocess

```text
Review
  -> Gateway: Need Legal?
      -> Call Activity: Legal Review
      -> Continue
```

Important:

- legal review has own SLA,
- legal opinion stored as evidence/reference,
- legal reviewer identity audited.

### 19.5 Escalation reminder

```text
User Task: Officer Review
  boundary non-interrupting timer
      -> Notify Manager
```

Important:

- reminder should not complete task,
- avoid repeated spam,
- store reminder sent event.

### 19.6 Interrupting withdrawal

```text
Event Subprocess: Withdrawal Message
  -> Validate Withdrawal
  -> Cancel Active Work
  -> Close Withdrawn
```

Important:

- not all case types allow withdrawal,
- withdrawal after decision may need different path.

### 19.7 Appeal window

```text
Issue Decision
  -> Event-based Gateway
      -> Message: Appeal Filed -> Appeal Subprocess
      -> Timer: Appeal Window Expired -> Close
```

Important:

- appeal message must use safe correlation key,
- timer handler must revalidate domain state.

### 19.8 Enforcement trigger

```text
Decision/Obligation Breach
  -> Publish EnforcementStart command/message
  -> Enforcement Process starts
```

Important:

- enforcement process should have own case id,
- link to original case.

### 19.9 Ad-hoc investigation phase

```text
Investigation Ad-hoc Subprocess
  contains:
    - Review Evidence
    - Interview Applicant
    - Request Agency Input
    - Legal Opinion
    - Risk Assessment
    - Prepare Findings
```

Important:

- completion condition explicit,
- available action governed by domain,
- ad-hoc activation worker idempotent.

---

## 20. Architecture Blueprint

### 20.1 Logical components

```text
┌─────────────────────────────────────────────────────────────┐
│ Case Web UI / Officer Portal                                │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Case API / Case Domain Service                              │
│ - command validation                                         │
│ - authorization                                              │
│ - aggregate invariants                                       │
│ - case state                                                 │
│ - evidence metadata                                          │
│ - decision record                                            │
│ - action ledger                                              │
└────────────────────┬─────────────────────┬──────────────────┘
                     │                     │
                     │ commands/events      │ references
                     ▼                     ▼
┌──────────────────────────────┐   ┌──────────────────────────┐
│ Camunda 8 / Zeebe             │   │ Document/Evidence Service │
│ - orchestration state         │   │ - file versions           │
│ - user tasks                  │   │ - checksum                │
│ - timers                      │   │ - retention               │
│ - messages                    │   │ - access control          │
│ - incidents                   │   └──────────────────────────┘
└───────────────┬──────────────┘
                │ jobs/messages
                ▼
┌─────────────────────────────────────────────────────────────┐
│ Java Worker Services                                         │
│ - validation worker                                          │
│ - notification worker                                        │
│ - external verification worker                               │
│ - decision document generator                                │
│ - enforcement case creator                                   │
│ - audit projection worker                                    │
└─────────────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│ Read/Audit/Analytics                                         │
│ - case timeline                                              │
│ - process timeline                                           │
│ - task workload                                              │
│ - SLA dashboard                                              │
│ - regulatory reports                                         │
└─────────────────────────────────────────────────────────────┘
```

### 20.2 Source of truth split

| Data | Source of Truth |
|---|---|
| Process execution position | Zeebe |
| Active user task projection | Zeebe + Tasklist projection |
| Case status | Case domain DB |
| Evidence metadata | Document/evidence service |
| File binary | DMS/object storage |
| Decision record | Case/decision domain DB |
| Worker side effect | Operation ledger/outbox |
| Operational incident | Zeebe/Operate |
| Business report | analytics/read model |

---

## 21. Java Worker Design for Case Management

### 21.1 Worker should not contain case policy

Bad:

```java
if (riskScore > 80 && applicantType.equals("X") && previousCaseCount > 2) {
    approve = false;
}
```

inside worker handler directly.

Better:

```java
ReviewResult result = caseReviewService.evaluate(command);
```

Worker should:

1. parse variables,
2. validate command envelope,
3. call application/domain service,
4. map result to process variables or BPMN error,
5. complete/fail job safely.

### 21.2 Example worker boundary

```java
@Component
public final class CompleteReviewWorker {

    private final CaseApplicationService caseApplicationService;
    private final WorkerResponseMapper mapper;

    @JobWorker(type = "case.complete-review")
    public Map<String, Object> handle(JobClient client, ActivatedJob job) {
        CompleteReviewJobPayload payload = mapper.toCompleteReviewPayload(job);

        CompleteReviewCommand command = new CompleteReviewCommand(
                payload.caseId(),
                payload.reviewTaskId(),
                payload.reviewerId(),
                payload.recommendationId(),
                payload.idempotencyKey()
        );

        CompleteReviewResult result = caseApplicationService.completeReview(command);

        return mapper.toVariables(result);
    }
}
```

### 21.3 Key design

Use stable keys:

```text
caseId
caseVersion
processInstanceKey
bpmnProcessId
jobKey
taskKey
businessActionId
idempotencyKey
documentBundleId
decisionId
appealId
enforcementCaseId
```

Do not depend only on job key for business idempotency. Job key is execution-level, not business-level.

---

## 22. Process Variables for Case Workflow

### 22.1 Minimal variable example

```json
{
  "caseId": "CASE-2026-000123",
  "caseType": "LICENSE_RENEWAL",
  "tenantId": "CEA",
  "riskBand": "HIGH",
  "caseVersion": 7,
  "regulatoryClockId": "CLK-991",
  "currentPhase": "SUBSTANTIVE_REVIEW",
  "evidenceBundleId": "EVB-882",
  "decisionId": null
}
```

### 22.2 Avoid

```json
{
  "allDocuments": [
    { "filename": "...", "base64": "..." }
  ],
  "allNotes": "...",
  "fullApplicantProfile": { "...": "..." },
  "entireCaseHistory": [ ... ]
}
```

### 22.3 Why?

Because large variables harm:

- broker processing,
- export volume,
- read-side indexing,
- Operate usability,
- privacy,
- incident debugging,
- migration,
- versioning.

---

## 23. Custom Case UI + Tasklist: Decision Framework

### 23.1 Use Tasklist when

Tasklist is enough when:

- tasks are simple,
- forms are standard,
- assignment model fits,
- low custom UI complexity,
- workflow visibility is acceptable,
- task data is small,
- role model maps cleanly.

### 23.2 Build custom case UI when

You need:

- full case timeline,
- document viewer,
- evidence comparison,
- complex authorization,
- multi-tab officer workspace,
- linked cases,
- search/filter workload,
- case note/evidence management,
- regulatory action menu,
- integrated letter generation,
- rich dashboard,
- domain-specific SLA indicators.

### 23.3 Hybrid

A common enterprise pattern:

```text
Tasklist handles basic human task queue
Custom Case UI handles deep case workspace
Task opens external case workspace via reference
Completion goes through Case API then Camunda task completion/message
```

Camunda user task docs state user tasks can refer users to other applications or redirect them to a website; custom form references can associate user tasks with custom applications.

---

## 24. Timeline and Audit Defensibility

### 24.1 Audit questions

A regulator/auditor may ask:

```text
Who touched this case?
When was the case submitted?
Who assigned the officer?
Why was SLA suspended?
What document was missing?
When did applicant respond?
Who made the recommendation?
Who approved the decision?
What legal basis was used?
Was the decision made within statutory deadline?
Was appeal filed in time?
Why was enforcement started?
Was any task overridden?
```

A production system must answer without reconstructing from random logs.

### 24.2 Timeline model

Create a canonical timeline:

```json
{
  "eventId": "EVT-991",
  "caseId": "CASE-2026-000123",
  "eventType": "DECISION_APPROVED",
  "occurredAt": "2026-06-21T10:15:30Z",
  "actor": "user-123",
  "role": "APPROVER",
  "source": "CASE_API",
  "processInstanceKey": 2251799813685251,
  "taskKey": 2251799813685401,
  "reasonCode": "ELIGIBILITY_MET",
  "legalBasis": ["REG-4.1"],
  "payloadHash": "sha256:..."
}
```

### 24.3 Sources

Timeline may combine:

- domain events,
- Camunda exported records,
- user task events,
- document events,
- notification events,
- external integration events.

But mark source clearly.

### 24.4 Do not rely only on Operate

Operate is operationally useful, but regulatory audit usually needs domain-level timeline that includes evidence, actor, legal basis, and business reason.

---

## 25. Case Status Synchronization with Camunda

### 25.1 Pattern A: Worker updates case status

```text
BPMN reaches phase
  -> service task "mark case under review"
  -> worker calls Case API
  -> Case API updates status
```

Pros:

- explicit,
- durable,
- visible.

Cons:

- many service tasks,
- possible noise,
- need idempotency.

### 25.2 Pattern B: Case API drives process

```text
User/domain action mutates case
  -> publishes message/starts process
  -> Camunda continues
```

Pros:

- domain source-of-truth strong,
- UI actions direct.

Cons:

- correlation complexity,
- async lag.

### 25.3 Pattern C: Event projection

```text
Camunda exports records
  -> projection updates case phase
```

Usually dangerous for source-of-truth state because projection lag can affect business decisions.

Use for read-only display, not core decision.

### 25.4 Recommended

For regulatory systems:

```text
Domain command changes case state.
Camunda orchestrates next obligations.
Workers call domain commands at milestone points.
Read model combines both.
```

---

## 26. Process Instance Per Case or Per Case Phase?

### 26.1 One process instance per case

Pros:

- simple mental model,
- one Operate view,
- easy correlation.

Cons:

- long-running version complications,
- massive process model,
- hard reopen,
- harder appeal/enforcement separation.

### 26.2 One process per phase

Pros:

- modular,
- easier versioning,
- clear ownership,
- independently deployable.

Cons:

- need lifecycle coordinator,
- more correlation,
- custom timeline needed.

### 26.3 Hybrid recommendation

Use:

```text
one master lifecycle process
plus call activities or separate child processes for complex phases
plus separate linked process for appeal/enforcement if they are independent enough
```

---

## 27. Handling Non-Linear Work

### 27.1 Use event subprocess

For exceptional but valid events:

```text
withdrawal requested
urgent escalation
case reassigned
case suspended by external order
new evidence received
```

### 27.2 Use ad-hoc subprocess

For controlled flexible investigation/review work:

```text
optional tasks selected by officer/rule/AI/manager
```

### 27.3 Use domain action menu

For actions that mutate case state but do not need orchestration.

Example:

```text
add internal note
tag case
link related case
update risk flag
```

### 27.4 Use separate process

For independent lifecycle:

```text
appeal
enforcement
legal proceeding
inspection visit
```

---

## 28. Avoiding BPMN Explosion

BPMN explosion happens when every small condition becomes gateway.

Bad smell:

```text
100+ gateways
many crossing flows
every role branch duplicated
every document type has own task
every error condition has separate lane
```

### 28.1 Use rule evaluation

Instead of:

```text
Gateway: document A?
Gateway: document B?
Gateway: document C?
Gateway: risk high?
Gateway: applicant type X?
```

Use:

```text
Evaluate Completeness Requirements
  -> returns required actions
```

Then model durable outcomes:

```text
complete
request information
reject as incomplete
manual review
```

### 28.2 Use domain decision tables/rules

Complex eligibility should often be in:

- domain rule service,
- DMN/decision table,
- policy engine,
- database-configured rule set,

not in gateway spaghetti.

### 28.3 BPMN should show business milestones

BPMN should be readable by:

- engineer,
- BA,
- operation lead,
- auditor,
- product owner.

If only the original developer can understand it, it is not good case orchestration.

---

## 29. Linked Cases and Cross-Entity Impact

Regulatory systems often have linked entities:

```text
salesperson
estate agent
license
application
complaint
inspection
disciplinary action
appeal
payment
exam record
```

A case decision may affect multiple entities.

Example:

```text
Suspend salesperson license
Notify estate agent
Update public register
Create enforcement monitoring
Cancel pending renewal
Notify finance
```

### 29.1 Do not let BPMN directly update everything without domain coordination

Use domain/application service:

```text
ApplyDecisionImpact(caseId, decisionId)
```

This service:

- validates decision,
- applies entity state changes,
- emits events,
- uses transaction/outbox,
- records audit.

Camunda worker calls it.

### 29.2 Cross-entity consistency

Need plan for partial failure:

```text
license updated but notification failed
public register updated but finance failed
```

Use:

- outbox,
- operation ledger,
- retry,
- reconciliation,
- compensation if needed.

---

## 30. AI/Agentic Case Assistance: Guardrails

Recent Camunda messaging increasingly discusses case management with deterministic orchestration plus AI/human expertise, and Camunda 8 has been adding features such as ad-hoc subprocesses that can support more dynamic task selection. But in regulatory systems, AI must be treated carefully.

### 30.1 Acceptable use

AI can assist with:

- document summarization,
- evidence extraction,
- suggested next actions,
- draft response,
- risk hint,
- case clustering,
- checklist generation.

### 30.2 Not acceptable without control

AI should not silently:

- approve/reject,
- decide legal basis,
- modify case state,
- issue notice,
- waive SLA,
- delete evidence,
- override officer.

### 30.3 Pattern

```text
AI suggests
Human decides
Domain validates
Camunda orchestrates
Audit records
```

### 30.4 Ad-hoc subprocess + AI

Possible pattern:

```text
Ad-hoc Investigation
  -> AI suggests next investigatory tasks
  -> officer selects/approves
  -> worker activates allowed elements
  -> all decisions audited
```

Never let AI bypass domain allowed-action rules.

---

## 31. Testing Regulatory Case Workflow

### 31.1 Test categories

| Test | Purpose |
|---|---|
| Domain invariant test | ensure illegal actions rejected |
| BPMN scenario test | ensure lifecycle path correct |
| Worker contract test | ensure variables/actions map safely |
| Authorization test | ensure wrong actor cannot act |
| Timer/SLA test | ensure deadline behavior |
| Message correlation test | ensure external callbacks safe |
| Evidence lifecycle test | ensure documents versioned |
| Audit test | ensure timeline complete |
| Migration test | ensure old running cases safe |
| Incident recovery test | ensure support actions safe |

### 31.2 Critical scenarios

Test at least:

```text
happy path approval
incomplete submission -> request info -> response -> continue
no applicant response -> reject/close
external verification timeout
legal review required
decision rejected
appeal within window
appeal after window
withdrawal during review
reopen after close
officer reassignment
duplicate callback
duplicate task completion
timer fires after case already completed
```

### 31.3 Regulatory test oracle

For each scenario, assert:

```text
case state
process state
task state
timeline
audit fields
documents
SLA clock
notifications
side effect ledger
```

Not only “process completed”.

---

## 32. Observability for Case Management

### 32.1 Dashboards

Build separate dashboards:

1. Platform health:
   - broker,
   - gateway,
   - exporter,
   - secondary storage,
   - worker.

2. Process health:
   - active instances,
   - incident count,
   - job backlog,
   - stuck timers,
   - message wait count.

3. Case health:
   - open cases by phase,
   - aging cases,
   - SLA breached,
   - pending applicant,
   - pending officer,
   - pending external agency.

4. Workload:
   - tasks by team,
   - tasks by priority,
   - overdue tasks,
   - officer load.

5. Regulatory:
   - decision within statutory deadline,
   - appeal rate,
   - reversal rate,
   - enforcement conversion,
   - non-response rate.

### 32.2 Correlation fields

Every log should include:

```text
caseId
processInstanceKey
bpmnProcessId
processDefinitionVersion
jobKey
taskKey
workerType
businessActionId
correlationKey
tenantId
actorId if human action
```

---

## 33. Security and Privacy

### 33.1 Case data sensitivity

Regulatory case data may include:

- personal data,
- business confidential data,
- investigation notes,
- legal opinion,
- enforcement action,
- complaint identity,
- supporting documents,
- internal recommendation.

### 33.2 Principles

- Store minimal data in process variables.
- Store references, not sensitive payload.
- Mask variables in logs.
- Apply domain authorization before actions.
- Separate public applicant data from internal officer notes.
- Control document access separately.
- Audit all privileged actions.
- Avoid exposing task variables blindly to frontend.

### 33.3 Task completion risk

When user completes task, validate:

```text
user can complete this task
task belongs to case
case is in expected state
submitted data schema valid
decision/reason/attachment complete
no stale version conflict
```

Use optimistic version:

```text
caseVersion
```

so stale UI cannot overwrite newer decision.

---

## 34. Migration from Camunda 7 CMMN/Case-Like Designs

Camunda 7 historically had broader BPM platform features including BPMN/DMN/CMMN in older contexts, but Camunda 8 focuses on BPMN/Zeebe-style orchestration. If an existing Camunda 7 solution used CMMN-like modelling or heavily dynamic case behaviour, migration is design migration, not element conversion.

### 34.1 Migration inventory

Identify:

```text
case definitions
case states
human tasks
manual activations
milestones
sentries/conditions
discretionary tasks
case file items
process tasks
decision tasks
case history queries
custom Cockpit views
authorization plugins
document links
```

### 34.2 Mapping strategy

| Old concept | Possible Camunda 8 strategy |
|---|---|
| predictable process path | BPMN |
| dynamic optional work | ad-hoc subprocess / domain action menu |
| case file | domain case/evidence store |
| discretionary task | available-action API + user task/subprocess |
| milestone | BPMN intermediate event / domain event |
| case note | domain timeline, not process variable |
| manual activation | task/action API + message/subprocess |
| case completion rule | domain invariant + BPMN completion condition |

### 34.3 Do not migrate blindly

Ask:

```text
Is this actually orchestration?
Is this domain state?
Is this UI action?
Is this audit event?
Is this authorization rule?
Is this document lifecycle?
Is this reporting projection?
```

Only orchestration belongs in Camunda process.

---

## 35. Detailed Example: Regulatory Application Lifecycle

### 35.1 Case story

A professional submits a license renewal.

Lifecycle:

1. Applicant submits renewal.
2. System validates basic payload.
3. Completeness officer checks documents.
4. Missing document requested.
5. Applicant responds.
6. Risk screening runs.
7. High risk case requires senior review.
8. Legal review may be requested.
9. Decision drafted.
10. Approver approves/rejects.
11. Notice issued.
12. Applicant may appeal within 14 days.
13. Appeal may uphold or vary decision.
14. Case closes.
15. If obligations breached, enforcement starts.

### 35.2 Domain statuses

```text
SUBMITTED
PENDING_COMPLETENESS_CHECK
PENDING_APPLICANT_INFORMATION
UNDER_REVIEW
PENDING_LEGAL_REVIEW
PENDING_APPROVAL
DECISION_ISSUED
APPEAL_WINDOW_OPEN
UNDER_APPEAL
CLOSED
ENFORCEMENT_TRIGGERED
```

### 35.3 BPMN skeleton

```text
Message Start: Renewal Submitted
  -> Create/Retrieve Case
  -> Completeness Check User Task
      -> if missing documents:
            Request Documents
            Suspend Regulatory Clock
            Wait Applicant Response Message
            Resume Regulatory Clock
            back to Completeness Check
      -> if complete:
            Mark Complete
  -> Parallel:
        Risk Screening Worker
        Eligibility Check Worker
  -> Review User Task
      -> if legal needed:
            Call Activity: Legal Review
  -> Prepare Recommendation User Task
  -> Approve Decision User Task
  -> Generate Decision Notice Worker
  -> Notify Applicant Worker
  -> Event-based Gateway:
        Appeal Filed Message -> Call Activity: Appeal Process
        Appeal Window Timer -> Close Case
  -> End
```

### 35.4 Worker contracts

```text
case.create-or-load
case.mark-completeness
case.request-documents
case.resume-clock
case.run-risk-screening
case.prepare-decision-notice
case.close
```

### 35.5 Messages

```text
renewal-submitted
applicant-documents-submitted
appeal-filed
withdrawal-requested
external-verification-completed
```

### 35.6 Timers

```text
document response due
review SLA reminder
legal review due
decision SLA breach
appeal window expiry
```

### 35.7 Audit events

```text
RenewalSubmitted
CompletenessCheckStarted
AdditionalDocumentsRequested
ClockSuspended
DocumentsSubmitted
ClockResumed
RiskScreeningCompleted
SeniorReviewRequired
LegalReviewRequested
RecommendationSubmitted
DecisionApproved
NoticeIssued
AppealWindowOpened
AppealFiled
CaseClosed
```

---

## 36. Design Review Checklist

### 36.1 Case/domain

- [ ] Is there a clear case aggregate?
- [ ] Are domain statuses separate from BPMN nodes?
- [ ] Are invariants enforced in domain service?
- [ ] Are commands explicit?
- [ ] Are domain events captured?
- [ ] Is evidence lifecycle separate?
- [ ] Is decision record versioned?
- [ ] Is regulatory clock modelled explicitly?
- [ ] Is reopening strategy defined?
- [ ] Are linked cases supported?

### 36.2 BPMN

- [ ] Does BPMN show stable lifecycle phases?
- [ ] Are phases and milestones clear?
- [ ] Are optional/dynamic tasks bounded?
- [ ] Is ad-hoc subprocess used only where appropriate?
- [ ] Are timers revalidated through domain state?
- [ ] Are message correlation keys safe?
- [ ] Are event subprocesses used for valid interrupts?
- [ ] Are call activities used for complex phases?
- [ ] Is BPMN readable by non-developer stakeholders?
- [ ] Is gateway complexity controlled?

### 36.3 Worker

- [ ] Are workers idempotent?
- [ ] Do workers call domain commands?
- [ ] Is operation ledger present for side effects?
- [ ] Are variables minimal?
- [ ] Are failures mapped to job failure/BPMN error/business rejection correctly?
- [ ] Are external callbacks deduplicated?
- [ ] Is timeout handled as unknown outcome?

### 36.4 Human task

- [ ] Is task assignment distinct from case ownership?
- [ ] Are candidate groups using stable IDs?
- [ ] Is authorization checked in domain/API?
- [ ] Is stale task completion prevented?
- [ ] Are reason codes required for decisions?
- [ ] Is reassignment audited?
- [ ] Is delegation/substitution policy clear?

### 36.5 Audit/compliance

- [ ] Can timeline answer who/what/when/why?
- [ ] Are legal basis and reason codes stored?
- [ ] Are document versions/checksums stored?
- [ ] Is privileged override audited?
- [ ] Are PII fields minimized in variables/logs?
- [ ] Are retention requirements defined?
- [ ] Can reports distinguish internal delay vs applicant delay?

### 36.6 Operations

- [ ] Are incidents triageable from Operate?
- [ ] Is case timeline separate from Operate?
- [ ] Are dashboards phase-aware?
- [ ] Are SLA breach alerts clear?
- [ ] Is manual repair governed?
- [ ] Is migration/rollback plan defined?

---

## 37. Common Anti-Patterns

### 37.1 BPMN as case database

Symptom:

```text
All case data lives in variables.
```

Consequence:

- poor search,
- poor privacy,
- poor reporting,
- huge payload,
- hard migration,
- weak domain invariant.

### 37.2 UI action as BPMN node

Symptom:

```text
Every button click is BPMN task.
```

Consequence:

- diagram explosion,
- unreadable process,
- brittle release,
- noisy audit.

### 37.3 Case status equals active task

Symptom:

```text
If task X active, case status is X.
```

Consequence:

- broken when multiple tasks active,
- hard parallel review,
- poor reporting.

### 37.4 Timer equals statutory clock

Symptom:

```text
Timer P14D means appeal window.
```

Consequence:

- cannot handle extension,
- cannot handle suspension,
- poor audit.

### 37.5 Manual override without reason

Symptom:

```text
Manager can complete/cancel/modify without structured reason.
```

Consequence:

- audit failure,
- regulatory defensibility failure.

### 37.6 Everything is one giant process

Symptom:

```text
Application, appeal, enforcement, closure, archive all in one huge BPMN.
```

Consequence:

- versioning pain,
- model unreadable,
- impossible testing.

### 37.7 Domain logic hidden in worker

Symptom:

```text
Worker directly decides eligibility and mutates many systems.
```

Consequence:

- duplicated rules,
- untestable policy,
- poor audit,
- hard migration.

---

## 38. Practical Heuristics

### 38.1 Put in BPMN if

It is:

- long-running,
- observable,
- cross-service,
- human/system coordination,
- waiting state,
- timeout/escalation,
- milestone,
- phase transition,
- retry/incident relevant,
- process-level audit relevant.

### 38.2 Put in domain service if

It is:

- invariant,
- authorization,
- business state,
- evidence lifecycle,
- decision record,
- legal basis,
- case status,
- case action availability,
- rich query/search,
- document access,
- rule/policy execution.

### 38.3 Put in read model if

It is:

- dashboard,
- timeline view,
- workload queue,
- reporting,
- analytics,
- case search,
- audit presentation.

### 38.4 Put in worker if

It is:

- adapter glue,
- external side effect,
- command invocation,
- variable mapping,
- process response mapping,
- idempotent execution boundary.

---

## 39. Staff-Level Design Questions

Use these questions to test whether a design is mature.

1. What is the source of truth for case state?
2. What is the source of truth for process execution state?
3. What happens if the worker completes the domain command but fails to complete the Zeebe job?
4. What happens if appeal message arrives after appeal window timer fired?
5. Can two officers complete related actions concurrently?
6. Can task completion from stale UI overwrite newer case state?
7. How do you distinguish applicant delay from internal delay?
8. How do you prove why SLA was suspended?
9. How do you reopen a closed case without destroying audit meaning?
10. How do you migrate running cases after BPMN model changes?
11. How do you handle dynamic investigation tasks without BPMN explosion?
12. How do you prevent AI recommendation from becoming unaudited decision?
13. How do you link appeal/enforcement to original case?
14. How do you audit document version used for decision?
15. How do you recover if Operate projection lags but case UI must show current state?
16. How do you handle candidate group rename?
17. How do you ensure business key/correlation key does not leak PII?
18. How do you capacity-plan if thousands of cases wait for human review?
19. How do you explain to auditor the difference between process timeline and case timeline?
20. What is the manual repair process and who can perform it?

---

## 40. Summary Mental Model

Untuk case management dengan Camunda 8:

```text
Camunda/Zeebe is the durable orchestration engine.
Case service is the domain source of truth.
Tasklist/custom UI is the human work surface.
Document service is evidence source of truth.
Read model is reporting/timeline/search surface.
Workers are idempotent adapters.
Audit is a first-class product feature.
```

Kalimat penting:

> Jangan desain regulatory case system sebagai BPMN diagram yang kebetulan menyimpan data. Desainlah sebagai domain case platform yang menggunakan BPMN/Zeebe untuk mengorkestrasi lifecycle, waiting state, human work, timer, escalation, dan external integration.

Jika satu hal harus diingat:

```text
A case is not a process instance.
A process instance is one orchestration lens over the case lifecycle.
```

---

## 41. Referensi Resmi dan Bacaan Lanjutan

Rujukan yang relevan untuk bagian ini:

1. Camunda 8 User Tasks  
   `https://docs.camunda.io/docs/components/modeler/bpmn/user-tasks/`

2. Camunda 8 Human Task Orchestration Guide  
   `https://docs.camunda.io/docs/guides/orchestrate-human-tasks/`

3. Camunda 8 Tasklist Introduction  
   `https://docs.camunda.io/docs/components/tasklist/introduction-to-tasklist/`

4. Camunda 8 Ad-hoc Subprocesses  
   `https://docs.camunda.io/docs/components/modeler/bpmn/ad-hoc-subprocesses/`

5. Camunda Best Practice: Reporting About Processes  
   `https://docs.camunda.io/docs/components/best-practices/operations/reporting-about-processes/`

6. Camunda 8 Process Instance Modification  
   `https://docs.camunda.io/docs/components/operate/userguide/process-instance-modification/`

7. Camunda 8 Migration from Camunda 7  
   `https://docs.camunda.io/docs/guides/migrating-from-camunda-7/`

8. Camunda 8 Release Notes 8.9  
   `https://docs.camunda.io/docs/reference/announcements-release-notes/890/890-release-notes/`

---

## 42. Status Seri

Seri belum selesai.

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-031.md
```

Judul:

```text
Part 031 — Multi-Tenancy, Multi-Region, Environment Strategy, and Enterprise Isolation
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-029.md">⬅️ Part 029 — Advanced Orchestration Patterns: Saga, Compensation, Process Choreography, and Long-Running Transactions</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-031.md">Part 031 — Multi-Tenancy, Multi-Region, Environment Strategy, and Enterprise Isolation ➡️</a>
</div>
