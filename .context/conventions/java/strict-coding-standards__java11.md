# Strict Coding Standards — Java 11

> **Target runtime:** Java 11 / Java SE 11  
> **Audience:** LLM code agents, human reviewers, maintainers  
> **Purpose:** make generated Java 11 code predictable, reviewable, secure, maintainable, and compatible with a strict Java 11 baseline.

---

## 0. Non-negotiable operating rule for LLM agents

When implementing Java code, the agent **MUST** treat this document as an implementation contract, not as optional advice.

The agent **MUST**:

1. Preserve Java 11 compatibility.
2. Follow existing repository style when it is stricter than this document.
3. Prefer minimal, local, explainable changes over broad rewrites.
4. Avoid speculative refactors unless explicitly requested.
5. Never introduce dependencies, frameworks, runtime assumptions, public API changes, or behavioral changes without clear justification.
6. Produce code that compiles, is testable, and has explicit failure behavior.
7. Avoid placeholders, fake implementations, dead code, hidden TODOs, and incomplete paths.
8. State assumptions when the surrounding codebase does not provide enough evidence.

The agent **MUST NOT**:

1. Use Java features introduced after Java 11.
2. Generate code that only works on Java 17, 21, or newer.
3. Hide complexity behind vague helper methods.
4. Swallow exceptions.
5. Return `null` where an empty value, exception, or explicit optional result is required.
6. Add concurrency, caching, async behavior, reflection, serialization, or global state unless the requirement truly needs it.
7. Change formatting or unrelated code just because it was nearby.
8. Create “enterprise ceremony” without a real invariant, boundary, or dependency need.

---

## 1. Java 11 compatibility contract

### 1.1 Build level

All Java source code **MUST** compile with Java 11.

Recommended compiler configuration:

```bash
javac --release 11
```

Maven:

```xml
<properties>
    <maven.compiler.release>11</maven.compiler.release>
</properties>
```

Gradle:

```groovy
java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(11)
    }
}

tasks.withType(JavaCompile).configureEach {
    options.release = 11
}
```

The agent **MUST NOT** rely only on `sourceCompatibility = 11` and `targetCompatibility = 11` when `--release 11` is available, because `--release` prevents accidental use of newer JDK APIs during compilation.

### 1.2 Java 11 allowed feature surface

The following Java 11-compatible features and APIs are allowed when they improve clarity:

| Feature/API                                  | Java version | Allowed?   | Rule                                                               |
| -------------------------------------------- | -----------: | ---------- | ------------------------------------------------------------------ |
| Lambdas and streams                          |            8 | Yes        | Use for simple transformations, not complex side-effect workflows. |
| `Optional`                                   |            8 | Yes        | Use mainly as return type for possibly absent values.              |
| `java.time`                                  |            8 | Yes        | Mandatory for new date/time code.                                  |
| `CompletableFuture`                          |            8 | Yes        | Use only with explicit executor policy and error handling.         |
| `Path`, `Files`, NIO.2                       |       7/8/11 | Yes        | Preferred over legacy `File` APIs for new code.                    |
| `List.of`, `Set.of`, `Map.of`                |            9 | Yes        | Use for small immutable constants.                                 |
| `List.copyOf`, `Set.copyOf`, `Map.copyOf`    |           10 | Yes        | Use for defensive immutable copies.                                |
| Local variable `var`                         |           10 | Restricted | Allowed only when the type is obvious and readability improves.    |
| `var` in lambda parameters                   |           11 | Restricted | Allowed only when annotations are needed or consistency improves.  |
| `String.isBlank`, `strip`, `lines`, `repeat` |           11 | Yes        | Prefer over ad-hoc string utilities when appropriate.              |
| `Files.readString`, `Files.writeString`      |           11 | Yes        | Allowed for bounded/small text content only.                       |
| `Collection.toArray(IntFunction)`            |           11 | Yes        | Prefer `collection.toArray(Type[]::new)`.                          |
| `Optional.isEmpty`                           |           11 | Yes        | Allowed.                                                           |
| `Predicate.not`                              |           11 | Yes        | Allowed when it improves readability.                              |
| `java.net.http.HttpClient`                   |           11 | Yes        | Preferred standard HTTP client when no project client exists.      |

### 1.3 Forbidden Java >11 features

The agent **MUST NOT** use these in Java 11 code:

| Forbidden feature/API                    | Introduced after Java 11 | Replacement in Java 11                                                         |
| ---------------------------------------- | -----------------------: | ------------------------------------------------------------------------------ |
| Records                                  |    14 preview / 16 final | Final class with final fields, constructor, getters, equals/hashCode/toString. |
| Sealed classes                           |    15 preview / 17 final | Package-private constructors, interfaces, enums, validation.                   |
| Pattern matching for `instanceof`        |    14 preview / 16 final | Traditional `instanceof` followed by cast.                                     |
| Switch expressions / arrow switch labels |    12 preview / 14 final | Traditional `switch` statement.                                                |
| Text blocks                              |    13 preview / 15 final | Normal string concatenation or resource files.                                 |
| `Stream.toList()`                        |                       16 | `collect(Collectors.toList())` or `collect(Collectors.toUnmodifiableList())`.  |
| `List.getFirst`, `List.getLast`          |                       21 | Index access with explicit empty checks.                                       |
| Virtual threads                          |    19 preview / 21 final | Bounded `ExecutorService`.                                                     |
| Structured concurrency                   |    19+ incubator/preview | Explicit executor and lifecycle handling.                                      |
| Sequenced collections                    |                       21 | Existing `List`, `Deque`, `LinkedHashMap` APIs.                                |
| Pattern matching switch                  |  17+ preview/final later | Traditional `if/else` or visitor.                                              |
| String templates                         |               21 preview | `String.format`, `MessageFormat`, or concatenation.                            |
| Foreign memory/function APIs             |  19+ preview/final later | Standard Java 11 APIs or JNI only with explicit approval.                      |

### 1.4 Removed or externalized Java 11 modules/features

The agent **MUST NOT** assume these are bundled in JDK 11:

1. Java EE and CORBA modules removed from the JDK.
2. JavaFX removed from the JDK distribution.
3. Applets and Web Start deployment stack removed.
4. Standalone JRE distribution no longer offered in the same way as earlier releases; Java 11 is JDK-oriented.
5. Nashorn JavaScript engine is deprecated in Java 11 and must not be used for new implementation.
6. Pack200 tools/API are deprecated in Java 11 and must not be used for new implementation.

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

If the repository convention conflicts with this document:

1. Existing repository convention wins for local consistency.
2. Java 11 compatibility always wins over repository inconsistency.
3. Security and correctness rules in this document win unless the project has a stricter equivalent.
4. The agent must mention the conflict in its implementation summary.

---

## 3. Source file structure

### 3.1 File name

A source file containing a top-level public class **MUST** be named exactly after that class:

```text
OrderService.java
```

One public top-level type per file.

### 3.2 Ordering

Use this source file order:

1. License header, if the project uses one.
2. `package` declaration.
3. Imports.
4. Top-level type Javadoc, if the type is public API or non-obvious.
5. Class/interface/enum declaration.
6. Static constants.
7. Static fields.
8. Instance fields.
9. Constructors.
10. Static factory methods.
11. Public methods.
12. Package-private methods.
13. Protected methods.
14. Private methods.
15. Nested types.

### 3.3 Imports

The agent **MUST**:

1. Use explicit imports.
2. Remove unused imports.
3. Avoid wildcard imports.
4. Avoid static imports except for well-known test assertions or constants already used by the project.
5. Avoid importing classes with ambiguous names unless the code remains clear.

Bad:

```java
import java.util.*;
import static com.example.Status.*;
```

Good:

```java
import java.util.List;
import java.util.Map;
import java.util.Optional;
```

---

## 4. Formatting

### 4.1 Formatter precedence

The agent **MUST** follow the repository formatter if present:

1. `.editorconfig`
2. `spotless`
3. `google-java-format`
4. Checkstyle formatter rules
5. IDE formatter XML
6. Existing nearby code style
7. This document fallback

### 4.2 Fallback formatting

When no repository formatter exists:

1. Use 4 spaces for indentation.
2. No tabs.
3. Maximum line length: 100 characters.
4. Hard maximum line length: 120 characters, only for unavoidable cases such as URLs or long test names.
5. Opening brace on the same line.
6. Always use braces for control flow.
7. One statement per line.
8. No trailing whitespace.
9. End every file with a newline.
10. Do not align columns manually with excessive spaces.

Good:

```java
if (order.isExpired()) {
    order.cancel(clock.instant());
}
```

Bad:

```java
if (order.isExpired()) order.cancel(clock.instant());
```

### 4.3 Line wrapping

Break method chains by semantic step:

```java
List<Order> activeOrders = orders.stream()
        .filter(Order::isActive)
        .sorted(comparing(Order::createdAt))
        .collect(toList());
```

Do not create unreadable vertical code for short expressions.

---

## 5. Naming standards

### 5.1 Package names

Package names **MUST** be lowercase ASCII.

Good:

```java
com.company.enforcement.casefile
```

Bad:

```java
com.company.Enforcement.CaseFile
```

### 5.2 Type names

Use `UpperCamelCase`.

| Type       | Example                          |
| ---------- | -------------------------------- |
| Class      | `CaseAssignmentService`          |
| Interface  | `CaseRepository`                 |
| Enum       | `CaseStatus`                     |
| Annotation | `Audited`                        |
| Exception  | `InvalidCaseTransitionException` |

Avoid generic names:

Bad:

```java
Manager
Processor
Helper
Util
Data
Info
CommonService
```

Good:

```java
CaseEscalationPolicy
CandidateSubmissionValidator
EmailDispatchResult
```

### 5.3 Method names

Use `lowerCamelCase` and verb-oriented names.

Good:

```java
submitCandidate()
calculatePenalty()
findActiveCasesByOfficer()
```

Bad:

```java
candidateSubmit()
doProcess()
handle()
execute()
```

Generic names like `process`, `handle`, `execute`, and `manage` are only allowed at framework boundaries where the abstraction already defines that vocabulary.

### 5.4 Variable names

Variable names **MUST** describe role, not type.

Bad:

```java
String str;
List<Order> list;
Map<String, User> map;
```

Good:

```java
String applicantName;
List<Order> pendingOrders;
Map<String, User> usersByEmail;
```

### 5.5 Constants

Use `UPPER_SNAKE_CASE` for true constants.

```java
private static final int MAX_RETRY_ATTEMPTS = 3;
private static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(10);
```

Do not use constant naming for mutable static fields.

### 5.6 Generic type parameters

Use common generic names only when conventional:

| Name | Meaning         |
| ---- | --------------- |
| `T`  | Generic type    |
| `E`  | Element         |
| `K`  | Key             |
| `V`  | Value           |
| `R`  | Result          |
| `ID` | Identifier type |

Use descriptive generic names for domain-heavy abstractions:

```java
interface StateTransition<S, E> {
    S apply(S state, E event);
}
```

---

## 6. Type design

### 6.1 Prefer small, cohesive types

A class **MUST** have one primary reason to change.

The agent **MUST NOT** create a class that mixes:

1. Validation.
2. Persistence.
3. Network calls.
4. Mapping.
5. State transition logic.
6. Logging orchestration.
7. Time generation.
8. Authorization.

Split when responsibilities have different invariants or different failure modes.

### 6.2 Encapsulation

Fields **MUST** be private unless there is a strong framework requirement.

Prefer:

```java
public final class CaseAssignment {
    private final CaseId caseId;
    private final OfficerId officerId;

    public CaseAssignment(CaseId caseId, OfficerId officerId) {
        this.caseId = Objects.requireNonNull(caseId, "caseId");
        this.officerId = Objects.requireNonNull(officerId, "officerId");
    }
}
```

Avoid public mutable fields.

### 6.3 Immutability

Default to immutable domain/value objects.

The agent **MUST**:

1. Make fields `final` when possible.
2. Validate constructor arguments.
3. Use defensive copies for mutable inputs.
4. Avoid exposing mutable internals.
5. Prefer creating new values over mutating existing state when modelling domain transitions.

Good:

```java
public final class SearchResult {
    private final List<String> matchedIds;

    public SearchResult(List<String> matchedIds) {
        this.matchedIds = List.copyOf(Objects.requireNonNull(matchedIds, "matchedIds"));
    }

    public List<String> matchedIds() {
        return matchedIds;
    }
}
```

### 6.4 Mutability must be intentional

Mutable classes **MUST** document their mutation rules.

A mutable class must answer:

1. Who owns the mutation?
2. Is it thread-safe?
3. Are there lifecycle states?
4. What operations are illegal in each state?
5. What happens on failure halfway through mutation?

### 6.5 Interfaces

Create an interface only when there is a real boundary:

1. Multiple implementations exist or are expected.
2. External dependency needs isolation.
3. Testing requires a seam.
4. Architecture requires a port.

Do not create `FooService` + `FooServiceImpl` automatically.

Bad:

```java
public interface UserService {}
public class UserServiceImpl implements UserService {}
```

Good:

```java
public interface ExchangeRateProvider {
    ExchangeRate getRate(Currency source, Currency target);
}
```

### 6.6 Inheritance

Prefer composition over inheritance.

The agent **MUST NOT** use inheritance to share utility code.

Inheritance is allowed only when:

1. There is a true subtype relationship.
2. The superclass is designed for extension.
3. Overridable methods are documented.
4. Constructor behavior is safe.

---

## 7. Method design

### 7.1 Method size

A method should normally fit in one screen.

A method **MUST** be split when it mixes:

1. Input validation.
2. Data fetching.
3. Business decision.
4. State mutation.
5. Output mapping.
6. Error translation.

Do not split only to hide complexity. Split by responsibility and name the responsibility accurately.

### 7.2 Parameter count

Prefer 0–4 parameters.

If a method needs many parameters, introduce a parameter object only if it has a real semantic meaning.

Bad:

```java
createUser(name, email, phone, address, role, status, createdBy, createdAt);
```

Good:

```java
createUser(CreateUserCommand command);
```

### 7.3 Return values

A method **MUST** return one of:

1. A valid value.
2. An empty collection.
3. `Optional<T>` for absence.
4. A typed result object.
5. An exception for invalid or failed operation.

A method **MUST NOT** return `null` unless overriding legacy APIs that require it.

### 7.4 Side effects

Method names must reveal side effects.

| Name pattern   | Expected meaning                                               |
| -------------- | -------------------------------------------------------------- |
| `find...`      | Query, no mutation.                                            |
| `get...`       | Cheap retrieval or property access.                            |
| `load...`      | May access external resource.                                  |
| `create...`    | Creates a new value/resource.                                  |
| `update...`    | Mutates existing state.                                        |
| `delete...`    | Removes state.                                                 |
| `calculate...` | Pure computation.                                              |
| `validate...`  | Throws or returns validation result.                           |
| `try...`       | Failure represented as boolean/optional/result, not exception. |

Do not use `get...` for expensive network/database operations unless it is already established repository vocabulary.

---

## 8. Null handling

### 8.1 Null policy

Null is not a domain model.

The agent **MUST**:

1. Validate required parameters with `Objects.requireNonNull`.
2. Return empty collections instead of `null` collections.
3. Return `Optional<T>` only for legitimate absence.
4. Avoid passing `null` as a control signal.
5. Avoid storing `null` in collections.
6. Avoid accepting nullable parameters unless the API explicitly documents it.

Good:

```java
public UserProfile loadProfile(UserId userId) {
    this.userId = Objects.requireNonNull(userId, "userId");
}
```

### 8.2 Optional rules

`Optional<T>` is allowed mainly as a return type.

The agent **MUST NOT**:

1. Use `Optional` fields.
2. Use `Optional` parameters.
3. Use `Optional` in serialized DTOs.
4. Call `optional.get()` without a prior presence check in the same logical block.
5. Use `Optional` to hide errors.

Good:

```java
return userRepository.findByEmail(email)
        .orElseThrow(() -> new UserNotFoundException(email));
```

Bad:

```java
return userRepository.findByEmail(email).get();
```

Use `Optional.isEmpty()` when it is clearer in Java 11.

---

## 9. Exceptions and error handling

### 9.1 Exception principles

The agent **MUST**:

1. Fail fast for invalid inputs.
2. Preserve original causes when wrapping exceptions.
3. Add useful context to exceptions.
4. Avoid leaking secrets, tokens, passwords, PII, or raw payloads in exception messages.
5. Catch exceptions only when the current layer can add value.
6. Never swallow exceptions silently.
7. Never use exceptions for normal loop/control flow.

Bad:

```java
try {
    sendEmail(message);
} catch (Exception ignored) {
}
```

Good:

```java
try {
    sendEmail(message);
} catch (MessagingException ex) {
    throw new EmailDispatchException("Failed to dispatch email for case " + caseId, ex);
}
```

### 9.2 Checked vs unchecked exceptions

Use checked exceptions for recoverable boundary failures when callers are expected to handle them.

Use unchecked exceptions for:

1. Programming errors.
2. Invalid domain state.
3. Violated preconditions.
4. Non-recoverable application errors.

Do not wrap every checked exception into `RuntimeException` blindly.

### 9.3 Boundary translation

Translate exceptions at architectural boundaries:

| Boundary         | Translation example                                     |
| ---------------- | ------------------------------------------------------- |
| HTTP controller  | Domain/application error → HTTP response.               |
| Message consumer | Processing error → retry/dead-letter policy.            |
| Repository       | SQL/client error → persistence exception.               |
| External client  | Timeout/HTTP error → integration exception.             |
| Batch job        | Item error → item failure result or job failure policy. |

### 9.4 InterruptedException

The agent **MUST** preserve interrupt status when catching `InterruptedException`.

Good:

```java
try {
    latch.await(timeout.toMillis(), TimeUnit.MILLISECONDS);
} catch (InterruptedException ex) {
    Thread.currentThread().interrupt();
    throw new OperationInterruptedException("Interrupted while waiting for completion", ex);
}
```

Bad:

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException ignored) {
}
```

---

## 10. Collections

### 10.1 Declaration type

Use interface types for variables, fields, parameters, and return values unless implementation behavior is required.

Good:

```java
private final List<CaseId> caseIds;
private final Map<CaseId, CaseStatus> statusByCaseId;
```

Bad:

```java
private final ArrayList<CaseId> caseIds;
private final HashMap<CaseId, CaseStatus> statusByCaseId;
```

### 10.2 Empty collections

Return empty collections, not `null`.

```java
return Collections.emptyList();
```

or:

```java
return List.of();
```

### 10.3 Immutable collections

Use immutable collections for constants and defensive copies.

```java
private static final Set<String> SUPPORTED_TYPES = Set.of("PDF", "DOCX");
```

```java
this.items = List.copyOf(items);
```

Remember: `List.of`, `Set.of`, `Map.of`, and `copyOf` reject `null` elements.

### 10.4 Arrays

Prefer collections over arrays unless:

1. Interacting with existing APIs.
2. Performance requires arrays and is measured.
3. Primitive arrays are needed for memory efficiency.

For Java 11 collection-to-array conversion, prefer:

```java
String[] names = namesList.toArray(String[]::new);
```

### 10.5 Map usage

The agent **MUST**:

1. Name maps by key relationship, e.g. `usersById`.
2. Avoid nested maps unless the domain truly requires it.
3. Avoid mutating maps from multiple threads without concurrency control.
4. Avoid using untrusted user input as hash keys in security-sensitive or high-volume endpoints without limits and validation.

---

## 11. Strings, charsets, and Unicode

### 11.1 Charset policy

The agent **MUST NOT** rely on the platform default charset.

Always specify charset explicitly:

```java
Files.readString(path, StandardCharsets.UTF_8);
Files.writeString(path, content, StandardCharsets.UTF_8);
```

Bad:

```java
new String(bytes);
content.getBytes();
```

Good:

```java
new String(bytes, StandardCharsets.UTF_8);
content.getBytes(StandardCharsets.UTF_8);
```

### 11.2 Locale-sensitive operations

For non-user-facing technical normalization, use `Locale.ROOT`.

Good:

```java
String normalized = input.toLowerCase(Locale.ROOT);
```

Bad:

```java
String normalized = input.toLowerCase();
```

Use user locale only for user-facing formatting/parsing.

### 11.3 Unicode correctness

The agent **MUST NOT** assume one Java `char` equals one user-perceived character.

Use code points when processing arbitrary Unicode text:

```java
long letters = text.codePoints()
        .filter(Character::isLetter)
        .count();
```

Avoid direct `charAt` loops for Unicode-sensitive logic unless the input is explicitly ASCII or UTF-16 code-unit processing is intended.

### 11.4 String concatenation

Use normal concatenation for simple cases.

Use `StringBuilder` for repeated concatenation in loops.

Good:

```java
StringBuilder builder = new StringBuilder();
for (String line : lines) {
    builder.append(line).append('\n');
}
```

Bad:

```java
String output = "";
for (String line : lines) {
    output += line + "\n";
}
```

### 11.5 Blank checks

In Java 11, prefer `isBlank()` for whitespace-aware blank checks.

```java
if (name == null || name.isBlank()) {
    throw new IllegalArgumentException("name must not be blank");
}
```

Use `strip()` instead of `trim()` when Unicode whitespace semantics are desired.

---

## 12. Date and time

### 12.1 Mandatory API

New code **MUST** use `java.time`.

Forbidden for new domain logic:

1. `java.util.Date`
2. `java.util.Calendar`
3. `java.sql.Date` outside JDBC boundaries
4. `SimpleDateFormat`

### 12.2 Type selection

| Need                            | Type                                                   |
| ------------------------------- | ------------------------------------------------------ |
| Machine timestamp               | `Instant`                                              |
| Date without time               | `LocalDate`                                            |
| Time without date               | `LocalTime`                                            |
| Date-time without zone          | `LocalDateTime` only when zone is irrelevant by design |
| Date-time with offset           | `OffsetDateTime`                                       |
| Date-time with region time zone | `ZonedDateTime`                                        |
| Duration between instants       | `Duration`                                             |
| Calendar amount                 | `Period`                                               |

### 12.3 Clock injection

Time-dependent code **MUST** use `Clock` injection when testability matters.

Good:

```java
public final class TokenExpiryPolicy {
    private final Clock clock;

    public TokenExpiryPolicy(Clock clock) {
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    public boolean isExpired(Instant expiresAt) {
        return !Instant.now(clock).isBefore(expiresAt);
    }
}
```

Bad:

```java
return Instant.now().isAfter(expiresAt);
```

### 12.4 Time zone policy

The agent **MUST** make time zone decisions explicit.

1. Store timestamps as `Instant` unless the domain requires local time.
2. Use `ZoneId` for user/business time zone rules.
3. Never assume server default time zone.
4. Never parse/format dates without an explicit formatter at boundaries.

---

## 13. Numeric values and money

### 13.1 Money

Money **MUST NOT** use `float` or `double`.

Use `BigDecimal` with explicit scale and rounding.

Good:

```java
BigDecimal total = amount.setScale(2, RoundingMode.HALF_UP);
```

Bad:

```java
double total = price * quantity;
```

### 13.2 Integer overflow

For size, limit, offset, and resource calculations, the agent **MUST** consider overflow.

Use `Math.addExact`, `Math.multiplyExact`, or safe rearranged checks where overflow matters.

Good:

```java
if (additionalBytes < 0 || currentBytes > maxBytes - additionalBytes) {
    throw new IllegalArgumentException("size limit exceeded");
}
```

### 13.3 BigDecimal equality

Do not use `BigDecimal.equals` for numeric equality unless scale equality is required.

```java
if (amount.compareTo(BigDecimal.ZERO) > 0) {
    // positive
}
```

---

## 14. Streams and lambdas

### 14.1 When to use streams

Use streams for:

1. Mapping.
2. Filtering.
3. Grouping.
4. Aggregating.
5. Simple collection transformations.

Prefer loops for:

1. Complex branching.
2. Multiple side effects.
3. Early exits with complex conditions.
4. Exception-heavy logic.
5. Stateful transformations.
6. Debuggability-sensitive code.

### 14.2 Stream side effects

The agent **MUST NOT** use streams with hidden side effects.

Bad:

```java
orders.stream()
        .filter(Order::isExpired)
        .forEach(order -> repository.save(order.cancel()));
```

Better:

```java
for (Order order : orders) {
    if (order.isExpired()) {
        repository.save(order.cancel());
    }
}
```

### 14.3 `peek`

`peek` **MUST NOT** be used for business logic.

Allowed only for temporary debugging, and temporary debugging must not be committed.

### 14.4 Parallel streams

The agent **MUST NOT** use `parallelStream()` by default.

Parallel streams are allowed only when:

1. The workload is CPU-bound.
2. The data size justifies parallelism.
3. Operations are stateless and thread-safe.
4. The common ForkJoinPool impact is acceptable.
5. Performance has been measured.

### 14.5 Lambda parameter `var`

Java 11 allows `var` in implicitly typed lambda parameters.

Use it only when:

1. A parameter annotation is required.
2. All lambda parameters use `var` consistently.
3. The inferred type remains obvious.

Good:

```java
BiFunction<String, String, String> merge = (@Nonnull var left, @Nonnull var right) -> left + right;
```

Bad:

```java
(var left, right) -> left + right
```

Bad:

```java
(var left, String right) -> left + right
```

---

## 15. `var` usage

### 15.1 Allowed

`var` is allowed for local variables when the type is obvious from the right-hand side.

Good:

```java
var request = new CreateCaseRequest(caseId, officerId);
var names = List.of("alice", "bob");
```

### 15.2 Forbidden

Do not use `var` when it hides important type information.

Bad:

```java
var result = client.send(request, handler);
var value = repository.find(id);
var data = mapper.map(input);
```

Better:

```java
HttpResponse<String> response = client.send(request, BodyHandlers.ofString());
Optional<User> user = repository.find(id);
CaseSummary summary = mapper.map(input);
```

### 15.3 Never use `var` for fields or method parameters

Java 11 does not allow `var` for fields or normal method parameters.

Bad:

```java
private var name;
public void update(var command) {}
```

---

## 16. Concurrency

### 16.1 Default stance

Concurrency is a correctness feature before it is a performance feature.

The agent **MUST NOT** introduce concurrency unless there is a clear requirement or existing architecture pattern.

### 16.2 Thread creation

Avoid raw thread creation.

Bad:

```java
new Thread(task).start();
```

Good:

```java
ExecutorService executor = Executors.newFixedThreadPool(threadCount);
```

In application code, executor lifecycle should usually be managed by the application/framework, not by random business classes.

### 16.3 Executor rules

Any executor introduced by the agent **MUST** define:

1. Thread count.
2. Queue policy.
3. Rejection policy.
4. Shutdown lifecycle.
5. Error handling.
6. Naming strategy, if the project supports it.

Avoid unbounded queues for high-volume workloads.

### 16.4 Shared mutable state

The agent **MUST** avoid shared mutable state.

If shared state is unavoidable:

1. Use immutable values where possible.
2. Use `Atomic*` types for simple atomic counters/references.
3. Use concurrent collections intentionally.
4. Use locks with `try/finally`.
5. Document thread-safety guarantees.

### 16.5 Locking

Good:

```java
lock.lock();
try {
    updateState(command);
} finally {
    lock.unlock();
}
```

Bad:

```java
lock.lock();
updateState(command);
lock.unlock();
```

### 16.6 CompletableFuture

`CompletableFuture` usage **MUST** include:

1. Explicit executor for async work unless intentionally using the common pool.
2. Timeout strategy where applicable.
3. Error handling.
4. Cancellation behavior when relevant.
5. No blocking `join()` inside request threads unless justified.

Bad:

```java
return CompletableFuture.supplyAsync(() -> client.call());
```

Better:

```java
return CompletableFuture.supplyAsync(() -> client.call(), executor)
        .orTimeout(5, TimeUnit.SECONDS)
        .exceptionally(ex -> fallback.handle(ex));
```

### 16.7 Thread.sleep

The agent **MUST NOT** use `Thread.sleep` for coordination.

Use:

1. `CountDownLatch`
2. `Semaphore`
3. `CompletableFuture`
4. `ScheduledExecutorService`
5. Awaitility or equivalent in tests, if already present

---

## 17. I/O and resources

### 17.1 Resource management

The agent **MUST** use try-with-resources for closeable resources.

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

### 17.2 File APIs

Prefer `Path` and `Files` over `File` for new code.

Good:

```java
Path reportPath = outputDirectory.resolve(fileName).normalize();
```

### 17.3 Large files

The agent **MUST NOT** load large or unbounded files fully into memory.

Bad:

```java
String content = Files.readString(path, StandardCharsets.UTF_8);
```

Allowed only for known-small files.

For large files, use streaming:

```java
try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    String line;
    while ((line = reader.readLine()) != null) {
        process(line);
    }
}
```

### 17.4 Path traversal

When handling user-provided paths, normalize and verify the path remains inside the allowed base directory.

```java
Path target = baseDirectory.resolve(userInput).normalize();
if (!target.startsWith(baseDirectory)) {
    throw new SecurityException("path escapes base directory");
}
```

### 17.5 Temporary files

Use `Files.createTempFile` or `Files.createTempDirectory`.

Do not invent predictable temp file names.

---

## 18. HTTP client — Java 11 standard API

### 18.1 Preferred client

When the project has no established HTTP client, use Java 11 `java.net.http.HttpClient`.

### 18.2 Required configuration

The agent **MUST** configure:

1. Connection timeout.
2. Request timeout.
3. Redirect policy, if relevant.
4. HTTP version, if relevant.
5. Body handler with bounded memory behavior.
6. Error handling for non-2xx status codes.

Good:

```java
HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .version(HttpClient.Version.HTTP_2)
        .build();

HttpRequest request = HttpRequest.newBuilder(uri)
        .timeout(Duration.ofSeconds(10))
        .GET()
        .build();

HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
if (response.statusCode() < 200 || response.statusCode() >= 300) {
    throw new ExternalServiceException("Unexpected response status: " + response.statusCode());
}
```

### 18.3 Client lifecycle

Do not create a new `HttpClient` per request unless there is a specific reason.

Prefer reusing a configured client.

### 18.4 Async HTTP

When using `sendAsync`, handle completion and error paths explicitly.

```java
return client.sendAsync(request, HttpResponse.BodyHandlers.ofString())
        .thenApply(this::requireSuccess)
        .thenApply(HttpResponse::body);
```

---

## 19. Security standards

### 19.1 Trust boundaries

Any data crossing a trust boundary **MUST** be validated before use.

Trust boundaries include:

1. HTTP requests.
2. Message queues.
3. Files.
4. Databases when content originated externally.
5. Environment variables.
6. Configuration files.
7. External service responses.
8. User-controlled identifiers.

### 19.2 Secrets

The agent **MUST NOT**:

1. Hardcode secrets.
2. Log secrets.
3. Include tokens in exception messages.
4. Commit generated credentials.
5. Use dummy secrets that look real.

### 19.3 Input validation

Validate:

1. Required fields.
2. Length.
3. Range.
4. Format.
5. Allowed values.
6. Cross-field consistency.
7. Resource size limits.

Validation must happen at the boundary and again at domain construction when domain invariants require it.

### 19.4 Deserialization

The agent **MUST NOT** use Java native deserialization on untrusted data.

Avoid:

```java
ObjectInputStream
XMLDecoder
```

If legacy code uses deserialization, add filtering, allowlists, and explicit review.

### 19.5 XML parsing

When parsing XML from untrusted sources, secure processing must be enabled and external entity resolution must be disabled according to the XML library in use.

### 19.6 Regex

The agent **MUST** avoid vulnerable regex patterns that can cause catastrophic backtracking on untrusted input.

For complex validation, prefer:

1. Simpler regex.
2. Length limits before regex.
3. Parser-based validation.
4. Precompiled `Pattern` constants.

### 19.7 Cryptography

The agent **MUST NOT** invent cryptographic algorithms.

Use standard Java Cryptography Architecture APIs or established project crypto utilities.

Rules:

1. Never use MD5 or SHA-1 for security-sensitive hashing.
2. Never use ECB mode.
3. Use secure random generation for security tokens.
4. Do not store passwords directly; use approved password hashing through project/security framework.
5. Make algorithm, mode, padding, key size, and IV/nonce handling explicit.

### 19.8 Least privilege

Code should expose the narrowest API required.

1. Prefer package-private over public when possible.
2. Prefer immutable return values.
3. Avoid reflective access.
4. Avoid `setAccessible(true)` unless legacy integration requires it and review approves it.

---

## 20. Logging

### 20.1 Logging framework

Use the repository’s logging framework.

If none exists, prefer the framework already standard in the application runtime. Do not introduce a new logging dependency without approval.

### 20.2 Forbidden logging

The agent **MUST NOT** use:

```java
System.out.println(...)
System.err.println(...)
exception.printStackTrace()
```

except in tiny CLI/sample code where the repository convention explicitly uses console output.

### 20.3 Log content

Logs should include:

1. Operation.
2. Stable identifier.
3. Outcome.
4. Duration where useful.
5. Error category.

Logs must not include:

1. Passwords.
2. Tokens.
3. Secrets.
4. Full PII payloads.
5. Raw request/response bodies unless explicitly sanitized.

### 20.4 Log levels

| Level | Usage                                                         |
| ----- | ------------------------------------------------------------- |
| ERROR | Operation failed and requires attention or retry/dead-letter. |
| WARN  | Unexpected but recoverable condition.                         |
| INFO  | Important lifecycle/business event.                           |
| DEBUG | Diagnostic details disabled in production by default.         |
| TRACE | Extremely detailed diagnostics.                               |

Do not log and rethrow at every layer. Log once at the boundary that owns the failure policy.

---

## 21. Testing standards

### 21.1 Test requirement

Any behavior change **MUST** include tests unless impossible due to legacy constraints.

The agent **MUST** add or update tests for:

1. Happy path.
2. Boundary values.
3. Invalid input.
4. Error propagation.
5. Null handling where relevant.
6. Time zone/date behavior.
7. Charset/Unicode behavior where relevant.
8. Concurrency behavior where relevant.
9. Regression case for the bug being fixed.

### 21.2 Test naming

Use descriptive names.

Allowed styles depend on repository convention.

Good:

```java
shouldRejectExpiredCandidateSubmission()
```

or:

```java
rejectsExpiredCandidateSubmission()
```

Avoid:

```java
test1()
testSubmit()
```

### 21.3 Test structure

Prefer Arrange-Act-Assert.

```java
@Test
void shouldRejectExpiredCandidateSubmission() {
    CandidateSubmission submission = expiredSubmission();

    InvalidSubmissionException exception = assertThrows(
            InvalidSubmissionException.class,
            () -> validator.validate(submission));

    assertEquals("submission expired", exception.getReason());
}
```

### 21.4 Deterministic tests

The agent **MUST NOT** create flaky tests.

Avoid:

1. Real sleeps.
2. Real current time.
3. Real network calls.
4. Test order dependency.
5. Random values without fixed seeds.
6. External service dependency.

Use:

1. `Clock.fixed`.
2. Temporary directories.
3. Fakes/stubs.
4. Test containers only if already part of the project.
5. Explicit timeout and synchronization primitives for concurrency tests.

### 21.5 Assertions

Assertions must verify behavior, not implementation details, unless testing an internal utility.

Bad:

```java
assertNotNull(result);
```

Good:

```java
assertEquals(CaseStatus.ESCALATED, result.status());
assertEquals(officerId, result.assignedOfficerId());
```

---

## 22. Performance standards

### 22.1 Default stance

Write clear code first. Optimize measured bottlenecks.

The agent **MUST NOT** introduce caching, pooling, parallelism, custom buffers, or low-level optimizations without a performance reason.

### 22.2 Hot path rules

For hot paths:

1. Avoid repeated allocation in loops.
2. Avoid regex recompilation.
3. Avoid repeated date formatter creation.
4. Avoid unnecessary boxing/unboxing.
5. Avoid repeated database/network calls inside loops.
6. Avoid full materialization of large datasets.
7. Use streaming/batching where appropriate.
8. Document algorithmic complexity when non-trivial.

### 22.3 Database/network loops

Bad:

```java
for (CaseId caseId : caseIds) {
    CaseDetails details = repository.findDetails(caseId);
    results.add(details);
}
```

Better:

```java
List<CaseDetails> results = repository.findDetails(caseIds);
```

### 22.4 Caching

Caching requires explicit answers:

1. What is the key?
2. What is the value?
3. What is the invalidation rule?
4. What is the TTL?
5. What is the memory bound?
6. What happens during concurrent misses?
7. What stale data risk is acceptable?

No unbounded static maps.

---

## 23. Layering and architecture

### 23.1 Layer responsibilities

| Layer               | Allowed responsibility                          | Forbidden responsibility              |
| ------------------- | ----------------------------------------------- | ------------------------------------- |
| Controller/API      | Request parsing, auth context, response mapping | Business rules, persistence details   |
| Application service | Use-case orchestration, transaction boundary    | Low-level SQL/HTTP details            |
| Domain              | Invariants, state transitions, policies         | Framework annotations unless required |
| Repository          | Persistence access                              | Business decisions                    |
| External client     | Protocol mapping, remote error translation      | Domain state mutation                 |
| Mapper              | Data shape conversion                           | Business decisions                    |

### 23.2 Domain logic

Business rules **MUST** be represented explicitly.

Bad:

```java
if (status.equals("A") && type == 3) {
    // ...
}
```

Good:

```java
if (caseStatus.canBeEscalatedBy(officerRole)) {
    escalationService.escalate(caseId, officerRole);
}
```

### 23.3 State transitions

State transitions **MUST** define:

1. Current state.
2. Trigger/event/command.
3. Guard condition.
4. Next state.
5. Side effects.
6. Failure behavior.

Bad:

```java
caseEntity.setStatus("CLOSED");
```

Good:

```java
caseEntity.close(CloseCaseCommand command, Clock clock);
```

### 23.4 DTO vs domain

DTOs are boundary objects. Domain objects carry invariants.

The agent **MUST NOT** put core business decisions inside DTOs.

The agent **MUST NOT** expose persistence entities directly as API responses unless the existing project explicitly does so and changing it is out of scope.

---

## 24. Persistence and transactions

### 24.1 Transaction boundaries

Transaction boundaries must be explicit and owned by application services or equivalent use-case orchestration layer.

Do not start transactions inside low-level helpers unless the project architecture requires it.

### 24.2 Partial failure

For multi-step operations, the agent **MUST** define failure behavior:

1. Atomic rollback.
2. Compensation.
3. Retry.
4. Dead-letter.
5. Partial success result.

Do not silently continue after a failed persistence operation.

### 24.3 Idempotency

For commands that may be retried, define idempotency when relevant:

1. Idempotency key.
2. Unique constraint.
3. Duplicate detection.
4. Same response for repeated request.
5. Safe retry behavior after timeout.

### 24.4 Query design

Avoid N+1 query patterns.

Large result sets must use pagination, streaming, or batching.

---

## 25. API and integration standards

### 25.1 External calls

External calls **MUST** define:

1. Timeout.
2. Retry policy, if any.
3. Circuit breaker/fallback, if project supports it.
4. Error mapping.
5. Observability/logging.
6. Idempotency for non-read operations.
7. Payload size limits.

### 25.2 Retries

Retries are dangerous.

The agent **MUST NOT** add retries unless:

1. The operation is idempotent or protected by idempotency key.
2. The retry count is bounded.
3. Backoff is defined.
4. Retryable vs non-retryable errors are separated.
5. Timeout budget remains bounded.

### 25.3 Status handling

For HTTP integrations, do not treat all non-exception responses as success.

Handle status codes explicitly:

```java
if (statusCode == 404) {
    return Optional.empty();
}
if (statusCode < 200 || statusCode >= 300) {
    throw new ExternalServiceException("Unexpected status: " + statusCode);
}
```

---

## 26. Documentation and comments

### 26.1 Comment policy

Comments should explain why, not repeat what.

Bad:

```java
// increment i
index++;
```

Good:

```java
// External provider may return duplicate IDs during retry replay.
Set<String> uniqueIds = new LinkedHashSet<>(response.ids());
```

### 26.2 Javadoc

Public API, extension points, and non-obvious domain behavior **MUST** have Javadoc.

Javadoc should document:

1. Contract.
2. Preconditions.
3. Postconditions.
4. Exceptions.
5. Thread-safety, if relevant.
6. Security-sensitive behavior, if relevant.

Do not generate noisy Javadocs for obvious private methods.

### 26.3 TODOs

The agent **MUST NOT** leave TODOs unless the user explicitly requests staged work.

If a TODO is unavoidable, it must include:

1. Owner or reason.
2. Consequence if not done.
3. Link to ticket or follow-up context, if available.

---

## 27. Static analysis and quality gates

### 27.1 Required local checks

Before finalizing implementation, the agent **SHOULD** run the project’s available checks:

1. Compile.
2. Unit tests.
3. Formatter.
4. Checkstyle/PMD/SpotBugs/Error Prone if configured.
5. Dependency/security scan if configured.

If checks cannot be run, the agent **MUST** say so and explain why.

### 27.2 Common forbidden warnings

The agent **MUST NOT** introduce:

1. Unused imports.
2. Raw types.
3. Unchecked casts without explanation.
4. Deprecated API usage unless interacting with legacy boundary.
5. Dead stores.
6. Empty catch blocks.
7. Resource leaks.
8. Magic numbers without named constants.
9. Public mutable static state.
10. Data races.

### 27.3 Suppressions

Suppressions require justification.

Bad:

```java
@SuppressWarnings("unchecked")
```

Good:

```java
@SuppressWarnings("unchecked") // JSON library returns raw Map; keys/values validated below.
```

---

## 28. LLM implementation workflow

### 28.1 Before coding

The agent **MUST** identify:

1. Target Java version.
2. Existing style and framework pattern.
3. Entry points affected.
4. Domain invariants affected.
5. Failure modes.
6. Tests to add/update.
7. Compatibility risks.

### 28.2 During coding

The agent **MUST**:

1. Make the smallest correct change.
2. Keep public API compatibility unless change is requested.
3. Keep business logic explicit.
4. Avoid touching unrelated files.
5. Avoid reformatting whole files unless formatter requires it.
6. Preserve existing behavior outside the requested scope.
7. Use Java 11-compatible APIs only.

### 28.3 After coding

The agent **MUST** provide:

1. Summary of changed behavior.
2. Files changed.
3. Tests added/updated.
4. Checks run and result.
5. Known limitations.
6. Assumptions.
7. Any standards intentionally not followed and why.

### 28.4 Patch rejection criteria

Generated code should be rejected if it:

1. Does not compile on Java 11.
2. Uses Java >11 syntax/API.
3. Adds dependency without approval.
4. Swallows errors.
5. Ignores nullability/invariants.
6. Introduces unsafe concurrency.
7. Loads unbounded data into memory.
8. Logs secrets/PII.
9. Breaks existing public contract.
10. Has no test for changed behavior.
11. Rewrites unrelated code.
12. Uses vague names that hide intent.
13. Adds fake TODO or placeholder logic.

---

## 29. Java 11 API preference matrix

| Concern                     | Preferred Java 11 API                      | Avoid                                            |
| --------------------------- | ------------------------------------------ | ------------------------------------------------ |
| Date/time                   | `java.time`                                | `Date`, `Calendar`, `SimpleDateFormat`           |
| File path                   | `Path`, `Files`                            | `File` for new code                              |
| Charset                     | `StandardCharsets.UTF_8`                   | Platform default charset                         |
| HTTP                        | `java.net.http.HttpClient`                 | Raw socket or ad-hoc URLConnection unless legacy |
| Immutable small collections | `List.of`, `Set.of`, `Map.of`              | Mutable constants                                |
| Defensive collection copy   | `List.copyOf`, `Set.copyOf`, `Map.copyOf`  | Exposing mutable input                           |
| Optional absence            | `Optional<T>` return                       | `null` return                                    |
| Async result                | `CompletableFuture` with explicit executor | Unbounded raw threads                            |
| Resource cleanup            | try-with-resources                         | Manual close without finally                     |
| String blank check          | `String.isBlank()`                         | Custom blank utility unless project standard     |
| Unicode text scan           | `String.codePoints()`                      | Naive `charAt` loop                              |
| Money                       | `BigDecimal`                               | `double`, `float`                                |

---

## 30. Example: strict Java 11 style

```java
package com.example.casefile.application;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

public final class CaseEscalationService {
    private final CaseRepository caseRepository;
    private final EscalationPolicy escalationPolicy;
    private final Clock clock;

    public CaseEscalationService(
            CaseRepository caseRepository,
            EscalationPolicy escalationPolicy,
            Clock clock) {
        this.caseRepository = Objects.requireNonNull(caseRepository, "caseRepository");
        this.escalationPolicy = Objects.requireNonNull(escalationPolicy, "escalationPolicy");
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    public Optional<CaseEscalationResult> escalate(CaseId caseId, OfficerId officerId) {
        Objects.requireNonNull(caseId, "caseId");
        Objects.requireNonNull(officerId, "officerId");

        CaseFile caseFile = caseRepository.findById(caseId)
                .orElseThrow(() -> new CaseNotFoundException(caseId));

        if (!escalationPolicy.canEscalate(caseFile, officerId)) {
            return Optional.empty();
        }

        Instant escalatedAt = Instant.now(clock);
        CaseFile escalated = caseFile.escalate(officerId, escalatedAt);
        caseRepository.save(escalated);

        return Optional.of(new CaseEscalationResult(caseId, escalated.status(), escalatedAt));
    }

    public List<CaseFile> findEscalatableCases(OfficerId officerId) {
        Objects.requireNonNull(officerId, "officerId");

        return caseRepository.findOpenCases().stream()
                .filter(caseFile -> escalationPolicy.canEscalate(caseFile, officerId))
                .collect(java.util.stream.Collectors.toUnmodifiableList());
    }
}
```

Notes:

1. Constructor dependencies are final and null-checked.
2. Time uses injected `Clock`.
3. Absence is represented explicitly.
4. Domain decision is delegated to `EscalationPolicy`.
5. State transition is explicit through `caseFile.escalate(...)`.
6. Java 11-compatible collector is used instead of Java 16 `Stream.toList()`.

---

## 31. Reviewer checklist

Use this checklist for generated Java 11 code.

### Compatibility

- [ ] Compiles with `--release 11`.
- [ ] Does not use Java >11 syntax.
- [ ] Does not use Java >11 APIs.
- [ ] Does not assume removed Java EE/CORBA/JavaFX modules are bundled.

### Correctness

- [ ] Inputs are validated.
- [ ] Null policy is explicit.
- [ ] Domain invariants are represented.
- [ ] State transitions are explicit.
- [ ] Failure modes are handled.
- [ ] Exceptions preserve causes.
- [ ] Interrupt status is preserved.

### Maintainability

- [ ] Names reveal intent.
- [ ] Methods are cohesive.
- [ ] Responsibilities are separated.
- [ ] No unrelated rewrite.
- [ ] No dead code or placeholder TODO.
- [ ] Comments explain why, not what.

### Security

- [ ] Trust boundaries validate inputs.
- [ ] No secrets/PII in logs/errors.
- [ ] No unsafe deserialization.
- [ ] Resource limits exist for untrusted input.
- [ ] File paths are normalized and constrained.
- [ ] Regex usage is safe for untrusted input.

### Performance

- [ ] No unbounded full-memory loads.
- [ ] No N+1 calls introduced.
- [ ] No unbounded cache/static map.
- [ ] No accidental parallelism.
- [ ] Large data uses streaming/batching.

### Testing

- [ ] Unit tests cover changed behavior.
- [ ] Edge cases are tested.
- [ ] Failure paths are tested.
- [ ] Time-dependent tests use fixed clock.
- [ ] No flaky sleeps or real external calls.

---

## 32. Agent prompt snippet

Use this snippet in coding-agent instructions:

```text
You are implementing Java 11 code. You MUST follow strict-coding-standards__java11.md.
Before writing code, inspect nearby code style, build config, Java version, tests, and existing domain patterns.
Do not use Java features or APIs newer than Java 11.
Do not add dependencies unless explicitly requested.
Do not make broad refactors.
Implement the smallest correct change.
Preserve errors, interrupts, resource cleanup, null contracts, and domain invariants.
Add or update tests for changed behavior.
After implementation, report changed files, checks run, assumptions, and any standard intentionally violated.
```

---

## 33. Source references

This document is a strict implementation standard derived from Java 11 platform documentation, Java 11 release information, OpenJDK enhancement proposals, secure coding guidance, and widely used Java style conventions.

Primary references:

1. Oracle JDK 11 Documentation: https://docs.oracle.com/en/java/javase/11/
2. Java SE 11 & JDK 11 API Specification: https://docs.oracle.com/en/java/javase/11/docs/api/
3. Oracle JDK 11 Release Notes: https://www.oracle.com/java/technologies/javase/11-relnote-issues.html
4. OpenJDK JDK 11 Project: https://openjdk.org/projects/jdk/11/
5. JEP 321 — HTTP Client: https://openjdk.org/jeps/321
6. JEP 323 — Local-Variable Syntax for Lambda Parameters: https://openjdk.org/jeps/323
7. Oracle Secure Coding Guidelines for Java SE: https://www.oracle.com/java/technologies/javase/seccodeguide.html
8. Google Java Style Guide: https://google.github.io/styleguide/javaguide.html
9. Oracle Java Code Conventions — Statements: https://www.oracle.com/java/technologies/javase/codeconventions-statements.html
10. Oracle Java Code Conventions — Naming: https://www.oracle.com/java/technologies/javase/codeconventions-namingconventions.html