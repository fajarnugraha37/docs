# learn-java-camunda-7-bpm-platform-engineering-part-035.md

# Part 035 — Capstone: Designing a Production-Grade Regulatory Case Management Platform with Camunda 7

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Bagian: `035` dari `035`  
> Topik: Capstone architecture, production-grade regulatory case management, workflow correctness, auditability, operations, migration readiness  
> Target pembaca: Java engineer / tech lead / platform engineer yang ingin mampu mendesain, mengoperasikan, dan mempertahankan platform workflow berbasis Camunda 7 di lingkungan enterprise/regulatory.

---

## 0. Tujuan Bagian Ini

Bagian ini adalah **capstone** dari seluruh seri Camunda 7.

Di bagian-bagian sebelumnya kita sudah membedah:

- process engine architecture,
- execution tree,
- wait state,
- transaction boundary,
- async continuation,
- job executor,
- database schema,
- optimistic locking,
- variable serialization,
- delegation code,
- external task,
- message correlation,
- timer/SLA,
- human task,
- history/audit,
- incidents,
- process migration,
- multi-tenancy,
- authorization,
- Spring/Jakarta runtime,
- REST governance,
- DMN/CMMN,
- performance,
- database operations,
- observability,
- testing,
- correctness modelling,
- advanced patterns,
- engine extension,
- deployment topology,
- upgrade compatibility,
- Camunda 7 to Camunda 8 migration.

Sekarang kita gabungkan semuanya dalam satu rancangan konkret:

> **Production-grade regulatory case management platform berbasis Java + Camunda 7.**

Contoh domain yang akan kita pakai:

- enforcement lifecycle,
- inspection,
- application review,
- compliance case,
- appeal,
- approval workflow,
- evidence handling,
- SLA escalation,
- audit defensibility,
- multi-agency / multi-tenant operation.

Tujuan utama bagian ini bukan membuat contoh aplikasi kecil. Tujuannya adalah membangun **mental model arsitektur platform** yang cukup kuat untuk:

1. mendesain workflow yang benar secara domain,
2. menempatkan Camunda 7 pada boundary yang tepat,
3. menghindari workflow spaghetti,
4. memastikan process bisa dipulihkan setelah failure,
5. membuat audit trail defensible,
6. menjaga data growth dan operational stability,
7. menyiapkan migration path ke platform berikutnya.

---

## 1. Premis Utama: Camunda 7 Bukan Sistem Case Management Lengkap

Premis pertama yang harus jelas:

> Camunda 7 adalah durable process/workflow engine, bukan seluruh case management platform.

Camunda 7 sangat kuat untuk:

- mengelola durable process state,
- menunggu human task,
- menunggu message/event,
- menjalankan timer,
- membuat async retry boundary,
- mengorkestrasi long-running workflow,
- mencatat technical process history,
- mengekspos operasi runtime melalui API,
- membantu operator melihat process state melalui Cockpit.

Namun Camunda 7 **bukan pengganti**:

- domain database,
- business audit ledger,
- document/evidence repository,
- search index,
- authorization policy engine,
- notification platform,
- data warehouse,
- regulatory decision record,
- reporting mart,
- user-facing case UI,
- integration gateway,
- enterprise identity provider.

Arsitektur yang sehat biasanya menempatkan Camunda 7 sebagai:

> **durable workflow coordinator** di tengah domain platform, bukan sebagai satu-satunya source of truth untuk semua data case.

---

## 2. Target Architecture Secara Besar

Gambaran high-level:

```text
+------------------------------+
|          User / Officer      |
+---------------+--------------+
                |
                v
+------------------------------+
|        Case Management UI     |
| - inbox                       |
| - case detail                 |
| - evidence                    |
| - decision form               |
| - audit timeline              |
+---------------+--------------+
                |
                v
+------------------------------+
|      Domain API / BFF Layer   |
| - authN/authZ enforcement     |
| - state invariant             |
| - assignment validation       |
| - four-eyes rule              |
| - idempotency                 |
| - audit writing               |
| - Camunda facade              |
+---------------+--------------+
                |
     +----------+----------+
     |                     |
     v                     v
+------------+       +----------------+
| Domain DB  |       | Camunda 7 DB    |
| Case       |       | ACT_RU_*        |
| Evidence   |       | ACT_HI_*        |
| Decision   |       | ACT_RE_*        |
| Audit      |       | ACT_GE_*        |
+------------+       +----------------+
     |                     ^
     |                     |
     v                     |
+------------+       +----------------+
| Outbox     | ----> | Camunda Engine  |
| Inbox      | <---- | RuntimeService  |
+------------+       | TaskService     |
                     | HistoryService  |
                     | Job Executor    |
                     +-------+--------+
                             |
                             v
                     +----------------+
                     | External       |
                     | Workers        |
                     | - email        |
                     | - integration  |
                     | - document     |
                     | - scoring      |
                     +----------------+
```

Core idea:

- **Domain API** adalah boundary publik aplikasi.
- **Camunda API** adalah engine API internal/platform API.
- **Domain DB** menyimpan case facts, decision, evidence metadata, dan business audit.
- **Camunda DB** menyimpan process runtime/history.
- **Outbox/inbox** menjaga reliable integration dan idempotency.
- **Projection/read model** melayani dashboard, inbox, report, search.
- **Camunda Cockpit** dipakai operator/platform support, bukan end-user biasa.

---

## 3. Pembagian Responsibility

### 3.1 Camunda Bertanggung Jawab Untuk

Camunda cocok menjadi owner untuk:

| Concern | Di Camunda? | Catatan |
|---|---:|---|
| Current workflow position | Ya | Activity/user task/wait state. |
| User task lifecycle | Ya | Assignment, claim, complete, delegate, resolve. |
| Timer/SLA trigger teknis | Ya | Timer job due date, escalation trigger. |
| Async retry | Ya | Job executor retries/incidents. |
| Process version | Ya | Process definition version/deployment. |
| Process technical history | Ya | `ACT_HI_*`. |
| Message/event wait subscription | Ya | Event subscription. |
| External work dispatch | Ya | External task. |

### 3.2 Domain Layer Bertanggung Jawab Untuk

Domain layer harus menjadi owner untuk:

| Concern | Di Domain? | Catatan |
|---|---:|---|
| Case aggregate | Ya | Case id, status, attributes. |
| Legal/business decision | Ya | Decision, reason, authority, reviewer. |
| Evidence/document metadata | Ya | Document ids, hashes, classification. |
| Four-eyes rule | Ya | Tidak cukup hanya di task assignment. |
| Jurisdiction/agency policy | Ya | Tenant/agency-specific rule. |
| Business audit ledger | Ya | Defensible audit. |
| Idempotency record | Ya | For commands/events. |
| Reporting/search projection | Ya | Jangan query history Camunda untuk semua report. |
| Security data classification | Ya | PII/sensitive/evidence boundary. |

### 3.3 Integration Layer Bertanggung Jawab Untuk

Integration layer harus menjadi owner untuk:

| Concern | Di Integration? | Catatan |
|---|---:|---|
| External API call | Ya | HTTP/SOAP/SFTP/Kafka/JMS/email. |
| Retry with remote semantics | Ya | Engine retry tidak cukup untuk semua remote failure. |
| Idempotency key propagation | Ya | Agar retry tidak duplicate side effect. |
| Outbox publish | Ya | Reliable after commit. |
| Inbox deduplication | Ya | Early/duplicate inbound event. |
| Adapter contract | Ya | Versioned payload. |

---

## 4. Core Domain Model

Kita mulai dari domain yang eksplisit.

### 4.1 Case Aggregate

```text
Case
- caseId
- caseNo
- tenantId / agencyId
- caseType
- caseStatus
- priority
- subjectId
- createdBy
- createdAt
- updatedAt
- currentStage
- assignedUnit
- sensitivityLevel
- slaProfileId
- version
```

`caseStatus` bukan copy mentah dari Camunda activity id. Ia adalah **business lifecycle status**.

Contoh:

```text
DRAFT
SUBMITTED
SCREENING
UNDER_REVIEW
PENDING_INFORMATION
PENDING_SUPERVISOR_APPROVAL
APPROVED
REJECTED
APPEALED
ENFORCEMENT_ACTION_PENDING
CLOSED
WITHDRAWN
CANCELLED
SUSPENDED
```

### 4.2 Process Instance Binding

```text
CaseWorkflowBinding
- caseId
- processInstanceId
- processDefinitionKey
- processDefinitionVersion
- processDefinitionId
- businessKey
- tenantId
- startedAt
- endedAt
- status
```

Kenapa binding table perlu?

Karena UI/domain tidak boleh bergantung pada pencarian ad-hoc ke `ACT_*` table setiap kali perlu tahu process instance.

### 4.3 Decision Record

```text
DecisionRecord
- decisionId
- caseId
- decisionType
- decisionCode
- reasonCode
- reasonText
- decidedBy
- decidedByRole
- decidedAt
- legalAuthority
- inputSnapshotJson
- outputSnapshotJson
- dmnDecisionKey
- dmnDecisionVersion
- processInstanceId
- taskId
- correlationId
```

Decision record adalah bagian dari business/legal audit, bukan hanya Camunda variable.

### 4.4 Evidence Metadata

```text
Evidence
- evidenceId
- caseId
- documentId
- documentType
- source
- receivedAt
- uploadedBy
- classification
- hash
- retentionPolicyId
- accessPolicyId
```

File binary sebaiknya tidak disimpan sebagai Camunda variable. Simpan di object/document store, lalu simpan reference id + hash + classification.

### 4.5 Audit Ledger

```text
AuditEvent
- auditId
- caseId
- eventType
- actorId
- actorRole
- actorTenant
- occurredAt
- sourceSystem
- correlationId
- commandId
- beforeState
- afterState
- reason
- evidenceRefs
- processInstanceId
- activityId
- taskId
- immutablePayloadHash
```

Camunda history membantu, tetapi ledger domain ini yang menjawab:

- siapa mengambil keputusan,
- dengan authority apa,
- berdasarkan evidence apa,
- state berubah dari apa ke apa,
- apakah four-eyes rule dipatuhi,
- apakah action dilakukan dalam SLA,
- apakah override manual legitimate.

---

## 5. Process Model Utama

Misal kita desain process:

`regulatory-case-lifecycle`

High-level BPMN:

```text
Start: Case Submitted
  |
  v
Validate Submission
  |
  v
Screening
  |
  +--> Invalid / Need Info --> Request More Info --> Wait Applicant Response --> Screening
  |
  v
Assign Reviewer
  |
  v
Review Case (User Task)
  |
  +--> Need Clarification --> Request Clarification --> Wait Clarification --> Review Case
  |
  +--> Recommend Reject --> Supervisor Approval
  |
  +--> Recommend Approve --> Supervisor Approval
  |
  v
Supervisor Approval (User Task)
  |
  +--> Return for Rework --> Review Case
  |
  +--> Approve Decision --> Issue Outcome
  |
  +--> Reject Decision --> Issue Outcome
  |
  v
Notify Parties
  |
  v
Appeal Window Timer / Wait Appeal
  |
  +--> Appeal Received --> Appeal Subprocess
  |
  +--> Timer Expired --> Close Case
  |
  v
End
```

Namun model produksi harus memisahkan beberapa hal.

### 5.1 Jangan Buat Satu BPMN Raksasa

Anti-pattern:

```text
One BPMN to rule them all:
- application submission
- review
- payment
- document generation
- email
- appeal
- enforcement
- inspection
- renewal
- revocation
- reporting
- archival
```

Hasilnya:

- sulit dimigrasikan,
- sulit dites,
- sulit dibaca,
- incident recovery sulit,
- boundary tidak jelas,
- versioning kacau,
- tenant variation berantakan.

Pola lebih sehat:

```text
regulatory-case-master
  -> screening-subprocess
  -> review-subprocess
  -> decision-approval-subprocess
  -> notification-subprocess
  -> appeal-subprocess
  -> enforcement-action-subprocess
  -> closure-subprocess
```

Gunakan call activity secara sadar dengan binding strategy.

### 5.2 Business Milestone vs Technical Activity

BPMN utama harus menunjukkan milestone bisnis:

- Submitted,
- Screening,
- Under Review,
- Pending Approval,
- Outcome Issued,
- Appeal Window,
- Closed.

Detail teknis seperti:

- call email API,
- upload PDF,
- update search index,
- publish Kafka event,
- generate notification template,

sebaiknya berada di:

- external task,
- outbox handler,
- integration worker,
- subprocess teknis yang terisolasi,
- atau domain service di luar BPMN utama.

---

## 6. Process Definition Key, Business Key, dan Correlation Design

### 6.1 Naming

```text
Process definition key:
regulatory-case-lifecycle

Business key:
CASE-2026-000001

Tenant id:
agency-a
```

### 6.2 Correlation Identifiers

Gunakan beberapa identifier dengan fungsi berbeda:

| Identifier | Fungsi |
|---|---|
| `caseId` | Primary domain id internal. |
| `caseNo` | Human-readable case number. |
| `businessKey` | Camunda-level process correlation anchor. |
| `processInstanceId` | Engine runtime id. |
| `taskId` | Camunda task id. |
| `commandId` | Idempotency command id. |
| `correlationId` | Trace/log/event correlation. |
| `eventId` | Inbound event deduplication. |

Jangan hanya bergantung pada `processInstanceId` di domain/UI. `processInstanceId` adalah engine id; domain harus punya identity sendiri.

---

## 7. Variable Strategy untuk Platform Regulatory

### 7.1 Prinsip

Camunda variables harus:

- kecil,
- eksplisit,
- stabil,
- version-tolerant,
- tidak berisi sensitive data besar,
- tidak menjadi dumping ground,
- cukup untuk routing dan correlation,
- bukan pengganti domain DB.

### 7.2 Recommended Variable Set

```text
caseId: String
caseNo: String
tenantId: String
caseType: String
priority: String
slaProfileId: String
reviewOutcome: String
supervisorDecision: String
appealReceived: Boolean
currentDomainStatus: String
correlationId: String
```

### 7.3 Avoid

Hindari:

```text
applicantFullProfile: serialized Java object
allDocuments: List<File>
fullCaseJson: huge JSON
entireDomainAggregate: serialized object
rawApiResponse: long string
secretToken: string
largePdfBytes: bytes variable
```

### 7.4 Snapshot Pattern

Jika perlu snapshot untuk audit:

- simpan snapshot di domain audit table/object store,
- simpan `snapshotId` di Camunda variable.

```text
caseSnapshotId = SNAP-2026-000991
reviewDecisionId = DEC-2026-000333
evidenceBundleId = EVD-BUNDLE-2026-000111
```

---

## 8. Transaction Boundary Design

Dalam platform regulatory, transaction boundary menentukan:

- kapan process state durable,
- kapan user action dianggap sukses,
- kapan external side effect boleh terjadi,
- kapan retry aman,
- kapan incident dibuat.

### 8.1 Submit Case

Command:

```text
POST /cases/{caseId}/submit
```

Flow ideal:

```text
1. Validate user permission.
2. Validate domain state = DRAFT.
3. Write domain state: SUBMITTED.
4. Write domain audit event: CASE_SUBMITTED.
5. Start Camunda process with businessKey = caseNo.
6. Store process binding.
7. Commit.
8. Outbox publishes CaseSubmitted event.
```

Jika domain DB dan Camunda DB berada di transaksi yang sama, langkah 3–6 bisa satu local transaction. Jika tidak, gunakan outbox/compensating reconciliation.

### 8.2 Complete Review Task

Command:

```text
POST /cases/{caseId}/review-tasks/{taskId}/complete
```

Flow ideal:

```text
1. Validate authenticated officer.
2. Validate task belongs to case.
3. Validate assignment/candidate group.
4. Validate business authorization.
5. Validate four-eyes constraints where relevant.
6. Validate domain state = UNDER_REVIEW.
7. Persist DecisionRecord.
8. Persist AuditEvent.
9. Update domain state = PENDING_SUPERVISOR_APPROVAL.
10. Complete Camunda user task with small variables.
11. Commit.
```

Masalah penting:

Jika task completion melanjutkan synchronous path lalu downstream delegate gagal, completion dapat rollback sehingga task terlihat belum selesai. Untuk mengurangi failure scope, tambahkan `asyncAfter` pada user task jika downstream processing berat/berisiko.

```text
User Task: Review Case
  camunda:asyncAfter="true"
```

Dengan ini:

- complete task commit dulu,
- continuation berikutnya menjadi job,
- jika downstream gagal, incident ada di job, bukan membuat user task muncul kembali.

---

## 9. Human Task Routing Design

### 9.1 Assignment Bukan Authorization

Candidate group:

```text
agency-a-reviewer
agency-a-supervisor
agency-a-appeal-officer
```

Ini membantu task queue, tetapi tidak cukup untuk:

- tenant isolation,
- jurisdiction,
- conflict of interest,
- four-eyes rule,
- sensitivity clearance,
- temporary delegation,
- emergency override,
- legal authority.

### 9.2 Domain API Harus Validasi

Sebelum `taskService.complete(taskId, variables)`:

```text
assertTaskBelongsToCase(taskId, caseId)
assertTenantAccess(user, tenantId)
assertCanActOnCase(user, caseId, action)
assertTaskIsActive(taskId)
assertDomainStateAllows(case.status, action)
assertNotSameUserForFourEyes(previousActor, currentActor)
assertEvidenceReady(caseId)
assertDecisionReasonProvided(action)
```

### 9.3 Work Queue Projection

Jangan bergantung pada query raw `TaskService` untuk semua UI dashboard.

Buat projection:

```text
WorkItemProjection
- workItemId
- caseId
- caseNo
- taskId
- taskDefinitionKey
- taskName
- tenantId
- candidateGroups
- assignee
- priority
- dueDate
- followUpDate
- slaStatus
- caseType
- subjectSummary
- sensitivityLevel
- createdAt
- updatedAt
```

Projection bisa di-update dari:

- domain action,
- Camunda task listener,
- periodic reconciliation,
- history/event export.

Namun listener tidak boleh menjadi satu-satunya sumber critical domain state.

---

## 10. SLA and Escalation Design

### 10.1 SLA Sebagai Policy, Timer Sebagai Trigger

SLA bukan cuma `PT72H` di BPMN.

SLA harus punya policy:

```text
SlaPolicy
- slaProfileId
- caseType
- tenantId
- stage
- duration
- businessCalendar
- pauseRules
- warningThreshold
- breachThreshold
- escalationRoute
- retentionImpact
```

BPMN timer hanya trigger:

```text
Review Case User Task
  boundary timer: reviewWarningDue
  boundary timer: reviewBreachDue
```

### 10.2 Warning vs Breach

```text
Review Case
  |\
  | \-- non-interrupting timer: SLA Warning -> Notify Supervisor
  |
  \-- non-interrupting timer: SLA Breach -> Escalate Queue / Audit Breach
```

Gunakan non-interrupting timer jika task tetap harus dikerjakan.

Gunakan interrupting timer hanya jika task harus dibatalkan/dialihkan.

### 10.3 SLA Pause

Contoh:

- applicant diminta klarifikasi,
- external agency response pending,
- legal hold,
- system outage officially recognized.

Jangan mengandalkan timer statis untuk semua pause/resume. Biasanya lebih sehat:

- hitung deadline di domain SLA service,
- simpan due date pada task/domain projection,
- reschedule timer job jika perlu,
- audit setiap perubahan SLA.

---

## 11. Integration Design

### 11.1 Pattern Selection

| Scenario | Recommended Pattern |
|---|---|
| Generate document PDF | External task / outbox worker |
| Send email/SMS | Outbox worker |
| Call slow external agency API | External task |
| Wait for external response | Message catch + inbox |
| Publish case status change | Domain outbox |
| Update search index | Outbox projection worker |
| Simple deterministic local calculation | JavaDelegate/domain service |
| Business rule decision | DMN/domain policy service |

### 11.2 Outbound Command

Example: notify applicant.

```text
Camunda reaches activity: Prepare Notification
  -> JavaDelegate writes NotificationRequested to outbox
  -> asyncAfter boundary commits
  -> outbox worker sends email
  -> worker writes NotificationSent audit/event
```

Better:

- Camunda does not directly send email in same transaction.
- Email worker uses idempotency key.
- Duplicate job retry does not duplicate email.

### 11.3 Inbound Event

Example: applicant submits clarification.

```text
POST /external/applicant-response
  -> authenticate source
  -> validate payload
  -> store event in inbox with eventId
  -> deduplicate
  -> update domain evidence/response
  -> correlate Camunda message if subscription exists
  -> if subscription not ready, keep pending inbox event and reconcile
```

This solves:

- duplicate event,
- early event,
- retry from external system,
- message correlation ambiguity.

---

## 12. Error Taxonomy for Capstone Platform

Use explicit taxonomy:

| Error Type | Example | Engine Handling |
|---|---|---|
| Validation error | Missing reason code | Reject API command before Camunda. |
| Business alternative | Applicant not eligible | BPMN Error / gateway from decision. |
| Recoverable technical failure | Email API timeout | Retry job/external task. |
| Non-recoverable technical failure | Invalid config | Incident. |
| External duplicate | Same event twice | Inbox dedupe. |
| Security violation | Unauthorized completion | Reject API command + security audit. |
| Operational override | Supervisor manually reroutes | Domain audit + process modification/task reassignment. |
| Compensation need | Notice issued wrongly | Compensation subprocess/domain corrective action. |

Important:

> Jangan semua hal dijadikan BPMN Error. Jangan semua hal dijadikan Java exception.

---

## 13. Incident and Recovery Model

### 13.1 Incident Queue

Build operator view:

```text
IncidentProjection
- incidentId
- processInstanceId
- caseId
- caseNo
- tenantId
- activityId
- failedActivity
- incidentType
- errorMessage
- retries
- createdAt
- priority
- ownerTeam
- suggestedAction
```

### 13.2 Recovery Actions

Allowed recovery actions:

| Action | Use Case |
|---|---|
| Retry job | Temporary failure fixed. |
| Set retries | Technical job failed and needs resume. |
| Update variable | Bad routing variable; controlled correction. |
| Correlate missing message | Event arrived but not correlated. |
| Complete/cancel task | Exceptional operational fix. |
| Process instance modification | Controlled path correction. |
| Terminate process | Irrecoverable/cancelled case. |
| Start compensation | Business reversal. |

Every recovery action must have:

- reason,
- actor,
- approval if needed,
- before/after snapshot,
- audit event,
- runbook reference,
- correlation id.

### 13.3 Manual DB Update Policy

Rule:

> Do not mutate `ACT_*` tables manually except emergency-only with vendor/support-approved runbook.

Engine API first:

- `ManagementService` for jobs,
- `RuntimeService` for variables/message/modification,
- `TaskService` for tasks,
- `RepositoryService` for deployment,
- `HistoryService` for history queries.

---

## 14. Audit Defensibility Architecture

### 14.1 Three Audit Layers

```text
1. Camunda technical history
   - activity started/ended
   - task created/completed
   - variables changed
   - incidents
   - job logs

2. Domain business audit
   - decision made
   - reason recorded
   - evidence considered
   - actor role
   - legal authority
   - state transition

3. Platform/security audit
   - login
   - permission check
   - admin operation
   - data access
   - export/download
   - override
```

You need all three.

### 14.2 Audit Timeline Composition

Case UI should show timeline from multiple sources:

```text
Case created
Submission received
Screening started
Officer A requested clarification
Applicant uploaded document
Officer B reviewed evidence
Supervisor C approved recommendation
Outcome notice generated
Notification sent
Appeal window opened
Case closed
```

Do not show raw Camunda activity ids to business users. Map technical events to domain language.

### 14.3 Immutable Audit Payload

For critical decisions:

```text
decisionPayloadHash = SHA-256(canonicalJson(decisionRecord))
evidenceBundleHash = SHA-256(canonicalList(evidenceRefs + hashes))
```

Store hash with audit record. This supports tamper detection and defensibility.

---

## 15. Security Model

### 15.1 Layered Security

```text
Authentication
  -> Identity Provider / SSO

Coarse application authorization
  -> role / group / tenant

Domain authorization
  -> can this user do this action on this case now?

Camunda authorization
  -> restrict engine API/admin/webapp access

Data authorization
  -> evidence classification / PII masking

Operational authorization
  -> retry job / modify process / migrate instance
```

### 15.2 Frontend Must Not Own Workflow Authorization

Bad:

```text
Frontend hides Complete button if user not allowed.
```

Good:

```text
Backend validates all permission/invariant before completing task.
```

### 15.3 Raw Camunda REST Exposure

Avoid:

```text
Browser -> /engine-rest/task/{id}/complete
Browser -> /engine-rest/message
Browser -> /engine-rest/process-definition/key/x/start
```

Prefer:

```text
Browser -> /api/cases/{caseId}/actions/complete-review
Browser -> /api/cases/{caseId}/actions/submit-appeal
Browser -> /api/cases/{caseId}/actions/request-clarification
```

Domain API maps to Camunda after enforcing rules.

### 15.4 Sensitive Variables

Do not store:

- access tokens,
- secret keys,
- full PII profile,
- raw identity assertion,
- full document bytes,
- confidential evidence content,
- large external API payloads.

Store references and snapshots in controlled stores.

---

## 16. Performance and Scalability Model

### 16.1 Performance Boundaries

Camunda 7 scales through:

- multiple engine nodes,
- shared database,
- job executor threads,
- external worker fleet,
- careful modelling,
- controlled history volume,
- efficient queries.

But the database remains a central coordination point.

### 16.2 Avoid High-Churn Micro-Activities

Bad:

```text
Validate field A
Validate field B
Validate field C
Call tiny service X
Call tiny service Y
Write audit row
Update projection
Send small event
```

as separate BPMN service tasks with history full.

Better:

- keep domain validation in application service,
- model meaningful workflow milestones,
- write audit/projection through domain/outbox.

### 16.3 Query Strategy

Do not use Camunda history as main report DB.

Use:

- operational Camunda API for process operations,
- domain projection for case dashboard,
- search index for search,
- warehouse/lake for analytics,
- audit ledger for legal timeline.

---

## 17. Database Operations

### 17.1 Data Classes

| Data | Store | Retention |
|---|---|---|
| Runtime process state | Camunda `ACT_RU_*` | Until process ends. |
| Process technical history | Camunda `ACT_HI_*` | Per process TTL. |
| BPMN/DMN deployment | Camunda `ACT_RE_*`/`ACT_GE_BYTEARRAY` | Release governance. |
| Case facts | Domain DB | Legal/business retention. |
| Evidence | Document/object store | Evidence retention. |
| Audit ledger | Domain audit store | Legal retention. |
| Search projection | Search DB | Rebuildable. |
| Analytics | Warehouse/lake | Analytics policy. |

### 17.2 Cleanup Strategy

Camunda cleanup:

- set process definition TTL,
- configure removal time strategy,
- set cleanup window,
- size cleanup batch,
- monitor cleanup duration,
- avoid cleanup competing with peak workload,
- separate operational DB from reporting use cases.

Domain cleanup:

- apply legal retention,
- archive closed cases,
- anonymize where policy allows,
- preserve audit/evidence hashes,
- keep chain of custody.

---

## 18. Observability Design

### 18.1 Correlation ID Everywhere

Propagate:

```text
X-Correlation-Id
commandId
eventId
caseId
businessKey
processInstanceId
taskId
jobId
externalTaskId
```

### 18.2 Metrics

Workflow metrics:

- started cases,
- completed cases,
- active cases by stage,
- task aging,
- SLA warning count,
- SLA breach count,
- incidents by type,
- retries exhausted,
- message correlation failures,
- external task backlog,
- job backlog,
- history cleanup duration.

Platform metrics:

- DB CPU/IO/locks,
- connection pool usage,
- job acquisition latency,
- worker latency,
- API latency,
- queue/outbox lag,
- error rate,
- GC pause,
- thread pool saturation.

### 18.3 Logs

Every critical action log should include:

```text
correlationId
caseId
caseNo
tenantId
userId
action
processInstanceId
taskId
activityId
commandId
outcome
latencyMs
```

No PII/secrets in logs.

---

## 19. Testing Strategy for Capstone Platform

### 19.1 Test Matrix

| Test Type | Purpose |
|---|---|
| Domain unit test | Validate business invariants without Camunda. |
| Delegate test | Ensure adapter maps variables/domain calls correctly. |
| BPMN scenario test | Validate process paths. |
| User task test | Complete/claim/assignment/state checks. |
| Async job test | Retry/incident/failure scope. |
| Timer test | SLA warning/breach paths. |
| Message test | Correlation, early/duplicate/ambiguous events. |
| External task contract test | Topic, variables, idempotency. |
| Migration test | Old instances continue or migrate safely. |
| Authorization test | Users cannot perform invalid actions. |
| Audit test | Decision/evidence/timeline complete. |
| DB integration test | Real database behavior. |
| Load test | Throughput, latency, backlog, cleanup. |
| Chaos test | Worker crash, DB failover, duplicate events. |

### 19.2 Golden Scenario Set

Minimum golden scenarios:

1. happy path approval,
2. rejection path,
3. request clarification and response,
4. supervisor return for rework,
5. SLA warning,
6. SLA breach,
7. appeal received,
8. appeal rejected,
9. appeal approved,
10. external notification failure and retry,
11. duplicate inbound event,
12. officer tries unauthorized action,
13. four-eyes violation blocked,
14. migration from v1 to v2,
15. incident recovery.

---

## 20. Deployment Topology Recommendation

For many regulatory enterprise platforms, a good default is:

```text
Modular monolith / bounded service
- Domain API
- Camunda embedded engine
- Same transactional database boundary where appropriate
- Separate schema for Camunda and domain
- External workers for remote/slow/side-effect integrations
- Outbox/inbox for reliable messaging
- Projection service for inbox/search/reporting
```

Why?

- simpler transaction boundary,
- easier domain invariant enforcement,
- fewer distributed failure modes,
- clear local workflow ownership,
- enough modularity through package/module boundaries,
- external task workers still allow scaling integrations independently.

Remote engine may be better if:

- multiple domains share one process platform,
- platform team centrally operates Camunda,
- strict separation is required,
- teams are polyglot,
- workflow engine must be independently upgraded.

But remote engine increases:

- idempotency burden,
- outbox/inbox need,
- eventual consistency,
- API governance complexity,
- security surface.

---

## 21. Migration Readiness Built Into Design

Since Camunda 7 has a known lifecycle horizon and Camunda 8 is not a drop-in replacement, design Camunda 7 platform with exit strategy from day one.

### 21.1 Avoid Camunda 7 Lock-In Where Possible

Avoid:

- domain logic inside JavaDelegate,
- huge serialized Java object variables,
- excessive listener-driven hidden logic,
- direct UI dependency on Camunda REST,
- reports directly on Camunda history,
- process model as only source of business state,
- custom engine internals unless absolutely necessary.

Prefer:

- domain service boundary,
- workflow facade,
- external task-like integration boundary,
- small versioned variables,
- domain audit ledger,
- projection/read model,
- explicit process contract tests.

### 21.2 Coexistence-Ready Architecture

If later Camunda 8 or another engine is introduced:

```text
UI -> Domain API / Workflow Facade -> Engine Adapter
                                  -> Camunda 7 Adapter
                                  -> Camunda 8 Adapter
```

Domain actions remain stable:

```text
submitCase()
completeReview()
requestClarification()
approveDecision()
receiveAppeal()
closeCase()
```

Only engine adapter changes.

---

## 22. Example End-to-End Flow

### 22.1 Case Submission

```text
User submits application
  -> Domain API validates
  -> Case status DRAFT -> SUBMITTED
  -> Audit CASE_SUBMITTED
  -> Start Camunda process
  -> Binding stored
  -> Outbox CaseSubmitted
  -> Projection updated
```

### 22.2 Screening

```text
Camunda enters Screening Service Task
  -> asyncBefore for safe point
  -> Delegate calls domain ScreeningService
  -> DMN/domain policy evaluates basic eligibility
  -> stores screening result in domain DB
  -> sets small routing variable screeningOutcome
  -> BPMN gateway routes
```

### 22.3 Request Clarification

```text
Officer completes task: Need clarification
  -> Domain validates permission
  -> DecisionRecord created
  -> Case status PENDING_INFORMATION
  -> Camunda task completed
  -> NotificationRequested outbox
  -> Camunda waits at message catch ApplicantClarificationReceived
```

### 22.4 Applicant Response

```text
External portal receives clarification
  -> Inbox stores eventId
  -> Evidence stored
  -> Domain status updated
  -> Correlate message to Camunda by caseId/businessKey
  -> Process resumes
```

### 22.5 Supervisor Approval

```text
Supervisor opens task
  -> API validates not same as reviewer
  -> validates authority
  -> records decision
  -> completes Camunda task
  -> asyncAfter creates safe point
  -> Issue Outcome job executes
```

### 22.6 Notification Failure

```text
Notification worker fails due to email gateway timeout
  -> external task failure / outbox retry
  -> retry later
  -> if exhausted, IncidentProjection shows case impact
  -> operator retries after gateway restored
```

### 22.7 Closure

```text
Appeal timer expires
  -> Camunda moves to Close Case
  -> Domain status CLOSED
  -> Audit CASE_CLOSED
  -> retention/removal time policy applied
  -> Projection updated
```

---

## 23. Production Checklist

### 23.1 Modelling Checklist

- [ ] BPMN shows business milestones, not low-level integration script.
- [ ] Each wait state is intentional.
- [ ] Async boundary is placed before/after risky operations.
- [ ] Timers reflect SLA trigger, not whole SLA policy.
- [ ] Message correlation keys are unique enough.
- [ ] Business errors and technical errors are separated.
- [ ] Compensation is explicit business action.
- [ ] Long-running version compatibility is considered.

### 23.2 Domain Checklist

- [ ] Domain state is not only Camunda activity id.
- [ ] Case aggregate has optimistic locking/version.
- [ ] Decision records are persisted outside Camunda variables.
- [ ] Evidence metadata and hashes are stored.
- [ ] Business audit ledger is immutable or append-only.
- [ ] Four-eyes rule enforced in domain/API.
- [ ] Tenant/jurisdiction policy enforced in domain/API.

### 23.3 Integration Checklist

- [ ] Outbox used for outbound side effects.
- [ ] Inbox used for inbound events.
- [ ] Idempotency key propagated.
- [ ] External tasks have bounded lock duration and retry policy.
- [ ] Duplicate event behavior tested.
- [ ] Early message behavior handled.

### 23.4 Security Checklist

- [ ] Raw Camunda REST not exposed publicly.
- [ ] Domain API validates task ownership and business authorization.
- [ ] Camunda webapps restricted to operators/admins.
- [ ] Variables do not contain secrets or large PII payload.
- [ ] Admin operations audited.
- [ ] Data classification policy applied to evidence/documents.

### 23.5 Operations Checklist

- [ ] Job executor metrics monitored.
- [ ] External task backlog monitored.
- [ ] Incident queue exists.
- [ ] Runbooks exist for retry, incident, stuck process, missing message.
- [ ] History cleanup configured.
- [ ] DB growth monitored.
- [ ] Backup/restore tested.
- [ ] Upgrade rehearsal environment exists.

### 23.6 Testing Checklist

- [ ] Domain tests independent from Camunda.
- [ ] BPMN scenario tests cover major paths.
- [ ] Async/retry/incident tests exist.
- [ ] Timer tests exist.
- [ ] Migration tests exist.
- [ ] Real DB integration tests exist.
- [ ] Authorization tests exist.
- [ ] Audit completeness tests exist.

---

## 24. Architecture Decision Records to Produce

For a real platform, produce ADRs:

1. Why Camunda 7 is used and what boundary it owns.
2. Embedded vs remote engine decision.
3. Domain DB vs Camunda DB separation.
4. Variable storage policy.
5. Human task completion policy.
6. SLA/timer modelling policy.
7. Outbox/inbox integration policy.
8. Audit ledger policy.
9. Authorization layering policy.
10. History cleanup and retention policy.
11. Process versioning/migration policy.
12. External task worker standard.
13. REST API exposure policy.
14. Incident recovery policy.
15. Camunda 7 to future platform migration readiness policy.

---

## 25. Common Failure Scenarios and How This Architecture Handles Them

### 25.1 User Completes Task, Then Downstream Fails

Mitigation:

- `asyncAfter` on user task,
- commit task completion first,
- retry downstream job,
- incident if retries exhausted.

### 25.2 External Event Arrives Before Process Waits

Mitigation:

- inbound inbox,
- deduplication,
- pending event reconciliation,
- correlation only when subscription is ready.

### 25.3 Duplicate Email Sent After Retry

Mitigation:

- outbox idempotency key,
- remote provider idempotency if available,
- notification table with sent status,
- Camunda variable stores notification request id only.

### 25.4 Officer Bypasses Four-Eyes Rule

Mitigation:

- backend domain authorization,
- previous actor check,
- task completion blocked,
- security audit event.

### 25.5 History Table Grows Too Large

Mitigation:

- TTL/removal time,
- cleanup window,
- batch tuning,
- archive strategy,
- projection/reporting outside Camunda DB,
- avoid large variable history.

### 25.6 Migration Breaks Long-Running Instances

Mitigation:

- stable BPMN ids,
- expand-migrate-contract,
- old and new delegates support,
- migration rehearsal,
- process instance inventory,
- drain strategy for low-risk flows.

---

## 26. What “Top 1%” Looks Like in Camunda 7 Engineering

A top-tier engineer does not merely know how to draw BPMN and write `JavaDelegate`.

They understand:

1. **Engine semantics**  
   Wait state, transaction boundary, command context, job executor, optimistic locking.

2. **Domain correctness**  
   Invariants, allowed transitions, state machine semantics, four-eyes rule, auditability.

3. **Failure reality**  
   At-least-once execution, duplicate side effects, retry storm, incident recovery, early message.

4. **Data strategy**  
   Variable policy, domain DB, audit ledger, history cleanup, reporting projection.

5. **Security boundary**  
   Camunda authorization vs business authorization, raw REST exposure risk, sensitive variables.

6. **Operational maturity**  
   Metrics, logs, SQL diagnostics, Cockpit, runbooks, cleanup, backup/restore.

7. **Evolution strategy**  
   Versioning, migration, compatibility, Camunda 7 lifecycle, Camunda 8 migration readiness.

8. **Architectural humility**  
   Camunda is a powerful workflow engine, but not every problem belongs inside BPMN.

---

## 27. Final Reference Architecture Summary

The final recommended shape:

```text
[Frontend]
  -> [Domain API / Workflow Facade]
      -> validates auth, tenant, invariant, assignment, four-eyes
      -> writes domain state/audit
      -> calls Camunda API internally
      -> writes outbox/inbox

[Camunda 7 Engine]
  -> durable process state
  -> user tasks
  -> timers
  -> async jobs
  -> external tasks
  -> process history

[Domain DB]
  -> case aggregate
  -> decision records
  -> evidence metadata
  -> audit ledger
  -> workflow binding

[Workers]
  -> external task workers
  -> outbox publishers
  -> inbox correlators
  -> projection builders

[Operations]
  -> Cockpit/admin restricted
  -> incident dashboard
  -> metrics/logs/traces
  -> DB cleanup/retention
  -> migration/upgrade runbooks
```

One sentence summary:

> Use Camunda 7 to coordinate long-running workflow state, but keep business truth, audit defensibility, security policy, integration reliability, and reporting ownership in explicit platform layers around it.

---

## 28. Closing: Seri Selesai

Ini adalah bagian terakhir dari seri:

`learn-java-camunda-7-bpm-platform-engineering`

Total bagian:

```text
part-000 sampai part-035
```

Dengan menyelesaikan seri ini, kamu sudah memiliki peta mental untuk memahami Camunda 7 bukan sebagai “BPMN library”, tetapi sebagai:

- database-backed durable state machine engine,
- transaction boundary manager,
- job/timer scheduler,
- human workflow coordinator,
- integration orchestration boundary,
- audit/operation surface,
- legacy enterprise platform yang perlu dioperasikan dan dimigrasikan dengan hati-hati.

Jika ingin melanjutkan setelah seri ini, jalur paling natural adalah:

1. **Camunda 7 Production Lab** — hands-on project lengkap dari nol sampai deployment.
2. **Camunda 7 Performance and Operations Lab** — tuning, failure injection, SQL diagnostics, incident recovery.
3. **Camunda 7 to Camunda 8 Migration Lab** — coexistence, conversion, worker refactor, migration rehearsal.
4. **Regulatory Case Management Architecture** — domain-driven case lifecycle, audit defensibility, SLA, evidence, enforcement model.
5. **Workflow Engine Internals Comparative Study** — Camunda 7 vs Zeebe/Camunda 8 vs Temporal vs Conductor vs custom state machine.

---

## 29. References

- Camunda 7 documentation — Transactions in Processes: https://docs.camunda.org/manual/7.24/user-guide/process-engine/transactions-in-processes/
- Camunda 7 documentation — Job Executor: https://docs.camunda.org/manual/7.24/user-guide/process-engine/the-job-executor/
- Camunda 7 documentation — External Tasks: https://docs.camunda.org/manual/7.24/user-guide/process-engine/external-tasks/
- Camunda 7 documentation — History: https://docs.camunda.org/manual/7.24/user-guide/process-engine/history/
- Camunda 7 documentation — History Cleanup: https://docs.camunda.org/manual/7.24/user-guide/process-engine/history/history-cleanup/
- Camunda 7 documentation — Authorization Service: https://docs.camunda.org/manual/7.24/user-guide/process-engine/authorization-service/
- Camunda 7 documentation — Database Schema: https://docs.camunda.org/manual/7.24/user-guide/process-engine/database/database-schema/
- Camunda migration guide — Migrating from Camunda 7: https://docs.camunda.io/docs/guides/migrating-from-camunda-7/
- Camunda blog — Camunda 7 Enterprise EoL extension: https://camunda.com/blog/2025/02/camunda-7-enterprise-end-of-life-extension/

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-034.md">⬅️ Part 034 — Migration Strategy: Camunda 7 ke Camunda 8, Replatforming, Coexistence, dan Strangler Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<span></span>
</div>
