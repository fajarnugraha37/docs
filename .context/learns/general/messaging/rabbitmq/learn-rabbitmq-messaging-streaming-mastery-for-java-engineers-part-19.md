# Learn RabbitMQ Messaging & Streaming Mastery for Java Engineers

## Part 19 — Stream Deduplication, Filtering, and Replay Patterns

> File: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-19.md`  
> Series: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers`  
> Audience: Java software engineer / tech lead  
> Focus: RabbitMQ Streams correctness patterns: duplicate publish prevention, selective consumption, replay, reprocessing, offset strategy, and operational safety.

---

## 0. Why This Part Matters

RabbitMQ Streams are dangerous to misunderstand.

A normal RabbitMQ queue is usually about **work handoff**:

```text
producer -> queue -> consumer -> ack -> message leaves active queue
```

A stream is about **durable append-only history**:

```text
producer -> stream log -> many consumers read positions independently
```

That difference creates new powers:

- replay old messages;
- rebuild projections;
- run new consumers over existing history;
- retain audit trails;
- process the same event through multiple independent pipelines;
- scale using super streams;
- keep a historical source without destroying messages on consume.

But it also creates new failure modes:

- duplicate publishing when producer retries after uncertain confirm;
- unsafe replay that re-applies side effects;
- consumers committing offsets before business state is durable;
- filtering used as if it were authorization;
- reprocessing jobs polluting production workflows;
- old message schemas breaking modern consumers;
- replay storms overwhelming databases or downstream services;
- assuming offset means acknowledgement.

This part teaches RabbitMQ Streams as a **correctness primitive**, not merely a high-throughput pipe.

---

## 1. The Three Core Problems

Part 19 covers three related problems.

### 1.1 Deduplication

Question:

> How can a producer retry safely when it is not sure whether a message was already appended to the stream?

RabbitMQ Streams can deduplicate published messages using two producer-side pieces of identity:

```text
producer name/reference + publishing id
```

The broker can use these to filter duplicate publishes from the same logical producer.

### 1.2 Filtering

Question:

> How can consumers read only a subset of a stream without downloading every message and discarding most of it locally?

Stream filtering lets a publisher attach filter values and lets consumers request matching subsets. It is primarily a **bandwidth and efficiency feature**, not a business-rule replacement.

### 1.3 Replay

Question:

> How can a consumer safely re-read old stream data without corrupting downstream state?

Replay is powerful only if consumers are designed to be:

- idempotent;
- version-aware;
- side-effect-aware;
- bounded;
- observable;
- isolated from live processing when needed.

---

## 2. RabbitMQ Stream Refresher

A RabbitMQ stream is an append-only sequence of messages.

Unlike a traditional queue, consumption is **non-destructive**:

```text
Message remains in stream after Consumer A reads it.
Message remains in stream after Consumer B reads it.
Message remains until retention removes it.
```

A stream has positions.

These positions are called **offsets**.

A consumer can start from:

- the first available message;
- the last message;
- the next message after current end;
- a specific offset;
- a timestamp-based location, depending on client/protocol support.

Important distinction:

```text
Queue ack  = broker may remove message from active delivery state.
Stream offset = consumer's progress position in a retained log.
```

Offset tracking is closer to a bookmark than a destructive acknowledgement.

---

## 3. Correctness Mental Model

For stream processing, separate four identities.

```text
Business event identity
    e.g. evidence-submitted event id

Producer identity
    e.g. evidence-service-outbox-relay-01

Publish sequence identity
    e.g. monotonically increasing publishing id

Consumer processing identity
    e.g. projection consumer group + stream + offset
```

These identities answer different questions.

| Identity | Answers | Example |
|---|---|---|
| Business event id | Is this domain event logically the same event? | `evt_01J...` |
| Producer name | Which logical publisher emitted this stream record? | `case-service-outbox-relay` |
| Publishing id | Which sequence number did this producer use? | `1938221` |
| Consumer offset | Where did this consumer read from? | `stream=evidence-audit offset=937711` |
| Idempotency key | Has this business effect already been applied? | `projection:evidence:evt_01J...` |

Do not collapse them into one concept.

A common mistake:

> “The offset is unique, so I can use it as my business idempotency key.”

That is weak because replay, re-routing, stream migration, super stream partitioning, or republishing can change where a business event appears. A domain event should have a stable domain identity independent of stream position.

---

## 4. Deduplication: The Real Problem

Publishing to a stream is not just:

```text
send(message)
```

It is a distributed protocol between producer and broker.

A producer may send a message and then experience:

- network timeout;
- connection reset;
- process crash;
- confirm callback lost;
- broker confirms but client does not receive it;
- broker appends message but producer restarts before recording success.

The producer faces an **unknown outcome**:

```text
Did the message get appended or not?
```

Without deduplication, retrying may create duplicate stream entries.

With deduplication, retrying with the same producer identity and publishing id can be safe, assuming you obey the required semantics.

---

## 5. RabbitMQ Stream Deduplication Concept

RabbitMQ Streams deduplication is based on:

```text
producer name/reference + publishing id
```

The logical rule is:

```text
For a given named producer, each message has a publishing id.
If the broker already accepted that publishing id from that producer, repeated publishes can be treated as duplicates.
```

The publishing id must be **strictly increasing** for that producer.

Think of it as:

```text
producer_name = "case-service-outbox-relay"
publishing_id = 1001

producer_name = "case-service-outbox-relay"
publishing_id = 1002

producer_name = "case-service-outbox-relay"
publishing_id = 1003
```

If the producer crashes after publishing id `1003`, it can restart, discover the last known publishing state, and avoid blindly emitting `1003` as a new logical message.

---

## 6. What Deduplication Is Not

Deduplication is not magic exactly-once.

It does **not** remove the need for:

- outbox pattern;
- stable message ids;
- idempotent consumers;
- transactional state updates;
- safe offset commit;
- replay safety;
- schema compatibility;
- monitoring.

It only addresses one category of duplicate:

```text
Duplicate publish attempts from the same named producer with same publishing id.
```

It does not automatically deduplicate:

- same business event published by two different producer names;
- same event republished with a new publishing id;
- message copied through another stream;
- downstream side effects executed twice;
- replayed messages applied twice by a consumer;
- duplicates created by business logic bugs.

So the mental model is:

```text
Stream deduplication reduces duplicate append risk.
Consumer idempotency reduces duplicate effect risk.
```

You usually need both.

---

## 7. Producer Name Design

The producer name must represent a **logical producer**, not a random process instance.

Bad:

```text
case-service-${hostname}-${randomUuid}
```

Why bad?

Every restart becomes a new producer identity. The broker cannot relate the new process to the previous publishing id sequence.

Better:

```text
case-service-outbox-relay
```

For partitioned work:

```text
case-service-outbox-relay-partition-00
case-service-outbox-relay-partition-01
case-service-outbox-relay-partition-02
```

For multi-tenant isolation:

```text
case-service-outbox-relay-tenant-regulator-a
case-service-outbox-relay-tenant-regulator-b
```

But do not create arbitrary high-cardinality producer names unless you understand operational cost.

### Rule

Use a producer name that is:

- stable across process restart;
- unique for one publishing sequence;
- not shared by concurrent writers unless publishing id assignment is coordinated;
- meaningful in operational tooling;
- tied to outbox/shard ownership if possible.

---

## 8. Publishing ID Design

A publishing id should be a monotonically increasing sequence for a given producer name.

Possible sources:

1. database outbox sequence;
2. database monotonic numeric id;
3. stream publisher sequence table;
4. allocated sequence range per producer shard;
5. durable local sequence store, if carefully managed.

For enterprise Java systems, the best source is often the database outbox.

Example outbox table:

```sql
CREATE TABLE outbox_message (
    publishing_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id UUID NOT NULL UNIQUE,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    message_type TEXT NOT NULL,
    schema_version INT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ NULL,
    publish_attempts INT NOT NULL DEFAULT 0
);
```

Then:

```text
producer name = case-service-outbox-relay
publishing id = outbox_message.publishing_id
```

This is strong because the id is:

- durable;
- monotonic;
- recoverable after crash;
- auditable;
- naturally tied to DB transaction.

---

## 9. Outbox + Stream Deduplication Pattern

The safest publisher pattern is:

```text
Application DB transaction
    write business state
    write outbox row with event id and publishing id
commit

Outbox relay
    read unpublished rows in order
    publish to stream with named producer + publishing id
    wait for confirm
    mark outbox row published
```

Failure cases:

### Case A — Crash before publish

```text
DB row exists, no stream message.
Relay restarts, publishes.
Safe.
```

### Case B — Crash after publish before confirm received

```text
Stream may contain message.
Outbox row still unpublished.
Relay retries same publishing id.
Stream deduplication can suppress duplicate append.
```

### Case C — Crash after confirm before marking published

```text
Stream contains message.
Outbox row still unpublished.
Relay retries same publishing id.
Deduplication can suppress duplicate append.
```

### Case D — Mark published before publish confirm

```text
Outbox row marked published.
Message may not exist in stream.
Data loss.
```

Do not do Case D.

---

## 10. Publisher State Machine

A production stream publisher should have a state machine like this:

```text
NEW_OUTBOX_ROW
    -> PUBLISHING
    -> CONFIRMED
    -> MARKED_PUBLISHED
```

With failure transitions:

```text
PUBLISHING + timeout -> UNKNOWN
UNKNOWN -> retry with same publishing id
CONFIRMED + DB update failure -> retry DB update or republish same id
```

Do not model publish timeout as immediate failure.

Timeout means:

```text
unknown whether broker appended message
```

That is exactly why deduplication exists.

---

## 11. Java Pseudocode: Outbox Relay with Stream Deduplication

This is conceptual pseudocode. Exact APIs vary with client version, but the design remains stable.

```java
public final class StreamOutboxRelay {

    private final OutboxRepository outboxRepository;
    private final Producer producer;
    private final ObjectMapper objectMapper;

    public void runBatch() {
        List<OutboxMessage> batch = outboxRepository.lockNextUnpublishedBatch(100);

        for (OutboxMessage row : batch) {
            publishOne(row);
        }
    }

    private void publishOne(OutboxMessage row) {
        Message message = producer.messageBuilder()
            .publishingId(row.publishingId())
            .properties()
                .messageId(row.eventId().toString())
                .contentType("application/json")
            .messageBuilder()
            .applicationProperties()
                .entry("messageType", row.messageType())
                .entry("schemaVersion", row.schemaVersion())
                .entry("aggregateType", row.aggregateType())
                .entry("aggregateId", row.aggregateId())
                .entry("correlationId", row.correlationId())
                .entry("causationId", row.causationId())
            .messageBuilder()
            .addData(row.payloadBytes())
            .build();

        CompletableFuture<Void> confirm = new CompletableFuture<>();

        producer.send(message, confirmationStatus -> {
            if (confirmationStatus.isConfirmed()) {
                confirm.complete(null);
            } else {
                confirm.completeExceptionally(
                    new RuntimeException("Stream publish not confirmed: " + confirmationStatus)
                );
            }
        });

        try {
            confirm.get(10, TimeUnit.SECONDS);
            outboxRepository.markPublished(row.id());
        } catch (TimeoutException e) {
            outboxRepository.recordUnknownPublishOutcome(row.id(), e);
            // Retry later with the same publishing id.
        } catch (Exception e) {
            outboxRepository.recordPublishFailure(row.id(), e);
            // Retry policy decides when this row is attempted again.
        }
    }
}
```

The important invariant:

```text
The same outbox row must always map to the same producer name + publishing id + event id.
```

---

## 12. Concurrent Publishers and Publishing IDs

A subtle failure mode appears when multiple producer instances share the same producer name.

Bad:

```text
producer name = case-service-outbox-relay
instance A publishes id 1001
instance B publishes id 1001
instance A publishes id 1002
instance B publishes id 1002
```

Unless id assignment is coordinated, this corrupts the logical sequence.

Safer options:

### Option A — Single active relay

Only one relay instance owns the producer name.

```text
case-service-outbox-relay -> one active process
```

This is simple and safe but limits throughput.

### Option B — Sharded relays

Each relay owns a shard and producer name.

```text
case-service-outbox-relay-shard-00 -> outbox rows where hash(aggregate_id) % 4 = 0
case-service-outbox-relay-shard-01 -> outbox rows where hash(aggregate_id) % 4 = 1
case-service-outbox-relay-shard-02 -> outbox rows where hash(aggregate_id) % 4 = 2
case-service-outbox-relay-shard-03 -> outbox rows where hash(aggregate_id) % 4 = 3
```

Each shard has its own monotonic sequence.

### Option C — Database locking

Multiple instances compete for rows, but a single DB sequence gives publishing ids and locking prevents duplicate simultaneous processing.

This can work, but you must still ensure that publishing ids behave correctly for the producer name.

---

## 13. Deduplication Failure Scenarios

### 13.1 Random producer name on restart

```text
Before restart: producer-abc publishes id 100
After restart:  producer-def retries id 100
```

The broker sees different producers. Deduplication cannot help.

### 13.2 Reusing publishing id for different event

```text
producer = case-service-outbox-relay
publishing id = 500
message A

producer = case-service-outbox-relay
publishing id = 500
message B
```

This is logically invalid. The second message may be treated as duplicate or rejected depending on behavior/version/client path. Do not rely on broker behavior to save you from sequence corruption.

### 13.3 Publishing id reset after deployment

```text
old version used DB sequence
new version starts AtomicLong at 0
```

Dangerous. Publishing id state must be durable.

### 13.4 Sharing producer name across unrelated services

```text
producer name = event-publisher
```

Too broad. Different services may collide.

Use service/workload-specific names.

### 13.5 Deduplication used instead of consumer idempotency

Even if the stream has no duplicate records, consumers can still apply the same business effect twice through replay, crash recovery, manual reprocessing, or downstream retry.

---

## 14. Stream Filtering: The Real Problem

Streams can become broad historical logs.

Example:

```text
stream = regulatory.case-events
```

It may contain:

```text
case.opened
case.assigned
evidence.submitted
evidence.validated
risk.score.updated
enforcement.action.proposed
notification.sent
audit.recorded
```

A consumer may only need:

```text
evidence.*
```

Without filtering, it reads everything and discards most messages locally.

That wastes:

- network bandwidth;
- client CPU;
- deserialization time;
- memory;
- downstream capacity;
- consumer lag budget.

Stream filtering can reduce that waste.

---

## 15. Filtering Mental Model

Filtering is a **first-stage broker-side selection mechanism**.

It is not a replacement for:

- authorization;
- schema validation;
- business rule evaluation;
- consumer-side defensive checks;
- tenant isolation;
- queue topology where hard isolation is required.

A good mental model:

```text
Broker filtering reduces what is delivered.
Consumer validation decides what is allowed and meaningful.
```

---

## 16. Designing Filter Values

Filter values should be stable, low-to-moderate cardinality, and operationally meaningful.

Good candidates:

```text
messageType = evidence.submitted.v1
category = evidence
tenantTier = regulated
region = apac
caseType = market-abuse
```

Risky candidates:

```text
userId = 123456789
requestId = uuid-per-message
traceId = uuid-per-message
freeText = arbitrary string
```

High-cardinality filters can reduce usefulness and increase complexity.

### Filter Design Rule

Choose filter values that describe **routing/consumption classes**, not every individual entity.

---

## 17. Filter Value vs Routing Key

RabbitMQ exchange routing keys and stream filter values solve different problems.

| Concept | Used For | When Applied |
|---|---|---|
| Exchange routing key | Route message to queue/stream at publish time | Before storage in destination |
| Stream filter value | Select subset while consuming from existing stream | After message is already in stream |

Example:

```text
Exchange routing key:
    case.evidence.submitted

Stream filter values:
    messageType=evidence.submitted
    caseType=market-abuse
    region=apac
```

Do not force all consumption selection into routing keys. Streams are often retained broad history; filters can make broad history more efficient to consume.

---

## 18. Filter Value vs Message Header

A filter value is not merely a random header.

In practice, you should keep important filter values aligned with envelope metadata.

Example envelope:

```json
{
  "messageId": "evt_01J...",
  "messageType": "evidence.submitted",
  "schemaVersion": 3,
  "tenantId": "regulator-a",
  "region": "apac",
  "caseType": "market-abuse",
  "payload": {
    "caseId": "CASE-10091",
    "evidenceId": "EVD-8812"
  }
}
```

Filter values:

```text
evidence.submitted
region:apac
caseType:market-abuse
```

Consumer should still validate the message envelope. Filtering is an optimization, not correctness proof.

---

## 19. Filtering Anti-Patterns

### 19.1 Filtering as authorization

Bad:

```text
Consumer for tenant A uses filter tenant=A, therefore it is secure.
```

No. Tenant isolation should use permissions, vhosts, topology separation, encryption, and application authorization where required.

### 19.2 Filtering after unstable field

Bad:

```text
filter = displayName
```

Display names change. Filters should be stable.

### 19.3 Filter value tied to schema internals

Bad:

```text
filter = payload.v3.evidence.details.source.system.internalCode
```

When payload evolves, filtering breaks.

### 19.4 Too many ultra-specific filters

Bad:

```text
filter = caseId:CASE-10091
```

This may be useful for forensic one-off tools, but not as a main production consumption strategy.

### 19.5 Assuming filters eliminate all irrelevant messages

Filtering can reduce delivery. It should not be the only condition in the consumer.

---

## 20. Replay: The Power and the Trap

Replay means a consumer reads old stream messages again.

Use cases:

- rebuild read model;
- re-run fraud/risk scoring with new logic;
- reconstruct audit timeline;
- backfill new service;
- test new projection code;
- recover from corrupted downstream state;
- reprocess after failed deployment;
- generate historical reports;
- migrate systems.

But replay is dangerous because old messages may trigger side effects again.

Dangerous side effects:

- sending email/SMS;
- charging payment;
- submitting report to regulator;
- creating enforcement action twice;
- updating external system twice;
- incrementing counters non-idempotently;
- overwriting newer data with older state.

Replay-safe consumers are intentionally designed.

---

## 21. Offset Specifications

A stream consumer needs a start position.

Common start modes:

```text
first        -> start from earliest retained message
last         -> start near latest available message
next         -> start from messages published after subscription
specific     -> start from an explicit offset
 timestamp   -> start from messages around a time point
stored       -> resume from stored consumer offset
```

The exact names depend on client API, but the conceptual model is stable.

### When to use each

| Start mode | Use case | Risk |
|---|---|---|
| first | rebuild from full retained history | huge replay, old schemas |
| next | live-only consumer | misses history |
| specific offset | precise recovery/debugging | needs offset knowledge |
| timestamp | time-window reprocessing | time boundaries may be approximate |
| stored offset | normal restart | unsafe if stored too early |

---

## 22. Offset Is Not Business State

Never treat offset alone as proof that business processing is complete.

Bad sequence:

```text
1. read message at offset 900
2. store offset 900
3. update projection database
4. crash before DB commit
```

After restart, consumer resumes after offset 900.

The business update is lost.

Better sequence:

```text
1. read message at offset 900
2. begin DB transaction
3. apply idempotent business update
4. record processed message id / offset
5. commit DB transaction
6. store/advance stream offset
```

But even this has nuance. If offset storage is separate from DB transaction, there is still a crash gap.

Strongest pattern:

```text
Business state + processed message id + consumer offset are stored in same database transaction.
```

Then server-side offset tracking can be used as a convenience, but not the only correctness source.

---

## 23. Consumer Offset Storage Strategies

### 23.1 Server-side offset tracking

RabbitMQ Streams can track consumer offsets server-side.

Good for:

- simple consumers;
- restart-from-last-position behavior;
- operational convenience.

Risk:

- offset may not be transactional with your business database.

### 23.2 Application database offset store

Store offset alongside projection state.

Example:

```sql
CREATE TABLE stream_consumer_checkpoint (
    consumer_name TEXT NOT NULL,
    stream_name TEXT NOT NULL,
    partition_name TEXT NOT NULL DEFAULT '',
    offset_value BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (consumer_name, stream_name, partition_name)
);
```

In same transaction as projection update:

```sql
BEGIN;

-- apply projection update
INSERT INTO case_projection (...)
VALUES (...)
ON CONFLICT (...) DO UPDATE SET ...;

-- remember processed event
INSERT INTO processed_message (consumer_name, message_id, processed_at)
VALUES ('case-projection-v2', 'evt_01J...', now())
ON CONFLICT DO NOTHING;

-- update checkpoint
UPDATE stream_consumer_checkpoint
SET offset_value = 900, updated_at = now()
WHERE consumer_name = 'case-projection-v2'
  AND stream_name = 'regulatory.case-events';

COMMIT;
```

### 23.3 Hybrid

Use DB offset as source of correctness and periodically store server-side offset for operational convenience.

---

## 24. Idempotent Replay Pattern

A replay-safe consumer does not ask:

```text
Have I seen offset 900?
```

It asks:

```text
Have I already applied the business effect of message evt_01J... for this consumer purpose?
```

Example table:

```sql
CREATE TABLE processed_message (
    consumer_name TEXT NOT NULL,
    message_id UUID NOT NULL,
    message_type TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    stream_name TEXT NOT NULL,
    stream_offset BIGINT NOT NULL,
    PRIMARY KEY (consumer_name, message_id)
);
```

Consumer flow:

```text
read stream message
parse envelope
begin DB transaction
try insert processed_message
if already exists:
    skip business effect
else:
    apply business effect
    update checkpoint
commit
```

This makes replay safe for stateful projections.

---

## 25. Replay Modes

Replay is not one thing. There are several modes.

### 25.1 Full rebuild replay

```text
start = first available offset
end = current end or bounded timestamp
purpose = rebuild entire projection
```

Use for:

- rebuilding read models;
- new projection version;
- historical analytics.

Requirements:

- schema compatibility;
- high throughput;
- no external side effects;
- isolated target table or versioned projection.

### 25.2 Time-window replay

```text
start = timestamp T1
end = timestamp T2
purpose = repair affected window
```

Use for:

- bad deployment between 10:00 and 11:30;
- external outage period;
- partial rebuild.

Requirements:

- exact incident window;
- idempotency;
- bounded rate.

### 25.3 Targeted entity replay

```text
start = old offset/time
filter/process only aggregateId = CASE-123
```

Often done by forensic tools.

Requirements:

- careful filtering;
- low volume;
- audit logging;
- no accidental global side effects.

### 25.4 Shadow replay

```text
read historical messages
write to shadow table/output
compare with production result
```

Use for:

- validating new logic;
- migration dry run;
- regression testing.

### 25.5 Live catch-up replay

```text
start = old offset
process until near live head
then switch to live mode
```

Use for:

- launching new consumer;
- projection rebuild with minimal downtime.

---

## 26. Replay Isolation Patterns

Do not replay into production side effects blindly.

### 26.1 Projection versioning

Instead of overwriting current projection:

```text
case_projection_v1
case_projection_v2_rebuild
```

Flow:

```text
replay into v2 table
validate counts/checksums
switch readers to v2
keep v1 for rollback window
```

### 26.2 Side-effect disabled mode

Replay consumer disables side effects:

```text
sendNotification = false
callExternalRegulator = false
updateProjection = true
```

This should be explicit and visible, not hidden behind environment accidents.

### 26.3 Replay-specific consumer name

Use a different consumer identity:

```text
case-projection-live
case-projection-rebuild-2026-06-19
```

This prevents replay offsets from corrupting live offsets.

### 26.4 Replay sandbox

Replay from production stream into isolated environment or database snapshot.

Useful for:

- test migrations;
- analytics;
- incident analysis.

### 26.5 Rate-limited replay

Replay can be faster than downstream systems can handle.

Bound it:

```text
max messages/sec
max DB writes/sec
max in-flight messages
max CPU utilization
max lag catch-up rate
```

---

## 27. Replay End Boundary

A replay job should define its end boundary.

Bad:

```text
Replay from beginning until done.
```

What is “done” if new messages are still arriving?

Better:

```text
Replay from offset 0 to captured end offset 3,812,991.
```

Or:

```text
Replay from timestamp 2026-06-01T00:00:00Z to 2026-06-02T00:00:00Z.
```

For live catch-up:

```text
Replay until lag < 1000 messages, then switch mode to live consumer.
```

But that switch should be operationally explicit.

---

## 28. Replay and Schema Evolution

Historical streams contain old messages.

Your current code may expect new schema.

Possible issues:

- missing fields;
- renamed fields;
- changed enum values;
- semantic changes;
- old events that are no longer produced;
- payloads emitted by buggy historical versions.

Replay-safe consumers need schema strategy:

1. keep old deserializers;
2. use envelope `messageType` and `schemaVersion`;
3. support upcasters;
4. validate unknown fields carefully;
5. quarantine unprocessable historical messages;
6. measure schema-version distribution before replay.

Example upcaster:

```java
public interface EventUpcaster {
    boolean supports(String messageType, int schemaVersion);
    JsonNode upcast(JsonNode oldPayload);
}
```

Then:

```java
JsonNode normalized = upcasterRegistry.upcastToCurrent(
    envelope.messageType(),
    envelope.schemaVersion(),
    envelope.payload()
);
```

Do not assume old messages match the current DTO.

---

## 29. Replay and External Side Effects

Classify consumers by side-effect safety.

| Consumer Type | Replay Safe? | Notes |
|---|---:|---|
| Projection builder | Usually yes | Must be idempotent/versioned |
| Analytics aggregator | Usually yes | Watch duplicate counting |
| Notification sender | Usually no | Avoid sending old emails/SMS |
| External API submitter | Usually no | Requires explicit idempotency keys and replay mode |
| Audit writer | Maybe | Depends whether audit must record replay itself |
| Cache warmer | Usually yes | If bounded |

Rule:

```text
A replay job must explicitly declare which side effects are enabled.
```

---

## 30. Replay and Regulatory Audit

In regulatory systems, replay must be auditable.

You need to know:

- who initiated replay;
- why replay happened;
- which stream was replayed;
- start offset/time;
- end offset/time;
- consumer version;
- code version/git commit;
- schemas supported;
- records processed;
- records skipped;
- records quarantined;
- side effects enabled/disabled;
- target data written;
- validation result;
- approval reference.

Example replay audit table:

```sql
CREATE TABLE replay_job (
    replay_job_id UUID PRIMARY KEY,
    stream_name TEXT NOT NULL,
    consumer_name TEXT NOT NULL,
    reason TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    approved_by TEXT NULL,
    start_offset BIGINT NULL,
    end_offset BIGINT NULL,
    start_time TIMESTAMPTZ NULL,
    end_time TIMESTAMPTZ NULL,
    side_effect_mode TEXT NOT NULL,
    code_version TEXT NOT NULL,
    status TEXT NOT NULL,
    records_read BIGINT NOT NULL DEFAULT 0,
    records_applied BIGINT NOT NULL DEFAULT 0,
    records_skipped BIGINT NOT NULL DEFAULT 0,
    records_quarantined BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ NULL
);
```

Replay is not just technical recovery. It is an operational action that may affect regulated data.

---

## 31. Reprocessing Patterns

Replay reads historical messages. Reprocessing applies new action to them.

### 31.1 In-place reprocessing

Read old messages and update the same target tables.

Pros:

- simple;
- no duplicate infrastructure.

Cons:

- risky;
- may corrupt live state;
- hard rollback.

Use only for small, well-bounded repairs.

### 31.2 Shadow reprocessing

Read old messages into new target.

Pros:

- safe comparison;
- rollback friendly.

Cons:

- more storage;
- switch-over complexity.

Best for projection rebuilds.

### 31.3 Emit correction events

Read old messages, detect incorrect effects, emit explicit correction commands/events.

Pros:

- auditable;
- domain-legible;
- avoids silent mutation.

Cons:

- slower;
- requires correction model.

Best for regulated workflows.

Example:

```text
Original: RiskScoreCalculated(score=80, ruleVersion=12)
Bug found in ruleVersion=12
Replay detects affected cases
Emit: RiskScoreCorrectionRequested(reason=RULE_BUG_2026_06)
```

### 31.4 Manual review queue

Replay identifies suspicious records and sends them to a review workflow.

Good for:

- compliance;
- enforcement decisions;
- data quality issues;
- human-in-the-loop correction.

---

## 32. Quarantine Pattern for Streams

A stream consumer may encounter messages it cannot process:

- invalid JSON;
- unknown schema;
- unsupported version;
- missing required metadata;
- impossible business transition;
- external reference missing.

For queues, you often use DLQ.

For streams, because consuming is non-destructive, the pattern is different.

You can create a quarantine stream/queue:

```text
regulatory.case-events
    -> consumer fails to process offset 92831
    -> publish quarantine record to regulatory.case-events.quarantine
    -> decide whether to skip, stop, or continue
```

Quarantine record should include:

```json
{
  "quarantineId": "q_01J...",
  "sourceStream": "regulatory.case-events",
  "sourceOffset": 92831,
  "sourceMessageId": "evt_01J...",
  "consumerName": "case-projection-v2",
  "failureType": "UNSUPPORTED_SCHEMA_VERSION",
  "failureMessage": "schemaVersion=1 no longer supported",
  "payloadHash": "sha256:...",
  "occurredAt": "2026-06-19T10:11:12Z"
}
```

Policy decision:

| Failure | Default Action |
|---|---|
| Invalid envelope | quarantine and stop or skip depending on criticality |
| Unknown schema | quarantine and stop replay |
| Duplicate message | skip |
| Business invariant violation | quarantine and require review |
| External dependency unavailable | retry later, do not advance incorrectly |

---

## 33. Stream Filtering + Replay Combination

Filtering and replay can be combined.

Example:

```text
Replay only evidence-related events from last 30 days.
```

Possible filter values:

```text
category=evidence
messageType=evidence.submitted
messageType=evidence.validated
```

Start boundary:

```text
timestamp = 2026-05-19T00:00:00Z
```

End boundary:

```text
captured end offset at replay start
```

Consumer mode:

```text
side effects disabled
projection target = evidence_projection_rebuild_2026_06
```

This is a good pattern.

Bad pattern:

```text
Replay filtered messages directly into production projection with notifications enabled.
```

---

## 34. Stream-to-Queue Bridge Pattern

Sometimes you want historical stream replay but queue-based work distribution.

Pattern:

```text
stream replay consumer
    reads stream from offset/time
    filters/selects messages
    publishes commands/jobs to RabbitMQ exchange/queue
    waits for publisher confirm
    records bridge checkpoint
```

Use cases:

- backfill missing jobs;
- re-trigger validation for selected cases;
- generate remediation tasks;
- migrate old events into new workflow.

Risks:

- duplicate jobs;
- overwhelming queues;
- losing replay checkpoint;
- side effects repeated;
- changing historical event semantics.

Bridge invariants:

```text
One source message + one bridge purpose -> one deterministic output command id.
```

Example command id:

```text
revalidate-evidence:${sourceStream}:${sourceOffset}:${replayJobId}
```

Or for business idempotency:

```text
revalidate-evidence:${evidenceId}:${ruleVersion}:${replayReason}
```

Choose based on desired semantics.

---

## 35. Replay Job State Machine

A replay job should be a state machine.

```text
REQUESTED
    -> APPROVED
    -> INITIALIZING
    -> RUNNING
    -> PAUSED
    -> COMPLETED
    -> FAILED
    -> CANCELLED
```

Transitions should be explicit.

```text
REQUESTED -> APPROVED
    requires approval for production side effects

APPROVED -> INITIALIZING
    captures stream boundaries and validates schema support

INITIALIZING -> RUNNING
    starts consumer with replay-specific identity

RUNNING -> PAUSED
    operator pause or downstream overload

RUNNING -> COMPLETED
    processed through end boundary

RUNNING -> FAILED
    unrecoverable error or quarantine threshold exceeded
```

This is especially useful in regulatory environments.

---

## 36. Replay Safety Checklist

Before replaying, answer these questions.

### Scope

- Which stream?
- Which partitions, if super stream?
- Which offset/time range?
- Which message types?
- Which tenants/regions?
- Which aggregate ids?

### Purpose

- Rebuild projection?
- Repair data?
- Validate new logic?
- Backfill new service?
- Re-trigger workflow?
- Investigate incident?

### Side effects

- Are notifications disabled?
- Are external API calls disabled?
- Are command emissions enabled?
- Are correction events emitted instead of direct mutation?

### Correctness

- Is consumer idempotent?
- Is schema evolution handled?
- Is checkpoint transactional with business state?
- Is replay using separate consumer identity?
- Is end boundary fixed?

### Operations

- What is max rate?
- What dashboards will be watched?
- What is abort condition?
- What is rollback plan?
- Who approved it?

---

## 37. Java Replay Consumer Skeleton

Conceptual design:

```java
public final class ReplayConsumer {

    private final ReplayJobRepository replayJobs;
    private final ProjectionRepository projections;
    private final ProcessedMessageRepository processedMessages;
    private final EventDeserializer eventDeserializer;

    public void handle(StreamMessageContext ctx, byte[] body) {
        ReplayJob job = replayJobs.getCurrentJob();
        EventEnvelope envelope = eventDeserializer.deserialize(body);

        if (!job.includes(envelope)) {
            replayJobs.incrementSkipped(job.id());
            return;
        }

        try {
            projections.inTransaction(tx -> {
                boolean firstTimeForThisPurpose = processedMessages.tryInsert(
                    tx,
                    job.consumerName(),
                    envelope.messageId(),
                    ctx.streamName(),
                    ctx.offset()
                );

                if (!firstTimeForThisPurpose) {
                    replayJobs.incrementSkipped(job.id());
                    return;
                }

                DomainEvent event = eventDeserializer.toDomainEvent(envelope);

                if (job.sideEffectsDisabled()) {
                    projections.applyWithoutExternalEffects(tx, event);
                } else {
                    projections.applyWithAllowedEffects(tx, event, job.allowedEffects());
                }

                replayJobs.updateCheckpoint(tx, job.id(), ctx.streamName(), ctx.offset());
                replayJobs.incrementApplied(tx, job.id());
            });
        } catch (UnsupportedSchemaException e) {
            replayJobs.quarantine(job.id(), ctx.streamName(), ctx.offset(), envelope, e);
            if (job.stopOnQuarantine()) {
                throw e;
            }
        }
    }
}
```

Notice:

- replay job identity is separate from live consumer;
- processed message is keyed by consumer/purpose;
- offset is recorded with business transaction;
- side effects are explicit;
- unsupported schema can quarantine and stop.

---

## 38. Filtering Consumer Skeleton

Conceptual example:

```java
Consumer consumer = environment.consumerBuilder()
    .stream("regulatory.case-events")
    .name("evidence-projection-live")
    .offset(OffsetSpecification.next())
    .filter()
        .values("category:evidence", "messageType:evidence.submitted")
    .builder()
    .messageHandler((context, message) -> {
        EventEnvelope envelope = decode(message);

        // Still validate; filter is not authorization/correctness.
        if (!"evidence.submitted".equals(envelope.messageType())) {
            return;
        }

        handleEvidenceSubmitted(context, envelope);
    })
    .build();
```

Exact builder syntax may vary by client version. The design principle is stable:

```text
Use filter to reduce delivery, not to remove validation.
```

---

## 39. Observability for Deduplication

Track:

- messages attempted;
- messages confirmed;
- messages errored;
- publish timeout count;
- retry count;
- outbox unpublished age;
- producer name;
- last publishing id attempted;
- last publishing id confirmed;
- duplicate/dedup behavior if exposed by metrics/tools;
- connection churn;
- in-flight publish count.

Operational questions:

```text
Is the outbox relay stuck?
Are publishing ids advancing?
Are confirms delayed?
Are retries rising?
Did a deployment reset publishing id logic?
Are multiple relays sharing a producer name incorrectly?
```

---

## 40. Observability for Filtering

Track:

- total stream messages read by broker/client;
- delivered-to-consumer count;
- filtered ratio;
- consumer lag;
- bytes delivered;
- decode failures;
- post-filter validation rejects;
- message type distribution;
- schema version distribution.

If the filter ratio is poor, maybe the filter value is too broad.

If validation rejects many messages after filtering, maybe filter semantics are wrong or publisher metadata is inconsistent.

---

## 41. Observability for Replay

Track per replay job:

- replay status;
- start offset;
- current offset;
- end offset;
- lag to end boundary;
- records read;
- records applied;
- records skipped;
- records quarantined;
- records failed;
- throughput;
- DB write latency;
- downstream errors;
- side effects emitted;
- schema versions encountered;
- oldest/newest event time processed.

Dashboards should separate:

```text
live consumer lag
replay consumer progress
```

A replay job should not make live lag unreadable.

---

## 42. Capacity Planning for Replay

Estimate replay cost.

```text
messages_to_replay = end_offset - start_offset + 1
avg_message_size_bytes = 4 KB
read_volume = messages_to_replay * avg_message_size_bytes
processing_rate = messages/sec
expected_duration = messages_to_replay / processing_rate
DB_writes = messages_to_replay * writes_per_message
```

Example:

```text
messages_to_replay = 50,000,000
processing_rate = 5,000 msg/sec
expected_duration = 10,000 sec = ~2.78 hours
```

But if each message causes DB writes:

```text
writes_per_message = 3
DB writes = 150,000,000
```

The stream may handle replay easily while the database becomes bottleneck.

RabbitMQ capacity is only one part of replay capacity.

---

## 43. Retention and Replay Window

Replay depends on retention.

If retention is 7 days, you cannot replay 30 days from the stream.

Retention must be set from business requirements:

```text
Need rebuild projections for 90 days?
Need audit reconstruction for 7 years?
Need analytics replay for 13 months?
```

RabbitMQ Streams can be retained by size/time policy, but operational storage must be planned.

Do not casually set infinite retention because:

- disk grows;
- recovery takes longer;
- backup/restore becomes harder;
- old schemas accumulate;
- compliance deletion requirements may apply.

Decision:

```text
Operational replay stream retention != legal archive retention
```

For long-term legal retention, you may need an archive store separate from RabbitMQ.

---

## 44. Security and Compliance

Streams are retained history. That changes data risk.

Questions:

- Are sensitive fields stored in stream payload?
- Is payload encrypted at application level?
- Who has permission to consume from old offsets?
- Can replay expose data to a new consumer that should not see it?
- How is right-to-erasure handled, if applicable?
- Are stream filters being misused as security controls?
- Are replay jobs approved and logged?
- Are quarantine payloads leaking sensitive information?

Avoid storing large sensitive documents directly in streams.

Better:

```text
stream message = metadata + reference + hash + classification
object store = encrypted payload/document
```

---

## 45. Design Pattern: Audit Stream for Enforcement Case

Domain events:

```text
case.opened
evidence.submitted
evidence.validated
rule.evaluated
risk.score.updated
enforcement.action.proposed
review.assigned
notice.sent
case.closed
```

Stream:

```text
regulatory.case-audit-stream
```

Producer:

```text
case-service-outbox-relay
```

Publishing id:

```text
outbox_message.publishing_id
```

Filter values:

```text
messageType:case.opened
messageType:evidence.submitted
category:evidence
category:risk
category:enforcement
region:apac
caseType:market-abuse
```

Consumers:

```text
case-timeline-projection-live
risk-analytics-live
enforcement-dashboard-live
audit-export-batch
case-projection-rebuild-2026-06
```

Replay example:

```text
Replay all evidence events for region=apac between 2026-06-01 and 2026-06-10 into evidence_projection_v2_shadow.
```

Safety:

```text
notifications disabled
external regulator submissions disabled
projection target shadow
audit replay job required
quarantine threshold = 1 unsupported schema stops job
```

---

## 46. Decision Matrix

| Problem | RabbitMQ Streams Feature | Application Pattern Still Needed |
|---|---|---|
| Retry publish after unknown confirm | Deduplication | Outbox, stable producer name, durable publishing id |
| Select subset of large stream | Filtering | Envelope validation, authorization, schema checks |
| Rebuild projection | Replay from first/specific offset | Idempotent consumer, versioned target, checkpointing |
| Recover from bad deployment | Time-window replay | Incident boundary, side-effect control, audit trail |
| Launch new consumer | Replay + catch-up | Schema compatibility, backpressure, separate consumer identity |
| Avoid duplicate side effects | Not solved by stream alone | Idempotency table, external idempotency keys |
| Legal audit history | Retention helps | Archive policy, access control, immutability controls |

---

## 47. Production Checklist

### Deduplication

- [ ] Producer name is stable and meaningful.
- [ ] Publishing id is durable and strictly increasing per producer.
- [ ] Producer identity is not random per restart.
- [ ] Multiple producers do not share a producer name unless coordinated.
- [ ] Outbox row maps deterministically to publishing id.
- [ ] Publish confirm is awaited before marking row published.
- [ ] Timeout is treated as unknown, not failure.
- [ ] Consumer idempotency still exists.

### Filtering

- [ ] Filter values are stable.
- [ ] Filter values are not high-cardinality accidental IDs.
- [ ] Filter values align with envelope metadata.
- [ ] Consumer still validates message type and schema.
- [ ] Filtering is not used as authorization.
- [ ] Filter ratio is monitored.

### Replay

- [ ] Replay has explicit purpose.
- [ ] Replay has start and end boundary.
- [ ] Replay uses separate consumer identity.
- [ ] Side effects are explicitly enabled/disabled.
- [ ] Schema versions are supported or quarantined.
- [ ] Business state and checkpoint are transactionally consistent.
- [ ] Rate limits are set.
- [ ] Replay job is auditable.
- [ ] Rollback/switch-over plan exists.

---

## 48. Common Interview-Level Questions

### Q1. Does RabbitMQ Stream deduplication give exactly-once processing?

No. It helps avoid duplicate appends from a named producer with publishing ids. It does not guarantee exactly-once consumer side effects. Consumers still need idempotency and transactional state management.

### Q2. Why is a random producer name bad?

Because deduplication depends on stable producer identity. If every restart creates a new producer name, retries cannot be correlated with previous publish attempts.

### Q3. Why should publishing id come from the outbox table?

Because the outbox table is durable, transactional with business state, recoverable after crash, and auditable. It prevents sequence reset and makes retry deterministic.

### Q4. Is stream filtering a security feature?

No. It is primarily an efficiency feature. Security requires proper authorization, permissions, topology isolation, and application validation.

### Q5. Why is offset not enough for idempotency?

Offset identifies a stream position. Business idempotency should identify whether a business effect for a message/event has already been applied. Replay, migration, republish, or partitioning can change offsets.

### Q6. What is the safest way to rebuild a projection?

Replay into a versioned/shadow projection, validate it, then switch readers. Avoid mutating production state directly unless the repair is small and well-controlled.

### Q7. What is the biggest danger of replay?

Re-triggering side effects or overwriting newer state with older event effects.

---

## 49. Mini Lab Exercises

### Lab 1 — Deduplicated Outbox Publisher

Build:

- PostgreSQL outbox table;
- stream producer with stable producer name;
- publishing id from outbox row;
- confirm handling;
- retry on timeout with same publishing id.

Test:

- kill publisher after send but before mark-published;
- restart relay;
- verify stream does not contain duplicate logical message.

### Lab 2 — Filtered Consumer

Build:

- stream with mixed event types;
- publisher attaches filter values;
- consumer subscribes only to evidence events;
- consumer still validates envelope.

Measure:

- delivered messages;
- skipped messages;
- validation rejects.

### Lab 3 — Projection Replay

Build:

- stream with case lifecycle events;
- projection table;
- processed_message table;
- replay consumer from first offset;
- replay into `case_projection_v2_shadow`.

Test:

- run replay twice;
- verify no duplicate effects;
- compare projection count/checksum.

### Lab 4 — Quarantine Unsupported Schema

Build:

- publish old schema version event;
- replay consumer supports only newer schema;
- quarantine invalid/unsupported event;
- stop replay when threshold exceeded.

### Lab 5 — Stream-to-Queue Bridge

Build:

- replay selected events;
- emit revalidation jobs to quorum queue;
- deterministic job id;
- idempotent worker.

Test:

- replay same range twice;
- verify jobs are not duplicated logically.

---

## 50. Final Mental Model

RabbitMQ Streams give you a retained log.

That log gives you replay.

Replay gives you power.

Power requires discipline.

The key invariants are:

```text
Producer correctness:
    stable producer name
    durable increasing publishing id
    confirm before marking published
    retry unknown outcome with same identity

Consumer correctness:
    stable message id
    idempotent business effect
    transactional checkpoint
    replay-safe side-effect policy

Filtering correctness:
    filter for efficiency
    validate for correctness
    authorize outside filter

Replay correctness:
    explicit scope
    explicit end boundary
    explicit consumer identity
    explicit side-effect mode
    explicit audit trail
```

If you internalize those invariants, RabbitMQ Streams become much more than “RabbitMQ with log storage”. They become a practical foundation for auditability, reprocessing, recovery, and historical workflows in Java systems.

---

## References

- RabbitMQ Documentation — Streams and Super Streams: https://www.rabbitmq.com/docs/streams
- RabbitMQ Documentation — Stream Filtering: https://www.rabbitmq.com/docs/next/stream-filtering
- RabbitMQ Blog — Message Deduplication with RabbitMQ Streams: https://www.rabbitmq.com/blog/2021/07/28/rabbitmq-streams-message-deduplication
- RabbitMQ Blog — Offset Tracking with RabbitMQ Streams: https://www.rabbitmq.com/blog/2021/09/13/rabbitmq-streams-offset-tracking
- RabbitMQ Stream Java Client Documentation: https://rabbitmq.github.io/rabbitmq-stream-java-client/stable/htmlsingle/

---

## Series Progress

- [x] Part 00 — Orientation, Mental Model, dan Scope RabbitMQ Modern
- [x] Part 01 — Messaging Fundamentals yang Spesifik RabbitMQ
- [x] Part 02 — AMQP 0-9-1 Deep Dive
- [x] Part 03 — Exchange Routing Mastery
- [x] Part 04 — Queue Semantics: Classic, Quorum, Stream
- [x] Part 05 — Hands-on Local Lab
- [x] Part 06 — Java Client Fundamentals tanpa Spring
- [x] Part 07 — Publisher Reliability
- [x] Part 08 — Consumer Reliability
- [x] Part 09 — Retry, Dead Lettering, Poison Message, Parking Lot
- [x] Part 10 — Spring AMQP Deep Dive
- [x] Part 11 — Spring Boot Integration Patterns
- [x] Part 12 — Message Contract Design untuk Java Systems
- [x] Part 13 — Ordering, Concurrency, Partitioning, and Work Distribution
- [x] Part 14 — RPC, Request/Reply, Correlation, Timeout
- [x] Part 15 — Workflow, Saga, and Enforcement Lifecycle Modelling
- [x] Part 16 — RabbitMQ Streams Mental Model
- [x] Part 17 — RabbitMQ Stream Java Client
- [x] Part 18 — Super Streams and Partitioned Streaming
- [x] Part 19 — Stream Deduplication, Filtering, and Replay Patterns
- [ ] Part 20 — Quorum Queues Deep Dive

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-18.md">⬅️ Part 18 — Super Streams and Partitioned Streaming</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-20.md">Part 20 — Quorum Queues Deep Dive ➡️</a>
</div>
