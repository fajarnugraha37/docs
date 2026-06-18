# learn-java-data-types-part-020.md

# Java Data Types — Part 020  
# Mutability, Immutability, Defensive Copy, dan Ownership

> Seri: **Advanced Java Data Types**  
> Bagian: **020**  
> Fokus: memahami mutability sebagai bagian dari desain data type: object identity vs state, final reference vs immutable object, shallow vs deep immutability, defensive copy, ownership transfer, representation exposure, records, arrays, collections, thread-safety, safe publication, persistent design, dan bagaimana membuat domain model lebih aman di production.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Kenapa Mutability Adalah Masalah Besar](#2-kenapa-mutability-adalah-masalah-besar)
3. [Mental Model: Value, Reference, Object, State, Owner](#3-mental-model-value-reference-object-state-owner)
4. [Mutability vs Immutability](#4-mutability-vs-immutability)
5. [`final` Reference Bukan Immutable Object](#5-final-reference-bukan-immutable-object)
6. [Shallow Immutability vs Deep Immutability](#6-shallow-immutability-vs-deep-immutability)
7. [Records dan Shallow Immutability](#7-records-dan-shallow-immutability)
8. [Arrays: Mutable by Nature](#8-arrays-mutable-by-nature)
9. [Collections: Mutable, Unmodifiable, Immutable](#9-collections-mutable-unmodifiable-immutable)
10. [Unmodifiable View vs Immutable Snapshot](#10-unmodifiable-view-vs-immutable-snapshot)
11. [Defensive Copy](#11-defensive-copy)
12. [Representation Exposure](#12-representation-exposure)
13. [Ownership: Borrow, Share, Copy, Move](#13-ownership-borrow-share-copy-move)
14. [Input Ownership Policy](#14-input-ownership-policy)
15. [Output Ownership Policy](#15-output-ownership-policy)
16. [Copy-on-Write](#16-copy-on-write)
17. [Persistent/Functional Update Style](#17-persistentfunctional-update-style)
18. [Mutable Entity vs Immutable Value Object](#18-mutable-entity-vs-immutable-value-object)
19. [Immutable Domain Commands and Events](#19-immutable-domain-commands-and-events)
20. [Builder Pattern dan Mutability Boundary](#20-builder-pattern-dan-mutability-boundary)
21. [Thread-Safety dan Immutability](#21-thread-safety-dan-immutability)
22. [Safe Publication dan Final Fields](#22-safe-publication-dan-final-fields)
23. [Volatile Reference vs Mutable Object](#23-volatile-reference-vs-mutable-object)
24. [Mutable Collections in Concurrent Code](#24-mutable-collections-in-concurrent-code)
25. [Caching dan Mutability](#25-caching-dan-mutability)
26. [Serialization/Deserialization dan Mutability](#26-serializationdeserialization-dan-mutability)
27. [ORM/JPA dan Mutability](#27-ormjpa-dan-mutability)
28. [API Boundary dan DTO Mutability](#28-api-boundary-dan-dto-mutability)
29. [Security-Sensitive Mutable Data](#29-security-sensitive-mutable-data)
30. [Performance Trade-Offs](#30-performance-trade-offs)
31. [Design Patterns](#31-design-patterns)
32. [Anti-Patterns](#32-anti-patterns)
33. [Production Failure Modes](#33-production-failure-modes)
34. [Best Practices](#34-best-practices)
35. [Decision Matrix](#35-decision-matrix)
36. [Latihan](#36-latihan)
37. [Ringkasan](#37-ringkasan)
38. [Referensi](#38-referensi)

---

# 1. Tujuan Bagian Ini

Mutability adalah salah satu sumber bug paling licin di Java.

Contoh sederhana:

```java
public record Tags(List<String> values) {}
```

Terlihat immutable karena record.

Tapi:

```java
List<String> raw = new ArrayList<>();
Tags tags = new Tags(raw);

raw.add("urgent");

System.out.println(tags.values()); // [urgent]
```

Record-nya tidak berubah referensinya, tetapi isi list berubah.

Contoh lain:

```java
public record Digest(byte[] bytes) {}
```

Caller bisa mutate:

```java
byte[] b = digest.bytes();
b[0] = 99;
```

Jika accessor mengembalikan internal array, state object bocor.

Tujuan bagian ini:

- memahami mutability sebagai property object graph;
- membedakan `final` dan immutable;
- memahami shallow vs deep immutability;
- memahami records tidak otomatis deep immutable;
- memahami defensive copy;
- memahami ownership policy;
- memahami unmodifiable view vs immutable snapshot;
- memahami thread-safety dan safe publication;
- memahami kapan mutable entity tepat;
- memahami production bugs akibat mutable state bocor.

---

# 2. Kenapa Mutability Adalah Masalah Besar

Mutable state berarti nilai object bisa berubah setelah dibuat.

```java
List<String> list = new ArrayList<>();
list.add("a");
list.add("b");
```

Ini normal dan berguna.

Masalah muncul ketika:

- banyak owner memegang reference yang sama;
- object digunakan sebagai key;
- object dishare antar thread;
- invariant bisa dilanggar setelah construction;
- internal collection/array bocor;
- cache menyimpan mutable object;
- DTO mutable berubah di tengah proses;
- event/command yang seharusnya fakta immutable bisa berubah.

## 2.1 Bug karena aliasing

```java
List<String> original = new ArrayList<>();
List<String> alias = original;

alias.add("x");

System.out.println(original); // [x]
```

Dua variable menunjuk object yang sama.

## 2.2 Bug karena mutable key

```java
Set<Tags> set = new HashSet<>();
List<String> raw = new ArrayList<>(List.of("a"));

Tags tags = new Tags(raw);
set.add(tags);

raw.add("b");

set.contains(tags); // bisa false
```

Hash berubah setelah object masuk HashSet.

## 2.3 Bug karena concurrency

Thread A membaca list ketika Thread B mutate.

Bisa terjadi:

- stale read;
- inconsistent state;
- `ConcurrentModificationException`;
- data race;
- lost update;
- invariant broken.

## 2.4 Bug karena boundary

API menerima list dari caller lalu menyimpan reference. Caller mutate setelah validation.

```java
Order(List<OrderLine> lines) {
    validate(lines);
    this.lines = lines; // unsafe
}
```

## 2.5 Senior mindset

Pertanyaan utama:

```text
Siapa owner data ini?
Siapa boleh mutate?
Kapan boleh mutate?
Apakah caller bisa melihat/mengubah internal state?
Apakah object ini aman dishare?
```

---

# 3. Mental Model: Value, Reference, Object, State, Owner

## 3.1 Value

Primitive value:

```java
int x = 10;
```

Tidak punya identity.

## 3.2 Reference

Reference menunjuk object.

```java
List<String> list = new ArrayList<>();
```

Variable `list` menyimpan reference.

## 3.3 Object

Object di heap punya identity dan state.

```java
new ArrayList<>()
```

## 3.4 State

State adalah data internal object.

```java
ArrayList internal array + size
```

## 3.5 Owner

Owner adalah pihak yang bertanggung jawab atas mutation/lifecycle.

Java tidak punya ownership system seperti Rust.

Jadi ownership harus didesain lewat:

- encapsulation;
- defensive copy;
- immutability;
- documentation;
- API contract.

## 3.6 Aliasing

Aliasing berarti banyak reference ke object yang sama.

```java
var a = new ArrayList<String>();
var b = a;
```

Mutating `b` mutates object observed through `a`.

## 3.7 Core rule

```text
Every mutable object needs an ownership story.
```

Jika tidak, bug akan muncul.

---

# 4. Mutability vs Immutability

## 4.1 Mutable object

State can change after construction.

```java
ArrayList
HashMap
StringBuilder
Date legacy
AtomicInteger
```

## 4.2 Immutable object

State cannot change after construction.

```java
String
Integer
BigDecimal
LocalDate
Instant
record with immutable components
```

## 4.3 Immutable API

Methods return new object:

```java
LocalDate tomorrow = today.plusDays(1);
```

`today` unchanged.

## 4.4 Mutable API

Methods modify same object:

```java
list.add("x");
builder.append("x");
```

## 4.5 Benefits of immutability

- simpler reasoning;
- safe sharing;
- thread-safety;
- stable hashCode;
- easier caching;
- easier testing;
- no defensive copy needed if components immutable;
- valid-after-construction invariant.

## 4.6 Costs of immutability

- more object creation;
- copying large data;
- awkward update flows;
- ORM/framework friction;
- not ideal for large mutable aggregates without design.

## 4.7 Rule

Use immutable by default for values, commands, events, DTO snapshots.

Use mutable deliberately for entities, builders, buffers, caches, infrastructure.

---

# 5. `final` Reference Bukan Immutable Object

This is crucial.

```java
final List<String> names = new ArrayList<>();
names.add("Fajar"); // allowed
```

`final` prevents reassignment:

```java
names = new ArrayList<>(); // compile error
```

But it does not prevent object mutation.

## 5.1 final field

```java
private final List<String> values;
```

The field reference cannot point to another list after construction.

But the list object may be mutable.

## 5.2 final class

```java
final class User {}
```

Prevents subclassing, not mutation.

## 5.3 final record components

Record components are final fields, but component objects may be mutable.

## 5.4 final array reference

```java
final byte[] bytes = new byte[10];
bytes[0] = 1; // allowed
```

## 5.5 Mental model

```text
final protects the reference slot, not the object graph.
```

## 5.6 Safe use

Final fields are still valuable for:

- construction safety;
- clear invariant;
- safe publication benefits under JMM;
- preventing reassignment bugs.

But not enough for immutability.

---

# 6. Shallow Immutability vs Deep Immutability

## 6.1 Shallow immutability

Object's own fields cannot be reassigned, but referenced objects can mutate.

```java
record UserRoles(Set<Role> roles) {}
```

If `roles` mutable, record is shallow immutable only.

## 6.2 Deep immutability

Entire object graph reachable from object cannot mutate.

```java
record UserRoles(Set<Role> roles) {
    UserRoles {
        roles = Set.copyOf(roles);
    }
}
```

If `Role` is immutable enum/value object, this is deeply immutable enough.

## 6.3 Deep copy

If elements mutable:

```java
List<MutableLine>
```

`List.copyOf` only copies list structure, not elements.

Need deep copy or immutable elements.

## 6.4 Practical immutability

Often we aim for practical immutability:

```text
No exposed mutation path through public API.
Components are immutable or treated as immutable.
```

## 6.5 Example

```java
record OrderLines(List<OrderLine> lines) {
    OrderLines {
        lines = List.copyOf(lines);
    }
}
```

If `OrderLine` immutable, good.

If `OrderLine` mutable, not deep immutable.

---

# 7. Records dan Shallow Immutability

Java SE 25 `Record` API explicitly describes record classes as shallowly immutable transparent carriers for fixed sets of values.

```java
record Point(int x, int y) {}
```

Good because components primitive.

But:

```java
record Tags(List<String> values) {}
```

Only shallowly immutable.

## 7.1 Record with immutable components

```java
record CaseId(String value) {}
record Money(BigDecimal amount, Currency currency) {}
record DateRange(LocalDate start, LocalDate end) {}
```

Good.

## 7.2 Record with collection component

```java
record Tags(List<String> values) {
    Tags {
        values = List.copyOf(values);
    }
}
```

Better.

## 7.3 Record with array component

Dangerous.

```java
record Digest(byte[] bytes) {}
```

Need copy + custom equality.

## 7.4 Generated accessor exposes component

Record accessors expose component as-is unless overridden.

```java
tags.values()
```

returns internal list reference.

If internal list unmodifiable snapshot, okay.

If array, unsafe.

## 7.5 Record toString

Generated `toString` may expose sensitive/mutable fields.

Override for secrets/large payloads.

---

# 8. Arrays: Mutable by Nature

Arrays are always mutable.

```java
int[] values = {1, 2, 3};
values[0] = 99;
```

Even if reference final:

```java
final int[] values = {1, 2, 3};
values[0] = 99;
```

## 8.1 Array as field

Bad:

```java
final class Digest {
    private final byte[] bytes;

    Digest(byte[] bytes) {
        this.bytes = bytes;
    }

    byte[] bytes() {
        return bytes;
    }
}
```

Caller can mutate input and output.

## 8.2 Defensive copy

```java
final class Digest {
    private final byte[] bytes;

    Digest(byte[] bytes) {
        this.bytes = bytes.clone();
    }

    byte[] bytes() {
        return bytes.clone();
    }
}
```

## 8.3 Equals/hashCode

Array equals is identity.

Use:

```java
Arrays.equals(bytes, other.bytes)
Arrays.hashCode(bytes)
```

## 8.4 Large arrays

Copying large arrays is expensive.

Need ownership policy:

- copy defensively;
- transfer ownership;
- read-only wrapper;
- ByteBuffer read-only view;
- streaming.

## 8.5 Security arrays

For secrets, arrays can be wiped:

```java
Arrays.fill(bytes, (byte) 0);
```

But copies may exist.

## 8.6 Rule

Never expose internal mutable array unless explicitly transferring ownership and documented.

---

# 9. Collections: Mutable, Unmodifiable, Immutable

Collections vary.

## 9.1 Mutable

```java
new ArrayList<>()
new HashMap<>()
```

## 9.2 Unmodifiable factory

`List.of` and `List.copyOf` create unmodifiable lists. Java SE 25 `List` API describes `List.of` and `List.copyOf` as convenient ways to create unmodifiable lists and lists produced by these methods reject null elements.

```java
List<String> list = List.of("a", "b");
```

## 9.3 Unmodifiable view

```java
Collections.unmodifiableList(mutableList)
```

Java SE 25 `Collections` API describes wrappers that return new collections backed by specified collections.

## 9.4 Unmodifiable not necessarily immutable

Java SE 25 `Collection` API notes that an unmodifiable collection is not necessarily immutable; if contained elements are mutable, the entire collection is clearly mutable.

## 9.5 Immutable snapshot

```java
List<String> copy = List.copyOf(source);
```

Snapshot of collection structure.

## 9.6 Elements still matter

```java
List<MutableUser> users = List.copyOf(source);
```

List unmodifiable, but `MutableUser` objects can mutate.

## 9.7 Rule

```text
Unmodifiable collection prevents structural mutation through that reference.
It does not guarantee deep immutability.
```

---

# 10. Unmodifiable View vs Immutable Snapshot

## 10.1 Unmodifiable view

```java
List<String> mutable = new ArrayList<>();
List<String> view = Collections.unmodifiableList(mutable);

mutable.add("x");

System.out.println(view); // [x]
```

The view reflects underlying list mutation.

## 10.2 Immutable snapshot

```java
List<String> mutable = new ArrayList<>();
List<String> snapshot = List.copyOf(mutable);

mutable.add("x");

System.out.println(snapshot); // []
```

The snapshot is independent.

## 10.3 When use view

Use view when:

- you own underlying collection;
- live view semantics desired;
- callers should observe updates but not mutate.

Example:

```java
Map<Key, Value> internal state exposed read-only for monitoring
```

Even then, concurrency risks.

## 10.4 When use snapshot

Use snapshot for:

- domain value objects;
- constructor defensive copy;
- API response;
- immutable events/commands;
- safe publication.

## 10.5 Common bug

Developer thinks:

```java
Collections.unmodifiableList(list)
```

makes data immutable.

It does not.

---

# 11. Defensive Copy

Defensive copy means copying mutable input/output to protect internal state.

## 11.1 Constructor copy

```java
public Order(List<OrderLine> lines) {
    this.lines = List.copyOf(lines);
}
```

## 11.2 Accessor copy

If internal object mutable:

```java
public byte[] bytes() {
    return bytes.clone();
}
```

If internal list is already unmodifiable snapshot, returning it is okay.

## 11.3 Copy before validation or after?

Usually:

```java
List<OrderLine> copy = List.copyOf(lines);
validate(copy);
this.lines = copy;
```

This prevents caller mutation during/after validation.

## 11.4 Deep copy

If elements mutable:

```java
this.lines = lines.stream()
    .map(OrderLine::copy)
    .toList();
```

Need copy constructor/factory.

## 11.5 Copy cost

Defensive copy has cost. But for domain boundary, correctness usually worth it.

## 11.6 Hot path

For performance-critical code, document ownership transfer instead of copying blindly.

---

# 12. Representation Exposure

Representation exposure occurs when internal mutable state is exposed.

## 12.1 Exposure through accessor

```java
public List<Item> items() {
    return items; // if mutable, unsafe
}
```

## 12.2 Exposure through constructor

```java
this.items = items; // stores caller-owned mutable list
```

## 12.3 Exposure through array

```java
return internalBytes;
```

## 12.4 Exposure through view

```java
return Collections.unmodifiableList(items);
```

Still exposes live changes if internal mutates.

May be okay if intended.

## 12.5 Exposure through element mutability

```java
List.copyOf(mutableUsers)
```

does not protect users.

## 12.6 Fix

- immutable components;
- defensive copy;
- unmodifiable snapshot;
- deep copy;
- domain-specific read model;
- no direct accessor.

---

# 13. Ownership: Borrow, Share, Copy, Move

Java does not enforce ownership, but API can define it.

## 13.1 Borrow

Method uses object temporarily and does not retain reference.

```java
void validate(List<Item> items)
```

No mutation/retention.

## 13.2 Share

Object is shared and should not be mutated or must be thread-safe.

```java
List<String> sharedConfig = List.copyOf(config);
```

## 13.3 Copy

Callee copies input and owns copy.

```java
this.items = List.copyOf(items);
```

## 13.4 Move/transfer ownership

Caller gives object and must not use/mutate afterwards.

Java cannot enforce.

```java
Buffer takeOwnership(Buffer buffer)
```

Use only in performance-sensitive internal APIs with clear docs.

## 13.5 Mutable ownership

If one owner mutates, other observers must not see inconsistent state.

## 13.6 Rule

Public APIs should prefer copy/share immutable.

Internal hot paths may use transfer ownership with discipline.

---

# 14. Input Ownership Policy

When accepting input object, choose policy.

## 14.1 Trust and store

```java
this.items = items;
```

Fast but unsafe unless items immutable/owned.

## 14.2 Copy

```java
this.items = List.copyOf(items);
```

Safe default.

## 14.3 Validate only

```java
validate(items);
```

If not stored, okay.

## 14.4 Mutate input

```java
items.sort(...)
```

Surprising unless documented.

Better copy first:

```java
var sorted = new ArrayList<>(items);
sorted.sort(...);
```

## 14.5 Ownership transfer

Only in low-level/internal APIs.

Document:

```text
The caller must not modify the buffer after passing it.
```

## 14.6 Domain constructor

Domain constructors should almost always copy mutable input.

---

# 15. Output Ownership Policy

When returning object, decide who owns it.

## 15.1 Return internal mutable

Bad:

```java
return items;
```

if items mutable.

## 15.2 Return unmodifiable internal

```java
return items; // if items is List.copyOf snapshot
```

Good.

## 15.3 Return copy

```java
return new ArrayList<>(items);
```

Caller owns copy.

## 15.4 Return view

```java
return Collections.unmodifiableList(items);
```

Caller sees live changes but cannot mutate through view.

## 15.5 Return stream

```java
return items.stream();
```

Be careful: stream source mutability/concurrency matters.

## 15.6 API docs

Document whether returned collection is modifiable, snapshot, live view, ordered, thread-safe.

---

# 16. Copy-on-Write

Copy-on-write means copy structure on mutation.

## 16.1 JDK example

`CopyOnWriteArrayList` copies underlying array on mutative operations.

Good for read-heavy, write-rare.

## 16.2 Manual copy-on-write

```java
final class ConfigRegistry {
    private volatile Map<String, Config> configs = Map.of();

    void update(String key, Config config) {
        Map<String, Config> copy = new HashMap<>(configs);
        copy.put(key, config);
        configs = Map.copyOf(copy);
    }

    Config get(String key) {
        return configs.get(key);
    }
}
```

Readers see immutable snapshots.

## 16.3 Benefits

- readers lock-free-ish;
- no mutation of published state;
- easy reasoning.

## 16.4 Costs

- writes copy whole structure;
- memory churn for large structures;
- not good for write-heavy workloads.

## 16.5 Use cases

- configuration;
- routing tables;
- listener lists;
- feature flags snapshot.

---

# 17. Persistent/Functional Update Style

Immutable objects can update by returning new object.

```java
record UserProfile(DisplayName name, EmailAddress email) {
    UserProfile withName(DisplayName newName) {
        return new UserProfile(newName, email);
    }
}
```

## 17.1 Benefits

- old version remains valid;
- easy audit/versioning;
- no hidden mutation;
- safer concurrency.

## 17.2 Costs

- object creation;
- nested update boilerplate;
- large graph copying if not using persistent data structures.

## 17.3 Domain events

Events are facts and should be immutable.

```java
record CaseClosed(CaseId caseId, Instant occurredAt) {}
```

## 17.4 Entities

Entities can still mutate internally while exposing immutable snapshots/events.

## 17.5 Rule

Use immutable update style for value objects, commands, events, snapshots.

Use mutable methods for aggregate entities when lifecycle mutation is natural and controlled.

---

# 18. Mutable Entity vs Immutable Value Object

## 18.1 Value object

Immutable.

```java
record Money(BigDecimal amount, Currency currency) {}
record CaseId(String value) {}
```

## 18.2 Entity

Can be mutable because identity stable.

```java
final class CaseRecord {
    private final CaseId id;
    private CaseState state;

    void close(ClosureReason reason, OfficerId actor, Clock clock) {
        ...
        this.state = new Closed(actor, reason, clock.instant());
    }
}
```

## 18.3 Controlled mutation

Entity mutation should happen through domain methods, not setters.

Bad:

```java
setStatus(CLOSED)
setClosedAt(now)
setReason(reason)
```

Good:

```java
close(reason, actor, clock)
```

## 18.4 Invariant maintenance

Domain method updates all related fields/state atomically.

## 18.5 Entity exposure

Do not expose mutable internal collections of entity.

## 18.6 Snapshot

Entity can produce immutable snapshot:

```java
CaseSnapshot snapshot()
```

---

# 19. Immutable Domain Commands and Events

Commands and events should usually be immutable.

## 19.1 Command

```java
record CloseCaseCommand(CaseId caseId, OfficerId actorId, ClosureReason reason) {}
```

Command represents request/intention.

It should not change while being handled.

## 19.2 Event

```java
record CaseClosed(CaseId caseId, OfficerId closedBy, Instant occurredAt) {}
```

Event is fact that happened.

Changing event after publication is dangerous.

## 19.3 Defensive copy

If command/event has collection:

```java
record BulkCloseCommand(List<CaseId> caseIds) {
    BulkCloseCommand {
        caseIds = List.copyOf(caseIds);
    }
}
```

## 19.4 Serialization

Immutable events are safer for async systems.

## 19.5 Audit

Immutable event supports audit trust.

---

# 20. Builder Pattern dan Mutability Boundary

Builder is mutable object used to construct immutable object.

## 20.1 Builder mutable

```java
final class UserBuilder {
    private String name;
    private String email;

    UserBuilder name(String name) {
        this.name = name;
        return this;
    }

    User build() {
        return new User(new DisplayName(name), new EmailAddress(email));
    }
}
```

## 20.2 Boundary

Mutation is confined to builder.

Built object immutable.

## 20.3 Builder reuse

Do not reuse builder accidentally.

```java
var builder = new UserBuilder();
User a = builder.name("A").build();
User b = builder.email("b@example.com").build(); // maybe name still A
```

## 20.4 Builder validation

Final validation in build/domain constructors.

## 20.5 Builder for records

Records with many optional fields may use builder, but reconsider design if too many fields.

## 20.6 Thread-safety

Builders are usually not thread-safe.

---

# 21. Thread-Safety dan Immutability

Immutable objects are naturally thread-safe if properly constructed and safely published.

## 21.1 Share immutable

```java
List<Rule> rules = List.copyOf(rawRules);
```

If `Rule` immutable, can share safely.

## 21.2 Mutable objects need synchronization

```java
ArrayList
HashMap
StringBuilder
```

Not thread-safe for concurrent mutation.

## 21.3 Thread-safe wrapper

```java
Collections.synchronizedList(list)
```

Requires external synchronization for iteration.

## 21.4 Concurrent collections

```java
ConcurrentHashMap
CopyOnWriteArrayList
BlockingQueue
```

Use when concurrent mutation needed.

## 21.5 Thread-safe reference not enough

```java
volatile List<String> list;
```

Volatile reference ensures visibility of reference updates, not thread-safe mutation of list.

## 21.6 Immutable snapshot publication

```java
volatile List<Rule> rules = List.of();

void reload(List<Rule> newRules) {
    rules = List.copyOf(newRules);
}
```

Readers safe if elements immutable.

---

# 22. Safe Publication dan Final Fields

JLS Chapter 17 defines the Java Memory Model. It includes special rules for `final` fields that support initialization safety when objects are properly constructed.

## 22.1 Final fields help

```java
final class User {
    private final UserId id;
    private final DisplayName name;
}
```

Other threads that see properly published object are guaranteed to see final field values initialized.

## 22.2 But referenced mutable objects

Final field guarantee does not make referenced object immutable.

```java
private final List<String> names;
```

If list later mutates, synchronization still matters.

## 22.3 Do not let `this` escape during construction

Bad:

```java
class Foo {
    Foo() {
        Registry.register(this);
    }
}
```

Another thread might see partially constructed object.

## 22.4 Safe publication mechanisms

- final fields after proper construction;
- volatile reference write;
- synchronized block;
- thread start/join rules;
- concurrent collections;
- static initialization.

## 22.5 Immutable object pattern

```java
final class Value {
    private final String a;
    private final List<String> values;

    Value(String a, List<String> values) {
        this.a = Objects.requireNonNull(a);
        this.values = List.copyOf(values);
    }
}
```

---

# 23. Volatile Reference vs Mutable Object

## 23.1 Volatile reference

```java
private volatile List<String> rules = List.of();
```

Readers see latest list reference.

## 23.2 Mutating volatile object

Bad:

```java
rules.add("x"); // if mutable list
```

Volatile does not make list operations thread-safe.

## 23.3 Replace with immutable snapshot

Good:

```java
void addRule(String rule) {
    var copy = new ArrayList<>(rules);
    copy.add(rule);
    rules = List.copyOf(copy);
}
```

## 23.4 AtomicReference

```java
AtomicReference<State> state = new AtomicReference<>(initial);
```

Use compare-and-set for atomic state transitions.

## 23.5 Rule

Volatile/AtomicReference protects reference update, not internal mutable graph.

Prefer immutable state object.

---

# 24. Mutable Collections in Concurrent Code

## 24.1 ArrayList race

Concurrent add/read can corrupt behavior.

## 24.2 HashMap race

Concurrent mutation of HashMap is unsafe.

Use:

```java
ConcurrentHashMap
```

or synchronization.

## 24.3 Iterate while mutate

Fail-fast collections may throw.

Concurrent collections have weakly consistent iterators.

## 24.4 Compound actions

Even thread-safe collection does not make compound workflow atomic.

Bad:

```java
if (!map.containsKey(k)) {
    map.put(k, v);
}
```

Use:

```java
putIfAbsent
computeIfAbsent
compute
```

## 24.5 Immutable snapshot alternative

For read-heavy, use copy-on-write snapshots.

## 24.6 Domain rule

Avoid sharing mutable domain collections between threads.

---

# 25. Caching dan Mutability

Caches amplify mutability bugs.

## 25.1 Mutable object in cache

```java
cache.put(id, user);
```

Caller retrieves and mutates `user`, affecting cache.

## 25.2 Defensive copy on cache boundary

Options:

- store immutable value;
- copy on write;
- copy on read;
- expose read-only view;
- use DTO snapshot.

## 25.3 Cache key immutability

Cache keys must be immutable with stable equals/hashCode.

Good:

```java
record SearchCacheKey(TenantId tenantId, QueryHash queryHash) {}
```

Bad:

```java
List<String> filters as mutable key
```

## 25.4 Negative cache

If caching absence, model explicitly.

## 25.5 Expiration

Use immutable timestamp:

```java
Instant expiresAt
```

## 25.6 Rule

Cache immutable data or control mutation strictly.

---

# 26. Serialization/Deserialization dan Mutability

## 26.1 Deserialization creates objects

Framework may bypass normal construction in some cases or require special constructors.

Records usually call canonical constructor in many serialization contexts depending mechanism, but framework behavior varies.

## 26.2 Validate after deserialization

Never assume external data valid.

## 26.3 Mutable DTO

Frameworks often populate mutable DTOs.

Map to immutable domain object after validation.

## 26.4 Collections from JSON

Deserializer may create mutable lists.

Convert:

```java
List.copyOf(dto.items())
```

inside domain constructor/mapper.

## 26.5 Events

Serialized events should represent immutable facts.

Do not publish mutable object then mutate it later.

## 26.6 Defensive boundary

Treat deserialized data as untrusted.

---

# 27. ORM/JPA dan Mutability

ORM often encourages mutable entities:

- no-arg constructor;
- setters;
- proxies;
- lazy collections;
- dirty tracking.

## 27.1 Entity mutation

Mutable entity is acceptable if controlled.

```java
caseRecord.close(reason, actor, clock)
```

## 27.2 Avoid exposing ORM collections

JPA collection fields may be persistent mutable proxies.

Do not expose directly.

## 27.3 Domain vs persistence model

Sometimes separate:

```java
JpaCaseEntity
CaseRecord domain
```

## 27.4 Records for projections

Records are good for read models/projections.

## 27.5 Lazy loading is not absence

Do not model not-loaded as null/Optional.empty.

## 27.6 Transaction boundary

Mutable entities should not leak outside transaction boundary if they can lazy-load/mutate unpredictably.

---

# 28. API Boundary dan DTO Mutability

## 28.1 Request DTO

Mutable or record DTO is boundary object.

Validate/map to domain.

```java
record CloseCaseRequest(String caseId, String reason) {}
```

## 28.2 Response DTO

Should be immutable snapshot.

```java
record CaseResponse(String caseId, String status) {}
```

## 28.3 Do not expose domain internals

Don't return entity with mutable collections directly.

## 28.4 Pagination result

```java
record PageResponse<T>(List<T> items, PageInfo pageInfo) {
    PageResponse {
        items = List.copyOf(items);
    }
}
```

## 28.5 API list ordering

If list order matters, return immutable ordered list.

## 28.6 JSON serialization of mutable object

Object can mutate during serialization if shared concurrently. Use snapshot.

---

# 29. Security-Sensitive Mutable Data

Secrets and mutable arrays have tricky trade-offs.

## 29.1 String immutable problem

`String` cannot be cleared.

## 29.2 char[]/byte[] clearable

```java
Arrays.fill(password, '\0');
Arrays.fill(secret, (byte) 0);
```

## 29.3 Copy problem

Copies may exist in framework, logs, heap.

## 29.4 Ownership important

A secret wrapper may take ownership and clear on close.

## 29.5 Do not expose internal secret array

Return copy only if necessary.

## 29.6 toString

Always mask.

```java
Secret[masked]
```

## 29.7 Constant-time compare

Use appropriate crypto utilities for token/digest comparison.

---

# 30. Performance Trade-Offs

## 30.1 Copy cost

Defensive copy costs:

- CPU;
- memory;
- GC pressure.

## 30.2 Avoid unnecessary copy for known immutable

If input is already `List.copyOf` result, `List.copyOf` may reuse instance as implementation detail.

But do not rely on identity.

## 30.3 Large data

Copying large arrays/lists repeatedly can be expensive.

Use:

- ownership transfer;
- streaming;
- read-only buffers;
- slicing with careful lifecycle;
- immutable persistent structures;
- specialized data structures.

## 30.4 Small domain values

For typical business objects, copying small lists is worth safety.

## 30.5 Escape analysis

JVM may optimize some short-lived allocations.

Measure before micro-optimizing.

## 30.6 Benchmark

Use JMH/JFR, not intuition.

---

# 31. Design Patterns

## 31.1 Immutable Value Object

```java
record EmailAddress(String value) {
    EmailAddress {
        value = canonicalize(value);
    }
}
```

## 31.2 Defensive Copy Constructor

```java
record OrderLines(List<OrderLine> lines) {
    OrderLines {
        lines = List.copyOf(lines);
    }
}
```

## 31.3 Immutable Snapshot

```java
record CaseSnapshot(CaseId id, CaseState state, List<Event> recentEvents) {
    CaseSnapshot {
        recentEvents = List.copyOf(recentEvents);
    }
}
```

## 31.4 Mutable Builder -> Immutable Product

```java
User user = User.builder()
    .name(name)
    .email(email)
    .build();
```

## 31.5 Copy-on-Write State

```java
volatile Map<Key, Value> state = Map.of();
```

Update by replacing whole map.

## 31.6 Controlled Mutable Entity

```java
caseRecord.assign(officer, clock)
caseRecord.close(reason, actor, clock)
```

No public setters.

## 31.7 Read-only Interface

Expose behavior, not collection.

```java
boolean hasPermission(Permission permission)
```

instead of:

```java
Set<Permission> permissions()
```

if callers don't need full set.

---

# 32. Anti-Patterns

## 32.1 Getter returns mutable internal list

```java
return items;
```

## 32.2 Constructor stores caller list

```java
this.items = items;
```

## 32.3 Record with mutable component and no copy

```java
record Tags(List<String> values) {}
```

## 32.4 Array component in record without override

```java
record Digest(byte[] bytes) {}
```

## 32.5 `final` mistaken as immutable

```java
final List<String> values = new ArrayList<>();
```

## 32.6 Unmodifiable view mistaken as snapshot

```java
Collections.unmodifiableList(mutable)
```

## 32.7 Mutable cache values

Cache returns mutable object and callers mutate it.

## 32.8 Shared static mutable state

```java
static final List<String> VALUES = new ArrayList<>();
```

`final` static reference, mutable content.

## 32.9 Public mutable fields

```java
public List<Item> items;
```

## 32.10 Mutable DTO used as domain object

Boundary object leaks into domain logic.

---

# 33. Production Failure Modes

## 33.1 External list mutation after validation

Constructor validates list then stores same reference. Caller mutates invalid item later.

Fix:

```java
copy first, validate copy, store copy
```

## 33.2 HashMap key mutated

Mutable field changes hashCode.

Fix:

- immutable key;
- defensive copy;
- no mutable components.

## 33.3 Event mutated after publish

Async consumer sees changed event.

Fix:

- immutable event records;
- defensive copy collections.

## 33.4 Cache value mutated

One request modifies cached object; other users see modified data.

Fix:

- immutable cache values;
- copy on read/write.

## 33.5 Concurrent list mutation

`ConcurrentModificationException` or inconsistent response.

Fix:

- immutable snapshot;
- concurrent collection;
- synchronization.

## 33.6 Unmodifiable view reflects changes

API response object changes after creation.

Fix:

- copyOf snapshot.

## 33.7 Secret leaked by toString

Record generated toString includes token.

Fix:

- override toString;
- secret wrapper.

## 33.8 JPA collection exposed

Caller mutates lazy/persistent collection outside transaction.

Fix:

- return snapshot;
- domain methods.

## 33.9 Volatile mutable reference bug

Volatile list reference but list mutated in place.

Fix:

- replace immutable snapshots;
- concurrent collection.

## 33.10 Builder reused

Previous values leak into next object.

Fix:

- builders one-shot;
- reset explicitly;
- tests.

---

# 34. Best Practices

## 34.1 General

- Prefer immutable value objects.
- Use mutable entities only with controlled domain methods.
- Treat `final` as reference stability, not deep immutability.
- Copy mutable constructor inputs.
- Do not expose internal mutable collections/arrays.
- Use `List.copyOf`, `Set.copyOf`, `Map.copyOf` for snapshots.
- Use `Collections.unmodifiable*` only when live view intended.
- Avoid array components in records unless handled.
- Override equals/hashCode for array-backed values.
- Override toString for sensitive/large values.
- Use immutable commands/events.
- Use builders as temporary mutable boundary only.
- Use immutable snapshots for concurrent read-mostly state.
- Keep ownership policy clear.

## 34.2 Collections

- Prefer empty immutable collection over null.
- Avoid null elements.
- Copy before storing.
- Validate collection invariants.
- Do not return mutable internal collections.
- Remember unmodifiable collection may still contain mutable elements.

## 34.3 Concurrency

- Immutable object + safe publication is simplest.
- Volatile reference does not protect mutable internals.
- Use concurrent collections for concurrent mutation.
- Use atomic operations for compound map actions.
- Prefer copy-on-write snapshots for read-heavy config.

## 34.4 Boundary

- Treat external data as untrusted.
- Map mutable DTO to immutable domain.
- Create immutable response snapshots.
- Do not leak ORM mutable proxies.

---

# 35. Decision Matrix

| Situation | Recommended |
|---|---|
| value object | immutable record/class |
| entity aggregate | controlled mutable class or immutable state transitions |
| command/event | immutable record |
| constructor accepts list | `List.copyOf` |
| constructor accepts set/map | `Set.copyOf` / `Map.copyOf` |
| constructor accepts array | `clone` |
| accessor returns immutable list | return stored copyOf list |
| accessor returns array | return clone |
| expose live read-only view | `Collections.unmodifiable*` intentionally |
| read-heavy config | immutable snapshot + volatile reference |
| concurrent map updates | `ConcurrentHashMap` atomic methods |
| listener list read-heavy | `CopyOnWriteArrayList` |
| secret bytes | owner wrapper + clear + no exposure |
| large buffer hot path | explicit ownership transfer/read-only view |
| record with mutable collection | compact constructor copy |
| record with array | usually final class or custom equals/hashCode/copy |
| cache values | immutable/copy |
| API response | immutable snapshot DTO |
| ORM entity | mutable but not leaked |

---

# 36. Latihan

## Latihan 1 — final reference

Show:

```java
final List<String> list = new ArrayList<>();
list.add("x");
```

Explain why final doesn't prevent mutation.

## Latihan 2 — Record shallow immutability

Create:

```java
record Tags(List<String> values) {}
```

Mutate original list after construction. Fix with `List.copyOf`.

## Latihan 3 — Array representation exposure

Create `Digest(byte[] bytes)` unsafe. Mutate input/output. Fix with clone and custom equals/hashCode.

## Latihan 4 — Unmodifiable view vs snapshot

Compare:

```java
Collections.unmodifiableList(list)
List.copyOf(list)
```

after mutating original.

## Latihan 5 — HashMap mutable key

Use record with mutable list as key. Mutate list. Observe lookup issue.

## Latihan 6 — Immutable command

Create `BulkCloseCommand(List<CaseId> ids)` with defensive copy and non-empty validation.

## Latihan 7 — Entity controlled mutation

Create `CaseRecord` with private state and `close(...)` method, no setters.

## Latihan 8 — Copy-on-write config

Implement registry with volatile `Map.copyOf` snapshot.

## Latihan 9 — Concurrent map compound action

Refactor `containsKey` + `put` to `computeIfAbsent`.

## Latihan 10 — Secret wrapper

Implement `SecretBytes` with copy, clear, and masked `toString`.

## Latihan 11 — Builder reuse bug

Demonstrate builder reused accidentally. Make builder one-shot.

## Latihan 12 — Deep immutability

Create immutable `OrderLines` where `OrderLine` itself is immutable. Then make `OrderLine` mutable and explain why `List.copyOf` no longer enough.

---

# 37. Ringkasan

Mutability is not just “can this object change?”

It is about:

```text
who owns the object
who can mutate it
who can observe mutation
whether invariants survive
whether sharing is safe
```

Key lessons:

- `final` reference is not immutable object.
- Records are shallowly immutable.
- Arrays are always mutable.
- Collections can be mutable, unmodifiable view, or immutable snapshot.
- `Collections.unmodifiableList` is backed by original collection.
- `List.copyOf` creates an unmodifiable snapshot.
- Unmodifiable collection is not deeply immutable if elements mutable.
- Defensive copy protects invariants.
- Representation exposure leaks internal state.
- Immutable value objects are safest.
- Mutable entities are okay when mutation is controlled.
- Commands/events should be immutable.
- Immutable snapshots are powerful for concurrency.
- Volatile reference does not make mutable object thread-safe.
- Cache keys/values must be immutable or carefully copied.

Senior Java engineer always asks:

```text
Who owns this data?
Can it change?
Who can observe the change?
Can this break equality/hashCode?
Can this break thread-safety?
Can this break domain invariants?
Should I copy, share, or transfer ownership?
```

Mutability bugs are often not syntax bugs. They are ownership design bugs.

---

# 38. Referensi

1. Java SE 25 API — `Record`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Record.html

2. Java SE 25 API — `Collection`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html

3. Java SE 25 API — `List`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

4. Java SE 25 API — `Collections`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html

5. Java SE 25 API — `Arrays`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html

6. Java SE 25 API — `CopyOnWriteArrayList`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CopyOnWriteArrayList.html

7. Java SE 25 API — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

8. Java Language Specification SE 25 — Chapter 17: Threads and Locks  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html

9. Java Language Specification SE 25 — 17.5 final Field Semantics  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html#jls-17.5

10. Java SE 25 API — `Map`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-data-types-part-019.md](./learn-java-data-types-part-019.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-data-types-part-021.md](./learn-java-data-types-part-021.md)
