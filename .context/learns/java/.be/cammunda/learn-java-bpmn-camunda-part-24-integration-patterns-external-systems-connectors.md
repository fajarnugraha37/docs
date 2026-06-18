# Learn Java BPMN Camunda Process Orchestration Engineering

## Part 24 — Integration Patterns: REST, Messaging, Files, Email, External Systems, and Connectors

> Seri: `learn-java-bpmn-camunda-process-orchestration-engineering`  
> Level: Advanced / Production Engineering  
> Fokus: Java 8–25, BPMN, Camunda 7/8, process orchestration, integration reliability, regulatory-grade workflow systems

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun fondasi:

- BPMN sebagai execution contract.
- Camunda 7 vs Camunda 8.
- Zeebe runtime internals.
- Java worker engineering.
- Idempotency, retry, incidents, variables, human workflow, DMN, message correlation, timers, parallelism, subprocess, saga, testing, observability, operations, dan security.

Part ini masuk ke area yang sering membuat workflow system gagal di production: **integration**.

BPMN process hampir tidak pernah hidup sendirian. Process biasanya harus berbicara dengan:

- REST API internal.
- External government/agency API.
- Payment gateway.
- Identity provider.
- Document management system.
- Notification service.
- Email/SMS provider.
- Message broker seperti Kafka/RabbitMQ/JMS.
- File transfer system.
- Legacy database.
- Batch system.
- Human task UI.
- Rules/decision service.
- Audit/logging service.

Kesalahan umum engineer adalah mengira integration hanya soal:

```text
call API -> get response -> complete job
```

Padahal untuk long-running process, integration adalah tentang:

```text
external side effect
+ uncertainty
+ retry
+ timeout
+ duplicate execution
+ correlation
+ partial failure
+ audit
+ repair
+ eventual consistency
```

Top 1% engineer tidak hanya bisa membuat worker memanggil API. Mereka bisa menjawab:

- Apakah call ini synchronous atau asynchronous?
- Apakah side effect-nya idempotent?
- Apakah response final atau provisional?
- Kalau worker crash setelah API sukses tapi sebelum job complete, apa yang terjadi?
- Kalau external system lambat, apakah process harus menunggu, retry, escalate, atau create incident?
- Kalau event datang sebelum process siap menerima message, apakah hilang atau dibuffer?
- Kalau file sudah dikirim tapi acknowledgement gagal, apakah boleh kirim ulang?
- Kalau email terkirim dua kali, apakah itu acceptable?
- Kalau payment berhasil tapi process gagal mencatat hasilnya, bagaimana recovery?
- Siapa yang boleh memperbaiki state process?
- Bagaimana membuktikan ke auditor bahwa tindakan integrasi benar?

---

## 1. Core Mental Model: Integration Is a Boundary of Uncertainty

Di dalam satu JVM dan satu database transaction, kita bisa memiliki ilusi kontrol:

```text
validate -> update database -> commit -> success
```

Tetapi begitu keluar ke external system, kontrol hilang:

```text
worker
  -> sends HTTP request
  -> network may fail
  -> remote may execute anyway
  -> response may be lost
  -> worker may crash
  -> job may timeout
  -> another worker may retry
```

Maka boundary integrasi harus dirancang sebagai **uncertainty boundary**.

### 1.1 Apa yang Membuat Integrasi Sulit?

Bukan karena HTTP sulit. Bukan karena Kafka sulit. Bukan karena SMTP sulit.

Yang sulit adalah kombinasi berikut:

| Masalah | Contoh |
|---|---|
| External side effect | Payment charged, email sent, document issued |
| Unknown outcome | Request timeout, tapi remote mungkin sukses |
| Duplicate execution | Worker retry atau job timeout |
| Eventual consistency | External response datang belakangan |
| Ordering ambiguity | Event B datang sebelum event A |
| Idempotency gap | External API tidak punya idempotency key |
| Operational repair | Harus memperbaiki process tanpa memalsukan fakta bisnis |
| Audit requirement | Harus bisa menjelaskan tindakan bertahun-tahun kemudian |

### 1.2 Integration dalam Workflow Bukan Technical Plumbing

Dalam CRUD service biasa, integrasi sering dianggap detail implementasi.

Dalam workflow system, integrasi adalah bagian dari process semantics.

Contoh:

```text
Submit Application
  -> Validate Applicant
  -> Request External Agency Clearance
  -> Wait for Clearance Result
  -> Decide Eligibility
```

Step `Request External Agency Clearance` bukan sekadar API call. Ia menciptakan external obligation:

- request dikirim ke agency eksternal
- agency bisa menjawab nanti
- agency bisa gagal
- agency bisa kirim duplicate response
- agency bisa reject karena schema salah
- agency bisa menerima request tapi tidak merespons
- officer mungkin perlu manual follow-up

Maka model BPMN harus merepresentasikan realitas ini.

---

## 2. Integration Responsibility Split

Jangan campur semua responsibility di BPMN.

Workflow integration yang sehat biasanya membagi responsibility seperti ini:

```text
BPMN process
  decides when integration is needed
  waits for result when needed
  handles business outcome

Worker / connector
  executes technical integration
  maps process contract to external contract
  classifies error
  applies idempotency
  produces observable telemetry

Domain service
  owns business data and invariants
  persists side-effect state
  validates command
  creates outbox/reconciliation records

External system
  owns external side effect
  may be unreliable or eventually consistent
```

### 2.1 BPMN Should Not Know Transport Details

Bad BPMN naming:

```text
POST /v1/agencies/clearance
Parse HTTP 200
Parse HTTP 400
Retry HTTP 500
```

Better BPMN naming:

```text
Request Agency Clearance
Wait for Agency Clearance Result
Handle Clearance Rejection
Escalate Missing Clearance
```

Transport details belong in worker/connector, not in business process language.

### 2.2 Worker Should Not Own Domain Truth

Bad worker:

```java
public void handle(JobClient client, ActivatedJob job) {
    ExternalResponse response = api.call(...);
    if (response.approved()) {
        applicationRepository.updateStatus(appId, "APPROVED");
    }
    client.newCompleteCommand(job).send().join();
}
```

Problem:

- worker directly mutates domain status
- unclear idempotency
- no command history
- no repair trail
- process and domain state may diverge

Better:

```text
Worker receives job
  -> builds domain command
  -> domain service validates and persists integration attempt
  -> domain service invokes or schedules external side effect safely
  -> worker completes job with result variables
```

Or for more robust integrations:

```text
Worker starts integration request
  -> persist outbound request
  -> publish via outbox
  -> BPMN waits for message response
```

---

## 3. Integration Taxonomy

Before designing integration, classify it.

### 3.1 By Interaction Style

| Style | Description | BPMN Pattern |
|---|---|---|
| Synchronous request/response | Worker calls API and gets immediate result | Service task |
| Async request + callback/event | Worker sends request, process waits | Service task + message catch event |
| Fire-and-forget | Trigger side effect, no business result needed | Service task with outbox/log |
| Polling | External result checked periodically | Timer cycle + service task |
| Human-assisted | External result requires manual upload/input | User task + service task |
| Batch exchange | File or batch submitted and result returned later | Service task + timer/message + reconciliation |

### 3.2 By Side Effect Severity

| Severity | Example | Requirement |
|---|---|---|
| No side effect | Query reference data | retry safe |
| Low side effect | Send notification | duplicate tolerable or deduped |
| Medium side effect | Create ticket/request | idempotency key needed |
| High side effect | Payment, license issuance, enforcement action | strict idempotency + reconciliation + audit |
| Irreversible side effect | Legal notice issued, public registry updated | approval, compensation, manual repair path |

### 3.3 By Result Timing

| Result Type | Example | Design |
|---|---|---|
| Immediate final | API returns definitive approval | service task output variable |
| Immediate provisional | API accepts request only | wait for message/result |
| Deferred final | Agency responds later | message correlation |
| Unknown | Timeout/no response | reconciliation/escalation |
| Continuous | status updates over time | event stream + process/message handling |

### 3.4 By Idempotency Support

| External Support | Strategy |
|---|---|
| Native idempotency key | send deterministic idempotency key |
| Supports client reference | use business request id as dedup key |
| Supports lookup by reference | query-before-create recovery |
| No idempotency support | local dedup + reconciliation + manual review |
| Non-idempotent irreversible operation | avoid automatic retry or use two-phase business approval |

---

## 4. Service Task Integration Pattern

The simplest integration is a service task handled by a job worker.

```text
[BPMN Service Task: Validate Applicant with External Registry]
  -> job type: external-registry.validate-applicant.v1
  -> worker calls registry API
  -> worker completes job with registryResult
```

This works when:

- call is fast enough
- outcome is immediate
- side effect is read-only or idempotent
- retry is safe
- failure semantics are clear

### 4.1 Good Use Cases

- Fetching profile data.
- Validating postal code.
- Checking blacklist status.
- Looking up reference data.
- Calling internal decision service.
- Generating preview document without final issuance.

### 4.2 Bad Use Cases

- Payment capture.
- Legal notice issuance.
- External request requiring asynchronous response.
- Long-running document generation.
- File transfer with delayed acknowledgement.
- Operation where duplicate call causes damage.

### 4.3 Basic Worker Shape

```java
@Component
public class ExternalRegistryValidationWorker {

    private final ExternalRegistryClient registryClient;
    private final IntegrationAttemptRepository attempts;
    private final ObjectMapper objectMapper;

    @JobWorker(type = "external-registry.validate-applicant.v1")
    public Map<String, Object> handle(ActivatedJob job) {
        ValidationRequest request = mapVariables(job);

        String idempotencyKey = IntegrationKeys.from(
            request.applicationId(),
            job.getProcessInstanceKey(),
            job.getElementInstanceKey(),
            "external-registry.validate-applicant.v1"
        );

        IntegrationAttempt attempt = attempts.startOrReuse(idempotencyKey, request);

        if (attempt.isCompleted()) {
            return Map.of("registryResult", attempt.resultAsMap());
        }

        try {
            RegistryResponse response = registryClient.validate(request, idempotencyKey);
            attempts.markCompleted(idempotencyKey, response);
            return Map.of("registryResult", response.toProcessVariable());
        } catch (ExternalBusinessRejectedException ex) {
            throw new BpmnError("REGISTRY_REJECTED", ex.getMessage());
        } catch (ExternalTemporarilyUnavailableException ex) {
            throw new JobFailureException("Registry temporarily unavailable", ex);
        }
    }
}
```

The exact annotation/API varies by Camunda Java/Spring Boot version, but the architecture is stable:

```text
map variables
  -> derive idempotency key
  -> dedup attempt
  -> call external system
  -> classify outcome
  -> complete/fail/throw BPMN error
```

### 4.4 Worker Must Classify Result

Never catch all exceptions and blindly fail job.

Use classification:

| External Outcome | Worker Action |
|---|---|
| Success | complete job |
| Business rejection | throw BPMN error |
| Validation error caused by process data | BPMN error or incident depending repairability |
| Temporary timeout | fail job with retry/backoff |
| External unavailable | fail job or create business escalation after retries |
| Unknown side effect | stop automatic retry, create incident/reconciliation |
| Unauthorized due config | incident, not business rejection |
| Forbidden due business eligibility | BPMN error |

---

## 5. Request/Response REST Integration

REST integration is common, but workflow REST integration must be stricter than ordinary service-to-service calls.

### 5.1 REST Integration Checklist

For every REST call, define:

```text
endpoint purpose
method
request schema
response schema
timeout
retry policy
idempotency key
correlation id
authentication
authorization
rate limit
error taxonomy
business error mapping
technical error mapping
observability fields
reconciliation strategy
```

### 5.2 Timeout Strategy

Do not set arbitrary long HTTP timeouts to “avoid failure”.

Bad:

```text
HTTP timeout = 5 minutes
worker lock timeout = 1 minute
```

This can cause job timeout while the worker is still blocked.

Better:

```text
HTTP connect timeout: short
HTTP read timeout: bounded
job timeout: greater than expected worker execution
external call timeout: less than job timeout
retry backoff: explicit
```

Example:

```text
job timeout: 60s
HTTP connect timeout: 2s
HTTP read timeout: 10s
client retry: disabled or minimal
Camunda retry: 3 with backoff
circuit breaker: open after repeated failures
```

### 5.3 HTTP Status Mapping

Do not treat all non-2xx responses the same.

| HTTP Status | Meaning | Workflow Treatment |
|---|---|---|
| 200/201 | success | complete job |
| 202 | accepted, not final | complete request step, wait for message/polling |
| 400 | invalid request | usually incident if caused by internal bug; BPMN error if user-correctable |
| 401 | auth failure | incident/config issue |
| 403 | forbidden | could be business denial or config issue; classify carefully |
| 404 | missing resource | maybe business error, stale data, or integration bug |
| 409 | conflict/duplicate | maybe idempotency success path |
| 422 | business validation failure | BPMN error/user correction |
| 429 | rate limited | fail job with backoff/throttle |
| 500 | server error | retry/backoff |
| 502/503/504 | temporary dependency failure | retry/backoff/circuit breaker |

### 5.4 Handling 202 Accepted

`202 Accepted` often means:

```text
request accepted for processing, final result later
```

Do not model it as final success if business outcome is still unknown.

Better BPMN:

```text
Submit Request to External Agency
  -> Wait for Agency Response Message
  -> Evaluate Agency Response
```

### 5.5 Query-Before-Create Recovery

For external APIs that support lookup by client reference:

```text
Before creating external request:
  check if external request with reference exists
  if exists -> reuse result/status
  else -> create request
```

This handles timeout ambiguity.

Pseudo:

```java
ExternalRequest existing = externalApi.findByClientReference(clientReference);
if (existing != null) {
    return mapExisting(existing);
}

try {
    return externalApi.create(request.withClientReference(clientReference));
} catch (TimeoutException ex) {
    ExternalRequest afterTimeout = externalApi.findByClientReference(clientReference);
    if (afterTimeout != null) {
        return mapExisting(afterTimeout);
    }
    throw ex;
}
```

---

## 6. Async Request + Message Response Pattern

Many external integrations should not be modeled as one service task.

Use two-step pattern:

```text
Service Task: Send External Request
  -> Intermediate Message Catch Event: Wait for External Response
  -> Gateway: Evaluate Response
```

### 6.1 Why This Pattern Is Better

It makes reality explicit:

- request sending is one fact
- external response is another fact
- waiting is a process state
- timeout can be modeled
- manual follow-up can be modeled
- duplicate responses can be handled
- SLA can be tracked

### 6.2 BPMN Shape

```text
[Send Clearance Request]
        |
        v
[Wait for Clearance Result] <--- message: ClearanceResultReceived
        |
        v
[Evaluate Clearance Result]
```

Add timeout:

```text
[Wait for Clearance Result]
   | message received
   v
[Evaluate Result]

boundary timer: PT7D
   -> [Escalate Missing Response]
```

### 6.3 Correlation Contract

Define:

```text
messageName = AgencyClearanceResultReceived
correlationKey = clearanceRequestId or applicationId + agencyCode
externalReference = agencyRequestReference
businessKey = applicationId
```

Do not rely on free-text names or email subjects.

### 6.4 Inbound Event Handler

External callback should not directly manipulate business state blindly.

Better:

```text
HTTP callback / message consumer
  -> authenticate sender
  -> validate schema/signature
  -> persist inbound event
  -> deduplicate by event id / external reference
  -> map to process message
  -> publish/correlate message to Camunda
  -> mark inbound event correlated
```

### 6.5 Handling Event Arrives Before Process Waits

Potential solutions:

| Strategy | Use Case |
|---|---|
| Message TTL/buffering | engine supports buffering for published message |
| Inbound event table | robust enterprise pattern |
| Process start by message | event creates process |
| Manual reconciliation | rare exceptional events |

Robust pattern:

```text
inbound_event table
  event_id
  event_type
  correlation_key
  payload
  status: RECEIVED / CORRELATED / DUPLICATE / UNMATCHED / FAILED
  received_at
  correlated_at
```

Then a correlation worker/router can retry safely.

---

## 7. Messaging Integration: Kafka, RabbitMQ, JMS

Message brokers are often used near Camunda, but Camunda is not a replacement for Kafka/RabbitMQ/JMS.

### 7.1 Distinguish Process Message from Broker Message

| Concept | Meaning |
|---|---|
| Broker message | Transport-level event on Kafka/RabbitMQ/JMS |
| BPMN message | Process-level event correlated to process instance |
| Domain event | Fact that something happened in domain |
| Integration event | Event meant for external consumption |

Do not conflate them.

Example:

```text
Kafka topic: agency.clearance.result.v1
Broker key: clearanceRequestId
Payload: AgencyClearanceResult

Camunda message name: AgencyClearanceResultReceived
Correlation key: clearanceRequestId
```

### 7.2 Kafka to Camunda Pattern

```text
Kafka consumer
  -> validate event
  -> persist inbox record
  -> deduplicate
  -> publish/correlate Camunda message
  -> commit offset only after safe persistence/correlation strategy
```

Important: committing Kafka offset and correlating Camunda message are not one atomic transaction unless you design for it.

Use inbox pattern:

```text
consume event
  -> save event to inbox with unique event_id
  -> commit offset
  -> async correlator processes inbox rows
  -> mark correlated
```

This avoids losing event if Camunda is temporarily unavailable.

### 7.3 RabbitMQ to Camunda Pattern

With RabbitMQ, think about acknowledgement:

```text
consume message
  -> persist inbound message
  -> ack broker
  -> correlate asynchronously
```

Or:

```text
consume message
  -> correlate immediately
  -> ack after success
```

But if correlation succeeds and ack fails, broker may redeliver. Therefore correlation must be idempotent.

### 7.4 Camunda to Kafka/RabbitMQ Pattern

Do not publish directly from worker without outbox when event matters.

Bad:

```text
worker publishes Kafka event
worker completes job
```

Failure window:

- event published
- worker crashes before job complete
- job retried
- event published again

Better:

```text
worker/domain service records outbound_event with idempotency key
outbox publisher publishes event
worker completes job based on durable record
```

Outbox table:

```sql
CREATE TABLE outbound_event (
    event_id           VARCHAR(64) PRIMARY KEY,
    aggregate_type     VARCHAR(100) NOT NULL,
    aggregate_id       VARCHAR(100) NOT NULL,
    event_type         VARCHAR(200) NOT NULL,
    payload_json       CLOB NOT NULL,
    status             VARCHAR(30) NOT NULL,
    created_at         TIMESTAMP NOT NULL,
    published_at       TIMESTAMP NULL,
    publish_attempts   NUMBER DEFAULT 0,
    last_error         CLOB NULL
);
```

### 7.5 Ordering

Workflow engineers often over-assume ordering.

Kafka ordering is per partition, not globally. RabbitMQ ordering can be affected by redelivery and multiple consumers. Camunda process message correlation can see events in unexpected timing.

Design for:

```text
duplicate
out-of-order
late
missing
stale
conflicting
```

Use event version, status transition validation, and correlation table.

---

## 8. File and Document Integration

File integration is deceptively hard.

Examples:

- User uploads supporting document.
- Worker generates PDF letter.
- System sends file to external agency.
- External batch result arrives as CSV/XML.
- Document management system stores signed copy.
- Large file attached to case.

### 8.1 Do Not Store Files in Process Variables

Bad:

```json
{
  "documentBase64": "...huge..."
}
```

Problems:

- huge variable payload
- slow engine/exporter/search
- PII leakage
- difficult retention
- hard to audit access
- expensive operations

Better:

```json
{
  "documentId": "DOC-2026-000123",
  "documentType": "SUPPORTING_EVIDENCE",
  "documentVersion": 3,
  "storageRef": "dms://case/APP-001/doc/DOC-123/v3"
}
```

Process variable stores reference, not payload.

### 8.2 Document Generation Pattern

```text
BPMN Service Task: Generate Decision Letter
  -> worker calls document service
  -> document service creates file and metadata
  -> worker completes with documentId/version
```

If document generation is slow:

```text
Request Document Generation
  -> Wait for DocumentGenerated message
  -> Review/Send Document
```

### 8.3 File Transfer Pattern

For SFTP/batch external agency:

```text
Prepare Batch File
  -> Upload File to Agency
  -> Wait for Acknowledgement
  -> Wait for Result File
  -> Parse Result
  -> Apply Result to Cases
```

Each step should have durable state:

```text
batch_id
file_id
checksum
record_count
submitted_at
ack_received_at
result_received_at
status
```

### 8.4 File Idempotency

Use deterministic file identity:

```text
batchType + businessDate + agencyCode + sequence
```

Use checksum to detect duplicate or corrupted file.

```text
file_name: clearance_request_CEA_20260617_001.xml
checksum: SHA-256
record_count: 1298
```

### 8.5 Large Batch and Per-Case Process

Avoid one giant process instance holding thousands of records in variables.

Better:

```text
Batch Process
  -> create batch metadata
  -> split records into domain batch table
  -> start/correlate per-case process or update case records
  -> aggregate result outside process variable
```

---

## 9. Email and Notification Integration

Email looks simple but is operationally tricky.

### 9.1 Email Is Usually a Side Effect, Not a Decision

Examples:

- notify applicant
- remind officer
- send decision letter
- send escalation notice

For important email, define:

```text
recipient source
email template version
payload snapshot
attachment reference
delivery attempt
provider response
bounce/failed status
audit record
```

### 9.2 Email Sending Pattern

Bad:

```text
worker sends email directly
complete job
```

If worker crashes after email sent before job completion, duplicate email may be sent.

Better:

```text
worker creates notification_request with deterministic key
notification service sends email idempotently
worker completes job with notificationRequestId
```

Notification table:

```sql
CREATE TABLE notification_request (
    notification_id     VARCHAR(64) PRIMARY KEY,
    business_key        VARCHAR(100) NOT NULL,
    template_code       VARCHAR(100) NOT NULL,
    template_version    VARCHAR(30) NOT NULL,
    recipient_hash      VARCHAR(128) NOT NULL,
    payload_json        CLOB NOT NULL,
    status              VARCHAR(30) NOT NULL,
    created_at          TIMESTAMP NOT NULL,
    sent_at             TIMESTAMP NULL,
    provider_message_id VARCHAR(200) NULL,
    error_message       CLOB NULL
);
```

### 9.3 Email Duplicate Policy

Not all duplicate emails have same severity.

| Email Type | Duplicate Acceptability |
|---|---|
| Marketing/update | sometimes tolerable |
| Reminder | tolerable with dedup window |
| Decision notice | usually not tolerable |
| Legal/enforcement notice | strict dedup + audit |
| Payment receipt | strict dedup |

### 9.4 Notification as Process or Service?

Use BPMN if notification has business lifecycle:

```text
Generate Notice
  -> Officer Approves Notice
  -> Send Notice
  -> Wait for Delivery Confirmation
  -> Escalate Bounce
```

Use notification service if it is a technical side effect:

```text
Send Reminder Email
```

---

## 10. Legacy System Integration

Legacy integrations often have constraints:

- no idempotency key
- SOAP/XML only
- batch files
- manual approval
- weak error codes
- poor timeout behavior
- shared database access
- unstable schema
- business semantics hidden in stored procedures

### 10.1 Do Not Let BPMN Mirror Legacy Weirdness

Bad:

```text
Call Legacy Step 1
Call Legacy Step 2
Call Legacy Step 2B
If Legacy Flag X = Y
Call Legacy Patch API
```

Better:

```text
Synchronize Case with Legacy Registry
```

Worker/adapter hides legacy mechanics behind a domain-level contract.

### 10.2 Anti-corruption Layer

For legacy integration, use an adapter service:

```text
BPMN worker
  -> LegacyIntegrationService
      -> SOAP/file/stored procedure/client logic
      -> maps legacy errors
      -> returns domain-level result
```

Do not expose legacy flags as process variables unless truly part of process decision.

### 10.3 Shared Database Integration

Avoid direct writes into another system's database unless there is no alternative.

If unavoidable:

- isolate writes in adapter
- use stored procedure if official contract
- record every write in integration audit table
- use transaction boundary carefully
- avoid assuming domain ownership
- reconcile regularly

---

## 11. Connectors vs Workers

Camunda 8 provides connectors. Connectors can simplify integration, especially for common systems or low-code/business-friendly modeling. But connectors are not always the best answer.

### 11.1 What Is a Connector?

Conceptually:

```text
Connector = reusable integration component invoked from BPMN
```

Camunda 8 distinguishes inbound and outbound connectors:

- Outbound connector: process triggers external system/service.
- Inbound connector: external system/message starts or continues workflow.

### 11.2 When Connector Is a Good Fit

Use connector when:

- integration is generic and reusable
- mapping is simple
- risk is low to medium
- business/low-code modeling benefit is high
- connector runtime can be governed
- security/secrets model is mature
- error handling is sufficient

Examples:

- send Slack/Teams notification
- call simple REST endpoint
- consume webhook
- simple email/SaaS integration
- standard connector supported by platform

### 11.3 When Worker Is Better

Use Java worker when:

- integration has complex domain logic
- strict idempotency is required
- external API has complex retry/repair rules
- audit requirement is high
- side effect is irreversible
- custom transaction/outbox/inbox needed
- performance/concurrency tuning needed
- advanced security/authorization mapping needed
- regulatory defensibility matters

Examples:

- payment capture/refund
- legal notice issuance
- license generation
- enforcement action creation
- cross-agency clearance request
- sensitive PII exchange

### 11.4 Decision Matrix

| Criterion | Connector | Java Worker |
|---|---|---|
| Simple SaaS integration | good | possible but heavier |
| Complex domain invariant | weak | strong |
| Strict idempotency | depends | strong |
| Custom audit | limited/custom | strong |
| Developer control | medium | high |
| Business configurability | high | lower |
| Operational repair | depends | strong if designed |
| Security customization | depends | strong |
| High throughput | depends | strong |
| Low-code objective | strong | weak |

### 11.5 Custom Connector

Custom connector can be useful if you want reusable integration with controlled abstraction.

But avoid custom connector as a dumping ground for business logic.

Good custom connector:

```text
Send Email via Approved Notification Platform
```

Risky custom connector:

```text
Process Regulatory Application Approval
```

The latter is domain process logic, not connector logic.

---

## 12. Integration Error Taxonomy

Every integration should define error taxonomy.

### 12.1 Categories

| Category | Meaning | BPMN/Worker Action |
|---|---|---|
| Technical transient | dependency temporarily down | retry/backoff |
| Technical permanent | bad config, auth failure | incident |
| Business rejection | external system rejected valid request | BPMN error/business branch |
| User-correctable | missing/wrong data | user correction flow |
| Unknown outcome | timeout after side effect may have happened | reconciliation/incident |
| Rate limit | too many requests | backoff/throttle |
| Duplicate | request already exists | treat as success or query existing |
| Stale event | old response for previous request | ignore/log/manual review |
| Security violation | invalid signature/token | reject and alert |

### 12.2 Error Classification Code

Example:

```java
public enum IntegrationOutcomeType {
    SUCCESS,
    BUSINESS_REJECTION,
    USER_CORRECTABLE_ERROR,
    TECHNICAL_TRANSIENT,
    TECHNICAL_PERMANENT,
    UNKNOWN_SIDE_EFFECT,
    RATE_LIMITED,
    DUPLICATE_ALREADY_PROCESSED,
    SECURITY_REJECTED
}
```

### 12.3 Worker Decision

```java
switch (outcome.type()) {
    case SUCCESS -> completeJob(outcome.variables());
    case BUSINESS_REJECTION -> throwBpmnError("EXTERNAL_REJECTED", outcome.reason());
    case USER_CORRECTABLE_ERROR -> throwBpmnError("DATA_CORRECTION_REQUIRED", outcome.reason());
    case TECHNICAL_TRANSIENT -> failJobWithRetry(outcome.reason(), backoff);
    case RATE_LIMITED -> failJobWithRetry(outcome.reason(), longerBackoff);
    case TECHNICAL_PERMANENT -> failJobNoRetry("Configuration/security problem");
    case UNKNOWN_SIDE_EFFECT -> createIncidentOrReconciliation(outcome);
    case DUPLICATE_ALREADY_PROCESSED -> completeJob(outcome.recoveredVariables());
    case SECURITY_REJECTED -> rejectAndAlert(outcome);
}
```

---

## 13. Idempotency Patterns for Integration

Idempotency means repeated execution produces same business effect.

### 13.1 Idempotency Key Sources

Potential key components:

```text
business key
process instance key
element instance key
job type
external operation type
external request version
```

Example:

```text
APP-2026-001:payment:capture:v1
APP-2026-001:notice:send-decision:v3
APP-2026-001:agency-clearance:CEA:v1
```

### 13.2 Idempotency Record

```sql
CREATE TABLE integration_attempt (
    idempotency_key      VARCHAR(200) PRIMARY KEY,
    operation_type       VARCHAR(100) NOT NULL,
    business_key         VARCHAR(100) NOT NULL,
    process_instance_key VARCHAR(100) NULL,
    element_instance_key VARCHAR(100) NULL,
    request_hash         VARCHAR(128) NOT NULL,
    status               VARCHAR(30) NOT NULL,
    external_reference   VARCHAR(200) NULL,
    response_payload     CLOB NULL,
    created_at           TIMESTAMP NOT NULL,
    updated_at           TIMESTAMP NOT NULL,
    last_error           CLOB NULL
);
```

### 13.3 Idempotency States

```text
NEW
IN_PROGRESS
SENT
COMPLETED
FAILED_RETRYABLE
FAILED_PERMANENT
UNKNOWN_OUTCOME
COMPENSATED
```

### 13.4 Request Hash

If same idempotency key is reused with different payload, something is wrong.

```text
same key + same request hash -> safe duplicate
same key + different request hash -> integrity violation
```

### 13.5 External Idempotency

If external API supports idempotency key, send it.

```http
POST /payments/capture
Idempotency-Key: APP-2026-001:payment:capture:v1
X-Correlation-Id: corr-...
```

If external API does not support it, use local dedup and query/reconcile.

---

## 14. Outbox Pattern in Workflow Integration

Outbox solves the problem of coordinating database commit with message publication.

### 14.1 Problem

Bad:

```text
update database
publish message
```

If publish fails after DB commit, event lost.

Bad:

```text
publish message
update database
```

If DB update fails after publish, external consumer sees false event.

### 14.2 Pattern

```text
inside one DB transaction:
  update domain state
  insert outbox event

async publisher:
  reads unpublished events
  publishes to broker
  marks published
```

### 14.3 With Camunda Worker

```text
worker receives job
  -> domain service applies command in DB transaction
       -> update state
       -> insert outbox event
  -> worker completes job
outbox publisher sends integration event independently
```

### 14.4 If Completing Camunda Job Fails

If DB transaction succeeds but job completion fails:

- job may retry
- idempotent domain command sees command already applied
- worker completes job with existing result

This is acceptable.

---

## 15. Inbox Pattern for Inbound Integration

Inbox solves duplicate inbound events.

### 15.1 Pattern

```text
receive event
  -> insert into inbox with unique event id
  -> if duplicate, ignore or return success
  -> process/correlate event
  -> mark processed
```

### 15.2 Inbox Table

```sql
CREATE TABLE inbound_event (
    event_id        VARCHAR(100) PRIMARY KEY,
    source_system   VARCHAR(100) NOT NULL,
    event_type      VARCHAR(100) NOT NULL,
    correlation_key VARCHAR(200) NOT NULL,
    payload_json    CLOB NOT NULL,
    status          VARCHAR(30) NOT NULL,
    received_at     TIMESTAMP NOT NULL,
    processed_at    TIMESTAMP NULL,
    error_message   CLOB NULL
);
```

### 15.3 Processing States

```text
RECEIVED
DUPLICATE
VALIDATED
CORRELATED
UNMATCHED
FAILED_RETRYABLE
FAILED_PERMANENT
IGNORED_STALE
```

---

## 16. Rate Limiting, Throttling, and Bulkheads

Workflow engines can produce concurrency faster than external systems can handle.

### 16.1 Where Rate Limit Happens

```text
process instances
  -> job activation
  -> worker concurrency
  -> HTTP client connection pool
  -> external system limit
```

### 16.2 Worker-level Throttle

Example policy:

```text
external system: 300 requests/minute
worker global limit: 250 requests/minute
per-instance concurrency: 20
max jobs active: 50
retry backoff on 429: 60s
```

### 16.3 Bulkhead

Do not let one bad dependency consume all worker resources.

Separate workers/pools:

```text
agency-clearance-worker pool
payment-worker pool
notification-worker pool
document-worker pool
```

### 16.4 Circuit Breaker

If external dependency is down:

```text
fail fast
reduce pressure
let jobs retry with backoff
alert operator
avoid thread exhaustion
```

Circuit breaker should not hide business failure. It is technical protection.

---

## 17. Authentication and Secret Management for Integration

Integration security must be part of design, not afterthought.

### 17.1 Outbound Auth

Common patterns:

- OAuth2 client credentials.
- mTLS.
- API key.
- signed request.
- JWT assertion.
- HMAC signature.
- mutual VPN/private link.

### 17.2 Secret Handling

Do not put secrets in BPMN variables.

Use:

- secret manager
- Kubernetes Secret
- cloud parameter store
- vault
- connector secret mechanism
- short-lived token cache

### 17.3 Token Refresh

Worker should handle:

```text
401 due expired token
  -> refresh token once
  -> retry request safely
  -> if still 401, classify as config/security incident
```

### 17.4 Inbound Auth

For webhook/message inbound:

- validate signature
- validate timestamp to prevent replay
- validate sender identity
- validate event id uniqueness
- validate schema
- validate tenant/business ownership

---

## 18. Correlation IDs and Traceability

Every integration call should be traceable.

### 18.1 Required Identifiers

```text
correlation_id
business_key
process_instance_key
process_definition_id/version
bpmn_element_id
element_instance_key
job_key
idempotency_key
external_reference
tenant_id
actor/system identity
```

### 18.2 HTTP Headers

Example:

```http
X-Correlation-Id: corr-20260617-abc
X-Business-Key: APP-2026-001
X-Process-Instance-Key: 2251799813685249
X-Idempotency-Key: APP-2026-001:agency-clearance:v1
```

### 18.3 Log Shape

```json
{
  "event": "external_api_call_completed",
  "integration": "agency-clearance",
  "businessKey": "APP-2026-001",
  "processInstanceKey": "2251799813685249",
  "elementId": "SendAgencyClearanceRequest",
  "idempotencyKey": "APP-2026-001:agency-clearance:v1",
  "externalReference": "AGY-REQ-9981",
  "durationMs": 842,
  "outcome": "SUCCESS"
}
```

---

## 19. Process Modeling Patterns for Integration

### 19.1 Immediate API Result

```text
[Validate with Registry]
  -> [Gateway: Is Valid?]
      yes -> continue
      no  -> correction/rejection
```

Use when result is fast, final, and safe to retry.

### 19.2 Async External Request

```text
[Submit External Request]
  -> [Wait for External Response]
      message -> [Evaluate Response]
      timer   -> [Escalate Missing Response]
```

Use when result is deferred.

### 19.3 Polling

```text
[Submit Request]
  -> [Wait PT1H]
  -> [Check External Status]
  -> gateway:
       completed -> continue
       pending   -> loop with max attempts/SLA
       failed    -> handle failure
```

Use when external system has status API but no callback.

Be careful: polling at scale can create load.

### 19.4 Fire-and-Forget Notification

```text
[Record Notification Request]
  -> continue
```

Notification delivery handled by notification service.

Use when process does not need to wait for delivery.

### 19.5 Delivery Confirmation Required

```text
[Send Legal Notice]
  -> [Wait for Delivery Confirmation]
  -> [Record Served Date]
```

Use when delivery status affects legal/business process.

### 19.6 Batch Integration

```text
[Prepare Batch]
  -> [Upload Batch]
  -> [Wait for Batch Ack]
  -> [Wait for Batch Result]
  -> [Apply Results]
```

Use for file-based external systems.

---

## 20. Java Integration Architecture

### 20.1 Package Structure

```text
com.example.workflow
  process
    ApplicationProcessStarter.java
    AgencyMessageCorrelator.java
  worker
    RequestAgencyClearanceWorker.java
    GenerateDecisionLetterWorker.java
    SendNotificationWorker.java
  integration
    agency
      AgencyClient.java
      AgencyRequestMapper.java
      AgencyResponseMapper.java
      AgencyErrorClassifier.java
    notification
      NotificationClient.java
    document
      DocumentServiceClient.java
  domain
    application
      ApplicationService.java
      ApplicationCommand.java
  reliability
    IdempotencyService.java
    IntegrationAttemptRepository.java
    OutboxPublisher.java
    InboxProcessor.java
  observability
    WorkflowTelemetry.java
```

### 20.2 Layering

```text
worker
  -> application/domain service
      -> repository/outbox/idempotency
      -> integration adapter
```

Avoid:

```text
worker -> raw HTTP client -> raw DB update -> complete job
```

### 20.3 Integration Adapter Interface

```java
public interface AgencyClearanceGateway {
    AgencyClearanceSubmission submit(AgencyClearanceRequest request, String idempotencyKey);
    AgencyClearanceStatus getStatus(String externalReference);
}
```

The worker does not need to know if implementation uses REST, SOAP, file, or message.

### 20.4 Error Classifier

```java
public final class AgencyErrorClassifier {

    public IntegrationOutcome classify(Throwable throwable) {
        if (throwable instanceof SocketTimeoutException) {
            return IntegrationOutcome.unknownOrTransient("Timeout contacting agency");
        }
        if (throwable instanceof UnauthorizedException) {
            return IntegrationOutcome.technicalPermanent("Agency auth failed");
        }
        if (throwable instanceof RateLimitException) {
            return IntegrationOutcome.rateLimited("Agency rate limited request");
        }
        return IntegrationOutcome.technicalTransient("Unexpected agency error");
    }
}
```

### 20.5 Avoid Annotation-Centric Design

Camunda/Spring annotations are convenient, but architecture should not be annotation-driven.

Good:

```text
annotation layer thin
business/integration services testable without Camunda runtime
```

---

## 21. Worked Example: External Agency Clearance

### 21.1 Business Requirement

A license application requires clearance from external agency.

Rules:

- Clearance request must be sent after document completeness check.
- External agency may respond immediately with request ID only.
- Final response can arrive via webhook or batch file.
- If no response in 7 working days, officer must follow up.
- Duplicate response must not update case twice.
- Rejected clearance routes case to officer review.
- Approved clearance continues process.

### 21.2 BPMN Shape

```text
Check Document Completeness
  -> Submit Clearance Request
  -> Wait for Clearance Result
       message: ClearanceResultReceived -> Evaluate Result
       timer: 7 working days -> Create Follow-up Task
```

### 21.3 Variables

```json
{
  "applicationId": "APP-2026-001",
  "clearance": {
    "requestId": "CLR-APP-2026-001-AGY-A",
    "agencyCode": "AGY-A",
    "status": "REQUESTED",
    "submittedAt": "2026-06-17T10:15:00+07:00"
  }
}
```

Do not store full agency payload unless needed.

### 21.4 Worker: Submit Request

```text
derive idempotency key
create integration_attempt
call agency API
store external reference
complete job with clearance.requestId/status
```

### 21.5 Inbound Webhook

```text
validate signature
persist inbound_event
deduplicate eventId
map to ClearanceResultReceived message
correlate by clearanceRequestId
mark correlated
```

### 21.6 Late Response After Timeout

If timeout creates follow-up task, response may still arrive.

Possible design:

```text
If process still waiting -> correlate message
If process moved to follow-up task -> correlate to event subprocess or store event and notify officer
If process already closed -> mark stale and audit
```

### 21.7 Audit Trail

Record:

```text
request sent at
request payload hash
external reference
response received at
source channel
response payload hash
correlation result
officer intervention if any
final decision impact
```

---

## 22. Worked Example: Payment Capture

Payment is high-risk side effect.

### 22.1 Bad Pattern

```text
[Capture Payment]
  -> worker calls payment gateway
  -> retry on timeout
```

Danger:

- timeout might happen after payment captured
- retry might double-charge

### 22.2 Better Pattern

```text
[Create Payment Intent]
  -> [Wait for Payment Confirmation]
  -> [Issue Receipt]
```

Use payment provider idempotency key.

### 22.3 Unknown Outcome

If capture timeout occurs:

```text
query payment by idempotency key/reference
if captured -> continue
if not found -> retry or manual review
if uncertain -> incident/reconciliation
```

### 22.4 Compensation

Refund is not rollback.

```text
payment capture succeeded
later process fails
  -> refund payment
  -> record refund reference
```

Refund can fail. Refund itself needs idempotency and repair.

---

## 23. Worked Example: Legal Notice Email/Letter

### 23.1 Requirement

A legal notice must be issued once, with exact content and timestamp.

### 23.2 Design

```text
Generate Notice Document
  -> Officer Approves Notice
  -> Issue Notice
  -> Wait for Delivery Status
```

### 23.3 Integration Contracts

```text
document generation: idempotent by noticeId + templateVersion
notice issue: idempotent by noticeId
delivery provider: external message id
status callback: inbox dedup by provider event id
```

### 23.4 Why Not Fire-and-Forget?

Because delivery status affects legal defensibility.

Process must know:

- generated content
- approved by whom
- issued when
- delivered when
- failed why
- reissued under what authority

---

## 24. Testing Integration Patterns

### 24.1 Unit Tests

Test:

- request mapping
- response mapping
- error classification
- idempotency key generation
- retry decision
- stale event detection

### 24.2 Integration Tests

Use mock server/Testcontainers as appropriate:

- HTTP 200 success
- HTTP 202 accepted
- HTTP 400 business validation
- HTTP 401 config error
- HTTP 429 rate limit
- HTTP 500 retry
- timeout unknown outcome
- duplicate response
- late response

### 24.3 Process Tests

Test BPMN paths:

```text
external approval path
external rejection path
timeout/escalation path
duplicate event path
manual repair path
compensation path
```

### 24.4 Chaos/Failure Tests

Simulate:

- worker crash after external success before job complete
- Camunda unavailable during callback correlation
- broker redelivery
- duplicate webhook
- external API slow response
- rate limit storm
- invalid external payload

---

## 25. Observability for Integration

### 25.1 Metrics

Track:

```text
integration_call_total{system,operation,outcome}
integration_call_duration_seconds{system,operation}
integration_retry_total{system,operation,reason}
integration_unknown_outcome_total{system,operation}
inbound_event_received_total{source,type}
inbound_event_duplicate_total{source,type}
inbound_event_correlation_failed_total{source,type}
outbox_pending_count{eventType}
outbox_publish_failed_total{eventType}
```

### 25.2 Alerts

Alert on:

- spike in 5xx
- spike in 429
- unknown outcomes
- outbox backlog growing
- inbox unmatched events growing
- webhook signature failures
- integration incident count
- SLA missing responses

### 25.3 Dashboards

Useful dashboard panels:

```text
External system health
Request volume
Success/failure rate
Latency percentiles
Retry count
Unknown outcome count
Pending outbound events
Pending inbound events
Process instances waiting for response
Oldest waiting process
SLA breaches
```

---

## 26. Security and Compliance for Integration

### 26.1 Data Minimization

Send only required data.

Do not send entire application payload if external system needs only:

```text
applicant identifier
license type
request reference
```

### 26.2 Payload Snapshot

For audit, store payload hash and controlled snapshot.

```text
request_hash
response_hash
schema_version
external_reference
```

For sensitive data, avoid storing raw payload broadly.

### 26.3 Access Control

Who can:

- trigger integration manually?
- retry failed integration?
- modify correlation key?
- replay inbound event?
- resend legal notice?
- view external payload?

These are privileged operations.

### 26.4 Replay Protection

For inbound webhooks:

```text
signature valid
timestamp within window
event id not seen before
source allowed
tenant matches
business reference valid
```

---

## 27. Integration Anti-patterns

### 27.1 BPMN as API Sequence Diagram

If BPMN contains too many technical API calls, it becomes unreadable.

Fix: group technical details behind domain-level service task.

### 27.2 Process Variables as Integration Database

If you store every request/response in variables, process becomes heavy and insecure.

Fix: use integration tables/document store; variables store references and decision-relevant summary.

### 27.3 Blind Retry on Non-idempotent Side Effect

Retrying payment/legal issuance without idempotency can cause damage.

Fix: idempotency key + query/reconcile + incident for unknown outcome.

### 27.4 Treating Timeout as Failure

Timeout means unknown, not necessarily failed.

Fix: classify as unknown outcome when side effect may have happened.

### 27.5 Ignoring 202 Accepted

Accepted is not final success.

Fix: wait for callback/status/result.

### 27.6 Direct Broker-to-Camunda Without Inbox

A temporary Camunda outage may lose event or cause messy redelivery.

Fix: inbox table and correlator.

### 27.7 External Payload Leaks

Storing PII-rich external payload in process variable makes it visible in tooling/search/export.

Fix: minimize and secure.

### 27.8 No Reconciliation

Assuming external system and process state always match is naive.

Fix: reconciliation job/report.

---

## 28. Design Review Checklist

For every integration step, ask:

### 28.1 Business Semantics

- What business fact does this integration represent?
- Is result final or provisional?
- Does process need to wait for result?
- Is failure business-relevant or technical?
- Is manual intervention needed?

### 28.2 Technical Contract

- What is request schema?
- What is response schema?
- What are timeout and retry settings?
- What are possible error codes?
- What is idempotency strategy?
- What is correlation key?
- What is external reference?

### 28.3 Reliability

- What if worker crashes after external success?
- What if response is lost?
- What if event arrives early?
- What if event is duplicated?
- What if event is late?
- What if external system is down for hours?
- What if rate limit is hit?

### 28.4 Data and Security

- What sensitive data is sent?
- What sensitive data is stored?
- Where are secrets stored?
- How is inbound sender authenticated?
- How is replay prevented?
- Who can retry/repair/replay?

### 28.5 Observability

- What logs are emitted?
- What metrics exist?
- What dashboard shows health?
- What alerts exist?
- Can support trace from case ID to external reference?
- Can auditor see what happened?

### 28.6 Operations

- How to retry safely?
- How to reconcile?
- How to repair unknown outcome?
- How to handle stale events?
- How to cancel request?
- How to compensate?

---

## 29. Top 1% Engineering Heuristics

### 29.1 Integration Is Not an Implementation Detail

In workflow systems, integration often defines the real process behavior.

### 29.2 Timeout Is Not Failure

Timeout is uncertainty. Treat it as unknown unless operation is provably read-only.

### 29.3 Duplicate Is Normal

Design as if every external request or event can happen twice.

### 29.4 External Reference Is Gold

Always capture external reference IDs. They are essential for support, reconciliation, and audit.

### 29.5 Use BPMN for Business Waiting, Not Thread Waiting

Do not block worker thread waiting hours/days. Model wait state with message/timer/user task.

### 29.6 Store Payloads Carefully

Process variables are for process execution, not raw integration archive.

### 29.7 Reconciliation Is a Feature

If integration matters, build reconciliation intentionally.

### 29.8 Repair Must Be Auditable

Manual repair without audit creates hidden corruption.

### 29.9 Connector Is Not Automatically Safer Than Worker

Connectors are useful abstraction, but critical domain integrations often need worker-level control.

### 29.10 Model External Reality, Not Internal Hope

If external result is delayed, model it as delayed. If result can be missing, model missing response. If manual follow-up is real, model it.

---

## 30. Summary

Integration in BPMN/Camunda systems is not merely about connecting APIs.

It is about designing a reliable boundary between:

```text
process state
business truth
external side effects
uncertain networks
human operations
audit requirements
```

A production-grade integration design requires:

- clear interaction style
- idempotency
- retry classification
- timeout handling
- message correlation
- inbox/outbox
- variable minimization
- external reference tracking
- security
- observability
- manual repair
- reconciliation
- audit trail

The most important shift:

```text
Do not ask only: “How do I call this API?”
Ask: “What business fact does this integration create, and how do we prove, recover, retry, correlate, and audit it under failure?”
```

That is the difference between integration code that works in a demo and process orchestration that survives production.

---

## 31. Practical Exercises

### Exercise 1 — Classify Integrations

For each integration below, classify as synchronous, asynchronous, fire-and-forget, polling, or batch:

1. Postal code lookup.
2. Payment capture.
3. External agency clearance.
4. Email reminder.
5. Legal notice delivery.
6. Batch upload of 10,000 records.
7. Document generation.

For each, define:

```text
idempotency strategy
retry strategy
BPMN modeling pattern
repair path
observability metrics
```

### Exercise 2 — Design External Agency Integration

Design tables and BPMN for:

```text
Submit request to agency
Wait max 7 working days
Handle approval/rejection
Escalate missing response
Handle duplicate and late callback
```

### Exercise 3 — Payment Unknown Outcome

Write a recovery algorithm for:

```text
payment API timeout after request sent
```

Include:

- query by idempotency key
- retry policy
- manual incident condition
- audit log

### Exercise 4 — Connector vs Worker Decision

For these operations, decide connector or Java worker:

1. Send Slack message.
2. Send legal notice.
3. Capture payment.
4. Call simple internal reference API.
5. Submit license issuance command.
6. Receive webhook from external SaaS.

Explain trade-offs.

---

## 32. What Comes Next

Next part:

```text
Part 25 — Performance, Scaling, Capacity Planning, and Cost Engineering
```

Part berikutnya akan membahas bagaimana mendesain workflow system yang tidak hanya benar secara logic, tetapi juga scalable:

- process starts/sec
- jobs/sec
- active instances
- worker concurrency
- partitioning
- backpressure
- timer/message volume
- payload size
- external dependency bottleneck
- cost model
- capacity planning
- load testing
- performance anti-patterns

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-bpmn-camunda-part-23-security-identity-authorization-data-protection.md">⬅️ Part 23 — Security, Identity, Authorization, and Data Protection</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-bpmn-camunda-part-25-performance-scaling-capacity-planning-cost-engineering.md">Learn Java BPMN Camunda Process Orchestration Engineering ➡️</a>
</div>
