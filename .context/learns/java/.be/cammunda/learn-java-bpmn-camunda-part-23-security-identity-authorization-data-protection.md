# learn-java-bpmn-camunda-process-orchestration-engineering

# Part 23 — Security, Identity, Authorization, and Data Protection

> Seri: Java BPMN, Camunda, and Process Orchestration Engineering  
> Target: Java 8 sampai Java 25  
> Level: Advanced / Production / Architecture  
> Fokus: security model untuk workflow engine, process application, human task, job worker, API, process variable, audit, tenancy, dan regulatory-grade defensibility.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun fondasi:

- BPMN sebagai execution contract.
- Camunda 7 vs Camunda 8 runtime model.
- Zeebe, job worker, retry, incident, compensation.
- Process variable governance.
- Human workflow.
- Message correlation.
- Timer, SLA, parallelism, subprocess, saga.
- Testing, observability, dan production operations.

Part ini membahas satu lapisan yang sering terlambat dipikirkan: **security**.

Dalam workflow system, security tidak cukup dipahami sebagai:

```text
user login -> token valid -> boleh akses endpoint
```

Workflow security jauh lebih luas:

```text
siapa boleh memulai process?
siapa boleh melihat task?
siapa boleh claim task?
siapa boleh complete task?
siapa boleh mengubah variable?
siapa boleh retry incident?
siapa boleh cancel process?
siapa boleh migrate process instance?
worker mana boleh mengambil job type tertentu?
service mana boleh publish message?
external event mana yang valid?
operator mana boleh melihat data sensitif?
auditor mana boleh melihat history?
```

Dalam sistem regulatory/case-management, ini makin penting karena keputusan proses bisa memiliki konsekuensi hukum, finansial, dan reputasi.

Part ini bukan mengulang materi Spring Security, OAuth2, OIDC, JWT, Keycloak, atau Jakarta Security yang sudah dipelajari. Kita akan memakai semua itu sebagai prasyarat dan mengarahkannya ke masalah khusus BPMN/Camunda.

---

## 1. Mental Model: Workflow Security Berbeda dari API Security Biasa

API security biasanya bertanya:

```text
Apakah caller boleh memanggil endpoint ini?
```

Workflow security bertanya:

```text
Apakah caller boleh melakukan aksi ini
pada proses ini
pada tahap ini
untuk case ini
dengan role ini
berdasarkan ownership ini
pada waktu ini
berdasarkan delegasi ini
berdasarkan tenant ini
berdasarkan status domain ini?
```

Contoh sederhana.

Endpoint:

```http
POST /tasks/{taskId}/complete
```

API-level check yang terlalu dangkal:

```text
user has ROLE_OFFICER
```

Security workflow yang benar harus mengecek minimal:

```text
- task masih aktif?
- task memang visible untuk user ini?
- user ini assignee/candidate/authorized actor?
- task ini milik case yang boleh dia akses?
- user ini tidak sama dengan maker sebelumnya jika checker step?
- user ini masih dalam group/unit yang valid?
- delegation masih aktif?
- tenant cocok?
- process definition cocok?
- task definition key cocok?
- action yang diminta cocok dengan allowed transition?
- submitted form fields boleh diedit user ini?
- business object belum berubah state oleh pihak lain?
```

Top 1% engineer tidak melihat workflow task sebagai “row yang bisa di-complete”, tetapi sebagai **authority-sensitive business action**.

---

## 2. Threat Surface dalam Workflow System

Workflow system memiliki attack surface yang lebih luas daripada service CRUD biasa.

### 2.1 Platform surface

Contoh:

- Camunda API.
- Operate.
- Tasklist.
- Admin/Identity.
- Zeebe Gateway.
- Management/Actuator endpoints.
- Exporter/search store.
- Elasticsearch/OpenSearch.
- Kubernetes secrets.
- Helm values.
- Ingress/API gateway.

Risiko:

- unauthorized process start.
- unauthorized task completion.
- unauthorized variable update.
- unauthorized incident retry.
- unauthorized process cancellation.
- data leakage from Operate/Tasklist.
- admin privilege abuse.

### 2.2 Process application surface

Contoh:

- Spring Boot worker service.
- task backend API.
- process start API.
- message correlation API.
- document upload API.
- external webhook listener.
- scheduled reconciliation job.

Risiko:

- bypass task assignment.
- forged message correlation.
- replayed webhook.
- worker credential leakage.
- external event injection.
- variable tampering.
- privilege escalation through process variables.

### 2.3 BPMN model surface

BPMN model sendiri bisa menjadi security liability.

Contoh:

```text
User Task: Approve License
Candidate Group: officers
```

Tampak benar, tetapi belum cukup jika:

- semua officer bisa melihat semua case.
- maker bisa approve sendiri.
- officer dari tenant lain bisa claim task.
- reassignment tidak diaudit.
- task form menampilkan PII tidak perlu.
- BPMN expression memakai variable yang bisa dimanipulasi caller.

Security bukan hanya di code; security juga ada di **model design**.

---

## 3. Security Boundary: Engine, Application, Domain, and UI

Dalam Camunda-based architecture, security harus dipisah menjadi beberapa boundary.

```text
[User Browser]
    |
    v
[Frontend / Task UI]
    |
    v
[Application Backend]
    |
    |-- authorize business action
    |-- validate task ownership
    |-- validate domain state
    |-- persist audit
    |-- complete Camunda task/job/message
    v
[Camunda Orchestration Cluster]
    |
    |-- process state
    |-- task state
    |-- variable state
    |-- incident state
    v
[Domain Database]
```

Prinsip penting:

> Jangan menyerahkan seluruh business authorization ke workflow engine saja.

Engine tahu process/task/variable. Domain service tahu business ownership, organization hierarchy, maker-checker rule, conflict of interest, delegation, case secrecy, dan legal constraints.

Keduanya harus bekerja bersama.

---

## 4. Authentication vs Authorization dalam Camunda Context

### 4.1 Authentication

Authentication menjawab:

```text
Siapa caller ini?
```

Bentuk umum:

- username/password.
- OIDC login.
- OAuth2 client credentials.
- JWT bearer token.
- mTLS identity.
- service account.

Dalam Camunda 8, Orchestration Cluster REST API authentication menetapkan siapa caller API, sementara authorization menentukan apa yang boleh dilakukan caller berdasarkan konfigurasi authorization.

### 4.2 Authorization

Authorization menjawab:

```text
Apa yang boleh caller lakukan?
```

Dalam workflow, authorization harus memutuskan aksi seperti:

- deploy process.
- start process.
- cancel process instance.
- read process instance.
- read variable.
- update variable.
- read user task.
- assign user task.
- complete user task.
- resolve incident.
- view Operate.
- access Tasklist.
- manage tenants.

### 4.3 Authentication is not business authorization

Token valid tidak berarti action valid.

Contoh salah:

```java
@PostMapping("/tasks/{taskId}/complete")
public void complete(@PathVariable String taskId, @AuthenticationPrincipal User user) {
    camundaTaskClient.complete(taskId);
}
```

Masalah:

- user hanya authenticated.
- belum dicek task visibility.
- belum dicek assignment.
- belum dicek case ownership.
- belum dicek maker-checker.
- belum dicek tenant.
- belum dicek field-level permission.

Versi yang lebih benar:

```java
@PostMapping("/tasks/{taskId}/complete")
public void complete(
        @PathVariable String taskId,
        @RequestBody CompleteTaskRequest request,
        @AuthenticationPrincipal AuthenticatedUser user
) {
    TaskContext task = taskQueryService.loadActiveTask(taskId);
    CaseRecord caseRecord = caseService.loadCase(task.caseId());

    taskAuthorizationService.assertCanComplete(user, task, caseRecord, request.action());
    taskFormPolicyService.assertAllowedFields(user, task, request.formData());
    domainTransitionService.assertTransitionAllowed(caseRecord, task, request.action());

    taskCompletionService.completeTask(user, task, request);
}
```

---

## 5. Identity Types dalam Workflow System

Workflow system biasanya memiliki lebih dari satu jenis identity.

### 5.1 Human user identity

Contoh:

- officer.
- supervisor.
- approver.
- applicant.
- external agency user.
- system admin.
- auditor.

Biasanya berasal dari:

- enterprise IdP.
- Keycloak.
- Azure AD / Entra ID.
- Okta.
- LDAP/AD.
- Singpass/Corppass-like identity provider.

Security concern:

- role mapping.
- group mapping.
- organization unit.
- tenant.
- delegation.
- session expiry.
- revocation.
- step-up authentication untuk action sensitif.

### 5.2 Service identity

Contoh:

- worker service.
- task backend service.
- integration connector.
- scheduler.
- reconciliation job.
- event consumer.

Biasanya memakai:

- OAuth2 client credentials.
- Kubernetes service account.
- mTLS certificate.
- API key.
- workload identity.

Security concern:

- least privilege.
- credential rotation.
- no shared super-client.
- job type restriction.
- tenant restriction.
- audit service action.

### 5.3 System actor identity

Tidak semua aksi dilakukan manusia.

Contoh:

```text
System auto-escalated task after SLA breach.
System auto-cancelled application after no response.
System retried notification delivery.
System imported agency response.
```

Audit harus membedakan:

```text
actorType = HUMAN | SERVICE | SYSTEM | ADMIN | MIGRATION | REPAIR
```

Jangan mencatat semua sebagai `SYSTEM`, karena itu menghancurkan forensic traceability.

---

## 6. Role-Based Access Control, Attribute-Based Access Control, and Policy-Based Access Control

### 6.1 RBAC

RBAC cocok untuk permission coarse-grained.

Contoh:

```text
ROLE_OFFICER
ROLE_SUPERVISOR
ROLE_ADMIN
ROLE_AUDITOR
ROLE_CASE_MANAGER
```

Kelebihan:

- mudah dipahami.
- mudah dikonfigurasi.
- cocok untuk platform permission.

Kelemahan:

- tidak cukup untuk case-level access.
- tidak menangani ownership.
- tidak menangani maker-checker.
- tidak menangani dynamic assignment.

### 6.2 ABAC

ABAC memakai atribut.

Contoh:

```text
user.department == case.department
user.grade >= requiredGrade
user.tenant == case.tenant
user.region in case.allowedRegions
user.id != case.createdBy
```

ABAC lebih cocok untuk workflow regulatory.

### 6.3 PBAC / policy engine

Untuk policy kompleks, authorization bisa diekspresikan sebagai policy.

Contoh:

```text
allow complete_task if
  user.active == true
  and task.state == ACTIVE
  and task.candidateGroups intersects user.groups
  and case.tenant == user.tenant
  and not is_same_maker_checker(user, case)
  and action in allowedActions(task.definitionKey, user.role)
```

Policy bisa berada di:

- application code.
- DMN decision.
- external policy engine.
- database rule table.

Top 1% judgement:

- Platform authorization melindungi Camunda resource.
- Application/domain authorization melindungi business action.
- Jangan mencampur semuanya ke BPMN gateway.

---

## 7. Camunda Platform Authorization Layer

Camunda 8 memiliki Orchestration Cluster authorization untuk mengontrol akses ke web components dan APIs seperti Zeebe, Admin, Operate, Tasklist, dan Orchestration Cluster APIs. Authorization ini berbeda dari authorization service lain seperti Web Modeler atau Optimize.

Secara mental model:

```text
Camunda authorization = boleh melakukan operasi terhadap resource Camunda
Domain authorization  = boleh melakukan aksi bisnis terhadap case/domain object
```

Contoh Camunda-level permission:

```text
- ACCESS Tasklist
- READ_USER_TASK for process definition
- UPDATE_USER_TASK
- READ_PROCESS_INSTANCE
- CANCEL_PROCESS_INSTANCE
- UPDATE_PROCESS_INSTANCE
- READ_DECISION_DEFINITION
```

Contoh domain-level permission:

```text
- boleh review application dari agency ini
- boleh approve jika bukan maker
- boleh view document sensitif
- boleh override decision karena role supervisor
- boleh reopen case dalam 14 hari
```

Keduanya harus ada.

---

## 8. Tasklist Authorization vs Custom Task UI Authorization

Ada dua pendekatan umum.

### 8.1 Menggunakan Camunda Tasklist langsung

Kelebihan:

- cepat.
- native integration.
- cocok untuk internal operations.
- lebih sedikit custom UI.

Kekurangan:

- business-specific UX mungkin terbatas.
- domain authorization sering tetap perlu external enforcement.
- field-level permission dan complex form behavior bisa sulit.

### 8.2 Custom Task UI di atas backend sendiri

Kelebihan:

- bisa enforce domain authorization penuh.
- bisa integrate dengan case screen.
- bisa field-level masking.
- bisa maker-checker dan delegation advanced.
- bisa audit custom.

Kekurangan:

- lebih banyak code.
- harus sync task state.
- harus handle stale task.
- harus hati-hati terhadap bypass Camunda API.

Pattern yang sering paling aman untuk enterprise/regulatory:

```text
User Browser
  -> Custom Task UI
  -> Application Backend Authorization
  -> Domain DB + Camunda Task API
```

Jangan expose Camunda task completion API langsung ke browser kecuali benar-benar memahami security boundary-nya.

---

## 9. User Task Security Model

User task security harus menjawab beberapa pertanyaan.

### 9.1 Visibility

```text
Siapa boleh melihat task ini?
```

Bisa berdasarkan:

- assignee.
- candidate group.
- candidate user.
- role.
- organization unit.
- tenant.
- case sensitivity.
- assignment pool.
- delegation.

### 9.2 Claimability

```text
Siapa boleh claim task ini?
```

Claim tidak sama dengan view.

Contoh:

```text
User boleh lihat queue task unitnya,
tapi hanya supervisor boleh claim urgent escalation task.
```

### 9.3 Completion authority

```text
Siapa boleh complete task ini?
```

Completion harus mengecek:

- task active.
- user is assigned/candidate.
- action allowed.
- domain state valid.
- submitted form valid.
- task not stale.
- user not disqualified.

### 9.4 Field-level authority

```text
Field mana yang boleh diedit user ini?
```

Contoh:

```text
Officer boleh mengisi assessmentNotes.
Supervisor boleh mengisi approvalDecision.
Applicant boleh mengisi resubmissionComment.
Auditor hanya read-only.
```

### 9.5 Decision authority

```text
Keputusan apa yang boleh dipilih user?
```

Contoh:

```text
Officer: recommend approve / recommend reject.
Supervisor: approve / reject / return for clarification.
Director: override / escalate / defer.
```

Ini bukan hanya UI concern. Backend harus enforce.

---

## 10. Maker-Checker and Four-Eyes Principle

Maker-checker adalah pattern penting dalam regulatory workflow.

Prinsip:

```text
Orang yang membuat/menyiapkan keputusan tidak boleh menjadi orang yang menyetujui keputusan final.
```

Naive BPMN:

```text
Prepare Assessment -> Approve Assessment
```

Security gap:

- task kedua bisa di-claim oleh user yang sama.

Harus ada domain authorization:

```java
if (user.id().equals(caseRecord.preparedBy())) {
    throw new ForbiddenException("Maker cannot approve own assessment");
}
```

Namun rule ini sebaiknya tidak tersebar di controller. Buat policy service:

```java
public final class MakerCheckerPolicy {

    public void assertCheckerAllowed(UserPrincipal user, CaseRecord caseRecord, TaskContext task) {
        if (caseRecord.lastPreparedBy().equals(user.userId())) {
            throw new AuthorizationDenied("Maker cannot check own work");
        }

        if (!user.hasAnyGroup(caseRecord.allowedCheckerGroups())) {
            throw new AuthorizationDenied("User is not in allowed checker group");
        }

        if (!user.tenantId().equals(caseRecord.tenantId())) {
            throw new AuthorizationDenied("Tenant mismatch");
        }
    }
}
```

Audit event:

```json
{
  "eventType": "TASK_COMPLETION_DENIED",
  "reason": "MAKER_CHECKER_VIOLATION",
  "taskDefinitionKey": "ApproveAssessment",
  "caseId": "CASE-2026-0001",
  "userId": "u12345",
  "preparedBy": "u12345",
  "timestamp": "2026-06-17T10:15:30Z"
}
```

Top 1% detail: denied action juga perlu audit, terutama untuk privileged actions.

---

## 11. Delegation, Substitution, and Reassignment

Workflow manusia jarang statis. Orang cuti, pindah unit, resign, atau conflict-of-interest.

Security model harus mendukung:

- delegation.
- substitution.
- reassignment.
- escalation assignment.
- supervisor override.
- temporary authorization.

### 11.1 Delegation table

Contoh data model:

```sql
CREATE TABLE task_delegation (
    delegation_id      VARCHAR(64) PRIMARY KEY,
    delegator_user_id  VARCHAR(64) NOT NULL,
    delegate_user_id   VARCHAR(64) NOT NULL,
    tenant_id          VARCHAR(64) NOT NULL,
    scope_type         VARCHAR(64) NOT NULL,
    scope_value        VARCHAR(128),
    valid_from         TIMESTAMP NOT NULL,
    valid_until        TIMESTAMP NOT NULL,
    reason             VARCHAR(512),
    approved_by        VARCHAR(64),
    status             VARCHAR(32) NOT NULL,
    created_at         TIMESTAMP NOT NULL
);
```

### 11.2 Delegation policy

```text
Delegate can act only if:
- delegation active
- scope matches task/case
- tenant matches
- action allowed by delegation type
- not blocked by conflict-of-interest rule
```

### 11.3 Reassignment audit

Every reassignment should capture:

```text
fromAssignee
toAssignee
performedBy
reason
source: manual / escalation / system / admin repair
time
caseId
taskId
processInstanceKey
```

Avoid silent reassignment.

---

## 12. Worker Security

Job workers are powerful. They execute side effects.

A compromised worker can:

- complete jobs incorrectly.
- publish messages.
- call external APIs.
- leak variables.
- create documents.
- send emails.
- issue approvals if process is poorly designed.

### 12.1 Worker identity

Each worker service should have its own service identity.

Bad:

```text
all services use CAMUNDA_SUPER_CLIENT
```

Better:

```text
worker-notification-service-client
worker-document-service-client
worker-payment-service-client
worker-case-routing-client
worker-agency-integration-client
```

### 12.2 Least privilege

A worker should only have permissions needed for its function.

Example:

```text
notification worker:
- activate jobs of type send-email
- complete/fail jobs of type send-email
- maybe read limited variables
- no process cancellation
- no admin operations
```

Even if Camunda permission model does not map perfectly to job type granularity in every deployment setup, design your application architecture as if this boundary matters:

- separate service accounts.
- separate network policies.
- separate secrets.
- separate deployment.
- separate logs.
- separate alerting.

### 12.3 Worker must not trust process variables blindly

Process variables can be influenced by previous tasks, messages, or external events. Worker must validate critical inputs.

Bad:

```java
String recipient = variables.get("email").asText();
emailClient.send(recipient, subject, body);
```

Better:

```java
CaseRecord caseRecord = caseRepository.getById(caseId);
EmailRecipient recipient = notificationPolicy.resolveRecipient(caseRecord, notificationType);
notificationPolicy.assertAllowed(notificationType, recipient, caseRecord);
emailClient.send(recipient.address(), subject, body);
```

Critical rule:

> Process variables can coordinate flow, but domain database and policy service should be source of truth for sensitive business actions.

---

## 13. API Security for Process Start

Starting a process is a business action.

Examples:

```http
POST /applications/{id}/submit
POST /cases/{id}/initiate-investigation
POST /appeals/{id}/start
POST /licenses/{id}/renew
```

Security checks:

```text
- caller authenticated
- caller may start this process type
- domain object exists
- domain object in startable state
- caller owns/has access to object
- tenant matches
- duplicate start prevented
- idempotency key enforced
- submitted data valid
- audit event recorded
```

### 13.1 Process start idempotency

Bad:

```java
camundaClient.newCreateInstanceCommand()
    .bpmnProcessId("license-application")
    .latestVersion()
    .variables(vars)
    .send();
```

If user double-clicks submit, you may create duplicate process instances.

Better:

```sql
CREATE TABLE process_start_registry (
    business_object_type VARCHAR(64) NOT NULL,
    business_object_id   VARCHAR(128) NOT NULL,
    process_type         VARCHAR(128) NOT NULL,
    process_instance_key VARCHAR(128),
    status               VARCHAR(32) NOT NULL,
    created_by           VARCHAR(64) NOT NULL,
    created_at           TIMESTAMP NOT NULL,
    PRIMARY KEY (business_object_type, business_object_id, process_type)
);
```

Flow:

```text
1. authorize user
2. insert process_start_registry row
3. start Camunda process
4. update process_instance_key
5. if duplicate request, return existing process state
```

---

## 14. API Security for Message Correlation

Message correlation is dangerous if treated as a simple endpoint.

Example:

```http
POST /webhooks/payment-confirmed
```

Risk:

- forged payment confirmation.
- replayed payment confirmation.
- wrong correlation key.
- event for another tenant.
- stale event after cancellation.
- duplicate event creates inconsistent side effects.

Security checks:

```text
- verify sender identity
- verify signature
- verify timestamp freshness
- verify nonce/event id not used
- validate tenant/merchant/system mapping
- verify payload schema
- verify business object exists
- verify event belongs to expected case
- persist inbound event before correlation
- deduplicate event id
- correlate only through controlled router
```

### 14.1 Inbound event security table

```sql
CREATE TABLE inbound_event_security_log (
    event_id              VARCHAR(128) PRIMARY KEY,
    source_system         VARCHAR(64) NOT NULL,
    event_type            VARCHAR(128) NOT NULL,
    correlation_key       VARCHAR(256) NOT NULL,
    tenant_id             VARCHAR(64),
    signature_valid       BOOLEAN NOT NULL,
    replay_detected       BOOLEAN NOT NULL,
    payload_hash          VARCHAR(128) NOT NULL,
    received_at           TIMESTAMP NOT NULL,
    processed_at          TIMESTAMP,
    processing_status     VARCHAR(32) NOT NULL,
    rejection_reason      VARCHAR(512)
);
```

Do not correlate directly before recording enough forensic data.

---

## 15. Process Variable Security

Process variables are convenient but risky.

### 15.1 Risks

- PII leakage in Operate/Tasklist/exporter/search store.
- secrets accidentally stored as variables.
- large payload creates performance issue.
- stale data creates incorrect decision.
- attacker-controlled variable influences gateway.
- variable used as authorization source.
- variable repair changes business meaning without audit.

### 15.2 Sensitive data rule

Do not store secrets in process variables.

Avoid storing:

```text
password
access token
refresh token
private key
API key
full NRIC/passport number
full bank account number
medical details
unmasked document content
large form payload
binary documents
```

Prefer:

```json
{
  "caseId": "CASE-2026-0001",
  "applicantRef": "APP-93821",
  "documentSetId": "DOCSET-221",
  "decisionSnapshotId": "DECISION-778",
  "riskBand": "MEDIUM",
  "requiresSupervisorReview": true
}
```

### 15.3 Reference over payload

Bad:

```json
{
  "applicantName": "...",
  "passportNumber": "...",
  "address": "...",
  "uploadedDocuments": [ ... huge base64 ... ]
}
```

Better:

```json
{
  "caseId": "CASE-2026-0001",
  "applicantId": "APP-123",
  "documentBundleId": "BUNDLE-456",
  "riskScore": 72,
  "route": "SUPERVISOR_REVIEW"
}
```

### 15.4 Variable masking in logs

Never log raw variables wholesale.

Bad:

```java
log.info("Completing job {} with variables {}", job.getKey(), job.getVariables());
```

Better:

```java
log.info("Completing job. processInstanceKey={}, elementId={}, caseId={}, variableKeys={}",
    job.getProcessInstanceKey(),
    job.getElementId(),
    vars.caseId(),
    vars.keys());
```

If you need diagnostics, use safe snapshot:

```java
public Map<String, Object> toSafeDiagnostic(ProcessVars vars) {
    return Map.of(
        "caseId", vars.caseId(),
        "applicationType", vars.applicationType(),
        "riskBand", vars.riskBand(),
        "hasApplicantId", vars.applicantId() != null
    );
}
```

---

## 16. Secrets Management

Secrets should live in a secret manager, not BPMN XML, not process variables, not environment dump logs.

Options:

- Kubernetes Secret.
- AWS Secrets Manager.
- AWS SSM Parameter Store.
- HashiCorp Vault.
- Azure Key Vault.
- GCP Secret Manager.
- Camunda secrets for connectors where applicable.

### 16.1 Bad BPMN connector config

```text
Authorization: Bearer eyJhbGciOi...
```

### 16.2 Better connector config

```text
Authorization: Bearer {{secrets.EXTERNAL_API_TOKEN}}
```

### 16.3 Worker secret rule

Worker should:

- read secret at startup or via managed provider.
- avoid printing it.
- support rotation.
- fail closed if missing.
- expose readiness=false if required credential unavailable.

---

## 17. Multi-tenancy Security

Multi-tenancy means one platform serves multiple logical tenants.

Tenant could mean:

- agency.
- department.
- customer.
- region.
- business unit.
- legal entity.

Camunda 8 multi-tenancy relies on tenant identifiers in a shared installation; isolation is logical, with tenant identifiers attached to data entries such as process definitions, process instances, jobs, and related resources.

### 17.1 Tenant security principle

Every process action must have tenant context.

```text
process start -> tenantId
job activation -> tenant context
message correlation -> tenant context
user task query -> tenant filter
operate access -> tenant authorization
analytics -> tenant filter
external API call -> tenant-specific credential/config
```

### 17.2 Tenant mismatch example

```text
User tenant: AGENCY_A
Case tenant: AGENCY_B
Task tenant: AGENCY_B
```

Even if user has `ROLE_OFFICER`, action must be denied.

### 17.3 Tenant-aware idempotency

Bad key:

```text
applicationId = 12345
```

Better key:

```text
tenantId + applicationId + processType
```

### 17.4 Tenant-aware message correlation

Bad:

```text
correlationKey = paymentReference
```

Better:

```text
correlationKey = tenantId + ':' + paymentReference
```

Or use separate explicit tenant field if platform supports it in the API/design.

---

## 18. Data Protection and Privacy

Workflow engines are tempting places to put process data. Resist that temptation.

### 18.1 Data minimization

Store only what process execution needs.

Question every variable:

```text
Does the engine need this to route/wait/correlate/decide?
Or is this just convenient for debugging/UI?
```

If debugging/UI only, consider domain DB/read model instead.

### 18.2 Purpose limitation

If variable is collected for process routing, do not reuse it for unrelated analytics without governance.

### 18.3 Retention

Define retention for:

- process history.
- task history.
- variable history.
- audit events.
- exported records.
- Operate/search store.
- application logs.
- distributed traces.

### 18.4 Right to correction vs audit integrity

In regulatory systems, you often cannot simply delete all traces because audit records must remain defensible.

Pattern:

```text
immutable audit record + corrected current record + legal retention policy
```

### 18.5 Redaction strategy

For sensitive fields:

- mask in UI.
- hash for correlation if exact value not needed.
- tokenize if reversible access needed.
- store encrypted in domain DB.
- do not copy into process variable.

---

## 19. Audit Security

Audit logs are themselves sensitive.

They may reveal:

- who handled a case.
- case existence.
- applicant identity.
- decision outcome.
- internal reasoning.
- security denial events.
- repair actions.

### 19.1 Audit event model

```json
{
  "auditId": "AUD-2026-000001",
  "eventType": "TASK_COMPLETED",
  "actorType": "HUMAN",
  "actorId": "u12345",
  "tenantId": "agency-a",
  "caseId": "CASE-2026-0001",
  "processDefinitionId": "license-application",
  "processInstanceKey": "2251799813685251",
  "elementId": "ApproveApplication",
  "taskId": "task-789",
  "action": "APPROVE",
  "reasonCode": "MEETS_REQUIREMENTS",
  "beforeState": "PENDING_APPROVAL",
  "afterState": "APPROVED",
  "timestamp": "2026-06-17T10:15:30Z",
  "ipAddress": "10.0.8.15",
  "userAgentHash": "...",
  "correlationId": "corr-abc"
}
```

### 19.2 Audit immutability

Audit should be append-only.

Avoid:

```sql
UPDATE audit_log SET action = 'APPROVE' WHERE audit_id = ...
```

Prefer correction event:

```json
{
  "eventType": "AUDIT_CORRECTION",
  "targetAuditId": "AUD-2026-000001",
  "correctionReason": "Wrong reason code captured",
  "correctedBy": "admin-001",
  "approvedBy": "security-officer-002"
}
```

### 19.3 Repair audit

Every production repair should include:

```text
- incident id
- process instance key
- case id
- repair action
- before value
- after value
- reason
- approver
- operator
- timestamp
- ticket id
```

---

## 20. Privileged Operations Security

Privileged workflow operations include:

- cancel process instance.
- modify process instance.
- migrate process instance.
- update variable.
- resolve incident.
- increase retries.
- reassign task.
- deploy process.
- delete/export data.
- change tenant permission.

These need stronger controls than normal user actions.

### 20.1 Control model

```text
Normal action:
  authenticated user + business authorization

Privileged action:
  authenticated operator + privileged role + reason + ticket + approval + audit + sometimes dual control
```

### 20.2 Break-glass access

Break-glass should be:

- time-limited.
- approved.
- heavily logged.
- reviewed after use.
- not shared.
- separated from daily admin account.

### 20.3 Production repair service

Do not let operators run arbitrary SQL or arbitrary Camunda commands casually.

Better:

```text
approved repair API / runbook command
  -> validates allowed repair types
  -> captures reason/ticket
  -> records before/after snapshot
  -> executes Camunda operation
  -> emits audit event
```

---

## 21. Security for Process Deployment

Process deployment is code deployment.

A malicious or broken BPMN deployment can:

- bypass approval.
- skip maker-checker.
- route to wrong group.
- expose variables.
- call wrong connector.
- disable escalation.
- create infinite loops.
- produce unauthorized decisions.

### 21.1 Deployment controls

Require:

- code review.
- BPMN review.
- security review for sensitive processes.
- automated model validation.
- environment separation.
- artifact signing/checksum.
- CI/CD audit.
- rollback/migration plan.

### 21.2 BPMN security review checklist

For every user task:

```text
- who can see it?
- who can claim it?
- who can complete it?
- what form fields are exposed?
- what sensitive data is displayed?
- what action options exist?
- is maker-checker enforced?
```

For every service task:

```text
- which worker executes it?
- what credential does it use?
- what side effect can it perform?
- is it idempotent?
- what variables does it read/write?
```

For every message event:

```text
- who can publish/correlate this message?
- is event authenticated?
- is replay prevented?
- is tenant checked?
```

For every gateway:

```text
- can input variable be manipulated?
- is routing based on trusted source?
```

---

## 22. Authorization Architecture in Java

A production process application should not scatter authorization logic everywhere.

### 22.1 Suggested modules

```text
com.example.workflow.security
  AuthenticatedUser
  ServicePrincipal
  TenantContext
  Permission
  PolicyDecision

com.example.workflow.authorization
  TaskAuthorizationService
  ProcessStartAuthorizationService
  MessageCorrelationAuthorizationService
  IncidentRepairAuthorizationService
  FieldAccessPolicyService

com.example.workflow.audit
  AuditEvent
  AuditWriter
  AuditActorResolver

com.example.workflow.task
  TaskQueryService
  TaskCompletionService
  TaskCommandController
```

### 22.2 Authorization result object

Avoid boolean-only checks.

```java
public record AuthorizationDecision(
    boolean allowed,
    String reasonCode,
    String explanation,
    Map<String, Object> context
) {
    public static AuthorizationDecision allow() {
        return new AuthorizationDecision(true, "ALLOWED", "Allowed", Map.of());
    }

    public static AuthorizationDecision deny(String code, String explanation) {
        return new AuthorizationDecision(false, code, explanation, Map.of());
    }
}
```

### 22.3 Policy service

```java
public final class TaskAuthorizationService {

    public AuthorizationDecision canComplete(
            AuthenticatedUser user,
            TaskContext task,
            CaseRecord caseRecord,
            TaskAction action
    ) {
        if (!user.isActive()) {
            return AuthorizationDecision.deny("USER_INACTIVE", "User is inactive");
        }

        if (!user.tenantId().equals(caseRecord.tenantId())) {
            return AuthorizationDecision.deny("TENANT_MISMATCH", "User tenant does not match case tenant");
        }

        if (!task.isActive()) {
            return AuthorizationDecision.deny("TASK_NOT_ACTIVE", "Task is no longer active");
        }

        if (!task.canBeCompletedBy(user)) {
            return AuthorizationDecision.deny("TASK_NOT_ASSIGNED", "User is not allowed to complete this task");
        }

        if (task.requiresChecker() && caseRecord.wasPreparedBy(user.userId())) {
            return AuthorizationDecision.deny("MAKER_CHECKER_VIOLATION", "Maker cannot approve own work");
        }

        if (!task.allowedActionsFor(user).contains(action)) {
            return AuthorizationDecision.deny("ACTION_NOT_ALLOWED", "Action is not allowed for this user");
        }

        return AuthorizationDecision.allow();
    }
}
```

### 22.4 Enforce and audit denial

```java
AuthorizationDecision decision = authorizationService.canComplete(user, task, caseRecord, request.action());

if (!decision.allowed()) {
    auditWriter.write(AuditEvent.taskCompletionDenied(user, task, caseRecord, decision));
    throw new ForbiddenException(decision.reasonCode());
}
```

---

## 23. Secure Task Completion Flow

Recommended flow:

```text
1. Receive task completion request
2. Authenticate user
3. Load task from Camunda/read model
4. Load domain case
5. Check task active/stale
6. Check tenant
7. Check assignment/candidate/delegation
8. Check maker-checker/conflict-of-interest
9. Validate action
10. Validate form fields
11. Persist domain decision/audit in local DB
12. Complete task in Camunda
13. Emit post-completion domain event/outbox
14. Return result
```

### 23.1 Transaction problem

Local DB update and Camunda task completion are not one ACID transaction in Camunda 8.

Pattern:

```text
local transaction:
  - persist decision command
  - persist audit
  - persist outbox command: COMPLETE_CAMUNDA_TASK

outbox worker:
  - complete Camunda task idempotently
  - mark outbox sent
```

Or if doing direct completion, design for reconciliation:

```text
If DB success but Camunda completion fails -> retry completion.
If Camunda success but DB response fails -> client retries and receives already completed state.
```

---

## 24. Secure Incident Repair Flow

Incident repair has high risk because it changes stuck process state.

Recommended flow:

```text
1. Operator identifies incident
2. Runbook classifies incident
3. Operator proposes repair action
4. System validates allowed repair type
5. Approver approves if required
6. System captures before snapshot
7. System executes repair
8. System captures after snapshot
9. System writes immutable repair audit
10. System links repair to ticket/post-incident review
```

### 24.1 Repair action types

```text
- increase retries
- update variable
- publish missing message
- cancel duplicate process
- migrate process instance
- modify process instance
- reassign task
```

### 24.2 Repair anti-pattern

Bad:

```text
Admin opens Operate and changes variable without ticket/reason/audit.
```

Better:

```text
Repair request: CHANGE_VARIABLE
caseId: CASE-2026-0001
processInstanceKey: ...
variable: agencyResponseStatus
before: null
after: RECEIVED
reason: missed external message due to upstream outage
ticket: INC-2026-0901
approvedBy: ops-lead
```

---

## 25. Secure External Integration

External systems are major trust boundaries.

### 25.1 Outbound API call security

Worker calling external API must handle:

- credential storage.
- TLS validation.
- endpoint allowlist.
- request signing if needed.
- idempotency key.
- timeout.
- retry.
- response validation.
- sensitive response minimization.

### 25.2 Inbound webhook security

Webhook listener must handle:

- signature verification.
- timestamp tolerance.
- replay prevention.
- event ID dedup.
- source system allowlist.
- schema validation.
- tenant mapping.
- correlation authorization.

### 25.3 Do not expose Camunda correlation directly

Bad:

```text
External system -> Camunda API directly
```

Usually better:

```text
External system
  -> Integration API
  -> verify/authenticate/dedup/audit
  -> publish message to Camunda
```

---

## 26. Secure Logging and Tracing

Logs and traces can leak secrets and PII.

### 26.1 Never log

```text
access tokens
refresh tokens
passwords
private keys
API keys
full request body with PII
full process variables
full document content
authorization headers
cookie values
```

### 26.2 Log useful safe context

```text
correlationId
caseId
processInstanceKey
elementId
taskDefinitionKey
jobType
tenantId
actorId hash or internal ID
reasonCode
errorClass
```

### 26.3 MDC example

```java
try (MDC.MDCCloseable ignored1 = MDC.putCloseable("caseId", vars.caseId());
     MDC.MDCCloseable ignored2 = MDC.putCloseable("processInstanceKey", String.valueOf(job.getProcessInstanceKey()));
     MDC.MDCCloseable ignored3 = MDC.putCloseable("elementId", job.getElementId())) {

    handler.handle(job);
}
```

### 26.4 Trace baggage warning

Do not put PII in trace baggage. It propagates widely.

---

## 27. Data-at-Rest and Data-in-Transit

### 27.1 In transit

Require:

- TLS between browser and backend.
- TLS between backend and Camunda gateway/API.
- TLS between services where possible.
- mTLS for high-trust internal channels if required.
- no plaintext credentials in headers over non-TLS.

### 27.2 At rest

Consider:

- database encryption.
- search store encryption.
- backup encryption.
- Kubernetes secret encryption.
- log storage encryption.
- object storage encryption.

### 27.3 Application-level encryption

For highly sensitive fields, platform encryption may not be enough.

Pattern:

```text
Domain DB stores encrypted PII.
Process variable stores only reference ID or masked summary.
```

---

## 28. Environment Separation

Never share production credentials with non-production.

Separate:

- Camunda cluster.
- Identity realm/client.
- service accounts.
- secrets.
- tenant IDs.
- external API credentials.
- webhook signing keys.
- storage buckets.
- search indexes.
- audit sinks.

### 28.1 Common mistake

```text
UAT and PROD use same external webhook secret.
```

If UAT leaks, PROD is compromised.

### 28.2 Deployment permission separation

Developers may deploy to DEV/UAT, but PROD deployment should require controlled CI/CD path.

Avoid:

```text
local laptop -> deploy BPMN to PROD
```

---

## 29. Security Testing for Workflow Systems

Security testing must cover more than endpoint authentication.

### 29.1 User task security tests

Test:

```text
- unauthenticated cannot access task
- wrong tenant cannot view task
- non-candidate cannot claim task
- maker cannot approve own task
- stale task cannot be completed
- user cannot submit forbidden action
- user cannot edit forbidden field
- delegated user can act only within scope
- auditor read-only cannot complete task
```

### 29.2 Message security tests

Test:

```text
- invalid signature rejected
- replayed event rejected
- wrong tenant event rejected
- stale event rejected
- duplicate event deduplicated
- malformed payload rejected
```

### 29.3 Worker security tests

Test:

```text
- worker validates critical variables
- worker does not log secrets
- worker uses idempotency key
- worker rejects unauthorized side effect
- worker handles credential missing safely
```

### 29.4 Privileged operation tests

Test:

```text
- operator without role cannot repair
- repair requires reason
- repair writes audit
- variable repair captures before/after
- break-glass access expires
```

---

## 30. Threat Modeling Workflow

Use STRIDE-like thinking, but map it to workflow concerns.

### 30.1 Spoofing

Threat:

```text
Attacker pretends to be external payment provider.
```

Mitigation:

```text
signature, mTLS, source allowlist, event dedup, audit
```

### 30.2 Tampering

Threat:

```text
User manipulates task completion payload to approve instead of recommend.
```

Mitigation:

```text
action whitelist, backend policy, field-level validation, audit
```

### 30.3 Repudiation

Threat:

```text
Officer denies completing approval task.
```

Mitigation:

```text
immutable audit, authenticated actor, timestamp, reason code, correlation id
```

### 30.4 Information disclosure

Threat:

```text
Operate/Tasklist exposes sensitive variables to broad user group.
```

Mitigation:

```text
variable minimization, authorization, masking, separate domain store
```

### 30.5 Denial of service

Threat:

```text
Webhook floods message correlation API.
```

Mitigation:

```text
rate limit, dedup, queue, backpressure, tenant quota
```

### 30.6 Elevation of privilege

Threat:

```text
User completes supervisor task by calling API directly.
```

Mitigation:

```text
server-side task authorization, assignment validation, maker-checker policy
```

---

## 31. Security Smells

### Smell 1: All workers use one super credential

Risk:

```text
compromise of one worker compromises entire orchestration cluster
```

### Smell 2: Browser calls Camunda APIs directly without domain authorization

Risk:

```text
user bypasses application-level business rules
```

### Smell 3: Process variables contain secrets/PII

Risk:

```text
Operate/log/exporter/search-store leakage
```

### Smell 4: Candidate group equals authorization

Risk:

```text
group membership too coarse for case-level permission
```

### Smell 5: Maker-checker enforced only in UI

Risk:

```text
API call bypasses UI
```

### Smell 6: Repair operations not audited

Risk:

```text
cannot defend why production process state changed
```

### Smell 7: Message correlation accepts unauthenticated event

Risk:

```text
external attacker advances process
```

### Smell 8: Logs print full variables

Risk:

```text
sensitive data leakage through log aggregation
```

### Smell 9: Authorization logic spread across controllers, workers, BPMN expressions, and UI

Risk:

```text
inconsistent enforcement
```

### Smell 10: Admin accounts shared

Risk:

```text
no accountability
```

---

## 32. Worked Example: Regulatory License Approval Security

### 32.1 Process

```text
Submit Application
  -> Initial Completeness Check
  -> Risk Assessment
  -> Supervisor Approval
  -> Issue License
  -> Notify Applicant
```

### 32.2 Actors

```text
Applicant
Officer
Senior Officer
Supervisor
System Worker
Auditor
Admin Operator
```

### 32.3 Security rules

```text
Applicant:
- can submit own application
- can upload requested documents
- cannot view internal assessment
- cannot complete officer task

Officer:
- can view assigned application in own tenant/unit
- can complete completeness check
- can recommend decision
- cannot approve own recommendation

Supervisor:
- can approve/reject cases in own unit
- cannot approve if acted as officer earlier
- can return for clarification

Auditor:
- can view audit trail
- cannot mutate process

Admin Operator:
- can repair incidents only with ticket/reason
- cannot make business approval decision
```

### 32.4 Process start

```text
POST /applications/{applicationId}/submit
```

Checks:

```text
- user is applicant or authorized representative
- application belongs to user
- application state = DRAFT
- tenant/agency context valid
- idempotency registry prevents duplicate process
```

### 32.5 Officer task complete

Checks:

```text
- user is active officer
- tenant matches
- user assigned/candidate
- task definition key = CompletenessCheck
- allowed action in [REQUEST_INFO, MARK_COMPLETE]
- forbidden fields absent
- uploaded evidence reference valid
```

### 32.6 Supervisor task complete

Checks:

```text
- user is active supervisor
- tenant/unit matches
- user not maker
- decision reason required
- high-risk case requires director approval if policy says so
```

### 32.7 Worker issue license

Checks:

```text
- load case from DB
- verify case state APPROVED
- verify approval audit exists
- verify no active hold/sanction
- issue license idempotently
- store license in domain DB
- complete job with licenseId only
```

Do not let process variable alone decide license issuance.

---

## 33. Production Security Checklist

### 33.1 Platform

- [ ] Camunda APIs require authentication.
- [ ] Authorization enabled/configured for web components/APIs.
- [ ] Admin accounts are individual, not shared.
- [ ] Least privilege roles defined.
- [ ] Tasklist/Operate access restricted.
- [ ] Tenant authorizations configured if multi-tenancy enabled.
- [ ] Network access to Zeebe/API restricted.
- [ ] TLS configured.
- [ ] Backups encrypted.

### 33.2 Process application

- [ ] All endpoints authenticated.
- [ ] Business authorization centralized.
- [ ] Tenant checked on every business action.
- [ ] Maker-checker enforced server-side.
- [ ] Field-level permission enforced server-side.
- [ ] Idempotency enforced for process start and task completion.
- [ ] Message correlation endpoint verifies signature/replay.
- [ ] Workers validate critical variables.
- [ ] Logs do not print secrets/PII.

### 33.3 BPMN model

- [ ] User tasks have clear assignment rules.
- [ ] Sensitive data not exposed unnecessarily.
- [ ] Gateways do not rely on untrusted variables.
- [ ] Service tasks mapped to specific workers.
- [ ] Message events have correlation security design.
- [ ] Timer/escalation tasks have authorized recipient/group.
- [ ] Repair/migration implications reviewed.

### 33.4 Data protection

- [ ] Process variables minimized.
- [ ] Secrets not stored as variables.
- [ ] Large documents stored externally.
- [ ] PII masked/tokenized where possible.
- [ ] Retention policy defined.
- [ ] Audit access restricted.
- [ ] Export/search store access restricted.

### 33.5 Operations

- [ ] Incident repair requires reason/ticket.
- [ ] Privileged operations audited.
- [ ] Break-glass process defined.
- [ ] Credential rotation documented.
- [ ] Security alerts configured.
- [ ] Security tests in CI.

---

## 34. Java 8–25 Considerations

### 34.1 Java 8

For legacy Java 8 services:

- use simple immutable DTO classes.
- avoid advanced language features.
- centralize authorization as services.
- be careful with old dependency versions.
- ensure TLS/cipher support is current.

### 34.2 Java 11/17

Good baseline for enterprise services:

- better TLS defaults.
- better HTTP client in Java 11.
- records unavailable until Java 16, so DTO style depends on version.
- sealed classes unavailable until later.

### 34.3 Java 21/25

Useful features:

- records for immutable authorization context.
- sealed interfaces for actor/action models.
- pattern matching for policy classification.
- virtual threads for I/O-heavy task backend/worker, if used carefully.

Example sealed action model:

```java
public sealed interface WorkflowAction permits CompleteTask, ClaimTask, RepairIncident {
    String actionName();
}

public record CompleteTask(String taskId, String decision) implements WorkflowAction {
    public String actionName() { return "COMPLETE_TASK"; }
}

public record ClaimTask(String taskId) implements WorkflowAction {
    public String actionName() { return "CLAIM_TASK"; }
}

public record RepairIncident(String incidentId, String repairType) implements WorkflowAction {
    public String actionName() { return "REPAIR_INCIDENT"; }
}
```

Security benefit: explicit action model is easier to review than stringly-typed actions scattered across controllers.

---

## 35. What Top 1% Engineers Do Differently

Average implementation:

```text
- plug in login
- map roles
- create user tasks
- expose complete task endpoint
- hope Tasklist/role checks are enough
```

Top-tier implementation:

```text
- defines trust boundaries clearly
- separates platform authorization from business authorization
- treats task completion as business command
- validates tenant, ownership, assignment, action, field, and domain state
- keeps secrets and PII out of process variables
- uses least privilege service identities
- makes workers validate critical data
- secures message correlation against forgery/replay
- audits denied and privileged actions
- creates safe repair mechanism
- tests negative authorization paths
- designs for forensic defensibility
```

The difference is not just security tooling. The difference is **authority modeling**.

---

## 36. Summary

Workflow security is not just authentication.

It is the disciplined control of:

```text
who can start
who can see
who can claim
who can complete
who can decide
who can correlate
who can repair
who can migrate
who can observe
who can audit
who can operate
```

In BPMN/Camunda systems, security must exist at multiple layers:

```text
Platform authorization
  + Application authorization
  + Domain authorization
  + BPMN modeling discipline
  + Data protection
  + Audit governance
  + Operational controls
```

The most dangerous mistake is assuming that a valid login or a candidate group is enough.

For regulatory-grade systems, every meaningful process action must be:

```text
authenticated
authorized
validated
idempotent
audited
explainable
repairable
```

That is the standard expected from top-tier workflow/process orchestration engineering.

---

## 37. Referensi

- Camunda 8 Docs — Orchestration Cluster authorization.
- Camunda 8 Docs — Identity and access management.
- Camunda 8 Docs — Orchestration Cluster API authentication.
- Camunda 8 Docs — Tasklist access control and user tasks.
- Camunda 8 Docs — Multi-tenancy.
- Camunda 8 Docs — Java Client.
- Camunda 8 Docs — Handling data in processes.
- Camunda 8 Docs — Variables.
- Camunda Docs — Best practices for BPMN/DMN and process data.
- OWASP ASVS, API Security Top 10, and general secure design principles as supporting security mindset.

---

## Status Seri

Selesai sejauh ini:

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
- Part 16 — Saga and Long-running Transaction Engineering with BPMN
- Part 17 — Camunda 7 Deep Dive: Embedded Engine, Job Executor, Transactions, and Spring Boot
- Part 18 — Camunda 8 Deep Dive: Zeebe, Workers, Operate, Tasklist, Optimize, Identity
- Part 19 — Spring Boot + Camunda 8 Process Application Architecture
- Part 20 — Testing BPMN and Camunda Applications
- Part 21 — Observability: Logs, Metrics, Tracing, Audit, and Operability
- Part 22 — Production Operations: Incidents, Repair, Migration, and Runbook Engineering
- Part 23 — Security, Identity, Authorization, and Data Protection

Berikutnya:

- Part 24 — Integration Patterns: REST, Messaging, Files, Email, External Systems, and Connectors

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-bpmn-camunda-process-orchestration-engineering](./learn-java-bpmn-camunda-part-22-production-ops-incidents-repair-migration-runbook-engineering.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Learn Java BPMN Camunda Process Orchestration Engineering](./learn-java-bpmn-camunda-part-24-integration-patterns-external-systems-connectors.md)

</div>