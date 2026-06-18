# Part 029 — Error Handling, Exception Translation, and Failure Classification

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> File: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-029.md`  
> Target: Java 8 hingga Java 25, JPA 2.x `javax.persistence`, Jakarta Persistence 3.x `jakarta.persistence`, Hibernate ORM 5/6/7, Spring Data/JPA, Jakarta Transactions, dan database production.

---

## 1. Tujuan Pembelajaran

Bagian ini membahas satu kemampuan yang membedakan engineer biasa dengan engineer yang matang secara production: **mengklasifikasikan failure persistence secara benar**.

Banyak sistem enterprise tidak gagal karena tidak bisa `save()` entity. Sistem gagal karena:

- semua error database diperlakukan sama,
- semua exception dianggap 500,
- semua failure dicoba retry,
- constraint violation dianggap bug teknis, bukan feedback domain,
- optimistic lock dianggap server error, bukan conflict,
- deadlock tidak dibedakan dari invalid input,
- transaction sudah `rollback-only`, tetapi code tetap melanjutkan side effect,
- error commit tidak dimodelkan,
- duplicate message tidak dibedakan dari duplicate business request,
- exception provider-specific dibocorkan sampai API,
- log error tidak memuat SQL state/vendor code/constraint name/correlation id,
- retry dilakukan di dalam transaction yang sama,
- response berhasil dikirim padahal transaksi gagal commit,
- cache/search/event sudah diperbarui padahal database rollback.

Setelah bagian ini, targetnya kamu mampu:

1. Membaca exception persistence bukan sebagai “stack trace”, tetapi sebagai sinyal failure class.
2. Membedakan user error, data integrity error, concurrency conflict, transient database failure, infrastructure failure, programming bug, dan unknown failure.
3. Mendesain exception translation layer yang stabil di atas JPA/Hibernate/Spring/Jakarta.
4. Menentukan kapan retry aman, kapan harus conflict response, kapan harus manual investigation.
5. Memetakan exception ke HTTP/API response tanpa membocorkan detail internal.
6. Menjaga audit, outbox, idempotency, dan transaction boundary tetap benar saat failure terjadi.
7. Membuat observability persistence yang bisa dipakai incident response production.

---

## 2. Mental Model: Exception Adalah Sinyal Boundary yang Gagal

Persistence layer berada di antara beberapa boundary:

```text
User / API / Message
        |
Application Service / Transaction Boundary
        |
Repository / EntityManager / Session
        |
JPA Provider / Hibernate
        |
JDBC Driver
        |
Database Engine
        |
Storage / Lock Manager / Network / Replication
```

Satu operasi `submitApplication()` bisa gagal di banyak tempat:

```text
1. Request invalid
2. Entity invariant invalid
3. Unique constraint violated
4. Foreign key violated
5. Optimistic version conflict
6. Lock timeout
7. Deadlock
8. Query syntax wrong
9. Column too small
10. Connection pool exhausted
11. Database unavailable
12. Transaction timeout
13. Commit unknown
14. Outbox publish failed
15. Serialization response failed
```

Masalahnya, di Java semua itu sering muncul sebagai `RuntimeException`.

Tugas engineer bukan hanya menangkap exception. Tugas engineer adalah menjawab:

```text
Apa jenis failure ini?
Apakah request user salah?
Apakah data sudah berubah?
Apakah transaksi rollback?
Apakah aman retry?
Apakah client harus mengubah input?
Apakah operator harus investigasi?
Apakah side effect eksternal sudah terjadi?
Apakah ada risiko duplicate effect?
Apa response yang benar?
Apa log/metric yang dibutuhkan?
```

### 2.1 Exception yang Sama Bisa Berarti Hal Berbeda

Contoh `ConstraintViolationException` bisa berarti:

| Situasi | Arti |
|---|---|
| Duplicate email saat register | User/domain conflict |
| Duplicate idempotency key dengan request body sama | Safe replay |
| Duplicate idempotency key dengan request body beda | Client misuse / conflict |
| Foreign key missing karena client kirim `officer_id` tidak ada | Input invalid |
| Foreign key missing karena referensi internal hilang | Data corruption / bug |
| NOT NULL violated karena DTO tidak divalidasi | Application bug / validation gap |
| CHECK constraint violated karena race condition | Correctness guard bekerja |

Jadi classification tidak cukup hanya berdasarkan class exception. Perlu konteks:

- operation,
- aggregate,
- SQL state,
- vendor code,
- constraint name,
- transaction state,
- request id,
- idempotency key,
- actor,
- tenant,
- retry attempt,
- apakah failure terjadi saat flush atau commit.

---

## 3. Layer Exception di Java Persistence Stack

### 3.1 JDBC Layer

Di bawah JPA/Hibernate ada JDBC. JDBC failure biasanya muncul sebagai `java.sql.SQLException` atau subclass-nya.

Informasi penting dari `SQLException`:

```java
String sqlState = ex.getSQLState();
int vendorCode = ex.getErrorCode();
SQLException next = ex.getNextException();
Throwable cause = ex.getCause();
```

`SQLState` adalah kode standar-ish. Vendor code adalah kode database-specific, misalnya Oracle, PostgreSQL, MySQL, SQL Server.

Contoh kategori SQLState umum:

| SQLState class | Makna umum |
|---|---|
| `23` | integrity constraint violation |
| `40` | transaction rollback, serialization failure, deadlock |
| `08` | connection exception |
| `42` | syntax/access rule violation |
| `22` | data exception, conversion/truncation |
| `28` | invalid authorization |
| `53` | insufficient resources, vendor-dependent |
| `57` | operator intervention / admin shutdown, vendor-dependent |

Catatan penting: SQLState tidak selalu cukup. Banyak kasus butuh vendor code dan constraint name.

### 3.2 Hibernate Layer

Hibernate membungkus banyak JDBC exception menjadi `org.hibernate.JDBCException` dan subclass-nya.

Contoh:

```text
org.hibernate.JDBCException
  ├─ ConstraintViolationException
  ├─ LockAcquisitionException
  ├─ PessimisticLockException
  ├─ QueryTimeoutException
  ├─ SQLGrammarException
  ├─ DataException
  ├─ GenericJDBCException
  └─ JDBCConnectionException
```

Tidak semua nama class stabil sama persis lintas versi/provider, tetapi mental modelnya stabil:

| Hibernate-ish exception | Makna umum |
|---|---|
| `ConstraintViolationException` | constraint database dilanggar |
| `DataException` | data conversion/truncation/invalid value |
| `SQLGrammarException` | SQL invalid, object tidak ada, privilege issue kadang muncul di sini |
| `LockAcquisitionException` | deadlock/lock acquisition gagal |
| `QueryTimeoutException` | query timeout |
| `JDBCConnectionException` | koneksi database/network gagal |
| `GenericJDBCException` | wrapper umum saat tidak terklasifikasi |

Hibernate juga punya exception non-JDBC seperti:

```text
org.hibernate.StaleObjectStateException
org.hibernate.LazyInitializationException
org.hibernate.NonUniqueObjectException
org.hibernate.TransientObjectException
org.hibernate.PersistentObjectException
org.hibernate.PropertyValueException
org.hibernate.MappingException
org.hibernate.QueryException
```

Ini sering menunjukkan problem desain persistence atau lifecycle entity.

### 3.3 JPA / Jakarta Persistence Layer

JPA/Jakarta Persistence punya exception standard, misalnya:

```text
jakarta.persistence.PersistenceException
  ├─ EntityExistsException
  ├─ EntityNotFoundException
  ├─ NoResultException
  ├─ NonUniqueResultException
  ├─ OptimisticLockException
  ├─ PessimisticLockException
  ├─ QueryTimeoutException
  ├─ TransactionRequiredException
  ├─ RollbackException
  └─ LockTimeoutException
```

Dalam aplikasi lama Java EE/Spring Boot 2, package-nya bisa `javax.persistence.*`. Dalam Jakarta EE/Spring Boot 3+, package-nya `jakarta.persistence.*`.

Hal penting:

- `OptimisticLockException` biasanya menandakan conflict concurrent update dan transaction aktif akan ditandai rollback.
- `PessimisticLockException` atau `LockTimeoutException` bisa terkait lock wait/deadlock/timeout.
- `RollbackException` sering muncul saat commit gagal.
- `NoResultException` bukan error sistem; itu hasil query kosong.
- `NonUniqueResultException` sering menunjukkan bug asumsi cardinality query.
- `LazyInitializationException` bukan JPA standard, tetapi Hibernate-specific dan biasanya tanda boundary/fetch plan salah.

### 3.4 Jakarta Transactions / JTA Layer

Dalam transaction managed environment, exception bisa muncul dari Jakarta Transactions/JTA:

```text
jakarta.transaction.RollbackException
jakarta.transaction.HeuristicMixedException
jakarta.transaction.HeuristicRollbackException
jakarta.transaction.NotSupportedException
jakarta.transaction.SystemException
jakarta.transaction.TransactionRequiredException
jakarta.transaction.InvalidTransactionException
```

Kategori penting:

| Exception | Makna praktis |
|---|---|
| `RollbackException` | transaksi rollback, bukan commit |
| `HeuristicMixedException` | sebagian resource commit, sebagian rollback; sangat serius |
| `HeuristicRollbackException` | heuristic decision rollback |
| `SystemException` | transaction manager/resource manager error |
| `NotSupportedException` | propagation/transaction nesting tidak didukung |

Heuristic exception terutama relevan pada XA/distributed transaction. Jika sistem menghindari XA dan memakai outbox/eventual consistency, kasus ini jauh lebih jarang tetapi tetap perlu dipahami.

### 3.5 Spring Data Access Layer

Spring menerjemahkan exception persistence menjadi `DataAccessException` hierarchy.

Contoh penting:

```text
org.springframework.dao.DataAccessException
  ├─ NonTransientDataAccessException
  │   ├─ DataIntegrityViolationException
  │   ├─ DuplicateKeyException
  │   ├─ InvalidDataAccessResourceUsageException
  │   └─ IncorrectResultSizeDataAccessException
  ├─ TransientDataAccessException
  │   ├─ CannotAcquireLockException
  │   ├─ DeadlockLoserDataAccessException
  │   ├─ QueryTimeoutException
  │   └─ TransientDataAccessResourceException
  ├─ RecoverableDataAccessException
  └─ UncategorizedDataAccessException
```

Spring exception translation berguna karena:

- mengurangi coupling ke provider/database,
- membedakan transient vs non-transient secara umum,
- membuat application layer tidak perlu mengenal semua vendor code,
- tetap mempertahankan root cause.

Namun translation tidak sempurna. Untuk sistem high-criticality, sering perlu custom classifier di atas Spring exception.

---

## 4. Taxonomy: Klasifikasi Failure Persistence

Gunakan taxonomy berikut sebagai dasar desain error handling.

```text
Persistence Failure
├─ Expected absence
├─ User/domain validation failure
├─ Data integrity violation
├─ Concurrency conflict
├─ Lock/contention/transient transaction failure
├─ Timeout/resource exhaustion
├─ Connection/infrastructure failure
├─ Query/mapping/programming bug
├─ Transaction state failure
├─ External side-effect coordination failure
├─ Unknown commit outcome
└─ Unknown/unclassified failure
```

### 4.1 Expected Absence

Contoh:

- `findById()` tidak menemukan entity.
- Query listing kosong.
- Optional result kosong.
- `NoResultException` dari `getSingleResult()`.

Ini bukan failure sistem.

Mapping response:

| Use case | Response |
|---|---|
| GET by id tidak ada | 404 |
| Search/list kosong | 200 dengan empty list |
| Delete idempotent resource tidak ada | 204 atau 404 tergantung contract |
| Command but aggregate tidak ada | 404 atau domain-specific error |

Anti-pattern:

```java
try {
    Application app = query.getSingleResult();
    return app;
} catch (Exception e) {
    throw new InternalServerErrorException(e);
}
```

Lebih baik:

```java
public Optional<Application> findByReferenceNo(String refNo) {
    return em.createQuery("""
            select a
            from Application a
            where a.referenceNo = :refNo
            """, Application.class)
        .setParameter("refNo", refNo)
        .getResultStream()
        .findFirst();
}
```

Atau di Jakarta Persistence modern yang mendukung API convenience sesuai provider/version, gunakan idiom optional jika tersedia. Prinsipnya: absence bukan exception bisnis yang harus jadi 500.

### 4.2 User / Domain Validation Failure

Contoh:

- field wajib kosong,
- format salah,
- transition tidak diizinkan,
- actor tidak punya permission,
- input melewati batas domain,
- request tidak sesuai state saat ini.

Mapping response:

| Failure | Response umum |
|---|---|
| DTO invalid | 400 |
| domain rule invalid | 422 atau 409, tergantung contract |
| unauthorized action | 403 |
| stale expected state | 409 |

Penting: validation failure idealnya terdeteksi sebelum flush. Tetapi database constraint tetap harus menjadi final guard.

### 4.3 Data Integrity Violation

Contoh:

- unique constraint violation,
- foreign key violation,
- not null violation,
- check constraint violation,
- column length exceeded,
- numeric overflow.

Kemungkinan exception:

```text
Hibernate ConstraintViolationException
Spring DataIntegrityViolationException
Spring DuplicateKeyException
JPA PersistenceException wrapping SQLException
SQLState class 23
```

Mapping response bergantung constraint:

| Constraint | Kemungkinan response |
|---|---|
| unique public reference duplicate | 409 |
| idempotency key duplicate same payload | return previous response / 200/201 replay |
| idempotency key duplicate different payload | 409 |
| FK missing dari input user | 400/422/404 |
| NOT NULL karena bug mapping | 500 |
| CHECK state invalid karena race | 409 |
| length overflow karena validation gap | 400/422, plus fix validation |

Jangan langsung anggap semua `DataIntegrityViolationException` = 400. Bisa jadi bug internal.

### 4.4 Concurrency Conflict

Contoh:

- optimistic lock conflict,
- expected version mismatch,
- conditional update row count = 0,
- state sudah berubah,
- duplicate transition,
- stale approval command.

Kemungkinan exception/signal:

```text
OptimisticLockException
ObjectOptimisticLockingFailureException
StaleObjectStateException
updatedRows == 0
```

Mapping response:

```text
HTTP 409 Conflict
```

Biasanya message user-facing:

```text
The record was modified by another user. Please refresh and try again.
```

Untuk workflow/case management, lebih baik message domain-specific:

```text
This case is no longer in UNDER_REVIEW state. Current state: ESCALATED.
```

Retry otomatis tidak selalu benar. Untuk command berbasis keputusan manusia, retry bisa menerapkan keputusan stale ke data baru. Biasanya butuh refresh/user conflict resolution.

### 4.5 Lock / Contention / Transient Transaction Failure

Contoh:

- deadlock,
- lock wait timeout,
- serialization failure,
- cannot acquire lock,
- database detects concurrent transaction conflict.

Kemungkinan exception:

```text
PessimisticLockException
LockTimeoutException
CannotAcquireLockException
DeadlockLoserDataAccessException
LockAcquisitionException
SQLState 40xxx
```

Mapping response:

| Context | Response |
|---|---|
| Synchronous user command after bounded retry exhausted | 409 atau 503 |
| High-contention queue worker | retry with backoff |
| Serialization failure in idempotent operation | retry safe if command idempotent |
| Deadlock in batch chunk | retry chunk |
| Lock timeout due user editing same item | 409 |

Transient bukan berarti retry tanpa batas. Retry harus:

- bounded,
- outside failed transaction,
- with backoff/jitter,
- idempotent,
- instrumented,
- aware of side effects.

### 4.6 Timeout / Resource Exhaustion

Contoh:

- query timeout,
- transaction timeout,
- connection pool timeout,
- statement timeout,
- database CPU/I/O saturated,
- too many connections,
- memory/temp tablespace exhausted.

Kemungkinan exception:

```text
QueryTimeoutException
TransactionTimedOutException
SQLTransientConnectionException
CannotGetJdbcConnectionException
TransientDataAccessResourceException
ResourceAccessException
```

Mapping response:

```text
503 Service Unavailable
504 Gateway Timeout
500 only if internal unknown and no better classification
```

Retry? Tergantung.

| Failure | Retry? |
|---|---|
| Pool exhausted karena load spike | Client retry bisa memperburuk; server-side retry biasanya tidak |
| Query timeout karena bad query | Jangan retry; fix query/index |
| Transaction timeout karena external call di dalam transaction | Jangan retry blindly; redesign |
| Temporary failover | Retry dengan circuit breaker/backoff mungkin |
| Batch chunk timeout | Kurangi chunk size / optimize query |

### 4.7 Connection / Infrastructure Failure

Contoh:

- DB down,
- network partition,
- DNS issue,
- failover,
- connection reset,
- TLS failure,
- credential expired,
- database listener unavailable.

Kemungkinan exception:

```text
JDBCConnectionException
CannotGetJdbcConnectionException
SQLRecoverableException
SQLTransientConnectionException
CommunicationsException vendor-specific
```

Response:

```text
503 Service Unavailable
```

Important distinction:

- Failure before transaction starts: likely no data changed.
- Failure during statement: database outcome might depend on exact failure.
- Failure during commit: outcome can be unknown.

### 4.8 Query / Mapping / Programming Bug

Contoh:

- JPQL syntax salah,
- column/table tidak ada,
- mapping mismatch,
- duplicate entity instance in persistence context,
- transient object referenced without cascade,
- lazy initialization outside transaction,
- wrong cardinality assumption,
- wrong parameter type,
- database privilege missing because deployment misconfigured.

Kemungkinan exception:

```text
SQLGrammarException
InvalidDataAccessResourceUsageException
MappingException
QueryException
IllegalArgumentException
TransientObjectException
NonUniqueObjectException
LazyInitializationException
NonUniqueResultException
```

Mapping response:

```text
500 Internal Server Error
```

Namun action-nya bukan “retry”. Action-nya:

- fix code,
- fix mapping,
- fix migration,
- fix deployment privilege,
- add test,
- add monitoring.

### 4.9 Transaction State Failure

Contoh:

- transaction marked rollback-only,
- trying to commit failed transaction,
- calling persistence operation without transaction,
- nested transaction not supported,
- rollback exception at commit,
- unexpected rollback in Spring.

Kemungkinan exception:

```text
TransactionRequiredException
RollbackException
UnexpectedRollbackException
IllegalTransactionStateException
SystemException
```

Common Spring trap:

```java
@Transactional
public void process() {
    try {
        repository.save(entityThatViolatesConstraint());
        repository.flush();
    } catch (DataIntegrityViolationException ignored) {
        // swallow
    }

    repository.save(otherEntity()); // transaction may already be rollback-only
}
```

Masalahnya: begitu transaction ditandai rollback-only, melanjutkan operasi seolah masih sehat berbahaya. Biasanya harus keluar dari transaction, mulai transaction baru untuk recovery/audit jika memang perlu, atau ubah flow.

### 4.10 External Side-Effect Coordination Failure

Contoh:

- DB commit sukses, message publish gagal,
- message publish sukses, DB rollback,
- cache updated, DB rollback,
- email terkirim, transaction rollback,
- file uploaded, metadata DB gagal,
- external API success, local commit fail.

Ini bukan semata persistence exception, tapi bagian dari database integration.

Solusi umum:

- transactional outbox,
- inbox/idempotent consumer,
- compensation,
- durable external operation log,
- avoid external side effect inside transaction,
- after-commit hook dengan fallback outbox,
- reconciliation job.

### 4.11 Unknown Commit Outcome

Ini failure paling serius.

Contoh:

```text
Application sends COMMIT to database.
Network drops before response received.
Application does not know whether commit succeeded.
```

Outcome bisa:

- commit berhasil,
- commit gagal,
- database sedang failover,
- client lost response.

Jika command tidak idempotent, client retry bisa menyebabkan duplicate effect.

Mitigasi:

- idempotency key,
- unique business key,
- request log table,
- outbox/inbox,
- reconciliation query,
- explicit command id,
- deterministic external reference number,
- safe retry protocol.

---

## 5. Failure Classification Matrix

Gunakan matrix berikut sebagai baseline.

| Failure class | Typical signal | User response | Retry? | Operator action |
|---|---|---:|---|---|
| Not found | empty result, `NoResultException` | 404/empty list | No | None |
| Invalid input | validation/domain exception | 400/422 | After correction | Improve validation if missed |
| Duplicate business key | unique violation | 409 | No, unless idempotent replay | Maybe monitor abuse |
| Idempotent replay | unique idempotency key same hash | previous response | No need | None |
| Stale update | optimistic lock / row count 0 | 409 | Usually user refresh | Monitor contention |
| Deadlock | SQLState 40/deadlock exception | 503/409 after retry | Yes bounded | Analyze lock order |
| Lock timeout | lock timeout exception | 409/503 | Sometimes | Tune lock/query |
| Serialization failure | SQLState 40001-ish | 503/409 after retry | Yes if idempotent | Monitor contention |
| Query timeout | query timeout | 504/503 | Usually no | Optimize query/index |
| Pool exhausted | cannot get connection | 503 | Client backoff | Capacity/leak analysis |
| DB unavailable | connection failure | 503 | Yes with circuit breaker | Infra incident |
| SQL grammar/mapping | SQLGrammar/MappingException | 500 | No | Fix code/migration |
| Transaction rollback-only | unexpected rollback | 500 or domain-specific | No same tx | Fix transaction flow |
| Commit unknown | connection lost during commit | 202/409/503 depending protocol | Only via idempotency/reconcile | Investigate/reconcile |
| Heuristic mixed | JTA heuristic | 500 + incident | No | Manual reconciliation |

---

## 6. Exception Translation Architecture

### 6.1 Jangan Bocorkan Provider Exception ke Application Core

Buruk:

```java
@Service
public class SubmitApplicationService {
    public void submit(...) {
        try {
            repository.save(...);
        } catch (org.hibernate.exception.ConstraintViolationException e) {
            throw new RuntimeException("duplicate");
        }
    }
}
```

Masalah:

- application service tahu Hibernate detail,
- sulit migration provider,
- constraint name parsing tersebar,
- response mapping tidak konsisten,
- retry policy tidak terpusat.

Lebih baik buat classifier:

```text
Throwable
   ↓
PersistenceFailureClassifier
   ↓
PersistenceFailure
   ↓
ApplicationException / ApiError / RetryPolicy
```

### 6.2 Model Domain Failure yang Stabil

Contoh sealed-style untuk Java modern:

```java
public sealed interface PersistenceFailure
        permits PersistenceFailure.NotFound,
                PersistenceFailure.ConstraintFailure,
                PersistenceFailure.ConcurrencyConflict,
                PersistenceFailure.TransientFailure,
                PersistenceFailure.InfrastructureFailure,
                PersistenceFailure.ProgrammingFailure,
                PersistenceFailure.UnknownFailure {

    record NotFound(String entityName, Object id) implements PersistenceFailure {}

    record ConstraintFailure(
            String constraintName,
            ConstraintKind kind,
            String entityName,
            boolean userCorrectable
    ) implements PersistenceFailure {}

    record ConcurrencyConflict(
            String entityName,
            Object id,
            String reason
    ) implements PersistenceFailure {}

    record TransientFailure(
            String reason,
            boolean retryable
    ) implements PersistenceFailure {}

    record InfrastructureFailure(
            String reason,
            boolean retryable
    ) implements PersistenceFailure {}

    record ProgrammingFailure(String reason) implements PersistenceFailure {}

    record UnknownFailure(String reason) implements PersistenceFailure {}
}
```

Untuk Java 8, gunakan class hierarchy biasa.

```java
public interface PersistenceFailure {
    String code();
}

public final class ConstraintFailure implements PersistenceFailure {
    private final String constraintName;
    private final ConstraintKind kind;
    private final boolean userCorrectable;

    public ConstraintFailure(String constraintName, ConstraintKind kind, boolean userCorrectable) {
        this.constraintName = constraintName;
        this.kind = kind;
        this.userCorrectable = userCorrectable;
    }

    @Override
    public String code() {
        return "PERSISTENCE_CONSTRAINT_FAILURE";
    }
}
```

### 6.3 Constraint Registry

Constraint name harus meaningful dan dipetakan.

Contoh migration:

```sql
alter table application
add constraint uk_application_tenant_reference_no
unique (tenant_id, reference_no);

alter table case_assignment
add constraint ck_case_assignment_active_flag
check (active_flag in ('Y', 'N'));

alter table appeal
add constraint fk_appeal_application
foreign key (application_id)
references application(id);
```

Registry:

```java
public enum ConstraintDescriptor {
    APPLICATION_REFERENCE_UNIQUE(
            "uk_application_tenant_reference_no",
            "APPLICATION_REFERENCE_ALREADY_EXISTS",
            ConstraintKind.UNIQUE,
            true
    ),
    APPEAL_APPLICATION_FK(
            "fk_appeal_application",
            "APPLICATION_NOT_FOUND_FOR_APPEAL",
            ConstraintKind.FOREIGN_KEY,
            true
    ),
    CASE_ASSIGNMENT_ACTIVE_FLAG_CHECK(
            "ck_case_assignment_active_flag",
            "INVALID_ASSIGNMENT_ACTIVE_FLAG",
            ConstraintKind.CHECK,
            false
    );

    private final String databaseName;
    private final String publicCode;
    private final ConstraintKind kind;
    private final boolean userCorrectable;

    ConstraintDescriptor(
            String databaseName,
            String publicCode,
            ConstraintKind kind,
            boolean userCorrectable
    ) {
        this.databaseName = databaseName;
        this.publicCode = publicCode;
        this.kind = kind;
        this.userCorrectable = userCorrectable;
    }

    public static Optional<ConstraintDescriptor> findByDatabaseName(String name) {
        if (name == null) {
            return Optional.empty();
        }
        String normalized = name.toLowerCase(Locale.ROOT);
        return Arrays.stream(values())
                .filter(v -> v.databaseName.equalsIgnoreCase(normalized))
                .findFirst();
    }
}
```

Public API tidak perlu membocorkan nama constraint database. Tetapi internal log harus memuatnya.

---

## 7. Implementasi Failure Classifier

### 7.1 Root Cause Traversal

Exception persistence sering nested:

```text
DataIntegrityViolationException
  caused by ConstraintViolationException
    caused by SQLIntegrityConstraintViolationException
      SQLState=23000, vendorCode=1
```

Buat utility:

```java
public final class ThrowableWalker {
    private ThrowableWalker() {}

    public static <T extends Throwable> Optional<T> findCause(
            Throwable throwable,
            Class<T> type
    ) {
        Throwable current = throwable;
        while (current != null) {
            if (type.isInstance(current)) {
                return Optional.of(type.cast(current));
            }
            current = current.getCause();
        }
        return Optional.empty();
    }

    public static List<Throwable> chain(Throwable throwable) {
        List<Throwable> result = new ArrayList<>();
        Throwable current = throwable;
        while (current != null && !result.contains(current)) {
            result.add(current);
            current = current.getCause();
        }
        return result;
    }
}
```

### 7.2 SQL Exception Extraction

```java
public record SqlErrorInfo(
        String sqlState,
        Integer vendorCode,
        String message,
        String constraintName
) {}
```

```java
public final class SqlErrorExtractor {
    public Optional<SqlErrorInfo> extract(Throwable throwable) {
        Optional<SQLException> sqlEx = ThrowableWalker.findCause(throwable, SQLException.class);
        if (sqlEx.isEmpty()) {
            return Optional.empty();
        }

        SQLException e = sqlEx.get();
        return Optional.of(new SqlErrorInfo(
                e.getSQLState(),
                e.getErrorCode(),
                safeMessage(e),
                tryExtractConstraintName(throwable, e)
        ));
    }

    private String safeMessage(SQLException e) {
        return e.getMessage(); // log only; do not expose directly to client
    }

    private String tryExtractConstraintName(Throwable throwable, SQLException e) {
        // Prefer provider API if available. Fallback to regex/vendor parsing only internally.
        Optional<org.hibernate.exception.ConstraintViolationException> hibernate =
                ThrowableWalker.findCause(throwable, org.hibernate.exception.ConstraintViolationException.class);

        if (hibernate.isPresent()) {
            return hibernate.get().getConstraintName();
        }

        return null;
    }
}
```

Catatan: jika codebase ingin bebas dari Hibernate dependency, letakkan extractor Hibernate di adapter/infrastructure module.

### 7.3 Classifier dengan Spring DataAccessException

```java
public final class PersistenceFailureClassifier {
    private final SqlErrorExtractor sqlErrorExtractor;
    private final ConstraintRegistry constraintRegistry;

    public PersistenceFailureClassifier(
            SqlErrorExtractor sqlErrorExtractor,
            ConstraintRegistry constraintRegistry
    ) {
        this.sqlErrorExtractor = sqlErrorExtractor;
        this.constraintRegistry = constraintRegistry;
    }

    public PersistenceFailure classify(Throwable throwable) {
        if (isOptimisticConflict(throwable)) {
            return new PersistenceFailure.ConcurrencyConflict(
                    "unknown",
                    null,
                    "optimistic_lock_conflict"
            );
        }

        if (isDataIntegrityViolation(throwable)) {
            return classifyConstraint(throwable);
        }

        if (isDeadlockOrSerializationFailure(throwable)) {
            return new PersistenceFailure.TransientFailure(
                    "deadlock_or_serialization_failure",
                    true
            );
        }

        if (isLockTimeout(throwable)) {
            return new PersistenceFailure.TransientFailure(
                    "lock_timeout",
                    true
            );
        }

        if (isConnectionFailure(throwable)) {
            return new PersistenceFailure.InfrastructureFailure(
                    "database_connection_failure",
                    true
            );
        }

        if (isQueryOrMappingBug(throwable)) {
            return new PersistenceFailure.ProgrammingFailure(
                    "query_or_mapping_error"
            );
        }

        if (isTransactionStateFailure(throwable)) {
            return new PersistenceFailure.ProgrammingFailure(
                    "transaction_state_error"
            );
        }

        return new PersistenceFailure.UnknownFailure(throwable.getClass().getName());
    }

    private boolean isOptimisticConflict(Throwable t) {
        return ThrowableWalker.findCause(t, jakarta.persistence.OptimisticLockException.class).isPresent()
                || ThrowableWalker.findCause(t, org.springframework.orm.ObjectOptimisticLockingFailureException.class).isPresent()
                || ThrowableWalker.findCause(t, org.hibernate.StaleObjectStateException.class).isPresent();
    }

    private boolean isDataIntegrityViolation(Throwable t) {
        return ThrowableWalker.findCause(t, org.springframework.dao.DataIntegrityViolationException.class).isPresent()
                || ThrowableWalker.findCause(t, org.hibernate.exception.ConstraintViolationException.class).isPresent();
    }

    private PersistenceFailure classifyConstraint(Throwable t) {
        Optional<SqlErrorInfo> sql = sqlErrorExtractor.extract(t);
        String constraintName = sql.map(SqlErrorInfo::constraintName).orElse(null);

        Optional<ConstraintDescriptor> known = constraintRegistry.find(constraintName);
        if (known.isPresent()) {
            ConstraintDescriptor c = known.get();
            return new PersistenceFailure.ConstraintFailure(
                    constraintName,
                    c.kind(),
                    c.entityName(),
                    c.userCorrectable()
            );
        }

        return new PersistenceFailure.ConstraintFailure(
                constraintName,
                ConstraintKind.UNKNOWN,
                "unknown",
                false
        );
    }

    private boolean isDeadlockOrSerializationFailure(Throwable t) {
        if (ThrowableWalker.findCause(t, org.springframework.dao.DeadlockLoserDataAccessException.class).isPresent()) {
            return true;
        }
        Optional<SqlErrorInfo> sql = sqlErrorExtractor.extract(t);
        return sql.map(s -> s.sqlState() != null && s.sqlState().startsWith("40")).orElse(false);
    }

    private boolean isLockTimeout(Throwable t) {
        return ThrowableWalker.findCause(t, jakarta.persistence.LockTimeoutException.class).isPresent()
                || ThrowableWalker.findCause(t, jakarta.persistence.PessimisticLockException.class).isPresent()
                || ThrowableWalker.findCause(t, org.springframework.dao.CannotAcquireLockException.class).isPresent();
    }

    private boolean isConnectionFailure(Throwable t) {
        return ThrowableWalker.findCause(t, org.springframework.jdbc.CannotGetJdbcConnectionException.class).isPresent()
                || ThrowableWalker.findCause(t, org.hibernate.exception.JDBCConnectionException.class).isPresent()
                || ThrowableWalker.findCause(t, SQLTransientConnectionException.class).isPresent()
                || ThrowableWalker.findCause(t, SQLRecoverableException.class).isPresent();
    }

    private boolean isQueryOrMappingBug(Throwable t) {
        return ThrowableWalker.findCause(t, org.hibernate.exception.SQLGrammarException.class).isPresent()
                || ThrowableWalker.findCause(t, org.hibernate.MappingException.class).isPresent()
                || ThrowableWalker.findCause(t, org.hibernate.QueryException.class).isPresent()
                || ThrowableWalker.findCause(t, org.springframework.dao.InvalidDataAccessResourceUsageException.class).isPresent()
                || ThrowableWalker.findCause(t, org.hibernate.LazyInitializationException.class).isPresent();
    }

    private boolean isTransactionStateFailure(Throwable t) {
        return ThrowableWalker.findCause(t, jakarta.persistence.TransactionRequiredException.class).isPresent()
                || ThrowableWalker.findCause(t, org.springframework.transaction.UnexpectedRollbackException.class).isPresent()
                || ThrowableWalker.findCause(t, org.springframework.transaction.IllegalTransactionStateException.class).isPresent();
    }
}
```

Ini contoh arsitektur, bukan library final. Dalam production, classifier harus dites terhadap database dan driver yang benar.

---

## 8. Mapping ke API Error

### 8.1 Public Error Contract

Jangan expose:

- SQL string,
- table name internal,
- column sensitif,
- constraint name internal,
- vendor error message mentah,
- stack trace,
- schema name,
- host/database name.

Expose:

- stable public error code,
- human-readable safe message,
- request/correlation id,
- field/resource jika aman,
- conflict information jika domain mengizinkan,
- retry hint jika sesuai.

Contoh response:

```json
{
  "error": {
    "code": "APPLICATION_REFERENCE_ALREADY_EXISTS",
    "message": "An application with the same reference number already exists.",
    "correlationId": "01J...",
    "retryable": false
  }
}
```

### 8.2 Error Code Design

Gunakan kode yang:

- stabil,
- domain-friendly,
- tidak terlalu teknis,
- tidak berubah saat pindah database/provider,
- bisa dipakai FE/client/support.

Contoh:

```text
APPLICATION_NOT_FOUND
APPLICATION_REFERENCE_ALREADY_EXISTS
APPLICATION_ALREADY_SUBMITTED
APPLICATION_VERSION_CONFLICT
CASE_ASSIGNMENT_CONFLICT
CASE_LOCK_TIMEOUT
DATABASE_TEMPORARILY_UNAVAILABLE
REQUEST_ALREADY_PROCESSED
REQUEST_IDEMPOTENCY_CONFLICT
INTERNAL_PERSISTENCE_ERROR
```

### 8.3 HTTP Mapping

| Failure | HTTP |
|---|---:|
| entity not found | 404 |
| invalid request body | 400 |
| semantic validation failed | 422 |
| unique conflict | 409 |
| optimistic lock conflict | 409 |
| duplicate idempotency key with different payload | 409 |
| unauthorized data access | 403 |
| query timeout through gateway | 504 |
| database unavailable | 503 |
| connection pool exhausted | 503 |
| programming/mapping bug | 500 |
| unknown commit outcome | 503/202/409 depending protocol |

### 8.4 Spring `@ControllerAdvice` Example

```java
@RestControllerAdvice
public class ApiExceptionHandler {
    private final PersistenceFailureClassifier classifier;

    public ApiExceptionHandler(PersistenceFailureClassifier classifier) {
        this.classifier = classifier;
    }

    @ExceptionHandler(DataAccessException.class)
    public ResponseEntity<ApiErrorResponse> handleDataAccess(
            DataAccessException ex,
            HttpServletRequest request
    ) {
        PersistenceFailure failure = classifier.classify(ex);
        ApiError error = mapFailure(failure, request);
        return ResponseEntity.status(error.httpStatus()).body(new ApiErrorResponse(error));
    }

    @ExceptionHandler(jakarta.persistence.PersistenceException.class)
    public ResponseEntity<ApiErrorResponse> handlePersistence(
            jakarta.persistence.PersistenceException ex,
            HttpServletRequest request
    ) {
        PersistenceFailure failure = classifier.classify(ex);
        ApiError error = mapFailure(failure, request);
        return ResponseEntity.status(error.httpStatus()).body(new ApiErrorResponse(error));
    }

    private ApiError mapFailure(PersistenceFailure failure, HttpServletRequest request) {
        String correlationId = request.getHeader("X-Correlation-Id");

        if (failure instanceof PersistenceFailure.ConcurrencyConflict) {
            return ApiError.conflict(
                    "RESOURCE_VERSION_CONFLICT",
                    "The record was modified by another transaction. Please refresh and try again.",
                    correlationId
            );
        }

        if (failure instanceof PersistenceFailure.ConstraintFailure c) {
            if (c.userCorrectable()) {
                return ApiError.conflict(
                        "DATA_CONSTRAINT_CONFLICT",
                        "The request conflicts with existing data.",
                        correlationId
                );
            }
            return ApiError.internal(
                    "INTERNAL_DATA_INTEGRITY_ERROR",
                    "The operation could not be completed.",
                    correlationId
            );
        }

        if (failure instanceof PersistenceFailure.TransientFailure) {
            return ApiError.serviceUnavailable(
                    "DATABASE_OPERATION_RETRYABLE_FAILURE",
                    "The operation could not be completed due to temporary database contention.",
                    correlationId
            );
        }

        if (failure instanceof PersistenceFailure.InfrastructureFailure) {
            return ApiError.serviceUnavailable(
                    "DATABASE_TEMPORARILY_UNAVAILABLE",
                    "The service is temporarily unavailable.",
                    correlationId
            );
        }

        return ApiError.internal(
                "INTERNAL_PERSISTENCE_ERROR",
                "The operation could not be completed.",
                correlationId
        );
    }
}
```

---

## 9. Retry Design

### 9.1 Golden Rule

```text
Never retry blindly.
Never retry inside the same failed transaction.
Never retry non-idempotent side effects without idempotency.
```

Retry harus dilakukan pada **operation boundary** yang bisa diulang secara aman.

Buruk:

```java
@Transactional
public void approve(UUID caseId) {
    for (int i = 0; i < 3; i++) {
        try {
            doApprove(caseId);
            return;
        } catch (DeadlockLoserDataAccessException e) {
            // transaction may already be broken
        }
    }
}
```

Lebih baik:

```java
public void approveWithRetry(ApproveCommand command) {
    retryTemplate.execute(context -> {
        approveInNewTransaction(command);
        return null;
    });
}

@Transactional
public void approveInNewTransaction(ApproveCommand command) {
    approvalService.approve(command);
}
```

Atau gunakan declarative retry dengan hati-hati, pastikan transaction boundary baru dibuat per attempt. Dalam Spring, urutan AOP advice antara retry dan transaction penting.

### 9.2 Retryable Failure

Biasanya retryable jika:

- deadlock,
- serialization failure,
- transient connection failover,
- temporary lock timeout,
- transient resource unavailable,
- optimistic lock hanya untuk operasi idempotent/commutative tertentu.

Biasanya tidak retryable:

- validation failure,
- unique constraint biasa,
- foreign key invalid input,
- SQL grammar error,
- mapping error,
- lazy initialization,
- non-unique result karena bug query,
- data truncation akibat input invalid,
- authorization failure.

### 9.3 Retry Policy

Contoh policy:

```text
maxAttempts: 3
backoff: 100ms, 300ms, 900ms
jitter: ±30%
timeout budget: must be less than API timeout
retryable: SQLState class 40, selected connection transient errors
nonRetryable: constraint, validation, query/mapping bug
idempotency required: yes for commands with side effects
```

### 9.4 Idempotency Requirement

Command retry harus punya identity:

```text
command_id / idempotency_key / request_id
```

Table:

```sql
create table idempotency_record (
    tenant_id varchar(64) not null,
    idempotency_key varchar(128) not null,
    request_hash varchar(128) not null,
    status varchar(32) not null,
    response_body clob null,
    created_at timestamp not null,
    completed_at timestamp null,
    constraint pk_idempotency_record primary key (tenant_id, idempotency_key)
);
```

Jika retry terjadi setelah unknown outcome, idempotency record membantu menentukan apakah command sudah diproses.

---

## 10. Flush-Time Failure vs Commit-Time Failure

### 10.1 Flush-Time Failure

Contoh:

```java
@Transactional
public void submit(SubmitCommand command) {
    Application app = mapper.toEntity(command);
    em.persist(app);
    em.flush(); // constraint violation can appear here
    outboxRepository.add(...);
}
```

Flush mengirim SQL ke database tetapi belum commit.

Jika flush gagal:

- transaction biasanya harus rollback,
- persistence context bisa tidak aman dipakai lanjut,
- jangan lanjutkan side effect,
- jangan swallow exception dan terus commit.

### 10.2 Commit-Time Failure

Failure bisa muncul saat commit karena:

- deferred constraint,
- transaction timeout,
- optimistic lock at commit,
- database/network fail,
- XA transaction issue,
- trigger error,
- materialized view/log constraint,
- database-side validation.

Implication:

- code setelah method transactional mungkin melihat exception dari proxy commit, bukan dari baris repository,
- controller/service harus siap exception muncul setelah method body selesai,
- after-commit side effect harus benar-benar after commit, bukan sebelum commit.

### 10.3 Deferred Constraint Example

Beberapa database mendukung deferred constraint. Constraint tidak gagal saat insert/update, tetapi saat commit.

Mental model:

```text
flush success != transaction success
method body success != commit success
commit response lost != known rollback
```

---

## 11. Rollback-Only State

Rollback-only berarti transaction sudah ditandai tidak boleh commit.

Penyebab:

- runtime exception dalam transaction,
- persistence provider menandai rollback karena error,
- timeout,
- explicit `setRollbackOnly`,
- inner method gagal pada propagation yang sama.

Contoh jebakan:

```java
@Transactional
public void importRows(List<Row> rows) {
    for (Row row : rows) {
        try {
            importOne(row);
        } catch (Exception e) {
            errorLogRepository.save(ErrorLog.from(row, e));
        }
    }
}
```

Jika `importOne()` menyebabkan persistence exception dalam transaction yang sama, transaction bisa rollback-only. `errorLogRepository.save()` ikut rollback.

Solusi:

- chunk transaction,
- per-row `REQUIRES_NEW` dengan hati-hati,
- error log di transaction terpisah,
- staging table,
- validate before write,
- skip/retry policy dengan Spring Batch.

Contoh:

```java
public void importRows(List<Row> rows) {
    for (Row row : rows) {
        try {
            importOneInNewTransaction(row);
        } catch (Exception e) {
            recordFailureInNewTransaction(row, e);
        }
    }
}

@Transactional
public void importOneInNewTransaction(Row row) {
    // one transaction per row or per chunk
}

@Transactional(propagation = Propagation.REQUIRES_NEW)
public void recordFailureInNewTransaction(Row row, Exception e) {
    errorLogRepository.save(ErrorLog.from(row, e));
}
```

Tetap pertimbangkan cost connection pool dan throughput.

---

## 12. Case Study: Submit Application dengan Unique Reference

### 12.1 Requirement

```text
User submits application.
Each tenant must have unique reference number.
If duplicate occurs, return conflict.
System must not create duplicate outbox event.
```

### 12.2 Database Constraint

```sql
alter table application
add constraint uk_application_tenant_reference_no
unique (tenant_id, reference_no);
```

### 12.3 Service

```java
@Transactional
public SubmitApplicationResult submit(SubmitApplicationCommand command) {
    Application app = Application.submit(
            command.tenantId(),
            command.referenceNo(),
            command.applicantId(),
            command.payload()
    );

    applicationRepository.save(app);

    outboxRepository.save(OutboxMessage.applicationSubmitted(
            app.id(),
            app.referenceNo(),
            app.tenantId()
    ));

    return new SubmitApplicationResult(app.publicId(), app.referenceNo());
}
```

### 12.4 Error Handling

Jika unique violation:

- DB rollback,
- outbox insert rollback juga,
- response 409,
- log internal memuat constraint name,
- public response tidak memuat SQL.

```json
{
  "error": {
    "code": "APPLICATION_REFERENCE_ALREADY_EXISTS",
    "message": "An application with this reference number already exists.",
    "retryable": false
  }
}
```

### 12.5 Kenapa Tidak Cukup `existsByReferenceNo()`?

Naif:

```java
if (repository.existsByReferenceNo(refNo)) {
    throw new DuplicateReferenceException();
}
repository.save(app);
```

Race:

```text
T1: exists false
T2: exists false
T1: insert success
T2: insert unique violation
```

Jadi `exists()` boleh dipakai untuk user-friendly early check, tetapi database constraint tetap final guard.

---

## 13. Case Study: Approval Conflict

### 13.1 Requirement

```text
Two officers cannot approve the same case concurrently.
Client sends expected version.
If version changed, return conflict.
```

### 13.2 Entity

```java
@Entity
@Table(name = "case_file")
public class CaseFile {
    @Id
    private Long id;

    @Version
    private long version;

    @Enumerated(EnumType.STRING)
    private CaseStatus status;

    public void approve(UserId officerId, long expectedVersion) {
        if (this.version != expectedVersion) {
            throw new DomainConflictException("CASE_VERSION_CONFLICT");
        }
        if (this.status != CaseStatus.UNDER_REVIEW) {
            throw new DomainConflictException("CASE_NOT_UNDER_REVIEW");
        }
        this.status = CaseStatus.APPROVED;
    }
}
```

### 13.3 Service

```java
@Transactional
public void approve(ApproveCaseCommand command) {
    CaseFile caseFile = caseRepository.findByPublicId(command.casePublicId())
            .orElseThrow(() -> new NotFoundException("CASE_NOT_FOUND"));

    caseFile.approve(command.officerId(), command.expectedVersion());

    auditRepository.save(AuditEntry.caseApproved(caseFile.id(), command.officerId()));
    outboxRepository.save(OutboxMessage.caseApproved(caseFile.id()));
}
```

### 13.4 Failure Possibilities

| Failure | Handling |
|---|---|
| version mismatch before change | 409 domain conflict |
| `OptimisticLockException` at flush/commit | 409 conflict |
| deadlock due audit/order issue | retry if idempotent or return 503 |
| audit constraint fails | rollback; 500/internal or constraint-specific |
| outbox unique duplicate | idempotency handling |

---

## 14. Case Study: Message Consumer with Inbox

### 14.1 Requirement

```text
Consumer receives event at-least-once.
Duplicate event must not create duplicate effect.
```

### 14.2 Inbox Constraint

```sql
create table inbox_message (
    consumer_name varchar(128) not null,
    message_id varchar(128) not null,
    received_at timestamp not null,
    processed_at timestamp null,
    status varchar(32) not null,
    constraint pk_inbox_message primary key (consumer_name, message_id)
);
```

### 14.3 Consumer

```java
@Transactional
public void consume(ApplicationSubmittedEvent event) {
    boolean firstTime = inboxRepository.tryInsert(
            "screening-consumer",
            event.messageId()
    );

    if (!firstTime) {
        return; // duplicate delivery
    }

    screeningService.createScreeningTask(event.applicationId());
    inboxRepository.markProcessed("screening-consumer", event.messageId());
}
```

`tryInsert` bisa memakai insert dan menangkap duplicate key.

```java
public boolean tryInsert(String consumerName, String messageId) {
    try {
        jdbcTemplate.update("""
            insert into inbox_message(consumer_name, message_id, received_at, status)
            values (?, ?, current_timestamp, 'RECEIVED')
            """, consumerName, messageId);
        return true;
    } catch (DuplicateKeyException e) {
        return false;
    }
}
```

Di sini duplicate key bukan error. Itu bagian dari protocol idempotency.

---

## 15. Exception Classification by Common Scenario

### 15.1 `NoResultException`

Classify:

```text
expected absence
```

Action:

- return Optional,
- 404 jika resource endpoint,
- jangan log error stack trace.

### 15.2 `NonUniqueResultException`

Classify:

```text
programming/data integrity bug
```

Action:

- 500,
- add unique constraint if domain expects uniqueness,
- inspect duplicate data,
- fix query cardinality.

### 15.3 `OptimisticLockException`

Classify:

```text
concurrency conflict
```

Action:

- rollback,
- 409,
- no blind retry for user decision,
- include refresh instruction.

### 15.4 `PessimisticLockException` / `LockTimeoutException`

Classify:

```text
contention / transient / conflict depending use case
```

Action:

- retry for worker/batch if idempotent,
- 409 for interactive record lock,
- 503 if infrastructure-like saturation.

### 15.5 `ConstraintViolationException`

Classify:

```text
constraint-specific
```

Action:

- map known constraint,
- unknown constraint = internal error until classified,
- do not expose DB message.

### 15.6 `DataIntegrityViolationException`

Classify:

```text
constraint/data error umbrella
```

Action:

- inspect root cause,
- map constraint name/SQLState,
- distinguish duplicate vs FK vs not-null vs length.

### 15.7 `SQLGrammarException`

Classify:

```text
programming/deployment/schema bug
```

Action:

- 500,
- check migration applied,
- check dialect,
- check table/column name,
- check privilege.

### 15.8 `LazyInitializationException`

Classify:

```text
fetch boundary bug
```

Action:

- fix fetch plan/projection/application boundary,
- avoid enabling OSIV as default “fix” without reasoning,
- add integration test.

### 15.9 `TransactionRequiredException`

Classify:

```text
transaction boundary bug
```

Action:

- put write operation inside transaction,
- fix async/thread boundary,
- check proxy/self-invocation.

### 15.10 `UnexpectedRollbackException`

Classify:

```text
transaction state/flow bug
```

Action:

- find earlier swallowed exception,
- separate recovery transaction,
- avoid continuing after rollback-only.

---

## 16. Vendor Error Examples

Jangan menghafal semua kode. Pahami bahwa production classifier sering butuh mapping vendor.

### 16.1 Oracle

Common examples:

| Oracle code | General meaning |
|---:|---|
| ORA-00001 | unique constraint violated |
| ORA-02291 | FK parent key not found |
| ORA-02292 | FK child record exists |
| ORA-01400 | cannot insert NULL |
| ORA-01438 | value larger than precision |
| ORA-12899 | value too large for column |
| ORA-00060 | deadlock detected |
| ORA-01013 | user requested cancel / timeout-like |
| ORA-01017 | invalid username/password |
| ORA-12154 / ORA-12514 | connection/listener/TNS issues |

### 16.2 PostgreSQL

Common SQLSTATE:

| SQLSTATE | General meaning |
|---|---|
| 23505 | unique violation |
| 23503 | foreign key violation |
| 23502 | not null violation |
| 23514 | check violation |
| 40001 | serialization failure |
| 40P01 | deadlock detected |
| 57014 | query canceled |
| 08006 | connection failure |
| 42P01 | undefined table |
| 42703 | undefined column |

### 16.3 MySQL / InnoDB

Common examples:

| Code | General meaning |
|---:|---|
| 1062 | duplicate entry |
| 1452 | cannot add/update child row FK fails |
| 1451 | cannot delete/update parent row FK fails |
| 1048 | column cannot be null |
| 1406 | data too long |
| 1213 | deadlock found |
| 1205 | lock wait timeout |
| 2006/2013 | server gone/lost connection |

### 16.4 SQL Server

Common examples:

| Code | General meaning |
|---:|---|
| 2627 | primary/unique constraint violation |
| 2601 | duplicate key row |
| 547 | constraint conflict / FK/check |
| 1205 | deadlock victim |
| 1222 | lock request timeout |
| 8152/2628 | string or binary data truncated |

Important: vendor code mapping harus diuji dengan driver/version/database yang dipakai.

---

## 17. Observability untuk Persistence Failure

### 17.1 Log Field Minimal

Untuk persistence exception, log structured field:

```text
correlation_id
request_id
idempotency_key
tenant_id
actor_id
operation
aggregate_type
aggregate_id
transaction_name
exception_class
root_exception_class
sql_state
vendor_code
constraint_name
retry_attempt
retryable
rollback_only
connection_pool_active
connection_pool_pending
query_name/sql_fingerprint
elapsed_ms
```

Jangan log:

- PII mentah,
- full SQL dengan parameter sensitif,
- password/token,
- large payload,
- CLOB/BLOB,
- stack trace berulang di high-volume expected conflict.

### 17.2 Metrics

Metrics penting:

```text
persistence.failure.count{class, operation, constraint, retryable}
persistence.constraint.violation.count{constraint}
persistence.optimistic_lock.count{entity, operation}
persistence.deadlock.count{operation}
persistence.lock_timeout.count{operation}
persistence.query_timeout.count{query}
persistence.connection_failure.count
persistence.retry.count{operation, result}
persistence.rollback.count{operation}
persistence.commit.failure.count
```

### 17.3 Alerting

Alert bukan untuk semua error.

Alert candidate:

- DB connection failure spike,
- pool exhaustion,
- deadlock spike,
- query timeout spike,
- unknown constraint violation,
- SQL grammar exception after deployment,
- commit failure,
- heuristic mixed,
- outbox stuck,
- retry exhausted spike.

Tidak perlu page operator untuk setiap 409 optimistic conflict normal.

### 17.4 Error Budget Thinking

Bedakan:

```text
Expected business rejection != service unreliability
Concurrency conflict normal != outage
Unknown persistence failure != normal
```

SLO API harus memisahkan 4xx expected domain errors dari 5xx system failures.

---

## 18. Testing Error Handling

### 18.1 Jangan Hanya Mock Repository

Mock repository tidak bisa membuktikan:

- constraint violation database,
- SQLState/vendor code,
- optimistic lock exception,
- deadlock,
- transaction rollback-only,
- flush vs commit timing,
- Spring exception translation,
- provider-specific wrapping.

Gunakan database nyata via integration test/Testcontainers atau environment test yang representatif.

### 18.2 Test Unique Constraint Mapping

```java
@Test
void duplicateReferenceShouldReturnConflictCode() {
    submit(referenceNo("APP-001"));

    ApiError error = assertThrowsApiError(() -> submit(referenceNo("APP-001")));

    assertThat(error.code()).isEqualTo("APPLICATION_REFERENCE_ALREADY_EXISTS");
    assertThat(error.status()).isEqualTo(409);
}
```

### 18.3 Test Optimistic Lock

```java
@Test
void staleApprovalShouldReturnConflict() {
    CaseFile a = repository.findById(caseId).orElseThrow();
    CaseFile b = repository.findById(caseId).orElseThrow();

    approveInTx(a.id(), a.version());

    ApiError error = assertThrowsApiError(() -> approveInTx(b.id(), b.version()));

    assertThat(error.code()).isEqualTo("CASE_VERSION_CONFLICT");
    assertThat(error.status()).isEqualTo(409);
}
```

Pastikan persistence context berbeda agar benar-benar stale.

### 18.4 Test Rollback-Only

Buat test bahwa swallowed exception tidak menghasilkan partial success.

```java
@Test
void swallowedPersistenceExceptionShouldNotCommitLaterWrites() {
    assertThrows(Exception.class, () -> service.processWithSwallowedConstraintViolation());

    assertThat(auditRepository.findByType("AFTER_FAILURE")).isEmpty();
}
```

### 18.5 Test Retry Boundary

Test bahwa setiap retry attempt memakai transaction baru dan tidak menduplikasi side effect.

```java
@Test
void deadlockRetryShouldNotCreateDuplicateOutbox() {
    commandService.executeWithSimulatedDeadlockThenSuccess(command);

    assertThat(outboxRepository.countByAggregateId(command.aggregateId())).isEqualTo(1);
}
```

---

## 19. Design Patterns untuk Robust Error Handling

### 19.1 Error Boundary di Application Service

```text
Controller
  -> maps request
  -> calls application service
Application Service
  -> owns transaction
  -> throws domain/application exceptions
Repository
  -> throws persistence/provider exceptions
Infrastructure Exception Translator
  -> classifies low-level exceptions
Controller Advice / API Adapter
  -> maps application exceptions to response
```

Jangan letakkan semua mapping di repository. Repository tidak tahu HTTP contract.

### 19.2 Domain Exception vs Persistence Exception

Domain exception:

```java
public class DomainConflictException extends RuntimeException {
    private final String code;

    public DomainConflictException(String code) {
        super(code);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
```

Persistence exception classification boleh menghasilkan domain/application exception jika constraint diketahui.

```java
if (constraint == APPLICATION_REFERENCE_UNIQUE) {
    throw new DomainConflictException("APPLICATION_REFERENCE_ALREADY_EXISTS");
}
```

### 19.3 Defensive Flush for Early Classification

Kadang kita sengaja `flush()` sebelum melakukan action berikutnya agar failure muncul di tempat yang bisa diklasifikasikan.

```java
@Transactional
public void submit(SubmitCommand command) {
    applicationRepository.save(app);
    entityManager.flush(); // detect DB constraints before building expensive side effects

    outboxRepository.save(...);
}
```

Tapi jangan terlalu sering flush karena bisa merusak batching/performance. Gunakan saat ada alasan boundary/error handling jelas.

### 19.4 Constraint-Driven Idempotency

Gunakan unique constraint sebagai mekanisme concurrency-safe.

```sql
create unique index uk_payment_request_idempotency
on payment_request(tenant_id, idempotency_key);
```

Duplicate insert bukan selalu error. Itu signal untuk load existing result.

### 19.5 Retry + Outbox

Untuk operasi yang menghasilkan event:

```text
Attempt 1:
  insert aggregate
  insert outbox
  deadlock -> rollback
Attempt 2:
  insert aggregate
  insert outbox
  commit
Publisher:
  publish outbox at-least-once
Consumer:
  inbox dedupe
```

Tanpa outbox, retry bisa menciptakan event/email duplicate.

---

## 20. Anti-Pattern

### 20.1 Catch `Exception` dan Return Generic Failure

```java
catch (Exception e) {
    return ApiResponse.error("FAILED");
}
```

Masalah:

- conflict jadi 500,
- retryable tidak diketahui,
- validation gap tersembunyi,
- operator tidak punya sinyal.

### 20.2 Retry Semua `RuntimeException`

```java
@Retryable(RuntimeException.class)
@Transactional
public void process(Command command) { ... }
```

Masalah:

- validation error diulang,
- unique violation diulang,
- programming bug diulang,
- bisa memperburuk load.

### 20.3 Expose SQL Error ke User

```json
{
  "message": "ORA-00001: unique constraint (APP.UK_APPLICATION_TENANT_REFERENCE_NO) violated"
}
```

Masalah:

- bocor schema,
- tidak user-friendly,
- security risk.

### 20.4 Semua Constraint Violation Jadi 400

Tidak semua constraint violation kesalahan user. Unknown constraint violation harus dianggap internal sampai dipetakan.

### 20.5 Mengabaikan Constraint Name

Tanpa constraint name, kamu tidak bisa membedakan:

```text
duplicate email
duplicate idempotency key
duplicate active assignment
duplicate workflow transition
```

### 20.6 Menelan Exception dalam Transaction

```java
try {
    repository.save(x);
} catch (DataAccessException e) {
    log.warn("ignored");
}
repository.save(y);
```

Transaction bisa rollback-only. Jangan lanjut seolah normal.

### 20.7 Menganggap Flush Sukses = Commit Sukses

Flush sukses hanya berarti SQL sudah dikirim dan diterima dalam transaction. Commit masih bisa gagal.

### 20.8 Menganggap Commit Failure = Rollback

Commit failure bisa unknown outcome, terutama saat koneksi putus saat commit response.

### 20.9 Mapping Exception Terlalu Dekat ke Vendor

Application layer tidak seharusnya penuh dengan:

```java
if (message.contains("ORA-00001")) ...
```

Letakkan vendor mapping di infrastructure classifier.

### 20.10 Tidak Mengetes Exception Translation

Exception wrapping berbeda antara:

- Hibernate 5 vs 6 vs 7,
- javax vs jakarta,
- Spring Boot 2 vs 3,
- Oracle vs PostgreSQL,
- driver version,
- flush vs commit.

Test integrasi wajib.

---

## 21. Production Playbook

### 21.1 Spike Unique Constraint Violation

Pertanyaan:

```text
Constraint apa?
Operation apa?
Tenant/user tertentu?
Deployment baru?
Apakah idempotency key duplicate normal?
Apakah attack/abuse?
Apakah sequence/reference generator broken?
```

Action:

- cek metric by constraint,
- cek recent deployment,
- cek request hash/idempotency,
- cek generator/state.

### 21.2 Spike Optimistic Lock

Pertanyaan:

```text
Entity apa?
Operation apa?
Apakah UI stale?
Apakah polling/auto-save?
Apakah batch bersaing dengan user?
Apakah aggregate terlalu hot?
```

Action:

- inspect workflow,
- consider command version,
- reduce contention,
- split aggregate if needed,
- improve UI refresh/conflict resolution.

### 21.3 Deadlock Spike

Pertanyaan:

```text
Table pair apa?
Index apa?
Transaction order berubah?
Batch job baru?
Foreign key cascade?
New query plan?
```

Action:

- capture deadlock graph/database diagnostics,
- enforce deterministic lock ordering,
- reduce transaction duration,
- add index,
- chunk batch,
- bounded retry.

### 21.4 Pool Exhaustion

Pertanyaan:

```text
Active connections?
Pending threads?
Long transactions?
Slow queries?
Connection leak?
External API inside transaction?
Virtual thread concurrency too high?
```

Action:

- inspect pool metrics,
- thread dump,
- DB session list,
- query duration,
- transaction boundaries,
- backpressure.

### 21.5 SQLGrammarException After Deployment

Pertanyaan:

```text
Migration applied?
Wrong schema?
Wrong dialect?
Column renamed?
Privilege missing?
Blue/green version compatibility broken?
```

Action:

- rollback app or apply migration depending safe path,
- verify schema drift,
- add migration compatibility tests.

### 21.6 Unknown Commit Outcome

Pertanyaan:

```text
Does command have idempotency key?
Can we query by business key?
Was outbox written?
Was external effect triggered?
Can reconciliation determine final state?
```

Action:

- do not blindly retry non-idempotent command,
- query durable state,
- reconcile outbox/external side effect,
- respond with retry-after/status endpoint if protocol supports.

---

## 22. Checklist Desain Error Handling Persistence

### 22.1 Classification Checklist

- [ ] Apakah exception hierarchy dipahami dari JDBC → Hibernate → JPA → Spring?
- [ ] Apakah ada centralized failure classifier?
- [ ] Apakah classifier membaca root cause?
- [ ] Apakah SQLState/vendor code disimpan di log?
- [ ] Apakah constraint name diekstrak?
- [ ] Apakah known constraints dipetakan ke public error code?
- [ ] Apakah unknown constraint dianggap internal sampai diklasifikasi?
- [ ] Apakah optimistic conflict dipetakan ke 409?
- [ ] Apakah deadlock/serialization failure punya bounded retry?
- [ ] Apakah retry dilakukan di transaction baru?
- [ ] Apakah non-retryable error tidak diretry?
- [ ] Apakah connection/infrastructure failure dipetakan ke 503?
- [ ] Apakah query/mapping bug dipetakan ke 500 dan alert?
- [ ] Apakah rollback-only state tidak ditelan?

### 22.2 API Checklist

- [ ] Public response tidak membocorkan SQL/table/constraint internal.
- [ ] Error code stabil.
- [ ] Response menyertakan correlation id.
- [ ] Retry hint hanya diberikan jika benar.
- [ ] Conflict response punya message actionable.
- [ ] 4xx dan 5xx dipisahkan benar.
- [ ] Idempotency replay punya behavior jelas.

### 22.3 Transaction Checklist

- [ ] Flush-time dan commit-time failure dipahami.
- [ ] Side effect eksternal tidak dilakukan sebelum commit tanpa outbox/compensation.
- [ ] Recovery/audit setelah failure memakai transaction baru jika perlu.
- [ ] Retry tidak menggunakan persistence context lama.
- [ ] Batch failure memakai chunk/skip/retry policy.

### 22.4 Observability Checklist

- [ ] Log structured field lengkap.
- [ ] Metrics per failure class.
- [ ] Metrics per constraint.
- [ ] Deadlock/lock timeout monitored.
- [ ] Pool exhaustion monitored.
- [ ] Unknown/unclassified persistence failure alert.
- [ ] Outbox stuck monitored.
- [ ] Retry exhausted monitored.

---

## 23. Latihan / Scenario

### Scenario 1 — Duplicate Application Reference

Requirement:

```text
Tenant cannot have two applications with same reference number.
Concurrent submit can happen.
```

Tugas:

1. Desain unique constraint.
2. Desain service submit.
3. Desain exception mapping.
4. Tentukan HTTP response.
5. Tentukan log field.
6. Tentukan test integration.

Expected reasoning:

- `exists()` optional untuk early feedback.
- Unique constraint adalah final guard.
- Duplicate maps to 409.
- Constraint name harus known.
- Outbox insert harus satu transaction dengan aggregate.

### Scenario 2 — Two Officers Approve Same Case

Requirement:

```text
Only one approval can win.
Second approval must not silently overwrite.
```

Tugas:

1. Pakai `@Version` atau conditional update.
2. Petakan stale update ke 409.
3. Tentukan apakah retry otomatis benar.
4. Pastikan audit tidak double.

Expected reasoning:

- User decision stale tidak boleh blind retry.
- Use expected version.
- Return conflict with refresh instruction.

### Scenario 3 — Deadlock in Batch Assignment

Requirement:

```text
Batch assigns cases to officers.
Occasional deadlock occurs.
```

Tugas:

1. Klasifikasikan deadlock.
2. Buat retry policy.
3. Tentukan lock ordering.
4. Tentukan chunk size.
5. Pastikan idempotency.

Expected reasoning:

- Deadlock retryable if operation idempotent.
- Retry outside failed transaction.
- Enforce deterministic update order.
- Instrument retry count.

### Scenario 4 — Connection Lost During Commit

Requirement:

```text
Client submitted payment-like command.
Connection lost during commit.
```

Tugas:

1. Jelaskan kenapa outcome unknown.
2. Desain idempotency key.
3. Desain status lookup/reconciliation.
4. Tentukan response.

Expected reasoning:

- Do not blindly retry without idempotency.
- Query by command id/business key.
- Use durable request log.

### Scenario 5 — SQLGrammarException After Deployment

Requirement:

```text
New deployment fails with missing column error.
```

Tugas:

1. Klasifikasikan failure.
2. Tentukan apakah retry berguna.
3. Buat incident action.
4. Tambahkan prevention test.

Expected reasoning:

- Programming/schema migration failure.
- No retry.
- Rollback/fix migration.
- Add migration compatibility test.

---

## 24. Ringkasan

Error handling persistence bukan tentang `try-catch` yang banyak. Ini tentang **failure classification**.

Mental model utama:

```text
Exception class != complete meaning.
Meaning = exception + SQLState + vendor code + constraint name + operation context + transaction state.
```

Prinsip penting:

1. Absence bukan selalu error.
2. Constraint violation harus dipetakan berdasarkan constraint name.
3. Optimistic lock biasanya 409 conflict, bukan 500.
4. Deadlock/serialization failure bisa retryable, tetapi hanya bounded dan idempotent.
5. Query/mapping bug tidak boleh diretry.
6. Connection failure biasanya 503, tetapi commit-time connection loss bisa unknown outcome.
7. Jangan lanjutkan transaction yang sudah rollback-only.
8. Flush sukses bukan commit sukses.
9. Commit failure bukan selalu rollback known.
10. Public API tidak boleh membocorkan detail database.
11. Observability harus memuat failure class, SQLState/vendor code, constraint, operation, correlation id.
12. Error handling harus dites dengan database nyata.

Untuk sistem enterprise/regulatory/case management, error handling yang matang memberi tiga manfaat besar:

```text
Correctness: data tidak rusak saat race/failure.
Operability: incident bisa didiagnosis dari evidence.
Defensibility: keputusan sistem bisa dijelaskan dan diaudit.
```

---

## 25. Referensi Lanjutan

Gunakan referensi resmi sesuai stack yang dipakai:

- Jakarta Persistence specification/API untuk `PersistenceException`, `OptimisticLockException`, `PessimisticLockException`, `LockTimeoutException`, `RollbackException`, persistence context, dan transaction interaction.
- Jakarta Transactions specification/API untuk `RollbackException`, `HeuristicMixedException`, transaction manager/resource manager semantics.
- Hibernate ORM documentation/Javadocs untuk `JDBCException`, `ConstraintViolationException`, locking, flushing, transaction, dan provider-specific exception.
- Spring Framework documentation untuk `DataAccessException`, `SQLExceptionTranslator`, transaction rollback, propagation, dan exception translation.
- Dokumentasi database vendor untuk SQLState/vendor error code, deadlock diagnostics, lock timeout, dan transaction isolation behavior.

---

## 26. Status Seri

Seri belum selesai.

Part yang sudah dibuat sampai bagian ini:

```text
Part 000 — Big Picture: Persistence as a Boundary, Not a CRUD Layer
Part 001 — Evolution Map: JDBC, JPA, Hibernate, Spring Data, Jakarta Data, Jakarta Transactions
Part 002 — Persistence Architecture: Layering, Boundaries, and Dependency Direction
Part 003 — Entity Identity: Object Identity, Database Identity, Business Identity
Part 004 — Entity Lifecycle and Persistence Context Internals
Part 005 — Mapping Fundamentals Done Correctly
Part 006 — Relationship Mapping: One-to-One, Many-to-One, One-to-Many, Many-to-Many
Part 007 — Fetching Strategy: Lazy, Eager, N+1, Entity Graph, Fetch Join
Part 008 — Query Model: JPQL, HQL, Criteria, Native SQL, QuerySpecification
Part 009 — Projection, DTO, Read Model, and Reporting Queries
Part 010 — Transaction Fundamentals: ACID, Local Transactions, JTA, Resource Managers
Part 011 — Transaction Boundary Design in Real Applications
Part 012 — Isolation Levels and Concurrency Anomalies
Part 013 — Optimistic Locking, Versioning, and State Machine Persistence
Part 014 — Pessimistic Locking, Deadlocks, and High-Contention Workloads
Part 015 — Flush, Dirty Checking, Write-Behind, and SQL Generation
Part 016 — Batch Processing and High-Volume Persistence
Part 017 — Schema Generation, Migration, and Database Contract
Part 018 — Constraints, Invariants, and Validation Across Layers
Part 019 — Caching: First-Level Cache, Second-Level Cache, Query Cache, External Cache
Part 020 — Advanced Mapping: Inheritance, Polymorphism, JSON, LOB, Custom Types
Part 021 — Auditing, Temporal Data, Soft Delete, and Historical Correctness
Part 022 — Multi-Tenancy, Multi-Schema, Multi-Database, and Data Partitioning
Part 023 — Repository Patterns: DAO, Repository, Spring Data JPA, Jakarta Data
Part 024 — Jakarta Data Deep Dive
Part 025 — Spring Transaction + JPA Integration Deep Dive
Part 026 — Database Integration Patterns: Outbox, Inbox, CDC, Idempotency
Part 027 — Performance Engineering for JPA/Hibernate
Part 028 — Database-Specific Integration: Oracle, PostgreSQL, MySQL, SQL Server
Part 029 — Error Handling, Exception Translation, and Failure Classification
```

Bagian berikutnya:

```text
Part 030 — Testing Persistence Correctly
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 028 — Database-Specific Integration: Oracle, PostgreSQL, MySQL, SQL Server](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-028.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 030 — Testing Persistence Correctly](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-030.md)
