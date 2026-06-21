# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-014.md

# Part 014 — Lightweight Transactions, CAS, Paxos/Raft Semantics, dan Conditional Correctness

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `014`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: memahami Lightweight Transactions (LWT), Compare-And-Set (CAS), `IF NOT EXISTS`, `IF column = value`, SERIAL/LOCAL_SERIAL, contention, uniqueness, expected-version state transition, timeout ambiguity, dan kapan LWT harus atau tidak harus dipakai.

---

## 0. Posisi Part Ini dalam Seri

Part 013 membahas consistency levels:

```text
ONE
QUORUM
LOCAL_QUORUM
ALL
SERIAL/LOCAL_SERIAL
timeout vs unavailable
read-your-write
multi-DC trade-off
```

Part ini membahas hal yang berbeda tetapi sering disalahartikan sebagai “consistency level yang lebih kuat”:

```text
Lightweight Transactions
```

atau:

```text
LWT / CAS / conditional update
```

Consistency level biasa menjawab:

```text
berapa replica harus merespons?
```

LWT menjawab:

```text
apakah mutation hanya boleh dilakukan jika kondisi saat ini benar?
```

Contoh:

```sql
INSERT INTO users_by_email (...)
VALUES (...)
IF NOT EXISTS;
```

atau:

```sql
UPDATE case_current_by_id
SET status = ?, version = ?
WHERE tenant_id = ? AND case_id = ?
IF status = ? AND version = ?;
```

Ini bukan sekadar read/write quorum. Ini conditional correctness.

---

## 1. Kenapa LWT Dibutuhkan?

Wide-column store biasa sangat baik untuk:

- append events,
- upsert by primary key,
- read by partition,
- denormalized views,
- high write throughput.

Tetapi banyak business invariant membutuhkan kondisi:

```text
only create if absent
only update if current version is X
only transition if status is UNDER_REVIEW
only reserve username if not taken
only process command once
only acquire lock if not held
```

Tanpa LWT atau protokol lain, dua client bisa melakukan race.

Example:

```text
Client A reads status = UNDER_REVIEW
Client B reads status = UNDER_REVIEW
A writes APPROVED
B writes REJECTED
```

Dengan write CL LOCAL_QUORUM pun, kedua write bisa terjadi. Last-write-wins bisa memilih salah satu berdasarkan timestamp, bukan berdasarkan business rule.

Untuk mencegah itu, perlu:

```text
conditional update
```

atau arsitektur lain seperti:

- single writer per aggregate,
- command serialization,
- relational transaction,
- stream processor ordering,
- external lock,
- append-only event with conflict workflow.

LWT adalah salah satu tool.

---

## 2. Apa Itu CAS?

CAS = Compare-And-Set.

Pattern:

```text
compare current value with expected value
if equal, set new value
else, reject
```

Example current state:

```text
status = UNDER_REVIEW
version = 7
```

Command:

```text
approve case if version = 7 and status = UNDER_REVIEW
```

CQL:

```sql
UPDATE case_current_by_id
SET status = 'APPROVED',
    version = 8,
    updated_at = ?
WHERE tenant_id = ?
  AND case_id = ?
IF status = 'UNDER_REVIEW'
   AND version = 7;
```

Result:

```text
[applied] = true
```

or:

```text
[applied] = false
current status/version returned
```

This is CAS.

---

## 3. CQL Conditional Statements

Common forms:

### 3.1 INSERT IF NOT EXISTS

```sql
INSERT INTO command_idempotency_by_id (
    tenant_id,
    command_id,
    entity_id,
    command_type,
    created_at
) VALUES (?, ?, ?, ?, ?)
IF NOT EXISTS;
```

Meaning:

```text
insert only if row does not exist
```

ScyllaDB docs state that `INSERT ... IF NOT EXISTS` inserts only if the row does not exist before insertion, and that this incurs a non-negligible performance cost because Paxos is used.

### 3.2 UPDATE IF Condition

```sql
UPDATE case_current_by_id
SET status = ?,
    version = ?
WHERE tenant_id = ?
  AND case_id = ?
IF status = ?
   AND version = ?;
```

Meaning:

```text
update only if existing row columns match predicate
```

### 3.3 DELETE IF Condition

```sql
DELETE FROM lock_by_resource
WHERE resource_id = ?
IF owner_id = ?;
```

Meaning:

```text
release lock only if owner matches
```

### 3.4 IF EXISTS

```sql
UPDATE table
SET field = ?
WHERE pk = ?
IF EXISTS;
```

Meaning:

```text
apply only if row exists
```

---

## 4. What Row Does IF Apply To?

This matters.

ScyllaDB documentation explains that conditional statements evaluating or assigning non-static columns must specify both partition key and clustering key; such statements apply to regular rows. Statements restricting only the partition key must use only static columns and apply to the static row of the partition.

Practical implication:

Given:

```sql
CREATE TABLE case_events (
    case_id uuid,
    event_version bigint,
    event_id uuid,
    event_type text,
    PRIMARY KEY (case_id, event_version, event_id)
);
```

A condition on `event_type` must identify full row:

```sql
WHERE case_id = ?
  AND event_version = ?
  AND event_id = ?
IF event_type = ?
```

You cannot casually apply conditional logic to a broad range of clustering rows.

LWT is row/partition-key scoped according to CQL restrictions, not arbitrary SQL predicate transaction.

---

## 5. LWT Result Shape

Conditional statements return whether mutation applied.

Example result:

```text
[applied]
---------
true
```

If not applied:

```text
[applied] | status        | version
----------+---------------+--------
false     | UNDER_REVIEW  | 8
```

Application must handle both.

Java code must not assume no exception means applied.

Pseudo:

```java
AsyncResultSet rs = session.executeAsync(stmt).toCompletableFuture().join();
Row row = rs.one();
boolean applied = row.getBoolean("[applied]");

if (!applied) {
    // command rejected due to condition mismatch
}
```

Exact API depends on driver, but concept stands.

---

## 6. LWT Is Not “Light” in Performance

The term lightweight means lighter than full distributed transaction, not cheap.

LWT requires coordination protocol, historically Paxos-style in Cassandra-compatible systems.

Cost:

- more round trips,
- more replica coordination,
- higher latency,
- lower throughput,
- contention sensitivity,
- more timeout ambiguity,
- more operational metrics to monitor.

Use LWT for correctness-critical conditional operations.

Do not use LWT for every upsert.

---

## 7. Normal Write vs LWT Write

Normal write:

```text
coordinator sends mutation to replicas
waits for CL acks
```

LWT write:

```text
coordinate conditional proposal
check current state
agree on whether condition holds
apply mutation if condition true
return applied/result
```

Simplified mental model:

```text
normal write = "write this"
LWT write = "write this only if everyone agrees condition is currently true"
```

This is why latency and throughput differ.

---

## 8. SERIAL and LOCAL_SERIAL Revisited

LWT uses two consistency concepts:

```text
normal consistency level
serial consistency level
```

Example operation profile:

```text
consistency = LOCAL_QUORUM
serial consistency = LOCAL_SERIAL
```

Normal CL controls final read/write phase.

Serial CL controls conditional coordination phase.

### 8.1 SERIAL

Serial phase may coordinate across broader replica scope.

### 8.2 LOCAL_SERIAL

Serial phase local to DC.

For multi-DC local writes, LOCAL_SERIAL is often preferred if your semantics are local and you avoid active-active conflicts.

But if same key can be conditionally updated in multiple DCs, local serial semantics may not be enough.

---

## 9. Common LWT Use Cases

### 9.1 Uniqueness Reservation

```text
email -> user_id
username -> user_id
external_ref -> case_id
```

```sql
INSERT INTO user_by_email (
    tenant_id, email, user_id, created_at
) VALUES (?, ?, ?, ?)
IF NOT EXISTS;
```

### 9.2 Idempotency Key

```text
command_id should be processed once
```

```sql
INSERT INTO command_idempotency_by_id (...)
VALUES (...)
IF NOT EXISTS;
```

### 9.3 Expected-Version State Transition

```text
case version must match expected
```

```sql
UPDATE case_current_by_id
SET status = ?, version = ?
WHERE tenant_id = ? AND case_id = ?
IF version = ? AND status = ?;
```

### 9.4 Lock/Lease

```text
acquire lock if absent/expired
```

Use carefully; distributed locks are hard.

### 9.5 Work Claim

```text
worker claims item if status = READY
```

Use carefully; queue systems may fit better.

---

## 10. When Not to Use LWT

Avoid LWT for:

- high-volume telemetry writes,
- append-only events with stable primary key,
- derived view upserts,
- notification feed writes,
- every CRUD save,
- broad multi-row transaction,
- counters,
- analytical workflows,
- high-contention global locks,
- queue head contention,
- arbitrary uniqueness across huge mutable dimension without planning.

If you need LWT at extreme QPS on one key, the design may be wrong.

---

## 11. LWT and Contention

LWT performance degrades under contention.

Example:

```text
1000 clients try to update same case_current row with IF version = 7
```

Only one should apply. Others fail or retry.

If all retry immediately:

```text
contention storm
```

Symptoms:

- high LWT latency,
- many not-applied results,
- timeouts,
- CPU/network pressure,
- poor p99.

Mitigation:

- single writer per aggregate,
- command queue per entity,
- backoff/jitter,
- reject stale expected version,
- client refresh before retry,
- rate limit hot entity,
- avoid LWT for high-frequency counters/locks.

---

## 12. Expected Version Pattern

This is the most important LWT pattern for domain state.

Table:

```sql
CREATE TABLE case_current_by_id (
    tenant_id uuid,
    case_id uuid,
    status text,
    version bigint,
    assignee_id uuid,
    updated_at timestamp,
    last_event_id uuid,
    PRIMARY KEY ((tenant_id, case_id))
);
```

Transition:

```sql
UPDATE case_current_by_id
SET status = ?,
    version = ?,
    updated_at = ?,
    last_event_id = ?
WHERE tenant_id = ?
  AND case_id = ?
IF status = ?
   AND version = ?;
```

If applied:

```text
transition accepted
```

If not applied:

```text
someone else changed state
command must be rejected/re-read/recomputed
```

This prevents lost update.

---

## 13. Expected Version Is Better Than Timestamp Guessing

Bad:

```text
write with newer timestamp
hope latest wins
```

This is not domain correctness.

Good:

```text
update if current version is exactly expected version
```

Version expresses domain sequence.

Timestamp expresses time.

Do not confuse them.

---

## 14. State Machine with LWT

Allowed transitions:

```text
DRAFT -> SUBMITTED
SUBMITTED -> UNDER_REVIEW
UNDER_REVIEW -> APPROVED
UNDER_REVIEW -> REJECTED
APPROVED -> CLOSED
REJECTED -> CLOSED
```

Command handler:

```text
1. read current state
2. validate transition
3. attempt LWT with expected status/version
4. if applied, append event/project views
5. if not applied, re-read/reject/retry command logic
```

Potential issue:

```text
read then LWT has gap
```

But LWT condition closes the gap.

Even if state changed after read, LWT fails.

---

## 15. LWT First or Event First?

For audit/state transition, there are two common designs.

### 15.1 Current-State First

```text
1. LWT update current state
2. append event
3. project views
```

Risk:

```text
current updated but event append fails/unknown
```

Bad for audit-critical systems unless command workflow repairs it.

### 15.2 Event First

```text
1. reserve event/version
2. append event
3. project current state
```

Risk:

```text
event appended but current state update fails/unknown
```

Maybe acceptable if event log is source and current is projection.

### 15.3 Command State Machine

For high correctness:

```text
command state tracks progress and reconciliation ensures event/current convergence
```

No free lunch. LWT solves conditional row update, not multi-table atomicity.

---

## 16. Idempotency Key with LWT

Table:

```sql
CREATE TABLE command_idempotency_by_id (
    tenant_id uuid,
    command_id uuid,
    entity_id uuid,
    command_type text,
    status text,
    result_ref text,
    created_at timestamp,
    updated_at timestamp,
    PRIMARY KEY ((tenant_id, command_id))
) WITH default_time_to_live = 604800;
```

Reserve:

```sql
INSERT INTO command_idempotency_by_id (
    tenant_id,
    command_id,
    entity_id,
    command_type,
    status,
    created_at,
    updated_at
) VALUES (?, ?, ?, ?, 'RESERVED', ?, ?)
IF NOT EXISTS;
```

Outcomes:

```text
applied=true:
  caller owns command execution

applied=false:
  command already exists
  read existing status/result
```

This pattern prevents duplicate command execution if all callers use same command_id.

---

## 17. Idempotency Timeout Handling

If `INSERT IF NOT EXISTS` times out, outcome unknown.

Possibilities:

```text
reservation applied
reservation not applied
reservation applied but response lost
```

Correct handling:

```text
read command_idempotency_by_id by command_id
if row exists, continue based on status
if not exists, retry reserve with same command_id
```

Do not generate new command_id on retry.

Do not assume timeout means reservation failed.

---

## 18. Uniqueness Reservation

Example email uniqueness:

```sql
CREATE TABLE user_id_by_email (
    tenant_id uuid,
    email text,
    user_id uuid,
    created_at timestamp,
    PRIMARY KEY ((tenant_id, email))
);
```

Reserve:

```sql
INSERT INTO user_id_by_email (
    tenant_id,
    email,
    user_id,
    created_at
) VALUES (?, ?, ?, ?)
IF NOT EXISTS;
```

If applied, create user row.

But multi-table issue:

```text
email reservation succeeds
user row creation fails
```

Need workflow:

- create reservation with status,
- create user row,
- mark completed,
- cleanup expired pending reservation,
- reconcile orphan reservations.

For simple systems, maybe acceptable with operational cleanup.

---

## 19. Reservation Table with Status

Better uniqueness reservation:

```sql
CREATE TABLE email_reservation_by_email (
    tenant_id uuid,
    email text,
    user_id uuid,
    status text,
    created_at timestamp,
    expires_at timestamp,
    completed_at timestamp,
    PRIMARY KEY ((tenant_id, email))
);
```

Reserve:

```text
INSERT IF NOT EXISTS status=RESERVED
```

Complete:

```text
UPDATE ... SET status=COMPLETED IF status=RESERVED AND user_id=?
```

If creation fails, reservation can expire/release according to policy.

But delete/release must avoid stealing a completed email.

---

## 20. Lock/Lease Pattern

Distributed lock table:

```sql
CREATE TABLE locks_by_resource (
    resource_id text PRIMARY KEY,
    owner_id uuid,
    lease_until timestamp,
    fencing_token bigint
);
```

Acquire if absent/expired:

```sql
UPDATE locks_by_resource
SET owner_id = ?,
    lease_until = ?,
    fencing_token = ?
WHERE resource_id = ?
IF lease_until < ?;
```

But this is tricky.

Problems:

- clock skew,
- client pause,
- lease expiry while work continues,
- fencing token required,
- release race,
- high contention,
- timeout ambiguity.

If you need robust distributed locks, consider whether workflow/queue/single-owner partition is better.

LWT can implement lock-like protocols, but application correctness is hard.

---

## 21. Work Claim Pattern

Table:

```sql
CREATE TABLE work_items_by_bucket (
    bucket_id int,
    due_at timestamp,
    item_id uuid,
    status text,
    claimed_by uuid,
    PRIMARY KEY (bucket_id, due_at, item_id)
);
```

Claim:

```sql
UPDATE work_items_by_id
SET status = 'CLAIMED',
    claimed_by = ?
WHERE item_id = ?
IF status = 'READY';
```

Better to claim by ID table than queue list table.

Problems:

- queue scan,
- tombstones,
- contention,
- stuck claims,
- retries,
- visibility timeout.

For heavy queues, use RabbitMQ/Kafka/task queue system.

Use ScyllaDB for work state if queryable state is needed, but not as naive broker.

---

## 22. LWT and Multi-Row/Batch Conditions

Conditional batches exist, but they are not general SQL transactions.

ScyllaDB docs note differences from Cassandra: ScyllaDB allows mixing `IF EXISTS`, `IF NOT EXISTS`, and other IF conditions for the same row in a batch, and conditional batches evaluate all conditions against initial database state.

Practical guidance:

- keep conditional batch small,
- prefer same partition/row where possible,
- understand ScyllaDB vs Cassandra behavior if portability matters,
- do not use conditional batch for large multi-partition workflow,
- test exact semantics.

---

## 23. LWT and Static Columns

Conditional statements that only restrict partition key and use static columns apply to the static row.

Static row can be used for partition-level metadata.

Example:

```sql
CREATE TABLE case_events_with_meta (
    case_id uuid,
    event_version bigint,
    event_id uuid,
    current_version bigint static,
    event_type text,
    PRIMARY KEY (case_id, event_version, event_id)
);
```

You might condition on static metadata, but be careful:

- wide partition growth,
- event/current coupling,
- LWT contention on static row,
- query complexity.

Often separate current table is clearer.

---

## 24. LWT and Uniqueness Scope

Uniqueness is only as broad as your primary key.

If table:

```sql
PRIMARY KEY ((tenant_id, email))
```

then uniqueness scope:

```text
email unique per tenant
```

If table:

```sql
PRIMARY KEY (email)
```

then uniqueness global.

If email normalization differs:

```text
User@Example.com vs user@example.com
```

you can break uniqueness.

Normalize before reservation:

```text
lowercase, trim, canonical domain policy
```

Store normalized key and original display email separately.

---

## 25. LWT and Sharding Uniqueness

Do not hash-shard a uniqueness key unless you still route same logical key to same row.

Bad:

```text
bucket_id = random
PRIMARY KEY ((email_bucket), email)
```

If random, same email can reserve multiple buckets.

Good:

```text
bucket_id = hash(normalized_email) % N
PRIMARY KEY ((bucket_id, normalized_email))
```

But if full key includes email, and bucket deterministic, uniqueness still works.

However changing N is dangerous.

For uniqueness, simpler key is often better unless extreme scale requires sharding.

---

## 26. LWT and Hot Keys

Uniqueness for popular names can hot spot.

Example:

```text
username = admin
```

Many attempts to reserve same username.

LWT contention high.

Mitigations:

- rate limit attempts,
- prevalidation/cache unavailable names,
- backoff,
- reject common reserved names early,
- use random suffix suggestions,
- avoid retry storms.

Hot LWT key is expensive.

---

## 27. LWT and TTL

Can you use TTL with LWT? Yes in some patterns, but think carefully.

Example idempotency:

```text
command key TTL 7 days
```

After TTL, same command_id can be accepted again.

Is that okay?

For payment command maybe no.

For short-lived UI retry maybe yes.

Reservation with TTL:

```text
email reservation expires if not completed
```

Need ensure completed reservations do not expire if uniqueness permanent.

Maybe use separate pending reservation TTL table and permanent email mapping table.

---

## 28. LWT and Tombstones

Failed LWT does not apply mutation, but successful conditional deletes/updates still create normal storage effects.

If using LWT for high-churn locks/queues:

- tombstones,
- contention,
- compaction,
- read amplification.

Example lock acquire/release repeatedly on same row can churn.

Design for low/moderate contention and clear retention.

---

## 29. LWT and Materialized Views/Secondary Indexes

Conditional writes to base table can trigger view/index updates if applied.

But if not applied:

```text
no base mutation
```

Still, mixing LWT with materialized views/indexes adds complexity and write cost.

For critical invariants, keep involved rows/tables simple.

Avoid:

```text
LWT on wide row with many derived side effects
```

unless tested.

---

## 30. LWT and Multi-DC

LOCAL_SERIAL vs SERIAL matters.

If same key can be conditionally modified in multiple DCs, local serial may not provide global conditional order.

Common safe strategy:

```text
single writer/home DC per entity
LOCAL_SERIAL/LOCAL_QUORUM in home DC
replicate to others
```

If global uniqueness across DC is required, understand latency/availability cost of global serial coordination or use external/global authority.

Do not casually do active-active LWT for same key.

---

## 31. LWT and Clock/Timestamp

LWT protects condition evaluation, but write timestamps still matter for stored cell resolution.

Do not use application-supplied timestamps casually with LWT unless you understand interaction.

For expected-version transition, version should be authoritative domain sequence.

Timestamp should be metadata.

---

## 32. LWT Timeout Ambiguity

LWT timeout is especially tricky.

Possible outcomes:

```text
condition not checked
condition checked and failed
condition checked and mutation applied
mutation applied but response lost
proposal still in progress
```

Correct handling depends on operation.

### 32.1 Idempotency Reserve Timeout

Read by command_id.

### 32.2 Expected Version Update Timeout

Read current state by key.

If version advanced to desired version/event_id:

```text
treat as success
```

If version unchanged:

```text
maybe retry
```

If version advanced differently:

```text
conflict
```

### 32.3 Unique Email Reserve Timeout

Read reservation row by email.

If row user_id is yours:

```text
continue
```

If row belongs to someone else:

```text
conflict
```

If absent:

```text
retry
```

Never blindly retry with new identity.

---

## 33. Applied False Is Not an Error

If LWT returns `[applied]=false`, the database worked correctly.

This is business conflict.

Example:

```text
expected version mismatch
```

HTTP mapping:

```text
409 Conflict
```

or domain-specific error:

```text
CaseStateChanged
DuplicateCommand
EmailAlreadyReserved
LockNotAcquired
```

Do not log `[applied]=false` as database error unless rate unexpected.

Monitor it as contention/business conflict metric.

---

## 34. LWT Exceptions vs Not Applied

Distinguish:

```text
applied=false
```

from:

```text
timeout/unavailable/error
```

`applied=false`:

```text
condition evaluated, mutation not applied
```

Timeout:

```text
unknown
```

Unavailable:

```text
not enough replicas/coordination possible
```

Application logic must branch differently.

---

## 35. Java LWT Handling Pattern

Pseudo:

```java
CompletionStage<TransitionResult> transition(cmd) {
    BoundStatement stmt = transitionPs.bind(
        cmd.newStatus(),
        cmd.newVersion(),
        cmd.updatedAt(),
        cmd.tenantId(),
        cmd.caseId(),
        cmd.expectedStatus(),
        cmd.expectedVersion()
    ).setExecutionProfileName("lwt-guard");

    return session.executeAsync(stmt)
        .thenApply(rs -> {
            Row row = rs.one();
            boolean applied = row.getBoolean("[applied]");

            if (applied) {
                return TransitionResult.applied();
            }

            CaseStatus actualStatus = row.getString("status");
            long actualVersion = row.getLong("version");
            return TransitionResult.conflict(actualStatus, actualVersion);
        })
        .exceptionallyCompose(ex -> handleUnknownOutcome(cmd, ex));
}
```

Unknown outcome handler:

```text
read current row
compare version/event_id
decide success/conflict/retry
```

---

## 36. LWT Execution Profile

Conceptual driver profile:

```hocon
profiles {
  lwt-guard {
    basic.request.consistency = LOCAL_QUORUM
    basic.request.serial-consistency = LOCAL_SERIAL
    basic.request.timeout = 1500 milliseconds
  }
}
```

Use longer timeout than simple read if necessary, but do not set huge timeout blindly.

LWT latency is higher. Endpoint budget should account for it.

---

## 37. Statement Idempotence

For retry/speculative execution, driver may need to know whether statement is idempotent.

LWT statements can be logically idempotent if key/values stable, but outcome semantics are conditional.

Examples:

```text
INSERT idempotency IF NOT EXISTS with same command_id = retry-safe if outcome checked
UPDATE status IF version=7 = retry-safe only if desired new version/event_id stable and unknown outcome resolved by read
```

Do not mark statements idempotent casually if they generate new values per attempt.

---

## 38. Backoff on LWT Conflict

If LWT fails due to version mismatch:

Bad:

```text
immediately retry same expected version
```

It will fail again.

Correct:

```text
read latest state
recompute command or reject
```

If conflict is lock contention:

```text
backoff with jitter
```

Avoid thundering herd.

---

## 39. LWT Metrics

Track:

```text
lwt_latency_p50/p95/p99
lwt_applied_true_count
lwt_applied_false_count
lwt_timeout_count
lwt_unavailable_count
lwt_contention_by_key/sample
lwt_retries
lwt_unknown_outcome_resolutions
serial_consistency_used
```

If `[applied]=false` spikes, maybe product conflict or hot key.

If timeouts spike, maybe contention/cluster issue.

---

## 40. Pattern: Optimistic Concurrency Control

LWT expected-version is optimistic concurrency control.

Flow:

```text
read version
attempt update if version unchanged
if conflict, retry/reject
```

Good when:

- conflicts uncommon,
- correctness matters,
- entity update rate moderate,
- row small.

Bad when:

- conflicts constant,
- thousands updates/sec same key,
- global counter,
- queue head claim by many workers.

For high contention, serialize commands outside database.

---

## 41. Pattern: Single Writer per Aggregate

Alternative to LWT:

```text
route all commands for case_id to same actor/partition/queue
process sequentially
write normal updates
```

Pros:

- avoids LWT contention,
- can enforce state machine in memory/processor,
- high throughput per entity if controlled.

Cons:

- infrastructure complexity,
- failover/order handling,
- command queue,
- processing lag,
- exactly-once/idempotency still needed.

For very hot aggregates, single-writer can outperform LWT.

---

## 42. Pattern: Append-Only Event with Conflict Workflow

Instead of preventing all conflicts at write time:

```text
append proposed events
detect conflicts
resolve via workflow
```

Good for:

- collaborative systems,
- eventually consistent domains,
- CRDT-like semantics,
- audit-first designs.

Bad for:

- strict state transition requiring immediate single outcome,
- financial capture,
- uniqueness.

LWT is for reject-on-conflict. Event workflow is for record-and-resolve.

---

## 43. Pattern: Relational Transaction Boundary

Sometimes invariant spans many entities/tables:

```text
transfer funds between accounts
unique constraint with many side effects
complex foreign-key graph
inventory decrement across warehouses
```

If strict transaction is core, PostgreSQL/MySQL may be better for that part.

ScyllaDB can still store high-volume events/read models around it.

Top engineer uses the right system for invariant shape.

---

## 44. Pattern: Idempotent Append Without LWT

If event ID is deterministic and duplicate insert overwrites same row, maybe no LWT needed.

Example:

```sql
PRIMARY KEY ((tenant_id, case_id, version_bucket), event_version, event_id)
```

If command already assigned event_version safely elsewhere, append can be normal insert.

But if two commands might choose same version, need guard.

LWT should protect the allocation/invariant, not every idempotent write.

---

## 45. Pattern: Unique External Reference

Regulatory case may have external reference:

```text
agency_ref unique per tenant
```

Reservation table:

```sql
CREATE TABLE case_id_by_agency_ref (
    tenant_id uuid,
    agency_ref text,
    case_id uuid,
    created_at timestamp,
    PRIMARY KEY ((tenant_id, agency_ref))
);
```

Reserve:

```sql
INSERT ... IF NOT EXISTS;
```

Then create case current row.

Need handle:

```text
reservation succeeded, case creation failed
```

Option:

- status field in reservation,
- command idempotency,
- cleanup pending reservations,
- case creation retry.

---

## 46. Pattern: Case Reopen Guard

Only closed case can be reopened by authorized command.

```sql
UPDATE case_current_by_id
SET status = 'REOPENED',
    version = ?,
    updated_at = ?
WHERE tenant_id = ?
  AND case_id = ?
IF status = 'CLOSED'
   AND version = ?;
```

If not applied:

```text
case not closed or version changed
```

Command returns conflict.

Audit event should reflect only successful transition or record rejected command separately.

---

## 47. Pattern: Prevent Duplicate Projection Event

Projector processes event E.

Projection marker:

```sql
CREATE TABLE projection_event_processed_by_id (
    projection_name text,
    event_id uuid,
    processed_at timestamp,
    PRIMARY KEY ((projection_name, event_id))
) WITH default_time_to_live = 604800;
```

Insert marker IF NOT EXISTS before side effect:

```text
if applied, process
if not, skip duplicate
```

But this adds LWT per event: expensive.

Alternative:

- idempotent target writes,
- checkpointing,
- source_version,
- deterministic keys.

Use marker LWT only where necessary.

---

## 48. LWT and Performance Budget

Estimate LWT budget.

If normal write p99 is:

```text
5 ms
```

LWT may be:

```text
multiple round trips, higher p99
```

Actual depends cluster, RF, contention, hardware, topology.

Do not put LWT in path expecting millions/sec unless measured.

Load test with:

- realistic contention,
- realistic key distribution,
- RF/CL,
- multi-DC if used,
- failure/retry,
- driver settings.

---

## 49. Contention Modeling

For expected-version row:

```text
updates per second per case
```

If average:

```text
0.01/sec
```

LWT fine.

If hot case:

```text
100/sec
```

Maybe still okay if commands sequential and low conflict.

If:

```text
1000 concurrent clients update same row
```

bad.

Contention is about same partition/row, not total cluster QPS.

---

## 50. LWT Load Testing Scenarios

Test:

```text
1. no contention, many keys
2. moderate contention, same key
3. high contention, same key
4. timeout and unknown outcome
5. applied=false rate
6. node down with LOCAL_SERIAL
7. multi-DC local writes
8. retry storm
9. driver speculative execution disabled/enabled as appropriate
10. schema with/without derived side effects
```

Measure:

- applied latency,
- not-applied latency,
- timeout rate,
- throughput,
- p99/p999,
- cluster CPU,
- per-shard load.

---

## 51. API Semantics

Map LWT results to API.

### applied=true

```text
200 OK / 201 Created
```

### applied=false due duplicate

```text
200 OK with existing result
or 409 Conflict
```

For idempotency, duplicate same command should often return same result, not error.

### applied=false due version mismatch

```text
409 Conflict
```

Include current version/status if safe.

### timeout unknown

```text
202 Accepted/PENDING
or retry-after
or server-side resolution
```

Do not tell user “failed” if outcome unknown.

---

## 52. LWT and Command Idempotency Result Caching

Idempotency table can store final result:

```text
status = COMPLETED
result_ref = case_id/event_id
response_hash
```

Duplicate command:

```text
read result and return same response
```

Command states:

```text
RESERVED
IN_PROGRESS
COMPLETED
FAILED_RETRYABLE
FAILED_FINAL
UNKNOWN_RESOLUTION
```

This improves user retry behavior.

But TTL/retention must match retry window.

---

## 53. LWT and Security/Abuse

Uniqueness reservation and lock endpoints can be attacked.

Example:

```text
spam IF NOT EXISTS for many emails/usernames
```

Mitigate:

- rate limiting,
- CAPTCHA/prevalidation if public,
- input normalization,
- reserved names cache,
- abuse detection,
- request quotas,
- avoid unlimited pending reservations.

LWT is more expensive than normal read/write. Protect it.

---

## 54. LWT and Schema Design Checklist

For every LWT table:

```text
[ ] What invariant is enforced?
[ ] What is exact row/partition scope?
[ ] Is primary key high-cardinality?
[ ] Is contention expected?
[ ] What are normal CL and serial CL?
[ ] What is timeout handling?
[ ] What is applied=false handling?
[ ] Is statement idempotent across retry?
[ ] Are generated IDs stable?
[ ] Is TTL used? What happens after expiry?
[ ] Does multi-DC write same key?
[ ] Is LWT really needed?
[ ] Is there an alternative single-writer/workflow?
[ ] Are metrics defined?
[ ] Is load test realistic?
```

---

## 55. Common Misconceptions

### Misconception 1: “LOCAL_QUORUM prevents lost update.”

No. Need condition/version or single-writer.

### Misconception 2: “LWT is just a stronger consistency level.”

No. LWT is conditional coordination.

### Misconception 3: “IF NOT EXISTS is cheap.”

No. It uses Paxos-style coordination and has non-trivial cost.

### Misconception 4: “Timeout means LWT did not apply.”

No. Outcome unknown.

### Misconception 5: “applied=false is database failure.”

No. It is condition failure/business conflict.

### Misconception 6: “LWT gives multi-table transaction.”

No. It applies to conditional statements within CQL limitations, not arbitrary SQL transaction.

### Misconception 7: “Use LWT for counters.”

Usually wrong. Counter retry/throughput semantics are different.

### Misconception 8: “LWT lock is easy.”

Distributed locks require lease/fencing/clock/failure handling.

---

## 56. Mental Model Compression

Remember:

```text
Consistency level:
  How many replicas must answer?

LWT/CAS:
  Apply mutation only if current row state matches condition.
```

Use LWT when:

```text
a wrong concurrent write is worse than extra latency.
```

Avoid LWT when:

```text
you only need idempotent append/upsert,
or contention is extreme,
or invariant spans many rows/tables better handled elsewhere.
```

---

## 57. Summary

Lightweight transactions are a precision tool for conditional correctness in ScyllaDB.

Key lessons:

1. LWT enables `IF NOT EXISTS`, `IF EXISTS`, and conditional predicates.
2. LWT is for CAS-style correctness, not general SQL transactions.
3. `IF NOT EXISTS` uses Paxos-style coordination and has non-trivial cost.
4. LWT result must check `[applied]`.
5. `[applied]=false` is business conflict, not DB error.
6. Timeout means outcome unknown.
7. Idempotency and stable keys are mandatory for safe retry.
8. Expected-version pattern prevents lost updates.
9. LWT does not solve multi-table atomicity.
10. Source/event/current write order still needs workflow design.
11. LWT under contention can be expensive.
12. SERIAL/LOCAL_SERIAL configure conditional coordination scope.
13. Multi-DC active-active LWT needs careful semantics.
14. Distributed lock/queue patterns are harder than they look.
15. Java repository must encode applied/conflict/unknown outcomes.
16. Metrics must track LWT latency, applied false, timeout, contention.
17. Use LWT only for explicit invariants.

---

## 58. Review Questions

1. Apa beda consistency level biasa dan LWT?
2. Apa itu CAS?
3. Apa fungsi `IF NOT EXISTS`?
4. Kenapa `IF NOT EXISTS` tidak murah?
5. Apa arti `[applied]=false`?
6. Kenapa timeout LWT outcome unknown?
7. Bagaimana menangani timeout pada idempotency reservation?
8. Bagaimana expected-version update mencegah lost update?
9. Kenapa timestamp bukan pengganti version?
10. Apa beda SERIAL dan LOCAL_SERIAL?
11. Kapan LOCAL_SERIAL tidak cukup?
12. Apa risiko LWT pada hot key?
13. Kenapa LWT tidak memberi multi-table transaction?
14. Apa masalah uniqueness reservation jika row creation gagal?
15. Bagaimana merancang reservation table dengan status?
16. Kenapa distributed lock dengan LWT tetap sulit?
17. Kapan single-writer lebih baik daripada LWT?
18. Kapan append-only event tidak butuh LWT?
19. Apa metrik LWT yang harus dimonitor?
20. Bagaimana mapping LWT result ke HTTP/API response?

---

## 59. Practical Exercise

Gunakan domain regulatory case management.

Design LWT untuk:

```text
1. command idempotency reservation
2. case state transition with expected version
3. external reference uniqueness
4. reviewer assignment only if case is SUBMITTED
5. reopen case only if CLOSED
6. projection processed marker
```

Untuk tiap pattern, tulis:

```text
table schema
CQL statement
normal CL
serial CL
applied=true behavior
applied=false behavior
timeout behavior
retry behavior
contention risk
whether LWT is truly needed
alternative design
metrics
```

---

## 60. Preview Part 015

Part berikutnya membahas:

```text
Deletes, TTL, Tombstones, gc_grace_seconds, dan Zombie Data
```

Kita akan memperdalam:

- delete sebagai write,
- tombstone types,
- TTL expiry,
- range tombstone,
- tombstone scan,
- gc_grace_seconds,
- repair interaction,
- zombie resurrection,
- legal retention,
- derived table cleanup,
- queue anti-pattern,
- Java/API implications.

Part 014 membahas conditional correctness.

Part 015 membahas lifecycle data setelah delete/expiry.

---

# End of Part 014


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-013.md">⬅️ Part 013 — Consistency Levels: ONE, QUORUM, LOCAL_QUORUM, ALL, SERIAL, dan Trade-off Praktis</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-015.md">Part 015 — Deletes, TTL, Tombstones, gc_grace_seconds, dan Zombie Data ➡️</a>
</div>
