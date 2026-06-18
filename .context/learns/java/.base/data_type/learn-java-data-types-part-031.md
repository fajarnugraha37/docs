# learn-java-data-types-part-031.md

# Java Data Types — Part 031  
# Anti-Patterns: Primitive Obsession, Stringly Typed Code, Boolean Blindness, Nullable Chaos, Leaky DTO, dan Type Design Smells

> Seri: **Advanced Java Data Types**  
> Bagian: **031**  
> Fokus: mengenali anti-pattern dalam desain Java data types: primitive obsession, stringly typed code, boolean blindness, nullable chaos, enum abuse, ordinal persistence, BigDecimal misuse, date/time ambiguity, mutable value object, collection exposure, DTO/entity/domain coupling, unsafe serialization, reflection abuse, over-generic design, and type explosion. Tujuan bagian ini adalah membuat kamu bisa “mencium bau” desain type yang akan menjadi bug production.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Anti-Pattern adalah Hutang Semantik](#2-mental-model-anti-pattern-adalah-hutang-semantik)
3. [Anti-Pattern 1 — Primitive Obsession](#3-anti-pattern-1--primitive-obsession)
4. [Anti-Pattern 2 — Stringly Typed Code](#4-anti-pattern-2--stringly-typed-code)
5. [Anti-Pattern 3 — Boolean Blindness](#5-anti-pattern-3--boolean-blindness)
6. [Anti-Pattern 4 — Flag Explosion](#6-anti-pattern-4--flag-explosion)
7. [Anti-Pattern 5 — Nullable Chaos](#7-anti-pattern-5--nullable-chaos)
8. [Anti-Pattern 6 — Optional Abuse](#8-anti-pattern-6--optional-abuse)
9. [Anti-Pattern 7 — Wrapper Without Meaning](#9-anti-pattern-7--wrapper-without-meaning)
10. [Anti-Pattern 8 — Record with Mutable Component](#10-anti-pattern-8--record-with-mutable-component)
11. [Anti-Pattern 9 — Mutable Value Object](#11-anti-pattern-9--mutable-value-object)
12. [Anti-Pattern 10 — Exposed Internal Collection](#12-anti-pattern-10--exposed-internal-collection)
13. [Anti-Pattern 11 — Array as Transparent Value](#13-anti-pattern-11--array-as-transparent-value)
14. [Anti-Pattern 12 — Enum Ordinal Persistence](#14-anti-pattern-12--enum-ordinal-persistence)
15. [Anti-Pattern 13 — Enum as Dynamic Reference Data](#15-anti-pattern-13--enum-as-dynamic-reference-data)
16. [Anti-Pattern 14 — Status + Nullable Fields](#16-anti-pattern-14--status--nullable-fields)
17. [Anti-Pattern 15 — Money as BigDecimal Only](#17-anti-pattern-15--money-as-bigdecimal-only)
18. [Anti-Pattern 16 — Money as Double](#18-anti-pattern-16--money-as-double)
19. [Anti-Pattern 17 — LocalDateTime for Everything](#19-anti-pattern-17--localdatetime-for-everything)
20. [Anti-Pattern 18 — Time Zone by Accident](#20-anti-pattern-18--time-zone-by-accident)
21. [Anti-Pattern 19 — `Map<String,Object>` Domain Model](#21-anti-pattern-19--mapstringobject-domain-model)
22. [Anti-Pattern 20 — Leaky DTO/Entity/Domain Coupling](#22-anti-pattern-20--leaky-dtoentitydomain-coupling)
23. [Anti-Pattern 21 — Direct Entity Serialization](#23-anti-pattern-21--direct-entity-serialization)
24. [Anti-Pattern 22 — `toString` as Serialization](#24-anti-pattern-22--tostring-as-serialization)
25. [Anti-Pattern 23 — Unsafe Deserialization](#25-anti-pattern-23--unsafe-deserialization)
26. [Anti-Pattern 24 — Reflection as Business Dispatch](#26-anti-pattern-24--reflection-as-business-dispatch)
27. [Anti-Pattern 25 — Over-Generic Repository/Service](#27-anti-pattern-25--over-generic-repositoryservice)
28. [Anti-Pattern 26 — Type Explosion](#28-anti-pattern-26--type-explosion)
29. [Anti-Pattern 27 — Validation Only at UI/API](#29-anti-pattern-27--validation-only-at-uiapi)
30. [Anti-Pattern 28 — DB Schema Without Domain Constraints](#30-anti-pattern-28--db-schema-without-domain-constraints)
31. [Anti-Pattern 29 — Public API Mirrors Internal Model](#31-anti-pattern-29--public-api-mirrors-internal-model)
32. [Anti-Pattern 30 — Security Data as Normal String](#32-anti-pattern-30--security-data-as-normal-string)
33. [Anti-Pattern 31 — Error as Plain String](#33-anti-pattern-31--error-as-plain-string)
34. [Anti-Pattern 32 — Collection Type Without Semantics](#34-anti-pattern-32--collection-type-without-semantics)
35. [Anti-Pattern 33 — Ignoring Scale and Boundary Volume](#35-anti-pattern-33--ignoring-scale-and-boundary-volume)
36. [Refactoring Strategy](#36-refactoring-strategy)
37. [Smell Checklist](#37-smell-checklist)
38. [Best Practices](#38-best-practices)
39. [Decision Matrix](#39-decision-matrix)
40. [Latihan](#40-latihan)
41. [Ringkasan](#41-ringkasan)
42. [Referensi](#42-referensi)

---

# 1. Tujuan Bagian Ini

Bagian sebelumnya membahas pattern yang baik.

Sekarang kita bahas kebalikannya: pola yang sering tampak sederhana, cepat, dan “pragmatis”, tetapi diam-diam menumpuk hutang semantik.

Contoh:

```java
void closeCase(String caseId, String officerId, String reason, boolean notify, boolean force) {
    ...
}
```

Ini compile dan bisa langsung jalan.

Tapi desain ini menyimpan banyak risiko:

- `caseId` dan `officerId` bisa tertukar;
- `reason` bisa blank/terlalu panjang/mengandung PII;
- `notify` dan `force` tidak jelas maksudnya di call site;
- kombinasi flag bisa ilegal;
- authorization tidak terlihat;
- version/concurrency tidak terlihat;
- audit semantics tidak terlihat.

Lebih baik:

```java
record CloseCaseCommand(
    TenantScoped<CaseId> caseRef,
    OfficerId actorId,
    ClosureReason reason,
    NotificationPolicy notificationPolicy,
    CloseMode closeMode,
    ExpectedVersion expectedVersion
) {}
```

Anti-pattern bukan berarti “selalu salah”. Kadang raw `String` atau `boolean` cukup untuk local/simple code.

Tetapi untuk domain penting, boundary, security, durability, dan scale, anti-pattern harus dikenali lebih awal.

---

# 2. Mental Model: Anti-Pattern adalah Hutang Semantik

Anti-pattern data type biasanya punya ciri:

```text
Data punya makna domain, tapi type-nya tidak mengekspresikan makna itu.
```

Contoh:

```java
String status;
```

Apa statusnya?

- Case status?
- Payment status?
- API status?
- Human display label?
- Stable code?
- Nullable?
- Dynamic?

Type `String` tidak menjawab.

## 2.1 Semantic debt

Semua makna pindah ke:

- komentar;
- naming convention;
- if/else;
- regex tersebar;
- runtime validation;
- database constraint tidak konsisten;
- tribal knowledge.

## 2.2 Compiler cannot help

Compiler hanya tahu `String`.

## 2.3 Runtime bug

Kesalahan baru ketahuan:

- saat production data invalid;
- saat consumer API break;
- saat enum reordered;
- saat timezone salah;
- saat null masuk;
- saat amount rounding salah;
- saat security token bocor di log.

## 2.4 Anti-pattern smell

Jika kamu sering berkata:

```text
"harus ingat bahwa field ini..."
"jangan lupa sebelum pakai..."
"nilainya cuma boleh..."
"kalau status X, field Y wajib..."
```

Kemungkinan besar ada type yang hilang.

---

# 3. Anti-Pattern 1 — Primitive Obsession

## 3.1 Bentuk

```java
String caseId;
String officerId;
int percentage;
long version;
BigDecimal amount;
String currency;
```

## 3.2 Problem

Primitive/raw type tidak membawa domain meaning.

## 3.3 Failure

```java
assign(officerId, caseId);
```

Compile jika sama-sama String.

## 3.4 Refactor

```java
record CaseId(String value) {}
record OfficerId(String value) {}
record Percentage(BigDecimal value) {}
record Version(long value) {}
record Money(BigDecimal amount, Currency currency) {}
```

## 3.5 When acceptable

Primitive is okay for:

- local loop counter;
- trivial calculation;
- internal low-level hot path;
- simple DTO if immediately mapped.

## 3.6 Rule

If value crosses method boundaries and has domain meaning, consider a type.

---

# 4. Anti-Pattern 2 — Stringly Typed Code

## 4.1 Bentuk

```java
if ("CLOSED".equals(status)) {
    ...
}
```

or:

```java
Map<String, String> attributes;
```

## 4.2 Problem

- typo compile;
- no autocomplete;
- no exhaustiveness;
- hard refactor;
- no central validation;
- magic strings everywhere.

## 4.3 Failure

```java
"CLOESD"
"closed"
"Closed"
```

## 4.4 Refactor

Use enum:

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    CLOSED
}
```

or value object:

```java
record PolicyCode(String value) {}
```

or sealed type:

```java
sealed interface CaseState permits Draft, Submitted, Closed {}
```

## 4.5 Use string at boundary

JSON/DB may use string, but map to domain type early.

## 4.6 Rule

String is transport representation, not domain model for closed concepts.

---

# 5. Anti-Pattern 3 — Boolean Blindness

## 5.1 Bentuk

```java
book(ticket, true);
sendEmail(user, false);
closeCase(caseId, true, false);
```

At call site, boolean meaning unclear.

## 5.2 Problem

Boolean parameter loses meaning.

## 5.3 Refactor

Use enum:

```java
enum NotificationPolicy {
    SEND_NOTIFICATION,
    SILENT
}
```

```java
closeCase(caseId, NotificationPolicy.SEND_NOTIFICATION);
```

## 5.4 Better command

```java
record CloseCaseCommand(
    CaseId caseId,
    NotificationPolicy notificationPolicy
) {}
```

## 5.5 When boolean okay

- obvious property name in object: `isActive`;
- local condition;
- simple setter if domain truly binary.

## 5.6 Rule

Avoid boolean parameters when caller cannot read intent from call site.

---

# 6. Anti-Pattern 4 — Flag Explosion

## 6.1 Bentuk

```java
record CaseData(
    boolean submitted,
    boolean approved,
    boolean rejected,
    boolean closed,
    boolean archived
) {}
```

## 6.2 Problem

Many impossible combinations.

```text
approved=true and rejected=true
closed=true and submitted=false
archived=true and closed=false
```

## 6.3 Refactor enum

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED,
    CLOSED,
    ARCHIVED
}
```

## 6.4 Refactor sealed state

If each state has data:

```java
sealed interface CaseState permits Draft, Submitted, Approved, Rejected, Closed {}

record Rejected(Instant rejectedAt, RejectionReason reason) implements CaseState {}
```

## 6.5 Rule

Multiple booleans describing one lifecycle usually want enum/sealed state.

---

# 7. Anti-Pattern 5 — Nullable Chaos

## 7.1 Bentuk

```java
String reason;      // null?
Instant closedAt;   // null?
Boolean approved;   // null?
```

## 7.2 Problem

Null meaning not explicit.

```text
unknown?
not applicable?
not loaded?
not authorized?
not provided?
cleared?
```

## 7.3 Failure

- NPE;
- wrong default;
- API null/missing confusion;
- DB NULL ambiguity.

## 7.4 Refactor

- required field: non-null constructor;
- optional return: Optional;
- variant state: sealed type;
- PATCH: explicit patch field;
- DB: NOT NULL where possible.

## 7.5 Example

Bad:

```java
record CaseData(String status, Instant closedAt, String reason) {}
```

Good:

```java
sealed interface CaseState permits Open, Closed {}

record Open() implements CaseState {}
record Closed(Instant closedAt, ClosureReason reason) implements CaseState {}
```

## 7.6 Rule

Null should be a deliberate boundary representation, not default domain language.

---

# 8. Anti-Pattern 6 — Optional Abuse

## 8.1 Bentuk

```java
record User(Optional<String> email) {}
void update(Optional<String> name) {}
List<Optional<Item>> items;
```

## 8.2 Problem

Optional is primarily useful as return type for absence.

As field/parameter, it can create:

- serialization weirdness;
- ORM issues;
- nested absence ambiguity;
- awkward API;
- memory overhead.

## 8.3 Better field

```java
private EmailAddress secondaryEmail; // nullable persistence field
Optional<EmailAddress> secondaryEmail() { ... }
```

## 8.4 Better parameter

Use overloads or command types.

```java
record UpdateProfileCommand(PatchField<DisplayName> displayName) {}
```

## 8.5 Better collection

Filter absent values before collection or model explicitly.

## 8.6 Rule

Use Optional mainly for return values, not as universal absence wrapper.

---

# 9. Anti-Pattern 7 — Wrapper Without Meaning

## 9.1 Bentuk

```java
record Text(String value) {}
record NumberValue(int value) {}
record Wrapper<T>(T value) {}
```

No invariant, no operation, no semantic name.

## 9.2 Problem

Type adds ceremony but no clarity.

## 9.3 Good wrapper

```java
record ClosureReason(String value) {
    ClosureReason {
        if (value == null || value.isBlank()) throw ...
        if (value.length() > 2000) throw ...
    }
}
```

## 9.4 Ask

- What invalid state does it prevent?
- What operation belongs here?
- What boundary meaning does it encode?
- What confusion does it avoid?

## 9.5 Rule

A wrapper should pay rent: meaning, invariant, behavior, or boundary safety.

---

# 10. Anti-Pattern 8 — Record with Mutable Component

## 10.1 Bentuk

```java
record Tags(List<String> values) {}
```

## 10.2 Problem

Record is shallowly immutable.

```java
List<String> raw = new ArrayList<>();
Tags tags = new Tags(raw);
raw.add("urgent");
```

`tags` changed observationally.

## 10.3 Refactor

```java
record Tags(List<String> values) {
    Tags {
        values = List.copyOf(values);
    }
}
```

## 10.4 Mutable elements

If elements mutable, `List.copyOf` not enough.

## 10.5 Arrays worse

```java
record Digest(byte[] bytes) {}
```

requires clone and custom equals/hashCode.

## 10.6 Rule

Records with collections/arrays require defensive copy policy.

---

# 11. Anti-Pattern 9 — Mutable Value Object

## 11.1 Bentuk

```java
class Money {
    BigDecimal amount;
    Currency currency;

    void setAmount(BigDecimal amount) { this.amount = amount; }
}
```

## 11.2 Problem

Value object equality/hash can change.

Danger in map keys/cache.

## 11.3 Failure

```java
Map<Money, String> map = new HashMap<>();
map.put(money, "x");
money.setAmount(...);
map.get(money); // broken
```

## 11.4 Refactor

```java
record Money(BigDecimal amount, Currency currency) {}
```

with operations returning new Money.

## 11.5 Mutable entity is different

Entities can mutate because identity stable and mutation controlled.

## 11.6 Rule

Value objects should be immutable.

---

# 12. Anti-Pattern 10 — Exposed Internal Collection

## 12.1 Bentuk

```java
class Order {
    private final List<OrderLine> lines = new ArrayList<>();

    List<OrderLine> lines() {
        return lines;
    }
}
```

## 12.2 Problem

Caller mutates internal state.

## 12.3 Failure

```java
order.lines().clear();
```

## 12.4 Refactor snapshot

```java
List<OrderLine> lines() {
    return List.copyOf(lines);
}
```

or if internal already immutable:

```java
this.lines = List.copyOf(lines);
return lines;
```

## 12.5 Domain methods

```java
order.addLine(product, quantity);
order.removeLine(lineId);
```

## 12.6 Rule

Do not expose mutable internals.

---

# 13. Anti-Pattern 11 — Array as Transparent Value

## 13.1 Bentuk

```java
record Hash(byte[] bytes) {}
```

## 13.2 Problems

- array mutable;
- record accessor exposes array;
- array equals is identity;
- hashCode wrong;
- toString useless.

## 13.3 Refactor class

```java
final class HashValue {
    private final byte[] bytes;

    HashValue(byte[] bytes) {
        this.bytes = bytes.clone();
    }

    byte[] bytes() {
        return bytes.clone();
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof HashValue other && Arrays.equals(bytes, other.bytes);
    }

    @Override
    public int hashCode() {
        return Arrays.hashCode(bytes);
    }
}
```

## 13.4 Security

For secret bytes, also consider clearing/ownership.

## 13.5 Rule

Arrays need special handling in value types.

---

# 14. Anti-Pattern 12 — Enum Ordinal Persistence

## 14.1 Bentuk

```java
@Enumerated(EnumType.ORDINAL)
CaseStatus status;
```

DB:

```text
0,1,2
```

## 14.2 Problem

Reordering enum constants changes meaning.

## 14.3 Failure

Old DB value `1` used to mean SUBMITTED, after reorder means CLOSED.

## 14.4 Refactor

Use stable code:

```java
enum CaseStatus {
    DRAFT("D"),
    SUBMITTED("S"),
    CLOSED("C")
}
```

DB stores code.

## 14.5 Rule

Never persist enum ordinal for durable/shared data.

---

# 15. Anti-Pattern 13 — Enum as Dynamic Reference Data

## 15.1 Bentuk

```java
enum ProductCategory {
    FOOD,
    ELECTRONICS,
    BABY
}
```

But business wants admins to add categories.

## 15.2 Problem

Enum requires deployment for new value.

## 15.3 Refactor

Use reference table/entity:

```java
record ProductCategoryCode(String value) {}
```

DB:

```sql
product_category_ref(code, display_name, active)
```

## 15.4 When enum good

- stable closed technical/domain set;
- code controls behavior;
- finite and rarely changes.

## 15.5 Rule

If business data changes without deployment, it is not enum.

---

# 16. Anti-Pattern 14 — Status + Nullable Fields

## 16.1 Bentuk

```java
record Application(
    ApplicationStatus status,
    Instant submittedAt,
    Instant approvedAt,
    OfficerId approvedBy,
    RejectionReason rejectionReason
) {}
```

## 16.2 Problem

Fields valid only for some statuses.

## 16.3 Invalid states

```text
APPROVED with rejectionReason
REJECTED without rejectionReason
DRAFT with submittedAt
```

## 16.4 Refactor

```java
sealed interface ApplicationState permits Draft, Submitted, Approved, Rejected {}

record Draft() implements ApplicationState {}
record Submitted(Instant submittedAt) implements ApplicationState {}
record Approved(Instant approvedAt, OfficerId approvedBy) implements ApplicationState {}
record Rejected(Instant rejectedAt, OfficerId rejectedBy, RejectionReason reason) implements ApplicationState {}
```

## 16.5 DB/API mapping

Use discriminator + variant payload or controlled columns/constraints.

## 16.6 Rule

If field validity depends on status, status should likely be type.

---

# 17. Anti-Pattern 15 — Money as BigDecimal Only

## 17.1 Bentuk

```java
BigDecimal amount;
```

## 17.2 Problem

Amount without currency/scale/rounding policy is not Money.

## 17.3 Failure

```java
SGD 10 + USD 10 = 20
```

## 17.4 Refactor

```java
record Money(BigDecimal amount, Currency currency) {}
```

or:

```java
record MoneyMinor(long minorUnits, Currency currency) {}
```

## 17.5 Rule

Money requires amount + currency + rounding/scale policy.

---

# 18. Anti-Pattern 16 — Money as Double

## 18.1 Bentuk

```java
double price = 10.10;
```

## 18.2 Problem

Binary floating point cannot represent many decimals exactly.

## 18.3 Failure

Rounding errors accumulate.

## 18.4 Refactor

Use:

```java
BigDecimal
long minorUnits
Money
```

## 18.5 When double okay

Approximate measurements/scores, not money/legal exact values.

## 18.6 Rule

Never use `double`/`float` for money.

---

# 19. Anti-Pattern 17 — LocalDateTime for Everything

## 19.1 Bentuk

```java
LocalDateTime createdAt;
LocalDateTime expiresAt;
LocalDateTime occurredAt;
```

## 19.2 Problem

LocalDateTime has no zone/offset. It is not a global instant.

## 19.3 Failure

- token expiry wrong;
- audit sorting wrong across zones;
- distributed systems inconsistent.

## 19.4 Refactor

Use:

```java
Instant createdAt;
Instant expiresAt;
Instant occurredAt;
```

Use `LocalDateTime + ZoneId` for scheduled local human time.

## 19.5 Rule

Use Instant for machine timeline. Use LocalDate/LocalDateTime only when intentionally local.

---

# 20. Anti-Pattern 18 — Time Zone by Accident

## 20.1 Bentuk

```java
LocalDateTime.now()
new Date()
system default zone implicit
```

## 20.2 Problem

Depends on server/container timezone.

## 20.3 Refactor

Inject Clock:

```java
Instant now = clock.instant();
```

For display:

```java
now.atZone(userZone)
```

## 20.4 Store ZoneId if needed

For appointments:

```java
record AppointmentTime(LocalDateTime localDateTime, ZoneId zoneId) {}
```

## 20.5 Rule

Time zone should be explicit in type/design, not environment accident.

---

# 21. Anti-Pattern 19 — `Map<String,Object>` Domain Model

## 21.1 Bentuk

```java
Map<String, Object> caseData;
```

## 21.2 Problem

- no compile-time safety;
- casts everywhere;
- runtime ClassCastException;
- no schema;
- no refactor support;
- hidden invalid states.

## 21.3 Refactor

Use typed DTO/domain object:

```java
record CaseProfile(CaseId id, CaseStatus status, DisplayName applicantName) {}
```

## 21.4 Boundary exception

`Map<String,Object>` can be okay at generic JSON boundary, but should be converted quickly.

## 21.5 Rule

Map is not domain model unless domain truly is dynamic key-value store.

---

# 22. Anti-Pattern 20 — Leaky DTO/Entity/Domain Coupling

## 22.1 Bentuk

Same class used for:

- API request/response;
- JPA entity;
- domain aggregate;
- Kafka event.

## 22.2 Problem

One model has incompatible needs:

- API wants stability;
- JPA wants mutability/proxy;
- domain wants invariants;
- event wants versioned contract.

## 22.3 Failure

Adding DB field leaks to API/event.

## 22.4 Refactor

Separate:

```java
CaseEntity
CaseAggregate
CaseResponseDto
CaseClosedEventDto
```

Map explicitly.

## 22.5 When same type okay

Small internal/private apps may share, but be aware.

## 22.6 Rule

Shared model across boundaries is a coupling decision, not default.

---

# 23. Anti-Pattern 21 — Direct Entity Serialization

## 23.1 Bentuk

```java
@GetMapping("/cases/{id}")
public CaseEntity get(...) {
    return repository.find(...);
}
```

## 23.2 Problem

- lazy loading;
- N+1;
- internal fields leak;
- circular references;
- security fields exposed;
- API changes with DB model.

## 23.3 Refactor

Return DTO/projection:

```java
record CaseResponse(String caseId, String status, String updatedAt) {}
```

## 23.4 Rule

Never expose ORM entity directly as public API response.

---

# 24. Anti-Pattern 22 — `toString` as Serialization

## 24.1 Bentuk

```java
String encoded = object.toString();
```

and later parse it.

## 24.2 Problem

`toString` is for debugging unless explicitly specified.

Record toString changes if components change.

## 24.3 Failure

Refactor component name/order breaks parser.

## 24.4 Refactor

Use explicit serializer:

```java
toJson()
toDatabaseValue()
toExternalCode()
```

or mapper.

## 24.5 Rule

`toString` is not stable wire format.

---

# 25. Anti-Pattern 23 — Unsafe Deserialization

## 25.1 Bentuk

```java
ObjectInputStream in = new ObjectInputStream(bytes);
Object obj = in.readObject();
```

from untrusted input.

## 25.2 Problem

Java native deserialization can trigger gadget chains/resource attacks.

## 25.3 Refactor

Use explicit DTO schema, JSON/Protobuf/Avro, validation.

If forced, use `ObjectInputFilter` and allowlist.

## 25.4 Rule

Do not deserialize untrusted Java object streams.

---

# 26. Anti-Pattern 24 — Reflection as Business Dispatch

## 26.1 Bentuk

```java
Method method = service.getClass().getMethod(request.action());
method.invoke(service);
```

## 26.2 Problem

- no compile-time safety;
- security risk;
- hidden allowed actions;
- brittle refactor;
- runtime errors.

## 26.3 Refactor

Use enum/sealed command:

```java
sealed interface Action permits CloseCase, AssignCase {}
```

or handler registry.

## 26.4 Rule

Business actions should be typed, not method names from strings.

---

# 27. Anti-Pattern 25 — Over-Generic Repository/Service

## 27.1 Bentuk

```java
interface GenericService<T, ID> {
    T create(T value);
    T update(ID id, T value);
    void delete(ID id);
}
```

Used for all domains.

## 27.2 Problem

Domain rules disappear.

`delete` may not be valid for all entities.

`update` bypasses behavior.

## 27.3 Refactor

Domain-specific service:

```java
interface CaseService {
    CaseClosed close(CloseCaseCommand command);
    CaseAssigned assign(AssignCaseCommand command);
}
```

## 27.4 Generic infrastructure okay

Generic repository internals can exist, but domain API should be specific.

## 27.5 Rule

Generic CRUD is not a domain model.

---

# 28. Anti-Pattern 26 — Type Explosion

## 28.1 Bentuk

Creating wrapper type for every trivial field:

```java
record FirstName(String value) {}
record MiddleInitial(String value) {}
record ButtonLabel(String value) {}
record LoopCount(int value) {}
```

even when no invariant/boundary/meaning.

## 28.2 Problem

- noise;
- mapping overhead;
- team resistance;
- slower delivery;
- overengineering.

## 28.3 Refactor

Keep types where they add value.

## 28.4 Heuristic

Create type when it:

- prevents mix-up;
- enforces invariant;
- carries behavior;
- crosses boundary;
- has security meaning;
- appears in many places.

## 28.5 Rule

Type modeling is not type hoarding.

---

# 29. Anti-Pattern 27 — Validation Only at UI/API

## 29.1 Bentuk

Controller validates, domain accepts raw invalid state.

## 29.2 Problem

Other paths bypass validation:

- batch job;
- Kafka consumer;
- admin script;
- test utility;
- direct service call.

## 29.3 Refactor

Domain types enforce invariants.

DB constraints enforce durable invariants.

## 29.4 Rule

Boundary validation gives good UX. Domain invariant gives correctness.

---

# 30. Anti-Pattern 28 — DB Schema Without Domain Constraints

## 30.1 Bentuk

```sql
amount DECIMAL
currency VARCHAR
status VARCHAR
closed_at TIMESTAMP NULL
```

No NOT NULL, CHECK, length, precision.

## 30.2 Problem

Database can store invalid domain states.

## 30.3 Refactor

```sql
amount DECIMAL(19,2) NOT NULL
currency_code CHAR(3) NOT NULL
status_code VARCHAR(16) NOT NULL
CHECK (amount >= 0)
```

## 30.4 Rule

Critical domain constraints belong in DB too.

---

# 31. Anti-Pattern 29 — Public API Mirrors Internal Model

## 31.1 Bentuk

API response generated from entity fields.

## 31.2 Problem

Internal refactor becomes breaking API change.

## 31.3 Refactor

Design stable API DTO/schema.

## 31.4 Rule

Public API is contract, not object dump.

---

# 32. Anti-Pattern 30 — Security Data as Normal String

## 32.1 Bentuk

```java
String token;
String password;
String apiKey;
String redirectUrl;
String filePath;
```

## 32.2 Problem

- logging leaks;
- no safe toString;
- no validation/allowlist;
- path traversal;
- SSRF;
- mass assignment.

## 32.3 Refactor

```java
AccessToken
PasswordInput
ApiKeySecret
AllowedRedirectUri
SafeFileName
```

## 32.4 Rule

Security-sensitive values deserve security-sensitive types.

---

# 33. Anti-Pattern 31 — Error as Plain String

## 33.1 Bentuk

```java
return "case not found";
```

## 33.2 Problem

- caller parses text;
- localization breaks logic;
- no structured metadata;
- no exhaustiveness.

## 33.3 Refactor

```java
sealed interface CloseCaseError permits CaseNotFound, Unauthorized, AlreadyClosed {}
```

## 33.4 API mapping

Map error type to Problem Details.

## 33.5 Rule

If program reacts to error, model it as type/code, not prose.

---

# 34. Anti-Pattern 32 — Collection Type Without Semantics

## 34.1 Bentuk

```java
List<String> roles;
List<CaseId> caseIds;
Map<String, Object> metadata;
```

## 34.2 Problem

Does order matter? Can be empty? Unique? Max size? Null elements? Mutable?

## 34.3 Refactor

```java
record NonEmptyCaseIds(List<CaseId> values) {}
record PermissionSet(EnumSet<Permission> values) {}
record Metadata(Map<MetadataKey, MetadataValue> values) {}
```

## 34.4 Rule

Collections have semantics; encode important ones.

---

# 35. Anti-Pattern 33 — Ignoring Scale and Boundary Volume

## 35.1 Bentuk

Using elegant domain wrapper for millions of hot path items without measurement.

```java
List<Version>
List<Money>
List<CaseId>
```

in large in-memory index.

## 35.2 Problem

Object overhead, GC, cache misses.

## 35.3 Refactor

Use hybrid:

- domain types at boundary;
- primitive/compact representation internally;
- mapper at edge.

```java
long[] versions;
long[] caseIdNumericParts;
```

## 35.4 Rule

Domain clarity first, but high-scale storage/hot loops need representation-aware design.

---

# 36. Refactoring Strategy

## 36.1 Do not rewrite everything

Pick highest-risk/highest-change areas.

## 36.2 Start with IDs

Typed IDs are high ROI.

## 36.3 Then money/time/security

These cause serious bugs.

## 36.4 Then state modeling

Replace status + nullable fields.

## 36.5 Then boundary DTOs

Separate API/entity/domain/event.

## 36.6 Add tests

For each refactor:

- valid input;
- invalid input;
- serialization;
- DB mapping;
- API compatibility.

## 36.7 Use strangler approach

Add typed overloads, deprecate raw ones, migrate call sites.

## 36.8 Measure

For performance-sensitive refactors, benchmark/profile.

---

# 37. Smell Checklist

Look for:

```java
String id
String status
String type
String role
String reason
String token
String filePath
String redirectUrl
BigDecimal amount
String currency
double price
LocalDateTime createdAt
Boolean approved
Map<String,Object>
List<String> flags
Object payload
```

Ask:

```text
What does it mean?
What values are valid?
Can it be null?
Can it be blank?
Does order matter?
Can it be empty?
Can it leak?
Can it be persisted?
Can it cross tenant?
Can it be serialized?
Can it be changed without breaking clients?
```

If answers live only in comments or memory, create type/schema/constraint.

---

# 38. Best Practices

## 38.1 General

- Avoid primitive obsession in domain boundaries.
- Avoid stringly typed closed sets.
- Avoid boolean parameters with unclear meaning.
- Avoid status + nullable fields for stateful variants.
- Avoid mutable value objects.
- Avoid exposing mutable internals.
- Avoid enum ordinals in persistence/wire.
- Avoid LocalDateTime for machine timestamps.
- Avoid direct entity serialization.
- Avoid Java native deserialization for untrusted data.
- Avoid reflection as business dispatch.
- Avoid Map<String,Object> as domain model.
- Avoid over-generic CRUD APIs for rich domains.
- Avoid type explosion without invariant/meaning.
- Keep raw data at boundaries.
- Use domain types, DTOs, schema constraints, DB constraints deliberately.

## 38.2 Refactoring principle

Refactor from risky raw type to meaningful type one concept at a time.

## 38.3 Team principle

A type should make code easier to understand, not just more abstract.

---

# 39. Decision Matrix

| Smell | Better design |
|---|---|
| `String caseId` | `CaseId` |
| `String status` | enum or sealed state |
| boolean parameter | enum/policy/command |
| multiple lifecycle booleans | enum/sealed state |
| nullable state fields | variant-specific sealed types |
| `BigDecimal amount` | `Money(amount,currency)` |
| `double price` | `Money`/`BigDecimal`/minor units |
| `LocalDateTime createdAt` | `Instant` |
| user file path string | `SafeFileName`/server-side path |
| redirect URL string | `AllowedRedirectUri` |
| token string | `AccessToken` masked |
| enum ordinal DB | stable code converter |
| Map domain object | typed DTO/domain object |
| entity as response | response DTO/projection |
| error string | error type/code |
| raw collection | constrained collection type |
| reflection action dispatch | sealed command/handler registry |
| generic CRUD service | domain-specific use case service |
| huge object wrapper list | compact internal representation |

---

# 40. Latihan

## Latihan 1 — Primitive Obsession Scan

Cari method dengan 3+ `String` parameter. Refactor minimal dua menjadi typed value object.

## Latihan 2 — Boolean Parameter

Refactor:

```java
sendNotification(user, true)
```

menjadi enum/policy.

## Latihan 3 — Status Nullable Fields

Ambil model status + nullable fields dan ubah menjadi sealed state.

## Latihan 4 — Money

Refactor `BigDecimal amount, String currency` menjadi `Money`.

## Latihan 5 — Time

Refactor `LocalDateTime createdAt/expiresAt` menjadi `Instant`.

## Latihan 6 — Entity Serialization

Buat DTO response terpisah dari entity.

## Latihan 7 — Enum Ordinal

Buat migration plan dari ordinal ke stable code.

## Latihan 8 — Map Domain

Refactor `Map<String,Object>` payload menjadi typed record.

## Latihan 9 — Security String

Ubah `String token` menjadi `AccessToken` dengan masked toString.

## Latihan 10 — Error String

Ubah string error menjadi sealed error type.

## Latihan 11 — Collection Semantics

Ubah `List<CaseId>` menjadi `NonEmptyCaseIds`.

## Latihan 12 — Reflection Dispatch

Ubah method-name dispatch menjadi sealed command + handler.

---

# 41. Ringkasan

Anti-pattern data type biasanya muncul ketika makna domain tidak diwakili oleh type.

Tanda-tanda utama:

- raw String untuk ID/status/type/token/path;
- boolean parameter tidak jelas;
- banyak flag;
- nullable field tanpa semantik;
- Optional di mana-mana;
- wrapper tanpa invariant;
- mutable value object;
- record dengan mutable component;
- enum ordinal persisted;
- BigDecimal tanpa currency;
- LocalDateTime untuk semua waktu;
- entity/API/domain/event satu class;
- Map<String,Object> sebagai domain;
- reflection untuk business dispatch;
- generic CRUD menghapus perilaku domain;
- validation hanya di boundary;
- DB tanpa constraints;
- public API mirror internal object.

Prinsip perbaikannya:

```text
Make meaning explicit.
Make invalid states difficult.
Keep raw data at the edge.
Use DTO/domain/event/entity separately when boundaries differ.
Use constraints where data lives.
Do not let convenience become contract.
```

Senior Java engineer tidak hanya bisa membuat type yang baik, tetapi juga cepat mengenali type smell sebelum menjadi incident.

---

# 42. Referensi

1. Java SE 25 API — `Record`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Record.html

2. Java SE 25 API — `Optional`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html

3. Java SE 25 API — `BigDecimal`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigDecimal.html

4. Java SE 25 API — `LocalDateTime`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/LocalDateTime.html

5. Java SE 25 API — `Instant`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/Instant.html

6. JEP 409 — Sealed Classes  
   https://openjdk.org/jeps/409

7. JEP 395 — Records  
   https://openjdk.org/jeps/395

8. OWASP Deserialization Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html

9. RFC 9457 — Problem Details for HTTP APIs  
   https://www.rfc-editor.org/rfc/rfc9457.html

10. Java Language Specification SE 25  
    https://docs.oracle.com/javase/specs/jls/se25/html/index.html

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-data-types-part-030.md">⬅️ Java Data Types — Part 030</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-data-types-part-032.md">Java Data Types — Part 032 ➡️</a>
</div>
