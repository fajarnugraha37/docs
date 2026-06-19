# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-15.md

# Part 15 — Workflow, Saga, and Enforcement Lifecycle Modelling with RabbitMQ

> Seri: RabbitMQ, RabbitMQ Streams, Messaging Architecture untuk Java Engineers  
> Target pembaca: Java software engineer / tech lead yang ingin mendesain messaging subsystem untuk workflow kompleks, long-running process, regulatory case management, dan enforcement lifecycle.  
> Fokus part ini: menggunakan RabbitMQ sebagai backbone koordinasi workflow tanpa jatuh ke perangkap “semua event = workflow selesai”.

---

## 1. Posisi Part Ini dalam Seri

Sampai part sebelumnya, kita sudah membahas:

- RabbitMQ mental model.
- AMQP exchange, queue, binding, routing key.
- queue type: classic, quorum, stream.
- Java client dan Spring AMQP.
- publisher reliability.
- consumer reliability.
- retry, DLQ, poison message.
- message contract.
- ordering, concurrency, partitioning.
- request/reply dan bahaya hidden synchronous coupling.

Part ini naik satu level: **bagaimana RabbitMQ dipakai untuk menggerakkan lifecycle bisnis yang panjang, bercabang, auditable, dan gagal sebagian**.

Contoh domain:

- case management.
- enforcement lifecycle.
- compliance investigation.
- dispute handling.
- fraud review.
- onboarding review.
- procurement approval.
- insurance claim.
- loan origination.
- fulfillment orchestration.

Ciri workflow seperti ini:

- banyak aktor.
- banyak tahap.
- ada deadline.
- ada escalation.
- ada retry.
- ada manual review.
- ada audit trail.
- ada state transition yang harus defensible.
- ada event dan command yang terlihat mirip tetapi dampaknya berbeda.

RabbitMQ bisa sangat kuat untuk ini, tetapi hanya kalau kita jelas membedakan:

- **state machine** vs **message flow**.
- **event** vs **command**.
- **choreography** vs **orchestration**.
- **business retry** vs **technical retry**.
- **audit stream** vs **work queue**.
- **notification** vs **source of truth**.

---

## 2. Core Thesis

RabbitMQ bukan workflow engine penuh.

RabbitMQ adalah:

1. **routing fabric** untuk mengirim message ke pihak yang relevan.
2. **work distribution engine** untuk mendistribusikan pekerjaan ke workers.
3. **durable handoff boundary** untuk memisahkan producer dan consumer.
4. **retry/DLQ mechanism** untuk technical failure handling.
5. **integration backbone** untuk command/event/notification propagation.
6. **possible audit/replay component** kalau dikombinasikan dengan stream.

RabbitMQ bukan secara otomatis:

- state machine.
- business process manager.
- timer engine lengkap.
- compensation coordinator.
- source of truth lifecycle.
- temporal workflow runtime.

Karena itu, desain terbaik biasanya adalah:

```text
Business State Machine / Orchestrator / Domain Service
        |
        | emits commands/events
        v
RabbitMQ Exchange + Queues + Streams
        |
        | delivers work / notifications / audit records
        v
Workers / Integrations / Projectors / Notifiers
```

Dengan kata lain:

> RabbitMQ membawa pesan. Aplikasi tetap bertanggung jawab atas makna state transition.

---

## 3. Workflow: Definisi yang Berguna untuk Engineer

Workflow adalah rangkaian state dan action yang menggerakkan sebuah entity dari kondisi awal ke kondisi akhir.

Contoh enforcement case:

```text
OPENED
  -> EVIDENCE_COLLECTION
  -> RULE_EVALUATION
  -> HUMAN_REVIEW
  -> ACTION_PROPOSED
  -> APPROVAL_PENDING
  -> ACTION_ISSUED
  -> MONITORING
  -> CLOSED
```

Tetapi di dunia nyata, workflow tidak linear:

```text
OPENED
  -> EVIDENCE_COLLECTION
      -> MORE_INFORMATION_REQUIRED
      -> EVIDENCE_COLLECTION
  -> RULE_EVALUATION
      -> NO_VIOLATION_FOUND -> CLOSED
      -> POTENTIAL_VIOLATION -> HUMAN_REVIEW
  -> HUMAN_REVIEW
      -> ESCALATED
      -> ACTION_PROPOSED
      -> REJECTED_FOR_REWORK
  -> APPROVAL_PENDING
      -> APPROVED -> ACTION_ISSUED
      -> REJECTED -> REWORK
  -> ACTION_ISSUED
      -> APPEALED
      -> MONITORING
      -> CLOSED
```

Message broker tidak menyimpan diagram ini sebagai truth. Broker hanya membawa message seperti:

- `CaseOpened`.
- `EvidenceSubmitted`.
- `RuleEvaluationRequested`.
- `RuleEvaluationCompleted`.
- `HumanReviewAssigned`.
- `EscalationTriggered`.
- `EnforcementActionProposed`.
- `ApprovalRequested`.
- `ActionIssued`.
- `CaseClosed`.

State transition tetap harus divalidasi oleh domain layer.

---

## 4. State Machine vs Message Flow

Ini perbedaan paling penting.

### 4.1 State Machine

State machine menjawab:

- entity sekarang ada di state apa?
- event/command apa yang boleh diterima?
- transisi apa yang valid?
- siapa yang boleh memicu transisi?
- kapan transisi boleh terjadi?
- apakah precondition terpenuhi?
- side effect apa yang harus dijadwalkan?
- apa yang harus diaudit?

Contoh:

```text
Case state = HUMAN_REVIEW
Command = ApproveAction
Allowed? yes, if reviewer has authority and evidence is complete.
Next state = APPROVAL_PENDING
Side effects = publish ApprovalRequested command/event.
```

### 4.2 Message Flow

Message flow menjawab:

- message dikirim ke exchange apa?
- routing key apa?
- queue mana yang menerima?
- consumer mana yang memproses?
- bagaimana retry?
- bagaimana DLQ?
- bagaimana observability?
- apa yang terjadi kalau consumer down?

Contoh:

```text
Exchange: enforcement.events
Routing key: case.action.proposed
Queue: approval-service.action-proposed.q
Consumer: ApprovalRequestConsumer
```

### 4.3 Kesalahan Umum

Kesalahan besar:

> Menganggap karena message sudah terkirim, maka state business sudah valid.

Yang benar:

> Message adalah stimulus atau record. State transition tetap harus divalidasi di domain state machine.

---

## 5. Command, Event, Job, Notification dalam Workflow

Workflow menjadi kacau kalau semua message disebut “event”.

### 5.1 Command

Command adalah permintaan melakukan sesuatu.

Contoh:

```text
EvaluateRulesForCase
AssignHumanReview
GenerateEnforcementNotice
SendNotification
EscalateOverdueCase
```

Karakter command:

- imperative.
- memiliki intended receiver.
- biasanya dikirim ke queue khusus service/worker.
- boleh gagal.
- bisa ditolak.
- harus idempotent.
- sering membutuhkan retry.

Routing umum:

```text
Exchange: enforcement.commands
Routing key: rule.evaluate
Queue: rule-engine.evaluate.q
```

### 5.2 Event

Event adalah fakta bahwa sesuatu sudah terjadi.

Contoh:

```text
CaseOpened
EvidenceSubmitted
RuleEvaluationCompleted
HumanReviewAssigned
EscalationTriggered
ActionIssued
```

Karakter event:

- past tense.
- factual.
- tidak memerintah consumer tertentu.
- boleh memiliki banyak subscriber.
- tidak boleh diubah setelah publish.
- cocok untuk fanout/topic routing.

Routing umum:

```text
Exchange: enforcement.events
Routing key: case.evidence.submitted
Queue: audit.case-events.q
Queue: notification.evidence-submitted.q
Queue: rule-engine.evidence-submitted.q
```

### 5.3 Job

Job adalah unit kerja background.

Contoh:

```text
GeneratePdfNoticeJob
RecalculateRiskScoreJob
ExportCaseBundleJob
RefreshExternalRegistrySnapshotJob
```

Karakter job:

- workload-oriented.
- sering resource-intensive.
- butuh concurrency control.
- butuh retry dan DLQ.
- sering tidak semantik sebagai domain event.

Routing umum:

```text
Exchange: enforcement.jobs
Routing key: document.generate-notice
Queue: document-generator.notice.q
```

### 5.4 Notification

Notification adalah pesan untuk memberi tahu manusia/sistem eksternal.

Contoh:

```text
NotifyReviewerAssigned
NotifyDeadlineApproaching
NotifyActionIssued
```

Karakter notification:

- delivery channel bisa email/SMS/webhook/in-app.
- bisa deduplicated.
- sering punya template version.
- failure-nya tidak selalu menggagalkan workflow utama.

Routing umum:

```text
Exchange: enforcement.notifications
Routing key: reviewer.assigned.email
Queue: notification-service.email.q
```

---

## 6. Choreography vs Orchestration

Saga adalah pola untuk mengelola proses lintas service tanpa distributed transaction global.

Ada dua gaya umum:

1. choreography.
2. orchestration.

### 6.1 Choreography

Dalam choreography, service bereaksi terhadap event dan memutuskan langkah berikutnya sendiri.

Contoh:

```text
Case Service publishes CaseOpened
Rule Engine consumes CaseOpened -> publishes RuleEvaluationCompleted
Review Service consumes RuleEvaluationCompleted -> publishes HumanReviewAssigned
Notification Service consumes HumanReviewAssigned -> sends notification
```

Kelebihan:

- loosely coupled.
- mudah menambah subscriber baru.
- cocok untuk notification, projection, audit, integration side effects.
- RabbitMQ topic exchange sangat cocok.

Kekurangan:

- flow sulit terlihat dari satu tempat.
- debugging lebih sulit.
- business process tersebar.
- accidental coupling lewat event.
- susah mengontrol compensation.
- susah memberi jawaban “case ini sedang menunggu apa?”.

Choreography cocok jika:

- prosesnya sederhana.
- event benar-benar fakta domain.
- tiap service bisa independen.
- tidak butuh strict global sequencing.
- failure handling local cukup.

### 6.2 Orchestration

Dalam orchestration, ada satu komponen yang mengontrol langkah-langkah saga/workflow.

Contoh:

```text
Case Orchestrator:
  1. receive CaseOpened
  2. send EvaluateRules command
  3. wait RuleEvaluationCompleted
  4. if potential violation, send AssignHumanReview command
  5. wait HumanReviewCompleted
  6. send GenerateNotice command
  7. wait NoticeGenerated
  8. send RequestApproval command
```

Kelebihan:

- flow eksplisit.
- state proses terlihat.
- lebih mudah audit.
- lebih mudah deadline/escalation.
- compensation bisa dikelola.
- lebih cocok untuk regulated workflows.

Kekurangan:

- orchestrator bisa menjadi bottleneck konseptual.
- coupling ke command/reply/event contract.
- perlu persistent workflow state.
- perlu handling timeout dan duplicate.

Orchestration cocok jika:

- lifecycle kompleks.
- ada deadline.
- ada human approval.
- ada compensation.
- ada audit/regulatory demand.
- ada need untuk “where is this case stuck?”.

### 6.3 Hybrid yang Realistis

Banyak sistem produksi memakai hybrid:

```text
Orchestrator controls core lifecycle.
Events notify ecosystem.
Workers execute commands.
Streams store audit/replay record.
```

Contoh:

```text
Case Orchestrator -> command -> Rule Engine
Rule Engine -> event -> RuleEvaluationCompleted
Case Orchestrator consumes event and advances state
Other services also consume event for projection/notification/audit
```

Ini sering paling sehat.

---

## 7. RabbitMQ Topology untuk Workflow

Topology dasar yang bisa dipakai:

```text
                         +-----------------------+
                         |  case-service /       |
                         |  workflow-orchestrator|
                         +-----------+-----------+
                                     |
                                     | publish commands/events
                                     v
+-------------------+       +-------------------+       +-------------------+
| enforcement.cmds  | ----> | service command   | ----> | worker consumers  |
| direct/topic ex   |       | queues            |       |                   |
+-------------------+       +-------------------+       +-------------------+

+-------------------+       +-------------------+       +-------------------+
| enforcement.events| ----> | subscriber queues | ----> | projectors,       |
| topic exchange    |       |                   |       | notifications,    |
+-------------------+       +-------------------+       | audit, workflows  |
                                                        +-------------------+

+-------------------+       +-------------------+
| enforcement.audit | ----> | stream / audit q  |
| stream/topic      |       |                   |
+-------------------+       +-------------------+
```

### 7.1 Exchange Separation

Pisahkan exchange berdasarkan semantic role:

```text
enforcement.commands
enforcement.events
enforcement.jobs
enforcement.notifications
enforcement.audit
```

Kenapa?

Karena retry, ownership, permission, routing key, durability, observability, dan evolution berbeda.

### 7.2 Queue Naming

Contoh:

```text
rule-engine.evaluate-case.q
review-service.assign-review.q
notification-service.email.q
audit-service.case-events.stream
case-orchestrator.events.q
case-orchestrator.commands.dlq
```

Queue sebaiknya dinamai dari perspektif consumer/owner, bukan dari perspektif producer.

Buruk:

```text
case-opened-queue
```

Lebih baik:

```text
rule-engine.case-opened.q
notification-service.case-opened.q
audit.case-events.stream
```

Karena satu event bisa punya banyak consumer dengan failure policy berbeda.

---

## 8. Workflow State Store

RabbitMQ tidak menggantikan database workflow state.

Minimal state store harus bisa menjawab:

- case sedang di state apa?
- step apa yang sedang pending?
- command apa yang sudah dikirim?
- event apa yang sudah diterima?
- retry business apa yang sedang berlangsung?
- deadline apa yang aktif?
- escalation apa yang sudah terjadi?
- compensation apa yang perlu dilakukan?
- apa last processed message id?

Contoh tabel sederhana:

```sql
CREATE TABLE case_workflow_instance (
    case_id              UUID PRIMARY KEY,
    workflow_version      INT NOT NULL,
    current_state         VARCHAR(100) NOT NULL,
    current_step          VARCHAR(100),
    status                VARCHAR(50) NOT NULL,
    last_event_id         UUID,
    last_command_id       UUID,
    deadline_at           TIMESTAMP,
    escalation_level      INT NOT NULL DEFAULT 0,
    created_at            TIMESTAMP NOT NULL,
    updated_at            TIMESTAMP NOT NULL
);
```

Untuk idempotency:

```sql
CREATE TABLE workflow_processed_message (
    consumer_name         VARCHAR(150) NOT NULL,
    message_id            UUID NOT NULL,
    case_id               UUID,
    processed_at          TIMESTAMP NOT NULL,
    PRIMARY KEY (consumer_name, message_id)
);
```

Untuk command tracking:

```sql
CREATE TABLE workflow_command_log (
    command_id            UUID PRIMARY KEY,
    case_id               UUID NOT NULL,
    command_type          VARCHAR(150) NOT NULL,
    target_service        VARCHAR(150) NOT NULL,
    status                VARCHAR(50) NOT NULL,
    created_at            TIMESTAMP NOT NULL,
    published_at          TIMESTAMP,
    completed_at          TIMESTAMP,
    failed_at             TIMESTAMP,
    failure_reason        TEXT
);
```

RabbitMQ mengirim command/event. Database menyimpan process truth.

---

## 9. Transaction Boundary dalam Workflow

Critical invariant:

> Jangan ack message sebelum state transition yang diperlukan tersimpan secara durable.

Contoh consumer orchestrator menerima `RuleEvaluationCompleted`.

Urutan aman:

```text
1. receive message
2. check idempotency
3. load workflow instance
4. validate transition
5. update workflow state
6. insert outbox command/event if needed
7. commit DB transaction
8. ack RabbitMQ message
9. outbox publisher publishes next message
```

Bukan:

```text
1. receive message
2. ack RabbitMQ message
3. update DB
4. crash
```

Karena kalau crash setelah ack sebelum DB commit, message hilang dari broker dan state tidak berubah.

### 9.1 Handler Skeleton

```java
public void handle(MessageEnvelope<RuleEvaluationCompleted> envelope, Channel channel, long tag) {
    try {
        workflowService.applyRuleEvaluation(envelope);
        channel.basicAck(tag, false);
    } catch (DuplicateMessageException duplicate) {
        channel.basicAck(tag, false);
    } catch (RetryableException retryable) {
        channel.basicNack(tag, false, false); // send to DLX/retry path
    } catch (PermanentBusinessException permanent) {
        channel.basicNack(tag, false, false); // DLQ/parking lot depending policy
    } catch (Exception unknown) {
        channel.basicNack(tag, false, false);
    }
}
```

Tetapi `workflowService.applyRuleEvaluation` harus melakukan DB transaction secara benar.

### 9.2 DB Transaction Example

```java
@Transactional
public void applyRuleEvaluation(MessageEnvelope<RuleEvaluationCompleted> envelope) {
    if (processedMessageRepository.exists(CONSUMER_NAME, envelope.messageId())) {
        return;
    }

    RuleEvaluationCompleted event = envelope.payload();

    CaseWorkflow workflow = workflowRepository.findForUpdate(event.caseId())
        .orElseThrow(() -> new PermanentBusinessException("workflow_not_found"));

    workflow.apply(event);

    processedMessageRepository.insert(CONSUMER_NAME, envelope.messageId(), event.caseId());

    if (workflow.requiresHumanReview()) {
        outboxRepository.insert(CommandMessage.assignHumanReview(
            event.caseId(),
            envelope.correlationId(),
            envelope.messageId()
        ));
    }

    workflowRepository.save(workflow);
}
```

Important detail:

- `findForUpdate` atau optimistic locking diperlukan untuk mencegah race transition.
- idempotency insert harus atomic.
- outbox insert harus satu transaction dengan state update.

---

## 10. Saga: Apa yang Harus Disimpan?

Untuk saga/workflow, jangan hanya menyimpan `status`.

Simpan minimal:

```text
workflow_instance
  - id
  - business entity id
  - workflow type
  - workflow version
  - current state
  - current step
  - status
  - deadline
  - correlation id
  - escalation level
  - last transition reason
  - created_at
  - updated_at

workflow_transition_log
  - transition id
  - workflow id
  - from state
  - to state
  - trigger type
  - trigger message id
  - actor/system
  - reason code
  - policy version
  - occurred_at

workflow_command_log
  - command id
  - command type
  - target
  - status
  - published_at
  - completed_at

workflow_timer
  - timer id
  - workflow id
  - timer type
  - due_at
  - status

workflow_processed_message
  - consumer
  - message id
  - processed_at
```

Ini membantu menjawab:

- kenapa case pindah state?
- siapa/apa yang memicu?
- message apa yang jadi bukti?
- aturan versi berapa yang dipakai?
- command apa yang dikirim?
- apakah command pernah gagal?
- kapan escalation terjadi?

Dalam regulated systems, jawaban ini sering lebih penting dari sekadar “message berhasil dikirim”.

---

## 11. Business Retry vs Technical Retry

Ini pemisahan yang sering diabaikan.

### 11.1 Technical Retry

Technical retry menangani failure teknis sementara:

- database timeout.
- external API 503.
- network hiccup.
- broker reconnection.
- temporary lock conflict.

Biasanya cocok dengan:

- DLX retry queue.
- delayed exchange.
- exponential backoff.
- limited retry count.
- DLQ setelah gagal.

### 11.2 Business Retry

Business retry adalah proses bisnis yang menunggu kondisi berubah.

Contoh:

- menunggu dokumen tambahan.
- menunggu reviewer menyelesaikan tugas.
- menunggu pihak eksternal menjawab dalam 5 hari.
- menunggu cooling-off period.
- menunggu payment settlement.
- menunggu appeal window selesai.

Ini tidak boleh dimodelkan sebagai technical retry message tiap beberapa detik.

Lebih benar:

```text
Workflow state = WAITING_FOR_ADDITIONAL_EVIDENCE
Deadline = 2026-07-01T17:00:00+07:00
Timer scheduled = EvidenceDeadlineReached
```

RabbitMQ bisa membawa timer-triggered command/event, tetapi source of truth deadline tetap di workflow DB.

---

## 12. Timers, Deadlines, and Escalation

RabbitMQ sendiri bukan timer engine yang ideal untuk semua kebutuhan long-running timer.

Pilihan implementasi:

1. DB scheduled job polls due timers.
2. delayed message exchange.
3. TTL retry queue.
4. external scheduler.
5. workflow engine.
6. hybrid DB timer + RabbitMQ command.

Untuk regulated workflow, pola yang sering defensible:

```text
1. Store deadline in DB.
2. Scheduler scans due timers.
3. Scheduler publishes command: EscalateOverdueCase.
4. Orchestrator consumes command.
5. Orchestrator validates current state and deadline.
6. Orchestrator transitions state if still overdue.
7. Orchestrator emits EscalationTriggered event.
```

Kenapa validasi ulang diperlukan?

Karena saat timer firing, kondisi bisa sudah berubah.

Contoh:

```text
Timer says: escalate case C1.
But before command processed, reviewer completed the task.
Current state no longer overdue.
Therefore escalation command should become no-op and acked.
```

### 12.1 Escalation State Machine

```text
HUMAN_REVIEW_ASSIGNED
  deadline_at reached
  -> REVIEW_OVERDUE
  -> ESCALATION_LEVEL_1
  -> ESCALATION_LEVEL_2
  -> MANAGEMENT_REVIEW
```

Message:

```json
{
  "messageId": "3e6b3d2e-4f54-4f4b-a0d7-1f9a...",
  "messageType": "EscalateOverdueCase",
  "schemaVersion": 1,
  "correlationId": "case-correlation-123",
  "causationId": "timer-987",
  "payload": {
    "caseId": "case-123",
    "expectedState": "HUMAN_REVIEW_ASSIGNED",
    "deadlineAt": "2026-07-01T17:00:00+07:00",
    "escalationLevel": 1,
    "reasonCode": "REVIEW_DEADLINE_EXCEEDED"
  }
}
```

Notice `expectedState`. Ini membantu idempotency dan race safety.

---

## 13. Compensation

Saga sering butuh compensation, bukan rollback database global.

Contoh:

```text
1. Enforcement notice generated.
2. Notice sent to external delivery provider.
3. Approval later rejected due to discovered error.
4. Need send cancellation/amendment notice.
```

Tidak ada distributed rollback.

Yang ada:

```text
GenerateNotice -> NoticeGenerated -> SendNotice -> NoticeSent
Later: ApprovalRejectedAfterNotice
Compensation: SendNoticeCorrection / RevokeNotice / AddCaseNote
```

Compensation adalah action bisnis baru, bukan undo magic.

### 13.1 Compensation Message Design

```json
{
  "messageType": "RevokeEnforcementNotice",
  "schemaVersion": 1,
  "messageId": "...",
  "correlationId": "case-123-flow",
  "causationId": "approval-rejected-event-id",
  "payload": {
    "caseId": "case-123",
    "noticeId": "notice-456",
    "reasonCode": "APPROVAL_REJECTED_AFTER_NOTICE",
    "legalBasisVersion": "policy-2026.04"
  }
}
```

Compensation harus:

- idempotent.
- auditable.
- explicit.
- tied to original causation.
- safe if original action never completed.

---

## 14. Idempotent Workflow Transitions

Workflow consumer harus tahan duplicate.

Duplicate bisa terjadi karena:

- consumer crash setelah DB commit sebelum ack.
- publisher retry karena confirm timeout.
- outbox relay retry.
- network recovery.
- manual replay.
- DLQ reprocessing.

Idempotency bukan optional.

### 14.1 Idempotency by Message ID

```java
@Transactional
public void handle(MessageEnvelope<EvidenceSubmitted> envelope) {
    if (processedMessageRepository.exists(CONSUMER, envelope.messageId())) {
        return;
    }

    CaseWorkflow workflow = workflowRepository.findForUpdate(envelope.payload().caseId())
        .orElseThrow();

    workflow.applyEvidenceSubmitted(envelope.payload());

    processedMessageRepository.insert(CONSUMER, envelope.messageId());
    workflowRepository.save(workflow);
}
```

### 14.2 Idempotency by Business Key

Kadang message ID berbeda tetapi business action sama.

Contoh:

- same evidence file submitted twice.
- same external webhook delivered twice with different wrapper id.
- same approval command retried.

Gunakan business idempotency key:

```text
caseId + evidenceId
caseId + reviewAssignmentId
caseId + approvalRequestId
caseId + noticeId
```

Message envelope harus membawa `idempotencyKey`.

---

## 15. Workflow Race Conditions

Messaging membuat race condition lebih eksplisit.

### 15.1 Late Event

```text
Case closed.
Late RuleEvaluationCompleted arrives.
```

Handler tidak boleh blindly reopen case.

Solusi:

- validate current state.
- no-op if event obsolete.
- record ignored transition if audit-worthy.
- maybe send anomaly event.

### 15.2 Out-of-Order Events

```text
HumanReviewCompleted arrives before HumanReviewAssigned due to retry/replay.
```

Solusi:

- state machine guard.
- sequence number/version.
- pending event buffer only if justified.
- reject to DLQ/parking lot if impossible.

### 15.3 Concurrent Commands

```text
Reviewer A approves.
Reviewer B rejects.
Both messages arrive close together.
```

Solusi:

- optimistic lock on workflow row.
- state transition atomicity.
- authority check.
- conflict event/audit.

### 15.4 Duplicate Escalation

```text
Timer fires twice.
Manual escalation also triggered.
```

Solusi:

- escalation level as state.
- unique constraint.
- idempotency key.
- expected state in command.

---

## 16. Workflow Topology Example: Enforcement Case

### 16.1 Exchanges

```text
enforcement.commands       topic
enforcement.events         topic
enforcement.jobs           topic
enforcement.notifications  topic
enforcement.audit          topic/stream
```

### 16.2 Queues

```text
case-orchestrator.commands.q          quorum
case-orchestrator.events.q            quorum
rule-engine.evaluate.q                quorum
review-service.assignment.q           quorum
document-service.generate-notice.q    quorum
notification-service.email.q          quorum
audit.case-events.stream              stream
case-orchestrator.dlq                 quorum
rule-engine.dlq                       quorum
parking-lot.workflow.q                quorum
```

### 16.3 Bindings

```text
# commands
enforcement.commands -> rule-engine.evaluate.q
  routing key: rule.evaluate.case

enforcement.commands -> review-service.assignment.q
  routing key: review.assign

enforcement.commands -> document-service.generate-notice.q
  routing key: document.notice.generate

enforcement.commands -> case-orchestrator.commands.q
  routing key: case.escalate

# events
enforcement.events -> case-orchestrator.events.q
  routing key: case.*.*
  routing key: rule.evaluation.completed
  routing key: review.*.*
  routing key: approval.*.*

enforcement.events -> audit.case-events.stream
  routing key: #

enforcement.events -> notification-service.email.q
  routing key: review.assigned
  routing key: case.action.issued
  routing key: case.deadline.approaching
```

### 16.4 Flow

```text
1. CaseOpened event published.
2. Case orchestrator receives CaseOpened.
3. Orchestrator creates workflow instance.
4. Orchestrator writes outbox command EvaluateRulesForCase.
5. Outbox relay publishes command to enforcement.commands.
6. Rule engine consumes command.
7. Rule engine evaluates and publishes RuleEvaluationCompleted.
8. Orchestrator consumes RuleEvaluationCompleted.
9. Orchestrator transitions to HUMAN_REVIEW_REQUIRED.
10. Orchestrator publishes AssignHumanReview command.
11. Review service assigns reviewer.
12. Review service publishes HumanReviewAssigned.
13. Notification service sends reviewer notification.
14. Scheduler tracks review deadline.
15. Deadline reached if no review completed.
16. Scheduler publishes EscalateOverdueCase.
17. Orchestrator validates and transitions to ESCALATED.
```

---

## 17. Event Choreography for Side Effects

Not every side effect should be orchestrated.

For example:

```text
HumanReviewAssigned event
```

Consumers:

- notification service sends email.
- audit service records event.
- dashboard projector updates read model.
- workload analytics updates SLA report.

The orchestrator does not need to coordinate all of these unless they affect core lifecycle.

Rule:

> If side effect affects core state, orchestrate or validate it. If side effect is observational/notification/projection, choreography is usually enough.

---

## 18. Auditability

For regulatory systems, auditability is not logging.

Logging says:

```text
Consumer processed message 123.
```

Audit says:

```text
Case C1 moved from HUMAN_REVIEW_ASSIGNED to ESCALATED because review deadline was exceeded under rule version R2026.04, triggered by timer T987, caused by assignment event E456, processed by workflow engine version 2.3.1 at 2026-07-01T17:05:02+07:00.
```

Message fields that help:

```text
messageId
correlationId
causationId
messageType
schemaVersion
producer
producerVersion
occurredAt
publishedAt
actorId
actorType
tenantId
caseId
reasonCode
policyVersion
ruleVersion
idempotencyKey
```

### 18.1 Audit Stream Pattern

Publish all important domain events to a stream:

```text
enforcement.audit.case-events.stream
```

Why stream?

- retention-based history.
- replayable.
- useful for audit rebuild/projection.
- consumption is non-destructive.

But do not assume stream alone is legal audit store. Depending on requirements, you may need immutable storage, WORM storage, signatures, retention policies, or database audit tables.

---

## 19. RabbitMQ Streams in Workflow Context

RabbitMQ Streams are useful for:

- audit event history.
- replaying projections.
- rebuilding read models.
- forensic analysis.
- integration feed.
- long-lived event subscription.

Traditional queues are better for:

- commands.
- task distribution.
- worker jobs.
- human assignment handoff.
- retry/DLQ processing.

Hybrid:

```text
Core lifecycle command -> quorum queue
Domain event -> topic exchange
Audit copy -> stream
Projection subscriber -> stream or queue depending replay need
```

Example:

```text
CaseStateChanged event
  -> case-orchestrator.events.q       for immediate coordination
  -> audit.case-events.stream         for replay/history
  -> dashboard.projector.q            for live update
```

---

## 20. Human Tasks

Human tasks are not just messages.

A human task needs persistent state:

```text
review_task
  - task_id
  - case_id
  - assigned_to
  - assigned_group
  - status
  - priority
  - due_at
  - created_at
  - completed_at
  - outcome
```

RabbitMQ can notify task creation:

```text
HumanReviewAssigned
```

But RabbitMQ should not be the only place where task existence is stored.

Why?

- human tasks can live for days/weeks.
- users need dashboards.
- reassignment is common.
- task status changes independently.
- audit matters.
- queues are not queryable business state stores.

Correct model:

```text
Review Service persists task.
Review Service publishes HumanReviewAssigned event.
Notification Service sends notification.
Dashboard reads task DB/read model.
```

---

## 21. Deadline Management

Deadline should be domain data, not just message TTL.

Message TTL answers:

```text
How long may this message wait in a queue?
```

Business deadline answers:

```text
When must this case move/escalate according to policy?
```

Do not confuse them.

Example:

```text
review due in 5 business days
```

This depends on:

- timezone.
- business calendar.
- holidays.
- policy version.
- extensions.
- suspension periods.

A queue TTL cannot encode that safely.

Use workflow state + scheduler.

---

## 22. Outbox in Workflow

A workflow transition often produces outgoing messages.

Do not publish directly inside transaction and hope everything works.

Use outbox:

```text
DB transaction:
  - update workflow state
  - insert transition audit
  - insert outgoing command/event into outbox
commit

Outbox relay:
  - read pending outbox rows
  - publish to RabbitMQ with confirms
  - mark published
```

### 22.1 Outbox Row

```sql
CREATE TABLE message_outbox (
    outbox_id          UUID PRIMARY KEY,
    aggregate_id       UUID NOT NULL,
    message_type       VARCHAR(200) NOT NULL,
    exchange_name      VARCHAR(200) NOT NULL,
    routing_key        VARCHAR(200) NOT NULL,
    payload_json       TEXT NOT NULL,
    headers_json       TEXT NOT NULL,
    status             VARCHAR(50) NOT NULL,
    created_at         TIMESTAMP NOT NULL,
    published_at       TIMESTAMP,
    publish_attempts   INT NOT NULL DEFAULT 0,
    last_error         TEXT
);
```

### 22.2 Why Outbox Matters

Without outbox:

```text
DB commit succeeds, publish fails -> state changed but nobody knows.
```

or:

```text
publish succeeds, DB commit fails -> consumers see event for nonexistent state.
```

Outbox makes state transition and message intent atomic at DB boundary.

---

## 23. Inbox in Workflow

Inbox/idempotency table stores incoming message processing.

It protects against:

- duplicate delivery.
- replay.
- retry after crash.
- manual requeue.
- publisher duplicate.

Inbox can include:

```text
consumer_name
message_id
business_key
status
processed_at
failure_reason
```

Pattern:

```text
1. receive message
2. within DB transaction, insert inbox row
3. if duplicate key, ack and exit
4. apply transition
5. insert outbox messages
6. commit
7. ack
```

---

## 24. Versioning Workflow

Workflow changes over time.

Examples:

- new approval step added.
- escalation deadline changed.
- new review role introduced.
- compensation path modified.
- policy version changed.

Do not assume one global workflow definition forever.

Store:

```text
workflow_version
policy_version
rule_version
```

Message should carry version context:

```json
{
  "messageType": "CaseStateChanged",
  "schemaVersion": 2,
  "payload": {
    "caseId": "case-123",
    "fromState": "HUMAN_REVIEW_ASSIGNED",
    "toState": "ESCALATED",
    "workflowVersion": 4,
    "policyVersion": "2026.04",
    "reasonCode": "REVIEW_DEADLINE_EXCEEDED"
  }
}
```

For long-running cases, old workflow instances may need to continue under old rules.

Avoid silent behavior change.

---

## 25. Workflow Error Taxonomy

Do not handle all errors the same.

### 25.1 Duplicate Message

Action:

- ack.
- no retry.
- maybe log at debug/info.

### 25.2 Obsolete Message

Example:

```text
ReviewCompleted for already closed case.
```

Action:

- if valid late event: ack and audit ignored.
- if suspicious: ack + anomaly event.
- if impossible/corrupt: DLQ/parking lot.

### 25.3 Invalid Transition

Example:

```text
ApproveAction while case state = EVIDENCE_COLLECTION.
```

Action depends:

- command from untrusted source: reject/parking lot.
- event out of order: maybe delay/buffer.
- bug: DLQ and alert.

### 25.4 Retryable Technical Error

Action:

- nack to retry path.
- bounded retries.
- DLQ after max.

### 25.5 Permanent Business Rejection

Example:

```text
Cannot generate notice because legal basis missing.
```

Action:

- transition workflow to BLOCKED or REQUIRES_REMEDIATION.
- publish `WorkflowBlocked`.
- do not infinite retry.

### 25.6 Unknown Error

Action:

- bounded technical retry.
- DLQ.
- alert.
- preserve message.

---

## 26. Parking Lot for Workflow

DLQ is technical quarantine.

Parking lot is operational/business remediation space.

A parking lot message should include enough context:

```json
{
  "messageId": "...",
  "originalMessageId": "...",
  "failureCategory": "INVALID_TRANSITION",
  "caseId": "case-123",
  "currentState": "CLOSED",
  "attemptedTransition": "HUMAN_REVIEW_COMPLETED",
  "reason": "Event arrived after closure",
  "operatorActionRequired": true,
  "recommendedAction": "inspect_case_history"
}
```

Parking lot should have:

- dashboard.
- owner.
- SLA.
- replay tool.
- discard policy.
- audit record.

A DLQ without ownership is a graveyard.

---

## 27. State Transition Implementation Model

Domain state machine should be explicit.

Example simplified Java model:

```java
public enum CaseState {
    OPENED,
    EVIDENCE_COLLECTION,
    RULE_EVALUATION,
    HUMAN_REVIEW_REQUIRED,
    HUMAN_REVIEW_ASSIGNED,
    ESCALATED,
    ACTION_PROPOSED,
    APPROVAL_PENDING,
    ACTION_ISSUED,
    CLOSED,
    BLOCKED
}
```

Transition method:

```java
public final class CaseWorkflow {
    private UUID caseId;
    private CaseState state;
    private int version;
    private Instant deadlineAt;
    private int escalationLevel;

    public TransitionResult apply(RuleEvaluationCompleted event) {
        if (state != CaseState.RULE_EVALUATION) {
            return TransitionResult.ignored("obsolete_or_invalid_state");
        }

        if (event.hasPotentialViolation()) {
            CaseState previous = state;
            state = CaseState.HUMAN_REVIEW_REQUIRED;
            return TransitionResult.transitioned(
                previous,
                state,
                List.of(Command.assignHumanReview(caseId))
            );
        }

        CaseState previous = state;
        state = CaseState.CLOSED;
        return TransitionResult.transitioned(
            previous,
            state,
            List.of(Event.caseClosed(caseId, "NO_VIOLATION_FOUND"))
        );
    }
}
```

Key idea:

- domain object decides valid transition.
- application service persists.
- outbox publishes.
- RabbitMQ delivers.

---

## 28. Orchestrator Consumer Pattern

```java
@Component
public class CaseWorkflowEventConsumer {

    private final WorkflowApplicationService workflowService;

    @RabbitListener(
        queues = "case-orchestrator.events.q",
        containerFactory = "manualAckListenerContainerFactory"
    )
    public void onMessage(
        Message rawMessage,
        Channel channel,
        @Header(AmqpHeaders.DELIVERY_TAG) long tag
    ) throws IOException {
        try {
            MessageEnvelope<?> envelope = decode(rawMessage);
            workflowService.handle(envelope);
            channel.basicAck(tag, false);
        } catch (DuplicateMessageException e) {
            channel.basicAck(tag, false);
        } catch (RetryableInfrastructureException e) {
            channel.basicNack(tag, false, false);
        } catch (PermanentWorkflowException e) {
            channel.basicNack(tag, false, false);
        } catch (Exception e) {
            channel.basicNack(tag, false, false);
        }
    }
}
```

Application service:

```java
@Service
public class WorkflowApplicationService {

    @Transactional
    public void handle(MessageEnvelope<?> envelope) {
        inbox.insertOrThrowDuplicate("case-orchestrator", envelope.messageId());

        switch (envelope.messageType()) {
            case "CaseOpened" -> handleCaseOpened(envelope.cast(CaseOpened.class));
            case "RuleEvaluationCompleted" -> handleRuleEvaluationCompleted(envelope.cast(RuleEvaluationCompleted.class));
            case "HumanReviewCompleted" -> handleHumanReviewCompleted(envelope.cast(HumanReviewCompleted.class));
            case "ApprovalCompleted" -> handleApprovalCompleted(envelope.cast(ApprovalCompleted.class));
            default -> throw new PermanentWorkflowException("unknown_message_type");
        }
    }
}
```

Avoid putting business state transition directly inside listener method.

Listener is transport boundary, not domain brain.

---

## 29. Correlation and Causation Across Workflow

Every message in workflow should support traceability.

Example flow:

```text
Message A: CaseOpened
  messageId = A
  correlationId = C
  causationId = null

Message B: EvaluateRulesForCase
  messageId = B
  correlationId = C
  causationId = A

Message C: RuleEvaluationCompleted
  messageId = C
  correlationId = C
  causationId = B

Message D: AssignHumanReview
  messageId = D
  correlationId = C
  causationId = C
```

This forms a causal chain:

```text
A -> B -> C -> D
```

This is essential for:

- debugging.
- audit.
- distributed tracing.
- incident reconstruction.
- regulatory explanation.

---

## 30. Permissions and Ownership

Workflow topology should reflect ownership.

Example:

```text
case-orchestrator
  can read: case-orchestrator.events.q, case-orchestrator.commands.q
  can write: enforcement.commands, enforcement.events
  can configure: its own queues only if app-declared topology allowed

rule-engine
  can read: rule-engine.evaluate.q
  can write: enforcement.events
  cannot write: case-orchestrator internal queues directly

notification-service
  can read: notification-service.email.q
  can write: notification.events maybe
  cannot publish core case state events
```

This prevents accidental state mutation by unauthorized services.

---

## 31. Observability for Workflow

Metrics you need beyond generic RabbitMQ metrics:

### 31.1 Broker Metrics

- queue depth per workflow queue.
- unacked messages.
- redelivery rate.
- DLQ rate.
- publish rate.
- ack rate.
- consumer utilization.

### 31.2 Workflow Metrics

- workflow instances by state.
- average time in state.
- deadline breach count.
- escalation count.
- blocked workflow count.
- invalid transition count.
- duplicate message count.
- parking lot count.
- outbox pending count.
- outbox publish failure count.
- command completion latency.

### 31.3 Logs

Every handler log should include:

```text
messageId
correlationId
causationId
caseId
messageType
workflowState
transitionResult
```

Example structured log:

```json
{
  "event": "workflow_transition_applied",
  "caseId": "case-123",
  "messageId": "msg-456",
  "correlationId": "corr-789",
  "fromState": "RULE_EVALUATION",
  "toState": "HUMAN_REVIEW_REQUIRED",
  "reasonCode": "POTENTIAL_VIOLATION_FOUND"
}
```

---

## 32. Testing Workflow with RabbitMQ

Test levels:

### 32.1 Pure State Machine Tests

No RabbitMQ.

```text
Given state RULE_EVALUATION
When RuleEvaluationCompleted(hasPotentialViolation=true)
Then state HUMAN_REVIEW_REQUIRED
And command AssignHumanReview emitted
```

### 32.2 Application Service Transaction Tests

Test:

- idempotency insert.
- state update.
- outbox insert.
- duplicate handling.
- invalid transition.

### 32.3 RabbitMQ Integration Tests

Using Testcontainers:

- publish event to exchange.
- verify consumer processes.
- verify state updated.
- verify ack behavior indirectly.
- verify DLQ for permanent failure.
- verify retry path.

### 32.4 Failure Tests

Test:

- duplicate event.
- out-of-order event.
- late event.
- consumer crash after DB commit before ack.
- outbox relay duplicate publish.
- DLQ replay.
- timer fires after state changed.

### 32.5 Audit Tests

Test:

- transition log created.
- reason code captured.
- policy version captured.
- causation chain preserved.

---

## 33. Design Smells

### Smell 1: Queue as Workflow State

If someone asks “which cases are pending review?” and the answer is “inspect queue depth”, design is wrong.

Queue is transport. Workflow DB/read model is state.

### Smell 2: Everything Is an Event

If `GenerateNotice` is named `NoticeGenerationRequestedEvent`, your model may be hiding commands as events.

Commands request action. Events record facts.

### Smell 3: Infinite Technical Retry for Business Failure

If missing legal basis causes 1000 retries, the system is confusing business invalidity with infrastructure failure.

### Smell 4: Orchestrator Without Persistent State

An orchestrator that only listens and publishes without storing process state is usually choreography with extra coupling.

### Smell 5: No Causation ID

Without causation ID, audit graph becomes guesswork.

### Smell 6: Timers Implemented Only with TTL

TTL is not a business calendar.

### Smell 7: Human Tasks Only in Queue

Humans need persistent task state, query, reassignment, SLA, and audit.

### Smell 8: DLQ Without Owner

A DLQ nobody watches is silent data loss with extra steps.

### Smell 9: Workflow Transition in Listener Method

Transport code should not become domain state machine.

### Smell 10: No Versioning

Long-running workflows break when code changes silently alter process meaning.

---

## 34. Architecture Decision Matrix

| Requirement | Better Pattern |
|---|---|
| one service asks another to do work | command queue |
| many services need to know fact happened | event topic exchange |
| stateful long-running lifecycle | orchestrator + DB state |
| simple independent reactions | choreography |
| audit/replay | stream + audit store |
| human approval | persisted task + event notification |
| deadline/escalation | DB timer + command |
| transient external failure | technical retry + DLQ |
| business invalidity | state transition to blocked/remediation |
| compensation | explicit compensating command/event |
| query pending cases | database/read model |
| observe stuck processing | workflow metrics + queue metrics |

---

## 35. End-to-End Example

### 35.1 Scenario

A case is opened after a suspicious transaction is detected.

Business rules:

1. Every case must be evaluated by rule engine.
2. If risk score >= 80, assign human review.
3. Human review must be completed within 3 business days.
4. If overdue, escalate to supervisor.
5. If reviewer proposes action, approval is required.
6. If approval succeeds, enforcement notice is generated.
7. Every state transition must be auditable.

### 35.2 Messages

```text
CaseOpened
EvaluateRulesForCase
RuleEvaluationCompleted
AssignHumanReview
HumanReviewAssigned
EscalateOverdueCase
HumanReviewCompleted
RequestApproval
ApprovalCompleted
GenerateEnforcementNotice
NoticeGenerated
IssueEnforcementAction
ActionIssued
CaseStateChanged
```

### 35.3 Flow with State

```text
CaseOpened
  -> state: OPENED
  -> command: EvaluateRulesForCase

RuleEvaluationCompleted(risk=91)
  -> state: HUMAN_REVIEW_REQUIRED
  -> command: AssignHumanReview

HumanReviewAssigned
  -> state: HUMAN_REVIEW_ASSIGNED
  -> deadline: +3 business days
  -> event: CaseStateChanged

EscalateOverdueCase
  -> if still HUMAN_REVIEW_ASSIGNED and deadline passed
  -> state: ESCALATED
  -> event: EscalationTriggered

HumanReviewCompleted(proposeAction=true)
  -> state: ACTION_PROPOSED
  -> command: RequestApproval

ApprovalCompleted(approved=true)
  -> state: APPROVAL_APPROVED
  -> command: GenerateEnforcementNotice

NoticeGenerated
  -> state: NOTICE_READY
  -> command: IssueEnforcementAction

ActionIssued
  -> state: ACTION_ISSUED
  -> event: CaseStateChanged
```

### 35.4 RabbitMQ Role

RabbitMQ handles:

- command delivery.
- event fanout.
- retry/DLQ.
- work distribution.
- notification triggering.
- audit stream feed.

Database handles:

- workflow state.
- transition log.
- idempotency.
- timers.
- tasks.
- outbox.

---

## 36. Practical Implementation Blueprint

A production-grade Java/Spring service for workflow should have packages like:

```text
com.company.enforcement.workflow
  application
    WorkflowApplicationService.java
    WorkflowCommandHandler.java
    WorkflowEventHandler.java
  domain
    CaseWorkflow.java
    CaseState.java
    TransitionResult.java
    WorkflowCommand.java
    WorkflowEvent.java
  messaging
    RabbitWorkflowConsumer.java
    RabbitWorkflowPublisher.java
    MessageEnvelope.java
    MessageDecoder.java
  persistence
    WorkflowRepository.java
    InboxRepository.java
    OutboxRepository.java
    TransitionLogRepository.java
    TimerRepository.java
  scheduler
    WorkflowTimerScheduler.java
  observability
    WorkflowMetrics.java
```

Boundary rule:

```text
messaging package knows RabbitMQ.
application package knows transaction boundary.
domain package knows workflow rules.
persistence package knows DB.
```

Do not let RabbitMQ-specific classes leak into domain model.

---

## 37. Review Checklist

Use this checklist before approving RabbitMQ workflow design.

### 37.1 Semantic Checklist

- Are messages classified as command/event/job/notification?
- Are commands imperative and targeted?
- Are events factual and past-tense?
- Is workflow state stored outside RabbitMQ?
- Are human tasks persisted?
- Are deadlines stored as domain data?
- Is compensation explicit?

### 37.2 Reliability Checklist

- Are consumer handlers idempotent?
- Is ack after DB commit?
- Is outbox used for emitted messages?
- Are retries bounded?
- Is DLQ/parking lot owned?
- Are invalid transitions handled deliberately?
- Are duplicate/late/out-of-order messages tested?

### 37.3 Audit Checklist

- Is correlation ID preserved?
- Is causation ID preserved?
- Are reason codes captured?
- Are policy/rule versions captured?
- Are transitions logged?
- Can we reconstruct why a case moved state?
- Is audit stream/store retained properly?

### 37.4 Operations Checklist

- Are workflow metrics exposed?
- Are queue metrics monitored?
- Are outbox pending rows monitored?
- Are DLQ spikes alerted?
- Are parking lot messages visible to operators?
- Is replay tool safe?
- Are runbooks documented?

---

## 38. Mini Lab

### Lab 1 — Build Minimal Workflow

Create:

- `CaseOpened` event.
- orchestrator consumer.
- workflow DB table.
- outbox table.
- `EvaluateRulesForCase` command.

Verify:

- `CaseOpened` creates workflow row.
- outbox row is created.
- outbox relay publishes command.

### Lab 2 — Idempotency

Publish same `CaseOpened` twice.

Expected:

- one workflow row.
- one transition log.
- one outbox command.
- second message acked as duplicate.

### Lab 3 — Invalid Transition

Publish `HumanReviewCompleted` before `HumanReviewAssigned`.

Expected:

- no invalid state mutation.
- message goes to DLQ/parking lot or is recorded as invalid depending policy.

### Lab 4 — Deadline Escalation

Insert workflow with past deadline.

Scheduler publishes `EscalateOverdueCase`.

Expected:

- orchestrator validates current state.
- state becomes `ESCALATED` only if still overdue.
- event `EscalationTriggered` emitted.

### Lab 5 — Outbox Failure

Simulate broker down after DB commit.

Expected:

- workflow state remains committed.
- outbox row remains pending.
- relay publishes when broker returns.

---

## 39. Top 1% Mental Models

### 39.1 RabbitMQ Carries Intent and Facts, Not Business Truth

Business truth lives in domain state and database.

### 39.2 Workflow Is a State Machine First, Messaging Topology Second

If state transitions are unclear, RabbitMQ will amplify confusion.

### 39.3 Events Are Not Commands

A command says “do this”.  
An event says “this happened”.

### 39.4 Retry Is Not Recovery Unless State Is Safe

Retrying unsafe handlers creates duplicate effects.

### 39.5 Audit Requires Causality

Correlation ID groups messages.  
Causation ID explains why one message exists.

### 39.6 Timers Are Domain Objects

Message TTL is not policy deadline.

### 39.7 DLQ Is Not a Strategy

DLQ is a mechanism. Ownership, triage, replay, and remediation make it a strategy.

### 39.8 Orchestration and Choreography Are Tools, Not Religions

Use orchestration for core lifecycle.  
Use choreography for independent side effects.

---

## 40. Summary

In this part, we connected RabbitMQ to real workflow architecture.

Key conclusions:

1. RabbitMQ is not a full workflow engine, but it is excellent as a durable routing and work distribution backbone.
2. Workflow state must live in an application/database state machine.
3. Commands, events, jobs, and notifications must be modelled differently.
4. Choreography is good for independent reactions; orchestration is better for complex regulated lifecycles.
5. Long-running processes need persistent workflow instance state, transition logs, timers, idempotency, and outbox/inbox.
6. Technical retry and business retry must not be confused.
7. Human tasks are persisted business entities, not just queued messages.
8. Deadline escalation should validate current state at execution time.
9. Compensation is an explicit business action, not automatic rollback.
10. Auditability requires correlation, causation, reason codes, policy versions, and transition history.

If you internalize only one thing:

> RabbitMQ moves the workflow signals; your domain model owns the workflow truth.

---

## 41. What Comes Next

Next part:

```text
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-16.md
```

Topic:

```text
RabbitMQ Streams Mental Model
```

We will shift from queue-oriented work delivery into stream-oriented append-only log thinking:

- stream vs queue.
- offset vs ack.
- retention vs deletion.
- replay.
- stream protocol.
- RabbitMQ Streams vs Kafka.
- when to use streams in RabbitMQ architecture.
- when not to.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-14.md">⬅️ Part 14 — RPC, Request/Reply, Correlation, Timeout, and Why It Is Dangerous</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-16.md">Part 16 — RabbitMQ Streams Mental Model ➡️</a>
</div>
