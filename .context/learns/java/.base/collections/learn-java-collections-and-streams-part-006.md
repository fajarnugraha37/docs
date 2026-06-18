# learn-java-collections-and-streams-part-006.md

# Java Collections and Streams — Part 006  
# Sequenced Collections: Encounter Order, First/Last Operations, Reversed Views, SequencedSet, SequencedMap, dan Java 21+ Collection Design

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **006**  
> Fokus: memahami fitur Java 21+ **Sequenced Collections** sebagai cara eksplisit untuk memodelkan collection/set/map yang punya **well-defined encounter order**. Kita akan membedah `SequencedCollection`, `SequencedSet`, `SequencedMap`, first/last operations, reversed views, retrofitting hierarchy, API design, domain modeling, compatibility, pitfalls, dan production patterns.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Masalah Sebelum Sequenced Collections](#2-masalah-sebelum-sequenced-collections)
3. [Mental Model: Encounter Order sebagai First-Class Contract](#3-mental-model-encounter-order-sebagai-first-class-contract)
4. [Apa Itu Encounter Order?](#4-apa-itu-encounter-order)
5. [JEP 431 dan Java 21](#5-jep-431-dan-java-21)
6. [Peta Hierarchy Baru](#6-peta-hierarchy-baru)
7. [`SequencedCollection<E>`](#7-sequencedcollectione)
8. [First/Last Operations](#8-firstlast-operations)
9. [`reversed()` View](#9-reversed-view)
10. [List as SequencedCollection](#10-list-as-sequencedcollection)
11. [Deque as SequencedCollection](#11-deque-as-sequencedcollection)
12. [`SequencedSet<E>`](#12-sequencedsete)
13. [SequencedSet Equality Caveat](#13-sequencedset-equality-caveat)
14. [LinkedHashSet as SequencedSet](#14-linkedhashset-as-sequencedset)
15. [SortedSet/NavigableSet and SequencedSet](#15-sortedsetnavigableset-and-sequencedset)
16. [`SequencedMap<K,V>`](#16-sequencedmapkv)
17. [SequencedMap Views](#17-sequencedmap-views)
18. [LinkedHashMap as SequencedMap](#18-linkedhashmap-as-sequencedmap)
19. [SortedMap/NavigableMap and SequencedMap](#19-sortedmapnavigablemap-and-sequencedmap)
20. [Reversed View Semantics and Mutation](#20-reversed-view-semantics-and-mutation)
21. [Unmodifiable Sequenced Collections](#21-unmodifiable-sequenced-collections)
22. [Sequenced vs Sorted vs Insertion Order vs Access Order](#22-sequenced-vs-sorted-vs-insertion-order-vs-access-order)
23. [API Design with Sequenced Interfaces](#23-api-design-with-sequenced-interfaces)
24. [Domain Modeling Patterns](#24-domain-modeling-patterns)
25. [Streams and Sequenced Collections](#25-streams-and-sequenced-collections)
26. [Boundary Design: JSON, API, DB, Events](#26-boundary-design-json-api-db-events)
27. [Migration from Pre-Java 21 Code](#27-migration-from-pre-java-21-code)
28. [Compatibility and Source/Binary Considerations](#28-compatibility-and-sourcebinary-considerations)
29. [Performance and Memory Considerations](#29-performance-and-memory-considerations)
30. [Production Failure Modes](#30-production-failure-modes)
31. [Best Practices](#31-best-practices)
32. [Decision Matrix](#32-decision-matrix)
33. [Latihan](#33-latihan)
34. [Ringkasan](#34-ringkasan)
35. [Referensi](#35-referensi)

---

# 1. Tujuan Bagian Ini

Sebelum Java 21, banyak collection Java punya order, tetapi interface hierarchy tidak punya cara umum yang jelas untuk mengatakan:

```text
Collection ini punya encounter order.
Saya butuh first element.
Saya butuh last element.
Saya butuh reversed view.
```

Contoh sebelum Java 21:

```java
list.get(0);
list.get(list.size() - 1);

deque.getFirst();
deque.getLast();

sortedSet.first();
sortedSet.last();

linkedHashMap.entrySet().iterator().next();
```

Masalahnya:

- API berbeda-beda;
- tidak ada common abstraction;
- `LinkedHashSet` punya encounter order tetapi sulit mengambil first/last secara uniform;
- `Map` ordered seperti `LinkedHashMap` tidak punya first/last API umum;
- reverse traversal sering butuh copy/manual logic;
- method signature tidak bisa mengekspresikan “ordered but not necessarily List”.

Java 21 memperkenalkan:

```java
SequencedCollection
SequencedSet
SequencedMap
```

Tujuan bagian ini:

- memahami kenapa fitur ini ada;
- memahami encounter order sebagai contract;
- memahami operasi first/last/reversed;
- memahami perbedaan sequenced vs sorted vs insertion-order;
- memahami equality caveat;
- menerapkan dalam API/domain design;
- memahami pitfalls dan migration strategy.

---

# 2. Masalah Sebelum Sequenced Collections

## 2.1 Ordered collections existed, but not uniformly

Contoh ordered types:

```java
List
Deque
SortedSet
NavigableSet
LinkedHashSet
SortedMap
NavigableMap
LinkedHashMap
```

Tetapi akses first/last berbeda.

## 2.2 List

```java
E first = list.get(0);
E last = list.get(list.size() - 1);
```

Masalah:

- verbose;
- empty list handling manual;
- tidak semantic;
- index hanya detail, padahal intent-nya first/last.

## 2.3 Deque

```java
E first = deque.getFirst();
E last = deque.getLast();
```

Bagus, tapi hanya untuk Deque.

## 2.4 SortedSet

```java
E first = sortedSet.first();
E last = sortedSet.last();
```

Bagus, tapi sorted-specific.

## 2.5 LinkedHashSet

Sebelum sequenced API, mengambil first/last tidak seuniform Deque/List.

Bisa manual:

```java
Iterator<E> it = linkedHashSet.iterator();
E first = it.next();
```

Last lebih awkward.

## 2.6 LinkedHashMap

First entry:

```java
map.entrySet().iterator().next();
```

Last entry awkward.

## 2.7 Reverse traversal

Sering dilakukan dengan:

- copy list;
- `Collections.reverse`;
- descending iterator for specific types;
- manual loop.

## 2.8 Problem summary

Tidak ada interface untuk:

```text
ordered encounter + first/last + reverse
```

tanpa memaksa `List` atau `Deque`.

---

# 3. Mental Model: Encounter Order sebagai First-Class Contract

Sequenced Collections mengangkat encounter order menjadi contract eksplisit.

## 3.1 Without sequenced

```java
Collection<Event> events
```

Tidak jelas:

- apakah order ada?
- first event meaningful?
- last event meaningful?
- bisa reverse?

## 3.2 With sequenced

```java
SequencedCollection<Event> events
```

Jelas:

```text
events have a well-defined encounter order.
first and last are meaningful.
reversed traversal is meaningful.
```

## 3.3 Important distinction

Sequenced does not say:

- sorted by what;
- insertion order;
- access order;
- immutable;
- thread-safe;
- random access;
- unique.

It only says:

```text
There is a well-defined encounter order.
```

## 3.4 Why it matters

Many domain concepts need order but not index.

Examples:

```java
EventHistory
ApprovalTrail
AuditTrail
RecentSearches
OrderedTags
LRU entries
Timeline snapshots
```

Before Java 21, you often used `List` just to express order. Now you can use `SequencedCollection` when index is not needed.

## 3.5 Rule

```text
Use sequenced interfaces when order/first/last/reverse are part of the contract, but index is not necessarily part of the model.
```

---

# 4. Apa Itu Encounter Order?

Encounter order adalah urutan element/mapping saat collection/map ditraverse.

## 4.1 List

Encounter order = index order.

```java
List.of("A", "B", "C")
```

Encounter:

```text
A, B, C
```

## 4.2 LinkedHashSet

Encounter order = insertion order.

```java
LinkedHashSet.of-like: B, A, C
```

Encounter:

```text
B, A, C
```

## 4.3 TreeSet

Encounter order = sorted order.

```text
A, B, C
```

## 4.4 LinkedHashMap

Encounter order = insertion order or access order depending configuration.

## 4.5 TreeMap

Encounter order = sorted key order.

## 4.6 HashSet/HashMap

They have iteration order at runtime, but generally not a semantic guarantee you should rely on.

## 4.7 Encounter order vs sorted order

Sorted order is one possible kind of encounter order.

But encounter order may also be insertion/access order.

## 4.8 Rule

```text
Every sorted collection is sequenced, but not every sequenced collection is sorted.
```

Conceptually true in modern Java hierarchy for sorted collections that have defined order.

---

# 5. JEP 431 dan Java 21

JEP 431 memperkenalkan sequenced collections di Java 21.

Fitur utama:

```java
SequencedCollection
SequencedSet
SequencedMap
```

JEP tersebut mendefinisikan interface baru untuk sequenced collections, sequenced sets, dan sequenced maps, lalu memasukkannya ke existing Collections Framework hierarchy.

## 5.1 Why added?

Tujuannya:

- represent collections with defined encounter order;
- provide uniform APIs for first/last;
- provide uniform reversed view;
- retrofit existing ordered implementations.

## 5.2 New interfaces

```java
java.util.SequencedCollection
java.util.SequencedSet
java.util.SequencedMap
```

## 5.3 Retrofitting

Existing types seperti `List`, `Deque`, ordered/sorted sets/maps, dan linked/sorted implementations mendapat hubungan baru di hierarchy.

## 5.4 Default methods

JEP 431 menyebut new methods declared in these interfaces have default implementations.

## 5.5 Practical impact

Code can now say:

```java
SequencedCollection<E>
```

instead of overusing:

```java
List<E>
```

for all ordered things.

---

# 6. Peta Hierarchy Baru

Simplified:

```text
Collection
  └── SequencedCollection
        ├── List
        ├── Deque
        └── SequencedSet
              ├── SortedSet
              │     └── NavigableSet
              └── ordered set implementations

Map
  └── SequencedMap
        ├── SortedMap
        │     └── NavigableMap
        └── ordered map implementations
```

Important:

- `SequencedSet` extends both `SequencedCollection` and `Set`.
- `SequencedMap` is Map with encounter order over mappings.
- `List` and `Deque` are sequenced collections.
- sorted/navigable types naturally have encounter order.

## 6.1 Why this hierarchy helps

You can write:

```java
void printNewestFirst(SequencedCollection<Event> events) {
    for (Event event : events.reversed()) {
        System.out.println(event);
    }
}
```

This works for:

- List;
- Deque;
- LinkedHashSet;
- TreeSet;
- other sequenced collections.

## 6.2 Caveat

Not every collection is sequenced.

Example:

```java
HashSet
HashMap
```

should not be treated as semantically sequenced.

---

# 7. `SequencedCollection<E>`

Java SE docs describe `SequencedCollection` as a collection that has a well-defined encounter order, supports operations at both ends, and is reversible.

## 7.1 Meaning

```java
SequencedCollection<E>
```

means:

```text
Elements are linearly arranged from first to last.
```

For any two elements in encounter order, one appears before the other.

## 7.2 Core operations

Conceptually:

```java
E getFirst()
E getLast()

void addFirst(E e)
void addLast(E e)

E removeFirst()
E removeLast()

SequencedCollection<E> reversed()
```

## 7.3 Not necessarily List

It does not imply:

- index access;
- random access;
- duplicates prohibited;
- sorting;
- mutability;
- thread safety.

## 7.4 Good use cases

```java
SequencedCollection<CaseEvent> eventHistory;
SequencedCollection<ApprovalStep> approvalTrail;
SequencedCollection<Notification> notifications;
SequencedCollection<AuditEntry> auditTrail;
```

## 7.5 Why not Collection?

Because first/last/reverse are meaningful.

## 7.6 Why not List?

Because index may not be part of domain.

## 7.7 Rule

Use SequencedCollection when ordered traversal is required but positional indexing is not.

---

# 8. First/Last Operations

## 8.1 `getFirst`

```java
E first = collection.getFirst();
```

Returns first element.

If empty, typically throws `NoSuchElementException`.

## 8.2 `getLast`

```java
E last = collection.getLast();
```

Returns last element.

## 8.3 `addFirst` and `addLast`

```java
collection.addFirst(e);
collection.addLast(e);
```

May throw `UnsupportedOperationException` if collection is unmodifiable or operation unsupported.

## 8.4 `removeFirst` and `removeLast`

```java
collection.removeFirst();
collection.removeLast();
```

Mutating operations.

## 8.5 Empty collection handling

If empty is possible:

```java
if (!events.isEmpty()) {
    Event latest = events.getLast();
}
```

Better domain modeling:

```java
NonEmptySequencedCollection<Event>
```

or wrapper:

```java
record EventHistory(SequencedCollection<Event> events) {
    EventHistory {
        events = List.copyOf(events);
        if (events.isEmpty()) {
            throw new IllegalArgumentException("events required");
        }
    }

    Event latest() {
        return events.getLast();
    }
}
```

## 8.6 Rule

First/last operations make intent clear, but empty/mutability still need design.

---

# 9. `reversed()` View

## 9.1 Meaning

```java
SequencedCollection<E> reversed = collection.reversed();
```

Returns a reverse-ordered view.

## 9.2 View, not necessarily copy

This is crucial.

`reversed()` generally provides a view where encounter order is inverted.

Mutation behavior may affect original collection, depending implementation and mutability.

## 9.3 Example

```java
SequencedCollection<Event> newestFirst = events.reversed();
```

This expresses:

```text
same elements, reverse encounter order
```

## 9.4 Why useful

Before:

```java
List<Event> copy = new ArrayList<>(events);
Collections.reverse(copy);
return copy;
```

Now:

```java
return events.reversed();
```

if view semantics are acceptable.

## 9.5 Copy when crossing boundary

If returning to API or storing long-lived:

```java
List<Event> newestFirstSnapshot = List.copyOf(events.reversed());
```

## 9.6 Rule

Use reversed view for traversal; copy for stable independent snapshot.

---

# 10. List as SequencedCollection

`List` is a sequenced collection.

## 10.1 Old style

```java
E first = list.get(0);
E last = list.get(list.size() - 1);
```

## 10.2 New style

```java
E first = list.getFirst();
E last = list.getLast();
```

## 10.3 Better readability

```java
events.getLast()
```

more clearly means latest in event history than:

```java
events.get(events.size() - 1)
```

## 10.4 Reversed

```java
List<E> reversed = list.reversed();
```

The return type for List's reversed view is List.

## 10.5 When List still better

Use List when you need:

- index;
- random access expectation;
- order-sensitive equality;
- positional mutation.

## 10.6 Rule

Sequenced operations improve List readability, but do not replace List where index is meaningful.

---

# 11. Deque as SequencedCollection

`Deque` naturally supports operations at both ends.

## 11.1 Deque already had first/last

```java
deque.getFirst();
deque.getLast();
deque.addFirst(e);
deque.addLast(e);
```

## 11.2 What sequenced adds

Uniformity with other ordered collections.

Generic API can accept:

```java
SequencedCollection<E>
```

instead of Deque if only first/last/reverse needed.

## 11.3 When Deque still better

Use Deque when both-ended mutation is core:

- stack;
- queue;
- sliding window;
- worklist;
- recent history buffer.

## 11.4 Rule

Deque is operational. SequencedCollection is semantic.

---

# 12. `SequencedSet<E>`

Java SE docs describe `SequencedSet` as both a `SequencedCollection` and a `Set`; it can be thought of as a Set with well-defined encounter order, or SequencedCollection with unique elements.

## 12.1 Meaning

```java
SequencedSet<E>
```

means:

```text
Unique elements + defined encounter order.
```

## 12.2 Use cases

- ordered unique tags;
- deduped recipients preserving input order;
- recently viewed unique items;
- deterministic permission display;
- unique workflow steps with defined order.

## 12.3 Operations

Has set uniqueness plus sequenced operations:

```java
getFirst()
getLast()
reversed()
addFirst()
addLast()
```

depending mutability/implementation.

## 12.4 What it does not mean

It does not imply:

- sorted order;
- order-sensitive equality;
- immutable;
- thread-safe.

## 12.5 Rule

Use SequencedSet when uniqueness and encounter order both matter.

---

# 13. SequencedSet Equality Caveat

This is very important.

`SequencedSet` follows `Set.equals` and `Set.hashCode`.

That means equality ignores encounter order.

## 13.1 Example

```java
SequencedSet<String> a = new LinkedHashSet<>();
a.add("A");
a.add("B");

SequencedSet<String> b = new LinkedHashSet<>();
b.add("B");
b.add("A");

a.equals(b); // true
```

Although encounter order differs.

## 13.2 Why?

Because it is still a Set.

Set equality says same elements.

## 13.3 When this is wrong

If order is part of value identity:

```text
[A, B] should not equal [B, A]
```

Use:

```java
List<E>
```

or custom wrapper with custom equality.

## 13.4 Domain example

Ordered approval chain:

```java
A -> B
```

not same as:

```java
B -> A
```

Use List, not SequencedSet.

## 13.5 Domain example where SequencedSet fits

Tags displayed in first-added order, but domain identity is same set of tags.

SequencedSet can fit.

## 13.6 Rule

SequencedSet order affects traversal, not equality.

---

# 14. LinkedHashSet as SequencedSet

`LinkedHashSet` is the classic ordered unique set.

## 14.1 Meaning

```java
LinkedHashSet<E>
```

means:

```text
Hash-based uniqueness + insertion encounter order.
```

## 14.2 Use case: dedup preserving input order

```java
SequencedSet<EmailAddress> uniqueRecipients =
    new LinkedHashSet<>(rawRecipients);
```

## 14.3 First/last

Java 21+ sequenced methods let you access:

```java
uniqueRecipients.getFirst();
uniqueRecipients.getLast();
```

## 14.4 Reversed

```java
SequencedSet<EmailAddress> newestFirst = uniqueRecipients.reversed();
```

## 14.5 Add first/last

In sequenced sets, adding an existing element may reposition it depending method semantics/implementation. Be careful and read API behavior.

## 14.6 Rule

LinkedHashSet is ideal for deterministic unique encounter order.

---

# 15. SortedSet/NavigableSet and SequencedSet

Sorted sets have well-defined order based on comparator/natural ordering.

## 15.1 TreeSet

```java
NavigableSet<Instant> times = new TreeSet<>();
```

Encounter order = sorted order.

## 15.2 First/last

Already had:

```java
first()
last()
```

Sequenced API gives common method shape:

```java
getFirst()
getLast()
```

depending available methods in hierarchy.

## 15.3 Reversed

Sorted/navigable sets already had descending views:

```java
descendingSet()
```

Sequenced gives common:

```java
reversed()
```

## 15.4 Sorted vs sequenced

Sorted means order determined by comparator.

Sequenced only means encounter order exists.

## 15.5 Rule

Use SortedSet/NavigableSet when sorted/range semantics matter, not merely because first/last exists.

---

# 16. `SequencedMap<K,V>`

Java SE docs describe `SequencedMap` as a Map with well-defined encounter order, operations at both ends, and reversible behavior. Its encounter order applies to mappings.

## 16.1 Meaning

```java
SequencedMap<K,V>
```

means:

```text
Mappings have defined encounter order.
First and last mapping are meaningful.
Reverse mapping view is meaningful.
```

## 16.2 Core operations

Conceptually:

```java
Map.Entry<K,V> firstEntry()
Map.Entry<K,V> lastEntry()

Map.Entry<K,V> pollFirstEntry()
Map.Entry<K,V> pollLastEntry()

V putFirst(K key, V value)
V putLast(K key, V value)

SequencedMap<K,V> reversed()

SequencedSet<K> sequencedKeySet()
SequencedCollection<V> sequencedValues()
SequencedSet<Map.Entry<K,V>> sequencedEntrySet()
```

## 16.3 Use cases

- LRU map;
- deterministic ordered output;
- ordered headers/metadata;
- ordered lookup table;
- first/last rule table;
- timeline keyed by time;
- sorted maps through common abstraction.

## 16.4 Map equality caveat

Map equality ignores order.

Two SequencedMaps with same mappings but different encounter order compare equal.

## 16.5 Rule

SequencedMap order affects traversal/first/last, not Map equality.

---

# 17. SequencedMap Views

`SequencedMap` provides sequenced views.

## 17.1 sequencedKeySet

```java
SequencedSet<K> keys = map.sequencedKeySet();
```

Keys in encounter order.

## 17.2 sequencedValues

```java
SequencedCollection<V> values = map.sequencedValues();
```

Values in mapping encounter order.

Values are not a set because duplicates can exist.

## 17.3 sequencedEntrySet

```java
SequencedSet<Map.Entry<K,V>> entries = map.sequencedEntrySet();
```

Mappings in encounter order.

## 17.4 View warning

These views are usually backed by map.

Mutating view may mutate map.

## 17.5 Boundary copy

```java
List<K> keysSnapshot = List.copyOf(map.sequencedKeySet());
List<V> valuesSnapshot = List.copyOf(map.sequencedValues());
```

## 17.6 Rule

Sequenced views are powerful, but treat them as live views unless copied.

---

# 18. LinkedHashMap as SequencedMap

`LinkedHashMap` is a major beneficiary of SequencedMap.

## 18.1 Insertion order

Default LinkedHashMap maintains insertion order.

```java
SequencedMap<CaseId, CaseSummary> map = new LinkedHashMap<>();
map.put(a, summaryA);
map.put(b, summaryB);
```

## 18.2 Access order

LinkedHashMap can be created in access-order mode.

This is useful for LRU-like behavior.

## 18.3 First/last

```java
Map.Entry<CaseId, CaseSummary> first = map.firstEntry();
Map.Entry<CaseId, CaseSummary> last = map.lastEntry();
```

## 18.4 Put first/last

```java
map.putFirst(caseId, summary);
map.putLast(caseId, summary);
```

Useful for explicit ordering.

## 18.5 Reversed

```java
SequencedMap<CaseId, CaseSummary> newestFirst = map.reversed();
```

## 18.6 Rule

Use LinkedHashMap/SequencedMap when key lookup and encounter order both matter.

---

# 19. SortedMap/NavigableMap and SequencedMap

Sorted maps have encounter order by sorted keys.

## 19.1 TreeMap

```java
NavigableMap<Instant, Rule> rules = new TreeMap<>();
```

Encounter order = sorted by Instant.

## 19.2 Common first/last

```java
rules.firstEntry();
rules.lastEntry();
```

Already existed in NavigableMap; sequenced gives unified model.

## 19.3 Reversed

NavigableMap has:

```java
descendingMap()
```

SequencedMap has:

```java
reversed()
```

## 19.4 Sorted vs sequenced

Use NavigableMap when you need:

```java
floorEntry
ceilingEntry
subMap
headMap
tailMap
```

Use SequencedMap when you only require defined mapping order and first/last/reversed.

## 19.5 Rule

SequencedMap is not a replacement for NavigableMap range semantics.

---

# 20. Reversed View Semantics and Mutation

`reversed()` returns reverse-ordered view.

## 20.1 Not a copy

This is the most important practical detail.

## 20.2 Mutation can reflect both ways

If original is mutable and reversed view supports mutation, changes may affect original.

Example concept:

```java
var list = new ArrayList<>(List.of("A", "B", "C"));
var rev = list.reversed();

rev.getFirst(); // C
rev.addFirst("D"); // conceptually adds at end of original
```

Exact behavior depends on method and implementation contract.

## 20.3 View can be useful

For traversal:

```java
for (Event event : events.reversed()) {
    ...
}
```

## 20.4 View can be dangerous

Returning reversed view from internal mutable collection can expose mutation path.

Bad:

```java
return internalEvents.reversed();
```

Better:

```java
return List.copyOf(internalEvents.reversed());
```

if crossing boundary.

## 20.5 Rule

Use reversed view internally; return snapshots externally.

---

# 21. Unmodifiable Sequenced Collections

Unmodifiable collections can still implement sequenced interfaces.

## 21.1 List.of

```java
List<String> xs = List.of("A", "B");
xs.getFirst(); // ok
xs.addFirst("X"); // UnsupportedOperationException
```

## 21.2 Set.copyOf

May not preserve encounter order in a way you intend, depending source and implementation. If order matters, use appropriate ordered copy.

## 21.3 Unmodifiable view vs immutable copy

```java
Collections.unmodifiableList(list)
```

is view.

```java
List.copyOf(list)
```

is copy.

## 21.4 Sequenced unmodifiable

Even if reversed view exists, mutating operations may fail.

## 21.5 Rule

Sequenced does not imply mutable.

---

# 22. Sequenced vs Sorted vs Insertion Order vs Access Order

## 22.1 Sequenced

General concept:

```text
There is encounter order.
```

## 22.2 Sorted

Order determined by comparator/natural order.

```java
TreeSet
TreeMap
```

## 22.3 Insertion order

Order determined by insertion sequence.

```java
LinkedHashSet
LinkedHashMap default
```

## 22.4 Access order

Order changes on access.

```java
LinkedHashMap(accessOrder=true)
```

## 22.5 List order

Order determined by positional index.

```java
ArrayList
LinkedList
```

## 22.6 Why terms matter

If API says “ordered”, ask:

```text
ordered by what?
```

Possible answers:

- insertion;
- update time;
- priority;
- sorted key;
- user-defined position;
- access recency.

## 22.7 Rule

Do not say “ordered” without defining order source.

---

# 23. API Design with Sequenced Interfaces

## 23.1 Parameter type

If method needs order and first/last, but not index:

```java
void replay(SequencedCollection<CaseEvent> events)
```

Better than:

```java
void replay(List<CaseEvent> events)
```

if index irrelevant.

## 23.2 Return type

If you promise ordered unique results:

```java
SequencedSet<Tag> tagsInDisplayOrder()
```

## 23.3 Map return

If result is map with deterministic order:

```java
SequencedMap<CaseId, CaseSummary> summariesInDisplayOrder()
```

## 23.4 Compatibility with older Java

If your codebase targets Java 17, cannot expose sequenced interfaces.

Use:

- `List`;
- `LinkedHashSet`;
- `LinkedHashMap`;
- documentation;
- helper methods.

## 23.5 Public library caution

If library supports multiple Java versions, exposing Java 21 interfaces is breaking for older targets.

## 23.6 Rule

Expose Sequenced interfaces only if Java baseline supports them and semantic value is real.

---

# 24. Domain Modeling Patterns

## 24.1 EventHistory

```java
public record EventHistory(SequencedCollection<CaseEvent> events) {
    public EventHistory {
        events = List.copyOf(events);
        if (events.isEmpty()) {
            throw new IllegalArgumentException("events required");
        }
    }

    public CaseEvent first() {
        return events.getFirst();
    }

    public CaseEvent latest() {
        return events.getLast();
    }

    public SequencedCollection<CaseEvent> newestFirst() {
        return events.reversed();
    }
}
```

## 24.2 OrderedUniqueTags

```java
public record OrderedUniqueTags(SequencedSet<Tag> tags) {
    public OrderedUniqueTags {
        tags = new LinkedHashSet<>(tags);
    }

    public Tag firstAdded() {
        return tags.getFirst();
    }
}
```

But if equality should include order, use List/wrapper custom equality.

## 24.3 RecentItems

```java
public final class RecentItems<T> {
    private final int maxSize;
    private final LinkedHashSet<T> items = new LinkedHashSet<>();

    public void markSeen(T item) {
        items.remove(item);
        items.addLast(item);

        while (items.size() > maxSize) {
            items.removeFirst();
        }
    }

    public SequencedSet<T> newestFirst() {
        return items.reversed();
    }
}
```

## 24.4 OrderedLookup

```java
public record OrderedLookup<K,V>(SequencedMap<K,V> values) {
    public OrderedLookup {
        values = new LinkedHashMap<>(values);
    }

    public Optional<V> firstValue() {
        return values.isEmpty()
            ? Optional.empty()
            : Optional.ofNullable(values.firstEntry().getValue());
    }
}
```

## 24.5 Rule

Sequenced wrappers are great for domain concepts where order is meaningful but index is not.

---

# 25. Streams and Sequenced Collections

## 25.1 Stream encounter order

Streams can have encounter order depending source.

A stream from List has order.

A stream from HashSet should not be assumed stable ordered.

## 25.2 Reversed stream

```java
events.reversed().stream()
```

gives stream in reverse encounter order.

## 25.3 Collecting to sequenced structures

For ordered unique result:

```java
SequencedSet<Tag> tags = stream.collect(
    Collectors.toCollection(LinkedHashSet::new)
);
```

For ordered map:

```java
SequencedMap<CaseId, CaseSummary> map = stream.collect(
    Collectors.toMap(
        CaseSummary::caseId,
        Function.identity(),
        (a, b) -> a,
        LinkedHashMap::new
    )
);
```

## 25.4 `toList`

```java
stream.toList()
```

returns unmodifiable List preserving encounter order if stream has one.

## 25.5 `toSet`

Do not rely on encounter order.

Use explicit collector.

## 25.6 Rule

Stream order depends on source and operations. Use sequenced collection/map suppliers when output order matters.

---

# 26. Boundary Design: JSON, API, DB, Events

## 26.1 JSON arrays

SequencedCollection maps naturally to JSON array.

But document order:

```yaml
description: Items are ordered from oldest to newest.
```

## 26.2 SequencedSet

JSON array with uniqueness and order.

Need document both:

```yaml
type: array
uniqueItems: true
description: Tags are unique and returned in first-added order.
```

## 26.3 SequencedMap

JSON object order should not be semantic contract.

If order matters, use array of entries:

```json
[
  {"key": "CASE-1", "value": {...}},
  {"key": "CASE-2", "value": {...}}
]
```

## 26.4 DB

Order must be stored explicitly:

- position column;
- created_at/insertion time;
- sort key;
- sequence number.

## 26.5 Events

Event payload with ordered items should define order meaning.

## 26.6 Rule

Sequenced semantics must be translated explicitly at boundaries.

---

# 27. Migration from Pre-Java 21 Code

## 27.1 First/last List code

Before:

```java
E first = list.get(0);
E last = list.get(list.size() - 1);
```

After:

```java
E first = list.getFirst();
E last = list.getLast();
```

## 27.2 Reverse List code

Before:

```java
List<E> copy = new ArrayList<>(list);
Collections.reverse(copy);
```

After, if view okay:

```java
List<E> reversed = list.reversed();
```

If copy required:

```java
List<E> reversedSnapshot = List.copyOf(list.reversed());
```

## 27.3 LinkedHashSet first

Before:

```java
E first = set.iterator().next();
```

After:

```java
E first = set.getFirst();
```

## 27.4 LinkedHashMap first/last

Before first:

```java
map.entrySet().iterator().next()
```

After:

```java
map.firstEntry()
map.lastEntry()
```

## 27.5 Method signatures

Before:

```java
void replay(List<Event> events)
```

After:

```java
void replay(SequencedCollection<Event> events)
```

if no index needed.

## 27.6 Rule

Migrate where it clarifies semantics, not mechanically everywhere.

---

# 28. Compatibility and Source/Binary Considerations

## 28.1 Java baseline

Sequenced interfaces require Java 21+.

If project baseline is Java 17, do not use them in source.

## 28.2 Library API

Public APIs exposing Sequenced interfaces require consumers to compile/run on Java 21+.

## 28.3 Runtime

If using Java 21+ runtime, existing `List`/`Deque` implementations have new methods through interface changes.

## 28.4 Reflection/frameworks

Frameworks introspecting collection interfaces may see new hierarchy/methods.

Usually fine, but old assumptions can break in edge cases.

## 28.5 Team conventions

Introduce new interface gradually with guidelines.

## 28.6 Rule

Sequenced Collections are powerful, but align with Java baseline and API compatibility policy.

---

# 29. Performance and Memory Considerations

## 29.1 Interface has no direct storage cost

`SequencedCollection` is interface.

Cost depends on implementation:

- ArrayList;
- LinkedList;
- LinkedHashSet;
- TreeSet;
- LinkedHashMap;
- TreeMap.

## 29.2 Reversed view

Likely cheap view, not copy.

Good for traversal.

But if you need snapshot, copying costs O(n).

## 29.3 First/last

Cost depends on implementation and method default/override.

For List:

- getFirst via first index;
- getLast via last index.

For linked structures:

- can be direct.

## 29.4 Ordered set/map overhead

LinkedHashSet/LinkedHashMap have extra linked-order overhead.

TreeSet/TreeMap have tree overhead.

## 29.5 Rule

Sequenced APIs improve expressiveness; implementation still determines performance.

---

# 30. Production Failure Modes

## 30.1 Reversed view exposed as snapshot

Caller sees changes when original mutates.

Fix:

```java
List.copyOf(collection.reversed())
```

## 30.2 SequencedSet equality misunderstood

Two differently ordered SequencedSets compare equal.

Fix: use List/custom wrapper if order is part of identity.

## 30.3 HashSet treated as sequenced

Relying on HashSet order.

Fix: LinkedHashSet/SequencedSet/List.

## 30.4 Ordered JSON map assumed

SequencedMap serialized as JSON object, client relies on order.

Fix: array of entries if order matters.

## 30.5 Empty first/last crash

`getFirst` on empty collection.

Fix: check empty or use NonEmpty wrapper.

## 30.6 Mutating unmodifiable sequenced collection

`List.of(...).addFirst(...)` throws.

Fix: copy to mutable implementation if mutation needed.

## 30.7 Access order map surprise

LinkedHashMap access-order changes order on get.

Fix: document and test.

## 30.8 Migration overuse

Changing API from List to SequencedCollection breaks callers that rely on index.

Fix: use Sequenced only when index not part of contract.

## 30.9 Reversed view mutation direction surprise

Adding/removing through reversed view affects opposite end of original.

Fix: avoid exposing mutable reversed view.

## 30.10 Boundary loses order

DB table stores set without position; API expects first-added order.

Fix: persist order column/sequence.

---

# 31. Best Practices

## 31.1 Use SequencedCollection when

- encounter order matters;
- first/last matters;
- reverse traversal matters;
- index does not matter.

## 31.2 Use List when

- positional index matters;
- order-sensitive equality matters;
- random access expected.

## 31.3 Use SequencedSet when

- uniqueness matters;
- encounter order matters;
- order does not define equality.

## 31.4 Use SequencedMap when

- key lookup matters;
- mapping encounter order matters;
- first/last mapping matters.

## 31.5 Use Navigable types when

- nearest/range operations matter.

## 31.6 Copy at boundaries

```java
List.copyOf(seq)
List.copyOf(seq.reversed())
new LinkedHashSet<>(seqSet)
new LinkedHashMap<>(seqMap)
```

## 31.7 Document order source

Always say:

- insertion order;
- sorted by X;
- newest first;
- access order;
- user-defined order.

## 31.8 Test first/last/reversed

Include tests for:

- empty;
- one element;
- multiple;
- mutation;
- reversed behavior;
- equality if set/map.

---

# 32. Decision Matrix

| Requirement | Recommended |
|---|---|
| ordered traversal only | `SequencedCollection<T>` |
| ordered + index | `List<T>` |
| ordered + stack/queue ends | `Deque<T>` |
| unique + encounter order | `SequencedSet<T>` / `LinkedHashSet<T>` |
| unique + sorted order | `SortedSet<T>` / `NavigableSet<T>` |
| map + encounter order | `SequencedMap<K,V>` / `LinkedHashMap<K,V>` |
| map + sorted keys/range | `NavigableMap<K,V>` / `TreeMap<K,V>` |
| reverse traversal view | `reversed()` |
| reverse snapshot | `List.copyOf(seq.reversed())` |
| first/last must exist | domain `NonEmpty...` wrapper |
| public API ordered map | array of entries |
| order-sensitive equality | `List` or custom wrapper |
| Java 17 baseline | avoid sequenced APIs; document order manually |

---

# 33. Latihan

## Latihan 1 — Replace List with SequencedCollection

Given:

```java
void replay(List<CaseEvent> events) {
    CaseEvent latest = events.get(events.size() - 1);
}
```

Refactor to `SequencedCollection`.

Discuss what capability is lost and gained.

## Latihan 2 — Reversed View vs Copy

Create mutable ArrayList, get reversed view, mutate original, observe reversed view.

Then create snapshot copy.

## Latihan 3 — SequencedSet Equality

Create two `LinkedHashSet`s with same elements different insertion order.

Compare equals.

Explain.

## Latihan 4 — Ordered Unique Tags

Implement:

```java
OrderedUniqueTags
```

with:

- uniqueness;
- first-added order;
- max 20;
- no null;
- newest first view.

## Latihan 5 — SequencedMap API

Design response for ordered map:

```java
SequencedMap<CaseId, CaseSummary>
```

as JSON object and as array of entries. Explain which one preserves order contract better.

## Latihan 6 — Recent Items

Implement recent items using `LinkedHashSet`:

- mark item seen;
- move to last;
- max size;
- newestFirst.

## Latihan 7 — Migration Audit

Find old code patterns:

```java
get(0)
get(size - 1)
Collections.reverse(copy)
entrySet().iterator().next()
```

Decide whether to migrate to sequenced operations.

---

# 34. Ringkasan

Sequenced Collections make encounter order explicit in Java 21+.

Core lessons:

- Encounter order is traversal order.
- Java 21 introduced `SequencedCollection`, `SequencedSet`, and `SequencedMap`.
- `SequencedCollection` means well-defined encounter order + first/last + reversible.
- `SequencedSet` means unique + encounter order, but equality ignores order.
- `SequencedMap` means mappings have encounter order, but map equality ignores order.
- `reversed()` returns a view, not necessarily a copy.
- Sequenced does not mean sorted.
- Sequenced does not mean mutable.
- Sequenced does not mean thread-safe.
- List remains right when index matters.
- Navigable types remain right when range/nearest lookup matters.
- Boundaries must explicitly preserve/order semantics.
- Copy sequenced/reversed views when crossing boundaries.

Main rule:

```text
Use Sequenced interfaces to express order as a contract, not as an implementation accident.
```

---

# 35. Referensi

1. JEP 431 — Sequenced Collections  
   https://openjdk.org/jeps/431

2. Java SE 25 — `SequencedCollection`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SequencedCollection.html

3. Java SE 25 — `SequencedSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SequencedSet.html

4. Java SE 25 — `SequencedMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SequencedMap.html

5. Oracle Java 21 Guide — Creating Sequenced Collections, Sets, and Maps  
   https://docs.oracle.com/en/java/javase/21/core/creating-sequenced-collections-sets-and-maps.html

6. Java SE 25 — `List`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

7. Java SE 25 — `Deque`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Deque.html

8. Java SE 25 — `LinkedHashSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/LinkedHashSet.html

9. Java SE 25 — `LinkedHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/LinkedHashMap.html

10. Java SE 25 — `NavigableMap`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/NavigableMap.html

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-005.md](./learn-java-collections-and-streams-part-005.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-007.md](./learn-java-collections-and-streams-part-007.md)

</div>