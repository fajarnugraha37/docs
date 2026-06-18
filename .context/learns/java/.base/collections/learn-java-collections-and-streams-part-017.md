# learn-java-collections-and-streams-part-017.md

# Java Collections and Streams — Part 017  
# Tree Structures: TreeMap, TreeSet, SortedMap, NavigableMap, SortedSet, NavigableSet, Red-Black Tree Mental Model, Range Queries, Comparator Semantics, and Production Pitfalls

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **017**  
> Fokus: memahami tree-backed collections sebagai struktur untuk **sorted order, range query, nearest lookup, dan deterministic navigation**, bukan sekadar alternatif `HashMap`/`HashSet`. Kita akan membedah `TreeMap`, `TreeSet`, `SortedMap`, `NavigableMap`, `SortedSet`, `NavigableSet`, red-black tree mental model, comparator semantics, `floor/ceiling/lower/higher`, sub views, range boundaries, mutation hazards, and production failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Tree Collection adalah Ordered Search Structure](#2-mental-model-tree-collection-adalah-ordered-search-structure)
3. [Kapan Tree Structure Dibutuhkan](#3-kapan-tree-structure-dibutuhkan)
4. [Kapan Tree Structure Bukan Pilihan Tepat](#4-kapan-tree-structure-bukan-pilihan-tepat)
5. [Binary Search Tree Mental Model](#5-binary-search-tree-mental-model)
6. [Red-Black Tree Mental Model](#6-red-black-tree-mental-model)
7. [`TreeMap<K,V>`](#7-treemapkv)
8. [`TreeSet<E>`](#8-treesete)
9. [`SortedMap<K,V>`](#9-sortedmapkv)
10. [`NavigableMap<K,V>`](#10-navigablemapkv)
11. [`SortedSet<E>`](#11-sortedsete)
12. [`NavigableSet<E>`](#12-navigablesete)
13. [Natural Ordering vs Comparator Ordering](#13-natural-ordering-vs-comparator-ordering)
14. [Comparator as Identity in Tree Collections](#14-comparator-as-identity-in-tree-collections)
15. [Consistency with Equals](#15-consistency-with-equals)
16. [Null Handling](#16-null-handling)
17. [Core Operations Cost Model](#17-core-operations-cost-model)
18. [Range Views: `subMap`, `headMap`, `tailMap`](#18-range-views-submap-headmap-tailmap)
19. [Set Range Views: `subSet`, `headSet`, `tailSet`](#19-set-range-views-subset-headset-tailset)
20. [Inclusive vs Exclusive Boundaries](#20-inclusive-vs-exclusive-boundaries)
21. [Nearest Lookup: `floor`, `ceiling`, `lower`, `higher`](#21-nearest-lookup-floor-ceiling-lower-higher)
22. [First/Last and Polling Entries](#22-firstlast-and-polling-entries)
23. [Descending Views](#23-descending-views)
24. [Live Views and Mutation](#24-live-views-and-mutation)
25. [TreeMap as Time Index](#25-treemap-as-time-index)
26. [TreeMap as Rule Table](#26-treemap-as-rule-table)
27. [TreeSet as Ordered Unique Collection](#27-treeset-as-ordered-unique-collection)
28. [Tree Structures vs Hash Structures](#28-tree-structures-vs-hash-structures)
29. [Tree Structures vs Sorted List](#29-tree-structures-vs-sorted-list)
30. [Tree Structures and Streams](#30-tree-structures-and-streams)
31. [Tree Structures and Sequenced APIs](#31-tree-structures-and-sequenced-apis)
32. [Memory and CPU Cost](#32-memory-and-cpu-cost)
33. [Concurrency](#33-concurrency)
34. [Production Diagnostics](#34-production-diagnostics)
35. [Production Failure Modes](#35-production-failure-modes)
36. [Best Practices](#36-best-practices)
37. [Decision Matrix](#37-decision-matrix)
38. [Latihan](#38-latihan)
39. [Ringkasan](#39-ringkasan)
40. [Referensi](#40-referensi)

---

# 1. Tujuan Bagian Ini

Setelah `HashMap` dan `ArrayList`, kita masuk ke tree-backed collections.

Banyak developer melihat:

```text
HashMap: O(1)
TreeMap: O(log n)
```

lalu otomatis memilih `HashMap`.

Itu terlalu dangkal.

`TreeMap`/`TreeSet` bukan terutama untuk “lookup lebih cepat”.

Mereka dipakai saat kamu butuh:

```text
sorted keys/elements
range query
nearest lookup
ordered traversal
floor/ceiling/lower/higher
first/last
prefix/time-window/rule lookup
deterministic order based on comparator
```

Contoh:

```java
NavigableMap<Instant, Rule> rulesByEffectiveTime;
NavigableMap<BigDecimal, TaxBracket> brackets;
NavigableSet<CasePriority> priorities;
NavigableMap<LocalDate, List<Holiday>> holidays;
```

Tujuan part ini:

- memahami tree structure mental model;
- memahami red-black tree secara konseptual;
- memahami `TreeMap`, `TreeSet`, `Sorted*`, `Navigable*`;
- memahami range view dan nearest lookup;
- memahami comparator sebagai identity;
- mengenali failure mode comparator/mutable key;
- mendesain tree-backed indexing untuk production.

---

# 2. Mental Model: Tree Collection adalah Ordered Search Structure

Tree-backed collection menyimpan data dalam struktur yang mempertahankan order.

Untuk `TreeMap`:

```text
key order determines tree shape and traversal order
```

Untuk `TreeSet`:

```text
element order determines tree shape and uniqueness
```

## 2.1 HashMap vs TreeMap mental model

HashMap:

```text
key -> hash -> bucket -> equals
```

TreeMap:

```text
key -> compare -> left/right path -> match/range/nearest
```

## 2.2 Sorted traversal

Tree structure dapat traverse in-order:

```text
smallest -> largest
```

atau descending:

```text
largest -> smallest
```

## 2.3 Range query

TreeMap dapat mencari subset key dari range tertentu tanpa scan seluruh map.

```java
map.subMap(from, true, to, false)
```

## 2.4 Nearest query

TreeMap dapat menjawab:

```text
key terbesar <= X
key terkecil >= X
```

Ini susah dilakukan efisien dengan HashMap.

## 2.5 Rule

```text
Use tree structures when ordering itself is operationally important.
```

---

# 3. Kapan Tree Structure Dibutuhkan

## 3.1 Sorted output

```java
new TreeSet<>(items)
```

untuk output ordered.

## 3.2 Range query

```java
eventsByTime.subMap(start, true, end, false)
```

## 3.3 Nearest lookup

```java
rules.floorEntry(now)
```

## 3.4 Prefix/range-like indexing

Untuk keys yang comparable secara lexicographic atau numeric.

## 3.5 Time-window processing

```java
NavigableMap<Instant, Event> events;
events.headMap(cutoff, false).clear();
```

## 3.6 Priority/rank with ordered uniqueness

`TreeSet` bisa menjaga unique ordered elements berdasarkan comparator.

## 3.7 Rule table

```java
NavigableMap<BigDecimal, TaxRate> taxBrackets;
taxBrackets.floorEntry(amount)
```

## 3.8 Rule

If your operation asks “before/after/between/nearest/sorted”, think tree.

---

# 4. Kapan Tree Structure Bukan Pilihan Tepat

## 4.1 Plain lookup by ID

```java
Map<CaseId, CaseSummary>
```

If you only need exact lookup, `HashMap` is usually better.

## 4.2 Insertion order

Use `LinkedHashMap` / `LinkedHashSet`.

Tree order is comparator order, not insertion order.

## 4.3 Random access by index

Use `ArrayList`.

TreeMap is not indexable by rank in JDK.

## 4.4 Huge primitive key hot path

Tree node overhead may be too high.

Consider arrays/primitive structures/specialized indexes.

## 4.5 Comparator unstable

If comparator depends on mutable fields, tree breaks logically.

## 4.6 Rule

Tree structure is for ordered search/navigation, not generic collection replacement.

---

# 5. Binary Search Tree Mental Model

A binary search tree node has:

```text
key
value
left child
right child
parent
```

For each node:

```text
left subtree keys < node key
right subtree keys > node key
```

according to comparator.

## 5.1 Search

To find key:

```text
compare target with node
if smaller -> left
if greater -> right
if equal -> found
```

## 5.2 Insert

Find location by comparisons, insert as leaf.

## 5.3 Problem: unbalanced tree

If inserted in sorted order into naive BST:

```text
1, 2, 3, 4, 5
```

Tree can become linked list:

```text
1
 \
  2
   \
    3
     \
      4
```

Lookup becomes O(n).

## 5.4 Balanced tree

Balanced tree keeps height around O(log n).

## 5.5 Rule

TreeMap uses balanced tree so operations do not degrade like naive BST.

---

# 6. Red-Black Tree Mental Model

`TreeMap` is documented as a Red-Black tree based `NavigableMap`.

A red-black tree is a self-balancing binary search tree.

## 6.1 Why red/black?

Nodes carry a color bit: red or black.

Rules constrain colors so tree height stays bounded.

## 6.2 You do not need to memorize rotations

For using Java Collections, understand:

```text
insert/remove may rotate/recolor to keep tree balanced
lookup/insert/remove stay O(log n)
```

## 6.3 Conceptual invariants

Red-black trees maintain balance using rules such as:

- every node red/black;
- root black;
- red nodes do not have red children;
- paths preserve black-height constraints.

Exact formal proof is algorithm topic, not collection API topic.

## 6.4 Cost

Balancing adds overhead to insertion/removal.

## 6.5 Benefit

Guaranteed logarithmic operations.

## 6.6 Rule

TreeMap pays balancing overhead to guarantee ordered logarithmic navigation.

---

# 7. `TreeMap<K,V>`

`TreeMap` is a Red-Black tree based `NavigableMap`.

## 7.1 Sorted by key

Keys are sorted by:

- natural ordering; or
- comparator provided at construction.

```java
NavigableMap<Instant, Event> events = new TreeMap<>();
```

## 7.2 Guaranteed log(n) basic operations

Basic operations like:

- `containsKey`;
- `get`;
- `put`;
- `remove`;

are documented as guaranteed log(n).

## 7.3 No hashCode dependency

TreeMap uses comparison, not hash.

## 7.4 Key uniqueness

If comparator says:

```java
compare(k1, k2) == 0
```

then they are same key for TreeMap.

## 7.5 Use cases

- sorted dictionary;
- range index;
- time-based lookup;
- numeric bracket lookup;
- nearest match.

## 7.6 Rule

TreeMap is a sorted/range-capable map, not just slower HashMap.

---

# 8. `TreeSet<E>`

`TreeSet` is a `NavigableSet` implementation based on `TreeMap`.

## 8.1 Element order

Elements sorted by:

- natural ordering; or
- comparator.

## 8.2 Basic operations

`add`, `remove`, and `contains` are guaranteed log(n).

## 8.3 Uniqueness

Uniqueness is defined by comparator comparison:

```java
compare(a, b) == 0
```

not necessarily `equals`.

## 8.4 Internally

Conceptually, a TreeSet can be thought as TreeMap with elements as keys and dummy values.

## 8.5 Use cases

- sorted unique values;
- range set;
- nearest element;
- ranked domain objects.

## 8.6 Rule

TreeSet is ordered unique membership by comparator.

---

# 9. `SortedMap<K,V>`

`SortedMap` is a Map that provides total ordering on keys.

## 9.1 Key methods

```java
Comparator<? super K> comparator()
K firstKey()
K lastKey()
SortedMap<K,V> subMap(K fromKey, K toKey)
SortedMap<K,V> headMap(K toKey)
SortedMap<K,V> tailMap(K fromKey)
```

## 9.2 Limitations

Original SortedMap range methods use half-open style:

```text
from inclusive, to exclusive
```

for `subMap`.

## 9.3 NavigableMap extends it

NavigableMap adds richer navigation and inclusive/exclusive control.

## 9.4 Rule

Use NavigableMap type when you need modern range/navigation operations.

---

# 10. `NavigableMap<K,V>`

`NavigableMap` extends SortedMap with navigation methods.

## 10.1 Nearness methods

```java
lowerEntry(key)   // greatest key < key
floorEntry(key)   // greatest key <= key
ceilingEntry(key) // least key >= key
higherEntry(key)  // least key > key
```

and key variants:

```java
lowerKey
floorKey
ceilingKey
higherKey
```

## 10.2 First/last entry

```java
firstEntry()
lastEntry()
pollFirstEntry()
pollLastEntry()
```

## 10.3 Descending view

```java
descendingMap()
descendingKeySet()
```

## 10.4 Range with inclusivity

```java
subMap(fromKey, fromInclusive, toKey, toInclusive)
headMap(toKey, inclusive)
tailMap(fromKey, inclusive)
```

## 10.5 Rule

If you choose TreeMap, usually type your variable as NavigableMap unless you need specific implementation.

---

# 11. `SortedSet<E>`

`SortedSet` is a Set that provides total ordering on elements.

## 11.1 Key methods

```java
Comparator<? super E> comparator()
E first()
E last()
SortedSet<E> subSet(E fromElement, E toElement)
SortedSet<E> headSet(E toElement)
SortedSet<E> tailSet(E fromElement)
```

## 11.2 NavigableSet extends it

NavigableSet adds nearest and inclusive/exclusive methods.

## 11.3 Rule

SortedSet is older sorted abstraction; NavigableSet is richer.

---

# 12. `NavigableSet<E>`

`NavigableSet` extends SortedSet with navigation methods.

## 12.1 Nearness

```java
lower(e)
floor(e)
ceiling(e)
higher(e)
```

## 12.2 Polling

```java
pollFirst()
pollLast()
```

## 12.3 Descending

```java
descendingSet()
descendingIterator()
```

## 12.4 Range with inclusive flags

```java
subSet(from, fromInclusive, to, toInclusive)
headSet(to, inclusive)
tailSet(from, inclusive)
```

## 12.5 Rule

Use NavigableSet for ordered unique elements with nearest/range operations.

---

# 13. Natural Ordering vs Comparator Ordering

## 13.1 Natural ordering

Element/key implements Comparable.

```java
TreeSet<String> names = new TreeSet<>();
```

Uses `String.compareTo`.

## 13.2 Comparator ordering

```java
TreeSet<User> users = new TreeSet<>(
    Comparator.comparing(User::lastName)
              .thenComparing(User::firstName)
              .thenComparing(User::id)
);
```

## 13.3 Comparator stored in collection

TreeMap/TreeSet uses comparator consistently for all operations.

## 13.4 Null natural order

Natural ordering usually does not accept null.

## 13.5 Rule

Choose comparator explicitly when natural order is not obvious or not sufficient.

---

# 14. Comparator as Identity in Tree Collections

This is critical.

In `TreeSet`:

```java
compare(a, b) == 0
```

means duplicate.

In `TreeMap`:

```java
compare(k1, k2) == 0
```

means same key.

## 14.1 Example bug

```java
record Person(String id, int age) {}

Set<Person> people = new TreeSet<>(Comparator.comparingInt(Person::age));

people.add(new Person("A", 30));
people.add(new Person("B", 30));

people.size(); // 1
```

Because comparator says both are equal by age.

## 14.2 Fix

Comparator must include identity tie-breaker:

```java
Comparator<Person> byAgeThenId =
    Comparator.comparingInt(Person::age)
              .thenComparing(Person::id);
```

## 14.3 Display sort vs collection identity

A comparator for display sorting may be too weak for TreeSet identity.

## 14.4 Rule

Comparator in tree collection is not just order. It defines uniqueness.

---

# 15. Consistency with Equals

JDK docs warn that ordering should be consistent with equals if sorted map/set is to correctly implement Map/Set interface expectations.

## 15.1 Meaning

```java
compare(a, b) == 0
```

should align with:

```java
a.equals(b)
```

where possible.

## 15.2 BigDecimal exception

```java
new BigDecimal("1.0").compareTo(new BigDecimal("1.00")) == 0
```

but:

```java
equals == false
```

TreeSet dedups them; HashSet does not.

## 15.3 When inconsistency may be intentional

Case-insensitive sorted set:

```java
new TreeSet<>(String.CASE_INSENSITIVE_ORDER)
```

May treat `"abc"` and `"ABC"` as same.

If intentional, document.

## 15.4 Rule

Comparator consistency affects correctness, not just aesthetics.

---

# 16. Null Handling

## 16.1 TreeMap natural ordering

Null key with natural ordering usually fails because null cannot be compared.

## 16.2 Comparator can allow null

```java
Comparator<String> nullsLast =
    Comparator.nullsLast(String::compareTo);

TreeSet<String> set = new TreeSet<>(nullsLast);
```

## 16.3 Should you allow null?

Usually no for domain keys/elements.

## 16.4 TreeSet null

Same principle: comparator determines whether null can be ordered.

## 16.5 Rule

Null in tree collections must have explicit comparator semantics.

---

# 17. Core Operations Cost Model

## 17.1 TreeMap

Guaranteed log(n) for:

- `containsKey`;
- `get`;
- `put`;
- `remove`.

## 17.2 TreeSet

Guaranteed log(n) for:

- `add`;
- `remove`;
- `contains`.

## 17.3 Iteration

O(n), in sorted order.

## 17.4 Range view creation

Creating range view is usually cheap; operations on view still navigate tree.

## 17.5 Comparator cost

Each tree operation calls comparator O(log n) times.

If comparator expensive, operation expensive.

## 17.6 Rule

Tree operation cost = O(log n) comparisons + pointer traversal + balancing if mutating.

---

# 18. Range Views: `subMap`, `headMap`, `tailMap`

TreeMap's range views are one of its superpowers.

## 18.1 subMap

```java
NavigableMap<K,V> range =
    map.subMap(from, true, to, false);
```

## 18.2 headMap

```java
NavigableMap<K,V> before =
    map.headMap(cutoff, false);
```

## 18.3 tailMap

```java
NavigableMap<K,V> after =
    map.tailMap(start, true);
```

## 18.4 Live views

These are backed by original map.

Changes in view affect map and vice versa.

## 18.5 Bounds enforced

Putting key outside range into view throws `IllegalArgumentException`.

## 18.6 Rule

Range views are live bounded windows over the same tree.

---

# 19. Set Range Views: `subSet`, `headSet`, `tailSet`

NavigableSet provides range views.

## 19.1 subSet

```java
NavigableSet<E> range =
    set.subSet(from, true, to, false);
```

## 19.2 headSet

```java
NavigableSet<E> low =
    set.headSet(to, false);
```

## 19.3 tailSet

```java
NavigableSet<E> high =
    set.tailSet(from, true);
```

## 19.4 Live view

Backed by original set.

## 19.5 Use cases

- values in range;
- remove old elements;
- validate bounds;
- ranked segments.

## 19.6 Rule

Set range views are live views, not copies.

---

# 20. Inclusive vs Exclusive Boundaries

Navigable APIs let you choose inclusivity.

## 20.1 Half-open time windows

Common pattern:

```java
events.subMap(startInclusive, true, endExclusive, false)
```

This avoids overlap between adjacent windows.

## 20.2 Inclusive bracket

```java
brackets.floorEntry(amount)
```

For amount thresholds.

## 20.3 Mistake

Using inclusive end for adjacent windows can double count boundary events.

## 20.4 Rule

Use half-open intervals `[start, end)` for time ranges unless domain says otherwise.

---

# 21. Nearest Lookup: `floor`, `ceiling`, `lower`, `higher`

## 21.1 Meaning

For key x:

```text
lower   < x
floor   <= x
ceiling >= x
higher  > x
```

## 21.2 Example rule lookup

```java
NavigableMap<Instant, Rule> rules = new TreeMap<>();

Rule activeRuleAt(Instant time) {
    Map.Entry<Instant, Rule> entry = rules.floorEntry(time);
    if (entry == null) {
        throw new NoSuchElementException("No rule effective yet");
    }
    return entry.getValue();
}
```

## 21.3 Example next scheduled event

```java
events.ceilingEntry(now)
```

## 21.4 Example previous event

```java
events.lowerEntry(now)
```

## 21.5 Rule

Nearest lookup is the killer feature of NavigableMap/NavigableSet.

---

# 22. First/Last and Polling Entries

## 22.1 first/last

```java
map.firstEntry()
map.lastEntry()
set.first()
set.last()
```

## 22.2 polling

```java
map.pollFirstEntry()
map.pollLastEntry()
set.pollFirst()
set.pollLast()
```

Poll removes and returns.

## 22.3 Use cases

- consume smallest/largest;
- bounded queue-like ordered processing;
- remove expired entries;
- keep top/bottom range.

## 22.4 Empty behavior

Some methods throw, some return null depending method.

Check API.

## 22.5 Rule

Polling from tree gives ordered destructive consumption.

---

# 23. Descending Views

## 23.1 Map descending

```java
NavigableMap<K,V> desc = map.descendingMap();
```

## 23.2 Set descending

```java
NavigableSet<E> desc = set.descendingSet();
```

## 23.3 Iterator

```java
Iterator<E> it = set.descendingIterator();
```

## 23.4 Live view

Descending views are backed by original collection.

## 23.5 Sequenced reversed

Java 21+ also gives sequenced `reversed()` style APIs, but Navigable descending APIs remain important.

## 23.6 Rule

Descending view is reverse-order live view.

---

# 24. Live Views and Mutation

Range/descending/key views are live.

## 24.1 Mutation through view

```java
NavigableMap<Integer, String> map = new TreeMap<>();
map.put(1, "A");
map.put(2, "B");
map.put(3, "C");

NavigableMap<Integer, String> head = map.headMap(3, false);
head.clear();

map.keySet(); // contains only 3
```

## 24.2 Mutation outside range

```java
head.put(4, "D"); // IllegalArgumentException
```

## 24.3 Concurrent modification

Normal TreeMap is not thread-safe. Mutating during iteration can cause CME.

## 24.4 Boundary copy

```java
Map<K,V> snapshot = Map.copyOf(map.subMap(...));
```

But copy may not preserve sort/order contract as NavigableMap. If order matters as list output, copy entries to list.

## 24.5 Rule

Treat range views as powerful internal tools, not safe snapshots.

---

# 25. TreeMap as Time Index

## 25.1 Effective rule lookup

```java
NavigableMap<Instant, Rule> rulesByEffectiveAt = new TreeMap<>();
```

Find current:

```java
Rule current = rulesByEffectiveAt.floorEntry(now).getValue();
```

## 25.2 Expired cleanup

```java
rulesByEffectiveAt.headMap(cutoff, false).clear();
```

## 25.3 Window query

```java
rulesByEffectiveAt.subMap(start, true, end, false)
```

## 25.4 Duplicate timestamp

If multiple events can share same time, value should be collection:

```java
NavigableMap<Instant, List<Event>>
```

or key includes sequence:

```java
record EventKey(Instant time, long sequence) {}
```

## 25.5 Rule

TreeMap is excellent for time-indexed state when time ordering drives queries.

---

# 26. TreeMap as Rule Table

## 26.1 Threshold rules

Example tax bracket:

```java
NavigableMap<BigDecimal, TaxRate> bracketByMinimum = new TreeMap<>();
```

Lookup:

```java
TaxRate rateFor(BigDecimal amount) {
    Map.Entry<BigDecimal, TaxRate> entry = bracketByMinimum.floorEntry(amount);
    if (entry == null) {
        throw new IllegalArgumentException("below minimum");
    }
    return entry.getValue();
}
```

## 26.2 Version rules

```java
NavigableMap<Integer, FeatureRule> rulesByVersion;
rulesByVersion.floorEntry(clientVersion)
```

## 26.3 Priority cutoff

```java
thresholds.ceilingEntry(score)
```

## 26.4 Rule

If domain says “greatest threshold not exceeding X”, use NavigableMap.

---

# 27. TreeSet as Ordered Unique Collection

## 27.1 Example

```java
NavigableSet<CasePriority> priorities = new TreeSet<>();
```

## 27.2 Range

```java
priorities.tailSet(minPriority, true)
```

## 27.3 Nearest

```java
priorities.ceiling(requestedPriority)
```

## 27.4 Duplicate comparator issue

If comparator only compares priority score, different objects with same score collapse.

## 27.5 Rule

TreeSet is for unique values according to ordering, not merely sorted display list.

---

# 28. Tree Structures vs Hash Structures

| Need | HashMap/HashSet | TreeMap/TreeSet |
|---|---|---|
| exact lookup | usually faster expected O(1) | O(log n) |
| sorted traversal | no | yes |
| range query | no | yes |
| nearest lookup | no | yes |
| order by comparator | no | yes |
| memory per entry | usually lower than tree? still node-heavy | tree node overhead |
| depends on hashCode | yes | no |
| depends on comparator | no | yes |

## 28.1 Rule

Hash for equality lookup. Tree for ordered navigation.

---

# 29. Tree Structures vs Sorted List

Sometimes a sorted `ArrayList` is better.

## 29.1 Sorted list strengths

- compact memory;
- fast iteration;
- binary search O(log n);
- good cache locality.

## 29.2 Sorted list weaknesses

- insertion/removal O(n);
- maintaining sorted order costly if frequent mutations.

## 29.3 Tree strengths

- O(log n) insert/remove/lookup;
- live range views;
- nearest lookup;
- sorted dynamically.

## 29.4 Rule

Use sorted list for mostly-read, rarely-mutated sorted data. Use tree for dynamic sorted updates/ranges.

---

# 30. Tree Structures and Streams

## 30.1 Sorted source

TreeSet/TreeMap views provide ordered traversal.

```java
treeSet.stream()
```

encounter order is sorted order.

## 30.2 Avoid redundant sorting

```java
treeSet.stream().sorted()
```

often redundant.

## 30.3 Range stream

```java
map.subMap(start, true, end, false)
   .values()
   .stream()
```

## 30.4 Collecting to TreeMap

```java
Collectors.toMap(
    keyMapper,
    valueMapper,
    merge,
    TreeMap::new
)
```

## 30.5 Rule

Use tree range views before streaming to reduce data early.

---

# 31. Tree Structures and Sequenced APIs

Java 21 sequenced APIs made first/last/reversed concepts more uniform.

## 31.1 TreeSet

Sorted/navigable sets have encounter order.

## 31.2 TreeMap

Navigable maps have sorted key encounter order.

## 31.3 But navigable methods remain richer

Sequenced gives:

- first;
- last;
- reversed.

Navigable gives:

- lower;
- floor;
- ceiling;
- higher;
- sub range.

## 31.4 Rule

Sequenced is common order contract; Navigable is ordered search/navigation contract.

---

# 32. Memory and CPU Cost

## 32.1 Per node overhead

TreeMap node has:

- key;
- value;
- left;
- right;
- parent;
- color;
- object header.

## 32.2 Pointer chasing

Tree traversal jumps through nodes, less cache-friendly than arrays.

## 32.3 Comparator calls

Every operation performs multiple comparisons.

## 32.4 Good enough

For many business applications, O(log n) and sorted/range power are worth the cost.

## 32.5 Rule

Tree structures trade memory/CPU overhead for ordered navigation.

---

# 33. Concurrency

TreeMap and TreeSet are not synchronized.

## 33.1 Concurrent mutation unsafe

Use external synchronization or concurrent sorted map.

## 33.2 Concurrent sorted alternative

```java
ConcurrentSkipListMap
ConcurrentSkipListSet
```

These provide concurrent sorted/navigable behavior with different performance/consistency trade-offs.

## 33.3 Immutable snapshot

For read-mostly:

```java
volatile NavigableMap<K,V> snapshot = new TreeMap<>();
```

Better publish unmodifiable copy/wrapper carefully.

## 33.4 Rule

Use TreeMap/TreeSet for single-threaded or externally synchronized sorted structures.

---

# 34. Production Diagnostics

When tree collection behaves oddly:

## 34.1 Check comparator

- too weak?
- inconsistent with equals?
- depends on mutable field?
- handles null?
- expensive?
- non-transitive?

## 34.2 Check key mutation

If key fields used in comparator mutate, tree invariants logical order becomes invalid.

## 34.3 Check range bounds

Inclusive/exclusive errors.

## 34.4 Check live view

SubMap mutation affects original.

## 34.5 Check performance

Comparator cost, tree size, range scan volume.

## 34.6 Check concurrency

Unsafe mutation during iteration.

## 34.7 Rule

Most TreeMap/TreeSet bugs are comparator or live-view bugs.

---

# 35. Production Failure Modes

## 35.1 Comparator too weak drops data

Fix: add tie-breaker.

## 35.2 Comparator inconsistent with equals

Fix: align or document intentionally.

## 35.3 Mutable key/element changes order

Fix: immutable keys/elements or remove/reinsert after mutation.

## 35.4 Null key NPE

Fix: reject null or null-aware comparator.

## 35.5 Range boundary off-by-one

Fix: explicit inclusive/exclusive tests.

## 35.6 subMap live view mutation surprise

Fix: snapshot copy when crossing boundary.

## 35.7 Descending view assumed copy

Fix: document live view or copy.

## 35.8 Using TreeMap for plain lookup hot path

Fix: HashMap if no order/range needed.

## 35.9 Using HashMap then sorting every time

Fix: TreeMap if sorted view needed frequently.

## 35.10 Expensive comparator in large tree

Fix: canonicalize/precompute sort key.

## 35.11 Duplicate timestamp overwrites event

Fix: map value as list or composite key.

## 35.12 Concurrent mutation

Fix: lock/snapshot/ConcurrentSkipListMap.

## 35.13 Polling from TreeSet loses equal-comparator items

Fix: comparator includes unique tie-breaker.

## 35.14 BigDecimal TreeSet vs HashSet mismatch

Fix: domain amount canonicalization.

---

# 36. Best Practices

## 36.1 Comparator design

- stable;
- transitive;
- deterministic;
- includes tie-breaker if used in TreeSet/TreeMap;
- cheap;
- null policy explicit;
- consistent with equals unless intentionally not.

## 36.2 Key/element design

- immutable with respect to comparator fields;
- canonicalized;
- no mutable entities as tree keys.

## 36.3 Range query

- prefer half-open `[start, end)` for time windows;
- test boundaries;
- use range view before streaming/filtering.

## 36.4 API

- type as NavigableMap/NavigableSet when navigation needed;
- return snapshots across boundaries;
- do not expose live subMap unintentionally.

## 36.5 Performance

- use HashMap for exact lookup;
- use sorted list for mostly-read sorted small data;
- use TreeMap for dynamic sorted/range data;
- precompute expensive sort keys.

---

# 37. Decision Matrix

| Requirement | Recommended |
|---|---|
| exact key lookup only | `HashMap` |
| sorted map by key | `TreeMap` |
| sorted set | `TreeSet` |
| nearest key <= x | `NavigableMap.floorEntry` |
| nearest key >= x | `NavigableMap.ceilingEntry` |
| values in key range | `subMap` |
| elements in range | `subSet` |
| remove expired by time | `headMap(cutoff).clear()` |
| deterministic insertion order | `LinkedHashMap` / `LinkedHashSet` |
| dynamic sorted updates | `TreeMap` / `TreeSet` |
| mostly-read sorted data | sorted `ArrayList` + binary search |
| concurrent sorted map | `ConcurrentSkipListMap` |
| enum key ordering | `EnumMap` if enum order enough |
| comparator-based unique display | be careful; maybe List sort |
| duplicate order key allowed | composite key or map to collection |
| reverse sorted view | `descendingMap` / `descendingSet` |
| public range result | copy snapshot |

---

# 38. Latihan

## Latihan 1 — Comparator Identity Bug

Create `TreeSet<Person>` comparator by age only.

Add two persons same age.

Fix with ID tie-breaker.

## Latihan 2 — BigDecimal Set Difference

Compare:

```java
HashSet<BigDecimal>
TreeSet<BigDecimal>
```

with `1.0` and `1.00`.

Explain.

## Latihan 3 — Rule Lookup

Implement:

```java
NavigableMap<Instant, Rule>
Rule activeAt(Instant time)
```

using `floorEntry`.

## Latihan 4 — Time Window

Given `NavigableMap<Instant, Event>`, return events in `[start, end)`.

## Latihan 5 — Expired Cleanup

Remove all entries older than cutoff using `headMap(...).clear()`.

## Latihan 6 — Range Boundary Tests

Write tests for inclusive/exclusive subMap boundaries.

## Latihan 7 — Mutable Key

Use mutable field in comparator, insert into TreeSet, mutate field.

Observe contains/order issues.

## Latihan 8 — Sorted List vs TreeSet

For mostly-read data, compare sorted ArrayList + binarySearch vs TreeSet.

## Latihan 9 — Duplicate Timestamp

Design key/value model for multiple events at same Instant.

## Latihan 10 — API Snapshot

Expose range query result safely without leaking live subMap.

---

# 39. Ringkasan

Tree structures are ordered search/navigation collections.

Core lessons:

- `TreeMap` is Red-Black tree based `NavigableMap`.
- `TreeSet` is `NavigableSet` based on TreeMap.
- Tree collections are sorted by natural ordering or comparator.
- Basic operations are guaranteed O(log n).
- Comparator defines identity in TreeMap/TreeSet.
- Comparator consistency with equals matters.
- Navigable APIs provide floor/ceiling/lower/higher.
- Range views are live bounded views.
- Inclusive/exclusive boundaries must be tested.
- TreeMap is excellent for time indexes and threshold rule tables.
- TreeSet is ordered unique by comparator.
- Tree structures trade memory/CPU for ordered navigation.
- Do not use TreeMap when exact lookup only needs HashMap.
- Do not expose live range views across boundaries.
- Mutable comparator fields break tree correctness.
- Concurrent mutation requires synchronization or concurrent sorted structures.

Main rule:

```text
Use HashMap when equality lookup is the question.
Use TreeMap when ordered navigation is the question.
```

---

# 40. Referensi

1. Java SE 25 — `TreeMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/TreeMap.html

2. Java SE 25 — `TreeSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/TreeSet.html

3. Java SE 25 — `SortedMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SortedMap.html

4. Java SE 25 — `NavigableMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/NavigableMap.html

5. Java SE 25 — `SortedSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SortedSet.html

6. Java SE 25 — `NavigableSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/NavigableSet.html

7. Java SE 25 — `Comparator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Comparator.html

8. OpenJDK — `TreeMap.java` Source  
   https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/TreeMap.java

9. dev.java — Keeping Keys Sorted with SortedMap and NavigableMap  
   https://dev.java/learn/keeping-keys-sorted-with-sortedmap-and-navigablemap/

10. Java SE 25 — `ConcurrentSkipListMap`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentSkipListMap.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-016.md](./learn-java-collections-and-streams-part-016.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-018.md](./learn-java-collections-and-streams-part-018.md)
