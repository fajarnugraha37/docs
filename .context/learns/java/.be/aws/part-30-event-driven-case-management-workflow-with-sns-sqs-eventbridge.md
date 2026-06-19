# Part 30 — Event-Driven Case Management Workflow with SNS/SQS/EventBridge

Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
File: `part-30-event-driven-case-management-workflow-with-sns-sqs-eventbridge.md`  
Scope: Java 8–25, AWS SDK for Java 2.x, SNS, SQS, EventBridge, Lambda/container workers, audit-grade workflow design  
Status: Advanced case-study chapter

---

## 1. Why This Part Exists

So far, we have studied AWS services as individual building blocks:

- S3 as object storage and integration boundary.
- SQS as reliability buffer.
- SNS as pub/sub fan-out.
- EventBridge as routing, schedule, archive, replay, and integration bus.
- Lambda as event processor.
- IAM, KMS, observability, cost, quota, secret/config, and production hardening.

This part combines them into a realistic enterprise workflow: **event-driven case management**.

The domain is intentionally close to regulatory systems, enforcement lifecycle systems, licensing systems, compliance platforms, and complex government/enterprise case processing systems.

A case management platform is not just CRUD.

It usually contains:

- state transitions,
- assignment,
- escalation,
- screening,
- document verification,
- officer review,
- legal review,
- appeal,
- correspondence,
- audit trail,
- SLA monitoring,
- reporting,
- retry/recovery,
- access control,
- evidence preservation,
- traceability.

In this kind of system, event-driven design is powerful, but also dangerous if done casually.

A weak event-driven system becomes:

- hard to debug,
- hard to replay,
- hard to audit,
- prone to duplicate side effects,
- inconsistent under retries,
- unclear about ownership,
- fragile during partial failure,
- expensive to operate,
- impossible to defend during audit.

A strong event-driven system makes business workflow more resilient:

- producers and consumers are decoupled,
- slow subsystems do not block the main transaction,
- side effects become isolated,
- retry is explicit,
- replay is possible,
- evidence is preserved,
- state transition is controlled,
- operational incidents can be reconstructed.

The goal of this part is to build the mental model and reference architecture for a **production-grade event-driven case management workflow using Java + SNS + SQS + EventBridge**.

---

## 2. Core Mental Model

In a case management system, not every action should become an event, and not every event should change state.

The first rule:

> A domain event is a fact that already happened, not a request for something to happen.

Examples of domain events:

```text
CaseCreated
CaseSubmitted
ScreeningRequested
ScreeningCompleted
OfficerAssigned
DocumentVerificationRequested
DocumentVerified
CaseEscalated
ClarificationRequested
ClarificationReceived
CaseApproved
CaseRejected
AppealSubmitted
AppealAccepted
AppealRejected
CaseClosed
```

Examples of commands:

```text
CreateCase
SubmitCase
AssignOfficer
RequestScreening
VerifyDocument
ApproveCase
RejectCase
SendNotification
StartEscalationTimer
```

A command expresses intent.

An event records a fact.

This distinction matters because event-driven systems break down when events are used as vague remote procedure calls.

Bad event name:

```text
ProcessCase
```

Better command:

```text
StartCaseScreeningCommand
```

Better event:

```text
CaseScreeningRequested
```

Best design usually separates:

- synchronous command handling for authoritative state changes,
- domain event publication after state is committed,
- asynchronous subscribers for side effects,
- queues for reliability isolation,
- audit log for evidential traceability.

---

## 3. The Reference Scenario

We will model a simplified but realistic regulatory case workflow.

### 3.1 Business flow

```text
1. Applicant submits a case.
2. System validates basic data.
3. Case is created in DRAFT or SUBMITTED state.
4. Screening is requested.
5. Document verification is requested.
6. Officer assignment is triggered.
7. SLA timer is scheduled.
8. Screening result arrives.
9. Document verification result arrives.
10. Officer reviews the case.
11. Officer requests clarification, approves, rejects, or escalates.
12. Applicant may appeal.
13. Appeal workflow creates related case activity.
14. Final decision is issued.
15. Case is closed.
```

### 3.2 Important non-functional requirements

This workflow must be:

- resilient to retries,
- safe under duplicate messages,
- safe under out-of-order messages,
- observable,
- auditable,
- replayable,
- traceable across services,
- secure under least privilege,
- tolerant of slow downstream systems,
- explicit about ownership of state.

### 3.3 AWS services used

```text
Case API / Case Service
  -> transactional DB
  -> outbox table
  -> outbox publisher
  -> EventBridge custom event bus
  -> routing rules
  -> SNS topics for broad fan-out where needed
  -> SQS queues per consumer
  -> Lambda or Java worker consumers
  -> DLQ per queue or EventBridge target
  -> CloudWatch metrics/logs
  -> CloudTrail for control-plane audit
  -> S3 for large documents/evidence/archive
  -> DynamoDB or DB table for idempotency
```

EventBridge, SNS, and SQS overlap but are not the same. AWS describes SQS as pull-based queueing, SNS as pub/sub fan-out, and EventBridge as event routing with rule-based matching and integrations. In production design, they often work together rather than replacing each other.

Reference: https://docs.aws.amazon.com/decision-guides/latest/sns-or-sqs-or-eventbridge/sns-or-sqs-or-eventbridge.html

---

## 4. Service Responsibility Split

A strong workflow starts with clear ownership.

### 4.1 Case Service

Owns:

- case aggregate,
- case state machine,
- allowed transitions,
- optimistic locking,
- case audit trail,
- authoritative case status,
- outbox event creation.

Does not own:

- email delivery,
- SMS delivery,
- screening engine internals,
- document scanning internals,
- reporting projections,
- external system delivery retries.

### 4.2 Screening Service

Owns:

- screening request intake,
- screening execution,
- screening result,
- screening-specific retry,
- screening audit.

Consumes:

```text
CaseSubmitted
ScreeningRequested
```

Publishes:

```text
ScreeningCompleted
ScreeningFailed
ScreeningManualReviewRequired
```

### 4.3 Document Verification Service

Owns:

- document verification workflow,
- document metadata,
- document scanning result,
- evidence classification,
- document verification status.

Consumes:

```text
CaseSubmitted
DocumentUploaded
DocumentVerificationRequested
```

Publishes:

```text
DocumentVerified
DocumentRejected
DocumentVerificationFailed
```

### 4.4 Assignment Service

Owns:

- officer assignment rules,
- workload balancing,
- team routing,
- reassignment rules.

Consumes:

```text
CaseSubmitted
CaseEscalated
AppealSubmitted
```

Publishes:

```text
OfficerAssigned
OfficerAssignmentFailed
```

### 4.5 Notification Service

Owns:

- email/SMS/in-app notification dispatch,
- notification templates,
- notification retry,
- notification delivery state.

Consumes many events, but should rarely publish authoritative domain state events.

Publishes mostly technical events:

```text
NotificationDispatched
NotificationFailed
```

### 4.6 SLA/Escalation Service

Owns:

- timer creation,
- timer cancellation,
- escalation trigger,
- SLA breach detection.

Consumes:

```text
CaseSubmitted
OfficerAssigned
ClarificationRequested
ClarificationReceived
CaseClosed
```

Publishes:

```text
EscalationDue
SlaBreached
```

### 4.7 Reporting/Projection Service

Owns:

- read models,
- dashboards,
- analytics projections,
- operational metrics views.

Consumes events.

Should not affect core case state.

---

## 5. Architecture Option A: EventBridge-Centric Routing

EventBridge custom event bus is useful when you want event routing based on event pattern, event source, event detail type, and metadata.

```text
+-------------------+
| Case Service      |
| DB + Outbox       |
+---------+---------+
          |
          | publish domain events
          v
+----------------------------+
| EventBridge Custom Bus     |
| aceas.case.bus             |
+---+-----------+------------+
    |           |            |
    | rule      | rule       | rule
    v           v            v
+-------+   +--------+   +---------+
| SQS   |   | SQS    |   | Lambda  |
|screen |   |notify  |   |audit    |
+---+---+   +---+----+   +----+----+
    |           |             |
    v           v             v
Java worker  Java worker    Audit writer
```

Use this when:

- you need content-based routing,
- you want archive/replay,
- you want event bus governance,
- you integrate AWS services or SaaS targets,
- you want cleaner producer/subscriber decoupling.

EventBridge archives allow events to be stored and replayed later to the same event bus, which is useful for recovery and validating new consumers.

Reference: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-archive.html

EventBridge schema registry can organize event schemas in logical groups and can help govern custom events.

Reference: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-schema-registry.html

---

## 6. Architecture Option B: SNS Topic + SQS Per Subscriber

SNS + SQS is excellent for high-throughput fan-out with consumer isolation.

```text
+-------------------+
| Case Service      |
| DB + Outbox       |
+---------+---------+
          |
          | publish CaseSubmitted
          v
+-------------------+
| SNS Topic         |
| case-events       |
+---+----------+----+
    |          |
    v          v
+-------+   +-------+
| SQS   |   | SQS   |
|screen |   |notify |
+---+---+   +---+---+
    |          |
    v          v
Worker     Worker
```

Use this when:

- the publisher broadcasts to many subscribers,
- each subscriber needs its own retry/DLQ behavior,
- high-throughput fan-out is required,
- routing/filtering needs are moderate,
- subscribers should poll at their own pace.

SNS-to-SQS fan-out is a common pattern because each consumer gets an independent queue and therefore independent backpressure boundary.

Reference: https://docs.aws.amazon.com/sns/latest/dg/sns-sqs-as-subscriber.html

---

## 7. Architecture Option C: Hybrid EventBridge + SNS + SQS

For a serious enterprise case platform, a hybrid is often better.

```text
+---------------------+
| Case Service        |
| DB + Outbox         |
+----------+----------+
           |
           v
+---------------------+
| EventBridge Bus     |
| domain-events       |
+-----+----------+----+
      |          |
      |          | route internal broad events
      |          v
      |    +-------------+
      |    | SNS Topic   |
      |    | case-events |
      |    +------+------+ 
      |           |
      |       +---+------------------+
      |       |                      |
      v       v                      v
+--------+ +---------+           +---------+
| SQS    | | SQS     |           | SQS     |
|audit   | |screening|           |notify   |
+---+----+ +----+----+           +----+----+
    |           |                     |
    v           v                     v
Audit      Screening worker       Notification worker
```

EventBridge handles governance, routing, archive/replay, integration.

SNS handles broad fan-out where many consumers need the same event.

SQS handles buffering, retry isolation, worker backpressure, and DLQ.

This is often the most practical pattern for complex workflow systems.

---

## 8. The Case Aggregate and State Machine

The event-driven workflow must not weaken the domain state machine.

A case state machine might look like this:

```text
DRAFT
  -> SUBMITTED
  -> UNDER_SCREENING
  -> UNDER_REVIEW
  -> CLARIFICATION_REQUIRED
  -> UNDER_REVIEW
  -> APPROVED
  -> REJECTED
  -> APPEALED
  -> APPEAL_UNDER_REVIEW
  -> APPEAL_APPROVED
  -> APPEAL_REJECTED
  -> CLOSED
```

But production systems usually need more than one state.

### 8.1 Avoid a single overloaded status

Bad:

```text
case.status = UNDER_REVIEW
```

This hides too much.

Better:

```text
case.lifecycleStatus = UNDER_REVIEW
case.screeningStatus = COMPLETED
case.documentStatus = PENDING_VERIFICATION
case.assignmentStatus = ASSIGNED
case.slaStatus = ACTIVE
case.appealStatus = NONE
```

Why?

Because different asynchronous processes finish independently.

If you collapse all process dimensions into one `status`, you create impossible transitions and fragile logic.

### 8.2 State ownership rule

Only the Case Service may update authoritative case lifecycle state.

Other services publish facts:

```text
ScreeningCompleted
DocumentVerified
OfficerAssigned
SlaBreached
```

The Case Service consumes those facts and decides whether the case state changes.

This prevents external services from accidentally corrupting the case aggregate.

---

## 9. Event Taxonomy

A mature workflow uses explicit event categories.

### 9.1 Domain events

Facts about domain state.

```text
CaseSubmitted
CaseApproved
CaseRejected
AppealSubmitted
OfficerAssigned
```

### 9.2 Integration events

Facts meant for other bounded contexts.

```text
CaseSubmittedForScreening
CaseDecisionIssued
DocumentVerificationRequested
```

### 9.3 Technical events

Facts about infrastructure or delivery.

```text
NotificationDeliveryFailed
CaseEventProjectionFailed
OutboxPublishFailed
```

### 9.4 Audit events

Immutable evidence records.

```text
AuditCaseTransitionRecorded
AuditOfficerActionRecorded
AuditExternalSystemResponseRecorded
```

### 9.5 Timer events

Facts emitted by schedule/timer infrastructure.

```text
ReviewDue
ClarificationDue
EscalationDue
AppealWindowExpired
```

### 9.6 Anti-events

These names usually indicate design confusion:

```text
DoCaseProcessing
HandleCase
UpdateCase
ProcessWorkflow
SendEverything
CaseChanged
StatusChanged
```

Why bad?

They hide intent and make consumers inspect payloads too deeply.

An event name should already tell the consumer what happened.

---

## 10. Event Envelope Design

Every event should have a stable envelope.

Example:

```json
{
  "eventId": "01JZ7K7M5C5HQN3EN4BXTA9CZV",
  "eventType": "CaseSubmitted",
  "eventVersion": 1,
  "eventTime": "2026-06-19T10:15:30Z",
  "source": "case-service",
  "tenantId": "cea",
  "caseId": "CASE-2026-000123",
  "correlationId": "corr-9f9c0c9b",
  "causationId": "cmd-7ab2c2d1",
  "actor": {
    "actorType": "USER",
    "actorId": "officer-001"
  },
  "trace": {
    "requestId": "req-abc",
    "awsRequestId": "..."
  },
  "detail": {
    "submissionChannel": "PORTAL",
    "submittedAt": "2026-06-19T10:15:29Z"
  }
}
```

### 10.1 Required envelope fields

| Field | Purpose |
|---|---|
| `eventId` | Idempotency and traceability |
| `eventType` | Consumer routing and behavior |
| `eventVersion` | Schema evolution |
| `eventTime` | Business event time |
| `source` | Producer ownership |
| `tenantId` | Multi-tenant isolation if relevant |
| `caseId` | Aggregate identity |
| `correlationId` | Request/workflow trace |
| `causationId` | What caused this event |
| `actor` | Human/system actor |
| `detail` | Event-specific payload |

### 10.2 EventBridge mapping

EventBridge has its own event structure:

```json
{
  "Source": "aceas.case-service",
  "DetailType": "CaseSubmitted",
  "Detail": "{...json...}",
  "EventBusName": "aceas-domain-events"
}
```

Recommended mapping:

```text
EventBridge Source      = bounded context or service name
EventBridge DetailType  = event type
EventBridge Detail      = full domain event envelope
EventBridge EventBus    = environment/domain bus
```

Do not put all routing information only inside `Detail`. Use EventBridge top-level fields for coarse routing.

---

## 11. Transactional Outbox Is Non-Negotiable

The classic distributed bug:

```text
1. Update case DB to SUBMITTED.
2. Publish CaseSubmitted event.
```

What if step 1 succeeds and step 2 fails?

The case is submitted, but no downstream process starts.

Reverse order is also bad:

```text
1. Publish CaseSubmitted event.
2. Update case DB.
```

What if event is published but DB update fails?

Downstream systems process a case that does not exist or was not committed.

This is the dual-write problem.

The transactional outbox pattern solves it by writing the domain state and event record in the same database transaction. AWS Prescriptive Guidance describes this pattern as a way to resolve the dual-write issue when a service must persist data and notify other systems.

Reference: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html

### 11.1 Outbox table

```sql
CREATE TABLE case_outbox_event (
    id                  VARCHAR2(64) PRIMARY KEY,
    aggregate_type      VARCHAR2(100) NOT NULL,
    aggregate_id        VARCHAR2(100) NOT NULL,
    event_type          VARCHAR2(100) NOT NULL,
    event_version       NUMBER(10) NOT NULL,
    payload_json        CLOB NOT NULL,
    status              VARCHAR2(30) NOT NULL,
    retry_count         NUMBER(10) DEFAULT 0 NOT NULL,
    next_attempt_at     TIMESTAMP NULL,
    created_at          TIMESTAMP NOT NULL,
    published_at        TIMESTAMP NULL,
    last_error          CLOB NULL
);

CREATE INDEX idx_case_outbox_status_next_attempt
ON case_outbox_event(status, next_attempt_at);

CREATE INDEX idx_case_outbox_aggregate
ON case_outbox_event(aggregate_type, aggregate_id, created_at);
```

### 11.2 Transaction flow

```text
BEGIN TRANSACTION

1. Validate command.
2. Load case aggregate.
3. Check allowed state transition.
4. Update case state.
5. Insert audit record.
6. Insert outbox event.

COMMIT
```

Only after commit does a publisher process read the outbox and publish to EventBridge/SNS.

### 11.3 Java transaction pseudo-code

```java
public SubmitCaseResult submitCase(SubmitCaseCommand command) {
    return transactionTemplate.execute(status -> {
        CaseRecord record = caseRepository.findForUpdate(command.caseId())
            .orElseThrow(() -> new CaseNotFoundException(command.caseId()));

        CaseAggregate aggregate = CaseAggregate.from(record);
        DomainEvent event = aggregate.submit(command.actor(), command.submittedAt());

        caseRepository.save(aggregate.toRecord());
        auditRepository.insert(AuditRecord.from(event));
        outboxRepository.insert(OutboxEvent.from(event));

        return SubmitCaseResult.accepted(aggregate.caseId(), event.eventId());
    });
}
```

The key invariant:

> If the case state changed, the event record exists. If the transaction rolled back, neither state nor event exists.

---

## 12. Publishing Outbox Events to EventBridge

A Java publisher polls pending outbox records.

```text
OUTBOX_PENDING
  -> OUTBOX_PUBLISHING
  -> OUTBOX_PUBLISHED
  -> OUTBOX_FAILED_RETRYABLE
  -> OUTBOX_FAILED_TERMINAL
```

### 12.1 Publishing loop

```java
while (running.get()) {
    List<OutboxEventRecord> batch = outboxRepository.claimBatch(50, nodeId);

    if (batch.isEmpty()) {
        sleepBriefly();
        continue;
    }

    for (OutboxEventRecord record : batch) {
        try {
            PutEventsResponse response = eventBridgeClient.putEvents(requestFor(record));
            handlePutEventsResponse(record, response);
        } catch (SdkException ex) {
            outboxRepository.markRetryable(record.id(), ex.getMessage(), nextBackoff(record));
        }
    }
}
```

### 12.2 Important `PutEvents` behavior

`PutEvents` can partially fail. Never assume the whole batch succeeded just because the SDK call returned a response.

Design rule:

```text
For every entry in PutEventsResponse.entries(), map the result back to the outbox record.
```

A robust publisher tracks per-entry success/failure.

### 12.3 Outbox locking

Use one of these:

- `SELECT ... FOR UPDATE SKIP LOCKED` where supported,
- status claim with optimistic update,
- lease owner + lease expiry,
- distributed scheduler with partition ownership.

Avoid multiple publisher nodes publishing the same outbox row unless consumers are fully idempotent. Consumers should still be idempotent, but publishers should avoid unnecessary duplicate pressure.

---

## 13. Routing Design

### 13.1 EventBridge rules

Example rules:

```text
Rule: case-submitted-to-screening
Match:
  source = aceas.case-service
  detail-type = CaseSubmitted
Target:
  screening-request-queue

Rule: case-submitted-to-notification
Match:
  source = aceas.case-service
  detail-type = CaseSubmitted
Target:
  notification-queue

Rule: case-events-to-audit
Match:
  source prefix = aceas.
Target:
  audit-event-queue

Rule: escalation-events-to-case-service
Match:
  detail-type = EscalationDue
Target:
  case-command-queue
```

### 13.2 EventBridge DLQ

EventBridge can send failed target deliveries to DLQ so failed deliveries can be processed later.

Reference: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-dlq.html

Use EventBridge target DLQ for:

- target permission issue,
- target unavailable,
- malformed target input,
- delivery exhaustion.

Do not confuse EventBridge target DLQ with consumer DLQ.

### 13.3 Consumer SQS DLQ

SQS DLQ is for messages that reached the queue but could not be processed by the consumer after multiple receives.

Reference: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html

Use SQS DLQ for:

- poison message,
- consumer bug,
- dependency failure exceeding retry window,
- invalid domain condition requiring manual triage.

---

## 14. Queue-per-Consumer Rule

Do not make multiple independent consumers share one queue unless they are competing workers for the same responsibility.

Bad:

```text
case-events-queue
  -> screening worker
  -> notification worker
  -> reporting worker
```

This is wrong because only one consumer receives each message.

Good:

```text
screening-queue
notification-queue
reporting-queue
audit-queue
```

Each queue has its own:

- retry policy,
- visibility timeout,
- DLQ,
- scaling policy,
- IAM policy,
- operational dashboard,
- ownership team.

This is one of the most important production design rules.

---

## 15. Idempotency Model

Event-driven systems are at-least-once by default.

Therefore every consumer must assume:

```text
The same event may be delivered more than once.
The same command may be retried.
The same side effect may be attempted again.
```

### 15.1 Idempotency key

For event consumers:

```text
consumerName + eventId
```

For commands:

```text
commandId
```

For case state transitions:

```text
caseId + expectedPreviousVersion + transitionType
```

For external notification:

```text
caseId + notificationType + eventId
```

### 15.2 Idempotency table

```sql
CREATE TABLE consumer_idempotency (
    consumer_name       VARCHAR2(100) NOT NULL,
    idempotency_key     VARCHAR2(200) NOT NULL,
    event_id            VARCHAR2(100) NOT NULL,
    case_id             VARCHAR2(100),
    status              VARCHAR2(30) NOT NULL,
    first_seen_at       TIMESTAMP NOT NULL,
    completed_at        TIMESTAMP NULL,
    result_reference    VARCHAR2(200),
    error_summary       VARCHAR2(1000),
    PRIMARY KEY (consumer_name, idempotency_key)
);
```

### 15.3 Consumer algorithm

```text
1. Receive event.
2. Compute idempotency key.
3. Try insert PROCESSING row.
4. If duplicate completed row exists, ack message.
5. If duplicate processing row exists and not expired, skip or retry later.
6. Execute business effect.
7. Mark COMPLETED.
8. Delete SQS message.
```

### 15.4 Java pseudo-code

```java
public void handle(EventEnvelope event) {
    String key = consumerName + ":" + event.eventId();

    IdempotencyDecision decision = idempotencyStore.tryStart(
        consumerName,
        key,
        event.eventId(),
        event.caseId()
    );

    if (decision == IdempotencyDecision.ALREADY_COMPLETED) {
        return;
    }

    if (decision == IdempotencyDecision.ALREADY_PROCESSING) {
        throw new RetryLaterException("event is already being processed: " + event.eventId());
    }

    try {
        processBusinessEffect(event);
        idempotencyStore.markCompleted(consumerName, key, resultReference(event));
    } catch (Exception ex) {
        idempotencyStore.markFailed(consumerName, key, summarize(ex));
        throw ex;
    }
}
```

The idempotency store should be updated transactionally with local side effects where possible.

---

## 16. Out-of-Order Events

Distributed systems do not guarantee that events arrive in the order your business wants.

Example:

```text
CaseSubmitted event arrives after ScreeningCompleted event.
```

This can happen due to:

- retry delay,
- queue redrive,
- independent routes,
- parallel publishing,
- consumer lag,
- replay.

### 16.1 Design strategies

#### Strategy A: Version check

Every case event includes aggregate version.

```json
{
  "caseId": "CASE-001",
  "eventType": "CaseSubmitted",
  "aggregateVersion": 3
}
```

Consumer keeps last processed version per aggregate.

If event version is older than already processed version, consumer can ignore or treat as replay.

#### Strategy B: State precondition

Consumer checks actual case state before acting.

```text
Only request screening if case lifecycle status is SUBMITTED or UNDER_SCREENING.
```

#### Strategy C: Buffer and retry later

If prerequisite is missing:

```text
DocumentVerified received but CaseSubmitted not observed yet.
```

Consumer can retry later, especially if source of truth says case does not exist yet.

#### Strategy D: Make events commutative

Design handlers so applying events in different order converges to same result.

This is ideal but not always possible.

### 16.2 What not to do

Do not assume arrival order from different queues.

Do not assume EventBridge/SNS/SQS standard queue global ordering.

Do not let consumers blindly mutate central case state.

---

## 17. Standard Queue vs FIFO Queue in Case Workflow

### 17.1 Standard queue

Use standard queue when:

- throughput matters,
- duplicate delivery is acceptable,
- ordering is not strict,
- idempotency is implemented,
- events are independent or commutative.

Most event-driven enterprise workflows can use standard queues if the state machine is robust.

### 17.2 FIFO queue

Use FIFO queue when:

- order per aggregate is critical,
- message group can be case ID,
- throughput per message group is acceptable,
- deduplication window behavior is understood.

Example:

```text
MessageGroupId = caseId
MessageDeduplicationId = eventId
```

This gives per-case ordering, not global ordering.

### 17.3 Warning

FIFO can reduce concurrency if message groups are too coarse.

Bad:

```text
MessageGroupId = tenantId
```

This serializes too much work.

Better:

```text
MessageGroupId = caseId
```

But even with FIFO, consumers must still be idempotent because side effects may be retried.

---

## 18. Escalation and Timer Design

Case systems often need timers:

```text
If officer does not review within 3 working days, escalate.
If clarification is not answered within 14 days, close or remind.
If appeal window expires after 30 days, block appeal submission.
```

There are several ways to implement timers.

### 18.1 EventBridge Scheduler

Good for:

- one-off future invocation,
- scheduled reminders,
- distributed cron replacement,
- explicit target invocation.

Flow:

```text
CaseSubmitted
  -> SLA Service creates EventBridge Scheduler schedule
  -> schedule fires EscalationDue event/command
  -> Case Service checks current state
  -> if still overdue, escalates
  -> if already completed, ignore
```

Important invariant:

> Timer firing is not proof that escalation is valid. It is only a trigger to re-check the source of truth.

### 18.2 Scheduled scanner

A scheduled Java job scans DB for due cases.

Good for:

- large volumes,
- complex calendar rules,
- working-day calendars,
- regulatory SLA calculations,
- when timer cancellation per case is too costly.

### 18.3 Hybrid

Use EventBridge Scheduler for coarse trigger and DB query for precise due items.

Example:

```text
Every 5 minutes: query cases where nextSlaCheckAt <= now
```

This is often simpler and more auditable than creating millions of individual schedules.

---

## 19. Case Transition Safety

A case transition must be guarded.

### 19.1 Transition command

```java
public CaseTransitionResult transition(TransitionCaseCommand command) {
    return transactionTemplate.execute(tx -> {
        CaseAggregate aggregate = caseRepository.findForUpdate(command.caseId())
            .map(CaseAggregate::from)
            .orElseThrow(CaseNotFoundException::new);

        DomainEvent event = aggregate.apply(command);

        caseRepository.save(aggregate.toRecord());
        auditRepository.insert(AuditRecord.from(event));
        outboxRepository.insert(OutboxEvent.from(event));

        return CaseTransitionResult.success(event.eventId(), aggregate.version());
    });
}
```

### 19.2 Transition guard examples

```text
Cannot approve DRAFT case.
Cannot reject CLOSED case.
Cannot submit case with missing mandatory documents.
Cannot close case while appeal is active.
Cannot assign officer if case is not submitted.
Cannot apply stale ScreeningCompleted event if screening request version changed.
```

### 19.3 Optimistic locking

Use aggregate version.

```sql
UPDATE case_table
SET status = ?, version = version + 1
WHERE case_id = ?
  AND version = ?;
```

If zero rows updated, reload and re-evaluate.

This protects against concurrent events changing the same case.

---

## 20. Audit Trail Design

Audit trail is not the same as application log.

Application log helps engineers debug.

Audit trail helps the organization prove what happened.

### 20.1 Audit record requirements

An audit record should answer:

```text
Who did it?
What did they do?
When did it happen?
Which case/entity was affected?
What was the previous state?
What is the new state?
Why was it allowed?
Which request/event caused it?
Which system processed it?
What evidence supports it?
```

### 20.2 Audit table example

```sql
CREATE TABLE case_audit_trail (
    audit_id            VARCHAR2(64) PRIMARY KEY,
    case_id             VARCHAR2(100) NOT NULL,
    event_id            VARCHAR2(100) NOT NULL,
    event_type          VARCHAR2(100) NOT NULL,
    actor_type          VARCHAR2(50) NOT NULL,
    actor_id            VARCHAR2(100),
    previous_state      VARCHAR2(100),
    new_state           VARCHAR2(100),
    reason_code         VARCHAR2(100),
    correlation_id      VARCHAR2(100),
    causation_id        VARCHAR2(100),
    occurred_at         TIMESTAMP NOT NULL,
    recorded_at         TIMESTAMP NOT NULL,
    metadata_json       CLOB
);

CREATE INDEX idx_case_audit_case_time
ON case_audit_trail(case_id, occurred_at);
```

### 20.3 Audit event vs domain event

Domain event:

```text
CaseApproved
```

Audit record:

```text
Officer A approved Case X at time T from UNDER_REVIEW to APPROVED because all checks passed, caused by request R, under role Z.
```

Never rely only on async event consumers to build primary audit trail for authoritative state transitions.

The authoritative audit record should be committed in the same transaction as the state change.

---

## 21. Notification as Side Effect

Notification is important, but it should not decide core case state.

Flow:

```text
CaseApproved
  -> notification-queue
  -> Notification Service sends email/SMS/in-app
  -> NotificationDispatched or NotificationFailed
```

If notification fails, case approval should usually remain approved.

Exception:

- legal requirement says decision is not effective until served,
- acknowledgement is required,
- certified delivery is mandatory.

Then model that explicitly:

```text
CaseDecisionPrepared
DecisionServiceIssued
DecisionServiceFailed
CaseDecisionEffective
```

Do not hide legally significant delivery semantics inside a generic notification worker.

---

## 22. Appeal Workflow

Appeals are often related but distinct from original case lifecycle.

Bad model:

```text
case.status = APPEALED
```

This may lose the original decision state.

Better model:

```text
case.lifecycleStatus = REJECTED
case.appealStatus = SUBMITTED
appeal.id = APPEAL-2026-001
appeal.status = UNDER_REVIEW
```

Appeal may be a child aggregate.

Appeal events:

```text
AppealSubmitted
AppealValidated
AppealAssigned
AppealHearingScheduled
AppealDecisionIssued
AppealAccepted
AppealRejected
```

The original case may receive derived events:

```text
CaseAppealOpened
CaseAppealClosed
CaseDecisionOverturned
CaseDecisionUpheld
```

This separation makes reporting, audit, and state transition much cleaner.

---

## 23. Replay Strategy

Replay is not just “send messages again”.

Replay can be dangerous because consumers may repeat side effects.

EventBridge archive/replay can resend archived events to the same event bus. AWS documents this as useful for recovering from errors or validating new functionality.

Reference: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-archive.html

### 23.1 Replay scenarios

Good replay scenarios:

```text
A projection service was down and needs rebuilding.
A new reporting consumer needs historical events.
A bug in notification consumer was fixed and failed events need reprocessing.
A downstream system missed events due to permission issue.
```

Dangerous replay scenarios:

```text
Re-send all decision emails.
Re-create external payment.
Re-trigger legal notice.
Re-open already closed cases.
Duplicate officer assignment.
```

### 23.2 Replay-safe consumer classification

| Consumer | Replay-safe? | Notes |
|---|---:|---|
| Audit projection | Usually yes | If idempotent by event ID |
| Reporting projection | Yes | Rebuildable read model |
| Notification sender | Risky | Must suppress duplicate sends |
| External system adapter | Risky | Must have external idempotency key |
| Case state mutator | Very risky | Must check state and version |
| Search indexer | Usually yes | Upsert by aggregate ID/version |

### 23.3 Replay mode flag

Consider adding metadata during replay:

```json
{
  "replay": {
    "isReplay": true,
    "replayId": "replay-2026-06-19-001",
    "reason": "rebuild-reporting-projection"
  }
}
```

But do not rely only on this flag for safety. Idempotency and state guards are still required.

### 23.4 Canary replay

Before replaying large range:

```text
1. Replay 10 events.
2. Check metrics.
3. Replay 100 events.
4. Check DLQ and side effects.
5. Replay one day.
6. Replay full window.
```

---

## 24. DLQ Triage Model

A DLQ is not a trash can.

A DLQ is an operational queue requiring ownership.

### 24.1 DLQ message metadata

Store or enrich:

```text
eventId
caseId
eventType
consumerName
firstFailureAt
lastFailureAt
receiveCount
errorClass
errorMessage
stackFingerprint
correlationId
payloadHash
```

### 24.2 DLQ categories

| Category | Example | Action |
|---|---|---|
| Poison payload | Invalid schema | Fix producer or mapping |
| Missing dependency | Case not found yet | Retry later or investigate order |
| Permission failure | Access denied to S3/KMS | Fix IAM/KMS policy |
| Permanent domain rejection | Invalid state transition | Mark terminal and audit |
| Transient outage | Downstream unavailable | Redrive after recovery |
| Consumer bug | Null pointer, parsing bug | Fix code, deploy, redrive |

### 24.3 Redrive rules

Before redrive:

```text
1. Identify failure category.
2. Confirm fix.
3. Estimate volume.
4. Confirm idempotency.
5. Redrive small batch.
6. Monitor metrics.
7. Continue gradually.
```

Never bulk redrive unknown messages during an incident without understanding the failure mode.

---

## 25. Schema Evolution

Events live longer than code.

Once published, events may be:

- archived,
- replayed,
- consumed by unknown systems,
- used for audit,
- stored in reports,
- used by analytics.

### 25.1 Compatibility rules

Safe changes:

```text
Add optional field.
Add new event type.
Add enum value if consumers tolerate unknown.
Increase detail richness without changing meaning.
```

Dangerous changes:

```text
Rename field.
Change field type.
Change semantic meaning.
Remove field.
Change event type meaning.
Reuse old event type for new behavior.
```

### 25.2 Versioning strategy

Prefer:

```text
eventType = CaseSubmitted
eventVersion = 1, 2, 3
```

Avoid:

```text
CaseSubmittedV1
CaseSubmittedV2
CaseSubmittedV3
```

Except when the semantic change is large enough to deserve a new event type.

### 25.3 Consumer tolerance

Consumers should:

- ignore unknown fields,
- reject unknown required versions explicitly,
- log event version,
- expose unsupported event metric,
- avoid fragile JSON path assumptions.

---

## 26. Java Event Contract Model

### 26.1 Envelope record for Java 17+

```java
public record EventEnvelope<T>(
    String eventId,
    String eventType,
    int eventVersion,
    Instant eventTime,
    String source,
    String tenantId,
    String caseId,
    String correlationId,
    String causationId,
    Actor actor,
    T detail
) {}
```

### 26.2 Java 8 compatible class

```java
public final class EventEnvelope<T> {
    private final String eventId;
    private final String eventType;
    private final int eventVersion;
    private final Instant eventTime;
    private final String source;
    private final String tenantId;
    private final String caseId;
    private final String correlationId;
    private final String causationId;
    private final Actor actor;
    private final T detail;

    public EventEnvelope(
            String eventId,
            String eventType,
            int eventVersion,
            Instant eventTime,
            String source,
            String tenantId,
            String caseId,
            String correlationId,
            String causationId,
            Actor actor,
            T detail) {
        this.eventId = Objects.requireNonNull(eventId, "eventId");
        this.eventType = Objects.requireNonNull(eventType, "eventType");
        this.eventVersion = eventVersion;
        this.eventTime = Objects.requireNonNull(eventTime, "eventTime");
        this.source = Objects.requireNonNull(source, "source");
        this.tenantId = tenantId;
        this.caseId = Objects.requireNonNull(caseId, "caseId");
        this.correlationId = Objects.requireNonNull(correlationId, "correlationId");
        this.causationId = causationId;
        this.actor = actor;
        this.detail = Objects.requireNonNull(detail, "detail");
    }

    public String eventId() { return eventId; }
    public String eventType() { return eventType; }
    public int eventVersion() { return eventVersion; }
    public Instant eventTime() { return eventTime; }
    public String source() { return source; }
    public String tenantId() { return tenantId; }
    public String caseId() { return caseId; }
    public String correlationId() { return correlationId; }
    public String causationId() { return causationId; }
    public Actor actor() { return actor; }
    public T detail() { return detail; }
}
```

### 26.3 Event detail classes

```java
public record CaseSubmittedDetail(
    String submissionChannel,
    Instant submittedAt,
    List<String> documentIds,
    String applicantType
) {}
```

For Java 8, use final immutable classes.

---

## 27. Publishing to EventBridge with AWS SDK Java 2.x

```java
public final class EventBridgeDomainEventPublisher {
    private final EventBridgeClient client;
    private final ObjectMapper objectMapper;
    private final String eventBusName;

    public EventBridgeDomainEventPublisher(
            EventBridgeClient client,
            ObjectMapper objectMapper,
            String eventBusName) {
        this.client = Objects.requireNonNull(client, "client");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
        this.eventBusName = Objects.requireNonNull(eventBusName, "eventBusName");
    }

    public PublishResult publish(EventEnvelope<?> event) {
        try {
            String detail = objectMapper.writeValueAsString(event);

            PutEventsRequestEntry entry = PutEventsRequestEntry.builder()
                .eventBusName(eventBusName)
                .source(event.source())
                .detailType(event.eventType())
                .detail(detail)
                .time(event.eventTime())
                .build();

            PutEventsResponse response = client.putEvents(
                PutEventsRequest.builder()
                    .entries(entry)
                    .build()
            );

            PutEventsResultEntry result = response.entries().get(0);
            if (result.errorCode() != null) {
                return PublishResult.failed(result.errorCode(), result.errorMessage());
            }

            return PublishResult.published(result.eventId());
        } catch (JsonProcessingException ex) {
            return PublishResult.terminalFailure("SERIALIZATION_FAILED", ex.getMessage());
        } catch (EventBridgeException ex) {
            return PublishResult.retryableFailure(ex.awsErrorDetails().errorCode(), ex.getMessage());
        } catch (SdkClientException ex) {
            return PublishResult.retryableFailure("SDK_CLIENT_FAILURE", ex.getMessage());
        }
    }
}
```

Production version should:

- support batch publish,
- map response entries by index,
- classify retryable vs terminal failures,
- emit metrics,
- log AWS request ID,
- update outbox status per event,
- bound retry with exponential backoff.

---

## 28. Consuming from SQS in Java

```java
public final class CaseEventConsumer implements Runnable {
    private final SqsClient sqs;
    private final String queueUrl;
    private final EventDispatcher dispatcher;
    private final ObjectMapper objectMapper;

    public void run() {
        while (!Thread.currentThread().isInterrupted()) {
            ReceiveMessageResponse response = sqs.receiveMessage(ReceiveMessageRequest.builder()
                .queueUrl(queueUrl)
                .maxNumberOfMessages(10)
                .waitTimeSeconds(20)
                .visibilityTimeout(60)
                .messageAttributeNames("All")
                .build());

            for (Message message : response.messages()) {
                processOne(message);
            }
        }
    }

    private void processOne(Message message) {
        try {
            EventEnvelope<JsonNode> event = parse(message.body());
            dispatcher.dispatch(event);

            sqs.deleteMessage(DeleteMessageRequest.builder()
                .queueUrl(queueUrl)
                .receiptHandle(message.receiptHandle())
                .build());
        } catch (RetryableProcessingException ex) {
            // Do not delete. Message will become visible again.
            log.warn("retryable case event failure", ex);
        } catch (TerminalProcessingException ex) {
            // Either delete after writing terminal failure record,
            // or let it move to DLQ depending on policy.
            log.error("terminal case event failure", ex);
            throw ex;
        }
    }
}
```

Production version should include:

- bounded worker pool,
- backpressure,
- batch delete,
- visibility extension,
- idempotency,
- poison classification,
- graceful shutdown,
- metrics per event type,
- correlation ID in logging context.

---

## 29. Event Dispatcher Pattern

```java
public final class EventDispatcher {
    private final Map<String, EventHandler<?>> handlers;

    public void dispatch(EventEnvelope<JsonNode> rawEvent) {
        EventHandler<?> handler = handlers.get(rawEvent.eventType());
        if (handler == null) {
            throw new TerminalProcessingException("unsupported event type: " + rawEvent.eventType());
        }

        handler.handleRaw(rawEvent);
    }
}
```

Better production pattern:

```text
Event type + version -> typed handler
```

Example:

```text
CaseSubmitted:1 -> CaseSubmittedV1Handler
CaseSubmitted:2 -> CaseSubmittedV2Handler
```

This prevents accidental mis-parsing during schema evolution.

---

## 30. Workflow Example: Case Submitted

### 30.1 Command input

```text
SubmitCaseCommand(caseId, actor, submissionChannel, commandId)
```

### 30.2 Case Service transaction

```text
1. Validate case exists.
2. Validate current state is DRAFT.
3. Validate required documents exist.
4. Transition DRAFT -> SUBMITTED.
5. Insert audit record.
6. Insert CaseSubmitted outbox event.
7. Commit.
```

### 30.3 Outbox publisher

```text
1. Read pending CaseSubmitted.
2. Publish to EventBridge.
3. Mark published.
```

### 30.4 EventBridge routes

```text
CaseSubmitted -> screening queue
CaseSubmitted -> assignment queue
CaseSubmitted -> notification queue
CaseSubmitted -> SLA queue
CaseSubmitted -> audit projection queue
CaseSubmitted -> reporting projection queue
```

### 30.5 Screening consumer

```text
1. Idempotency check.
2. Create screening request.
3. Publish ScreeningRequested or ScreeningCompleted later.
4. Ack message.
```

### 30.6 Assignment consumer

```text
1. Idempotency check.
2. Calculate officer/team.
3. Call Case Service command AssignOfficer.
4. Case Service transitions assignment dimension.
5. Case Service emits OfficerAssigned.
```

### 30.7 Notification consumer

```text
1. Idempotency check.
2. Render template.
3. Send notification.
4. Store notification record.
5. Ack message.
```

### 30.8 SLA consumer

```text
1. Idempotency check.
2. Create due check schedule or update nextSlaCheckAt.
3. Ack message.
```

---

## 31. Workflow Example: Screening Completed

### 31.1 Screening publishes event

```json
{
  "eventType": "ScreeningCompleted",
  "eventVersion": 1,
  "caseId": "CASE-2026-000123",
  "detail": {
    "screeningRequestId": "SCR-001",
    "result": "CLEAR",
    "completedAt": "2026-06-19T11:00:00Z"
  }
}
```

### 31.2 Case Service consumes event

Case Service should not blindly change status.

It should:

```text
1. Idempotency check.
2. Load case.
3. Verify screening request matches active request.
4. Verify case is not closed/rejected.
5. Update screeningStatus.
6. If all prerequisites complete, transition to UNDER_REVIEW.
7. Insert audit.
8. Insert outbox events.
9. Commit.
```

### 31.3 Why this matters

A stale screening result may arrive after a re-screening request.

If you do not check request ID/version, old result may overwrite new state.

Invariant:

> An external result may update the case only if it corresponds to the currently active request/version.

---

## 32. Workflow Example: Escalation Due

Timer fires:

```text
EscalationDue(caseId, dueAt, escalationPolicyId)
```

Case Service handles:

```text
1. Idempotency check.
2. Load case.
3. Check case is still open.
4. Check SLA is still active.
5. Check dueAt <= now.
6. Check no officer action has satisfied requirement.
7. Transition escalation level.
8. Insert audit.
9. Publish CaseEscalated.
```

The timer is only a signal. The source of truth decides.

---

## 33. Workflow Example: Appeal Submitted

Applicant submits appeal.

Transaction:

```text
1. Validate original case allows appeal.
2. Validate appeal window.
3. Create appeal aggregate.
4. Update case appealStatus.
5. Insert audit.
6. Insert AppealSubmitted outbox event.
7. Commit.
```

Routes:

```text
AppealSubmitted -> assignment queue
AppealSubmitted -> notification queue
AppealSubmitted -> SLA queue
AppealSubmitted -> audit projection
AppealSubmitted -> reporting projection
```

Important:

Appeal workflow should not erase original decision evidence.

It should add a new layer of review.

---

## 34. Observability Design

### 34.1 Required metrics

For each producer:

```text
outbox_pending_count
outbox_publish_success_count
outbox_publish_failure_count
outbox_oldest_pending_age_seconds
put_events_latency_ms
put_events_failed_entry_count
```

For each queue:

```text
approximate_number_of_messages_visible
approximate_number_of_messages_not_visible
approximate_age_of_oldest_message
messages_received
messages_deleted
messages_failed
messages_sent_to_dlq
```

For each consumer:

```text
event_processed_count by eventType
processing_latency_ms by eventType
idempotency_duplicate_count
unsupported_event_version_count
retryable_failure_count
terminal_failure_count
```

For case workflow:

```text
case_submitted_count
case_approved_count
case_rejected_count
case_escalated_count
sla_breached_count
appeal_submitted_count
state_transition_failure_count
```

### 34.2 Required log fields

Every log line inside event handling should include:

```text
correlationId
eventId
eventType
eventVersion
caseId
consumerName
messageId
awsRequestId if available
attempt
```

### 34.3 Trace model

Trace should connect:

```text
HTTP command request
  -> DB transaction
  -> outbox event
  -> EventBridge PutEvents
  -> SQS delivery
  -> consumer handler
  -> downstream AWS calls
  -> resulting command/event
```

Even if distributed tracing is imperfect across async hops, correlation ID and event ID must remain intact.

---

## 35. Security Design

### 35.1 IAM boundaries

Case Service role:

```text
Can write to EventBridge bus.
Cannot consume all queues.
Cannot send notification directly unless required.
Cannot access unrelated S3 prefixes.
```

Screening consumer role:

```text
Can read screening queue.
Can delete messages from screening queue.
Can write screening result events.
Cannot update case DB directly unless it is the owning service.
```

Notification consumer role:

```text
Can read notification queue.
Can access template/config secrets.
Can send email/SMS through approved channel.
Cannot update authoritative case state.
```

Audit consumer role:

```text
Can read audit queue.
Can write audit projection store.
Cannot mutate case state.
```

### 35.2 Data classification

Events should not contain unnecessary sensitive data.

Prefer:

```text
caseId
documentId
applicantId reference
```

Avoid:

```text
full NRIC/passport
full document contents
raw uploaded file
full address unless needed
secret values
```

Large or sensitive documents should stay in S3 with controlled access, not inside event payload.

### 35.3 KMS and encryption

Use encryption for:

- SQS queues,
- SNS topics,
- EventBridge bus where required,
- S3 buckets,
- secrets/config,
- audit archive.

But remember: encryption does not replace access control. KMS key policy and IAM must both be correct.

---

## 36. Data Retention and Evidence

Case systems often have retention rules.

Design separate retention policy for:

```text
case operational data
audit trail
event archive
SQS DLQ messages
CloudWatch logs
S3 evidence files
reporting projections
notification records
```

Do not assume all data can have the same lifecycle.

Example:

```text
SQS DLQ retention: days
CloudWatch app logs: months
EventBridge archive: months/years depending replay need
Audit trail: years depending regulation
S3 evidence: years/legal hold depending case type
Reporting projection: rebuildable, shorter retention possible
```

---

## 37. Cost and Quota Awareness

Event-driven systems can quietly become expensive.

Cost drivers:

```text
EventBridge events published
SNS publishes and deliveries
SQS requests from polling
Lambda invocations and duration
CloudWatch log ingestion
KMS encrypt/decrypt requests
S3 object requests
DLQ retention and redrive
```

### 37.1 Common cost mistakes

```text
Polling SQS too aggressively with short polling.
Logging full payload for every event.
Publishing too many low-value events.
Creating one event per minor field change.
Repeated KMS calls without caching where appropriate.
Unbounded replay triggering massive downstream work.
```

### 37.2 Quota mistakes

```text
Assuming infinite Lambda concurrency.
Ignoring SQS in-flight message limits.
Ignoring EventBridge target retry and DLQ behavior.
Ignoring KMS throttling.
Ignoring downstream database connection limits.
```

Top-tier design treats quota as part of architecture, not an operational surprise.

---

## 38. Testing Strategy

### 38.1 Unit tests

Test:

```text
state transition guards
idempotency logic
event serialization/deserialization
schema compatibility
handler dispatch
retry classification
```

### 38.2 Contract tests

Test:

```text
producer event shape
consumer compatibility
required fields
version support
unknown field tolerance
invalid enum behavior
```

### 38.3 Integration tests

Use LocalStack/Testcontainers or sandbox AWS account to test:

```text
EventBridge PutEvents
SNS/SQS subscription delivery
SQS DLQ movement
Lambda/SQS batch behavior
IAM permission failures
KMS encrypted queue access
```

### 38.4 Replay tests

Test replay explicitly:

```text
same event twice
old event after new event
event with unsupported version
DLQ redrive after bug fix
projection rebuild from historical events
```

### 38.5 Chaos/failure tests

Inject:

```text
EventBridge publish failure
SQS delete failure
consumer crash after side effect before ack
DB deadlock during transition
KMS access denied
notification provider timeout
outbox publisher partial batch failure
```

---

## 39. Production Readiness Checklist

### 39.1 Domain checklist

```text
[ ] Each event is a fact, not vague command.
[ ] Case Service owns authoritative state.
[ ] State transitions are guarded.
[ ] Appeal is modeled separately if needed.
[ ] Timer firing re-checks source of truth.
[ ] External results include request/version identity.
```

### 39.2 Event checklist

```text
[ ] Every event has eventId.
[ ] Every event has eventType and version.
[ ] Every event has correlationId.
[ ] Every event has source.
[ ] Event payload avoids unnecessary PII.
[ ] Schema evolution rules are documented.
```

### 39.3 Reliability checklist

```text
[ ] Transactional outbox exists.
[ ] Outbox publisher handles partial failure.
[ ] Queue per consumer.
[ ] DLQ per queue or target.
[ ] Consumers are idempotent.
[ ] Visibility timeout matches processing behavior.
[ ] Retry and backoff are bounded.
[ ] Replay procedure is tested.
```

### 39.4 Observability checklist

```text
[ ] Outbox pending age metric.
[ ] Queue age metric.
[ ] DLQ depth alarm.
[ ] Consumer failure metrics.
[ ] Correlation ID in logs.
[ ] Event ID in logs.
[ ] Audit trail committed with state changes.
[ ] Incident reconstruction query exists.
```

### 39.5 Security checklist

```text
[ ] Least privilege per producer/consumer.
[ ] No broad wildcard AWS permission.
[ ] SQS/SNS/EventBridge/S3 encrypted where required.
[ ] KMS key policy tested.
[ ] No secret or sensitive document in event payload.
[ ] Cross-account access explicitly controlled.
```

### 39.6 Operations checklist

```text
[ ] DLQ triage owner defined.
[ ] Redrive runbook exists.
[ ] Replay runbook exists.
[ ] Rollback strategy exists.
[ ] Schema compatibility policy exists.
[ ] Dashboard exists per workflow.
[ ] Cost/quota alarms exist.
```

---

## 40. Common Anti-Patterns

### 40.1 Event as RPC

Bad:

```text
Publish ProcessCase and expect one specific service to do one specific thing immediately.
```

Better:

```text
Send command to command endpoint or queue.
Publish event only after fact occurs.
```

### 40.2 Shared queue for unrelated consumers

Bad:

```text
One queue consumed by screening, notification, reporting.
```

Better:

```text
One queue per responsibility.
```

### 40.3 No outbox

Bad:

```text
DB update then publish event directly.
```

Better:

```text
DB update + outbox insert in same transaction.
Publisher publishes later.
```

### 40.4 Blind consumer update

Bad:

```text
ScreeningCompleted directly sets case.status = UNDER_REVIEW.
```

Better:

```text
Case Service validates active screening request and transition rules.
```

### 40.5 Audit from logs only

Bad:

```text
Search application logs to prove decision history.
```

Better:

```text
Authoritative audit trail committed with state changes.
```

### 40.6 Replay without idempotency

Bad:

```text
Replay all events and hope duplicate side effects do not happen.
```

Better:

```text
Replay only through idempotent consumers with monitored canary rollout.
```

---

## 41. A Strong Reference Blueprint

```text
[User/API]
   |
   v
[Case Command API]
   |
   | DB transaction
   v
[Case DB] + [Audit Trail] + [Outbox]
   |
   | Outbox Publisher
   v
[EventBridge Domain Bus]
   |
   +--> [SQS: screening] ----> [Screening Worker] ----> ScreeningCompleted event
   |
   +--> [SQS: assignment] ---> [Assignment Worker] ---> AssignOfficer command
   |
   +--> [SQS: notification] -> [Notification Worker] -> NotificationDispatched event
   |
   +--> [SQS: sla] ----------> [SLA Worker/Scheduler] -> EscalationDue event
   |
   +--> [SQS: audit-proj] ---> [Audit Projection Worker]
   |
   +--> [SQS: report-proj] --> [Reporting Projection Worker]
   |
   +--> [Archive/Replay]

Each queue:
   -> DLQ
   -> metrics
   -> owner
   -> runbook

Each consumer:
   -> idempotency store
   -> structured logs
   -> retry classification
   -> bounded concurrency
```

---

## 42. What Top 1% Engineers Notice Here

A surface-level engineer says:

> Use SNS/SQS/EventBridge for async processing.

A stronger engineer asks:

```text
What is the source of truth?
Which service owns each state transition?
Is this a command or event?
What happens if publish fails after DB commit?
What happens if event is delivered twice?
What happens if event arrives late?
What happens if consumer crashes after side effect but before ack?
Can we replay safely?
Can we prove who changed the case and why?
Can we reconstruct the incident timeline?
Can every DLQ message be triaged?
Can cost explode under replay or retry storm?
Are IAM boundaries aligned with ownership?
Does the event expose unnecessary sensitive data?
Can schema evolve without breaking consumers?
```

The difference is not tool knowledge.

The difference is invariants.

---

## 43. Key Invariants

Use these as design laws:

```text
1. Only the owning service mutates authoritative state.
2. State change and outbox event creation happen in one transaction.
3. Published events are facts, not vague instructions.
4. Every consumer is idempotent.
5. Every queue has one responsibility and one owner.
6. Every async side effect has retry, DLQ, and triage path.
7. Timer events re-check source of truth before changing state.
8. External result events must match active request/version.
9. Replay must not create duplicate irreversible side effects.
10. Audit trail is committed with authoritative state change.
11. Event payloads do not carry unnecessary sensitive data.
12. Correlation ID and event ID flow across the entire workflow.
13. Schema evolution is intentional and backward-compatible.
14. Queue lag, DLQ depth, outbox age, and consumer failure are first-class metrics.
15. IAM permissions reflect service ownership boundaries.
```

---

## 44. Practical Design Exercise

Design a workflow for this scenario:

```text
A licensing case is submitted.
The system must verify documents, screen applicant risk, assign an officer, notify applicant, start SLA timer, and update reporting dashboard.
If screening fails, officer review is still required.
If document verification fails, clarification is requested.
If officer does not act within 5 working days, escalation occurs.
Applicant may appeal rejection within 30 days.
```

Answer these:

```text
1. What is the source of truth for case status?
2. Which events are domain events?
3. Which messages are commands?
4. Which services need their own queue?
5. Which consumers are replay-safe?
6. Which side effects are irreversible?
7. What is the idempotency key for each consumer?
8. What is the DLQ triage process?
9. What audit records are mandatory?
10. How do you prevent stale screening results from changing current state?
11. How do you handle appeal without corrupting original decision history?
12. Which metrics prove the system is healthy?
```

If you can answer these cleanly, you are thinking beyond library usage.

---

## 45. Summary

Event-driven case management is not simply SNS + SQS + EventBridge.

It is the disciplined design of:

- ownership,
- state machines,
- commands,
- events,
- outbox,
- idempotency,
- ordering tolerance,
- retry,
- DLQ,
- replay,
- audit,
- observability,
- security,
- cost and quota boundaries.

AWS gives the building blocks.

Java gives the implementation substrate.

Architecture quality comes from invariants.

The most important lesson:

> In regulated case workflows, every asynchronous event must still preserve deterministic state ownership, traceable causality, replay safety, and defensible audit history.

---

## References

- AWS Decision Guide — Amazon SQS, Amazon SNS, or EventBridge?: https://docs.aws.amazon.com/decision-guides/latest/sns-or-sqs-or-eventbridge/sns-or-sqs-or-eventbridge.html
- AWS SNS to SQS fanout: https://docs.aws.amazon.com/sns/latest/dg/sns-sqs-as-subscriber.html
- Amazon EventBridge archives and replay: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-archive.html
- Amazon EventBridge schema registries: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-schema-registry.html
- Amazon EventBridge DLQ: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-dlq.html
- Amazon SQS dead-letter queues: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html
- AWS Prescriptive Guidance — Transactional outbox pattern: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html
- AWS Prescriptive Guidance — Event sourcing pattern: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/event-sourcing.html


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-29-secure-configuration-and-secret-rotation-case-study.md">⬅️ Part 29 — Secure Configuration and Secret Rotation Case Study</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-31-multi-account-multi-environment-and-deployment-strategy.md">Part 31 — Multi-Account, Multi-Environment, and Deployment Strategy ➡️</a>
</div>
