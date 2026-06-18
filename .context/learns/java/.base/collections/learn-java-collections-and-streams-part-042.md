# learn-java-collections-and-streams-part-042.md

# Java Collections and Streams — Part 042  
# Exception Handling in Streams: Checked Exceptions, Unchecked Wrapping, Fail-Fast, Error Accumulation, Try/Either Results, Partial Failure, Resource Exceptions, and Production-Safe Patterns

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **042**  
> Fokus: memahami exception handling di Stream API secara production-grade. Kita akan membahas kenapa checked exceptions tidak cocok langsung dengan `Function`, `Predicate`, dan `Consumer`, pola wrapping ke unchecked exception, `UncheckedIOException`, fail-fast vs collect-errors, result object, Try/Either-style modeling, partial failure, resource-backed stream, parallel exception behavior, dan kapan loop lebih baik.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Stream Pipeline Bukan Exception Workflow Engine](#2-mental-model-stream-pipeline-bukan-exception-workflow-engine)
3. [Kenapa Checked Exception Tidak Nyaman di Streams](#3-kenapa-checked-exception-tidak-nyaman-di-streams)
4. [Functional Interfaces and Exception Signatures](#4-functional-interfaces-and-exception-signatures)
5. [Unchecked Exceptions in Streams](#5-unchecked-exceptions-in-streams)
6. [Fail-Fast Pattern](#6-fail-fast-pattern)
7. [Wrapping Checked Exceptions](#7-wrapping-checked-exceptions)
8. [`UncheckedIOException`](#8-uncheckedioexception)
9. [Custom Domain Runtime Exception](#9-custom-domain-runtime-exception)
10. [Sneaky Throws: Why Usually Avoid](#10-sneaky-throws-why-usually-avoid)
11. [Helper Wrapper Functions](#11-helper-wrapper-functions)
12. [Throwing Functional Interfaces](#12-throwing-functional-interfaces)
13. [Returning `Optional` on Failure](#13-returning-optional-on-failure)
14. [Returning `Result` / `Either` / `Try`](#14-returning-result--either--try)
15. [Fail-Fast vs Error Accumulation](#15-fail-fast-vs-error-accumulation)
16. [Collecting Successes and Failures](#16-collecting-successes-and-failures)
17. [Validation vs Exception](#17-validation-vs-exception)
18. [Parsing Pipelines](#18-parsing-pipelines)
19. [IO Pipelines](#19-io-pipelines)
20. [Resource-Backed Streams and Exceptions](#20-resource-backed-streams-and-exceptions)
21. [Exception Handling in `map`](#21-exception-handling-in-map)
22. [Exception Handling in `filter`](#22-exception-handling-in-filter)
23. [Exception Handling in `forEach`](#23-exception-handling-in-foreach)
24. [Exception Handling in Collectors](#24-exception-handling-in-collectors)
25. [Parallel Streams and Exceptions](#25-parallel-streams-and-exceptions)
26. [Partial Side Effects on Exception](#26-partial-side-effects-on-exception)
27. [Logging Exceptions in Pipelines](#27-logging-exceptions-in-pipelines)
28. [Do Not Swallow Exceptions Silently](#28-do-not-swallow-exceptions-silently)
29. [Error Context: Element, Index, Source](#29-error-context-element-index-source)
30. [Index-Aware Error Context](#30-index-aware-error-context)
31. [Transactional Boundaries](#31-transactional-boundaries)
32. [API Boundary Translation](#32-api-boundary-translation)
33. [When Loop Is Better](#33-when-loop-is-better)
34. [Common Anti-Patterns](#34-common-anti-patterns)
35. [Production Failure Modes](#35-production-failure-modes)
36. [Best Practices](#36-best-practices)
37. [Decision Matrix](#37-decision-matrix)
38. [Latihan](#38-latihan)
39. [Ringkasan](#39-ringkasan)
40. [Referensi](#40-referensi)

---

# 1. Tujuan Bagian Ini

Stream pipeline membuat data processing menjadi elegan:

```java
List<UserDto> dtos = users.stream()
    .map(UserDto::from)
    .toList();
```

Tetapi exception handling sering membuat stream menjadi buruk:

```java
List<Record> records = lines.stream()
    .map(line -> {
        try {
            return parse(line);
        } catch (ParseException e) {
            throw new RuntimeException(e);
        }
    })
    .toList();
```

Atau lebih buruk:

```java
List<Record> records = lines.stream()
    .map(line -> {
        try {
            return parse(line);
        } catch (Exception e) {
            return null;
        }
    })
    .filter(Objects::nonNull)
    .toList();
```

Masalah utama:

- checked exception tidak cocok langsung dengan standard functional interfaces;
- wrapping exception bisa kehilangan context;
- swallowing exception bisa menyembunyikan data corruption;
- fail-fast vs collect-errors harus dipilih sadar;
- side effect sebelum exception tidak rollback;
- parallel stream exception behavior bisa meninggalkan partial work;
- resource-backed stream bisa throw saat traversal dan tetap harus ditutup;
- loop kadang jauh lebih jelas.

Tujuan bagian ini:

- memahami exception handling style di streams;
- memilih fail-fast vs error accumulation;
- membuat wrapper yang tidak menghilangkan context;
- memodelkan failure sebagai data jika perlu;
- memahami kapan stream harus diganti loop;
- menghindari production failure modes.

---

# 2. Mental Model: Stream Pipeline Bukan Exception Workflow Engine

Stream paling cocok untuk:

```text
pure transformation + reduction
```

Exception workflow biasanya butuh:

```text
try
catch
recover
log
classify error
add context
continue or stop
rollback or compensate
return partial result
```

Jika error handling adalah bagian utama business logic, stream sering menjadi kurang jelas.

## 2.1 Stream exception behavior

Jika lambda melempar unchecked exception, pipeline berhenti dan exception keluar dari terminal operation.

```java
List<Record> records = lines.stream()
    .map(this::parseOrThrow)
    .toList();
```

Jika `parseOrThrow` throw, `toList()` throw.

## 2.2 Main rule

```text
Streams can propagate exceptions, but they are not ideal for complex recovery workflows.
```

---

# 3. Kenapa Checked Exception Tidak Nyaman di Streams

Java standard functional interfaces seperti:

```java
Function<T, R>
Predicate<T>
Consumer<T>
Supplier<T>
```

tidak mendeklarasikan checked exception pada abstract method-nya.

Contoh `Function.apply`:

```java
R apply(T t);
```

Bukan:

```java
R apply(T t) throws IOException;
```

Karena itu method reference yang throw checked exception tidak bisa langsung dipakai:

```java
lines.stream()
    .map(this::parseChecked) // compile error if parseChecked throws IOException
    .toList();
```

## 3.1 Why

Lambda harus compatible dengan target functional interface signature.

Jika target method tidak `throws IOException`, lambda tidak boleh throw IOException tanpa menangani.

## 3.2 Rule

Checked exceptions must be handled, wrapped, or modeled before fitting into standard stream functional interfaces.

---

# 4. Functional Interfaces and Exception Signatures

## 4.1 Function

```java
@FunctionalInterface
interface Function<T, R> {
    R apply(T t);
}
```

## 4.2 Predicate

```java
@FunctionalInterface
interface Predicate<T> {
    boolean test(T t);
}
```

## 4.3 Consumer

```java
@FunctionalInterface
interface Consumer<T> {
    void accept(T t);
}
```

## 4.4 Consequence

No checked exception in method signature.

## 4.5 Rule

Standard stream lambdas are ergonomically designed for non-checked-exception transformations.

---

# 5. Unchecked Exceptions in Streams

Unchecked exceptions can be thrown directly.

```java
List<Integer> values = texts.stream()
    .map(Integer::parseInt)
    .toList();
```

`Integer.parseInt` can throw `NumberFormatException`.

## 5.1 Behavior

Pipeline stops when exception reaches terminal operation.

## 5.2 Good for fail-fast

If bad input means whole operation invalid, this is acceptable.

## 5.3 Rule

Unchecked exception propagation is natural for fail-fast stream pipelines.

---

# 6. Fail-Fast Pattern

Fail-fast means stop at first error.

## 6.1 Example

```java
List<Record> records = lines.stream()
    .map(this::parseRecordOrThrow)
    .toList();
```

If one line invalid, whole operation fails.

## 6.2 When good

- all-or-nothing import;
- invalid data should reject request;
- corruption should not be ignored;
- upstream contract requires valid input;
- transaction should rollback.

## 6.3 Add context

```java
Record parseRecordOrThrow(String line) {
    try {
        return parser.parse(line);
    } catch (ParseException e) {
        throw new InvalidRecordException("Invalid line: " + line, e);
    }
}
```

## 6.4 Rule

Fail-fast is good when partial success is not acceptable.

---

# 7. Wrapping Checked Exceptions

Pattern:

```java
.map(line -> {
    try {
        return parseChecked(line);
    } catch (IOException e) {
        throw new UncheckedIOException(e);
    }
})
```

## 7.1 Better extract method

```java
private Record parseUnchecked(String line) {
    try {
        return parseChecked(line);
    } catch (IOException e) {
        throw new UncheckedIOException("Failed to parse line", e);
    }
}
```

Then:

```java
List<Record> records = lines.stream()
    .map(this::parseUnchecked)
    .toList();
```

## 7.2 Preserve cause

Always include original exception as cause.

## 7.3 Rule

If wrapping checked exception, preserve cause and add useful context.

---

# 8. `UncheckedIOException`

`UncheckedIOException` is a runtime wrapper for `IOException`.

## 8.1 Use for IO

```java
throw new UncheckedIOException(e);
```

## 8.2 With message

```java
throw new UncheckedIOException("Failed reading " + path, e);
```

## 8.3 At boundary

Catch and translate:

```java
try {
    return loadRecords(path);
} catch (UncheckedIOException e) {
    throw new ImportFailedException("Import failed: " + path, e.getCause());
}
```

## 8.4 Rule

Use `UncheckedIOException` for IO failures inside stream pipelines.

---

# 9. Custom Domain Runtime Exception

For domain parsing/validation:

```java
class InvalidOrderLineException extends RuntimeException {
    InvalidOrderLineException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

Use:

```java
private OrderLine parseOrderLine(String line) {
    try {
        return parser.parse(line);
    } catch (ParseException e) {
        throw new InvalidOrderLineException("Invalid order line: " + line, e);
    }
}
```

## 9.1 Why

Domain exception makes boundary handling clearer.

## 9.2 Rule

Wrap low-level exceptions into meaningful domain exceptions at the right boundary.

---

# 10. Sneaky Throws: Why Usually Avoid

Sneaky throw techniques allow checked exceptions to be thrown without declaring.

Example conceptual:

```java
throwAsUnchecked(e);
```

## 10.1 Why risky

- surprises callers;
- hides API contract;
- confuses static analysis;
- makes error flow less explicit;
- can violate team expectations.

## 10.2 Rare use

Framework/internal utility code sometimes uses it, but application code should be conservative.

## 10.3 Rule

Avoid sneaky throws in business application streams.

---

# 11. Helper Wrapper Functions

You can define helper:

```java
@FunctionalInterface
interface ThrowingFunction<T, R> {
    R apply(T value) throws Exception;
}

static <T, R> Function<T, R> unchecked(ThrowingFunction<T, R> fn) {
    return value -> {
        try {
            return fn.apply(value);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    };
}
```

Use:

```java
List<Record> records = lines.stream()
    .map(unchecked(this::parseChecked))
    .toList();
```

## 11.1 Improve wrapper

Do not always use generic `RuntimeException`; use mapper:

```java
static <T, R> Function<T, R> unchecked(
        ThrowingFunction<T, R> fn,
        Function<Exception, RuntimeException> wrapper) {
    return value -> {
        try {
            return fn.apply(value);
        } catch (Exception e) {
            throw wrapper.apply(e);
        }
    };
}
```

## 11.2 Rule

Helper wrappers reduce boilerplate but must not hide context.

---

# 12. Throwing Functional Interfaces

Define explicit throwing interfaces:

```java
@FunctionalInterface
interface ThrowingPredicate<T, E extends Exception> {
    boolean test(T value) throws E;
}
```

## 12.1 Use carefully

They are useful in library/helper code.

## 12.2 But stream methods expect standard interfaces

You still need adapter to `Predicate`.

## 12.3 Rule

Throwing functional interfaces are adapter tools, not a complete exception strategy.

---

# 13. Returning `Optional` on Failure

Sometimes parse failure can mean “skip”.

```java
Optional<Record> parseOptional(String line) {
    try {
        return Optional.of(parser.parse(line));
    } catch (ParseException e) {
        return Optional.empty();
    }
}
```

Use:

```java
List<Record> records = lines.stream()
    .map(this::parseOptional)
    .flatMap(Optional::stream)
    .toList();
```

## 13.1 Good when

Failure is expected and losing reason is acceptable.

## 13.2 Bad when

You need error details.

## 13.3 Rule

Use Optional only for “absence”, not rich failure.

---

# 14. Returning `Result` / `Either` / `Try`

For error accumulation, model failure as data.

## 14.1 Result type

```java
sealed interface ParseResult permits ParseResult.Success, ParseResult.Failure {
    record Success(Record record) implements ParseResult {}
    record Failure(String line, String message, Throwable cause) implements ParseResult {}
}
```

Parse:

```java
ParseResult parseResult(String line) {
    try {
        return new ParseResult.Success(parser.parse(line));
    } catch (ParseException e) {
        return new ParseResult.Failure(line, e.getMessage(), e);
    }
}
```

Collect:

```java
List<ParseResult> results = lines.stream()
    .map(this::parseResult)
    .toList();
```

## 14.2 Benefit

No exception control flow for expected failures.

## 14.3 Rule

If partial failure is part of business output, model it as data.

---

# 15. Fail-Fast vs Error Accumulation

## 15.1 Fail-fast

Stop on first error.

Good for:

- all-or-nothing operations;
- transaction rollback;
- invalid request rejection;
- corrupted input.

## 15.2 Error accumulation

Continue and collect all errors.

Good for:

- CSV import validation;
- form validation;
- batch preview;
- report generation;
- “show all invalid rows”.

## 15.3 Rule

Exception strategy must match product semantics.

---

# 16. Collecting Successes and Failures

Using `Result`:

```java
record ImportReport(List<Record> records, List<ParseResult.Failure> failures) {}
```

Collect:

```java
List<ParseResult> results = lines.stream()
    .map(this::parseResult)
    .toList();

List<Record> records = results.stream()
    .flatMap(result -> switch (result) {
        case ParseResult.Success s -> Stream.of(s.record());
        case ParseResult.Failure f -> Stream.empty();
    })
    .toList();

List<ParseResult.Failure> failures = results.stream()
    .flatMap(result -> switch (result) {
        case ParseResult.Success s -> Stream.empty();
        case ParseResult.Failure f -> Stream.of(f);
    })
    .toList();
```

## 16.1 Alternative loop

For multiple outputs, loop may be simpler.

## 16.2 Rule

Streams can collect success/failure data, but do not overcomplicate if loop is clearer.

---

# 17. Validation vs Exception

Invalid user input is often not exceptional.

## 17.1 Validation result

```java
record ValidationError(String field, String message) {}

List<ValidationError> errors = validators.stream()
    .flatMap(v -> v.validate(command).stream())
    .toList();
```

## 17.2 Exception

Use exception for unexpected system failure or fail-fast boundary.

## 17.3 Rule

Do not use exceptions as normal validation collection mechanism if errors are expected output.

---

# 18. Parsing Pipelines

## 18.1 Fail-fast parsing

```java
List<OrderLine> lines = textLines.stream()
    .map(this::parseOrderLineOrThrow)
    .toList();
```

## 18.2 Accumulate parse errors

```java
List<ParseResult> results = textLines.stream()
    .map(this::parseOrderLineResult)
    .toList();
```

## 18.3 With line number

Use index:

```java
List<ParseResult> results = IntStream.range(0, textLines.size())
    .mapToObj(i -> parseLine(i + 1, textLines.get(i)))
    .toList();
```

## 18.4 Rule

Parsing needs context; include line number/source whenever possible.

---

# 19. IO Pipelines

Resource-backed IO streams need close and wrapping.

```java
try (Stream<String> lines = Files.lines(path)) {
    return lines
        .map(this::parseUnchecked)
        .toList();
}
```

## 19.1 IOException can happen during traversal

Not only when opening.

## 19.2 Use UncheckedIOException

For IO errors inside lambdas.

## 19.3 Rule

IO stream pipelines need both exception strategy and resource management.

---

# 20. Resource-Backed Streams and Exceptions

If terminal operation throws, try-with-resources still closes stream.

```java
try (Stream<String> lines = Files.lines(path)) {
    return lines.map(this::parseOrThrow).toList();
}
```

## 20.1 Close exception

Close handler may also throw, possibly as suppressed exception.

## 20.2 Rule

Always combine resource-backed streams with try-with-resources.

---

# 21. Exception Handling in `map`

## 21.1 Fail-fast map

```java
.map(this::parseOrThrow)
```

## 21.2 Wrap checked

```java
.map(line -> {
    try {
        return parse(line);
    } catch (IOException e) {
        throw new UncheckedIOException(e);
    }
})
```

## 21.3 Result map

```java
.map(this::parseResult)
```

## 21.4 Rule

`map` should either produce value, throw fail-fast exception, or produce result object. Do not return null silently.

---

# 22. Exception Handling in `filter`

Exceptions inside filter are awkward.

Bad:

```java
.filter(line -> {
    try {
        return isValid(line);
    } catch (Exception e) {
        return false;
    }
})
```

This silently hides reason.

## 22.1 Better for validation

Map to validation result, then filter successes.

## 22.2 Better for fail-fast

Throw with context.

```java
.filter(this::isValidOrThrow)
```

## 22.3 Rule

Avoid using filter as silent error suppression.

---

# 23. Exception Handling in `forEach`

`forEach` with side effects:

```java
commands.stream()
    .forEach(sender::send);
```

If one send throws, previous sends already happened.

## 23.1 Need per-item result?

Use loop:

```java
for (Command command : commands) {
    try {
        sender.send(command);
        successes.add(command.id());
    } catch (Exception e) {
        failures.add(new Failure(command.id(), e));
    }
}
```

## 23.2 Rule

For side-effect operations with failure handling, loop is often clearer.

---

# 24. Exception Handling in Collectors

Collectors can throw too:

```java
Collectors.toMap(User::id, Function.identity())
```

throws if duplicate key.

## 24.1 Duplicate as exception

May be good fail-fast.

## 24.2 Better context

Use explicit merge that throws domain exception:

```java
Collectors.toMap(
    User::id,
    Function.identity(),
    (a, b) -> {
        throw new DuplicateUserException(a.id());
    }
)
```

## 24.3 Rule

Collector exceptions should communicate domain contract violation clearly.

---

# 25. Parallel Streams and Exceptions

Parallel exception behavior adds complexity.

## 25.1 Other tasks may already be running

If one element throws, other elements may have been processed.

## 25.2 Side effects may be partial

Never assume rollback.

## 25.3 Exception order

If multiple tasks fail, which exception is observed may not be deterministic.

## 25.4 Rule

Parallel streams and exception-heavy workflows are a poor mix.

---

# 26. Partial Side Effects on Exception

Bad:

```java
users.stream()
    .map(this::toEmailCommand)
    .forEach(emailSender::send);
```

If send fails halfway, earlier emails sent.

## 26.1 Better

Outbox:

```java
List<EmailCommand> commands = users.stream()
    .map(this::toEmailCommand)
    .toList();

outbox.saveAll(commands);
```

Then reliable sender processes idempotently.

## 26.2 Rule

External side effects require idempotency/transaction strategy beyond stream exception handling.

---

# 27. Logging Exceptions in Pipelines

Logging inside lambda can duplicate/noise.

```java
.map(line -> {
    try {
        return parse(line);
    } catch (Exception e) {
        log.warn("Failed line {}", line, e);
        throw e;
    }
})
```

## 27.1 Good

Log once at boundary with context.

## 27.2 If collecting errors

Store errors, then log summary.

## 27.3 Rule

Avoid logging and rethrowing at many layers unless intentional.

---

# 28. Do Not Swallow Exceptions Silently

Bad:

```java
.map(line -> {
    try {
        return parse(line);
    } catch (Exception e) {
        return null;
    }
})
.filter(Objects::nonNull)
```

## 28.1 Why bad

- data loss;
- no diagnostics;
- hidden quality issue;
- impossible reconciliation.

## 28.2 Better

- fail-fast exception;
- `Result.Failure`;
- metrics and report.

## 28.3 Rule

If you skip bad data, make it observable and intentional.

---

# 29. Error Context: Element, Index, Source

Exception without context is painful.

Bad:

```text
NumberFormatException: For input string: "abc"
```

Better:

```text
Invalid amount at file orders.csv line 52: "abc"
```

## 29.1 Add context

```java
throw new InvalidImportLineException(path, lineNumber, line, e);
```

## 29.2 Rule

Stream exception wrappers should add source context.

---

# 30. Index-Aware Error Context

Streams over lists can use `IntStream.range`.

```java
List<ParseResult> results = IntStream.range(0, lines.size())
    .mapToObj(i -> parseLine(i + 1, lines.get(i)))
    .toList();
```

## 30.1 For resource lines

Line numbering with `Files.lines` is trickier because external mutable counter in stream can be problematic.

For sequential parsing, loop with `BufferedReader` may be clearer.

## 30.2 Rule

If line/index context is central, loop or index stream may be clearer.

---

# 31. Transactional Boundaries

Streams do not define transaction semantics.

Bad:

```java
orders.stream()
    .map(this::validateOrThrow)
    .forEach(repository::save);
```

If save fails midway, earlier saves may persist depending transaction.

## 31.1 Better

Validate first:

```java
List<Order> valid = orders.stream()
    .map(this::validateOrThrow)
    .toList();

repository.saveAll(valid);
```

or explicit transaction workflow.

## 31.2 Rule

Transactions belong at service/workflow boundary, not hidden in stream stages.

---

# 32. API Boundary Translation

Inside pipeline you may wrap checked to unchecked.

At API boundary, translate to meaningful response.

## 32.1 Example

```java
try {
    ImportReport report = importer.importFile(path);
    return Response.ok(report);
} catch (InvalidImportException e) {
    return Response.badRequest(error(e));
} catch (UncheckedIOException e) {
    return Response.serverError(error("Failed to read file"));
}
```

## 32.2 Rule

Internal exception strategy must be translated into external API contract.

---

# 33. When Loop Is Better

Prefer loop when:

- checked exception handling is central;
- partial failure collection needed;
- multiple outputs;
- per-item recovery;
- side effects;
- transactions;
- line number/index context;
- resource management complex;
- break/continue semantics complex;
- logs/metrics per failure;
- retry/backoff.

## 33.1 Example

```java
List<Record> records = new ArrayList<>();
List<Failure> failures = new ArrayList<>();

try (BufferedReader reader = Files.newBufferedReader(path)) {
    String line;
    int lineNumber = 0;

    while ((line = reader.readLine()) != null) {
        lineNumber++;
        try {
            records.add(parse(line));
        } catch (ParseException e) {
            failures.add(new Failure(lineNumber, line, e.getMessage()));
        }
    }
}
```

This is clearer than forcing stream.

## 33.2 Rule

Loop is not less modern; it is more explicit for exception workflows.

---

# 34. Common Anti-Patterns

## 34.1 Catch and return null

Bad.

## 34.2 Catch and return false in filter without logging/reporting

Bad.

## 34.3 Generic RuntimeException everywhere

Poor diagnostics.

## 34.4 Swallowing parse errors

Data loss.

## 34.5 Logging and rethrowing repeatedly

Noisy.

## 34.6 Sneaky throws in app code

Confusing.

## 34.7 Parallel stream with exception-heavy side effects

Dangerous.

## 34.8 Wrapping without cause

Loses stack trace.

## 34.9 Losing element context

Hard debugging.

## 34.10 Stream contortion instead of loop

Unreadable.

---

# 35. Production Failure Modes

## 35.1 Silent data loss

Cause: catch exception and return null/empty.

## 35.2 Poor observability

Cause: errors swallowed or generic RuntimeException.

## 35.3 Wrong HTTP response

Cause: unchecked internal exception not translated.

## 35.4 Partial side effects

Cause: exception halfway through `forEach`.

## 35.5 Resource leak

Cause: exception in resource stream without try-with-resources.

## 35.6 Flaky parallel failure

Cause: multiple parallel exceptions/side effects.

## 35.7 Duplicate logs

Cause: log-and-rethrow at every layer.

## 35.8 No line number

Cause: stream over lines without index context.

## 35.9 Transaction partial commit

Cause: save in stream pipeline without transaction design.

## 35.10 Lost root cause

Cause: wrapper exception not preserving cause.

---

# 36. Best Practices

## 36.1 Decide semantics first

Fail-fast or collect-errors?

## 36.2 Use fail-fast for invalid all-or-nothing operations

Throw domain exception with context.

## 36.3 Use result objects for expected partial failures

Do not use null.

## 36.4 Use `UncheckedIOException` for IO in streams

Preserve cause.

## 36.5 Extract exception-handling methods

Avoid giant lambdas.

## 36.6 Include element context

Line number, ID, source file, field.

## 36.7 Avoid side effects in exception-prone streams

Separate compute and effect.

## 36.8 Prefer loops for complex recovery

Especially checked exceptions.

## 36.9 Translate exceptions at API boundary

Do not leak low-level exceptions.

## 36.10 Test failure cases

Not only happy path.

---

# 37. Decision Matrix

| Situation | Recommended |
|---|---|
| invalid element should reject whole operation | fail-fast stream with domain exception |
| checked IOException in map | wrap with `UncheckedIOException` |
| parse errors should be reported all at once | `Result`/loop accumulation |
| missing optional value | `Optional`, not exception |
| validation errors expected | validation result list |
| side effect per item with recovery | loop |
| DB save with transaction | explicit service transaction |
| line number needed | loop or `IntStream.range` |
| resource-backed stream | try-with-resources |
| parallel + exceptions | avoid unless pure and fail-fast okay |
| duplicate key should fail | `toMap` or explicit merge throwing domain exception |
| duplicate key should aggregate | `groupingBy`/merge |
| checked exception dominates code | loop |
| temporary wrapping acceptable | helper wrapper with context |
| skip bad records intentionally | collect/report failures |
| API response needs error contract | translate at boundary |

---

# 38. Latihan

## Latihan 1 — Checked Exception Compile Error

Create method `parse(String) throws IOException` and try to use it in `.map(this::parse)`.

Explain compile error.

## Latihan 2 — Wrap IOException

Rewrite with `UncheckedIOException`.

## Latihan 3 — Domain Exception Context

Create `InvalidCsvLineException(file, lineNumber, line, cause)`.

## Latihan 4 — Fail-Fast Import

Implement stream pipeline that fails on first invalid line.

## Latihan 5 — Error Accumulation Import

Implement `ParseResult.Success/Failure` and collect both.

## Latihan 6 — Optional Failure

Use `Optional` for lookup failure. Explain why it is bad for rich parse errors.

## Latihan 7 — Filter Error Suppression

Show why `catch -> false` in filter hides problems.

## Latihan 8 — Parallel Exception

Explain partial work risk in parallel stream when one element throws.

## Latihan 9 — Transaction Boundary

Refactor `stream.forEach(repository::save)` into validate-then-saveAll.

## Latihan 10 — Loop vs Stream

Given file parsing with line number, errors list, and summary, choose loop or stream and justify.

---

# 39. Ringkasan

Exception handling in streams is about choosing error semantics deliberately.

Core lessons:

- Standard functional interfaces do not declare checked exceptions.
- Checked exceptions must be handled, wrapped, or modeled.
- Unchecked exceptions propagate naturally through stream terminal operations.
- Fail-fast is good for all-or-nothing operations.
- Error accumulation is better for validation/import reports.
- `UncheckedIOException` is appropriate for IO failures in stream lambdas.
- Custom domain runtime exceptions improve boundary clarity.
- Sneaky throws are usually bad application style.
- Helper wrappers reduce boilerplate but can hide context.
- `Optional` represents absence, not rich failure.
- Result/Either/Try-style objects model expected partial failures.
- Do not return null or silently filter failures.
- Include context: element, line, source, ID.
- Resource-backed streams still need try-with-resources.
- Parallel stream exceptions can leave partial work.
- Side effects and exceptions require explicit workflow semantics.
- Loops are often better for complex exception recovery.

Main rule:

```text
If failure is exceptional and all-or-nothing, fail fast with context.
If failure is expected and reportable, model it as data.
If handling is procedural and complex, use a loop.
```

---

# 40. Referensi

1. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

2. Java SE 25 — `java.util.stream` Package Summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html

3. Java SE 25 — `Function`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/Function.html

4. Java SE 25 — `Predicate`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/Predicate.html

5. Java SE 25 — `Consumer`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/Consumer.html

6. Java SE 25 — `UncheckedIOException`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/UncheckedIOException.html

7. Java SE 25 — `RuntimeException`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/RuntimeException.html

8. Java SE 25 — `Files.lines`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html#lines(java.nio.file.Path)

9. Java SE 25 — `Collectors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

10. OpenJDK — Stream API source  
    https://github.com/openjdk/jdk/tree/master/src/java.base/share/classes/java/util/stream

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-041.md](./learn-java-collections-and-streams-part-041.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-043.md](./learn-java-collections-and-streams-part-043.md)
