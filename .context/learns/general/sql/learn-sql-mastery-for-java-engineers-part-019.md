# learn-sql-mastery-for-java-engineers-part-019.md

# Part 19 — Transactions: ACID, Isolation, Anomalies, and Real Consistency

> Seri: SQL Mastery for Java Engineers  
> Bagian: 019 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-018.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-020.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas performance engineering: bagaimana bergerak dari slow query ke root cause.

Bagian ini membahas fondasi correctness saat banyak user/service/job mengakses database bersamaan: **transactions**.

Banyak Java engineer mengenal transaksi hanya sebagai:

```java
@Transactional
public void doSomething() { ... }
```

atau:

```sql
BEGIN;
...
COMMIT;
```

Tetapi transaksi bukan sekadar “supaya beberapa query jadi satu paket”.

Transaksi adalah mekanisme untuk menjawab pertanyaan sulit:

```text
Jika dua request menutup case yang sama bersamaan, apa yang terjadi?
Jika dua officer diassign sebagai primary pada case yang sama, siapa yang menang?
Jika job membaca data saat user sedang update, data apa yang terlihat?
Jika transaksi gagal di tengah, apakah data setengah jalan tersimpan?
Jika retry terjadi setelah timeout, apakah command aman?
Jika service mengirim event dan commit gagal, apakah sistem konsisten?
Jika dua transaksi masing-masing valid sendiri tetapi bersama-sama melanggar invariant, siapa yang mencegahnya?
```

Bagian ini membahas:

- ACID dengan makna praktis
- transaction boundary
- autocommit
- commit dan rollback
- isolation levels
- read phenomena
- dirty read
- non-repeatable read
- phantom read
- lost update
- write skew
- read committed vs repeatable read vs serializable
- optimistic locking
- guarded update
- constraints as concurrency control
- retry semantics
- Java `@Transactional`
- transaction propagation
- external side effects
- real consistency design

Kalimat inti:

> Transaction bukan dekorasi method; transaction adalah boundary kebenaran saat banyak hal terjadi bersamaan.

---

## 1. Mengapa Transactions Penting

Tanpa transaksi, operasi multi-step bisa menghasilkan data setengah jadi.

Contoh close case:

1. update `cases.status = CLOSED`
2. insert `case_status_transitions`
3. insert `audit_events`
4. insert `outbox_events`

Jika step 1 berhasil tapi step 2 gagal, current state dan history tidak konsisten.

Dengan transaksi:

```sql
BEGIN;

UPDATE cases ...;

INSERT INTO case_status_transitions ...;

INSERT INTO audit_events ...;

INSERT INTO outbox_events ...;

COMMIT;
```

Jika ada error:

```sql
ROLLBACK;
```

Semua perubahan dibatalkan.

Tapi ini baru atomicity. Masalah concurrency jauh lebih dalam.

---

## 2. ACID Secara Praktis

ACID:

```text
Atomicity
Consistency
Isolation
Durability
```

### 2.1 Atomicity

Semua perubahan dalam transaksi commit bersama atau rollback bersama.

```text
All or nothing.
```

### 2.2 Consistency

Transaksi membawa database dari satu state valid ke state valid lain.

Ini bukan magic. Database hanya bisa menjaga consistency yang kamu modelkan melalui:

- constraints
- foreign keys
- unique keys
- check constraints
- triggers
- isolation
- application logic
- transaction boundary yang benar

Jika invariant tidak dimodelkan, database tidak bisa menjaganya.

### 2.3 Isolation

Transaksi concurrent seolah-olah tidak saling mengganggu sesuai isolation level.

Tingkat isolasi berbeda memberi guarantee berbeda.

### 2.4 Durability

Jika commit berhasil, perubahan bertahan walaupun crash, sesuai guarantee database/storage.

---

## 3. Transaction Boundary

Transaction boundary menjawab:

```text
Perubahan mana yang harus commit atau rollback bersama?
```

Contoh operation:

```text
Assign case to primary officer
```

Mungkin harus meliputi:

- end old primary assignment
- insert new assignment
- insert assignment event
- insert audit event
- insert outbox event

Semua harus satu transaksi.

Jika dipisah:

```text
case assignment updated, but event missing
```

atau:

```text
event published but DB rollback
```

Consistency rusak.

---

## 4. Autocommit

Banyak database/client default autocommit:

```text
setiap statement adalah transaksi sendiri
```

Example:

```sql
UPDATE cases SET status = 'CLOSED' WHERE id = :id;
INSERT INTO case_status_transitions ...;
```

Jika autocommit aktif dan tidak ada explicit transaction:

- update commit langsung
- insert bisa gagal kemudian
- data inconsistent

Untuk multi-statement business operation, gunakan explicit transaction.

Di Spring, `@Transactional` biasanya membuka transaction boundary pada method public yang dipanggil melalui proxy.

---

## 5. Commit dan Rollback

### 5.1 COMMIT

```sql
COMMIT;
```

Membuat perubahan transaksi visible/durable.

### 5.2 ROLLBACK

```sql
ROLLBACK;
```

Membatalkan perubahan sejak `BEGIN`.

### 5.3 Error State

Beberapa database seperti PostgreSQL menandai transaction sebagai aborted setelah error. Setelah itu, statement berikutnya gagal sampai rollback.

Ini penting dalam Java:

- jangan lanjut pakai transaction yang sudah error
- rollback transaction
- map exception dengan benar
- retry dari awal transaction, bukan di tengah transaction yang gagal

---

## 6. Savepoint

Savepoint memungkinkan rollback sebagian.

```sql
BEGIN;

INSERT INTO import_batches ...;

SAVEPOINT row_1;

INSERT INTO staging_cases ...;

-- if row fails:
ROLLBACK TO SAVEPOINT row_1;

COMMIT;
```

Use cases:

- batch import dengan partial row handling
- optional step
- recoverable sub-operation

Caveats:

- complexity
- not replacement for clean validation
- overhead
- framework behavior varies

---

## 7. Isolation Level: Mengapa Ada

Jika transaksi berjalan satu per satu, mudah.

Tapi production concurrent.

Isolation level menentukan apa yang boleh terlihat oleh transaksi lain.

Common levels:

```text
READ UNCOMMITTED
READ COMMITTED
REPEATABLE READ
SERIALIZABLE
```

Vendor behavior differs. Names can mean different practical guarantees.

PostgreSQL, MySQL/InnoDB, SQL Server, Oracle punya perbedaan.

Jangan hanya hafal nama. Pahami anomaly yang bisa terjadi.

---

## 8. Dirty Read

Dirty read terjadi ketika transaksi membaca data yang belum commit dari transaksi lain.

Timeline:

```text
T1: UPDATE cases SET status='CLOSED' WHERE id='C1';
T2: SELECT status FROM cases WHERE id='C1'; -- sees CLOSED
T1: ROLLBACK;
```

T2 melihat state yang tidak pernah benar-benar commit.

Most mainstream databases avoid dirty reads at normal isolation levels.

`READ UNCOMMITTED` memungkinkan dirty reads di beberapa database, tetapi banyak engine tetap tidak mengizinkan secara nyata.

Untuk aplikasi bisnis, dirty read hampir selalu tidak dapat diterima.

---

## 9. Non-Repeatable Read

Non-repeatable read:

```text
Dalam satu transaksi, membaca row yang sama dua kali menghasilkan value berbeda karena transaksi lain commit di antaranya.
```

Timeline:

```text
T1: BEGIN;
T1: SELECT status FROM cases WHERE id='C1'; -- OPEN

T2: UPDATE cases SET status='CLOSED' WHERE id='C1';
T2: COMMIT;

T1: SELECT status FROM cases WHERE id='C1'; -- CLOSED
T1: COMMIT;
```

T1 melihat perubahan commit T2 di tengah transaksi.

Biasanya mungkin di READ COMMITTED.

Tidak terjadi di snapshot-style REPEATABLE READ untuk row yang sama.

---

## 10. Phantom Read

Phantom read:

```text
Dalam satu transaksi, query predicate yang sama menghasilkan set row berbeda karena transaksi lain insert/delete row yang cocok.
```

Timeline:

```text
T1: BEGIN;
T1: SELECT COUNT(*) FROM cases WHERE status='OPEN'; -- 10

T2: INSERT INTO cases(status) VALUES ('OPEN');
T2: COMMIT;

T1: SELECT COUNT(*) FROM cases WHERE status='OPEN'; -- 11
T1: COMMIT;
```

Row baru “phantom” muncul.

This matters for cross-row invariants and reports.

---

## 11. Lost Update

Lost update terjadi ketika dua transaksi membaca value sama lalu sama-sama menulis berdasarkan value lama.

Example counter:

```text
count = 10
```

Timeline:

```text
T1: read count = 10
T2: read count = 10
T1: write count = 11
T2: write count = 11
```

Expected if both increments count:

```text
12
```

Actual:

```text
11
```

One update lost.

### 11.1 Avoid Lost Update with Atomic Update

Good:

```sql
UPDATE counters
SET value = value + 1
WHERE id = :id;
```

Database serializes row update.

### 11.2 Avoid Lost Update with Optimistic Locking

```sql
UPDATE cases
SET
    priority = :new_priority,
    version = version + 1
WHERE id = :case_id
  AND version = :expected_version;
```

If affected rows = 0, conflict.

---

## 12. Write Skew

Write skew is more subtle.

Invariant:

```text
At least one doctor/officer must remain on duty.
```

Table:

```text
officer_duty(officer_id, on_duty)
```

Initial:

```text
A on duty
B on duty
```

Timeline:

```text
T1: reads A and B, sees B on duty, sets A off duty.
T2: reads A and B, sees A on duty, sets B off duty.
Both commit.
```

Final:

```text
A off duty
B off duty
```

Each transaction individually saw invariant satisfied, but together they violate it.

This can happen under snapshot isolation/repeatable read in some databases.

Fixes:

- serializable isolation
- explicit locking
- constraint/model redesign
- materialized invariant row
- advisory lock
- unique/exclusion constraint when applicable

Write skew is why “I used transaction” is not enough.

---

## 13. Read Committed

`READ COMMITTED` usually means each statement sees data committed before that statement starts.

Within one transaction:

```sql
BEGIN;

SELECT ...; -- snapshot A

-- another transaction commits

SELECT ...; -- snapshot B

COMMIT;
```

Two selects can see different committed states.

READ COMMITTED is common default in many databases.

Good for:

- many OLTP operations
- simple updates
- command writes with guarded predicates
- short transactions

Not enough for:

- multi-step read decision without locks
- cross-row invariant based only on reads
- consistent report snapshot
- complex workflow validation without guarding

---

## 14. Repeatable Read / Snapshot Isolation

Repeatable read often means transaction sees stable snapshot.

```text
All reads in transaction see same committed snapshot.
```

Benefits:

- no non-repeatable read
- stable report snapshot
- easier reasoning for read-only transaction

But depending database, write skew may still occur under snapshot isolation.

In PostgreSQL, `REPEATABLE READ` is snapshot isolation and prevents phantoms in the sense of snapshot visibility, but not all serializability anomalies.

In MySQL InnoDB, `REPEATABLE READ` has next-key locking behavior in some cases, but behavior depends on query/index/locking reads.

Vendor details matter.

---

## 15. Serializable

`SERIALIZABLE` aims to make concurrent transactions behave as if executed one at a time in some serial order.

This is strongest standard isolation.

Benefits:

- prevents many anomalies
- protects complex read/write interactions
- useful for critical invariants

Costs:

- more overhead
- more blocking or aborts
- serialization failures requiring retry
- can reduce throughput
- still need correct retry logic

Serializable does not mean “no errors”. It can mean:

```text
Transaction aborted because safe serial order could not be guaranteed.
```

Application must retry.

---

## 16. Isolation Level Table

Simplified conceptual table:

| Phenomenon | Read Committed | Repeatable Read / Snapshot | Serializable |
|---|---:|---:|---:|
| Dirty read | usually no | no | no |
| Non-repeatable read | possible | no | no |
| Phantom read | possible | snapshot-dependent | no |
| Lost update | DB-dependent; avoid explicitly | often detected/blocked | no/abort |
| Write skew | possible | possible in snapshot isolation | prevented/abort |

This is simplified. Always check target database.

---

## 17. Consistent Read for Reports

Report needs consistent snapshot:

```text
All numbers from same point in time.
```

At READ COMMITTED:

```sql
SELECT COUNT(*) FROM cases WHERE status='OPEN';
SELECT COUNT(*) FROM cases WHERE status='CLOSED';
```

Between statements, data can change.

Result may not add up.

Use:

- single query if possible
- repeatable read/read-only transaction
- materialized snapshot
- report table
- data warehouse
- as-of timestamp with temporal model

Example:

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT ...
SELECT ...

COMMIT;
```

Vendor syntax varies.

---

## 18. Guarded Update Pattern

For state transitions, avoid read-then-write race.

Bad:

```java
Case c = findCase(id);
if (c.status() == UNDER_REVIEW) {
    updateStatus(id, ESCALATED);
}
```

Concurrent transaction may change status between read and update.

Better:

```sql
UPDATE cases
SET
    status = 'ESCALATED',
    version = version + 1
WHERE id = :case_id
  AND status = 'UNDER_REVIEW';
```

Affected rows = 1 means transition happened.

Affected rows = 0 means conflict/not allowed/not found.

This is compare-and-set at database level.

---

## 19. SELECT FOR UPDATE

When application must inspect state before deciding, lock row.

```sql
BEGIN;

SELECT
    id,
    status,
    priority
FROM cases
WHERE id = :case_id
FOR UPDATE;

-- application validates

UPDATE cases
SET ...
WHERE id = :case_id;

COMMIT;
```

`FOR UPDATE` locks selected rows until transaction ends.

Use when:

- decision needs multiple current columns
- old values needed for history
- multiple updates must serialize on entity
- cannot express as single guarded update

Avoid:

- holding lock while calling external service
- locking more rows than needed
- long user interactions inside transaction

---

## 20. Constraints as Concurrency Control

Invariant:

```text
one active primary assignment per case
```

Application check:

```sql
SELECT COUNT(*)
FROM case_assignments
WHERE case_id = :case_id
  AND assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

Then insert if 0. Race-prone.

Database constraint:

```sql
CREATE UNIQUE INDEX uq_one_active_primary
ON case_assignments (case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

Now concurrent inserts cannot both succeed.

Constraints are often better than high isolation for specific invariants.

---

## 21. Idempotency and Transactions

If client times out, it may retry.

Question:

```text
Did first transaction commit?
```

Client may not know.

Use idempotency key:

```sql
CREATE TABLE processed_commands (
    tenant_id UUID NOT NULL,
    command_id UUID NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL,
    result JSONB,

    PRIMARY KEY (tenant_id, command_id)
);
```

Inside transaction:

```sql
INSERT INTO processed_commands (...)
VALUES (...)
ON CONFLICT DO NOTHING;
```

Only proceed if insert succeeded.

This makes retry safe.

---

## 22. External Side Effects Are Not Transactional

Bad pattern:

```java
@Transactional
void closeCase() {
    updateDatabase();
    kafka.send(caseClosedEvent);
}
```

If Kafka send succeeds and DB rolls back, inconsistency.

If DB commits and Kafka send fails, inconsistency.

Use outbox:

```text
inside DB transaction:
  update state
  insert outbox event

after commit:
  publisher sends outbox events
```

Database transaction cannot atomically commit arbitrary external side effects unless using distributed transaction, which is often avoided.

---

## 23. Transaction Duration

Keep transactions short.

Long transactions cause:

- locks held
- connection held
- MVCC cleanup blocked
- bloat
- deadlocks more likely
- pool exhaustion
- replication lag
- stale snapshots

Bad:

```java
@Transactional
void process() {
    selectForUpdate();
    callExternalApi();
    doHeavyComputation();
    update();
}
```

Better:

1. external API before transaction if possible
2. open transaction
3. validate current state
4. write quickly
5. commit
6. publish/send after via outbox

---

## 24. Transaction Scope in Spring

`@Transactional` applies through proxy.

Common pitfalls:

### 24.1 Self Invocation

```java
public void outer() {
    innerTransactional(); // same class call, proxy bypassed
}

@Transactional
public void innerTransactional() {}
```

Transaction may not start.

### 24.2 Private Method

`@Transactional` on private method usually does not work with proxy-based Spring AOP.

### 24.3 Checked Exceptions

By default, Spring rolls back on unchecked exceptions. Checked exceptions may not rollback unless configured.

### 24.4 Async

Work done in another thread may not share transaction.

### 24.5 Multiple Data Sources

One `@Transactional` may not cover multiple databases unless configured with appropriate transaction manager.

Know your framework behavior.

---

## 25. Transaction Propagation

Spring propagation examples:

```text
REQUIRED
REQUIRES_NEW
NESTED
MANDATORY
SUPPORTS
NOT_SUPPORTED
NEVER
```

### 25.1 REQUIRED

Join existing transaction or create new one.

Common default.

### 25.2 REQUIRES_NEW

Suspend existing transaction and start new one.

Danger:

- inner transaction can commit even if outer rolls back
- can break atomicity if used casually
- uses another connection

Use for special cases like independent audit log only if semantics intended.

### 25.3 NESTED

Uses savepoint if supported.

Different from `REQUIRES_NEW`.

Transaction propagation is correctness design, not annotation trivia.

---

## 26. Rollback Rules

Example:

```java
@Transactional
public void importFile() throws IOException {
    insertRows();
    if (badFile) throw new IOException();
}
```

By default, checked `IOException` may not rollback in Spring.

Configure:

```java
@Transactional(rollbackFor = IOException.class)
```

or throw unchecked domain exception.

Know rollback rules.

---

## 27. Isolation in Spring

```java
@Transactional(isolation = Isolation.SERIALIZABLE)
```

This sets isolation for transaction if supported.

Caveats:

- database may map levels differently
- connection pool may retain settings if not reset properly
- higher isolation may cause retries
- serializable without retry can increase failures
- long serializable transactions can hurt throughput

Use isolation explicitly when requirement demands it, not as blanket fix.

---

## 28. Read-Only Transactions

```java
@Transactional(readOnly = true)
```

Can signal intent and allow optimizations depending framework/database.

Benefits:

- prevents accidental writes in some setups
- can route to replica if infrastructure supports
- may optimize flush behavior in ORM
- documents intent

Caveat:

- not always enforced by database
- read-only does not mean consistent snapshot unless isolation appropriate
- read replica staleness still applies

---

## 29. Lost Update in ORM

Scenario:

```text
T1 loads Case status OPEN, priority NORMAL.
T2 loads same Case.
T1 sets priority HIGH and commits.
T2 sets status CLOSED and commits full entity.
```

If ORM updates all columns without versioning, T2 may overwrite priority back to NORMAL.

Use:

- `@Version`
- optimistic locking
- dynamic update carefully
- command-specific SQL
- reload/merge conflict handling

Database version column:

```sql
version BIGINT NOT NULL
```

JPA:

```java
@Version
private long version;
```

---

## 30. Optimistic vs Pessimistic Locking

### 30.1 Optimistic Locking

Assume conflicts rare.

Use version column.

Pros:

- no lock while user edits
- scalable for low contention
- detects lost update

Cons:

- conflicts handled after attempt
- requires retry/merge UX
- not enough for all cross-row invariants

### 30.2 Pessimistic Locking

Lock before change.

```sql
SELECT ... FOR UPDATE;
```

Pros:

- serializes access
- good for high-conflict critical sections

Cons:

- blocking
- deadlock risk
- transaction must be short
- connection held

Choose based on contention and domain.

---

## 31. Retryable Errors

Some transaction errors should be retried:

- serialization failure
- deadlock victim
- transient lock timeout, maybe
- failover transient errors, carefully

Retry rules:

- retry whole transaction
- ensure idempotency
- exponential backoff
- max attempts
- log/metrics
- do not retry non-idempotent external side effects
- distinguish business conflicts from transient concurrency

Serializable transaction without retry is incomplete.

---

## 32. Non-Retryable Errors

Do not blindly retry:

- unique violation for user-created duplicate
- check violation
- not null violation
- FK violation
- permission error
- syntax error
- invalid input
- business state conflict
- optimistic lock conflict requiring user decision

Some unique violations are idempotency success, not error, if expected.

Interpret based on constraint and command semantics.

---

## 33. Transaction and Isolation for Read-Modify-Write

Pattern:

```text
read current value
decide
write
```

Safe options:

### 33.1 Single Atomic Update

```sql
UPDATE ...
WHERE current_state = expected
```

Best if possible.

### 33.2 Optimistic Locking

```sql
WHERE version = expected_version
```

Good for aggregate updates.

### 33.3 SELECT FOR UPDATE

Lock row before decision.

### 33.4 Serializable + Retry

For complex multi-row decisions.

### 33.5 Constraint

For uniqueness/existence invariants.

Choose minimal correct mechanism.

---

## 34. Cross-Row Invariant Example: Capacity

Invariant:

```text
No officer can have more than 20 active primary cases.
```

Naive:

```sql
SELECT COUNT(*)
FROM case_assignments
WHERE officer_id = :officer_id
  AND assignment_role = 'PRIMARY'
  AND ended_at IS NULL;

-- if count < 20, insert assignment
```

Concurrent transactions can both see 19 and insert, final 21.

Options:

1. Lock officer row:

```sql
SELECT *
FROM officers
WHERE id = :officer_id
FOR UPDATE;
```

Then count and insert.

2. Maintain counter row with guarded update:

```sql
UPDATE officer_workload
SET active_primary_count = active_primary_count + 1
WHERE officer_id = :officer_id
  AND active_primary_count < 20;
```

Affected rows = 1 permits assignment.

3. Serializable transaction with retry.

4. Queue assignment through single worker.

No simple unique constraint solves “max 20” directly.

---

## 35. Phantom and Predicate Locks

Cross-row predicate:

```text
No overlapping active duty intervals.
```

Two transactions check no overlap then insert overlapping interval.

Fix options:

- exclusion constraint if supported
- serializable isolation
- explicit range/predicate locking if available
- lock parent entity
- advisory lock by officer_id
- redesign to discrete slots with unique constraint

Predicate invariants are harder than row invariants.

---

## 36. Advisory Locks

Some databases support advisory locks.

Concept:

```text
application-defined lock key
```

Example:

```text
lock officer_id while assigning workload
```

Pros:

- can serialize arbitrary domain key
- useful for complex invariants
- avoids locking unrelated rows if designed well

Cons:

- vendor-specific
- easy to misuse
- not visible as data constraint
- must ensure release/transaction scope
- key design matters
- can reduce throughput

Use sparingly and document.

---

## 37. Transaction and Outbox

Correct close case:

```sql
BEGIN;

UPDATE cases ...;

INSERT INTO case_status_transitions ...;

INSERT INTO outbox_events (
    id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload,
    created_at
)
VALUES (...);

COMMIT;
```

Publisher:

```sql
SELECT *
FROM outbox_events
WHERE published_at IS NULL
ORDER BY created_at
LIMIT 100;
```

Then publish and mark.

Need handle:

- duplicate publish
- idempotent consumers
- publisher crash after send before mark
- ordering needs
- partitioning
- retry/dead-letter

Outbox gives atomic DB state + event record, not exactly-once delivery by itself.

---

## 38. Transaction Boundaries Across Services

Microservices cannot share local DB transaction easily.

Avoid distributed transaction unless explicitly chosen.

Patterns:

- outbox/inbox
- saga
- process manager
- idempotent commands
- eventual consistency
- compensating actions
- explicit state machines

If service A updates DB and calls service B synchronously, there is no single ACID transaction across both by default.

Design for partial failure.

---

## 39. Consistency Vocabulary

Be precise.

### 39.1 Strong Consistency

After write commits, reads see it according to chosen scope.

### 39.2 Eventual Consistency

Other projections/services catch up later.

### 39.3 Read-Your-Writes

User sees their own committed write.

### 39.4 Monotonic Reads

User does not see time go backwards across reads.

### 39.5 Exactly-Once

Often misused. Usually need idempotency and deduplication, not literal exactly-once.

Use precise terms in design reviews.

---

## 40. Transaction Testing

Test concurrency.

Unit tests rarely catch transaction anomalies.

Use integration tests with:

- multiple connections
- latches/barriers
- real database
- controlled timing
- isolation levels
- expected conflicts

Test cases:

```text
two concurrent assigns primary -> only one succeeds
two concurrent close case -> one succeeds or idempotent behavior
duplicate external event -> processed once
optimistic lock conflict -> detected
serializable conflict -> retried
capacity limit -> not exceeded
```

Concurrency correctness needs deliberate tests.

---

## 41. Mini Case Study: Safe Escalation

Requirement:

> Escalate only if current status UNDER_REVIEW.

SQL:

```sql
UPDATE cases
SET
    status = 'ESCALATED',
    version = version + 1
WHERE tenant_id = :tenant_id
  AND id = :case_id
  AND status = 'UNDER_REVIEW';
```

If affected rows = 1:

```text
success
```

If 0:

```text
not found, unauthorized tenant, or state conflict
```

Then insert history in same transaction, or use CTE to insert only when update succeeded.

---

## 42. Mini Case Study: One Active Primary Assignment

Invariant:

```text
At most one active primary assignment per case.
```

Constraint:

```sql
CREATE UNIQUE INDEX uq_one_active_primary
ON case_assignments (tenant_id, case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

Concurrent inserts:

- one succeeds
- one fails unique violation

Java maps constraint to:

```text
CaseAlreadyHasPrimaryOfficerException
```

This is database-enforced concurrency correctness.

---

## 43. Mini Case Study: Officer Capacity

Invariant:

```text
Officer cannot exceed 20 active primary cases.
```

Counter table:

```sql
CREATE TABLE officer_workloads (
    tenant_id UUID NOT NULL,
    officer_id UUID NOT NULL,
    active_primary_count INTEGER NOT NULL,

    PRIMARY KEY (tenant_id, officer_id),
    CHECK (active_primary_count >= 0)
);
```

Transaction:

```sql
UPDATE officer_workloads
SET active_primary_count = active_primary_count + 1
WHERE tenant_id = :tenant_id
  AND officer_id = :officer_id
  AND active_primary_count < 20;
```

If affected rows = 1, insert assignment.

If insert assignment fails, rollback also rolls back counter increment.

Need decrement on assignment end in same transaction.

Trade-off:

- counter is redundant
- must maintain carefully
- enables guarded capacity update

---

## 44. Mini Case Study: Idempotent Close Command

Command table:

```sql
CREATE TABLE processed_commands (
    tenant_id UUID NOT NULL,
    command_id UUID NOT NULL,
    result_case_id UUID,
    processed_at TIMESTAMPTZ NOT NULL,

    PRIMARY KEY (tenant_id, command_id)
);
```

Process:

```sql
BEGIN;

INSERT INTO processed_commands (
    tenant_id,
    command_id,
    processed_at
)
VALUES (
    :tenant_id,
    :command_id,
    now()
)
ON CONFLICT DO NOTHING;

-- if insert count = 0, return existing result or no-op

UPDATE cases
SET status = 'CLOSED'
WHERE id = :case_id
  AND status <> 'CLOSED';

INSERT INTO outbox_events ...;

COMMIT;
```

Better design may store command result and enforce payload hash.

Idempotency semantics must be explicit.

---

## 45. Mini Case Study: Report Snapshot

Requirement:

> Generate report with multiple queries that must agree.

Use repeatable read/read-only transaction:

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT COUNT(*) FROM cases WHERE tenant_id = :tenant_id;

SELECT status, COUNT(*)
FROM cases
WHERE tenant_id = :tenant_id
GROUP BY status;

SELECT priority, COUNT(*)
FROM cases
WHERE tenant_id = :tenant_id
GROUP BY priority;

COMMIT;
```

All queries see same snapshot.

If report is huge, consider replica/warehouse/materialized snapshot.

---

## 46. Common Transaction Bugs

### Bug 1 — Autocommit Multi-Step Operation

State updated but history insert fails.

### Bug 2 — Read Then Write Without Guard

Race condition.

### Bug 3 — Long Transaction with External Call

Locks held too long.

### Bug 4 — `@Transactional` Self Invocation

Transaction not applied.

### Bug 5 — Checked Exception Does Not Roll Back

Partial commit surprise.

### Bug 6 — Event Sent Before Commit

External system sees event for rolled-back data.

### Bug 7 — No Retry for Serializable

User sees avoidable failure.

### Bug 8 — Blind Retry of Non-Idempotent Write

Duplicate side effects.

### Bug 9 — Assuming Repeatable Read Prevents All Anomalies

Write skew may remain depending DB.

### Bug 10 — Application-Only Uniqueness Check

Race creates duplicates.

---

## 47. Transaction Design Checklist

```text
[ ] What data must change atomically?
[ ] What invariants must hold after commit?
[ ] Are invariants enforced by constraints where possible?
[ ] Is read-then-write guarded?
[ ] Is affected row count checked?
[ ] Is optimistic locking needed?
[ ] Is pessimistic locking needed?
[ ] Is isolation level sufficient?
[ ] Are retries needed?
[ ] Is operation idempotent?
[ ] Are external side effects handled via outbox?
[ ] Is transaction short?
[ ] Are locks acquired in consistent order?
[ ] Are rollback rules correct?
[ ] Is Java transaction proxy actually applied?
[ ] Are concurrency tests present?
```

---

## 48. Isolation Decision Guide

Use default READ COMMITTED when:

```text
simple OLTP command with guarded writes/constraints
```

Use REPEATABLE READ / snapshot read when:

```text
multi-query report needs consistent snapshot
```

Use SELECT FOR UPDATE when:

```text
must inspect and mutate same row safely
```

Use optimistic locking when:

```text
user edits aggregate and conflicts are rare
```

Use constraints when:

```text
uniqueness/referential/conditional invariant can be declared
```

Use SERIALIZABLE when:

```text
complex multi-row invariant cannot be captured otherwise and retry is acceptable
```

Use advisory lock when:

```text
must serialize by domain key and no clean row/constraint exists
```

---

## 49. Practical Exercises

### Exercise 1 — Lost Update

Given:

```text
T1 reads priority NORMAL
T2 reads priority NORMAL
T1 writes HIGH
T2 writes LOW
```

Add version guard:

```sql
UPDATE cases
SET priority = :priority,
    version = version + 1
WHERE id = :id
  AND version = :expected_version;
```

### Exercise 2 — Guard Transition

```sql
UPDATE cases
SET status = 'ESCALATED'
WHERE id = :id
  AND status = 'UNDER_REVIEW';
```

Explain affected rows.

### Exercise 3 — One Active Assignment

Use partial unique index.

```sql
CREATE UNIQUE INDEX uq_one_active_primary
ON case_assignments (case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

### Exercise 4 — External Event Side Effect

Explain why sending Kafka event inside transaction is unsafe and how outbox helps.

### Exercise 5 — Report Consistency

Use repeatable read read-only transaction for multi-query report.

---

## 50. Koneksi ke Part Berikutnya

Part ini membahas transaksi, isolation, dan anomalies.

Part berikutnya, `part-020`, akan membahas mekanisme internal yang membuat transaksi bekerja:

- locking
- row locks
- table locks
- MVCC
- deadlocks
- lock waits
- snapshots
- vacuum/version cleanup
- `SELECT FOR UPDATE`
- optimistic vs pessimistic contention
- concurrency control in practice

Jika part ini menjawab “apa anomaly dan guarantee-nya”, part berikutnya menjawab “bagaimana database melakukannya dan bagaimana kita debug saat contention terjadi”.

---

## 51. Ringkasan Bagian Ini

Hal penting dari part 019:

1. Transaction adalah boundary correctness, bukan sekadar annotation.
2. ACID harus dipahami secara praktis.
3. Consistency hanya dijaga jika invariant dimodelkan.
4. Autocommit berbahaya untuk multi-step business operation.
5. Isolation level menentukan anomaly yang mungkin terjadi.
6. Dirty read, non-repeatable read, phantom read, lost update, dan write skew adalah pola kegagalan berbeda.
7. READ COMMITTED umum, tetapi tidak cukup untuk semua read-modify-write.
8. REPEATABLE READ memberi snapshot stabil, tetapi tidak selalu serializable.
9. SERIALIZABLE kuat tetapi butuh retry.
10. Guarded update adalah pattern penting untuk state transition.
11. `SELECT FOR UPDATE` berguna jika perlu inspect state sebelum write.
12. Constraints adalah concurrency control yang sangat efektif.
13. Idempotency key membuat retry aman.
14. External side effects tidak ikut rollback DB; gunakan outbox.
15. Transaction harus singkat.
16. Spring `@Transactional` punya proxy, propagation, isolation, dan rollback caveats.
17. Optimistic locking mencegah lost update pada aggregate edits.
18. Pessimistic locking cocok untuk high-contention critical sections.
19. Cross-row invariants butuh constraint, lock, serializable, atau redesign.
20. Concurrency correctness harus diuji dengan real database dan multiple connections.

Kalimat inti:

> Transaksi yang benar bukan hanya “pakai BEGIN/COMMIT”; ia adalah desain boundary, invariant, isolation, lock, retry, dan idempotency yang bersama-sama membuat data tetap benar saat dunia berjalan paralel.

---

## 52. Referensi

1. PostgreSQL Documentation — Transactions.  
   https://www.postgresql.org/docs/current/tutorial-transactions.html

2. PostgreSQL Documentation — Transaction Isolation.  
   https://www.postgresql.org/docs/current/transaction-iso.html

3. PostgreSQL Documentation — Explicit Locking.  
   https://www.postgresql.org/docs/current/explicit-locking.html

4. PostgreSQL Documentation — Serializable Isolation.  
   https://www.postgresql.org/docs/current/transaction-iso.html#XACT-SERIALIZABLE

5. MySQL 8.4 Reference Manual — InnoDB Transaction Isolation Levels.  
   https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html

6. SQL Server Documentation — Transaction Locking and Row Versioning Guide.  
   https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide

7. Oracle Database Concepts — Data Concurrency and Consistency.  
   https://docs.oracle.com/en/database/oracle/oracle-database/23/cncpt/data-concurrency-and-consistency.html

8. Spring Framework Documentation — Transaction Management.  
   https://docs.spring.io/spring-framework/reference/data-access/transaction.html

9. Martin Kleppmann — Designing Data-Intensive Applications, transactions and isolation discussion.  
   https://dataintensive.net/

---

## 53. Status Seri

Seri belum selesai.

Bagian selesai:

- `learn-sql-mastery-for-java-engineers-part-000.md`
- `learn-sql-mastery-for-java-engineers-part-001.md`
- `learn-sql-mastery-for-java-engineers-part-002.md`
- `learn-sql-mastery-for-java-engineers-part-003.md`
- `learn-sql-mastery-for-java-engineers-part-004.md`
- `learn-sql-mastery-for-java-engineers-part-005.md`
- `learn-sql-mastery-for-java-engineers-part-006.md`
- `learn-sql-mastery-for-java-engineers-part-007.md`
- `learn-sql-mastery-for-java-engineers-part-008.md`
- `learn-sql-mastery-for-java-engineers-part-009.md`
- `learn-sql-mastery-for-java-engineers-part-010.md`
- `learn-sql-mastery-for-java-engineers-part-011.md`
- `learn-sql-mastery-for-java-engineers-part-012.md`
- `learn-sql-mastery-for-java-engineers-part-013.md`
- `learn-sql-mastery-for-java-engineers-part-014.md`
- `learn-sql-mastery-for-java-engineers-part-015.md`
- `learn-sql-mastery-for-java-engineers-part-016.md`
- `learn-sql-mastery-for-java-engineers-part-017.md`
- `learn-sql-mastery-for-java-engineers-part-018.md`
- `learn-sql-mastery-for-java-engineers-part-019.md`

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-020.md` — Locking, MVCC, Deadlocks, and Concurrency Control


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-018.md">⬅️ Part 18 — Performance Engineering: From Slow Query to Root Cause</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-020.md">Part 20 — Locking, MVCC, Deadlocks, and Concurrency Control ➡️</a>
</div>
