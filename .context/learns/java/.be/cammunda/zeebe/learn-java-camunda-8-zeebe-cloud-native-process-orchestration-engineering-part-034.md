# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-034.md

# Part 034 — End-to-End Reference Architecture: Production-Grade Java Camunda 8 System

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Bagian: `034`  
> Topik: End-to-End Reference Architecture: Production-Grade Java Camunda 8 System  
> Target: Java engineer / tech lead / architect yang ingin mampu mendesain, membangun, mengoperasikan, dan mempertanggungjawabkan sistem Camunda 8 production-grade.

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas banyak potongan penting:

- Zeebe architecture.
- Broker, gateway, partition, replication.
- BPMN runtime semantics.
- Java client evolution.
- Worker correctness.
- Variable contract.
- Message correlation.
- Error handling.
- Timers/SLA.
- User task dan Tasklist.
- Spring Boot worker integration.
- Hexagonal worker architecture.
- Connectors.
- Exporters/read-side architecture.
- Operate/Tasklist/Optimize.
- Security, tenancy, compliance.
- Performance, reliability, observability, testing, migration, anti-pattern.

Sekarang semua itu harus dijahit menjadi satu reference architecture.

Target bagian ini bukan membuat aplikasi demo kecil. Targetnya adalah membentuk blueprint yang bisa dipakai untuk membangun sistem enterprise seperti:

- regulatory licensing lifecycle,
- case management,
- enforcement workflow,
- appeal handling,
- external agency verification,
- human review,
- SLA escalation,
- audit defensibility,
- production support,
- multi-service Java worker platform.

Mental model utama:

```text
Camunda 8 / Zeebe is not the whole application.
It is the durable orchestration control plane.

Your Java services own domain state, side effects, consistency, validation,
authorization, idempotency, and integration correctness.

Operate, Tasklist, Optimize, and secondary storage are read/operation surfaces,
not substitutes for domain persistence or audit design.
```

---

## 1. Reference Scenario

Kita gunakan satu scenario yang cukup kompleks untuk mewakili real-world enterprise workflow.

Scenario:

```text
Regulatory Application and Enforcement Lifecycle
```

Contoh domain:

- applicant mengajukan license/application;
- sistem melakukan pre-screening;
- officer melakukan review;
- sistem memanggil external registry/checking service;
- jika ada issue, case masuk clarification;
- jika memenuhi syarat, approval dibuat;
- jika ditolak, applicant bisa appeal;
- jika ditemukan breach setelah license aktif, enforcement case dibuat;
- SLA dan statutory deadline harus dipantau;
- semua keputusan harus defensible secara audit.

Lifecycle besar:

```text
Draft / Submitted
    -> Intake Validation
    -> Screening
    -> Officer Review
    -> External Verification
    -> Decision
        -> Approved
        -> Rejected
        -> Clarification Required
    -> Appeal Window
    -> Closed

Separate but related lifecycle:

License Active
    -> Compliance Monitoring
    -> Breach Detected
    -> Enforcement Case
    -> Investigation
    -> Notice
    -> Representation
    -> Sanction / No Action
    -> Appeal
    -> Closed
```

Kita tidak akan memodelkan semua detail sebagai satu BPMN raksasa. Itu anti-pattern. Kita akan memecahnya menjadi beberapa process definition dengan domain aggregate sebagai source of truth.

---

## 2. Core Architectural Principle

Reference architecture ini berdiri di atas tujuh prinsip.

### 2.1 Zeebe Owns Orchestration State, Not Domain State

Zeebe tahu:

- process instance sedang di node mana;
- job mana yang aktif;
- timer mana yang menunggu;
- message catch event mana yang siap dikorelasi;
- incident mana yang terjadi;
- variable orchestration yang dibutuhkan untuk routing proses.

Zeebe tidak seharusnya menjadi database utama untuk:

- full application record;
- evidence document;
- all applicant profile fields;
- business decision history;
- full audit journal;
- reporting warehouse;
- authorization matrix;
- external integration ledger.

Domain database tetap wajib.

```text
Good:
Process variable: applicationId, caseId, applicantType, riskBand, decisionCode
Domain DB: full application, officer notes, attachments, evidence, eligibility calculation

Bad:
Process variable: full application JSON, full document text, full audit history, full role mapping
```

### 2.2 Worker Owns Side-Effect Correctness

Zeebe memberikan job. Worker menjalankan business action. Karena job bisa dieksekusi ulang, worker harus idempotent.

```text
Zeebe guarantees durable orchestration progress.
It does not magically guarantee exactly-once external side effects.
```

Worker harus punya:

- idempotency key;
- operation ledger;
- retry classification;
- external request correlation;
- reconciliation path;
- safe completion strategy.

### 2.3 Process Model is an Executable Contract

BPMN bukan gambar dokumentasi pasif. Di Camunda 8, BPMN adalah executable contract.

Konsekuensi:

- job type adalah contract antara BPMN dan worker;
- input/output mapping adalah contract data;
- message name + correlation key adalah contract integration;
- error code adalah contract antara worker dan process model;
- user task candidate group adalah contract human authorization/work routing;
- timer adalah contract SLA/deadline.

### 2.4 Read Model is Eventually Consistent

Operate, Tasklist, Optimize, dan custom projections menerima data melalui exported records / secondary storage path.

Jadi:

- Operate bisa lag;
- Tasklist bisa lag;
- Optimize bisa tidak real-time;
- custom dashboard bisa berbeda sementara dari engine state;
- command decision tidak boleh bergantung buta pada read projection yang belum konsisten.

### 2.5 Domain Authorization is Not Replaced by Task Candidate Groups

Candidate group membantu assignment dan visibility task, tetapi domain authorization tetap harus divalidasi oleh application/backend.

```text
Tasklist says: user can see/claim/complete this task.
Domain service must still say: user may approve this application under domain policy.
```

### 2.6 Audit is Deliberate, Not Accidental

Zeebe record stream dan Operate history membantu observability/operation, tetapi regulated audit biasanya butuh desain khusus:

- who did what;
- on behalf of whom;
- before/after value;
- evidence reference;
- decision rationale;
- policy/rule version;
- timestamp source;
- immutable/tamper-evident storage;
- retention policy.

### 2.7 Production Architecture is a Set of Boundaries

Top engineer tidak mendesain “satu sistem besar”. Ia mendesain boundaries:

- orchestration boundary;
- domain boundary;
- worker boundary;
- integration boundary;
- read model boundary;
- audit boundary;
- security boundary;
- operational boundary.

---

## 3. High-Level Component Architecture

Reference architecture:

```text
                   +-----------------------------+
                   |        Human Users           |
                   | Applicant / Officer / Admin  |
                   +---------------+-------------+
                                   |
                                   v
+------------------+      +----------------------+        +-------------------+
| External Portal  | ---> | Domain API Gateway   | -----> | Application Svc   |
| / Case UI        |      | / BFF / Backend      |        | Case Domain Svc   |
+------------------+      +----------------------+        +---------+---------+
                                                                     |
                                                                     v
                                                          +-------------------+
                                                          | Domain Database   |
                                                          | Application/Case  |
                                                          +-------------------+

             +---------------------------------------------------------------+
             |                    Camunda 8 Platform                         |
             |                                                               |
             | +-------------+     +-------------+     +-------------------+ |
             | | Zeebe       |<--->| Gateway/API |<--->| Java/Camunda      | |
             | | Brokers     |     |             |     | Clients           | |
             | +------+------+     +-------------+     +-------------------+ |
             |        |                                                      |
             |        v                                                      |
             | +----------------+     +-----------+     +------------------+ |
             | | Exporters      | --> | Secondary | --> | Operate/Tasklist/| |
             | |                |     | Storage   |     | Optimize         | |
             | +----------------+     +-----------+     +------------------+ |
             +---------------------------------------------------------------+

       +----------------------+    +----------------------+    +----------------------+
       | Worker: Intake       |    | Worker: Verification |    | Worker: Decision     |
       | Java Spring Boot     |    | Java Spring Boot     |    | Java Spring Boot     |
       +----------+-----------+    +----------+-----------+    +----------+-----------+
                  |                           |                           |
                  v                           v                           v
         +----------------+          +----------------+          +----------------+
         | Domain DB      |          | External APIs  |          | Domain DB      |
         | Operation Log  |          | Registry/KYC   |          | Audit Service  |
         +----------------+          +----------------+          +----------------+

       +----------------------+    +----------------------+    +----------------------+
       | Audit Projection     |    | Reporting Warehouse  |    | Observability Stack  |
       | Immutable Journal    |    | BI/Analytics         |    | Logs/Metrics/Traces  |
       +----------------------+    +----------------------+    +----------------------+
```

Camunda 8 platform sendiri terdiri dari orchestration cluster, Connectors, Optimize, Web Modeler, Console, dan Management Identity pada self-managed deployment. Orchestration cluster mencakup Zeebe, Operate, Tasklist, dan Identity/Admin surfaces. Komponen ini perlu dipahami sebagai runtime platform, bukan sekadar library Java.

---

## 4. Logical Boundaries

### 4.1 Orchestration Boundary

Orchestration boundary berisi:

- BPMN process definition;
- process instance;
- jobs;
- timers;
- messages;
- user tasks;
- BPMN errors;
- incidents;
- orchestration variables.

Contoh process variables yang layak:

```json
{
  "applicationId": "APP-2026-000123",
  "caseId": "CASE-2026-000987",
  "applicantType": "COMPANY",
  "riskBand": "HIGH",
  "channel": "PORTAL",
  "requiresExternalVerification": true,
  "decisionCode": "PENDING_REVIEW",
  "tenantId": "agency-a"
}
```

Tidak layak:

```json
{
  "fullApplication": { "...": "hundreds of fields" },
  "documents": ["base64..."],
  "allOfficerNotes": ["..."],
  "completeAuditTrail": ["..."]
}
```

### 4.2 Domain Boundary

Domain boundary berisi:

- application aggregate;
- case aggregate;
- license aggregate;
- enforcement aggregate;
- eligibility rules;
- status transition;
- assignment domain rule;
- statutory deadline calculation;
- evidence metadata;
- decision rationale;
- domain audit.

Domain boundary tidak boleh bergantung pada Camunda API sebagai core model.

Bad:

```java
public class ApplicationService {
    public void approve(long processInstanceKey, Map<String, Object> variables) {
        // domain model based on process variables only
    }
}
```

Better:

```java
public final class ApproveApplicationCommand {
    private final ApplicationId applicationId;
    private final OfficerId officerId;
    private final DecisionRationale rationale;
    private final PolicyVersion policyVersion;
    private final RequestId requestId;
}
```

Camunda worker converts job variables into domain command. Domain service does not need to know job key or BPMN node unless required for audit correlation.

### 4.3 Integration Boundary

Integration boundary berisi:

- outbound external API calls;
- inbound callback endpoints;
- message publishing to Zeebe;
- connector runtime;
- integration gateway;
- retry/backoff/circuit breaker;
- external operation ledger;
- reconciliation.

### 4.4 Read/Projection Boundary

Read boundary berisi:

- Operate;
- Tasklist;
- Optimize;
- custom audit timeline;
- custom dashboard;
- search index;
- warehouse.

Semua read-side projection harus diasumsikan eventually consistent.

### 4.5 Security Boundary

Security boundary berisi:

- user authentication;
- machine client credentials;
- OAuth client;
- worker secret;
- tenant access;
- task authorization;
- domain authorization;
- admin/support permissions.

---

## 5. Process Landscape Design

Untuk scenario regulatory lifecycle, jangan buat satu BPMN ultra-besar.

Gunakan landscape seperti ini:

```text
Process A: application-intake-process
    Responsible for submission, validation, acknowledgement.

Process B: application-assessment-process
    Responsible for screening, officer review, external verification, decision.

Process C: clarification-process
    Responsible for requesting and receiving additional information.

Process D: appeal-process
    Responsible for appeal submission, appeal review, appeal outcome.

Process E: license-activation-process
    Responsible for activation, notification, validity period, renewal trigger.

Process F: enforcement-case-process
    Responsible for breach handling, investigation, notice, representation, sanction.

Process G: sla-monitoring/escalation-process
    Optional supporting process if deadline logic is too complex to keep inside one process.
```

### 5.1 Why Multiple Processes?

Karena process definition harus punya boundary yang stabil.

Satu lifecycle besar sering berubah di bagian tertentu:

- intake berubah karena form berubah;
- assessment berubah karena policy berubah;
- appeal berubah karena regulation berubah;
- enforcement berubah karena legal procedure berubah;
- SLA berubah karena operational policy berubah.

Jika semuanya dalam satu BPMN, setiap perubahan kecil menciptakan risk pada seluruh lifecycle.

### 5.2 Call Activity vs Message Chaining

Ada dua cara menghubungkan process:

```text
Parent process --call activity--> child process
```

atau:

```text
Process A completes milestone
    -> domain event / message
    -> Process B starts or continues
```

Gunakan call activity ketika:

- child lifecycle adalah bagian tightly-coupled dari parent;
- parent perlu menunggu child selesai;
- variable mapping jelas;
- version binding bisa dikontrol.

Gunakan message/event chaining ketika:

- lifecycle lebih loosely-coupled;
- proses bisa berjalan independen;
- ada external callback;
- domain event lebih natural;
- audit/reporting butuh milestone event eksplisit.

---

## 6. Example BPMN Landscape

### 6.1 Application Assessment Process

Textual model:

```text
Start: Application Submitted Message
    -> Service Task: Load Application Summary
    -> Service Task: Run Initial Screening
    -> Exclusive Gateway: Screening Result?
        -> Low Risk:
            -> User Task: Officer Review
            -> Service Task: Create Draft Decision
        -> High Risk:
            -> Service Task: Request External Verification
            -> Intermediate Message Catch: External Verification Received
            -> User Task: Senior Officer Review
            -> Service Task: Create Draft Decision
    -> Exclusive Gateway: Decision Type?
        -> Approve:
            -> Service Task: Approve Application
            -> Service Task: Issue License
            -> End: Approved
        -> Reject:
            -> User Task: Confirm Rejection
            -> Service Task: Reject Application
            -> Intermediate Timer: Appeal Window
            -> End: Rejected/Closed
        -> Clarification Required:
            -> Call Activity: Clarification Process
            -> Return to Review
```

### 6.2 Worker Job Types

```text
application.load-summary.v1
application.run-screening.v1
verification.request-external.v1
verification.consume-result.v1
application.create-draft-decision.v1
application.approve.v1
license.issue.v1
application.reject.v1
notification.send.v1
```

Versioned job type is deliberate. It avoids accidental worker/process incompatibility.

### 6.3 Message Names

```text
ApplicationSubmitted
ExternalVerificationReceived
ClarificationSubmitted
AppealSubmitted
EnforcementBreachDetected
```

### 6.4 Correlation Keys

```text
ApplicationSubmitted             -> applicationId
ExternalVerificationReceived     -> verificationRequestId
ClarificationSubmitted           -> clarificationRequestId
AppealSubmitted                  -> appealId or applicationId depending design
EnforcementBreachDetected        -> breachId or licenseId
```

Correlation key must be designed, not guessed.

---

## 7. Domain Data Model

A simplified domain model:

```text
APPLICATION
- application_id
- applicant_id
- application_type
- status
- risk_band
- submitted_at
- current_case_id
- version

CASE
- case_id
- case_type
- application_id
- status
- assigned_unit
- assigned_officer
- statutory_due_at
- current_phase
- version

CASE_DECISION
- decision_id
- case_id
- decision_type
- decision_code
- rationale
- policy_version
- decided_by
- decided_at

EVIDENCE_DOCUMENT
- document_id
- case_id
- document_type
- storage_ref
- hash
- uploaded_by
- uploaded_at

EXTERNAL_OPERATION
- operation_id
- idempotency_key
- operation_type
- business_ref
- request_hash
- status
- external_ref
- first_attempt_at
- last_attempt_at
- response_summary

AUDIT_EVENT
- audit_event_id
- aggregate_type
- aggregate_id
- action
- actor_id
- actor_type
- before_hash
- after_hash
- reason_code
- trace_id
- process_instance_key
- job_key
- occurred_at
```

Important:

- process instance key is correlation metadata, not domain identity;
- applicationId/caseId are domain identity;
- jobKey is execution attempt identity;
- operation id/idempotency key is side-effect identity;
- audit event id is defensibility identity.

---

## 8. Java Service Landscape

Reference Java services:

```text
application-domain-service
    Owns application aggregate, validation, status, eligibility.

case-domain-service
    Owns case lifecycle, assignment, phase, officer decisions.

license-domain-service
    Owns license issuance, activation, validity, renewal.

enforcement-domain-service
    Owns breach, investigation, notice, sanction, appeal.

camunda-worker-application
    Hosts multiple job workers for process automation.

camunda-message-adapter
    Publishes messages to Camunda from domain events/callbacks.

audit-service
    Owns immutable audit/event journal.

notification-service
    Sends email/SMS/letter/portal notification.

external-verification-adapter
    Handles external registry integration, callbacks, reconciliation.
```

Deployment can be consolidated or separated depending scale.

### 8.1 Consolidated Worker Application

```text
camunda-worker-application
    - application workers
    - verification workers
    - license workers
    - notification workers
```

Good when:

- moderate scale;
- same team owns process;
- same release cadence;
- same security boundary;
- easier operational management.

Risk:

- one bad worker affects all;
- over-broad credentials;
- harder independent scaling.

### 8.2 Domain-Aligned Worker Applications

```text
application-worker-service
verification-worker-service
license-worker-service
enforcement-worker-service
notification-worker-service
```

Good when:

- different domain teams;
- different load profile;
- different credentials;
- different release cadence;
- better blast-radius control.

Risk:

- more operational overhead;
- more deployment coordination;
- more observability complexity.

---

## 9. Worker Internal Architecture

Use hexagonal style.

```text
com.example.applicationworker

  camunda/
    ApplicationScreeningWorker.java
    ExternalVerificationWorker.java
    ApproveApplicationWorker.java

  contract/
    ApplicationScreeningJobVariables.java
    ApplicationScreeningJobResult.java
    ExternalVerificationJobVariables.java
    BpmnErrorCodes.java
    JobTypes.java

  application/
    ScreenApplicationUseCase.java
    RequestExternalVerificationUseCase.java
    ApproveApplicationUseCase.java

  domain/
    ApplicationId.java
    CaseId.java
    ScreeningResult.java
    Decision.java

  port/out/
    ApplicationRepository.java
    ExternalVerificationPort.java
    AuditPort.java
    IdempotencyPort.java

  adapter/out/db/
    JdbcApplicationRepository.java
    JdbcIdempotencyRepository.java

  adapter/out/http/
    ExternalVerificationHttpClient.java

  adapter/out/audit/
    AuditClient.java

  observability/
    WorkflowLogging.java
    WorkflowMetrics.java

  config/
    CamundaClientConfig.java
    WorkerConfig.java
```

### 9.1 Worker as Thin Adapter

Worker method should not contain domain logic.

Bad:

```java
@JobWorker(type = "application.approve.v1")
public Map<String, Object> approve(JobClient client, ActivatedJob job) {
    Map<String, Object> vars = job.getVariablesAsMap();
    // 300 lines of validation, DB update, audit, external calls
    return Map.of("decisionCode", "APPROVED");
}
```

Better:

```java
@JobWorker(type = JobTypes.APPLICATION_APPROVE_V1)
public ApproveApplicationJobResult approve(ApproveApplicationJobVariables variables) {
    ApproveApplicationCommand command = mapper.toCommand(variables);
    ApproveApplicationResult result = useCase.approve(command);
    return mapper.toJobResult(result);
}
```

The worker should:

1. read job variables;
2. validate contract;
3. map to application command;
4. call use case;
5. map result to process variables;
6. map domain/business errors to BPMN error;
7. map technical transient errors to job failure;
8. emit logs/metrics/traces.

---

## 10. Idempotency and Operation Ledger

For every side-effect worker, define an idempotency key.

Example:

```text
operationType = EXTERNAL_VERIFICATION_REQUEST
businessRef   = applicationId
attemptScope  = processDefinitionId + processVersion + elementId
idempotencyKey = sha256(operationType + ':' + applicationId + ':' + verificationPurpose)
```

Operation ledger flow:

```text
Worker receives job
    -> build idempotency key
    -> check EXTERNAL_OPERATION
        -> COMPLETED: return stored result to Zeebe
        -> IN_PROGRESS but expired: reconcile or take ownership
        -> FAILED_RETRYABLE: retry according to policy
        -> not found: insert REQUESTED
    -> call external system
    -> persist external ref / result
    -> return result to Zeebe
```

Table:

```sql
CREATE TABLE external_operation (
    operation_id        VARCHAR(64) PRIMARY KEY,
    idempotency_key     VARCHAR(200) NOT NULL UNIQUE,
    operation_type      VARCHAR(80) NOT NULL,
    business_ref        VARCHAR(100) NOT NULL,
    request_hash        VARCHAR(128) NOT NULL,
    status              VARCHAR(40) NOT NULL,
    external_ref        VARCHAR(120),
    response_summary    CLOB,
    created_at          TIMESTAMP NOT NULL,
    updated_at          TIMESTAMP NOT NULL,
    completed_at        TIMESTAMP,
    version             BIGINT NOT NULL
);
```

### 10.1 Why Not Use Job Key as Idempotency Key?

Job key identifies a Zeebe job. It may be useful for execution logging. But for external operation idempotency, job key can be too narrow.

Suppose:

- same business operation is retried;
- process is migrated;
- incident is resolved;
- operator modifies process;
- process is re-run from a milestone;
- external callback arrives late.

A domain-oriented idempotency key is usually safer.

Recommended identity layering:

```text
jobKey              -> execution attempt / Zeebe job identity
processInstanceKey  -> orchestration instance identity
applicationId        -> business aggregate identity
operationId          -> side-effect identity
externalRef          -> external system identity
requestId            -> API/request correlation identity
traceId              -> observability identity
```

---

## 11. Transaction Boundary Patterns

### 11.1 DB Update then Complete Job

Pattern:

```text
Worker
  -> begin DB transaction
  -> update domain state
  -> write audit event
  -> write operation ledger
  -> commit DB transaction
  -> complete Zeebe job
```

If DB commit succeeds but complete job fails, job may be retried. Idempotency must detect already applied domain operation and return same result.

This is usually safer than completing job before committing domain state.

### 11.2 External Call with Ledger

Pattern:

```text
Worker
  -> create operation ledger REQUESTED
  -> call external system with idempotency key
  -> persist response COMPLETED
  -> complete Zeebe job
```

If external call succeeds but worker crashes before completion, retry should load ledger and complete Zeebe with stored result.

### 11.3 Outbox for Downstream Events

Pattern:

```text
Domain transaction
  -> update aggregate
  -> insert outbox event
  -> commit

Outbox publisher
  -> publish to Kafka/RabbitMQ/API/Camunda message
  -> mark published
```

This prevents domain update and event publishing from diverging.

### 11.4 Camunda Message Adapter from Domain Event

Instead of letting every domain service know Camunda details, use adapter:

```text
Domain Event: ExternalVerificationCompleted
    -> Message Adapter
        -> publish Camunda message ExternalVerificationReceived
           correlationKey = verificationRequestId
```

This isolates Camunda message naming and correlation design from domain core.

---

## 12. Variable Contract Design

### 12.1 Input Contract Example

```java
public final class ApplicationScreeningJobVariables {
    private String applicationId;
    private String caseId;
    private String tenantId;
    private String processBusinessKey;
    private Integer schemaVersion;
}
```

### 12.2 Output Contract Example

```java
public final class ApplicationScreeningJobResult {
    private String riskBand;
    private Boolean requiresExternalVerification;
    private String screeningReference;
    private String screeningCompletedAt;
}
```

### 12.3 Contract Rules

Rules:

1. variables must be minimal;
2. names must be stable;
3. fields must be schema-versioned;
4. nullable fields must be deliberate;
5. date/time should use ISO-8601 string;
6. enum values must be explicit and backward-compatible;
7. sensitive values should be references, not raw values;
8. large payload must live outside Zeebe.

### 12.4 Variable Naming Convention

```text
applicationId
caseId
tenantId
riskBand
requiresExternalVerification
decisionCode
appealWindowEndsAt
externalVerificationRequestId
```

Avoid:

```text
app
data
payload
result
status
info
response
```

Generic names cause long-term confusion.

---

## 13. Error Taxonomy

Production architecture needs one shared error taxonomy.

```text
TECHNICAL_TRANSIENT
    - network timeout
    - 502/503 external API
    - temporary DB connection issue
    - gateway unavailable

TECHNICAL_PERMANENT
    - invalid worker config
    - missing secret
    - unsupported schema version
    - malformed required variable

BUSINESS_REJECTION
    - applicant not eligible
    - required license missing
    - duplicate active application

BUSINESS_ESCALATION
    - high-risk profile
    - conflicting registry result
    - manual review required

SECURITY_REJECTION
    - unauthorized actor
    - tenant mismatch
    - invalid callback signature

DATA_CORRUPTION
    - impossible state transition
    - inconsistent aggregate version
    - broken invariant
```

Mapping:

| Error Type | Worker Action | BPMN Path | Human Action |
|---|---|---|---|
| Technical transient | fail job with retries | stay on same task | none unless exhausted |
| Technical permanent | fail job to incident | incident | platform/support fix |
| Business rejection | throw BPMN error | rejection path | maybe review/notify |
| Business escalation | complete with escalation variable or BPMN error | review/escalation path | officer/senior review |
| Security rejection | incident or BPMN error depending source | security path | security review |
| Data corruption | incident, no retry | incident | engineering/data fix |

---

## 14. User Task and Custom Case UI Architecture

For regulated case systems, Tasklist may be useful for internal workflow, but many systems need custom UI.

### 14.1 Tasklist-First Architecture

```text
Officer uses Camunda Tasklist
    -> opens task
    -> reviews form
    -> completes task
    -> Camunda continues process
```

Good for:

- relatively simple forms;
- standard task inbox;
- lower custom UI needs;
- faster delivery.

### 14.2 Custom Case UI Architecture

```text
Officer uses Case Management UI
    -> domain backend loads case context
    -> backend queries task/search API if needed
    -> backend enforces domain authorization
    -> backend completes task or sends command
    -> Camunda continues process
```

Good for:

- complex case context;
- documents/evidence;
- role-specific workbench;
- maker-checker;
- dynamic assignment;
- regulatory audit;
- custom authorization.

### 14.3 Important Rule

Even if using Tasklist, domain backend should validate final decision.

```text
Do not trust UI visibility as domain authorization.
```

---

## 15. Security Architecture

### 15.1 Machine Clients

Each worker service should have a machine identity scoped to what it needs.

```text
application-worker-client
verification-worker-client
license-worker-client
enforcement-worker-client
connector-runtime-client
cicd-deployer-client
operate-support-client
```

Avoid one “super client” used by every worker.

### 15.2 Secret Management

Secrets:

- Camunda client secret;
- external API credentials;
- database credentials;
- signing keys;
- webhook secrets.

Rules:

- no secrets in BPMN variables;
- no secrets in connector template visible to modelers unless protected;
- no secrets in logs;
- rotate machine credentials;
- separate per environment;
- separate per tenant if isolation requires it.

### 15.3 Tenant Isolation

Worker must validate tenant.

```java
if (!workerTenantAccess.allows(jobTenantId)) {
    throw new SecurityException("Worker is not allowed to process tenant " + jobTenantId);
}
```

Better: prevent routing in platform config and still validate defensively in worker/domain.

### 15.4 Support Access

Operate access must be controlled.

Support user may see:

- process instance key;
- incident message;
- non-sensitive variables;
- process state.

Support user should not casually see:

- PII;
- documents;
- confidential decision notes;
- secrets;
- external API payloads.

This reinforces variable minimization.

---

## 16. Audit Architecture

### 16.1 Audit Sources

Audit should combine:

```text
Domain audit events
    - application submitted
    - officer decision
    - status changed
    - evidence uploaded
    - assignment changed

Workflow audit events
    - process started
    - task created
    - task completed
    - incident raised
    - incident resolved
    - timer fired

Integration audit events
    - external verification requested
    - callback received
    - external result accepted
    - reconciliation performed

Security audit events
    - user accessed case
    - privileged action performed
    - manual override
```

### 16.2 Audit Event Shape

```json
{
  "auditEventId": "AUD-2026-0000001",
  "aggregateType": "APPLICATION",
  "aggregateId": "APP-2026-000123",
  "action": "APPLICATION_APPROVED",
  "actorId": "officer-123",
  "actorType": "USER",
  "tenantId": "agency-a",
  "reasonCode": "ELIGIBLE_AFTER_REVIEW",
  "policyVersion": "POLICY-2026.01",
  "processInstanceKey": "2251799813685249",
  "elementId": "approve_application_task",
  "jobKey": "2251799813687777",
  "traceId": "4f7d...",
  "occurredAt": "2026-06-21T10:15:30+07:00",
  "payloadHash": "sha256:..."
}
```

### 16.3 Tamper Evidence

Possible strategy:

```text
AUDIT_EVENT has hash = sha256(canonical_event_json)
AUDIT_CHAIN has chain_hash = sha256(previous_chain_hash + event_hash)
Periodic anchor exported to immutable storage
```

This is not automatically provided by Camunda. It must be designed.

---

## 17. Observability Architecture

### 17.1 Required Correlation Fields

Every log from worker should include:

```text
traceId
spanId
tenantId
bpmnProcessId
processDefinitionKey
processInstanceKey
elementId
jobType
jobKey
applicationId
caseId
operationId
externalRef
```

Not all fields are always available, but design for them.

### 17.2 Metrics

Worker metrics:

```text
worker_job_started_total{jobType,tenant}
worker_job_completed_total{jobType,tenant}
worker_job_failed_total{jobType,errorType,tenant}
worker_job_duration_seconds{jobType,tenant}
worker_external_call_duration_seconds{system,operation}
worker_idempotency_replay_total{operationType}
worker_bpmn_error_total{errorCode}
```

Platform metrics:

```text
zeebe_backpressure_events
zeebe_partition_leader_health
zeebe_exporter_lag
zeebe_job_activations
zeebe_incidents
secondary_storage_index_latency
```

Business metrics:

```text
application_submitted_total
application_approved_total
application_rejected_total
case_sla_breached_total
case_average_cycle_time
appeal_rate
manual_review_rate
```

### 17.3 Dashboard Layers

```text
Layer 1: Platform Health
    broker, gateway, partition, exporter, storage

Layer 2: Worker Health
    job throughput, latency, error rate, retries

Layer 3: Process Health
    active instances, incidents, timer backlog, task queues

Layer 4: Business Health
    submission rate, approval rate, SLA, bottlenecks
```

A senior engineer does not mix these layers into one confusing dashboard.

---

## 18. Deployment Topology

### 18.1 Self-Managed Kubernetes Topology

```text
Namespace: camunda-orchestration
    zeebe brokers
    zeebe gateways
    operate
    tasklist
    identity/admin
    connectors runtime

Namespace: camunda-management
    console
    web modeler
    management identity

Namespace: business-workers
    application-worker
    verification-worker
    license-worker
    enforcement-worker

Namespace: business-services
    application-domain-service
    case-domain-service
    license-domain-service
    audit-service
    notification-service

Namespace: data
    domain databases
    secondary storage
    message broker if any

Namespace: observability
    logs
    metrics
    traces
    dashboards
```

This can be adapted to organization standards.

### 18.2 Network Flow

```text
Worker -> Camunda Gateway/API
Worker -> Domain Service / DB
Worker -> External API
Domain Service -> Camunda Message Adapter
Camunda Exporter -> Secondary Storage
Operate/Tasklist/Optimize -> Secondary Storage / API
Support User -> Operate
Officer -> Tasklist or Case UI
CI/CD -> Deploy BPMN / deploy workers
```

### 18.3 Ingress Separation

Recommended separation:

```text
Public or restricted UI ingress:
    Tasklist / Operate / Optimize / Modeler if exposed

Internal API ingress:
    Zeebe Gateway / Orchestration Cluster API

External callback ingress:
    callback endpoints, not direct Zeebe API
```

External systems should not publish directly to Zeebe unless carefully controlled. Usually, they call your callback API, then your adapter validates and publishes message.

---

## 19. CI/CD Release Architecture

### 19.1 Artifact Types

Release bundle may include:

```text
BPMN diagrams
DMN decisions
Forms
Worker application image
Domain service image
Connector template/runtime config
Helm values
Database migrations
Dashboard definitions
Alert rules
Runbook updates
```

### 19.2 Deployment Order

Safe deployment order usually:

```text
1. Deploy backward-compatible workers first
2. Deploy domain DB migrations
3. Deploy domain services
4. Deploy BPMN/DMN/forms
5. Enable new process version for new instances
6. Monitor canary instances
7. Gradually route more traffic
8. Keep old workers until old instances finish or migrate
```

For breaking worker contract:

```text
old BPMN -> old job type -> old worker remains
new BPMN -> new job type -> new worker handles
```

### 19.3 Rollback Reality

Rollback is not simply redeploying old BPMN.

Because:

- running instances stay on their deployed version;
- domain DB may have migrated;
- workers may have changed contract;
- external side effects may already happened;
- process variables may changed shape.

A real rollback plan includes:

- stop starting new instances on bad version;
- restore previous worker compatibility;
- resolve/migrate affected instances;
- compensate external operations if needed;
- create incident report;
- update release ledger.

---

## 20. Example End-to-End Flow

### 20.1 Submission

```text
Applicant submits application through Portal
    -> Domain API validates payload
    -> Application DB stores SUBMITTED
    -> Domain audit event written
    -> Outbox event ApplicationSubmitted written
    -> Outbox publisher publishes Camunda message or create instance command
    -> Camunda starts application-assessment-process
```

Important:

- portal does not talk directly to Zeebe;
- domain write happens before process start;
- if process start fails, outbox retries;
- duplicate submit guarded by domain unique key.

### 20.2 Screening

```text
Zeebe creates job application.run-screening.v1
    -> Worker activates job
    -> Worker loads application summary from domain service/DB
    -> Use case calculates screening result
    -> DB stores screening snapshot
    -> Audit event written
    -> Worker completes job with minimal variables:
        riskBand
        requiresExternalVerification
        screeningReference
```

### 20.3 External Verification

```text
Process routes to Request External Verification
    -> Worker creates operation ledger entry
    -> Worker sends external request with idempotency key
    -> Domain DB stores verificationRequestId
    -> Worker completes job with verificationRequestId
    -> Process waits at message catch ExternalVerificationReceived
```

External callback:

```text
External system calls callback API
    -> API verifies signature
    -> stores callback payload/reference
    -> writes audit event
    -> publishes Camunda message:
        name = ExternalVerificationReceived
        correlationKey = verificationRequestId
        variables = { verificationOutcomeRef, verificationStatus }
```

### 20.4 Human Review

```text
Process creates Senior Officer Review user task
    -> Task appears in Tasklist/custom UI eventually
    -> Officer reviews case in Case UI
    -> Domain backend validates authorization
    -> Officer submits decision
    -> Domain service stores decision draft
    -> Task completed with decision variables
```

### 20.5 Approval

```text
Process routes to Approve Application
    -> Worker calls domain service approve(command)
    -> Domain service validates current version/status
    -> DB status APPROVED
    -> audit event APPLICATION_APPROVED
    -> Worker completes job
    -> Process calls Issue License
```

### 20.6 License Issuance

```text
Worker issue license
    -> idempotent license generation
    -> DB license ACTIVE/PENDING_ACTIVATION
    -> audit event LICENSE_ISSUED
    -> notification outbox event
    -> complete job
```

---

## 21. Handling Failure in the Reference Architecture

### 21.1 Worker Crashes After Domain DB Commit

Flow:

```text
Worker updates DB
Worker crashes before completing job
Zeebe job times out
Another worker gets same job
Worker checks domain state / operation ledger
Detects operation already completed
Completes job with stored result
```

This is correct.

### 21.2 External API Succeeds, Worker Times Out

Flow:

```text
External system accepted request
Worker times out before persisting response
Job retried
Worker checks operation ledger
If externalRef known -> replay result
If unknown -> query external system by idempotency key
If cannot determine -> create incident/reconciliation task
```

Do not blindly call external API again without idempotency.

### 21.3 Task Completed by Wrong User

Defense:

```text
Task visibility: Tasklist candidate group
Task completion: backend validates domain authorization
Audit: actor, role, delegated authority, reason
If violation found: security incident + corrective workflow
```

### 21.4 Process Waits Forever for Message

Defense:

```text
Message catch event has boundary timer
Timer routes to escalation/reconciliation
External operation ledger shows pending callback
Support can resend/correlate after validation
```

### 21.5 Operate Shows Stale State

Defense:

```text
Support runbook says check exporter/secondary storage lag
Do not make irreversible business decision only from stale projection
Use domain DB/audit/engine command response as needed
```

---

## 22. Production Runbook Structure

Every serious Camunda 8 system should ship with runbooks.

### 22.1 Incident: Worker Failure

```text
Symptoms:
- incidents rising for jobType X
- worker_job_failed_total increased
- Operate incident message: missing variable / external API failure

Checks:
1. Is worker pod healthy?
2. Is worker connected to gateway?
3. Is job type configured correctly?
4. Is secret/config valid?
5. Is external dependency healthy?
6. Are variables compatible with worker schema?
7. Are retries exhausted?

Actions:
1. Fix config/code/dependency
2. Redeploy worker if needed
3. Retry/resume incidents in controlled batch
4. Monitor error rate
5. Create post-incident note
```

### 22.2 Incident: Message Not Correlated

```text
Checks:
1. Was message published?
2. Was correlationKey correct?
3. Was process already waiting?
4. Did message TTL expire?
5. Was message ID duplicate rejected?
6. Is tenant id correct?
7. Is process version using expected message name?

Actions:
1. Validate callback/audit record
2. Republish message if safe
3. If expired, use repair workflow or operator action
4. Add test to prevent recurrence
```

### 22.3 Incident: SLA Breach

```text
Checks:
1. Was due date calculated correctly?
2. Was timer created?
3. Did task sit in queue?
4. Was assignment group overloaded?
5. Did user complete but projection lag hide it?
6. Was process stuck at external dependency?

Actions:
1. Escalate to correct queue
2. Reassign if policy allows
3. Document reason for breach
4. Update capacity/alerting
```

---

## 23. Architecture Decision Records

Use ADRs for durable engineering reasoning.

Recommended ADRs:

```text
ADR-001: Camunda 8 as orchestration engine, not domain state store
ADR-002: Java workers use idempotency ledger for external side effects
ADR-003: Process variables are minimal references, not full payloads
ADR-004: Custom case UI used for officer workflow, Tasklist used for support/standard tasks
ADR-005: Domain audit is separate immutable journal
ADR-006: Message correlation keys are domain-generated stable identifiers
ADR-007: Job types are versioned
ADR-008: Process deployment uses release bundle governance
ADR-009: Multi-tenancy isolation model
ADR-010: Operate/Tasklist/Optimize are projection surfaces
ADR-011: Backup/DR strategy for Zeebe and secondary storage
ADR-012: Worker deployment topology and scaling model
```

ADR template:

```markdown
# ADR-NNN: Title

## Status
Accepted / Proposed / Deprecated

## Context
What problem are we solving?

## Decision
What did we decide?

## Consequences
Positive and negative consequences.

## Alternatives Considered
What else was considered?

## Operational Impact
How does this affect support, monitoring, incident handling?

## Security/Compliance Impact
What changes for access, audit, data retention, PII?
```

---

## 24. Production Readiness Checklist

### 24.1 Platform

- [ ] Broker topology sized for expected load.
- [ ] Partition count chosen deliberately.
- [ ] Replication factor chosen deliberately.
- [ ] Gateway scaled and monitored.
- [ ] Exporters healthy.
- [ ] Secondary storage sized.
- [ ] Backup/restore tested.
- [ ] Upgrade strategy documented.
- [ ] Namespace/network policy defined.
- [ ] Ingress/TLS configured.

### 24.2 BPMN

- [ ] Process boundary is stable.
- [ ] Job types are versioned where needed.
- [ ] Message names are explicit.
- [ ] Correlation keys are designed.
- [ ] Timers represent business deadlines correctly.
- [ ] Error paths distinguish technical/business/security errors.
- [ ] User tasks have clear assignment model.
- [ ] Variables are minimal.
- [ ] Large payload avoided.
- [ ] Model is readable in Operate.

### 24.3 Workers

- [ ] Worker is idempotent.
- [ ] External side effects use operation ledger.
- [ ] Timeout configured per job type.
- [ ] `maxJobsActive` sized.
- [ ] Graceful shutdown tested.
- [ ] Technical retry policy documented.
- [ ] BPMN error mapping documented.
- [ ] Variable schema validated.
- [ ] Logs include process/job/business correlation.
- [ ] Metrics emitted.
- [ ] Secrets isolated.

### 24.4 Domain

- [ ] Domain DB is source of truth for business state.
- [ ] Aggregate transitions enforce invariants.
- [ ] Domain authorization enforced.
- [ ] Audit events emitted.
- [ ] Outbox used for critical events.
- [ ] Version/optimistic locking used where needed.
- [ ] Reconciliation process exists.

### 24.5 Human Workflow

- [ ] Task assignment model clear.
- [ ] Candidate groups mapped to enterprise roles.
- [ ] Domain authorization checked on completion.
- [ ] Maker-checker rules enforced.
- [ ] Delegation/substitution policy defined.
- [ ] SLA escalation defined.
- [ ] Task completion audited.

### 24.6 Security/Compliance

- [ ] Machine clients least-privileged.
- [ ] Tenant isolation tested.
- [ ] PII minimized in variables/logs.
- [ ] Operate/Tasklist/Optimize access controlled.
- [ ] Audit retention defined.
- [ ] Manual intervention audited.
- [ ] Secret rotation plan exists.
- [ ] External callback signature validation exists.

### 24.7 Operations

- [ ] Dashboards exist for platform/worker/process/business.
- [ ] Alerts mapped to runbooks.
- [ ] Incident triage documented.
- [ ] Message repair procedure documented.
- [ ] Worker failure recovery tested.
- [ ] External system outage scenario tested.
- [ ] DR exercise performed.
- [ ] Release rollback plan documented.

---

## 25. Design Review Questions

Use these questions in architecture review.

### 25.1 Process Boundary

1. Why is this a separate process definition?
2. What business milestone starts it?
3. What business milestone ends it?
4. What changes independently from other processes?
5. What should happen to running instances during new release?

### 25.2 Worker Correctness

1. What happens if this worker runs twice?
2. What happens if external API succeeds but job completion fails?
3. What happens if DB commit succeeds but worker crashes?
4. What is the idempotency key?
5. Where is result replay stored?

### 25.3 Message Correlation

1. Who generates the correlation key?
2. Is it globally unique enough?
3. What happens if message arrives before wait state?
4. What is TTL?
5. What happens if duplicate callback arrives?

### 25.4 Audit

1. Can we prove who made the decision?
2. Can we prove what data they saw?
3. Can we prove which rule/policy version applied?
4. Can we prove whether manual override happened?
5. Can we reconstruct timeline without relying only on Operate UI?

### 25.5 Security

1. Can worker process wrong tenant's job?
2. Can support user see PII unnecessarily?
3. Can user complete task without domain authorization?
4. Can external system spoof callback?
5. Can deployment pipeline start process with privileged client?

---

## 26. Common Architecture Smells

### 26.1 Process Variable as Database

Smell:

```text
Process variable contains entire application JSON and documents.
```

Fix:

```text
Store in domain DB/document store.
Put applicationId/documentRef in Zeebe.
```

### 26.2 One Giant Worker

Smell:

```text
One worker app has all job types, all credentials, all integrations, unbounded thread pool.
```

Fix:

```text
Split by domain/load/security boundary.
Tune per job type.
```

### 26.3 No Operation Ledger

Smell:

```text
Worker calls payment/registry/license API and immediately completes job.
No idempotency record.
```

Fix:

```text
Introduce external_operation ledger with replay/reconciliation.
```

### 26.4 Tasklist as Authorization System

Smell:

```text
If task is visible, user can make decision.
```

Fix:

```text
Task visibility + domain authorization + audit.
```

### 26.5 Operate as Business Reporting System

Smell:

```text
Business KPI is extracted manually from Operate.
```

Fix:

```text
Use Optimize/custom reporting projection with explicit data model.
```

### 26.6 Rollback by Redeploying BPMN

Smell:

```text
Bad release? Just deploy old BPMN.
```

Fix:

```text
Have compatibility, running instance, worker, DB, compensation, and migration plan.
```

---

## 27. End-to-End Architecture Summary

A production-grade Java + Camunda 8 system looks like this:

```text
1. Portal/Case UI handles user interaction.
2. Domain services own business data and invariants.
3. Camunda 8 owns durable orchestration state.
4. Java workers implement job contracts and side-effect execution.
5. Operation ledger protects against duplicate/unknown outcomes.
6. Outbox/message adapter bridges domain events and Camunda messages.
7. Operate supports production troubleshooting.
8. Tasklist or custom UI supports human work.
9. Optimize/custom analytics supports improvement and KPI.
10. Audit service owns regulated defensibility.
11. Observability stack connects process/job/business/external traces.
12. Security model separates human, machine, tenant, support, deployment access.
13. CI/CD releases BPMN, workers, forms, config, migrations, dashboards together.
```

The most important engineering mindset:

```text
Do not ask: “How do I call Camunda from Java?”

Ask:
“How do I design a durable, observable, secure, idempotent, evolvable,
auditable orchestration system where Camunda 8 is one critical control plane?”
```

---

## 28. What This Part Enables

After this part, you should be able to:

- draw an enterprise Camunda 8 architecture;
- explain why Zeebe is not a domain database;
- separate orchestration state from domain state;
- design Java worker boundaries;
- design idempotency and operation ledger;
- design message/callback correlation;
- design audit defensibility;
- review BPMN and worker release compatibility;
- define deployment and observability layers;
- identify architecture smells before production incidents.

This is the difference between “knowing Camunda API” and “engineering an orchestration platform”.

---

## 29. Relation to Previous Parts

This part integrates:

- Part 001: platform architecture;
- Part 002: engine internals;
- Part 003: partitions and ordering;
- Part 004: BPMN runtime semantics;
- Part 005: Java client strategy;
- Part 006: worker construction;
- Part 007: worker correctness;
- Part 008: variable discipline;
- Part 009: BPMN modelling;
- Part 010: instantiation/message design;
- Part 011: error handling;
- Part 012: timers/SLA;
- Part 013/019: human tasks;
- Part 014/015: Spring/worker architecture;
- Part 016: connectors;
- Part 017: exporter/read-side;
- Part 018: Operate support;
- Part 020: Optimize/analytics;
- Part 021/031/032: identity, tenancy, security, compliance;
- Part 022: deployment;
- Part 023: performance;
- Part 024: reliability;
- Part 025: observability;
- Part 026: testing;
- Part 027: versioning;
- Part 028: migration;
- Part 029: saga/compensation;
- Part 030: case management;
- Part 033: anti-patterns.

---

## 30. Next Part

Next file:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-035.md
```

Topic:

```text
Part 035 — Mastery Checklist, Engineering Heuristics, Interview-Level Depth, and Next Roadmap
```

Part 035 is the final part of this series. It will consolidate mastery checklist, senior/staff-level heuristics, review questions, interview-style depth, production checklists, and recommended next advanced roadmap.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-033.md">⬅️ Part 033 — Anti-Patterns, Design Smells, and Production Failure Case Studies</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-035.md">Part 035 — Mastery Checklist, Engineering Heuristics, Interview-Level Depth, and Next Roadmap ➡️</a>
</div>
