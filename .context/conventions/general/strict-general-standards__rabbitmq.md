# Strict General Standards: RabbitMQ

> Mandatory conventions for LLMs, code agents, and engineers when designing, implementing, reviewing, or modifying RabbitMQ-based messaging systems.

---

## 0. Purpose

RabbitMQ must be treated as a messaging broker with explicit routing, queue, acknowledgement, and delivery semantics.

This standard exists to force every LLM-generated RabbitMQ implementation to preserve:

- clear exchange/queue/binding topology;
- reliable publisher confirmation;
- safe consumer acknowledgement;
- bounded retry and dead-letter behavior;
- queue durability semantics;
- routing correctness;
- backpressure handling;
- operational observability;
- security isolation;
- failure recovery.

RabbitMQ code is only acceptable when the generated implementation explicitly defines topology, queue type, routing keys, durability, publisher confirms, consumer acknowledgements, prefetch, retry, DLQ, and monitoring.

---

## 1. Core Mental Model

RabbitMQ is a broker that receives messages from publishers, routes them through exchanges using bindings, stores them in queues, and delivers them to consumers.

Required mental model:

```text
Publisher -> Exchange -> Binding -> Queue -> Consumer -> Ack/Nack
```

RabbitMQ is not Kafka.  
A queue is not a replayable event log by default.  
An exchange is not a service.  
A routing key is not a topic name only.  
Acknowledgement is not optional for reliable processing.  
Publisher confirm is not the same as consumer ack.  
DLQ is not a substitute for error handling.

---

## 2. Scope

This standard applies to:

- AMQP 0-9-1 based RabbitMQ usage;
- publisher code;
- consumer code;
- exchanges;
- queues;
- bindings;
- routing keys;
- quorum queues;
- classic queues where justified;
- dead-letter exchanges;
- retry queues;
- delayed delivery patterns;
- request/reply;
- work queues;
- pub/sub fanout;
- topic routing;
- RabbitMQ Streams where explicitly selected;
- deployment and operational readiness.

It does not replace general event or command standards. It specializes broker-specific behavior.

---

## 3. Non-Negotiable Rules

### 3.1 RabbitMQ Must Not Be Used Without a Messaging Semantics Decision

Before generating RabbitMQ code, the LLM must classify the flow:

- work queue;
- command dispatch;
- event notification;
- pub/sub fanout;
- routing by topic;
- request/reply;
- delayed/retry workflow;
- dead-letter processing;
- stream-like workload.

If the flow requires long-term replay by multiple independent consumers, Kafka or RabbitMQ Streams may be more appropriate than ordinary queues.

### 3.2 Topology Must Be Explicit

Every implementation must define:

- exchange name;
- exchange type;
- queue name;
- queue type;
- binding key;
- routing key;
- durability;
- dead-letter exchange;
- retry policy;
- consumer prefetch;
- publisher confirm usage;
- acknowledgement mode;
- ownership.

A publisher or consumer with implicit/unknown topology is not acceptable.

### 3.3 Publisher Confirms Are Required for Reliable Publishing

Reliable publishers must enable publisher confirms.

Do not generate fire-and-forget publishing for important business messages.

The publisher must handle:

- ack from broker;
- nack from broker;
- unroutable message;
- return callback/mandatory flag where appropriate;
- connection/channel failure;
- retry with idempotency;
- shutdown with in-flight confirms.

### 3.4 Manual Consumer Acknowledgement Is Required for Side Effects

Consumers that perform side effects must use manual acknowledgement.

Valid sequence:

```text
receive -> validate -> process side effect durably -> ack
```

Invalid sequence:

```text
receive -> auto-ack -> process side effect
```

unless message loss is explicitly acceptable.

### 3.5 Prefetch Must Be Explicit

Consumer prefetch controls in-flight unacknowledged messages.

Do not use unlimited prefetch in production consumers.

Prefetch must consider:

- handler latency;
- memory per message;
- downstream capacity;
- fairness between consumers;
- retry behavior;
- graceful shutdown.

### 3.6 Queue Type Must Be Chosen Intentionally

Do not let queue type be accidental.

Default production guidance:

- use quorum queues for replicated durable high-availability queues;
- use classic queues only with explicit justification;
- use streams only for stream/replay-style workloads;
- use transient/exclusive queues only for temporary/session-style workloads.

### 3.7 DLQ Must Be Designed, Not Bolted On

Every business queue must define poison message behavior.

A DLQ must include:

- dead-letter exchange;
- dead-letter routing key;
- maximum retry count;
- reason headers or failure metadata;
- monitoring;
- replay policy;
- retention policy;
- owner.

### 3.8 Retry Must Be Bounded

Infinite requeue loops are forbidden.

A consumer must not do:

```text
catch error -> nack(requeue=true) forever
```

Retry must be bounded by:

- attempt count;
- delayed retry tiers;
- DLQ after max attempts;
- circuit breaker/backoff;
- poison message classification.

### 3.9 Idempotency Is Still Required

RabbitMQ reliable delivery is generally at-least-once when retry/redelivery is involved.

Every side-effecting consumer must be idempotent using one of:

- message id deduplication;
- idempotency key;
- business key upsert;
- processed message table;
- monotonic version check;
- transactional inbox.

Acknowledgements do not remove the need for idempotency.

### 3.10 Routing Must Be Contracted

Routing keys and binding patterns are public contracts between publishers and consumers.

Do not randomly create routing keys in producer code without topology governance.

---

## 4. RabbitMQ vs Kafka Decision Gate

Use RabbitMQ when:

- work distribution is the primary goal;
- messages should be consumed and then removed;
- routing flexibility matters;
- request/reply is required;
- delayed retry/DLQ workflows are central;
- command dispatch is required;
- per-queue consumer backpressure matters;
- AMQP interoperability is required.

Use Kafka when:

- replayable event log is required;
- many independent consumers need the same history;
- high-throughput event stream processing is central;
- retention independent of consumption matters;
- ordered event history per key matters;
- compacted latest-state topics are required.

Do not use RabbitMQ as an event store unless RabbitMQ Streams or another explicit storage/replay model is chosen and justified.

---

## 5. Exchange Standards

### 5.1 Exchange Type Selection

Choose exchange type intentionally.

| Exchange Type    | Use For                        | Avoid When                                   |
| ---------------- | ------------------------------ | -------------------------------------------- |
| Direct           | exact routing key match        | many dynamic pattern routes are needed       |
| Topic            | wildcard pattern routing       | routing patterns become unreadable/spaghetti |
| Fanout           | broadcast to all bound queues  | consumers need selective routing             |
| Headers          | complex header-based routing   | routing could be expressed simply by key     |
| Default exchange | simple direct-to-queue publish | shared production topology contracts         |

### 5.2 Exchange Naming

Recommended pattern:

```text
<domain>.<capability>.<message-kind>.exchange
```

Examples:

```text
licensing.application.events.exchange
enforcement.case.commands.exchange
notification.email.work.exchange
billing.invoice.events.exchange
```

Avoid:

```text
exchange1
main
default
messages
app-exchange
```

### 5.3 Exchange Durability

Production exchanges must be durable unless explicitly temporary.

Temporary exchanges must be documented as such.

### 5.4 Alternate Exchange

For important routes, consider alternate exchange or mandatory publish returns for unroutable messages.

Unroutable important messages must not disappear silently.

---

## 6. Queue Standards

### 6.1 Queue Naming

Recommended pattern:

```text
<consumer-service>.<purpose>.queue
```

Examples:

```text
email-service.send-email.queue
case-service.assignment-projection.queue
audit-service.case-events-loader.queue
```

For DLQ:

```text
<consumer-service>.<purpose>.dlq
```

For retry tiers:

```text
<consumer-service>.<purpose>.retry.10s.queue
<consumer-service>.<purpose>.retry.1m.queue
<consumer-service>.<purpose>.retry.10m.queue
```

### 6.2 Queue Ownership

Every queue must have one clear consuming application owner.

Multiple service teams consuming from the same queue is usually wrong. Use separate queues bound to the same exchange if each service needs a copy.

### 6.3 Queue Durability

Durable business queues are required for important messages.

But durability has two parts:

- durable queue declaration;
- persistent messages.

Both must be configured where data safety matters.

### 6.4 Quorum Queues

Use quorum queues when queue availability and replication matter.

The implementation must account for:

- leader election;
- Raft replication;
- quorum availability;
- storage overhead;
- delivery limits;
- poison message behavior;
- operational metrics.

Do not use legacy mirrored classic queues for new designs.

### 6.5 Classic Queues

Classic queues may be acceptable for:

- low-criticality messages;
- temporary workloads;
- single-node/dev workloads;
- performance-sensitive workloads where loss/availability trade-off is accepted;
- compatibility constraints.

The justification must be explicit.

### 6.6 Temporary and Exclusive Queues

Temporary/exclusive/auto-delete queues are acceptable for:

- request/reply response queues;
- WebSocket/session-specific subscriptions;
- ephemeral event listeners;
- tests.

They are not acceptable for durable business workflows.

---

## 7. Routing Key Standards

### 7.1 Routing Key Naming

Use dot-separated routing keys with stable domain semantics.

Examples:

```text
application.submitted
application.approved
case.assigned
case.closed
email.send.requested
invoice.payment.failed
```

Avoid:

```text
route1
data
foo
serviceA
process
```

### 7.2 Topic Routing

Topic exchange wildcard rules must remain readable.

Good:

```text
case.*
application.submitted
invoice.payment.*
```

Risky:

```text
#
*.created.*.*.#
```

A binding of `#` in production must be justified and reviewed.

### 7.3 Routing Versioning

Do not version routing keys unless routing behavior or consumer contract requires it.

Prefer schema/message version in payload/header.

Use new exchange or route when backward compatibility cannot be preserved.

---

## 8. Message Contract Standards

### 8.1 Required Metadata

Business messages must include:

```json
{
  "messageId": "uuid",
  "messageType": "EmailSendRequested",
  "messageVersion": 1,
  "source": "case-service",
  "correlationId": "...",
  "causationId": "...",
  "traceId": "...",
  "tenantId": "...",
  "occurredAt": "2026-06-10T09:15:30Z",
  "publishedAt": "2026-06-10T09:15:31Z",
  "data": {}
}
```

### 8.2 Message ID

`messageId` must be stable across publish retries.

It is used for idempotency and tracing.

### 8.3 Message Type

Commands should use imperative names:

```text
SendEmail
GenerateReport
ProcessPayment
```

Events should use past-tense names:

```text
EmailSent
ReportGenerated
PaymentProcessed
```

Do not mix command and event semantics.

### 8.4 Payload Size

RabbitMQ messages should not carry large binary payloads unless explicitly justified.

Prefer:

- object storage reference;
- signed URL;
- metadata + content location;
- chunking only with strong reason.

Large messages can harm memory, queue storage, replication, and consumer throughput.

---

## 9. Publisher Standards

### 9.1 Publisher Confirms

Publisher confirms must be enabled for important messages.

Publisher must handle:

- confirmed publish;
- negative acknowledgement;
- timeout waiting for confirm;
- channel closure;
- connection failure;
- unroutable messages;
- retry without duplicate unsafe side effects.

### 9.2 Mandatory Flag and Returns

For important directed messages, use the AMQP mandatory flag or equivalent routing failure detection when appropriate.

If a message cannot be routed, the publisher must know.

### 9.3 Publishing Transactions

AMQP transactions are usually not the default performance-friendly option.

Prefer publisher confirms for publication safety.

If database write + RabbitMQ publish must be atomic, use transactional outbox rather than naive dual write.

### 9.4 Connection and Channel Management

Rules:

- connections are long-lived;
- channels are cheaper than connections but not free;
- do not open a new connection per message;
- recover connections/channels safely;
- declare topology at startup or via deployment automation;
- handle topology declaration mismatch explicitly.

---

## 10. Consumer Standards

### 10.1 Manual Ack

Side-effect consumers must use manual ack.

Ack only after successful durable processing.

### 10.2 Nack/Reject

Failure behavior must be explicit:

| Failure                      | Recommended Action                            |
| ---------------------------- | --------------------------------------------- |
| transient dependency timeout | bounded retry/backoff                         |
| validation failure           | reject/dead-letter                            |
| poison message               | dead-letter                                   |
| duplicate message            | ack no-op                                     |
| stale business version       | ack no-op or compensate by policy             |
| unknown schema               | dead-letter or park                           |
| fatal application bug        | stop consumer or dead-letter by safety policy |

### 10.3 Requeue

`requeue=true` must be used carefully.

Repeated immediate requeue can create a tight failure loop.

Prefer delayed retry queues or backoff.

### 10.4 Prefetch

Set prefetch based on processing characteristics.

Examples:

| Workload                     | Prefetch Guidance         |
| ---------------------------- | ------------------------- |
| slow external HTTP call      | low prefetch              |
| CPU-heavy processing         | around worker concurrency |
| fast DB update               | moderate prefetch         |
| large messages               | low prefetch              |
| strict per-consumer fairness | low prefetch              |

### 10.5 Graceful Shutdown

Consumer shutdown must:

- stop accepting new messages;
- finish or safely abandon in-flight messages;
- ack completed messages;
- not ack incomplete messages;
- close channel/connection gracefully;
- expose shutdown logs/metrics.

---

## 11. Retry and DLQ Standards

### 11.1 Retry Topology

Recommended retry topology:

```text
main.exchange -> main.queue -> consumer
consumer failure -> retry.exchange -> retry.queue with TTL -> main.exchange
max attempts exceeded -> dlx.exchange -> dlq
```

But topology must be explicit and tested.

### 11.2 Attempt Count

Attempt count must be tracked via:

- `x-death` header;
- custom attempt header;
- message metadata;
- retry state store.

Do not retry blindly.

### 11.3 DLQ Payload

DLQ handling must preserve:

- original exchange;
- original routing key;
- original message id;
- original payload;
- failure reason;
- failure class;
- consumer name;
- timestamp;
- attempt count;
- correlation id.

### 11.4 DLQ Replay

Replay tooling must avoid immediate re-poisoning.

Replay requires:

- fix or classification of failure;
- controlled batch size;
- rate limit;
- traceability;
- idempotent consumer;
- approval for sensitive/high-risk workflows.

---

## 12. Request/Reply Standards

RabbitMQ request/reply is acceptable when:

- caller expects asynchronous broker-mediated response;
- correlation id is used;
- response timeout is explicit;
- response queue lifecycle is controlled;
- duplicate responses are safe;
- service unavailability is handled.

Do not implement synchronous RPC over RabbitMQ by default.

For request/reply:

- set `correlationId`;
- set `replyTo`;
- define timeout;
- handle no response;
- handle duplicate response;
- handle late response;
- ensure response queue is not leaked.

---

## 13. Ordering Standards

RabbitMQ queues provide FIFO-like behavior, but observed ordering can be affected by:

- multiple publishers;
- multiple channels;
- multiple consumers;
- redelivery;
- priority queues;
- requeue;
- prefetch;
- retry topology.

If strict ordering is required:

- use a single queue for the ordered key scope;
- use one active consumer or partition by key into multiple queues;
- avoid requeue loops;
- avoid priority queues;
- design idempotent/stale-message handling.

Do not promise global ordering casually.

---

## 14. Security Standards

RabbitMQ deployment must enforce:

- TLS in production;
- per-application users;
- least-privilege permissions per vhost;
- separate vhosts for environments/tenants when appropriate;
- no default guest access beyond local/dev use;
- secret rotation;
- management UI protection;
- network isolation;
- audit of admin/topology changes;
- message sensitivity classification.

### 14.1 Permissions

Permissions must distinguish:

- configure;
- write;
- read.

Do not grant wildcard permissions to every service.

### 14.2 Sensitive Data

Messages may be persisted, replicated, logged, and dead-lettered.

Rules:

- minimize PII;
- avoid secrets in payload;
- encrypt sensitive payloads only with managed keys;
- ensure DLQ retention complies with data policy;
- do not log full payload by default.

---

## 15. Observability Standards

Every RabbitMQ-based service must expose or consume metrics for:

- publish rate;
- confirm latency;
- publish nack count;
- unroutable message count;
- consumer delivery rate;
- ack/nack/reject rate;
- redelivery count;
- queue depth;
- queue age/oldest message age;
- unacknowledged messages;
- consumer count;
- prefetch saturation;
- DLQ rate;
- retry rate;
- connection/channel churn;
- memory/disk alarms;
- quorum queue health if used.

Logs must include:

- exchange;
- routing key;
- queue;
- message id;
- message type;
- correlation id;
- attempt count;
- failure class;
- consumer name.

---

## 16. Testing Standards

RabbitMQ code must be tested with:

- topology declaration tests;
- publisher confirm success/failure tests;
- unroutable message tests;
- consumer ack-after-processing tests;
- consumer nack/reject tests;
- retry limit tests;
- DLQ routing tests;
- duplicate/redelivery tests;
- idempotency tests;
- prefetch/concurrency tests;
- connection failure recovery tests;
- graceful shutdown tests;
- contract tests for message schema;
- integration tests with real RabbitMQ or faithful test container.

Mock-only tests are insufficient for broker behavior.

---

## 17. Common Anti-Patterns

### 17.1 Auto-Ack Side Effect Consumer

Message is considered handled before processing succeeds.

### 17.2 Infinite Requeue Loop

A poison message is immediately requeued forever.

### 17.3 No Publisher Confirms

Publisher assumes the broker accepted the message without proof.

### 17.4 One Queue Shared by Multiple Independent Services

Independent consumers compete for messages instead of each receiving their own copy.

Use separate queues bound to the same exchange.

### 17.5 Exchange as Business Logic Engine

Routing topology becomes hidden business logic that nobody owns.

### 17.6 `#` Binding Everywhere

Everything receives everything, increasing coupling and data exposure.

### 17.7 DLQ Without Owner

Dead letters accumulate forever without action.

### 17.8 Large Payload Queue

Broker becomes file storage.

### 17.9 New Connection Per Message

Destroys performance and stability.

### 17.10 Queue Used as Database

Long-lived queue backlog is used as persistent state.

### 17.11 RabbitMQ as Kafka

Trying to replay historical events from normal queues after consumers have acked them.

### 17.12 Kafka as RabbitMQ

Using Kafka for short-lived command work queues without replay/streaming need.

---

## 18. LLM Implementation Checklist

Before generating RabbitMQ code, answer:

- What messaging pattern is this?
- Why RabbitMQ instead of HTTP/Kafka/database polling?
- What exchange type is used?
- What is the exchange name?
- What queue type is used?
- What is the queue name?
- What routing/binding key is used?
- Is the queue durable?
- Are messages persistent?
- Are publisher confirms enabled?
- What happens if a message is unroutable?
- Is consumer acknowledgement manual?
- What is the prefetch?
- What is the retry policy?
- What is the DLQ policy?
- Is the consumer idempotent?
- What metrics/logs are emitted?
- What permissions are required?

If any answer is missing, the implementation is incomplete.

---

## 19. Required Code Generation Rules

When generating publisher code, LLMs must include:

- connection/channel lifecycle;
- exchange declaration or reference to provisioned topology;
- routing key;
- persistent message setting if needed;
- publisher confirm handling;
- unroutable message handling;
- retry/backoff;
- correlation/message id;
- graceful shutdown;
- tests or test plan.

When generating consumer code, LLMs must include:

- queue declaration or reference to provisioned topology;
- manual ack;
- idempotency;
- prefetch;
- failure classification;
- bounded retry/DLQ;
- duplicate handling;
- graceful shutdown;
- observability;
- tests or test plan.

When generating topology, LLMs must include:

- exchange type;
- queue type;
- durability;
- binding;
- DLX;
- retry queues;
- permissions;
- ownership.

---

## 20. Review Checklist

A RabbitMQ change is acceptable only if reviewers can answer yes:

- [ ] Messaging pattern is explicitly classified.
- [ ] Exchange/queue/binding topology is documented.
- [ ] Queue type is justified.
- [ ] Publisher confirms are enabled for important messages.
- [ ] Unroutable messages are handled.
- [ ] Consumer uses manual ack for side effects.
- [ ] Ack occurs after durable processing.
- [ ] Prefetch is explicit.
- [ ] Retry is bounded.
- [ ] DLQ is monitored and replayable.
- [ ] Consumer is idempotent.
- [ ] Large payloads are avoided or justified.
- [ ] Security permissions are least-privilege.
- [ ] Sensitive data is minimized.
- [ ] Queue depth and message age are monitored.
- [ ] Failure behavior is tested.

---

## 21. Acceptance Criteria

A RabbitMQ implementation is accepted only when:

1. Topology is explicit and owned.
2. Publisher confirms are used where reliability matters.
3. Consumers manually ack after successful processing.
4. Retry is bounded and DLQ is defined.
5. Idempotency handles redelivery.
6. Queue type is intentional.
7. Routing keys are stable contracts.
8. Observability exists before production.
9. Permissions are least privilege.
10. Failure paths are tested with a real broker or faithful equivalent.

---

## 22. Enforcement Snippet for LLM Code Agents

Use this instruction when asking an LLM to generate RabbitMQ code:

```text
Follow strict-general-standards__rabbitmq.md.
Before writing code, classify the messaging pattern: work queue, command dispatch, event notification, pub/sub, topic routing, request/reply, retry, or DLQ.
Define exchange, queue, binding, routing key, queue type, durability, DLX, retry, owner, and permissions.
For publishers, enable publisher confirms for important messages and handle unroutable/nacked messages.
For consumers, use manual ack, explicit prefetch, idempotent processing, bounded retry, DLQ, and observability.
Reject auto-ack side-effect consumers, infinite requeue loops, wildcard permissions, DLQ without owner, and RabbitMQ-as-Kafka replay assumptions.
```

---

## 23. References

- RabbitMQ Documentation: https://www.rabbitmq.com/docs
- RabbitMQ AMQP 0-9-1 Model: https://www.rabbitmq.com/tutorials/amqp-concepts
- RabbitMQ Queues: https://www.rabbitmq.com/docs/queues
- RabbitMQ Consumer Acknowledgements and Publisher Confirms: https://www.rabbitmq.com/docs/confirms
- RabbitMQ Dead Letter Exchanges: https://www.rabbitmq.com/docs/dlx
- RabbitMQ Quorum Queues: https://www.rabbitmq.com/docs/quorum-queues
- Enterprise Integration Patterns: Message Channel: https://www.enterpriseintegrationpatterns.com/patterns/messaging/MessageChannel.html
- Enterprise Integration Patterns: Dead Letter Channel: https://www.enterpriseintegrationpatterns.com/patterns/messaging/DeadLetterChannel.html
