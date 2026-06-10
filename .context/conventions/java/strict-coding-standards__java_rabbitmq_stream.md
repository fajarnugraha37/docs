# Strict Coding Standards: Java RabbitMQ Streams

**Scope:** Java applications that use RabbitMQ Streams through the RabbitMQ Stream Java Client (`com.rabbitmq:stream-client`) or framework integrations built on top of it.

**Primary goal:** make stream processing predictable under replay, offset movement, duplicate publishing, partitioning, retention, consumer restart, flow control, and broker/client recovery.

This document covers RabbitMQ Streams. For AMQP 0-9-1 queue/exchange integration, use `strict-coding-standards__java_rabbitmq.md`.

---

## 1. Conceptual Boundary

RabbitMQ Streams are not normal RabbitMQ queues.

**MUST understand these differences:**

| Concern     | Classic/quorum queue                            | RabbitMQ stream                                        |
| ----------- | ----------------------------------------------- | ------------------------------------------------------ |
| Consumption | Consuming removes/acks messages from queue flow | Consuming is non-destructive; stream remains readable. |
| Position    | Queue tracks deliveries/acks                    | Consumer tracks offsets.                               |
| Replay      | Not the default queue model                     | First-class use case.                                  |
| Storage     | Queue-oriented broker storage                   | Persistent replicated append-log-like structure.       |
| Scaling     | Competing consumers on queues                   | Super streams/partitions for scale.                    |
| Dedup       | Usually app-side/idempotency                    | Producer-name + publishing ID support exists.          |

**MUST NOT** implement RabbitMQ Streams as if `ack` deletes messages from a queue.

---

## 2. LLM Agent Contract

Before changing RabbitMQ Stream code, the LLM **MUST** identify:

1. Is this a producer, consumer, environment setup, stream creation, super stream, or test?
2. What is the stream name or super stream name?
3. What is the retention policy and message size expectation?
4. What is the offset strategy: first, last, next, absolute offset, timestamp, stored offset?
5. Where are offsets stored: server-side, external DB, or derived replay mode?
6. Is replay expected? If yes, how is idempotency handled?
7. Is ordering required? If yes, per stream or per super-stream partition key?
8. Is deduplication enabled? If yes, what is producer name and publishing ID source?
9. What is the flow-control/backpressure policy?
10. What metrics prove consumer lag, publish confirm, offset progress, and errors?

If these are not known, the LLM must implement only the minimal safe change and document unresolved questions.

---

## 3. Dependency and Runtime Standards

**MUST**

- Pin exact `com.rabbitmq:stream-client` version.
- Use the stable client line approved by the project/platform.
- Document minimum Java baseline. The stream Java client requires at least Java 11; Java 21+ may be preferable for modern runtime behavior where project baseline allows it.
- Keep broker version, stream plugin availability, and stream feature compatibility documented.
- Test against a real broker with stream support.

**MUST NOT**

- Add stream client dependency to a project that only needs normal AMQP queues.
- Mix stream and AMQP queue semantics in the same abstraction without naming the boundary.
- Use snapshot/milestone client versions in production unless explicitly approved.

---

## 4. Environment Lifecycle

### 4.1 Environment ownership

**MUST**

- Treat `Environment` as an application-level resource.
- Create it once per application/component boundary, not per message.
- Close it on shutdown.
- Configure host, port, TLS, authentication, locator, address resolver, and recovery policy explicitly.
- Use connection names/metadata where supported for observability.

**MUST NOT**

- Create `Environment` inside each publish/consume operation.
- Hide environment creation in business logic.
- Leak producers/consumers on redeploy or restart.

### 4.2 Producer/consumer lifecycle

**MUST**

- Create producers and consumers as lifecycle-managed components.
- Bound in-flight/unconfirmed messages.
- Close producers/consumers gracefully.
- Expose lifecycle state through health/metrics.

**MUST NOT**

- Create a producer per record.
- Start consumers before dependency readiness if processing requires database/external API.
- Ignore recovery callbacks/errors.

---

## 5. Stream and Super Stream Topology

### 5.1 Stream creation

**MUST** define:

- stream name;
- owner service/team;
- retention size/time;
- max segment size if relevant;
- replication/availability policy;
- expected throughput;
- expected consumers;
- schema/event contract;
- operational deletion policy.

**MUST NOT**

- Create streams dynamically per user/request/tenant without cardinality approval.
- Use stream names as ad-hoc business state.
- Change retention without consumer replay impact analysis.

### 5.2 Retention

**MUST** understand that retention controls replay window and storage growth.

**MUST**

- Set retention based on replay/recovery requirements.
- Define what happens when a consumer's stored offset is older than retained data.
- Monitor disk usage and stream segment behavior.

**MUST NOT**

- Treat RabbitMQ Streams as permanent immutable audit archive unless storage, retention, compliance, and replay policies explicitly support that.

### 5.3 Super streams

**MUST** use super streams only when partitioned stream scale is required.

**MUST**

- Define routing strategy.
- Define partition key.
- Document ordering guarantee: order is per partition, not global.
- Ensure producers use stable routing key extraction.
- Ensure consumers are partition-aware.

**MUST NOT**

- Use super streams just because throughput is unknown.
- Change routing strategy without replay/reprocessing plan.
- Assume total ordering across partitions.

---

## 6. Producer Standards

### 6.1 Producer contract

Every stream producer **MUST** define:

- stream/super stream target;
- message schema/version;
- producer name policy;
- publishing ID policy;
- confirm handling;
- max unconfirmed messages;
- retry-on-recovery policy;
- deduplication policy;
- routing policy for super streams;
- telemetry.

### 6.2 Publish confirmation

**MUST**

- Handle asynchronous confirmation status.
- Treat confirm timeout/recovery ambiguity as duplicate-risk.
- Bound unconfirmed messages.
- Log and metric publish errors/nacks/timeouts.

**MUST NOT**

- Fire-and-forget durable business events.
- Assume a callback is unnecessary because the stream is replicated.
- Retry publishes without deduplication or duplicate-tolerant consumers.

### 6.3 Deduplication

RabbitMQ Streams can deduplicate published messages using producer name and publishing ID.

**MUST**

- Use deduplication for replaying/outbox-like producers where duplicates are likely.
- Use a stable producer name across restarts for the same logical producer.
- Use strictly increasing publishing IDs for a given producer name.
- Ensure only one active producer instance uses a given deduplication name at a time.
- Store/derive publishing ID from a durable source, not process-local counter unless loss is acceptable.

**MUST NOT**

- Share the same producer name across concurrent producer instances.
- Generate random publishing IDs for deduplication.
- Reset publishing IDs after restart.
- Treat deduplication as consumer idempotency replacement for all side effects.

### 6.4 Message model

**MUST**

- Use explicit content type and encoding.
- Include event ID, event type, schema version, occurred-at timestamp, producer, and correlation/trace context.
- Avoid Java native serialization.
- Keep payload compatible across old/new consumers.

**MUST NOT**

- Put Java class names into stream messages as dispatch mechanism.
- Put large binary objects into messages when object storage reference is more appropriate.
- Store secrets in headers or payload unless encrypted and policy-approved.

---

## 7. Consumer Standards

### 7.1 Offset strategy

Every consumer **MUST** define its start offset:

- first;
- last;
- next;
- absolute offset;
- timestamp;
- stored offset;
- external offset store.

**MUST** document whether this consumer is:

- live-only;
- replay-capable;
- catch-up processor;
- batch/rebuild processor;
- audit reader.

**MUST NOT**

- Start at `first` in production by accident.
- Start at `last` for a critical processor that must not miss retained messages.
- Change start offset without replay/idempotency impact analysis.

### 7.2 Offset storage

**MUST**

- Store offset only after processing side effects are durable.
- Store offsets periodically or transactionally according to recovery requirements.
- Avoid storing offset for every message unless latency/cost is acceptable and measured.
- Use consumer name consistently when relying on server-side offset tracking.
- Define behavior when stored offset is missing or out of retention.

**MUST NOT**

- Store offset before database/external side effect commits.
- Treat offset tracking as business processing guarantee.
- Use process memory as only offset store for durable consumers.

### 7.3 Idempotent consumption

**MUST** make consumers idempotent when they cause side effects.

Required options:

- processed-event table keyed by event ID;
- idempotent business transition;
- upsert by natural key/version;
- external API idempotency key;
- exactly-once-like state update through local transaction and offset coupling where feasible.

**MUST NOT** assume stream offset alone prevents duplicate side effects.

### 7.4 Replay safety

Any consumer that can start from old offsets **MUST** be replay-safe.

Replay-safe means:

- duplicate messages do not corrupt state;
- old events are compatible or rejected safely;
- side effects like email/webhook/payment are guarded;
- time-dependent logic uses event time vs processing time intentionally;
- metrics/logging distinguish replay from live processing.

---

## 8. Flow Control and Backpressure

**MUST**

- Use client flow strategy/credits intentionally.
- Bound in-memory backlog.
- Size processing executor queues.
- Monitor lag/offset progress.
- Stop or slow consumers when downstream systems are unavailable.

**MUST NOT**

- Accumulate unbounded messages in memory.
- Spawn unbounded per-message tasks.
- Block stream client internal threads with slow business logic if it affects flow/recovery.
- Use `parallelStream()` for stream message processing.

---

## 9. Ordering Standards

**MUST** define ordering scope:

- per stream;
- per super-stream partition;
- per aggregate ID;
- no ordering requirement.

**MUST**

- Keep messages for one aggregate/routing key in the same partition if ordered processing is required.
- Avoid parallel processing that violates ordering within a required key.
- Include sequence/version in payload when business order matters.

**MUST NOT**

- Assume global ordering in a super stream.
- Repartition without impact analysis.
- Use processing timestamp as ordering truth.

---

## 10. Retry and Failure Handling

### 10.1 Consumer failure taxonomy

**MUST** classify failures:

| Failure                      | Action                                                                |
| ---------------------------- | --------------------------------------------------------------------- |
| Invalid schema               | log/metric/quarantine; do not advance offset unless policy says skip. |
| Duplicate event              | no-op side effect; store/advance offset.                              |
| Temporary dependency outage  | pause/slow/retry without losing offset correctness.                   |
| Permanent business rejection | record rejection and advance offset only if replay will not help.     |
| Poison event                 | quarantine with event ID/offset and stop or skip per policy.          |

### 10.2 Stream retry strategy

RabbitMQ Streams do not behave like queue redelivery with ack/nack. Retry must be explicitly designed.

Allowed patterns:

- retry in handler with bounded attempts for short transient failures;
- pause consumer and resume after dependency recovery;
- write failed event to a separate retry/parking stream;
- store failure record and continue only when business policy allows skip;
- manual operator replay from offset/range.

**MUST NOT**

- Advance offset after failed side effect unless the event is intentionally skipped/quarantined.
- Loop forever on a poison event without visibility.
- Treat offset rewind as harmless when side effects are not idempotent.

---

## 11. Consumer Groups and Single Active Consumer

**MUST** document whether multiple consumers share work or each consumes independently.

When using single-active-consumer or super-stream consumer grouping:

**MUST**

- Define consumer name/group identity.
- Define failover behavior.
- Store offsets in a way compatible with failover.
- Test consumer promotion/rebalance.
- Ensure only one active processor handles a given partition when required.

**MUST NOT**

- Assume queue-style competing consumer semantics without verifying stream client feature behavior.
- Use multiple active consumers for same partition when side effects require order.

---

## 12. Security Standards

**MUST**

- Use least-privilege RabbitMQ user/vhost permissions.
- Use TLS where network trust is not guaranteed.
- Store credentials in secret manager/Kubernetes Secret.
- Avoid logging payloads/headers with secrets.
- Validate and size-limit payloads.
- Avoid Java native deserialization.

**MUST NOT**

- Use admin credentials from application code.
- Disable TLS validation.
- Use stream message data as file path, SQL, command, URL, class name, or reflection target without allow-listing and validation.

---

## 13. Observability Standards

### 13.1 Producer metrics

**MUST expose:**

- messages published;
- confirm success/failure/timeout;
- max/current unconfirmed messages;
- publish latency;
- retry-on-recovery count;
- deduplication conflicts/duplicates if available;
- producer recovery count;
- bytes published.

### 13.2 Consumer metrics

**MUST expose:**

- messages consumed;
- processing success/failure;
- processing latency;
- current offset;
- stored offset;
- lag where available;
- offset store failures;
- replay mode indicator;
- poison/quarantine count;
- flow-control backlog.

### 13.3 Logging/tracing

**MUST include:**

- stream/super stream;
- partition/routing key if applicable;
- event ID;
- offset;
- consumer name;
- producer name;
- schema version;
- correlation/trace ID.

**MUST NOT** use offset as business ID.

---

## 14. Testing Standards

### 14.1 Required tests

RabbitMQ Stream integration must test:

- publish/consume happy path;
- producer confirm failure/timeout behavior where practical;
- duplicate publish with same producer name + publishing ID;
- consumer restart from stored offset;
- replay from first/absolute/timestamp offset if supported;
- offset not stored before failed side effect;
- poison event handling;
- retention boundary behavior if possible;
- super stream routing/partitioning if used;
- concurrent consumer/failover behavior if used;
- schema compatibility.

### 14.2 Test environment

**MUST** use a real RabbitMQ broker with stream support for integration tests.

**MUST NOT** rely only on mocks for offset/replay/dedup correctness.

---

## 15. Performance Standards

**MUST**

- Measure throughput, publish confirm latency, consumer lag, memory, and CPU.
- Tune `maxUnconfirmedMessages`, batch/sub-entry settings, flow strategy, and executor sizes only with evidence.
- Keep payload size controlled.
- Use super streams only after single stream capacity/design is insufficient.
- Monitor disk usage and retention.

**MUST NOT**

- Increase batching without checking latency and failure impact.
- Use deduplication with a shared producer name across concurrent producers.
- Let consumers accumulate unbounded backlog.
- Use streams as a replacement for all queues.

---

## 16. Anti-Patterns

Forbidden by default:

- Treating stream consume as destructive queue consume.
- No explicit offset strategy.
- Storing offset before side effect commit.
- Starting from `first` accidentally in production.
- Starting from `last` and missing important retained events.
- Resetting publishing ID counter after restart while using deduplication.
- Multiple active producers with same deduplication producer name.
- No idempotency for replay-capable consumers.
- Global ordering assumption on super streams.
- Unbounded in-memory backlog.
- Logging full payloads.
- Using stream as permanent compliance archive without retention/storage policy.

---

## 17. Reviewer Checklist

A RabbitMQ Streams change is acceptable only if:

- [ ] Stream vs queue semantics are clearly understood.
- [ ] `Environment` lifecycle is application-managed.
- [ ] Producer lifecycle and confirm handling are explicit.
- [ ] Deduplication is correctly configured or explicitly not needed.
- [ ] Offset strategy is explicit.
- [ ] Offset storage happens after durable processing.
- [ ] Replay/idempotency behavior is safe.
- [ ] Retention impact is understood.
- [ ] Super stream partitioning/order is documented if used.
- [ ] Flow control/backpressure is bounded.
- [ ] Poison event policy exists.
- [ ] Security/TLS/credentials are handled.
- [ ] Metrics/logs/traces include stream, offset, event ID, and consumer/producer identity.
- [ ] Integration tests use a broker with stream support.

---

## 18. Prompt Contract for LLM Code Agent

```text
Follow strict-coding-standards__java-rabbitmq_stream.md.
Do not treat RabbitMQ Streams like classic queues.
Before coding, identify stream/super-stream name, offset strategy, offset storage, replay/idempotency behavior, producer confirm handling, deduplication policy, ordering scope, retention assumptions, and flow-control policy.
Do not store offsets before side effects are durable.
Do not use multiple active producers with the same deduplication producer name.
Do not claim exactly-once; prove idempotency/replay safety instead.
Do not log full payloads or secrets.
Add integration tests for duplicate, restart, replay, and poison-event behavior.
```

---

## 19. Source Anchors

- RabbitMQ Streams and Superstreams: https://www.rabbitmq.com/docs/streams
- RabbitMQ Stream Java Client stable docs: https://rabbitmq.github.io/rabbitmq-stream-java-client/stable/htmlsingle/
- RabbitMQ Stream Java Client API docs: https://rabbitmq.github.io/rabbitmq-stream-java-client/stable/api/
- RabbitMQ Stream tutorial — Hello World: https://www.rabbitmq.com/tutorials/tutorial-one-java-stream
- RabbitMQ Stream tutorial — Offset Tracking: https://www.rabbitmq.com/tutorials/tutorial-two-java-stream
- RabbitMQ Streams Offset Tracking blog: https://www.rabbitmq.com/blog/2021/09/13/rabbitmq-streams-offset-tracking
- RabbitMQ Streams Message Deduplication blog: https://www.rabbitmq.com/blog/2021/07/28/rabbitmq-streams-message-deduplication
