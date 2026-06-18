# learn-java-concurrency-and-reactive-part-025.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 025  
# Database, Transactions, Connection Pools, and Concurrent Access: JDBC Blocking, Isolation, Locks, Pool Sizing, Timeouts, Retries, and Virtual Thread Migration

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **025**  
> Fokus: memahami interaksi antara concurrency Java dan database. Kita akan membahas JDBC sebagai blocking I/O, connection pool sebagai capacity boundary, transaksi, isolation level, locking, row contention, deadlock, optimistic/pessimistic locking, transaction propagation Spring, timeouts, retries, idempotency, virtual threads, pool starvation, observability, testing, dan production strategy.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Database adalah Shared Concurrent System](#2-mental-model-database-adalah-shared-concurrent-system)
3. [JDBC Blocking Model](#3-jdbc-blocking-model)
4. [Connection sebagai Resource Mahal](#4-connection-sebagai-resource-mahal)
5. [Connection Pool sebagai Capacity Boundary](#5-connection-pool-sebagai-capacity-boundary)
6. [Pool Size Bukan Sekadar Angka Besar](#6-pool-size-bukan-sekadar-angka-besar)
7. [Connection Acquisition Timeout](#7-connection-acquisition-timeout)
8. [Query Timeout dan Network Timeout](#8-query-timeout-dan-network-timeout)
9. [Transaction Fundamentals](#9-transaction-fundamentals)
10. [ACID dan Concurrency](#10-acid-dan-concurrency)
11. [Isolation Levels](#11-isolation-levels)
12. [Read Phenomena](#12-read-phenomena)
13. [MVCC Mental Model](#13-mvcc-mental-model)
14. [Row Locks and Lock Waits](#14-row-locks-and-lock-waits)
15. [Deadlocks in Database](#15-deadlocks-in-database)
16. [Optimistic Locking](#16-optimistic-locking)
17. [Pessimistic Locking](#17-pessimistic-locking)
18. [Lost Update](#18-lost-update)
19. [Idempotency and Retries](#19-idempotency-and-retries)
20. [Spring `@Transactional`](#20-spring-transactional)
21. [Propagation](#21-propagation)
22. [Transaction Timeout](#22-transaction-timeout)
23. [Read-Only Transactions](#23-readonly-transactions)
24. [Transaction Boundary Design](#24-transaction-boundary-design)
25. [Do Not Hold Transaction While Calling Remote Service](#25-do-not-hold-transaction-while-calling-remote-service)
26. [Connection Pool Starvation](#26-connection-pool-starvation)
27. [Virtual Threads and JDBC](#27-virtual-threads-and-jdbc)
28. [Virtual Threads Migration Risk](#28-virtual-threads-migration-risk)
29. [Bulkheads for DB Access](#29-bulkheads-for-db-access)
30. [Backpressure and Admission Control](#30-backpressure-and-admission-control)
31. [N+1 Query and Concurrency Amplification](#31-n1-query-and-concurrency-amplification)
32. [Batching and Bulk Operations](#32-batching-and-bulk-operations)
33. [Pagination, Streaming, and Cursor Risks](#33-pagination-streaming-and-cursor-risks)
34. [Concurrency-Safe Repository Design](#34-concurrencysafe-repository-design)
35. [Outbox and Transactional Messaging](#35-outbox-and-transactional-messaging)
36. [Observability](#36-observability)
37. [Testing Concurrent Database Code](#37-testing-concurrent-database-code)
38. [Load Testing DB Concurrency](#38-load-testing-db-concurrency)
39. [Mini Case Study: Virtual Threads Expose DB Pool Bottleneck](#39-mini-case-study-virtual-threads-expose-db-pool-bottleneck)
40. [Mini Case Study: Account Transfer Lost Update](#40-mini-case-study-account-transfer-lost-update)
41. [Mini Case Study: Remote Call Inside Transaction](#41-mini-case-study-remote-call-inside-transaction)
42. [Common Anti-Patterns](#42-common-antipatterns)
43. [Best Practices](#43-best-practices)
44. [Decision Matrix](#44-decision-matrix)
45. [Latihan](#45-latihan)
46. [Ringkasan](#46-ringkasan)
47. [Referensi](#47-referensi)

---

# 1. Tujuan Bagian Ini

Database adalah salah satu bottleneck terbesar dalam aplikasi concurrent.

Di sisi Java, kita punya:

```text
threads
virtual threads
executors
requests
transactions
connection pool
JDBC calls
repository methods
```

Di sisi database, kita punya:

```text
connections
transactions
locks
MVCC snapshots
isolation levels
indexes
queries
row versions
deadlocks
disk/CPU/memory
```

Kesalahan umum:

```text
Aplikasi ditingkatkan concurrency-nya,
tetapi database capacity tidak berubah.
```

Contoh:

- enable virtual threads;
- request concurrency naik;
- semua request menunggu connection pool;
- DB CPU naik;
- lock wait naik;
- retry storm;
- p99 latency memburuk.

Target bagian ini:

```text
Mampu memahami database sebagai shared concurrent resource,
mendesain transaction boundary yang pendek,
mengatur connection pool dan timeout,
mencegah lock contention/deadlock,
dan memakai virtual threads tanpa menghancurkan database.
```

---

# 2. Mental Model: Database adalah Shared Concurrent System

Database bukan sekadar storage.

Database adalah concurrent system yang:

- menerima banyak connections;
- menjalankan banyak transactions;
- menjaga isolation;
- mengatur locks;
- mengoptimasi query;
- menulis WAL/redo log;
- menjaga consistency;
- melakukan MVCC/versioning;
- mengatur memory/cache.

## 2.1 Java concurrency meets DB concurrency

Java thread concurrency:

```text
how many application tasks call DB
```

Database concurrency:

```text
how many transactions/queries DB can safely and efficiently run
```

Jika Java concurrency lebih besar dari DB capacity:

```text
queueing, lock wait, timeout, retries, collapse
```

## 2.2 Main rule

```text
The database is not a passive dependency.
It is a concurrent subsystem with its own capacity, locks, and scheduling.
```

---

# 3. JDBC Blocking Model

JDBC is traditionally blocking.

```java
try (Connection connection = dataSource.getConnection();
     PreparedStatement ps = connection.prepareStatement(sql);
     ResultSet rs = ps.executeQuery()) {
    ...
}
```

When `executeQuery()` waits:

- current thread waits;
- connection is occupied;
- transaction may hold locks/snapshot;
- DB is doing work or waiting.

## 3.1 Platform thread

Blocking JDBC occupies platform thread.

## 3.2 Virtual thread

Blocking JDBC can be handled more cheaply from Java thread perspective, but:

- connection still occupied;
- DB still doing work;
- locks still held;
- transaction still open.

## 3.3 Main rule

```text
Virtual threads reduce Java-side blocking cost.
They do not reduce JDBC connection or database-side cost.
```

---

# 4. Connection sebagai Resource Mahal

A database connection is not just a socket.

It can involve:

- authentication/session;
- memory;
- server process/thread or backend state;
- transaction state;
- prepared statement cache;
- network resources.

Creating new connection per request is expensive.

Hence connection pool.

## 4.1 Main rule

```text
Connections are scarce resources. Treat them as capacity permits.
```

---

# 5. Connection Pool sebagai Capacity Boundary

Connection pool controls how many application operations can use DB concurrently.

Example:

```text
maximumPoolSize = 50
```

At most 50 active DB connections from this app instance.

If 500 request threads need DB:

```text
50 active
450 waiting for connection
```

## 5.1 Pool wait is backpressure

Waiting for connection means DB capacity is saturated or pool is too small/slow/leaking.

## 5.2 Main rule

```text
Connection pool is one of the most important concurrency controls in a Java web app.
```

---

# 6. Pool Size Bukan Sekadar Angka Besar

Increasing pool size is not always good.

If DB can efficiently handle 50 concurrent queries, setting pool to 500 may:

- increase DB CPU contention;
- increase lock contention;
- increase memory usage;
- reduce cache locality;
- increase query latency;
- cause DB meltdown.

## 6.1 Better question

Not:

```text
How many Java threads do I have?
```

But:

```text
How many concurrent DB operations can the database handle while meeting latency SLO?
```

## 6.2 Main rule

```text
Pool size should reflect database capacity and workload, not application thread count.
```

---

# 7. Connection Acquisition Timeout

Connection acquisition timeout limits how long app waits for pool connection.

Example HikariCP property concept:

```properties
spring.datasource.hikari.connection-timeout=250ms
```

If pool full and timeout exceeded:

```text
fail fast
```

## 7.1 Why important

Without bounded wait:

- request waits too long;
- upstream timeout happens first;
- threads/virtual threads pile up;
- user sees poor latency;
- retry may amplify load.

## 7.2 Main rule

```text
Connection wait must be bounded by request deadline.
```

---

# 8. Query Timeout dan Network Timeout

JDBC `Statement.setQueryTimeout(seconds)` limits how long a statement execution may run.

Java JDBC docs state that by default there is no limit for a running statement to complete; if the query timeout is exceeded, `SQLTimeoutException` is thrown.

## 8.1 Query timeout

```java
PreparedStatement ps = connection.prepareStatement(sql);
ps.setQueryTimeout(2); // seconds
```

## 8.2 Network timeout

`Connection.setNetworkTimeout(...)` controls network-level timeout for database operations at connection level.

## 8.3 Driver differences

Behavior can vary by JDBC driver/database.

Always test.

## 8.4 Main rule

```text
Use query, transaction, connection, and request timeouts together.
Do not rely on one timeout to solve all waits.
```

---

# 9. Transaction Fundamentals

Transaction groups operations into atomic unit.

```java
begin
  update A
  insert B
  delete C
commit
```

If fail:

```java
rollback
```

## 9.1 Transaction duration

Duration matters.

Long transaction can:

- hold locks;
- retain MVCC snapshots;
- block vacuum/cleanup depending DB;
- increase deadlock chance;
- keep connection occupied.

## 9.2 Main rule

```text
Short transactions are concurrency-friendly transactions.
```

---

# 10. ACID dan Concurrency

ACID:

## 10.1 Atomicity

All or nothing.

## 10.2 Consistency

Constraints/invariants preserved.

## 10.3 Isolation

Concurrent transactions do not break correctness.

## 10.4 Durability

Committed data survives crash.

## 10.5 Concurrency trade-off

Higher isolation often means more coordination/retries/locking.

## 10.6 Main rule

```text
Isolation is where database correctness and concurrency performance meet.
```

---

# 11. Isolation Levels

Common JDBC isolation levels:

- READ_UNCOMMITTED;
- READ_COMMITTED;
- REPEATABLE_READ;
- SERIALIZABLE.

Actual behavior depends on database.

## 11.1 READ COMMITTED

Each statement sees committed data at statement start in many databases.

## 11.2 REPEATABLE READ

Transaction sees stable snapshot for repeated reads in many MVCC systems.

## 11.3 SERIALIZABLE

Aims to behave like transactions executed serially.

May abort/retry transactions under conflict.

## 11.4 Main rule

```text
Choose isolation based on anomaly tolerance, not habit.
```

---

# 12. Read Phenomena

## 12.1 Dirty read

Read uncommitted data.

## 12.2 Non-repeatable read

Same row read twice gives different committed value.

## 12.3 Phantom read

Same predicate query returns different set of rows.

## 12.4 Lost update

Two transactions update based on stale read and one overwrites another.

## 12.5 Write skew

Two transactions individually valid but jointly violate invariant.

## 12.6 Main rule

```text
Isolation level determines which anomalies your application must handle.
```

---

# 13. MVCC Mental Model

Many databases use MVCC: multi-version concurrency control.

Readers can see snapshot while writers create new versions.

## 13.1 Benefit

Reads often do not block writes and writes often do not block reads.

## 13.2 But writes still conflict

Concurrent updates to same row may lock/conflict.

## 13.3 Main rule

```text
MVCC reduces read/write blocking, but it does not remove write conflicts or transaction anomalies.
```

---

# 14. Row Locks and Lock Waits

When updating row:

```sql
UPDATE account SET balance = balance - 100 WHERE id = ?;
```

DB may lock row.

Another transaction updating same row waits.

## 14.1 Lock wait symptoms

- query slow only under concurrency;
- DB lock wait metrics high;
- app request timeout;
- deadlock errors;
- p99 spikes.

## 14.2 Prevention

- short transactions;
- consistent update order;
- proper indexes;
- avoid hot rows;
- optimistic locking;
- retry transient conflicts;
- avoid remote calls while transaction open.

## 14.3 Main rule

```text
Most database concurrency pain is transaction duration × contention.
```

---

# 15. Deadlocks in Database

DB deadlock:

```text
Tx1 locks row A, waits row B
Tx2 locks row B, waits row A
```

Database often detects and aborts one transaction.

## 15.1 Application should retry?

Usually yes for transient deadlock victim, if operation is idempotent/safe.

## 15.2 Avoid

- consistent row ordering;
- small transactions;
- proper indexes;
- avoid many locks in arbitrary order.

## 15.3 Main rule

```text
Database deadlock should be treated as transient failure with safe retry and root-cause analysis.
```

---

# 16. Optimistic Locking

Optimistic locking assumes conflicts rare.

Use version column:

```sql
UPDATE case_record
SET status = ?, version = version + 1
WHERE id = ? AND version = ?;
```

If updated rows = 0:

```text
someone else changed it
```

## 16.1 Good

- avoids long lock hold;
- scalable for low conflict;
- detects lost update.

## 16.2 Bad

- high conflict causes retries;
- user conflict handling needed.

## 16.3 Main rule

```text
Optimistic locking is best when conflicts are rare and retry/user resolution is acceptable.
```

---

# 17. Pessimistic Locking

Pessimistic locking locks before work.

Example:

```sql
SELECT * FROM case_record WHERE id = ? FOR UPDATE;
```

## 17.1 Good

- prevents concurrent modification while transaction open;
- useful for high-conflict critical sections.

## 17.2 Bad

- blocks others;
- deadlock risk;
- lock wait;
- transaction must be short.

## 17.3 Main rule

```text
Pessimistic locking is a concurrency control tool, but long locked transactions are scalability hazards.
```

---

# 18. Lost Update

Lost update example:

```text
balance = 100
Tx1 reads 100
Tx2 reads 100
Tx1 writes 80
Tx2 writes 70
final = 70, Tx1 update lost
```

## 18.1 Fix

- atomic SQL update;
- optimistic lock version;
- higher isolation;
- row lock;
- database constraint.

Example atomic:

```sql
UPDATE account
SET balance = balance - ?
WHERE id = ? AND balance >= ?;
```

## 18.2 Main rule

```text
Do not implement read-modify-write without concurrency control.
```

---

# 19. Idempotency and Retries

Retries are needed for:

- deadlocks;
- serialization failures;
- transient connection issues;
- timeout maybe if safe;
- optimistic conflicts maybe depending semantics.

But retry can duplicate side effects.

## 19.1 Idempotency key

For commands:

```text
request_id / command_id / idempotency_key
```

Store processed command.

## 19.2 Retry budget

- max attempts;
- backoff;
- jitter;
- deadline aware.

## 19.3 Main rule

```text
Only retry operations whose side effects are idempotent or safely deduplicated.
```

---

# 20. Spring `@Transactional`

Spring `@Transactional` defines transaction metadata.

Default settings in Spring documentation include:

- propagation `REQUIRED`;
- isolation `DEFAULT`;
- read-write;
- transaction timeout defaults to underlying transaction system default.

## 20.1 Proxy boundary

`@Transactional` typically works through proxy.

Self-invocation can bypass proxy.

```java
this.innerTransactionalMethod(); // may not start new transaction
```

## 20.2 Main rule

```text
@Transactional is a boundary declaration. Know where the proxy boundary actually is.
```

---

# 21. Propagation

Common propagation:

## 21.1 REQUIRED

Join existing transaction or create new.

## 21.2 REQUIRES_NEW

Suspend existing and start new transaction.

Uses another connection often.

Danger: can exhaust pool if outer transactions hold connections.

## 21.3 SUPPORTS

Join if exists, otherwise non-transactional.

## 21.4 MANDATORY

Must have existing transaction.

## 21.5 NOT_SUPPORTED

Run without transaction.

## 21.6 NESTED

Savepoint-based nested transaction if supported.

## 21.7 Spring nuance

Spring docs note that by default a participating transaction joins the outer scope and may silently ignore local isolation, timeout, or read-only declaration unless validation is enabled.

## 21.8 Main rule

```text
Transaction propagation affects connection usage, lock duration, and rollback semantics.
```

---

# 22. Transaction Timeout

Spring `@Transactional(timeout = ...)` can define transaction timeout.

But actual enforcement depends on transaction manager and underlying resources.

Also set DB/JDBC query timeout.

## 22.1 Deadline hierarchy

```text
request deadline
  >= transaction timeout
      >= query timeout
          >= lock wait timeout
```

## 22.2 Main rule

```text
Transaction timeout should be shorter than request timeout and coordinated with query timeouts.
```

---

# 23. Read-Only Transactions

Read-only transaction can signal optimization.

```java
@Transactional(readOnly = true)
public CaseView loadCase(...) { ... }
```

## 23.1 Benefits

Depending DB/driver/framework:

- avoid dirty checking;
- optimize transaction behavior;
- documentation of intent.

## 23.2 Not security

Read-only is not always a hard prevention of writes unless DB enforces.

## 23.3 Main rule

```text
Use readOnly to express intent and enable optimization, but do not rely on it as sole write protection.
```

---

# 24. Transaction Boundary Design

Good transaction boundary:

```java
@Transactional
public void approveCase(Command command) {
    Case c = repository.lockOrLoad(command.caseId());
    c.approve(command.user());
    repository.save(c);
}
```

Bad:

```java
@Transactional
public void approveCase(Command command) {
    Case c = repository.load(command.caseId());
    remotePermissionClient.check(...); // remote call while tx open
    c.approve(...);
    repository.save(c);
}
```

## 24.1 Boundary should include

- data read/write that must be atomic;
- local invariant enforcement;
- outbox insert if event needed.

## 24.2 Boundary should exclude

- slow remote calls;
- user think time;
- file upload/download;
- long CPU reports;
- waiting on external queue.

## 24.3 Main rule

```text
Transaction should cover the minimal database work required for consistency.
```

---

# 25. Do Not Hold Transaction While Calling Remote Service

Remote calls are unpredictable:

- slow;
- timeout;
- retry;
- network partition;
- downstream overloaded.

If transaction remains open:

- connection occupied;
- locks held;
- MVCC snapshot held;
- deadlock chance increases;
- pool starvation.

## 25.1 Alternative

Do remote call before transaction if possible.

Or:

1. transaction writes command/outbox;
2. commit;
3. async worker calls remote service.

## 25.2 Main rule

```text
Never casually hold DB transaction across remote I/O.
```

---

# 26. Connection Pool Starvation

Pool starvation:

```text
all connections active
many requests waiting
```

Causes:

- slow queries;
- long transactions;
- connection leak;
- pool too small;
- DB overloaded;
- too much app concurrency;
- `REQUIRES_NEW` nesting;
- streaming result sets held open;
- remote call inside transaction.

## 26.1 Symptoms

- connection acquisition timeout;
- pending connection wait high;
- active connections at max;
- DB CPU maybe high or maybe lock wait;
- request p99 high.

## 26.2 Main rule

```text
Pool starvation is usually fixed by reducing connection hold time and concurrency pressure, not blindly increasing pool size.
```

---

# 27. Virtual Threads and JDBC

Virtual threads make blocking JDBC code easier to scale on Java side.

Good:

```text
many requests can block waiting for DB without occupying platform thread
```

But dangerous if:

```text
many more requests now reach DB pool
```

## 27.1 Correct mental model

```text
virtual threads remove thread bottleneck
connection pool remains DB bottleneck
```

## 27.2 Main rule

```text
With virtual threads, the connection pool becomes even more important as a concurrency governor.
```

---

# 28. Virtual Threads Migration Risk

Before migration:

```text
server thread pool = 200
DB pool = 50
```

After migration:

```text
thousands of virtual-thread requests
DB pool still = 50
```

Potential:

- 50 active DB ops;
- thousands waiting for connection;
- memory grows;
- request timeouts;
- retries;
- queue collapse.

## 28.1 Fix before enabling

- DB bulkhead;
- connection timeout;
- request admission;
- query timeout;
- per-endpoint limit;
- load test.

## 28.2 Main rule

```text
Virtual thread migration must include DB capacity migration plan.
```

---

# 29. Bulkheads for DB Access

Use semaphore to limit DB-heavy operations.

```java
final class DbBulkhead {
    private final Semaphore permits;

    DbBulkhead(int maxConcurrent) {
        this.permits = new Semaphore(maxConcurrent);
    }

    <T> T call(Callable<T> operation, Duration wait) throws Exception {
        if (!permits.tryAcquire(wait.toMillis(), TimeUnit.MILLISECONDS)) {
            throw new ServiceBusyException("DB bulkhead full");
        }

        try {
            return operation.call();
        } finally {
            permits.release();
        }
    }
}
```

## 29.1 Why additional to pool?

Pool protects DB connections globally.

Bulkhead can protect:

- expensive endpoint;
- tenant;
- specific repository;
- background job.

## 29.2 Main rule

```text
Connection pool is global capacity; bulkheads provide workload-specific protection.
```

---

# 30. Backpressure and Admission Control

At web entry:

```java
if (!expensiveEndpoint.tryAcquire(10, TimeUnit.MILLISECONDS)) {
    return 503;
}
```

For batch/job:

```text
limit in-flight DB chunks
```

For queue:

```text
bounded queue before DB writer
```

## 30.1 Main rule

```text
Do not let unlimited application work queue in front of a finite DB.
```

---

# 31. N+1 Query and Concurrency Amplification

N+1:

```text
1 query for list
N queries for each item
```

Under concurrency:

```text
100 requests × 101 queries = 10,100 queries
```

Virtual threads can make this worse by allowing more concurrent waiting.

## 31.1 Fix

- join fetch;
- batch fetch;
- query projection;
- IN query;
- data loader;
- cache;
- read model.

## 31.2 Main rule

```text
N+1 is not just inefficiency; under concurrency it is load amplification.
```

---

# 32. Batching and Bulk Operations

Batching reduces round trips.

Example:

```sql
SELECT * FROM case_record WHERE id IN (?, ?, ...)
```

Bulk update:

```sql
UPDATE case_record SET status = ? WHERE id = ANY(?)
```

## 32.1 Caution

Very large batch can:

- lock many rows;
- create long transaction;
- increase rollback cost;
- cause timeout.

## 32.2 Main rule

```text
Batch to reduce round trips, but chunk to keep transactions bounded.
```

---

# 33. Pagination, Streaming, and Cursor Risks

Streaming result sets can reduce memory but hold connection longer.

## 33.1 Risk

Long stream:

- connection occupied;
- transaction open;
- locks/snapshot held;
- pool starvation.

## 33.2 Alternatives

- keyset pagination;
- chunk processing;
- read-only transaction with limit;
- copy/export path.

## 33.3 Main rule

```text
Streaming trades memory for connection hold time. Measure both.
```

---

# 34. Concurrency-Safe Repository Design

Repository should:

- use parameterized SQL;
- keep query count bounded;
- expose timeout behavior;
- avoid hidden N+1;
- not perform remote calls;
- avoid long transaction;
- support optimistic version checks;
- return immutable DTO/read model when possible.

## 34.1 Command repository

For writes, return affected rows and detect conflicts.

```java
int updated = jdbc.update(sql, ...);
if (updated == 0) {
    throw new OptimisticLockException();
}
```

## 34.2 Main rule

```text
Repository concurrency correctness is about SQL semantics, transaction boundary, and conflict detection.
```

---

# 35. Outbox and Transactional Messaging

Problem:

```text
update DB and publish message atomically
```

Bad:

```java
@Transactional
void approve() {
    repository.approve();
    kafka.send(event); // remote inside transaction or non-atomic
}
```

Better:

```java
@Transactional
void approve() {
    repository.approve();
    outboxRepository.insert(event);
}
```

Then separate publisher reads outbox after commit.

## 35.1 Main rule

```text
Use outbox to coordinate DB transaction and external messaging without distributed transaction.
```

---

# 36. Observability

Track:

## 36.1 Pool

- active;
- idle;
- max;
- pending;
- acquisition time;
- timeout count;
- leak detection.

## 36.2 Query

- duration;
- rows read/written;
- slow query;
- plan changes;
- index usage.

## 36.3 Transaction

- duration;
- rollback count;
- deadlock/serialization failure;
- lock wait;
- isolation level.

## 36.4 App

- endpoint DB calls per request;
- N+1 count;
- DB bulkhead wait/rejection;
- retry attempts;
- connection errors.

## 36.5 Main rule

```text
If you do not measure connection wait and transaction duration, you cannot understand DB concurrency.
```

---

# 37. Testing Concurrent Database Code

Test:

## 37.1 Lost update

Two concurrent updates on same row.

## 37.2 Optimistic lock

Second update fails.

## 37.3 Deadlock retry

Simulate reversed lock order.

## 37.4 Transaction rollback

Failure rolls back all changes.

## 37.5 Propagation

`REQUIRES_NEW` behavior.

## 37.6 Pool exhaustion

Small test pool and many concurrent requests.

## 37.7 Timeout

Slow query/lock wait timeout.

## 37.8 Main rule

```text
Database concurrency tests need real database behavior, not only mocks.
```

---

# 38. Load Testing DB Concurrency

Load test with:

- realistic pool size;
- realistic data distribution;
- hot rows;
- slow query;
- transaction mix;
- read/write ratio;
- virtual threads on/off;
- retry policy.

Measure:

- throughput;
- p99;
- pool wait;
- query duration;
- lock wait;
- DB CPU;
- deadlocks;
- timeouts;
- retry amplification.

## 38.1 Main rule

```text
DB concurrency capacity must be measured under realistic contention.
```

---

# 39. Mini Case Study: Virtual Threads Expose DB Pool Bottleneck

## 39.1 Before

```text
200 Tomcat platform threads
50 DB connections
```

Thread pool limited concurrency.

## 39.2 After

```text
virtual threads enabled
2,000 concurrent requests
same DB pool
```

## 39.3 Symptoms

- connection acquisition timeout;
- DB bulkhead full;
- request p99 worse;
- retries increase;
- DB CPU/lock wait high.

## 39.4 Fix

- cap expensive endpoint concurrency;
- keep DB pool around measured capacity;
- query timeout;
- optimize slow queries;
- reduce N+1;
- use read replicas/read model if needed.

## 39.5 Lesson

```text
Virtual threads reveal the real bottleneck. Often it is the database.
```

---

# 40. Mini Case Study: Account Transfer Lost Update

## 40.1 Broken

```java
Account from = repository.find(fromId);
Account to = repository.find(toId);

from.debit(amount);
to.credit(amount);

repository.save(from);
repository.save(to);
```

Concurrent transfers can conflict.

## 40.2 Fix options

- transaction + row locks ordered by account ID;
- atomic SQL updates with constraints;
- optimistic version;
- serializable transaction with retry.

## 40.3 Lesson

```text
Financial-style updates need explicit concurrency control, not just @Transactional.
```

---

# 41. Mini Case Study: Remote Call Inside Transaction

## 41.1 Broken

```java
@Transactional
void submitApplication(Command command) {
    Application app = repository.create(command);
    paymentClient.charge(command.payment()); // remote
    repository.markPaid(app.id());
}
```

## 41.2 Problem

If payment slow, transaction holds connection/locks.

If transaction rolls back after payment success, external side effect already happened.

## 41.3 Better

- create application pending payment;
- commit;
- send payment command/outbox;
- payment worker updates status idempotently.

## 41.4 Lesson

```text
Remote side effects should not be casually embedded in DB transaction.
```

---

# 42. Common Anti-Patterns

## 42.1 Increasing pool size blindly

May overload DB.

## 42.2 No connection timeout

Requests wait too long.

## 42.3 No query timeout

Queries run forever.

## 42.4 Long transaction

Locks and pool starvation.

## 42.5 Remote call inside transaction

Connection/lock held during network wait.

## 42.6 N+1 under concurrency

Query amplification.

## 42.7 Retry without idempotency

Duplicate side effects.

## 42.8 `REQUIRES_NEW` everywhere

Extra connections and confusing rollback.

## 42.9 Streaming huge result while holding transaction

Pool starvation.

## 42.10 Virtual threads without DB bulkhead

Thousands wait on pool.

---

# 43. Best Practices

## 43.1 Treat DB pool as explicit capacity boundary

Monitor it.

## 43.2 Keep transactions short

Minimal DB work only.

## 43.3 Use timeouts everywhere

Connection, query, transaction, request.

## 43.4 Avoid remote calls in transactions

Use outbox/saga/job.

## 43.5 Use optimistic locking for low-conflict updates

Version columns.

## 43.6 Use pessimistic locking only with short transactions

Consistent order.

## 43.7 Design retries with idempotency

Deadlocks/serialization failures.

## 43.8 Eliminate N+1

Especially under virtual-thread concurrency.

## 43.9 Bound DB-heavy endpoints

Bulkheads/admission.

## 43.10 Test with real DB

Mocks cannot reveal locks/isolation.

---

# 44. Decision Matrix

| Problem | Recommended |
|---|---|
| Many requests wait for DB connection | reduce concurrency, optimize queries, DB bulkhead |
| Lost update | optimistic lock, atomic SQL, row lock, isolation |
| Deadlock | consistent lock order, retry victim, short tx |
| High lock wait | shorten tx, indexes, reduce hot rows |
| Need external message after DB commit | outbox |
| Remote call inside tx | move outside tx / saga / outbox |
| N+1 queries | batch fetch, join, projection, read model |
| Read-only query | `@Transactional(readOnly=true)` if appropriate |
| High conflict writes | pessimistic lock or serialize per key |
| Low conflict writes | optimistic locking |
| Virtual threads enabled | explicit DB bulkhead and pool metrics |
| Long report query | async job/read replica/materialized view |
| Connection leak suspicion | leak detection, try-with-resources |
| Serialization failure | idempotent retry with backoff |

---

# 45. Latihan

## Latihan 1 — Pool Capacity

Diberi DB pool 50 dan endpoint 500 concurrent requests, desain DB bulkhead dan timeout.

## Latihan 2 — Lost Update

Buat dua transaksi yang menyebabkan lost update, lalu perbaiki dengan version column.

## Latihan 3 — Deadlock Ordering

Desain transfer account yang selalu lock account berdasarkan ID ascending.

## Latihan 4 — Remote Call Refactor

Refactor remote call inside transaction menjadi outbox pattern.

## Latihan 5 — N+1 Detection

Hitung query amplification untuk 100 request × 1 + 50 item queries.

## Latihan 6 — Timeout Hierarchy

Buat hierarchy request timeout 2s, transaction timeout 1.5s, query timeout 1s, connection wait 100ms.

## Latihan 7 — `REQUIRES_NEW`

Jelaskan kenapa nested `REQUIRES_NEW` bisa menghabiskan connection pool.

## Latihan 8 — Virtual Thread Migration

Buat checklist DB readiness sebelum enable virtual threads.

## Latihan 9 — Load Test

Rancang load test dengan hot row contention dan ukur lock wait.

## Latihan 10 — Observability Dashboard

Buat panel dashboard: pool active/idle/pending, query p99, tx duration, deadlock count.

---

# 46. Ringkasan

Database concurrency adalah salah satu aspek terpenting dalam aplikasi Java production.

Core lessons:

- Database adalah concurrent subsystem, bukan storage pasif.
- JDBC blocking menunggu DB dan memakai connection.
- Virtual threads mengurangi Java thread blocking cost, bukan DB cost.
- Connection pool adalah capacity boundary.
- Pool size harus berdasarkan DB capacity, bukan jumlah thread.
- Connection acquisition timeout harus bounded.
- Query timeout, network timeout, transaction timeout, dan request deadline saling melengkapi.
- Transaction harus pendek.
- Isolation level menentukan anomaly yang harus ditangani.
- MVCC mengurangi read/write blocking tetapi tidak menghilangkan conflicts.
- Row locks dan lock waits sering menjadi p99 latency problem.
- DB deadlocks perlu safe retry dan root-cause fix.
- Optimistic locking cocok untuk low conflict.
- Pessimistic locking cocok untuk high conflict tetapi harus singkat.
- Lost update harus dicegah dengan atomic SQL/version/isolation/lock.
- Retry butuh idempotency.
- Spring `@Transactional` default `REQUIRED`, isolation `DEFAULT`, read-write.
- Propagation mempengaruhi connection usage dan rollback semantics.
- Jangan remote call saat transaction open.
- N+1 under concurrency adalah load amplification.
- Streaming result set menghemat memory tetapi menahan connection.
- Outbox membantu atomic DB write + external message.
- Observability wajib mencakup pool wait, transaction duration, query duration, deadlocks, retries.
- Concurrency DB harus diuji dengan real database behavior.

Main rule:

```text
In Java concurrency, the database is often the real limiter.
Design around connection pool capacity, short transactions,
bounded waits, explicit conflict handling, idempotent retries,
and measured database behavior.
```

---

# 47. Referensi

1. Java SE 25/Java SQL — `Statement.setQueryTimeout`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/Statement.html

2. Java SE — `Connection.setNetworkTimeout`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/Connection.html

3. Spring Framework Reference — Declarative Transaction Management  
   https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html

4. Spring Framework Reference — Transaction Propagation  
   https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html

5. HikariCP GitHub Documentation  
   https://github.com/brettwooldridge/HikariCP

6. PostgreSQL Documentation — Transaction Isolation  
   https://www.postgresql.org/docs/current/transaction-iso.html

7. PostgreSQL Documentation — Explicit Locking  
   https://www.postgresql.org/docs/current/explicit-locking.html

8. Java SE 25 — `DataSource`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/javax/sql/DataSource.html

9. OpenJDK JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

10. Spring Boot Reference — Data Access  
    https://docs.spring.io/spring-boot/reference/data/index.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 024](./learn-java-concurrency-and-reactive-part-024.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 026](./learn-java-concurrency-and-reactive-part-026.md)
