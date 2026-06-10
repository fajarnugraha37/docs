# Strict General Standards: Event Design

> This document is a mandatory implementation standard for LLM/code agents designing, modifying, reviewing, or generating domain events, integration events, event schemas, event topics, event consumers, event producers, event streams, or event-driven workflows.

---

## 1. Purpose

Event design is about communicating facts that already happened in a way that remains reliable, interpretable, replayable, auditable, and evolvable across time.

An LLM/code agent MUST treat events as durable integration contracts, not as convenient asynchronous method calls.

The goal is to ensure that every generated event is:

- semantically clear;
- safe for retries and duplicate delivery;
- versioned and evolvable;
- observable end to end;
- owned by the correct domain boundary;
- decoupled from private implementation details;
- useful for both operational processing and forensic reconstruction.

---

## 2. Scope

This standard applies to:

- domain events;
- integration events;
- event-carried state transfer;
- event notification;
- outbox events;
- inbox/deduplication records;
- CDC-derived events;
- Kafka topics, queues, streams, event buses, and broker channels;
- CloudEvents-style message envelopes;
- AsyncAPI documentation for event-driven APIs;
- event schema evolution;
- event consumers and projectors;
- event replay and backfill;
- DLQ and poison-message handling;
- event auditability and observability.

This standard does not define command design. Use `strict-general-standards__command_design.md` for requests that ask a system to perform an action.

---

## 3. Mandatory Language

The terms below are normative:

- **MUST**: required.
- **MUST NOT**: prohibited.
- **SHOULD**: recommended unless there is documented justification.
- **MAY**: optional, but must not violate mandatory rules.

---

## 4. Core Principle

> An event MUST describe a meaningful fact that has already occurred, not an instruction, intention, query, or internal callback.

Good event names:

```text
CaseCreated
CaseAssigned
CaseSubmitted
PaymentAuthorized
LicenceSuspended
DocumentVirusScanCompleted
```

Bad event names:

```text
CreateCase
AssignCase
SubmitCase
CallPaymentService
UpdateLicenceStatus
RunVirusScan
```

A valid event sentence should read naturally as:

```text
"This happened: <event name>."
```

If the sentence reads like an instruction, the design probably needs a command, not an event.

---

## 5. Event vs Command vs Query Boundary

LLM/code agents MUST classify every message before implementation.

| Message type | Meaning                 | Time orientation | Expected receiver              | Return value             |
| ------------ | ----------------------- | ---------------: | ------------------------------ | ------------------------ |
| Command      | Request to do something |           Future | Usually one handler/owner      | Accepted/rejected/result |
| Event        | Fact that happened      |             Past | Zero, one, or many subscribers | No direct return         |
| Query        | Request for information |     Present/past | Read model/service             | Data response            |

### Required Decision Rule

Use an event when:

- the state transition has already been committed;
- the producer does not own or control all consumers;
- multiple downstream reactions may exist;
- consumers can be added without changing the producer;
- eventual consistency is acceptable or explicitly modeled.

Use a command when:

- the sender wants a specific action performed;
- the receiver must accept or reject the request;
- the outcome must be known by the sender;
- the message targets one logical owner.

Use a query when:

- no state mutation is requested;
- the sender needs data, not a side effect.

---

## 6. Event Ownership

Every event type MUST have exactly one owning domain/application boundary.

The owner is responsible for:

- event name;
- schema;
- versioning;
- lifecycle semantics;
- publication timing;
- compatibility guarantees;
- retention policy;
- deprecation policy;
- documentation;
- contract tests.

Consumers MUST NOT redefine the meaning of an event. If consumers need a different representation, they MUST build a local projection/read model.

---

## 7. Event Type Categories

### 7.1 Domain Event

A domain event is emitted inside a bounded context to represent a business-significant state transition.

Examples:

```text
CaseSubmitted
InspectionScheduled
LicenceRevoked
AppealFiled
```

Domain events SHOULD be named in ubiquitous language.

### 7.2 Integration Event

An integration event is published across service or system boundaries.

It MUST be stable, documented, versioned, and stripped of private domain implementation details.

### 7.3 Notification Event

A notification event tells consumers that something happened and they may fetch details from the owner.

It SHOULD contain minimal data:

```json
{
  "caseId": "CASE-123",
  "occurredAt": "2026-06-10T09:00:00Z"
}
```

Use notification events when payload sensitivity, schema volatility, or data size makes event-carried state unsafe.

### 7.4 Event-Carried State Transfer

An event-carried state transfer event includes enough state for consumers to update their local read model without querying the producer.

It SHOULD be used when:

- consumers need low-latency local projections;
- producer availability should not block consumers;
- data is safe to distribute;
- schema compatibility can be governed.

### 7.5 CDC Event

A CDC event is derived from database changes.

CDC events MUST NOT leak raw table structure as public integration contracts unless explicitly approved. A raw CDC stream is usually an infrastructure feed, not a domain event.

---

## 8. Event Naming Rules

Event names MUST:

- be past tense;
- represent a completed fact;
- use domain language;
- avoid transport names;
- avoid consumer-specific naming;
- avoid UI-specific naming;
- avoid technical CRUD-only names unless the business domain is actually CRUD.

Good:

```text
CaseAssignmentChanged
DocumentUploaded
PaymentCaptureFailed
ComplianceBreachDetected
```

Bad:

```text
CaseUpdateMessage
KafkaCasePayload
SendEmailEvent
ButtonClickedEvent
DatabaseRowChanged
```

### 8.1 Avoid Ambiguous Generic Events

The following names are usually prohibited:

```text
EntityUpdated
DataChanged
StatusChanged
ObjectModified
MessageCreated
```

Exception: generic change events MAY exist for internal infrastructure streams, but MUST NOT be used as business integration events without a typed discriminator and schema governance.

---

## 9. Event Envelope Standard

Every integration event MUST have a stable envelope.

Recommended envelope fields:

```json
{
  "id": "01J...",
  "type": "com.example.case.CaseSubmitted.v1",
  "source": "case-service",
  "subject": "case/CASE-123",
  "time": "2026-06-10T09:00:00Z",
  "specversion": "1.0",
  "datacontenttype": "application/json",
  "dataschema": "https://schemas.example.com/case-submitted.v1.json",
  "traceparent": "00-...",
  "correlationId": "...",
  "causationId": "...",
  "tenantId": "...",
  "producer": "case-service",
  "schemaVersion": 1,
  "data": {}
}
```

The envelope SHOULD align with CloudEvents where practical.

### 9.1 Required Envelope Fields

Every event MUST include:

- globally unique event ID;
- event type;
- event version or versioned type;
- producer/source;
- occurrence timestamp;
- payload/data;
- correlation ID or trace context;
- subject/aggregate identifier where applicable.

### 9.2 Event ID

Event IDs MUST be unique and stable across retries.

The producer MUST NOT generate a new event ID for the same logical event publication retry.

### 9.3 Occurred At vs Published At

The event MUST distinguish when the business fact occurred from when the event was published if these can differ.

Recommended:

```json
{
  "occurredAt": "2026-06-10T09:00:00Z",
  "publishedAt": "2026-06-10T09:00:03Z"
}
```

### 9.4 Correlation and Causation

Events SHOULD include:

- `correlationId`: ties a business journey together;
- `causationId`: identifies the command/event/request that caused this event;
- `traceparent`: enables distributed tracing.

---

## 10. Payload Design Rules

Event payloads MUST contain stable business facts, not ORM objects, API DTOs, UI view models, or internal table rows.

### 10.1 Required Payload Properties

For aggregate lifecycle events, payloads SHOULD include:

- aggregate ID;
- aggregate type;
- aggregate version;
- event-specific facts;
- actor or initiator where legally/audit relevant;
- reason code where relevant;
- effective date/time where relevant.

Example:

```json
{
  "caseId": "CASE-123",
  "caseVersion": 7,
  "submittedBy": "user-456",
  "submissionChannel": "PORTAL",
  "submittedAt": "2026-06-10T09:00:00Z"
}
```

### 10.2 Payload Minimality

Events MUST NOT include data just because it is convenient.

Each payload field MUST satisfy at least one purpose:

- required by consumers to make a decision;
- required to update a projection;
- required for audit/reconstruction;
- required to preserve event meaning over time.

### 10.3 Sensitive Data

Events MUST NOT contain secrets, credentials, access tokens, refresh tokens, private keys, or raw passwords.

PII, financial data, health data, or regulatory sensitive data MAY be included only when:

- there is a documented consumer need;
- data classification allows distribution;
- retention is defined;
- encryption/access controls are enforced;
- redaction strategy exists;
- deletion/legal hold behavior is understood.

### 10.4 Snapshot vs Delta

The design MUST explicitly choose one of:

- delta event: only what changed;
- snapshot event: current relevant state after change;
- notification event: identifier only, consumers fetch current state.

Delta events are compact but require careful ordering and replay semantics.

Snapshot events are easier for projections but larger and may expose more data.

Notification events reduce event coupling but increase producer read load.

---

## 11. Event Schema Rules

Every public integration event MUST have a schema.

The schema MUST define:

- required fields;
- optional fields;
- field types;
- enum values;
- string formats;
- date/time timezone rules;
- numeric precision;
- semantic descriptions;
- compatibility expectations;
- example messages.

### 11.1 Schema Compatibility

Schema evolution MUST be backward compatible unless a new event type/version is introduced.

Safe changes usually include:

- adding optional fields;
- adding enum values only if consumers tolerate unknown values;
- widening descriptions without changing semantics;
- adding metadata fields.

Unsafe changes include:

- removing fields;
- renaming fields;
- changing field type;
- changing field meaning;
- making optional fields required;
- changing identifier format;
- changing event timing semantics;
- changing ordering guarantees.

### 11.2 Versioning Strategy

Event versioning MUST be explicit.

Allowed strategies:

```text
com.example.case.CaseSubmitted.v1
```

```json
{
  "type": "CaseSubmitted",
  "schemaVersion": 1
}
```

The type-version strategy is preferred for broker routing and schema registry compatibility.

### 11.3 Unknown Field Handling

Consumers MUST ignore unknown fields unless explicitly configured as strict validators for owned internal streams.

### 11.4 Unknown Enum Handling

Consumers MUST handle unknown enum values safely.

Bad:

```text
switch(status) with no default fallback.
```

Good:

```text
Unknown status -> store raw value, mark projection partial, alert if business-critical.
```

---

## 12. Topic, Stream, and Channel Design

Topic/channel names MUST reflect ownership, domain, and event family.

Recommended pattern:

```text
<environment>.<domain>.<event-family>[.<version>]
```

Example:

```text
prod.case.lifecycle.v1
prod.document.scan.v1
prod.payment.authorization.v1
```

### 12.1 Topic Design Rules

Topics MUST NOT be created per consumer.

Topics MUST NOT be created per event instance.

Topics SHOULD be stable and coarse enough for operational manageability, but specific enough to avoid unrelated consumers reading unrelated sensitive data.

### 12.2 Partition Key Rules

For ordered aggregate events, partition key MUST be the aggregate ID.

Examples:

```text
caseId
licenceId
paymentId
inspectionId
```

Do not use random event ID as partition key when aggregate ordering matters.

### 12.3 Ordering Scope

The design MUST document ordering scope:

- no ordering guaranteed;
- ordering per aggregate;
- ordering per tenant;
- ordering per partition;
- global ordering.

Global ordering SHOULD be avoided unless strictly required and justified.

---

## 13. Publication Rules

Events MUST be published only after the business state transition has been successfully committed, unless using event sourcing where the event itself is the commit record.

### 13.1 Transactional Outbox

If a service writes to a database and publishes an event, it MUST use one of:

- transactional outbox;
- CDC outbox;
- broker transaction coordinated with state store where technically valid;
- another documented atomicity mechanism.

Direct dual-write is prohibited.

Bad:

```text
1. Save order to DB.
2. Publish OrderCreated to broker.
3. Hope both succeed.
```

Good:

```text
1. In one DB transaction: save order + insert outbox row.
2. Relay publishes outbox row.
3. Mark outbox row as published or rely on idempotent publication.
```

### 13.2 Publication Timing

Events MUST NOT be published before transaction commit.

Events MUST NOT be published from uncommitted domain state.

Events MUST NOT be published from inside a transaction if publication failure can leave DB locks open or create long-running transactions.

---

## 14. Consumer Rules

Consumers MUST be designed for at-least-once delivery unless the broker and end-to-end architecture prove stronger guarantees.

Therefore, every consumer MUST be:

- idempotent;
- retry-safe;
- order-aware;
- duplicate-aware;
- poison-message-aware;
- observable.

### 14.1 Idempotent Consumer

A consumer MUST tolerate receiving the same event more than once.

Allowed approaches:

- processed-event table keyed by event ID;
- aggregate version check;
- natural idempotency key;
- upsert with monotonic version;
- deterministic projection update.

Example:

```sql
INSERT INTO processed_event(event_id, consumer_name, processed_at)
VALUES (:eventId, :consumerName, now())
ON CONFLICT DO NOTHING;
```

### 14.2 Consumer Offset Commit

Consumers MUST commit offsets/acknowledgements only after processing is durable enough for the required guarantee.

Bad:

```text
Ack message before database update commits.
```

Good:

```text
Process event -> persist projection/dedup state -> commit offset.
```

### 14.3 Consumer Side Effects

If a consumer performs external side effects, it MUST define idempotency for those side effects.

Examples:

- email send dedupe key;
- payment idempotency key;
- document generation request ID;
- outbound webhook event ID.

---

## 15. Retry, DLQ, and Poison Message Rules

### 15.1 Retry Rules

Retries MUST be bounded, observable, and classified by failure type.

Retryable:

- transient network failure;
- temporary downstream unavailability;
- broker rebalance;
- timeout with safe idempotency.

Not retryable without repair:

- schema validation failure;
- missing required field;
- unauthorized access;
- unknown event type;
- impossible state transition;
- corrupted payload.

### 15.2 Dead Letter Queue

A DLQ MUST preserve:

- original message;
- original headers;
- failure reason;
- stack/error code;
- consumer name;
- attempt count;
- first failure time;
- last failure time;
- trace/correlation IDs.

A DLQ MUST have an operational owner and replay procedure.

### 15.3 Poison Message Handling

Consumers MUST NOT block an entire partition indefinitely on a poison message without a documented quarantine strategy.

---

## 16. Replay and Backfill Rules

Events that may be replayed MUST be designed for replay safety.

Replay-capable consumers MUST separate:

- live processing;
- projection rebuild;
- historical backfill;
- side-effect execution.

During replay, consumers MUST NOT resend external side effects unless explicitly intended.

Bad:

```text
Replaying UserRegistered sends welcome email again.
```

Good:

```text
Projection rebuild mode updates read model only; side effects are disabled or deduped.
```

---

## 17. Event Sourcing Rules

Event sourcing MUST NOT be introduced by default.

It MAY be used when:

- full state history is a business requirement;
- audit/reconstruction is central;
- state transitions are complex and valuable as first-class facts;
- projections can be rebuilt;
- team can manage schema evolution and replay operations.

Event sourcing MUST include:

- aggregate stream ID;
- stream version;
- optimistic concurrency control;
- event upcasting/versioning;
- snapshot strategy where needed;
- projection rebuild process;
- privacy/deletion/legal hold model;
- operational replay controls.

Prohibited:

```text
Using event sourcing only because it sounds scalable.
```

```text
Treating event store as a normal mutable CRUD database.
```

---

## 18. State Machine Event Rules

For lifecycle-heavy domains, events MUST align with valid state transitions.

Example:

```text
DRAFT -> SUBMITTED emits CaseSubmitted
SUBMITTED -> ASSIGNED emits CaseAssigned
ASSIGNED -> CLOSED emits CaseClosed
```

Events MUST NOT create impossible transitions.

Consumers SHOULD validate aggregate version or transition monotonicity when processing state-changing events.

---

## 19. Security Rules

Event systems MUST enforce security at all layers:

- producer authorization;
- consumer authorization;
- topic ACLs;
- schema registry permissions;
- encryption in transit;
- encryption at rest where required;
- sensitive payload minimization;
- tenant isolation;
- audit logging;
- replay permission controls.

Events MUST NOT be treated as safe just because they are internal.

---

## 20. Multi-Tenancy Rules

Multi-tenant event payloads MUST include tenant context when required for authorization, routing, storage, or audit.

Tenant ID MUST be trustworthy. A consumer MUST NOT trust a tenant ID blindly if it comes from an untrusted producer or external event source.

Cross-tenant event leakage is a critical security defect.

---

## 21. Observability Rules

Every event producer and consumer MUST emit logs/metrics/traces for:

- event published count;
- event consumed count;
- processing latency;
- publication lag;
- consumer lag;
- retry count;
- DLQ count;
- schema validation failure;
- dedup hit count;
- processing duration;
- downstream side-effect outcome.

Logs MUST include:

- event ID;
- event type;
- correlation ID;
- causation ID where present;
- aggregate ID;
- consumer/producer name;
- outcome.

Logs MUST NOT expose sensitive payload fields.

---

## 22. Documentation Rules

Every public event MUST be documented with:

- event name;
- description;
- producer;
- owning team/service;
- topic/channel;
- payload schema;
- sample event;
- partition key;
- ordering guarantee;
- delivery guarantee;
- retention period;
- replay behavior;
- compatibility policy;
- known consumers;
- security classification;
- deprecation policy.

AsyncAPI SHOULD be used for event-driven API contracts when practical.

---

## 23. Testing Requirements

Generated event-driven implementation MUST include tests for:

- schema validation;
- serialization/deserialization;
- backward compatibility;
- idempotent consumer behavior;
- duplicate delivery;
- out-of-order delivery;
- retryable failure;
- non-retryable failure;
- DLQ routing;
- offset/ack timing;
- projection rebuild;
- security/authorization where applicable.

Contract tests MUST verify that producers and consumers agree on schema and semantics.

---

## 24. Anti-Patterns

### 24.1 Event as Command

Bad:

```text
SendWelcomeEmailEvent
CreateInvoiceEvent
RecalculateScoreEvent
```

These are commands disguised as events.

### 24.2 CRUD Event Flood

Bad:

```text
UserUpdated
CaseUpdated
RecordChanged
```

without semantic meaning.

Prefer:

```text
UserEmailChanged
CasePriorityChanged
CaseSubmitted
```

### 24.3 Shared DTO Event

Bad:

```text
Publishing the same DTO used by REST response or ORM entity.
```

Events are long-lived contracts. DTOs and entities are implementation details.

### 24.4 Dual Write

Bad:

```text
DB write and broker publish as two independent operations.
```

Use outbox or another atomicity strategy.

### 24.5 Consumer Coupled to Producer Database

Bad:

```text
Consumer receives event then joins producer database tables directly.
```

This violates ownership and creates distributed coupling.

### 24.6 Assuming Exactly Once End to End

Bad:

```text
No idempotency because Kafka/SQS/RabbitMQ will handle it.
```

End-to-end exactly-once is rare and must be proven across producer, broker, consumer, and side effects.

### 24.7 Infinite Retry Loop

Bad:

```text
Retry malformed event forever.
```

Classify, quarantine, alert, and repair.

### 24.8 Event Without Owner

Bad:

```text
No team/service owns the schema or compatibility contract.
```

Ownerless events decay into integration hazards.

---

## 25. Required LLM Workflow

When asked to design or implement events, the LLM/code agent MUST follow this sequence:

1. Classify message as command, event, or query.
2. Identify event owner.
3. Name event in past tense domain language.
4. Define producer state transition that emits it.
5. Define payload purpose and sensitivity.
6. Define envelope metadata.
7. Define schema and compatibility rules.
8. Define topic/channel and partition key.
9. Define ordering and delivery guarantees.
10. Define publication atomicity mechanism.
11. Define consumer idempotency and retry behavior.
12. Define DLQ/replay/backfill behavior.
13. Define observability and audit fields.
14. Add tests and documentation.

If any item is unknown, document assumptions instead of silently inventing behavior.

---

## 26. Event Design Template

```md
# Event: <PastTenseEventName>

## Meaning

<Business fact that happened.>

## Owner

<Service/team/bounded context.>

## Producer

<Producer component.>

## Trigger

<State transition or committed operation that emits this event.>

## Topic/Channel

<topic-name>

## Partition Key

<aggregate-id or documented alternative>

## Ordering Guarantee

<none/per aggregate/per tenant/etc.>

## Delivery Guarantee

<at-least-once/etc.>

## Envelope

<CloudEvents-compatible metadata or project envelope.>

## Payload Schema

<JSON Schema/Avro/Protobuf/etc.>

## Compatibility Policy

<Backward/forward/full/new major version.>

## Consumers

<Known consumers and expected use.>

## Idempotency

<Producer and consumer dedupe strategy.>

## Retry/DLQ

<Retry classification and DLQ handling.>

## Security Classification

<Data sensitivity and ACL requirements.>

## Replay Behavior

<Safe/not safe; side effects disabled/enabled.>
```

---

## 27. Review Checklist

Before approving event design, verify:

- [ ] Event name is past tense and domain meaningful.
- [ ] Event is not a disguised command.
- [ ] Owner is clear.
- [ ] Schema exists.
- [ ] Versioning strategy exists.
- [ ] Payload avoids private implementation details.
- [ ] Sensitive data is minimized and classified.
- [ ] Event ID is stable across retries.
- [ ] Correlation/causation/trace metadata exists.
- [ ] Topic/channel is documented.
- [ ] Partition key supports required ordering.
- [ ] Publication atomicity avoids dual-write.
- [ ] Consumers are idempotent.
- [ ] Retry/DLQ behavior exists.
- [ ] Replay/backfill behavior is documented.
- [ ] Observability exists.
- [ ] Contract tests exist.

---

## 28. Acceptance Criteria

An event design is acceptable only if:

1. It represents a completed business fact.
2. It has a clear owner and producer.
3. It has a stable, versioned schema.
4. It defines envelope metadata.
5. It avoids leaking internal implementation models.
6. It defines topic, partitioning, ordering, and retention.
7. It is safe under retries and duplicate delivery.
8. It avoids dual-write inconsistency.
9. It defines DLQ and replay behavior.
10. It is observable and auditable.
11. It includes tests for compatibility and failure modes.

---

## 29. Enforcement Snippet for LLM/Code Agent

```text
Before generating event-driven code, classify every message as Command, Event, or Query.
Only generate an Event when it represents a past-tense fact that has already occurred.
Every event must have an owner, versioned schema, stable event ID, correlation metadata, topic/channel, partition key, delivery guarantee, idempotent consumer behavior, retry/DLQ handling, and observability.
Never publish ORM entities, REST DTOs, secrets, or ambiguous CRUD events as integration events.
Never implement DB write + broker publish as an unsafe dual-write.
```

---

## 30. References

- CloudEvents Specification: https://github.com/cloudevents/spec
- CloudEvents project site: https://cloudevents.io/
- AsyncAPI Initiative: https://www.asyncapi.com/
- Enterprise Integration Patterns: Event Message: https://www.enterpriseintegrationpatterns.com/patterns/messaging/EventMessage.html
- Enterprise Integration Patterns: Message Channel: https://www.enterpriseintegrationpatterns.com/patterns/messaging/MessageChannel.html
- Microservices.io: Transactional Outbox: https://microservices.io/patterns/data/transactional-outbox.html
- AWS Prescriptive Guidance: Transactional Outbox Pattern: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html
- Azure Architecture Center: Saga Pattern: https://learn.microsoft.com/en-us/azure/architecture/patterns/saga
- Confluent: Kafka Message Delivery Guarantees: https://docs.confluent.io/kafka/design/delivery-semantics.html
