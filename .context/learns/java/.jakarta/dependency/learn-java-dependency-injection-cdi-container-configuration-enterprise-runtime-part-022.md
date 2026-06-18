# Part 022 — EJB Transactions, Timers, Async, and Security Boundaries

Series: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
File: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-022.md`  
Status: Part 022 of 035  
Target: Java 8–25, Java EE `javax.*`, Jakarta EE `jakarta.*`

---

## 0. Why This Part Matters

By this point, we already understand:

- dependency management,
- API/SPI/provider layering,
- `javax.*` to `jakarta.*`,
- container ownership,
- classloaders,
- dependency injection fundamentals,
- CDI bean discovery,
- scopes,
- proxies,
- qualifiers,
- producers,
- events,
- interceptors,
- decorators,
- stereotypes,
- lifecycle callbacks,
- CDI extensions,
- and the core mental model of Enterprise Beans.

This part focuses on the pieces that made Enterprise Beans historically powerful:

1. **transactions**,
2. **timers**,
3. **asynchronous method execution**,
4. **security boundaries**.

These are not merely annotations. They are **container-enforced runtime contracts**.

A weak engineer reads this:

```java
@Stateless
public class PaymentService {

    @TransactionAttribute(TransactionAttributeType.REQUIRES_NEW)
    public void settlePayment(PaymentCommand command) {
        // business logic
    }
}
```

and thinks:

> This method starts a new transaction.

A stronger engineer asks:

> New relative to what caller?  
> What happens to the caller transaction?  
> What happens if this method throws a checked exception?  
> What if the call is self-invocation?  
> What if this method is called asynchronously?  
> What if the transaction times out after the external API call?  
> What if the method is triggered by a timer on two cluster nodes?  
> What if the caller principal is missing?  
> What if rollback happens after audit event was already emitted?

The top-level mental model is:

```text
EJB does not just call your method.
EJB invokes your method through a managed boundary.

That boundary may attach:
- transaction context,
- security context,
- naming/resource context,
- pooling semantics,
- concurrency controls,
- timer callback semantics,
- async execution behavior,
- exception-to-rollback rules.
```

This part is about understanding that boundary.

---

## 1. Official Baseline and Namespace Map

Historically:

```text
Java EE 8 and earlier:
javax.ejb.*
javax.annotation.security.*
javax.transaction.*

Jakarta EE 9+:
jakarta.ejb.*
jakarta.annotation.security.*
jakarta.transaction.*
```

Important API families:

```java
// Enterprise Beans
import jakarta.ejb.Stateless;
import jakarta.ejb.Stateful;
import jakarta.ejb.Singleton;
import jakarta.ejb.TransactionAttribute;
import jakarta.ejb.TransactionAttributeType;
import jakarta.ejb.Asynchronous;
import jakarta.ejb.Schedule;
import jakarta.ejb.Timeout;
import jakarta.ejb.Timer;
import jakarta.ejb.TimerService;

// Security annotations
import jakarta.annotation.security.RolesAllowed;
import jakarta.annotation.security.PermitAll;
import jakarta.annotation.security.DenyAll;
import jakarta.annotation.security.RunAs;

// Jakarta Transactions for CDI / managed beans
import jakarta.transaction.Transactional;
import jakarta.transaction.Transactional.TxType;
```

In Java EE 8, replace `jakarta.*` with `javax.*`:

```java
import javax.ejb.Stateless;
import javax.ejb.TransactionAttribute;
import javax.ejb.TransactionAttributeType;
import javax.annotation.security.RolesAllowed;
import javax.transaction.Transactional;
```

Important distinction:

```text
EJB transaction annotation:
    jakarta.ejb.TransactionAttribute

CDI/Jakarta Transactions annotation:
    jakarta.transaction.Transactional
```

They are related, but not identical.

---

## 2. The Central Mental Model: Invocation Boundary

EJB services are not plain method calls once invoked through the container.

Conceptually:

```text
Caller
  |
  v
EJB proxy / business reference
  |
  +-- security check
  +-- transaction handling
  +-- concurrency/pooling handling
  +-- interceptor chain
  +-- timer/async semantics if applicable
  |
  v
Actual bean instance method
```

That means behavior depends on **how the method is invoked**.

This is critical:

```java
@Stateless
public class CaseService {

    public void submitCase(CaseCommand command) {
        createCase(command); // self-invocation
    }

    @TransactionAttribute(TransactionAttributeType.REQUIRES_NEW)
    public void createCase(CaseCommand command) {
        // expected to run in new tx?
    }
}
```

The call from `submitCase()` to `createCase()` is just a normal Java call on `this`. It does not necessarily pass through the EJB proxy. Therefore container services attached to `createCase()` may not be applied.

The correct mental model:

```text
Container behavior applies at managed invocation boundaries.
Not every Java method call is a managed invocation boundary.
```

This is one of the most important rules in the entire enterprise runtime model.

---

## 3. Container-Managed Transactions

EJB made container-managed transactions mainstream.

Instead of:

```java
connection.setAutoCommit(false);
try {
    repository.save(a);
    repository.save(b);
    connection.commit();
} catch (Exception e) {
    connection.rollback();
    throw e;
}
```

you declare the transaction boundary:

```java
@Stateless
public class ApprovalService {

    @TransactionAttribute(TransactionAttributeType.REQUIRED)
    public void approve(ApprovalCommand command) {
        caseRepository.markApproved(command.caseId());
        auditRepository.recordApproval(command.caseId());
    }
}
```

The container handles:

```text
- begin transaction if needed,
- join existing transaction if needed,
- associate transaction with thread,
- enlist transactional resources,
- commit on success,
- rollback on failure,
- suspend/resume transaction for specific attributes,
- enforce illegal transaction states.
```

But this convenience has sharp edges.

---

## 4. Transaction Attribute Types

EJB container-managed transactions use `@TransactionAttribute` and `TransactionAttributeType`.

The six attributes are:

```text
REQUIRED
REQUIRES_NEW
MANDATORY
SUPPORTS
NOT_SUPPORTED
NEVER
```

Think of each attribute as answering:

```text
If caller has a transaction, what should happen?
If caller has no transaction, what should happen?
```

---

## 5. Transaction Attribute Matrix

| Attribute | Caller has tx | Caller has no tx | Typical meaning |
|---|---|---|---|
| `REQUIRED` | join caller tx | create new tx | default business write operation |
| `REQUIRES_NEW` | suspend caller tx, create new tx | create new tx | independent unit, audit, outbox, retry segment |
| `MANDATORY` | join caller tx | fail | must be called inside existing tx |
| `SUPPORTS` | join caller tx | run without tx | read helper, optional tx participation |
| `NOT_SUPPORTED` | suspend caller tx | run without tx | non-transactional external call, long I/O |
| `NEVER` | fail | run without tx | must never be transactional |

The most common defaults:

```text
For EJB business methods, REQUIRED is usually the default.
```

But a top engineer does not rely blindly on default behavior for important boundaries. They document transaction intent explicitly at service boundary methods.

---

## 6. REQUIRED: The Default Workhorse

```java
@Stateless
public class CaseApprovalService {

    @TransactionAttribute(TransactionAttributeType.REQUIRED)
    public void approveCase(Long caseId) {
        caseRepository.markApproved(caseId);
        taskRepository.closeOpenTasks(caseId);
        auditRepository.record("CASE_APPROVED", caseId);
    }
}
```

Behavior:

```text
If caller has tx:
    join caller tx.

If caller has no tx:
    container starts new tx.
```

Use for:

```text
- normal command/use-case method,
- atomic database mutation,
- business operation that should succeed/fail as one unit.
```

Risk:

```text
If this method is called by a larger transaction, it becomes part of the larger unit.
That may make rollback scope larger than expected.
```

Example:

```java
@Stateless
public class BulkCaseService {

    @EJB
    CaseApprovalService approvalService;

    @TransactionAttribute(TransactionAttributeType.REQUIRED)
    public void approveAll(List<Long> caseIds) {
        for (Long id : caseIds) {
            approvalService.approveCase(id);
        }
    }
}
```

If `approveAll()` is one transaction and item 90 fails, the previous 89 approvals may roll back too.

That may be correct or disastrous depending on the business invariant.

---

## 7. REQUIRES_NEW: Independent Transaction Segment

```java
@Stateless
public class AuditService {

    @TransactionAttribute(TransactionAttributeType.REQUIRES_NEW)
    public void recordAudit(AuditEvent event) {
        auditRepository.insert(event);
    }
}
```

Behavior:

```text
If caller has tx:
    suspend caller tx.
    start new tx.
    commit/rollback new tx.
    resume caller tx.

If caller has no tx:
    start new tx.
```

Use for:

```text
- audit that should persist even if business tx rolls back,
- outbox record in a separate semantic unit,
- retry checkpoint,
- independent status update,
- failure log.
```

But be careful.

Example:

```java
@Stateless
public class EnforcementService {

    @EJB AuditService auditService;

    @TransactionAttribute(TransactionAttributeType.REQUIRED)
    public void submitEnforcementAction(Long caseId) {
        auditService.recordAudit(new AuditEvent("SUBMIT_ATTEMPT", caseId));

        caseRepository.submit(caseId);

        if (someValidationFails()) {
            throw new IllegalStateException("Invalid state");
        }
    }
}
```

Result:

```text
Audit committed.
Business submission rolled back.
```

This may be exactly what you want for forensic audit.

But if the audit event says `SUBMITTED` instead of `SUBMIT_ATTEMPT`, you now have misleading records.

Top-level rule:

```text
REQUIRES_NEW changes truth semantics.
Do not use it only to “make audit save work”.
Use it only when independent commit is part of the business model.
```

---

## 8. MANDATORY: Enforce Caller Boundary

```java
@Stateless
public class CaseMutationRepositoryBean {

    @TransactionAttribute(TransactionAttributeType.MANDATORY)
    public void updateStatus(Long caseId, CaseStatus status) {
        // must be called inside an existing transaction
    }
}
```

Behavior:

```text
If caller has tx:
    join caller tx.

If caller has no tx:
    container throws exception.
```

Use for:

```text
- low-level mutation component that must never define transaction boundary,
- repository-like EJB,
- internal operation that must belong to a larger use case.
```

Architectural meaning:

```text
This method is not a use-case boundary.
It is a participant in someone else's transaction.
```

This is a powerful way to encode architectural intent.

---

## 9. SUPPORTS: Conditional Transaction Participation

```java
@Stateless
public class CaseLookupService {

    @TransactionAttribute(TransactionAttributeType.SUPPORTS)
    public CaseView findCase(Long caseId) {
        return caseRepository.findView(caseId);
    }
}
```

Behavior:

```text
If caller has tx:
    join caller tx.

If caller has no tx:
    run without tx.
```

Use for:

```text
- read methods,
- helper methods,
- methods that can participate in tx but do not require one.
```

Risk:

```text
Behavior may differ subtly depending on caller.
```

Example:

```text
Inside tx:
    read may see uncommitted changes from same transaction.

Outside tx:
    read sees committed database state.
```

Therefore `SUPPORTS` is convenient but can reduce reasoning clarity.

---

## 10. NOT_SUPPORTED: Intentionally Non-Transactional

```java
@Stateless
public class ExternalScreeningClientBean {

    @TransactionAttribute(TransactionAttributeType.NOT_SUPPORTED)
    public ScreeningResult callExternalScreeningApi(ScreeningRequest request) {
        return httpClient.post(request);
    }
}
```

Behavior:

```text
If caller has tx:
    suspend caller tx.
    execute without tx.
    resume caller tx.

If caller has no tx:
    execute without tx.
```

Use for:

```text
- long external API call,
- file generation,
- report rendering,
- non-transactional computation,
- sending best-effort notification,
- operation that should not hold DB locks.
```

This is often underused.

Bad design:

```java
@TransactionAttribute(TransactionAttributeType.REQUIRED)
public void submitCase(CaseSubmission command) {
    caseRepository.lockCase(command.caseId());
    ExternalResult result = externalApi.call(command); // long network call inside tx
    caseRepository.applyResult(result);
}
```

Problem:

```text
Database transaction remains open during network I/O.
Locks live longer.
Connection is held longer.
Timeout risk increases.
Deadlock risk increases.
Throughput drops.
```

Better design:

```text
1. Persist intent in tx.
2. Commit.
3. Call external system outside tx.
4. Persist result in a new tx.
```

Or use outbox/message orchestration.

---

## 11. NEVER: Fail If Transaction Exists

```java
@Stateless
public class NonTransactionalReportExporter {

    @TransactionAttribute(TransactionAttributeType.NEVER)
    public byte[] exportLargeReport(ReportCriteria criteria) {
        return reportEngine.render(criteria);
    }
}
```

Behavior:

```text
If caller has tx:
    fail.

If caller has no tx:
    execute without tx.
```

Use when a transaction would be harmful:

```text
- large export,
- long-running operation,
- operation that must not observe transactional state,
- defensive boundary against accidental caller tx.
```

This is more assertive than `NOT_SUPPORTED`.

`NOT_SUPPORTED` says:

```text
I will suspend your transaction.
```

`NEVER` says:

```text
You are using me incorrectly if you have a transaction.
```

---

## 12. Transaction Boundary Placement

Transaction boundary should usually be placed at **application service / use-case boundary**, not random helper methods.

Good:

```java
@Stateless
public class CaseSubmissionUseCase {

    @TransactionAttribute(TransactionAttributeType.REQUIRED)
    public SubmissionResult submit(SubmitCaseCommand command) {
        CaseEntity entity = caseRepository.getForUpdate(command.caseId());
        entity.submit(command.submittedBy());
        taskRepository.createReviewTask(entity.id());
        return SubmissionResult.accepted(entity.id());
    }
}
```

Poor:

```java
public class CaseSubmissionUseCase {

    public SubmissionResult submit(SubmitCaseCommand command) {
        caseRepository.updateStatus(command.caseId(), SUBMITTED); // own tx maybe
        taskRepository.createReviewTask(command.caseId());        // own tx maybe
        auditRepository.record(command.caseId());                // own tx maybe
        return SubmissionResult.accepted(command.caseId());
    }
}
```

The poor design makes atomicity unclear.

Top-level rule:

```text
Put transaction annotations where business atomicity is defined.
```

---

## 13. Rollback Rules: System Exception vs Application Exception

One of the easiest places to make mistakes is rollback behavior.

In EJB, broadly:

```text
Runtime/system exception:
    usually marks transaction rollback.

Application exception:
    does not necessarily mark rollback unless configured.
```

Example:

```java
@ApplicationException(rollback = true)
public class CaseValidationException extends Exception {
    public CaseValidationException(String message) {
        super(message);
    }
}
```

Then:

```java
@Stateless
public class CaseService {

    @TransactionAttribute(TransactionAttributeType.REQUIRED)
    public void submit(Long caseId) throws CaseValidationException {
        if (!isValid(caseId)) {
            throw new CaseValidationException("Case cannot be submitted");
        }
        repository.submit(caseId);
    }
}
```

Without explicit rollback behavior, checked business exceptions may not roll back depending on classification.

Design implication:

```text
Exception taxonomy is part of transaction design.
```

Do not treat exception classes as mere messaging containers.

---

## 14. Checked vs Unchecked Exceptions

A simple mental model:

```text
Unchecked exception:
    normally means unexpected/programming/system failure.
    container generally treats it as rollback-worthy.

Checked application exception:
    often means expected business outcome.
    rollback depends on declaration.
```

Example expected business outcome:

```java
public class DuplicateSubmissionException extends Exception {
    // expected business rejection
}
```

Should it rollback?

Depends.

If no mutation happened before detection:

```text
rollback is irrelevant.
```

If mutation happened before detection:

```text
rollback may be required.
```

Better:

```java
@ApplicationException(rollback = true)
public class InvalidStateTransitionException extends Exception {
}
```

Architectural rule:

```text
Every checked exception thrown from transactional business boundary should have explicit rollback intent.
```

---

## 15. Marking Rollback Without Throwing Runtime Exception

Sometimes you need to mark rollback but return/throw a controlled exception.

EJB provides context APIs such as `EJBContext#setRollbackOnly()`.

Conceptually:

```java
@Stateless
public class CaseService {

    @Resource
    private SessionContext sessionContext;

    @TransactionAttribute(TransactionAttributeType.REQUIRED)
    public void transition(Long caseId, CaseStatus target) throws InvalidTransitionException {
        if (!canTransition(caseId, target)) {
            sessionContext.setRollbackOnly();
            throw new InvalidTransitionException(caseId, target);
        }

        repository.updateStatus(caseId, target);
    }
}
```

Use sparingly.

If rollback is always tied to an exception type, prefer explicit exception annotation.

---

## 16. Transaction Timeout and Long Operations

Transactions are not free.

A transaction holds:

```text
- database connection,
- locks,
- persistence context state,
- enlisted resources,
- undo/redo pressure,
- transaction manager bookkeeping.
```

Long transactions cause:

```text
- lock contention,
- deadlocks,
- timeout rollback,
- exhausted connection pool,
- larger undo retention,
- user-visible slowness,
- difficult incident analysis.
```

Dangerous pattern:

```java
@TransactionAttribute(TransactionAttributeType.REQUIRED)
public void processLargeFile(InputStream input) {
    List<Row> rows = parser.parse(input); // long CPU/I/O
    for (Row row : rows) {
        repository.insert(row);
    }
    externalApi.notifyCompletion(); // network call inside tx
}
```

Better:

```text
1. Store file metadata.
2. Commit.
3. Parse in chunks outside long DB transaction.
4. Persist chunks in bounded transactions.
5. Publish completion after commit.
```

Rule:

```text
A transaction should protect a bounded consistency change, not an entire workflow duration.
```

---

## 17. Transaction and External Systems

A database transaction does not automatically make external API calls atomic.

Example:

```java
@TransactionAttribute(TransactionAttributeType.REQUIRED)
public void approveAndNotify(Long caseId) {
    repository.approve(caseId);
    emailClient.sendApprovalEmail(caseId);
}
```

If email succeeds and DB commit fails:

```text
email was sent for an approval that did not commit.
```

If DB commit succeeds and email fails:

```text
case is approved but email was not sent.
```

Do not pretend this is one atomic transaction unless the external resource is properly enlisted in a distributed transaction, which is usually not how modern HTTP/email APIs work.

Better pattern:

```text
1. Update business state.
2. Insert outbox event in same DB transaction.
3. Commit.
4. Separate dispatcher sends email/API call.
5. Dispatcher retries idempotently.
```

This is why transaction boundaries and messaging/outbox patterns are inseparable in serious systems.

---

## 18. EJB vs `jakarta.transaction.Transactional`

EJB:

```java
@Stateless
public class CaseService {

    @TransactionAttribute(TransactionAttributeType.REQUIRED)
    public void submit() {
    }
}
```

CDI / Jakarta Transactions:

```java
@ApplicationScoped
public class CaseService {

    @Transactional(Transactional.TxType.REQUIRED)
    public void submit() {
    }
}
```

Conceptually similar:

```text
Both can declaratively control transaction boundaries.
```

But they live in different component models:

```text
EJB transaction attribute:
    part of Enterprise Beans container semantics.

jakarta.transaction.Transactional:
    interceptor binding style for CDI/managed beans.
```

Do not mix them casually.

In modernization, many teams move from:

```java
@Stateless
@TransactionAttribute(REQUIRED)
```

to:

```java
@ApplicationScoped
@Transactional(REQUIRED)
```

But migration must verify:

```text
- security behavior,
- async behavior,
- timer behavior,
- pooling assumptions,
- remote/local view assumptions,
- exception rollback behavior,
- self-invocation behavior,
- provider-specific differences.
```

---

## 19. Timer Service Mental Model

EJB Timer Service allows enterprise beans to receive timed callbacks.

Conceptually:

```text
Container scheduler
  |
  v
Timer metadata
  |
  v
EJB timeout method invocation
  |
  +-- transaction semantics
  +-- security/context semantics
  +-- concurrency semantics
  +-- retry/failure behavior depending on container
  |
  v
business callback
```

Example calendar timer:

```java
@Singleton
public class DailyCaseEscalationJob {

    @Schedule(hour = "2", minute = "0", second = "0", persistent = true)
    public void escalateOverdueCases() {
        // run every day at 02:00
    }
}
```

Programmatic timer:

```java
@Stateless
public class ReminderScheduler {

    @Resource
    private TimerService timerService;

    public void scheduleReminder(Long caseId, Duration delay) {
        TimerConfig config = new TimerConfig(caseId, true);
        timerService.createSingleActionTimer(delay.toMillis(), config);
    }
}
```

Timeout callback:

```java
@Stateless
public class ReminderTimeoutBean {

    @Timeout
    public void onTimeout(Timer timer) {
        Long caseId = (Long) timer.getInfo();
        // send reminder / update state
    }
}
```

---

## 20. Types of Timers

EJB timers can be:

```text
single-action timer:
    fires once.

interval timer:
    fires repeatedly after fixed interval.

calendar timer:
    fires according to calendar expression.

automatic timer:
    declared with @Schedule / @Schedules.

programmatic timer:
    created via TimerService.

persistent timer:
    survives server restart depending on container storage.

non-persistent timer:
    memory/runtime bound.
```

Mental model:

```text
A timer is not just a Java scheduled executor.
It is a container-managed scheduled invocation.
```

That means it may interact with:

```text
- transactions,
- clustering,
- persistence,
- failover,
- deployment lifecycle,
- security identity,
- concurrency locks.
```

---

## 21. Persistent vs Non-Persistent Timers

Persistent timer:

```text
Survives server crash/restart if container supports persistent storage.
Useful for business obligations.
```

Non-persistent timer:

```text
Does not survive restart.
Useful for cache refresh, lightweight local maintenance, ephemeral tasks.
```

Example:

```java
@Schedule(hour = "*/1", minute = "0", persistent = false)
public void refreshLocalCache() {
    cache.refresh();
}
```

For regulatory/business workflows, persistent timers sound attractive, but beware cluster semantics.

Questions to ask:

```text
- Will the timer fire once globally or once per node?
- Where is timer state stored?
- What happens during failover?
- What happens after missed executions?
- Is callback idempotent?
- Can two executions overlap?
- How is retry handled after failure?
```

If you cannot answer those, the timer is not production-ready.

---

## 22. Timer Transaction Boundaries

A timer callback is also a managed invocation.

```java
@Singleton
public class EscalationTimer {

    @Schedule(hour = "1", minute = "0", persistent = true)
    @TransactionAttribute(TransactionAttributeType.REQUIRES_NEW)
    public void runEscalation() {
        escalationService.escalateDueCases();
    }
}
```

But be careful with large batch work.

Bad:

```java
@TransactionAttribute(TransactionAttributeType.REQUIRED)
public void runEscalation() {
    List<Case> all = repository.findAllDueCases();
    for (Case c : all) {
        c.escalate();
    }
}
```

If there are 100,000 cases:

```text
one huge transaction,
long locks,
high memory,
large rollback,
timeout risk.
```

Better:

```text
Timer callback creates job execution record.
Then processes bounded chunks.
Each chunk has its own transaction.
Each item is idempotent.
Progress is checkpointed.
```

Example:

```java
@Singleton
public class EscalationTimer {

    @EJB
    EscalationChunkService chunkService;

    @Schedule(hour = "1", minute = "0", persistent = true)
    @Lock(LockType.WRITE)
    public void runEscalation() {
        while (true) {
            int processed = chunkService.processNextChunk(100);
            if (processed == 0) {
                return;
            }
        }
    }
}

@Stateless
public class EscalationChunkService {

    @TransactionAttribute(TransactionAttributeType.REQUIRES_NEW)
    public int processNextChunk(int limit) {
        List<Long> ids = repository.claimDueCases(limit);
        for (Long id : ids) {
            repository.escalateIfStillDue(id);
        }
        return ids.size();
    }
}
```

---

## 23. Timer Idempotency

Every timer callback should be designed as if it may run:

```text
- later than expected,
- more than once,
- after a server restart,
- after partial previous failure,
- concurrently with manual action,
- concurrently on another node unless prevented.
```

Therefore timer logic must be idempotent.

Bad:

```java
public void escalate(Long caseId) {
    caseRepository.setStatus(caseId, ESCALATED);
    emailClient.sendEmail(caseId);
}
```

Better:

```java
public void escalateIfEligible(Long caseId) {
    CaseEntity c = caseRepository.findForUpdate(caseId);

    if (!c.isDueForEscalation()) {
        return;
    }

    c.markEscalated();
    outboxRepository.insertIfAbsent("CASE_ESCALATED", caseId);
}
```

The safety comes from:

```text
- current-state check,
- locking or compare-and-set update,
- unique idempotency key,
- outbox insert-if-absent,
- retryable external side effects.
```

---

## 24. Async EJB Method Mental Model

EJB supports asynchronous method invocation with `@Asynchronous`.

```java
@Stateless
public class NotificationService {

    @Asynchronous
    public void sendCaseSubmittedEmail(Long caseId) {
        emailClient.sendCaseSubmitted(caseId);
    }
}
```

Caller returns immediately.

Conceptually:

```text
Caller thread
  |
  | invokes EJB async proxy
  v
Container schedules async invocation
  |
  v
Managed thread executes method later
```

Important:

```text
Async EJB is not the same as unmanaged new Thread().
```

The container controls:

```text
- thread pool,
- context behavior,
- lifecycle,
- shutdown,
- method dispatch,
- exception handling.
```

---

## 25. Async Return Types

Async method can be fire-and-forget:

```java
@Asynchronous
public void sendEmail(Long caseId) {
    emailClient.send(caseId);
}
```

Or return `Future<T>`:

```java
@Asynchronous
public Future<ScreeningResult> screen(Long caseId) {
    ScreeningResult result = screeningClient.screen(caseId);
    return new AsyncResult<>(result);
}
```

Conceptual caution:

```text
Future does not make business workflow automatically reliable.
```

If the server crashes after scheduling async work but before completion, behavior depends on container semantics. For durable work, use durable queue/outbox/job table instead of assuming async method is persistent workflow orchestration.

---

## 26. Async and Transaction Interaction

A common dangerous misconception:

```text
The async method continues inside the caller's transaction.
```

Usually, it does not behave that way as a simple continuation.

The async method is a separate managed invocation, potentially on another thread, with its own transaction semantics.

Example:

```java
@Stateless
public class CaseSubmissionService {

    @EJB NotificationService notificationService;

    @TransactionAttribute(TransactionAttributeType.REQUIRED)
    public void submit(Long caseId) {
        repository.submit(caseId);
        notificationService.sendSubmittedEmail(caseId); // async
    }
}
```

Problem:

```text
Async email may run before caller transaction commits.
```

The email method may read database state that is not committed yet, or the caller transaction may later roll back.

Better:

```text
- use transaction synchronization / after-commit event where supported,
- use CDI transactional observer AFTER_SUCCESS,
- use outbox table committed with business state,
- let dispatcher send after commit.
```

For serious systems, prefer:

```text
transactional outbox > fire-and-forget async side effect
```

unless the side effect is truly best-effort and semantically safe.

---

## 27. Async Error Handling

Fire-and-forget async method:

```java
@Asynchronous
public void syncToExternalSystem(Long caseId) {
    externalClient.sync(caseId);
}
```

If it fails:

```text
Who observes the failure?
Who retries?
Who marks the job failed?
Who alerts operations?
Who prevents duplicate execution?
```

If you cannot answer, the design is incomplete.

Better design:

```text
1. Create durable job/outbox row.
2. Async worker claims job.
3. Worker attempts delivery.
4. On success, mark delivered.
5. On failure, increment retry count and store error.
6. Expose dashboard/alert.
```

EJB async is useful for local concurrency, but it is not a replacement for durable workflow unless combined with durable state.

---

## 28. Async and Security Context

Question:

```text
When async method runs, whose identity does it use?
```

Possibilities:

```text
- caller identity propagated,
- run-as identity,
- unauthenticated/system identity,
- container-specific behavior.
```

Do not assume. Verify in your runtime.

Example:

```java
@Stateless
public class ReportService {

    @Asynchronous
    @RolesAllowed("REPORT_GENERATOR")
    public void generateSensitiveReport(Long reportId) {
        // needs security context
    }
}
```

Potential issue:

```text
The user who requested report may no longer be the identity used during async execution.
```

For auditable systems, persist actor explicitly:

```java
public record GenerateReportCommand(
    Long reportId,
    String requestedByUserId,
    Set<String> requestedByRoles,
    Instant requestedAt
) {}
```

Do not rely only on ambient thread security context for delayed work.

---

## 29. Security Annotations on EJB

Common security annotations:

```java
@RolesAllowed("CASE_OFFICER")
public void submitCase(Long caseId) {
}

@PermitAll
public CaseView viewPublicCase(Long caseId) {
}

@DenyAll
public void disabledOperation() {
}
```

Class-level:

```java
@Stateless
@RolesAllowed("CASE_MANAGER")
public class CaseManagementService {

    public void approve(Long caseId) {
    }

    @RolesAllowed("CASE_ADMIN")
    public void forceClose(Long caseId) {
    }
}
```

Mental model:

```text
Security annotation checks authorization at managed method invocation boundary.
```

Again, self-invocation matters.

```java
public void approve(Long caseId) {
    forceClose(caseId); // may bypass method-level boundary depending on invocation model
}

@RolesAllowed("CASE_ADMIN")
public void forceClose(Long caseId) {
}
```

Do not design security-critical internal calls assuming self-invocation re-checks method annotations.

---

## 30. Role-Based Boundary vs Business Policy

Container role annotations are good for coarse-grained access:

```text
Can this caller invoke this operation category?
```

But many enterprise systems need fine-grained business policy:

```text
Can this officer act on this case?
Is this case assigned to their branch?
Is this case under conflict-of-interest restriction?
Is this action allowed in current lifecycle state?
Is this user acting as delegate?
Is there a temporary access grant?
```

Do not encode all of that as roles.

Better layering:

```java
@Stateless
@RolesAllowed("CASE_OFFICER")
public class CaseActionService {

    @EJB
    CasePolicyService policyService;

    @TransactionAttribute(TransactionAttributeType.REQUIRED)
    public void submitRecommendation(SubmitRecommendationCommand command) {
        policyService.assertCanSubmitRecommendation(command.actor(), command.caseId());
        caseRepository.submitRecommendation(command.caseId(), command.recommendation());
    }
}
```

Container security:

```text
coarse access gate.
```

Domain policy:

```text
case-specific authorization and invariant check.
```

---

## 31. `@RunAs`

`@RunAs` allows an EJB to execute calls as a specified role.

Example:

```java
@Stateless
@RunAs("SYSTEM_JOB")
public class EscalationJobBean {

    @EJB
    CaseEscalationService escalationService;

    @Schedule(hour = "1", minute = "0")
    public void run() {
        escalationService.escalateDueCases();
    }
}
```

Meaning:

```text
The bean uses a configured run-as role when invoking downstream secured components.
```

Use for:

```text
- scheduled jobs,
- system maintenance,
- integration flows,
- internal service delegation.
```

Risk:

```text
Run-as can hide actor identity if not logged/audited correctly.
```

For audit-heavy systems, distinguish:

```text
technical executor:
    SYSTEM_JOB

business actor:
    user / system / agency / batch process that caused the action
```

Persist both when needed.

---

## 32. Transaction + Security Ordering

At a managed boundary, several concerns are applied.

Conceptually:

```text
caller
  |
  v
security check
  |
  v
transaction setup
  |
  v
interceptors
  |
  v
bean method
```

Exact ordering can involve specification/container details and interceptor priority, but architecturally you should design assuming:

```text
Authorization failure should prevent business mutation.
Transaction boundary should be clear and not relied upon for authorization.
Audit should know whether action was attempted, denied, succeeded, or failed.
```

A robust audit model distinguishes:

```text
- access denied attempt,
- validation rejected attempt,
- business operation started,
- business operation committed,
- business operation rolled back,
- async/timer retry attempt.
```

---

## 33. Transaction + Timer + Security Example: Case Escalation

Consider a regulatory case management system.

Requirement:

```text
Every night, overdue cases should be escalated.
Each escalation must be auditable.
Only cases still overdue should be escalated.
Job must be safe under retry.
Job must not hold one huge transaction.
```

Design:

```java
@Singleton
@RunAs("SYSTEM_JOB")
public class CaseEscalationTimer {

    @EJB
    CaseEscalationChunkService chunkService;

    @Schedule(hour = "1", minute = "0", second = "0", persistent = true)
    @Lock(LockType.WRITE)
    public void runNightlyEscalation() {
        while (true) {
            int processed = chunkService.processChunk(100);
            if (processed == 0) {
                return;
            }
        }
    }
}
```

Chunk service:

```java
@Stateless
public class CaseEscalationChunkService {

    @TransactionAttribute(TransactionAttributeType.REQUIRES_NEW)
    public int processChunk(int limit) {
        List<Long> ids = caseRepository.claimOverdueCases(limit);

        for (Long caseId : ids) {
            CaseEntity c = caseRepository.findForUpdate(caseId);
            if (c.isStillOverdue()) {
                c.escalate("SYSTEM_JOB");
                outbox.insertIfAbsent("CASE_ESCALATED", caseId);
            }
        }

        return ids.size();
    }
}
```

Why this is robust:

```text
- timer only orchestrates,
- chunk service owns transaction,
- each chunk bounded,
- escalation checks current state,
- outbox makes notification reliable,
- run-as gives system role,
- actor is explicit,
- duplicate execution is tolerable.
```

---

## 34. Transaction + Async Example: Screening Request

Requirement:

```text
When a case is submitted, request external screening.
Submission must commit even if external system is down.
Screening must retry.
User should not wait.
```

Bad:

```java
@TransactionAttribute(TransactionAttributeType.REQUIRED)
public void submit(Long caseId) {
    repository.submit(caseId);
    screeningClient.callExternalApi(caseId);
}
```

Still weak:

```java
@TransactionAttribute(TransactionAttributeType.REQUIRED)
public void submit(Long caseId) {
    repository.submit(caseId);
    asyncScreeningService.screen(caseId);
}
```

Better:

```java
@TransactionAttribute(TransactionAttributeType.REQUIRED)
public void submit(Long caseId) {
    repository.submit(caseId);
    outbox.insertIfAbsent("SCREENING_REQUESTED", caseId);
}
```

Then worker:

```java
@Stateless
public class ScreeningOutboxWorker {

    @TransactionAttribute(TransactionAttributeType.REQUIRES_NEW)
    public Optional<OutboxItem> claimNext() {
        return outboxRepository.claimNext("SCREENING_REQUESTED");
    }

    @TransactionAttribute(TransactionAttributeType.NOT_SUPPORTED)
    public ScreeningResult callExternal(OutboxItem item) {
        return screeningClient.screen(item.aggregateId());
    }

    @TransactionAttribute(TransactionAttributeType.REQUIRES_NEW)
    public void recordResult(OutboxItem item, ScreeningResult result) {
        screeningRepository.saveResult(item.aggregateId(), result);
        outboxRepository.markDone(item.id());
    }
}
```

This design separates:

```text
- business transaction,
- external call,
- retry state,
- result persistence.
```

---

## 35. Common Failure Modes

### 35.1 Self-Invocation Bypasses Container Boundary

Symptom:

```text
@TransactionAttribute(REQUIRES_NEW) seems ignored.
@RolesAllowed seems ignored.
@Asynchronous seems not async.
```

Cause:

```text
Method called through this.method(), not through EJB proxy.
```

Fix:

```text
Move boundary to separate bean.
Inject proxy.
Avoid internal calls for boundary behavior.
```

---

### 35.2 Long Transaction Around External I/O

Symptom:

```text
connection pool exhausted,
lock waits,
deadlocks,
transaction timeout.
```

Cause:

```text
HTTP/file/email call inside REQUIRED transaction.
```

Fix:

```text
move external I/O outside tx,
use NOT_SUPPORTED,
commit intent first,
use outbox/job pattern.
```

---

### 35.3 Wrong Rollback Assumption for Checked Exception

Symptom:

```text
method throws business exception but DB changes still committed.
```

Cause:

```text
checked application exception did not mark rollback.
```

Fix:

```text
use @ApplicationException(rollback = true),
setRollbackOnly carefully,
or redesign exception taxonomy.
```

---

### 35.4 Timer Runs Twice

Symptom:

```text
duplicate emails,
duplicate escalation,
double-generated report.
```

Cause:

```text
cluster/timer failover/retry/overlap not handled.
```

Fix:

```text
make callback idempotent,
use locks/claim rows,
unique idempotency keys,
check current state,
understand container cluster timer semantics.
```

---

### 35.5 Async Work Lost or Invisible

Symptom:

```text
user action succeeds but async side effect silently fails.
```

Cause:

```text
fire-and-forget async without durable job/error tracking.
```

Fix:

```text
use outbox/job table,
record attempts,
retry,
alert,
make side effects idempotent.
```

---

### 35.6 Security Context Missing in Background Work

Symptom:

```text
scheduled/async job fails authorization or audit actor is null.
```

Cause:

```text
ambient user identity not available in background execution.
```

Fix:

```text
use @RunAs for technical identity,
persist business actor explicitly,
separate system action from user action.
```

---

## 36. Design Heuristics for Top-Level Engineering

### 36.1 Transaction Heuristics

```text
Use REQUIRED for normal atomic use-case boundaries.
Use REQUIRES_NEW only when independent commit is semantically correct.
Use MANDATORY for internal mutation participants.
Use SUPPORTS cautiously for read/helper methods.
Use NOT_SUPPORTED around long non-transactional I/O.
Use NEVER to defensively reject transactional callers.
```

---

### 36.2 Timer Heuristics

```text
Timer callback should orchestrate, not do huge work in one transaction.
Timer work should be idempotent.
Persistent timer requires cluster/failover understanding.
Business obligation timers need durable state.
Non-critical local tasks may use non-persistent timers.
```

---

### 36.3 Async Heuristics

```text
Async is not durable workflow by itself.
Async failure must be observable.
Do not assume caller transaction has committed.
Do not rely only on ambient user identity.
Use durable job/outbox for business-critical side effects.
```

---

### 36.4 Security Heuristics

```text
Use role annotations for coarse boundary checks.
Use domain policy for case/resource-specific authorization.
Do not assume self-invocation re-applies security.
For jobs, separate technical executor from business actor.
Audit denied, attempted, succeeded, failed, and retried actions distinctly.
```

---

## 37. Decision Matrix

| Problem | Prefer | Avoid |
|---|---|---|
| Normal atomic use case | `REQUIRED` at service boundary | transaction on every repository method without design |
| Audit must survive rollback | `REQUIRES_NEW` with precise event semantics | misleading committed audit facts |
| Low-level mutation must be inside caller tx | `MANDATORY` | hidden autonomous transaction |
| Long HTTP call | `NOT_SUPPORTED` or outbox | holding DB transaction during I/O |
| Scheduled business job | persistent timer + idempotent job state | non-idempotent callback |
| Local cache refresh | non-persistent timer | over-engineered persistent workflow |
| User-triggered side effect after commit | outbox / transactional observer | async call before commit |
| Fire-and-forget non-critical work | `@Asynchronous` with logging | silent failure |
| Durable retryable work | job table / queue / outbox | plain async method only |
| Coarse authorization | `@RolesAllowed` | business policy encoded as many roles |
| Resource-specific authorization | domain policy service | only container role check |

---

## 38. Practical Review Checklist

When reviewing EJB transaction/timer/async/security code, ask:

### Transaction

```text
[ ] Where is the business transaction boundary?
[ ] Is the transaction attribute explicit for important methods?
[ ] Are external calls outside transaction?
[ ] Are checked exceptions rollback behavior explicit?
[ ] Is REQUIRES_NEW semantically justified?
[ ] Could self-invocation bypass the intended attribute?
[ ] Are batch operations chunked?
[ ] Are transaction timeouts considered?
```

### Timer

```text
[ ] Is the timer persistent or non-persistent intentionally?
[ ] Is cluster behavior understood?
[ ] Is callback idempotent?
[ ] Can executions overlap?
[ ] Is retry behavior safe?
[ ] Is work chunked?
[ ] Is progress checkpointed?
[ ] Is failure observable?
```

### Async

```text
[ ] Is async work business-critical?
[ ] If critical, is it durable?
[ ] Is failure tracked?
[ ] Is retry implemented?
[ ] Does it depend on caller transaction commit?
[ ] Does it need caller identity?
[ ] Is idempotency implemented?
```

### Security

```text
[ ] Are role annotations used at proper managed boundaries?
[ ] Is fine-grained policy checked in domain/application logic?
[ ] Are background jobs using explicit run-as/system identity?
[ ] Is actor captured for audit?
[ ] Are denied attempts logged where required?
```

---

## 39. Mental Model Summary

EJB transaction, timer, async, and security features are not isolated annotations.

They are all examples of the same deeper idea:

```text
The container controls the invocation boundary.
At that boundary, the container may attach operational semantics.
```

The boundary can include:

```text
- transaction begin/join/suspend/resume/commit/rollback,
- security authorization,
- run-as identity,
- timer callback semantics,
- async scheduling,
- pooling and concurrency,
- interceptor chain,
- lifecycle constraints.
```

Therefore the most important question is always:

```text
Did this call pass through the managed boundary?
```

If yes, container semantics may apply.

If no, it is just Java.

---

## 40. What You Should Be Able to Do After This Part

You should now be able to:

- explain all six EJB transaction attributes,
- choose transaction boundaries based on business atomicity,
- avoid long transactions around external I/O,
- model rollback behavior intentionally,
- distinguish EJB transaction annotations from `jakarta.transaction.Transactional`,
- design timer callbacks safely,
- reason about persistent vs non-persistent timers,
- design idempotent scheduled jobs,
- understand async method risks,
- avoid assuming async work is durable,
- separate role-based container security from domain authorization,
- use `@RunAs` carefully,
- diagnose self-invocation boundary bugs,
- review enterprise code for transaction/timer/async/security failure modes.

---

## 41. Connection to the Next Part

This part focused on EJB-specific runtime boundaries.

The next part moves into common Jakarta annotations and resource injection:

```text
Part 023 — Jakarta Common Annotations and Resource Injection
```

There we will study:

```text
- @PostConstruct,
- @PreDestroy,
- @Resource,
- @Generated,
- @Priority,
- security annotations,
- resource injection,
- DataSource/JMS/executor/mail session injection,
- JNDI/resource reference indirection,
- deployment descriptor interaction,
- debugging failed resource injection.
```

That will connect EJB/CDI lifecycle with external container-managed resources.

---

# End of Part 022

Status: Part 022 completed.  
Series status: not finished.  
Next: Part 023 — Jakarta Common Annotations and Resource Injection.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 021 — Stateless, Stateful, Singleton Beans and Pooling Semantics](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-021.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 023 — Jakarta Common Annotations and Resource Injection](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-023.md)
