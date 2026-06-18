# learn-java-collections-and-streams-part-010.md

# Java Collections and Streams — Part 010  
# Mutability, Immutability, Defensive Copying, Ownership, Snapshot, Live View, dan Safe Collection Boundaries

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **010**  
> Fokus: memahami mutability collection sebagai **ownership dan boundary problem**, bukan sekadar “bisa di-add atau tidak”. Kita akan membedah mutable, modifiable, unmodifiable view, immutable copy, shallow immutability, deep immutability, defensive copy, live view, snapshot, records with collection components, safe publication, concurrency, API/DB/event/cache boundaries, dan production failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Collection Mutability adalah Ownership Problem](#2-mental-model-collection-mutability-adalah-ownership-problem)
3. [Vocabulary: Mutable, Modifiable, Unmodifiable, Immutable](#3-vocabulary-mutable-modifiable-unmodifiable-immutable)
4. [Mutable Collections](#4-mutable-collections)
5. [Unmodifiable View](#5-unmodifiable-view)
6. [Immutable Copy](#6-immutable-copy)
7. [Shallow vs Deep Immutability](#7-shallow-vs-deep-immutability)
8. [Live View vs Snapshot](#8-live-view-vs-snapshot)
9. [`Collections.unmodifiable*`](#9-collectionsunmodifiable)
10. [`List.copyOf`, `Set.copyOf`, `Map.copyOf`](#10-listcopyof-setcopyof-mapcopyof)
11. [`List.of`, `Set.of`, `Map.of`](#11-listof-setof-mapof)
12. [`Arrays.asList` and Fixed-Size Views](#12-arraysaslist-and-fixed-size-views)
13. [Defensive Copying](#13-defensive-copying)
14. [Constructor Defensive Copy](#14-constructor-defensive-copy)
15. [Accessor Defensive Copy](#15-accessor-defensive-copy)
16. [Records with Collection Components](#16-records-with-collection-components)
17. [Collection Elements: Immutable Container, Mutable Elements](#17-collection-elements-immutable-container-mutable-elements)
18. [Ownership Semantics](#18-ownership-semantics)
19. [Mutation Policies](#19-mutation-policies)
20. [Copy-on-Write and Snapshot Iteration](#20-copy-on-write-and-snapshot-iteration)
21. [Persistent/Functional Collections Concept](#21-persistentfunctional-collections-concept)
22. [Safe Publication and Concurrency](#22-safe-publication-and-concurrency)
23. [Mutable Collections in Concurrent Maps](#23-mutable-collections-in-concurrent-maps)
24. [SubList, Reversed Views, and View Retention](#24-sublist-reversed-views-and-view-retention)
25. [Collections in API Boundaries](#25-collections-in-api-boundaries)
26. [Collections in Domain Objects](#26-collections-in-domain-objects)
27. [Collections in Persistence Entities](#27-collections-in-persistence-entities)
28. [Collections in Events and Messages](#28-collections-in-events-and-messages)
29. [Collections in Cache](#29-collections-in-cache)
30. [Performance Cost of Copying](#30-performance-cost-of-copying)
31. [Security Implications](#31-security-implications)
32. [Production Failure Modes](#32-production-failure-modes)
33. [Best Practices](#33-best-practices)
34. [Decision Matrix](#34-decision-matrix)
35. [Latihan](#35-latihan)
36. [Ringkasan](#36-ringkasan)
37. [Referensi](#37-referensi)

---

# 1. Tujuan Bagian Ini

Collections sering berpindah melewati boundary:

```text
controller -> service -> domain -> repository -> mapper -> cache -> event -> API response
```

Di setiap boundary, pertanyaan pentingnya bukan hanya:

```text
Apa type collection-nya?
```

tetapi:

```text
Siapa owner-nya?
Boleh dimutasi siapa?
Apakah caller masih memegang reference?
Apakah yang dikembalikan live view atau snapshot?
Apakah element-nya mutable?
Apakah aman dishare antar thread?
Apakah aman dicache?
Apakah aman untuk record equals/hashCode?
Apakah aman untuk event payload?
```

Bug mutability sering sulit didiagnosis karena penyebab dan gejalanya berjauhan.

Contoh:

```java
record Order(List<OrderLine> lines) {}
```

Terlihat immutable karena record.

Tapi jika `lines` adalah `ArrayList`, caller bisa mutate list setelah `Order` dibuat.

Tujuan part ini:

- membedakan mutable/modifiable/unmodifiable/immutable;
- memahami view vs copy;
- memahami shallow vs deep immutability;
- menguasai defensive copy;
- mendesain collection ownership;
- memahami concurrency/safe publication;
- mengenali production failure modes.

---

# 2. Mental Model: Collection Mutability adalah Ownership Problem

Mutability bukan hanya pertanyaan:

```text
Apakah collection ini punya method add/remove?
```

Pertanyaan yang lebih penting:

```text
Siapa yang boleh mengubah state?
Siapa yang bisa melihat perubahan?
Apakah perubahan itu bagian dari contract?
```

## 2.1 Aliasing

Aliasing terjadi ketika dua reference menunjuk object yang sama.

```java
List<String> raw = new ArrayList<>();
Order order = new Order(raw);

raw.add("unexpected");
```

Jika `Order` menyimpan `raw` langsung, state `Order` berubah dari luar.

## 2.2 Ownership

Owner adalah pihak yang bertanggung jawab atas mutation/lifetime object.

Jika method menerima collection:

```java
void process(List<Item> items)
```

apakah method boleh menyimpan reference?

apakah method boleh mutate?

apakah caller boleh mutate setelah call?

Harus jelas.

## 2.3 Boundary rule

```text
No collection should cross a boundary without explicit ownership semantics.
```

## 2.4 Common safe default

At boundaries:

```java
List.copyOf(input)
Set.copyOf(input)
Map.copyOf(input)
```

But remember: this is shallow copy.

## 2.5 Main rule

```text
Mutability is not just object capability.
Mutability is a contract between owners.
```

---

# 3. Vocabulary: Mutable, Modifiable, Unmodifiable, Immutable

Istilah ini sering tercampur.

## 3.1 Modifiable

A collection is modifiable if operations like:

```java
add
remove
clear
put
```

can change it.

## 3.2 Unmodifiable

A collection is unmodifiable if modification operations are not supported through that reference/API.

Example:

```java
List<String> view = Collections.unmodifiableList(list);
```

You cannot do:

```java
view.add("x");
```

But backing `list` may still change.

## 3.3 Immutable

A collection is immutable if no change in the collection object will be visible after creation.

This is stronger than unmodifiable view.

## 3.4 Mutable

A collection is mutable if its state can change.

## 3.5 Shallow immutable

Collection structure cannot change, but elements can mutate.

```java
List<MutableUser> users = List.copyOf(raw);
users.get(0).setName("changed");
```

## 3.6 Deep immutable

Collection and all reachable elements are immutable.

Harder to guarantee.

## 3.7 Snapshot

A stable copy at a point in time.

## 3.8 Live view

A view backed by another object; changes in backing object are visible.

## 3.9 Rule

Always specify which one you mean.

---

# 4. Mutable Collections

Mutable collections are normal working buffers.

Examples:

```java
ArrayList
HashSet
HashMap
ArrayDeque
LinkedHashMap
TreeMap
```

## 4.1 Good use cases

- local computation;
- builders;
- aggregation;
- parsing;
- batching;
- internal mutable state with controlled ownership.

## 4.2 Bad use cases

- public return from domain object;
- cache value exposed to callers;
- event payload reused after publish;
- record component without defensive copy;
- shared across threads unsafely.

## 4.3 Working buffer pattern

```java
List<Result> results = new ArrayList<>();

for (Input input : inputs) {
    results.add(process(input));
}

return List.copyOf(results);
```

## 4.4 Rule

Mutable collections are fine inside owned scope. They are dangerous across boundaries.

---

# 5. Unmodifiable View

Unmodifiable view prevents mutation through that view.

```java
List<String> raw = new ArrayList<>();
List<String> view = Collections.unmodifiableList(raw);
```

## 5.1 Cannot mutate via view

```java
view.add("x"); // UnsupportedOperationException
```

## 5.2 But backing collection can mutate

```java
raw.add("A");
System.out.println(view); // [A]
```

## 5.3 Why useful

- read-only facade;
- internal code where owner still mutates;
- legacy APIs;
- live monitoring views.

## 5.4 Why dangerous

Callers may assume it is immutable snapshot.

It is not.

## 5.5 Rule

```text
Unmodifiable view is not immutable copy.
```

---

# 6. Immutable Copy

Immutable copy means caller gets independent unmodifiable collection whose membership will not reflect later changes to original collection.

```java
List<String> snapshot = List.copyOf(raw);
```

## 6.1 Original mutation not visible

```java
List<String> raw = new ArrayList<>();
raw.add("A");

List<String> copy = List.copyOf(raw);

raw.add("B");

System.out.println(copy); // [A]
```

## 6.2 But shallow

If element itself mutable, element state can still change.

## 6.3 Null rejection

`List.copyOf`, `Set.copyOf`, and `Map.copyOf` reject nulls.

## 6.4 May not always allocate

If input is already unmodifiable, implementation may return it or optimize.

But semantic result is unmodifiable snapshot-like from caller perspective.

## 6.5 Rule

Use immutable copy to break collection structure aliasing.

---

# 7. Shallow vs Deep Immutability

## 7.1 Shallow immutable collection

```java
List<MutableAddress> addresses = List.copyOf(raw);
```

You cannot add/remove addresses.

But:

```java
addresses.get(0).setCity("changed");
```

can mutate contained object.

## 7.2 Deep immutable

Requires:

- collection cannot change;
- elements cannot change;
- nested objects cannot change.

## 7.3 Example deep-ish

```java
record Address(String city, String country) {}

record CustomerAddresses(List<Address> values) {
    CustomerAddresses {
        values = List.copyOf(values);
    }
}
```

If `Address` is immutable, `values` is deeply safe enough.

## 7.4 Mutable element fix

Convert mutable DTO to immutable domain value:

```java
List<Address> addresses = dtos.stream()
    .map(Address::from)
    .toList();
```

## 7.5 Rule

Immutable collection is only as immutable as its elements.

---

# 8. Live View vs Snapshot

## 8.1 Live view

Reflects backing object.

Examples:

- `Collections.unmodifiableList(backing)`;
- `map.keySet()`;
- `map.values()`;
- `map.entrySet()`;
- `list.subList()`;
- `sequenced.reversed()`.

## 8.2 Snapshot

Independent copy.

Examples:

```java
List.copyOf(list)
Set.copyOf(set)
Map.copyOf(map)
new ArrayList<>(list)
new LinkedHashSet<>(set)
new HashMap<>(map)
```

## 8.3 Live view example

```java
Map<String, Integer> map = new HashMap<>();
Set<String> keys = map.keySet();

map.put("A", 1);
System.out.println(keys); // [A]
```

## 8.4 Snapshot example

```java
Set<String> keys = Set.copyOf(map.keySet());
map.put("B", 2);
System.out.println(keys); // old snapshot
```

## 8.5 Rule

Return live views only when live behavior is intended and safe.

---

# 9. `Collections.unmodifiable*`

`Collections` provides wrappers:

```java
unmodifiableCollection
unmodifiableList
unmodifiableSet
unmodifiableSortedSet
unmodifiableNavigableSet
unmodifiableMap
unmodifiableSortedMap
unmodifiableNavigableMap
unmodifiableSequencedCollection
unmodifiableSequencedSet
unmodifiableSequencedMap
```

## 9.1 Wrapper behavior

They return unmodifiable views of specified collections/maps.

## 9.2 Backed by original

The returned view delegates reads to backing collection.

## 9.3 Mutation through backing visible

```java
List<String> raw = new ArrayList<>();
List<String> ro = Collections.unmodifiableList(raw);

raw.add("A");

ro.size(); // 1
```

## 9.4 Good use cases

- expose read-only view of internal mutable state to trusted internal components;
- maintain live view semantics;
- compatibility with older APIs.

## 9.5 Bad use cases

- public API where caller expects snapshot;
- security boundary;
- cache value;
- event payload;
- record component.

## 9.6 Rule

Use unmodifiable wrappers for read-only views, not for immutability.

---

# 10. `List.copyOf`, `Set.copyOf`, `Map.copyOf`

Java 10 introduced convenient copy factories.

## 10.1 List.copyOf

```java
List<T> copy = List.copyOf(source);
```

Result:

- unmodifiable;
- rejects null collection or null elements;
- preserves encounter order of source collection iteration;
- may optimize if source already unmodifiable.

## 10.2 Set.copyOf

```java
Set<T> copy = Set.copyOf(source);
```

Result:

- unmodifiable;
- rejects null;
- duplicate handling follows set creation semantics;
- order should not be used unless specified by implementation/contract.

If order matters, be careful.

## 10.3 Map.copyOf

```java
Map<K,V> copy = Map.copyOf(source);
```

Result:

- unmodifiable;
- rejects null keys/values.

## 10.4 Copy is shallow

Values/elements not deep copied.

## 10.5 Use in records

```java
record Tags(Set<Tag> values) {
    Tags {
        values = Set.copyOf(values);
    }
}
```

## 10.6 Rule

Use copyOf as default boundary protection for collection structure.

---

# 11. `List.of`, `Set.of`, `Map.of`

Factory methods create unmodifiable collections.

## 11.1 List.of

```java
List<String> xs = List.of("A", "B");
```

- unmodifiable;
- rejects null.

## 11.2 Set.of

```java
Set<String> xs = Set.of("A", "B");
```

- unmodifiable;
- rejects null;
- rejects duplicate elements.

## 11.3 Map.of

```java
Map<String, Integer> map = Map.of("A", 1, "B", 2);
```

- unmodifiable;
- rejects null keys/values;
- rejects duplicate keys.

## 11.4 Good use cases

- constants;
- default empty/small values;
- tests;
- static lookup maps.

## 11.5 Not mutable

```java
List.of("A").add("B"); // UnsupportedOperationException
```

## 11.6 Rule

Use `of` for known literal values. Use `copyOf` for existing collections.

---

# 12. `Arrays.asList` and Fixed-Size Views

`Arrays.asList(array)` returns a fixed-size list backed by the array.

## 12.1 Example

```java
String[] array = {"A", "B"};
List<String> list = Arrays.asList(array);
```

## 12.2 set works

```java
list.set(0, "X");
System.out.println(array[0]); // X
```

## 12.3 add/remove fail

```java
list.add("C"); // UnsupportedOperationException
list.remove("A"); // UnsupportedOperationException
```

## 12.4 Backed by array

Array mutation visible in list and vice versa for set.

## 12.5 Common bug

Developers think it returns mutable ArrayList. It does not.

## 12.6 Rule

Use `new ArrayList<>(Arrays.asList(...))` if mutable list needed.

---

# 13. Defensive Copying

Defensive copying means copying data at boundary to prevent external mutation from affecting internal state.

## 13.1 Input defensive copy

```java
this.items = List.copyOf(items);
```

## 13.2 Output defensive copy

```java
return List.copyOf(items);
```

## 13.3 Mutable copy for internal work

```java
this.items = new ArrayList<>(items);
```

## 13.4 Immutable copy for value object

```java
this.items = List.copyOf(items);
```

## 13.5 Deep copy if elements mutable

```java
this.items = items.stream()
    .map(Item::copy)
    .toList();
```

## 13.6 Rule

Copy at boundaries where ownership changes.

---

# 14. Constructor Defensive Copy

## 14.1 Bad

```java
public final class Order {
    private final List<OrderLine> lines;

    public Order(List<OrderLine> lines) {
        this.lines = lines;
    }
}
```

Caller can mutate.

## 14.2 Better

```java
public final class Order {
    private final List<OrderLine> lines;

    public Order(List<OrderLine> lines) {
        this.lines = List.copyOf(lines);
    }
}
```

## 14.3 Validate after copy or before?

Usually:

```java
List<OrderLine> copied = List.copyOf(lines);
if (copied.isEmpty()) {
    throw new IllegalArgumentException("lines required");
}
this.lines = copied;
```

## 14.4 Why copy before validation?

To avoid time-of-check/time-of-use mutation if input can be concurrently changed.

## 14.5 Rule

Copy, then validate copied state, then assign.

---

# 15. Accessor Defensive Copy

## 15.1 Bad

```java
public List<OrderLine> lines() {
    return lines;
}
```

If `lines` mutable internally, caller can mutate.

## 15.2 Option A: internal immutable

```java
private final List<OrderLine> lines;

public List<OrderLine> lines() {
    return lines;
}
```

Safe if list and elements are immutable enough.

## 15.3 Option B: return copy

```java
public List<OrderLine> lines() {
    return List.copyOf(lines);
}
```

## 15.4 Option C: return unmodifiable view

```java
return Collections.unmodifiableList(lines);
```

Live view; use only if intended.

## 15.5 Option D: expose behavior not collection

```java
public int lineCount()
public Money total()
public boolean containsProduct(ProductId id)
```

## 15.6 Rule

Do not expose mutable internals. Prefer immutable internal representation or behavior methods.

---

# 16. Records with Collection Components

Records are shallowly immutable.

## 16.1 Bad

```java
record Order(List<OrderLine> lines) {}
```

This does not copy.

## 16.2 Caller mutation

```java
List<OrderLine> raw = new ArrayList<>();
Order order = new Order(raw);

raw.add(line); // order changed
```

## 16.3 Good compact constructor

```java
record Order(List<OrderLine> lines) {
    public Order {
        lines = List.copyOf(lines);
        if (lines.isEmpty()) {
            throw new IllegalArgumentException("lines required");
        }
    }
}
```

## 16.4 Accessor returns component

Record accessor returns stored list. If stored list is unmodifiable, okay structurally.

## 16.5 Element mutability still matters

If `OrderLine` mutable, order can still change through element mutation.

## 16.6 Rule

Every record collection component should almost always be defensively copied.

---

# 17. Collection Elements: Immutable Container, Mutable Elements

## 17.1 Example

```java
List<User> users = List.copyOf(rawUsers);
```

If User mutable:

```java
users.get(0).setRole(ADMIN);
```

List structure unchanged, but logical content changed.

## 17.2 Domain risk

Security-sensitive collections:

```java
Set<Permission>
List<AccessRule>
Map<CaseId, CaseSnapshot>
```

must ensure elements/values are immutable or safely copied.

## 17.3 Deep copy pattern

```java
List<UserSnapshot> snapshots = users.stream()
    .map(UserSnapshot::from)
    .toList();
```

## 17.4 Value object elements

Prefer records/value objects.

```java
record Permission(String code) {}
record CaseSnapshot(CaseId id, CaseStatus status) {}
```

## 17.5 Rule

Collection immutability does not protect mutable elements.

---

# 18. Ownership Semantics

Define ownership explicitly.

## 18.1 Borrow

Method reads but does not store.

```java
void validate(Collection<Item> items)
```

Contract:

```text
Caller retains ownership.
Callee does not mutate/store.
```

## 18.2 Take ownership

Callee may store/mutate.

In Java, because ownership not encoded, copy is safer.

```java
this.items = new ArrayList<>(items);
```

## 18.3 Share immutable

```java
this.items = List.copyOf(items);
```

Now safe to share.

## 18.4 Return borrowed internal view

Dangerous unless internal and documented.

## 18.5 Return snapshot

Safe default.

## 18.6 Rule

In Java, ownership is expressed by copying, immutability, documentation, and naming.

---

# 19. Mutation Policies

## 19.1 Fully immutable object

```java
record PermissionSet(Set<Permission> values) {
    PermissionSet {
        values = Set.copyOf(values);
    }
}
```

## 19.2 Mutable aggregate with controlled methods

```java
public final class Order {
    private final List<OrderLine> lines = new ArrayList<>();

    public void addLine(OrderLine line) {
        lines.add(line);
    }

    public List<OrderLine> lines() {
        return List.copyOf(lines);
    }
}
```

## 19.3 Builder

```java
OrderBuilder builder = new OrderBuilder();
builder.addLine(...);
Order order = builder.build();
```

Builder mutable, final object immutable.

## 19.4 Copy-on-write update

```java
Order withAddedLine(OrderLine line) {
    List<OrderLine> copy = new ArrayList<>(lines);
    copy.add(line);
    return new Order(copy);
}
```

## 19.5 Rule

Choose mutation policy deliberately: immutable, controlled mutable, builder, or copy-on-write.

---

# 20. Copy-on-Write and Snapshot Iteration

`CopyOnWriteArrayList` is a thread-safe variant where mutations copy the underlying array.

## 20.1 Snapshot iterator

Iterator sees state at iterator creation time.

## 20.2 Good use cases

- listener lists;
- read-heavy/write-rarely;
- small-ish collections;
- no locking during iteration.

## 20.3 Bad use cases

- frequent writes;
- large collections;
- hot mutation path.

## 20.4 Example

```java
CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();

for (Listener listener : listeners) {
    listener.onEvent(event);
}
```

Listeners can be added concurrently without `ConcurrentModificationException`.

## 20.5 Rule

Copy-on-write is for read-mostly concurrency, not generic immutability.

---

# 21. Persistent/Functional Collections Concept

Java standard library does not provide full persistent immutable collections like some functional libraries.

## 21.1 Persistent collection

A persistent collection returns new version on update while sharing structure with old version.

Concept:

```java
list2 = list1.plus(x)
```

`list1` remains unchanged.

## 21.2 Java copy approach

```java
List<T> copy = new ArrayList<>(old);
copy.add(x);
return List.copyOf(copy);
```

This copies whole list.

## 21.3 Trade-off

Simple and safe, but O(n) copy per update.

## 21.4 When to consider libraries

If you need frequent immutable updates to large structures, consider persistent collection libraries. Evaluate dependency carefully.

## 21.5 Rule

JDK immutable collections are excellent for snapshots/constants, not structural-sharing persistent updates.

---

# 22. Safe Publication and Concurrency

## 22.1 Immutable collections help sharing

If object is safely published and collection/elements are immutable, readers can share without locks.

## 22.2 final field

```java
public final class Config {
    private final Map<String, Rule> rules;

    public Config(Map<String, Rule> rules) {
        this.rules = Map.copyOf(rules);
    }
}
```

Final field + immutable state helps safe publication.

## 22.3 Volatile snapshot

```java
private volatile List<Rule> rules = List.of();

public void reload(List<Rule> newRules) {
    rules = List.copyOf(newRules);
}

public List<Rule> rules() {
    return rules;
}
```

## 22.4 Mutable element warning

If `Rule` mutable, immutable list not enough.

## 22.5 Rule

Immutable snapshots are one of the simplest concurrency tools.

---

# 23. Mutable Collections in Concurrent Maps

## 23.1 Common bug

```java
ConcurrentHashMap<UserId, List<Permission>> map = new ConcurrentHashMap<>();

map.computeIfAbsent(userId, id -> new ArrayList<>())
   .add(permission);
```

Map is thread-safe, ArrayList is not.

## 23.2 Safer immutable update

```java
map.compute(userId, (id, old) -> {
    List<Permission> copy = old == null
        ? new ArrayList<>()
        : new ArrayList<>(old);

    copy.add(permission);
    return List.copyOf(copy);
});
```

## 23.3 Alternative concurrent value

```java
ConcurrentHashMap<UserId, Set<Permission>> map;
Set<Permission> set = ConcurrentHashMap.newKeySet();
```

But value semantics still need design.

## 23.4 Rule

Concurrent container does not make nested mutable objects safe.

---

# 24. SubList, Reversed Views, and View Retention

## 24.1 subList

```java
List<T> pageView = list.subList(from, to);
```

View backed by original list.

## 24.2 reversed

```java
SequencedCollection<T> reversed = collection.reversed();
```

View with reversed encounter order.

## 24.3 Map views

```java
map.keySet()
map.values()
map.entrySet()
```

Live views.

## 24.4 Risks

- backing mutation visible;
- view mutation affects backing;
- long-lived small view may retain large backing structure;
- concurrent mutation can cause failure.

## 24.5 Boundary copy

```java
List<T> page = List.copyOf(list.subList(from, to));
List<T> newestFirst = List.copyOf(events.reversed());
Set<K> keys = Set.copyOf(map.keySet());
```

## 24.6 Rule

Views are for short-lived internal operations. Snapshots are for boundaries.

---

# 25. Collections in API Boundaries

## 25.1 Request DTO

Request collections are untrusted.

Need:

- null check;
- max size;
- duplicate policy;
- defensive copy;
- element validation;
- canonicalization.

## 25.2 Response DTO

Response collections should be stable snapshots.

Do not expose internal mutable domain collection.

## 25.3 Example

```java
record BulkCloseRequest(List<CaseId> caseIds) {
    BulkCloseRequest {
        caseIds = List.copyOf(caseIds);
        if (caseIds.isEmpty()) {
            throw new IllegalArgumentException("caseIds required");
        }
        if (caseIds.size() > 100) {
            throw new IllegalArgumentException("too many caseIds");
        }
    }
}
```

## 25.4 API schema

Document:

- minItems;
- maxItems;
- uniqueItems;
- null item policy;
- order.

## 25.5 Rule

Never trust inbound collection ownership or size.

---

# 26. Collections in Domain Objects

## 26.1 Immutable value object

```java
record ViolationList(List<Violation> values) {
    ViolationList {
        values = List.copyOf(values);
        if (values.isEmpty()) {
            throw new IllegalArgumentException("at least one violation");
        }
    }
}
```

## 26.2 Mutable aggregate

```java
public final class Case {
    private final List<CaseEvent> events = new ArrayList<>();

    public void appendEvent(CaseEvent event) {
        events.add(event);
    }

    public List<CaseEvent> events() {
        return List.copyOf(events);
    }
}
```

## 26.3 Invariant protection

Do not let caller mutate collection and bypass invariant.

## 26.4 Domain operations

Prefer:

```java
case.latestEvent()
case.hasViolation(code)
case.totalPenalty()
```

over exposing collections for external logic.

## 26.5 Rule

Domain object owns its collections.

---

# 27. Collections in Persistence Entities

ORM entities often have mutable collections.

## 27.1 JPA/Hibernate collections

Entity collections may be proxies/lazy-loaded.

Returning them directly to API is dangerous.

## 27.2 Problems

- lazy loading outside transaction;
- N+1;
- mutation bypassing aggregate methods;
- serialization cycles;
- dirty tracking surprises.

## 27.3 Pattern

Entity internal mutable collection:

```java
@OneToMany
private List<OrderLineEntity> lines = new ArrayList<>();
```

Domain/API snapshot:

```java
List<OrderLine> toDomainLines() {
    return lines.stream()
        .map(OrderLineEntity::toDomain)
        .toList();
}
```

## 27.4 Do not expose entity collection

```java
public List<OrderLineEntity> getLines() {
    return lines; // dangerous
}
```

## 27.5 Rule

Persistence collection mutability is infrastructure concern; do not leak it as domain/API ownership.

---

# 28. Collections in Events and Messages

## 28.1 Event payload must be immutable snapshot

Bad:

```java
eventPublisher.publish(new CaseClosedEvent(case.events()));
```

if `case.events()` live mutable list.

## 28.2 Good

```java
eventPublisher.publish(new CaseClosedEvent(List.copyOf(case.events())));
```

or event constructor copies.

## 28.3 Why

Events should represent facts at a point in time.

Later mutation must not alter published event object.

## 28.4 Event schema

Bound collection size.

Large arrays in events can hurt broker/storage.

## 28.5 Rule

Events should own immutable snapshots of collection data.

---

# 29. Collections in Cache

## 29.1 Cache value as mutable collection

Bad:

```java
cache.put(key, mutableList);
```

Caller retrieves and mutates cached value.

## 29.2 Good

```java
cache.put(key, List.copyOf(result));
```

Return:

```java
return cache.get(key);
```

if values immutable.

## 29.3 Deep immutability

Cached values should contain immutable elements.

## 29.4 Cache key

Also immutable.

## 29.5 Rule

Cache keys and values should be immutable snapshots.

---

# 30. Performance Cost of Copying

Copying has cost.

## 30.1 O(n)

```java
List.copyOf(list)
```

is O(n) in general.

## 30.2 Memory

Copy creates new structure unless optimized.

## 30.3 But bugs cost more

At boundaries, copying is often worth it.

## 30.4 Avoid repeated copies

Bad:

```java
for (...) {
    return List.copyOf(largeList);
}
```

Think lifecycle.

## 30.5 Large collection strategy

For very large collections:

- streaming boundary;
- pagination;
- immutable ownership transfer;
- chunking;
- specialized data structure;
- avoid retaining all.

## 30.6 Copy once

Copy at boundary, not repeatedly inside hot loop.

## 30.7 Rule

Copy deliberately: enough for safety, not blindly everywhere.

---

# 31. Security Implications

## 31.1 Permission set mutation

If caller can mutate permission collection, authorization can be bypassed.

## 31.2 Tenant scope collection

Mutable tenant IDs collection can cause cross-tenant access if changed after validation.

## 31.3 Request collection TOCTOU

Validate collection, then caller mutates before use.

Fix: copy before validation/use.

## 31.4 Logging

Mutable collection logged later may not represent state at decision time.

## 31.5 Cache poisoning

Mutable cached collection can be altered by caller.

## 31.6 Rule

Security-sensitive collections must be immutable snapshots with immutable elements.

---

# 32. Production Failure Modes

## 32.1 Record with mutable list

State changes after construction.

Fix: compact constructor with `List.copyOf`.

## 32.2 Unmodifiable view mistaken for immutable

Backing collection changes.

Fix: `copyOf`.

## 32.3 Mutable element inside immutable list

Element changes.

Fix: immutable elements/deep copy.

## 32.4 Exposed internal list

Caller clears internal state.

Fix: return snapshot/behavior methods.

## 32.5 subList leak

Small page retains large list.

Fix: copy page.

## 32.6 reversed view mutation surprise

Caller mutates reversed view and changes original.

Fix: copy before expose.

## 32.7 ConcurrentHashMap of ArrayList race

Fix: immutable values or concurrent value.

## 32.8 Event payload mutation after publish

Fix: event constructor defensive copy.

## 32.9 Cache value mutated by caller

Fix: immutable cached value.

## 32.10 Arrays.asList add failure

Fix: `new ArrayList<>(...)` if mutable needed.

## 32.11 Set.copyOf loses intended order

Fix: use `LinkedHashSet`/List if encounter order required.

## 32.12 Copy cost in hot path

Fix: clarify ownership and copy once.

## 32.13 ORM collection leaked to API

Fix: map to DTO snapshot.

## 32.14 Validated request mutated after validation

Fix: copy before validation.

---

# 33. Best Practices

## 33.1 At boundaries

- Copy inbound collections.
- Validate copied state.
- Return snapshots.
- Avoid live views across trust boundaries.
- Document ownership.

## 33.2 In domain

- Use immutable collection components in value objects.
- Use controlled mutation in aggregates.
- Expose behavior, not raw mutable collections.
- Make elements immutable.

## 33.3 In APIs

- Define min/max size.
- Define null/duplicate/order policy.
- Convert DTO collections to domain collections.

## 33.4 In concurrency

- Prefer immutable snapshots.
- Use volatile reference for reloadable config snapshots.
- Do not put mutable lists inside concurrent maps without protection.
- Use CopyOnWrite only for read-mostly.

## 33.5 In cache/events

- Store immutable snapshots.
- Use immutable keys.
- Avoid mutable nested values.

## 33.6 In performance-sensitive code

- Use mutable local buffers.
- Copy once at boundary.
- Avoid repeated defensive copies in tight loops.
- Measure.

---

# 34. Decision Matrix

| Situation | Recommended |
|---|---|
| local accumulation | mutable `ArrayList`/`HashMap` |
| constructor stores collection | `copyOf` then validate |
| record collection component | compact constructor + `copyOf` |
| return domain collection | immutable internal or snapshot |
| return live internal state | avoid unless explicitly intended |
| read-only live view | `Collections.unmodifiable*` |
| immutable constants | `List.of` / `Set.of` / `Map.of` |
| existing collection snapshot | `copyOf` |
| mutable list from fixed values | `new ArrayList<>(List.of(...))` |
| mutable list from array | `new ArrayList<>(Arrays.asList(...))` |
| reverse traversal internal | `reversed()` view |
| reverse result boundary | `List.copyOf(reversed())` |
| subList page boundary | `List.copyOf(subList)` |
| read-mostly concurrent listeners | `CopyOnWriteArrayList` |
| reloadable config | volatile immutable snapshot |
| concurrent map of collections | immutable values with `compute` |
| security-sensitive collection | deep immutable/canonicalized snapshot |
| huge collection boundary | pagination/streaming/chunking |

---

# 35. Latihan

## Latihan 1 — Unmodifiable View vs Copy

Buat:

```java
List<String> raw = new ArrayList<>();
List<String> view = Collections.unmodifiableList(raw);
List<String> copy = List.copyOf(raw);
```

Mutate `raw`. Bandingkan `view` dan `copy`.

## Latihan 2 — Record Defensive Copy

Refactor:

```java
record Order(List<OrderLine> lines) {}
```

agar:

- no null list;
- no null element;
- non-empty;
- immutable structure.

## Latihan 3 — Mutable Element

Buat immutable list berisi mutable `User`. Mutate user. Jelaskan kenapa list tetap berubah secara logical.

## Latihan 4 — Event Snapshot

Design event:

```java
CaseClosedEvent(List<CaseEvent> history)
```

dengan defensive copy dan max size validation.

## Latihan 5 — Concurrent Map Value

Refactor:

```java
ConcurrentHashMap<UserId, List<Permission>>
```

agar update permission aman.

## Latihan 6 — subList Boundary

Buat page dari large list dengan `subList`, lalu copy. Jelaskan bedanya view vs snapshot.

## Latihan 7 — Cache Value

Design cache yang menyimpan `Map<CaseId, List<CaseSummary>>`.

Pastikan key/value immutable.

## Latihan 8 — Ownership Documentation

Tulis JavaDoc untuk method:

```java
void process(List<Item> items)
```

dalam tiga versi:

1. does not mutate;
2. mutates input;
3. stores snapshot.

## Latihan 9 — Copy Cost

Benchmark/analisa cost `List.copyOf` untuk 10, 1000, 1_000_000 elements.

Kapan copy acceptable?

## Latihan 10 — API Request Collection

Design request object untuk bulk operation dengan:

- max 100 IDs;
- reject duplicates;
- immutable list;
- preserve request order.

---

# 36. Ringkasan

Mutability adalah ownership problem.

Core lessons:

- Mutable collection aman dalam owned local scope.
- Unmodifiable view bukan immutable copy.
- Immutable copy memutus aliasing struktur collection.
- `copyOf` shallow, bukan deep.
- Immutable collection tidak membuat mutable elements immutable.
- `Collections.unmodifiable*` menghasilkan live read-only view.
- `List.copyOf`, `Set.copyOf`, `Map.copyOf` menghasilkan unmodifiable copies dan reject null.
- `List.of`, `Set.of`, `Map.of` cocok untuk constants.
- `Arrays.asList` fixed-size dan backed by array.
- Records dengan collection components perlu defensive copy.
- Views seperti `subList`, `reversed`, `keySet`, `values`, `entrySet` sering live views.
- Immutable snapshots membantu concurrency dan safe publication.
- Concurrent container tidak melindungi nested mutable values.
- Events/cache/security-sensitive data harus snapshot immutable.
- Copying punya cost, tapi boundary safety sering lebih penting.
- Copy sekali di boundary, bukan berulang di hot loop.

Main rule:

```text
Every collection crossing a boundary must answer:
Who owns it?
Who can mutate it?
Is it live or snapshot?
Are its elements immutable?
```

---

# 37. Referensi

1. Java SE 25 — `List.copyOf` and Unmodifiable Lists  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

2. Java SE 25 — `Set.copyOf`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Set.html

3. Java SE 25 — `Map.copyOf`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

4. Java SE 25 — `Collections`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html

5. Java SE 25 — `Arrays.asList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html

6. Java SE 25 — `CopyOnWriteArrayList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CopyOnWriteArrayList.html

7. Java SE 25 — Collections Framework Overview  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/doc-files/coll-overview.html

8. Java SE 25 — `SequencedCollection.reversed`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SequencedCollection.html

9. Java SE 25 — `Collections.unmodifiableList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html#unmodifiableList(java.util.List)

10. Java SE 25 — `Collections.unmodifiableMap`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html#unmodifiableMap(java.util.Map)

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-collections-and-streams-part-009.md">⬅️ Java Collections and Streams — Part 009</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-collections-and-streams-part-011.md">Java Collections and Streams — Part 011 ➡️</a>
</div>
