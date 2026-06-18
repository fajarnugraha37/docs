# Part 29 — Domain Modeling with ORM: Aggregates, Invariants, State Machines, and Regulatory Workflows

Series: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
Target: Java 8–25, JPA 2.x `javax.persistence`, Jakarta Persistence 3.x `jakarta.persistence`, Hibernate ORM, EclipseLink  
Level: Advanced / production architecture

---

## 0. Why This Part Exists

ORM skill usually fails not because engineers do not know `@Entity`, `@OneToMany`, or `@Transactional`, but because they map the wrong conceptual object.

In simple CRUD systems, the database table, entity class, form model, and business object may appear to be the same thing. In serious enterprise systems, especially regulatory, enforcement, licensing, compliance, audit, approval, and case-management systems, this assumption breaks quickly.

A regulatory system usually has:

- long-lived cases,
- many actors,
- changing rules,
- multi-step review,
- reassignment,
- escalation,
- appeals,
- correspondence,
- evidence,
- document versions,
- audit trails,
- strict defensibility,
- partial visibility,
- historical reconstruction,
- and legally significant state transitions.

If the ORM model is designed as a direct reflection of UI screens or database tables, it tends to become unstable:

- one entity grows into a god object,
- cascades cross business boundaries,
- lazy loading leaks into APIs,
- audit history becomes impossible to reconstruct,
- state transitions are implemented as random setters,
- concurrency conflicts overwrite decisions,
- detached DTO merges corrupt child collections,
- and reporting queries fight the write model.

This part teaches how to design ORM entities as part of a larger domain persistence model, not as annotation-decorated database rows.

The main mental shift:

> ORM is good at synchronizing object state with relational state. It is not automatically good at modeling business truth. You must decide which objects deserve identity, lifecycle, invariants, transaction boundaries, history, and query shape.

---

## 1. Core Mental Model

### 1.1 ORM Entity Is Not Always Domain Entity

The word “entity” appears in multiple contexts:

| Term | Meaning |
|---|---|
| ORM entity | A class managed by JPA/Hibernate/EclipseLink and mapped to persistence state. |
| Domain entity | A business object with identity and lifecycle. |
| Database entity/table | A relational structure storing records. |
| API resource | A representation exposed through HTTP or messaging. |
| UI model | A shape optimized for screen interaction. |
| Reporting model | A read-optimized shape for analytics/search/export. |

These can overlap, but they should not be assumed identical.

Example:

```text
Case
 ├─ ORM entity: CaseRecord
 ├─ Domain concept: Regulatory case under investigation
 ├─ Database storage: CASE_HEADER, CASE_STATUS_HISTORY, CASE_ASSIGNMENT, CASE_DECISION
 ├─ API response: CaseDetailResponse
 ├─ UI model: Case workspace page
 └─ Reporting model: CASE_LISTING_VIEW / search index / materialized view
```

A top-level engineer asks:

- What object owns the invariant?
- What state can change together atomically?
- What data must be historically reconstructable?
- What data is read frequently but written rarely?
- What data is written frequently but not always displayed?
- What boundary prevents accidental cascade, merge, or delete?

### 1.2 Aggregate Is a Consistency Boundary

An aggregate is not just a parent entity with children. It is a boundary where invariants are protected.

A useful definition:

> An aggregate is a cluster of objects that should be loaded, validated, modified, and persisted through one root when enforcing a business invariant.

In ORM terms, aggregate boundary affects:

- which associations may cascade,
- which child entities may be orphan-removed,
- which collections should be mutable through the root,
- which update operations require optimistic locking,
- which graph can be safely merged,
- which data should be loaded together,
- and which table changes belong in one transaction.

Not every foreign key relationship is an aggregate relationship.

Example:

```text
CaseRecord --many-to-one--> Officer
```

A case references an officer, but the case does not own the officer lifecycle. Therefore:

- no `CascadeType.REMOVE` from case to officer,
- no orphan removal,
- no large officer graph loading through case,
- no merge of officer profile through case update,
- officer update is handled by officer/profile module.

### 1.3 Workflow Is Not Just a Status Column

A status column can represent current state, but it cannot by itself represent workflow truth.

For defensible systems, you usually need at least:

- current state,
- allowed transitions,
- actor performing transition,
- reason/comment,
- timestamp,
- previous state,
- next state,
- correlation/request id,
- source channel,
- and sometimes evidence snapshot.

A weak model:

```text
CASE.status = 'APPROVED'
CASE.updated_by = 'alice'
CASE.updated_at = now
```

A stronger model:

```text
CASE.current_status = 'APPROVED'
CASE_STATUS_EVENT
  - case_id
  - from_status
  - to_status
  - action
  - actor_id
  - actor_role
  - reason
  - occurred_at
  - request_id
  - decision_id
```

The current status is optimized for current operations. The status event is used for reconstructability.

### 1.4 Write Model and Read Model Often Diverge

ORM entity graphs are often good write models. They are not always good read models.

Write model priorities:

- enforce invariant,
- mutate safely,
- maintain lifecycle,
- protect transaction boundary,
- avoid illegal state transitions,
- preserve auditability.

Read model priorities:

- fast listing,
- filtering,
- sorting,
- pagination,
- search,
- aggregation,
- export,
- UI composition.

Trying to use one entity graph for everything causes two common failures:

1. Write model becomes huge because every screen wants more data.
2. Read query becomes slow because listing pages hydrate full aggregates.

A serious persistence architecture accepts that:

```text
Command path != query path
```

This does not require full CQRS/event sourcing. It can simply mean:

- entities for writes,
- DTO projections for reads,
- database views for listings,
- denormalized search tables for high-volume query,
- native SQL for reporting,
- separate history tables for audit reconstruction.

---

## 2. Regulatory Workflow Example Domain

We will use a simplified but realistic case-management domain.

### 2.1 Domain Concepts

```text
Application
 └─ submitted by applicant
 └─ may create CaseRecord if screening/compliance issue is found

CaseRecord
 ├─ current status
 ├─ assigned officer/team
 ├─ priority/risk level
 ├─ compliance findings
 ├─ documents/evidence
 ├─ correspondence
 ├─ tasks
 ├─ decisions
 ├─ status history
 └─ audit trail

Task
 ├─ assigned actor
 ├─ due date
 ├─ status
 └─ action outcome

Decision
 ├─ decision type
 ├─ recommendation
 ├─ approver
 ├─ legal basis
 └─ effective date

Correspondence
 ├─ recipient
 ├─ template snapshot
 ├─ sent status
 └─ delivery log

Document
 ├─ metadata
 ├─ version
 ├─ storage reference
 └─ checksum
```

### 2.2 Naive Entity Graph

A naive design might do this:

```java
@Entity
public class CaseRecord {
    @Id
    private Long id;

    private String status;

    @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Task> tasks;

    @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Document> documents;

    @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Correspondence> correspondences;

    @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Decision> decisions;

    @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true)
    private List<AuditTrail> auditTrails;
}
```

This looks convenient but is dangerous.

Problems:

- The aggregate is too large.
- Loading a case may load or accidentally initialize huge collections.
- Replacing a child collection from DTO may delete history.
- Audit trails should almost never be orphan-removed.
- Documents may have independent lifecycle/versioning.
- Correspondence delivery state may be controlled by email subsystem.
- Decisions may be immutable after finalization.
- Tasks may have assignment/concurrency rules independent of case header.
- `CascadeType.ALL` hides business boundary mistakes.

### 2.3 Better Boundary Thinking

A better design separates lifecycle ownership:

```text
Case Aggregate
 ├─ CaseRecord root
 ├─ small owned value-like details
 ├─ current assignment reference
 ├─ current state
 └─ state transition methods

Task Aggregate
 ├─ Task root
 └─ task action history

Decision Aggregate
 ├─ Decision root
 └─ decision approval metadata

Document Aggregate
 ├─ DocumentMetadata root
 └─ DocumentVersion records

Correspondence Aggregate
 ├─ Correspondence root
 └─ delivery attempts

Audit/Event Append-Only Model
 ├─ CaseStatusEvent
 ├─ CaseAuditEvent
 └─ integration/event log
```

The case root may reference other aggregate roots by ID or `@ManyToOne`, but it should not own their full lifecycle blindly.

---

## 3. Aggregate Boundary Design with JPA

### 3.1 Aggregate Root Rules

A good ORM aggregate root usually follows these rules:

1. External code modifies children through root methods.
2. Invariants are enforced before flush.
3. Child lifecycle is clear.
4. Cascades stay inside boundary.
5. Collections are not exposed as mutable public lists.
6. Large history collections are not part of normal aggregate load.
7. References to other aggregates are by ID or non-cascading association.
8. Versioning protects meaningful concurrent changes.

Example:

```java
@Entity
@Table(name = "case_record")
public class CaseRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_record_seq")
    @SequenceGenerator(name = "case_record_seq", sequenceName = "case_record_seq", allocationSize = 50)
    private Long id;

    @Version
    private long version;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 40)
    private CaseStatus status;

    @Column(nullable = false, length = 40)
    private String referenceNo;

    @Column(nullable = false, length = 40)
    private String riskLevel;

    @Column(nullable = false)
    private Instant createdAt;

    @Column(nullable = false)
    private Instant updatedAt;

    @OneToMany(
        mappedBy = "caseRecord",
        cascade = CascadeType.ALL,
        orphanRemoval = true
    )
    private final List<CaseNote> notes = new ArrayList<>();

    protected CaseRecord() {
        // JPA constructor
    }

    public CaseRecord(String referenceNo, String riskLevel, Instant now) {
        this.referenceNo = Objects.requireNonNull(referenceNo);
        this.riskLevel = Objects.requireNonNull(riskLevel);
        this.status = CaseStatus.OPEN;
        this.createdAt = Objects.requireNonNull(now);
        this.updatedAt = now;
    }

    public void addNote(String text, String officerId, Instant now) {
        ensureEditable();
        CaseNote note = new CaseNote(this, text, officerId, now);
        notes.add(note);
        this.updatedAt = now;
    }

    public void transitionTo(CaseStatus next, String actorId, String reason, Instant now) {
        if (!this.status.canTransitionTo(next)) {
            throw new IllegalStateException("Illegal transition from " + status + " to " + next);
        }
        if (reason == null || reason.isBlank()) {
            throw new IllegalArgumentException("Transition reason is required");
        }
        this.status = next;
        this.updatedAt = now;
    }

    private void ensureEditable() {
        if (status.isTerminal()) {
            throw new IllegalStateException("Terminal case cannot be edited");
        }
    }

    public List<CaseNote> getNotes() {
        return Collections.unmodifiableList(notes);
    }
}
```

Important points:

- The entity is not a bag of setters.
- State transition has rules.
- Child creation maintains both sides of association.
- Collection is not exposed for arbitrary replacement.
- `@Version` protects concurrent modifications.
- Cascade is limited to a truly owned child: `CaseNote`.

### 3.2 Child Entity Inside Aggregate

```java
@Entity
@Table(name = "case_note")
public class CaseNote {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_note_seq")
    @SequenceGenerator(name = "case_note_seq", sequenceName = "case_note_seq", allocationSize = 50)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "case_id", nullable = false)
    private CaseRecord caseRecord;

    @Column(nullable = false, length = 4000)
    private String text;

    @Column(nullable = false, length = 100)
    private String createdBy;

    @Column(nullable = false)
    private Instant createdAt;

    protected CaseNote() {
    }

    CaseNote(CaseRecord caseRecord, String text, String createdBy, Instant createdAt) {
        this.caseRecord = Objects.requireNonNull(caseRecord);
        this.text = validateText(text);
        this.createdBy = Objects.requireNonNull(createdBy);
        this.createdAt = Objects.requireNonNull(createdAt);
    }

    private static String validateText(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Note text is required");
        }
        return value;
    }
}
```

`CaseNote` is owned by `CaseRecord`. It probably should not exist independently. Cascade and orphan removal are reasonable.

### 3.3 Reference to Another Aggregate

```java
@Entity
@Table(name = "case_record")
public class CaseRecord {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "assigned_officer_id", nullable = false)
    private Officer assignedOfficer;

    public void assignTo(Officer officer, String actorId, Instant now) {
        ensureEditable();
        this.assignedOfficer = Objects.requireNonNull(officer);
        this.updatedAt = now;
    }
}
```

Do not cascade from case to officer:

```java
// Avoid this unless the case truly owns officer lifecycle, which is almost never true.
@ManyToOne(cascade = CascadeType.ALL)
private Officer assignedOfficer;
```

A stricter alternative is storing only the foreign key:

```java
@Column(name = "assigned_officer_id", nullable = false)
private Long assignedOfficerId;
```

This avoids accidental loading and accidental merge/cascade. The trade-off is less object navigation.

Top-level rule:

> Across aggregate boundaries, prefer reference by ID or non-cascading lazy reference. Inside aggregate boundaries, use controlled cascades only when lifecycle ownership is true.

---

## 4. Modeling Invariants

### 4.1 What Is an Invariant?

An invariant is a rule that must always be true at a consistency boundary.

Examples:

- A closed case cannot receive new editable findings.
- A decision cannot be approved by the same officer who recommended it.
- An appeal can only be submitted for an appealable decision.
- A task cannot be completed without an outcome.
- A final decision cannot be modified, only superseded.
- A document version checksum cannot change after upload.
- A case cannot transition from `DRAFT` directly to `CLOSED`.

ORM mapping cannot enforce all of these. Database constraints cannot enforce all of these either. Correct systems use layers:

| Rule Type | Best Enforcement Location |
|---|---|
| Non-null mandatory data | DB constraint + entity constructor/method |
| Unique business key | DB unique constraint + service check |
| Legal state transition | Domain method/state machine |
| Cross-row uniqueness | DB constraint where possible |
| Cross-aggregate policy | Application service/domain service |
| Audit immutability | DB privilege/append-only design + code |
| Security authorization | Service/policy layer, not entity alone |

### 4.2 Avoid Setter-Based Domain Mutation

Weak model:

```java
caseRecord.setStatus(CaseStatus.CLOSED);
caseRecord.setClosedAt(now);
caseRecord.setClosedBy(userId);
caseRecord.setClosureReason(reason);
```

This allows illegal intermediate states and missing fields.

Better model:

```java
caseRecord.close(userId, reason, now);
```

Inside:

```java
public void close(String actorId, String reason, Instant now) {
    if (!status.canTransitionTo(CaseStatus.CLOSED)) {
        throw new IllegalStateException("Case cannot be closed from " + status);
    }
    if (reason == null || reason.isBlank()) {
        throw new IllegalArgumentException("Closure reason is required");
    }
    this.status = CaseStatus.CLOSED;
    this.closedAt = now;
    this.closedBy = actorId;
    this.closureReason = reason;
    this.updatedAt = now;
}
```

This makes the business operation atomic at object level before flush.

### 4.3 Entity Lifecycle Callbacks Are Not Business Workflow Engines

JPA callbacks:

- `@PrePersist`,
- `@PostPersist`,
- `@PreUpdate`,
- `@PostUpdate`,
- `@PreRemove`,
- `@PostRemove`,
- `@PostLoad`.

Useful for:

- timestamps,
- technical audit fields,
- normalization,
- validation guardrails,
- derived fields.

Dangerous for:

- sending emails,
- calling external services,
- creating workflow tasks,
- making authorization decisions,
- mutating large unrelated aggregates,
- relying on callback ordering across provider versions.

Bad:

```java
@PostUpdate
void sendDecisionEmail() {
    emailGateway.send(...); // dangerous side effect during flush
}
```

Why dangerous:

- flush may happen before commit,
- transaction may roll back after email sent,
- callback may fire in unexpected query-triggered flush,
- retry can duplicate side effect,
- callback has poor access to request/security context.

Better:

- persist a domain event/outbox row inside transaction,
- dispatch after commit using outbox processor.

---

## 5. State Machines with ORM

### 5.1 Simple Enum State Machine

For many systems, an enum with transition rules is enough.

```java
public enum CaseStatus {
    OPEN,
    UNDER_REVIEW,
    PENDING_INFORMATION,
    RECOMMENDED,
    APPROVED,
    REJECTED,
    CLOSED;

    public boolean canTransitionTo(CaseStatus next) {
        return switch (this) {
            case OPEN -> next == UNDER_REVIEW || next == CLOSED;
            case UNDER_REVIEW -> next == PENDING_INFORMATION || next == RECOMMENDED || next == CLOSED;
            case PENDING_INFORMATION -> next == UNDER_REVIEW || next == CLOSED;
            case RECOMMENDED -> next == APPROVED || next == REJECTED;
            case APPROVED, REJECTED -> next == CLOSED;
            case CLOSED -> false;
        };
    }

    public boolean isTerminal() {
        return this == CLOSED;
    }
}
```

Java 8-compatible version:

```java
public enum CaseStatus {
    OPEN,
    UNDER_REVIEW,
    PENDING_INFORMATION,
    RECOMMENDED,
    APPROVED,
    REJECTED,
    CLOSED;

    public boolean canTransitionTo(CaseStatus next) {
        switch (this) {
            case OPEN:
                return next == UNDER_REVIEW || next == CLOSED;
            case UNDER_REVIEW:
                return next == PENDING_INFORMATION || next == RECOMMENDED || next == CLOSED;
            case PENDING_INFORMATION:
                return next == UNDER_REVIEW || next == CLOSED;
            case RECOMMENDED:
                return next == APPROVED || next == REJECTED;
            case APPROVED:
            case REJECTED:
                return next == CLOSED;
            case CLOSED:
                return false;
            default:
                return false;
        }
    }
}
```

### 5.2 Persist Current State and State Events Separately

```java
@Entity
@Table(name = "case_status_event")
public class CaseStatusEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_status_event_seq")
    @SequenceGenerator(name = "case_status_event_seq", sequenceName = "case_status_event_seq", allocationSize = 50)
    private Long id;

    @Column(name = "case_id", nullable = false)
    private Long caseId;

    @Enumerated(EnumType.STRING)
    @Column(name = "from_status", nullable = false, length = 40)
    private CaseStatus fromStatus;

    @Enumerated(EnumType.STRING)
    @Column(name = "to_status", nullable = false, length = 40)
    private CaseStatus toStatus;

    @Column(nullable = false, length = 100)
    private String action;

    @Column(nullable = false, length = 100)
    private String actorId;

    @Column(length = 4000)
    private String reason;

    @Column(nullable = false)
    private Instant occurredAt;

    @Column(nullable = false, length = 100)
    private String requestId;

    protected CaseStatusEvent() {
    }

    public CaseStatusEvent(
        Long caseId,
        CaseStatus fromStatus,
        CaseStatus toStatus,
        String action,
        String actorId,
        String reason,
        Instant occurredAt,
        String requestId
    ) {
        this.caseId = Objects.requireNonNull(caseId);
        this.fromStatus = Objects.requireNonNull(fromStatus);
        this.toStatus = Objects.requireNonNull(toStatus);
        this.action = Objects.requireNonNull(action);
        this.actorId = Objects.requireNonNull(actorId);
        this.reason = reason;
        this.occurredAt = Objects.requireNonNull(occurredAt);
        this.requestId = Objects.requireNonNull(requestId);
    }
}
```

Why use `caseId` instead of `@ManyToOne` here?

Because status event is append-only history. In many systems, it is not part of the mutable case aggregate. Referencing by ID avoids accidental cascade/loading and keeps history independent.

### 5.3 Application Service Coordinates Transition and Event

```java
@Transactional
public void transitionCase(Long caseId, CaseStatus next, String reason, UserContext user, String requestId) {
    CaseRecord caseRecord = caseRepository.getForUpdateIntent(caseId);

    CaseStatus previous = caseRecord.getStatus();
    caseRecord.transitionTo(next, user.userId(), reason, clock.instant());

    CaseStatusEvent event = new CaseStatusEvent(
        caseRecord.getId(),
        previous,
        next,
        "TRANSITION",
        user.userId(),
        reason,
        clock.instant(),
        requestId
    );

    statusEventRepository.save(event);
}
```

This design gives:

- current state on `case_record`,
- history in `case_status_event`,
- optimistic lock on case root,
- request correlation,
- transaction atomicity between current state and history insert.

### 5.4 Avoid State Machine Hidden in Database Triggers Alone

Database triggers may be useful for technical enforcement or audit, but hiding business workflow entirely inside triggers creates issues:

- hard to unit test,
- hard to reason from Java code,
- hard to version with application logic,
- hard to express actor/context,
- risk of mismatch between UI allowed actions and DB behavior,
- provider cannot understand side effects for first-level cache.

If triggers mutate columns that ORM already has loaded, your persistence context may become stale unless refreshed.

---

## 6. History, Audit, and Defensibility

### 6.1 Audit Trail Is Not One Thing

There are multiple audit needs:

| Audit Type | Purpose | Example |
|---|---|---|
| Technical audit fields | Basic tracking | `created_at`, `created_by`, `updated_at`, `updated_by` |
| Status event history | Reconstruct workflow | `OPEN -> UNDER_REVIEW` |
| Domain event | Business-significant event | `DecisionApproved`, `DocumentSubmitted` |
| Data change audit | Before/after values | field-level diff |
| Access audit | Who viewed sensitive record | read access log |
| Integration audit | External API interaction | request/response metadata |
| Legal evidence snapshot | Defensible historical copy | template version, document checksum |

Do not force all audit needs into one `audit_trail` table unless the access pattern and retention rules are truly shared.

### 6.2 Append-Only Tables

Append-only tables are often more defensible than mutable history collections.

Example:

```sql
create table case_status_event (
    id number primary key,
    case_id number not null,
    from_status varchar2(40) not null,
    to_status varchar2(40) not null,
    action varchar2(100) not null,
    actor_id varchar2(100) not null,
    reason varchar2(4000),
    occurred_at timestamp not null,
    request_id varchar2(100) not null
);
```

ORM mapping should reflect append-only intent:

```java
@Entity
@Table(name = "case_status_event")
public class CaseStatusEvent {
    // No public setters.
    // No update methods.
    // No orphan removal from CaseRecord.
}
```

Even better, restrict update/delete privileges at database level for application role if policy allows.

### 6.3 Audit History Should Not Be a Normal `@OneToMany` Collection on Root

Tempting:

```java
@OneToMany(mappedBy = "caseRecord")
private List<CaseStatusEvent> statusEvents;
```

Problem:

- case load can accidentally initialize huge history,
- JSON serialization can explode,
- `equals/toString` can trigger lazy loads,
- merge can corrupt collection semantics,
- business code may treat history as mutable child list.

Prefer query-based access:

```java
public interface CaseStatusEventRepository {
    List<CaseStatusEvent> findByCaseIdOrderByOccurredAt(Long caseId);
}
```

Or DTO projection:

```java
public record CaseTimelineItem(
    Instant occurredAt,
    String actorId,
    CaseStatus fromStatus,
    CaseStatus toStatus,
    String reason
) {}
```

Java 8 alternative:

```java
public final class CaseTimelineItem {
    private final Instant occurredAt;
    private final String actorId;
    private final CaseStatus fromStatus;
    private final CaseStatus toStatus;
    private final String reason;

    public CaseTimelineItem(
        Instant occurredAt,
        String actorId,
        CaseStatus fromStatus,
        CaseStatus toStatus,
        String reason
    ) {
        this.occurredAt = occurredAt;
        this.actorId = actorId;
        this.fromStatus = fromStatus;
        this.toStatus = toStatus;
        this.reason = reason;
    }
}
```

---

## 7. Designing Case Management Persistence Boundaries

### 7.1 Candidate Aggregates

For a complex case-management system, a useful starting point:

```text
CaseRecord Aggregate
 - owns current lifecycle metadata
 - owns small notes/comments if they are lightweight and case-scoped
 - references assignment/officer/team
 - does not own all tasks/documents/correspondence/history

Task Aggregate
 - owns task state and task action history
 - references case by caseId
 - concurrency protected independently

Decision Aggregate
 - owns recommendation/approval/finalization
 - immutable or versioned after approval
 - references case by caseId

Document Aggregate
 - owns metadata and versions
 - references external storage object
 - immutable checksum/version records

Correspondence Aggregate
 - owns recipient/template snapshot/send status
 - references case by caseId
 - delivery attempts append-only

Audit/Event Model
 - append-only
 - references actor/request/correlation
 - optimized for timeline reconstruction
```

### 7.2 Why Not One Giant Aggregate?

A giant aggregate seems convenient because one `CaseRecord` object graph can show everything. It fails because:

- each update locks/conflicts with unrelated updates,
- flush dirty checking scans large graph,
- fetch plan becomes impossible,
- listing query hydrates too much,
- child lifecycle differs,
- concurrent task update conflicts with case note update,
- document upload should not require loading all decisions,
- correspondence retry should not mutate case header version unnecessarily.

Rule:

> Put objects in the same aggregate only when they must be consistent in the same transaction for a business invariant.

### 7.3 Transaction Boundary Examples

#### Add case note

```text
Load CaseRecord
Check case editable
Add CaseNote child
Flush case + note
Commit
```

Same aggregate.

#### Upload document

```text
Store binary/object externally
Create DocumentMetadata
Create DocumentVersion
Create audit/outbox event
Commit metadata transaction
```

Separate aggregate. The case may not need to be loaded unless state rule requires it.

#### Approve decision

```text
Load Decision
Load CaseRecord if current status matters
Check authorization and separation of duties
Finalize Decision
Transition CaseRecord
Insert CaseStatusEvent
Insert OutboxEvent
Commit
```

Cross-aggregate transaction may be acceptable because final decision and case status must align.

#### Retry failed email delivery

```text
Load Correspondence
Append DeliveryAttempt
Update send status
Commit
```

Should not update `CaseRecord.version` unless case state actually changes.

---

## 8. Mapping Patterns for Regulatory Domains

### 8.1 Current State + History Table

Current table:

```java
@Entity
@Table(name = "case_record")
public class CaseRecord {
    @Id
    private Long id;

    @Version
    private long version;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 40)
    private CaseStatus status;
}
```

History table:

```java
@Entity
@Table(name = "case_status_event")
public class CaseStatusEvent {
    @Id
    private Long id;

    @Column(nullable = false)
    private Long caseId;

    @Enumerated(EnumType.STRING)
    private CaseStatus fromStatus;

    @Enumerated(EnumType.STRING)
    private CaseStatus toStatus;
}
```

Benefits:

- current state query is simple,
- history query is explicit,
- no accidental large collection,
- append-only defensibility.

Trade-off:

- code must maintain both in one transaction,
- reporting must join/query history separately.

### 8.2 Immutable Child Records

For decision history or document versions:

```java
@Entity
@Table(name = "document_version")
public class DocumentVersion {

    @Id
    private Long id;

    @Column(nullable = false)
    private Long documentId;

    @Column(nullable = false)
    private int versionNo;

    @Column(nullable = false, length = 128)
    private String checksum;

    @Column(nullable = false, length = 500)
    private String storageKey;

    @Column(nullable = false)
    private Instant createdAt;

    protected DocumentVersion() {
    }

    public DocumentVersion(Long documentId, int versionNo, String checksum, String storageKey, Instant createdAt) {
        this.documentId = Objects.requireNonNull(documentId);
        this.versionNo = versionNo;
        this.checksum = Objects.requireNonNull(checksum);
        this.storageKey = Objects.requireNonNull(storageKey);
        this.createdAt = Objects.requireNonNull(createdAt);
    }

    // No setters.
}
```

### 8.3 Snapshot Instead of Live Reference

For correspondence, never rely only on current template/user data if future reconstruction matters.

Weak:

```java
@ManyToOne(fetch = FetchType.LAZY)
private EmailTemplate template;
```

If template changes later, old sent email may become unreconstructable.

Better:

```java
@Column(nullable = false, length = 100)
private String templateCode;

@Column(nullable = false)
private int templateVersion;

@Lob
@Column(nullable = false)
private String renderedSubjectSnapshot;

@Lob
@Column(nullable = false)
private String renderedBodySnapshot;
```

This stores what was actually sent or intended to be sent.

### 8.4 Actor Snapshot vs Actor Reference

In regulatory audit, actor identity must remain meaningful even if user profile changes.

```java
@Column(nullable = false, length = 100)
private String actorId;

@Column(nullable = false, length = 200)
private String actorDisplayNameAtTime;

@Column(nullable = false, length = 100)
private String actorRoleAtTime;
```

Do not depend only on:

```java
@ManyToOne(fetch = FetchType.LAZY)
private User actor;
```

A user can change name, role, department, or even be deactivated. Historical event should remain interpretable.

---

## 9. ORM and State Machine Implementation Options

### 9.1 Entity Method State Machine

Best for:

- simple/medium workflow,
- transitions fit one aggregate,
- rules stable and explicit,
- no dynamic runtime configuration.

Example:

```java
caseRecord.submitForReview(actor, now);
caseRecord.requestInformation(actor, reason, now);
caseRecord.recommendApproval(actor, rationale, now);
caseRecord.close(actor, reason, now);
```

Pros:

- clear invariant location,
- testable,
- easy to inspect,
- works well with optimistic locking.

Cons:

- can become large if workflow is complex,
- not ideal for highly configurable workflows,
- cross-aggregate orchestration still belongs in service layer.

### 9.2 Separate Domain Service

Best for:

- rules depend on multiple aggregates,
- authorization/policy must be checked,
- transition creates tasks/documents/correspondence,
- decision depends on external rules engine.

```java
public final class CaseTransitionPolicy {
    public void validateTransition(CaseRecord caseRecord, CaseStatus next, UserContext user) {
        // cross-role, risk-level, and ownership rules
    }
}
```

Application service:

```java
@Transactional
public void approveCase(Long caseId, Long decisionId, UserContext user) {
    CaseRecord caseRecord = caseRepository.get(caseId);
    Decision decision = decisionRepository.get(decisionId);

    transitionPolicy.validateApproval(caseRecord, decision, user);

    decision.approve(user.userId(), clock.instant());
    caseRecord.transitionTo(CaseStatus.APPROVED, user.userId(), "Decision approved", clock.instant());

    statusEventRepository.save(CaseStatusEvent.approved(caseRecord, user, requestId));
    outboxRepository.save(OutboxEvent.caseApproved(caseRecord.getId()));
}
```

### 9.3 External Workflow Engine

Best for:

- BPMN/state machine managed separately,
- human task orchestration,
- timers/escalations,
- process visualization,
- cross-system workflow.

But persistence model still matters.

Even if Camunda/Flowable/Temporal/etc controls workflow, your domain database still needs:

- current business status,
- domain history,
- correlation to process instance,
- idempotency keys,
- audit events,
- durable state outside workflow engine if required.

Avoid treating workflow engine state as the only source of regulatory truth unless governance explicitly accepts it.

---

## 10. Concurrency Design for Domain Models

### 10.1 Version the Aggregate Root

```java
@Version
@Column(nullable = false)
private long version;
```

Optimistic locking is critical when:

- two officers update same case,
- one user approves while another edits,
- task completion updates case state,
- decision finalization changes status,
- retry/resubmission modifies workflow.

### 10.2 Avoid False Conflicts from Giant Aggregates

If correspondence retry increments `CaseRecord.version`, then a user editing case priority may conflict with an email retry process. That is a false conflict.

Separate aggregate versions:

```text
case_record.version
correspondence.version
decision.version
task.version
```

### 10.3 Use Pessimistic Lock Only for Specific Hot Decisions

Optimistic locking is usually preferred. Pessimistic locking may be appropriate for:

- queue claiming,
- unique assignment selection,
- financial-like counter reservation,
- strict one-at-a-time approval step.

Example:

```java
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("select c from CaseRecord c where c.id = :id")
CaseRecord lockCaseForDecision(@Param("id") Long id);
```

Risks:

- deadlock,
- long lock wait,
- transaction timeout,
- lower throughput,
- poor user experience if used around UI think time.

### 10.4 Idempotency for Workflow Commands

A serious workflow command should be idempotent.

```sql
create table command_deduplication (
    command_id varchar2(100) primary key,
    aggregate_type varchar2(100) not null,
    aggregate_id number not null,
    processed_at timestamp not null
);
```

Why:

- user double-click,
- frontend retry,
- message redelivery,
- network timeout after commit,
- external API callback duplicate.

ORM can persist the deduplication record inside the same transaction.

---

## 11. Read Model Strategy

### 11.1 Case Listing Should Not Hydrate Case Aggregate

Bad listing query:

```java
List<CaseRecord> cases = em.createQuery(
    "select c from CaseRecord c " +
    "left join fetch c.notes " +
    "left join fetch c.documents " +
    "where c.status = :status",
    CaseRecord.class
).getResultList();
```

Problems:

- duplicate rows,
- cartesian product,
- memory pressure,
- broken pagination,
- unnecessary dirty checking,
- first-level cache bloat.

Better:

```java
public record CaseListingRow(
    Long id,
    String referenceNo,
    CaseStatus status,
    String assignedOfficerName,
    String riskLevel,
    Instant updatedAt
) {}
```

JPQL constructor projection:

```java
select new com.example.caseapp.CaseListingRow(
    c.id,
    c.referenceNo,
    c.status,
    o.displayName,
    c.riskLevel,
    c.updatedAt
)
from CaseRecord c
join c.assignedOfficer o
where c.status = :status
order by c.updatedAt desc
```

For complex listing, consider:

- database view,
- materialized view,
- search index,
- denormalized listing table,
- native SQL projection.

### 11.2 Timeline Query Should Be Explicit

```java
select new com.example.caseapp.timeline.TimelineItem(
    e.occurredAt,
    e.actorId,
    e.action,
    e.fromStatus,
    e.toStatus,
    e.reason
)
from CaseStatusEvent e
where e.caseId = :caseId
order by e.occurredAt asc
```

Do not load case and navigate large historical collections.

### 11.3 Detail Page Can Be Composed

A detail page does not require one monster aggregate load.

```text
Case detail response
 ├─ Case header projection
 ├─ Current assignment projection
 ├─ Recent tasks projection
 ├─ Latest decision projection
 ├─ Document metadata projection
 └─ Timeline projection
```

This can be composed in application service using multiple optimized queries.

Trade-off:

- More queries, but controlled and bounded.
- Less accidental graph loading.
- Better pagination/authorization per section.
- Clearer performance envelope.

---

## 12. Provider-Specific Considerations

### 12.1 Hibernate ORM

Hibernate gives powerful features for domain persistence, but each must be used deliberately.

Useful features:

- `@BatchSize` for controlled lazy batch loading,
- fetch profiles,
- filters,
- `@Where` / newer soft-delete support depending on version,
- bytecode enhancement,
- custom types,
- event listeners,
- interceptors,
- Envers for auditing,
- `StatelessSession` for bulk processing,
- second-level cache regions.

Risks:

- provider-specific annotations reduce portability,
- filters can be missed in native queries,
- Envers/history model may not match legal audit requirements,
- event listeners can cause hidden side effects,
- lazy behavior can depend on enhancement/proxy configuration,
- cascade/merge behavior can surprise detached API boundaries.

Domain modeling implication:

> Hibernate can support advanced persistence patterns, but it should not be used to hide unclear aggregate boundaries.

### 12.2 EclipseLink

EclipseLink has strong concepts around sessions, descriptors, weaving, cache, fetch groups, and advanced mapping extensions.

Useful features:

- weaving for lazy/loading/change tracking,
- descriptor customizers,
- shared cache controls,
- query hints,
- batch reading,
- fetch groups,
- multitenancy extensions,
- advanced converters/mappings.

Risks:

- shared cache may surprise teams expecting only transaction-local identity,
- weaving differences can change lazy behavior,
- descriptor customization can hide mapping rules,
- provider-specific query hints reduce portability,
- cache isolation must be designed carefully for security/tenant boundaries.

Domain modeling implication:

> EclipseLink can support sophisticated persistence behavior, but cache/weaving/session behavior must align with your consistency and audit model.

### 12.3 JPA Specification Boundary

Jakarta Persistence standardizes object/relational mapping and persistence management for Java SE/Jakarta EE applications, but many production-relevant details remain provider-specific: SQL generation, lazy loading implementation, dirty checking strategy, cache behavior, batching behavior, and many optimization hints.

Therefore:

- use JPA for common contract,
- document provider-specific assumptions,
- write integration tests for provider behavior,
- avoid pretending provider portability is free.

---

## 13. Java 8–25 Compatibility Notes

### 13.1 Package Namespace

Java 8-era applications often use:

```java
import javax.persistence.Entity;
```

Modern Jakarta EE applications use:

```java
import jakarta.persistence.Entity;
```

Do not mix `javax.persistence` and `jakarta.persistence` in the same persistence model unless you are in a transitional adapter scenario. Mixed dependency trees are a major migration hazard.

### 13.2 Java Language Features

| Java Version | Useful for Domain Modeling |
|---|---|
| Java 8 | `Optional`, lambdas, `java.time`, default methods |
| Java 11 | stronger baseline for modern frameworks |
| Java 17 | sealed classes, records, pattern matching direction, LTS ecosystem |
| Java 21 | virtual threads for some service workloads, pattern matching, sequenced collections |
| Java 25 | modern LTS baseline for future enterprise runtime |

Be careful:

- JPA entities still need no-arg constructor.
- Records are excellent DTOs, not general mutable JPA entities.
- Sealed classes may conflict with proxy/enhancement assumptions if used naively.
- Final classes/methods can interfere with proxy-based lazy loading.
- Immutability is great for value objects/history records, but ORM provider support differs.

### 13.3 Records for Projections

Modern Java:

```java
public record CaseListingRow(
    Long id,
    String referenceNo,
    CaseStatus status,
    Instant updatedAt
) {}
```

Java 8:

```java
public final class CaseListingRow {
    private final Long id;
    private final String referenceNo;
    private final CaseStatus status;
    private final Instant updatedAt;

    public CaseListingRow(Long id, String referenceNo, CaseStatus status, Instant updatedAt) {
        this.id = id;
        this.referenceNo = referenceNo;
        this.status = status;
        this.updatedAt = updatedAt;
    }
}
```

### 13.4 Switch Expressions for State Machine

Modern Java switch expression is clearer, but Java 8 needs classic switch. Keep domain rule logic equivalent across versions.

---

## 14. Common Anti-Patterns

### 14.1 One Entity Per Screen

Symptom:

- `CaseDetailEntity`, `CaseEditEntity`, `CaseApprovalEntity` mapped to same table differently.

Problem:

- inconsistent lifecycle,
- duplicate mapping,
- persistence context identity conflict,
- update ambiguity.

Better:

- one write entity model,
- multiple DTO/read projections.

### 14.2 One Giant Case Aggregate

Symptom:

```java
CaseRecord
 ├─ all tasks
 ├─ all documents
 ├─ all correspondence
 ├─ all audit logs
 ├─ all decisions
 ├─ all comments
 └─ all external integration logs
```

Problem:

- impossible fetch plan,
- slow dirty checking,
- accidental cascades,
- false optimistic lock conflicts,
- memory blowup.

Better:

- split aggregates by lifecycle and invariant.

### 14.3 Status Column Without Transition History

Problem:

- cannot explain how current status happened,
- cannot prove actor/reason/time,
- cannot reconstruct legal timeline.

Better:

- current status + append-only status events.

### 14.4 Exposing Entity Setters to API Mapping

Problem:

- external request can mutate internal fields,
- mass assignment,
- partial update ambiguity,
- lifecycle bypass.

Better:

- command DTOs,
- application service,
- domain methods.

### 14.5 Cascading Across Reference Data

Bad:

```java
@ManyToOne(cascade = CascadeType.ALL)
private LicenceType licenceType;
```

Problem:

- update/delete reference data accidentally from transactional workflow.

Better:

```java
@ManyToOne(fetch = FetchType.LAZY)
private LicenceType licenceType;
```

Or store code:

```java
@Column(nullable = false, length = 50)
private String licenceTypeCode;
```

### 14.6 Audit as Mutable Child Collection

Problem:

- history can be removed or replaced by merge/orphan removal,
- large lazy collection risk,
- not defensible.

Better:

- append-only event table,
- explicit repository queries.

### 14.7 Domain Events Fired Directly From Entity Callback

Problem:

- flush can happen before commit,
- side effect may escape rollback,
- duplicate sends,
- unclear ordering.

Better:

- transactional outbox.

---

## 15. Design Rules

### 15.1 Aggregate Boundary Rules

Use same aggregate when:

- child cannot exist without root,
- child mutation must obey root invariant,
- child lifecycle is owned by root,
- child collection is bounded or controlled,
- cascade/orphan removal is safe.

Use separate aggregate when:

- lifecycle differs,
- data grows unbounded,
- concurrent updates should not conflict,
- child has independent identity/workflow,
- different module owns it,
- retention/audit/security rules differ.

### 15.2 Association Rules

- Use `@ManyToOne(fetch = LAZY)` for most references.
- Avoid cascade on `@ManyToOne` unless ownership is true.
- Avoid bidirectional relationships unless both directions are truly needed.
- Keep history collections out of normal root entity graph.
- Use ID reference for append-only/history/integration records.

### 15.3 State Rules

- Do not expose arbitrary `setStatus`.
- Model business transitions as methods/commands.
- Persist current state for fast access.
- Persist transition event for reconstruction.
- Add optimistic lock to mutable aggregate roots.
- Do not rely on UI to enforce transition legality.

### 15.4 Audit Rules

- Separate technical audit from domain history.
- Snapshot legally relevant data.
- Make history append-only where possible.
- Store actor identity as historical snapshot if needed.
- Correlate with request id / command id.
- Avoid side effects in entity callbacks.

### 15.5 Read Model Rules

- Listing pages should use projection, not aggregate hydration.
- Timeline should query event/history table explicitly.
- Detail pages may be composed from multiple projections.
- Reporting should not force write model compromise.
- Native SQL/view/materialized view is valid for heavy reporting.

---

## 16. Diagnostic Checklist

When reviewing an ORM domain model, ask these questions.

### 16.1 Boundary Questions

- What is the aggregate root?
- Which children are truly owned?
- Which associations cross aggregate boundaries?
- Are cascades limited to owned lifecycle?
- Are collections bounded or unbounded?
- Can this aggregate be loaded safely under production data volume?

### 16.2 Invariant Questions

- Where are state transition rules enforced?
- Can external code bypass them through setters?
- Can invalid intermediate state exist before flush?
- Are cross-aggregate rules handled in application/domain service?
- Are database constraints aligned with domain invariants?

### 16.3 Audit Questions

- Can we reconstruct who did what, when, and why?
- Is current state separate from history?
- Is history mutable by normal cascade/merge?
- Are actor/template/document snapshots stored where required?
- Are external side effects tied to committed transaction via outbox?

### 16.4 Performance Questions

- Does listing hydrate full entities?
- Are large history collections mapped into root graph?
- Are common queries projection-based?
- Does aggregate size cause dirty checking cost?
- Are unrelated updates causing optimistic lock conflicts?

### 16.5 Provider Questions

- Does lazy loading depend on proxies or enhancement?
- Are provider-specific annotations documented?
- Are Hibernate/EclipseLink differences tested?
- Does cache behavior match domain consistency?
- Are native queries bypassing filters/security constraints?

---

## 17. Practice Scenario

### Scenario

You have a `CaseRecord` with:

- 1 header row,
- 200 status events,
- 500 audit rows,
- 60 documents,
- 20 correspondence records,
- 15 tasks,
- 3 decisions,
- 1 assigned officer.

The current design maps all of them as `@OneToMany(cascade = ALL)` from `CaseRecord`.

Listing page shows only:

- case reference,
- status,
- assigned officer,
- risk level,
- last updated date.

Approval action changes:

- latest decision,
- case current status,
- inserts status event,
- inserts audit event,
- creates outbox event.

### Problems to Identify

- Listing should not load full aggregate.
- Audit/status history should not be cascade-owned mutable collection.
- Document/correspondence/task likely separate aggregates.
- Approval is cross-aggregate transaction.
- Case and decision need optimistic locking.
- Status event/audit event should be append-only.
- Outbox event should be committed atomically.
- Assigned officer should not cascade.

### Improved Model

```text
CaseRecord
 - current status
 - risk
 - reference
 - assigned officer id/reference
 - version

Decision
 - case id
 - recommendation
 - approver
 - version

CaseStatusEvent
 - case id
 - from/to status
 - actor snapshot
 - reason
 - occurred at

CaseAuditEvent
 - case id
 - event type
 - payload/snapshot
 - request id

OutboxEvent
 - aggregate id
 - event type
 - payload
 - status

DocumentMetadata
 - case id
 - current version metadata

Correspondence
 - case id
 - template snapshot
 - send status

Task
 - case id
 - assignment/status/due date
```

---

## 18. Capstone Mini-Design: Approval Transition

### 18.1 Command DTO

```java
public final class ApproveCaseCommand {
    private final Long caseId;
    private final Long decisionId;
    private final String reason;
    private final String commandId;

    public ApproveCaseCommand(Long caseId, Long decisionId, String reason, String commandId) {
        this.caseId = Objects.requireNonNull(caseId);
        this.decisionId = Objects.requireNonNull(decisionId);
        this.reason = Objects.requireNonNull(reason);
        this.commandId = Objects.requireNonNull(commandId);
    }

    public Long caseId() { return caseId; }
    public Long decisionId() { return decisionId; }
    public String reason() { return reason; }
    public String commandId() { return commandId; }
}
```

### 18.2 Application Service

```java
@Transactional
public void approve(ApproveCaseCommand command, UserContext user) {
    if (deduplicationRepository.exists(command.commandId())) {
        return;
    }

    CaseRecord caseRecord = caseRepository.get(command.caseId());
    Decision decision = decisionRepository.get(command.decisionId());

    approvalPolicy.validate(caseRecord, decision, user);

    CaseStatus previous = caseRecord.getStatus();
    Instant now = clock.instant();

    decision.approve(user.userId(), command.reason(), now);
    caseRecord.transitionTo(CaseStatus.APPROVED, user.userId(), command.reason(), now);

    statusEventRepository.save(new CaseStatusEvent(
        caseRecord.getId(),
        previous,
        CaseStatus.APPROVED,
        "APPROVE_CASE",
        user.userId(),
        command.reason(),
        now,
        requestContext.requestId()
    ));

    auditRepository.save(CaseAuditEvent.caseApproved(
        caseRecord.getId(),
        user.snapshot(),
        command.reason(),
        now,
        requestContext.requestId()
    ));

    outboxRepository.save(OutboxEvent.caseApproved(caseRecord.getId(), now));

    deduplicationRepository.save(command.commandId(), "CaseRecord", caseRecord.getId(), now);
}
```

### 18.3 Persistence Effects

Expected SQL conceptually:

```sql
select * from case_record where id = ?;
select * from decision where id = ?;

update decision
set status = 'APPROVED', approved_by = ?, approved_at = ?, version = version + 1
where id = ? and version = ?;

update case_record
set status = 'APPROVED', updated_at = ?, version = version + 1
where id = ? and version = ?;

insert into case_status_event (...);
insert into case_audit_event (...);
insert into outbox_event (...);
insert into command_deduplication (...);
```

Failure handling:

- Optimistic lock failure means someone changed case/decision concurrently.
- Unique violation on command id means duplicate command; treat idempotently.
- Outbox event is only visible if transaction commits.
- Email/integration is processed later.

---

## 19. Top 1% Engineer Heuristics

A strong persistence engineer does not ask only:

> What annotation maps this relationship?

They ask:

1. Who owns this lifecycle?
2. What invariant must be protected?
3. How large can this collection become?
4. What changes together transactionally?
5. What should be append-only?
6. What must be historically reconstructable?
7. What is the read model for listing/search/export?
8. What association should not cascade?
9. What update should not conflict with another update?
10. What external side effect must wait until commit?
11. What provider behavior am I relying on?
12. What SQL shape will this produce at production data volume?
13. What happens under retry, duplicate command, or concurrent approval?
14. What will an auditor need to know two years from now?

This is the difference between “using JPA” and engineering a persistence model.

---

## 20. Summary

ORM domain modeling is about aligning object boundaries with business consistency boundaries.

Key lessons:

- ORM entity, domain entity, database table, API DTO, and UI model are not automatically the same.
- Aggregate boundaries determine safe cascade, merge, locking, and loading behavior.
- Workflow should not be reduced to a bare status column.
- Current state and historical events should usually be modeled separately.
- Regulatory systems need reconstructability, actor snapshots, transition reason, request correlation, and append-only history.
- Giant aggregates create performance, concurrency, and correctness failures.
- Read models should often be projections/views, not hydrated entity graphs.
- Entity callbacks are not reliable places for external side effects.
- Optimistic locking belongs on mutable aggregate roots.
- Cross-aggregate references should avoid lifecycle cascade.
- Provider-specific features are powerful but must not compensate for unclear domain boundaries.

The practical mental model:

```text
Use ORM entities for controlled state mutation.
Use projections/views for read performance.
Use append-only event/history tables for defensibility.
Use aggregate boundaries to prevent accidental cascade, merge, loading, and locking failures.
```

---

## 21. References

- Jakarta Persistence 3.2 Specification: https://jakarta.ee/specifications/persistence/3.2/
- Jakarta Persistence specification overview and 4.0 development status: https://jakarta.ee/specifications/persistence/
- Hibernate ORM Documentation: https://hibernate.org/orm/documentation/
- Hibernate ORM User Guide: https://docs.hibernate.org/stable/orm/userguide/html_single/
- EclipseLink Project: https://eclipse.dev/eclipselink/
- EclipseLink JPA Extensions: https://eclipse.dev/eclipselink/documentation/4.0/jpa/extensions/jpa-extensions.html
- EclipseLink Caching Concepts: https://eclipse.dev/eclipselink/documentation/2.7/concepts/cache.htm

---

## 22. Status

This is Part 29 of 34. The series is not finished yet.

Next part:

`30-multi-tenancy-security-filters-row-level-isolation-data-leakage.md`

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 28 — Performance Engineering: Cost Model from Object Graph to Database Work](./28-performance-engineering-cost-model-object-graph-to-database-work.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 30 — Multi-Tenancy, Security, Filters, Row-Level Isolation, and Data Leakage Prevention](./30-multi-tenancy-security-filters-row-level-isolation-data-leakage.md)
