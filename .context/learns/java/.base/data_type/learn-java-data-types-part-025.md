# learn-java-data-types-part-025.md

# Java Data Types — Part 025  
# Database Mapping: Java Types, SQL Types, ORM, JDBC, Nullability, Precision, dan Schema Invariants

> Seri: **Advanced Java Data Types**  
> Bagian: **025**  
> Fokus: memahami mapping antara Java data types dan database schema: primitive/wrapper, `String`, enum, ID, Money/BigDecimal, date/time, boolean, JSON, array, collections, Optional, records/value objects, JPA converters, JDBC, nullability, precision/scale, constraints, indexes, schema evolution, dan production failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Database Mapping adalah Boundary Contract](#2-mental-model-database-mapping-adalah-boundary-contract)
3. [Java Type vs SQL Type vs Domain Type](#3-java-type-vs-sql-type-vs-domain-type)
4. [JDBC Type Mapping Overview](#4-jdbc-type-mapping-overview)
5. [Primitive vs Wrapper dalam Persistence](#5-primitive-vs-wrapper-dalam-persistence)
6. [Nullability: Java `null`, SQL `NULL`, dan Domain Absence](#6-nullability-java-null-sql-null-dan-domain-absence)
7. [Boolean Mapping](#7-boolean-mapping)
8. [Integer Types: `byte`, `short`, `int`, `long`](#8-integer-types-byte-short-int-long)
9. [Floating Types: `float`, `double`](#9-floating-types-float-double)
10. [`BigDecimal`, `NUMERIC`, `DECIMAL`, Precision, Scale](#10-bigdecimal-numeric-decimal-precision-scale)
11. [Money Mapping](#11-money-mapping)
12. [String Mapping: `VARCHAR`, `CHAR`, `TEXT`, `CLOB`](#12-string-mapping-varchar-char-text-clob)
13. [Unicode, Collation, Case Sensitivity, dan Normalization](#13-unicode-collation-case-sensitivity-dan-normalization)
14. [Enum Mapping](#14-enum-mapping)
15. [Typed ID Mapping](#15-typed-id-mapping)
16. [UUID Mapping](#16-uuid-mapping)
17. [Date/Time Mapping](#17-datetime-mapping)
18. [Time Zone Mapping](#18-time-zone-mapping)
19. [Duration, Period, dan Interval](#19-duration-period-dan-interval)
20. [Optional dan Nullable Columns](#20-optional-dan-nullable-columns)
21. [Collections Mapping](#21-collections-mapping)
22. [Value Object Mapping](#22-value-object-mapping)
23. [JPA `AttributeConverter`](#23-jpa-attributeconverter)
24. [`@Embeddable` dan Multi-Column Value Object](#24-embeddable-dan-multi-column-value-object)
25. [Records dan Persistence](#25-records-dan-persistence)
26. [JSON Column Mapping](#26-json-column-mapping)
27. [Array/Collection Columns](#27-arraycollection-columns)
28. [BLOB/CLOB dan Large Object](#28-blobclob-dan-large-object)
29. [Schema Constraints sebagai Type Invariants](#29-schema-constraints-sebagai-type-invariants)
30. [Indexes dan Type Choice](#30-indexes-dan-type-choice)
31. [Default Values dan Generated Values](#31-default-values-dan-generated-values)
32. [Optimistic Locking dan Version Type](#32-optimistic-locking-dan-version-type)
33. [Audit Columns: CreatedAt, UpdatedAt, DeletedAt](#33-audit-columns-createdat-updatedat-deletedat)
34. [Soft Delete dan State Modeling](#34-soft-delete-dan-state-modeling)
35. [JPA Entity vs Domain Model vs Read Model](#35-jpa-entity-vs-domain-model-vs-read-model)
36. [Database Migration dan Type Evolution](#36-database-migration-dan-type-evolution)
37. [Production Failure Modes](#37-production-failure-modes)
38. [Best Practices](#38-best-practices)
39. [Decision Matrix](#39-decision-matrix)
40. [Latihan](#40-latihan)
41. [Ringkasan](#41-ringkasan)
42. [Referensi](#42-referensi)

---

# 1. Tujuan Bagian Ini

Java type system dan database type system tidak sama.

Java:

```java
record CaseId(String value) {}
record Money(BigDecimal amount, Currency currency) {}
record BusinessDate(LocalDate value) {}
record CaseClosed(Instant closedAt) {}
```

Database:

```sql
case_id VARCHAR(32) NOT NULL
amount DECIMAL(19, 2) NOT NULL
currency_code CHAR(3) NOT NULL
business_date DATE NOT NULL
closed_at TIMESTAMP WITH TIME ZONE
```

Mapping yang buruk bisa menyebabkan:

- precision loss;
- timezone bug;
- nullability ambiguity;
- invalid domain state;
- enum ordinal corruption;
- string collation bug;
- bad index selectivity;
- schema migration breakage;
- stale ORM entity state;
- hidden serialization in JSON column;
- money/currency mismatch;
- long ID precision issue in downstream systems.

Tujuan bagian ini:

- memahami database mapping sebagai boundary contract;
- memilih SQL type sesuai Java/domain type;
- memahami nullability dan default;
- memahami BigDecimal precision/scale;
- memahami enum dan typed ID mapping;
- memahami date/time mapping;
- memahami JPA converters/embeddables;
- memahami JSON column vs relational columns;
- memahami constraints/indexes sebagai extension dari type invariant;
- memahami schema evolution.

---

# 2. Mental Model: Database Mapping adalah Boundary Contract

Database bukan hanya storage. Database adalah boundary yang punya type system sendiri.

```text
Domain invariant in Java must be mirrored by DB schema when data is durable/shared.
```

Jika Java constructor mencegah invalid value tetapi database tidak, data bisa masuk lewat:

- migration script;
- manual SQL;
- old application version;
- ETL;
- batch job;
- integration;
- direct DB import;
- other service.

## 2.1 Java invariant

```java
record CaseId(String value) {
    CaseId {
        if (!value.matches("CASE-[0-9]{6}")) throw ...
    }
}
```

## 2.2 DB invariant

```sql
case_id VARCHAR(11) NOT NULL
```

Better:

```sql
case_id VARCHAR(11) NOT NULL
CHECK (case_id LIKE 'CASE-%')
```

Regex check depends DB.

## 2.3 Contract layers

```text
API validation
DTO mapping
domain constructor
ORM/JDBC mapping
DB constraints
DB indexes
migration rules
```

## 2.4 Do not trust one layer only

Strong systems validate at multiple layers.

## 2.5 Boundary translation

Do not let DB representation dictate domain design blindly. Use mapping layer.

---

# 3. Java Type vs SQL Type vs Domain Type

## 3.1 Java representation type

```java
String
long
BigDecimal
Instant
LocalDate
UUID
byte[]
```

## 3.2 Domain type

```java
CaseId
Money
BusinessDate
EmailAddress
Version
PolicyCode
```

## 3.3 SQL type

```sql
VARCHAR
BIGINT
NUMERIC
TIMESTAMP
DATE
UUID
BLOB
JSON
```

## 3.4 Mapping example

```java
record CaseId(String value) {}
```

SQL:

```sql
case_id VARCHAR(32) NOT NULL PRIMARY KEY
```

JPA converter:

```java
CaseId <-> String
```

## 3.5 Domain type can map to multiple columns

```java
record Money(BigDecimal amount, Currency currency) {}
```

SQL:

```sql
amount DECIMAL(19, 2) NOT NULL
currency_code CHAR(3) NOT NULL
```

## 3.6 Same Java type, different SQL/domain semantics

```java
String email
String caseId
String status
String reason
```

All Java `String`, but DB constraints/types/indexes should differ.

---

# 4. JDBC Type Mapping Overview

JDBC provides standard type constants in `java.sql.Types` and APIs such as `PreparedStatement`/`ResultSet` for reading/writing.

Common mappings:

| Java | JDBC/SQL concept |
|---|---|
| `String` | `VARCHAR`, `CHAR`, `LONGVARCHAR`, `CLOB` |
| `int`/`Integer` | `INTEGER` |
| `long`/`Long` | `BIGINT` |
| `BigDecimal` | `NUMERIC`, `DECIMAL` |
| `boolean`/`Boolean` | `BOOLEAN`/`BIT`/vendor-specific |
| `LocalDate` | `DATE` |
| `LocalTime` | `TIME` |
| `LocalDateTime` | `TIMESTAMP` |
| `OffsetDateTime` | `TIMESTAMP_WITH_TIMEZONE` if supported |
| `Instant` | often `TIMESTAMP`/`TIMESTAMP WITH TIME ZONE` via framework/driver |
| `byte[]` | `VARBINARY`, `BLOB` |
| `UUID` | vendor-specific `UUID` or `CHAR/VARCHAR/BINARY` |

## 4.1 JDBC 4.2 and java.time

Modern JDBC supports `java.time` types via `setObject`/`getObject` in many drivers.

Still verify driver/database behavior.

## 4.2 Vendor differences

PostgreSQL, MySQL, Oracle, SQL Server differ in:

- boolean support;
- timestamp with timezone semantics;
- JSON type;
- UUID type;
- collation;
- text/blob types;
- generated columns;
- check constraints.

## 4.3 ORM adds another layer

Hibernate/JPA maps Java to SQL but has defaults that may not match your domain requirements.

## 4.4 Always inspect generated schema

Do not blindly trust ORM generated DDL.

## 4.5 Integration tests

Use real database or containerized DB for mapping tests.

---

# 5. Primitive vs Wrapper dalam Persistence

## 5.1 Primitive cannot represent SQL NULL

```java
int count;
boolean enabled;
long version;
```

If DB column nullable, primitive cannot represent null.

## 5.2 Wrapper can represent null

```java
Integer count;
Boolean enabled;
Long version;
```

But null may leak into domain.

## 5.3 Domain required field

Use NOT NULL in DB and primitive/wrapper/domain type in Java depending semantics.

```sql
version BIGINT NOT NULL
```

```java
record Version(long value) {}
```

## 5.4 Nullable field

If DB field optional:

```sql
closed_at TIMESTAMP NULL
```

Java entity may use:

```java
Instant closedAt; // nullable in persistence layer
```

Domain may use state modeling:

```java
sealed interface CaseState permits Open, Closed {}
record Closed(Instant closedAt) implements CaseState {}
```

## 5.5 Default primitive trap

If ORM maps NULL to primitive default or application defaults silently:

```text
NULL -> 0
NULL -> false
```

Can corrupt semantics.

## 5.6 Rule

Use primitive when value is truly mandatory and DB is NOT NULL.

Use wrapper/null only at boundary, then map to explicit domain model.

---

# 6. Nullability: Java `null`, SQL `NULL`, dan Domain Absence

SQL `NULL` means unknown/missing/not applicable depending schema. It is not same as Java Optional.

## 6.1 Required domain value

```sql
case_id VARCHAR(32) NOT NULL
```

```java
CaseId caseId
```

## 6.2 Optional domain value

```sql
secondary_email VARCHAR(254) NULL
```

Domain accessor:

```java
Optional<EmailAddress> secondaryEmail()
```

## 6.3 State-specific field

Bad:

```sql
status VARCHAR(20) NOT NULL
closed_at TIMESTAMP NULL
closed_reason TEXT NULL
```

This allows invalid state:

```text
status = CLOSED, closed_at = NULL
status = OPEN, closed_reason = '...'
```

Better:

- check constraints;
- separate table;
- sealed state in domain;
- transition methods.

## 6.4 Missing vs null in DB

Column missing not possible in row schema; null explicit.

For JSON column, missing vs null returns.

## 6.5 SQL three-valued logic

`NULL` affects comparisons:

```sql
WHERE field = NULL -- wrong
WHERE field IS NULL
```

## 6.6 Rule

For core domain invariants, prefer NOT NULL plus explicit state modeling.

---

# 7. Boolean Mapping

Java:

```java
boolean
Boolean
```

SQL:

```sql
BOOLEAN
BIT
NUMBER(1)
CHAR(1)
```

depending DB.

## 7.1 Boolean is only two states

If domain has three states:

```text
enabled
disabled
unset
```

do not use primitive boolean.

Use enum:

```java
enum FeatureState { ENABLED, DISABLED, UNSPECIFIED }
```

DB:

```sql
feature_state VARCHAR(20) NOT NULL
```

## 7.2 Nullable Boolean trap

```java
Boolean active;
```

Means:

```text
true
false
null
```

But what is null?

## 7.3 Boolean column names

Good:

```sql
is_active
requires_approval
has_attachment
```

But avoid negative names:

```sql
is_not_deleted
```

## 7.4 Soft delete

Instead of:

```sql
is_deleted BOOLEAN
```

often better:

```sql
deleted_at TIMESTAMP NULL
deleted_by VARCHAR NULL
```

plus domain state, depending audit needs.

## 7.5 Indexing boolean

Boolean columns have low selectivity. Index usefulness depends DB/workload.

## 7.6 Rule

If more than two meaningful states, use enum/state type.

---

# 8. Integer Types: `byte`, `short`, `int`, `long`

## 8.1 SQL integer types

Common:

```sql
SMALLINT
INTEGER
BIGINT
```

## 8.2 Java mapping

```java
short -> SMALLINT
int -> INTEGER
long -> BIGINT
```

## 8.3 ID type

Use `BIGINT` for generated numeric IDs if scale may grow.

## 8.4 Overflow

DB BIGINT maps to Java long. Watch overflow if numeric range exceeds long.

## 8.5 Unsigned types

Some DBs have unsigned integer. Java lacks unsigned primitive types except helper methods.

Be careful mapping unsigned BIGINT to Java long.

## 8.6 Count

SQL `COUNT(*)` may return BIGINT/long depending DB/driver.

## 8.7 Version

Optimistic lock version usually BIGINT.

## 8.8 Domain wrapper

```java
record Version(long value) {}
```

Map to BIGINT.

---

# 9. Floating Types: `float`, `double`

SQL:

```sql
REAL
DOUBLE PRECISION
FLOAT
```

## 9.1 Approximate numeric

Floating types are approximate.

Good for:

- measurements;
- scores;
- coordinates;
- scientific calculations.

Bad for:

- money;
- exact quantity;
- legal thresholds requiring exact decimal.

## 9.2 NaN/Infinity

DB support varies.

If Java double can be NaN/Infinity, decide DB policy.

## 9.3 Equality queries

Floating comparisons in SQL can be tricky.

## 9.4 Indexing

Range queries okay depending use, but precision matters.

## 9.5 Domain type

Wrap if semantics important:

```java
record RiskScore(double value) {}
```

Validate finite/range.

## 9.6 Rule

Never map money to double/float.

---

# 10. `BigDecimal`, `NUMERIC`, `DECIMAL`, Precision, Scale

Java `BigDecimal` maps naturally to SQL `DECIMAL`/`NUMERIC`.

```sql
amount DECIMAL(19, 2) NOT NULL
```

## 10.1 Precision

Total number of digits.

## 10.2 Scale

Digits after decimal point.

`DECIMAL(19,2)` means up to 19 total digits, 2 after decimal.

## 10.3 BigDecimal scale

Java BigDecimal stores scale. `1.0` and `1.00` are not equal by `equals`.

## 10.4 DB rounding/truncation

DB may round/reject depending column and database.

Never rely on implicit DB rounding.

## 10.5 Explicit mapping

JPA:

```java
@Column(precision = 19, scale = 2, nullable = false)
private BigDecimal amount;
```

## 10.6 Money

Money needs currency column.

## 10.7 Rule

Always specify precision/scale for financial decimal columns.

---

# 11. Money Mapping

Domain:

```java
record Money(BigDecimal amount, Currency currency) {}
```

SQL:

```sql
amount DECIMAL(19, 2) NOT NULL
currency_code CHAR(3) NOT NULL
```

## 11.1 Multi-column value object

Money usually maps to multiple columns.

## 11.2 Single string/object column?

Avoid for queryable money fields.

Bad:

```sql
money_json JSON
```

if you need sorting/filtering/summing by amount/currency.

## 11.3 Minor units

Alternative:

```sql
minor_units BIGINT NOT NULL
currency_code CHAR(3) NOT NULL
```

Pros:

- exact;
- efficient;
- no decimal scale mismatch.

Cons:

- currency minor-unit policy needed;
- display conversion.

## 11.4 Currency constraint

```sql
currency_code CHAR(3) NOT NULL
```

Maybe foreign key to currency table if controlled list.

## 11.5 Same currency invariant

For sums/constraints, ensure app/domain enforces.

DB can enforce within row, not across arbitrary aggregate unless constraints/triggers.

## 11.6 Rule

Money = amount + currency + scale/rounding policy.

---

# 12. String Mapping: `VARCHAR`, `CHAR`, `TEXT`, `CLOB`

## 12.1 VARCHAR

Variable length, common for IDs/codes/names.

```sql
case_id VARCHAR(32)
email VARCHAR(254)
```

## 12.2 CHAR

Fixed length. Can have padding semantics depending DB.

Good for fixed codes like currency maybe:

```sql
currency_code CHAR(3)
```

But be aware of trailing spaces.

## 12.3 TEXT/CLOB

Large text.

Use for comments, descriptions, documents.

## 12.4 Length constraints

Java validation and DB length should match.

Be careful length unit:

- characters?
- bytes?
- code points?
- DB collation/encoding dependent.

## 12.5 Blank vs null

Decide whether blank string allowed.

```sql
CHECK (length(trim(reason)) > 0)
```

Syntax varies.

## 12.6 Index size

Long strings are expensive to index.

Use normalized/search columns if needed.

---

# 13. Unicode, Collation, Case Sensitivity, dan Normalization

## 13.1 Unicode storage

Modern DBs support Unicode, but column type/charset/collation matter.

## 13.2 Collation

Collation affects:

- equality;
- ordering;
- case sensitivity;
- accent sensitivity;
- index behavior.

## 13.3 Case-insensitive email lookup

Options:

- store canonical search key;
- use case-insensitive collation;
- functional index lower(email);
- PostgreSQL citext extension;
- application normalization.

## 13.4 Normalization

`é` can be composed or decomposed Unicode.

Normalize in Java if equality/search requires.

```java
Normalizer.normalize(value, Normalizer.Form.NFC)
```

## 13.5 Locale traps

Use `Locale.ROOT` for machine identifiers.

## 13.6 Rule

Text equality is not trivial. Decide at domain and DB level consistently.

---

# 14. Enum Mapping

## 14.1 Ordinal mapping

Bad:

```java
@Enumerated(EnumType.ORDINAL)
```

DB stores:

```sql
0, 1, 2
```

Adding/reordering enum constants corrupts meaning.

## 14.2 String mapping

Better:

```java
@Enumerated(EnumType.STRING)
```

Stores enum name.

But renaming enum constant breaks DB data.

## 14.3 Stable code mapping

Best for long-lived DB:

```java
enum CaseStatus {
    DRAFT("D"),
    SUBMITTED("S"),
    CLOSED("C")
}
```

DB:

```sql
status_code VARCHAR(16) NOT NULL
```

JPA converter maps code ↔ enum.

## 14.4 Reference table

If values are dynamic/admin-managed, do not use enum.

Use table:

```sql
case_status_ref
```

## 14.5 Unknown value

Converter should handle unknown DB value deliberately:

- throw;
- map to UNKNOWN;
- fail startup/data health.

## 14.6 Rule

Never persist enum ordinal.

---

# 15. Typed ID Mapping

Domain:

```java
record CaseId(String value) {}
record OfficerId(String value) {}
```

DB:

```sql
case_id VARCHAR(32) NOT NULL
officer_id VARCHAR(32) NOT NULL
```

## 15.1 AttributeConverter

```java
@Converter(autoApply = true)
public class CaseIdConverter implements AttributeConverter<CaseId, String> {
    @Override
    public String convertToDatabaseColumn(CaseId attribute) {
        return attribute == null ? null : attribute.value();
    }

    @Override
    public CaseId convertToEntityAttribute(String dbData) {
        return dbData == null ? null : new CaseId(dbData);
    }
}
```

## 15.2 Null policy

If DB column NOT NULL, converter can still receive null during framework lifecycle. Decide robustly.

## 15.3 Primary key wrapper

JPA support for custom ID types depends mapping strategy/provider.

Test carefully.

## 15.4 Embeddable ID

For composite IDs:

```java
@Embeddable
class CaseAssignmentJpaId {
    String caseId;
    String officerId;
}
```

or domain wrapper.

## 15.5 Public ID vs DB ID

May have:

```sql
id BIGINT PRIMARY KEY
public_case_id VARCHAR UNIQUE
```

Domain can expose public ID.

## 15.6 Rule

Typed IDs are excellent in domain; mapping needs explicit converter/embeddable.

---

# 16. UUID Mapping

Java:

```java
UUID
```

DB options:

- native UUID type (PostgreSQL);
- `CHAR(36)`;
- `BINARY(16)`;
- `RAW(16)` in some DBs.

## 16.1 Native UUID

Pros:

- semantic type;
- compact-ish;
- DB functions/index support.

## 16.2 CHAR(36)

Readable but larger.

## 16.3 BINARY(16)

Compact but less readable.

## 16.4 UUID version

Random UUID indexing can fragment B-tree indexes. Time-ordered UUID variants can help depending DB/design.

## 16.5 Java wrapper

```java
record UserId(UUID value) {}
```

## 16.6 JSON

Serialize UUID as string.

## 16.7 Rule

Pick UUID storage based on DB support, index behavior, readability, and portability.

---

# 17. Date/Time Mapping

## 17.1 LocalDate

SQL:

```sql
DATE
```

Java:

```java
LocalDate
```

Good for birth date/business date.

## 17.2 LocalTime

SQL:

```sql
TIME
```

Good for time-of-day.

## 17.3 LocalDateTime

SQL:

```sql
TIMESTAMP WITHOUT TIME ZONE
```

Semantics: local date-time, no zone.

Do not use for global audit timestamp unless DB/application policy ensures UTC and naming is clear.

## 17.4 Instant

Often mapped to:

```sql
TIMESTAMP WITH TIME ZONE
```

or UTC timestamp depending DB.

Check driver/ORM semantics.

## 17.5 OffsetDateTime

Maps to timestamp with offset/timezone if supported.

## 17.6 ZonedDateTime

Most DBs do not store full ZoneId in timestamp type.

Store:

```sql
instant TIMESTAMP ...
zone_id VARCHAR(64)
```

if zone matters.

## 17.7 Precision

DB may store seconds/millis/micros/nanos.

Normalize in tests and comparisons.

---

# 18. Time Zone Mapping

## 18.1 Instant for audit

```java
Instant createdAt
```

DB stores UTC-like instant.

## 18.2 ZoneId for user intent

For scheduled local appointment:

```sql
local_date_time TIMESTAMP NOT NULL
zone_id VARCHAR(64) NOT NULL
```

or:

```sql
scheduled_instant TIMESTAMP NOT NULL
zone_id VARCHAR(64) NOT NULL
```

depending use.

## 18.3 Offset not enough

`+07:00` does not equal `Asia/Jakarta`.

## 18.4 DB timestamp with time zone semantics vary

Some DBs normalize to UTC; some preserve offset differently; some naming misleading.

Always verify.

## 18.5 System default zone trap

Do not rely on JVM/DB session default timezone silently.

## 18.6 Rule

Store machine event time as Instant/UTC. Store ZoneId separately when local human intent matters.

---

# 19. Duration, Period, dan Interval

## 19.1 Duration

Can map to:

- BIGINT milliseconds/seconds/nanos;
- SQL INTERVAL if supported;
- ISO-8601 duration string.

## 19.2 Period

Calendar years/months/days.

Can map to:

- months + days columns;
- ISO-8601 period string;
- DB interval with caution.

## 19.3 Timeout

```sql
timeout_ms BIGINT NOT NULL
```

Java:

```java
Duration timeout
```

## 19.4 Subscription period

```sql
period_months INTEGER NOT NULL
```

or domain-specific.

## 19.5 Avoid raw long ambiguity

Name unit in column:

```sql
timeout_ms
ttl_seconds
```

not:

```sql
timeout
```

## 19.6 Rule

Persist duration with explicit unit or explicit structured columns.

---

# 20. Optional dan Nullable Columns

Do not map `Optional<T>` as entity field by default.

## 20.1 Entity field

Use nullable field in persistence model:

```java
private String secondaryEmail;
```

Domain accessor:

```java
Optional<EmailAddress> secondaryEmail()
```

## 20.2 DTO/domain mapping

Map nullable DB to domain state or Optional-return accessor.

## 20.3 Optional in JPA

JPA support for Optional entity fields is limited/problematic depending provider/use.

Avoid.

## 20.4 Null object vs null column

If absence meaningful, model explicitly.

## 20.5 Rule

Optional is API return type, not default persistence field type.

---

# 21. Collections Mapping

Collections can map as:

- one-to-many table;
- many-to-many table;
- element collection;
- JSON array column;
- delimited string (avoid);
- array column vendor-specific.

## 21.1 One-to-many

```sql
order_line(order_id, line_no, product_id, quantity)
```

Best for queryable child entities.

## 21.2 Element collection

JPA `@ElementCollection` for value types.

Can cause performance issues if not managed carefully.

## 21.3 JSON array

Good for small unqueried flexible data.

Not ideal if querying/filtering elements.

## 21.4 Delimited string

Bad:

```sql
permissions = 'READ,WRITE'
```

Avoid unless legacy/simple and controlled.

## 21.5 Order preservation

If collection order matters, store order column:

```sql
line_no INTEGER NOT NULL
```

## 21.6 Set uniqueness

Enforce unique constraint:

```sql
UNIQUE (user_id, permission)
```

## 21.7 Rule

Relational structure should reflect collection semantics.

---

# 22. Value Object Mapping

## 22.1 Single-column value object

```java
EmailAddress -> VARCHAR
CaseId -> VARCHAR
Version -> BIGINT
```

Use converter.

## 22.2 Multi-column value object

```java
Money -> amount + currency
DateRange -> start + end
GeoPoint -> lat + lon
```

Use embeddable or explicit columns.

## 22.3 Nested value object

Avoid excessive ORM magic. Sometimes manual mapper clearer.

## 22.4 Validation on load

If DB contains invalid value, domain constructor should fail.

This reveals data corruption.

## 22.5 Dirty data migration

Introducing value object may fail on existing dirty rows. Plan cleanup.

## 22.6 Rule

Value object mapping should preserve invariant and semantics, not just fields.

---

# 23. JPA `AttributeConverter`

JPA `AttributeConverter<X,Y>` maps entity attribute type X to database column type Y.

## 23.1 CaseId converter

```java
@Converter(autoApply = true)
public class CaseIdConverter implements AttributeConverter<CaseId, String> {
    @Override
    public String convertToDatabaseColumn(CaseId attribute) {
        return attribute == null ? null : attribute.value();
    }

    @Override
    public CaseId convertToEntityAttribute(String dbData) {
        return dbData == null ? null : new CaseId(dbData);
    }
}
```

## 23.2 Good for

- typed IDs;
- EmailAddress;
- PolicyCode;
- Version;
- single-column value objects;
- enum stable codes.

## 23.3 Not enough for multi-column

Money needs amount + currency, so converter to single string/JSON is often not ideal for queryable fields.

## 23.4 autoApply caution

`autoApply = true` applies globally for that attribute type.

Useful but be careful if same Java type maps differently in different contexts.

## 23.5 Null handling

Converters should handle null robustly even if column NOT NULL.

## 23.6 Test converters

Round-trip tests:

```text
domain -> DB -> domain
```

---

# 24. `@Embeddable` dan Multi-Column Value Object

JPA embeddable maps value object to multiple columns.

## 24.1 Money example

```java
@Embeddable
public class MoneyEmbeddable {
    @Column(name = "amount", precision = 19, scale = 2, nullable = false)
    private BigDecimal amount;

    @Column(name = "currency_code", length = 3, nullable = false)
    private String currencyCode;
}
```

Then map to domain `Money`.

## 24.2 Embeddable as persistence type

You can use embeddable directly or map to domain object.

For strict domain purity, keep persistence embeddable separate.

## 24.3 DateRange

```sql
start_date DATE NOT NULL
end_date DATE NOT NULL
CHECK (start_date < end_date)
```

## 24.4 Column override

JPA allows overriding column names for embedded objects.

## 24.5 Mutability

Embeddables often mutable for ORM. Domain value object should remain immutable.

## 24.6 Rule

For multi-column domain type, embeddable or manual mapping is better than JSON/string blob when queryable.

---

# 25. Records dan Persistence

Records are great for:

- DTOs;
- read projections;
- query results;
- value objects outside ORM entity lifecycle.

## 25.1 JPA entities

Traditional JPA entities generally need no-arg constructor, identity, lifecycle/proxy support, mutable fields. Records are usually not appropriate for entities.

## 25.2 Projections

Records work well:

```java
record CaseSummaryProjection(String caseId, String status, Instant updatedAt) {}
```

## 25.3 Value objects

Records good for domain value objects with converters.

## 25.4 Constructor validation

Records enforce invariants in compact constructor.

When loaded from DB, invalid data fails early.

## 25.5 Framework support varies

Check ORM/provider support for records/projections.

## 25.6 Rule

Use records for immutable values/projections/DTOs, not as default ORM entity.

---

# 26. JSON Column Mapping

Many DBs support JSON/JSONB-like columns.

## 26.1 Good use cases

- event payload;
- audit metadata;
- flexible configuration;
- rarely queried document-like data;
- extension attributes.

## 26.2 Bad use cases

- core relational fields;
- frequently queried/filter/sorted fields;
- fields requiring strong relational constraints;
- joins;
- high update granularity.

## 26.3 JSON type in Java

Do not map to `Map<String,Object>` deep in domain.

Use:

- DTO class;
- JsonNode at boundary;
- domain-specific type after validation.

## 26.4 Schema version

Store version:

```json
{"schemaVersion":1,...}
```

or separate column.

## 26.5 Indexing

DB-specific JSON indexes can help but add complexity.

## 26.6 Rule

JSON column is schema flexibility, not excuse to abandon modeling.

---

# 27. Array/Collection Columns

Some DBs support array columns.

## 27.1 Pros

- compact for simple arrays;
- avoid join table for small unqueried list;
- DB-specific operators maybe useful.

## 27.2 Cons

- portability;
- ORM support varies;
- constraints harder;
- normalization issues.

## 27.3 Use cases

- tags small list;
- numeric vector;
- simple codes;
- PostgreSQL arrays.

## 27.4 If order matters

Array preserves order.

## 27.5 If uniqueness matters

DB array may not enforce uniqueness easily.

## 27.6 Rule

Use join table for relationally meaningful collection; array column for DB-specific compact/simple use.

---

# 28. BLOB/CLOB dan Large Object

## 28.1 BLOB

Binary large object.

Java:

```java
byte[]
InputStream
Blob
```

## 28.2 CLOB

Character large object.

Java:

```java
String
Reader
Clob
```

## 28.3 Store in DB or object storage?

For large files/documents, object storage may be better with DB storing metadata/reference.

## 28.4 Loading cost

Avoid loading huge BLOB/CLOB eagerly.

## 28.5 Streaming

Use streaming APIs.

## 28.6 Security

Scan/validate file content; don't trust stored blobs.

## 28.7 Rule

Large object fields should not accidentally be part of normal entity load.

---

# 29. Schema Constraints sebagai Type Invariants

DB constraints are durable invariant guards.

## 29.1 NOT NULL

```sql
case_id VARCHAR(32) NOT NULL
```

## 29.2 CHECK

```sql
amount >= 0
start_date < end_date
status IN ('D','S','C')
```

## 29.3 UNIQUE

```sql
UNIQUE (tenant_id, email_search_key)
```

## 29.4 FOREIGN KEY

```sql
currency_code REFERENCES currency(code)
```

## 29.5 Domain invariant mirroring

If Java type enforces non-negative amount, DB should too for critical data.

## 29.6 Constraint naming

Name constraints for meaningful error handling.

## 29.7 Rule

A domain invariant that must survive all writers belongs in DB constraints too.

---

# 30. Indexes dan Type Choice

Type choice affects indexes.

## 30.1 String index length

Long strings cost more to index.

## 30.2 Case-insensitive search

Use normalized column or functional index.

```sql
email_search_key
```

## 30.3 Timestamp index

For audit/event queries:

```sql
created_at
occurred_at
```

## 30.4 Composite index

Order matters:

```sql
(tenant_id, status, created_at)
```

## 30.5 Low-cardinality boolean

Boolean index may not help unless partial index/filter selectivity.

## 30.6 UUID index

Random UUID can fragment B-tree; consider ordered UUID/time-sortable ID depending DB/workload.

## 30.7 JSON index

DB-specific; be deliberate.

## 30.8 Rule

Choose type with query patterns in mind.

---

# 31. Default Values dan Generated Values

## 31.1 DB default

```sql
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
status VARCHAR DEFAULT 'DRAFT'
```

## 31.2 App default

```java
status = CaseStatus.DRAFT
```

## 31.3 Dual default risk

If app and DB default differ, inconsistent data.

## 31.4 Generated ID

DB sequence/identity vs application-generated UUID.

## 31.5 CreatedAt source

App clock vs DB clock.

Choose one policy.

## 31.6 Default hides missing input

A default can hide producer bug.

## 31.7 Rule

Defaults must be explicit architecture decision.

---

# 32. Optimistic Locking dan Version Type

## 32.1 Version column

```sql
version BIGINT NOT NULL
```

Java:

```java
@Version
private long version;
```

or domain:

```java
record Version(long value) {}
```

## 32.2 Purpose

Detect lost updates.

## 32.3 Not business version

ORM version may differ from domain/event version.

## 32.4 Timestamp version

Some systems use timestamp, but numeric version often clearer.

## 32.5 Overflow

Long enough for most but define policy if critical.

## 32.6 Rule

Version is a data type with concurrency semantics, not just a number.

---

# 33. Audit Columns: CreatedAt, UpdatedAt, DeletedAt

## 33.1 CreatedAt/UpdatedAt

Use `Instant`.

DB:

```sql
created_at TIMESTAMP ... NOT NULL
updated_at TIMESTAMP ... NOT NULL
```

## 33.2 Time source

Application or DB.

## 33.3 DeletedAt

Soft delete timestamp.

```sql
deleted_at TIMESTAMP NULL
deleted_by VARCHAR NULL
```

## 33.4 CreatedBy/UpdatedBy

Typed user/actor ID.

## 33.5 Precision

Normalize precision across app/DB.

## 33.6 Audit integrity

Do not allow random update of audit fields from business code.

## 33.7 Rule

Audit fields are domain/operational contract. Treat as typed values.

---

# 34. Soft Delete dan State Modeling

## 34.1 Boolean soft delete

```sql
is_deleted BOOLEAN NOT NULL DEFAULT FALSE
```

Simple but limited.

## 34.2 Timestamp soft delete

```sql
deleted_at TIMESTAMP NULL
```

Better audit.

## 34.3 State column

```sql
state VARCHAR(20) NOT NULL
```

may represent lifecycle.

## 34.4 Invariant issue

If `deleted_at` not null, state should maybe be DELETED.

Use constraints or domain methods.

## 34.5 Query filters

Soft delete requires consistent filters.

## 34.6 Unique constraints

Soft delete can complicate uniqueness.

Example: allow same email after deletion? Need partial unique index or policy.

## 34.7 Rule

Soft delete is state modeling, not just boolean.

---

# 35. JPA Entity vs Domain Model vs Read Model

## 35.1 JPA entity

Persistence lifecycle object.

May be mutable, proxyable, framework-shaped.

## 35.2 Domain model

Business invariant and behavior.

May be separate from JPA entity.

## 35.3 Read model/projection

Optimized for query/API response.

```java
record CaseSummary(CaseId id, CaseStatus status, Instant updatedAt) {}
```

## 35.4 Same class for all?

Convenient but can create compromises:

- no-arg constructor;
- mutable setters;
- lazy loading leaks;
- serialization leaks;
- equals/hashCode complexity.

## 35.5 Mapping cost

Separate models require mapping but improve isolation.

## 35.6 Rule

For complex domains, separate persistence model from domain model or at least isolate ORM concerns.

---

# 36. Database Migration dan Type Evolution

## 36.1 Widening column

```sql
VARCHAR(32) -> VARCHAR(64)
```

Usually safe.

## 36.2 Narrowing column

Risk data loss.

Needs validation/backfill.

## 36.3 Changing enum/code

Add new code first; make app tolerant.

## 36.4 Splitting column

Example:

```sql
money VARCHAR -> amount DECIMAL + currency CHAR(3)
```

Migration plan:

1. add new columns nullable;
2. backfill;
3. dual write;
4. switch read;
5. enforce NOT NULL;
6. drop old column.

## 36.5 Nullability change

Nullable -> NOT NULL:

1. backfill;
2. deploy validation;
3. add constraint.

## 36.6 Type conversion

Test rollback and forward compatibility.

## 36.7 Rule

Schema evolution must match application rollout choreography.

---

# 37. Production Failure Modes

## 37.1 BigDecimal precision loss

Column missing precision/scale or wrong scale.

Fix:

- explicit DECIMAL(p,s);
- tests;
- domain Money.

## 37.2 Enum ordinal corruption

Enum reordered.

Fix:

- never ordinal;
- stable code converter.

## 37.3 LocalDateTime audit bug

Stored without timezone, servers in different zones.

Fix:

- Instant/UTC policy.

## 37.4 Nullable primitive default

NULL becomes 0/false.

Fix:

- NOT NULL or wrapper at boundary;
- domain mapping.

## 37.5 Boolean tri-state hidden

`Boolean approved` null meaning unclear.

Fix:

- enum/state.

## 37.6 String length mismatch

Java accepts 300 chars, DB column 255 truncates/fails.

Fix:

- align validation/schema.

## 37.7 Collation mismatch

Email uniqueness differs app vs DB.

Fix:

- search key/functional index/collation policy.

## 37.8 JSON column schema drift

Different app versions write incompatible JSON.

Fix:

- schemaVersion;
- validation;
- migration.

## 37.9 Soft delete unique constraint bug

Deleted row blocks re-registration.

Fix:

- partial unique index or policy.

## 37.10 Converter not applied

Typed ID persisted as object string or fails.

Fix:

- converter tests/integration tests.

## 37.11 Lazy collection serialization

API serialization triggers N+1 or LazyInitializationException.

Fix:

- DTO/projection.

## 37.12 DB default differs from app default

Inconsistent rows depending write path.

Fix:

- single source of default truth.

---

# 38. Best Practices

## 38.1 General

- Treat DB mapping as durable contract.
- Use explicit column types, lengths, precision, scale.
- Mirror critical domain invariants with DB constraints.
- Prefer NOT NULL for required domain fields.
- Avoid enum ordinal persistence.
- Use stable codes for enum-like values.
- Use typed IDs in domain; explicit converters in persistence.
- Use `BigDecimal`/DECIMAL or minor units for money.
- Always include currency for money.
- Use `LocalDate` for DATE.
- Use `Instant`/UTC policy for audit timestamps.
- Store ZoneId when local schedule intent matters.
- Avoid Optional entity fields.
- Avoid raw JSON for core queryable data.
- Use JSON columns deliberately with schema/version.
- Keep large BLOB/CLOB out of normal entity loads.
- Test mapping with real DB.
- Review ORM-generated DDL.
- Plan schema evolution with rollout choreography.

## 38.2 JPA/ORM

- Use AttributeConverter for single-column value objects.
- Use Embeddable or explicit columns for multi-column value objects.
- Avoid records as JPA entities by default.
- Use records for projections/DTOs.
- Keep lazy-loaded entities away from API serialization.
- Be careful with equals/hashCode for entities.

## 38.3 Migration

- Add before remove.
- Backfill before NOT NULL.
- Dual read/write for complex migrations.
- Version serialized JSON payloads.
- Test rollback/forward compatibility.

---

# 39. Decision Matrix

| Java/domain concept | DB recommendation |
|---|---|
| `CaseId(String)` | `VARCHAR(length)` + UNIQUE/PK + converter |
| `UUID` ID | native UUID or BINARY(16)/CHAR(36) |
| required int/long | NOT NULL INTEGER/BIGINT |
| optional numeric | nullable wrapper in persistence + domain mapping |
| money BigDecimal | DECIMAL(p,s) + currency column |
| money minor units | BIGINT minor_units + currency |
| enum stable closed set | VARCHAR code + converter/check/reference |
| dynamic category | reference table |
| `LocalDate` | DATE |
| `Instant` audit | TIMESTAMP with UTC policy / with time zone |
| `LocalDateTime` | TIMESTAMP without zone only if local semantics |
| `ZoneId` | VARCHAR(64) |
| `Duration` | BIGINT with explicit unit or interval |
| `EmailAddress` | VARCHAR + normalized search key + unique constraint |
| `Reason` text | TEXT/CLOB + length policy |
| collection ordered | child table + order column |
| set unique | child table + unique constraint |
| JSON flexible payload | JSON/JSONB + schema version |
| large binary | BLOB/object storage reference |
| value object single column | AttributeConverter |
| value object multi-column | Embeddable/manual mapping |
| read API projection | record DTO/projection |

---

# 40. Latihan

## Latihan 1 — CaseId Converter

Implement `CaseId` and JPA `AttributeConverter<CaseId,String>`. Write round-trip test.

## Latihan 2 — Money Embeddable

Map `Money(amount,currency)` to `amount DECIMAL(19,2)` and `currency_code CHAR(3)`.

## Latihan 3 — Enum Stable Code

Refactor enum persistence from ordinal to stable code. Write migration plan.

## Latihan 4 — LocalDate vs Instant

Map `birthDate` and `createdAt` correctly. Explain why types differ.

## Latihan 5 — Optional Column

Map nullable `secondary_email` to domain Optional accessor without Optional field in entity.

## Latihan 6 — DateRange Constraint

Create `start_date`, `end_date` with check `start_date < end_date`.

## Latihan 7 — Email Search Key

Create `email_original` and `email_search_key`; enforce unique `(tenant_id,email_search_key)`.

## Latihan 8 — JSON Column Versioning

Design JSON payload with `schemaVersion`, write parser for v1/v2.

## Latihan 9 — Soft Delete Unique Constraint

Design uniqueness rule for email with soft delete.

## Latihan 10 — Migration Plan

Migrate `amount VARCHAR` to `amount DECIMAL + currency_code`.

## Latihan 11 — Real DB Test

Use Testcontainers or local DB to verify date/time precision and timezone behavior.

## Latihan 12 — ORM Entity vs Domain

Separate JPA entity from immutable domain snapshot for a case aggregate.

---

# 41. Ringkasan

Database mapping is not mechanical.

It is a contract between:

```text
Java type system
domain invariants
SQL type system
database constraints
query patterns
schema evolution
operational reality
```

Key lessons:

- Java `String` can mean many DB/domain things.
- SQL NULL is not the same as Optional.
- Primitive fields cannot represent DB NULL.
- Boolean is only for two states.
- Money needs amount + currency + precision/scale policy.
- Never persist enum ordinal.
- Use stable enum codes.
- Typed IDs need converters.
- Date/time mapping must distinguish machine time vs human time.
- Store ZoneId when local schedule intent matters.
- Optional is not a persistence field default.
- Collections need relational semantics: order/uniqueness/queryability.
- JSON column is useful but not a replacement for modeling core data.
- DB constraints should mirror critical domain invariants.
- Indexes depend on type and query pattern.
- ORM entity is not always domain model.
- Schema migration is part of type evolution.

Senior Java engineer melihat field seperti:

```java
String status;
BigDecimal amount;
LocalDateTime createdAt;
Boolean active;
```

dan langsung bertanya:

```text
Apa domain meaning-nya?
Apa SQL type-nya?
Nullable tidak?
Precision/scale?
Time zone?
Index/query pattern?
Constraint?
Evolution?
Converter?
Apa yang terjadi jika data masuk dari luar aplikasi?
```

Database mapping yang baik membuat domain model tetap benar bahkan ketika data hidup lebih lama dari proses Java.

---

# 42. Referensi

1. Java SE 25 API — `java.sql.Types`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/Types.html

2. Java SE 25 API — `PreparedStatement`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/PreparedStatement.html

3. Java SE 25 API — `ResultSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/ResultSet.html

4. Jakarta Persistence 3.2 Specification — Attribute Converters  
   https://jakarta.ee/specifications/persistence/3.2/jakarta-persistence-spec-3.2

5. Hibernate ORM User Guide — Basic Types  
   https://docs.jboss.org/hibernate/orm/current/userguide/html_single/Hibernate_User_Guide.html#basic

6. Java SE 25 API — `BigDecimal`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigDecimal.html

7. Java SE 25 API — `Currency`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Currency.html

8. Java SE 25 API — `LocalDate`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/LocalDate.html

9. Java SE 25 API — `Instant`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/Instant.html

10. Java SE 25 API — `UUID`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/UUID.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Data Types — Part 024](./learn-java-data-types-part-024.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Data Types — Part 026](./learn-java-data-types-part-026.md)
