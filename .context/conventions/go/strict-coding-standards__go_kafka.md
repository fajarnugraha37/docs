# Strict Coding Standards — Go Kafka

Status: Mandatory  
Scope: Go services producing, consuming, transforming, projecting, replaying, or administrating Apache Kafka records.  
Audience: LLM code agents, developers, reviewers, maintainers, platform engineers, and reliability engineers.  
Baseline: Go 1.24+; compatible with Go 1.25/1.26 standards in this repository.

---

## 1. Purpose

Kafka code is not ordinary queue code. Kafka is an ordered, partitioned, durable event log with consumer offset management, group rebalancing, replay, retention, and schema evolution concerns.

An LLM MUST NOT generate Kafka code that only publishes and polls messages. It must preserve event contract, partition ordering, offset safety, idempotency, context cancellation, retry semantics, operational visibility, and replay correctness.

This standard governs:

- Kafka producer implementation in Go.
- Kafka consumer and consumer group implementation in Go.
- Event envelope and payload contracts.
- Offset commit rules.
- Partition key and ordering rules.
- Retry, DLQ, replay, and poison-message handling.
- Kafka transaction usage where supported.
- Testing, benchmarking, telemetry, and failure modelling.

---

## 2. Source authority

When this document conflicts with project-specific architecture docs, the project-specific docs win only if they are stricter.

Primary references:

- Apache Kafka documentation.
- Confluent Kafka Go client documentation for `github.com/confluentinc/confluent-kafka-go/kafka`.
- `segmentio/kafka-go` package documentation and repository documentation.
- Go `context`, `errors`, `log/slog`, `encoding/json`, `sync`, and `testing` package documentation.
- Project standards for Go context, error handling, telemetry, JSON, data mapper, validation, security, concurrency, and database/outbox.

---

## 3. Mandatory client decision

A project MUST explicitly choose its Kafka Go client. The agent MUST NOT silently mix Kafka clients in one service.

Recommended decision matrix:

| Requirement                                                                                 | Preferred client direction   |
| ------------------------------------------------------------------------------------------- | ---------------------------- |
| Full Kafka feature coverage, transactions, librdkafka parity, enterprise platform alignment | `confluent-kafka-go`         |
| Pure Go, strong context integration, simple reader/writer abstraction, no CGO               | `segmentio/kafka-go`         |
| Existing estate already standardized on another maintained client                           | follow project standard only |

Rules:

1. Do not introduce a Kafka client without architecture approval.
2. Do not mix clients in one runtime path.
3. Do not hide client-specific semantics behind a generic abstraction unless the abstraction preserves offset, partition, transaction, and error semantics.
4. Do not write a homegrown Kafka protocol client.
5. If using `confluent-kafka-go`, document CGO/build/runtime implications.
6. If using `kafka-go`, document unsupported Kafka features before claiming delivery semantics.

---

## 4. Non-negotiable rules

The agent MUST:

1. Treat Kafka records as versioned contracts, not arbitrary blobs.
2. Define topic name, key, value schema, headers, partitioning policy, retention assumption, and compatibility rule before coding.
3. Use stable partition keys for entity-ordered workflows.
4. Never claim global ordering across partitions.
5. Never enable auto-commit when processing success must control offset commit.
6. Commit offsets only after the side effect protected by that offset is durably complete.
7. Make event processing idempotent.
8. Use context cancellation for produce/consume loops where the selected client supports it.
9. Close producers, consumers, readers, writers, and admin clients during shutdown.
10. Flush or wait for delivery reports before producer shutdown.
11. Bound in-memory batches.
12. Handle rebalances and partition revocation explicitly where the client exposes them.
13. Never log message payloads containing secrets, tokens, PII, regulated data, or case narrative data.
14. Never use topic creation/deletion in application runtime unless explicitly approved.
15. Never use Kafka as a request/response RPC replacement unless the architecture explicitly requires asynchronous command processing.
16. Never assume retrying a producer send is safe unless idempotency and key semantics are defined.
17. Never create unbounded goroutines per record.
18. Never swallow producer delivery failures.
19. Never write a consumer loop without a shutdown path.
20. Never use `context.Background()` inside business processing paths except at process bootstrap.

---

## 5. Mental model

### 5.1 Kafka is an event log, not a task queue

Kafka records are appended to partitions. Consumers track progress using offsets. Multiple consumer groups can independently read the same topic.

Required implications:

- A consumed record can be replayed.
- Processing must be idempotent.
- Offset commit is a checkpoint, not a business transaction by itself.
- Retention can delete old records even if no consumer has read them.
- Ordering is per partition, not per topic.

### 5.2 Topic, partition, offset form the processing coordinate

Every message handling log, metric, trace, and error MUST be able to identify:

- topic
- partition
- offset
- key or redacted key hash
- consumer group
- event type
- event version
- correlation/request/causation id when available

Forbidden:

```go
logger.Error("failed to process message", "error", err)
```

Required:

```go
logger.ErrorContext(ctx, "kafka_consume_failed",
    "topic", topic,
    "partition", partition,
    "offset", offset,
    "event_type", eventType,
    "event_version", eventVersion,
    "consumer_group", groupID,
    "error", err,
)
```

---

## 6. Topic and event contract

Every topic MUST have a documented contract.

Required contract fields:

- topic name
- topic owner
- event category: fact, command, notification, projection, audit, integration, CDC/outbox
- payload encoding: JSON, Avro, Protobuf, binary, CloudEvents, project envelope
- schema versioning rule
- key type and key stability rule
- header dictionary
- retention assumption
- compaction setting if applicable
- partition count assumption
- consumer groups and processing ownership
- replay safety
- DLQ/retry topic policy

Forbidden:

```go
writer.WriteMessages(ctx, kafka.Message{Value: body})
```

Required:

```go
writer.WriteMessages(ctx, kafka.Message{
    Key: []byte(event.AggregateID),
    Headers: []kafka.Header{
        {Key: "event_type", Value: []byte(event.Type)},
        {Key: "event_version", Value: []byte(event.Version)},
        {Key: "correlation_id", Value: []byte(event.CorrelationID)},
    },
    Value: encoded,
    Time: event.OccurredAt,
})
```

---

## 7. Event envelope standard

Unless a project has a schema registry or CloudEvents standard, all Go Kafka events SHOULD use a stable project envelope.

Required envelope fields:

```go
type EventEnvelope[T any] struct {
    EventID       string    `json:"event_id"`
    EventType     string    `json:"event_type"`
    EventVersion  int       `json:"event_version"`
    AggregateType string    `json:"aggregate_type,omitempty"`
    AggregateID   string    `json:"aggregate_id,omitempty"`
    CausationID   string    `json:"causation_id,omitempty"`
    CorrelationID string    `json:"correlation_id,omitempty"`
    OccurredAt    time.Time `json:"occurred_at"`
    Producer      string    `json:"producer"`
    Payload       T         `json:"payload"`
}
```

Rules:

1. `event_id` MUST be globally unique.
2. `event_type` MUST be stable and semantic.
3. `event_version` MUST be explicit.
4. `occurred_at` MUST be producer-side event time in UTC unless domain requires local civil date.
5. `aggregate_id` SHOULD be the default partition key for aggregate-ordered workflows.
6. Payload structs MUST be DTO/event contract structs, not mutable domain entities.
7. Payload structs MUST not contain secrets.
8. Payload compatibility MUST be tested with golden fixtures.

---

## 8. Partitioning and ordering

### 8.1 Key rule

The key MUST be chosen based on the ordering invariant.

Examples:

| Workflow requirement                           | Required key                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| case lifecycle events must be ordered per case | `case_id`                                                                             |
| user profile changes ordered per user          | `user_id`                                                                             |
| tenant-level quota events ordered per tenant   | `tenant_id`                                                                           |
| global strict order                            | do not use multi-partition Kafka topic; redesign or use single partition deliberately |

Forbidden:

```go
Key: []byte(uuid.NewString())
```

for entity workflows where ordering matters.

### 8.2 Partition count changes

The agent MUST NOT assume that increasing partition count is harmless.

Rules:

1. Increasing partition count can change key-to-partition mapping for many producers depending on partitioner.
2. A topic whose partitioning affects business ordering MUST document partition count evolution.
3. Do not use modulo partition calculations in business code.
4. Do not persist Kafka partition numbers as business semantics.

---

## 9. Producer standards

### 9.1 Producer ownership

A producer/writer MUST be long-lived and dependency-injected.

Forbidden:

```go
func Publish(ctx context.Context, ev Event) error {
    w := kafka.NewWriter(...)
    defer w.Close()
    return w.WriteMessages(ctx, ...)
}
```

Required:

```go
type Publisher struct {
    writer *kafka.Writer
    log    *slog.Logger
}

func NewPublisher(writer *kafka.Writer, log *slog.Logger) *Publisher {
    return &Publisher{writer: writer, log: log}
}
```

### 9.2 Produce result handling

The agent MUST handle delivery failure according to client semantics.

For async producers:

- delivery reports MUST be drained;
- failures MUST be logged and surfaced to the caller or durable retry/outbox layer;
- shutdown MUST flush or wait for all pending messages;
- no goroutine may leak waiting on delivery channels.

For sync writers:

- `WriteMessages` error MUST be returned or mapped;
- retry MUST be bounded;
- caller context MUST control cancellation.

### 9.3 Idempotent producer

If the client and broker support idempotent producer semantics, the project SHOULD enable it for critical event publication.

Rules:

1. Do not claim exactly-once semantics from idempotent produce alone.
2. Idempotent produce reduces duplicate writes from producer retries; it does not make downstream side effects exactly once.
3. If using transactions, document transaction boundaries, consumed offsets, produced records, timeout, fencing, and recovery policy.

---

## 10. Consumer standards

### 10.1 Consumer loop

A consumer loop MUST be cancellation-aware and bounded.

Required shape:

```go
func (c *Consumer) Run(ctx context.Context) error {
    for {
        msg, err := c.read(ctx)
        if err != nil {
            if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
                return nil
            }
            return fmt.Errorf("read kafka message: %w", err)
        }

        if err := c.handle(ctx, msg); err != nil {
            return fmt.Errorf("handle kafka message topic=%s partition=%d offset=%d: %w",
                msg.Topic, msg.Partition, msg.Offset, err)
        }
    }
}
```

Rules:

1. No infinite loop without context check.
2. No sleep-based polling unless the client requires it and the sleep is context-aware.
3. No unbounded per-message goroutine.
4. No shared mutable state across partitions without synchronization.
5. No offset commit before processing success.

### 10.2 Offset commit rule

The offset commit is the consumer's durability checkpoint.

Allowed commit timing:

| Processing style                  | Commit timing                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------- |
| pure projection into DB           | after DB transaction commit                                                     |
| produces derived Kafka event only | after derived event is durably produced, or in a Kafka transaction if supported |
| calls external side effect        | after idempotent external success and local idempotency record is stored        |
| validation rejection to DLQ       | after DLQ publish is confirmed/durable                                          |
| permanently ignored no-op event   | after no-op decision is safely logged/recorded if required                      |

Forbidden:

```go
commit(msg)
process(msg)
```

### 10.3 Auto-commit

The agent MUST disable auto-commit for handlers with meaningful processing side effects.

Auto-commit MAY be accepted only when:

- events are observational only;
- duplicate or lost processing is explicitly acceptable;
- the topic contract says best-effort consumption is enough;
- this is documented in code comments and architecture docs.

---

## 11. Error taxonomy

Kafka handling errors MUST be classified.

Required categories:

| Category                 | Examples                                          | Action                                                  |
| ------------------------ | ------------------------------------------------- | ------------------------------------------------------- |
| transient broker/network | timeout, leader unavailable, rebalance            | retry or restart loop with backoff                      |
| retriable processing     | temporary DB outage                               | do not commit; retry bounded or stop partition consumer |
| permanent validation     | unknown version, invalid payload                  | DLQ or reject topic then commit                         |
| poison message           | deterministic handler panic/error on same message | DLQ after threshold; commit only after DLQ durable      |
| authorization/config     | SASL/TLS/topic permission denied                  | fail fast; alert                                        |
| schema incompatible      | cannot decode known contract                      | fail fast or DLQ based on policy                        |

Rules:

1. Do not retry permanent validation errors forever.
2. Do not DLQ infrastructure outages as if payload is bad.
3. Do not continue after authorization/configuration errors.
4. Use wrapped errors with machine-checkable classification.

---

## 12. Retry, DLQ, and replay

### 12.1 Retry topics

If retry topics are used, they MUST preserve original metadata.

Required retry metadata:

- original topic
- original partition
- original offset
- original event id
- first failure timestamp
- last failure timestamp
- attempt count
- error category
- error code
- processor version

### 12.2 DLQ topics

DLQ is for inspection and recovery, not for hiding failures.

Rules:

1. DLQ payload MUST include enough metadata to replay or diagnose.
2. DLQ MUST not contain secrets or unredacted regulated payload unless approved.
3. DLQ write MUST be confirmed before committing the source offset.
4. DLQ metrics and alerts MUST exist.
5. DLQ consumers/replayers MUST require explicit operator action.

### 12.3 Replay

Replay MUST be safe by design.

Required:

- idempotent handlers;
- deterministic mapping;
- version-aware decoding;
- ability to skip/handle old event versions;
- no irreversible side effect without idempotency key.

---

## 13. Transactions and exactly-once claims

The agent MUST NOT claim exactly-once processing unless all required boundaries are in one transactional system or a documented transactional protocol.

Allowed claims:

- “at-least-once consumption with idempotent handler”
- “idempotent produce retry”
- “Kafka transaction for consumed offsets plus produced Kafka records”
- “effectively-once projection using idempotency key and unique constraint”

Forbidden claims:

- “Kafka gives exactly-once end-to-end with database writes” without outbox/transactional design.
- “No duplicate events can happen.”
- “Auto-commit is safe because processing is fast.”

If using Kafka transactions:

1. Use a stable and unique `transactional.id` per producer instance role.
2. Initialize transactions before use.
3. Start and end exactly one active transaction per producer at a time.
4. Send consumed offsets to the transaction only after processing.
5. Configure transaction-aware consumers with appropriate isolation if reading transactional output.
6. Treat fencing and abortable errors as first-class error cases.

---

## 14. Database outbox integration

For critical business events originating from a SQL transaction, the preferred pattern is transactional outbox.

Rules:

1. Write domain state and outbox event in the same DB transaction.
2. A relay publishes outbox events to Kafka.
3. Relay publication MUST be idempotent.
4. Outbox row state MUST track publication attempts and terminal failure.
5. Kafka event key MUST derive from aggregate or documented ordering key.
6. Do not publish directly to Kafka inside a DB transaction unless the consistency risk is explicitly accepted.

---

## 15. Schema and serialization

### 15.1 JSON

JSON events MUST follow `strict-coding-standards__go_json.md`.

Additional Kafka rules:

1. Unknown event version MUST be rejected or routed to DLQ.
2. Event consumers MUST not depend on Go struct zero-values to infer absent fields.
3. Decoders MUST enforce size limits before decode.
4. Large payloads SHOULD use object storage pointer pattern, not oversized Kafka records.

### 15.2 Avro/Protobuf/schema registry

If using schema registry:

1. Generated code MUST be isolated.
2. Schema compatibility mode MUST be documented.
3. Schema ID/header/wire format MUST be centralized.
4. Schema evolution MUST have fixture tests.
5. Do not hand-code schema registry wire format in handlers.

---

## 16. Security

The agent MUST:

1. Use TLS/SASL according to platform policy.
2. Never disable TLS verification in production.
3. Never hardcode broker credentials.
4. Never log SASL password, token, client certificate private key, or full connection string.
5. Redact sensitive headers and payload fields.
6. Treat Kafka as an internal trust boundary, not as fully trusted input.
7. Validate authorization before producing privileged command events.
8. Prevent confused-deputy flows where untrusted event headers grant authority.

---

## 17. Observability

Required metrics:

- producer send count by topic/event type/result
- producer latency histogram
- producer delivery failure count
- consumer processed count by topic/event type/result
- consumer processing latency histogram
- consumer lag where available
- retry and DLQ count
- rebalance count
- decode failure count
- poison-message count

Required traces:

- consume span per message or per bounded batch;
- produce span for critical publication;
- correlation id propagation from event headers;
- topic/partition/offset attributes with cardinality-safe rules.

Required logs:

- startup config summary without secrets;
- partition assignment/revocation where applicable;
- processing failure with topic/partition/offset;
- DLQ write result;
- shutdown flush/close result.

Forbidden:

- high-cardinality metric labels using raw event id, user id, or case id;
- full payload logs;
- silent consumer loop restarts.

---

## 18. Concurrency

Rules:

1. Preserve partition ordering for handlers that depend on ordering.
2. If parallelizing, parallelize across partitions or by independent key only.
3. Do not process multiple records from the same partition concurrently unless offset commit and ordering consequences are explicitly handled.
4. Use bounded worker pools.
5. Backpressure must be explicit.
6. Goroutine lifecycle must be tied to consumer lifecycle.
7. Shared producers/writers must be used according to client safety docs.

---

## 19. Testing requirements

The agent MUST add tests for:

- event encode/decode golden fixtures;
- unknown event version;
- missing required header;
- invalid key;
- handler idempotency;
- retryable vs permanent errors;
- DLQ routing;
- offset commit after success only;
- context cancellation;
- shutdown flush/close;
- duplicate message replay;
- out-of-order events if workflow has versioning;
- consumer rebalance behavior if supported by client/test harness.

Integration tests SHOULD use containerized Kafka or a project-approved test broker.

Mocks MUST NOT hide Kafka semantics. A fake that cannot model topic/partition/offset/commit failure is not sufficient for offset-sensitive code.

---

## 20. Benchmarking requirements

Benchmarks MUST define:

- payload size;
- batch size;
- partitions;
- producer acks/idempotence/transactions;
- compression;
- broker topology;
- consumer concurrency;
- commit strategy;
- network placement;
- latency and throughput targets.

Forbidden:

- claiming throughput from local mock only;
- benchmarking without delivery confirmation;
- ignoring producer buffer memory;
- measuring only encode time and calling it Kafka throughput.

---

## 21. Anti-patterns

The agent MUST reject:

1. One producer/writer per message.
2. Auto-commit for business side-effect handlers.
3. Random partition keys for ordered domain events.
4. Fire-and-forget producer without delivery result handling.
5. Consumer loop with no context cancellation.
6. Unbounded goroutine per message.
7. DLQ without replay metadata.
8. Retrying poison messages forever.
9. Logging full payloads.
10. Using Kafka as a synchronous API.
11. Creating topics from application startup without platform ownership.
12. Claiming global ordering across partitions.
13. Hand-coded schema evolution without fixtures.
14. Storing offset as business state without clear recovery design.
15. Ignoring producer flush/close errors.

---

## 22. Required review checklist

Before merge, reviewers MUST verify:

- [ ] Topic contract exists.
- [ ] Event envelope/version/key policy is explicit.
- [ ] Producer delivery failures are handled.
- [ ] Consumer commit happens only after durable success.
- [ ] Auto-commit is disabled or explicitly justified.
- [ ] Handler is idempotent.
- [ ] Retry/DLQ policy is defined.
- [ ] Payload size is bounded.
- [ ] Context cancellation works.
- [ ] Shutdown flushes/closes resources.
- [ ] Logs/metrics/traces include topic/partition/offset without leaking secrets.
- [ ] Tests cover duplicate, invalid, retryable, permanent, and cancellation cases.
- [ ] No false exactly-once claim is present.

---

## 23. LLM implementation rule

When asked to implement Kafka code, the agent MUST first identify:

1. producer or consumer;
2. selected Go Kafka client;
3. topic contract;
4. event key and ordering invariant;
5. offset/commit semantics;
6. idempotency strategy;
7. retry/DLQ policy;
8. security and telemetry requirements.

If any of these are missing, the agent MUST make conservative assumptions in code comments and implement the safest default: bounded processing, explicit context, manual commit after success, idempotency hook, redacted logging, and no exactly-once claims.
