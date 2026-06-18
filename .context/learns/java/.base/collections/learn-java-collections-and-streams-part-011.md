# learn-java-collections-and-streams-part-011.md

# Java Collections and Streams — Part 011  
# Collection Factories and Utility APIs: Collections, Arrays, List.of, Set.of, Map.of, copyOf, Singleton/Empty Collections, Wrappers, Sorting, Searching, dan Production Gotchas

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **011**  
> Fokus: memahami factory dan utility API Collections sebagai **semantic tools**: apakah membuat mutable buffer, immutable constant, unmodifiable view, fixed-size view, synchronized wrapper, checked wrapper, singleton, empty collection, atau hasil sorting/searching. Kita akan membedah `Collections`, `Arrays`, `List.of`, `Set.of`, `Map.of`, `copyOf`, `Collections.unmodifiable*`, `synchronized*`, `checked*`, `empty*`, `singleton*`, `nCopies`, `frequency`, `disjoint`, `sort`, `binarySearch`, `reverse`, `shuffle`, `rotate`, `fill`, `copy`, `min`, `max`, dan production gotchas.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Factory API adalah Contract Shortcut](#2-mental-model-factory-api-adalah-contract-shortcut)
3. [Empat Pertanyaan Sebelum Memilih Factory](#3-empat-pertanyaan-sebelum-memilih-factory)
4. [`List.of`, `Set.of`, `Map.of`](#4-listof-setof-mapof)
5. [`Map.ofEntries`](#5-mapofentries)
6. [`List.copyOf`, `Set.copyOf`, `Map.copyOf`](#6-listcopyof-setcopyof-mapcopyof)
7. [`Collections.empty*`](#7-collectionsempty)
8. [`Collections.singleton*`](#8-collectionssingleton)
9. [`Collections.nCopies`](#9-collectionsncopies)
10. [`Collections.unmodifiable*`](#10-collectionsunmodifiable)
11. [`Collections.synchronized*`](#11-collectionssynchronized)
12. [`Collections.checked*`](#12-collectionschecked)
13. [`Arrays.asList`](#13-arraysaslist)
14. [`Arrays` Utility Overview](#14-arrays-utility-overview)
15. [Mutable Factory Patterns](#15-mutable-factory-patterns)
16. [Sorting APIs](#16-sorting-apis)
17. [`Collections.sort` vs `List.sort`](#17-collectionssort-vs-listsort)
18. [`Collections.binarySearch`](#18-collectionsbinarysearch)
19. [`Collections.reverse`, `shuffle`, `rotate`, `swap`](#19-collectionsreverse-shuffle-rotate-swap)
20. [`Collections.fill` and `copy`](#20-collectionsfill-and-copy)
21. [`Collections.min`, `max`, `frequency`, `disjoint`](#21-collectionsmin-max-frequency-disjoint)
22. [`Collections.addAll`](#22-collectionsaddall)
23. [Legacy Bridges: Enumeration, Vector, Hashtable](#23-legacy-bridges-enumeration-vector-hashtable)
24. [Factory API and Null Policy](#24-factory-api-and-null-policy)
25. [Factory API and Duplicate Policy](#25-factory-api-and-duplicate-policy)
26. [Factory API and Ordering](#26-factory-api-and-ordering)
27. [Factory API and Mutability](#27-factory-api-and-mutability)
28. [Factory API and Performance](#28-factory-api-and-performance)
29. [Factory API in Domain Objects](#29-factory-api-in-domain-objects)
30. [Factory API in API/DTO/Event/Cache Boundaries](#30-factory-api-in-apidtoeventcache-boundaries)
31. [Production Failure Modes](#31-production-failure-modes)
32. [Best Practices](#32-best-practices)
33. [Decision Matrix](#33-decision-matrix)
34. [Latihan](#34-latihan)
35. [Ringkasan](#35-ringkasan)
36. [Referensi](#36-referensi)

---

# 1. Tujuan Bagian Ini

Java menyediakan banyak cara membuat atau membungkus collection:

```java
new ArrayList<>()
new HashSet<>()
new HashMap<>()

List.of(...)
Set.of(...)
Map.of(...)

List.copyOf(...)
Set.copyOf(...)
Map.copyOf(...)

Collections.emptyList()
Collections.singletonList(x)
Collections.unmodifiableList(list)
Collections.synchronizedList(list)
Collections.checkedList(list, Type.class)

Arrays.asList(...)
```

Banyak bug production terjadi karena developer tidak membedakan:

```text
mutable list
fixed-size list
unmodifiable view
immutable/unmodifiable copy
singleton immutable collection
empty shared collection
synchronized wrapper
checked runtime wrapper
```

Contoh klasik:

```java
List<String> xs = Arrays.asList("A", "B");
xs.add("C"); // UnsupportedOperationException
```

atau:

```java
List<String> xs = Collections.unmodifiableList(raw);
raw.add("C");
System.out.println(xs); // berubah
```

Tujuan bagian ini:

- memahami semantic setiap factory/wrapper;
- tahu null/duplicate/order/mutability behavior;
- menghindari production gotchas;
- memakai utility algorithms dengan benar;
- memilih API yang sesuai intent.

---

# 2. Mental Model: Factory API adalah Contract Shortcut

Factory API bukan hanya cara singkat menulis object creation.

Factory API adalah shortcut untuk contract.

## 2.1 `List.of`

```java
List<String> roles = List.of("ADMIN", "USER");
```

Says:

```text
small known unmodifiable list
no nulls
```

## 2.2 `new ArrayList<>`

```java
List<String> roles = new ArrayList<>();
```

Says:

```text
mutable working buffer
```

## 2.3 `List.copyOf`

```java
List<String> roles = List.copyOf(input);
```

Says:

```text
unmodifiable snapshot/copy of existing data
reject nulls
break structural aliasing
```

## 2.4 `Collections.unmodifiableList`

```java
List<String> view = Collections.unmodifiableList(backing);
```

Says:

```text
read-only view backed by another list
```

## 2.5 `Arrays.asList`

```java
List<String> xs = Arrays.asList(array);
```

Says:

```text
fixed-size list backed by array
```

## 2.6 Rule

```text
Choose factory by semantic contract, not by shortest syntax.
```

---

# 3. Empat Pertanyaan Sebelum Memilih Factory

Sebelum memilih factory, jawab empat hal.

## 3.1 Mutability

```text
Apakah hasil boleh di-add/remove/put?
```

## 3.2 Ownership

```text
Apakah hasil harus independen dari source?
```

## 3.3 Null/Duplicate policy

```text
Apakah null boleh?
Apakah duplicate boleh?
```

## 3.4 Order

```text
Apakah order harus dipertahankan/didefinisikan?
```

## 3.5 Example

Need: immutable snapshot preserving input order and rejecting null.

Use:

```java
List.copyOf(input)
```

Need: mutable buffer from constants.

Use:

```java
new ArrayList<>(List.of("A", "B"))
```

Need: fixed-size view over array.

Use:

```java
Arrays.asList(array)
```

Need: unique insertion-order mutable set.

Use:

```java
new LinkedHashSet<>(input)
```

## 3.6 Rule

The factory is correct only if its contract matches these answers.

---

# 4. `List.of`, `Set.of`, `Map.of`

Java 9 introduced static factory methods for small unmodifiable collections.

## 4.1 `List.of`

```java
List<String> xs = List.of("A", "B", "C");
```

Characteristics:

- unmodifiable;
- rejects null;
- preserves argument order;
- allows duplicate elements;
- good for constants/small values.

```java
List.of("A", "A"); // ok
List.of("A", null); // NullPointerException
```

## 4.2 `Set.of`

```java
Set<String> xs = Set.of("A", "B");
```

Characteristics:

- unmodifiable;
- rejects null;
- rejects duplicates;
- no guaranteed encounter order contract you should rely on unless specified by type/implementation.

```java
Set.of("A", "A"); // IllegalArgumentException
```

## 4.3 `Map.of`

```java
Map<String, Integer> map = Map.of(
    "A", 1,
    "B", 2
);
```

Characteristics:

- unmodifiable;
- rejects null keys/values;
- rejects duplicate keys;
- overloads up to 10 key-value pairs.

## 4.4 Mutating fails

```java
List.of("A").add("B"); // UnsupportedOperationException
```

## 4.5 When to use

- constants;
- defaults;
- tests;
- small config maps;
- returning known empty/small values.

## 4.6 When not to use

- need mutable collection;
- need null;
- need set/map order guarantee;
- more than 10 map entries with `Map.of`.

## 4.7 Rule

Use `of` for known unmodifiable literal collections.

---

# 5. `Map.ofEntries`

For maps with many entries:

```java
Map<String, Integer> map = Map.ofEntries(
    Map.entry("A", 1),
    Map.entry("B", 2),
    Map.entry("C", 3)
);
```

## 5.1 Characteristics

Like `Map.of`:

- unmodifiable;
- rejects null;
- rejects duplicate keys.

## 5.2 Use cases

- static lookup maps;
- enum-like string metadata;
- small/medium constants.

## 5.3 Map.entry

```java
Map.entry(key, value)
```

creates unmodifiable entry suitable for Map.ofEntries.

## 5.4 Large maps

For very large static maps, consider:

- builder method;
- generated code;
- resource file;
- database/reference table;
- `HashMap` then `Map.copyOf`.

## 5.5 Rule

Use `Map.ofEntries` when `Map.of` arity limit or readability becomes issue.

---

# 6. `List.copyOf`, `Set.copyOf`, `Map.copyOf`

Java 10 introduced `copyOf` factories.

## 6.1 `List.copyOf`

```java
List<T> copy = List.copyOf(source);
```

Use for unmodifiable list from existing collection.

## 6.2 `Set.copyOf`

```java
Set<T> copy = Set.copyOf(source);
```

Use for unmodifiable set from existing collection.

Important: if source collection has duplicates, resulting set dedups according to set semantics. If duplicate should be error, validate first.

## 6.3 `Map.copyOf`

```java
Map<K,V> copy = Map.copyOf(source);
```

Use for unmodifiable map copy.

## 6.4 Null policy

All reject null:

- null collection;
- null elements;
- null keys/values.

## 6.5 Shallow copy

Elements/values are not deep copied.

## 6.6 Optimization

If source already suitable unmodifiable collection, implementation may avoid copy. Do not depend on object identity.

## 6.7 Rule

Use `copyOf` for defensive copy of existing collection structure.

---

# 7. `Collections.empty*`

Examples:

```java
Collections.emptyList()
Collections.emptySet()
Collections.emptyMap()
```

## 7.1 Characteristics

- immutable/unmodifiable empty collections;
- shared/reusable;
- type-safe through generics;
- no allocation of new mutable collection needed.

## 7.2 Use cases

Return empty instead of null:

```java
return Collections.emptyList();
```

or:

```java
return List.of();
```

## 7.3 Modern alternative

```java
List.of()
Set.of()
Map.of()
```

often clearer.

## 7.4 Do not mutate

```java
Collections.emptyList().add("x"); // UnsupportedOperationException
```

## 7.5 Rule

Return empty collection instead of null unless absence is semantically different.

---

# 8. `Collections.singleton*`

Examples:

```java
Collections.singleton(element)
Collections.singletonList(element)
Collections.singletonMap(key, value)
```

## 8.1 Characteristics

- immutable/unmodifiable;
- exactly one element/mapping;
- singleton set/list/map.

## 8.2 Use cases

- adapt single value to collection API;
- default include-list;
- event with one target;
- test data.

## 8.3 Null

`Collections.singleton(null)` can contain null depending method. Unlike `Set.of(null)`, which rejects null.

Be careful.

## 8.4 Modern alternatives

```java
List.of(element)
Set.of(element)
Map.of(key, value)
```

if nulls not allowed and Java 9+.

## 8.5 Rule

Use singleton factories when exactly one value is intended; prefer `of` if null rejection is desired.

---

# 9. `Collections.nCopies`

```java
List<String> xs = Collections.nCopies(3, "A");
// [A, A, A]
```

## 9.1 Characteristics

- immutable list;
- contains n copies of same reference;
- compact representation;
- not n independent copies.

## 9.2 Mutable element trap

```java
MutableBox box = new MutableBox();
List<MutableBox> boxes = Collections.nCopies(3, box);

boxes.get(0).setValue("x");
boxes.get(1).value(); // also x, same object
```

## 9.3 Good use cases

- repeated immutable value;
- placeholder constants;
- testing.

## 9.4 Bad use cases

- need independent mutable objects.

Use:

```java
List<MutableBox> boxes = IntStream.range(0, n)
    .mapToObj(i -> new MutableBox())
    .toList();
```

## 9.5 Rule

`nCopies` repeats references, not clones.

---

# 10. `Collections.unmodifiable*`

Wrappers:

```java
Collections.unmodifiableList(list)
Collections.unmodifiableSet(set)
Collections.unmodifiableMap(map)
```

and sorted/navigable/sequenced variants.

## 10.1 Characteristics

- unmodifiable view;
- backed by original collection;
- mutation through wrapper fails;
- mutation through backing collection visible.

## 10.2 Example

```java
List<String> raw = new ArrayList<>();
List<String> view = Collections.unmodifiableList(raw);

raw.add("A");
System.out.println(view); // [A]
```

## 10.3 Use cases

- live read-only view;
- internal read-only facade;
- legacy code.

## 10.4 Not immutable snapshot

For snapshot, use:

```java
List.copyOf(raw)
```

## 10.5 Rule

Use unmodifiable wrappers only when live view semantics are intended.

---

# 11. `Collections.synchronized*`

Wrappers:

```java
Collections.synchronizedList(list)
Collections.synchronizedSet(set)
Collections.synchronizedMap(map)
```

## 11.1 Characteristics

- wraps collection with synchronized methods;
- uses mutex for individual operations;
- iteration still requires external synchronization.

## 11.2 Iteration pattern

```java
List<T> syncList = Collections.synchronizedList(new ArrayList<>());

synchronized (syncList) {
    Iterator<T> it = syncList.iterator();
    while (it.hasNext()) {
        process(it.next());
    }
}
```

## 11.3 Use cases

- simple legacy synchronization;
- small shared collection;
- coarse-grained lock acceptable.

## 11.4 Limitations

- compound actions still need synchronization;
- iteration needs manual lock;
- contention;
- not as scalable as concurrent collections.

## 11.5 Alternatives

- `ConcurrentHashMap`;
- `CopyOnWriteArrayList`;
- `BlockingQueue`;
- immutable snapshots;
- explicit locks.

## 11.6 Rule

Synchronized wrapper synchronizes operations, not your whole algorithm.

---

# 12. `Collections.checked*`

Wrappers:

```java
Collections.checkedList(list, String.class)
Collections.checkedSet(set, Permission.class)
Collections.checkedMap(map, Key.class, Value.class)
```

## 12.1 Purpose

Runtime type safety.

Useful when interacting with raw types or legacy code.

## 12.2 Example

```java
List raw = new ArrayList();
List<String> checked = Collections.checkedList(raw, String.class);

checked.add("ok");
((List) checked).add(123); // ClassCastException
```

## 12.3 Use cases

- legacy APIs;
- raw collection boundaries;
- defensive runtime type checking;
- plugin systems.

## 12.4 Not replacement for generics

Prefer compile-time generics where possible.

## 12.5 Rule

Checked wrappers are boundary protection for legacy/raw collection interactions.

---

# 13. `Arrays.asList`

`Arrays.asList` returns fixed-size list backed by array.

## 13.1 Example

```java
String[] array = {"A", "B"};
List<String> list = Arrays.asList(array);
```

## 13.2 Supports set

```java
list.set(0, "X");
System.out.println(array[0]); // X
```

## 13.3 Does not support add/remove

```java
list.add("C"); // UnsupportedOperationException
list.remove("A"); // UnsupportedOperationException
```

## 13.4 Backed by array

Changing array changes list.

Changing list via set changes array.

## 13.5 Primitive array trap

```java
int[] nums = {1, 2, 3};
List<int[]> list = Arrays.asList(nums);
```

This creates list with one element: the int array.

For boxed:

```java
Integer[] nums = {1, 2, 3};
List<Integer> list = Arrays.asList(nums);
```

## 13.6 Mutable copy

```java
List<String> mutable = new ArrayList<>(Arrays.asList("A", "B"));
```

## 13.7 Modern constant

```java
List<String> immutable = List.of("A", "B");
```

## 13.8 Rule

Use `Arrays.asList` when you intentionally need fixed-size array-backed list.

---

# 14. `Arrays` Utility Overview

`Arrays` contains methods for arrays:

- sorting;
- searching;
- comparing;
- filling;
- copying;
- converting to string;
- hashing;
- viewing as list;
- stream creation.

## 14.1 Sorting

```java
Arrays.sort(array)
Arrays.parallelSort(array)
```

## 14.2 Searching

```java
Arrays.binarySearch(array, key)
```

Requires sorted array according to same order.

## 14.3 Copying

```java
Arrays.copyOf(array, newLength)
Arrays.copyOfRange(array, from, to)
```

## 14.4 Equality/hash

```java
Arrays.equals(a, b)
Arrays.hashCode(a)
Arrays.deepEquals(a, b)
Arrays.deepHashCode(a)
```

Important for array wrapper keys.

## 14.5 String representation

```java
Arrays.toString(array)
Arrays.deepToString(array)
```

## 14.6 Stream

```java
Arrays.stream(array)
```

## 14.7 Rule

Arrays utility is for arrays; be careful when bridging arrays to collections.

---

# 15. Mutable Factory Patterns

## 15.1 Empty mutable list

```java
List<T> xs = new ArrayList<>();
```

## 15.2 Mutable list from existing

```java
List<T> xs = new ArrayList<>(existing);
```

## 15.3 Mutable set from existing

```java
Set<T> xs = new HashSet<>(existing);
```

## 15.4 Mutable ordered set

```java
Set<T> xs = new LinkedHashSet<>(existing);
```

## 15.5 Mutable map

```java
Map<K,V> map = new HashMap<>();
```

## 15.6 Mutable map preserving order

```java
Map<K,V> map = new LinkedHashMap<>();
```

## 15.7 Initial capacity

For large expected size:

```java
new ArrayList<>(expectedSize)
new HashMap<>(capacity)
```

## 15.8 Rule

Use constructors for mutable working buffers; use `of/copyOf` for unmodifiable values.

---

# 16. Sorting APIs

Sorting APIs include:

```java
Collections.sort(list)
list.sort(comparator)
Arrays.sort(array)
stream.sorted()
```

## 16.1 In-place list sort

```java
list.sort(comparator);
```

Mutates list.

## 16.2 Stream sorted

```java
List<T> sorted = list.stream()
    .sorted(comparator)
    .toList();
```

Does not mutate original list but builds result.

## 16.3 Natural order

```java
Collections.sort(list);
```

Requires elements Comparable.

## 16.4 Comparator order

```java
list.sort(Comparator.comparing(User::name));
```

## 16.5 Stability

Java list sorting is stable. If comparator considers elements equal, original order of equal elements is preserved.

## 16.6 Rule

Choose in-place sort for owned mutable lists; stream sorted for transformation result.

---

# 17. `Collections.sort` vs `List.sort`

## 17.1 `Collections.sort`

```java
Collections.sort(list);
Collections.sort(list, comparator);
```

Classic utility.

## 17.2 `List.sort`

```java
list.sort(comparator);
```

Default method on List.

## 17.3 Modern preference

Use:

```java
list.sort(comparator);
```

for clarity.

## 17.4 Unmodifiable list

Sorting unmodifiable list fails.

```java
List<String> xs = List.of("B", "A");
xs.sort(String::compareTo); // UnsupportedOperationException
```

## 17.5 Safe pattern

```java
List<String> sorted = new ArrayList<>(xs);
sorted.sort(String::compareTo);
return List.copyOf(sorted);
```

## 17.6 Rule

Sort only collections you own and can mutate.

---

# 18. `Collections.binarySearch`

```java
int index = Collections.binarySearch(list, key, comparator);
```

## 18.1 Requirement

List must be sorted according to same comparator/natural order.

## 18.2 If found

Returns index >= 0.

## 18.3 If not found

Returns negative value:

```text
-(insertionPoint) - 1
```

Recover insertion point:

```java
int insertionPoint = -index - 1;
```

## 18.4 RandomAccess

Binary search on non-random-access list may be less efficient.

## 18.5 Rule

Binary search is correct only if sorted with same ordering.

---

# 19. `Collections.reverse`, `shuffle`, `rotate`, `swap`

## 19.1 reverse

```java
Collections.reverse(list);
```

Mutates list in-place.

Java 21+ alternative for view:

```java
list.reversed()
```

## 19.2 shuffle

```java
Collections.shuffle(list);
Collections.shuffle(list, random);
```

Mutates list randomly.

Use explicit Random for reproducible tests.

## 19.3 rotate

```java
Collections.rotate(list, distance);
```

Moves elements circularly.

## 19.4 swap

```java
Collections.swap(list, i, j);
```

Swaps elements.

## 19.5 Unmodifiable list

All mutating utilities fail on unmodifiable list.

## 19.6 Rule

These are in-place algorithms; use copies if original must remain unchanged.

---

# 20. `Collections.fill` and `copy`

## 20.1 fill

```java
Collections.fill(list, value);
```

Replaces every element with same value reference.

Size unchanged.

## 20.2 Mutable value trap

If `value` mutable, every slot points to same object.

## 20.3 copy

```java
Collections.copy(dest, src);
```

Copies elements from src into dest.

Destination must be at least as large as source.

## 20.4 Common bug

```java
List<T> dest = new ArrayList<>();
Collections.copy(dest, src); // IndexOutOfBoundsException
```

Need pre-sized list:

```java
List<T> dest = new ArrayList<>(Collections.nCopies(src.size(), null));
Collections.copy(dest, src);
```

Often simpler:

```java
List<T> dest = new ArrayList<>(src);
```

## 20.5 Rule

`Collections.copy` copies into existing positions, not append.

---

# 21. `Collections.min`, `max`, `frequency`, `disjoint`

## 21.1 min/max

```java
T min = Collections.min(collection);
T max = Collections.max(collection, comparator);
```

Requires non-empty collection.

## 21.2 frequency

```java
int count = Collections.frequency(collection, target);
```

Uses equals.

## 21.3 disjoint

```java
boolean noneOverlap = Collections.disjoint(a, b);
```

Returns true if no common elements.

Uses equality semantics.

## 21.4 Performance

For large collections, disjoint can benefit if one collection is Set, but understand complexity.

## 21.5 Rule

These utilities are semantic shortcuts; equality/order still matter.

---

# 22. `Collections.addAll`

```java
Collections.addAll(collection, a, b, c);
```

## 22.1 Mutates target collection

Target must support add.

## 22.2 Use cases

- add multiple elements to mutable collection;
- varargs convenience.

## 22.3 Compared to `collection.addAll(List.of(...))`

`Collections.addAll` can avoid temporary collection.

## 22.4 Rule

Use only with mutable target and clear mutation intent.

---

# 23. Legacy Bridges: Enumeration, Vector, Hashtable

`Collections` includes bridge utilities for legacy APIs.

## 23.1 Enumeration to list

```java
Collections.list(enumeration)
```

## 23.2 Enumeration from collection

```java
Collections.enumeration(collection)
```

## 23.3 Legacy synchronization

`Vector` and `Hashtable` are legacy synchronized collections.

Prefer modern alternatives unless interacting with old APIs.

## 23.4 Rule

Use legacy bridges at boundaries, not as internal modern design.

---

# 24. Factory API and Null Policy

Null behavior differs.

## 24.1 Reject null

```java
List.of(null)
Set.of(null)
Map.of("A", null)
List.copyOf(collectionWithNull)
Set.copyOf(collectionWithNull)
Map.copyOf(mapWithNull)
```

throw `NullPointerException`.

## 24.2 Allows null

```java
new ArrayList<>()
new HashSet<>()
new HashMap<>()
Arrays.asList("A", null)
Collections.singleton(null)
```

depending collection.

## 24.3 Checked wrappers

Checked wrappers check type, not null unless target rejects null.

## 24.4 Domain recommendation

Prefer null-free collections.

## 24.5 Rule

Factory choice encodes null policy. Do not ignore it.

---

# 25. Factory API and Duplicate Policy

## 25.1 List

`List.of` allows duplicates.

## 25.2 Set.of

Rejects duplicate elements.

## 25.3 Set.copyOf

Deduplicates because result is Set. It may not reject duplicate input.

If duplicate should be error, validate before copy.

## 25.4 Map.of / Map.ofEntries

Reject duplicate keys.

## 25.5 Map.copyOf

Input map already has unique keys by definition.

## 25.6 Rule

Deduplication, duplicate rejection, and duplicate preservation are different policies.

---

# 26. Factory API and Ordering

## 26.1 List.of

Preserves argument order.

## 26.2 List.copyOf

Preserves source iteration order.

## 26.3 Set.of

Do not rely on iteration order.

## 26.4 Set.copyOf

Do not use if encounter order must be guaranteed as external contract. Use List or sequenced/linked structures.

## 26.5 LinkedHashSet copy

```java
Set<T> orderedUnique = new LinkedHashSet<>(input);
```

## 26.6 Map.of

Do not rely on iteration order as contract.

## 26.7 LinkedHashMap copy

```java
Map<K,V> ordered = new LinkedHashMap<>(input);
```

## 26.8 Rule

If order matters, choose ordered/sequenced implementation explicitly.

---

# 27. Factory API and Mutability

## 27.1 Mutable

```java
new ArrayList<>()
new HashSet<>()
new HashMap<>()
new ArrayDeque<>()
```

## 27.2 Unmodifiable

```java
List.of
Set.of
Map.of
copyOf
Collections.empty*
Collections.singleton*
Collections.nCopies
```

## 27.3 Unmodifiable view

```java
Collections.unmodifiable*
```

## 27.4 Fixed-size

```java
Arrays.asList
```

## 27.5 Synchronized view

```java
Collections.synchronized*
```

## 27.6 Runtime checked view

```java
Collections.checked*
```

## 27.7 Rule

Same declared type can have very different mutation behavior.

---

# 28. Factory API and Performance

## 28.1 Small immutable collections

`List.of`, `Set.of`, `Map.of` can be compact and efficient for small constants.

## 28.2 Empty/singleton

Empty/singleton factories avoid unnecessary allocation.

## 28.3 copyOf

O(n) generally, but may optimize if source already unmodifiable.

## 28.4 unmodifiable view

Cheap wrapper, but live aliasing risk.

## 28.5 Arrays.asList

Cheap view over array, but fixed-size/backed.

## 28.6 nCopies

Compact repeated-reference list.

## 28.7 Sorting

In-place sort mutates, avoids extra collection. Stream sorted creates result pipeline.

## 28.8 Rule

Performance is part of factory choice, but semantic correctness comes first.

---

# 29. Factory API in Domain Objects

## 29.1 Value object

```java
record ApprovalSteps(List<ApprovalStep> values) {
    ApprovalSteps {
        values = List.copyOf(values);
        if (values.isEmpty()) {
            throw new IllegalArgumentException("steps required");
        }
    }
}
```

## 29.2 Permission set

```java
record PermissionSet(Set<Permission> values) {
    PermissionSet {
        values = Set.copyOf(values);
    }
}
```

For enum:

```java
EnumSet.copyOf(...)
```

internally may be better, with care for empty.

## 29.3 Constants

```java
static final List<CaseStatus> TERMINAL_STATUSES =
    List.of(CLOSED, REJECTED, ARCHIVED);
```

## 29.4 Avoid

```java
Collections.unmodifiableList(input)
```

inside value object constructor if input can mutate.

Use copyOf.

## 29.5 Rule

Domain objects should own snapshots, not borrowed mutable collections.

---

# 30. Factory API in API/DTO/Event/Cache Boundaries

## 30.1 Request DTO

```java
record BulkRequest(List<CaseId> caseIds) {
    BulkRequest {
        caseIds = List.copyOf(caseIds);
    }
}
```

## 30.2 Response DTO

Return unmodifiable snapshot.

## 30.3 Event

Event constructor should copy collection payload.

## 30.4 Cache

Cache value should be immutable snapshot.

## 30.5 Raw/legacy boundary

Use checked wrappers if raw collection enters typed code.

## 30.6 Rule

Boundary factory choice is a safety decision.

---

# 31. Production Failure Modes

## 31.1 `Arrays.asList` add/remove failure

Fix:

```java
new ArrayList<>(Arrays.asList(...))
```

or:

```java
new ArrayList<>(List.of(...))
```

## 31.2 `List.of` mutation failure

Fix: mutable copy if mutation needed.

## 31.3 `List.of` null NPE

Fix: validate/clean input or use mutable list that allows null deliberately.

## 31.4 `Set.of` duplicate IllegalArgumentException

Fix: ensure unique or use list/multiset/dedup policy.

## 31.5 `Set.copyOf` silently dedups

Fix: validate duplicates first if duplicate invalid.

## 31.6 `Collections.unmodifiableList` live mutation surprise

Fix: `List.copyOf`.

## 31.7 `Collections.copy` IndexOutOfBoundsException

Fix: destination must already have size.

## 31.8 `nCopies` same mutable reference

Fix: generate independent objects.

## 31.9 `binarySearch` on unsorted list

Fix: sort with same comparator first.

## 31.10 `sort` on unmodifiable list

Fix: mutable copy then sort.

## 31.11 synchronized wrapper iteration race

Fix: synchronize manually during iteration.

## 31.12 checked wrapper false confidence

Checked wrapper catches runtime type errors, not semantic errors.

## 31.13 relying on Set.of order

Fix: use List/LinkedHashSet.

## 31.14 primitive array with Arrays.asList

Fix: use boxed array or `Arrays.stream(intArray).boxed()`.

---

# 32. Best Practices

## 32.1 Constants

Use:

```java
List.of
Set.of
Map.of
Map.ofEntries
```

## 32.2 Defensive copies

Use:

```java
List.copyOf
Set.copyOf
Map.copyOf
```

## 32.3 Mutable buffers

Use:

```java
new ArrayList<>()
new HashSet<>()
new HashMap<>()
```

## 32.4 Preserve order

Use:

```java
List
LinkedHashSet
LinkedHashMap
Sequenced*
```

## 32.5 Avoid null

Prefer factories that reject null for domain objects.

## 32.6 Sorting

Sort owned mutable copy.

## 32.7 Binary search

Only on sorted list with same comparator.

## 32.8 Concurrency

Use synchronized wrappers only when you understand manual iteration lock. Prefer concurrent collections or immutable snapshots where appropriate.

## 32.9 Views

Use views internally. Use snapshots across boundaries.

---

# 33. Decision Matrix

| Need | Recommended |
|---|---|
| immutable empty list | `List.of()` / `Collections.emptyList()` |
| immutable constants | `List.of`, `Set.of`, `Map.of` |
| many map constants | `Map.ofEntries` |
| immutable snapshot of existing list | `List.copyOf` |
| immutable snapshot of existing map | `Map.copyOf` |
| mutable list from constants | `new ArrayList<>(List.of(...))` |
| fixed-size array-backed list | `Arrays.asList` |
| mutable list from array | `new ArrayList<>(Arrays.asList(array))` |
| read-only live view | `Collections.unmodifiable*` |
| thread-safe wrapper | `Collections.synchronized*` plus external iteration lock |
| runtime type-safe legacy wrapper | `Collections.checked*` |
| one immutable element | `List.of(x)` / `Collections.singletonList(x)` |
| repeat immutable value | `Collections.nCopies` |
| sort owned list | `list.sort(comparator)` |
| sorted copy | `new ArrayList` + sort + `List.copyOf` |
| binary search | `Collections.binarySearch` on sorted list |
| reverse view Java 21+ | `list.reversed()` |
| reverse mutation | `Collections.reverse(mutableList)` |
| deterministic random shuffle | `Collections.shuffle(list, seededRandom)` |
| add varargs to mutable collection | `Collections.addAll` |

---

# 34. Latihan

## Latihan 1 — Factory Semantics

Untuk setiap expression, tulis mutability/null/duplicate/order behavior:

```java
List.of("A", "A")
Set.of("A", "A")
Map.of("A", 1, "A", 2)
List.copyOf(list)
Set.copyOf(list)
Collections.unmodifiableList(list)
Arrays.asList("A", "B")
Collections.nCopies(3, new Box())
```

## Latihan 2 — Fix Arrays.asList

Perbaiki:

```java
List<String> xs = Arrays.asList("A", "B");
xs.add("C");
```

## Latihan 3 — Live View vs Snapshot

Buat unmodifiable view dan copyOf dari list yang sama. Mutate backing list. Jelaskan hasil.

## Latihan 4 — Duplicate Policy

Design method:

```java
Set<CaseId> toUniqueCaseIds(List<CaseId> ids)
```

dengan dua versi:

1. dedup silently;
2. reject duplicates.

## Latihan 5 — Sorting Safely

Given unmodifiable list, buat sorted immutable result tanpa mutate original.

## Latihan 6 — Binary Search

Implement search insertion point jika element tidak ditemukan.

## Latihan 7 — Synchronized Wrapper

Buat synchronized list dan tunjukkan cara iteration yang benar.

## Latihan 8 — Checked Wrapper

Demonstrasikan raw list yang disisipkan wrong type, lalu lindungi dengan checkedList.

## Latihan 9 — nCopies Mutable Trap

Buat `Collections.nCopies(3, new ArrayList<>())`, mutate salah satu inner list, amati semua element.

## Latihan 10 — API DTO

Design DTO constructor yang menggunakan `List.copyOf`, max size, no duplicates, dan no null.

---

# 35. Ringkasan

Factory dan utility APIs adalah semantic tools.

Core lessons:

- `List.of`, `Set.of`, `Map.of` membuat unmodifiable literal collections dan reject null.
- `Set.of` reject duplicate elements.
- `Map.of`/`Map.ofEntries` reject duplicate keys.
- `copyOf` cocok untuk defensive unmodifiable snapshot.
- `Collections.empty*` dan `singleton*` cocok untuk empty/single immutable values.
- `Collections.nCopies` mengulang reference yang sama.
- `Collections.unmodifiable*` adalah live view, bukan immutable copy.
- `Collections.synchronized*` butuh external synchronization saat iteration.
- `Collections.checked*` berguna untuk raw/legacy boundary.
- `Arrays.asList` fixed-size dan backed by array.
- Sorting APIs mutate list unless using stream/copy pattern.
- `binarySearch` hanya benar untuk list yang sudah sorted dengan comparator sama.
- Utility methods seperti reverse/shuffle/fill/copy mutate list.
- Factory choice menentukan mutability, ownership, null, duplicate, ordering, dan performance.

Main rule:

```text
Do not choose collection factories by syntax.
Choose them by contract.
```

---

# 36. Referensi

1. Java SE 25 — `Collections`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html

2. Java SE 25 — `List`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

3. Java SE 25 — `Set`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Set.html

4. Java SE 25 — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

5. Java SE 25 — `Arrays`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html

6. Java SE 25 — Collections Framework Overview  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/doc-files/coll-overview.html

7. Java SE 25 — `List.sort`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html#sort(java.util.Comparator)

8. Java SE 25 — `Collections.binarySearch`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html#binarySearch(java.util.List,T)

9. Java SE 25 — `Collections.unmodifiableList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html#unmodifiableList(java.util.List)

10. Java SE 25 — `Collections.synchronizedList`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html#synchronizedList(java.util.List)

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-010.md](./learn-java-collections-and-streams-part-010.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-012.md](./learn-java-collections-and-streams-part-012.md)
