# Strict Coding Standards — Java Stream API

> **Purpose**: This document defines mandatory rules for LLMs, code agents, and human contributors when using the Java Stream API.
>
> **Scope**: Java 11, Java 17, Java 21, and Java 25 codebases. It covers `Stream`, primitive streams, collectors, reductions, ordering, null handling, resource-backed streams, parallel streams, gatherers, error handling, performance, testing, and review policy.
>
> **Mode**: Strict. Streams are allowed when they improve clarity without weakening determinism, observability, resource safety, or performance.

---

## 0. Core Principle

A stream pipeline is a declarative data-processing pipeline, not a hidden control-flow engine.

A code agent must not use streams merely because they look modern. A stream is acceptable only when the agent can state:

1. the data source;
2. whether encounter order matters;
3. whether elements may be null;
4. whether operations are stateless and non-interfering;
5. whether the stream owns an external resource;
6. whether the result is mutable or immutable;
7. whether the pipeline is sequential or parallel;
8. how errors are handled;
9. whether the stream is clearer than an equivalent loop.

If these cannot be answered, prefer explicit imperative code.

---

## 1. Baseline Compatibility Matrix

| API / Feature                                                          | Java 11 | Java 17 | Java 21 |            Java 25 | Rule                                                               |
| ---------------------------------------------------------------------- | ------: | ------: | ------: | -----------------: | ------------------------------------------------------------------ |
| `Stream`, `IntStream`, `LongStream`, `DoubleStream`                    |     Yes |     Yes |     Yes |                Yes | Allowed                                                            |
| `Collectors`                                                           |     Yes |     Yes |     Yes |                Yes | Allowed with explicit result semantics                             |
| `takeWhile`, `dropWhile`, `iterate(seed, hasNext, next)`, `ofNullable` |     Yes |     Yes |     Yes |                Yes | Allowed                                                            |
| `Collectors.filtering`, `flatMapping`, `teeing`                        |     Yes |     Yes |     Yes |                Yes | Allowed when clearer than manual accumulator                       |
| `Stream.toList()`                                                      |      No |     Yes |     Yes |                Yes | Allowed only when unmodifiable result is intended                  |
| `Stream.mapMulti()`                                                    |      No |     Yes |     Yes |                Yes | Restricted; use only to avoid intermediate nested streams          |
| `Collectors.toUnmodifiableList/Set/Map`                                |     Yes |     Yes |     Yes |                Yes | Allowed when immutable result is required                          |
| Parallel streams                                                       |     Yes |     Yes |     Yes |                Yes | Forbidden by default in application/server code                    |
| `Stream.gather(...)`, `Gatherer`, `Gatherers`                          |      No |      No |      No | Yes, since Java 24 | Restricted Java 25+ only; prefer built-ins before custom gatherers |

### 1.1 Baseline Rule

Every implementation must obey the declared project baseline.

Examples:

```text
Baseline: Java 11
Allowed: Stream API, primitive streams, Collectors, toUnmodifiableList.
Forbidden: Stream.toList(), mapMulti(), gatherers.
```

```text
Baseline: Java 17
Allowed: Stream.toList() only when immutable/unmodifiable result is intended.
Allowed: mapMulti() only with justification.
Forbidden: gatherers.
```

```text
Baseline: Java 25
Allowed: gatherers only when the project standard explicitly allows Java 24+ APIs.
Restricted: custom Gatherer implementation.
```

---

## 2. Absolute Rules

### 2.1 Forbidden by Default

The following are forbidden unless explicitly justified:

1. using streams for code with complex branching, mutation, early exit, or exception-heavy control flow;
2. mutating the stream source inside a stream pipeline;
3. mutating external state from `map`, `filter`, `flatMap`, `peek`, `forEach`, or collector lambdas;
4. using `parallelStream()` in request-handling, transaction-handling, UI, batch writer, or resource-bound code;
5. using streams to hide I/O, database calls, network calls, sleeps, locks, or blocking operations;
6. using `peek()` for business logic;
7. using `forEach()` where `map`, `filter`, `reduce`, or `collect` should express the transformation;
8. assuming `Collectors.toList()` returns a mutable `ArrayList`;
9. replacing `collect(Collectors.toList())` with `toList()` without confirming immutability is acceptable;
10. calling `.stream()` on possibly null collections;
11. returning lazy streams from methods when the source is resource-backed;
12. using `findFirst()` where order is accidental and `findAny()` is sufficient;
13. using `sorted()` on unbounded or very large streams without capacity justification;
14. using `distinct()` on large streams without memory-cost justification;
15. catching checked exceptions inside lambdas and wrapping them silently;
16. using stream pipelines longer than can be reasonably reviewed.

### 2.2 Mandatory

A stream pipeline must be:

1. readable;
2. finite unless explicitly designed as an infinite stream with short-circuiting;
3. side-effect free except at a clearly identified terminal boundary;
4. tested for empty, singleton, duplicate, unordered, and error cases;
5. explicit about mutability of produced collections;
6. explicit about ordering when order affects correctness;
7. explicit about resource closure for I/O-backed streams.

---

## 3. Stream Decision Protocol

Before introducing a stream, the agent must classify the operation.

| Scenario                                              | Preferred Style                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| Simple filtering/mapping/collection                   | Stream allowed                                                          |
| Simple aggregate calculation                          | Stream allowed, primitive stream preferred for numbers                  |
| Complex branching with multiple side effects          | Loop preferred                                                          |
| Requires early `break`/`continue` with stateful logic | Loop preferred                                                          |
| Requires checked-exception-heavy processing           | Loop preferred unless exception policy is explicit                      |
| Performs DB/network/file write per element            | Loop or batch API preferred                                             |
| Needs stable order transformation                     | Stream allowed with order tests                                         |
| Needs mutation of existing collection                 | Loop preferred                                                          |
| Performance-critical hot path                         | Benchmark before using stream                                           |
| Large/unbounded data source                           | Streaming cursor/iterator or bounded batch; avoid collecting all        |
| Parallel CPU-bound transformation                     | Consider explicit executor/fork-join design; parallel stream restricted |

### 3.1 Required Justification for Non-Trivial Pipelines

If a pipeline has more than three intermediate operations, state:

```text
Stream justification:
- Source:
- Cardinality:
- Ordering required: yes/no
- Null policy:
- Side effects: none / terminal only
- Result mutability:
- Why stream is clearer than loop:
- Tests:
```

---

## 4. Pipeline Shape Rules

### 4.1 Preferred Shape

Use this shape:

```java
List<OrderSummary> summaries = orders.stream()
    .filter(Order::isActive)
    .map(OrderSummary::from)
    .toList();
```

Rules:

1. start with a clear source;
2. keep each operation at one abstraction level;
3. use method references only when they remain readable;
4. use lambdas when names/conditions clarify intent;
5. avoid nesting pipelines inside lambdas unless the nested source is small and obvious;
6. end with a terminal operation that reflects intent.

### 4.2 Forbidden Shape

Do not write pipelines like this:

```java
orders.stream()
    .peek(order -> audit(order))
    .map(order -> {
        repository.save(order);
        return mapper.toDto(order);
    })
    .forEach(dto -> response.add(dto));
```

Problems:

1. hidden side effects;
2. I/O inside transformation;
3. mutation of external response;
4. unclear error behavior;
5. hard to test and retry safely.

Prefer:

```java
List<OrderDto> dtos = new ArrayList<>();
for (Order order : orders) {
    audit(order);
    repository.save(order);
    dtos.add(mapper.toDto(order));
}
```

or separate pure transformation from side-effect execution.

---

## 5. Non-Interference and Statelessness

### 5.1 Non-Interference Rule

Stream operations must not modify the stream source.

Forbidden:

```java
users.stream()
    .filter(user -> {
        users.remove(user);
        return user.isInactive();
    })
    .toList();
```

Allowed:

```java
List<User> inactiveUsers = users.stream()
    .filter(User::isInactive)
    .toList();
```

### 5.2 Stateless Lambda Rule

Lambda behavior must not depend on mutable state that changes during the pipeline.

Forbidden:

```java
AtomicInteger index = new AtomicInteger();
List<String> numbered = names.stream()
    .map(name -> index.incrementAndGet() + ". " + name)
    .toList();
```

Reason: It appears deterministic in sequential mode but becomes fragile under refactoring, ordering changes, or parallel execution.

Allowed for small ordered data if index is necessary:

```java
List<String> numbered = IntStream.range(0, names.size())
    .mapToObj(index -> (index + 1) + ". " + names.get(index))
    .toList();
```

### 5.3 External Mutation Rule

Forbidden:

```java
List<String> result = new ArrayList<>();
items.stream()
    .filter(Item::isValid)
    .forEach(item -> result.add(item.name()));
```

Allowed:

```java
List<String> result = items.stream()
    .filter(Item::isValid)
    .map(Item::name)
    .toList();
```

---

## 6. `forEach` Policy

### 6.1 `forEach` is a Terminal Side-Effect Boundary

Use `forEach` only when the whole purpose is performing a terminal side effect.

Allowed:

```java
notifications.forEach(notificationSender::send);
```

Only if:

1. sending order is irrelevant or explicitly ordered;
2. failure policy is explicit;
3. retry/idempotency is handled outside or inside `send`;
4. the collection is not huge/unbounded;
5. transaction boundary is clear.

### 6.2 Prefer Loop for Side Effects

If the body has more than one statement, prefer a loop.

Forbidden:

```java
orders.forEach(order -> {
    validate(order);
    repository.save(order);
    audit(order);
});
```

Preferred:

```java
for (Order order : orders) {
    validate(order);
    repository.save(order);
    audit(order);
}
```

Reason: side-effect sequencing, exception behavior, transaction behavior, and debugging are clearer.

### 6.3 `forEachOrdered`

Use `forEachOrdered` only when:

1. stream may be parallel or unordered but output order is required;
2. the performance cost is acceptable;
3. a test asserts order.

In normal sequential pipelines, prefer ordered source + normal collection.

---

## 7. `peek` Policy

`peek()` is for diagnostics, not business logic.

Allowed temporarily:

```java
orders.stream()
    .peek(order -> logger.debug("Processing orderId={}", order.id()))
    .map(OrderSummary::from)
    .toList();
```

Rules:

1. `peek` must not mutate state;
2. `peek` must not call persistence/network APIs;
3. `peek` must not enforce validation;
4. `peek` must not be required for correctness;
5. production `peek` usage must be justified or removed.

Forbidden:

```java
orders.stream()
    .peek(order -> order.markProcessed())
    .toList();
```

---

## 8. Null Handling

### 8.1 Null Source Collections

Forbidden:

```java
return user.getRoles().stream().map(Role::name).toList();
```

when `getRoles()` may return null.

Preferred domain rule:

```java
public List<Role> roles() {
    return roles;
}
```

where `roles` is never null.

Boundary fallback:

```java
List<String> roleNames = Optional.ofNullable(user.getRoles())
    .orElseGet(List::of)
    .stream()
    .map(Role::name)
    .toList();
```

### 8.2 Null Elements

Null elements must be handled intentionally.

Allowed:

```java
List<String> names = values.stream()
    .filter(Objects::nonNull)
    .map(String::trim)
    .toList();
```

But do not blindly filter null if null means data corruption.

Preferred for domain code:

```java
if (values.contains(null)) {
    throw new IllegalArgumentException("values must not contain null elements");
}
```

### 8.3 `Stream.ofNullable`

Use `Stream.ofNullable` for optional single values, not as a default replacement for validation.

Allowed:

```java
Stream.ofNullable(request.middleName())
    .map(String::trim)
    .filter(name -> !name.isBlank())
    .findFirst();
```

Do not use it to hide missing required values.

---

## 9. Optional and Streams

### 9.1 Optional Stream Flattening

Java 9+ `Optional.stream()` is allowed when flattening optional values.

Allowed:

```java
List<Address> addresses = users.stream()
    .map(User::primaryAddress)
    .flatMap(Optional::stream)
    .toList();
```

### 9.2 Forbidden Optional Abuse

Forbidden:

```java
users.stream()
    .map(user -> Optional.ofNullable(user.getName()).orElse(""))
    .filter(name -> !name.isBlank())
    .toList();
```

Prefer explicit null policy or domain non-null invariant.

---

## 10. Mapping Rules

### 10.1 Pure Mapping

`map` must be pure transformation.

Allowed:

```java
List<CustomerDto> dtos = customers.stream()
    .map(customerMapper::toDto)
    .toList();
```

Forbidden:

```java
List<CustomerDto> dtos = customers.stream()
    .map(customer -> {
        customer.setLastSeen(Instant.now());
        return customerMapper.toDto(customer);
    })
    .toList();
```

### 10.2 Expensive Mapping

If mapping calls expensive computation, database, network, or file I/O, do not hide it in stream syntax unless the method name makes cost explicit and failure policy is handled.

Restricted:

```java
List<CreditScore> scores = users.stream()
    .map(creditScoreClient::fetchScore)
    .toList();
```

Preferred:

```java
List<CreditScore> scores = new ArrayList<>(users.size());
for (User user : users) {
    scores.add(creditScoreClient.fetchScore(user));
}
```

or use a bulk API:

```java
List<CreditScore> scores = creditScoreClient.fetchScores(users);
```

### 10.3 `flatMap`

Use `flatMap` only when flattening nested sources is natural.

Allowed:

```java
List<Permission> permissions = roles.stream()
    .flatMap(role -> role.permissions().stream())
    .distinct()
    .toList();
```

Avoid nested `flatMap` chains longer than two levels. Extract named methods.

---

## 11. Filtering Rules

### 11.1 Predicate Naming

If a predicate is non-trivial, name it.

Preferred:

```java
List<CaseFile> escalatableCases = cases.stream()
    .filter(this::isEscalatable)
    .toList();
```

Not preferred:

```java
List<CaseFile> result = cases.stream()
    .filter(c -> c.status() == OPEN && c.ageDays() > 30 && !c.hasPendingAppeal() && c.owner() != null)
    .toList();
```

### 11.2 Predicate Side Effects

Predicates must not mutate or call side-effect APIs.

Forbidden:

```java
.filter(caseFile -> audit(caseFile) && caseFile.isOpen())
```

### 11.3 Filter Order

When performance matters, put cheap selective filters before expensive filters.

Allowed:

```java
List<CaseFile> result = cases.stream()
    .filter(CaseFile::isOpen)
    .filter(caseFile -> caseFile.ageDays() > 30)
    .filter(this::hasExpensiveExternalEligibility)
    .toList();
```

But do not reorder filters if order affects exception behavior or audit semantics.

---

## 12. Sorting and Ordering

### 12.1 Ordering Must Be Intentional

Do not rely on accidental order from `HashSet`, `HashMap`, database result without `ORDER BY`, or API result without documented order.

Forbidden:

```java
return userMap.values().stream()
    .map(UserDto::from)
    .toList();
```

if API contract implies stable order.

Preferred:

```java
return userMap.values().stream()
    .sorted(Comparator.comparing(User::createdAt).thenComparing(User::id))
    .map(UserDto::from)
    .toList();
```

### 12.2 Comparator Rules

Comparators must be:

1. null-safe if values can be null;
2. stable via tie-breaker when deterministic output matters;
3. locale-aware for display sorting;
4. numeric/time-based for numeric/time values, not string-based.

Allowed:

```java
Comparator<Customer> byRiskThenId = Comparator
    .comparing(Customer::riskScore, Comparator.nullsLast(Comparator.naturalOrder()))
    .thenComparing(Customer::id);
```

### 12.3 `sorted()` Cost

`sorted()` is restricted for large streams because it requires buffering and comparison of all elements.

For large datasets, prefer database sorting, indexed search, priority queues, or bounded top-N algorithms.

---

## 13. Distinctness and Equality

### 13.1 `distinct()` Uses Equality

`distinct()` depends on `equals`/`hashCode`.

Allowed:

```java
List<CustomerId> uniqueCustomerIds = orders.stream()
    .map(Order::customerId)
    .distinct()
    .toList();
```

Restricted:

```java
List<Customer> uniqueCustomers = customers.stream()
    .distinct()
    .toList();
```

Only allowed if `Customer.equals/hashCode` is correct for desired identity.

### 13.2 Distinct by Key

Do not invent stateful predicates casually.

Restricted:

```java
Set<String> seen = ConcurrentHashMap.newKeySet();
List<Customer> result = customers.stream()
    .filter(customer -> seen.add(customer.email()))
    .toList();
```

Prefer explicit loop for clarity:

```java
Map<String, Customer> byEmail = new LinkedHashMap<>();
for (Customer customer : customers) {
    byEmail.putIfAbsent(customer.email(), customer);
}
List<Customer> result = List.copyOf(byEmail.values());
```

For Java 25+, consider `Gatherers` only if the project explicitly allows them and the abstraction is tested.

---

## 14. Collection Result Semantics

### 14.1 `Stream.toList()`

`Stream.toList()` returns an unmodifiable list in Java 16+.

Allowed:

```java
List<CustomerDto> result = customers.stream()
    .map(CustomerDto::from)
    .toList();
```

Only if callers must not mutate the result.

Forbidden:

```java
List<CustomerDto> result = customers.stream()
    .map(CustomerDto::from)
    .toList();
result.add(extraCustomer);
```

### 14.2 `Collectors.toList()`

`Collectors.toList()` does not guarantee type, mutability, serializability, or thread-safety.

Do not rely on it returning `ArrayList`.

If mutable list is required:

```java
List<CustomerDto> result = customers.stream()
    .map(CustomerDto::from)
    .collect(Collectors.toCollection(ArrayList::new));
```

If immutable list is required in Java 11:

```java
List<CustomerDto> result = customers.stream()
    .map(CustomerDto::from)
    .collect(Collectors.toUnmodifiableList());
```

### 14.3 `toSet()`

Do not use `Collectors.toSet()` if order or set implementation matters.

Preferred when order matters:

```java
Set<String> codes = items.stream()
    .map(Item::code)
    .collect(Collectors.toCollection(LinkedHashSet::new));
```

Preferred when sorted:

```java
Set<String> codes = items.stream()
    .map(Item::code)
    .collect(Collectors.toCollection(TreeSet::new));
```

### 14.4 `toMap()`

`toMap()` must define duplicate-key behavior unless uniqueness is proven and tested.

Forbidden:

```java
Map<String, User> byEmail = users.stream()
    .collect(Collectors.toMap(User::email, Function.identity()));
```

Allowed if duplicate means error and test covers it:

```java
Map<String, User> byEmail = users.stream()
    .collect(Collectors.toUnmodifiableMap(
        User::email,
        Function.identity()
    ));
```

Allowed with explicit merge:

```java
Map<String, User> byEmail = users.stream()
    .collect(Collectors.toMap(
        User::email,
        Function.identity(),
        (first, ignored) -> first,
        LinkedHashMap::new
    ));
```

---

## 15. Collector Rules

### 15.1 Collector Selection

| Desired Result               | Preferred Collector                                         |
| ---------------------------- | ----------------------------------------------------------- |
| Unmodifiable list Java 17+   | `stream.toList()`                                           |
| Unmodifiable list Java 11    | `Collectors.toUnmodifiableList()`                           |
| Mutable `ArrayList`          | `Collectors.toCollection(ArrayList::new)`                   |
| Ordered set                  | `Collectors.toCollection(LinkedHashSet::new)`               |
| Sorted set                   | `Collectors.toCollection(TreeSet::new)`                     |
| Map with duplicate rejection | `toUnmodifiableMap` with duplicate test                     |
| Map with merge               | `toMap(key, value, merge, mapSupplier)`                     |
| Grouping                     | `groupingBy` with map/downstream if needed                  |
| Concurrent grouping          | `groupingByConcurrent` only in parallel/unordered scenarios |
| String joining               | `joining(delimiter)`                                        |
| Statistics                   | primitive summarizing collectors                            |

### 15.2 Grouping Rules

Simple grouping:

```java
Map<Status, List<CaseFile>> byStatus = cases.stream()
    .collect(Collectors.groupingBy(CaseFile::status));
```

If order matters, specify map supplier:

```java
Map<Status, List<CaseFile>> byStatus = cases.stream()
    .collect(Collectors.groupingBy(
        CaseFile::status,
        LinkedHashMap::new,
        Collectors.toList()
    ));
```

If downstream mutability matters, specify it:

```java
Map<Status, List<CaseFile>> byStatus = cases.stream()
    .collect(Collectors.groupingBy(
        CaseFile::status,
        Collectors.collectingAndThen(Collectors.toList(), List::copyOf)
    ));
```

### 15.3 Custom Collector Policy

Custom collectors are restricted.

Before creating one, prove that built-in collectors, an explicit loop, or a small accumulator object is insufficient.

A custom collector must define:

1. supplier;
2. accumulator;
3. combiner;
4. finisher;
5. characteristics;
6. sequential behavior;
7. parallel behavior or explicit non-parallel policy;
8. tests for empty, one, many, duplicate, ordered, and parallel cases if parallel-compatible.

### 15.4 Collector Characteristics

Do not set `CONCURRENT`, `UNORDERED`, or `IDENTITY_FINISH` unless the contract is fully satisfied.

Incorrect collector characteristics can corrupt results, especially with parallel streams.

---

## 16. Reduction Rules

### 16.1 Prefer Specialized Operations

Prefer:

```java
int total = items.stream()
    .mapToInt(Item::quantity)
    .sum();
```

over:

```java
int total = items.stream()
    .map(Item::quantity)
    .reduce(0, Integer::sum);
```

### 16.2 Reduction Identity Must Be Neutral

The identity value must be neutral.

Allowed:

```java
int sum = values.stream().reduce(0, Integer::sum);
```

Forbidden:

```java
int sum = values.parallelStream().reduce(1, Integer::sum);
```

because `1` is not neutral for addition.

### 16.3 Associativity

Reduction operation must be associative, especially for parallel streams.

Forbidden:

```java
int value = values.parallelStream()
    .reduce(0, (a, b) -> a - b);
```

Subtraction is not associative.

### 16.4 BigDecimal Reduction

For money/decimal:

```java
BigDecimal total = invoices.stream()
    .map(Invoice::amount)
    .reduce(BigDecimal.ZERO, BigDecimal::add);
```

Do not use `double` for money.

---

## 17. Primitive Streams

Use primitive streams for numeric aggregation to avoid boxing.

Allowed:

```java
double average = measurements.stream()
    .mapToDouble(Measurement::value)
    .average()
    .orElse(0.0);
```

Avoid:

```java
Double average = measurements.stream()
    .map(Measurement::value)
    .reduce(0.0, Double::sum) / measurements.size();
```

Rules:

1. use `IntStream`, `LongStream`, `DoubleStream` for primitive-heavy operations;
2. avoid boxing/unboxing in hot paths;
3. handle empty aggregates explicitly;
4. use `summaryStatistics()` when multiple metrics are needed;
5. do not use `DoubleStream` for exact decimal/money.

---

## 18. Infinite and Generated Streams

### 18.1 Infinite Streams Must Be Bounded

Forbidden:

```java
Stream.iterate(0, n -> n + 1)
    .map(this::calculate)
    .toList();
```

Allowed:

```java
List<Integer> firstTen = Stream.iterate(0, n -> n + 1)
    .limit(10)
    .toList();
```

### 18.2 Java 9+ Bounded Iterate

Preferred when a termination condition exists:

```java
List<Integer> values = Stream.iterate(0, n -> n < 10, n -> n + 1)
    .toList();
```

### 18.3 Random Streams

Random streams must be bounded and deterministic in tests.

Allowed:

```java
Random random = new Random(seed);
List<Integer> values = random.ints(100, 0, 10)
    .boxed()
    .toList();
```

Do not use non-deterministic random generation in unit tests.

---

## 19. Resource-Backed Streams

### 19.1 Mandatory Closure

Streams backed by files, directories, sockets, or other I/O resources must be closed with try-with-resources.

Allowed:

```java
try (Stream<String> lines = Files.lines(path, StandardCharsets.UTF_8)) {
    return lines
        .filter(line -> !line.isBlank())
        .count();
}
```

Forbidden:

```java
return Files.lines(path).count();
```

### 19.2 Do Not Return Resource-Backed Stream

Forbidden:

```java
public Stream<String> readLines(Path path) throws IOException {
    return Files.lines(path, StandardCharsets.UTF_8);
}
```

Preferred:

```java
public long countNonBlankLines(Path path) throws IOException {
    try (Stream<String> lines = Files.lines(path, StandardCharsets.UTF_8)) {
        return lines.filter(line -> !line.isBlank()).count();
    }
}
```

or callback ownership:

```java
public <T> T withLines(Path path, Function<Stream<String>, T> reader) throws IOException {
    try (Stream<String> lines = Files.lines(path, StandardCharsets.UTF_8)) {
        return reader.apply(lines);
    }
}
```

### 19.3 Directory Streams

`Files.list`, `Files.walk`, and similar APIs must also be closed.

Allowed:

```java
try (Stream<Path> paths = Files.walk(root)) {
    return paths
        .filter(Files::isRegularFile)
        .toList();
}
```

For large directory trees, avoid collecting all paths unless bounded.

---

## 20. Exception Handling

### 20.1 Checked Exceptions in Lambdas

Do not hide checked exceptions with generic runtime wrappers without context.

Forbidden:

```java
List<String> values = paths.stream()
    .map(path -> {
        try {
            return Files.readString(path);
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    })
    .toList();
```

Preferred loop:

```java
List<String> values = new ArrayList<>(paths.size());
for (Path path : paths) {
    try {
        values.add(Files.readString(path, StandardCharsets.UTF_8));
    } catch (IOException e) {
        throw new FileReadException("Failed to read file: " + path, e);
    }
}
```

### 20.2 Partial Failure Policy

If stream processing can partially fail, define behavior:

1. fail-fast;
2. collect successes and errors;
3. skip invalid with audit;
4. retry;
5. dead-letter.

Do not bury this inside a stream pipeline.

### 20.3 Validation Failures

Validation pipelines are allowed if they produce explicit error objects.

Allowed:

```java
List<ValidationError> errors = validators.stream()
    .map(validator -> validator.validate(command))
    .flatMap(List::stream)
    .toList();
```

Only if validators are pure and do not mutate command state.

---

## 21. Parallel Stream Policy

### 21.1 Forbidden by Default

`parallelStream()` and `.parallel()` are forbidden by default in application/server code.

Reasons:

1. implicit use of common pool;
2. unclear thread ownership;
3. blocking I/O can starve unrelated work;
4. database/network calls are not automatically safe to parallelize;
5. transaction/security/request context may not propagate;
6. ordering becomes harder to reason about;
7. performance depends on data size, spliterator, CPU, and workload shape.

### 21.2 Allowed Only With Approval

Parallel streams require an approved note:

```text
Parallel stream justification:
- Workload type: CPU-bound / no blocking I/O
- Data size:
- Source spliterator quality:
- Shared state: none
- Collector parallel safety:
- Ordering requirement:
- Pool impact:
- Benchmark result:
- Fallback strategy:
```

### 21.3 Never Use Parallel Stream For

1. JDBC/JPA operations;
2. HTTP calls;
3. file writes;
4. audit writes;
5. request-scoped transactions;
6. security-context-dependent work;
7. non-thread-safe mappers/formatters;
8. mutable shared collectors;
9. small collections where overhead dominates.

### 21.4 Prefer Explicit Concurrency

If concurrency is required, use explicit concurrency standards:

- Java 11/17: bounded `ExecutorService`;
- Java 21+: virtual threads for high-concurrency blocking I/O;
- Java 25+: scoped values only for immutable context if approved;
- structured concurrency only if preview policy permits it.

---

## 22. Ordering, Short-Circuiting, and Terminal Operations

### 22.1 `findFirst` vs `findAny`

Use `findFirst` only when encounter order matters.

```java
Optional<Order> oldest = orders.stream()
    .sorted(Comparator.comparing(Order::createdAt))
    .findFirst();
```

Use `findAny` when any match is sufficient.

```java
Optional<Order> anyFailed = orders.stream()
    .filter(Order::isFailed)
    .findAny();
```

### 22.2 `anyMatch`, `allMatch`, `noneMatch`

Use match operations for boolean checks.

Preferred:

```java
boolean hasExpired = subscriptions.stream()
    .anyMatch(Subscription::isExpired);
```

Avoid:

```java
boolean hasExpired = subscriptions.stream()
    .filter(Subscription::isExpired)
    .count() > 0;
```

### 22.3 `limit` and `skip`

`limit` and `skip` depend on encounter order when source is ordered.

For pagination, prefer database-level pagination, not stream-level slicing after loading all records.

Forbidden for large database result already loaded:

```java
repository.findAll().stream()
    .skip(offset)
    .limit(limit)
    .toList();
```

Preferred:

```java
repository.findPage(offset, limit);
```

---

## 23. Streams and Persistence

### 23.1 Do Not Hide N+1 Queries

Forbidden:

```java
List<OrderDto> dtos = orders.stream()
    .map(order -> new OrderDto(order.id(), order.customer().name()))
    .toList();
```

if `order.customer()` is lazy-loaded and triggers N+1 queries.

Required:

1. fetch plan explicit;
2. DTO projection preferred;
3. test/query count or profiling for N+1 risk;
4. transaction boundary clear.

### 23.2 Do Not Stream Over Managed Entities For Mutation

Forbidden:

```java
orders.stream()
    .filter(Order::isExpired)
    .forEach(Order::cancel);
```

inside unclear transaction boundary.

Preferred:

```java
for (Order order : orders) {
    if (order.isExpired()) {
        order.cancel(clock.instant());
    }
}
```

or bulk update when business rules allow it.

### 23.3 Repository Stream Return

Repositories returning `Stream<T>` are restricted.

If a repository returns a stream:

1. caller must close it;
2. transaction must remain open for consumption;
3. lazy loading policy must be explicit;
4. method name must indicate stream ownership.

Preferred:

```java
void forEachOpenCase(Consumer<CaseProjection> consumer);
```

or chunked processing:

```java
Page<CaseProjection> findOpenCases(PageRequest pageRequest);
```

---

## 24. Streams and API/DTO Mapping

### 24.1 DTO Mapping Is Allowed

Allowed:

```java
List<CaseDto> dtos = cases.stream()
    .map(caseMapper::toDto)
    .toList();
```

Only if mapper is pure and does not perform database/network lookup.

### 24.2 Avoid Stream Mapping With Context Mutation

Forbidden:

```java
List<CaseDto> dtos = cases.stream()
    .map(caseFile -> caseMapper.toDto(caseFile, responseContext.addLink(...)))
    .toList();
```

Separate context construction from pure mapping.

---

## 25. Streams and Security

### 25.1 Validation Pipelines

Validation pipelines must not short-circuit accidentally if all errors are required.

Allowed all-errors:

```java
List<ValidationError> errors = rules.stream()
    .map(rule -> rule.validate(command))
    .flatMap(Collection::stream)
    .toList();
```

Allowed fail-fast:

```java
Optional<ValidationError> firstError = rules.stream()
    .map(rule -> rule.validateOne(command))
    .flatMap(Optional::stream)
    .findFirst();
```

The choice must be explicit.

### 25.2 Do Not Log Secrets in Pipelines

Forbidden:

```java
tokens.stream()
    .peek(token -> log.debug("token={}", token))
    .map(this::hash)
    .toList();
```

### 25.3 Injection Boundaries

Streams do not make string construction safe.

Forbidden:

```java
String sql = ids.stream()
    .map(id -> "'" + id + "'")
    .collect(Collectors.joining(",", "select * from user where id in (", ")"));
```

Use bind parameters or framework-safe APIs.

---

## 26. Streams and Logging/Observability

### 26.1 Avoid Per-Element Logging for Large Streams

Per-element logging can create huge logs and distort performance.

Allowed only at debug/trace with bounded data:

```java
orders.stream()
    .limit(10)
    .forEach(order -> log.debug("Sample orderId={}", order.id()));
```

### 26.2 Metrics

Do not update metrics inside intermediate operations unless the metric is explicitly terminal-observation behavior.

Preferred:

```java
List<OrderDto> result = orders.stream()
    .filter(Order::isActive)
    .map(OrderDto::from)
    .toList();
metrics.recordActiveOrderCount(result.size());
```

---

## 27. Performance Rules

### 27.1 Streams Are Not Automatically Faster

Streams are for clarity. Performance-sensitive code requires measurement.

A reviewer may reject streams in hot paths if:

1. allocation is excessive;
2. boxing is avoidable;
3. pipeline hides repeated expensive work;
4. a loop is simpler and faster;
5. JMH or realistic benchmark shows regression.

### 27.2 Avoid Multiple Traversals

Forbidden:

```java
long activeCount = users.stream().filter(User::isActive).count();
List<UserDto> activeDtos = users.stream().filter(User::isActive).map(UserDto::from).toList();
```

Preferred:

```java
List<UserDto> activeDtos = users.stream()
    .filter(User::isActive)
    .map(UserDto::from)
    .toList();
long activeCount = activeDtos.size();
```

or use a collector if both original and transformed values are required.

### 27.3 Avoid Repeated Computation

Forbidden:

```java
items.stream()
    .filter(item -> expensiveScore(item) > 50)
    .sorted(Comparator.comparing(this::expensiveScore))
    .toList();
```

Preferred:

```java
record ScoredItem(Item item, int score) {}

List<Item> result = items.stream()
    .map(item -> new ScoredItem(item, expensiveScore(item)))
    .filter(scored -> scored.score() > 50)
    .sorted(Comparator.comparingInt(ScoredItem::score))
    .map(ScoredItem::item)
    .toList();
```

### 27.4 Avoid Boxing in Numeric Hot Paths

Prefer primitive streams or loops.

### 27.5 Avoid Collecting Large Streams

If result can be huge, use:

1. iterator/cursor;
2. pagination;
3. batch writer;
4. streaming response;
5. bounded aggregation;
6. database-side aggregation.

---

## 28. Readability Rules

### 28.1 Pipeline Length

A stream pipeline should usually have no more than 3 to 5 intermediate operations.

If longer, extract named methods or use a loop.

### 28.2 Lambda Size

Lambda bodies should usually be expression lambdas.

Allowed:

```java
.filter(caseFile -> caseFile.ageDays(clock) > escalationThresholdDays)
```

Restricted:

```java
.map(caseFile -> {
    var status = calculateStatus(caseFile);
    var owner = resolveOwner(caseFile);
    var dueDate = calculateDueDate(caseFile);
    return new CaseDto(caseFile.id(), status, owner, dueDate);
})
```

Prefer named mapper method.

### 28.3 Method References

Method references are allowed only when they are clear.

Good:

```java
.map(Customer::id)
```

Less clear:

```java
.map(this::apply)
```

If method name is vague, use a descriptive lambda or rename method.

### 28.4 Avoid Cleverness

Do not compress logic into a stream to reduce lines of code.

Readable loops beat clever pipelines.

---

## 29. Stream Gatherers Java 25+

### 29.1 Status

`Gatherer` and `Gatherers` are available from Java 24 and therefore available in Java 25 codebases.

They are forbidden in Java 11/17/21 baselines.

### 29.2 Restricted Use

Use built-in gatherers only when they clearly simplify an operation that would otherwise require unsafe stateful stream hacks.

Allowed Java 25+ example:

```java
List<List<Event>> windows = events.stream()
    .gather(Gatherers.windowFixed(100))
    .toList();
```

Only if:

1. baseline is Java 25 or Java 24+;
2. the team accepts gatherers;
3. input size and output size are bounded;
4. tests cover empty, partial, and exact windows.

### 29.3 Custom Gatherers

Custom gatherers are highly restricted.

A custom gatherer must include:

1. design note;
2. state model;
3. ordering behavior;
4. finisher behavior;
5. short-circuit behavior if any;
6. parallel behavior or explicit sequential-only contract;
7. tests against loop equivalent.

If unsure, use an explicit loop.

---

## 30. Anti-Patterns

### 30.1 Stream for Everything

Bad:

```java
request.getItems().stream()
    .filter(i -> validate(i))
    .map(i -> enrich(i))
    .map(i -> repository.save(i))
    .forEach(i -> publisher.publish(i));
```

This hides validation, enrichment, persistence, and publication boundaries.

### 30.2 Side-Effect Collector

Bad:

```java
orders.stream()
    .collect(Collectors.toMap(
        Order::id,
        order -> repository.save(order)
    ));
```

### 30.3 Stateful Predicate

Bad:

```java
Set<String> seen = new HashSet<>();
users.stream()
    .filter(user -> seen.add(user.email()))
    .toList();
```

Use explicit loop or tested abstraction.

### 30.4 Parallel Stream with Blocking I/O

Bad:

```java
urls.parallelStream()
    .map(httpClient::get)
    .toList();
```

Use explicit concurrency with timeout, limit, cancellation, and backpressure.

### 30.5 Stream as Null-Safety Blanket

Bad:

```java
Optional.ofNullable(order)
    .stream()
    .map(Order::customer)
    .map(Customer::email)
    .findFirst();
```

This hides whether null is valid. Prefer explicit validation or domain invariant.

---

## 31. Testing Requirements

Stream-heavy logic must include tests for:

1. empty source;
2. singleton source;
3. multiple values;
4. duplicate values;
5. null source if boundary allows it;
6. null elements if boundary allows them;
7. order-sensitive input;
8. unordered source if applicable;
9. duplicate keys for `toMap`;
10. empty aggregate;
11. exceptions from mapper/predicate if possible;
12. large input if performance/memory matters;
13. resource closure for I/O-backed streams;
14. mutability of returned collection;
15. parallel behavior only if parallel stream or concurrent collector is approved.

### 31.1 Mutability Test Example

```java
@Test
void resultIsUnmodifiable() {
    List<String> result = service.names();

    assertThrows(UnsupportedOperationException.class, () -> result.add("new"));
}
```

### 31.2 Duplicate Key Test Example

```java
@Test
void rejectsDuplicateEmail() {
    List<User> users = List.of(
        new User("a@example.test"),
        new User("a@example.test")
    );

    assertThrows(IllegalStateException.class, () -> service.indexByEmail(users));
}
```

---

## 32. Reviewer Checklist

A reviewer must reject stream code if any answer is unclear:

- [ ] Is stream usage clearer than a loop?
- [ ] Is the source finite and bounded?
- [ ] Is null policy explicit?
- [ ] Are lambdas stateless and non-interfering?
- [ ] Are there any hidden side effects in `map`, `filter`, `peek`, or collectors?
- [ ] Is `peek` used only for non-essential diagnostics?
- [ ] Is `forEach` used only as a terminal side-effect boundary?
- [ ] Is ordering intentional and tested?
- [ ] Is `sorted`, `distinct`, `limit`, or `skip` cost acceptable?
- [ ] Does `toMap` define duplicate-key behavior?
- [ ] Is result mutability intentional?
- [ ] Is `Stream.toList()` only used when unmodifiable result is acceptable?
- [ ] Is `Collectors.toList()` not relied on for mutability/type?
- [ ] Are resource-backed streams closed?
- [ ] Are checked exceptions handled with context?
- [ ] Is `parallelStream` absent or approved with benchmark and safety note?
- [ ] Are database/network/file side effects not hidden inside stream operations?
- [ ] Are primitive streams used where numeric boxing matters?
- [ ] Are tests covering empty, duplicate, order, null, and error cases?

---

## 33. Prompt Contract for LLM Code Agents

Use this instruction when asking an LLM to implement or review Java stream code:

```text
You are implementing Java Stream API code under strict standards.

Mandatory rules:
- Use streams only when they improve clarity over loops.
- Keep stream lambdas stateless and non-interfering.
- Do not mutate stream source or external state inside map/filter/flatMap/peek/forEach/collect lambdas.
- Do not use peek for business logic.
- Do not hide DB, network, file write, transaction, audit, or blocking operations inside stream transformations.
- Do not use parallelStream unless explicitly approved with CPU-bound benchmark and collector safety.
- Close resource-backed streams with try-with-resources.
- Make result mutability explicit: Stream.toList() is unmodifiable; Collectors.toList() has no mutability/type guarantee.
- Define duplicate-key behavior for toMap.
- Use primitive streams for numeric aggregation when appropriate.
- State ordering, null policy, error policy, result mutability, and tests before coding.

If the pipeline becomes hard to read or contains side effects, replace it with an explicit loop.
```

---

## 34. References

- Java SE 21 `Stream` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/stream/Stream.html
- Java SE 11 `Stream` API: https://docs.oracle.com/en/java/javase/11/docs/api/java.base/java/util/stream/Stream.html
- Java SE 21 `Collectors` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/stream/Collectors.html
- Java SE `Collector.Characteristics`: https://docs.oracle.com/javase/8/docs/api/java/util/stream/Collector.Characteristics.html
- Java SE 21 `IntStream` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/stream/IntStream.html
- Java SE 21 `StreamSupport` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/stream/StreamSupport.html
- Java SE 17 `Files` API: https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/nio/file/Files.html
- Java Tutorials — Try-with-resources: https://docs.oracle.com/javase/tutorial/essential/exceptions/tryResourceClose.html
- Oracle Java Tutorial — Parallelism and Streams: https://docs.oracle.com/javase/tutorial/collections/streams/parallelism.html
- JEP 485 — Stream Gatherers: https://openjdk.org/jeps/485
- Java SE 25 `Gatherers` API: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Gatherers.html
