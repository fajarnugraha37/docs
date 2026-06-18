# learn-java-data-types-part-019.md

# Java Data Types — Part 019  
# Domain-Specific Types: Typed ID, Money, Email, Name, Status, Reason, dan Value Object Design

> Seri: **Advanced Java Data Types**  
> Bagian: **019**  
> Fokus: mengubah primitive/reference/raw `String` menjadi domain-specific types yang membawa makna, invariant, validation, canonicalization, equality, serialization policy, dan boundary mapping. Materi ini membahas typed ID, Money, Email, Name, Status, Reason, Code, Quantity, Percentage, Version, Range, dan bagaimana type design mencegah primitive obsession/stringly typed code di production.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Masalah: Primitive Obsession dan Stringly Typed Code](#2-masalah-primitive-obsession-dan-stringly-typed-code)
3. [Mental Model: Type = Meaning + Invariant + Operation + Boundary](#3-mental-model-type--meaning--invariant--operation--boundary)
4. [Apa Itu Domain-Specific Type](#4-apa-itu-domain-specific-type)
5. [Value Object vs Entity](#5-value-object-vs-entity)
6. [Records sebagai Value Object](#6-records-sebagai-value-object)
7. [Typed ID](#7-typed-id)
8. [ID Berbasis `String`, `UUID`, `long`, dan Composite ID](#8-id-berbasis-string-uuid-long-dan-composite-id)
9. [Money](#9-money)
10. [Currency dan Minor Units](#10-currency-dan-minor-units)
11. [Quantity dan Unit of Measure](#11-quantity-dan-unit-of-measure)
12. [Percentage, Ratio, Rate, dan Basis Points](#12-percentage-ratio-rate-dan-basis-points)
13. [Email Address](#13-email-address)
14. [Name dan Human Text](#14-name-dan-human-text)
15. [Status, Type, Code, dan Enum](#15-status-type-code-dan-enum)
16. [Reason, Comment, dan Free Text](#16-reason-comment-dan-free-text)
17. [Version, Sequence, dan Optimistic Lock](#17-version-sequence-dan-optimistic-lock)
18. [Date/Time Domain Types](#18-datetime-domain-types)
19. [Range Types](#19-range-types)
20. [Security-Sensitive Types](#20-security-sensitive-types)
21. [Canonicalization dan Normalization](#21-canonicalization-dan-normalization)
22. [Validation Strategy](#22-validation-strategy)
23. [Constructor vs Factory Method](#23-constructor-vs-factory-method)
24. [Exception vs Result dalam Parsing](#24-exception-vs-result-dalam-parsing)
25. [Equality dan Hashing](#25-equality-dan-hashing)
26. [Ordering dan Comparable](#26-ordering-dan-comparable)
27. [Serialization Boundary](#27-serialization-boundary)
28. [Database Mapping](#28-database-mapping)
29. [JSON/API Mapping](#29-jsonapi-mapping)
30. [Framework Integration](#30-framework-integration)
31. [When Not to Create a Domain Type](#31-when-not-to-create-a-domain-type)
32. [Refactoring Primitive Obsession](#32-refactoring-primitive-obsession)
33. [Production Failure Modes](#33-production-failure-modes)
34. [Best Practices](#34-best-practices)
35. [Decision Matrix](#35-decision-matrix)
36. [Latihan](#36-latihan)
37. [Ringkasan](#37-ringkasan)
38. [Referensi](#38-referensi)

---

# 1. Tujuan Bagian Ini

Sampai sekarang kita sudah membahas banyak Java data types:

- primitive;
- wrapper;
- `String`;
- enum;
- records;
- sealed types;
- collections;
- Optional;
- date/time.

Sekarang kita masuk ke pertanyaan paling penting untuk engineer senior:

```text
Bagaimana memilih dan membuat type yang benar untuk domain?
```

Contoh raw primitive/string code:

```java
void assign(String caseId, String officerId, String reason, BigDecimal amount, String currency) {
    ...
}
```

Masalah:

```java
assign(officerId, caseId, currency, amount, reason); // bisa compile jika semua String
```

Lebih baik:

```java
void assign(
    CaseId caseId,
    OfficerId officerId,
    AssignmentReason reason,
    Money amount
) {
    ...
}
```

Sekarang compiler membantu.

Tujuan part ini:

- memahami domain-specific type;
- menghindari primitive obsession;
- membuat typed ID;
- membuat Money yang benar;
- membuat Email/Name/Reason/Code;
- memahami validation/canonicalization;
- memahami equality/serialization/database/API mapping;
- memahami kapan type baru membantu dan kapan over-engineering;
- membangun mental model agar desain data type lebih production-grade.

---

# 2. Masalah: Primitive Obsession dan Stringly Typed Code

Primitive obsession adalah kecenderungan memakai primitive/raw type untuk konsep domain yang punya makna lebih kaya.

## 2.1 Contoh primitive obsession

```java
String caseId;
String officerId;
String email;
String status;
String reason;
BigDecimal amount;
String currency;
int percentage;
long version;
```

Semua tampak sederhana, tetapi makna domain hilang.

## 2.2 Stringly typed code

```java
void transition(String status) {
    if ("CLOSED".equals(status)) {
        ...
    }
}
```

Masalah:

- typo compile;
- invalid value bisa lewat;
- no autocomplete;
- no exhaustive switch;
- parsing tersebar;
- validation duplikatif.

## 2.3 Parameter mix-up

```java
void assign(String caseId, String officerId) {}
```

Caller bisa salah:

```java
assign(officerId, caseId);
```

Compile sukses.

Dengan typed ID:

```java
void assign(CaseId caseId, OfficerId officerId) {}
```

Salah urutan akan compile error.

## 2.4 Validation scattered

```java
if (email.contains("@")) ...
if (email.length() <= 255) ...
if (email.trim().equals(email)) ...
```

Tersebar di banyak tempat.

Domain type centralizes validation:

```java
record EmailAddress(String value) { ... }
```

## 2.5 Boundary confusion

Raw string tidak memberi tahu:

```text
Apakah sudah normalized?
Apakah aman untuk log?
Apakah case-sensitive?
Apakah bisa blank?
Apakah format external atau internal?
```

Domain type bisa menyimpan policy.

---

# 3. Mental Model: Type = Meaning + Invariant + Operation + Boundary

Domain-specific type bukan wrapper kosong.

Type yang baik membawa:

```text
meaning
invariant
allowed operations
representation
boundary mapping
```

## 3.1 Meaning

```java
record CaseId(String value) {}
```

membedakan case ID dari officer ID.

## 3.2 Invariant

```java
value matches "CASE-[0-9]{6}"
```

## 3.3 Operation

```java
caseId.value()
money.add(other)
dateRange.contains(date)
percentage.asRatio()
```

## 3.4 Representation

Internal representation bisa:

- `String`;
- `UUID`;
- `long`;
- `BigDecimal`;
- `int basisPoints`;
- `LocalDate`;
- `Instant`.

## 3.5 Boundary mapping

Type tahu atau punya mapper untuk:

- JSON;
- database;
- logs;
- messages;
- UI display;
- command parsing.

## 3.6 Rule

Jangan membuat wrapper hanya demi wrapper.

Buat domain type ketika ada makna/invariant/operation/boundary yang layak dikunci.

---

# 4. Apa Itu Domain-Specific Type

Domain-specific type adalah type yang merepresentasikan konsep domain spesifik, bukan sekadar representation teknis.

Examples:

```java
CaseId
OfficerId
Money
EmailAddress
DisplayName
PolicyCode
RiskScore
Percentage
DateRange
BusinessDate
ClosureReason
Version
```

## 4.1 Type as language

Code menjadi bahasa domain:

```java
case.close(new ClosureReason("Evidence sufficient"), actorId, clock);
```

lebih jelas daripada:

```java
case.close("Evidence sufficient", "USR-123", Instant.now());
```

## 4.2 Type as compiler guard

Compiler mencegah mix-up.

## 4.3 Type as invariant boundary

Invalid value tidak bisa masuk jauh.

```java
new Percentage(BigDecimal.valueOf(150)) // throws
```

## 4.4 Type as documentation

Signature:

```java
Money calculateFee(PolicyCode policyCode, BusinessDate date)
```

lebih informatif daripada:

```java
BigDecimal calculateFee(String policyCode, LocalDate date)
```

## 4.5 Type as test target

Domain type punya unit tests sendiri.

---

# 5. Value Object vs Entity

## 5.1 Value Object

Value object identity based on value.

```java
record Money(BigDecimal amount, Currency currency) {}
record EmailAddress(String value) {}
record DateRange(LocalDate start, LocalDate end) {}
```

Two objects with same value are equivalent.

## 5.2 Entity

Entity identity persists across state changes.

```java
class CaseRecord {
    private final CaseId id;
    private CaseState state;
}
```

Two case objects with same ID may represent same entity even if state differs.

## 5.3 Domain-specific type often value object

Most types in this part are value objects.

## 5.4 Equality implication

Records generated equality works well for value objects if components have correct equality semantics.

For entities, record equality by all fields may be wrong.

## 5.5 Mutable value object is smell

Value objects should usually be immutable.

---

# 6. Records sebagai Value Object

Java records are excellent for many domain-specific value objects.

Java SE 25 `Record` API describes a record class as a shallowly immutable, transparent carrier for a fixed set of values called record components.

```java
public record CaseId(String value) {
    public CaseId {
        Objects.requireNonNull(value, "value");
        value = value.strip().toUpperCase(Locale.ROOT);
        if (!value.matches("CASE-[0-9]{6}")) {
            throw new IllegalArgumentException("Invalid case id");
        }
    }
}
```

## 6.1 Why record works

- concise;
- final;
- value equality;
- generated accessor;
- generated hashCode;
- clear state.

## 6.2 Shallow immutability caveat

Record with mutable component still dangerous.

```java
record Payload(byte[] bytes) {}
```

Need defensive copy and custom equals/hashCode.

## 6.3 Transparent carrier

If you do not want to expose representation, record may be wrong.

Example:

```java
record Password(String value)
```

might leak value through accessor/toString unless carefully overridden.

## 6.4 Constructor invariants

Compact constructor centralizes validation.

## 6.5 Alternative: final class

Use final class when:

- need hidden representation;
- custom equality;
- array/secret handling;
- many factories;
- complex invariants;
- no transparent access.

---

# 7. Typed ID

Typed ID is one of the highest ROI domain-specific types.

Bad:

```java
void assign(String caseId, String officerId) {}
```

Good:

```java
void assign(CaseId caseId, OfficerId officerId) {}
```

## 7.1 String-based typed ID

```java
public record CaseId(String value) {
    private static final Pattern PATTERN = Pattern.compile("CASE-[0-9]{6}");

    public CaseId {
        Objects.requireNonNull(value, "value");
        value = value.strip().toUpperCase(Locale.ROOT);

        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid CaseId: " + value);
        }
    }

    @Override
    public String toString() {
        return value;
    }
}
```

## 7.2 OfficerId

```java
public record OfficerId(String value) {
    private static final Pattern PATTERN = Pattern.compile("OFF-[A-Z0-9]{6,12}");

    public OfficerId {
        Objects.requireNonNull(value, "value");
        value = value.strip().toUpperCase(Locale.ROOT);

        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid OfficerId");
        }
    }
}
```

Now:

```java
assign(new CaseId("CASE-000001"), new OfficerId("OFF-ABC123"));
```

## 7.3 Type-safe map

```java
Map<CaseId, CaseRecord> casesById;
Map<OfficerId, Officer> officersById;
```

Cannot accidentally lookup officer map with case id.

## 7.4 Comparable ID?

If sorting meaningful:

```java
public record CaseId(String value) implements Comparable<CaseId> {
    @Override
    public int compareTo(CaseId other) {
        return this.value.compareTo(other.value);
    }
}
```

But only implement Comparable if natural order is domain-stable.

## 7.5 Generic Id<T> alternative

```java
record Id<T>(UUID value) {}
```

This prevents some mixups:

```java
Id<CaseRecord>
Id<Officer>
```

But concrete IDs are often clearer:

```java
CaseId
OfficerId
```

Use phantom generic IDs carefully.

---

# 8. ID Berbasis `String`, `UUID`, `long`, dan Composite ID

## 8.1 String ID

Pros:

- readable;
- can include prefix;
- easy external API;
- sortable if designed;
- integrates with legacy.

Cons:

- validation needed;
- storage size;
- case/canonicalization;
- typo risk without typed wrapper.

## 8.2 UUID ID

```java
public record UserId(UUID value) {
    public UserId {
        Objects.requireNonNull(value);
    }
}
```

Pros:

- globally unique-ish;
- common in distributed systems;
- supported in DBs.

Cons:

- not human-friendly;
- random UUID indexing concerns;
- version semantics.

## 8.3 long ID

```java
public record CaseDbId(long value) {
    public CaseDbId {
        if (value <= 0) throw new IllegalArgumentException();
    }
}
```

Pros:

- compact;
- DB-friendly;
- fast.

Cons:

- global uniqueness harder;
- exposes sequence if public;
- JavaScript precision issue if serialized as JSON number.

## 8.4 Composite ID

```java
public record CaseAssignmentId(CaseId caseId, OfficerId officerId) {
    public CaseAssignmentId {
        Objects.requireNonNull(caseId);
        Objects.requireNonNull(officerId);
    }
}
```

## 8.5 Public vs internal ID

Sometimes separate:

```java
CaseId publicId
long databaseId
```

Do not expose internal DB ID if it creates security/compatibility issues.

## 8.6 ID boundary

JSON:

```json
"caseId": "CASE-000001"
```

DB:

```sql
case_id VARCHAR(32)
```

Map explicitly.

---

# 9. Money

Money is not just BigDecimal.

Bad:

```java
BigDecimal amount;
String currency;
```

Good:

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount, "amount");
        Objects.requireNonNull(currency, "currency");
        amount = amount.setScale(currency.getDefaultFractionDigits(), RoundingMode.UNNECESSARY);
    }
}
```

But this simplistic constructor has issues for currencies with special cases. You need a policy.

## 9.1 Money components

```text
amount
currency
rounding policy
scale/minor unit policy
```

## 9.2 Currency

`java.util.Currency` represents a currency identified by ISO 4217 currency codes according to Java SE 25 API.

```java
Currency sgd = Currency.getInstance("SGD");
```

## 9.3 BigDecimal creation

Use:

```java
new BigDecimal("10.50")
BigDecimal.valueOf(10.50)
```

Avoid:

```java
new BigDecimal(10.50)
```

because binary double already imprecise.

## 9.4 Money add

```java
public Money add(Money other) {
    requireSameCurrency(other);
    return new Money(amount.add(other.amount), currency);
}

private void requireSameCurrency(Money other) {
    if (!currency.equals(other.currency)) {
        throw new IllegalArgumentException("Currency mismatch");
    }
}
```

## 9.5 Minor units alternative

```java
public record MoneyMinor(long minorUnits, Currency currency) {}
```

For SGD, cents.

Pros:

- exact integer arithmetic;
- efficient;
- simple equality.

Cons:

- currency fraction digits vary;
- formatting needed;
- not all monetary use cases fit minor units.

## 9.6 Do not mix currencies silently

Never:

```java
SGD 10 + USD 10 = 20
```

Throw or require FX conversion object.

## 9.7 Rounding is domain policy

Rounding should be explicit:

```java
Money rounded(RoundingMode mode)
```

or service policy.

## 9.8 Money equality

If BigDecimal scale matters, normalize.

`BigDecimal("1.0").equals(BigDecimal("1.00"))` false.

For Money, decide:

- scale is fixed per currency;
- or use minor units;
- or custom equality.

---

# 10. Currency dan Minor Units

## 10.1 Currency code

```java
Currency.getInstance("SGD").getCurrencyCode()
```

ISO 4217 code.

## 10.2 Default fraction digits

```java
currency.getDefaultFractionDigits()
```

Examples:

- SGD: 2;
- JPY: 0;
- some pseudo currencies: special values.

## 10.3 Minor units

```java
long cents = 12345; // SGD 123.45
```

## 10.4 Currency changes

Currency metadata can change.

Be careful with historic financial records.

## 10.5 Formatting

Use locale-aware formatting for display, not for storage.

## 10.6 Store currency explicitly

Never store amount without currency.

```java
record Money(BigDecimal amount, Currency currency)
```

---

# 11. Quantity dan Unit of Measure

Quantity without unit is dangerous.

Bad:

```java
BigDecimal weight = new BigDecimal("10");
```

10 what?

- kg?
- grams?
- pounds?
- tons?

## 11.1 Quantity type

```java
public record Quantity(BigDecimal value, Unit unit) {
    public Quantity {
        Objects.requireNonNull(value);
        Objects.requireNonNull(unit);
        if (value.signum() < 0) {
            throw new IllegalArgumentException("Quantity cannot be negative");
        }
    }
}
```

## 11.2 Unit enum

```java
enum Unit {
    KILOGRAM,
    GRAM,
    METER,
    CENTIMETER
}
```

But unit systems can be complex. Consider library if serious.

## 11.3 Same dimension

Do not add kg to meter.

Type system can model dimensions separately:

```java
Weight
Length
Volume
```

## 11.4 Conversion

```java
Weight kilograms()
```

Centralize conversion.

## 11.5 Production bug

NASA Mars Climate Orbiter famously failed due unit mismatch (pound-force seconds vs newton-seconds). Lesson: unit belongs in type.

## 11.6 Domain specificity

For business apps, create simple domain unit types where high risk:

```java
DistanceKm
WeightKg
StorageBytes
```

---

# 12. Percentage, Ratio, Rate, dan Basis Points

## 12.1 Percentage

```java
public record Percentage(BigDecimal value) {
    public Percentage {
        Objects.requireNonNull(value);
        if (value.compareTo(BigDecimal.ZERO) < 0 ||
            value.compareTo(new BigDecimal("100")) > 0) {
            throw new IllegalArgumentException("Percentage must be 0..100");
        }
    }

    public BigDecimal asRatio() {
        return value.divide(new BigDecimal("100"));
    }
}
```

## 12.2 Ratio

```java
public record Ratio(BigDecimal value) {
    public Ratio {
        Objects.requireNonNull(value);
    }
}
```

Could be 0..1 or arbitrary depending domain.

## 12.3 Basis points

Financial rates often use basis points.

```java
public record BasisPoints(int value) {
    public BigDecimal asPercentage() {
        return BigDecimal.valueOf(value).movePointLeft(2);
    }

    public BigDecimal asRatio() {
        return BigDecimal.valueOf(value).movePointLeft(4);
    }
}
```

100 basis points = 1%.

## 12.4 Avoid raw double

Rates often need exact decimal rules.

## 12.5 Name type clearly

`DiscountRate`, `TaxRate`, `InterestRate` may have different ranges/policies.

---

# 13. Email Address

Email validation is harder than it looks.

## 13.1 Simple domain type

```java
public record EmailAddress(String value) {
    private static final Pattern SIMPLE =
        Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");

    public EmailAddress {
        Objects.requireNonNull(value, "value");
        value = value.strip();

        if (value.length() > 254 || !SIMPLE.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid email address");
        }
    }

    public String domain() {
        return value.substring(value.indexOf('@') + 1);
    }
}
```

## 13.2 Avoid overclaiming regex correctness

Full RFC email validation is complex.

Most systems use pragmatic validation plus confirmation email.

## 13.3 Canonicalization

Email local part can be case-sensitive technically, but many providers treat case-insensitive.

Do not globally lowercase entire email without domain policy.

Common approach:

- strip surrounding whitespace;
- maybe lowercase domain;
- preserve original for display;
- store canonical search key separately if needed.

## 13.4 Security/logging

Email may be PII.

`toString` policy depends system.

Could mask:

```java
f***@example.com
```

## 13.5 Validation vs verification

Valid format does not mean mailbox exists or user owns it.

Use email verification workflow.

---

# 14. Name dan Human Text

Human names are hard.

Bad assumptions:

- everyone has first/last name;
- ASCII only;
- max 20 chars;
- uppercase conversion safe;
- no spaces/apostrophes;
- name is unique;
- name is stable.

## 14.1 DisplayName

```java
public record DisplayName(String value) {
    public DisplayName {
        Objects.requireNonNull(value);
        value = Normalizer.normalize(value.strip(), Normalizer.Form.NFC);

        int codePoints = value.codePointCount(0, value.length());
        if (codePoints < 1 || codePoints > 200) {
            throw new IllegalArgumentException("Display name length invalid");
        }
    }

    @Override
    public String toString() {
        return value;
    }
}
```

## 14.2 PersonName

Could be:

```java
record PersonName(String fullName) {}
```

or structured depending requirements.

## 14.3 Preserve original

For display, preserve user input as much as policy allows.

## 14.4 Search key

Create separate normalized search key:

```java
record NameSearchKey(String value) {}
```

## 14.5 Do not use name as ID

Names are not stable/unique.

---

# 15. Status, Type, Code, dan Enum

Closed set? Use enum.

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    CLOSED,
    REJECTED
}
```

## 15.1 External code

```java
enum CaseStatus {
    DRAFT("D"),
    SUBMITTED("S"),
    CLOSED("C");

    private final String code;
}
```

## 15.2 Dynamic code

If business users can add new values without deployment, enum is wrong.

Use reference table/entity.

## 15.3 Code value object

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

## 15.4 Status vs state

Enum status is fine if alternatives have same shape.

If each state needs different data, use sealed state.

## 15.5 Do not store display label

Store stable code. Display label belongs to i18n/UI.

---

# 16. Reason, Comment, dan Free Text

Free text still needs type.

## 16.1 ClosureReason

```java
public record ClosureReason(String value) {
    public ClosureReason {
        Objects.requireNonNull(value);
        value = Normalizer.normalize(value.strip(), Normalizer.Form.NFC);

        int len = value.codePointCount(0, value.length());
        if (len < 10 || len > 2000) {
            throw new IllegalArgumentException("Closure reason must be 10..2000 characters");
        }
    }

    @Override
    public String toString() {
        return "ClosureReason[length=" + value.codePointCount(0, value.length()) + "]";
    }
}
```

## 16.2 Why not raw String?

Because reason often has:

- min/max length;
- cannot be blank;
- may contain PII;
- audit/log policy;
- normalization;
- allowed characters;
- display escaping;
- moderation.

## 16.3 Preserve content

Do not over-normalize legal/audit text if exact user input matters.

Maybe store original and normalized search text.

## 16.4 Logging

Do not log full reason if may contain PII.

## 16.5 HTML/SQL escaping

Do not escape in value object for all contexts.

Escape at output boundary.

---

# 17. Version, Sequence, dan Optimistic Lock

## 17.1 Version

```java
public record Version(long value) implements Comparable<Version> {
    public Version {
        if (value < 0) {
            throw new IllegalArgumentException("Version cannot be negative");
        }
    }

    public Version next() {
        return new Version(value + 1);
    }

    @Override
    public int compareTo(Version other) {
        return Long.compare(value, other.value);
    }
}
```

## 17.2 Optimistic lock

```java
record ExpectedVersion(Version value) {}
```

## 17.3 Sequence

```java
record SequenceNumber(long value) {}
```

Define:

- starts at 0 or 1?
- monotonic?
- gap allowed?
- overflow policy?

## 17.4 Avoid raw long

Raw `long version` can be confused with ID, timestamp, count.

## 17.5 Overflow

Use `Math.addExact` or explicit policy in critical counters.

---

# 18. Date/Time Domain Types

## 18.1 BusinessDate

```java
public record BusinessDate(LocalDate value) {
    public BusinessDate {
        Objects.requireNonNull(value);
    }
}
```

## 18.2 DateRange

```java
public record DateRange(LocalDate startInclusive, LocalDate endExclusive) {
    public DateRange {
        Objects.requireNonNull(startInclusive);
        Objects.requireNonNull(endExclusive);
        if (!startInclusive.isBefore(endExclusive)) {
            throw new IllegalArgumentException("Invalid date range");
        }
    }

    public boolean contains(LocalDate date) {
        return !date.isBefore(startInclusive) && date.isBefore(endExclusive);
    }
}
```

## 18.3 Expiration

```java
public record Expiration(Instant expiresAt) {
    public Expiration {
        Objects.requireNonNull(expiresAt);
    }

    public boolean isExpired(Clock clock) {
        return !clock.instant().isBefore(expiresAt);
    }
}
```

## 18.4 AppointmentTime

```java
public record AppointmentTime(LocalDateTime localDateTime, ZoneId zone) {
    public AppointmentTime {
        Objects.requireNonNull(localDateTime);
        Objects.requireNonNull(zone);
    }

    public ZonedDateTime asZonedDateTime() {
        return localDateTime.atZone(zone);
    }
}
```

## 18.5 Rule

If time concept has business meaning, wrap it.

---

# 19. Range Types

Ranges prevent off-by-one and invalid boundary bugs.

## 19.1 Generic-ish range?

```java
record Range<T extends Comparable<? super T>>(T startInclusive, T endExclusive) {}
```

Might be too generic.

Domain-specific ranges often clearer.

## 19.2 DateRange

```java
[startInclusive, endExclusive)
```

## 19.3 InstantRange

```java
public record InstantRange(Instant startInclusive, Instant endExclusive) {
    public InstantRange {
        Objects.requireNonNull(startInclusive);
        Objects.requireNonNull(endExclusive);
        if (!startInclusive.isBefore(endExclusive)) {
            throw new IllegalArgumentException("Invalid instant range");
        }
    }

    public boolean contains(Instant instant) {
        return !instant.isBefore(startInclusive) && instant.isBefore(endExclusive);
    }

    public boolean overlaps(InstantRange other) {
        return startInclusive.isBefore(other.endExclusive)
            && other.startInclusive.isBefore(endExclusive);
    }
}
```

## 19.4 MoneyRange

Maybe min/max amount same currency.

## 19.5 PercentageRange

0..100.

## 19.6 Rule

Use ranges when paired fields have invariant.

---

# 20. Security-Sensitive Types

Some values must not be logged/exposed casually.

Examples:

- password;
- access token;
- refresh token;
- API key;
- PII identifiers;
- secret bytes;
- session ID.

## 20.1 AccessToken

```java
public record AccessToken(String value) {
    public AccessToken {
        Objects.requireNonNull(value);
        if (value.isBlank()) {
            throw new IllegalArgumentException("Access token cannot be blank");
        }
    }

    @Override
    public String toString() {
        return "AccessToken[masked]";
    }
}
```

## 20.2 SecretBytes

Record may be wrong if you need clearing and hidden representation.

```java
public final class SecretBytes implements AutoCloseable {
    private byte[] value;

    public SecretBytes(byte[] value) {
        this.value = value.clone();
    }

    public byte[] copyValue() {
        ensureOpen();
        return value.clone();
    }

    @Override
    public void close() {
        if (value != null) {
            Arrays.fill(value, (byte) 0);
            value = null;
        }
    }

    private void ensureOpen() {
        if (value == null) throw new IllegalStateException("closed");
    }

    @Override
    public String toString() {
        return "SecretBytes[masked]";
    }
}
```

## 20.3 Sensitive equality

For tokens/digests, constant-time comparison may matter.

## 20.4 Logging policy

Sensitive type should have safe `toString`.

## 20.5 JSON policy

Do not accidentally serialize secret value.

Use DTOs/mappers.

---

# 21. Canonicalization dan Normalization

Canonicalization converts input to standard internal form.

## 21.1 PolicyCode

```java
strip + uppercase Locale.ROOT
```

## 21.2 Email domain

Maybe lowercase domain only.

## 21.3 DisplayName

Normalize Unicode NFC, but preserve case.

## 21.4 Money

Normalize scale/minor units.

## 21.5 BigDecimal

Be careful:

```java
stripTrailingZeros
setScale
```

can affect equality/display.

## 21.6 Rule

Canonicalization must be domain-specific.

Do not blindly:

```java
input.trim().toLowerCase()
```

for every string.

## 21.7 Store original and canonical

For some concepts:

```java
record SearchableName(DisplayName displayName, NameSearchKey searchKey) {}
```

---

# 22. Validation Strategy

## 22.1 Constructor validation

Good for domain invariant:

```java
new CaseId(raw)
```

throws if invalid.

## 22.2 Factory parse result

Good for external input:

```java
ParseResult<CaseId> CaseId.parse(String raw)
```

or:

```java
Optional<CaseId> tryParse(String raw)
```

if reason unnecessary.

## 22.3 Validation result

```java
sealed interface ParseCaseIdResult permits ParsedCaseId, InvalidCaseId {}

record ParsedCaseId(CaseId value) implements ParseCaseIdResult {}
record InvalidCaseId(String input, String reason) implements ParseCaseIdResult {}
```

## 22.4 Don't duplicate validation

Centralize in type.

## 22.5 Boundary mapping

API request validation should convert raw input into domain types early.

## 22.6 Error message safety

Do not include sensitive raw input in exception message.

---

# 23. Constructor vs Factory Method

## 23.1 Constructor

```java
new EmailAddress(raw)
```

Good when invalid input is programmer error or immediate fail-fast accepted.

## 23.2 Static factory

```java
EmailAddress.of(raw)
EmailAddress.parse(raw)
EmailAddress.tryParse(raw)
```

Can clarify semantics.

## 23.3 Multiple representations

```java
Money.ofMajor(BigDecimal amount, Currency currency)
Money.ofMinor(long minorUnits, Currency currency)
```

Factory names avoid constructor ambiguity.

## 23.4 Private constructor + factories

```java
public final class Money {
    private Money(...) {}

    public static Money ofMajor(...) {}
    public static Money ofMinor(...) {}
}
```

Use class when factories/hidden representation matter.

## 23.5 Record factory

Records can have static factories too.

```java
record CaseId(String value) {
    static CaseId parse(String raw) {
        return new CaseId(raw);
    }
}
```

---

# 24. Exception vs Result dalam Parsing

## 24.1 Constructor throws

```java
new CaseId(raw)
```

throws if invalid.

Works well internally.

## 24.2 External input

For API, invalid input is expected.

Instead of throwing deep and catching broadly, use validation layer or parse result.

## 24.3 Optional parse

```java
static Optional<CaseId> tryParse(String raw)
```

Good if reason not needed.

## 24.4 Result parse

```java
sealed interface CaseIdParseResult {}
```

Good if reason/path needed.

## 24.5 Rule

- Constructor enforces invariant.
- Boundary parser converts raw input to domain value or validation error.
- Do not let invalid raw values enter domain.

---

# 25. Equality dan Hashing

## 25.1 Value object equality

Value objects equal by value.

Records help.

```java
record CaseId(String value) {}
```

## 25.2 Normalize before storing

```java
new CaseId(" case-000001 ")
```

equals:

```java
new CaseId("CASE-000001")
```

if constructor canonicalizes.

## 25.3 BigDecimal trap

```java
new BigDecimal("1.0").equals(new BigDecimal("1.00")) // false
```

Money must handle this.

## 25.4 Array trap

If component is array, record equality wrong.

Use custom class/equals.

## 25.5 Mutable component trap

Do not include mutable collection without defensive copy.

## 25.6 HashMap key

Domain-specific type is excellent map key if immutable and equality stable.

---

# 26. Ordering dan Comparable

Implement `Comparable` only when there is one natural, stable ordering.

## 26.1 CaseId ordering

Maybe lexicographic.

```java
record CaseId(String value) implements Comparable<CaseId> {
    public int compareTo(CaseId other) {
        return value.compareTo(other.value);
    }
}
```

## 26.2 Money ordering

Only same currency.

```java
public int compareTo(Money other) {
    requireSameCurrency(other);
    return amount.compareTo(other.amount);
}
```

But Java `Comparable` contract expects total order. If different currency cannot compare, maybe do not implement Comparable; use explicit comparator/policy.

## 26.3 Percentage ordering

Natural.

## 26.4 Version ordering

Natural.

## 26.5 DisplayName ordering

Locale-dependent. Do not implement Comparable; use Collator comparator.

## 26.6 Rule

If ordering needs context, do not implement Comparable.

Use Comparator.

---

# 27. Serialization Boundary

Domain type internal representation does not have to match external representation.

## 27.1 CaseId JSON

Internal:

```java
record CaseId(String value)
```

External:

```json
"CASE-000001"
```

## 27.2 Money JSON

Options:

```json
{ "amount": "10.50", "currency": "SGD" }
```

or minor units:

```json
{ "minorUnits": 1050, "currency": "SGD" }
```

## 27.3 Do not expose toString blindly

`toString` for debugging/display may not be stable serialization.

Use explicit mapper.

## 27.4 Sensitive type

Never serialize secret unless endpoint explicitly requires.

## 27.5 Compatibility

Changing value object representation can break API/DB/events.

---

# 28. Database Mapping

## 28.1 Single-column value object

```java
CaseId -> VARCHAR
EmailAddress -> VARCHAR
Version -> BIGINT
BusinessDate -> DATE
```

## 28.2 Multi-column value object

```java
Money -> amount DECIMAL + currency_code VARCHAR(3)
DateRange -> start_date + end_date
```

## 28.3 JPA converter

For single-column:

```java
@Converter
class CaseIdConverter implements AttributeConverter<CaseId, String> {
    public String convertToDatabaseColumn(CaseId attribute) {
        return attribute == null ? null : attribute.value();
    }

    public CaseId convertToEntityAttribute(String dbData) {
        return dbData == null ? null : new CaseId(dbData);
    }
}
```

## 28.4 DB constraints

Mirror critical invariants:

```sql
CHECK (case_id ~ '^CASE-[0-9]{6}$')
CHECK (amount >= 0)
CHECK (currency_code CHAR_LENGTH = 3)
```

Syntax depends DB.

## 28.5 Avoid DB-only validation

Domain should validate too.

## 28.6 Data migration

Introducing domain type may reveal dirty data. Plan cleanup.

---

# 29. JSON/API Mapping

## 29.1 Request DTO raw

```java
record CloseCaseRequest(String caseId, String reason) {}
```

Map:

```java
new CloseCaseCommand(
    new CaseId(request.caseId()),
    new ClosureReason(request.reason())
)
```

## 29.2 Response DTO

```java
record CaseResponse(String caseId, String status) {}
```

Map domain to stable external strings/codes.

## 29.3 Error handling

Invalid domain type construction should become 400 validation error at API boundary.

## 29.4 Avoid domain leakage

Do not expose internal class structure if API contract should be stable.

## 29.5 OpenAPI

Document format/pattern:

```yaml
caseId:
  type: string
  pattern: '^CASE-[0-9]{6}$'
```

## 29.6 JSON string vs object

For simple wrappers, string is often best externally.

For multi-field value object, object.

---

# 30. Framework Integration

## 30.1 Jackson

Records and value objects can be serialized/deserialized with configuration/annotations.

But decide explicit API representation.

## 30.2 Spring MVC

Path/query parameters need converters:

```java
Converter<String, CaseId>
```

## 30.3 JPA

Use AttributeConverter/Embeddable.

## 30.4 Bean Validation

Can validate raw DTO fields.

Domain constructors still enforce invariant.

## 30.5 MapStruct/manual mapper

Use mapper layer to convert DTO raw values to domain types.

## 30.6 Beware reflection needs

Some frameworks need no-arg constructor or setters. Records may not fit entity use.

---

# 31. When Not to Create a Domain Type

Domain-specific types are powerful, but not every value needs wrapper.

## 31.1 Local variable only

```java
int retry = 0;
```

No need `RetryCount` if local trivial.

## 31.2 No invariant/no ambiguity/no operation

If type adds no safety/readability, skip.

## 31.3 Too many tiny types too early

Over-modeling can slow development.

Refactor when concept becomes important.

## 31.4 Performance hot path

Millions of tiny wrappers may allocate. Measure.

## 31.5 Framework friction

If wrapper creates excessive mapping complexity for low-value field, reconsider.

## 31.6 Rule

Create domain type when at least one is true:

- prevents mix-up;
- centralizes validation;
- carries operations;
- protects boundary;
- improves security/logging;
- encodes invariant;
- appears widely in domain language;
- has non-trivial semantics.

---

# 32. Refactoring Primitive Obsession

## 32.1 Identify candidates

Search for:

```java
String id
String status
String email
BigDecimal amount
String currency
int percentage
long version
LocalDate start
LocalDate end
```

## 32.2 Create type

```java
record CaseId(String value) { ... }
```

## 32.3 Add tests

Test:

- valid input;
- invalid input;
- normalization;
- equality;
- toString/logging;
- JSON/DB mapping.

## 32.4 Update internal APIs

From:

```java
findById(String id)
```

to:

```java
findById(CaseId id)
```

## 32.5 Keep boundary raw

API DTO can remain string.

Map at edge.

## 32.6 Gradual migration

Add overloads temporarily:

```java
findById(String id) {
    return findById(new CaseId(id));
}
```

Deprecate raw version.

## 32.7 Clean up

Remove scattered validations.

---

# 33. Production Failure Modes

## 33.1 CaseId/OfficerId mixed

Raw String IDs swapped.

Fix:

- typed ID.

## 33.2 Money without currency

Amount added across currencies.

Fix:

- Money type with currency.

## 33.3 BigDecimal scale equality bug

Money equality inconsistent.

Fix:

- normalize scale/minor units/custom equality.

## 33.4 Email canonicalization bug

Lowercasing whole email changes semantics for edge cases.

Fix:

- domain-specific canonicalization policy.

## 33.5 Name validation too strict

Rejects legitimate Unicode names.

Fix:

- human text policy; Unicode-aware length.

## 33.6 Reason logs PII

Raw string reason logged.

Fix:

- Reason type safe toString/log policy.

## 33.7 Enum status stored as display label

Label changed, parsing broken.

Fix:

- stable code.

## 33.8 Dynamic category modeled as enum

Business needs new category without deploy.

Fix:

- reference data.

## 33.9 Unit mismatch

kg/grams mixed.

Fix:

- Quantity/unit-specific types.

## 33.10 Nullable state-specific fields

`closedAt` null despite closed status.

Fix:

- sealed state/domain type.

## 33.11 JPA converter missing

Domain type not persisted correctly.

Fix:

- converter/embeddable + tests.

## 33.12 `toString` used as serialization

Later changed for logging, API breaks.

Fix:

- explicit serialization mapping.

---

# 34. Best Practices

## 34.1 General

- Create domain types for IDs, money, codes, reasons, ranges, versions.
- Keep value objects immutable.
- Validate in constructor/factory.
- Canonicalize consistently.
- Avoid exposing raw primitives deep in domain.
- Use records when transparent value semantics fit.
- Use final classes when representation must be hidden.
- Use enum for stable closed sets.
- Use sealed types when variants have different data.
- Use `Currency` for ISO currency codes.
- Use `BigDecimal` or minor units for money.
- Use `LocalDate`/`Instant` domain wrappers where semantics matter.
- Override `toString` for sensitive/large values.
- Use explicit mappers for JSON/DB/events.
- Avoid `toString` as stable serialization.
- Mirror critical constraints in DB/schema.
- Test invalid and boundary values.

## 34.2 Constructor design

- `Objects.requireNonNull`.
- Normalize before validation if policy says.
- Fail fast on invalid domain values.
- Avoid IO/DB in constructors.
- Keep errors safe.

## 34.3 Boundary design

- Raw DTO at boundary.
- Convert to domain types early.
- Convert from domain types explicitly.
- Return validation errors for invalid external input.
- Do not leak invalid values into domain.

## 34.4 Evolution

- Changing domain type representation requires migration.
- Changing external code/pattern is breaking.
- Plan compatibility for DB/API/events.

---

# 35. Decision Matrix

| Concept | Recommended type |
|---|---|
| case ID | `CaseId` record/class |
| officer ID | `OfficerId` record/class |
| database numeric ID | typed `record XId(long value)` |
| public UUID ID | typed `record XId(UUID value)` |
| money | `Money(amount, currency)` or minor-unit type |
| currency | `java.util.Currency` or controlled enum/reference |
| quantity | `Quantity(value, unit)` or unit-specific type |
| percentage | `Percentage` |
| basis points | `BasisPoints` |
| email | `EmailAddress` |
| display name | `DisplayName` |
| status closed set | enum |
| state with data | sealed type |
| policy code | `PolicyCode` |
| reason/comment | `Reason` value object |
| version | `Version` |
| date range | `DateRange` |
| instant range | `InstantRange` |
| business date | `BusinessDate` |
| token/secret | final class or masked record |
| dynamic category | DB/reference data, not enum |
| local trivial variable | primitive/raw okay |
| large primitive hot path | primitive array/value, measure wrappers |

---

# 36. Latihan

## Latihan 1 — Typed ID

Refactor:

```java
void assign(String caseId, String officerId)
```

to:

```java
void assign(CaseId caseId, OfficerId officerId)
```

Show compile-time prevention of swapped arguments.

## Latihan 2 — CaseId Validation

Implement `CaseId` with:

```text
CASE-[0-9]{6}
```

Normalize strip + uppercase.

## Latihan 3 — Money

Implement `Money` with:

- amount;
- currency;
- add;
- subtract;
- currency mismatch rejection.

## Latihan 4 — Money Minor Units

Implement `MoneyMinor(long minorUnits, Currency currency)` and formatter to major unit.

## Latihan 5 — Percentage

Implement `Percentage` range 0..100 and `asRatio`.

## Latihan 6 — EmailAddress

Implement pragmatic EmailAddress and discuss validation vs verification.

## Latihan 7 — DisplayName

Implement Unicode-aware length using codePointCount and NFC normalization.

## Latihan 8 — ClosureReason

Implement min/max length and safe `toString`.

## Latihan 9 — Version

Implement `Version.next()` with overflow handling.

## Latihan 10 — DateRange

Implement end-exclusive DateRange and overlap detection.

## Latihan 11 — Sensitive Token

Implement AccessToken with masked `toString`.

## Latihan 12 — DTO Mapping

Create request DTO with raw strings, map to domain command with domain-specific types, return validation errors.

## Latihan 13 — DB Converter

Write JPA AttributeConverter for CaseId.

## Latihan 14 — Refactoring Scan

Take existing service method with 5+ primitive/string parameters and replace meaningful ones with domain types.

---

# 37. Ringkasan

Domain-specific types mengubah type system menjadi penjaga domain.

Raw types seperti:

```java
String
long
int
BigDecimal
LocalDate
```

bukan salah. Tetapi jika konsep punya makna domain, invariant, operation, atau boundary policy, raw type sering terlalu lemah.

Gunakan:

```java
CaseId
OfficerId
Money
EmailAddress
DisplayName
PolicyCode
ClosureReason
Version
DateRange
BusinessDate
AccessToken
```

untuk membuat invalid states lebih sulit dibuat.

Hal penting:

- Type carries meaning.
- Constructor/factory enforces invariant.
- Canonicalization must be domain-specific.
- Records are excellent for transparent immutable value objects.
- Final classes better for hidden/sensitive/array-heavy types.
- Money must include currency and rounding/minor-unit policy.
- Email/name/free text need Unicode and privacy awareness.
- Enum for stable closed sets.
- Sealed type for alternatives with different data.
- Boundary mapping must be explicit.
- Do not serialize by `toString`.
- Do not over-engineer trivial values.

Senior Java engineer tidak hanya memilih `String` karena input-nya teks. Mereka bertanya:

```text
Teks ini mewakili apa?
Apa invariant-nya?
Boleh blank?
Case-sensitive?
Perlu normalized?
Bisa dilog?
Disimpan bagaimana?
Dibandingkan bagaimana?
Apa operasi validnya?
```

Jawaban dari pertanyaan itu adalah desain data type.

---

# 38. Referensi

1. Java SE 25 API — `Record`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Record.html

2. JEP 395 — Records  
   https://openjdk.org/jeps/395

3. Java SE 25 API — `Currency`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Currency.html

4. Java SE 25 API — `BigDecimal`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigDecimal.html

5. Java SE 25 API — `Objects`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Objects.html

6. Java SE 25 API — `Pattern`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Pattern.html

7. Java SE 25 API — `Normalizer`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/text/Normalizer.html

8. Java SE 25 API — `UUID`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/UUID.html

9. Java SE 25 API — `LocalDate`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/LocalDate.html

10. Java SE 25 API — `Instant`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/Instant.html

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-data-types-part-018.md](./learn-java-data-types-part-018.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-data-types-part-020.md](./learn-java-data-types-part-020.md)

</div>