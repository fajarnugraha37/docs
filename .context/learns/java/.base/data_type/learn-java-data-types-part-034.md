# learn-java-data-types-part-034.md

# Java Data Types — Part 034  
# Capstone: Type-Safe Enforcement Case Domain Model

> Seri: **Advanced Java Data Types**  
> Bagian: **034 — FINAL**  
> Fokus: menyatukan seluruh pembelajaran Java Data Types menjadi satu capstone production-style: membangun model domain `Enforcement Case` yang type-safe, valid, serializable, persistence-aware, API-aware, secure, testable, dan siap direview seperti desain software engineer senior/top-tier.

---

## Daftar Isi

1. [Tujuan Capstone](#1-tujuan-capstone)
2. [Problem Domain: Enforcement Case](#2-problem-domain-enforcement-case)
3. [Design Goal](#3-design-goal)
4. [Domain Boundaries](#4-domain-boundaries)
5. [High-Level Type Map](#5-high-level-type-map)
6. [Core ID Types](#6-core-id-types)
7. [Tenant and Security Context](#7-tenant-and-security-context)
8. [Typed Reference: Tenant-Scoped Case](#8-typed-reference-tenant-scoped-case)
9. [Officer, Agency, and Actor Types](#9-officer-agency-and-actor-types)
10. [Text Types: Reason, Remarks, Title](#10-text-types-reason-remarks-title)
11. [Attachment and Document Types](#11-attachment-and-document-types)
12. [Date/Time Types](#12-datetime-types)
13. [Version and Optimistic Locking](#13-version-and-optimistic-locking)
14. [Money and Penalty Types](#14-money-and-penalty-types)
15. [Violation Types](#15-violation-types)
16. [Case State as Sealed Type](#16-case-state-as-sealed-type)
17. [Case Aggregate](#17-case-aggregate)
18. [Command Types](#18-command-types)
19. [Event Types](#19-event-types)
20. [Error Algebra](#20-error-algebra)
21. [Result Type](#21-result-type)
22. [Validation Pipeline](#22-validation-pipeline)
23. [Authorization and Capability Types](#23-authorization-and-capability-types)
24. [Repository Port](#24-repository-port)
25. [Application Service](#25-application-service)
26. [API DTO Mapping](#26-api-dto-mapping)
27. [API Error Mapping](#27-api-error-mapping)
28. [Database Mapping](#28-database-mapping)
29. [Event Serialization Mapping](#29-event-serialization-mapping)
30. [Cache Snapshot Mapping](#30-cache-snapshot-mapping)
31. [Concurrency and JMM Design](#31-concurrency-and-jmm-design)
32. [Security Review](#32-security-review)
33. [Performance and Memory Review](#33-performance-and-memory-review)
34. [Testing Strategy](#34-testing-strategy)
35. [Example End-to-End Flow: Close Case](#35-example-end-to-end-flow-close-case)
36. [Example End-to-End Flow: Reject Case](#36-example-end-to-end-flow-reject-case)
37. [What This Capstone Demonstrates](#37-what-this-capstone-demonstrates)
38. [Common Trade-Offs](#38-common-trade-offs)
39. [Production Readiness Checklist](#39-production-readiness-checklist)
40. [Final Summary of the Entire Series](#40-final-summary-of-the-entire-series)

---

# 1. Tujuan Capstone

Capstone ini menyatukan semua materi:

- primitive vs domain type;
- `String` vs typed value;
- enum vs sealed type;
- record vs class;
- immutability;
- validation;
- API contract;
- DB mapping;
- event serialization;
- security;
- concurrency;
- error modeling;
- production readiness.

Kita akan membangun model domain untuk:

```text
Enforcement Case
```

Target bukan membuat full aplikasi, tetapi membuat **core type model** yang bisa menjadi fondasi production-grade.

---

# 2. Problem Domain: Enforcement Case

Kita punya sistem enforcement case.

Sebuah case dapat:

1. dibuat sebagai draft;
2. disubmit;
3. diassign ke officer;
4. direview;
5. direject;
6. diapprove;
7. diclose;
8. diarchive.

Case memiliki:

- tenant/agency;
- case ID;
- subject;
- violation list;
- attachments;
- assigned officer;
- state;
- expected version;
- audit timestamps;
- remarks/reasons;
- optional penalty.

Domain risk:

- case lintas tenant tidak boleh bocor;
- closed case wajib punya closedAt/closedBy/reason;
- rejected case wajib punya rejection reason;
- amount penalty wajib punya currency;
- event tidak boleh mengandung secret;
- API PATCH harus jelas missing/null semantics;
- optimistic locking harus mencegah lost update;
- IDs tidak boleh tertukar;
- status tidak boleh string liar.

---

# 3. Design Goal

Goal utama:

```text
Make invalid states hard to express.
Make important meanings visible in type signatures.
Keep boundary representations explicit.
Keep domain model independent from API/DB/event details.
```

## 3.1 Non-goals

Kita tidak membuat:

- full Spring Boot implementation;
- full JPA entity;
- full database migration;
- full controller;
- full event bus.

Yang kita buat:

- domain type model;
- command/event/error/result;
- mapping sketch;
- review checklist;
- production reasoning.

## 3.2 Style

Kita gunakan Java modern:

- records untuk value objects;
- sealed interfaces untuk state/error/event;
- enums untuk closed constants;
- immutable collections;
- `Instant`, `LocalDate`;
- explicit `Clock`;
- typed IDs;
- explicit DTO mapping.

---

# 4. Domain Boundaries

Kita pisahkan model:

```text
API DTO
  raw JSON boundary

Application Command
  validated use-case input

Domain Aggregate
  business invariant and transitions

Domain Event
  fact produced by domain

Persistence Entity
  database shape

Event DTO
  serialized message shape

Read Model / Snapshot
  immutable query/cache/API view
```

## 4.1 Why separate?

Karena kebutuhan berbeda.

API DTO butuh:

- raw validation;
- stable contract;
- JSON-friendly shape.

Domain aggregate butuh:

- invariants;
- methods;
- behavior;
- state transitions.

DB entity butuh:

- ORM mapping;
- columns;
- mutability/proxy maybe.

Event DTO butuh:

- compatibility;
- schema version;
- consumer stability.

## 4.2 Rule

Satu type boleh dipakai di banyak layer hanya jika contract-nya memang sama dan risikonya rendah.

---

# 5. High-Level Type Map

```text
IDs:
  TenantId, CaseId, OfficerId, AgencyId, EventId, AttachmentId

Security:
  AuthenticatedPrincipal, Scope, Capability

References:
  TenantScoped<T>, TenantCaseRef

Text:
  CaseTitle, ClosureReason, RejectionReason, OfficerRemark

Time:
  CreatedAt, UpdatedAt, SubmittedAt, ClosedAt, OccurredAt

Money:
  Money, PenaltyAmount

Version:
  Version, ExpectedVersion

State:
  Draft, Submitted, Assigned, UnderReview, Approved, Rejected, Closed, Archived

Command:
  SubmitCaseCommand, AssignCaseCommand, RejectCaseCommand, CloseCaseCommand

Event:
  CaseSubmitted, CaseAssigned, CaseRejected, CaseClosed

Error:
  CaseNotFound, VersionConflict, InvalidTransition, Unauthorized, ValidationFailed

Result:
  Result<T,E>

Aggregate:
  EnforcementCase

Snapshot:
  EnforcementCaseSnapshot
```

---

# 6. Core ID Types

## 6.1 CaseId

```java
public record CaseId(String value) {
    private static final Pattern PATTERN = Pattern.compile("^CASE-[0-9]{8}$");

    public CaseId {
        Objects.requireNonNull(value, "value");
        value = value.strip().toUpperCase(Locale.ROOT);

        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid case id");
        }
    }
}
```

## 6.2 OfficerId

```java
public record OfficerId(String value) {
    private static final Pattern PATTERN = Pattern.compile("^OFF-[A-Z0-9]{6,20}$");

    public OfficerId {
        Objects.requireNonNull(value, "value");
        value = value.strip().toUpperCase(Locale.ROOT);

        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid officer id");
        }
    }
}
```

## 6.3 TenantId

```java
public record TenantId(String value) {
    private static final Pattern PATTERN = Pattern.compile("^[A-Z0-9_]{3,32}$");

    public TenantId {
        Objects.requireNonNull(value, "value");
        value = value.strip().toUpperCase(Locale.ROOT);

        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid tenant id");
        }
    }
}
```

## 6.4 EventId

```java
public record EventId(UUID value) {
    public EventId {
        Objects.requireNonNull(value, "value");
    }

    public static EventId newId() {
        return new EventId(UUID.randomUUID());
    }
}
```

## 6.5 Why typed IDs?

Without typed IDs:

```java
assign(caseId, officerId)
assign(officerId, caseId) // compile if String
```

With typed IDs, swap becomes compile error.

---

# 7. Tenant and Security Context

## 7.1 Scope

```java
public enum Scope {
    CASE_READ,
    CASE_SUBMIT,
    CASE_ASSIGN,
    CASE_REJECT,
    CASE_CLOSE,
    CASE_ARCHIVE
}
```

## 7.2 AuthenticatedPrincipal

```java
public record AuthenticatedPrincipal(
    OfficerId officerId,
    TenantId tenantId,
    Set<Scope> scopes
) {
    public AuthenticatedPrincipal {
        Objects.requireNonNull(officerId, "officerId");
        Objects.requireNonNull(tenantId, "tenantId");
        scopes = Set.copyOf(scopes);
    }

    public boolean hasScope(Scope scope) {
        return scopes.contains(scope);
    }
}
```

## 7.3 Security principle

Request DTO should not provide trusted actor ID/tenant ID if authentication already has it.

Bad:

```json
{
  "actorId": "OFF-ABC123",
  "tenantId": "CEA"
}
```

Better:

- actor/tenant from authenticated principal;
- request only carries operation-specific data.

---

# 8. Typed Reference: Tenant-Scoped Case

## 8.1 Generic form

```java
public record TenantScoped<T>(TenantId tenantId, T value) {
    public TenantScoped {
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(value, "value");
    }
}
```

## 8.2 Concrete alias style

Java does not have type aliases, so concrete type often clearer:

```java
public record TenantCaseRef(TenantId tenantId, CaseId caseId) {
    public TenantCaseRef {
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(caseId, "caseId");
    }
}
```

## 8.3 Repository should require tenant

```java
Optional<EnforcementCase> findByRef(TenantCaseRef ref);
```

Not:

```java
Optional<EnforcementCase> findById(CaseId id);
```

## 8.4 Security value

This type prevents many IDOR/cache-key mistakes.

---

# 9. Officer, Agency, and Actor Types

## 9.1 AgencyId

```java
public record AgencyId(String value) {
    public AgencyId {
        Objects.requireNonNull(value, "value");
        value = value.strip().toUpperCase(Locale.ROOT);
        if (value.length() < 2 || value.length() > 32) {
            throw new IllegalArgumentException("Invalid agency id");
        }
    }
}
```

## 9.2 Actor

System may perform actions too.

```java
public sealed interface Actor permits OfficerActor, SystemActor {
}

public record OfficerActor(OfficerId officerId) implements Actor {
    public OfficerActor {
        Objects.requireNonNull(officerId, "officerId");
    }
}

public record SystemActor(String name) implements Actor {
    public SystemActor {
        Objects.requireNonNull(name, "name");
        if (name.isBlank()) {
            throw new IllegalArgumentException("System actor name required");
        }
    }
}
```

## 9.3 Why not String actor?

Audit/security logic needs structured actor identity.

---

# 10. Text Types: Reason, Remarks, Title

## 10.1 CaseTitle

```java
public record CaseTitle(String value) {
    public CaseTitle {
        Objects.requireNonNull(value, "value");
        value = value.strip();

        if (value.length() < 5 || value.length() > 200) {
            throw new IllegalArgumentException("Case title length invalid");
        }
    }
}
```

## 10.2 ClosureReason

```java
public record ClosureReason(String value) {
    public ClosureReason {
        Objects.requireNonNull(value, "value");
        value = value.strip();

        if (value.length() < 10 || value.length() > 2_000) {
            throw new IllegalArgumentException("Closure reason length invalid");
        }
    }

    @Override
    public String toString() {
        return "ClosureReason[length=" + value.length() + "]";
    }
}
```

## 10.3 RejectionReason

```java
public record RejectionReason(String value) {
    public RejectionReason {
        Objects.requireNonNull(value, "value");
        value = value.strip();

        if (value.length() < 10 || value.length() > 2_000) {
            throw new IllegalArgumentException("Rejection reason length invalid");
        }
    }

    @Override
    public String toString() {
        return "RejectionReason[length=" + value.length() + "]";
    }
}
```

## 10.4 Why safe toString?

Reasons may contain sensitive text/PII. Avoid full value in logs.

---

# 11. Attachment and Document Types

## 11.1 AttachmentId

```java
public record AttachmentId(UUID value) {
    public AttachmentId {
        Objects.requireNonNull(value, "value");
    }
}
```

## 11.2 SafeFileName

```java
public record SafeFileName(String value) {
    private static final Pattern PATTERN =
        Pattern.compile("^[A-Za-z0-9._-]{1,150}$");

    public SafeFileName {
        Objects.requireNonNull(value, "value");
        value = value.strip();

        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid file name");
        }
        if (value.equals(".") || value.equals("..")) {
            throw new IllegalArgumentException("Invalid file name");
        }
    }
}
```

## 11.3 AttachmentRef

```java
public record AttachmentRef(
    AttachmentId attachmentId,
    SafeFileName fileName,
    String contentType
) {
    public AttachmentRef {
        Objects.requireNonNull(attachmentId, "attachmentId");
        Objects.requireNonNull(fileName, "fileName");
        Objects.requireNonNull(contentType, "contentType");

        if (contentType.isBlank() || contentType.length() > 100) {
            throw new IllegalArgumentException("Invalid content type");
        }
    }
}
```

## 11.4 Path traversal prevention

Domain uses safe file name or attachment ID. It does not accept raw filesystem path.

---

# 12. Date/Time Types

## 12.1 CreatedAt

For most use, `Instant` directly is fine. But important concepts can be wrapped.

```java
public record CreatedAt(Instant value) {
    public CreatedAt {
        Objects.requireNonNull(value, "value");
    }
}
```

## 12.2 OccurredAt

```java
public record OccurredAt(Instant value) {
    public OccurredAt {
        Objects.requireNonNull(value, "value");
    }

    public static OccurredAt now(Clock clock) {
        return new OccurredAt(clock.instant());
    }
}
```

## 12.3 BusinessDate

```java
public record BusinessDate(LocalDate value) {
    public BusinessDate {
        Objects.requireNonNull(value, "value");
    }
}
```

## 12.4 Guideline

Use:

- `Instant` for audit/event/security timeline;
- `LocalDate` for business date;
- `LocalDateTime + ZoneId` for scheduled local human time.

---

# 13. Version and Optimistic Locking

## 13.1 Version

```java
public record Version(long value) implements Comparable<Version> {
    public Version {
        if (value < 0) {
            throw new IllegalArgumentException("Version must be non-negative");
        }
    }

    public Version next() {
        return new Version(Math.addExact(value, 1));
    }

    @Override
    public int compareTo(Version other) {
        return Long.compare(value, other.value);
    }
}
```

## 13.2 ExpectedVersion

```java
public record ExpectedVersion(Version value) {
    public ExpectedVersion {
        Objects.requireNonNull(value, "value");
    }
}
```

## 13.3 Why separate?

Actual current version and expected version have different meanings.

Method signature becomes clearer:

```java
close(command.expectedVersion())
```

---

# 14. Money and Penalty Types

## 14.1 Money

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount, "amount");
        Objects.requireNonNull(currency, "currency");

        int scale = currency.getDefaultFractionDigits();
        if (scale < 0) {
            throw new IllegalArgumentException("Currency has no default fraction digits");
        }

        amount = amount.setScale(scale, RoundingMode.UNNECESSARY);
    }

    public Money add(Money other) {
        requireSameCurrency(other);
        return new Money(amount.add(other.amount), currency);
    }

    private void requireSameCurrency(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("Currency mismatch");
        }
    }
}
```

## 14.2 PenaltyAmount

```java
public record PenaltyAmount(Money value) {
    public PenaltyAmount {
        Objects.requireNonNull(value, "value");
        if (value.amount().signum() < 0) {
            throw new IllegalArgumentException("Penalty cannot be negative");
        }
    }
}
```

## 14.3 Why not BigDecimal only?

Penalty without currency is ambiguous.

---

# 15. Violation Types

## 15.1 ViolationCode

```java
public record ViolationCode(String value) {
    private static final Pattern PATTERN = Pattern.compile("^[A-Z0-9_]{3,64}$");

    public ViolationCode {
        Objects.requireNonNull(value, "value");
        value = value.strip().toUpperCase(Locale.ROOT);
        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid violation code");
        }
    }
}
```

## 15.2 Violation

```java
public record Violation(
    ViolationCode code,
    String description,
    Optional<PenaltyAmount> proposedPenalty
) {
    public Violation {
        Objects.requireNonNull(code, "code");
        Objects.requireNonNull(description, "description");
        Objects.requireNonNull(proposedPenalty, "proposedPenalty");

        description = description.strip();
        if (description.isBlank() || description.length() > 1_000) {
            throw new IllegalArgumentException("Invalid violation description");
        }
    }
}
```

## 15.3 Optional note

Using Optional as record component can be debated. For pure domain value, this may be acceptable if team convention allows, but for DTO/persistence avoid Optional fields. Alternative:

```java
PenaltyAmount proposedPenalty // nullable only in persistence layer
```

or sealed variant.

---

# 16. Case State as Sealed Type

This is core.

## 16.1 State hierarchy

```java
public sealed interface CaseState
    permits Draft, Submitted, Assigned, UnderReview, Approved, Rejected, Closed, Archived {
}

public record Draft() implements CaseState {
}

public record Submitted(
    Instant submittedAt,
    OfficerId submittedBy
) implements CaseState {
    public Submitted {
        Objects.requireNonNull(submittedAt, "submittedAt");
        Objects.requireNonNull(submittedBy, "submittedBy");
    }
}

public record Assigned(
    Instant assignedAt,
    OfficerId assignedBy,
    OfficerId assignedTo
) implements CaseState {
    public Assigned {
        Objects.requireNonNull(assignedAt, "assignedAt");
        Objects.requireNonNull(assignedBy, "assignedBy");
        Objects.requireNonNull(assignedTo, "assignedTo");
    }
}

public record UnderReview(
    Instant reviewStartedAt,
    OfficerId reviewer
) implements CaseState {
    public UnderReview {
        Objects.requireNonNull(reviewStartedAt, "reviewStartedAt");
        Objects.requireNonNull(reviewer, "reviewer");
    }
}

public record Approved(
    Instant approvedAt,
    OfficerId approvedBy
) implements CaseState {
    public Approved {
        Objects.requireNonNull(approvedAt, "approvedAt");
        Objects.requireNonNull(approvedBy, "approvedBy");
    }
}

public record Rejected(
    Instant rejectedAt,
    OfficerId rejectedBy,
    RejectionReason reason
) implements CaseState {
    public Rejected {
        Objects.requireNonNull(rejectedAt, "rejectedAt");
        Objects.requireNonNull(rejectedBy, "rejectedBy");
        Objects.requireNonNull(reason, "reason");
    }
}

public record Closed(
    Instant closedAt,
    OfficerId closedBy,
    ClosureReason reason
) implements CaseState {
    public Closed {
        Objects.requireNonNull(closedAt, "closedAt");
        Objects.requireNonNull(closedBy, "closedBy");
        Objects.requireNonNull(reason, "reason");
    }
}

public record Archived(
    Instant archivedAt,
    OfficerId archivedBy
) implements CaseState {
    public Archived {
        Objects.requireNonNull(archivedAt, "archivedAt");
        Objects.requireNonNull(archivedBy, "archivedBy");
    }
}
```

## 16.2 Why sealed state?

It prevents invalid combinations like:

```text
status=CLOSED but closedAt=null
status=REJECTED but rejectionReason=null
```

## 16.3 API/DB mapping

External representation still needs stable discriminator:

```json
{
  "state": {
    "type": "CLOSED",
    "closedAt": "2026-06-12T03:15:30Z",
    "closedBy": "OFF-ABC123",
    "reason": "..."
  }
}
```

---

# 17. Case Aggregate

## 17.1 Aggregate skeleton

```java
public final class EnforcementCase {
    private final TenantCaseRef ref;
    private final CaseTitle title;
    private final CreatedAt createdAt;
    private Version version;
    private CaseState state;
    private List<Violation> violations;
    private List<AttachmentRef> attachments;

    public EnforcementCase(
        TenantCaseRef ref,
        CaseTitle title,
        CreatedAt createdAt,
        Version version,
        CaseState state,
        List<Violation> violations,
        List<AttachmentRef> attachments
    ) {
        this.ref = Objects.requireNonNull(ref, "ref");
        this.title = Objects.requireNonNull(title, "title");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
        this.version = Objects.requireNonNull(version, "version");
        this.state = Objects.requireNonNull(state, "state");
        this.violations = List.copyOf(violations);
        this.attachments = List.copyOf(attachments);
    }

    public TenantCaseRef ref() {
        return ref;
    }

    public Version version() {
        return version;
    }

    public CaseState state() {
        return state;
    }

    public EnforcementCaseSnapshot snapshot(Instant capturedAt) {
        return new EnforcementCaseSnapshot(
            ref,
            title,
            state,
            version,
            violations,
            attachments,
            capturedAt
        );
    }
}
```

## 17.2 Mutability policy

Aggregate is mutable internally, but:

- fields are private;
- mutation occurs through methods;
- external snapshots are immutable;
- collections are copied.

## 17.3 Alternative

Fully immutable aggregate returning new instance per transition. More functional, but more allocation/mapping.

---

# 18. Command Types

## 18.1 Command marker

```java
public sealed interface CaseCommand
    permits SubmitCaseCommand, AssignCaseCommand, RejectCaseCommand, CloseCaseCommand {
    TenantCaseRef caseRef();
    OfficerId actorId();
    ExpectedVersion expectedVersion();
}
```

## 18.2 Submit

```java
public record SubmitCaseCommand(
    TenantCaseRef caseRef,
    OfficerId actorId,
    ExpectedVersion expectedVersion
) implements CaseCommand {
    public SubmitCaseCommand {
        Objects.requireNonNull(caseRef);
        Objects.requireNonNull(actorId);
        Objects.requireNonNull(expectedVersion);
    }
}
```

## 18.3 Assign

```java
public record AssignCaseCommand(
    TenantCaseRef caseRef,
    OfficerId actorId,
    OfficerId assignedTo,
    ExpectedVersion expectedVersion
) implements CaseCommand {
    public AssignCaseCommand {
        Objects.requireNonNull(caseRef);
        Objects.requireNonNull(actorId);
        Objects.requireNonNull(assignedTo);
        Objects.requireNonNull(expectedVersion);
    }
}
```

## 18.4 Reject

```java
public record RejectCaseCommand(
    TenantCaseRef caseRef,
    OfficerId actorId,
    RejectionReason reason,
    ExpectedVersion expectedVersion
) implements CaseCommand {
    public RejectCaseCommand {
        Objects.requireNonNull(caseRef);
        Objects.requireNonNull(actorId);
        Objects.requireNonNull(reason);
        Objects.requireNonNull(expectedVersion);
    }
}
```

## 18.5 Close

```java
public record CloseCaseCommand(
    TenantCaseRef caseRef,
    OfficerId actorId,
    ClosureReason reason,
    ExpectedVersion expectedVersion
) implements CaseCommand {
    public CloseCaseCommand {
        Objects.requireNonNull(caseRef);
        Objects.requireNonNull(actorId);
        Objects.requireNonNull(reason);
        Objects.requireNonNull(expectedVersion);
    }
}
```

## 18.6 Why command type?

Command carries intent, not raw request shape.

---

# 19. Event Types

## 19.1 Event marker

```java
public sealed interface CaseEvent
    permits CaseSubmitted, CaseAssigned, CaseRejected, CaseClosed {
    EventId eventId();
    TenantCaseRef caseRef();
    Version newVersion();
    Instant occurredAt();
}
```

## 19.2 CaseClosed

```java
public record CaseClosed(
    EventId eventId,
    TenantCaseRef caseRef,
    OfficerId closedBy,
    ClosureReason reason,
    Version newVersion,
    Instant occurredAt
) implements CaseEvent {
    public CaseClosed {
        Objects.requireNonNull(eventId);
        Objects.requireNonNull(caseRef);
        Objects.requireNonNull(closedBy);
        Objects.requireNonNull(reason);
        Objects.requireNonNull(newVersion);
        Objects.requireNonNull(occurredAt);
    }
}
```

## 19.3 Other events

```java
public record CaseSubmitted(
    EventId eventId,
    TenantCaseRef caseRef,
    OfficerId submittedBy,
    Version newVersion,
    Instant occurredAt
) implements CaseEvent { }

public record CaseAssigned(
    EventId eventId,
    TenantCaseRef caseRef,
    OfficerId assignedBy,
    OfficerId assignedTo,
    Version newVersion,
    Instant occurredAt
) implements CaseEvent { }

public record CaseRejected(
    EventId eventId,
    TenantCaseRef caseRef,
    OfficerId rejectedBy,
    RejectionReason reason,
    Version newVersion,
    Instant occurredAt
) implements CaseEvent { }
```

## 19.4 Event rule

Event is immutable fact. Do not reuse command as event.

---

# 20. Error Algebra

## 20.1 Error hierarchy

```java
public sealed interface CaseError
    permits CaseNotFound, VersionConflict, InvalidTransition, Unauthorized, ValidationFailed {
}

public record CaseNotFound(TenantCaseRef caseRef) implements CaseError {
}

public record VersionConflict(
    TenantCaseRef caseRef,
    Version expected,
    Version actual
) implements CaseError {
}

public record InvalidTransition(
    TenantCaseRef caseRef,
    String fromState,
    String attemptedAction
) implements CaseError {
}

public record Unauthorized(
    TenantCaseRef caseRef,
    OfficerId actorId,
    Scope requiredScope
) implements CaseError {
}

public record ValidationFailed(
    List<FieldError> errors
) implements CaseError {
    public ValidationFailed {
        errors = List.copyOf(errors);
    }
}
```

## 20.2 Why typed error?

Caller can handle:

- 404;
- 409;
- 403;
- 400;
- DLQ;
- retry/no retry.

without parsing string.

---

# 21. Result Type

## 21.1 Generic result

```java
public sealed interface Result<T, E> permits Ok, Err {
}

public record Ok<T, E>(T value) implements Result<T, E> {
    public Ok {
        Objects.requireNonNull(value);
    }
}

public record Err<T, E>(E error) implements Result<T, E> {
    public Err {
        Objects.requireNonNull(error);
    }
}
```

## 21.2 Use

```java
Result<CaseClosed, CaseError> close(CloseCaseCommand command)
```

## 21.3 When not to use

Unexpected infrastructure failure can still be exception:

- DB down;
- network timeout;
- bug;
- interrupted thread.

Result for expected domain outcomes.

---

# 22. Validation Pipeline

## 22.1 Raw request

```java
public record CloseCaseRequest(
    String reason,
    Long expectedVersion
) {}
```

Path:

```text
/{tenantId}/cases/{caseId}/close
```

Principal supplies actor.

## 22.2 Validation result

```java
public record FieldError(String field, String code, String message) {}
```

## 22.3 Mapper

```java
ValidationResult<CloseCaseCommand> toCommand(
    String rawTenantId,
    String rawCaseId,
    CloseCaseRequest request,
    AuthenticatedPrincipal principal
) {
    List<FieldError> errors = new ArrayList<>();

    if (request.reason() == null || request.reason().isBlank()) {
        errors.add(new FieldError("reason", "REQUIRED", "reason is required"));
    }
    if (request.expectedVersion() == null) {
        errors.add(new FieldError("expectedVersion", "REQUIRED", "expectedVersion is required"));
    }

    if (!errors.isEmpty()) {
        return new Invalid<>(errors);
    }

    try {
        TenantId tenantId = new TenantId(rawTenantId);
        CaseId caseId = new CaseId(rawCaseId);
        ClosureReason reason = new ClosureReason(request.reason());
        ExpectedVersion expectedVersion =
            new ExpectedVersion(new Version(request.expectedVersion()));

        TenantCaseRef caseRef = new TenantCaseRef(tenantId, caseId);

        return new Valid<>(
            new CloseCaseCommand(caseRef, principal.officerId(), reason, expectedVersion)
        );
    } catch (IllegalArgumentException ex) {
        return new Invalid<>(List.of(
            new FieldError("request", "INVALID_VALUE", "Request contains invalid values")
        ));
    }
}
```

## 22.4 ValidationResult type

```java
public sealed interface ValidationResult<T> permits Valid, Invalid {
}

public record Valid<T>(T value) implements ValidationResult<T> {
}

public record Invalid<T>(List<FieldError> errors) implements ValidationResult<T> {
    public Invalid {
        errors = List.copyOf(errors);
    }
}
```

## 22.5 Why not throw immediately?

Boundary should return structured validation errors.

Domain constructors still protect invariants.

---

# 23. Authorization and Capability Types

## 23.1 Authorization service

```java
public final class CaseAuthorizationService {
    public Result<CanCloseCase, CaseError> requireCanClose(
        AuthenticatedPrincipal principal,
        TenantCaseRef caseRef
    ) {
        if (!principal.tenantId().equals(caseRef.tenantId())) {
            return new Err<>(new Unauthorized(caseRef, principal.officerId(), Scope.CASE_CLOSE));
        }
        if (!principal.hasScope(Scope.CASE_CLOSE)) {
            return new Err<>(new Unauthorized(caseRef, principal.officerId(), Scope.CASE_CLOSE));
        }
        return new Ok<>(new CanCloseCase(principal.officerId(), caseRef));
    }
}
```

## 23.2 Capability

```java
public record CanCloseCase(
    OfficerId actorId,
    TenantCaseRef caseRef
) {
    public CanCloseCase {
        Objects.requireNonNull(actorId);
        Objects.requireNonNull(caseRef);
    }
}
```

## 23.3 Use

Domain/app service can require capability instead of raw principal for sensitive operation.

## 23.4 Trade-off

Capability types are advanced. Use where authorization mistakes are high-risk.

---

# 24. Repository Port

## 24.1 Domain-facing repository

```java
public interface EnforcementCaseRepository {
    Optional<EnforcementCase> findByRef(TenantCaseRef ref);

    void save(EnforcementCase enforcementCase, ExpectedVersion expectedVersion)
        throws OptimisticLockFailure;
}
```

## 24.2 Why expected version in save?

Optimistic lock is persistence concern, but domain command carries expected version.

## 24.3 Avoid unsafe method

Do not expose:

```java
findByCaseId(CaseId id)
```

in multi-tenant system.

## 24.4 Persistence exception

```java
public final class OptimisticLockFailure extends RuntimeException {
}
```

Application maps to `VersionConflict`.

---

# 25. Application Service

## 25.1 Close use case

```java
public final class CloseCaseUseCase {
    private final EnforcementCaseRepository repository;
    private final CaseAuthorizationService authorization;
    private final Clock clock;

    public Result<CaseClosed, CaseError> handle(
        CloseCaseCommand command,
        AuthenticatedPrincipal principal
    ) {
        Result<CanCloseCase, CaseError> auth =
            authorization.requireCanClose(principal, command.caseRef());

        if (auth instanceof Err<CanCloseCase, CaseError> err) {
            return new Err<>(err.error());
        }

        EnforcementCase enforcementCase = repository.findByRef(command.caseRef())
            .orElse(null);

        if (enforcementCase == null) {
            return new Err<>(new CaseNotFound(command.caseRef()));
        }

        if (!enforcementCase.version().equals(command.expectedVersion().value())) {
            return new Err<>(new VersionConflict(
                command.caseRef(),
                command.expectedVersion().value(),
                enforcementCase.version()
            ));
        }

        return close(enforcementCase, command);
    }

    private Result<CaseClosed, CaseError> close(
        EnforcementCase enforcementCase,
        CloseCaseCommand command
    ) {
        // transition method shown conceptually
        Instant now = clock.instant();

        // actual aggregate method should enforce transition
        return enforcementCase.close(command.actorId(), command.reason(), now)
            .map(event -> {
                repository.save(enforcementCase, command.expectedVersion());
                return event;
            });
    }
}
```

## 25.2 Note

The `.map` method is not defined in minimal Result above. In real implementation, either add helper methods or use switch.

## 25.3 Aggregate transition sketch

```java
public Result<CaseClosed, CaseError> close(
    OfficerId actorId,
    ClosureReason reason,
    Instant now
) {
    if (state instanceof Closed || state instanceof Archived) {
        return new Err<>(new InvalidTransition(
            ref,
            state.getClass().getSimpleName(),
            "CLOSE"
        ));
    }

    Version newVersion = version.next();
    this.state = new Closed(now, actorId, reason);
    this.version = newVersion;

    return new Ok<>(new CaseClosed(
        EventId.newId(),
        ref,
        actorId,
        reason,
        newVersion,
        now
    ));
}
```

## 25.4 Design note

Application handles orchestration. Aggregate handles domain transition.

---

# 26. API DTO Mapping

## 26.1 Request DTO

```java
public record CloseCaseRequestDto(
    String reason,
    Long expectedVersion
) {}
```

## 26.2 Response DTO

```java
public record CaseClosedResponseDto(
    String caseId,
    String tenantId,
    long version,
    String closedAt
) {}
```

## 26.3 Mapper

```java
CaseClosedResponseDto toDto(CaseClosed event) {
    return new CaseClosedResponseDto(
        event.caseRef().caseId().value(),
        event.caseRef().tenantId().value(),
        event.newVersion().value(),
        event.occurredAt().toString()
    );
}
```

## 26.4 API contract note

For public API, `version` may be number if safely within range, but if JS/client precision concern exists, use string.

## 26.5 Do not expose domain object directly

Do not return `EnforcementCase` or JPA entity.

---

# 27. API Error Mapping

## 27.1 ProblemDetails DTO

```java
public record ProblemDetails(
    String type,
    String title,
    int status,
    String detail,
    String instance,
    List<FieldError> errors
) {
    public ProblemDetails {
        errors = errors == null ? List.of() : List.copyOf(errors);
    }
}
```

## 27.2 Mapper

```java
ProblemDetails toProblem(CaseError error, String instance) {
    return switch (error) {
        case CaseNotFound e -> new ProblemDetails(
            "https://api.example.com/problems/case-not-found",
            "Case not found",
            404,
            "Case could not be found",
            instance,
            List.of()
        );

        case VersionConflict e -> new ProblemDetails(
            "https://api.example.com/problems/version-conflict",
            "Version conflict",
            409,
            "Case has been modified by another transaction",
            instance,
            List.of()
        );

        case Unauthorized e -> new ProblemDetails(
            "https://api.example.com/problems/forbidden",
            "Forbidden",
            403,
            "You are not allowed to perform this action",
            instance,
            List.of()
        );

        case InvalidTransition e -> new ProblemDetails(
            "https://api.example.com/problems/invalid-transition",
            "Invalid case transition",
            409,
            "The requested transition is not allowed from current state",
            instance,
            List.of()
        );

        case ValidationFailed e -> new ProblemDetails(
            "https://api.example.com/problems/validation-error",
            "Validation failed",
            400,
            "Request contains invalid fields",
            instance,
            e.errors()
        );
    };
}
```

## 27.3 Security

Do not leak:

- internal class names;
- SQL errors;
- stack traces;
- secret values;
- unauthorized resource existence if policy forbids.

---

# 28. Database Mapping

## 28.1 Suggested table

```sql
CREATE TABLE enforcement_case (
    tenant_id       VARCHAR(32)  NOT NULL,
    case_id         VARCHAR(20)  NOT NULL,
    title           VARCHAR(200) NOT NULL,

    state_code      VARCHAR(32)  NOT NULL,

    submitted_at    TIMESTAMP    NULL,
    submitted_by    VARCHAR(32)  NULL,

    assigned_at     TIMESTAMP    NULL,
    assigned_by     VARCHAR(32)  NULL,
    assigned_to     VARCHAR(32)  NULL,

    closed_at       TIMESTAMP    NULL,
    closed_by       VARCHAR(32)  NULL,
    closure_reason  TEXT         NULL,

    rejected_at     TIMESTAMP    NULL,
    rejected_by     VARCHAR(32)  NULL,
    rejection_reason TEXT        NULL,

    version         BIGINT       NOT NULL,
    created_at      TIMESTAMP    NOT NULL,
    updated_at      TIMESTAMP    NOT NULL,

    PRIMARY KEY (tenant_id, case_id),

    CHECK (version >= 0)
);
```

## 28.2 State constraints

DB constraints can enforce state-specific fields.

Example concept:

```sql
CHECK (
  state_code <> 'CLOSED'
  OR (closed_at IS NOT NULL AND closed_by IS NOT NULL AND closure_reason IS NOT NULL)
)
```

## 28.3 Money/penalty table

```sql
CREATE TABLE case_violation (
    tenant_id      VARCHAR(32) NOT NULL,
    case_id        VARCHAR(20) NOT NULL,
    violation_code VARCHAR(64) NOT NULL,
    description    VARCHAR(1000) NOT NULL,

    penalty_amount DECIMAL(19,2) NULL,
    penalty_currency CHAR(3) NULL,

    CHECK (
      (penalty_amount IS NULL AND penalty_currency IS NULL)
      OR
      (penalty_amount IS NOT NULL AND penalty_currency IS NOT NULL)
    )
);
```

## 28.4 ORM mapping note

Domain sealed state may map to columns manually. Do not force ORM entity to be identical to domain aggregate if it makes design awkward.

## 28.5 Persistence entity

A mutable persistence entity can exist separately and map to/from domain.

---

# 29. Event Serialization Mapping

## 29.1 Event envelope

```java
public record EventEnvelopeDto<T>(
    String eventId,
    String eventType,
    int schemaVersion,
    String tenantId,
    String aggregateId,
    String occurredAt,
    T data
) {}
```

## 29.2 CaseClosed payload

```java
public record CaseClosedEventDto(
    String closedBy,
    String reason,
    long newVersion
) {}
```

## 29.3 Mapper

```java
EventEnvelopeDto<CaseClosedEventDto> toEventDto(CaseClosed event) {
    return new EventEnvelopeDto<>(
        event.eventId().value().toString(),
        "case.closed",
        1,
        event.caseRef().tenantId().value(),
        event.caseRef().caseId().value(),
        event.occurredAt().toString(),
        new CaseClosedEventDto(
            event.closedBy().value(),
            event.reason().value(),
            event.newVersion().value()
        )
    );
}
```

## 29.4 Compatibility note

Event DTO is durable. Do not use Java class names as event type. Do not expose internal sealed type names by accident.

---

# 30. Cache Snapshot Mapping

## 30.1 Snapshot

```java
public record EnforcementCaseSnapshot(
    TenantCaseRef ref,
    CaseTitle title,
    CaseState state,
    Version version,
    List<Violation> violations,
    List<AttachmentRef> attachments,
    Instant capturedAt
) {
    public EnforcementCaseSnapshot {
        Objects.requireNonNull(ref);
        Objects.requireNonNull(title);
        Objects.requireNonNull(state);
        Objects.requireNonNull(version);
        violations = List.copyOf(violations);
        attachments = List.copyOf(attachments);
        Objects.requireNonNull(capturedAt);
    }
}
```

## 30.2 Cache key

```java
public record CaseSnapshotCacheKey(TenantId tenantId, CaseId caseId) {
    public String value() {
        return "case-snapshot:v1:tenant:%s:case:%s"
            .formatted(tenantId.value(), caseId.value());
    }
}
```

## 30.3 Cache value

Use immutable DTO/snapshot, not mutable entity.

## 30.4 Cache compatibility

If snapshot shape changes incompatibly, bump namespace:

```text
case-snapshot:v2:...
```

---

# 31. Concurrency and JMM Design

## 31.1 Aggregate mutation

Aggregate is not thread-safe by itself.

Policy:

```text
One aggregate instance should be used within one transaction/thread.
Persistence optimistic locking handles concurrent requests.
```

## 31.2 Shared snapshot

Snapshots are immutable and safe to share if safely published.

## 31.3 Cache config

If using in-memory cache:

- values immutable;
- references safely published by cache/concurrent map;
- no mutation after put.

## 31.4 Version

Version prevents lost update.

## 31.5 Events

Events are immutable.

## 31.6 Rule

Do not share mutable aggregate instance across requests.

---

# 32. Security Review

## 32.1 Tenant boundary

- every case ref includes TenantId;
- repository requires tenant;
- cache key includes tenant.

## 32.2 Actor source

Actor comes from authenticated principal, not request body.

## 32.3 Authorization

Sensitive operation requires scope/capability.

## 32.4 Secrets

No token/password in domain/event/snapshot.

## 32.5 Logging

Reasons and remarks use safe toString or are logged only under redaction policy.

## 32.6 File names

Use SafeFileName/AttachmentId; never raw path.

## 32.7 Error mapping

Do not leak internal details.

## 32.8 Event payload

No PII/secrets unless justified and protected.

---

# 33. Performance and Memory Review

## 33.1 Normal workload

This rich domain model is appropriate for request/transaction scale.

## 33.2 Large batch/read model

If processing millions of cases in analytics:

- do not load full aggregate;
- use projection records;
- stream rows;
- use primitive/compact representation where needed.

## 33.3 Collections

- violations/attachments copied;
- max size should be bounded at API/DB.
- avoid unbounded payload.

## 33.4 Money

BigDecimal okay for correctness. For high-volume numeric aggregation, consider minor units.

## 33.5 Events

Keep event payload compact.

## 33.6 Rule

Use rich types in domain. Use compact projections in hot/bulk paths.

---

# 34. Testing Strategy

## 34.1 Value object tests

- valid CaseId;
- invalid CaseId;
- normalization;
- ClosureReason length;
- Money scale/currency.

## 34.2 State transition tests

- Draft -> Submitted valid;
- Closed -> Close invalid;
- Rejected requires reason;
- version increments.

## 34.3 Command mapping tests

- raw DTO missing reason;
- invalid ID;
- expected version missing;
- principal actor used.

## 34.4 Authorization tests

- missing scope;
- cross-tenant;
- valid scope.

## 34.5 Repository tests

- find requires tenant;
- optimistic lock conflict;
- DB constraints reject invalid state.

## 34.6 Serialization tests

- API JSON golden response;
- event envelope schema;
- unknown event handling.

## 34.7 Security tests

- reason not logged;
- path traversal rejected;
- tenant cache key includes tenant.

## 34.8 Concurrency tests

- two close commands same version -> one success, one conflict.

## 34.9 Compatibility tests

- old event v1 still readable;
- cache v1/v2 namespace.

---

# 35. Example End-to-End Flow: Close Case

## 35.1 Input

HTTP:

```http
POST /tenants/CEA/cases/CASE-00000001/close
```

Body:

```json
{
  "reason": "Investigation complete with sufficient evidence.",
  "expectedVersion": 7
}
```

Authenticated principal:

```text
officerId=OFF-ABC123
tenantId=CEA
scopes=[CASE_CLOSE]
```

## 35.2 Boundary mapping

Raw:

```java
String tenantId = "CEA";
String caseId = "CASE-00000001";
CloseCaseRequestDto dto = ...
```

Validated to:

```java
CloseCaseCommand(
    TenantCaseRef(TenantId("CEA"), CaseId("CASE-00000001")),
    OfficerId("OFF-ABC123"),
    ClosureReason(...),
    ExpectedVersion(Version(7))
)
```

## 35.3 Authorization

```java
CanCloseCase
```

created if principal tenant and scope valid.

## 35.4 Repository load

```java
findByRef(TenantCaseRef)
```

not `findByCaseId`.

## 35.5 Version check

Expected version 7 equals aggregate version 7.

## 35.6 State transition

`Assigned` or `UnderReview` -> `Closed`.

## 35.7 Event

```java
CaseClosed(
    eventId,
    caseRef,
    closedBy,
    reason,
    Version(8),
    occurredAt
)
```

## 35.8 Save

Repository saves with optimistic lock.

## 35.9 Publish

Event mapped to `case.closed` envelope v1.

## 35.10 Response

```json
{
  "tenantId": "CEA",
  "caseId": "CASE-00000001",
  "version": 8,
  "closedAt": "2026-06-12T03:15:30Z"
}
```

---

# 36. Example End-to-End Flow: Reject Case

## 36.1 Command

```java
record RejectCaseCommand(
    TenantCaseRef caseRef,
    OfficerId actorId,
    RejectionReason reason,
    ExpectedVersion expectedVersion
) implements CaseCommand {}
```

## 36.2 Transition

Allowed from:

- Submitted;
- Assigned;
- UnderReview.

Not allowed from:

- Draft maybe, depending business;
- Approved;
- Rejected;
- Closed;
- Archived.

## 36.3 State after reject

```java
new Rejected(now, actorId, reason)
```

No possibility of:

```text
state=REJECTED with reason=null
```

## 36.4 Event

```java
CaseRejected(eventId, caseRef, rejectedBy, reason, newVersion, occurredAt)
```

## 36.5 API error if invalid transition

```json
{
  "type": "https://api.example.com/problems/invalid-transition",
  "title": "Invalid case transition",
  "status": 409,
  "detail": "The requested transition is not allowed from current state"
}
```

---

# 37. What This Capstone Demonstrates

## 37.1 Typed IDs

Prevents ID mix-up.

## 37.2 Tenant-scoped reference

Prevents cross-tenant mistakes.

## 37.3 Value objects

Centralize validation/invariants.

## 37.4 Sealed state

Prevents invalid status + nullable field combinations.

## 37.5 Commands

Represent use-case intent.

## 37.6 Events

Represent immutable facts.

## 37.7 Error algebra

Makes domain failure explicit.

## 37.8 Result

Models expected failure without exception control flow.

## 37.9 DTO mapping

Keeps API raw shape separate from domain.

## 37.10 DB mapping

Mirrors durable constraints.

## 37.11 Security design

Avoids trusting request-supplied actor/tenant.

## 37.12 Concurrency design

Optimistic version prevents lost updates.

---

# 38. Common Trade-Offs

## 38.1 Type richness vs boilerplate

More types mean more code.

Mitigation:

- use records;
- generate simple mappers if safe;
- start with high-risk concepts.

## 38.2 Domain purity vs ORM convenience

ORM may prefer mutable entities.

Mitigation:

- separate persistence entity and domain aggregate.

## 38.3 Sealed state vs relational columns

Sealed state maps awkwardly to DB.

Mitigation:

- explicit mapper;
- state_code + state-specific columns + constraints;
- or separate state history table.

## 38.4 Result type verbosity

Java lacks native result ergonomics.

Mitigation:

- use sealed result carefully;
- use exceptions for truly exceptional infrastructure failures;
- keep result at domain/application boundary.

## 38.5 Optional in domain component

Optional field in domain records can be debated.

Mitigation:

- use it for return values primarily;
- for domain components, team convention matters;
- sealed variants can be clearer.

## 38.6 Performance at scale

Rich objects cost memory.

Mitigation:

- use projections/compact representation for bulk/hot paths.

---

# 39. Production Readiness Checklist

Before approving design:

## 39.1 Type correctness

- [ ] IDs are typed.
- [ ] Tenant scope is explicit.
- [ ] Money includes currency.
- [ ] Time semantics use correct java.time type.
- [ ] State-specific data is represented by state type.
- [ ] Commands/events/errors are distinct.

## 39.2 Boundary

- [ ] API DTOs separate from domain.
- [ ] Event DTOs versioned.
- [ ] DB mapping explicit.
- [ ] Cache key includes tenant/version.
- [ ] Null/missing/default semantics clear.

## 39.3 Security

- [ ] Actor/tenant from principal.
- [ ] Authorization scope/capability checked.
- [ ] No secret/PII in events/logs.
- [ ] File names/URLs safe.
- [ ] Error responses do not leak internals.

## 39.4 Concurrency

- [ ] Optimistic version used.
- [ ] Aggregate not shared across threads.
- [ ] Snapshots immutable.
- [ ] Cache values immutable.

## 39.5 Validation

- [ ] Boundary validation returns structured errors.
- [ ] Domain constructors enforce invariants.
- [ ] DB constraints mirror critical invariants.
- [ ] Event schema validates payload.

## 39.6 Testing

- [ ] Value object tests.
- [ ] State transition tests.
- [ ] Authorization tests.
- [ ] DB mapping tests.
- [ ] API serialization tests.
- [ ] Event compatibility tests.
- [ ] Cross-tenant security tests.
- [ ] Optimistic lock tests.

---

# 40. Final Summary of the Entire Series

Kita telah menyelesaikan deep dive Java Data Types dari part 000 sampai part 034.

Kesimpulan besar seri ini:

```text
A data type is not merely storage.
A data type is meaning, constraint, behavior, representation, boundary contract, and production risk control.
```

Top-tier Java engineer tidak hanya tahu:

```java
int
String
List
Map
record
enum
Optional
Instant
BigDecimal
```

Mereka memahami:

- kapan primitive cukup dan kapan harus domain type;
- kapan `String` adalah transport representation, bukan model;
- kapan enum cukup dan kapan sealed type lebih tepat;
- bagaimana null/absence/error harus dimodelkan;
- bagaimana record bisa shallow immutable tapi tetap bocor jika component mutable;
- bagaimana equality/hash/order bisa merusak map/cache;
- bagaimana date/time salah bisa menjadi bug security dan audit;
- bagaimana BigDecimal benar tapi scale/equality/rounding tetap harus dikontrol;
- bagaimana API/DB/event/cache serialization membuat type menjadi contract;
- bagaimana validation berbeda dari invariant;
- bagaimana security bisa dimulai dari type signature;
- bagaimana concurrency membutuhkan immutability/safe publication;
- bagaimana memory/performance dipengaruhi object graph dan boxing;
- bagaimana production incident sering adalah feedback bahwa type terlalu lemah.

## Final mental model

Setiap kali melihat field/method:

```java
String status;
BigDecimal amount;
LocalDateTime createdAt;
Boolean approved;
Map<String,Object> payload;
List<String> permissions;
```

Jangan hanya bertanya:

```text
Apakah ini compile?
```

Tanya:

```text
Apa meaning-nya?
Apa valid values-nya?
Apa invalid state yang masih mungkin?
Apakah null punya arti?
Apakah crossing API/DB/event/cache?
Apakah aman untuk log?
Apakah aman untuk concurrency?
Apakah compatible jika berubah?
Apakah scale-nya aman?
Apakah compiler bisa membantu?
```

Itulah bedanya sekadar menulis Java dengan mendesain sistem Java yang kuat.

---

## Penutup

Capstone ini adalah template berpikir.

Tidak semua project butuh semua pola.

Tetapi setiap production-grade Java system butuh kebiasaan ini:

```text
Make meaning explicit.
Make invalid states difficult.
Make boundaries intentional.
Make compatibility deliberate.
Make security visible.
Make performance measured.
```

Jika kebiasaan ini konsisten, data type bukan lagi detail kecil. Data type menjadi fondasi correctness, maintainability, security, dan evolvability.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-data-types-part-033.md](./learn-java-data-types-part-033.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-deployment-runtime-release-delivery-engineering](../deployment/learn-java-deployment-runtime-release-delivery-engineering-part-00-deployment-mental-model.md)
