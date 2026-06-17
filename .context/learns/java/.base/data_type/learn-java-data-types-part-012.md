# learn-java-data-types-part-012.md

# Java Data Types — Part 012  
# Records: Transparent Data Carrier, Value Semantics, Invariants, dan Production Modeling

> Seri: **Advanced Java Data Types**  
> Bagian: **012**  
> Fokus: memahami `record` sebagai data type modern di Java: transparent carrier for immutable data, record components, canonical constructor, compact constructor, generated accessors, `equals/hashCode/toString`, shallow immutability, validation, normalization, defensive copy, array trap, serialization, pattern matching, DTO/domain value object, dan kapan record tidak tepat.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Apa Itu Record](#2-apa-itu-record)
3. [Mental Model: Transparent Data Carrier](#3-mental-model-transparent-data-carrier)
4. [Basic Record Declaration](#4-basic-record-declaration)
5. [Record Components](#5-record-components)
6. [Generated Members](#6-generated-members)
7. [Canonical Constructor](#7-canonical-constructor)
8. [Compact Constructor](#8-compact-constructor)
9. [Validation dan Invariant](#9-validation-dan-invariant)
10. [Normalization di Constructor](#10-normalization-di-constructor)
11. [Accessor Method: Bukan Getter JavaBean](#11-accessor-method-bukan-getter-javabean)
12. [Record Equality dan Hashing](#12-record-equality-dan-hashing)
13. [Record `toString` dan Data Leakage](#13-record-tostring-dan-data-leakage)
14. [Shallow Immutability](#14-shallow-immutability)
15. [Mutable Component Trap](#15-mutable-component-trap)
16. [Array Component Trap](#16-array-component-trap)
17. [Defensive Copy dalam Record](#17-defensive-copy-dalam-record)
18. [Record dan Collections](#18-record-dan-collections)
19. [Record dan Domain Value Object](#19-record-dan-domain-value-object)
20. [Record dan DTO](#20-record-dan-dto)
21. [Record dan Entity: Kenapa Sering Tidak Cocok](#21-record-dan-entity-kenapa-sering-tidak-cocok)
22. [Record dan Sealed Type](#22-record-dan-sealed-type)
23. [Record Patterns dan Deconstruction](#23-record-patterns-dan-deconstruction)
24. [Nested, Local, dan Generic Records](#24-nested-local-dan-generic-records)
25. [Record dan Interfaces](#25-record-dan-interfaces)
26. [Record dan Serialization](#26-record-dan-serialization)
27. [Record dan Reflection](#27-record-dan-reflection)
28. [Record di JSON/API Boundary](#28-record-di-jsonapi-boundary)
29. [Record di Database/ORM Boundary](#29-record-di-databaseorm-boundary)
30. [Record dan Builder Pattern](#30-record-dan-builder-pattern)
31. [Record vs Lombok/Data Class](#31-record-vs-lombokdata-class)
32. [Record vs Class](#32-record-vs-class)
33. [Production Failure Modes](#33-production-failure-modes)
34. [Best Practices](#34-best-practices)
35. [Decision Matrix](#35-decision-matrix)
36. [Latihan](#36-latihan)
37. [Ringkasan](#37-ringkasan)
38. [Referensi](#38-referensi)

---

# 1. Tujuan Bagian Ini

Records adalah salah satu fitur Java modern paling penting untuk data modeling.

Sebelum record, kita sering menulis:

```java
public final class CaseId {
    private final String value;

    public CaseId(String value) {
        this.value = Objects.requireNonNull(value);
    }

    public String value() {
        return value;
    }

    @Override
    public boolean equals(Object o) { ... }

    @Override
    public int hashCode() { ... }

    @Override
    public String toString() { ... }
}
```

Dengan record:

```java
public record CaseId(String value) {
    public CaseId {
        Objects.requireNonNull(value, "value");
    }
}
```

Boilerplate berkurang drastis.

Tetapi record bukan “Lombok class pendek” semata. Record membawa design intent:

```text
This type is a transparent carrier for data.
Its API exposes its state.
Its equality is based on its components.
```

Bagian ini akan membahas:

- kapan record tepat;
- bagaimana constructor record bekerja;
- bagaimana validasi dan normalization dilakukan;
- kenapa record immutable hanya secara shallow;
- kenapa array/list component bisa berbahaya;
- bagaimana record cocok untuk value object dan DTO;
- kenapa record sering tidak cocok untuk entity;
- bagaimana record bekerja dengan sealed type dan pattern matching;
- bagaimana serialization record berbeda;
- production failure modes.

---

# 2. Apa Itu Record

Record adalah special kind of class di Java untuk mendeklarasikan data carrier secara ringkas.

Contoh:

```java
public record Point(int x, int y) {}
```

Record ini secara otomatis memiliki:

- private final fields;
- public accessor methods `x()` dan `y()`;
- canonical constructor;
- `equals`;
- `hashCode`;
- `toString`.

Record cocok ketika class utamanya merepresentasikan data, bukan identity mutable entity.

## 2.1 Record adalah class

Record tetap class.

```java
Point p = new Point(1, 2);
p instanceof Point // true
p instanceof Record // true
```

## 2.2 Record extends `java.lang.Record`

Setiap record secara implisit extend `java.lang.Record`.

Tidak bisa extend class lain.

## 2.3 Record can implement interfaces

```java
public record CaseId(String value) implements Comparable<CaseId> {
    @Override
    public int compareTo(CaseId other) {
        return this.value.compareTo(other.value);
    }
}
```

## 2.4 Record is final

Record class is implicitly final. Tidak bisa subclass record.

Ini bagus untuk value semantics.

---

# 3. Mental Model: Transparent Data Carrier

JEP 395 mendeskripsikan records sebagai classes that act as transparent carriers for immutable data.

Kata kunci: **transparent**.

Artinya record intentionally exposes its components through accessors.

```java
record Money(BigDecimal amount, Currency currency) {}
```

Caller bisa melihat:

```java
money.amount()
money.currency()
```

Record bukan untuk menyembunyikan representation yang kompleks.

## 3.1 Transparent bukan berarti tanpa invariant

Record tetap bisa validate.

```java
public record Percentage(BigDecimal value) {
    public Percentage {
        Objects.requireNonNull(value);
        if (value.compareTo(BigDecimal.ZERO) < 0 ||
            value.compareTo(new BigDecimal("100")) > 0) {
            throw new IllegalArgumentException("Percentage must be 0..100");
        }
    }
}
```

## 3.2 Transparent means API matches state

Record header adalah state description.

```java
record DateRange(LocalDate startInclusive, LocalDate endExclusive) {}
```

Jika kamu tidak mau expose components, record mungkin bukan type yang tepat.

## 3.3 Not all data classes should be records

Jika class:

- punya identity;
- mutable lifecycle;
- hides internal representation;
- manages resources;
- has complex invariants not reflected by components;
- requires lazy loading;
- requires subclassing;

maka normal class mungkin lebih tepat.

---

# 4. Basic Record Declaration

```java
public record UserSummary(UserId id, DisplayName name, EmailAddress email) {}
```

This declares record components:

```text
id
name
email
```

Generated accessors:

```java
id()
name()
email()
```

## 4.1 Constructor usage

```java
UserSummary summary = new UserSummary(id, name, email);
```

## 4.2 Accessors

```java
summary.id()
summary.name()
summary.email()
```

Not:

```java
summary.getId()
```

unless you define custom method.

## 4.3 `equals/hashCode/toString`

```java
new UserSummary(id, name, email).equals(new UserSummary(id, name, email))
```

compares components.

## 4.4 Package-private record

```java
record InternalKey(String value) {}
```

Records can have normal access modifiers depending location.

## 4.5 Record in same file

Top-level public record must be in same-named file.

Non-public top-level records can be in same file as other types, same as classes.

---

# 5. Record Components

Record header defines components.

```java
record CaseEvent(
    EventId eventId,
    CaseId caseId,
    Instant occurredAt,
    CaseStatus status
) {}
```

Each component defines:

- private final field;
- public accessor method with same name;
- constructor parameter;
- participation in generated equals/hashCode/toString.

## 5.1 Component names matter

Component names become API method names.

```java
caseEvent.occurredAt()
```

Choose names carefully.

## 5.2 Component order matters

Component order affects:

- constructor parameter order;
- generated toString order;
- deconstruction/pattern matching;
- readability.

Prefer logical order:

```java
record Money(BigDecimal amount, Currency currency) {}
```

not:

```java
record Money(Currency currency, BigDecimal amount) {}
```

unless your domain convention says otherwise.

## 5.3 Component type should be meaningful

Bad:

```java
record Assignment(String a, String b) {}
```

Good:

```java
record Assignment(CaseId caseId, OfficerId officerId) {}
```

## 5.4 Avoid too many components

A record with 15 components is hard to construct/read.

Consider:

- nested value objects;
- command object hierarchy;
- builder;
- normal class;
- grouping related fields.

---

# 6. Generated Members

For:

```java
record Point(int x, int y) {}
```

Compiler generates roughly:

```java
private final int x;
private final int y;

public Point(int x, int y) {
    this.x = x;
    this.y = y;
}

public int x() { return x; }
public int y() { return y; }

public boolean equals(Object o) { ... }
public int hashCode() { ... }
public String toString() { ... }
```

## 6.1 Generated equals

Equality based on all components.

## 6.2 Generated hashCode

Hash based on all components.

## 6.3 Generated toString

Example:

```text
Point[x=1, y=2]
```

## 6.4 Generated constructor

Canonical constructor parameter list matches record components.

## 6.5 You can override

You may explicitly define:

- canonical constructor;
- compact constructor;
- accessor;
- equals/hashCode/toString;
- additional methods;
- static factory methods.

But overriding must preserve record semantics as much as possible.

---

# 7. Canonical Constructor

Canonical constructor has same parameter list as record header.

```java
public record CaseId(String value) {
    public CaseId(String value) {
        this.value = Objects.requireNonNull(value, "value");
    }
}
```

## 7.1 Full canonical constructor

You assign fields explicitly.

```java
public record Range(int start, int end) {
    public Range(int start, int end) {
        if (end < start) {
            throw new IllegalArgumentException("end must be >= start");
        }
        this.start = start;
        this.end = end;
    }
}
```

## 7.2 Access modifier

Canonical constructor cannot be more restrictive than record class.

For public record, canonical constructor must be public.

## 7.3 Parameter names

Parameter names correspond to components.

## 7.4 When use full canonical constructor?

Use when:

- you need explicit assignment;
- defensive copy with field assignment;
- complex transformations;
- custom logic difficult in compact constructor.

But compact constructor is usually simpler.

---

# 8. Compact Constructor

Compact constructor omits parameter list.

```java
public record CaseId(String value) {
    public CaseId {
        Objects.requireNonNull(value, "value");
        if (value.isBlank()) {
            throw new IllegalArgumentException("CaseId cannot be blank");
        }
    }
}
```

Compiler inserts field assignment after constructor body.

## 8.1 Normalize parameter

```java
public record PolicyCode(String value) {
    public PolicyCode {
        Objects.requireNonNull(value, "value");
        value = value.strip().toUpperCase(Locale.ROOT);
        if (!value.matches("[A-Z0-9_]{3,64}")) {
            throw new IllegalArgumentException("Invalid policy code");
        }
    }
}
```

The reassigned `value` is assigned to field by compiler.

## 8.2 Cannot assign fields directly in compact constructor

In compact constructor, fields are assigned automatically. You normally work with parameters.

## 8.3 Validate all invariants

```java
public record DateRange(LocalDate startInclusive, LocalDate endExclusive) {
    public DateRange {
        Objects.requireNonNull(startInclusive);
        Objects.requireNonNull(endExclusive);
        if (!startInclusive.isBefore(endExclusive)) {
            throw new IllegalArgumentException("start must be before end");
        }
    }
}
```

## 8.4 Compact constructor is ideal for value objects

Short, clear, central invariant.

---

# 9. Validation dan Invariant

Record constructor is the place to enforce invariants.

## 9.1 Non-null components

```java
public record EmailAddress(String value) {
    public EmailAddress {
        Objects.requireNonNull(value, "value");
    }
}
```

## 9.2 Range

```java
public record PageSize(int value) {
    public PageSize {
        if (value < 1 || value > 200) {
            throw new IllegalArgumentException("Page size must be 1..200");
        }
    }
}
```

## 9.3 Cross-field invariant

```java
public record DateRange(LocalDate startInclusive, LocalDate endExclusive) {
    public DateRange {
        Objects.requireNonNull(startInclusive);
        Objects.requireNonNull(endExclusive);

        if (!startInclusive.isBefore(endExclusive)) {
            throw new IllegalArgumentException("Invalid date range");
        }
    }
}
```

## 9.4 Currency invariant

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount, "amount");
        Objects.requireNonNull(currency, "currency");
    }

    public Money add(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("Currency mismatch");
        }
        return new Money(amount.add(other.amount), currency);
    }
}
```

## 9.5 Fail fast

Do not allow invalid record then hope callers handle it later.

A record instance should be valid after construction.

---

# 10. Normalization di Constructor

Normalization converts input to canonical form.

## 10.1 Policy code

```java
public record PolicyCode(String value) {
    private static final Pattern PATTERN = Pattern.compile("[A-Z0-9_]{3,64}");

    public PolicyCode {
        Objects.requireNonNull(value);
        value = value.strip().toUpperCase(Locale.ROOT);

        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid policy code");
        }
    }
}
```

## 10.2 Username

```java
public record Username(String value) {
    public Username {
        Objects.requireNonNull(value);
        value = Normalizer.normalize(value, Normalizer.Form.NFKC)
            .strip()
            .toLowerCase(Locale.ROOT);

        if (!value.matches("[a-z0-9_]{3,32}")) {
            throw new IllegalArgumentException("Invalid username");
        }
    }
}
```

## 10.3 BigDecimal normalization

```java
public record Amount(BigDecimal value) {
    public Amount {
        Objects.requireNonNull(value);
        value = value.stripTrailingZeros();
    }
}
```

Be careful: scale may be domain-significant.

## 10.4 Normalize before validation or after?

Depends.

Often:

```text
require non-null
strip/normalize
validate canonical value
assign
```

But if original form matters for audit/display, store both:

```java
record DisplayName(String original, String searchKey) {}
```

## 10.5 Constructor side effects

Avoid side effects in record constructor.

Records should be simple data values. Constructor should validate/normalize, not call DB/network.

---

# 11. Accessor Method: Bukan Getter JavaBean

Record accessor name equals component name.

```java
record User(String name) {}
```

Accessor:

```java
user.name()
```

Not generated:

```java
getName()
```

## 11.1 Framework compatibility

Modern frameworks generally support records, but older JavaBean-only tools may expect getters.

Check framework support.

## 11.2 Custom accessor

You can define accessor:

```java
public record Password(String value) {
    @Override
    public String value() {
        throw new UnsupportedOperationException("Password value is sensitive");
    }
}
```

But this may violate transparency expectation and surprise frameworks.

Better: do not use record if you cannot expose component.

## 11.3 Accessor should be simple

Record accessor should generally return component or defensive copy for mutable component.

```java
public byte[] bytes() {
    return bytes.clone();
}
```

## 11.4 Derived methods

Add methods for derived behavior:

```java
record DateRange(LocalDate startInclusive, LocalDate endExclusive) {
    boolean contains(LocalDate date) { ... }
    long days() { ... }
}
```

Good.

---

# 12. Record Equality dan Hashing

Generated equals/hashCode use all components.

```java
record Point(int x, int y) {}

new Point(1, 2).equals(new Point(1, 2)) // true
```

## 12.1 All components participate

```java
record CaseSummary(CaseId id, CaseStatus status) {}
```

If status differs, summaries unequal.

This is correct for value/DTO, but may be wrong for entity.

## 12.2 Component equality matters

If component has weird equality, record inherits it.

Examples:

- `BigDecimal("1.0")` vs `BigDecimal("1.00")`;
- arrays compare by reference;
- mutable lists can change equality over time;
- `Double.NaN`/`-0.0` semantics.

## 12.3 Record with BigDecimal

```java
record Money(BigDecimal amount, Currency currency) {}
```

Generated equality uses `BigDecimal.equals`, which includes scale.

If domain wants numeric equality, normalize or custom class.

## 12.4 Record with array

```java
record Digest(byte[] bytes) {}
```

Generated equality compares array reference, not content.

Danger.

## 12.5 Record as map key

Record can be excellent map key if:

- components immutable;
- equality semantics correct;
- hashCode stable.

Example:

```java
record CacheKey(TenantId tenantId, UserId userId, QueryHash queryHash) {}
```

---

# 13. Record `toString` dan Data Leakage

Generated toString includes component names and values.

```java
record LoginRequest(String username, String password) {}
```

toString:

```text
LoginRequest[username=fajar, password=secret]
```

This is dangerous if logged.

## 13.1 Override for sensitive data

```java
public record LoginRequest(String username, String password) {
    @Override
    public String toString() {
        return "LoginRequest[username=" + username + ", password=masked]";
    }
}
```

## 13.2 Better sensitive wrapper

```java
public record Password(String value) {
    @Override
    public String toString() {
        return "Password[masked]";
    }
}
```

Then:

```java
record LoginRequest(String username, Password password) {}
```

Generated toString uses `Password[masked]`.

## 13.3 Large data

```java
record Payload(byte[] bytes) {}
```

Generated toString prints array identity, not content, but still not helpful.

Override:

```java
Payload[length=12345]
```

## 13.4 PII

Records make logging easy but risky.

Review records containing:

- password;
- token;
- email;
- phone;
- address;
- identification number;
- raw payload.

---

# 14. Shallow Immutability

Record fields are final, but component objects may be mutable.

```java
record Names(List<String> values) {}
```

The reference to list is final, but list content may change.

```java
List<String> list = new ArrayList<>();
Names names = new Names(list);

list.add("Fajar");

System.out.println(names.values()); // [Fajar]
```

Record is shallowly immutable, not deeply immutable.

## 14.1 Final reference

```java
private final List<String> values;
```

means field cannot point to another list after construction.

It does not make list immutable.

## 14.2 Immutable components

Record is safely immutable if all components are immutable and no mutable internals leak.

Good:

```java
record CaseId(String value) {}
record Money(BigDecimal amount, Currency currency) {}
record DateRange(LocalDate start, LocalDate end) {}
```

assuming component types immutable enough.

## 14.3 Mutable components need defensive copy

```java
record EvidenceSet(List<Evidence> values) {
    EvidenceSet {
        values = List.copyOf(values);
    }
}
```

## 14.4 Element mutability

`List.copyOf` makes list unmodifiable, but elements can still be mutable.

If `Evidence` mutable, deep immutability still not guaranteed.

---

# 15. Mutable Component Trap

## 15.1 List component

```java
record Tags(List<String> values) {}
```

Problem:

```java
List<String> list = new ArrayList<>();
Tags tags = new Tags(list);
list.add("urgent");
```

`tags` changed.

## 15.2 HashMap key disaster

```java
Tags tags = new Tags(list);
map.put(tags, value);
list.add("new");

map.get(tags) // may fail because hashCode changed
```

## 15.3 Fix with copy

```java
public record Tags(List<String> values) {
    public Tags {
        values = List.copyOf(values);
    }
}
```

Now external list mutation doesn't affect record.

## 15.4 Beware accessor

If internal list unmodifiable, returning it is okay.

If internal list mutable, accessor exposes it.

## 15.5 Set/Map components

Use:

```java
Set.copyOf
Map.copyOf
```

for unmodifiable snapshots.

But be aware of iteration order and null rejection behavior.

---

# 16. Array Component Trap

Arrays are mutable and their equals/hashCode are identity-based.

```java
public record Digest(byte[] bytes) {}
```

Problems:

1. constructor stores mutable array reference;
2. accessor returns mutable array;
3. generated equals compares array reference;
4. generated hashCode uses array identity;
5. generated toString not content-aware.

## 16.1 Equality bug

```java
new Digest(new byte[]{1, 2})
    .equals(new Digest(new byte[]{1, 2})) // false
```

## 16.2 Mutation bug

```java
byte[] raw = {1, 2};
Digest d = new Digest(raw);
raw[0] = 99;
```

Record changed.

## 16.3 Fix in record

```java
public record Digest(byte[] bytes) {
    public Digest {
        bytes = bytes.clone();
    }

    @Override
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
        return "Digest[length=" + bytes.length + "]";
    }
}
```

## 16.4 Maybe use final class

For array-heavy value objects, final class can be clearer than record.

## 16.5 Rule

Avoid array components in records unless you deliberately handle copy/equality/toString.

---

# 17. Defensive Copy dalam Record

## 17.1 List copy

```java
public record EvidenceSet(List<Evidence> values) {
    public EvidenceSet {
        values = List.copyOf(values);
    }
}
```

## 17.2 Set copy

```java
public record Permissions(Set<Permission> values) {
    public Permissions {
        values = Set.copyOf(values);
    }
}
```

For enum set:

```java
public record Permissions(EnumSet<Permission> values) {
    public Permissions {
        values = values.isEmpty()
            ? EnumSet.noneOf(Permission.class)
            : EnumSet.copyOf(values);
    }

    @Override
    public EnumSet<Permission> values() {
        return EnumSet.copyOf(values);
    }
}
```

But exposing `Set<Permission>` might be simpler.

## 17.3 Map copy

```java
public record Attributes(Map<String, String> values) {
    public Attributes {
        values = Map.copyOf(values);
    }
}
```

## 17.4 Array copy

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

But remember equality needs override too.

## 17.5 Copy cost

Defensive copy costs memory/time.

For public value objects, correctness usually wins.

For internal performance-critical code, define ownership transfer explicitly.

---

# 18. Record dan Collections

Records work well with immutable collections.

```java
record OrderLines(List<OrderLine> lines) {
    OrderLines {
        lines = List.copyOf(lines);
        if (lines.isEmpty()) {
            throw new IllegalArgumentException("Order must have at least one line");
        }
    }
}
```

## 18.1 Null elements

`List.copyOf` rejects null elements.

This is often good.

If null elements are allowed, you need different policy, but null in domain collections is usually bad.

## 18.2 Order matters

List equality is order-sensitive.

Set equality is order-insensitive.

Choose component type based on domain.

## 18.3 Collection equality

Generated record equality delegates to collection equals.

```java
List.of("a", "b").equals(List.of("a", "b")) // true
Set.of("a", "b").equals(Set.of("b", "a"))   // true
```

## 18.4 Mutable elements

Even if collection unmodifiable, elements may be mutable.

Deep immutability requires immutable elements.

## 18.5 Large collections

Generated toString may print entire collection.

Override toString for large collections.

---

# 19. Record dan Domain Value Object

Records are excellent for value objects.

Examples:

```java
record CaseId(String value) {}
record OfficerId(String value) {}
record Money(BigDecimal amount, Currency currency) {}
record DateRange(LocalDate startInclusive, LocalDate endExclusive) {}
record PageSize(int value) {}
record RiskScore(double value) {}
```

## 19.1 Typed ID

```java
public record CaseId(String value) {
    public CaseId {
        Objects.requireNonNull(value);
        value = value.strip().toUpperCase(Locale.ROOT);

        if (!value.matches("CASE-[0-9]{6}")) {
            throw new IllegalArgumentException("Invalid case id");
        }
    }
}
```

Prevents parameter mix-up:

```java
void assign(CaseId caseId, OfficerId officerId) {}
```

## 19.2 Range value

```java
public record PageSize(int value) {
    public PageSize {
        if (value < 1 || value > 200) {
            throw new IllegalArgumentException("Page size must be 1..200");
        }
    }
}
```

## 19.3 Behavior in value object

Records can have methods:

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money add(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("Currency mismatch");
        }
        return new Money(amount.add(other.amount), currency);
    }
}
```

Good.

## 19.4 Keep behavior cohesive

Value-object behavior that depends only on components fits record.

Behavior requiring repositories/services probably belongs elsewhere.

---

# 20. Record dan DTO

Records are good for DTOs:

```java
public record CaseResponse(
    String caseId,
    String status,
    String submittedAt
) {}
```

## 20.1 API response DTO

Records are concise and immutable.

## 20.2 API request DTO

Records can be used for request DTOs, but validation/mapping needed.

```java
public record CloseCaseRequest(String reason) {}
```

Map to domain:

```java
new ClosureReason(request.reason())
```

## 20.3 Missing/null fields

Deserialization may pass null.

Record constructor should validate if DTO requires non-null, or validation framework should catch.

## 20.4 Framework support

Modern JSON frameworks usually support records, but check:

- constructor binding;
- parameter names;
- annotations;
- default values;
- null handling;
- validation integration.

## 20.5 DTO vs domain record

Do not confuse:

```java
record CaseResponse(String status) {}
```

with:

```java
record CaseStatus(...)
```

DTO follows external contract; domain record follows domain invariant.

---

# 21. Record dan Entity: Kenapa Sering Tidak Cocok

Entity has identity and lifecycle. Record equality includes all components.

Example:

```java
record CaseRecord(CaseId id, CaseStatus status, Instant updatedAt) {}
```

If status changes, new record unequal to old record.

Is that correct?

For immutable snapshot/DTO, yes.

For domain entity, maybe no.

## 21.1 Entity mutability

Entities often change:

```java
case.submit()
case.assign()
case.close()
```

Record fields are final.

You can model entity as immutable record returning new state, but that is architectural choice.

## 21.2 Entity equality

Entity equality often by stable ID, not all fields.

Record equality all components may be wrong.

## 21.3 ORM constraints

ORM/JPA often needs:

- no-arg constructor;
- proxies;
- lazy loading;
- mutable fields;
- identity lifecycle.

Records are not ideal as JPA entities.

They can be good for projections.

## 21.4 Good use: entity snapshot

```java
record CaseSnapshot(CaseId id, CaseStatus status, Instant updatedAt) {}
```

Snapshot equality by all components may be correct.

## 21.5 Good use: event

```java
record CaseClosed(CaseId caseId, OfficerId closedBy, ClosureReason reason, Instant occurredAt) {}
```

Event is immutable data.

---

# 22. Record dan Sealed Type

Records combine beautifully with sealed interfaces.

```java
sealed interface CloseCaseResult permits CaseClosed, CloseRejected, CaseNotFound {}

record CaseClosed(CaseId caseId, Instant closedAt) implements CloseCaseResult {}
record CloseRejected(CaseId caseId, RejectionReason reason) implements CloseCaseResult {}
record CaseNotFound(CaseId caseId) implements CloseCaseResult {}
```

## 22.1 Algebraic data modeling

This creates closed alternatives with data.

```java
switch (result) {
    case CaseClosed closed -> ...
    case CloseRejected rejected -> ...
    case CaseNotFound notFound -> ...
}
```

## 22.2 Better than boolean/result code

Bad:

```java
boolean success;
String reason;
```

Good:

```java
sealed result + records
```

## 22.3 State modeling

```java
sealed interface CaseState permits Draft, UnderReview, Closed {}

record Draft() implements CaseState {}
record UnderReview(OfficerId officerId, Instant assignedAt) implements CaseState {}
record Closed(OfficerId closedBy, ClosureReason reason, Instant closedAt) implements CaseState {}
```

Each state has exact required data.

## 22.4 Records as variants

Records are ideal as sealed variants because they are immutable data carriers.

---

# 23. Record Patterns dan Deconstruction

Record patterns allow deconstructing records in pattern matching.

Example from record pattern concept:

```java
record Point(int x, int y) {}
```

Pattern matching can extract components:

```java
if (obj instanceof Point(int x, int y)) {
    System.out.println(x + ", " + y);
}
```

## 23.1 Why record patterns matter

Records are transparent carriers; pattern matching consumes that transparency.

Instead of:

```java
Point p = (Point) obj;
int x = p.x();
int y = p.y();
```

Use deconstruction pattern where available.

## 23.2 Nested patterns

```java
record Rectangle(Point topLeft, Point bottomRight) {}
```

Can be matched structurally:

```java
if (shape instanceof Rectangle(Point(int x1, int y1), Point(int x2, int y2))) {
    ...
}
```

## 23.3 Design implication

Component order/names matter more.

Record header becomes deconstruction contract.

## 23.4 Avoid record if deconstruction exposes too much

If exposing components is not desired, don't use record.

## 23.5 Pattern matching version awareness

Record patterns were finalized after records. Check the Java version used by your project before using pattern syntax.

---

# 24. Nested, Local, dan Generic Records

## 24.1 Nested record

```java
class Report {
    record Row(String label, BigDecimal value) {}
}
```

Nested records are implicitly static.

## 24.2 Local record

Useful inside method:

```java
void process(List<Order> orders) {
    record Summary(CustomerId customerId, BigDecimal total) {}

    List<Summary> summaries = ...
}
```

Great for intermediate data in stream/aggregation logic.

## 24.3 Generic record

```java
record Pair<L, R>(L left, R right) {}
```

## 24.4 Generic constraints

```java
record Id<T>(String value) {}
```

Phantom type pattern possible:

```java
Id<CaseRecord> caseId
Id<Officer> officerId
```

But simple explicit records often clearer:

```java
record CaseId(String value) {}
record OfficerId(String value) {}
```

## 24.5 Local record readability

Local records can make complex stream code clearer by naming intermediate tuple.

Avoid anonymous `Map.Entry`/object arrays.

---

# 25. Record dan Interfaces

Records can implement interfaces.

```java
interface DomainEvent {
    EventId eventId();
    Instant occurredAt();
}

record CaseClosed(
    EventId eventId,
    CaseId caseId,
    Instant occurredAt
) implements DomainEvent {}
```

## 25.1 Interface accessors

If interface method matches component accessor, record automatically implements it.

```java
interface HasCaseId {
    CaseId caseId();
}

record CaseClosed(CaseId caseId) implements HasCaseId {}
```

## 25.2 Marker interfaces

```java
interface Command {}
record CloseCaseCommand(CaseId caseId, ClosureReason reason) implements Command {}
```

Useful with sealed interfaces.

## 25.3 Comparable

```java
record Version(long value) implements Comparable<Version> {
    public Version {
        if (value < 0) throw new IllegalArgumentException();
    }

    @Override
    public int compareTo(Version other) {
        return Long.compare(this.value, other.value);
    }
}
```

## 25.4 Avoid too many interfaces

Do not over-engineer tiny records with unnecessary interfaces.

---

# 26. Record dan Serialization

Record serialization is special.

A serializable record is a record class that implements `Serializable`.

During deserialization, the canonical constructor is invoked. Serialization-related methods like `readObject` and `writeObject` are ignored for serializable records, according to Java API documentation for `Record`.

## 26.1 Example

```java
record Point(int x, int y) implements Serializable {}
```

## 26.2 Constructor invariants preserved

Because canonical constructor is invoked during deserialization, validation can still run.

This is a major benefit.

## 26.3 Serialization methods ignored

For records, custom `readObject`/`writeObject` style used by ordinary serializable classes does not apply in same way.

## 26.4 serialVersionUID

You can define `serialVersionUID`, but record evolution still needs care.

## 26.5 Prefer explicit serialization formats

For services, prefer:

- JSON;
- Protobuf;
- Avro;
- database rows;
- event schema;

rather than Java native serialization for distributed systems.

## 26.6 Compatibility

Changing record components changes serialized form and API shape.

Treat record components as contract if serialized.

---

# 27. Record dan Reflection

Reflection can inspect records.

`Class` has record-related APIs such as:

```java
isRecord()
getRecordComponents()
```

Each component has metadata via `RecordComponent`.

## 27.1 Framework usage

JSON serializers, mappers, documentation generators, and frameworks use record reflection.

## 27.2 Parameter names

Record component names are part of class metadata.

This helps constructor binding.

## 27.3 Annotation on components

Annotations can be placed on record components and may propagate depending annotation targets.

Example:

```java
record UserRequest(@NotBlank String username) {}
```

Framework behavior depends on annotation support.

## 27.4 Reflection does not remove need for validation

Framework can call constructor with null/invalid values. Constructor should protect core invariants.

---

# 28. Record di JSON/API Boundary

## 28.1 Response DTO

```java
public record CaseResponse(
    String caseId,
    String status,
    Instant submittedAt
) {}
```

Good concise API response.

## 28.2 Request DTO

```java
public record CloseCaseRequest(String reason) {}
```

Need validation.

## 28.3 Null handling

If JSON missing field maps to null, record constructor receives null.

For required fields:

```java
public CloseCaseRequest {
    Objects.requireNonNull(reason, "reason");
}
```

But API should return 400 validation error, not generic 500. Integrate with validation framework/exception mapping.

## 28.4 Default values

Records do not have optional constructor parameters/defaults.

Options:

- compact constructor defaulting null/missing carefully;
- overload/static factory;
- builder;
- normal class;
- DTO mapper layer.

## 28.5 API compatibility

Adding a record component changes constructor/API contract.

For public API DTOs, version carefully.

## 28.6 Sensitive request records

Never rely on generated toString if request contains password/token.

---

# 29. Record di Database/ORM Boundary

## 29.1 Good for projections

Records are excellent for read-only projections:

```java
record CaseListItem(CaseId id, CaseStatus status, Instant submittedAt) {}
```

ORM/query mapper can instantiate projection.

## 29.2 Not ideal for entities

JPA entities usually require mutable fields, identity lifecycle, proxies, no-arg constructor, lazy loading.

Records are final and immutable-ish.

## 29.3 Good for row mapping

Manual JDBC mapping:

```java
record CaseRow(long id, String statusCode, Instant updatedAt) {}
```

Then map to domain.

## 29.4 DB nulls

If DB column nullable and record component primitive, cannot represent null.

Use wrapper at row DTO boundary if needed:

```java
record CaseRow(Long assignedOfficerId) {}
```

Then map to explicit domain state.

## 29.5 Persistence constructor validation

If record constructor rejects invalid DB data, mapping fails fast. This can reveal data quality issues.

Good, but handle operationally.

---

# 30. Record dan Builder Pattern

Records have all-args constructor.

For many components, constructor calls become unreadable:

```java
new CreateUserCommand(a, b, c, d, e, f, g)
```

## 30.1 Better grouping

Instead of builder, maybe split types:

```java
record Name(String first, String last) {}
record ContactInfo(Email email, Phone phone) {}
record CreateUserCommand(Name name, ContactInfo contact, Role role) {}
```

## 30.2 Static factory

```java
public static CreateUserCommand ofRequired(...) {}
```

## 30.3 Builder for record

Can be useful for:

- many optional fields;
- test data;
- API client models;
- backwards compatibility.

But if record has too many fields, reconsider design.

## 30.4 Withers

For immutable update:

```java
record UserProfile(DisplayName name, EmailAddress email) {
    UserProfile withName(DisplayName newName) {
        return new UserProfile(newName, email);
    }
}
```

## 30.5 Entity update

If many withers simulate mutable entity workflow, maybe normal entity class is better.

---

# 31. Record vs Lombok/Data Class

## 31.1 Record

Language feature.

Pros:

- standardized;
- compiler/JVM aware;
- reflection support;
- pattern matching support;
- concise;
- clear semantics.

Cons:

- final;
- shallow immutability;
- all components exposed;
- constructor shape fixed;
- not ideal for ORM entities;
- no custom hidden fields beyond static? Records can have static fields but not extra instance fields.

## 31.2 Lombok `@Data`/`@Value`

Library/code generation.

Pros:

- flexible with normal classes;
- JavaBean getters;
- works with frameworks expecting beans;
- can support mutable/immutable variants.

Cons:

- generated code hidden;
- build/tooling dependency;
- semantics less explicit than record;
- potential equals/hashCode mistakes if not configured.

## 31.3 Use record when semantics match

If your type is transparent immutable data carrier, record is ideal.

If not, use class.

## 31.4 Do not blindly replace all Lombok classes

Evaluate:

- entity?
- mutable?
- framework requirements?
- hidden invariants?
- toString sensitivity?
- binary/API compatibility?

---

# 32. Record vs Class

## 32.1 Use record when

- data carrier;
- value object;
- DTO;
- command/event;
- immutable snapshot;
- components should be exposed;
- equality by all components is correct;
- no subclassing needed.

## 32.2 Use class when

- entity with identity/lifecycle;
- mutable aggregate;
- resource management;
- need encapsulation/hide representation;
- equality not all fields;
- array-heavy custom semantics;
- complex construction;
- framework requires bean/no-arg constructor;
- invariants not visible in components.

## 32.3 Example: Record good

```java
record CloseCaseCommand(CaseId caseId, OfficerId actorId, ClosureReason reason) {}
```

## 32.4 Example: Class better

```java
final class CaseRecord {
    private final CaseId id;
    private CaseStatus status;

    void close(CloseCaseCommand command) {
        ...
    }
}
```

Mutable lifecycle entity.

## 32.5 Hybrid

Use class entity + record commands/events/value objects.

This is often excellent design.

---

# 33. Production Failure Modes

## 33.1 Record with List component mutates

Cause:

```java
record Tags(List<String> values) {}
```

No defensive copy.

Fix:

```java
values = List.copyOf(values);
```

## 33.2 Record as HashMap key changes hash

Mutable component changes after insertion.

Fix:

- immutable components;
- defensive copies;
- avoid mutable record keys.

## 33.3 Array component equality bug

```java
record Digest(byte[] bytes) {}
```

Same content unequal.

Fix:

- custom equals/hashCode/accessor;
- final class.

## 33.4 Sensitive data leak via toString

Record contains password/token.

Fix:

- wrapper with masked toString;
- override toString;
- logging policy.

## 33.5 Entity modeled as record incorrectly

Record equality includes status/fields, causing entity identity issues.

Fix:

- normal class entity;
- record snapshot/DTO.

## 33.6 JSON missing field becomes null

Record constructor accepts null; NPE later.

Fix:

- constructor validation;
- API validation framework;
- domain mapping.

## 33.7 BigDecimal scale equality surprise

`Money(BigDecimal("1.0"))` not equal to `Money(BigDecimal("1.00"))`.

Fix:

- normalize;
- minor units;
- custom class.

## 33.8 Generated toString too large

Record contains huge collection/payload; logs explode.

Fix:

- override toString;
- avoid logging entire object.

## 33.9 Adding record component breaks clients

Constructor/deserialization/API changes.

Fix:

- version DTO;
- compatibility plan;
- optional nested object;
- builder/class if evolving frequently.

## 33.10 ORM cannot instantiate record entity

Record used as JPA entity.

Fix:

- use class entity;
- use record projections.

---

# 34. Best Practices

## 34.1 General

- Use records for transparent immutable data carriers.
- Validate invariants in constructor.
- Normalize canonical values in constructor.
- Use domain-specific record types for IDs/codes/ranges.
- Keep components immutable.
- Defensive copy mutable components.
- Avoid array components or override properly.
- Override toString for sensitive/large data.
- Do not use record for mutable entity by default.
- Use records with sealed interfaces for result/state variants.
- Use records for commands/events/DTOs/snapshots.
- Be careful adding/removing/reordering components in public contracts.
- Do not put side effects in record constructor.
- Do not hide complex mutable state behind record.

## 34.2 Equality

- Ensure component equality matches domain equality.
- Beware BigDecimal, arrays, floating point, mutable collections.
- Use record as key only with immutable stable components.

## 34.3 Boundary

- API records need validation/null handling.
- DB row records are good for projections.
- JSON record DTOs require framework support.
- Native Java serialization of records invokes canonical constructor, but prefer explicit formats for services.

## 34.4 Design

- If record has too many fields, create smaller value objects.
- If you want getters/setters, record may be wrong.
- If you need hidden representation, class may be better.
- If each alternative has different data, use sealed interface + records.

---

# 35. Decision Matrix

| Situation | Use record? | Notes |
|---|---:|---|
| typed ID | yes | validate/canonicalize |
| money value | yes maybe | beware BigDecimal scale |
| date range | yes | cross-field invariant |
| API response DTO | yes | watch compatibility |
| API request DTO | yes | validate nulls |
| command object | yes | immutable input |
| domain event | yes | immutable facts |
| result variants | yes with sealed interface | excellent |
| entity/aggregate root | usually no | class often better |
| JPA entity | usually no | use projection record |
| record with List | yes if copied | `List.copyOf` |
| record with byte[] | usually no or custom | copy + equals/hashCode |
| secret/password | maybe wrapper with masked toString | avoid leaking |
| many optional fields | maybe no | builder/class |
| dynamic mutable state | no | class |
| hidden representation | no | class |
| local intermediate tuple | yes | local record |

---

# 36. Latihan

## Latihan 1 — Basic record

Buat:

```java
record CaseId(String value) {}
```

Lihat generated accessor, equals, hashCode, toString.

## Latihan 2 — Validation

Tambahkan compact constructor:

- non-null;
- strip;
- uppercase Locale.ROOT;
- pattern `CASE-[0-9]{6}`.

## Latihan 3 — DateRange

Implement:

```java
record DateRange(LocalDate startInclusive, LocalDate endExclusive)
```

Invariant:

```text
start < end
```

Method:

```java
boolean contains(LocalDate date)
```

## Latihan 4 — Mutable list trap

```java
record Tags(List<String> values) {}
```

Mutate original list after construction. Observe effect. Fix with `List.copyOf`.

## Latihan 5 — HashMap key mutation

Use record with mutable list as key. Insert into HashMap, mutate list, lookup. Explain.

## Latihan 6 — Array trap

Create:

```java
record Digest(byte[] bytes) {}
```

Compare two instances with same bytes. Fix with custom implementation.

## Latihan 7 — Sensitive toString

Create:

```java
record LoginRequest(String username, String password) {}
```

Observe toString. Refactor with `Password` record masked toString.

## Latihan 8 — Sealed result

Model:

```java
sealed interface CloseCaseResult
record Closed(...)
record Rejected(...)
record NotFound(...)
```

Switch exhaustively.

## Latihan 9 — DTO mapping

Create API request record with String fields. Map to domain records with validation.

## Latihan 10 — Local record

Inside method, create local record `GroupKey(TenantId tenantId, CaseStatus status)` for grouping.

## Latihan 11 — BigDecimal equality

Create `record Money(BigDecimal amount, Currency currency)`. Compare `1.0` and `1.00`. Decide fix.

## Latihan 12 — Record pattern

If your Java version supports record patterns, destructure `Point(int x, int y)` in `instanceof`/switch.

---

# 37. Ringkasan

Records adalah fitur Java untuk membuat transparent immutable data carriers dengan boilerplate minimal.

Record cocok untuk:

```text
value object
DTO
command
event
result variant
immutable snapshot
local intermediate tuple
```

Record tidak selalu cocok untuk:

```text
mutable entity
JPA entity
resource object
hidden representation
complex lifecycle
array-heavy value with custom equality
sensitive data without masked toString
```

Hal penting:

- Record is a class, implicitly final.
- Record extends `java.lang.Record`.
- Components generate fields, accessors, constructor, equals, hashCode, toString.
- Compact constructor is ideal for validation/normalization.
- Record immutability is shallow.
- Mutable components need defensive copy.
- Arrays are dangerous components.
- Generated equality uses component equality.
- Generated toString can leak sensitive data.
- Records pair extremely well with sealed interfaces.
- Record components become API/deconstruction contract.
- Serializable records invoke canonical constructor during deserialization.

Senior Java engineer melihat record bukan hanya “class tanpa boilerplate”, tetapi sebagai **semantic declaration**:

```text
This type is transparent data.
Its state is its API.
Its equality is its components.
Its invariants live in its constructor.
```

Jika statement itu benar, record adalah pilihan sangat kuat. Jika tidak benar, gunakan class biasa.

---

# 38. Referensi

1. Java Language Specification SE 25 — Record Classes  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html#jls-8.10

2. Java SE 25 API — `Record`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Record.html

3. JEP 395 — Records  
   https://openjdk.org/jeps/395

4. JEP 440 — Record Patterns  
   https://openjdk.org/jeps/440

5. Java Object Serialization Specification — Serialization of Records  
   https://docs.oracle.com/en/java/javase/25/docs/specs/serialization/serial-arch.html

6. Java SE 25 API — `Class.isRecord` and record reflection APIs  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Class.html

7. Java SE 25 API — `RecordComponent`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/RecordComponent.html

8. Java SE 25 API — `Objects`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Objects.html

9. Java SE 25 API — `Arrays`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html
