# learn-java-data-types-part-016.md

# Java Data Types — Part 016  
# Collections as Data Types: List, Set, Map, Queue, Sequenced, Mutability, Ordering, dan Semantics

> Seri: **Advanced Java Data Types**  
> Bagian: **016**  
> Fokus: memahami Java Collections bukan sekadar container, tetapi data type dengan semantic contract: ordering, uniqueness, key-value mapping, mutability, null policy, equality, hashing, iteration, fail-fast behavior, unmodifiable views, immutable snapshots, concurrent collections, performance trade-off, dan domain modeling.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Collections sebagai Data Type, Bukan Sekadar Container](#2-collections-sebagai-data-type-bukan-sekadar-container)
3. [Collections Framework Overview](#3-collections-framework-overview)
4. [Mental Model: Collection = Shape + Semantics + Contract](#4-mental-model-collection--shape--semantics--contract)
5. [`Iterable` dan `Iterator`](#5-iterable-dan-iterator)
6. [`Collection<E>`](#6-collectione)
7. [`List<E>`: Ordered, Indexed, Duplicates Allowed](#7-liste-ordered-indexed-duplicates-allowed)
8. [`Set<E>`: Uniqueness by Equality](#8-sete-uniqueness-by-equality)
9. [`Map<K,V>`: Key-Value Association](#9-mapkv-key-value-association)
10. [`Queue<E>` dan `Deque<E>`](#10-queuee-dan-dequee)
11. [Sequenced Collections: Java 21+](#11-sequenced-collections-java-21)
12. [Implementation Matters: Interface vs Implementation](#12-implementation-matters-interface-vs-implementation)
13. [`ArrayList` vs `LinkedList`](#13-arraylist-vs-linkedlist)
14. [`HashSet`, `LinkedHashSet`, `TreeSet`, `EnumSet`](#14-hashset-linkedhashset-treeset-enumset)
15. [`HashMap`, `LinkedHashMap`, `TreeMap`, `EnumMap`, `IdentityHashMap`, `WeakHashMap`](#15-hashmap-linkedhashmap-treemap-enummap-identityhashmap-weakhashmap)
16. [Equality Semantics dalam Collections](#16-equality-semantics-dalam-collections)
17. [Ordering vs Sorting vs Encounter Order](#17-ordering-vs-sorting-vs-encounter-order)
18. [Null Policy](#18-null-policy)
19. [Mutability, Unmodifiable View, dan Immutable Snapshot](#19-mutability-unmodifiable-view-dan-immutable-snapshot)
20. [`List.of`, `Set.of`, `Map.of`, `copyOf`](#20-listof-setof-mapof-copyof)
21. [`Collections.unmodifiable*` vs `List.copyOf`](#21-collectionsunmodifiable-vs-listcopyof)
22. [Defensive Copy dan Representation Exposure](#22-defensive-copy-dan-representation-exposure)
23. [Fail-Fast Iterator dan `ConcurrentModificationException`](#23-fail-fast-iterator-dan-concurrentmodificationexception)
24. [Concurrent Collections](#24-concurrent-collections)
25. [`ConcurrentHashMap`](#25-concurrenthashmap)
26. [`CopyOnWriteArrayList` dan `CopyOnWriteArraySet`](#26-copyonwritearraylist-dan-copyonwritearrayset)
27. [Blocking Queues](#27-blocking-queues)
28. [Streams dan Collections](#28-streams-dan-collections)
29. [Collections dan Generics/Wildcards](#29-collections-dan-genericswildcards)
30. [Collections di Domain Model](#30-collections-di-domain-model)
31. [Collections di API/JSON/DB/Event Boundary](#31-collections-di-apijsondbevent-boundary)
32. [Performance dan Memory Trade-Off](#32-performance-dan-memory-trade-off)
33. [Primitive Collections dan Large Data](#33-primitive-collections-dan-large-data)
34. [Production Failure Modes](#34-production-failure-modes)
35. [Best Practices](#35-best-practices)
36. [Decision Matrix](#36-decision-matrix)
37. [Latihan](#37-latihan)
38. [Ringkasan](#38-ringkasan)
39. [Referensi](#39-referensi)

---

# 1. Tujuan Bagian Ini

Collections sering dianggap sekadar “tempat menyimpan banyak data”.

```java
List<String> names;
Set<Role> roles;
Map<CaseId, CaseRecord> cases;
Queue<Task> tasks;
```

Tetapi di level senior, collection adalah **data type dengan semantic contract**.

`List<User>` bukan hanya “banyak user”. Ia berarti:

```text
ordered
indexed
duplicates allowed
possibly mutable
iteration order significant
```

`Set<Role>` berarti:

```text
unique by equals/hashCode or comparator
no duplicates according to set semantics
order may or may not be defined depending implementation
```

`Map<CaseId, CaseRecord>` berarti:

```text
each key maps to at most one value
key equality defines identity
missing key has semantics
null policy matters
```

Tujuan bagian ini:

- memahami interface utama collection;
- memahami semantics `List`, `Set`, `Map`, `Queue`, `Deque`;
- memahami sequenced collections Java 21+;
- memahami implementation choice;
- memahami mutability/unmodifiable/immutable;
- memahami equality/order/null pitfalls;
- memahami fail-fast iterator;
- memahami concurrent collections;
- memahami collection sebagai bagian dari domain model;
- memahami production failure modes.

---

# 2. Collections sebagai Data Type, Bukan Sekadar Container

Ketika memilih collection type, kamu sebenarnya membuat pernyataan domain.

## 2.1 List

```java
List<ApprovalStep> steps;
```

Berarti urutan penting.

## 2.2 Set

```java
Set<Permission> permissions;
```

Berarti uniqueness penting; duplicate tidak meaningful.

## 2.3 Map

```java
Map<CaseId, CaseRecord> casesById;
```

Berarti lookup by key penting.

## 2.4 Queue

```java
Queue<EmailJob> pendingEmails;
```

Berarti processing order/producer-consumer semantics penting.

## 2.5 Wrong collection = wrong domain

Bad:

```java
List<Permission> permissions;
```

Jika duplicate permission tidak meaningful, gunakan `Set<Permission>`.

Bad:

```java
Set<ApprovalStep> steps;
```

Jika urutan approval penting, gunakan `List<ApprovalStep>`.

Bad:

```java
Map<String, Object> data;
```

Jika structure known, gunakan typed record/class.

---

# 3. Collections Framework Overview

Java Collections Framework berisi:

- interfaces;
- general-purpose implementations;
- legacy implementations;
- algorithms;
- wrappers;
- concurrent collection variants.

Oracle Java SE 25 Collections Framework Overview menyatakan framework terdiri dari collection interfaces seperti sets, lists, maps; general-purpose implementations; legacy implementations seperti `Vector` dan `Hashtable`; special-purpose implementations; concurrent implementations; wrapper implementations; convenience implementations; abstract implementations; algorithms; dan infrastructure.

## 3.1 Core interfaces

```text
Iterable
Collection
List
Set
SortedSet
NavigableSet
Queue
Deque
Map
SortedMap
NavigableMap
```

## 3.2 Maps are not Collections

`Map` is part of Collections Framework, but `Map` does not extend `Collection`.

It has collection views:

```java
map.keySet()
map.values()
map.entrySet()
```

## 3.3 Algorithms

Utility class:

```java
Collections
Arrays
```

Examples:

```java
Collections.sort(list)
Collections.unmodifiableList(list)
Collections.binarySearch(list, key)
```

## 3.4 Implementations

Examples:

```java
ArrayList
LinkedList
HashSet
LinkedHashSet
TreeSet
HashMap
LinkedHashMap
TreeMap
ArrayDeque
PriorityQueue
ConcurrentHashMap
CopyOnWriteArrayList
```

---

# 4. Mental Model: Collection = Shape + Semantics + Contract

Untuk memilih collection, tanyakan:

```text
1. Apakah urutan penting?
2. Apakah index access penting?
3. Apakah duplicate diperbolehkan?
4. Apakah uniqueness ditentukan oleh equals/hashCode atau comparator?
5. Apakah lookup by key dibutuhkan?
6. Apakah mutability diperlukan?
7. Apakah null diperbolehkan?
8. Apakah thread-safe?
9. Apakah iteration order stable?
10. Apakah size bisa besar?
11. Apakah read-heavy atau write-heavy?
12. Apakah collection ini bagian dari domain invariant?
```

## 4.1 Shape

```text
linear sequence
unique set
key-value map
queue/deque
tree/sorted
priority queue
```

## 4.2 Semantics

```text
ordered
sorted
unique
first-in-first-out
last-in-first-out
priority-based
insertion-order
access-order
```

## 4.3 Contract

```text
equals/hashCode
comparator
null policy
mutation behavior
iteration behavior
concurrency guarantees
```

## 4.4 Implementation

```text
array-backed
hash-table
tree-based
linked
copy-on-write
lock-free/concurrent-ish
blocking
```

Implementation is not just performance detail; sometimes it changes observable behavior like ordering/null support.

---

# 5. `Iterable` dan `Iterator`

`Iterable<T>` means object can provide an iterator.

```java
for (T item : iterable) {
    ...
}
```

Enhanced for-loop uses `Iterable`.

## 5.1 Iterator

```java
Iterator<T> it = collection.iterator();
while (it.hasNext()) {
    T item = it.next();
}
```

## 5.2 Iterator remove

Some iterators support:

```java
it.remove();
```

Some do not and throw `UnsupportedOperationException`.

## 5.3 Fail-fast

Many mutable collection iterators are fail-fast on structural concurrent modification.

This is best-effort bug detection, not concurrency control.

## 5.4 Iterable as API

If method only needs iteration:

```java
void publishAll(Iterable<? extends Event> events)
```

But `Iterable` lacks size/isEmpty.

Use `Collection` if size needed.

---

# 6. `Collection<E>`

`Collection<E>` is root interface for many non-map collections.

Key operations:

```java
size()
isEmpty()
contains(Object)
iterator()
toArray()
add(E)
remove(Object)
containsAll(Collection<?>)
addAll(Collection<? extends E>)
removeAll(Collection<?>)
retainAll(Collection<?>)
clear()
```

## 6.1 Optional operations

Some operations are optional and may throw `UnsupportedOperationException`.

Example unmodifiable collections.

## 6.2 Collection does not guarantee order

`Collection` alone does not say ordering.

If order matters, use `List`, `SequencedCollection`, `SortedSet`, etc.

## 6.3 Collection in API

Use:

```java
Collection<Event>
```

when you only need “bag of elements” and not indexing/order/uniqueness.

## 6.4 Be careful with mutating input

```java
void process(Collection<Event> events) {
    events.clear(); // surprising
}
```

Unless documented, do not mutate caller collection.

Defensive copy if needed.

---

# 7. `List<E>`: Ordered, Indexed, Duplicates Allowed

`List` represents ordered collection, also called sequence.

Java SE 25 `List` API says `List` provides positional indexed access and lists are zero-based; indexed operations may be proportional to index for some implementations such as `LinkedList`, so iteration is preferable when implementation unknown.

## 7.1 Semantics

```text
ordered
indexed
duplicates allowed
usually positional
```

## 7.2 Use cases

- approval steps;
- ordered results;
- UI display order;
- sorted output snapshot;
- history entries;
- route segments;
- CSV rows;
- ordered validation violations.

## 7.3 List equality

Two lists equal if same size and pairwise equal elements in same order.

```java
List.of("a", "b").equals(List.of("a", "b")) // true
List.of("a", "b").equals(List.of("b", "a")) // false
```

Order matters.

## 7.4 Indexed access

```java
list.get(0)
list.set(0, value)
list.add(index, value)
```

But performance depends implementation.

## 7.5 Null and duplicates

Depending implementation, null may or may not be allowed.

`ArrayList` allows null. `List.of` does not.

Duplicates are allowed:

```java
List.of("a", "a")
```

## 7.6 Domain rule

If duplicates are invalid, don't use raw List without validation.

```java
record ApprovalSteps(List<ApprovalStep> steps) {
    ApprovalSteps {
        steps = List.copyOf(steps);
        // validate no duplicate step id if needed
    }
}
```

---

# 8. `Set<E>`: Uniqueness by Equality

`Set` represents collection with no duplicate elements.

Duplicate semantics depend on implementation:

- hash-based uses `equals/hashCode`;
- sorted set uses comparator/natural ordering.

## 8.1 Use cases

- permissions;
- tags if order irrelevant;
- unique IDs;
- visited nodes;
- deduplication;
- feature flags;
- roles.

## 8.2 Set equality

Two sets equal if they contain same elements, regardless order.

```java
Set.of("a", "b").equals(Set.of("b", "a")) // true
```

## 8.3 HashSet

Uniqueness by equals/hashCode.

## 8.4 TreeSet

Uniqueness by compareTo/comparator.

If comparator says compare 0, elements are duplicate even if equals false.

## 8.5 Null

Varies:

- `HashSet` allows one null;
- `TreeSet` with natural ordering generally cannot handle null;
- `Set.of` rejects null;
- concurrent sets often reject null.

## 8.6 Domain set

If permission set should have stable enum values:

```java
EnumSet<Permission>
```

is usually best internally.

Expose:

```java
Set<Permission>
```

or immutable copy.

---

# 9. `Map<K,V>`: Key-Value Association

`Map` maps keys to values. Each key maps to at most one value.

```java
Map<CaseId, CaseRecord> casesById;
```

## 9.1 Use cases

- lookup by ID;
- cache;
- index;
- grouping;
- dictionary;
- configuration key-value;
- count by category;
- handler registry.

## 9.2 Key equality

HashMap keys use `equals/hashCode`.

TreeMap keys use comparator/natural ordering.

IdentityHashMap keys use `==`.

WeakHashMap keys use weak references and equals/hashCode.

## 9.3 Map views

```java
map.keySet()
map.values()
map.entrySet()
```

These are backed by the map in many implementations.

Mutating view can mutate map.

## 9.4 Missing key semantics

```java
V value = map.get(key);
```

If returns null, it can mean:

```text
key absent
key present with null value
```

Use:

```java
containsKey
getOrDefault
computeIfAbsent
```

or avoid null values.

## 9.5 Null keys/values

Varies by implementation.

`HashMap` allows one null key and null values.

`ConcurrentHashMap` rejects null keys and values.

`Map.of` rejects null.

## 9.6 Domain maps

Prefer typed keys:

```java
Map<CaseId, CaseRecord>
```

not:

```java
Map<String, Object>
```

---

# 10. `Queue<E>` dan `Deque<E>`

## 10.1 Queue

Queue is for holding elements before processing.

Common operations:

```java
offer
poll
peek
add
remove
element
```

Prefer non-throwing methods for normal flow:

```java
offer returns false
poll returns null
peek returns null
```

Throwing variants:

```java
add
remove
element
```

## 10.2 Deque

Double-ended queue.

```java
addFirst
addLast
removeFirst
removeLast
peekFirst
peekLast
```

Can be used as:

- queue;
- stack;
- deque.

## 10.3 ArrayDeque

Often better than `Stack` or `LinkedList` for stack/queue in single-threaded code.

```java
Deque<Task> stack = new ArrayDeque<>();
stack.push(task);
Task task = stack.pop();
```

## 10.4 PriorityQueue

Orders elements by priority, not FIFO.

```java
PriorityQueue<Job> queue = new PriorityQueue<>(Comparator.comparing(Job::priority));
```

Iteration order is not sorted order; polling returns priority order.

## 10.5 BlockingQueue

For concurrent producer-consumer, use `BlockingQueue`.

---

# 11. Sequenced Collections: Java 21+

JEP 431 introduced sequenced collections in Java 21 and defines new interfaces for sequenced collections, sequenced sets, and sequenced maps, retrofitted into the existing collections type hierarchy.

Java SE 25 `SequencedCollection` describes a collection with well-defined encounter order, operations at both ends, and reversible view.

## 11.1 Motivation

Before Java 21, collections with encounter order did not share a common interface for first/last/reversed operations.

Examples:

- `List`;
- `Deque`;
- `LinkedHashSet`;
- `SortedSet`.

## 11.2 New interfaces

```java
SequencedCollection<E>
SequencedSet<E>
SequencedMap<K,V>
```

## 11.3 Common methods

Conceptually:

```java
getFirst()
getLast()
addFirst(E)
addLast(E)
removeFirst()
removeLast()
reversed()
```

depending interface and implementation support.

## 11.4 Encounter order

Encounter order means elements have linear order from first to last.

This differs from sorted order and insertion order depending implementation.

## 11.5 Domain use

If API needs first/last/reverse over ordered collection but not necessarily index access, use:

```java
SequencedCollection<Event>
```

instead of `List<Event>` if appropriate.

## 11.6 Compatibility

If your codebase baseline is Java 17, sequenced interfaces are not available. For Java 21+, they are standard.

---

# 12. Implementation Matters: Interface vs Implementation

Declare variables/fields by interface when possible:

```java
List<Item> items = new ArrayList<>();
Set<Role> roles = EnumSet.of(Role.ADMIN);
Map<CaseId, CaseRecord> cases = new HashMap<>();
```

## 12.1 But implementation affects semantics

Example:

```java
Set<String> set = new HashSet<>();
```

No iteration order guarantee.

```java
Set<String> set = new LinkedHashSet<>();
```

Insertion order.

```java
Set<String> set = new TreeSet<>();
```

Sorted order.

## 12.2 API return type

If caller only needs list semantics:

```java
List<Item> items()
```

Do not return `ArrayList`.

## 12.3 Field type

Field can be interface:

```java
private final List<Item> items;
```

Constructor can defensively copy to a known implementation.

## 12.4 When implementation type is part of contract

Sometimes use implementation explicitly:

```java
EnumSet<Permission>
ConcurrentHashMap<Key, Value>
BlockingQueue<Task>
```

because behavior/performance/concurrency matters.

## 12.5 Document assumptions

If order matters, say so in type or docs.

Better type:

```java
List<Step>
```

than vague:

```java
Collection<Step>
```

---

# 13. `ArrayList` vs `LinkedList`

## 13.1 ArrayList

Array-backed list.

Strengths:

- fast random access;
- compact;
- good iteration locality;
- common default;
- amortized O(1) append.

Weaknesses:

- insertion/removal in middle shifts elements;
- resizing copies array.

## 13.2 LinkedList

Doubly-linked list.

Strengths:

- implements `Deque`;
- insertion/removal with known node can be cheap internally.

Weaknesses:

- poor cache locality;
- random access O(n);
- more object overhead;
- often slower than people expect.

## 13.3 Common misconception

People choose `LinkedList` for many insertions/removals.

But if you need to find position first, traversal cost dominates.

`ArrayList` is often faster in practice for general lists.

## 13.4 Use ArrayDeque for queue/stack

Instead of `LinkedList` as queue:

```java
Deque<Task> queue = new ArrayDeque<>();
```

## 13.5 Use LinkedList rarely

Use when you specifically need `List` + `Deque` semantics and understand trade-offs.

---

# 14. `HashSet`, `LinkedHashSet`, `TreeSet`, `EnumSet`

## 14.1 HashSet

- hash table;
- no guaranteed iteration order;
- uniqueness by equals/hashCode;
- allows null.

Use for general unique set.

## 14.2 LinkedHashSet

- hash table + linked order;
- preserves insertion order;
- uniqueness by equals/hashCode.

Use when uniqueness + stable insertion order needed.

## 14.3 TreeSet

- sorted set;
- uniqueness by comparator/compareTo;
- ordered operations;
- no arbitrary null with natural ordering.

Use when sorted unique set needed.

## 14.4 EnumSet

- specialized set for enum;
- compact and efficient;
- no null;
- excellent for permissions/flags.

## 14.5 Set choice

| Need | Use |
|---|---|
| unique, no order | `HashSet` |
| unique, insertion order | `LinkedHashSet` |
| unique, sorted order | `TreeSet` |
| enum values | `EnumSet` |
| thread-safe unique set | `ConcurrentHashMap.newKeySet()` or `CopyOnWriteArraySet` |

---

# 15. `HashMap`, `LinkedHashMap`, `TreeMap`, `EnumMap`, `IdentityHashMap`, `WeakHashMap`

## 15.1 HashMap

General-purpose hash table.

- keys by equals/hashCode;
- no order guarantee;
- allows null key/values;
- not thread-safe.

## 15.2 LinkedHashMap

HashMap with predictable iteration order.

Can be insertion-order or access-order.

Access-order useful for LRU cache pattern, but prefer real cache library for production.

## 15.3 TreeMap

Sorted map by key natural ordering/comparator.

- key uniqueness by comparator;
- range queries;
- navigable operations.

## 15.4 EnumMap

Specialized map for enum keys.

- compact;
- efficient;
- predictable enum order;
- no null keys.

Great for strategy maps.

## 15.5 IdentityHashMap

Uses `==` for keys, not equals.

Use rarely:

- object graph traversal;
- cycle detection by object identity;
- framework internals.

Not normal domain map.

## 15.6 WeakHashMap

Weak keys. Entries can disappear when keys are no longer strongly reachable.

Use for caches/listeners/class metadata with care.

Do not use as ordinary cache without understanding GC semantics.

## 15.7 Map choice

| Need | Use |
|---|---|
| general lookup | `HashMap` |
| lookup + insertion order | `LinkedHashMap` |
| sorted/range lookup | `TreeMap` |
| enum key | `EnumMap` |
| identity key | `IdentityHashMap` |
| weak key | `WeakHashMap` |
| concurrent lookup/update | `ConcurrentHashMap` |

---

# 16. Equality Semantics dalam Collections

Collections rely heavily on equality.

## 16.1 List equality

Order-sensitive.

```java
List.of(1, 2).equals(List.of(2, 1)) // false
```

## 16.2 Set equality

Order-insensitive.

```java
Set.of(1, 2).equals(Set.of(2, 1)) // true
```

## 16.3 Map equality

Same mappings.

Order not part of Map equality.

```java
Map.of("a", 1, "b", 2).equals(Map.of("b", 2, "a", 1)) // true
```

## 16.4 Hash-based collection

Element/key equality by equals/hashCode.

Mutable key bug applies.

## 16.5 Tree-based collection

Equality/uniqueness by comparator compare zero.

```java
new TreeSet<>(Comparator.comparing(Person::name))
```

Only one person per name.

## 16.6 Domain warning

If collection contains value objects, their equals/hashCode are part of collection semantics.

Bad equality = bad collection behavior.

---

# 17. Ordering vs Sorting vs Encounter Order

## 17.1 Ordering

A collection can have defined iteration order.

Examples:

- `List`: positional order;
- `LinkedHashSet`: insertion order;
- `TreeSet`: sorted order;
- `HashSet`: no guarantee.

## 17.2 Sorting

Sorting is operation that arranges elements based on comparator/natural order.

```java
list.sort(comparator)
```

## 17.3 Encounter order

Stream/SequencedCollection terminology for order in which elements are encountered.

## 17.4 Insertion order

Order elements inserted.

```java
LinkedHashMap
LinkedHashSet
```

## 17.5 Access order

`LinkedHashMap` can maintain access order.

Useful for LRU-like behavior.

## 17.6 Sorted order

`TreeSet`/`TreeMap`.

## 17.7 Domain importance

If API response order matters, use type/implementation that guarantees it and document it.

Do not return HashSet and expect stable order.

---

# 18. Null Policy

Null support varies.

## 18.1 Allows null

```java
ArrayList
LinkedList
HashSet
HashMap
```

generally allow null (HashMap one null key, multiple null values).

## 18.2 Rejects null

```java
List.of
Set.of
Map.of
List.copyOf
Set.copyOf
Map.copyOf
ConcurrentHashMap
EnumSet
EnumMap keys
```

## 18.3 TreeSet/TreeMap

Natural ordering with null usually fails.

Custom comparator can support null.

## 18.4 Domain rule

Avoid null elements in collections.

Prefer:

```java
List<Item> items = List.of();
```

not null list or list containing null.

## 18.5 Map null values

Avoid null values in maps because `get` ambiguity.

Use:

```java
Optional<V>
```

carefully, or absence/presence methods, or domain result.

## 18.6 API boundary

External JSON may contain null array elements. Validate and reject/normalize at boundary.

---

# 19. Mutability, Unmodifiable View, dan Immutable Snapshot

Collections can be:

```text
mutable
unmodifiable view
immutable snapshot
persistent/functional immutable
thread-safe mutable
copy-on-write
```

Java standard uses several patterns.

## 19.1 Mutable

```java
List<String> list = new ArrayList<>();
list.add("x");
```

## 19.2 Unmodifiable view

```java
List<String> view = Collections.unmodifiableList(list);
```

Cannot mutate through view, but underlying list can mutate.

## 19.3 Immutable snapshot

```java
List<String> copy = List.copyOf(list);
```

Snapshot not affected by later changes to original list.

## 19.4 Fixed-size view

```java
List<String> list = Arrays.asList(array);
```

Size fixed, backed by array. `set` allowed, `add` not.

## 19.5 Persistent immutable collections

Not in core JDK as rich persistent data structures. External libraries provide.

## 19.6 Domain default

For value objects, prefer immutable snapshot.

---

# 20. `List.of`, `Set.of`, `Map.of`, `copyOf`

## 20.1 Factory methods

```java
List<String> list = List.of("a", "b");
Set<String> set = Set.of("a", "b");
Map<String, Integer> map = Map.of("a", 1, "b", 2);
```

They produce unmodifiable collections.

## 20.2 Null rejection

They reject null elements/keys/values.

```java
List.of("a", null) // NPE
```

## 20.3 Duplicate rejection

`Set.of` rejects duplicate elements.

`Map.of` rejects duplicate keys.

## 20.4 copyOf

```java
List<String> copy = List.copyOf(existing);
Set<String> setCopy = Set.copyOf(existing);
Map<K,V> mapCopy = Map.copyOf(existing);
```

Create unmodifiable collections.

## 20.5 Snapshot

`copyOf` makes snapshot, not backed view.

## 20.6 Use in constructors

```java
record Tags(List<String> values) {
    Tags {
        values = List.copyOf(values);
    }
}
```

Great for defensive copy.

---

# 21. `Collections.unmodifiable*` vs `List.copyOf`

## 21.1 unmodifiable view

```java
List<String> mutable = new ArrayList<>();
List<String> view = Collections.unmodifiableList(mutable);

mutable.add("x");
System.out.println(view); // [x]
```

View reflects underlying mutation.

## 21.2 copyOf snapshot

```java
List<String> mutable = new ArrayList<>();
List<String> copy = List.copyOf(mutable);

mutable.add("x");
System.out.println(copy); // []
```

## 21.3 When use unmodifiable view

Useful when you own underlying collection and want live read-only view.

But in domain value objects, this often leaks mutation.

## 21.4 When use copyOf

Use for:

- constructor defensive copy;
- immutable DTO/domain values;
- thread-safe publication snapshot;
- API return snapshot.

## 21.5 Collections.unmodifiable does not make elements immutable

Neither does copyOf.

If elements mutable, deep immutability not guaranteed.

---

# 22. Defensive Copy dan Representation Exposure

## 22.1 Bad

```java
class EvidenceSet {
    private final List<Evidence> evidence;

    EvidenceSet(List<Evidence> evidence) {
        this.evidence = evidence;
    }

    List<Evidence> evidence() {
        return evidence;
    }
}
```

Caller can mutate internal state.

## 22.2 Good

```java
final class EvidenceSet {
    private final List<Evidence> evidence;

    EvidenceSet(List<Evidence> evidence) {
        this.evidence = List.copyOf(evidence);
    }

    List<Evidence> evidence() {
        return evidence;
    }
}
```

If list is unmodifiable snapshot, returning it is okay.

## 22.3 Mutable elements

If `Evidence` mutable, caller can mutate elements.

Need immutable element type or deep copy.

## 22.4 Records

```java
record EvidenceSet(List<Evidence> evidence) {
    EvidenceSet {
        evidence = List.copyOf(evidence);
    }
}
```

## 22.5 Maps

```java
record Attributes(Map<String, String> values) {
    Attributes {
        values = Map.copyOf(values);
    }
}
```

## 22.6 EnumSet

Defensive copy carefully:

```java
record Permissions(Set<Permission> values) {
    Permissions {
        values = Set.copyOf(values);
    }
}
```

If internal EnumSet performance needed, store EnumSet but expose Set snapshot/read-only view carefully.

---

# 23. Fail-Fast Iterator dan `ConcurrentModificationException`

Many collection iterators are fail-fast.

Example:

```java
List<String> list = new ArrayList<>(List.of("a", "b"));

for (String s : list) {
    list.remove(s); // ConcurrentModificationException
}
```

## 23.1 Structural modification

Changing collection structure outside iterator during iteration can trigger exception.

## 23.2 Correct removal

```java
Iterator<String> it = list.iterator();
while (it.hasNext()) {
    String s = it.next();
    if (shouldRemove(s)) {
        it.remove();
    }
}
```

or:

```java
list.removeIf(this::shouldRemove);
```

## 23.3 Fail-fast is best effort

Do not rely on ConcurrentModificationException for correctness.

It is bug detection, not synchronization.

## 23.4 Concurrent collections

Concurrent collections have different iteration behavior, often weakly consistent.

## 23.5 CopyOnWrite iteration

CopyOnWriteArrayList iterators see snapshot.

---

# 24. Concurrent Collections

The `java.util.concurrent` package provides collection implementations designed for multithreaded contexts. Java SE 25 package docs note that when many threads are expected to access a given collection, `ConcurrentHashMap` is normally preferable to synchronized `HashMap`, and `ConcurrentSkipListMap` normally preferable to synchronized `TreeMap`.

## 24.1 Common concurrent collections

```java
ConcurrentHashMap
ConcurrentSkipListMap
ConcurrentSkipListSet
CopyOnWriteArrayList
CopyOnWriteArraySet
BlockingQueue
ConcurrentLinkedQueue
LinkedBlockingQueue
ArrayBlockingQueue
PriorityBlockingQueue
DelayQueue
```

## 24.2 Thread-safe does not mean atomic workflow

```java
if (!map.containsKey(key)) {
    map.put(key, value);
}
```

Race.

Use:

```java
map.putIfAbsent(key, value)
map.computeIfAbsent(key, k -> value)
```

## 24.3 Synchronized wrappers

```java
Collections.synchronizedList(list)
```

Can be useful but requires external synchronization during iteration.

## 24.4 Immutable snapshot alternative

For read-mostly data, publish immutable snapshot with volatile reference.

## 24.5 Choose based on workload

- high read/write map: ConcurrentHashMap;
- read-heavy small list: CopyOnWriteArrayList;
- producer-consumer: BlockingQueue;
- sorted concurrent map: ConcurrentSkipListMap.

---

# 25. `ConcurrentHashMap`

`ConcurrentHashMap` is concurrent hash map.

## 25.1 Null policy

Does not allow null keys or null values.

This avoids ambiguity with concurrent operations.

## 25.2 Atomic methods

Useful:

```java
putIfAbsent
computeIfAbsent
computeIfPresent
compute
merge
replace
remove(key, value)
```

## 25.3 computeIfAbsent caution

Mapping function should be:

- short;
- side-effect safe;
- not recursively update same map in problematic ways;
- not block long unnecessarily.

## 25.4 Iterators

Weakly consistent; they do not throw ConcurrentModificationException in normal concurrent modification way.

They may reflect some updates.

## 25.5 Size

`size()` under concurrent updates is approximate-ish operationally. Do not use for strict control under heavy concurrency without understanding.

## 25.6 Common pattern

```java
ConcurrentHashMap<CaseId, CaseState> states = new ConcurrentHashMap<>();

states.compute(caseId, (id, current) -> transition(current, command));
```

But ensure transition is pure/fast.

---

# 26. `CopyOnWriteArrayList` dan `CopyOnWriteArraySet`

Java SE 25 `CopyOnWriteArrayList` API describes it as a thread-safe variant of `ArrayList` where all mutative operations like add and set are implemented by making a fresh copy of the underlying array.

## 26.1 Good for read-heavy, write-rare

Examples:

- listener lists;
- observer subscribers;
- routing table snapshots;
- small config callbacks.

## 26.2 Bad for write-heavy

Every mutation copies array.

Do not use for frequent writes/large lists.

## 26.3 Snapshot iteration

Iterator sees snapshot at time iterator created.

No ConcurrentModificationException.

## 26.4 CopyOnWriteArraySet

Set backed by CopyOnWriteArrayList.

Good for small read-heavy sets.

## 26.5 Domain use

Usually infrastructure, not domain entity internal collection.

---

# 27. Blocking Queues

Blocking queues support producer-consumer coordination.

Examples:

```java
ArrayBlockingQueue
LinkedBlockingQueue
PriorityBlockingQueue
DelayQueue
SynchronousQueue
```

## 27.1 Basic operations

```java
put
take
offer
poll
```

`put`/`take` block.

## 27.2 Bounded queue

```java
new ArrayBlockingQueue<>(capacity)
```

Bounded queues provide backpressure.

## 27.3 Unbounded risk

`LinkedBlockingQueue` default constructor can be effectively unbounded.

Risk memory growth.

## 27.4 Use in executors

ThreadPoolExecutor uses BlockingQueue.

Queue choice affects behavior.

## 27.5 Poison pill

Common shutdown pattern, but use carefully. Modern structured concurrency/executor shutdown may be better depending design.

---

# 28. Streams dan Collections

Collections integrate with streams:

```java
list.stream()
set.stream()
map.entrySet().stream()
```

## 28.1 Stream is not collection

Stream is one-shot computation pipeline.

Do not store stream as data.

## 28.2 Collecting

```java
List<Result> results = stream.toList();
```

`Stream.toList()` returns unmodifiable list in modern Java.

Collectors:

```java
collect(Collectors.toList())
collect(Collectors.toUnmodifiableList())
collect(Collectors.toMap(...))
```

## 28.3 Duplicate key in toMap

```java
Collectors.toMap(User::id, Function.identity())
```

throws if duplicate key.

Provide merge function if duplicates possible.

## 28.4 Grouping

```java
Map<Status, List<CaseRecord>> byStatus =
    cases.stream().collect(Collectors.groupingBy(CaseRecord::status));
```

Consider EnumMap:

```java
groupingBy(CaseRecord::status, () -> new EnumMap<>(CaseStatus.class), toList())
```

## 28.5 Parallel streams

Be careful with mutable collections, ordering, and thread safety.

---

# 29. Collections dan Generics/Wildcards

## 29.1 Producer extends

If method reads from collection:

```java
void publishAll(Collection<? extends DomainEvent> events)
```

## 29.2 Consumer super

If method writes into collection:

```java
void addDefaultRules(Collection<? super Rule> rules)
```

## 29.3 Avoid wildcard returns

Bad:

```java
List<? extends Event> events()
```

Hard for caller.

Better:

```java
List<Event> events()
```

## 29.4 Unknown collection

```java
Collection<?> values
```

for unknown element type.

## 29.5 Raw collection

Avoid:

```java
Collection values
```

Raw type can cause heap pollution.

## 29.6 Domain API

Use precise generics:

```java
Map<CaseId, CaseRecord>
List<ApprovalStep>
Set<Permission>
```

not `Map<String,Object>`.

---

# 30. Collections di Domain Model

## 30.1 List for ordered domain

```java
record ApprovalWorkflow(List<ApprovalStep> steps) {
    ApprovalWorkflow {
        steps = List.copyOf(steps);
        if (steps.isEmpty()) throw new IllegalArgumentException();
    }
}
```

## 30.2 Set for uniqueness

```java
record Permissions(Set<Permission> values) {
    Permissions {
        values = Set.copyOf(values);
    }

    boolean has(Permission permission) {
        return values.contains(permission);
    }
}
```

## 30.3 Map for index

```java
record CaseIndex(Map<CaseId, CaseSummary> byId) {
    CaseIndex {
        byId = Map.copyOf(byId);
    }
}
```

## 30.4 Avoid exposing generic collection as domain concept if richer type needed

Bad:

```java
List<Violation> violations
```

Maybe better:

```java
record Violations(List<Violation> values) {
    Violations {
        values = List.copyOf(values);
        if (values.isEmpty()) throw new IllegalArgumentException();
    }
}
```

## 30.5 Collection invariant

If collection has invariant, wrap it in domain type.

Examples:

- non-empty list;
- no duplicate step code;
- max size;
- sorted order;
- same currency;
- same tenant;
- no overlapping date ranges.

---

# 31. Collections di API/JSON/DB/Event Boundary

## 31.1 API arrays/lists

JSON arrays map naturally to `List<T>` DTO fields.

Validate:

- null list;
- null elements;
- duplicates;
- max size;
- ordering;
- required/non-empty.

## 31.2 DB mapping

Relational DB does not directly store Java collection.

Options:

- join table;
- JSON column;
- array type DB-specific;
- separate aggregate table;
- denormalized string (avoid unless simple and controlled).

## 31.3 Event schema

Events with arrays/lists need compatibility and size policy.

Avoid huge unbounded arrays in events.

## 31.4 Map in JSON

Map keys in JSON are strings. If domain key is typed ID, serialize to string carefully.

## 31.5 Null vs empty

API should define:

```json
[]
```

vs:

```json
null
```

vs missing field.

In domain, prefer empty collection instead of null.

## 31.6 Ordering contract

If API returns list, is order guaranteed?

Document:

```text
sorted by createdAt desc, caseId asc
```

for stable pagination.

---

# 32. Performance dan Memory Trade-Off

## 32.1 Big-O is not enough

`ArrayList` and `LinkedList` trade-offs depend on CPU cache, allocation, object overhead.

## 32.2 ArrayList memory

Stores references in array.

Good locality for references, but objects elsewhere.

## 32.3 LinkedList memory

Each node object has overhead and references prev/next/item.

Often memory-heavy.

## 32.4 HashMap memory

Buckets/table + nodes/tree nodes. Load factor affects memory/performance.

Set initial capacity if large known size.

```java
new HashMap<>(expectedSize * 4 / 3 + 1)
```

Use helper carefully.

## 32.5 TreeMap

O(log n), ordered/range operations, more overhead than hash map.

## 32.6 EnumMap/EnumSet

Very efficient for enum keys/elements.

## 32.7 Large collection

For millions of primitive values, `List<Integer>` can be very memory-heavy.

Use primitive arrays or primitive collections.

## 32.8 Measure

Use:

- JFR;
- heap histogram;
- JOL;
- JMH;
- GC logs.

---

# 33. Primitive Collections dan Large Data

Java standard collections require reference types.

```java
List<Integer>
```

boxes ints.

For large numeric data:

- `int[]`;
- `long[]`;
- `double[]`;
- `IntStream`;
- specialized primitive collections;
- off-heap/ByteBuffer;
- database aggregation;
- streaming.

## 33.1 When List<Integer> ok

- small/medium business data;
- API convenience;
- not hot path.

## 33.2 When not ok

- millions of values;
- tight loops;
- memory-sensitive CLI;
- low-latency processing.

## 33.3 Primitive collection libraries

Examples:

- fastutil;
- HPPC;
- Eclipse Collections primitive;
- Agrona.

Adopt only with profiling and dependency review.

---

# 34. Production Failure Modes

## 34.1 HashSet duplicate due bad equals/hashCode

Value object missing equals/hashCode.

Fix:

- record;
- correct equals/hashCode;
- tests.

## 34.2 HashMap key mutated

Mutable key field changes after put.

Fix:

- immutable keys;
- typed ID records.

## 34.3 TreeSet drops distinct objects

Comparator compares only name.

Fix:

- comparator includes unique tie-breaker;
- use List for display sorting.

## 34.4 Null element causes NPE later

List accepts null at boundary.

Fix:

- validate;
- `List.copyOf` rejects null;
- domain constructors.

## 34.5 Unmodifiable view leak

`Collections.unmodifiableList` reflects underlying mutation.

Fix:

- `List.copyOf` for snapshot.

## 34.6 ConcurrentModificationException

Mutating list in enhanced for loop.

Fix:

- iterator.remove;
- removeIf;
- collect new list.

## 34.7 Concurrent HashMap workflow race

containsKey then put.

Fix:

- putIfAbsent;
- computeIfAbsent;
- compute.

## 34.8 CopyOnWriteArrayList write-heavy meltdown

Many writes copy large array.

Fix:

- different concurrent collection;
- synchronization;
- queue.

## 34.9 HashMap used concurrently

Data race/inconsistent behavior.

Fix:

- ConcurrentHashMap;
- synchronization;
- immutable snapshot.

## 34.10 `Collectors.toMap` duplicate key exception

Duplicate key occurs in production data.

Fix:

- merge function;
- groupingBy;
- validate uniqueness.

## 34.11 API order unstable

Returning HashSet converted to JSON array; order changes.

Fix:

- List sorted explicitly;
- LinkedHashSet;
- document order.

## 34.12 Map null value ambiguity

`get` returns null; code treats as absent.

Fix:

- avoid null values;
- containsKey;
- Optional/domain result.

---

# 35. Best Practices

## 35.1 General

- Choose collection by semantics, not habit.
- Use `List` for ordered/indexed sequence.
- Use `Set` for uniqueness.
- Use `Map` for lookup by key.
- Use `Queue`/`Deque` for processing order.
- Use `EnumSet`/`EnumMap` for enum.
- Use `LinkedHash*` when stable insertion order matters.
- Use `Tree*` when sorted/range operations matter.
- Avoid `LinkedList` unless justified.
- Avoid raw types.
- Avoid null elements/values.
- Prefer empty collection over null.
- Defensively copy in domain/value objects.
- Prefer immutable snapshots at boundaries.
- Don't expose internal mutable collections.
- Use concurrent collections for concurrent mutation.
- Don't confuse unmodifiable view with immutable snapshot.
- Test equality/order assumptions.

## 35.2 Domain

- Wrap collections when they have invariants.
- Validate no duplicates/max size/non-empty/order.
- Use typed keys.
- Avoid `Map<String,Object>` as domain model.
- Make collection fields unmodifiable snapshots.

## 35.3 API

- Document ordering.
- Document null/empty/missing semantics.
- Validate max sizes.
- Avoid returning internal mutable collections.
- Avoid unstable HashSet order in JSON arrays.

## 35.4 Concurrency

- Use immutable snapshots for read-mostly config.
- Use ConcurrentHashMap for concurrent maps.
- Use BlockingQueue for producer-consumer.
- Use CopyOnWriteArrayList for small read-heavy listener lists.
- Atomic collection method does not make whole workflow atomic.

---

# 36. Decision Matrix

| Need | Recommended |
|---|---|
| ordered sequence | `List<E>` |
| unique elements, no order | `HashSet<E>` |
| unique elements, insertion order | `LinkedHashSet<E>` |
| unique sorted elements | `TreeSet<E>` |
| enum set | `EnumSet<E>` |
| lookup by key | `HashMap<K,V>` |
| lookup + insertion order | `LinkedHashMap<K,V>` |
| sorted/range map | `TreeMap<K,V>` |
| enum key map | `EnumMap<K,V>` |
| identity key map | `IdentityHashMap<K,V>` rarely |
| weak key metadata | `WeakHashMap<K,V>` carefully |
| stack/queue single-thread | `ArrayDeque<E>` |
| priority processing | `PriorityQueue<E>` |
| producer-consumer | `BlockingQueue<E>` |
| concurrent map | `ConcurrentHashMap<K,V>` |
| read-heavy listener list | `CopyOnWriteArrayList<E>` |
| immutable small collection | `List.of`, `Set.of`, `Map.of` |
| immutable snapshot | `copyOf` |
| unknown collection element type | `Collection<?>` |
| read flexible input | `Collection<? extends T>` |
| write flexible target | `Collection<? super T>` |
| large primitive data | primitive array/specialized collection |
| domain invariant collection | wrapper value object |

---

# 37. Latihan

## Latihan 1 — List vs Set

Model permissions first with `List<Permission>`, then with `Set<Permission>`, then `EnumSet<Permission>`.

Explain semantic difference.

## Latihan 2 — HashSet equality

Create value class without equals/hashCode. Add duplicates to HashSet. Fix with record.

## Latihan 3 — TreeSet comparator trap

Create `Person(id, name)` and `TreeSet` comparator by name only. Add two people same name. Explain lost element.

## Latihan 4 — Defensive copy

Create record:

```java
record Tags(List<String> values)
```

Show mutation leak. Fix with `List.copyOf`.

## Latihan 5 — Unmodifiable view vs copy

Create mutable list, view with `Collections.unmodifiableList`, snapshot with `List.copyOf`. Mutate original. Compare.

## Latihan 6 — Fail-fast iterator

Mutate `ArrayList` inside enhanced for. Fix with `removeIf`.

## Latihan 7 — ConcurrentHashMap race

Implement `containsKey` then `put` race. Fix with `computeIfAbsent`.

## Latihan 8 — `Collectors.toMap` duplicate

Collect list of users by email where duplicate exists. Handle with merge function or groupingBy.

## Latihan 9 — Stable API order

Return HashSet as JSON-like list and observe unstable order. Fix with sorted List.

## Latihan 10 — SequencedCollection

If using Java 21+, write method accepting `SequencedCollection<Event>` and use `getFirst`, `getLast`, `reversed`.

## Latihan 11 — EnumMap handler registry

Create `EnumMap<CaseStatus, Handler>` and validate every enum has handler.

## Latihan 12 — Domain wrapper

Implement `NonEmptyList<T>` or domain-specific `ApprovalSteps` enforcing non-empty ordered steps.

---

# 38. Ringkasan

Collections adalah data types dengan semantics.

`List`, `Set`, `Map`, `Queue`, `Deque`, dan sequenced interfaces bukan interchangeable.

Pilih berdasarkan pertanyaan:

```text
Apakah order penting?
Apakah duplicates boleh?
Apakah lookup key penting?
Apakah sorted/range operations penting?
Apakah null boleh?
Apakah mutable?
Apakah thread-safe?
Apakah invariant domain perlu dijaga?
```

Hal utama:

- `List` = ordered/indexed sequence.
- `Set` = uniqueness.
- `Map` = key-value association.
- `Queue/Deque` = processing order.
- `SequencedCollection` = encounter order + first/last/reversed Java 21+.
- `ArrayList` adalah default list paling sering tepat.
- `LinkedList` jarang menang.
- `HashSet/HashMap` butuh equals/hashCode benar.
- `TreeSet/TreeMap` uniqueness by comparator.
- `EnumSet/EnumMap` terbaik untuk enum.
- `copyOf` memberi immutable snapshot.
- `unmodifiableList` memberi view.
- Concurrent collections menyelesaikan sebagian masalah concurrency, bukan semua workflow.
- Null elements/values biasanya harus dihindari.
- Domain collection dengan invariant sebaiknya dibungkus value object.

Senior Java engineer memilih collection bukan karena kebiasaan, tetapi karena semantic contract yang ingin dikunci dalam type system.

---

# 39. Referensi

1. Java SE 25 API — Collections Framework Overview  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/doc-files/coll-overview.html

2. Java SE 25 API — Collections Framework Reference  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/doc-files/coll-reference.html

3. Java SE 25 API — `List`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

4. Java SE 25 API — `Set`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Set.html

5. Java SE 25 API — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

6. Java SE 25 API — `Queue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Queue.html

7. Java SE 25 API — `Deque`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Deque.html

8. JEP 431 — Sequenced Collections  
   https://openjdk.org/jeps/431

9. Java SE 25 API — `SequencedCollection`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SequencedCollection.html

10. Java SE 25 API — `Collections`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html

11. Java SE 25 API — `EnumSet`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumSet.html

12. Java SE 25 API — `EnumMap`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumMap.html

13. Java SE 25 API — `ConcurrentHashMap`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

14. Java SE 25 API — `CopyOnWriteArrayList`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CopyOnWriteArrayList.html

15. Java SE 25 API — `java.util.concurrent` package summary  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/package-summary.html

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-data-types-part-015.md">⬅️ Java Data Types — Part 015</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-data-types-part-017.md">Java Data Types — Part 017 ➡️</a>
</div>
