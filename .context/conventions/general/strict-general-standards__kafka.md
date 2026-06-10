# Strict General Standards: Kafka

> Mandatory conventions for LLMs, code agents, and engineers when designing, implementing, reviewing, or modifying Apache Kafka based systems.

---

## 0. Purpose

Kafka must be treated as a distributed commit log and event streaming platform, not as a generic queue, not as an RPC transport, and not as an invisible implementation detail.

This standard exists to force every LLM-generated Kafka implementation to preserve:

- event semantics;
- ordering assumptions;
- partitioning correctness;
- consumer group behavior;
- delivery guarantees;
- schema compatibility;
- replay safety;
- operational observability;
- failure recoverability;
- security boundaries;
- long-term topic ownership.

Kafka code is only acceptable when the generated implementation explicitly handles producer safety, consumer idempotency, offset ownership, error handling, dead-letter strategy, and topic lifecycle.

---

## 1. Core Mental Model

Kafka is a distributed append-only log partitioned by topic partition.

A Kafka topic is not a table.  
A Kafka event is not a function call.  
A Kafka consumer is not a worker thread only.  
A Kafka partition key is not a random distribution trick only.  
A Kafka offset is not business state.  
A Kafka retry is not a replacement for idempotency.

The required mental model is:

```text
Producer -> Topic -> Partition -> Ordered Log -> Consumer Group -> Consumer Instance -> Handler -> Side Effect
```

Each record has two different meanings:

1. **Transport meaning**: topic, partition, offset, timestamp, headers, key, value.
2. **Domain meaning**: what fact happened, for which aggregate, at what business time, under which actor/context.

Both meanings must be explicit.

---

## 2. Scope

This standard applies to:

- Kafka producers;
- Kafka consumers;
- Kafka Streams applications;
- topic creation;
- schema registry usage;
- event contract design;
- transactional outbox/inbox;
- retry topics;
- DLQ topics;
- compacted topics;
- CDC pipelines;
- audit/event streaming;
- integration events;
- stream processing;
- deployment and operations.

It does not replace the more general event design standard. It specializes it for Kafka-specific behavior.

---

## 3. Non-Negotiable Rules

### 3.1 Kafka Must Not Be Used Without a Justification

Before generating Kafka code, the LLM must state why Kafka is appropriate.

Acceptable reasons include:

- multiple independent consumers need the same event stream;
- replay is required;
- ordered processing per key is required;
- high-throughput event ingestion is required;
- stream processing is required;
- event history retention is valuable;
- CDC/outbox integration is required;
- decoupled async integration is required.

Unacceptable reasons include:

- "microservices need Kafka";
- "we need async, so Kafka";
- "we want faster API responses";
- "we do not want to call another service";
- "we need a queue" without replay/streaming requirements.

### 3.2 Kafka Is Not a Replacement for Database Transactions

LLMs must not use Kafka to hide missing transactional boundaries.

If a database write and event publication must happen atomically, use one of:

- transactional outbox;
- Kafka transactions with clear scope;
- CDC from an outbox table;
- idempotent recovery flow.

Never generate this pattern:

```text
1. write database
2. publish Kafka event
3. hope both succeed
```

This is a dual-write bug.

### 3.3 Every Topic Must Have an Owner

Each topic must declare:

- owning service/team;
- event type family;
- retention policy;
- compaction policy if any;
- key semantics;
- schema compatibility mode;
- expected consumers;
- PII/sensitivity classification;
- replay policy;
- deprecation policy.

A topic without ownership is not allowed.

### 3.4 Every Consumer Must Be Idempotent

Kafka consumers must assume at-least-once delivery unless a stronger end-to-end guarantee is explicitly proven.

Every consumer that performs side effects must implement one of:

- processed-event table keyed by event id;
- idempotent upsert by natural/business key;
- monotonic aggregate version check;
- idempotency key on downstream call;
- compare-and-set / optimistic version control;
- transactional inbox.

Offset commit alone is not idempotency.

### 3.5 Ordering Must Be Scoped

Kafka does not provide global ordering across partitions.

LLM-generated designs must state ordering scope:

- per aggregate id;
- per tenant id;
- per account id;
- per workflow id;
- per topic partition only;
- no ordering guarantee required.

If order matters, the partition key must be the key that defines ordering.

### 3.6 Partition Key Must Be a Design Decision

The partition key must not be randomly chosen.

A valid partition key must balance:

- ordering requirements;
- consumer parallelism;
- hot-key risk;
- tenant isolation;
- replay locality;
- compaction semantics;
- future scaling.

Examples:

| Use Case                |                                       Likely Key | Reason                                                      |
| ----------------------- | -----------------------------------------------: | ----------------------------------------------------------- |
| Order events            |                                        `orderId` | preserves per-order ordering                                |
| User lifecycle events   |                                         `userId` | preserves per-user ordering                                 |
| Tenant audit stream     |              `tenantId` + shard suffix if needed | controls tenant-level locality while avoiding hot partition |
| Price update by product |                                      `productId` | compactable latest-state semantics                          |
| High-volume clickstream | stable session/user key or explicit sharding key | avoids random ordering loss where correlation matters       |

### 3.7 Event Payload Must Not Depend on Consumer Database Access

An event must contain enough information for consumers to process safely.

Do not publish an event that only says:

```json
{
  "id": "123"
}
```

unless the contract explicitly says consumers must query the owning service and the failure/coupling trade-off is accepted.

Prefer event-carried state transfer for stable integration facts.

### 3.8 Consumers Must Not Assume They Are the Only Consumer

A topic can have multiple consumer groups.

LLMs must avoid consumer-specific payloads in shared topics. If one consumer needs private data or private retry behavior, use:

- a separate topic;
- a consumer-specific projection;
- a routing/enrichment service;
- consumer-local retry topic.

### 3.9 Retention Must Be Explicit

Every topic must define retention based on business/operational use:

- short retention for transient commands/retries;
- longer retention for integration events;
- compacted retention for latest state topics;
- archival pipeline for compliance/audit events.

Do not rely on broker defaults.

### 3.10 Schema Evolution Must Be Designed Before Publishing

Every external/shared Kafka topic must use a schema strategy:

- Avro, Protobuf, or JSON Schema;
- schema registry or equivalent governance;
- compatibility mode;
- semantic versioning policy;
- deprecation strategy;
- field ownership;
- unknown-field tolerance.

Do not publish arbitrary ad-hoc JSON for shared topics.

---

## 4. Kafka vs Queue Decision Gate

Use Kafka when:

- event history matters;
- replay matters;
- fan-out to multiple independent consumers matters;
- stream processing matters;
- ordered processing per key matters;
- consumers should pull at their own pace;
- retention is independent of consumer acknowledgement;
- the system benefits from log semantics.

Use a queue/broker such as RabbitMQ when:

- work distribution is the primary goal;
- messages should disappear after successful processing;
- per-message routing semantics are important;
- request/reply and task queues dominate;
- delayed/dead-letter routing is central;
- replay is not a central requirement.

If the generated design says "Kafka queue", it must be rejected unless the semantics are explicitly clarified.

---

## 5. Topic Design Standards

### 5.1 Topic Naming

Topic names must be stable, descriptive, and contract-oriented.

Recommended pattern:

```text
<domain>.<entity-or-capability>.<event-family>[.<version>]
```

Examples:

```text
licensing.application.events.v1
enforcement.case.events.v1
payment.invoice.events.v1
identity.user-profile.compacted.v1
integration.crm.customer-events.v1
```

Avoid:

```text
events
messages
data
service-a-topic
temp-topic
new-topic
kafka-test
```

### 5.2 Topic Granularity

A topic should group related events with compatible:

- partition key;
- ordering requirement;
- retention requirement;
- access control;
- schema evolution policy;
- consumer population;
- throughput profile.

Do not put unrelated events into one topic just to reduce topic count.

Do not create one topic per event type if ordering, retention, schema, and consumer groups are naturally shared.

### 5.3 Partition Count

Partition count must be justified.

Consider:

- target throughput;
- consumer parallelism;
- ordering scope;
- broker count;
- future growth;
- file descriptor and metadata overhead;
- rebalance cost;
- key distribution.

Do not blindly generate `partitions: 1` or `partitions: 100`.

### 5.4 Replication Factor and Min ISR

Production topics must define:

- replication factor;
- `min.insync.replicas`;
- producer `acks=all` compatibility;
- broker failure tolerance.

For important data, producers must not use `acks=0` or unsafe fire-and-forget publication.

### 5.5 Compacted Topics

Use compaction only when records represent latest state by key.

Good examples:

- customer profile latest state;
- product price latest state;
- account configuration;
- feature flag state;
- materialized reference data.

Bad examples:

- audit trails;
- workflow event history;
- financial transaction events;
- command streams;
- events where every occurrence matters.

Compaction must not be used as a deletion/audit substitute.

---

## 6. Event Record Standards

### 6.1 Required Envelope

Every shared Kafka event must include an envelope, either in payload or headers.

Minimum fields:

```json
{
  "eventId": "uuid",
  "eventType": "ApplicationSubmitted",
  "eventVersion": 1,
  "source": "licensing-application-service",
  "aggregateType": "Application",
  "aggregateId": "APP-123",
  "aggregateVersion": 7,
  "occurredAt": "2026-06-10T09:15:30Z",
  "publishedAt": "2026-06-10T09:15:31Z",
  "traceId": "...",
  "correlationId": "...",
  "causationId": "...",
  "tenantId": "...",
  "data": {}
}
```

### 6.2 Event ID

`eventId` must be globally unique and stable across retries.

It must not be regenerated on producer retry.

### 6.3 Event Type

Event type must be past tense and domain meaningful.

Good:

```text
ApplicationSubmitted
CaseAssigned
InvoicePaid
UserEmailChanged
DocumentUploaded
```

Bad:

```text
SubmitApplication
ProcessCase
DoPayment
SendEmail
SyncData
```

### 6.4 Timestamps

Use separate timestamps for:

- `occurredAt`: when the business fact happened;
- `publishedAt`: when the event was published;
- processing timestamp if needed by consumer.

Do not overload Kafka broker timestamp as the only business time.

### 6.5 Headers

Headers may be used for transport metadata:

- correlation id;
- traceparent;
- schema id;
- content type;
- tenant id if required for routing/security;
- producer version.

Headers must not contain sensitive business data unless explicitly protected and audited.

---

## 7. Producer Standards

### 7.1 Producer Safety Defaults

Production producers must prefer:

```properties
acks=all
enable.idempotence=true
retries>0
max.in.flight.requests.per.connection<=5
```

Do not generate unsafe producer configuration without explicit justification.

### 7.2 Producer Error Handling

Producer code must handle:

- serialization errors;
- schema validation errors;
- timeout;
- authorization failure;
- record-too-large errors;
- retriable broker errors;
- non-retriable errors;
- callback/future failure;
- application shutdown while records are in flight.

Publishing code must not ignore the returned future/callback.

### 7.3 Producer Flush

Do not call `flush()` after every record in high-throughput paths.

Use batching and backpressure-aware error handling.

Flush is acceptable:

- before graceful shutdown;
- in tests;
- in low-volume admin jobs;
- when explicitly trading latency/throughput.

### 7.4 Transactional Producer

Use Kafka transactions only when needed and correctly scoped.

Required when:

- consuming from Kafka and producing to Kafka with atomic offset+output commit;
- stream processing requires exactly-once semantics within Kafka;
- multiple output topics must be atomically published.

Not enough when:

- database side effects are outside the transaction;
- external HTTP calls are involved;
- third-party systems do not participate.

### 7.5 Outbox Producer

For database-originated domain events, prefer transactional outbox.

Minimum outbox fields:

```text
id
aggregate_type
aggregate_id
aggregate_version
event_type
event_version
payload
headers
created_at
published_at
status
retry_count
last_error
```

If CDC is used, the outbox table must be append-only or explicitly lifecycle-managed.

---

## 8. Consumer Standards

### 8.1 Consumer Group Naming

Consumer group names must be stable and service-owned.

Recommended pattern:

```text
<service>.<purpose>.<environment>
```

Examples:

```text
case-service.case-projection.prod
email-service.notification-dispatch.prod
analytics-service.application-events-loader.prod
```

Do not use random group IDs in production.

### 8.2 Offset Commit Rule

Offset must be committed only after processing is durably complete.

Valid sequence:

```text
poll -> deserialize -> validate -> authorize/classify -> process transactionally -> commit offset
```

Invalid sequence:

```text
poll -> commit offset -> process
```

unless losing messages is explicitly acceptable.

### 8.3 Auto Commit

Auto commit must be disabled for side-effecting consumers unless there is an explicit proof that message loss is acceptable.

Recommended:

```properties
enable.auto.commit=false
```

### 8.4 Idempotency

Every consumer must implement idempotency before side effects.

For database projectors:

```sql
UPDATE projection
SET ...,
    version = :incoming_version
WHERE id = :aggregate_id
  AND version < :incoming_version;
```

For command-like side effects:

```text
if event_id already processed -> no-op
else process and record event_id in same transaction
```

### 8.5 Poison Messages

A malformed or unprocessable message must not block a partition forever.

The consumer must classify failures:

| Failure Type         | Example                     | Action                                 |
| -------------------- | --------------------------- | -------------------------------------- |
| Deserialization      | invalid schema              | DLQ immediately or bounded retry       |
| Validation           | missing required field      | DLQ with reason                        |
| Business conflict    | stale version               | skip/no-op or compensate               |
| Transient downstream | timeout                     | bounded retry/backoff                  |
| Permanent downstream | 404 target no longer exists | DLQ or no-op by policy                 |
| Bug                  | NullPointerException        | stop or DLQ depending on safety policy |

### 8.6 Retry Strategy

Do not retry infinitely inside the poll loop.

Acceptable patterns:

- retry topic with delay tiers;
- bounded local retry with backoff;
- DLQ after max attempts;
- pause partition while preserving consumer liveness;
- circuit breaker for downstream dependency.

### 8.7 DLQ Standards

DLQ records must include:

- original topic;
- original partition;
- original offset;
- original key;
- original headers;
- failure class;
- failure message;
- stack trace hash, not necessarily full stack;
- consumer group;
- first failure time;
- last failure time;
- attempt count;
- trace/correlation id.

DLQ is not a trash bin. It must have monitoring and replay tooling.

### 8.8 Rebalance Handling

Consumers must handle rebalance safely.

Long processing must consider:

- `max.poll.interval.ms`;
- `max.poll.records`;
- pause/resume;
- cooperative rebalancing where supported;
- graceful shutdown;
- idempotency for in-flight records.

---

## 9. Delivery Guarantees

### 9.1 At-Most-Once

At-most-once means messages may be lost.

Use only for:

- non-critical telemetry;
- cache warmup;
- approximate metrics;
- best-effort notifications.

Must be explicitly documented.

### 9.2 At-Least-Once

At-least-once is the default safe assumption.

This requires:

- idempotent consumers;
- commit after processing;
- duplicate-safe side effects;
- replay-safe handlers.

### 9.3 Exactly-Once

Exactly-once must not be claimed casually.

Kafka exactly-once semantics are scoped. They can help with Kafka read-process-write flows, especially when transactions are used. They do not automatically make external databases, HTTP calls, email, files, or third-party APIs exactly-once.

If the LLM claims exactly-once, it must state:

- scope of exactly-once;
- participating systems;
- transaction boundary;
- offset commit mechanism;
- idempotency strategy for non-Kafka side effects;
- failure scenarios.

---

## 10. Schema and Contract Standards

### 10.1 Schema Format

Shared topics must define schema using one of:

- Avro;
- Protobuf;
- JSON Schema;
- strongly governed JSON contract.

### 10.2 Compatibility

Every shared topic must define compatibility mode:

- backward;
- forward;
- full;
- transitive variant when required.

Default recommendation for integration events: backward-compatible evolution unless the ecosystem requires otherwise.

### 10.3 Evolution Rules

Allowed changes:

- add optional field;
- add field with default;
- widen enum only if consumers tolerate unknown values;
- add new event type to documented union if consumers ignore unknown types.

Dangerous changes:

- remove field;
- rename field;
- change type;
- change field meaning;
- change units;
- change timestamp semantics;
- change partition key;
- change event type name;
- change requiredness.

Semantic changes require a new event version or new topic.

---

## 11. Kafka Streams Standards

Kafka Streams applications must declare:

- input topics;
- output topics;
- application id;
- state stores;
- repartition topics;
- changelog topics;
- processing guarantee;
- topology description;
- state restoration expectation;
- error handling policy;
- schema evolution policy.

Do not generate a Kafka Streams topology without naming internal topics and storage implications.

### 11.1 State Store

State stores must have:

- explicit key/value schema;
- retention/changelog policy;
- restore time expectation;
- disk usage expectation;
- standby replica decision if required;
- migration plan.

### 11.2 Repartitioning

Repartitioning is a major design event.

If code triggers repartitioning, the LLM must explain:

- why the key changes;
- internal topic created;
- ordering implication;
- storage and throughput impact;
- schema of repartitioned records.

---

## 12. CDC and Outbox Standards

CDC from operational databases must not leak internal table structure as public event contracts.

If Debezium or similar CDC is used:

- prefer outbox event router for integration events;
- sanitize internal columns;
- include domain event envelope;
- avoid exposing database implementation details;
- handle deletes/tombstones intentionally;
- document snapshot behavior;
- document schema evolution behavior.

Do not make external consumers depend on raw internal table CDC unless the topic is explicitly an internal replication feed.

---

## 13. Security Standards

Kafka access must enforce:

- TLS in production;
- authentication, e.g. mTLS/SASL/OIDC depending on platform;
- topic-level authorization;
- consumer group authorization;
- producer/consumer least privilege;
- secrets outside source code;
- PII classification;
- encryption at rest where required;
- audit of admin operations;
- network isolation.

Do not give all applications wildcard access to all topics.

### 13.1 Sensitive Data

Events are replicated, retained, and replayed. Therefore sensitive data requires extra scrutiny.

Rules:

- minimize PII in events;
- tokenize or reference sensitive data where possible;
- encrypt field-level payloads only with clear key management;
- align retention with privacy/compliance requirements;
- document consumers that receive sensitive data.

### 13.2 Tenant Isolation

Multi-tenant events must include tenant context where required.

Authorization must prevent cross-tenant producers/consumers from accessing inappropriate topics or records.

Do not rely only on payload tenant id if topic ACLs allow broad read access.

---

## 14. Observability Standards

Every Kafka application must expose:

- records produced/sec;
- producer error rate;
- producer retry rate;
- producer latency;
- consumer lag;
- consumer processing latency;
- records consumed/sec;
- rebalance count;
- deserialization failures;
- DLQ rate;
- retry rate;
- end-to-end event age;
- handler success/failure count;
- downstream dependency latency.

Logs must include:

- topic;
- partition;
- offset;
- key hash or safe key;
- event id;
- event type;
- consumer group;
- correlation id;
- failure class.

Do not log sensitive payloads by default.

---

## 15. Testing Standards

Kafka code must be tested with:

- schema compatibility tests;
- producer serialization tests;
- consumer deserialization tests;
- idempotency tests;
- duplicate message tests;
- out-of-order event tests if versioned;
- poison message tests;
- DLQ tests;
- retry tests;
- offset commit behavior tests;
- consumer restart tests;
- partition key tests;
- contract tests for shared topics;
- integration tests with real broker or faithful test container.

Mock-only tests are insufficient for Kafka infrastructure code.

---

## 16. Common Anti-Patterns

### 16.1 Kafka as RPC

Bad:

```text
Service A sends command to topic and waits synchronously for response topic.
```

This is usually worse than HTTP/gRPC unless async workflow semantics are explicitly needed.

### 16.2 Event as Command

Bad:

```text
UserService publishes SendWelcomeEmail event.
```

This is a command disguised as an event. Prefer:

```text
UserRegistered event
```

Then EmailService decides whether to send email.

### 16.3 Random Partition Key

Random key destroys per-aggregate ordering.

### 16.4 No Key

Null key may spread records but loses ordering semantics. Only acceptable when order by key is irrelevant.

### 16.5 Auto Commit with Side Effects

Auto commit can acknowledge records before successful processing.

### 16.6 Infinite Retry Inside Consumer

One poison record blocks the partition forever.

### 16.7 DLQ Without Replay

A DLQ that nobody monitors or can replay is operational debt.

### 16.8 Raw JSON Everywhere

Ad-hoc JSON without schema governance breaks consumers silently.

### 16.9 Consumer Reads Producer Database

A consumer that must query the producer database is tightly coupled and undermines event autonomy.

### 16.10 Topic Per Developer Feature

Topic sprawl without ownership creates operational and contract chaos.

### 16.11 Shared Consumer Group Accidentally

Two different applications using the same group id split work unexpectedly.

### 16.12 Business Logic in Kafka Connect SMTs

Kafka Connect transforms should not become opaque business logic engines.

---

## 17. LLM Implementation Checklist

Before generating Kafka code, answer:

- What business event or stream is being modeled?
- Why Kafka instead of HTTP/RabbitMQ/database polling?
- What is the topic name?
- Who owns the topic?
- What is the partition key?
- What ordering is required?
- What schema format is used?
- What is the compatibility policy?
- What retention/compaction policy is required?
- Is the producer idempotent?
- Is the consumer idempotent?
- When are offsets committed?
- What happens on poison messages?
- What is the retry/DLQ policy?
- What metrics/logs/traces are emitted?
- What security/ACLs are required?
- How is replay handled?

If any answer is missing, the implementation is incomplete.

---

## 18. Required Code Generation Rules

When generating Kafka producer code, LLMs must include:

- explicit configuration;
- serialization/schema handling;
- delivery callback/future handling;
- error classification;
- correlation/trace headers;
- graceful shutdown;
- tests or test plan.

When generating Kafka consumer code, LLMs must include:

- explicit group id;
- manual commit or equivalent safe processing;
- idempotency mechanism;
- deserialization failure handling;
- bounded retry/DLQ strategy;
- graceful shutdown;
- observability;
- tests or test plan.

When generating topic configuration, LLMs must include:

- partitions;
- replication factor;
- retention;
- cleanup policy;
- min ISR;
- ACL expectation;
- schema subject expectation.

---

## 19. Review Checklist

A Kafka change is acceptable only if reviewers can answer yes:

- [ ] Topic owner is clear.
- [ ] Topic semantics are clear.
- [ ] Event payload is a fact, not a disguised command.
- [ ] Partition key is justified.
- [ ] Ordering scope is documented.
- [ ] Retention/compaction is explicit.
- [ ] Schema compatibility is defined.
- [ ] Producer handles publish failure.
- [ ] Producer avoids unsafe fire-and-forget.
- [ ] Consumer is idempotent.
- [ ] Offset commit occurs after durable processing.
- [ ] Poison messages cannot block forever.
- [ ] DLQ/retry is observable and replayable.
- [ ] Security and ACLs are least-privilege.
- [ ] Sensitive data is minimized.
- [ ] Consumer lag and processing latency are monitored.
- [ ] Replay behavior is documented.

---

## 20. Acceptance Criteria

A Kafka implementation is accepted only when:

1. Topic contract is documented.
2. Producer and consumer behavior are deterministic under retries.
3. Consumer side effects are idempotent.
4. Offset ownership is correct.
5. Failure paths are tested.
6. DLQ/retry is operationally usable.
7. Schema evolution is safe.
8. Observability exists before production.
9. Security/ACLs are defined.
10. Replay will not corrupt state.

---

## 21. Enforcement Snippet for LLM Code Agents

Use this instruction when asking an LLM to generate Kafka code:

```text
Follow strict-general-standards__kafka.md.
Before writing code, classify the flow as event streaming, queue-like work distribution, CDC, outbox, stream processing, or request/reply.
Do not use Kafka unless justified.
For every topic, define owner, key, partitions, retention, cleanup policy, schema, compatibility, ACLs, and replay behavior.
For every producer, handle delivery failure and avoid unsafe fire-and-forget.
For every consumer, use explicit group id, idempotent processing, safe offset commit, bounded retry, DLQ, and observability.
Never claim exactly-once unless the exact boundary and participating systems are defined.
Reject event-as-command, random keys, auto-commit side-effect consumers, and dual-write database+Kafka bugs.
```

---

## 22. References

- Apache Kafka Documentation: https://kafka.apache.org/documentation/
- Apache Kafka Producer Configs: https://kafka.apache.org/41/configuration/producer-configs/
- Apache Kafka Design and Documentation: https://kafka.apache.org/documentation/#design
- CloudEvents Specification: https://github.com/cloudevents/spec
- Enterprise Integration Patterns: Event Message: https://www.enterpriseintegrationpatterns.com/patterns/messaging/EventMessage.html
- Enterprise Integration Patterns: Message: https://www.enterpriseintegrationpatterns.com/patterns/messaging/Message.html
