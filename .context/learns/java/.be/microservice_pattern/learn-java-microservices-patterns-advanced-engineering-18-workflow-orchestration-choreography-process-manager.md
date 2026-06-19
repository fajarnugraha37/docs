# Learn Java Microservices Patterns — Advanced Engineering
## Part 18 — Workflow, Orchestration, Choreography, and Process Managers

**Filename:** `learn-java-microservices-patterns-advanced-engineering-18-workflow-orchestration-choreography-process-manager.md`  
**Series:** `learn-java-microservices-patterns-advanced-engineering`  
**Part:** 18 of 35  
**Scope:** Java 8–25, microservices architecture, workflow coordination, process orchestration, choreography, saga/process manager, long-running business process, human task, timer, escalation, and production-grade reliability.

---

## 0. Why This Part Exists

Sampai Part 17, kita sudah membahas fondasi microservices dari sisi:

- distributed systems reality,
- service boundary,
- domain modeling,
- synchronous communication,
- asynchronous messaging,
- event-driven architecture,
- saga,
- outbox/inbox,
- consistency,
- data ownership,
- query model,
- API gateway,
- service discovery/configuration,
- resilience,
- backpressure,
- idempotency.

Sekarang kita masuk ke pertanyaan yang lebih sulit:

> Kalau business process melewati banyak service, berlangsung lama, melibatkan manusia, timer, SLA, escalation, retry, compensation, dan audit trail, siapa yang mengingat prosesnya?

Di microservices, ada banyak cara menjawabnya:

1. Biarkan service saling bereaksi lewat event. Ini disebut **choreography**.
2. Buat satu koordinator eksplisit yang memberi instruksi. Ini disebut **orchestration**.
3. Simpan state proses di objek khusus. Ini sering disebut **process manager**.
4. Gunakan workflow/BPMN/durable execution engine seperti Camunda, Temporal, Zeebe, atau engine internal.
5. Gunakan hybrid: sebagian event-driven, sebagian orchestrated.

Kesalahan umum adalah menganggap workflow cuma “urutan API call”. Itu terlalu dangkal.

Workflow microservices yang production-grade harus menjawab:

- state proses ada di mana?
- siapa owner proses end-to-end?
- siapa owner setiap business capability?
- bagaimana proses resume setelah crash?
- bagaimana retry dibatasi?
- bagaimana timeout ditangani?
- bagaimana compensation dilakukan?
- bagaimana human decision masuk?
- bagaimana workflow di-versioning?
- bagaimana audit menjelaskan kenapa keputusan terjadi?
- bagaimana workflow tidak berubah menjadi distributed monolith?

Part ini membangun mental model untuk itu.

---

## 1. Core Definition

Dalam konteks microservices, **workflow** adalah koordinasi beberapa aktivitas untuk mencapai satu outcome bisnis yang lebih besar daripada satu local transaction.

Contoh:

```text
Submit Application
→ Validate Eligibility
→ Reserve Case Number
→ Screen Applicant
→ Request Payment
→ Wait for Payment
→ Assign Officer
→ Review Documents
→ Approve / Reject / Request Clarification
→ Notify Applicant
→ Archive Decision
```

Tidak semua step berada di satu service. Tidak semua step selesai cepat. Tidak semua step otomatis. Tidak semua step reversible.

Maka workflow bukan sekadar function call chain.

Workflow adalah kombinasi dari:

```text
process state
+ business events
+ commands
+ decisions
+ timers
+ retries
+ compensation
+ human tasks
+ audit evidence
+ versioned rules
+ external side effects
```

---

## 2. Important Distinction: Transaction, Saga, Workflow, Process

Istilah ini sering bercampur. Kita pisahkan.

### 2.1 Local Transaction

Local transaction adalah perubahan atomik dalam satu resource boundary.

Contoh:

```text
Application Service:
- update application status from DRAFT to SUBMITTED
- insert audit trail
- insert outbox event ApplicationSubmitted
- commit
```

Satu database transaction. Satu service owner. Strong consistency lokal.

### 2.2 Saga

Saga adalah koordinasi beberapa local transaction dengan compensation jika workflow gagal.

Contoh:

```text
Create order
→ reserve stock
→ charge payment
→ arrange shipping
```

Jika charge payment gagal, stock reservation perlu dilepas.

Microservices.io membedakan saga coordination menjadi choreography dan orchestration: choreography membuat setiap local transaction publish event yang memicu service lain, sedangkan orchestration menggunakan orchestrator yang memberi instruksi ke participant.

### 2.3 Workflow

Workflow lebih luas daripada saga.

Workflow dapat mencakup:

- saga,
- human approval,
- timer,
- SLA,
- escalation,
- branching decision,
- external system callback,
- manual correction,
- compliance review,
- document generation,
- periodic reconciliation.

Tidak semua workflow butuh compensation. Tidak semua workflow adalah distributed transaction.

### 2.4 Process Manager

Process manager adalah komponen yang menyimpan dan mengelola state dari proses jangka panjang.

Ia menerima event, membuat keputusan, dan mengirim command.

Contoh:

```text
ApplicationApprovalProcessManager

Receives:
- ApplicationSubmitted
- ScreeningCompleted
- PaymentCompleted
- OfficerApproved
- OfficerRejected
- ClarificationSubmitted

Sends:
- StartScreening
- RequestPayment
- AssignOfficer
- GenerateApprovalLetter
- NotifyApplicant
```

### 2.5 Orchestrator

Orchestrator adalah koordinator yang secara eksplisit mengatur urutan step.

Ia biasanya tahu flow end-to-end.

### 2.6 Choreography

Choreography adalah koordinasi melalui event tanpa koordinator pusat.

Setiap service bereaksi terhadap event yang relevan.

---

## 3. Mental Model: Who Remembers the Process?

Pertanyaan paling penting dalam workflow microservices:

> Jika proses belum selesai, siapa yang mengingat posisi terakhirnya?

Pilihan jawaban:

| Model | Yang mengingat proses | Kelebihan | Risiko |
|---|---|---|---|
| Pure choreography | Tersebar di masing-masing service | loose coupling, autonomy tinggi | sulit debug, sulit audit end-to-end, hidden flow |
| Orchestrator service | Satu service/process engine | visibility tinggi, kontrol jelas | risiko central brain/god orchestrator |
| Process manager | State machine khusus per business process | eksplisit, testable, cocok domain process | perlu disiplin boundary |
| BPMN/workflow engine | Engine durable dengan model process | timer/human task/visual monitoring kuat | bisa overkill atau jadi bottleneck governance |
| Durable execution | Workflow code yang direplay/dijalankan durable | developer-friendly, retry/timer kuat | deterministic-code constraint dan platform coupling |

Top-tier engineer tidak memilih berdasarkan tren. Ia memilih berdasarkan:

```text
visibility need
+ audit need
+ process complexity
+ number of participants
+ human involvement
+ timer/SLA need
+ compensation complexity
+ change frequency
+ debugging difficulty
+ team ownership
+ operational maturity
```

---

## 4. Choreography

### 4.1 Definition

Choreography berarti setiap service bertindak berdasarkan event yang diterimanya. Tidak ada satu komponen yang mengontrol keseluruhan proses.

Contoh:

```text
Application Service publishes ApplicationSubmitted
Screening Service consumes ApplicationSubmitted, then publishes ScreeningCompleted
Payment Service consumes ScreeningCompleted, then publishes PaymentRequested
Notification Service consumes PaymentRequested, then sends notification
Case Assignment Service consumes PaymentCompleted, then publishes OfficerAssigned
```

### 4.2 When Choreography Works Well

Choreography cocok jika:

- proses sederhana,
- participant sedikit,
- alur bisnis stabil,
- tidak banyak branching,
- tidak butuh global process visibility yang kuat,
- event adalah business fact yang natural,
- setiap service benar-benar autonomous,
- failure lokal tidak membutuhkan banyak compensation lintas service.

Contoh yang cocok:

```text
UserRegistered
→ send welcome email
→ create analytics profile
→ initialize preference defaults
→ push CRM event
```

Ini bisa event-driven tanpa orchestrator.

### 4.3 Strengths

Kelebihan choreography:

1. Loose coupling secara langsung.
2. Tidak ada central coordinator yang harus tahu semua service.
3. Mudah menambahkan consumer baru untuk event existing.
4. Cocok untuk side-effect notification.
5. Cocok untuk broadcast business fact.
6. Cocok jika setiap service punya reaction sendiri.

### 4.4 Weaknesses

Kelemahan choreography:

1. Flow tersembunyi di banyak consumer.
2. Sulit melihat state end-to-end.
3. Debugging sulit.
4. Testing end-to-end mahal.
5. Consumer dependency bisa tidak terlihat.
6. Event soup.
7. Sulit melakukan timeout process global.
8. Sulit melakukan compensation sequence kompleks.
9. Risiko cyclic event.
10. Risiko emergent behavior.

### 4.5 Choreography Failure Example

Misal flow:

```text
ApplicationSubmitted
→ ScreeningStarted
→ ScreeningCompleted
→ PaymentRequested
→ PaymentCompleted
→ ReviewAssigned
```

Kemudian ada requirement baru:

```text
Jika applicant high-risk, harus masuk enhanced review sebelum payment.
Jika applicant government employee, skip payment.
Jika document incomplete, pause and request clarification.
Jika clarification tidak masuk 14 hari, auto-withdraw.
Jika officer tidak review 5 hari, escalate.
```

Jika ini tetap murni choreography, logic tersebar:

```text
Screening Service tahu high-risk.
Payment Service tahu payment skip.
Document Service tahu incomplete.
Notification Service tahu clarification.
Case Service tahu officer assignment.
SLA Service tahu escalation.
```

Tidak ada satu tempat yang menjelaskan proses bisnis end-to-end.

Akibatnya:

- audit sulit,
- PM/BA sulit memahami flow,
- incident triage sulit,
- perubahan rule rawan regression,
- banyak event consumer saling bergantung secara implisit.

Ini smell bahwa choreography sudah terlalu jauh.

---

## 5. Orchestration

### 5.1 Definition

Orchestration berarti ada komponen yang mengontrol urutan proses.

Orchestrator mengirim command ke service participant dan menerima hasilnya.

Contoh:

```text
ApplicationApprovalOrchestrator

1. command ScreeningService.startScreening(applicationId)
2. wait ScreeningCompleted
3. if highRisk: command ReviewService.createEnhancedReview(applicationId)
4. wait EnhancedReviewCompleted
5. command PaymentService.requestPayment(applicationId)
6. wait PaymentCompleted
7. command CaseService.assignOfficer(applicationId)
8. wait OfficerDecisionMade
9. command NotificationService.notifyDecision(applicationId)
```

### 5.2 When Orchestration Works Well

Orchestration cocok jika:

- proses punya banyak step,
- branching kompleks,
- human task banyak,
- timer/SLA/escalation penting,
- audit end-to-end penting,
- compensation kompleks,
- process visibility dibutuhkan,
- debugging sulit jika logic tersebar,
- proses punya owner bisnis yang jelas.

### 5.3 Strengths

Kelebihan orchestration:

1. Flow eksplisit.
2. State proses jelas.
3. Timeout global lebih mudah.
4. Compensation sequence lebih jelas.
5. Monitoring end-to-end lebih mudah.
6. Human task dan escalation lebih natural.
7. Testing workflow lebih terkendali.
8. Audit trail process lebih defensible.

### 5.4 Weaknesses

Kelemahan orchestration:

1. Orchestrator bisa menjadi god service.
2. Participant bisa kehilangan autonomy jika orchestrator terlalu detail.
3. Orchestrator bisa tahu terlalu banyak domain internal service lain.
4. Coupling pindah dari event dependency ke command dependency.
5. Central workflow bisa menjadi bottleneck perubahan.
6. Jika salah desain, microservices menjadi remote procedure chain.

### 5.5 Orchestrator Must Not Own Everything

Orchestrator boleh tahu:

```text
- process state
- process transition
- participant command contract
- event/response contract
- timeout and escalation rule
- compensation sequence
```

Orchestrator tidak boleh tahu:

```text
- internal table participant
- private domain model participant
- internal validation detail participant
- how participant executes its local transaction
- participant implementation class
```

Contoh batas sehat:

```text
GOOD:
Orchestrator sends: StartScreening(applicationId, screeningPolicyVersion)
Screening Service decides how to screen.

BAD:
Orchestrator calls:
- checkBlacklist()
- checkCreditScore()
- checkCountryRisk()
- checkDocumentFraud()
- updateScreeningTable()
```

Jika orchestrator mulai menjalankan logika internal participant, service autonomy rusak.

---

## 6. Process Manager Pattern

### 6.1 Definition

Process manager adalah domain/application component yang mengelola state proses jangka panjang.

Ia biasanya:

- menerima event,
- membaca state proses,
- memutuskan command berikutnya,
- menyimpan state proses,
- mengatur timeout,
- melakukan compensation,
- menerbitkan audit/process event.

Pseudo-flow:

```text
Event arrives
→ load process instance
→ validate event relevance
→ transition process state
→ decide next commands
→ persist state + outbox commands/events
→ commit
```

### 6.2 Process Manager vs Domain Service

| Aspect | Domain Service | Process Manager |
|---|---|---|
| Scope | Domain operation | Long-running process |
| State | Usually stateless or aggregate-local | Stores process state |
| Time horizon | Short | Long |
| Input | Command/query | Event/command/timer |
| Output | Result/domain event | Commands, process events, timers |
| Responsibility | Business rule execution | Coordination and progression |

### 6.3 Process Manager State

Contoh state:

```java
public enum ApprovalProcessState {
    STARTED,
    WAITING_FOR_SCREENING,
    WAITING_FOR_PAYMENT,
    WAITING_FOR_OFFICER_REVIEW,
    WAITING_FOR_CLARIFICATION,
    APPROVED,
    REJECTED,
    WITHDRAWN,
    FAILED_REQUIRING_MANUAL_INTERVENTION
}
```

Process manager harus menyimpan minimal:

```text
process_id
business_key
process_type
process_version
state
previous_state
started_at
last_transition_at
deadline_at
correlation_id
current_attempt
last_event_id
last_command_id
participant_status
compensation_status
created_by
last_actor
```

### 6.4 Process Manager Table Example

```sql
CREATE TABLE approval_process_instance (
    process_id              VARCHAR(64) PRIMARY KEY,
    application_id          VARCHAR(64) NOT NULL,
    process_version         INTEGER NOT NULL,
    state                   VARCHAR(80) NOT NULL,
    previous_state          VARCHAR(80),
    started_at              TIMESTAMP NOT NULL,
    last_transition_at      TIMESTAMP NOT NULL,
    deadline_at             TIMESTAMP,
    correlation_id          VARCHAR(128) NOT NULL,
    version                 BIGINT NOT NULL,
    last_event_id           VARCHAR(128),
    compensation_status     VARCHAR(80),
    failure_reason          VARCHAR(1000)
);

CREATE UNIQUE INDEX uq_approval_process_application
ON approval_process_instance(application_id);
```

### 6.5 Process Manager Transition Example

```java
public final class ApprovalProcessManager {

    private final ProcessRepository repository;
    private final CommandOutbox outbox;
    private final Clock clock;

    public void on(ScreeningCompleted event) {
        ApprovalProcess process = repository.loadByApplicationId(event.applicationId());

        if (process.alreadyHandled(event.eventId())) {
            return;
        }

        ProcessTransition transition = process.handle(event, clock.instant());

        repository.save(process);

        for (ProcessCommand command : transition.commands()) {
            outbox.enqueue(command);
        }
    }
}
```

Key point:

```text
state update + outgoing command enqueue harus satu local transaction
```

Jika tidak, process manager punya dual-write problem.

---

## 7. Workflow Engine

### 7.1 What Workflow Engine Provides

Workflow engine biasanya menyediakan:

- durable process state,
- timer,
- retry,
- wait state,
- human task,
- correlation,
- process visibility,
- incident handling,
- compensation support,
- versioned process model,
- operational UI,
- process history,
- worker execution model.

Contoh kategori:

| Category | Example |
|---|---|
| BPMN/process orchestration | Camunda, Zeebe |
| Durable execution/workflow-as-code | Temporal |
| Lightweight internal process manager | custom Java service |
| Cloud workflow service | AWS Step Functions, Azure Durable Functions, Google Workflows |

### 7.2 BPMN-Based Orchestration

BPMN cocok jika:

- proses perlu divisualisasikan,
- BA/compliance perlu membaca flow,
- human task penting,
- timer/escalation jelas,
- process monitoring dibutuhkan,
- audit/regulatory defensibility penting,
- proses bisnis berubah melalui model.

Camunda menekankan perbedaan orchestration dan choreography, serta penggunaan BPMN untuk memodelkan koordinasi microservices. Dokumentasinya juga menyediakan guide untuk orchestrate microservices dengan BPMN.

### 7.3 Durable Execution / Workflow-as-Code

Durable execution cocok jika:

- developer ingin workflow sebagai code,
- retry/timer/long-running execution harus durable,
- activity execution perlu otomatis diulang,
- process state harus survive worker crash,
- determinism constraint bisa diterima.

Temporal Java SDK menyediakan model workflow, activities, workers, dan durable execution untuk aplikasi Java. Temporal juga memiliki konsep compensation/saga yang umum dipakai untuk long-running transaction.

### 7.4 Workflow Engine Is Not Magic

Workflow engine tidak menghapus kebutuhan untuk:

- idempotency,
- outbox/inbox,
- contract design,
- timeout budget,
- service ownership,
- authorization,
- data ownership,
- versioning,
- observability,
- compensation semantics.

Engine hanya memberi runtime primitive. Correctness tetap desain kita.

---

## 8. Choreography vs Orchestration Decision Matrix

| Question | Prefer Choreography | Prefer Orchestration / Process Manager |
|---|---|---|
| Number of participants | sedikit | banyak |
| Branching complexity | rendah | tinggi |
| Need global visibility | rendah | tinggi |
| Human tasks | jarang | sering |
| SLA/escalation | sederhana | kompleks |
| Compensation | sederhana/lokal | multi-step/berurutan |
| Audit defensibility | cukup event log | butuh process history eksplisit |
| Process owner | tidak jelas/tersebar | jelas |
| Change frequency | consumer independent | process flow sering berubah |
| Debugging need | rendah | tinggi |
| Risk of event soup | rendah | tinggi |

Rule of thumb:

```text
Use choreography for independent reactions to facts.
Use orchestration for explicit business processes with state, time, branching, and accountability.
```

---

## 9. Hybrid Model

Di sistem nyata, pilihan paling kuat sering hybrid.

Contoh:

```text
Approval Process Manager orchestrates core approval flow.

But events are still published:
- ApplicationApproved
- ApplicationRejected
- ClarificationRequested
- PaymentCompleted

Other services consume these events independently:
- Notification Service
- Analytics Service
- Audit Reporting Service
- Data Warehouse Projection
```

Artinya:

```text
orchestration for core process correctness
+ choreography for independent side effects
```

Ini biasanya lebih sehat daripada pure orchestration atau pure choreography.

---

## 10. Process State vs Domain State

Kesalahan umum: mencampur domain entity state dan workflow process state.

Contoh domain state:

```text
Application.status = SUBMITTED / UNDER_REVIEW / APPROVED / REJECTED
```

Contoh process state:

```text
ApprovalProcess.state = WAITING_FOR_SCREENING / WAITING_FOR_PAYMENT / WAITING_FOR_OFFICER_REVIEW
```

Mereka berhubungan, tapi tidak sama.

### 10.1 Domain State

Domain state menjawab:

```text
What is the business status of the entity?
```

### 10.2 Process State

Process state menjawab:

```text
Where are we in the coordination flow?
```

### 10.3 Why Separation Matters

Jika dicampur:

- status entity menjadi terlalu banyak,
- state explosion,
- UI bingung,
- audit sulit,
- retry/timeout logic masuk aggregate,
- process migration sulit.

Lebih sehat:

```text
Application aggregate owns business status.
ApprovalProcess owns coordination status.
```

---

## 11. Commands, Events, and Tasks in Workflow

### 11.1 Command

Command adalah instruksi.

```text
StartScreening
RequestPayment
AssignOfficer
GenerateDecisionLetter
RequestClarification
```

Command bisa gagal, bisa ditolak, dan harus punya idempotency key.

### 11.2 Event

Event adalah fakta.

```text
ScreeningCompleted
PaymentReceived
OfficerAssigned
ApplicationApproved
ClarificationSubmitted
```

Event tidak boleh memerintah consumer.

### 11.3 Task

Task adalah pekerjaan yang harus dilakukan.

Jenis task:

```text
service task
human task
timer task
manual task
external callback task
compensation task
```

### 11.4 Good Workflow Contract

Setiap step workflow harus punya:

```text
input contract
output event
failure event
timeout behavior
retry policy
idempotency key
owner service
observability labels
security context
compensation rule
```

---

## 12. Long-Running Workflow

Workflow disebut long-running bukan hanya karena durasinya panjang, tetapi karena:

- tidak bisa diselesaikan dalam satu transaction,
- melibatkan wait state,
- bisa survive restart,
- bisa dipengaruhi event masa depan,
- bisa menerima human decision,
- bisa butuh timer,
- bisa berubah versi selama instance lama masih berjalan.

Contoh:

```text
Application approval may take 3 days.
Clarification may wait 14 days.
Appeal may wait 30 days.
Investigation may wait 90 days.
```

Long-running workflow tidak boleh bergantung pada:

```text
in-memory thread
HTTP connection open
temporary cache only
single JVM process state
synchronous call chain
```

State harus durable.

---

## 13. Timer, Deadline, SLA, and Escalation

### 13.1 Timer

Timer adalah trigger berbasis waktu.

Contoh:

```text
If payment not received within 7 days, expire payment request.
```

### 13.2 Deadline

Deadline adalah batas waktu bisnis.

```text
Officer must complete review by 2026-07-01T17:00+08:00
```

### 13.3 SLA

SLA adalah komitmen layanan.

```text
95% of standard applications reviewed within 5 working days.
```

### 13.4 Escalation

Escalation adalah action ketika deadline/SLA risk terjadi.

```text
If officer does not review within 3 days:
- notify officer
- after 5 days notify supervisor
- after 7 days reassign case
```

### 13.5 Design Rule

Timer dan SLA harus berbasis durable state.

Jangan desain seperti ini:

```java
Thread.sleep(Duration.ofDays(7)); // terrible
```

Lebih sehat:

```text
store deadline_at
scheduler scans due process instances
or workflow engine registers durable timer
or broker delayed message/retry topic triggers due action
```

---

## 14. Human Task

Human task adalah bagian workflow yang menunggu manusia.

Contoh:

```text
Officer reviews application.
Supervisor approves exception.
Applicant submits clarification.
Legal team confirms enforcement action.
```

Human task berbeda dari service task karena:

- durasi tidak pasti,
- actor identity penting,
- authorization penting,
- delegation/escalation penting,
- audit evidence penting,
- task reassignment mungkin terjadi,
- concurrent action harus dicegah.

### 14.1 Human Task Table Example

```sql
CREATE TABLE human_task (
    task_id              VARCHAR(64) PRIMARY KEY,
    process_id           VARCHAR(64) NOT NULL,
    task_type            VARCHAR(80) NOT NULL,
    status               VARCHAR(40) NOT NULL,
    assignee_user_id     VARCHAR(80),
    assignee_role        VARCHAR(80),
    created_at           TIMESTAMP NOT NULL,
    due_at               TIMESTAMP,
    completed_at         TIMESTAMP,
    completed_by         VARCHAR(80),
    version              BIGINT NOT NULL
);
```

### 14.2 Human Task Invariants

```text
Only assigned officer can complete task.
Completed task cannot be completed again.
Expired task may require supervisor override.
Task decision must capture reason.
Task decision must be audit logged.
```

### 14.3 Human Task Anti-Pattern

Bad:

```text
UI directly changes Application.status = APPROVED.
```

Better:

```text
UI submits CompleteOfficerReview command.
Review Service validates permission and task state.
Process manager receives OfficerReviewCompleted event.
Process continues.
```

---

## 15. Compensation in Workflow

Compensation adalah aksi bisnis untuk mengurangi, membalik, atau mengoreksi efek step sebelumnya.

Azure Compensating Transaction pattern menekankan bahwa compensating transaction juga eventually consistent dan bisa gagal; maka step compensation harus resumable dan idempotent.

### 15.1 Compensation Is Not Database Rollback

Jika email sudah terkirim, kita tidak bisa “rollback email”.

Jika payment sudah captured, kita perlu refund.

Jika license sudah issued, kita perlu revoke.

Jika officer decision sudah recorded, kita perlu supersede/correct decision, bukan menghapus evidence.

### 15.2 Compensation Types

| Type | Example |
|---|---|
| Reversal | refund payment |
| Release | release reservation |
| Supersession | mark previous decision superseded |
| Correction | issue corrected letter |
| Notification | notify affected party |
| Manual remediation | assign officer to repair case |
| Legal correction | create formal amendment record |

### 15.3 Compensation Ordering

Compensation tidak selalu reverse order secara teknis. Ia harus mengikuti business semantics.

Example:

```text
1. Payment captured
2. License issued
3. Notification sent
4. Error discovered

Compensation may be:
1. Suspend license immediately
2. Notify applicant
3. Refund payment
4. Record corrected decision
```

Urutan ditentukan oleh risk, legal exposure, dan business impact.

---

## 16. Workflow Failure Modes

### 16.1 Participant Failure

Service participant down saat menerima command.

Response:

```text
retry with backoff
respect retry budget
mark step as delayed
raise incident if exceeded
```

### 16.2 Lost Command

Command tidak pernah sampai.

Response:

```text
outbox relay
command idempotency
command delivery metrics
reconciliation scan
```

### 16.3 Duplicate Command

Command terkirim dua kali.

Response:

```text
idempotency key
unique constraint
command processed table
same response replay
```

### 16.4 Lost Event

Participant selesai, tapi event tidak sampai.

Response:

```text
participant outbox
CDC
event replay
process reconciliation query
```

### 16.5 Out-of-Order Event

Event lama datang setelah state sudah maju.

Response:

```text
state machine guard
sequence/version check
ignore, park, or reconcile
```

### 16.6 Workflow Engine Down

Response:

```text
workflow state durable
workers stateless/restartable
no in-memory-only process state
```

### 16.7 Compensation Failure

Response:

```text
compensation retry
manual intervention queue
compensation status visible
partial compensation audit
```

### 16.8 Human Task Stuck

Response:

```text
deadline_at
escalation policy
reassignment
supervisor notification
operational dashboard
```

---

## 17. Workflow Versioning

Long-running workflow creates a serious versioning problem.

What if process model changes while old instances are still running?

### 17.1 Versioning Strategies

| Strategy | Description | Risk |
|---|---|---|
| Finish old version | Existing instances continue old model | need support old code/model |
| Migrate instances | Move old instances to new model | migration correctness risk |
| Branch in workflow | Code/model handles old/new paths | complexity grows |
| Cutover by date | New instances use new version after date | date/time boundary bugs |
| Manual migration | Review each affected instance | slow but safer for high-risk cases |

### 17.2 Store Process Version

Every process instance should store:

```text
process_definition_key
process_version
started_at
migration_status
```

### 17.3 Versioned Decision Rule

Do not merely store current rule. Store rule version used.

```text
screening_policy_version = 2026.06
approval_rule_version = v17
sla_policy_version = standard-2026-q2
```

This matters for audit.

---

## 18. Workflow Observability

Workflow observability must answer:

```text
Where is process X now?
Why is it waiting?
Who owns the next action?
What event caused this state?
What command was sent?
Was command acknowledged?
How many retries happened?
What deadline is at risk?
Which version is this process running?
What compensation has happened?
```

### 18.1 Required Metrics

```text
workflow_started_total
workflow_completed_total
workflow_failed_total
workflow_compensating_total
workflow_stuck_total
workflow_duration_seconds
workflow_step_duration_seconds
workflow_step_retry_total
workflow_deadline_missed_total
workflow_human_task_age_seconds
workflow_escalation_total
workflow_version_active_instances
```

### 18.2 Required Logs

Every transition log should include:

```text
process_id
business_key
process_type
process_version
previous_state
new_state
event_id
command_id
correlation_id
causation_id
actor_id
tenant_id
rule_version
```

### 18.3 Tracing

Distributed tracing is useful for short execution paths, but long-running workflows may exceed normal trace duration.

For long-running process, combine:

```text
trace for each transaction
+ correlation id across process
+ process history table
+ event log
+ audit log
```

---

## 19. Security and Authorization in Workflow

Workflow systems often cross multiple trust boundaries.

Questions:

- who can start process?
- who can cancel process?
- who can complete human task?
- who can override deadline?
- who can retry failed step?
- who can compensate?
- who can migrate process version?
- who can see process history?

### 19.1 Actor Context

A workflow step may be triggered by:

```text
human user
system actor
external agency
scheduled timer
message consumer
admin remediation
```

Always capture actor type.

```java
public enum ActorType {
    HUMAN_USER,
    SYSTEM,
    EXTERNAL_SYSTEM,
    SCHEDULER,
    ADMIN_REMEDIATION
}
```

### 19.2 Do Not Over-Propagate User Tokens

Long-running workflows cannot rely on original user token lasting for days.

Better model:

```text
user initiates process
→ system records initiating actor
→ workflow continues with service identity
→ every automated step records system actor + original initiator context where relevant
```

Do not use expired user access token to execute day-14 escalation.

---

## 20. Java 8–25 Considerations

### 20.1 Java 8

Common constraints:

- no records,
- no sealed classes,
- limited functional ergonomics,
- CompletableFuture available but less mature ecosystem,
- legacy Spring/Jakarta stacks common,
- workflow often implemented with DB scheduler or BPM engine.

Recommendation:

```text
Use explicit immutable classes.
Use enum state machine carefully.
Use DB transaction + outbox.
Avoid in-memory scheduler for durable workflow.
```

### 20.2 Java 11

Java 11 gives better baseline for modern service runtime.

Useful:

- standard HTTP Client,
- better container awareness than Java 8 era,
- LTS adoption,
- stronger ecosystem baseline.

### 20.3 Java 17

Java 17 is strong enterprise baseline.

Useful:

- records for command/event DTO,
- sealed classes for workflow events/commands,
- pattern matching improvements,
- stronger language modeling.

Example:

```java
public sealed interface ApprovalEvent
        permits ApplicationSubmitted, ScreeningCompleted, PaymentCompleted, OfficerDecisionMade {
    String eventId();
    String applicationId();
}

public record ApplicationSubmitted(
        String eventId,
        String applicationId,
        Instant occurredAt
) implements ApprovalEvent {}
```

### 20.4 Java 21

Java 21 brings virtual threads as final feature.

Useful for:

- blocking service tasks,
- synchronous worker activity execution,
- simpler concurrency model,
- less pressure to force reactive style everywhere.

But virtual threads do not solve:

```text
remote timeout
idempotency
backpressure
database pool limit
workflow durability
retry storm
compensation correctness
```

### 20.5 Java 25

Java 25 is latest LTS-era horizon after Java 21 and became GA in September 2025 via OpenJDK. For workflow architecture, the main implication is not that Java 25 magically changes patterns, but that modern Java increasingly supports clearer modeling and runtime ergonomics.

Use modern Java features to express workflow model more safely:

```text
records for immutable events/commands
sealed interfaces for closed state/event families
pattern matching for transition logic
structured concurrency where available and appropriate
virtual threads for blocking workers
```

But keep architecture portable across Java 8–25 by separating:

```text
core pattern
from language ergonomics
from framework/runtime implementation
```

---

## 21. Spring, Jakarta/MicroProfile, Quarkus, Temporal, Camunda Positioning

### 21.1 Spring Boot / Spring Cloud

Good for:

- process manager service,
- event consumers,
- outbox publisher,
- REST/gRPC workers,
- scheduled reconciliation,
- resilience integration.

Avoid:

```text
putting entire workflow into synchronous controller method
```

### 21.2 Jakarta / MicroProfile

Good for:

- enterprise runtime,
- REST Client,
- Fault Tolerance,
- Health,
- Config,
- JWT,
- Telemetry,
- Jakarta Persistence/JTA local transaction.

MicroProfile 7.1 includes capabilities relevant for microservices such as OpenAPI, REST Client, Config, Fault Tolerance, JWT Authentication, Health, and Telemetry.

### 21.3 Quarkus

Good for:

- lightweight worker services,
- fast startup,
- Kubernetes-native services,
- MicroProfile integration,
- messaging consumers.

### 21.4 Temporal

Good for:

- durable execution,
- workflow-as-code,
- long-running workflows,
- retries/timers,
- activity workers,
- saga compensation pattern.

Be careful with:

```text
deterministic workflow code
activity idempotency
workflow history growth
platform operational ownership
```

### 21.5 Camunda / Zeebe / BPMN

Good for:

- explicit process model,
- business-readable workflow,
- human task,
- SLA/escalation,
- process monitoring,
- regulated process evidence,
- cross-service orchestration.

Be careful with:

```text
putting too much domain logic inside BPMN
model becoming unreadable
central workflow team bottleneck
service autonomy erosion
```

---

## 22. Implementation Pattern: Custom Process Manager with Outbox

### 22.1 High-Level Architecture

```text
Incoming Event Topic
        |
        v
Process Manager Consumer
        |
        v
Load Process Instance
        |
        v
Apply State Transition
        |
        v
Persist Process State + Outbox Commands
        |
        v
Command Relay Publishes Commands
        |
        v
Participant Services Execute Local Transactions
        |
        v
Participant Services Publish Events
```

### 22.2 Process Transition Model

```java
public final class ApprovalProcess {
    private final String processId;
    private final String applicationId;
    private ApprovalProcessState state;
    private long version;
    private final Set<String> handledEventIds;

    public ProcessTransition handle(ApprovalEvent event, Instant now) {
        if (handledEventIds.contains(event.eventId())) {
            return ProcessTransition.noop();
        }

        if (event instanceof ScreeningCompleted completed) {
            return onScreeningCompleted(completed, now);
        }

        if (event instanceof PaymentCompleted completed) {
            return onPaymentCompleted(completed, now);
        }

        throw new IllegalStateException("Unsupported event: " + event.getClass().getName());
    }

    private ProcessTransition onScreeningCompleted(ScreeningCompleted event, Instant now) {
        if (state != ApprovalProcessState.WAITING_FOR_SCREENING) {
            return ProcessTransition.park("Unexpected ScreeningCompleted in state " + state);
        }

        handledEventIds.add(event.eventId());

        if (event.highRisk()) {
            state = ApprovalProcessState.WAITING_FOR_ENHANCED_REVIEW;
            return ProcessTransition.commands(List.of(
                    new CreateEnhancedReviewCommand(applicationId, processId)
            ));
        }

        state = ApprovalProcessState.WAITING_FOR_PAYMENT;
        return ProcessTransition.commands(List.of(
                new RequestPaymentCommand(applicationId, processId)
        ));
    }
}
```

For Java 8, replace records/sealed/pattern matching with explicit classes and visitor/dispatcher.

### 22.3 Transaction Boundary

```java
@Transactional
public void handleEvent(ApprovalEvent event) {
    ApprovalProcess process = repository.findByBusinessKey(event.applicationId())
            .orElseThrow();

    ProcessTransition transition = process.handle(event, clock.instant());

    repository.save(process);

    for (ProcessCommand command : transition.commands()) {
        outboxRepository.insert(OutboxMessage.from(command));
    }
}
```

Correctness invariant:

```text
process state transition and outgoing command must commit atomically
```

---

## 23. Anti-Patterns

### 23.1 Distributed Monolith Workflow

Symptoms:

```text
Service A calls B calls C calls D synchronously.
A request thread waits for all.
One service down means whole process down.
Rollback is unclear.
No durable process state.
```

### 23.2 God Orchestrator

Symptoms:

```text
Orchestrator knows every table, rule, validation, and internal data structure.
Participant services become dumb CRUD endpoints.
All business changes require orchestrator changes.
```

### 23.3 Event Soup

Symptoms:

```text
Hundreds of events.
No event owner.
No process visibility.
Consumers trigger more events unpredictably.
No one can draw the end-to-end flow.
```

### 23.4 In-Memory Workflow

Symptoms:

```text
Process state stored in thread/local memory/cache only.
Restart loses workflow.
Timer is Thread.sleep.
No durable correlation.
```

### 23.5 UI-Driven Workflow

Symptoms:

```text
Frontend decides next process state.
Backend exposes generic status update endpoint.
Authorization and audit become weak.
```

### 23.6 BPMN as God Domain Model

Symptoms:

```text
Every domain rule is encoded in BPMN gateways.
Service boundaries become irrelevant.
Business process diagram becomes unreadable.
Testing is painful.
```

### 23.7 Workflow Without Versioning

Symptoms:

```text
Old running process instances break after new deployment.
No process_version.
No migration strategy.
Audit cannot explain historical rule.
```

---

## 24. Regulatory Case Management Example

### 24.1 Scenario

A regulatory agency processes license application.

Flow:

```text
Applicant submits application.
System validates form.
System screens applicant.
If high risk, enhanced review required.
Payment may be required.
Officer reviews documents.
Officer may approve, reject, or request clarification.
Applicant has 14 days to submit clarification.
If no clarification, application is withdrawn.
If officer misses SLA, supervisor is notified.
Decision letter is generated and sent.
Audit trail must explain every transition.
```

### 24.2 Suggested Architecture

```text
Application Service
- owns application aggregate and business status

Approval Process Manager
- owns approval workflow state
- sends commands
- records process history

Screening Service
- owns screening rules/results

Payment Service
- owns payment request/payment status

Task Service
- owns human tasks and assignment

Notification Service
- sends email/SMS/inbox notification

Document Service
- owns decision letter generation/storage

Audit Service / Audit Projection
- receives events and builds defensible audit views
```

### 24.3 Why Not Pure Choreography?

Because process has:

```text
branching
human tasks
timers
SLA
escalation
regulatory audit
manual intervention
versioned rules
```

Pure choreography would hide the process.

### 24.4 Why Not God Orchestrator?

Because each participant still owns domain capability.

Approval Process Manager should not know:

```text
how screening score is calculated
how payment provider works
how document template is rendered
how officer assignment algorithm ranks workload
```

It should know only:

```text
what step is needed next
what command contract to call/publish
what event confirms completion
what timeout/escalation applies
```

---

## 25. Production Readiness Checklist

A workflow/process manager design is production-ready only if it answers yes to these questions.

### 25.1 Process State

- [ ] Is process state durable?
- [ ] Is process state separate from domain entity state when needed?
- [ ] Is process version stored?
- [ ] Is transition history stored?
- [ ] Is state transition guarded?
- [ ] Is optimistic locking or equivalent used?

### 25.2 Reliability

- [ ] Are outgoing commands written using outbox?
- [ ] Are incoming events deduplicated?
- [ ] Are participant commands idempotent?
- [ ] Are retries bounded?
- [ ] Are timeouts explicit?
- [ ] Are stuck workflows detectable?
- [ ] Is there reconciliation?

### 25.3 Compensation

- [ ] Are compensation steps explicitly modeled?
- [ ] Are compensation commands idempotent?
- [ ] Can compensation resume after failure?
- [ ] Is manual remediation available?
- [ ] Is partial compensation visible?

### 25.4 Human Task

- [ ] Is task ownership clear?
- [ ] Is authorization enforced server-side?
- [ ] Are task decisions audited?
- [ ] Are deadlines and escalation modeled?
- [ ] Are concurrent task actions prevented?

### 25.5 Observability

- [ ] Can operator see current workflow state?
- [ ] Can operator see why process is waiting?
- [ ] Are metrics emitted per workflow type/version/state?
- [ ] Are transition logs correlated?
- [ ] Are failed/stuck/compensating workflows alerted?

### 25.6 Governance

- [ ] Is workflow owner defined?
- [ ] Is participant owner defined?
- [ ] Is process versioning strategy defined?
- [ ] Is migration strategy defined?
- [ ] Is audit/compliance requirement mapped?

---

## 26. Senior/Principal Engineer Review Questions

Ask these during architecture review:

1. What business outcome does this workflow own?
2. Which service owns the process state?
3. Which service owns each domain capability?
4. Is this flow better as choreography, orchestration, process manager, or hybrid?
5. What happens if a participant service is down for 2 hours?
6. What happens if an event arrives twice?
7. What happens if an event arrives out of order?
8. What happens if workflow engine/process manager crashes after state update but before command publish?
9. What happens if command succeeds but success event is delayed?
10. What happens if compensation fails?
11. How do we find stuck workflows?
12. How do we migrate running workflow instances to a new version?
13. Which decisions must be audit-defensible?
14. Which steps are reversible, compensatable, or irreversible?
15. Can a business person understand the process model?
16. Can an operator debug one failed instance in production?
17. What is the maximum acceptable process duration?
18. What is the retry budget?
19. Where is authorization enforced for human tasks?
20. What would make this design become a distributed monolith?

---

## 27. Practical Exercises

### Exercise 1 — Draw Process Boundary

Pick a business process:

```text
license application approval
order fulfillment
loan origination
case escalation
data archival approval
incident response workflow
```

Draw:

```text
services
commands
events
human tasks
timers
compensation
process state owner
```

### Exercise 2 — Choreography vs Orchestration

For each process, decide:

```text
pure choreography
orchestration
process manager
workflow engine
hybrid
```

Justify based on:

```text
participants
branching
human task
SLA
compensation
audit
change frequency
```

### Exercise 3 — Failure Matrix

Create table:

```text
step
failure mode
detection
retry
timeout
compensation
manual action
metric
```

### Exercise 4 — Process Versioning

Define how you handle:

```text
old instance running v1
new instances start v2
v1 has bug
v2 changes approval rule
some cases need migration
```

### Exercise 5 — Implement Mini Process Manager

Implement in Java:

```text
ApplicationSubmitted
→ StartScreening command
→ ScreeningCompleted
→ RequestPayment command
→ PaymentCompleted
→ AssignOfficer command
```

Requirements:

```text
idempotent event handling
optimistic locking
outbox command
state transition guard
process history
```

---

## 28. Key Takeaways

1. Workflow is not a chain of service calls.
2. Long-running process needs durable state.
3. Choreography is powerful for independent reactions but dangerous for complex end-to-end processes.
4. Orchestration improves visibility but can become a god service.
5. Process manager is often the sweet spot for domain-owned coordination.
6. Workflow engine is useful when timer, human task, visibility, retry, and process history become operationally important.
7. Compensation is semantic correction, not database rollback.
8. Workflow versioning is mandatory for long-running systems.
9. Human task requires authorization, audit, assignment, deadline, and concurrency control.
10. Top-tier microservices design uses hybrid coordination deliberately.

---

## 29. References

- Microservices.io — Saga Pattern: https://microservices.io/patterns/data/saga.html
- Microservices.io — Choreography vs Orchestration discussion: https://microservices.io/post/sagas/2019/08/04/developing-sagas-part-2.html
- Temporal Java SDK Developer Guide: https://docs.temporal.io/develop/java
- Temporal — Compensating Actions / Saga: https://temporal.io/blog/compensating-actions-part-of-a-complete-breakfast-with-sagas
- Temporal GitHub — Durable execution platform: https://github.com/temporalio/temporal
- Camunda — Orchestration vs Choreography: https://camunda.com/blog/2023/02/orchestration-vs-choreography/
- Camunda Docs — Orchestrate Microservices: https://docs.camunda.io/docs/8.7/guides/orchestrate-microservices/
- Camunda — BPMN and Microservices Orchestration: https://camunda.com/blog/2018/08/bpmn-for-microservices-orchestration-a-primer-part-1/
- Azure Architecture Center — Compensating Transaction Pattern: https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction
- Nadeem & Malik — A Case for Microservices Orchestration Using Workflow Engines: https://arxiv.org/abs/2204.07210
- OpenJDK JDK 25 Project: https://openjdk.org/projects/jdk/25/

---

## 30. Status Seri

Seri belum selesai.

Progress saat ini:

```text
Completed: Part 0 sampai Part 18
Current: Part 18 — Workflow, Orchestration, Choreography, and Process Managers
Remaining: Part 19 sampai Part 34
```

Part berikutnya:

```text
Part 19 — State Machine Pattern for Microservices
```

Filename berikutnya:

```text
learn-java-microservices-patterns-advanced-engineering-19-state-machine-pattern.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-17-idempotency-deduplication-exactly-once-business-effect.md">⬅️ Learn Java Microservices Patterns Advanced Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-19-state-machine-pattern.md">Part 19 — State Machine Pattern for Microservices ➡️</a>
</div>
