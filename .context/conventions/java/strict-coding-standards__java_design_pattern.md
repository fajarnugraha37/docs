# Strict Coding Standards — Design Patterns in Java

> **Target language:** Java 11+ with version-aware guidance for Java 17/21/25  
> **Audience:** LLM code agents, human reviewers, maintainers, tech leads  
> **Purpose:** prevent cargo-cult design patterns and force Java implementations to be simple, justified, testable, domain-aligned, and compatible with the project's Java baseline.

---

## 0. Non-negotiable operating rule for LLM agents

When implementing Java code, an LLM agent **MUST** treat design patterns as engineering tools, not decoration.

A design pattern is allowed only when it solves a concrete design force such as:

1. Multiple interchangeable behaviors.
2. Multiple object creation variants.
3. Clear boundary between external and internal models.
4. Stable abstraction over volatile implementation details.
5. Explicit lifecycle/state transition behavior.
6. Composition of responsibilities without inheritance explosion.
7. Controlled access to expensive, remote, unsafe, or stateful resources.
8. Domain rules that must be named, isolated, tested, and evolved.
9. Coordination across components where direct coupling would create cyclic dependency or brittle change impact.

The agent **MUST NOT** introduce a design pattern merely because:

1. The code “looks more professional” with a pattern.
2. A class name can end with `Factory`, `Manager`, `Strategy`, `Handler`, `Processor`, or `Service`.
3. A framework example uses the pattern.
4. The pattern was mentioned in the prompt but the current change does not need it.
5. The agent wants to hide uncertainty behind abstraction.
6. The codebase already has over-engineered examples nearby.
7. A future requirement is only speculative.
8. A simple method, constructor, enum, record, or interface would solve the problem.

Every introduced pattern **MUST** have a visible reason in code structure, naming, tests, or documentation.

---

## 1. Relationship with Java version standards

This document is an overlay standard.

It **DOES NOT** replace version-specific coding standards such as:

- `strict-coding-standards__java11.md`
- `strict-coding-standards__java17.md`
- `strict-coding-standards__java21.md`
- `strict-coding-standards__java25.md`

The agent **MUST** first obey the target project's Java baseline.

### 1.1 Version-aware implementation rule

The same pattern may be implemented differently depending on the Java version.

| Java baseline | Preferred modeling tools |
|---|---|
| Java 11 | interfaces, final classes, immutable objects, enums, lambdas, `Optional`, `Map.of`, `List.of`, standard collections |
| Java 17 | Java 11 tools plus records, sealed classes, pattern matching for `instanceof`, switch expressions, text blocks |
| Java 21 | Java 17 tools plus record patterns, pattern matching for `switch`, sequenced collections, virtual threads where explicitly justified |
| Java 25 | Java 21 tools plus stable Java 25 features only; preview/incubator features remain forbidden unless project enables them |

The agent **MUST NOT** use records, sealed classes, record patterns, pattern matching for switch, or virtual threads unless the project's Java baseline supports them.

### 1.2 Pattern intent survives syntax

Modern Java syntax does not remove the need for design judgment.

Examples:

- A `record` can implement a DTO, Value Object, Command, Query, Event, or Specification parameter object, but a record is not automatically a pattern.
- A `sealed interface` can model a closed state/event hierarchy, but it is not automatically a state machine.
- A lambda can implement Strategy or Command, but not every lambda should be named as a pattern.
- A switch expression can centralize branching, but it can also become a procedural god-method.
- Virtual threads can simplify blocking concurrency, but they are not a replacement for backpressure, bulkheads, idempotency, or resource limits.

---

## 2. Design pattern decision protocol

Before introducing a design pattern, the agent **MUST** pass this protocol.

### 2.1 Required decision questions

1. **Problem:** What concrete design problem exists now?
2. **Change axis:** What part of the code is expected to vary independently?
3. **Invariant:** What rule must remain stable even when implementations vary?
4. **Boundary:** Which dependency, framework, API, persistence model, workflow, or domain concept is being isolated?
5. **Simpler alternative:** Would a private method, constructor, enum, map, function, record, or direct dependency be enough?
6. **Cost:** What extra classes/interfaces/indirection will this add?
7. **Testability:** How will the pattern be tested without relying on incidental implementation details?
8. **Failure behavior:** What happens when no strategy/factory/handler/state matches?
9. **Discoverability:** Will a maintainer understand the pattern from names and package structure?
10. **Compatibility:** Does the implementation obey the project's Java baseline?

If the answer to questions 1, 2, 3, or 5 is unclear, the agent **MUST NOT** introduce the pattern.

### 2.2 Pattern introduction threshold

A pattern is justified only when at least one of the following is true:

1. There are at least two current implementations and a realistic expectation of more.
2. The abstraction isolates an external system, framework, transport, storage, or vendor.
3. The abstraction protects a domain invariant from duplication.
4. The pattern makes invalid states/transitions harder to represent.
5. The pattern reduces coupling across modules/packages.
6. The pattern improves testability by isolating a hard dependency.
7. The pattern documents a domain concept better than a procedural branch.
8. The pattern localizes failure handling, retry, fallback, validation, or authorization behavior.

The agent **MUST NOT** introduce a new pattern for a single implementation unless it is protecting a clear boundary or invariant.

### 2.3 Minimality rule

When a pattern is justified, the agent **MUST** implement the smallest version that solves the actual problem.

Forbidden by default:

- `AbstractSomethingFactoryProviderRegistryResolver`
- multi-layer factories with one implementation
- marker interfaces without behavior or type-safety value
- abstract base classes used only to share two lines of code
- `Manager` classes that coordinate unrelated concerns
- reflection-based registration when compile-time wiring is enough
- global registries without lifecycle ownership
- generic `Map<String, Object>` pattern contexts
- catch-all `execute(Object input)` APIs
- design pattern scaffolding without tests

---

## 3. Pattern evidence requirement

When modifying code, the agent **MUST** leave evidence that the pattern is intentional.

At least one of these evidence forms must exist:

1. Clear type names that reveal the role: `PaymentPolicy`, `CaseState`, `DocumentParser`, `NotificationChannel`.
2. Tests that prove interchangeable behavior or state transitions.
3. Package structure that groups the pattern roles.
4. Javadoc on public abstractions explaining the domain role and invariant.
5. Factory/registry failure behavior for unknown type.
6. Exhaustive switch over sealed hierarchy where Java baseline allows it.
7. ADR/comment for non-obvious architecture-level pattern.

The agent **MUST NOT** add comments like `// Strategy pattern` as a substitute for clear design.

---

## 4. Naming standards for pattern roles

Names **MUST** reveal domain intent first and pattern role second.

Prefer:

```java
interface EligibilityPolicy { ... }
final class LicenseRenewalEligibilityPolicy implements EligibilityPolicy { ... }
```

Avoid:

```java
interface Strategy { ... }
final class ConcreteStrategyA implements Strategy { ... }
```

### 4.1 Allowed suffixes

Use suffixes only when they add clarity.

| Suffix | Allowed when |
|---|---|
| `Policy` | Encapsulates a business rule or decision |
| `Strategy` | Encapsulates interchangeable algorithmic behavior |
| `Factory` | Creates objects while hiding construction variants |
| `Builder` | Constructs complex objects step-by-step or with many optional fields |
| `Adapter` | Converts one interface/model/protocol into another |
| `Mapper` | Converts data shape without business behavior |
| `Assembler` | Builds richer domain/API objects from multiple inputs |
| `Facade` | Provides a simplified boundary over a subsystem |
| `Handler` | Handles a command/event/request in a chain or dispatch model |
| `Command` | Represents an action/request as a first-class object |
| `Event` | Represents something that already happened |
| `State` | Represents lifecycle behavior for a domain state |
| `Specification` | Represents a composable predicate/rule with domain meaning |
| `Repository` | Abstracts aggregate persistence access |
| `Gateway` | Abstracts external system communication |
| `Client` | Implements low-level remote/system call behavior |
| `Resolver` | Chooses a value/type/handler from context |
| `Registry` | Holds known implementations with clear ownership and lifecycle |
| `Coordinator` | Coordinates a workflow without owning domain rules |

### 4.2 Suspicious suffixes

The agent **MUST** avoid these unless the codebase already uses them consistently and the role is clear:

- `Manager`
- `Helper`
- `Util`
- `Processor`
- `ServiceImpl`
- `Common`
- `Base`
- `Abstract`
- `Generic`
- `Default`
- `Executor`
- `Orchestrator`

They are not banned universally, but they often hide poor boundaries.

If used, the class must have a narrow, explicit responsibility.

---

## 5. Package and dependency direction

Pattern roles **MUST** respect dependency direction.

### 5.1 Dependency rule

Domain abstractions should not depend on infrastructure implementations.

Allowed:

```text
domain -> domain abstractions
application -> domain + ports
infrastructure -> application/domain ports
api -> application
```

Forbidden:

```text
domain -> database
service -> controller
entity -> HTTP client
policy -> Spring framework annotation, unless policy is explicitly infrastructure-owned
repository interface -> repository implementation
```

### 5.2 Pattern package examples

Prefer domain-oriented packages:

```text
casehandling/
  domain/
    Case.java
    CaseStatus.java
    CaseTransitionPolicy.java
    CaseState.java
  application/
    SubmitCaseCommand.java
    SubmitCaseHandler.java
  infrastructure/
    OracleCaseRepository.java
    EmailNotificationGateway.java
```

Avoid pattern-catalog packages:

```text
patterns/
  strategy/
  factory/
  adapter/
```

A package named after a pattern is allowed only for educational/demo code, not business production code.

---

## 6. Core principle: prefer explicit domain modeling over pattern catalog thinking

The agent **MUST** model the domain concept first.

Bad framing:

> “We need Strategy because there are many if statements.”

Better framing:

> “Eligibility differs by license type and must evolve independently, so use `EligibilityPolicy` implementations selected by `LicenseType`.”

Bad framing:

> “Use State pattern.”

Better framing:

> “Case lifecycle transitions have state-specific validation and side effects, so represent state behavior explicitly and reject illegal transitions at one boundary.”

Bad framing:

> “Use Factory.”

Better framing:

> “Object creation depends on external request type and must validate unknown types, so use a factory/registry with explicit failure behavior.”

---

## 7. Creational patterns

## 7.1 Factory Method

### Intent

Use Factory Method when object creation depends on a known variant but the caller should not know concrete implementation details.

### Allowed when

1. Construction differs by type, channel, provider, version, tenant, or domain category.
2. The caller only needs an interface or superclass.
3. Unknown type handling must be centralized.
4. Creation requires validation, normalization, defaulting, or dependency composition.
5. Tests need to verify selected implementation for input variants.

### Forbidden when

1. There is only one concrete class and no real creation variability.
2. The factory only calls `new Something()` with no abstraction value.
3. The factory hides simple constructor parameters without reducing coupling.
4. The factory returns `Object` or raw types.
5. The factory uses reflection without a strict allow-list.

### Java standard

Prefer:

```java
interface DocumentParser {
    ParsedDocument parse(byte[] content);
}

final class DocumentParserFactory {
    private final Map<DocumentType, DocumentParser> parsers;

    DocumentParserFactory(Map<DocumentType, DocumentParser> parsers) {
        this.parsers = Map.copyOf(parsers);
    }

    DocumentParser parserFor(DocumentType type) {
        DocumentParser parser = parsers.get(type);
        if (parser == null) {
            throw new UnsupportedDocumentTypeException(type);
        }
        return parser;
    }
}
```

The agent **MUST** define explicit behavior for unknown type.

The agent **MUST NOT** return `null` when no implementation matches.

---

## 7.2 Abstract Factory

### Intent

Use Abstract Factory when the system must create a family of related objects that must remain compatible.

### Allowed when

1. There are multiple product families.
2. Objects in one family must not be mixed with objects from another family.
3. Creation is selected by tenant, provider, platform, protocol version, region, or deployment mode.
4. The family boundary prevents invalid combinations.

### Forbidden when

1. Only one product type exists.
2. The factory family is invented for hypothetical future products.
3. The implementation creates needless parallel class hierarchies.
4. A simple configuration object would be enough.

### Java standard

Prefer a small interface with cohesive creation methods:

```java
interface NotificationFactory {
    NotificationMessage createMessage(NotificationRequest request);
    NotificationSender createSender();
}
```

The agent **MUST** ensure all objects created by the factory belong to the same compatibility family.

---

## 7.3 Builder

### Intent

Use Builder when object construction has many optional fields, staged validation, readable setup, or must prevent inconsistent construction.

### Allowed when

1. Constructor would have too many parameters.
2. Several optional parameters exist.
3. Construction must validate cross-field invariants.
4. Test readability improves materially.
5. The built object is immutable.
6. The builder represents a staged workflow or DSL with real constraints.

### Forbidden when

1. The object has fewer than four simple required fields.
2. The builder bypasses validation.
3. The builder creates mutable partially initialized objects.
4. The builder mirrors every setter without adding invariants.
5. The builder is used to avoid thinking about constructors.

### Java standard

Prefer immutable target object:

```java
public final class CaseSearchCriteria {
    private final String applicantName;
    private final CaseStatus status;
    private final LocalDate submittedFrom;
    private final LocalDate submittedTo;

    private CaseSearchCriteria(Builder builder) {
        this.applicantName = builder.applicantName;
        this.status = builder.status;
        this.submittedFrom = builder.submittedFrom;
        this.submittedTo = builder.submittedTo;
        validateDateRange(submittedFrom, submittedTo);
    }

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private String applicantName;
        private CaseStatus status;
        private LocalDate submittedFrom;
        private LocalDate submittedTo;

        public Builder applicantName(String applicantName) {
            this.applicantName = applicantName;
            return this;
        }

        public Builder status(CaseStatus status) {
            this.status = status;
            return this;
        }

        public Builder submittedFrom(LocalDate submittedFrom) {
            this.submittedFrom = submittedFrom;
            return this;
        }

        public Builder submittedTo(LocalDate submittedTo) {
            this.submittedTo = submittedTo;
            return this;
        }

        public CaseSearchCriteria build() {
            return new CaseSearchCriteria(this);
        }
    }
}
```

For Java 16+, records may reduce the need for builders when all fields are required and validation is simple.

The agent **MUST NOT** add Lombok-style builders unless the project already uses Lombok and the version-specific standard allows it.

---

## 7.4 Singleton

### Intent

Use Singleton only when exactly one instance per JVM is a real invariant and global access does not harm testability or lifecycle control.

### Allowed when

1. The object is stateless and immutable.
2. The object represents a fixed constant service with no external resources.
3. The singleton is an enum with no mutable state.
4. The object has no environment-specific lifecycle.

### Forbidden when

1. The singleton holds request/user/tenant/session-specific state.
2. The singleton wraps database connections, HTTP clients, thread pools, caches, credentials, clocks, random generators, or mutable configuration without lifecycle ownership.
3. Dependency injection is available and should own the lifecycle.
4. Tests need different instances/configurations.
5. The singleton exists only to avoid passing dependencies.

### Java standard

Prefer dependency injection over Singleton in application code.

If a singleton is truly needed and stateless:

```java
enum UuidFormatPolicy {
    INSTANCE;

    boolean isValid(String value) {
        return value != null && value.length() == 36;
    }
}
```

The agent **MUST NOT** implement double-checked locking manually unless there is a specific concurrency reason and the code is reviewed carefully.

The agent **MUST NOT** use singleton as a service locator.

---

## 7.5 Prototype

### Intent

Use Prototype when object creation is expensive and new instances can be derived safely from a known template.

### Allowed when

1. Template state is immutable or deeply copied.
2. Object creation cost is measurable and relevant.
3. The clone operation preserves invariants.
4. The prototype is local to a bounded context.

### Forbidden when

1. Shallow copy would share mutable state accidentally.
2. `Cloneable` is used blindly.
3. Copy constructors or records would be clearer.
4. The pattern hides persistence identity mistakes.

### Java standard

Prefer copy constructors, static copy methods, or record `with`-style methods over `Cloneable`.

```java
final class NotificationTemplate {
    private final String subject;
    private final String body;

    NotificationTemplate(String subject, String body) {
        this.subject = Objects.requireNonNull(subject, "subject");
        this.body = Objects.requireNonNull(body, "body");
    }

    NotificationTemplate withSubject(String newSubject) {
        return new NotificationTemplate(newSubject, body);
    }
}
```

The agent **MUST NOT** use `Object.clone()` as the default prototype implementation.

---

## 7.6 Object Pool

### Intent

Use Object Pool only for scarce, expensive resources where pooling is proven useful and lifecycle control is correct.

### Allowed when

1. Resource creation is expensive and measured.
2. Resource count must be bounded.
3. The resource has explicit acquire/release lifecycle.
4. Pool exhaustion behavior is defined.
5. A mature library or framework pool is already used.

### Forbidden when

1. Pooling ordinary Java objects.
2. Pooling objects to “reduce GC” without measurement.
3. Pooling non-resettable mutable objects.
4. Creating custom connection pools instead of using mature libraries.
5. Hiding resource leaks.

### Java standard

The agent **MUST** prefer framework/library pools for DB connections, HTTP clients, and thread pools.

The agent **MUST NOT** create a custom pool unless the user explicitly asks and tests cover exhaustion, release, timeout, and leak behavior.

---

# 8. Structural patterns

## 8.1 Adapter

### Intent

Use Adapter to translate between incompatible interfaces, protocols, models, or external system contracts.

### Allowed when

1. Integrating external APIs, legacy code, vendor SDKs, generated clients, or old modules.
2. Translating external DTOs to domain models.
3. Protecting domain code from transport/persistence/vendor shape.
4. Preserving a stable internal interface while external API changes.

### Forbidden when

1. The adapter only renames methods without isolating anything.
2. Domain models are made to look like vendor DTOs.
3. External exceptions leak into domain/application layers.
4. Mapping is partial and silently drops important fields.

### Java standard

```java
interface AddressLookupGateway {
    Address lookup(PostalCode postalCode);
}

final class OneMapAddressLookupAdapter implements AddressLookupGateway {
    private final OneMapClient client;
    private final OneMapAddressMapper mapper;

    OneMapAddressLookupAdapter(OneMapClient client, OneMapAddressMapper mapper) {
        this.client = Objects.requireNonNull(client, "client");
        this.mapper = Objects.requireNonNull(mapper, "mapper");
    }

    @Override
    public Address lookup(PostalCode postalCode) {
        OneMapResponse response = client.lookup(postalCode.value());
        return mapper.toAddress(response);
    }
}
```

The agent **MUST** map external failures to internal exception/result types at the boundary.

---

## 8.2 Facade

### Intent

Use Facade to provide a simple use-case-oriented boundary over a complex subsystem.

### Allowed when

1. A caller currently needs to coordinate many components directly.
2. The facade represents a stable use case.
3. The subsystem complexity is real and should be hidden.
4. The facade reduces coupling, not just method count.

### Forbidden when

1. The facade becomes a god service.
2. The facade duplicates methods one-to-one from dependencies.
3. The facade hides important failure modes.
4. The facade owns domain rules that belong in policies/entities/state machines.

### Java standard

A facade method **MUST** read like an application use case:

```java
final class CaseSubmissionFacade {
    private final CaseRepository caseRepository;
    private final CaseSubmissionPolicy submissionPolicy;
    private final NotificationGateway notificationGateway;

    CaseSubmissionFacade(
            CaseRepository caseRepository,
            CaseSubmissionPolicy submissionPolicy,
            NotificationGateway notificationGateway) {
        this.caseRepository = Objects.requireNonNull(caseRepository, "caseRepository");
        this.submissionPolicy = Objects.requireNonNull(submissionPolicy, "submissionPolicy");
        this.notificationGateway = Objects.requireNonNull(notificationGateway, "notificationGateway");
    }

    SubmitCaseResult submit(SubmitCaseCommand command) {
        Case existing = caseRepository.get(command.caseId());
        submissionPolicy.validate(existing, command);
        Case submitted = existing.submit(command.submittedBy());
        caseRepository.save(submitted);
        notificationGateway.notifySubmitted(submitted);
        return SubmitCaseResult.success(submitted.id());
    }
}
```

The agent **MUST** keep facade methods cohesive and use-case based.

---

## 8.3 Decorator

### Intent

Use Decorator to add behavior around an object implementing the same abstraction without changing the object.

### Allowed when

1. Adding logging, metrics, tracing, authorization, validation, caching, retry, rate limiting, or auditing around a component.
2. Behavior should be composable and order is explicit.
3. The decorated interface is stable and narrow.
4. Tests can verify the wrapper behavior independently.

### Forbidden when

1. The decorator changes the semantic contract unexpectedly.
2. Order of multiple decorators is important but undocumented.
3. The decorator catches and hides exceptions.
4. The decorator depends on concrete implementation internals.
5. Inheritance would be simpler and safe for a closed internal class.

### Java standard

```java
final class AuditingCaseRepository implements CaseRepository {
    private final CaseRepository delegate;
    private final AuditLog auditLog;

    AuditingCaseRepository(CaseRepository delegate, AuditLog auditLog) {
        this.delegate = Objects.requireNonNull(delegate, "delegate");
        this.auditLog = Objects.requireNonNull(auditLog, "auditLog");
    }

    @Override
    public void save(Case value) {
        delegate.save(value);
        auditLog.recordCaseSaved(value.id());
    }
}
```

The agent **MUST** name the delegate `delegate` unless the codebase has a stronger convention.

---

## 8.4 Proxy

### Intent

Use Proxy to control access to another object, especially remote calls, lazy access, authorization, transaction boundaries, or expensive operations.

### Allowed when

1. Access requires authorization or permission checks.
2. Remote/network behavior must be abstracted.
3. Lazy loading is needed and safe.
4. Calls require timeout, retry, circuit breaker, or monitoring.
5. A framework proxy is already used intentionally.

### Forbidden when

1. Proxy hides network latency behind a local-looking method without naming it as gateway/client.
2. Proxy performs business logic unrelated to access control or boundary behavior.
3. Lazy proxy can fail unpredictably outside transaction/session boundaries.
4. Proxy uses reflection where typed delegation is enough.

### Java standard

The agent **MUST** make remote boundaries visible in names.

Prefer `PaymentGateway`, `IdentityProviderClient`, `CaseDocumentClient` over local domain-looking names.

---

## 8.5 Composite

### Intent

Use Composite when clients should treat individual objects and groups uniformly.

### Allowed when

1. The domain has tree-like or recursive structure.
2. Operations apply to both leaf and group nodes.
3. The hierarchy has clear parent-child invariants.
4. Traversal behavior is tested.

### Forbidden when

1. The structure is not recursive.
2. Parent-child ownership is ambiguous.
3. The composite allows cycles unless explicitly supported and guarded.
4. The abstraction hides important distinction between leaf and group.

### Java standard

For Java 17+, sealed hierarchies are preferred for closed composites:

```java
sealed interface RequirementNode permits RequirementGroup, RequirementLeaf {
    boolean isSatisfiedBy(Application application);
}

record RequirementLeaf(Requirement requirement) implements RequirementNode {
    @Override
    public boolean isSatisfiedBy(Application application) {
        return requirement.isSatisfiedBy(application);
    }
}

record RequirementGroup(List<RequirementNode> children) implements RequirementNode {
    RequirementGroup {
        children = List.copyOf(children);
    }

    @Override
    public boolean isSatisfiedBy(Application application) {
        return children.stream().allMatch(child -> child.isSatisfiedBy(application));
    }
}
```

For Java 11, use interface plus final implementations.

The agent **MUST** protect against accidental mutation of child collections.

---

## 8.6 Bridge

### Intent

Use Bridge when abstraction and implementation must vary independently.

### Allowed when

1. Two dimensions of variation exist.
2. Inheritance would create class explosion.
3. The implementation detail must be replaceable without changing the abstraction.
4. The abstraction owns domain semantics, while implementation owns technology/provider specifics.

### Forbidden when

1. There is only one variation axis.
2. The bridge merely wraps one class.
3. The abstraction and implementation are not independently replaceable.
4. The bridge makes navigation harder than direct composition.

### Java standard

```java
interface ReportRenderer {
    RenderedReport render(ReportData data);
}

final class ComplianceReport {
    private final ReportRenderer renderer;

    ComplianceReport(ReportRenderer renderer) {
        this.renderer = Objects.requireNonNull(renderer, "renderer");
    }

    RenderedReport generate(ReportData data) {
        return renderer.render(data);
    }
}
```

The agent **MUST** explain the two variation axes before introducing Bridge.

---

## 8.7 Flyweight

### Intent

Use Flyweight to share immutable intrinsic state across many objects.

### Allowed when

1. Many equivalent immutable objects are created.
2. Memory pressure is measured or obvious from volume.
3. Shared state is truly immutable.
4. Identity semantics are not broken by sharing.

### Forbidden when

1. State is mutable.
2. Sharing changes object identity behavior.
3. The cache can grow unbounded.
4. Interning arbitrary user input without limits.
5. Premature optimization.

### Java standard

Use bounded caches or static constants for small fixed sets.

The agent **MUST NOT** implement global unbounded flyweight maps.

---

# 9. Behavioral patterns

## 9.1 Strategy / Policy

### Intent

Use Strategy when an algorithm varies. Use Policy when a business decision varies.

### Allowed when

1. Multiple algorithms or decision rules exist.
2. Selection is based on explicit context such as type, status, tenant, version, or channel.
3. Each implementation can be tested independently.
4. The caller should not contain branching over all variants.
5. The variant is expected to evolve independently.

### Forbidden when

1. There is only one branch.
2. Branching is trivial and local.
3. Strategy implementations share most code due to bad decomposition.
4. The selection key is a raw string when enum/value object is available.
5. The strategy mutates hidden shared state.

### Java standard

```java
interface EligibilityPolicy {
    EligibilityResult evaluate(Application application);

    LicenseType licenseType();
}

final class EligibilityPolicyRegistry {
    private final Map<LicenseType, EligibilityPolicy> policies;

    EligibilityPolicyRegistry(List<EligibilityPolicy> policies) {
        this.policies = policies.stream()
                .collect(Collectors.toUnmodifiableMap(
                        EligibilityPolicy::licenseType,
                        Function.identity()));
    }

    EligibilityPolicy policyFor(LicenseType licenseType) {
        EligibilityPolicy policy = policies.get(licenseType);
        if (policy == null) {
            throw new UnsupportedLicenseTypeException(licenseType);
        }
        return policy;
    }
}
```

The agent **MUST** define duplicate-key behavior when building registries.

The agent **MUST NOT** silently choose the first matching strategy when multiple match.

### Lambda strategy rule

A lambda is allowed for small stateless local strategies.

Use a named class when:

1. The strategy has domain meaning.
2. The strategy needs tests.
3. The strategy has dependencies.
4. The strategy has non-trivial failure behavior.
5. The strategy should be discoverable by name.

---

## 9.2 Template Method

### Intent

Use Template Method when an algorithm skeleton is stable but some steps vary.

### Allowed when

1. The algorithm order is invariant.
2. Steps are few and meaningful.
3. Subclasses cannot violate the skeleton.
4. Inheritance is truly appropriate.

### Forbidden when

1. Composition with Strategy would be clearer.
2. Subclasses need to override too many steps.
3. Hook methods create invisible behavior.
4. The base class owns mutable shared state.
5. The pattern is used only for code reuse.

### Java standard

Prefer final template method:

```java
abstract class CaseImportTemplate {
    public final ImportResult importCase(ImportSource source) {
        RawCase raw = read(source);
        ValidatedCase validated = validate(raw);
        Case saved = persist(validated);
        afterPersist(saved);
        return ImportResult.success(saved.id());
    }

    protected abstract RawCase read(ImportSource source);

    protected abstract ValidatedCase validate(RawCase raw);

    protected abstract Case persist(ValidatedCase validated);

    protected void afterPersist(Case saved) {
        // optional hook; default intentionally empty
    }
}
```

The agent **MUST** justify inheritance. Default to composition if uncertain.

---

## 9.3 Command

### Intent

Use Command to represent a request/action as an object with explicit input, validation, execution, auditing, queuing, retry, or authorization behavior.

### Allowed when

1. Actions need to be queued, logged, retried, authorized, validated, or dispatched.
2. The command object is useful as an application boundary.
3. The command separates input from execution behavior.
4. The command has a stable lifecycle.

### Forbidden when

1. A method call is enough.
2. Command contains persistence entities directly from API layer.
3. Command has unclear ownership of validation.
4. Command handlers become god services.

### Java standard

For Java 16+, records are preferred for immutable command payloads:

```java
public record SubmitCaseCommand(
        CaseId caseId,
        UserId submittedBy,
        Instant submittedAt) {
    public SubmitCaseCommand {
        Objects.requireNonNull(caseId, "caseId");
        Objects.requireNonNull(submittedBy, "submittedBy");
        Objects.requireNonNull(submittedAt, "submittedAt");
    }
}
```

For Java 11, use final class with final fields.

Command handlers **MUST** have a narrow responsibility and explicit transaction/failure boundary.

---

## 9.4 Chain of Responsibility

### Intent

Use Chain of Responsibility when multiple handlers may process a request in sequence and each handler can pass, stop, reject, or enrich the request.

### Allowed when

1. Handler order is meaningful and explicit.
2. Each handler has one reason to exist.
3. The chain result type makes stop/continue/reject explicit.
4. Tests cover ordering and short-circuit behavior.
5. The chain avoids a large procedural method.

### Forbidden when

1. Handler order is hidden in dependency injection magic.
2. Handlers mutate shared context unpredictably.
3. Exceptions are used for normal control flow.
4. All handlers always run and there is no chain decision.
5. The chain is just a list of unrelated operations.

### Java standard

Prefer explicit result objects:

```java
interface CaseValidationHandler {
    ValidationStepResult validate(CaseDraft draft);
}

enum ValidationDecision {
    CONTINUE,
    STOP_VALID,
    STOP_INVALID
}
```

The agent **MUST** make ordering visible through constructor injection, explicit list ordering, or configuration with tests.

The agent **MUST NOT** rely on incidental reflection/classpath ordering.

---

## 9.5 State

### Intent

Use State when behavior depends on lifecycle state and state-specific behavior should be localized.

### Allowed when

1. The entity has a real lifecycle.
2. Legal transitions differ by current state.
3. State-specific behavior is growing beyond simple enum checks.
4. Invalid transitions must be rejected consistently.
5. Auditability of transitions matters.
6. Tests need a transition matrix.

### Forbidden when

1. State is just a display label.
2. A simple enum and switch is enough.
3. State objects can mutate the aggregate inconsistently.
4. Transition rules are duplicated across states.
5. Persistence model cannot represent the lifecycle safely.

### Java 17+ standard with sealed state hierarchy

```java
sealed interface CaseState permits DraftState, SubmittedState, ClosedState {
    CaseStatus status();

    CaseState submit(UserId actor);

    CaseState close(UserId actor);
}

final class DraftState implements CaseState {
    @Override
    public CaseStatus status() {
        return CaseStatus.DRAFT;
    }

    @Override
    public CaseState submit(UserId actor) {
        return new SubmittedState(actor);
    }

    @Override
    public CaseState close(UserId actor) {
        throw new InvalidCaseTransitionException(CaseStatus.DRAFT, CaseStatus.CLOSED);
    }
}
```

### Java 11 standard

Use enum plus transition policy or interface plus final classes.

The agent **MUST** include tests for valid and invalid transitions.

The agent **MUST** avoid scattering state checks across controllers, services, repositories, and UI mappers.

---

## 9.6 Observer / Publisher-Subscriber

### Intent

Use Observer or Pub/Sub when a state change must notify multiple independent consumers without coupling the producer to each consumer.

### Allowed when

1. Multiple independent side effects follow one event.
2. Consumers can evolve independently.
3. Ordering and delivery semantics are defined.
4. Failure behavior is explicit.
5. Events represent facts that already happened.

### Forbidden when

1. A direct method call is clearer.
2. Event names are commands disguised as events.
3. Delivery semantics are unknown.
4. Event handlers mutate the same aggregate in uncontrolled order.
5. Pub/sub is used to hide synchronous coupling.

### Java standard

Event names **MUST** be past tense:

- `CaseSubmitted`
- `DocumentUploaded`
- `PaymentVerified`

Avoid command-like event names:

- `SubmitCaseEvent`
- `SendEmailEvent`
- `ValidateApplicationEvent`

The agent **MUST** define whether event dispatch is synchronous, asynchronous, transactional, at-least-once, at-most-once, or best-effort.

---

## 9.7 Visitor

### Intent

Use Visitor when operations vary over a stable object structure and adding new operations is more common than adding new element types.

### Allowed when

1. The element hierarchy is stable.
2. Many operations need to traverse the hierarchy.
3. Operations should be separated from element classes.
4. Double-dispatch or exhaustive pattern matching has clear value.

### Forbidden when

1. Element types change frequently.
2. A simple method on the object is clearer.
3. Java 17+ sealed types with switch expression would be clearer.
4. Visitor creates boilerplate disproportionate to value.

### Java standard

For Java 17+, prefer sealed hierarchy plus exhaustive switch when operations are local and limited.

Use Visitor when operations are many, independently owned, or need separate modules.

The agent **MUST** explain why Visitor is better than polymorphism or pattern switch.

---

## 9.8 Specification

### Intent

Use Specification to model a business predicate/rule that can be named, composed, tested, and reused.

### Allowed when

1. The rule has domain meaning.
2. Rules need composition with `and`, `or`, `not`.
3. Rules are reused across use cases.
4. Rules need independent tests.
5. Rules may be translated to query criteria carefully.

### Forbidden when

1. The predicate is local and obvious.
2. Specification is used as a generic wrapper around every boolean.
3. The spec mixes in database, HTTP, or UI concerns.
4. Composition hides expensive operations.
5. In-memory specification is assumed to be equivalent to SQL semantics without tests.

### Java standard

```java
interface Specification<T> {
    boolean isSatisfiedBy(T candidate);

    default Specification<T> and(Specification<T> other) {
        Objects.requireNonNull(other, "other");
        return candidate -> this.isSatisfiedBy(candidate) && other.isSatisfiedBy(candidate);
    }
}

final class ActiveLicenceSpecification implements Specification<Licence> {
    @Override
    public boolean isSatisfiedBy(Licence candidate) {
        return candidate.status() == LicenceStatus.ACTIVE;
    }
}
```

The agent **MUST** keep business specifications deterministic and side-effect free.

---

## 9.9 Mediator

### Intent

Use Mediator when many components communicate in a way that creates tangled dependencies and coordination should be centralized.

### Allowed when

1. Components have many-to-many interaction.
2. Coordination is workflow-level, not domain rule-level.
3. Direct references would cause cycles.
4. The mediator has a narrow orchestration purpose.

### Forbidden when

1. The mediator becomes a god object.
2. Domain rules are moved into mediator procedural code.
3. Component interactions are simple and direct.
4. The mediator hides important dependencies.

### Java standard

Prefer names like `CaseWorkflowCoordinator` over generic `Mediator`.

The agent **MUST** keep mediator dependencies explicit.

---

## 9.10 Memento

### Intent

Use Memento to capture and restore object state without exposing internals.

### Allowed when

1. Undo/redo or rollback is a real requirement.
2. Snapshot size is bounded or controlled.
3. Snapshot state is immutable.
4. Restore behavior preserves invariants.

### Forbidden when

1. Persistence/audit log is the real requirement.
2. Snapshots are large and unbounded.
3. Sensitive data is stored unnecessarily.
4. Restore bypasses validation.

### Java standard

Use immutable snapshot types.

The agent **MUST** avoid serializing arbitrary objects as mementos unless explicitly required and secured.

---

## 9.11 Iterator

### Intent

Use Iterator when clients need controlled traversal without exposing internal representation.

### Allowed when

1. Collection internals must be hidden.
2. Traversal requires paging, streaming, filtering, or resource control.
3. The underlying source is large or external.
4. The iterator contract is safer than exposing a collection.

### Forbidden when

1. A standard collection view is enough.
2. Iterator owns resources but caller cannot close it.
3. Traversal order is unclear.
4. It hides expensive remote/database calls.

### Java standard

Prefer standard `Iterable`, `Iterator`, `Stream`, or pagination types.

For streams backed by I/O, the agent **MUST** use try-with-resources.

---

# 10. Enterprise and architecture patterns

## 10.1 Repository

### Intent

Use Repository to abstract aggregate persistence and express collection-like access to domain objects.

### Allowed when

1. Domain/application code should not depend on persistence framework details.
2. Persistence access is aggregate-oriented.
3. Query methods reflect domain use cases.
4. Infrastructure implementations can vary.

### Forbidden when

1. Repository simply exposes ORM methods one-to-one.
2. Repository returns persistence entities to upper layers when domain models should be protected.
3. Repository performs business decisions.
4. Repository hides slow queries or N+1 behavior.
5. Generic repository erases domain intent.

### Java standard

Prefer domain-specific methods:

```java
interface CaseRepository {
    Optional<Case> findById(CaseId id);

    Case getRequired(CaseId id);

    void save(Case value);
}
```

Avoid generic repositories:

```java
interface GenericRepository<T, ID> {
    T find(ID id);
    void save(T entity);
}
```

Generic repositories are allowed only when the framework already provides them and domain-specific interfaces extend them carefully.

---

## 10.2 Service Layer / Application Service

### Intent

Use Application Service to coordinate use cases, transactions, authorization, repositories, policies, gateways, and events.

### Allowed when

1. A use case spans multiple domain objects or dependencies.
2. Transaction boundary must be explicit.
3. Authorization/audit/application concerns are needed.
4. The service coordinates but does not own domain invariants.

### Forbidden when

1. Service becomes a procedural dump of all business rules.
2. Service has too many unrelated public methods.
3. Service knows controller DTOs and persistence details simultaneously.
4. Service mutates entities without domain methods/policies.

### Java standard

Application service methods **MUST** represent use cases.

Prefer:

```java
SubmitCaseResult submitCase(SubmitCaseCommand command)
```

Avoid:

```java
void process(Object request)
```

---

## 10.3 DTO / Mapper / Assembler

### Intent

Use DTOs to cross process/layer boundaries and Mappers/Assemblers to convert shapes deliberately.

### Allowed when

1. API model differs from domain model.
2. Persistence model differs from domain model.
3. External system contract differs from internal contract.
4. Sensitive/internal fields must not leak.
5. Mapping is non-trivial enough to deserve tests.

### Forbidden when

1. DTO and domain model are blindly duplicated without reason.
2. Mapper contains business decisions.
3. Mapper silently ignores fields.
4. Mapper accepts/returns `Map<String, Object>` without strict schema reason.

### Java standard

For Java 16+, records are preferred for immutable DTOs when supported by serialization framework.

The agent **MUST** keep mapping direction explicit:

- `toDomain`
- `toResponse`
- `toEntity`
- `fromEntity`
- `toExternalRequest`

---

## 10.4 Gateway / Client

### Intent

Use Gateway to abstract external systems. Use Client for low-level protocol/API calls.

### Allowed when

1. Calling external service, vendor, queue, object store, identity provider, email service, payment provider, map provider, or legacy system.
2. Application code needs stable business-oriented operations.
3. External DTOs/errors should not leak inward.
4. Timeout/retry/fallback/audit/metrics must be localized.

### Forbidden when

1. Domain code imports vendor SDK types.
2. Gateway hides remote behavior behind local entity names.
3. Client owns business rules.
4. No timeout or failure behavior exists.

### Java standard

Gateway method names should be business-oriented:

```java
interface IdentityVerificationGateway {
    IdentityVerificationResult verify(Applicant applicant);
}
```

Client method names may be protocol-oriented:

```java
final class MyInfoClient {
    MyInfoPersonResponse getPerson(String accessToken) { ... }
}
```

The agent **MUST** define timeout, retry eligibility, and exception mapping for remote calls.

---

## 10.5 Domain Event

### Intent

Use Domain Event to represent an important fact that happened in the domain.

### Allowed when

1. Other parts of the system need to react without tight coupling.
2. Event is meaningful to business/audit/process.
3. Event identity and timestamp matter.
4. Event payload is immutable and versionable.

### Forbidden when

1. Event is merely a method call in disguise.
2. Event contains mutable entity references.
3. Event exposes internal persistence structure.
4. Event is published before transaction outcome is known, unless explicitly designed.

### Java standard

```java
interface DomainEvent {
    EventId eventId();
    Instant occurredAt();
}
```

For Java 16+, event payloads may be records.

The agent **MUST** include versioning strategy for events crossing service boundaries.

---

## 10.6 Outbox

### Intent

Use Outbox to reliably publish events after database transaction commit.

### Allowed when

1. State change and message publish must be coordinated.
2. Distributed transaction is unavailable or undesirable.
3. At-least-once delivery is acceptable with idempotent consumers.
4. Event replay/audit is needed.

### Forbidden when

1. In-process event dispatch is enough.
2. Idempotency is ignored.
3. Outbox table has no cleanup/retention plan.
4. Consumers cannot handle duplicates.
5. Event schema/versioning is undefined.

### Java standard

The agent **MUST** define:

1. Event ID.
2. Aggregate ID.
3. Event type.
4. Payload schema/version.
5. Created timestamp.
6. Publishing status or relay mechanism.
7. Idempotency strategy.

---

## 10.7 Saga / Process Manager

### Intent

Use Saga or Process Manager to coordinate long-running distributed workflows with compensating actions.

### Allowed when

1. Workflow spans multiple services/transactions.
2. Each step may fail independently.
3. Compensation or manual intervention is required.
4. State must survive restarts.
5. Idempotency and correlation IDs are defined.

### Forbidden when

1. Single database transaction is enough.
2. Workflow is synchronous and local.
3. Compensation semantics are unclear.
4. State is held only in memory.
5. Retry is implemented without idempotency.

### Java standard

The agent **MUST** model saga state explicitly.

Required concepts:

- correlation ID
- current step/state
- completed steps
- retry count/backoff
- compensation status
- terminal states
- audit trail

---

# 11. Pattern selection matrix

The agent **MUST** use this matrix before selecting a pattern.

| Problem shape | Preferred pattern | Reject if |
|---|---|---|
| Many algorithms for one decision | Strategy/Policy | only one trivial branch |
| Many construction variants | Factory Method | factory only calls one constructor |
| Family of compatible objects | Abstract Factory | only one product family |
| Many optional construction fields | Builder | record/constructor is enough |
| Lifecycle-specific behavior | State | enum switch is still simple |
| Composable business predicates | Specification | predicate is local and one-off |
| External API translation | Adapter/Gateway | no boundary is isolated |
| Simplify complex subsystem | Facade | facade becomes god service |
| Add cross-cutting wrapper | Decorator/Proxy | behavior order is hidden |
| Tree-like structure | Composite | structure is not recursive |
| Event reaction | Observer/PubSub/Domain Event | direct call is clearer |
| Long distributed workflow | Saga/Process Manager | local transaction is enough |
| Persistence abstraction | Repository | generic CRUD leaks everywhere |
| Request/action as object | Command | direct method call is enough |
| Ordered validation/processing | Chain of Responsibility | order/failure semantics unclear |

---

# 12. Anti-patterns forbidden by default

## 12.1 Service Locator

Service Locator is forbidden by default.

Forbidden example:

```java
PaymentGateway gateway = ServiceLocator.get(PaymentGateway.class);
```

Use constructor injection or explicit factory instead.

Allowed only for legacy compatibility when:

1. Existing framework requires it.
2. It is isolated in infrastructure.
3. Tests cover lookup failure.
4. Migration path is documented.

---

## 12.2 God Service / God Manager

A class is suspicious when it:

1. Has many unrelated public methods.
2. Depends on many unrelated repositories/gateways/services.
3. Mixes validation, mapping, persistence, external calls, formatting, authorization, and orchestration.
4. Has many flags controlling behavior.
5. Has methods named `process`, `handle`, `execute`, or `manage` without domain-specific names.

The agent **MUST** split by use case, policy, gateway, mapper, or state boundary.

---

## 12.3 Anemic Pattern Overcorrection

The agent **MUST NOT** blindly move all behavior into entities.

Use domain entities for invariant-preserving behavior.

Use policies/specifications when rules vary independently.

Use application services for orchestration.

Use infrastructure services for technical effects.

---

## 12.4 Static Utility Hell

Static utility classes are allowed only for pure, stateless, deterministic operations.

Forbidden:

1. Static utility with hidden dependencies.
2. Static utility doing I/O.
3. Static utility reading global configuration.
4. Static utility with mutable static fields.
5. Static utility used to avoid modeling a domain concept.

Prefer named domain services/policies/value objects.

---

## 12.5 Abstract Base Class Abuse

Abstract base classes are forbidden when used only for code sharing.

Allowed when:

1. There is a real subtype relationship.
2. The base class enforces an invariant or template algorithm.
3. Subclasses cannot easily violate the base contract.
4. Composition would be worse.

Prefer composition and small interfaces.

---

## 12.6 Reflection Magic

Reflection-based pattern wiring is forbidden by default.

Allowed only when:

1. Framework requires it.
2. Types are allow-listed.
3. Security implications are reviewed.
4. Failure behavior is explicit.
5. Tests catch missing/duplicate registration.

---

## 12.7 Generic Context Object

Forbidden:

```java
Map<String, Object> context
```

Allowed only at strict external boundaries with schema validation.

Prefer typed context:

```java
record EligibilityContext(Application application, LicenceType licenceType, Instant evaluatedAt) { }
```

For Java 11, use final class.

---

## 12.8 Boolean Flag Pattern

Methods with boolean flags controlling behavior are suspicious.

Forbidden:

```java
process(application, true, false);
```

Prefer explicit methods, command objects, strategies, or enums.

---

## 12.9 Pattern Name Without Pattern Force

Classes named with pattern suffixes must implement that role.

Forbidden:

```java
final class CaseFactory {
    Case create(String name) {
        return new Case(name);
    }
}
```

Unless the factory centralizes construction invariants, variants, validation, dependency composition, or boundary mapping, direct constructor/static factory is preferred.

---

# 13. Java language feature guidance for patterns

## 13.1 Interfaces

Use interfaces when:

1. Multiple implementations exist or are expected for a real reason.
2. The interface defines a boundary.
3. The interface improves testability without hiding design.
4. The interface expresses domain capability.

Do not create interfaces for every class by default.

Forbidden:

```java
interface UserService { }
final class UserServiceImpl implements UserService { }
```

Allowed when the interface is a real port/boundary or has multiple implementations.

---

## 13.2 Abstract classes

Use abstract classes only when shared skeleton or state is part of the contract.

The agent **MUST** prefer interfaces with default methods only for small, safe composition helpers.

Default methods **MUST NOT** hide business-critical behavior that implementations are expected to override.

---

## 13.3 Records

For Java 16+, records are preferred for:

1. DTOs.
2. Commands.
3. Query objects.
4. Events.
5. Value objects with simple invariants.
6. Specification context objects.

Records are not preferred for:

1. Mutable entities.
2. JPA entities unless the project explicitly supports it.
3. Objects requiring complex lifecycle.
4. Classes needing identity separate from value.
5. Objects with many behavior methods and mutable collaboration.

The agent **MUST** use compact constructors for validation when needed.

---

## 13.4 Sealed classes/interfaces

For Java 17+, sealed types are preferred when:

1. The hierarchy is closed.
2. Exhaustive handling is valuable.
3. Valid subtypes are known and controlled.
4. The hierarchy models states, events, commands, results, errors, or algebraic alternatives.

Forbidden when:

1. Third parties must add implementations.
2. Framework proxying/subclassing needs open types.
3. Future extensibility is intentionally open.
4. The project baseline is Java 11.

---

## 13.5 Enums

Use enums for small, closed, stable sets.

Enums may contain behavior when:

1. Behavior is tiny and fixed.
2. No dependencies are required.
3. The enum remains readable.

Use strategy classes instead when behavior needs dependencies, testing, or independent evolution.

---

## 13.6 Lambdas and functional interfaces

Use lambdas for small, stateless, local behavior.

Use named implementations when behavior is domain-significant.

Functional interfaces **MUST** be annotated with `@FunctionalInterface` when custom.

Stream lambdas **MUST** be non-interfering and usually stateless.

---

## 13.7 Switch expressions and pattern matching

For Java 17+, switch expressions are allowed when exhaustive and clearer than if/else.

For Java 21+, pattern matching for switch may replace Visitor or State dispatch only when:

1. The hierarchy is sealed or otherwise closed.
2. Exhaustiveness is helpful.
3. The operation is local and limited.
4. Adding new operations is less common than adding new types.

The agent **MUST NOT** create giant switch expressions that centralize all business behavior.

---

# 14. Error handling standards inside patterns

Pattern implementations **MUST** have explicit failure behavior.

## 14.1 Registry/factory failure

When no implementation matches:

Allowed:

- throw domain-specific exception
- return explicit result type
- return `Optional` only when absence is normal and caller must decide

Forbidden:

- return `null`
- choose random/default implementation silently
- log and continue
- catch exception and return partially initialized object

## 14.2 Chain failure

A chain **MUST** specify:

1. Continue behavior.
2. Stop-success behavior.
3. Stop-failure behavior.
4. Exception behavior.
5. Whether later handlers run after failure.

## 14.3 Event handler failure

Event dispatch **MUST** specify:

1. Synchronous or asynchronous.
2. Transaction boundary.
3. Retry behavior.
4. Dead-letter behavior if applicable.
5. Idempotency requirement.
6. Partial failure behavior.

## 14.4 Remote gateway failure

Gateway/client patterns **MUST** define:

1. Timeout.
2. Retry eligibility.
3. Fallback or no fallback.
4. Exception mapping.
5. Observability fields.
6. Idempotency for retried mutation calls.

---

# 15. Concurrency and pattern standards

Concurrency-related patterns are high risk.

The agent **MUST NOT** introduce concurrency because a pattern sounds scalable.

## 15.1 Thread pools

The agent **MUST NOT** create raw thread pools casually.

If a pattern requires async behavior, define:

1. Executor ownership.
2. Queue size/backpressure.
3. Shutdown lifecycle.
4. Error handling.
5. Context propagation.
6. Metrics.
7. Test strategy.

## 15.2 Virtual threads

For Java 21+, virtual threads may be used only when:

1. The workload is blocking I/O heavy.
2. External resources are bounded separately.
3. The code does not pool virtual threads.
4. Pinning risks are understood.
5. Existing framework integration supports it.

Virtual threads do not justify design patterns by themselves.

## 15.3 Caches and memoization

Cache-as-pattern is allowed only with explicit:

1. Key definition.
2. Value immutability.
3. Eviction.
4. TTL or invalidation.
5. Max size.
6. Stampede handling if relevant.
7. Consistency expectations.
8. Metrics.

The agent **MUST NOT** introduce unbounded `ConcurrentHashMap` caches.

---

# 16. Security standards for patterns

Design patterns must not hide security boundaries.

## 16.1 Deserialization and factory patterns

The agent **MUST NOT** instantiate classes from untrusted type names.

Forbidden:

```java
Class.forName(request.getType()).getDeclaredConstructor().newInstance();
```

Allowed:

```java
Map<RequestType, RequestHandler> allowListedHandlers;
```

## 16.2 Plugin/registry patterns

Registries **MUST** use allow-listed implementations.

The agent **MUST** reject unknown, duplicate, or unauthorized registrations.

## 16.3 Proxy/decorator security

Authorization decorators/proxies **MUST** fail closed.

Forbidden:

1. Log authorization failure and continue.
2. Catch security exception and return empty result unless explicitly required.
3. Apply authorization after mutation.

## 16.4 Event patterns

Events crossing trust boundaries **MUST** avoid sensitive data unless required.

The agent **MUST** prefer IDs over full sensitive payloads when possible.

---

# 17. Testing standards for design patterns

Every non-trivial pattern introduction **MUST** include tests.

## 17.1 Required test categories

| Pattern | Required tests |
|---|---|
| Factory/Registry | known type, unknown type, duplicate registration if applicable |
| Strategy/Policy | each strategy, selection logic, unsupported selection |
| State | valid transitions, invalid transitions, terminal states |
| Chain | ordering, short-circuit, failure behavior |
| Adapter/Mapper | complete field mapping, null/invalid external data, error mapping |
| Decorator/Proxy | delegate call, added behavior, exception path |
| Repository | query semantics, missing entity behavior, transaction/persistence integration where applicable |
| Event/Observer | event content, dispatch timing, handler failure, idempotency if async/distributed |
| Saga/Process Manager | step success, step failure, retry, compensation, resume after restart |
| Specification | positive case, negative case, composition behavior |

## 17.2 Test naming

Test names **SHOULD** express behavior:

```java
shouldRejectSubmissionWhenCaseAlreadyClosed()
shouldSelectRenewalPolicyForRenewalApplication()
shouldFailWhenDocumentTypeIsUnsupported()
```

Avoid:

```java
testStrategy()
testFactory()
testProcess()
```

## 17.3 Mocking rule

Mocks are allowed for boundaries.

Mocks are suspicious for domain objects.

The agent **MUST** prefer real domain objects/value objects in unit tests.

---

# 18. Review checklist for LLM-generated design pattern code

A reviewer **MUST** reject the implementation if any answer is “no”:

1. Is the actual design problem clear?
2. Is the chosen pattern simpler than the alternatives?
3. Is the pattern name domain-specific, not generic catalog naming?
4. Does the implementation obey the Java baseline?
5. Are dependencies pointing in the right direction?
6. Is failure behavior explicit?
7. Are unknown/unsupported variants handled safely?
8. Are collections immutable or defensively copied where needed?
9. Are state transitions/rules tested?
10. Is the pattern discoverable from package/type names?
11. Does it avoid global mutable state?
12. Does it avoid reflection unless explicitly justified?
13. Does it avoid service locator behavior?
14. Does it avoid raw `Object`/`Map<String, Object>` contexts?
15. Are external systems isolated behind gateways/adapters?
16. Does it preserve domain vocabulary?
17. Are tests added/updated for each new variation point?
18. Is the amount of abstraction proportional to the problem?
19. Can the next maintainer remove/change one implementation without breaking unrelated code?
20. Would a simpler method/constructor/enum be insufficient?

---

# 19. LLM pattern selection prompt contract

When asked to implement Java code, the agent **MUST** internally apply this contract:

```text
Before introducing any design pattern:
1. Identify the concrete variation, boundary, lifecycle, or invariant that needs it.
2. Check whether a simpler method, constructor, enum, record, function, or direct dependency is enough.
3. Use the project Java baseline; do not use newer language features.
4. Prefer domain-specific names over pattern-catalog names.
5. Keep dependencies explicit through constructors.
6. Define failure behavior for unknown/unsupported cases.
7. Avoid global state, service locator, reflection magic, and generic Object contexts.
8. Add or update tests for variant selection, failure behavior, and domain invariants.
9. Do not introduce speculative abstractions for future requirements.
10. If the pattern cannot be justified, implement the simpler design.
```

---

# 20. Pattern proposal template for agents

When the agent proposes a pattern in explanation or PR notes, it **SHOULD** use this structure:

```text
Pattern: <name>
Domain role: <domain-specific role name>
Problem: <actual problem in current code>
Change axis: <what varies independently>
Invariant protected: <what must remain stable>
Simpler alternative considered: <method/constructor/enum/etc.>
Why alternative is insufficient: <reason>
Failure behavior: <unknown/invalid/error behavior>
Java baseline impact: <Java 11/17/21/25 feature usage>
Tests added: <test list>
```

If the agent cannot fill this template, it **MUST NOT** introduce the pattern.

---

# 21. Pattern-specific code smells and required response

## 21.1 Large if/else or switch

Do not automatically replace with Strategy.

First classify:

1. Is it branching by stable enum/status with simple behavior? Keep switch.
2. Is each branch complex and independently changing? Consider Strategy/Policy.
3. Is branching by lifecycle state? Consider State or transition table.
4. Is branching by external type/provider? Consider Factory/Registry + Strategy.
5. Is branching over sealed hierarchy with one local operation? Consider pattern switch if Java 21+.

## 21.2 Many constructor parameters

Do not automatically use Builder.

First classify:

1. Are all fields required? Use constructor or record.
2. Are many optional fields present? Consider Builder.
3. Are there alternative construction paths? Consider static factories.
4. Are fields grouped by concept? Create value objects.
5. Are parameters primitive obsession? Create value objects.

## 21.3 Duplicated validation rules

Do not automatically use Chain.

First classify:

1. Is the rule a domain predicate? Specification/Policy.
2. Is validation order meaningful? Chain.
3. Is validation tied to state? State/transition policy.
4. Is validation syntactic input checking? Validator at boundary.
5. Is validation persistence uniqueness? Repository/domain service.

## 21.4 External API leak

Prefer Adapter/Gateway.

Required response:

1. Create internal port/interface.
2. Keep external DTOs inside infrastructure.
3. Map errors explicitly.
4. Add tests for mapping/failure.
5. Keep timeout/retry at boundary.

## 21.5 Growing lifecycle logic

Consider State or transition table.

Required response:

1. Identify states.
2. Identify events/actions.
3. Build transition matrix.
4. Define invalid transition behavior.
5. Test all critical transitions.
6. Keep side effects outside pure transition calculation where possible.

---

# 22. Pattern usage in Spring/DI projects

If the project uses Spring or another DI framework, the agent **MUST** still follow design rules.

## 22.1 Constructor injection

Use constructor injection for required dependencies.

Forbidden:

1. Field injection.
2. Hidden lookup from application context.
3. Static access to beans.
4. Optional dependencies represented by nullable fields without explicit behavior.

## 22.2 Auto-wiring strategy lists/maps

Auto-wired strategy collections are allowed when:

1. Keying is explicit.
2. Duplicate keys fail at startup.
3. Unknown key fails explicitly at runtime.
4. Ordering is explicit for chains.
5. Tests cover registration.

## 22.3 Framework annotations

Domain pattern types **SHOULD NOT** depend on framework annotations.

Application/infrastructure implementations may use framework annotations when appropriate.

## 22.4 Transactions

Application service, command handler, or repository implementation may own transaction boundary.

Domain objects, policies, specifications, and mappers **MUST NOT** own transactions.

---

# 23. Documentation standards

The agent **MUST NOT** write generic design pattern tutorials inside production code.

Allowed comments/Javadocs:

1. Explain domain invariant.
2. Explain non-obvious selection rule.
3. Explain failure semantics.
4. Explain concurrency/resource lifecycle.
5. Explain external system constraints.

Forbidden comments:

```java
// This is the Strategy pattern
// Factory pattern implementation
// Singleton pattern for global access
```

Better:

```java
/**
 * Selects the eligibility policy for a licence type.
 * Unknown licence types are rejected to avoid applying default rules to regulated cases.
 */
```

---

# 24. Strict “do not invent” rule

The agent **MUST NOT** invent design abstractions not supported by nearby code, requirements, tests, or domain vocabulary.

Before adding a new abstraction, search for existing concepts:

1. Existing enum/type names.
2. Existing status/state names.
3. Existing exception patterns.
4. Existing package boundaries.
5. Existing mappers/factories/handlers.
6. Existing test style.
7. Existing framework wiring conventions.

The agent **MUST** extend existing conventions unless they conflict with this strict standard.

---

# 25. Final implementation rule

The best design pattern implementation is often the one the maintainer barely notices because the domain model became clearer.

The agent **MUST** choose:

1. explicit over magical,
2. domain vocabulary over catalog vocabulary,
3. composition over inheritance by default,
4. typed context over maps,
5. immutable data over mutable shared state,
6. constructor injection over lookup,
7. explicit failure over default fallback,
8. tests over comments,
9. current requirements over speculative architecture,
10. simple code over pattern theater.

---

# 26. References and source anchors

These references are used as background anchors for Java language behavior and enforceable coding style. They are not a license to copy examples blindly.

1. Java Language Specification, Java SE 21 Edition: https://docs.oracle.com/javase/specs/jls/se21/html/
2. Oracle Java Language Updates — Pattern Matching for switch: https://docs.oracle.com/en/java/javase/21/language/pattern-matching-switch.html
3. Java SE 21 Stream API documentation: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/stream/Stream.html
4. Oracle Java Tutorial — Lambda Expressions: https://docs.oracle.com/javase/tutorial/java/javaOO/lambdaexpressions.html
5. Google Java Style Guide: https://google.github.io/styleguide/javaguide.html
6. Oracle Java enum language guide: https://docs.oracle.com/javase/8/docs/technotes/guides/language/enums.html
7. OpenJDK JEP 409 — Sealed Classes: https://openjdk.org/jeps/409
8. OpenJDK JEP 395 — Records: https://openjdk.org/jeps/395
9. OpenJDK JEP 441 — Pattern Matching for switch: https://openjdk.org/jeps/441
10. OpenJDK JEP 444 — Virtual Threads: https://openjdk.org/jeps/444

