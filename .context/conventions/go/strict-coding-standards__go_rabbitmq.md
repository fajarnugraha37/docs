# Strict Coding Standards — Go RabbitMQ

Status: Mandatory  
Scope: Go services publishing, consuming, routing, retrying, dead-lettering, or administrating RabbitMQ / AMQP 0-9-1 messages using `github.com/rabbitmq/amqp091-go` or project-approved compatible clients.  
Audience: LLM code agents, developers, reviewers, maintainers, platform engineers, and reliability engineers.  
Baseline: Go 1.24+; compatible with Go 1.25/1.26 standards in this repository.

---

## 1. Purpose

RabbitMQ code is not just `Publish` and `Consume`. RabbitMQ is a broker with exchanges, queues, bindings, routing keys, acknowledgements, publisher confirms, prefetch, dead-letter exchanges, connection/channel lifecycle, and broker-side topology declarations.

An LLM MUST NOT generate RabbitMQ code that silently loses messages, auto-acks before processing, leaks channels, publishes without confirms for durable workflows, or retries poison messages forever.

This standard governs:

- RabbitMQ connection/channel lifecycle in Go.
- Publisher implementation.
- Consumer implementation.
- Topology declaration and ownership.
- Acknowledgement, nack, reject, requeue, prefetch, and confirm semantics.
- Retry, DLX/DLQ, poison-message, and replay policy.
- Message envelope, headers, serialization, telemetry, and testing.

---

## 2. Source authority

When this document conflicts with project-specific architecture docs, the project-specific docs win only if they are stricter.

Primary references:

- RabbitMQ AMQP 0-9-1 concepts documentation.
- RabbitMQ consumer acknowledgements and publisher confirms documentation.
- RabbitMQ dead letter exchange documentation.
- `github.com/rabbitmq/amqp091-go` package documentation and examples.
- Go `context`, `errors`, `log/slog`, `encoding/json`, `sync`, and `testing` package documentation.
- Project standards for Go context, error handling, telemetry, JSON, data mapper, validation, security, concurrency, and I/O network.

---

## 3. Mandatory client decision

The default Go client for AMQP 0-9-1 RabbitMQ integration SHOULD be:

```go
github.com/rabbitmq/amqp091-go
```

Rules:

1. Do not use deprecated/unmaintained AMQP clients unless project architecture already mandates them.
2. Do not wrap `amqp091-go` so deeply that ack/nack/confirm/channel semantics disappear.
3. Do not write a custom AMQP client.
4. If RabbitMQ Streams, AMQP 1.0, MQTT, or another protocol is required, this standard is insufficient; use a protocol-specific standard.

---

## 4. Non-negotiable rules

The agent MUST:

1. Use manual consumer acknowledgements for business processing.
2. Acknowledge only after durable successful processing.
3. Use publisher confirms for messages whose loss is not acceptable.
4. Use durable exchanges/queues and persistent messages when messages must survive broker restart.
5. Declare topology explicitly or document platform-owned topology.
6. Never publish without handling unroutable messages when routing correctness matters.
7. Configure prefetch/QoS for consumers.
8. Never use unlimited prefetch for slow or stateful handlers.
9. Never share one channel concurrently across independent goroutines unless the client documentation and project wrapper explicitly make it safe.
10. Use one channel per concurrent publisher/consumer worker unless a safe abstraction is provided.
11. Close channels and connections during shutdown.
12. React to connection/channel close notifications.
13. Bound payload size.
14. Preserve message IDs, correlation IDs, causation IDs, and retry metadata.
15. Never log secrets or full sensitive payloads.
16. Never use RabbitMQ as a hidden database or unbounded backlog.
17. Never retry poison messages forever.
18. Never rely on auto-recovery unless explicitly implemented and tested.
19. Never treat a successful `Publish` call as durable delivery without confirms.
20. Never use `context.Background()` inside publish/consume business paths.

---

## 5. Mental model

### 5.1 AMQP routing path

The routing path is:

```text
publisher -> exchange -> binding/routing key -> queue -> consumer -> ack/nack/reject
```

The agent MUST model all parts explicitly.

Required topology fields:

- exchange name
- exchange type: direct, topic, fanout, headers
- exchange durability
- queue name
- queue durability
- binding key or binding arguments
- routing key producer uses
- DLX/DLQ policy
- message TTL/retry policy if applicable
- consumer prefetch
- ownership of topology declaration

### 5.2 RabbitMQ is a broker queue, not Kafka

RabbitMQ delivery semantics differ from Kafka:

- messages are removed from a queue after acknowledgement;
- ordering can be affected by multiple consumers, redelivery, priority, and requeue;
- broker routing is based on exchange type and bindings;
- replay is not natural unless retained elsewhere;
- a queue backlog is operational debt, not a durable event log.

The agent MUST NOT copy Kafka assumptions into RabbitMQ code.

---

## 6. Message contract

Every queue/exchange workflow MUST have a message contract.

Required contract fields:

- exchange
- routing key
- queue(s)
- message type
- message version
- content type
- payload schema
- required headers
- idempotency key
- correlation id
- expiration/TTL policy
- retry count header
- DLQ policy
- consumer owner
- ack/nack policy

Recommended message envelope:

```go
type MessageEnvelope[T any] struct {
    MessageID     string    `json:"message_id"`
    MessageType   string    `json:"message_type"`
    MessageVersion int      `json:"message_version"`
    CorrelationID string    `json:"correlation_id,omitempty"`
    CausationID   string    `json:"causation_id,omitempty"`
    OccurredAt    time.Time `json:"occurred_at"`
    Producer      string    `json:"producer"`
    Payload       T         `json:"payload"`
}
```

Required AMQP properties for business messages:

- `MessageId`
- `ContentType`
- `Timestamp`
- `DeliveryMode`
- `CorrelationId` where available
- `Type` or header equivalent
- retry headers if using retry/DLX

---

## 7. Topology declaration

### 7.1 Ownership

Topology MUST be owned by one of:

1. infrastructure as code;
2. platform bootstrap job;
3. application startup with explicit idempotent declarations;
4. test setup only.

The agent MUST NOT spread queue/exchange declarations throughout handlers.

### 7.2 Declaration conflicts

RabbitMQ declaration mismatches can fail channels. Therefore:

1. exchange/queue declaration arguments MUST be centralized;
2. durability/auto-delete/exclusive flags MUST be explicit;
3. DLX arguments MUST be documented;
4. topology changes MUST follow migration/release process;
5. application code MUST fail fast if declared topology does not match expected topology.

Forbidden:

```go
ch.QueueDeclare(queueName, false, false, false, false, nil)
```

without a documented reason.

Required for durable queues:

```go
args := amqp.Table{
    "x-dead-letter-exchange": retryOrDeadLetterExchange,
}
_, err := ch.QueueDeclare(queueName, true, false, false, false, args)
```

---

## 8. Connection and channel lifecycle

### 8.1 Connection

Rules:

1. Connection MUST be long-lived.
2. Connection MUST be established during startup or managed by a supervised connector.
3. Connection close notifications MUST trigger shutdown or reconnection logic.
4. Reconnection MUST re-create channels, topology declarations, consumers, confirms, and notify listeners.
5. Credentials and URLs MUST not be logged.
6. TLS MUST be used when required by environment/security policy.

### 8.2 Channel

Rules:

1. Use a channel per publisher or consumer worker unless safe wrapper exists.
2. Do not assume channel survives protocol exception.
3. On channel close, recreate topology and consumer registrations as needed.
4. `NotifyClose`, `NotifyReturn`, and `NotifyPublish` handling MUST be drained to avoid deadlocks/leaks.
5. Channel must be closed during shutdown.

---

## 9. Publisher standards

### 9.1 Publisher confirms

For critical messages, publisher confirms are mandatory.

Required:

1. Enable confirm mode.
2. Publish with context where API supports it.
3. Wait for confirmation or track async confirmation.
4. Treat nack or timeout as publish failure.
5. Retry only if idempotency key and duplicate handling are defined.

Forbidden:

```go
return ch.PublishWithContext(ctx, exchange, key, false, false, msg)
```

for durable business messages without confirm handling.

### 9.2 Mandatory routing

If routing to at least one queue is required, publisher MUST use mandatory publish and handle returns, or use platform-enforced topology validation.

Rules:

1. `mandatory=true` SHOULD be used for command/task messages where unroutable messages are failures.
2. `NotifyReturn` MUST be listened to and drained when mandatory/immediate semantics are used.
3. Returned messages MUST be surfaced as publish failures.

### 9.3 Publishing properties

Required for durable business messages:

```go
amqp.Publishing{
    ContentType:  "application/json",
    DeliveryMode: amqp.Persistent,
    MessageId:    env.MessageID,
    CorrelationId: env.CorrelationID,
    Type:         env.MessageType,
    Timestamp:    env.OccurredAt,
    Body:         body,
    Headers: amqp.Table{
        "message_version": env.MessageVersion,
        "producer":        env.Producer,
    },
}
```

Rules:

1. Set `DeliveryMode: amqp.Persistent` for durable messages.
2. Set `ContentType` accurately.
3. Set `MessageId` for idempotency.
4. Do not put secrets in headers.
5. Do not use random routing key where routing semantics are domain-specific.

---

## 10. Consumer standards

### 10.1 Manual ack

Business consumers MUST use manual acknowledgement.

Required flow:

```text
receive -> decode -> validate -> process durably -> ack
```

If processing fails:

```text
receive -> decode/process failure -> classify -> retry/nack/reject/DLQ -> ack/nack as policy requires
```

Forbidden:

```go
msgs, err := ch.Consume(queue, consumerTag, true, false, false, false, nil)
```

for business processing.

Required:

```go
msgs, err := ch.Consume(queue, consumerTag, false, false, false, false, nil)
```

### 10.2 Ack after success

Ack is allowed only after:

- database transaction committed;
- external side effect completed idempotently;
- derived message was published and confirmed;
- permanent failure was durably routed to DLQ;
- no-op decision is safe and observable.

Forbidden:

```go
_ = d.Ack(false)
return process(d.Body)
```

### 10.3 Nack/reject policy

Rules:

1. `Nack(requeue=true)` only for transient failures with backoff/retry control.
2. `Nack(requeue=true)` MUST NOT create tight redelivery loops.
3. `Reject(requeue=false)` or `Nack(requeue=false)` SHOULD be used to route to DLX when configured.
4. Permanent validation errors MUST not be requeued forever.
5. Unknown message versions MUST be DLQ/rejected based on contract.

---

## 11. Prefetch/QoS

Consumers MUST configure prefetch.

Rules:

1. Prefetch must match handler concurrency, processing time, memory footprint, and ack latency.
2. Slow handlers MUST use low prefetch.
3. High-throughput stateless handlers MAY use larger bounded prefetch after benchmark evidence.
4. Prefetch must be documented in config.
5. Do not set unlimited prefetch for business consumers.

Example:

```go
if err := ch.Qos(prefetchCount, 0, false); err != nil {
    return fmt.Errorf("set rabbitmq qos: %w", err)
}
```

---

## 12. Retry and DLQ

### 12.1 Retry model

The agent MUST implement one of the approved retry models:

1. delayed exchange plugin policy;
2. TTL retry queue + DLX back to main exchange;
3. application-managed retry scheduler;
4. no automatic retry; fail fast to DLQ.

The retry model MUST be documented.

### 12.2 Retry metadata

Required retry metadata:

- original exchange
- original routing key
- original queue
- message id
- message type
- message version
- first failure timestamp
- last failure timestamp
- attempt count
- error category
- processor version

### 12.3 DLQ

DLQ rules:

1. Every critical consumer MUST have a DLQ policy.
2. DLQ messages MUST carry original metadata.
3. DLQ must be monitored.
4. DLQ replay must be explicit and operator-controlled.
5. DLQ must not hide broken consumers.
6. DLQ must not leak secrets.

---

## 13. Idempotency

RabbitMQ can redeliver messages. Consumers MUST be idempotent for business side effects.

Required idempotency strategies:

| Side effect             | Required strategy                                       |
| ----------------------- | ------------------------------------------------------- |
| database mutation       | unique message id table or natural idempotency key      |
| external API call       | external idempotency key if supported plus local record |
| publish derived message | deterministic derived message id and publisher confirm  |
| workflow transition     | state/version guard                                     |
| email/notification      | dedupe table keyed by business notification id          |

Forbidden:

- assuming one delivery;
- relying on in-memory map for process-wide idempotency in production;
- using delivery tag as business idempotency key.

---

## 14. Ordering

RabbitMQ ordering is limited by queue, consumer count, prefetch, requeue, priority, and redelivery.

Rules:

1. If strict order per entity is required, document the queue/consumer/prefetch strategy.
2. Multiple consumers on one queue can break effective processing order.
3. Requeue can change order.
4. Consumer concurrency must not violate workflow invariants.
5. Use state version checks for regulatory/case workflow transitions.

---

## 15. Serialization

Rules:

1. JSON payloads MUST follow `strict-coding-standards__go_json.md`.
2. XML payloads MUST follow `strict-coding-standards__go_xml.md`.
3. Binary payloads MUST include content type and version.
4. Message body size MUST be bounded.
5. Decoding errors MUST be classified as permanent unless caused by temporary infrastructure failure.
6. Do not use `map[string]any` for durable contracts unless schema-less contract is explicitly required.

---

## 16. Security

The agent MUST:

1. Use TLS where required.
2. Never hardcode RabbitMQ credentials.
3. Never log AMQP URI with password.
4. Never expose management credentials to application runtime unless needed.
5. Validate message origin if queues cross trust boundaries.
6. Treat headers and body as untrusted input.
7. Validate authorization before executing privileged command messages.
8. Redact secrets and regulated data in logs/DLQ.
9. Use least-privilege RabbitMQ user permissions per vhost/exchange/queue.

---

## 17. Observability

Required metrics:

- publish count by exchange/routing key/message type/result
- publish confirm latency
- publish nack/return count
- consume count by queue/message type/result
- processing latency
- ack/nack/reject count
- redelivery count
- retry count
- DLQ count
- reconnect/channel recreate count
- consumer active count
- queue depth via broker telemetry where available

Required logs:

- startup topology summary without secrets;
- connection/channel close;
- publish failure with exchange/routing key/message type/message id;
- consume failure with queue/message type/message id/redelivered flag;
- retry/DLQ decision;
- graceful shutdown.

Required traces:

- publish span for critical messages;
- consume span for handlers;
- correlation id propagation;
- retry and DLQ attributes.

Forbidden:

- raw payload logs;
- high-cardinality metric labels using message id;
- silent reconnect loops.

---

## 18. Shutdown

Graceful shutdown MUST:

1. stop accepting new publish/consume work;
2. cancel consumer context;
3. wait for in-flight messages up to a bounded timeout;
4. ack/nack according to processing result;
5. stop delivery channel reading safely;
6. flush/wait publisher confirms;
7. close channels;
8. close connection;
9. log final shutdown result.

Forbidden:

- immediate process exit while messages are in-flight;
- acking all messages on shutdown;
- dropping publish confirmations.

---

## 19. Testing requirements

The agent MUST add tests for:

- envelope encode/decode;
- missing/unknown message version;
- invalid headers;
- handler idempotency;
- ack after success;
- no ack before failure;
- transient failure retry policy;
- permanent failure DLQ/reject policy;
- redelivery handling;
- publisher confirm success/failure;
- returned unroutable message if mandatory publish is used;
- shutdown with in-flight message;
- context cancellation;
- reconnect/redeclare behavior if reconnection manager is implemented.

Integration tests SHOULD use containerized RabbitMQ or a project-approved test broker.

Mocks MUST model ack/nack/confirm behavior. A fake that only passes a byte slice to a handler is insufficient for reliability-sensitive code.

---

## 20. Benchmarking requirements

Benchmarks MUST define:

- exchange type;
- queue type;
- durable vs transient;
- persistent vs non-persistent delivery;
- publisher confirms enabled/disabled;
- confirm batch/window;
- payload size;
- consumer prefetch;
- handler concurrency;
- ack mode;
- network placement;
- broker topology;
- queue depth at start and end.

Forbidden:

- comparing publish throughput with confirms disabled to reliability target;
- ignoring confirm latency;
- benchmarking consumer throughput with auto-ack when production uses manual ack;
- omitting redelivery/DLQ behavior in reliability tests.

---

## 21. Anti-patterns

The agent MUST reject:

1. Auto-ack for business processing.
2. Publish without confirms for durable business messages.
3. Queue declaration flags copied from tutorial code without production review.
4. One connection per message.
5. One channel shared by all goroutines without safety model.
6. Unlimited prefetch.
7. Requeue forever.
8. DLQ without metadata.
9. Silent reconnect with lost consumers/confirms.
10. Logging AMQP URI or payload.
11. Treating `Publish` return nil as durable delivery.
12. Using RabbitMQ as an infinite database.
13. Ignoring `NotifyClose`, `NotifyReturn`, or `NotifyPublish` where relevant.
14. Acknowledging before DB commit.
15. Failing to close channel/connection.

---

## 22. Required review checklist

Before merge, reviewers MUST verify:

- [ ] Exchange, queue, binding, routing key, and ownership are documented.
- [ ] Manual ack is used for business consumers.
- [ ] Ack happens after durable success.
- [ ] Publisher confirms are used for critical publishes.
- [ ] Mandatory routing/returns are handled where routing failure matters.
- [ ] Prefetch is configured and justified.
- [ ] Retry and DLQ policy is explicit.
- [ ] Handler is idempotent.
- [ ] Payload size and schema are bounded.
- [ ] Connection/channel lifecycle is supervised.
- [ ] Shutdown is graceful.
- [ ] Telemetry covers publish, consume, ack, nack, retry, DLQ, reconnect.
- [ ] Tests cover success, failure, redelivery, confirm failure, and shutdown.

---

## 23. LLM implementation rule

When asked to implement RabbitMQ code, the agent MUST first identify:

1. producer or consumer;
2. exchange type and name;
3. queue name and durability;
4. routing key;
5. acknowledgement policy;
6. publisher confirm requirement;
7. prefetch/concurrency;
8. retry/DLX/DLQ model;
9. idempotency key;
10. security and telemetry requirements.

If any are missing, the agent MUST implement the safest default: durable topology, manual ack, bounded prefetch, publisher confirms for critical publishing, context-aware shutdown, redacted logs, explicit retry/DLQ hooks, and no claim of exactly-once delivery.
