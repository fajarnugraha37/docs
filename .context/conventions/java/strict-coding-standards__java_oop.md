# Strict Coding Standards — Java OOP

> **File:** `strict-coding-standards__java_oop.md`  
> **Scope:** Object-oriented design and implementation rules for Java code generated or modified by LLM/code agents.  
> **Baselines:** Java 11, 17, 21, and 25.  
> **Status:** Mandatory standard. Any violation requires explicit reviewer approval.

---

## 1. Purpose

This document defines strict object-oriented programming conventions for Java implementation work. It is designed for LLM implementation agents, reviewers, and maintainers who need Java code that is readable, testable, stable under change, and defensible in production.

This is not a beginner OOP tutorial and not a design pattern catalog. It is an enforceable standard for object modeling.

Java OOP code is considered acceptable only when the following properties are explicit:

1. object purpose;
2. ownership of state;
3. invariants;
4. identity vs value semantics;
5. lifecycle and mutability;
6. dependency direction;
7. extension policy;
8. error behavior;
9. concurrency assumptions;
10. test surface.

An LLM must not create classes merely because “OOP needs classes”. Every class must have a reason to exist.

---

## 2. Applicability

This standard applies to Java code involving:

- classes;
- interfaces;
- abstract classes;
- enums;
- records;
- sealed classes/interfaces;
- inheritance;
- polymorphism;
- composition;
- encapsulated state;
- domain objects;
- value objects;
- services;
- factories/builders;
- DTOs;
- mappers;
- framework-managed objects;
- test doubles.

This standard complements but does not replace:

- `strict-coding-standards__java11.md`;
- `strict-coding-standards__java17.md`;
- `strict-coding-standards__java21.md`;
- `strict-coding-standards__java25.md`;
- `strict-coding-standards__design_pattern_in_java.md`;
- persistence/API/network/I/O-specific standards.

When there is conflict, the stricter rule wins unless the project explicitly overrides it.

---

## 3. Core Principle

Object-oriented Java code is not about creating many classes. It is about assigning responsibilities to stable boundaries.

A good Java object should answer:

1. What does this object represent?
2. Who owns its state?
3. What invariants must always hold?
4. What can change after construction?
5. What behavior belongs here instead of in a caller?
6. What dependencies does it need?
7. Can this object be tested without the whole application?
8. Does it represent identity or value?
9. Can it be safely logged/serialized/shared?
10. What will break if a subtype is introduced?

If these questions cannot be answered, the class is not ready.

---

## 4. Hard Rules

### 4.1 Mandatory

Every non-trivial class must have:

- a clear responsibility;
- a stable name;
- controlled construction;
- explicit mutability policy;
- minimal public API;
- dependencies injected or passed explicitly;
- no hidden global state;
- tests for business behavior;
- no framework leakage unless it is a framework adapter;
- no accidental inheritance surface.

### 4.2 Forbidden by Default

The following are forbidden unless explicitly justified:

- public mutable fields;
- classes named `Manager`, `Processor`, `Handler`, `Helper`, `Util`, or `Common` without precise domain meaning;
- inheritance for code reuse only;
- overriding non-trivial methods without tests for subtype behavior;
- `protected` mutable fields;
- global mutable singleton state;
- static service locators;
- anemic domain objects when domain invariants exist;
- god services/classes;
- DTOs with business behavior;
- domain objects coupled to HTTP, SQL, JSON, or framework annotations without boundary reason;
- `equals` without matching `hashCode`;
- mutable fields used in `hashCode` when object can be stored in hash collections;
- exposing mutable internal collections directly;
- `Optional` fields;
- `Optional` parameters;
- raw generic types;
- unchecked casts without isolation;
- reflection-based OOP shortcuts;
- `clone()` for object copying;
- `finalize()` for cleanup;
- subclass-sensitive constructors calling overridable methods;
- public constructors with invalid intermediate state;
- excessive inheritance depth.

---

## 5. Object Categories

Every class must fit one primary category. If it fits many categories, it is probably too broad.

| Category | Purpose | Mutable? | Identity? | Examples |
|---|---|---:|---:|---|
| Entity | Long-lived domain object with identity | Sometimes | Yes | `Case`, `Application`, `Order` |
| Value Object | Immutable value with equality by components | No | No | `Money`, `EmailAddress`, `DateRange` |
| Domain Service | Stateless behavior that does not naturally belong to one entity | No internal business state | No | `EligibilityPolicy` |
| Application Service | Orchestrates use cases and transactions | No domain state | No | `SubmitApplicationUseCase` |
| Adapter | Talks to external system/framework | Usually stateless | No | `PaymentGatewayClient` |
| DTO | Data transfer across boundary | Prefer immutable | No | `CaseResponse` |
| Command/Input | Request to perform operation | Immutable | No | `CreateCaseCommand` |
| Event | Fact that happened | Immutable | Usually event id | `CaseApprovedEvent` |
| Policy/Strategy | Encapsulates replaceable decision logic | Stateless/immutable | No | `EscalationPolicy` |
| Factory | Creates valid objects | Stateless | No | `CaseFactory` |
| Builder | Assembles complex object safely | Mutable during build only | No | `ReportSpecBuilder` |

### Rule

A class must not combine unrelated categories. For example:

- DTO must not execute business rules.
- Entity must not send HTTP requests.
- Repository must not perform workflow decisions.
- Application service must not contain low-level SQL string assembly.
- Mapper must not call external services.

---

## 6. Responsibility Design

### 6.1 Single Responsibility

A class must have one reason to change at its abstraction level.

Bad reasons to create one class:

- “LLM needed a place for the method.”
- “This looked reusable.”
- “This class already existed.”
- “It was convenient.”
- “All case-related logic goes here.”

Good reasons:

- encapsulates a domain invariant;
- represents a stable concept;
- isolates external dependency;
- defines a use-case boundary;
- controls object creation;
- separates policy from orchestration;
- prevents illegal state.

### 6.2 Responsibility Test

Before adding a method, the LLM must answer:

```text
Does this method need this object's state/invariants?
If no, why is it here?
```

If a method does not use object state and is not part of the object’s semantic contract, it probably belongs elsewhere.

---

## 7. Encapsulation

### 7.1 Fields

Rules:

- fields must be `private`;
- immutable fields must be `final`;
- mutable fields require explicit reason;
- collection fields must never be exposed directly;
- constructor must establish all required invariants;
- no object may be observable in invalid state after construction.

Forbidden:

```java
public class CaseRecord {
    public String status;
    public List<String> notes;
}
```

Allowed:

```java
public final class CaseRecord {
    private final CaseId id;
    private CaseStatus status;
    private final List<CaseNote> notes = new ArrayList<>();

    public CaseRecord(CaseId id, CaseStatus initialStatus) {
        this.id = Objects.requireNonNull(id, "id");
        this.status = Objects.requireNonNull(initialStatus, "initialStatus");
    }

    public CaseStatus status() {
        return status;
    }

    public List<CaseNote> notes() {
        return List.copyOf(notes);
    }
}
```

### 7.2 Getters and Setters

Do not generate getters/setters automatically.

Allowed getter:

- exposes stable query;
- returns immutable/copy/safe view;
- does not leak mutable internals.

Restricted setter:

- only allowed for framework DTOs/config objects or simple mutable state objects;
- must not bypass domain invariant.

Forbidden:

```java
public void setStatus(String status) {
    this.status = status;
}
```

Preferred:

```java
public void approve(Approver approver, Instant approvedAt) {
    requireCanApprove();
    this.status = CaseStatus.APPROVED;
    this.approvedBy = Objects.requireNonNull(approver, "approver");
    this.approvedAt = Objects.requireNonNull(approvedAt, "approvedAt");
}
```

State-changing methods should be named by domain action, not field assignment.

---

## 8. Invariants

### 8.1 Definition

An invariant is a condition that must always be true for an object to be valid.

Examples:

- `Money` amount and currency must not be null.
- `DateRange` start must not be after end.
- `Case` cannot move from `CLOSED` back to `DRAFT`.
- `PageRequest` page size must be within allowed bounds.
- `EmailAddress` must contain a syntactically acceptable address.

### 8.2 Mandatory Rules

Invariants must be enforced:

- at construction;
- before state transition;
- before returning externally visible state;
- before persistence boundary if persistence can bypass constructor;
- in factories/builders when they exist.

Do not rely only on controller validation or database constraints for domain invariants.

### 8.3 Validation Placement

| Validation type | Location |
|---|---|
| Syntax/input validation | API/request boundary |
| Domain invariant | domain object/value object |
| Cross-aggregate rule | domain service/policy/application service |
| Persistence constraint | database schema + repository handling |
| Security authorization | application/security boundary |

### 8.4 Invariant Exception

Use precise exceptions:

```java
throw new IllegalArgumentException("startDate must not be after endDate");
```

Avoid vague exceptions:

```java
throw new RuntimeException("invalid");
```

---

## 9. Identity vs Value

### 9.1 Entity

An entity has identity independent of field values.

Rules:

- identity must be explicit;
- equality policy must be documented;
- avoid equality based on all mutable fields;
- domain transitions should be methods on the entity or a closely related policy.

Example:

```java
public final class Case {
    private final CaseId id;
    private CaseStatus status;

    public Case(CaseId id) {
        this.id = Objects.requireNonNull(id, "id");
        this.status = CaseStatus.DRAFT;
    }

    public CaseId id() {
        return id;
    }

    public void submit(Instant submittedAt) {
        if (status != CaseStatus.DRAFT) {
            throw new IllegalStateException("Only draft cases can be submitted");
        }
        this.status = CaseStatus.SUBMITTED;
    }
}
```

### 9.2 Value Object

A value object is defined by its components.

Rules:

- immutable;
- validates itself;
- equality by value;
- no external identity;
- no framework/service dependency;
- safe to share.

Example:

```java
public record DateRange(LocalDate start, LocalDate end) {
    public DateRange {
        Objects.requireNonNull(start, "start");
        Objects.requireNonNull(end, "end");
        if (start.isAfter(end)) {
            throw new IllegalArgumentException("start must not be after end");
        }
    }
}
```

For Java 11 baseline, use a final class instead of record.

---

## 10. Construction

### 10.1 Constructors

Constructors must produce fully valid objects.

Mandatory:

- validate required parameters;
- reject invalid combinations;
- copy mutable input;
- do not perform I/O;
- do not call overridable methods;
- do not publish `this` during construction.

Forbidden:

```java
public class User {
    public User(String email) {
        EventBus.global().register(this); // publishes this during construction
        validate(); // overridable if validate is non-final
    }

    protected void validate() {}
}
```

### 10.2 Static Factories

Use static factories when construction needs names or controlled variants.

Example:

```java
public final class Money {
    private final BigDecimal amount;
    private final Currency currency;

    private Money(BigDecimal amount, Currency currency) {
        this.amount = amount;
        this.currency = currency;
    }

    public static Money of(BigDecimal amount, Currency currency) {
        Objects.requireNonNull(amount, "amount");
        Objects.requireNonNull(currency, "currency");
        if (amount.scale() > currency.getDefaultFractionDigits()) {
            throw new IllegalArgumentException("amount scale exceeds currency fraction digits");
        }
        return new Money(amount, currency);
    }
}
```

### 10.3 Builders

Builders are restricted.

Allowed when:

- many optional parameters exist;
- object construction has readable staged steps;
- builder validates on `build()`;
- builder is not reused after `build()` unless designed carefully.

Forbidden:

- builder for 2–3 required fields;
- builder that produces partially valid objects;
- builder that bypasses constructor validation;
- builder that silently defaults business-critical values.

### 10.4 Framework Constructors

Framework-required no-arg constructors must be as narrow as possible.

For JPA entities, follow the JPA standard:

```java
protected CaseEntity() {
    // Required by JPA only.
}
```

Do not make invalid no-arg constructors public unless the framework requires it.

---

## 11. Mutability

### 11.1 Default

Default to immutability.

Use mutable state only when:

- it models a real lifecycle;
- mutation is encapsulated by domain methods;
- concurrent access policy is explicit;
- tests cover state transitions.

### 11.2 Immutable Object Rules

An immutable class must:

- be `final`, sealed, or otherwise not extendable unsafely;
- have `private final` fields;
- validate in constructor/factory;
- defensively copy mutable inputs;
- return immutable/copy/safe views;
- avoid lazy mutable caches unless thread-safe.

### 11.3 Mutable Object Rules

A mutable class must:

- limit mutation methods;
- name mutation methods by domain action;
- keep invariants valid after every method call;
- document thread-safety;
- avoid being used as map key/set element if equality/hash depends on mutable fields.

---

## 12. Inheritance

### 12.1 Policy

Inheritance is restricted. Prefer composition unless a true subtype relationship exists.

Inheritance is allowed when:

- subtype is substitutable for base type;
- base class is designed for inheritance;
- protected extension points are deliberate;
- superclass constructors do not call overridable methods;
- superclass documents invariants expected from subclasses;
- tests cover polymorphic behavior.

Inheritance is forbidden when:

- used only to reuse code;
- subclass weakens invariant;
- subclass changes meaning of base methods;
- base class was not designed for extension;
- inheritance hierarchy is deeper than two levels without architecture approval;
- subclass depends on superclass internals.

### 12.2 Base Class Design

If a class is not designed for inheritance, make it `final` or give it package-private constructors.

Allowed base class:

```java
public abstract class AbstractPolicy<T> {
    public final Decision evaluate(T input) {
        Objects.requireNonNull(input, "input");
        return doEvaluate(input);
    }

    protected abstract Decision doEvaluate(T input);
}
```

The public template method is final; the extension point is explicit.

### 12.3 Overriding

Rules:

- always use `@Override`;
- do not broaden side effects;
- do not weaken postconditions;
- do not change exception semantics unexpectedly;
- preserve `equals/hashCode/toString` expectations;
- write tests through base type reference.

Example test style:

```java
private void assertPolicyContract(EscalationPolicy policy) {
    assertThat(policy.evaluate(validCase())).isNotNull();
    assertThatThrownBy(() -> policy.evaluate(null))
            .isInstanceOf(NullPointerException.class);
}
```

---

## 13. Interfaces

### 13.1 Interface Purpose

Use interfaces for stable capability contracts, not for every class.

Allowed:

- boundary abstraction over external dependency;
- polymorphic domain behavior;
- SPI/plugin extension point;
- test seam when concrete dependency is expensive or external;
- multiple unrelated implementations expected.

Forbidden:

- one interface for every service by default;
- `IUserService` naming convention;
- interface mirroring one implementation without reason;
- fat interface with unrelated methods;
- leaking DTO/entity/framework-specific types through domain interface.

### 13.2 Interface Naming

Use capability or role names:

- `Clock`
- `CaseRepository`
- `EligibilityPolicy`
- `NotificationGateway`
- `DocumentStore`

Avoid:

- `ICaseService`
- `CaseServiceInterface`
- `BaseCaseService`
- `GenericHandler`

### 13.3 Default Methods

Default methods are restricted.

Allowed when:

- adding backward-compatible behavior to stable API;
- method composes existing interface methods;
- behavior has no hidden state;
- override remains possible.

Forbidden:

- default methods containing domain workflow orchestration;
- default methods that perform I/O;
- default methods that hide dependencies;
- default methods used as poor-man abstract class.

---

## 14. Abstract Classes

Use abstract classes only when shared implementation and invariants are truly needed.

Allowed:

- template method with controlled extension point;
- shared state with strict invariant;
- framework base classes required by technology.

Forbidden:

- abstract class used only because LLM wants code reuse;
- mutable protected fields;
- abstract class with many unrelated helper methods;
- abstract class that hides dependencies.

Preferred over protected fields:

```java
public abstract class ReportExporter {
    private final Clock clock;

    protected ReportExporter(Clock clock) {
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    protected final Instant now() {
        return clock.instant();
    }
}
```

---

## 15. Sealed Classes and Interfaces

### 15.1 Baseline

Sealed classes/interfaces are available as final language feature in Java 17+.

Use sealed types when the set of subtypes is intentionally closed and meaningful.

Allowed:

- domain state hierarchies;
- command/result variants;
- error/result algebraic modeling;
- controlled plugin boundaries inside a module;
- exhaustive `switch` modeling in Java 21+.

Forbidden:

- sealing arbitrary service classes;
- sealing where third-party extension is expected;
- sealing without tests covering all permitted subtypes;
- mixing sealed hierarchy with reflection-discovered subtypes.

Example:

```java
public sealed interface SubmissionResult
        permits SubmissionResult.Accepted, SubmissionResult.Rejected {

    record Accepted(CaseId caseId) implements SubmissionResult {}

    record Rejected(String reason) implements SubmissionResult {}
}
```

### 15.2 Extension Rule

Every permitted subclass must explicitly choose:

- `final`;
- `sealed`;
- `non-sealed`.

Default should be `final` unless further extension is intentional.

---

## 16. Records

### 16.1 Baseline

Records are available as final language feature in Java 16+, therefore allowed in Java 17/21/25 baselines but not Java 11.

A record is a transparent carrier for a fixed set of values. It is not automatically a good domain model.

Allowed uses:

- value object;
- request/response DTO;
- command object;
- event payload;
- immutable projection;
- small composite key/value.

Restricted uses:

- domain entity with lifecycle;
- JPA entity;
- object requiring hidden mutable state;
- object with complex behavior and many invariants;
- object whose representation must not be part of API contract.

### 16.2 Record Validation

Records with invariants must use compact constructor:

```java
public record EmailAddress(String value) {
    public EmailAddress {
        Objects.requireNonNull(value, "value");
        if (value.isBlank()) {
            throw new IllegalArgumentException("email must not be blank");
        }
    }
}
```

### 16.3 Record Mutability Trap

Records are shallowly immutable. If a record component is mutable, defensive copying is required.

Forbidden:

```java
public record Report(List<String> rows) {}
```

Allowed:

```java
public record Report(List<String> rows) {
    public Report {
        rows = List.copyOf(rows);
    }
}
```

---

## 17. Enums

Use enums for finite, stable named constants with behavior.

Allowed:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED,
    CLOSED;

    public boolean terminal() {
        return this == APPROVED || this == REJECTED || this == CLOSED;
    }
}
```

Rules:

- enum names must be stable and domain meaningful;
- do not persist enum ordinal;
- do not expose enum names externally if API stability requires separate code;
- avoid giant enums with unrelated behavior;
- prefer enum methods over scattered `switch` when behavior belongs to enum.

---

## 18. Polymorphism

### 18.1 When to Use

Use polymorphism when behavior varies by type and the variation is stable.

Allowed:

```java
public interface FeePolicy {
    Money calculate(FeeContext context);
}
```

Avoid replacing every `if` with polymorphism. Simple branching is acceptable when:

- only two branches exist;
- branch is local and unlikely to grow;
- branch is more readable than hierarchy;
- no separate lifecycle exists.

### 18.2 Switch vs Polymorphism

Use a `switch` when:

- switching over enum/sealed variants;
- behavior is local to one use case;
- all variants must be visible together;
- no subtype owns the behavior.

Use polymorphism when:

- each variant owns behavior;
- new behavior is added less often than new variants;
- behavior requires variant-specific dependencies;
- tests benefit from substitutable implementations.

### 18.3 Visitor

Visitor is restricted. Use only when:

- hierarchy is stable;
- operations vary frequently;
- double dispatch is genuinely needed;
- sealed classes/pattern matching are insufficient or unavailable.

Do not introduce Visitor for ordinary DTO mapping.

---

## 19. Composition

Composition is preferred for reuse.

Rules:

- inject collaborators explicitly;
- depend on behavior contracts, not concrete implementation, when there are multiple implementations or boundary seams;
- keep composed object lifecycle clear;
- avoid circular dependencies;
- avoid service locator.

Allowed:

```java
public final class SubmitCaseUseCase {
    private final CaseRepository cases;
    private final EligibilityPolicy eligibilityPolicy;
    private final DomainEventPublisher events;

    public SubmitCaseUseCase(
            CaseRepository cases,
            EligibilityPolicy eligibilityPolicy,
            DomainEventPublisher events) {
        this.cases = Objects.requireNonNull(cases, "cases");
        this.eligibilityPolicy = Objects.requireNonNull(eligibilityPolicy, "eligibilityPolicy");
        this.events = Objects.requireNonNull(events, "events");
    }
}
```

Forbidden:

```java
public final class SubmitCaseUseCase {
    public void submit(CaseId id) {
        CaseRepository cases = GlobalContext.get(CaseRepository.class);
    }
}
```

---

## 20. Dependency Direction

### 20.1 Layers

Default dependency direction:

```text
API / UI / Controllers
        ↓
Application / Use Cases
        ↓
Domain
        ↑
Infrastructure implements domain/application ports
```

Domain must not depend on:

- HTTP classes;
- JSON annotations unless explicitly approved;
- SQL/JPA/JDBC classes;
- framework dependency injection classes;
- logging implementation details;
- network clients;
- filesystem APIs unless domain is explicitly file-domain.

### 20.2 Ports and Adapters

Use interfaces as ports at the boundary where policy needs infrastructure.

Example:

```java
public interface CaseRepository {
    Optional<Case> findById(CaseId id);
    void save(Case caseRecord);
}
```

Infrastructure implements it:

```java
public final class JdbcCaseRepository implements CaseRepository {
    // JDBC implementation
}
```

Do not place infrastructure logic inside domain object.

---

## 21. Equality and Hashing

### 21.1 General Contract

If `equals` is overridden, `hashCode` must be overridden. Equal objects must produce the same hash code.

### 21.2 When to Override

Override equality for:

- value objects;
- records where default component equality is correct;
- immutable identifiers;
- explicit domain values.

Avoid overriding equality for:

- mutable entities with lifecycle;
- service classes;
- repositories;
- use case/application services;
- framework proxies unless framework rules are understood.

### 21.3 Entity Equality

For domain entities, prefer explicit identity methods and avoid broad `equals` unless necessary.

If using entity equality:

- base it on stable identity only;
- never include mutable lifecycle fields;
- handle not-yet-persisted entity carefully;
- verify behavior with proxies if using ORM.

### 21.4 Mutable Hash Trap

Forbidden:

```java
public final class Person {
    private String email;

    @Override
    public int hashCode() {
        return Objects.hash(email);
    }

    public void changeEmail(String email) {
        this.email = email;
    }
}
```

If object is used as `HashSet` key then `email` changes, lookup breaks.

### 21.5 toString

`toString` must be safe.

Rules:

- do not log secrets;
- do not include huge collections;
- do not trigger lazy loading/I/O;
- include stable identifying information only;
- keep it useful for debugging.

Forbidden fields in `toString`:

- password;
- token;
- private key;
- full personal data;
- unbounded payload/body;
- binary data.

---

## 22. Null Handling

### 22.1 Parameters

Rules:

- public methods must define null policy;
- required constructor/method arguments must use `Objects.requireNonNull` or equivalent validation;
- do not silently convert null to default unless domain explicitly defines it;
- do not use null as control flow.

### 22.2 Return Values

Prefer:

- empty collection instead of null collection;
- `Optional<T>` for maybe-absent return values;
- explicit result object when absence has reason;
- exception when absence violates invariant.

Forbidden:

- `Optional` fields;
- `Optional` parameters;
- returning null from method declared as non-null by convention;
- null elements in collections unless explicitly documented.

### 22.3 Optional Use

Allowed:

```java
public Optional<Case> findById(CaseId id) { ... }
```

Forbidden:

```java
public void submit(Optional<CaseId> id) { ... }
```

Use overloads or explicit command object instead.

---

## 23. Collections and Internal State

### 23.1 Ownership

A class that stores a collection owns its internal representation.

Rules:

- copy mutable input;
- expose immutable view/copy;
- avoid storing caller-owned mutable collection;
- document ordering and uniqueness;
- choose concrete collection intentionally.

Bad:

```java
public final class Team {
    private final List<Member> members;

    public Team(List<Member> members) {
        this.members = members;
    }

    public List<Member> members() {
        return members;
    }
}
```

Good:

```java
public final class Team {
    private final List<Member> members;

    public Team(List<Member> members) {
        this.members = List.copyOf(members);
    }

    public List<Member> members() {
        return members;
    }
}
```

### 23.2 Collection Mutators

Prefer domain-specific mutators:

```java
public void addMember(Member member) {
    Objects.requireNonNull(member, "member");
    if (members.contains(member)) {
        throw new IllegalArgumentException("member already exists");
    }
    members.add(member);
}
```

Do not expose:

```java
public List<Member> getMembersMutable() { return members; }
```

---

## 24. Generics

### 24.1 Raw Types

Raw types are forbidden except when interacting with legacy APIs, and the unchecked operation must be isolated.

Forbidden:

```java
List items = new ArrayList();
```

Allowed:

```java
List<String> items = new ArrayList<>();
```

### 24.2 Wildcards

Use wildcards to express variance at API boundaries.

Producer:

```java
public void addAll(Collection<? extends Event> events) { ... }
```

Consumer:

```java
public void publishTo(Collection<? super DomainEvent> sink) { ... }
```

Do not use wildcards deep inside domain model unless necessary.

### 24.3 Type Erasure

Do not assume generic type is available at runtime.

Forbidden:

```java
if (value instanceof List<String>) { ... } // illegal
```

If runtime type is needed, pass explicit `Class<T>` or type token through a boundary designed for it.

### 24.4 Generic Names

Use conventional names:

- `T` for generic type;
- `E` for element;
- `K`/`V` for key/value;
- `R` for result;
- domain-specific name when clearer.

---

## 25. Object Lifecycle

### 25.1 Lifecycle States

Objects with lifecycle must model states explicitly.

Allowed:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED,
    CLOSED
}
```

State transitions must be controlled by methods:

```java
public void close(Instant closedAt) {
    if (!status.terminal()) {
        throw new IllegalStateException("Only terminal cases can be closed");
    }
    this.status = CaseStatus.CLOSED;
}
```

### 25.2 Invalid State

Do not represent invalid state with vague combinations of booleans.

Forbidden:

```java
boolean submitted;
boolean approved;
boolean rejected;
boolean closed;
```

Prefer enum/sealed state model.

### 25.3 Temporal Fields

Time-dependent objects must accept `Clock` from outside when current time matters.

Forbidden:

```java
this.createdAt = Instant.now();
```

Allowed in testable code:

```java
this.createdAt = clock.instant();
```

---

## 26. Exceptions and Object Boundaries

### 26.1 Domain Exceptions

Use domain-specific exceptions only when they clarify behavior.

Allowed:

```java
throw new CaseStateException("Case cannot be approved from DRAFT state");
```

Forbidden:

```java
throw new Exception("failed");
```

### 26.2 Checked Exceptions

Do not leak low-level checked exceptions into domain model.

Bad:

```java
public final class Case {
    public void attachDocument(Path path) throws IOException { ... }
}
```

Better:

- domain expresses behavior;
- adapter handles file I/O;
- application service coordinates.

### 26.3 Result Objects

Use result objects when failure is expected business outcome.

Example:

```java
public sealed interface EligibilityResult permits Eligible, Ineligible {}
public record Eligible() implements EligibilityResult {}
public record Ineligible(String reason) implements EligibilityResult {}
```

Do not use exceptions for ordinary expected branch outcomes.

---

## 27. Services

### 27.1 Domain Service

Use a domain service when behavior is domain logic but does not naturally belong to a single entity/value object.

Rules:

- stateless or immutable;
- no transaction orchestration;
- no framework dependency;
- clear input/output;
- unit-testable.

Example:

```java
public final class EscalationPolicy {
    public EscalationDecision evaluate(CaseRecord caseRecord, Instant now) {
        // domain decision only
    }
}
```

### 27.2 Application Service / Use Case

Application services orchestrate use cases.

Allowed responsibilities:

- load domain object;
- check authorization boundary if required;
- start transaction via framework boundary;
- call domain behavior;
- save result;
- publish events through port;
- map result to output.

Forbidden responsibilities:

- low-level SQL assembly;
- HTTP client construction per call;
- domain invariant buried only in application service;
- large private helper method jungle;
- direct static global access.

### 27.3 Service Naming

Prefer use-case names:

- `SubmitCaseUseCase`
- `ApproveApplicationUseCase`
- `CalculateEligibilityUseCase`

Avoid generic names:

- `CaseService`
- `ApplicationManager`
- `CommonProcessor`

Generic names are allowed only when the class truly represents a broad stable facade and remains small.

---

## 28. DTOs and Mapping

### 28.1 DTO Rules

DTOs must:

- contain transfer data only;
- avoid business behavior;
- be immutable when possible;
- use explicit field names;
- not expose domain internals accidentally;
- not be reused across unrelated API boundaries.

### 28.2 Domain vs DTO

Forbidden:

```java
public final class Case {
    @JsonProperty("case_id")
    private String id;
}
```

unless the project explicitly allows framework annotations in domain layer.

Preferred:

```java
public record CaseResponse(String id, String status) {}
```

with mapper:

```java
public final class CaseResponseMapper {
    public CaseResponse toResponse(Case caseRecord) {
        return new CaseResponse(caseRecord.id().value(), caseRecord.status().name());
    }
}
```

### 28.3 Mapper Rules

Mappers must:

- be deterministic;
- not call repositories/services/network;
- not make authorization decisions;
- not swallow missing required fields;
- include tests for lossy transformation.

---

## 29. Static Members

### 29.1 Allowed Static

Allowed:

- constants;
- pure utility methods in narrow utility classes;
- static factories;
- stateless singleton enum only when no dependencies and no lifecycle;
- test fixtures in test code.

### 29.2 Forbidden Static

Forbidden:

- mutable global state;
- static service registry;
- static caches without lifecycle/size/expiry/thread-safety;
- static dependency access;
- static methods hiding I/O;
- static initialization that performs network/file/database access.

### 29.3 Utility Classes

Utility classes are restricted.

Rules:

- must be `final`;
- constructor must be private and throw or be empty;
- methods must be pure or explicitly named as side-effecting;
- class name must be precise.

Bad:

```java
public final class CommonUtils { ... }
```

Better:

```java
public final class CaseNumberFormats { ... }
```

---

## 30. Concurrency and OOP

### 30.1 Thread Safety Declaration

Every shared mutable object must document one of:

- immutable;
- thread-confined;
- externally synchronized;
- internally synchronized;
- lock-free/thread-safe;
- not thread-safe.

### 30.2 Mutable State

Do not make mutable services unless necessary.

Service classes should generally be stateless. If they cache, the cache must have:

- maximum size;
- expiry/invalidation;
- concurrency policy;
- metrics;
- tests.

### 30.3 Escaping State

Never expose mutable internals across threads.

Forbidden:

```java
public Map<String, Session> sessions() {
    return sessions;
}
```

Allowed:

```java
public Map<String, SessionSnapshot> sessionSnapshots() {
    return sessions.entrySet().stream()
            .collect(toUnmodifiableMap(Map.Entry::getKey, e -> e.getValue().snapshot()));
}
```

---

## 31. Framework-Managed Objects

### 31.1 Dependency Injection

Prefer constructor injection.

Allowed:

```java
public final class SubmitCaseUseCase {
    private final CaseRepository cases;

    public SubmitCaseUseCase(CaseRepository cases) {
        this.cases = Objects.requireNonNull(cases, "cases");
    }
}
```

Forbidden by default:

- field injection;
- hidden static injection;
- resolving dependencies from application context manually;
- mixing object creation and dependency lookup.

### 31.2 Proxies

When using frameworks that create proxies:

- avoid final classes/methods only where framework requires subclass proxying;
- understand transactional/self-invocation behavior;
- avoid using `equals/hashCode` based on proxy class unless tested;
- do not assume constructor behavior equals runtime proxy behavior.

### 31.3 Annotations

Annotations are allowed at framework boundary.

Domain model annotations are restricted unless:

- persistence framework requires it;
- serialization contract is intentionally tied to domain;
- project architecture approves annotation leakage.

---

## 32. API Surface

### 32.1 Public API

Public methods/classes are expensive to change. Keep public surface minimal.

Rules:

- default to package-private where possible;
- expose interfaces only when there is a real boundary;
- avoid public constructors when factories better communicate intent;
- avoid public mutable types;
- document non-obvious behavior.

### 32.2 Package-Private Design

Use package-private classes to hide implementation details inside a package.

Example:

```java
final class DefaultEligibilityPolicy implements EligibilityPolicy {
    // hidden implementation
}
```

### 32.3 Binary/API Compatibility

For published libraries:

- adding abstract method to public interface is breaking;
- changing constructor signature is breaking;
- changing record components is breaking;
- changing enum names is breaking for serialization/persistence/API;
- narrowing return type may affect binary compatibility;
- removing `public` method is breaking.

LLM must not change public API casually.

---

## 33. Naming Standards

### 33.1 Class Names

Names must reveal responsibility.

Good:

- `CaseNumber`
- `EscalationPolicy`
- `SubmitCaseUseCase`
- `JdbcCaseRepository`
- `CaseResponseMapper`
- `EligibilityDecision`

Bad:

- `CaseHelper`
- `CaseUtil`
- `CaseManager`
- `CaseProcessor`
- `BaseService`
- `CommonHandler`

### 33.2 Method Names

Methods should express intent.

Command methods:

- `submit()`
- `approve()`
- `reject()`
- `assignTo()`
- `close()`

Query methods:

- `isTerminal()`
- `canApprove()`
- `status()`
- `eligibleReasons()`

Avoid vague verbs:

- `process()`
- `handle()`
- `doAction()`
- `execute()`

These are allowed only at explicit generic framework/use-case boundaries.

---

## 34. Law of Demeter / Object Navigation

Avoid deep object navigation.

Forbidden smell:

```java
caseRecord.getApplicant().getProfile().getAddress().getCountry().getCode()
```

Better:

```java
caseRecord.applicantCountryCode()
```

or use a dedicated query/projection.

Do not expose internal object graph just so external callers can compute behavior that belongs inside the model.

---

## 35. Business Rules Placement

### 35.1 Wrong Placement

Forbidden:

- validation only in REST controller;
- status transition only in mapper;
- eligibility rule only in SQL where domain requires it;
- domain rule hidden in UI/frontend;
- rule duplicated across service/controller/repository.

### 35.2 Preferred Placement

| Rule type | Preferred location |
|---|---|
| Object self-validity | constructor/value object/entity method |
| State transition | entity/domain model |
| Cross-entity policy | domain service/policy |
| Use-case orchestration | application service |
| Persistence lookup | repository |
| External decision call | gateway/adapter + application service |
| API shape validation | request DTO/controller boundary |

---

## 36. Copying and Cloning

### 36.1 clone Forbidden

Do not use `Object.clone()` or `Cloneable` for new code.

Preferred alternatives:

- copy constructor;
- static copy factory;
- immutable `withX` method;
- builder from existing object;
- record copy through constructor.

Example:

```java
public CaseSnapshot copy() {
    return new CaseSnapshot(id, status, List.copyOf(notes));
}
```

### 36.2 Defensive Copy

Defensive copy is mandatory for:

- arrays;
- mutable collections;
- mutable date/time legacy classes;
- byte arrays;
- buffers;
- mutable framework types.

---

## 37. Resource Ownership

Objects that own resources must implement explicit lifecycle.

Rules:

- implement `AutoCloseable` when object owns closeable resources;
- document ownership transfer;
- do not rely on GC/finalization;
- no hidden threads without shutdown;
- no hidden scheduled tasks without cancellation.

Example:

```java
public final class ReportWriter implements AutoCloseable {
    private final BufferedWriter writer;

    public ReportWriter(BufferedWriter writer) {
        this.writer = Objects.requireNonNull(writer, "writer");
    }

    @Override
    public void close() throws IOException {
        writer.close();
    }
}
```

If a class does not own the resource, do not close it.

---

## 38. Anti-Patterns

### 38.1 God Class

Symptoms:

- many unrelated dependencies;
- many public methods;
- multiple unrelated reasons to change;
- large private helper sections;
- knows too much about database/API/domain/workflow.

Required fix:

- split by use case;
- extract domain policy;
- move persistence to repository;
- move external calls to gateway;
- introduce value objects for invariants.

### 38.2 Anemic Domain Model

Symptoms:

- entities have only getters/setters;
- services manipulate entity internals;
- business rules scattered in application service;
- invalid states easy to construct.

Fix:

- move state transitions into domain methods;
- replace setters with commands;
- create value objects;
- enforce invariants at construction.

### 38.3 Utility Dump

Symptoms:

- `CommonUtils` grows forever;
- unrelated static methods;
- hidden dependencies;
- low test clarity.

Fix:

- create precise classes;
- move behavior near owning concept;
- make dependencies explicit.

### 38.4 Boolean Parameter Trap

Forbidden smell:

```java
submit(caseId, true, false);
```

Fix:

- use command object;
- use enum;
- split method;
- use named domain concept.

Example:

```java
submit(new SubmitCaseCommand(caseId, SubmissionMode.FORCE_REVIEW));
```

### 38.5 Primitive Obsession

Forbidden smell:

```java
public void approve(String caseId, String officerId, String status) { ... }
```

Fix:

```java
public void approve(CaseId caseId, OfficerId officerId) { ... }
```

Use value objects for important domain primitives.

---

## 39. Testing OOP Design

### 39.1 Mandatory Tests

For each non-trivial object, tests must cover:

- valid construction;
- invalid construction;
- state transitions;
- invariant preservation;
- equality/hash behavior if overridden;
- collection defensive copy behavior;
- null handling;
- polymorphic contract if interface/base class exists;
- concurrency behavior if shared/mutable.

### 39.2 Test Through Behavior

Prefer behavior tests over field-by-field tests.

Bad:

```java
assertEquals(APPROVED, caseRecord.getStatus());
```

Better when meaningful:

```java
assertTrue(caseRecord.isTerminal());
assertThrows(IllegalStateException.class, () -> caseRecord.submit(now));
```

### 39.3 Contract Tests

Interfaces with multiple implementations should have reusable contract tests.

Example:

```java
interface CaseRepositoryContract {
    CaseRepository repository();

    @Test
    default void savesAndLoadsCase() {
        Case saved = new Case(CaseId.newId());
        repository().save(saved);
        assertThat(repository().findById(saved.id())).contains(saved);
    }
}
```

---

## 40. Refactoring Rules

### 40.1 Extract Class

Extract a class when:

- a group of fields forms a concept;
- methods repeatedly pass the same parameter group;
- validation appears in multiple places;
- one class has multiple change reasons;
- a primitive/string has domain semantics.

### 40.2 Introduce Interface

Introduce interface when:

- multiple implementations exist or are expected;
- external dependency needs isolation;
- application/domain boundary needs inversion;
- test seam cannot be achieved cleanly otherwise.

Do not introduce interface only because a service class exists.

### 40.3 Replace Inheritance with Composition

Do this when:

- subclass only reuses helper methods;
- override behavior is fragile;
- superclass has too much state;
- subclass violates base behavior;
- tests require mocking protected internals.

---

## 41. LLM Implementation Protocol

Before modifying OOP code, the LLM must perform this reasoning and reflect it in code choices, not necessarily in final prose:

1. Identify the object category.
2. Identify state owner.
3. Identify invariants.
4. Identify mutability policy.
5. Identify construction path.
6. Identify dependency direction.
7. Identify equality policy.
8. Identify extension policy.
9. Identify tests required.
10. Reject unnecessary abstraction.

### 41.1 Required Output Discipline

When implementing a new class, the LLM must ensure:

- class name is precise;
- constructor validates required fields;
- invalid state is impossible or explicitly isolated;
- public API is minimal;
- no accidental framework leakage;
- no accidental mutable state exposure;
- no speculative design pattern;
- tests are added/updated.

### 41.2 Pattern Justification

If a design pattern is introduced, it must satisfy `strict-coding-standards__design_pattern_in_java.md` and include a minimal justification in code review notes.

---

## 42. Review Checklist

Reviewers must reject code when any answer is “no”:

### Object Responsibility

- [ ] Does each class have one clear responsibility?
- [ ] Is the class name precise?
- [ ] Is there no god class/helper dump?
- [ ] Are methods located near the state/invariant they use?

### Encapsulation

- [ ] Are fields private?
- [ ] Are required fields final where possible?
- [ ] Are mutable internals protected from exposure?
- [ ] Are setters avoided unless justified?
- [ ] Are domain actions named as behavior, not field assignment?

### Invariants

- [ ] Are invariants enforced at construction?
- [ ] Are state transitions controlled?
- [ ] Can invalid state be constructed externally?
- [ ] Are validation rules placed at the correct layer?

### Identity and Equality

- [ ] Is identity vs value semantics clear?
- [ ] Are `equals` and `hashCode` consistent?
- [ ] Are mutable fields excluded from hash identity where needed?
- [ ] Is `toString` safe?

### Inheritance and Interfaces

- [ ] Is inheritance justified by substitutability, not reuse?
- [ ] Are non-inheritable classes final/sealed/package-private?
- [ ] Are interfaces introduced only for real boundaries/contracts?
- [ ] Are default methods not hiding behavior?

### Records and Sealed Types

- [ ] Are records used only for transparent value/data carriers?
- [ ] Are mutable record components defensively copied?
- [ ] Are sealed hierarchies intentionally closed?
- [ ] Are all variants tested?

### Dependencies

- [ ] Does domain avoid framework/infrastructure leakage?
- [ ] Are dependencies injected explicitly?
- [ ] Is there no service locator/global state?
- [ ] Are adapters separated from domain logic?

### Tests

- [ ] Are invalid cases tested?
- [ ] Are state transitions tested?
- [ ] Are polymorphic contracts tested?
- [ ] Are defensive copy/equality tests present when relevant?

---

## 43. LLM Prompt Snippet

Use this snippet when asking an LLM/code agent to implement Java OOP code:

```text
Follow strict-coding-standards__java_oop.md.
Before creating or modifying a class, classify it as entity, value object, domain service, application service, adapter, DTO, event, command, policy, factory, or builder.
Do not create abstractions speculatively.
Prefer composition over inheritance unless substitutability is proven.
Make invalid state unrepresentable where practical.
Validate constructor inputs and preserve invariants after every public method.
Do not expose mutable internal state.
Do not add public setters for domain state.
Do not introduce an interface unless it is a real boundary, multiple implementation contract, plugin point, or test seam that cannot be solved better.
If using records, use them only for transparent immutable data/value carriers and defensively copy mutable components.
If using sealed types, ensure the hierarchy is intentionally closed and all variants are handled/tested.
If overriding equals, also override hashCode and ensure mutable fields do not break hash collections.
Add or update tests for construction, invalid inputs, state transitions, equality, and polymorphic contracts.
```

---

## 44. Source References

This standard is based on Java language/platform behavior and widely accepted Java design constraints. Primary references:

- Java Language Specification, classes, inheritance, overriding, hiding, overloading, access control, and type system:  
  `https://docs.oracle.com/javase/specs/jls/se25/html/index.html`
- Java `Object` API contract for `equals`, `hashCode`, `toString`, `clone`, and lifecycle methods:  
  `https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Object.html`
- Oracle Java tutorials for inheritance, overriding, interfaces, abstract classes, and polymorphism:  
  `https://docs.oracle.com/javase/tutorial/java/IandI/`
- Oracle Java records documentation:  
  `https://docs.oracle.com/en/java/javase/17/language/records.html`
- OpenJDK JEP 395 Records:  
  `https://openjdk.org/jeps/395`
- Oracle Java sealed classes/interfaces documentation:  
  `https://docs.oracle.com/en/java/javase/21/language/sealed-classes-and-interfaces.html`
- Oracle Java generics/type erasure documentation:  
  `https://docs.oracle.com/javase/tutorial/java/generics/erasure.html`
- OpenJDK JEP 421 Deprecate Finalization for Removal:  
  `https://openjdk.org/jeps/421`

---

## 45. Final Rule

Object-oriented Java code is acceptable only when the object model reduces ambiguity.

Reject code that adds classes but does not improve invariants, boundaries, testability, or change safety.

