# learn-java-data-types-part-033.md

# Java Data Types — Part 033  
# Java Data Types Design Review Checklist: Code Review, API Review, DB Review, Security Review, dan Production Readiness

> Seri: **Advanced Java Data Types**  
> Bagian: **033**  
> Fokus: checklist praktis untuk mereview desain data type di Java sebelum masuk production. Checklist ini menggabungkan semua part sebelumnya: primitive/reference, records, enum, sealed, generics, collections, Optional, date/time, immutability, JMM, memory/performance, serialization, DB/API mapping, validation, security, reflection, anti-pattern, dan production failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Cara Menggunakan Checklist Ini](#2-cara-menggunakan-checklist-ini)
3. [Checklist 0 — One-Minute Smell Scan](#3-checklist-0--one-minute-smell-scan)
4. [Checklist 1 — Domain Meaning](#4-checklist-1--domain-meaning)
5. [Checklist 2 — Primitive Obsession](#5-checklist-2--primitive-obsession)
6. [Checklist 3 — String Types](#6-checklist-3--string-types)
7. [Checklist 4 — Numeric Types](#7-checklist-4--numeric-types)
8. [Checklist 5 — Money and Decimal](#8-checklist-5--money-and-decimal)
9. [Checklist 6 — Boolean, Flag, and State](#9-checklist-6--boolean-flag-and-state)
10. [Checklist 7 — Enum](#10-checklist-7--enum)
11. [Checklist 8 — Records and Value Objects](#11-checklist-8--records-and-value-objects)
12. [Checklist 9 — Sealed Types and Polymorphism](#12-checklist-9--sealed-types-and-polymorphism)
13. [Checklist 10 — Generics](#13-checklist-10--generics)
14. [Checklist 11 — Collections](#14-checklist-11--collections)
15. [Checklist 12 — Optional and Absence](#15-checklist-12--optional-and-absence)
16. [Checklist 13 — Date and Time](#16-checklist-13--date-and-time)
17. [Checklist 14 — Mutability and Ownership](#17-checklist-14--mutability-and-ownership)
18. [Checklist 15 — Equality, Hashing, Ordering](#18-checklist-15--equality-hashing-ordering)
19. [Checklist 16 — Concurrency and Java Memory Model](#19-checklist-16--concurrency-and-java-memory-model)
20. [Checklist 17 — Serialization Boundary](#20-checklist-17--serialization-boundary)
21. [Checklist 18 — API Contract](#21-checklist-18--api-contract)
22. [Checklist 19 — Database Mapping](#22-checklist-19--database-mapping)
23. [Checklist 20 — Validation and Constraints](#23-checklist-20--validation-and-constraints)
24. [Checklist 21 — Security](#24-checklist-21--security)
25. [Checklist 22 — Performance and Memory](#25-checklist-22--performance-and-memory)
26. [Checklist 23 — Reflection and Runtime Metadata](#26-checklist-23--reflection-and-runtime-metadata)
27. [Checklist 24 — Error Modeling](#27-checklist-24--error-modeling)
28. [Checklist 25 — Event and Command Data Types](#28-checklist-25--event-and-command-data-types)
29. [Checklist 26 — Cache Data Types](#29-checklist-26--cache-data-types)
30. [Checklist 27 — Logging and Observability](#30-checklist-27--logging-and-observability)
31. [Checklist 28 — Migration and Compatibility](#31-checklist-28--migration-and-compatibility)
32. [Checklist 29 — Testing Strategy](#32-checklist-29--testing-strategy)
33. [Checklist 30 — Code Review Questions](#33-checklist-30--code-review-questions)
34. [Checklist 31 — Architecture Review Questions](#34-checklist-31--architecture-review-questions)
35. [Checklist 32 — Red Flags](#35-checklist-32--red-flags)
36. [Checklist 33 — Green Flags](#36-checklist-33--green-flags)
37. [Example Review: Bad to Good](#37-example-review-bad-to-good)
38. [Minimal Review Template](#38-minimal-review-template)
39. [Production Readiness Gate](#39-production-readiness-gate)
40. [Ringkasan](#40-ringkasan)

---

# 1. Tujuan Bagian Ini

Bagian ini bukan materi konseptual panjang, tetapi **review checklist**.

Tujuannya adalah membuat kamu bisa membuka Pull Request, desain API, schema DB, event contract, atau domain model dan bertanya:

```text
Apakah data type ini benar?
Apakah meaning-nya jelas?
Apakah invalid state bisa muncul?
Apakah aman untuk serialization?
Apakah aman untuk DB/API/event/cache?
Apakah aman untuk concurrency?
Apakah aman untuk security?
Apakah scalable?
Apakah compatible untuk perubahan berikutnya?
```

Checklist ini dapat dipakai untuk:

- code review;
- design review;
- API review;
- database schema review;
- event contract review;
- security review;
- performance review;
- refactoring plan;
- production readiness review;
- LLM code agent review standard.

---

# 2. Cara Menggunakan Checklist Ini

Jangan gunakan semua checklist untuk setiap perubahan kecil.

Gunakan level review.

## 2.1 Level 1 — Small PR

Untuk perubahan kecil:

- One-minute smell scan;
- domain meaning;
- nullability;
- mutability;
- tests.

## 2.2 Level 2 — Feature PR

Untuk feature baru:

- domain type;
- validation;
- API/DB mapping;
- security;
- error model;
- tests.

## 2.3 Level 3 — Boundary Contract

Untuk public API/event/DB schema/cache:

- serialization;
- compatibility;
- versioning;
- null/missing/default;
- schema constraints;
- generated client/consumer tests.

## 2.4 Level 4 — High-Risk Production Design

Untuk auth, money, multi-tenant, batch, concurrency, cache:

- security;
- concurrency;
- performance/memory;
- migration;
- failure modes;
- observability.

## 2.5 Review style

Do not ask all questions mechanically. Ask the questions that apply.

But for high-risk types, be strict.

---

# 3. Checklist 0 — One-Minute Smell Scan

Cari ini dulu:

```java
String id
String status
String type
String role
String token
String password
String filePath
String redirectUrl
String currency
String amount
BigDecimal amount
double price
LocalDateTime createdAt
Boolean approved
Map<String, Object>
List<String> permissions
Object payload
byte[] hash
record Something(List<T> values)
record Something(byte[] bytes)
```

Jika ditemukan, tanya:

```text
Apakah ini raw boundary data atau domain data?
Apakah perlu domain-specific type?
Apakah valid values jelas?
Apakah null semantics jelas?
Apakah serialization/DB/API contract jelas?
Apakah security-sensitive?
Apakah scale-sensitive?
```

## Quick decision

| Smell | Ask |
|---|---|
| `String id` | ID apa? Bisa tertukar? Format? Tenant-scoped? |
| `String status` | Closed set? Dynamic? Enum/sealed? |
| `boolean flag` | Meaning jelas di call site? |
| `Boolean` | Null artinya apa? |
| `BigDecimal amount` | Currency? Scale? Rounding? |
| `double money` | Kenapa bukan Money/BigDecimal/minor unit? |
| `LocalDateTime` | Local human time atau instant? |
| `Map<String,Object>` | Boundary only atau domain? |
| `byte[]` in record | Equality/defensive copy? |
| `List` in record | Defensive copy? Element immutability? |

---

# 4. Checklist 1 — Domain Meaning

Tanya:

- Apa nama konsep domain ini?
- Apakah Java type-nya mengekspresikan konsep tersebut?
- Apakah field/method signature self-documenting?
- Apakah value bisa tertukar dengan value lain yang representation-nya sama?
- Apakah ada invariant intrinsic?
- Apakah ada operation yang seharusnya hidup di type tersebut?
- Apakah type ini muncul di banyak tempat?
- Apakah type ini crossing boundary?
- Apakah type ini security/compliance/money/time-sensitive?

## 4.1 Good sign

```java
CaseId
OfficerId
Money
BusinessDate
ClosureReason
ExpectedVersion
TenantScoped<CaseId>
```

## 4.2 Bad sign

```java
String id
String code
String reason
BigDecimal amount
Long version
```

without context.

## 4.3 Review action

Jika concept penting, buat:

- record value object;
- enum;
- sealed state;
- typed ID;
- command/event type;
- constrained collection.

---

# 5. Checklist 2 — Primitive Obsession

Tanya:

- Apakah ada method dengan banyak primitive/String parameter?
- Apakah dua parameter bertipe sama tetapi meaning berbeda?
- Apakah numeric primitive menyimpan domain value?
- Apakah `long` dipakai untuk ID, version, amount, timestamp tanpa wrapper?
- Apakah `String` dipakai untuk ID/status/code?
- Apakah `BigDecimal` dipakai tanpa domain type?

## 5.1 Red flag

```java
void approve(String caseId, String officerId, String reason, long version)
```

## 5.2 Better

```java
record ApproveCaseCommand(
    CaseId caseId,
    OfficerId officerId,
    ApprovalReason reason,
    ExpectedVersion expectedVersion
) {}
```

## 5.3 Exception

Primitive acceptable for:

- local loop;
- simple math internal;
- low-level optimized storage;
- private method where meaning obvious and scope tiny.

## 5.4 Review action

Upgrade boundary/domain parameters to meaningful types.

---

# 6. Checklist 3 — String Types

Tanya:

- Apakah string ini machine code atau human text?
- Apakah boleh blank?
- Apakah length dibatasi?
- Apakah Unicode/normalization/case sensitivity penting?
- Apakah harus canonicalized?
- Apakah pattern jelas?
- Apakah locale matters?
- Apakah string ini secret/PII?
- Apakah dipakai sebagai DB key/cache key/API field?
- Apakah `toString` accidentally used as serialization?

## 6.1 Machine string

Examples:

```java
CaseId
CurrencyCode
CountryCode
PolicyCode
```

Need:

- pattern;
- uppercase/lowercase policy;
- length;
- stable semantics.

## 6.2 Human string

Examples:

```java
DisplayName
ClosureReason
Comment
```

Need:

- min/max length;
- blank policy;
- PII/logging policy;
- Unicode policy.

## 6.3 Secret string

Examples:

```java
AccessToken
ApiKeySecret
PasswordInput
```

Need:

- safe toString;
- no logging;
- minimized lifetime.

## 6.4 Review action

Replace generic String with domain string type when important.

---

# 7. Checklist 4 — Numeric Types

Tanya:

- Apakah numeric value exact atau approximate?
- Range-nya apa?
- Bisa overflow?
- Perlu unsigned semantics?
- Perlu unit?
- Perlu scale?
- Dipakai untuk allocation/limit/offset?
- Dipakai untuk ID/version?
- Dipakai di JSON/public API?
- Dipakai di DB with correct type?

## 7.1 Red flags

```java
int pageSize // no max
int total = price * quantity
long timeout // unit unclear
double amount
```

## 7.2 Better

```java
PageSize
Quantity
Duration
Money
Version
Percentage
```

## 7.3 Exact arithmetic

For overflow-sensitive operations:

```java
Math.addExact
Math.multiplyExact
```

## 7.4 Review action

Add:

- bounds;
- unit in type/field name;
- exact methods;
- domain wrapper;
- DB/API numeric constraints.

---

# 8. Checklist 5 — Money and Decimal

Tanya:

- Is it money or just decimal?
- Is currency included?
- Is scale defined?
- Is rounding mode explicit?
- Are negative values allowed?
- Are minor units more appropriate?
- Is DB precision/scale specified?
- Is API decimal represented safely?
- Is `BigDecimal.equals` issue handled?
- Are calculations tested for edge cases?

## 8.1 Red flags

```java
BigDecimal amount
double price
String amount
```

## 8.2 Better

```java
record Money(BigDecimal amount, Currency currency) {}
record MoneyMinor(long minorUnits, Currency currency) {}
```

## 8.3 DB

```sql
amount DECIMAL(19,2) NOT NULL
currency_code CHAR(3) NOT NULL
```

## 8.4 API

For exact decimal:

```json
{"amount": "10.50", "currency": "SGD"}
```

## 8.5 Review action

Require Money type or explicit justification.

---

# 9. Checklist 6 — Boolean, Flag, and State

Tanya:

- Is boolean meaning obvious?
- Is boolean used as method parameter?
- Are there multiple booleans describing one concept?
- Does null Boolean have meaning?
- Are there more than two states?
- Should this be enum/sealed type?
- Are invalid combinations possible?

## 9.1 Red flag

```java
closeCase(caseId, true, false)
```

## 9.2 Better

```java
closeCase(caseId, NotificationPolicy.SEND, CloseMode.NORMAL)
```

## 9.3 State red flag

```java
boolean approved;
boolean rejected;
boolean pending;
```

## 9.4 Better

```java
enum ApprovalStatus { PENDING, APPROVED, REJECTED }
```

or sealed if data differs.

## 9.5 Review action

Replace unclear booleans with enum/policy/command/state type.

---

# 10. Checklist 7 — Enum

Tanya:

- Is the set truly closed and stable?
- Is enum persisted or serialized?
- Is ordinal used anywhere?
- Are enum names stable enough for wire/DB?
- Do we need stable code?
- What happens when new value is added?
- Do generated clients tolerate unknown?
- Is display label separated from code?
- Is this actually dynamic reference data?

## 10.1 Red flag

```java
@Enumerated(EnumType.ORDINAL)
```

## 10.2 Better

```java
enum Status {
    CLOSED("C");
}
```

with converter.

## 10.3 Dynamic data

If business users add values, use reference table, not enum.

## 10.4 Review action

Ensure enum persistence/wire uses stable code and compatibility policy.

---

# 11. Checklist 8 — Records and Value Objects

Tanya:

- Is record a true transparent data carrier?
- Are components immutable?
- Are collections defensively copied?
- Are arrays avoided or handled?
- Does generated equals/hashCode fit?
- Does generated toString leak sensitive data?
- Are invariants enforced in compact constructor?
- Is record used as JPA entity incorrectly?
- Is record component name becoming API contract accidentally?

## 11.1 Red flag

```java
record Token(String accessToken) {}
record Digest(byte[] bytes) {}
record Tags(List<String> values) {}
```

## 11.2 Better

- override safe toString for sensitive data;
- class for arrays;
- `List.copyOf` for collections;
- explicit DTO property names for API.

## 11.3 Review action

Records need shallow immutability review.

---

# 12. Checklist 9 — Sealed Types and Polymorphism

Tanya:

- Are variants closed?
- Do variants carry different data?
- Is exhaustive switch used?
- Is there a non-sealed branch?
- How does it serialize?
- Is discriminator stable?
- Is subtype whitelist configured?
- What happens when new variant is added?
- Does DB/API mapping preserve variant-specific fields?

## 12.1 Good use

```java
sealed interface CaseState permits Draft, Submitted, Closed {}
```

## 12.2 Bad use

Sealed hierarchy with class-name discriminator exposed in API.

## 12.3 Review action

Sealed types need external contract mapping plan.

---

# 13. Checklist 10 — Generics

Tanya:

- Does generic abstraction reduce duplication or hide domain rules?
- Are wildcards correct?
- Is raw type used?
- Is unchecked cast centralized?
- Does type erasure affect runtime behavior?
- Is `Class<T>` enough or need `Type`?
- Are generic arrays avoided?
- Are type parameters named meaningfully?
- Is API too complex for team?

## 13.1 Red flag

```java
Repository<T, ID> // used for all domain behavior
```

## 13.2 Good

Generic infrastructure hidden behind domain-specific service.

## 13.3 Review action

Use generics to express real type relationships, not to erase domain.

---

# 14. Checklist 11 — Collections

Tanya:

- Does order matter?
- Does uniqueness matter?
- Can collection be empty?
- Can elements be null?
- Is collection mutable?
- Is defensive copy needed?
- Is max size bounded?
- Is this list/set/map semantics explicit in API/DB?
- Is collection used as cache key/hash key?
- Is collection large enough to affect memory?
- Would EnumSet/EnumMap fit?
- Should use ArrayList/ArrayDeque instead of LinkedList?

## 14.1 Red flag

```java
List<String> permissions
```

without semantics.

## 14.2 Better

```java
EnumSet<Permission>
PermissionSet
NonEmptyList<CaseId>
```

## 14.3 Review action

Make collection semantics explicit where important.

---

# 15. Checklist 12 — Optional and Absence

Tanya:

- Is absence expected?
- What kind of absence: missing, unknown, not applicable, not authorized, error?
- Is Optional used as field/parameter/collection element?
- Is Optional serialized?
- Is null still possible?
- Is rich absence needed?
- Is Result/Error better?
- Does API distinguish missing vs null?

## 15.1 Good use

```java
Optional<User> findById(UserId id)
```

## 15.2 Red flag

```java
record User(Optional<String> email) {}
void update(Optional<String> name)
```

## 15.3 Review action

Use Optional for return absence. Model boundary/field absence explicitly.

---

# 16. Checklist 13 — Date and Time

Tanya:

- Is it machine time or human/civil time?
- Should it be `Instant`, `LocalDate`, `LocalDateTime`, `OffsetDateTime`, or `ZonedDateTime`?
- Is timezone explicit?
- Is Clock injected for tests?
- Is precision consistent with DB/API?
- Is date/time serialized with RFC 3339/ISO format?
- Does scheduling need ZoneId?
- Is expiry/replay/security using Instant?
- Are DST gaps/overlaps considered?

## 16.1 Red flag

```java
LocalDateTime createdAt
LocalDateTime expiresAt
```

## 16.2 Better

```java
Instant createdAt
Instant expiresAt
LocalDate businessDate
AppointmentTime(LocalDateTime localDateTime, ZoneId zoneId)
```

## 16.3 Review action

Do not approve ambiguous time type for audit/security/scheduling.

---

# 17. Checklist 14 — Mutability and Ownership

Tanya:

- Is object immutable?
- Are fields final?
- Are components mutable?
- Who owns mutation?
- Are defensive copies used?
- Is internal collection exposed?
- Is object used as map key?
- Is object shared across threads?
- Is builder mutable only before build?
- Does API document ownership transfer/borrow/copy?

## 17.1 Red flag

```java
private final List<T> values;
List<T> values() { return values; }
```

## 17.2 Better

```java
values = List.copyOf(values);
return values;
```

## 17.3 Review action

Every mutable object needs ownership story.

---

# 18. Checklist 15 — Equality, Hashing, Ordering

Tanya:

- Is equality identity or value?
- Are equals/hashCode consistent?
- Are mutable fields used in hashCode?
- Are arrays compared by content?
- Is BigDecimal scale handled?
- Is comparator consistent with equals?
- Is entity equality ORM/proxy-safe?
- Is object used in HashMap/HashSet/TreeMap?
- Is ordering stable and documented?

## 18.1 Red flag

Mutable key in HashMap.

## 18.2 Red flag

Record with `byte[]`.

## 18.3 Review action

If type is used as key, scrutinize immutability/equality.

---

# 19. Checklist 16 — Concurrency and Java Memory Model

Tanya:

- Is data shared across threads?
- Is it immutable?
- Is it safely published?
- Is volatile used correctly?
- Is mutable object graph behind volatile?
- Are compound operations atomic?
- Is multi-field invariant protected?
- Are concurrent collections storing mutable values?
- Are final fields used correctly?
- Does `this` escape constructor?
- Is AtomicReference state immutable?
- Is LongAdder used only where exact immediate count not needed?

## 19.1 Red flag

```java
volatile Map<String, Rule> rules = new HashMap<>();
rules.put(...)
```

## 19.2 Better

```java
volatile Config config; // Config immutable
```

## 19.3 Review action

Shared mutable data needs explicit synchronization story.

---

# 20. Checklist 17 — Serialization Boundary

Tanya:

- Is this data serialized to JSON/cache/event/file?
- Is wire format explicit?
- Is DTO separate from domain/entity?
- Are field names stable?
- Is null/missing/default defined?
- Is enum serialized by stable code?
- Is date/time format defined?
- Is BigDecimal/money safe?
- Is polymorphism using stable discriminator?
- Is Java native serialization avoided?
- Is versioning handled?
- Are secrets excluded/redacted?

## 20.1 Red flag

Direct domain/entity serialization.

## 20.2 Red flag

Class-name polymorphic discriminator.

## 20.3 Review action

Boundary contract should be explicit and tested.

---

# 21. Checklist 18 — API Contract

Tanya:

- Is OpenAPI/JSON Schema updated?
- Are required/optional/nullable correct?
- Are examples present?
- Are string patterns/lengths defined?
- Are numeric ranges defined?
- Are arrays bounded?
- Is ID string if JS precision risk?
- Is money represented safely?
- Is error model structured?
- Are readOnly/writeOnly fields correct?
- Are generated clients tested?
- Is change backward compatible?

## 21.1 Red flag

```yaml
type: object
additionalProperties: true
```

for important request without justification.

## 21.2 Review action

API schema is source of truth, not afterthought.

---

# 22. Checklist 19 — Database Mapping

Tanya:

- Is SQL type correct?
- Is nullability aligned with domain?
- Are length/precision/scale specified?
- Are constraints present?
- Are enum codes stable?
- Is timezone/precision tested?
- Is typed ID converter tested?
- Is JSON column justified?
- Are indexes aligned with query and type?
- Is migration compatible?
- Are DB defaults aligned with app defaults?

## 22.1 Red flag

```sql
amount DECIMAL
status VARCHAR
created_at TIMESTAMP
```

without precision/constraints/semantics.

## 22.2 Review action

DB schema should enforce durable invariants.

---

# 23. Checklist 20 — Validation and Constraints

Tanya:

- What is boundary validation?
- What is domain invariant?
- What is DB/API schema constraint?
- Are validation errors structured?
- Are multiple errors collected where UX needs it?
- Are constructor invariants enforced?
- Is normalization order defined?
- Are custom validators safe?
- Are regexes bounded?
- Are validation groups overused?
- Is authorization confused with validation?

## 23.1 Red flag

Validation only in controller.

## 23.2 Review action

Boundary validation + domain invariant + durable constraint.

---

# 24. Checklist 21 — Security

Tanya:

- Is any field secret/PII?
- Is toString/logging safe?
- Is input user-controlled?
- Is value used as path/URL/query?
- Is SQL parameterized?
- Are dynamic identifiers allowlisted?
- Is output encoded by context?
- Is XML parser secure?
- Is deserialization safe?
- Is polymorphic subtype whitelist used?
- Are numeric limits safe?
- Are collection/string sizes bounded?
- Is tenant included in query/cache key?
- Is authorization based on authenticated principal, not request field?

## 24.1 Red flag

```java
String token
String redirectUrl
String filePath
String sort
```

## 24.2 Review action

Security-sensitive values deserve explicit types and allowlists.

---

# 25. Checklist 22 — Performance and Memory

Tanya:

- Is data volume large?
- Are primitives boxed?
- Are many tiny objects created?
- Is object graph deep?
- Are arrays/collections chosen appropriately?
- Is BigDecimal in hot loop?
- Is Stream boxing?
- Is regex/date formatter recreated?
- Is collection pre-sized?
- Is cache storing huge graph?
- Is data type optimized based on measurement?
- Is JMH/JFR used for claims?

## 25.1 Red flag

```java
List<Integer> millionIds
LinkedList largeQueue
```

## 25.2 Review action

Use clear domain types normally; compact representation for measured hot/large paths.

---

# 26. Checklist 23 — Reflection and Runtime Metadata

Tanya:

- Is reflection needed?
- Is it framework boundary or business logic?
- Are class names user-controlled?
- Are methods/fields cached?
- Are annotations targeted correctly?
- Are records inspected by record components?
- Are generics captured by Type token?
- Are module opens configured?
- Is native image/AOT impacted?
- Is setAccessible used?
- Is InvocationTargetException handled?

## 26.1 Red flag

User input controls method/class name.

## 26.2 Review action

Prefer type-safe dispatch. Isolate reflection.

---

# 27. Checklist 24 — Error Modeling

Tanya:

- Are errors typed or strings?
- Are domain errors exhaustive?
- Are API errors structured?
- Are error codes stable?
- Are messages localizable?
- Is sensitive detail hidden?
- Are validation errors field-level?
- Are retryable/non-retryable errors distinguished?
- Is exception used for expected user errors?

## 27.1 Red flag

```java
return "failed";
```

## 27.2 Better

```java
sealed interface CloseCaseError permits CaseNotFound, Unauthorized, AlreadyClosed {}
```

## 27.3 Review action

If caller reacts, model error as type/code.

---

# 28. Checklist 25 — Event and Command Data Types

Tanya:

- Is it command or event?
- Is command intent explicit?
- Is event immutable fact?
- Does event include ID, occurredAt, aggregate ID, version?
- Is event schema stable?
- Are secrets/PII excluded?
- Is event payload versioned?
- Are old consumers compatible?
- Is command idempotency modeled?
- Is event ordering/version modeled?

## 28.1 Red flag

Same class used as request command and event.

## 28.2 Review action

Separate command, event, DTO, domain where semantics differ.

---

# 29. Checklist 26 — Cache Data Types

Tanya:

- Is cache key typed?
- Does key include tenant/security dimensions?
- Is value immutable?
- Is serialized value versioned?
- Can old app read new value?
- Can new app read old value?
- Is TTL appropriate?
- Is value too large/deep?
- Are null/miss/negative cache semantics explicit?

## 29.1 Red flag

```java
"case:" + caseId
```

in multi-tenant system.

## 29.2 Review action

Use typed cache key builder and immutable cache DTO.

---

# 30. Checklist 27 — Logging and Observability

Tanya:

- Does toString leak sensitive data?
- Are IDs/correlation IDs logged?
- Are error types/codes observable?
- Are validation failures measurable?
- Are unknown enum/event types counted?
- Are data type conversion failures logged with safe context?
- Is payload too large for logs?
- Is PII redacted?

## 30.1 Red flag

Logging full request DTO with password/token/PII.

## 30.2 Review action

Design safe observability fields explicitly.

---

# 31. Checklist 28 — Migration and Compatibility

Tanya:

- Does change affect serialized/API/DB/event/cache data?
- Are old records/events still readable?
- Are old clients still supported?
- Are new fields optional first?
- Is field rename handled as remove+add?
- Is enum addition safe?
- Is DB migration reversible/forward-compatible?
- Is cache namespace versioned?
- Is schema registry compatibility configured?
- Are migration tests using old data?

## 31.1 Red flag

Field type changed without migration plan.

## 31.2 Review action

Compatibility plan required for durable/shared data type changes.

---

# 32. Checklist 29 — Testing Strategy

Minimum test types:

## 32.1 Domain invariant tests

Valid/invalid construction.

## 32.2 Boundary validation tests

Bad request returns structured errors.

## 32.3 Serialization tests

Golden JSON/event/cache payload.

## 32.4 DB mapping tests

Round-trip with real DB.

## 32.5 API schema tests

OpenAPI response validation.

## 32.6 Compatibility tests

Old payload -> new reader; new payload -> old reader if required.

## 32.7 Security tests

Path traversal, SSRF, SQL sort injection, secret logging.

## 32.8 Concurrency tests

Shared mutable state.

## 32.9 Performance tests

Large volume/boxing/object graph.

## 32.10 Property-based tests

Parser/canonicalization/date range/money.

---

# 33. Checklist 30 — Code Review Questions

Use these in PR comments:

1. What domain concept does this type represent?
2. Can this be invalid? Where is invariant enforced?
3. Why is this a `String`/`boolean`/`BigDecimal` instead of domain type?
4. Can this be null? What does null mean?
5. Does this cross API/DB/event/cache boundary?
6. Is serialization format stable?
7. Does this leak sensitive data via toString/logging?
8. Is this collection mutable or defensively copied?
9. Is equality/hashCode safe?
10. Is this safe under concurrent access?
11. Does this need tenant/security scoping?
12. Is there a migration/compatibility concern?
13. Is there a test for invalid/edge case?
14. Could a generated client consume this safely?
15. What happens when new enum/state variant is added?

---

# 34. Checklist 31 — Architecture Review Questions

For larger designs:

1. What are the core domain value objects?
2. What are the entity IDs and are they typed?
3. What state machines exist?
4. What commands and events exist?
5. What are DTOs vs domain types vs persistence types?
6. What are durable/public contracts?
7. How are schema changes versioned?
8. What nullability policy exists?
9. How is time represented across system?
10. How is money represented?
11. How is tenant/security context represented?
12. What data is cached and how versioned?
13. What data is serialized and with what format?
14. What invariants are duplicated in DB constraints?
15. What data type decisions are performance critical?
16. What fields are PII/secret?
17. What are compatibility guarantees?
18. What are expected failure/error types?
19. What testing pyramid covers type bugs?
20. What conventions must LLM/code generator follow?

---

# 35. Checklist 32 — Red Flags

High-priority red flags:

- `double` for money.
- enum ordinal persisted.
- `LocalDateTime` for token expiry/audit event.
- direct entity serialization.
- Java native deserialization from untrusted/shared data.
- `String token/password/apiKey` logged by record toString.
- raw `String redirectUrl/filePath/sort`.
- `Map<String,Object>` as domain model.
- `Boolean approved` with null meaning pending.
- status + nullable state-specific fields.
- record with `byte[]`.
- record with mutable List and no copy.
- public API long ID as JSON number for JS clients.
- `ConcurrentHashMap<K, MutableList>` updated directly.
- volatile reference to mutable graph.
- validation only in controller.
- DB nullable everything.
- reflection dispatch based on user input.

---

# 36. Checklist 33 — Green Flags

Good signs:

- typed IDs for important entities;
- Money includes currency and rounding/scale policy;
- Instant used for audit/security timestamps;
- ZoneId stored for human scheduled time;
- enums use stable external code;
- sealed types model variant states;
- domain value objects enforce invariants;
- DTOs separate from entities/domain;
- collections defensively copied;
- cache keys include tenant/security dimensions;
- API schema defines required/nullable/pattern/range;
- DB schema has NOT NULL/CHECK/UNIQUE/FK;
- error model has stable codes;
- secrets have masked toString;
- events are immutable and versioned;
- compatibility tests exist;
- mapping tests use real DB/serialized JSON.

---

# 37. Example Review: Bad to Good

## 37.1 Bad design

```java
record CloseCaseRequest(
    String tenantId,
    String caseId,
    String officerId,
    String reason,
    Boolean notify,
    Long expectedVersion
) {}

record CaseEntity(
    String tenantId,
    String caseId,
    String status,
    String reason,
    LocalDateTime closedAt,
    List<String> attachments
) {}
```

Problems:

- raw IDs;
- nullable Boolean;
- status string;
- reason raw string;
- LocalDateTime for event time;
- mutable list;
- entity likely used as DTO;
- expectedVersion nullable raw Long.

## 37.2 Better boundary DTO

```java
record CloseCaseRequest(
    String reason,
    Boolean notify,
    Long expectedVersion
) {}
```

Path/auth supplies tenant/case/officer.

## 37.3 Better domain types

```java
record TenantId(String value) {}
record CaseId(String value) {}
record OfficerId(String value) {}
record ClosureReason(String value) {}
record ExpectedVersion(Version value) {}
enum NotificationPolicy { SEND, SILENT }
```

## 37.4 Better command

```java
record CloseCaseCommand(
    TenantScoped<CaseId> caseRef,
    OfficerId actorId,
    ClosureReason reason,
    NotificationPolicy notificationPolicy,
    ExpectedVersion expectedVersion
) {}
```

## 37.5 Better state

```java
sealed interface CaseState permits Open, Closed {}

record Open() implements CaseState {}

record Closed(
    Instant closedAt,
    OfficerId closedBy,
    ClosureReason reason
) implements CaseState {}
```

## 37.6 Better snapshot

```java
record CaseSnapshot(
    TenantScoped<CaseId> caseRef,
    CaseState state,
    Version version,
    List<AttachmentRef> attachments
) {
    CaseSnapshot {
        attachments = List.copyOf(attachments);
    }
}
```

---

# 38. Minimal Review Template

Use this as PR comment template.

```markdown
## Data Type Review

### Domain meaning
- [ ] Important IDs are typed.
- [ ] Money/time/security values have domain-specific types.
- [ ] No ambiguous raw `String`/`boolean`/`BigDecimal`.

### Invariants
- [ ] Required values are non-null.
- [ ] Domain invariants enforced in constructor/factory.
- [ ] Invalid state combinations are impossible or constrained.

### Boundaries
- [ ] DTO/domain/entity/event are separated where needed.
- [ ] API schema/DB schema/event schema updated.
- [ ] Null/missing/default behavior documented.

### Mutability
- [ ] Collections/arrays defensively copied.
- [ ] Value objects immutable.
- [ ] Shared data thread-safe or immutable.

### Compatibility/security/performance
- [ ] Serialized/DB/API changes are compatible or migrated.
- [ ] Secrets/PII are redacted and not leaked by `toString`.
- [ ] Data volume/performance concerns measured or justified.

### Tests
- [ ] Valid/invalid domain tests.
- [ ] Serialization/API/DB mapping tests.
- [ ] Edge cases for null, scale, timezone, enum, large IDs.
```

---

# 39. Production Readiness Gate

Before production, answer:

## 39.1 Correctness

- Can invalid data be represented?
- Can invalid data be persisted?
- Can invalid data be emitted?
- Can old data still be read?

## 39.2 Security

- Can attacker control this value?
- Can it become SQL/path/URL/class/method?
- Can it leak secret/PII?
- Is tenant/authorization represented?

## 39.3 Compatibility

- Does it affect API/event/DB/cache?
- Are clients/consumers compatible?
- Is migration safe?

## 39.4 Operability

- Can failures be observed?
- Are error codes structured?
- Are unknown variants counted?
- Can support debug without secrets?

## 39.5 Scale

- Is object volume large?
- Are wrappers/boxing acceptable?
- Is memory footprint measured?
- Is concurrency safe?

If answers are unclear, data type design is not production-ready.

---

# 40. Ringkasan

Data type review is production risk review.

A strong Java engineer reviews not only syntax, but meaning:

```text
What does this value mean?
What can it be?
What can it not be?
Where does it come from?
Where does it go?
Who can see it?
How long does it live?
Can it change?
Can it be shared?
Can it be serialized?
Can it break old clients?
Can it leak secrets?
Can it scale?
```

Checklist utama:

- avoid primitive obsession;
- encode domain meaning;
- enforce invariants;
- separate boundary DTOs;
- make null semantics explicit;
- model money/time/security carefully;
- use immutable value objects;
- handle equality/hash correctly;
- design API/DB/event/cache contracts explicitly;
- validate at boundary and domain;
- mirror durable constraints in DB;
- review security and serialization;
- test edge cases and compatibility.

The goal is not to make code “fancy”.

The goal is to make illegal states difficult, correct states obvious, and production failures less likely.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Data Types — Part 032](./learn-java-data-types-part-032.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Data Types — Part 034](./learn-java-data-types-part-034.md)
