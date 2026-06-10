# Strict Coding Standards: Java RabbitMQ

**Scope:** Java applications that use RabbitMQ through AMQP 0-9-1 clients, especially `com.rabbitmq:amqp-client`, Spring AMQP, or similar wrappers.

**Primary goal:** make RabbitMQ integration predictable under failure, restart, retry, backpressure, duplicate delivery, broker failover, partial publish failure, and slow consumers.

This document is not a RabbitMQ tutorial. It is a strict implementation contract for LLM code agents and human reviewers.

---

## 1. Mandatory Baseline

### 1.1 Version and dependency rules

**MUST**

- Pin the exact RabbitMQ Java client version in the build system.
- Use dependency management/BOM or central version catalog when the project has multiple modules.
- Use the official RabbitMQ Java client for raw AMQP 0-9-1 integration unless the project standard mandates Spring AMQP.
- Keep client library version, broker version, TLS policy, and authentication mechanism documented.
- Treat client upgrade as behavior-affecting change that needs smoke tests for publish, consume, confirm, reconnect, TLS, and failure scenarios.

**MUST NOT**

- Add a new messaging abstraction/library without explaining why the existing project RabbitMQ abstraction is insufficient.
- Mix raw RabbitMQ Java client and Spring AMQP in the same flow unless there is an explicit migration boundary.
- Depend on transitive versions for RabbitMQ client, Netty, SLF4J, Jackson, Micrometer, or OpenTelemetry where those affect runtime behavior.

### 1.2 Protocol choice

**MUST** identify which RabbitMQ protocol/model is being used:

- AMQP 0-9-1 classic queue/quorum queue/exchange routing.
- RabbitMQ stream protocol.
- AMQP 1.0.
- MQTT/STOMP.

This file covers AMQP 0-9-1 queue/exchange integration. Use `strict-coding-standards__java-rabbitmq_stream.md` for RabbitMQ Streams.

---

## 2. LLM Agent Contract

When implementing RabbitMQ code, the LLM **MUST** answer these before changing code:

1. Is this producer, consumer, topology declaration, admin tooling, or test support?
2. Is message delivery at-most-once, at-least-once, or effectively-once through idempotency?
3. Is message ordering required? If yes, what is the ordering key and queue/consumer model?
4. What happens when processing succeeds but ack fails?
5. What happens when publish succeeds but confirm is lost?
6. What happens when consumer crashes after side effect but before ack?
7. What is the retry policy: immediate retry, delayed retry, DLQ, parking lot, or manual intervention?
8. What is the idempotency key?
9. What is the schema/version contract for the message body?
10. What metrics/logs/traces prove the flow is healthy?

If any answer is missing, the LLM must implement the safest minimal change and mark unresolved design questions in code review notes.

---

## 3. Messaging Semantics

### 3.1 Default guarantee

**MUST assume at-least-once delivery** unless the code explicitly proves otherwise.

RabbitMQ message processing can produce duplicates due to:

- producer retry after ambiguous publish result;
- broker redelivery after consumer disconnect;
- consumer crash after external side effect but before ack;
- connection recovery;
- DLQ/retry republishing;
- manual replay.

**MUST** make consumers idempotent for any message that triggers persistent side effects.

**MUST NOT** claim exactly-once behavior merely because publisher confirms, durable queues, transactions, or manual acknowledgements are used.

### 3.2 Allowed delivery models

| Model            |           Allowed? | Required controls                                                                                  |
| ---------------- | -----------------: | -------------------------------------------------------------------------------------------------- |
| At-most-once     |         Restricted | Only for telemetry/non-critical events; auto-ack allowed only with explicit loss acceptance.       |
| At-least-once    |            Default | Manual ack, idempotency, retry/DLQ, observability.                                                 |
| Effectively-once |         Restricted | Idempotency key, transactional/idempotent side effect, durable dedup record, replay-safe consumer. |
| Exactly-once     | Forbidden as claim | Do not use unless formally scoped to a subsystem and proven.                                       |

---

## 4. Connection and Channel Lifecycle

### 4.1 Connection policy

**MUST**

- Reuse long-lived `Connection` objects.
- Set client-provided connection name for observability.
- Configure heartbeat, connection timeout, socket timeout, TLS, credentials, virtual host, and recovery behavior explicitly.
- Close connections gracefully on application shutdown.
- Expose connection state/health through health checks or metrics.

**MUST NOT**

- Open a new connection per message.
- Hide connection creation inside business methods.
- Create unbounded connections per tenant/request/thread.
- Log credentials, broker URLs with passwords, TLS key material, or full connection strings.

### 4.2 Channel policy

**MUST**

- Treat `Channel` as not safely shareable across arbitrary threads.
- Prefer one channel per publishing worker or consuming thread/container.
- Keep channels reasonably long-lived.
- Close channels on shutdown or when permanently failed.
- Document whether a channel is publish-only, consume-only, or admin-only.

**MUST NOT**

- Open a channel for every published message.
- Share one channel across unrelated concurrent producers.
- Publish and ack concurrently on the same channel without proving client/threading safety.
- Use the same channel for topology mutation and high-volume publishing.

### 4.3 Recovery policy

**MUST**

- Explicitly decide whether automatic connection recovery is enabled.
- Test recovery with broker restart/network interruption.
- Make producer retry safe under ambiguous confirm state.
- Make consumer processing idempotent after redelivery.
- Re-declare required topology after recovery when the chosen client/container does not do so reliably.

**MUST NOT**

- Assume automatic recovery preserves in-flight publishes or application side effects.
- Treat reconnect as a substitute for publisher confirms, retry strategy, or idempotency.

---

## 5. Topology Standards

### 5.1 Topology ownership

**MUST** define topology ownership:

- application-owned local/dev topology;
- infrastructure-owned production topology;
- migration-managed topology;
- broker-policy-managed topology.

**MUST NOT** let every service freely mutate production exchanges, queues, bindings, and policies at startup unless this is an approved platform convention.

### 5.2 Exchange rules

**MUST**

- Use exchange names that encode domain/event boundary, not implementation class names.
- Choose exchange type intentionally: direct, topic, fanout, headers.
- Keep routing keys stable and documented.
- Version routing keys only when consumers need separate compatibility paths.

**MUST NOT**

- Publish directly to queue names unless explicitly using the default exchange as a deliberate local/simple pattern.
- Use topic wildcards as a substitute for clear event taxonomy.
- Change exchange type in place without a migration plan.

### 5.3 Queue rules

**MUST**

- Choose queue type intentionally: quorum queue, classic queue, stream queue, temporary/exclusive queue.
- Prefer quorum queues for replicated durable work queues where supported by platform policy.
- Configure durable queues for durable business messages.
- Configure DLX and retry policy for poison messages.
- Set queue limits/TTL only with documented consequence for data loss or dead-lettering.

**MUST NOT**

- Use auto-delete/exclusive queues for durable business work.
- Use queue TTL/message TTL without documenting expiration behavior.
- Rely on queue length as business state.
- Use queue names as tenant/user identifiers without cardinality review.

### 5.4 Binding rules

**MUST**

- Keep binding keys reviewable.
- Test routing behavior for each important event type.
- Avoid overlapping binding patterns that make delivery fan-out surprising.

---

## 6. Producer Standards

### 6.1 Publish contract

Every producer **MUST** define:

- exchange;
- routing key;
- message schema/version;
- content type;
- message ID or idempotency key;
- correlation ID/trace context;
- persistence mode;
- mandatory flag policy;
- publisher confirm policy;
- retry policy;
- logging/metrics.

### 6.2 Publisher confirms

**MUST**

- Use publisher confirms for durable business messages.
- Track unconfirmed messages in a bounded data structure.
- Handle negative acknowledgements.
- Handle confirm timeout as ambiguous, not as definitely failed.
- Use batch confirms carefully and document the max in-flight window.

**MUST NOT**

- Treat successful `basicPublish` return as proof that the broker safely accepted/persisted the message.
- Ignore `nack` confirms.
- Retry blindly without idempotency or duplicate-tolerant consumer behavior.
- Use publisher confirms and transactions together unless there is a very specific reason; prefer confirms for normal reliable publishing.

### 6.3 Mandatory publishing and returns

**MUST** use `mandatory=true` when unroutable messages must not disappear silently.

**MUST** install return listener/callback when using mandatory publishing.

**MUST NOT** assume publisher confirm means the message reached a queue. Publisher confirms confirm broker acceptance; routing failure must be handled separately with mandatory returns or topology guarantees.

### 6.4 Message properties

**MUST** set intentionally:

- `contentType`, e.g. `application/json`;
- `contentEncoding`, usually `utf-8` for text payloads;
- `messageId` or domain event ID;
- `correlationId`;
- `timestamp` if useful;
- `type` or event type header;
- `headers` for schema version and trace context;
- `deliveryMode=2` for persistent messages when durable storage is required.

**MUST NOT**

- Put secrets, tokens, passwords, or PII-heavy payloads in headers.
- Use headers as hidden business payload.
- Rely on broker timestamp as business event time.

### 6.5 Outbox pattern

**MUST** prefer transactional outbox when publishing is coupled to database state mutation.

**MUST NOT** perform this unsafe sequence for critical workflows:

```text
update database
publish RabbitMQ message
commit database
```

or:

```text
publish RabbitMQ message
update database
```

unless the failure windows are explicitly accepted.

**Preferred model:**

```text
transaction:
  update aggregate
  insert outbox event with unique event_id
commit
outbox publisher reads event
publish with confirms
mark outbox row published or retry
consumer uses event_id for idempotency
```

---

## 7. Consumer Standards

### 7.1 Manual acknowledgement default

**MUST** use manual acknowledgements for business messages.

**MUST ack only after:**

- payload is parsed;
- validation succeeds;
- idempotency check is done;
- side effect is committed;
- downstream publish/outbox action is made durable if required.

**MUST NOT** use auto-ack for messages that mutate database, call external systems, send emails, transfer money, change case state, or trigger irreversible side effects.

### 7.2 Ack/nack/reject rules

| Outcome                      | Required action                                                          |
| ---------------------------- | ------------------------------------------------------------------------ |
| Processed successfully       | `basicAck` once.                                                         |
| Duplicate already processed  | `basicAck` once.                                                         |
| Invalid permanent message    | `basicReject`/`basicNack` with `requeue=false`, usually to DLQ.          |
| Temporary downstream failure | retry through controlled retry mechanism, not infinite hot requeue.      |
| Consumer shutdown            | stop receiving, finish/timeout in-flight messages, then ack/nack safely. |

**MUST NOT**

- Ack before side effects are durable.
- Ack twice.
- Nack with `requeue=true` in a tight loop.
- Use `multiple=true` acknowledgements when processing is parallel unless ordering and delivery-tag ownership are proven.

### 7.3 Prefetch and backpressure

**MUST** set `basicQos`/prefetch explicitly for every consumer.

**MUST** size prefetch based on:

- average processing latency;
- message size;
- memory per message;
- downstream capacity;
- desired parallelism;
- retry behavior.

**MUST NOT** leave prefetch unbounded for slow/heavy consumers.

**MUST NOT** increase prefetch to hide slow business logic without measuring memory, latency, and redelivery behavior.

### 7.4 Parallel processing

**MUST**

- Preserve channel/delivery-tag ownership when processing messages asynchronously.
- Use bounded executor queues.
- Ack/nack on a safe channel/threading model.
- Preserve ordering per key if required.
- Stop intake when worker backlog is full.

**MUST NOT**

- Spawn unbounded threads per delivery.
- Use `parallelStream()` for message processing.
- Share mutable consumer state across worker threads without synchronization.

### 7.5 Idempotency

Every side-effecting consumer **MUST** have an idempotency strategy:

- unique event/message ID table;
- natural business key with version;
- idempotent external API key;
- state machine guard transition;
- exactly-once database constraint for action result.

**MUST** treat redelivery as normal operation.

**MUST NOT** use in-memory dedup only for durable business workflows.

---

## 8. Retry and Dead Letter Standards

### 8.1 Retry taxonomy

**MUST** classify failure:

| Failure                   | Example                  | Action                                         |
| ------------------------- | ------------------------ | ---------------------------------------------- |
| Permanent invalid payload | schema violation         | DLQ/parking lot, no hot retry.                 |
| Business rejection        | illegal state transition | ack + audit, or DLQ if operator action needed. |
| Temporary dependency      | DB/network timeout       | bounded retry with delay.                      |
| Broker/client transient   | connection reset         | client recovery/retry with idempotency.        |
| Poison message            | always crashes consumer  | quarantine after max attempts.                 |

### 8.2 Forbidden retry patterns

**MUST NOT**

- Use immediate infinite `requeue=true` for permanent failures.
- Sleep inside RabbitMQ delivery callback as the primary retry mechanism.
- Block consumer thread for long backoff intervals.
- Retry non-idempotent side effects without idempotency key.
- Drop failed messages silently.

### 8.3 DLQ / parking lot

**MUST**

- Configure DLX/DLQ for queues that process business messages.
- Include original routing metadata, failure reason, attempt count, and timestamps.
- Provide an operator replay policy.
- Avoid infinite DLQ loops.
- Separate retry queues from final dead-letter/parking-lot queues.

**MUST NOT**

- Treat DLQ as permanent audit storage.
- Replay DLQ blindly without fixing root cause or verifying idempotency.

---

## 9. Payload and Schema Standards

### 9.1 Message envelope

Business messages **SHOULD** use a clear envelope:

```json
{
  "eventId": "uuid-or-ulid",
  "eventType": "CaseEscalated",
  "schemaVersion": 1,
  "occurredAt": "2026-06-10T10:15:30Z",
  "producer": "case-service",
  "correlationId": "...",
  "payload": {}
}
```

**MUST**

- Use explicit schema version.
- Use UTC instants for event time.
- Validate payload at consumer boundary.
- Keep payload backward/forward compatibility policy.

**MUST NOT**

- Serialize Java objects directly.
- Use Java native serialization.
- Put class names in payload as dispatch mechanism.
- Let consumers infer event type from exchange/queue name only.

### 9.2 JSON rules

**MUST** follow `strict-coding-standards__java_json.md`.

**MUST** decide unknown-field policy:

- ignore unknown fields for forward-compatible events; or
- reject unknown fields for command/request messages.

**MUST** preserve decimal precision for money and identifiers.

---

## 10. Transactions and Consistency

### 10.1 RabbitMQ transactions

**MUST NOT** use AMQP transactions as the default reliability mechanism.

Publisher confirms plus idempotency/outbox is the default reliable pattern.

### 10.2 Database + RabbitMQ consistency

**MUST** avoid pretending database and RabbitMQ publish are atomic unless using an explicit coordination strategy.

Allowed patterns:

- transactional outbox;
- inbox/idempotent consumer;
- saga/process manager;
- compensating action;
- manual reconciliation.

Forbidden pattern:

```java
repository.save(entity);
channel.basicPublish(exchange, routingKey, props, body);
// no outbox, no confirm, no idempotency, no reconciliation
```

---

## 11. Security Standards

### 11.1 Authentication and authorization

**MUST**

- Use least-privilege RabbitMQ users per application/service.
- Restrict virtual hosts, exchange/queue permissions, and configure/write/read rights.
- Store credentials in secret manager/Kubernetes Secret, not code.
- Rotate credentials through configuration.

**MUST NOT**

- Use administrator credentials from applications.
- Share one RabbitMQ user across all services.
- Log connection URLs with credentials.

### 11.2 TLS

**MUST**

- Use TLS for broker connections across untrusted networks.
- Validate server certificates.
- Configure truststore/keystore explicitly where needed.
- Avoid disabling hostname verification.

**MUST NOT**

- Use trust-all SSL context.
- Disable certificate validation to “fix” local connectivity without environment guard.

### 11.3 Payload security

**MUST**

- Redact sensitive headers/payload fields in logs.
- Enforce message size limits.
- Validate untrusted payload before processing.
- Avoid deserialization of arbitrary classes.

---

## 12. Observability Standards

### 12.1 Logging

**MUST log:**

- connection lifecycle changes;
- publisher confirm failures/timeouts;
- unroutable returns;
- consumer failure classification;
- DLQ movement;
- replay decisions;
- topology declaration failure;
- recovery events.

**MUST include:**

- service name;
- connection name;
- exchange;
- routing key;
- queue;
- event type;
- event ID;
- correlation ID;
- delivery tag only if useful and not treated as stable business ID.

**MUST NOT log:**

- full payload by default;
- credentials;
- tokens;
- PII;
- secrets in headers.

### 12.2 Metrics

**MUST expose:**

- publish count/success/failure;
- confirm latency;
- unconfirmed message count;
- consumer processed/succeeded/failed;
- redelivery count;
- DLQ count;
- retry count;
- consumer processing latency;
- backlog/queue depth where available;
- connection/channel recovery count;
- in-flight messages;
- executor backlog.

### 12.3 Tracing

**MUST** propagate trace context through message headers when the organization uses distributed tracing.

**MUST** create spans for publish and consume boundaries with low-cardinality attributes.

**MUST NOT** put high-cardinality message IDs as metric labels.

---

## 13. Spring AMQP Rules

When using Spring AMQP:

**MUST**

- Configure listener container acknowledgment mode explicitly.
- Configure prefetch/concurrency explicitly.
- Define retry/DLQ behavior in container or advice chain.
- Ensure message converter configuration is centralized.
- Avoid hidden auto-declaration in production unless approved.
- Test redelivery, DLQ, and conversion failure.

**MUST NOT**

- Assume `@RabbitListener` is safe without ack/retry/DLQ policy.
- Put business logic directly inside listener methods if it prevents testing or transaction clarity.
- Use default JSON polymorphic deserialization without allow-listing.

---

## 14. Testing Standards

### 14.1 Required tests

RabbitMQ integration must have tests for:

- successful publish and consume;
- publisher confirm failure/timeout if practical;
- unroutable mandatory publish;
- invalid payload;
- duplicate message redelivery;
- consumer crash before ack;
- downstream failure retry;
- DLQ routing;
- idempotency;
- message schema compatibility;
- connection recovery smoke test when supported by test environment.

### 14.2 Test environment

**MUST** prefer Testcontainers or an equivalent real RabbitMQ broker for integration tests.

**MUST NOT** rely only on mocks for messaging correctness.

Mocks may be used for pure business logic behind the message handler.

---

## 15. Performance Standards

**MUST**

- Benchmark publisher confirm strategy before increasing throughput-critical publish rate.
- Tune prefetch based on measurement.
- Use batching only when ordering, latency, and failure semantics are acceptable.
- Keep payloads reasonably small.
- Use compression only with evidence and compatibility checks.
- Monitor consumer capacity and broker memory/disk alarms.

**MUST NOT**

- Increase concurrency without checking downstream capacity.
- Increase prefetch until memory spikes.
- Put large binary payloads in RabbitMQ if object storage + reference is better.
- Treat RabbitMQ queue as a database/archive.

---

## 16. Anti-Patterns

Forbidden by default:

- Auto-ack business messages.
- No idempotency on side-effecting consumer.
- Opening connection/channel per message.
- Infinite immediate requeue loop.
- Blind `basicPublish` without confirms for critical messages.
- Claiming exactly-once without proof.
- Direct Java object serialization.
- Logging full message body.
- One catch-all exchange/routing-key for all event types.
- Queue as long-term storage.
- Business workflow hidden in retry queue topology.
- Startup code silently mutating production topology.
- Unbounded executor in consumer.
- `Thread.sleep` in listener for retry/backoff.

---

## 17. Reviewer Checklist

A RabbitMQ change is acceptable only if:

- [ ] Protocol/model is clear: AMQP queue/exchange vs stream.
- [ ] Connection/channel lifecycle is explicit.
- [ ] Publisher confirms are used or non-use is justified.
- [ ] Mandatory/unroutable handling is defined where needed.
- [ ] Consumer ack mode is explicit.
- [ ] Prefetch is explicit and justified.
- [ ] Retry/DLQ/parking-lot behavior is defined.
- [ ] Idempotency exists for side effects.
- [ ] Payload schema/version is explicit.
- [ ] Message size and serialization are controlled.
- [ ] Security credentials/TLS are handled correctly.
- [ ] Logging avoids sensitive payloads.
- [ ] Metrics/tracing exist for publish/consume/failure.
- [ ] Tests cover duplicate/redelivery/failure paths.
- [ ] Operational replay procedure is documented for DLQ.

---

## 18. Prompt Contract for LLM Code Agent

Use this instruction when asking an LLM to modify RabbitMQ code:

```text
Follow strict-coding-standards__java_rabbitmq.md.
Do not implement RabbitMQ code until you identify producer/consumer/topology role, delivery semantics, ack policy, retry/DLQ policy, idempotency key, message schema/version, connection/channel lifecycle, and observability.
Use manual ack for business consumers.
Use publisher confirms for durable business publishes.
Do not claim exactly-once.
Do not open connection/channel per message.
Do not use Java native serialization.
Do not log full payloads or secrets.
If a failure window exists, document it and add tests or an outbox/inbox/idempotency mechanism.
```

---

## 19. Source Anchors

- RabbitMQ Java Client API Guide: https://www.rabbitmq.com/client-libraries/java-api-guide
- RabbitMQ Java Client Library: https://www.rabbitmq.com/client-libraries/java-client
- RabbitMQ Consumer Acknowledgements and Publisher Confirms: https://www.rabbitmq.com/docs/confirms
- RabbitMQ Reliability Guide: https://www.rabbitmq.com/docs/reliability
- RabbitMQ Consumer Prefetch: https://www.rabbitmq.com/docs/consumer-prefetch
- RabbitMQ Dead Letter Exchanges: https://www.rabbitmq.com/docs/dlx
- RabbitMQ Publishers: https://www.rabbitmq.com/docs/publishers
- RabbitMQ Consumers: https://www.rabbitmq.com/docs/consumers
