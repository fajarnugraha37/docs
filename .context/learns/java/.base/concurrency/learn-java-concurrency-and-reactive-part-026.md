# learn-java-concurrency-and-reactive-part-026.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 026  
# Distributed Concurrency and Coordination Overview: Idempotency, Ordering, Distributed Locks, Leases, Fencing Tokens, Leader Election, Sagas, Outbox, and Exactly-Once Illusions

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **026**  
> Fokus: memahami concurrency ketika aplikasi tidak lagi berjalan di satu JVM, tetapi tersebar di banyak instance, service, database, message broker, cache, dan region. Kita akan membahas distributed coordination, idempotency, ordering, duplicate delivery, distributed locks, leases, fencing tokens, leader election, consensus, queues, sagas, outbox, transactional messaging, optimistic concurrency, versioning, compare-and-set, clock/time problems, retries, and failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Dari Local Concurrency ke Distributed Concurrency](#2-dari-local-concurrency-ke-distributed-concurrency)
3. [Kenapa Distributed Concurrency Lebih Sulit](#3-kenapa-distributed-concurrency-lebih-sulit)
4. [Mental Model: No Shared Memory, Only Messages](#4-mental-model-no-shared-memory-only-messages)
5. [Failure Model](#5-failure-model)
6. [Network Is Not Reliable](#6-network-is-not-reliable)
7. [Time, Clocks, and Ordering](#7-time-clocks-and-ordering)
8. [Happens-Before in Distributed Systems](#8-happensbefore-in-distributed-systems)
9. [Idempotency](#9-idempotency)
10. [Idempotency Keys](#10-idempotency-keys)
11. [Deduplication Store](#11-deduplication-store)
12. [Retries and Duplicate Side Effects](#12-retries-and-duplicate-side-effects)
13. [At-Most-Once, At-Least-Once, Exactly-Once](#13-atmostonce-atleastonce-exactlyonce)
14. [Exactly-Once Illusions](#14-exactlyonce-illusions)
15. [Ordering](#15-ordering)
16. [Per-Key Ordering](#16-perkey-ordering)
17. [Versioning and Monotonic Updates](#17-versioning-and-monotonic-updates)
18. [Optimistic Distributed Concurrency](#18-optimistic-distributed-concurrency)
19. [Compare-And-Set and Conditional Writes](#19-compareandset-and-conditional-writes)
20. [Distributed Locks](#20-distributed-locks)
21. [Why Distributed Locks Are Dangerous](#21-why-distributed-locks-are-dangerous)
22. [Leases](#22-leases)
23. [Fencing Tokens](#23-fencing-tokens)
24. [Leader Election](#24-leader-election)
25. [Consensus Overview](#25-consensus-overview)
26. [Coordination Services](#26-coordination-services)
27. [Message Queues and Consumer Groups](#27-message-queues-and-consumer-groups)
28. [Kafka-Style Partition Ownership](#28-kafkastyle-partition-ownership)
29. [Outbox Pattern](#29-outbox-pattern)
30. [Inbox Pattern](#30-inbox-pattern)
31. [Saga Pattern](#31-saga-pattern)
32. [Distributed Transactions and 2PC](#32-distributed-transactions-and-2pc)
33. [Locks vs Idempotency vs Ordering](#33-locks-vs-idempotency-vs-ordering)
34. [Cache, Redis, and Coordination Pitfalls](#34-cache-redis-and-coordination-pitfalls)
35. [Database as Coordination Boundary](#35-database-as-coordination-boundary)
36. [Rate Limits and Quotas](#36-rate-limits-and-quotas)
37. [Multi-Instance Spring Boot Considerations](#37-multiinstance-spring-boot-considerations)
38. [Observability](#38-observability)
39. [Testing Distributed Concurrency](#39-testing-distributed-concurrency)
40. [Mini Case Study: Duplicate Payment Command](#40-mini-case-study-duplicate-payment-command)
41. [Mini Case Study: Scheduled Job Runs on Every Pod](#41-mini-case-study-scheduled-job-runs-on-every-pod)
42. [Mini Case Study: Stale Lock Owner Writes Data](#42-mini-case-study-stale-lock-owner-writes-data)
43. [Common Anti-Patterns](#43-common-antipatterns)
44. [Best Practices](#44-best-practices)
45. [Decision Matrix](#45-decision-matrix)
46. [Latihan](#46-latihan)
47. [Ringkasan](#47-ringkasan)
48. [Referensi](#48-referensi)

---

# 1. Tujuan Bagian Ini

Sampai bagian sebelumnya, banyak pembahasan berada di level satu JVM:

```text
thread
lock
executor
virtual thread
connection pool
transaction
queue in memory
```

Tetapi sistem production modern sering berjalan sebagai:

```text
multiple pods
multiple service instances
multiple databases/cache nodes
message brokers
external APIs
scheduled workers
event consumers
```

Pada titik ini, `synchronized`, `ReentrantLock`, `Semaphore`, dan `ThreadLocal` hanya berlaku lokal di satu JVM.

Jika service punya 10 pods:

```text
synchronized hanya mengunci di dalam 1 pod
bukan seluruh cluster
```

Target bagian ini:

```text
Mampu memahami perbedaan local concurrency dan distributed concurrency,
memilih idempotency/order/versioning daripada lock jika memungkinkan,
dan menghindari jebakan distributed lock yang terlihat sederhana tetapi rapuh.
```

---

# 2. Dari Local Concurrency ke Distributed Concurrency

Local concurrency:

```text
multiple threads in one process
shared memory
same heap
same lock objects
same clock mostly
```

Distributed concurrency:

```text
multiple processes/nodes
no shared memory
communication via network
partial failure
message delay
duplicate messages
clock skew
node crash
network partition
```

## 2.1 Local lock

```java
synchronized (lock) {
    update();
}
```

Works only inside JVM.

## 2.2 Distributed coordination

Needs external system:

- database;
- message broker;
- Redis;
- ZooKeeper;
- etcd;
- Consul;
- cloud coordination service.

## 2.3 Main rule

```text
A local lock protects memory in one process.
Distributed concurrency protects state across failure-prone nodes.
```

---

# 3. Kenapa Distributed Concurrency Lebih Sulit

In local concurrency:

```text
if thread dies, process usually knows
lock releases when thread exits/scope exits
memory visibility has JMM rules
```

In distributed systems:

```text
if node silent, is it dead, slow, partitioned, or GC-paused?
if message absent, lost or delayed?
if response absent, did operation fail or succeed?
if lock lease expired, is old owner still executing?
```

## 3.1 Partial failure

One component can fail while others continue.

## 3.2 Ambiguous outcome

Client timeout does not tell whether server committed.

## 3.3 Main rule

```text
Distributed systems fail partially and ambiguously.
Design must assume uncertainty.
```

---

# 4. Mental Model: No Shared Memory, Only Messages

In distributed systems, service A cannot read service B memory directly.

It sees:

- request/response;
- events;
- database state;
- cache values;
- timeouts;
- errors.

## 4.1 Message may be

- delayed;
- duplicated;
- reordered;
- lost;
- processed but response lost.

## 4.2 State is replicated/observed indirectly

Data freshness is not guaranteed unless system enforces it.

## 4.3 Main rule

```text
Distributed concurrency is message/state coordination under unreliable communication.
```

---

# 5. Failure Model

Important failures:

## 5.1 Crash

Node stops.

## 5.2 Pause

Node does not run for a while.

Examples:

- GC pause;
- CPU starvation;
- container freeze;
- long stop-the-world;
- network stall.

## 5.3 Network partition

Nodes cannot communicate.

## 5.4 Slow node

Node responds late.

## 5.5 Duplicate execution

Retry triggers same command twice.

## 5.6 Reordering

Events arrive not in original logical order.

## 5.7 Main rule

```text
Design distributed coordination for crash, pause, partition, duplicate, and reorder.
```

---

# 6. Network Is Not Reliable

Classic false assumptions:

```text
network is reliable
latency is zero
bandwidth is infinite
network is secure
topology does not change
there is one administrator
transport cost is zero
network is homogeneous
```

For concurrency, important ones:

- request may timeout;
- response may be lost;
- server may still commit after client timeout;
- retry can duplicate command.

## 6.1 Main rule

```text
Timeout means unknown outcome, not guaranteed failure.
```

---

# 7. Time, Clocks, and Ordering

Distributed systems cannot trust wall clocks for strict ordering unless using special protocols.

Problems:

- clock skew;
- NTP adjustment;
- leap seconds;
- VM/container pause;
- different regions.

## 7.1 Wall-clock timestamp

Useful for approximate time, expiry, observability.

Dangerous as sole correctness ordering.

## 7.2 Logical time

Use:

- version;
- sequence number;
- offset;
- monotonic counter;
- fencing token.

## 7.3 Main rule

```text
For correctness ordering, prefer logical monotonic values over wall-clock timestamps.
```

---

# 8. Happens-Before in Distributed Systems

Within one JVM, Java Memory Model defines happens-before.

Across services, happens-before is usually established by:

- committed database transaction;
- message offset;
- event sequence;
- version update;
- request/response causal chain;
- consensus log.

## 8.1 Example

```text
Tx commits order version=10
event with version=10 published
consumer updates projection if incoming version > current
```

## 8.2 Main rule

```text
Distributed happens-before must be encoded in durable state, messages, or protocol.
```

---

# 9. Idempotency

Idempotent operation can be repeated without changing outcome beyond first application.

Example:

```http
PUT /users/123/status ACTIVE
```

Usually idempotent.

Non-idempotent:

```http
POST /payments charge $100
```

unless idempotency key used.

## 9.1 Why crucial

Retries are unavoidable.

If retry duplicates side effect, system corrupts business state.

## 9.2 Main rule

```text
In distributed systems, every command that can be retried needs idempotency design.
```

---

# 10. Idempotency Keys

Idempotency key uniquely identifies logical command.

Example:

```text
paymentRequestId = 8b0e...
```

On first request:

```text
process and store result by key
```

On retry:

```text
return same result or current known status
```

## 10.1 Key scope

Key must be scoped:

```text
tenant + operation + idempotencyKey
```

## 10.2 Storage

Database table:

```sql
CREATE TABLE idempotency_record (
    tenant_id text NOT NULL,
    key text NOT NULL,
    status text NOT NULL,
    response jsonb,
    created_at timestamp NOT NULL,
    PRIMARY KEY (tenant_id, key)
);
```

## 10.3 Main rule

```text
Idempotency key turns duplicate delivery into repeated observation of one logical command.
```

---

# 11. Deduplication Store

Dedup store records processed messages/commands.

For events:

```sql
CREATE TABLE processed_message (
    consumer_name text NOT NULL,
    message_id text NOT NULL,
    processed_at timestamp NOT NULL,
    PRIMARY KEY (consumer_name, message_id)
);
```

## 11.1 Transactional dedup

Process message and insert dedup record in same DB transaction.

## 11.2 Retention

Dedup table needs retention/cleanup strategy.

## 11.3 Main rule

```text
Deduplication must be atomic with the side effect it protects.
```

---

# 12. Retries and Duplicate Side Effects

Retry timeline:

```text
client sends command
server commits
response lost
client retries
server receives duplicate
```

Without idempotency:

```text
side effect applied twice
```

With idempotency:

```text
server returns previous result/status
```

## 12.1 Main rule

```text
Retry is safe only if duplicate execution is safe.
```

---

# 13. At-Most-Once, At-Least-Once, Exactly-Once

## 13.1 At-most-once

May lose message, no duplicate.

## 13.2 At-least-once

No loss if eventually delivered, but duplicates possible.

## 13.3 Exactly-once

Often means exactly-once within a particular subsystem/protocol, not universal business exactly-once.

## 13.4 Main rule

```text
At-least-once delivery plus idempotent consumer is the common practical baseline.
```

---

# 14. Exactly-Once Illusions

Many systems claim exactly-once semantics, but boundaries matter.

Example:

```text
Kafka exactly-once between Kafka topics
```

does not automatically make:

```text
Kafka + external DB + HTTP API
```

exactly once end-to-end.

## 14.1 Real question

What side effect is exactly once?

- topic write?
- DB write?
- email send?
- payment charge?
- projection update?

## 14.2 Main rule

```text
Exactly-once must be defined at business side-effect boundary, not marketing boundary.
```

---

# 15. Ordering

Distributed ordering levels:

## 15.1 No ordering

Events can arrive any order.

## 15.2 Per-key ordering

Ordering for same aggregate/key.

## 15.3 Partition ordering

Ordering within partition.

## 15.4 Global ordering

Hard and expensive.

## 15.5 Main rule

```text
Prefer per-key ordering. Global ordering is costly and often unnecessary.
```

---

# 16. Per-Key Ordering

For aggregate:

```text
caseId = 123
events version 1, 2, 3
```

Consumer applies:

```text
only if event.version == currentVersion + 1
```

or:

```text
only if event.version > currentVersion
```

depending projection semantics.

## 16.1 Kafka partition key

Use aggregate ID as partition key for ordered consumption per aggregate.

## 16.2 Main rule

```text
Partition by aggregate key when order matters per aggregate.
```

---

# 17. Versioning and Monotonic Updates

Version is a monotonic number.

Example:

```sql
UPDATE projection
SET status = ?, version = ?
WHERE id = ? AND version < ?;
```

If old event arrives after newer:

```text
ignored
```

## 17.1 Prevent stale overwrite

Without version, old messages can overwrite new state.

## 17.2 Main rule

```text
Every eventually consistent projection should know how to reject stale updates.
```

---

# 18. Optimistic Distributed Concurrency

Optimistic pattern:

```text
read version
attempt update if version unchanged
if conflict, retry/reload/fail
```

Database:

```sql
UPDATE entity
SET value = ?, version = version + 1
WHERE id = ? AND version = ?;
```

HTTP:

```http
If-Match: "version"
```

## 18.1 Good

- no distributed lock;
- scalable under low conflict;
- explicit conflict handling.

## 18.2 Main rule

```text
Prefer optimistic concurrency when conflicts are rare and retries are acceptable.
```

---

# 19. Compare-And-Set and Conditional Writes

CAS in distributed storage:

```text
write only if current version == expected
```

Examples:

- SQL `WHERE version = ?`;
- Redis Lua script;
- etcd compare-and-swap;
- DynamoDB conditional write;
- object storage conditional ETag.

## 19.1 Main rule

```text
Conditional writes are distributed compare-and-set for durable state.
```

---

# 20. Distributed Locks

Distributed lock attempts to ensure one process at a time owns a logical lock.

Use cases:

- single scheduler leader;
- one worker per resource;
- migration job;
- cluster singleton.

## 20.1 Simple lock idea

```text
SET lock_key owner NX PX 30000
```

But correctness is subtle.

## 20.2 Main rule

```text
Distributed lock is not just a remote synchronized block.
It is a failure-prone lease protocol.
```

---

# 21. Why Distributed Locks Are Dangerous

Problems:

## 21.1 Owner pause

Owner gets lock, pauses longer than TTL, resumes and still thinks it owns lock.

## 21.2 Expired lock

Another owner acquires lock.

Now two owners may write.

## 21.3 Clock/time

Expiry depends on time.

## 21.4 Network partition

Lock service and resource may disagree.

## 21.5 Lock service availability

Coordination dependency becomes critical path.

## 21.6 Main rule

```text
A distributed lock without fencing is often unsafe for protecting external resources.
```

---

# 22. Leases

Lease is time-bounded lock.

```text
owner has right until lease expiry
```

Owner must renew lease.

## 22.1 Lease helps

If owner crashes, lease expires.

## 22.2 Lease does not solve pause alone

Paused owner may resume after lease expired.

## 22.3 Main rule

```text
Lease gives automatic expiry, but stale owners can still act unless fenced.
```

---

# 23. Fencing Tokens

Fencing token is monotonically increasing token issued with lock/lease.

```text
owner A gets token 10
owner B later gets token 11
```

Protected resource accepts operation only if token newer.

Example:

```sql
UPDATE resource
SET value = ?, fencing_token = ?
WHERE id = ? AND fencing_token < ?;
```

If stale owner token 10 writes after token 11:

```text
rejected
```

## 23.1 Main rule

```text
Fencing token protects resources from stale lock owners.
```

---

# 24. Leader Election

Leader election chooses one node for special responsibility.

Examples:

- scheduler leader;
- partition coordinator;
- singleton maintenance job.

## 24.1 Leader must be fenced too

Leader can become stale.

Actions should include term/epoch/fencing token when modifying shared state.

## 24.2 Main rule

```text
Leader election chooses a leader; fencing makes stale leaders harmless.
```

---

# 25. Consensus Overview

Consensus protocols like Raft/Paxos help a cluster agree on ordered log/state despite failures.

Used by systems like:

- etcd;
- ZooKeeper-like coordination systems;
- Consul;
- some databases.

## 25.1 Why use coordination services?

Because implementing correct consensus yourself is hard.

## 25.2 Main rule

```text
Use proven coordination systems for consensus; do not invent your own in application code.
```

---

# 26. Coordination Services

Common coordination service capabilities:

- ephemeral nodes;
- leases;
- watches;
- compare-and-swap;
- leader election;
- monotonic revision;
- distributed configuration.

## 26.1 Use with care

They are critical dependencies.

Do not put high-frequency business operations through coordination service unnecessarily.

## 26.2 Main rule

```text
Coordination services are for coordination metadata, not high-volume business data paths.
```

---

# 27. Message Queues and Consumer Groups

Message brokers coordinate work distribution.

Consumer group:

```text
multiple consumers share partitions/work
```

Benefits:

- scalability;
- failover;
- per-partition ordering;
- backpressure through lag;
- replay.

## 27.1 Delivery

Often at-least-once.

Consumer must be idempotent.

## 27.2 Main rule

```text
Message broker coordination shifts concurrency from locks to partition ownership and offsets.
```

---

# 28. Kafka-Style Partition Ownership

Kafka topic partition:

```text
partition has ordered log
consumer group assigns partition to consumer
```

Ordering guaranteed within partition.

If key maps to same partition:

```text
same aggregate events ordered
```

## 28.1 Rebalance

Partition ownership can move.

Consumer should handle duplicate/replay.

## 28.2 Main rule

```text
Kafka-style ordering is per partition, not global.
Design keys accordingly.
```

---

# 29. Outbox Pattern

Outbox solves:

```text
update DB and publish event atomically
```

In same transaction:

```text
update aggregate
insert outbox event
commit
```

Separate publisher:

```text
reads outbox
publishes to broker
marks sent
```

## 29.1 Benefits

- no distributed transaction between DB and broker;
- event eventually published if transaction committed;
- retries possible.

## 29.2 Needs

- idempotent publisher;
- event ID;
- ordering policy;
- cleanup;
- monitoring.

## 29.3 Main rule

```text
Outbox turns database commit into durable intent to publish.
```

---

# 30. Inbox Pattern

Inbox tracks consumed messages.

```text
message received
check inbox/dedup
apply side effect
record processed
commit
```

## 30.1 Use with at-least-once delivery

Prevents duplicate side effects.

## 30.2 Main rule

```text
Inbox is the consumer-side counterpart of idempotent processing.
```

---

# 31. Saga Pattern

Saga coordinates multi-step business transaction without distributed transaction.

Example:

```text
create order
reserve inventory
charge payment
arrange shipping
```

If step fails, execute compensating actions.

## 31.1 Choreography

Services react to events.

## 31.2 Orchestration

Central orchestrator commands steps.

## 31.3 Main rule

```text
Saga manages long-running distributed workflows through steps and compensation.
```

---

# 32. Distributed Transactions and 2PC

Two-phase commit coordinates atomic commit across resources.

## 32.1 Pros

Strong atomicity across resources.

## 32.2 Cons

- blocking protocol;
- coordinator dependency;
- operational complexity;
- performance cost;
- not always supported;
- cloud/microservice mismatch.

## 32.3 Main rule

```text
2PC provides strong atomicity but often conflicts with scalable microservice architecture.
```

---

# 33. Locks vs Idempotency vs Ordering

Before using distributed lock, ask:

## 33.1 Can operation be idempotent?

Then retry/dedup may be better.

## 33.2 Can order be per key?

Partition by key.

## 33.3 Can conflict be optimistic?

Version/conditional write.

## 33.4 Can single owner be natural?

Queue partition/actor.

## 33.5 Main rule

```text
Distributed lock is often not the first solution.
Prefer idempotency, ordering, ownership, and versioning.
```

---

# 34. Cache, Redis, and Coordination Pitfalls

Redis often used for locks/counters.

Be careful:

- TTL expiry;
- failover semantics;
- replication lag;
- stale owner;
- no fencing unless designed;
- clock assumptions;
- single instance vs cluster;
- script atomicity only within Redis, not external DB.

## 34.1 Good uses

- rate limiting;
- best-effort coordination;
- short-lived dedup;
- cache.

## 34.2 Risky uses

- protecting critical external resource without fencing;
- exactly-once business side effects;
- long-running lock ownership.

## 34.3 Main rule

```text
Atomic in Redis does not mean atomic with your database or external API.
```

---

# 35. Database as Coordination Boundary

Database can coordinate with:

- unique constraints;
- row locks;
- version columns;
- conditional updates;
- advisory locks depending DB;
- job table with `SELECT FOR UPDATE SKIP LOCKED`.

## 35.1 Benefits

If protected state is already in DB, DB coordination can be simpler.

## 35.2 Risks

- DB contention;
- long transactions;
- lock waits;
- pool starvation.

## 35.3 Main rule

```text
Coordinate where the authoritative state lives, when possible.
```

---

# 36. Rate Limits and Quotas

Distributed concurrency often needs shared quota.

Example:

```text
tenant A max 100 requests/sec across all pods
```

Requires shared state or approximate distributed limiter.

## 36.1 Options

- centralized Redis/token bucket;
- API gateway;
- per-pod local limit with global approximation;
- broker partitioning;
- database quota table for strict cases.

## 36.2 Main rule

```text
Global quotas require shared coordination or acceptable approximation.
```

---

# 37. Multi-Instance Spring Boot Considerations

When app runs multiple pods:

## 37.1 `@Scheduled`

Runs on every pod unless guarded.

Options:

- leader election;
- distributed lock with fencing;
- external scheduler;
- message queue;
- Kubernetes CronJob.

## 37.2 In-memory cache

Each pod has own cache; invalidation needed.

## 37.3 In-memory lock

Only local.

## 37.4 In-memory queue

Lost on pod restart and not shared.

## 37.5 Main rule

```text
Anything in memory is per instance unless explicitly distributed.
```

---

# 38. Observability

Measure:

## 38.1 Idempotency

- duplicate command count;
- dedup hit count;
- idempotency conflict;
- stale version rejection.

## 38.2 Messaging

- lag;
- redelivery count;
- DLQ count;
- processing duration;
- offset commit failures.

## 38.3 Coordination

- lock acquisition failures;
- lease renewal failures;
- fencing rejection;
- leader changes;
- split-brain indicators.

## 38.4 Saga

- step duration;
- compensation count;
- stuck saga;
- retry attempts.

## 38.5 Main rule

```text
Distributed concurrency bugs are diagnosed through IDs, versions, tokens, and timelines.
```

---

# 39. Testing Distributed Concurrency

Test:

## 39.1 Duplicate delivery

Same message twice.

## 39.2 Reordering

Version 2 arrives before version 1.

## 39.3 Timeout unknown outcome

Server commits but client retries.

## 39.4 Stale lock owner

Old owner writes after lease expiry.

## 39.5 Leader failover

Two leaders briefly possible; fencing protects.

## 39.6 Rebalance

Consumer processes duplicate after rebalance.

## 39.7 Main rule

```text
Distributed tests should simulate duplicate, delay, reorder, crash, pause, and retry.
```

---

# 40. Mini Case Study: Duplicate Payment Command

## 40.1 Problem

Client calls payment API, times out, retries.

Without idempotency:

```text
charged twice
```

## 40.2 Fix

Use idempotency key:

```text
tenant + paymentRequestId
```

Process:

1. insert idempotency record pending;
2. perform charge or create payment command;
3. store final result/status;
4. retry returns same status/result.

## 40.3 Lesson

```text
Payment-like commands must be idempotent by design.
```

---

# 41. Mini Case Study: Scheduled Job Runs on Every Pod

## 41.1 Problem

Spring `@Scheduled` job deployed to 5 pods.

All pods run same cleanup job.

## 41.2 Options

- external scheduler;
- leader election;
- DB job table with claim;
- distributed lease with fencing;
- Kubernetes CronJob.

## 41.3 Safer DB claim example

```sql
UPDATE job
SET owner = ?, lease_until = ?, fencing_token = fencing_token + 1
WHERE name = ?
  AND lease_until < now()
RETURNING fencing_token;
```

Then writes include fencing token.

## 41.4 Lesson

```text
In multi-instance deployment, scheduled job is not singleton unless coordinated.
```

---

# 42. Mini Case Study: Stale Lock Owner Writes Data

## 42.1 Timeline

```text
A gets lock token 10, pauses
lock expires
B gets lock token 11, writes
A resumes and writes stale data
```

## 42.2 Fix

Protected resource stores highest fencing token.

A's write token 10 rejected after token 11.

## 42.3 Lesson

```text
Lease alone is not enough. Fencing prevents stale owners from writing.
```

---

# 43. Common Anti-Patterns

## 43.1 Using `synchronized` for multi-pod coordination

Only local.

## 43.2 Distributed lock without fencing

Unsafe stale owner.

## 43.3 Assuming timeout means operation failed

Outcome unknown.

## 43.4 Retrying non-idempotent command

Duplicate side effects.

## 43.5 Believing exactly-once end-to-end automatically

Boundary confusion.

## 43.6 Global ordering requirement without need

Unnecessary bottleneck.

## 43.7 In-memory queue for durable work

Lost on restart.

## 43.8 Scheduled job runs on every pod

Duplicate work.

## 43.9 Cache as source of truth

Stale/lost data.

## 43.10 No version in events

Stale updates overwrite newer state.

---

# 44. Best Practices

## 44.1 Prefer idempotency

For commands and consumers.

## 44.2 Use per-key ordering

Avoid global order unless required.

## 44.3 Use version/fencing tokens

Reject stale writes.

## 44.4 Use outbox/inbox

For reliable event publication/consumption.

## 44.5 Keep distributed locks rare

And fenced.

## 44.6 Use proven coordination services

Do not implement consensus yourself.

## 44.7 Treat timeout as unknown

Design reconciliation/status check.

## 44.8 Make retries bounded

Backoff, jitter, deadline.

## 44.9 Persist durable work

Do not rely on in-memory fire-and-forget.

## 44.10 Test duplicate/reorder/failover

Chaos at protocol level.

---

# 45. Decision Matrix

| Problem | Prefer |
|---|---|
| Duplicate command due to retry | idempotency key |
| Duplicate message delivery | inbox/dedup table |
| DB + event publish atomicity | outbox |
| Stale event overwrites projection | version check |
| One worker per aggregate | partition by aggregate key |
| Singleton scheduled job | external scheduler / leader election / DB claim |
| Critical lock across pods | lease + fencing token or DB conditional update |
| Low-conflict concurrent updates | optimistic version |
| High-conflict single resource | DB row lock / single owner queue |
| Long-running workflow | saga |
| Cross-resource atomic commit | consider 2PC only with full operational awareness |
| Global rate limit | centralized limiter or gateway |
| Cache invalidation | versioned events/TTL/explicit invalidation |
| Unknown outcome after timeout | status query + idempotency |

---

# 46. Latihan

## Latihan 1 — Local vs Distributed Lock

Jelaskan kenapa `synchronized` tidak mencegah dua pod menjalankan job yang sama.

## Latihan 2 — Idempotency Table

Desain tabel idempotency untuk payment command.

## Latihan 3 — Duplicate Message

Buat pseudo-code consumer dengan inbox/dedup table.

## Latihan 4 — Stale Event

Desain projection update yang hanya menerima event dengan version lebih baru.

## Latihan 5 — Fencing Token

Buat contoh SQL update yang menolak token lama.

## Latihan 6 — Scheduled Job

Rancang single scheduled job di multi-pod deployment tanpa duplicate execution.

## Latihan 7 — Outbox

Rancang transaksi update aggregate + insert outbox event.

## Latihan 8 — Saga

Desain saga order-payment-inventory dengan compensation.

## Latihan 9 — Timeout Unknown Outcome

Buat flow client retry yang aman setelah timeout.

## Latihan 10 — Observability

Buat dashboard metrics untuk distributed coordination: duplicate, stale rejection, fencing rejection, leader change, DLQ.

---

# 47. Ringkasan

Distributed concurrency berbeda secara fundamental dari local concurrency.

Core lessons:

- Local locks hanya berlaku dalam satu JVM.
- Distributed systems tidak punya shared memory; hanya messages dan durable state.
- Failure bersifat partial dan ambiguous.
- Timeout berarti unknown outcome, bukan pasti gagal.
- Wall clock tidak boleh menjadi satu-satunya dasar correctness ordering.
- Idempotency adalah fondasi retry-safe commands.
- Dedup store harus atomic dengan side effect.
- At-least-once + idempotent consumer adalah baseline praktis.
- Exactly-once harus didefinisikan pada business side-effect boundary.
- Ordering sebaiknya per key/aggregate, bukan global.
- Versioning mencegah stale overwrite.
- Conditional writes adalah CAS untuk durable state.
- Distributed lock tanpa fencing berbahaya.
- Lease membantu crash recovery tetapi stale owner tetap perlu fencing.
- Leader election memilih leader; fencing membuat stale leader tidak berbahaya.
- Gunakan coordination service yang terbukti untuk consensus.
- Message broker mengatur concurrency lewat partition ownership dan offsets.
- Outbox dan inbox sangat penting untuk reliable event-driven systems.
- Saga mengelola workflow distributed dengan compensation.
- Distributed transactions/2PC kuat tetapi mahal/kompleks.
- Prefer idempotency, ordering, versioning, ownership sebelum distributed lock.
- Multi-instance Spring Boot membuat `@Scheduled`, in-memory lock, queue, dan cache menjadi per-pod kecuali dikoordinasikan.
- Observability harus berbasis IDs, versions, offsets, tokens, and timelines.

Main rule:

```text
In distributed concurrency, correctness comes from durable protocols:
idempotency, ordering, versions, leases with fencing,
atomic outbox/inbox, bounded retries, and observable coordination.
```

---

# 48. Referensi

1. OpenJDK JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

2. PostgreSQL Documentation — Explicit Locking  
   https://www.postgresql.org/docs/current/explicit-locking.html

3. PostgreSQL Documentation — Transaction Isolation  
   https://www.postgresql.org/docs/current/transaction-iso.html

4. Apache Kafka Documentation — Design  
   https://kafka.apache.org/documentation/#design

5. Apache Kafka Documentation — Semantics  
   https://kafka.apache.org/documentation/#semantics

6. etcd Documentation — Concurrency API  
   https://etcd.io/docs/

7. ZooKeeper Programmer's Guide  
   https://zookeeper.apache.org/doc/current/zookeeperProgrammers.html

8. Martin Kleppmann — Designing Data-Intensive Applications  
   O'Reilly Media

9. Spring Framework Reference — Transaction Management  
   https://docs.spring.io/spring-framework/reference/data-access/transaction.html

10. Spring Boot Reference — Task Execution and Scheduling  
    https://docs.spring.io/spring-boot/reference/features/task-execution-and-scheduling.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-concurrency-and-reactive-part-025.md](./learn-java-concurrency-and-reactive-part-025.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-concurrency-and-reactive-part-027.md](./learn-java-concurrency-and-reactive-part-027.md)
