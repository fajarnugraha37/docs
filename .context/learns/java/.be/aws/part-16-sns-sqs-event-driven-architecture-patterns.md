# Part 16 — SNS + SQS Event-Driven Architecture Patterns

Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
File: `part-16-sns-sqs-event-driven-architecture-patterns.md`  
Target Java: Java 8–25  
Primary SDK: AWS SDK for Java 2.x  
Last updated: 2026-06-19

---

## 0. What This Part Is About

In the previous parts, we studied SNS and SQS separately:

- **SQS** as a reliability boundary: buffering, retry, visibility timeout, DLQ, and worker isolation.
- **SNS** as a publish/subscribe fan-out mechanism: topics, subscriptions, filter policies, retry, and delivery failure handling.

This part combines them into one of the most common AWS event-driven patterns:

```text
Producer Service
      |
      v
   SNS Topic
      |
      +---------------------> SQS Queue A ---> Consumer A
      |
      +---------------------> SQS Queue B ---> Consumer B
      |
      +---------------------> SQS Queue C ---> Consumer C
```

This looks simple, but production design is not simple.

The hard part is not publishing one message to one queue. The hard part is:

- preserving domain meaning;
- avoiding accidental coupling;
- handling duplicates;
- handling partial subscriber failure;
- replaying safely;
- evolving event schemas without breaking consumers;
- controlling retry storms;
- designing DLQ ownership;
- keeping auditability;
- and making the system operable during incidents.

The goal of this part is to build the mental model needed to design event-driven Java systems that remain understandable after the system grows.

---

## 1. The Core Mental Model

SNS plus SQS gives you two complementary abstractions.

SNS is a **distribution boundary**.

SQS is a **consumption boundary**.

Together:

```text
SNS decides who should receive the event.
SQS protects each receiver from producer speed, subscriber downtime, and transient failure.
```

A producer should not know every consumer.

A consumer should not be forced to process at producer speed.

SNS provides fan-out.

SQS provides buffering, retry, isolation, and backpressure.

The combination is powerful because it separates three concerns:

| Concern | Owned by | Example |
|---|---|---|
| Event publication | Producer | `CaseCreated` event is emitted |
| Event routing | SNS topic/subscription | Send to notification queue and screening queue |
| Event consumption | SQS consumer | Screening worker processes at its own pace |

This separation is what makes SNS + SQS useful in distributed systems.

---

## 2. Why Not Just Call Another Service Directly?

A direct synchronous call says:

```text
Service A cannot finish unless Service B responds.
```

An event-driven handoff says:

```text
Service A records that something happened.
Other services may react independently.
```

That changes the failure model.

### 2.1 Synchronous dependency model

```text
Case Service ---> Screening Service
```

If Screening Service is slow:

- Case Service becomes slow.
- User request may timeout.
- Retry from frontend may duplicate intent.
- Case Service capacity becomes coupled to Screening Service capacity.
- Screening outage becomes Case outage.

### 2.2 Event-driven dependency model

```text
Case Service ---> SNS ---> SQS ---> Screening Worker
```

If Screening Worker is slow:

- Case Service can still publish the event.
- Queue depth increases.
- Screening delay becomes visible through queue metrics.
- Backlog can be drained later.
- Case creation and screening processing are decoupled.

That is the core architectural benefit.

But there is a trade-off.

You gain decoupling, but you lose immediate certainty.

The producer no longer knows that the consumer has completed the work.

So an event-driven system must be designed around:

- eventual progress;
- idempotency;
- observable backlog;
- compensating flows;
- and explicit state transitions.

---

## 3. SNS + SQS Is Not a Workflow Engine

SNS + SQS gives you event distribution and queueing.

It does not give you:

- long-running process state;
- visual process tracking;
- human task assignment;
- business-level timeout escalation;
- compensation orchestration;
- decision tables;
- process versioning;
- or case lifecycle governance.

Those are workflow/process concerns.

SNS + SQS can support workflows, but it does not replace:

- Step Functions;
- Camunda;
- Temporal;
- a state machine inside your domain service;
- or a case-management lifecycle engine.

A common mistake is to turn message handlers into an implicit workflow engine:

```text
handler A publishes event B
handler B publishes event C
handler C publishes event D
```

After a while, nobody can answer:

- What is the current state?
- Which step failed?
- Which step should be retried?
- Which step was skipped?
- What should happen if the user cancels?
- What is the legal/audit state of the case?

For regulatory systems, this is dangerous.

Use SNS + SQS for asynchronous integration.

Do not hide authoritative business state inside message flow.

---

## 4. Event vs Command

Before designing topics and queues, define what your messages mean.

Two common message types are:

1. **Event**
2. **Command**

They are not the same.

### 4.1 Event

An event says:

```text
Something happened.
```

Examples:

```text
CaseCreated
CaseSubmitted
DocumentUploaded
PaymentReceived
ScreeningCompleted
OfficerAssigned
AppealFiled
```

An event is historical.

It should be named in past tense.

An event should not tell consumers what to do.

Bad:

```text
SendNotification
RunScreening
UpdateReport
```

Good:

```text
CaseSubmitted
DocumentUploaded
PaymentReceived
```

The producer owns the fact.

Consumers decide whether and how to react.

### 4.2 Command

A command says:

```text
Please do this.
```

Examples:

```text
RunScreening
GenerateInvoice
SendEmail
CreateInspectionTask
```

A command has an intended receiver.

A command may fail as a business request.

An event may be ignored by a consumer if irrelevant.

### 4.3 SNS + SQS usually works best for events

SNS topic fan-out is naturally suited for events because multiple consumers may care about the same fact.

```text
CaseSubmitted
    -> Screening service reacts
    -> Notification service reacts
    -> Audit service reacts
    -> SLA service reacts
```

A command is usually better sent to one specific queue:

```text
Case Service ---> screening-command-queue
```

You can still use SNS for command routing, but be careful: broadcasting commands to multiple subscribers often causes unclear ownership.

---

## 5. Domain Event vs Integration Event

A domain event is internal to a bounded context.

An integration event is a public contract emitted outside the bounded context.

They may look similar but have different stability requirements.

### 5.1 Domain event

```java
record CaseStatusChanged(
    CaseId caseId,
    CaseStatus oldStatus,
    CaseStatus newStatus,
    UserId changedBy,
    Instant changedAt
) {}
```

This can be rich and domain-specific.

It may include internal concepts.

It can change as the domain model evolves.

### 5.2 Integration event

```json
{
  "eventId": "01JZ...",
  "eventType": "case.submitted.v1",
  "occurredAt": "2026-06-19T10:15:30Z",
  "producer": "case-service",
  "subject": {
    "type": "case",
    "id": "CASE-2026-000123"
  },
  "data": {
    "caseReferenceNo": "CASE-2026-000123",
    "agencyCode": "CEA",
    "submittedAt": "2026-06-19T10:15:30Z"
  }
}
```

This is a published contract.

It should be stable.

It should not expose internal entity structure unless intentionally part of the contract.

The conversion point is important:

```text
Domain model -> Domain event -> Integration event -> SNS
```

Do not directly serialize JPA entities or internal DTOs into SNS messages.

That leaks internal design into external consumers.

---

## 6. The SNS + SQS Fan-Out Pattern

The basic pattern:

```text
Producer
  |
  | Publish
  v
SNS Topic
  |
  +--> Subscription 1 -> SQS Queue 1 -> Consumer 1
  |
  +--> Subscription 2 -> SQS Queue 2 -> Consumer 2
  |
  +--> Subscription 3 -> SQS Queue 3 -> Consumer 3
```

Each consumer owns its own queue.

This is important.

Do not make multiple unrelated consumers compete on the same queue unless they are horizontally scaled workers for the same logical consumer group.

### 6.1 Correct: one queue per logical subscriber

```text
case-events-topic
  -> screening-case-events-queue
  -> notification-case-events-queue
  -> audit-case-events-queue
```

Each queue has its own:

- visibility timeout;
- DLQ;
- retention;
- scaling policy;
- alerting;
- access policy;
- consumer release cycle.

### 6.2 Incorrect: shared queue for unrelated subscribers

```text
case-events-topic
  -> all-consumers-shared-queue
       -> screening worker
       -> notification worker
       -> audit worker
```

This is wrong if each worker needs every event.

SQS delivers each message to one consumer, not every consumer.

A shared queue is for competing consumers of the same workload, not independent subscribers.

---

## 7. Subscriber Isolation

Subscriber isolation is the main reason to put SQS behind SNS.

Without SQS:

```text
SNS -> Lambda A
SNS -> HTTPS endpoint B
SNS -> Lambda C
```

If one subscriber is slow or unavailable, SNS retry behavior becomes part of that subscriber's reliability story.

With SQS:

```text
SNS -> SQS -> Consumer
```

The queue becomes the subscriber's buffer.

Each subscriber can fail independently.

### 7.1 What isolation gives you

For each subscriber, you can independently control:

- processing concurrency;
- retry delay through visibility timeout;
- DLQ threshold;
- backlog retention;
- redrive strategy;
- deployment schedule;
- consumer version;
- consumer scaling;
- cost profile.

This matters in enterprise systems because not all subscribers have the same criticality.

Example:

```text
CaseSubmitted
  -> audit queue: high criticality, strict alerting
  -> notification queue: retryable, user-facing but not state-authoritative
  -> analytics queue: lower criticality, batch drain acceptable
  -> search-index queue: eventually consistent
```

One event, many different reliability requirements.

---

## 8. Message Envelope Design

Do not publish raw business payload without an envelope.

A good envelope gives every consumer enough metadata to process, trace, deduplicate, and evolve the event.

Recommended baseline:

```json
{
  "eventId": "01JZ4ANZRQQ7Y8P7JQ3S2H6WVK",
  "eventType": "case.submitted.v1",
  "eventVersion": 1,
  "occurredAt": "2026-06-19T10:15:30Z",
  "publishedAt": "2026-06-19T10:15:31Z",
  "producer": "case-service",
  "source": "aceas.case-management",
  "correlationId": "corr-9d21f4d2",
  "causationId": "cmd-73a81aab",
  "tenantId": "cea",
  "subject": {
    "type": "case",
    "id": "CASE-2026-000123"
  },
  "data": {
    "caseReferenceNo": "CASE-2026-000123",
    "submittedBy": "U12345",
    "submittedAt": "2026-06-19T10:15:30Z"
  }
}
```

### 8.1 Field meanings

| Field | Purpose |
|---|---|
| `eventId` | Unique immutable event identity |
| `eventType` | Stable routing and contract identity |
| `eventVersion` | Schema evolution |
| `occurredAt` | When the business fact happened |
| `publishedAt` | When the event was emitted |
| `producer` | Owning service |
| `source` | Domain/system namespace |
| `correlationId` | Trace across request/workflow |
| `causationId` | What caused this event |
| `tenantId` | Multi-tenant boundary if applicable |
| `subject` | Entity being described |
| `data` | Business payload |

### 8.2 `occurredAt` vs `publishedAt`

They are not the same.

`occurredAt`:

```text
The business fact happened at this time.
```

`publishedAt`:

```text
The integration event was sent at this time.
```

This distinction matters when:

- event publication is delayed;
- outbox polling introduces lag;
- replay republishes old events;
- audit timeline must reflect business time, not delivery time.

### 8.3 Correlation vs causation

`correlationId` groups a flow.

`causationId` links direct cause and effect.

Example:

```text
HTTP request corr-123
  -> command SubmitCase cmd-456
      -> event CaseSubmitted evt-789
          -> command RunScreening cmd-999
              -> event ScreeningCompleted evt-abc
```

All may share the same correlation ID.

Each event has a causation link to the immediate command or event that caused it.

This helps incident reconstruction.

---

## 9. SNS Message Attributes vs Message Body

SNS supports message attributes.

Use message attributes for routing metadata.

Use message body for event payload.

Example attributes:

```text
eventType = case.submitted.v1
agencyCode = CEA
priority = normal
schemaVersion = 1
```

Example body:

```json
{
  "eventId": "01JZ...",
  "eventType": "case.submitted.v1",
  "data": {
    "caseReferenceNo": "CASE-2026-000123"
  }
}
```

### 9.1 Why attributes matter

SNS subscription filter policies operate on message attributes or message body depending on configuration.

Attributes are useful because they allow SNS to route without consumers parsing irrelevant messages.

Example:

```text
case-events-topic
  -> screening queue: eventType in [case.submitted.v1, case.resubmitted.v1]
  -> notification queue: eventType in [case.submitted.v1, case.approved.v1, case.rejected.v1]
  -> appeal queue: eventType in [appeal.filed.v1]
```

### 9.2 Avoid overusing filter policy for business logic

SNS filtering is routing logic, not business authorization.

Do not hide complex business rules inside subscription filters.

Good filter:

```text
Only send case.submitted.v1 events to this subscriber.
```

Risky filter:

```text
Only send events where status is APPROVED,
case type is X,
agency is Y,
amount is greater than Z,
unless user category is A...
```

Complex rules belong in a service that owns the business decision.

---

## 10. Topic Design

Topic design shapes coupling.

Common strategies:

1. topic per domain;
2. topic per event category;
3. topic per bounded context;
4. topic per criticality;
5. topic per tenant/environment.

### 10.1 Topic per bounded context

Example:

```text
case-events-topic
document-events-topic
payment-events-topic
notification-events-topic
```

This is usually a good starting point.

It aligns with ownership.

The Case service owns case events.

The Document service owns document events.

### 10.2 Topic per event type

Example:

```text
case-submitted-topic
case-approved-topic
case-rejected-topic
```

This can become too many topics.

It may be useful for high-volume or high-isolation events, but as a default it creates operational sprawl.

### 10.3 Topic per consumer

Example:

```text
screening-topic
notification-topic
audit-topic
```

This is usually wrong for events.

It makes the producer aware of consumers.

The topic name should usually describe what happened, not who receives it.

### 10.4 Topic per environment

Good:

```text
dev-case-events-topic
uat-case-events-topic
prod-case-events-topic
```

or through account separation:

```text
case-events-topic in DEV account
case-events-topic in UAT account
case-events-topic in PROD account
```

Do not mix production and non-production events in one topic.

---

## 11. Queue Design

Each logical subscriber should usually have its own queue.

Queue names should reveal:

- system/domain;
- subscriber;
- event family;
- environment if needed;
- FIFO/standard if relevant.

Examples:

```text
prod-screening-case-events-queue
prod-notification-case-events-queue
prod-audit-case-events-queue
prod-search-index-case-events-queue
```

DLQ examples:

```text
prod-screening-case-events-dlq
prod-notification-case-events-dlq
prod-audit-case-events-dlq
```

### 11.1 Queue ownership

A queue is owned by the consumer, not the producer.

The consumer owns:

- processing semantics;
- failure handling;
- DLQ triage;
- replay procedure;
- visibility timeout;
- concurrency;
- alert thresholds.

The producer owns:

- event correctness;
- event schema;
- publication reliability;
- event versioning;
- event deprecation policy.

This ownership split prevents blame confusion.

---

## 12. Standard vs FIFO in SNS + SQS

Standard SNS topic + standard SQS queue:

- high throughput;
- at-least-once delivery;
- best-effort ordering;
- possible duplicates.

SNS FIFO topic + SQS FIFO queue:

- ordering by message group;
- deduplication support;
- lower or bounded throughput compared with standard;
- stricter design requirements.

### 12.1 Use standard by default when

- consumers are idempotent;
- ordering is not mandatory;
- throughput matters;
- events represent independent facts;
- duplicates can be handled.

### 12.2 Use FIFO when

- ordering is mandatory for correctness;
- duplicate processing would violate invariants;
- event volume per message group is manageable;
- you can choose good message group IDs;
- consumers can tolerate FIFO throughput characteristics.

### 12.3 FIFO does not remove all design work

FIFO helps with deduplication and ordering inside its guarantees, but your application still needs careful state handling.

For example:

```text
CaseSubmitted
CaseApproved
CaseCancelled
```

If all messages for the same case use:

```text
messageGroupId = caseId
```

then the queue can preserve per-case ordering.

But if one case has a poison message, that message group can block later messages for the same case.

That may be acceptable or unacceptable depending on the domain.

---

## 13. Ordering Strategy

Ordering must be scoped.

Global ordering across all events is rarely practical and usually unnecessary.

Ask:

```text
Ordering by what?
```

Possible answers:

- by case ID;
- by document ID;
- by account ID;
- by tenant ID;
- by customer ID;
- by workflow instance ID;
- by aggregate ID.

For domain events, ordering is usually needed per aggregate.

Example:

```text
caseId = CASE-123
  CaseCreated
  CaseSubmitted
  CaseAssigned
  CaseApproved
```

These should be processed in order for that case.

But `CASE-123` and `CASE-999` do not need global ordering relative to each other.

### 13.1 Message group ID selection

For FIFO:

```text
messageGroupId = aggregateType + ":" + aggregateId
```

Examples:

```text
case:CASE-2026-000123
document:DOC-998
appeal:APL-555
```

Bad message group ID:

```text
messageGroupId = "case"
```

This serializes all case events and kills parallelism.

Bad message group ID:

```text
messageGroupId = random UUID
```

This destroys ordering for the same aggregate.

---

## 14. Deduplication Strategy

Duplicates are normal in distributed systems.

Even when a service claims deduplication support, application-level idempotency is still a design requirement for meaningful business effects.

### 14.1 Where duplicates can come from

Duplicates can be caused by:

- producer retry after uncertain publish result;
- SNS delivery retry;
- SQS at-least-once delivery;
- consumer timeout before delete;
- DLQ redrive;
- manual replay;
- outbox republish;
- network interruption;
- deployment restart;
- visibility timeout too short.

### 14.2 Use event ID as idempotency key

Every event should have a stable `eventId`.

Consumers should record processed event IDs.

Example table:

```sql
CREATE TABLE processed_event (
    consumer_name      VARCHAR(100) NOT NULL,
    event_id           VARCHAR(100) NOT NULL,
    event_type         VARCHAR(150) NOT NULL,
    subject_type       VARCHAR(100) NOT NULL,
    subject_id         VARCHAR(150) NOT NULL,
    processed_at       TIMESTAMP NOT NULL,
    PRIMARY KEY (consumer_name, event_id)
);
```

Processing logic:

```text
begin transaction
  insert processed_event(consumer, eventId)
  if duplicate key:
      skip business effect
  apply business effect
commit
delete SQS message
```

This ensures duplicate messages do not duplicate side effects.

### 14.3 Idempotency by state transition

Sometimes idempotency should be based on state transition, not event ID.

Example:

```text
CaseApproved event arrives twice.
```

If the case is already approved, the second event should be no-op.

State transition logic:

```text
APPROVED -> APPROVED = no-op
REJECTED -> APPROVED = invalid transition
SUBMITTED -> APPROVED = valid transition
```

This is stronger than event deduplication because it protects domain invariants.

Best practice:

```text
Use event ID deduplication plus domain state transition guards.
```

---

## 15. Replay Strategy

Replay is not an afterthought.

If an event-driven system cannot replay safely, it is operationally fragile.

Replay happens when:

- a DLQ is redriven;
- a bug is fixed and old events need reprocessing;
- a new projection needs to be built;
- a downstream database was corrupted;
- a consumer was down beyond retention;
- audit reconstruction is needed.

### 15.1 Replay requires idempotent consumers

A replay-safe consumer must handle:

- already-processed event;
- old event version;
- event for deleted entity;
- event whose business state has already advanced;
- event whose referenced object no longer exists;
- event outside current policy;
- event with missing optional fields.

### 15.2 Replay source options

Possible replay sources:

| Source | Strength | Weakness |
|---|---|---|
| SQS DLQ | Easy for failed messages | Only contains failures |
| S3 event archive | Durable, cheap, replayable | Requires explicit archive design |
| EventBridge archive | Built-in for EventBridge | Not SNS-native |
| Application outbox table | Strong relation to domain commit | May have retention/performance limits |
| Audit table | Good for regulatory trace | May not contain full integration payload |

### 15.3 Recommended SNS + SQS archive pattern

For important events:

```text
Producer
  -> Outbox table
  -> Publisher
  -> SNS Topic
       -> Consumer queues
       -> Archive queue
            -> Archive worker
                 -> S3 event archive
```

or:

```text
Publisher writes event to S3 archive before/after successful publish,
depending on the consistency model.
```

Archive key example:

```text
s3://event-archive/prod/case-service/case.submitted.v1/year=2026/month=06/day=19/eventId.json
```

For audit-sensitive systems, do not rely only on transient queue retention.

---

## 16. DLQ Is Not a Trash Bin

A DLQ is a diagnostic and recovery boundary.

It is not a place where messages go to be forgotten.

For each DLQ, define:

- owner;
- alert threshold;
- triage dashboard;
- sample payload inspection process;
- classification categories;
- redrive procedure;
- poison message quarantine procedure;
- retention period;
- escalation path.

### 16.1 Common DLQ categories

| Category | Example | Action |
|---|---|---|
| Transient dependency failure | DB was down | Redrive after dependency recovers |
| Bad payload | Required field missing | Fix producer or schema; quarantine |
| Consumer bug | Null pointer, parsing bug | Fix code; redeploy; redrive |
| Authorization failure | KMS/S3/IAM denied | Fix permission; redrive |
| Business invalid | Event violates domain state | Manual review or compensation |
| Obsolete event | Old version no longer supported | Migration handler or discard with evidence |

### 16.2 DLQ redrive must be controlled

Never redrive a large DLQ blindly.

Risks:

- repeated failure storm;
- duplicate side effects;
- downstream overload;
- poisoning FIFO message groups;
- hiding root cause;
- cost spike.

Use controlled redrive:

```text
sample -> classify -> fix -> replay small batch -> observe -> replay larger batch
```

---

## 17. Retry Layering

SNS and SQS both introduce retry behavior.

Your Java consumer may also retry downstream calls.

If you do not design retry layering, you can create retry amplification.

Example:

```text
SQS message received
  -> Java consumer retries DB call 3 times
  -> message fails
  -> visibility timeout expires
  -> message received again
  -> Java consumer retries DB call 3 times
  -> repeated until maxReceiveCount
```

If 1,000 messages fail, retry amplification can overload the dependency.

### 17.1 Retry policy levels

| Layer | Retry purpose |
|---|---|
| AWS SDK retry | transient AWS API failure |
| Consumer internal retry | short transient dependency failure |
| SQS redelivery | delayed retry after processing failure |
| DLQ redrive | operator-controlled recovery |
| Business compensation | semantic correction |

Do not use all layers aggressively.

### 17.2 Practical recommendation

Inside message handler:

- use short bounded retries for very transient errors;
- fail the message if dependency is not healthy;
- rely on SQS visibility retry for delayed retry;
- use circuit breaker or backpressure when failure is systemic;
- do not spin aggressively inside one message.

---

## 18. Transactional Outbox Pattern

The hardest producer problem is the dual-write problem.

Example:

```text
1. Save case to database.
2. Publish CaseSubmitted event to SNS.
```

What if step 1 succeeds and step 2 fails?

The database says the case was submitted, but no event was emitted.

What if step 2 succeeds and the process crashes before the transaction commits?

An event may be published for state that does not exist.

The transactional outbox pattern solves this by writing the domain state and event record in one database transaction.

### 18.1 Outbox flow

```text
Application transaction:
  - update domain table
  - insert outbox_event row
  - commit

Publisher worker:
  - read unpublished outbox rows
  - publish to SNS
  - mark as published
```

### 18.2 Example table

```sql
CREATE TABLE outbox_event (
    id                VARCHAR(100) PRIMARY KEY,
    aggregate_type    VARCHAR(100) NOT NULL,
    aggregate_id      VARCHAR(150) NOT NULL,
    event_type        VARCHAR(150) NOT NULL,
    event_version     INTEGER NOT NULL,
    payload_json      CLOB NOT NULL,
    status            VARCHAR(30) NOT NULL,
    created_at        TIMESTAMP NOT NULL,
    published_at      TIMESTAMP NULL,
    publish_attempts  INTEGER NOT NULL,
    last_error        VARCHAR(4000) NULL
);
```

### 18.3 Outbox invariants

The outbox guarantees:

```text
If domain state commits, an event record exists.
```

It does not guarantee:

```text
The event is published exactly once.
```

The publisher may publish the same event more than once if it crashes after publish but before marking the row as published.

Therefore consumers still need idempotency.

This is the correct mental model:

```text
Outbox gives at-least-once publication.
Consumer idempotency gives safe processing.
```

---

## 19. Inbox Pattern

The inbox pattern is the consumer-side complement of outbox.

It records inbound events before or during processing.

Consumer transaction:

```text
1. Insert event into inbox table.
2. If duplicate, skip.
3. Apply business effect.
4. Mark processed.
5. Commit.
6. Delete SQS message.
```

Example table:

```sql
CREATE TABLE inbox_event (
    consumer_name      VARCHAR(100) NOT NULL,
    event_id           VARCHAR(100) NOT NULL,
    event_type         VARCHAR(150) NOT NULL,
    received_at        TIMESTAMP NOT NULL,
    processed_at       TIMESTAMP NULL,
    status             VARCHAR(30) NOT NULL,
    payload_json       CLOB NOT NULL,
    last_error         VARCHAR(4000) NULL,
    PRIMARY KEY (consumer_name, event_id)
);
```

The inbox is useful when:

- event processing has important side effects;
- auditability matters;
- replay must be traceable;
- duplicate detection must survive restart;
- you need operator visibility into inbound processing.

---

## 20. Schema Evolution

Event schemas evolve.

If you do not design versioning early, consumers break later.

### 20.1 Additive changes

Usually safe:

```json
{
  "caseReferenceNo": "CASE-123",
  "submittedAt": "2026-06-19T10:15:30Z",
  "submissionChannel": "PORTAL"
}
```

If old consumers ignore unknown fields, adding `submissionChannel` is safe.

### 20.2 Breaking changes

Risky:

- rename field;
- remove field;
- change field type;
- change meaning;
- change enum semantics;
- change timestamp format;
- change ID format;
- move field to nested object.

### 20.3 Version in event type

Recommended:

```text
case.submitted.v1
case.submitted.v2
```

This makes subscription filtering easy.

Do not hide major version only inside body if routing depends on it.

### 20.4 Version compatibility strategy

Prefer:

```text
Publish v1 and v2 in parallel during migration.
Consumers migrate gradually.
Deprecate v1 only after all consumers confirm migration.
```

Avoid:

```text
Change v1 payload in place and hope consumers adapt.
```

### 20.5 Consumer tolerance

Consumers should:

- ignore unknown fields;
- validate required fields;
- handle unknown enum values safely;
- reject unsupported major versions;
- log schema version;
- expose metric for unsupported event type/version.

---

## 21. Event Contract Governance

Event-driven systems fail socially before they fail technically.

You need governance.

Minimum governance:

- event catalog;
- owner per event type;
- schema definition;
- sample payloads;
- compatibility rules;
- deprecation policy;
- consumer list;
- sensitivity classification;
- retention requirement;
- replay policy.

Example event catalog entry:

```yaml
eventType: case.submitted.v1
owner: case-service
description: Emitted when a case is submitted by an applicant or officer.
subject:
  type: case
  idField: data.caseReferenceNo
classification: internal
containsPii: true
retention: 7 years
orderingKey: subject.id
idempotencyKey: eventId
schema:
  required:
    - eventId
    - eventType
    - occurredAt
    - data.caseReferenceNo
compatibility:
  allowed:
    - add optional field
    - add enum value with UNKNOWN fallback
  forbidden:
    - rename required field
    - change timestamp format
consumers:
  - screening-service
  - notification-service
  - audit-service
```

For regulated systems, this catalog becomes operational evidence.

---

## 22. Payload Size Strategy

SNS and SQS have message size limits.

Do not publish large documents or huge JSON payloads as messages.

Use pointer events.

Bad:

```json
{
  "eventType": "document.uploaded.v1",
  "data": {
    "fileBase64": "...massive..."
  }
}
```

Good:

```json
{
  "eventType": "document.uploaded.v1",
  "data": {
    "documentId": "DOC-123",
    "bucket": "prod-document-bucket",
    "key": "documents/2026/06/19/DOC-123.pdf",
    "checksum": "sha256:..."
  }
}
```

The event tells consumers where the object is.

The object lives in S3.

### 22.1 Pointer event invariants

If an event points to S3:

- object must exist before event is visible;
- object access must be authorized for consumers;
- object checksum should be available;
- object lifecycle must exceed event replay window;
- object version ID should be included if versioning matters;
- object should not be mutated in place.

---

## 23. Security Boundary

SNS + SQS security has multiple layers:

- publisher permission to publish to topic;
- topic policy;
- subscription permission;
- queue policy allowing SNS to send;
- consumer permission to receive/delete from queue;
- KMS permissions if encrypted;
- VPC endpoint policy if private access is used;
- payload sensitivity handling.

### 23.1 Queue policy for SNS source restriction

A queue subscribed to SNS should only allow the expected topic to send messages.

Conceptually:

```json
{
  "Effect": "Allow",
  "Principal": {
    "Service": "sns.amazonaws.com"
  },
  "Action": "sqs:SendMessage",
  "Resource": "arn:aws:sqs:ap-southeast-1:123456789012:prod-screening-case-events-queue",
  "Condition": {
    "ArnEquals": {
      "aws:SourceArn": "arn:aws:sns:ap-southeast-1:123456789012:prod-case-events-topic"
    }
  }
}
```

This prevents arbitrary SNS topics from sending to your queue.

### 23.2 Do not leak secrets in events

Events are often copied to logs, DLQs, archives, and dashboards.

Never include:

- password;
- access token;
- refresh token;
- private key;
- session cookie;
- full credential;
- unnecessary sensitive PII;
- raw document content unless explicitly required.

Use references and controlled lookup instead.

---

## 24. Observability Design

For SNS + SQS, observability must cover both producer and consumer sides.

### 24.1 Producer metrics

Track:

- publish success count;
- publish failure count;
- publish latency;
- retry count;
- throttling count;
- outbox pending count;
- outbox oldest age;
- event type count;
- event size distribution.

### 24.2 Topic/subscription metrics

Track:

- messages published;
- delivery failures;
- subscription DLQ depth;
- filter match count if available through logs/derived metrics;
- delivery latency where measurable.

### 24.3 Queue metrics

Track:

- approximate number of visible messages;
- approximate number of not visible messages;
- approximate age of oldest message;
- messages received;
- messages deleted;
- empty receives;
- DLQ message count;
- redrive count.

### 24.4 Consumer metrics

Track:

- processing latency;
- end-to-end event age;
- success/failure count by event type;
- duplicate skipped count;
- unsupported version count;
- business rejection count;
- downstream dependency failure;
- visibility extension count;
- batch partial failure count.

### 24.5 Structured log baseline

Every consumer log should include:

```text
eventId
eventType
eventVersion
correlationId
causationId
subjectType
subjectId
queueName
messageId
receiveCount
consumerName
```

This lets you reconstruct a message's lifecycle.

---

## 25. End-to-End Latency Model

Event-driven systems have multiple latency components.

```text
business action time
  -> database commit time
  -> outbox pickup delay
  -> SNS publish latency
  -> SNS to SQS delivery latency
  -> queue waiting time
  -> consumer processing time
  -> downstream side effect time
```

If users complain that "notification is slow", you need to know where the delay is.

Do not only measure consumer processing time.

Measure event age:

```text
now - occurredAt
now - publishedAt
now - sqsSentTimestamp
```

Different timestamps answer different questions.

| Metric | Meaning |
|---|---|
| `now - occurredAt` | business-to-consumer lag |
| `now - publishedAt` | publish-to-consumer lag |
| `now - sqsSentTimestamp` | queue waiting + processing lag |
| `processedAt - receivedAt` | handler processing duration |

---

## 26. Backpressure and Load Shedding

SQS gives buffering, but buffering is not infinite strategy.

If consumers are slower than producers for too long:

- queue depth grows;
- event age grows;
- retention window may be exceeded;
- DLQ may grow;
- downstream state becomes stale;
- user-visible lag increases.

### 26.1 Backpressure signals

Use these as pressure signals:

- queue age above threshold;
- queue depth growing continuously;
- consumer CPU saturated;
- downstream dependency error rate rising;
- DLQ count increasing;
- processing latency percentile increasing.

### 26.2 Response options

Options:

- scale consumers;
- reduce producer rate;
- shed non-critical event types;
- pause subscription;
- increase batch size;
- increase concurrency carefully;
- isolate high-volume event type to separate topic/queue;
- degrade optional consumers;
- enable priority lane through separate queue.

### 26.3 Priority design

SQS standard queue does not provide priority ordering.

Use separate queues:

```text
notification-high-priority-queue
notification-normal-priority-queue
notification-low-priority-queue
```

Then allocate different worker concurrency.

Do not fake priority by putting priority in message body and hoping consumers always choose correctly.

---

## 27. Eventual Consistency and Read Models

An event-driven consumer often builds a read model or projection.

Example:

```text
CaseSubmitted -> Search Index updated
CaseApproved  -> Dashboard projection updated
```

The projection is eventually consistent.

Design UI and process expectations accordingly.

Bad expectation:

```text
User submits case and search index must show it immediately with strong consistency.
```

Better:

```text
Command response confirms submission.
Search projection updates asynchronously.
UI reads authoritative case state from case service when immediate correctness is needed.
```

Event-driven architecture should not be used to hide strong consistency requirements.

If the next step requires immediate consistency, use the authoritative service or a transaction boundary.

---

## 28. Anti-Corruption Layer for Consumers

Consumers should not let external event shape infect internal domain model.

Use a mapping layer:

```text
SNS/SQS envelope
  -> integration event DTO
  -> validated domain input
  -> domain command
  -> domain model/state change
```

Example:

```java
public final class CaseSubmittedEventHandler {
    private final EventParser parser;
    private final CaseSubmittedMapper mapper;
    private final ScreeningApplicationService screeningService;

    public void handle(String rawMessageBody) {
        IntegrationEvent<CaseSubmittedV1> event =
            parser.parse(rawMessageBody, CaseSubmittedV1.class);

        RequestScreeningCommand command =
            mapper.toCommand(event);

        screeningService.requestScreening(command);
    }
}
```

Do not pass SNS/SQS-specific types deep into domain service.

That couples domain logic to AWS transport.

---

## 29. Java Publisher Architecture

A production publisher should not scatter `snsClient.publish(...)` across the codebase.

Use a publisher abstraction:

```java
public interface EventPublisher {
    PublishResult publish(IntegrationEvent<?> event);
}
```

Implementation responsibilities:

- serialize event;
- validate event envelope;
- attach SNS message attributes;
- set FIFO group/dedup IDs if applicable;
- call SNS;
- record metrics;
- log AWS request ID;
- classify failures;
- integrate with outbox where needed.

### 29.1 Publisher should not own business transaction

Bad:

```java
caseRepository.save(case);
snsClient.publish(...);
```

Better:

```java
transaction {
    caseRepository.save(case);
    outboxRepository.insert(event);
}
```

Then:

```java
outboxPublisher.publishPending();
```

### 29.2 Minimal publisher shape

```java
public final class SnsEventPublisher implements EventPublisher {
    private final SnsClient snsClient;
    private final String topicArn;
    private final ObjectMapper objectMapper;

    @Override
    public PublishResult publish(IntegrationEvent<?> event) {
        try {
            String body = objectMapper.writeValueAsString(event);

            PublishRequest request = PublishRequest.builder()
                .topicArn(topicArn)
                .message(body)
                .messageAttributes(Map.of(
                    "eventType", stringAttribute(event.eventType()),
                    "eventVersion", stringAttribute(String.valueOf(event.eventVersion())),
                    "producer", stringAttribute(event.producer())
                ))
                .build();

            PublishResponse response = snsClient.publish(request);

            return PublishResult.success(response.messageId());

        } catch (SnsException e) {
            return PublishResult.serviceFailure(
                e.awsErrorDetails().errorCode(),
                e.statusCode(),
                e.requestId(),
                e
            );
        } catch (SdkClientException e) {
            return PublishResult.clientFailure(e);
        } catch (JsonProcessingException e) {
            return PublishResult.serializationFailure(e);
        }
    }

    private static MessageAttributeValue stringAttribute(String value) {
        return MessageAttributeValue.builder()
            .dataType("String")
            .stringValue(value)
            .build();
    }
}
```

This is illustrative, not final production code. In a full implementation you would add validation, metrics, retry policy, tracing, timeout configuration, and outbox integration.

---

## 30. Java Consumer Architecture

A consumer should have layers.

```text
SQS polling adapter
  -> message envelope extractor
  -> SNS notification unwrap if raw delivery disabled
  -> event parser
  -> schema/version dispatcher
  -> idempotency guard
  -> domain handler
  -> ack/delete decision
```

### 30.1 SNS wrapped message

If raw message delivery is disabled, SQS receives an SNS notification envelope.

It contains fields like:

```json
{
  "Type": "Notification",
  "MessageId": "...",
  "TopicArn": "...",
  "Message": "{\"eventId\":\"...\"}",
  "Timestamp": "..."
}
```

Your consumer must unwrap `Message`.

If raw message delivery is enabled, the SQS body is the original SNS message body.

Choose intentionally and document it.

### 30.2 Handler dispatch

A consumer may subscribe to multiple event types.

Use explicit dispatch:

```java
public final class EventDispatcher {
    private final Map<String, EventHandler<?>> handlers;

    public HandlerResult dispatch(IntegrationEventEnvelope envelope) {
        EventHandler<?> handler = handlers.get(envelope.eventType());

        if (handler == null) {
            return HandlerResult.unsupportedEventType(envelope.eventType());
        }

        return handler.handle(envelope);
    }
}
```

Do not use reflection magic or class-name convention as the only routing mechanism in critical systems.

Explicit registration is easier to audit.

---

## 31. Event Filtering vs Consumer Dispatch

You can filter at SNS subscription level.

You can also dispatch inside the consumer.

Use both for different purposes.

SNS filtering:

```text
Reduce irrelevant messages delivered to a queue.
```

Consumer dispatch:

```text
Validate and route the events this consumer intentionally supports.
```

Do not rely only on SNS filtering.

A queue may receive unexpected messages due to:

- misconfigured filter;
- filter change;
- manual test publish;
- future event version;
- subscription migration;
- replay source.

Consumer must still validate.

---

## 32. Case Management Example

Imagine a regulatory case-management system.

Authoritative service:

```text
case-service
```

Event topic:

```text
prod-case-events-topic
```

Events:

```text
case.created.v1
case.submitted.v1
case.assigned.v1
case.escalated.v1
case.closed.v1
appeal.filed.v1
```

Subscribers:

```text
screening-service
notification-service
audit-service
sla-service
reporting-service
search-index-service
```

Topology:

```text
case-service
  -> outbox_event table
  -> outbox publisher
  -> prod-case-events-topic
       -> prod-screening-case-events-queue
       -> prod-notification-case-events-queue
       -> prod-audit-case-events-queue
       -> prod-sla-case-events-queue
       -> prod-reporting-case-events-queue
       -> prod-search-case-events-queue
```

### 32.1 Different consumers, different semantics

Screening:

```text
case.submitted.v1 -> request screening
```

Notification:

```text
case.submitted.v1 -> notify applicant
case.assigned.v1 -> notify officer
case.closed.v1 -> notify applicant
```

Audit:

```text
all events -> append audit trail
```

SLA:

```text
case.submitted.v1 -> start submission SLA clock
case.assigned.v1 -> start officer response SLA clock
case.closed.v1 -> stop active SLA timers
```

Reporting:

```text
selected events -> update reporting projection
```

Search:

```text
selected events -> update searchable index
```

Each subscriber can fail without blocking case submission.

But each subscriber must define its own correctness expectation.

Audit may be critical.

Search may be eventually consistent.

Notification may tolerate delayed retry.

SLA may require strict processing and alerting.

---

## 33. State Machine Safety

In case management, events should not blindly mutate state.

Consumers must protect state transitions.

Example SLA service states:

```text
NO_TIMER
ACTIVE
PAUSED
BREACHED
CLOSED
```

Events:

```text
case.submitted.v1 -> ACTIVE
case.escalated.v1 -> ACTIVE with higher priority
case.closed.v1 -> CLOSED
```

If `case.closed.v1` arrives twice:

```text
CLOSED -> CLOSED = no-op
```

If `case.submitted.v1` arrives after closed due to replay:

```text
CLOSED -> ACTIVE = invalid unless replay mode is rebuilding projection
```

Replay mode may have different rules than live mode.

Make this explicit.

---

## 34. Live Processing vs Rebuild Processing

A projection consumer may have two modes:

1. live mode;
2. rebuild mode.

Live mode:

```text
Process events as they arrive from queue.
Reject impossible transitions.
Emit alerts for anomalies.
```

Rebuild mode:

```text
Read historical events from archive.
Apply deterministic projection rebuild.
Ignore side effects like email sending.
```

Do not use the same handler blindly for both.

Notification handlers especially should not send old emails during replay.

Design handler side effects carefully:

| Consumer | Replay behavior |
|---|---|
| Audit | Usually append/rebuild with caution |
| Search index | Rebuild allowed |
| Reporting | Rebuild allowed |
| Notification | Usually suppress external sends |
| SLA | Recompute or rebuild state, not trigger old escalation blindly |
| Screening | Usually do not rerun automatically unless explicitly requested |

---

## 35. Event-Driven Architecture Decision Matrix

Use SNS + SQS when:

| Requirement | SNS + SQS Fit |
|---|---|
| Multiple independent consumers need same event | Strong |
| Consumer downtime should not block producer | Strong |
| Consumer-specific retry/DLQ needed | Strong |
| High throughput async integration | Strong |
| Simple queue-to-one-worker command | SQS alone may be enough |
| Complex event routing by content | SNS filter or EventBridge |
| Long-running workflow state | Use workflow/state machine |
| Strict request-response result needed | Use sync call or async command with status |
| Global ordering required | Usually poor fit |
| Per-aggregate ordering | FIFO can fit |
| Full event replay as product feature | Need archive/event store |

---

## 36. Common Anti-Patterns

### 36.1 One topic for everything

```text
enterprise-events-topic
```

All systems publish everything.

All consumers filter everything.

Problems:

- unclear ownership;
- schema chaos;
- security classification mixing;
- difficult permission boundary;
- noisy filtering;
- hard incident blast-radius control.

### 36.2 One queue for many unrelated consumers

This breaks fan-out semantics.

Use one queue per logical subscriber.

### 36.3 Events as database row dumps

Bad:

```json
{
  "caseTableRow": {
    "col1": "...",
    "col2": "...",
    "internalFlag17": "..."
  }
}
```

This couples consumers to internal schema.

Publish meaningful integration events.

### 36.4 No event ID

Without event ID, deduplication and tracing become weak.

Every event needs stable identity.

### 36.5 No DLQ owner

A DLQ without owner is silent data loss with extra steps.

### 36.6 Retry forever

Infinite retry can block progress and hide poison messages.

Use bounded receive attempts and DLQ.

### 36.7 Breaking schema in place

Changing a published event without compatibility plan breaks consumers.

Version contracts.

### 36.8 Event chain as hidden workflow

If business process state matters, model it explicitly.

Do not rely on scattered handlers as the only source of truth.

---

## 37. Production Checklist

### 37.1 Producer checklist

- [ ] Event has stable `eventId`.
- [ ] Event has explicit `eventType`.
- [ ] Event has schema version.
- [ ] Event has `occurredAt`.
- [ ] Event has `correlationId`.
- [ ] Event payload does not leak secrets.
- [ ] Event is an integration contract, not internal entity dump.
- [ ] Publisher uses AWS SDK client reuse.
- [ ] Publish timeout/retry is configured.
- [ ] Publish failure is observable.
- [ ] Outbox exists if domain commit and event publication must be consistent.
- [ ] Event schema is documented.
- [ ] Event owner is documented.

### 37.2 SNS checklist

- [ ] Topic name matches domain/event family.
- [ ] Topic policy is least privilege.
- [ ] KMS encryption is configured if needed.
- [ ] Subscription filters are documented.
- [ ] Subscription DLQ exists where relevant.
- [ ] Delivery failures are monitored.
- [ ] Cross-account subscriptions are explicit and reviewed.

### 37.3 SQS subscriber checklist

- [ ] One queue per logical subscriber.
- [ ] Queue policy only allows expected SNS topic.
- [ ] Visibility timeout matches handler behavior.
- [ ] DLQ is configured.
- [ ] `maxReceiveCount` is intentional.
- [ ] Queue retention supports recovery window.
- [ ] Consumer is idempotent.
- [ ] Unsupported event versions are handled safely.
- [ ] Duplicate count is monitored.
- [ ] Oldest message age alarm exists.
- [ ] DLQ alarm exists.
- [ ] Redrive runbook exists.

### 37.4 Consumer checklist

- [ ] SNS envelope handling is explicit.
- [ ] Event parser validates required fields.
- [ ] Handler dispatch is explicit.
- [ ] Idempotency store exists for side-effecting consumers.
- [ ] Domain transition guards exist.
- [ ] Logs include event metadata.
- [ ] Metrics include event age.
- [ ] Handler distinguishes retryable vs non-retryable failure.
- [ ] Replay mode is defined.
- [ ] External side effects are replay-safe or suppressed.

---

## 38. Design Exercise

Design an SNS + SQS topology for this scenario:

```text
A case is submitted.
The system must:
1. start screening;
2. notify applicant;
3. create audit trail;
4. start SLA timer;
5. update search index;
6. update reporting projection.
```

Questions:

1. What is the event type?
2. Which service owns the event?
3. What topic should it be published to?
4. Which queues are needed?
5. Which consumers are critical?
6. Which consumers can be eventually consistent?
7. Which consumers need idempotency table?
8. Which consumers should suppress side effects during replay?
9. What is the ordering key?
10. What should go to DLQ?
11. What should be archived?
12. How would you redrive safely?
13. What metrics prove the system is healthy?
14. What logs prove a specific case was processed?
15. What event schema changes are safe?

A strong engineer answers these before writing code.

---

## 39. Summary

SNS + SQS is one of the most useful AWS integration patterns for Java backend systems.

The essence:

```text
SNS = distribution boundary.
SQS = consumption and reliability boundary.
```

The strongest design is usually:

```text
Producer
  -> outbox
  -> SNS domain topic
  -> one SQS queue per logical subscriber
  -> idempotent consumers
  -> DLQ and archive
  -> observable replay
```

But SNS + SQS is not a workflow engine.

It should not hide business state.

For top-tier engineering, focus on invariants:

- every event has identity;
- every consumer is idempotent;
- every queue has owner;
- every DLQ has a runbook;
- every schema has versioning;
- every replay is safe;
- every critical event is observable;
- every business state transition is guarded.

The best event-driven systems are not the ones with the most queues.

They are the ones where the failure behavior is explicit.

---

## 40. References

- AWS Documentation — Fanout Amazon SNS notifications to Amazon SQS queues: https://docs.aws.amazon.com/sns/latest/dg/sns-sqs-as-subscriber.html
- AWS Documentation — Amazon SNS dead-letter queues: https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html
- AWS Documentation — Amazon SNS message filtering: https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html
- AWS Documentation — Amazon SNS message delivery retries: https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html
- AWS Documentation — Amazon SQS queue types: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-queue-types.html
- AWS Documentation — Amazon SQS FIFO queues: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fifo-queues.html
- AWS Documentation — Using dead-letter queues in Amazon SQS: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html
- AWS Documentation — Event-driven architectures, Serverless Applications Lens: https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/event-driven-architectures.html
- AWS Documentation — Creating event-driven architectures with Lambda: https://docs.aws.amazon.com/lambda/latest/dg/concepts-event-driven-architectures.html
- AWS Prescriptive Guidance — Transactional outbox pattern: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html
- AWS Prescriptive Guidance — Event sourcing pattern: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/event-sourcing.html
- AWS SDK for Java 2.x Developer Guide: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/home.html
