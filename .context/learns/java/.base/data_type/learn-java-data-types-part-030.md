# learn-java-data-types-part-030.md

# Java Data Types — Part 030  
# Advanced Type Modeling Patterns: Value Object, Phantom Type, Result, State Machine, Command/Event, Registry, dan Type-Safe Domain Design

> Seri: **Advanced Java Data Types**  
> Bagian: **030**  
> Fokus: membangun pola type modeling tingkat lanjut di Java: domain-specific value objects, typed ID, phantom type, marker interface, bounded generics, sealed result, error algebra, state machine, command/event typing, type-safe registry, units of measure, capability types, validation result, anti-corruption layer, and pragmatic trade-offs for production systems.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Type Modeling sebagai Desain Bahasa Domain](#2-mental-model-type-modeling-sebagai-desain-bahasa-domain)
3. [Pattern 1 — Value Object](#3-pattern-1--value-object)
4. [Pattern 2 — Typed ID](#4-pattern-2--typed-id)
5. [Pattern 3 — Branded String/Number](#5-pattern-3--branded-stringnumber)
6. [Pattern 4 — Phantom Type](#6-pattern-4--phantom-type)
7. [Pattern 5 — Marker Interface](#7-pattern-5--marker-interface)
8. [Pattern 6 — Bounded Generic](#8-pattern-6--bounded-generic)
9. [Pattern 7 — Self Type / F-Bounded Polymorphism](#9-pattern-7--self-type--f-bounded-polymorphism)
10. [Pattern 8 — Result Type](#10-pattern-8--result-type)
11. [Pattern 9 — Error Algebra](#11-pattern-9--error-algebra)
12. [Pattern 10 — Validation Result](#12-pattern-10--validation-result)
13. [Pattern 11 — State as Type](#13-pattern-11--state-as-type)
14. [Pattern 12 — State Machine with Sealed Types](#14-pattern-12--state-machine-with-sealed-types)
15. [Pattern 13 — Command Type](#15-pattern-13--command-type)
16. [Pattern 14 — Event Type](#16-pattern-14--event-type)
17. [Pattern 15 — Query/Read Model Type](#17-pattern-15--queryread-model-type)
18. [Pattern 16 — Capability Type](#18-pattern-16--capability-type)
19. [Pattern 17 — Tenant-Scoped Type](#19-pattern-17--tenant-scoped-type)
20. [Pattern 18 — Unit of Measure Type](#20-pattern-18--unit-of-measure-type)
21. [Pattern 19 — Non-Empty and Constrained Collection](#21-pattern-19--non-empty-and-constrained-collection)
22. [Pattern 20 — Type-Safe Registry](#22-pattern-20--type-safe-registry)
23. [Pattern 21 — Type-Safe Heterogeneous Container](#23-pattern-21--type-safe-heterogeneous-container)
24. [Pattern 22 — Policy as Type](#24-pattern-22--policy-as-type)
25. [Pattern 23 — Strategy with Enum/Sealed Types](#25-pattern-23--strategy-with-enumsealed-types)
26. [Pattern 24 — Anti-Corruption Layer Types](#26-pattern-24--anti-corruption-layer-types)
27. [Pattern 25 — Boundary Raw Type to Domain Type Pipeline](#27-pattern-25--boundary-raw-type-to-domain-type-pipeline)
28. [Pattern 26 — Snapshot Type](#28-pattern-26--snapshot-type)
29. [Pattern 27 — Versioned Type](#29-pattern-27--versioned-type)
30. [Pattern 28 — Audit Type](#30-pattern-28--audit-type)
31. [Pattern 29 — Secure Type](#31-pattern-29--secure-type)
32. [Pattern 30 — Type-Level Lifecycle Segmentation](#32-pattern-30--type-level-lifecycle-segmentation)
33. [Choosing the Right Pattern](#33-choosing-the-right-pattern)
34. [Combining Patterns](#34-combining-patterns)
35. [Production Failure Modes](#35-production-failure-modes)
36. [Best Practices](#36-best-practices)
37. [Decision Matrix](#37-decision-matrix)
38. [Latihan](#38-latihan)
39. [Ringkasan](#39-ringkasan)
40. [Referensi](#40-referensi)

---

# 1. Tujuan Bagian Ini

Setelah memahami primitive, wrapper, String, enum, records, sealed types, generics, collections, Optional, date/time, mutability, JMM, serialization, DB, API, validation, security, dan reflection, sekarang kita masuk ke bagian yang lebih desain-oriented:

```text
Bagaimana menyusun type-type itu menjadi model domain yang kuat?
```

Contoh raw design:

```java
void closeCase(String tenantId, String caseId, String actorId, String reason, String status) {
    ...
}
```

Advanced type-modeled design:

```java
void closeCase(CloseCaseCommand command, AuthenticatedPrincipal principal) {
    ...
}

record CloseCaseCommand(
    TenantScoped<CaseId> caseRef,
    OfficerId actorId,
    ClosureReason reason,
    ExpectedVersion expectedVersion
) {}
```

Tujuan bagian ini:

- mengenal advanced type modeling patterns;
- memahami kapan menggunakan record, enum, sealed, generic, marker, phantom;
- membangun result/error/state/command/event type;
- mengurangi primitive obsession;
- mengurangi invalid state;
- membuat API domain lebih self-documenting;
- membuat compiler ikut menjaga invariant;
- tetap pragmatis terhadap complexity, framework, performance, dan team readability.

---

# 2. Mental Model: Type Modeling sebagai Desain Bahasa Domain

Type modeling adalah membuat bahasa domain di dalam code.

Raw code:

```java
String id;
String type;
String status;
String reason;
BigDecimal amount;
```

Domain language:

```java
CaseId
CaseType
CaseState
ClosureReason
Money
```

## 2.1 Type as vocabulary

Type memberi nama pada konsep.

## 2.2 Type as constraint

Type membatasi nilai valid.

## 2.3 Type as operation set

Type mendefinisikan operasi yang masuk akal.

```java
money.add(other)
dateRange.contains(date)
caseState.canClose()
```

## 2.4 Type as boundary

Type memisahkan raw data dari trusted data.

## 2.5 Type as compiler-enforced design

Wrong combination becomes compile error.

## 2.6 Rule

```text
If concept matters to business correctness, it deserves a type.
```

---

# 3. Pattern 1 — Value Object

Value object merepresentasikan nilai domain yang equality-nya berdasarkan value.

## 3.1 Example

```java
public record EmailAddress(String value) {
    public EmailAddress {
        Objects.requireNonNull(value);
        value = value.strip();
        if (!value.contains("@")) {
            throw new IllegalArgumentException("Invalid email");
        }
    }
}
```

## 3.2 Good candidates

- EmailAddress;
- Money;
- DateRange;
- CaseId;
- PolicyCode;
- Percentage;
- Version;
- ClosureReason.

## 3.3 Benefits

- invariant centralized;
- equality stable;
- domain language clear;
- easy tests;
- safe map keys if immutable.

## 3.4 Risks

- wrapper explosion;
- mapping friction;
- allocation overhead at huge scale;
- too many tiny types for trivial fields.

## 3.5 Use record when

- transparent value;
- immutable components;
- generated equality acceptable;
- no hidden/sensitive representation issue.

## 3.6 Use class when

- need hidden representation;
- sensitive data;
- array/mutable component;
- custom equality;
- complex lifecycle.

---

# 4. Pattern 2 — Typed ID

Typed ID prevents ID mix-up.

## 4.1 Bad

```java
void assign(String caseId, String officerId) {}
```

## 4.2 Good

```java
void assign(CaseId caseId, OfficerId officerId) {}
```

## 4.3 Implementation

```java
public record CaseId(String value) {
    public CaseId {
        Objects.requireNonNull(value);
        value = value.strip().toUpperCase(Locale.ROOT);
        if (!value.matches("^CASE-[0-9]{6}$")) {
            throw new IllegalArgumentException("Invalid CaseId");
        }
    }
}
```

## 4.4 UUID ID

```java
public record UserId(UUID value) {
    public UserId {
        Objects.requireNonNull(value);
    }
}
```

## 4.5 Benefits

- prevents parameter swap;
- better map keys;
- clearer repository API;
- centralizes parsing/validation.

## 4.6 Rule

Every important entity ID should usually have a domain-specific type.

---

# 5. Pattern 3 — Branded String/Number

A branded type is a wrapper giving semantic meaning to primitive/string.

```java
record PolicyCode(String value) {}
record CountryCode(String value) {}
record CurrencyCode(String value) {}
record Percentage(BigDecimal value) {}
```

## 5.1 Why

All are strings/numbers but not interchangeable.

## 5.2 Code example

```java
record CurrencyCode(String value) {
    CurrencyCode {
        Objects.requireNonNull(value);
        value = value.strip().toUpperCase(Locale.ROOT);
        if (!value.matches("^[A-Z]{3}$")) {
            throw new IllegalArgumentException("Invalid currency code");
        }
    }
}
```

## 5.3 Benefits

- makes accidental mixing harder;
- enforces format;
- improves OpenAPI/DB mapping.

## 5.4 Too much branding

Do not wrap every local variable.

## 5.5 Rule

Brand values that cross boundaries, affect business rules, or are easy to mix up.

---

# 6. Pattern 4 — Phantom Type

Phantom type uses generic parameter to distinguish types at compile time without storing value of that parameter.

## 6.1 Example

```java
interface CaseEntity {}
interface OfficerEntity {}

record Id<T>(UUID value) {
    Id {
        Objects.requireNonNull(value);
    }
}
```

Usage:

```java
Id<CaseEntity> caseId = new Id<>(UUID.randomUUID());
Id<OfficerEntity> officerId = new Id<>(UUID.randomUUID());
```

Cannot pass officer ID where case ID expected.

## 6.2 Benefits

- reusable ID implementation;
- compile-time separation;
- less boilerplate.

## 6.3 Downsides

- type erasure;
- runtime metadata weak;
- JSON/JPA mapping harder;
- less readable than `CaseId`;
- error messages can be generic.

## 6.4 When useful

- internal libraries;
- generic repositories;
- many similar typed identifiers;
- compile-time brand only.

## 6.5 When avoid

- public domain language where `CaseId` is clearer;
- frameworks needing concrete class;
- external schema mapping.

## 6.6 Rule

Use phantom types when generic safety matters more than concrete domain readability.

---

# 7. Pattern 5 — Marker Interface

Marker interface adds compile-time category.

```java
interface Command {}
interface Query {}
interface DomainEvent {}
interface SensitiveValue {}
```

## 7.1 Example

```java
sealed interface CaseCommand extends Command permits CloseCase, AssignCase {}

record CloseCase(CaseId caseId, ClosureReason reason) implements CaseCommand {}
```

## 7.2 Benefits

- grouping;
- bounded generics;
- handler registry;
- compile-time category.

## 7.3 Marker without behavior

Can be useful, but too many markers can become noise.

## 7.4 Marker with sealed

Better:

```java
sealed interface PaymentEvent permits PaymentCaptured, PaymentRejected {}
```

## 7.5 Marker for security

```java
interface SensitiveValue {}
```

Can help logging/redaction tools.

## 7.6 Rule

Use marker interfaces to express meaningful categories used by APIs/generics/frameworks.

---

# 8. Pattern 6 — Bounded Generic

Bounded generic restricts type parameter.

## 8.1 Example

```java
interface DomainEvent {
    EventId eventId();
}

final class EventPublisher<E extends DomainEvent> {
    void publish(E event) {
        ...
    }
}
```

## 8.2 Multiple bounds

```java
<T extends Command & Auditable> void handle(T command) {}
```

## 8.3 Repository example

```java
interface Entity<ID> {
    ID id();
}

interface Repository<ID, E extends Entity<ID>> {
    Optional<E> findById(ID id);
}
```

## 8.4 Benefits

- reusable abstraction;
- compile-time constraints;
- avoids raw Object.

## 8.5 Risks

- over-generic design;
- hard-to-read signatures;
- type inference pain.

## 8.6 Rule

Use bounded generics when abstraction is real and repeated, not to look clever.

---

# 9. Pattern 7 — Self Type / F-Bounded Polymorphism

Used for fluent APIs or comparable-like constraints.

## 9.1 Example

```java
interface SelfValidating<T extends SelfValidating<T>> {
    T validate();
}
```

## 9.2 Comparable style

```java
record Version(long value) implements Comparable<Version> {
    @Override
    public int compareTo(Version other) {
        return Long.compare(value, other.value);
    }
}
```

## 9.3 Fluent builder

```java
abstract class Builder<T extends Builder<T>> {
    abstract T self();

    T commonOption(String value) {
        ...
        return self();
    }
}
```

## 9.4 Benefits

- fluent return subtype;
- type-safe recursive bounds.

## 9.5 Risks

- confusing;
- inheritance-heavy;
- brittle.

## 9.6 Rule

Use F-bounds sparingly. Prefer composition when possible.

---

# 10. Pattern 8 — Result Type

Result models success/failure without exception for expected outcomes.

## 10.1 Basic sealed result

```java
public sealed interface Result<T, E> permits Ok, Err {}

public record Ok<T, E>(T value) implements Result<T, E> {}

public record Err<T, E>(E error) implements Result<T, E> {}
```

## 10.2 Usage

```java
Result<CaseId, ParseError> result = CaseIdParser.parse(raw);
```

## 10.3 Handling

```java
switch (result) {
    case Ok<CaseId, ParseError> ok -> use(ok.value());
    case Err<CaseId, ParseError> err -> report(err.error());
}
```

## 10.4 Benefits

- expected failure explicit;
- no exception control flow;
- compiler forces handling;
- good for parsing/validation/import.

## 10.5 Downsides

- Java lacks native ergonomic Result;
- generic sealed pattern can be verbose;
- stack traces lost for unexpected errors.

## 10.6 Rule

Use Result for expected business/validation errors, not for programmer bugs.

---

# 11. Pattern 9 — Error Algebra

Error algebra models possible errors as types.

## 11.1 Example

```java
sealed interface CloseCaseError permits CaseNotFound, AlreadyClosed, Unauthorized, InvalidReason {}

record CaseNotFound(CaseId caseId) implements CloseCaseError {}
record AlreadyClosed(CaseId caseId, Instant closedAt) implements CloseCaseError {}
record Unauthorized(OfficerId actorId) implements CloseCaseError {}
record InvalidReason(String message) implements CloseCaseError {}
```

## 11.2 Benefits

- explicit domain failures;
- exhaustive handling;
- better API mapping;
- no stringly error codes internally.

## 11.3 Map to API

```java
ProblemDetails toProblem(CloseCaseError error) {
    return switch (error) {
        case CaseNotFound e -> ProblemDetails.notFound(...);
        case AlreadyClosed e -> ProblemDetails.conflict(...);
        case Unauthorized e -> ProblemDetails.forbidden(...);
        case InvalidReason e -> ProblemDetails.badRequest(...);
    };
}
```

## 11.4 Error data

Each error carries relevant data.

## 11.5 Avoid too many micro-errors

Group when reasonable.

## 11.6 Rule

If callers need to react differently, model error as type.

---

# 12. Pattern 10 — Validation Result

Validation result accumulates many field errors.

## 12.1 FieldError

```java
record FieldError(String field, String code, String message) {}
```

## 12.2 ValidationResult

```java
sealed interface ValidationResult<T> permits Valid, Invalid {}

record Valid<T>(T value) implements ValidationResult<T> {}
record Invalid<T>(List<FieldError> errors) implements ValidationResult<T> {
    Invalid {
        errors = List.copyOf(errors);
    }
}
```

## 12.3 Usage

```java
ValidationResult<CloseCaseCommand> validate(CloseCaseRequest request)
```

## 12.4 Benefits

- collect multiple errors;
- API-friendly;
- import/batch-friendly.

## 12.5 Domain constructor still needed

Validation result at boundary does not replace domain invariants.

## 12.6 Rule

Use validation result when user needs actionable list of problems.

---

# 13. Pattern 11 — State as Type

Instead of status string + nullable fields, represent state as type.

## 13.1 Bad

```java
record CaseData(
    String status,
    Instant submittedAt,
    Instant closedAt,
    String closeReason
) {}
```

## 13.2 Good

```java
sealed interface CaseState permits Draft, Submitted, Closed {}

record Draft() implements CaseState {}

record Submitted(Instant submittedAt, OfficerId submittedBy) implements CaseState {}

record Closed(Instant closedAt, OfficerId closedBy, ClosureReason reason) implements CaseState {}
```

## 13.3 Benefits

- state-specific data required;
- impossible combinations reduced;
- exhaustive switch;
- clearer transitions.

## 13.4 Persistence mapping

Requires careful DB mapping.

## 13.5 API mapping

Use discriminator.

## 13.6 Rule

Use state-as-type when states carry different data or behavior.

---

# 14. Pattern 12 — State Machine with Sealed Types

State machine encodes valid transitions.

## 14.1 State

```java
sealed interface ApplicationState permits Draft, Submitted, Approved, Rejected {}

record Draft() implements ApplicationState {}
record Submitted(Instant at) implements ApplicationState {}
record Approved(Instant at, OfficerId by) implements ApplicationState {}
record Rejected(Instant at, OfficerId by, RejectionReason reason) implements ApplicationState {}
```

## 14.2 Transition method

```java
ApplicationState submit(ApplicationState state, Clock clock) {
    return switch (state) {
        case Draft d -> new Submitted(clock.instant());
        case Submitted s -> throw new IllegalStateException("Already submitted");
        case Approved a -> throw new IllegalStateException("Already approved");
        case Rejected r -> throw new IllegalStateException("Already rejected");
    };
}
```

## 14.3 More domain-friendly

```java
caseAggregate.submit(actor, clock);
```

internally uses typed state.

## 14.4 Benefits

- invalid transitions explicit;
- state payload typed;
- easier testing.

## 14.5 Large state machine

If many states/transitions, table-driven model may be better.

## 14.6 Rule

Model lifecycle as type when lifecycle correctness matters.

---

# 15. Pattern 13 — Command Type

Command represents intent.

## 15.1 Example

```java
sealed interface CaseCommand permits CloseCaseCommand, AssignCaseCommand {}

record CloseCaseCommand(
    CaseId caseId,
    OfficerId actorId,
    ClosureReason reason,
    ExpectedVersion expectedVersion
) implements CaseCommand {}

record AssignCaseCommand(
    CaseId caseId,
    OfficerId assigneeId,
    OfficerId actorId
) implements CaseCommand {}
```

## 15.2 Benefits

- explicit use-case input;
- validation target;
- audit logging;
- handler dispatch;
- immutable request.

## 15.3 Command is not DTO

DTO raw request maps to command.

## 15.4 Command should be immutable

Command must not change while handled.

## 15.5 Command handler

```java
interface CommandHandler<C extends CaseCommand> {
    Result<?, ?> handle(C command);
}
```

## 15.6 Rule

Use command types for business operations with intent and invariants.

---

# 16. Pattern 14 — Event Type

Event represents fact that happened.

## 16.1 Example

```java
sealed interface CaseEvent permits CaseClosed, CaseAssigned {}

record CaseClosed(
    EventId eventId,
    CaseId caseId,
    OfficerId closedBy,
    ClosureReason reason,
    Instant occurredAt
) implements CaseEvent {}

record CaseAssigned(
    EventId eventId,
    CaseId caseId,
    OfficerId assignedTo,
    OfficerId assignedBy,
    Instant occurredAt
) implements CaseEvent {}
```

## 16.2 Benefits

- immutable fact;
- event-driven architecture;
- audit;
- replay;
- integration.

## 16.3 Event versioning

External event DTO may include schema version.

## 16.4 Event is not command

Command asks. Event states it happened.

## 16.5 Event should not contain secrets

Use explicit payload.

## 16.6 Rule

Events are durable contracts. Type them carefully.

---

# 17. Pattern 15 — Query/Read Model Type

Query/read model optimized for reading, not domain behavior.

## 17.1 Example

```java
record CaseSummary(
    CaseId caseId,
    CaseStatus status,
    DisplayName assignedOfficerName,
    Instant updatedAt
) {}
```

## 17.2 Benefits

- projection-friendly;
- API response-friendly;
- avoids loading aggregate;
- stable read contract.

## 17.3 Not aggregate

Read model may duplicate/denormalize data.

## 17.4 DTO mapping

May map directly to response DTO or be response DTO if boundary stable.

## 17.5 Rule

Use read model types for query projections instead of exposing mutable entities.

---

# 18. Pattern 16 — Capability Type

Capability type proves permission/capability has been checked.

## 18.1 Example

```java
record CanCloseCase(OfficerId actorId, CaseId caseId) {}
```

Only authorization service can create it.

```java
CanCloseCase capability = authorization.requireCanClose(actor, caseId);
caseService.close(capability, reason);
```

## 18.2 Constructor visibility

Make constructor package-private or static factory controlled.

## 18.3 Benefits

- authorization proof carried by type;
- avoids repeated checks;
- makes privileged method explicit.

## 18.4 Risks

- capability lifetime/staleness;
- serialization/leak;
- misuse if public constructor.

## 18.5 Use cases

- admin operation;
- tenant-scoped access;
- workflow transition permission.

## 18.6 Rule

Capability types are advanced; use for high-risk authorization flows.

---

# 19. Pattern 17 — Tenant-Scoped Type

Multi-tenant systems must bind resource IDs to tenant.

## 19.1 Bad

```java
findByCaseId(caseId)
```

## 19.2 Good

```java
record TenantScoped<T>(TenantId tenantId, T value) {}
```

Usage:

```java
TenantScoped<CaseId> caseRef = new TenantScoped<>(tenantId, caseId);
```

Repository:

```java
Optional<CaseRecord> find(TenantScoped<CaseId> caseRef);
```

## 19.3 Concrete type

```java
record TenantCaseId(TenantId tenantId, CaseId caseId) {}
```

Often clearer than generic.

## 19.4 Benefits

- prevents IDOR class of mistakes;
- repository methods require tenant;
- cache keys include tenant.

## 19.5 Rule

In multi-tenant systems, tenant scoping should appear in type signatures.

---

# 20. Pattern 18 — Unit of Measure Type

Units prevent mixing values.

## 20.1 Bad

```java
double distance;
```

Distance in meters? kilometers? miles?

## 20.2 Unit-specific type

```java
record Meters(double value) {
    Meters {
        if (!Double.isFinite(value) || value < 0) throw ...
    }
}

record Kilometers(double value) {
    Meters toMeters() {
        return new Meters(value * 1000.0);
    }
}
```

## 20.3 Quantity

```java
record Quantity(BigDecimal value, Unit unit) {}
```

## 20.4 Benefits

- prevents unit mismatch;
- centralizes conversion;
- documents semantics.

## 20.5 Risks

- many types;
- conversion overhead;
- units library may be better.

## 20.6 Rule

Use unit types where unit mistakes are expensive.

---

# 21. Pattern 19 — Non-Empty and Constrained Collection

A collection can have invariant.

## 21.1 NonEmptyList

```java
public record NonEmptyList<T>(List<T> values) {
    public NonEmptyList {
        values = List.copyOf(values);
        if (values.isEmpty()) {
            throw new IllegalArgumentException("List must not be empty");
        }
    }

    public T first() {
        return values.getFirst();
    }
}
```

If using Java before `List.getFirst`, use `values.get(0)`.

## 21.2 Unique collection

```java
record UniqueCaseIds(Set<CaseId> values) {
    UniqueCaseIds {
        values = Set.copyOf(values);
        if (values.isEmpty()) throw ...
    }
}
```

## 21.3 Ordered steps

```java
record ApprovalSteps(List<ApprovalStep> steps) {
    ApprovalSteps {
        steps = List.copyOf(steps);
        if (steps.isEmpty()) throw ...
    }
}
```

## 21.4 Benefits

- non-empty guarantee;
- no repeated empty checks;
- collection semantics explicit.

## 21.5 Rule

When collection constraint is required by domain, model it as type.

---

# 22. Pattern 20 — Type-Safe Registry

Registry maps type to handler.

## 22.1 Simple registry

```java
interface Command {}

interface Handler<C extends Command> {
    void handle(C command);
}
```

```java
final class HandlerRegistry {
    private final Map<Class<? extends Command>, Handler<?>> handlers = new HashMap<>();

    public <C extends Command> void register(Class<C> type, Handler<C> handler) {
        handlers.put(type, handler);
    }

    @SuppressWarnings("unchecked")
    public <C extends Command> Handler<C> handlerFor(Class<C> type) {
        return (Handler<C>) handlers.get(type);
    }
}
```

## 22.2 Controlled unchecked cast

Unchecked cast isolated in registry.

## 22.3 Benefits

- avoids reflection method names;
- type-aware dispatch;
- extensible.

## 22.4 Risks

- runtime missing handler;
- generic cast cannot be fully proven due erasure.

## 22.5 Improve

Validate registry at startup.

## 22.6 Rule

If you need dynamic dispatch, centralize type unsafety.

---

# 23. Pattern 21 — Type-Safe Heterogeneous Container

A heterogeneous container stores values keyed by type token.

## 23.1 Example

```java
final class Context {
    private final Map<Class<?>, Object> values = new HashMap<>();

    public <T> void put(Class<T> key, T value) {
        values.put(key, key.cast(value));
    }

    public <T> Optional<T> get(Class<T> key) {
        return Optional.ofNullable(key.cast(values.get(key)));
    }
}
```

## 23.2 Usage

```java
context.put(TenantId.class, tenantId);
Optional<TenantId> tenant = context.get(TenantId.class);
```

## 23.3 Benefits

- type-safe-ish contextual storage;
- avoids string keys;
- useful for request context/metadata.

## 23.4 Limitation

Does not handle `List<String>` vs `List<Integer>` with Class key.

Need Type token for parameterized types.

## 23.5 Risks

- hidden dependencies;
- global context smell.

## 23.6 Rule

Use for infrastructure context, not domain dependency injection replacement.

---

# 24. Pattern 22 — Policy as Type

Policy can be represented as object/type, not flags.

## 24.1 Bad

```java
calculateFee(amount, true, false, "ROUND_HALF_UP")
```

## 24.2 Good

```java
record FeePolicy(
    RoundingMode roundingMode,
    Percentage taxRate,
    DiscountPolicy discountPolicy
) {}
```

## 24.3 Behavior

```java
interface DiscountPolicy {
    Money apply(Money baseAmount);
}
```

## 24.4 Enum policy

```java
enum RoundingPolicy {
    FINANCIAL_STANDARD,
    CUSTOMER_DISPLAY
}
```

## 24.5 Benefits

- avoids boolean parameter soup;
- explicit behavior bundle;
- easier testing.

## 24.6 Rule

If a group of parameters controls behavior, consider a policy type.

---

# 25. Pattern 23 — Strategy with Enum/Sealed Types

Strategy can be modeled with enum or sealed types.

## 25.1 Enum strategy

```java
enum FeeType {
    FLAT {
        Money calculate(Money base) { ... }
    },
    PERCENTAGE {
        Money calculate(Money base) { ... }
    };
}
```

Good for simple closed stateless strategies.

## 25.2 Sealed strategy

```java
sealed interface FeeRule permits FlatFee, PercentageFee {}

record FlatFee(Money amount) implements FeeRule {}
record PercentageFee(Percentage percentage) implements FeeRule {}
```

Behavior:

```java
Money apply(FeeRule rule, Money base) {
    return switch (rule) {
        case FlatFee f -> f.amount();
        case PercentageFee p -> base.multiply(p.percentage());
    };
}
```

## 25.3 When enum

- fixed constants;
- no per-instance data or simple data;
- simple behavior.

## 25.4 When sealed

- variants carry different data;
- need pattern matching;
- domain events/API variants.

## 25.5 Rule

Choose enum for named constants; sealed type for variant shapes.

---

# 26. Pattern 24 — Anti-Corruption Layer Types

External systems have their own concepts.

Do not let them infect domain.

## 26.1 External DTO

```java
record ExternalPermitDto(
    String permit_no,
    String applicant_name,
    String status_code
) {}
```

## 26.2 Anti-corruption mapper

```java
DomainPermit toDomain(ExternalPermitDto dto) {
    return new DomainPermit(
        new PermitNumber(dto.permit_no()),
        new DisplayName(dto.applicant_name()),
        mapStatus(dto.status_code())
    );
}
```

## 26.3 External enum codes

Keep mapping explicit.

## 26.4 Protect domain language

External field names/statuses may be weird. Do not mirror them everywhere.

## 26.5 Rule

Boundary types isolate external model from domain model.

---

# 27. Pattern 25 — Boundary Raw Type to Domain Type Pipeline

A safe pipeline:

```text
Raw input
  -> syntax parse
  -> structural validation
  -> normalization
  -> domain type construction
  -> authorization
  -> command
  -> domain operation
```

## 27.1 Example

```java
ValidationResult<CloseCaseCommand> parse(CloseCaseRequest request, AuthenticatedPrincipal principal) {
    List<FieldError> errors = validate(request);
    if (!errors.isEmpty()) return new Invalid<>(errors);

    CaseId caseId = new CaseId(request.caseId());
    ClosureReason reason = new ClosureReason(request.reason());

    TenantScoped<CaseId> caseRef = new TenantScoped<>(principal.tenantId(), caseId);

    return new Valid<>(new CloseCaseCommand(caseRef, principal.officerId(), reason));
}
```

## 27.2 Benefits

- raw data does not leak inward;
- errors collected at boundary;
- domain receives trusted types;
- tenant binding explicit.

## 27.3 Rule

Make conversion from raw to trusted types explicit and testable.

---

# 28. Pattern 26 — Snapshot Type

Snapshot is immutable view of state at a point in time.

## 28.1 Example

```java
record CaseSnapshot(
    CaseId id,
    CaseState state,
    Version version,
    Instant capturedAt
) {}
```

## 28.2 Benefits

- safe for API response;
- safe for caching;
- safe for async processing;
- avoids exposing mutable entity.

## 28.3 Snapshot vs entity

Entity can mutate. Snapshot does not.

## 28.4 Snapshot can be stale

Include version/capturedAt.

## 28.5 Rule

Return snapshots from mutable aggregates across boundaries.

---

# 29. Pattern 27 — Versioned Type

Version type models concurrency/evolution.

## 29.1 Version

```java
record Version(long value) implements Comparable<Version> {
    Version {
        if (value < 0) throw new IllegalArgumentException();
    }

    Version next() {
        return new Version(Math.addExact(value, 1));
    }
}
```

## 29.2 ExpectedVersion

```java
record ExpectedVersion(Version value) {}
```

## 29.3 SchemaVersion

```java
record SchemaVersion(int value) {}
```

## 29.4 Benefits

- prevents mixing version types;
- clearer optimistic locking;
- better event evolution.

## 29.5 Rule

Version is not just number. It encodes concurrency/evolution semantics.

---

# 30. Pattern 28 — Audit Type

Audit concepts deserve types.

## 30.1 Actor

```java
sealed interface ActorId permits UserActorId, SystemActorId {}

record UserActorId(UserId userId) implements ActorId {}
record SystemActorId(String name) implements ActorId {}
```

## 30.2 Audit event

```java
record AuditEntry(
    AuditId id,
    ActorId actor,
    Action action,
    ResourceRef resource,
    Instant occurredAt,
    CorrelationId correlationId,
    AuditOutcome outcome
) {}
```

## 30.3 Benefits

- no raw strings for actor/action;
- easier compliance;
- safe logging;
- explicit outcome.

## 30.4 Rule

Audit data should be structured and typed, not free-form log strings only.

---

# 31. Pattern 29 — Secure Type

Security-sensitive values need safe behavior.

## 31.1 Secret value

```java
final class SecretValue {
    private final String value;

    @Override
    public String toString() {
        return "SecretValue[masked]";
    }
}
```

## 31.2 Safe file name

```java
record SafeFileName(String value) {}
```

## 31.3 Allowed URL

```java
record AllowedRedirectUri(URI value) {}
```

## 31.4 Tenant scoped resource

```java
record TenantResourceRef<T>(TenantId tenantId, T resourceId) {}
```

## 31.5 Rule

If misuse can create security bug, create type that makes misuse harder.

---

# 32. Pattern 30 — Type-Level Lifecycle Segmentation

Represent lifecycle phases with different types.

## 32.1 Raw vs validated

```java
record RawEmail(String value) {}
record ValidEmail(String value) {}
```

## 32.2 Draft vs submitted

```java
record DraftApplication(...) {}
record SubmittedApplication(...) {}
```

## 32.3 Unsigned vs signed

```java
record UnsignedPayload(byte[] bytes) {}
record SignedPayload(byte[] bytes, Signature signature) {}
```

## 32.4 Unverified vs verified user

```java
record UnverifiedEmail(EmailAddress email) {}
record VerifiedEmail(EmailAddress email, Instant verifiedAt) {}
```

## 32.5 Benefits

- prevents skipping steps;
- compiler encodes process;
- useful for security/workflow.

## 32.6 Risks

- type explosion;
- mapping complexity.

## 32.7 Rule

Use lifecycle-specific types when skipping a phase is dangerous.

---

# 33. Choosing the Right Pattern

## 33.1 Ask questions

```text
Is this concept easy to mix up?
Does it have invariant?
Does it cross boundary?
Does it carry security meaning?
Does it have behavior?
Does it represent state variant?
Does it need exhaustive handling?
Does it have lifecycle phase?
Does it need generic abstraction?
```

## 33.2 If just format/invariant

Use value object.

## 33.3 If identity

Use typed ID.

## 33.4 If alternatives fixed

Use enum.

## 33.5 If alternatives carry different data

Use sealed type.

## 33.6 If operation input

Use command.

## 33.7 If fact happened

Use event.

## 33.8 If expected failure

Use result/error type.

## 33.9 If authorization proof

Use capability type.

## 33.10 If external boundary

Use DTO + anti-corruption mapper.

---

# 34. Combining Patterns

Real design combines patterns.

## 34.1 Close case example

```java
record CloseCaseRequest(String caseId, String reason, Long expectedVersion) {}

record CloseCaseCommand(
    TenantScoped<CaseId> caseRef,
    OfficerId actorId,
    ClosureReason reason,
    ExpectedVersion expectedVersion
) implements CaseCommand {}
```

Result:

```java
Result<CaseClosed, CloseCaseError>
```

Events:

```java
record CaseClosed(
    EventId eventId,
    TenantScoped<CaseId> caseRef,
    OfficerId closedBy,
    ClosureReason reason,
    Version newVersion,
    Instant occurredAt
) implements CaseEvent {}
```

Error algebra:

```java
sealed interface CloseCaseError permits CaseNotFound, AlreadyClosed, Unauthorized, VersionConflict {}
```

## 34.2 Benefits

The signature tells story:

```text
tenant-scoped case is closed by officer for a typed reason with expected version, producing event or typed error.
```

## 34.3 But stay pragmatic

Do not create 20 types for a trivial CRUD admin screen unless it prevents real mistakes.

## 34.4 Rule

The best type model is strong enough for correctness but simple enough for the team.

---

# 35. Production Failure Modes

## 35.1 ID swap

Two String IDs swapped.

Fix:

- typed ID.

## 35.2 Invalid state combination

Closed case without closedAt.

Fix:

- state as sealed type.

## 35.3 Error handled by string compare

Typo in error code.

Fix:

- error algebra.

## 35.4 User input bypasses validation

Raw DTO passed deep.

Fix:

- raw-to-domain pipeline.

## 35.5 Tenant missing in repository

IDOR across tenant.

Fix:

- tenant-scoped type.

## 35.6 Command/event confusion

Consumer treats command as fact.

Fix:

- separate command and event types.

## 35.7 Unknown polymorphic variant

API/event consumer crashes.

Fix:

- discriminator policy/versioning.

## 35.8 Over-generic repository hides domain rules

Generic CRUD allows invalid operations.

Fix:

- domain-specific repository/use-case.

## 35.9 Result type used for programmer errors

Bugs swallowed as Err.

Fix:

- exceptions for invariant/programmer failures.

## 35.10 Type explosion

Team avoids code due complexity.

Fix:

- simplify; apply patterns selectively.

## 35.11 Reflection registry casts wrong handler

Runtime ClassCastException.

Fix:

- centralize registry casts; startup validation; tests.

## 35.12 Lifecycle skipped

Unverified email used as verified.

Fix:

- lifecycle-specific types.

---

# 36. Best Practices

## 36.1 General

- Use domain-specific value objects for meaningful values.
- Use typed IDs for entities.
- Use enum for stable closed constants.
- Use sealed types for variants with different data.
- Use commands for intent.
- Use events for facts.
- Use result/error types for expected business outcomes.
- Use validation result for user input/import errors.
- Use tenant-scoped types in multi-tenant systems.
- Use capability types carefully for authorization proof.
- Use DTOs and anti-corruption layer at boundaries.
- Use snapshots across mutable/entity boundaries.
- Keep raw data at edges.
- Keep unsafe generic casts centralized.
- Do not over-model trivial local values.
- Test type invariants.

## 36.2 Simplicity rules

- Prefer concrete types over clever generics when domain language matters.
- Prefer sealed hierarchy over status + nullable fields when variants carry data.
- Prefer explicit mapper over reflection magic for critical transformations.
- Prefer separate DTOs over validation group maze.
- Prefer compile-time checks over runtime string dispatch.

## 36.3 Review checklist

For a new type ask:

```text
What invariant does it enforce?
What operation does it own?
What invalid state does it prevent?
Does it cross boundary?
How does it serialize?
How does it map to DB?
Is it security-sensitive?
Will this help readability or create noise?
```

---

# 37. Decision Matrix

| Problem | Pattern |
|---|---|
| Swapped IDs | Typed ID |
| Many String codes | Branded string/code value object |
| Same ID implementation many domains | Phantom type |
| Closed constants | Enum |
| Variant-specific fields | Sealed type |
| Expected success/failure | Result type |
| Multiple validation errors | Validation result |
| Domain failure categories | Error algebra |
| Workflow state | State as type/state machine |
| Operation input | Command type |
| Fact happened | Event type |
| API response projection | Read model/snapshot |
| Authorization proof | Capability type |
| Multi-tenant reference | Tenant-scoped type |
| Unit mismatch | Unit of measure type |
| Non-empty input | Non-empty collection |
| Dynamic handler lookup | Type-safe registry |
| Context values by type | Heterogeneous container |
| External model pollution | Anti-corruption layer |
| Security-sensitive value | Secure type |
| Lifecycle phase enforcement | Type-level lifecycle segmentation |

---

# 38. Latihan

## Latihan 1 — Typed ID

Refactor service method with `String caseId, String officerId` into typed IDs.

## Latihan 2 — Value Object

Create `ClosureReason` with length and safe toString.

## Latihan 3 — Result

Implement `Result<T,E>` with `Ok` and `Err`, then parse `CaseId`.

## Latihan 4 — Error Algebra

Create sealed `CloseCaseError` and map it to HTTP error DTO.

## Latihan 5 — State as Type

Replace `status + closedAt + reason` with sealed `CaseState`.

## Latihan 6 — Command/Event

Create `CloseCaseCommand` and `CaseClosedEvent`. Explain difference.

## Latihan 7 — Tenant Scoped

Create `TenantScoped<CaseId>` and update repository method.

## Latihan 8 — Capability

Create `CanCloseCase` capability returned by authorization service.

## Latihan 9 — NonEmptyList

Implement `NonEmptyList<T>` with defensive copy.

## Latihan 10 — Type-Safe Registry

Implement command handler registry keyed by `Class<C>`.

## Latihan 11 — Anti-Corruption

Map external DTO with weird codes to clean domain types.

## Latihan 12 — Lifecycle Types

Model `UnverifiedEmail` and `VerifiedEmail`. Prevent sending sensitive document to unverified email.

---

# 39. Ringkasan

Advanced type modeling adalah cara memakai Java type system untuk mengekspresikan domain, bukan sekadar menyimpan data.

Key patterns:

- Value Object;
- Typed ID;
- Branded String/Number;
- Phantom Type;
- Marker Interface;
- Bounded Generic;
- Result Type;
- Error Algebra;
- Validation Result;
- State as Type;
- Sealed State Machine;
- Command/Event;
- Read Model/Snapshot;
- Capability Type;
- Tenant-Scoped Type;
- Unit of Measure;
- Non-Empty Collection;
- Type-Safe Registry;
- Anti-Corruption Layer;
- Secure Type;
- Lifecycle-Specific Type.

Prinsip utama:

```text
Use types to make illegal states harder to express.
Use boundaries to convert raw input into trusted domain values.
Use sealed/enums/generics only when they clarify real business constraints.
```

Senior Java engineer tidak hanya bertanya:

```text
Class apa yang harus saya buat?
```

Mereka bertanya:

```text
Kesalahan apa yang bisa dicegah compiler?
Invariant apa yang bisa dipaksa constructor?
Kombinasi state apa yang tidak boleh mungkin?
Boundary mana yang masih raw?
Apakah type ini membantu domain language?
Apakah complexity-nya worth it?
```

Type modeling yang baik membuat codebase terasa seperti bahasa domain yang aman, bukan sekumpulan string, boolean, dan map.

---

# 40. Referensi

1. Java SE 25 API — `Record`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Record.html

2. Java SE 25 API — `Enum`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Enum.html

3. Java SE 25 API — `Class`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Class.html

4. JEP 409 — Sealed Classes  
   https://openjdk.org/jeps/409

5. JEP 441 — Pattern Matching for switch  
   https://openjdk.org/jeps/441

6. JEP 440 — Record Patterns  
   https://openjdk.org/jeps/440

7. Java SE 25 API — `Optional`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html

8. Java SE 25 API — `List`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

9. Java SE 25 API — `Objects`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Objects.html

10. Java Language Specification SE 25  
    https://docs.oracle.com/javase/specs/jls/se25/html/index.html

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-data-types-part-029.md](./learn-java-data-types-part-029.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-data-types-part-031.md](./learn-java-data-types-part-031.md)

</div>