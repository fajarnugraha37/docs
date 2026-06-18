# learn-java-collections-and-streams-part-044.md

# Java Collections and Streams — Part 044  
# `mapMulti` Deep Dive: Zero-or-More Mapping, `flatMap` Alternative, Type Inference, Primitive Variants, Null Handling, Recursive Expansion, Performance Trade-Offs, and Production Patterns

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **044**  
> Fokus: memahami `mapMulti` secara mendalam: apa bedanya dengan `map`, `filter`, dan `flatMap`; kapan lebih jelas/lebih efisien; bagaimana memakai downstream `Consumer`; bagaimana type inference bekerja; bagaimana primitive variants `mapMultiToInt`, `mapMultiToLong`, `mapMultiToDouble`; serta failure modes production seperti side effect, null, ordering, dan over-complex lambda.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: `mapMulti` = One Input, Zero-or-More Outputs](#2-mental-model-mapmulti--one-input-zero-or-more-outputs)
3. [`map` vs `filter` vs `flatMap` vs `mapMulti`](#3-map-vs-filter-vs-flatmap-vs-mapmulti)
4. [Basic Syntax](#4-basic-syntax)
5. [The Downstream Consumer](#5-the-downstream-consumer)
6. [Emit Zero Elements](#6-emit-zero-elements)
7. [Emit One Element](#7-emit-one-element)
8. [Emit Many Elements](#8-emit-many-elements)
9. [Replacing `filter` + `map`](#9-replacing-filter--map)
10. [Replacing `flatMap` for Small Fan-Out](#10-replacing-flatmap-for-small-fan-out)
11. [Flattening Nested Collections](#11-flattening-nested-collections)
12. [Null Handling with `mapMulti`](#12-null-handling-with-mapmulti)
13. [Optional Flattening](#13-optional-flattening)
14. [Type Inference and Explicit Type Witness](#14-type-inference-and-explicit-type-witness)
15. [Primitive Variants](#15-primitive-variants)
16. [`mapMultiToInt`](#16-mapmultitoint)
17. [`mapMultiToLong`](#17-mapmultitolong)
18. [`mapMultiToDouble`](#18-mapmultitodouble)
19. [Recursive Expansion](#19-recursive-expansion)
20. [Tree Traversal Example](#20-tree-traversal-example)
21. [Parsing and Conditional Emission](#21-parsing-and-conditional-emission)
22. [Validation Result Flattening](#22-validation-result-flattening)
23. [Event Expansion](#23-event-expansion)
24. [Performance Model](#24-performance-model)
25. [Default Implementation and `flatMap` Relationship](#25-default-implementation-and-flatmap-relationship)
26. [When `flatMap` Is Still Better](#26-when-flatmap-is-still-better)
27. [When `mapMulti` Is Better](#27-when-mapmulti-is-better)
28. [Ordering Semantics](#28-ordering-semantics)
29. [Parallel Stream Considerations](#29-parallel-stream-considerations)
30. [Side Effects and Consumer Misuse](#30-side-effects-and-consumer-misuse)
31. [Exception Handling](#31-exception-handling)
32. [Readability and Lambda Size](#32-readability-and-lambda-size)
33. [Testing `mapMulti`](#33-testing-mapmulti)
34. [Common Anti-Patterns](#34-common-anti-patterns)
35. [Production Failure Modes](#35-production-failure-modes)
36. [Best Practices](#36-best-practices)
37. [Decision Matrix](#37-decision-matrix)
38. [Latihan](#38-latihan)
39. [Ringkasan](#39-ringkasan)
40. [Referensi](#40-referensi)

---

# 1. Tujuan Bagian Ini

`mapMulti` diperkenalkan sebagai intermediate operation yang memungkinkan satu input element menghasilkan **zero, one, or many output elements** tanpa harus membuat stream baru untuk setiap element seperti pada `flatMap`.

Contoh:

```java
List<String> emails = users.stream()
    .<String>mapMulti((user, downstream) -> {
        String email = user.email();
        if (email != null) {
            downstream.accept(email);
        }
    })
    .toList();
```

Pipeline di atas berarti:

```text
Untuk setiap user:
  jika email tidak null, emit email
  jika email null, emit nothing
```

`mapMulti` sering berguna untuk:

- mengganti `filter + map` dalam satu stage;
- mengganti `flatMap` saat fan-out kecil;
- menghindari pembuatan banyak small streams;
- null-safe extraction;
- flatten optional/nested values;
- recursive expansion;
- primitive zero-or-more mapping;
- conditional emission.

Namun `mapMulti` juga bisa membuat code lebih imperative dan sulit dibaca jika dipakai berlebihan.

Tujuan bagian ini:

- memahami mental model `mapMulti`;
- membedakan dengan `map`, `filter`, dan `flatMap`;
- memahami type inference;
- memakai primitive variants;
- memahami performance trade-off;
- membuat production-safe patterns.

---

# 2. Mental Model: `mapMulti` = One Input, Zero-or-More Outputs

`mapMulti` menerima mapper yang diberi:

```text
input element
downstream consumer
```

Mapper boleh memanggil:

```java
downstream.accept(output)
```

sebanyak:

```text
0 kali
1 kali
banyak kali
```

## 2.1 Conceptual loop

```java
for (T item : source) {
    mapper.accept(item, downstream);
}
```

## 2.2 Example

```java
Stream.of(1, 2, 3)
    .<Integer>mapMulti((n, out) -> {
        out.accept(n);
        out.accept(n * 10);
    })
    .toList();
```

Output:

```text
1, 10, 2, 20, 3, 30
```

## 2.3 Main rule

```text
mapMulti is manual zero-or-more emission per input element.
```

---

# 3. `map` vs `filter` vs `flatMap` vs `mapMulti`

## 3.1 `map`

One input -> exactly one output.

```java
.map(User::email)
```

## 3.2 `filter`

One input -> either same input or no input.

```java
.filter(User::active)
```

## 3.3 `flatMap`

One input -> stream of zero-or-more outputs.

```java
.flatMap(order -> order.lines().stream())
```

## 3.4 `mapMulti`

One input -> manually emit zero-or-more outputs.

```java
.<OrderLine>mapMulti((order, out) -> {
    for (OrderLine line : order.lines()) {
        out.accept(line);
    }
})
```

## 3.5 Rule

Use `mapMulti` when manual emission is clearer or avoids unnecessary small streams.

---

# 4. Basic Syntax

Signature conceptually:

```java
<R> Stream<R> mapMulti(BiConsumer<? super T, ? super Consumer<R>> mapper)
```

Example:

```java
List<String> result = users.stream()
    .<String>mapMulti((user, out) -> {
        if (user.active()) {
            out.accept(user.email());
        }
    })
    .toList();
```

## 4.1 Why `<String>` before `mapMulti`?

Sometimes Java type inference needs help.

```java
.<String>mapMulti(...)
```

is explicit type witness.

## 4.2 Rule

If compiler infers `Object`, provide explicit target type.

---

# 5. The Downstream Consumer

The second parameter is a consumer for emitted output elements.

```java
(user, downstream) -> {
    downstream.accept(user.email());
}
```

## 5.1 Important

The downstream consumer is not a collection you own.

Do not store it for later.

Do not use it asynchronously.

## 5.2 Correct lifecycle

Call it synchronously inside mapper.

## 5.3 Rule

Treat downstream consumer as a temporary emission channel valid only during mapper invocation.

---

# 6. Emit Zero Elements

To emit nothing, simply do not call `accept`.

```java
List<String> activeEmails = users.stream()
    .<String>mapMulti((user, out) -> {
        if (user.active() && user.email() != null) {
            out.accept(user.email());
        }
    })
    .toList();
```

Inactive or no-email users emit zero outputs.

## 6.1 Rule

No `accept` call means zero output elements.

---

# 7. Emit One Element

```java
List<String> emails = users.stream()
    .<String>mapMulti((user, out) -> {
        out.accept(user.email());
    })
    .toList();
```

This is equivalent to `map(User::email)` but more verbose.

## 7.1 Do not use mapMulti for simple map

Prefer:

```java
.map(User::email)
```

## 7.2 Rule

If every input always produces exactly one output, use `map`.

---

# 8. Emit Many Elements

```java
List<OrderLine> lines = orders.stream()
    .<OrderLine>mapMulti((order, out) -> {
        for (OrderLine line : order.lines()) {
            out.accept(line);
        }
    })
    .toList();
```

Equivalent idea:

```java
orders.stream()
    .flatMap(order -> order.lines().stream())
    .toList();
```

## 8.1 Rule

Use `mapMulti` for many outputs when manual emission is simpler or more efficient.

---

# 9. Replacing `filter` + `map`

Traditional:

```java
List<String> emails = users.stream()
    .filter(User::active)
    .map(User::email)
    .filter(Objects::nonNull)
    .toList();
```

With `mapMulti`:

```java
List<String> emails = users.stream()
    .<String>mapMulti((user, out) -> {
        if (user.active()) {
            String email = user.email();
            if (email != null) {
                out.accept(email);
            }
        }
    })
    .toList();
```

## 9.1 Which is better?

The traditional version is more declarative.

`mapMulti` can be better when:

- conditions are tightly coupled;
- you want avoid intermediate nullable stream;
- output emission is conditional and custom;
- performance hot path measured.

## 9.2 Rule

Do not replace clean filter+map with mapMulti unless it improves clarity or measured performance.

---

# 10. Replacing `flatMap` for Small Fan-Out

`flatMap`:

```java
List<String> tokens = lines.stream()
    .flatMap(line -> Arrays.stream(line.split(",")))
    .toList();
```

`mapMulti`:

```java
List<String> tokens = lines.stream()
    .<String>mapMulti((line, out) -> {
        for (String token : line.split(",")) {
            out.accept(token);
        }
    })
    .toList();
```

## 10.1 Benefit

Avoids creating a small stream per line.

## 10.2 But note

`line.split(",")` still allocates array. If optimizing seriously, use parser.

## 10.3 Rule

`mapMulti` can avoid per-element stream creation, but it does not eliminate all allocations automatically.

---

# 11. Flattening Nested Collections

FlatMap version:

```java
List<OrderLine> lines = orders.stream()
    .flatMap(order -> order.lines().stream())
    .toList();
```

mapMulti version:

```java
List<OrderLine> lines = orders.stream()
    .<OrderLine>mapMulti((order, out) -> {
        for (OrderLine line : order.lines()) {
            out.accept(line);
        }
    })
    .toList();
```

## 11.1 Which is clearer?

For simple nested collection flattening, `flatMap` is often more idiomatic.

## 11.2 mapMulti better when null/conditional logic involved

```java
List<OrderLine> lines = orders.stream()
    .<OrderLine>mapMulti((order, out) -> {
        List<OrderLine> orderLines = order.lines();
        if (orderLines != null) {
            for (OrderLine line : orderLines) {
                if (!line.cancelled()) {
                    out.accept(line);
                }
            }
        }
    })
    .toList();
```

## 11.3 Rule

Use flatMap for clean flattening; mapMulti for conditional/custom flattening.

---

# 12. Null Handling with `mapMulti`

## 12.1 Nullable field extraction

```java
List<String> emails = users.stream()
    .<String>mapMulti((user, out) -> {
        String email = user.email();
        if (email != null) {
            out.accept(email);
        }
    })
    .toList();
```

## 12.2 Nullable nested collection

```java
List<OrderLine> lines = orders.stream()
    .<OrderLine>mapMulti((order, out) -> {
        List<OrderLine> orderLines = order.lines();
        if (orderLines == null) {
            return;
        }
        orderLines.forEach(out);
    })
    .toList();
```

## 12.3 Compare with `Stream.ofNullable`

```java
users.stream()
    .flatMap(user -> Stream.ofNullable(user.email()))
    .toList();
```

## 12.4 Rule

`mapMulti` is useful when null check and emission logic are naturally tied together.

---

# 13. Optional Flattening

Traditional:

```java
List<User> found = ids.stream()
    .map(repository::findById) // Optional<User>
    .flatMap(Optional::stream)
    .toList();
```

With `mapMulti`:

```java
List<User> found = ids.stream()
    .<User>mapMulti((id, out) ->
        repository.findById(id).ifPresent(out)
    )
    .toList();
```

## 13.1 Which is better?

`flatMap(Optional::stream)` is idiomatic and concise.

`mapMulti` is okay if more logic is needed:

```java
ids.stream()
    .<User>mapMulti((id, out) -> {
        repository.findById(id)
            .filter(User::active)
            .ifPresent(out);
    })
```

## 13.2 Rule

For simple Optional flattening, `flatMap(Optional::stream)` is usually clearer.

---

# 14. Type Inference and Explicit Type Witness

Sometimes this:

```java
var result = users.stream()
    .mapMulti((user, out) -> out.accept(user.email()))
    .toList();
```

may infer `List<Object>` or fail depending context.

Use:

```java
List<String> result = users.stream()
    .<String>mapMulti((user, out) -> out.accept(user.email()))
    .toList();
```

## 14.1 Why

The mapper does not return `R`; it emits into `Consumer<R>`, so compiler sometimes needs target type.

## 14.2 Alternatives

Assign target type:

```java
Stream<String> stream = users.stream()
    .mapMulti((user, out) -> out.accept(user.email()));
```

But explicit type witness is often clearer.

## 14.3 Rule

When using `mapMulti`, be ready to provide explicit output type.

---

# 15. Primitive Variants

There are primitive variants:

```java
mapMultiToInt
mapMultiToLong
mapMultiToDouble
```

They avoid boxing when emitting primitive values.

## 15.1 Why important

Instead of:

```java
Stream<Integer>
```

use:

```java
IntStream
```

for numeric hot paths.

## 15.2 Rule

Use primitive `mapMulti` variants when output is primitive numeric and performance matters.

---

# 16. `mapMultiToInt`

Example: emit valid scores.

```java
int total = users.stream()
    .mapMultiToInt((user, out) -> {
        Integer score = user.score();
        if (score != null && score >= 0) {
            out.accept(score);
        }
    })
    .sum();
```

## 16.1 Avoids

- `Stream<Integer>`;
- boxing/unboxing;
- null unboxing NPE.

## 16.2 Rule

Use `mapMultiToInt` for zero-or-more int emission per object element.

---

# 17. `mapMultiToLong`

Example: order amounts from valid orders.

```java
long total = orders.stream()
    .mapMultiToLong((order, out) -> {
        if (order.paid()) {
            out.accept(order.amountInCents());
        }
    })
    .sum();
```

## 17.1 Nested long values

```java
long total = orders.stream()
    .mapMultiToLong((order, out) -> {
        for (OrderLine line : order.lines()) {
            out.accept(line.amountInCents());
        }
    })
    .sum();
```

## 17.2 Rule

Use `mapMultiToLong` for money-in-minor-units and counters when zero-or-more emission is needed.

---

# 18. `mapMultiToDouble`

Example:

```java
DoubleSummaryStatistics stats = sensors.stream()
    .mapMultiToDouble((sensor, out) -> {
        Double value = sensor.lastReading();
        if (value != null && !value.isNaN()) {
            out.accept(value);
        }
    })
    .summaryStatistics();
```

## 18.1 Floating caution

Double is approximate.

## 18.2 Rule

Use `mapMultiToDouble` for approximate numeric streams, not exact money.

---

# 19. Recursive Expansion

`mapMulti` can recursively emit elements.

Example use case:

```text
Given root nodes, emit all descendants.
```

## 19.1 Method extraction recommended

Do not put complex recursion inline.

```java
List<Node> all = roots.stream()
    .<Node>mapMulti((root, out) -> emitPreOrder(root, out))
    .toList();
```

Helper:

```java
void emitPreOrder(Node node, Consumer<Node> out) {
    out.accept(node);
    for (Node child : node.children()) {
        emitPreOrder(child, out);
    }
}
```

## 19.2 Rule

Recursive `mapMulti` should delegate to named helper for readability.

---

# 20. Tree Traversal Example

```java
record Node(String name, List<Node> children) {}

static void emitLeaves(Node node, Consumer<Node> out) {
    if (node.children().isEmpty()) {
        out.accept(node);
        return;
    }

    for (Node child : node.children()) {
        emitLeaves(child, out);
    }
}
```

Use:

```java
List<Node> leaves = roots.stream()
    .<Node>mapMulti((root, out) -> emitLeaves(root, out))
    .toList();
```

## 20.1 Caveat

Deep recursion can stack overflow.

## 20.2 Alternative

Use explicit stack loop.

## 20.3 Rule

For deep or untrusted trees, prefer iterative traversal.

---

# 21. Parsing and Conditional Emission

Suppose some lines are comments/blank/invalid.

```java
List<Record> records = lines.stream()
    .<Record>mapMulti((line, out) -> {
        if (line.isBlank() || line.startsWith("#")) {
            return;
        }

        parseOptional(line).ifPresent(out);
    })
    .toList();
```

## 21.1 But errors?

If invalid line should be reported, do not silently skip.

Use `Result` model.

## 21.2 Rule

Conditional emission is good only when skipped data is semantically ignorable.

---

# 22. Validation Result Flattening

Suppose each command can produce many validation errors.

```java
List<ValidationError> errors = commands.stream()
    .<ValidationError>mapMulti((command, out) -> {
        for (ValidationError error : validate(command)) {
            out.accept(error);
        }
    })
    .toList();
```

Equivalent:

```java
commands.stream()
    .flatMap(command -> validate(command).stream())
    .toList();
```

## 22.1 mapMulti advantage

Avoids creating stream for each validation result collection.

## 22.2 Rule

For many small collections, `mapMulti` can be a good flattening tool.

---

# 23. Event Expansion

One domain event may expand into multiple integration events.

```java
List<IntegrationEvent> events = domainEvents.stream()
    .<IntegrationEvent>mapMulti((event, out) -> {
        switch (event) {
            case OrderPaid paid -> {
                out.accept(new InvoiceRequested(paid.orderId()));
                out.accept(new LoyaltyPointsRequested(paid.customerId()));
            }
            case OrderCancelled cancelled -> {
                out.accept(new RefundRequested(cancelled.orderId()));
            }
            default -> {
                // emit nothing
            }
        }
    })
    .toList();
```

## 23.1 Caution

If expansion logic is business-critical and complex, extract method:

```java
expand(event, out)
```

or return list from domain service.

## 23.2 Rule

`mapMulti` can express event expansion, but do not hide complex business policy in huge lambdas.

---

# 24. Performance Model

`mapMulti` can reduce overhead when compared with `flatMap` because `flatMap` usually requires mapper to create a stream per input element.

Example:

```java
.flatMap(x -> smallList(x).stream())
```

vs:

```java
.<Y>mapMulti((x, out) -> {
    for (Y y : smallList(x)) out.accept(y);
})
```

## 24.1 Potential benefits

- fewer small stream objects;
- less allocation;
- fewer nested pipeline objects;
- direct emission.

## 24.2 Not guaranteed

Performance depends on:

- source size;
- fan-out;
- mapper complexity;
- JIT;
- allocation profile;
- terminal operation;
- parallel/sequential mode.

## 24.3 Rule

Use `mapMulti` for performance only after measurement or when allocation reduction is obvious and readability remains good.

---

# 25. Default Implementation and `flatMap` Relationship

The JDK documentation describes the default implementation of `mapMulti` in terms of `flatMap`: it calls mapper with a consumer that accumulates replacement elements into an internal buffer, then creates a stream from that buffer and returns it to `flatMap`.

## 25.1 Meaning

Conceptually, `mapMulti` is a zero-or-more mapping operation like `flatMap`.

## 25.2 Implementation note

Concrete stream implementations may optimize.

## 25.3 Rule

Understand `mapMulti` as a `flatMap` alternative, not magic.

---

# 26. When `flatMap` Is Still Better

Use `flatMap` when:

## 26.1 You already have streams

```java
.flatMap(order -> order.lines().stream())
```

## 26.2 Mapper naturally returns stream

```java
.flatMap(this::childrenStream)
```

## 26.3 Functional clarity matters

`flatMap` is well-known.

## 26.4 Complex stream operations per element

```java
.flatMap(order -> order.lines().stream()
    .filter(...)
    .map(...))
```

May be clearer than nested imperative mapMulti.

## 26.5 Rule

Use flatMap when output is naturally represented as stream.

---

# 27. When `mapMulti` Is Better

Use `mapMulti` when:

## 27.1 Fan-out is small

0, 1, 2 outputs per element.

## 27.2 You want combine filter + map

Conditional emission.

## 27.3 Avoid small stream creation

Hot path flattening.

## 27.4 Recursive expansion

Manual emission is natural.

## 27.5 Null-safe extraction

Zero-or-one nullable output.

## 27.6 Primitive output

Use primitive variants.

## 27.7 Rule

Use mapMulti when emission logic is more natural than constructing substreams.

---

# 28. Ordering Semantics

`mapMulti` preserves encounter-order emission.

For ordered stream:

```java
Stream.of(1, 2)
    .<Integer>mapMulti((n, out) -> {
        out.accept(n);
        out.accept(n * 10);
    })
```

Output order:

```text
1, 10, 2, 20
```

## 28.1 Within one element

Order follows `accept` calls.

## 28.2 Across elements

Order follows encounter order if stream ordered.

## 28.3 Rule

In ordered streams, `mapMulti` emits in mapper call order per encounter order.

---

# 29. Parallel Stream Considerations

In parallel, mapper may run concurrently for different elements.

## 29.1 Do not use shared mutable state

Bad:

```java
List<R> external = new ArrayList<>();

stream.parallel()
    .mapMulti((x, out) -> external.add(transform(x)));
```

## 29.2 Downstream consumer

Call downstream only synchronously in mapper.

## 29.3 Ordering

Final ordered terminal may preserve encounter order, but mapper execution order can vary.

## 29.4 Rule

`mapMulti` mapper must be stateless and non-interfering, especially in parallel.

---

# 30. Side Effects and Consumer Misuse

Bad:

```java
Consumer<R>[] saved = new Consumer[1];

stream.mapMulti((x, out) -> {
    saved[0] = out; // never do this
});
```

## 30.1 Why

The downstream consumer is internal pipeline machinery.

It is not valid outside invocation.

## 30.2 Side effects

Do not use mapMulti for side-effect workflow.

## 30.3 Rule

Only use downstream consumer to emit output elements immediately.

---

# 31. Exception Handling

Exceptions thrown inside mapper propagate from terminal operation.

```java
List<Record> records = lines.stream()
    .<Record>mapMulti((line, out) -> {
        if (line.isBlank()) return;
        out.accept(parseOrThrow(line));
    })
    .toList();
```

## 31.1 Checked exceptions

Same problem as other stream lambdas: handle/wrap/model.

## 31.2 Partial emission

If mapper emits some outputs then throws, previous outputs may already be accumulated.

## 31.3 Rule

Avoid emit-then-throw patterns unless partial emission before failure is acceptable.

---

# 32. Readability and Lambda Size

`mapMulti` can become imperative quickly.

Bad:

```java
.mapMulti((x, out) -> {
    // 80 lines of branching, mutation, try/catch, nested loops
})
```

## 32.1 Extract helper

```java
.<R>mapMulti(this::emitResults)
```

where:

```java
void emitResults(Input input, Consumer<R> out) {
    ...
}
```

## 32.2 Or use loop

If emission logic is a workflow, loop may be clearer.

## 32.3 Rule

Long `mapMulti` lambda is a smell.

---

# 33. Testing `mapMulti`

Test:

## 33.1 Zero output case

Input emits nothing.

## 33.2 One output case

Input emits exactly one.

## 33.3 Many output case

Input emits many.

## 33.4 Order

Output order within and across inputs.

## 33.5 Nulls

Null input/field behavior.

## 33.6 Exceptions

Fail-fast or result modeling.

## 33.7 Parallel equivalence

If used parallel, compare sequential/parallel output semantics.

## 33.8 Rule

`mapMulti` tests should cover emission cardinality.

---

# 34. Common Anti-Patterns

## 34.1 Using mapMulti for simple map

Use `map`.

## 34.2 Using mapMulti for simple filter

Use `filter`.

## 34.3 Replacing readable flatMap with imperative mapMulti

Not always improvement.

## 34.4 Huge lambda

Extract helper or loop.

## 34.5 Storing downstream consumer

Invalid.

## 34.6 Asynchronous accept

Invalid.

## 34.7 Shared mutable state in parallel

Wrong.

## 34.8 Silent skip of invalid data

Danger.

## 34.9 Emitting null unintentionally

Can fail later.

## 34.10 Ignoring type inference issues

Use type witness.

---

# 35. Production Failure Modes

## 35.1 List<Object> result

Cause: type inference without explicit type witness.

Fix: `.<TargetType>mapMulti`.

## 35.2 Missing data

Cause: conditional emission skipped unexpected cases.

Fix: tests for zero/one/many and counters.

## 35.3 Data quality hidden

Cause: invalid input emits nothing.

Fix: fail-fast or Result model.

## 35.4 NPE later

Cause: mapMulti emitted null.

Fix: validate before accept.

## 35.5 Parallel race

Cause: shared mutable state inside mapper.

Fix: stateless mapper.

## 35.6 Order surprise

Cause: parallel execution observed via side effects.

Fix: no side effects or ordered terminal.

## 35.7 StackOverflowError

Cause: recursive expansion over deep tree.

Fix: iterative stack.

## 35.8 Performance regression

Cause: mapMulti lambda complex; JIT/branching worse than flatMap.

Fix: benchmark.

## 35.9 Consumer misuse

Cause: storing downstream consumer.

Fix: accept only inside mapper.

## 35.10 Partial output before exception

Cause: emit then throw.

Fix: validate before emit or model result.

---

# 36. Best Practices

## 36.1 Use map for exactly-one mapping

Do not overuse mapMulti.

## 36.2 Use flatMap when substream is natural

Especially readable nested stream pipelines.

## 36.3 Use mapMulti for conditional zero-or-more emission

Especially small fan-out.

## 36.4 Use explicit type witness when needed

```java
.<String>mapMulti(...)
```

## 36.5 Keep mapper stateless

No shared mutable state.

## 36.6 Do not store downstream consumer

Use only synchronously.

## 36.7 Avoid huge lambdas

Extract helper.

## 36.8 Use primitive variants for numeric output

Avoid boxing.

## 36.9 Test emission cardinality

Zero/one/many.

## 36.10 Benchmark performance claims

Especially flatMap vs mapMulti.

---

# 37. Decision Matrix

| Situation | Prefer |
|---|---|
| one input -> one output | `map` |
| one input -> keep/drop same input | `filter` |
| one input -> existing stream output | `flatMap` |
| one input -> nullable zero-or-one output | `Stream.ofNullable` or `mapMulti` |
| optional flattening | `flatMap(Optional::stream)` |
| optional flattening with extra logic | `mapMulti` |
| nested collection simple flatten | `flatMap(Collection::stream)` |
| nested collection nullable/conditional | `mapMulti` |
| small fan-out 0..N | `mapMulti` |
| primitive zero-or-more int | `mapMultiToInt` |
| primitive zero-or-more long | `mapMultiToLong` |
| primitive zero-or-more double | `mapMultiToDouble` |
| recursive expansion | `mapMulti` with helper or loop |
| complex business workflow | loop |
| performance hot path with many small streams | consider `mapMulti`, benchmark |
| output type inferred as Object | explicit type witness |
| invalid input should report errors | Result model, not silent mapMulti skip |
| parallel use | stateless/non-interfering mapper |

---

# 38. Latihan

## Latihan 1 — Basic mapMulti

For numbers 1..3, emit number and number*10.

## Latihan 2 — Replace filter+map

Given users, emit active non-null emails with `mapMulti`.

Compare readability with filter+map.

## Latihan 3 — Flatten Lines

Split comma-separated lines using flatMap and mapMulti. Compare allocations conceptually.

## Latihan 4 — Optional Flattening

Use both `flatMap(Optional::stream)` and `mapMulti(...ifPresent(out))`.

## Latihan 5 — Type Witness

Create example where output inferred as `Object`; fix with `.<String>mapMulti`.

## Latihan 6 — mapMultiToLong

Sum all line amounts from orders using `mapMultiToLong`.

## Latihan 7 — Recursive Tree

Emit leaf nodes from a tree using helper method and `mapMulti`.

## Latihan 8 — Invalid Data

Show why silently emitting nothing for invalid line is dangerous. Redesign with `Result`.

## Latihan 9 — Parallel Safety

Identify shared mutable state bug in `parallelStream().mapMulti(...)`.

## Latihan 10 — Benchmark Plan

Design JMH benchmark comparing `flatMap` and `mapMulti` for small fan-out.

---

# 39. Ringkasan

`mapMulti` is a powerful zero-or-more mapping operation.

Core lessons:

- `map` is one-to-one.
- `filter` is keep/drop.
- `flatMap` maps to substream then flattens.
- `mapMulti` manually emits zero-or-more outputs through downstream consumer.
- No `accept` means zero outputs.
- Multiple `accept` calls mean multiple outputs.
- `mapMulti` can replace filter+map or flatMap in some cases.
- `mapMulti` can avoid creating many small streams.
- Type inference may need explicit type witness.
- Primitive variants avoid boxing.
- `mapMulti` is useful for null-safe extraction, optional flattening with logic, nested flattening, recursive expansion, event expansion, and validation flattening.
- `flatMap` remains better when substream is natural/readable.
- `mapMulti` mapper must be stateless and non-interfering.
- Do not store or asynchronously call downstream consumer.
- Beware emit-then-throw partial output.
- Huge `mapMulti` lambdas are a smell.
- Benchmark performance claims.

Main rule:

```text
Use mapMulti when the natural operation is:
“for this input, emit zero, one, or many outputs directly.”
Do not use it just to look clever.
```

---

# 40. Referensi

1. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

2. Java SE 25 — `IntStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/IntStream.html

3. Java SE 25 — `LongStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/LongStream.html

4. Java SE 25 — `DoubleStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/DoubleStream.html

5. Java SE 25 — `IntStream.IntMapMultiConsumer`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/IntStream.IntMapMultiConsumer.html

6. Java SE 25 — `Consumer`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/Consumer.html

7. Java SE 25 — `BiConsumer`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/BiConsumer.html

8. Java SE 25 — `Optional.stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html#stream()

9. Java SE 25 — `Stream.ofNullable`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html#ofNullable(T)

10. OpenJDK — Stream API source  
    https://github.com/openjdk/jdk/tree/master/src/java.base/share/classes/java/util/stream

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-043.md](./learn-java-collections-and-streams-part-043.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-045.md](./learn-java-collections-and-streams-part-045.md)

</div>