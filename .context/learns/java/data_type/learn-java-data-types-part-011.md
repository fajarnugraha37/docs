# learn-java-data-types-part-011.md

# Java Data Types — Part 011  
# Enum: Closed Set Type, Constant, State, Code, Strategy, dan Production Compatibility

> Seri: **Advanced Java Data Types**  
> Bagian: **011**  
> Fokus: memahami `enum` sebagai data type modern di Java: closed set of constants, singleton-per-constant, type-safe status/code, identity equality, `switch`, enum fields/methods/constructors, constant-specific behavior, `EnumSet`, `EnumMap`, serialization, database/API mapping, compatibility, anti-pattern `ordinal`, dan kapan enum harus diganti sealed type.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Enum dalam Java Type System](#2-enum-dalam-java-type-system)
3. [Mental Model: Closed Set of Named Constants](#3-mental-model-closed-set-of-named-constants)
4. [Basic Enum Declaration](#4-basic-enum-declaration)
5. [Enum adalah Class Khusus](#5-enum-adalah-class-khusus)
6. [`java.lang.Enum`: Base Class Semua Enum](#6-javalangenum-base-class-semua-enum)
7. [Enum Constants adalah Singleton Instances](#7-enum-constants-adalah-singleton-instances)
8. [Equality: Kenapa `==` Tepat untuk Enum](#8-equality-kenapa--tepat-untuk-enum)
9. [`name()`, `toString()`, dan `ordinal()`](#9-name-tostring-dan-ordinal)
10. [Jangan Persist/Expose `ordinal`](#10-jangan-persistexpose-ordinal)
11. [Enum Fields, Constructor, dan Methods](#11-enum-fields-constructor-dan-methods)
12. [Enum dengan External Code](#12-enum-dengan-external-code)
13. [Parsing Enum dari String/API](#13-parsing-enum-dari-stringapi)
14. [Enum dan `switch`](#14-enum-dan-switch)
15. [Exhaustiveness dan Evolution Risk](#15-exhaustiveness-dan-evolution-risk)
16. [Constant-Specific Class Body](#16-constant-specific-class-body)
17. [Enum sebagai Strategy: Kapan Bagus, Kapan Berbahaya](#17-enum-sebagai-strategy-kapan-bagus-kapan-berbahaya)
18. [`EnumSet`: Set Khusus Enum](#18-enumset-set-khusus-enum)
19. [`EnumMap`: Map Khusus Enum](#19-enummap-map-khusus-enum)
20. [Enum vs `String` Status](#20-enum-vs-string-status)
21. [Enum vs `int` Code](#21-enum-vs-int-code)
22. [Enum vs Boolean Flags](#22-enum-vs-boolean-flags)
23. [Enum vs Sealed Type](#23-enum-vs-sealed-type)
24. [Enum untuk State Machine](#24-enum-untuk-state-machine)
25. [Enum di Domain Model](#25-enum-di-domain-model)
26. [Enum di API/JSON](#26-enum-di-apijson)
27. [Enum di Database](#27-enum-di-database)
28. [Enum di Kafka/Event Schema](#28-enum-di-kafkaevent-schema)
29. [Enum dan Backward/Forward Compatibility](#29-enum-dan-backwardforward-compatibility)
30. [Enum dan Localization/Display Label](#30-enum-dan-localizationdisplay-label)
31. [Enum dan Testing](#31-enum-dan-testing)
32. [Production Failure Modes](#32-production-failure-modes)
33. [Best Practices](#33-best-practices)
34. [Decision Matrix](#34-decision-matrix)
35. [Latihan](#35-latihan)
36. [Ringkasan](#36-ringkasan)
37. [Referensi](#37-referensi)

---

# 1. Tujuan Bagian Ini

Enum adalah salah satu fitur Java yang sering terlihat sederhana:

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    CLOSED
}
```

Namun enum adalah salah satu alat type modeling paling kuat untuk mencegah bug seperti:

```java
String status = "CLOESD"; // typo, compile success
int status = 3;           // magic number
boolean approved = true;
boolean rejected = true;  // impossible state
```

Dengan enum:

```java
CaseStatus status = CaseStatus.CLOSED;
```

Compiler membantu memastikan status hanya salah satu dari constants yang valid.

Bagian ini akan membahas:

- enum sebagai closed set data type;
- bagaimana enum direpresentasikan sebagai class khusus;
- kenapa `==` aman untuk enum;
- kenapa `ordinal()` berbahaya untuk persistence/API;
- enum dengan field/code/label;
- parsing external string ke enum;
- enum dalam `switch`;
- `EnumSet` dan `EnumMap`;
- enum sebagai strategy;
- enum vs sealed type;
- enum compatibility di API, DB, dan event schema;
- production failure modes.

---

# 2. Enum dalam Java Type System

Enum declaration adalah salah satu bentuk class declaration khusus di Java.

Contoh:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    CLOSED,
    REJECTED
}
```

Enum type adalah reference type.

Variable enum menyimpan reference ke salah satu enum constant atau `null`.

```java
CaseStatus status = CaseStatus.DRAFT;
CaseStatus missing = null;
```

## 2.1 Enum bukan primitive

Enum adalah object/reference.

Tetapi enum constants bersifat singleton, sehingga identity comparison dengan `==` tepat.

## 2.2 Enum extends `java.lang.Enum`

Semua enum secara implisit extend:

```java
java.lang.Enum<E>
```

Kamu tidak bisa membuat enum extend class lain.

Enum bisa implement interfaces.

```java
enum Operation implements BinaryOperator<Integer> {
    ADD {
        public Integer apply(Integer a, Integer b) {
            return a + b;
        }
    }
}
```

## 2.3 Enum adalah closed set

Set constants dideklarasikan di source enum.

Caller tidak bisa membuat constant baru dengan `new`.

```java
new CaseStatus(); // invalid
```

---

# 3. Mental Model: Closed Set of Named Constants

Enum ideal untuk konsep:

```text
Nilainya terbatas, bernama, dikenal di compile-time, dan relatif stabil.
```

Examples:

- status;
- type;
- category;
- permission;
- severity;
- direction;
- environment;
- command kind;
- event type;
- policy code internal;
- lifecycle state sederhana;
- sort direction.

## 3.1 Closed set

```java
enum Severity {
    LOW,
    MEDIUM,
    HIGH,
    CRITICAL
}
```

`Severity` hanya bisa satu dari empat constant.

## 3.2 Type-safe

```java
void escalate(CaseId id, Severity severity) {}
```

Tidak bisa accidental pass:

```java
String severity = "HIGH";
```

tanpa parsing/mapping.

## 3.3 Self-documenting

```java
CaseStatus.UNDER_REVIEW
```

lebih jelas daripada:

```java
"UR"
3
true
```

## 3.4 Enum as vocabulary

Enum membuat ubiquitous language muncul di type system.

```java
CaseStatus
EnforcementAction
RiskLevel
NotificationChannel
```

---

# 4. Basic Enum Declaration

```java
public enum NotificationChannel {
    EMAIL,
    SMS,
    PUSH
}
```

Usage:

```java
NotificationChannel channel = NotificationChannel.EMAIL;

if (channel == NotificationChannel.EMAIL) {
    ...
}
```

## 4.1 Enum constants naming

Convention: uppercase with underscores.

```java
UNDER_REVIEW
PENDING_APPROVAL
```

## 4.2 Enum in switch

```java
switch (channel) {
    case EMAIL -> sendEmail();
    case SMS -> sendSms();
    case PUSH -> sendPush();
}
```

## 4.3 Enum values

Compiler generates method:

```java
NotificationChannel.values()
```

Returns array of constants.

```java
for (NotificationChannel c : NotificationChannel.values()) {
    System.out.println(c);
}
```

Important: `values()` returns a new array copy each call.

Do not call repeatedly in hot loop without caching if performance matters.

## 4.4 valueOf

Compiler also supports:

```java
NotificationChannel.valueOf("EMAIL")
```

Throws `IllegalArgumentException` if no constant with exact name.

---

# 5. Enum adalah Class Khusus

Enum can have:

- fields;
- constructors;
- methods;
- abstract methods;
- constant-specific class bodies;
- implemented interfaces.

Example:

```java
public enum RiskLevel {
    LOW(1),
    MEDIUM(2),
    HIGH(3),
    CRITICAL(4);

    private final int rank;

    RiskLevel(int rank) {
        this.rank = rank;
    }

    public int rank() {
        return rank;
    }
}
```

## 5.1 Constructor is private

Enum constructor is implicitly private.

```java
private RiskLevel(int rank) {}
```

You cannot call it from outside.

## 5.2 Enum constants are instances

Each constant is instance of enum class.

```java
RiskLevel.HIGH.rank()
```

## 5.3 Enum can implement interface

```java
interface HasCode {
    String code();
}

enum CaseStatus implements HasCode {
    DRAFT("D"),
    CLOSED("C");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }
}
```

## 5.4 Enum cannot extend other class

Because it already extends `Enum`.

Use composition or interface.

---

# 6. `java.lang.Enum`: Base Class Semua Enum

`java.lang.Enum<E extends Enum<E>>` is the common base class of all Java enum classes.

Important methods:

```java
name()
ordinal()
compareTo(E other)
getDeclaringClass()
describeConstable()
```

Also inherited/final behavior:

- enum `equals` is identity-based and final;
- enum `hashCode` is final;
- enum `clone` is final/protected to preserve singleton;
- enum cannot be cloned normally.

## 6.1 name

```java
CaseStatus.CLOSED.name() // "CLOSED"
```

Returns exact declared constant name.

## 6.2 ordinal

```java
CaseStatus.CLOSED.ordinal()
```

Returns zero-based position in declaration.

Dangerous for persistence/API.

## 6.3 compareTo

Natural order is declaration order.

```java
CaseStatus.DRAFT.compareTo(CaseStatus.CLOSED)
```

But declaration order may not be domain rank. Use explicit rank if needed.

## 6.4 getDeclaringClass

Useful in generic enum code.

```java
status.getDeclaringClass()
```

---

# 7. Enum Constants adalah Singleton Instances

Each enum constant is a singleton instance.

```java
CaseStatus a = CaseStatus.CLOSED;
CaseStatus b = CaseStatus.CLOSED;

a == b // true
```

## 7.1 No public constructor

Cannot create another `CLOSED`.

## 7.2 Serialization preserves singleton

Java enum serialization has special handling to preserve enum identity by name.

## 7.3 Reflection restrictions

Java prevents reflective creation of enum constants in normal reflection APIs.

## 7.4 Classloader caveat

Enum singleton is per enum class loaded by a classloader. In complex classloader systems, same class name loaded by different classloaders is different type.

Usually not a normal application concern, but relevant for plugins/app servers.

---

# 8. Equality: Kenapa `==` Tepat untuk Enum

For enum:

```java
status == CaseStatus.CLOSED
```

is correct.

Why?

- constants are singleton;
- enum equals is final identity equality;
- `==` is null-safe when variable might be null.

Example:

```java
CaseStatus status = null;

if (status == CaseStatus.CLOSED) {
    ...
}
```

No NPE.

But:

```java
status.equals(CaseStatus.CLOSED)
```

would throw NPE if status null.

## 8.1 Use `==` for enum

Best practice:

```java
if (status == CaseStatus.CLOSED) {}
```

## 8.2 Use switch

Often better:

```java
return switch (status) {
    case DRAFT -> ...
    case CLOSED -> ...
};
```

## 8.3 Null enum in switch

Switch on null can throw NPE unless using modern pattern switch with `case null` where supported.

Prefer non-null enum fields.

---

# 9. `name()`, `toString()`, dan `ordinal()`

## 9.1 name()

Returns declared name.

```java
CaseStatus.UNDER_REVIEW.name() // "UNDER_REVIEW"
```

Good for stable internal representation if you commit to not renaming.

## 9.2 toString()

Default `toString()` returns `name()`.

But enum can override `toString`.

```java
enum CaseStatus {
    UNDER_REVIEW;

    @Override
    public String toString() {
        return "Under review";
    }
}
```

Then:

```java
status.toString() // "Under review"
status.name()     // "UNDER_REVIEW"
```

## 9.3 Do not use toString for persistence/API

Because someone may override it for display.

Use explicit code:

```java
status.code()
```

or `name()` if accepted as external contract.

## 9.4 ordinal()

Declaration position.

```java
DRAFT.ordinal() // 0
SUBMITTED.ordinal() // 1
```

Should almost never be used outside low-level optimized structures.

## 9.5 Declaration order

Changing order changes ordinal and compareTo natural order.

Do not make business rank depend implicitly on declaration order unless consciously controlled.

Prefer explicit rank:

```java
HIGH(30)
```

---

# 10. Jangan Persist/Expose `ordinal`

This is critical.

Bad:

```java
status.ordinal()
```

stored in database:

```text
0 = DRAFT
1 = SUBMITTED
2 = CLOSED
```

If enum later becomes:

```java
DRAFT,
IN_REVIEW,
SUBMITTED,
CLOSED
```

all persisted ordinals shift.

Production data corrupts semantically.

## 10.1 Database bad example

```sql
status_ordinal INTEGER NOT NULL
```

Bad if it stores ordinal.

## 10.2 API bad example

```json
{ "status": 2 }
```

If 2 means CLOSED today, could mean something else after reorder.

## 10.3 Use name or explicit code

Better:

```json
{ "status": "CLOSED" }
```

or:

```json
{ "status": "CLS" }
```

with explicit mapping.

DB:

```sql
status_code VARCHAR(32) NOT NULL
```

## 10.4 If external code must be numeric

Use explicit stable code:

```java
enum Status {
    DRAFT(10),
    SUBMITTED(20),
    CLOSED(90);

    private final int code;
}
```

Never use ordinal.

## 10.5 Migration

If ordinal already persisted:

1. freeze current mapping;
2. create explicit code column;
3. backfill based on old ordinal mapping;
4. update app to use code;
5. remove ordinal later.

---

# 11. Enum Fields, Constructor, dan Methods

Enum constants can hold data.

```java
public enum HttpStatusFamily {
    INFORMATIONAL(100, 199),
    SUCCESSFUL(200, 299),
    REDIRECTION(300, 399),
    CLIENT_ERROR(400, 499),
    SERVER_ERROR(500, 599);

    private final int min;
    private final int max;

    HttpStatusFamily(int min, int max) {
        this.min = min;
        this.max = max;
    }

    public boolean contains(int code) {
        return code >= min && code <= max;
    }
}
```

## 11.1 Fields should be final

Enum constants are singleton and shared globally. Mutable fields in enum are dangerous.

Good:

```java
private final String code;
```

Avoid:

```java
private int counter;
```

unless you really understand global mutable singleton state.

## 11.2 Constructor cannot access static non-constant fields safely

Enum initialization order has restrictions. Avoid complex initialization in enum constructors.

## 11.3 Method behavior

```java
RiskLevel.HIGH.rank()
```

is clear.

## 11.4 Static lookup map

For parsing by code:

```java
private static final Map<String, CaseStatus> BY_CODE =
    Arrays.stream(values()).collect(Collectors.toUnmodifiableMap(CaseStatus::code, Function.identity()));
```

Be careful with duplicate codes; collector will throw.

---

# 12. Enum dengan External Code

Often external code differs from Java constant name.

```java
public enum CaseStatus {
    DRAFT("D"),
    SUBMITTED("S"),
    UNDER_REVIEW("UR"),
    CLOSED("C"),
    REJECTED("R");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }
}
```

## 12.1 Why use code?

- external API compatibility;
- shorter DB storage;
- legacy integration;
- stable even if Java name changes;
- user-friendly external contract.

## 12.2 Lookup by code

```java
public enum CaseStatus {
    DRAFT("D"),
    SUBMITTED("S"),
    UNDER_REVIEW("UR"),
    CLOSED("C"),
    REJECTED("R");

    private static final Map<String, CaseStatus> BY_CODE =
        Arrays.stream(values())
            .collect(Collectors.toUnmodifiableMap(CaseStatus::code, Function.identity()));

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static Optional<CaseStatus> fromCode(String code) {
        return Optional.ofNullable(BY_CODE.get(code));
    }
}
```

## 12.3 Normalize input

If code is case-insensitive:

```java
String normalized = code.strip().toUpperCase(Locale.ROOT);
```

But if external code is case-sensitive, do not normalize silently.

## 12.4 Unknown code handling

Do not blindly:

```java
CaseStatus.valueOf(input)
```

for external input.

Use parser returning result/Optional/validation error.

## 12.5 Duplicate code protection

Static map creation should fail on duplicate code.

This is good: duplicate code is developer error.

---

# 13. Parsing Enum dari String/API

## 13.1 `valueOf`

```java
CaseStatus.valueOf("CLOSED")
```

Requirements:

- exact enum constant name;
- case-sensitive;
- throws `IllegalArgumentException` if invalid;
- throws NPE if name null.

## 13.2 Good for internal trusted strings?

Maybe.

But for external API, prefer explicit parsing.

## 13.3 Safe parser

```java
public static Optional<CaseStatus> parse(String value) {
    if (value == null || value.isBlank()) {
        return Optional.empty();
    }

    String normalized = value.strip().toUpperCase(Locale.ROOT);

    try {
        return Optional.of(CaseStatus.valueOf(normalized));
    } catch (IllegalArgumentException ex) {
        return Optional.empty();
    }
}
```

## 13.4 Better parser with error

Optional loses reason. For API validation:

```java
sealed interface ParseStatusResult permits ParsedStatus, InvalidStatus {}

record ParsedStatus(CaseStatus status) implements ParseStatusResult {}
record InvalidStatus(String input, List<String> allowedValues) implements ParseStatusResult {}
```

## 13.5 External code parser

```java
public static CaseStatus requireFromCode(String code) {
    return fromCode(code)
        .orElseThrow(() -> new IllegalArgumentException("Unknown case status code: " + code));
}
```

Map exception to API validation response.

## 13.6 Do not parse display label

Display labels can be localized/change. Parse stable code/name only.

---

# 14. Enum dan `switch`

Enum works naturally with `switch`.

```java
return switch (status) {
    case DRAFT -> "Draft";
    case SUBMITTED -> "Submitted";
    case CLOSED -> "Closed";
    case REJECTED -> "Rejected";
};
```

## 14.1 Exhaustiveness

For switch expressions, compiler requires result for every path.

If all enum constants handled, no default needed.

This is good because adding enum constant can cause compile error where switch is exhaustive.

## 14.2 Default hides evolution

```java
return switch (status) {
    case DRAFT -> ...
    case CLOSED -> ...
    default -> ...
};
```

If new status added, default catches it silently.

Sometimes desired for external compatibility; often bad for domain logic.

## 14.3 Domain switch should be exhaustive

Prefer no default in core domain if all constants should be handled.

## 14.4 Boundary switch may need unknown/default

At API boundary, unknown external enum value might need:

- reject;
- map to `UNKNOWN`;
- forward-compatible handling.

Different from internal domain.

## 14.5 Null

Classic switch on null throws NPE.

Avoid nullable enum or handle before switch.

Modern pattern matching switch can support `case null` in certain contexts, but non-null domain type is still cleaner.

---

# 15. Exhaustiveness dan Evolution Risk

Adding enum constant is source-compatible in some places but behavior-compatible risk.

Example:

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    CLOSED
}
```

Later:

```java
REOPENED
```

Every switch, DB mapping, API schema, frontend, report, and workflow may need update.

## 15.1 Compile-time help

Switch expressions without default can reveal missing handling.

## 15.2 Runtime risk

External clients may not know new value.

Example:

```json
{ "status": "REOPENED" }
```

Old client may crash.

## 15.3 Compatibility plan

Before adding enum constant:

- update API schema;
- update DB constraints;
- update frontend;
- update event consumers;
- update analytics/reporting;
- update switch logic;
- update tests;
- update documentation;
- consider feature flag/rollout.

## 15.4 Unknown external value

For integration with external systems, consider `UNKNOWN` or raw-code wrapper.

But `UNKNOWN` inside core domain can hide errors.

## 15.5 Internal vs external enum

Sometimes separate:

```java
ExternalCaseStatusDto
DomainCaseStatus
```

to isolate compatibility.

---

# 16. Constant-Specific Class Body

Each enum constant can override methods.

```java
public enum Operation {
    ADD {
        @Override
        int apply(int a, int b) {
            return a + b;
        }
    },
    MULTIPLY {
        @Override
        int apply(int a, int b) {
            return a * b;
        }
    };

    abstract int apply(int a, int b);
}
```

## 16.1 Benefits

- avoids switch;
- behavior close to constant;
- simple strategy;
- exhaustive by enum constants.

## 16.2 Risks

- enum becomes too smart;
- hard to inject dependencies;
- hard to test with mocks;
- violates separation if behavior large;
- adding complex state to singleton constants dangerous.

## 16.3 Good use

Simple pure behavior:

```java
SortDirection.ASC.apply(...)
SortDirection.DESC.apply(...)
```

## 16.4 Bad use

Business process with database, services, side effects:

```java
APPROVE {
    void execute(CaseService service, Repository repo, ...) { ... }
}
```

This makes enum a service locator/strategy container.

Use separate strategy classes if behavior complex.

---

# 17. Enum sebagai Strategy: Kapan Bagus, Kapan Berbahaya

## 17.1 Good enum strategy

```java
enum RoundingPolicy {
    HALF_UP {
        BigDecimal round(BigDecimal value, int scale) {
            return value.setScale(scale, RoundingMode.HALF_UP);
        }
    },
    HALF_EVEN {
        BigDecimal round(BigDecimal value, int scale) {
            return value.setScale(scale, RoundingMode.HALF_EVEN);
        }
    };

    abstract BigDecimal round(BigDecimal value, int scale);
}
```

Pure, simple, no dependencies.

## 17.2 Bad enum strategy

```java
enum NotificationChannel {
    EMAIL {
        void send(User user, Message message) {
            smtpClient.send(...); // where from?
        }
    }
}
```

This creates dependency issues.

Better:

```java
interface NotificationSender {
    void send(User user, Message message);
}

Map<NotificationChannel, NotificationSender> senders;
```

Use `EnumMap`.

## 17.3 Enum as key to strategy map

```java
EnumMap<NotificationChannel, NotificationSender> senders =
    new EnumMap<>(NotificationChannel.class);
```

This separates type-safe key from injected behavior.

## 17.4 Rule

Enum behavior should be:

- pure;
- small;
- dependency-free;
- stable.

Complex workflows belong in services/policies.

---

# 18. `EnumSet`: Set Khusus Enum

`EnumSet<E extends Enum<E>>` is specialized Set implementation for enum types.

```java
EnumSet<Permission> permissions = EnumSet.of(Permission.READ, Permission.WRITE);
```

## 18.1 Why EnumSet?

- compact;
- efficient;
- type-safe;
- no duplicates;
- no null elements;
- uses bit-vector style internally conceptually.

## 18.2 Common operations

```java
EnumSet.noneOf(Permission.class)
EnumSet.allOf(Permission.class)
EnumSet.of(Permission.READ, Permission.WRITE)
EnumSet.complementOf(existing)
EnumSet.range(LOW, HIGH)
```

## 18.3 Better than boolean flags

Bad:

```java
boolean canRead;
boolean canWrite;
boolean canDelete;
```

Better:

```java
EnumSet<Permission> permissions;
```

## 18.4 Better than Set<Enum>?

Usually yes:

```java
Set<Permission> permissions = EnumSet.of(...)
```

You can expose as `Set<Permission>` but construct with EnumSet.

## 18.5 Mutability

EnumSet is mutable unless wrapped/copied.

For immutable exposure:

```java
Set.copyOf(enumSet)
```

or defensive copy:

```java
EnumSet.copyOf(enumSet)
```

Be careful: `Set.copyOf` may not preserve EnumSet implementation, but exposes unmodifiable Set.

## 18.6 Empty copy trap

`EnumSet.copyOf(Collection)` needs non-empty collection if not already EnumSet because it needs enum type.

Use:

```java
EnumSet.noneOf(Permission.class)
```

for empty.

---

# 19. `EnumMap`: Map Khusus Enum

`EnumMap<K extends Enum<K>, V>` is specialized Map for enum keys.

```java
EnumMap<CaseStatus, CaseHandler> handlers =
    new EnumMap<>(CaseStatus.class);
```

## 19.1 Why EnumMap?

- compact;
- efficient;
- type-safe keys;
- natural enum order iteration;
- better than HashMap for enum keys.

## 19.2 Strategy dispatch

```java
EnumMap<NotificationChannel, NotificationSender> senders =
    new EnumMap<>(NotificationChannel.class);

senders.put(NotificationChannel.EMAIL, emailSender);
senders.put(NotificationChannel.SMS, smsSender);
```

## 19.3 Missing key handling

```java
NotificationSender sender = senders.get(channel);
if (sender == null) {
    throw new IllegalStateException("No sender for " + channel);
}
```

But if map allows null values, `get` null ambiguous.

Prefer non-null values and validation:

```java
for (NotificationChannel channel : NotificationChannel.values()) {
    Objects.requireNonNull(senders.get(channel), "Missing sender: " + channel);
}
```

## 19.4 EnumMap and null

EnumMap does not permit null keys. It may permit null values.

Avoid null values.

## 19.5 Exhaustive map

For strategies, validate all enum constants covered at startup.

---

# 20. Enum vs `String` Status

## 20.1 String status

```java
String status = "CLOSED";
```

Problems:

- typo;
- case mismatch;
- invalid values;
- scattered parsing;
- no exhaustiveness;
- weak refactoring;
- no type distinction.

## 20.2 Enum status

```java
CaseStatus status = CaseStatus.CLOSED;
```

Benefits:

- type-safe;
- compiler knows all values;
- switch exhaustiveness;
- IDE autocomplete;
- no typo values;
- better domain language.

## 20.3 Boundary still string

External APIs usually send string.

DTO:

```java
record CaseResponse(String status) {}
```

Map:

```java
status.code()
```

or configure JSON mapper carefully.

## 20.4 Do not leak display labels

API should send stable code/name, not localized label.

Display label belongs to UI/i18n.

---

# 21. Enum vs `int` Code

## 21.1 int code

```java
int status = 3;
```

Problems:

- magic number;
- invalid values;
- no domain language;
- no exhaustiveness;
- easy mix-up.

## 21.2 Enum with explicit int code

If external system uses numeric code:

```java
enum Status {
    DRAFT(10),
    CLOSED(90);

    private final int code;
}
```

This is acceptable because code is explicit and stable.

## 21.3 Avoid ordinal

Again:

```java
status.ordinal()
```

is not explicit code.

## 21.4 Database check constraints

If storing numeric code, add DB constraint or reference table.

```sql
CHECK (status_code IN (10, 20, 90))
```

But schema migration needed when adding codes.

---

# 22. Enum vs Boolean Flags

## 22.1 Two booleans create impossible state

```java
boolean approved;
boolean rejected;
```

Allows:

```text
approved=true, rejected=true
```

## 22.2 Enum

```java
enum ApprovalStatus {
    PENDING,
    APPROVED,
    REJECTED
}
```

Now exactly one state.

## 22.3 More flags

```java
boolean draft;
boolean submitted;
boolean closed;
boolean rejected;
```

Replace with:

```java
CaseStatus
```

## 22.4 Independent flags

If flags are independent permissions:

```java
READ, WRITE, DELETE
```

Use `EnumSet<Permission>`.

## 22.5 State-specific data

If approved/rejected have different data, enum may not be enough. Use sealed type.

---

# 23. Enum vs Sealed Type

Enum represents closed set of constants with same shape.

Sealed type represents closed set of subtypes, each can have different data.

## 23.1 Enum good

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    CLOSED
}
```

Status only label/state.

## 23.2 Sealed type better

```java
sealed interface CaseState permits Draft, Submitted, Closed, Rejected {}

record Draft() implements CaseState {}
record Submitted(Instant submittedAt, OfficerId submittedBy) implements CaseState {}
record Closed(Instant closedAt, OfficerId closedBy, ClosureReason reason) implements CaseState {}
record Rejected(Instant rejectedAt, OfficerId rejectedBy, RejectionReason reason) implements CaseState {}
```

Each state has different required data.

## 23.3 Enum plus separate nullable fields smell

Bad:

```java
CaseStatus status;
Instant closedAt;       // null unless closed
String rejectionReason; // null unless rejected
```

This suggests sealed state.

## 23.4 Enum can still be projection

You may derive status enum from sealed state for API/reporting:

```java
CaseStatus status() {
    return switch (state) {
        case Draft d -> CaseStatus.DRAFT;
        case Closed c -> CaseStatus.CLOSED;
        ...
    };
}
```

## 23.5 Rule

Use enum when constants are same shape.

Use sealed type when alternatives carry different data/behavior/invariants.

---

# 24. Enum untuk State Machine

Enum is common for simple state machine.

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    CLOSED,
    REJECTED
}
```

## 24.1 Transition validation

```java
boolean canTransitionTo(CaseStatus target) {
    return switch (this) {
        case DRAFT -> target == SUBMITTED;
        case SUBMITTED -> target == UNDER_REVIEW || target == REJECTED;
        case UNDER_REVIEW -> target == CLOSED || target == REJECTED;
        case CLOSED, REJECTED -> false;
    };
}
```

## 24.2 Transition matrix

For more complex logic, use EnumMap:

```java
EnumMap<CaseStatus, EnumSet<CaseStatus>> allowedTransitions;
```

## 24.3 Transition as behavior

```java
caseRecord.submit(command);
caseRecord.close(command);
```

Better than arbitrary:

```java
caseRecord.setStatus(CLOSED);
```

## 24.4 Audit

State transition should produce event:

```java
CaseStatusChanged(from, to, actor, reason, occurredAt)
```

## 24.5 Complex state

If transitions require state-specific data and invariants, sealed type may be better.

---

# 25. Enum di Domain Model

## 25.1 Good domain enum examples

```java
CaseStatus
RiskLevel
NotificationChannel
Permission
SortDirection
ReviewOutcome
DocumentType
```

## 25.2 Bad enum examples

Enums that change too often due database content/user config:

```java
ProductCategory
Country
Currency?
```

Currency already has `java.util.Currency`. Country/code lists may be external reference data.

## 25.3 Data-driven categories

If business users can add category without deployment, enum is wrong.

Use reference table/config/domain entity.

## 25.4 Enum deployment coupling

Adding enum constant requires code deployment and compatibility updates.

Fine for stable technical/domain concepts. Bad for user-managed taxonomy.

## 25.5 Keep enum cohesive

Do not create giant enum with unrelated constants.

```java
enum Code {
    CASE_DRAFT,
    PAYMENT_FAILED,
    USER_ADMIN,
    EMAIL
}
```

Split by domain.

---

# 26. Enum di API/JSON

## 26.1 Default JSON mapping

Many Java JSON libraries serialize enum as name by default:

```json
"CLOSED"
```

But behavior is library/config-specific.

## 26.2 Stable external code

Prefer explicit DTO field:

```java
record CaseResponse(String status) {
    static CaseResponse from(Case c) {
        return new CaseResponse(c.status().code());
    }
}
```

## 26.3 Avoid exposing toString

Do not configure API to serialize `toString()` unless deliberate. Display text can change/localize.

## 26.4 Unknown enum value

When reading from API:

- reject invalid value with validation error;
- optionally map unknown to external wrapper for forward compatibility;
- do not silently default to DRAFT/CLOSED.

## 26.5 OpenAPI

Document allowed values.

```yaml
status:
  type: string
  enum: [DRAFT, SUBMITTED, UNDER_REVIEW, CLOSED, REJECTED]
```

## 26.6 Adding enum value is API change

It can break clients that assume exhaustive set.

Communicate and version if needed.

---

# 27. Enum di Database

## 27.1 Store string name/code

Recommended:

```sql
status_code VARCHAR(32) NOT NULL
```

Values:

```text
DRAFT
SUBMITTED
CLOSED
```

or explicit code:

```text
D
S
C
```

## 27.2 Avoid ordinal

Do not store:

```sql
status_ordinal INTEGER
```

unless it is explicit stable code, not ordinal.

## 27.3 DB constraint

```sql
CHECK (status_code IN ('DRAFT', 'SUBMITTED', 'CLOSED'))
```

Pros:

- prevents invalid DB values.

Cons:

- schema migration needed when adding enum value.

## 27.4 Lookup/reference table

For more dynamic or metadata-heavy codes:

```sql
case_status(code, label, active, sort_order)
```

Then maybe not Java enum or use enum for stable subset.

## 27.5 ORM mapping

JPA has enum mapping strategies:

- `EnumType.STRING`;
- `EnumType.ORDINAL`.

Prefer STRING over ORDINAL.

But for explicit code mapping, use AttributeConverter.

## 27.6 Database values and Java names

If Java enum constant renamed, DB values may break if using name.

Explicit code can decouple.

---

# 28. Enum di Kafka/Event Schema

## 28.1 Event value compatibility

Events persist longer and have many consumers.

Adding enum value can break old consumers.

## 28.2 Schema

If using schema system, enum evolution rules matter.

Some systems handle enum additions differently.

## 28.3 Safer pattern

For external events, sometimes use string code with documentation rather than schema enum if forward compatibility is important.

Consumer should handle unknown codes.

## 28.4 Domain internal enum

Producer domain can use enum internally, then serialize to code.

## 28.5 Consumer handling

Do not crash entire consumer on unknown enum if event stream can contain newer values.

Options:

- route to DLQ;
- map to UNKNOWN external representation;
- skip with alert;
- fail fast depending criticality.

## 28.6 Audit event

Status transition event:

```json
{
  "fromStatus": "UNDER_REVIEW",
  "toStatus": "CLOSED",
  "reasonCode": "EVIDENCE_SUFFICIENT"
}
```

Stable codes, not ordinals.

---

# 29. Enum dan Backward/Forward Compatibility

## 29.1 Adding value

Internal code:

- switch exhaustiveness;
- tests;
- state machines;
- EnumMap coverage;
- DB constraints;
- API docs;
- frontend display.

External clients:

- old clients may not recognize new value.

## 29.2 Removing value

Dangerous if persisted data/events still contain old value.

Better:

- deprecate;
- stop producing;
- keep reading;
- migrate data;
- remove later.

## 29.3 Renaming value

If external representation uses `name()`, rename is breaking.

Use explicit code to allow Java rename without external change.

## 29.4 Reordering value

Safe if not using ordinal/natural order for business.

Unsafe if ordinal persisted or compareTo declaration order used.

## 29.5 Compatibility checklist

Before enum change:

- Is value persisted?
- Is value serialized?
- Is value in API schema?
- Is value in event schema?
- Do clients switch exhaustively?
- Is ordinal used anywhere?
- Is declaration order used?
- Are DB constraints updated?
- Are EnumMaps exhaustive?
- Is UI label added?
- Are reports updated?

---

# 30. Enum dan Localization/Display Label

Enum constant is not user-facing label.

Bad:

```java
status.toString()
```

as display.

Better:

```java
messageSource.getMessage("case.status." + status.code(), locale)
```

or frontend i18n.

## 30.1 Store code, render label

Data:

```text
UNDER_REVIEW
```

Display:

```text
Under review
Dalam peninjauan
```

depending locale.

## 30.2 Enum field displayName?

```java
UNDER_REVIEW("Under review")
```

Might be okay for internal admin English-only UI, but not scalable for localization.

## 30.3 Do not parse label

Do not accept localized label as input.

Use stable code.

## 30.4 Label changes

Label can change without data migration if label not persisted.

---

# 31. Enum dan Testing

## 31.1 Exhaustive tests

Test all constants:

```java
for (CaseStatus status : CaseStatus.values()) {
    assertThat(status.code()).isNotBlank();
}
```

## 31.2 Parser round-trip

```java
for (CaseStatus status : CaseStatus.values()) {
    assertThat(CaseStatus.fromCode(status.code())).contains(status);
}
```

## 31.3 Duplicate code test

Static map may already fail, but test explicit.

## 31.4 Switch coverage

Use switch expression without default in core logic to get compile-time help.

## 31.5 EnumMap coverage

```java
assertThat(handlers.keySet()).containsExactlyInAnyOrder(CaseStatus.values());
```

## 31.6 Serialization compatibility tests

Golden JSON/event tests:

```json
"UNDER_REVIEW"
```

to ensure external code stable.

## 31.7 DB mapping tests

Test converter:

```java
status -> db code -> status
```

---

# 32. Production Failure Modes

## 32.1 Persisted ordinal corruption

Enum reordered, DB values now point to wrong status.

Fix:

- never use ordinal;
- migrate to explicit code.

## 32.2 API client breaks on new enum

New enum constant returned; old client has exhaustive switch and crashes.

Fix:

- versioning/communication;
- unknown handling;
- compatibility policy.

## 32.3 `valueOf` on external input throws

Bad request produces 500.

Fix:

- validate and map to 400;
- safe parser.

## 32.4 `toString` used as stable code

Developer overrides toString for display; API/DB changes accidentally.

Fix:

- use explicit `code()`;
- never persist/display parse `toString`.

## 32.5 EnumMap missing handler

New enum constant added but strategy map not updated.

Fix:

- startup coverage validation;
- tests over `values()`.

## 32.6 Boolean flags impossible state

Multiple booleans allow contradictory state.

Fix:

- enum/sealed type.

## 32.7 Enum used for dynamic business taxonomy

Business wants add category without deploy.

Fix:

- reference data table/config/entity.

## 32.8 Natural order used as rank

Enum declaration order changed; sorting/ranking changes.

Fix:

- explicit rank field.

## 32.9 Null enum NPE

Switch or method call on null enum.

Fix:

- non-null invariant;
- validation;
- explicit UNKNOWN/absence modeling if domain requires.

## 32.10 Unknown event enum kills consumer

Consumer uses `valueOf` and throws on newer producer value.

Fix:

- tolerant parser at boundary;
- DLQ/alert policy;
- schema evolution plan.

---

# 33. Best Practices

## 33.1 General

- Use enum for stable closed set values.
- Use `==` for enum comparison.
- Do not persist/expose `ordinal`.
- Do not use `toString` as stable external representation.
- Use explicit `code()` for API/DB/events if compatibility matters.
- Use safe parser for external input.
- Use switch expression without default in core logic when exhaustive handling desired.
- Use `EnumSet` for sets of enum.
- Use `EnumMap` for enum-keyed maps/strategies.
- Validate EnumMap coverage at startup.
- Use explicit rank, not ordinal, for business ordering.
- Do not put mutable state in enum constants.
- Do not use enum for dynamic reference data.
- Use sealed type when each alternative has different data/invariants.

## 33.2 Boundary

- DTO may use string code.
- Domain uses enum.
- Mapping layer converts and validates.
- Unknown external value should become validation error or explicit unknown handling.
- Database stores code/name, not ordinal.
- Events use stable codes and compatibility policy.

## 33.3 Display

- Do not use enum name as UI label by default.
- Localize via message keys.
- Parse stable code, not display label.

## 33.4 Evolution

- Treat enum value addition as compatibility event.
- Update switches, maps, DB constraints, API docs, UI labels, tests.
- Keep reading deprecated values until data/events fully migrated.

---

# 34. Decision Matrix

| Situation | Use enum? | Better option if not |
|---|---:|---|
| stable status set | yes | sealed if state-specific data |
| permission set | yes + EnumSet | policy object if dynamic |
| sort direction ASC/DESC | yes | n/a |
| HTTP method | yes/well-known enum | string if extension methods accepted |
| country list | usually no | reference data/library |
| currency | use `Currency` | n/a |
| product category user-managed | no | DB reference table |
| dynamic workflow steps | no | state table/config |
| boolean approved/rejected | yes | sealed decision if reason data |
| API external value | domain enum + string code DTO | open string wrapper if forward-compatible |
| strategy with pure small behavior | yes | service strategy map if dependencies |
| handler per enum | yes + EnumMap | DI map |
| state with different fields | no | sealed type |
| business rank/order | enum with explicit rank | reference data |
| persisted representation | enum with explicit code | lookup table |

---

# 35. Latihan

## Latihan 1 — Replace String Status

Refactor:

```java
String status;
if ("CLOSED".equals(status)) {}
```

to:

```java
enum CaseStatus
```

and update switch.

## Latihan 2 — External Code

Create enum:

```java
CaseStatus(DRAFT="D", SUBMITTED="S", CLOSED="C")
```

Implement:

```java
String code()
Optional<CaseStatus> fromCode(String code)
```

## Latihan 3 — No Ordinal

Simulate DB storing ordinal. Reorder enum constants and show corruption.

Then migrate to explicit code.

## Latihan 4 — EnumMap Strategy

Create:

```java
EnumMap<NotificationChannel, NotificationSender>
```

Validate every channel has sender.

## Latihan 5 — EnumSet Permission

Refactor:

```java
boolean canRead;
boolean canWrite;
boolean canDelete;
```

to:

```java
EnumSet<Permission>
```

## Latihan 6 — Switch Exhaustiveness

Write switch expression over enum without default. Add new constant. Observe compile error.

## Latihan 7 — Enum vs Sealed

Model approval as enum first:

```java
PENDING, APPROVED, REJECTED
```

Then refactor to sealed type where APPROVED and REJECTED require actor/time/reason.

## Latihan 8 — Parser Error

Implement parser that returns validation error with allowed values instead of throwing raw `IllegalArgumentException`.

## Latihan 9 — Rank

Create enum `Severity` with explicit rank. Sort list by rank descending.

Do not use ordinal.

## Latihan 10 — Localization

Create message keys:

```text
case.status.DRAFT
case.status.CLOSED
```

and show why enum name is data code, not display label.

---

# 36. Ringkasan

Enum adalah type-safe closed set of constants.

Gunakan enum untuk mengganti:

```text
String status
int magic code
multiple mutually exclusive booleans
```

Hal penting:

- Enum adalah reference type/class khusus.
- Semua enum extend `java.lang.Enum`.
- Enum constants adalah singleton instances.
- `==` tepat untuk enum comparison.
- `name()` adalah declared name.
- `toString()` bisa berubah/override.
- `ordinal()` adalah declaration position dan tidak boleh dipersist/expose.
- Gunakan explicit code untuk DB/API/event.
- Gunakan `EnumSet` untuk set enum.
- Gunakan `EnumMap` untuk map/strategy by enum.
- Gunakan switch expression untuk exhaustiveness.
- Tambah enum constant bisa breaking untuk API/events/clients.
- Jangan pakai enum untuk dynamic taxonomy yang harus berubah tanpa deployment.
- Gunakan sealed type jika setiap alternatif punya data berbeda.

Senior Java engineer tidak memakai enum hanya sebagai “daftar konstanta”, tetapi sebagai alat modeling untuk menutup ruang invalid values, membuat compiler membantu, dan menjaga compatibility antar boundary.

---

# 37. Referensi

1. Java Language Specification SE 25 — Enum Classes  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html#jls-8.9

2. Java SE 25 API — `Enum`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Enum.html

3. Java SE 25 API — `EnumSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumSet.html

4. Java SE 25 API — `EnumMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumMap.html

5. Java Language Specification SE 25 — Switch Expressions and Statements  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-14.html#jls-14.11

6. Java SE 25 API — `IllegalArgumentException`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/IllegalArgumentException.html

7. Java SE 25 API — `Currency`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Currency.html
