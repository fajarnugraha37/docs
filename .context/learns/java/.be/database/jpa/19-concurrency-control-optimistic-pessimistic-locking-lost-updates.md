# Part 19 — Concurrency Control: Optimistic Locking, Pessimistic Locking, and Lost Updates

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `19-concurrency-control-optimistic-pessimistic-locking-lost-updates.md`  
> Scope: Java 8–25, JPA 2.x `javax.persistence`, Jakarta Persistence 3.x `jakarta.persistence`, Hibernate ORM 5/6/7, EclipseLink 2/3/4

---

## 1. Why This Matters

Concurrency bug pada ORM jarang terlihat seperti bug Java biasa. Ia sering muncul sebagai:

- data user A menimpa perubahan user B,
- status workflow lompat tanpa melewati valid transition,
- approval lama mengalahkan decision terbaru,
- saldo/count/kuota salah walau semua request “berhasil”,
- deadlock sporadis di production,
- `OptimisticLockException` muncul di endpoint yang sebelumnya stabil,
- batch job diam-diam melewati `@Version`,
- cache mengembalikan state lama,
- API update partial menghapus data karena detached entity stale.

Di ORM, concurrency bukan hanya soal `synchronized`, thread-safety, atau transaction isolation database. Concurrency adalah interaksi antara:

1. **database isolation**,  
2. **row/version state**,  
3. **persistence context state**,  
4. **flush timing**,  
5. **detached object lifecycle**,  
6. **provider SQL generation**,  
7. **cache visibility**,  
8. **domain invariant**.

Engineer level biasa biasanya tahu:

```java
@Version
private Long version;
```

Engineer level tinggi paham bahwa `@Version` hanyalah satu alat dalam desain concurrency. Ia tidak otomatis menyelesaikan semua masalah seperti write skew, concurrent insert, invariant multi-row, stale command, stale UI form, bulk update bypass, native SQL bypass, atau cache invalidation.

---

## 2. Core Mental Model

### 2.1 ORM concurrency adalah state comparison, bukan magic lock

ORM tidak “melindungi object Java” di semua tempat. ORM hanya bisa mengontrol state yang ia tahu, pada boundary yang ia kelola.

Simplified optimistic locking:

```text
T1 reads row version = 7
T2 reads row version = 7

T1 updates row where id = 10 and version = 7
DB row version becomes 8

T2 updates row where id = 10 and version = 7
0 rows affected
Provider throws OptimisticLockException / StaleObjectStateException equivalent
```

Yang penting bukan sekadar ada kolom `version`, tetapi SQL update-nya menjadi:

```sql
update case_file
set status = ?, version = ?
where id = ?
  and version = ?;
```

Jika `where version = ?` tidak ada, update kedua bisa sukses dan menimpa update pertama.

---

### 2.2 Pessimistic locking adalah database-level coordination

Pessimistic locking memakai mekanisme database, misalnya `SELECT ... FOR UPDATE`, untuk menahan row supaya transaksi lain tidak bisa melakukan update tertentu sampai lock dilepas.

Simplified:

```text
T1 selects case_file id=10 for update
T1 holds DB row lock

T2 tries select/update same row
T2 waits, times out, or deadlocks depending DB and lock order
```

Pessimistic locking bukan “lebih aman secara absolut”. Ia menukar risiko **lost update** dengan risiko:

- blocking,
- timeout,
- deadlock,
- lower throughput,
- lock escalation pada database tertentu,
- long transaction hazard.

---

### 2.3 `@Version` protects rows, not all business invariants

`@Version` sangat baik untuk mencegah stale update pada **row/entity yang sama**.

Tetapi banyak invariant enterprise berada di luar satu row:

```text
Invariant:
A case cannot have more than 3 active reviewers.

T1 counts active reviewers = 2
T2 counts active reviewers = 2
T1 inserts reviewer A
T2 inserts reviewer B
Now active reviewers = 4
```

Tidak ada row yang sama yang di-update. `@Version` pada reviewer row baru tidak membantu. Ini contoh **write skew / multi-row invariant violation**.

Solusi bisa berupa:

- lock aggregate root row,
- version aggregate root ketika child berubah,
- unique/partial constraint,
- database trigger/constraint,
- serializable isolation untuk area sempit,
- command serialization,
- domain-level concurrency token.

---

## 3. Specification-Level Concept

Jakarta Persistence mendefinisikan locking melalui konsep:

- `@Version`,
- `LockModeType`,
- optimistic locking,
- pessimistic locking,
- `EntityManager.lock()`,
- `EntityManager.find(..., LockModeType)`;
- `Query.setLockMode(...)`,
- lock timeout hints,
- exceptions seperti `OptimisticLockException`, `PessimisticLockException`, dan `LockTimeoutException`.

Jakarta Persistence menyatakan entity dapat memiliki version field/property yang digunakan provider untuk optimistic locking. Specification juga mendefinisikan lock modes yang dapat diminta melalui `EntityManager` dan query. citeturn439875search0

`LockModeType` pada Jakarta Persistence mengelompokkan mode seperti:

```java
LockModeType.NONE
LockModeType.OPTIMISTIC
LockModeType.OPTIMISTIC_FORCE_INCREMENT
LockModeType.PESSIMISTIC_READ
LockModeType.PESSIMISTIC_WRITE
LockModeType.PESSIMISTIC_FORCE_INCREMENT
LockModeType.READ   // legacy synonym-ish for OPTIMISTIC
LockModeType.WRITE  // legacy synonym-ish for OPTIMISTIC_FORCE_INCREMENT
```

API docs Jakarta Persistence menjelaskan bahwa lock mode bisa diminta lewat `EntityManager.lock()`, `find()`, `refresh()`, atau `TypedQuery.setLockMode(...)`, dan lock mode selain `NONE` ditujukan untuk mencegah dirty read dan non-repeatable read pada locked entity data dalam transaksi saat ini. citeturn439875search11

---

## 4. Optimistic Locking

### 4.1 Kapan optimistic locking cocok

Optimistic locking cocok ketika:

- conflict jarang,
- transaction relatif pendek,
- user bisa diminta retry/refresh,
- throughput lebih penting daripada blocking,
- domain menerima conflict detection di akhir transaksi,
- sebagian besar request membaca, sebagian kecil menulis.

Contoh cocok:

- update profile,
- update case metadata,
- approve/reject case decision,
- edit correspondence draft,
- maintain configuration kecil,
- update application status.

---

### 4.2 Basic mapping

Jakarta line:

```java
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Version;

@Entity
public class CaseFile {
    @Id
    private Long id;

    @Version
    private Long version;

    private String status;
    private String assignedOfficer;

    protected CaseFile() {}

    public void assignTo(String officer) {
        if (officer == null || officer.isBlank()) {
            throw new IllegalArgumentException("officer is required");
        }
        this.assignedOfficer = officer;
    }
}
```

Java 8 / legacy JPA line:

```java
import javax.persistence.Entity;
import javax.persistence.Id;
import javax.persistence.Version;
```

Modern Jakarta line:

```java
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Version;
```

The conceptual behavior is the same, but packages and provider version compatibility differ.

---

### 4.3 Generated SQL mental model

Given:

```java
CaseFile c = em.find(CaseFile.class, 10L);
c.assignTo("officer-2");
```

On flush, optimistic locking normally produces SQL conceptually like:

```sql
update case_file
set assigned_officer = ?,
    version = ?
where id = ?
  and version = ?;
```

If affected row count is `0`, provider interprets it as stale update.

```text
0 rows updated does not mean row does not exist only.
It can mean row exists but version no longer matches.
```

Hibernate documentation describes optimistic locking as allowing concurrent transactions to proceed and verifying before commit that no other transaction has modified the affected data; conflict detection results in rollback. citeturn439875search2

---

### 4.4 Version field types

Common version types:

```java
@Version
private Long version;
```

or:

```java
@Version
private Integer version;
```

or timestamp-based:

```java
@Version
private Instant version;
```

Practical recommendation:

```text
Prefer numeric version for core domain entities.
```

Reason:

- predictable increment,
- easier debugging,
- no timestamp precision mismatch,
- less database/timezone/provider precision risk,
- easier API concurrency token.

Timestamp version can be acceptable, but be careful with:

- database timestamp precision,
- JVM vs DB timestamp generation,
- timezone mapping,
- truncation between Java type and column type.

Hibernate User Guide documents that Jakarta Persistence supports optimistic locking using numeric or timestamp version strategy via `@Version`; the stable Hibernate guide also lists valid version attribute types under optimistic locking. citeturn439875search3

---

## 5. Lost Update

### 5.1 The classic lost update

```text
Initial:
case_file(id=10, status='DRAFT', version=1)

T1 reads status='DRAFT', version=1
T2 reads status='DRAFT', version=1

T1 sets status='SUBMITTED'
T1 commits -> version=2

T2 sets status='CANCELLED'
T2 commits
```

Without optimistic locking:

```text
Final status = CANCELLED
T1's submitted change is lost
```

With optimistic locking:

```text
T2 update where version=1 affects 0 rows
T2 fails
Final status remains SUBMITTED unless T2 retries intentionally
```

---

### 5.2 Lost update in API form

A common enterprise bug:

```text
10:00 User A opens edit form version=5
10:01 User B updates same case to version=6
10:05 User A submits old form version=5
```

If backend does:

```java
CaseFile managed = em.find(CaseFile.class, id);
managed.setTitle(request.title());
managed.setDescription(request.description());
```

But never checks request version, then User A may overwrite newer fields depending patch logic.

Better:

```java
public void updateCase(UpdateCaseCommand command) {
    CaseFile managed = em.find(CaseFile.class, command.caseId());

    if (!Objects.equals(managed.getVersion(), command.expectedVersion())) {
        throw new StaleCommandException(
            "Case was modified. Refresh before updating."
        );
    }

    managed.updateDetails(command.title(), command.description());
}
```

This catches staleness **before** applying command logic.

Still keep `@Version`, because application-level check alone is not enough against race between check and commit.

---

### 5.3 Lost update through detached merge

Dangerous pattern:

```java
@PutMapping("/cases/{id}")
@Transactional
public CaseDto update(@PathVariable Long id, @RequestBody CaseFile detached) {
    detached.setId(id);
    CaseFile merged = em.merge(detached);
    return mapper.toDto(merged);
}
```

Why dangerous:

- client controls entity shape,
- missing fields may become null,
- stale detached state can overwrite managed state,
- child collections can be replaced,
- security-sensitive fields may be overwritten,
- version may be missing or manipulated,
- merge copies state; it does not “reattach safely”.

Better:

```java
@Transactional
public void changePriority(ChangePriorityCommand command) {
    CaseFile caseFile = em.find(CaseFile.class, command.caseId());

    if (!caseFile.versionEquals(command.expectedVersion())) {
        throw new StaleCommandException();
    }

    caseFile.changePriority(command.priority(), command.reason());
}
```

---

## 6. LockModeType Deep Dive

### 6.1 `OPTIMISTIC`

Use when you want to ensure the entity has not changed by transaction end.

```java
CaseFile c = em.find(
    CaseFile.class,
    id,
    LockModeType.OPTIMISTIC
);
```

Meaning:

```text
I am reading this entity and I care if it changes concurrently.
```

Typical use:

- read entity for decision,
- compute based on current state,
- later update another entity but still want read entity freshness.

---

### 6.2 `OPTIMISTIC_FORCE_INCREMENT`

Use when you want to increment version even if no direct field changed.

```java
CaseFile c = em.find(
    CaseFile.class,
    id,
    LockModeType.OPTIMISTIC_FORCE_INCREMENT
);
```

Meaning:

```text
This transaction logically modifies the aggregate even if the root row has no scalar field changes.
```

Useful for aggregate root versioning:

```java
@Transactional
public void addReviewer(Long caseId, String reviewerId) {
    CaseFile caseFile = em.find(
        CaseFile.class,
        caseId,
        LockModeType.OPTIMISTIC_FORCE_INCREMENT
    );

    caseFile.addReviewer(reviewerId);
}
```

Why:

- child insert might not update parent version by default,
- other users editing case root should detect aggregate-level change,
- version becomes aggregate concurrency token.

---

### 6.3 `PESSIMISTIC_READ`

Conceptually:

```text
I want to lock this entity for stable read; other writers should be constrained depending DB/provider behavior.
```

Example:

```java
CaseFile c = em.find(
    CaseFile.class,
    id,
    LockModeType.PESSIMISTIC_READ
);
```

Database behavior varies. Some databases do not have a clean shared row lock equivalent for every scenario, so provider/dialect may translate differently.

---

### 6.4 `PESSIMISTIC_WRITE`

Conceptually:

```text
I intend to update this entity; concurrent writers should wait/fail.
```

Example:

```java
CaseFile c = em.find(
    CaseFile.class,
    id,
    LockModeType.PESSIMISTIC_WRITE
);
```

Generated SQL often resembles:

```sql
select *
from case_file
where id = ?
for update;
```

Actual syntax depends on dialect:

- Oracle: `FOR UPDATE`, optional wait/nowait variants,
- PostgreSQL: `FOR UPDATE`, `FOR SHARE`, `NOWAIT`, `SKIP LOCKED`,
- MySQL/InnoDB: `FOR UPDATE`, `LOCK IN SHARE MODE` / dialect variants,
- SQL Server: locking hints such as `UPDLOCK`, depending provider/dialect.

Hibernate 7 introduction summarizes two basic approaches to data concurrency: optimistic locking using `@Version`, and database-level pessimistic locking. citeturn439875search12

---

### 6.5 `PESSIMISTIC_FORCE_INCREMENT`

Combination:

```text
Acquire database-level lock and increment version.
```

Use when:

- contention is expected,
- you want blocking coordination,
- you also want version token to change for detached clients/cache/API.

Example:

```java
CaseFile c = em.find(
    CaseFile.class,
    id,
    LockModeType.PESSIMISTIC_FORCE_INCREMENT
);
```

This is heavier than ordinary optimistic locking.

---

## 7. Hibernate Behavior

### 7.1 Hibernate version checking

Hibernate uses version columns in generated DML to detect stale updates/deletes.

Conceptually:

```sql
update case_file
set status = ?, version = ?
where id = ? and version = ?
```

For delete:

```sql
delete from case_file
where id = ? and version = ?
```

If update/delete count is zero, Hibernate detects stale state.

Common exception chain in Spring/Hibernate stack:

```text
jakarta.persistence.OptimisticLockException
org.hibernate.StaleObjectStateException
org.springframework.orm.ObjectOptimisticLockingFailureException
```

Exact exception depends on API layer.

---

### 7.2 Hibernate lock request APIs

JPA-style:

```java
em.lock(entity, LockModeType.OPTIMISTIC_FORCE_INCREMENT);
```

Hibernate native style:

```java
session.buildLockRequest(
    new LockOptions(LockMode.PESSIMISTIC_WRITE)
).lock(entity);
```

Use JPA-style unless you need provider-specific features.

---

### 7.3 Hibernate `@OptimisticLock` and excluded fields

Hibernate has provider-specific features to exclude fields from optimistic lock consideration or use dirty/all-column optimistic strategies.

Example conceptual use case:

```java
@org.hibernate.annotations.OptimisticLock(excluded = true)
private Instant lastViewedAt;
```

Meaning:

```text
Changing this field should not force optimistic version conflict.
```

Be careful. Excluding fields can hide meaningful conflicts.

Acceptable candidates:

- `lastViewedAt`,
- non-critical metrics,
- derived/cache-like columns.

Bad candidates:

- status,
- assigned officer,
- approval decision,
- amount,
- legal classification,
- escalation level.

---

### 7.4 Hibernate dynamic update and optimistic locking

`@DynamicUpdate` changes generated update SQL to include only dirty columns.

```java
@DynamicUpdate
@Entity
class CaseFile { ... }
```

This is not a replacement for `@Version`.

Without version, dynamic update can reduce column overwrite, but it does not fully solve semantic lost update.

Example:

```text
T1 changes title
T2 changes status
```

Dynamic update may allow both if different columns. But if domain invariant says status change depends on title, you still need version or explicit coordination.

---

### 7.5 Hibernate bulk update bypasses persistence context/version semantics

JPQL bulk update:

```java
em.createQuery("""
    update CaseFile c
    set c.status = :status
    where c.expiredAt < :now
""")
.setParameter("status", CaseStatus.EXPIRED)
.setParameter("now", now)
.executeUpdate();
```

Important:

```text
Bulk update bypasses managed entity dirty checking.
It may not update version unless explicitly included.
It leaves existing persistence context stale.
Entity listeners may not run as expected.
```

Safer pattern:

```java
int count = em.createQuery("""
    update CaseFile c
    set c.status = :status,
        c.version = c.version + 1
    where c.expiredAt < :now
""")
.setParameter("status", CaseStatus.EXPIRED)
.setParameter("now", now)
.executeUpdate();

em.clear();
```

But not all version types support arithmetic increment in JPQL. Test provider/database behavior.

---

## 8. EclipseLink Behavior

### 8.1 EclipseLink default consistency stance

EclipseLink documentation states that by default, EclipseLink assumes the application is responsible for data consistency unless locking is configured, and it supports both optimistic and pessimistic locking. citeturn439875search5

This matters because relying on “provider will protect me automatically” is a weak assumption.

For core mutable entities, be explicit:

```java
@Version
private Long version;
```

---

### 8.2 EclipseLink optimistic locking extensions

EclipseLink has `@OptimisticLocking` extension, allowing different optimistic locking policies, not only version column strategy. EclipseLink documentation says `@OptimisticLocking` specifies the type of optimistic locking EclipseLink should use when updating or deleting entities. citeturn439875search15

Common strategies include concepts like:

- version column,
- changed columns,
- all columns,
- selected columns.

Practical recommendation:

```text
Prefer standard @Version for cross-provider clarity.
Use EclipseLink extensions only when the schema cannot support a version column or when you deliberately accept provider lock-in.
```

---

### 8.3 EclipseLink pessimistic locking

EclipseLink supports JPA pessimistic locking modes and translates them through its database platform.

Same warning:

```text
Do not assume the SQL generated for PESSIMISTIC_READ/WRITE is identical to Hibernate.
```

Test on the target database.

Especially test:

- timeout behavior,
- lock wait exception type,
- generated SQL,
- interaction with pagination,
- interaction with joined fetch,
- behavior when entity is already in shared cache.

---

## 9. Database Isolation vs ORM Locking

### 9.1 Isolation levels are not the same as ORM optimistic locking

Common isolation levels:

- READ UNCOMMITTED,
- READ COMMITTED,
- REPEATABLE READ,
- SERIALIZABLE,
- snapshot isolation variants.

Optimistic locking works by comparing version at update/delete time.

Database isolation controls visibility and ordering of reads/writes at database transaction level.

They overlap but are not equivalent.

---

### 9.2 READ COMMITTED + `@Version`

Typical enterprise default:

```text
Database isolation: READ COMMITTED
ORM concurrency: @Version
```

This is often a good baseline:

- avoids many lost updates,
- good throughput,
- conflict detected at write/commit,
- less blocking than pessimistic locks.

But still vulnerable to:

- multi-row invariant violation,
- write skew,
- aggregate child-only changes not bumping root version,
- stale decisions based on earlier reads unless locked/versioned,
- concurrent inserts.

---

### 9.3 SERIALIZABLE is not a silver bullet

Serializable isolation can prevent many anomalies, but:

- costs more,
- may abort transactions,
- provider/app must retry correctly,
- database implementations differ,
- long transactions become dangerous,
- deadlock/serialization failure still possible.

Use it surgically, not globally by default.

---

## 10. Aggregate Versioning

### 10.1 Problem: child changes do not always bump parent version

Domain:

```text
CaseFile aggregate root
- CaseReviewer children
- CaseDocument children
- CaseDecision children
```

If you insert a reviewer row, does `case_file.version` increment?

Not necessarily.

If the parent row is not updated, the parent version may not change.

That means a stale user editing the parent may not detect that the aggregate changed.

---

### 10.2 Pattern: force increment root version on aggregate mutation

```java
@Transactional
public void addReviewer(AddReviewerCommand command) {
    CaseFile caseFile = em.find(
        CaseFile.class,
        command.caseId(),
        LockModeType.OPTIMISTIC_FORCE_INCREMENT
    );

    caseFile.addReviewer(command.reviewerId());
}
```

Mental model:

```text
Even though the parent scalar fields did not change,
the aggregate changed.
Therefore the aggregate version should change.
```

---

### 10.3 Alternative: explicit aggregate version table

For complex systems:

```text
case_file(id, status, ...)
case_file_version(case_id, version)
case_reviewer(...)
case_document(...)
```

Every aggregate mutation updates `case_file_version`.

This can be useful when:

- root table is huge/heavily indexed,
- root row update causes unwanted side effects,
- multiple bounded contexts mutate different child sets,
- you need a stable concurrency token separate from root data.

But it adds complexity.

---

## 11. Pessimistic Locking Design

### 11.1 When pessimistic locking is appropriate

Use pessimistic locking when:

- conflict is likely,
- retry cost is high,
- user experience cannot tolerate conflict at the end,
- operation must serialize access to scarce resource,
- you update counters/allocations/queues,
- you need to claim work exactly once.

Examples:

- assigning next available case,
- claiming task from queue,
- reserving quota,
- preventing two officers from submitting final decision simultaneously,
- sequence-like domain number allocation,
- payment-like state transition.

---

### 11.2 Work claiming example

```java
@Transactional
public Optional<Task> claimNextTask(String officerId) {
    List<Task> tasks = em.createQuery("""
        select t
        from Task t
        where t.status = :open
        order by t.priority desc, t.createdAt asc
    """, Task.class)
    .setParameter("open", TaskStatus.OPEN)
    .setMaxResults(1)
    .setLockMode(LockModeType.PESSIMISTIC_WRITE)
    .getResultList();

    if (tasks.isEmpty()) {
        return Optional.empty();
    }

    Task task = tasks.get(0);
    task.claimBy(officerId);
    return Optional.of(task);
}
```

Potential issue:

```text
Without SKIP LOCKED, concurrent workers may block on same first row.
```

Provider-specific/native SQL may be better for high-throughput queues:

```sql
select *
from task
where status = 'OPEN'
order by priority desc, created_at asc
fetch first 1 row only
for update skip locked;
```

This is database-specific. Use native query deliberately if needed.

---

### 11.3 Lock timeout

JPA hint example:

```java
Map<String, Object> hints = Map.of(
    "jakarta.persistence.lock.timeout", 3000
);

CaseFile c = em.find(
    CaseFile.class,
    id,
    LockModeType.PESSIMISTIC_WRITE,
    hints
);
```

Legacy JPA:

```java
Map<String, Object> hints = Map.of(
    "javax.persistence.lock.timeout", 3000
);
```

Caution:

```text
Provider/database support varies.
Always test actual timeout behavior on target database.
```

---

### 11.4 Deadlock risk

Deadlock example:

```text
T1 locks Case A
T2 locks Case B
T1 tries lock Case B
T2 tries lock Case A
Deadlock
```

Fix pattern:

```text
Always acquire locks in deterministic order.
```

Example:

```java
List<Long> orderedIds = caseIds.stream()
    .sorted()
    .toList();

List<CaseFile> cases = em.createQuery("""
    select c
    from CaseFile c
    where c.id in :ids
    order by c.id asc
""", CaseFile.class)
.setParameter("ids", orderedIds)
.setLockMode(LockModeType.PESSIMISTIC_WRITE)
.getResultList();
```

But note:

```text
SQL IN result ordering and lock acquisition order may still vary by database execution plan.
For critical sections, verify with target DB or lock one-by-one in sorted order.
```

---

## 12. Write Skew and Multi-Row Invariants

### 12.1 Write skew example

Invariant:

```text
At least one active approver must remain assigned to a case.
```

Concurrent transactions:

```text
T1 checks active approvers = [A, B]
T2 checks active approvers = [A, B]

T1 removes A
T2 removes B

Final: no active approver
```

Each transaction updated different row. Row-level `@Version` on approver may not conflict.

---

### 12.2 Solution options

#### Option A — Lock aggregate root

```java
CaseFile c = em.find(
    CaseFile.class,
    caseId,
    LockModeType.PESSIMISTIC_WRITE
);

c.removeApprover(approverId);
```

Pros:

- simple mental model,
- serializes aggregate mutation.

Cons:

- lower throughput,
- blocking,
- deadlock risk if multiple roots locked.

#### Option B — Force increment aggregate root version

```java
CaseFile c = em.find(
    CaseFile.class,
    caseId,
    LockModeType.OPTIMISTIC_FORCE_INCREMENT
);

c.removeApprover(approverId);
```

Pros:

- less blocking,
- conflict detected.

Cons:

- conflict at commit,
- user/retry handling required.

#### Option C — Database constraint

Example:

```text
unique constraint / check constraint / exclusion constraint / trigger
```

Pros:

- strongest final guard.

Cons:

- complex for cross-row invariant,
- DB-specific.

#### Option D — Command serialization

```text
All mutations for same caseId go through same queue/partition.
```

Pros:

- strong sequential processing,
- useful in workflow engines.

Cons:

- architecture complexity,
- operational concerns,
- eventual consistency if async.

---

## 13. Optimistic Lock Exception Handling

### 13.1 What not to do

Bad:

```java
try {
    service.update(command);
} catch (OptimisticLockException e) {
    service.update(command); // blind retry
}
```

Why bad:

```text
A conflict means the domain decision may be stale.
Blind retry can apply an old decision on new state.
```

---

### 13.2 Correct handling categories

#### Category 1 — User-driven conflict

Example:

```text
User edited case details from stale screen.
```

Return:

```text
409 Conflict
Message: The case has been modified. Refresh and re-apply your changes.
```

Include:

- current version,
- changed fields if safe,
- conflict resolution UI if needed.

#### Category 2 — Idempotent technical retry

Example:

```text
Increment non-critical retry counter.
```

Can retry if command is idempotent and recomputes from latest state.

#### Category 3 — Workflow decision

Example:

```text
Approve/reject/finalize.
```

Do not blindly retry. Re-evaluate transition on latest state.

```java
@Transactional
public void approve(ApproveCommand command) {
    CaseFile c = em.find(CaseFile.class, command.caseId());

    if (!c.versionEquals(command.expectedVersion())) {
        throw new StaleDecisionException();
    }

    c.approve(command.officerId(), command.reason());
}
```

---

## 14. Pessimistic Lock Exception Handling

Potential exceptions:

- `PessimisticLockException`,
- `LockTimeoutException`,
- provider-specific exception,
- Spring `CannotAcquireLockException`,
- SQL deadlock/timeout exception translated by framework.

Handling strategy:

```text
Lock timeout: tell user resource is busy or retry automatically if technical job.
Deadlock: retry whole transaction with backoff if operation is safe/idempotent.
PessimisticLockException: transaction may be marked rollback-only depending provider/DB.
```

Never continue business logic after lock acquisition failure as if entity was protected.

---

## 15. Version and API Design

### 15.1 Expose version as concurrency token

DTO:

```java
public record CaseDto(
    Long id,
    Long version,
    String status,
    String title,
    String assignedOfficer
) {}
```

Update command:

```java
public record ChangeCaseTitleCommand(
    Long caseId,
    Long expectedVersion,
    String newTitle
) {}
```

REST example:

```http
PUT /cases/10/title
Content-Type: application/json

{
  "expectedVersion": 7,
  "newTitle": "Updated title"
}
```

Alternative HTTP-style:

```http
GET /cases/10
ETag: "case-10-v7"

PUT /cases/10/title
If-Match: "case-10-v7"
```

Mapping:

```text
ETag maps to entity/aggregate version.
If-Match enforces stale-write prevention.
```

---

### 15.2 Do not let client set new version

Bad:

```java
entity.setVersion(request.version());
em.merge(entity);
```

The request version is an **expected previous version**, not the next version.

Better:

```java
if (!managed.getVersion().equals(request.expectedVersion())) {
    throw new StaleCommandException();
}
```

Provider controls actual version increment.

---

## 16. Versioning and State Machines

### 16.1 State transition must be atomic with version check

Bad conceptual flow:

```text
read status
return to client
client decides transition
server applies transition without checking latest version/status
```

Better:

```java
@Transactional
public void submit(SubmitCaseCommand command) {
    CaseFile c = em.find(CaseFile.class, command.caseId());

    if (!Objects.equals(c.getVersion(), command.expectedVersion())) {
        throw new StaleCommandException();
    }

    c.submit(command.submittedBy());
}
```

Inside entity/domain service:

```java
public void submit(String submittedBy) {
    if (status != CaseStatus.DRAFT) {
        throw new IllegalStateException("Only DRAFT case can be submitted");
    }

    this.status = CaseStatus.SUBMITTED;
    this.submittedBy = submittedBy;
    this.submittedAt = Instant.now();
}
```

This combines:

```text
freshness check + domain invariant + transactional write
```

---

### 16.2 Approval race example

```text
T1 officer approves case version=9
T2 admin cancels case version=9
```

With version:

```text
Only one succeeds.
The loser must re-evaluate against latest status.
```

Without version:

```text
Final state depends on last commit.
Audit trail may show contradictory events.
```

---

## 17. Soft Delete, Filters, and Locking

Soft delete mapping:

```java
private boolean deleted;
```

Common query filter:

```text
where deleted = false
```

Concurrency concern:

```text
T1 edits entity
T2 soft-deletes same entity
T1 commits edit after delete
```

With version:

- if soft delete updates version, T1 conflicts.

Without version:

- deleted row might be silently modified.

Design rule:

```text
Soft delete is a state transition. It should participate in optimistic locking.
```

Do not implement soft delete through native SQL that bypasses version unless deliberately handled.

---

## 18. Cache and Concurrency

### 18.1 First-level cache

Inside one persistence context:

```text
same id -> same managed object
```

If database is changed externally while persistence context is alive, managed object may be stale.

Options:

```java
em.refresh(entity);
em.clear();
```

But do not use `refresh()` randomly as design substitute for clean transaction boundaries.

---

### 18.2 Second-level cache

Second-level cache adds cluster-wide/state-sharing concerns.

If using entity cache:

- versioned entities are safer,
- cache concurrency strategy matters,
- external DB writers can bypass invalidation,
- native SQL/bulk update can make cache stale unless eviction handled.

Design rule:

```text
Do not enable second-level cache for highly contested mutable workflow entities by default.
```

Cache read-mostly reference data first.

---

## 19. Bulk Update and Version Bypass

### 19.1 Bulk update is not entity update

```java
em.createQuery("""
    update CaseFile c
    set c.assignedOfficer = :officer
    where c.status = :status
""")
.setParameter("officer", officer)
.setParameter("status", CaseStatus.OPEN)
.executeUpdate();
```

This does not load entities, does not call setters, does not check per-entity invariants, and may not bump version unless specified.

---

### 19.2 Safe bulk mutation checklist

Before using bulk update/delete:

```text
[ ] Is it allowed to bypass entity methods?
[ ] Should version be incremented?
[ ] Should audit/history be written separately?
[ ] Should persistence context be cleared after execution?
[ ] Should second-level cache be evicted?
[ ] Are domain invariants enforced by SQL where clause/constraints?
[ ] Is this operation safe under concurrent user updates?
```

---

## 20. Native SQL and External Writers

ORM concurrency only works if all writers participate correctly.

Risk sources:

- native SQL update,
- stored procedure,
- database trigger,
- ETL job,
- data patch script,
- another service using direct JDBC,
- admin console update,
- replication repair process.

If external writer updates versioned table, it should usually increment version:

```sql
update case_file
set status = 'EXPIRED',
    version = version + 1
where expiry_date < current_timestamp
  and status = 'OPEN';
```

If it does not increment version, ORM clients may not detect stale state.

---

## 21. Locking and ID Generation

ID generation can affect concurrency indirectly.

### 21.1 Identity columns

With identity generation, insert usually requires immediate DB insert to get generated ID.

This can affect:

- flush timing,
- batching,
- lock timing,
- transaction duration.

### 21.2 Sequences

Sequences are usually more batching-friendly.

But sequence allocation can create gaps. Gaps are normal and should not be treated as concurrency bug.

Do not use database surrogate ID as business sequence requiring gapless semantics.

For gapless business number, design explicit allocator with proper locking and accept throughput trade-off.

---

## 22. Lock Ordering and Transaction Boundary

### 22.1 Keep locked transaction short

Bad:

```java
@Transactional
public void approveCase(Long id) {
    CaseFile c = em.find(CaseFile.class, id, LockModeType.PESSIMISTIC_WRITE);

    externalDocumentService.generatePdf(c); // slow external call inside lock
    emailService.sendEmail(...);            // side effect inside lock

    c.approve();
}
```

Better:

```text
1. Validate and mutate DB state in short transaction.
2. Commit.
3. Publish event/outbox.
4. Process external side effects after commit.
```

---

### 22.2 Deterministic lock order

If operation touches multiple aggregates:

```text
Sort aggregate IDs.
Acquire locks in sorted order.
Avoid hidden lazy loads that lock in non-deterministic order.
```

---

## 23. Practical Decision Matrix

| Scenario | Recommended baseline | Why |
|---|---|---|
| Ordinary edit form | `@Version` + expectedVersion/ETag | Detect stale user update |
| Status transition | `@Version` + domain transition check | Prevent stale workflow decision |
| Add child inside aggregate | `OPTIMISTIC_FORCE_INCREMENT` on root if aggregate version matters | Child change bumps aggregate token |
| High-contention claim task | Pessimistic lock / native `SKIP LOCKED` | Avoid duplicate claim |
| Counter/quota allocation | Pessimistic lock or atomic DB update | Avoid oversubscription |
| Read-mostly reference data | Maybe no lock + cache | Low mutation |
| Bulk expiry job | SQL bulk update with version/audit/cache handling | Avoid per-row hydration |
| Multi-row invariant | Root lock/version or DB constraint | `@Version` per child not enough |
| Final approval | Optimistic or pessimistic depending contention/cost | Must prevent double finalization |
| External data patch | Increment version + evict cache | Keep ORM clients safe |

---

## 24. Anti-Patterns

### 24.1 Entity update without version on mutable table

```java
@Entity
class CaseFile {
    @Id Long id;
    String status;
}
```

For mutable enterprise entities, no version means stale overwrites are likely.

---

### 24.2 Blind merge from API

```java
em.merge(requestBodyEntity);
```

This is dangerous for correctness and security.

---

### 24.3 Pessimistic lock around external calls

Holding DB locks during network/file/email calls is a production incident waiting to happen.

---

### 24.4 Using pessimistic lock everywhere

This often causes:

- lower throughput,
- lock wait spikes,
- deadlocks,
- poor user experience.

---

### 24.5 Treating optimistic lock exception as technical noise

Optimistic conflict often means business decision is stale. It must be handled semantically.

---

### 24.6 Assuming transaction isolation solves ORM detached state

A stale request from browser is outside current database transaction. Isolation level cannot fix stale UI commands.

---

### 24.7 Bulk update without clearing persistence context

```java
bulkUpdate();
// managed entities still hold old state
```

Use:

```java
em.clear();
```

or isolate bulk operation in separate transaction.

---

## 25. Diagnostic Checklist

When investigating concurrency bugs:

```text
[ ] Does the entity have @Version?
[ ] Is the version column included in UPDATE/DELETE WHERE clause?
[ ] Is the API sending expectedVersion/If-Match?
[ ] Is the backend validating expected version before applying domain command?
[ ] Are detached entities merged from request body?
[ ] Are child changes expected to bump aggregate root version?
[ ] Are bulk JPQL/native updates bypassing version?
[ ] Are external writers incrementing version?
[ ] Are second-level cache regions stale?
[ ] Is pessimistic lock SQL actually generated?
[ ] Is lock timeout configured and supported by DB/provider?
[ ] Are locks acquired in deterministic order?
[ ] Are external calls happening while DB lock is held?
[ ] Is the bug actually write skew/multi-row invariant rather than same-row lost update?
[ ] Are retries safe and idempotent?
```

---

## 26. Testing Concurrency

### 26.1 Test lost update

Pseudo-test:

```java
@Test
void staleUpdateShouldFail() throws Exception {
    Long id = createCase();

    CaseSnapshot s1 = loadCase(id);
    CaseSnapshot s2 = loadCase(id);

    updateTitle(id, s1.version(), "Title A");

    assertThrows(StaleCommandException.class, () ->
        updateTitle(id, s2.version(), "Title B")
    );
}
```

This tests API-level expected version.

---

### 26.2 Test database-level optimistic conflict

Use two transactions:

```java
TransactionTemplate tx1 = ...;
TransactionTemplate tx2 = ...;
```

Or use two `EntityManager`s manually.

```java
EntityManager em1 = emf.createEntityManager();
EntityManager em2 = emf.createEntityManager();

em1.getTransaction().begin();
em2.getTransaction().begin();

CaseFile c1 = em1.find(CaseFile.class, id);
CaseFile c2 = em2.find(CaseFile.class, id);

c1.changeTitle("A");
em1.getTransaction().commit();

c2.changeTitle("B");
assertThrows(RollbackException.class, () -> em2.getTransaction().commit());
```

Exact exception depends provider/framework.

---

### 26.3 Test pessimistic lock timeout

Concurrency tests must use real target-like database. H2 may not reproduce Oracle/PostgreSQL/MySQL/SQL Server lock behavior.

Test:

- T1 holds lock,
- T2 attempts lock,
- T2 times out,
- exception is translated correctly,
- transaction is rolled back,
- no partial side effect happens.

---

## 27. Java 8–25 Compatibility Notes

### 27.1 Package namespace

Java 8 legacy stacks often use:

```java
javax.persistence.Version
javax.persistence.LockModeType
javax.persistence.OptimisticLockException
```

Modern Jakarta stacks use:

```java
jakarta.persistence.Version
jakarta.persistence.LockModeType
jakarta.persistence.OptimisticLockException
```

Do not mix them.

---

### 27.2 Runtime version concerns

Java version itself does not redefine JPA locking semantics. But Java 8–25 affects:

- supported provider versions,
- bytecode enhancement compatibility,
- framework alignment,
- module path/classpath issues,
- test/runtime dependency graph,
- virtual thread transaction boundary risks in modern apps.

### 27.3 Virtual threads caution

With Java 21+ virtual threads, do not assume ORM sessions/entity managers are safe to share.

Rule remains:

```text
EntityManager/Session is not an application-wide concurrent object.
Scope it to transaction/request/unit-of-work.
```

Virtual threads can improve blocking scalability, but they do not remove database lock contention.

---

## 28. Provider Comparison Summary

| Area | Hibernate | EclipseLink | Design implication |
|---|---|---|---|
| Standard `@Version` | Strong support | Strong support | Use as default |
| Provider extensions | `@OptimisticLock`, lock options, version strategies | `@OptimisticLocking`, descriptor-level locking | Useful but lock-in |
| Pessimistic SQL | Dialect-driven | Platform-driven | Verify generated SQL |
| Bulk update semantics | Bypasses entity lifecycle/PC | Same conceptual risk | Clear PC, handle version/cache |
| Cache interaction | Region/concurrency strategy matters | Shared cache behavior matters | Be conservative for mutable entities |
| Exception surface | Hibernate exceptions often wrapped by JPA/Spring | EclipseLink exceptions often wrapped by JPA/Spring | Normalize at application boundary |

---

## 29. Production Design Rules

1. Mutable aggregate roots should normally have `@Version`.
2. API update commands should carry expected version or HTTP `If-Match`.
3. Never blindly `merge()` API request bodies.
4. Treat optimistic lock conflict as business conflict unless proven technical.
5. Use pessimistic locking only for high-contention or serialization-required paths.
6. Keep pessimistic lock transactions short.
7. Acquire multiple locks in deterministic order.
8. Do not rely on child row version to protect aggregate invariant.
9. Bump root version for aggregate-level child mutations when needed.
10. Bulk updates must explicitly address version, cache, audit, and stale persistence context.
11. External writers must participate in versioning or be isolated from ORM-managed tables.
12. Test concurrency behavior on the real database type.
13. Use database constraints for invariants that must never be violated.
14. Prefer numeric versions for core workflow entities.
15. Do not enable second-level cache casually on highly mutable contested entities.

---

## 30. Practice Scenarios

### Scenario 1 — Case finalization race

Two officers open same case. Officer A approves, officer B rejects.

Design:

- `CaseFile` has `@Version`,
- approve/reject command includes expected version,
- domain method checks current status,
- loser gets conflict response,
- audit only records successful transition.

### Scenario 2 — Task claiming

Ten workers claim open tasks concurrently.

Design:

- use pessimistic locking or native `SKIP LOCKED`,
- lock transaction only wraps claim mutation,
- external processing happens after claim commit,
- failed worker can release/retry via separate status transition.

### Scenario 3 — Add reviewer invariant

Max 3 active reviewers per case.

Design options:

- pessimistically lock case root before count+insert,
- or optimistic force increment root and retry on conflict,
- plus database guard if possible,
- do not rely only on reviewer row version.

### Scenario 4 — Nightly expiry job

Expire old open cases.

Design:

- bulk update may be okay,
- increment version,
- write audit/history separately,
- evict cache or avoid caching,
- run in bounded chunks,
- clear persistence context after operation.

### Scenario 5 — Admin data patch

DBA updates status manually.

Design:

- patch script increments version,
- writes audit metadata if required,
- invalidates cache if enabled,
- records change reason.

---

## 31. Summary

Concurrency control in JPA providers is not one annotation. It is a design discipline.

The essential model:

```text
@Version prevents stale same-row updates.
Pessimistic locks serialize access through the database.
Transaction isolation controls visibility/anomalies at DB level.
Persistence context holds potentially stale object state.
Detached objects can carry obsolete decisions.
Bulk/native/external updates can bypass ORM protection.
Aggregate invariants often need root versioning, locking, constraints, or command serialization.
```

For production-grade systems, the key question is not:

```text
Should I use optimistic or pessimistic locking?
```

The better question is:

```text
What state must not be concurrently invalidated,
where is that state represented,
who can write it,
and at what boundary must conflict be detected?
```

Once you answer that, `@Version`, `LockModeType`, transaction isolation, database constraints, and provider-specific features become deliberate tools instead of random annotations.

---

## 32. References

- Jakarta Persistence 3.2 Specification — version fields and locking semantics. citeturn439875search0
- Jakarta Persistence API — `LockModeType` usage and lock acquisition methods. citeturn439875search11
- Hibernate ORM User Guide — optimistic/pessimistic locking, `@Version`, provider behavior. citeturn439875search2turn439875search3
- Hibernate ORM 7 Introduction — concurrency approaches using `@Version` and database-level pessimistic locking. citeturn439875search12
- EclipseLink Documentation — entities and locking; optimistic/pessimistic locking support and default consistency stance. citeturn439875search5
- EclipseLink JPA Extensions — `@OptimisticLocking`. citeturn439875search15

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 18 — Transaction Integration: Resource Local, JTA, Spring, Jakarta EE, and Boundary Design](./18-transaction-integration-resource-local-jta-spring-jakarta-ee-boundary.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 20 — Merge, Detach, DTO Mapping, and API Boundary Safety](./20-merge-detach-dto-mapping-api-boundary-safety.md)
