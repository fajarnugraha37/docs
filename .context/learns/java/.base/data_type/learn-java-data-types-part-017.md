# learn-java-data-types-part-017.md

# Java Data Types — Part 017  
# Optional, Absence, Nullability, dan Result Modeling

> Seri: **Advanced Java Data Types**  
> Bagian: **017**  
> Fokus: memahami `Optional<T>` dan nullability sebagai bagian dari desain data type: absence vs unknown vs invalid vs unauthorized, `Optional` sebagai return type, anti-pattern Optional field/parameter, primitive optional, null object, sentinel, result modeling, sealed result, nullness annotations, boundary API/DB/JSON, dan production failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Masalah Besar: Absence Bukan Selalu `null`](#2-masalah-besar-absence-bukan-selalu-null)
3. [Mental Model: Presence, Absence, Unknown, Invalid, Hidden, Error](#3-mental-model-presence-absence-unknown-invalid-hidden-error)
4. [`null` di Java](#4-null-di-java)
5. [Apa Itu `Optional<T>`](#5-apa-itu-optionalt)
6. [Kapan `Optional` Tepat](#6-kapan-optional-tepat)
7. [Kapan `Optional` Tidak Tepat](#7-kapan-optional-tidak-tepat)
8. [`Optional` Harusnya Tidak Pernah `null`](#8-optional-harusnya-tidak-pernah-null)
9. [Membuat Optional: `of`, `ofNullable`, `empty`](#9-membuat-optional-of-ofnullable-empty)
10. [Mengambil Nilai: `orElse`, `orElseGet`, `orElseThrow`](#10-mengambil-nilai-orelse-orelseget-orelsethrow)
11. [`orElse` vs `orElseGet`](#11-orelse-vs-orelseget)
12. [`map`, `flatMap`, `filter`](#12-map-flatmap-filter)
13. [`ifPresent`, `ifPresentOrElse`, `or`](#13-ifpresent-ifpresentorelse-or)
14. [Primitive Optional: `OptionalInt`, `OptionalLong`, `OptionalDouble`](#14-primitive-optional-optionalint-optionallong-optionaldouble)
15. [Optional dan Collections](#15-optional-dan-collections)
16. [Optional dan Streams](#16-optional-dan-streams)
17. [Optional Field Anti-Pattern](#17-optional-field-anti-pattern)
18. [Optional Parameter Anti-Pattern](#18-optional-parameter-anti-pattern)
19. [Optional dalam DTO/API](#19-optional-dalam-dtoapi)
20. [Optional dalam Entity/ORM](#20-optional-dalamentityorm)
21. [Optional dalam Domain Service](#21-optional-dalam-domain-service)
22. [Absence yang Kaya: Saat Optional Tidak Cukup](#22-absence-yang-kaya-saat-optional-tidak-cukup)
23. [Result Modeling dengan Sealed Type](#23-result-modeling-dengan-sealed-type)
24. [Null Object Pattern](#24-null-object-pattern)
25. [Sentinel Value](#25-sentinel-value)
26. [Nullability Annotations](#26-nullability-annotations)
27. [`Objects.requireNonNull` dan Fail Fast](#27-objectsrequirenonnull-dan-fail-fast)
28. [JSON/API Boundary: Missing vs Null vs Empty](#28-jsonapi-boundary-missing-vs-null-vs-empty)
29. [Database Boundary: NULL vs Empty vs Default](#29-database-boundary-null-vs-empty-vs-default)
30. [Cache Boundary: Miss vs Cached Null vs Negative Cache](#30-cache-boundary-miss-vs-cached-null-vs-negative-cache)
31. [Security Boundary: Not Found vs Not Authorized](#31-security-boundary-not-found-vs-not-authorized)
32. [Performance dan Allocation](#32-performance-dan-allocation)
33. [Production Failure Modes](#33-production-failure-modes)
34. [Best Practices](#34-best-practices)
35. [Decision Matrix](#35-decision-matrix)
36. [Latihan](#36-latihan)
37. [Ringkasan](#37-ringkasan)
38. [Referensi](#38-referensi)

---

# 1. Tujuan Bagian Ini

Di Java, absence sering direpresentasikan sebagai `null`.

```java
User user = repository.findById(id); // null if not found?
```

Masalahnya:

```text
null itu terlalu miskin makna.
```

`null` bisa berarti:

- tidak ditemukan;
- belum di-load;
- tidak punya nilai;
- tidak diketahui;
- tidak diizinkan melihat;
- input invalid;
- error terjadi;
- field optional;
- default belum dihitung;
- bug.

Java 8 memperkenalkan `Optional<T>` untuk membuat absence lebih eksplisit pada API tertentu.

```java
Optional<User> findById(UserId id);
```

Tetapi `Optional` juga sering disalahgunakan:

```java
class User {
    Optional<String> email; // often bad
}

void update(Optional<String> name) {} // often bad
```

Bagian ini bertujuan membuat kamu memahami:

- makna `null`;
- kapan `Optional` tepat;
- kapan `Optional` tidak tepat;
- primitive optional;
- optional transformation;
- absence yang butuh reason;
- result modeling dengan sealed type;
- nullability annotations;
- boundary JSON/DB/cache/security;
- production failure modes.

---

# 2. Masalah Besar: Absence Bukan Selalu `null`

Misal:

```java
String rejectionReason = null;
```

Apa artinya?

```text
Case belum direject?
Case approved?
Reason tidak wajib?
Reason belum di-load?
User tidak authorized?
Bug mapping?
```

Satu nilai `null` menampung banyak makna.

## 2.1 Ambiguity kills correctness

```java
if (reason == null) {
    approve();
}
```

Jika null berarti “not authorized to view reason”, logic menjadi security bug.

## 2.2 Absence must be modeled by meaning

Pertanyaan utama:

```text
Nilai tidak ada karena apa?
```

Jika jawabannya hanya “tidak ada hasil”, `Optional` mungkin cukup.

Jika jawabannya butuh reason, gunakan result type/sealed type.

## 2.3 Null hides contract

```java
User findById(UserId id)
```

Apakah bisa null?

Tidak terlihat dari signature.

```java
Optional<User> findById(UserId id)
```

Lebih jelas: mungkin tidak ada user.

## 2.4 But Optional is not magic

`Optional` hanya membedakan:

```text
present
empty
```

Ia tidak membedakan:

```text
not found
not authorized
invalid input
system error
not loaded
unknown
```

---

# 3. Mental Model: Presence, Absence, Unknown, Invalid, Hidden, Error

Sebelum memilih type, klasifikasikan semantic.

## 3.1 Present

Nilai ada.

```java
EmailAddress email
```

## 3.2 Absent

Nilai memang tidak ada.

```java
Optional<MiddleName>
```

## 3.3 Unknown

Sistem tidak tahu nilai.

```java
BirthDateStatus.UNKNOWN
```

## 3.4 Invalid

Input ada tetapi tidak valid.

```java
ValidationError
```

## 3.5 Hidden/Unauthorized

Nilai ada mungkin, tetapi caller tidak boleh melihat.

```java
AccessDenied
```

## 3.6 Not loaded

Nilai belum di-load karena lazy/loading strategy.

```java
NotLoaded
```

Jangan samakan dengan absent.

## 3.7 Error

Gagal karena system/infrastructure failure.

```java
DatabaseException
TimeoutException
```

Biasanya bukan `Optional.empty()`.

## 3.8 Type decision

| Semantics | Possible type |
|---|---|
| present required | `T` |
| absent no reason needed | `Optional<T>` |
| absent with reason | sealed result |
| nullable external field | wrapper/DTO + validation |
| unknown | enum/sealed state |
| invalid | validation result |
| unauthorized | explicit access result |
| system failure | exception/result depending architecture |
| not loaded | lazy wrapper/projection design |

---

# 4. `null` di Java

`null` adalah special value untuk reference types.

```java
String s = null;
User u = null;
List<String> list = null;
```

Primitive tidak bisa null.

```java
int x = null; // invalid
```

## 4.1 NullPointerException

NPE terjadi ketika aplikasi memakai `null` saat object dibutuhkan.

Examples:

```java
s.length()
u.name()
list.add("x")
```

Jika receiver null, NPE.

## 4.2 Null is not typed domain value

`null` bisa assign ke hampir semua reference type.

```java
CaseId id = null;
OfficerId officerId = null;
```

Compiler tidak bisa membedakan semantic.

## 4.3 Null as default field

Reference fields default to null if not initialized.

```java
class User {
    String name; // null by default
}
```

This is dangerous.

## 4.4 Null in collections

```java
List.of("a", null) // NPE
new ArrayList<String>().add(null) // allowed
```

Null policy depends collection.

## 4.5 Null in APIs

A method can accept/return null unless contract forbids it.

Need explicit documentation, annotations, validation, or type modeling.

---

# 5. Apa Itu `Optional<T>`

`Optional<T>` adalah final class container yang mungkin berisi non-null value atau empty.

```java
Optional<User> maybeUser = Optional.of(user);
Optional<User> noUser = Optional.empty();
```

Java SE 25 API note menyatakan `Optional` terutama dimaksudkan sebagai method return type ketika ada kebutuhan jelas merepresentasikan “no result” dan penggunaan `null` kemungkinan menyebabkan error; variable bertipe `Optional` seharusnya tidak pernah `null`.

## 5.1 Optional has two states

```text
present(T value)
empty
```

## 5.2 Optional value cannot be null

```java
Optional.of(null) // NPE
```

Use:

```java
Optional.ofNullable(value)
```

if source may be null.

## 5.3 Optional is value-based class

Do not use identity-sensitive operations on Optional:

```java
optional == Optional.empty()
```

Use:

```java
optional.isEmpty()
```

or:

```java
optional.isPresent()
```

## 5.4 Optional is not collection

It has at most one value, but conceptually it is not a general collection.

## 5.5 Optional is not error handling

Empty means no value, not why no value.

---

# 6. Kapan `Optional` Tepat

## 6.1 Return type for lookup

```java
Optional<User> findById(UserId id);
```

No user found is normal outcome.

## 6.2 Return type for parsing

```java
Optional<CaseStatus> parseStatus(String raw);
```

If invalid reason not needed.

If reason needed, use validation result.

## 6.3 Return type for optional derived value

```java
Optional<EmailAddress> primaryEmail();
```

## 6.4 Return type for first/matching element

```java
Optional<Order> findFirstPendingOrder();
```

## 6.5 Safe chaining

```java
Optional<String> city = userRepository.findById(userId)
    .map(User::profile)
    .map(Profile::address)
    .map(Address::city);
```

Only if each map result semantics truly optional.

## 6.6 Avoid null return

If method returns Optional, return:

```java
Optional.empty()
```

not null.

---

# 7. Kapan `Optional` Tidak Tepat

## 7.1 Field by default

```java
class User {
    private Optional<EmailAddress> email;
}
```

Usually not recommended.

Better:

```java
private EmailAddress email; // nullable? not ideal
```

or better domain model:

```java
EmailState
Optional returned by accessor if needed
```

For simple immutable DTO/domain object, sometimes Optional field works technically, but it complicates serialization/ORM and can itself be null.

## 7.2 Parameter by default

```java
void updateName(Optional<DisplayName> name)
```

Often bad.

Callers must wrap:

```java
updateName(Optional.of(name))
updateName(Optional.empty())
```

Better:

- overloads;
- command object;
- explicit patch type.

## 7.3 Collection element

```java
List<Optional<Item>>
```

Often smell.

Better:

- filter missing items;
- use result list with reason;
- map IDs to lookup result.

## 7.4 Error handling

```java
Optional<User> createUser(CreateUserCommand command)
```

Empty if invalid? duplicate? unauthorized?

Bad.

Use result.

## 7.5 Required value

Do not use Optional when absence impossible by invariant.

```java
Optional<CaseId> id
```

if every case must have ID.

## 7.6 Serialization DTO

Many JSON libraries can handle Optional with modules/config, but external API semantics often clearer with explicit nullable/missing rules.

---

# 8. `Optional` Harusnya Tidak Pernah `null`

Bad:

```java
Optional<User> maybeUser = null;
```

This defeats purpose.

Correct:

```java
Optional<User> maybeUser = Optional.empty();
```

## 8.1 API contract

If method returns Optional, never return null.

```java
Optional<User> findById(UserId id) {
    return Optional.empty();
}
```

## 8.2 Defensive check

At boundary with untrusted implementation:

```java
Optional<User> result = Objects.requireNonNull(repository.findById(id));
```

## 8.3 Optional field danger

If you have Optional field, it can still be null unless constructor validates.

```java
record User(Optional<Email> email) {
    User {
        email = Objects.requireNonNull(email);
    }
}
```

But still often not best design.

## 8.4 Null Optional is worse than null value

Now caller must handle both:

```java
maybe == null
maybe.isEmpty()
```

Do not create double absence.

---

# 9. Membuat Optional: `of`, `ofNullable`, `empty`

## 9.1 `Optional.of`

Use when value must be non-null.

```java
Optional<User> user = Optional.of(existingUser);
```

Throws NPE if null.

## 9.2 `Optional.ofNullable`

Use when source may be null.

```java
Optional<User> user = Optional.ofNullable(legacyFindUser(id));
```

Good at legacy/null boundary.

## 9.3 `Optional.empty`

```java
Optional<User> noUser = Optional.empty();
```

## 9.4 Avoid wrapping Optional again

Bad:

```java
Optional<Optional<User>>
```

Usually use `flatMap`.

## 9.5 Constructor/factory

For domain type, don't store Optional unless chosen deliberately.

---

# 10. Mengambil Nilai: `orElse`, `orElseGet`, `orElseThrow`

## 10.1 `orElse`

```java
User user = maybeUser.orElse(defaultUser);
```

Default value evaluated before call.

## 10.2 `orElseGet`

```java
User user = maybeUser.orElseGet(() -> createDefaultUser());
```

Supplier executed only when empty.

## 10.3 `orElseThrow`

```java
User user = maybeUser.orElseThrow(() -> new NotFoundException(id));
```

Use when absence at this layer should become exception.

## 10.4 `get`

```java
User user = maybeUser.get();
```

Avoid unless you already checked presence. Prefer `orElseThrow`.

## 10.5 `isPresent`

```java
if (maybeUser.isPresent()) {
    User user = maybeUser.get();
}
```

Sometimes okay, but often map/orElse/switch-style result is cleaner.

---

# 11. `orElse` vs `orElseGet`

This is important.

```java
User user = maybeUser.orElse(expensiveDefault());
```

`expensiveDefault()` runs even if `maybeUser` is present.

## 11.1 Example

```java
String value = Optional.of("actual")
    .orElse(createExpensiveDefault());
```

`createExpensiveDefault()` still executes.

## 11.2 Use orElseGet for expensive/lazy default

```java
String value = Optional.of("actual")
    .orElseGet(() -> createExpensiveDefault());
```

Supplier not called when present.

## 11.3 orElse for constants/simple values

```java
String name = maybeName.orElse("anonymous");
```

Good.

## 11.4 Side effects

Never put side-effect default in `orElse`.

```java
maybe.orElse(saveDefaultToDatabase()) // bad
```

Use explicit logic.

## 11.5 Performance

`orElseGet` avoids unnecessary allocation/computation.

---

# 12. `map`, `flatMap`, `filter`

## 12.1 map

Transform present value.

```java
Optional<String> name = maybeUser.map(User::name);
```

If maybeUser empty, result empty.

## 12.2 map null behavior

If mapper returns null, `map` returns empty.

```java
Optional.of(user).map(User::nullableEmail)
```

If nullableEmail returns null, Optional.empty.

This can hide null if unintended. Prefer methods with non-null contract.

## 12.3 flatMap

Use when mapper already returns Optional.

```java
Optional<Email> email = maybeUser.flatMap(User::primaryEmail);
```

Avoid:

```java
Optional<Optional<Email>>
```

## 12.4 filter

```java
Optional<User> active = maybeUser.filter(User::isActive);
```

If predicate false, empty.

## 12.5 Semantics warning

`filter` turns “present but inactive” into empty.

If caller needs reason, use result type.

---

# 13. `ifPresent`, `ifPresentOrElse`, `or`

## 13.1 ifPresent

```java
maybeUser.ifPresent(user -> audit(user.id()));
```

Good for side-effect if present.

## 13.2 ifPresentOrElse

```java
maybeUser.ifPresentOrElse(
    user -> handle(user),
    () -> handleMissing()
);
```

## 13.3 or

```java
Optional<User> user = primaryLookup(id)
    .or(() -> secondaryLookup(id));
```

Supplier called only if empty.

## 13.4 Avoid complex side-effect chains

If logic is complex, use explicit `if`.

Readability matters.

## 13.5 Optional is not reactive stream

Do not over-chain Optional for imperative business workflows if it becomes unreadable.

---

# 14. Primitive Optional: `OptionalInt`, `OptionalLong`, `OptionalDouble`

Generic `Optional<Integer>` boxes primitive.

Primitive specializations:

```java
OptionalInt
OptionalLong
OptionalDouble
```

Java SE 25 `OptionalInt` API note mirrors Optional: primarily intended as method return type for clear “no result”; variable should not itself be null.

## 14.1 OptionalInt

```java
OptionalInt age = OptionalInt.of(30);
OptionalInt missing = OptionalInt.empty();
```

## 14.2 Get

```java
int value = age.orElse(0);
int required = age.orElseThrow();
```

## 14.3 Use cases

```java
OptionalInt findRetryCount(JobId id);
OptionalLong findLatestVersion(CaseId id);
OptionalDouble averageScore();
```

## 14.4 Not for fields generally

Same guidance: return type mostly.

## 14.5 No OptionalBoolean

Java does not have OptionalBoolean.

For tri-state boolean, use enum/sealed type:

```java
enum FeatureState { ENABLED, DISABLED, UNSPECIFIED }
```

---

# 15. Optional dan Collections

## 15.1 Empty collection vs Optional collection

Usually prefer empty collection over Optional collection.

Bad:

```java
Optional<List<Item>> items
```

Often better:

```java
List<Item> items
```

where empty list means no items.

## 15.2 When Optional<List<T>> may be meaningful

If absence differs from empty:

```text
not loaded
not authorized
unknown
```

But then `Optional<List<T>>` still may not explain reason.

Use richer type:

```java
sealed interface ItemsView permits ItemsAvailable, ItemsHidden, ItemsNotLoaded {}
```

## 15.3 Collection of Optional

```java
List<Optional<User>>
```

Often bad.

Better:

- keep only found users;
- map id to result;
- use `LookupResult`.

## 15.4 Optional stream

```java
Stream<Email> emails = maybeEmail.stream();
```

Java 9+ Optional has `stream`.

Useful to flatten optionals.

## 15.5 Domain rule

Collection should usually be non-null, possibly empty, with non-null elements.

---

# 16. Optional dan Streams

## 16.1 findFirst/findAny

```java
Optional<User> user = users.stream()
    .filter(User::active)
    .findFirst();
```

Good use.

## 16.2 max/min

```java
Optional<Order> max = orders.stream()
    .max(Comparator.comparing(Order::createdAt));
```

Empty if stream empty.

## 16.3 Flatten optional

```java
List<Email> emails = users.stream()
    .map(User::primaryEmail)  // Stream<Optional<Email>>
    .flatMap(Optional::stream)
    .toList();
```

## 16.4 Avoid get in stream

Bad:

```java
optionals.stream()
    .map(Optional::get)
```

unless filtered:

```java
optionals.stream()
    .flatMap(Optional::stream)
```

## 16.5 Primitive streams

```java
OptionalInt max = IntStream.of(values).max();
```

---

# 17. Optional Field Anti-Pattern

## 17.1 Example

```java
class User {
    private Optional<Email> email;
}
```

Problems:

- field itself can be null;
- serialization frameworks may need special handling;
- ORM may not support cleanly;
- memory overhead;
- awkward constructors;
- domain meaning still only present/empty;
- Java API note primarily recommends return type.

## 17.2 Better field + optional accessor?

Sometimes:

```java
class User {
    private final Email email; // nullable internally? not ideal

    Optional<Email> email() {
        return Optional.ofNullable(email);
    }
}
```

But nullable internal still needs discipline.

## 17.3 Better domain state

```java
sealed interface EmailState permits EmailPresent, EmailMissing, EmailUnverified {}

record EmailPresent(Email email) implements EmailState {}
record EmailMissing() implements EmailState {}
record EmailUnverified(Email email) implements EmailState {}
```

If states meaningful.

## 17.4 DTO field

For API DTOs, use nullable field with validation/mapping or explicit patch type.

## 17.5 Exception

Small immutable value object with Optional component may be acceptable in some teams if consistently supported, but default guidance: avoid Optional fields.

---

# 18. Optional Parameter Anti-Pattern

## 18.1 Example

```java
void search(Optional<String> query) {}
```

Callers write:

```java
search(Optional.of("abc"));
search(Optional.empty());
```

Awkward.

## 18.2 Better overload

```java
void search() {}
void search(String query) {}
```

if simple.

## 18.3 Better command object

```java
record SearchCommand(Optional<SearchQuery> query, PageRequest page) {}
```

But again, optional field trade-off.

Better maybe:

```java
sealed interface SearchQueryFilter permits NoQuery, QueryText {}
```

## 18.4 Nullable parameter?

For internal private methods, sometimes `@Nullable` parameter is acceptable if documented.

For public domain APIs, avoid.

## 18.5 Patch semantics

Optional parameter does not represent three states:

```text
field missing/no change
field set to value
field clear to null
```

Use explicit patch field type.

```java
sealed interface FieldPatch<T> permits NoChange, SetValue, ClearValue {}
```

---

# 19. Optional dalam DTO/API

## 19.1 JSON missing/null issue

JSON can have:

```json
{}
{"email": null}
{"email": "a@example.com"}
```

`Optional<Email>` often cannot distinguish missing vs explicit null without special framework support.

## 19.2 Request DTO

Use raw nullable field plus validation/mapping:

```java
record UpdateUserRequest(String email) {}
```

Then map to explicit patch model.

## 19.3 Response DTO

If field optional, decide external contract:

- omit field;
- include null;
- include object with state;
- include empty array;
- include status/reason.

## 19.4 OpenAPI

Document `nullable`, `required`, and missing semantics.

## 19.5 Avoid exposing Java Optional in API model

External contract should not depend on Java Optional.

---

# 20. Optional dalam Entity/ORM

ORM entities usually should not use Optional fields.

## 20.1 JPA issue

JPA expects fields/properties of entity types, and Optional can complicate mapping.

## 20.2 Nullable column

DB nullable column maps to nullable field or separate embeddable/state.

```java
@Column(nullable = true)
private String middleName;
```

Accessor may return Optional:

```java
public Optional<MiddleName> middleName() {
    return Optional.ofNullable(middleName == null ? null : new MiddleName(middleName));
}
```

## 20.3 Better domain model

If middle name truly optional, value object can expose Optional return.

If absence reason matters, model state.

## 20.4 Lazy loading

Do not use Optional to mean not loaded.

That is different semantic.

## 20.5 Entity invariants

Use domain methods to manage optional fields:

```java
user.removeSecondaryEmail()
user.setSecondaryEmail(email)
```

not arbitrary Optional field mutation.

---

# 21. Optional dalam Domain Service

## 21.1 Repository lookup

Good:

```java
Optional<CaseRecord> findById(CaseId id);
```

If not found is normal.

## 21.2 Authorization-sensitive lookup

Bad:

```java
Optional<CaseRecord> findVisibleCase(CaseId id, Actor actor);
```

Empty could mean:

- not found;
- not authorized.

Maybe intentionally hide existence for security. But then name/document clearly.

Better for internal logic:

```java
sealed interface CaseAccessResult permits CaseAccessible, CaseNotFound, CaseForbidden {}
```

## 21.3 Command result

Bad:

```java
Optional<CaseRecord> closeCase(CloseCaseCommand command);
```

Why empty?

Use sealed result.

## 21.4 Derived optional

```java
Optional<OfficerId> assignedOfficer()
```

May be okay if absence simple.

## 21.5 Validation

Do not return Optional for validation failure.

Use:

```java
ValidationResult
List<Violation>
sealed ValidationOutcome
```

---

# 22. Absence yang Kaya: Saat Optional Tidak Cukup

## 22.1 Example: risk score

```java
Optional<RiskScore> score
```

Why empty?

- not calculated;
- insufficient data;
- hidden;
- expired;
- calculation failed.

Better:

```java
sealed interface RiskScoreState
    permits ScoreAvailable, ScoreNotCalculated, ScoreInsufficientData, ScoreHidden {}

record ScoreAvailable(RiskScore score, Instant calculatedAt) implements RiskScoreState {}
record ScoreNotCalculated() implements RiskScoreState {}
record ScoreInsufficientData(List<MissingData> missingData) implements RiskScoreState {}
record ScoreHidden(PolicyReason reason) implements RiskScoreState {}
```

## 22.2 Example: user lookup

```java
sealed interface UserLookupResult permits UserFound, UserNotFound, UserLookupForbidden {}

record UserFound(User user) implements UserLookupResult {}
record UserNotFound(UserId id) implements UserLookupResult {}
record UserLookupForbidden(UserId id, ActorId actorId) implements UserLookupResult {}
```

## 22.3 Example: cache

```java
sealed interface CacheLookup<V> permits CacheHit, CacheMiss, NegativeHit {}

record CacheHit<V>(V value) implements CacheLookup<V> {}
record CacheMiss<V>() implements CacheLookup<V> {}
record NegativeHit<V>(Instant cachedAt) implements CacheLookup<V> {}
```

## 22.4 Rule

If caller needs to behave differently based on absence reason, `Optional.empty()` is too weak.

---

# 23. Result Modeling dengan Sealed Type

## 23.1 Generic result

```java
sealed interface Result<T, E> permits Ok, Err {}

record Ok<T, E>(T value) implements Result<T, E> {}
record Err<T, E>(E error) implements Result<T, E> {}
```

Useful for library-like code.

## 23.2 Domain-specific result

Often clearer:

```java
sealed interface CloseCaseResult
    permits CaseClosed, CaseAlreadyClosed, CloseRejected, CaseNotFound {}

record CaseClosed(CaseId caseId, Instant closedAt) implements CloseCaseResult {}
record CaseAlreadyClosed(CaseId caseId) implements CloseCaseResult {}
record CloseRejected(CaseId caseId, RejectionReason reason) implements CloseCaseResult {}
record CaseNotFound(CaseId caseId) implements CloseCaseResult {}
```

## 23.3 Handling with switch

```java
return switch (result) {
    case CaseClosed closed -> ok(closed);
    case CaseAlreadyClosed already -> conflict(already);
    case CloseRejected rejected -> unprocessable(rejected);
    case CaseNotFound notFound -> notFound(notFound);
};
```

## 23.4 Better than Optional

No ambiguity.

## 23.5 Better than exception for expected outcome

Expected business outcomes should often be values.

---

# 24. Null Object Pattern

Null Object Pattern provides object that does nothing or represents empty behavior.

Example:

```java
interface NotificationSender {
    void send(Message message);
}

final class NoOpNotificationSender implements NotificationSender {
    public void send(Message message) {
        // no-op
    }
}
```

## 24.1 Good use

- optional strategy;
- no-op logger;
- disabled integration;
- default behavior.

## 24.2 Danger

Can hide missing configuration.

```java
paymentGateway = NoOpPaymentGateway
```

in production could be catastrophic.

## 24.3 Null object should be explicit

Name clearly:

```java
NoOpAuditSink
DisabledNotificationSender
```

## 24.4 Not for data absence generally

Null Object is behavior pattern, not universal replacement for `Optional`.

## 24.5 Audit

If no-op is used, maybe log at startup.

---

# 25. Sentinel Value

Sentinel is special value representing absence.

Examples:

```java
-1
"UNKNOWN"
LocalDate.MAX
UUID(0,0)
```

## 25.1 Problems

Sentinel can collide with real values if domain changes.

```java
-1
```

may later become valid.

## 25.2 Hidden contract

```java
int index = find();
if (index == -1) ...
```

Caller must know sentinel.

## 25.3 Better alternatives

- OptionalInt;
- sealed result;
- exception if invalid;
- explicit enum state.

## 25.4 When sentinel ok

Low-level performance-critical APIs sometimes use sentinel.

Example:

```java
String.indexOf returns -1
```

This is established API.

## 25.5 Domain code

Prefer explicit type over sentinel.

---

# 26. Nullability Annotations

Nullability annotations let code express whether references may be null.

Examples in ecosystem:

```java
@Nullable
@NonNull
@NullMarked
```

JSpecify defines nullness annotations with specified semantics so tools can analyze Java code consistently.

## 26.1 Why needed?

Java type system historically does not distinguish:

```java
String
```

that can be null vs cannot be null.

Annotations help tools.

## 26.2 JSpecify

JSpecify aims to define standard nullness annotations for Java static analysis.

Example concept:

```java
@Nullable String
```

or package-level null-marked defaults depending setup.

## 26.3 Tooling

Tools/IDEs/static analyzers can warn:

```java
nullableString.length()
```

without null check.

## 26.4 Annotation is not runtime guarantee

Unless checked, annotations do not prevent null at runtime.

Still validate boundary inputs.

## 26.5 Team policy

Pick one nullness annotation system and enforce consistently.

Mixed annotations can confuse tools.

---

# 27. `Objects.requireNonNull` dan Fail Fast

`Objects.requireNonNull` checks reference not null and throws NPE if null.

```java
this.id = Objects.requireNonNull(id, "id");
```

Java SE 25 `Objects` API describes `requireNonNull` as checking that specified object reference is not null and throwing customized NullPointerException if it is.

## 27.1 Constructor validation

```java
record CaseId(String value) {
    CaseId {
        Objects.requireNonNull(value, "value");
    }
}
```

## 27.2 Return value

`requireNonNull` returns the object, enabling assignment.

## 27.3 Message

```java
Objects.requireNonNull(userId, "userId");
```

Clearer than later NPE.

## 27.4 Supplier message

There are overloads with Supplier for lazy message creation.

Use if message expensive.

## 27.5 Fail fast

Failing in constructor/API boundary is better than allowing invalid object to exist.

---

# 28. JSON/API Boundary: Missing vs Null vs Empty

JSON distinguishes:

```json
{}
{"name": null}
{"name": ""}
{"name": "Fajar"}
```

## 28.1 Missing

Field absent.

Could mean:

- not provided;
- no change in PATCH;
- default;
- older client.

## 28.2 Null

Explicit null.

Could mean:

- clear value;
- unknown;
- invalid for required field.

## 28.3 Empty string

Value present but empty.

May be invalid or meaningful.

## 28.4 Optional is not enough for PATCH

PATCH often needs:

```text
no change
set value
clear value
```

Use:

```java
sealed interface FieldPatch<T> permits NoChange, SetValue, ClearValue {}

record NoChange<T>() implements FieldPatch<T> {}
record SetValue<T>(T value) implements FieldPatch<T> {}
record ClearValue<T>() implements FieldPatch<T> {}
```

## 28.5 Request validation

Map boundary to domain explicitly.

Do not let raw nulls flow deep.

---

# 29. Database Boundary: NULL vs Empty vs Default

DB NULL means absence/unknown/not applicable depending schema.

## 29.1 Nullable column

```sql
middle_name VARCHAR(100) NULL
```

Map to:

```java
Optional<MiddleName>
```

as return accessor maybe.

## 29.2 Empty string

DB may store `''`.

Different from NULL.

Define policy.

## 29.3 Default value

```sql
status VARCHAR DEFAULT 'DRAFT'
```

Default may hide application bug if field omitted unintentionally.

## 29.4 NOT NULL

Prefer NOT NULL for required domain data.

## 29.5 Migration

When making nullable field required:

1. backfill;
2. validate app;
3. add NOT NULL;
4. remove optional logic.

---

# 30. Cache Boundary: Miss vs Cached Null vs Negative Cache

Cache lookup can have multiple outcomes:

```text
hit with value
miss
known absent cached
load failed
```

## 30.1 Map get ambiguity

```java
V value = map.get(key);
```

null can mean absent or present-null if null values allowed.

## 30.2 ConcurrentHashMap rejects null

This helps avoid ambiguity.

## 30.3 Negative caching

If DB says user not found, cache that absence to avoid repeated DB hits.

Model explicitly:

```java
sealed interface CachedUser permits UserCacheHit, UserCacheMiss, UserNegativeHit {}
```

## 30.4 Optional as cache value?

```java
Map<UserId, Optional<User>>
```

Can represent cached negative hit.

But beware memory and semantics. A sealed cache entry may be clearer.

## 30.5 Expiry

Absence also may expire.

---

# 31. Security Boundary: Not Found vs Not Authorized

Security-sensitive APIs often intentionally hide existence.

```java
Optional<Document> findVisibleDocument(DocumentId id, Actor actor)
```

Empty could mean:

- document doesn't exist;
- actor not allowed.

This may be intentional.

## 31.1 Internal vs external result

Internal service may need distinguish:

```java
DocumentNotFound
DocumentForbidden
```

External API may map both to 404 to avoid enumeration.

## 31.2 Do not lose audit

Even if external returns 404, internal audit should know forbidden attempt.

## 31.3 Optional naming

If method intentionally hides distinction, name it clearly:

```java
findVisibleById
```

and document semantics.

## 31.4 Authorization result

```java
sealed interface DocumentAccess permits AccessGranted, NotFound, Forbidden {}
```

then external mapper decides response.

---

# 32. Performance dan Allocation

## 32.1 Optional allocation

`Optional` is object wrapper. But JIT may eliminate some allocations.

Do not use Optional in tight loops/hot fields without measuring.

## 32.2 Primitive optional avoids boxing

```java
OptionalInt
```

avoids `Optional<Integer>` boxing.

## 32.3 Optional in collections

```java
List<Optional<T>>
```

adds wrapper objects and complexity.

## 32.4 Return type overhead usually fine

For repository/service return type, Optional overhead is normally negligible compared to IO/business logic.

## 32.5 Do not micro-optimize away clarity

Use Optional where it improves contract.

But don't use it in high-volume internal data structures without thought.

---

# 33. Production Failure Modes

## 33.1 Optional returned null

Caller calls `.map` and gets NPE.

Fix:

- never return null Optional;
- tests/static analysis.

## 33.2 Optional.empty hides error

DB timeout caught and converted to empty.

Fix:

- empty only for no result;
- throw or return error result for failure.

## 33.3 `orElse` eager expensive default

Default user loaded even when present.

Fix:

- `orElseGet`.

## 33.4 Optional.get without check

NoSuchElementException in production.

Fix:

- `orElseThrow`;
- map/orElse;
- pattern/result.

## 33.5 Optional field serialization weirdness

JSON output unexpected.

Fix:

- avoid Optional DTO fields or configure deliberately.

## 33.6 Optional parameter awkwardness

Callers pass Optional.empty but meaning unclear.

Fix:

- overload/command/patch type.

## 33.7 Null in collection

`List<Item>` contains null; stream map NPE.

Fix:

- validate elements;
- `List.copyOf`;
- boundary checks.

## 33.8 DB NULL mapped to primitive default

NULL becomes 0/false.

Fix:

- wrapper at boundary;
- explicit domain mapping.

## 33.9 Not authorized hidden as not found without audit

Security event lost.

Fix:

- internal access result;
- external mapping hides if needed.

## 33.10 Optional used for validation

Empty means invalid but no reason.

Fix:

- validation result with violations.

---

# 34. Best Practices

## 34.1 Optional

- Use Optional primarily as return type for no-result.
- Never return null Optional.
- Avoid Optional fields by default.
- Avoid Optional parameters by default.
- Avoid Optional collection elements by default.
- Use `orElseGet` for expensive defaults.
- Avoid `get`; prefer `orElseThrow` or transformations.
- Use primitive optional for primitive return absence.
- Do not use Optional to hide errors.
- Do not use Optional when absence reason matters.

## 34.2 Null

- Prefer non-null domain fields.
- Validate constructor arguments with `Objects.requireNonNull`.
- Use nullability annotations consistently.
- Do not let boundary nulls flow into core.
- Prefer empty collection over null collection.
- Avoid null map values.

## 34.3 Rich absence

- Use sealed result when absence has reason.
- Use enum/sealed state for unknown/not loaded/hidden.
- Model security outcomes explicitly internally.
- Map to external API carefully.

## 34.4 Boundary

- Distinguish JSON missing/null/empty.
- Distinguish DB NULL/default/empty.
- Distinguish cache miss/negative hit/error.
- Distinguish not found/not authorized internally.

---

# 35. Decision Matrix

| Situation | Recommended |
|---|---|
| repository find by id | `Optional<Entity>` if not found normal |
| parse simple value no reason needed | `Optional<T>` |
| validation with errors | `ValidationResult` / `List<Violation>` |
| command outcome | sealed result |
| absence with reason | sealed type |
| optional primitive return | `OptionalInt/Long/Double` |
| optional collection | usually empty collection |
| PATCH field | `FieldPatch<T>` sealed type |
| JSON request nullable field | DTO nullable + validation/mapping |
| domain required field | plain non-null `T` |
| constructor arg required | `Objects.requireNonNull` |
| entity field optional | nullable/private + accessor or state type |
| cache lookup | sealed cache result if semantics rich |
| security lookup | internal sealed access result |
| hot primitive loop | sentinel/primitive optional? measure |
| map value can be absent | avoid null value; use containsKey/result |

---

# 36. Latihan

## Latihan 1 — Repository Optional

Implement:

```java
Optional<CaseRecord> findById(CaseId id)
```

Then handle with `orElseThrow`.

## Latihan 2 — Optional returned null

Write bad implementation returning null. Add test that catches it.

## Latihan 3 — orElse vs orElseGet

Create method `expensiveDefault()` that logs when called. Compare `orElse` and `orElseGet`.

## Latihan 4 — map/flatMap

Given:

```java
Optional<User> user
Optional<Profile> profile()
Optional<Address> address()
```

Build `Optional<City>`.

## Latihan 5 — Optional field refactor

Refactor:

```java
record User(Optional<Email> email)
```

to domain state or nullable boundary + optional accessor.

## Latihan 6 — Patch type

Model:

```text
no change
set value
clear value
```

with sealed `FieldPatch<T>`.

## Latihan 7 — Rich absence

Replace:

```java
Optional<RiskScore>
```

with sealed `RiskScoreState`.

## Latihan 8 — Security lookup

Model document access result with:

```text
granted
not found
forbidden
```

Map both not found/forbidden to 404 externally, but audit forbidden.

## Latihan 9 — DB null mapping

Map nullable DB column to domain object without leaking null.

## Latihan 10 — Cache negative hit

Model cache lookup with sealed type.

## Latihan 11 — Optional stream

Flatten:

```java
List<Optional<Email>>
```

to:

```java
List<Email>
```

with `Optional::stream`.

## Latihan 12 — Nullness annotations

Add JSpecify-style annotations to a small package and identify potential NPE warnings.

---

# 37. Ringkasan

`null` is too weak as a domain signal.

`Optional<T>` improves method return contracts when the only important distinction is:

```text
present vs no result
```

But `Optional` is not:

- universal null replacement;
- field type by default;
- parameter type by default;
- error handling;
- validation result;
- security decision;
- lazy loading marker;
- serialization contract.

Use:

```java
Optional<T>
```

when no-result is normal and reason is unnecessary.

Use sealed result/state when absence has meaning.

Use `Objects.requireNonNull` to enforce non-null invariants.

Use nullability annotations to help tools.

Use explicit mapping at JSON/DB/cache/security boundaries.

Senior Java engineer tidak bertanya “pakai null atau Optional?”, tetapi:

```text
Nilai tidak ada karena apa?
Apakah caller butuh reason?
Apakah absence normal?
Apakah ini boundary atau domain?
Apakah null bisa bocor?
Apakah security/audit terdampak?
```

Dari jawaban itu, type yang tepat akan terlihat.

---

# 38. Referensi

1. Java SE 25 API — `Optional`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html

2. Java SE 25 API — `OptionalInt`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/OptionalInt.html

3. Java SE 25 API — `OptionalLong`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/OptionalLong.html

4. Java SE 25 API — `OptionalDouble`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/OptionalDouble.html

5. Java SE 25 API — `Objects`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Objects.html

6. Java SE 25 API — `NullPointerException`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/NullPointerException.html

7. JSpecify — Nullness User Guide  
   https://jspecify.dev/docs/user-guide/

8. JSpecify — Nullness Specification  
   https://jspecify.dev/docs/spec/

9. Java SE 25 API — `Map`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

10. Java SE 25 API — `ConcurrentHashMap`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Data Types — Part 016](./learn-java-data-types-part-016.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Data Types — Part 018](./learn-java-data-types-part-018.md)
