# learn-java-collections-and-streams-part-057.md

# Java Collections and Streams — Part 057  
# Functional Patterns with Streams: Pure Transformations, Predicate Composition, Mapper Pipelines, Optional Interop, Function Registry, Strategy Lambdas, Side-Effect Isolation, and Readable Functional Design

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **057**  
> Fokus: memahami pola functional programming yang praktis dengan Java Streams. Kita akan membahas pure function, mapper/filter/reducer composition, predicate combinators, function registry, strategy via lambdas, Optional/Stream interop, domain pipelines, validation pipelines, error handling, side-effect isolation, readability boundaries, dan kapan loop/domain service lebih tepat daripada stream chain.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Stream Pipeline = Dataflow, Bukan Control Flow Biasa](#2-mental-model-stream-pipeline--dataflow-bukan-control-flow-biasa)
3. [Functional Core, Imperative Shell](#3-functional-core-imperative-shell)
4. [Pure Function](#4-pure-function)
5. [Referential Transparency](#5-referential-transparency)
6. [Mapper Pattern](#6-mapper-pattern)
7. [Filter Pattern](#7-filter-pattern)
8. [Predicate Composition](#8-predicate-composition)
9. [Function Composition](#9-function-composition)
10. [Transformer Pipeline](#10-transformer-pipeline)
11. [Validation Pipeline](#11-validation-pipeline)
12. [Optional and Stream Interop](#12-optional-and-stream-interop)
13. [`flatMap(Optional::stream)` Pattern](#13-flatmapoptionalstream-pattern)
14. [Strategy via Functions](#14-strategy-via-functions)
15. [Function Registry](#15-function-registry)
16. [Dispatch with Map of Functions](#16-dispatch-with-map-of-functions)
17. [Domain-Specific Functional Interfaces](#17-domain-specific-functional-interfaces)
18. [Higher-Order Functions](#18-higher-order-functions)
19. [Currying-Like Patterns in Java](#19-currying-like-patterns-in-java)
20. [Partial Application-Like Patterns](#20-partial-application-like-patterns)
21. [Method References](#21-method-references)
22. [Lambda Capture](#22-lambda-capture)
23. [Side-Effect Isolation](#23-side-effect-isolation)
24. [Audit/Logging Without Polluting Pipelines](#24-auditlogging-without-polluting-pipelines)
25. [Error as Data](#25-error-as-data)
26. [Result/Either-Like Pattern](#26-resulteither-like-pattern)
27. [Collecting Successes and Failures](#27-collecting-successes-and-failures)
28. [Composition with Collectors](#28-composition-with-collectors)
29. [Functional Aggregation](#29-functional-aggregation)
30. [Readable Stream Pipelines](#30-readable-stream-pipelines)
31. [Naming Intermediate Functions](#31-naming-intermediate-functions)
32. [When Functional Style Becomes Too Clever](#32-when-functional-style-becomes-too-clever)
33. [Performance Considerations](#33-performance-considerations)
34. [Testing Functional Pipelines](#34-testing-functional-pipelines)
35. [Common Anti-Patterns](#35-common-anti-patterns)
36. [Production Failure Modes](#36-production-failure-modes)
37. [Best Practices](#37-best-practices)
38. [Decision Matrix](#38-decision-matrix)
39. [Latihan](#39-latihan)
40. [Ringkasan](#40-ringkasan)
41. [Referensi](#41-referensi)

---

# 1. Tujuan Bagian Ini

Java Streams sering diperkenalkan sebagai:

```java
list.stream()
    .filter(...)
    .map(...)
    .collect(...)
```

Tetapi kemampuan sebenarnya bukan sekadar syntax lebih pendek.

Streams memaksa kita berpikir dalam pola functional:

- data transformation;
- pure function;
- composition;
- declarative filtering;
- reducing/collecting;
- error as data;
- strategy as function;
- pipeline readability;
- side-effect isolation.

Contoh buruk:

```java
List<OrderDto> result = new ArrayList<>();

orders.stream()
    .filter(order -> {
        audit(order);
        return order.status() == PAID;
    })
    .map(order -> {
        repository.save(order);
        return toDto(order);
    })
    .forEach(result::add);
```

Ini “pakai stream”, tetapi bukan functional style yang sehat.

Contoh lebih baik:

```java
List<OrderDto> result = orders.stream()
    .filter(OrderPredicates.isPaid())
    .map(OrderMapper::toDto)
    .toList();
```

Side effects seperti audit/save ditempatkan di workflow lain yang eksplisit.

Tujuan bagian ini:

- memahami pattern functional yang berguna;
- membedakan pure transformation dan side-effect workflow;
- menyusun predicate/function dengan jelas;
- memakai Optional/Stream interop;
- mendesain registry function/strategy;
- melakukan validation/error aggregation secara aman;
- menjaga readability dan maintainability;
- tahu kapan berhenti memakai stream.

---

# 2. Mental Model: Stream Pipeline = Dataflow, Bukan Control Flow Biasa

Loop tradisional:

```java
for (Order order : orders) {
    if (order.status() == PAID) {
        result.add(toDto(order));
    }
}
```

Stream:

```java
orders.stream()
    .filter(order -> order.status() == PAID)
    .map(OrderMapper::toDto)
    .toList();
```

Stream menggambarkan **dataflow**:

```text
orders -> paid orders -> DTOs -> list
```

## 2.1 Pipeline stages

- source;
- intermediate operations;
- terminal operation.

## 2.2 Mental shift

Jangan berpikir:

```text
step-by-step mutate variable
```

Pikirkan:

```text
transform collection of facts into new collection/result
```

## 2.3 Main rule

```text
Use stream when the code naturally describes data transformation.
Use loop when the code naturally describes workflow/control flow.
```

---

# 3. Functional Core, Imperative Shell

Pattern penting:

```text
Functional core:
  pure calculations and transformations

Imperative shell:
  IO, DB, network, logging, transactions, side effects
```

## 3.1 Example

Imperative shell:

```java
@Transactional
public ImportReport importFile(Path path) {
    List<Row> rows = csvReader.read(path);
    ImportReport report = importCore.validate(rows);

    if (report.hasNoErrors()) {
        repository.saveAll(report.validCommands());
    }

    return report;
}
```

Functional core:

```java
ImportReport validate(List<Row> rows) {
    return rows.stream()
        .map(this::validateRow)
        .collect(validationReportCollector());
}
```

## 3.2 Benefit

- easier testing;
- fewer side-effect bugs;
- clearer transaction boundaries;
- deterministic behavior.

## 3.3 Rule

Keep stream-heavy transformation pure when possible; keep side effects at explicit boundaries.

---

# 4. Pure Function

Pure function:

```text
same input -> same output
no side effects
```

Example:

```java
OrderDto toDto(Order order) {
    return new OrderDto(order.id(), order.status(), order.amount());
}
```

Not pure:

```java
OrderDto toDto(Order order) {
    audit.log(order.id());
    return ...
}
```

## 4.1 Why pure functions fit Streams

Stream may be:

- lazy;
- reordered in some cases;
- parallel;
- short-circuited;
- fused.

Pure functions are safe in these contexts.

## 4.2 Rule

Functions passed to `map`, `filter`, `sorted`, `distinct`, and collectors should be pure unless side effects are deliberately controlled.

---

# 5. Referential Transparency

An expression is referentially transparent if it can be replaced by its value without changing behavior.

```java
map(OrderMapper::toDto)
```

is easier to reason about if `toDto` is pure.

## 5.1 Practical benefit

- tests simpler;
- caching possible;
- parallel safe;
- refactoring safe.

## 5.2 Rule

Aim for referential transparency in stream transformations.

---

# 6. Mapper Pattern

Mapper transforms T -> R.

```java
Function<Order, OrderDto> toDto = order ->
    new OrderDto(order.id(), order.amountCents());
```

Usage:

```java
List<OrderDto> dtos = orders.stream()
    .map(toDto)
    .toList();
```

## 6.1 Prefer named mapper for complex mapping

```java
class OrderMapper {
    static OrderDto toDto(Order order) {
        ...
    }
}
```

## 6.2 Avoid huge inline lambda

Bad:

```java
.map(order -> {
    // 40 lines
})
```

## 6.3 Rule

Inline lambdas are for small obvious transformations; name complex transformations.

---

# 7. Filter Pattern

Filter keeps elements matching predicate.

```java
orders.stream()
    .filter(order -> order.status() == PAID)
    .toList();
```

## 7.1 Named predicate

```java
static Predicate<Order> isPaid() {
    return order -> order.status() == PAID;
}
```

Usage:

```java
orders.stream()
    .filter(OrderPredicates.isPaid())
    .toList();
```

## 7.2 Rule

Named predicates make business filtering readable and reusable.

---

# 8. Predicate Composition

Java `Predicate` supports:

```java
and
or
negate
```

Example:

```java
Predicate<Order> isPaid = order -> order.status() == PAID;
Predicate<Order> isLarge = order -> order.amountCents() > 1_000_000;
Predicate<Order> isPaidLargeOrder = isPaid.and(isLarge);
```

Usage:

```java
orders.stream()
    .filter(isPaidLargeOrder)
    .toList();
```

## 8.1 Domain predicates

```java
final class OrderPredicates {
    static Predicate<Order> hasStatus(OrderStatus status) {
        return order -> order.status() == status;
    }

    static Predicate<Order> amountAtLeast(long cents) {
        return order -> order.amountCents() >= cents;
    }

    static Predicate<Order> belongsTo(TenantId tenantId) {
        return order -> order.tenantId().equals(tenantId);
    }
}
```

## 8.2 Rule

Compose predicates to make filtering rules explicit and testable.

---

# 9. Function Composition

`Function` supports:

```java
andThen
compose
```

Example:

```java
Function<String, String> trim = String::trim;
Function<String, String> lower = String::toLowerCase;
Function<String, Email> toEmail = Email::of;

Function<String, Email> normalizeEmail = trim
    .andThen(lower)
    .andThen(toEmail);
```

## 9.1 Use case

Input normalization pipelines.

## 9.2 Rule

Function composition is useful when each step is small, named, and independently meaningful.

---

# 10. Transformer Pipeline

Domain transformer:

```java
@FunctionalInterface
interface Transformer<T> {
    T apply(T value);

    default Transformer<T> andThen(Transformer<T> next) {
        return value -> next.apply(this.apply(value));
    }
}
```

Usage:

```java
Transformer<CustomerCommand> pipeline =
    normalizeName()
        .andThen(normalizeEmail())
        .andThen(defaultCountry());

CustomerCommand normalized = pipeline.apply(command);
```

## 10.1 Rule

Custom functional interfaces can express domain-specific transformations better than raw `Function`.

---

# 11. Validation Pipeline

Validation returns errors, not boolean.

```java
@FunctionalInterface
interface Validator<T> {
    List<ValidationError> validate(T value);

    default Validator<T> and(Validator<T> other) {
        return value -> Stream.concat(
            this.validate(value).stream(),
            other.validate(value).stream()
        ).toList();
    }
}
```

Usage:

```java
Validator<CreateUserCommand> validator =
    requireEmail()
        .and(validEmailFormat())
        .and(passwordStrongEnough());

List<ValidationError> errors = validator.validate(command);
```

## 11.1 Rule

Validation pipelines should accumulate structured errors, not hide them in boolean predicates.

---

# 12. Optional and Stream Interop

Sometimes mapping may or may not produce a value.

```java
Optional<UserDto> maybeDto(User user)
```

In streams, avoid:

```java
.map(this::maybeDto)
.filter(Optional::isPresent)
.map(Optional::get)
```

Better:

```java
.flatMap(user -> maybeDto(user).stream())
```

## 12.1 Rule

Use `Optional.stream()` to flatten optional values cleanly.

---

# 13. `flatMap(Optional::stream)` Pattern

Example:

```java
List<Email> emails = users.stream()
    .map(User::primaryEmail)
    .flatMap(Optional::stream)
    .toList();
```

## 13.1 Benefit

Removes absent values without unsafe `get`.

## 13.2 Rule

`Optional::stream` is the cleanest bridge from maybe-one to zero-or-one stream.

---

# 14. Strategy via Functions

Instead of class hierarchy:

```java
Map<PricingMode, Function<Quote, Money>> pricingStrategies = Map.of(
    PricingMode.STANDARD, this::standardPrice,
    PricingMode.DISCOUNTED, this::discountedPrice
);
```

Usage:

```java
Money price(Quote quote) {
    Function<Quote, Money> strategy = pricingStrategies.get(quote.mode());
    if (strategy == null) {
        throw new UnsupportedPricingModeException(quote.mode());
    }
    return strategy.apply(quote);
}
```

## 14.1 Good when

- strategy is small;
- no complex state;
- no lifecycle;
- easy test.

## 14.2 Use class if

- strategy has dependencies;
- complex behavior;
- needs named type;
- needs configuration.

## 14.3 Rule

Functions are lightweight strategies; classes are better for rich strategies.

---

# 15. Function Registry

Registry maps key -> function.

```java
Map<EventType, Consumer<Event>> handlers
```

or:

```java
Map<CommandType, Function<Command, CommandResult>> handlers
```

## 15.1 Validate completeness

At startup:

```java
for (CommandType type : CommandType.values()) {
    if (!handlers.containsKey(type)) {
        throw new MissingHandlerException(type);
    }
}
```

## 15.2 Rule

Function registries should fail fast if required function is missing.

---

# 16. Dispatch with Map of Functions

Dispatch:

```java
CommandResult handle(Command command) {
    Function<Command, CommandResult> handler = handlers.get(command.type());

    if (handler == null) {
        throw new UnsupportedCommandException(command.type());
    }

    return handler.apply(command);
}
```

## 16.1 Type safety issue

If command subtypes differ, raw `Function<Command,...>` may require casts.

Alternative:

- visitor pattern;
- sealed hierarchy + switch;
- command-specific handler interface.

## 16.2 Rule

Use map dispatch when type model stays simple; use typed dispatch when casts grow.

---

# 17. Domain-Specific Functional Interfaces

Raw `Function<T,R>` can be too generic.

Domain-specific interface:

```java
@FunctionalInterface
interface OrderPolicy {
    boolean allows(Order order);
}
```

or:

```java
@FunctionalInterface
interface PriceCalculator {
    Money calculate(Quote quote);
}
```

## 17.1 Benefits

- better names;
- domain vocabulary;
- default composition methods;
- clearer tests.

## 17.2 Rule

Use domain-specific functional interfaces when the function has business meaning.

---

# 18. Higher-Order Functions

Higher-order function accepts or returns function.

Example:

```java
Predicate<Order> amountAtLeast(long cents) {
    return order -> order.amountCents() >= cents;
}
```

This function returns predicate.

## 18.1 Use case

Parameterized rules.

```java
orders.stream()
    .filter(amountAtLeast(100_000))
    .toList();
```

## 18.2 Rule

Higher-order functions are useful for building reusable parameterized business rules.

---

# 19. Currying-Like Patterns in Java

Java does not make currying ergonomic, but we can approximate.

```java
Function<TenantId, Predicate<Order>> belongsToTenant =
    tenantId -> order -> order.tenantId().equals(tenantId);
```

Usage:

```java
Predicate<Order> belongsToCurrentTenant = belongsToTenant.apply(currentTenant);
```

## 19.1 Use sparingly

Too much currying makes Java code hard to read.

## 19.2 Rule

Use simple factory methods over clever currying for most Java code.

---

# 20. Partial Application-Like Patterns

Example:

```java
Function<Order, OrderDto> mapperFor(Locale locale, Currency currency) {
    return order -> OrderDto.from(order, locale, currency);
}
```

Usage:

```java
Function<Order, OrderDto> mapper = mapperFor(locale, currency);

orders.stream()
    .map(mapper)
    .toList();
```

## 20.1 Benefit

Capture stable context once.

## 20.2 Rule

Partial application pattern is useful when context is immutable and reused across pipeline.

---

# 21. Method References

Method references improve readability when method name communicates intent.

```java
.map(OrderMapper::toDto)
.filter(Order::isPaid)
```

## 21.1 Avoid if ambiguous

```java
.map(this::process)
```

If `process` has side effects, method reference hides that.

## 21.2 Rule

Use method references for pure named operations with clear intent.

---

# 22. Lambda Capture

Lambda can capture variables.

```java
TenantId tenantId = currentTenant.id();

orders.stream()
    .filter(order -> order.tenantId().equals(tenantId))
    .toList();
```

## 22.1 Good capture

Immutable small context.

## 22.2 Bad capture

Mutable collection/state:

```java
List<Order> rejected = new ArrayList<>();

orders.stream()
    .filter(order -> {
        if (!valid(order)) {
            rejected.add(order);
            return false;
        }
        return true;
    })
    .toList();
```

## 22.3 Rule

Capture immutable context, not mutable output state.

---

# 23. Side-Effect Isolation

Side effects include:

- DB writes;
- network calls;
- logging/audit;
- metrics;
- mutation;
- sending email;
- modifying external list.

## 23.1 Avoid hidden side effects in intermediate ops

Bad:

```java
.map(order -> {
    repository.save(order);
    return order.id();
})
```

## 23.2 Prefer explicit shell

```java
List<OrderCommand> commands = orders.stream()
    .map(OrderCommand::from)
    .toList();

repository.saveAll(commands);
```

## 23.3 Rule

Use streams to prepare data; perform side effects explicitly.

---

# 24. Audit/Logging Without Polluting Pipelines

Sometimes you need observe pipeline.

## 24.1 `peek` caution

`peek` is lazy and tied to terminal operation.

Bad for important side effects:

```java
stream.peek(audit::record)
```

## 24.2 Better

Audit before/after workflow:

```java
List<OrderDto> dtos = orders.stream()
    .filter(Order::isPaid)
    .map(OrderMapper::toDto)
    .toList();

audit.recordExport(dtos.size());
```

## 24.3 Rule

Use `peek` for debugging, not required business side effects.

---

# 25. Error as Data

Instead of throwing inside stream for expected validation failures, model result.

```java
sealed interface RowResult permits ValidRow, InvalidRow {}

record ValidRow(Command command) implements RowResult {}
record InvalidRow(int index, List<ValidationError> errors) implements RowResult {}
```

Pipeline:

```java
List<RowResult> results = rows.stream()
    .map(this::validateRow)
    .toList();
```

## 25.1 Rule

Expected per-item failures in collection processing are often better modeled as data.

---

# 26. Result/Either-Like Pattern

Simple result type:

```java
sealed interface Result<T> permits Success, Failure {}

record Success<T>(T value) implements Result<T> {}
record Failure<T>(List<ValidationError> errors) implements Result<T> {}
```

Usage:

```java
List<Result<Command>> results = rows.stream()
    .map(this::parseAndValidate)
    .toList();
```

## 26.1 Rule

Result-like types make partial failure explicit and composable.

---

# 27. Collecting Successes and Failures

Partition:

```java
record ImportPlan(
    List<Command> validCommands,
    List<RowFailure> failures
) {}
```

Accumulator:

```java
final class ImportPlanAcc {
    final List<Command> valid = new ArrayList<>();
    final List<RowFailure> failures = new ArrayList<>();

    void add(Result<Command> result) {
        switch (result) {
            case Success<Command> success -> valid.add(success.value());
            case Failure<Command> failure -> failures.add(new RowFailure(failure.errors()));
        }
    }

    ImportPlanAcc merge(ImportPlanAcc other) {
        valid.addAll(other.valid);
        failures.addAll(other.failures);
        return this;
    }

    ImportPlan finish() {
        return new ImportPlan(List.copyOf(valid), List.copyOf(failures));
    }
}
```

## 27.1 Rule

Use custom collector when success/failure aggregation has domain shape.

---

# 28. Composition with Collectors

Collectors are functional reducers.

Example:

```java
Map<CustomerId, OrderSummary> summaryByCustomer = orders.stream()
    .collect(Collectors.groupingBy(
        Order::customerId,
        orderSummaryCollector()
    ));
```

## 28.1 Rule

Collectors allow reusable aggregation functions as pipeline components.

---

# 29. Functional Aggregation

Aggregation can be expressed as function:

```java
Function<List<Order>, OrderSummary> summarizeOrders =
    orders -> orders.stream().collect(orderSummaryCollector());
```

## 29.1 But avoid over-abstracting

If function hides too much, method name/class may be clearer.

## 29.2 Rule

Use functions for composability, named methods for clarity.

---

# 30. Readable Stream Pipelines

A readable pipeline has:

- clear source;
- small named operations;
- limited chain length;
- no hidden side effects;
- terminal operation matching intent.

## 30.1 Example

```java
List<OrderDto> dtos = orders.stream()
    .filter(OrderPredicates.belongsTo(tenantId))
    .filter(OrderPredicates.isVisibleTo(viewer))
    .map(OrderMapper.forLocale(locale))
    .sorted(OrderDtoComparators.byCreatedAtDesc())
    .toList();
```

## 30.2 Rule

Each pipeline stage should read like a sentence.

---

# 31. Naming Intermediate Functions

Instead of:

```java
orders.stream()
    .filter(o -> o.status() == PAID && o.amountCents() > 100_000 && o.tenantId().equals(tenantId))
    .map(o -> new OrderDto(...))
    .toList();
```

Use:

```java
Predicate<Order> visiblePaidLargeOrders =
    belongsTo(tenantId)
        .and(isPaid())
        .and(amountAtLeast(100_000));

Function<Order, OrderDto> toLocalizedDto = OrderMapper.forLocale(locale);

List<OrderDto> result = orders.stream()
    .filter(visiblePaidLargeOrders)
    .map(toLocalizedDto)
    .toList();
```

## 31.1 Rule

Name compound business rules before placing them in stream.

---

# 32. When Functional Style Becomes Too Clever

Stop using stream when:

- nested lambdas become deep;
- side effects dominate;
- exceptions require complex handling;
- transaction boundaries matter;
- state machine transitions occur;
- debugging becomes painful;
- team cannot read it;
- performance requires careful control flow.

## 32.1 Use loop

```java
for (Command command : commands) {
    authorize(command);
    validate(command);
    execute(command);
    audit(command);
}
```

This is clearer for workflows.

## 32.2 Rule

Functional style is good when it clarifies transformation; bad when it hides workflow.

---

# 33. Performance Considerations

## 33.1 Lambda allocation

Usually not primary concern, but avoid excessive object creation in hot paths.

## 33.2 Boxing

Prefer primitive streams for numeric heavy operations.

## 33.3 Capturing large object

Lambda capture can retain large object graph.

## 33.4 Stateful operations

`sorted`, `distinct`, `groupingBy` retain data.

## 33.5 Rule

Functional code still needs cost model.

---

# 34. Testing Functional Pipelines

Test pure functions independently:

```java
assertThat(OrderMapper.toDto(order)).isEqualTo(expected);
```

Test predicates:

```java
assertTrue(isPaid().test(paidOrder));
```

Test pipeline result:

```java
assertEquals(expected, service.visibleOrders(input));
```

## 34.1 Property tests

For validators/normalizers:

- idempotence;
- no null outputs;
- normalized format;
- all invalid rows captured.

## 34.2 Rule

Functional decomposition makes small unit tests natural.

---

# 35. Common Anti-Patterns

## 35.1 Stream chain with hidden DB writes

Bad.

## 35.2 `peek` for business side effects

Bad.

## 35.3 Capturing mutable output list

Race/side-effect bug.

## 35.4 Huge inline lambdas

Unreadable.

## 35.5 Overusing Optional in streams awkwardly

Use `Optional::stream`.

## 35.6 Raw `Function<Object,Object>` registry

Weak type safety.

## 35.7 Clever currying in normal Java business code

Hard to read.

## 35.8 Exception swallowing in lambda

Hidden failure.

## 35.9 Parallel stream with non-pure functions

Wrong.

## 35.10 Functional style for transaction workflow

Obscures control flow.

---

# 36. Production Failure Modes

## 36.1 Duplicate side effects

Lazy pipeline re-executed or retried with side effects.

## 36.2 Missing audit

`peek` not executed because terminal operation changed.

## 36.3 Race condition

Mutable captured state used in parallel stream.

## 36.4 Security bug

Authorization predicate captures mutable security context.

## 36.5 Memory leak

Lambda stored in registry captures large object.

## 36.6 Wrong error handling

Expected validation failures thrown and abort whole batch.

## 36.7 Performance regression

Nested scans hidden in functional mapper.

## 36.8 Debugging difficulty

Over-composed anonymous functions.

## 36.9 Incorrect strategy dispatch

Missing function registry entry.

## 36.10 Partial failure lost

Boolean filter discards invalid rows without report.

---

# 37. Best Practices

## 37.1 Keep stream functions pure

Especially map/filter/sorted.

## 37.2 Separate functional core from imperative shell

Transform first, side effect explicitly.

## 37.3 Name business predicates and mappers

Improve readability.

## 37.4 Compose predicates for rules

`and`, `or`, `negate`.

## 37.5 Use Optional.stream

Avoid `isPresent/get`.

## 37.6 Use domain-specific functional interfaces when useful

`PriceCalculator`, `Validator`, `OrderPolicy`.

## 37.7 Model expected errors as data

Use Result/Failure types.

## 37.8 Avoid `peek` for business logic

Use explicit steps.

## 37.9 Prefer loops for workflows

Transactions, IO, audit, state machines.

## 37.10 Test functions independently

Pure functions are easy to test.

---

# 38. Decision Matrix

| Situation | Recommended Style |
|---|---|
| pure list transformation | stream pipeline |
| simple filter + map | stream |
| reusable business filter | named Predicate |
| parameterized rule | predicate factory |
| multiple validation errors | Validator returning list/errors |
| optional mapping | `flatMap(Optional::stream)` |
| strategy selection small | map of functions |
| rich strategy with dependencies | class/interface strategy |
| batch partial failure | Result type + collector |
| side-effect workflow | explicit loop/service method |
| DB writes | imperative shell |
| transaction/state machine | loop/domain methods |
| debugging/tracing important | named methods, not huge lambdas |
| parallel stream | pure/stateless functions only |
| complex nested stream | refactor to methods or loop |
| large numeric aggregation | primitive streams/custom collector |
| high readability requirement | simplest code, not clever FP |

---

# 39. Latihan

## Latihan 1 — Predicate Composition

Create predicates: belongsToTenant, isPaid, amountAtLeast. Compose them.

## Latihan 2 — Mapper Extraction

Refactor huge inline `map` lambda into named mapper.

## Latihan 3 — Optional Stream

Convert `map(Optional).filter(isPresent).map(get)` to `flatMap(Optional::stream)`.

## Latihan 4 — Validator Composition

Implement `Validator<T>` with `and`.

## Latihan 5 — Result Type

Create `Success<T>` and `Failure<T>` and aggregate import results.

## Latihan 6 — Function Registry

Build command handler registry and validate completeness.

## Latihan 7 — Side Effect Refactor

Move repository save out of `map` into explicit imperative shell.

## Latihan 8 — `peek` Removal

Replace `peek(audit::record)` with explicit audit after terminal operation.

## Latihan 9 — Parallel Safety

Identify captured mutable state in a parallel stream and fix it.

## Latihan 10 — Readability Review

Take a long stream chain and split it into named functions or loop.

---

# 40. Ringkasan

Functional patterns with Streams are about clarity, composability, and controlled side effects.

Core lessons:

- Stream pipeline represents dataflow.
- Use functional core, imperative shell.
- Pure functions fit streams best.
- Named mappers and predicates improve readability.
- Predicate/function composition makes rules reusable.
- Validation often needs structured error aggregation, not boolean filters.
- `Optional.stream()` bridges maybe-one to stream cleanly.
- Functions can implement lightweight strategies and registries.
- Domain-specific functional interfaces improve vocabulary.
- Lambda capture should be immutable and small.
- Side effects should be isolated outside stream pipelines.
- `peek` is not for business-critical side effects.
- Expected errors can be modeled as data.
- Custom collectors can aggregate successes/failures.
- Functional style should stop when it hides workflow.
- Performance and memory still matter.

Main rule:

```text
Use Streams for pure, readable data transformations.
Use explicit imperative workflow for side effects, transactions,
state transitions, and security-sensitive operations.
```

---

# 41. Referensi

1. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

2. Java SE 25 — `Predicate`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/Predicate.html

3. Java SE 25 — `Function`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/Function.html

4. Java SE 25 — `Consumer`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/Consumer.html

5. Java SE 25 — `Supplier`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/Supplier.html

6. Java SE 25 — `Optional`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html

7. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

8. Java SE 25 — `Collector`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.html

9. Java SE 25 — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

10. Java SE 25 — `Comparator`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Comparator.html

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-056.md](./learn-java-collections-and-streams-part-056.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-058.md](./learn-java-collections-and-streams-part-058.md)

</div>