# Strict Coding Standards — Java 17

> **Target runtime:** Java 17 / Java SE 17  
> **Audience:** LLM code agents, human reviewers, maintainers  
> **Purpose:** make generated Java 17 code predictable, reviewable, secure, maintainable, and compatible with a strict Java 17 baseline.

---

## 0. Non-negotiable operating rule for LLM agents

When implementing Java code, the agent **MUST** treat this document as an implementation contract, not as optional advice.

The agent **MUST**:

1. Preserve Java 17 compatibility.
2. Use only Java features and APIs available in Java 17 unless the repository explicitly targets a newer runtime.
3. Follow existing repository style when it is stricter than this document.
4. Prefer minimal, local, explainable changes over broad rewrites.
5. Avoid speculative refactors unless explicitly requested.
6. Never introduce dependencies, frameworks, runtime assumptions, public API changes, persistence changes, serialization changes, or behavioral changes without clear justification.
7. Produce code that compiles, is testable, observable where relevant, and has explicit failure behavior.
8. State assumptions when the surrounding codebase does not provide enough evidence.
9. Preserve domain vocabulary already used by the codebase.
10. Prefer boring, deterministic, reviewable code over clever syntax.

The agent **MUST NOT**:

1. Use Java features introduced after Java 17.
2. Use Java 17 preview or incubator features unless the user explicitly requests them and the build already enables them.
3. Generate code that only works on Java 18, 19, 20, 21, or newer.
4. Hide complexity behind vague helper methods.
5. Swallow exceptions.
6. Return `null` where an empty value, exception, or explicit optional result is required.
7. Add concurrency, caching, async behavior, reflection, serialization, bytecode manipulation, global state, or background scheduling unless the requirement truly needs it.
8. Change formatting or unrelated code just because it was nearby.
9. Create “enterprise ceremony” without a real invariant, boundary, dependency, or lifecycle need.
10. Treat modern Java syntax as a replacement for proper modeling.

---

## 1. Java 17 compatibility contract

### 1.1 Build level

All Java source code **MUST** compile with Java 17.

Recommended compiler configuration:

```bash
javac --release 17
```

Maven:

```xml
<properties>
    <maven.compiler.release>17</maven.compiler.release>
</properties>
```

Gradle:

```groovy
java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(17)
    }
}

tasks.withType(JavaCompile).configureEach {
    options.release = 17
}
```

The agent **MUST NOT** rely only on `sourceCompatibility = 17` and `targetCompatibility = 17` when `--release 17` is available, because `--release` prevents accidental use of newer JDK APIs during compilation.

### 1.2 Java 17 allowed feature surface

The following Java 17-compatible features and APIs are allowed when they improve clarity:

| Feature/API                                   | Java version | Allowed?   | Rule                                                                                           |
| --------------------------------------------- | -----------: | ---------- | ---------------------------------------------------------------------------------------------- |
| Lambdas and streams                           |            8 | Yes        | Use for simple transformations, not complex side-effect workflows.                             |
| `Optional`                                    |            8 | Yes        | Use mainly as return type for possibly absent values.                                          |
| `java.time`                                   |            8 | Yes        | Mandatory for new date/time code.                                                              |
| `CompletableFuture`                           |            8 | Restricted | Use only with explicit executor policy and error handling.                                     |
| NIO.2: `Path`, `Files`, channels              |         7/8+ | Yes        | Preferred over legacy `File` APIs for new code.                                                |
| `List.of`, `Set.of`, `Map.of`                 |            9 | Yes        | Use for small immutable constants.                                                             |
| `List.copyOf`, `Set.copyOf`, `Map.copyOf`     |           10 | Yes        | Use for defensive immutable copies.                                                            |
| Local variable `var`                          |           10 | Restricted | Allowed only when the type is obvious and readability improves.                                |
| `var` in lambda parameters                    |           11 | Restricted | Allowed only when annotations are needed or consistency improves.                              |
| `String.isBlank`, `strip`, `lines`, `repeat`  |           11 | Yes        | Prefer over ad-hoc string utilities when appropriate.                                          |
| `Files.readString`, `Files.writeString`       |           11 | Yes        | Allowed for bounded/small text content only.                                                   |
| `Collection.toArray(IntFunction)`             |           11 | Yes        | Prefer `collection.toArray(Type[]::new)`.                                                      |
| `Optional.isEmpty`                            |           11 | Yes        | Allowed.                                                                                       |
| `Predicate.not`                               |           11 | Yes        | Allowed when it improves readability.                                                          |
| `java.net.http.HttpClient`                    |           11 | Yes        | Preferred standard HTTP client when no project client exists.                                  |
| Switch expressions                            |           14 | Yes        | Use for pure value mapping; avoid side effects.                                                |
| Text blocks                                   |           15 | Yes        | Use for readable multiline constants, SQL, JSON, expected test data.                           |
| Records                                       |           16 | Restricted | Use for simple immutable value carriers, not behavior-heavy domain aggregates or JPA entities. |
| Pattern matching for `instanceof`             |           16 | Yes        | Use to reduce redundant casts, while keeping conditions readable.                              |
| Sealed classes/interfaces                     |           17 | Restricted | Use only for intentionally closed domain hierarchies.                                          |
| `Stream.toList()`                             |           16 | Restricted | Allowed only when an unmodifiable result is intended.                                          |
| `java.util.random` enhanced random generators |           17 | Restricted | Use only when the project needs explicit random generator selection.                           |
| Context-specific deserialization filters      |           17 | Restricted | Use for deserialization hardening when Java serialization cannot be avoided.                   |

### 1.3 Forbidden Java >17 features

The agent **MUST NOT** use these in Java 17 code:

| Forbidden feature/API                                        | Introduced after Java 17 | Replacement in Java 17                                                                         |
| ------------------------------------------------------------ | -----------------------: | ---------------------------------------------------------------------------------------------- |
| Virtual threads                                              |    19 preview / 21 final | Bounded `ExecutorService`, platform threads, reactive stack already used by project.           |
| Structured concurrency                                       |    19+ incubator/preview | Explicit executor lifecycle and cancellation policy.                                           |
| Scoped values                                                |    20+ incubator/preview | Explicit method parameters or request context objects.                                         |
| Sequenced collections                                        |                       21 | Existing `List`, `Deque`, `LinkedHashMap`, `NavigableSet`, `NavigableMap` APIs.                |
| `List.getFirst`, `List.getLast`, `removeFirst`, `removeLast` |                       21 | Index access with explicit empty checks or `Deque`.                                            |
| Pattern matching for `switch` final                          |                       21 | `if/else`, visitor pattern, enum switch expression, or sealed hierarchy with explicit methods. |
| Record patterns                                              |    19 preview / 21 final | Accessors or explicit deconstruction methods.                                                  |
| String templates                                             |               21 preview | `String.format`, `MessageFormat`, formatter/builder, parameterized SQL/logging.                |
| Unnamed classes and instance `main` methods                  |               21 preview | Normal class with `public static void main(String[] args)`.                                    |
| Foreign Function & Memory API final                          |                       22 | Java 17 standard APIs, JNI only with explicit approval, or project-approved library.           |
| Stream gatherers                                             |    22 preview / 24 final | Collectors, custom iterator/spliterator, or explicit loop.                                     |
| Class-file API                                               |    22 preview / 24 final | Project-approved bytecode library only when needed.                                            |
| Stable values                                                |               25 preview | Explicit initialization and lifecycle-managed caching.                                         |
| Compact source files                                         |               25 preview | Normal Java class files.                                                                       |

### 1.4 Java 17 preview/incubator features are forbidden by default

Java 17 includes preview or incubator features, but generated code **MUST NOT** use them by default.

Forbidden unless explicitly requested and build-enabled:

1. Pattern matching for `switch` from Java 17 preview.
2. Vector API incubator.
3. Foreign Function & Memory API incubator.
4. Any API requiring `--enable-preview` or incubator modules.

If the user explicitly requests preview/incubator usage, the agent **MUST**:

1. State that the code is no longer strict portable Java 17 baseline.
2. Confirm the build uses `--enable-preview` where required.
3. Add tests that compile and run with the same preview/incubator flags.
4. Avoid mixing preview syntax into stable production code without a migration plan.

### 1.5 Removed, deprecated, or changed Java 17 platform behavior

The agent **MUST NOT** assume removed or obsolete JDK components exist.

Java 17-relevant guardrails:

1. Strong encapsulation of JDK internals is enforced; do not use `sun.*`, `com.sun.*`, reflective access to JDK internals, or `--add-opens` as a lazy fix.
2. `SecurityManager` is deprecated for removal; do not design new security controls around it.
3. RMI Activation is removed; do not generate code depending on `rmid` or activation APIs.
4. Experimental AOT and Graal JIT compiler support from older JDKs is removed; do not depend on old `jaotc`/AOT options.
5. Nashorn JavaScript engine was removed before Java 17; do not generate new code using Nashorn.
6. Pack200 was removed before Java 17; do not generate Pack200-based packaging logic.
7. Applet APIs are obsolete/deprecated; do not generate applet code.
8. Java EE/CORBA modules removed from JDK 11 remain absent; use explicit dependencies only when the project already owns them.
9. JavaFX is not bundled with the JDK; do not assume it exists.
10. Finalization is deprecated for removal in newer Java releases; avoid adding finalizers even in Java 17 projects.

---

## 2. Repository-first rule

Before writing code, the agent **MUST** inspect and follow the repository’s existing conventions:

1. Package layout.
2. Naming style.
3. Error model.
4. Logging framework.
5. Dependency injection style.
6. Test framework and test naming.
7. Formatter configuration.
8. Static analysis rules.
9. Existing abstractions and domain vocabulary.
10. Existing boundaries between controller/service/domain/repository/client layers.
11. Serialization model.
12. Transaction boundary model.
13. Threading and scheduler model.
14. Configuration binding style.
15. Feature flag and rollout style.

If the repository convention conflicts with this document:

1. Existing repository convention wins for local consistency.
2. Java 17 compatibility always wins over repository inconsistency.
3. Security and correctness rules in this document win unless the project has a stricter equivalent.
4. The agent must mention the conflict in its implementation summary.

---

## 3. Source file structure

### 3.1 File name

A source file containing a top-level public class **MUST** be named exactly after that class:

```text
OrderService.java
```

The agent **MUST NOT** place multiple public top-level classes in one file.

### 3.2 Package declaration

Every production source file **MUST** have a package declaration.

Good:

```java
package com.example.order.application;
```

Bad:

```java
// default package
public class OrderService {}
```

### 3.3 Import rules

Imports **MUST** be explicit.

The agent **MUST NOT** use wildcard imports:

```java
import java.util.*; // forbidden
```

The agent **MUST** remove unused imports.

Static imports are allowed only for:

1. Test assertions.
2. Matchers.
3. Well-known constants.
4. Factory methods where readability is clearly improved.

Static imports **MUST NOT** hide domain behavior.

### 3.4 Class member ordering

Use this order unless the repository has a stricter convention:

1. Constants.
2. Static fields.
3. Instance fields.
4. Constructors.
5. Public methods.
6. Package-private methods.
7. Protected methods.
8. Private methods.
9. Nested types.

### 3.5 File size and responsibility

A file **SHOULD** stay below 400 lines.

A class **MUST** have one primary responsibility.

A class may exceed this limit only when:

1. It is generated code.
2. It is a stable DTO/schema type.
3. It is a test fixture with clear grouping.
4. Splitting it would reduce clarity.

The agent **MUST NOT** split a class mechanically without understanding dependencies and lifecycle.

---

## 4. Formatting

### 4.1 Indentation

Use 4 spaces for indentation.

Tabs are forbidden unless the repository formatter already requires tabs.

### 4.2 Line length

Recommended maximum line length: 100 to 120 characters.

The agent **MUST** prefer readable wrapping over horizontal scrolling.

### 4.3 Braces

Use braces for all control statements, even single-line blocks.

Good:

```java
if (enabled) {
    start();
}
```

Bad:

```java
if (enabled) start();
```

Bad:

```java
if (enabled)
    start();
```

### 4.4 Blank lines

Use blank lines to separate logical groups.

Do not create vertical noise.

### 4.5 Formatting ownership

The agent **MUST** respect repository formatters:

1. `.editorconfig`
2. Checkstyle
3. Spotless
4. Google Java Format
5. IntelliJ formatter config
6. Eclipse formatter config

The agent **MUST NOT** reformat unrelated files.

---

## 5. Naming

### 5.1 General naming

Names **MUST** reveal intent.

Good:

```java
private final PaymentAttemptRepository paymentAttemptRepository;
```

Bad:

```java
private final PaymentAttemptRepository repo;
```

Bad:

```java
private final PaymentAttemptRepository pr;
```

### 5.2 Classes

Classes and interfaces **MUST** use `UpperCamelCase`.

Examples:

```java
OrderService
PaymentPolicy
CaseEscalationWorkflow
```

### 5.3 Methods and fields

Methods and fields **MUST** use `lowerCamelCase`.

Examples:

```java
calculateRiskScore()
submittedAt
retryCount
```

### 5.4 Constants

Constants **MUST** use `UPPER_SNAKE_CASE`.

```java
private static final int MAX_RETRY_ATTEMPTS = 3;
```

### 5.5 Boolean names

Boolean fields and methods **SHOULD** read naturally.

Good:

```java
private boolean active;

boolean isActive() {
    return active;
}

boolean hasExpired() {
    return expiresAt.isBefore(clock.instant());
}
```

Avoid ambiguous names:

```java
private boolean status;
private boolean flag;
private boolean check;
```

### 5.6 Acronyms

Acronyms **SHOULD** be treated as words.

Good:

```java
HttpClientFactory
XmlParser
IdGenerator
```

Avoid:

```java
HTTPClientFactory
XMLParser
IDGenerator
```

Exception: preserve repository convention if it already uses the uppercase acronym style consistently.

### 5.7 Domain language

The agent **MUST** reuse domain terms from the codebase.

Do not invent synonyms for existing domain concepts.

If the codebase uses `Case`, do not introduce `Ticket` unless it is actually a different concept.

---

## 6. Type usage

### 6.1 Prefer precise types

Use the most precise type that expresses the contract.

Good:

```java
private final List<OrderLine> orderLines;
```

Bad:

```java
private final Collection<OrderLine> orderLines; // if order is important
```

Bad:

```java
private final ArrayList<OrderLine> orderLines; // if implementation is not part of contract
```

### 6.2 Program to interface, not implementation

Public method signatures **SHOULD** use interfaces where the implementation is irrelevant.

Good:

```java
public List<Order> findOrders(CustomerId customerId) {
    ...
}
```

Avoid leaking implementation:

```java
public ArrayList<Order> findOrders(CustomerId customerId) {
    ...
}
```

### 6.3 `var`

`var` is allowed only when the inferred type is obvious.

Good:

```java
var orderId = OrderId.from(rawOrderId);
var lineCount = orderLines.size();
```

Bad:

```java
var result = service.process(input); // unclear type
var data = repository.find(id);      // unclear type
var value = mapper.apply(raw);       // unclear type
```

The agent **MUST NOT** use `var` in public API declarations, fields, method parameters, or return types.

### 6.4 Primitive vs boxed types

Use primitives when absence is impossible.

Use boxed types only when:

1. `null` is a meaningful external representation.
2. Framework binding requires it.
3. Tri-state behavior is explicitly modeled.

Do not use boxed types lazily.

### 6.5 Avoid raw types

Raw types are forbidden.

Bad:

```java
List items = new ArrayList();
```

Good:

```java
List<OrderItem> items = new ArrayList<>();
```

### 6.6 Avoid magic string types for domain concepts

Domain identifiers **SHOULD** be value objects when they cross important boundaries.

Good:

```java
public record CustomerId(String value) {
    public CustomerId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("customer id must not be blank");
        }
    }
}
```

Acceptable for simple integration DTOs:

```java
public record CustomerResponse(String customerId, String name) {}
```

---

## 7. Null handling

### 7.1 Null policy

The agent **MUST** make null behavior explicit.

For public methods, one of the following must be true:

1. Null input is rejected with a clear exception.
2. Null input is accepted and documented by behavior.
3. Null input is impossible because the framework validates it before entry.

### 7.2 Use `Objects.requireNonNull`

Use `Objects.requireNonNull` for mandatory constructor dependencies and values.

```java
public OrderService(OrderRepository orderRepository, Clock clock) {
    this.orderRepository = Objects.requireNonNull(orderRepository, "orderRepository");
    this.clock = Objects.requireNonNull(clock, "clock");
}
```

### 7.3 Do not return null collections

Return empty collections, not `null`.

Good:

```java
return List.of();
```

Bad:

```java
return null;
```

### 7.4 Do not use `Optional` for fields or parameters by default

`Optional` is mainly for return values.

Allowed:

```java
public Optional<Order> findOrder(OrderId orderId) {
    ...
}
```

Avoid:

```java
private Optional<String> description;

public void update(Optional<String> description) {
    ...
}
```

### 7.5 `Optional.get()` is forbidden without guard

Bad:

```java
return maybeOrder.get();
```

Good:

```java
return maybeOrder.orElseThrow(() -> new OrderNotFoundException(orderId));
```

### 7.6 Empty string is not null

The agent **MUST NOT** treat `null`, empty string, and blank string as the same unless the domain explicitly says so.

Use:

```java
if (name == null || name.isBlank()) {
    throw new IllegalArgumentException("name must not be blank");
}
```

---

## 8. Records

Records are available in Java 17 and are useful, but they are not a default replacement for every class.

### 8.1 When records are allowed

Use records for:

1. Immutable value carriers.
2. Request/response DTOs.
3. Query result projections.
4. Internal command objects.
5. Domain value objects with simple invariants.
6. Composite map keys.
7. Test fixtures and expected values.

Good:

```java
public record Money(String currency, BigDecimal amount) {
    public Money {
        if (currency == null || currency.isBlank()) {
            throw new IllegalArgumentException("currency must not be blank");
        }
        Objects.requireNonNull(amount, "amount");
        if (amount.scale() > 2) {
            throw new IllegalArgumentException("amount scale must not exceed 2");
        }
    }
}
```

### 8.2 When records are forbidden

Do not use records for:

1. JPA entities.
2. Mutable ORM-managed objects.
3. Classes requiring lazy-loaded mutable state.
4. Objects with complex lifecycle transitions.
5. Behavior-heavy domain aggregates.
6. Types requiring identity semantics rather than value semantics.
7. Types where binary/API compatibility is likely to change frequently.
8. Framework objects that require no-arg constructors and mutable setters.

Bad:

```java
@Entity
public record OrderEntity(Long id, String status) {}
```

### 8.3 Record invariants

Records **MUST** validate invariants in a compact constructor.

Good:

```java
public record PageRequest(int page, int size) {
    public PageRequest {
        if (page < 0) {
            throw new IllegalArgumentException("page must not be negative");
        }
        if (size < 1 || size > 200) {
            throw new IllegalArgumentException("size must be between 1 and 200");
        }
    }
}
```

### 8.4 Defensive copies in records

A record is only shallowly immutable.

If a record component is mutable, the constructor **MUST** defensively copy it.

Good:

```java
public record OrderSnapshot(OrderId orderId, List<OrderLine> lines) {
    public OrderSnapshot {
        Objects.requireNonNull(orderId, "orderId");
        lines = List.copyOf(Objects.requireNonNull(lines, "lines"));
    }
}
```

Bad:

```java
public record OrderSnapshot(OrderId orderId, List<OrderLine> lines) {}
```

### 8.5 Record accessors

Do not add JavaBean getters to records unless a framework requires them.

Good:

```java
customer.name()
```

Avoid:

```java
public String getName() {
    return name;
}
```

### 8.6 Record serialization

Do not make a record `Serializable` unless required by an existing contract.

If serialization is required, document the compatibility expectation and add tests.

### 8.7 Record evolution

Changing record components changes constructor signature, accessor surface, equality, hash code, and string representation.

The agent **MUST NOT** modify public record components without treating it as an API change.

---

## 9. Sealed classes and interfaces

Sealed types are allowed only when the hierarchy is intentionally closed.

### 9.1 When sealed types are allowed

Use sealed types for:

1. Closed domain state models.
2. Algebraic result types.
3. Known command variants.
4. Known event variants.
5. Parser AST nodes.
6. Workflow transitions with finite variants.
7. Failure categories where the set is controlled by the module.

Good:

```java
public sealed interface PaymentResult
        permits PaymentResult.Approved, PaymentResult.Rejected, PaymentResult.Pending {

    record Approved(String authorizationCode) implements PaymentResult {}

    record Rejected(String reasonCode) implements PaymentResult {}

    record Pending(String providerReference) implements PaymentResult {}
}
```

### 9.2 When sealed types are forbidden

Do not use sealed types for:

1. Extension points intended for other modules or external users.
2. Public framework interfaces.
3. Repository interfaces.
4. Service interfaces used for dependency injection.
5. Plugin architectures.
6. Types whose variants are expected to grow externally.
7. Places where an enum is sufficient.

### 9.3 Sealed type rules

A sealed hierarchy **MUST**:

1. Declare permitted subclasses explicitly unless all permitted types are nested and obvious.
2. Keep permitted subclasses in the same module or package as required by Java rules.
3. Make each subclass `final`, `sealed`, or `non-sealed` intentionally.
4. Avoid exposing unstable sealed hierarchies as public APIs.
5. Include tests for each permitted variant.
6. Define handling behavior for unknown future variants when public exposure is unavoidable.

### 9.4 Sealed type handling without preview switch patterns

Java 17 does not have final pattern matching for `switch`.

The agent **MUST NOT** use preview switch patterns by default.

Use explicit methods, visitor-like dispatch, or `instanceof` pattern matching.

Example:

```java
public String messageFor(PaymentResult result) {
    if (result instanceof PaymentResult.Approved approved) {
        return "approved: " + approved.authorizationCode();
    }
    if (result instanceof PaymentResult.Rejected rejected) {
        return "rejected: " + rejected.reasonCode();
    }
    if (result instanceof PaymentResult.Pending pending) {
        return "pending: " + pending.providerReference();
    }
    throw new IllegalStateException("Unhandled payment result: " + result);
}
```

---

## 10. Pattern matching for `instanceof`

Pattern matching for `instanceof` is allowed when it improves clarity.

Good:

```java
if (value instanceof CustomerId customerId) {
    return customerId.value();
}
```

Avoid unnecessary casts:

```java
if (value instanceof CustomerId) {
    CustomerId customerId = (CustomerId) value;
    return customerId.value();
}
```

### 10.1 Keep pattern variables close

Pattern variables **MUST** be used close to the condition that defines them.

Good:

```java
if (event instanceof OrderSubmitted submitted) {
    publishSubmittedEvent(submitted);
}
```

Bad:

```java
if (event instanceof OrderSubmitted submitted && someLongComplexCondition()) {
    // many lines later
    publishSubmittedEvent(submitted);
}
```

### 10.2 Avoid clever boolean expressions

Do not combine pattern matching with complex boolean logic.

Bad:

```java
if (value instanceof Order order && order.isPaid() || fallbackEnabled && value != null) {
    ...
}
```

Prefer clarity:

```java
if (value instanceof Order order && order.isPaid()) {
    ...
} else if (fallbackEnabled && value != null) {
    ...
}
```

---

## 11. Switch expressions

Switch expressions are allowed in Java 17.

### 11.1 Use switch expressions for pure mapping

Good:

```java
public int priorityOf(CaseStatus status) {
    return switch (status) {
        case NEW -> 10;
        case IN_PROGRESS -> 20;
        case ESCALATED -> 100;
        case CLOSED -> 0;
    };
}
```

### 11.2 Avoid side effects in switch expressions

Bad:

```java
return switch (status) {
    case NEW -> {
        audit.log("new");
        repository.save(entity);
        yield 10;
    }
    case CLOSED -> 0;
};
```

Use a normal switch statement or explicit methods for side-effect workflows.

### 11.3 Enum switch exhaustiveness

When switching on an enum and all values are handled, do not add a lazy `default` just to silence errors.

Good:

```java
return switch (status) {
    case DRAFT -> false;
    case SUBMITTED, APPROVED -> true;
    case REJECTED, CANCELLED -> false;
};
```

A `default` may be used when:

1. External enum evolution is possible.
2. Defensive compatibility behavior is required.
3. The source enum is generated or not controlled by the project.

### 11.4 Switch expression blocks

If a case block is longer than a few lines, extract a named method.

Good:

```java
return switch (request.type()) {
    case CREATE -> createCase(request);
    case UPDATE -> updateCase(request);
    case CANCEL -> cancelCase(request);
};
```

Bad:

```java
return switch (request.type()) {
    case CREATE -> {
        // 40 lines of logic
        yield result;
    }
    ...
};
```

### 11.5 Pattern matching switch is forbidden by default

Do not use:

```java
return switch (value) {
    case String text -> text.length();
    case Integer number -> number;
    default -> 0;
};
```

This is not a stable Java 17 baseline feature.

---

## 12. Text blocks

Text blocks are allowed for multiline string literals.

### 12.1 Good use cases

Use text blocks for:

1. SQL in tests or small query objects.
2. JSON/XML/YAML test fixtures.
3. Expected multiline output.
4. HTML/email templates only when small and stable.
5. Documentation snippets in tests.

Good:

```java
String payload = """
        {
          "customerId": "CUST-001",
          "status": "ACTIVE"
        }
        """;
```

### 12.2 Bad use cases

Do not use text blocks for:

1. Large templates that belong in resource files.
2. Dynamic SQL assembled by concatenation.
3. Secrets.
4. Production configuration.
5. Messages requiring localization.

### 12.3 Text block indentation

The agent **MUST** verify the actual string content when indentation matters.

Use `.stripIndent()` or `.stripTrailing()` only when the transformation is intentional.

### 12.4 SQL text blocks

SQL text blocks **MUST NOT** concatenate untrusted input.

Bad:

```java
String sql = """
        select * from users where name = '%s'
        """.formatted(name);
```

Good:

```java
String sql = """
        select *
        from users
        where name = ?
        """;
```

---

## 13. Collections

### 13.1 Prefer immutable results when mutation is not needed

Use immutable factories for constants and defensive outputs.

```java
private static final Set<String> SUPPORTED_TYPES = Set.of("A", "B", "C");
```

### 13.2 Defensive copies

Constructors **MUST** defensively copy mutable input collections.

```java
public Order(List<OrderLine> lines) {
    this.lines = List.copyOf(Objects.requireNonNull(lines, "lines"));
}
```

### 13.3 `Stream.toList()` semantics

In Java 17, `stream.toList()` returns an unmodifiable list.

Use it only when an unmodifiable result is intended.

Good:

```java
List<OrderId> ids = orders.stream()
        .map(Order::id)
        .toList();
```

If mutation is required, be explicit:

```java
List<OrderId> ids = orders.stream()
        .map(Order::id)
        .collect(Collectors.toCollection(ArrayList::new));
```

### 13.4 Do not expose mutable internals

Bad:

```java
public List<OrderLine> lines() {
    return lines;
}
```

Good:

```java
public List<OrderLine> lines() {
    return List.copyOf(lines);
}
```

If `lines` is already an unmodifiable defensive copy, returning it directly is acceptable.

### 13.5 Choose the correct collection

| Need                                     | Preferred type             |
| ---------------------------------------- | -------------------------- |
| Ordered sequence                         | `List`                     |
| Unique values, no order                  | `Set`                      |
| Unique values, stable iteration order    | `LinkedHashSet`            |
| Key/value lookup                         | `Map`                      |
| Key/value lookup, stable iteration order | `LinkedHashMap`            |
| Sorted keys                              | `TreeMap` / `NavigableMap` |
| FIFO/LIFO queue                          | `Deque`                    |
| Concurrent keyed lookup                  | `ConcurrentHashMap`        |
| Blocking producer/consumer               | `BlockingQueue`            |

### 13.6 Avoid null elements

Collections **SHOULD NOT** contain null elements.

If external input may contain nulls, validate or filter explicitly.

---

## 14. Strings, charset, Unicode

### 14.1 Charset must be explicit

The agent **MUST** specify charset for byte/string conversion.

Good:

```java
String text = new String(bytes, StandardCharsets.UTF_8);
byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
```

Bad:

```java
String text = new String(bytes);
byte[] bytes = text.getBytes();
```

### 14.2 Use Unicode-aware APIs

Do not assume `char` means a user-visible character.

For Unicode code points:

```java
int codePointCount = text.codePointCount(0, text.length());
```

### 14.3 Do not use regex for simple checks unnecessarily

Good:

```java
if (value.isBlank()) {
    ...
}
```

Bad:

```java
if (value.matches("\\s*")) {
    ...
}
```

### 14.4 Locale-sensitive operations

Always specify locale for case conversion when behavior matters.

Good:

```java
String normalized = value.toLowerCase(Locale.ROOT);
```

Bad:

```java
String normalized = value.toLowerCase();
```

Use user locale only when the output is actually user-facing and locale-sensitive.

### 14.5 String formatting

Use the correct mechanism:

| Need                          | Mechanism                         |
| ----------------------------- | --------------------------------- |
| Debug/log message             | Parameterized logging             |
| User-facing localized message | `MessageFormat` or i18n framework |
| Technical formatted string    | `String.format(Locale.ROOT, ...)` |
| Simple internal concatenation | `+` is acceptable                 |
| Multiline constant            | Text block                        |

### 14.6 `String.formatted`

`String.formatted(...)` is available in Java 15+ and therefore Java 17.

It is allowed for small internal formatting.

Do not use it for SQL, shell commands, LDAP filters, XPath, HTML, or other injection-sensitive contexts.

---

## 15. Numbers, money, and precision

### 15.1 Money

Use `BigDecimal` for money.

Do not use `double` or `float` for money.

Bad:

```java
double price = 10.99;
```

Good:

```java
BigDecimal price = new BigDecimal("10.99");
```

### 15.2 BigDecimal construction

Do not construct `BigDecimal` from floating-point values.

Bad:

```java
new BigDecimal(10.99);
```

Good:

```java
new BigDecimal("10.99");
BigDecimal.valueOf(10.99); // acceptable when input is already double and trade-off is understood
```

### 15.3 Rounding

Rounding **MUST** be explicit.

```java
amount.setScale(2, RoundingMode.HALF_UP);
```

### 15.4 Integer overflow

For arithmetic where overflow matters, use exact methods.

```java
int total = Math.addExact(current, increment);
```

### 15.5 Units

Do not pass raw numbers when units matter.

Bad:

```java
retryAfter(5000);
```

Good:

```java
retryAfter(Duration.ofSeconds(5));
```

---

## 16. Date and time

### 16.1 Use `java.time`

New code **MUST** use `java.time`.

Preferred types:

| Need                   | Type             |
| ---------------------- | ---------------- |
| Machine timestamp      | `Instant`        |
| Date without time      | `LocalDate`      |
| Time without date      | `LocalTime`      |
| Date-time without zone | `LocalDateTime`  |
| Date-time with zone    | `ZonedDateTime`  |
| Offset timestamp       | `OffsetDateTime` |
| Time duration          | `Duration`       |
| Calendar period        | `Period`         |
| Time zone              | `ZoneId`         |

### 16.2 Inject `Clock`

Code that needs current time **MUST** use `Clock` where testability matters.

Good:

```java
public final class TokenService {
    private final Clock clock;

    public TokenService(Clock clock) {
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    public boolean isExpired(Token token) {
        return token.expiresAt().isBefore(Instant.now(clock));
    }
}
```

Bad:

```java
return token.expiresAt().isBefore(Instant.now());
```

### 16.3 Time zones

Do not rely on system default zone unless the requirement explicitly says so.

Good:

```java
LocalDate businessDate = instant.atZone(ZoneId.of("Asia/Singapore")).toLocalDate();
```

### 16.4 Persistence and integration

For external APIs and persistence:

1. Prefer ISO-8601 formats.
2. Store instants or offset timestamps unless a local business date is intended.
3. Do not lose zone/offset information accidentally.
4. Test daylight-saving transitions when relevant.

---

## 17. Exceptions and error handling

### 17.1 Do not swallow exceptions

Bad:

```java
try {
    process();
} catch (Exception ignored) {
}
```

Good:

```java
try {
    process();
} catch (IOException ex) {
    throw new ImportFailedException("failed to import orders from " + sourceName, ex);
}
```

### 17.2 Catch specific exceptions

Bad:

```java
catch (Exception ex) {
    ...
}
```

Good:

```java
catch (TimeoutException ex) {
    ...
} catch (IOException ex) {
    ...
}
```

Catching `Exception` is allowed only at system boundaries:

1. Scheduler entry point.
2. Message consumer boundary.
3. Controller/global exception handler.
4. CLI main boundary.
5. Thread/task wrapper.

### 17.3 Preserve cause

When wrapping exceptions, preserve the cause.

Good:

```java
throw new CaseExportException("failed to export case " + caseId, ex);
```

Bad:

```java
throw new CaseExportException("failed to export case");
```

### 17.4 Error messages

Error messages **MUST** include enough context for troubleshooting, but must not leak secrets or sensitive data.

Good:

```java
throw new OrderNotFoundException("order not found: " + orderId);
```

Bad:

```java
throw new RuntimeException("error");
```

### 17.5 Checked vs unchecked exceptions

Use checked exceptions for recoverable boundary conditions only when the codebase already uses them consistently.

Use unchecked domain exceptions for invariant violations and application-level failures.

Do not create deep checked-exception hierarchies without strong reason.

### 17.6 Validation failures

Validation failures **MUST** be explicit and structured at boundaries.

Do not rely on database constraint errors as normal validation behavior.

---

## 18. Logging

### 18.1 Use the project logging framework

The agent **MUST** use the existing logging framework.

Common acceptable options:

1. SLF4J.
2. Log4j2.
3. JUL only if the project already uses it.

Do not introduce a new logging framework.

### 18.2 Parameterized logging

Good:

```java
log.info("case {} moved from {} to {}", caseId, previousStatus, nextStatus);
```

Bad:

```java
log.info("case " + caseId + " moved from " + previousStatus + " to " + nextStatus);
```

### 18.3 Log levels

| Level   | Use                                                  |
| ------- | ---------------------------------------------------- |
| `trace` | Very detailed diagnostic flow, normally disabled.    |
| `debug` | Developer troubleshooting details.                   |
| `info`  | Important business/system lifecycle events.          |
| `warn`  | Recoverable abnormal condition requiring attention.  |
| `error` | Failed operation requiring intervention or alerting. |

### 18.4 Do not log secrets

The agent **MUST NOT** log:

1. Passwords.
2. Tokens.
3. Authorization headers.
4. API keys.
5. Private keys.
6. Full PII payloads.
7. Session cookies.
8. Raw request/response bodies unless sanitized and explicitly required.

### 18.5 Exception logging

Log exception with stack trace at the boundary where it is handled.

Good:

```java
log.error("failed to process case {}", caseId, ex);
```

Bad:

```java
log.error("failed to process case {}: {}", caseId, ex.getMessage());
```

Do not log and rethrow at every layer. That creates duplicate noisy logs.

---

## 19. Validation and invariants

### 19.1 Validate at boundaries

Validate external input at system boundaries:

1. HTTP controllers.
2. Message consumers.
3. File importers.
4. CLI input.
5. Scheduled job configuration.
6. Third-party API responses.

### 19.2 Protect domain invariants inside domain objects

Do not rely only on external validation.

Good:

```java
public record EscalationLevel(int value) {
    public EscalationLevel {
        if (value < 0 || value > 5) {
            throw new IllegalArgumentException("escalation level must be between 0 and 5");
        }
    }
}
```

### 19.3 Fail fast for impossible state

Use clear exceptions for impossible internal state.

```java
throw new IllegalStateException("unsupported transition from " + current + " to " + next);
```

### 19.4 Do not silently coerce invalid input

Bad:

```java
int size = requestedSize <= 0 ? 20 : requestedSize;
```

Good:

```java
if (requestedSize <= 0) {
    throw new IllegalArgumentException("requested size must be positive");
}
```

Coercion is allowed only when it is a documented business rule.

---

## 20. Object design

### 20.1 Prefer immutability

Classes **SHOULD** be immutable by default.

Good:

```java
public final class RetryPolicy {
    private final int maxAttempts;
    private final Duration delay;

    public RetryPolicy(int maxAttempts, Duration delay) {
        if (maxAttempts < 1) {
            throw new IllegalArgumentException("maxAttempts must be positive");
        }
        this.maxAttempts = maxAttempts;
        this.delay = Objects.requireNonNull(delay, "delay");
    }
}
```

### 20.2 Make fields private and final where possible

```java
private final OrderRepository orderRepository;
```

Avoid mutable public fields.

### 20.3 Constructor injection

For application services, prefer constructor injection.

Bad:

```java
@Autowired
private OrderRepository orderRepository;
```

Good:

```java
private final OrderRepository orderRepository;

public OrderService(OrderRepository orderRepository) {
    this.orderRepository = Objects.requireNonNull(orderRepository, "orderRepository");
}
```

### 20.4 Avoid utility-class dumping grounds

Utility classes are allowed only for stateless cohesive operations.

A utility class **MUST**:

1. Be `final`.
2. Have a private constructor throwing an exception.
3. Contain only related static methods.

```java
public final class CaseNumbers {
    private CaseNumbers() {
        throw new AssertionError("No instances");
    }
}
```

### 20.5 Avoid inheritance by default

Prefer composition over inheritance.

Use inheritance only when:

1. There is a true subtype relationship.
2. The base class has stable invariants.
3. Subclasses do not weaken contracts.
4. Tests cover base and subclass behavior.

### 20.6 `equals` and `hashCode`

If overriding `equals`, always override `hashCode`.

For value carriers, prefer records when appropriate.

Do not include mutable fields in equality unless mutation is controlled and understood.

---

## 21. State machines and workflow logic

### 21.1 Explicit states

Workflow state **MUST** be represented explicitly.

Good:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    ESCALATED,
    CLOSED,
    CANCELLED
}
```

Bad:

```java
private String status;
```

### 21.2 Explicit transitions

State transitions **MUST** be centralized or clearly owned.

Good:

```java
public boolean canTransitionTo(CaseStatus next) {
    return switch (this) {
        case DRAFT -> next == SUBMITTED || next == CANCELLED;
        case SUBMITTED -> next == UNDER_REVIEW || next == CANCELLED;
        case UNDER_REVIEW -> next == ESCALATED || next == CLOSED;
        case ESCALATED -> next == CLOSED;
        case CLOSED, CANCELLED -> false;
    };
}
```

### 21.3 No scattered status mutation

Bad:

```java
caseEntity.setStatus("APPROVED");
```

Good:

```java
caseEntity.transitionTo(CaseStatus.APPROVED, actor, clock.instant());
```

### 21.4 Transition audit

For regulatory or enforcement workflows, state transitions **SHOULD** capture:

1. Previous state.
2. Next state.
3. Actor.
4. Timestamp.
5. Reason.
6. Source action/request.
7. Correlation id.

### 21.5 Illegal transition behavior

Illegal transitions **MUST** fail explicitly.

```java
throw new IllegalStateException("cannot transition case " + caseId + " from " + current + " to " + next);
```

Do not silently ignore illegal transitions.

---

## 22. Layering

### 22.1 Respect architectural boundaries

The agent **MUST** preserve project layering.

Typical boundaries:

1. Controller/API layer.
2. Application service/use case layer.
3. Domain layer.
4. Repository/persistence adapter layer.
5. Integration/client adapter layer.
6. Configuration layer.

### 22.2 Controllers

Controllers **MUST**:

1. Validate request shape.
2. Convert transport DTOs to application commands.
3. Delegate business logic to application services.
4. Return response DTOs.
5. Avoid business rules.
6. Avoid direct repository access unless project architecture explicitly permits it.

### 22.3 Application services

Application services **MUST**:

1. Coordinate use cases.
2. Own transaction boundaries where appropriate.
3. Call repositories and external clients.
4. Enforce application-level authorization/permission checks where applicable.
5. Delegate core invariants to domain objects.

### 22.4 Domain layer

Domain layer **SHOULD**:

1. Be framework-light or framework-free where practical.
2. Own invariants.
3. Own state transitions.
4. Avoid HTTP, JSON, persistence, and messaging details.

### 22.5 Repository layer

Repositories **MUST**:

1. Encapsulate persistence details.
2. Avoid business decisions.
3. Return domain objects or persistence models according to project convention.
4. Make transaction and locking behavior clear.

### 22.6 Integration clients

Integration clients **MUST**:

1. Encapsulate external API details.
2. Set timeouts.
3. Map external errors to internal errors.
4. Avoid leaking provider-specific DTOs into domain logic.
5. Include correlation/request identifiers when the project supports them.

---

## 23. Persistence and database code

### 23.1 Parameterize queries

Never concatenate untrusted input into SQL, JPQL, XPath, LDAP, shell commands, or similar interpreters.

Bad:

```java
String sql = "select * from users where name = '" + name + "'";
```

Good:

```java
PreparedStatement statement = connection.prepareStatement(
        "select * from users where name = ?"
);
statement.setString(1, name);
```

### 23.2 Transaction boundaries

Transaction boundaries **MUST** be explicit and located at use-case/application-service level unless the framework convention says otherwise.

The agent **MUST NOT** add transactions blindly.

Before adding a transaction, identify:

1. What state must be atomic.
2. What external calls happen inside or outside the transaction.
3. Lock duration.
4. Failure behavior.
5. Retry/idempotency implications.

### 23.3 Avoid N+1 queries

When adding repository calls inside loops, the agent **MUST** check for N+1 behavior.

Bad:

```java
for (Order order : orders) {
    Customer customer = customerRepository.findById(order.customerId());
    ...
}
```

Prefer batch loading when needed.

### 23.4 Optimistic locking

For concurrent update workflows, prefer explicit versioning when supported.

The agent **MUST** consider:

1. Lost update risk.
2. Duplicate processing risk.
3. Idempotency key.
4. Retry safety.
5. User-visible conflict behavior.

### 23.5 Entity mutation

Do not expose entity setters casually.

Prefer methods that represent domain actions:

```java
caseEntity.assignOfficer(officerId, actor, assignedAt);
caseEntity.escalate(reason, actor, escalatedAt);
```

Bad:

```java
caseEntity.setOfficerId(officerId);
caseEntity.setStatus("ESCALATED");
```

---

## 24. HTTP and integration code

### 24.1 Prefer existing project client

Before using Java 17 `HttpClient`, the agent **MUST** check whether the project already uses:

1. Spring `RestTemplate` or `WebClient`.
2. Feign.
3. OkHttp.
4. Apache HttpClient.
5. JAX-RS client.
6. Project-specific integration abstraction.

Use the existing client unless there is a clear reason not to.

### 24.2 Java `HttpClient` rules

When using `java.net.http.HttpClient`, the agent **MUST** configure:

1. Connect timeout.
2. Request timeout.
3. Redirect policy if relevant.
4. Executor if async volume matters.
5. Error handling for non-2xx status.
6. Body size expectations.

Good:

```java
HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .followRedirects(HttpClient.Redirect.NEVER)
        .build();

HttpRequest request = HttpRequest.newBuilder(uri)
        .timeout(Duration.ofSeconds(10))
        .header("Accept", "application/json")
        .GET()
        .build();
```

### 24.3 Do not ignore status codes

Bad:

```java
return response.body();
```

Good:

```java
if (response.statusCode() < 200 || response.statusCode() >= 300) {
    throw new ExternalServiceException("provider returned status " + response.statusCode());
}
return response.body();
```

### 24.4 Retry policy

Retries **MUST** be explicit.

A retry policy must define:

1. Which errors are retryable.
2. Maximum attempts.
3. Backoff.
4. Jitter.
5. Timeout budget.
6. Idempotency safety.
7. Logging level.
8. Metrics if available.

Do not retry non-idempotent operations blindly.

### 24.5 Circuit breaking and rate limiting

The agent **MUST NOT** invent circuit breakers or rate limiters ad hoc.

Use project-approved libraries or existing infrastructure.

---

## 25. Concurrency

### 25.1 Default to synchronous code

Do not add concurrency unless there is a real requirement.

Concurrency adds:

1. Ordering risk.
2. Cancellation risk.
3. Error propagation risk.
4. Lifecycle complexity.
5. Resource exhaustion risk.
6. Test complexity.

### 25.2 Executor ownership

The agent **MUST NOT** create unbounded executors.

Bad:

```java
ExecutorService executor = Executors.newCachedThreadPool();
```

Better:

```java
ExecutorService executor = Executors.newFixedThreadPool(threadCount);
```

In managed frameworks, prefer framework-managed executors.

### 25.3 Executor lifecycle

If the code creates an executor, it **MUST** define shutdown behavior.

```java
executor.shutdown();
if (!executor.awaitTermination(30, TimeUnit.SECONDS)) {
    executor.shutdownNow();
}
```

### 25.4 CompletableFuture

`CompletableFuture` usage **MUST** include:

1. Explicit executor for async work.
2. Timeout where appropriate.
3. Exception handling.
4. Cancellation behavior.
5. Avoid blocking inside async stages.

Bad:

```java
return CompletableFuture.supplyAsync(() -> slowCall());
```

Good:

```java
return CompletableFuture.supplyAsync(this::slowCall, executor)
        .orTimeout(5, TimeUnit.SECONDS)
        .exceptionally(ex -> fallbackAfterFailure(ex));
```

### 25.5 Shared mutable state

Shared mutable state **MUST** be protected by one clear concurrency strategy:

1. Immutability.
2. Thread confinement.
3. Locking.
4. Concurrent collections.
5. Atomic variables.
6. Message passing.

Do not mix strategies casually.

### 25.6 Locks

When using locks:

1. Always release locks in `finally`.
2. Keep critical sections small.
3. Avoid external calls while holding locks.
4. Document lock ordering if multiple locks exist.
5. Prefer `tryLock` with timeout when deadlock risk exists.

### 25.7 Virtual threads are forbidden in Java 17 baseline

Do not generate code using `Thread.ofVirtual()`, `Executors.newVirtualThreadPerTaskExecutor()`, or virtual-thread assumptions.

---

## 26. Resource management and I/O

### 26.1 Use try-with-resources

All closeable resources **MUST** be closed deterministically.

Good:

```java
try (InputStream input = Files.newInputStream(path)) {
    return parser.parse(input);
}
```

Bad:

```java
InputStream input = Files.newInputStream(path);
return parser.parse(input);
```

### 26.2 Bounded reads

Do not read entire files or response bodies unless size is bounded and acceptable.

Bad for large files:

```java
String content = Files.readString(path);
```

Good:

```java
try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    ...
}
```

### 26.3 Temporary files

Temporary files **MUST**:

1. Use `Files.createTempFile` or `Files.createTempDirectory`.
2. Have clear cleanup behavior.
3. Avoid predictable names.
4. Avoid world-readable sensitive contents.

### 26.4 Path handling

Do not concatenate file paths as strings.

Bad:

```java
Path path = Path.of(basePath + "/" + fileName);
```

Good:

```java
Path path = basePath.resolve(fileName).normalize();
```

When processing user-controlled paths, validate against an allowed base directory.

### 26.5 Character encoding for files

Always specify charset.

```java
Files.newBufferedReader(path, StandardCharsets.UTF_8);
Files.newBufferedWriter(path, StandardCharsets.UTF_8);
```

---

## 27. Security

### 27.1 Secure by default

The agent **MUST** avoid introducing security-sensitive behavior without explicit design.

Security-sensitive areas include:

1. Authentication.
2. Authorization.
3. Cryptography.
4. Token handling.
5. Password handling.
6. Deserialization.
7. File upload/download.
8. External command execution.
9. SQL/LDAP/XPath/template evaluation.
10. Reflection.
11. Dynamic class loading.
12. Network calls.
13. Logging of sensitive data.

### 27.2 Input validation

Validate external input by allow-list where possible.

Good:

```java
if (!SUPPORTED_TYPES.contains(type)) {
    throw new ValidationException("unsupported type: " + type);
}
```

### 27.3 Output encoding

Do not manually escape HTML, XML, SQL, JSON, or shell contexts unless the project has a proven utility.

Use context-aware libraries.

### 27.4 Cryptography

The agent **MUST NOT** invent cryptographic protocols.

Forbidden:

1. MD5 for security.
2. SHA-1 for signatures/security.
3. ECB mode.
4. Hard-coded keys.
5. Static IVs/nonces.
6. Custom password hashing.
7. Insecure random for secrets.

Use:

1. `SecureRandom` for security-sensitive randomness.
2. Project-approved KMS/secret store.
3. Strong password hashing library when password storage is required.
4. TLS with proper certificate validation.

### 27.5 Randomness

Use `SecureRandom` for security tokens.

Use normal random generators only for simulations, tests, load distribution, or non-security randomness.

### 27.6 Deserialization

Java native serialization is dangerous.

The agent **MUST NOT** introduce native Java serialization for untrusted data.

If native deserialization already exists, harden it with:

1. Allow-list filters.
2. Size/depth limits.
3. Type restrictions.
4. Tests for rejected payloads.
5. Migration plan to safer formats where practical.

Java 17 supports context-specific deserialization filtering. Use it only when Java serialization cannot be removed.

### 27.7 Reflection

Reflection is restricted.

The agent **MUST NOT** use reflection to bypass visibility, mutate private state, access JDK internals, or avoid proper design.

Allowed only for:

1. Framework integration.
2. Serialization/deserialization libraries already used by the project.
3. Test utilities.
4. Annotation processing.
5. Explicitly justified generic infrastructure.

### 27.8 JDK internals

Do not use JDK internal APIs such as `sun.misc.Unsafe` or `com.sun.*`.

Do not add `--add-opens` or `--add-exports` as a default solution.

If the project already needs them, document why and keep usage isolated.

### 27.9 Secrets

Secrets **MUST NOT** be hard-coded.

Bad:

```java
private static final String API_KEY = "abc123";
```

Use environment, vault, KMS, secret manager, or existing configuration mechanism.

### 27.10 SecurityManager

Do not add new `SecurityManager` based controls.

In Java 17, the Security Manager is deprecated for removal, so authorization and isolation must be handled explicitly by application, platform, container, OS, or infrastructure controls.

---

## 28. Dependency management

### 28.1 Do not add dependencies casually

The agent **MUST NOT** add a dependency unless:

1. Existing JDK/project APIs are insufficient.
2. The dependency solves a real problem.
3. License/security/maintenance impact is acceptable.
4. Version is compatible with Java 17.
5. Transitive dependencies are acceptable.
6. The user or project convention allows it.

### 28.2 Prefer existing dependencies

Before adding a new library, inspect whether the project already has an equivalent.

### 28.3 No duplicate utility libraries

Do not add another utility library for functionality already present in:

1. JDK 17.
2. Existing project libraries.
3. Framework utilities already used.

### 28.4 Dependency scope

Use the narrowest dependency scope.

Examples:

1. Test libraries must be test-scoped.
2. Annotation processors must be processor-scoped where supported.
3. Runtime-only dependencies must not be compile dependencies unless needed.

---

## 29. Testing

### 29.1 Tests are required for behavioral changes

Any behavioral change **MUST** include or update tests unless explicitly impossible.

The agent **MUST** state when tests were not added and why.

### 29.2 Test naming

Test names **SHOULD** describe behavior.

Good:

```java
void shouldRejectTransitionFromClosedToSubmitted() {
    ...
}
```

Bad:

```java
void test1() {
    ...
}
```

### 29.3 Test structure

Use Arrange-Act-Assert or Given-When-Then consistently.

```java
// given
CaseEntity entity = closedCase();

// when / then
assertThrows(IllegalStateException.class,
        () -> entity.transitionTo(CaseStatus.SUBMITTED, actor, now));
```

### 29.4 Deterministic tests

Tests **MUST NOT** depend on:

1. Current system time.
2. Test execution order.
3. Random values without fixed seed.
4. External network.
5. Local machine paths.
6. Time zone defaults.
7. Locale defaults.

Inject `Clock`, use temp directories, and control locale/time zone where relevant.

### 29.5 Records and sealed tests

When using records:

1. Test validation constructors.
2. Test defensive copies for mutable components.
3. Test serialization only if serialization is part of contract.

When using sealed hierarchies:

1. Test each permitted subtype.
2. Test handling logic for all variants.
3. Test illegal or unsupported variants when `non-sealed` exists.

### 29.6 Concurrency tests

Concurrency tests must avoid fragile sleeps.

Prefer:

1. `CountDownLatch`.
2. `CyclicBarrier`.
3. Awaitility if already present.
4. Deterministic fake executors.
5. Explicit timeouts.

### 29.7 Integration tests

Integration tests **SHOULD** verify:

1. Persistence mapping.
2. Transaction behavior.
3. Serialization format.
4. External client error mapping.
5. Security behavior.
6. Migration compatibility.

---

## 30. Performance

### 30.1 Do not optimize blindly

The agent **MUST NOT** introduce complex performance optimizations without evidence.

Before optimizing, identify:

1. Hot path.
2. Input size.
3. Complexity.
4. Allocation pattern.
5. I/O behavior.
6. Concurrency behavior.
7. Measurement method.

### 30.2 Avoid accidental quadratic behavior

Bad:

```java
for (Order order : orders) {
    if (processedOrderIds.contains(order.id())) { // if List, O(n)
        ...
    }
}
```

Good:

```java
Set<OrderId> processedOrderIds = Set.copyOf(processedIds);
for (Order order : orders) {
    if (processedOrderIds.contains(order.id())) {
        ...
    }
}
```

### 30.3 Streams vs loops

Use streams for clarity.

Use loops when:

1. Control flow is complex.
2. Short-circuit behavior is non-trivial.
3. Exception handling is clearer.
4. Allocation matters in hot paths.
5. Debuggability matters.

### 30.4 Avoid unnecessary allocation

In hot paths:

1. Avoid repeated regex compilation.
2. Avoid unnecessary boxing.
3. Avoid repeated date/time formatter creation.
4. Avoid repeated collection copying.
5. Avoid constructing exception objects for normal control flow.

### 30.5 Caching

Do not add caching unless:

1. Data is safe to cache.
2. Invalidation is defined.
3. Size bound is defined.
4. TTL is defined when needed.
5. Concurrency behavior is defined.
6. Stale data behavior is acceptable.
7. Metrics/observability exist when important.

### 30.6 JVM-specific tuning

The agent **MUST NOT** add JVM flags as application logic.

JVM flags belong in deployment/runtime configuration and require environment-specific validation.

---

## 31. Serialization, JSON, and API DTOs

### 31.1 DTO boundaries

Do not expose domain entities directly as API DTOs unless the project explicitly does so.

Prefer explicit request/response records or classes.

```java
public record CreateCaseRequest(String subject, String description) {}
public record CaseResponse(String caseId, String status) {}
```

### 31.2 JSON compatibility

Changing field names, required fields, enum names, date formats, or null behavior is an API change.

The agent **MUST NOT** make such changes casually.

### 31.3 Unknown fields

For external APIs, decide whether unknown fields are accepted or rejected.

Do not change this behavior without tests.

### 31.4 Enum serialization

Do not rely blindly on enum ordinal.

Use stable string names or explicit external codes.

Bad:

```java
status.ordinal()
```

Good:

```java
status.externalCode()
```

### 31.5 Record DTO framework compatibility

Before using records as DTOs, verify that the project’s JSON binding/framework supports records correctly under Java 17.

If support is unclear, prefer ordinary immutable classes or project convention.

---

## 32. Configuration

### 32.1 Configuration ownership

Configuration values **MUST** be externalized.

Do not hard-code environment-specific values.

Bad:

```java
private static final URI PROVIDER_URI = URI.create("https://prod.example.com");
```

Good:

```java
public record ProviderClientProperties(URI baseUri, Duration timeout) {}
```

### 32.2 Validate configuration at startup

Invalid configuration should fail fast.

Validate:

1. Required values.
2. URL/URI syntax.
3. Timeouts.
4. Numeric ranges.
5. Feature flag combinations.
6. Credentials presence, without logging secret value.

### 32.3 Duration and size config

Use typed duration/size values where the framework supports them.

Avoid raw milliseconds or bytes in public configuration APIs.

---

## 33. Comments and documentation

### 33.1 Comments explain why, not what

Good:

```java
// Provider may send duplicate callbacks after timeout, so this update must be idempotent.
repository.markCallbackProcessed(callbackId);
```

Bad:

```java
// Save callback id.
repository.markCallbackProcessed(callbackId);
```

### 33.2 Javadocs

Public APIs **SHOULD** have Javadocs when:

1. They are library APIs.
2. They encode non-obvious domain rules.
3. They have important failure modes.
4. They define extension contracts.
5. They are used across modules.

### 33.3 No stale TODOs

The agent **MUST NOT** add TODO/FIXME comments unless:

1. The user requested a staged implementation.
2. The TODO references a ticket or explicit follow-up.
3. The current behavior is safe and complete.

### 33.4 Generated documentation claims

When documenting behavior inferred from code, distinguish:

1. Confirmed behavior.
2. Inferred behavior.
3. Assumption.
4. Unknown.

---

## 34. API design

### 34.1 Public API stability

The agent **MUST** treat public method signatures, DTO shapes, event payloads, database schemas, and serialized formats as compatibility-sensitive.

Do not modify them without explicit reason.

### 34.2 Method parameters

Prefer parameter objects when a method has too many parameters or parameters form a concept.

Bad:

```java
submitCase(String subject, String description, String applicantId, String officerId, boolean urgent)
```

Good:

```java
submitCase(SubmitCaseCommand command)
```

A Java 17 record is often appropriate for command objects:

```java
public record SubmitCaseCommand(
        String subject,
        String description,
        String applicantId,
        String officerId,
        boolean urgent
) {}
```

### 34.3 Return types

Return types **MUST** express behavior.

| Situation                             | Return type                                            |
| ------------------------------------- | ------------------------------------------------------ |
| Always returns value                  | Concrete value                                         |
| May be absent                         | `Optional<T>`                                          |
| Multiple results                      | `List<T>` / `Set<T>`                                   |
| Operation success/failure with detail | Domain result type or exception                        |
| Async result                          | `CompletableFuture<T>` only with executor/error policy |

### 34.4 Avoid boolean blindness

Bad:

```java
updateCase(caseId, true);
```

Good:

```java
updateCase(caseId, UpdateMode.FORCE);
```

### 34.5 Avoid ambiguous overloads

Do not add overloads that can be confused by `null`, lambdas, varargs, or similar argument types.

---

## 35. Framework usage

### 35.1 Do not fight the framework

The agent **MUST** follow the framework style already used by the project.

Examples:

1. Spring Boot annotations.
2. Jakarta EE annotations.
3. Quarkus CDI style.
4. Micronaut injection/configuration.
5. Plain Java style.

Do not mix frameworks.

### 35.2 Java 17 and Jakarta migration awareness

Java 17 projects often use newer frameworks that may require Jakarta namespaces.

The agent **MUST** check project imports before adding framework code.

Do not blindly mix:

```java
javax.persistence.*
```

with:

```java
jakarta.persistence.*
```

Follow the repository.

### 35.3 Annotation usage

Annotations **MUST** be used for framework contracts, not as magic decoration.

Do not add annotations without understanding lifecycle effects.

### 35.4 Lombok

If Lombok is already used, follow project convention.

If Lombok is not used, do not introduce it.

For Java 17, prefer records for simple immutable carriers when compatible, instead of adding Lombok just to reduce boilerplate.

---

## 36. Modules and encapsulation

### 36.1 JPMS

If the project uses `module-info.java`, the agent **MUST** preserve module boundaries.

Do not add `exports`, `opens`, or `requires transitive` casually.

### 36.2 Strong encapsulation

Java 17 strongly encapsulates JDK internals.

The agent **MUST NOT** solve reflection failures by blindly adding:

```text
--add-opens
--add-exports
```

Instead:

1. Use public APIs.
2. Upgrade incompatible libraries.
3. Isolate framework-required opens at the module boundary.
4. Document why the opening is necessary.

### 36.3 Reflection in modular projects

If a framework requires reflection, use narrowly scoped `opens`.

Bad:

```java
open module com.example.app {
    ...
}
```

Better:

```java
module com.example.app {
    opens com.example.app.web.dto to com.fasterxml.jackson.databind;
}
```

---

## 37. Migration from Java 11 to Java 17

When updating Java 11 code to Java 17, the agent **MUST NOT** rewrite everything to modern syntax.

Migration priority:

1. Compile and runtime compatibility.
2. Dependency compatibility.
3. Test pass.
4. Security and removed API fixes.
5. Minimal modernization where it reduces risk or complexity.
6. Optional syntax modernization only when local and safe.

### 37.1 Safe modernization candidates

Allowed when local and clear:

1. Use switch expressions for enum mapping.
2. Use records for internal immutable DTOs.
3. Use pattern matching for simple `instanceof` casts.
4. Use text blocks for test JSON/SQL.
5. Use `Stream.toList()` when unmodifiable result is intended.

### 37.2 Risky modernization candidates

Avoid unless requested:

1. Converting public DTOs to records.
2. Converting JPA entities to records.
3. Sealing public interfaces.
4. Replacing inheritance hierarchies with sealed hierarchies.
5. Changing collection mutability via `Stream.toList()`.
6. Rewriting control flow into complex switch expressions.
7. Adding modules to a non-modular project.
8. Adding `--add-opens` flags without root-cause analysis.

### 37.3 Migration compatibility checklist

The agent **MUST** check:

1. Build uses JDK 17 toolchain.
2. `--release 17` is configured.
3. Dependencies support Java 17.
4. Annotation processors support Java 17.
5. Test runtime supports Java 17.
6. Framework version supports Java 17.
7. Reflection warnings/errors are understood.
8. Removed Java EE/CORBA/Nashorn/Pack200 dependencies are not assumed.
9. SecurityManager usage is not newly introduced.
10. Docker/base image matches Java 17 runtime.

---

## 38. Generated code by LLM agents

### 38.1 Implementation summary required

After implementing code, the agent **MUST** provide a summary containing:

1. Files changed.
2. Behavior changed.
3. Java 17 features used.
4. Tests added/updated.
5. Assumptions.
6. Risks or follow-ups.

### 38.2 No fake completeness

The agent **MUST NOT** claim code is complete if:

1. It has placeholders.
2. It has unimplemented branches.
3. It lacks required tests.
4. It does not compile.
5. It ignores known failure paths.
6. It assumes missing classes or methods exist.

### 38.3 Evidence-first implementation

Before modifying code, the agent **SHOULD** identify:

1. Existing similar implementation.
2. Existing test style.
3. Existing error handling style.
4. Existing naming conventions.
5. Existing framework idioms.

### 38.4 Minimal diff rule

The agent **MUST** minimize unrelated diff.

Do not:

1. Reformat entire files.
2. Rename unrelated variables.
3. Rearrange methods unnecessarily.
4. Convert syntax unrelated to the task.
5. Change public APIs without need.

### 38.5 Failure path rule

Every generated implementation **MUST** define failure behavior:

1. Invalid input.
2. Missing data.
3. Duplicate data.
4. External timeout.
5. External non-2xx response.
6. Persistence failure.
7. Concurrent modification.
8. Partial success.
9. Retry exhaustion.
10. Unexpected enum/type value.

---

## 39. Code review checklist

Reviewers and LLM reviewer agents **MUST** check the following.

### 39.1 Java 17 compatibility

- [ ] Code compiles with `--release 17`.
- [ ] No Java >17 feature is used.
- [ ] No Java 17 preview/incubator feature is used accidentally.
- [ ] No virtual threads, structured concurrency, sequenced collections, record patterns, or pattern-switch-final syntax is used.
- [ ] `Stream.toList()` mutability impact is understood.
- [ ] Records are used only where appropriate.
- [ ] Sealed types are justified and tested.

### 39.2 Correctness

- [ ] Null behavior is explicit.
- [ ] Validation is at boundary and invariant level.
- [ ] State transitions are explicit.
- [ ] Error handling preserves cause.
- [ ] No exception is swallowed.
- [ ] Edge cases are tested.
- [ ] Public API compatibility is preserved.

### 39.3 Security

- [ ] No secrets are hard-coded or logged.
- [ ] Input is validated with allow-list where practical.
- [ ] SQL/JPQL/LDAP/XPath/shell/template input is parameterized or safely encoded.
- [ ] No unsafe deserialization is introduced.
- [ ] No insecure cryptography is introduced.
- [ ] No JDK internals or illegal reflection are introduced.
- [ ] No blind `--add-opens`/`--add-exports` workaround is added.

### 39.4 Performance and resources

- [ ] No accidental N+1 query.
- [ ] No accidental O(n²) behavior for large inputs.
- [ ] I/O is streaming when data may be large.
- [ ] Resources are closed with try-with-resources.
- [ ] Executors are bounded and shut down.
- [ ] Caching has invalidation and size policy.

### 39.5 Maintainability

- [ ] Names reveal intent.
- [ ] Methods are small and cohesive.
- [ ] Classes have clear responsibility.
- [ ] Comments explain why.
- [ ] Tests match repository style.
- [ ] No unrelated refactoring.
- [ ] No placeholder/TODO without explicit follow-up.

---

## 40. Strict Java 17 agent prompt snippet

Use this snippet in an LLM coding agent instruction file.

```text
You are implementing Java code for a strict Java 17 codebase.

You MUST:
- Compile against Java 17 and preserve Java 17 compatibility.
- Use `--release 17` assumptions for API availability.
- Follow the repository’s existing style, architecture, test framework, error model, and naming.
- Prefer minimal, local, reviewable changes.
- Make null handling, validation, failure behavior, transaction impact, and concurrency behavior explicit.
- Add or update tests for behavioral changes.
- Use Java 17 features only when they improve clarity and do not change public compatibility unexpectedly.

Allowed Java 17 features with restrictions:
- Records: only for immutable value carriers/DTOs; not JPA entities or behavior-heavy aggregates.
- Sealed classes/interfaces: only for intentionally closed hierarchies; must be justified and tested.
- Pattern matching for instanceof: allowed for simple type extraction.
- Switch expressions: allowed for pure value mapping; avoid side effects.
- Text blocks: allowed for readable multiline constants, SQL/JSON test data; never concatenate untrusted input.
- Stream.toList(): allowed only when an unmodifiable result is intended.

You MUST NOT:
- Use Java features after Java 17: virtual threads, structured concurrency, sequenced collections, record patterns, final pattern matching for switch, string templates, unnamed classes, or Foreign Function & Memory final API.
- Use Java 17 preview/incubator features unless explicitly requested and build-enabled.
- Use JDK internals, `sun.*`, `com.sun.*`, or blind `--add-opens`/`--add-exports` workarounds.
- Swallow exceptions, log secrets, hard-code credentials, concatenate untrusted input into interpreters, or introduce unsafe deserialization.
- Add dependencies, caching, async, reflection, global state, or broad refactors without evidence and justification.

After implementation, summarize:
- Files changed.
- Behavior changed.
- Java 17 features used.
- Tests added/updated.
- Assumptions and risks.
```

---

## 41. Java 17 feature decision table

| Situation                          | Preferred Java 17 construct                | Avoid                                                  |
| ---------------------------------- | ------------------------------------------ | ------------------------------------------------------ |
| Immutable DTO with simple fields   | `record`                                   | Lombok/data class boilerplate, mutable bean by default |
| Domain value with simple invariant | `record` with compact constructor          | Raw `String`/`int` everywhere                          |
| ORM entity                         | Normal class                               | `record`                                               |
| Closed set of domain variants      | `sealed interface` + final classes/records | Open interface when extension is not wanted            |
| Extensible plugin contract         | Normal interface                           | `sealed interface`                                     |
| Enum-to-value mapping              | Switch expression                          | Long if/else chain, map initialized with side effects  |
| Type check with cast               | Pattern matching `instanceof`              | Redundant cast                                         |
| Multiline test JSON                | Text block                                 | Escaped string soup                                    |
| SQL with parameters                | Text block + bind parameters               | Text block + string interpolation                      |
| Need mutable list from stream      | `collect(toCollection(ArrayList::new))`    | `stream.toList()` then mutate                          |
| Need unmodifiable list from stream | `stream.toList()`                          | Mutable collector followed by accidental mutation      |
| Concurrent blocking workload       | Bounded platform-thread executor           | Virtual threads in Java 17 baseline                    |
| Type-based switch                  | if/else or visitor                         | Pattern matching switch preview                        |

---

## 42. Anti-patterns forbidden in strict Java 17 code

### 42.1 Record abuse

Bad:

```java
public record Order(
        String id,
        String status,
        List<OrderLine> lines
) {
    public void approve() {
        // impossible to mutate cleanly; behavior model is confused
    }
}
```

Better:

```java
public final class Order {
    private final OrderId id;
    private OrderStatus status;
    private final List<OrderLine> lines;

    public void approve(Actor actor, Instant approvedAt) {
        if (status != OrderStatus.SUBMITTED) {
            throw new IllegalStateException("order must be submitted before approval");
        }
        this.status = OrderStatus.APPROVED;
    }
}
```

### 42.2 Sealed interface as decoration

Bad:

```java
public sealed interface OrderService permits DefaultOrderService {}
```

This adds no useful domain constraint and makes extension/testing harder.

### 42.3 Switch expression hiding workflow

Bad:

```java
return switch (command.type()) {
    case APPROVE -> {
        validate(command);
        repository.save(order);
        audit.log(...);
        yield response;
    }
    case REJECT -> {
        validate(command);
        repository.save(order);
        audit.log(...);
        yield response;
    }
};
```

Better:

```java
return switch (command.type()) {
    case APPROVE -> approve(command);
    case REJECT -> reject(command);
};
```

### 42.4 `Stream.toList()` mutation bug

Bad:

```java
List<String> names = users.stream()
        .map(User::name)
        .toList();

names.add("admin"); // throws UnsupportedOperationException
```

Good:

```java
List<String> names = users.stream()
        .map(User::name)
        .collect(Collectors.toCollection(ArrayList::new));
```

### 42.5 Blind `--add-opens`

Bad:

```text
--add-opens java.base/java.lang=ALL-UNNAMED
```

Better:

1. Identify the library requiring illegal reflection.
2. Upgrade the library.
3. Replace unsupported reflection with public API.
4. Add the narrowest opening only if unavoidable and documented.

---

## 43. References

Primary references used to define this standard:

1. Oracle JDK 17 Documentation: https://docs.oracle.com/en/java/javase/17/
2. Java SE 17 & JDK 17 API Documentation: https://docs.oracle.com/en/java/javase/17/docs/api/
3. Oracle JDK 17 Release Notes: https://www.oracle.com/java/technologies/javase/17-relnote-issues.html
4. Oracle Java Language Changes for Java SE 17: https://docs.oracle.com/en/java/javase/17/language/java-language-changes-release.html
5. Oracle Secure Coding Guidelines for Java SE: https://www.oracle.com/java/technologies/javase/seccodeguide.html
6. JEP 409 — Sealed Classes: https://openjdk.org/jeps/409
7. JEP 406 — Pattern Matching for switch, Preview: https://openjdk.org/jeps/406
8. JEP 395 — Records: https://openjdk.org/jeps/395
9. JEP 394 — Pattern Matching for instanceof: https://openjdk.org/jeps/394
10. JEP 378 — Text Blocks: https://openjdk.org/jeps/378
11. JEP 361 — Switch Expressions: https://openjdk.org/jeps/361
12. JEP 403 — Strongly Encapsulate JDK Internals: https://openjdk.org/jeps/403
13. JEP 411 — Deprecate the Security Manager for Removal: https://openjdk.org/jeps/411
14. JEP 415 — Context-Specific Deserialization Filters: https://openjdk.org/jeps/415
15. JEP 407 — Remove RMI Activation: https://openjdk.org/jeps/407
16. JEP 410 — Remove the Experimental AOT and JIT Compiler: https://openjdk.org/jeps/410
17. Google Java Style Guide: https://google.github.io/styleguide/javaguide.html
18. Oracle Code Conventions for the Java Programming Language: https://www.oracle.com/java/technologies/javase/codeconventions-contents.html

---

## 44. Final rule

Java 17 gives the codebase better modeling tools, but the agent **MUST** still optimize for correctness, explicit invariants, compatibility, security, and reviewability.

Modern syntax is acceptable only when it reduces ambiguity.

If a Java 17 feature makes the code clever but not clearer, do not use it.
