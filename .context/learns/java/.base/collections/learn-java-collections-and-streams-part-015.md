# learn-java-collections-and-streams-part-015.md

# Java Collections and Streams — Part 015  
# HashMap Internals Deep Dive: Table, Node, Hash Spreading, Capacity, Load Factor, Threshold, Resize, Collision, Tree Bin, Mutable Keys, and Production Diagnostics

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **015**  
> Fokus: memahami `HashMap` dari dalam: bagaimana key menjadi bucket index, bagaimana `put/get/remove` bekerja, apa itu capacity/load factor/threshold, kenapa capacity power-of-two, bagaimana collision diselesaikan, kapan bin berubah menjadi tree, bagaimana resize bekerja, kenapa mutable key berbahaya, bagaimana iteration cost terjadi, dan bagaimana mendiagnosis problem HashMap di production.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: HashMap adalah Indexed Association Table](#2-mental-model-hashmap-adalah-indexed-association-table)
3. [Public Contract vs Internal Implementation](#3-public-contract-vs-internal-implementation)
4. [Core Fields Conceptually](#4-core-fields-conceptually)
5. [Capacity, Table, and Power-of-Two](#5-capacity-table-and-power-of-two)
6. [Load Factor and Threshold](#6-load-factor-and-threshold)
7. [Lazy Table Allocation](#7-lazy-table-allocation)
8. [Hash Code and Hash Spreading](#8-hash-code-and-hash-spreading)
9. [Bucket Index Calculation](#9-bucket-index-calculation)
10. [Node Structure](#10-node-structure)
11. [`put` Algorithm Mental Model](#11-put-algorithm-mental-model)
12. [`get` Algorithm Mental Model](#12-get-algorithm-mental-model)
13. [`remove` Algorithm Mental Model](#13-remove-algorithm-mental-model)
14. [Collision Handling](#14-collision-handling)
15. [Tree Bins](#15-tree-bins)
16. [TREEIFY, UNTREEIFY, and MIN_TREEIFY_CAPACITY](#16-treeify-untreeify-and-min_treeify_capacity)
17. [Resize Mechanics](#17-resize-mechanics)
18. [Why Resize Can Preserve/Split Bin Order Efficiently](#18-why-resize-can-preservesplit-bin-order-efficiently)
19. [Iteration Cost](#19-iteration-cost)
20. [Null Key and Null Values](#20-null-key-and-null-values)
21. [Mutable Key Disaster](#21-mutable-key-disaster)
22. [Equals/HashCode Contract in HashMap](#22-equalshashcode-contract-in-hashmap)
23. [Hash Collisions and Poor Key Design](#23-hash-collisions-and-poor-key-design)
24. [Initial Capacity Sizing](#24-initial-capacity-sizing)
25. [Load Factor Tuning](#25-load-factor-tuning)
26. [HashMap vs LinkedHashMap vs TreeMap vs ConcurrentHashMap](#26-hashmap-vs-linkedhashmap-vs-treemap-vs-concurrenthashmap)
27. [HashMap in Streams and Collectors](#27-hashmap-in-streams-and-collectors)
28. [HashMap as Cache: Why Dangerous by Default](#28-hashmap-as-cache-why-dangerous-by-default)
29. [Memory Footprint](#29-memory-footprint)
30. [Concurrency Hazards](#30-concurrency-hazards)
31. [HashMap and Serialization/Cloning](#31-hashmap-and-serializationcloning)
32. [Production Diagnostics](#32-production-diagnostics)
33. [Production Failure Modes](#33-production-failure-modes)
34. [Best Practices](#34-best-practices)
35. [Decision Matrix](#35-decision-matrix)
36. [Latihan](#36-latihan)
37. [Ringkasan](#37-ringkasan)
38. [Referensi](#38-referensi)

---

# 1. Tujuan Bagian Ini

`HashMap` adalah salah satu class paling sering digunakan di Java.

Tetapi banyak developer hanya memahami:

```text
HashMap get/put O(1)
```

Padahal untuk production-grade engineering, kamu perlu memahami:

```text
Apa arti expected O(1)?
Apa itu bucket?
Apa itu capacity?
Apa itu load factor?
Kapan resize?
Apa yang terjadi saat collision?
Kenapa mutable key membuat lookup hilang?
Kenapa HashMap iteration bisa mahal jika capacity terlalu besar?
Kenapa initial capacity bukan jumlah maksimum entry?
Apa dampak hashCode buruk?
Kapan tree bin muncul?
Kenapa HashMap bukan cache production?
Kenapa HashMap bukan thread-safe?
```

Tujuan bagian ini:

- membangun model internal HashMap;
- memahami cost dan failure mode;
- tahu cara sizing;
- tahu kapan HashMap tepat/tidak;
- tahu bagaimana mendiagnosis problem HashMap.

---

# 2. Mental Model: HashMap adalah Indexed Association Table

`HashMap<K,V>` menyimpan association:

```text
key -> value
```

Tetapi secara internal mental model-nya:

```text
array of buckets
bucket contains zero/one/many entries
entry contains hash, key, value, next
```

Simplified:

```text
table
  [0] -> null
  [1] -> Node(hash, keyA, valueA, next)
  [2] -> null
  [3] -> Node(hash, keyB, valueB, next -> Node(hash, keyC, valueC))
```

## 2.1 Key converted to bucket

```text
key.hashCode()
    -> hash spreading
    -> bucket index
    -> scan bin
    -> equals check
```

## 2.2 Main promise

If hash distribution is good:

```text
most buckets have few entries
lookup is expected constant time
```

## 2.3 Important caveat

Expected O(1) is not guaranteed O(1).

It depends on:

- hash quality;
- collision rate;
- map size;
- capacity;
- key equality cost;
- memory/cache behavior.

## 2.4 Rule

```text
HashMap is fast because it converts key equality search into bucket-local search.
```

---

# 3. Public Contract vs Internal Implementation

Public contract:

```java
Map<K,V>
```

says:

- unique keys;
- each key maps to at most one value;
- `put` associates;
- `get` retrieves;
- `remove` deletes;
- `containsKey` checks key;
- no ordering guarantee for HashMap.

Internal implementation can change between JDK versions.

## 3.1 Why study internals?

Not to depend on private fields, but to understand:

- performance;
- memory;
- failure modes;
- sizing;
- hashing;
- iteration;
- collision behavior.

## 3.2 Do not rely on internals as API

Never write code that depends on:

- exact bucket order;
- exact treeify threshold;
- exact table capacity;
- iteration order;
- internal class names.

## 3.3 Stable enough mental model

The high-level hash table model is stable and useful.

## 3.4 Rule

Use internals for reasoning, not for external contract.

---

# 4. Core Fields Conceptually

A HashMap conceptually has:

```java
Node<K,V>[] table;
int size;
int threshold;
float loadFactor;
int modCount;
```

## 4.1 table

Array of buckets.

Each bucket can be:

- empty;
- linked list of nodes;
- tree bin.

## 4.2 size

Number of key-value mappings.

## 4.3 threshold

When size exceeds threshold, map resizes.

Conceptually:

```text
threshold = capacity * loadFactor
```

after table is allocated.

## 4.4 loadFactor

Controls density before resize.

Default is 0.75.

## 4.5 modCount

Tracks structural modifications for fail-fast iterators/spliterators.

## 4.6 Rule

HashMap performance is largely table size + distribution + resize behavior.

---

# 5. Capacity, Table, and Power-of-Two

Capacity is the number of buckets in the internal table.

## 5.1 Not size

```text
size = number of mappings
capacity = number of buckets
```

## 5.2 Power of two

HashMap table capacity is power-of-two internally.

This enables efficient bucket calculation:

```java
index = (capacity - 1) & hash
```

instead of modulo.

## 5.3 Why power-of-two matters

If capacity is power of two, bit masking picks lower bits.

HashMap uses hash spreading to mix high bits into lower bits.

## 5.4 Initial capacity constructor

```java
new HashMap<>(100)
```

does not mean exactly 100 entries without resize.

It means initial capacity request, adjusted internally to a power-of-two table capacity when allocated.

## 5.5 Rule

Capacity is bucket count, not maximum entry count.

---

# 6. Load Factor and Threshold

The load factor controls how full table may become before resize.

Default:

```java
0.75f
```

## 6.1 Threshold

Conceptually:

```java
threshold = capacity * loadFactor
```

If capacity = 16 and load factor = 0.75:

```text
threshold = 12
```

After adding 13th entry, resize.

## 6.2 Trade-off

Higher load factor:

- less memory;
- more collisions;
- slower lookup potentially.

Lower load factor:

- more memory;
- fewer collisions;
- faster lookup potentially;
- iteration over HashMap may cost more due to larger capacity.

## 6.3 Default is usually good

The default load factor offers a good general trade-off.

## 6.4 Rule

Tune load factor only with measured reason.

---

# 7. Lazy Table Allocation

A newly created HashMap may not allocate table immediately.

```java
Map<K,V> map = new HashMap<>();
```

The table is allocated on first insertion.

## 7.1 Why

Avoid allocating buckets for maps that remain empty.

## 7.2 Constructor threshold nuance

When you pass initial capacity, HashMap may store sizing intent before actual table allocation.

## 7.3 Practical implication

A million empty HashMaps are still not free, but lazy table avoids large table allocations until needed.

## 7.4 Rule

HashMap separates object creation from bucket table allocation.

---

# 8. Hash Code and Hash Spreading

User key provides:

```java
key.hashCode()
```

HashMap then applies internal hash spreading.

## 8.1 Why spreading?

Bucket index uses lower bits:

```java
(capacity - 1) & hash
```

If key hash has poor lower-bit distribution, buckets cluster.

Hash spreading mixes high bits into low bits.

## 8.2 Not a replacement for good hashCode

HashMap spreading helps, but cannot fully fix terrible hash functions.

Bad:

```java
@Override
public int hashCode() {
    return 1;
}
```

All keys still collide.

## 8.3 String keys

String hash is generally decent and cached.

## 8.4 Composite records

Record-generated hash is usually fine for normal use, but ensure components are stable and equality-safe.

## 8.5 Rule

HashMap improves hash distribution, but key hashCode still matters.

---

# 9. Bucket Index Calculation

Conceptually:

```java
int h = spread(key.hashCode());
int index = (table.length - 1) & h;
```

## 9.1 Null key

For null key, hash is treated specially, effectively bucket 0.

## 9.2 Why not modulo?

Modulo can be slower.

Power-of-two capacity allows bit mask.

## 9.3 Example

If capacity = 16:

```java
index = 15 & hash
```

Only low 4 bits choose bucket.

## 9.4 Why hash spreading matters

If low bits are poor, many keys go same bucket.

## 9.5 Rule

Bucket index is cheap because capacity is power-of-two and hash is masked.

---

# 10. Node Structure

A regular HashMap node conceptually stores:

```java
int hash;
K key;
V value;
Node<K,V> next;
```

## 10.1 hash

Stored so HashMap does not recompute for every comparison in bin.

## 10.2 key

The map key reference.

## 10.3 value

The associated value.

## 10.4 next

Next node in same bucket chain.

## 10.5 TreeNode

When bin treeifies, nodes become tree nodes with extra links/metadata.

## 10.6 Rule

Each mapping is an object node, not just a pair in a flat array.

---

# 11. `put` Algorithm Mental Model

Code:

```java
map.put(key, value);
```

Conceptual steps:

1. compute hash;
2. allocate table if needed;
3. compute bucket index;
4. if bucket empty, insert new node;
5. if first node matches key, replace value;
6. otherwise scan linked list/tree;
7. if matching key found, replace value;
8. if not found, append/add new node;
9. maybe treeify bin;
10. increment size;
11. if size exceeds threshold, resize.

## 11.1 Match condition

Key match if:

```java
node.hash == hash
&& (node.key == key || key.equals(node.key))
```

with null-safe handling.

## 11.2 Return value

`put` returns previous value or null.

Ambiguous if previous value was null.

## 11.3 Structural modification

New key insertion changes structure and increments modCount.

Replacing value for existing key generally not structural.

## 11.4 Rule

`put` is lookup plus insert/replace plus possible resize.

---

# 12. `get` Algorithm Mental Model

Code:

```java
V value = map.get(key);
```

Conceptual steps:

1. compute hash;
2. if table empty, return null;
3. compute bucket index;
4. inspect first node;
5. if key matches, return value;
6. if bin is tree, tree lookup;
7. else scan chain;
8. if not found, return null.

## 12.1 Cost

Expected O(1) if bin length small.

Worst-case depends on collision structure.

## 12.2 Value null ambiguity

Return null can mean:

- no mapping;
- mapping exists with null value.

Use:

```java
containsKey
```

if null values allowed.

## 12.3 Rule

`get` is fast when hash distribution and key equality are good.

---

# 13. `remove` Algorithm Mental Model

Code:

```java
map.remove(key);
```

Conceptual steps:

1. compute hash;
2. locate bucket;
3. find matching node/tree node;
4. unlink/remove it;
5. decrement size;
6. increment modCount;
7. return old value or null.

## 13.1 Remove by key/value

```java
map.remove(key, value)
```

removes only if currently mapped to value.

## 13.2 Iterator remove

Removing via map view iterator is safe during iteration.

## 13.3 Rule

Remove cost follows lookup cost plus unlink cost.

---

# 14. Collision Handling

Collision means multiple different keys map to same bucket index.

## 14.1 Collision is normal

Some collisions are expected.

## 14.2 Linked bin

Initially, colliding entries form linked chain.

```text
bucket[i] -> nodeA -> nodeB -> nodeC
```

## 14.3 Lookup in linked bin

Scan nodes and compare hash/key.

## 14.4 Too many collisions

Long chain hurts performance.

## 14.5 Tree bin

Modern HashMap can transform long bin into tree to improve lookup.

## 14.6 Rule

Good hash distribution keeps bins short.

---

# 15. Tree Bins

When a bucket becomes too crowded and table is large enough, HashMap can convert that bin from linked list to tree nodes.

## 15.1 Purpose

Improve worst-case lookup from linear in bin length to logarithmic in bin size.

## 15.2 Not all collisions immediately treeify

HashMap may prefer resize first if table too small.

Because collisions may be due to insufficient capacity rather than bad hashes.

## 15.3 Tree ordering

Tree bins are ordered by hash and tie-breakers/comparable behavior internally.

## 15.4 Internal detail

Do not depend on tree bin behavior externally.

## 15.5 Rule

Tree bins are collision mitigation, not excuse for bad hashCode.

---

# 16. TREEIFY, UNTREEIFY, and MIN_TREEIFY_CAPACITY

OpenJDK HashMap source defines internal constants such as:

```text
TREEIFY_THRESHOLD
UNTREEIFY_THRESHOLD
MIN_TREEIFY_CAPACITY
```

Historically values are commonly:

```text
8
6
64
```

## 16.1 TREEIFY_THRESHOLD

If bin count exceeds this threshold, bin may treeify.

## 16.2 MIN_TREEIFY_CAPACITY

If table capacity is below minimum, HashMap resizes instead of treeifying.

## 16.3 UNTREEIFY_THRESHOLD

During resize/removal, small tree bins may convert back to linked bins.

## 16.4 Why mention?

Understanding these explains:

```text
collision bin does not always become tree immediately.
```

## 16.5 Do not code against constants

These are implementation details.

## 16.6 Rule

Treeification is a safety mechanism for overpopulated bins when resizing is no longer the better answer.

---

# 17. Resize Mechanics

Resize happens when size exceeds threshold.

## 17.1 New capacity

Typically table capacity doubles.

```text
16 -> 32 -> 64 -> 128
```

## 17.2 New threshold

Adjusted based on new capacity and load factor.

## 17.3 Rehash?

Modern HashMap resizing can redistribute entries efficiently using old capacity bit.

It does not necessarily recompute full hashCode for every key because stored hash exists.

## 17.4 Cost

Resize is O(n) over existing entries.

## 17.5 Latency spike

A single `put` may trigger resize and pay large cost.

## 17.6 Rule

Pre-size large maps to reduce resize spikes.

---

# 18. Why Resize Can Preserve/Split Bin Order Efficiently

Because capacity doubles, each old bucket splits into at most two new buckets.

If old capacity is `oldCap`, then an entry either stays at same index or moves to:

```text
oldIndex + oldCap
```

depending on one hash bit.

## 18.1 Conceptual

Old table length 16.

Bucket 5 entries can go to:

```text
5
or
21
```

in new table length 32.

## 18.2 Why efficient

No full modulo needed.

Use hash bit:

```java
(hash & oldCap)
```

## 18.3 Benefit

Preserves relative order within split groups and reduces work.

## 18.4 Rule

Power-of-two capacity enables efficient resizing.

---

# 19. Iteration Cost

HashMap does not guarantee iteration order.

## 19.1 Iteration over views

```java
map.keySet()
map.values()
map.entrySet()
```

Iterator scans table buckets and nodes.

## 19.2 Cost

HashMap docs state iteration over collection views requires time proportional to capacity plus size.

## 19.3 Over-sizing danger

A map with size 10 but capacity 1,048,576 can be slow to iterate.

## 19.4 LinkedHashMap difference

LinkedHashMap maintains linked order, often making iteration predictable and not tied the same way to unused capacity.

## 19.5 Rule

Do not massively over-size HashMap if you iterate it often.

---

# 20. Null Key and Null Values

HashMap permits:

- one null key;
- multiple null values.

## 20.1 Null key

Stored in special bucket logic, conceptually bucket 0.

## 20.2 Null values

Allowed.

```java
map.put("A", null);
```

## 20.3 Ambiguous get

```java
map.get("A") == null
map.get("missing") == null
```

Both true.

## 20.4 Prefer null-free values

Unless null has explicit meaning.

## 20.5 Rule

HashMap supports null, but null often weakens map semantics.

---

# 21. Mutable Key Disaster

This is the most common serious HashMap bug.

## 21.1 Example

```java
final class UserKey {
    private String email;

    UserKey(String email) {
        this.email = email;
    }

    void setEmail(String email) {
        this.email = email;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof UserKey other
            && Objects.equals(email, other.email);
    }

    @Override
    public int hashCode() {
        return Objects.hash(email);
    }
}
```

Usage:

```java
UserKey key = new UserKey("a@example.com");
Map<UserKey, String> map = new HashMap<>();

map.put(key, "session");

key.setEmail("b@example.com");

map.get(key); // likely null
map.containsKey(key); // likely false
```

## 21.2 Why

Entry is stored in bucket based on old hash.

Lookup uses new hash and goes to different bucket.

## 21.3 Worse

The entry still exists but is hard to find/remove normally.

## 21.4 Fix

Use immutable keys:

```java
record UserKey(String email) {
    UserKey {
        email = email.strip().toLowerCase(Locale.ROOT);
    }
}
```

## 21.5 Rule

HashMap keys must be immutable with respect to equals/hashCode.

---

# 22. Equals/HashCode Contract in HashMap

HashMap correctness depends on:

```text
if a.equals(b), then a.hashCode() == b.hashCode()
```

## 22.1 If equals true but hash different

Map may store “duplicate equal” keys in different buckets.

## 22.2 If hash same but equals false

Collision only; map still works but slower.

## 22.3 If equals unstable

Lookup behavior unstable.

## 22.4 If hash expensive

Lookup cost high.

## 22.5 Rule

HashMap is only as correct as key equality/hash contract.

---

# 23. Hash Collisions and Poor Key Design

## 23.1 Constant hash

```java
@Override
public int hashCode() {
    return 1;
}
```

All keys collide.

## 23.2 Deep hash

```java
hashCode() traverses large list every time
```

May be correct but slow.

## 23.3 Case-insensitive key

Bad if equals ignores case but hashCode does not.

Better canonicalize.

## 23.4 Composite string key

```java
tenantId + ":" + caseId
```

can allocate strings and risk delimiter ambiguity.

Better:

```java
record TenantCaseKey(TenantId tenantId, CaseId caseId) {}
```

## 23.5 Rule

Design keys as small immutable canonical value objects.

---

# 24. Initial Capacity Sizing

You often know expected entry count.

But constructor capacity is bucket capacity, not exact entry count.

## 24.1 Formula mental model

To store expected entries without resize at load factor 0.75:

```text
neededCapacity = ceil(expectedEntries / loadFactor)
```

Then HashMap rounds to power of two internally.

## 24.2 Example

Need 1000 entries.

```text
1000 / 0.75 = 1333.33
next power of two = 2048
```

So capacity around 2048.

## 24.3 Naive

```java
new HashMap<>(1000)
```

may resize before 1000 entries because threshold at capacity 1024 * 0.75 = 768.

## 24.4 Newer JDK helper

Modern JDKs include factory methods like `HashMap.newHashMap(int)` in some versions/APIs to create map suitable for expected number of mappings. Check target JDK.

## 24.5 Rule

If you pass constructor initial capacity, remember it is bucket capacity intent, not expected mapping count.

---

# 25. Load Factor Tuning

Default 0.75 is usually right.

## 25.1 Higher load factor

```java
new HashMap<>(capacity, 1.0f)
```

Pros:

- less table memory.

Cons:

- more collisions;
- potentially slower lookup;
- denser bins.

## 25.2 Lower load factor

```java
new HashMap<>(capacity, 0.5f)
```

Pros:

- fewer collisions.

Cons:

- more memory;
- bigger table;
- iteration may cost more.

## 25.3 When tune?

Rarely.

Only when:

- huge maps;
- measured collision/latency/memory issue;
- stable workload;
- benchmarked with realistic keys.

## 25.4 Rule

Tune capacity more often than load factor.

---

# 26. HashMap vs LinkedHashMap vs TreeMap vs ConcurrentHashMap

## 26.1 HashMap

Use when:

- key lookup;
- no order;
- single-thread/externally synchronized;
- null support acceptable.

## 26.2 LinkedHashMap

Use when:

- predictable iteration order;
- insertion/access order;
- simple LRU pattern.

## 26.3 TreeMap

Use when:

- sorted keys;
- range/nearest operations.

## 26.4 ConcurrentHashMap

Use when:

- concurrent access/update;
- null keys/values not needed;
- weakly consistent iteration acceptable.

## 26.5 Rule

HashMap is not universal Map. Choose by ordering/concurrency/range/null requirements.

---

# 27. HashMap in Streams and Collectors

Collectors often produce HashMap by default.

## 27.1 toMap

```java
Map<K,V> map = stream.collect(Collectors.toMap(k, v));
```

Usually returns a HashMap-like map, but do not rely beyond Collector contract unless supplier specified.

## 27.2 Duplicate key

Default `toMap` throws if duplicate key.

## 27.3 Ordering

If encounter order matters:

```java
Collectors.toMap(
    keyMapper,
    valueMapper,
    mergeFunction,
    LinkedHashMap::new
)
```

## 27.4 groupingBy

Default groupingBy uses a Map implementation internally, commonly HashMap.

If map type matters:

```java
groupingBy(classifier, LinkedHashMap::new, downstream)
```

## 27.5 Rule

Specify map supplier when map type/order matters.

---

# 28. HashMap as Cache: Why Dangerous by Default

A plain HashMap cache:

```java
Map<Key, Value> cache = new HashMap<>();
```

lacks:

- max size;
- eviction;
- TTL;
- concurrency;
- stats;
- invalidation;
- memory bounds;
- weak/soft policy;
- refresh policy.

## 28.1 Unbounded growth

Can become memory leak.

## 28.2 Mutable keys/values

Can corrupt cache lookup or leak mutation.

## 28.3 Concurrency

HashMap not thread-safe.

## 28.4 Better

Use:

- bounded cache library;
- LinkedHashMap with removeEldestEntry for simple local LRU;
- ConcurrentHashMap with explicit policy;
- Caffeine/Guava where allowed.

## 28.5 Rule

HashMap can store cached values, but it is not a cache policy.

---

# 29. Memory Footprint

Each mapping has overhead:

```text
table reference slot
Node object
key reference
value reference
hash int
next reference
object header/alignment
```

## 29.1 Large maps

For millions of entries, overhead matters.

## 29.2 Boxed keys

```java
Map<Integer, V>
```

may allocate many Integer keys if not cached.

## 29.3 String keys

Strings carry their own memory.

## 29.4 Composite keys

Records are objects too, but often better than concatenated strings for correctness.

## 29.5 Rule

For huge maps, memory footprint is architecture-level concern.

---

# 30. Concurrency Hazards

HashMap is not synchronized.

## 30.1 Concurrent reads

Concurrent reads may be okay only if map is safely published and never mutated afterward.

## 30.2 Concurrent mutation

Unsafe.

Can cause:

- lost updates;
- inconsistent reads;
- ConcurrentModificationException during iteration;
- data races;
- undefined behavior under Java Memory Model.

## 30.3 Safe patterns

Immutable snapshot:

```java
volatile Map<K,V> snapshot = Map.of();

void reload(Map<K,V> newData) {
    snapshot = Map.copyOf(newData);
}
```

Concurrent map:

```java
ConcurrentHashMap<K,V>
```

External lock:

```java
synchronized (lock) { ... }
```

## 30.4 Rule

Use HashMap for single-threaded or safely-published immutable use, not concurrent mutation.

---

# 31. HashMap and Serialization/Cloning

HashMap implements Serializable and Cloneable.

## 31.1 Clone

Shallow copy.

Keys/values are not cloned.

## 31.2 Serialization

Serializes mappings, not internal table exactly as external contract.

## 31.3 Risks

- mutable values shared after clone;
- serialization compatibility;
- security validation;
- huge map payloads.

## 31.4 Rule

Prefer explicit copy/mapping over relying on clone/serialization for domain boundaries.

---

# 32. Production Diagnostics

When HashMap suspected:

## 32.1 Check size

```java
map.size()
```

Unexpected growth?

## 32.2 Check key type

- mutable?
- hashCode correct?
- equals correct?
- expensive?
- many collisions?

## 32.3 Check access pattern

- many get?
- many put?
- iteration?
- contains in loops?
- repeated construction?

## 32.4 Check capacity indirectly

Hard to inspect without reflection; infer from memory/iteration/resizing.

## 32.5 Check memory

Use heap dump/JFR/profiler.

Look for:

- many HashMap$Node;
- huge table arrays;
- string keys;
- boxed keys;
- retained maps.

## 32.6 Check resizing

Latency spikes during bulk put may indicate repeated resize.

Pre-size.

## 32.7 Check nulls

Map.get ambiguity.

## 32.8 Check concurrency

Unsafe mutation or need ConcurrentHashMap.

## 32.9 Rule

Diagnose key design, size, lifecycle, and access pattern before replacing HashMap.

---

# 33. Production Failure Modes

## 33.1 Mutable key lookup disappears

Fix: immutable key.

## 33.2 Bad equals/hashCode duplicate keys

Fix: implement contract and tests.

## 33.3 Poor hash causes slow lookup

Fix: key hash design/canonicalization.

## 33.4 Over-sized map slow iteration

Fix: right-size or use LinkedHashMap if order/iteration matters.

## 33.5 Under-sized map resize spikes

Fix: pre-size for expected mappings.

## 33.6 Null value ambiguity

Fix: no null values or containsKey.

## 33.7 HashMap used concurrently

Fix: ConcurrentHashMap/lock/immutable snapshot.

## 33.8 HashMap cache OOM

Fix: bounded cache/eviction.

## 33.9 Collectors.toMap duplicate key

Fix: merge function/validation.

## 33.10 Relying on iteration order

Fix: LinkedHashMap/TreeMap/List.

## 33.11 Expensive comparator wrongly solved by HashMap?

If need sorted/range, HashMap not enough. Need secondary index/tree.

## 33.12 Huge boxed primitive keys

Fix: primitive specialized structure/arrays/BitSet.

## 33.13 Composite string key collision/ambiguity

Fix: typed record key.

## 33.14 Clone shallow copy surprise

Fix: explicit deep copy if needed.

---

# 34. Best Practices

## 34.1 Key design

- immutable;
- small;
- canonical;
- stable equals/hashCode;
- no raw arrays;
- no mutable entities;
- no expensive repeated normalization.

## 34.2 Sizing

- pre-size large maps;
- avoid massive over-sizing;
- default load factor usually fine.

## 34.3 Null

- avoid null keys/values;
- use containsKey if null values intentional;
- prefer explicit absence model.

## 34.4 Ordering

- never rely on HashMap order;
- use LinkedHashMap/TreeMap when needed.

## 34.5 Concurrency

- do not mutate HashMap concurrently;
- use immutable snapshot or ConcurrentHashMap.

## 34.6 Streams

- specify map supplier if type/order matters;
- define duplicate key merge policy.

## 34.7 Cache

- do not use raw HashMap as unbounded production cache.

## 34.8 Diagnostics

- monitor size;
- profile allocation;
- inspect heap;
- test key equality/hash;
- benchmark realistic access patterns.

---

# 35. Decision Matrix

| Requirement | Recommended |
|---|---|
| general lookup, no order, single-thread | `HashMap` |
| deterministic insertion order | `LinkedHashMap` |
| access-order/LRU-ish | `LinkedHashMap(accessOrder=true)` with policy |
| sorted keys/range query | `TreeMap` / `NavigableMap` |
| concurrent lookup/update | `ConcurrentHashMap` |
| immutable snapshot | `Map.copyOf` |
| enum keys | `EnumMap` |
| identity keys | `IdentityHashMap` |
| weak keys | `WeakHashMap` |
| allow null key/value | `HashMap`, but avoid if possible |
| reject null + concurrent | `ConcurrentHashMap` |
| many expected entries | pre-size |
| unknown huge/unbounded cache | bounded cache abstraction |
| preserve stream encounter order in map | `Collectors.toMap(..., LinkedHashMap::new)` |
| duplicate key invalid | default `toMap` or explicit validation |
| duplicate key merge | `toMap` with merge function |
| multi-field key | immutable record key |
| primitive dense key set | arrays/BitSet/specialized collection |

---

# 36. Latihan

## Latihan 1 — Mutable Key Bug

Implement mutable key with `email` in equals/hashCode.

Put into HashMap, mutate email, observe `get` failure.

Refactor to immutable record.

## Latihan 2 — Initial Capacity

For expected entries:

```text
100
1000
1_000_000
```

Calculate approximate bucket capacity needed for load factor 0.75.

## Latihan 3 — Collision

Create key class with constant hashCode.

Insert many keys into HashMap.

Measure lookup vs normal key.

## Latihan 4 — Null Ambiguity

Create HashMap with present-null value.

Show difference between `get` and `containsKey`.

## Latihan 5 — Iteration Cost

Create HashMap with huge initial capacity but few entries.

Compare iteration with normal-sized HashMap.

## Latihan 6 — Stream toMap

Collect list with duplicate keys using:

1. default toMap;
2. merge keep first;
3. merge keep latest;
4. LinkedHashMap supplier.

## Latihan 7 — Composite Key

Replace string concatenated key with record key.

Test equality/hash.

## Latihan 8 — Simple LRU

Implement LinkedHashMap access-order cache with max entries.

Explain why not enough for high-concurrency cache.

## Latihan 9 — Concurrent Snapshot

Implement reloadable config:

```java
volatile Map<Key, Rule> rules
```

using `Map.copyOf`.

## Latihan 10 — Heap Diagnostics

Given heap dump showing many `HashMap$Node`, list questions to diagnose root cause.

---

# 37. Ringkasan

HashMap is simple at API level but rich internally.

Core lessons:

- HashMap maps keys to values through hash table buckets.
- Capacity is bucket count, not size.
- Size is mapping count.
- Load factor controls resize threshold.
- Default load factor 0.75 is usually good.
- Capacity is power-of-two for efficient index masking.
- HashMap spreads hash bits before indexing.
- `put` is lookup + insert/replace + possible resize.
- `get` is hash + bucket + equals/tree lookup.
- Collisions form linked bins, and crowded bins can become tree bins.
- Resize doubles capacity and redistributes entries efficiently.
- Iteration cost is proportional to size plus capacity.
- Null key/value are allowed but create ambiguity.
- Mutable keys break lookup.
- Key equals/hashCode correctness is non-negotiable.
- HashMap is not thread-safe.
- HashMap is not a full cache policy.
- Pre-size large maps to reduce resize spikes.
- Never rely on HashMap iteration order.

Main rule:

```text
HashMap performance is not magic O(1).
It is the result of good key design, good hash distribution, reasonable capacity, and correct ownership/concurrency.
```

---

# 38. Referensi

1. Java SE 25 — `HashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashMap.html

2. OpenJDK — `HashMap.java` Source  
   https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/HashMap.java

3. Java SE 25 — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

4. Java SE 25 — `LinkedHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/LinkedHashMap.html

5. Java SE 25 — `TreeMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/TreeMap.html

6. Java SE 25 — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

7. Java SE 25 — `Collectors.toMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

8. Java SE 25 — `Objects`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Objects.html

9. Java SE 25 — `Set`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Set.html

10. Java SE 25 — Collections Framework Overview  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/doc-files/coll-overview.html

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-collections-and-streams-part-014.md](./learn-java-collections-and-streams-part-014.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-collections-and-streams-part-016.md](./learn-java-collections-and-streams-part-016.md)

</div>