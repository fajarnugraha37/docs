# learn-java-collections-and-streams-part-001.md

# Java Collections and Streams — Part 001  
# Collection Interface Hierarchy Deep Dive: Iterable, Collection, List, Set, Queue, Deque, Map, Sorted/Navigable, dan Sequenced Contracts

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **001**  
> Fokus: membedah hierarchy interface Java Collections Framework sebagai **semantic contracts**, bukan hafalan API. Kita akan memahami kapan memakai `Iterable`, `Collection`, `List`, `Set`, `Queue`, `Deque`, `Map`, `SortedSet`, `NavigableSet`, `SortedMap`, `NavigableMap`, `SequencedCollection`, `SequencedSet`, dan `SequencedMap`; serta konsekuensinya untuk API design, domain modeling, performance, concurrency, dan boundary contract.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Interface adalah Contract, Implementation adalah Strategy](#2-mental-model-interface-adalah-contract-implementation-adalah-strategy)
3. [Peta Hierarchy Besar](#3-peta-hierarchy-besar)
4. [`Iterable<T>`: Kontrak Minimal untuk Traversal](#4-iterablet-kontrak-minimal-untuk-traversal)
5. [`Collection<E>`: Group of Elements](#5-collectione-group-of-elements)
6. [Optional Operations dan `UnsupportedOperationException`](#6-optional-operations-dan-unsupportedoperationexception)
7. [`List<E>`: Ordered Sequence with Positional Access](#7-liste-ordered-sequence-with-positional-access)
8. [`Set<E>`: Uniqueness Contract](#8-sete-uniqueness-contract)
9. [`SortedSet<E>`: Set dengan Sorted Order](#9-sortedsete-set-dengan-sorted-order)
10. [`NavigableSet<E>`: Sorted Set dengan Navigation](#10-navigablesete-sorted-set-dengan-navigation)
11. [`Queue<E>`: Holding Elements Prior to Processing](#11-queuee-holding-elements-prior-to-processing)
12. [`Deque<E>`: Double-Ended Queue](#12-dequee-double-ended-queue)
13. [`Map<K,V>`: Key-Value Association](#13-mapkv-key-value-association)
14. [`SortedMap<K,V>`: Map dengan Sorted Key Order](#14-sortedmapkv-map-dengan-sorted-key-order)
15. [`NavigableMap<K,V>`: Map dengan Navigation dan Range Query](#15-navigablemapkv-map-dengan-navigation-dan-range-query)
16. [Sequenced Interfaces: Java 21+ Encounter Order Contracts](#16-sequenced-interfaces-java-21-encounter-order-contracts)
17. [`SequencedCollection<E>`](#17-sequencedcollectione)
18. [`SequencedSet<E>`](#18-sequencedsete)
19. [`SequencedMap<K,V>`](#19-sequencedmapkv)
20. [Why `Map` Does Not Extend `Collection`](#20-why-map-does-not-extend-collection)
21. [Interface Choice as API Design](#21-interface-choice-as-api-design)
22. [Return Type vs Parameter Type](#22-return-type-vs-parameter-type)
23. [Domain Modeling with Interfaces](#23-domain-modeling-with-interfaces)
24. [Boundary Contract: API, DB, JSON, Event](#24-boundary-contract-api-db-json-event)
25. [Mutability Contract Is Not Fully Captured by Interface](#25-mutability-contract-is-not-fully-captured-by-interface)
26. [Null Contract Is Not Fully Captured by Interface](#26-null-contract-is-not-fully-captured-by-interface)
27. [Ordering Contract: Encounter, Sorted, Insertion, Access](#27-ordering-contract-encounter-sorted-insertion-access)
28. [Concurrency Contract Is Not Fully Captured by Interface](#28-concurrency-contract-is-not-fully-captured-by-interface)
29. [Common API Design Mistakes](#29-common-api-design-mistakes)
30. [Decision Matrix](#30-decision-matrix)
31. [Production Failure Modes](#31-production-failure-modes)
32. [Best Practices](#32-best-practices)
33. [Latihan](#33-latihan)
34. [Ringkasan](#34-ringkasan)
35. [Referensi](#35-referensi)

---

# 1. Tujuan Bagian Ini

Di Java, memilih interface collection bukan sekadar soal “bisa jalan”.

Ini adalah desain kontrak.

Perhatikan method berikut:

```java
void process(Collection<CaseId> caseIds)
```

vs:

```java
void process(List<CaseId> caseIds)
```

vs:

```java
void process(Set<CaseId> caseIds)
```

vs:

```java
void process(SequencedCollection<CaseId> caseIds)
```

vs:

```java
void process(Iterable<CaseId> caseIds)
```

Semuanya menerima lebih dari satu `CaseId`, tetapi meaning-nya berbeda.

## 1.1 Apa yang ingin kita kuasai?

Setelah bagian ini, kamu harus bisa menjawab:

- Kapan cukup `Iterable`?
- Kapan butuh `Collection`?
- Kapan `List` tepat?
- Kapan `Set` lebih benar daripada `List`?
- Kapan `Queue`/`Deque` lebih tepat?
- Kapan `Map` adalah model yang benar?
- Kapan butuh sorted/navigable?
- Kapan Java 21+ `SequencedCollection` membantu?
- Apa yang tidak dijamin oleh interface?
- Bagaimana memilih interface untuk API public/internal/domain?

## 1.2 Prinsip utama

```text
Use the narrowest interface that expresses the semantic contract you need.
```

Tapi “narrowest” bukan berarti asal paling kecil.

Misalnya jika order penting, `Collection` terlalu luas; `List` atau `SequencedCollection` mungkin lebih tepat.

---

# 2. Mental Model: Interface adalah Contract, Implementation adalah Strategy

## 2.1 Interface menjawab “apa yang dijanjikan?”

Contoh:

```java
Set<Permission>
```

menjanjikan:

```text
Tidak ada duplicate elements menurut equality semantics.
```

## 2.2 Implementation menjawab “bagaimana dijalankan?”

Contoh:

```java
HashSet<Permission>
LinkedHashSet<Permission>
TreeSet<Permission>
EnumSet<Permission>
```

Semua `Set`, tetapi strategy-nya berbeda:

- hash table;
- linked encounter order;
- tree sorted order;
- bit-vector specialized for enum.

## 2.3 API should expose contract, not storage detail

Bad:

```java
HashSet<Permission> permissions();
```

Better:

```java
Set<Permission> permissions();
```

If order matters:

```java
SequencedSet<Permission> permissions();
```

or:

```java
List<Permission> permissionsInDisplayOrder();
```

## 2.4 Internal implementation can be specific

```java
private final EnumSet<Permission> permissions;
```

Return as interface:

```java
public Set<Permission> permissions() {
    return Set.copyOf(permissions);
}
```

## 2.5 Mental shortcut

```text
Interface = semantic promise
Implementation = performance/storage/concurrency trade-off
```

---

# 3. Peta Hierarchy Besar

Simplified hierarchy:

```text
Iterable
  └── Collection
        ├── SequencedCollection
        │     ├── List
        │     ├── Deque
        │     └── SequencedSet
        │           ├── SortedSet
        │           │     └── NavigableSet
        │           └── LinkedHashSet-like ordered sets
        ├── Set
        │     ├── SequencedSet
        │     └── SortedSet
        │           └── NavigableSet
        └── Queue
              └── Deque

Map
  ├── SequencedMap
  └── SortedMap
        └── NavigableMap
```

Catatan:

- `Map` tidak extend `Collection`.
- `List`, `Set`, `Queue`, `Deque` adalah collection interfaces.
- `SortedSet` dan `NavigableSet` adalah specialization dari `Set`.
- `SortedMap` dan `NavigableMap` adalah specialization dari `Map`.
- Sequenced interfaces ditambahkan untuk collection/map yang punya encounter order.

## 3.1 Why hierarchy matters

Jika kamu memilih type terlalu umum:

```java
Collection<ApprovalStep>
```

padahal order wajib, bug bisa muncul karena caller memberi `HashSet`.

Jika kamu memilih type terlalu spesifik:

```java
ArrayList<ApprovalStep>
```

caller tidak bisa memberi immutable list atau custom list.

## 3.2 Correctness before convenience

Type signature adalah dokumentasi yang dicheck compiler.

---

# 4. `Iterable<T>`: Kontrak Minimal untuk Traversal

`Iterable<T>` adalah interface minimal untuk object yang bisa diiterasi.

```java
public interface Iterable<T> {
    Iterator<T> iterator();
}
```

## 4.1 Meaning

Jika method menerima:

```java
void export(Iterable<CaseSummary> cases)
```

maka method berkata:

```text
Saya hanya butuh melewati element satu per satu.
Saya tidak butuh size.
Saya tidak butuh contains.
Saya tidak butuh random access.
Saya tidak butuh mutation.
Saya tidak butuh uniqueness.
```

## 4.2 Use cases

Bagus untuk:

- streaming-ish input;
- lazy source;
- custom traversal;
- API yang tidak perlu collection operation;
- decoupling dari storage.

## 4.3 Example

```java
void writeCsv(Iterable<CaseSummary> rows, Writer writer) throws IOException {
    for (CaseSummary row : rows) {
        writer.write(row.toCsvLine());
        writer.write('\n');
    }
}
```

## 4.4 Why not `Collection`?

If you require `Collection`, caller must materialize all elements.

```java
void writeCsv(Collection<CaseSummary> rows, Writer writer)
```

This unnecessarily requires:

- size;
- collection storage;
- potentially all data in memory.

## 4.5 Limitation

`Iterable` does not guarantee re-iterability in every custom implementation.

Some custom Iterable may be one-shot.

If your API needs multiple passes, document it or require `Collection`.

## 4.6 Good question

```text
Do I only need to traverse once?
```

If yes, `Iterable` may be enough.

---

# 5. `Collection<E>`: Group of Elements

Java SE 25 `Collection` API says a collection represents a group of objects called its elements; some collections allow duplicates, some do not; some are ordered, some are unordered.

## 5.1 Meaning

```java
Collection<E>
```

means:

```text
A group of elements.
```

But it does not say:

- list order?
- uniqueness?
- sorted?
- queue processing policy?
- first/last?
- key lookup?

## 5.2 Core operations

Typical operations:

```java
size()
isEmpty()
contains(Object o)
iterator()
toArray()
add(E e)
remove(Object o)
containsAll(Collection<?> c)
addAll(Collection<? extends E> c)
removeAll(Collection<?> c)
retainAll(Collection<?> c)
clear()
```

Some operations are optional.

## 5.3 When Collection is good

Use `Collection` when:

- you need group semantics;
- you need size/empty maybe;
- you do not care order;
- you do not require uniqueness;
- you do not require positional access;
- you might accept list/set/queue.

Example:

```java
boolean hasAnyBlockedPermission(Collection<Permission> permissions) {
    return permissions.stream().anyMatch(Permission::isBlocked);
}
```

## 5.4 When Collection is too weak

If order matters:

```java
Collection<ApprovalStep> steps
```

is too weak.

Use:

```java
List<ApprovalStep>
```

or:

```java
SequencedCollection<ApprovalStep>
```

If uniqueness matters:

```java
Set<Permission>
```

If processing policy matters:

```java
Queue<Job>
```

## 5.5 Collection as parameter

`Collection` is often good for accepting bulk inputs when you need `size` or bulk operations.

## 5.6 Collection as return type

Returning `Collection` can be vague. Caller may not know:

- is order stable?
- can duplicates exist?
- can mutate?

Return more precise type if semantics matter.

---

# 6. Optional Operations dan `UnsupportedOperationException`

Collections Framework has optional operations.

Example:

```java
List<String> xs = List.of("a", "b");
xs.add("c"); // UnsupportedOperationException
```

## 6.1 Why optional operations exist

Interfaces like `Collection` include mutating operations, but not all implementations are mutable.

Examples:

- immutable list;
- unmodifiable view;
- fixed-size list from `Arrays.asList`;
- custom read-only collection.

## 6.2 Important consequence

Type:

```java
List<String>
```

does not guarantee mutability.

## 6.3 Bad assumption

```java
void addDefault(List<String> values) {
    values.add("default");
}
```

This can fail if caller passes `List.of()`.

## 6.4 Better API

If method mutates input, make contract explicit.

Option A: document and name clearly:

```java
void addDefaultToMutableList(List<String> mutableValues)
```

Option B: do not mutate caller input:

```java
List<String> withDefault(List<String> values) {
    ArrayList<String> copy = new ArrayList<>(values);
    copy.add("default");
    return List.copyOf(copy);
}
```

## 6.5 Rule

```text
Collection interface does not imply mutability.
```

Always define ownership and mutation policy.

---

# 7. `List<E>`: Ordered Sequence with Positional Access

`List` represents an ordered collection, also known as a sequence. Duplicates are generally permitted and elements can be accessed by integer index.

## 7.1 Meaning

```java
List<ApprovalStep>
```

says:

```text
Order matters.
Duplicates may exist unless domain forbids them.
Index/position may matter.
```

## 7.2 Core operations

```java
get(int index)
set(int index, E element)
add(int index, E element)
remove(int index)
indexOf(Object o)
lastIndexOf(Object o)
listIterator()
subList(int from, int to)
```

## 7.3 Good use cases

- ordered steps;
- API response sorted order;
- CSV rows;
- timeline display;
- priority after sorting;
- batch item order;
- positional data.

## 7.4 Bad use cases

If you need uniqueness:

```java
List<Permission>
```

may allow duplicate permission.

Better:

```java
Set<Permission>
```

or domain wrapper:

```java
PermissionSet
```

If you only need traversal:

```java
Iterable<T>
```

may be enough.

## 7.5 `List` does not mean random-access efficient

`LinkedList` implements `List`, but `get(i)` is not O(1).

If algorithm requires random access, consider checking `RandomAccess` or require specific strategy.

## 7.6 `List` and equality

List equality is order-sensitive.

```java
List.of("A", "B").equals(List.of("B", "A")) // false
```

## 7.7 Review questions

- Does order matter?
- Are duplicates allowed?
- Is index meaningful?
- Is mutation allowed?
- Is it large?
- Is random access assumed?

---

# 8. `Set<E>`: Uniqueness Contract

`Set` models uniqueness.

## 8.1 Meaning

```java
Set<Permission>
```

says:

```text
No duplicate elements according to set equality semantics.
```

## 8.2 Core semantic dependency

Set correctness depends on:

- `equals`;
- `hashCode` for hash-based sets;
- comparator for sorted sets.

## 8.3 Good use cases

- permissions;
- tags;
- unique IDs;
- visited nodes;
- membership tests;
- deduplication.

## 8.4 Bad use cases

If order matters and duplicate entries are meaningful, use List.

If sorted order matters, use SortedSet/NavigableSet.

If enum values, consider `EnumSet`.

## 8.5 Set equality

Set equality is not order-sensitive.

```java
Set.of("A", "B").equals(Set.of("B", "A")) // true
```

## 8.6 Duplicate policy

If input has duplicate values, using Set silently removes duplicates.

This may be correct or dangerous.

Example:

```java
Set<CaseId> caseIds = new HashSet<>(request.caseIds());
```

If duplicate request item indicates client error, silent dedup hides bug.

## 8.7 Review questions

- Is duplicate invalid or merely redundant?
- Should duplicate be rejected or deduped?
- Is equality correct?
- Is order needed for display/audit?
- Is Set represented as JSON array? Is `uniqueItems` documented?

---

# 9. `SortedSet<E>`: Set dengan Sorted Order

`SortedSet` is a Set that provides a total ordering on its elements.

## 9.1 Meaning

```java
SortedSet<Version>
```

says:

```text
Unique elements + sorted order.
```

## 9.2 Sorting source

Sorting comes from either:

- natural ordering via `Comparable`;
- supplied `Comparator`.

## 9.3 Core methods

```java
comparator()
first()
last()
headSet(E toElement)
tailSet(E fromElement)
subSet(E fromElement, E toElement)
```

## 9.4 Good use cases

- sorted versions;
- sorted timestamps;
- ordered range by key;
- ranking;
- names sorted by locale-independent code;
- sorted unique IDs.

## 9.5 Comparator consistency issue

If comparator considers two objects equal, set treats them as duplicates.

Example:

```java
Comparator<Person> byAge = Comparator.comparing(Person::age);
```

Two different persons with same age cannot both exist in TreeSet with this comparator.

## 9.6 Review questions

- Is ordering natural and stable?
- Is comparator consistent with desired uniqueness?
- Are fields used for comparison immutable?
- Are range operations needed?

---

# 10. `NavigableSet<E>`: Sorted Set dengan Navigation

`NavigableSet` extends SortedSet with navigation methods.

## 10.1 Meaning

```java
NavigableSet<Instant> timestamps
```

says:

```text
Sorted unique values + need nearest/range/navigation operations.
```

## 10.2 Core methods

```java
lower(E e)
floor(E e)
ceiling(E e)
higher(E e)
pollFirst()
pollLast()
descendingSet()
descendingIterator()
subSet(..., inclusive...)
headSet(..., inclusive)
tailSet(..., inclusive)
```

## 10.3 Use cases

- nearest event before timestamp;
- SLA threshold lookup;
- version ranges;
- sorted schedule;
- time window;
- lower/upper bound.

## 10.4 Example

```java
NavigableSet<Instant> eventTimes = new TreeSet<>();

Instant previous = eventTimes.floor(queryTime);
Instant next = eventTimes.ceiling(queryTime);
```

## 10.5 Caution

`pollFirst` and `pollLast` mutate the set.

If set immutable/unmodifiable, operation may fail.

## 10.6 Review questions

- Do we need nearest element?
- Do we need inclusive/exclusive ranges?
- Is mutation through poll allowed?
- Is comparator stable?

---

# 11. `Queue<E>`: Holding Elements Prior to Processing

Java SE 25 Collections Framework outline describes `Queue` as a collection designed for holding elements before processing; queues provide insertion, extraction, and inspection operations in addition to basic collection operations.

## 11.1 Meaning

```java
Queue<Job> jobs
```

says:

```text
Elements are waiting to be processed according to queue policy.
```

Policy is not always FIFO.

Examples:

- FIFO queue;
- priority queue;
- delay queue;
- blocking queue.

## 11.2 Method pairs

Queue has methods that differ in failure behavior.

Insertion:

```java
add(e)    // throws if cannot add
offer(e)  // returns false if cannot add
```

Removal:

```java
remove()  // throws if empty
poll()    // returns null if empty
```

Inspection:

```java
element() // throws if empty
peek()    // returns null if empty
```

## 11.3 Good use cases

- work queue;
- retry queue;
- BFS traversal;
- event processing buffer;
- scheduling with priority/delay.

## 11.4 Important semantic

Queue interface alone does not say:

- bounded or unbounded;
- blocking or non-blocking;
- FIFO or priority;
- thread-safe or not.

Implementation matters heavily.

## 11.5 Review questions

- Is queue bounded?
- What happens when full?
- What happens when empty?
- Is processing FIFO?
- Is this concurrent?
- Is backpressure needed?

---

# 12. `Deque<E>`: Double-Ended Queue

Java SE 25 `Deque` API describes it as a linear collection supporting insertion and removal at both ends; the name means double-ended queue.

## 12.1 Meaning

```java
Deque<Task> tasks
```

says:

```text
Elements can be added/removed from both front and back.
```

## 12.2 Core operations

Front:

```java
addFirst
offerFirst
removeFirst
pollFirst
getFirst
peekFirst
```

Back:

```java
addLast
offerLast
removeLast
pollLast
getLast
peekLast
```

Stack-like:

```java
push
pop
```

## 12.3 Good use cases

- stack;
- queue;
- BFS/DFS;
- work stealing-like structures;
- sliding window;
- undo/redo;
- recent history.

## 12.4 Usually prefer ArrayDeque

For non-concurrent stack/queue, `ArrayDeque` is often better than `LinkedList`.

## 12.5 Null

Deque implementations generally should not accept null if null is used as special return value by poll/peek. `ArrayDeque` does not permit null elements.

## 12.6 Review questions

- Do we need both ends?
- Are nulls disallowed?
- Is bounded capacity required?
- Is concurrent access required?

---

# 13. `Map<K,V>`: Key-Value Association

Map maps keys to values. Each key maps to at most one value.

## 13.1 Meaning

```java
Map<CaseId, CaseSummary>
```

says:

```text
Lookup by CaseId is central.
Keys are unique.
```

## 13.2 Core operations

```java
get(key)
put(key, value)
containsKey(key)
containsValue(value)
remove(key)
putIfAbsent(key, value)
computeIfAbsent(key, function)
compute(key, function)
merge(key, value, remappingFunction)
keySet()
values()
entrySet()
```

## 13.3 Good use cases

- index by ID;
- cache;
- lookup table;
- grouping result;
- frequency counter;
- association table;
- transition table.

## 13.4 Key design

Map correctness depends on key semantics.

Key should generally be:

- immutable;
- proper equals/hashCode or comparator;
- not array unless wrapped;
- canonicalized if string-like.

## 13.5 `Map.get` ambiguity

If map allows null values:

```java
V value = map.get(key);
```

null can mean:

- absent key;
- key present with null value.

Use:

```java
containsKey
```

if needed.

## 13.6 Review questions

- Is key immutable?
- Is null value allowed?
- Does map represent domain object or just index?
- Is map large?
- Is map concurrent?
- Is map serialized to JSON? How are keys represented?

---

# 14. `SortedMap<K,V>`: Map dengan Sorted Key Order

`SortedMap` is a Map that maintains keys in sorted order.

## 14.1 Meaning

```java
SortedMap<Instant, CaseEvent> eventsByTime
```

says:

```text
Keys are sorted.
Range/head/tail operations may matter.
```

## 14.2 Core methods

```java
comparator()
firstKey()
lastKey()
headMap(K toKey)
tailMap(K fromKey)
subMap(K fromKey, K toKey)
```

## 14.3 Use cases

- events by timestamp;
- version-indexed data;
- price tiers;
- date ranges;
- sorted lookup table.

## 14.4 Comparator consistency

Same issue as sorted sets. Comparator determines key uniqueness.

## 14.5 Review questions

- Is sorted key order required?
- Is comparator stable?
- Are range views used?
- Are keys immutable?

---

# 15. `NavigableMap<K,V>`: Map dengan Navigation dan Range Query

`NavigableMap` extends SortedMap with navigation methods.

## 15.1 Meaning

```java
NavigableMap<Instant, CaseSnapshot> snapshots
```

says:

```text
We need sorted key-value lookup with nearest/range navigation.
```

## 15.2 Core methods

```java
lowerEntry
floorEntry
ceilingEntry
higherEntry
firstEntry
lastEntry
pollFirstEntry
pollLastEntry
descendingMap
navigableKeySet
descendingKeySet
subMap(... inclusive flags ...)
headMap(... inclusive)
tailMap(... inclusive)
```

## 15.3 Use cases

- latest snapshot before time;
- effective-dated config;
- interval boundary lookup;
- versioned rules;
- timeline.

## 15.4 Example

```java
Map.Entry<Instant, Rule> activeRule = rules.floorEntry(now);
```

## 15.5 Caution

Range views are backed by map in common implementations. Mutations can affect original map.

## 15.6 Review questions

- Is nearest lookup needed?
- Are inclusive/exclusive bounds correct?
- Are range views exposed?
- Is mutation through views controlled?

---

# 16. Sequenced Interfaces: Java 21+ Encounter Order Contracts

Before Java 21, many collections had encounter order, but there was no common abstraction for “first/last/reversed”.

JEP 431 introduced new interfaces:

```java
SequencedCollection
SequencedSet
SequencedMap
```

and retrofitted them into existing collections type hierarchy.

## 16.1 Encounter order

Encounter order is the order in which elements are encountered during traversal.

Examples:

- List index order.
- LinkedHashSet insertion order.
- SortedSet sorted order.
- LinkedHashMap insertion/access order.
- TreeMap sorted key order.

## 16.2 Why useful

Generic code can now express:

```text
I need collection with defined encounter order and first/last access.
```

without forcing List or Deque.

## 16.3 API design implication

Instead of:

```java
List<Event> eventHistory
```

you might use:

```java
SequencedCollection<Event> eventHistory
```

if you need order/first/last/reversed but not index.

## 16.4 Caution

Sequenced does not necessarily mean mutable.

Methods may throw `UnsupportedOperationException`.

---

# 17. `SequencedCollection<E>`

## 17.1 Meaning

```java
SequencedCollection<E>
```

says:

```text
This collection has a defined encounter order.
First and last are meaningful.
Reverse view is meaningful.
```

## 17.2 Conceptual operations

```java
getFirst()
getLast()
addFirst(E)
addLast(E)
removeFirst()
removeLast()
reversed()
```

## 17.3 When to use

Use when:

- encounter order matters;
- need first/last;
- do not require index;
- do not require uniqueness;
- want generic ordered collection abstraction.

## 17.4 Example

```java
record EventHistory(SequencedCollection<CaseEvent> events) {
    CaseEvent latest() {
        return events.getLast();
    }

    SequencedCollection<CaseEvent> newestFirst() {
        return events.reversed();
    }
}
```

## 17.5 List vs SequencedCollection

Use `List` if index matters.

Use `SequencedCollection` if only order/first/last matters.

## 17.6 Review question

```text
Do I need index or just encounter order?
```

---

# 18. `SequencedSet<E>`

## 18.1 Meaning

```java
SequencedSet<E>
```

says:

```text
Unique elements + defined encounter order.
```

## 18.2 Use cases

- unique approvals in insertion order;
- recently seen unique IDs;
- ordered permission display without duplicates;
- deterministic unique output.

## 18.3 Difference from Set

Plain `Set` does not promise encounter order.

`SequencedSet` does.

## 18.4 Difference from SortedSet

`SortedSet` order is sorted by comparator/natural ordering.

`SequencedSet` order can be insertion order or some defined encounter order.

## 18.5 Example

```java
record OrderedUniqueTags(SequencedSet<Tag> tags) {}
```

## 18.6 Review question

```text
Do we need uniqueness and stable order?
```

If yes, `SequencedSet` may express it better than `Set`.

---

# 19. `SequencedMap<K,V>`

## 19.1 Meaning

```java
SequencedMap<K,V>
```

says:

```text
Map entries have defined encounter order.
First/last entry are meaningful.
Reverse view is meaningful.
```

## 19.2 Conceptual operations

```java
firstEntry()
lastEntry()
pollFirstEntry()
pollLastEntry()
putFirst(K,V)
putLast(K,V)
reversed()
sequencedKeySet()
sequencedValues()
sequencedEntrySet()
```

## 19.3 Use cases

- LRU-like structures with access order;
- deterministic ordered maps;
- event by insertion order;
- first/last config rule;
- ordered response fields/entries;
- stable cache inspection.

## 19.4 LinkedHashMap

`LinkedHashMap` is a classic implementation with encounter order.

## 19.5 TreeMap

Sorted maps also have encounter order based on sorted keys and can be sequenced in Java 21+ hierarchy.

## 19.6 Review question

```text
Is first/last map entry meaningful?
```

If yes, consider SequencedMap.

---

# 20. Why `Map` Does Not Extend `Collection`

A `Collection<E>` is a group of elements.

A `Map<K,V>` is a group of associations from key to value.

Its natural element is not just `K` or `V`, but an entry:

```java
Map.Entry<K,V>
```

Therefore Map provides collection views:

```java
Set<K> keySet()
Collection<V> values()
Set<Map.Entry<K,V>> entrySet()
```

## 20.1 View warning

These are often backed views.

Mutating view can mutate map.

```java
map.keySet().remove(key);
```

removes mapping.

## 20.2 Values view

Values are not a set because multiple keys can map to same value.

## 20.3 Entry mutation

Some entries may support `setValue`.

## 20.4 API warning

Do not expose mutable internal map views accidentally.

## 20.5 Better

Return copy/snapshot if crossing boundary:

```java
return Map.copyOf(internalMap);
```

---

# 21. Interface Choice as API Design

## 21.1 Too broad

```java
void process(Collection<ApprovalStep> steps)
```

If order matters, this is too broad.

Caller could pass `HashSet`.

## 21.2 Too narrow

```java
void process(ArrayList<ApprovalStep> steps)
```

This is too narrow.

Caller cannot pass immutable list.

## 21.3 Better

If index matters:

```java
void process(List<ApprovalStep> steps)
```

If first/last/order matters but not index:

```java
void process(SequencedCollection<ApprovalStep> steps)
```

If only traversal:

```java
void process(Iterable<ApprovalStep> steps)
```

## 21.4 Parameter should say required capability

Do not accept `List` if you only iterate.

Do not accept `Collection` if you require order.

Do not accept `Set` if duplicates are meaningful.

## 21.5 Return should say promised semantics

If result order is stable, return type/name should say it.

```java
List<CaseSummary> findSummariesSortedByUpdatedAt()
```

or:

```java
SequencedCollection<CaseSummary> summariesInDisplayOrder()
```

---

# 22. Return Type vs Parameter Type

There is a useful asymmetry.

## 22.1 Parameters can be broad

Accept what you need.

```java
void addAll(Iterable<CaseId> ids)
```

if only traversal needed.

## 22.2 Return types should be precise enough

Return what you promise.

```java
Set<Permission> permissions()
```

instead of:

```java
Collection<Permission> permissions()
```

if uniqueness is guaranteed.

## 22.3 Do not return mutable internals

Return snapshot or unmodifiable view deliberately.

## 22.4 Streams as return type

Be careful returning `Stream`.

A returned Stream may be:

- single-use;
- lazy;
- resource-backed;
- tied to transaction.

Often better:

```java
List<T>
Iterable<T>
void forEach(Consumer<T>)
```

depending use.

## 22.5 Rule

```text
Parameter type = minimum required from caller.
Return type = semantic guarantee to caller.
```

---

# 23. Domain Modeling with Interfaces

## 23.1 PermissionSet

Bad:

```java
List<String> permissions
```

Better:

```java
Set<Permission> permissions
```

Even better:

```java
record PermissionSet(EnumSet<Permission> values) {}
```

## 23.2 ApprovalSteps

Bad:

```java
Collection<ApprovalStep> steps
```

Better:

```java
List<ApprovalStep> steps
```

or domain wrapper:

```java
record ApprovalSteps(SequencedCollection<ApprovalStep> steps) {}
```

## 23.3 EventHistory

Need latest event:

```java
record EventHistory(SequencedCollection<CaseEvent> events) {}
```

## 23.4 CaseIndex

Lookup by ID:

```java
Map<CaseId, CaseSummary>
```

But if domain operation exists, wrap:

```java
record CaseSummaryIndex(Map<CaseId, CaseSummary> values) {
    Optional<CaseSummary> find(CaseId id) { ... }
}
```

## 23.5 Rule

Raw collection is fine for low-level operations. Domain-level collection often deserves wrapper.

---

# 24. Boundary Contract: API, DB, JSON, Event

Java interface semantics often do not survive boundary automatically.

## 24.1 JSON array

Both `List` and `Set` become JSON array.

```json
["READ", "WRITE"]
```

If uniqueness matters, schema should say:

```yaml
uniqueItems: true
```

## 24.2 JSON object for Map

Map keys become strings.

```java
Map<CaseId, CaseSummary>
```

JSON:

```json
{
  "CASE-00000001": { ... }
}
```

Maybe better:

```json
[
  { "caseId": "CASE-00000001", "summary": { ... } }
]
```

## 24.3 DB collection

`List<OrderLine>` maps to child table with order column if order matters.

`Set<Permission>` maps to join table with unique constraint.

## 24.4 Event payload

Collections in events need compatibility and max size.

## 24.5 Rule

When collection crosses boundary, restate semantics in boundary schema.

---

# 25. Mutability Contract Is Not Fully Captured by Interface

```java
List<String>
```

could be:

- mutable ArrayList;
- immutable List.of;
- unmodifiable view;
- fixed-size Arrays.asList;
- custom list.

## 25.1 Interface cannot tell

The type does not say whether `add` works.

## 25.2 Use naming/documentation

```java
List<String> mutableBuffer
List<String> snapshot
```

## 25.3 Prefer immutable return

```java
return List.copyOf(values);
```

## 25.4 If mutation required

Consider owning the collection internally:

```java
private final List<T> values = new ArrayList<>();
```

Expose behavior methods, not collection.

## 25.5 Rule

Mutability is part of API contract even if Java type does not encode it.

---

# 26. Null Contract Is Not Fully Captured by Interface

```java
List<String>
```

does not say whether null elements are allowed.

## 26.1 Some implementations allow null

`ArrayList`, `HashSet`, `HashMap`.

## 26.2 Some disallow null

`List.of`, `Set.of`, `Map.of`, `ConcurrentHashMap`.

## 26.3 Null in domain collections

Usually avoid null elements.

Use:

- Optional at edge;
- filtering;
- explicit absence type;
- validation.

## 26.4 API schema

For JSON array, item schema should specify whether null item allowed.

## 26.5 Rule

Define null policy explicitly.

---

# 27. Ordering Contract: Encounter, Sorted, Insertion, Access

Ordering terms matter.

## 27.1 Encounter order

Traversal order.

Examples:

- list index order;
- insertion order in LinkedHashSet;
- sorted order in TreeSet.

## 27.2 Sorted order

Order determined by comparator/natural ordering.

## 27.3 Insertion order

Order in which elements were inserted.

## 27.4 Access order

Order changes when entries are accessed, e.g. LinkedHashMap configured for access order.

## 27.5 Undefined/unspecified order

HashSet/HashMap order should not be relied on.

## 27.6 Review question

```text
What kind of order is required?
```

If answer is unclear, bug risk exists.

---

# 28. Concurrency Contract Is Not Fully Captured by Interface

```java
Map<K,V>
```

could be:

- HashMap: not thread-safe;
- ConcurrentHashMap: concurrent;
- synchronizedMap: synchronized wrapper;
- immutable Map: safe snapshot if values immutable.

## 28.1 Interface hides concurrency behavior

API should document if returned collection is thread-safe or immutable.

## 28.2 Concurrent value problem

```java
ConcurrentHashMap<UserId, List<Permission>>
```

Map concurrent, list not.

## 28.3 Immutable snapshot

Often easiest safe sharing strategy.

```java
Map.copyOf(values)
```

assuming values are immutable too.

## 28.4 Rule

Thread-safety is not guaranteed by collection interface.

---

# 29. Common API Design Mistakes

## 29.1 Accepting `List` when only iterating

```java
void export(List<Row> rows)
```

Better:

```java
void export(Iterable<Row> rows)
```

if only one pass.

## 29.2 Accepting `Collection` when order matters

```java
void execute(Collection<Step> steps)
```

Better:

```java
List<Step>
```

or `SequencedCollection<Step>`.

## 29.3 Returning mutable internal map

```java
Map<K,V> values() { return internal; }
```

Better:

```java
return Map.copyOf(internal);
```

## 29.4 Using `Set` but relying on insertion order

```java
Set<Tag> tags = new HashSet<>();
```

Better:

```java
SequencedSet<Tag>
LinkedHashSet<Tag>
```

or document no order.

## 29.5 Using `Map` as domain object

```java
Map<String,Object> caseData
```

Better typed record.

## 29.6 Returning Stream from repository casually

May leak DB connection/transaction.

## 29.7 Using Queue without bounds

Unbounded memory risk.

---

# 30. Decision Matrix

| Need | Interface |
|---|---|
| only one-pass traversal | `Iterable<T>` |
| group of elements, no order/unique requirement | `Collection<T>` |
| ordered sequence, index matters | `List<T>` |
| uniqueness matters | `Set<T>` |
| uniqueness + sorted order | `SortedSet<T>` |
| uniqueness + range/nearest navigation | `NavigableSet<T>` |
| waiting to process | `Queue<T>` |
| add/remove both ends, stack/queue | `Deque<T>` |
| lookup by key | `Map<K,V>` |
| lookup by key + sorted keys | `SortedMap<K,V>` |
| key range/nearest lookup | `NavigableMap<K,V>` |
| defined encounter order + first/last | `SequencedCollection<T>` |
| unique + defined encounter order | `SequencedSet<T>` |
| map + defined encounter order | `SequencedMap<K,V>` |
| enum membership set | `EnumSet<E>` internally, `Set<E>` externally |
| concurrent lookup/update | `ConcurrentMap<K,V>` / `ConcurrentHashMap<K,V>` |
| blocking producer-consumer | `BlockingQueue<T>` |

---

# 31. Production Failure Modes

## 31.1 Wrong interface: order lost

Method accepts `Collection<Step>`, caller passes `HashSet`, workflow order random/undefined.

Fix:

```java
List<Step>
SequencedCollection<Step>
```

## 31.2 Duplicate silently removed

Request list converted to Set, duplicate input hidden.

Fix:

- reject duplicates explicitly;
- or document dedup.

## 31.3 Mutable return corruption

Getter returns internal list, caller clears it.

Fix:

```java
List.copyOf
```

## 31.4 `UnsupportedOperationException`

Method mutates list passed from `List.of`.

Fix:

- do not mutate input;
- copy first;
- document mutable requirement.

## 31.5 TreeSet drops elements

Comparator compares only partial field.

Fix:

- comparator includes identity tie-breaker;
- use HashSet if sorted uniqueness not desired.

## 31.6 Concurrent map value race

`ConcurrentHashMap<K,List<V>>` mutated unsafely.

Fix:

- immutable values;
- compute/merge;
- concurrent value type.

## 31.7 JSON map key issue

`Map<CaseId,Value>` serialized with string keys, client weakly typed.

Fix:

- array of entries.

## 31.8 Stream returned from closed resource

Repository returns stream after transaction closed.

Fix:

- consume inside transaction;
- return list/page;
- explicitly manage resource stream.

---

# 32. Best Practices

## 32.1 Interface selection

- Use `Iterable` if traversal only.
- Use `Collection` if group semantics enough.
- Use `List` if order/index matters.
- Use `Set` if uniqueness matters.
- Use `Queue`/`Deque` for processing semantics.
- Use `Map` for lookup by key.
- Use sorted/navigable only when sorting/range needed.
- Use sequenced interfaces for encounter order + first/last.

## 32.2 API design

- Parameters: accept minimum capability required.
- Returns: promise precise semantics.
- Do not expose mutable internals.
- Document mutability/null/order/uniqueness.
- Avoid returning Stream unless lifetime is clear.

## 32.3 Domain design

- Wrap collections when invariants matter.
- Use `PermissionSet`, `ViolationList`, `EventHistory`, not raw collection everywhere.
- Use immutable snapshots across boundaries.

## 32.4 Boundary design

- Translate Java collection semantics into API/DB/event schema.
- Define array max size.
- Define uniqueness/order/null item policy.
- Avoid complex map keys in public JSON.

## 32.5 Production design

- Choose implementation based on operation profile.
- Do not rely on unspecified iteration order.
- Avoid mutable keys.
- Be careful with concurrent values.
- Test boundary and mutation behavior.

---

# 33. Latihan

## Latihan 1 — Interface Choice

Pilih interface untuk setiap case:

1. service hanya menulis rows ke CSV satu kali;
2. approval steps harus diproses sesuai urutan;
3. permission user tidak boleh duplicate;
4. event history butuh latest event;
5. lookup case summary by ID;
6. scheduled rules perlu nearest rule before timestamp;
7. background jobs perlu blocking producer-consumer.

Jelaskan semantic contract-nya.

## Latihan 2 — Refactor API

Refactor:

```java
void process(Collection<ApprovalStep> steps)
```

menjadi signature yang lebih tepat jika:

- index matters;
- only first/last matters;
- only traversal matters.

## Latihan 3 — Boundary Schema

Desain JSON schema concept untuk:

```java
Set<Permission>
SequencedCollection<CaseEvent>
Map<CaseId, CaseSummary>
```

Jelaskan order/unique/key policy.

## Latihan 4 — Mutability

Review:

```java
class CaseGroup {
    private final List<CaseId> ids;

    List<CaseId> ids() {
        return ids;
    }
}
```

Apa masalahnya? Refactor.

## Latihan 5 — Map Key

Design key type untuk:

```java
Map<TenantId + CaseId, CaseSummary>
```

Pilih:

- nested map;
- composite key record;
- string key;
- TenantCaseRef.

Jelaskan pilihan.

---

# 34. Ringkasan

Bagian ini membahas hierarchy interface sebagai contract.

Core lessons:

- `Iterable` = traversal minimal.
- `Collection` = group of elements, but no precise order/unique semantics.
- `List` = ordered sequence with positional access.
- `Set` = uniqueness.
- `SortedSet` = uniqueness + sorted order.
- `NavigableSet` = sorted set + nearest/range navigation.
- `Queue` = elements waiting for processing.
- `Deque` = double-ended queue.
- `Map` = key-value association, not Collection.
- `SortedMap` = map with sorted keys.
- `NavigableMap` = sorted map + nearest/range navigation.
- `SequencedCollection` = defined encounter order + first/last/reversed.
- `SequencedSet` = uniqueness + encounter order.
- `SequencedMap` = map entries with encounter order.

Most important principle:

```text
Choose interface based on semantic contract, not habit.
```

And remember:

```text
Interface does not fully encode mutability, nullability, thread-safety, or boundary semantics.
```

Those must be designed, documented, tested, and often wrapped in domain types.

---

# 35. Referensi

1. Java SE 25 — Collections Framework Overview  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/doc-files/coll-overview.html

2. Java SE 25 — Outline of the Collections Framework  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/doc-files/coll-reference.html

3. Java SE 25 — `Collection`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html

4. Java SE 25 — `List`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

5. Java SE 25 — `Set`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Set.html

6. Java SE 25 — `Queue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Queue.html

7. Java SE 25 — `Deque`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Deque.html

8. Java SE 25 — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

9. JEP 431 — Sequenced Collections  
   https://openjdk.org/jeps/431

10. Oracle Java 21 Guide — Creating Sequenced Collections, Sets, and Maps  
    https://docs.oracle.com/en/java/javase/21/core/creating-sequenced-collections-sets-and-maps.html

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-000.md](./learn-java-collections-and-streams-part-000.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-002.md](./learn-java-collections-and-streams-part-002.md)

</div>