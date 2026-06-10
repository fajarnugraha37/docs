# Strict Coding Standards — Java Kafka

**Status:** Mandatory for LLM-generated Java code that produces to, consumes from, administers, or integrates with Apache Kafka.

**Applies to:** Java 11/17/21/25 services using Apache Kafka Java clients, Spring Kafka, Quarkus Kafka, MicroProfile Reactive Messaging Kafka connector, or any wrapper around `org.apache.kafka:kafka-clients`.

**Related standards:**

- `strict-coding-standards__java_concurrency.md`
- `strict-coding-standards__java_json.md`
- `strict-coding-standards__java_telemetry.md`
- `strict-coding-standards__java_security.md`
- `strict-coding-standards__java_testing.md`
- `strict-coding-standards__java_benchmarking.md`
- `strict-coding-standards__java_kafka_stream.md`

---

## 1. Purpose

Kafka code is not allowed to be written as ordinary message-queue glue.

Every Kafka change must explicitly define:

1. event contract,
2. topic semantics,
3. keying/partitioning rule,
4. delivery guarantee,
5. ordering expectation,
6. retry and dead-letter behavior,
7. offset commit behavior,
8. idempotency strategy,
9. observability signals,
10. operational failure behavior.

LLM-generated Kafka code must be conservative. If the required semantics are not known, the agent must not invent them.

---

## 2. Compatibility and Dependency Rules

### 2.1 Client Version Governance

**MUST**:

- Pin Kafka client versions through Maven/Gradle dependency management.
- Keep Kafka client major/minor version compatible with the broker fleet and framework integration.
- Treat broker upgrade, client upgrade, and serialization format change as separate migration concerns.
- Document the broker version assumption if client code depends on specific protocol features.

**MUST NOT**:

- Use floating versions such as `latest.release`, `+`, dynamic Gradle versions, or unpinned plugin versions.
- Upgrade Kafka client to resolve a compile issue without checking broker compatibility, framework compatibility, and transitive dependency impact.
- Mix multiple Kafka client versions through transitive dependencies.

### 2.2 Wrapper Frameworks

When using Spring Kafka, Quarkus Kafka, Micronaut Kafka, or MicroProfile Reactive Messaging:

**MUST**:

- Follow this standard for semantics even if the framework hides the raw producer/consumer.
- Know where retries, commits, transactions, deserialization errors, and DLQ behavior are configured.
- Add tests at the framework boundary, not only unit tests for the service method.

**MUST NOT**:

- Assume framework defaults are production-safe.
- Hide critical behavior in annotations without documenting the resulting Kafka semantics.

---

## 3. Kafka Design Contract

Every new producer/consumer must include a short design note:

```md
Kafka Design Note
- Topic(s):
- Producer(s):
- Consumer group(s):
- Event schema / version:
- Key:
- Partitioning rule:
- Ordering requirement:
- Delivery guarantee:
- Idempotency key:
- Retry behavior:
- DLQ behavior:
- Offset commit strategy:
- Backpressure behavior:
- Security classification:
- Observability:
```

Code without this contract is incomplete.

---

## 4. Topic Rules

### 4.1 Topic Naming

**MUST** use names that describe the stream contract, not the Java class name.

Preferred patterns:

```text
<domain>.<aggregate>.<event-kind>
<domain>.<bounded-context>.<stream-kind>
<system>.<integration>.<direction>
```

Examples:

```text
enforcement.case.events
licensing.application.commands
billing.invoice.status-events
integration.crm.customer-changes
```

**MUST NOT**:

```text
MyEventTopic
KafkaTopic1
service-output
temp-events
new-topic
```

### 4.2 Topic Ownership

Each topic must have one documented owner:

- schema owner,
- retention owner,
- compatibility owner,
- operational owner.

**MUST NOT** create topics from application code unless the service is explicitly an infrastructure provisioning component.

Topic creation belongs in infrastructure-as-code, platform automation, or controlled admin scripts.

### 4.3 Topic Configuration

For every topic, define:

- partition count,
- replication factor,
- retention policy,
- cleanup policy,
- compaction requirement,
- minimum in-sync replica policy,
- message size expectation,
- schema compatibility mode.

**MUST NOT** rely on broker defaults for production topics.

---

## 5. Event Contract Rules

### 5.1 Event Shape

Every event must be versioned and self-describing enough to support independent producers/consumers.

Required metadata:

```json
{
  "eventId": "uuid",
  "eventType": "CaseApproved",
  "eventVersion": 1,
  "aggregateType": "Case",
  "aggregateId": "CASE-123",
  "occurredAt": "2026-06-10T01:02:03Z",
  "producer": "case-service",
  "correlationId": "...",
  "causationId": "..."
}
```

**MUST** distinguish:

- event ID: identity of this emitted event,
- aggregate ID: identity of the business object,
- correlation ID: request/workflow correlation,
- causation ID: event or command that caused this event,
- idempotency key: key used to deduplicate processing.

### 5.2 Event Type Policy

**MUST** name events as facts that already happened.

Allowed:

```text
CaseCreated
CaseAssigned
InspectionScheduled
PaymentReceived
```

Forbidden:

```text
CreateCase
AssignCase
ScheduleInspection
ProcessPayment
```

Commands may be used, but they must be explicitly modeled as commands and not mixed with fact events.

### 5.3 Schema Evolution

**MUST**:

- Make schema compatibility explicit.
- Prefer additive changes.
- Treat removal/rename/type-change as breaking unless compatibility is proven.
- Keep old fields readable while consumers migrate.
- Never repurpose an existing field with a new meaning.

**MUST NOT**:

- Change enum/string meaning without a versioned migration.
- Reuse event type names for incompatible payloads.
- Serialize Java class names as wire contract.

---

## 6. Serialization Rules

### 6.1 Allowed Formats

Allowed by default:

- Avro with Schema Registry,
- Protobuf with Schema Registry,
- JSON with JSON Schema and strict DTOs,
- compact binary only with documented protocol and tests.

Restricted:

- raw JSON without schema,
- Java object serialization,
- framework-specific serialized objects,
- polymorphic JSON.

Forbidden by default:

- `ObjectOutputStream` / native Java serialization,
- Jackson default typing for event payloads,
- class-name-based polymorphic deserialization,
- unbounded `byte[]` payload parsing from untrusted topics.

### 6.2 DTO Boundary

**MUST** use explicit event DTOs.

**MUST NOT** publish:

- JPA/Hibernate entities,
- internal command objects,
- REST request classes directly,
- framework proxy objects,
- objects containing lazy-loaded associations.

Correct:

```java
public record CaseApprovedEvent(
        UUID eventId,
        String aggregateId,
        Instant occurredAt,
        String approvedBy,
        int eventVersion) {
}
```

### 6.3 Serialization Errors

**MUST** decide what happens when serialization/deserialization fails.

Producer serialization failure:

- fail fast,
- do not retry blindly,
- record sanitized event metadata,
- alert if caused by schema incompatibility.

Consumer deserialization failure:

- must not crash-loop forever without visibility,
- must not commit offset unless failure handling policy says so,
- must route to DLQ/quarantine or stop the consumer according to business criticality.

---

## 7. Key and Partitioning Rules

### 7.1 Key Required

Every event must have a key unless the stream is explicitly unordered and stateless.

**MUST** choose the key from the ordering and locality requirement.

Common choices:

| Requirement | Key |
|---|---|
| Preserve aggregate order | aggregate ID |
| Process per tenant | tenant ID, only if tenant order matters |
| Join/enrich by customer | customer ID |
| Random load spread | explicit random/distribution key |
| Global total order | usually forbidden; Kafka topic partitioning is not a global ordering tool |

### 7.2 Partition Stability

**MUST** treat key format as part of the event contract.

Changing key format may repartition records and break:

- ordering,
- joins,
- compaction,
- consumer locality,
- stateful processors,
- idempotency assumptions.

### 7.3 Null Keys

Null keys are restricted.

Allowed only when:

- ordering is irrelevant,
- compaction is not used,
- downstream joins/state stores do not depend on the key,
- the design note explicitly says why null key is safe.

---

## 8. Producer Rules

### 8.1 Producer Lifecycle

**MUST**:

- Reuse `KafkaProducer` or framework-managed producer.
- Close producers on shutdown.
- Flush only at controlled boundaries.
- Use bounded send timeout behavior.

**MUST NOT**:

- Create a producer per message.
- Call `flush()` after every send unless the use case is low-throughput synchronous publishing and explicitly justified.
- Ignore send results.
- Swallow callback exceptions.

### 8.2 Required Producer Configuration Review

Every producer config must review:

```properties
bootstrap.servers=...
client.id=...
key.serializer=...
value.serializer=...
acks=all
retries=...
delivery.timeout.ms=...
request.timeout.ms=...
linger.ms=...
batch.size=...
compression.type=...
enable.idempotence=true
max.in.flight.requests.per.connection=...
```

**MUST** use `acks=all` for durable business events unless explicitly non-critical.

**MUST** enable idempotent producer for normal business publishing unless there is a documented reason not to.

### 8.3 Send Result Handling

Correct pattern:

```java
producer.send(record, (metadata, exception) -> {
    if (exception != null) {
        // log sanitized metadata, propagate to failure channel, increment metric
        return;
    }
    // optional: record success metric with topic/partition only
});
```

**MUST NOT**:

```java
producer.send(record);
```

unless failure is handled by a framework abstraction with clear policy.

### 8.4 Synchronous Send

Synchronous `.get()` sends are restricted.

Allowed only for:

- low-throughput admin tool,
- migration script,
- transactional boundary requiring immediate failure,
- test code.

Must include timeout:

```java
producer.send(record).get(5, TimeUnit.SECONDS);
```

Forbidden:

```java
producer.send(record).get();
```

### 8.5 Transactions

Kafka transactions are restricted and must be designed explicitly.

Allowed when:

- publishing multiple records atomically,
- consume-process-produce pipeline needs offset+output atomicity,
- exactly-once between Kafka topics is required.

**MUST** define:

- `transactional.id` strategy,
- producer instance ownership,
- fencing behavior,
- offset commit in transaction if consuming,
- consumer `isolation.level=read_committed` where required,
- operational recovery behavior.

**MUST NOT** use transactions to claim end-to-end exactly-once with an external database unless the external side is also idempotent/transactionally coordinated.

---

## 9. Consumer Rules

### 9.1 Consumer Lifecycle

**MUST**:

- Run consumer polling in a controlled lifecycle.
- Close the consumer on shutdown.
- Use wakeup/interrupt/shutdown handling when using raw KafkaConsumer.
- Keep processing time within `max.poll.interval.ms` or explicitly pause/resume/parallelize safely.

**MUST NOT**:

- Share `KafkaConsumer` across arbitrary threads.
- Block indefinitely inside `poll()` processing without backpressure strategy.
- Start anonymous consumers without stable `group.id` for production processing.

### 9.2 Required Consumer Configuration Review

Every consumer config must review:

```properties
bootstrap.servers=...
client.id=...
group.id=...
key.deserializer=...
value.deserializer=...
enable.auto.commit=false
auto.offset.reset=...
isolation.level=...
max.poll.records=...
max.poll.interval.ms=...
session.timeout.ms=...
heartbeat.interval.ms=...
fetch.min.bytes=...
fetch.max.bytes=...
max.partition.fetch.bytes=...
```

**MUST** disable auto-commit by default for business processing.

**MUST** choose `auto.offset.reset` intentionally:

- `earliest`: replay/history processing,
- `latest`: only new records are meaningful,
- `none`: strict systems where missing offset is a deployment error.

### 9.3 Offset Commit Strategy

Offset commit is part of correctness.

Allowed strategies:

1. commit after successful processing,
2. commit after idempotent persistence,
3. commit in transaction for consume-process-produce,
4. framework-managed commit with documented ack mode.

Forbidden:

- commit before processing for non-idempotent business logic,
- auto-commit for operations with side effects,
- committing skipped records without DLQ/quarantine evidence,
- committing offset in a different transaction than the durable side effect unless idempotency covers replay.

### 9.4 Processing Idempotency

Consumers must be idempotent unless duplicates are explicitly acceptable.

Allowed idempotency mechanisms:

- database unique constraint on event ID,
- processed-event table,
- natural aggregate version check,
- monotonic sequence per aggregate,
- external idempotency key,
- commutative aggregation.

**MUST NOT** rely on Kafka alone to eliminate all duplicate effects.

### 9.5 Rebalance Safety

Consumer code must tolerate rebalance.

**MUST**:

- finish or stop in-flight processing safely,
- commit processed offsets at safe points,
- handle partition revocation if manual assignment/listeners are used,
- not store critical partition ownership only in memory.

**MUST NOT** assume a partition always belongs to the same service instance.

---

## 10. Retry, DLQ, and Poison Message Rules

### 10.1 Retry Classification

All failures must be classified:

| Failure | Retry? | Example |
|---|---:|---|
| transient infrastructure | yes, bounded | temporary DB/network outage |
| downstream rate limit | yes, bounded/backoff | HTTP 429 |
| validation/schema error | no | missing required field |
| authorization/tenant violation | no | event belongs to forbidden tenant |
| bug/invariant violation | usually stop or quarantine | impossible state |

### 10.2 Retry Location

Valid retry mechanisms:

- in-memory bounded retry for very short transient errors,
- retry topic with backoff,
- DLQ/quarantine topic,
- stop consumer and alert for critical stream.

**MUST NOT** implement infinite blocking retry inside consumer poll loop.

### 10.3 DLQ Payload

DLQ event must contain:

- original topic,
- partition,
- offset,
- original key,
- original headers,
- sanitized original payload or pointer,
- failure class,
- failure message sanitized,
- failed at timestamp,
- consumer group,
- service version,
- retry count.

**MUST NOT** put secrets/PII into DLQ without classification and retention controls.

### 10.4 Poison Message Policy

Poison messages must not cause endless consumer crash loops.

For critical streams, it is acceptable to stop processing and page humans rather than skip silently.

---

## 11. Outbox and Transactional Boundaries

### 11.1 Database + Kafka Publishing

If a database write and Kafka publish must be consistent, prefer the outbox pattern.

Correct model:

1. service writes business state and outbox row in same DB transaction,
2. relay publishes outbox event to Kafka,
3. relay marks/safely advances state after publish,
4. consumers deduplicate by event ID.

**MUST NOT**:

```java
repository.save(entity);
producer.send(event);
```

and claim atomic consistency.

### 11.2 Consume + Database Side Effect

If a consumer writes to a database:

**MUST** use idempotent writes and commit Kafka offset only after durable success.

Recommended:

```text
consume -> validate -> begin DB tx -> upsert/dedup -> commit DB tx -> commit offset
```

Failure after DB commit but before offset commit must be safe through idempotency.

---

## 12. Ordering Rules

### 12.1 Ordering Scope

Kafka ordering is per partition, not global.

**MUST** state ordering scope:

- per aggregate,
- per tenant,
- per customer,
- none,
- other explicit partition key.

**MUST NOT** claim global ordering unless there is a single partition and operational tradeoff is accepted.

### 12.2 Parallel Processing

Parallel consumer processing is restricted.

If records are processed concurrently:

**MUST** preserve per-key ordering if business requires it.

Allowed approaches:

- partition-level processing thread,
- key-affinity executor,
- ordered work queue per key,
- Kafka Streams keyed topology.

Forbidden:

- arbitrary `parallelStream()` over records from `poll()` when ordering matters,
- committing max offset while lower offsets are still in-flight,
- per-record async without commit tracking.

---

## 13. Header Rules

Kafka headers may carry metadata, not hidden payload.

Allowed headers:

- correlation ID,
- causation ID,
- trace context,
- schema ID/version if framework requires,
- tenant ID if non-sensitive and part of routing policy,
- content type.

Forbidden:

- secrets,
- access tokens,
- large payload fragments,
- business fields needed for correctness but absent from payload,
- PII without explicit classification.

---

## 14. Security Rules

### 14.1 Transport and Authentication

Production Kafka clients must define:

- `security.protocol`,
- authentication mechanism,
- truststore/keystore management,
- certificate rotation strategy,
- ACL requirement.

**MUST NOT**:

- disable TLS validation,
- hardcode credentials,
- log SASL password or certificate material,
- share one principal for unrelated services without ACL reasoning.

### 14.2 Authorization

Kafka ACLs must be least privilege:

- producer can write only allowed topics,
- consumer group can read only allowed topics,
- admin privileges isolated,
- DLQ write permission explicit,
- internal topics permission controlled.

### 14.3 Sensitive Data

**MUST** classify every topic:

- public/internal/confidential/restricted,
- PII status,
- retention requirement,
- encryption requirement,
- access control requirement.

**MUST NOT** assume Kafka retention is equivalent to business data lifecycle compliance.

---

## 15. Observability Rules

Every Kafka integration must expose:

- records produced count,
- produce failures count,
- produce latency,
- records consumed count,
- processing latency,
- consumer lag,
- commit failures,
- rebalance count,
- DLQ count,
- retry count,
- serialization/deserialization errors,
- paused partitions if applicable.

Logs must include:

- topic,
- partition,
- offset,
- event type,
- event ID,
- correlation ID,
- consumer group,
- sanitized failure class.

Logs must not include full payload by default.

Traces must propagate context through Kafka headers where platform policy allows it.

---

## 16. Testing Rules

### 16.1 Required Tests

Kafka changes must include tests for:

- serialization compatibility,
- producer sends expected key/header/payload,
- consumer processes valid event,
- consumer handles duplicate event,
- consumer handles invalid event,
- retry/DLQ behavior,
- offset commit behavior when framework supports it,
- ordering-sensitive behavior,
- schema evolution if changed.

### 16.2 Test Infrastructure

Allowed:

- Testcontainers Kafka/Redpanda for integration tests,
- embedded Kafka only for narrow framework tests,
- contract tests using schema registry mock or real registry container,
- deterministic fake producer/consumer for unit tests.

**MUST NOT** rely only on mocks for Kafka integration correctness.

### 16.3 Replay Tests

For event-driven workflows, include replay/idempotency tests:

```text
same event delivered twice -> one durable business effect
same aggregate events delivered in order -> expected final state
invalid event -> DLQ/quarantine/stop according to policy
```

---

## 17. Performance and Capacity Rules

Kafka performance tuning must be evidence-based.

Review:

- payload size,
- batch size,
- compression,
- linger,
- partition count,
- consumer concurrency,
- max poll records,
- processing time,
- DB/downstream bottleneck,
- lag behavior under load.

**MUST NOT** tune blindly by increasing partitions or consumer threads without identifying the bottleneck.

**MUST NOT** increase partition count for a topic with key-based ordering without understanding repartition impact.

---

## 18. Anti-Patterns

Forbidden unless explicitly approved:

- one producer per message,
- auto-commit for non-idempotent side effects,
- unkeyed business events requiring order,
- direct entity serialization,
- no DLQ/poison strategy,
- infinite retry in poll loop,
- logging full payloads,
- creating topics from business service startup,
- global catch-and-ignore in consumer,
- committing offsets before side effects,
- assuming exactly-once across Kafka + external DB without idempotency,
- using Kafka as synchronous request/response without timeout/correlation/deadline design,
- using Kafka as a database replacement for mutable query needs without materialized view design.

---

## 19. LLM Implementation Protocol

Before writing Kafka code, the LLM must answer:

1. What topic is used and who owns it?
2. What is the event schema and version?
3. What is the key and why?
4. What delivery guarantee is required?
5. Is the consumer idempotent?
6. When are offsets committed?
7. What happens on validation failure?
8. What happens on transient failure?
9. What happens on poison message?
10. What metrics/logs/traces are emitted?

If any answer is unknown, the LLM must choose the safest minimal implementation and mark the missing decision explicitly.

---

## 20. Reviewer Checklist

Reject Kafka code if any item fails:

- [ ] Topic name and owner are documented.
- [ ] Event schema/version is explicit.
- [ ] Key and partitioning rule are justified.
- [ ] Serialization format is approved.
- [ ] Producer config handles durability and failure.
- [ ] Send result is observed.
- [ ] Consumer offset commit is safe.
- [ ] Consumer is idempotent or duplicates are acceptable by design.
- [ ] Retry/DLQ/poison policy exists.
- [ ] Ordering scope is clear.
- [ ] Security protocol and ACL assumptions are clear.
- [ ] Sensitive data classification exists.
- [ ] Observability includes lag, failure, retry, DLQ, and processing latency.
- [ ] Integration tests cover duplicate, invalid, and failure cases.
- [ ] No full payload logging by default.

---

## 21. References

- Apache Kafka Documentation: https://kafka.apache.org/documentation/
- Apache Kafka Producer Javadocs: https://kafka.apache.org/javadoc/
- Apache Kafka Consumer Javadocs: https://kafka.apache.org/javadoc/
- Confluent Kafka Delivery Semantics: https://docs.confluent.io/kafka/design/delivery-semantics.html
- Confluent Consumer Offsets Guide: https://www.confluent.io/blog/guide-to-consumer-offsets/
- OWASP Logging Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- OWASP Secrets Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
