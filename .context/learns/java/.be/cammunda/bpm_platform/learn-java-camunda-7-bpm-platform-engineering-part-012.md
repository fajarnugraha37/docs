# learn-java-camunda-7-bpm-platform-engineering-part-012.md

# Part 012 — Service Invocation Patterns: JavaDelegate vs External Task vs Message vs Outbox

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Bagian: `012`  
> Topik: Service invocation pattern dalam Camunda 7  
> Scope Java: Java 8 sampai Java 25, dengan catatan compatibility terhadap versi Camunda 7, Spring, Java EE/Jakarta EE, dan library runtime  
> Fokus: memilih boundary integrasi yang benar untuk correctness, reliability, observability, scalability, dan migration-readiness

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas:

1. engine architecture,
2. execution tree,
3. transaction boundary,
4. async continuation,
5. job executor,
6. database schema,
7. optimistic locking,
8. variable system,
9. expression/runtime binding,
10. extension points,
11. external task pattern.

Bagian ini mengikat semuanya ke pertanyaan yang sering terlihat sederhana, tetapi sebenarnya sangat menentukan kualitas arsitektur:

> Ketika proses Camunda 7 perlu “memanggil sesuatu”, pattern apa yang harus dipakai?

Pilihan umum:

1. `JavaDelegate` / delegate expression,
2. external task,
3. message correlation,
4. receive task,
5. send task,
6. connector,
7. outbox,
8. event/message broker integration,
9. hybrid orchestration.

Kesalahan umum engineer menengah adalah menganggap semuanya hanyalah cara berbeda untuk memanggil service.

Engineer senior melihatnya sebagai pilihan boundary:

```text
Apakah work dieksekusi di thread engine?
Apakah work ikut transaction engine?
Apakah process harus menunggu hasil langsung?
Apakah external side effect aman di-retry?
Apakah worker bisa diskalakan terpisah?
Apakah engine boleh tahu detail protocol eksternal?
Apakah proses harus tahan terhadap downtime service downstream?
Apakah long-running process harus tetap aman setelah versi Java class berubah?
Apakah integrasi ini mempersulit migrasi Camunda 7 ke Camunda 8?
```

Bagian ini akan membangun decision framework yang dapat dipakai untuk production system.

---

## 1. Core Mental Model: Invocation Is a Boundary Decision

Service invocation dalam workflow engine bukan sekadar:

```text
BPMN service task -> call Java method -> done
```

Yang sebenarnya terjadi adalah:

```text
Process state
  -> transaction boundary decision
  -> execution ownership decision
  -> failure ownership decision
  -> retry decision
  -> side-effect decision
  -> audit decision
  -> recovery decision
  -> operational ownership decision
```

Setiap pattern menjawab pertanyaan ini secara berbeda.

---

## 2. Empat Pertanyaan Utama Sebelum Memilih Pattern

Sebelum memilih JavaDelegate, external task, message, atau outbox, tanyakan empat hal ini.

### 2.1 Apakah Camunda Harus Mengeksekusi Work atau Hanya Mengorkestrasi Work?

Ada dua model:

```text
Model A — Engine executes
Camunda thread masuk ke Java code dan menjalankan logic.

Model B — Engine orchestrates
Camunda mencatat work item/event subscription, lalu pihak lain menjalankan logic.
```

JavaDelegate condong ke Model A.

External task, message correlation, dan outbox condong ke Model B.

Dalam sistem enterprise besar, Model B sering lebih aman karena engine tidak menjadi tempat semua integrasi teknis.

### 2.2 Apakah Side Effect Harus Ikut Rollback?

Database Camunda bisa rollback.

Tetapi ini tidak bisa rollback secara otomatis:

```text
HTTP POST ke payment service
email terkirim
file dikirim ke SFTP
message publish ke Kafka
push notification
call ke government API
update ke third-party CRM
```

Jika sebuah delegate mengirim email lalu exception terjadi sebelum Camunda commit, maka process state bisa rollback tetapi email sudah terkirim.

Ini adalah akar banyak bug:

```text
Process terlihat belum jalan,
tetapi external side effect sudah terjadi.
```

### 2.3 Siapa yang Bertanggung Jawab atas Retry?

Retry bisa dimiliki oleh:

1. Camunda Job Executor,
2. external worker,
3. message broker,
4. downstream service,
5. scheduler/outbox publisher,
6. operator manual.

Kalau ownership retry tidak eksplisit, sistem akan punya duplicate side effect, silent stuck state, atau retry storm.

### 2.4 Apakah Response Dibutuhkan Sekarang?

Kadang process butuh hasil langsung:

```text
Validate form input
Calculate simple premium
Resolve internal reference data
Decide next gateway condition
```

Kadang process hanya perlu mengirim command dan menunggu event berikutnya:

```text
Submit payment
Send external approval request
Wait for inspection result
Wait for document verification
Wait for external agency response
```

Salah satu design smell terbesar adalah memaksa semua hal menjadi synchronous call karena lebih mudah dikoding.

---

## 3. Pattern Map

Ringkasan awal:

| Pattern | Engine Thread? | Durable Wait? | Retry Owner | Coupling | Cocok Untuk |
|---|---:|---:|---|---|---|
| JavaDelegate synchronous | Ya | Tidak, kecuali mencapai wait state | Caller transaction / exception | Tinggi | local deterministic work |
| JavaDelegate + async | Job Executor | Ya, via job | Camunda job retry | Medium-tinggi | local work butuh retry boundary |
| External Task | Worker eksternal | Ya, external task row | Worker + Camunda external task retry | Medium-rendah | remote work, polyglot, scalable workers |
| Message Catch/Correlation | Tidak menjalankan work, menunggu event | Ya, event subscription | Event producer/consumer | Rendah | async event/result arrival |
| Outbox | App/service publisher | Ya, outbox row + process state | Outbox relay | Rendah-medium | reliable side effect publication |
| Connector | Engine thread/job | Tergantung async | Camunda/job/connector code | Medium | simple REST/SOAP, usually limited |
| Direct REST from UI to Engine | N/A | N/A | UI/backend | Very high exposure | usually avoid for enterprise boundary |

Tabel ini bukan aturan mutlak. Ini adalah starting point.

---

## 4. JavaDelegate Pattern

### 4.1 Apa Itu JavaDelegate?

`JavaDelegate` adalah class Java yang mengimplementasikan:

```java
public interface JavaDelegate {
    void execute(DelegateExecution execution) throws Exception;
}
```

Ketika token mencapai service task yang dikonfigurasi dengan delegate, engine memanggil method `execute`.

Contoh minimal:

```java
@Component("calculateRiskDelegate")
public final class CalculateRiskDelegate implements JavaDelegate {

    private final RiskScoringService riskScoringService;

    public CalculateRiskDelegate(RiskScoringService riskScoringService) {
        this.riskScoringService = riskScoringService;
    }

    @Override
    public void execute(DelegateExecution execution) {
        String applicationId = (String) execution.getVariable("applicationId");

        RiskScore score = riskScoringService.calculate(applicationId);

        execution.setVariable("riskScore", score.value());
        execution.setVariable("riskBand", score.band().name());
    }
}
```

BPMN:

```xml
<bpmn:serviceTask id="calculateRisk"
                  name="Calculate Risk"
                  camunda:delegateExpression="${calculateRiskDelegate}" />
```

### 4.2 Mental Model yang Benar

JavaDelegate bukan service layer.

JavaDelegate adalah adapter dari process engine ke application service.

Struktur yang baik:

```text
BPMN Service Task
  -> JavaDelegate adapter
       -> maps process variables to command/query DTO
       -> calls application service
       -> maps result back to process variables
```

Struktur yang buruk:

```text
BPMN Service Task
  -> JavaDelegate
       -> SQL query langsung
       -> HTTP call langsung
       -> if/else business policy
       -> JSON parsing
       -> retry loop sendiri
       -> audit insert sendiri
       -> task assignment side effect
```

Delegate buruk menjadi tempat campuran orchestration, domain logic, integration logic, retry logic, dan persistence logic.

### 4.3 Kapan JavaDelegate Cocok?

Gunakan JavaDelegate ketika work:

1. lokal terhadap aplikasi yang embed engine,
2. cepat,
3. deterministik,
4. tidak melakukan side effect eksternal berbahaya,
5. membutuhkan immediate result untuk next gateway,
6. memanfaatkan transaction lokal secara sengaja,
7. punya classpath stabil,
8. mudah dites.

Contoh cocok:

```text
Normalize input variable
Calculate derived field
Validate internal invariant
Map process variables
Create internal case row in same DB transaction, bila transaction manager memang sama
Select routing group based on local configuration
Evaluate simple policy not worth DMN
Generate document metadata, not file delivery
```

### 4.4 Kapan JavaDelegate Berbahaya?

Berbahaya jika delegate melakukan:

```text
remote HTTP call lambat
email sending
payment submission
SFTP upload
Kafka publish tanpa outbox
third-party API call tanpa idempotency
large object serialization
blocking IO panjang
sleep/retry loop manual
query history current command dengan asumsi sudah flushed/committed
class-specific object variable untuk long-running process
```

### 4.5 Synchronous JavaDelegate

Default service task delegate berjalan sinkron.

Call path sederhana:

```text
caller thread
  -> runtimeService/taskService API
  -> engine command
  -> token enters service task
  -> delegate executes
  -> token continues
  -> next wait state reached
  -> flush DB
  -> commit/return
```

Jika exception terjadi di tengah:

```text
exception
  -> command fails
  -> transaction rollback
  -> state kembali ke last committed wait state
```

Jika delegate sudah memanggil external service sebelum exception, external service tidak otomatis rollback.

### 4.6 JavaDelegate + asyncBefore

BPMN:

```xml
<bpmn:serviceTask id="generateInvoice"
                  name="Generate Invoice"
                  camunda:asyncBefore="true"
                  camunda:delegateExpression="${generateInvoiceDelegate}" />
```

Mental model:

```text
previous transaction
  -> reaches asyncBefore boundary
  -> creates job
  -> commits

job executor transaction
  -> locks job
  -> enters service task
  -> executes delegate
  -> continues
  -> commits or fails job
```

Keuntungan:

1. caller tidak menunggu delegate,
2. previous state sudah committed,
3. failure menjadi failed job/incident,
4. retry dikelola Job Executor,
5. operator bisa melihat dan retry.

Tetapi side effect masih at-least-once.

### 4.7 JavaDelegate + asyncAfter

BPMN:

```xml
<bpmn:serviceTask id="reserveNumber"
                  name="Reserve Number"
                  camunda:asyncAfter="true"
                  camunda:delegateExpression="${reserveNumberDelegate}" />
```

Mental model:

```text
job/caller transaction
  -> executes activity behavior
  -> invokes END listeners
  -> creates continuation job after activity
  -> commits

next job
  -> continues outgoing sequence flow
```

`asyncAfter` berguna ketika activity sudah selesai dan kita ingin commit sebelum melanjutkan ke path berikutnya.

Namun hati-hati:

```text
asyncAfter does not make side effect inside activity magically transactional.
```

Jika delegate melakukan HTTP POST lalu crash sebelum commit, POST sudah terjadi tetapi engine mungkin retry activity.

### 4.8 Clean Delegate Pattern

Pattern yang disarankan:

```java
@Component("submitApplicationDelegate")
public final class SubmitApplicationDelegate implements JavaDelegate {

    private final SubmitApplicationUseCase useCase;
    private final ProcessVariableMapper mapper;

    public SubmitApplicationDelegate(
            SubmitApplicationUseCase useCase,
            ProcessVariableMapper mapper) {
        this.useCase = useCase;
        this.mapper = mapper;
    }

    @Override
    public void execute(DelegateExecution execution) {
        SubmitApplicationCommand command = mapper.toSubmitCommand(execution);
        SubmitApplicationResult result = useCase.submit(command);
        mapper.writeSubmitResult(execution, result);
    }
}
```

Application use case tidak tahu Camunda:

```java
public interface SubmitApplicationUseCase {
    SubmitApplicationResult submit(SubmitApplicationCommand command);
}
```

Ini menjaga:

1. testability,
2. migration-readiness,
3. domain cleanliness,
4. reduced engine lock-in,
5. simpler observability.

---

## 5. External Task Pattern

### 5.1 Apa Itu External Task?

External task adalah pattern di mana process engine membuat unit of work durable, lalu worker eksternal melakukan `fetchAndLock`, menjalankan work, dan memanggil `complete`, `handleFailure`, atau `handleBpmnError`.

BPMN:

```xml
<bpmn:serviceTask id="validateAddress"
                  name="Validate Address"
                  camunda:type="external"
                  camunda:topic="address-validation" />
```

Worker Java conceptual:

```java
ExternalTaskClient client = ExternalTaskClient.create()
    .baseUrl("https://camunda.example.com/engine-rest")
    .asyncResponseTimeout(30_000)
    .build();

client.subscribe("address-validation")
    .lockDuration(60_000)
    .handler((externalTask, externalTaskService) -> {
        try {
            String applicationId = externalTask.getVariable("applicationId");

            AddressValidationResult result = validateAddress(applicationId);

            Map<String, Object> variables = Map.of(
                "addressValid", result.valid(),
                "addressConfidence", result.confidence()
            );

            externalTaskService.complete(externalTask, variables);
        } catch (RecoverableException e) {
            externalTaskService.handleFailure(
                externalTask,
                "Address validation failed",
                e.getMessage(),
                externalTask.getRetries() == null ? 3 : externalTask.getRetries() - 1,
                60_000
            );
        }
    })
    .open();
```

### 5.2 Mental Model

```text
Engine does not call the worker.
Worker asks engine: “do you have work for topic X?”
Engine locks task for worker.
Worker executes.
Worker tells engine result.
```

This is fundamentally different from JavaDelegate.

JavaDelegate:

```text
Engine pushes execution into Java code.
```

External Task:

```text
Worker pulls execution responsibility from engine.
```

### 5.3 Kapan External Task Cocok?

Gunakan external task ketika:

1. work remote atau IO-heavy,
2. worker ingin diskalakan terpisah,
3. service ditulis dalam bahasa lain,
4. engine tidak boleh membawa dependency teknis downstream,
5. lifecycle deployment worker harus independen dari engine,
6. work butuh backpressure,
7. call butuh long polling/pull model,
8. enterprise ingin gradual migration ke Camunda 8 style worker model,
9. security boundary memisahkan engine dan integration worker,
10. service task dapat dianggap command yang dikerjakan worker.

Contoh cocok:

```text
Call external payment provider
Call government registry API
Generate PDF large document
Upload file to S3/SFTP
Call OCR service
Call machine learning classifier
Send notification through notification platform
Sync with CRM
Process batch item
```

### 5.4 Kapan External Task Tidak Cocok?

Kurang cocok jika:

1. work sangat kecil dan lokal,
2. result dibutuhkan sangat cepat dalam same JVM,
3. deployment sederhana monolith lebih penting daripada isolation,
4. organisasi tidak siap menjalankan worker fleet,
5. tidak ada observability/backpressure/retry discipline.

External task bukan magic reliability. Ia memindahkan responsibility ke worker architecture.

### 5.5 External Task Failure Semantics

External task punya tiga hasil utama:

```text
complete
  -> work berhasil, process lanjut

handleFailure
  -> technical failure, retries berkurang, retry timeout berlaku

handleBpmnError
  -> expected business error, diarahkan ke BPMN error boundary/event path
```

Contoh taxonomy:

| Kondisi | Aksi |
|---|---|
| Downstream timeout | `handleFailure` |
| HTTP 503 | `handleFailure` |
| Rate limit | `handleFailure` dengan retry timeout lebih panjang |
| Invalid applicant identity | `handleBpmnError` |
| Address not found but allowed alternative path | `handleBpmnError` |
| Payload malformed karena bug worker | `handleFailure` lalu incident |
| Duplicate request already completed | `complete` idempotently |

### 5.6 Lock Duration Bukan Timeout Bisnis

Lock duration adalah lease:

```text
Selama lock belum expired, worker lain tidak boleh mengambil task itu.
```

Ia bukan SLA.
Ia bukan business timeout.
Ia bukan hard kill terhadap thread worker.

Jika worker hang lebih lama dari lock duration, task bisa diambil worker lain setelah lock expired.

Karena itu external task handler harus idempotent.

### 5.7 External Task dan Backpressure

External task memberi tempat untuk backpressure:

```text
maxTasks
lockDuration
worker concurrency
topic subscription
rate limiter
bulkhead per downstream
circuit breaker
retry timeout
```

Contoh:

```java
client.subscribe("document-generation")
    .lockDuration(5 * 60_000)
    .handler(new BoundedDocumentGenerationHandler(...))
    .open();
```

Tetapi official client handler tetap harus dikontrol oleh worker design. Jangan unlimited thread, jangan unlimited memory, jangan fetch lebih banyak daripada yang dapat diproses.

### 5.8 External Task Topic as Contract

Topic bukan string asal.

Topic adalah API contract.

Contoh buruk:

```text
call-service
send
validate
api-topic
misc
```

Contoh lebih baik:

```text
address.validation.v1
payment.authorize.v2
document.render-permit.v1
notification.send-email.v1
registry.lookup-corporate-profile.v1
```

Topic contract minimal:

```yaml
topic: payment.authorize.v1
inputVariables:
  - paymentRequestId
  - applicationId
  - amount
  - currency
outputVariables:
  - paymentAuthorizationId
  - paymentStatus
bpmnErrors:
  - PAYMENT_REJECTED
  - PAYMENT_METHOD_INVALID
technicalRetries:
  defaultRetries: 5
  retryTimeout: exponential, capped
idempotencyKey: paymentRequestId
owner: payment-platform-team
sla: 5 minutes p95
```

---

## 6. Message Correlation Pattern

### 6.1 Apa Itu Message dalam Camunda 7?

Message event adalah event dengan nama. Berbeda dari signal, message diarahkan ke satu recipient logis.

Dalam Camunda 7, process bisa:

1. start dari message start event,
2. wait pada intermediate message catch event,
3. wait pada receive task dengan message-like semantics,
4. menangkap message via event subprocess/boundary scenario tertentu.

Contoh BPMN:

```xml
<bpmn:message id="PaymentApprovedMessage" name="payment.approved.v1" />

<bpmn:intermediateCatchEvent id="waitForPaymentApproval" name="Wait for Payment Approval">
  <bpmn:messageEventDefinition messageRef="PaymentApprovedMessage" />
</bpmn:intermediateCatchEvent>
```

External system lalu melakukan correlation:

```java
runtimeService.createMessageCorrelation("payment.approved.v1")
    .processInstanceBusinessKey(applicationId)
    .setVariable("paymentAuthorizationId", authorizationId)
    .correlateWithResult();
```

### 6.2 Mental Model

Message correlation bukan “call service”.

Message correlation adalah:

```text
External event arrives
  -> engine finds matching subscription/process definition/instance
  -> engine delivers payload
  -> process continues
```

Process tidak memanggil dunia luar.
Process menunggu dunia luar memberi kabar.

### 6.3 Kapan Message Cocok?

Gunakan message when:

1. external result datang belakangan,
2. process harus wait for event,
3. downstream punya lifecycle sendiri,
4. external system tidak cocok dipanggil secara synchronous,
5. integration memakai event/message broker,
6. correlation key jelas,
7. result bisa datang dari banyak source,
8. process tidak perlu memegang thread/job selama menunggu.

Contoh:

```text
Payment approved/rejected
Document signed
Inspection completed
External agency response received
Manual verification callback
Bank transfer settled
Appeal submitted from external portal
Case reopened by separate module
```

### 6.4 Message Correlation Risk

Risiko utama:

```text
message arrives before subscription exists
message matches multiple subscriptions
message matches none
duplicate message
wrong business key
wrong tenant id
versioned message name mismatch
payload incompatible
```

### 6.5 Message Arrives Before Subscription Exists

Contoh bug:

```text
Process calls external service synchronously.
External service immediately publishes callback.
Process has not yet committed message catch event subscription.
Callback correlation fails: no matching execution.
```

Mitigasi:

1. commit process before sending command,
2. use async boundary before send command,
3. use outbox to publish command after transaction commit,
4. use inbox to store unmatched events and retry correlation,
5. use idempotent external correlation endpoint.

### 6.6 Correlation Key Design

Correlation key tidak boleh asal.

Contoh buruk:

```text
customerName
email
phoneNumber
latestApplicationId maybe null
```

Contoh baik:

```text
businessKey = applicationId
correlationKey = paymentRequestId
tenantId = agencyId
messageName = payment.approved.v1
```

Prinsip:

1. stable,
2. unique enough,
3. immutable,
4. known by both sides,
5. indexed if queried externally,
6. not PII if avoidable,
7. versioned if contract evolves.

### 6.7 Message as API Contract

Message contract minimal:

```yaml
messageName: inspection.completed.v1
businessKey: caseId
correlationVariables:
  inspectionRequestId: string
payloadVariables:
  inspectionResult: enum(PASS, FAIL, CONDITIONAL)
  inspectionCompletedAt: instant
  inspectorOfficerId: string
idempotencyKey: eventId
producer: inspection-service
consumer: enforcement-process
failureBehavior:
  noSubscription: store-in-inbox-and-retry
  duplicate: ignore-if-already-applied
  ambiguous: dead-letter-and-alert
```

### 6.8 Message vs External Task

External task:

```text
Process creates work.
Worker pulls work.
Worker completes task.
```

Message:

```text
Process waits.
External event arrives independently.
Correlation continues process.
```

External task is command/work dispatch.
Message is event/result arrival.

In many designs, they are paired:

```text
Process
  -> external task: submit payment request
  -> message catch: wait for payment approved/rejected
```

---

## 7. Outbox Pattern

### 7.1 Problem yang Dipecahkan Outbox

Camunda transaction bisa commit/rollback.

Message broker publish atau HTTP call tidak selalu ikut transaction yang sama.

Problem klasik:

```text
Update process state succeeds, publish event fails.
```

atau:

```text
Publish event succeeds, process transaction rolls back.
```

Outbox pattern menyelesaikan ini dengan menyimpan intent side effect ke database yang sama dengan business transaction, lalu publisher terpisah mengirimnya setelah commit.

### 7.2 Outbox dalam Camunda Context

Ada beberapa variasi.

#### Variation A — Application DB Outbox

Delegate/use case menulis ke application DB:

```text
business table update
outbox_event insert
Camunda process variable update
commit same application transaction if configured
```

Outbox relay membaca `outbox_event` dan publish ke broker/API.

#### Variation B — Camunda as Orchestrator, App Service Owns Outbox

Process memanggil application service via delegate/external task.
Application service menyimpan command/outbox di DB miliknya.
Camunda tidak mengelola outbox table directly.

Ini sering lebih clean.

#### Variation C — Process Command Outbox

Camunda process mencapai service task yang membuat outbox command:

```text
outbox_command(payment.authorize, payload, idempotencyKey)
```

Publisher mengirim command.
Process lalu menunggu message result.

### 7.3 Outbox Flow Ideal

```text
User completes task
  -> process reaches “request payment”
  -> transaction writes outbox command and process moves to wait-for-payment-result
  -> commit

Outbox relay
  -> reads unpublished command
  -> publishes to payment service/broker
  -> marks published

Payment service
  -> processes command idempotently
  -> emits payment.approved/payment.rejected event

Inbound event consumer
  -> stores inbox event
  -> correlates Camunda message
  -> marks inbox consumed
```

This pattern cleanly separates:

1. process state,
2. command publication,
3. external processing,
4. event ingestion,
5. correlation.

### 7.4 Minimal Outbox Schema

```sql
CREATE TABLE wf_outbox_event (
    id                VARCHAR(64) PRIMARY KEY,
    event_type        VARCHAR(128) NOT NULL,
    aggregate_type    VARCHAR(64) NOT NULL,
    aggregate_id      VARCHAR(128) NOT NULL,
    business_key      VARCHAR(128) NOT NULL,
    idempotency_key   VARCHAR(128) NOT NULL,
    payload_json      CLOB NOT NULL,
    status            VARCHAR(32) NOT NULL,
    retry_count       INTEGER NOT NULL,
    next_attempt_at   TIMESTAMP NOT NULL,
    created_at        TIMESTAMP NOT NULL,
    published_at      TIMESTAMP NULL,
    last_error        CLOB NULL
);

CREATE UNIQUE INDEX uq_wf_outbox_idem
    ON wf_outbox_event(idempotency_key);
```

### 7.5 Minimal Inbox Schema

```sql
CREATE TABLE wf_inbox_event (
    id                VARCHAR(64) PRIMARY KEY,
    event_type        VARCHAR(128) NOT NULL,
    business_key      VARCHAR(128) NOT NULL,
    correlation_key   VARCHAR(128) NULL,
    payload_json      CLOB NOT NULL,
    status            VARCHAR(32) NOT NULL,
    retry_count       INTEGER NOT NULL,
    next_attempt_at   TIMESTAMP NOT NULL,
    received_at       TIMESTAMP NOT NULL,
    consumed_at       TIMESTAMP NULL,
    last_error        CLOB NULL
);

CREATE UNIQUE INDEX uq_wf_inbox_event_id
    ON wf_inbox_event(id);
```

### 7.6 Outbox Pseudocode

```java
@Transactional
public RequestPaymentResult requestPayment(RequestPaymentCommand command) {
    PaymentRequest request = paymentRequestRepository.create(command);

    outboxRepository.insert(OutboxEvent.builder()
        .id(UUID.randomUUID().toString())
        .eventType("payment.authorize.requested.v1")
        .aggregateType("PaymentRequest")
        .aggregateId(request.id())
        .businessKey(command.applicationId())
        .idempotencyKey("payment-authorize:" + request.id())
        .payloadJson(paymentPayload(command, request))
        .status("PENDING")
        .retryCount(0)
        .nextAttemptAt(clock.instant())
        .createdAt(clock.instant())
        .build());

    return new RequestPaymentResult(request.id());
}
```

Delegate:

```java
@Component("requestPaymentDelegate")
public final class RequestPaymentDelegate implements JavaDelegate {

    private final RequestPaymentUseCase useCase;

    @Override
    public void execute(DelegateExecution execution) {
        String applicationId = (String) execution.getVariable("applicationId");
        BigDecimal amount = (BigDecimal) execution.getVariable("amount");

        RequestPaymentResult result = useCase.requestPayment(
            new RequestPaymentCommand(applicationId, amount)
        );

        execution.setVariable("paymentRequestId", result.paymentRequestId());
    }
}
```

Then BPMN waits for `payment.approved.v1` or `payment.rejected.v1`.

### 7.7 Outbox vs External Task

Outbox is not the same as external task.

External task:

```text
Camunda creates work item in ACT_RU_EXT_TASK.
Worker fetches from Camunda.
```

Outbox:

```text
Application stores message/command/event in app DB.
Publisher sends later.
```

External task is pull from engine.
Outbox is reliable publish from application.

They can be combined:

```text
External task worker calls local application service.
Application service writes outbox.
Worker completes external task.
Outbox relay publishes downstream command.
```

This is useful when worker should not directly call fragile downstream service.

---

## 8. Connector Pattern

Camunda 7 historically offers connectors for REST/SOAP-like calls.

Conceptually:

```text
BPMN element
  -> connector configuration
  -> engine executes connector
  -> result mapped to variables
```

Connector can be attractive because it reduces Java code.

But for serious enterprise platform engineering, connectors are usually limited.

### 8.1 When Connector May Be Acceptable

Connector may be acceptable for:

```text
simple internal HTTP GET/POST
prototype
low-risk integration
stable service
non-critical side effect
quick admin/ops workflow
```

### 8.2 Connector Risks

Risks:

1. business integration hidden in BPMN XML,
2. hard to unit test deeply,
3. limited retry/backoff/circuit breaker design,
4. weaker observability than dedicated code,
5. secrets/config drift,
6. long-running process version coupling,
7. harder migration to clean worker model.

For top-tier systems, prefer explicit adapter code or external worker unless connector usage is governed.

---

## 9. Send Task, Receive Task, and Service Task Semantics

BPMN has multiple task types.

Do not choose task type only because Modeler allows it.

### 9.1 Service Task

Use service task for automated work.

Implementation options:

```text
JavaDelegate
expression
delegateExpression
external task
connector
```

### 9.2 Send Task

A send task semantically means sending a message to an external participant.

In practice, many teams implement send task similarly to service task.

Use it when semantics matter in the diagram:

```text
Send Notification
Send Payment Request
Send Inspection Request
```

But still design reliability with async/outbox/external task.

### 9.3 Receive Task

Receive task waits for a signal/message-like external trigger.

Use receive task when you want explicit wait state and continuation via API.

Message catch event is often more semantically rich when the trigger is named message event.

### 9.4 Recommendation

For enterprise readability:

```text
Service Task      -> work execution
Send Task         -> semantic outbound message/command
Receive Task      -> simple wait for continuation
Message Catch     -> named external event correlation
External Task     -> external worker execution
```

---

## 10. Comparing Patterns by Dimension

### 10.1 Transaction Coupling

| Pattern | Coupled to engine transaction? | Notes |
|---|---:|---|
| Sync JavaDelegate | Strong | same command unless nested transaction used |
| Async JavaDelegate | Medium | job transaction separate from caller |
| External Task | Weak | worker transaction separate; completion call updates engine |
| Message | Weak | event receiver/correlator transaction separate |
| Outbox | Intentional | outbox row coupled to app transaction, not remote publish |
| Connector | Medium/strong | depends if sync or async boundary |

### 10.2 Failure Visibility

| Pattern | Failure Visibility |
|---|---|
| Sync JavaDelegate | caller exception; may not create incident unless job context |
| Async JavaDelegate | failed job / incident |
| External Task | external task retries / incident-like operational state |
| Message | missing correlation / inbox DLQ / engine error if correlation command fails |
| Outbox | outbox pending/retry/dead-letter |
| Connector | depends on async/job setup |

### 10.3 Scaling

| Pattern | Scaling Characteristic |
|---|---|
| Sync JavaDelegate | scales with engine app nodes |
| Async JavaDelegate | scales with job executor threads/nodes |
| External Task | scales independent worker fleet |
| Message | scales event ingestion/correlation layer |
| Outbox | scales publisher relay and broker |
| Connector | scales with engine/job executor |

### 10.4 Migration Readiness

| Pattern | Camunda 8 Migration Readiness |
|---|---|
| Clean delegate adapter | Medium if domain logic extracted |
| Heavy JavaDelegate | Low |
| External Task | High conceptual alignment |
| Message event | Medium-high, if BPMN-compatible and contract clean |
| Outbox/inbox | High architecture portability |
| Connector-heavy BPMN | Low-medium depending complexity |

---

## 11. Decision Framework

Use this decision flow.

### 11.1 Step 1 — Is Work Purely Local and Deterministic?

If yes:

```text
Use JavaDelegate, preferably clean delegate.
Use sync if fast and safe.
Use asyncBefore if failure should not rollback previous user/API action.
```

If no, continue.

### 11.2 Step 2 — Is Work Remote or Slow?

If yes:

```text
Prefer External Task.
```

Exception:

```text
If remote call is merely publishing a durable command/event, consider Outbox.
```

### 11.3 Step 3 — Does Process Need to Wait for External Result Later?

If yes:

```text
Use Message Catch / Receive Task.
```

Often paired with:

```text
External Task or Outbox to send request
Message Correlation to receive response
```

### 11.4 Step 4 — Is There Non-Transactional Side Effect?

If yes:

```text
Require idempotency.
Consider Outbox.
Avoid sync delegate direct call unless very carefully designed.
```

### 11.5 Step 5 — Does Integration Need Independent Deployment/Scaling?

If yes:

```text
External Task or event-driven service.
```

### 11.6 Step 6 — Is This a Regulatory/Audit-Critical Step?

If yes:

```text
Prefer explicit durable state transitions.
Avoid invisible listener side effects.
Prefer named message/event boundaries.
Record request id, event id, idempotency key, actor/system, timestamp.
```

---

## 12. Pattern Recipes

### 12.1 Fast Local Calculation

Use:

```text
JavaDelegate sync
```

BPMN:

```xml
<bpmn:serviceTask id="calculateFee"
                  name="Calculate Fee"
                  camunda:delegateExpression="${calculateFeeDelegate}" />
```

Rules:

```text
No remote IO.
No non-idempotent side effect.
Fast execution.
Deterministic output.
Clean mapping.
```

### 12.2 Local Work That May Fail and Should Be Retried

Use:

```text
JavaDelegate + asyncBefore + retry cycle
```

BPMN:

```xml
<bpmn:serviceTask id="generateInternalDocument"
                  name="Generate Internal Document"
                  camunda:asyncBefore="true"
                  camunda:delegateExpression="${generateInternalDocumentDelegate}">
  <bpmn:extensionElements>
    <camunda:failedJobRetryTimeCycle>R5/PT2M</camunda:failedJobRetryTimeCycle>
  </bpmn:extensionElements>
</bpmn:serviceTask>
```

Rules:

```text
Failure should create operational job state.
Previous user/API action should already commit.
Delegate must be idempotent.
```

### 12.3 Remote Call With Worker Fleet

Use:

```text
External Task
```

BPMN:

```xml
<bpmn:serviceTask id="lookupCompanyProfile"
                  name="Lookup Company Profile"
                  camunda:type="external"
                  camunda:topic="registry.company-profile.lookup.v1" />
```

Rules:

```text
Worker owns HTTP client, retry mapping, circuit breaker, metrics.
Worker completes with minimal variables.
Worker uses idempotency key.
Worker must support graceful shutdown.
```

### 12.4 Send Request and Wait for Callback

Use:

```text
Outbox or External Task to send request
Message Catch to wait result
```

BPMN:

```text
Request External Approval
  -> Wait for Approval Result Message
  -> Gateway approved/rejected
```

Rules:

```text
Never block process thread while waiting for external approval.
Use stable request id.
Use inbox for callback retry/no-subscription cases.
```

### 12.5 Publish Business Event After Milestone

Use:

```text
Outbox
```

Example:

```text
Permit Approved
  -> write outbox event permit.approved.v1
  -> process continues/ends
  -> relay publishes event
```

Rules:

```text
Do not publish directly from delegate if consistency matters.
Outbox event must be idempotent.
Consumers must tolerate duplicate delivery.
```

### 12.6 Human Workflow Escalation Notification

Use:

```text
Timer boundary/event
External Task or Outbox Notification Command
```

Avoid:

```text
TaskListener sends email synchronously on create.
```

Better:

```text
Task created
  -> listener sets metadata only
  -> outbox notification event created by explicit step or application service
  -> notification platform sends email/SMS
```

---

## 13. Regulatory Case Management Example

Imagine enforcement lifecycle:

```text
Application Received
  -> Validate Applicant
  -> Screen Risk
  -> Assign Officer
  -> Request External Agency Check
  -> Wait External Agency Result
  -> Officer Review
  -> Supervisor Approval
  -> Issue Decision Letter
  -> Notify Applicant
  -> Close Case
```

### 13.1 Naive Design

```text
All service tasks use JavaDelegate.
Delegates call every downstream service synchronously.
Task listeners send emails.
Variables store full Java objects.
No outbox.
No idempotency.
No message inbox.
```

Failure modes:

```text
Duplicate notifications.
Task complete rollback after external call.
Long HTTP call holds engine transaction.
External callback arrives before message subscription.
Cannot replay safely.
Cannot migrate easily.
Hard to explain to regulator.
```

### 13.2 Better Design

```text
Validate Applicant
  -> JavaDelegate sync if local deterministic validation

Screen Risk
  -> JavaDelegate sync or DMN if local

Request External Agency Check
  -> Outbox command OR External Task

Wait External Agency Result
  -> Message Catch Event

Issue Decision Letter
  -> External Task document.render-decision-letter.v1

Notify Applicant
  -> Outbox notification.requested.v1

Close Case
  -> JavaDelegate local state finalization
```

Key ids:

```text
businessKey = caseId
externalAgencyRequestId = stable correlation id
notificationRequestId = idempotency key
letterGenerationRequestId = idempotency key
```

Audit facts:

```text
who requested agency check
when request command was created
when command was published
when agency response arrived
which message id was correlated
which process instance consumed it
which variables changed at milestone
```

---

## 14. Idempotency Design per Pattern

### 14.1 JavaDelegate Idempotency

Delegate idempotency key can be:

```text
processInstanceId + activityId
businessKey + activityId
business command id variable
domain aggregate id
```

Example:

```java
String idempotencyKey = execution.getProcessInstanceId() + ":" + execution.getCurrentActivityId();
```

But for long-running business operation, prefer business id:

```java
String idempotencyKey = "decision-letter:" + caseId + ":" + decisionVersion;
```

### 14.2 External Task Idempotency

External task id is not always enough as business idempotency key.

Better:

```text
topic + business request id
```

Example:

```text
document.render-decision-letter.v1:case-123:decision-v2
```

### 14.3 Message Correlation Idempotency

Incoming event should have `eventId`.

Inbox should enforce uniqueness:

```sql
CREATE UNIQUE INDEX uq_inbox_event_id ON wf_inbox_event(id);
```

Correlation should be idempotent:

```text
If already consumed, ignore.
If process already moved past wait state, mark duplicate/late but do not crash entire consumer.
If ambiguous, DLQ and alert.
```

### 14.4 Outbox Idempotency

Outbox idempotency key should be deterministic:

```text
notification:case-123:decision-issued:v1
payment-authorize:payment-request-456
external-check:case-123:agency-A:v1
```

Publisher can retry safely.
Receiver should also deduplicate.

---

## 15. Retry Ownership Matrix

| Failure | Best Retry Owner | Notes |
|---|---|---|
| local deterministic transient failure | Job Executor | async delegate with retry cycle |
| remote HTTP timeout | external worker | worker-level retry/backoff/circuit breaker |
| broker unavailable on publish | outbox relay | durable pending event |
| callback cannot correlate yet | inbox correlation worker | retry until subscription exists or TTL/DLQ |
| business rejection | BPMN error/message path | not technical retry |
| validation error from user data | process path/user task | do not retry blindly |
| optimistic locking in job | Camunda job retry | often expected concurrency |
| duplicate external callback | inbox/idempotency | ignore or mark duplicate |

---

## 16. Observability by Pattern

### 16.1 JavaDelegate

Log:

```text
processInstanceId
businessKey
activityId
delegateName
command/useCase
idempotencyKey
duration
outcome
exception class
```

Metrics:

```text
delegate_duration_seconds
delegate_failure_total
delegate_retry_total if async job
```

### 16.2 External Task

Log:

```text
externalTaskId
workerId
topic
businessKey
processInstanceId
activityId
lockDuration
attempt/retry
idempotencyKey
downstreamStatus
```

Metrics:

```text
external_task_fetch_total
external_task_locked_total
external_task_completed_total
external_task_failed_total
external_task_bpmn_error_total
external_task_handler_duration_seconds
external_task_lock_expired_total
external_task_retries_remaining
```

### 16.3 Message Correlation

Log:

```text
eventId
messageName
businessKey
correlationKey
tenantId
processInstanceId if found
correlationResult
attempt
```

Metrics:

```text
message_correlation_success_total
message_correlation_no_match_total
message_correlation_duplicate_total
message_correlation_ambiguous_total
message_correlation_duration_seconds
```

### 16.4 Outbox/Inbox

Metrics:

```text
outbox_pending_total
outbox_publish_success_total
outbox_publish_failure_total
outbox_oldest_pending_age_seconds
inbox_pending_total
inbox_consume_success_total
inbox_consume_failure_total
inbox_oldest_pending_age_seconds
```

Production teams should alert on oldest pending age, not merely count.

---

## 17. Security by Pattern

### 17.1 JavaDelegate

Risks:

```text
Delegate has full app privileges.
BPMN can bind to beans if bean resolving too broad.
Sensitive variables can be read/written.
```

Controls:

```text
Restrict bean exposure.
Use dedicated delegate beans.
Do not expose generic admin service beans.
Mask sensitive variables in logs.
Avoid storing secrets in variables.
```

### 17.2 External Task

Risks:

```text
Worker can fetch tasks and variables.
REST API exposure.
Worker identity abuse.
Sensitive variable leakage.
```

Controls:

```text
Use authentication and authorization.
Limit topics per worker identity.
Fetch only needed variables if possible.
Use TLS.
Rotate credentials.
Audit worker id.
Do not log full variable payload.
```

### 17.3 Message Correlation

Risks:

```text
Spoofed event advances process.
Wrong business key manipulation.
Duplicate/ambiguous correlation.
```

Controls:

```text
Authenticate event source.
Validate schema.
Verify signature if cross-boundary.
Use idempotency event id.
Enforce tenant/agency boundary.
Keep correlation endpoint internal.
```

### 17.4 Outbox/Inbox

Risks:

```text
Payload contains PII.
Outbox replay duplicates sensitive notification.
DLQ exposes secrets.
```

Controls:

```text
Payload minimization.
Encryption at rest if needed.
PII masking in logs.
Deterministic idempotency.
Retention policy.
Access control on outbox/inbox tables.
```

---

## 18. Performance Considerations

### 18.1 JavaDelegate Performance

Sync delegates consume caller/engine transaction time.

Avoid:

```text
long blocking calls
large variable serialization
large DB queries through execution context
unbounded loops
sleep-based retry
```

Use async boundary when work may take longer or fail transiently.

### 18.2 External Task Performance

Bottlenecks:

```text
fetchAndLock polling pressure
REST API throughput
worker concurrency
downstream service capacity
lock duration too short causing duplicate work
variable payload too large
```

Control:

```text
long polling
bounded maxTasks
fetch only needed variables
topic partitioning
rate limiting
bulkhead per downstream
idempotent completion
```

### 18.3 Message Correlation Performance

Bottlenecks:

```text
correlation query ambiguity
unindexed business/correlation variables
high duplicate event volume
large payload setVariable
```

Control:

```text
use businessKey where possible
avoid relying only on variable correlation for hot paths
inbox worker batching with care
small payload variables
DLQ ambiguous events
```

### 18.4 Outbox Performance

Bottlenecks:

```text
outbox table growth
polling query full scan
large CLOB payload
publisher retry storm
broker downtime backlog
```

Control:

```text
status + next_attempt_at index
partition/archive old rows
limit batch size
exponential backoff
oldest age alert
payload references for large data
```

---

## 19. Anti-Patterns

### 19.1 God Delegate

```text
One delegate does validation, remote calls, routing, persistence, audit, notification, and variable mutation.
```

Fix:

```text
Split into explicit process steps or application use cases.
Keep delegate as adapter.
```

### 19.2 Synchronous Remote Call Chain

```text
Complete user task
  -> delegate calls A
  -> A calls B
  -> B calls C
  -> C times out
  -> process rollback
```

Fix:

```text
Async boundary + external task/outbox + message result.
```

### 19.3 Listener Side Effects

```text
TaskListener on create sends email.
```

Failure:

```text
Email sent but transaction rolls back.
Task never existed, but user got email.
```

Fix:

```text
Listener sets metadata only.
Explicit notification command/outbox after commit-safe boundary.
```

### 19.4 External Task Without Idempotency

```text
Worker calls downstream, crashes before complete.
Lock expires.
Another worker repeats call.
Duplicate side effect.
```

Fix:

```text
Business idempotency key.
Downstream deduplication.
Worker completion recovery.
```

### 19.5 Message Correlation Without Inbox

```text
Callback arrives, no process subscription yet, event lost.
```

Fix:

```text
Inbox stores event and retries correlation.
```

### 19.6 Process Variables as Integration Payload Dump

```text
Store entire REST request/response in process variables.
```

Fix:

```text
Store reference id, status, important facts, audit pointer.
Put large payload in document/object store with retention control.
```

### 19.7 Business Error as Technical Retry

```text
Customer not eligible -> throw RuntimeException -> job retries 3 times -> incident.
```

Fix:

```text
Use BPMN Error or business result path.
```

### 19.8 Technical Error as BPMN Error

```text
HTTP 503 -> BpmnError("SERVICE_UNAVAILABLE") -> process continues to business rejection path.
```

Fix:

```text
Use handleFailure/exception/job retry.
```

---

## 20. Java 8–25 Considerations

### 20.1 Java 8 Legacy Estate

Common reality:

```text
Camunda 7 legacy systems may run Java 8/11.
Delegates may use old Spring versions.
External workers may be easier to modernize separately.
```

Pattern implication:

```text
If engine app is stuck on Java 8, external tasks allow workers to run newer Java independently.
```

But compatibility must be checked against actual Camunda version.

### 20.2 Java 17/21 Modernization

External worker fleet can use:

```text
records
sealed interfaces
modern HTTP client
virtual-thread-aware blocking design, if runtime supports it
structured concurrency style, if available in chosen Java version and not preview constraints
```

But do not leak modern Java object serialization into process variables.

### 20.3 Java 25 Planning

For Java 25-era planning:

```text
Treat Camunda 7 engine compatibility separately from worker compatibility.
Use external tasks/outbox to isolate modern runtime adoption.
Avoid embedding engine into aggressively upgraded application runtime without vendor support verification.
```

### 20.4 `javax` / `jakarta` Boundary

Camunda 7 lineage lives heavily in `javax` ecosystem for many integrations.

If your enterprise app migrates to Spring Boot 3/Jakarta EE, be careful with:

```text
embedded Camunda 7 compatibility
servlet API namespace
JTA/CDI namespace
library transitive dependencies
container support
```

Pattern implication:

```text
External task/outbox/message-based architecture reduces pressure to run all process integration code inside same embedded engine app.
```

---

## 21. Clean Architecture Reference Model

A robust Camunda 7 service integration architecture can look like this:

```text
[Camunda Engine App]
  - BPMN deployment
  - thin delegates
  - process API facade
  - message correlation endpoint/consumer
  - process variables minimal facts

[Application Services]
  - use cases
  - domain logic
  - transactional business DB
  - outbox/inbox tables

[External Workers]
  - topic-specific execution
  - downstream clients
  - idempotency
  - backpressure
  - metrics/logging

[Messaging/Integration Layer]
  - broker/event bus
  - outbox relay
  - inbox consumer
  - DLQ/retry

[Downstream Systems]
  - payment
  - notification
  - registry
  - document generation
  - agency systems
```

Principle:

```text
Camunda owns process state.
Application services own domain state.
Workers own remote execution.
Outbox/inbox own reliable messaging.
Messages own asynchronous event transitions.
```

---

## 22. Practical Decision Table

| Use Case | Recommended Pattern | Why |
|---|---|---|
| Calculate fee from local variables | Sync JavaDelegate | fast deterministic local work |
| Persist internal case row in same transaction | JavaDelegate/use case with transaction integration | deliberate atomicity |
| Send email notification | Outbox or External Task | avoid side effect in engine transaction |
| Generate PDF | External Task | slow/IO-heavy, scalable worker |
| Call third-party API | External Task | isolation, retry, backpressure |
| Publish domain event | Outbox | reliable publication after commit |
| Wait for payment result | Message Catch | async external lifecycle |
| Wait for user action | User Task | human work item |
| Wait for external system callback | Message Catch + Inbox | durable event ingestion |
| Retry local technical failure | Async JavaDelegate | job retry/incident visibility |
| Business rejection | BPMN Error / gateway path | expected process alternative |
| Long-running external approval | Send command + Message wait | no blocking thread/job |
| Polyglot integration | External Task | worker can use any language |
| Migration toward Camunda 8 | External Task + clean events | closer conceptual model |

---

## 23. Implementation Blueprint: Request/Response Integration

Scenario:

```text
Camunda process needs external agency verification.
The agency responds asynchronously.
```

### 23.1 BPMN Shape

```text
Prepare Agency Check Request
  -> Publish Agency Check Request
  -> Wait for Agency Check Result
  -> Gateway: cleared / flagged / failed
```

### 23.2 Variables

```text
caseId
agencyCheckRequestId
agencyCheckStatus
agencyCheckResultSummary
agencyCheckReceivedAt
```

Avoid storing:

```text
full agency response XML/JSON as large process variable
raw PII unless necessary
HTTP headers/secrets
```

### 23.3 Outbox Command

```json
{
  "eventType": "agency-check.requested.v1",
  "eventId": "evt-001",
  "businessKey": "CASE-2026-0001",
  "agencyCheckRequestId": "ACR-7788",
  "payload": {
    "caseId": "CASE-2026-0001",
    "entityId": "ENT-123",
    "checkType": "COMPLIANCE"
  }
}
```

### 23.4 Incoming Message

```json
{
  "eventType": "agency-check.completed.v1",
  "eventId": "evt-009",
  "businessKey": "CASE-2026-0001",
  "agencyCheckRequestId": "ACR-7788",
  "result": "CLEARED",
  "completedAt": "2026-06-20T08:00:00Z"
}
```

### 23.5 Correlation

```java
runtimeService.createMessageCorrelation("agency-check.completed.v1")
    .processInstanceBusinessKey(event.businessKey())
    .processInstanceVariableEquals("agencyCheckRequestId", event.agencyCheckRequestId())
    .setVariable("agencyCheckStatus", event.result())
    .setVariable("agencyCheckReceivedAt", event.completedAt().toString())
    .correlateWithResult();
```

### 23.6 Failure Handling

| Failure | Handling |
|---|---|
| no subscription | keep inbox pending, retry later |
| ambiguous subscription | DLQ and alert |
| duplicate event | ignore if consumed |
| invalid schema | reject/DLQ |
| process canceled | mark late event, audit |
| technical DB failure | retry inbox consumer |

---

## 24. Implementation Blueprint: External Task Worker

Scenario:

```text
Render decision letter.
```

### 24.1 BPMN

```xml
<bpmn:serviceTask id="renderDecisionLetter"
                  name="Render Decision Letter"
                  camunda:type="external"
                  camunda:topic="document.render-decision-letter.v1" />
```

### 24.2 Worker Design

```text
Fetch topic
  -> build command from variables
  -> acquire idempotency record
  -> call document service
  -> store document reference
  -> complete external task with documentId
```

### 24.3 Pseudocode

```java
public final class RenderDecisionLetterHandler implements ExternalTaskHandler {

    private final DocumentService documentService;
    private final IdempotencyStore idempotencyStore;

    @Override
    public void execute(ExternalTask task, ExternalTaskService service) {
        String caseId = task.getVariable("caseId");
        String decisionId = task.getVariable("decisionId");
        String key = "decision-letter:" + caseId + ":" + decisionId;

        try {
            IdempotencyResult<DocumentRef> existing = idempotencyStore.findCompleted(key);
            if (existing.isCompleted()) {
                service.complete(task, Map.of("decisionLetterDocumentId", existing.value().id()));
                return;
            }

            DocumentRef ref = idempotencyStore.executeOnce(key, () ->
                documentService.renderDecisionLetter(caseId, decisionId)
            );

            service.complete(task, Map.of("decisionLetterDocumentId", ref.id()));
        } catch (BusinessTemplateMissingException e) {
            service.handleBpmnError(task, "DECISION_TEMPLATE_MISSING", e.getMessage());
        } catch (RecoverableDocumentException e) {
            int retries = task.getRetries() == null ? 5 : task.getRetries() - 1;
            service.handleFailure(task, "Document rendering failed", e.getMessage(), retries, 120_000);
        }
    }
}
```

### 24.4 Why This Works

It handles:

```text
duplicate worker execution
worker crash after downstream success
technical retry
business error path
minimal variable output
```

---

## 25. Pattern Selection Smells

Ask these questions in code/design review:

1. Why is this a JavaDelegate and not an External Task?
2. Why is this a synchronous call and not async boundary?
3. What happens if the external call succeeds but Camunda transaction rolls back?
4. What is the idempotency key?
5. Who owns retry?
6. Where can operator see failure?
7. What variable proves this side effect was requested?
8. What variable proves this side effect completed?
9. Can this process instance survive code upgrade?
10. Can this integration be tested without running full Camunda engine?
11. Can this pattern migrate to Camunda 8 later?
12. What happens if callback arrives early?
13. What happens if callback arrives twice?
14. What happens if worker dies after downstream success but before `complete`?
15. What happens if downstream is down for 2 hours?

A top 1% engineer does not merely ask “does it work now?”

They ask:

```text
What are the exact possible partial failure states?
Can each state be observed?
Can each state be recovered safely?
Can we prove duplicate execution does not break business invariants?
```

---

## 26. Testing Strategy by Pattern

### 26.1 JavaDelegate Tests

Test delegate as adapter:

```text
given process variables
when execute
then use case called with command
then result variables written
```

Test use case separately without Camunda.

### 26.2 Async Delegate Tests

Test:

```text
job is created at async boundary
failure decrements retries
incident appears when retries exhausted
retry execution is idempotent
```

### 26.3 External Task Tests

Test worker contract:

```text
input variables -> downstream command
success -> complete variables
recoverable failure -> handleFailure
business failure -> handleBpmnError
duplicate execution -> no duplicate side effect
lock expired scenario -> safe repeat
```

### 26.4 Message Correlation Tests

Test:

```text
event correlates expected process
wrong business key no match
duplicate ignored
ambiguous match rejected
early event stored and later correlated
```

### 26.5 Outbox/Inbox Tests

Test:

```text
transaction rollback does not insert published event
relay retries failed publish
relay marks success only after publish confirmed
duplicate relay execution safe
inbox duplicate event ignored
```

---

## 27. Operational Playbooks

### 27.1 JavaDelegate Failed

Checklist:

```text
Was task async?
Is there failed job?
What activity id?
What exception?
Any side effect already happened?
Is retry safe?
Should retries be increased or incident manually resolved?
```

### 27.2 External Task Stuck

Checklist:

```text
Is external task row present?
What topic?
Is it locked?
When lock expires?
Retries remaining?
Are workers polling same topic?
Are workers authenticated/authorized?
Is long polling queue saturated?
Is downstream circuit open?
```

### 27.3 Message Not Correlated

Checklist:

```text
Does process have active message subscription?
Correct message name?
Correct business key?
Correct tenant id?
Correct correlation variable?
Was message early?
Is event stored in inbox?
Was process version changed?
Was process instance canceled/migrated?
```

### 27.4 Outbox Backlog

Checklist:

```text
Oldest pending age?
Broker/downstream availability?
Publisher logs?
Retry backoff too long/short?
Poison message blocking batch?
Payload schema invalid?
DB index missing?
Archive/partition needed?
```

---

## 28. Production Checklist

Before releasing a Camunda service invocation step:

```text
[ ] Pattern is selected explicitly.
[ ] Transaction boundary is understood.
[ ] Retry owner is documented.
[ ] Idempotency key is defined.
[ ] Business errors and technical errors are separated.
[ ] Variables are minimal and version-tolerant.
[ ] Side effects are not hidden in listeners.
[ ] Failure is visible to operators.
[ ] Metrics and logs include businessKey/processInstanceId/activityId.
[ ] Security boundary is reviewed.
[ ] Performance impact is understood.
[ ] Duplicate execution is safe.
[ ] Early/late callback behavior is defined.
[ ] Migration impact is acceptable.
[ ] Test covers success, technical failure, business failure, duplicate, retry.
```

---

## 29. Summary Mental Model

The deepest lesson of this part:

```text
A service task is not a method call.
It is a reliability boundary.
```

JavaDelegate is good when:

```text
work is local, deterministic, fast, and safely transaction-scoped.
```

External Task is good when:

```text
work is remote, slow, polyglot, independently scalable, or operationally separate.
```

Message Correlation is good when:

```text
process waits for external event/result.
```

Outbox is good when:

```text
you must reliably publish command/event as part of a committed business state.
```

The real design skill is combining them:

```text
JavaDelegate for local mapping/calculation.
Async boundary for durable handoff.
External Task for remote execution.
Outbox for reliable publish.
Message Catch for asynchronous result.
Inbox for safe event ingestion.
```

---

## 30. What You Should Be Able to Do After This Part

You should now be able to:

1. explain why service invocation is a boundary decision,
2. choose JavaDelegate vs External Task vs Message vs Outbox,
3. identify side-effect rollback hazards,
4. design idempotency keys,
5. assign retry ownership,
6. separate technical failure from business outcome,
7. model asynchronous request/response safely,
8. design worker topic contracts,
9. define outbox/inbox schema,
10. review BPMN integration steps for production readiness,
11. reason about migration-readiness toward Camunda 8-style worker architecture.

---

## 31. Bridge to Part 013

Part 013 will go deeper into:

```text
Message Correlation, Signal, Event, Business Key, and Race Condition Control
```

This part introduced message correlation as one invocation/integration pattern.

The next part will dissect it fully:

1. message start event,
2. intermediate catch event,
3. receive task,
4. event subscription table,
5. business key,
6. correlation variables,
7. tenant boundary,
8. duplicate and ambiguous correlation,
9. early/late event race,
10. signal vs message,
11. event subprocess,
12. event ingestion architecture,
13. production diagnostic queries.

That topic deserves its own deep dive because message/event correlation is one of the most common sources of subtle production bugs in Camunda 7.

---

## References

- Camunda 7.24 Manual — Delegation Code: https://docs.camunda.org/manual/7.24/user-guide/process-engine/delegation-code/
- Camunda 7.24 Manual — External Tasks: https://docs.camunda.org/manual/7.24/user-guide/process-engine/external-tasks/
- Camunda 7.24 Manual — Message Events: https://docs.camunda.org/manual/7.24/reference/bpmn20/events/message-events/
- Camunda 7.24 Manual — Transactions in Processes: https://docs.camunda.org/manual/7.24/user-guide/process-engine/transactions-in-processes/
- Camunda Best Practices — Invoking services from a Camunda 7 process: https://unsupported.docs.camunda.io/8.1/docs/components/best-practices/development/invoking-services-from-the-process-c7/


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-011.md">⬅️ External Task Pattern Advanced: Pull Workers, Locking, Long Polling, Backpressure, dan Worker Fleet Design</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-013.md">Part 013 — Message Correlation, Signal, Event, Business Key, dan Race Condition Control ➡️</a>
</div>
