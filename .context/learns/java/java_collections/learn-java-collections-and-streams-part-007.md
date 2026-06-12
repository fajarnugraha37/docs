# learn-java-collections-and-streams-part-007.md

# Java Collections and Streams — Part 007  
# Iteration Model: Iterable, Iterator, Enhanced For-Loop, ListIterator, Fail-Fast, Snapshot, Weakly Consistent Iterators, dan Safe Mutation During Traversal

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **007**  
> Fokus: memahami iteration sebagai **traversal contract**, bukan sekadar `for` loop. Kita akan membedah `Iterable`, `Iterator`, enhanced for-loop, `ListIterator`, fail-fast behavior, `ConcurrentModificationException`, snapshot iterator, weakly consistent iterator, safe removal, mutation during traversal, live views, concurrency implications, dan production failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Iteration adalah Traversal Contract](#2-mental-model-iteration-adalah-traversal-contract)
3. [`Iterable<T>`](#3-iterablet)
4. [`Iterator<E>`](#4-iteratore)
5. [Enhanced For-Loop Desugaring](#5-enhanced-for-loop-desugaring)
6. [One-Pass vs Multi-Pass Iteration](#6-one-pass-vs-multi-pass-iteration)
7. [External Iteration vs Internal Iteration](#7-external-iteration-vs-internal-iteration)
8. [Iterator State Machine](#8-iterator-state-machine)
9. [`Iterator.remove()`](#9-iteratorremove)
10. [Safe Removal Patterns](#10-safe-removal-patterns)
11. [`ListIterator<E>`](#11-listiteratore)
12. [Bidirectional Traversal](#12-bidirectional-traversal)
13. [Mutation with ListIterator](#13-mutation-with-listiterator)
14. [Fail-Fast Iterators](#14-fail-fast-iterators)
15. [`ConcurrentModificationException`](#15-concurrentmodificationexception)
16. [Fail-Fast is Best-Effort, Not Correctness Mechanism](#16-fail-fast-is-best-effort-not-correctness-mechanism)
17. [Snapshot Iterators](#17-snapshot-iterators)
18. [Weakly Consistent Iterators](#18-weakly-consistent-iterators)
19. [Fail-Fast vs Snapshot vs Weakly Consistent](#19-fail-fast-vs-snapshot-vs-weakly-consistent)
20. [Iteration and Map Views](#20-iteration-and-map-views)
21. [Iteration and Sequenced Collections](#21-iteration-and-sequenced-collections)
22. [Iteration and Streams](#22-iteration-and-streams)
23. [Iteration and Spliterator Preview](#23-iteration-and-spliterator-preview)
24. [Iteration and Concurrency](#24-iteration-and-concurrency)
25. [Iteration and Resource Lifetime](#25-iteration-and-resource-lifetime)
26. [Iteration and Lazy Sources](#26-iteration-and-lazy-sources)
27. [Iteration API Design](#27-iteration-api-design)
28. [Custom Iterable and Iterator](#28-custom-iterable-and-iterator)
29. [Production Failure Modes](#29-production-failure-modes)
30. [Best Practices](#30-best-practices)
31. [Decision Matrix](#31-decision-matrix)
32. [Latihan](#32-latihan)
33. [Ringkasan](#33-ringkasan)
34. [Referensi](#34-referensi)

---

# 1. Tujuan Bagian Ini

Iteration adalah fondasi dari:

- enhanced for-loop;
- collection traversal;
- map view traversal;
- stream source traversal;
- custom lazy source;
- fail-fast behavior;
- concurrent collection traversal;
- safe removal;
- resource-backed processing;
- Spliterator dan parallel stream.

Banyak developer tahu cara menulis:

```java
for (Item item : items) {
    process(item);
}
```

Tetapi engineer yang kuat bertanya:

```text
Apakah iterable ini bisa diulang dua kali?
Apakah iterator ini fail-fast?
Apakah boleh mutate saat iteration?
Apakah iterator ini snapshot?
Apakah iterator ini weakly consistent?
Apakah traversal ini menahan resource?
Apakah collection view ini live?
Apakah remove melalui iterator aman?
Apakah concurrent modification terdeteksi atau tidak?
```

Tujuan bagian ini:

- membedah `Iterable` dan `Iterator`;
- memahami enhanced for-loop;
- memahami state machine iterator;
- memahami safe mutation during iteration;
- memahami `ListIterator`;
- memahami fail-fast, snapshot, weakly consistent iterator;
- memahami iteration dalam map views, sequenced collections, stream, concurrency;
- mengenali production failure modes.

---

# 2. Mental Model: Iteration adalah Traversal Contract

Iteration bukan sekadar loop.

Iteration adalah kontrak:

```text
Bagaimana client mengunjungi element satu per satu.
```

## 2.1 Traversal source

Source bisa:

- collection in-memory;
- map view;
- file lines;
- database cursor;
- generated sequence;
- network page;
- custom lazy source.

## 2.2 Traversal policy

Iteration menjawab:

```text
Order apa?
Bisa remove?
Apa yang terjadi jika source berubah?
Apakah snapshot?
Apakah weakly consistent?
Apakah resource harus ditutup?
Apakah bisa diulang?
```

## 2.3 Example

```java
Iterable<CaseSummary> rows
```

lebih lemah daripada:

```java
Collection<CaseSummary> rows
```

`Iterable` hanya menjanjikan traversal.

`Collection` menjanjikan group dengan `size`, `contains`, dan operasi lain.

## 2.4 Rule

```text
Use Iterable when traversal is the only required capability.
```

---

# 3. `Iterable<T>`

`Iterable<T>` adalah interface untuk object yang bisa menyediakan `Iterator<T>`.

```java
public interface Iterable<T> {
    Iterator<T> iterator();
}
```

## 3.1 Enhanced for-loop requires Iterable

```java
for (CaseId id : ids) {
    process(id);
}
```

Bekerja jika `ids` adalah array atau implements `Iterable`.

## 3.2 Minimal abstraction

If method only needs to traverse:

```java
void export(Iterable<Row> rows, Writer writer)
```

This avoids forcing caller to materialize `Collection`.

## 3.3 `Iterable` does not guarantee size

No:

```java
size()
isEmpty()
contains()
```

## 3.4 `Iterable` does not guarantee repeatability

Some Iterable implementations can be one-shot.

Example conceptual:

```java
Iterable<String> lines = oneShotFileLines(path);
```

Calling `iterator()` twice may not be valid or may reopen resource depending implementation.

## 3.5 `Iterable.forEach`

Iterable has default:

```java
forEach(Consumer<? super T> action)
```

## 3.6 `spliterator`

Iterable has default `spliterator`.

But default spliterator may not be optimal.

## 3.7 Rule

`Iterable` says “you can traverse”, not “you have a reusable collection”.

---

# 4. `Iterator<E>`

`Iterator<E>` is the object that performs traversal.

Core methods:

```java
boolean hasNext()
E next()
default void remove()
default void forEachRemaining(Consumer<? super E> action)
```

## 4.1 `hasNext`

Checks if there is next element.

## 4.2 `next`

Returns next element.

If no next element, throws `NoSuchElementException`.

## 4.3 `remove`

Removes last element returned by this iterator if supported.

Can throw:

- `UnsupportedOperationException`;
- `IllegalStateException`;
- `ConcurrentModificationException` depending source/state.

## 4.4 `forEachRemaining`

Consumes all remaining elements:

```java
iterator.forEachRemaining(this::process);
```

## 4.5 Iterator is stateful

An iterator remembers current traversal position.

## 4.6 Rule

Do not reuse iterator after traversal is exhausted unless API explicitly supports reset, which standard Iterator does not.

---

# 5. Enhanced For-Loop Desugaring

Code:

```java
for (CaseId id : caseIds) {
    process(id);
}
```

is conceptually like:

```java
for (Iterator<CaseId> it = caseIds.iterator(); it.hasNext(); ) {
    CaseId id = it.next();
    process(id);
}
```

## 5.1 Why this matters

If you mutate collection directly inside enhanced for-loop:

```java
for (CaseId id : caseIds) {
    caseIds.remove(id);
}
```

you are mutating outside iterator.

For fail-fast collections, this can cause `ConcurrentModificationException`.

## 5.2 Correct removal

```java
Iterator<CaseId> it = caseIds.iterator();
while (it.hasNext()) {
    CaseId id = it.next();
    if (shouldRemove(id)) {
        it.remove();
    }
}
```

## 5.3 Enhanced for over arrays

Array enhanced for does not use Iterator; it uses index-like traversal.

## 5.4 Rule

Enhanced for-loop hides iterator, so you cannot call iterator.remove from it.

---

# 6. One-Pass vs Multi-Pass Iteration

## 6.1 Multi-pass collection

Most collections can be iterated multiple times:

```java
for (E e : list) {}
for (E e : list) {}
```

## 6.2 One-pass source

Some Iterable-like sources may be one-shot:

- generator;
- IO cursor;
- database cursor;
- queue-draining iterable;
- stream-like wrapper.

## 6.3 API implication

If your method needs multiple passes, do not accept arbitrary Iterable unless documented.

Bad:

```java
void validateTwice(Iterable<Row> rows) {
    for (Row row : rows) validateA(row);
    for (Row row : rows) validateB(row);
}
```

This may fail for one-shot source.

Better:

- accept `Collection`;
- materialize list explicitly;
- document requirement.

## 6.4 Rule

`Iterable` does not always imply reusable traversal.

---

# 7. External Iteration vs Internal Iteration

## 7.1 External iteration

Caller controls traversal.

```java
for (Row row : rows) {
    if (row.isInvalid()) {
        break;
    }
}
```

## 7.2 Internal iteration

Library controls traversal.

```java
rows.forEach(row -> process(row));
```

or stream:

```java
rows.stream().forEach(this::process);
```

## 7.3 External iteration strengths

- break/continue;
- checked exception handling;
- mutation through iterator;
- complex state machine;
- easier debugging.

## 7.4 Internal iteration strengths

- declarative;
- composable;
- stream transformations;
- potential parallelism;
- less boilerplate.

## 7.5 Rule

Use external iteration when control flow/mutation is central. Use internal iteration for transformations.

---

# 8. Iterator State Machine

Iterator has implicit state.

Conceptually:

```text
before first
  -> next returns first
  -> next returns second
  -> ...
  -> exhausted
```

`remove` has its own state rule:

```text
remove can be called once after next, before another remove.
```

## 8.1 Valid

```java
Iterator<E> it = list.iterator();
E e = it.next();
it.remove();
```

## 8.2 Invalid

```java
Iterator<E> it = list.iterator();
it.remove(); // IllegalStateException
```

because `next` has not been called.

## 8.3 Invalid double remove

```java
E e = it.next();
it.remove();
it.remove(); // IllegalStateException
```

## 8.4 Next after exhaustion

```java
while (it.hasNext()) {
    it.next();
}
it.next(); // NoSuchElementException
```

## 8.5 Rule

Iterator is a cursor with rules, not just a loop helper.

---

# 9. `Iterator.remove()`

`Iterator.remove()` removes the last element returned by this iterator.

## 9.1 Why useful

It is the safe way to remove during iteration for many mutable fail-fast collections.

## 9.2 Example

```java
Iterator<CaseId> it = caseIds.iterator();
while (it.hasNext()) {
    CaseId id = it.next();
    if (shouldRemove(id)) {
        it.remove();
    }
}
```

## 9.3 Unsupported

Some iterators do not support remove.

Examples:

- immutable collections;
- some concurrent/snapshot iterators;
- custom read-only iterators.

## 9.4 Remove from Map view

```java
Iterator<Map.Entry<K,V>> it = map.entrySet().iterator();
while (it.hasNext()) {
    Map.Entry<K,V> entry = it.next();
    if (shouldRemove(entry)) {
        it.remove();
    }
}
```

Removes mapping from map.

## 9.5 Rule

If mutating during traversal, prefer iterator-supported mutation or bulk methods like `removeIf`.

---

# 10. Safe Removal Patterns

## 10.1 `removeIf`

For collection:

```java
items.removeIf(this::shouldRemove);
```

Best for simple predicate.

## 10.2 Iterator remove

```java
Iterator<Item> it = items.iterator();
while (it.hasNext()) {
    if (shouldRemove(it.next())) {
        it.remove();
    }
}
```

Best when you need manual traversal.

## 10.3 Collect then remove

```java
List<Item> toRemove = items.stream()
    .filter(this::shouldRemove)
    .toList();

items.removeAll(toRemove);
```

Useful if removal decision needs pipeline, but may be less efficient and equality-dependent.

## 10.4 Copy filtered list

For immutable approach:

```java
List<Item> kept = items.stream()
    .filter(Predicate.not(this::shouldRemove))
    .toList();
```

## 10.5 Avoid direct remove in enhanced for-loop

Bad:

```java
for (Item item : items) {
    if (shouldRemove(item)) {
        items.remove(item);
    }
}
```

## 10.6 Rule

Choose mutation pattern intentionally.

---

# 11. `ListIterator<E>`

`ListIterator` extends Iterator for lists.

It supports:

```java
hasPrevious()
previous()
nextIndex()
previousIndex()
set(E e)
add(E e)
```

## 11.1 Bidirectional traversal

Unlike Iterator, ListIterator can go both directions.

## 11.2 Positional mutation

Can:

- remove;
- set last returned element;
- add at cursor position.

## 11.3 Creation

```java
ListIterator<E> it = list.listIterator();
ListIterator<E> itAtIndex = list.listIterator(index);
```

## 11.4 Works with List

Only lists provide ListIterator.

## 11.5 Rule

Use ListIterator when list-position-aware traversal/mutation is required.

---

# 12. Bidirectional Traversal

## 12.1 Forward

```java
ListIterator<E> it = list.listIterator();
while (it.hasNext()) {
    E e = it.next();
}
```

## 12.2 Backward

```java
ListIterator<E> it = list.listIterator(list.size());
while (it.hasPrevious()) {
    E e = it.previous();
}
```

## 12.3 Use cases

- reverse processing with mutation;
- parsing around cursor;
- editor-like operations;
- list transformation in place.

## 12.4 Alternative

For simple reverse traversal on Java 21+:

```java
for (E e : list.reversed()) {
    ...
}
```

## 12.5 Rule

Use ListIterator when cursor operations matter; use reversed view for simple reverse traversal.

---

# 13. Mutation with ListIterator

## 13.1 `set`

Replace last returned element.

```java
ListIterator<String> it = list.listIterator();
while (it.hasNext()) {
    String value = it.next();
    if (value.isBlank()) {
        it.set("<blank>");
    }
}
```

## 13.2 `add`

Insert at cursor.

```java
ListIterator<String> it = list.listIterator();
while (it.hasNext()) {
    String value = it.next();
    if (needsMarker(value)) {
        it.add("MARKER");
    }
}
```

## 13.3 `remove`

Remove last returned element.

## 13.4 State rules

Calling `set` or `remove` before `next/previous` invalid.

After `add`, remove/set state resets.

## 13.5 Implementation support

Immutable/fixed-size lists may throw `UnsupportedOperationException`.

## 13.6 Rule

ListIterator is powerful but stateful. Use sparingly and test edge cases.

---

# 14. Fail-Fast Iterators

Many standard mutable collections have fail-fast iterators.

Examples commonly include:

- `ArrayList`;
- `HashMap` views;
- `HashSet`;
- `LinkedHashMap`;
- `LinkedHashSet`;
- `TreeMap`;
- `TreeSet`.

## 14.1 Meaning

If collection is structurally modified after iterator is created, except through iterator's own remove/add/set where supported, iterator may throw:

```java
ConcurrentModificationException
```

## 14.2 Structural modification

Typically means adding/removing elements or otherwise changing size/structure.

Changing value via `set` may or may not be structural depending collection.

## 14.3 Example

```java
List<String> xs = new ArrayList<>(List.of("A", "B"));

for (String x : xs) {
    xs.add("C"); // ConcurrentModificationException likely
}
```

## 14.4 Why fail-fast exists

To detect bugs early rather than allow unpredictable behavior.

## 14.5 Not guaranteed

Fail-fast behavior is best-effort.

## 14.6 Rule

Fail-fast is a bug detector, not synchronization.

---

# 15. `ConcurrentModificationException`

`ConcurrentModificationException` is often misunderstood.

## 15.1 Not only multithreading

It can happen in single-thread code:

```java
for (String s : list) {
    list.remove(s);
}
```

## 15.2 Means structural modification during iteration

The collection detected modification not allowed by iterator protocol.

## 15.3 Not reliable for correctness

Do not write:

```java
try {
    iterate();
} catch (ConcurrentModificationException e) {
    recover();
}
```

This is wrong.

## 15.4 How to fix

Use:

- iterator.remove;
- removeIf;
- copy then mutate;
- concurrent collection;
- external synchronization;
- immutable snapshot.

## 15.5 Rule

Treat ConcurrentModificationException as design bug signal.

---

# 16. Fail-Fast is Best-Effort, Not Correctness Mechanism

This is critical.

Fail-fast iterators are usually implemented using a modification count check.

But under unsynchronized concurrent modification, there is no hard guarantee that iterator will always detect it.

## 16.1 Why best-effort?

Concurrent unsynchronized access has memory visibility/race issues.

Iterator may or may not see modification count changes.

## 16.2 Correct approach

If multiple threads access mutable collection:

- synchronize externally;
- use concurrent collection;
- use immutable snapshot;
- use copy-on-write structure;
- use proper ownership.

## 16.3 Bad design

```java
// unsafe
List<Job> jobs = new ArrayList<>();

// thread A iterates
// thread B mutates
```

Expecting ConcurrentModificationException to protect you is wrong.

## 16.4 Rule

Fail-fast is for detecting accidental bugs, not for concurrent safety.

---

# 17. Snapshot Iterators

A snapshot iterator traverses a snapshot of collection state taken when iterator was created.

## 17.1 CopyOnWriteArrayList

`CopyOnWriteArrayList` iterator provides a snapshot of the list state when iterator was constructed. The underlying array for that iterator does not change during iterator lifetime; iterator does not reflect later additions/removals/changes and does not throw `ConcurrentModificationException`.

## 17.2 Example

```java
CopyOnWriteArrayList<String> xs = new CopyOnWriteArrayList<>();
xs.add("A");
xs.add("B");

Iterator<String> it = xs.iterator();

xs.add("C");

while (it.hasNext()) {
    System.out.println(it.next()); // A, B
}
```

## 17.3 Iterator mutation unsupported

Snapshot iterator usually does not support remove/set/add.

## 17.4 Strengths

- safe traversal without locking;
- read-heavy/write-light workloads;
- listener lists.

## 17.5 Weaknesses

- writes are expensive;
- iterator sees stale snapshot;
- memory cost on mutation.

## 17.6 Rule

Snapshot iterator is great for stable traversal, not for up-to-date live view.

---

# 18. Weakly Consistent Iterators

Concurrent collections often provide weakly consistent iterators.

Example:

```java
ConcurrentHashMap
```

Its views' iterators and spliterators are weakly consistent.

## 18.1 Meaning

A weakly consistent iterator:

- does not throw `ConcurrentModificationException`;
- may reflect some modifications after iterator creation;
- may not reflect others;
- traverses safely during concurrent modifications.

## 18.2 Example

```java
ConcurrentHashMap<String, Integer> map = new ConcurrentHashMap<>();
map.put("A", 1);

Iterator<String> it = map.keySet().iterator();

map.put("B", 2);

while (it.hasNext()) {
    System.out.println(it.next());
}
```

Iterator may or may not see B.

## 18.3 Strengths

- safe concurrent traversal;
- no global locking;
- good for monitoring/snapshot-ish observation.

## 18.4 Weaknesses

- not a consistent snapshot;
- not deterministic under concurrent mutation;
- not suitable if exact point-in-time view required.

## 18.5 Rule

Weakly consistent means safe but not exact.

---

# 19. Fail-Fast vs Snapshot vs Weakly Consistent

| Type | Throws CME? | Sees later changes? | Exact snapshot? | Use case |
|---|---:|---:|---:|---|
| Fail-fast | may throw | not safe/allowed | no | normal mutable collections, bug detection |
| Snapshot | no | no | yes, at iterator creation | read-mostly copy-on-write |
| Weakly consistent | no | maybe | no | concurrent live structures |

## 19.1 Fail-fast example

```java
ArrayList
HashMap
```

## 19.2 Snapshot example

```java
CopyOnWriteArrayList
```

## 19.3 Weakly consistent example

```java
ConcurrentHashMap
ConcurrentLinkedQueue
```

## 19.4 Design choice

Ask:

```text
Do I need exact snapshot, latest view, or safe approximate traversal?
```

## 19.5 Rule

Do not confuse “does not throw CME” with “iteration is exactly consistent”.

---

# 20. Iteration and Map Views

Map views are iterable:

```java
map.keySet()
map.values()
map.entrySet()
```

## 20.1 Prefer entrySet for key+value

Bad:

```java
for (K key : map.keySet()) {
    V value = map.get(key);
}
```

Better:

```java
for (Map.Entry<K,V> entry : map.entrySet()) {
    K key = entry.getKey();
    V value = entry.getValue();
}
```

## 20.2 View is backed

Removing through iterator removes mapping:

```java
Iterator<Map.Entry<K,V>> it = map.entrySet().iterator();
while (it.hasNext()) {
    if (shouldRemove(it.next())) {
        it.remove();
    }
}
```

## 20.3 Values view duplicates

`map.values()` is Collection, not Set.

## 20.4 ConcurrentHashMap views

Weakly consistent iterators.

## 20.5 Rule

Map view iteration is map mutation path. Treat views carefully.

---

# 21. Iteration and Sequenced Collections

Sequenced collections define encounter order.

## 21.1 Forward traversal

```java
for (E e : sequenced) {
    ...
}
```

Uses encounter order.

## 21.2 Reverse traversal

```java
for (E e : sequenced.reversed()) {
    ...
}
```

Uses reverse encounter order.

## 21.3 First/last

```java
sequenced.getFirst();
sequenced.getLast();
```

## 21.4 Reversed view caveat

It is view, not necessarily copy.

## 21.5 Rule

Sequenced interfaces make traversal order explicit, but mutability/view semantics still matter.

---

# 22. Iteration and Streams

Streams use internal iteration.

## 22.1 Collection stream

```java
collection.stream()
```

uses collection's spliterator.

## 22.2 Iterator vs Stream

Iterator:

- pull-based;
- external control;
- can remove if supported.

Stream:

- pipeline-based;
- terminal operation controls traversal;
- no direct mutation protocol.

## 22.3 Iterator to Stream

```java
Iterable<T> iterable = ...;
Stream<T> stream = StreamSupport.stream(iterable.spliterator(), false);
```

## 22.4 Stream to Iterator

```java
Iterator<T> it = stream.iterator();
```

But remember stream is single-use and may need closing if resource-backed.

## 22.5 Mutation during stream

Modifying source during stream traversal can violate non-interference and cause bugs/CME.

## 22.6 Rule

Use iterator for controlled mutation/traversal; use stream for transformations/reductions.

---

# 23. Iteration and Spliterator Preview

Spliterator is next-level traversal.

## 23.1 Iterator limitation

Iterator gives:

- sequential traversal;
- maybe remove.

But not:

- split for parallelism;
- size estimate;
- characteristics.

## 23.2 Spliterator adds

```java
tryAdvance
trySplit
estimateSize
characteristics
```

## 23.3 Stream uses Spliterator

Collection streams use spliterator to know:

- order;
- size;
- distinct;
- sorted;
- concurrent;
- immutable;
- splitting quality.

## 23.4 Why mention now?

Because iteration model leads naturally to Spliterator.

## 23.5 Rule

Iterator is cursor traversal. Spliterator is traversal + partitioning metadata.

---

# 24. Iteration and Concurrency

## 24.1 Non-thread-safe collection

Do not iterate and mutate concurrently without synchronization.

## 24.2 External synchronization

```java
List<T> list = Collections.synchronizedList(new ArrayList<>());

synchronized (list) {
    Iterator<T> it = list.iterator();
    while (it.hasNext()) {
        process(it.next());
    }
}
```

## 24.3 Immutable snapshot

```java
List<T> snapshot = List.copyOf(sharedList);
for (T item : snapshot) {
    process(item);
}
```

## 24.4 Concurrent collection

Use concurrent iterators when approximate live traversal is okay.

## 24.5 CopyOnWrite

Use snapshot iteration when read-heavy/write-light.

## 24.6 Rule

Choose concurrency iteration model explicitly: lock, snapshot, concurrent weak consistency, or copy-on-write.

---

# 25. Iteration and Resource Lifetime

Some iterables/streams are resource-backed.

Examples:

- file lines;
- database cursor;
- network pages;
- directory stream.

## 25.1 Danger

If iterator holds file handle, traversal must close resource.

## 25.2 Stream close

```java
try (Stream<String> lines = Files.lines(path)) {
    lines.forEach(this::process);
}
```

## 25.3 Iterable close

If custom Iterable needs close, consider:

```java
interface CloseableIterable<T> extends Iterable<T>, AutoCloseable {}
```

## 25.4 Do not leak resource iterator

Bad:

```java
Iterable<Row> rows() {
    return openCursorRows();
}
```

if caller does not know close responsibility.

## 25.5 Rule

Resource-backed traversal must have explicit lifetime ownership.

---

# 26. Iteration and Lazy Sources

## 26.1 Lazy generation

Iterator can generate values on demand.

```java
Iterator<Integer> naturals = ...
```

## 26.2 Infinite source

Some iterators may be infinite.

Do not call:

```java
toList()
```

without limit.

## 26.3 Paging source

Iterator may fetch pages as needed.

## 26.4 Failure during iteration

Lazy source can throw mid-iteration:

- IO error;
- DB timeout;
- parse error.

## 26.5 Rule

Lazy iteration shifts work and failure from creation time to traversal time.

---

# 27. Iteration API Design

## 27.1 Accept Iterable

Good if only traverse once:

```java
void writeRows(Iterable<Row> rows)
```

## 27.2 Accept Collection

If size/multi-pass needed:

```java
void validate(Collection<Row> rows)
```

## 27.3 Return Iterable

Good for lazy, but document lifetime/repeatability.

## 27.4 Return Collection/List

Good when result materialized and reusable.

## 27.5 Return Stream

Good when pipeline semantics/lazy traversal needed, but resource lifetime must be clear.

## 27.6 Callback alternative

```java
void forEachRow(Consumer<Row> consumer)
```

Can control resource lifetime internally.

## 27.7 Rule

API should state traversal ownership, repeatability, and resource lifetime.

---

# 28. Custom Iterable and Iterator

## 28.1 Simple range iterable

```java
public final class IntRange implements Iterable<Integer> {
    private final int startInclusive;
    private final int endExclusive;

    public IntRange(int startInclusive, int endExclusive) {
        if (endExclusive < startInclusive) {
            throw new IllegalArgumentException();
        }
        this.startInclusive = startInclusive;
        this.endExclusive = endExclusive;
    }

    @Override
    public Iterator<Integer> iterator() {
        return new Iterator<>() {
            private int current = startInclusive;

            @Override
            public boolean hasNext() {
                return current < endExclusive;
            }

            @Override
            public Integer next() {
                if (!hasNext()) {
                    throw new NoSuchElementException();
                }
                return current++;
            }
        };
    }
}
```

## 28.2 Repeatable

This iterable creates new iterator each time, so repeatable.

## 28.3 One-shot example

```java
public final class OneShotIterable<T> implements Iterable<T> {
    private Iterator<T> iterator;

    public OneShotIterable(Iterator<T> iterator) {
        this.iterator = Objects.requireNonNull(iterator);
    }

    @Override
    public Iterator<T> iterator() {
        if (iterator == null) {
            throw new IllegalStateException("Already consumed");
        }
        Iterator<T> result = iterator;
        iterator = null;
        return result;
    }
}
```

## 28.4 Custom remove

If remove unsupported, default Iterator.remove throws UnsupportedOperationException.

## 28.5 Rule

Custom Iterable must define repeatability and mutation behavior.

---

# 29. Production Failure Modes

## 29.1 Direct remove in enhanced for-loop

```java
for (E e : list) {
    list.remove(e);
}
```

Fix: iterator.remove/removeIf/copy.

## 29.2 Relying on ConcurrentModificationException

CME not guaranteed under race.

Fix: proper synchronization/concurrent collection.

## 29.3 Snapshot iterator stale data

CopyOnWriteArrayList iterator does not see new elements.

Fix: understand snapshot semantics.

## 29.4 Weakly consistent iterator used for exact report

ConcurrentHashMap iteration misses/includes concurrent updates nondeterministically.

Fix: snapshot copy if exact point-in-time needed.

## 29.5 Map view exposed

Caller mutates `keySet` and deletes map entries.

Fix: return copy.

## 29.6 `Iterator.remove` unsupported

Immutable collection iterator throws.

Fix: use mutable copy or functional filter.

## 29.7 `next` without `hasNext`

NoSuchElementException.

Fix: check or design loop correctly.

## 29.8 Resource-backed iterator leaked

File/DB cursor not closed.

Fix: try-with-resources or callback.

## 29.9 One-shot Iterable iterated twice

Second pass fails or empty.

Fix: require Collection or materialize.

## 29.10 Concurrent queue iterator assumption

Iterator may be weakly consistent and not reflect exact queue state.

Fix: drain with poll if consuming.

## 29.11 Reversed view mutation surprise

Mutating reversed view affects original.

Fix: copy before exposing.

## 29.12 Stream source modified during traversal

Violates non-interference.

Fix: snapshot or avoid mutation.

---

# 30. Best Practices

## 30.1 General

- Use enhanced for-loop for simple traversal.
- Use Iterator when you need safe removal.
- Use ListIterator for bidirectional/positional list mutation.
- Use removeIf for predicate removal.
- Use entrySet for map key+value traversal.
- Avoid direct collection mutation inside enhanced for-loop.
- Do not rely on CME for correctness.

## 30.2 Concurrency

- Use immutable snapshot for exact stable traversal.
- Use concurrent collections for safe live approximate traversal.
- Use CopyOnWriteArrayList for read-heavy snapshot iteration.
- Synchronize externally when using synchronized wrappers.

## 30.3 API

- Accept Iterable only for one-pass traversal.
- Accept Collection if size/multi-pass needed.
- Document one-shot/resource-backed iterables.
- Avoid returning resource-backed iterables without close protocol.

## 30.4 Streams

- Use streams for transformations, not mutation-heavy traversal.
- Do not mutate source during stream.
- Close resource-backed streams.

## 30.5 Custom iterators

- Follow Iterator state rules.
- Throw NoSuchElementException when exhausted.
- Clearly define remove support.
- Define repeatability.

---

# 31. Decision Matrix

| Requirement | Recommended |
|---|---|
| simple traversal | enhanced for-loop |
| remove while traversing | explicit `Iterator.remove` or `removeIf` |
| bidirectional list traversal | `ListIterator` |
| replace/add during list traversal | `ListIterator` |
| transform/filter/reduce | Stream |
| exact stable traversal under mutation | immutable snapshot copy |
| read-heavy concurrent iteration | `CopyOnWriteArrayList` |
| live concurrent approximate traversal | concurrent collection weakly consistent iterator |
| exact concurrent view | lock or snapshot |
| key+value map traversal | `entrySet` |
| reverse ordered traversal Java 21+ | `sequenced.reversed()` |
| resource-backed traversal | try-with-resources/callback |
| one-pass source | `Iterable` with documentation or `Stream` |
| multi-pass requirement | `Collection`/`List` |
| destructive queue processing | `poll` loop, not iterator |

---

# 32. Latihan

## Latihan 1 — Enhanced For Desugaring

Tuliskan ulang:

```java
for (String s : list) {
    process(s);
}
```

menjadi iterator manual.

## Latihan 2 — Safe Removal

Perbaiki:

```java
for (CaseId id : ids) {
    if (shouldRemove(id)) {
        ids.remove(id);
    }
}
```

dengan:

1. iterator.remove;
2. removeIf;
3. immutable filtered copy.

## Latihan 3 — ListIterator

Buat method yang mengganti semua blank string menjadi `"<blank>"` menggunakan `ListIterator.set`.

## Latihan 4 — Snapshot Iterator

Dengan `CopyOnWriteArrayList`, buat iterator, lalu mutate list. Tunjukkan iterator melihat snapshot lama.

## Latihan 5 — Weakly Consistent Iterator

Dengan `ConcurrentHashMap`, iterate `keySet` sambil menambahkan key. Jelaskan kenapa hasil tidak boleh diasumsikan exact.

## Latihan 6 — One-Shot Iterable

Implement `OneShotIterable` dan tunjukkan bahwa iterasi kedua gagal.

## Latihan 7 — Resource Lifetime

Desain API untuk membaca file rows:

1. return Stream;
2. callback;
3. CloseableIterable.

Bandingkan lifetime responsibilities.

## Latihan 8 — Map View Mutation

Tunjukkan bahwa:

```java
map.keySet().remove(key)
```

menghapus mapping dari map.

---

# 33. Ringkasan

Iteration adalah traversal contract.

Core lessons:

- `Iterable` hanya menjanjikan traversal.
- `Iterator` adalah cursor stateful.
- Enhanced for-loop memakai Iterator untuk Iterable.
- `Iterable` tidak selalu multi-pass.
- Iterator remove adalah safe removal path jika supported.
- `ListIterator` mendukung bidirectional traversal dan positional mutation.
- Fail-fast iterator mendeteksi concurrent structural modification secara best-effort.
- `ConcurrentModificationException` bukan concurrency control.
- Snapshot iterator melihat state saat iterator dibuat.
- Weakly consistent iterator aman terhadap concurrent modification, tetapi tidak exact snapshot.
- Map views adalah live views dan iteration bisa mutate map.
- Sequenced collections membuat forward/reversed traversal lebih semantic.
- Streams memakai internal iteration dan harus non-interfering.
- Resource-backed traversal butuh close/lifetime contract.
- API harus menjelaskan repeatability, ownership, mutation, dan resource lifetime.

Main rule:

```text
Iteration is not just looping. It is a contract about traversal, mutation, consistency, and lifetime.
```

---

# 34. Referensi

1. Java SE 25 — `Iterable`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Iterable.html

2. Java SE 25 — `Iterator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Iterator.html

3. Java SE 25 — `ListIterator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ListIterator.html

4. Java SE 25 — `ConcurrentModificationException`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ConcurrentModificationException.html

5. Java SE 25 — `Collection`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html

6. Java SE 25 — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

7. Java SE 25 — `CopyOnWriteArrayList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CopyOnWriteArrayList.html

8. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

9. Java SE 25 — `SequencedCollection`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SequencedCollection.html

10. Java SE 25 — `Spliterator`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Spliterator.html
