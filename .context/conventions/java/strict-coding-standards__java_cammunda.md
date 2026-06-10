# Strict Coding Standards: Java + Camunda

> **Filename:** `strict-coding-standards__java_cammunda.md`  
> **Scope:** Java applications integrating with Camunda workflow/process orchestration.  
> **Primary baseline:** Camunda 8 Java Client / Camunda Spring Boot Starter.  
> **Legacy baseline:** Camunda 7 is allowed only for explicitly legacy modules.  
> **Purpose:** constrain LLM code agents so they produce safe, deterministic, observable, versioned, and operationally defensible Camunda integrations.

---

## 1. Non-Negotiable Rules

1. **Do not treat Camunda as a generic job queue.**
   - Camunda orchestrates long-running business processes.
   - Queue-like behavior is allowed only when represented as an explicit process model with business state, retries, and observability.

2. **Do not put core business logic inside BPMN expressions, scripts, connectors, or delegates without review.**
   - BPMN should coordinate business steps.
   - Java workers/services should execute business capabilities.
   - Complex decision logic belongs in application/domain code or DMN with explicit ownership.

3. **Do not mix Camunda 7 and Camunda 8 APIs in the same module.**
   - Camunda 7 uses embedded/process-engine APIs, Java delegates, external task clients, and legacy REST concepts.
   - Camunda 8 uses Zeebe/Camunda orchestration APIs, job workers, BPMN service task job types, and different operational semantics.

4. **Every worker must be idempotent.**
   - Camunda may retry jobs.
   - Network failures may occur after external side effects complete but before the job is completed.
   - Workers must tolerate duplicate execution.

5. **Every worker must have explicit timeout, retry, failure, and BPMN error behavior.**
   - Technical failure is not the same as business error.
   - Technical failure should usually fail the job and consume/retry according to retry policy.
   - Business error should usually throw/return a BPMN error that the process model handles.

6. **Process variables must be schema-governed and small.**
   - Do not store large documents, binary payloads, raw API responses, large lists, or sensitive full records as process variables.
   - Store references/IDs to durable stores instead.

7. **BPMN deployment must be versioned and reviewable.**
   - BPMN/DMN/forms are source code.
   - They must live in version control.
   - They must pass automated validation before deployment.

8. **Do not start process instances from arbitrary user input without validation and authorization.**
   - Process start is a business action.
   - It must validate subject, tenant, command shape, and allowed process definition.

9. **Do not complete, fail, or update jobs without correlation/audit context.**
   - Worker logs and telemetry must include process instance key, job key, BPMN process ID, element ID, job type, correlation ID, and tenant where applicable.

10. **Do not hide failures using fallback success.**
    - Completing a job after a failed external call is forbidden unless the business process explicitly says the fallback outcome is valid.

---

## 2. Platform Selection Rules

### 2.1 Camunda 8: Default for New Code

New Java code should prefer Camunda 8 integration unless the repository is explicitly a Camunda 7 legacy module.

Allowed integration options:

- Camunda Java Client.
- Camunda Spring Boot Starter.
- REST/gRPC API integration through official client abstractions.
- BPMN/DMN/form deployment through controlled CI/CD or approved runtime deployment flow.

Required baseline decisions:

```text
Camunda platform: Camunda 8 / Camunda 7 legacy
Client artifact: explicit
Version: pinned
Runtime: SaaS / self-managed / local dev
Protocol: REST / gRPC / Spring Boot starter default
Authentication: explicit
Tenant model: explicit
Process deployment owner: explicit
```

### 2.2 Camunda 7: Legacy Only

Camunda 7 code is allowed only when:

- the module already runs Camunda 7,
- migration is not in scope,
- the code uses existing architecture conventions,
- and the change does not introduce new Camunda 7-specific coupling without approval.

For Camunda 7, the agent must explicitly identify whether it is using:

- embedded process engine,
- shared engine,
- Java delegate,
- external task client,
- process engine REST API,
- Spring Boot starter,
- history/query APIs,
- job executor behavior.

### 2.3 Forbidden Platform Mixing

Forbidden:

```java
// Forbidden: Camunda 7 API in Camunda 8 module
import org.camunda.bpm.engine.RuntimeService;

// Forbidden: old Zeebe/Spring-Zeebe assumptions in new Camunda client module
import io.camunda.zeebe.client.ZeebeClient; // only if project baseline explicitly still uses it
```

Allowed only when explicitly documented:

```java
// Camunda 8 current-client style depends on project version/baseline.
import io.camunda.client.CamundaClient;
```

The exact import must follow the repository dependency baseline, not an online snippet.

---

## 3. Dependency and Version Governance

### 3.1 Mandatory Rules

- Pin Camunda client/starter versions.
- Use BOM/dependency management where provided by the platform/framework.
- Do not use alpha/beta/milestone artifacts unless the repository is explicitly experimental.
- Do not mix old `zeebe-*`, `spring-zeebe`, and current `camunda-*` artifacts without migration note.
- Do not copy random Maven coordinates from tutorials.

### 3.2 Maven Example

```xml
<dependencyManagement>
  <dependencies>
    <!-- Prefer the repository-approved Camunda BOM if available. -->
  </dependencies>
</dependencyManagement>

<dependencies>
  <dependency>
    <groupId>io.camunda</groupId>
    <artifactId>camunda-client-java</artifactId>
    <version>${camunda.version}</version>
  </dependency>
</dependencies>
```

### 3.3 Spring Boot Starter Example

```xml
<dependency>
  <groupId>io.camunda.spring</groupId>
  <artifactId>spring-boot-starter-camunda</artifactId>
  <version>${camunda.version}</version>
</dependency>
```

Rules:

- The starter version must match the supported Camunda platform line.
- Spring Boot major version compatibility must be verified.
- Configuration must be externalized.

---

## 4. BPMN Ownership Rules

### 4.1 BPMN Is Code

Every BPMN model must have:

- owner team,
- business purpose,
- process ID naming standard,
- versioning policy,
- start event contract,
- variable schema,
- error model,
- retry model,
- compensation/escalation model if external side effects exist,
- deployment pipeline.

### 4.2 BPMN Naming

Use stable, explicit IDs:

```text
Process ID: enforcement.case-lifecycle.v1
Service task job type: enforcement.case.validate-eligibility
Message name: enforcement.case.submitted
Error code: CASE_NOT_ELIGIBLE
Variable: caseId, applicantId, tenantId, submittedAt
```

Forbidden:

```text
Process ID: process_1
Task ID: task1
Job type: serviceTask
Message name: msg
Variable: data, payload, result, temp
```

### 4.3 BPMN Model Restrictions

Forbidden by default:

- undocumented script tasks,
- complex FEEL expressions containing business rules that should be code/DMN,
- service task without job type ownership,
- model without error boundary where business error is expected,
- model without timeout/escalation for long wait states,
- model that depends on implicit variable names not documented in schema,
- process model committed without validation.

Restricted:

- compensation event,
- event subprocess,
- multi-instance activities,
- message correlation,
- timer-heavy process,
- long-running saga,
- call activity with version binding,
- connectors performing critical business side effects.

Restricted means the PR must include a design note explaining why the BPMN construct is needed and how it fails safely.

---

## 5. Process Versioning Rules

### 5.1 Deployment Versioning

Every deployment must record:

```text
BPMN file path:
Process ID:
Model version / tag:
Application version:
Worker version:
Schema version:
Deployment environment:
Migration requirement:
Backward compatibility:
```

### 5.2 Worker Compatibility

Workers must be backward-compatible with currently running process instances.

Do not assume:

- all process instances use the latest variable schema,
- all instances reach tasks in the latest order,
- removed variables are absent everywhere,
- changed task IDs do not matter,
- changed job type is harmless.

### 5.3 Process Migration

Any model change that affects running instances must document:

- whether running instances stay on old version,
- whether instances migrate,
- migration mapping,
- variable transformation,
- incident risk,
- rollback/roll-forward strategy.

Forbidden:

- deploying incompatible process changes without migration note,
- renaming job types without supporting old workers until old instances drain/migrate,
- removing boundary events or error handlers without impact analysis.

---

## 6. Worker Design Rules

### 6.1 Worker Responsibility

A job worker must do exactly one business capability step.

Good:

```text
validate-case-eligibility
reserve-payment
create-document-record
send-notification-command
sync-approved-license
```

Bad:

```text
process-everything
handle-case
do-service-task
perform-next-step
external-call
```

### 6.2 Worker Structure

Recommended structure:

```java
@Component
final class ValidateCaseEligibilityWorker {

    private final ValidateCaseEligibilityUseCase useCase;
    private final CamundaVariableMapper variableMapper;

    ValidateCaseEligibilityWorker(
            ValidateCaseEligibilityUseCase useCase,
            CamundaVariableMapper variableMapper) {
        this.useCase = useCase;
        this.variableMapper = variableMapper;
    }

    @JobWorker(type = "enforcement.case.validate-eligibility")
    Map<String, Object> handle(ActivatedJob job) {
        CaseEligibilityCommand command = variableMapper.toCommand(job);
        CaseEligibilityResult result = useCase.validate(command);
        return variableMapper.toVariables(result);
    }
}
```

Rules:

- Worker method is an adapter, not the business service itself.
- Worker maps variables into typed command.
- Worker calls application service/use case.
- Worker maps result into minimal variables.
- Worker does not perform large serialization manually inline.
- Worker does not contain domain rules except mapping/translation.

### 6.3 Idempotency Contract

Every worker that performs an external side effect must define idempotency key:

```text
idempotencyKey = processInstanceKey + ':' + elementId + ':' + businessOperation
```

or preferably a stable business key:

```text
idempotencyKey = commandId / caseActionId / paymentReservationId / notificationRequestId
```

Required for:

- payment,
- notification,
- document generation,
- database write,
- external API call,
- message publish,
- file upload,
- email/SMS,
- status transition.

Forbidden:

```java
// Forbidden: side effect without idempotency
paymentGateway.charge(card, amount);
return Map.of("paid", true);
```

Allowed:

```java
paymentGateway.reserve(
    new PaymentReservationRequest(command.paymentId(), command.amount(), command.idempotencyKey())
);
```

### 6.4 Worker Concurrency

Worker concurrency must be configured based on downstream capacity.

Required controls:

- max active jobs,
- thread pool / execution model,
- request timeout,
- downstream rate limit,
- backpressure behavior,
- per-job memory budget,
- worker shutdown behavior.

Forbidden:

- unbounded concurrency,
- blocking I/O on event-loop thread,
- worker parallelism based only on CPU count when downstream is DB/API limited,
- one worker instance per tenant without capacity model.

---

## 7. Variable Contract Rules

### 7.1 Variable Schema

Every process must define variable schema:

```yaml
processId: enforcement.case-lifecycle.v1
variables:
  caseId:
    type: string
    required: true
    source: start-command
    pii: false
  applicantId:
    type: string
    required: true
    source: start-command
    pii: true
  tenantId:
    type: string
    required: true
    source: security-context
    pii: false
  eligibilityStatus:
    type: string
    enum: [ELIGIBLE, NOT_ELIGIBLE, NEEDS_REVIEW]
    source: validate-case-eligibility
```

### 7.2 Variable Size

Forbidden:

- large API payload as variable,
- file content as variable,
- PDF/XML/CSV as variable,
- full entity graph as variable,
- secret/token/password as variable,
- raw user request body as variable,
- massive list as variable.

Allowed:

```json
{
  "caseId": "CASE-2026-0001",
  "documentId": "DOC-123",
  "approvalOutcome": "APPROVED"
}
```

### 7.3 Variable Mapping

Do not access map keys randomly across worker code.

Forbidden:

```java
String caseId = (String) job.getVariablesAsMap().get("caseId");
```

Allowed:

```java
CaseCommand command = variableMapper.toCaseCommand(job);
```

Required mapper behavior:

- validate required variables,
- reject unknown critical shape if strict mode enabled,
- convert date/time explicitly,
- convert numeric precision explicitly,
- redact sensitive values in errors/logs,
- produce typed error on malformed variable.

### 7.4 Variable Updates

Workers must return only variables they own.

Forbidden:

```java
// Forbidden: overwrite whole variable map with stale data
return job.getVariablesAsMap();
```

Allowed:

```java
return Map.of(
    "eligibilityStatus", result.status().name(),
    "eligibilityCheckedAt", result.checkedAt().toString()
);
```

---

## 8. Error Handling Rules

### 8.1 Technical Failure vs Business Error

Technical failure:

- timeout,
- network unavailable,
- database unavailable,
- transient 5xx,
- rate limiting,
- serialization failure,
- unexpected exception.

Business error:

- applicant not eligible,
- payment declined,
- duplicate application,
- document rejected,
- approval condition unmet,
- user provided invalid business data.

### 8.2 Technical Failure Handling

Technical failure should usually fail the job and allow retries.

```java
try {
    useCase.execute(command);
} catch (TransientPartnerException ex) {
    throw ex; // handled by client/starter failure behavior or explicit fail command
}
```

If using explicit fail command, preserve:

```text
jobKey
retries remaining
retry backoff
safe error message
correlation ID
```

Forbidden:

- swallowing exception and completing job,
- setting status `SUCCESS_WITH_ERROR` unless business model defines it,
- retrying indefinitely inside worker while Camunda retry also exists,
- logging secret in failure message.

### 8.3 Business Error Handling

Business errors should be modeled in BPMN and thrown as BPMN error when the process must branch.

```java
if (!result.eligible()) {
    throw new CamundaBusinessError("CASE_NOT_ELIGIBLE", "Case is not eligible");
}
```

Rules:

- BPMN error code must be stable.
- BPMN model must catch the error where expected.
- Error must not expose sensitive internal details.
- Business error must not be retried as technical failure.

### 8.4 Incidents

Incident is an operational state that requires investigation.

Required incident handling documentation:

```text
incident type:
expected cause:
owner team:
alert:
resolution action:
retry reset required:
data correction required:
safe replay conditions:
```

Forbidden:

- resolving incident without fixing root cause,
- blindly resetting retries for poison data,
- resolving incident by editing variables without audit trail,
- ignoring repeated incident pattern.

---

## 9. Retry and Backoff Rules

### 9.1 Retry Location

Retry can exist in:

- Camunda job retry policy,
- worker HTTP client retry,
- DB transaction retry,
- message broker producer retry,
- circuit breaker.

The agent must not stack retries blindly.

Required note:

```text
Operation:
Is operation idempotent:
Retry owner:
Max attempts:
Backoff:
Timeout per attempt:
Total timeout:
Failure outcome:
```

### 9.2 Idempotent Retry

Allowed:

- GET-like lookup with timeout,
- idempotent external command with idempotency key,
- DB upsert guarded by unique key,
- message publish with deduplication key.

Forbidden:

- retrying payment capture without idempotency,
- retrying email send without deduplication/notification request ID,
- retrying status transition without state precondition,
- retrying non-idempotent external POST blindly.

---

## 10. Correlation and Message Rules

### 10.1 Business Key

Every process instance should have stable business correlation:

```text
businessKey / correlationKey = caseId / applicationId / orderId / requestId
```

Do not use random process instance key as the only business lookup identifier.

### 10.2 Message Correlation

Message name and correlation key must be stable and documented.

```text
messageName: enforcement.case.payment-received
correlationKey: paymentId
```

Forbidden:

- using user-controlled arbitrary message name,
- correlating only by mutable display number,
- correlating by non-unique tenant-unsafe key,
- no timeout/escalation on message wait.

### 10.3 Multi-Tenancy

If tenant support is enabled:

- tenant ID must be part of command validation,
- tenant ID must be propagated to process start/correlation/worker context,
- workers must enforce tenant boundary before external side effects,
- logs and metrics must include tenant only if cardinality/privacy policy allows it.

---

## 11. External Side Effect Rules

### 11.1 Transaction Boundary

Camunda job completion and business DB commit are not the same transaction.

Therefore:

- use idempotency,
- use outbox pattern for message publish when needed,
- persist operation status before completing job if replay safety requires it,
- design compensation or manual recovery for side effects that cannot be rolled back.

### 11.2 Saga and Compensation

Use BPMN compensation only when:

- the business concept truly has compensating action,
- compensation is safe/retryable,
- compensation failure is modeled,
- original side effect has an operation ID,
- compensation action is audited.

Forbidden:

- pretending all external side effects are ACID rollbackable,
- compensation without idempotency,
- compensation that calls a delete API without checking current state,
- hidden compensation in Java code not visible in BPMN.

---

## 12. Spring Boot Integration Rules

### 12.1 Worker Registration

Job worker registration must be explicit and searchable.

Required:

```java
@JobWorker(type = "enforcement.case.validate-eligibility")
```

Forbidden:

```java
@JobWorker(type = "${dynamic.worker.type}") // unless config is locked and documented
```

### 12.2 Configuration

All client and worker configuration must be externalized:

```yaml
camunda:
  client:
    mode: saas # or self-managed/simple/local depending baseline
    auth:
      client-id: ${CAMUNDA_CLIENT_ID}
      client-secret: ${CAMUNDA_CLIENT_SECRET}
    worker:
      defaults:
        max-jobs-active: 32
        request-timeout: 30s
        stream-enabled: false
```

Rules:

- secrets from secret manager/env only,
- no hardcoded endpoint/credentials,
- profile-specific config must not change semantic behavior silently,
- local config must not leak into production.

### 12.3 Bean Lifecycle

Camunda client/worker resources must be lifecycle-managed.

Forbidden:

```java
// Forbidden: create client per job
try (CamundaClient client = CamundaClient.newClientBuilder().build()) {
    client.newCompleteCommand(jobKey).send().join();
}
```

Allowed:

```java
@Component
final class ProcessStarter {
    private final CamundaClient client;

    ProcessStarter(CamundaClient client) {
        this.client = client;
    }
}
```

---

## 13. Process Start Rules

### 13.1 Start Command

Starting a process must use a typed command.

```java
public record StartCaseProcessCommand(
    String caseId,
    String applicantId,
    String tenantId,
    Instant submittedAt
) {}
```

### 13.2 Start Validation

Before starting process:

- authenticate subject,
- authorize action,
- validate business command,
- validate tenant ownership,
- check idempotency/start duplication,
- create audit record if required,
- map minimal variables.

Forbidden:

```java
client.newCreateInstanceCommand()
    .bpmnProcessId(request.getProcessId()) // user-controlled
    .latestVersion()
    .variables(request.getBody())          // raw body
    .send();
```

Allowed:

```java
client.newCreateInstanceCommand()
    .bpmnProcessId("enforcement.case-lifecycle.v1")
    .latestVersion()
    .variables(Map.of(
        "caseId", command.caseId(),
        "applicantId", command.applicantId(),
        "tenantId", command.tenantId(),
        "submittedAt", command.submittedAt().toString()
    ))
    .send();
```

---

## 14. Human Task Rules

Human task integration must define:

- assignee/candidate group policy,
- authorization rule,
- form schema,
- variable visibility,
- claim/unclaim policy,
- completion validation,
- audit event,
- SLA/timer/escalation,
- data redaction.

Forbidden:

- trusting client-submitted task variables without server-side validation,
- exposing all process variables to UI,
- task completion without authorization,
- form logic as only validation layer,
- silent reassignment without audit.

---

## 15. DMN and Decision Rules

Use DMN when:

- rule table is business-owned,
- rule changes are frequent,
- decision input/output schema is stable,
- rule can be tested independently.

Do not use DMN when:

- logic depends on complex side effects,
- logic is algorithmic/heavy computation,
- rules require hidden database queries,
- versioning/approval cannot be controlled.

Every DMN must have:

```text
Decision ID:
Input schema:
Output schema:
Hit policy:
Owner:
Test cases:
Versioning policy:
Fallback behavior:
```

---

## 16. Security Rules

### 16.1 Authentication

Camunda client credentials must be stored in secret manager/environment.

Forbidden:

- hardcoded client secret,
- committed local credentials,
- logging access tokens,
- storing access token in process variable,
- exposing Camunda management APIs publicly.

### 16.2 Authorization

Application must authorize:

- process start,
- message correlation,
- task claim/complete,
- variable update,
- incident resolution,
- process cancellation,
- migration/retry operations.

Do not rely only on BPMN path to enforce authorization.

### 16.3 Data Protection

Sensitive data must not be stored in process variables unless explicitly approved.

Restricted variable types:

- personal identifiers,
- financial data,
- secrets/tokens,
- health data,
- raw documents,
- auth claims,
- full customer profile.

Use references and domain services instead.

---

## 17. Observability Rules

### 17.1 Logging

Worker logs must include:

```text
processInstanceKey
jobKey
bpmnProcessId
processDefinitionKey
elementId
jobType
correlationId
tenantId if applicable
attempt/retry information if available
```

Forbidden:

- logging full variable map,
- logging secrets/tokens,
- logging raw external response body,
- logs without correlation context,
- logs that say only `failed` without cause category.

### 17.2 Metrics

Required metrics:

```text
worker.jobs.started
worker.jobs.completed
worker.jobs.failed
worker.jobs.bpmn_error
worker.job.duration
worker.external_call.duration
worker.external_call.failure
worker.idempotency.duplicate
worker.variable.mapping.failure
```

Cardinality rules:

- `jobType` is allowed.
- `processId` is allowed.
- `tenantId` is restricted.
- `processInstanceKey` and `jobKey` are forbidden as metric labels.

### 17.3 Tracing

Trace spans should include:

- process start,
- worker execution,
- external API call,
- DB operation,
- job completion/failure command.

Trace attributes must avoid high-cardinality IDs unless configured as events/log fields instead of span dimensions.

---

## 18. Testing Rules

### 18.1 Unit Test

Must test:

- variable mapping,
- worker command creation,
- business error mapping,
- technical exception path,
- idempotency key generation,
- redaction behavior.

### 18.2 BPMN Model Test

Must test:

- happy path,
- BPMN error path,
- technical retry path,
- timer/escalation path,
- message correlation path,
- variable schema compatibility,
- boundary event behavior.

### 18.3 Integration Test

Use test container/local runtime where appropriate.

Integration test must verify:

- process can deploy,
- worker can activate/complete job,
- error boundary catches business error,
- incident/retry path works,
- duplicate worker execution is safe,
- external dependency timeout produces expected failure.

### 18.4 Forbidden Test Practices

Forbidden:

- only testing worker method with mocked map and no process path test,
- no negative test for malformed variables,
- no duplicate execution test for side effects,
- snapshot-testing BPMN XML only without semantic validation,
- relying on sleep-based timing where deterministic control is possible.

---

## 19. Performance and Capacity Rules

### 19.1 Worker Capacity

Before increasing worker concurrency, document:

```text
max active jobs:
worker instances:
downstream DB/API capacity:
timeout:
average duration:
p95 duration:
retry rate:
incident rate:
memory per job:
```

### 19.2 Backpressure

Worker must handle backpressure:

- client/server resource exhausted response,
- downstream rate limit,
- database pool exhaustion,
- thread pool saturation,
- repeated transient failure.

Forbidden:

- tight loop retry,
- unbounded in-memory job queue,
- blocking shutdown until all retries complete without timeout,
- ignoring resource exhausted/backpressure signals.

---

## 20. Connectors Rules

Connectors are allowed only when:

- operation is simple,
- security credentials are managed safely,
- retry/error mapping is explicit,
- connector behavior is tested,
- sensitive response data is not blindly stored as variable,
- ownership is clear.

Forbidden by default:

- critical payment operation only in connector without application-side idempotency,
- connector with raw dynamic URL from process variable,
- connector storing full response body as process variable,
- connector as hidden business rules engine.

---

## 21. Camunda 7 Legacy Rules

### 21.1 Java Delegate

Java delegate rules:

- delegate must be thin adapter,
- business logic must be in application service,
- no direct static service lookup,
- no full variable map mutation,
- transaction boundary must be explicit,
- async continuation must be considered for external calls,
- delegate exceptions must map to BPMN/incident behavior intentionally.

Forbidden:

```java
public class GodDelegate implements JavaDelegate {
    public void execute(DelegateExecution execution) {
        // reads/writes everything, calls APIs, sends email, updates DB, swallows errors
    }
}
```

### 21.2 External Task Client

External task workers must:

- lock task with appropriate lock duration,
- extend lock only when safe,
- complete only after side effect durability,
- handle BPMN error for business errors,
- handle failure with retry count/backoff,
- be idempotent.

### 21.3 Camunda 7 to 8 Migration

Migration is not mechanical.

Must review:

- Java delegates vs job workers,
- embedded transaction semantics vs remote orchestration,
- variables serialization changes,
- BPMN compatibility,
- external task pattern vs Camunda 8 jobs,
- history/query APIs,
- user task/tasklist differences,
- operations/incident handling,
- authentication/authorization model.

---

## 22. Anti-Patterns

### 22.1 Workflow God Model

Symptoms:

- one huge BPMN with all business branches,
- unreadable gateway web,
- many variables named `data`,
- hidden business logic in expressions,
- no subprocess/call activity ownership.

Required refactor:

- split process capabilities,
- use subprocess/call activity with stable contract,
- move domain rules to service/DMN,
- document state machine.

### 22.2 Worker God Service

Symptoms:

- one worker handles many job types,
- switch-case on `job.getType()`,
- direct DB/API/mail operations in same method,
- no idempotency.

Required refactor:

- one worker per job type/capability,
- delegate to use case,
- explicit command/result mapping.

### 22.3 Variable Dumping

Symptoms:

- full request body stored,
- full entity serialized,
- large JSON variable,
- process variables used as database.

Required refactor:

- store IDs/references,
- use domain DB/object store,
- map minimal variables.

### 22.4 Retry Storm

Symptoms:

- Camunda retries + HTTP retries + DB retries + circuit breaker retries all stacked,
- no idempotency,
- no total timeout.

Required refactor:

- choose retry owner,
- bound attempts,
- add backoff,
- add idempotency,
- fail to incident/manual recovery when poison condition persists.

### 22.5 Process as Authorization

Symptoms:

- assuming user can complete task because task exists,
- relying on BPMN branch for permission,
- no resource-level authorization.

Required refactor:

- enforce authz in application boundary,
- validate subject/action/resource/context,
- audit decision.

---

## 23. LLM Implementation Protocol

Before changing Camunda code, the LLM must answer:

```text
1. Is this Camunda 8 or Camunda 7?
2. Which client/starter/API is used?
3. What BPMN process ID and job type are affected?
4. What variable schema is read and written?
5. Is the worker idempotent?
6. What external side effects occur?
7. What is technical failure behavior?
8. What is business error behavior?
9. What retry/backoff owner is used?
10. What tests prove the process path?
```

If any answer is unknown, the agent must not invent behavior. It must either inspect the codebase/model or implement the smallest safe adapter with TODO/design note.

---

## 24. Required PR Checklist

Every Camunda-related PR must answer:

```markdown
## Camunda Change Checklist

- [ ] Camunda version/platform identified: 8 / 7 legacy
- [ ] Client/starter/API baseline unchanged or updated intentionally
- [ ] BPMN/DMN/form files version-controlled
- [ ] Process ID/job type/message name stable and documented
- [ ] Variable schema updated
- [ ] Worker idempotency documented
- [ ] Technical failure path tested
- [ ] Business error/BPMN error path tested
- [ ] Retry/backoff/timeout behavior documented
- [ ] External side effects have idempotency or compensation
- [ ] Sensitive variables/logs reviewed
- [ ] Authorization reviewed for process start/task/correlation
- [ ] Observability includes process/job correlation
- [ ] Running instance compatibility reviewed
- [ ] Migration note added if process version changed incompatibly
```

---

## 25. Prompt Contract for LLM Code Agent

Use this instruction when asking an LLM to implement Camunda code:

```text
You are implementing Java + Camunda code under strict standards.
First identify whether the module uses Camunda 8 or Camunda 7 legacy.
Do not mix Camunda 7 process-engine APIs with Camunda 8 Java Client/Spring Boot Starter APIs.
Treat BPMN/DMN/forms as source code.
Every worker must be thin, typed, idempotent, timeout-aware, retry-aware, and observable.
Do not store large payloads, secrets, raw request bodies, or entity graphs as process variables.
Separate technical failures from business BPMN errors.
Do not complete a job after failed side effects unless the business process explicitly models that outcome.
Do not start/correlate/complete process work without validation and authorization.
Before coding, state affected process ID, job type, variable schema, side effects, retry behavior, and tests.
```

---

## 26. References

- Camunda 8 Java Client documentation.
- Camunda Spring Boot Starter documentation.
- Camunda job worker documentation.
- Camunda concepts: variables, incidents, process versioning.
- Camunda best practices: dealing with problems and exceptions.
- Camunda BPMN reference.
- Camunda 7 documentation for legacy process-engine/external-task behavior.
