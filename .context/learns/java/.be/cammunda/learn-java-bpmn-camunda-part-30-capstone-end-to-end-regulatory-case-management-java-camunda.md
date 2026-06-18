# learn-java-bpmn-camunda-process-orchestration-engineering

# Part 30 — Capstone Architecture: End-to-End Regulatory Case Management with Java + Camunda

> Seri: **Java BPMN, Camunda, Process Orchestration Engineering**  
> Target: engineer yang mampu mendesain, membangun, mengoperasikan, memperbaiki, dan mempertanggungjawabkan workflow enterprise/regulatory di production.  
> Level: advanced / top 1% engineering orientation.  
> Java coverage: Java 8 sampai Java 25, dengan rekomendasi praktis untuk Java 17/21+ pada greenfield Camunda 8.

---

## 0. Tujuan Part Ini

Part ini adalah **capstone**. Semua konsep dari Part 0 sampai Part 29 digabungkan menjadi satu blueprint arsitektur nyata:

- BPMN sebagai executable process contract.
- Camunda sebagai orchestration runtime.
- Spring Boot sebagai application/runtime boundary.
- Java worker sebagai adapter deterministik ke domain/external system.
- Domain model sebagai source of truth.
- Process variable sebagai lightweight execution context.
- User task sebagai human-assisted wait state.
- DMN sebagai decision contract.
- Message correlation sebagai bridge ke event-driven world.
- Timer sebagai SLA/expiry/reminder mechanism.
- Outbox/inbox/idempotency sebagai reliability boundary.
- Audit trail sebagai regulatory defensibility layer.
- Observability/runbook sebagai production survival mechanism.
- Versioning/migration sebagai change management discipline.

Kita akan membangun mental model untuk sistem regulatory/case-management seperti:

- application licensing
- renewal
- appeal
- enforcement
- compliance monitoring
- document request
- multi-agency review
- payment
- inspection
- suspension/revocation
- legal notice
- case reopening
- case transfer
- manual correction

Bagian ini bukan hanya tutorial. Tujuannya adalah agar kamu bisa menjawab pertanyaan arsitektur seperti:

1. Apa boundary antara process engine dan domain service?
2. Data apa yang boleh masuk process variable?
3. Apakah status case harus disimpan di Camunda atau domain database?
4. Bagaimana user task diamankan?
5. Bagaimana menghindari duplicate side effect dari worker?
6. Bagaimana retry, incident, BPMN error, dan manual repair dipisahkan?
7. Bagaimana workflow bisa dipertanggungjawabkan secara audit dua tahun kemudian?
8. Bagaimana proses versi baru dirilis tanpa merusak running instance?
9. Bagaimana regulatory process tetap fleksibel tanpa menjadi spaghetti BPMN?
10. Bagaimana mengukur apakah sistem workflow sehat?

---

## 1. Problem Statement

Bayangkan kita membangun platform regulatory case management untuk agency pemerintah.

Sistem harus mendukung beberapa lifecycle:

```text
Applicant submits application
  -> System validates data
  -> Officer screens application
  -> Applicant may be asked to resubmit documents
  -> Application may require external agency clearance
  -> Payment may be required
  -> Supervisor approves or rejects
  -> License is issued
  -> Applicant may appeal rejection
  -> License may later be renewed, suspended, revoked, or investigated
```

Realitas production:

- proses bisa berjalan beberapa menit, hari, minggu, bulan, bahkan tahun
- banyak step dilakukan manusia
- ada SLA dan escalation
- external system bisa down
- applicant bisa submit data tidak lengkap
- officer bisa salah action
- rule eligibility bisa berubah
- process definition bisa berubah saat instance lama masih berjalan
- pembayaran bisa sukses tetapi callback terlambat
- email bisa terkirim tetapi worker crash sebelum complete job
- regulatory decision harus bisa dijelaskan kembali di masa depan
- tidak semua perubahan boleh “di-fix” diam-diam di database

Kalau sistem ini dibuat hanya dengan CRUD status field, biasanya akan muncul masalah:

```text
application.status = SUBMITTED / UNDER_REVIEW / PENDING_DOC / APPROVED / REJECTED
```

Awalnya tampak cukup. Namun lama-lama muncul field tambahan:

```text
status
sub_status
previous_status
next_action
assigned_team
assigned_user
sla_due_at
reminder_sent
escalation_level
payment_status
external_clearance_status
document_resubmission_round
appeal_status
reopen_reason
manual_override_flag
```

Kemudian business flow tersebar di banyak tempat:

- controller
- service method
- scheduled job
- listener Kafka/RabbitMQ
- stored procedure
- frontend button visibility
- email template condition
- database trigger
- manual SQL script

Pada titik ini, sistem bukan lagi sederhana. Ia hanya **menyembunyikan workflow** di kode dan database.

Camunda/BPMN berguna ketika kita ingin membuat long-running process menjadi explicit, observable, testable, and repairable.

Namun Camunda tidak boleh menjadi dumping ground. Engine harus menjadi **orchestrator**, bukan pemilik seluruh domain.

---

## 2. Big Architecture Picture

Blueprint high-level:

```text
+-----------------------------+
| Applicant / Officer UI      |
| Vue/React/Angular/etc       |
+--------------+--------------+
               |
               v
+-----------------------------+
| API Gateway / BFF           |
| AuthN/AuthZ, rate limit     |
+--------------+--------------+
               |
               v
+-----------------------------+       +------------------------------+
| Case Application Service    | <---> | Camunda 8 Orchestration      |
| Spring Boot / Java          |       | Zeebe / Operate / Tasklist    |
| Domain API, task API,       |       | Identity / Connectors         |
| process API                 |       +---------------+--------------+
+--------------+--------------+                       |
               |                                      |
               v                                      v
+-----------------------------+       +------------------------------+
| Domain Database             |       | Job Workers                  |
| Case, Application, Audit,   |       | Java Spring Boot workers      |
| Documents, Payment, etc     |       | serviceTask handlers          |
+--------------+--------------+       +---------------+--------------+
               |                                      |
               v                                      v
+-----------------------------+       +------------------------------+
| Outbox / Inbox / Dedup      |       | External Systems             |
| Reliable messaging boundary |       | Payment, Email, Agency, etc  |
+-----------------------------+       +------------------------------+
```

Core rule:

```text
Domain database owns business truth.
Camunda owns process execution state.
Workers translate process intent into domain/external side effects.
UI never trusts task visibility alone; authorization is enforced by application/domain policy.
Audit trail is separate from transient process variables.
```

This architecture intentionally avoids two extremes:

1. **Anemic BPMN**: BPMN only starts a service, all workflow hidden in Java.
2. **God BPMN**: BPMN contains every domain rule, all state, all integration, and all policy.

The correct balance:

```text
BPMN = process control flow, wait states, orchestration, escalation, compensation.
DMN = explicit decision logic that business/regulator may inspect.
Java domain service = invariants, persistence, authorization, side-effect control.
Workers = reliable adapters between process and domain/external systems.
Audit = durable explanation of facts and decisions.
```

---

## 3. Bounded Contexts

A serious regulatory platform should not be modeled as one giant “WorkflowService”.

Suggested bounded contexts:

```text
Identity & Access
  - users
  - roles
  - teams
  - delegation
  - acting-on-behalf
  - task permission

Application Management
  - application submission
  - application data
  - eligibility
  - status projection
  - applicant communication

Case Management
  - case file
  - case lifecycle
  - assignment
  - internal notes
  - case reopening
  - case transfer

Document Management
  - uploaded documents
  - document type
  - document validation
  - retention
  - redaction

Decision Management
  - officer recommendation
  - supervisor decision
  - DMN result
  - override reason
  - decision snapshot

SLA & Escalation
  - due date calculation
  - reminder
  - escalation level
  - business calendar

Payment
  - invoice
  - payment request
  - payment callback
  - reconciliation

Notification
  - email/SMS/letter
  - template snapshot
  - delivery tracking

Audit & Compliance
  - immutable audit event
  - process audit correlation
  - privileged operation
  - repair log

Integration
  - external agency clearance
  - identity provider
  - registry API
  - document signing
```

Camunda process models should align with these contexts, not collapse them.

---

## 4. Process Landscape

Do not start by drawing one giant BPMN.

Start with a **process landscape**:

```text
Application Submission Process
Application Review Process
Document Resubmission Process
External Clearance Process
Payment Collection Process
License Issuance Process
Appeal Process
Renewal Process
Compliance Monitoring Process
Enforcement Case Process
Suspension/Revocation Process
Notification Process
Manual Repair / Administrative Correction Process
```

A process landscape answers:

- What are the major process definitions?
- Which process starts another process?
- Which process is reusable?
- Which process owns SLA?
- Which process owns human task assignment?
- Which process owns external message correlation?
- Which process can be versioned independently?

Example relationship:

```text
ApplicationSubmissionProcess
  -> calls ApplicationScreeningProcess
  -> calls DocumentRequestProcess when documents incomplete
  -> calls ExternalAgencyClearanceProcess when required
  -> calls PaymentCollectionProcess when payable
  -> calls FinalApprovalProcess
  -> calls LicenseIssuanceProcess
  -> may start AppealProcess after rejection
```

Do not reuse subprocess just because diagrams look similar. Reuse when there is a stable contract.

---

## 5. Top-Level BPMN: Application Submission Process

A simplified top-level process:

```text
[Start: Application Submitted]
  -> [Create Application Case]
  -> [Validate Submission]
  -> <Submission Complete?>
      no  -> [Request Missing Documents]
             -> [Wait for Resubmission]
             -> [Validate Submission]
      yes -> [Screen Application]
  -> <External Clearance Required?>
      yes -> [Call External Clearance Process]
      no  -> continue
  -> <Payment Required?>
      yes -> [Call Payment Collection Process]
      no  -> continue
  -> [Officer Recommendation]
  -> [Supervisor Decision]
  -> <Approved?>
      yes -> [Issue License]
             -> [Notify Approval]
             -> [End: Approved]
      no  -> [Notify Rejection]
             -> [Wait Appeal Period]
             -> <Appeal Submitted?>
                  yes -> [Start/Call Appeal Process]
                  no  -> [End: Rejected]
```

Important modeling choices:

1. `Create Application Case` is a service task handled by Java worker.
2. `Validate Submission` may call domain service and DMN.
3. `Request Missing Documents` should create durable domain record and send notification.
4. `Wait for Resubmission` is a message catch event or user/application event, not polling.
5. `External Clearance Process` should usually be a call activity or separate process.
6. `Payment Collection Process` should be a separate process because payment has its own timeout, callback, reconciliation, and compensation behavior.
7. `Officer Recommendation` and `Supervisor Decision` are user tasks or application-managed tasks connected to Camunda user task lifecycle.
8. Approval/rejection decision should be snapshotted, not recalculated later without trace.

---

## 6. Domain State vs Process State vs Task State

This is one of the most important distinctions.

### 6.1 Domain state

Domain state is the business truth:

```text
Application:
  id
  applicationNo
  applicantId
  type
  status
  submittedAt
  currentCaseId
  decisionStatus
  licenseId

Case:
  id
  caseNo
  applicationId
  caseType
  status
  assignedTeam
  assignedOfficer
  openedAt
  closedAt

Decision:
  id
  caseId
  decisionType
  outcome
  reasonCode
  reasonText
  decidedBy
  decidedAt
  policyVersion
  dmnDecisionId
  dmnDecisionVersion
  inputSnapshotRef
  outputSnapshotRef
```

Domain state belongs in the application database.

### 6.2 Process state

Process state is where the process instance is currently waiting:

```text
processInstanceKey = 2251799813685249
processDefinitionId = application-submission
currentElement = Supervisor Decision
variables = {
  applicationId,
  caseId,
  applicantId,
  paymentRequired,
  externalClearanceRequired,
  decisionOutcome
}
```

Process state belongs to Camunda.

### 6.3 Task state

Task state describes human work:

```text
Task:
  taskId
  processInstanceKey
  elementId
  caseId
  assignee
  candidateGroups
  dueDate
  status
```

Task state may be in Camunda Tasklist and/or projected into your app for domain-specific UI. But completion must still respect domain authorization.

### 6.4 Projection state

Often you need query views:

```text
CaseInboxView:
  caseNo
  applicantName
  processStep
  assignedOfficer
  slaDueAt
  priority
  pendingExternalAgency
  pendingApplicantAction
```

This is a projection, not the source of truth. It can be rebuilt.

---

## 7. Data Model Blueprint

A practical schema split:

```text
application
case_file
document
case_assignment
case_decision
case_note
case_audit_event
sla_tracking
notification
payment_request
external_clearance_request
process_instance_link
outbox_event
inbox_event
idempotency_record
manual_repair_log
```

### 7.1 process_instance_link

```sql
CREATE TABLE process_instance_link (
  id BIGINT PRIMARY KEY,
  business_type VARCHAR(100) NOT NULL,
  business_id VARCHAR(100) NOT NULL,
  process_definition_id VARCHAR(255) NOT NULL,
  process_instance_key VARCHAR(100) NOT NULL,
  process_definition_version INT,
  started_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP NULL,
  status VARCHAR(50) NOT NULL,
  UNIQUE (business_type, business_id, process_definition_id),
  UNIQUE (process_instance_key)
);
```

Purpose:

- connect domain object to process instance
- support debugging
- support audit lookup
- support task inbox projection
- avoid searching Camunda by arbitrary business data repeatedly

### 7.2 idempotency_record

```sql
CREATE TABLE idempotency_record (
  id BIGINT PRIMARY KEY,
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  operation_name VARCHAR(255) NOT NULL,
  business_id VARCHAR(100) NOT NULL,
  request_hash VARCHAR(255),
  result_ref VARCHAR(255),
  status VARCHAR(50) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP NULL
);
```

Purpose:

- prevent duplicate side effects
- make worker retry safe
- support external API ambiguity resolution

### 7.3 outbox_event

```sql
CREATE TABLE outbox_event (
  id BIGINT PRIMARY KEY,
  aggregate_type VARCHAR(100) NOT NULL,
  aggregate_id VARCHAR(100) NOT NULL,
  event_type VARCHAR(255) NOT NULL,
  event_key VARCHAR(255) NOT NULL UNIQUE,
  payload_json CLOB NOT NULL,
  status VARCHAR(50) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  published_at TIMESTAMP NULL,
  retry_count INT DEFAULT 0
);
```

Purpose:

- reliably publish domain events after local transaction commit
- decouple domain write from message broker
- avoid Camunda worker doing direct multi-system transaction

### 7.4 inbox_event

```sql
CREATE TABLE inbox_event (
  id BIGINT PRIMARY KEY,
  source_system VARCHAR(100) NOT NULL,
  external_event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(255) NOT NULL,
  correlation_key VARCHAR(255) NOT NULL,
  payload_json CLOB NOT NULL,
  received_at TIMESTAMP NOT NULL,
  processed_at TIMESTAMP NULL,
  status VARCHAR(50) NOT NULL,
  UNIQUE (source_system, external_event_id)
);
```

Purpose:

- deduplicate inbound events/webhooks
- handle early/late/stale callbacks
- provide audit trail for correlation attempts

---

## 8. Process Variable Contract

For application submission, variable contract should be intentionally small:

```json
{
  "applicationId": "APP-2026-000123",
  "caseId": "CASE-2026-000456",
  "applicantId": "USR-10001",
  "applicationType": "LICENSE_NEW",
  "submissionComplete": true,
  "externalClearanceRequired": true,
  "paymentRequired": true,
  "paymentRequestId": "PAY-2026-000789",
  "decisionOutcome": "APPROVED",
  "decisionId": "DEC-2026-000111"
}
```

Avoid storing:

```json
{
  "fullApplicantProfile": {...},
  "allUploadedDocumentsBase64": "...",
  "completeOfficerNotes": "...",
  "fullPaymentGatewayResponse": {...},
  "sensitiveIdentityData": {...},
  "massiveAuditTrail": [...]
}
```

Rule:

```text
Process variables should route and coordinate.
Domain database should remember business facts.
Document store should store documents.
Audit store should store explanation.
External payload archive should store external payloads when legally required.
```

---

## 9. Java Application Architecture

Recommended package structure:

```text
com.example.regulatory
  application
    process
      start
      message
      task
      query
    casefile
    decision
    document
    payment
    notification
  domain
    application
    casefile
    decision
    sla
    payment
    audit
  infrastructure
    camunda
      client
      worker
      variables
      tasklist
      operate
    persistence
    messaging
    external
    security
    observability
  interfaces
    rest
    event
    scheduler
```

Alternative hexagonal view:

```text
Inbound adapters:
  - REST controller
  - Camunda job worker
  - message consumer
  - scheduled reconciliation
  - admin repair command

Application services:
  - StartApplicationProcessService
  - CompleteOfficerTaskService
  - PaymentCallbackService
  - ExternalClearanceResultService
  - ResolveIncidentSupportService

Domain services:
  - ApplicationEligibilityService
  - CaseAssignmentPolicy
  - DecisionPolicy
  - SlaCalculator
  - DocumentCompletenessPolicy

Outbound adapters:
  - Camunda client
  - database repository
  - email provider
  - payment gateway
  - external agency client
  - message broker
```

Golden rule:

```text
Camunda worker is an inbound adapter, not the domain service itself.
```

A bad worker:

```java
public void handle(JobClient client, ActivatedJob job) {
    // parses variables
    // validates authorization
    // updates many tables
    // sends email
    // calls payment gateway
    // writes audit
    // creates document
    // completes job
}
```

A better worker:

```java
public void handle(JobClient client, ActivatedJob job) {
    var command = mapper.toCommand(job);
    var result = useCase.execute(command);
    client.newCompleteCommand(job.getKey())
          .variables(mapper.toVariables(result))
          .send()
          .join();
}
```

Worker delegates the business behavior to an application service that can be tested independently.

---

## 10. Process Start Pattern

REST request:

```text
POST /applications
```

Sequence:

```text
Client
  -> Application API
  -> validate request
  -> create application row
  -> create audit event: APPLICATION_SUBMITTED
  -> create process_instance_link pending
  -> start Camunda process with business identifiers
  -> update process_instance_link with processInstanceKey
  -> return applicationNo
```

But beware: local DB transaction and Camunda start command are not one ACID transaction.

Safer pattern:

```text
Transaction 1:
  - create application
  - create outbox event APPLICATION_SUBMITTED

Outbox publisher:
  - publishes command/event to process starter

Process starter:
  - starts Camunda process idempotently
  - records process_instance_link
```

For many enterprise apps, synchronous start is acceptable if you have idempotency and reconciliation.

Production-grade compromise:

1. Generate `applicationId` before process start.
2. Use `applicationId` as business/correlation key.
3. Store `process_start_attempt` record.
4. If API succeeds in DB but fails to start Camunda, reconciliation job starts missing processes.
5. If Camunda process starts but DB update fails, reconciliation links orphan process instance using variables/business key.

---

## 11. Worker Pattern: Create Application Case

Service task:

```text
create-application-case
```

Variables input:

```json
{
  "applicationId": "APP-2026-000123"
}
```

Worker command:

```java
public record CreateApplicationCaseCommand(
    String applicationId,
    String processInstanceKey,
    String elementInstanceKey,
    String bpmnProcessId
) {}
```

Application service behavior:

```text
1. Build idempotency key:
   create-case:{applicationId}:{elementInstanceKey}

2. If idempotency record completed:
   return previous caseId

3. Load application.

4. If application already has caseId:
   return existing caseId.

5. Create case_file.

6. Create audit event:
   CASE_CREATED_BY_PROCESS

7. Complete idempotency record.

8. Return caseId.
```

Return variables:

```json
{
  "caseId": "CASE-2026-000456"
}
```

Important invariant:

```text
Duplicate execution of create-application-case must not create duplicate case files.
```

---

## 12. Worker Pattern: Validate Submission

Validation can involve:

- required fields
- required documents
- applicant identity
- eligibility
- duplicate application check
- disqualifying status
- payment requirement
- external clearance requirement

Use DMN for explicit decision tables when policy is inspectable:

```text
Decision: DetermineSubmissionCompleteness
Inputs:
  - applicationType
  - applicantType
  - uploadedDocumentTypes
  - declaredBusinessActivity
Outputs:
  - complete
  - missingDocumentTypes
  - externalClearanceRequired
  - paymentRequired
```

Worker returns:

```json
{
  "submissionComplete": false,
  "missingDocumentTypes": ["BUSINESS_PROFILE", "DIRECTOR_DECLARATION"],
  "externalClearanceRequired": true,
  "paymentRequired": true
}
```

The domain database should also persist validation result snapshot:

```text
application_validation_result
  - applicationId
  - evaluatedAt
  - policyVersion
  - inputSnapshotRef
  - outputSnapshotRef
  - missingDocumentTypes
  - completeness
```

Why snapshot?

Because later policy may change. You need to know what rule was applied at the time.

---

## 13. Document Resubmission Pattern

BPMN:

```text
<Request Missing Documents>
  -> <Wait for Applicant Resubmission Message>
  -> <Validate Submission Again>
```

Request missing documents worker:

```text
1. Create document_request row.
2. Store missing document types.
3. Compute due date.
4. Create notification outbox.
5. Return documentRequestId and resubmissionDueAt.
```

Wait event:

```text
Message Name: applicant-documents-resubmitted
Correlation Key: applicationId
```

Inbound API:

```text
POST /applications/{applicationId}/documents/resubmission
  -> validate applicant owns application
  -> store documents
  -> create inbox/domain event DOCUMENTS_RESUBMITTED
  -> publish Camunda message applicant-documents-resubmitted
```

Race conditions to handle:

1. Applicant resubmits before process reaches message catch event.
2. Applicant resubmits twice.
3. Applicant resubmits after due date.
4. Process already cancelled/rejected.
5. Upload succeeds but message publish fails.

Use inbox/event table and reconciliation.

---

## 14. External Agency Clearance Pattern

External clearance is not just a REST call. It is often a long-running asynchronous exchange.

BPMN:

```text
[Send Clearance Request]
  -> [Wait for Clearance Response]
  -> <Clearance Passed?>
       yes -> continue
       no  -> route to officer review / reject / manual assessment
```

Send request worker:

```text
1. Create external_clearance_request row.
2. Generate clearanceRequestId.
3. Send request using outbox or external client.
4. Store external correlation id.
5. Return clearanceRequestId.
```

Wait event:

```text
Message Name: external-clearance-result
Correlation Key: clearanceRequestId
```

Callback handling:

```text
External Agency Callback
  -> verify signature/authentication
  -> deduplicate by externalEventId
  -> validate correlation key
  -> persist raw payload if required
  -> normalize result
  -> publish Camunda message
  -> update domain request status
```

Late response policy:

```text
If process is still waiting: correlate message.
If process timed out: store response as late event and route to manual review.
If process completed: store response, notify case owner if legally relevant.
```

Never discard late regulatory responses silently.

---

## 15. Payment Collection Pattern

Payment has dangerous ambiguity:

```text
Payment gateway charged applicant,
but our worker crashed before completing Camunda job.
```

Design payment as its own process:

```text
PaymentCollectionProcess
  -> [Create Payment Request]
  -> [Notify Applicant to Pay]
  -> [Wait Payment Callback]
       boundary timer: payment due date
  -> <Paid?>
       yes -> [Mark Payment Confirmed]
       no  -> [Payment Expired]
```

Domain model:

```text
payment_request
  id
  applicationId
  amount
  status
  gatewayReference
  expiresAt
  paidAt
  reconciliationStatus
```

Key rules:

1. Payment request creation must be idempotent.
2. Gateway charge/intent creation must use idempotency key.
3. Callback must be deduplicated.
4. Payment status should be verified via reconciliation if callback missing.
5. Process should not trust only callback.
6. Expiry should not instantly reject if gateway state is ambiguous.

Recommended expiry behavior:

```text
Timer fires
  -> Check payment status with gateway
  -> If paid: continue as paid
  -> If unpaid: expire payment
  -> If unknown: create incident/manual review or retry reconciliation
```

---

## 16. Human Task Pattern: Officer Recommendation

A user task is not simply a frontend button.

It has several layers:

```text
Camunda user task
  - task exists
  - assignment/candidate groups
  - due/follow-up date

Application task projection
  - case inbox
  - priority
  - regulatory labels
  - document summary

Domain authorization
  - can this officer act on this case?
  - conflict of interest?
  - same officer allowed for maker/checker?
  - delegation active?

Domain command
  - recommend approval/rejection/request clarification
  - reason codes
  - notes
  - attachment references
```

Completion flow:

```text
Officer UI
  -> POST /tasks/{taskId}/complete-recommendation
  -> Application validates current user authorization
  -> Application validates task still active
  -> Application validates case state
  -> Application writes decision/recommendation to DB
  -> Application writes audit event
  -> Application completes Camunda task/job/user task
```

Potential consistency issue:

```text
DB decision saved, but Camunda task completion fails.
```

Options:

1. Use completion outbox command.
2. Make endpoint idempotent and allow retry.
3. Store pending task completion and reconcile.
4. Do not duplicate recommendation if user retries.

---

## 17. Maker-Checker Pattern

Common regulatory requirement:

```text
Officer recommends.
Supervisor approves/rejects.
Same person cannot perform both.
```

Domain invariant:

```text
recommendation.createdBy != finalDecision.decidedBy
```

Do not rely only on BPMN lanes or candidate groups.

BPMN can express sequence:

```text
[Officer Recommendation]
  -> [Supervisor Decision]
```

But Java/domain authorization must enforce:

```text
if (currentUser.equals(recommendation.createdBy())) {
    throw new ForbiddenException("Maker cannot be checker");
}
```

Audit event should capture:

```text
- maker
- checker
- taskId
- processInstanceKey
- decision reason
- timestamp
- policy version
```

---

## 18. Final Decision Pattern

Final decision is one of the most audit-sensitive points.

Decision record should include:

```text
decisionId
caseId
applicationId
decisionType
outcome
reasonCode
reasonText
decidedBy
decidedAt
recommendationId
policyVersion
dmnDecisionId
dmnDecisionVersion
inputSnapshotRef
outputSnapshotRef
attachments
processInstanceKey
processElementId
```

Process variable only needs:

```json
{
  "decisionId": "DEC-2026-000111",
  "decisionOutcome": "APPROVED"
}
```

BPMN then routes:

```text
<decisionOutcome == APPROVED>
  -> Issue License
else
  -> Notify Rejection
```

---

## 19. License Issuance Pattern

License issuance may involve:

- generating license number
- generating PDF/certificate
- updating registry
- notifying applicant
- publishing license event

Potential side effects:

```text
- domain DB update
- document generation
- external registry update
- email notification
```

Avoid doing all in one worker if failure handling differs.

Better decomposition:

```text
[Create License Record]
  -> [Generate License Document]
  -> [Publish Registry Update]
  -> [Notify Applicant]
```

Why?

Because each step has different retry, idempotency, and compensation semantics.

Example invariant:

```text
License number generation must be idempotent.
```

If worker retries, do not create a second license number.

---

## 20. Appeal Process Pattern

Appeal is not merely reopening the old process.

It may be a separate process linked to prior decision:

```text
AppealProcess
  -> [Validate Appeal Window]
  -> [Create Appeal Case]
  -> [Assign Appeal Officer]
  -> [Review Grounds]
  -> [Appeal Board Decision]
  -> <Appeal Allowed?>
       yes -> [Reopen/Reverse Original Decision]
       no  -> [Confirm Original Decision]
```

Domain links:

```text
appeal_case.originalDecisionId
appeal_case.originalApplicationId
appeal_case.appealWindowDeadline
appeal_case.outcome
```

Why separate process?

- different actors
- different SLA
- different audit chain
- original decision must remain immutable
- reversal should be explicit, not overwritten

---

## 21. Enforcement Process Pattern

Enforcement cases are often less linear than application review.

Possible lifecycle:

```text
[Complaint / Detection / Referral]
  -> [Create Enforcement Case]
  -> [Preliminary Assessment]
  -> <Proceed?>
       no -> [Close No Action]
       yes -> [Investigation]
  -> [Request Information]
  -> [Inspection]
  -> [Legal Review]
  -> [Enforcement Decision]
  -> <Action Type>
       warning
       fine
       suspension
       revocation
       prosecution referral
  -> [Notify Regulated Party]
  -> [Monitor Compliance]
```

BPMN may not be perfect for highly ad-hoc investigation. Use hybrid:

```text
BPMN controls formal milestones.
Case domain model controls ad-hoc case activities.
Task management handles flexible work items.
Audit model records all actions.
```

Do not model every phone call, evidence upload, and internal note as BPMN element.

---

## 22. SLA Architecture

SLA should be represented at multiple layers:

```text
BPMN timers
  - process timeout
  - escalation
  - expiry

Domain SLA table
  - caseId
  - slaType
  - startAt
  - dueAt
  - pausedAt
  - breachedAt
  - status

Task due dates
  - user task due date
  - follow-up date

Dashboard projection
  - aging
  - breach risk
  - officer/team backlog
```

Important rule:

```text
BPMN timer triggers behavior.
Domain SLA table explains SLA status.
Dashboard projection displays SLA state.
```

Business calendar must be centralized:

```text
SlaCalculator
  - working days
  - holidays
  - agency-specific calendar
  - pause/resume logic
  - timezone
```

Do not duplicate SLA date calculation in BPMN expressions, JavaScript, frontend, and SQL.

---

## 23. Authorization Architecture

Authorization cannot be delegated entirely to Camunda.

Layers:

```text
Authentication:
  - who is the user/service?

Platform authorization:
  - can this user access Operate/Tasklist/API?

Application authorization:
  - can user see this case?
  - can user perform this action?

Domain authorization:
  - is action allowed given case state, role, delegation, conflict rule?

Audit authorization:
  - who can view sensitive history?

Repair authorization:
  - who can modify variables/retry/migrate/cancel process?
```

Example task completion guard:

```java
public void completeSupervisorDecision(User user, CompleteDecisionCommand command) {
    var task = taskGateway.getActiveTask(command.taskId());
    var caseFile = caseRepository.get(command.caseId());

    authorizationPolicy.assertCanCompleteSupervisorDecision(user, caseFile, task);
    makerCheckerPolicy.assertNotSameAsRecommender(user, caseFile);
    caseStatePolicy.assertDecisionAllowed(caseFile);

    decisionService.recordFinalDecision(...);
    taskCompletionOutbox.enqueue(...);
}
```

---

## 24. Audit Architecture

A regulatory workflow must answer:

```text
Who did what?
When?
Why?
Based on which data?
Under which policy/rule version?
At which process step?
Was it automatic or manual?
Was there a repair?
Was there an override?
Who approved the override?
What external events were considered?
What notifications were sent?
```

Audit event schema:

```text
case_audit_event
  id
  caseId
  applicationId
  eventType
  actorType         -- USER / SYSTEM / WORKER / EXTERNAL_SYSTEM / ADMIN
  actorId
  action
  reasonCode
  reasonText
  beforeSnapshotRef
  afterSnapshotRef
  processInstanceKey
  processDefinitionId
  processElementId
  taskId
  correlationId
  causationId
  externalEventId
  createdAt
```

Audit is not just log. Logs are operational. Audit is evidentiary.

Bad audit:

```text
INFO Officer clicked approve
```

Better audit:

```text
CASE_DECISION_RECORDED
  caseId=CASE-2026-000456
  decisionId=DEC-2026-000111
  outcome=APPROVED
  decidedBy=USR-998
  reasonCode=MEETS_REQUIREMENTS
  policyVersion=LICENSING_POLICY_2026_01
  processInstanceKey=2251799813685249
  elementId=supervisorDecision
```

---

## 25. Observability Blueprint

Workflow observability must combine technical and business views.

### 25.1 Technical metrics

```text
worker.jobs.activated
worker.jobs.completed
worker.jobs.failed
worker.jobs.duration
worker.jobs.timeout
worker.incidents.created
worker.retry.exhausted
message.correlation.success
message.correlation.failed
task.completion.failed
external.api.latency
external.api.error_rate
```

### 25.2 Business metrics

```text
applications.submitted
applications.approved
applications.rejected
average.review.duration
average.time.waiting_for_applicant
average.time.waiting_for_external_agency
sla.breach.count
appeal.rate
manual.repair.count
reopened.case.count
```

### 25.3 Identifiers to log everywhere

```text
correlationId
causationId
applicationId
caseId
processInstanceKey
processDefinitionId
elementId
elementInstanceKey
jobKey
taskId
externalEventId
idempotencyKey
```

Without these identifiers, incident diagnosis becomes guesswork.

---

## 26. Operability and Runbook Blueprint

Common runbooks:

### 26.1 Job incident: invalid variable shape

```text
Symptom:
  Incident at validate-submission.

Checks:
  - Inspect variables in Operate.
  - Compare against variable schema.
  - Check deployment version.
  - Check worker logs by processInstanceKey/jobKey.

Repair:
  - Correct variable if factual and approved.
  - Increase retries.
  - Resolve incident.

Audit:
  - Record manual repair log.
  - Include before/after variable snapshot.
  - Include approver if required.
```

### 26.2 External agency callback not correlated

```text
Symptom:
  Inbound callback stored, process still waiting.

Checks:
  - Message name correct?
  - Correlation key correct?
  - Process actually waiting?
  - Message TTL expired?
  - Duplicate/stale event?

Repair:
  - Re-publish correlation message if valid.
  - If process timed out, route to manual review.
  - Do not silently discard callback.
```

### 26.3 Payment marked paid but process expired

```text
Symptom:
  Payment gateway says paid, BPMN went to payment expired.

Checks:
  - Callback arrival time.
  - Expiry timer fire time.
  - Gateway reconciliation result.
  - Domain payment status.

Repair:
  - If legally valid, reopen/modify process or start correction process.
  - Record audit event.
  - Notify applicant/officer if needed.
```

### 26.4 Wrong officer completed task

```text
Symptom:
  Unauthorized or conflict-of-interest action found.

Checks:
  - Domain authorization logs.
  - Delegation state.
  - Task assignment history.
  - Maker-checker invariant.

Repair:
  - Do not simply edit process variable.
  - Create administrative correction / reversal decision.
  - Reassign/reopen process if allowed.
  - Notify compliance/security if required.
```

---

## 27. Process Versioning Blueprint

For process versions:

```text
application-submission:v1
application-submission:v2
application-submission:v3
```

Never assume running instances can always move to latest version.

Change classification:

```text
Safe-ish:
  - rename labels only
  - add non-active future path
  - add optional notification after current wait state
  - add variable output with default

Risky:
  - remove active element
  - rename element IDs
  - change gateway condition semantics
  - change variable schema required by active worker
  - change call activity binding
  - change DMN decision result contract

High risk:
  - change approval authority
  - change legal decision criteria
  - change appeal window semantics
  - change payment expiry rule
  - change compensation path
```

Release strategy:

```text
1. Deploy backward-compatible workers first.
2. Deploy DMN/forms/process model.
3. Start new instances on new version.
4. Decide whether old instances stay or migrate.
5. Run migration only with mapping/test evidence.
6. Monitor incidents by version.
7. Retire old worker compatibility after old instances complete/migrate.
```

Element ID stability is critical. Changing element IDs casually breaks migration/debugging/history continuity.

---

## 28. Testing Blueprint

Test portfolio:

```text
Unit tests:
  - domain policies
  - SLA calculator
  - variable mapper
  - idempotency behavior
  - error classifier

Worker tests:
  - complete success
  - fail with retry
  - throw BPMN error
  - duplicate job execution
  - external timeout

Process tests:
  - happy path approve
  - missing document loop
  - external clearance required
  - payment required
  - payment timeout
  - rejection + appeal
  - incident path
  - compensation path
  - migration scenario

Integration tests:
  - Camunda client
  - Tasklist API integration
  - message correlation
  - outbox/inbox
  - external API stubs

Security tests:
  - unauthorized task completion
  - maker-checker violation
  - tenant isolation
  - process start permission
  - repair privilege

Operational tests:
  - worker crash after side effect
  - duplicate callback
  - late callback
  - bad variable repair
  - process migration dry run
```

A top-tier workflow engineer tests not only happy path, but also **repair path**.

---

## 29. Deployment Blueprint

Recommended deployment units:

```text
regulatory-api
  - REST/BFF endpoints
  - task completion API
  - process start API
  - case query API

regulatory-workers
  - Camunda job workers
  - external integration workers
  - process service workers

regulatory-events
  - inbox consumers
  - outbox publishers
  - message correlation routers

regulatory-scheduler
  - reconciliation jobs
  - SLA projection refresh
  - payment verification

camunda-platform
  - orchestration cluster / Zeebe
  - Operate
  - Tasklist
  - Identity
  - Optimize
  - exporter/search backend
```

Scaling principle:

```text
Scale API for request traffic.
Scale workers for job throughput.
Scale event consumers for integration throughput.
Scale Camunda based on process/job/message/timer load.
Scale search/export backend based on query/history/Operate/Optimize load.
```

Do not scale everything together as one monolith unless the system is small.

---

## 30. Failure Scenario Walkthroughs

### 30.1 Worker crashes after creating case but before completing job

Expected behavior:

```text
- Job timeout occurs.
- Zeebe makes job available again.
- Another worker picks it up.
- Idempotency/domain check sees case already created.
- Worker returns existing caseId.
- Process continues.
```

If duplicate case is created, architecture is wrong.

### 30.2 External API returns 500

Expected behavior:

```text
- If transient: fail job with retries/backoff.
- If retry exhausted: incident.
- If known business rejection: throw BPMN error or return business result.
- If unclear: incident/manual review.
```

Do not throw BPMN error for every technical exception.

### 30.3 Applicant uploads documents after deadline

Expected behavior:

```text
- Upload API persists event.
- Domain policy checks deadline.
- If process already rejected/expired, route to late submission policy.
- Do not correlate blindly if process is no longer waiting.
- Audit late submission.
```

### 30.4 Supervisor approves but notification fails

Expected behavior:

```text
- Approval decision remains recorded.
- Notification worker retries.
- If notification fails permanently, incident or notification failure task.
- Do not roll back legal decision merely because email failed.
```

### 30.5 Process variable corrupted by bad deployment

Expected behavior:

```text
- Incident occurs.
- Runbook identifies variable schema mismatch.
- Repair approved.
- Variable corrected.
- Retries increased.
- Incident resolved.
- Manual repair log recorded.
```

### 30.6 New BPMN version deployed while old cases are pending

Expected behavior:

```text
- New cases start on new version.
- Old cases continue on old version unless migration explicitly planned.
- Workers support both old/new variable contracts if needed.
- Dashboard separates metrics by process definition version.
```

---

## 31. Detailed End-to-End Sequence

### 31.1 Submission to approval happy path

```text
1. Applicant submits application.
2. API validates authentication and payload.
3. Domain service creates application.
4. Audit event APPLICATION_SUBMITTED written.
5. Process application-submission starts.
6. create-application-case worker creates case.
7. validate-submission worker evaluates completeness/eligibility.
8. DMN determines external clearance and payment requirement.
9. external clearance process starts if required.
10. external agency callback arrives.
11. inbox deduplicates callback.
12. message correlation resumes process.
13. payment process starts if required.
14. payment callback confirms payment.
15. officer recommendation task appears.
16. officer recommends approval.
17. supervisor decision task appears.
18. supervisor approves.
19. license issuance worker creates license.
20. document worker generates certificate.
21. notification worker sends approval notification.
22. process ends approved.
23. audit/projection/metrics updated.
```

### 31.2 Submission incomplete path

```text
1. validate-submission returns submissionComplete=false.
2. process creates document request.
3. applicant notification sent.
4. process waits for resubmission message.
5. boundary timer tracks deadline.
6. applicant uploads missing documents.
7. message correlation resumes process.
8. validation runs again.
9. process continues or loops with controlled retry count.
```

Do not allow infinite unbounded resubmission loop without policy.

---

## 32. Command and Event Contracts

### 32.1 Start process command

```java
public record StartApplicationProcessCommand(
    String applicationId,
    String applicantId,
    String applicationType,
    String submittedBy,
    Instant submittedAt,
    String correlationId
) {}
```

### 32.2 Worker result

```java
public record ValidationResult(
    boolean submissionComplete,
    boolean externalClearanceRequired,
    boolean paymentRequired,
    List<String> missingDocumentTypes,
    String validationResultId
) {}
```

### 32.3 Message correlation command

```java
public record CorrelateExternalClearanceResultCommand(
    String clearanceRequestId,
    String externalEventId,
    String outcome,
    String payloadRef,
    Instant receivedAt
) {}
```

### 32.4 Task completion command

```java
public record CompleteSupervisorDecisionCommand(
    String taskId,
    String caseId,
    String decisionOutcome,
    String reasonCode,
    String reasonText,
    String decidedBy,
    String correlationId
) {}
```

All commands should be idempotent where retry is possible.

---

## 33. Error Classification Matrix

| Situation | Camunda action | Domain action | Audit action |
|---|---|---|---|
| External API timeout | fail job with retry/backoff | none or pending attempt | operational log |
| External API validation rejection | BPMN error or business result | persist rejection reason | audit business outcome |
| Missing document | normal BPMN path | create document request | audit request |
| Worker bug | fail job, incident after retries | no business mutation if possible | incident log |
| Bad variable | incident, repair variable | manual repair record | audit repair |
| Unauthorized task action | reject API request | no mutation | security audit |
| Payment callback duplicate | do not correlate twice | ignore/dedup | audit duplicate seen |
| Late external response | no blind correlation | store late event/manual review | audit late event |
| Notification failure after approval | retry/incident notification | decision remains | audit notification failure |
| Legal reversal | explicit correction process | reversal decision | full audit chain |

---

## 34. Anti-Corruption Layer for External Systems

External systems often have unstable payloads, legacy semantics, and unreliable callbacks.

Use anti-corruption layer:

```text
External payload
  -> validate signature/auth
  -> parse raw schema
  -> store raw payload reference
  -> normalize to internal event
  -> map external code to internal enum
  -> deduplicate
  -> persist inbox event
  -> correlate process
```

Do not let external payload shape leak into BPMN variables.

Bad:

```json
{
  "agencyResponse": {
    "ext_cd": "00",
    "legacy_flag_x": "Y",
    "remarks": "..."
  }
}
```

Better:

```json
{
  "clearanceRequestId": "CLR-2026-0001",
  "clearanceOutcome": "PASSED"
}
```

Detailed payload remains in integration/audit store.

---

## 35. Process UI Blueprint

UI should not directly expose raw Camunda concepts to users.

Officer sees:

```text
Case No
Applicant
Application Type
Current Stage
SLA Due
Assigned To
Pending Documents
External Clearance Status
Recommended Action
Available Actions
```

Backend maps:

```text
Camunda task + domain case + authorization policy + projection view
```

Task screen should handle:

- task no longer active
- user lost permission
- case transferred
- process migrated
- SLA breached
- stale page submit
- duplicate submit
- concurrent submit

Completion API must be idempotent:

```text
If same user submits same command twice, do not create duplicate decision.
```

---

## 36. Reporting and Process Intelligence

Operational reports:

```text
- pending tasks by team
- cases aging by stage
- SLA breach risk
- incident count by process version
- external agency response time
- payment completion time
- document resubmission loops
```

Regulatory reports:

```text
- approvals/rejections by type
- reasons for rejection
- manual override rate
- appeal success rate
- enforcement actions by category
- decision turnaround time
```

Engineering reports:

```text
- worker failure rate
- retry exhaustion rate
- duplicate inbound events
- message correlation failures
- average job duration
- process version distribution
```

Do not run heavy reports directly against runtime engine if it hurts orchestration performance. Use projections/exported data where appropriate.

---

## 37. Governance Model

Process governance should define:

```text
Who can change BPMN?
Who can change DMN?
Who approves new process version?
Who validates migration plan?
Who can resolve incidents?
Who can modify process variables?
Who can cancel process instances?
Who can perform administrative correction?
Who reviews audit logs?
Who owns worker failures?
Who owns external integration failures?
```

Suggested review board for high-risk process:

```text
- business owner
- regulatory/legal representative
- tech lead/architect
- QA lead
- operations/SRE
- security representative
- data/audit representative
```

Not every minor change needs heavyweight board. But high-risk decision path changes should not be merged casually.

---

## 38. Production Readiness Checklist

### 38.1 Modeling

- [ ] Process has clear business purpose.
- [ ] Diagram has one abstraction level.
- [ ] BPMN is not a giant spaghetti graph.
- [ ] User tasks represent real human decisions/work.
- [ ] Service tasks have clear job type contracts.
- [ ] Timers represent real SLA/expiry/reminder behavior.
- [ ] Message correlation keys are explicit.
- [ ] Compensation/correction paths are intentional.
- [ ] Gateway conditions are testable.
- [ ] Call activities have stable contracts.

### 38.2 Domain/data

- [ ] Domain database owns business truth.
- [ ] Process variables are lightweight.
- [ ] Sensitive data is minimized.
- [ ] Variable schema is versioned/tested.
- [ ] Decisions are snapshotted.
- [ ] Audit events include actor/reason/process identifiers.
- [ ] Documents are stored outside process variables.

### 38.3 Worker reliability

- [ ] Every side-effecting worker is idempotent.
- [ ] Idempotency keys are documented.
- [ ] External calls have timeout/retry classification.
- [ ] Technical failure vs business error is separated.
- [ ] Worker crash after side effect is safe.
- [ ] Retry exhaustion creates actionable incident.
- [ ] Poison job handling exists.

### 38.4 Integration

- [ ] Inbound events are deduplicated.
- [ ] Outbox exists for reliable publish.
- [ ] Early/late/stale messages are handled.
- [ ] External payloads are normalized.
- [ ] External credentials are secured.
- [ ] Rate limits are respected.
- [ ] Reconciliation exists for ambiguous systems.

### 38.5 Human workflow

- [ ] Task visibility is authorized.
- [ ] Task completion is domain-authorized.
- [ ] Maker-checker is enforced in domain logic.
- [ ] Delegation is modeled.
- [ ] Stale task submit is handled.
- [ ] Task completion is idempotent.
- [ ] Task audit is complete.

### 38.6 Operations

- [ ] Incidents have runbooks.
- [ ] Variable repair is controlled/audited.
- [ ] Retry/migration/modification permissions are restricted.
- [ ] Process version distribution is observable.
- [ ] Reconciliation jobs exist.
- [ ] Dashboards cover business and technical health.
- [ ] Alerts are actionable.

### 38.7 Testing

- [ ] Happy path tested.
- [ ] Error paths tested.
- [ ] Timer paths tested.
- [ ] Message paths tested.
- [ ] Duplicate worker execution tested.
- [ ] Duplicate callback tested.
- [ ] Late event tested.
- [ ] Authorization tested.
- [ ] Migration tested.
- [ ] Manual repair tested.

### 38.8 Versioning

- [ ] Element IDs stable.
- [ ] Worker supports old/new contracts during transition.
- [ ] DMN/form/call activity binding intentional.
- [ ] Running instance strategy documented.
- [ ] Migration mapping tested.
- [ ] Rollback limitations understood.

---

## 39. What Top 1% Engineers See Differently

A beginner sees:

```text
BPMN diagram + Java worker = workflow app
```

A strong engineer sees:

```text
runtime state + domain truth + human task + external events + audit + failure handling
```

A top-tier engineer sees the full invariant structure:

```text
Every process step must have:
  - owner
  - input contract
  - output contract
  - state transition
  - authorization boundary
  - idempotency behavior
  - failure classification
  - audit event
  - observability signal
  - repair strategy
  - versioning impact
```

They also know that process architecture fails less often because of BPMN syntax and more often because of hidden assumptions:

- “This worker will only run once.”
- “This callback will always arrive after the process is waiting.”
- “This task can only be completed by the assigned user because UI hides the button.”
- “This process variable can store the full payload.”
- “We can fix it manually in DB later.”
- “Rollback means deploy old BPMN.”
- “Approval email failed, so approval failed.”
- “A status field is enough.”

The discipline is to make those assumptions explicit and design against their failure.

---

## 40. Minimal Reference Architecture Summary

If you need a compressed blueprint:

```text
1. Use BPMN for long-running orchestration, not domain truth.
2. Keep domain entities in application DB.
3. Store only routing/context variables in Camunda.
4. Use DMN for explicit decision logic.
5. Use Java workers as inbound adapters to application services.
6. Make every side-effecting worker idempotent.
7. Use outbox for reliable outbound events.
8. Use inbox for reliable inbound events.
9. Use message correlation with stable business keys.
10. Use timers for SLA/expiry, not technical retry.
11. Enforce authorization in domain/application layer.
12. Treat user task as wait state, not permission guarantee.
13. Snapshot decisions and policy versions.
14. Build audit as evidentiary data, not logs.
15. Build runbooks before production.
16. Test duplicate execution, late messages, repair, and migration.
17. Version process/DMN/forms/workers together deliberately.
18. Monitor both technical and business health.
19. Prefer explicit correction over silent mutation.
20. Design for explainability two years later.
```

---

## 41. Suggested Capstone Implementation Exercises

To truly internalize this, implement in stages.

### Exercise 1 — Minimal application approval process

Build:

```text
submit application
  -> create case
  -> officer recommendation
  -> supervisor decision
  -> approved/rejected notification
```

Requirements:

- Spring Boot API
- Camunda process
- Java worker
- domain DB
- audit event
- idempotent create-case worker
- task completion authorization

### Exercise 2 — Missing document loop

Add:

```text
validate submission
  -> request missing documents
  -> wait for resubmission message
  -> validate again
```

Requirements:

- message correlation
- timer due date
- duplicate upload handling
- late upload handling

### Exercise 3 — External clearance

Add:

```text
send external request
  -> wait external callback
  -> handle pass/fail/timeout
```

Requirements:

- inbox dedup
- callback signature verification
- correlation key
- late callback policy

### Exercise 4 — Payment process

Add:

```text
payment request
  -> wait callback
  -> expiry timer
  -> reconciliation
```

Requirements:

- payment idempotency
- duplicate callback
- ambiguous gateway state
- reconciliation job

### Exercise 5 — Production operations

Add:

```text
incident dashboard
manual repair log
retry operation
variable correction approval
process version deployment
```

Requirements:

- runbook
- audit repair
- migration test
- metrics/logging/tracing

---

## 42. References

The following references are useful for continuing beyond this capstone:

- Camunda 8 Docs — Components overview: https://docs.camunda.io/docs/components/
- Camunda 8 Docs — Java Client: https://docs.camunda.io/docs/apis-tools/java-client/getting-started/
- Camunda 8 Docs — Spring Boot Starter: https://docs.camunda.io/docs/apis-tools/camunda-spring-boot-starter/getting-started/
- Camunda 8 Docs — Job Workers: https://docs.camunda.io/docs/components/concepts/job-workers/
- Camunda 8 Docs — Messages: https://docs.camunda.io/docs/components/concepts/messages/
- Camunda 8 Docs — Incidents: https://docs.camunda.io/docs/components/concepts/incidents/
- Camunda 8 Docs — User Tasks: https://docs.camunda.io/docs/components/modeler/bpmn/user-tasks/
- Camunda 8 Docs — Process Instance Migration: https://docs.camunda.io/docs/components/concepts/process-instance-migration/
- Camunda 8 Docs — Handling Data in Processes: https://docs.camunda.io/docs/components/best-practices/development/handling-data-in-processes/
- Camunda 8 Docs — Dealing with Problems and Exceptions: https://docs.camunda.io/docs/components/best-practices/development/dealing-with-problems-and-exceptions/
- Camunda 8 Docs — Best Practices: https://docs.camunda.io/docs/components/best-practices/best-practices-overview/
- OMG BPMN: https://www.omg.org/spec/BPMN/2.0.2/About-BPMN
- OMG DMN: https://www.omg.org/dmn/

---

# Penutup Seri

Dengan selesainya Part 30, seri **learn-java-bpmn-camunda-process-orchestration-engineering** selesai.

Materi yang sudah ditempuh:

```text
Part 0  - Orientation
Part 1  - BPMN 2.0 Deep Semantics
Part 2  - BPMN Core Elements
Part 3  - BPMN Modeling Discipline
Part 4  - Camunda 7 vs Camunda 8
Part 5  - Camunda 8 Runtime Internals / Zeebe Mental Model
Part 6  - Java Client Engineering
Part 7  - Job Worker Reliability
Part 8  - Process Variables
Part 9  - Error, Incident, Escalation, Compensation
Part 10 - Human Workflow
Part 11 - DMN and Decision Engineering
Part 12 - Message Correlation
Part 13 - Timers, SLA, Timeout, Expiry
Part 14 - Multi-instance and Concurrency
Part 15 - Subprocess, Call Activity, Composition
Part 16 - Saga and Long-running Transactions
Part 17 - Camunda 7 Deep Dive
Part 18 - Camunda 8 Deep Dive
Part 19 - Spring Boot + Camunda 8 Architecture
Part 20 - Testing BPMN and Camunda Applications
Part 21 - Observability
Part 22 - Production Operations
Part 23 - Security, Identity, Authorization, Data Protection
Part 24 - Integration Patterns
Part 25 - Performance, Scaling, Capacity, Cost
Part 26 - Versioning, Deployment, Change Management
Part 27 - Regulatory and Case Management Patterns
Part 28 - Workflow Engine vs State Machine vs Rules Engine vs Temporal
Part 29 - Anti-patterns, Failure Modes, Design Review Checklist
Part 30 - Capstone Architecture
```

The real mark of mastery is not that you can draw a BPMN diagram.

It is that you can design a process where every state, every wait, every human decision, every external event, every retry, every failure, every repair, and every audit explanation has a deliberate place.

That is process orchestration engineering.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-bpmn-camunda-process-orchestration-engineering](./learn-java-bpmn-camunda-part-29-anti-patterns-failure-modes-design-review-checklist.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 0 — Orientation: ORM as State Synchronization Engine, Not Just Mapping](../database/jpa/00-orientation-orm-as-state-synchronization-engine.md)

</div>