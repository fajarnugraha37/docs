# Learn Java BPMN & Camunda Process Orchestration Engineering

## Part 27 — Advanced Modeling Patterns for Regulatory and Case Management Systems

> Seri: `learn-java-bpmn-camunda-process-orchestration-engineering`  
> Level: Advanced / architecture / production / regulatory-grade  
> Fokus: Java 8–25, BPMN, Camunda 7/8, regulatory workflow, enforcement lifecycle, complex case management, auditability, process-state design

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas BPMN semantics, Camunda 7/8, worker reliability, variables, error handling, human workflow, DMN, message correlation, timers, multi-instance, subprocess, saga, testing, observability, operations, security, integration, performance, dan versioning.

Part ini membawa semua fondasi itu ke salah satu domain paling sulit: **regulatory dan case management systems**.

Sistem regulatory/case management biasanya tidak gagal karena kurang endpoint REST, kurang table, atau kurang message queue. Sistem seperti ini gagal karena proses bisnisnya:

- panjang,
- bercabang,
- melibatkan manusia,
- melibatkan banyak unit/agency,
- butuh audit defensibility,
- butuh SLA,
- butuh escalation,
- sering berubah karena policy/legislation/CR,
- punya exception path lebih banyak daripada happy path,
- dan setiap keputusan harus bisa dijelaskan ulang bertahun-tahun kemudian.

Tujuan part ini adalah membentuk kemampuan desain workflow level senior/principal:

1. Membedakan **case lifecycle**, **entity state**, dan **BPMN process instance**.
2. Mendesain workflow untuk application, renewal, appeal, investigation, enforcement, suspension, revocation, document request, multi-agency review, dan case reopening.
3. Menghindari over-modeling dan under-modeling.
4. Menggabungkan BPMN, state machine, DMN, task model, audit model, dan domain model secara proporsional.
5. Membuat process design yang bisa dipertanggungjawabkan secara operasional dan regulatory.
6. Menyiapkan mental model untuk capstone architecture di Part 30.

---

## 1. Masalah Khusus di Regulatory Case Management

Regulatory case management berbeda dari workflow sederhana seperti order fulfillment atau approval cuti.

Contoh domain:

- license application,
- renewal,
- amendment,
- appeal,
- enforcement case,
- inspection,
- investigation,
- compliance monitoring,
- penalty,
- suspension,
- revocation,
- reinstatement,
- document request,
- multi-agency referral,
- legal review,
- board/committee decision,
- public register update,
- notification issuance.

Masalah utamanya bukan hanya “step apa setelah step apa”. Masalah sebenarnya adalah:

```text
Business fact evolves over time
  + humans make decisions
  + external systems respond asynchronously
  + deadlines matter
  + exceptions matter
  + authority matters
  + evidence matters
  + audit matters
  + policy changes over time
  + existing cases must remain explainable
```

Dalam domain seperti ini, workflow engine bukan hanya automation engine. Ia menjadi **coordination layer** untuk memastikan proses berjalan sesuai aturan, terlihat, bisa diperbaiki, dan bisa dipertanggungjawabkan.

Namun workflow engine tidak boleh menjadi database utama, rule engine utama, document repository utama, authorization engine utama, atau reporting warehouse utama.

Mental model utama:

```text
BPMN process = coordination of work over time
Domain model = source of business truth
Task model = work assignment and human action surface
Decision model = policy/rule evaluation
Audit model = defensible record of what happened
Document model = evidence and artifact management
Authorization model = who can see/do what
```

Jika semua ini dicampur ke satu BPMN diagram, sistem akan menjadi fragile.

---

## 2. Regulatory Workflow Bukan Sekadar Sequential Approval

Banyak orang memulai desain regulatory workflow dengan model seperti ini:

```text
Submit Application
  -> Officer Review
  -> Manager Approve
  -> Issue License
  -> Notify Applicant
```

Model ini berguna untuk menjelaskan happy path, tetapi tidak cukup untuk production.

Pertanyaan production:

1. Apa yang terjadi jika dokumen tidak lengkap?
2. Apakah applicant bisa resubmit?
3. Berapa kali resubmit boleh dilakukan?
4. Apakah SLA berhenti saat menunggu applicant?
5. Apakah officer bisa meminta advice dari legal unit?
6. Apakah review bisa dilakukan paralel oleh beberapa agency?
7. Apakah semua agency wajib menjawab?
8. Apa yang terjadi jika external agency tidak menjawab dalam 14 hari?
9. Siapa yang boleh override recommendation?
10. Bagaimana audit mencatat alasan override?
11. Apa yang terjadi jika policy berubah saat case sedang berjalan?
12. Apakah case lama memakai rule lama atau rule baru?
13. Apakah process instance lama dimigrasikan?
14. Apakah license issuance harus idempotent?
15. Apa yang terjadi jika notification terkirim tetapi process completion gagal?
16. Bagaimana repair dilakukan tanpa mengubah fakta bisnis?
17. Bagaimana menjelaskan keputusan ini 2 tahun kemudian?

Di sini BPMN yang bagus harus memperlihatkan titik keputusan penting, bukan seluruh detail teknis.

---

## 3. Tiga Layer State yang Harus Dipisahkan

Salah satu kesalahan paling mahal dalam sistem workflow adalah mencampur semua state ke satu field `status`.

Misalnya:

```text
APPLICATION.status = PENDING_REVIEW
APPLICATION.status = SENT_TO_AGENCY
APPLICATION.status = WAITING_DOCUMENT
APPLICATION.status = APPROVED
APPLICATION.status = REJECTED
APPLICATION.status = APPEALED
APPLICATION.status = SUSPENDED
APPLICATION.status = CLOSED
```

Awalnya terlihat sederhana. Lama-lama status menjadi tidak jelas:

- Apakah `WAITING_DOCUMENT` adalah state application atau state task?
- Apakah `SENT_TO_AGENCY` adalah state domain atau state process?
- Apakah `APPEALED` berarti application berubah, atau ada case baru?
- Apakah `SUSPENDED` state license, application, atau enforcement case?
- Apakah `CLOSED` berarti closed secara process, closed secara case, atau closed secara license validity?

Untuk regulatory system, minimal ada tiga layer state:

```text
1. Domain Entity State
2. Process Execution State
3. Work/Task State
```

### 3.1 Domain Entity State

Domain state adalah fakta bisnis yang long-lived.

Contoh `LicenseApplication`:

```text
DRAFT
SUBMITTED
UNDER_ASSESSMENT
PENDING_APPLICANT_ACTION
RECOMMENDED_APPROVAL
RECOMMENDED_REJECTION
APPROVED
REJECTED
WITHDRAWN
CANCELLED
```

Contoh `License`:

```text
ACTIVE
EXPIRED
SUSPENDED
REVOKED
REINSTATED
```

Contoh `EnforcementCase`:

```text
OPENED
UNDER_INVESTIGATION
PENDING_RESPONSE
LEGAL_REVIEW
DECISION_PENDING
WARNING_ISSUED
PENALTY_ISSUED
SUSPENSION_INITIATED
CLOSED
REOPENED
```

Domain state harus bisa dipahami bahkan tanpa workflow engine.

### 3.2 Process Execution State

Process execution state adalah posisi token BPMN.

Contoh:

```text
Process instance is waiting at User Task "Assess Application"
Process instance is waiting at Message Catch Event "Agency Response Received"
Process instance is waiting at Timer Event "Applicant Response Deadline"
Process instance is executing Service Task "Generate License Document"
Process instance is incident at Service Task "Publish Public Register Update"
```

Ini bukan fakta bisnis utama. Ini adalah state orchestration.

### 3.3 Work/Task State

Task state adalah state pekerjaan manusia.

Contoh:

```text
CREATED
READY
CLAIMED
IN_PROGRESS
COMPLETED
CANCELLED
REASSIGNED
EXPIRED
ESCALATED
```

Task state tidak selalu sama dengan domain state.

Satu application bisa `UNDER_ASSESSMENT`, sementara beberapa task paralel sedang `CLAIMED`, `COMPLETED`, dan `ESCALATED`.

### 3.4 Golden Rule

```text
Domain state answers: what is true about the business object?
Process state answers: where is the workflow token?
Task state answers: what work is currently assigned to whom?
```

Jika satu `status` mencoba menjawab ketiganya, desain akan rusak.

---

## 4. BPMN vs Case Management: Masalah Framing

BPMN sangat baik untuk proses yang punya alur cukup jelas:

```text
Start -> Review -> Decide -> Notify -> End
```

Tapi case management sering lebih dinamis:

- officer bisa meminta dokumen tambahan kapan saja,
- legal advice bisa diminta hanya untuk kasus tertentu,
- case bisa ditransfer,
- case bisa di-reopen,
- evidence bisa ditambahkan kapan saja,
- applicant bisa withdraw,
- complaint baru bisa di-link ke existing case,
- enforcement action bisa bercabang tergantung hasil investigasi,
- beberapa aktivitas bisa dilakukan ad-hoc.

Jika seluruh dinamika case dipaksa menjadi satu BPMN besar, diagram bisa menjadi sulit dibaca.

### 4.1 Kapan BPMN Cocok

BPMN cocok untuk:

- mandated process steps,
- SLA-driven workflow,
- approval path,
- external response wait,
- formal decision lifecycle,
- notification/issuance orchestration,
- escalation,
- compensation,
- audit-critical milestones,
- cross-system orchestration.

### 4.2 Kapan BPMN Kurang Cocok

BPMN kurang cocok untuk:

- free-form case notes,
- dynamic evidence gathering tanpa urutan tetap,
- ad-hoc collaboration,
- UI-level task grouping,
- document browsing,
- complex search/filter/reporting,
- record lifecycle yang lebih cocok state machine,
- fine-grained permission matrix,
- policy calculation yang lebih cocok DMN/rules.

### 4.3 Hybrid Model

Untuk case management, pola yang sering lebih sehat:

```text
Case Aggregate
  owns domain state, evidence, parties, decisions, audit pointers

BPMN Process
  coordinates formal lifecycle and deadlines

Task System
  presents human work to officers and supervisors

DMN/Rules
  decides routing, eligibility, SLA class, required documents

Document Service
  stores evidence and generated artifacts

Audit Service
  records defensible business actions
```

BPMN menjadi **spine** untuk lifecycle formal, bukan seluruh case universe.

---

## 5. Pattern 1 — Application Lifecycle Process

Application lifecycle adalah pola umum untuk licensing/permitting/registration.

### 5.1 Simplified Flow

```text
Applicant submits application
  -> Validate completeness
  -> Assign officer
  -> Assess application
  -> Request clarification? / Agency review? / Internal review?
  -> Make recommendation
  -> Approve/reject
  -> Issue outcome
  -> Notify applicant
  -> Close application
```

### 5.2 BPMN Model

High-level BPMN:

```text
Message Start: Application Submitted
  -> Service Task: Create Application Case
  -> Business Rule Task: Determine Assessment Path
  -> Exclusive Gateway: Requires Completeness Check?
      -> User Task: Completeness Review
      -> Gateway: Complete?
          -> No: Request Applicant Resubmission
          -> Yes: Continue
  -> User Task: Assess Application
  -> Gateway: Requires External Review?
      -> Yes: Call Activity: External Agency Review
      -> No: Continue
  -> Business Rule Task: Determine Recommendation
  -> User Task: Approver Decision
  -> Gateway: Approved?
      -> Yes: Service Task: Issue License
      -> No: Service Task: Record Rejection
  -> Service Task: Notify Applicant
  -> End
```

### 5.3 Domain State Mapping

BPMN should not blindly update domain state at every technical step.

Better state transitions:

```text
DRAFT -> SUBMITTED
SUBMITTED -> UNDER_ASSESSMENT
UNDER_ASSESSMENT -> PENDING_APPLICANT_ACTION
PENDING_APPLICANT_ACTION -> UNDER_ASSESSMENT
UNDER_ASSESSMENT -> APPROVED
UNDER_ASSESSMENT -> REJECTED
APPROVED -> CLOSED
REJECTED -> CLOSED
```

Not every BPMN element needs domain status.

Bad:

```text
status = VALIDATING_DOCUMENTS
status = RUNNING_DMN
status = CALLING_EXTERNAL_API
status = WAITING_TIMER
status = SENDING_EMAIL
```

These are execution concerns, not domain lifecycle states.

### 5.4 Key Decisions

For application lifecycle, explicitly model:

- completeness check,
- applicant resubmission,
- withdrawal,
- timeout/expiry,
- external review,
- approval/rejection,
- notification,
- appeal eligibility,
- license issuance failure,
- audit snapshots.

### 5.5 Recommended BPMN Design

Use subprocess/call activity for reusable chunks:

```text
Application Assessment Process
  -> Call Activity: Completeness Review
  -> Call Activity: External Agency Review
  -> Call Activity: Approval Decision
  -> Call Activity: Outcome Issuance
```

But avoid making everything a call activity. Only externalize when:

- reused by multiple process definitions,
- has independent lifecycle,
- has distinct versioning need,
- has different operational ownership,
- has significant complexity.

---

## 6. Pattern 2 — Renewal Process

Renewal looks similar to application, but semantics differ.

Initial application asks:

```text
Should this person/entity be granted a new right?
```

Renewal asks:

```text
Should an existing right continue?
```

This changes risk model, SLA, timing, and state handling.

### 6.1 Renewal Flow

```text
Timer Start: Renewal Window Opens
  -> Notify licensee
  -> Wait for renewal submission
  -> Gateway: Submitted before deadline?
      -> No: Mark license expired / trigger late renewal path
      -> Yes: Validate renewal
  -> Assess compliance history
  -> Determine review depth
  -> Approve / reject / conditional renewal
  -> Issue renewed license
  -> Notify
```

### 6.2 Important Modeling Questions

1. Is renewal initiated by timer or by applicant submission?
2. Is license still active during renewal review?
3. Is there a grace period?
4. Does renewal preserve license number?
5. Does rejection revoke current license or only deny renewal?
6. Can applicant continue operation while renewal is pending?
7. Are enforcement cases blocking renewal?
8. Are unpaid fees blocking renewal?
9. Are there auto-renewal cases?
10. Are there conditional renewals?

### 6.3 BPMN Boundary

Recommended separation:

```text
License Expiry Scheduler
  -> starts Renewal Invitation Process

Renewal Application Process
  -> handles submitted renewal

License Lifecycle State Machine
  -> ACTIVE / EXPIRING_SOON / PENDING_RENEWAL / EXPIRED / RENEWED
```

Do not make one giant process that begins when license is issued and waits for years until renewal.

Bad:

```text
Issue License
  -> Timer wait 3 years
  -> Renewal Process
```

Why bad:

- process instance lives unnecessarily long,
- versioning becomes difficult,
- timer volume grows,
- migration becomes painful,
- operational visibility is polluted.

Better:

```text
License domain stores expiry date
Scheduler starts renewal workflow when needed
```

---

## 7. Pattern 3 — Appeal Process

Appeal is not just another approval step. It is a separate legal/administrative lifecycle.

### 7.1 Appeal Semantics

Appeal usually means:

```text
A party challenges an earlier decision within allowed timeframe.
```

Therefore appeal has links to:

- original application/case,
- original decision,
- decision date,
- appeal deadline,
- appellant,
- grounds of appeal,
- supporting documents,
- appeal officer/board,
- final appeal decision.

### 7.2 Modeling Choice

Do not embed appeal as a late branch inside every application process unless appeal is truly part of the same lifecycle.

Often better:

```text
Original Application Process ends with decision
Appeal Window is represented in domain model/timer/scheduler
Appeal Submission starts a new Appeal Process linked to original decision
```

### 7.3 Appeal Process BPMN

```text
Message Start: Appeal Submitted
  -> Service Task: Validate Appeal Deadline
  -> Gateway: Appeal Admissible?
      -> No: Reject Appeal as Out of Time / Invalid
      -> Yes: Register Appeal Case
  -> User Task: Appeal Completeness Review
  -> User Task: Prepare Appeal Brief
  -> Gateway: Requires Hearing?
      -> Yes: Schedule Hearing
      -> No: Continue
  -> User Task: Appeal Decision
  -> Gateway: Outcome
      -> Uphold Original Decision
      -> Vary Decision
      -> Overturn Decision
      -> Remit for Reassessment
  -> Service Task: Apply Appeal Outcome
  -> Service Task: Notify Parties
  -> End
```

### 7.4 Important Design Point

Appeal outcome may affect the original domain object, but it should not rewrite history.

Bad:

```text
Original decision = APPROVED
```

if originally rejected but appeal overturned it.

Better:

```text
Original decision: REJECTED
Appeal decision: OVERTURNED
Current application outcome: APPROVED_AFTER_APPEAL
Decision history preserved
```

Audit defensibility requires append-only decision history.

---

## 8. Pattern 4 — Enforcement Lifecycle

Enforcement process is usually more complex than application process because facts emerge over time.

### 8.1 Enforcement Case Sources

An enforcement case may start from:

- complaint,
- inspection finding,
- internal monitoring,
- external agency referral,
- data analytics alert,
- renewal review finding,
- audit finding,
- public report.

### 8.2 Enforcement Flow

```text
Trigger received
  -> Triage
  -> Determine jurisdiction
  -> Determine severity
  -> Assign investigator
  -> Gather evidence
  -> Request response from regulated party
  -> Review response
  -> Legal review if required
  -> Decide action
  -> Issue warning / penalty / suspension / revocation / no action
  -> Monitor compliance
  -> Close case
```

### 8.3 Dynamic Nature

Investigation is often not linear.

Possible ad-hoc actions:

- add evidence,
- request more info,
- transfer case,
- merge duplicate complaint,
- split case,
- add respondent,
- change severity,
- escalate to supervisor,
- involve legal,
- hold case pending external matter,
- reopen after new evidence.

Do not model every ad-hoc action as a BPMN gateway.

Instead:

```text
BPMN models formal milestones
Case domain model supports ad-hoc actions under authorization and audit
```

### 8.4 Enforcement BPMN Spine

```text
Message Start: Enforcement Trigger Received
  -> User Task: Triage Case
  -> Gateway: Within Jurisdiction?
      -> No: Refer/Close
      -> Yes: Open Enforcement Case
  -> User Task: Investigation Planning
  -> Subprocess: Evidence Gathering Phase
  -> User Task: Investigator Recommendation
  -> Gateway: Requires Legal Review?
      -> Yes: User Task: Legal Review
  -> User Task: Decision Authority Review
  -> Gateway: Enforcement Outcome
      -> No Action
      -> Warning
      -> Penalty
      -> Suspension
      -> Revocation
  -> Call Activity: Issue Enforcement Outcome
  -> Gateway: Requires Monitoring?
      -> Yes: Subprocess: Compliance Monitoring
  -> Close Case
```

### 8.5 Evidence Gathering as Case Activity

Evidence gathering may be better represented as domain/case actions:

```text
Add Evidence
Request Document
Record Interview
Upload Inspection Report
Link Related Case
Record Finding
```

BPMN can represent the phase:

```text
Subprocess: Evidence Gathering Phase
  contains formal request/response deadlines only
```

Do not model every note/upload as BPMN service task.

---

## 9. Pattern 5 — Document Request / Resubmission Loop

Document request is deceptively tricky.

Simple model:

```text
Request Documents -> Wait for Applicant -> Review Documents
```

Production questions:

1. Can multiple requests be active at once?
2. Are requests versioned?
3. Is partial submission allowed?
4. Can officer ask follow-up clarification?
5. Is SLA paused while waiting?
6. What happens when deadline expires?
7. Can applicant request extension?
8. Are documents classified/sensitive?
9. Can old documents be reused?
10. What is the audit trail of requested vs submitted vs accepted documents?

### 9.1 Recommended Domain Model

Do not store document request only as BPMN variable.

Use domain tables:

```text
DOCUMENT_REQUEST
- request_id
- case_id
- requested_by
- requested_at
- due_at
- status
- reason
- request_version

DOCUMENT_REQUEST_ITEM
- item_id
- request_id
- document_type
- mandatory
- status
- remarks

DOCUMENT_SUBMISSION
- submission_id
- request_id
- submitted_by
- submitted_at
- status

DOCUMENT_SUBMISSION_ITEM
- submission_item_id
- item_id
- document_id
- accepted
- rejection_reason
```

BPMN coordinates:

```text
Create request
Notify applicant
Wait for submission message or deadline timer
Review submission
Continue / request again / expire
```

### 9.2 BPMN Pattern

```text
User Task: Review Completeness
  -> Gateway: Need More Documents?
      -> Yes:
          Service Task: Create Document Request
          Service Task: Notify Applicant
          Event-based Gateway:
              -> Message Catch: Documents Submitted
              -> Timer Catch: Submission Deadline Expired
          Gateway: Submitted?
              -> Yes: User Task: Review Submitted Documents
              -> No: Expiry Handling
      -> No: Continue Assessment
```

### 9.3 Loop Control

Avoid unlimited loop without policy.

Use explicit rules:

```text
maxRequestRounds = 3
extensionAllowed = true/false
deadlineDays = based on DMN
slaPaused = true while waiting applicant
```

Do not hardcode these in BPMN gateways if policy changes often. Use DMN/rules.

---

## 10. Pattern 6 — Multi-agency Review

Regulatory cases often require input from multiple departments or agencies.

Examples:

- legal unit,
- finance unit,
- enforcement unit,
- external ministry,
- police/security clearance,
- professional board,
- compliance department.

### 10.1 Review Topologies

There are several topologies:

#### Sequential Review

```text
Officer -> Legal -> Director -> Board
```

Use when each reviewer depends on previous reviewer result.

#### Parallel Independent Review

```text
Agency A
Agency B
Agency C
```

Use when reviews can happen independently.

#### Conditional Review

```text
If high risk -> Legal
If foreign applicant -> External Agency
If financial issue -> Finance
```

Use DMN to determine required reviewers.

#### Quorum Review

```text
Need at least 2 of 3 approvals
```

Use multi-instance with completion condition plus careful audit semantics.

#### Mandatory + Optional Review

```text
Legal must respond
Finance optional unless high risk
External agency timeout allowed after 14 days
```

Use explicit required/optional metadata.

### 10.2 Domain Model for Review Request

Do not rely only on parallel BPMN tokens.

Use review request entities:

```text
REVIEW_REQUEST
- review_request_id
- case_id
- reviewer_type
- reviewer_org
- mandatory
- due_at
- status
- recommendation
- response_at
- response_summary
- timeout_policy
```

This gives reporting, dashboard, audit, and repair visibility.

### 10.3 BPMN Pattern

```text
Business Rule Task: Determine Required Reviews
  -> Multi-instance Subprocess: Conduct Review
        inputCollection = requiredReviews
        elementVariable = review
        activities:
          Service Task: Send Review Request
          Event-based Gateway:
             -> Message Catch: Review Response Received
             -> Timer Catch: Review Timeout
          Service Task: Record Review Outcome
  -> Service Task: Aggregate Review Results
  -> Gateway: Can Proceed?
```

### 10.4 Aggregation Rule

Aggregation should not be hidden in BPMN expressions if complex.

Bad:

```text
${agencyA == 'OK' && agencyB != 'REJECT' && ...}
```

Better:

```text
DMN: Determine Consolidated Review Outcome
```

Input:

```text
mandatoryReviewsComplete
hasBlockingObjection
hasTimeoutAllowed
riskLevel
legalOpinion
financeOpinion
```

Output:

```text
PROCEED
PROCEED_WITH_CONDITION
WAIT_MORE
ESCALATE
REJECT
```

---

## 11. Pattern 7 — Maker-Checker / Four-Eyes Principle

Regulatory systems often require separation of duties.

Examples:

- preparer cannot approve own recommendation,
- officer cannot approve high-risk case,
- same person cannot create and waive fee,
- investigator cannot be final decision authority.

### 11.1 Do Not Trust BPMN Alone

BPMN can show maker-checker flow:

```text
User Task: Prepare Recommendation
  -> User Task: Approve Recommendation
```

But actual enforcement must be in authorization/domain service.

At task completion:

```java
if (currentUser.equals(case.recommendationPreparedBy())) {
    throw new ForbiddenActionException("Maker cannot approve own recommendation");
}
```

### 11.2 BPMN Pattern

```text
User Task: Officer Recommendation
  -> User Task: Supervisor Approval
  -> Gateway: Approved?
      -> Yes: Continue
      -> No: Return for Rework
```

### 11.3 Audit Requirements

Record:

- maker identity,
- checker identity,
- timestamps,
- action,
- reason,
- changed recommendation,
- overridden recommendation,
- policy basis,
- delegation if any.

### 11.4 Common Anti-pattern

Bad:

```text
Use candidate group only and assume maker-checker is enforced.
```

Candidate group controls task visibility, not necessarily separation of duties.

---

## 12. Pattern 8 — Case Reopening

Case reopening is one of the most misunderstood patterns.

There are several different meanings:

1. Reopen because of new evidence.
2. Reopen because previous closure was erroneous.
3. Reopen due to appeal outcome.
4. Reopen because compliance monitoring failed.
5. Reopen for administrative correction.
6. Reopen because external agency responded late.

These should not all be modeled as the same action.

### 12.1 Reopen as New Process vs Same Process

If the original process is already ended, do not try to resurrect the old process instance unless the engine supports modification and you have strong operational reason.

Usually better:

```text
Original Case Process ended
Reopen action creates Case Reopen Process linked to original case
```

### 12.2 Reopen Domain Model

```text
CASE_REOPENING
- reopening_id
- case_id
- reason_code
- initiated_by
- initiated_at
- approved_by
- approved_at
- status
- linked_evidence_id
- resulting_process_instance_key
```

### 12.3 BPMN Pattern

```text
Message Start: Reopen Requested
  -> User Task: Review Reopen Request
  -> Gateway: Approved?
      -> No: Record Reopen Rejection
      -> Yes:
          Service Task: Mark Case Reopened
          Gateway: Reopen Path
              -> Reassessment
              -> Investigation
              -> Legal Review
              -> Administrative Correction
  -> End
```

### 12.4 Audit Principle

Never erase closure history.

Bad:

```text
case.closedAt = null
case.status = OPEN
```

Better:

```text
case.status = REOPENED
caseHistory append: CLOSED at T1, REOPENED at T2 because REASON
```

---

## 13. Pattern 9 — Case Transfer

Case transfer can mean:

- transfer assignee,
- transfer team,
- transfer jurisdiction,
- transfer agency ownership,
- transfer process responsibility,
- transfer only a task.

These are different.

### 13.1 Task Reassignment

Simple task reassignment:

```text
Task.assignee = newOfficer
```

Usually not BPMN path.

### 13.2 Case Ownership Transfer

Case transfer:

```text
currentOwnerOrg -> newOwnerOrg
```

This may require:

- supervisor approval,
- reason,
- access control update,
- SLA recalculation,
- notification,
- audit,
- task cancellation/recreation,
- process continuation.

### 13.3 BPMN Pattern

If transfer is formal:

```text
Event Subprocess: Transfer Requested
  -> User Task: Approve Transfer
  -> Service Task: Update Case Ownership
  -> Service Task: Reassign Open Tasks
  -> Service Task: Notify Parties
  -> End Event
```

Whether it interrupts current work depends on policy.

Use non-interrupting event subprocess if current work can continue.
Use interrupting event subprocess if transfer cancels current responsibility.

---

## 14. Pattern 10 — Case Merge and Split

Case merge/split is difficult because it changes case topology.

### 14.1 Merge

Merge means:

```text
Two or more cases are determined to concern the same matter and should be handled as one.
```

Questions:

- Which case becomes master?
- What happens to process instances of merged cases?
- Are open tasks cancelled?
- Are documents moved or linked?
- Are deadlines recalculated?
- How is audit preserved?

### 14.2 Split

Split means:

```text
One case contains multiple matters/respondents/issues and should become multiple cases.
```

Questions:

- Which evidence belongs to which child case?
- Which deadlines transfer?
- Are decisions independent?
- Are parties notified?
- Can child cases have separate workflows?

### 14.3 Modeling Advice

Do not try to model arbitrary merge/split inside every process path.

Better:

```text
Case Management Service handles merge/split as privileged domain operation
BPMN process reacts through message/event or formal subprocess
```

Example:

```text
Message: CaseMerged
  -> Current process checks if it should cancel, continue, or transfer to master case
```

### 14.4 Audit

Merge/split must be append-only and traceable:

```text
CASE_RELATION
- parent_case_id
- child_case_id
- relation_type: MERGED_INTO / SPLIT_FROM / RELATED_TO
- effective_at
- reason
- created_by
```

---

## 15. Pattern 11 — Suspension and Revocation

Suspension/revocation affects an existing right/license. It is legally heavier than simple rejection.

### 15.1 Domain Difference

Application rejection:

```text
A requested right is not granted.
```

Suspension:

```text
An existing right is temporarily restricted.
```

Revocation:

```text
An existing right is removed.
```

Therefore process must handle due process, notice, response, legal authority, effective date, appeal, and public register changes.

### 15.2 BPMN Pattern

```text
Start: Enforcement Decision Requires Suspension/Revocation
  -> User Task: Prepare Notice of Intent
  -> Service Task: Serve Notice
  -> Event-based Gateway:
      -> Message Catch: Representation Received
      -> Timer Catch: Representation Deadline Expired
  -> User Task: Review Representation
  -> Gateway: Proceed?
      -> No: Close Without Action / Warning
      -> Yes: User Task: Decision Authority Approval
  -> Service Task: Apply Suspension/Revocation
  -> Service Task: Update Public Register
  -> Service Task: Notify Parties
  -> Gateway: Appeal Window Active?
      -> End / Link to Appeal Process
```

### 15.3 Critical Side Effects

Side effects include:

- license status update,
- public register update,
- notification,
- fee/penalty update,
- external agency notification,
- access restriction,
- published notice.

Each side effect should be idempotent and auditable.

### 15.4 Effective Date

Do not confuse decision date and effective date.

```text
decisionAt = when authority decided
servedAt = when notice served
effectiveAt = when suspension/revocation takes effect
appealDeadlineAt = last day to appeal
```

BPMN timers may depend on each of these.

---

## 16. Pattern 12 — Compliance Monitoring

After enforcement or conditional approval, system may need monitoring.

### 16.1 Monitoring Flow

```text
Condition imposed
  -> Schedule compliance check
  -> Wait until due date
  -> Officer verifies compliance
  -> Gateway: Complied?
      -> Yes: Close monitoring
      -> No: Escalate enforcement
```

### 16.2 Avoid Long Sleeping Process for Everything

For many future checks, do not create millions of long-running process instances unnecessarily.

Options:

1. BPMN timer for important case-specific deadline.
2. Scheduler scans compliance obligations and starts process when due.
3. Event-driven process starts when external evidence arrives.

Decision:

```text
If deadline is part of active case lifecycle -> BPMN timer is reasonable
If deadline is far future/high volume -> domain scheduler may be better
```

### 16.3 Compliance Obligation Domain Model

```text
COMPLIANCE_OBLIGATION
- obligation_id
- case_id
- subject_id
- obligation_type
- due_at
- status
- fulfilled_at
- verification_required
- process_instance_key
```

BPMN handles verification workflow, not the entire obligation universe.

---

## 17. Pattern 13 — Inspection Workflow

Inspection workflow combines scheduling, field work, findings, follow-up, and enforcement trigger.

### 17.1 Inspection Lifecycle

```text
Plan inspection
  -> Assign inspector
  -> Schedule inspection
  -> Conduct inspection
  -> Submit report
  -> Review findings
  -> Gateway: Non-compliance?
      -> No: Close inspection
      -> Yes: Create enforcement case / request corrective action
```

### 17.2 Offline/Field Reality

Inspection may involve:

- mobile app offline mode,
- photos/documents,
- geo-tagging,
- respondent signature,
- checklist,
- immediate prohibition notice,
- delayed upload.

Do not put mobile offline steps inside BPMN unless they are formal workflow milestones.

### 17.3 BPMN Pattern

```text
User Task: Plan Inspection
  -> User Task: Conduct Inspection
  -> Message Catch: Inspection Report Submitted
  -> User Task: Review Inspection Report
  -> DMN: Determine Follow-up Action
  -> Gateway:
      -> Close
      -> Request Corrective Action
      -> Open Enforcement Case
```

Inspection report itself belongs in domain/document store.

---

## 18. Pattern 14 — Legal Review and Board Decision

Legal/board review often has formal authority and meeting cycles.

### 18.1 Legal Review

```text
Request legal advice
  -> Legal officer reviews facts
  -> Legal opinion issued
  -> Case officer incorporates opinion
```

Legal opinion may be advisory or binding.

Model this explicitly:

```text
legalOpinionType = ADVISORY | REQUIRED | BINDING
```

### 18.2 Board Decision

Board process may include:

- agenda preparation,
- meeting scheduling,
- quorum check,
- paper circulation,
- voting,
- minute approval,
- decision publication.

This may deserve its own reusable process:

```text
Call Activity: Board Decision Process
```

Input:

```text
caseId
matterType
requiredQuorum
boardType
papers
recommendation
```

Output:

```text
boardDecision
decisionDate
conditions
minuteReference
```

### 18.3 Avoid Over-detailing Meeting Mechanics

If board meeting management is a separate system, BPMN should wait for outcome:

```text
Send matter to Board System
Wait for BoardDecisionReceived message
```

Do not duplicate board system internals in regulatory case BPMN.

---

## 19. Pattern 15 — Notification and Service of Notice

In regulatory systems, notification may be legally significant.

Not all notifications are equal.

### 19.1 Notification Types

```text
Informational notification
Action-required notification
Legal notice
Decision letter
Reminder
Escalation notice
Public notice
```

### 19.2 Service Semantics

Legal notice may require:

- delivery channel,
- served date,
- deemed served date,
- acknowledgement,
- retry if failed,
- alternative service,
- document version,
- recipient identity,
- proof of service.

### 19.3 BPMN Pattern

```text
Service Task: Generate Notice
  -> Service Task: Send Notice
  -> Gateway: Requires Acknowledgement?
      -> Yes:
          Event-based Gateway:
             -> Message Catch: Acknowledged
             -> Timer Catch: Acknowledgement Deadline
      -> No: Continue
  -> Service Task: Record Service Result
```

### 19.4 Notification Side Effect Safety

Sending notice is a side effect. Use idempotency:

```text
noticeId
caseId
noticeType
recipientId
templateVersion
idempotencyKey
```

If worker crashes after sending but before completing job, retry must not send duplicate legal notices unless policy allows.

---

## 20. Pattern 16 — Fee, Penalty, and Payment Process

Fee/payment integration requires careful separation.

### 20.1 Payment States

```text
PAYMENT_REQUIRED
PAYMENT_PENDING
PAYMENT_CONFIRMED
PAYMENT_FAILED
PAYMENT_EXPIRED
PAYMENT_WAIVED
REFUND_PENDING
REFUNDED
```

### 20.2 BPMN Pattern

```text
Service Task: Create Payment Request
  -> Service Task: Notify Applicant to Pay
  -> Event-based Gateway:
      -> Message Catch: Payment Confirmed
      -> Timer Catch: Payment Deadline Expired
  -> Gateway: Paid?
      -> Yes: Continue
      -> No: Expire / Cancel / Escalate
```

### 20.3 Payment Source of Truth

Payment source of truth should usually be payment/finance service, not BPMN variable.

BPMN variable can hold:

```text
paymentRequestId
paymentStatusSnapshot
paymentDeadlineAt
```

But final truth is external/domain payment record.

### 20.4 Reconciliation

Always design reconciliation:

- payment gateway callback lost,
- duplicate callback,
- late callback after expiry,
- paid but process expired,
- refund required,
- waiver approved.

BPMN should coordinate but domain service should validate.

---

## 21. Process Landscape for Regulatory Systems

Instead of one huge process, design a process landscape.

Example:

```text
License Application Process
Renewal Process
Amendment Process
Appeal Process
Enforcement Case Process
Investigation Process
Document Request Process
External Agency Review Process
Board Decision Process
Notification/Notice Process
Payment Process
Compliance Monitoring Process
Case Reopen Process
```

### 21.1 Process Landscape Diagram

```text
+----------------------------+
| License Application Process|
+-------------+--------------+
              |
              | may call
              v
+-------------+--------------+
| Document Request Process   |
+----------------------------+
              |
              v
+----------------------------+
| External Agency Review     |
+----------------------------+
              |
              v
+----------------------------+
| Board Decision Process     |
+----------------------------+

+----------------------------+
| Enforcement Case Process   |
+-------------+--------------+
              |
              +--> Investigation Process
              +--> Notice Process
              +--> Appeal Process
              +--> Compliance Monitoring
```

### 21.2 Process Ownership

Each process should have:

- business owner,
- technical owner,
- SLA owner,
- support runbook,
- versioning policy,
- data contract,
- decision contract,
- audit requirements.

A process without owner becomes operational debt.

---

## 22. Domain Model Patterns

A workflow process is only as good as the domain model underneath it.

### 22.1 Core Regulatory Entities

Common entities:

```text
Case
Application
License
Party
Officer
Organization
Task
Decision
Recommendation
Document
Evidence
ReviewRequest
Notice
Payment
Appeal
EnforcementAction
ComplianceObligation
AuditEvent
```

### 22.2 Case Aggregate

Example:

```java
public class RegulatoryCase {
    private CaseId id;
    private CaseType type;
    private CaseStatus status;
    private RiskLevel riskLevel;
    private PartyId primaryPartyId;
    private OfficerId assignedOfficerId;
    private OrganizationId owningUnitId;
    private Instant openedAt;
    private Instant closedAt;
    private List<CaseRelation> relations;
    private List<DecisionRef> decisions;
    private List<DocumentRef> documents;
    private List<ProcessRef> processes;
}
```

Important: domain object references process, but should not become dependent on BPMN internals everywhere.

### 22.3 Process Reference

```java
public record ProcessRef(
    String processDefinitionId,
    Long processInstanceKey,
    String processVersion,
    String purpose,
    Instant startedAt,
    Instant endedAt
) {}
```

This gives traceability without making the domain model a mirror of the engine state.

---

## 23. Audit Model Patterns

Regulatory systems need defensible audit, not just technical logs.

### 23.1 Audit Event Shape

```text
AUDIT_EVENT
- audit_event_id
- case_id
- entity_type
- entity_id
- action
- actor_type
- actor_id
- actor_role
- occurred_at
- reason_code
- reason_text
- before_snapshot
- after_snapshot
- process_instance_key
- element_id
- task_id
- correlation_id
- source_ip/device if needed
```

### 23.2 Audit Event Examples

```text
APPLICATION_SUBMITTED
COMPLETENESS_REVIEW_COMPLETED
DOCUMENT_REQUESTED
DOCUMENT_SUBMITTED
DOCUMENT_ACCEPTED
RECOMMENDATION_PREPARED
RECOMMENDATION_OVERRIDDEN
DECISION_APPROVED
DECISION_REJECTED
NOTICE_SERVED
CASE_TRANSFERRED
CASE_REOPENED
LICENSE_SUSPENDED
LICENSE_REVOKED
```

### 23.3 Audit vs History Table

Camunda history/Operate data is useful, but regulatory audit should not depend solely on engine history.

Reason:

- engine data may be optimized/cleaned up,
- audit format must be business-readable,
- audit may need domain snapshots,
- audit may outlive process engine migration,
- auditors ask business questions, not token questions.

Use engine identifiers as references, not as the only audit record.

---

## 24. Decision Model Patterns

Use DMN/rules for policy decisions.

### 24.1 Common Decisions

```text
Determine required documents
Determine risk level
Determine assessment path
Determine SLA category
Determine required reviewers
Determine fee
Determine penalty range
Determine appeal admissibility
Determine enforcement outcome recommendation
Determine notification template
```

### 24.2 Decision Snapshot

For regulatory defensibility, store decision snapshot:

```text
decisionId
decisionDefinitionKey
decisionVersion
inputSnapshot
outputSnapshot
evaluatedAt
evaluatedBy/process
```

If policy changes later, old decisions remain explainable.

### 24.3 Flow vs Decision

Bad BPMN:

```text
Gateway: applicantType == A && riskScore > 80 && hasForeignShareholder && ...
```

Better:

```text
Business Rule Task: Determine Assessment Path
Gateway: assessmentPath
```

---

## 25. Task Model Patterns

Tasklist is useful, but many enterprise systems build custom task inbox.

### 25.1 Task Projection

Create a task projection optimized for UI/search:

```text
TASK_VIEW
- task_id
- engine_task_key
- case_id
- business_ref_no
- task_name
- task_type
- assignee
- candidate_group
- priority
- due_at
- follow_up_at
- status
- created_at
- claimed_at
- completed_at
- process_instance_key
```

This can be fed by:

- Camunda Tasklist API polling,
- exporter/read model,
- app-side task creation events,
- domain events.

### 25.2 Task Completion Flow

Task completion should go through backend authorization/domain validation:

```text
Frontend -> Case API -> validate permission -> validate domain invariants -> complete Camunda task/job -> audit
```

Avoid:

```text
Frontend -> Camunda API directly
```

unless your security model is intentionally designed for that.

---

## 26. SLA Model Patterns

SLA is rarely just a timer.

### 26.1 SLA Dimensions

```text
startAt
pauseAt
resumeAt
dueAt
breachedAt
closedAt
calendarType
businessDaysOnly
owningUnit
priority
caseType
```

### 26.2 SLA Events

```text
SLA_STARTED
SLA_PAUSED_WAITING_APPLICANT
SLA_RESUMED
SLA_EXTENDED
SLA_BREACHED
SLA_COMPLETED
```

### 26.3 BPMN + SLA Service

BPMN can trigger SLA changes:

```text
On enter Assessment -> start SLA
On request applicant document -> pause SLA
On applicant response -> resume SLA
On final decision -> stop SLA
```

But SLA calculation should often live in SLA service/domain layer, especially if business calendar is complex.

---

## 27. Authorization Patterns in Case Workflow

Authorization in regulatory systems is contextual.

A user may be allowed to see a case only if:

- they belong to owning unit,
- they are assigned officer,
- they are supervisor of assigned officer,
- they are legal reviewer,
- they belong to external agency involved,
- case is not confidential,
- case is at a certain stage,
- task is assigned to their group,
- they have delegated authority.

### 27.1 Authorization at Task Query

Controls what user can see.

### 27.2 Authorization at Action

Controls what user can do.

### 27.3 Authorization at Field

Controls what user can edit.

### 27.4 Authorization at Decision

Controls whether user has authority to approve/reject/override.

Do not conflate these.

Example:

```text
User can view case but cannot approve.
User can complete assessment task but cannot issue final decision.
User can approve low-risk case but not high-risk case.
User can see document metadata but not protected content.
```

---

## 28. Workflow and Entity Invariants

Top-level engineers think in invariants.

### 28.1 Example Invariants

```text
A final decision cannot be issued before mandatory reviews are complete.
A maker cannot approve their own recommendation.
A license cannot be ACTIVE and REVOKED at the same time.
A case cannot be closed with unresolved mandatory document requests.
A suspension must have a decision authority and effective date.
A revocation notice must be served before revocation takes effect unless emergency power applies.
An appeal cannot be accepted after deadline unless extension approved.
A public register update must reference an approved license decision.
```

### 28.2 Where to Enforce Invariants

Some invariants belong in BPMN:

```text
Mandatory review before decision
```

Some belong in domain service:

```text
License cannot transition from REVOKED to ACTIVE except via reinstatement process
```

Some belong in authorization service:

```text
Approver must hold required authority
```

Some belong in database constraints:

```text
Unique active license per regulated entity and license type
```

Do not rely on BPMN alone for all invariants.

---

## 29. Workflow Boundary Heuristics

When deciding whether to model something in BPMN, ask:

### 29.1 Put in BPMN if:

- it is a formal process milestone,
- it involves waiting,
- it involves human assignment,
- it affects SLA,
- it involves cross-system coordination,
- it requires visibility in Operate/Tasklist,
- it has explicit business branching,
- it has compensation/escalation semantics,
- it must be auditable as process path.

### 29.2 Do not put in BPMN if:

- it is just a field update,
- it is UI-only state,
- it is low-level validation,
- it is complex calculation better suited for code/DMN,
- it is document storage detail,
- it is search/reporting concern,
- it is frequent ad-hoc action without formal lifecycle,
- it causes huge diagram complexity without operational value.

### 29.3 Grey Area

If uncertain, model the **phase** in BPMN and details in domain model.

Example:

```text
BPMN: Evidence Gathering Phase
Domain: evidence upload, notes, tags, interview records, links
```

---

## 30. Process Design Review Framework

For any regulatory BPMN model, review these dimensions.

### 30.1 Business Correctness

- Does model reflect actual authority and responsibility?
- Are mandatory decisions explicit?
- Are optional/ad-hoc actions separated?
- Are legal deadlines represented?
- Are decision outcomes complete?

### 30.2 Runtime Correctness

- Are wait states clear?
- Are timers clear?
- Are message correlations stable?
- Are parallel branches safe?
- Are loops bounded?
- Are subprocess boundaries justified?

### 30.3 Data Correctness

- Are variables minimal?
- Is source of truth clear?
- Are snapshots stored for decisions?
- Are documents referenced, not embedded?
- Is schema versioned?

### 30.4 Reliability

- Are workers idempotent?
- Are side effects safe?
- Are retries classified?
- Are incidents repairable?
- Is reconciliation available?

### 30.5 Security

- Who can start process?
- Who can see task?
- Who can complete task?
- Who can override decision?
- Are sensitive variables minimized?
- Are privileged repairs audited?

### 30.6 Audit

- Can we explain why decision was made?
- Can we see who made recommendation?
- Can we see who approved?
- Can we see policy version?
- Can we see documents considered?
- Can we see late/override/escalation reasons?

### 30.7 Operations

- Can support identify stuck cases?
- Can support retry safely?
- Can support correct variables safely?
- Are runbooks available?
- Are dashboards available?
- Are SLAs monitored?

### 30.8 Change Management

- Can process evolve without breaking running instances?
- Are element IDs stable?
- Are worker contracts versioned?
- Are DMN/forms bound correctly?
- Is migration plan documented?

---

## 31. Worked Example — End-to-End Regulatory Application with Enforcement Link

### 31.1 Scenario

A company applies for a regulated license.

Rules:

1. Application must pass completeness check.
2. High-risk applications require legal review.
3. Foreign ownership requires external agency clearance.
4. Applicant may be asked for more documents up to 2 rounds.
5. SLA pauses while waiting for applicant.
6. Supervisor approval required for approval/rejection.
7. If rejected, applicant can appeal within 21 days.
8. If false declaration is detected, enforcement case starts.

### 31.2 Process Landscape

```text
License Application Process
  -> Document Request Process
  -> External Agency Review Process
  -> Legal Review Task
  -> Approval Decision
  -> Notification Process

Appeal Process
  -> linked to Application Decision

Enforcement Case Process
  -> started if false declaration detected
```

### 31.3 Domain Objects

```text
Application
ApplicationDecision
DocumentRequest
ReviewRequest
License
Appeal
EnforcementCase
AuditEvent
```

### 31.4 BPMN High-level

```text
Message Start: Application Submitted
  -> Service Task: Register Application
  -> DMN: Determine Required Documents and Review Path
  -> User Task: Completeness Review
  -> Gateway: Complete?
      -> No: Call Activity: Document Request Process
      -> Yes: Continue
  -> Gateway: External Clearance Required?
      -> Yes: Call Activity: External Agency Review
  -> Gateway: Legal Review Required?
      -> Yes: User Task: Legal Review
  -> User Task: Officer Assessment
  -> User Task: Supervisor Decision
  -> Gateway: Outcome
      -> Approved: Issue License
      -> Rejected: Record Rejection
      -> False Declaration: Start Enforcement Case + Decide Application
  -> Notify Applicant
  -> End
```

### 31.5 Domain State Transitions

```text
DRAFT -> SUBMITTED
SUBMITTED -> UNDER_ASSESSMENT
UNDER_ASSESSMENT -> PENDING_APPLICANT_ACTION
PENDING_APPLICANT_ACTION -> UNDER_ASSESSMENT
UNDER_ASSESSMENT -> APPROVED
UNDER_ASSESSMENT -> REJECTED
UNDER_ASSESSMENT -> REFERRED_TO_ENFORCEMENT
APPROVED -> LICENSE_ISSUED
```

### 31.6 Audit Events

```text
APPLICATION_SUBMITTED
APPLICATION_REGISTERED
COMPLETENESS_REVIEW_COMPLETED
DOCUMENT_REQUEST_CREATED
DOCUMENT_SUBMISSION_RECEIVED
EXTERNAL_REVIEW_REQUESTED
EXTERNAL_REVIEW_RECEIVED
LEGAL_REVIEW_COMPLETED
OFFICER_RECOMMENDATION_RECORDED
SUPERVISOR_DECISION_RECORDED
LICENSE_ISSUED
APPLICATION_REJECTED
ENFORCEMENT_CASE_STARTED
APPLICANT_NOTIFIED
```

### 31.7 Repair Scenarios

Scenario: external agency response received but correlation failed.

Repair approach:

1. Verify inbound event table.
2. Verify correlation key.
3. Verify process subscription state.
4. If process still waiting, republish message with same event id/idempotency key.
5. If process already timed out, evaluate late-response policy.
6. Record repair audit.

Scenario: license issued but process failed before completion.

Repair approach:

1. Check license domain record.
2. Confirm idempotency key.
3. Retry process job.
4. Worker detects existing issued license and returns success.
5. Process continues to notification.
6. No duplicate license generated.

---

## 32. Anti-patterns in Regulatory BPMN

### 32.1 One Giant Case Process

```text
Application + Renewal + Appeal + Enforcement + Inspection + Payment + Board + Notification in one BPMN
```

Problem:

- unreadable,
- untestable,
- hard to version,
- hard to migrate,
- hard to operate.

### 32.2 BPMN as Database

Storing all case facts as variables only.

Problem:

- poor reporting,
- poor search,
- poor domain integrity,
- fragile audit,
- hard migration.

### 32.3 Status Explosion

One status enum contains domain, process, task, integration, and UI state.

Problem:

- impossible invariants,
- unclear reporting,
- brittle logic.

### 32.4 Gateway Jungle

Every policy rule becomes BPMN gateway.

Problem:

- unreadable,
- policy changes require BPMN redeployment,
- no clear decision audit.

Use DMN/rules.

### 32.5 User Task as Authorization

Assuming task assignment alone enforces authority.

Problem:

- candidate group does not enforce maker-checker,
- direct API misuse possible,
- domain invariants bypassed.

### 32.6 No Late Event Policy

External response arrives after timeout and system has no rule.

Problem:

- inconsistent case outcome,
- manual support chaos,
- audit ambiguity.

### 32.7 Reopen by Mutating History

Setting closed case back to open without history.

Problem:

- audit invalid,
- legal defensibility weak,
- reporting wrong.

### 32.8 Hidden Process Coupling

Call activity depends on undocumented variables from parent.

Problem:

- reusable process not actually reusable,
- breakage during versioning,
- hard testing.

---

## 33. Java Architecture Pattern for Regulatory Workflow

### 33.1 Package Structure

```text
com.example.regulatory
  application
    api
    command
    query
    workflow
      worker
      variables
      message
      process
  casecore
    domain
    repository
    service
    audit
  task
    domain
    query
    authorization
  decision
    dmn
    snapshot
  document
    service
  notification
    service
  enforcement
    domain
    workflow
  shared
    idempotency
    outbox
    security
    observability
```

### 33.2 Worker Calls Domain Service

```java
@Component
public class RegisterApplicationWorker {

    private final ApplicationCommandService applicationService;
    private final IdempotencyService idempotencyService;

    @JobWorker(type = "application.register")
    public Map<String, Object> handle(ActivatedJob job) {
        var vars = ApplicationSubmittedVars.from(job.getVariablesAsMap());

        var result = idempotencyService.executeOnce(
            "application.register",
            vars.applicationId(),
            job.getElementInstanceKey(),
            () -> applicationService.registerSubmittedApplication(vars)
        );

        return Map.of(
            "caseId", result.caseId().value(),
            "applicationRefNo", result.referenceNo(),
            "registeredAt", result.registeredAt().toString()
        );
    }
}
```

### 33.3 Domain Service Owns Invariants

```java
public class ApplicationCommandService {

    public RegisterApplicationResult registerSubmittedApplication(ApplicationSubmittedVars vars) {
        Application app = repository.find(vars.applicationId())
            .orElseThrow(() -> new ApplicationNotFoundException(vars.applicationId()));

        app.ensureCanBeRegistered();
        app.markUnderAssessment(clock.instant());

        RegulatoryCase caze = caseService.openCaseForApplication(app);

        audit.record(ApplicationAudit.applicationRegistered(app, caze));

        return new RegisterApplicationResult(caze.id(), app.referenceNo(), clock.instant());
    }
}
```

BPMN coordinates. Domain service protects truth.

---

## 34. Mental Model: Regulatory Process as Evidence-based State Evolution

A good regulatory system is not just workflow automation.

It is an evidence-based state evolution system:

```text
Input facts
  -> policy/rule evaluation
  -> human assessment
  -> evidence collection
  -> formal decision
  -> enforceable outcome
  -> audit record
```

BPMN makes the lifecycle explicit.
DMN makes policy decisions explicit.
Domain model preserves facts.
Task model assigns work.
Audit model preserves defensibility.
Workers integrate side effects.
Operations model enables repair.

Top 1% engineering is not “draw more BPMN”. It is knowing where BPMN should stop.

---

## 35. Practical Checklist for Regulatory Workflow Design

Before implementing, answer:

### Domain

- What is the primary business object?
- What is the domain lifecycle?
- What states are true business facts?
- What states are only process execution details?
- What invariants must never be violated?

### Process

- What formal lifecycle needs BPMN?
- What ad-hoc case actions stay outside BPMN?
- What are wait states?
- What are SLA points?
- What are escalation points?
- What are cancellation points?

### Decisions

- What decisions belong in DMN/rules?
- What decision version must be stored?
- What input/output snapshot is required?
- What manual override is allowed?

### Tasks

- Who can see each task?
- Who can complete each task?
- What actions are available?
- What field-level permissions apply?
- What maker-checker rules apply?

### Integration

- What external systems are involved?
- What is the source of truth?
- What is the idempotency key?
- What is the late event policy?
- What is the reconciliation path?

### Audit

- Can the decision be explained later?
- Are documents/evidence linked?
- Are reasons recorded?
- Are overrides recorded?
- Are process identifiers captured?

### Operations

- How do we detect stuck cases?
- How do we repair safely?
- Who can repair?
- What must be audited during repair?
- What dashboards exist?

### Change

- What changes are likely?
- What can change via DMN/config?
- What requires BPMN version?
- What requires domain migration?
- How are running cases handled?

---

## 36. Summary

Regulatory and case management systems require more than BPMN fluency.

The key is architectural separation:

```text
BPMN = formal lifecycle coordination
Domain model = business truth
DMN/rules = policy decision
Task model = human work surface
Audit model = defensible record
Document model = evidence
Authorization model = authority boundary
Operations model = repair and support
```

Advanced modeling means:

- not putting everything into BPMN,
- modeling only meaningful lifecycle milestones,
- separating domain state from process state,
- making decisions versioned and auditable,
- designing late event/timeout/appeal/reopen behavior explicitly,
- preserving history instead of mutating it away,
- building worker-side idempotency and domain invariants,
- and ensuring every production repair is explainable.

For regulatory systems, the best workflow design is one that can answer:

```text
What happened?
Who did it?
Why was it allowed?
What evidence was considered?
Which rule/policy version applied?
What process path was followed?
What exception occurred?
How was it repaired?
Can we defend this decision later?
```

If the system can answer those questions consistently, BPMN/Camunda is being used as a serious process orchestration platform, not merely a diagramming tool.

---

## References

- OMG BPMN 2.0 specification and BPMN 2.0.2 overview.
- Camunda 8 documentation on user tasks, call activities, subprocesses, events, and readable process model best practices.
- Camunda documentation on BPMN symbols and process modeling guidance.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-bpmn-camunda-process-orchestration-engineering](./learn-java-bpmn-camunda-part-26-process-versioning-deployment-strategy-change-management.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-bpmn-camunda-process-orchestration-engineering](./learn-java-bpmn-camunda-part-28-workflow-engine-vs-state-machine-rules-engine-temporal.md)

</div>