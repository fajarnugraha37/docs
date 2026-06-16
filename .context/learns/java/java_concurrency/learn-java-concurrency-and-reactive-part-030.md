# learn-java-concurrency-and-reactive-part-030.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 030  
# Production Failure Case Studies in Concurrency: Deadlocks, Starvation, Pool Exhaustion, Virtual Thread Migration, Retry Storms, Context Leaks, and Backpressure Failures

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **030**  
> Fokus: mempelajari concurrency dari failure nyata yang sering terjadi di production. Bagian ini disusun sebagai case studies: gejala, timeline, sinyal observability, diagnosis, root cause, mitigasi cepat, permanent fix, preventive test, dan lesson learned. Tujuannya bukan menghafal bug, tetapi membangun kemampuan berpikir seperti engineer senior saat menghadapi incident concurrency.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Cara Membaca Case Study Concurrency](#2-cara-membaca-case-study-concurrency)
3. [Failure Taxonomy](#3-failure-taxonomy)
4. [Case 1 — Thread Pool Starvation Deadlock](#4-case-1--thread-pool-starvation-deadlock)
5. [Case 2 — Database Connection Pool Exhaustion](#5-case-2--database-connection-pool-exhaustion)
6. [Case 3 — Virtual Threads Enabled, DB Meltdown](#6-case-3--virtual-threads-enabled-db-meltdown)
7. [Case 4 — Retry Storm After Downstream Slowdown](#7-case-4--retry-storm-after-downstream-slowdown)
8. [Case 5 — Deadlock in Account Transfer](#8-case-5--deadlock-in-account-transfer)
9. [Case 6 — Distributed Scheduled Job Runs on Every Pod](#9-case-6--distributed-scheduled-job-runs-on-every-pod)
10. [Case 7 — Lost MDC and Security Context in `@Async`](#10-case-7--lost-mdc-and-security-context-in-async)
11. [Case 8 — ThreadLocal Memory Explosion After Virtual Thread Migration](#11-case-8--threadlocal-memory-explosion-after-virtual-thread-migration)
12. [Case 9 — Parallel Stream Over Database Calls](#12-case-9--parallel-stream-over-database-calls)
13. [Case 10 — Blocking Call Inside WebFlux Event Loop](#13-case-10--blocking-call-inside-webflux-event-loop)
14. [Case 11 — Queue Backlog and Memory Growth](#14-case-11--queue-backlog-and-memory-growth)
15. [Case 12 — Poison Message Starves Consumer](#15-case-12--poison-message-starves-consumer)
16. [Case 13 — Cache Stampede](#16-case-13--cache-stampede)
17. [Case 14 — Long Transaction Holds Row Locks](#17-case-14--long-transaction-holds-row-locks)
18. [Case 15 — Stale Distributed Lock Owner Writes Data](#18-case-15--stale-distributed-lock-owner-writes-data)
19. [Cross-Case Patterns](#19-crosscase-patterns)
20. [Incident Response Playbook](#20-incident-response-playbook)
21. [Permanent Fix Patterns](#21-permanent-fix-patterns)
22. [Preventive Testing Patterns](#22-preventive-testing-patterns)
23. [Observability Checklist](#23-observability-checklist)
24. [Architecture Review Checklist](#24-architecture-review-checklist)
25. [Common Anti-Patterns](#25-common-antipatterns)
26. [Best Practices](#26-best-practices)
27. [Decision Matrix](#27-decision-matrix)
28. [Latihan](#28-latihan)
29. [Ringkasan](#29-ringkasan)
30. [Referensi](#30-referensi)

---

# 1. Tujuan Bagian Ini

Setelah mempelajari konsep:

- threads;
- virtual threads;
- executors;
- JMM;
- locks;
- ThreadLocal;
- structured concurrency;
- cancellation;
- deadlock/starvation;
- concurrent data structures;
- backpressure;
- database concurrency;
- distributed concurrency;
- observability;
- testing;

sekarang kita menyatukan semuanya ke bentuk paling penting untuk engineer production:

```text
Bagaimana membaca incident concurrency?
Bagaimana menemukan bottleneck?
Bagaimana membedakan symptom dan root cause?
Bagaimana membuat mitigasi cepat tanpa memperburuk keadaan?
Bagaimana mengubah incident menjadi permanent fix dan preventive test?
```

Target bagian ini:

```text
Mampu melihat gejala production concurrency,
membangun hipotesis yang tepat,
mengumpulkan evidence,
melakukan mitigasi,
dan mendesain fix jangka panjang.
```

---

# 2. Cara Membaca Case Study Concurrency

Setiap case study akan mengikuti struktur:

## 2.1 Symptoms

Apa yang terlihat?

```text
p99 naik
timeout naik
CPU 100%
DB pool penuh
thread WAITING
queue backlog
```

## 2.2 Timeline

Urutan kejadian.

## 2.3 Evidence

Data dari:

- metrics;
- logs;
- traces;
- thread dump;
- JFR;
- DB metrics;
- queue metrics.

## 2.4 Root cause

Mekanisme teknis yang menyebabkan incident.

## 2.5 Fast mitigation

Apa yang bisa dilakukan untuk mengurangi impact?

## 2.6 Permanent fix

Perubahan desain/code/config.

## 2.7 Preventive test

Test agar bug tidak kembali.

## 2.8 Lesson

Mental model yang perlu diingat.

## 2.9 Main rule

```text
Production debugging is evidence-driven storytelling:
symptom -> timeline -> wait point -> owner -> root cause -> fix.
```

---

# 3. Failure Taxonomy

Concurrency production failures biasanya masuk kategori:

## 3.1 Too many things

Concurrency terlalu tinggi.

## 3.2 Too slow things

Dependency lambat, queue tumbuh.

## 3.3 Waiting forever

No timeout/cancellation.

## 3.4 Waiting for itself

Thread pool starvation deadlock.

## 3.5 Shared mutable state

Race/corruption/lost update.

## 3.6 Wrong boundary

Context/transaction/thread boundary salah.

## 3.7 No backpressure

Unbounded queue/task/message.

## 3.8 Duplicate/retry

Idempotency tidak ada.

## 3.9 Stale owner

Distributed lock/lease tanpa fencing.

## 3.10 Main rule

```text
Most concurrency incidents are either unbounded work,
unbounded wait, or incorrect shared state.
```

---

# 4. Case 1 — Thread Pool Starvation Deadlock

## 4.1 Symptoms

- Endpoint timeout.
- CPU rendah.
- Thread pool active=max.
- Queue size naik.
- Thread dump menunjukkan semua worker `WAITING` pada `Future.get()`.

## 4.2 Broken code

```java
ExecutorService pool = Executors.newFixedThreadPool(10);

public Response handle(Request request) throws Exception {
    Future<DataA> a = pool.submit(() -> loadA(request));
    Future<DataB> b = pool.submit(() -> loadB(request));

    return combine(a.get(), b.get());
}
```

Jika `handle()` sendiri dijalankan di `pool`, semua worker dapat menunggu child tasks yang queued di pool yang sama.

## 4.3 Timeline

```text
10 parent tasks occupy all 10 workers
each parent submits 2 child tasks
parents call get()
child tasks sit in queue
no worker free
deadlock/starvation
```

## 4.4 Evidence

Thread dump:

```text
pool-1-thread-1 WAITING at FutureTask.get
pool-1-thread-2 WAITING at FutureTask.get
...
```

Executor:

```text
active = 10
queue = 20
completed not increasing
```

## 4.5 Root cause

Bounded executor waits for work submitted to itself.

## 4.6 Fast mitigation

- Increase pool temporarily only if safe.
- Reduce traffic to endpoint.
- Disable fan-out.
- Restart only after evidence if needed.

## 4.7 Permanent fix

Use structured concurrency or separate executor.

```java
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    var a = scope.fork(() -> loadA(request));
    var b = scope.fork(() -> loadB(request));

    scope.join();
    scope.throwIfFailed();

    return combine(a.get(), b.get());
}
```

Or ensure orchestration runs outside the bounded worker pool.

## 4.8 Preventive test

- Configure pool size 1 or 2.
- Submit parent tasks.
- Assert completion within timeout.
- Verify no parent blocks waiting on same pool.

## 4.9 Lesson

```text
A bounded executor must not synchronously wait for tasks queued to itself.
```

---

# 5. Case 2 — Database Connection Pool Exhaustion

## 5.1 Symptoms

- Requests timeout.
- DB pool active=max.
- Pending acquisition high.
- CPU moderate.
- DB CPU maybe high or low depending lock wait.
- Errors like connection timeout.

## 5.2 Common code smell

```java
@Transactional
public Result process(Command command) {
    Entity entity = repository.find(command.id());
    remoteClient.call(command); // slow network while tx open
    entity.markProcessed();
    return repository.save(entity);
}
```

## 5.3 Timeline

```text
requests start transaction
connections acquired
remote service slows
transactions stay open
connections remain occupied
new requests wait for connection
pool exhausted
timeouts cascade
```

## 5.4 Evidence

Metrics:

```text
hikari.active = max
hikari.pending > 0
transaction.duration p99 high
downstream latency high
```

Thread dump:

```text
threads waiting in connection acquisition
or waiting on HTTP call while transaction open
```

## 5.5 Root cause

Connection hold time too long because transaction includes remote I/O.

## 5.6 Fast mitigation

- Disable slow path.
- Open circuit to downstream.
- Reduce traffic.
- Lower connection timeout to fail fast.
- Kill long DB sessions if safe.

## 5.7 Permanent fix

Move remote call outside transaction.

Better:

```java
@Transactional
public void createPending(Command command) {
    repository.createPending(command);
    outbox.insert(new RemoteCallRequested(command.id()));
}
```

Then async worker performs remote call and updates status in separate transaction.

## 5.8 Preventive test

- Fake remote client blocks.
- Start N transactions with small pool.
- Assert extra request fails fast and resources are released.
- Assert no remote call occurs inside transaction boundary.

## 5.9 Lesson

```text
DB connections are capacity permits. Do not hold them while waiting on remote systems.
```

---

# 6. Case 3 — Virtual Threads Enabled, DB Meltdown

## 6.1 Symptoms

After enabling virtual threads:

- request throughput initially improves;
- p99 worsens;
- DB pool pending increases;
- DB CPU/lock wait increases;
- connection timeout errors rise;
- retry count rises.

## 6.2 Before

```text
Tomcat platform threads = 200
DB pool = 50
```

The platform thread limit accidentally bounded traffic reaching DB.

## 6.3 After

```text
virtual-thread request handling
thousands of concurrent requests can wait cheaply
DB pool still 50
```

## 6.4 Root cause

Removed thread bottleneck without adding explicit DB/resource limits.

## 6.5 Evidence

Compare before/after:

```text
in-flight requests up
DB pending up
connection acquisition p99 up
endpoint p99 up
CPU not necessarily limiting
```

## 6.6 Fast mitigation

- Roll back virtual thread config.
- Add endpoint admission control.
- Lower max accepted expensive requests.
- Reduce retries.
- Circuit break optional DB-heavy features.

## 6.7 Permanent fix

- DB semaphore bulkhead per expensive endpoint.
- Connection timeout.
- Query timeout.
- N+1 removal.
- Read model/cache.
- Load-test virtual-thread config.

Example:

```java
if (!dbPermits.tryAcquire(50, TimeUnit.MILLISECONDS)) {
    throw new ServiceBusyException("DB busy");
}
try {
    return repository.load(...);
} finally {
    dbPermits.release();
}
```

## 6.8 Preventive test

- Load test with virtual threads on/off.
- DB pool limited.
- Assert p99, pending, timeouts stay under threshold.
- Include DB slow scenario.

## 6.9 Lesson

```text
Virtual threads remove thread scarcity. They do not remove database scarcity.
```

---

# 7. Case 4 — Retry Storm After Downstream Slowdown

## 7.1 Symptoms

- Downstream latency rises.
- Caller retry count spikes.
- Traffic to downstream multiplies.
- Circuit breaker may open late.
- CPU/logging increases.
- User latency worsens.

## 7.2 Broken policy

```text
retry 3 times immediately
no jitter
no deadline
no per-client bulkhead
```

## 7.3 Timeline

```text
downstream slows
requests timeout
all callers retry immediately
downstream receives 3x traffic
latency worsens
more retries
storm
```

## 7.4 Evidence

Metrics:

```text
downstream.latency p99 up
retry.attempts up
http.inflight up
timeout count up
same correlation ID has multiple attempts
```

## 7.5 Root cause

Retries add load without budget/backoff/jitter and without bulkhead.

## 7.6 Fast mitigation

- Disable retries temporarily.
- Open circuit.
- Reduce caller concurrency.
- Shed load.
- Increase timeout only if evidence supports and no storm risk.

## 7.7 Permanent fix

- Retry budget.
- Exponential backoff.
- Jitter.
- Deadline-aware retry.
- Per-downstream bulkhead.
- Circuit breaker.
- Idempotency key for retried commands.

## 7.8 Preventive test

- Fake downstream returns timeout.
- Assert max attempts.
- Assert backoff.
- Assert no retry after deadline.
- Assert bulkhead protects dependency.

## 7.9 Lesson

```text
Retry is extra traffic. Budget it like production load.
```

---

# 8. Case 5 — Deadlock in Account Transfer

## 8.1 Symptoms

- Some requests never complete.
- Thread dump shows deadlock or DB deadlock errors.
- Transaction rollback due to deadlock victim.
- Lock wait high.

## 8.2 Broken code

```java
void transfer(Account from, Account to, Money amount) {
    synchronized (from.lock()) {
        synchronized (to.lock()) {
            from.debit(amount);
            to.credit(amount);
        }
    }
}
```

Concurrent:

```text
transfer(A,B)
transfer(B,A)
```

## 8.3 Root cause

Locks acquired in different order.

## 8.4 Permanent fix

Global order:

```java
Account first = from.id().compareTo(to.id()) < 0 ? from : to;
Account second = first == from ? to : from;

synchronized (first.lock()) {
    synchronized (second.lock()) {
        from.debit(amount);
        to.credit(amount);
    }
}
```

For DB rows:

```text
always update lower account_id first
```

## 8.5 Preventive test

- Run transfer A->B and B->A concurrently.
- Assert completion.
- Repeat.
- For DB, force overlapping transactions.

## 8.6 Lesson

```text
Multiple resource acquisition needs deterministic global ordering.
```

---

# 9. Case 6 — Distributed Scheduled Job Runs on Every Pod

## 9.1 Symptoms

- Cleanup job executed multiple times.
- Duplicate emails/reports.
- DB load spikes every schedule.
- Logs show all pods start same job.

## 9.2 Cause

`@Scheduled` runs in every application instance.

```java
@Scheduled(cron = "0 * * * * *")
void cleanup() {
    ...
}
```

## 9.3 Root cause

Assumed in-memory scheduler is cluster singleton.

## 9.4 Fast mitigation

- Disable schedule on all but one pod.
- Use feature flag.
- Scale deployment down temporarily.
- Move job to external scheduler.

## 9.5 Permanent fix

Options:

- Kubernetes CronJob;
- DB job claim with conditional update;
- leader election;
- distributed lease with fencing;
- message queue.

## 9.6 Preventive test

- Start two app instances in integration environment.
- Assert only one job claims work.
- Duplicate job invocation should be idempotent.

## 9.7 Lesson

```text
In multi-pod deployment, in-memory scheduler is per pod, not per cluster.
```

---

# 10. Case 7 — Lost MDC and Security Context in `@Async`

## 10.1 Symptoms

- Async logs missing correlation ID.
- Audit event has missing user.
- Security principal absent.
- Tenant context sometimes wrong or null.

## 10.2 Broken pattern

```java
@Async
void writeAudit(AuditEvent event) {
    log.info("audit {}", event);
    auditRepository.save(event.withUser(SecurityContextHolder.getContext()));
}
```

## 10.3 Root cause

`@Async` runs on another thread. ThreadLocal contexts do not automatically cross executor boundary.

## 10.4 Fast mitigation

- Stop relying on ThreadLocal in async method.
- Include user/tenant/correlation in command.

## 10.5 Permanent fix

```java
record AuditCommand(
    String correlationId,
    String tenantId,
    String userId,
    AuditEvent event
) {}
```

Pass explicit immutable command.

Optionally configure task decorator for MDC.

## 10.6 Preventive test

- Set context in caller.
- Invoke async.
- Assert async receives explicit context.
- Assert context cleared after task.
- Run two tasks with different contexts.

## 10.7 Lesson

```text
Async boundary is context boundary.
```

---

# 11. Case 8 — ThreadLocal Memory Explosion After Virtual Thread Migration

## 11.1 Symptoms

- Heap grows after virtual threads enabled.
- GC frequency increases.
- OOM under high concurrency.
- Heap dump shows many ThreadLocal values.

## 11.2 Broken pattern

```java
static final ThreadLocal<byte[]> BUFFER =
    ThreadLocal.withInitial(() -> new byte[1024 * 1024]);
```

With 100 platform threads:

```text
~100 MB
```

With thousands of virtual threads touching it:

```text
many GB potential
```

## 11.3 Root cause

Per-thread cache pattern became per-virtual-thread memory explosion.

## 11.4 Fast mitigation

- Disable virtual thread config.
- Reduce concurrency.
- Remove heavy ThreadLocal.
- Lower buffer size.

## 11.5 Permanent fix

- Use local allocation if cheap.
- Use bounded object pool only if measured.
- Use streaming/chunking.
- Avoid large ThreadLocal in virtual-thread paths.
- Use Scoped Values only for small immutable context metadata.

## 11.6 Preventive test

- Run many virtual-thread tasks touching code path.
- Assert memory within budget.
- Heap analysis in soak test.

## 11.7 Lesson

```text
Old platform-thread ThreadLocal optimization can become virtual-thread memory bug.
```

---

# 12. Case 9 — Parallel Stream Over Database Calls

## 12.1 Symptoms

- DB pool exhausted.
- Common pool blocked.
- CompletableFuture tasks slow.
- p99 high.
- Throughput inconsistent.

## 12.2 Broken code

```java
List<Order> orders = ids.parallelStream()
    .map(repository::findById)
    .toList();
```

## 12.3 Root cause

Parallel stream uses common ForkJoinPool and performs blocking DB calls without DB concurrency budget.

## 12.4 Fast mitigation

- Revert to sequential.
- Limit IDs.
- Add DB bulkhead.
- Reduce DB pool wait timeout.

## 12.5 Permanent fix

For I/O fan-out, use virtual threads with semaphore:

```java
Semaphore dbPermits = new Semaphore(20);

try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<Order>> futures = ids.stream()
        .map(id -> executor.submit(() -> {
            if (!dbPermits.tryAcquire(50, TimeUnit.MILLISECONDS)) {
                throw new ServiceBusyException();
            }
            try {
                return repository.findById(id);
            } finally {
                dbPermits.release();
            }
        }))
        .toList();
}
```

Or better: batch query with `WHERE id IN (...)`.

## 12.6 Preventive test

- Tiny DB pool.
- Many IDs.
- Assert DB concurrency never exceeds limit.
- Assert no parallel stream in repository fan-out path via review/static rule.

## 12.7 Lesson

```text
Parallel stream is for CPU-bound in-memory data, not blocking database fan-out.
```

---

# 13. Case 10 — Blocking Call Inside WebFlux Event Loop

## 13.1 Symptoms

- WebFlux app p99 spikes.
- Event-loop threads blocked.
- Low throughput.
- Thread dump shows event loop in blocking JDBC/HTTP call.

## 13.2 Broken pattern

```java
Mono<CaseDto> getCase(String id) {
    return Mono.fromCallable(() -> jdbcRepository.find(id));
}
```

without moving to proper scheduler.

## 13.3 Root cause

Blocking operation on event-loop thread.

## 13.4 Fast mitigation

- Isolate blocking call to bounded elastic/appropriate scheduler.
- Reduce traffic to endpoint.

## 13.5 Permanent fix

- Use reactive driver/client end-to-end; or
- isolate blocking work with bounded scheduler/virtual-thread strategy; or
- use Spring MVC + virtual threads for blocking stack.

## 13.6 Preventive test

- Enable event-loop blocking detection/tooling where available.
- Test that blocking repository not called on event-loop thread.
- Load test with blocked dependency.

## 13.7 Lesson

```text
Reactive event loops must not block.
```

---

# 14. Case 11 — Queue Backlog and Memory Growth

## 14.1 Symptoms

- Memory grows.
- GC increases.
- Queue size grows.
- Request latency grows.
- No immediate errors until OOM.

## 14.2 Broken pattern

```java
BlockingQueue<Job> queue = new LinkedBlockingQueue<>();
```

Unbounded queue.

## 14.3 Root cause

Producer rate > consumer rate, no backpressure.

## 14.4 Fast mitigation

- Stop producers.
- Drain queue.
- Drop non-critical work.
- Restart if memory unrecoverable.

## 14.5 Permanent fix

- Bounded queue.
- Timed offer.
- Rejection/drop/coalesce policy.
- Consumer scaling if bottleneck allows.
- Queue age metrics.

## 14.6 Preventive test

- Slow consumer.
- Fill queue.
- Assert producer gets rejection within timeout.
- Assert metric increments.

## 14.7 Lesson

```text
Unbounded queues convert overload into memory failure.
```

---

# 15. Case 12 — Poison Message Starves Consumer

## 15.1 Symptoms

- Consumer lag grows.
- Same message retried repeatedly.
- DLQ empty because not configured.
- Downstream side effects repeated or attempted.

## 15.2 Root cause

Poison message retried forever in hot path.

## 15.3 Fast mitigation

- Manually skip or move message.
- Pause consumer group.
- Add temporary filter.

## 15.4 Permanent fix

- Max attempts.
- Backoff.
- DLQ.
- Idempotent processing.
- Alert on DLQ.
- Payload validation before heavy processing.

## 15.5 Preventive test

- Fake message always fails.
- Assert after max attempts it goes to DLQ.
- Assert queue progresses to next message.

## 15.6 Lesson

```text
Poison messages need an exit path.
```

---

# 16. Case 13 — Cache Stampede

## 16.1 Symptoms

- Cache expires.
- Many requests miss simultaneously.
- DB/downstream spike.
- p99 worsens.
- Error rate rises.

## 16.2 Broken pattern

```java
Value v = cache.get(key);
if (v == null) {
    v = loadFromDb(key);
    cache.put(key, v);
}
```

Many threads load same key.

## 16.3 Permanent fix

- `computeIfAbsent` / single-flight.
- Request coalescing.
- Stale-while-revalidate.
- TTL jitter.
- Per-key lock.
- Bulkhead for loader.

## 16.4 Preventive test

- Many threads request same missing key.
- Loader blocks.
- Assert loader called once or bounded times.
- Assert all waiters receive result.

## 16.5 Lesson

```text
Cache miss under concurrency is a fan-in problem.
```

---

# 17. Case 14 — Long Transaction Holds Row Locks

## 17.1 Symptoms

- Specific endpoint p99 high.
- DB lock wait high.
- Deadlocks occasionally.
- Rows in one table hot.

## 17.2 Broken pattern

```java
@Transactional
void approve(Command command) {
    Case c = repository.findForUpdate(command.caseId());
    expensiveValidation(command); // slow CPU/remote
    c.approve();
}
```

## 17.3 Root cause

Row lock acquired before expensive work.

## 17.4 Permanent fix

- Do expensive validation before lock/transaction if possible.
- Keep transaction minimal.
- Use optimistic locking.
- Use status transition atomic update.
- Use ordered locking.

## 17.5 Preventive test

- Two concurrent approvals same case.
- Fake validation blocks.
- Assert second request does not wait excessively or fails fast.

## 17.6 Lesson

```text
Acquire database locks as late as possible and release as early as possible.
```

---

# 18. Case 15 — Stale Distributed Lock Owner Writes Data

## 18.1 Symptoms

- Two workers appear to own same job.
- Data overwritten by old worker.
- Logs show lock TTL expired and reacquired.

## 18.2 Timeline

```text
Worker A gets lease token 10
A pauses
lease expires
Worker B gets lease token 11
B writes correct data
A resumes
A writes stale data
```

## 18.3 Root cause

Lease without fencing token enforcement.

## 18.4 Permanent fix

Protected resource rejects stale token.

```sql
UPDATE job_state
SET result = ?, fencing_token = ?
WHERE job_id = ?
  AND fencing_token < ?;
```

## 18.5 Preventive test

- Simulate owner A pause.
- Owner B acquires newer token.
- A tries stale write.
- Assert write rejected.

## 18.6 Lesson

```text
Distributed lock without fencing is not safe against stale owners.
```

---

# 19. Cross-Case Patterns

Across all cases, repeated themes:

## 19.1 Accidental limits removed

Virtual threads remove thread bottleneck and expose DB/API bottleneck.

## 19.2 Unbounded waiting

No timeout turns slowness into pile-up.

## 19.3 Unbounded queues

Backlog becomes memory pressure.

## 19.4 Wrong executor

Blocking work in common pool/event loop.

## 19.5 Context boundary ignored

`@Async` loses ThreadLocal context.

## 19.6 Retry without budget

Failure becomes load amplifier.

## 19.7 Lock without ordering/fencing

Deadlock or stale write.

## 19.8 Main rule

```text
Production concurrency failures usually reveal a missing explicit boundary.
```

---

# 20. Incident Response Playbook

## 20.1 First 5 minutes

- Identify affected endpoints/features.
- Check recent deployments/config changes.
- Check p99/error/timeout.
- Check saturation metrics.
- Capture evidence before restart if possible.

## 20.2 Evidence

- 3 thread dumps.
- Short JFR if safe.
- DB pool metrics.
- Executor/queue metrics.
- HTTP downstream metrics.
- Logs with correlation IDs.
- Traces.

## 20.3 Mitigation

- Shed load.
- Disable optional feature.
- Open circuit.
- Reduce concurrency.
- Stop retry storm.
- Rollback config.
- Scale only if bottleneck supports it.

## 20.4 Root-cause analysis

Find:

```text
where work waited
who owned resource
why owner was slow
why boundary did not protect system
```

## 20.5 Main rule

```text
During incident, reduce harm first, preserve evidence second, fix root cause third.
```

---

# 21. Permanent Fix Patterns

## 21.1 Boundaries

- semaphore bulkhead;
- bounded queue;
- admission control;
- rate limit;
- circuit breaker.

## 21.2 Time

- request deadline;
- query timeout;
- HTTP timeout;
- lock acquire timeout;
- queue offer timeout.

## 21.3 State

- idempotency key;
- version;
- optimistic lock;
- fencing token.

## 21.4 Execution

- separate CPU/I/O executors;
- virtual threads for blocking I/O;
- no blocking event loop;
- structured concurrency for fan-out.

## 21.5 Observability

- wait time metrics;
- queue age;
- retry count;
- context IDs.

## 21.6 Main rule

```text
Permanent fixes usually add explicit limits, ownership, idempotency, or observability.
```

---

# 22. Preventive Testing Patterns

## 22.1 Small pool tests

Expose starvation and pool exhaustion.

## 22.2 Blocking dependency tests

Expose timeout/cancellation.

## 22.3 Duplicate tests

Expose idempotency issues.

## 22.4 Out-of-order tests

Expose stale updates.

## 22.5 Multi-instance tests

Expose local-only assumptions.

## 22.6 Load tests

Expose saturation curves.

## 22.7 Soak tests

Expose leaks and backlog.

## 22.8 Main rule

```text
Every production incident should produce at least one regression test or load scenario.
```

---

# 23. Observability Checklist

Minimum concurrency observability:

## 23.1 Request

- p50/p95/p99;
- timeout;
- cancellation;
- rejection.

## 23.2 Executor

- active;
- queue size;
- queue wait;
- task duration;
- rejection.

## 23.3 DB

- active/idle/pending;
- acquisition wait;
- query p99;
- tx duration;
- lock wait.

## 23.4 HTTP

- in-flight;
- connection wait;
- downstream latency;
- retries;
- timeout;
- circuit state.

## 23.5 Queue

- depth;
- oldest age;
- enqueue/dequeue rate;
- DLQ.

## 23.6 Distributed

- duplicate count;
- stale rejection;
- fencing rejection;
- leader changes.

## 23.7 Main rule

```text
Observe every place where work can wait.
```

---

# 24. Architecture Review Checklist

Before approving concurrent design, ask:

1. What is the unit of work?
2. What can run concurrently?
3. What is the bottleneck?
4. What is bounded?
5. What happens when full?
6. What is timeout/deadline?
7. What is cancellation path?
8. What is idempotency key?
9. What ordering is required?
10. What happens on duplicate?
11. What happens on partial failure?
12. What metrics prove it works?
13. What test proves overload behavior?

## 24.1 Main rule

```text
Concurrency design review is boundary review.
```

---

# 25. Common Anti-Patterns

## 25.1 “Just add threads”

Usually hides bottleneck.

## 25.2 “Virtual threads solve scaling”

Only Java-side blocking cost.

## 25.3 “Queue is unbounded for safety”

Unbounded queue is delayed failure.

## 25.4 “Retry fixes transient errors”

Retry without budget amplifies load.

## 25.5 “@Scheduled runs once”

Runs per instance.

## 25.6 “@Async is reliable background job”

Not durable by itself.

## 25.7 “Distributed lock is synchronized”

False.

## 25.8 “Timeout means failed”

Outcome unknown.

## 25.9 “Average latency is fine”

p99 may be terrible.

## 25.10 “No exception, no problem”

Concurrency bugs often produce silence and waiting.

---

# 26. Best Practices

## 26.1 Define capacity boundaries

DB, HTTP, CPU, queue, executor.

## 26.2 Use deadlines

One request budget.

## 26.3 Make retries idempotent and bounded

Backoff, jitter, budget.

## 26.4 Prefer explicit context

Across async boundaries.

## 26.5 Keep transactions short

No remote call inside transaction.

## 26.6 Avoid common pool blocking

No DB/HTTP in parallel streams.

## 26.7 Use fencing for distributed locks

Lease alone insufficient.

## 26.8 Observe wait points

Metrics/traces/logs.

## 26.9 Test failure modes

Not only happy path.

## 26.10 Turn incidents into learning artifacts

Runbook, regression test, checklist.

---

# 27. Decision Matrix

| Symptom | Likely Root Area | Evidence | Fix Direction |
|---|---|---|---|
| CPU low, requests timeout | waiting/deadlock | thread dumps | find wait owner |
| Executor active=max, queue grows | executor saturation | executor metrics | bound/scale/separate |
| Workers waiting on Future | pool starvation | thread dump | avoid same-pool blocking |
| DB active=max, pending high | DB bottleneck | pool metrics | optimize/bulkhead |
| p99 after virtual threads worsens | resource exposed | before/after metrics | explicit limits |
| Retry count spikes | retry storm | retry/downstream metrics | backoff/circuit |
| Duplicate side effects | no idempotency | command logs | idempotency key |
| Async logs missing correlation | context boundary | logs/MDC | explicit context |
| Heap grows with virtual threads | ThreadLocal/queued tasks | heap/JFR | reduce retention |
| Every pod runs job | local scheduler | pod logs | leader/cron/job claim |
| Stale worker writes | lock lease issue | fencing logs | fencing token |
| Queue grows forever | no backpressure | queue age | bounded queue/reject |

---

# 28. Latihan

## Latihan 1 — Incident Classification

Ambil 5 symptoms dan klasifikasikan: CPU, DB, executor, queue, lock, distributed.

## Latihan 2 — Thread Pool Starvation

Buat small pool test yang mereproduksi parent waiting child problem.

## Latihan 3 — DB Pool Exhaustion

Simulasikan remote call inside transaction dengan pool kecil.

## Latihan 4 — Virtual Thread Migration Plan

Buat checklist before/after metrics untuk enable virtual threads.

## Latihan 5 — Retry Storm

Buat fake downstream slow dan assert retry budget.

## Latihan 6 — Queue Backpressure

Ubah unbounded queue menjadi bounded queue dengan rejection policy.

## Latihan 7 — Cache Stampede

Test 100 concurrent requests ke missing key dan assert loader call count.

## Latihan 8 — Scheduled Multi-Pod

Desain job claim table untuk mencegah duplicate scheduled job.

## Latihan 9 — Fencing Token

Buat stale token write rejection test.

## Latihan 10 — Postmortem

Tulis postmortem template untuk concurrency incident.

---

# 29. Ringkasan

Production concurrency failures mengajarkan bahwa konsep harus diterapkan dengan boundary yang jelas.

Core lessons:

- Thread pool starvation terjadi saat bounded pool menunggu dirinya sendiri.
- DB connection pool exhaustion sering berasal dari long transaction, slow query, remote call inside tx, atau concurrency terlalu tinggi.
- Virtual threads bisa memperbaiki thread bottleneck tetapi memperburuk DB/API bottleneck jika limit eksplisit tidak ada.
- Retry storm adalah load amplification.
- Deadlock butuh ordering.
- `@Scheduled` berjalan per pod.
- `@Async` memutus ThreadLocal context.
- ThreadLocal besar berbahaya di virtual-thread apps.
- Parallel stream bukan alat untuk blocking DB/HTTP calls.
- WebFlux event loop tidak boleh block.
- Unbounded queue mengubah overload menjadi OOM.
- Poison message butuh DLQ.
- Cache stampede butuh single-flight/coalescing.
- Long transaction memperpanjang lock wait.
- Distributed lock butuh fencing token.
- Cross-case pattern utama: missing explicit boundary.
- Incident response harus evidence-driven.
- Permanent fix biasanya berupa limit, timeout, idempotency, ordering, ownership, cancellation, atau observability.
- Setiap incident harus menghasilkan regression test/runbook/checklist.

Main rule:

```text
The best concurrency engineers do not only fix the bug.
They identify the missing boundary,
make it explicit,
observe it,
test it,
and document the failure mode.
```

---

# 30. Referensi

1. Java SE 25 — `ThreadPoolExecutor`
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html

2. Java SE 25 — `CompletableFuture`
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html

3. Java SE 25 — `Semaphore`
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Semaphore.html

4. Java SE 25 — `Executors.newVirtualThreadPerTaskExecutor`
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html#newVirtualThreadPerTaskExecutor()

5. OpenJDK JEP 444 — Virtual Threads
   https://openjdk.org/jeps/444

6. OpenJDK JEP 491 — Synchronize Virtual Threads without Pinning
   https://openjdk.org/jeps/491

7. Spring Framework Reference — Scheduling
   https://docs.spring.io/spring-framework/reference/integration/scheduling.html

8. Spring Framework Reference — Transaction Management
   https://docs.spring.io/spring-framework/reference/data-access/transaction.html

9. Apache Kafka Documentation — Semantics
   https://kafka.apache.org/documentation/#semantics

10. Java Flight Recorder Runtime Guide
    https://docs.oracle.com/en/java/javase/25/jfapi/
