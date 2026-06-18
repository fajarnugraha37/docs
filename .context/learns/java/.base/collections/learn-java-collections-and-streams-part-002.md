# learn-java-collections-and-streams-part-002.md

# Java Collections and Streams — Part 002  
# Lists Deep Dive: Ordering, Indexing, Random Access, ArrayList, LinkedList, Sequenced Operations, Mutation, Memory, dan Production Trade-Offs

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **002**  
> Fokus: memahami `List` sebagai **ordered sequence with positional access**, bukan sekadar “array yang bisa grow”. Kita akan membedah semantic contract `List`, `ArrayList`, `LinkedList`, `RandomAccess`, `subList`, mutation, equality, memory locality, concurrency, API design, dan production failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: List adalah Ordered Sequence](#2-mental-model-list-adalah-ordered-sequence)
3. [`List` Contract](#3-list-contract)
4. [Kapan `List` adalah Pilihan yang Tepat](#4-kapan-list-adalah-pilihan-yang-tepat)
5. [Kapan `List` adalah Smell](#5-kapan-list-adalah-smell)
6. [Index-Based Access](#6-index-based-access)
7. [Encounter Order dan Java 21+ Sequenced Operations](#7-encounter-order-dan-java-21-sequenced-operations)
8. [`ArrayList` Mental Model](#8-arraylist-mental-model)
9. [`ArrayList` Capacity, Size, Growth, dan Memory](#9-arraylist-capacity-size-growth-dan-memory)
10. [`ArrayList` Operation Cost](#10-arraylist-operation-cost)
11. [`LinkedList` Mental Model](#11-linkedlist-mental-model)
12. [`LinkedList` Operation Cost](#12-linkedlist-operation-cost)
13. [`ArrayList` vs `LinkedList`: Real Production Trade-Off](#13-arraylist-vs-linkedlist-real-production-trade-off)
14. [`RandomAccess` Marker Interface](#14-randomaccess-marker-interface)
15. [Iteration Patterns](#15-iteration-patterns)
16. [Mutation Semantics](#16-mutation-semantics)
17. [`subList`: View, Not Independent List](#17-sublist-view-not-independent-list)
18. [`Arrays.asList` vs `List.of` vs `ArrayList`](#18-arraysaslist-vs-listof-vs-arraylist)
19. [`List.copyOf` and Defensive Copy](#19-listcopyof-and-defensive-copy)
20. [List Equality and Hashing](#20-list-equality-and-hashing)
21. [Null Elements](#21-null-elements)
22. [Lists in Records and Value Objects](#22-lists-in-records-and-value-objects)
23. [Lists as API Contract](#23-lists-as-api-contract)
24. [Lists in JSON/API/DB/Event Boundaries](#24-lists-in-jsonapidbevent-boundaries)
25. [Lists and Streams](#25-lists-and-streams)
26. [Lists and Concurrency](#26-lists-and-concurrency)
27. [CopyOnWriteArrayList Preview](#27-copyonwritearraylist-preview)
28. [Performance and Memory Cost Model](#28-performance-and-memory-cost-model)
29. [Production Failure Modes](#29-production-failure-modes)
30. [Best Practices](#30-best-practices)
31. [Decision Matrix](#31-decision-matrix)
32. [Latihan](#32-latihan)
33. [Ringkasan](#33-ringkasan)
34. [Referensi](#34-referensi)

---

# 1. Tujuan Bagian Ini

`List` adalah salah satu interface paling sering dipakai di Java.

Karena terlalu sering dipakai, banyak developer menjadikannya default untuk semua collection:

```java
List<String> permissions;
List<String> tags;
List<String> statuses;
List<CaseId> selectedCaseIds;
List<Event> events;
List<OrderLine> lines;
```

Padahal `List` membawa semantic contract tertentu:

```text
ordered sequence
positional access
duplicates generally allowed
index can be meaningful
```

Tujuan bagian ini:

- memahami `List` sebagai ordered sequence;
- memahami kapan `List` tepat dan kapan smell;
- membedah `ArrayList` dan `LinkedList`;
- memahami `RandomAccess`;
- memahami `subList` sebagai view;
- memahami mutation, defensive copy, equality, nulls;
- memahami List dalam API/DB/JSON/event boundary;
- memahami production pitfalls.

---

# 2. Mental Model: List adalah Ordered Sequence

`List` bukan hanya “bisa banyak item”.

`List` berarti:

```text
Urutan element adalah bagian dari meaning.
Element punya posisi.
Duplicate boleh, kecuali domain melarang.
```

Contoh:

```java
List<ApprovalStep> steps
```

Meaning:

```text
Step 0 terjadi sebelum step 1.
Urutan menentukan workflow.
```

Contoh lain:

```java
List<SearchResult> results
```

Meaning:

```text
Order merepresentasikan ranking/relevance/sorting.
```

Contoh yang mungkin salah:

```java
List<Permission> permissions
```

Apakah order permission penting? Apakah duplicate permission boleh?

Mungkin lebih tepat:

```java
Set<Permission>
EnumSet<Permission>
PermissionSet
```

## 2.1 List = sequence, not uniqueness

Jika ingin unique:

```java
Set<T>
```

Jika ingin ordered unique:

```java
SequencedSet<T>
LinkedHashSet<T>
```

Jika ingin sorted unique:

```java
SortedSet<T>
NavigableSet<T>
```

## 2.2 List = position can matter

Index is part of List contract:

```java
steps.get(0)
steps.add(1, step)
steps.remove(2)
```

Jika kamu tidak pernah butuh index, mungkin `SequencedCollection` atau `Iterable` cukup.

---

# 3. `List` Contract

Java SE 25 `List` mendeskripsikan `List` sebagai ordered collection atau sequence. User punya precise control di mana setiap element dimasukkan, dan bisa access element by integer index.

## 3.1 Ordered

List preserves positional order.

```java
List.of("A", "B", "C")
```

different from:

```java
List.of("C", "B", "A")
```

## 3.2 Positional access

```java
E get(int index)
E set(int index, E element)
void add(int index, E element)
E remove(int index)
```

## 3.3 Duplicate allowed

```java
List.of("A", "A", "B")
```

is valid.

## 3.4 Null may be allowed depending implementation

`ArrayList` allows null.

`List.of` does not allow null.

The interface alone does not guarantee null policy.

## 3.5 Optional operations

List has mutating operations, but implementation may throw `UnsupportedOperationException`.

```java
List<String> xs = List.of("a");
xs.add("b"); // UnsupportedOperationException
```

## 3.6 Equality

List equality is order-sensitive and element-wise.

```java
List.of("A", "B").equals(List.of("A", "B")) // true
List.of("A", "B").equals(List.of("B", "A")) // false
```

## 3.7 Hash code

List hash code is order-sensitive.

This matters if List is used as Map key.

---

# 4. Kapan `List` adalah Pilihan yang Tepat

Use `List` when:

## 4.1 Order is part of meaning

```java
List<ApprovalStep> approvalSteps;
```

## 4.2 Index matters

```java
LineItem firstLine = lines.get(0);
```

## 4.3 Duplicate entries are meaningful

```java
List<String> searchTerms;
```

Same term repeated may be meaningful in some algorithms.

## 4.4 Stable API order is promised

```java
List<CaseSummary> findCasesSortedByUpdatedAtDesc();
```

## 4.5 User-defined ordering

```java
List<DashboardWidget> widgetsInUserOrder;
```

## 4.6 Ordered history

```java
List<CaseEvent> eventsChronological;
```

Although for first/last access only, `SequencedCollection` can be more general.

## 4.7 Batch input where duplicates matter

If duplicate rows should be validated as duplicates, preserve raw list first.

---

# 5. Kapan `List` adalah Smell

## 5.1 Permission list

```java
List<Permission> permissions;
```

If duplicates invalid and order irrelevant, use:

```java
Set<Permission>
EnumSet<Permission>
PermissionSet
```

## 5.2 Tags where uniqueness matters

```java
List<Tag> tags;
```

Maybe:

```java
Set<Tag>
SequencedSet<Tag>
```

if display order also matters.

## 5.3 Lookup by ID

```java
List<CaseSummary> summaries;
```

If frequently doing:

```java
summaries.stream()
    .filter(s -> s.caseId().equals(id))
    .findFirst()
```

Maybe maintain:

```java
Map<CaseId, CaseSummary>
```

## 5.4 Queue behavior

```java
List<Job> jobs;
jobs.remove(0);
```

Use:

```java
Queue<Job>
ArrayDeque<Job>
BlockingQueue<Job>
```

## 5.5 Set behavior implemented manually

```java
if (!list.contains(x)) {
    list.add(x);
}
```

Maybe use Set.

## 5.6 Review question

```text
Do I need order/index/duplicates, or am I using List by habit?
```

---

# 6. Index-Based Access

`List` provides index-based operations.

But Java SE `List` docs warn that positional access operations may run in time proportional to index value for some implementations, such as `LinkedList`.

## 6.1 Good with ArrayList

```java
for (int i = 0; i < arrayList.size(); i++) {
    process(arrayList.get(i));
}
```

Usually fine because `ArrayList.get(i)` is fast random access.

## 6.2 Bad with LinkedList

```java
for (int i = 0; i < linkedList.size(); i++) {
    process(linkedList.get(i));
}
```

This can become O(n²), because each `get(i)` may traverse.

## 6.3 Safer generic List iteration

If implementation unknown:

```java
for (E element : list) {
    process(element);
}
```

or:

```java
Iterator<E> it = list.iterator();
while (it.hasNext()) {
    process(it.next());
}
```

## 6.4 Index meaningful vs implementation detail

Use index when business meaning needs index.

Example:

```java
ApprovalStep first = steps.get(0);
```

Do not use index just because loop habit if implementation unknown.

## 6.5 Rule

```text
List gives positional access semantically, but not always constant-time access operationally.
```

---

# 7. Encounter Order dan Java 21+ Sequenced Operations

Since Java 21, `List` extends `SequencedCollection`.

This means List has encounter-order operations like:

```java
getFirst()
getLast()
removeFirst()
removeLast()
addFirst(E)
addLast(E)
reversed()
```

depending mutability support.

## 7.1 Before Java 21 style

```java
E first = list.get(0);
E last = list.get(list.size() - 1);
```

## 7.2 Java 21+ style

```java
E first = list.getFirst();
E last = list.getLast();
```

## 7.3 Reversed view

```java
List<E> reversed = list.reversed();
```

The reversed view has inverse encounter order.

Important: it is a view, not necessarily an independent copy.

## 7.4 Why this matters

Code becomes semantic:

```java
events.getLast()
```

is clearer than:

```java
events.get(events.size() - 1)
```

## 7.5 Empty list

First/last operations fail on empty list.

If empty possible, check:

```java
if (!events.isEmpty()) {
    Event latest = events.getLast();
}
```

or domain type:

```java
NonEmptyList<Event>
```

## 7.6 Rule

If first/last is required, either ensure non-empty or model non-empty explicitly.

---

# 8. `ArrayList` Mental Model

Java SE 25 `ArrayList` is a resizable-array implementation of the `List` interface. It implements optional list operations and permits all elements including null. It is unsynchronized.

Mental model:

```text
ArrayList = object header + size + backing Object[] array
```

Elements live in array slots.

```text
index:  0   1   2   3   4
array: [A] [B] [C] [ ] [ ]
size = 3
capacity = 5
```

## 8.1 Size vs capacity

Size:

```text
number of logical elements
```

Capacity:

```text
length of internal array
```

## 8.2 Append

If capacity available:

```java
list.add(x)
```

puts x at `elementData[size]` and increments size.

If full, ArrayList grows backing array.

## 8.3 Random access

`get(i)` means array slot access.

Usually fast.

## 8.4 Insertion in middle

```java
list.add(1, x)
```

requires shifting elements to the right.

## 8.5 Removal in middle

```java
list.remove(1)
```

requires shifting elements to the left.

## 8.6 Null allowed

```java
new ArrayList<String>().add(null);
```

Allowed by ArrayList.

But domain/API may disallow.

---

# 9. `ArrayList` Capacity, Size, Growth, dan Memory

## 9.1 Capacity growth

When internal array full, ArrayList allocates larger array and copies existing elements.

This makes append amortized efficient, but occasional add can be expensive.

## 9.2 `ensureCapacity`

If you know expected size:

```java
ArrayList<CaseId> ids = new ArrayList<>(expectedSize);
```

or:

```java
ids.ensureCapacity(expectedSize);
```

Can reduce reallocation/copying.

## 9.3 `trimToSize`

```java
list.trimToSize();
```

Can reduce backing array capacity to current size.

Usually not needed unless long-lived large list shrinks significantly.

## 9.4 Memory retention

A long-lived ArrayList with huge capacity but small size may retain backing array memory.

## 9.5 Clearing

```java
list.clear();
```

removes references to elements, helping GC collect them if no other references.

But capacity may remain.

## 9.6 Large list warning

`ArrayList` stores references, not elements inline.

For boxed numbers:

```java
List<Integer>
```

means:

- backing reference array;
- many Integer objects unless cached/reused.

Memory can explode.

## 9.7 Rule

For high-volume lists, think about capacity, boxing, object graph, and lifetime.

---

# 10. `ArrayList` Operation Cost

Typical mental model:

| Operation | Cost mental model |
|---|---|
| `get(i)` | fast random access |
| `set(i,x)` | fast random access |
| `add(x)` end | amortized fast |
| `add(i,x)` middle/front | shift elements |
| `remove(i)` middle/front | shift elements |
| `contains(x)` | linear scan |
| iteration | cache-friendly |
| sort | array-backed, efficient locality |
| clear | clears references, capacity remains |

## 10.1 `contains` is linear

```java
list.contains(id)
```

for many lookups may be bad.

Use Set/Map if membership/lookup dominates.

## 10.2 Remove by value

```java
list.remove(object)
```

finds first matching element linearly, then shifts.

## 10.3 Bulk remove

```java
list.removeIf(predicate)
```

often clearer and may be optimized.

## 10.4 Insertion at front

```java
list.add(0, x)
```

shifts all elements.

If frequent front insert/remove, consider `ArrayDeque`.

## 10.5 Rule

ArrayList is excellent for append + iterate + random access; not for frequent front/middle mutation.

---

# 11. `LinkedList` Mental Model

`LinkedList` is a doubly-linked list implementation. Each element is stored in a node with references to previous and next nodes.

Mental model:

```text
[A] <-> [B] <-> [C]
```

Each node stores:

- item;
- prev reference;
- next reference.

## 11.1 Implements List and Deque

`LinkedList` can be used as:

```java
List<E>
Deque<E>
Queue<E>
```

But just because it can be queue does not mean it is best queue.

## 11.2 No fast random access

To get index `i`, linked list traverses nodes from front or back.

## 11.3 Insert/remove at known node

If iterator already at position, insertion/removal can be cheap.

But finding position can be expensive.

## 11.4 Memory overhead

Each element has extra node object and references.

This hurts memory locality and GC.

## 11.5 Null

LinkedList allows null elements.

## 11.6 Rule

LinkedList is rarely the default choice. It is specific.

---

# 12. `LinkedList` Operation Cost

Typical mental model:

| Operation | Cost mental model |
|---|---|
| `get(i)` | traversal |
| `addFirst`/`addLast` | fast |
| `removeFirst`/`removeLast` | fast |
| iterator remove current | can be cheap |
| add/remove by index | traversal + link update |
| contains | linear scan |
| iteration | pointer chasing, less cache-friendly |
| memory | high overhead per element |

## 12.1 Common misconception

“LinkedList is faster for insertion/deletion.”

Only true if you already have the node/iterator position.

If you insert by index, it must traverse first.

## 12.2 Queue use

For queue operations, `ArrayDeque` is often better for non-concurrent use.

## 12.3 When LinkedList may fit

- Need List + Deque semantics simultaneously;
- Frequent removals through iterator;
- Algorithm naturally navigates nodes;
- Very specific cases measured.

## 12.4 Rule

Do not choose LinkedList by textbook slogan. Measure or justify.

---

# 13. `ArrayList` vs `LinkedList`: Real Production Trade-Off

## 13.1 Default

Use `ArrayList` for most general-purpose list needs.

Why:

- compact;
- cache-friendly;
- fast random access;
- fast iteration;
- append efficient;
- lower GC overhead.

## 13.2 Avoid LinkedList as default

LinkedList often loses due to:

- node allocation;
- pointer chasing;
- worse locality;
- higher memory;
- poor index access.

## 13.3 But ArrayList has weaknesses

- front/middle insert/remove shift;
- capacity memory retention;
- large array copy on growth;
- not thread-safe.

## 13.4 Better than LinkedList for queue?

Often:

```java
ArrayDeque
```

## 13.5 Decision heuristic

| Workload | Better starting point |
|---|---|
| append then iterate | ArrayList |
| random access | ArrayList |
| sort list | ArrayList |
| remove from front repeatedly | ArrayDeque |
| stack | ArrayDeque |
| queue | ArrayDeque / BlockingQueue |
| frequent membership check | HashSet |
| index lookup by ID | HashMap |
| iterator-based removals in middle | maybe LinkedList, measure |
| read-mostly concurrent list | CopyOnWriteArrayList |

## 13.6 Rule

```text
ArrayList is the general-purpose List default; LinkedList is a specialized tool.
```

---

# 14. `RandomAccess` Marker Interface

Java SE 25 `RandomAccess` is a marker interface used by List implementations to indicate they support fast, generally constant-time random access. Its purpose is to let generic algorithms adapt behavior for random-access vs sequential-access lists.

## 14.1 Marker interface

No methods.

```java
if (list instanceof RandomAccess) {
    // index loop may be okay
} else {
    // iterator loop safer
}
```

## 14.2 Implemented by

Common random-access lists:

- `ArrayList`;
- many immutable list implementations;
- `Vector`;
- `CopyOnWriteArrayList`.

Not by `LinkedList`.

## 14.3 Generic algorithm

```java
static <T> void process(List<T> list) {
    if (list instanceof RandomAccess) {
        for (int i = 0; i < list.size(); i++) {
            processOne(list.get(i));
        }
    } else {
        for (T element : list) {
            processOne(element);
        }
    }
}
```

## 14.4 Application code

Most app code does not need to branch on RandomAccess.

But library/high-performance generic code might.

## 14.5 Rule

Do not assume `List.get(i)` is fast unless you know implementation or check RandomAccess.

---

# 15. Iteration Patterns

## 15.1 Enhanced for-loop

```java
for (CaseId id : ids) {
    process(id);
}
```

Good default.

## 15.2 Index loop

```java
for (int i = 0; i < ids.size(); i++) {
    process(ids.get(i));
}
```

Use when:

- index needed;
- list known random access.

## 15.3 Iterator explicit

```java
Iterator<CaseId> it = ids.iterator();
while (it.hasNext()) {
    CaseId id = it.next();
}
```

Use when:

- need `Iterator.remove`;
- custom traversal control.

## 15.4 ListIterator

```java
ListIterator<E> it = list.listIterator();
```

Supports bidirectional traversal and positional mutation.

## 15.5 Stream

```java
ids.stream()
   .map(...)
   .toList();
```

Use for transformation pipeline.

## 15.6 Avoid repeated size if costly?

For List, `size()` is generally cheap, but for custom lists maybe not. Usually fine.

## 15.7 Rule

Choose iteration style based on needed semantics, not habit.

---

# 16. Mutation Semantics

`List` supports mutation operations, but not all implementations allow them.

## 16.1 Structural modification

Adding/removing elements changes list structure.

```java
add
remove
clear
addAll
removeIf
```

## 16.2 Non-structural mutation

```java
set(index, value)
```

Replaces element but size unchanged.

Still mutation.

## 16.3 Mutation during iteration

Bad:

```java
for (E e : list) {
    if (bad(e)) {
        list.remove(e);
    }
}
```

Better:

```java
list.removeIf(this::bad);
```

or:

```java
Iterator<E> it = list.iterator();
while (it.hasNext()) {
    if (bad(it.next())) {
        it.remove();
    }
}
```

## 16.4 Immutable input

If method receives list from caller, do not mutate unless documented.

Better:

```java
List<E> copy = new ArrayList<>(input);
copy.add(extra);
return List.copyOf(copy);
```

## 16.5 Rule

Mutation is ownership-sensitive. If you did not create the list, think twice before mutating it.

---

# 17. `subList`: View, Not Independent List

`List.subList(from, to)` returns a view of portion of the list.

## 17.1 Example

```java
List<String> xs = new ArrayList<>(List.of("A", "B", "C", "D"));
List<String> sub = xs.subList(1, 3); // B, C
```

`sub` is backed by `xs`.

## 17.2 Mutating sublist affects original

```java
sub.clear();
System.out.println(xs); // [A, D]
```

## 17.3 Mutating original can invalidate sublist

Structural modification of backing list outside sublist can make sublist behavior problematic, often causing `ConcurrentModificationException`.

## 17.4 Memory retention warning

A sublist view can retain reference to backing list/array. If backing list is huge and sublist small but long-lived, memory can be retained.

Modern implementations vary, but conceptually treat subList as view.

## 17.5 Make independent copy

```java
List<E> page = List.copyOf(list.subList(from, to));
```

or:

```java
List<E> page = new ArrayList<>(list.subList(from, to));
```

## 17.6 Rule

Use `subList` as short-lived view. Copy if crossing boundary or long-lived.

---

# 18. `Arrays.asList` vs `List.of` vs `ArrayList`

These are often confused.

## 18.1 `Arrays.asList`

```java
List<String> xs = Arrays.asList("A", "B");
```

Characteristics:

- fixed-size list backed by array;
- supports `set`;
- does not support add/remove;
- allows null.

```java
xs.set(0, "X"); // ok
xs.add("C");    // UnsupportedOperationException
```

## 18.2 `List.of`

```java
List<String> xs = List.of("A", "B");
```

Characteristics:

- unmodifiable;
- disallows null;
- compact immutable implementation.

```java
xs.set(0, "X"); // UnsupportedOperationException
xs.add("C");    // UnsupportedOperationException
```

## 18.3 `new ArrayList`

```java
List<String> xs = new ArrayList<>(List.of("A", "B"));
```

Characteristics:

- mutable;
- allows null;
- resizable.

## 18.4 Common bug

```java
List<String> xs = Arrays.asList("A", "B");
xs.add("C"); // fail
```

## 18.5 Which to use?

| Need | Use |
|---|---|
| immutable constants | `List.of` |
| mutable copy | `new ArrayList<>(...)` |
| fixed-size array view | `Arrays.asList` |
| defensive immutable copy | `List.copyOf` |

---

# 19. `List.copyOf` and Defensive Copy

`List.copyOf(collection)` creates an unmodifiable list containing elements of given collection and rejects null elements.

## 19.1 Constructor defensive copy

```java
record ApprovalSteps(List<ApprovalStep> values) {
    ApprovalSteps {
        values = List.copyOf(values);
    }
}
```

## 19.2 Why not assign directly?

Bad:

```java
this.values = values;
```

Caller can mutate.

## 19.3 Why not `Collections.unmodifiableList(values)`?

That creates unmodifiable view of same backing list.

If original changes, view changes.

## 19.4 Shallow copy

`List.copyOf` does not make elements immutable.

If elements are mutable, they can still change.

## 19.5 Null rejection

This is often good for domain value collections.

## 19.6 Rule

For immutable value objects, use defensive copy and immutable elements.

---

# 20. List Equality and Hashing

## 20.1 Equality is element-wise and order-sensitive

```java
List.of("A", "B").equals(List.of("A", "B")) // true
List.of("A", "B").equals(List.of("B", "A")) // false
```

## 20.2 Hash code is order-sensitive

So list can be used as key only if:

- list immutable;
- elements immutable;
- equality semantics intended.

## 20.3 Mutable list as key

Bad:

```java
Map<List<String>, Value> map = new HashMap<>();
List<String> key = new ArrayList<>(List.of("A"));
map.put(key, value);
key.add("B");
map.get(key); // broken
```

## 20.4 Record with list

```java
record Key(List<String> parts) {}
```

If list mutable, record hash changes.

Fix:

```java
record Key(List<String> parts) {
    Key {
        parts = List.copyOf(parts);
    }
}
```

## 20.5 Rule

Never use mutable list as key.

---

# 21. Null Elements

## 21.1 ArrayList permits null

```java
List<String> xs = new ArrayList<>();
xs.add(null);
```

## 21.2 List.of rejects null

```java
List.of("A", null); // NullPointerException
```

## 21.3 Null in stream pipeline

```java
list.stream()
    .map(String::toLowerCase)
    .toList();
```

fails if null exists.

## 21.4 Domain recommendation

Prefer null-free lists.

Validate at boundary:

```java
if (values.stream().anyMatch(Objects::isNull)) {
    throw new IllegalArgumentException("null element");
}
```

or use:

```java
List.copyOf(values)
```

to reject null.

## 21.5 API schema

If JSON array cannot contain null, document item type non-null.

## 21.6 Rule

Null element policy must be explicit.

---

# 22. Lists in Records and Value Objects

## 22.1 Bad

```java
record ViolationList(List<Violation> values) {}
```

This is shallow immutable only.

Caller can mutate original list.

## 22.2 Better

```java
record ViolationList(List<Violation> values) {
    ViolationList {
        values = List.copyOf(values);
        if (values.isEmpty()) {
            throw new IllegalArgumentException("At least one violation required");
        }
    }

    public int size() {
        return values.size();
    }
}
```

## 22.3 But accessor exposes list

If list is unmodifiable and elements immutable, okay.

If elements mutable, still risk.

## 22.4 Domain operations

Instead of exposing raw list methods everywhere, add domain operations:

```java
boolean containsCode(ViolationCode code)
Optional<Violation> firstByCode(ViolationCode code)
```

## 22.5 Rule

A list wrapper should enforce list-level invariants and expose domain operations.

---

# 23. Lists as API Contract

If API returns list, it promises something about order.

## 23.1 Example

```json
{
  "items": [
    {"caseId": "CASE-1"},
    {"caseId": "CASE-2"}
  ]
}
```

Questions:

- sorted by what?
- stable order?
- can duplicates appear?
- max items?
- can item be null?
- pagination?

## 23.2 OpenAPI considerations

Use:

```yaml
type: array
minItems: 0
maxItems: 100
items:
  $ref: '#/components/schemas/CaseSummary'
```

If order defined, document in description.

## 23.3 Request list

For bulk request:

```json
{
  "caseIds": ["CASE-1", "CASE-2"]
}
```

Need policy:

- allow duplicate?
- reject duplicate?
- preserve order?
- max size?

## 23.4 Response list

If response list order matters, document:

```text
Items are sorted by updatedAt descending, caseId ascending.
```

## 23.5 Rule

JSON array preserves order, but schema/documentation must explain semantic order.

---

# 24. Lists in JSON/API/DB/Event Boundaries

## 24.1 JSON

Java List maps naturally to JSON array.

But JSON array does not encode:

- Java list mutability;
- element class beyond schema;
- max size unless defined;
- non-null unless schema says.

## 24.2 Database

List maps to DB using:

- child table with order column;
- JSON array column;
- array column;
- delimited string anti-pattern.

## 24.3 Ordered child table

```sql
approval_step (
  case_id,
  step_no,
  approver_id,
  status,
  primary key(case_id, step_no)
)
```

## 24.4 Event

Event list fields should be bounded and versioned.

Large event arrays can cause broker/message size issues.

## 24.5 Cache

Cache list should be immutable snapshot.

## 24.6 Rule

If list crosses boundary, define order, size, null, duplicate, and compatibility.

---

# 25. Lists and Streams

## 25.1 Stream from list

```java
list.stream()
```

preserves encounter order.

## 25.2 Parallel stream from list

ArrayList splits well.

LinkedList less ideal due traversal/pointer structure.

## 25.3 `toList`

```java
List<T> result = stream.toList();
```

Returns unmodifiable list.

If mutable result needed:

```java
List<T> result = stream.collect(Collectors.toCollection(ArrayList::new));
```

## 25.4 `Collectors.toList`

Historically does not guarantee specific mutability/type in contract.

Do not rely on returned list being mutable unless using explicit collector.

## 25.5 Avoid side-effect add

Bad:

```java
List<T> result = new ArrayList<>();
source.stream().map(...).forEach(result::add);
```

Better:

```java
List<T> result = source.stream().map(...).toList();
```

## 25.6 Rule

Stream-to-list terminal choice must consider mutability contract.

---

# 26. Lists and Concurrency

## 26.1 ArrayList not thread-safe

Concurrent mutation can corrupt behavior.

## 26.2 External synchronization

```java
List<T> sync = Collections.synchronizedList(new ArrayList<>());
```

Iteration still requires manual synchronization per docs/pattern.

## 26.3 Immutable snapshot

Often best:

```java
volatile List<Rule> rules = List.of();

void reload(List<Rule> newRules) {
    rules = List.copyOf(newRules);
}
```

Readers see immutable list.

## 26.4 CopyOnWriteArrayList

Good for read-mostly, write-rarely.

## 26.5 Concurrent modification

Fail-fast iterator is not synchronization mechanism.

## 26.6 Rule

For shared list, choose:
- immutable snapshot;
- synchronized list;
- CopyOnWriteArrayList;
- concurrent queue;
- explicit lock;
based on workload.

---

# 27. CopyOnWriteArrayList Preview

`CopyOnWriteArrayList` is a thread-safe variant of ArrayList where mutative operations copy the underlying array.

## 27.1 Mental model

Reads are cheap and snapshot-like.

Writes are expensive.

## 27.2 Good use cases

- listener list;
- observer registry;
- read-mostly configuration;
- small list with rare mutations.

## 27.3 Bad use cases

- frequent writes;
- large lists;
- high mutation rate.

## 27.4 Iterator

Iterator sees snapshot at time of creation.

## 27.5 Rule

Use CopyOnWriteArrayList for read-heavy/write-light, not as generic concurrent ArrayList.

---

# 28. Performance and Memory Cost Model

## 28.1 ArrayList

Strengths:

- compact references;
- cache-friendly;
- fast iteration;
- fast random access.

Weaknesses:

- shifting on front/middle insert/remove;
- array copy on growth;
- capacity retention.

## 28.2 LinkedList

Strengths:

- add/remove first/last;
- iterator-position removal.

Weaknesses:

- high memory overhead;
- poor locality;
- slow random access;
- more GC pressure.

## 28.3 Boxed element lists

```java
List<Integer>
```

Cost:

- reference array;
- Integer objects;
- boxing/unboxing;
- GC.

Alternative:

- `int[]`;
- `IntStream`;
- primitive collections library;
- compact representation.

## 28.4 Large list

Ask:

```text
How many elements?
How long retained?
Are elements mutable?
Can process streaming instead?
Do we need all in memory?
```

## 28.5 JMH/JFR

For performance claims, measure with proper tooling.

## 28.6 Rule

List choice affects CPU, memory, GC, and latency.

---

# 29. Production Failure Modes

## 29.1 `Arrays.asList` add failure

```java
List<String> xs = Arrays.asList("A", "B");
xs.add("C"); // UnsupportedOperationException
```

## 29.2 `List.of` mutation failure

```java
List<String> xs = List.of("A");
xs.set(0, "B"); // UnsupportedOperationException
```

## 29.3 Null in immutable list

```java
List.of("A", null); // NPE
```

## 29.4 LinkedList index loop O(n²)

```java
for (int i = 0; i < list.size(); i++) {
    process(list.get(i));
}
```

If list is LinkedList, can be bad.

## 29.5 subList mutation surprise

Sublist clear removes from original.

## 29.6 subList long-lived memory retention

Small sublist retains large backing structure.

## 29.7 Mutable list in record hash

Record hash changes after backing list mutation.

## 29.8 Returning internal list

Caller clears aggregate child list.

## 29.9 toList mutability assumption

```java
stream.toList().add(x); // fail
```

## 29.10 List used for membership

Repeated `contains` on large list causes performance issue.

Use Set/Map.

## 29.11 Unbounded request list

Bulk API accepts 100k items, memory/DB pressure.

Add max size.

## 29.12 Concurrent ArrayList mutation

Race/ConcurrentModificationException/corruption.

Use correct concurrency design.

---

# 30. Best Practices

## 30.1 Choosing List

Use List when:

- order matters;
- index matters;
- duplicates meaningful;
- stable sequence needed.

Do not use List by default when:

- uniqueness matters;
- lookup dominates;
- queue semantics;
- unordered group enough.

## 30.2 Implementation

- Prefer ArrayList for general-purpose list.
- Prefer ArrayDeque for queue/stack.
- Avoid LinkedList unless justified.
- Pre-size ArrayList if expected size known.
- Use CopyOnWriteArrayList only for read-mostly/write-rarely.

## 30.3 API

- Accept `Iterable` if only traversal.
- Accept `List` if order/index needed.
- Return immutable/snapshot list.
- Document order and mutability.
- Do not mutate input unless contract says so.

## 30.4 Domain

- Wrap list if list-level invariant matters.
- Use NonEmptyList, ApprovalSteps, ViolationList, EventHistory.
- Defensive copy in constructor.
- Avoid null elements.

## 30.5 Boundary

- Define maxItems in API.
- Define order semantics.
- Define duplicate policy.
- Define DB order column if persisted.
- Avoid delimited string list in DB.

## 30.6 Performance

- Avoid boxed huge lists.
- Avoid LinkedList in hot path without measurement.
- Avoid repeated contains on List for large membership checks.
- Use JFR/JMH for performance claims.

---

# 31. Decision Matrix

| Requirement | Recommended |
|---|---|
| ordered sequence | `List<T>` |
| first/last only, no index | `SequencedCollection<T>` |
| unique elements | `Set<T>` |
| unique + stable encounter order | `SequencedSet<T>` / `LinkedHashSet<T>` |
| unique enum values | `EnumSet<E>` |
| lookup by key | `Map<K,V>` |
| queue FIFO/LIFO | `ArrayDeque<T>` / `Queue<T>` |
| blocking producer-consumer | `BlockingQueue<T>` |
| read-mostly concurrent list | `CopyOnWriteArrayList<T>` |
| huge primitive numeric data | primitive array / primitive collection |
| immutable domain list | `List.copyOf` in wrapper |
| mutable working buffer | `new ArrayList<>(expectedSize)` |
| page slice crossing boundary | copy of `subList` |
| API bulk request | `List<T>` + max size + duplicate policy |
| workflow steps | domain wrapper over `List`/`SequencedCollection` |
| event history latest access | `SequencedCollection` or domain wrapper |

---

# 32. Latihan

## Latihan 1 — List or Not?

Untuk masing-masing, pilih `List`, `Set`, `Map`, `Queue`, `Deque`, `SequencedCollection`, atau domain wrapper:

1. permissions user;
2. approval steps;
3. search results sorted by relevance;
4. background jobs waiting for worker;
5. latest case event;
6. case summary lookup by ID;
7. selected case IDs from UI where duplicate should be rejected;
8. audit trail.

Jelaskan alasan.

## Latihan 2 — ArrayList vs LinkedList

Buat dua implementation untuk workload:

- append 1 juta item, iterate semua;
- remove first 1 juta kali;
- get random index 1 juta kali.

Prediksi sebelum benchmark. Lalu ukur.

## Latihan 3 — Defensive Copy

Refactor:

```java
record ApprovalSteps(List<ApprovalStep> steps) {}
```

menjadi immutable wrapper dengan:

- non-empty validation;
- no null elements;
- latest/first method;
- safe accessor.

## Latihan 4 — subList

Tulis contoh:

```java
List<Integer> xs = new ArrayList<>(List.of(1,2,3,4));
List<Integer> sub = xs.subList(1,3);
sub.clear();
```

Apa output `xs`? Kenapa?

## Latihan 5 — API Contract

Desain OpenAPI-style schema untuk bulk request:

```json
{
  "caseIds": [...]
}
```

Dengan rules:

- order preserved;
- duplicates rejected;
- max 100;
- items must match pattern.

## Latihan 6 — Stream to List

Bandingkan:

```java
stream.toList()
stream.collect(Collectors.toList())
stream.collect(Collectors.toCollection(ArrayList::new))
```

Dari sisi mutability contract.

---

# 33. Ringkasan

`List` adalah ordered sequence.

Core lessons:

- `List` berarti order dan positional access.
- Duplicate biasanya allowed.
- `ArrayList` adalah default general-purpose list yang compact dan cache-friendly.
- `LinkedList` bukan default; ia specialized dan sering kalah di production.
- `RandomAccess` memberi sinyal fast index access.
- `List` operations by index tidak selalu fast untuk semua implementation.
- Java 21+ membuat `List` menjadi `SequencedCollection`, sehingga first/last/reversed lebih semantic.
- `subList` adalah view, bukan copy.
- `Arrays.asList`, `List.of`, `new ArrayList`, dan `List.copyOf` punya mutability/null behavior berbeda.
- Records dengan List butuh defensive copy.
- List equality/hash order-sensitive.
- Null element policy harus explicit.
- API list harus mendefinisikan order, duplicate, max size, null item.
- List tidak otomatis thread-safe.
- Performance List ditentukan oleh implementation, data volume, mutation pattern, memory, boxing, dan GC.

Prinsip utama:

```text
Use List when sequence semantics matter.
Do not use List just because you need “many values”.
```

---

# 34. Referensi

1. Java SE 25 — `List`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

2. Java SE 25 — `ArrayList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ArrayList.html

3. Java SE 25 — `LinkedList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/LinkedList.html

4. Java SE 25 — `RandomAccess`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/RandomAccess.html

5. Java SE 25 — `SequencedCollection`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SequencedCollection.html

6. Java SE 25 — `Arrays`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html

7. Java SE 25 — `Collections`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html

8. Java SE 25 — `CopyOnWriteArrayList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CopyOnWriteArrayList.html

9. JEP 431 — Sequenced Collections  
   https://openjdk.org/jeps/431

10. Java SE 25 — Collections Framework Overview  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/doc-files/coll-overview.html

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-collections-and-streams-part-001.md">⬅️ Java Collections and Streams — Part 001</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-collections-and-streams-part-003.md">Java Collections and Streams — Part 003 ➡️</a>
</div>
