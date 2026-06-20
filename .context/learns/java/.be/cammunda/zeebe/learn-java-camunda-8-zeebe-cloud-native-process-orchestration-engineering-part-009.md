# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-009.md

# Part 009 — BPMN Modelling for Distributed Execution: Advanced Patterns and Anti-Patterns

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Bagian: `009 / 035`  
> Level: Advanced  
> Fokus: bagaimana mendesain BPMN untuk Camunda 8/Zeebe sebagai **distributed orchestration engine**, bukan sekadar menggambar flowchart proses.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas:

- Zeebe sebagai distributed workflow engine.
- Broker, gateway, partition, record stream, exporter, projection.
- Java/Camunda client evolution.
- Production-grade job worker.
- Worker correctness, idempotency, retry, duplicate execution.
- Variable discipline dan data contract.

Bagian ini masuk ke pertanyaan yang sering terlihat sederhana tetapi sebenarnya menentukan kualitas sistem:

> Bagaimana cara membuat model BPMN yang benar-benar cocok untuk dieksekusi di Camunda 8/Zeebe?

Banyak engineer bisa membuat BPMN yang “jalan”. Tetapi level senior/staff/top-tier engineer harus bisa menjawab:

1. Apakah model ini merepresentasikan proses bisnis atau hanya menyalin call graph microservices?
2. Apakah setiap service task punya boundary yang stabil?
3. Apakah error, retry, timer, message, dan human decision dimodelkan secara eksplisit?
4. Apakah model ini tetap bisa dioperasikan ketika worker mati, API eksternal lambat, payload berubah, atau instance berjalan berhari-hari?
5. Apakah model ini mudah di-debug di Operate?
6. Apakah model ini aman untuk versioning dan migration?
7. Apakah model ini memberi audit trail yang bisa dipertanggungjawabkan?

Pada Camunda 8, BPMN bukan hanya documentation. BPMN adalah executable contract antara:

- business lifecycle,
- orchestration engine,
- Java workers,
- human task system,
- external systems,
- observability/read-side,
- operations/support team,
- compliance/audit stakeholders.

Jika model BPMN buruk, Java worker terbaik pun hanya akan menjadi patch di atas proses yang salah.

---

## 1. Core Mental Model: BPMN as Durable Orchestration Contract

### 1.1 BPMN bukan flowchart

Flowchart biasanya menjawab:

> Setelah step A, step apa berikutnya?

Executable BPMN di Zeebe harus menjawab lebih banyak:

> Pada setiap titik proses, apa state yang durable, siapa/apa yang harus bertindak, event apa yang ditunggu, timeout apa yang berlaku, error apa yang mungkin terjadi, data apa yang masuk/keluar, dan bagaimana proses dilanjutkan setelah failure?

Perbedaan sederhananya:

| Flowchart | Executable BPMN di Zeebe |
|---|---|
| Visualisasi urutan aktivitas | Kontrak eksekusi proses |
| Bisa ambigu | Harus cukup deterministik untuk engine |
| Error sering tidak dimodelkan | Error/retry/incident harus dipikirkan |
| Tidak peduli payload | Variable contract penting |
| Tidak peduli operasi | Harus bisa di-debug di Operate |
| Tidak peduli idempotency | Worker duplicate execution harus diasumsikan |
| Tidak peduli versioning | Running instances bisa hidup lama |

BPMN yang baik bukan yang paling lengkap secara visual. BPMN yang baik adalah yang:

1. Menyatakan lifecycle bisnis dengan jelas.
2. Menyembunyikan detail teknis yang tidak penting.
3. Mengekspos failure boundary yang perlu dilihat operator/manusia.
4. Stabil terhadap perubahan implementasi service.
5. Bisa dieksekusi dengan aman dalam distributed system.

---

### 1.2 BPMN sebagai kontrak lintas boundary

Dalam Camunda 8, Zeebe broker tidak menjalankan business logic. Broker membuat job, menyimpan state, menunggu event, mengatur retry, dan melanjutkan token. Business logic dijalankan worker di luar engine.

Akibatnya, service task di BPMN adalah kontrak:

```text
BPMN Service Task
  -> job type
  -> worker implementation
  -> input variables
  -> output variables
  -> failure semantics
  -> retry behavior
  -> timeout expectation
  -> operational meaning
```

Jangan anggap service task sebagai “method call”. Anggap ia sebagai:

> durable execution obligation yang dapat diambil oleh worker, gagal, retry, timeout, duplicated, atau menjadi incident.

Jika mental model-nya method call, model akan cenderung terlalu granular, terlalu teknis, dan rapuh.

Jika mental model-nya durable contract, model akan cenderung stabil, jelas, dan operasional.

---

## 2. Prinsip Utama Modelling untuk Distributed Execution

### 2.1 Model business lifecycle, bukan implementation sequence

Pertanyaan yang harus diajukan saat membuat BPMN:

```text
Apakah step ini berarti bagi business process, operator, auditor, atau SLA?
```

Jika jawabannya tidak, mungkin step itu tidak layak menjadi BPMN task.

Contoh buruk:

```text
Receive Application
  -> Validate JSON
  -> Map DTO
  -> Call Applicant Service
  -> Call Address Service
  -> Call Document Service
  -> Save Application
  -> Publish Kafka Event
  -> Return Response
```

Ini lebih mirip call graph backend.

Contoh lebih baik:

```text
Receive Application
  -> Perform Eligibility Screening
  -> Request Missing Information? 
  -> Assign Case Officer
  -> Conduct Review
  -> Issue Decision
```

Detail seperti mapping DTO, save DB, dan publish event biasanya milik worker/domain service, bukan BPMN.

Bukan berarti BPMN tidak boleh punya technical task. Tetapi technical task harus ada karena punya makna orchestration, misalnya:

- menunggu respons sistem eksternal,
- memisahkan retry boundary,
- memberi incident point yang operasional,
- mengatur timeout/escalation,
- memodelkan compensation,
- menghasilkan audit milestone.

---

### 2.2 Setiap task harus punya alasan eksistensi

Untuk setiap service task, tanyakan:

1. Apa business meaning task ini?
2. Apa job type-nya?
3. Worker mana yang mengeksekusi?
4. Apa input minimum yang diperlukan?
5. Apa output yang dihasilkan?
6. Apa yang terjadi jika gagal sementara?
7. Apa yang terjadi jika gagal permanen?
8. Apakah failure-nya technical incident atau business rejection?
9. Apakah task ini idempotent?
10. Apakah task ini perlu terlihat sebagai milestone di Operate?
11. Apakah task ini perlu SLA/timer boundary?
12. Apakah task ini harus dipisah dari task sebelum/sesudahnya?

Jika tidak bisa menjawab, task itu belum siap masuk model executable.

---

### 2.3 Model wait states secara eksplisit

Dalam orchestration, wait state adalah titik yang sangat penting. Wait state berarti engine menyimpan state dan proses menunggu sesuatu.

Contoh wait state:

- service task menunggu worker complete/fail job,
- user task menunggu manusia,
- message catch event menunggu external message,
- timer event menunggu waktu,
- receive task menunggu signal/message-like event,
- call activity menunggu child process selesai.

Distributed execution membutuhkan wait state yang eksplisit karena:

1. proses bisa hidup lama,
2. worker bisa mati,
3. manusia bisa lambat,
4. external system bisa delay,
5. timeout harus bisa dikontrol,
6. operator perlu tahu proses sedang menunggu apa.

Anti-pattern:

```text
One service task: Process Application
```

Lalu worker melakukan semuanya:

- validate,
- call external registry,
- wait for manual approval by polling DB,
- issue decision,
- send notification.

Ini buruk karena engine hanya melihat satu job. Jika macet, Operate tidak bisa menjelaskan proses sedang berada di mana.

Model yang lebih baik:

```text
Validate Application
  -> Request External Registry Verification
  -> Wait for Verification Result
  -> Officer Review
  -> Issue Decision
  -> Notify Applicant
```

Titik tunggu external verification dan human review terlihat jelas.

---

### 2.4 Jangan mengubah BPMN menjadi distributed transaction fantasy

BPMN bukan cara untuk mendapatkan ACID transaction lintas microservices.

Camunda 8/Zeebe membantu mengatur long-running transaction dan saga, tetapi ia tidak membuat side effect eksternal menjadi atomic.

Jika proses:

```text
Reserve Inventory
  -> Charge Payment
  -> Create Shipment
```

Maka failure setelah `Charge Payment` tetap harus ditangani dengan:

- compensation,
- reconciliation,
- manual repair,
- refund,
- cancellation,
- state correction.

BPMN dapat memodelkan ini, tetapi tidak menghapus kompleksitasnya.

Mental model yang benar:

```text
Zeebe gives durable orchestration.
It does not give distributed ACID.
```

---

## 3. Service Task Granularity

Service task adalah salah satu modelling decision paling penting.

Terlalu besar membuat proses opaque. Terlalu kecil membuat proses noisy, lambat, sulit dikelola, dan rentan coupling.

---

### 3.1 Terlalu coarse-grained

Contoh:

```text
Process Application
```

Worker di baliknya melakukan 20 langkah.

Masalah:

1. Operate hanya menunjukkan satu step.
2. Incident tidak menjelaskan failure business stage.
3. Retry mengulang terlalu banyak side effect.
4. Sulit melanjutkan dari titik tertentu.
5. Human support tidak tahu status aktual.
6. Audit trail terlalu miskin.
7. SLA per stage tidak bisa dimonitor.

Coarse-grained task cocok jika:

- task benar-benar atomic dari perspektif proses,
- tidak ada intermediate state yang perlu dilihat,
- retry aman,
- failure-nya punya satu arti,
- durasi singkat,
- tidak ada external wait panjang.

---

### 3.2 Terlalu fine-grained

Contoh:

```text
Validate NRIC Format
  -> Trim Name
  -> Normalize Address
  -> Map Applicant DTO
  -> Insert Applicant Row
  -> Insert Application Row
  -> Insert Audit Row
```

Masalah:

1. BPMN menjadi implementasi teknis.
2. Perubahan internal service memaksa perubahan BPMN.
3. Terlalu banyak job overhead.
4. Variable menjadi noisy.
5. Diagram sulit dibaca business stakeholder.
6. Running instance versioning lebih berisiko.
7. Operator melihat detail yang tidak actionable.

Fine-grained task cocok jika setiap step punya:

- failure handling berbeda,
- owner berbeda,
- SLA berbeda,
- compensation berbeda,
- external dependency berbeda,
- audit meaning berbeda,
- human/operational meaning berbeda.

---

### 3.3 Heuristik granularitas service task

Gunakan pertanyaan berikut:

#### A. Apakah step ini punya business milestone?

Jika ya, cenderung layak menjadi task.

Contoh:

```text
Perform Eligibility Screening
Issue Provisional Approval
Send Enforcement Notice
```

#### B. Apakah step ini punya failure handling berbeda?

Jika ya, pisahkan.

Contoh:

```text
Verify Identity
Verify Payment
Verify License History
```

Masing-masing mungkin punya error dan recovery berbeda.

#### C. Apakah step ini memanggil sistem eksternal yang unreliable?

Jika ya, sering lebih baik dipisah.

Contoh:

```text
Retrieve Registry Record
Submit Case to External Agency
```

#### D. Apakah step ini perlu SLA/timer boundary?

Jika ya, pisahkan.

Contoh:

```text
Wait for Applicant Response
Wait for Agency Clearance
```

#### E. Apakah step ini perlu compensation?

Jika ya, pisahkan.

Contoh:

```text
Reserve Slot
Collect Fee
Issue Certificate
```

#### F. Apakah step ini hanya mapping/formatting/internal validation?

Jika ya, biasanya tetap di worker/domain service.

---

### 3.4 Practical decision table

| Candidate step | BPMN task? | Reason |
|---|---:|---|
| Validate JSON syntax | Usually no | Implementation detail |
| Check application eligibility | Yes | Business decision point |
| Map DTO to entity | No | Internal code detail |
| Call external registry | Often yes | External dependency/failure boundary |
| Save internal row | Usually no | Persistence detail unless audit milestone |
| Wait for applicant document | Yes | Long wait/human/external event |
| Send email notification | Maybe | Yes if notification failure matters operationally |
| Generate PDF | Maybe | Yes if expensive/auditable/failure-prone |
| Calculate risk score | Yes | Business decision input |
| Normalize postal code | No | Internal validation/transformation |
| Assign officer | Yes | Human workflow transition |
| Publish domain event | Usually no | Internal integration unless external milestone |

---

## 4. Boundary Stability

A BPMN model should survive internal code changes.

Service tasks should represent stable process capabilities, not unstable implementation operations.

---

### 4.1 Stable boundary examples

Stable:

```text
Perform Eligibility Screening
Assess Compliance Risk
Request Missing Documents
Conduct Officer Review
Issue Decision
Notify Applicant
```

These represent business capabilities.

Unstable:

```text
Call ApplicantServiceV2
Call RiskEngineEndpointA
Insert Into APPLICATION_TEMP
Map LegacyStatusCode
```

These reveal implementation details.

---

### 4.2 Job type naming

Bad job types:

```text
application-service.validateJson
risk-engine.callHttpEndpoint
legacy.insertRow
common.mapDto
```

Better job types:

```text
application.perform-eligibility-screening.v1
risk.assess-compliance-risk.v1
decision.issue-application-decision.v1
notification.notify-applicant.v1
```

A job type should be:

- business-capability oriented,
- versionable,
- stable,
- owned,
- observable,
- understandable in incident view.

---

### 4.3 Boundary ownership

Every task should have an owner.

Ownership means:

- who maintains worker,
- who owns failure,
- who responds to incident,
- who approves schema change,
- who validates business meaning,
- who monitors SLA.

A BPMN model without ownership becomes operational debt.

For every service task, define:

```text
Task name: Perform Eligibility Screening
Job type: application.perform-eligibility-screening.v1
Worker owner: Application BE team
Domain owner: Licensing business unit
Failure owner: Application BE L2
Input variables: applicationId, applicantId, tenantId
Output variables: eligibilityResult, eligibilityReasons
Retry: technical retry 3x
Business rejection: BPMN error ELIGIBILITY_FAILED
Incident escalation: L2 support after retry exhausted
```

This is not bureaucracy. This is what makes executable BPMN production-ready.

---

## 5. BPMN as Operational Interface

Camunda 8 gives tools like Operate and Tasklist. But those tools are only useful if model quality is good.

A process model is also an interface for operations.

---

### 5.1 Operator readability

When an incident happens, support should answer:

1. Which process instance is affected?
2. Which business case/application/customer is affected?
3. Which task failed?
4. Was it technical or business failure?
5. Which external system was involved?
6. Is retry safe?
7. Should manual repair happen?
8. What is the current business stage?

If the model has tasks like:

```text
Do Processing
Call Service
Update Status
Task 1
Task 2
```

then the model is not production-ready.

Better task names:

```text
Verify Applicant Identity
Assess Eligibility
Request Additional Documents
Wait for Applicant Submission
Conduct Officer Review
Approve Application
Reject Application
Notify Applicant of Decision
```

---

### 5.2 Incident visibility

Design tasks so incidents happen at meaningful places.

Bad:

```text
Complete Case Processing
```

Incident message:

```text
HTTP 500
```

Support asks: which part failed?

Better:

```text
Retrieve Company Registry Profile
Validate Licensing Conditions
Generate Approval Letter
Send Decision Notification
```

Now incident location gives actionable meaning.

---

### 5.3 Don’t hide long waits inside workers

Bad worker behavior:

```java
while (!externalSystemReady(applicationId)) {
    Thread.sleep(60_000);
}
completeJob();
```

Problems:

- job timeout risk,
- worker thread blocked,
- no process visibility,
- hard to scale,
- retry semantics unclear,
- impossible to reason about SLA.

Better BPMN:

```text
Submit Request to External System
  -> Wait for External System Result (message catch event)
  -> Continue Processing
```

Or:

```text
Submit Request
  -> Timer Wait 15 Minutes
  -> Check External Result
  -> Result Available?
      yes -> Continue
      no  -> repeat / escalate
```

Wait must belong to process, not hidden loop.

---

## 6. Modelling External System Interaction

External system calls are one of the biggest sources of failure.

Camunda 8 models should distinguish:

1. synchronous short call,
2. asynchronous request/response,
3. long-running external processing,
4. human/external submission,
5. unreliable batch/legacy integration.

---

### 6.1 Synchronous external call pattern

Use when:

- response is expected quickly,
- timeout is short,
- retry is safe,
- side effect is idempotent or read-only,
- external system contract is stable.

BPMN:

```text
Verify Address with External Registry
```

Worker:

```text
call registry
if transient failure -> fail job with retries
if no matching address -> throw BPMN error / return result
if success -> complete with registryResult
```

Do not model every HTTP detail.

---

### 6.2 Asynchronous request/response pattern

Use when external processing may take time.

BPMN:

```text
Submit Verification Request
  -> Wait for Verification Result Message
```

Why split?

- submission can fail independently,
- waiting is durable,
- external callback can correlate by key,
- timeout can be modelled,
- operator sees the process waiting.

Add boundary timer:

```text
Wait for Verification Result
  -- after PT48H --> Escalate Missing Verification
```

---

### 6.3 Polling pattern

Polling is sometimes unavoidable with legacy systems.

Bad:

```text
Worker loops internally until result available
```

Better:

```text
Submit Request
  -> Wait 10 Minutes
  -> Check Request Status
  -> Result Ready?
       yes -> Continue
       no  -> Attempts Exceeded?
              yes -> Escalate
              no  -> Wait 10 Minutes
```

This model makes waiting, attempts, and escalation visible.

But beware: if thousands of instances poll every minute, you can create load spikes. Consider:

- exponential backoff,
- batch status collector,
- external event bridge,
- aggregator worker,
- rate limiting,
- random jitter.

---

### 6.4 Fire-and-forget is rarely truly fire-and-forget

Example:

```text
Send Notification
```

If notification is not critical, worker may complete even if email provider is down after writing an outbox event.

But if notification has legal/compliance significance, it should be modelled explicitly:

```text
Generate Notice
  -> Send Notice
  -> Notice Sent?
      yes -> Continue
      no -> Manual Follow-up / Retry / Incident
```

Do not hide legally significant delivery failure.

---

## 7. Message Correlation Modelling

Messages in Camunda 8 are not sent directly to an instance. They are correlated using message name and correlation key.

This has design consequences.

---

### 7.1 Message name design

Bad:

```text
result
callback
complete
event
```

Better:

```text
application.verification-result-received.v1
payment.payment-confirmed.v1
document.additional-documents-submitted.v1
external-agency.clearance-response-received.v1
```

A message name should express:

- business event,
- direction,
- version,
- domain ownership.

---

### 7.2 Correlation key design

Bad correlation keys:

```text
userId
email
status
random UUID not known by sender
non-unique application type
```

Better:

```text
applicationId
externalRequestId
caseReferenceNo
paymentReferenceNo
agencySubmissionId
```

Correlation key must be:

- stable,
- unique enough,
- known to sender and process,
- not sensitive if avoidable,
- immutable,
- indexed/tracked in domain system,
- scoped by tenant if multi-tenant.

---

### 7.3 Message buffering and race conditions

A common race:

```text
Process submits external request.
External system replies very quickly.
Process has not reached message catch event yet.
```

If message TTL is configured properly, Zeebe can buffer unmatched messages for a period. But relying blindly on buffering is dangerous.

Design options:

1. Publish message with adequate TTL.
2. Ensure process reaches waiting state before external callback can arrive.
3. Use external callback inbox table and a correlator worker.
4. Store callback in domain DB and publish message once process is ready.
5. Model submission and wait carefully.

Do not assume temporal ordering across systems.

---

### 7.4 Message duplicate handling

External systems may send duplicate callbacks.

BPMN alone is not enough. Use:

- message id / unique id when publishing messages,
- domain callback inbox,
- idempotent correlator,
- duplicate detection table,
- business status guard.

Example:

```text
external_callback_inbox
- callback_id unique
- external_request_id
- payload_hash
- received_at
- processed_at
- correlation_status
```

The BPMN model should assume messages can be late, duplicated, or invalid.

---

## 8. Modelling Error Semantics

One of the most common modelling mistakes is mixing up:

- technical failure,
- business error,
- validation rejection,
- incident,
- escalation,
- compensation.

---

### 8.1 Technical failure

Technical failure means:

- temporary database error,
- HTTP 503,
- timeout,
- network failure,
- worker crash,
- auth token expired.

Usually handled by job retry.

BPMN does not need a visible branch for every transient technical failure.

Worker should fail job with retries.

---

### 8.2 Business error

Business error means:

- applicant ineligible,
- payment rejected,
- document invalid,
- clearance denied,
- quota exceeded.

This should often be represented in BPMN as:

- exclusive gateway based on result variable, or
- BPMN error boundary event if failure interrupts a task.

Example:

```text
Perform Eligibility Screening
  -> eligible?
       yes -> Continue Review
       no  -> Notify Ineligibility
```

or:

```text
Submit Payment
  -- BPMN Error PAYMENT_REJECTED --> Request Alternative Payment
```

---

### 8.3 Incident

Incident is not a business branch. Incident means engine needs human/operator intervention because execution cannot continue automatically.

Examples:

- retries exhausted,
- missing variable,
- expression evaluation error,
- no worker for job type,
- invalid BPMN configuration,
- non-recoverable worker error.

Do not model expected business rejection as incident.

Bad:

```text
Applicant is not eligible -> worker throws exception -> incident
```

Better:

```text
Applicant is not eligible -> worker completes with eligibilityResult = INELIGIBLE -> gateway routes to rejection path
```

or:

```text
worker throws BPMN error ELIGIBILITY_FAILED -> boundary event handles rejection
```

---

### 8.4 Escalation

Escalation is not always error.

Example:

```text
Wait for Applicant Documents
  -- after 7 days --> Send Reminder
  -- after 14 days --> Escalate to Officer
  -- after 30 days --> Close as No Response
```

Applicant has not “errored”. The process reached a deadline.

Model escalation with timers/events, not exceptions.

---

### 8.5 Compensation

Compensation means undoing or mitigating a completed successful action whose result is no longer desired.

Example:

```text
Reserve Exam Slot
Collect Fee
Applicant Cancels
  -> Release Exam Slot
  -> Refund Fee
```

Compensation must be idempotent. A compensation worker can also duplicate execute.

---

## 9. Timer Modelling Patterns

Timers are powerful but dangerous if abused.

---

### 9.1 Deadline pattern

```text
Wait for Applicant Response
  -- timer PT7D --> Send Reminder
  -- timer PT14D --> Escalate to Officer
```

Use for:

- SLA,
- regulatory deadline,
- human response due date,
- external agency timeout.

---

### 9.2 Periodic check pattern

```text
Wait PT15M
Check External Status
Result Ready?
```

Use for polling legacy systems.

But avoid high-frequency timers at huge scale. Thousands of instances with very short timers can become operationally expensive.

---

### 9.3 Business calendar limitation

If deadline depends on business calendar rules:

- working days,
- public holidays,
- agency-specific cut-off,
- timezone,
- jurisdiction,
- suspension period,

then do not hard-code naive BPMN durations everywhere.

Better:

```text
Calculate Response Deadline
  -> Wait Until calculatedDeadline
```

Where `calculatedDeadline` is produced by a domain service/calendar service.

---

### 9.4 Timer anti-patterns

Bad:

```text
Use timer as retry replacement for every HTTP failure
```

Use job retry for short transient technical failure.

Bad:

```text
Use thousands of 5-second timers for polling
```

Use external event/callback, batch polling, or controlled scheduler.

Bad:

```text
Put statutory deadline in worker local code only
```

Expose deadline in process variable and/or BPMN timer where operationally meaningful.

---

## 10. Gateway Modelling

Gateways look simple, but bad gateway modelling causes ambiguity and production defects.

---

### 10.1 Exclusive gateway

Use when exactly one path should be taken based on process data.

Good:

```text
Eligibility Result?
  eligible -> Officer Review
  ineligible -> Reject Application
  needsMoreInfo -> Request More Info
```

Rules:

1. Conditions must be mutually exclusive.
2. Provide default path where appropriate.
3. Avoid complex business logic expressions directly in BPMN.
4. Prefer a prior decision task/DMN/worker that produces a clear enum result.

Bad:

```text
${applicant.age > 21 && applicant.income / applicant.debt > someComplexExpression && ...}
```

Better:

```text
Assess Eligibility -> eligibilityOutcome
Gateway on eligibilityOutcome
```

---

### 10.2 Parallel gateway

Use when paths are truly independent and can proceed concurrently.

Bad use:

```text
Parallel gateway to speed up tasks that modify the same business aggregate unsafely
```

Parallel branches require careful variable and side-effect design.

Ask:

- Are branches independent?
- Do they write same variables?
- Do they call same external system?
- Is completion order irrelevant?
- What if one branch fails and another succeeds?
- Is compensation needed?

---

### 10.3 Event-based gateway

Use when process waits for one of multiple events.

Example:

```text
Wait for Applicant Response OR Withdrawal OR Deadline
```

This is useful for long-running human/external workflows.

Do not replace event-based gateway with polling flags in worker.

---

### 10.4 Gateway readability

Gateway labels should be questions:

```text
Application Complete?
Eligibility Passed?
Payment Confirmed?
Applicant Responded Before Deadline?
```

Outgoing sequence flow labels should be answers:

```text
Yes
No
Needs More Information
Rejected
Expired
```

This makes models readable to business and support.

---

## 11. Multi-Instance Modelling

Multi-instance is useful for fan-out/fan-in, but it can create scale and correctness problems.

---

### 11.1 Use cases

Good candidates:

- verify multiple documents,
- request approvals from multiple reviewers,
- process multiple line items,
- send notification to multiple recipients,
- check multiple external registries.

---

### 11.2 Sequential vs parallel multi-instance

Sequential:

- lower load,
- easier ordering,
- easier external rate limit,
- slower.

Parallel:

- faster,
- higher load,
- more concurrency issues,
- more variable merge concerns,
- harder failure semantics.

Decision:

| Condition | Prefer |
|---|---|
| External system rate-limited | Sequential or controlled batching |
| Items independent and many | Parallel with throttling strategy |
| Order matters | Sequential |
| Need fast completion | Parallel |
| Shared aggregate writes | Sequential or redesign |
| Human approvals | Depends on approval policy |

---

### 11.3 Completion condition

Example:

```text
Need approval from any 2 of 3 reviewers
```

Model carefully.

Questions:

1. What happens to remaining review tasks after condition met?
2. Are they cancelled?
3. Are decisions already made still auditable?
4. What if a reviewer rejects?
5. What if deadline expires?

Multi-instance plus user tasks can be tricky for audit and cancellation semantics.

---

### 11.4 Multi-instance anti-patterns

Bad:

```text
Parallel multi-instance over 50,000 records
```

BPMN is not a batch processing framework. Consider:

- batch worker,
- streaming platform,
- chunked orchestration,
- external batch job with process-level monitoring.

Bad:

```text
Each item writes to same variable list without discipline
```

Prefer item-specific result collection and deterministic aggregation.

---

## 12. Call Activity and Reusable Process Modelling

Call activity lets one process call another process.

This is powerful but can create coupling.

---

### 12.1 When to use call activity

Use call activity when subprocess has:

- independent lifecycle,
- reuse across parent processes,
- separate ownership,
- separate versioning concern,
- meaningful operational visibility,
- common business capability.

Examples:

```text
Perform Applicant Identity Verification
Conduct Payment Collection
Run Document Completeness Check
Conduct Enforcement Review
```

---

### 12.2 When not to use call activity

Avoid call activity for tiny implementation snippets.

Bad:

```text
Normalize Address Subprocess
Map Applicant DTO Subprocess
Set Status Subprocess
```

This adds overhead and version coupling without business value.

---

### 12.3 Parent-child contract

Define:

```text
Called process id
Version binding strategy
Input variables
Output variables
Error contract
Cancellation behavior
Tenant handling
Ownership
Compatibility promise
```

Call activity is not just visual reuse. It is process-to-process API.

---

### 12.4 Versioning concern

If parent calls “latest” child version, new deployments may affect running or newly started parent instances. If parent binds to specific version, upgrades are controlled but require governance.

Always document version strategy.

---

## 13. Human Workflow Modelling

Human steps are where business process meets real organizational behavior.

---

### 13.1 User task should represent decision/action, not screen

Bad:

```text
Open Application Screen
Click Save
Click Submit
```

Better:

```text
Review Application
Request Clarification
Approve Application
Reject Application
```

A user task is not a UI screen. It is a human responsibility.

---

### 13.2 Separate data entry from decision when needed

Sometimes one task is enough:

```text
Complete Application Review
```

But in regulated workflow, separate tasks may be needed:

```text
Prepare Assessment
  -> Senior Officer Approval
  -> Issue Decision
```

Reasons:

- maker-checker,
- audit trail,
- segregation of duties,
- different role assignment,
- SLA per role,
- review/approval evidence.

---

### 13.3 Assignment model

For each user task define:

- candidate group,
- assignee rule,
- claim policy,
- delegation policy,
- reassignment policy,
- due date,
- escalation path,
- completion variables,
- audit fields.

Bad:

```text
Task assigned to generic group forever, no escalation
```

Better:

```text
Officer Review
Candidate group: licensing-officer
Due date: reviewDueAt
Escalation: senior-officer after due date
Completion: reviewOutcome, reviewRemarks, reviewedBy, reviewedAt
```

---

### 13.4 Human decision as structured data

Completion variables should be explicit:

```json
{
  "reviewOutcome": "APPROVED",
  "reviewReasonCode": "MEETS_REQUIREMENTS",
  "reviewRemarks": "All documents verified.",
  "reviewedBy": "user-123",
  "reviewedAt": "2026-06-20T09:15:00+07:00"
}
```

Avoid unstructured blobs if decision drives routing.

---

## 14. Process Versioning-Friendly Modelling

BPMN models live longer than code deployments.

A process instance may run for days, weeks, or months. During that time:

- workers may be redeployed,
- BPMN may get new version,
- variable schema may evolve,
- external systems may change.

---

### 14.1 Stable process id

Process id should represent a stable lifecycle.

Bad:

```text
application-process-new-v2-final
```

Better:

```text
licensing-application-lifecycle
```

Version is handled by deployment/versioning, not random process id suffixes, unless intentionally creating a distinct process family.

---

### 14.2 Version task contracts

If variable contract changes incompatibly, version job type:

```text
application.assess-eligibility.v1
application.assess-eligibility.v2
```

Do not deploy a v2 worker that breaks running v1 instances.

---

### 14.3 Avoid expression coupling to deep JSON structures

Bad gateway expression:

```text
${application.applicant.financialInfo.incomeSources[0].amount > 1000}
```

This couples BPMN to DTO internals.

Better:

```text
Assess Financial Eligibility -> financialEligibilityOutcome
Gateway: financialEligibilityOutcome == "PASSED"
```

BPMN should route on stable process facts, not internal object graphs.

---

### 14.4 Evolution-safe variables

Prefer durable, stable variables:

```text
applicationId
caseId
tenantId
eligibilityOutcome
riskLevel
reviewOutcome
decisionOutcome
submissionReceivedAt
reviewDueAt
```

Avoid storing entire mutable domain aggregate as process variable.

---

## 15. Modelling for Audit and Regulatory Defensibility

In regulated systems, BPMN is not only execution. It is evidence.

A good model helps answer:

1. What happened?
2. When did it happen?
3. Who/what made the decision?
4. Based on what input?
5. What rule/version was used?
6. Was deadline respected?
7. Was escalation triggered?
8. Was override performed?
9. Was notification sent?
10. Is the final outcome explainable?

---

### 15.1 Explicit decision points

Bad:

```text
Process Case
```

Better:

```text
Assess Risk
  -> Low Risk? Auto Approve
  -> High Risk? Officer Review
  -> Reject? Issue Rejection Notice
```

Decision points should be visible where audit needs explainability.

---

### 15.2 Capture decision metadata

When worker or human produces a decision, store:

- outcome,
- reason code,
- rule version,
- input reference,
- actor/system,
- timestamp,
- trace/correlation id.

Example:

```json
{
  "riskAssessment": {
    "outcome": "HIGH_RISK",
    "reasonCodes": ["RECENT_VIOLATION", "MISSING_DOCUMENT"],
    "ruleSetVersion": "risk-rules-2026.06.01",
    "assessedAt": "2026-06-20T10:20:00+07:00",
    "assessedBy": "risk-worker-v3",
    "inputSnapshotRef": "s3://audit-bucket/risk-input/abc.json"
  }
}
```

Do not put massive snapshots directly into process variables. Store references.

---

### 15.3 Model override explicitly

In regulatory systems, override should not be hidden in DB updates.

Better:

```text
Officer Review
  -> Outcome?
      Approve
      Reject
      Escalate for Override
```

Then:

```text
Senior Override Review
  -> Override Approved?
```

This creates operational and audit visibility.

---

## 16. Process Modelling Patterns

This section collects reusable patterns.

---

### 16.1 Request missing information pattern

```text
Review Submission
  -> Information Complete?
       yes -> Continue Assessment
       no  -> Request Missing Information
              -> Wait for Applicant Submission
              -> Submission Received Before Deadline?
                   yes -> Review Submission
                   no  -> Close / Reject / Escalate
```

Key design points:

- request task records what is missing,
- wait state is explicit,
- timer handles deadline,
- loop is business-meaningful,
- number of cycles may be limited,
- applicant response is correlated by application/case id.

---

### 16.2 External agency clearance pattern

```text
Prepare Clearance Request
  -> Submit Clearance Request
  -> Wait for Clearance Response
      -- timer deadline --> Escalate Clearance Delay
  -> Clearance Result?
       cleared -> Continue
       rejected -> Handle Rejection
       unclear -> Manual Review
```

Key design points:

- submission and wait separated,
- response message correlated by external request id,
- timeout is process-level,
- result taxonomy explicit.

---

### 16.3 Auto-screen then manual review pattern

```text
Perform Automated Screening
  -> Screening Outcome?
       low-risk -> Auto Approve
       medium-risk -> Officer Review
       high-risk -> Senior Review
       ineligible -> Reject
```

Key design points:

- screening result is structured,
- gateway is simple,
- manual review only when needed,
- risk reason codes captured.

---

### 16.4 Maker-checker pattern

```text
Prepare Assessment
  -> Approver Review
  -> Approved?
       yes -> Issue Decision
       no  -> Return for Rework / Reject
```

Key design points:

- maker and checker roles separated,
- prevent same user from doing both if required,
- decision metadata captured,
- rework loop controlled.

---

### 16.5 Saga with compensation pattern

```text
Reserve Resource
  -> Collect Payment
  -> Issue Certificate
  -> Notify Applicant
```

If `Issue Certificate` fails after payment:

```text
Compensate Collect Payment -> Refund Payment
Compensate Reserve Resource -> Release Resource
```

Key design points:

- each forward step idempotent,
- compensation idempotent,
- compensation failure visible,
- manual repair path exists.

---

### 16.6 Reconciliation pattern

Use when external side effect status may be ambiguous.

```text
Submit Payment
  -> Payment Response Known?
       yes -> Continue
       unknown -> Reconcile Payment Status
                  -> Payment Confirmed?
                       yes -> Continue
                       no  -> Retry / Manual Review
```

Key design points:

- unknown is first-class state,
- do not assume timeout means failure,
- reconciliation may query external system by idempotency key.

---

### 16.7 Controlled retry with business escalation pattern

Technical retry should happen in job retries. But when retries are exhausted, incident may need business escalation.

Pattern:

```text
Call External Registry
  -> success -> Continue
  -> technical failure retries exhausted -> Incident
```

After support fix, retry.

For known external outage:

```text
Call External Registry
  -- BPMN error REGISTRY_UNAVAILABLE --> Wait 30 Minutes -> Retry Registry
```

Use carefully. Do not create infinite loops without governance.

---

## 17. Anti-Patterns

### 17.1 BPMN as microservice call graph

Symptom:

```text
Call A
Call B
Call C
Call D
Call E
```

without business semantics.

Why bad:

- tightly coupled to architecture,
- changes often,
- unreadable to business,
- no clear error taxonomy,
- turns process engine into service mesh.

Better:

Model business capabilities and hide internal service choreography inside worker/domain services unless orchestration needs visibility.

---

### 17.2 BPMN as CRUD script

Symptom:

```text
Insert Application
Update Status Pending
Insert Audit
Update Status Reviewed
Update Status Approved
```

Why bad:

- database implementation leaks into BPMN,
- migrations become painful,
- business meaning unclear.

Better:

```text
Receive Application
Conduct Review
Issue Decision
```

Persistence belongs in domain service unless status transition is a visible business milestone.

---

### 17.3 One giant “God process”

Symptom:

- huge diagram with 200 nodes,
- every exception path shown,
- unreadable without zooming,
- no subprocess boundaries,
- multiple teams editing same model.

Better:

Split using:

- embedded subprocess for local structure,
- call activity for reusable lifecycle,
- separate process for independent domain lifecycle,
- event/message boundaries for loose coupling.

---

### 17.4 Too many subprocesses

Opposite problem:

- every small step is a subprocess,
- navigation becomes painful,
- variable mapping becomes fragile,
- versioning complexity increases.

Subprocess should clarify structure, not hide complexity randomly.

---

### 17.5 Gateway with hidden complex logic

Bad:

```text
Gateway condition contains 20-line FEEL/expression-like business logic
```

Better:

Use DMN/decision worker/domain service to compute an outcome, then route simply.

---

### 17.6 Business rejection as technical exception

Bad:

```text
if applicant not eligible -> throw RuntimeException
```

Result: incident.

Better:

```text
complete with eligibilityOutcome = INELIGIBLE
```

or throw BPMN error if task should be interrupted and branch handled.

---

### 17.7 Technical retry as BPMN loop everywhere

Bad:

```text
Call API -> Failed? -> Wait -> Call API -> Failed? -> Wait -> ...
```

for every transient failure.

Better:

Use job retries for ordinary transient technical errors. Use BPMN loop only when retry/wait has business meaning or operational visibility requirement.

---

### 17.8 Storing huge domain object in variables

Bad:

```json
{
  "application": { huge nested object with documents, histories, comments, files }
}
```

Better:

```json
{
  "applicationId": "APP-2026-0001",
  "caseId": "CASE-123",
  "riskLevel": "HIGH",
  "reviewOutcome": "PENDING"
}
```

Keep domain data in domain DB. Put orchestration facts in variables.

---

### 17.9 Hidden wait inside Java worker

Already discussed, but important enough to repeat:

If a process is waiting, model waiting in BPMN.

Do not block worker threads for long business waits.

---

### 17.10 No default path

Exclusive gateway without default path may create incident/unexpected stuck execution when data is incomplete or a new enum value appears.

Use explicit default path for unknown/unexpected values when appropriate:

```text
Unknown Outcome -> Manual Review / Incident Handling
```

---

### 17.11 Mixing tenant data accidentally

In multi-tenant systems, message correlation and workers must respect tenant boundary.

Bad:

```text
correlationKey = applicationId
```

if `applicationId` is only unique inside tenant.

Better:

```text
correlationKey = tenantId + ':' + applicationId
```

or use tenant-aware engine features and domain uniqueness guarantees.

---

### 17.12 Assuming diagram readability means execution correctness

A pretty BPMN diagram can still be wrong.

Execution correctness requires:

- retry semantics,
- idempotency,
- variable contracts,
- message correlation,
- timer behavior,
- versioning,
- operational support.

---

## 18. Modelling Review Checklist

Use this checklist before deploying a BPMN model.

---

### 18.1 Business clarity

- [ ] Does the model express business lifecycle, not internal call graph?
- [ ] Are task names business meaningful?
- [ ] Are gateways phrased as business questions?
- [ ] Are outgoing flows labelled clearly?
- [ ] Can a non-engineer stakeholder understand the main path?

---

### 18.2 Execution clarity

- [ ] Does every service task have a job type?
- [ ] Is every job type owned by a worker team?
- [ ] Are input variables defined?
- [ ] Are output variables defined?
- [ ] Are retry semantics defined?
- [ ] Are BPMN errors defined where needed?
- [ ] Are incidents expected only for unexpected/unrecoverable technical execution problems?

---

### 18.3 Distributed correctness

- [ ] Are workers idempotent?
- [ ] Are external side effects protected by idempotency keys?
- [ ] Are ambiguous external results reconciled?
- [ ] Are duplicate messages handled?
- [ ] Are timeouts not misinterpreted as business failure?
- [ ] Are long waits modelled in BPMN, not inside workers?

---

### 18.4 Variable discipline

- [ ] Are variables minimal?
- [ ] Are large payloads replaced with references?
- [ ] Are sensitive fields avoided/masked?
- [ ] Are enum values stable?
- [ ] Are variable schema changes versioned?
- [ ] Are gateway expressions simple and stable?

---

### 18.5 Operational readiness

- [ ] Can Operate show meaningful current state?
- [ ] Are incident locations actionable?
- [ ] Are task names support-friendly?
- [ ] Are correlation IDs captured?
- [ ] Are business keys/case references visible?
- [ ] Are runbooks linked to task/incident types?

---

### 18.6 Versioning readiness

- [ ] Can running old instances continue after deployment?
- [ ] Are job type changes backward-compatible?
- [ ] Are call activity versions controlled?
- [ ] Are variable schema changes compatible?
- [ ] Is rollback plan known?

---

### 18.7 Compliance readiness

- [ ] Are decision points explicit?
- [ ] Are human approvals captured?
- [ ] Are reason codes stored?
- [ ] Are deadlines visible?
- [ ] Are escalations modelled?
- [ ] Are overrides explicit?
- [ ] Is audit data stored safely outside huge variables?

---

## 19. Example: From Bad Model to Good Model

### 19.1 Bad model

```text
Start Application
  -> Process Application
  -> Complete Application
```

Worker `Process Application` does:

1. validate documents,
2. call external registry,
3. calculate risk,
4. create officer task in custom DB,
5. poll until officer approves,
6. generate decision,
7. email applicant.

Problems:

- no visibility,
- hidden human workflow,
- hidden external wait,
- giant retry boundary,
- duplicate execution risk,
- poor audit,
- incident useless,
- difficult versioning.

---

### 19.2 Better model

```text
Application Submitted
  -> Validate Submission Completeness
  -> Complete?
       no  -> Request Missing Information
              -> Wait for Applicant Response
              -> Response Before Deadline?
                   yes -> Validate Submission Completeness
                   no  -> Close Application as Incomplete
       yes -> Retrieve External Registry Profile
              -> Assess Eligibility and Risk
              -> Risk Outcome?
                   low-risk -> Auto Approve
                   medium-risk -> Officer Review
                   high-risk -> Senior Officer Review
                   ineligible -> Reject Application
              -> Issue Decision
              -> Notify Applicant
```

Properties:

- business lifecycle visible,
- retry boundary meaningful,
- human decisions explicit,
- external dependency visible,
- SLA possible,
- audit meaningful,
- worker contracts clearer.

---

### 19.3 Even better with async external clearance

```text
Application Submitted
  -> Validate Submission Completeness
  -> Submit External Clearance Request
  -> Wait for Clearance Response
      -- after 5 working days --> Escalate Clearance Delay
  -> Clearance Result?
       cleared -> Assess Eligibility and Risk
       rejected -> Reject Application
       unclear -> Manual Clearance Review
```

Now the external wait is not hidden inside a worker.

---

## 20. Example Job Contract for a Modelled Task

Task:

```text
Assess Eligibility and Risk
```

Contract:

```yaml
taskName: Assess Eligibility and Risk
jobType: application.assess-eligibility-risk.v1
owner: application-backend-team
inputVariables:
  - applicationId
  - applicantId
  - tenantId
  - submissionVersion
outputVariables:
  - eligibilityOutcome
  - riskLevel
  - riskReasonCodes
  - assessmentRef
businessErrors:
  - code: APPLICATION_NOT_FOUND
    handling: incident/manual support, because this means data corruption
  - code: INELIGIBLE
    handling: route to rejection path
technicalFailures:
  - database timeout: retry
  - risk service unavailable: retry
  - invalid variable schema: incident
idempotency:
  key: processInstanceKey + ':assess-eligibility-risk:v1'
observability:
  logFields:
    - processInstanceKey
    - jobKey
    - applicationId
    - tenantId
    - assessmentRef
```

This is the level of clarity expected from production-grade BPMN modelling.

---

## 21. Java Worker Implication of Modelling Choices

BPMN modelling directly shapes Java worker design.

---

### 21.1 Coarse task implies complex worker

If BPMN has one task:

```text
Process Application
```

Java worker becomes:

- large,
- stateful,
- multi-step,
- hard to retry,
- hard to test,
- hard to make idempotent,
- hard to map errors.

---

### 21.2 Proper task boundary simplifies worker

If BPMN has:

```text
Retrieve Registry Profile
Assess Eligibility
Generate Decision Letter
Send Notification
```

Each worker can have:

- narrow input,
- narrow output,
- clear idempotency key,
- focused retry semantics,
- focused test cases,
- focused observability.

---

### 21.3 Model-driven package organization

Example Java package layout:

```text
com.example.workflow.application
  ApplicationLifecycleProcess.java
  variables/
    ApplicationVariables.java
    EligibilityAssessmentResult.java
  workers/
    ValidateSubmissionCompletenessWorker.java
    RetrieveRegistryProfileWorker.java
    AssessEligibilityRiskWorker.java
    GenerateDecisionLetterWorker.java
    NotifyApplicantWorker.java
  errors/
    ApplicationBpmnErrors.java
  idempotency/
    WorkerExecutionDedupService.java
```

BPMN tasks and Java worker classes should map cleanly, but domain logic should still live behind application services.

---

## 22. Advanced Heuristics for Top-Tier Modelling

### 22.1 If support cannot interpret it, it is not production-ready

A model that only developers understand is incomplete.

Operate is used during incidents. Task names and paths must be meaningful under pressure.

---

### 22.2 If every code change requires BPMN change, boundary is too technical

BPMN should not change when:

- DTO mapping changes,
- repository implementation changes,
- endpoint path changes,
- internal service class changes.

BPMN should change when:

- business lifecycle changes,
- decision policy changes,
- SLA changes,
- new human role appears,
- new external dependency becomes process-relevant,
- failure handling changes.

---

### 22.3 If a branch has no owner, it is risk

Every exceptional path needs an owner.

```text
Manual Review
Escalate Delay
Handle Rejection
Resolve Data Mismatch
```

These are not just boxes. They imply people, queues, permissions, forms, and SLA.

---

### 22.4 If a gateway uses raw technical status, improve abstraction

Bad:

```text
httpStatus == 200
httpStatus == 409
httpStatus == 500
```

Better:

```text
verificationOutcome == VERIFIED
verificationOutcome == NOT_FOUND
verificationOutcome == TEMPORARILY_UNAVAILABLE
verificationOutcome == DATA_CONFLICT
```

BPMN should route on domain outcomes.

---

### 22.5 If process waits, the model should say what it waits for

Bad:

```text
Pending
```

Better:

```text
Wait for Applicant Documents
Wait for External Clearance Response
Wait for Senior Officer Approval
Wait for Payment Confirmation
```

“Pending” is not a state. It is an absence of explanation.

---

### 22.6 If retry changes business meaning, model it explicitly

Technical retry:

```text
Call API failed due to network -> retry same job
```

Business retry:

```text
Applicant submitted incomplete documents -> request correction again
```

The second is not technical retry. It is business loop and should be visible.

---

## 23. BPMN Model Review Template

Use this as an engineering review artefact.

```markdown
# BPMN Model Review

## Process
- BPMN process id:
- Process name:
- Owner:
- Version:
- Business lifecycle:

## Main Path
- Start condition:
- Primary milestones:
- End states:

## Service Tasks
| Task | Job Type | Owner | Input | Output | Retry | BPMN Error | Incident Owner |
|---|---|---|---|---|---|---|---|

## User Tasks
| Task | Candidate Group | Assignee Rule | Due Date | Escalation | Completion Variables |
|---|---|---|---|---|---|

## Messages
| Message | Correlation Key | TTL | Publisher | Duplicate Handling |
|---|---|---|---|---|

## Timers
| Timer | Meaning | Duration/Date Source | Escalation Path |
|---|---|---|---|

## Variables
| Variable | Type | Owner | Scope | Versioning | Sensitive? |
|---|---|---|---|---|---|

## Error Handling
- Technical failures:
- Business errors:
- Incidents:
- Manual repair path:

## Versioning
- Compatible with running instances?
- Job type compatibility:
- Variable schema compatibility:
- Rollback plan:

## Observability
- Correlation fields:
- Dashboard impact:
- Alerts:
- Runbook:

## Compliance
- Decision points:
- Audit evidence:
- Reason codes:
- Override path:
```

---

## 24. Relation to Official Camunda Guidance

Camunda official best practices emphasize that BPMN/DMN modelling should be both conceptual and practical, not only diagrammatic. Camunda documentation also describes job workers as the implementation mechanism for service tasks, and clarifies that clients send commands such as starting instances, publishing messages, activating jobs, completing jobs, failing jobs, and resolving incidents, while Zeebe brokers do not execute business logic directly.

This supports the core modelling principle in this part:

> BPMN should define orchestration state and execution obligations, while Java workers execute business capabilities outside the broker.

Important official documentation topics related to this part:

- Camunda Best Practices overview.
- Creating readable process models.
- Writing good workers.
- Dealing with problems and exceptions.
- Zeebe architecture.
- Variables.
- Messages.
- Message events.
- Compensation events.
- BPMN coverage in Camunda 8.

References are listed at the end.

---

## 25. Key Takeaways

1. BPMN in Camunda 8 is an executable orchestration contract, not a decorative flowchart.
2. Model business lifecycle, not Java method sequence or microservice call graph.
3. Service task granularity should be driven by business meaning, failure boundary, SLA, compensation, ownership, and operational visibility.
4. Long waits must be modelled explicitly using user tasks, message events, timer events, or receive-like patterns.
5. Technical retry belongs mostly in job retry; business retry belongs in BPMN.
6. Business rejection should not become technical incident.
7. Message correlation needs disciplined message names, stable correlation keys, TTL, and duplicate handling.
8. Timers should represent deadlines, escalation, or controlled polling, not arbitrary sleep loops.
9. Gateways should route on stable domain outcomes, not low-level technical details.
10. Multi-instance and parallel paths require careful load, variable, and side-effect design.
11. Call activity is a process API, not just diagram reuse.
12. Human tasks should represent responsibilities and decisions, not UI clicks.
13. BPMN design directly affects Java worker size, idempotency, testing, and operational support.
14. A model is production-ready only if support, audit, engineering, and business can reason about it.

---

## 26. Practical Exercise

Take an existing business process you know, for example:

```text
Application submission -> review -> approval/rejection -> notification
```

Create three versions:

1. **Bad technical model**: model every service call and DB update.
2. **Bad opaque model**: model everything as one big service task.
3. **Production-grade Zeebe model**: model business milestones, external waits, human decisions, timers, error branches, and service task contracts.

Then review using the checklist in section 18.

The goal is not to make the diagram bigger. The goal is to make the process more truthful, operable, and resilient.

---

## 27. References

- Camunda Docs — Best Practices: https://docs.camunda.io/docs/components/best-practices/best-practices-overview/
- Camunda Docs — Creating readable process models: https://docs.camunda.io/docs/components/best-practices/modeling/creating-readable-process-models/
- Camunda Docs — Writing good workers: https://docs.camunda.io/docs/components/best-practices/development/writing-good-workers/
- Camunda Docs — Dealing with problems and exceptions: https://docs.camunda.io/docs/components/best-practices/development/dealing-with-problems-and-exceptions/
- Camunda Docs — Zeebe Architecture: https://docs.camunda.io/docs/components/zeebe/technical-concepts/architecture/
- Camunda Docs — Variables: https://docs.camunda.io/docs/components/concepts/variables/
- Camunda Docs — Messages: https://docs.camunda.io/docs/components/concepts/messages/
- Camunda Docs — Message events: https://docs.camunda.io/docs/components/modeler/bpmn/message-events/
- Camunda Docs — BPMN coverage: https://docs.camunda.io/docs/components/modeler/bpmn/bpmn-coverage/
- Camunda Docs — Compensation events: https://docs.camunda.io/docs/components/modeler/bpmn/compensation-events/
- Camunda Docs — Java Client: https://docs.camunda.io/docs/apis-tools/java-client/getting-started/
- Camunda Docs — Job Worker: https://docs.camunda.io/docs/apis-tools/java-client/job-worker/

---

## 28. Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-010.md
```

Judul berikutnya:

```text
Part 010 — Process Instantiation, Business Keys, Correlation Keys, and Message Design
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-008.md">⬅️ Part 008 — Variables, Serialization, Payload Discipline, and Data Contracts</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-010.md">Part 010 — Process Instantiation, Business Keys, Correlation Keys, and Message Design ➡️</a>
</div>
