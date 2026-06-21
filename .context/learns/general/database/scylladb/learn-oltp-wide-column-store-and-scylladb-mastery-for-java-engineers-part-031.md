# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-031.md

# Part 031 — Correctness Patterns: Idempotency, Deduplication, Sagas, Outbox, Event Sourcing, Versioned State Machines, Single-Writer, Reconciliation, Read-Your-Write, dan Domain Invariants

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `031`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: pattern correctness untuk membangun sistem yang tetap benar walau distributed failures terjadi: idempotency, dedupe, command table, LWT guard, versioned state machine, event sourcing, outbox, saga, single-writer, reconciliation, read-your-write, source/derived authority, invariant validation, dan correctness-oriented Java repository design.

---

## 0. Posisi Part Ini dalam Seri

Part 030 membahas failure modelling:

```text
partial failure
timeout unknown outcome
retry ambiguity
node slow
split-brain
bad backfill
bad restore
```

Part ini menjawab:

```text
Pattern apa yang membuat sistem tetap benar saat failure terjadi?
```

Correctness di distributed OLTP bukan hasil dari satu fitur:

```text
bukan hanya LOCAL_QUORUM
bukan hanya LWT
bukan hanya retry
bukan hanya event log
bukan hanya outbox
```

Correctness muncul dari kombinasi:

```text
domain invariant
data model
idempotency
versioning
operation ownership
failure handling
reconciliation
observability
testing
```

---

## 1. Correctness First Principles

Sebelum memilih pattern, definisikan:

```text
1. Apa source of truth?
2. Apa derived/rebuildable?
3. Apa invariant yang tidak boleh dilanggar?
4. Apa yang boleh eventual?
5. Apa yang harus exact?
6. Apa yang boleh stale?
7. Apa operasi yang idempotent?
8. Apa operasi yang conflict-prone?
9. Apa recovery path?
10. Apa audit trail?
```

Tanpa ini, pattern hanya jadi template.

---

## 2. Domain Invariant

Invariant adalah aturan yang harus selalu benar.

Examples:

```text
case version must monotonically increase
case cannot transition CLOSED -> OPEN unless reopen command authorized
only one current state per case
event_id unique per case
command_id returns same result on retry
open_cases_by_assignee eventually matches case_current_by_id
privacy-deleted subject must not appear in derived/search
external_ref unique per tenant
```

Correctness design dimulai dari invariant.

---

## 3. Classify Invariants

### 3.1 Strong Invariant

Harus dijaga synchronously.

Example:

```text
case version transition
unique external_ref
payment state
```

Tools:

- LWT,
- single-writer,
- command routing,
- strong source table.

### 3.2 Eventual Invariant

Boleh sementara tidak benar, harus converge.

Example:

```text
derived queue reflects current state
search index catches up
dashboard aggregate updated
```

Tools:

- projection,
- reconciliation,
- validation,
- source_version.

### 3.3 Audit Invariant

Tidak boleh kehilangan jejak.

Example:

```text
every state transition has event record
```

Tools:

- append event log,
- idempotent event IDs,
- write ordering,
- backup.

---

## 4. Source of Truth Pattern

Setiap data item harus tahu authority.

Example:

```text
case_current_by_id = authoritative current state
case_events_by_case = authoritative audit log
open_cases_by_assignee = derived view
search_index = derived external projection
dashboard_count = derived aggregate
```

Rule:

```text
derived data can be wrong temporarily
source data must be protected
```

Do not let derived table become implicit source because it is convenient to query.

---

## 5. Authority Matrix

Create table:

| Data | Source | Derived | Rebuild Method |
|---|---|---|---|
| current case status | case_current_by_id | open_cases views | rebuild from current/events |
| audit history | case_events_by_case | none | restore from backup |
| assignee queue | case_current_by_id | open_cases_by_assignee | projection/reconciliation |
| search result | case_current/events | search index | reindex |
| unread badge | notifications/read state | aggregate/counter | recompute |

This matrix guides:

- retry,
- restore,
- reconciliation,
- backfill,
- incident response.

---

## 6. Idempotency

Idempotency means:

```text
repeating same operation produces same intended result
```

In distributed systems, idempotency is not optional.

Why:

- clients retry,
- network timeouts happen,
- service crashes,
- message streams redeliver,
- backfills restart,
- operators rerun jobs.

If retry changes result unexpectedly, correctness fails.

---

## 7. Idempotency Key

External command should include stable key:

```text
command_id
idempotency_key
request_id? not always sufficient
```

Example API:

```http
POST /cases/{caseId}/transition
Idempotency-Key: 3f1c...
```

The key represents semantic command, not one HTTP attempt.

Client retries with same key.

Server returns same result.

---

## 8. Command Result Table

Table:

```sql
CREATE TABLE command_result_by_id (
    tenant_id uuid,
    command_id uuid,
    command_type text,
    target_type text,
    target_id uuid,
    status text,
    result_code text,
    result_payload text,
    error_code text,
    created_at timestamp,
    updated_at timestamp,
    PRIMARY KEY ((tenant_id, command_id))
);
```

Use:

```text
reserve command
execute
store result
retry returns stored result
```

Status:

```text
RESERVED
APPLIED
CONFLICT
FAILED_FINAL
PENDING_CONFIRMATION
```

---

## 9. Reserve Command with LWT

Reserve:

```sql
INSERT INTO command_result_by_id (
    tenant_id, command_id, command_type, target_type, target_id,
    status, created_at, updated_at
)
VALUES (?, ?, ?, ?, ?, 'RESERVED', ?, ?)
IF NOT EXISTS;
```

If `[applied]=true`:

```text
this attempt owns command
```

If `[applied]=false`:

```text
command already exists; read result
```

This avoids duplicate command execution.

---

## 10. Command Reservation Timeout

If reservation LWT times out:

```text
outcome unknown
```

Correct handling:

```text
read command_result_by_id by command_id
if exists -> continue/return
if absent -> retry reservation with same command_id
```

Do not create a new command_id.

---

## 11. Idempotent Event Insert

Event table:

```sql
CREATE TABLE case_events_by_case_version_bucket (
    tenant_id uuid,
    case_id uuid,
    version_bucket bigint,
    event_version bigint,
    event_id uuid,
    command_id uuid,
    event_type text,
    payload text,
    created_at timestamp,
    PRIMARY KEY ((tenant_id, case_id, version_bucket), event_version, event_id)
);
```

Idempotent if:

```text
event_id stable
event_version stable
command_id stable
same retry writes same row
```

Avoid generating event_id inside retry loop.

---

## 12. Deduplication

Deduplication removes repeated processing.

Sources of duplicates:

- client retry,
- Kafka redelivery,
- projector restart,
- backfill rerun,
- timeout retry,
- operator replay.

Dedupe key examples:

```text
command_id
event_id
source_offset
source_version
external_message_id
```

Dedupe can be:

- command table,
- processed_events table,
- primary key uniqueness,
- idempotent upsert,
- source_version check.

---

## 13. Processed Event Table

For projector:

```sql
CREATE TABLE processed_event_by_projector (
    projector_name text,
    event_id uuid,
    processed_at timestamp,
    source_version bigint,
    PRIMARY KEY ((projector_name), event_id)
);
```

But beware:

```text
one huge partition per projector
```

Better bucket:

```sql
CREATE TABLE processed_event_by_projector_bucket (
    projector_name text,
    bucket_day date,
    event_id uuid,
    processed_at timestamp,
    PRIMARY KEY ((projector_name, bucket_day), event_id)
);
```

Or design target writes to be naturally idempotent and avoid separate dedupe table when possible.

---

## 14. Natural Dedup via Target Primary Key

If derived row key is deterministic:

```text
tenant_id + assignee_id + day + bucket + due_at + case_id
```

Writing same projection twice overwrites same row.

This is simpler than processed-event table.

But if event changes row location, cleanup old row still needed.

---

## 15. Versioned State Machine

For entity current state:

```text
state
version
last_event_id
updated_at
```

Transition command includes:

```text
expected_version
expected_state
new_state
command_id
event_id
```

LWT:

```sql
UPDATE case_current_by_id
SET status = ?,
    version = ?,
    last_event_id = ?,
    updated_at = ?
WHERE tenant_id = ?
  AND case_id = ?
IF status = ?
   AND version = ?;
```

This prevents lost update.

---

## 16. State Transition Table

Define allowed transitions in code/config:

```text
DRAFT -> SUBMITTED
SUBMITTED -> UNDER_REVIEW
UNDER_REVIEW -> APPROVED
UNDER_REVIEW -> REJECTED
APPROVED -> CLOSED
REJECTED -> CLOSED
CLOSED -> REOPENED only with permission
```

Do not let API set arbitrary status.

Repository should expose:

```text
transitionIfVersionMatches
```

not:

```text
updateStatus
```

---

## 17. LWT Conflict Is Business Result

If `[applied]=false`:

```text
not exception
```

It means:

- stale version,
- invalid current state,
- concurrent command won,
- duplicate/out-of-order command.

Return:

```text
409 CONFLICT
```

or domain-specific result.

Track metrics.

---

## 18. LWT Timeout Resolution

If LWT timeout after transition attempt:

Read current row.

If current row has:

```text
last_event_id == desired_event_id
version == desired_new_version
status == desired_new_status
```

then command succeeded.

If still old version:

```text
retry if deadline allows
```

If different version:

```text
conflict or unknown requiring command table lookup
```

This is why including `last_event_id`/`command_id` in current row is useful.

---

## 19. Single-Writer Pattern

Instead of many clients competing with LWT, route all commands for entity to one logical writer.

Examples:

- Kafka partition by `case_id`,
- actor per aggregate,
- queue per tenant/entity,
- leader service shard.

Benefits:

- serializes transitions,
- reduces LWT contention,
- simpler ordering.

Trade-offs:

- queue latency,
- partition rebalancing,
- writer failure/recovery,
- throughput per key,
- operational complexity.

---

## 20. Single-Writer with ScyllaDB

Pattern:

```text
API validates command -> enqueue command keyed by case_id
worker consumes partition -> updates ScyllaDB sequentially
```

ScyllaDB stores:

- command result,
- current state,
- events,
- derived views.

Still need idempotency because worker can crash/reprocess.

---

## 21. Event Sourcing

Event sourcing stores facts/events as source of truth.

Current state is projection.

Benefits:

- audit,
- replay,
- rebuild derived views,
- temporal debugging,
- recovery/PITR,
- deterministic state evolution.

Costs:

- event schema evolution,
- projection lag,
- replay complexity,
- storage growth,
- idempotency,
- ordering,
- privacy deletion complexity.

Good fit for regulatory/audit-heavy systems.

---

## 22. Event-Sourced Case Model

Source:

```text
case_events_by_case_version_bucket
```

Current projection:

```text
case_current_by_id
```

Derived projections:

```text
open_cases_by_assignee
case_id_by_external_ref
search_index
dashboard_aggregates
```

Invariant:

```text
case_current.version == latest event_version applied
```

Validator can check this.

---

## 23. Event Versioning

Events should include:

```text
event_id
event_version
event_type
schema_version
command_id
actor_id
created_at
source_region
payload
```

Use `event_version` for domain ordering.

Do not rely on wall-clock ordering only.

---

## 24. Event Payload Evolution

Event logs live long.

Payload readers must support old versions.

Pattern:

```text
EventPayloadV1
EventPayloadV2
EventPayloadV3
```

Deserialize by `schema_version`.

Do not delete old decoder if old events remain.

---

## 25. Outbox Pattern

Outbox ensures state change and publishable event are durably recorded.

In relational DB, outbox often shares transaction with state update.

In ScyllaDB, multi-table atomicity is limited, so adapt.

Options:

1. event log itself is outbox.
2. command table stores pending publish state.
3. CDC on source table.
4. projector reads event table.
5. external stream is source and Scylla is projection.

Prefer:

```text
source event log as outbox
```

if possible.

---

## 26. Event Log as Outbox

Flow:

```text
1. transition writes event row
2. projector scans/streams event row
3. publishes notification/search/update
4. checkpoint after success
```

If publisher fails:

```text
event remains; projector retries
```

This avoids separate outbox table if event table is queryable/streamable for projector.

Need:

- efficient projector access pattern,
- checkpoint,
- idempotent downstream publish,
- ordering if required.

---

## 27. CDC as Outbox

CDC can propagate changes.

Pros:

- low app coupling,
- captures database changes,
- supports external projection.

Cons:

- CDC semantics/retention/ordering must be understood,
- duplicates possible,
- schema changes,
- operational complexity,
- not substitute for domain event design.

Use CDC when it fits, not as magic.

---

## 28. Saga Pattern

Saga coordinates multi-step workflow without distributed transaction.

Example:

```text
1. reserve external_ref
2. create case
3. upload evidence metadata
4. notify assignee
5. index search
```

Each step has:

- action,
- compensation or retry,
- state,
- timeout,
- idempotency.

Saga state stored durably.

---

## 29. Saga State Table

```sql
CREATE TABLE saga_by_id (
    tenant_id uuid,
    saga_id uuid,
    saga_type text,
    target_id uuid,
    state text,
    step text,
    attempt int,
    payload text,
    updated_at timestamp,
    PRIMARY KEY ((tenant_id, saga_id))
);
```

Saga must tolerate replay.

Each step idempotent.

---

## 30. Compensation

Compensation is not always undo.

Example:

```text
if notification publish fails, do not undo case creation
retry notification or mark pending
```

For legal workflow, compensation may be:

```text
create correction event
```

not delete history.

Design compensation per domain.

---

## 31. Reconciliation

Reconciliation repairs derived/inconsistent data by comparing to source.

Examples:

```text
open_cases view vs case_current
search index vs event/current
dashboard aggregate vs source events
command result vs current state
```

Reconciliation can be:

- scheduled,
- continuous,
- triggered by stale read,
- after backfill,
- after incident,
- after restore.

---

## 32. Reconciliation Table

Track progress:

```sql
CREATE TABLE reconciliation_job_by_id (
    job_id uuid PRIMARY KEY,
    job_type text,
    status text,
    started_at timestamp,
    updated_at timestamp,
    rows_checked bigint,
    rows_repaired bigint,
    rows_failed bigint
);
```

And failures:

```sql
CREATE TABLE reconciliation_failure_by_job (
    job_id uuid,
    bucket int,
    failed_at timestamp,
    source_key text,
    error_code text,
    PRIMARY KEY ((job_id, bucket), failed_at, source_key)
);
```

---

## 33. Source Version in Derived Rows

Derived row:

```text
source_version
projection_version
projected_at
```

Reader/reconciler can detect stale:

```text
derived.source_version < current.version
```

This supports:

- stale filtering,
- safe backfill,
- validation,
- migration.

---

## 34. Delete in Derived Views

If source state changes so row moves:

```text
old derived row must be removed
new derived row inserted
```

Example:

```text
assignee changes A -> B
```

Need old key to delete old row.

Options:

- include previous assignee in event,
- read old current before update,
- store reverse index,
- reconciliation removes orphans,
- TTL stale rows with validation.

Deletes can create tombstones; design lifecycle.

---

## 35. Read-Your-Write

User expects after write:

```text
I submit transition, then see updated case
```

But derived views may lag.

Options:

1. read authoritative source after command,
2. return updated state in command response,
3. session token containing version,
4. UI optimistic update,
5. route subsequent read to source/home,
6. wait for projection up to deadline.

Do not promise read-your-write from async derived table unless guaranteed.

---

## 36. Version Token

Command response:

```json
{
  "caseId": "...",
  "version": 42,
  "status": "UNDER_REVIEW"
}
```

Subsequent read can require:

```text
at least version 42
```

If derived view row has `source_version < 42`:

```text
fallback to source or show pending
```

This makes staleness explicit.

---

## 37. Monotonic Reads

User should not see version go backward during session.

Keep:

```text
last_seen_version per entity/session
```

If read returns older version:

- re-read stronger source,
- wait/retry,
- show cached newer state,
- reject stale projection.

Useful in distributed/multi-region systems.

---

## 38. Consistency by Operation

Use different consistency for different roles:

```text
source command write: LOCAL_QUORUM + LWT if needed
authoritative read: LOCAL_QUORUM
derived feed read: LOCAL_ONE
backfill derived write: LOCAL_ONE/LOCAL_QUORUM based on rebuildability
idempotency reservation: LOCAL_QUORUM + LWT
```

Correctness is not one global CL.

---

## 39. Compare-and-Set for Unique Mapping

Unique external ref per tenant:

```sql
CREATE TABLE case_id_by_external_ref (
    tenant_id uuid,
    external_ref text,
    case_id uuid,
    created_at timestamp,
    PRIMARY KEY ((tenant_id, external_ref))
);
```

Reserve:

```sql
INSERT INTO case_id_by_external_ref (...)
VALUES (...)
IF NOT EXISTS;
```

If conflict, read existing case_id.

This enforces uniqueness at mapping key.

---

## 40. Multi-Step Uniqueness

If create case must:

```text
reserve external_ref
create current row
append event
```

Failure can leave reserved external_ref but no case.

Options:

- saga with status,
- reservation TTL if safe,
- command table,
- reconciliation for orphan reservations,
- create case row first with same command_id then reserve? depends invariant.

Do not pretend multi-table transaction exists.

---

## 41. Reservation State Machine

Reservation row:

```text
RESERVED
CONFIRMED
EXPIRED
CANCELLED
```

Use command_id and timestamps.

A reconciler finds:

```text
RESERVED older than threshold without case
```

and resolves based on policy.

---

## 42. Dedup for Message Consumers

Message consumer pattern:

```text
consume event
write projection idempotently
checkpoint offset after success
```

If crash before checkpoint:

```text
event redelivered
projection write idempotent
```

If checkpoint before write:

```text
data loss
```

Never checkpoint before durable side effect.

---

## 43. Idempotent Downstream Publish

If publishing to external system:

- message key = event_id/command_id,
- downstream dedupe,
- publisher retry same message,
- store publish state if needed.

Do not generate new notification ID on each retry unless dedupe exists.

---

## 44. Correctness in Backfill

Backfill correctness:

```text
same source -> same target key
source_version included
checkpoint after success
live write race handled
validation after completion
DLQ for bad records
```

Backfill without correctness model can silently corrupt derived tables.

---

## 45. Correctness in Restore

Restore correctness:

```text
restore source first
replay deletion log
rebuild derived
validate invariants
avoid raw overwrite of newer data
domain correction events where needed
```

Restore is not just copying files.

---

## 46. Invariant Validators

Validators check:

```text
current.version equals max event_version
open_cases contains only OPEN current cases
case_id_by_external_ref points to existing case
no duplicate external_ref
privacy deleted subject absent
derived source_version not too stale
```

Run:

- scheduled,
- after backfill,
- after restore,
- after schema migration,
- during incident.

---

## 47. Validator Output

Validator should emit:

```text
rows_checked
violations_found
violations_by_type
sample keys
repairable count
unrepairable count
```

Avoid logging PII.

Some validators can auto-repair; others only alert.

---

## 48. Correctness Metrics

Track:

```text
idempotency_conflict_total
duplicate_command_total
lwt_conflict_total
timeout_unknown_total
derived_stale_ratio
reconciliation_repaired_total
validator_violation_total
projection_lag
source_version_lag
orphan_derived_rows
privacy_deletion_lag
```

Correctness has metrics, not just latency.

---

## 49. Java Repository Correctness API

Bad:

```java
void save(Case c);
void updateStatus(CaseId id, String status);
```

Good:

```java
CompletionStage<TransitionResult> transitionIfExpectedVersion(
    TenantId tenantId,
    CaseId caseId,
    long expectedVersion,
    CaseStatus expectedStatus,
    CaseStatus newStatus,
    CommandId commandId,
    EventId eventId
);
```

The method encodes invariant.

---

## 50. Domain Result Types

Use explicit results:

```java
sealed interface TransitionResult {
    record Applied(long newVersion, EventId eventId) implements TransitionResult {}
    record Conflict(long currentVersion, CaseStatus currentStatus) implements TransitionResult {}
    record Duplicate(CommandId commandId, Object previousResult) implements TransitionResult {}
    record PendingConfirmation(CommandId commandId) implements TransitionResult {}
    record Rejected(String reason) implements TransitionResult {}
}
```

Avoid boolean success.

---

## 51. Idempotency in Java Service Flow

Pseudo:

```text
1. parse command with command_id
2. reserve command IF NOT EXISTS
3. if duplicate, return stored result
4. load current state
5. validate transition
6. perform LWT transition
7. insert event idempotently
8. write command result
9. trigger async projection
10. return applied result
```

Order can vary, but each step must define failure handling.

---

## 52. Event-First vs Current-First

Two approaches:

### 52.1 Current-First

LWT update current, then insert event.

Risk:

```text
current updated, event insert fails
```

Need recovery to write missing event.

### 52.2 Event-First

Insert event, then project current.

Risk:

```text
event exists, current lag
```

Often acceptable in event-sourced model.

Choice depends on invariant:

```text
is audit event source or current row source?
```

Be explicit.

---

## 53. Strong Audit Pattern

For regulatory systems, audit log often must be source.

Flow:

```text
1. reserve command
2. append event with unique version
3. project current from event
4. project derived views
```

But assigning unique event_version concurrently needs:

- LWT current version guard,
- single-writer,
- sequence allocation,
- or event version in current transition.

A common hybrid:

```text
LWT current row increments version and records event_id
then event insert with that version
then validator ensures event exists
```

---

## 54. Handling Missing Event After Current Update

If current updated but event insert timed out/failed:

- command result pending,
- retry event insert with same event_id/version,
- validator detects current.last_event_id missing from event table,
- repair job inserts/reconstructs event if payload stored in command table.

Therefore command table should store enough payload to repair.

---

## 55. Command Payload Retention

Command table may need TTL.

But if command payload needed to repair missing event:

```text
TTL must exceed repair window
```

Trade-off:

- storage/privacy,
- recovery ability,
- idempotency window.

Define retention explicitly.

---

## 56. Privacy and Correctness

Privacy deletion is invariant:

```text
deleted subject must not appear in source, derived, search, backup restore
```

Patterns:

- deletion event/log,
- derived deletion projection,
- search delete,
- backup deletion replay,
- validator,
- legal hold exceptions.

Privacy correctness spans systems.

---

## 57. Multi-Region Correctness

Use:

- home region,
- fencing epoch,
- command routing,
- source_region metadata,
- conflict detector.

If active-active:

- define merge/conflict semantics,
- do not rely on LWW for legal state,
- validators detect impossible transitions.

---

## 58. Correctness Testing

Tests:

- duplicate command retry,
- timeout after LWT applied,
- timeout before LWT applied,
- event insert failure after current update,
- derived write failure,
- projector duplicate event,
- backfill live race,
- restore old data + deletion replay,
- unknown enum/payload,
- concurrent transition storm.

---

## 59. Property-Based Testing

For state machine:

Generate random sequences:

```text
submit
approve
reject
close
reopen
duplicate
retry
timeout
conflict
```

Assert invariants:

```text
version monotonic
invalid transitions rejected
event count matches applied transitions
current status reachable
```

Property testing catches edge cases.

---

## 60. Common Anti-Patterns

### 60.1 Boolean Success APIs

Cannot represent conflict/duplicate/pending.

### 60.2 Random IDs Inside Retry

Creates duplicates.

### 60.3 Derived Table as Truth

Stale data becomes decision input.

### 60.4 LWT Everywhere

Performance bottleneck and still not full transaction.

### 60.5 No Reconciliation

Eventual consistency never guaranteed to converge.

### 60.6 No Version in Derived Row

Cannot detect stale projection.

### 60.7 Outbox Without Idempotent Consumer

Duplicates still break downstream.

### 60.8 Event Log Without Schema Version

Future readers break.

### 60.9 Single-Writer Without Replay Safety

Crash loses/duplicates command.

### 60.10 Restore Without Domain Validation

Old state corrupts current system.

---

## 61. Correctness Checklist

```text
[ ] Source/derived authority matrix exists.
[ ] Domain invariants documented.
[ ] Each command has idempotency key.
[ ] Command result table or equivalent exists.
[ ] Write retry safety classified.
[ ] LWT conflicts/timeouts handled.
[ ] Current state has version/last_event_id.
[ ] Events have event_id/event_version/schema_version/command_id.
[ ] Derived rows have source_version/projection_version.
[ ] Projectors are idempotent.
[ ] Reconciliation jobs exist.
[ ] Validators check invariants.
[ ] API result types include conflict/duplicate/pending.
[ ] Backfill handles live write race.
[ ] Restore replays deletion log.
[ ] Multi-region ownership/fencing defined.
[ ] Correctness metrics and tests exist.
```

---

## 62. Mental Model Compression

Remember:

```text
Idempotency makes retries safe.
Versioning makes conflicts visible.
Event logs make recovery possible.
Source/derived separation makes reconciliation possible.
Single-writer reduces contention.
Reconciliation turns eventual into eventually correct.
Validators make correctness observable.
```

Correctness is not a single database setting.

It is a system design.

---

## 63. Summary

Correctness patterns turn failure modelling into robust architecture.

Key lessons:

1. Start with domain invariants.
2. Classify source vs derived data.
3. Every external command needs idempotency.
4. Command result table makes retries deterministic.
5. Stable IDs must be generated outside retry loops.
6. LWT protects specific invariants, not whole workflows.
7. LWT conflict is business result; timeout is unknown outcome.
8. Versioned state machines prevent lost updates.
9. Single-writer reduces contention but still needs idempotency.
10. Event sourcing helps audit/rebuild/PITR but has costs.
11. Outbox/event log patterns need idempotent consumers.
12. Sagas coordinate multi-step workflows with durable state.
13. Derived views need source_version and reconciliation.
14. Read-your-write requires explicit source read/version token strategy.
15. Restore/backfill correctness requires source_version/deletion replay/validation.
16. Correctness must be observable and tested.

---

## 64. Review Questions

1. Apa itu domain invariant?
2. Apa beda strong invariant dan eventual invariant?
3. Kenapa source/derived authority matrix penting?
4. Apa itu idempotency?
5. Bagaimana command_id membantu retry?
6. Bagaimana command reservation dengan LWT bekerja?
7. Kenapa stable event_id penting?
8. Apa itu deduplication?
9. Kapan processed_event table berguna?
10. Bagaimana versioned state machine mencegah lost update?
11. Kenapa LWT conflict bukan exception?
12. Bagaimana menangani LWT timeout?
13. Apa itu single-writer pattern?
14. Apa benefit dan biaya event sourcing?
15. Bagaimana event log bisa menjadi outbox?
16. Apa itu saga?
17. Apa fungsi reconciliation?
18. Kenapa derived row perlu source_version?
19. Bagaimana read-your-write dipenuhi?
20. Apa correctness checklist?

---

## 65. Practical Exercise

Desain correctness architecture untuk workflow:

```text
POST /cases/{caseId}/transition
```

Requirement:

```text
- client may retry
- no duplicate transition
- audit event required
- current state must be versioned
- assignee queue eventually updated
- notification eventually sent
- user should read own write after success
- restore must not resurrect privacy-deleted data
```

Tulis:

```text
1. invariants
2. source/derived matrix
3. command_id strategy
4. command_result_by_id schema
5. current table fields
6. event table fields
7. LWT statement
8. LWT timeout handling
9. event insert retry handling
10. derived projection design
11. notification outbox/consumer design
12. reconciliation job
13. read-your-write response strategy
14. validators
15. metrics
16. tests
```

---

## 66. Preview Part 032

Part berikutnya membahas:

```text
Security and Compliance:
authentication,
authorization,
TLS,
secrets,
encryption,
tenant isolation,
PII,
audit logs,
privacy deletion,
backup security,
least privilege,
and compliance-oriented data design.
```

Part 031 membahas correctness patterns.

Part 032 akan membahas security/compliance untuk ScyllaDB-backed Java systems.

---

# End of Part 031

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-030.md">⬅️ Part 030 — Failure Modelling: Partial Failures, Timeouts, Unknown Outcomes, Network Partitions, Slow Replicas, Retry Storms, Split-Brain, Data Corruption, Operator Errors, dan Graceful Degradation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-032.md">Part 032 — Security and Compliance: Authentication, Authorization, TLS, Secrets, Encryption, Tenant Isolation, PII, Audit Logs, Privacy Deletion, Backup Security, dan Compliance-Oriented Data Design ➡️</a>
</div>
