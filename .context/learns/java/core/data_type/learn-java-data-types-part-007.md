# learn-java-data-types-part-007.md

# Java Data Types — Part 007  
# `Object`, Equality, Hashing, Identity, dan Ordering

> Seri: **Advanced Java Data Types**  
> Bagian: **007**  
> Fokus: memahami kontrak paling fundamental dari reference types di Java: `Object`, identity, `equals`, `hashCode`, `toString`, `Comparable`, `Comparator`, ordering, hash-based collections, sorted collections, entity equality, value object equality, record equality, array equality, dan production failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Kenapa Equality dan Hashing Itu Sangat Penting](#2-kenapa-equality-dan-hashing-itu-sangat-penting)
3. [`Object`: Root dari Semua Class](#3-object-root-dari-semua-class)
4. [Identity vs Equality](#4-identity-vs-equality)
5. [`==` pada Reference Types](#5--pada-reference-types)
6. [`equals`: Kontrak Logical Equality](#6-equals-kontrak-logical-equality)
7. [Kontrak `equals`: Reflexive, Symmetric, Transitive, Consistent, Non-Null](#7-kontrak-equals-reflexive-symmetric-transitive-consistent-non-null)
8. [`hashCode`: Kontrak Hashing](#8-hashcode-kontrak-hashing)
9. [Relasi `equals` dan `hashCode`](#9-relasi-equals-dan-hashcode)
10. [Default `Object.equals` dan `Object.hashCode`](#10-default-objectequals-dan-objecthashcode)
11. [`System.identityHashCode` dan `IdentityHashMap`](#11-systemidentityhashcode-dan-identityhashmap)
12. [Value Object Equality](#12-value-object-equality)
13. [Entity Equality](#13-entity-equality)
14. [Record Equality](#14-record-equality)
15. [Array Equality Trap](#15-array-equality-trap)
16. [BigDecimal Equality Trap](#16-bigdecimal-equality-trap)
17. [Floating Point Equality Trap](#17-floating-point-equality-trap)
18. [String Equality dan Interning](#18-string-equality-dan-interning)
19. [Enum Equality](#19-enum-equality)
20. [Mutable Key Bug](#20-mutable-key-bug)
21. [HashMap, HashSet, dan Hash-Based Collections](#21-hashmap-hashset-dan-hash-based-collections)
22. [Comparable: Natural Ordering](#22-comparable-natural-ordering)
23. [Comparator: External Ordering Strategy](#23-comparator-external-ordering-strategy)
24. [Ordering Consistent with Equals](#24-ordering-consistent-with-equals)
25. [TreeMap dan TreeSet Trap](#25-treemap-dan-treeset-trap)
26. [Comparator Chaining dan Null Handling](#26-comparator-chaining-dan-null-handling)
27. [Sorting Domain Objects](#27-sorting-domain-objects)
28. [Equality di ORM/JPA/Hibernate](#28-equality-di-ormjpahibernate)
29. [Equality di Distributed System dan Serialization Boundary](#29-equality-di-distributed-system-dan-serialization-boundary)
30. [`toString`: Debuggability vs Data Leakage](#30-tostring-debuggability-vs-data-leakage)
31. [`getClass` vs `instanceof` dalam `equals`](#31-getclass-vs-instanceof-dalam-equals)
32. [`clone` dan Kenapa Jarang Direkomendasikan](#32-clone-dan-kenapa-jarang-direkomendasikan)
33. [Production Failure Modes](#33-production-failure-modes)
34. [Best Practices](#34-best-practices)
35. [Decision Matrix](#35-decision-matrix)
36. [Latihan](#36-latihan)
37. [Ringkasan](#37-ringkasan)
38. [Referensi](#38-referensi)

---

# 1. Tujuan Bagian Ini

Di part 006 kita membahas reference types: object, reference, identity, aliasing, `null`, `Optional`, mutability, dan ownership.

Sekarang kita masuk ke kontrak yang menentukan bagaimana object berperilaku di collection, cache, set, map, sorting, deduplication, ORM, dan domain model:

```java
equals
hashCode
Comparable
Comparator
toString
getClass
```

Bug yang sering muncul:

```java
Set<User> users = new HashSet<>();
users.add(new User("A"));
users.contains(new User("A")); // false?
```

Atau:

```java
Map<Key, Value> map = new HashMap<>();
map.put(key, value);
key.setId("new");
map.get(key); // null?
```

Atau:

```java
TreeSet<BigDecimal> set = new TreeSet<>();
set.add(new BigDecimal("1.0"));
set.add(new BigDecimal("1.00"));
set.size(); // 1, while HashSet size could be 2
```

Bagian ini akan membuat kamu memahami:

- kapan object sama karena identity;
- kapan object sama karena value;
- bagaimana menulis `equals/hashCode` yang benar;
- bagaimana record membantu dan kapan record bisa menjebak;
- bagaimana array, BigDecimal, Double, String, enum punya behavior khusus;
- bagaimana `HashMap` dan `TreeSet` memakai equality/ordering;
- bagaimana entity equality berbeda dari value object equality;
- bagaimana menghindari bug production karena equality salah.

---

# 2. Kenapa Equality dan Hashing Itu Sangat Penting

Equality dan hashing dipakai di banyak tempat:

- `HashMap`;
- `HashSet`;
- `ConcurrentHashMap`;
- cache key;
- deduplication;
- idempotency;
- entity comparison;
- DTO comparison;
- tests/assertions;
- event replay;
- optimistic locking support;
- batch processing;
- grouping;
- distinct stream operation;
- authorization rule matching;
- sorting;
- database identity mapping;
- distributed message deduplication.

Jika equality salah, sistem bisa:

- membuat duplicate data;
- gagal menemukan cache;
- gagal menghapus item;
- menganggap dua object berbeda padahal sama;
- menganggap dua object sama padahal berbeda;
- kehilangan element di `TreeSet`;
- membuat `HashMap` memory leak;
- menghasilkan idempotency bug;
- gagal authorization karena key mismatch;
- membuat test flaky.

## 2.1 Equality adalah domain decision

Pertanyaan:

```text
Dua object dianggap sama berdasarkan apa?
```

Jawabannya berbeda:

```text
CaseId: same value
Money: same amount and same currency
CaseRecord entity: same case ID
AuditEvent: maybe same event ID
RiskScore: same finite numeric value?
User display name: exact string or normalized?
BigDecimal: same numeric value or same scale too?
```

Java memberi mekanisme. Domain menentukan makna.

---

# 3. `Object`: Root dari Semua Class

Semua class Java secara langsung atau tidak langsung extend `Object`.

Important methods:

```java
public final native Class<?> getClass()
public boolean equals(Object obj)
public native int hashCode()
public String toString()
protected native Object clone()
public final void wait(...)
public final native void notify()
public final native void notifyAll()
@Deprecated protected void finalize()
```

Bagian ini fokus:

- `equals`;
- `hashCode`;
- `toString`;
- `getClass`;
- `clone`;
- identity-related behavior.

## 3.1 Default behavior

Jika class tidak override `equals`, maka equality default adalah identity.

```java
class User {
    private final String id;

    User(String id) {
        this.id = id;
    }
}

new User("A").equals(new User("A")) // false
```

Karena default `Object.equals` kira-kira:

```java
return this == obj;
```

## 3.2 Object methods adalah contract surface

Begitu object masuk collection/log/test/cache, method-method ini penting.

Class domain yang serius harus punya keputusan eksplisit:

```text
Apakah equals/hashCode perlu override?
Apakah toString aman?
Apakah class immutable?
Apakah object bisa dipakai sebagai key?
Apakah identity penting?
```

---

# 4. Identity vs Equality

## 4.1 Identity

Identity berarti:

```text
Apakah dua reference menunjuk object runtime yang sama?
```

```java
User a = new User("A");
User b = a;

a == b // true
```

## 4.2 Equality

Equality berarti:

```text
Apakah dua object dianggap sama secara logis?
```

```java
new CaseId("C-1").equals(new CaseId("C-1")) // should be true
```

## 4.3 Identity object vs value object

Entity:

```text
same identity over time, mutable state may change
```

Value object:

```text
same values mean same value
```

Example:

```java
CaseRecord entity = same case even after status changes
Money value = same if amount/currency same
```

## 4.4 Equality should match conceptual model

Bad:

```java
class Money {
    BigDecimal amount;
    Currency currency;
    // no equals/hashCode
}
```

Then:

```java
new Money("10", "SGD").equals(new Money("10", "SGD")) // false
```

This violates value object expectation.

Bad:

```java
record CaseRecord(CaseId id, CaseStatus status) {}
```

If used as entity, record equality includes status. Same case with changed status becomes unequal.

---

# 5. `==` pada Reference Types

For reference types:

```java
a == b
```

true if:

- both references point same object; or
- both are null.

## 5.1 Correct uses

```java
if (obj == null) {}
if (status == CaseStatus.CLOSED) {}
if (this == other) return true;
```

For enum:

```java
status == CaseStatus.CLOSED
```

is correct and preferred.

## 5.2 Incorrect uses

```java
if (name == "Fajar") {}
```

String content comparison should use:

```java
"Fajar".equals(name)
```

## 5.3 Why string `==` sometimes works

String literals are interned:

```java
String a = "hello";
String b = "hello";

a == b // true
```

But:

```java
String c = new String("hello");
a == c // false
```

Never rely on `==` for string content.

## 5.4 Reference equality in diagnostics

Sometimes identity is useful:

```java
System.identityHashCode(obj)
```

or logging object identity in debugging.

But domain logic usually should not rely on object identity unless explicitly about identity.

---

# 6. `equals`: Kontrak Logical Equality

`equals` answers:

```text
Is this object logically equal to another object?
```

Signature:

```java
public boolean equals(Object obj)
```

Parameter is `Object`, not your class, so implementation must handle:

- same reference;
- null;
- different type;
- same type.

Typical pattern:

```java
@Override
public boolean equals(Object obj) {
    if (this == obj) {
        return true;
    }
    if (!(obj instanceof CaseId other)) {
        return false;
    }
    return Objects.equals(this.value, other.value);
}
```

## 6.1 Why parameter is Object?

Because `equals` overrides `Object.equals`.

This is valid override:

```java
public boolean equals(Object obj)
```

This is overload, not override:

```java
public boolean equals(CaseId other)
```

Always use `@Override` to catch mistakes.

## 6.2 `equals` and null

`x.equals(null)` must return false.

Do not throw NPE.

## 6.3 Avoid throwing in equals

`equals` should be total and safe for any Object.

Bad:

```java
@Override
public boolean equals(Object obj) {
    CaseId other = (CaseId) obj; // ClassCastException possible
    return value.equals(other.value);
}
```

## 6.4 Use IDE generation carefully

IDE-generated equals is often okay, but you must choose fields and semantics.

Wrong fields = wrong equality.

---

# 7. Kontrak `equals`: Reflexive, Symmetric, Transitive, Consistent, Non-Null

Java API defines an equivalence relation.

## 7.1 Reflexive

```java
x.equals(x) == true
```

Unless x is null, but you cannot call method on null.

## 7.2 Symmetric

```java
x.equals(y) == y.equals(x)
```

Symmetry bugs often happen with inheritance.

## 7.3 Transitive

If:

```java
x.equals(y)
y.equals(z)
```

then:

```java
x.equals(z)
```

## 7.4 Consistent

Multiple calls return same result if object state used in equals does not change.

This is why mutable equality fields are dangerous.

## 7.5 Non-null

```java
x.equals(null) == false
```

## 7.6 Example violation: inheritance

```java
class Point {
    final int x, y;

    public boolean equals(Object obj) {
        return obj instanceof Point p && x == p.x && y == p.y;
    }
}

class ColoredPoint extends Point {
    final Color color;

    public boolean equals(Object obj) {
        return obj instanceof ColoredPoint p &&
               super.equals(p) &&
               color.equals(p.color);
    }
}
```

Potential symmetry issue:

```java
Point p = new Point(1, 2);
ColoredPoint cp = new ColoredPoint(1, 2, RED);

p.equals(cp)  // true
cp.equals(p)  // false
```

Inheritance and value equality are tricky.

## 7.7 Prefer composition/final/records for value objects

For value objects, avoid subclassing.

```java
public record Point(int x, int y) {}
```

or final class.

---

# 8. `hashCode`: Kontrak Hashing

`hashCode` returns `int`.

Contract:

1. same object state should produce consistent hash during execution;
2. if `a.equals(b)`, then `a.hashCode() == b.hashCode()`;
3. if not equal, hash may still be same, but fewer collisions better.

## 8.1 `hashCode` is not unique ID

Different objects can have same hash.

Never use hashCode as:

- database ID;
- security token;
- checksum;
- stable cross-run identifier;
- distributed key without understanding.

## 8.2 Hash can change if object mutable

If hashCode depends on mutable fields and fields change, hash collection breaks.

## 8.3 Objects.hash

```java
@Override
public int hashCode() {
    return Objects.hash(value, currency);
}
```

Simple but allocates array internally; fine for most domain code.

For hot code, implement manually or use record.

## 8.4 Hash quality

Poor hashCode can cause many collisions and performance degradation.

Bad:

```java
public int hashCode() {
    return 1;
}
```

Correct but terrible performance.

## 8.5 Hash and security

HashMap has mitigations for collision attacks in modern Java, but do not expose hashCode as security boundary.

---

# 9. Relasi `equals` dan `hashCode`

If you override `equals`, override `hashCode`.

Bad:

```java
class CaseId {
    private final String value;

    @Override
    public boolean equals(Object obj) {
        return obj instanceof CaseId other &&
               Objects.equals(value, other.value);
    }
    // hashCode not overridden
}
```

Then:

```java
Set<CaseId> set = new HashSet<>();
set.add(new CaseId("C1"));

set.contains(new CaseId("C1")) // may be false
```

Because HashSet first uses hash bucket.

## 9.1 HashSet flow simplified

```text
hashCode determines bucket
equals compares candidates in bucket
```

If equal objects have different hashCode, lookup fails.

## 9.2 HashMap key

Same issue for map keys.

```java
map.put(new CaseId("C1"), value);
map.get(new CaseId("C1")); // fails if hashCode wrong
```

## 9.3 Rule

```text
equals and hashCode are a pair.
Never override only one.
```

---

# 10. Default `Object.equals` dan `Object.hashCode`

Default:

```java
equals -> identity
hashCode -> identity-ish integer
```

This is correct for classes whose equality is identity.

Example:

```java
Thread
Socket
EntityManager
Lock
```

For value objects, default is usually wrong.

## 10.1 When default identity equality is fine

- mutable service objects;
- resource handles;
- thread/lock objects;
- objects where each instance is unique;
- entities if identity object instance matters internally;
- framework/proxy internals.

## 10.2 When override needed

- value objects;
- typed IDs;
- DTOs used in tests/dedup;
- map keys;
- set elements;
- commands/events where logical equality matters.

## 10.3 Domain classes

For aggregate entity, think carefully. Sometimes you override by ID, sometimes not. More in entity section.

---

# 11. `System.identityHashCode` dan `IdentityHashMap`

## 11.1 `System.identityHashCode`

Returns hash code based on identity, as default `Object.hashCode` would, regardless of override.

```java
System.identityHashCode(obj)
```

Useful for diagnostics.

## 11.2 IdentityHashMap

`IdentityHashMap` compares keys with `==`, not `equals`.

```java
Map<String, String> map = new IdentityHashMap<>();

map.put(new String("a"), "1");
map.put(new String("a"), "2");

map.size() // 2
```

## 11.3 Use cases

- object graph traversal;
- serialization framework;
- proxy tracking;
- cycle detection by object identity;
- internal caches where identity is intentional.

## 11.4 Not for normal domain maps

Usually you want:

```java
HashMap<CaseId, CaseRecord>
```

not `IdentityHashMap`.

---

# 12. Value Object Equality

Value object equality should be based on value.

Examples:

```java
CaseId
Money
EmailAddress
DateRange
PolicyCode
```

## 12.1 Record is often ideal

```java
public record CaseId(String value) {
    public CaseId {
        Objects.requireNonNull(value, "value");
        value = value.strip();
        if (value.isEmpty()) {
            throw new IllegalArgumentException("CaseId cannot be blank");
        }
    }
}
```

Generated:

- equals;
- hashCode;
- toString;
- accessors.

## 12.2 Normalize before storing

If equality should ignore surrounding whitespace/case:

```java
public record PolicyCode(String value) {
    public PolicyCode {
        Objects.requireNonNull(value);
        value = value.strip().toUpperCase(Locale.ROOT);
    }
}
```

Now equality works on canonical value.

## 12.3 Money equality

Careful with BigDecimal scale.

```java
record Money(BigDecimal amount, Currency currency) {}
```

Default record equality uses BigDecimal.equals.

If domain considers `1.0` and `1.00` same, normalize or custom class.

## 12.4 Value object must be immutable

If fields can change, hash/equality consistency breaks.

Use:

- final class;
- record;
- defensive copies;
- immutable components.

## 12.5 Value object should validate invariant

Do not allow invalid value object.

```java
new Percentage(new BigDecimal("999"))
```

should fail if percentage must be `0..100`.

---

# 13. Entity Equality

Entity has identity and lifecycle.

Examples:

```java
CaseRecord
Officer
License
Application
```

## 13.1 Equality by object identity?

Sometimes acceptable inside a transaction/session.

```java
caseA == caseB
```

But across persistence contexts, same DB row may be different object instances.

## 13.2 Equality by ID

Common:

```java
class CaseRecord {
    private final CaseId id;

    @Override
    public boolean equals(Object obj) {
        return obj instanceof CaseRecord other &&
               Objects.equals(this.id, other.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }
}
```

Works if ID is stable and assigned at construction.

## 13.3 Generated database ID problem

If ID is null before persistence:

```java
@Entity
class User {
    @Id
    @GeneratedValue
    Long id;
}
```

What is equality before persist?

Danger:

- two new transient entities with null ID might compare equal if not careful;
- hashCode changes after ID assigned;
- HashSet breaks.

## 13.4 Strategy for entities

Options:

1. use application-assigned stable ID at construction;
2. use business key if stable and immutable;
3. use identity equality until persisted, carefully;
4. avoid putting mutable/transient entities in hash collections;
5. follow ORM-specific recommendations.

## 13.5 Do not include mutable state

Bad:

```java
equals includes status
```

Same entity changes equality when status changes.

Entity equality should generally use stable identity, not mutable lifecycle fields.

## 13.6 Entity as record?

Usually not ideal if entity mutable/lifecycle-based.

Record equality includes all components. That may not match entity identity.

Records are excellent for value objects, DTOs, commands, events, not always entities.

---

# 14. Record Equality

Records automatically implement equals/hashCode/toString based on components.

```java
record Point(int x, int y) {}
```

```java
new Point(1, 2).equals(new Point(1, 2)) // true
```

## 14.1 Record equality is component equality

For reference components, uses their equals.

```java
record UserName(String value) {}
```

Good.

## 14.2 Record with mutable component

```java
record Names(List<String> values) {}
```

If list mutable and later changes, record equality/hashCode changes.

Fix:

```java
record Names(List<String> values) {
    Names {
        values = List.copyOf(values);
    }
}
```

## 14.3 Record with array component

```java
record Digest(byte[] bytes) {}
```

Generated equals compares array reference, not content.

This surprises many engineers.

## 14.4 Record class exact type

Record equals generally requires same record class, not just same shape.

```java
record A(int x) {}
record B(int x) {}

new A(1).equals(new B(1)) // false
```

Java nominal typing.

## 14.5 Record toString and sensitive data

```java
record Password(String value) {}
```

Generated:

```text
Password[value=secret]
```

Override `toString` for sensitive records.

## 14.6 Record and normalization

Canonical constructor can normalize:

```java
record EmailAddress(String value) {
    EmailAddress {
        value = value.strip().toLowerCase(Locale.ROOT);
    }
}
```

But be careful with email local-part semantics; this is example only.

---

# 15. Array Equality Trap

Arrays inherit Object.equals, so equality is identity.

```java
int[] a = {1, 2};
int[] b = {1, 2};

a.equals(b) // false
a == b      // false
```

Use:

```java
Arrays.equals(a, b)
Arrays.hashCode(a)
```

For nested arrays:

```java
Arrays.deepEquals(...)
Arrays.deepHashCode(...)
```

## 15.1 Record with array

```java
record Payload(byte[] bytes) {}
```

Problem:

```java
new Payload(new byte[]{1}).equals(new Payload(new byte[]{1})) // false
```

because byte array equals by identity.

## 15.2 Fix with final class

```java
public final class Digest {
    private final byte[] bytes;

    public Digest(byte[] bytes) {
        this.bytes = bytes.clone();
    }

    public byte[] bytes() {
        return bytes.clone();
    }

    @Override
    public boolean equals(Object obj) {
        return obj instanceof Digest other &&
               Arrays.equals(this.bytes, other.bytes);
    }

    @Override
    public int hashCode() {
        return Arrays.hashCode(bytes);
    }

    @Override
    public String toString() {
        return "Digest[bytes=masked,length=" + bytes.length + "]";
    }
}
```

## 15.3 Arrays as map keys

Avoid raw arrays as `HashMap` keys unless identity semantics desired.

Use wrapper with content equality.

## 15.4 ByteBuffer equality

`ByteBuffer.equals` has position/remaining semantics, not simply whole backing array. Understand API if used as key.

---

# 16. BigDecimal Equality Trap

`BigDecimal.equals` considers value and scale.

```java
BigDecimal a = new BigDecimal("1.0");
BigDecimal b = new BigDecimal("1.00");

a.compareTo(b) == 0 // true
a.equals(b)         // false
```

## 16.1 HashSet vs TreeSet

```java
Set<BigDecimal> hashSet = new HashSet<>();
hashSet.add(new BigDecimal("1.0"));
hashSet.add(new BigDecimal("1.00"));
hashSet.size(); // 2
```

```java
Set<BigDecimal> treeSet = new TreeSet<>();
treeSet.add(new BigDecimal("1.0"));
treeSet.add(new BigDecimal("1.00"));
treeSet.size(); // 1 because compareTo == 0
```

This inconsistency can surprise.

## 16.2 Money record bug

```java
record Money(BigDecimal amount, Currency currency) {}
```

Default equality:

```java
Money(1.0 SGD) != Money(1.00 SGD)
```

if BigDecimal scale differs.

## 16.3 Fix

Normalize:

```java
amount = amount.setScale(currency.getDefaultFractionDigits(), roundingMode);
```

or use minor units.

Or custom equals/hashCode using compareTo-compatible normalized value.

## 16.4 Scale may have meaning

Sometimes scale matters:

```text
measurement precision
user-entered decimal
scientific significant digits
```

Do not strip scale blindly. Decide domain semantics.

---

# 17. Floating Point Equality Trap

Primitive:

```java
Double.NaN == Double.NaN // false
0.0 == -0.0              // true
```

Wrapper:

```java
Double.valueOf(Double.NaN).equals(Double.valueOf(Double.NaN)) // true
Double.valueOf(0.0).equals(Double.valueOf(-0.0))              // false
```

## 17.1 Record with double

```java
record Score(double value) {}
```

Generated equals handles floating components using semantics specified for records/wrapper-like equality. Still, NaN and -0.0 need domain decision.

## 17.2 Domain type should validate

```java
record RiskScore(double value) {
    RiskScore {
        if (!Double.isFinite(value) || value < 0.0 || value > 1.0) {
            throw new IllegalArgumentException();
        }
        if (value == 0.0) {
            value = 0.0; // normalize -0.0
        }
    }
}
```

## 17.3 Approximate equality and hashCode

Do not implement equals with tolerance casually.

Bad:

```java
equals if abs(a-b) < 0.001
```

This can violate transitivity.

Example:

```text
a close to b
b close to c
a not close to c
```

For domain values needing tolerance, avoid using them as hash keys or define bucketed representation explicitly.

## 17.4 Sorting approximate values

Use `Double.compare` after rejecting NaN if domain disallows it.

---

# 18. String Equality dan Interning

Strings are objects but immutable and value-like.

Use:

```java
a.equals(b)
Objects.equals(a, b)
```

Not:

```java
a == b
```

## 18.1 Interning

String literals are interned.

```java
"hello" == "hello" // true
```

But runtime strings may not be same reference.

## 18.2 `equalsIgnoreCase`

```java
a.equalsIgnoreCase(b)
```

Useful but not full locale/collation/normalization solution.

For machine keys:

```java
normalize to Locale.ROOT
```

For natural language sorting/comparison, use `Collator`.

## 18.3 Normalization

```java
"\u00E9".equals("e\u0301") // false
```

Normalize if canonical equality needed.

## 18.4 String as ID

Raw String IDs can be mixed up.

```java
void assign(String caseId, String officerId)
```

Use typed ID records.

---

# 19. Enum Equality

Enum constants are singleton per enum classloader context.

Use `==`:

```java
status == CaseStatus.CLOSED
```

`equals` also works but `==` is null-safe if constant first?

```java
status == CaseStatus.CLOSED // safe if status null, returns false
status.equals(CaseStatus.CLOSED) // NPE if status null
```

## 19.1 EnumSet and EnumMap

Use for enum keys/sets:

```java
EnumSet<Permission> permissions = EnumSet.of(READ, WRITE);
EnumMap<CaseStatus, Handler> handlers = new EnumMap<>(CaseStatus.class);
```

Efficient and clear.

## 19.2 Do not persist ordinal

```java
status.ordinal()
```

Dangerous because enum order can change.

Persist:

```text
name
explicit code
```

with compatibility strategy.

## 19.3 Adding enum value

Can break exhaustive switches and external consumers.

Equality itself fine, compatibility not.

---

# 20. Mutable Key Bug

Classic production bug.

```java
public final class Key {
    private String value;

    public Key(String value) {
        this.value = value;
    }

    public void setValue(String value) {
        this.value = value;
    }

    @Override
    public boolean equals(Object obj) {
        return obj instanceof Key other &&
               Objects.equals(this.value, other.value);
    }

    @Override
    public int hashCode() {
        return Objects.hash(value);
    }
}
```

Usage:

```java
Key key = new Key("A");
Map<Key, String> map = new HashMap<>();

map.put(key, "value");

key.setValue("B");

System.out.println(map.get(key)); // likely null
```

## 20.1 Why?

HashMap placed entry in bucket based on hash of `"A"`. After mutation, hash becomes hash of `"B"`. Lookup goes to different bucket.

## 20.2 Fix

Make key immutable:

```java
record Key(String value) {}
```

## 20.3 Entity as key

Do not use mutable entity as key unless equality/hashCode stable.

Prefer typed ID:

```java
Map<CaseId, CaseRecord>
```

not:

```java
Map<CaseRecord, Something>
```

## 20.4 Mutable collection fields

If equals/hashCode includes collection and collection mutates, same problem.

---

# 21. HashMap, HashSet, dan Hash-Based Collections

## 21.1 HashMap lookup simplified

```text
compute hashCode
find bucket
compare keys with equals
return value
```

## 21.2 HashSet

HashSet is backed by HashMap-like structure.

Uniqueness based on equals/hashCode.

## 21.3 `contains` failure

If equals/hashCode wrong:

```java
set.contains(new CaseId("C1")) // false
```

even though logically present.

## 21.4 Collision

Different keys can have same hash.

HashMap handles collisions by equals comparison. Too many collisions hurt performance.

## 21.5 ConcurrentHashMap

Still relies on equals/hashCode.

Thread-safe map does not fix bad key equality.

## 21.6 Cache keys

Cache keys must be:

- immutable;
- equality-correct;
- hashCode-correct;
- include all parameters that affect result;
- exclude irrelevant/mutable fields.

Bad cache key:

```java
record SearchKey(String query) {}
```

if result also depends on tenant, locale, permissions.

Better:

```java
record SearchKey(TenantId tenantId, UserId userId, Locale locale, String normalizedQuery) {}
```

---

# 22. Comparable: Natural Ordering

`Comparable<T>` defines natural ordering.

```java
public interface Comparable<T> {
    int compareTo(T o);
}
```

Example:

```java
record Priority(int value) implements Comparable<Priority> {
    @Override
    public int compareTo(Priority other) {
        return Integer.compare(this.value, other.value);
    }
}
```

## 22.1 compareTo contract

Should be:

- antisymmetric;
- transitive;
- consistent;
- ideally consistent with equals.

## 22.2 Do not subtract

Bad:

```java
return this.value - other.value;
```

Can overflow.

Good:

```java
return Integer.compare(this.value, other.value);
return Long.compare(this.value, other.value);
```

## 22.3 Natural ordering should be obvious

Use `Comparable` only if class has a clear natural order.

Good:

```java
LocalDate
Instant
Version
Priority
```

Maybe bad:

```java
Person
CaseRecord
```

because ordering could be by name, createdAt, priority, status, etc.

Use Comparator for external ordering.

## 22.4 BigDecimal compareTo

BigDecimal natural ordering is numeric and ignores scale differences for compareTo.

But equals includes scale. Inconsistent with equals.

Java documentation notes this kind of inconsistency.

---

# 23. Comparator: External Ordering Strategy

`Comparator<T>` defines ordering outside class.

```java
Comparator<CaseSummary> byPriority =
    Comparator.comparing(CaseSummary::priority);
```

## 23.1 Chaining

```java
Comparator<CaseSummary> ordering =
    Comparator.comparing(CaseSummary::severity).reversed()
        .thenComparing(CaseSummary::createdAt)
        .thenComparing(CaseSummary::caseId);
```

## 23.2 Primitive comparators

Avoid boxing:

```java
Comparator.comparingInt(CaseSummary::priority)
Comparator.comparingLong(CaseSummary::version)
Comparator.comparingDouble(CaseSummary::score)
```

## 23.3 Null handling

```java
Comparator.nullsFirst(...)
Comparator.nullsLast(...)
```

Example:

```java
Comparator<CaseSummary> byAssignedOfficer =
    Comparator.comparing(
        CaseSummary::assignedOfficerName,
        Comparator.nullsLast(String::compareTo)
    );
```

## 23.4 Locale-sensitive comparator

```java
Collator collator = Collator.getInstance(locale);

Comparator<Person> byDisplayName =
    Comparator.comparing(Person::displayName, collator);
```

## 23.5 Stable sorting

Java object array/list sorting is stable for many standard APIs. Still, define tie-breakers for deterministic output/pagination.

---

# 24. Ordering Consistent with Equals

A class's natural ordering is consistent with equals if:

```java
x.compareTo(y) == 0
```

has same boolean value as:

```java
x.equals(y)
```

## 24.1 Why important?

Sorted collections use comparator/compareTo for uniqueness.

```java
TreeSet
TreeMap
```

If comparator says two elements compare 0, set treats them as duplicate even if equals false.

## 24.2 BigDecimal example

```java
new BigDecimal("1.0").compareTo(new BigDecimal("1.00")) == 0
new BigDecimal("1.0").equals(new BigDecimal("1.00")) == false
```

TreeSet deduplicates them; HashSet doesn't.

## 24.3 Domain example

Comparator by name only:

```java
Comparator<Person> byName = Comparator.comparing(Person::name);
```

TreeSet with this comparator will allow only one person per name.

If that is not intended, add tie-breaker:

```java
Comparator<Person> byNameThenId =
    Comparator.comparing(Person::name)
        .thenComparing(Person::id);
```

## 24.4 Rule

When using comparator in sets/maps, comparator defines key uniqueness.

Design accordingly.

---

# 25. TreeMap dan TreeSet Trap

`TreeSet` and `TreeMap` use ordering, not hashCode.

## 25.1 TreeSet uniqueness

```java
TreeSet<Person> set = new TreeSet<>(Comparator.comparing(Person::name));
set.add(new Person("A", id1));
set.add(new Person("A", id2));

set.size(); // 1 if comparator compare == 0
```

Even if different IDs.

## 25.2 TreeMap key replacement

```java
TreeMap<Person, String> map = new TreeMap<>(Comparator.comparing(Person::name));

map.put(new Person("A", id1), "first");
map.put(new Person("A", id2), "second");

map.size(); // 1
```

Second put replaces value for equivalent comparator key.

## 25.3 Fix

Comparator must include all fields needed for uniqueness:

```java
Comparator.comparing(Person::name)
    .thenComparing(Person::id)
```

Or use different data structure:

```java
Map<PersonId, Person>
```

## 25.4 Sorted display vs uniqueness

Use list sorting for display.

Use map/set key equality for identity.

Don't mix the two accidentally.

---

# 26. Comparator Chaining dan Null Handling

## 26.1 Basic chaining

```java
Comparator<CaseSummary> comparator =
    Comparator.comparing(CaseSummary::status)
        .thenComparing(CaseSummary::createdAt)
        .thenComparing(CaseSummary::caseId);
```

## 26.2 Descending

```java
Comparator<CaseSummary> comparator =
    Comparator.comparing(CaseSummary::createdAt).reversed();
```

Be careful: `reversed()` reverses entire comparator so far.

For one field:

```java
Comparator.comparing(
    CaseSummary::severity,
    Comparator.reverseOrder()
)
```

## 26.3 Nulls

```java
Comparator.comparing(
    CaseSummary::assignedAt,
    Comparator.nullsLast(Comparator.naturalOrder())
)
```

## 26.4 Primitive fields

```java
Comparator.comparingInt(CaseSummary::priority)
```

## 26.5 Deterministic pagination

Always add stable tie-breaker:

```java
Comparator.comparing(CaseSummary::createdAt)
    .thenComparing(CaseSummary::caseId)
```

If ordering not deterministic, pagination can duplicate/skip items.

---

# 27. Sorting Domain Objects

## 27.1 Sorting by domain priority

```java
enum Severity {
    LOW(1),
    MEDIUM(2),
    HIGH(3),
    CRITICAL(4);

    private final int rank;

    Severity(int rank) {
        this.rank = rank;
    }

    int rank() {
        return rank;
    }
}
```

Comparator:

```java
Comparator<CaseSummary> bySeverityDesc =
    Comparator.comparingInt((CaseSummary c) -> c.severity().rank())
        .reversed()
        .thenComparing(CaseSummary::createdAt)
        .thenComparing(CaseSummary::caseId);
```

Do not rely on enum ordinal if rank is domain concept.

## 27.2 Sorting by status

Status ordering may not match enum declaration order.

Define explicit rank:

```java
enum CaseStatus {
    DRAFT(10),
    SUBMITTED(20),
    UNDER_REVIEW(30),
    CLOSED(90);

    private final int workflowOrder;
}
```

## 27.3 Sorting by display name

Use `Collator`.

```java
Collator collator = Collator.getInstance(locale);
people.sort(Comparator.comparing(Person::displayName, collator));
```

## 27.4 Sorting by score

Reject NaN before sorting.

```java
record RiskScore(double value) {
    RiskScore {
        if (!Double.isFinite(value)) throw new IllegalArgumentException();
    }
}
```

## 27.5 Sorting and business correctness

If sorted order affects business outcome, document ordering policy and test tie-breakers.

---

# 28. Equality di ORM/JPA/Hibernate

ORM makes equality harder.

## 28.1 Generated ID problem

Before persistence:

```java
id == null
```

After persistence:

```java
id != null
```

If hashCode uses id, hash changes.

## 28.2 Proxy classes

Hibernate may use proxy subclass.

If equals uses:

```java
getClass() != obj.getClass()
```

then proxy and entity may compare unequal.

But using `instanceof` can create inheritance issues.

ORM equality strategy must consider proxy behavior.

## 28.3 Business key

If entity has immutable natural key:

```java
LicenseNumber
CaseNumber
```

can be used for equality if truly stable and unique.

## 28.4 Application-assigned ID

A good strategy:

```java
CaseId generated by application before persist
```

Then equality by ID is stable from construction.

## 28.5 Avoid entity in HashSet before ID assigned

If ID generated by DB, avoid putting transient entity into hash collections.

## 28.6 DTO/value object separation

Often, equality for DTO/value objects is simpler than entity equality.

Do not expose JPA entities as API DTOs.

---

# 29. Equality di Distributed System dan Serialization Boundary

## 29.1 Object identity does not cross process

If object serialized/deserialized:

```java
original == deserialized // false
```

Even if data same.

Equality must be value/domain based.

## 29.2 Event idempotency

Use stable event ID/command ID.

```java
record EventId(UUID value) {}
```

Dedup key:

```text
eventId
aggregateId + version
idempotencyKey
```

not Java object identity/hashCode.

## 29.3 Cache keys across nodes

`hashCode` is not stable distributed identifier.

Do not use object hashCode as distributed cache key.

Use explicit serialized key:

```text
tenantId:caseId:queryHash
```

or typed key serialized deterministically.

## 29.4 JSON equality

JSON object field order may differ. String equality of JSON payloads may fail for logically same data.

Use canonical serialization or parsed comparison if needed.

## 29.5 Database equality

Database collation, numeric scale, timezone, and null semantics may differ from Java equality.

Example:

- BigDecimal scale;
- case-insensitive collation;
- timestamp precision truncation;
- trailing spaces in char columns.

Design mapping carefully.

---

# 30. `toString`: Debuggability vs Data Leakage

`toString` is used in:

- logs;
- debugger;
- assertion failure;
- exception messages;
- metrics labels accidentally;
- tracing attributes;
- collection printing.

## 30.1 Good toString

Should help debugging:

```java
CaseId[value=C-123]
```

## 30.2 Sensitive data

Bad:

```java
record AccessToken(String value) {}
```

Generated:

```text
AccessToken[value=eyJ...]
```

Fix:

```java
public record AccessToken(String value) {
    @Override
    public String toString() {
        return "AccessToken[masked]";
    }
}
```

## 30.3 Large data

Do not dump huge arrays/payloads.

```java
Payload[size=1048576, sha256=...]
```

instead of full content.

## 30.4 PII

Mask:

- email;
- phone;
- NRIC/KTP/passport;
- token;
- password;
- address;
- personal data.

## 30.5 toString should not have side effects

No DB calls, no network, no expensive lazy loading.

---

# 31. `getClass` vs `instanceof` dalam `equals`

Two common styles.

## 31.1 getClass style

```java
if (obj == null || getClass() != obj.getClass()) {
    return false;
}
```

Pros:

- strict same runtime class;
- avoids subclass equality issues.

Cons:

- proxies/subclasses may compare false;
- less flexible.

## 31.2 instanceof style

```java
if (!(obj instanceof CaseId other)) {
    return false;
}
```

Pros:

- works with subclass/proxy if intended;
- concise with pattern matching.

Cons:

- can break symmetry with inheritance if subclass adds fields.

## 31.3 Recommendation

For final value objects/records:

```java
instanceof pattern
```

is often fine.

For non-final inheritance hierarchies, be careful. Prefer avoiding value equality across mutable inheritance hierarchies.

For JPA entities, consider proxy behavior and ORM recommendations.

## 31.4 Records

Record equals uses record class equality semantics. It is safe and generated.

---

# 32. `clone` dan Kenapa Jarang Direkomendasikan

`Object.clone` is a protected native method and interacts with `Cloneable`.

Problems:

- shallow copy by default;
- constructors not called;
- `Cloneable` has no `clone` method;
- arrays clone okay but objects tricky;
- final fields/deep copy issues;
- exception awkwardness.

## 32.1 Prefer copy constructor

```java
public Person(Person other) {
    this.name = other.name;
    this.address = new Address(other.address);
}
```

## 32.2 Prefer factory

```java
Person copy = person.copyWithName("New");
```

## 32.3 Records

For records, create new record with changed component:

```java
record User(String name, Email email) {
    User withName(String newName) {
        return new User(newName, email);
    }
}
```

## 32.4 Collections/arrays

For arrays:

```java
bytes.clone()
```

is common for defensive copy.

For lists:

```java
List.copyOf(list)
```

## 32.5 Serialization copy?

Do not use serialization for copying unless intentional and measured. It is slow and can be insecure.

---

# 33. Production Failure Modes

## 33.1 Missing hashCode

Symptom:

```text
HashSet contains fails for logically same ID.
```

Cause:

```java
equals overridden, hashCode not.
```

Fix:

- override both;
- use record.

## 33.2 Mutable key in HashMap

Symptom:

```text
Cache miss after key object updated.
```

Cause:

```java
key field used in hashCode changed.
```

Fix:

- immutable key;
- typed ID key.

## 33.3 Entity equality changes after persistence

Symptom:

```text
Entity disappears from HashSet after save.
```

Cause:

```java
id null before save, non-null after save, hashCode changes.
```

Fix:

- stable application ID;
- avoid hash collection before persist;
- equality strategy.

## 33.4 TreeSet drops distinct elements

Symptom:

```text
Only one person with same name in TreeSet.
```

Cause:

```java
Comparator compares name only.
```

Fix:

- include ID tie-breaker;
- use List sort for display.

## 33.5 BigDecimal duplicate mismatch

Symptom:

```text
HashSet and TreeSet disagree.
```

Cause:

```java
BigDecimal equals vs compareTo inconsistency.
```

Fix:

- normalize;
- Money type;
- explicit comparator/equality.

## 33.6 Record with byte[] equality bug

Symptom:

```text
Digest objects with same bytes not equal.
```

Cause:

```java
array equals by identity.
```

Fix:

- custom equals/hashCode;
- wrapper.

## 33.7 String `==` bug

Symptom:

```text
Status comparison works in tests but fails in production.
```

Cause:

```java
status == "CLOSED"
```

Fix:

- enum;
- `.equals`;
- typed status.

## 33.8 Sensitive toString leak

Symptom:

```text
Access token appears in logs.
```

Cause:

```java
record generated toString.
```

Fix:

- override toString;
- logging policy.

## 33.9 Comparator overflow

```java
return a.priority() - b.priority();
```

Can overflow.

Fix:

```java
Integer.compare(a.priority(), b.priority())
```

## 33.10 Non-deterministic pagination

Symptom:

```text
Items duplicated/skipped between pages.
```

Cause:

```text
sort by non-unique field without tie-breaker
```

Fix:

```text
ORDER BY created_at, id
```

or comparator with tie-breaker.

---

# 34. Best Practices

## 34.1 Equality

- Decide identity vs value semantics explicitly.
- Override `equals` and `hashCode` together.
- Use records for immutable value objects.
- Avoid mutable fields in equals/hashCode.
- Avoid equality across complex inheritance.
- Use typed IDs for entities.
- Be careful with ORM proxies/generated IDs.
- Do not compare strings with `==`.
- Use enum `==`.
- Normalize values before equality if domain requires.
- Be careful with BigDecimal scale.
- Reject/normalize floating weird values in domain types.

## 34.2 Hashing

- Hash keys must be immutable.
- Do not use hashCode as ID/checksum/security token.
- Include all fields relevant to equality.
- Avoid arrays as raw keys.
- Test HashSet/HashMap behavior.

## 34.3 Ordering

- Implement Comparable only for obvious natural order.
- Use Comparator for use-case-specific order.
- Do not subtract in compare.
- Add deterministic tie-breakers.
- Be careful using comparator in TreeSet/TreeMap.
- Use Collator for natural-language sorting.

## 34.4 toString

- Make diagnostic but safe.
- Mask secrets/PII.
- Avoid huge payload dumps.
- Avoid side effects/lazy loads.

## 34.5 Collections

- Understand HashSet uniqueness: equals/hashCode.
- Understand TreeSet uniqueness: compareTo/comparator.
- Use EnumSet/EnumMap for enums.
- Use typed immutable keys.

---

# 35. Decision Matrix

| Type/class kind | Equality strategy |
|---|---|
| primitive wrapper value | built-in equals, beware boxing |
| String | content equals, normalize if needed |
| enum | `==` |
| value object | value equality, immutable |
| typed ID | value equality |
| money | amount+currency, normalize scale or minor unit |
| floating score | validate finite, exact or domain-defined equality |
| entity with stable app ID | equality by ID |
| entity with DB-generated ID | careful strategy; avoid hash set before persist |
| DTO record | record equality if components safe |
| record with array | custom equality or avoid |
| mutable object | avoid as key; identity equality maybe |
| service/resource | identity equality/default |
| sorted display | Comparator |
| sorted uniqueness | Comparator includes uniqueness fields |
| distributed idempotency | explicit event/command ID, not object identity |

---

# 36. Latihan

## Latihan 1 — Missing hashCode

Buat class `CaseId` override equals tanpa hashCode. Masukkan ke HashSet. Amati `contains`.

Perbaiki dengan hashCode atau record.

## Latihan 2 — Mutable key

Buat mutable key, masukkan ke HashMap, ubah field, lalu lookup.

Jelaskan kenapa gagal.

## Latihan 3 — Record with array

Buat:

```java
record Digest(byte[] bytes) {}
```

Bandingkan dua digest dengan isi sama. Perbaiki.

## Latihan 4 — BigDecimal HashSet vs TreeSet

Masukkan:

```java
new BigDecimal("1.0")
new BigDecimal("1.00")
```

ke HashSet dan TreeSet. Jelaskan hasil.

## Latihan 5 — Entity equality

Desain equality untuk entity `CaseRecord` dengan `CaseId` application-assigned.

Lalu desain untuk entity dengan DB-generated ID. Jelaskan trade-off.

## Latihan 6 — Comparator overflow

Tulis comparator dengan subtraction dan buat contoh overflow. Perbaiki dengan `Integer.compare`.

## Latihan 7 — TreeSet comparator trap

Buat `Person(id, name)`, TreeSet comparator by name only. Masukkan dua person nama sama ID berbeda. Perbaiki.

## Latihan 8 — Stable pagination sort

Buat list case dengan same `createdAt`. Sort hanya by `createdAt`, lalu by `createdAt + caseId`. Jelaskan determinism.

## Latihan 9 — Sensitive toString

Buat record `AccessToken(String value)`. Lihat generated toString. Override agar aman.

## Latihan 10 — String interning

Bandingkan:

```java
"hello" == "hello"
new String("hello") == "hello"
new String("hello").equals("hello")
```

Jelaskan.

---

# 37. Ringkasan

Equality, hashing, identity, dan ordering adalah kontrak fundamental reference types di Java.

Hal utama:

```text
==          : identity comparison for references
equals      : logical equality
hashCode    : bucket/hash contract consistent with equals
compareTo   : natural ordering
Comparator  : external ordering strategy
```

Rules:

- value object equality by values;
- entity equality by stable identity;
- mutable keys are dangerous;
- override equals and hashCode together;
- records help but beware mutable/array components;
- BigDecimal equals differs from compareTo;
- floating point equality has NaN/-0.0 traps;
- String content uses equals, enum uses `==`;
- TreeSet/TreeMap uniqueness uses comparator/compareTo;
- stable sorting needs tie-breakers;
- toString must not leak secrets.

Top-tier Java engineer treats equality as a design decision, not IDE-generated boilerplate.

Before writing `equals`, ask:

```text
What does "same" mean in this domain?
Will object be mutable?
Will it be used in HashMap/HashSet?
Will it be sorted?
Will it cross process boundaries?
Will ORM proxies be involved?
Will toString appear in logs?
```

Correct equality design prevents a large class of subtle production bugs.

---

# 38. Referensi

1. Java SE 25 API — `Object`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html

2. Java SE 25 API — `Objects`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Objects.html

3. Java SE 25 API — `System.identityHashCode`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/System.html#identityHashCode(java.lang.Object)

4. Java SE 25 API — `IdentityHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/IdentityHashMap.html

5. Java SE 25 API — `HashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashMap.html

6. Java SE 25 API — `HashSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashSet.html

7. Java SE 25 API — `Comparable`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Comparable.html

8. Java SE 25 API — `Comparator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Comparator.html

9. Java SE 25 API — `TreeSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/TreeSet.html

10. Java SE 25 API — `TreeMap`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/TreeMap.html

11. Java SE 25 API — `Arrays`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html

12. Java SE 25 API — `BigDecimal`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigDecimal.html

13. Java Language Specification SE 25 — Classes, Objects, and Reference Types  
    https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html

14. JEP 395 — Records  
    https://openjdk.org/jeps/395
