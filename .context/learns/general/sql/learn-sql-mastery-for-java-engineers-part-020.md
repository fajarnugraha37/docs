# learn-sql-mastery-for-java-engineers-part-020.md

# Part 20 — Locking, MVCC, Deadlocks, and Concurrency Control

> Seri: SQL Mastery for Java Engineers  
> Bagian: 020 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-019.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-021.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas transactions, ACID, isolation levels, dan anomalies.

Bagian ini membahas mekanisme yang membuat concurrency control benar-benar terjadi di database:

```text
locks
MVCC
snapshots
deadlocks
lock waits
row versions
blocking
optimistic/pessimistic contention
```

Sebagai Java backend engineer, kamu tidak cukup hanya tahu:

```java
@Transactional
```

Kamu harus bisa menjawab:

```text
Query ini mengunci apa?
Kenapa update ini menunggu?
Kenapa select bisa jalan saat update belum commit?
Kenapa deadlock terjadi?
Kenapa vacuum/autovacuum penting?
Kenapa transaction lama membuat table bloat?
Kenapa SELECT FOR UPDATE memperbaiki race tapi menurunkan throughput?
Kenapa constraint unique bisa menjadi concurrency control?
Kenapa retry deadlock/serialization harus dari awal transaksi?
```

Bagian ini membangun mental model untuk debugging dan desain sistem concurrent.

Kalimat inti:

> Transaction memberi boundary; locking dan MVCC adalah mekanisme yang menentukan siapa melihat apa, siapa menunggu siapa, dan kapan konflik harus dibatalkan.

---

## 1. Concurrency Control: Problem Dasar

Database melayani banyak transaksi bersamaan.

Contoh:

```text
T1 menutup case C1.
T2 mengassign officer ke case C1.
T3 membaca daftar open cases.
T4 menjalankan report.
T5 publisher outbox membaca event.
T6 batch job mengupdate SLA.
```

Jika semua dijalankan serial satu per satu, correctness mudah tapi throughput buruk.

Database ingin:

- memungkinkan banyak read/write berjalan paralel
- menjaga invariant
- mencegah corruption
- memberi snapshot yang konsisten sesuai isolation
- mendeteksi konflik
- memblokir saat perlu
- membatalkan transaksi jika deadlock/serialization conflict

Mekanisme utama:

```text
locks + MVCC + constraints + isolation rules
```

---

## 2. Locking vs MVCC

Secara kasar:

### 2.1 Locking

Locking mengatur siapa boleh membaca/menulis object tertentu.

Contoh:

```sql
UPDATE cases
SET status = 'CLOSED'
WHERE id = :id;
```

Update mengambil lock pada row yang diubah.

Transaksi lain yang ingin update row sama harus menunggu atau gagal.

### 2.2 MVCC

MVCC = Multi-Version Concurrency Control.

Alih-alih satu versi row, database menyimpan beberapa versi row sehingga reader bisa melihat snapshot lama tanpa menunggu writer commit.

Dengan MVCC:

```text
writer tidak selalu memblokir reader
reader tidak selalu memblokir writer
```

Tetapi writer vs writer tetap conflict.

---

## 3. Mental Model MVCC

Row logical:

```text
case C1 status = OPEN
```

T1 update:

```sql
UPDATE cases SET status = 'CLOSED' WHERE id = 'C1';
```

Secara MVCC, database dapat menyimpan versi baru:

```text
old version: status OPEN, visible to transactions before T1 commit
new version: status CLOSED, visible after T1 commit to appropriate snapshots
```

Jika T2 sudah mulai sebelum T1 commit, T2 mungkin masih melihat OPEN tergantung isolation/snapshot.

Jika T3 mulai setelah commit, T3 melihat CLOSED.

MVCC membuat reads consistent tanpa selalu blocking.

---

## 4. MVCC Tidak Berarti Tanpa Lock

MVCC sering disalahpahami sebagai:

```text
database tidak perlu lock
```

Salah.

MVCC mengurangi blocking antara read dan write, tetapi lock tetap dibutuhkan untuk:

- concurrent updates to same row
- delete/update conflicts
- unique constraint checks
- foreign key checks
- DDL
- `SELECT FOR UPDATE`
- serializable predicate conflict tracking
- table-level operations
- index modifications
- vacuum/cleanup coordination
- metadata/catalog changes

MVCC dan locking bekerja bersama.

---

## 5. Row Locks

Row lock melindungi row individual.

DML seperti:

```sql
UPDATE cases
SET status = 'CLOSED'
WHERE id = :id;
```

mengunci row `cases.id = :id`.

Transaksi lain:

```sql
UPDATE cases
SET priority = 'HIGH'
WHERE id = :id;
```

akan menunggu sampai transaksi pertama commit/rollback.

### 5.1 Row Lock Durasi

Row lock biasanya ditahan sampai transaksi selesai.

```sql
BEGIN;

UPDATE cases SET status = 'CLOSED' WHERE id = :id;

-- lock masih dipegang di sini

COMMIT;
```

Jadi transaction duration sangat penting.

---

## 6. Row Lock pada UPDATE

Ketika update memilih row:

```sql
UPDATE cases
SET priority = 'HIGH'
WHERE tenant_id = :tenant_id
  AND status = 'OPEN';
```

Database akan lock row yang diupdate.

Jika predicate tidak memakai index dan scan banyak row, database bisa membaca banyak row dan mengunci row yang match.

Risiko:

- banyak row locked
- transaction lama
- konflik dengan user updates
- replication lag
- deadlock risk
- rollback besar

Bulk update harus dibatch dan dipahami.

---

## 7. DELETE Locking

```sql
DELETE FROM case_notes
WHERE case_id = :case_id;
```

Delete juga mengunci row yang dihapus.

Foreign keys bisa menambah lock/check pada related tables.

Jika parent row dihapus:

```sql
DELETE FROM cases WHERE id = :id;
```

Database harus memastikan FK behavior:

- restrict/no action
- cascade
- set null

Jika child FK tidak terindex, parent delete/update bisa lambat dan blocking lebih lama.

Index FK child columns sering penting untuk concurrency, bukan hanya speed.

---

## 8. SELECT Biasanya Tidak Mengunci Row untuk Update

Normal select:

```sql
SELECT *
FROM cases
WHERE id = :id;
```

di MVCC database biasanya tidak mengunci row untuk mencegah update.

Transaksi lain masih bisa update.

Jika kamu butuh membaca lalu mengubah berdasarkan value yang dibaca, normal SELECT tidak cukup.

Gunakan:

- guarded update
- optimistic locking
- `SELECT FOR UPDATE`
- serializable transaction
- constraint

---

## 9. SELECT FOR UPDATE

```sql
BEGIN;

SELECT *
FROM cases
WHERE id = :id
FOR UPDATE;

-- row locked

UPDATE cases
SET status = 'CLOSED'
WHERE id = :id;

COMMIT;
```

`FOR UPDATE` mengambil row lock seperti akan update.

Transaksi lain yang mencoba update row sama akan menunggu.

Use cases:

- need old value for history
- complex validation in Java before update
- serialize commands for one aggregate/entity
- prevent concurrent update between read and write

Caveats:

- hold lock until commit
- transaction must be short
- can cause deadlocks if lock order inconsistent
- can reduce throughput under high contention

---

## 10. SELECT FOR UPDATE SKIP LOCKED

Some databases support `SKIP LOCKED`.

Use case: worker queue.

```sql
SELECT id
FROM outbox_events
WHERE published_at IS NULL
ORDER BY created_at
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

Multiple workers can fetch different rows without waiting on locked rows.

Pattern:

```sql
BEGIN;

SELECT ...
FOR UPDATE SKIP LOCKED;

-- process/mark claimed

COMMIT;
```

Caveats:

- vendor-specific
- can skip old locked rows repeatedly
- ordering fairness not guaranteed
- must design retry/recovery
- should avoid doing slow external publish while holding DB lock unless row is first claimed and committed

Better often:

1. claim rows quickly in DB
2. commit
3. publish externally
4. mark published/idempotently

---

## 11. SELECT FOR UPDATE NOWAIT

`NOWAIT` fails immediately if row locked.

```sql
SELECT *
FROM cases
WHERE id = :id
FOR UPDATE NOWAIT;
```

Use cases:

- avoid request hanging
- fail fast on contention
- implement “already being processed”
- user-facing lock conflict

Java maps lock failure to retry/conflict response.

Not all lock waits should wait indefinitely.

---

## 12. Lock Wait

Lock wait happens when transaction needs lock held by another transaction.

Example:

```text
T1: BEGIN;
T1: UPDATE cases SET status='CLOSED' WHERE id='C1';

T2: UPDATE cases SET priority='HIGH' WHERE id='C1'; -- waits

T1: COMMIT;

T2 proceeds.
```

Symptoms:

- query appears slow
- execution plan looks fine
- DB CPU low
- sessions in wait event lock
- blocked by long transaction

Fix:

- find blocker
- shorten transaction
- add lock timeout
- avoid external calls in transaction
- consistent lock ordering
- reduce batch size
- index predicates to avoid broad locks/checks

---

## 13. Lock Timeout and Statement Timeout

Timeouts protect system.

### 13.1 Lock Timeout

Fail if lock not acquired within time.

Concept:

```sql
SET lock_timeout = '2s';
```

If lock unavailable, statement fails.

### 13.2 Statement Timeout

Fail if statement runs too long.

```sql
SET statement_timeout = '30s';
```

Use in apps/jobs to avoid runaway queries.

Timeout handling must rollback transaction if needed.

In Java, distinguish:

- lock timeout -> maybe retry or conflict
- statement timeout -> maybe query too expensive or load issue
- transaction timeout -> rollback whole operation

---

## 14. Table Locks

Operations can acquire table-level locks.

Examples:

- DDL
- `ALTER TABLE`
- `CREATE INDEX`, depending mode/vendor
- `TRUNCATE`
- some constraints validation
- bulk operations
- vacuum/reindex modes
- explicit `LOCK TABLE`

Table locks can block reads/writes depending lock mode.

Migration must understand lock behavior.

Adding a column may be fast in one DB/version and table-rewriting in another.

Adding constraint may scan table and block writes.

---

## 15. DDL Locks

Schema changes are not free.

Examples:

```sql
ALTER TABLE cases ADD COLUMN new_col TEXT;
ALTER TABLE cases ALTER COLUMN priority SET NOT NULL;
ALTER TABLE cases ADD CONSTRAINT ...;
CREATE INDEX ...
DROP INDEX ...
```

Potential impacts:

- block writes
- block reads
- wait behind long transactions
- hold metadata lock
- generate WAL/redo
- replication lag
- fail if timeout
- leave invalid index if concurrent build fails

Production migrations require planning.

---

## 16. Deadlock

Deadlock is a cycle of waiting locks.

Timeline:

```text
T1 locks case C1.
T2 locks case C2.
T1 tries to lock C2 -> waits for T2.
T2 tries to lock C1 -> waits for T1.
```

Neither can proceed.

Database detects deadlock and aborts one transaction.

Deadlock is not “database bug”; it is concurrency design issue.

---

## 17. Deadlock Example in SQL

Transaction 1:

```sql
BEGIN;

UPDATE cases
SET priority = 'HIGH'
WHERE id = 'C1';

UPDATE cases
SET priority = 'LOW'
WHERE id = 'C2';

COMMIT;
```

Transaction 2:

```sql
BEGIN;

UPDATE cases
SET priority = 'HIGH'
WHERE id = 'C2';

UPDATE cases
SET priority = 'LOW'
WHERE id = 'C1';

COMMIT;
```

If interleaved:

```text
T1 locks C1
T2 locks C2
T1 waits C2
T2 waits C1
deadlock
```

Fix:

```text
Always lock rows in deterministic order.
```

For example, sort IDs before update.

---

## 18. Deadlock Prevention

Techniques:

1. consistent lock order
2. short transactions
3. proper indexes so updates touch fewer rows
4. avoid user/external wait inside transaction
5. batch smaller
6. avoid mixing lock modes unnecessarily
7. use retry for deadlock victim
8. keep transaction logic simple
9. lock parent/entity first for aggregate operations
10. avoid broad scans before updates

Deadlocks can still happen. Application must handle retry where safe.

---

## 19. Deadlock Retry

Deadlock victim transaction is rolled back.

Retry must:

- retry whole transaction
- be idempotent or safe
- use backoff/jitter
- limit attempts
- log metrics
- not repeat external side effect unsafely

Bad:

```java
try {
    updateDatabase();
    sendEmail();
} catch (DeadlockException e) {
    updateDatabaseAgain();
}
```

If email sent before DB failure handling, duplicate side effects possible.

Use outbox/idempotency.

---

## 20. MVCC Snapshots

A snapshot defines which row versions are visible.

At READ COMMITTED:

```text
each statement gets fresh snapshot
```

At REPEATABLE READ:

```text
transaction gets stable snapshot
```

Serializable may track read/write dependencies beyond snapshot.

Snapshot visibility explains:

- why SELECT may not see uncommitted update
- why SELECT can continue while update is in progress
- why long transactions see old data
- why old row versions cannot be cleaned while transactions still need them

---

## 21. Long Transactions and MVCC Cleanup

MVCC creates old row versions.

Cleanup process removes versions no active transaction can see.

Long transaction:

```text
BEGIN;
SELECT ...
-- stays open for hours
```

prevents cleanup of old versions that might be visible to it.

Consequences:

- table bloat
- index bloat
- slower scans
- more disk usage
- vacuum cannot clean
- replication issues
- transaction ID wraparound risk in some DBs
- degraded performance

Long idle-in-transaction sessions are dangerous.

---

## 22. Vacuum / Cleanup Concept

In PostgreSQL, VACUUM cleans dead tuples from MVCC.

Other databases have equivalent cleanup/purge mechanisms.

If cleanup cannot keep up:

- dead rows accumulate
- indexes bloat
- table scans slower
- storage grows
- planner estimates can degrade

Causes:

- heavy update/delete
- long transactions
- disabled/under-tuned autovacuum
- huge batch jobs
- too many indexes
- hot tables

As Java engineer, you must not create long transactions that block cleanup.

---

## 23. Update Creates New Row Version

In MVCC engines, update often creates new row version rather than modifying in place logically.

```sql
UPDATE cases
SET status = 'CLOSED'
WHERE id = :id;
```

May create:

```text
old version: OPEN
new version: CLOSED
```

Indexes may need update if indexed columns changed.

Frequent updates to indexed columns increase:

- write amplification
- dead tuples/versions
- bloat
- vacuum work
- replication traffic

Design mutable vs append-only data carefully.

---

## 24. Hot Rows

A hot row is frequently updated by many transactions.

Examples:

```text
global counter
tenant counter
single queue state row
summary row
configuration row
last_processed_offset row
```

Symptoms:

- lock waits
- deadlocks
- low throughput
- high latency under concurrency

Example:

```sql
UPDATE counters
SET value = value + 1
WHERE name = 'global_case_count';
```

All writers serialize on one row.

Alternatives:

- sharded counters
- async aggregation
- append events and aggregate later
- partition by tenant/time
- approximate counters
- avoid real-time exact count

---

## 25. Queue Tables and Contention

Naive queue:

```sql
SELECT *
FROM jobs
WHERE status = 'PENDING'
ORDER BY created_at
LIMIT 1;

UPDATE jobs SET status = 'PROCESSING' WHERE id = :id;
```

Race-prone.

Better pattern with lock:

```sql
BEGIN;

SELECT id
FROM jobs
WHERE status = 'PENDING'
ORDER BY created_at
LIMIT 1
FOR UPDATE SKIP LOCKED;

UPDATE jobs
SET status = 'PROCESSING',
    locked_at = now(),
    locked_by = :worker_id
WHERE id = :id;

COMMIT;
```

Or atomic update with CTE if supported.

Need handle:

- worker crash
- retry after lock timeout
- max attempts
- poison messages
- ordering/fairness
- index on pending queue
- batch claim

---

## 26. Atomic Claim Pattern

PostgreSQL-style:

```sql
WITH candidate AS (
    SELECT id
    FROM jobs
    WHERE status = 'PENDING'
    ORDER BY created_at, id
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
UPDATE jobs j
SET
    status = 'PROCESSING',
    locked_at = now(),
    locked_by = :worker_id
FROM candidate c
WHERE j.id = c.id
RETURNING j.*;
```

This claims one job atomically.

Index:

```sql
CREATE INDEX idx_jobs_pending_queue
ON jobs (created_at, id)
WHERE status = 'PENDING';
```

This combines partial index + lock skip.

---

## 27. Foreign Keys and Locking

Foreign keys require checks.

Insert child:

```sql
INSERT INTO case_notes(case_id, ...)
VALUES (:case_id, ...);
```

Database must ensure parent case exists.

Delete parent:

```sql
DELETE FROM cases WHERE id = :case_id;
```

Database must check child rows depending FK action.

If child FK column unindexed, parent delete/update can scan child table and hold locks longer.

FK indexes matter for concurrency.

---

## 28. Unique Constraints and Locking

Concurrent insert same unique key:

```text
T1 inserts tenant T / case C-001.
T2 inserts tenant T / case C-001.
```

Unique index coordinates conflict.

One transaction may wait for the other to commit/rollback.

If T1 commits, T2 gets unique violation.

If T1 rolls back, T2 can proceed.

This is database-level concurrency control.

---

## 29. Gap Locks / Next-Key Locks

Some databases use locks on gaps/ranges to prevent phantoms.

MySQL InnoDB under certain isolation levels uses next-key locks for range queries.

Example:

```sql
SELECT *
FROM cases
WHERE case_number BETWEEN 'A' AND 'M'
FOR UPDATE;
```

May lock existing rows and gaps, preventing inserts into range.

This can surprise Java engineers:

- range query blocks inserts
- missing index broadens locks
- isolation level affects behavior
- deadlocks can happen on ranges

Vendor-specific. Always understand target DB.

---

## 30. Predicate Locks / Serializable Conflict Tracking

Serializable isolation may track predicates read by transaction.

If another transaction writes rows that would affect predicate, database may abort one transaction to preserve serializability.

Example:

```text
T1 reads count of active assignments for officer.
T2 inserts assignment.
```

Under serializable, conflict may be detected.

This can produce serialization failure even when no obvious row lock conflict occurs.

Application must retry.

---

## 31. Optimistic Concurrency Control

Optimistic control assumes conflicts are rare.

Pattern:

```sql
UPDATE cases
SET
    status = :new_status,
    version = version + 1
WHERE id = :id
  AND version = :expected_version;
```

If affected rows = 0:

```text
someone changed row
```

Pros:

- avoids holding lock during user think time
- good for form edits
- detects lost update

Cons:

- user may need conflict resolution
- high contention causes many retries/failures
- does not protect all cross-row invariants

---

## 32. Pessimistic Concurrency Control

Pessimistic control locks before working.

```sql
SELECT *
FROM cases
WHERE id = :id
FOR UPDATE;
```

Pros:

- prevents concurrent mutation
- straightforward for critical sections
- can serialize commands per aggregate

Cons:

- blocking
- deadlocks
- transaction must be short
- poor for long user interaction
- connection held

Use when conflicts common or correctness requires serialization.

---

## 33. Isolation + Locking Patterns

### 33.1 Simple State Transition

Use guarded update.

```sql
UPDATE cases
SET status = 'ESCALATED'
WHERE id = :id
  AND status = 'UNDER_REVIEW';
```

### 33.2 Need Old State for History

Use `SELECT FOR UPDATE`.

```sql
SELECT status FROM cases WHERE id = :id FOR UPDATE;
```

### 33.3 Cross-Row Unique Invariant

Use unique/partial unique constraint.

### 33.4 Capacity Constraint

Use locked counter row or serializable transaction.

### 33.5 Range Overlap

Use exclusion constraint, serializable, or domain lock.

### 33.6 Work Queue

Use `FOR UPDATE SKIP LOCKED` or atomic claim.

---

## 34. Lock Granularity

Locks can be at different levels:

```text
row
page/block
table
index key/range
metadata/schema
advisory/domain
predicate/range
database-level in rare operations
```

Higher granularity:

- simpler
- less overhead
- more blocking

Lower granularity:

- more concurrency
- more lock management
- possible deadlocks

Database chooses many locks automatically.

Your query/index design influences lock footprint.

---

## 35. Indexes Reduce Lock Footprint

Update:

```sql
UPDATE cases
SET status = 'CLOSED'
WHERE case_number_normalized = :case_number;
```

If no index, DB scans many rows.

With unique index:

```sql
UNIQUE (tenant_id, case_number_normalized)
```

DB finds one row quickly.

Benefits:

- shorter execution
- fewer rows examined
- fewer locks/less time holding locks
- less chance of blocking/deadlocks

Indexes are concurrency tools too.

---

## 36. Lock Ordering

When locking multiple rows/entities, use deterministic order.

Bad:

```text
request order determines lock order
```

Good:

```text
sort IDs ascending before locking/updating
```

Example transfer workload:

```sql
SELECT *
FROM officers
WHERE id IN (:officer_a, :officer_b)
ORDER BY id
FOR UPDATE;
```

Then update.

Consistent ordering reduces deadlocks.

---

## 37. Lock Escalation

Some databases may escalate many fine-grained locks to table lock under pressure.

SQL Server has lock escalation behavior.

Implication:

- batch update too many rows may lock table
- blocking becomes larger
- index/predicate/batching matter

Vendor-specific but important in enterprise DBs.

Mitigation:

- batch updates
- indexes
- configure escalation carefully
- partitioning
- shorter transactions

---

## 38. Monitoring Locks

Need know:

```text
Who is blocked?
Who is blocking?
What query?
How long?
What lock?
What transaction age?
```

PostgreSQL concepts:

- `pg_stat_activity`
- `pg_locks`
- wait events
- blocking PID functions

SQL Server:

- DMVs
- blocking session id
- deadlock graphs

MySQL:

- performance_schema
- InnoDB status
- metadata locks

Oracle:

- V$ views

As Java engineer, know at least how to ask DBA/SRE for lock graph.

---

## 39. Detecting Idle in Transaction

Bad session state:

```text
idle in transaction
```

Means transaction open but not doing work.

Risks:

- locks held
- MVCC cleanup blocked
- connection occupied
- bloat
- deadlock/blocking

Causes:

- application forgot commit/rollback
- exception path leaked transaction
- manual SQL session
- breakpoint/debugger
- long user workflow inside transaction
- streaming result not consumed/closed

Use timeouts and connection handling.

---

## 40. Java Connection Pool and Transactions

A DB transaction is bound to a connection.

If transaction remains open:

- connection cannot be reused safely
- pool capacity reduced
- other requests wait
- locks may be held

Bad:

```java
@Transactional
public void process() {
    List<Row> rows = repository.findHugeData();
    externalClient.call();
    repository.update();
}
```

This holds connection/transaction during external call.

Keep transaction block minimal.

---

## 41. Open Session in View

In web apps, Open Session in View keeps persistence context open through view rendering.

Risks:

- lazy loading during serialization
- hidden queries after service layer
- transaction/session longer than expected
- N+1 in JSON serialization
- connection usage surprises
- inconsistent boundaries

For high-quality backend design, prefer explicit DTO queries and clear transaction boundaries.

---

## 42. Locking and ORM

JPA supports pessimistic locks:

```java
entityManager.find(Case.class, id, LockModeType.PESSIMISTIC_WRITE);
```

or query hints.

Optimistic:

```java
@Version
```

Caveats:

- know SQL generated
- lock mode may differ by DB dialect
- lock timeout configuration
- fetch joins + locks can lock more than expected
- bulk updates bypass version checks unless handled
- persistence context stale after bulk DML

Always inspect generated SQL for critical locking.

---

## 43. Bulk Updates and Locks

Bulk update:

```sql
UPDATE cases
SET priority = 'HIGH'
WHERE risk_score >= 90;
```

May lock many rows.

Safer batch:

```sql
WITH batch AS (
    SELECT id
    FROM cases
    WHERE risk_score >= 90
      AND priority <> 'HIGH'
    ORDER BY id
    LIMIT 1000
)
UPDATE cases c
SET priority = 'HIGH'
FROM batch b
WHERE c.id = b.id;
```

Repeat until 0.

Benefits:

- shorter locks
- smaller rollback
- less replication lag
- can pause
- less contention

Need index for batch selection.

---

## 44. Locking Read Model Updates

Read model table may be hot.

Example:

```sql
UPDATE case_work_queue_read_model
SET evidence_count = evidence_count + 1
WHERE case_id = :case_id;
```

If many events update same case, row lock contention.

Options:

- event batching
- recompute asynchronously
- idempotent projection
- avoid too many counters
- partition projection
- tolerate eventual consistency
- update only when needed

Projection tables are not free.

---

## 45. Concurrency and Unique Id Generation

Primary key strategy affects contention.

Sequential IDs:

- good locality
- possible hotspot in clustered index
- predictable

Random UUID:

- distributed generation
- less coordination
- can fragment clustered indexes
- larger keys

Time-ordered UUID/ULID-like:

- better locality
- distributed
- still needs careful implementation

Vendor/storage engine matters.

For PostgreSQL heap, random UUID impact differs from InnoDB clustered PK.

Do not blindly copy ID strategy.

---

## 46. Concurrency and Upsert

Upsert:

```sql
INSERT INTO case_external_refs (...)
VALUES (...)
ON CONFLICT (...) DO UPDATE
SET last_seen_at = EXCLUDED.last_seen_at;
```

Concurrent upserts on same key serialize through unique index.

Potential issues:

- hot external key
- update even when no real change
- write amplification
- deadlocks if multiple upserts in different key order
- stale event overwriting newer data

Use conditional update:

```sql
DO UPDATE
SET last_seen_at = EXCLUDED.last_seen_at
WHERE case_external_refs.last_seen_at < EXCLUDED.last_seen_at;
```

Still verify affected behavior.

---

## 47. Concurrency and Counters

Counter updates are atomic:

```sql
UPDATE counters
SET value = value + 1
WHERE id = :id;
```

But under high concurrency, all transactions serialize on same row.

For high-throughput counters:

- sharded counters
- append event log
- approximate counters
- periodic aggregation
- per-tenant/per-bucket counters
- use specialized store if appropriate

Correct atomicity does not imply scalable concurrency.

---

## 48. Concurrency and Materialized Views

Refreshing materialized views may lock or block depending vendor/option.

PostgreSQL:

```sql
REFRESH MATERIALIZED VIEW
```

can block reads unless using concurrent refresh with requirements.

Consider:

- refresh frequency
- lock behavior
- index requirements
- staleness
- refresh duration
- incremental refresh alternative
- read model table instead

Materialized views are operational objects, not just query shortcuts.

---

## 49. Debugging Lock Wait: Workflow

When request is slow:

1. Check if query is active or waiting.
2. Identify wait type.
3. If lock wait, find blocking transaction.
4. Inspect blocker query and transaction age.
5. Determine if blocker is legitimate/long/stuck.
6. Check app endpoint/job owning blocker.
7. Decide mitigation:
   - wait
   - cancel blocked
   - cancel blocker
   - kill session
   - pause job
8. Capture evidence.
9. Fix root cause:
   - shorter transaction
   - indexes
   - batching
   - lock order
   - timeout
   - query rewrite

Do not only optimize plan if problem is blocking.

---

## 50. Debugging Deadlock: Workflow

When deadlock occurs:

1. Get deadlock graph/log.
2. Identify transactions and statements.
3. Identify locks each held and requested.
4. Identify object/row/index involved.
5. Determine lock order.
6. Check missing indexes causing broad locks.
7. Check batch size.
8. Add deterministic ordering or reduce transaction scope.
9. Add retry for victim transaction.
10. Add metrics/alert if frequent.

Deadlock logs are gold. Preserve them.

---

## 51. Deadlock from Missing Index

Foreign key example:

Parent delete:

```sql
DELETE FROM cases WHERE id = :id;
```

Child table:

```sql
case_notes(case_id)
```

If `case_notes.case_id` not indexed, DB may scan child table to check references.

Under concurrent writes/deletes, broad scans/locks can contribute to blocking/deadlock.

Fix:

```sql
CREATE INDEX idx_case_notes_case_id
ON case_notes (case_id);
```

FK indexes reduce both time and lock footprint.

---

## 52. Designing for Low Contention

Principles:

- keep transactions short
- avoid hot rows
- avoid global counters
- use append-only events for high-write logs
- index predicates used by updates
- batch large writes
- lock in deterministic order
- use constraints for invariants
- prefer guarded update for simple transitions
- use optimistic locking for rare conflicts
- use pessimistic locking for high-contention critical sections
- avoid external calls in transaction
- design idempotency
- monitor lock waits

Concurrency is design, not afterthought.

---

## 53. Mini Case Study: Concurrent Close Case

Two requests close same case.

Option A: idempotent close.

```sql
UPDATE cases
SET
    status = 'CLOSED',
    closed_at = COALESCE(closed_at, :closed_at)
WHERE id = :case_id
  AND status <> 'CLOSED';
```

If first updates, second affected rows = 0.

Application can read current state and return success if already closed.

Option B: conflict close.

```sql
UPDATE cases
SET status = 'CLOSED',
    closed_at = :closed_at
WHERE id = :case_id
  AND status IN ('OPEN', 'UNDER_REVIEW');
```

Second gets 0 and returns conflict.

Choose semantics.

---

## 54. Mini Case Study: Current Primary Assignment

Invariant:

```text
one active primary assignment
```

Implementation:

```sql
CREATE UNIQUE INDEX uq_active_primary_assignment
ON case_assignments (tenant_id, case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

Reassign transaction:

```sql
BEGIN;

UPDATE case_assignments
SET
    ended_at = :now,
    ended_by = :user_id
WHERE tenant_id = :tenant_id
  AND case_id = :case_id
  AND assignment_role = 'PRIMARY'
  AND ended_at IS NULL;

INSERT INTO case_assignments (
    id,
    tenant_id,
    case_id,
    officer_id,
    assignment_role,
    assigned_at,
    assigned_by
)
VALUES (
    :id,
    :tenant_id,
    :case_id,
    :officer_id,
    'PRIMARY',
    :now,
    :user_id
);

COMMIT;
```

Concurrent reassignments can conflict. Unique constraint protects final invariant. Locking case row first may serialize business command more clearly.

---

## 55. Mini Case Study: Worker Queue with SKIP LOCKED

```sql
WITH next_jobs AS (
    SELECT id
    FROM jobs
    WHERE status = 'PENDING'
      AND run_at <= now()
    ORDER BY run_at, id
    LIMIT 10
    FOR UPDATE SKIP LOCKED
)
UPDATE jobs j
SET
    status = 'PROCESSING',
    locked_at = now(),
    locked_by = :worker_id
FROM next_jobs nj
WHERE j.id = nj.id
RETURNING j.*;
```

Index:

```sql
CREATE INDEX idx_jobs_pending_run
ON jobs (run_at, id)
WHERE status = 'PENDING';
```

This lets multiple workers claim batches concurrently.

Need recovery:

```sql
UPDATE jobs
SET status = 'PENDING',
    locked_at = NULL,
    locked_by = NULL
WHERE status = 'PROCESSING'
  AND locked_at < now() - INTERVAL '10 minutes';
```

with attempt limits.

---

## 56. Mini Case Study: Long Transaction Incident

Symptoms:

```text
autovacuum not cleaning
table bloat growing
queries slower
one session idle in transaction for 4 hours
```

Root cause:

```text
application opened transaction and waited on external API / leaked transaction
```

Fix:

- cancel/terminate session if safe
- fix code boundary
- add transaction timeout
- add monitoring for idle in transaction
- avoid external calls inside transaction
- ensure try/finally rollback/close
- configure pool leak detection

---

## 57. Practical Exercises

### Exercise 1 — Identify Deadlock

Transactions update two cases in opposite order. Explain deadlock and fix with sorted lock order.

### Exercise 2 — Choose Lock Strategy

Requirement:

```text
Need old status to write transition history.
```

Use:

```sql
SELECT status FROM cases WHERE id = :id FOR UPDATE;
```

inside short transaction.

### Exercise 3 — Queue Claim

Write atomic claim using `FOR UPDATE SKIP LOCKED`.

### Exercise 4 — Detect Hot Row

Counter row updated by every request. Explain contention and propose sharded/event aggregation alternative.

### Exercise 5 — FK Index

Explain why child FK index helps parent delete/update and reduces lock duration.

---

## 58. Locking and MVCC Checklist

```text
[ ] What rows can this transaction lock?
[ ] How long are locks held?
[ ] Is transaction doing external IO?
[ ] Are update/delete predicates indexed?
[ ] Are FK child columns indexed?
[ ] Is lock order deterministic?
[ ] Could this create deadlock?
[ ] Is lock timeout configured?
[ ] Is retry safe?
[ ] Are long transactions monitored?
[ ] Does MVCC cleanup get blocked?
[ ] Is there a hot row?
[ ] Is optimistic or pessimistic locking appropriate?
[ ] Are constraints enforcing invariants?
[ ] Are batch writes limited?
[ ] Are queue workers using safe claim pattern?
```

---

## 59. Koneksi ke Part Berikutnya

Part ini membahas concurrency mechanics: locking, MVCC, deadlocks, and contention.

Part berikutnya, `part-021`, akan membahas database-side logic:

- stored procedures
- functions
- triggers
- when database-side logic helps
- when it hurts
- audit triggers
- generated columns
- business logic placement
- Java vs SQL boundaries
- migration/testing concerns

Setelah memahami transaksi dan locking, kita bisa menilai kapan logic sebaiknya berada di database dan kapan sebaiknya tetap di application layer.

---

## 60. Ringkasan Bagian Ini

Hal penting dari part 020:

1. Locking dan MVCC adalah mekanisme utama concurrency control.
2. MVCC memungkinkan reader melihat snapshot tanpa selalu memblokir writer.
3. MVCC tidak menghilangkan kebutuhan lock.
4. UPDATE/DELETE mengambil row locks.
5. Normal SELECT biasanya tidak mengunci row untuk update.
6. `SELECT FOR UPDATE` mengunci row untuk read-modify-write.
7. `SKIP LOCKED` berguna untuk worker queue.
8. Lock wait berbeda dari slow execution.
9. Table/DDL locks penting untuk migration safety.
10. Deadlock terjadi karena cycle of waits dan harus di-retry dari awal transaksi.
11. Consistent lock order mengurangi deadlock.
12. Long transactions menghambat MVCC cleanup dan menyebabkan bloat.
13. Index mengurangi lock footprint.
14. Foreign key child indexes penting untuk concurrency.
15. Unique constraints mengkoordinasikan concurrent inserts.
16. Gap/predicate locks adalah vendor-specific tetapi penting untuk range invariants.
17. Optimistic locking cocok untuk konflik jarang.
18. Pessimistic locking cocok untuk high-contention critical sections.
19. Hot rows membatasi throughput meskipun update atomic.
20. Production debugging harus membedakan lock wait, deadlock, slow plan, and app-side pool contention.

Kalimat inti:

> Concurrency bug dan contention performance sering berasal dari hal yang sama: transaksi menyentuh data yang sama tanpa boundary, lock order, index, dan invariant enforcement yang dirancang dengan sadar.

---

## 61. Referensi

1. PostgreSQL Documentation — Explicit Locking.  
   https://www.postgresql.org/docs/current/explicit-locking.html

2. PostgreSQL Documentation — Transaction Isolation.  
   https://www.postgresql.org/docs/current/transaction-iso.html

3. PostgreSQL Documentation — MVCC.  
   https://www.postgresql.org/docs/current/mvcc.html

4. PostgreSQL Documentation — Routine Vacuuming.  
   https://www.postgresql.org/docs/current/routine-vacuuming.html

5. PostgreSQL Documentation — Monitoring Database Activity.  
   https://www.postgresql.org/docs/current/monitoring.html

6. MySQL 8.4 Reference Manual — InnoDB Locking.  
   https://dev.mysql.com/doc/refman/8.4/en/innodb-locking.html

7. MySQL 8.4 Reference Manual — InnoDB Transaction Model.  
   https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-model.html

8. SQL Server Documentation — Transaction Locking and Row Versioning Guide.  
   https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide

9. Oracle Database Concepts — Data Concurrency and Consistency.  
   https://docs.oracle.com/en/database/oracle/oracle-database/23/cncpt/data-concurrency-and-consistency.html

10. Spring Framework Documentation — Transaction Management.  
    https://docs.spring.io/spring-framework/reference/data-access/transaction.html

---

## 62. Status Seri

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
- `learn-sql-mastery-for-java-engineers-part-020.md`

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-021.md` — Stored Procedures, Functions, Triggers, and Database-Side Logic


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-019.md">⬅️ Part 19 — Transactions: ACID, Isolation, Anomalies, and Real Consistency</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-021.md">Part 21 — Stored Procedures, Functions, Triggers, and Database-Side Logic ➡️</a>
</div>
