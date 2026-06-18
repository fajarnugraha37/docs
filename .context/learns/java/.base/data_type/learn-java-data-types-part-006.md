# learn-java-data-types-part-006.md

# Java Data Types — Part 006  
# Reference Types: Object, Identity, Reference, dan Null

> Seri: **Advanced Java Data Types**  
> Bagian: **006**  
> Fokus: memahami reference types secara mendalam: class/interface/array types, object vs reference, identity, aliasing, pass-by-value, heap, `null`, `NullPointerException`, `Optional`, sentinel/null object, nullability policy, ownership, dan production-grade API design.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Reference Types dalam Java Type System](#2-reference-types-dalam-java-type-system)
3. [Primitive Value vs Reference Value](#3-primitive-value-vs-reference-value)
4. [Object vs Reference vs Variable](#4-object-vs-reference-vs-variable)
5. [Class Types, Interface Types, dan Array Types](#5-class-types-interface-types-dan-array-types)
6. [The Class `Object`: Root dari Class Hierarchy](#6-the-class-object-root-dari-class-hierarchy)
7. [Object Identity](#7-object-identity)
8. [`==` pada Reference: Identity Comparison](#8--pada-reference-identity-comparison)
9. [`equals` dan Value Equality](#9-equals-dan-value-equality)
10. [`hashCode` dan Hash-Based Collections](#10-hashcode-dan-hash-based-collections)
11. [`toString`, `getClass`, `clone`, `finalize`](#11-tostring-getclass-clone-finalize)
12. [Reference Assignment dan Aliasing](#12-reference-assignment-dan-aliasing)
13. [Java Is Pass-by-Value: Termasuk Reference](#13-java-is-pass-by-value-termasuk-reference)
14. [Heap, Stack, dan Object Lifetime](#14-heap-stack-dan-object-lifetime)
15. [Garbage Collection dan Reachability](#15-garbage-collection-dan-reachability)
16. [The Special Null Type](#16-the-special-null-type)
17. [`null` sebagai Reference Value](#17-null-sebagai-reference-value)
18. [NullPointerException dan Helpful NPE](#18-nullpointerexception-dan-helpful-npe)
19. [Makna `null`: Absence, Unknown, Invalid, Not Loaded, Not Authorized](#19-makna-null-absence-unknown-invalid-not-loaded-not-authorized)
20. [`Optional<T>`: Kapan Tepat dan Kapan Tidak](#20-optionalt-kapan-tepat-dan-kapan-tidak)
21. [Null Object Pattern dan Sentinel Object](#21-null-object-pattern-dan-sentinel-object)
22. [Nullability Annotations dan Static Analysis](#22-nullability-annotations-dan-static-analysis)
23. [Defensive Null Checks: `Objects.requireNonNull`](#23-defensive-null-checks-objectsrequirenonnull)
24. [Reference Types dan Mutability](#24-reference-types-dan-mutability)
25. [Ownership, Defensive Copy, dan Representation Exposure](#25-ownership-defensive-copy-dan-representation-exposure)
26. [Reference Types dan Concurrency](#26-reference-types-dan-concurrency)
27. [Reference Equality vs Domain Equality](#27-reference-equality-vs-domain-equality)
28. [Reference Types di Boundary: JSON, DB, Cache, Message](#28-reference-types-di-boundary-json-db-cache-message)
29. [Production Failure Modes](#29-production-failure-modes)
30. [Best Practices](#30-best-practices)
31. [Decision Matrix](#31-decision-matrix)
32. [Latihan](#32-latihan)
33. [Ringkasan](#33-ringkasan)
34. [Referensi](#34-referensi)

---

# 1. Tujuan Bagian Ini

Di part sebelumnya kita membahas primitive, numeric, floating point, boolean, dan text.

Sekarang kita masuk ke keluarga type kedua dalam Java:

```text
reference types
```

Banyak bug Java production berasal dari salah memahami reference:

```java
Person a = new Person("Fajar");
Person b = a;
b.setName("Other");

// Kenapa a berubah?
```

Atau:

```java
void replace(Person p) {
    p = new Person("New");
}

// Kenapa caller tidak berubah?
```

Atau:

```java
if (user.getProfile().getAddress().getCity().equals("Jakarta")) {
    ...
}

// Kenapa NPE?
```

Tujuan bagian ini:

- memahami object vs reference;
- memahami identity vs equality;
- memahami aliasing;
- memahami Java pass-by-value;
- memahami `null` dan null type;
- memahami helpful NPE;
- memahami `Optional`;
- memahami ownership dan mutability;
- memahami kapan reference harus defensive copy;
- memahami failure mode production akibat reference/null design buruk.

---

# 2. Reference Types dalam Java Type System

Java Language Specification membagi type menjadi dua kategori besar:

```text
primitive types
reference types
```

Reference types terdiri dari:

```text
class types
interface types
array types
```

Selain itu ada special null type.

Contoh reference types:

```java
String
Object
List<String>
Map<CaseId, CaseRecord>
CaseId
Runnable
int[]
String[]
CloseCaseResult
```

Variable dengan reference type dapat menyimpan:

1. reference ke object/array;
2. `null`.

Contoh:

```java
String name = "Fajar";
String missing = null;
List<String> names = new ArrayList<>();
int[] numbers = new int[10];
```

## 2.1 Reference type bukan object

`String` adalah type.

`"Fajar"` adalah object String.

`name` adalah variable.

Nilai dalam variable `name` adalah reference ke object.

Ini harus jelas sejak awal.

## 2.2 Reference types enable object-oriented programming

Reference types memungkinkan:

- object identity;
- fields;
- methods;
- inheritance;
- interface;
- polymorphism;
- dynamic dispatch;
- encapsulation;
- null;
- aliasing;
- heap allocation;
- garbage collection.

Primitive types tidak punya semua itu.

---

# 3. Primitive Value vs Reference Value

## 3.1 Primitive variable

```java
int x = 10;
int y = x;
y = 20;

System.out.println(x); // 10
```

`x` dan `y` menyimpan value masing-masing.

## 3.2 Reference variable

```java
List<String> a = new ArrayList<>();
List<String> b = a;

b.add("hello");

System.out.println(a); // [hello]
```

`a` dan `b` menyimpan reference ke object yang sama.

## 3.3 Copying reference is not copying object

```java
List<String> b = a;
```

Ini tidak membuat list baru. Ini hanya menyalin reference.

Jika ingin copy object/content:

```java
List<String> b = new ArrayList<>(a);
```

Atau immutable snapshot:

```java
List<String> b = List.copyOf(a);
```

## 3.4 Mental model

Primitive:

```text
variable -> value
```

Reference:

```text
variable -> reference -> object
```

Multiple variables can point to the same object.

---

# 4. Object vs Reference vs Variable

Tiga istilah ini sering tertukar.

## 4.1 Variable

Storage location with a type.

```java
Person p;
```

`p` adalah variable.

## 4.2 Reference

Value that refers to an object, or `null`.

```java
p = new Person("Fajar");
```

Nilai variable `p` adalah reference ke object.

## 4.3 Object

Instance created at runtime.

```java
new Person("Fajar")
```

Object ada di heap secara konseptual.

## 4.4 Example

```java
Person p1 = new Person("Fajar");
Person p2 = p1;
```

Ada:

```text
2 variables: p1, p2
1 object: Person("Fajar")
2 reference values pointing to same object
```

## 4.5 Reassignment

```java
p2 = new Person("Other");
```

Sekarang:

```text
p1 -> Person("Fajar")
p2 -> Person("Other")
```

Reassign `p2` tidak mengubah `p1`.

## 4.6 Mutating object

```java
p1.setName("Updated");
```

Mengubah object yang direferensikan `p1`.

Jika `p2` masih menunjuk object yang sama, `p2` melihat perubahan.

---

# 5. Class Types, Interface Types, dan Array Types

## 5.1 Class type

```java
String s;
BigDecimal amount;
CaseRecord caseRecord;
```

A class type variable can refer to an instance of that class or subclass.

```java
Number n = Integer.valueOf(10);
```

## 5.2 Interface type

```java
Runnable r;
List<String> list;
CloseCaseResult result;
```

An interface type variable can refer to object of any class implementing that interface.

```java
List<String> list = new ArrayList<>();
list = new LinkedList<>();
```

Compile-time type:

```text
List<String>
```

Runtime object class:

```text
ArrayList or LinkedList
```

## 5.3 Array type

Arrays are objects.

```java
int[] numbers = new int[10];
String[] names = new String[5];
```

Array types are reference types.

```java
Object o = new int[10];
```

Arrays have:

- length;
- runtime component type;
- covariance for reference arrays;
- special JVM support.

## 5.4 Array covariance

```java
String[] strings = new String[1];
Object[] objects = strings;

objects[0] = 123; // ArrayStoreException at runtime
```

This compiles because arrays are covariant, but fails at runtime.

Generics are invariant:

```java
List<String> strings = new ArrayList<>();
List<Object> objects = strings; // compile error
```

## 5.5 Arrays as reference objects

```java
int[] a = {1, 2, 3};
int[] b = a;

b[0] = 99;

System.out.println(a[0]); // 99
```

Array variable stores reference to array object.

---

# 6. The Class `Object`: Root dari Class Hierarchy

Every class implicitly or explicitly extends `Object`, except `Object` itself.

Important methods:

```java
getClass()
equals(Object obj)
hashCode()
toString()
clone()
wait()
notify()
notifyAll()
finalize() // deprecated for removal in modern Java
```

## 6.1 `Object` as top type

```java
Object x = "hello";
Object y = Integer.valueOf(42);
Object z = new int[10];
```

`Object` can hold reference to any object/array.

But using `Object` loses type information.

```java
Object value = map.get("amount");
BigDecimal amount = (BigDecimal) value; // runtime risk
```

Prefer specific types.

## 6.2 `Object` in APIs

Bad:

```java
Object process(Object input)
```

unless writing framework/infrastructure.

Better:

```java
CaseResult process(CaseCommand command)
```

## 6.3 `Object` and reflection/framework

Frameworks often use `Object` internally because they handle arbitrary types:

- serializers;
- dependency injection;
- ORM;
- generic mappers;
- reflection utilities.

Application/domain code should not overuse `Object`.

---

# 7. Object Identity

Object identity means the object is a distinct runtime entity.

```java
Person a = new Person("Fajar");
Person b = new Person("Fajar");
```

Even if fields equal, they are different objects.

```java
a == b // false
```

## 7.1 Identity matters for entities

Domain entities usually have identity:

```java
CaseRecord
Officer
Application
License
```

A case remains same case even if status changes.

## 7.2 Value objects usually should not rely on identity

Value objects:

```java
Money
CaseId
EmailAddress
DateRange
```

Equality should be based on value.

```java
new CaseId("A").equals(new CaseId("A")) // true
```

## 7.3 IdentityHashMap

Java has `IdentityHashMap`, which uses reference identity (`==`) instead of equals.

Use rarely, mostly framework/internal graph processing.

## 7.4 System.identityHashCode

```java
System.identityHashCode(obj)
```

Returns identity-based hash code regardless of overridden `hashCode`.

Useful for diagnostics, not domain logic.

---

# 8. `==` pada Reference: Identity Comparison

For reference types:

```java
a == b
```

checks whether both references point to same object, or both are null.

## 8.1 Example

```java
String a = new String("hello");
String b = new String("hello");

System.out.println(a == b);      // false
System.out.println(a.equals(b)); // true
```

## 8.2 String literal trap

```java
String a = "hello";
String b = "hello";

System.out.println(a == b); // true due interning
```

But don't use `==` for content equality.

Always:

```java
a.equals(b)
```

or null-safe:

```java
Objects.equals(a, b)
```

## 8.3 Enum exception

For enum constants, `==` is appropriate:

```java
status == CaseStatus.CLOSED
```

Enum constants are singleton instances.

## 8.4 When `==` is appropriate for reference

- checking same object identity;
- comparing enum constants;
- checking null;
- sentinel singleton;
- performance-sensitive identity cache/framework internals.

Not for general value/content equality.

---

# 9. `equals` dan Value Equality

`equals` defines logical equality.

Default `Object.equals` is identity equality.

```java
public boolean equals(Object obj) {
    return this == obj;
}
```

Classes can override.

## 9.1 Value object equals

```java
public record CaseId(String value) {}
```

Record automatically provides value-based equals/hashCode over components.

```java
new CaseId("A").equals(new CaseId("A")) // true
```

## 9.2 Entity equals

Entity equality is tricky.

Option:

```java
equals by stable identity
```

But if ID assigned by database after persistence, be careful.

Bad:

```java
equals uses mutable fields
```

If object used in HashSet, mutation breaks collection behavior.

## 9.3 equals contract

`equals` should be:

- reflexive;
- symmetric;
- transitive;
- consistent;
- `x.equals(null)` false.

## 9.4 Inheritance trap

Using `instanceof` in equals with inheritance can break symmetry if subclass adds fields.

Records/final value classes avoid much of this.

For complex inheritance, design carefully or avoid equality across hierarchy.

## 9.5 Null-safe equality

```java
Objects.equals(a, b)
```

Equivalent:

```java
a == b || (a != null && a.equals(b))
```

---

# 10. `hashCode` dan Hash-Based Collections

If a class overrides `equals`, it must override `hashCode`.

Contract:

```text
if a.equals(b), then a.hashCode() == b.hashCode()
```

## 10.1 HashMap/HashSet

```java
Set<CaseId> ids = new HashSet<>();
ids.add(new CaseId("A"));

ids.contains(new CaseId("A")) // true if equals/hashCode correct
```

## 10.2 Mutable key bug

```java
class MutableKey {
    String value;

    public boolean equals(Object o) { ... uses value ... }
    public int hashCode() { return value.hashCode(); }
}
```

If used as key:

```java
MutableKey key = new MutableKey("A");
map.put(key, "value");
key.value = "B";

map.get(key) // may fail
```

Never mutate fields involved in equality/hashCode while object is in hash collection.

## 10.3 Arrays and equals

Arrays do not override `equals` for content.

```java
int[] a = {1, 2};
int[] b = {1, 2};

a.equals(b) // false
```

Use:

```java
Arrays.equals(a, b)
Arrays.deepEquals(...)
```

## 10.4 Record with array component trap

```java
record Payload(byte[] bytes) {}
```

Generated equals compares array reference, not content.

For value object with array content, write custom equals/hashCode and defensive copy.

---

# 11. `toString`, `getClass`, `clone`, `finalize`

## 11.1 `toString`

Default `Object.toString` is roughly:

```text
className@hexHashCode
```

Override for diagnostics, but never include secrets.

Bad:

```java
record Password(String value) {}
```

Generated toString leaks password:

```text
Password[value=secret]
```

For sensitive types, override:

```java
@Override
public String toString() {
    return "Password[masked]";
}
```

## 11.2 `getClass`

Returns runtime class object.

```java
obj.getClass()
```

Be careful with proxies:

```text
CaseService$$SpringCGLIB
jdk.proxy...
```

Frameworks may change runtime class.

## 11.3 `clone`

`Object.clone` is problematic:

- shallow copy by default;
- awkward `Cloneable` marker;
- constructor not called;
- easy to misuse.

Prefer:

- copy constructor;
- static factory;
- record copy/wither;
- builder;
- serialization-independent copy.

## 11.4 `finalize`

Finalization is deprecated for removal and should not be used.

Use:

- try-with-resources;
- `AutoCloseable`;
- `Cleaner` with caution;
- explicit resource lifecycle.

## 11.5 `wait/notify`

Low-level concurrency primitives.

Prefer higher-level constructs:

- `Lock`;
- `Condition`;
- `CountDownLatch`;
- `Semaphore`;
- `BlockingQueue`;
- `CompletableFuture`;
- structured concurrency where appropriate.

---

# 12. Reference Assignment dan Aliasing

Aliasing means multiple references point to same mutable object.

```java
List<String> source = new ArrayList<>();
List<String> alias = source;

alias.add("x");

System.out.println(source); // [x]
```

## 12.1 Aliasing can break invariant

```java
class EvidenceSet {
    private final List<Evidence> evidence;

    EvidenceSet(List<Evidence> evidence) {
        this.evidence = evidence;
    }
}
```

Caller can mutate list after constructor:

```java
List<Evidence> list = new ArrayList<>();
EvidenceSet set = new EvidenceSet(list);
list.clear(); // breaks EvidenceSet
```

Fix:

```java
this.evidence = List.copyOf(evidence);
```

## 12.2 Returning mutable reference

Bad:

```java
List<Evidence> evidence() {
    return evidence;
}
```

Caller can mutate internal state.

Better:

```java
List<Evidence> evidence() {
    return List.copyOf(evidence);
}
```

or store immutable and return it.

## 12.3 Aliasing and bugs

Aliasing is fine if object immutable.

```java
String a = "hello";
String b = a;
```

No mutation possible.

Aliasing mutable objects requires ownership discipline.

---

# 13. Java Is Pass-by-Value: Termasuk Reference

Java always passes arguments by value.

For primitive:

```java
void increment(int x) {
    x++;
}

int a = 1;
increment(a);
System.out.println(a); // 1
```

For reference:

```java
void mutate(List<String> list) {
    list.add("x");
}

List<String> a = new ArrayList<>();
mutate(a);
System.out.println(a); // [x]
```

Why? The reference value is copied. Both caller and callee references point to same object.

## 13.1 Reassigning parameter

```java
void replace(List<String> list) {
    list = new ArrayList<>();
    list.add("new");
}

List<String> a = new ArrayList<>();
replace(a);
System.out.println(a); // []
```

Reassigning parameter changes only local copy of reference.

## 13.2 Mental model

```text
Java passes copies of values.
For object variables, the value is a reference.
```

## 13.3 API implication

If method receives mutable object and mutates it, document or avoid.

Prefer:

```java
List<Result> process(List<Input> inputs)
```

over mutating input list unless performance/semantics require.

## 13.4 Command objects should be immutable

If you pass command objects across layers/threads, make them immutable.

```java
record CloseCaseCommand(CaseId caseId, OfficerId actorId, ClosureReason reason) {}
```

---

# 14. Heap, Stack, dan Object Lifetime

Simplified model:

- local variables live in stack frames;
- objects live on heap;
- references connect stack/heap/object graph;
- GC reclaims unreachable objects.

## 14.1 Example

```java
void f() {
    CaseId id = new CaseId("A");
}
```

During method:

```text
stack frame local variable id -> heap object CaseId("A")
```

After method returns, if no other reference, object becomes unreachable.

## 14.2 Escape analysis

JIT may optimize allocation away if object doesn't escape.

But language semantics still as if object exists.

Do not base correctness on escape analysis.

## 14.3 Object lifetime can be longer than expected

Object remains alive if reachable from:

- static field;
- thread local;
- cache;
- collection;
- listener registry;
- lambda capture;
- pending future;
- classloader;
- native reference;
- running thread.

## 14.4 Memory leak in Java

Java memory leak means objects remain reachable unintentionally.

Example:

```java
static List<Object> cache = new ArrayList<>();
```

grows forever.

## 14.5 Reference type design and memory

Every object has overhead. Many tiny wrappers can increase memory pressure, but domain clarity often worth it. Measure if volume is huge.

---

# 15. Garbage Collection dan Reachability

GC frees unreachable objects.

## 15.1 Reachable object

Object is reachable if it can be reached from GC roots.

Common roots:

- thread stacks;
- static fields;
- JNI/native roots;
- system classloader structures;
- monitors/threads.

## 15.2 Strong references

Normal references are strong references.

```java
Object o = new Object();
```

As long as strongly reachable, object not collected.

## 15.3 Weak/soft/phantom references

Java has:

- `WeakReference`;
- `SoftReference`;
- `PhantomReference`;
- `ReferenceQueue`.

Use carefully, mostly for caches/frameworks/resource management.

Do not use weak references as default business logic tool.

## 15.4 Finalization not resource management

Do not rely on GC to close files/sockets.

Use:

```java
try (var input = Files.newInputStream(path)) {
    ...
}
```

## 15.5 Object graph leak

A single reference to root of large graph keeps everything alive.

```java
Map<UserId, UserSession> sessions;
```

If session contains many references, leak can be large.

---

# 16. The Special Null Type

`null` is a special literal with special null type.

The null reference can be assigned to any reference type:

```java
String s = null;
List<String> list = null;
CaseRecord c = null;
int[] values = null;
```

But not primitive:

```java
int x = null; // compile error
```

## 16.1 Null type has no name

You cannot declare variable of null type.

```java
null x; // invalid
```

## 16.2 Null is not object

```java
Object o = null;
System.out.println(o instanceof Object); // false
```

## 16.3 Null can be cast

```java
String s = (String) null; // ok, s is null
```

## 16.4 Null in overload resolution

```java
void f(String s) {}
void f(Integer i) {}

f(null); // ambiguous
```

If overloads unrelated, `null` can create ambiguity.

---

# 17. `null` sebagai Reference Value

`null` means "no object reference".

But domain meaning is not defined by language.

It could mean:

```text
missing
unknown
not applicable
not loaded
not authorized
not found
not initialized
deleted
not requested
failed
empty
```

This ambiguity is the core problem.

## 17.1 Null dereference

```java
String s = null;
s.length(); // NullPointerException
```

## 17.2 Null-safe comparison

Bad:

```java
s.equals("OK")
```

if `s` may be null.

Better:

```java
"OK".equals(s)
```

or:

```java
Objects.equals(s, "OK")
```

## 17.3 Null and collections

Prefer empty collection over null:

```java
List<Item> items = List.of();
```

Instead of:

```java
List<Item> items = null;
```

Unless null has distinct semantics, which should be explicit.

## 17.4 Null and arrays

Array reference can be null; array elements can be null for reference arrays.

```java
String[] names = new String[3]; // elements all null
```

Primitive arrays elements default to primitive defaults.

## 17.5 Null field smell

Many nullable fields often indicate missing state model.

Bad:

```java
Instant closedAt;       // null if not closed
String closedReason;    // null if not closed
OfficerId closedBy;     // null if not closed
```

Better:

```java
sealed interface CaseState permits Open, Closed {}

record Open() implements CaseState {}
record Closed(Instant closedAt, ClosureReason reason, OfficerId closedBy) implements CaseState {}
```

---

# 18. NullPointerException dan Helpful NPE

`NullPointerException` occurs when code tries to use `null` where object is required.

Examples:

```java
obj.method()
obj.field
array.length
array[index]
synchronized(obj)
throw obj
```

## 18.1 Helpful NullPointerExceptions

Modern Java includes helpful NPE messages from JEP 358.

Example:

```java
a.b.c.getName()
```

Instead of only:

```text
NullPointerException
```

JVM can tell which part was null, e.g.:

```text
Cannot read field "c" because "a.b" is null
```

This helps diagnostics.

## 18.2 Helpful NPE is not design permission

Helpful NPE improves debugging, but does not mean you should remove proper null design.

Bad:

```java
// rely on NPE if null
this.name = name;
```

Better:

```java
this.name = Objects.requireNonNull(name, "name");
```

because it fails at boundary with clear contract.

## 18.3 NPE in production

NPE can indicate:

- missing validation;
- bad mapping;
- unexpected DB null;
- bad API contract;
- race condition;
- partially initialized object;
- broken test coverage;
- unsafe deserialization;
- framework reflection/proxy issue.

Root cause, not just stacktrace, must be fixed.

---

# 19. Makna `null`: Absence, Unknown, Invalid, Not Loaded, Not Authorized

`null` is overloaded.

## 19.1 Absence

No result exists.

```java
findById(id) returns null
```

Better:

```java
Optional<CaseRecord> findById(CaseId id)
```

## 19.2 Unknown

Value exists in real world but system doesn't know.

Better:

```java
enum VerificationStatus { UNKNOWN, VERIFIED, FAILED }
```

## 19.3 Not applicable

Field not meaningful for this state.

Better sealed state.

## 19.4 Not loaded

ORM lazy relation not loaded.

Do not represent as null unless API clearly states.

## 19.5 Not authorized

Dangerous to return null for unauthorized.

Better:

```java
AuthorizationDecision
AccessDeniedException
Result type
```

depending boundary.

## 19.6 Invalid

If input invalid, return validation result or throw domain exception. Null is too ambiguous.

## 19.7 Empty

Empty string/list is not same as null.

Define policy:

```text
empty string allowed?
blank string normalized to absent?
empty list means no items?
null list impossible?
```

---

# 20. `Optional<T>`: Kapan Tepat dan Kapan Tidak

`Optional<T>` represents optional presence/absence of a non-null value.

Java API note says Optional is primarily intended for method return type where no result is possible and using null likely causes errors.

## 20.1 Good use

```java
Optional<CaseRecord> findById(CaseId id);
Optional<OfficerId> assignedOfficer();
```

## 20.2 Bad use: Optional variable null

```java
Optional<CaseRecord> result = null; // bad
```

Optional variable itself should not be null.

## 20.3 Avoid Optional for fields?

Common Java practice: avoid `Optional` as entity field/DTO field unless framework/style explicitly supports it.

For domain fields, sealed state/value object may be better.

Bad:

```java
record CaseRecord(Optional<Instant> closedAt) {}
```

Better:

```java
sealed interface CaseState permits Open, Closed {}
```

## 20.4 Avoid Optional parameters

Bad:

```java
void update(Optional<String> name)
```

Callers can pass null Optional or create awkward API.

Better:

- overloads;
- command object;
- explicit update operation;
- nullable boundary DTO mapped internally.

## 20.5 Optional not for errors

```java
Optional<Result> process(Command c)
```

If empty means error, unclear.

Use result type:

```java
sealed interface ProcessResult permits Success, Rejected, Failed {}
```

## 20.6 Optional methods

Common:

```java
map
flatMap
filter
orElse
orElseGet
orElseThrow
ifPresent
stream
```

Beware:

```java
orElse(expensive()) // evaluated eagerly
```

Use:

```java
orElseGet(() -> expensive())
```

## 20.7 Optional and performance

Optional is object wrapper. Usually fine for return values. Avoid in hot low-level loops if measured overhead matters.

---

# 21. Null Object Pattern dan Sentinel Object

## 21.1 Null Object Pattern

Instead of null, use object with no-op/default behavior.

Example:

```java
interface Notifier {
    void notify(Message message);
}

final class NoOpNotifier implements Notifier {
    public void notify(Message message) {
        // do nothing
    }
}
```

Then:

```java
Notifier notifier = config.enabled() ? realNotifier : new NoOpNotifier();
```

No need:

```java
if (notifier != null) notifier.notify(...)
```

## 21.2 When good

- strategy no-op;
- optional behavior;
- logging/notification disabled;
- empty collection;
- default policy.

## 21.3 When dangerous

Null object can hide errors.

Example:

```java
User.ANONYMOUS
```

may accidentally bypass authentication if treated as real user.

Use only when no-op/default semantics are safe and explicit.

## 21.4 Sentinel object

Sentinel is special object value.

Example:

```java
static final Object TOMBSTONE = new Object();
```

Used in caches/internal data structures.

Application domain should avoid opaque sentinel unless strongly encapsulated.

## 21.5 Prefer sealed alternatives for domain

Instead of sentinel:

```java
sealed interface LookupResult permits Found, NotFound {}
```

---

# 22. Nullability Annotations dan Static Analysis

Java language itself has no built-in non-null type system.

Tools/libraries use annotations:

```java
@NonNull
@Nullable
```

Sources:

- Checker Framework;
- NullAway;
- JSpecify;
- JetBrains annotations;
- Spring nullability annotations;
- Eclipse annotations.

## 22.1 Goal

Make null contract explicit:

```java
@Nullable Officer findOfficer(OfficerId id)
@NonNull OfficerId officerId
```

## 22.2 Non-null by default

Some systems define package-level default non-null and mark exceptions nullable.

This reduces annotation noise.

## 22.3 Static checker

Use tools to catch:

- dereference of nullable;
- returning null from non-null;
- passing nullable to non-null parameter;
- unboxing nullable wrapper.

## 22.4 Limitations

Static null analysis can be challenged by:

- reflection;
- frameworks;
- generated code;
- dependency code;
- raw types;
- maps;
- dynamic JSON;
- proxies;
- partial adoption.

Still valuable.

## 22.5 Policy

A mature codebase should define:

```text
Are parameters non-null by default?
Are return values non-null by default?
Which annotation standard?
Is checker enforced in CI?
How are external libraries treated?
```

---

# 23. Defensive Null Checks: `Objects.requireNonNull`

Use:

```java
this.caseId = Objects.requireNonNull(caseId, "caseId");
```

This fails fast at construction boundary.

## 23.1 Why not rely on later NPE?

Early failure gives clearer ownership.

Bad:

```java
record CaseId(String value) {}
```

allows:

```java
new CaseId(null)
```

Then NPE later.

Better:

```java
public record CaseId(String value) {
    public CaseId {
        Objects.requireNonNull(value, "value");
    }
}
```

## 23.2 requireNonNull with message

```java
Objects.requireNonNull(value, "value");
```

## 23.3 requireNonNullElse

```java
String safe = Objects.requireNonNullElse(input, "");
```

Use carefully. Defaulting null to empty can hide semantic difference.

## 23.4 requireNonNullElseGet

```java
String safe = Objects.requireNonNullElseGet(input, () -> computeDefault());
```

Lazy default.

## 23.5 Boundary validation vs internal trust

Validate at boundaries:

- constructor;
- public method;
- API mapper;
- persistence mapper;
- config binding.

Inside core, you can rely on invariants if constructed properly.

---

# 24. Reference Types dan Mutability

Reference type object can be mutable or immutable.

## 24.1 Immutable reference object

```java
String
BigInteger
BigDecimal
record with immutable components
```

Aliasing immutable object is safe.

## 24.2 Mutable reference object

```java
ArrayList
HashMap
StringBuilder
Date legacy
byte[]
domain entity
```

Aliasing mutable object can be dangerous.

## 24.3 Final reference doesn't mean immutable object

```java
final List<String> names = new ArrayList<>();
names.add("x"); // allowed
```

`final` prevents reassignment of variable/field, not mutation of object.

## 24.4 Immutable field pattern

```java
private final List<Evidence> evidence;

public CaseRecord(List<Evidence> evidence) {
    this.evidence = List.copyOf(evidence);
}
```

## 24.5 Records and shallow immutability

```java
record Payload(byte[] bytes) {}
```

Record field is final, but array mutable.

Fix:

```java
public record Payload(byte[] bytes) {
    public Payload {
        bytes = bytes.clone();
    }

    @Override
    public byte[] bytes() {
        return bytes.clone();
    }
}
```

Also override equals/hashCode for array content if value semantics needed.

---

# 25. Ownership, Defensive Copy, dan Representation Exposure

## 25.1 Ownership question

When a constructor receives mutable object:

```java
new CaseRecord(list)
```

Who owns `list`?

- caller?
- CaseRecord?
- shared?

Unclear ownership causes bugs.

## 25.2 Defensive copy on input

```java
this.items = List.copyOf(items);
```

## 25.3 Defensive copy on output

```java
public List<Item> items() {
    return items; // okay if items already unmodifiable
}
```

If internal list mutable:

```java
return List.copyOf(items);
```

## 25.4 Arrays require special care

```java
private final byte[] digest;

public byte[] digest() {
    return digest; // exposes mutable array
}
```

Fix:

```java
return digest.clone();
```

## 25.5 Representation exposure in records

Record accessor exposes component as-is.

For mutable components, record may leak representation.

Use custom canonical constructor/accessor.

## 25.6 Collections.unmodifiableList is view

```java
List<String> raw = new ArrayList<>();
List<String> view = Collections.unmodifiableList(raw);
raw.add("x");
System.out.println(view); // sees x
```

`List.copyOf` creates unmodifiable snapshot.

---

# 26. Reference Types dan Concurrency

References to mutable objects shared across threads require synchronization/safe publication.

## 26.1 Safe publication

Immutable object with final fields safely published is generally safe once constructor completes, assuming no `this` escape during construction.

```java
final class Config {
    private final String endpoint;
}
```

## 26.2 Volatile reference

```java
private volatile Config config;
```

Volatile ensures visibility of reference updates.

If `Config` immutable, this is a good pattern.

## 26.3 Volatile reference does not make object thread-safe

```java
volatile List<String> list = new ArrayList<>();
```

Mutating the ArrayList is not thread-safe.

## 26.4 AtomicReference

Use for atomic reference updates:

```java
AtomicReference<State> state = new AtomicReference<>(State.NEW);

state.compareAndSet(State.NEW, State.RUNNING);
```

## 26.5 Mutable object synchronization

If multiple threads mutate object, use:

- synchronization;
- locks;
- concurrent collections;
- immutable snapshots;
- actor/single-thread ownership;
- atomic structures.

## 26.6 ThreadLocal leak

ThreadLocal holds references tied to thread lifetime.

In thread pools, forgotten ThreadLocal can leak data across requests.

Always clear:

```java
try {
    context.set(value);
    ...
} finally {
    context.remove();
}
```

---

# 27. Reference Equality vs Domain Equality

## 27.1 Entity

Entity equality often by identity.

```java
CaseRecord caseA
CaseRecord caseB
```

If both represent same case ID, domain may consider them same entity even if different object instances.

## 27.2 Value object

Value object equality by values.

```java
new Money(100, SGD).equals(new Money(100, SGD))
```

## 27.3 Reference identity in ORM

JPA persistence context may guarantee same entity instance within session for same DB row. Outside session, different instances can represent same row.

Don't build domain logic relying on reference identity.

## 27.4 Domain ID type

Use typed ID:

```java
record CaseId(UUID value) {}
```

Then equality is clear.

## 27.5 Identity vs equality in caching

Cache key must use equality/hashCode correctly.

```java
Map<CaseId, CaseSummary> cache;
```

If `CaseId` immutable record, good.

---

# 28. Reference Types di Boundary: JSON, DB, Cache, Message

## 28.1 JSON null

JSON can have:

```json
{ "name": null }
```

or missing field:

```json
{}
```

These may mean different things.

Map carefully.

## 28.2 Database null

DB nullable column maps to reference wrapper/object null.

Primitive fields cannot represent DB null.

## 28.3 Cache null

Many caches do not store null values or treat null specially.

Use:

- Optional wrapper carefully;
- sentinel internal;
- cache miss vs cached negative result distinction.

## 28.4 Message schema

Events should avoid ambiguous nulls.

Instead of:

```json
{ "closedAt": null }
```

consider event-specific schema:

```json
{ "eventType": "CaseClosed", "closedAt": "..." }
```

## 28.5 DTO vs domain

Boundary DTO may have nullable fields due PATCH/compatibility. Domain should map to explicit types/states.

```java
record UpdateCaseRequest(String title, String description) {}
```

Map to:

```java
sealed interface FieldUpdate<T> permits NoChange, SetValue, ClearValue {}
```

if PATCH semantics require.

---

# 29. Production Failure Modes

## 29.1 NPE from deep chain

```java
user.getProfile().getAddress().getCity()
```

Fix:

- validate invariants;
- break into explicit checks;
- use domain state;
- avoid nullable graph.

## 29.2 Null vs empty confusion

API returns null list. Client expects empty list and crashes.

Fix:

```java
List.of()
```

and API contract.

## 29.3 Optional field serialized weirdly

Using `Optional` in DTO/entity causes framework-specific JSON/ORM issues.

Fix:

- use DTO nullable boundary;
- domain explicit state;
- Optional mainly return type.

## 29.4 Mutable list exposure corrupts aggregate

Getter returns internal list; caller modifies without invariant/event.

Fix:

- unmodifiable snapshot;
- aggregate methods.

## 29.5 Array component in record equality bug

`record Digest(byte[] bytes)` compares arrays by reference.

Fix:

- custom equals/hashCode;
- defensive copy.

## 29.6 Cache memory leak

Static map holds references forever.

Fix:

- bounded cache;
- eviction;
- weak refs only if appropriate;
- metrics.

## 29.7 ThreadLocal data leak

Request context remains on reused thread.

Fix:

- remove in finally;
- framework context management;
- avoid ThreadLocal where possible.

## 29.8 Identity comparison bug

```java
if (statusString == "CLOSED")
```

Works sometimes due interning, fails otherwise.

Fix:

```java
"CLOSED".equals(statusString)
```

or enum.

## 29.9 Null config unsafe default

Missing config maps to null/false and disables security or feature incorrectly.

Fix:

- startup validation;
- explicit default policy.

## 29.10 ORM lazy null/missing confusion

Association null might mean no relation, not loaded, or session issue.

Fix:

- explicit fetch strategy;
- DTO projection;
- avoid exposing entity directly.

---

# 30. Best Practices

## 30.1 General reference rules

- Distinguish variable, reference, and object.
- Remember Java passes reference values by value.
- Use `equals` for value/content equality.
- Use `==` for identity, enum, null checks.
- Avoid raw `Object` in application/domain APIs.
- Prefer immutable value objects.
- Defensive copy mutable inputs/outputs.
- Avoid nullable fields for domain state.
- Use `Optional` primarily as return type.
- Use empty collections instead of null.
- Use `Objects.requireNonNull` at boundaries.
- Define nullability policy.
- Avoid exposing internal mutable representation.
- Consider concurrency visibility when sharing references.

## 30.2 Null rules

- Non-null by default.
- Absence explicit.
- Nullable only when semantics documented.
- Do not use null for errors.
- Do not use null for unauthorized.
- Do not use null to mean multiple things.
- Validate DB/API/config nulls at boundary.
- Prefer sealed state/result for rich absence/failure.

## 30.3 Equality rules

- Override equals/hashCode together.
- Keep equality fields immutable.
- Be careful with inheritance.
- Avoid arrays in record components unless custom behavior.
- Do not use reference equality for strings/content.
- Use typed IDs for entity identity.

## 30.4 Mutability rules

- final reference is not immutable object.
- Immutable values are easier to share.
- Entities can be mutable but should control mutation.
- Collections should not leak mutable internals.
- Arrays need clone if exposed.

---

# 31. Decision Matrix

| Situation | Recommended approach |
|---|---|
| Method may not find result | `Optional<T>` return |
| Domain state missing fields | sealed state |
| Field nullable due DB | map to explicit domain type |
| No items | empty collection |
| Optional behavior no-op | Null Object if safe |
| Error/failure | result type/exception, not null |
| Authorization denied | explicit denial result/exception |
| Mutable input collection | defensive copy |
| Large binary value | byte array with defensive copy or ByteBuffer policy |
| Value object equality | record/final class, immutable fields |
| Entity equality | stable typed ID |
| Shared config reference | immutable config + volatile/AtomicReference |
| Shared mutable object | synchronization/concurrent structure |
| API PATCH field | explicit field update model |
| Cache negative lookup | explicit sentinel/internal Optional with care |

---

# 32. Latihan

## Latihan 1 — Object vs reference

Predict output:

```java
List<String> a = new ArrayList<>();
List<String> b = a;
b.add("x");
b = new ArrayList<>();
b.add("y");

System.out.println(a);
System.out.println(b);
```

Explain object/reference changes.

## Latihan 2 — Pass-by-value

Implement:

```java
void replace(List<String> list) {
    list = new ArrayList<>();
    list.add("new");
}

void mutate(List<String> list) {
    list.add("mutated");
}
```

Call both and explain.

## Latihan 3 — Null state refactor

Refactor:

```java
Instant closedAt;
String closedReason;
OfficerId closedBy;
```

into sealed `CaseState`.

## Latihan 4 — Optional return

Refactor:

```java
CaseRecord findById(CaseId id) // returns null
```

to:

```java
Optional<CaseRecord> findById(CaseId id)
```

Update callers.

## Latihan 5 — Defensive copy

Implement immutable `EvidenceSet` that accepts `List<Evidence>` and prevents caller mutation.

## Latihan 6 — Record with array

Create:

```java
record Digest(byte[] bytes) {}
```

Show equality bug. Fix it with custom class or custom record methods.

## Latihan 7 — Helpful NPE

Write deep chain causing NPE and observe message on modern Java.

## Latihan 8 — Nullability policy

Define package-level/team policy:

```text
parameters non-null by default?
returns non-null by default?
collections empty instead of null?
annotation standard?
CI checker?
```

## Latihan 9 — ThreadLocal leak

Simulate ThreadLocal in fixed thread pool without remove. Show data leak between tasks. Fix with finally remove.

## Latihan 10 — Cache null

Design cache for `findById` where not-found should be cached. Distinguish cache miss vs cached not-found.

---

# 33. Ringkasan

Reference types adalah pusat object-oriented Java.

Mental model utama:

```text
variable -> reference value -> object
```

Primitive variable menyimpan value langsung. Reference variable menyimpan reference ke object atau null.

Hal penting:

- reference assignment menyalin reference, bukan object;
- multiple references can alias same mutable object;
- Java passes everything by value, including reference values;
- `==` on references checks identity;
- `equals` checks logical equality if overridden;
- `hashCode` must align with equals;
- arrays are objects and mutable;
- `null` can be assigned to any reference type;
- `null` has too many possible meanings;
- `Optional` is mainly for return values representing no result;
- domain absence/failure often better as sealed result/state;
- immutable objects and defensive copies reduce aliasing bugs;
- shared mutable references require concurrency discipline.

Engineer senior melihat reference type bukan sekadar “object”. Ia melihat:

```text
identity
ownership
mutability
nullability
equality
lifetime
reachability
boundary semantics
thread-safety
```

Itulah dasar untuk memahami Java object model, collections, generics, records, sealed types, serialization, ORM, caching, dan production memory behavior.

---

# 34. Referensi

1. Java Language Specification SE 25 — Chapter 4: Types, Values, and Variables  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html

2. Java Language Specification SE 25 — Reference Types and Values  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html#jls-4.3

3. Java SE 25 API — `Object`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html

4. Java SE 25 API — `Objects`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Objects.html

5. Java SE 25 API — `Optional`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html

6. Java SE 25 API — `AtomicReference`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicReference.html

7. Java SE 25 API — `WeakReference`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/WeakReference.html

8. Java SE 25 API — `IdentityHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/IdentityHashMap.html

9. JEP 358 — Helpful NullPointerExceptions  
   https://openjdk.org/jeps/358

10. JEP 421 — Deprecate Finalization for Removal  
    https://openjdk.org/jeps/421

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Data Types — Part 005](./learn-java-data-types-part-005.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Data Types — Part 007](./learn-java-data-types-part-007.md)
