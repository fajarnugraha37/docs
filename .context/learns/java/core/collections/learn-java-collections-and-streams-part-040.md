# learn-java-collections-and-streams-part-040.md

# Java Collections and Streams — Part 040  
# Stream Resource Management: AutoCloseable Streams, Files.lines, Directory Streams, Lazy IO, try-with-resources, onClose Handlers, Exception Safety, Resource Leaks, and Production Patterns

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **040**  
> Fokus: memahami resource management pada Stream API: kapan stream perlu ditutup, kapan tidak, bagaimana `BaseStream.close()`, `onClose`, `try-with-resources`, lazy IO, resource-backed stream seperti `Files.lines`, `Files.list`, `Files.walk`, `Files.find`, resource lifetime, exception handling, file descriptor leaks, dan production-safe patterns.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Tidak Semua Stream Memegang Resource](#2-mental-model-tidak-semua-stream-memegang-resource)
3. [Stream dan `AutoCloseable`](#3-stream-dan-autocloseable)
4. [Kapan Stream Perlu Ditutup?](#4-kapan-stream-perlu-ditutup)
5. [Kapan Stream Tidak Perlu Ditutup?](#5-kapan-stream-tidak-perlu-ditutup)
6. [Resource-Backed Streams](#6-resource-backed-streams)
7. [`Files.lines`](#7-fileslines)
8. [`Files.list`](#8-fileslist)
9. [`Files.walk`](#9-fileswalk)
10. [`Files.find`](#10-filesfind)
11. [try-with-resources Pattern](#11-try-with-resources-pattern)
12. [Lazy IO and Lifetime Trap](#12-lazy-io-and-lifetime-trap)
13. [Do Not Return Open Resource Streams Carelessly](#13-do-not-return-open-resource-streams-carelessly)
14. [Materialize Inside Resource Boundary](#14-materialize-inside-resource-boundary)
15. [Callback/Consumer Pattern](#15-callbackconsumer-pattern)
16. [Supplier Pattern and Its Risk](#16-supplier-pattern-and-its-risk)
17. [`onClose` Handlers](#17-onclose-handlers)
18. [Multiple `onClose` Handlers](#18-multiple-onclose-handlers)
19. [Close and Exceptions](#19-close-and-exceptions)
20. [Suppressed Exceptions](#20-suppressed-exceptions)
21. [Operating After Close](#21-operating-after-close)
22. [Stream Reuse vs Stream Close](#22-stream-reuse-vs-stream-close)
23. [Short-Circuiting Does Not Mean Auto-Close](#23-short-circuiting-does-not-mean-auto-close)
24. [Resource Leaks](#24-resource-leaks)
25. [File Descriptor Exhaustion](#25-file-descriptor-exhaustion)
26. [Directory Traversal and Large Trees](#26-directory-traversal-and-large-trees)
27. [Parallel Streams over IO Resources](#27-parallel-streams-over-io-resources)
28. [Resource Streams and Exception Handling](#28-resource-streams-and-exception-handling)
29. [Checked Exceptions in Pipelines](#29-checked-exceptions-in-pipelines)
30. [Resource Streams in APIs](#30-resource-streams-in-apis)
31. [Resource Streams in Spring/Service Layers](#31-resource-streams-in-springservice-layers)
32. [Resource Streams in Tests](#32-resource-streams-in-tests)
33. [Observability and Diagnostics](#33-observability-and-diagnostics)
34. [Common Anti-Patterns](#34-common-anti-patterns)
35. [Production Failure Modes](#35-production-failure-modes)
36. [Best Practices](#36-best-practices)
37. [Decision Matrix](#37-decision-matrix)
38. [Latihan](#38-latihan)
39. [Ringkasan](#39-ringkasan)
40. [Referensi](#40-referensi)

---

# 1. Tujuan Bagian Ini

Stream API punya method:

```java
close()
```

dan stream mengimplementasikan `AutoCloseable`.

Ini sering membuat developer bertanya:

```text
Apakah semua stream harus ditutup?
```

Jawaban praktis:

```text
Tidak semua stream perlu ditutup.
Tutup stream jika stream tersebut memegang resource yang harus dilepas.
```

Contoh yang biasanya tidak perlu ditutup:

```java
list.stream()
arrayStream
Stream.of(...)
IntStream.range(...)
```

Contoh yang perlu ditutup:

```java
Files.lines(path)
Files.list(path)
Files.walk(path)
Files.find(path, ...)
```

Karena stream tersebut dapat memegang resource OS seperti file descriptor/directory handle.

Tujuan bagian ini:

- memahami kapan stream perlu ditutup;
- memahami lazy IO;
- memahami `try-with-resources`;
- memahami `onClose`;
- menghindari file descriptor leaks;
- mendesain API yang aman dengan resource-backed streams;
- memahami short-circuiting dan close;
- memahami exception/suppressed exception;
- membangun production-safe patterns.

---

# 2. Mental Model: Tidak Semua Stream Memegang Resource

Stream adalah abstraction untuk traversal.

Source stream bisa berasal dari:

```text
Collection
Array
Generator
Range
IO resource
Directory
Network/resource wrapper
```

Tidak semua source memegang external resource.

## 2.1 Collection stream

```java
users.stream()
```

Tidak perlu close karena collection ada di memory dan tidak memegang resource OS yang harus dilepas oleh stream.

## 2.2 File stream

```java
Files.lines(path)
```

Perlu close karena membaca file secara lazy dan dapat memegang file channel/reader.

## 2.3 Main rule

```text
Close resource-backed streams, not every stream blindly.
```

---

# 3. Stream dan `AutoCloseable`

`BaseStream` extends `AutoCloseable`.

Artinya stream bisa dipakai dalam:

```java
try (Stream<String> lines = Files.lines(path)) {
    ...
}
```

## 3.1 Why stream close exists

Untuk stream yang memegang resource.

## 3.2 close handlers

Stream bisa punya close handlers via:

```java
onClose(Runnable)
```

## 3.3 Most streams

Most in-memory streams have no special close behavior.

## 3.4 Rule

`AutoCloseable` support exists for resource-backed streams and custom close handlers.

---

# 4. Kapan Stream Perlu Ditutup?

Tutup stream jika:

## 4.1 Source membuka file

```java
Files.lines(path)
```

## 4.2 Source membuka directory

```java
Files.list(path)
Files.walk(path)
Files.find(path, ...)
```

## 4.3 Source membungkus resource eksternal

Custom stream from:

- socket;
- DB cursor;
- HTTP response;
- archive entry stream;
- native handle;
- large mapped resource.

## 4.4 You attach close handler

```java
stream.onClose(cleanup)
```

Jika cleanup penting, stream harus ditutup.

## 4.5 Rule

If stream owns or depends on something that must be released, close it.

---

# 5. Kapan Stream Tidak Perlu Ditutup?

Biasanya tidak perlu menutup:

```java
collection.stream()
collection.parallelStream()
Arrays.stream(array)
Stream.of(...)
Stream.empty()
Stream.generate(...)
Stream.iterate(...)
IntStream.range(...)
```

## 5.1 Why

Tidak ada resource eksternal yang dilepas oleh `close`.

## 5.2 Closing harmless?

Biasanya harmless, tetapi menutup semua stream secara noisy bisa membuat code membingungkan.

## 5.3 Rule

Do not add try-with-resources noise around ordinary in-memory streams.

---

# 6. Resource-Backed Streams

Resource-backed stream adalah stream yang traversal-nya bergantung pada resource yang harus ditutup.

Examples:

```java
Files.lines
Files.list
Files.walk
Files.find
```

Custom examples:

```java
database cursor stream
S3 object line stream
zip entry stream
HTTP response stream
```

## 6.1 Lazy nature

Resource tetap terbuka selama stream belum ditutup.

## 6.2 Terminal operation does not always close stream automatically

Do not assume terminal operation closes resource-backed stream.

## 6.3 Rule

Resource-backed stream lifetime must be explicit.

---

# 7. `Files.lines`

Reads lines lazily.

```java
try (Stream<String> lines = Files.lines(path)) {
    Optional<String> firstError = lines
        .filter(line -> line.contains("ERROR"))
        .findFirst();
}
```

## 7.1 Benefit

Can read only needed lines.

## 7.2 Need close

The stream should be closed after use.

## 7.3 Charset

There are overloads with charset.

## 7.4 Large file

Good for scanning large files without reading all lines into memory.

## 7.5 Rule

Always use try-with-resources with `Files.lines`.

---

# 8. `Files.list`

Lists entries in directory lazily.

```java
try (Stream<Path> entries = Files.list(directory)) {
    List<Path> files = entries
        .filter(Files::isRegularFile)
        .toList();
}
```

## 8.1 Need close

Directory stream resources must be released.

## 8.2 Not recursive

Only direct entries.

## 8.3 Rule

Use try-with-resources for `Files.list`.

---

# 9. `Files.walk`

Walks file tree.

```java
try (Stream<Path> paths = Files.walk(root)) {
    List<Path> javaFiles = paths
        .filter(path -> path.toString().endsWith(".java"))
        .toList();
}
```

## 9.1 Recursive

Can traverse deep tree.

## 9.2 Need close

Open directory resources must be closed.

## 9.3 Large tree caution

Can be expensive and may encounter permissions/symlink cycles depending options.

## 9.4 Rule

Use try-with-resources and constrain traversal when possible.

---

# 10. `Files.find`

Finds files matching predicate.

```java
try (Stream<Path> paths = Files.find(
        root,
        5,
        (path, attrs) -> attrs.isRegularFile()
            && path.toString().endsWith(".log"))) {

    List<Path> logs = paths.toList();
}
```

## 10.1 Benefit

Predicate gets path and file attributes.

## 10.2 Need close

Same resource management as file tree traversal.

## 10.3 Rule

Use `Files.find` for attribute-aware search and close it.

---

# 11. try-with-resources Pattern

The safest pattern:

```java
try (Stream<String> lines = Files.lines(path)) {
    return lines
        .filter(this::isRelevant)
        .map(this::parse)
        .toList();
}
```

## 11.1 Scope

Stream is opened and consumed in same lexical scope.

## 11.2 Auto close

`close()` is called automatically at end of block.

## 11.3 Exception safe

Close happens even if exception occurs.

## 11.4 Rule

Resource-backed stream should usually be consumed inside try-with-resources.

---

# 12. Lazy IO and Lifetime Trap

Bad:

```java
Stream<String> readLines(Path path) throws IOException {
    try (Stream<String> lines = Files.lines(path)) {
        return lines.filter(line -> !line.isBlank());
    }
}
```

The returned stream is already closed.

## 12.1 Another bad version

```java
Stream<String> lines = Files.lines(path);
return lines.filter(...);
```

Now caller must close but may not know.

## 12.2 Rule

Lazy stream cannot outlive its resource scope unless ownership is clearly transferred.

---

# 13. Do Not Return Open Resource Streams Carelessly

Returning `Stream<T>` from method can transfer close responsibility to caller.

## 13.1 Dangerous API

```java
Stream<String> lines(Path path) throws IOException {
    return Files.lines(path);
}
```

Caller must know to close.

## 13.2 If you do it

Document strongly:

```java
/**
 * Returns a lazily-read stream. Caller must close the returned stream.
 */
Stream<String> openLines(Path path) throws IOException {
    return Files.lines(path);
}
```

## 13.3 Better alternatives

- return List for bounded result;
- accept callback;
- return domain-specific AutoCloseable wrapper;
- process inside method.

## 13.4 Rule

Returning resource stream is an ownership transfer; make it explicit or avoid it.

---

# 14. Materialize Inside Resource Boundary

If result is reasonably bounded:

```java
List<String> readNonBlankLines(Path path) throws IOException {
    try (Stream<String> lines = Files.lines(path)) {
        return lines
            .filter(Predicate.not(String::isBlank))
            .toList();
    }
}
```

## 14.1 Benefit

Caller gets ordinary list; no close responsibility.

## 14.2 Cost

Materializes all result lines.

## 14.3 Rule

Materialize inside boundary when output size is safe and API simplicity matters.

---

# 15. Callback/Consumer Pattern

For large data, avoid returning stream while preserving laziness:

```java
void processLines(Path path, Consumer<String> consumer) throws IOException {
    try (Stream<String> lines = Files.lines(path)) {
        lines.forEach(consumer);
    }
}
```

## 15.1 More flexible with function result

```java
<R> R withLines(Path path, Function<Stream<String>, R> action) throws IOException {
    try (Stream<String> lines = Files.lines(path)) {
        return action.apply(lines);
    }
}
```

Usage:

```java
long errorCount = withLines(path, lines ->
    lines.filter(line -> line.contains("ERROR")).count()
);
```

## 15.2 Caveat

Do not let stream escape from callback.

## 15.3 Rule

Callback pattern keeps resource ownership inside method.

---

# 16. Supplier Pattern and Its Risk

Sometimes APIs use:

```java
Supplier<Stream<String>>
```

Example:

```java
Supplier<Stream<String>> source = () -> Files.lines(path);
```

But `Files.lines` throws checked IOException, so this often leads to wrapper abstractions.

## 16.1 Useful for repeatable streams

Because streams are single-use, supplier can open a fresh stream per call.

## 16.2 Risk

Each opened stream must be closed.

## 16.3 Rule

Supplier of resource streams must define who closes each opened stream.

---

# 17. `onClose` Handlers

You can attach close handlers:

```java
Stream<String> stream = source
    .onClose(() -> log.debug("closed"));
```

## 17.1 Use cases

- cleanup custom resource;
- release metrics scope;
- close underlying resource;
- debugging close behavior.

## 17.2 Handler runs on close

If stream is not closed, handler does not run.

## 17.3 Rule

`onClose` is useful only if close is guaranteed.

---

# 18. Multiple `onClose` Handlers

You can chain:

```java
stream
    .onClose(cleanupA)
    .onClose(cleanupB);
```

## 18.1 Execution

Handlers are invoked when stream is closed.

## 18.2 Exceptions

If multiple close handlers throw, later exceptions may be suppressed depending close mechanics.

## 18.3 Rule

Close handlers should be simple, safe, and not rely on complex business workflow.

---

# 19. Close and Exceptions

try-with-resources ensures close on normal and exceptional exit.

```java
try (Stream<String> lines = Files.lines(path)) {
    return lines
        .map(this::parse)
        .toList();
}
```

If `parse` throws, stream still closes.

## 19.1 Close can throw?

`BaseStream.close()` itself does not declare checked exception, but close handlers may throw runtime exceptions.

## 19.2 Rule

Use try-with-resources to make close exception-safe.

---

# 20. Suppressed Exceptions

In try-with-resources, if body throws and close also throws, close exception can become suppressed.

## 20.1 Example concept

```text
main exception: parse failed
suppressed exception: close handler failed
```

## 20.2 Diagnostics

Inspect suppressed exceptions when diagnosing resource cleanup failures.

## 20.3 Rule

Do not ignore suppressed exceptions in complex resource handling diagnostics.

---

# 21. Operating After Close

Using stream after close can throw `IllegalStateException`.

```java
Stream<String> lines = Files.lines(path);
lines.close();
lines.count(); // invalid
```

## 21.1 Also single-use

Even without close, stream cannot be reused after terminal operation.

## 21.2 Rule

Closed stream and consumed stream are both not reusable.

---

# 22. Stream Reuse vs Stream Close

Stream reuse error:

```java
Stream<String> s = names.stream();

long count = s.count();
List<String> list = s.toList(); // illegal
```

Close error:

```java
s.close();
s.count(); // illegal
```

## 22.1 Supplier for reuse

```java
Supplier<Stream<String>> supplier = names::stream;
long count = supplier.get().count();
List<String> list = supplier.get().toList();
```

## 22.2 Rule

A stream is single-use; use supplier to create fresh stream if needed.

---

# 23. Short-Circuiting Does Not Mean Auto-Close

This:

```java
Stream<String> lines = Files.lines(path);
Optional<String> first = lines.findFirst();
```

may stop reading early, but you still should close stream.

Correct:

```java
try (Stream<String> lines = Files.lines(path)) {
    Optional<String> first = lines.findFirst();
}
```

## 23.1 Why

Short-circuit stops traversal, not necessarily resource lifetime.

## 23.2 Rule

Short-circuiting is not resource management.

---

# 24. Resource Leaks

Resource leak means resource remains open longer than intended.

## 24.1 Example

```java
Files.lines(path)
    .filter(...)
    .findFirst();
```

No try-with-resources.

## 24.2 Consequence

File descriptor remains open until GC/finalization/cleanup eventually happens, which is not prompt or reliable enough.

## 24.3 Rule

Do not rely on GC to close resource-backed streams.

---

# 25. File Descriptor Exhaustion

If code repeatedly opens resource streams without closing:

```java
for (Path path : paths) {
    Files.lines(path).count();
}
```

Can eventually hit:

```text
Too many open files
```

## 25.1 Correct

```java
for (Path path : paths) {
    try (Stream<String> lines = Files.lines(path)) {
        long count = lines.count();
    }
}
```

## 25.2 Rule

Resource-backed streams in loops must be closed per iteration.

---

# 26. Directory Traversal and Large Trees

`Files.walk` and `Files.find` can open directory resources while traversing.

## 26.1 Bad

```java
Stream<Path> paths = Files.walk(root);
return paths.filter(...);
```

Caller may leak.

## 26.2 Better

```java
try (Stream<Path> paths = Files.walk(root)) {
    return paths
        .filter(...)
        .limit(1000)
        .toList();
}
```

## 26.3 Large tree caution

Even with closing, traversal may be expensive.

Use:

- max depth;
- filter early;
- avoid following links unless needed;
- handle permissions.

## 26.4 Rule

Directory streams need both resource management and traversal bounds.

---

# 27. Parallel Streams over IO Resources

Avoid casually:

```java
try (Stream<String> lines = Files.lines(path)) {
    return lines.parallel()
        .map(this::parse)
        .toList();
}
```

## 27.1 Possible issue

The source is IO-backed and splitting may not be ideal. Parsing may be CPU-heavy, but reading is IO/lazy.

## 27.2 Better pattern

For large files:

- read chunks using dedicated IO strategy;
- memory-map if appropriate;
- producer-consumer pipeline;
- explicit bounded executor;
- batch parse after read if safe.

## 27.3 Rule

Parallel stream over IO source needs measurement and careful design.

---

# 28. Resource Streams and Exception Handling

Exceptions can occur:

- while opening stream;
- during lazy traversal;
- inside mapper/filter;
- during close.

## 28.1 Example

```java
try (Stream<String> lines = Files.lines(path)) {
    return lines.map(this::parse).toList();
}
```

`parse` may throw runtime exception; close still runs.

## 28.2 IO exception during traversal

May be wrapped in unchecked exception depending API.

## 28.3 Rule

Resource stream errors may happen during terminal operation, not at stream creation only.

---

# 29. Checked Exceptions in Pipelines

Stream functional interfaces do not allow checked exceptions directly.

Bad ergonomics:

```java
lines.map(line -> parseChecked(line))
```

if `parseChecked` throws checked exception.

## 29.1 Options

- handle inside lambda;
- wrap checked exception;
- avoid stream and use loop;
- create helper functional interface carefully.

## 29.2 For resource workflows

Loops often give clearer error handling.

## 29.3 Rule

If checked exceptions dominate, a loop may be better than stream.

---

# 30. Resource Streams in APIs

Avoid API like:

```java
Stream<Record> findRecords();
```

if it hides DB cursor/resource.

## 30.1 Better names

```java
Stream<Record> openRecordStream();
```

and document caller must close.

## 30.2 Better wrapper

```java
interface RecordCursor extends AutoCloseable {
    Stream<Record> stream();
}
```

## 30.3 Better callback

```java
<R> R withRecords(Function<Stream<Record>, R> action);
```

## 30.4 Rule

APIs returning resource streams must make ownership obvious.

---

# 31. Resource Streams in Spring/Service Layers

Repository methods may return `Stream<T>` backed by DB cursor in some frameworks.

## 31.1 Risk

If not closed, cursor/connection can leak.

## 31.2 Transaction scope

Lazy stream may need active transaction while consumed.

## 31.3 Bad

```java
Stream<User> users = repository.streamAll();
return users.map(UserDto::from).toList();
```

without clear transaction/close handling.

## 31.4 Better

Consume inside transaction/resource boundary.

## 31.5 Rule

DB-backed streams require transaction and close scope discipline.

---

# 32. Resource Streams in Tests

Tests can hide leaks because dataset is small.

## 32.1 Use try-with-resources in tests too

```java
try (Stream<String> lines = Files.lines(testFile)) {
    assertEquals(3, lines.count());
}
```

## 32.2 Leak detection

On Windows, unclosed file streams may prevent file deletion.

## 32.3 Rule

Tests should model production resource hygiene.

---

# 33. Observability and Diagnostics

For resource leak diagnosis:

## 33.1 Symptoms

- too many open files;
- cannot delete file on Windows;
- DB connection pool exhaustion;
- directory handle leak;
- slow shutdown;
- file lock remains.

## 33.2 Tools

- OS lsof/handle tools;
- JFR file IO events;
- connection pool metrics;
- logs around open/close;
- `onClose` debug handler;
- try-with-resources audit.

## 33.3 Rule

Resource leaks are diagnosed by tracking ownership and close boundaries.

---

# 34. Common Anti-Patterns

## 34.1 Calling `Files.lines(path).count()` without close

Leak risk.

## 34.2 Returning `Files.lines(path)` without documentation

Ownership unclear.

## 34.3 Returning stream from inside try-with-resources

Already closed.

## 34.4 Assuming terminal operation closes stream

Wrong.

## 34.5 Assuming short-circuit closes stream

Wrong.

## 34.6 Using `peek` for close/cleanup

Wrong.

## 34.7 Parallelizing IO stream casually

Risky.

## 34.8 Not closing DB-backed stream

Connection/cursor leak.

## 34.9 Reusing stream

Illegal.

## 34.10 Ignoring suppressed exceptions

Hard diagnostics.

---

# 35. Production Failure Modes

## 35.1 Too many open files

Cause: unclosed `Files.lines/list/walk/find`.

## 35.2 File deletion fails on Windows

Cause: stream still open.

## 35.3 DB connection pool exhausted

Cause: repository stream not closed.

## 35.4 Directory handle leak

Cause: `Files.walk` not closed.

## 35.5 Lazy stream used after transaction closed

Cause: returned DB stream consumed outside transaction.

## 35.6 Stream already closed

Cause: returned stream from try-with-resources.

## 35.7 Partial read but resource open

Cause: `findFirst` without close.

## 35.8 Memory spike

Cause: materializing huge resource stream to list.

## 35.9 Slow/unstable parallel file processing

Cause: parallel over IO-backed source.

## 35.10 Lost cleanup

Cause: `onClose` handler but no close.

---

# 36. Best Practices

## 36.1 Close resource-backed streams

Use try-with-resources.

## 36.2 Do not close ordinary streams unnecessarily

Avoid noise.

## 36.3 Consume resource stream in same scope

Open, process, close.

## 36.4 Do not return resource stream unless ownership explicit

Name/document it.

## 36.5 Prefer callback pattern for resource stream APIs

Keeps ownership internal.

## 36.6 Handle lazy exceptions at terminal operation

Wrap/translate appropriately.

## 36.7 Avoid parallel IO streams unless proven

Measure and design explicitly.

## 36.8 Use materialization only when bounded

Do not `toList()` huge files carelessly.

## 36.9 Use loops when exception/resource logic is complex

Clarity beats fluent style.

## 36.10 Test resource closure

Especially on Windows/DB cursor cases.

---

# 37. Decision Matrix

| Situation | Need Close? | Recommended |
|---|---:|---|
| `List.stream()` | no | ordinary use |
| `Arrays.stream(array)` | no | ordinary use |
| `Stream.of(...)` | no | ordinary use |
| `IntStream.range(...)` | no | ordinary use |
| `Stream.generate(...)` | no resource close, but bound it | `limit`/short-circuit |
| `Files.lines(path)` | yes | try-with-resources |
| `Files.list(dir)` | yes | try-with-resources |
| `Files.walk(root)` | yes | try-with-resources + bounds |
| `Files.find(root, ...)` | yes | try-with-resources |
| DB cursor stream | yes | transaction + try-with-resources |
| HTTP response stream | yes | close response/body |
| custom stream with `onClose` cleanup | yes | guarantee close |
| returning stream from method | risky | document ownership or avoid |
| returning stream from try block | invalid | materialize or callback |
| short-circuit on file stream | yes still close | try-with-resources |
| stream consumed twice | invalid | supplier creates fresh stream |
| complex checked exceptions | maybe loop | explicit control flow |
| huge file to list | risky memory | stream/process incrementally |

---

# 38. Latihan

## Latihan 1 — Files.lines Leak

Write code using `Files.lines(path).count()` without try-with-resources.

Explain leak risk and fix it.

## Latihan 2 — Return Closed Stream

Explain why this is wrong:

```java
try (Stream<String> lines = Files.lines(path)) {
    return lines.filter(...);
}
```

## Latihan 3 — Callback Pattern

Implement:

```java
<R> R withLines(Path path, Function<Stream<String>, R> action)
```

## Latihan 4 — Short-Circuit Close

Use `findFirst` on `Files.lines` and still close correctly.

## Latihan 5 — Directory Walk

Use `Files.walk` to find `.java` files with max depth and close stream.

## Latihan 6 — onClose

Attach two `onClose` handlers and explain when they run.

## Latihan 7 — Stream Reuse

Show why stream cannot be consumed twice. Fix with supplier.

## Latihan 8 — DB Cursor Stream

Design safe service method for repository stream requiring transaction and close.

## Latihan 9 — Exception Handling

Compare stream vs loop for parsing file lines with checked exceptions.

## Latihan 10 — Production Leak Diagnosis

List symptoms and diagnostics for file descriptor leak from unclosed streams.

---

# 39. Ringkasan

Stream resource management is about ownership.

Core lessons:

- Not all streams need closing.
- Most in-memory streams do not need close.
- Resource-backed streams must be closed.
- `Files.lines`, `Files.list`, `Files.walk`, and `Files.find` should be used with try-with-resources.
- Stream laziness means resource remains open while stream is not closed.
- Terminal operation and short-circuiting do not replace close.
- Do not return resource streams unless caller ownership is explicit.
- Do not return streams from inside try-with-resources; they will be closed.
- Materialize inside resource boundary when result is bounded.
- Callback pattern keeps resource ownership internal.
- `onClose` runs only if stream is closed.
- Close exceptions can be suppressed under try-with-resources.
- Stream is single-use and cannot be reused after terminal operation or close.
- DB-backed streams require transaction and close scope.
- Parallel over IO-backed streams is risky and must be measured.
- Resource leaks manifest as file descriptor exhaustion, locked files, DB connection leaks, and directory handle leaks.

Main rule:

```text
If a stream opens or owns a resource, close it in the same ownership scope.
If it is just a view over in-memory data, do not add resource-management noise.
```

---

# 40. Referensi

1. Java SE 25 — `BaseStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/BaseStream.html

2. Java SE 25 — `Stream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html

3. Java SE 25 — `Files`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html

4. Java SE 25 — `AutoCloseable`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/AutoCloseable.html

5. Java SE 25 — `DirectoryStream`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/DirectoryStream.html

6. Java SE 25 — `Path`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Path.html

7. Java SE 25 — `UncheckedIOException`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/UncheckedIOException.html

8. Java SE 25 — `try-with-resources` Language Feature  
   https://docs.oracle.com/javase/tutorial/essential/exceptions/tryResourceClose.html

9. OpenJDK — Stream API source  
   https://github.com/openjdk/jdk/tree/master/src/java.base/share/classes/java/util/stream

10. OpenJDK — Files API source  
    https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/nio/file/Files.java
