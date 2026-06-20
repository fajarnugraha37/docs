# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-004.md

# Part 004 — BPMN Execution Semantics in Zeebe: What Actually Runs, Waits, and Persists

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Bagian: `004 / 035`  
> Level: Advanced  
> Fokus: runtime semantics BPMN di Camunda 8 / Zeebe, bukan sekadar notasi diagram  
> Target pembaca: Java engineer yang sudah paham Java, distributed systems, BPMN dasar, Camunda 7, dan ingin memahami bagaimana Camunda 8 benar-benar mengeksekusi proses

---

## 0. Tujuan Bagian Ini

Bagian ini menjawab pertanyaan inti:

> Ketika sebuah model BPMN dijalankan di Camunda 8 / Zeebe, apa yang benar-benar terjadi di runtime?

Banyak engineer bisa membaca diagram BPMN, tetapi belum tentu memahami konsekuensi runtime-nya. Di Zeebe, setiap elemen BPMN bukan hanya simbol visual. Elemen tersebut berarti:

- apakah proses langsung lanjut atau berhenti;
- apakah state dipersist;
- apakah job dibuat;
- apakah worker Java harus mengambil pekerjaan;
- apakah message harus dikorelasikan;
- apakah timer harus dijadwalkan;
- apakah incident bisa muncul;
- apakah token paralel akan dibuat;
- apakah retry berada di level worker, BPMN, atau business flow;
- apakah proses mudah dioperasikan ketika production incident terjadi.

Part ini akan membangun mental model untuk membaca BPMN sebagai **runtime state machine**, bukan sebagai flowchart pasif.

---

## 1. Sumber Konseptual Utama

Materi ini dirancang mengikuti model Camunda 8 / Zeebe modern, khususnya:

1. Camunda 8 BPMN coverage, yaitu daftar elemen BPMN yang didukung untuk modelling dan/atau execution.
2. Service task semantics: ketika service task dimasuki, Zeebe membuat job dan process instance berhenti sampai job selesai.
3. User task semantics: user task adalah work item manusia yang dikelola oleh engine/Tasklist depending implementation type.
4. Timer events: timer start, intermediate timer catch, dan boundary timer events.
5. Event subprocess: subprocess yang dipicu event, bisa berada di level process atau embedded subprocess.
6. Call activity: reusable subprocess yang memanggil process lain.
7. Incident semantics: incident muncul ketika Zeebe tidak bisa melanjutkan process instance.

Catatan penting: Camunda 8 terus berkembang. Beberapa detail user task dan API berubah pada generasi 8.7/8.8/8.9. Prinsip di part ini difokuskan pada mental model yang stabil: **execution state lives in Zeebe; UI/projection/components expose views and interaction surfaces**.

---

## 2. BPMN di Zeebe Bukan Sekadar Diagram

Di level modelling, BPMN sering tampak seperti ini:

```text
Start -> Validate Application -> Review -> Approve -> Notify -> End
```

Tetapi di runtime Zeebe, diagram tersebut lebih tepat dibaca seperti ini:

```text
Process definition deployed
  -> process instance created
  -> token enters start event
  -> token enters service task Validate Application
  -> Zeebe creates job type = validate-application
  -> process instance waits
  -> Java worker activates job
  -> Java worker performs side effect / domain logic
  -> Java worker completes, fails, or throws BPMN error
  -> Zeebe records transition
  -> token moves to next element
  -> token enters user task Review
  -> Zeebe creates human task / waits for completion
  -> user or API completes task
  -> token moves onward
```

Diagram adalah **declaration of orchestration behavior**. Runtime adalah kombinasi dari:

- persisted process state;
- event stream records;
- active tokens;
- wait states;
- jobs;
- messages;
- timers;
- variables;
- incidents;
- exported read models.

Top 1% engineer tidak hanya bertanya:

> Apakah diagramnya benar?

Tetapi bertanya:

> Ketika diagram ini berjalan selama 3 bulan, worker restart, message datang lebih awal, external API duplicate, user task overdue, dan deployment versi baru masuk, apakah proses ini tetap benar?

---

## 3. Core Runtime Vocabulary

Sebelum masuk elemen BPMN, kita tetapkan istilah runtime.

### 3.1 Process Definition

Process definition adalah hasil deploy BPMN ke Camunda 8.

Satu BPMN process biasanya memiliki:

- BPMN process id;
- version;
- process definition key;
- tenant context jika multi-tenancy digunakan;
- metadata extension Zeebe seperti job type, forms, input/output mappings.

Process definition bukan process instance. Definition adalah blueprint; instance adalah eksekusi konkret.

---

### 3.2 Process Instance

Process instance adalah satu eksekusi dari process definition.

Contoh:

```text
Process definition:
  LicenseApplicationReview v5

Process instance:
  applicationId = APP-2026-000381
  processInstanceKey = 2251799813689123
```

Process instance menyimpan state orchestration, bukan seluruh state domain. Domain state tetap sebaiknya hidup di database domain aplikasi.

---

### 3.3 Token

Token adalah mental model BPMN untuk posisi aktif eksekusi.

Jika proses linear, biasanya ada satu token.

```text
A -> B -> C
```

Jika parallel gateway, multi-instance, atau event subprocess aktif, token bisa lebih dari satu.

```text
        -> Check A ->
Start ->             -> Join -> End
        -> Check B ->
```

Token bukan object Java yang Anda manipulasi. Token adalah cara memahami bahwa process instance sedang aktif di satu atau lebih flow node.

---

### 3.4 Flow Node

Flow node adalah elemen BPMN yang bisa dimasuki token, seperti:

- start event;
- end event;
- service task;
- user task;
- gateway;
- subprocess;
- call activity;
- timer event;
- message event.

Setiap flow node memiliki lifecycle internal: entered, activated, completed, terminated, atau state lain depending element.

---

### 3.5 Sequence Flow

Sequence flow adalah edge antar node. Tetapi sequence flow bukan “method call”. Sequence flow adalah routing rule untuk token.

Pada exclusive gateway, sequence flow memiliki condition expression. Pada parallel gateway, sequence flow bisa menciptakan beberapa token.

---

### 3.6 Wait State

Wait state adalah titik di mana process instance berhenti dan state-nya dipersist sampai event eksternal terjadi.

Contoh wait state:

- service task menunggu job completion;
- user task menunggu human completion;
- message catch event menunggu message correlation;
- timer catch event menunggu waktu tertentu;
- receive task menunggu message;
- call activity menunggu child process selesai;
- parallel join menunggu token lain.

Wait state adalah konsep paling penting dalam executable BPMN.

Jika tidak ada wait state, proses bisa lanjut secara sinkron di dalam engine sampai mencapai wait state berikutnya atau end event.

---

### 3.7 Job

Job adalah unit pekerjaan yang harus dieksekusi oleh worker eksternal.

Service task di Zeebe umumnya membuat job. Worker Java mengambil job berdasarkan `job type`, mengeksekusi logic, lalu mengirim command:

- complete job;
- fail job;
- throw BPMN error;
- update retries;
- report problem that may become incident.

Job adalah kontrak antara BPMN dan worker.

---

### 3.8 Incident

Incident adalah kondisi ketika Zeebe tidak bisa melanjutkan process instance tanpa intervensi atau perbaikan.

Contoh:

- job retries habis;
- expression gagal dievaluasi;
- variable tidak sesuai;
- called process tidak ditemukan;
- message correlation/flow error tertentu;
- error teknis yang membuat state tidak bisa maju.

Incident bukan sekadar log error. Incident adalah **runtime blocking state**.

---

## 4. Cara Membaca BPMN sebagai State Machine

Flowchart biasa dibaca begini:

```text
Lakukan A, lalu B, lalu C.
```

Zeebe BPMN harus dibaca begini:

```text
Token enters A.
Does A complete immediately, create a job, wait for user, wait for message, or schedule timer?
When A completes, what event causes continuation?
What state is persisted while waiting?
What happens if the event arrives twice?
What happens if worker fails after side effect?
What happens if deployment changes while instance waits?
```

Contoh sederhana:

```text
Start -> Service Task: Validate -> User Task: Review -> End
```

Runtime interpretation:

```text
1. Create process instance.
2. Start event completes immediately.
3. Service task entered.
4. Zeebe creates job `validate`.
5. Instance waits.
6. Worker activates job.
7. Worker validates.
8. Worker completes job.
9. User task entered.
10. Human task created.
11. Instance waits.
12. User completes task.
13. End event reached.
14. Instance completes.
```

Important distinction:

```text
Service task is not executed by the broker.
User task is not completed by the diagram.
Message event is not magic.
Timer is not Java sleep.
Gateway does not call services.
```

Everything is event-driven state progression.

---

## 5. Immediate Nodes vs Wait-State Nodes

A useful classification:

| BPMN element | Runtime behavior | Usually wait state? | External actor required? |
|---|---:|---:|---:|
| Start event | starts token | no, except message/timer start semantics | sometimes |
| End event | completes path/process | no | no |
| Exclusive gateway | routes token | no | no |
| Parallel split | creates multiple tokens | no | no |
| Parallel join | waits for tokens | yes, if not all arrived | no direct external actor |
| Service task | creates job | yes | Java worker |
| User task | creates human task | yes | user/API |
| Intermediate timer catch | schedules timer | yes | time |
| Intermediate message catch | waits for message | yes | external publisher |
| Boundary timer | attaches timer to activity | yes while activity active | time |
| Boundary message/error | attaches event to activity | yes while activity active | external/worker/error |
| Call activity | starts child process | yes until child completes | child process path |
| Multi-instance | creates repeated body executions | often | workers/users/messages depending body |

This table is more important than BPMN icons.

Why? Because production correctness depends on wait states.

At each wait state, ask:

1. What resumes the process?
2. Who owns the resume event?
3. Can the resume event happen twice?
4. Can the resume event happen before the process waits?
5. How long can it wait?
6. What if it never resumes?
7. What operational view shows it?
8. What incident or escalation exists?

---

## 6. Start Events

A start event creates the first token of a process instance.

Common start types:

- none start event;
- message start event;
- timer start event.

---

### 6.1 None Start Event

A none start event means process starts when a client explicitly creates an instance.

Example Java-side command conceptually:

```java
client
    .newCreateInstanceCommand()
    .bpmnProcessId("license-application-review")
    .latestVersion()
    .variables(Map.of("applicationId", "APP-2026-000381"))
    .send()
    .join();
```

Runtime:

```text
Client sends command
  -> Zeebe creates process instance
  -> token enters none start event
  -> token immediately leaves start event
  -> proceeds to next element
```

Design implication:

- good when your application explicitly controls creation;
- useful for REST API initiated workflows;
- safer when you want validation before starting process;
- easier to attach business id and initial variables.

---

### 6.2 Message Start Event

A message start event starts a process when a matching message is published.

Runtime:

```text
External system publishes message
  -> message name + correlation key matched to message start subscription
  -> Zeebe creates process instance
  -> token starts from message start event
```

Use when the process is event-originated.

Examples:

- payment received starts reconciliation;
- document uploaded starts review;
- external agency sends case notification;
- webhook event starts process.

Design hazards:

1. Duplicate messages may start duplicate instances if uniqueness is not designed.
2. Correlation key must be stable and unique enough.
3. Message TTL affects buffering.
4. Message start is less explicit than REST-created instance.
5. It can be harder to validate payload before instance creation.

For critical regulatory processes, prefer explicit create-instance API when you need strong pre-validation and audit around process creation.

---

### 6.3 Timer Start Event

Timer start event starts instances based on time.

Use cases:

- nightly batch orchestration;
- periodic SLA audit;
- scheduled reconciliation;
- recurring reminder generation.

Design hazards:

- timer start can create load spikes;
- schedule semantics must be reviewed carefully;
- avoid using process engine as generic cron replacement for high-frequency technical jobs;
- recurring process instances must be idempotent.

A timer-started process should still have a business reason, not just “run code every minute”.

---

## 7. End Events

End event completes a path. If it is the last active token, process instance completes.

Basic runtime:

```text
Token enters end event
  -> token is consumed
  -> if no active tokens remain, process instance completes
```

Important nuance:

In parallel flows, one token reaching an end event does not necessarily complete the whole process if other tokens remain active.

Example:

```text
        -> Task A -> End A
Start ->
        -> Task B -> End B
```

If Task A finishes first, only that branch ends. The instance is still active until Task B also ends.

---

### 7.1 Terminate End Event

A terminate end event ends the entire scope. It terminates other active paths in the same scope.

Use carefully.

Good use cases:

- fatal business cancellation;
- mutually exclusive race where one branch winning should stop all others;
- user explicitly withdraws application;
- fraud detection terminates normal processing.

Danger:

- can accidentally kill active work;
- may terminate tasks users are handling;
- may bypass expected compensation if modelled poorly;
- can surprise support teams in Operate.

Rule:

> Use terminate end event only when business semantics truly mean “stop everything in this scope now”.

---

## 8. Service Task Runtime Semantics

Service task is the core automation element in Camunda 8.

Runtime:

```text
Token enters service task
  -> Zeebe creates job with configured job type
  -> token waits at service task
  -> worker activates job
  -> worker executes logic
  -> worker completes/fails/throws BPMN error
  -> Zeebe continues or creates incident/handles error path
```

Camunda documentation states that when a service task is entered, a corresponding job is created and the process instance waits until the job is complete.

---

### 8.1 Service Task Is Not JavaDelegate

In Camunda 7, many Java engineers used:

```java
public class ValidateApplicationDelegate implements JavaDelegate {
    @Override
    public void execute(DelegateExecution execution) {
        // logic inside engine transaction
    }
}
```

In Camunda 8, the corresponding model is external worker:

```java
@JobWorker(type = "validate-application")
public Map<String, Object> validate(final ActivatedJob job) {
    // logic outside broker
    return Map.of("validationStatus", "PASSED");
}
```

Mental shift:

| Camunda 7 | Camunda 8 / Zeebe |
|---|---|
| JavaDelegate inside engine app | external job worker outside broker |
| same JVM often possible | remote client interaction |
| DB transaction may include process engine state | process state and business DB are separate |
| synchronous execution style common | asynchronous job completion style |
| engine can call Java directly | worker pulls/activates jobs |

This changes correctness.

In Camunda 7, one often relies on transaction rollback semantics. In Camunda 8, you must design idempotency and side-effect boundaries explicitly.

---

### 8.2 Job Type Is an API Contract

A service task has a job type.

Example:

```text
job type = validate-application
```

This is not just a label. It is a contract between process model and worker deployment.

Contract includes:

- job type name;
- expected input variables;
- expected output variables;
- BPMN errors the worker may throw;
- retry behavior;
- timeout expectation;
- idempotency semantics;
- ownership team;
- version compatibility.

Bad job type names:

```text
do-stuff
process
service-task-1
call-api
update
```

Better names:

```text
application.validate-eligibility.v1
payment.reserve-funds.v2
case.assign-reviewer.v1
notification.send-approval-email.v1
```

A top-level production convention:

```text
<domain>.<capability>.<action>[.vN]
```

Example:

```text
license.application.validate-submission.v1
license.application.create-case.v1
license.review.assign-officer.v1
license.notification.send-submission-receipt.v1
```

---

### 8.3 Service Task Waits Until Completion

The process does not continue just because worker activated the job.

Sequence:

```text
1. job created
2. worker activates
3. worker processes
4. worker sends complete command
5. broker accepts complete command
6. service task completes
7. token moves on
```

If worker crashes after activation but before completion:

```text
job remains active until timeout
  -> then becomes activatable again
```

Therefore worker code must tolerate duplicate execution.

---

### 8.4 Job Timeout Is Not Business Timeout

Job timeout controls how long a worker owns an activated job before Zeebe makes it available again.

It is not the same as:

- SLA deadline;
- external API timeout;
- user deadline;
- regulatory deadline;
- business escalation timer.

Example:

```text
Service task: Call external risk engine
Job timeout: 2 minutes
HTTP client timeout: 10 seconds
Business SLA: risk check must complete within 1 business day
```

Do not encode business SLA as job timeout.

Use BPMN timer boundary/event subprocess for business time semantics.

---

### 8.5 Service Task Completion Variables

When a worker completes a job, it may return variables.

Example:

```java
return Map.of(
    "riskScore", 72,
    "riskCategory", "MEDIUM",
    "riskCheckedAt", "2026-06-20T10:15:30Z"
);
```

Design rule:

> Return only orchestration-relevant outputs, not full domain objects.

Bad:

```json
{
  "entireApplicationJson": "... 2MB payload ...",
  "allUploadedDocumentsBase64": "...",
  "fullApplicantProfile": { }
}
```

Better:

```json
{
  "applicationId": "APP-2026-000381",
  "riskCheckId": "RISK-87219",
  "riskCategory": "MEDIUM"
}
```

---

## 9. User Task Runtime Semantics

User task represents work to be performed by a human.

Runtime mental model:

```text
Token enters user task
  -> human task is created
  -> process instance waits
  -> user/task API completes task
  -> task completion variables are applied
  -> token continues
```

In Camunda 8, user tasks can be surfaced via Tasklist or custom task applications using APIs. Modern Camunda 8 also distinguishes between task implementation approaches in some contexts, especially around engine-native Camunda user tasks versus job-worker-like task patterns. For this part, the key mental model is: **the process waits for human completion**.

---

### 9.1 User Task Is a Human Wait State

A user task can wait for minutes, days, months, or longer.

Therefore it must be designed with:

- assignment;
- candidate groups;
- authorization;
- SLA;
- escalation;
- form data;
- audit;
- reassignment;
- cancellation;
- stale task handling;
- process version compatibility.

Do not treat user task as “just another service task”. Human work has different failure modes.

---

### 9.2 Assignment and Candidate Groups Are Runtime Contracts

A user task normally has assignment metadata:

- assignee;
- candidate users;
- candidate groups;
- due date;
- follow-up date;
- form reference;
- task headers/custom attributes depending feature set.

These are not only UI concerns. They determine who can see and act on work.

Bad model:

```text
User Task: Review Application
candidateGroups = reviewers
```

Too broad and ambiguous.

Better:

```text
User Task: Review License Application
candidateGroups = license-review-officer
assignee = expression based on case assignment if already assigned
```

For regulated systems, assignment semantics should map to authority boundaries.

---

### 9.3 User Task Completion Variables

When human completes a task, the completion should submit decision variables.

Example:

```json
{
  "reviewDecision": "APPROVE",
  "reviewComment": "Documents complete and verified.",
  "reviewedBy": "user-123",
  "reviewedAt": "2026-06-20T10:30:00Z"
}
```

But be careful: not all audit data should be trusted from UI-submitted variables.

Better:

- user identity from authenticated server context;
- timestamp generated server-side;
- decision stored in domain DB;
- process variable stores reference/summary.

Example:

```json
{
  "reviewDecision": "APPROVE",
  "reviewRecordId": "REV-2026-8831"
}
```

---

### 9.4 Human Task and Domain State

A common mistake:

> Task completed means business decision is safely stored.

Not necessarily.

If the UI completes the Camunda task but fails to persist domain decision, you have inconsistency.

Safer patterns:

#### Pattern A — Domain-first, then complete task

```text
User submits decision
  -> application backend validates authorization
  -> backend writes decision to domain DB
  -> backend completes Camunda task with reference variables
```

Failure case:

```text
DB write succeeds, Camunda complete fails
```

Mitigation:

- idempotent task completion;
- retry completion;
- outbox command to complete task;
- reconciliation job.

#### Pattern B — Task-first, then domain worker

```text
User completes task with decision
  -> process continues to service task
  -> worker persists decision to domain DB
```

Failure case:

```text
Task completed, worker fails persisting decision
```

Mitigation:

- incident visible;
- retry worker;
- decision payload must be enough;
- audit must prove submitted decision.

For regulated case management, Pattern A is often more defensible because domain system remains system of record for human decision.

---

## 10. Gateway Semantics

Gateways route tokens. They do not perform business work.

---

### 10.1 Exclusive Gateway

Exclusive gateway chooses one outgoing sequence flow.

Example:

```text
if riskCategory = HIGH -> Senior Review
else -> Normal Review
```

Runtime:

```text
Token enters gateway
  -> evaluate outgoing sequence flow conditions
  -> choose matching path
  -> token leaves through selected path
```

Design hazards:

1. Missing default flow.
2. Conditions overlap.
3. Variable missing or null.
4. Expression fails and creates incident.
5. Business rule hidden in BPMN expression instead of rule service.

Bad:

```text
${applicant.age > 21 && applicant.revenue / applicant.debt > 2.7 && country == "SG" && ...}
```

Better:

```text
Service Task: Classify Application
  output: classification = "STANDARD" | "ENHANCED" | "REJECT"

Exclusive Gateway:
  classification == "STANDARD"
  classification == "ENHANCED"
  classification == "REJECT"
```

Rule:

> Keep gateway expressions simple. Complex business rules belong in domain services or DMN/rules capability.

---

### 10.2 Parallel Gateway

Parallel split creates multiple concurrent tokens.

```text
        -> Verify Identity ->
Start ->                    -> Join -> Continue
        -> Verify Address  ->
```

Runtime:

```text
Token enters parallel split
  -> one token created for each outgoing path
  -> branches proceed independently
```

Parallel join waits for all required tokens.

Design hazards:

- one branch stuck means join never completes;
- boundary event termination may affect join expectation;
- incidents in one branch block overall process;
- external side effects may happen in parallel and race on shared domain state.

Java implication:

If two parallel service tasks update the same aggregate, you need domain-level concurrency control.

Example problem:

```text
Verify Address worker updates application.status = ADDRESS_VERIFIED
Verify Identity worker updates application.status = IDENTITY_VERIFIED
```

If both write same status field, last write wins and loses information.

Better:

```text
application.identityVerificationStatus
application.addressVerificationStatus
```

or append event records.

---

### 10.3 Event-Based Gateway

Event-based gateway waits for one of multiple events.

Example:

```text
Wait for applicant response OR deadline timer
```

Runtime:

```text
Token enters event-based gateway
  -> subscriptions/timers are created for outgoing event paths
  -> first event wins
  -> other event subscriptions are cancelled
```

Use for races between external events.

Good examples:

- receive clarification response vs timeout;
- receive payment confirmation vs payment deadline;
- receive cancellation request vs scheduled processing.

Design hazards:

- ambiguous message correlation;
- duplicate messages after timer path already won;
- late events need domain handling;
- do not assume losing event disappears from the real world.

If applicant replies after deadline, the message may no longer correlate. Your external intake system must handle “late response” explicitly.

---

## 11. Message Event Semantics

Message events connect external signals to process execution.

Supported patterns include:

- message start event;
- intermediate message catch event;
- boundary message event;
- message event after event-based gateway.

---

### 11.1 Message Is Not REST Callback Magic

A message must be published with:

- message name;
- correlation key;
- variables/payload;
- TTL;
- sometimes message id/dedup depending API/features.

Runtime:

```text
Process waits with message subscription
External client publishes message
Zeebe matches message name + correlation key
Process continues
```

---

### 11.2 Correlation Key Design

Correlation key is one of the most important design decisions.

Bad correlation keys:

```text
email address
applicant name
random UI session id
non-unique status
mutable external reference
```

Good correlation keys:

```text
applicationId
caseId
paymentReference
externalTransactionId
submissionNumber
```

Rules:

1. Stable.
2. Unique enough in the process context.
3. Not sensitive if exposed in logs.
4. Available to message publisher.
5. Immutable across lifecycle.

---

### 11.3 Message Arrives Before Process Waits

This is a classic race.

Scenario:

```text
1. Process starts.
2. It will eventually wait for payment confirmation.
3. Payment confirmation message arrives before token reaches message catch event.
```

Depending TTL/message buffering, the message may be buffered and later correlated, or expire before subscription exists.

Design options:

#### Option A — Use message TTL intentionally

```text
Publish message with TTL = enough time for process to reach catch event
```

Good for short races.

#### Option B — Persist external event in domain DB

```text
Payment system writes payment status to payment table.
Process checks status before waiting.
If already paid, skip wait.
Else wait for message.
```

Better for critical events.

#### Option C — Start process by message

If event is the true origin, use message start.

---

### 11.4 Message Arrives Twice

Duplicate message can happen due to:

- external retry;
- network timeout;
- webhook redelivery;
- manual replay;
- integration bug.

Process model must answer:

```text
If same business event arrives twice, should it be ignored, correlated once, create second instance, or trigger another path?
```

For regulatory flows, duplicate event should usually be idempotent.

Recommended design:

- external event table with unique event id;
- message publication outbox;
- process variable stores external event reference;
- process does not rely only on transient message delivery.

---

## 12. Timer Event Semantics

Timer events wait for time.

Types:

- timer start event;
- intermediate timer catch event;
- timer boundary event;
- timer event in event subprocess.

---

### 12.1 Timer Is Not Thread Sleep

Timer in Zeebe means:

```text
Token reaches timer
  -> timer record/subscription is persisted
  -> process waits
  -> when due time is reached, timer fires
  -> process continues
```

No Java worker thread is blocked.

This is a huge advantage over application-level scheduling because timers survive restarts.

---

### 12.2 Duration vs Date vs Cycle

Timer definitions may represent:

- specific date/time;
- duration from activation;
- repeating cycle depending supported syntax/context.

Examples conceptually:

```text
PT24H      -> wait 24 hours
2026-07-01T09:00:00Z -> wait until date
R3/PT1H    -> repeat 3 times every hour, depending timer context/support
```

Design concern:

- use UTC internally;
- be explicit about business timezone;
- avoid hidden timezone conversion;
- statutory deadlines may need business calendar logic outside raw timer.

---

### 12.3 Timer Boundary Event

A timer boundary event attaches to an activity.

Example:

```text
User Task: Review Application
  boundary timer: after 3 days -> Escalate
```

There are two modes:

#### Interrupting timer boundary

```text
Timer fires
  -> attached activity is cancelled
  -> token moves to timer path
```

Use when deadline means the original work must stop.

#### Non-interrupting timer boundary

```text
Timer fires
  -> attached activity remains active
  -> additional token starts escalation path
```

Use when reminder/escalation happens while original task remains open.

Examples:

```text
Non-interrupting:
  Send reminder to reviewer after 2 days, but keep review task open.

Interrupting:
  If applicant does not respond in 14 days, close request path and proceed to rejection.
```

---

### 12.4 Business Calendar Gap

Raw BPMN timers usually do not fully represent business calendar logic such as:

- working days only;
- public holidays;
- agency-specific cutoff;
- jurisdiction-specific statutory deadlines;
- pause during suspension;
- extend due date after request for information.

Pattern:

```text
Service Task: Calculate Deadline
  -> output deadlineAt
Timer Boundary/Event uses deadlineAt
```

The calculation belongs in domain service, not in a complex expression embedded in BPMN.

---

## 13. Boundary Event Semantics

Boundary event attaches to an activity and listens while the activity is active.

Common boundary events:

- timer;
- error;
- message;
- escalation depending support/context;
- signal depending support/context.

Runtime:

```text
Activity becomes active
  -> boundary event subscription/timer becomes active
If boundary event triggers:
  -> interrupting: activity is terminated, boundary path continues
  -> non-interrupting: activity remains, boundary path also continues
```

---

### 13.1 Boundary Event Scope

Boundary event only listens while the attached activity/scope is active.

If activity completed, boundary event is gone.

Example:

```text
User Task waits for applicant document.
Boundary message listens for withdrawal.
```

If user task completed before withdrawal arrives, the boundary message no longer applies.

Therefore, for global cancellation events, event subprocess may be better than boundary event on one task.

---

### 13.2 Boundary Error Event

A boundary error event catches BPMN errors thrown from inside activity scope.

Service task worker can throw BPMN error:

```text
throw BPMN error code = APPLICATION_INVALID
```

Boundary error event catches it:

```text
Service Task: Validate Application
  boundary error APPLICATION_INVALID -> Ask Applicant to Correct
```

Important distinction:

| Situation | Use |
|---|---|
| External API temporarily down | fail job / retry |
| Database unavailable | fail job / retry / incident |
| Application is incomplete | BPMN error or business path |
| Applicant ineligible | BPMN error or explicit gateway path |
| Worker bug | fail job -> incident |

BPMN error should represent expected business exception, not arbitrary Java exception.

---

## 14. Event Subprocess Semantics

Event subprocess is a subprocess triggered by an event. It can be placed globally inside process or locally inside embedded subprocess.

Runtime mental model:

```text
Main process scope active
  -> event subprocess listens for configured trigger
  -> trigger occurs
  -> event subprocess starts
  -> depending interrupting/non-interrupting, main scope may continue or be cancelled
```

---

### 14.1 Global Cancellation Pattern

Example:

```text
Main process: Application Review
Event subprocess: Message Start Event "application-withdrawn"
  -> Cancel Active Work
  -> Notify Parties
  -> End
```

If interrupting:

```text
withdrawal message fires
  -> active work in process scope terminated
  -> cancellation path executes
```

This is often cleaner than putting message boundary event on every user task.

---

### 14.2 Non-Interrupting Event Subprocess

Use when event should trigger side path without stopping main process.

Example:

```text
Event: applicant uploads additional document
  -> index document
  -> notify reviewer
Main review task remains active
```

Design hazard:

Non-interrupting event subprocess can spawn multiple concurrent paths. Make sure duplicate events are handled.

---

## 15. Subprocess Semantics

Embedded subprocess groups flow inside the same process definition.

Use it for:

- scoping boundary events;
- readability;
- transaction-like business phase;
- local error handling;
- local event subprocess;
- repeated patterns where call activity is too heavy.

Example:

```text
Subprocess: Review Phase
  -> Assign Reviewer
  -> Review
  -> Quality Check
Boundary timer on Review Phase: Escalate if phase exceeds 10 days
```

This is better than attaching timers to every individual task when deadline applies to the phase.

---

### 15.1 Subprocess as Failure Boundary

You can attach boundary error/timer/message events to subprocess.

This is useful when several internal tasks share the same failure behavior.

Example:

```text
Subprocess: External Verification
  -> Verify Identity
  -> Verify Address
  -> Verify Sanction List
Boundary Error: VERIFICATION_PROVIDER_UNAVAILABLE -> Manual Verification
```

But be careful: if the boundary event is interrupting, all active work inside subprocess is terminated.

---

## 16. Call Activity Semantics

Call activity invokes another process as reusable subprocess.

Runtime:

```text
Parent token enters call activity
  -> child process instance is created
  -> parent waits
  -> child completes or errors/terminates
  -> parent continues or handles failure
```

Call activity is not just visual reuse. It creates runtime parent-child relationship.

---

### 16.1 When to Use Call Activity

Good use cases:

- reusable cross-process approval flow;
- reusable notification process;
- reusable payment reservation process;
- reusable document verification process;
- separate ownership lifecycle;
- independently versioned subprocess.

Bad use cases:

- hiding complexity without ownership boundary;
- replacing every embedded subprocess;
- making tiny process fragments just for reuse;
- creating deep call chains that support teams cannot reason about.

---

### 16.2 Versioning Problem

A parent process may call latest version or specific version depending configuration.

Design question:

```text
When parent v3 calls child process, should it call child latest or the same tested child version?
```

For high-regulation processes, uncontrolled latest-child binding can cause unexpected behavior.

Safer strategy:

- pin version where deterministic behavior is required;
- use migration governance when child process changes;
- test parent-child compatibility;
- document child process contract.

---

### 16.3 Input/Output Mapping

Call activity should not pass everything by default.

Bad:

```text
Pass all variables to child
Return all variables from child
```

Problems:

- variable pollution;
- accidental overwrite;
- hidden coupling;
- security leakage;
- hard-to-debug changes.

Better:

```text
Input to child:
  applicationId
  applicantId
  verificationRequestId

Output from child:
  verificationStatus
  verificationRecordId
```

Call activity is a boundary. Treat it like an API.

---

## 17. Multi-Instance Semantics

Multi-instance repeats an activity or subprocess for a collection.

Modes:

- sequential multi-instance;
- parallel multi-instance.

Example:

```text
For each required document:
  Verify Document
```

---

### 17.1 Sequential Multi-Instance

Runtime:

```text
Execute item 1
Then item 2
Then item 3
...
```

Use when:

- order matters;
- external system rate limit is strict;
- shared mutable state makes parallelism unsafe;
- each item depends on previous result.

Downside:

- slower;
- one bad item blocks later items;
- long process duration.

---

### 17.2 Parallel Multi-Instance

Runtime:

```text
Create one body execution per item
Run concurrently
Wait for completion condition/all items
```

Use when:

- items are independent;
- throughput matters;
- external systems tolerate concurrency;
- result aggregation is well-defined.

Hazards:

- high job burst;
- hot partition pressure;
- external API overload;
- concurrent update conflict;
- variable merge issues;
- difficult incident triage when many item jobs fail.

---

### 17.3 Multi-Instance and Java Worker Design

Suppose process verifies 100 documents in parallel.

BPMN:

```text
Multi-instance Service Task: Verify Document
collection = documents
inputElement = document
jobType = document.verify.v1
```

Worker receives one document context per job.

Design requirements:

1. Worker must be idempotent per document.
2. Worker should write result per document id, not overwrite global result.
3. Worker should tolerate duplicate job execution.
4. Worker should not return huge full document payload.
5. Aggregation should be explicit.

Bad worker output:

```json
{
  "verificationStatus": "PASSED"
}
```

If multiple parallel jobs write same variable, last write may win.

Better:

```json
{
  "documentVerificationResult": {
    "documentId": "DOC-123",
    "status": "PASSED",
    "verificationRecordId": "DVR-999"
  }
}
```

Even better: persist per-document result in domain DB and return reference.

---

## 18. Receive Task Semantics

Receive task is conceptually a wait for message/signal-like external input.

In many Camunda 8 models, intermediate message catch event is more explicit and often preferred.

Runtime mental model:

```text
Token enters receive task
  -> waits for external trigger/message
  -> trigger arrives
  -> token continues
```

Use receive task when it improves readability as an activity-like wait.

Use message catch event when you want event semantics more visibly expressed.

---

## 19. Send Task Semantics

In many executable BPMN styles, send task can represent sending a message to an external participant.

In Zeebe/Camunda 8 production practice, many teams implement outbound communication using service task + worker because:

- idempotency can be controlled;
- retry can be explicit;
- outbound API call can be audited;
- failures can create incidents;
- payload can be validated;
- external integration is Java-owned.

Example:

```text
Service Task: Send Approval Email
jobType = notification.send-approval-email.v1
```

This is operationally clearer than a generic send task if the actual implementation is a worker.

---

## 20. Script Task and Business Rule Task Considerations

Camunda 8 support for BPMN elements differs from Camunda 7. Some BPMN elements are modelled but not necessarily executable in the same way as Camunda 7.

For production Camunda 8, avoid assuming Camunda 7 script/task/listener patterns transfer directly.

General guidance:

- use service task workers for complex logic;
- use DMN/rules capability where appropriate;
- keep BPMN expressions simple;
- avoid embedding complex code in BPMN model;
- avoid making process model a hidden programming language.

---

## 21. Sequence Flow Conditions and Expression Safety

Expressions decide routing and mappings.

Failure in expression evaluation can block the process and create incident.

Example risk:

```text
${risk.score > 80}
```

If `risk` is missing or null, expression may fail depending expression language semantics.

Safer design:

```text
Worker outputs:
  riskCategory = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN"

Gateway:
  riskCategory = "HIGH"
  riskCategory = "MEDIUM"
  riskCategory = "LOW"
  default -> Manual Review
```

Rules:

1. Never rely on deeply nested optional variables in gateway expressions.
2. Normalize worker outputs before routing.
3. Always provide default path for business-safe fallback.
4. Treat expression failure as production incident.
5. Keep expressions boring.

---

## 22. Input/Output Mapping Semantics

Input/output mapping controls variable scope and transformation.

Mental model:

```text
Input mapping:
  choose/transform what the activity receives

Output mapping:
  choose/transform what the activity contributes back
```

Good mapping reduces coupling.

Example service task input:

```json
{
  "applicationId": "APP-2026-000381",
  "submissionVersion": 4
}
```

Not:

```json
{
  "allProcessVariables": "everything"
}
```

---

### 22.1 Variable Scope Discipline

Every variable should have a clear owner.

Examples:

| Variable | Owner | Meaning |
|---|---|---|
| `applicationId` | start command/domain app | stable business id |
| `riskCategory` | risk classification worker | orchestration routing summary |
| `reviewDecision` | review UI/domain app | human decision summary |
| `paymentReservationId` | payment worker | reference to external reservation |
| `caseClosed` | domain case service | lifecycle state summary |

Avoid “mystery variables” created by random workers.

---

## 23. BPMN Error vs Incident vs Gateway Path

This distinction is essential.

### 23.1 Gateway Path

Use when the outcome is normal business branching.

Example:

```text
Eligibility Check -> eligible = false -> Reject Application
```

This is not an error. It is expected flow.

---

### 23.2 BPMN Error

Use when an activity cannot complete normally due to expected business exception that should be handled by BPMN boundary/event logic.

Example:

```text
Validate Application throws BPMN error MISSING_REQUIRED_DOCUMENT
Boundary error -> Request Missing Document
```

This is exceptional relative to the task, but expected in business process.

---

### 23.3 Job Failure

Use when technical attempt failed and should be retried.

Example:

```text
External API timeout
Database deadlock
Temporary 503
Network failure
```

---

### 23.4 Incident

Incident means process cannot proceed automatically.

Example:

```text
Retries exhausted
Expression failed
Called process missing
Invalid mapping
```

Incident requires resolution.

---

### 23.5 Decision Table

| Situation | Recommended modelling |
|---|---|
| Applicant is under minimum age | gateway path or BPMN error depending task contract |
| Required document missing | BPMN error or explicit output + gateway |
| External registry returns 503 | job failure/retry |
| Worker has bug | job failure -> incident |
| Variable schema incompatible | incident + release fix |
| Reviewer rejects application | normal gateway path |
| Applicant withdraws | message event subprocess |
| Deadline passes | timer boundary/event subprocess |
| Payment duplicate detected | BPMN error or gateway after idempotency check |

---

## 24. Modelling Long-Running State Correctly

Camunda 8 is excellent for long-running orchestration. But long-running does not mean putting all domain state inside process variables.

Bad mental model:

```text
Process instance is the full case database.
```

Better mental model:

```text
Process instance is the orchestration state machine.
Domain database is system of record.
Process variables carry correlation ids, routing summaries, and minimal state needed for orchestration.
```

Example:

```text
Domain DB:
  application table
  applicant table
  document table
  review table
  audit table

Camunda variables:
  applicationId
  caseId
  riskCategory
  reviewDecision
  deadlineAt
  escalationLevel
```

---

## 25. Token Explosion and Model Scalability

Some BPMN patterns can create many tokens:

- parallel multi-instance;
- non-interrupting event subprocess;
- non-interrupting boundary events;
- nested subprocesses;
- event storms;
- broad parallel gateways.

Token explosion symptoms:

- many active jobs;
- many incidents;
- hard-to-read Operate instance;
- worker overload;
- exporter/read model load;
- external system throttling.

Design rule:

> Parallelism in BPMN is real operational concurrency. Model it only when the business truly needs parallel execution.

---

## 26. Process Instance Completion Semantics

A process instance completes when all active tokens in the root process scope have ended or been terminated.

Common confusion:

```text
One end event reached != whole process completed
```

If there are active non-interrupting event subprocess paths or parallel branches, the instance remains active.

Support implication:

When a user says “the process reached end but still active,” check:

- active tokens in other branches;
- non-interrupting boundary/event subprocess paths;
- call activities waiting;
- multi-instance body not completed;
- unresolved incidents;
- active timers/messages.

---

## 27. Runtime Semantics and Java Worker Boundaries

BPMN semantics directly shape Java code.

### 27.1 Service Task Means Worker Contract

Each service task needs:

- job type;
- worker implementation;
- input variable contract;
- output variable contract;
- error contract;
- retry policy;
- timeout;
- idempotency key;
- owner.

Template:

```text
Service Task Contract
---------------------
BPMN task name: Validate Application
Job type: license.application.validate-submission.v1
Owner: Application BE Team
Input variables:
  - applicationId: string, required
  - submissionVersion: number, required
Output variables:
  - validationStatus: PASSED | FAILED
  - validationRecordId: string
BPMN errors:
  - MISSING_REQUIRED_DOCUMENT
  - INVALID_APPLICATION_STATE
Technical failures:
  - retry 3 times, exponential backoff
Idempotency:
  - unique key: applicationId + submissionVersion + task name
Side effects:
  - writes validation result to application DB
SLA:
  - expected completion < 10 seconds
Observability:
  - log processInstanceKey, jobKey, applicationId
```

---

### 27.2 User Task Means Human Decision Contract

Template:

```text
User Task Contract
------------------
Task name: Review Application
Candidate group: license-review-officer
Assignment source: case assignment service
Form: license-review-form-v3
Completion payload:
  - decision: APPROVE | REJECT | REQUEST_INFO
  - comment: string
Server-enriched fields:
  - reviewedBy
  - reviewedAt
Domain side effect:
  - create review record
SLA:
  - 5 working days
Escalation:
  - non-interrupting timer after 3 working days
Cancellation:
  - application-withdrawn event subprocess
Audit:
  - decision persisted in domain audit table
```

---

## 28. Production Design Heuristics

### 28.1 Use BPMN for Coordination, Not Computation

Good BPMN:

```text
Receive application -> Validate -> Review -> Decide -> Notify
```

Bad BPMN:

```text
Calculate 47 fields using expression chains and gateways
```

Complex computation belongs in Java/domain services.

---

### 28.2 Every Wait State Needs an Escape Story

For every wait state, define:

```text
What resumes it?
What if resume never happens?
What if resume happens twice?
What if resume happens too early?
What if process is cancelled while waiting?
Who can see it operationally?
Who owns fixing it?
```

---

### 28.3 Prefer Explicit Business Milestones

BPMN should expose meaningful business progress.

Bad:

```text
Call API 1 -> Map Data -> Call API 2 -> Save -> Call API 3
```

Better:

```text
Verify Applicant Eligibility
Reserve License Number
Complete Officer Review
Issue License
Notify Applicant
```

The lower-level API calls live inside workers.

---

### 28.4 Do Not Hide Critical Business State in Worker Logs

If it matters to the business process, it must be represented as:

- domain state;
- process variable summary;
- BPMN milestone;
- audit record;
- Operate-visible variable where appropriate.

Worker logs are not process state.

---

### 28.5 Default Path Is a Safety Net

Gateways should usually have default path.

Example:

```text
Risk Category?
  HIGH -> Senior Review
  LOW -> Auto Approve
  default -> Manual Review
```

Default path prevents unexpected null/unknown values from becoming unhandled incidents or wrong routing.

---

## 29. Common BPMN Runtime Anti-Patterns in Zeebe

### 29.1 BPMN as Microservice Call Graph

Bad:

```text
Start -> call user service -> call address service -> call risk service -> call notification service -> call audit service -> End
```

Problem:

- too technical;
- too brittle;
- every API detail becomes process model change;
- incident view becomes noisy;
- poor business readability.

Better:

```text
Start -> Validate Submission -> Assess Risk -> Notify Outcome -> End
```

Workers internally call necessary services.

---

### 29.2 No Boundary for Business Timeout

Bad:

```text
User Task: Applicant Submit Documents
```

No timer. It can wait forever.

Better:

```text
User Task: Applicant Submit Documents
  interrupting timer after 14 days -> Close as Incomplete
  non-interrupting timer after 7 days -> Send Reminder
```

---

### 29.3 Business Error as Technical Retry

Bad:

```text
Worker finds missing document
  -> fail job
  -> retry 3 times
  -> incident
```

Missing document will not fix itself through retry.

Better:

```text
Worker throws BPMN error MISSING_DOCUMENT
  -> process requests document from applicant
```

---

### 29.4 Technical Error as BPMN Error

Bad:

```text
External API timeout
  -> BPMN error PROVIDER_TIMEOUT
  -> route to rejection
```

A temporary API timeout should not reject an application.

Better:

```text
fail job with retry
if retries exhausted -> incident/manual repair
or explicit fallback path after business-defined timeout
```

---

### 29.5 Huge Variable Payloads

Bad:

```text
Store entire PDF, JSON document, applicant history, and audit list in variables.
```

Problems:

- engine payload pressure;
- exporter pressure;
- Operate performance;
- security risk;
- difficult migration;
- variable history bloat.

Better:

```text
Store documentId, storageKey, summary status.
```

---

### 29.6 No Versioned Contracts

Bad:

```text
jobType = validate
```

Then worker changes input/output semantics silently.

Better:

```text
jobType = license.application.validate-submission.v2
```

or keep same type only with strict backward-compatible schema changes.

---

## 30. Example: Regulatory Application Review Process

Let us model a realistic process.

```text
Start
  -> Register Application
  -> Validate Submission
  -> [Valid?]
      no  -> Request Correction -> Wait for Correction -> Validate Submission
      yes -> Risk Classification
  -> [Risk?]
      high -> Senior Officer Review
      low  -> Officer Review
  -> [Decision?]
      approve -> Issue License -> Notify Approval -> End
      reject  -> Notify Rejection -> Appeal Window -> End
      request info -> Request Info -> Wait for Applicant -> Officer Review
```

Runtime semantics:

| Element | Runtime meaning |
|---|---|
| Register Application | service task job, writes domain case record |
| Validate Submission | service task job, may throw BPMN error or output status |
| Request Correction | service task/user notification, creates outbound communication |
| Wait for Correction | message catch or user task, process waits |
| Risk Classification | service task job, outputs risk category |
| Officer Review | user task, process waits human decision |
| Senior Officer Review | user task with different candidate group |
| Issue License | service task job, external/domain side effect |
| Appeal Window | timer/message race: wait for appeal or deadline |

Production questions:

1. What if applicant correction arrives before wait state?
2. What if reviewer leaves organization while task assigned?
3. What if issue license succeeds but job completion fails?
4. What if notification email fails after license issued?
5. What if risk classification worker deploys incompatible version?
6. What if appeal arrives after appeal timer ended?
7. What if application is withdrawn during officer review?
8. What if deadline changes due to statutory extension?

These questions reveal whether your BPMN is production-grade.

---

## 31. Example Runtime Timeline

Scenario:

```text
Application APP-001 submitted.
```

Timeline:

```text
T0  Create process instance
T1  Start event completes
T2  Register Application service task creates job
T3  Worker A activates job
T4  Worker A writes case row to DB
T5  Worker A completes job
T6  Validate Submission service task creates job
T7  Worker B activates job
T8  Worker B detects missing document
T9  Worker B throws BPMN error MISSING_DOCUMENT
T10 Boundary error catches it
T11 Request Correction notification job created
T12 Notification worker sends email/SMS
T13 Wait for Correction message catch event active
T14 Applicant uploads missing document
T15 Application backend publishes message correction-received correlationKey=APP-001
T16 Token continues to Validate Submission again
T17 Validation passes
T18 Officer Review user task created
T19 Non-interrupting timer for reminder also active
T20 Reviewer completes task
T21 Timer subscription cancelled if attached to completed task
T22 Issue License job created
T23 Worker issues license in domain DB/external registry
T24 Worker completes job
T25 Notify Approval job created/completed
T26 End event reached
T27 Process instance completed
```

Observe:

- process spends most time waiting;
- workers perform short units of side-effectful work;
- BPMN models business state transitions;
- technical failure paths must be separately designed;
- human and message waits need deadlines.

---

## 32. How to Review a BPMN Model Like a Senior Engineer

Use this checklist.

### 32.1 For Every Service Task

Ask:

- What is the job type?
- Which worker owns it?
- Is the worker deployed in all environments?
- What variables are required?
- What variables are produced?
- Is it idempotent?
- What external side effects happen?
- What happens if side effect succeeds but completion fails?
- What are technical retries?
- What BPMN errors can it throw?
- What incident means support must do?

---

### 32.2 For Every User Task

Ask:

- Who can see it?
- Who can claim it?
- Who can complete it?
- What form version is used?
- What decision data is captured?
- Is decision persisted in domain DB?
- What is the SLA?
- What happens if overdue?
- What happens if assignee leaves?
- What happens if process is cancelled?

---

### 32.3 For Every Gateway

Ask:

- Are conditions mutually exclusive?
- Is there a default path?
- Are variables guaranteed to exist?
- Is complex logic hidden in expression?
- Is routing auditable?
- What happens for unknown value?

---

### 32.4 For Every Message Wait

Ask:

- Who publishes the message?
- What is the correlation key?
- Can it arrive before subscription?
- Can it arrive twice?
- What is TTL?
- What if it expires?
- Is there a domain event record?
- How is late message handled?

---

### 32.5 For Every Timer

Ask:

- Is it business deadline or technical timeout?
- Is timezone explicit?
- Does it require working-day calendar?
- Is it interrupting or non-interrupting?
- What happens when it fires?
- Can deadline change?
- How is extension modelled?

---

### 32.6 For Every Parallel/Multi-Instance Segment

Ask:

- How many tokens/jobs can be created?
- Can external systems handle concurrency?
- Are worker outputs isolated per item?
- What happens if one branch fails?
- What happens if one branch is slow?
- Is aggregation deterministic?
- Is cancellation handled?

---

## 33. Java-Oriented Runtime Mapping

Map BPMN semantics to Java components:

| BPMN concept | Java/system component |
|---|---|
| Service task | `@JobWorker` / worker handler |
| Job type | Java worker contract string |
| Input variables | DTO / command object |
| Output variables | response DTO / orchestration summary |
| BPMN error | typed business exception mapped to throw error command |
| Job failure | technical exception mapped to fail command |
| User task | task API/UI/domain decision endpoint |
| Message event | message publishing adapter |
| Timer event | no Java thread; process-level persisted timer |
| Gateway | simple expression over normalized variables |
| Call activity | process-to-process contract |
| Multi-instance | repeated worker/user/message execution |
| Incident | operational repair workflow |

This mapping prevents treating BPMN as disconnected from Java architecture.

---

## 34. The Most Important Mental Models

### 34.1 BPMN Element = Runtime Contract

Every executable element creates obligations.

```text
Service task -> worker obligation
User task -> human/task app obligation
Message event -> publisher/correlation obligation
Timer event -> deadline semantics
Gateway -> variable/expression obligation
Call activity -> child process compatibility obligation
Multi-instance -> concurrency/aggregation obligation
```

---

### 34.2 Wait State = Persistence Boundary

At wait states, Zeebe persists orchestration state and the process can survive restarts.

But wait state also creates lifecycle risk:

- stuck forever;
- duplicate resumption;
- late event;
- cancellation conflict;
- version drift;
- stale assignment;
- projection lag.

---

### 34.3 Worker Completion = Process Continuation Signal

Worker logic itself does not advance the process until job completion command is accepted.

This is the root of many duplicate side-effect problems.

---

### 34.4 BPMN Is Business-Readable, Worker Is Engineering-Precise

The process model should communicate business lifecycle. Java workers should encapsulate technical detail.

If BPMN is too technical, it becomes brittle.
If workers hide business milestones, process loses explainability.

---

## 35. Practical Design Template

For any BPMN process, create this companion specification.

```markdown
# Process Runtime Specification

## Process
- BPMN process id:
- Business owner:
- Technical owner:
- Start trigger:
- Completion meaning:

## Business Identifiers
- Primary business key:
- Correlation keys:
- External references:

## Variables
| Name | Type | Owner | Required | Meaning | Version |
|---|---|---|---|---|---|

## Service Tasks
| BPMN Task | Job Type | Worker | Input | Output | Errors | Retry | Idempotency |
|---|---|---|---|---|---|---|---|

## User Tasks
| Task | Candidate Group | Form | Completion Data | SLA | Escalation |
|---|---|---|---|---|---|

## Message Events
| Event | Message Name | Correlation Key | Publisher | TTL | Duplicate Handling |
|---|---|---|---|---|---|

## Timers
| Timer | Type | Interrupting | Business Meaning | Timezone | Extension Rule |
|---|---|---|---|---|---|

## Error Handling
| Error | Source | BPMN Handling | Domain Impact | Support Action |
|---|---|---|---|---|

## Incidents
| Incident Type | Cause | Detection | Resolution | Owner |
|---|---|---|---|---|

## Versioning
- Compatible changes:
- Breaking changes:
- Worker deployment dependency:
- Migration strategy:

## Observability
- Required log fields:
- Metrics:
- Dashboards:
- Alerts:
```

A BPMN file without a runtime specification is incomplete for serious production use.

---

## 36. Summary

Di Camunda 8 / Zeebe, BPMN execution semantics harus dipahami sebagai persisted, event-driven, distributed state machine.

Hal-hal paling penting dari part ini:

1. BPMN bukan hanya diagram; BPMN adalah deklarasi runtime behavior.
2. Token adalah mental model untuk posisi aktif eksekusi.
3. Wait state adalah titik penting tempat proses berhenti dan state dipersist.
4. Service task membuat job dan menunggu worker menyelesaikannya.
5. User task membuat human wait state dan membutuhkan assignment/security/SLA/audit design.
6. Gateway hanya routing; jangan sembunyikan business logic kompleks di expression.
7. Message event membutuhkan correlation key, TTL, duplicate handling, dan late-event strategy.
8. Timer event adalah persisted process time, bukan Java sleep.
9. Boundary event dan event subprocess adalah alat penting untuk cancellation, timeout, reminder, dan escalation.
10. Call activity adalah process-to-process contract, bukan sekadar diagram reuse.
11. Multi-instance menciptakan concurrency nyata dan harus didesain seperti distributed workload.
12. BPMN error, job failure, incident, dan gateway path memiliki makna berbeda.
13. Java worker design harus mengikuti semantics BPMN, terutama idempotency dan side-effect safety.
14. Production-grade BPMN membutuhkan runtime specification, bukan hanya `.bpmn` file.

Jika Part 000 membentuk mental model Camunda 8 dan Part 001-003 membongkar platform/engine/partition, maka Part 004 ini menjelaskan bagaimana model BPMN benar-benar hidup di runtime.

---

## 37. Checklist Pemahaman

Anda dianggap memahami bagian ini jika bisa menjawab:

1. Apa perbedaan service task di Camunda 8 dengan JavaDelegate di Camunda 7?
2. Mengapa service task adalah wait state?
3. Apa yang terjadi jika worker crash setelah activate job?
4. Mengapa job timeout bukan business timeout?
5. Apa bedanya BPMN error dan job failure?
6. Kapan incident muncul?
7. Apa risiko message arrives before subscription?
8. Mengapa correlation key harus stabil?
9. Apa perbedaan interrupting dan non-interrupting boundary timer?
10. Kapan event subprocess lebih baik daripada boundary event?
11. Mengapa call activity harus diperlakukan seperti API contract?
12. Apa risiko parallel multi-instance terhadap variable merge dan external systems?
13. Mengapa gateway expression harus sederhana?
14. Mengapa process variable tidak boleh menjadi full domain database?
15. Bagaimana cara review BPMN model dari sisi production readiness?

---

## 38. Koneksi ke Part Berikutnya

Part berikutnya akan membahas:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-005.md
```

Judul:

```text
Java Client Evolution: Zeebe Java Client, Camunda Java Client, REST, gRPC, and Version Strategy
```

Setelah memahami apa yang terjadi ketika BPMN berjalan, kita akan masuk ke sisi Java client:

- evolusi Zeebe Java Client ke Camunda Java Client;
- konsekuensi Camunda 8.8+;
- REST vs gRPC;
- Java 8 sampai Java 25 compatibility thinking;
- client lifecycle;
- authentication;
- dependency management;
- migration strategy.

---

## Status Seri

Seri belum selesai.

Progress saat ini:

- [x] Part 000 — Orientation, Scope, Mental Model, and What Changes from Camunda 7
- [x] Part 001 — Camunda 8 Platform Architecture
- [x] Part 002 — Zeebe Engine Internals
- [x] Part 003 — Partitions, Replication, Raft, Scalability, and Ordering Guarantees
- [x] Part 004 — BPMN Execution Semantics in Zeebe
- [ ] Part 005 — Java Client Evolution
- [ ] Part 006 — Building Production-Grade Java Job Workers
- [ ] Part 007 — Worker Correctness
- [ ] Part 008 — Variables, Serialization, Payload Discipline, and Data Contracts
- [ ] Part 009 — BPMN Modelling for Distributed Execution
- [ ] Part 010 — Process Instantiation, Business Keys, Correlation Keys, and Message Design
- [ ] Part 011 — Error Handling Semantics
- [ ] Part 012 — Timers, Deadlines, SLA, Escalation, and Time Semantics
- [ ] Part 013 — User Tasks, Tasklist, Forms, Assignment, Candidate Groups, and Human Workflow Architecture
- [ ] Part 014 — Spring Boot Integration
- [ ] Part 015 — Worker Application Architecture
- [ ] Part 016 — Connectors and Integration Patterns
- [ ] Part 017 — Exporters, Elasticsearch/OpenSearch, Operate, Tasklist, and Read-Side Architecture
- [ ] Part 018 — Operate Deep Dive
- [ ] Part 019 — Tasklist and Human Work Management at Scale
- [ ] Part 020 — Optimize and Process Analytics
- [ ] Part 021 — Identity, Authentication, Authorization, Tenancy, and Secure Access Boundaries
- [ ] Part 022 — Deployment Models
- [ ] Part 023 — Performance Engineering
- [ ] Part 024 — Reliability Engineering
- [ ] Part 025 — Observability
- [ ] Part 026 — Testing Strategy
- [ ] Part 027 — Process Versioning and Deployment Governance
- [ ] Part 028 — Migration from Camunda 7 to Camunda 8
- [ ] Part 029 — Advanced Orchestration Patterns
- [ ] Part 030 — Case Management and Regulatory Lifecycle Modelling
- [ ] Part 031 — Multi-Tenancy, Multi-Region, Environment Strategy
- [ ] Part 032 — Security, Compliance, Audit Trail, PII, and Regulated Workflow Defensibility
- [ ] Part 033 — Anti-Patterns, Design Smells, and Production Failure Case Studies
- [ ] Part 034 — End-to-End Reference Architecture
- [ ] Part 035 — Mastery Checklist and Next Roadmap


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-003.md">⬅️ Part 003 — Partitions, Replication, Raft, Scalability, and Ordering Guarantees</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-005.md">Part 005 — Java Client Evolution: Zeebe Java Client, Camunda Java Client, REST, gRPC, and Version Strategy ➡️</a>
</div>
