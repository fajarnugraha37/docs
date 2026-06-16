# Part 032 — Capstone: Designing a Production-Grade Persistence Layer for a Complex Case Management System

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> File: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-032.md`  
> Status: **bagian terakhir** dari seri ini

---

## 1. Tujuan Pembelajaran

Bagian ini adalah sintesis dari seluruh seri. Tujuannya bukan memperkenalkan annotation baru, tetapi melatih cara berpikir ketika harus mendesain persistence layer untuk sistem besar, regulatif, audit-heavy, workflow-heavy, dan concurrency-sensitive.

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Mendesain persistence architecture untuk aplikasi case management kompleks.
2. Memisahkan entity, aggregate, command model, read model, audit model, dan integration event.
3. Menentukan transaction boundary per use case, bukan sekadar menaruh `@Transactional` secara mekanis.
4. Mendesain state transition yang aman terhadap race condition.
5. Memilih optimistic locking, pessimistic locking, constraint, conditional update, atau queueing sesuai masalah.
6. Mendesain repository dan query layer tanpa menjadikan repository sebagai table wrapper.
7. Menentukan kapan memakai entity loading, DTO projection, read model, materialized view, native SQL, atau reporting store.
8. Mendesain audit trail yang defensible secara regulatif.
9. Mengintegrasikan outbox/inbox/idempotency agar database state dan external side effect tidak divergen.
10. Mendesain batch archival/backfill/export tanpa merusak OLTP workload.
11. Membuat observability dan incident response model untuk persistence layer.
12. Melakukan review desain persistence seperti staff/principal engineer: melihat invariant, failure mode, data contract, operational blast radius, dan evolvability.

---

## 2. Mental Model Utama

Persistence layer production-grade bukan “lapisan untuk menyimpan object ke database”. Persistence layer adalah **boundary koordinasi antara state, correctness, concurrency, history, integration, dan operation**.

Dalam sistem kecil, kita sering berpikir:

```text
Controller -> Service -> Repository -> Database
```

Dalam sistem besar, model yang lebih benar adalah:

```text
Use Case / Command
    -> Transaction Boundary
        -> Aggregate State
        -> Database Constraint
        -> Lock / Version / Conditional Update
        -> Audit Record
        -> Outbox Event
        -> Idempotency Record
    -> Commit
    -> Publisher / Consumer / External Integration
    -> Read Model / Reporting / Search / Cache
    -> Observability / Incident Response
```

Kebenaran data tidak berasal dari satu layer. Kebenaran data berasal dari kombinasi:

| Concern | Primary Mechanism |
|---|---|
| Input shape | DTO validation |
| Business rule | domain/application service |
| Concurrent correctness | version, lock, conditional update, constraint |
| Final integrity | database constraint |
| State transition | explicit transition function + guarded update |
| History | audit trail / temporal table / Envers / custom audit |
| Integration consistency | outbox/inbox/idempotency |
| Read efficiency | projection/read model/materialized view |
| Operational safety | metrics/logs/tracing/runbook |

Prinsip terpenting:

> Jangan pernah mengandalkan satu abstraction untuk semua kebutuhan persistence.

JPA entity bagus untuk transactional aggregate manipulation. DTO projection bagus untuk read. Native SQL bagus untuk reporting tertentu. Outbox bagus untuk integration. Audit table bagus untuk evidence. Constraint bagus untuk final correctness. Tidak ada satu model yang ideal untuk semuanya.

---

## 3. Problem Domain Capstone

Kita akan memakai domain contoh: **complex regulatory case management system**.

Contoh modul:

- Application Management
- Case Management
- Appeal
- Compliance
- Correspondence
- Document
- Audit Trail
- Assignment
- Workflow
- Notification
- Reporting
- Archival
- Integration Gateway

Contoh aktor:

- applicant
- officer
- senior officer
- reviewer
- approver
- compliance officer
- system scheduler
- integration worker
- auditor

Contoh state:

```text
DRAFT
SUBMITTED
PENDING_ASSIGNMENT
UNDER_REVIEW
PENDING_INFORMATION
ESCALATED
RECOMMENDED_APPROVAL
RECOMMENDED_REJECTION
APPROVED
REJECTED
WITHDRAWN
CLOSED
ARCHIVED
```

Contoh invariant:

1. Application reference number harus unik per agency.
2. Submitted application tidak boleh diedit oleh applicant kecuali melalui request additional information.
3. Case hanya boleh assigned ke officer aktif.
4. Officer tidak boleh mengambil case melebihi quota aktif.
5. Approval hanya boleh dilakukan jika semua mandatory checks selesai.
6. Rejected case harus memiliki rejection reason.
7. Approved case harus memiliki approval timestamp, approver id, dan version yang konsisten.
8. Appeal hanya boleh dibuat untuk decision final tertentu dan dalam window waktu tertentu.
9. Audit trail harus mencatat actor, action, timestamp, before/after state, dan correlation id.
10. Notification/event tidak boleh hilang setelah DB commit sukses.

---

## 4. High-Level Architecture

### 4.1 Logical Architecture

```text
[API Layer]
   | receives commands/queries
   v
[Application Service Layer]
   | owns transaction boundary
   | orchestrates use case
   v
[Domain / Aggregate Logic]
   | validates state transitions
   | applies business invariants
   v
[Persistence Adapter]
   | repositories
   | EntityManager/Hibernate/Jakarta Data/Spring Data JPA
   | SQL/native query/read model
   v
[Database]
   | constraints
   | indexes
   | locks
   | transaction isolation
   | audit/outbox/inbox tables

[Outbox Publisher]
   -> message broker / integration gateway / email / search index / cache invalidation

[Read Model / Reporting]
   -> projections / views / materialized views / denormalized tables / search index
```

### 4.2 Module Boundary

Contoh package/module:

```text
case-management/
  application/
    command/
    service/
    handler/
  domain/
    model/
    transition/
    invariant/
  persistence/
    entity/
    repository/
    query/
    mapper/
  integration/
    outbox/
    inbox/
    publisher/
  audit/
    model/
    repository/
  reporting/
    projection/
    query/
  migration/
  test-fixtures/
```

Desain ini tidak harus dogmatis. Yang penting:

- command path tidak tercampur dengan reporting path,
- audit tidak menjadi side effect informal,
- outbox tidak dibuat setelah commit secara best-effort,
- read model tidak memaksa aggregate entity ikut bentuk UI,
- repository tidak menjadi dumping ground seluruh query.

---

## 5. Data Model Utama

### 5.1 Aggregate Root: ApplicationCase

Contoh entity utama:

```java
@Entity
@Table(
    name = "application_case",
    uniqueConstraints = {
        @UniqueConstraint(
            name = "uk_application_case_agency_ref",
            columnNames = {"agency_code", "reference_no"}
        )
    },
    indexes = {
        @Index(name = "idx_case_status", columnList = "status"),
        @Index(name = "idx_case_assigned_officer", columnList = "assigned_officer_id"),
        @Index(name = "idx_case_created_at", columnList = "created_at")
    }
)
public class ApplicationCase {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_seq")
    @SequenceGenerator(name = "case_seq", sequenceName = "seq_application_case", allocationSize = 50)
    private Long id;

    @Column(name = "public_id", nullable = false, updatable = false, unique = true, length = 36)
    private String publicId;

    @Column(name = "agency_code", nullable = false, length = 30)
    private String agencyCode;

    @Column(name = "reference_no", nullable = false, length = 80)
    private String referenceNo;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 50)
    private CaseStatus status;

    @Column(name = "assigned_officer_id")
    private Long assignedOfficerId;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    @Column(name = "submitted_at")
    private Instant submittedAt;

    @Column(name = "decided_at")
    private Instant decidedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected ApplicationCase() {
        // required by JPA
    }

    public static ApplicationCase draft(String agencyCode, String referenceNo, String publicId, Instant now) {
        ApplicationCase c = new ApplicationCase();
        c.agencyCode = agencyCode;
        c.referenceNo = referenceNo;
        c.publicId = publicId;
        c.status = CaseStatus.DRAFT;
        c.createdAt = now;
        c.updatedAt = now;
        return c;
    }

    public void submit(Instant now) {
        requireStatus(CaseStatus.DRAFT);
        this.status = CaseStatus.SUBMITTED;
        this.submittedAt = now;
        this.updatedAt = now;
    }

    public void assignTo(long officerId, Instant now) {
        if (status != CaseStatus.SUBMITTED && status != CaseStatus.PENDING_ASSIGNMENT) {
            throw new IllegalStateException("Case cannot be assigned from status " + status);
        }
        this.assignedOfficerId = officerId;
        this.status = CaseStatus.UNDER_REVIEW;
        this.updatedAt = now;
    }

    public void approve(long approverId, Instant now) {
        requireStatus(CaseStatus.RECOMMENDED_APPROVAL);
        this.status = CaseStatus.APPROVED;
        this.decidedAt = now;
        this.updatedAt = now;
    }

    private void requireStatus(CaseStatus expected) {
        if (this.status != expected) {
            throw new IllegalStateException("Expected " + expected + " but was " + this.status);
        }
    }
}
```

### 5.2 Status Enum

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    PENDING_ASSIGNMENT,
    UNDER_REVIEW,
    PENDING_INFORMATION,
    ESCALATED,
    RECOMMENDED_APPROVAL,
    RECOMMENDED_REJECTION,
    APPROVED,
    REJECTED,
    WITHDRAWN,
    CLOSED,
    ARCHIVED
}
```

### 5.3 Why This Design Works

Beberapa keputusan penting:

1. `id` adalah internal database identity.
2. `publicId` adalah external-safe identifier untuk API/link/event.
3. `referenceNo` adalah business reference, unik per agency.
4. `@Version` digunakan untuk optimistic concurrency control.
5. Status transition dibuat method eksplisit, bukan setter bebas.
6. Audit tidak dicampur langsung ke entity utama sebagai serialized history.
7. Query listing tidak perlu load entity ini penuh jika hanya perlu summary.

---

## 6. Transaction Boundary per Use Case

### 6.1 Create Draft

```text
Input command
  -> validate DTO
  -> generate public id/reference
  -> create ApplicationCase draft
  -> insert case
  -> insert audit record
  -> insert outbox event if needed
  -> commit
```

Transaction boundary:

```java
@Transactional
public CreateCaseResult createDraft(CreateCaseCommand command) {
    Instant now = clock.instant();

    String publicId = idGenerator.newPublicId();
    String referenceNo = referenceGenerator.next(command.agencyCode());

    ApplicationCase c = ApplicationCase.draft(
        command.agencyCode(),
        referenceNo,
        publicId,
        now
    );

    caseRepository.persist(c);

    auditRepository.append(AuditRecord.created(
        c.getPublicId(),
        "CREATE_DRAFT",
        actorContext.currentActorId(),
        now,
        correlationId.current()
    ));

    outboxRepository.append(OutboxMessage.caseDraftCreated(c.getPublicId(), now));

    return new CreateCaseResult(c.getPublicId(), c.getReferenceNo());
}
```

Important reasoning:

- Audit dan outbox masuk transaction yang sama dengan case.
- Tidak ada email/external API call langsung di dalam transaction.
- Unique reference dijaga database constraint.
- Duplicate key harus dimapping menjadi error yang bisa dimengerti atau retry reference generation.

### 6.2 Submit Application

```java
@Transactional
public SubmitCaseResult submit(SubmitCaseCommand command) {
    ApplicationCase c = caseRepository.findByPublicIdForUpdateIntent(command.publicId())
        .orElseThrow(() -> new NotFoundException("Case not found"));

    versionGuard.requireExpectedVersion(c.getVersion(), command.expectedVersion());

    c.submit(clock.instant());

    auditRepository.append(AuditRecord.transition(
        c.getPublicId(),
        "DRAFT",
        "SUBMITTED",
        actorContext.currentActorId(),
        clock.instant(),
        correlationId.current()
    ));

    outboxRepository.append(OutboxMessage.caseSubmitted(c.getPublicId(), c.getVersion() + 1));

    return new SubmitCaseResult(c.getPublicId());
}
```

Key point:

- Expected version dari client membantu mendeteksi stale command.
- `@Version` tetap menjadi final optimistic concurrency guard.
- Event memakai aggregate id dan sequence/version.
- Kalau terjadi `OptimisticLockException`, response sebaiknya `409 Conflict`, bukan retry otomatis membabi buta.

### 6.3 Assign Case

Assignment sering punya quota/concurrency issue.

Naive logic yang salah:

```java
int activeCount = repository.countActiveByOfficer(officerId);
if (activeCount >= quota) throw new QuotaExceededException();
case.assignTo(officerId);
```

Masalahnya: dua transaction bisa membaca count yang sama lalu sama-sama assign.

Pilihan desain:

#### Option A — Database Constraint / Counter Row

Buat table `officer_workload`:

```text
officer_id PK
active_count
quota
version
```

Lakukan conditional update:

```sql
UPDATE officer_workload
SET active_count = active_count + 1,
    version = version + 1
WHERE officer_id = :officerId
  AND active_count < quota
```

Jika affected row = 0, quota penuh.

Lalu assign case dalam transaction yang sama.

#### Option B — Pessimistic Lock Officer Workload

```java
OfficerWorkload workload = workloadRepository.lockByOfficerId(officerId)
    .orElseThrow();

workload.incrementIfBelowQuota();
case.assignTo(officerId, now);
```

Cocok jika contention tinggi dan correctness lebih penting dari throughput.

#### Option C — Queue-Based Assignment

Untuk workload sangat tinggi:

```text
submitted cases -> assignment queue -> worker locks candidate rows -> assigns deterministically
```

Gunakan `SKIP LOCKED` jika database mendukung.

---

## 7. Repository Design

### 7.1 Command Repository

Command repository sebaiknya minimal dan aggregate-oriented.

```java
public interface ApplicationCaseRepository {
    Optional<ApplicationCase> findByPublicId(String publicId);
    Optional<ApplicationCase> findByReferenceNo(String agencyCode, String referenceNo);
    void persist(ApplicationCase applicationCase);
}
```

Tambahkan method khusus jika ada intent concurrency:

```java
public interface ApplicationCaseCommandRepository {
    Optional<ApplicationCase> findByPublicId(String publicId);
    Optional<ApplicationCase> findByPublicIdWithOptimisticLock(String publicId);
    Optional<ApplicationCase> findByPublicIdWithPessimisticWriteLock(String publicId);
    boolean transitionIfVersionMatches(
        String publicId,
        long expectedVersion,
        CaseStatus from,
        CaseStatus to,
        Instant now
    );
}
```

### 7.2 Read Repository

Read repository tidak harus return entity.

```java
public interface CaseListingQuery {
    Page<CaseSummaryRow> search(CaseSearchCriteria criteria, Pageable pageable);
}

public record CaseSummaryRow(
    String publicId,
    String referenceNo,
    CaseStatus status,
    String assignedOfficerName,
    Instant submittedAt,
    long version
) {}
```

### 7.3 Reporting Repository

Reporting query boleh native SQL jika memang lebih tepat.

```java
public interface CaseReportQuery {
    List<MonthlyCaseStatusCount> countByStatusPerMonth(ReportPeriod period);
}
```

Prinsip:

- command repository menjaga aggregate consistency,
- read repository mengoptimalkan UI/read use case,
- reporting repository mengoptimalkan aggregation/export,
- jangan memaksa semua query lewat entity graph.

---

## 8. Query and Fetching Strategy

### 8.1 Detail Page

Detail page biasanya perlu aggregate dan beberapa child tertentu.

Pilihan:

- `JOIN FETCH` untuk to-one association.
- Entity graph untuk association yang use-case-specific.
- DTO projection jika detail page mostly read-only.
- Separate query untuk collection besar.

Jangan fetch semua collection sekaligus.

Bad:

```java
SELECT c
FROM ApplicationCase c
JOIN FETCH c.documents
JOIN FETCH c.auditTrails
JOIN FETCH c.correspondences
WHERE c.publicId = :publicId
```

Risk:

- cartesian explosion,
- duplicate row hydration,
- memory spike,
- pagination impossible,
- slow response.

Better:

```text
Query 1: case header
Query 2: latest documents page
Query 3: latest audit events page
Query 4: correspondences page
```

### 8.2 Listing Page

Listing page should almost always use projection.

```java
@Query("""
    select new com.acme.caseapp.query.CaseSummaryRow(
        c.publicId,
        c.referenceNo,
        c.status,
        o.displayName,
        c.submittedAt,
        c.version
    )
    from ApplicationCase c
    left join Officer o on o.id = c.assignedOfficerId
    where c.agencyCode = :agencyCode
      and (:status is null or c.status = :status)
    order by c.submittedAt desc, c.id desc
""")
List<CaseSummaryRow> search(...);
```

### 8.3 Audit Timeline

Audit timeline should not be loaded as `case.getAuditTrails()` by default.

Use separate paginated query:

```sql
SELECT *
FROM audit_record
WHERE aggregate_type = 'CASE'
  AND aggregate_public_id = :publicId
ORDER BY occurred_at DESC, id DESC
FETCH FIRST :limit ROWS ONLY
```

---

## 9. Audit Trail Design

### 9.1 Audit Record Model

```java
@Entity
@Table(
    name = "audit_record",
    indexes = {
        @Index(name = "idx_audit_aggregate", columnList = "aggregate_type, aggregate_public_id, occurred_at"),
        @Index(name = "idx_audit_actor", columnList = "actor_id, occurred_at"),
        @Index(name = "idx_audit_correlation", columnList = "correlation_id")
    }
)
public class AuditRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "audit_seq")
    private Long id;

    @Column(name = "aggregate_type", nullable = false, length = 50)
    private String aggregateType;

    @Column(name = "aggregate_public_id", nullable = false, length = 80)
    private String aggregatePublicId;

    @Column(name = "action", nullable = false, length = 100)
    private String action;

    @Column(name = "actor_id", nullable = false, length = 80)
    private String actorId;

    @Column(name = "actor_type", nullable = false, length = 50)
    private String actorType;

    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

    @Column(name = "correlation_id", nullable = false, length = 80)
    private String correlationId;

    @Lob
    @Column(name = "before_state")
    private String beforeStateJson;

    @Lob
    @Column(name = "after_state")
    private String afterStateJson;

    @Lob
    @Column(name = "metadata")
    private String metadataJson;
}
```

### 9.2 Audit Design Principles

Audit trail harus menjawab:

1. Who did it?
2. What changed?
3. When did it happen?
4. From where/request/correlation?
5. What was the previous state?
6. What was the resulting state?
7. Why was the action allowed?
8. Was the audit record committed atomically with business state?

Audit yang baik bukan sekadar log. Audit adalah evidence.

### 9.3 Audit vs Event vs Outbox

| Model | Purpose | Consumer |
|---|---|---|
| Audit record | historical evidence | auditor, support, legal/regulatory |
| Domain event | internal domain fact | application/domain layer |
| Outbox message | reliable integration delivery | publisher/integration consumer |
| Log line | operational diagnosis | developer/SRE |
| CDC record | database-level change stream | data platform/integration |

Jangan mencampur semuanya menjadi satu table tanpa semantics.

---

## 10. Outbox and Inbox Design

### 10.1 Outbox Table

```java
@Entity
@Table(
    name = "outbox_message",
    indexes = {
        @Index(name = "idx_outbox_status_next", columnList = "status, next_attempt_at"),
        @Index(name = "idx_outbox_aggregate", columnList = "aggregate_type, aggregate_id, aggregate_version")
    },
    uniqueConstraints = {
        @UniqueConstraint(
            name = "uk_outbox_event_id",
            columnNames = {"event_id"}
        )
    }
)
public class OutboxMessage {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "outbox_seq")
    private Long id;

    @Column(name = "event_id", nullable = false, length = 80)
    private String eventId;

    @Column(name = "aggregate_type", nullable = false, length = 50)
    private String aggregateType;

    @Column(name = "aggregate_id", nullable = false, length = 80)
    private String aggregateId;

    @Column(name = "aggregate_version", nullable = false)
    private long aggregateVersion;

    @Column(name = "event_type", nullable = false, length = 100)
    private String eventType;

    @Lob
    @Column(name = "payload", nullable = false)
    private String payloadJson;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private OutboxStatus status;

    @Column(name = "attempt_count", nullable = false)
    private int attemptCount;

    @Column(name = "next_attempt_at", nullable = false)
    private Instant nextAttemptAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
}
```

### 10.2 Publisher Algorithm

```text
loop:
  begin transaction
  select N pending outbox rows for update skip locked
  mark as publishing or increment attempt
  commit

  for each message:
    publish to broker/external system

  begin transaction
  mark success/failure
  commit
```

Alternative: CDC-based outbox.

### 10.3 Inbox Table

For idempotent consumers:

```sql
CREATE TABLE inbox_message (
    consumer_name       VARCHAR(100) NOT NULL,
    message_id          VARCHAR(100) NOT NULL,
    received_at         TIMESTAMP NOT NULL,
    processed_at        TIMESTAMP,
    status              VARCHAR(30) NOT NULL,
    PRIMARY KEY (consumer_name, message_id)
);
```

Processing:

```text
begin transaction
  insert inbox row
  if duplicate -> already processed or in progress
  apply business effect
  mark inbox processed
commit
```

---

## 11. Idempotency Design

### 11.1 HTTP Command Idempotency

For commands like submit/approve/payment/request-generation:

```sql
CREATE TABLE idempotency_record (
    scope             VARCHAR(80) NOT NULL,
    idempotency_key   VARCHAR(120) NOT NULL,
    request_hash      VARCHAR(128) NOT NULL,
    response_payload  CLOB,
    status            VARCHAR(30) NOT NULL,
    created_at        TIMESTAMP NOT NULL,
    expires_at        TIMESTAMP NOT NULL,
    PRIMARY KEY (scope, idempotency_key)
);
```

Rules:

1. Same key + same request hash -> return same result.
2. Same key + different request hash -> reject as key conflict.
3. In-progress duplicate -> return retryable status or wait strategy.
4. Completed duplicate -> return stored response.
5. Expired record must not break business correctness; durable business uniqueness remains in domain tables.

### 11.2 Idempotency Is Not Just Cache

A cache can disappear. Idempotency for critical commands should be durable.

Bad:

```text
Redis SETNX only -> if Redis evicts key, duplicate command may apply twice
```

Better:

```text
DB unique constraint on idempotency key + business constraint + transactional write
```

---

## 12. State Machine Persistence

### 12.1 Transition Table

You can encode allowed transitions in code:

```java
public final class CaseTransitions {
    private static final Map<CaseStatus, Set<CaseStatus>> ALLOWED = Map.of(
        DRAFT, Set.of(SUBMITTED, WITHDRAWN),
        SUBMITTED, Set.of(PENDING_ASSIGNMENT, UNDER_REVIEW, WITHDRAWN),
        UNDER_REVIEW, Set.of(PENDING_INFORMATION, ESCALATED, RECOMMENDED_APPROVAL, RECOMMENDED_REJECTION),
        RECOMMENDED_APPROVAL, Set.of(APPROVED),
        RECOMMENDED_REJECTION, Set.of(REJECTED)
    );

    public static void requireAllowed(CaseStatus from, CaseStatus to) {
        if (!ALLOWED.getOrDefault(from, Set.of()).contains(to)) {
            throw new IllegalStateException("Transition not allowed: " + from + " -> " + to);
        }
    }
}
```

### 12.2 Atomic Conditional Transition

For high-contention transitions:

```java
@Modifying
@Query("""
    update ApplicationCase c
       set c.status = :to,
           c.updatedAt = :now,
           c.version = c.version + 1
     where c.publicId = :publicId
       and c.status = :from
       and c.version = :expectedVersion
""")
int transition(
    String publicId,
    CaseStatus from,
    CaseStatus to,
    long expectedVersion,
    Instant now
);
```

Then:

```java
int updated = repository.transition(publicId, from, to, expectedVersion, now);
if (updated != 1) {
    throw new ConcurrencyConflictException("Case was changed by another transaction");
}
```

This avoids:

- stale update,
- lost update,
- invalid transition under race,
- accidental merge of detached entity.

### 12.3 Transition Record

For defensibility, store transition history:

```sql
CREATE TABLE case_transition_history (
    id                  BIGINT PRIMARY KEY,
    case_public_id      VARCHAR(80) NOT NULL,
    from_status         VARCHAR(50) NOT NULL,
    to_status           VARCHAR(50) NOT NULL,
    actor_id            VARCHAR(80) NOT NULL,
    reason_code         VARCHAR(80),
    reason_text         CLOB,
    occurred_at         TIMESTAMP NOT NULL,
    case_version        BIGINT NOT NULL,
    correlation_id      VARCHAR(80) NOT NULL
);
```

---

## 13. Constraint and Invariant Matrix

| Invariant | Application Check | DB Constraint | Concurrency Mechanism | Error Mapping |
|---|---|---|---|---|
| reference unique per agency | check before create for UX | unique `(agency_code, reference_no)` | retry generation | 409/500 depending source |
| submit only draft | state method | optional check constraint for status domain | `@Version` / conditional update | 409 |
| officer quota | service check | workload row invariant | conditional update / lock | 409/422 |
| one active appeal per decision | service check | partial/composite unique where possible | unique violation | 409 |
| approve only recommended | transition guard | status domain check | conditional update | 409 |
| audit required | service writes audit | NOT NULL/FK where possible | same transaction | 500 if missing |
| outbox required | service writes outbox | NOT NULL + unique event id | same transaction | 500/retry publisher |
| no tenant leakage | tenant context | composite FK/index with tenant | tenant-aware predicate | 403/404 |

The best designs do not ask: “Where should validation live?”  
They ask: “Which layer prevents which class of invalid state under which failure mode?”

---

## 14. Multi-Tenancy / Multi-Agency Consideration

For regulatory systems, tenant/agency boundary is often not just technical. It can be legal, operational, and audit-relevant.

### 14.1 Shared Schema with Agency Column

```sql
CREATE TABLE application_case (
    id BIGINT PRIMARY KEY,
    agency_code VARCHAR(30) NOT NULL,
    public_id VARCHAR(80) NOT NULL,
    reference_no VARCHAR(80) NOT NULL,
    status VARCHAR(50) NOT NULL,
    version BIGINT NOT NULL,
    UNIQUE (agency_code, reference_no),
    UNIQUE (agency_code, public_id)
);
```

Every query must include agency/tenant predicate.

### 14.2 Repository Guard

```java
public Optional<ApplicationCase> findByAgencyAndPublicId(String agencyCode, String publicId) {
    return entityManager.createQuery("""
        select c
        from ApplicationCase c
        where c.agencyCode = :agencyCode
          and c.publicId = :publicId
    """, ApplicationCase.class)
    .setParameter("agencyCode", agencyCode)
    .setParameter("publicId", publicId)
    .getResultStream()
    .findFirst();
}
```

Avoid generic `findByPublicId()` if public id is not globally unique.

### 14.3 Tenant Leakage Test

Test every query class with:

```text
agency A has case REF-001
agency B has case REF-001
user from A searches REF-001
assert only A record visible
```

---

## 15. Archival and Large Data Strategy

### 15.1 Problem

Case management systems accumulate:

- audit records,
- correspondence logs,
- document metadata,
- outbox/inbox records,
- search history,
- status history,
- generated reports,
- CLOB/JSON snapshots.

Eventually hot OLTP tables become too large.

### 15.2 Classification

| Data | Hot? | Mutable? | Audit Critical? | Archival Strategy |
|---|---:|---:|---:|---|
| active case | yes | yes | yes | OLTP |
| closed recent case | sometimes | rarely | yes | OLTP + partition |
| old closed case | no | no | yes | archive table/storage |
| audit trail | sometimes | append-only | yes | partition/compress/archive |
| outbox success | no | no | operational | retain then purge/archive |
| inbox success | no | no | dedupe window | TTL/purge |
| documents | sometimes | immutable | yes | object storage + metadata |

### 15.3 Archive Flow

```text
select eligible closed cases
  -> mark archive_requested
  -> copy immutable data to archive store/table
  -> verify counts/checksum
  -> mark archived
  -> optionally remove or partition detach hot data
  -> audit archival action
```

### 15.4 Do Not

- Do not delete audit trail without retention policy.
- Do not archive records still referenced by active workflow.
- Do not run huge delete in one transaction.
- Do not let archival job compete unbounded with OLTP traffic.
- Do not archive without reconciliation.

---

## 16. Performance Design Review

For each use case, ask:

1. How many SQL statements?
2. How many rows read?
3. How many columns hydrated?
4. Are we loading entity when projection is enough?
5. Is there a fetch join on collection with pagination?
6. Is there N+1 risk?
7. Does query match index order?
8. Is count query expensive?
9. How long is transaction open?
10. How many connections can this use under peak concurrency?
11. Is there lock wait risk?
12. Is persistence context size bounded?
13. Are LOB/JSON columns loaded unnecessarily?
14. Is cache hiding a bad query?

### 16.1 Example: Case Listing

Bad design:

```text
load 50 ApplicationCase entities
for each case:
  load applicant
  load assigned officer
  load latest status history
  load document count
serialize entity to JSON
```

Potential result:

```text
1 + 50 + 50 + 50 + 50 queries
```

Better:

```text
single projection query for page
separate aggregate count only if necessary
keyset pagination for deep pages
precomputed document_count if needed
```

---

## 17. Observability Design

### 17.1 Metrics

Track:

- HTTP latency by endpoint/use case,
- transaction duration,
- connection pool active/idle/pending,
- query count per request,
- slow SQL fingerprint,
- lock wait count/time,
- deadlock count,
- optimistic conflict count,
- flush count,
- entity load count,
- second-level cache hit/miss,
- outbox pending count,
- outbox oldest age,
- inbox duplicate count,
- batch processed/failed/skipped,
- archival lag,
- DB CPU/I/O/temp usage.

### 17.2 Logs

Every important persistence operation should be diagnosable with:

```text
correlation_id
actor_id
agency_code/tenant_id
use_case
aggregate_type
aggregate_id/public_id
expected_version
result_version
transaction outcome
exception category
SQL fingerprint where relevant
```

### 17.3 Tracing

Trace spans:

```text
HTTP request
  -> service method
  -> transaction scope
  -> repository/query
  -> SQL client span
  -> outbox append
  -> commit

Outbox publisher
  -> fetch pending messages
  -> publish to broker/external service
  -> mark delivered
```

---

## 18. Incident Response Playbooks

### 18.1 Connection Pool Exhaustion

Symptoms:

- API latency spike,
- pending connection count grows,
- thread pool saturation,
- DB active sessions high or low depending bottleneck,
- timeouts.

Questions:

1. Are transactions too long?
2. Is there external API call inside transaction?
3. Are queries slow or blocked?
4. Is pool too small or application concurrency too high?
5. Is there connection leak?
6. Did a batch job start?
7. Did database plan regress?

Immediate containment:

- throttle/bypass non-critical endpoints,
- stop runaway batch,
- identify top SQL/locks,
- reduce request concurrency if possible,
- do not blindly increase pool size without DB capacity check.

### 18.2 Lock Storm / Deadlock Spike

Questions:

1. Which table/index is locked?
2. Which SQL statements conflict?
3. Are transactions updating rows in different order?
4. Is batch job overlapping with online writes?
5. Was a new index/constraint/migration deployed?
6. Is pessimistic lock held across external call?

Fix classes:

- deterministic lock ordering,
- shorter transaction,
- retry with jitter,
- chunk batch,
- change isolation/lock strategy,
- add index to reduce scan locks,
- move high-contention counter to conditional update or queue.

### 18.3 Outbox Backlog

Symptoms:

- DB commit succeeds,
- downstream system not updated,
- notification/search/cache lag,
- outbox pending count/oldest age grows.

Questions:

1. Is publisher running?
2. Is downstream unavailable?
3. Are messages poison-pill failing repeatedly?
4. Is ordering constraint blocking later events?
5. Is retry interval too aggressive or too slow?
6. Is payload schema incompatible?

Containment:

- pause bad event type if needed,
- DLQ poison messages,
- replay after fix,
- scale publisher if downstream allows,
- preserve ordering per aggregate.

---

## 19. Security and Privacy

Persistence design must include security from the beginning.

### 19.1 Sensitive Data

Decide per field:

| Field | Store? | Encrypt? | Mask? | Audit? | Searchable? |
|---|---:|---:|---:|---:|---:|
| NRIC/National ID | yes/no | yes | yes | careful | maybe blind index |
| email | yes | maybe | partial | yes | yes |
| phone | yes | maybe | partial | yes | yes |
| decision reason | yes | no/maybe | role-based | yes | no |
| internal note | yes | maybe | role-based | yes | no |
| document content | object storage | yes | role-based | metadata | search depends |

### 19.2 Authorization Predicate

Never rely only on UI filtering.

Query must include authorization/tenant scope:

```sql
WHERE agency_code = :agencyCode
  AND (:isSupervisor = true OR assigned_officer_id = :currentOfficerId)
```

### 19.3 Audit Privacy

Audit must be useful but not reckless.

Avoid storing unnecessary secrets/tokens/raw credentials in audit payload. For sensitive before/after snapshot, consider:

- field-level masking,
- encryption,
- role-based audit access,
- retention policy,
- hash for tamper evidence,
- immutable append-only policy.

---

## 20. Testing Strategy for the Capstone

### 20.1 Minimum Test Matrix

| Test Type | What It Proves |
|---|---|
| Entity mapping test | mapping matches real DB schema |
| Repository query test | predicates/sorting/pagination correct |
| Constraint test | DB rejects invalid state |
| Optimistic locking test | stale update fails |
| Pessimistic locking test | lock behavior works under real DB |
| Transition test | invalid state transition impossible |
| Audit atomicity test | business state + audit commit together |
| Outbox atomicity test | business state + outbox commit together |
| Idempotency test | duplicate command safe |
| Tenant isolation test | cross-tenant leakage prevented |
| N+1 test | query count bounded |
| Migration test | schema migrates from previous version |
| Batch test | chunk/retry/skip works |
| Incident simulation | timeout/deadlock/retry behavior acceptable |

### 20.2 Concurrency Test Example

Two approvers approve same case concurrently:

Expected:

- one succeeds,
- one receives conflict,
- only one audit transition,
- only one outbox approval event,
- final status approved,
- version increments once.

Pseudo-test:

```java
@Test
void concurrentApprovalOnlyOneWins() throws Exception {
    String caseId = fixture.createRecommendedApprovalCase();
    long version = query.versionOf(caseId);

    Callable<Result> approve = () -> approvalService.approve(new ApproveCommand(caseId, version));

    List<Future<Result>> results = executor.invokeAll(List.of(approve, approve));

    assertThat(results).hasSize(2);
    assertThat(countSuccess(results)).isEqualTo(1);
    assertThat(countConflict(results)).isEqualTo(1);
    assertThat(query.statusOf(caseId)).isEqualTo(APPROVED);
    assertThat(auditQuery.countTransitions(caseId, "APPROVED")).isEqualTo(1);
    assertThat(outboxQuery.countEvents(caseId, "CASE_APPROVED")).isEqualTo(1);
}
```

---

## 21. Review Checklist: Staff/Principal Engineer Level

Use this checklist when reviewing persistence design.

### 21.1 Data Model

- [ ] Is identity model clear: DB id, public id, business key?
- [ ] Are natural/business uniqueness rules enforced by DB constraints?
- [ ] Are enums stored safely, not ordinal?
- [ ] Are timestamps/timezones explicitly handled?
- [ ] Are LOB/JSON fields isolated from hot queries?
- [ ] Are indexes aligned with real query predicates/order?
- [ ] Are tenant/agency boundaries represented in keys/indexes?

### 21.2 Entity and Aggregate

- [ ] Does entity expose dangerous setters?
- [ ] Are state transitions explicit?
- [ ] Is aggregate boundary clear?
- [ ] Are large collections avoided on aggregate load?
- [ ] Is `equals/hashCode` safe for JPA lifecycle/proxy?
- [ ] Are cascade/orphan rules intentional?

### 21.3 Transaction

- [ ] Is transaction boundary at use-case/application service layer?
- [ ] Are external calls outside transaction?
- [ ] Is transaction duration bounded?
- [ ] Is rollback behavior understood?
- [ ] Are `REQUIRES_NEW` usages justified?
- [ ] Is self-invocation avoided?

### 21.4 Concurrency

- [ ] Is lost update prevented?
- [ ] Is write skew possible?
- [ ] Are quotas/counters guarded with lock/conditional update/constraint?
- [ ] Are retries bounded and idempotent?
- [ ] Are deadlock-prone updates ordered deterministically?

### 21.5 Query and Performance

- [ ] Are listing/reporting queries projections?
- [ ] Is N+1 tested or monitored?
- [ ] Are fetch joins used safely?
- [ ] Is pagination strategy appropriate?
- [ ] Are count queries optimized/optional?
- [ ] Is persistence context size bounded in batch?

### 21.6 Audit and Integration

- [ ] Is audit atomic with state change?
- [ ] Does audit capture actor/action/time/correlation/before-after/reason?
- [ ] Is outbox atomic with state change?
- [ ] Are consumers idempotent?
- [ ] Is event ordering defined per aggregate?
- [ ] Is payload versioned?

### 21.7 Operations

- [ ] Are connection pool metrics visible?
- [ ] Are slow SQL fingerprints visible?
- [ ] Are transaction duration and lock waits visible?
- [ ] Are outbox backlog and oldest age monitored?
- [ ] Is there a runbook for 504/DB CPU/lock/deadlock/pool exhaustion?
- [ ] Are migrations tested and rollback/forward-fix strategy defined?

---

## 22. Common Anti-Patterns

### 22.1 Entity as API DTO

Problem:

- lazy loading during serialization,
- circular reference,
- data leakage,
- accidental over-fetching,
- weak API contract.

Fix:

- command DTO,
- response DTO/projection,
- explicit mapper.

### 22.2 Repository as Table Wrapper

Bad:

```java
interface CaseRepository extends JpaRepository<ApplicationCase, Long> {}
```

Then every service builds arbitrary query logic.

Better:

- command repository methods by use case,
- query repository methods by screen/report,
- explicit locking/fetching semantics.

### 22.3 Transaction Across External API

Bad:

```java
@Transactional
public void approve(...) {
    case.approve();
    emailClient.sendApprovalEmail(...); // external IO inside DB transaction
}
```

Better:

```text
approve case + audit + outbox in transaction
publisher sends email after commit
```

### 22.4 Application-Only Uniqueness Check

Bad:

```java
if (!repo.existsByReferenceNo(ref)) {
    repo.save(newCase(ref));
}
```

Fix:

- DB unique constraint,
- catch unique violation,
- map/retry appropriately.

### 22.5 One Huge Transaction for Batch

Bad:

```text
import 1 million rows in one transaction
```

Fix:

- chunking,
- idempotency,
- checkpoint,
- retry/skip,
- bounded persistence context.

---

## 23. End-to-End Example: Approval Use Case

### 23.1 Command

```java
public record ApproveCaseCommand(
    String casePublicId,
    long expectedVersion,
    String reason
) {}
```

### 23.2 Service

```java
@Service
public class ApproveCaseService {

    private final ApplicationCaseRepository caseRepository;
    private final MandatoryCheckRepository checkRepository;
    private final AuditRepository auditRepository;
    private final OutboxRepository outboxRepository;
    private final Clock clock;

    @Transactional
    public ApproveCaseResult approve(ApproveCaseCommand command) {
        Instant now = clock.instant();

        ApplicationCase c = caseRepository.findByPublicId(command.casePublicId())
            .orElseThrow(() -> new NotFoundException("Case not found"));

        if (c.getVersion() != command.expectedVersion()) {
            throw new ConcurrencyConflictException("Case has been modified");
        }

        if (!checkRepository.allMandatoryChecksPassed(c.getPublicId())) {
            throw new BusinessRuleViolationException("Mandatory checks are not complete");
        }

        CaseStatus before = c.getStatus();
        c.approve(actor.currentOfficerId(), now);

        auditRepository.append(AuditRecord.transition(
            "CASE",
            c.getPublicId(),
            "APPROVE_CASE",
            before.name(),
            c.getStatus().name(),
            actor.currentActorId(),
            command.reason(),
            now,
            correlation.current()
        ));

        outboxRepository.append(OutboxMessage.caseApproved(
            c.getPublicId(),
            c.getVersion() + 1,
            now
        ));

        return new ApproveCaseResult(c.getPublicId(), c.getStatus(), c.getVersion() + 1);
    }
}
```

### 23.3 What Can Go Wrong?

| Failure | Protection |
|---|---|
| two approvers approve simultaneously | `@Version` / expected version |
| mandatory check changes concurrently | recheck in same transaction; maybe lock/check version |
| audit insert fails | transaction rolls back |
| outbox insert fails | transaction rolls back |
| email service down | outbox retries later |
| response lost after commit | client retries with idempotency key |
| duplicate approval command | idempotency + state/version conflict |
| stale UI submits old version | 409 conflict |

---

## 24. End-to-End Example: Search Listing Use Case

### 24.1 Criteria

```java
public record CaseSearchCriteria(
    String agencyCode,
    CaseStatus status,
    Long assignedOfficerId,
    Instant submittedFrom,
    Instant submittedTo,
    String referenceNoLike
) {}
```

### 24.2 Query Design

Use projection:

```java
public record CaseListRow(
    String publicId,
    String referenceNo,
    CaseStatus status,
    String assignedOfficerName,
    Instant submittedAt,
    Instant updatedAt
) {}
```

Possible SQL:

```sql
SELECT
    c.public_id,
    c.reference_no,
    c.status,
    o.display_name AS assigned_officer_name,
    c.submitted_at,
    c.updated_at
FROM application_case c
LEFT JOIN officer o ON o.id = c.assigned_officer_id
WHERE c.agency_code = :agencyCode
  AND (:status IS NULL OR c.status = :status)
  AND (:assignedOfficerId IS NULL OR c.assigned_officer_id = :assignedOfficerId)
  AND (:submittedFrom IS NULL OR c.submitted_at >= :submittedFrom)
  AND (:submittedTo IS NULL OR c.submitted_at < :submittedTo)
ORDER BY c.submitted_at DESC, c.id DESC
FETCH FIRST :limit ROWS ONLY
```

Design decision:

- Use projection.
- Include tenant/agency predicate.
- Avoid entity graph.
- Avoid loading documents/audits.
- Use keyset pagination if deep navigation matters.
- Consider separate count only if UI truly needs exact total.

---

## 25. End-to-End Example: Batch Archival

### 25.1 Requirements

Archive cases that are:

- closed,
- older than retention threshold,
- not under appeal,
- not locked by legal hold,
- fully exported/documented,
- reconciled.

### 25.2 Process

```text
1. Select candidate ids in small pages.
2. For each chunk:
   begin transaction
     mark cases ARCHIVE_IN_PROGRESS if still eligible
   commit
3. Copy case + related immutable data to archive store.
4. Verify row counts/checksum.
5. begin transaction
     mark cases ARCHIVED
     insert audit records
     insert outbox archival events
   commit
6. Purge/detach old partitions only after retention/governance approval.
```

### 25.3 Why Not One Transaction?

Because archive may involve:

- large reads,
- object storage writes,
- verification,
- export files,
- long runtime,
- downstream notification.

A single database transaction would hold resources too long and create operational risk.

---

## 26. Production Readiness Scorecard

Score each item 0–2:

```text
0 = absent / unknown
1 = partially handled
2 = explicit, tested, observable
```

| Area | Score |
|---|---:|
| identity model clear | 0/1/2 |
| transaction boundary explicit | 0/1/2 |
| optimistic/pessimistic concurrency designed | 0/1/2 |
| constraints enforce final correctness | 0/1/2 |
| read/write models separated where needed | 0/1/2 |
| N+1 tested/monitored | 0/1/2 |
| audit atomic and complete | 0/1/2 |
| outbox/inbox/idempotency implemented | 0/1/2 |
| migration strategy safe | 0/1/2 |
| batch jobs chunked/idempotent | 0/1/2 |
| tenant/security predicates tested | 0/1/2 |
| exception classification/retry policy defined | 0/1/2 |
| observability dashboard exists | 0/1/2 |
| incident runbooks exist | 0/1/2 |
| database-specific behavior understood | 0/1/2 |

Interpretation:

- 0–10: CRUD prototype, high production risk.
- 11–20: typical application, several hidden failure modes.
- 21–25: reasonably production-aware.
- 26–30: strong engineering design.

---

## 27. Final Mental Model

A top-tier persistence engineer does not ask only:

```text
How do I map this entity?
```

They ask:

```text
What state can exist?
Who is allowed to change it?
What invariant must always hold?
What happens under concurrent requests?
What happens if commit succeeds but response fails?
What happens if downstream system is unavailable?
What evidence is required later?
How will we query this at scale?
How will we migrate this without downtime?
How will we debug it at 2 AM?
```

Persistence mastery is not about knowing more annotations. It is about designing state so that the system remains correct under time, concurrency, failure, growth, and human operation.

---

## 28. Ringkasan

Dalam capstone ini kita menyatukan seluruh seri:

- identity design,
- entity lifecycle,
- mapping,
- relationships,
- fetching,
- query model,
- projection/read model,
- transaction boundary,
- isolation/concurrency,
- optimistic/pessimistic locking,
- flush/dirty checking,
- batch processing,
- schema migration,
- constraints/invariants,
- caching,
- advanced mapping,
- audit/historical correctness,
- multi-tenancy,
- repository patterns,
- Jakarta Data,
- Spring Transaction + JPA,
- outbox/inbox/idempotency,
- performance engineering,
- database-specific integration,
- exception classification,
- testing,
- production operations.

The final synthesis:

> Persistence layer is the system of record boundary. Treat it as a correctness, history, integration, and operational discipline—not as a CRUD convenience layer.

---

## 29. Latihan Mandiri

Gunakan domain aplikasi nyata yang kamu kerjakan, lalu jawab:

1. Apa aggregate root utama?
2. Apa business key dan public id-nya?
3. Apa invariant yang harus dijaga database constraint?
4. State transition mana yang membutuhkan optimistic locking?
5. State transition mana yang mungkin membutuhkan pessimistic locking?
6. Query mana yang harus projection, bukan entity?
7. Data mana yang harus diaudit?
8. Event mana yang harus keluar via outbox?
9. Command mana yang harus idempotent?
10. Batch/archival apa yang perlu chunking?
11. Apa query paling mahal di production?
12. Apa failure mode paling berbahaya?
13. Apa metric yang akan memberi early warning?
14. Apa migration paling berisiko?
15. Bagaimana kamu membuktikan semuanya dengan test?

---

## 30. Status Seri

Seri `learn-java-persistence-jpa-jakarta-data-transactions-database-integration` **selesai**.

Total bagian:

```text
Part 000 sampai Part 032
```

Bagian ini adalah:

```text
Part 032 — bagian terakhir
```

---

## 31. Referensi Utama

- Jakarta Persistence 3.2 Specification: https://jakarta.ee/specifications/persistence/3.2/
- Jakarta Persistence 3.2 API / EntityManager: https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/entitymanager
- Jakarta Persistence Locking Tutorial: https://jakarta.ee/learn/docs/jakartaee-tutorial/current/persist/persistence-locking/persistence-locking.html
- Jakarta Transactions 2.0 Specification: https://jakarta.ee/specifications/transactions/2.0/
- Jakarta Data 1.0 Specification: https://jakarta.ee/specifications/data/1.0/
- Hibernate ORM Documentation: https://hibernate.org/orm/documentation/
- Hibernate ORM User Guide: https://docs.hibernate.org/orm/
- Spring Framework Transaction Management: https://docs.spring.io/spring-framework/reference/data-access/transaction/
- Spring Data JPA Reference: https://docs.spring.io/spring-data/jpa/reference/
- Microservices.io Transactional Outbox Pattern: https://microservices.io/patterns/data/transactional-outbox.html
- Debezium Outbox Event Router: https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html
