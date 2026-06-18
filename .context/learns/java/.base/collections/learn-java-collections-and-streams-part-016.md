# learn-java-collections-and-streams-part-016.md

# Java Collections and Streams — Part 016  
# ArrayList Internals Deep Dive: Resizable Array, Capacity, Growth, ElementData, Shifting, RandomAccess, subList, Iterator, Spliterator, Memory, and Production Performance

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **016**  
> Fokus: memahami `ArrayList` dari dalam: backing array, size vs capacity, growth/resizing, amortized append, insertion/removal shifting, `RandomAccess`, null elements, `modCount`, fail-fast iterator, `subList` view, `toArray`, `ensureCapacity`, `trimToSize`, spliterator, memory layout, GC pressure, dan kapan `ArrayList` tepat/tidak tepat di production.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: ArrayList adalah Dynamic Object Array](#2-mental-model-arraylist-adalah-dynamic-object-array)
3. [Public Contract vs Internal Implementation](#3-public-contract-vs-internal-implementation)
4. [Core Fields Conceptually](#4-core-fields-conceptually)
5. [Size vs Capacity](#5-size-vs-capacity)
6. [Backing Array: `elementData`](#6-backing-array-elementdata)
7. [Lazy/Empty Array Behavior](#7-lazyempty-array-behavior)
8. [Growth and Resizing](#8-growth-and-resizing)
9. [Amortized O(1) Append](#9-amortized-o1-append)
10. [`ensureCapacity`](#10-ensurecapacity)
11. [`trimToSize`](#11-trimtosize)
12. [`add(E)`](#12-adde)
13. [`add(index, E)`](#13-addindex-e)
14. [`get(index)` and `set(index, E)`](#14-getindex-and-setindex-e)
15. [`remove(index)`](#15-removeindex)
16. [`remove(Object)`](#16-removeobject)
17. [Shifting Cost](#17-shifting-cost)
18. [Null Elements](#18-null-elements)
19. [`contains`, `indexOf`, and Equality Cost](#19-contains-indexof-and-equality-cost)
20. [`RandomAccess`](#20-randomaccess)
21. [Iteration Cost](#21-iteration-cost)
22. [Iterator, ListIterator, and `modCount`](#22-iterator-listiterator-and-modcount)
23. [Fail-Fast Behavior](#23-fail-fast-behavior)
24. [`subList` View](#24-sublist-view)
25. [`reversed()` View in Java 21+](#25-reversed-view-in-java-21)
26. [`toArray`](#26-toarray)
27. [Spliterator](#27-spliterator)
28. [ArrayList and Streams](#28-arraylist-and-streams)
29. [Memory Footprint](#29-memory-footprint)
30. [ArrayList vs Array](#30-arraylist-vs-array)
31. [ArrayList vs LinkedList](#31-arraylist-vs-linkedlist)
32. [ArrayList vs ArrayDeque](#32-arraylist-vs-arraydeque)
33. [ArrayList vs CopyOnWriteArrayList](#33-arraylist-vs-copyonwritearraylist)
34. [ArrayList in API/Domain/DTO Boundaries](#34-arraylist-in-apidomaindto-boundaries)
35. [Concurrency Hazards](#35-concurrency-hazards)
36. [Production Diagnostics](#36-production-diagnostics)
37. [Production Failure Modes](#37-production-failure-modes)
38. [Best Practices](#38-best-practices)
39. [Decision Matrix](#39-decision-matrix)
40. [Latihan](#40-latihan)
41. [Ringkasan](#41-ringkasan)
42. [Referensi](#42-referensi)

---

# 1. Tujuan Bagian Ini

`ArrayList` adalah default `List` implementation di banyak code Java.

Banyak developer tahu:

```text
ArrayList get O(1)
ArrayList add O(1) amortized
ArrayList remove middle O(n)
```

Tapi untuk production, kamu perlu memahami:

```text
Apa beda size dan capacity?
Kapan backing array dialokasikan?
Kapan resize terjadi?
Apa biaya shifting?
Kenapa remove dari depan mahal?
Kenapa ArrayList sering lebih cepat dari LinkedList?
Apa efek ensureCapacity?
Apa efek trimToSize?
Apa itu modCount?
Apa bahaya subList?
Kenapa ArrayList bagus untuk stream parallel?
Kapan boxing membuat ArrayList mahal?
Kenapa ArrayList bukan thread-safe?
```

Tujuan bagian ini:

- memahami internal resizable array;
- memahami cost model detail;
- memahami operation-level behavior;
- memahami memory/GC implications;
- memahami failure modes;
- tahu kapan ArrayList tepat/tidak.

---

# 2. Mental Model: ArrayList adalah Dynamic Object Array

`ArrayList<E>` adalah wrapper di atas array object yang ukurannya bisa bertumbuh.

Conceptual:

```text
ArrayList
  size = 3
  elementData = [A, B, C, null, null, null, ...]
```

## 2.1 Size

Jumlah element logical.

```java
list.size()
```

## 2.2 Capacity

Panjang backing array.

Tidak terlihat langsung di public API.

## 2.3 Add at end

Jika masih ada capacity:

```text
elementData[size] = newElement
size++
```

## 2.4 Add in middle

Geser elements kanan.

```text
[A, B, C]
add(1, X)
[A, X, B, C]
```

## 2.5 Remove in middle

Geser elements kiri.

```text
[A, X, B, C]
remove(1)
[A, B, C]
```

## 2.6 Main rule

```text
ArrayList is excellent when you append/read/iterate, but weaker when you mutate near the front/middle frequently.
```

---

# 3. Public Contract vs Internal Implementation

Public contract:

```java
List<E>
```

menyediakan:

- positional access;
- order;
- duplicates;
- optional null support depending implementation;
- index-based operations.

`ArrayList` implementation contract:

- resizable-array implementation;
- permits null;
- unsynchronized;
- constant-time positional access;
- amortized constant-time add at end.

## 3.1 Internal implementation can change

Do not depend on:

- exact growth factor;
- exact empty-array sentinel;
- exact private field names;
- exact spliterator implementation.

## 3.2 Why study internals?

To reason about:

- performance;
- memory;
- copying;
- iteration;
- failure mode;
- API design.

## 3.3 Rule

Use internals to understand behavior, not to write code coupled to internals.

---

# 4. Core Fields Conceptually

ArrayList conceptually has:

```java
transient Object[] elementData;
int size;
int modCount; // inherited from AbstractList conceptually
```

## 4.1 `elementData`

Backing array storing references to elements.

## 4.2 `size`

Number of logical elements.

## 4.3 `modCount`

Counts structural modifications for fail-fast iterator/listIterator/spliterator behavior.

## 4.4 Not storing type E

Because generics are erased, the backing array is effectively Object array.

## 4.5 Rule

ArrayList is an object containing an Object[] and a logical size.

---

# 5. Size vs Capacity

This is one of the most important distinctions.

## 5.1 Size

```java
list.size()
```

Number of elements user sees.

## 5.2 Capacity

Number of slots in internal array before resizing needed.

Not exposed directly.

## 5.3 Example

```text
size = 3
capacity = 10
elementData = [A, B, C, null, null, null, null, null, null, null]
```

## 5.4 Why capacity exists

To avoid reallocating on every add.

## 5.5 Capacity can exceed size

After many adds/removes, capacity can remain large.

## 5.6 Rule

ArrayList can retain memory even after elements removed because capacity may remain.

---

# 6. Backing Array: `elementData`

OpenJDK implementation uses an internal array field commonly named `elementData`.

## 6.1 Stores references

For object list:

```java
ArrayList<User>
```

backing array stores references to User objects.

## 6.2 Does not store primitives

```java
ArrayList<Integer>
```

stores references to Integer objects.

## 6.3 Null slots

Unused capacity slots are null.

When removing element, ArrayList nulls out obsolete last slot to allow GC.

## 6.4 Why transient?

Internal array is implementation detail for serialization.

## 6.5 Rule

ArrayList memory is backing array plus elements elsewhere.

---

# 7. Lazy/Empty Array Behavior

Modern ArrayList implementations use shared empty array instances for empty lists.

## 7.1 Default constructor

```java
new ArrayList<>()
```

does not necessarily allocate default capacity array immediately.

## 7.2 First add

On first add, backing array grows to initial default capacity behavior.

## 7.3 Constructor with capacity 0

```java
new ArrayList<>(0)
```

can behave differently internally from default empty constructor in terms of first growth behavior.

## 7.4 Why useful

Avoid wasting array allocation for empty lists.

## 7.5 Rule

Empty ArrayLists are relatively cheap, but millions of them are still objects.

---

# 8. Growth and Resizing

When add requires more capacity, ArrayList grows backing array.

## 8.1 Resize steps

Conceptually:

1. allocate larger array;
2. copy old references into new array;
3. replace backing array reference.

## 8.2 Growth factor

OpenJDK historically grows by about 1.5x.

Do not depend on exact factor as public contract.

## 8.3 Cost

Resize is O(n) copy.

## 8.4 Latency spike

Most appends are cheap; resize append can be expensive.

## 8.5 Rule

Pre-size large known lists to avoid repeated resize copies.

---

# 9. Amortized O(1) Append

`add(E)` at end is amortized constant time.

## 9.1 Why not always O(1)?

If capacity available:

```text
store reference + increment size
```

O(1).

If full:

```text
allocate new array + copy n elements + add
```

O(n).

## 9.2 Amortized explanation

Because capacity grows geometrically, expensive copies happen occasionally.

Total cost over many adds is linear, so average per add is O(1).

## 9.3 Production implication

Individual request latency can still see resize spike if large list grows during hot path.

## 9.4 Rule

Amortized O(1) does not mean no latency spikes.

---

# 10. `ensureCapacity`

```java
list.ensureCapacity(expectedSize);
```

Ensures backing capacity can hold at least expectedSize elements.

## 10.1 Use case

You know you will add many elements.

```java
List<Result> results = new ArrayList<>();
results.ensureCapacity(inputs.size());

for (Input input : inputs) {
    results.add(process(input));
}
```

Alternative:

```java
List<Result> results = new ArrayList<>(inputs.size());
```

## 10.2 Benefit

Reduces resize count.

## 10.3 Risk

Over-allocating wastes memory.

## 10.4 Rule

Use initial capacity/ensureCapacity when expected size is known and large enough to matter.

---

# 11. `trimToSize`

```java
list.trimToSize();
```

Trims backing array capacity to current size.

## 11.1 Use case

You built large list and will keep it long-lived with no further growth.

## 11.2 Cost

Allocates new smaller array and copies elements.

## 11.3 Risk

If you add later, list may resize again.

## 11.4 Not usually needed

For short-lived lists, GC will reclaim whole list soon.

## 11.5 Rule

Use trimToSize rarely, for long-lived memory-sensitive lists after construction.

---

# 12. `add(E)`

Append at end.

## 12.1 Fast path

```text
if size < capacity:
    elementData[size++] = e
```

## 12.2 Slow path

Grow then store.

## 12.3 Allows null

```java
list.add(null);
```

Allowed, but often domain smell.

## 12.4 Structural modification

Increments modCount.

## 12.5 Rule

Append is ArrayList's strongest mutation operation.

---

# 13. `add(index, E)`

Insert at position.

## 13.1 Requires range check

Index must be between 0 and size inclusive.

## 13.2 Shift right

Elements from index to size-1 shift one slot right.

```text
[A, B, C, D]
add(1, X)
[A, X, B, C, D]
```

## 13.3 Cost

O(n - index) shifting.

Inserting at front is O(n).

Inserting at end same as append.

## 13.4 Rule

Frequent front/middle insertions are bad fit for ArrayList.

---

# 14. `get(index)` and `set(index, E)`

## 14.1 get

```java
E e = list.get(i);
```

Range check + array access.

O(1).

## 14.2 set

```java
E old = list.set(i, e);
```

Range check + replace reference.

O(1).

## 14.3 set is not structural

Changing element at existing index does not change size.

Usually does not invalidate iterator structurally.

## 14.4 Rule

Random read/write by index is ArrayList's core strength.

---

# 15. `remove(index)`

Remove element at position.

## 15.1 Steps

1. range check;
2. store old value;
3. shift elements left after index;
4. null out old last slot;
5. decrement size;
6. increment modCount;
7. return old value.

## 15.2 Cost

O(n - index - 1).

Removing last is O(1).

Removing first is O(n).

## 15.3 GC friendliness

Nulling old last slot lets removed reference be GC'd if no other references.

## 15.4 Rule

Removing repeatedly from front of ArrayList is expensive.

---

# 16. `remove(Object)`

Remove first occurrence equal to object.

## 16.1 Steps

1. scan from beginning;
2. compare using equals/null-safe comparison;
3. if found, remove index;
4. shift left.

## 16.2 Cost

O(n) scan + O(n) shift in worst case.

## 16.3 Equality cost

If equals expensive, scan cost increases.

## 16.4 Rule

ArrayList is not ideal for frequent membership removal by value in large collections.

---

# 17. Shifting Cost

Shifting is implemented with array copy operations.

## 17.1 Why expensive?

Moving many references.

## 17.2 Insert front repeatedly

```java
for (E e : items) {
    list.add(0, e);
}
```

This can become O(n²).

Better:

- add to end then reverse;
- use ArrayDeque for front operations;
- collect normally.

## 17.3 Remove front repeatedly

```java
while (!list.isEmpty()) {
    list.remove(0);
}
```

O(n²).

Better:

```java
for (E e : list) { ... }
list.clear();
```

or use ArrayDeque.

## 17.4 Rule

Avoid repeated front/middle shifting in hot paths.

---

# 18. Null Elements

ArrayList permits null elements.

```java
list.add(null);
```

## 18.1 Cost

Null itself has no object allocation.

## 18.2 Semantic danger

Every consumer must handle null.

```java
list.stream().map(String::length) // NPE
```

## 18.3 `indexOf(null)`

ArrayList can search null.

## 18.4 Rule

Although ArrayList supports null, domain collections should usually reject null.

---

# 19. `contains`, `indexOf`, and Equality Cost

ArrayList membership search is linear.

```java
list.contains(x)
list.indexOf(x)
```

## 19.1 Cost

O(n) equality comparisons.

## 19.2 For many lookups

Use HashSet/HashMap.

Bad:

```java
for (Item item : items) {
    if (allowedList.contains(item.id())) ...
}
```

Better:

```java
Set<Id> allowed = new HashSet<>(allowedList);
```

## 19.3 For tiny list

ArrayList contains may be fine and simpler.

## 19.4 Rule

Convert to Set when repeated membership lookup dominates.

---

# 20. `RandomAccess`

ArrayList implements `RandomAccess`, a marker interface indicating fast random access.

## 20.1 Why useful

Generic algorithms can choose index loop for RandomAccess lists.

```java
if (list instanceof RandomAccess) {
    for (int i = 0; i < list.size(); i++) ...
} else {
    for (E e : list) ...
}
```

## 20.2 LinkedList does not implement RandomAccess

Index loops over LinkedList are bad.

## 20.3 Rule

If your algorithm indexes into List repeatedly, consider RandomAccess or require ArrayList/List copy.

---

# 21. Iteration Cost

ArrayList iteration is fast.

## 21.1 Why

- contiguous backing array;
- simple index progression;
- good cache locality;
- no node chasing.

## 21.2 Enhanced for-loop

Uses iterator.

```java
for (E e : list) { ... }
```

## 21.3 Index loop

```java
for (int i = 0; i < list.size(); i++) {
    E e = list.get(i);
}
```

Can be fast for ArrayList.

## 21.4 Iterator allocation

Iterator object may allocate, though JIT can optimize in some cases.

## 21.5 Rule

ArrayList is excellent for read/iterate-heavy workloads.

---

# 22. Iterator, ListIterator, and `modCount`

ArrayList iterators are fail-fast.

## 22.1 modCount

Structural modifications increment modCount.

Iterator captures expectedModCount.

On traversal, if expected != actual, throws ConcurrentModificationException.

## 22.2 Structural modification

Examples:

- add;
- remove;
- clear;
- ensure structural changes.

Not usually:

- set existing element.

## 22.3 Safe iterator remove

```java
Iterator<E> it = list.iterator();
while (it.hasNext()) {
    E e = it.next();
    if (shouldRemove(e)) {
        it.remove();
    }
}
```

Iterator updates expectedModCount.

## 22.4 ListIterator

Can add/set/remove with cursor rules.

## 22.5 Rule

Mutate through iterator/listIterator during traversal, not directly on list.

---

# 23. Fail-Fast Behavior

Fail-fast detects accidental concurrent structural modification.

## 23.1 Example

```java
for (E e : list) {
    list.add(e); // likely ConcurrentModificationException
}
```

## 23.2 Best-effort

Fail-fast is not guaranteed correctness mechanism under unsynchronized concurrency.

## 23.3 Not thread safety

ArrayList remains not thread-safe.

## 23.4 Rule

ConcurrentModificationException means traversal/mutation protocol bug, not recovery strategy.

---

# 24. `subList` View

```java
List<E> view = list.subList(from, to);
```

Returns view backed by original list.

## 24.1 View behavior

Changes in view affect original.

Changes in original can affect view or make it invalid.

## 24.2 Use case

Short-lived internal range operations.

## 24.3 Danger

Long-lived subList can retain entire backing list.

Small page view may keep huge list reachable.

## 24.4 Boundary copy

```java
List<E> page = List.copyOf(list.subList(from, to));
```

## 24.5 Rule

Use subList as temporary view; copy before storing/returning.

---

# 25. `reversed()` View in Java 21+

Because `List` is a SequencedCollection, Java 21 added reverse-oriented APIs.

```java
List<E> reversed = list.reversed();
```

## 25.1 View

The reversed list is a view, not necessarily copy.

## 25.2 Mutation relationship

Mutating reversed view can affect original if supported.

## 25.3 Traversal

Great for reverse traversal without copying:

```java
for (E e : list.reversed()) {
    ...
}
```

## 25.4 Snapshot

For boundary:

```java
List<E> snapshot = List.copyOf(list.reversed());
```

## 25.5 Rule

Use reversed view internally, snapshot externally.

---

# 26. `toArray`

ArrayList provides:

```java
Object[] toArray()
<T> T[] toArray(T[] a)
```

## 26.1 Object array

```java
Object[] array = list.toArray();
```

## 26.2 Typed array

```java
String[] array = list.toArray(String[]::new);
```

Modern Java Collection has `toArray(IntFunction<T[]>)`.

## 26.3 Cost

Copies elements into new array.

## 26.4 Why copy?

Prevents exposing internal backing array.

## 26.5 Rule

toArray is boundary conversion with O(n) copy.

---

# 27. Spliterator

ArrayList has good spliterator characteristics.

## 27.1 Why good for streams

ArrayList can split by index ranges efficiently.

## 27.2 Characteristics

Typically ordered, sized, subsized.

## 27.3 Parallel stream suitability

ArrayList is often a good source for parallel streams if per-element work is heavy enough and operations are safe.

## 27.4 Rule

ArrayList is one of the better general-purpose collection sources for streams/parallel streams.

---

# 28. ArrayList and Streams

## 28.1 Sequential stream

```java
list.stream()
```

Uses ArrayList spliterator.

## 28.2 Parallel stream

```java
list.parallelStream()
```

Splits index ranges.

## 28.3 Mutation warning

Do not structurally mutate list while stream pipeline is executing.

## 28.4 Stateful operations

`sorted`, `distinct`, `collect` can allocate.

## 28.5 Rule

ArrayList stream source is efficient, but stream operation choices still dominate.

---

# 29. Memory Footprint

ArrayList memory:

```text
ArrayList object
+
Object[] backing array
+
referenced element objects
```

## 29.1 Unused capacity

Extra slots are null references but still consume array space.

## 29.2 Boxing

`ArrayList<Integer>` stores Integer references.

## 29.3 Removal

Removed references are nulled to allow GC.

## 29.4 Long-lived list after shrink

Capacity remains large unless trimmed or copied.

## 29.5 Rule

For large long-lived lists, capacity and boxing matter.

---

# 30. ArrayList vs Array

## 30.1 Array

```java
String[] array
```

Pros:

- fixed size;
- direct primitive arrays possible;
- lower abstraction overhead;
- runtime component type.

Cons:

- fixed length;
- less convenient APIs;
- covariant runtime failures.

## 30.2 ArrayList

Pros:

- resizable;
- List API;
- collections integration;
- streams;
- generics.

Cons:

- object references only;
- no primitives directly;
- backing capacity overhead.

## 30.3 Rule

Use arrays for fixed-size primitive/performance-critical data; ArrayList for dynamic object lists.

---

# 31. ArrayList vs LinkedList

## 31.1 ArrayList wins for

- random access;
- iteration;
- append;
- memory locality;
- lower per-element overhead;
- stream source.

## 31.2 LinkedList wins rarely

- frequent insert/remove via iterator at known positions;
- deque operations when ArrayDeque not suitable;
- specific measured workload.

## 31.3 Queue

Use ArrayDeque, not LinkedList, for most non-concurrent queue/stack.

## 31.4 Rule

ArrayList is usually better List than LinkedList in production.

---

# 32. ArrayList vs ArrayDeque

## 32.1 ArrayList

Good for:

- index access;
- append;
- iteration;
- ordered collection.

## 32.2 ArrayDeque

Good for:

- add/remove both ends;
- queue;
- stack;
- sliding window.

## 32.3 Front removal

ArrayList remove(0) shifts.

ArrayDeque pollFirst is efficient.

## 32.4 Rule

If you process from front, use ArrayDeque.

---

# 33. ArrayList vs CopyOnWriteArrayList

## 33.1 ArrayList

- not thread-safe;
- cheap writes;
- fail-fast iterator.

## 33.2 CopyOnWriteArrayList

- thread-safe snapshot iteration;
- reads cheap;
- writes copy entire array;
- good for listener lists.

## 33.3 Rule

Use CopyOnWriteArrayList for read-mostly concurrent list with rare writes.

---

# 34. ArrayList in API/Domain/DTO Boundaries

## 34.1 Internal buffer

```java
List<Result> results = new ArrayList<>();
```

Good.

## 34.2 Return value

Prefer interface:

```java
List<Result>
```

and immutable snapshot:

```java
return List.copyOf(results);
```

## 34.3 Domain object field

```java
record Order(List<OrderLine> lines) {
    Order {
        lines = List.copyOf(lines);
    }
}
```

## 34.4 Do not expose mutable ArrayList

Bad:

```java
return internalArrayList;
```

## 34.5 Rule

Use ArrayList internally, expose List contract safely.

---

# 35. Concurrency Hazards

ArrayList is unsynchronized.

## 35.1 Concurrent mutation

Unsafe.

## 35.2 Concurrent read after publication

If list is fully built, safely published, and never mutated, concurrent read can be okay.

Better:

```java
List.copyOf(list)
```

## 35.3 Synchronized wrapper

```java
List<T> sync = Collections.synchronizedList(new ArrayList<>());
```

Iteration still requires external synchronization.

## 35.4 Rule

ArrayList is single-threaded mutable structure unless externally protected or made immutable snapshot.

---

# 36. Production Diagnostics

When ArrayList suspected:

## 36.1 Check size

Very large list?

## 36.2 Check access pattern

- append?
- front insert?
- front remove?
- contains in loop?
- random access?
- repeated copy?

## 36.3 Check memory

- retained Object[];
- unused capacity;
- boxed primitives;
- subList retaining large list.

## 36.4 Check allocation

- repeated temporary lists;
- stream collect to lists;
- defensive copy in hot loop.

## 36.5 Check concurrency

- CME;
- data races;
- shared mutable list.

## 36.6 Rule

ArrayList problems usually come from wrong access pattern, retention, or ownership.

---

# 37. Production Failure Modes

## 37.1 remove(0) loop O(n²)

Fix: ArrayDeque or index traversal.

## 37.2 add(0, e) loop O(n²)

Fix: add end then reverse or ArrayDeque.

## 37.3 contains in nested loop

Fix: HashSet.

## 37.4 subList memory retention

Fix: List.copyOf(subList).

## 37.5 Returning internal mutable list

Fix: immutable snapshot.

## 37.6 Record component aliasing

Fix: List.copyOf in compact constructor.

## 37.7 Large capacity retained after clear/remove

Fix: new list/copy/trimToSize if long-lived.

## 37.8 Concurrent modification during iteration

Fix: iterator.remove, snapshot, lock, concurrent collection.

## 37.9 Parallel mutation

Fix: avoid mutation or synchronize correctly.

## 37.10 Boxing memory explosion

Fix: primitive arrays/specialized structures.

## 37.11 Sorting unmodifiable list

Fix: mutable copy then sort.

## 37.12 `Arrays.asList` confused with ArrayList

Fix: new ArrayList<>(...) if mutability needed.

---

# 38. Best Practices

## 38.1 Use ArrayList when

- ordered object collection;
- append then iterate;
- random access;
- DTO/result list;
- stream source.

## 38.2 Avoid ArrayList when

- frequent front operations;
- membership lookup dominates;
- sorted/range operations needed;
- primitive huge data;
- concurrent mutation.

## 38.3 Performance

- pre-size large known lists;
- avoid repeated front/middle mutations;
- avoid contains in hot nested loops;
- be careful with subList;
- use primitive alternatives for huge numeric data.

## 38.4 API

- expose List, not ArrayList, unless implementation required.
- return immutable snapshot at boundaries.
- copy collection components in records/domain objects.

## 38.5 Concurrency

- do not share mutable ArrayList across threads.
- use immutable snapshot, synchronized wrapper, CopyOnWriteArrayList, or concurrent design.

---

# 39. Decision Matrix

| Requirement | Recommended |
|---|---|
| append then iterate | `ArrayList` |
| random access by index | `ArrayList` |
| return immutable result | build `ArrayList`, return `List.copyOf` |
| known large result size | `new ArrayList<>(expectedSize)` |
| frequent remove first | `ArrayDeque` |
| frequent add first | `ArrayDeque` |
| membership lookup many times | `HashSet` |
| sorted/range query | `TreeSet`/`TreeMap` |
| primitive large data | primitive array/specialized collection |
| concurrent read-mostly rare writes | `CopyOnWriteArrayList` |
| concurrent mutable list | lock/synchronized wrapper/custom design |
| reverse traversal | `list.reversed()` or reverse index loop |
| reverse snapshot | `List.copyOf(list.reversed())` |
| page view internal | `subList` |
| page result boundary | `List.copyOf(subList)` |
| shrink long-lived list memory | copy to new list or `trimToSize` |
| sort immutable input | mutable copy + sort |

---

# 40. Latihan

## Latihan 1 — Size vs Capacity

Create ArrayList with initial capacity 100.

Add 10 elements.

Explain size vs capacity.

## Latihan 2 — Growth Observation

Add many elements to ArrayList and observe allocation using profiler/JFR.

Explain resize spikes.

## Latihan 3 — remove(0) Trap

Benchmark:

```java
while (!list.isEmpty()) list.remove(0);
```

against ArrayDeque pollFirst.

## Latihan 4 — contains Loop

Given list of allowed IDs, compare repeated `list.contains` vs HashSet lookup.

## Latihan 5 — subList Retention

Create large list, take small subList, keep it. Discuss memory retention and fix with copy.

## Latihan 6 — Defensive Copy Record

Implement:

```java
record CaseTimeline(List<CaseEvent> events)
```

with defensive copy, non-empty validation, and latest event method.

## Latihan 7 — Iterator Mutation

Show direct list mutation during enhanced for-loop causing CME.

Fix with iterator.remove.

## Latihan 8 — Pre-size

Compare ArrayList building with default constructor vs expected size constructor for 1 million elements.

## Latihan 9 — Boxing

Compare memory of `ArrayList<Integer>` vs `int[]` for many numbers.

## Latihan 10 — Reverse

Compare:

- reverse index loop;
- `list.reversed()`;
- copy + `Collections.reverse`.

Explain view vs mutation vs snapshot.

---

# 41. Ringkasan

ArrayList is the default workhorse List because it is simple, compact, and fast for common patterns.

Core lessons:

- ArrayList is backed by a resizable Object array.
- Size is logical element count.
- Capacity is backing array length.
- Append is amortized O(1).
- Resize copies existing references.
- get/set by index are O(1).
- insert/remove middle/front shift elements.
- remove(0) loops are O(n²).
- contains/indexOf are O(n).
- ArrayList allows null.
- ArrayList implements RandomAccess.
- Iteration is cache-friendly.
- Iterators are fail-fast via modCount.
- subList is a live view and can retain backing list.
- reversed() is a view in Java 21+.
- toArray copies.
- ArrayList spliterator is good for streams/parallel streams.
- ArrayList is not thread-safe.
- Use ArrayList internally and expose safe List snapshots across boundaries.

Main rule:

```text
ArrayList is excellent when your data is contiguous, append-heavy, read-heavy, and index/iteration-oriented.
It is poor when your workload is front/middle mutation, membership lookup, primitive-heavy, or concurrent mutation.
```

---

# 42. Referensi

1. Java SE 25 — `ArrayList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ArrayList.html

2. OpenJDK — `ArrayList.java` Source  
   https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/ArrayList.java

3. Java SE 25 — `List`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

4. Java SE 25 — `RandomAccess`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/RandomAccess.html

5. Java SE 25 — `AbstractList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/AbstractList.html

6. Java SE 25 — `ConcurrentModificationException`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ConcurrentModificationException.html

7. Java SE 25 — `Collections.synchronizedList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html#synchronizedList(java.util.List)

8. Java SE 25 — `CopyOnWriteArrayList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CopyOnWriteArrayList.html

9. Java SE 25 — `ArrayDeque`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ArrayDeque.html

10. Java SE 25 — `SequencedCollection`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SequencedCollection.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-015.md](./learn-java-collections-and-streams-part-015.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-017.md](./learn-java-collections-and-streams-part-017.md)
