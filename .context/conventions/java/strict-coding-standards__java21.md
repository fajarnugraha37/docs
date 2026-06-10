# Strict Coding Standards — Java 21

> **Target runtime:** Java 21 / Java SE 21  
> **Audience:** LLM code agents, human reviewers, maintainers  
> **Purpose:** make generated Java 21 code predictable, reviewable, secure, maintainable, and compatible with a strict Java 21 baseline.

---

## 0. Non-negotiable operating rule for LLM agents

When implementing Java code, the agent **MUST** treat this document as an implementation contract, not as optional advice.

The agent **MUST**:

1. Preserve Java 21 compatibility.
2. Use only Java features and APIs available in **stable Java 21** unless the repository explicitly enables preview/incubator features.
3. Follow existing repository style when it is stricter than this document.
4. Prefer minimal, local, explainable changes over broad rewrites.
5. Avoid speculative refactors unless explicitly requested.
6. Never introduce dependencies, frameworks, runtime assumptions, public API changes, persistence changes, serialization changes, thread model changes, or behavioral changes without clear justification.
7. Produce code that compiles, is testable, observable where relevant, and has explicit failure behavior.
8. State assumptions when the surrounding codebase does not provide enough evidence.
9. Preserve domain vocabulary already used by the codebase.
10. Prefer boring, deterministic, reviewable code over clever syntax.

The agent **MUST NOT**:

1. Use Java features introduced after Java 21.
2. Use Java 21 preview or incubator features unless the user explicitly requests them and the build already enables them.
3. Generate code that only works on Java 22, 23, 24, 25, or newer.
4. Hide complexity behind vague helper methods.
5. Swallow exceptions.
6. Return `null` where an empty value, exception, or explicit optional result is required.
7. Add concurrency, caching, async behavior, virtual threads, reflection, serialization, bytecode manipulation, global state, or background scheduling unless the requirement truly needs it.
8. Change formatting or unrelated code just because it was nearby.
9. Create “enterprise ceremony” without a real invariant, boundary, dependency, lifecycle, or failure-mode need.
10. Treat modern Java syntax as a replacement for proper modeling.

---

## 1. Java 21 compatibility contract

### 1.1 Build level

All Java source code **MUST** compile with Java 21.

Recommended compiler configuration:

```bash
javac --release 21
```

Maven:

```xml
<properties>
    <maven.compiler.release>21</maven.compiler.release>
</properties>
```

Gradle:

```groovy
java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

tasks.withType(JavaCompile).configureEach {
    options.release = 21
}
```

The agent **MUST NOT** rely only on `sourceCompatibility = 21` and `targetCompatibility = 21` when `--release 21` is available, because `--release` prevents accidental use of newer JDK APIs during compilation.

### 1.2 Java 21 allowed feature surface

The following Java 21-compatible features and APIs are allowed when they improve clarity.

| Feature/API                                  | Java version | Allowed?       | Rule                                                                                                              |
| -------------------------------------------- | -----------: | -------------- | ----------------------------------------------------------------------------------------------------------------- |
| Lambdas and streams                          |            8 | Yes            | Use for simple transformations, not complex side-effect workflows.                                                |
| `Optional`                                   |            8 | Yes            | Use mainly as return type for possibly absent values.                                                             |
| `java.time`                                  |            8 | Yes            | Mandatory for new date/time code.                                                                                 |
| `CompletableFuture`                          |            8 | Restricted     | Use only with explicit executor policy and error handling.                                                        |
| NIO.2: `Path`, `Files`, channels             |         7/8+ | Yes            | Preferred over legacy `File` APIs for new code.                                                                   |
| `List.of`, `Set.of`, `Map.of`                |            9 | Yes            | Use for small immutable constants.                                                                                |
| `List.copyOf`, `Set.copyOf`, `Map.copyOf`    |           10 | Yes            | Use for defensive immutable copies.                                                                               |
| Local variable `var`                         |           10 | Restricted     | Allowed only when the type is obvious and readability improves.                                                   |
| `var` in lambda parameters                   |           11 | Restricted     | Allowed only when annotations are needed or consistency improves.                                                 |
| `String.isBlank`, `strip`, `lines`, `repeat` |           11 | Yes            | Prefer over ad-hoc string utilities when appropriate.                                                             |
| `Files.readString`, `Files.writeString`      |           11 | Yes            | Allowed for bounded/small text content only.                                                                      |
| `Collection.toArray(IntFunction)`            |           11 | Yes            | Prefer `collection.toArray(Type[]::new)`.                                                                         |
| `Optional.isEmpty`                           |           11 | Yes            | Allowed.                                                                                                          |
| `Predicate.not`                              |           11 | Yes            | Allowed when it improves readability.                                                                             |
| `java.net.http.HttpClient`                   |           11 | Yes            | Preferred standard HTTP client when no project client exists.                                                     |
| Switch expressions                           |           14 | Yes            | Use for pure value mapping; avoid side effects.                                                                   |
| Text blocks                                  |           15 | Yes            | Use for readable multiline constants, SQL, JSON, expected test data.                                              |
| Records                                      |           16 | Restricted     | Use for simple immutable value carriers, not behavior-heavy domain aggregates or JPA entities.                    |
| Pattern matching for `instanceof`            |           16 | Yes            | Use to reduce redundant casts, while keeping conditions readable.                                                 |
| Sealed classes/interfaces                    |           17 | Restricted     | Use only for intentionally closed domain hierarchies.                                                             |
| `Stream.toList()`                            |           16 | Restricted     | Allowed only when an unmodifiable result is intended.                                                             |
| Enhanced pseudo-random number generators     |           17 | Restricted     | Use only when the project needs explicit random generator selection.                                              |
| Context-specific deserialization filters     |           17 | Restricted     | Use for deserialization hardening when Java serialization cannot be avoided.                                      |
| UTF-8 default charset behavior               |           18 | Awareness      | Never rely on default charset for protocols, files, persistence, or signatures; still specify charset explicitly. |
| Sequenced collections                        |           21 | Restricted     | Use when encounter order is a real API invariant. Do not use just because it is new.                              |
| Record patterns                              |           21 | Restricted     | Use for simple deconstruction of stable value models. Avoid deep nested cleverness.                               |
| Pattern matching for `switch`                |           21 | Restricted     | Use for closed type dispatch and explicit mapping. Do not use for side-effect workflows.                          |
| Virtual threads                              |           21 | Restricted     | Use for high-concurrency blocking I/O tasks only. Never pool virtual threads.                                     |
| Key Encapsulation Mechanism API              |           21 | Restricted     | Use only inside reviewed cryptographic design. Do not invent crypto protocols.                                    |
| Generational ZGC                             |           21 | Runtime option | Runtime tuning only; never hard-code GC assumptions into source code.                                             |

### 1.3 Forbidden Java >21 features

The agent **MUST NOT** use these in strict Java 21 code:

| Forbidden feature/API                                                  |   Introduced after Java 21 | Replacement in Java 21                                                               |
| ---------------------------------------------------------------------- | -------------------------: | ------------------------------------------------------------------------------------ |
| Foreign Function & Memory API final                                    |                         22 | Java 21 standard APIs, JNI only with explicit approval, or project-approved library. |
| Unnamed variables/patterns final                                       |                         22 | Normal named variables and explicit ignored variable names like `ignored`.           |
| Stream gatherers                                                       |      22 preview / 24 final | Collectors, custom iterator/spliterator, or explicit loop.                           |
| Class-file API                                                         |      22 preview / 24 final | Project-approved bytecode library only when needed.                                  |
| Primitive types in patterns/switch                                     |              23/24 preview | Explicit conversion and normal primitive switch.                                     |
| Module import declarations                                             |              23/24 preview | Normal imports.                                                                      |
| Flexible constructor bodies                                            |              22/23 preview | Normal constructor validation before delegation only when legal in Java 21.          |
| Markdown documentation comments                                        |                 23 preview | Standard Javadoc.                                                                    |
| Stable values                                                          |                 25 preview | Explicit initialization and lifecycle-managed caching.                               |
| Compact source files / simplified main variants beyond Java 21 preview |      25+ preview/evolution | Normal Java class files with explicit `main`.                                        |
| Scoped values final/evolved API                                        |                   after 21 | Explicit parameters, request context objects, or approved framework context.         |
| Structured concurrency final/evolved API                               |                   after 21 | Explicit executor lifecycle, cancellation, timeout, and aggregation policy.          |
| String templates final/evolved API                                     | after 21 / preview changed | `String.format`, `MessageFormat`, builders, text blocks, parameterized logging/SQL.  |

### 1.4 Java 21 preview/incubator features are forbidden by default

Java 21 includes preview and incubator features. Generated code **MUST NOT** use them by default.

Forbidden unless explicitly requested and build-enabled:

1. String Templates — preview.
2. Foreign Function & Memory API — third preview in Java 21.
3. Unnamed Patterns and Variables — preview.
4. Unnamed Classes and Instance Main Methods — preview.
5. Scoped Values — preview.
6. Structured Concurrency — preview.
7. Vector API — sixth incubator.
8. Any API requiring `--enable-preview` or incubator modules.

If the user explicitly requests preview/incubator usage, the agent **MUST**:

1. State that the code is no longer strict portable Java 21 baseline.
2. Confirm the build uses `--enable-preview` where required.
3. Confirm tests compile and run with the same preview/incubator flags.
4. Keep preview code isolated behind a small boundary.
5. Add a migration note explaining how to remove or replace the preview dependency.
6. Avoid mixing preview syntax into stable production code without an explicit migration plan.

### 1.5 Removed, deprecated, or changed Java 21 platform behavior

The agent **MUST NOT** assume removed or obsolete JDK components exist.

Java 21-relevant guardrails:

1. Strong encapsulation of JDK internals remains enforced; do not use `sun.*`, `com.sun.*`, reflective access to JDK internals, or `--add-opens` as a lazy fix.
2. `SecurityManager` is deprecated for removal; do not design new security controls around it.
3. Dynamic agent loading emits warnings in Java 21 and is being prepared for stronger restrictions; do not rely on runtime self-attachment unless the project explicitly owns that behavior.
4. Windows 32-bit x86 port is deprecated for removal; do not add assumptions for that deployment target without confirmation.
5. Finalization is deprecated for removal; do not add finalizers.
6. RMI Activation was removed; do not generate code depending on `rmid` or activation APIs.
7. Experimental AOT and Graal JIT compiler support from older JDKs is removed; do not depend on old `jaotc`/AOT options.
8. Nashorn JavaScript engine was removed before Java 21; do not generate new code using Nashorn.
9. Pack200 was removed before Java 21; do not generate Pack200-based packaging logic.
10. Java EE/CORBA modules removed from JDK 11 remain absent; use explicit dependencies only when the project already owns them.
11. JavaFX is not bundled with the JDK; do not assume it exists.
12. Applet APIs are obsolete/deprecated; do not generate applet code.
13. Do not rely on default charset for persistent formats even though modern JDKs standardize UTF-8 by default; explicitly pass `StandardCharsets.UTF_8`.

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
16. Java 21 adoption policy, especially for virtual threads and pattern matching.

If the repository convention conflicts with this document:

1. Existing repository convention wins for local consistency.
2. Java 21 compatibility always wins over repository inconsistency.
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

Use:

```java
import java.util.List;
import java.util.Map;
```

Static imports are allowed only when they improve readability and are already used in the project.

Good in tests:

```java
import static org.assertj.core.api.Assertions.assertThat;
```

Bad in production:

```java
import static com.example.order.OrderStatus.*;
```

### 3.4 Declaration order

Use this order unless repository convention differs:

1. Package.
2. Imports.
3. Class/interface/record/enum Javadoc if public API.
4. Static constants.
5. Instance fields.
6. Constructors/factories.
7. Public methods.
8. Package-private methods.
9. Private methods.
10. Nested types.

Do not mix helper methods randomly between public methods unless it significantly improves local readability.

---

## 4. Formatting

### 4.1 General formatting

The agent **MUST** preserve the repository formatter.

If no formatter exists, default to:

1. 4 spaces indentation.
2. No tabs.
3. One statement per line.
4. Braces on the same line.
5. Maximum line length should follow project rules; otherwise prefer 100-120 characters.
6. Do not align fields or assignments with decorative spacing.
7. No trailing whitespace.
8. End every file with a newline.

Good:

```java
if (order.isExpired()) {
    reject(order);
}
```

Bad:

```java
if(order.isExpired()) reject(order);
```

### 4.2 Braces are mandatory

Always use braces for `if`, `else`, `for`, `while`, and `do` blocks.

Good:

```java
if (candidate.isEligible()) {
    approve(candidate);
}
```

Bad:

```java
if (candidate.isEligible()) approve(candidate);
```

### 4.3 Do not reformat unrelated code

The agent **MUST NOT** reformat entire files when the task only requires a small change.

Allowed:

1. Formatting changed lines.
2. Formatting nearby code needed for syntactic correctness.
3. Applying repository formatter when explicitly requested.

Forbidden:

1. Reordering imports in unrelated files.
2. Changing line wrapping across unrelated methods.
3. Renaming variables outside the task scope.
4. Reformatting generated files manually.

---

## 5. Naming standards

### 5.1 Classes and interfaces

Use nouns or noun phrases.

Good:

```java
OrderService
PaymentRequest
EligibilityPolicy
```

Bad:

```java
DoOrder
ProcessEverything
CommonUtil
```

Class names **MUST** communicate responsibility, not implementation mechanics.

### 5.2 Methods

Use verbs or verb phrases.

Good:

```java
calculateTotalAmount()
findActiveOrders()
rejectExpiredApplication()
```

Bad:

```java
total()
data()
handle()
process()
```

Generic names such as `process`, `handle`, `execute`, `doWork`, and `manage` are forbidden unless the surrounding abstraction makes the action unambiguous.

### 5.3 Variables

Variable names **MUST** reveal domain meaning.

Good:

```java
var renewalApplication = applicationRepository.findById(applicationId);
```

Bad:

```java
var data = repo.find(id);
```

Avoid one-letter variables except for conventional short loops or mathematical formulas.

### 5.4 Constants

Constants use `UPPER_SNAKE_CASE`.

```java
private static final int MAX_RETRY_ATTEMPTS = 3;
```

Do not create constants for values that are used once and are already self-explanatory.

### 5.5 Boolean names

Boolean fields and methods **MUST** read naturally.

Good:

```java
boolean isEligible;
boolean hasExpired();
boolean canSubmit();
```

Bad:

```java
boolean eligibleFlag;
boolean checkExpired();
boolean submitStatus;
```

---

## 6. Modern Java 21 language features

### 6.1 `var`

`var` is allowed only when the inferred type is obvious from the right-hand side or the type is not important.

Good:

```java
var order = orderRepository.getRequired(orderId);
var lineItems = List.of(firstItem, secondItem);
```

Bad:

```java
var result = service.execute(request);
var value = mapper.map(input);
```

Do not use `var` for public API signatures. Java does not allow it for method parameters or return types anyway; do not simulate ambiguity with generic `Object`.

### 6.2 Switch expressions

Use switch expressions for pure mappings.

Good:

```java
var severity = switch (violationType) {
    case MINOR -> Severity.LOW;
    case MAJOR -> Severity.MEDIUM;
    case CRITICAL -> Severity.HIGH;
};
```

Bad:

```java
switch (status) {
    case APPROVED -> auditService.recordApproval(order);
    case REJECTED -> notificationService.sendRejection(order);
    default -> workflowService.requeue(order);
}
```

For side effects, prefer explicit methods with names that describe the transition.

### 6.3 Pattern matching for `instanceof`

Use pattern matching for `instanceof` when it removes redundant casts.

Good:

```java
if (event instanceof PaymentReceived paymentReceived) {
    applyPayment(paymentReceived);
}
```

Bad:

```java
if (event instanceof PaymentReceived paymentReceived && paymentReceived.amount().signum() > 0
        && paymentReceived.reference() != null && paymentReceived.reference().length() > 12) {
    // too much logic in condition
}
```

Complex conditions **MUST** be extracted into named methods.

### 6.4 Records

Records are allowed for simple immutable data carriers.

Good:

```java
public record MoneyAmount(BigDecimal value, Currency currency) {
    public MoneyAmount {
        Objects.requireNonNull(value, "value");
        Objects.requireNonNull(currency, "currency");
        if (value.scale() > currency.getDefaultFractionDigits()) {
            throw new IllegalArgumentException("value scale exceeds currency precision");
        }
    }
}
```

Records are good for:

1. DTOs.
2. Query results.
3. Immutable value objects.
4. Messages/events with stable schema.
5. Test fixtures.
6. Small internal tuples where field names carry meaning.

Records are bad for:

1. JPA entities.
2. Mutable aggregates.
3. Objects with complex lifecycle.
4. Objects requiring identity-based equality.
5. Classes with many optional fields.
6. Types where binary/source compatibility of constructor shape is unstable.

Record rules:

1. Validate invariants in the compact constructor.
2. Use defensive copies for mutable components.
3. Do not expose mutable collections directly.
4. Do not add setters.
5. Do not put business workflows inside records.
6. Do not use records just to avoid writing a class.

Good defensive copy:

```java
public record OrderSnapshot(String orderId, List<OrderLine> lines) {
    public OrderSnapshot {
        Objects.requireNonNull(orderId, "orderId");
        lines = List.copyOf(lines);
    }
}
```

### 6.5 Record patterns

Record patterns are stable in Java 21, but **restricted**.

Use record patterns when:

1. The record is a stable value model.
2. Deconstruction makes the code more readable than accessor calls.
3. The pattern is shallow enough to understand at a glance.
4. The code is doing classification, mapping, or validation.

Good:

```java
static String describe(Address address) {
    return switch (address) {
        case Address(String street, String city, String postalCode) ->
                city + " " + postalCode;
    };
}
```

Acceptable nested usage:

```java
static boolean isJakartaCustomer(Customer customer) {
    return customer instanceof Customer(String id, Address(String street, String city, String postalCode))
            && "Jakarta".equals(city);
}
```

Bad:

```java
return switch (object) {
    case A(B(C(D(var x, var y), var z), var q), var r) -> x + y + z + q + r;
    default -> "unknown";
};
```

Record pattern rules:

1. Do not use deep nested patterns where named helper methods are clearer.
2. Do not use record patterns to bypass domain methods.
3. Do not destructure records just to immediately pass components around unchanged.
4. Do not destructure records whose constructor/accessor contract is likely to change.
5. Do not use record patterns in public examples if the repository still targets Java 17.
6. Treat pattern variables as read-only even though Java does not make them implicitly final.

### 6.6 Pattern matching for `switch`

Pattern matching for `switch` is stable in Java 21, but **restricted**.

Use it for:

1. Closed type dispatch.
2. Mapping domain alternatives to values.
3. Replacing brittle `instanceof` chains.
4. Working with sealed hierarchies.
5. Explicitly handling `null` when needed.

Good:

```java
sealed interface PaymentEvent permits PaymentReceived, PaymentFailed, PaymentCancelled {}

record PaymentReceived(String paymentId) implements PaymentEvent {}
record PaymentFailed(String paymentId, String reason) implements PaymentEvent {}
record PaymentCancelled(String paymentId) implements PaymentEvent {}

static PaymentStatus statusOf(PaymentEvent event) {
    return switch (event) {
        case PaymentReceived received -> PaymentStatus.PAID;
        case PaymentFailed failed -> PaymentStatus.FAILED;
        case PaymentCancelled cancelled -> PaymentStatus.CANCELLED;
    };
}
```

Good explicit null handling:

```java
static String labelOf(Object value) {
    return switch (value) {
        case null -> "<null>";
        case String text when text.isBlank() -> "blank";
        case String text -> text;
        case Integer number -> "number:" + number;
        default -> "unknown";
    };
}
```

Pattern switch rules:

1. Prefer switch expressions over switch statements when producing a value.
2. Keep case bodies small.
3. Avoid side effects inside cases.
4. Handle `null` intentionally: either `case null` or fail fast before switch.
5. Avoid `default` for sealed hierarchies when exhaustive cases give better compile-time safety.
6. Do not use broad cases before narrow cases.
7. Do not hide domain gaps behind `default -> throw new IllegalStateException(...)` if explicit cases are possible.
8. Do not use guarded patterns (`when`) for complex business rules; extract named predicates.
9. Do not switch on `Object` when a better domain type exists.
10. Prefer polymorphism when behavior belongs to the type itself.

Bad:

```java
return switch (event) {
    case Object ignored -> "something"; // dominates everything and destroys type information
};
```

### 6.7 Sealed classes and interfaces

Sealed types are allowed only for intentionally closed hierarchies.

Good:

```java
public sealed interface CaseDecision permits ApprovedDecision, RejectedDecision, EscalatedDecision {
}
```

Use sealed types when:

1. All valid subtypes are known and controlled by this module.
2. Exhaustive handling is valuable.
3. The domain is naturally finite.
4. Adding a new subtype should force compile-time review.

Do not use sealed types when:

1. Third parties need to extend the type.
2. The hierarchy is framework-managed.
3. The set of subtypes changes frequently.
4. A simple enum would be enough.

Rules:

1. Keep permitted subtypes close to the sealed type where practical.
2. Do not create sealed hierarchies for “cool syntax”.
3. Prefer package-private permitted implementations unless they are part of public API.
4. Use pattern switch carefully for exhaustive handling.
5. Document why the hierarchy is closed if it is public.

### 6.8 Text blocks

Text blocks are allowed for readable multiline text.

Good:

```java
private static final String FIND_ACTIVE_ORDERS = """
        select id, customer_id, status
        from orders
        where status = ?
        order by created_at desc
        """;
```

Rules:

1. Use text blocks for SQL, JSON, XML, HTML snippets, expected test data, and multiline messages.
2. Keep indentation intentional.
3. Avoid text blocks for short one-line strings.
4. Do not concatenate user input into SQL text blocks.
5. Use parameter binding for SQL.
6. Avoid embedding secrets.

### 6.9 Sequenced collections

Sequenced collections are stable in Java 21 and may be used when encounter order is part of the contract.

Good:

```java
void publishInEncounterOrder(SequencedCollection<DomainEvent> events) {
    for (var event : events) {
        publisher.publish(event);
    }
}
```

Good first/last access:

```java
static OrderStep firstStep(SequencedCollection<OrderStep> steps) {
    if (steps.isEmpty()) {
        throw new IllegalArgumentException("steps must not be empty");
    }
    return steps.getFirst();
}
```

Rules:

1. Use `SequencedCollection` when first/last/reversed order is a real API requirement.
2. Use `SequencedSet` when uniqueness and encounter order are both required.
3. Use `SequencedMap` when key/value mapping and encounter order are both required.
4. Do not use sequenced interfaces just to look modern.
5. Do not assume `HashSet` or `HashMap` has deterministic order.
6. Treat `reversed()` as a view unless copied; modifications may be reflected.
7. Prefer `List` if random access by index is required.
8. Prefer `Deque` if queue/deque semantics are the real abstraction.
9. Prefer `LinkedHashMap` or `LinkedHashSet` for concrete insertion-ordered implementations.
10. Explicitly test first/last/reversed behavior when it is part of business logic.

Bad:

```java
SequencedCollection<String> names = new ArrayList<>();
// no first/last/reversed invariant exists; List would be clearer
```

### 6.10 Virtual threads

Virtual threads are stable in Java 21, but **restricted**.

Use virtual threads when:

1. The workload is high-concurrency blocking I/O.
2. Each task is naturally independent.
3. The code benefits from simple thread-per-task style.
4. External resources are bounded separately.
5. The repository or runtime platform has explicitly adopted Java 21 virtual-thread execution.

Good:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    var futures = requests.stream()
            .map(request -> executor.submit(() -> client.fetch(request)))
            .toList();

    for (var future : futures) {
        responses.add(future.get());
    }
}
```

Rules:

1. **Never pool virtual threads.** Create one virtual thread per task.
2. Do not use virtual threads to speed up CPU-bound work.
3. Bound external resources with connection pools, rate limiters, bulkheads, or semaphores.
4. Always define timeout and cancellation behavior for remote calls.
5. Avoid long blocking inside `synchronized` sections because it can pin carrier threads.
6. Avoid native calls or foreign-memory interactions in virtual-thread code unless reviewed.
7. Keep `ThreadLocal` usage small and intentional; do not put heavy request state in thread locals.
8. Prefer explicit parameters for context propagation.
9. Do not combine virtual threads with unbounded queue growth.
10. Observe and test under load; virtual threads improve scalability, not correctness.
11. Do not assume every library is virtual-thread-friendly.
12. Do not replace an existing reactive/event-loop architecture without architectural approval.

Bad:

```java
var pool = Executors.newFixedThreadPool(100, Thread.ofVirtual().factory()); // forbidden pooling pattern
```

Better:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    // submit independent tasks
}
```

Virtual threads are not a license to remove backpressure.

### 6.11 Structured concurrency and scoped values

Structured concurrency and scoped values are preview in Java 21 and **forbidden by default**.

Use normal Java 21 stable constructs:

1. Explicit method parameters.
2. Request context objects.
3. `ExecutorService` with clear lifecycle.
4. `try/finally` cleanup.
5. Timeouts and cancellation with `Future`/`CompletableFuture` where appropriate.

Do not generate `StructuredTaskScope` or `ScopedValue` code unless explicitly requested and the build is preview-enabled.

### 6.12 String templates

String templates are preview in Java 21 and **forbidden by default**.

Use stable alternatives:

```java
String message = String.format("Order %s is %s", orderId, status);
```

For logging:

```java
log.info("Order {} is {}", orderId, status);
```

For SQL:

```java
// Use parameter binding, not string interpolation.
```

Do not generate `STR."..."` code in strict Java 21 production code.

---

## 7. Null handling

### 7.1 Default null policy

New code **MUST** avoid returning `null` unless the existing API requires it.

Prefer:

1. Empty collections.
2. Empty strings only when semantically valid.
3. `Optional<T>` for absent return values.
4. Exceptions for invalid state or failed required lookup.
5. Null-object pattern only when already used and meaningful.

### 7.2 Validate public boundaries

Validate external inputs at boundaries:

1. Controller/request DTO boundary.
2. Message consumer boundary.
3. Public API method boundary.
4. Persistence mapping boundary.
5. Integration client boundary.
6. Configuration binding boundary.

Good:

```java
public SubmitOrderCommand(String customerId, List<OrderLine> lines) {
    this.customerId = Objects.requireNonNull(customerId, "customerId");
    this.lines = List.copyOf(Objects.requireNonNull(lines, "lines"));
    if (this.lines.isEmpty()) {
        throw new IllegalArgumentException("lines must not be empty");
    }
}
```

### 7.3 `Optional` rules

Allowed:

```java
Optional<Customer> findCustomer(CustomerId id);
```

Forbidden:

```java
Optional<Customer> customer; // field, usually forbidden
void updateCustomer(Optional<Customer> customer); // parameter, usually forbidden
```

Rules:

1. Use `Optional` primarily as a return type.
2. Do not use `Optional` fields in entities/DTOs unless framework compatibility is confirmed.
3. Do not accept `Optional` parameters; overload or accept nullable only if existing API requires it.
4. Do not call `get()` without prior presence check.
5. Prefer `orElseThrow` for required values.
6. Avoid nested `Optional<Optional<T>>`.
7. Do not serialize `Optional` unless project explicitly supports it.

Good:

```java
var customer = customerRepository.findById(customerId)
        .orElseThrow(() -> new CustomerNotFoundException(customerId));
```

Bad:

```java
var customer = customerRepository.findById(customerId).get();
```

---

## 8. Exceptions and error handling

### 8.1 Do not swallow exceptions

Forbidden:

```java
try {
    sendEmail(message);
} catch (Exception ignored) {
}
```

Allowed only with explicit rationale and logging/metrics where appropriate:

```java
try {
    auditPublisher.publish(event);
} catch (AuditUnavailableException ex) {
    log.warn("Audit publish failed for eventId={}. Continuing because audit is non-blocking.", event.id(), ex);
}
```

### 8.2 Catch specific exceptions

Good:

```java
try {
    return objectMapper.readValue(payload, OrderCreatedEvent.class);
} catch (JsonProcessingException ex) {
    throw new InvalidEventPayloadException(eventId, ex);
}
```

Bad:

```java
try {
    return mapper.readValue(payload, clazz);
} catch (Exception ex) {
    throw new RuntimeException(ex);
}
```

### 8.3 Preserve cause

When wrapping exceptions, always preserve the cause.

Good:

```java
throw new OrderSubmissionException(orderId, ex);
```

Bad:

```java
throw new OrderSubmissionException("failed");
```

### 8.4 Do not use exceptions for normal control flow

Bad:

```java
try {
    return repository.get(id);
} catch (NotFoundException ex) {
    return null;
}
```

Better:

```java
return repository.findById(id);
```

### 8.5 Exception taxonomy

Use project-specific exception types when they represent meaningful failure categories.

Recommended categories:

1. Validation failure.
2. Not found.
3. Conflict / version mismatch.
4. Unauthorized / forbidden.
5. External dependency unavailable.
6. Timeout.
7. Serialization/deserialization failure.
8. Invariant violation.
9. Configuration error.
10. Unexpected internal error.

Do not create a new exception class for every method.

### 8.6 Checked vs unchecked exceptions

Use checked exceptions only when callers can realistically recover and the repository already uses checked exceptions.

Use unchecked exceptions for:

1. Programming errors.
2. Invariant violations.
3. Invalid state.
4. Required data missing.
5. Framework boundary errors that are centrally mapped.

Do not convert every checked exception to `RuntimeException` without domain context.

---

## 9. Logging and observability

### 9.1 Use the project logging framework

The agent **MUST** use the logger already used by the repository.

Typical SLF4J example:

```java
private static final Logger log = LoggerFactory.getLogger(OrderService.class);
```

Do not use:

```java
System.out.println("debug");
ex.printStackTrace();
```

### 9.2 Parameterized logging

Good:

```java
log.info("Submitted order orderId={} customerId={}", orderId, customerId);
```

Bad:

```java
log.info("Submitted order " + orderId + " for " + customerId);
```

### 9.3 Log level rules

Use levels intentionally:

1. `trace`: very detailed diagnostic flow, disabled normally.
2. `debug`: developer diagnostics, not business audit.
3. `info`: significant lifecycle/business events.
4. `warn`: recoverable abnormal condition.
5. `error`: failed operation requiring attention.

Do not log normal validation failures as `error`.

### 9.4 Sensitive data

Never log:

1. Passwords.
2. Access tokens.
3. Refresh tokens.
4. API keys.
5. Private keys.
6. Full identity numbers.
7. Full credit card or bank details.
8. Raw personal data unless explicitly approved.
9. Session cookies.
10. Authorization headers.

Mask or hash identifiers when required by project policy.

### 9.5 Exception logging

Log an exception once at the boundary where it is handled.

Bad:

```java
catch (Exception ex) {
    log.error("Failed", ex);
    throw ex;
}
```

Good:

```java
catch (RemoteClientException ex) {
    throw new PaymentGatewayUnavailableException(paymentId, ex);
}
```

Then log at controller/job/consumer boundary if needed.

### 9.6 Correlation and context

When available, include stable correlation identifiers:

1. Request ID.
2. Trace ID.
3. Case ID.
4. Application ID.
5. User ID or actor ID if safe.
6. External reference ID.

Do not invent correlation systems if the project already has one.

---

## 10. Collections and immutability

### 10.1 Prefer interfaces in APIs

Good:

```java
List<OrderLine> lines()
Map<String, String> attributes()
```

Avoid exposing concrete implementations:

```java
ArrayList<OrderLine> lines()
HashMap<String, String> attributes()
```

Use concrete types only when the concrete behavior matters.

### 10.2 Defensive copies

For immutable ownership, use copies.

Good:

```java
this.lines = List.copyOf(lines);
```

Bad:

```java
this.lines = lines;
```

### 10.3 Empty collections

Return empty collections, not `null`.

Good:

```java
return List.of();
```

Bad:

```java
return null;
```

### 10.4 Mutability must be explicit

`Stream.toList()` returns an unmodifiable list. Use it only when that is intended.

Good:

```java
var activeIds = orders.stream()
        .filter(Order::isActive)
        .map(Order::id)
        .toList();
```

If mutation is required:

```java
var activeIds = orders.stream()
        .filter(Order::isActive)
        .map(Order::id)
        .collect(Collectors.toCollection(ArrayList::new));
```

### 10.5 `List.of` and `Map.of` limits

Use `List.of`, `Set.of`, and `Map.of` for small constants.

Rules:

1. They reject `null`.
2. They are unmodifiable.
3. `Set.of` and `Map.of` reject duplicates.
4. For larger maps, prefer `Map.ofEntries` or builder/factory methods.

### 10.6 Avoid accidental quadratic behavior

Bad:

```java
for (var order : orders) {
    if (selectedOrderIds.contains(order.id())) {
        result.add(order);
    }
}
```

If `selectedOrderIds` is a list and large, convert to a set first:

```java
var selected = Set.copyOf(selectedOrderIds);
for (var order : orders) {
    if (selected.contains(order.id())) {
        result.add(order);
    }
}
```

### 10.7 Sequenced collection mutability

`reversed()` usually returns a reverse-ordered view. If a snapshot is required, copy it.

```java
var reversedSnapshot = List.copyOf(events.reversed());
```

Do not mutate a reversed view unless the write-through behavior is intentional and tested.

---

## 11. Generics

### 11.1 Avoid raw types

Forbidden:

```java
List orders = new ArrayList();
```

Required:

```java
List<Order> orders = new ArrayList<>();
```

### 11.2 Use bounded wildcards intentionally

Use `? extends T` for producers and `? super T` for consumers.

Good:

```java
void publishAll(Collection<? extends DomainEvent> events) { }
void addHandlers(Collection<? super OrderHandler> handlers) { }
```

Do not add wildcards when they make API usage harder without benefit.

### 11.3 Avoid over-generic APIs

Bad:

```java
<T, R, C, X> R process(T input, C context, Function<T, R> mapper, X extra)
```

Good:

```java
OrderDecision decide(OrderApplication application, DecisionContext context)
```

Generic code must earn its complexity.

---

## 12. Streams

### 12.1 Use streams for simple pipelines

Good:

```java
var activeCustomerIds = customers.stream()
        .filter(Customer::isActive)
        .map(Customer::id)
        .toList();
```

Bad:

```java
customers.stream()
        .peek(customer -> audit(customer))
        .filter(customer -> updateState(customer))
        .map(customer -> repository.save(customer))
        .forEach(customer -> notify(customer));
```

Streams are for transformation, not hidden workflows.

### 12.2 Avoid side effects

Do not mutate external state inside stream operations unless the operation is terminal and intentionally imperative.

Bad:

```java
var result = new ArrayList<String>();
orders.stream()
        .filter(Order::isActive)
        .forEach(order -> result.add(order.id()));
```

Good:

```java
var result = orders.stream()
        .filter(Order::isActive)
        .map(Order::id)
        .toList();
```

### 12.3 Parallel streams

The agent **MUST NOT** introduce `parallelStream()` by default.

Parallel streams are allowed only when:

1. The workload is CPU-bound.
2. The data size is large enough.
3. Operations are stateless and thread-safe.
4. The common fork-join pool behavior is acceptable or explicitly controlled.
5. Benchmarks justify it.

Never use parallel streams for blocking I/O.

### 12.4 Prefer loops when clearer

Use a loop when:

1. There are multiple side effects.
2. Error handling is complex.
3. Early exit is important.
4. Debuggability matters.
5. The stream would require nested lambdas.
6. The operation is stateful.

Boring loop is often better than clever stream.

### 12.5 `mapMulti`

`mapMulti` is allowed when it avoids intermediate collections and remains readable.

Good:

```java
var violationCodes = cases.stream()
        .<String>mapMulti((caseFile, downstream) -> {
            for (var violation : caseFile.violations()) {
                downstream.accept(violation.code());
            }
        })
        .toList();
```

Do not use `mapMulti` if `flatMap` is clearer and allocation is irrelevant.

---

## 13. Strings, charset, Unicode, and locale

### 13.1 Charset must be explicit

For files, HTTP, signatures, hashing, persistence, and protocols, always specify charset.

Good:

```java
Files.readString(path, StandardCharsets.UTF_8);
body.getBytes(StandardCharsets.UTF_8);
```

Bad:

```java
Files.readString(path);
body.getBytes();
```

Even on Java 21, do not rely on the platform default charset for durable data.

### 13.2 Use `isBlank` intentionally

`isBlank()` checks Unicode whitespace. Use it when that is intended.

```java
if (name == null || name.isBlank()) {
    throw new IllegalArgumentException("name must not be blank");
}
```

Do not replace every `isEmpty()` with `isBlank()` blindly; empty and blank are different business states.

### 13.3 Locale-sensitive operations

Always specify locale for case conversion when output matters.

Good:

```java
status.name().toLowerCase(Locale.ROOT);
```

Bad:

```java
status.name().toLowerCase();
```

Use `Locale.ROOT` for machine-readable transformations.
Use user locale only for user-facing text.

### 13.4 Unicode correctness

Do not assume one Java `char` equals one user-visible character.

Rules:

1. Use code points when processing Unicode characters semantically.
2. Be careful with emoji and supplementary characters.
3. Normalize text when equality/search semantics require it.
4. Do not truncate arbitrary strings by `substring(0, n)` for user-visible length without understanding code points/graphemes.
5. Do not use regex `\w` or `[A-Za-z]` for international names unless that limitation is intended.

### 13.5 String concatenation

Allowed for simple local strings.

Use builders or formatters for repeated concatenation in loops.

Bad:

```java
String csv = "";
for (var item : items) {
    csv += item.code() + ",";
}
```

Good:

```java
var csv = new StringBuilder();
for (var item : items) {
    csv.append(item.code()).append(',');
}
```

For logs, use parameterized logging.

---

## 14. Date and time

### 14.1 Use `java.time`

New code **MUST** use `java.time`.

Allowed:

1. `Instant` for machine timestamps.
2. `LocalDate` for date-only values.
3. `LocalDateTime` only when timezone is genuinely absent from the domain.
4. `ZonedDateTime` for timezone-aware user/business time.
5. `OffsetDateTime` for timestamp with offset.
6. `Duration` for machine time intervals.
7. `Period` for calendar date intervals.
8. `Clock` for testable current time.

Forbidden for new code unless integrating legacy APIs:

1. `java.util.Date`.
2. `java.util.Calendar`.
3. `java.sql.Date` as domain type.
4. Raw `long` timestamps without unit in the name/type.

### 14.2 Inject `Clock`

Good:

```java
public final class ExpiryPolicy {
    private final Clock clock;

    public ExpiryPolicy(Clock clock) {
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    public boolean isExpired(Instant expiresAt) {
        return !expiresAt.isAfter(clock.instant());
    }
}
```

Bad:

```java
return expiresAt.isBefore(Instant.now());
```

Use `Instant.now(clock)` for testability.

### 14.3 Timezone rules

1. Store machine timestamps as `Instant` unless the domain requires otherwise.
2. Convert to user timezone at the boundary.
3. Do not use system default timezone silently.
4. Use explicit `ZoneId`.
5. Be careful with DST transitions.
6. Never compare formatted date strings.

### 14.4 Duration units

Variable names must include units when using numbers.

Good:

```java
long timeoutMillis = 5000;
Duration timeout = Duration.ofSeconds(5);
```

Bad:

```java
long timeout = 5000;
```

Prefer `Duration` over raw milliseconds.

---

## 15. Numbers, money, and precision

### 15.1 Money

Use `BigDecimal` for money.

Bad:

```java
double amount = 10.25;
```

Good:

```java
BigDecimal amount = new BigDecimal("10.25");
```

Rules:

1. Construct money from string, integer minor units, or validated decimal input.
2. Do not construct monetary `BigDecimal` from `double`.
3. Always specify rounding mode when division may be non-terminating.
4. Keep currency with amount.
5. Avoid floating point for financial decisions.

### 15.2 BigDecimal equality

`BigDecimal.equals` compares scale; `compareTo` compares numeric value.

```java
new BigDecimal("1.0").equals(new BigDecimal("1.00")); // false
new BigDecimal("1.0").compareTo(new BigDecimal("1.00")); // 0
```

Use the comparison that matches the domain invariant.

### 15.3 Overflow

Use exact arithmetic when overflow matters.

```java
int total = Math.addExact(current, delta);
```

Do not silently overflow counters, money minor units, limits, or capacities.

---

## 16. Concurrency

### 16.1 Do not add concurrency by default

The agent **MUST NOT** introduce concurrency unless required.

Concurrency requires explicit answers to:

1. What can run concurrently?
2. What shared state exists?
3. What ordering is required?
4. What timeout applies?
5. What cancellation behavior applies?
6. What failure propagation applies?
7. What backpressure applies?
8. What resource limit applies?
9. How is it tested?
10. How is it observed?

### 16.2 Executor lifecycle

Every executor created by application code **MUST** have a lifecycle.

Good:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    // tasks
}
```

For long-lived platform thread pools:

```java
executor.shutdown();
if (!executor.awaitTermination(30, TimeUnit.SECONDS)) {
    executor.shutdownNow();
}
```

Do not create unmanaged executors in methods.

### 16.3 Virtual-thread concurrency policy

When using virtual threads:

1. Use `Executors.newVirtualThreadPerTaskExecutor()` for task-per-thread style.
2. Do not wrap virtual threads in a fixed pool.
3. Do not use virtual threads for CPU-bound loops.
4. Limit database/API/file/socket concurrency separately.
5. Keep blocking I/O interruptible where possible.
6. Propagate cancellation.
7. Avoid synchronized blocking sections.
8. Monitor pinning and carrier thread usage under load.
9. Keep thread names useful when debugging.
10. Avoid hidden task explosions from nested submissions.

### 16.4 Platform-thread pool policy

When using platform thread pools:

1. Give the pool a clear owner.
2. Name threads.
3. Set bounded queues where appropriate.
4. Define rejection policy.
5. Define shutdown behavior.
6. Do not use `Executors.newCachedThreadPool()` by default.
7. Do not use `Executors.newFixedThreadPool()` without queue/backpressure consideration.
8. Do not block on the common fork-join pool.

### 16.5 Shared mutable state

Avoid shared mutable state.

If required:

1. Guard it with proper synchronization.
2. Use concurrent collections intentionally.
3. Keep critical sections small.
4. Document invariants.
5. Test concurrent behavior.

Do not use `volatile` as a magic thread-safety fix. `volatile` gives visibility, not compound atomicity.

### 16.6 CompletableFuture

`CompletableFuture` is allowed only with explicit error handling.

Good:

```java
return CompletableFuture.supplyAsync(() -> client.fetch(request), executor)
        .orTimeout(3, TimeUnit.SECONDS)
        .exceptionally(ex -> fallbackResponse(request, ex));
```

Rules:

1. Pass an explicit executor unless the common pool is intentionally acceptable.
2. Handle exceptions.
3. Avoid nested futures.
4. Avoid blocking with `join()` inside request threads unless justified.
5. Define timeout behavior.
6. Avoid mixing `CompletableFuture` with virtual threads unless the architecture needs it.

### 16.7 Locks

Prefer higher-level concurrency utilities before manual locks.

If using locks:

1. Always unlock in `finally`.
2. Keep lock scope small.
3. Avoid I/O while holding locks.
4. Avoid calling external code while holding locks.
5. Define lock ordering if multiple locks exist.

Good:

```java
lock.lock();
try {
    updateState();
} finally {
    lock.unlock();
}
```

---

## 17. I/O and resources

### 17.1 Use try-with-resources

Any closeable resource **MUST** be closed deterministically.

Good:

```java
try (var reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    return reader.readLine();
}
```

Bad:

```java
var reader = new FileReader(file);
return reader.readLine();
```

### 17.2 Prefer `Path` over `File`

Good:

```java
Path inputPath = Path.of(input);
```

Bad:

```java
File inputFile = new File(input);
```

Use `File` only for legacy API integration.

### 17.3 Bounded file reads

Do not use `Files.readString` or `Files.readAllBytes` for unbounded files.

Allowed:

```java
Files.readString(configPath, StandardCharsets.UTF_8);
```

Forbidden for large/user-supplied files:

```java
var payload = Files.readString(uploadPath);
```

For large files, stream or chunk.

### 17.4 Temporary files

Use JDK APIs for temp files.

```java
Path tempFile = Files.createTempFile("report-", ".csv");
```

Rules:

1. Do not hard-code `/tmp`.
2. Do not use predictable names.
3. Clean up temp files.
4. Set permissions when sensitive.
5. Avoid logging full paths if sensitive.

### 17.5 Path traversal

When accepting user-provided paths, normalize and validate against an allowed base directory.

```java
Path target = baseDir.resolve(userProvidedName).normalize();
if (!target.startsWith(baseDir)) {
    throw new SecurityException("Invalid path");
}
```

Do not trust file names from uploads, zip entries, email attachments, or HTTP headers.

---

## 18. HTTP and external clients

### 18.1 Prefer existing project client

Before adding `java.net.http.HttpClient`, check whether the repository already uses:

1. Spring `RestTemplate`.
2. Spring `WebClient`.
3. Feign.
4. Apache HttpClient.
5. OkHttp.
6. A generated OpenAPI client.
7. A shared internal client wrapper.

Use the project standard unless there is a clear reason not to.

### 18.2 Java HTTP client rules

When using Java 11+ `HttpClient` in Java 21:

1. Reuse `HttpClient` instances.
2. Set connect timeout.
3. Set request timeout.
4. Do not build URLs by unsafe string concatenation.
5. Validate status codes explicitly.
6. Handle redirects intentionally.
7. Avoid logging sensitive headers/body.
8. Use explicit charset for text bodies.
9. Handle interruption correctly.
10. Add retry only when idempotency is clear.

Good:

```java
var request = HttpRequest.newBuilder(uri)
        .timeout(Duration.ofSeconds(5))
        .header("Accept", "application/json")
        .GET()
        .build();

var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
if (response.statusCode() < 200 || response.statusCode() >= 300) {
    throw new ExternalServiceException("Unexpected status: " + response.statusCode());
}
```

### 18.3 Retries

Retry only when:

1. The operation is idempotent, or idempotency key is used.
2. The failure is transient.
3. Maximum attempts are bounded.
4. Backoff is used.
5. Timeout budget is respected.
6. Observability exists.

Do not retry validation errors, authentication failures, authorization failures, or non-idempotent writes without idempotency protection.

### 18.4 Circuit breakers and bulkheads

Do not implement homemade circuit breakers unless the project already has no approved resilience library and the requirement is small.

Prefer project-approved resilience mechanisms.

---

## 19. Serialization and deserialization

### 19.1 Avoid Java native serialization

Do not introduce `Serializable`, `ObjectInputStream`, or Java native serialization for new application protocols.

Allowed only when:

1. Interoperating with existing legacy code.
2. Required by a framework.
3. Deserialization filters are configured.
4. Input source is trusted or strongly constrained.
5. Security review is documented.

### 19.2 JSON mapping

Follow repository conventions.

Rules:

1. Keep DTOs separate from domain models when boundaries differ.
2. Validate required fields.
3. Avoid exposing internal enums directly in public APIs unless stable.
4. Use explicit date/time formats at external boundaries.
5. Do not ignore unknown fields unless versioning policy allows it.
6. Do not enable default typing globally in Jackson.
7. Do not deserialize into overly broad types such as `Object` or raw `Map` unless validated.

### 19.3 Records as DTOs

Records can be good DTOs in Java 21.

Rules:

1. Validate invariants in compact constructor.
2. Consider framework constructor/deserialization support.
3. Avoid records for DTOs with many optional fields.
4. Preserve API compatibility when record component names are part of JSON property names.
5. Use annotations only as already approved in the project.

### 19.4 Versioning

Message/event/API schema changes must be backward-compatible unless explicitly coordinated.

Do not:

1. Rename serialized fields casually.
2. Change enum string values casually.
3. Change number formats casually.
4. Change date/time formats casually.
5. Change nullability casually.
6. Reuse old fields with new meaning.

---

## 20. Security

### 20.1 Input validation

Validate input at trust boundaries.

Trust boundaries include:

1. HTTP requests.
2. Queue messages.
3. File uploads.
4. Email contents and attachments.
5. External API responses.
6. Database data crossing old trust boundaries.
7. Configuration values.
8. Command-line arguments.

Validation should check:

1. Required fields.
2. Length.
3. Format.
4. Range.
5. Allowed values.
6. Cross-field consistency.
7. Encoding.
8. Business invariants.

### 20.2 SQL injection

Do not concatenate SQL with user input.

Bad:

```java
var sql = "select * from users where name = '" + name + "'";
```

Good:

```java
var statement = connection.prepareStatement("select * from users where name = ?");
statement.setString(1, name);
```

### 20.3 Command injection

Avoid shell execution.

If process execution is required:

1. Use `ProcessBuilder` with separate arguments.
2. Do not invoke shell unless required.
3. Validate executable path.
4. Validate arguments with allow-lists.
5. Set timeout.
6. Capture stdout/stderr safely.
7. Do not pass secrets in command-line args.

### 20.4 Secrets

Do not hard-code secrets.

Forbidden:

```java
private static final String API_KEY = "abc123";
```

Use approved configuration/secrets mechanism.

Do not log secrets. Do not expose secrets in exception messages.

### 20.5 Cryptography

Do not invent cryptography.

Rules:

1. Use standard JCA/JCE APIs or project-approved libraries.
2. Use secure random for security-sensitive randomness.
3. Do not use MD5 or SHA-1 for security decisions.
4. Do not use ECB mode.
5. Use authenticated encryption where appropriate.
6. Store passwords with password hashing algorithms, not raw hashes.
7. Keep keys out of source code.
8. Define key rotation and storage requirements.
9. Use KEM API only as part of reviewed protocol design.
10. Do not use `Random` for security tokens.

Good:

```java
SecureRandom secureRandom = SecureRandom.getInstanceStrong();
```

Use `SecureRandom` carefully; `getInstanceStrong()` may block on some systems. Follow project security guidance.

### 20.6 Deserialization security

If Java serialization cannot be avoided:

1. Use allow-list deserialization filters.
2. Limit graph depth.
3. Limit object count.
4. Limit byte size.
5. Reject unexpected classes.
6. Keep deserialization away from public untrusted input.

### 20.7 Dynamic agents and instrumentation

Java 21 warns when agents are loaded dynamically into a running JVM.

Rules:

1. Do not add runtime self-attachment for application behavior.
2. Prefer startup-time agents for approved observability tooling.
3. Keep test-only dynamic agents isolated to test configuration.
4. Document any `-XX:+EnableDynamicAgentLoading` usage.
5. Do not suppress dynamic-agent warnings without understanding the tool requiring it.

### 20.8 Reflection and method handles

Reflection is restricted.

Use reflection only when:

1. Required by framework integration.
2. Required by serialization/mapping infrastructure.
3. There is no simpler typed API.
4. Access is covered by tests.
5. Strong encapsulation is not bypassed casually.

Do not use reflection to access private state just because it is convenient.

### 20.9 Dependency introduction

The agent **MUST NOT** add dependencies without justification.

Before adding a dependency, check:

1. Is the functionality already in the JDK?
2. Is the functionality already in the project?
3. Is the dependency actively maintained?
4. Is the license acceptable?
5. Is the transitive dependency tree acceptable?
6. Does it affect startup, memory, native image, deployment, or security scanning?
7. Is there a simpler local implementation?

---

## 21. Persistence and transactions

### 21.1 Transaction boundary

Do not move transaction boundaries casually.

Before changing transactional code, identify:

1. What data must commit atomically?
2. What external calls occur inside the transaction?
3. What locks are held?
4. What isolation level is assumed?
5. What retry behavior exists?
6. What idempotency protection exists?
7. What events are emitted before/after commit?

### 21.2 Do not perform slow external I/O inside database transactions

Bad:

```java
@Transactional
public void approve(ApplicationId id) {
    application.approve();
    externalClient.notifyApproval(id); // external I/O inside transaction
    repository.save(application);
}
```

Better:

```java
@Transactional
public ApprovalResult approve(ApplicationId id) {
    application.approve();
    repository.save(application);
    eventPublisher.publishAfterCommit(new ApplicationApproved(id));
    return ApprovalResult.approved(id);
}
```

Follow the project’s actual event/outbox pattern.

### 21.3 Optimistic locking

For concurrent updates, preserve version checks.

Do not remove:

1. Version columns.
2. Compare-and-set conditions.
3. Unique constraints.
4. Idempotency keys.
5. Locking queries.
6. Retry guards.

### 21.4 Query construction

Use project-approved query mechanisms:

1. JPA criteria/query methods.
2. QueryDSL.
3. jOOQ.
4. Prepared statements.
5. MyBatis parameter binding.

Do not concatenate user input into queries.

### 21.5 Entity rules

Do not make JPA entities records.

Entity rules:

1. Preserve no-arg constructor if framework needs it.
2. Preserve identity semantics.
3. Avoid business logic that requires lazy-loaded data unexpectedly.
4. Avoid exposing mutable collections directly.
5. Keep bidirectional relationship updates consistent.
6. Do not casually change fetch type.
7. Do not casually add cascade remove.
8. Do not casually change equals/hashCode.

---

## 22. Domain modeling

### 22.1 Model invariants explicitly

Domain objects should protect their invariants.

Good:

```java
public final class ApplicationPeriod {
    private final LocalDate startDate;
    private final LocalDate endDate;

    public ApplicationPeriod(LocalDate startDate, LocalDate endDate) {
        this.startDate = Objects.requireNonNull(startDate, "startDate");
        this.endDate = Objects.requireNonNull(endDate, "endDate");
        if (endDate.isBefore(startDate)) {
            throw new IllegalArgumentException("endDate must not be before startDate");
        }
    }
}
```

Bad:

```java
public record ApplicationPeriod(LocalDate startDate, LocalDate endDate) {}
```

A record without validation is only safe when there is no invariant beyond component presence.

### 22.2 State transitions

State transitions **MUST** be explicit.

Good:

```java
application.submit(submittedBy, submittedAt);
application.approve(approvedBy, approvedAt);
application.reject(rejectedBy, reason, rejectedAt);
```

Bad:

```java
application.setStatus(Status.APPROVED);
```

Rules:

1. Validate allowed source states.
2. Record actor/time/reason when required.
3. Emit events consistently if project uses events.
4. Preserve audit requirements.
5. Avoid status mutation from random services.

### 22.3 Enums

Use enums for stable finite sets.

Rules:

1. Do not persist enum ordinal.
2. Do not expose enum names externally if the API requires stable independent codes.
3. Add behavior to enum only when behavior is truly tied to the constant.
4. Avoid giant enums with unrelated responsibilities.
5. Use switch expressions for simple mapping.

Good:

```java
public enum ApplicationStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

### 22.4 Value objects

Use value objects for concepts with validation.

Examples:

1. EmailAddress.
2. MoneyAmount.
3. CaseReference.
4. ApplicationId.
5. DateRange.
6. RetryPolicy.

A stringly-typed domain is easy to generate and painful to maintain.

---

## 23. Layering and architecture

### 23.1 Respect boundaries

The agent **MUST NOT** bypass layers.

Typical boundaries:

1. Controller/resource layer: protocol concerns.
2. Application/service layer: use-case orchestration.
3. Domain layer: invariants and state transitions.
4. Repository layer: persistence.
5. Client/gateway layer: external systems.
6. Messaging layer: event/message boundaries.
7. Configuration layer: runtime configuration.

Do not put SQL in controllers. Do not put HTTP request objects in domain models. Do not put business decisions in mappers.

### 23.2 Dependency direction

Inner domain code should not depend on outer infrastructure.

Good:

```java
class SubmitApplicationUseCase {
    private final ApplicationRepository repository;
    private final ApplicationPolicy policy;
}
```

Bad:

```java
class Application {
    private final JdbcTemplate jdbcTemplate;
}
```

### 23.3 DTO/domain separation

Do not reuse external DTOs as domain objects unless the project intentionally does so.

Mapping is useful when:

1. External API shape differs from domain model.
2. Validation differs by boundary.
3. Domain invariants are stronger.
4. Versioning matters.
5. Persistence shape differs from behavior shape.

### 23.4 Utility classes

Avoid dumping logic into `Utils` classes.

A static helper is allowed when:

1. It is pure.
2. It has no hidden dependencies.
3. It represents a real reusable operation.
4. Naming is specific.

Bad:

```java
CommonUtils.process(data);
```

Good:

```java
ApplicationReferences.normalize(reference);
```

---

## 24. API design

### 24.1 Public API stability

Do not change public method signatures unless required.

Changing these is a breaking change:

1. Method name.
2. Parameter order.
3. Parameter type.
4. Return type.
5. Checked exceptions.
6. Generic bounds.
7. Serialized field names.
8. Record component names.
9. Enum constant names if serialized.
10. Nullability contract.

### 24.2 Method parameters

Avoid long parameter lists.

Bad:

```java
submit(String name, String email, String phone, String address, String postalCode, boolean urgent)
```

Good:

```java
submit(SubmitApplicationCommand command)
```

Use command/value objects when parameters form a concept.

### 24.3 Return types

Return the most useful abstraction.

1. Return domain result when caller needs decision details.
2. Return `Optional<T>` for possibly absent values.
3. Return empty collections for no results.
4. Return immutable collections when ownership should not leak.
5. Avoid returning `Map<String, Object>` from typed application code.

### 24.4 Validation location

Validate:

1. Syntactic/protocol constraints at boundary.
2. Business invariants in domain/application layer.
3. Persistence constraints in database as final guard.

Do not rely only on UI validation.

---

## 25. Testing standards

### 25.1 Tests are required for behavior changes

Any behavior change should include tests unless impossible.

At minimum test:

1. Happy path.
2. Boundary conditions.
3. Invalid input.
4. Not found / conflict.
5. External dependency failure.
6. Serialization compatibility where relevant.
7. State transition rules.
8. Concurrency behavior where relevant.
9. Virtual-thread execution behavior where relevant.
10. Migration compatibility where relevant.

### 25.2 Test naming

Use descriptive names.

Good:

```java
@Test
void submitRejectsApplicationWhenRequiredDocumentIsMissing() {
}
```

Bad:

```java
@Test
void testSubmit() {
}
```

### 25.3 Test structure

Prefer Arrange-Act-Assert.

```java
@Test
void approveMovesSubmittedApplicationToApproved() {
    var application = submittedApplication();

    application.approve(actor, clock.instant());

    assertThat(application.status()).isEqualTo(ApplicationStatus.APPROVED);
}
```

### 25.4 Deterministic tests

Tests **MUST NOT** depend on:

1. Current system time without injected `Clock`.
2. Test execution order.
3. Local timezone.
4. Local default charset.
5. Randomness without fixed seed.
6. External network.
7. Existing local files.
8. Shared mutable static state.

### 25.5 Virtual-thread tests

When testing virtual-thread code:

1. Verify behavior, not thread implementation details, unless thread model is the feature.
2. Test cancellation/timeout.
3. Test external-resource bounding.
4. Test exception propagation.
5. Avoid sleeps; use latches/barriers/fakes.
6. Keep tests deterministic.

### 25.6 Pattern matching tests

When using pattern switch or record patterns:

1. Test every meaningful subtype/case.
2. Test `null` behavior if input can be null.
3. Test newly added sealed subtype handling.
4. Avoid relying only on default branch tests.

### 25.7 Do not over-mock

Mock external boundaries, not the domain model.

Prefer real value objects and fake repositories for domain-heavy tests.

### 25.8 Assertions

Use precise assertions.

Bad:

```java
assertThat(result).isNotNull();
```

Good:

```java
assertThat(result.status()).isEqualTo(ApplicationStatus.REJECTED);
assertThat(result.reason()).contains("missing document");
```

---

## 26. Performance standards

### 26.1 Do not optimize blindly

Before optimizing, identify:

1. Input size.
2. Hot path.
3. Latency target.
4. Throughput target.
5. Memory target.
6. Allocation profile.
7. I/O behavior.
8. Lock contention.
9. Database query plan.
10. Benchmark evidence.

### 26.2 Avoid obvious waste

Do not:

1. Compile regex repeatedly in loops.
2. Create expensive objects repeatedly when reusable and thread-safe.
3. Load entire large files into memory.
4. Perform nested linear scans over large collections.
5. Log huge payloads.
6. Use reflection in hot paths without need.
7. Use exceptions as normal control flow.
8. Use virtual threads to hide unbounded downstream pressure.
9. Use parallelism without bounding.
10. Allocate unnecessary intermediate collections.

### 26.3 Regex

Compile reusable regex patterns.

Good:

```java
private static final Pattern REFERENCE_PATTERN = Pattern.compile("[A-Z]{3}-\\d{6}");
```

Bad:

```java
if (value.matches("[A-Z]{3}-\\d{6}")) {
}
```

For one-off validation, `matches` is acceptable if not in a hot path.

### 26.4 Memory

Rules:

1. Stream large data.
2. Avoid retaining large object graphs.
3. Clear references only when it actually helps lifecycle.
4. Prefer primitive arrays only in proven hot paths.
5. Beware of `String.split` on large input.
6. Beware of collecting huge streams to list.
7. Use bounded queues.
8. Avoid global caches without eviction.

### 26.5 GC assumptions

Do not hard-code code behavior around a specific garbage collector.

Allowed runtime documentation:

1. Java 21 supports runtime GC choices including G1, ZGC, and Generational ZGC.
2. GC choice belongs to deployment/performance tuning, not business source logic.
3. Any GC tuning must be benchmarked with production-like workload.

---

## 27. Configuration

### 27.1 No magic environment reads deep in code

Bad:

```java
var timeout = Integer.parseInt(System.getenv("TIMEOUT"));
```

Good:

```java
public record ClientProperties(Duration timeout, URI baseUri) {}
```

Read configuration at the configuration boundary and inject typed values.

### 27.2 Configuration validation

Validate configuration at startup.

Rules:

1. Required values must be present.
2. Durations must be positive and bounded.
3. URLs must be valid.
4. Credentials must not be logged.
5. Unknown config should fail or warn according to project policy.
6. Defaults must be intentional.

### 27.3 Feature flags

Feature flags must have:

1. Clear name.
2. Owner.
3. Default value.
4. Removal plan.
5. Test coverage for both paths.
6. Observability when relevant.

Do not create permanent feature-flag graveyards.

---

## 28. Comments and documentation

### 28.1 Comments explain why

Good:

```java
// The external provider may resend the same callback; preserve idempotency by ignoring older versions.
if (!event.version().isAfter(currentVersion)) {
    return;
}
```

Bad:

```java
// increment i
 i++;
```

### 28.2 Javadoc

Public APIs should have Javadoc when:

1. The type is part of shared library/API.
2. The behavior has non-obvious invariants.
3. The method has important failure behavior.
4. The type is a domain concept.
5. Nullability/ownership/thread-safety must be clear.

Do not generate noisy Javadoc for obvious private methods.

### 28.3 TODOs

TODOs must be actionable.

Good:

```java
// TODO(ACEAS-1234): Remove fallback after all clients send decisionReason.
```

Bad:

```java
// TODO fix later
```

---

## 29. LLM implementation workflow

Before editing code, the agent **MUST** perform this reasoning workflow internally and reflect key points in the final implementation summary:

1. Identify target Java version and build configuration.
2. Identify relevant repository conventions.
3. Identify touched boundaries.
4. Identify behavior change vs refactor.
5. Identify invariants being preserved or added.
6. Identify failure modes.
7. Identify tests needed.
8. Identify security impact.
9. Identify concurrency/resource impact.
10. Identify whether Java 21 features are appropriate or overkill.

### 29.1 When adding code

The agent **MUST**:

1. Keep changes minimal.
2. Use existing abstractions.
3. Use explicit names.
4. Validate inputs.
5. Handle failure paths.
6. Add tests.
7. Avoid new dependencies unless justified.
8. Avoid preview/incubator Java 21 features.
9. Avoid unbounded concurrency.
10. Avoid unrelated formatting changes.

### 29.2 When modifying existing code

The agent **MUST**:

1. Preserve existing behavior unless change is required.
2. Preserve public contracts.
3. Preserve serialization shape.
4. Preserve transaction boundaries.
5. Preserve logging semantics where operationally relevant.
6. Preserve metrics/tracing.
7. Preserve idempotency and retry semantics.
8. Preserve security checks.
9. Preserve concurrency controls.
10. Preserve migration compatibility.

### 29.3 When using Java 21 features

The agent **MUST** ask this decision tree:

1. Does the repo target Java 21 with `--release 21`?
2. Is the feature stable in Java 21?
3. Does the feature reduce complexity, or just reduce lines?
4. Will maintainers understand it?
5. Does it affect API compatibility?
6. Does it affect serialization?
7. Does it interact with frameworks?
8. Does it introduce runtime behavior changes?
9. Is there a simpler Java 17-compatible alternative preferred by the project?
10. Are tests added for the new behavior?

If the answer is unclear, use simpler stable Java.

---

## 30. Java 21 feature decision matrix for agents

| Situation                            | Preferred choice                                    | Avoid                                     |
| ------------------------------------ | --------------------------------------------------- | ----------------------------------------- |
| Simple DTO/value tuple               | Record with validation                              | Mutable bean unless framework requires it |
| JPA entity                           | Normal class                                        | Record                                    |
| Closed domain alternatives           | Sealed interface + records/classes                  | Open inheritance with random `instanceof` |
| Mapping sealed alternatives to value | Pattern switch expression                           | `default` hiding missing subtype          |
| Complex behavior per subtype         | Polymorphism                                        | Giant pattern switch                      |
| Need first/last/reversed order API   | Sequenced collection                                | Assuming `HashMap`/`HashSet` order        |
| High-concurrency blocking I/O        | Virtual-thread-per-task + bounded resources         | Fixed pool of virtual threads             |
| CPU-bound parallel work              | Platform pool / fork-join / benchmarked parallelism | Virtual threads as “speed booster”        |
| Multiline SQL/JSON test data         | Text block + parameter binding                      | String concatenation with user input      |
| Optional result                      | `Optional<T>` return                                | `null` return                             |
| Mutable result needed                | `Collectors.toCollection(ArrayList::new)`           | `Stream.toList()` then mutate             |
| Cryptographic key agreement          | Reviewed JCA/KEM design                             | Homemade protocol                         |
| Context propagation                  | Explicit context parameter                          | Preview `ScopedValue` by default          |
| Task grouping/cancellation           | Stable executor pattern                             | Preview `StructuredTaskScope` by default  |
| String interpolation                 | Formatter/log placeholders/text blocks              | Preview string templates                  |

---

## 31. Migration rules: Java 17 to Java 21

When upgrading code from Java 17 to Java 21, the agent **MUST NOT** automatically rewrite code to new syntax.

Allowed migration improvements:

1. Replace safe `instanceof` chains with pattern switch only when it improves closed-type handling.
2. Use record patterns for stable value records where accessors made code noisy.
3. Use sequenced collections only where encounter order was already part of behavior.
4. Introduce virtual threads only after architecture/runtime approval.
5. Update compiler/toolchain to `--release 21`.
6. Update tests for runtime behavior changes.
7. Remove obsolete `--add-opens` only after verifying dependencies no longer need it.
8. Review dynamic agent warnings in tests and tooling.
9. Review dependencies for Java 21 compatibility.
10. Benchmark before changing GC or concurrency model.

Forbidden migration behavior:

1. Mass-converting classes to records.
2. Mass-converting `if/else` to pattern switch.
3. Replacing all executors with virtual threads.
4. Replacing all collection types with sequenced interfaces.
5. Adding preview features because they are “Java 21”.
6. Changing serialized DTO field names through record component renaming.
7. Changing transaction boundaries during syntax migration.
8. Changing exception behavior during syntax migration.
9. Changing API signatures for cosmetic reasons.
10. Reformatting entire repository without explicit request.

---

## 32. Framework-specific guardrails

### 32.1 Spring / Spring Boot

If the project uses Spring:

1. Follow existing dependency injection style.
2. Prefer constructor injection.
3. Do not use field injection in new code.
4. Keep transaction boundaries in service/application layer.
5. Do not call `@Transactional` methods through `this` expecting proxy behavior.
6. Do not put business logic in controllers.
7. Do not expose entities directly as API DTOs unless project already does so intentionally.
8. Validate request DTOs.
9. Handle exceptions through project exception mapping.
10. Use virtual threads only if the Spring Boot/runtime configuration explicitly supports and enables the chosen model.

### 32.2 JPA / Hibernate

1. Do not use records as entities.
2. Avoid lazy loading surprises in `toString`, `equals`, `hashCode`, logging, and JSON serialization.
3. Do not change fetch strategy casually.
4. Use pagination for unbounded queries.
5. Avoid N+1 queries.
6. Keep entity mutation methods explicit.
7. Preserve optimistic locking.
8. Avoid cascade deletes unless clearly required.
9. Do not use `LocalDateTime` for absolute timestamps.
10. Keep database constraints aligned with domain invariants.

### 32.3 Jackson

1. Keep serialized names stable.
2. Be careful with records because component names affect property names.
3. Avoid global default typing.
4. Validate polymorphic deserialization.
5. Do not deserialize untrusted data into broad types without validation.
6. Keep date/time formats explicit.
7. Use DTOs for external contracts.

### 32.4 Lombok

If Lombok is already used:

1. Follow project convention.
2. Avoid `@Data` on entities and domain models by default.
3. Be careful with generated `equals`/`hashCode`.
4. Do not combine Lombok with records unnecessarily.
5. Do not introduce Lombok into a non-Lombok project without approval.

### 32.5 Build tools

Do not change Maven/Gradle plugin versions casually.

When changing Java version:

1. Update compiler release.
2. Update toolchain.
3. Update CI image if needed.
4. Update test runtime.
5. Check annotation processors.
6. Check static analysis plugins.
7. Check code coverage agents and dynamic-agent warnings.
8. Check container base image.
9. Check deployment runtime.
10. Document migration notes.

---

## 33. Bad patterns forbidden for LLM-generated Java 21 code

The agent **MUST NOT** generate:

```java
catch (Exception ignored) {}
```

```java
return null;
```

```java
Thread.sleep(1000); // for synchronization in tests
```

```java
new Thread(() -> doWork()).start();
```

```java
Executors.newCachedThreadPool();
```

```java
Executors.newFixedThreadPool(100, Thread.ofVirtual().factory());
```

```java
parallelStream(); // without benchmark and thread-safety reasoning
```

```java
System.out.println("debug");
```

```java
ex.printStackTrace();
```

```java
String sql = "select * from table where id = " + id;
```

```java
STR."Hello \{name}"; // Java 21 preview string template, forbidden by default
```

```java
void main() { } // unnamed class / instance main preview style, forbidden by default
```

```java
ScopedValue.where(...); // preview in Java 21, forbidden by default
```

```java
new ObjectInputStream(inputStream).readObject(); // without filter and review
```

```java
Class.forName(classNameFromUserInput);
```

```java
private static final Map<String, Object> GLOBAL_STATE = new HashMap<>();
```

```java
record UserEntity(...) { } // JPA entity as record, forbidden by default
```

```java
case Object ignored -> ... // pattern switch dominance bug / meaningless catch-all
```

---

## 34. Reviewer checklist

A Java 21 change is acceptable only if the reviewer can answer “yes” to the relevant items.

### Compatibility

- [ ] Code compiles with `--release 21`.
- [ ] No Java >21 APIs/features are used.
- [ ] No Java 21 preview/incubator features are used unless explicitly approved.
- [ ] Build/test runtime is Java 21-compatible.
- [ ] Public API compatibility is preserved or intentionally changed.

### Correctness

- [ ] Inputs are validated at boundaries.
- [ ] Null behavior is explicit.
- [ ] Exceptions preserve cause and domain context.
- [ ] State transitions preserve invariants.
- [ ] Serialization shape is preserved or versioned.
- [ ] Timezone/clock behavior is explicit.

### Java 21 feature usage

- [ ] Records are used only for appropriate immutable data carriers.
- [ ] Record patterns improve clarity and are not overly nested.
- [ ] Pattern switch handles null/exhaustiveness intentionally.
- [ ] Sealed types represent genuinely closed hierarchies.
- [ ] Sequenced collections represent real encounter-order contracts.
- [ ] Virtual threads, if used, are justified by blocking I/O scalability and resource bounds.
- [ ] Preview/incubator features are absent unless explicitly approved.

### Security

- [ ] No secrets are hard-coded or logged.
- [ ] SQL/command/path injection risks are handled.
- [ ] Deserialization is avoided or filtered.
- [ ] Crypto uses approved APIs and design.
- [ ] Reflection/agent usage is justified.
- [ ] Sensitive data is masked in logs.

### Concurrency/resource management

- [ ] No unmanaged executors or threads.
- [ ] Timeouts and cancellation are defined.
- [ ] External resource concurrency is bounded.
- [ ] Shared mutable state is safe.
- [ ] Closeable resources are closed.
- [ ] No hidden unbounded queues/caches.

### Maintainability

- [ ] Names reveal domain intent.
- [ ] Methods are small and cohesive.
- [ ] No unrelated formatting/refactors.
- [ ] Tests cover changed behavior.
- [ ] Logs are useful and not noisy.
- [ ] Comments explain non-obvious decisions.

---

## 35. Prompt snippet for LLM code agents

Use this snippet when asking an LLM agent to implement Java 21 code:

```text
You are modifying a strict Java 21 codebase.

Follow strict-coding-standards__java21.md as a binding implementation contract.

Hard constraints:
- Compile with Java 21 using --release 21.
- Do not use Java >21 features.
- Do not use Java 21 preview/incubator features unless explicitly requested.
- Do not introduce dependencies, framework changes, concurrency model changes, public API changes, transaction changes, persistence schema changes, serialization changes, or broad refactors unless required.
- Prefer minimal, local, boring, testable changes.
- Follow existing repository conventions first.
- Preserve domain vocabulary.
- Validate boundary inputs.
- Preserve exception cause and failure behavior.
- Do not swallow exceptions.
- Do not return null unless existing API requires it.
- Do not log secrets or sensitive payloads.
- Use Java 21 stable features only when they improve clarity.
- Treat records, record patterns, pattern switch, sequenced collections, sealed types, and virtual threads as restricted tools, not default choices.
- Never pool virtual threads.
- Bound external resources even when using virtual threads.
- Add or update tests for behavior changes.

Before finalizing, summarize:
1. Files changed.
2. Behavior changed.
3. Java 21 features used and why.
4. Tests added/updated.
5. Risks, assumptions, and compatibility notes.
```

---

## 36. Source references for this standard

This document is intentionally based on stable Java 21 / Java SE 21 behavior and conservative production engineering practice.

Primary references:

1. Oracle JDK 21 Documentation — https://docs.oracle.com/en/java/javase/21/
2. Oracle JDK 21 API Documentation — https://docs.oracle.com/en/java/javase/21/docs/api/
3. Oracle JDK 21 Release Notes — https://www.oracle.com/java/technologies/javase/21-relnote-issues.html
4. Oracle Significant Changes in JDK 21 — https://docs.oracle.com/en/java/javase/21/migrate/significant-changes-jdk-release.html
5. OpenJDK JEPs in JDK 21 since JDK 17 — https://openjdk.org/projects/jdk/21/jeps-since-jdk-17
6. JEP 431: Sequenced Collections — https://openjdk.org/jeps/431
7. JEP 439: Generational ZGC — https://openjdk.org/jeps/439
8. JEP 440: Record Patterns — https://openjdk.org/jeps/440
9. JEP 441: Pattern Matching for switch — https://openjdk.org/jeps/441
10. JEP 444: Virtual Threads — https://openjdk.org/jeps/444
11. JEP 451: Prepare to Disallow the Dynamic Loading of Agents — https://openjdk.org/jeps/451
12. JEP 452: Key Encapsulation Mechanism API — https://openjdk.org/jeps/452
13. JEP 430: String Templates (Preview) — https://openjdk.org/jeps/430
14. JEP 442: Foreign Function & Memory API (Third Preview) — https://openjdk.org/jeps/442
15. JEP 443: Unnamed Patterns and Variables (Preview) — https://openjdk.org/jeps/443
16. JEP 445: Unnamed Classes and Instance Main Methods (Preview) — https://openjdk.org/jeps/445
17. JEP 446: Scoped Values (Preview) — https://openjdk.org/jeps/446
18. JEP 448: Vector API (Sixth Incubator) — https://openjdk.org/jeps/448
19. JEP 453: Structured Concurrency (Preview) — https://openjdk.org/jeps/453
20. Oracle Secure Coding Guidelines for Java SE — https://www.oracle.com/java/technologies/javase/seccodeguide.html
21. Google Java Style Guide — https://google.github.io/styleguide/javaguide.html
22. Oracle Code Conventions for the Java Programming Language — https://www.oracle.com/java/technologies/javase/codeconventions-contents.html

---

## 37. Final rule

When in doubt, the agent **MUST** choose the code that is:

1. Java 21 stable.
2. Compatible with the repository.
3. Explicit about failure.
4. Easy to review.
5. Easy to test.
6. Safe by default.
7. Boring enough to maintain.

Modern syntax is useful only when it makes the model clearer. If it only makes the code shorter, that is not enough.
