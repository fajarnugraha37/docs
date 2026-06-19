# Part 33 — Advanced Patterns: Outbox, Inbox, Idempotency, Saga, and Compensation

Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
Scope: Java 8–25, AWS SDK for Java 2.x, AWS Lambda, S3, SQS, SNS, EventBridge, DynamoDB, relational databases, Spring Boot/non-Spring Java services  
Level: Advanced / production architecture

---

## 0. Why This Part Exists

Parts 0–32 built the service-level vocabulary: AWS SDK clients, credentials, IAM, HTTP transport, retries, S3, SQS, SNS, Lambda, EventBridge, Secrets, KMS, DynamoDB, observability, hardening, cost, multi-account deployment, and SDK migration.

This part moves above individual services.

The real difficulty in production AWS systems is not calling `sqsClient.sendMessage()` or `eventBridgeClient.putEvents()`. The difficult part is making sure that a business action remains correct when:

- the database commit succeeds but event publishing fails;
- the event is published but the consumer crashes before recording progress;
- SQS redelivers a message;
- Lambda retries the same event;
- an API client times out and sends the same request again;
- an event arrives before another event that logically happened earlier;
- a compensating action itself fails;
- an operator replays an event from DLQ;
- a downstream service performs the same side effect twice;
- two workers race on the same aggregate;
- audit evidence must explain why the system did what it did.

These are not edge cases. They are the normal shape of distributed systems.

This part is about five patterns that form the reliability core of advanced cloud applications:

1. **Transactional Outbox** — do not lose events when local state changes.
2. **Inbox / Deduplication** — do not apply the same event effect twice.
3. **Idempotency** — make retries safe.
4. **Saga** — coordinate multi-step business processes without distributed transactions.
5. **Compensation** — repair or reverse previous steps in an explicit, auditable way.

The goal is not to memorize pattern names. The goal is to internalize the invariants that keep a Java AWS system correct under partial failure.

---

## 1. The Core Problem: Distributed State Has No Single Commit Point

In a monolith with one database transaction, correctness often looks like this:

```text
BEGIN TRANSACTION
  update case_status
  insert audit_row
  update assignment
COMMIT
```

The database gives you atomicity. Either all changes become visible, or none do.

In a cloud-integrated system, the same logical action often crosses multiple systems:

```text
1. Save case status to database
2. Publish CaseApproved event to SNS/EventBridge
3. Send notification command to SQS
4. Store generated PDF in S3
5. Update read model in DynamoDB
6. Call another service
```

There is no single transaction spanning all of these systems.

A relational database transaction cannot atomically commit together with SNS, SQS, EventBridge, S3, Lambda, DynamoDB, and an external API.

That means every cross-boundary design must answer:

- What happens if step A succeeds but step B fails?
- What happens if the caller does not know whether step B succeeded?
- What happens if step B succeeds twice?
- What happens if step C observes step B before observing step A?
- What state proves the system is safe to retry?
- What state proves an operator is safe to replay?

A top-tier engineer does not hide these questions behind retries. They model them explicitly.

---

## 2. Mental Model: Commands, Events, Facts, Effects, and Recovery

Before discussing patterns, we need precise terms.

### 2.1 Command

A command is a request to do something.

Examples:

```text
ApproveCase
AssignOfficer
GenerateNotice
SendEmail
CreatePaymentInstruction
```

A command can be rejected.

It is usually imperative:

```text
Please do X.
```

### 2.2 Event

An event is a fact that something already happened.

Examples:

```text
CaseApproved
OfficerAssigned
NoticeGenerated
EmailSent
PaymentInstructionCreated
```

An event should not be rejected as if it were a request. Consumers may fail to process it, but the event itself describes a past fact.

It is usually past tense:

```text
X happened.
```

### 2.3 Effect

An effect is a state change or external side effect caused by a command or event.

Examples:

- update database row;
- insert audit trail;
- publish message;
- send email;
- upload S3 object;
- call external API;
- create task;
- trigger escalation timer.

### 2.4 Idempotency key

An idempotency key identifies the logical operation, not the individual retry attempt.

```text
approve-case:CASE-2026-000123:decision-v4
send-notice:NOTICE-889912
payment-command:PAYMENT-REQ-7788
```

The same operation retried with the same key should not create multiple effects.

### 2.5 Replay

Replay means processing an old event or message again intentionally or unintentionally.

Replay may happen because of:

- SQS redelivery;
- Lambda retry;
- DLQ redrive;
- EventBridge archive replay;
- manual operator action;
- consumer crash after side effect but before ack;
- network timeout;
- idempotent API retry.

A replay-safe system can process the same input again without corrupting business state.

### 2.6 Compensation

Compensation is not simply “rollback”.

A database rollback erases uncommitted work. A compensation is a new business action that semantically offsets a previously committed action.

Example:

```text
Original action: Reserve inventory
Compensation: Release inventory

Original action: Assign officer
Compensation: Unassign officer or reassign to previous officer

Original action: Send notification
Compensation: Send correction notice, not unsend email
```

In regulated systems, compensation must usually be auditable. You do not pretend the original action never happened.

---

## 3. Failure Reality: The System Can Fail Between Any Two Lines

Consider this Java service method:

```java
@Transactional
public void approveCase(ApproveCaseCommand command) {
    CaseRecord caseRecord = caseRepository.findById(command.caseId());
    caseRecord.approve(command.officerId(), command.reason());
    caseRepository.save(caseRecord);

    snsClient.publish(PublishRequest.builder()
            .topicArn(caseApprovedTopicArn)
            .message(toJson(new CaseApprovedEvent(command.caseId())))
            .build());
}
```

At first glance this looks reasonable.

But it has a dual-write problem.

```text
Database write + SNS publish = two independent write systems
```

Failure cases:

| Failure point | Result |
|---|---|
| DB save fails before commit | no case approval, no event |
| DB commits, SNS publish fails | case approved but no event |
| SNS publish succeeds, transaction later rolls back | event says approved but DB says not approved |
| SNS publish times out but succeeded remotely | retry may publish duplicate event |
| app crashes after publish before response | caller may retry entire operation |

Adding retry does not solve the fundamental ambiguity. It can make duplicates more likely.

The correct question is not:

```text
How do I guarantee publish succeeds?
```

The better question is:

```text
What durable local fact lets me retry publishing later without changing the business decision twice?
```

That is the entrance to the transactional outbox pattern.

---

## 4. Transactional Outbox Pattern

### 4.1 Intent

The transactional outbox pattern solves the dual-write problem between a local database transaction and an external message/event system.

Instead of writing business state and publishing an event in the same method as two separate systems, the service writes both the business state and the event-to-be-published into the same local database transaction.

Then a separate publisher process reads the outbox table and publishes events to SNS, SQS, EventBridge, Kafka, or another transport.

### 4.2 Basic Flow

```text
Command handler
  ├─ begin DB transaction
  ├─ update business table
  ├─ insert outbox_event row
  └─ commit DB transaction

Outbox publisher
  ├─ poll unpublished outbox rows
  ├─ publish to SNS/SQS/EventBridge
  ├─ mark outbox row as published
  └─ retry on failure
```

Now the event cannot be lost if the database transaction commits, because the event is stored as durable data.

### 4.3 Core Invariant

```text
If business state changes, the corresponding event record exists durably in the same database transaction.
```

This is the heart of the pattern.

Not this:

```text
Event is immediately published.
```

Not this:

```text
Consumer immediately receives event.
```

The invariant is more precise:

```text
The system has a durable obligation to publish the event.
```

### 4.4 Outbox Table Example

```sql
CREATE TABLE outbox_event (
    id                  VARCHAR(64) PRIMARY KEY,
    aggregate_type      VARCHAR(100) NOT NULL,
    aggregate_id        VARCHAR(100) NOT NULL,
    event_type          VARCHAR(200) NOT NULL,
    event_version       INTEGER NOT NULL,
    event_key           VARCHAR(200) NOT NULL,
    payload_json        CLOB NOT NULL,
    headers_json        CLOB NULL,
    destination_type    VARCHAR(50) NOT NULL,
    destination_name    VARCHAR(300) NOT NULL,
    status              VARCHAR(30) NOT NULL,
    attempt_count       INTEGER NOT NULL,
    next_attempt_at     TIMESTAMP NULL,
    last_error_code     VARCHAR(100) NULL,
    last_error_message  VARCHAR(2000) NULL,
    created_at          TIMESTAMP NOT NULL,
    published_at        TIMESTAMP NULL,
    locked_by           VARCHAR(100) NULL,
    locked_until        TIMESTAMP NULL
);

CREATE INDEX idx_outbox_status_next_attempt
    ON outbox_event(status, next_attempt_at);

CREATE INDEX idx_outbox_aggregate
    ON outbox_event(aggregate_type, aggregate_id, created_at);
```

For PostgreSQL, `jsonb` may be appropriate. For Oracle, `CLOB` with validation/check constraint or JSON column support can be used depending on version and platform policy. The important part is not the exact type. The important part is durable, queryable, operationally manageable event records.

### 4.5 Status Model

A useful outbox status model:

```text
NEW
  -> PUBLISHING
  -> PUBLISHED
  -> FAILED_RETRYABLE
  -> FAILED_PERMANENT
  -> PARKED
```

But many systems can simplify:

```text
NEW
PUBLISHED
FAILED
```

Choose based on operational need. Do not over-model if the team cannot operate it.

### 4.6 Publishing Loop

Pseudo-flow:

```text
repeat:
  rows = claim N rows where status in (NEW, FAILED_RETRYABLE) and next_attempt_at <= now
  for each row:
    try publish(row)
    if publish success:
      mark PUBLISHED
    else if retryable failure:
      increment attempt_count, set next_attempt_at with backoff
    else:
      mark FAILED_PERMANENT
```

The publisher must be safe if multiple instances run concurrently.

Claiming must be atomic.

Common database strategies:

- `SELECT ... FOR UPDATE SKIP LOCKED` where supported;
- update-with-condition lease column;
- status transition with optimistic locking;
- partitioned worker ownership.

### 4.7 Java Claiming Example: Conceptual Repository

```java
public interface OutboxRepository {
    List<OutboxEventRecord> claimPublishable(
            String workerId,
            Instant now,
            int maxRows,
            Duration leaseDuration
    );

    void markPublished(String eventId, Instant publishedAt);

    void markRetryableFailure(
            String eventId,
            int nextAttemptCount,
            Instant nextAttemptAt,
            String errorCode,
            String errorMessage
    );

    void markPermanentFailure(
            String eventId,
            String errorCode,
            String errorMessage
    );
}
```

The outbox publisher should not need to know business tables. It knows event rows and destinations.

### 4.8 Event Envelope

Do not publish raw domain objects without an envelope.

A production event envelope should include enough metadata to support routing, deduplication, traceability, and replay.

Example:

```json
{
  "eventId": "evt-01JZ2Q4Z4G8SA9P2M7H5RJJ4R1",
  "eventType": "case.approved",
  "eventVersion": 1,
  "eventTime": "2026-06-19T10:15:30Z",
  "producer": "case-service",
  "environment": "prod",
  "tenantId": "cea",
  "correlationId": "corr-98e84f",
  "causationId": "cmd-approve-case-7788",
  "aggregateType": "case",
  "aggregateId": "CASE-2026-000123",
  "aggregateVersion": 17,
  "idempotencyKey": "approve-case:CASE-2026-000123:v17",
  "payload": {
    "caseId": "CASE-2026-000123",
    "approvedBy": "officer-219",
    "approvedAt": "2026-06-19T10:15:28Z"
  }
}
```

### 4.9 Event ID vs Idempotency Key vs Aggregate Version

These fields are related but not identical.

| Field | Meaning |
|---|---|
| `eventId` | Unique identity of one event record |
| `idempotencyKey` | Logical operation identity for safe retry/dedup |
| `aggregateId` | Entity being changed |
| `aggregateVersion` | Monotonic version of aggregate state |
| `correlationId` | Request/process trace across systems |
| `causationId` | What caused this event |

A common mistake is using only `eventId` for deduplication. That prevents processing the same event record twice, but it does not necessarily prevent duplicated logical operations if two event records are created for the same command.

### 4.10 Outbox Destination Choices on AWS

| Destination | Good for | Trade-off |
|---|---|---|
| SNS | Fan-out to multiple subscribers | weaker routing model than EventBridge |
| SQS | Work queue / command queue | not ideal as broad event bus |
| EventBridge | event routing, archive/replay, schema governance | throughput/cost/latency considerations |
| Kinesis | ordered stream/high-throughput log | shard management and consumer complexity |
| Lambda direct invoke | targeted async execution | tight coupling, invocation semantics matter |

For many enterprise Java systems:

```text
Outbox -> EventBridge for domain events
Outbox -> SQS for commands/work items
Outbox -> SNS for simple fan-out notifications
```

### 4.11 Outbox Ordering

Outbox does not magically guarantee global ordering.

Possible ordering levels:

| Ordering level | Feasibility |
|---|---|
| Global total order across all events | expensive and usually unnecessary |
| Per aggregate order | useful and practical |
| Per partition/key order | practical with FIFO/Kinesis-like designs |
| No strict order, idempotent consumers | most scalable |

For case management systems, per-case ordering is often more meaningful than global ordering.

```text
CaseCreated -> CaseSubmitted -> CaseApproved
```

But requiring all cases globally ordered creates unnecessary coupling.

### 4.12 Outbox Publisher Idempotency

Publishing can itself be ambiguous.

Failure case:

```text
1. Publisher sends event to EventBridge
2. Network times out before response is received
3. Publisher does not know if publish succeeded
4. Publisher retries
5. Downstream receives duplicate event
```

Therefore:

```text
Outbox guarantees no lost event obligation.
It does not eliminate duplicate delivery.
Consumers must still be idempotent.
```

This is a crucial mental model.

Outbox and inbox belong together.

---

## 5. Inbox / Deduplication Pattern

### 5.1 Intent

The inbox pattern records inbound messages/events before or during processing so that the same message can be detected and skipped, resumed, or handled safely.

It protects consumers from duplicate delivery, replay, retry, and DLQ redrive.

### 5.2 Core Invariant

```text
A consumer applies the business effect of a logical message at most once for the chosen idempotency scope.
```

The phrase “for the chosen idempotency scope” matters.

You must define whether deduplication is by:

- event ID;
- idempotency key;
- aggregate ID + aggregate version;
- command ID;
- external reference number;
- natural business key;
- message group + sequence.

### 5.3 Inbox Table Example

```sql
CREATE TABLE inbox_message (
    consumer_name       VARCHAR(100) NOT NULL,
    message_key         VARCHAR(300) NOT NULL,
    message_id          VARCHAR(200) NULL,
    event_type          VARCHAR(200) NULL,
    aggregate_type      VARCHAR(100) NULL,
    aggregate_id        VARCHAR(100) NULL,
    aggregate_version   INTEGER NULL,
    status              VARCHAR(30) NOT NULL,
    first_seen_at       TIMESTAMP NOT NULL,
    last_seen_at        TIMESTAMP NOT NULL,
    processed_at        TIMESTAMP NULL,
    attempt_count       INTEGER NOT NULL,
    last_error_code     VARCHAR(100) NULL,
    last_error_message  VARCHAR(2000) NULL,
    response_hash       VARCHAR(128) NULL,
    PRIMARY KEY (consumer_name, message_key)
);
```

### 5.4 Inbox Processing Flow

```text
receive message
  ├─ derive message_key
  ├─ insert inbox row with status PROCESSING
  │    ├─ insert succeeds: first time seen
  │    └─ duplicate key: already seen
  ├─ if already PROCESSED: acknowledge/skip
  ├─ apply business effect transactionally
  ├─ mark inbox row PROCESSED
  └─ acknowledge/delete message
```

### 5.5 Atomic Consumer Transaction

For consumers that write to a database, process inbound message and inbox state in one local transaction:

```text
BEGIN TRANSACTION
  insert inbox_message if absent
  if already processed: no-op
  update business state
  insert audit row
  mark inbox processed
COMMIT
ack/delete message
```

If ack/delete fails after commit, SQS may redeliver. Inbox detects duplicate and returns no-op.

### 5.6 Java Consumer Skeleton

```java
public final class InboxGuard {
    private final InboxRepository inboxRepository;

    public ProcessingDecision begin(String consumerName, String messageKey, Instant now) {
        InboxRecord existing = inboxRepository.find(consumerName, messageKey);

        if (existing != null && existing.status() == InboxStatus.PROCESSED) {
            return ProcessingDecision.alreadyProcessed();
        }

        if (existing == null) {
            inboxRepository.insertProcessing(consumerName, messageKey, now);
            return ProcessingDecision.processNow();
        }

        return ProcessingDecision.retryOrResume(existing);
    }

    public void markProcessed(String consumerName, String messageKey, Instant now) {
        inboxRepository.markProcessed(consumerName, messageKey, now);
    }
}
```

In real code, `begin`, business mutation, and `markProcessed` should normally be inside the same transaction.

### 5.7 Deduplication with DynamoDB

DynamoDB is often used for idempotency records in Lambda or serverless consumers.

A conceptual item:

```json
{
  "pk": "consumer#notice-service#message#case.approved:CASE-2026-000123:v17",
  "status": "COMPLETED",
  "createdAt": "2026-06-19T10:15:31Z",
  "expiresAt": 1813409731,
  "responseHash": "sha256:..."
}
```

A conditional write prevents duplicate processing:

```text
PutItem if attribute_not_exists(pk)
```

But the details matter:

- What happens if the function crashes after creating `IN_PROGRESS` but before completing?
- What TTL is safe?
- Should duplicate return previous response?
- What if same key arrives with different payload?
- How long can replay happen?

### 5.8 Inbox TTL

Do not choose TTL randomly.

TTL must be longer than the maximum replay horizon:

```text
TTL >= max(message retention, DLQ retention, archive replay window, manual replay policy, business dispute window if needed)
```

Examples:

| Source | Dedup TTL consideration |
|---|---|
| SQS standard queue | queue retention + DLQ retention + redrive window |
| EventBridge archive | archive retention/replay policy |
| API idempotency | client retry window + business duplicate risk window |
| payment-like command | often much longer; business key may be permanent |
| audit event | may need permanent duplicate detection by natural key |

### 5.9 The Inbox Does Not Replace Business Invariants

Inbox deduplication catches repeated messages. It does not validate whether a state transition is legal.

You still need aggregate-level invariants:

```text
A CLOSED case cannot be APPROVED.
A case cannot be assigned to two active primary officers.
A notice cannot be generated for a case version older than the latest approved version unless explicitly allowed.
```

Deduplication is not authorization, validation, or state machine correctness.

---

## 6. Idempotency

### 6.1 Idempotency Definition

A mutating operation is idempotent when repeating the same logical request has the same intended effect as executing it once.

It does not mean the code path runs only once.

It means repeated execution does not create duplicate business effects.

Example:

```text
PUT /case/123/status APPROVED
```

This can be idempotent if setting status to APPROVED repeatedly leaves the case approved.

But:

```text
POST /case/123/notes
```

This may not be idempotent unless the request includes a stable idempotency key.

### 6.2 Why Idempotency Is Mandatory in AWS Systems

AWS-integrated applications are full of retry paths:

- SDK retries after throttling or transient network errors;
- API clients retry on timeout;
- Lambda retries failed asynchronous invocations;
- SQS redelivers messages not deleted before visibility timeout;
- EventBridge can retry delivery;
- operators redrive DLQ;
- Step Functions may retry states;
- deployment rollback may replay initialization actions;
- batch jobs may rerun.

If retries are not safe, resilience mechanisms become data corruption mechanisms.

### 6.3 Idempotency Scope

Define idempotency at the correct level.

Bad:

```text
Deduplicate by HTTP request ID generated per attempt.
```

Good:

```text
Deduplicate by client-supplied operation ID or natural business key.
```

Examples:

| Operation | Idempotency key |
|---|---|
| approve case | `approve-case:{caseId}:{targetVersion}` |
| generate notice | `generate-notice:{noticeId}` |
| submit application | `submit-application:{applicationId}:{submissionVersion}` |
| create payment instruction | external payment request ID |
| process SQS event | event envelope idempotency key |
| update projection | `{aggregateId}:{aggregateVersion}:{projectionName}` |

### 6.4 Same Key, Same Intent

A robust idempotency layer should detect key reuse with different payload.

Example failure:

```text
Request A:
  key = approve-case:CASE-1:v7
  reason = "complete evidence"

Request B:
  key = approve-case:CASE-1:v7
  reason = "manual override"
```

Same key, different intent.

The system should not silently return success. It should reject or flag conflict.

Store request hash:

```text
idempotency_key
request_hash
status
response_hash
created_at
expires_at
```

On duplicate:

```text
same key + same hash -> return previous result / no-op
same key + different hash -> conflict
```

### 6.5 Idempotency State Machine

Useful state model:

```text
NONE
  -> IN_PROGRESS
  -> COMPLETED
  -> FAILED_RETRYABLE
  -> FAILED_FINAL
```

Important edge case:

```text
Worker obtains idempotency lock and crashes before completion.
```

If `IN_PROGRESS` never expires, the operation is stuck forever.

Therefore `IN_PROGRESS` needs an expiration/lease.

### 6.6 Idempotent API Handler Skeleton

```java
public final class IdempotentCommandHandler<C, R> {
    private final IdempotencyStore store;
    private final CommandExecutor<C, R> executor;
    private final RequestHasher<C> requestHasher;

    public R handle(String idempotencyKey, C command) {
        String requestHash = requestHasher.hash(command);

        IdempotencyDecision decision = store.tryBegin(idempotencyKey, requestHash);

        if (decision instanceof IdempotencyDecision.ReplayCompleted replay) {
            return deserializeResponse(replay.responsePayload());
        }

        if (decision instanceof IdempotencyDecision.Conflict) {
            throw new DuplicateKeyDifferentPayloadException(idempotencyKey);
        }

        try {
            R result = executor.execute(command);
            store.markCompleted(idempotencyKey, requestHash, serializeResponse(result));
            return result;
        } catch (RuntimeException ex) {
            store.markFailed(idempotencyKey, classify(ex));
            throw ex;
        }
    }
}
```

This skeleton is intentionally simplified. In production, the business transaction and idempotency state must be aligned carefully.

### 6.7 Idempotency with Lambda Powertools Java

AWS Lambda Powertools for Java provides an idempotency utility intended to make Lambda functions safe to retry by storing idempotency state, commonly in DynamoDB. It is useful when the Lambda event has a stable idempotency key and the duplicate behavior can be expressed through the library’s model.

But do not treat the utility as magic.

You still need to decide:

- What field is the idempotency key?
- What is the validation hash?
- What is the TTL?
- What is the behavior for in-progress records?
- What is the behavior for partial side effects?
- Is the operation safe to cache response for?

Libraries implement mechanics. Architects define correctness.

### 6.8 Idempotency vs Deduplication

They overlap, but they are not identical.

| Concept | Meaning |
|---|---|
| Deduplication | detect repeated input/message |
| Idempotency | repeated operation has same business effect |
| Exactly-once | usually not achievable end-to-end across distributed systems |
| Practically-once | at-least-once delivery + idempotent effects + observable recovery |

### 6.9 Idempotency and Side Effects

Some effects are naturally idempotent:

```text
Set status to APPROVED
Put object to same S3 key with same content hash
Upsert read model for aggregate version 17
```

Some effects are not naturally idempotent:

```text
Send email
Create payment
Append comment
Generate new random reference number
Insert audit row without unique operation key
```

For non-idempotent effects, introduce a stable operation key or split the effect into durable intent + executor.

Example:

```text
Instead of directly sending email:
  insert notification_request(notice_id unique, status=READY)
  notification sender sends once per notice_id
```

---

## 7. Transactional Boundaries and Pattern Composition

The patterns become powerful when combined.

### 7.1 Command Handler with Idempotency + Outbox

```text
receive ApproveCase command
  ├─ begin DB transaction
  ├─ check idempotency key
  ├─ validate state transition
  ├─ update case aggregate
  ├─ insert audit row
  ├─ insert outbox CaseApproved event
  ├─ mark idempotency completed
  └─ commit

outbox publisher later publishes event
```

### 7.2 Consumer with Inbox + Outbox

```text
receive CaseApproved event
  ├─ begin DB transaction
  ├─ insert/check inbox row
  ├─ if duplicate: commit and ack
  ├─ update local projection/work item
  ├─ insert outbox command/event if needed
  ├─ mark inbox processed
  └─ commit
```

This creates a reliable event chain without distributed transactions.

### 7.3 The Golden Rule

```text
Every boundary crossing must be either:
  1. preceded by durable intent, or
  2. guarded by idempotency, or
  3. both.
```

Examples:

| Boundary | Required protection |
|---|---|
| DB -> SNS/EventBridge | outbox |
| SQS -> DB | inbox/idempotency |
| API client -> service | idempotency key |
| service -> external payment | durable command + idempotency key |
| Lambda -> email provider | notification request + unique notice key |
| DLQ replay -> consumer | inbox + business invariant |

---

## 8. Saga Pattern

### 8.1 Intent

A saga coordinates a long-running business process across multiple local transactions, each owned by a different service or component.

Since there is no distributed ACID transaction, each step commits locally. If a later step fails, the saga triggers compensating actions for previous completed steps.

### 8.2 Example: Case Approval Workflow

```text
1. Approve case
2. Generate approval notice
3. Notify applicant
4. Create follow-up compliance task
5. Schedule escalation timer
```

Each step may be owned by a different service.

A simple successful path:

```text
ApproveCaseSucceeded
  -> GenerateNotice
  -> NoticeGenerated
  -> SendNotification
  -> NotificationSent
  -> CreateComplianceTask
  -> ComplianceTaskCreated
  -> ScheduleEscalation
  -> EscalationScheduled
```

Failure path:

```text
NotificationFailed
  -> MarkNoticeDeliveryFailed
  -> CreateManualReviewTask
  -> NotifyOfficer
```

Not every failure requires reversing all previous work. Sometimes the correct compensation is escalation, manual review, or alternate route.

### 8.3 Saga Choreography

In choreography, services react to events without a central orchestrator.

```text
Case service publishes CaseApproved
Notice service subscribes and generates notice
Notification service subscribes and sends notification
Task service subscribes and creates compliance task
```

Benefits:

- loose coupling;
- independent services;
- natural event-driven flow;
- good for simple flows.

Risks:

- process logic spread across services;
- hard to see global state;
- accidental cycles;
- difficult compensation coordination;
- hard operational debugging.

### 8.4 Saga Orchestration

In orchestration, a central orchestrator controls the workflow.

```text
Orchestrator
  -> command Notice service
  <- NoticeGenerated
  -> command Notification service
  <- NotificationSent
  -> command Task service
  <- TaskCreated
```

AWS options:

- Step Functions for explicit serverless orchestration;
- custom Java workflow/orchestrator service;
- EventBridge + state store;
- BPMN engine such as Camunda if process visibility/human workflow is central.

Benefits:

- process state visible;
- easier timeout/escalation;
- compensation path explicit;
- good for regulated workflows.

Risks:

- orchestrator can become too central;
- more coupling to process definition;
- versioning process definitions can be hard;
- requires careful idempotency at every command step.

### 8.5 Choreography vs Orchestration Decision

| Use choreography when | Use orchestration when |
|---|---|
| process is simple | process is long-running |
| failures are local | compensation spans multiple services |
| global visibility is less important | audit/process visibility is critical |
| services naturally react to events | a process owner must control sequence |
| no complex timers | timers/escalations are core |
| no human intervention | human review/manual task exists |

For regulatory case management, orchestration is often more defensible for core lifecycle transitions, while choreography is useful for side projections, notifications, analytics, and non-critical subscribers.

### 8.6 Saga State Model

A saga should have durable state.

Example table:

```sql
CREATE TABLE saga_instance (
    saga_id             VARCHAR(100) PRIMARY KEY,
    saga_type           VARCHAR(100) NOT NULL,
    business_key        VARCHAR(200) NOT NULL,
    current_state       VARCHAR(100) NOT NULL,
    status              VARCHAR(30) NOT NULL,
    version             INTEGER NOT NULL,
    correlation_id      VARCHAR(100) NOT NULL,
    started_at          TIMESTAMP NOT NULL,
    updated_at          TIMESTAMP NOT NULL,
    completed_at        TIMESTAMP NULL,
    failed_at           TIMESTAMP NULL,
    failure_reason      VARCHAR(2000) NULL
);

CREATE UNIQUE INDEX uk_saga_business_key
    ON saga_instance(saga_type, business_key);
```

Example step table:

```sql
CREATE TABLE saga_step (
    saga_id             VARCHAR(100) NOT NULL,
    step_name           VARCHAR(100) NOT NULL,
    step_status         VARCHAR(30) NOT NULL,
    command_id          VARCHAR(100) NULL,
    started_at          TIMESTAMP NULL,
    completed_at        TIMESTAMP NULL,
    compensated_at      TIMESTAMP NULL,
    failure_reason      VARCHAR(2000) NULL,
    PRIMARY KEY (saga_id, step_name)
);
```

### 8.7 Saga Invariants

Useful invariants:

```text
A saga instance has one business key.
A step is completed at most once.
A compensation is attempted only for a completed step.
A completed saga does not accept new normal steps.
A failed saga must be either compensated, parked, or manually resolved.
Every outbound command from a saga has a stable command ID.
Every inbound reply/event is deduplicated.
```

### 8.8 Saga and Timeouts

Every remote step needs a timeout model.

Questions:

- How long should the saga wait for `NoticeGenerated`?
- What if the downstream eventually succeeds after timeout?
- Is late success ignored, accepted, or compensated?
- Who owns escalation?
- Can an operator resume the saga?

Example:

```text
WAITING_FOR_NOTICE_GENERATED
  if NoticeGenerated received before T+5m -> SEND_NOTIFICATION
  if timeout at T+5m -> RETRY_GENERATE_NOTICE
  if retry exhausted -> CREATE_MANUAL_REVIEW_TASK
```

### 8.9 Saga with EventBridge Scheduler

EventBridge Scheduler can be used for delayed commands or timeout checks.

Pattern:

```text
Saga step starts
  -> schedule timeout event with sagaId + stepName + expectedVersion

Timeout event fires
  -> saga checks current state/version
  -> if still waiting, trigger retry/compensation/escalation
  -> if already advanced, ignore stale timeout
```

The expected version is important. Without it, a stale timeout can damage a saga that has already moved forward.

---

## 9. Compensation Pattern

### 9.1 Compensation Is a Business Action

Compensation is not technical undo. It is a domain-specific action that restores acceptable business consistency.

Examples:

| Completed action | Possible compensation |
|---|---|
| reserve resource | release reservation |
| assign officer | unassign/reassign officer |
| create task | cancel task |
| publish approval notice | publish correction notice |
| charge payment | refund payment |
| mark document verified | mark verification revoked with reason |

### 9.2 Compensation Must Be Designed Before Failure

You cannot reliably invent compensation during an incident.

For every saga step, define:

```text
Step name
Forward action
Forward idempotency key
Success event
Failure event
Timeout
Retry policy
Compensation action
Compensation idempotency key
Compensation success event
Manual fallback
Audit evidence
```

### 9.3 Compensation Table

```sql
CREATE TABLE compensation_action (
    compensation_id         VARCHAR(100) PRIMARY KEY,
    saga_id                 VARCHAR(100) NOT NULL,
    original_step_name      VARCHAR(100) NOT NULL,
    action_type             VARCHAR(100) NOT NULL,
    idempotency_key         VARCHAR(300) NOT NULL,
    status                  VARCHAR(30) NOT NULL,
    attempt_count           INTEGER NOT NULL,
    next_attempt_at         TIMESTAMP NULL,
    created_at              TIMESTAMP NOT NULL,
    completed_at            TIMESTAMP NULL,
    last_error_message      VARCHAR(2000) NULL
);

CREATE UNIQUE INDEX uk_compensation_idempotency
    ON compensation_action(idempotency_key);
```

### 9.4 Compensation Ordering

Often compensation runs in reverse order of completed steps.

```text
Forward:
  A -> B -> C

Compensation:
  compensate C -> compensate B -> compensate A
```

But not always.

Domain rules may override reverse order.

Example:

```text
If notification already sent, do not cancel notice silently.
Instead create correction notice and officer review task.
```

### 9.5 Compensation Failure

Compensation can fail.

Therefore compensation itself needs:

- idempotency;
- retry policy;
- DLQ/parking state;
- operator dashboard;
- audit trail;
- manual fallback.

Never assume compensation always succeeds.

### 9.6 Irreversible Effects

Some effects cannot be undone:

- email sent;
- SMS sent;
- external party downloaded file;
- audit log written;
- legal notice issued;
- third-party side effect performed.

For irreversible effects, compensation is usually a correction, not reversal.

```text
Wrong email sent -> send correction email
Wrong notice issued -> issue amended notice
Wrong public status exposed -> record correction and notify affected parties
```

This distinction matters in regulated systems.

---

## 10. Outbox vs CDC vs Event Sourcing

### 10.1 Transactional Outbox

The service explicitly inserts event records into an outbox table.

Good when:

- event payload must be controlled;
- business event names matter;
- audit and replay are needed;
- database transaction should include event obligation;
- team wants explicit event contract.

### 10.2 CDC-Based Publishing

Change Data Capture reads database logs and publishes changes.

Good when:

- many changes need replication;
- source database log is reliable;
- you want less application-level polling;
- Debezium/DMS/Kafka Connect style pipeline exists.

Risks:

- raw table changes are not always domain events;
- schema changes can leak into event contract;
- operational complexity moves to CDC pipeline;
- dedup/order behavior still needs design.

### 10.3 Event Sourcing

Event sourcing stores events as the primary source of truth.

Good when:

- full state history is core;
- rebuilding state from events is useful;
- auditability is fundamental;
- domain transitions are naturally event-based.

Risks:

- harder query model;
- schema evolution complexity;
- replay complexity;
- not every team needs this level of model shift.

### 10.4 Practical Recommendation

For most Java enterprise systems moving from CRUD/service architecture toward event-driven AWS:

```text
Start with transactional outbox + inbox/idempotency.
Introduce CDC where replication scale demands it.
Use event sourcing only when the domain truly benefits from event-as-source-of-truth.
```

---

## 11. AWS Service Mapping

### 11.1 SQS

SQS is ideal for command/work queues.

Use patterns:

- inbox for consumers;
- idempotency key in message body/attribute;
- visibility timeout extension;
- DLQ redrive with replay-safe handlers;
- FIFO group for per-aggregate ordering if required.

### 11.2 SNS

SNS is useful for fan-out.

Use patterns:

- outbox publisher publishes domain events;
- SNS filter policies route subscribers;
- subscribers receive via SQS, not direct fragile coupling when durability matters;
- consumers use inbox/idempotency.

### 11.3 EventBridge

EventBridge is useful for routed domain events, archive/replay, SaaS integration, and scheduled events.

Use patterns:

- outbox publisher sends events to custom event bus;
- schema registry for event contract governance;
- archive/replay requires strong consumer idempotency;
- scheduler can trigger saga timeout commands.

### 11.4 Lambda

Lambda is a common consumer/executor.

Use patterns:

- idempotency for retry-safe handlers;
- partial batch response for SQS events;
- durable state for long-running workflows;
- avoid hidden side effects in static initialization;
- use Powertools where it fits but define keys/invariants yourself.

### 11.5 DynamoDB

DynamoDB is useful for:

- idempotency records;
- saga state;
- projection state;
- command status;
- high-scale dedup store;
- conditional writes.

### 11.6 S3

S3 is useful for:

- large payload storage;
- event payload offloading;
- audit artifacts;
- replay payload snapshots;
- immutable evidence records.

Do not put huge payloads directly into SNS/SQS/EventBridge if pointer-to-S3 plus checksum is safer.

---

## 12. Designing Event Contracts for These Patterns

### 12.1 Event Contract Requirements

A good event contract includes:

- stable event type;
- event version;
- event ID;
- idempotency key;
- aggregate ID;
- aggregate version;
- event time;
- producer;
- correlation ID;
- causation ID;
- payload;
- optional schema reference;
- optional checksum if external payload is stored in S3.

### 12.2 Versioning Rules

Prefer additive changes.

Safe:

```text
Add optional field
Add new event type
Add new version with parallel support
```

Dangerous:

```text
Rename field
Change meaning of field
Remove field
Change enum value semantics
Reuse event type for different fact
```

### 12.3 Consumer Robustness

Consumers should:

- ignore unknown fields;
- reject unknown required versions intentionally;
- validate business invariants;
- record event ID/key;
- be replay-safe;
- log correlation and causation IDs;
- expose metrics per event type/version.

---

## 13. State Machine Thinking

These patterns work best when business aggregates have explicit state machines.

Example case state:

```text
DRAFT
  -> SUBMITTED
  -> UNDER_REVIEW
  -> APPROVED
  -> REJECTED
  -> APPEALED
  -> CLOSED
```

Illegal transitions must be rejected even during replay.

Example invariant:

```text
CaseApproved event for aggregateVersion 17 can update projection from version 16 to 17.
If projection is already at version 17, no-op.
If projection is above version 17, ignore stale event.
If projection is below version 16, wait/retry/rebuild depending on design.
```

Projection update logic:

```java
public void apply(CaseApproved event) {
    Projection p = repository.find(event.caseId());

    if (p.version() >= event.aggregateVersion()) {
        return; // duplicate or stale
    }

    if (p.version() != event.aggregateVersion() - 1) {
        throw new GapDetectedException(event.caseId(), p.version(), event.aggregateVersion());
    }

    p.markApproved(event.approvedAt());
    p.setVersion(event.aggregateVersion());
    repository.save(p);
}
```

This is not just idempotency. This is ordered state safety.

---

## 14. DLQ Is Not a Solution by Itself

A DLQ stores failed messages. It does not explain correctness.

A system with DLQ but no idempotency may corrupt data during redrive.

Before redrive, operators need:

- message type;
- failure reason;
- current aggregate state;
- whether message was partially processed;
- whether side effects already happened;
- idempotency/inbox status;
- safe replay instructions;
- poison message classification;
- expected result of replay.

A mature DLQ runbook says:

```text
For message type CaseApproved v1:
1. Check inbox_message by consumer + idempotency key.
2. If PROCESSED, delete from DLQ.
3. If FAILED_RETRYABLE and aggregate version is current, redrive.
4. If stale aggregate version, archive as stale duplicate.
5. If schema validation failure, route to contract-failure queue.
6. If business invariant failure, create manual review record.
```

---

## 15. Observability for Advanced Reliability Patterns

### 15.1 Metrics

Essential metrics:

```text
outbox.new.count
outbox.publish.success.count
outbox.publish.failure.count
outbox.oldest.unpublished.age
outbox.retry.count
outbox.permanent.failure.count

inbox.duplicate.count
inbox.processing.failure.count
inbox.in_progress.expired.count

idempotency.hit.count
idempotency.conflict.count
idempotency.in_progress.timeout.count

saga.started.count
saga.completed.count
saga.failed.count
saga.compensated.count
saga.stuck.count
saga.step.timeout.count

compensation.started.count
compensation.completed.count
compensation.failed.count
```

### 15.2 Logs

Every outbox publish log should include:

```text
eventId
eventType
aggregateId
aggregateVersion
destination
correlationId
causationId
attemptCount
awsRequestId
```

Every consumer log should include:

```text
consumerName
messageKey
eventId
eventType
aggregateId
aggregateVersion
inboxStatus
correlationId
sqsMessageId/eventBridgeEventId
```

Every saga log should include:

```text
sagaId
sagaType
businessKey
currentState
stepName
commandId
correlationId
```

### 15.3 Alerts

Useful alerts:

- outbox oldest unpublished event age exceeds threshold;
- outbox permanent failures > 0;
- inbox in-progress records expired;
- DLQ depth > 0 for critical queue;
- saga stuck beyond SLA;
- compensation failure > 0;
- duplicate rate spikes unexpectedly;
- idempotency conflict > 0;
- event schema validation failures > 0.

Alert on symptoms that need action, not every retry.

---

## 16. Java Implementation Architecture

### 16.1 Suggested Packages

```text
com.example.platform.messaging.outbox
com.example.platform.messaging.inbox
com.example.platform.idempotency
com.example.platform.saga
com.example.platform.compensation
com.example.platform.events
com.example.platform.aws.sqs
com.example.platform.aws.sns
com.example.platform.aws.eventbridge
```

### 16.2 Outbox Module Interfaces

```java
public interface DomainEvent {
    String eventId();
    String eventType();
    int eventVersion();
    String aggregateType();
    String aggregateId();
    long aggregateVersion();
    String idempotencyKey();
    String correlationId();
    Instant occurredAt();
}
```

```java
public interface OutboxWriter {
    void append(DomainEvent event, OutboxDestination destination);
}
```

```java
public interface OutboxPublisher {
    PublishResult publish(OutboxEventRecord record);
}
```

### 16.3 Destination Abstraction

```java
public sealed interface OutboxDestination
        permits SnsDestination, SqsDestination, EventBridgeDestination {
    String logicalName();
}

public record SnsDestination(String logicalName, String topicArn)
        implements OutboxDestination {}

public record SqsDestination(String logicalName, String queueUrl)
        implements OutboxDestination {}

public record EventBridgeDestination(String logicalName, String eventBusName, String source)
        implements OutboxDestination {}
```

For Java 8, replace sealed interfaces and records with final classes.

### 16.4 Java 8 to 25 Compatibility Note

If supporting Java 8–25 in one conceptual library:

| Feature | Java 8-compatible alternative |
|---|---|
| `record` | final class with fields/getters |
| sealed interface | normal interface + package-private constructors/factories |
| pattern matching | explicit `instanceof` checks |
| `var` | explicit types |
| virtual threads | executor abstraction; use platform threads on Java 8 |

Architectural patterns do not require modern language features. Modern Java improves clarity and ergonomics.

### 16.5 Transactional Usage Example

```java
@Transactional
public ApproveCaseResult approve(ApproveCaseCommand command) {
    IdempotencyRecord idem = idempotencyRepository.beginOrReturn(
            command.idempotencyKey(),
            command.payloadHash()
    );

    if (idem.isCompleted()) {
        return idem.previousResultAs(ApproveCaseResult.class);
    }

    CaseAggregate aggregate = caseRepository.lockById(command.caseId());
    aggregate.approve(command.officerId(), command.reason());

    caseRepository.save(aggregate);

    auditRepository.insert(AuditEntry.caseApproved(
            command.caseId(),
            command.officerId(),
            command.correlationId()
    ));

    CaseApproved event = CaseApproved.from(aggregate, command);
    outboxWriter.append(event, OutboxDestinations.caseEvents());

    ApproveCaseResult result = new ApproveCaseResult(command.caseId(), aggregate.version());
    idempotencyRepository.markCompleted(command.idempotencyKey(), result);

    return result;
}
```

Important:

```text
Business update + audit + outbox + idempotency completion are one local transaction.
```

### 16.6 Consumer Usage Example

```java
@Transactional
public void onCaseApproved(EventEnvelope<CaseApprovedPayload> envelope) {
    String consumer = "notice-service.case-approved";
    String messageKey = envelope.idempotencyKey();

    InboxDecision decision = inboxRepository.begin(consumer, messageKey, envelope.requestHash());

    if (decision.isAlreadyProcessed()) {
        return;
    }

    Notice notice = noticeService.createApprovalNoticeIfAbsent(
            envelope.payload().caseId(),
            envelope.aggregateVersion(),
            envelope.correlationId()
    );

    outboxWriter.append(
            NoticeGenerated.from(notice, envelope),
            OutboxDestinations.noticeEvents()
    );

    inboxRepository.markProcessed(consumer, messageKey);
}
```

---

## 17. Anti-Patterns

### 17.1 Publish Inside Database Transaction

```text
BEGIN
  update DB
  publish SNS
COMMIT
```

Risk:

- event published but DB rolls back;
- transaction held open while waiting on network;
- remote dependency failure blocks DB transaction;
- lock duration increases.

### 17.2 Publish After Database Commit Without Outbox

```text
COMMIT DB
publish SNS
```

Risk:

- DB commits but process crashes before publish;
- event lost permanently unless detected by reconciliation.

### 17.3 Treat SQS Message ID as Business Idempotency Key

SQS message ID identifies a transport message, not necessarily a business operation.

Use envelope operation key or domain key.

### 17.4 Assume FIFO Means No Idempotency Needed

FIFO can reduce duplicates and preserve ordering within message group, but consumers must still be safe under retries, visibility timeout expiry, and redrive.

### 17.5 Use DLQ as Business Error Handling

DLQ is an operational holding area, not a business process model.

### 17.6 Compensation Without Audit

A compensation that silently mutates state can be worse than the original failure.

### 17.7 Infinite Retry Without State

Retries without attempt count, next attempt time, last error, and parking state become invisible failure loops.

### 17.8 No Natural Business Key

If every operation uses random generated IDs without stable business keys, duplicate detection becomes weak.

### 17.9 Overusing Sagas

Not every process needs a saga. A single local transaction is better when the data belongs together and consistency must be immediate.

### 17.10 Event Sourcing as Fashion

Event sourcing is powerful but costly. Do not adopt it merely because events exist.

---

## 18. Regulatory Case Management Example

### 18.1 Scenario

An officer approves a case.

Required effects:

1. Case status becomes `APPROVED`.
2. Audit trail records officer, reason, timestamp.
3. Approval notice generation is requested.
4. Applicant notification is sent after notice generation.
5. Compliance follow-up task is created.
6. Escalation timer is scheduled.

### 18.2 Architecture

```text
Officer UI
  -> Case API
      -> DB transaction:
           update case
           insert audit
           insert idempotency completion
           insert outbox CaseApproved

Outbox publisher
  -> EventBridge case-events bus

Notice service
  <- CaseApproved
  -> inbox dedup
  -> generate notice record
  -> write S3 PDF
  -> outbox NoticeGenerated

Notification service
  <- NoticeGenerated
  -> inbox dedup
  -> send email/SMS
  -> record notification attempt

Task service
  <- CaseApproved
  -> inbox dedup
  -> create compliance task if absent

Escalation service / scheduler
  <- CaseApproved
  -> schedule timeout event
```

### 18.3 Invariants

```text
A case approval decision is recorded exactly once per case version.
Every approved case has a durable CaseApproved outbox event.
Every notice generation is keyed by caseId + caseVersion + noticeType.
Every notification send is keyed by noticeId + recipient + channel.
Every compliance task is keyed by caseId + taskType + caseVersion.
Every escalation schedule includes expected case version.
```

### 18.4 Failure Walkthrough

Failure:

```text
Case DB commits but EventBridge is unavailable.
```

Result:

```text
Outbox event remains NEW/FAILED_RETRYABLE.
Publisher retries.
No approval is lost.
```

Failure:

```text
Notice service generates PDF and commits, but SQS ack fails.
```

Result:

```text
Message redelivered.
Inbox says already processed.
Consumer returns success and deletes message.
No duplicate PDF/business record.
```

Failure:

```text
Notification email provider times out after possibly sending email.
```

Result:

```text
Notification request remains in uncertain state.
Retry uses provider idempotency key if supported.
If not supported, business policy determines whether to retry, verify, or manual-review.
```

Failure:

```text
Escalation timeout fires after case is already closed.
```

Result:

```text
Timeout handler checks expected state/version.
Stale timeout ignored and audited.
```

---

## 19. Design Review Checklist

### 19.1 Outbox Checklist

- Is every business state change that must emit an event paired with an outbox insert in the same transaction?
- Does the outbox row contain event type, version, aggregate ID, aggregate version, correlation ID, and destination?
- Is publisher claiming safe under multiple workers?
- Is retry backoff bounded and observable?
- Is permanent failure parked with enough error detail?
- Is oldest unpublished age monitored?
- Are duplicate publishes safe for consumers?

### 19.2 Inbox Checklist

- Does each consumer have a stable consumer name?
- Is the message key based on business operation, not transport attempt?
- Is duplicate detection atomic with business effect?
- Is `IN_PROGRESS` handled safely?
- Is TTL longer than replay horizon?
- Are duplicate/conflict metrics emitted?

### 19.3 Idempotency Checklist

- Does every mutating API/command have an idempotency key?
- Is key reuse with different payload detected?
- Is previous response stored if clients expect repeat response?
- Is in-progress expiration defined?
- Is the idempotency record updated in the same transaction as the effect where possible?
- Are side effects protected separately?

### 19.4 Saga Checklist

- Is saga choreography or orchestration chosen intentionally?
- Is saga state durable?
- Is every outbound command idempotent?
- Is every inbound reply/event deduplicated?
- Are timeouts explicit?
- Are compensation actions defined before production?
- Can operators inspect and resume/park saga instances?

### 19.5 Compensation Checklist

- Is compensation a business action, not hidden technical rollback?
- Is compensation idempotent?
- Is compensation audited?
- Is compensation failure handled?
- Are irreversible effects identified?
- Is manual fallback defined?

---

## 20. What Top 1% Engineers Internalize

A strong engineer knows how to use AWS SDK.

A very strong engineer knows how to configure retries, timeouts, credentials, IAM, and clients.

A top-tier engineer understands that these are still insufficient unless business correctness survives partial failure.

The deeper mindset is:

```text
Never rely on hope between two durable boundaries.
```

Instead:

```text
Persist intent.
Make effects idempotent.
Record consumption.
Model state transitions.
Design compensation.
Make replay safe.
Make failure visible.
Make operator action safe.
```

These patterns are not optional decorations. They are the difference between a demo cloud application and a production system that can be trusted during incidents, audits, migrations, retries, and replay.

---

## 21. Practical Exercises

### Exercise 1 — Identify Dual Writes

Take one existing service method and list every external write it performs:

```text
DB write
S3 write
SNS publish
SQS send
EventBridge put
email send
external API call
```

Mark every pair that is not atomic.

Then decide whether each needs:

- outbox;
- durable command table;
- idempotency key;
- reconciliation job;
- compensation.

### Exercise 2 — Define Idempotency Keys

For each operation below, define a safe idempotency key:

```text
Submit application
Approve case
Generate notice
Send notification
Create compliance task
Schedule escalation
Process uploaded file
Create payment instruction
```

Then define what happens if the same key arrives with a different payload.

### Exercise 3 — Design an Inbox

Choose one SQS consumer.

Define:

```text
consumer_name
message_key
status model
TTL
business transaction boundary
duplicate behavior
conflict behavior
metrics
```

### Exercise 4 — Saga Failure Table

For a case approval workflow, create a table:

```text
Step
Forward command
Success event
Failure event
Timeout
Retry policy
Compensation
Manual fallback
```

### Exercise 5 — DLQ Redrive Runbook

For one DLQ, write a safe redrive runbook:

```text
How to inspect message
How to determine if already processed
How to determine if stale
How to replay
How to park
How to audit operator action
```

---

## 22. Summary

This part covered advanced reliability patterns that sit above individual AWS services:

- Transactional outbox prevents lost event obligations after local state changes.
- Inbox/deduplication prevents repeated inbound messages from applying duplicate effects.
- Idempotency makes retries safe by keying logical operations, not attempts.
- Saga coordinates multi-step distributed processes through local transactions and explicit state.
- Compensation repairs committed effects through auditable business actions.
- DLQ, retry, and replay are safe only when paired with idempotency and state invariants.
- Event contracts must carry IDs, versions, correlation, causation, aggregate identity, and idempotency keys.
- Production readiness requires metrics, logs, alerts, runbooks, and operator-safe recovery.

The main lesson:

```text
Distributed systems do not fail at random places. They fail at every boundary you forgot to model.
```

---

## 23. References

- AWS Prescriptive Guidance — Transactional outbox pattern: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html
- AWS Prescriptive Guidance — Saga pattern: https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-data-persistence/saga-pattern.html
- AWS Prescriptive Guidance — Saga patterns: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga.html
- AWS Prescriptive Guidance — Saga choreography pattern: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-choreography.html
- AWS Lambda Powertools for Java — Idempotency: https://docs.aws.amazon.com/powertools/java/latest/utilities/idempotency/
- Amazon Builders' Library — Making retries safe with idempotent APIs: https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/
- AWS Well-Architected Reliability Pillar — Make mutating operations idempotent: https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_prevent_interaction_failure_idempotent.html


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-32-migration-from-aws-sdk-java-v1-to-v2.md">⬅️ Part 32 — Migration from AWS SDK Java v1 to v2</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-34-production-readiness-checklist-and-operational-playbooks.md">Part 34 — Production Readiness Checklist and Operational Playbooks ➡️</a>
</div>
