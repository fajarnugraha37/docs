# learn-java-data-types-part-024.md

# Java Data Types — Part 024  
# Serialization Boundary: JSON, Java Serialization, Records, Sealed Types, Schema Evolution, dan Compatibility

> Seri: **Advanced Java Data Types**  
> Bagian: **024**  
> Fokus: memahami serialization sebagai boundary data type: Java object ↔ JSON/XML/binary/message/file/cache. Materi ini membahas DTO vs domain type, Java native serialization, records, sealed polymorphism, type discriminator, schema evolution, backward/forward compatibility, null/default semantics, BigDecimal/date/time/string/enum handling, security, versioning, and production-safe serialization design.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Serialization Boundary Bukan Object Copy](#2-mental-model-serialization-boundary-bukan-object-copy)
3. [Serialization Mengubah Type Menjadi Contract](#3-serialization-mengubah-type-menjadi-contract)
4. [Domain Model vs DTO vs Wire Format](#4-domain-model-vs-dto-vs-wire-format)
5. [Java Native Serialization: `Serializable`](#5-java-native-serialization-serializable)
6. [`serialVersionUID` dan Compatibility](#6-serialversionuid-dan-compatibility)
7. [Records dan Java Serialization](#7-records-dan-java-serialization)
8. [Kenapa Native Java Serialization Jarang Cocok untuk Service Boundary](#8-kenapa-native-java-serialization-jarang-cocok-untuk-service-boundary)
9. [JSON Serialization](#9-json-serialization)
10. [JSON Type Mapping: Primitive, String, Number, Boolean, Object, Array, Null](#10-json-type-mapping-primitive-string-number-boolean-object-array-null)
11. [Null, Missing Field, Default Value](#11-null-missing-field-default-value)
12. [Enum Serialization](#12-enum-serialization)
13. [BigDecimal dan Money Serialization](#13-bigdecimal-dan-money-serialization)
14. [Date/Time Serialization](#14-datetime-serialization)
15. [Optional Serialization](#15-optional-serialization)
16. [Collections dan Map Serialization](#16-collections-dan-map-serialization)
17. [Records sebagai DTO](#17-records-sebagai-dto)
18. [Sealed Types dan Polymorphic Serialization](#18-sealed-types-dan-polymorphic-serialization)
19. [Type Discriminator Design](#19-type-discriminator-design)
20. [Security: Polymorphic Deserialization dan Gadget Risk](#20-security-polymorphic-deserialization-dan-gadget-risk)
21. [Schema Evolution](#21-schema-evolution)
22. [Backward, Forward, dan Full Compatibility](#22-backward-forward-dan-full-compatibility)
23. [Kafka/Event Serialization](#23-kafkaevent-serialization)
24. [Avro, Protobuf, JSON Schema: High-Level Trade-Off](#24-avro-protobuf-json-schema-high-level-trade-off)
25. [Database Serialization: JSON Column, BLOB, Text](#25-database-serialization-json-column-blob-text)
26. [Cache Serialization](#26-cache-serialization)
27. [File Serialization dan Export Format](#27-file-serialization-dan-export-format)
28. [Binary Serialization](#28-binary-serialization)
29. [Validation at Serialization Boundary](#29-validation-at-serialization-boundary)
30. [Versioning Strategy](#30-versioning-strategy)
31. [Canonical Serialization dan Determinism](#31-canonical-serialization-dan-determinism)
32. [Performance Considerations](#32-performance-considerations)
33. [Observability dan Debuggability](#33-observability-dan-debuggability)
34. [Production Failure Modes](#34-production-failure-modes)
35. [Best Practices](#35-best-practices)
36. [Decision Matrix](#36-decision-matrix)
37. [Latihan](#37-latihan)
38. [Ringkasan](#38-ringkasan)
39. [Referensi](#39-referensi)

---

# 1. Tujuan Bagian Ini

Serialization adalah proses mengubah object/data structure menjadi bentuk yang bisa:

- dikirim lewat network;
- disimpan ke file;
- disimpan ke database;
- dikirim ke Kafka;
- disimpan di cache;
- dibaca oleh bahasa/platform lain;
- dibaca oleh versi aplikasi lain.

Contoh:

```java
record CaseClosedEvent(
    CaseId caseId,
    OfficerId closedBy,
    ClosureReason reason,
    Instant occurredAt
) {}
```

Saat diserialisasi ke JSON:

```json
{
  "type": "CASE_CLOSED",
  "caseId": "CASE-000001",
  "closedBy": "OFF-ABC123",
  "reason": "Evidence sufficient",
  "occurredAt": "2026-06-12T03:15:30Z"
}
```

Object domain berubah menjadi **contract**.

Tujuan bagian ini:

- memahami serialization sebagai boundary, bukan detail teknis;
- membedakan domain model, DTO, dan wire format;
- memahami Java native serialization dan risikonya;
- memahami records/sealed types dalam serialization;
- memahami null/missing/default semantics;
- memahami enum/BigDecimal/date/time/Optional/collection mapping;
- memahami polymorphic serialization dan type discriminator;
- memahami schema evolution;
- memahami compatibility untuk event/API/cache/file;
- memahami security/performance pitfalls.

---

# 2. Mental Model: Serialization Boundary Bukan Object Copy

Serialization bukan sekadar “copy object ke JSON”.

Serialization adalah:

```text
mengubah in-memory representation menjadi external representation dengan kontrak jangka panjang.
```

## 2.1 In-memory object

```java
record Money(BigDecimal amount, Currency currency) {}
```

## 2.2 Wire representation

```json
{
  "amount": "10.50",
  "currency": "SGD"
}
```

## 2.3 Contract questions

- Field apa yang wajib?
- Field apa yang optional?
- Null boleh?
- Default value apa?
- Angka dikirim sebagai number atau string?
- Timestamp pakai UTC atau offset?
- Enum pakai name atau code?
- Polymorphic type pakai discriminator apa?
- Apa yang terjadi jika ada field baru?
- Apa yang terjadi jika consumer lama membaca event baru?

## 2.4 Internal representation can change

Domain type bisa berubah:

```java
Money(BigDecimal amount, Currency currency)
```

menjadi:

```java
Money(long minorUnits, Currency currency)
```

Tetapi external contract sebaiknya tetap stabil jika client/consumer bergantung.

## 2.5 Rule

```text
Never accidentally expose internal representation as long-term contract.
```

---

# 3. Serialization Mengubah Type Menjadi Contract

Ketika data keluar dari process, type system Java berhenti menjaga.

Java compiler tahu:

```java
CaseId
OfficerId
Money
Instant
```

JSON hanya melihat:

```json
"CASE-000001"
"OFF-ABC123"
{"amount":"10.50","currency":"SGD"}
"2026-06-12T03:15:30Z"
```

## 3.1 Type information lost

Unless encoded explicitly.

## 3.2 Validation needed on input

External data untrusted.

```java
new CaseId(request.caseId())
```

must validate.

## 3.3 Compatibility matters

Field rename in Java may become wire breaking change.

```java
closedBy -> actorId
```

If JSON field changes, clients break.

## 3.4 Serialization is architecture decision

Not just library annotation.

## 3.5 Domain model should not be forced by wire shape

Use mapper layer when needed.

---

# 4. Domain Model vs DTO vs Wire Format

## 4.1 Domain model

Represents business concepts and invariants.

```java
record CaseId(String value) {}
record ClosureReason(String value) {}
record CaseClosed(CaseId caseId, OfficerId actor, ClosureReason reason, Instant occurredAt) {}
```

## 4.2 DTO

Boundary object designed for transport.

```java
record CaseClosedEventDto(
    String type,
    String caseId,
    String closedBy,
    String reason,
    String occurredAt
) {}
```

## 4.3 Wire format

Actual JSON/Avro/Protobuf/XML bytes.

```json
{
  "type": "CASE_CLOSED",
  "caseId": "CASE-000001",
  "closedBy": "OFF-ABC123",
  "reason": "Evidence sufficient",
  "occurredAt": "2026-06-12T03:15:30Z"
}
```

## 4.4 Why DTO exists

DTO decouples:

- Java naming from wire naming;
- domain invariants from raw input;
- internal representation from compatibility;
- sensitive fields from accidental exposure;
- polymorphic classes from wire type names.

## 4.5 When direct record serialization okay

For internal/private short-lived APIs with tight control, direct serialization can be acceptable.

But for public API/events, prefer explicit DTO/contract.

---

# 5. Java Native Serialization: `Serializable`

`Serializable` is Java's built-in object serialization marker interface.

```java
class User implements Serializable {
    private static final long serialVersionUID = 1L;
}
```

## 5.1 What it does

Serializes object graph in Java-specific binary format.

## 5.2 Pros

- built-in;
- can serialize object graphs;
- preserves some Java-specific structure.

## 5.3 Cons

- Java-specific;
- fragile compatibility;
- security risks;
- hard to evolve;
- not human-readable;
- not suitable for polyglot service APIs;
- can serialize too much object graph;
- may bypass ordinary construction semantics for ordinary classes.

## 5.4 Use cases today

Limited:

- legacy systems;
- RMI/old frameworks;
- local short-lived internal cache with strict control;
- specialized Java-only tooling.

## 5.5 Modern recommendation

Avoid Java native serialization for service/event/API boundary.

Use explicit formats:

- JSON;
- Avro;
- Protobuf;
- JSON Schema;
- database columns;
- explicit binary protocol.

---

# 6. `serialVersionUID` dan Compatibility

`serialVersionUID` identifies class version for Java serialization compatibility.

```java
private static final long serialVersionUID = 1L;
```

## 6.1 If absent

JVM computes one based on class details.

Small changes can change computed value, causing deserialization failure.

## 6.2 Explicit is better

If using Serializable, declare it explicitly.

## 6.3 But not enough

`serialVersionUID` does not solve semantic compatibility.

Changing field meaning still breaks logic even if deserialization succeeds.

## 6.4 Class evolution

Java serialization has rules for adding/removing fields, etc., but it is still fragile and Java-specific.

## 6.5 Rule

If data must live long or cross service boundary, prefer explicit schema/DTO evolution over Java serialization class evolution.

---

# 7. Records dan Java Serialization

A record class that implements `Serializable` is a serializable record.

Java SE 25 `Record` API states serializable records are serialized/deserialized differently than ordinary serializable objects: during deserialization, the record's canonical constructor is invoked, and certain serialization-related methods such as `readObject` and `writeObject` are ignored.

## 7.1 Example

```java
public record CaseId(String value) implements Serializable {
    public CaseId {
        Objects.requireNonNull(value);
        if (!value.matches("CASE-[0-9]{6}")) {
            throw new IllegalArgumentException();
        }
    }
}
```

During deserialization, canonical constructor is invoked, so invariant checks can run.

## 7.2 Benefit

Records align better with serialization as data carriers.

## 7.3 Caveat

Serializable records still use Java native serialization format if using ObjectOutputStream.

That remains Java-specific and often unsuitable for service boundary.

## 7.4 `readObject` ignored

Do not rely on `readObject`/`writeObject` for serializable records.

## 7.5 DTO records

Records are excellent DTOs for JSON/API if mapping is explicit and stable.

---

# 8. Kenapa Native Java Serialization Jarang Cocok untuk Service Boundary

## 8.1 Tight coupling

Consumer must be Java and have compatible classes.

## 8.2 Security

Deserialization of untrusted data can be dangerous.

## 8.3 Evolution

Class changes can break deserialization.

## 8.4 Hidden graph

It may serialize more than intended.

## 8.5 Poor observability

Binary Java serialization is hard to inspect/debug.

## 8.6 Alternatives

- JSON for readability/interoperability;
- Protobuf for compact typed contracts;
- Avro/JSON Schema for schema-registry event systems;
- explicit DB columns;
- custom binary for specialized needs.

---

# 9. JSON Serialization

JSON is common for HTTP APIs, logs, config, events.

JSON data types:

```text
object
array
string
number
boolean
null
```

No native Java type information.

## 9.1 Object

```json
{"caseId": "CASE-000001"}
```

## 9.2 Array

```json
["READ", "WRITE"]
```

## 9.3 Number

```json
123
10.50
```

But number precision differs across languages.

## 9.4 String

Often used for:

- IDs;
- date/time;
- decimals;
- enum codes;
- BigInteger;
- long IDs for JavaScript safety.

## 9.5 Boolean

Good for true/false only. Avoid if there are more states.

## 9.6 Null

Ambiguous. Define carefully.

---

# 10. JSON Type Mapping: Primitive, String, Number, Boolean, Object, Array, Null

## 10.1 Java int/long

JSON number.

But JavaScript clients may lose precision for large long values.

For public APIs, consider string for IDs:

```json
"caseId": "1234567890123456789"
```

## 10.2 BigDecimal

Can be JSON number or string.

String avoids precision/parsing differences:

```json
"amount": "10.50"
```

## 10.3 Instant

Usually ISO string:

```json
"2026-06-12T03:15:30Z"
```

## 10.4 LocalDate

```json
"2026-06-12"
```

## 10.5 Enum

Prefer stable code string:

```json
"status": "CLOSED"
```

or explicit code:

```json
"status": "C"
```

## 10.6 Object

For multi-field value object:

```json
"money": {
  "amount": "10.50",
  "currency": "SGD"
}
```

## 10.7 Array

For ordered collection.

If uniqueness matters, JSON array still cannot enforce uniqueness; validate.

## 10.8 Null

Use only if contract defines it.

---

# 11. Null, Missing Field, Default Value

JSON distinguishes:

```json
{}
{"field": null}
{"field": ""}
{"field": 0}
```

## 11.1 Missing field

Means field absent.

Can mean:

- old producer;
- optional field not set;
- PATCH no change;
- default applied.

## 11.2 Null field

Means explicit null.

Can mean:

- clear value;
- unknown;
- intentionally empty;
- invalid depending contract.

## 11.3 Empty string

Not same as null.

## 11.4 Default value

If reader defaults missing field:

```java
enabled = false
```

is false because producer said false or because field missing?

## 11.5 PATCH problem

Need three states:

```text
no change
set value
clear value
```

Use explicit patch representation, not plain Optional.

## 11.6 Best practice

Document required/optional/nullable/default for every external field.

---

# 12. Enum Serialization

## 12.1 name()

Default libraries often serialize enum name.

```java
enum CaseStatus { DRAFT, CLOSED }
```

JSON:

```json
"CLOSED"
```

## 12.2 Risk

Renaming enum constant breaks wire compatibility.

## 12.3 Stable code

```java
enum CaseStatus {
    DRAFT("D"),
    CLOSED("C");

    private final String code;
}
```

Wire:

```json
"C"
```

## 12.4 Unknown enum value

Consumer should have policy:

- reject;
- map to UNKNOWN;
- route to DLQ;
- ignore if optional.

## 12.5 Do not use ordinal

Never serialize enum ordinal.

Adding/reordering constants breaks data.

## 12.6 Display label

Do not serialize display label as stable value.

Labels change and localize.

---

# 13. BigDecimal dan Money Serialization

## 13.1 BigDecimal as number

```json
10.50
```

Can lose scale depending parser/display.

Some languages parse as binary floating point.

## 13.2 BigDecimal as string

```json
"10.50"
```

Preserves exact decimal text.

Common for financial APIs.

## 13.3 Money object

```json
{
  "amount": "10.50",
  "currency": "SGD"
}
```

## 13.4 Minor units

```json
{
  "minorUnits": 1050,
  "currency": "SGD"
}
```

Good if contract clearly states minor unit.

## 13.5 Rounding

Never rely on implicit rounding in serialization.

## 13.6 Validation

On input:

- amount valid decimal;
- scale allowed;
- currency valid;
- negative allowed or not;
- max value.

---

# 14. Date/Time Serialization

## 14.1 Instant

```json
"2026-06-12T03:15:30Z"
```

Good for machine timestamp.

## 14.2 OffsetDateTime

```json
"2026-06-12T10:15:30+07:00"
```

Good for offset-aware external timestamp.

## 14.3 LocalDate

```json
"2026-06-12"
```

Good for date-only.

## 14.4 LocalDateTime

```json
"2026-06-12T10:15:30"
```

No zone. Use only if intentionally local.

## 14.5 ZonedDateTime

Java string with bracket zone:

```json
"2026-06-12T10:15:30+07:00[Asia/Jakarta]"
```

May not be supported by all clients. Often better separate fields:

```json
{
  "localDateTime": "2026-06-12T10:15:30",
  "zoneId": "Asia/Jakarta"
}
```

## 14.6 Epoch millis

```json
1718171730000
```

Compact but less readable and precision/timezone prone.

## 14.7 Rule

Document semantics, not only format.

---

# 15. Optional Serialization

`Optional<T>` is primarily a return type for Java APIs, not an ideal wire model.

## 15.1 JSON problem

```java
Optional<String> email
```

Could serialize as:

```json
{"email":{"present":true}}
```

or value/null/missing depending library config.

## 15.2 Prefer explicit DTO

```java
record UserResponse(String email) {}
```

where `email` nullable or absent according to API contract.

## 15.3 Missing vs null

Optional cannot naturally represent all boundary states.

## 15.4 Request DTO

Avoid Optional fields in public JSON DTOs unless framework/team convention is clear.

## 15.5 Domain accessor

Domain can return Optional while DTO mapping decides null/missing.

---

# 16. Collections dan Map Serialization

## 16.1 List

JSON array.

Order preserved.

```json
["a","b","c"]
```

## 16.2 Set

JSON array too.

Uniqueness not enforced by JSON.

Validate duplicates on input.

## 16.3 Map

JSON object keys are strings.

```json
{
  "CASE-000001": {...}
}
```

If key is complex/typed, consider array of entries:

```json
[
  {"caseId": "CASE-000001", "value": {...}}
]
```

## 16.4 Null elements

JSON array can contain null.

Decide if allowed.

## 16.5 Empty collection

Prefer:

```json
[]
```

over null for no items.

## 16.6 Large collection

Watch payload size, pagination, streaming.

---

# 17. Records sebagai DTO

Records are excellent DTOs:

```java
public record CaseResponse(
    String caseId,
    String status,
    String updatedAt
) {}
```

## 17.1 Benefits

- immutable components;
- concise;
- generated constructor/accessors;
- clear shape.

## 17.2 Constructor validation

DTO constructors can validate basic non-null/format, but often raw request DTO should allow validation framework to collect multiple errors.

## 17.3 Domain DTO mapping

```java
CaseResponse from(CaseSnapshot snapshot) {
    return new CaseResponse(
        snapshot.id().value(),
        snapshot.status().code(),
        snapshot.updatedAt().toString()
    );
}
```

## 17.4 Record component names

JSON libraries often map component names to field names.

Renaming record component may be wire breaking if serialized directly.

## 17.5 Use explicit annotations/config

For stable public API, explicitly control property names.

---

# 18. Sealed Types dan Polymorphic Serialization

Sealed types represent closed alternatives:

```java
sealed interface PaymentResult permits Captured, Rejected, Failed {}
```

JSON needs to know which subtype.

## 18.1 Without type info

```json
{"paymentId":"P-1"}
```

Cannot know if this is Captured or something else unless shape unique and deserializer uses deduction.

## 18.2 Type discriminator

```json
{
  "type": "CAPTURED",
  "paymentId": "P-1",
  "capturedAt": "2026-06-12T00:00:00Z"
}
```

## 18.3 Stable discriminator

Use stable domain code, not Java class name.

Bad:

```json
"@class": "com.example.payment.Captured"
```

## 18.4 Sealed permits helps code

Java knows permitted classes, but wire format still needs contract.

## 18.5 Jackson polymorphism

Jackson docs describe polymorphic type handling as adding enough type information so deserializer can instantiate appropriate subtype.

## 18.6 Prefer explicit DTO hierarchy

Domain sealed hierarchy may map to DTO sealed hierarchy or one object with discriminator and variant fields.

---

# 19. Type Discriminator Design

A discriminator identifies variant.

## 19.1 Field name

Common:

```json
"type": "CASE_CLOSED"
```

or:

```json
"eventType": "case.closed.v1"
```

## 19.2 Value stability

Discriminator should not depend on class name/package.

## 19.3 Version in type?

Options:

```json
"type": "CASE_CLOSED",
"schemaVersion": 1
```

or:

```json
"type": "case.closed.v1"
```

## 19.4 Variant-specific payload

```json
{
  "type": "CASE_CLOSED",
  "data": {
    "caseId": "CASE-000001"
  }
}
```

## 19.5 Flat vs nested

Flat:

```json
{"type":"X","a":1}
```

Nested:

```json
{"type":"X","data":{"a":1}}
```

Nested can reduce field collisions.

## 19.6 Unknown discriminator

Consumer policy:

- reject 400 for API request;
- DLQ for events;
- ignore if optional stream;
- metrics/alert.

---

# 20. Security: Polymorphic Deserialization dan Gadget Risk

Polymorphic deserialization can be dangerous if input controls class names.

## 20.1 Dangerous pattern

```json
{"@class":"some.malicious.Gadget", ...}
```

If deserializer loads arbitrary class, attacker may exploit gadget chains.

## 20.2 Avoid class-name-based typing

Use logical type codes and whitelist allowed subtypes.

## 20.3 Jackson validator

Jackson provides `PolymorphicTypeValidator` for validating class-name-based subtypes in polymorphic deserialization.

But design should avoid exposing class names to untrusted input whenever possible.

## 20.4 Whitelist

Only allow known subtypes.

Sealed hierarchy helps define known set, but still configure serialization library safely.

## 20.5 Do not deserialize untrusted Java native serialization

Native Java deserialization of untrusted bytes is high risk.

## 20.6 Boundary rule

Input is hostile until validated.

---

# 21. Schema Evolution

Schema evolution is how serialized data changes over time without breaking readers/writers.

Examples:

- add field;
- remove field;
- rename field;
- change type;
- change enum values;
- change required/optional;
- split event type;
- change semantics.

## 21.1 Compatibility depends on format

JSON without schema is flexible but can hide breakage.

Schema-based formats can validate compatibility.

## 21.2 Additive change

Adding optional field usually safest.

## 21.3 Removing field

Breaks consumers expecting it.

## 21.4 Renaming field

Often equivalent to remove + add; breaking unless aliases supported.

## 21.5 Changing type

String to number can break.

## 21.6 Changing meaning

Most dangerous because schema may still pass.

Example:

```text
amount from major units to minor units
```

Field name same, semantics changed: catastrophic.

---

# 22. Backward, Forward, dan Full Compatibility

Confluent Schema Registry docs summarize compatibility rules for Avro, Protobuf, and JSON Schema and state the default compatibility type is BACKWARD.

## 22.1 Backward compatibility

New reader can read old data.

Useful when consumers update before producers or consumers read historical data.

## 22.2 Forward compatibility

Old reader can read new data.

Useful when producers update before consumers.

## 22.3 Full compatibility

Both backward and forward.

## 22.4 None

No compatibility checks.

Dangerous for shared event contracts.

## 22.5 Transitive

Compatibility against all previous versions, not just latest.

Important for long-lived event logs.

## 22.6 Deployment choreography

For events:

```text
1. make consumers tolerant
2. deploy consumers
3. deploy producers emitting new field
4. later remove old field if safe
```

---

# 23. Kafka/Event Serialization

Events are long-lived contracts.

## 23.1 Event as fact

```java
CaseClosed
```

Once published, cannot be changed.

## 23.2 Event schema

Should include:

- eventType;
- eventId;
- occurredAt;
- aggregateId;
- schemaVersion;
- payload;
- metadata.

## 23.3 Avoid domain object direct serialization

Domain object may include fields irrelevant/sensitive/unstable.

Use event DTO.

## 23.4 Unknown fields

Consumers should tolerate unknown fields where format allows.

## 23.5 Ordering and version

Schema evolution must consider old events still in Kafka/log/storage.

## 23.6 DLQ

Invalid/unrecognized event should route to DLQ with observability.

---

# 24. Avro, Protobuf, JSON Schema: High-Level Trade-Off

Confluent Schema Registry supports Avro, Protobuf, and JSON Schema serializers out of the box.

## 24.1 Avro

Common in Kafka ecosystems.

Pros:

- compact binary;
- schema evolution support;
- schema registry integration;
- good for data pipelines.

Cons:

- schema-first/IDL complexity;
- generic records can be awkward;
- logical types need care.

## 24.2 Protobuf

Pros:

- compact;
- language-neutral;
- field numbers help compatibility;
- strong tooling.

Cons:

- field number management;
- defaults/presence semantics require understanding;
- JSON mapping has nuances.

## 24.3 JSON Schema

Pros:

- human-readable JSON;
- web/API alignment;
- validation friendly.

Cons:

- larger payload;
- schema evolution rules can be tricky;
- number precision issues.

## 24.4 Choose by ecosystem

Do not choose serialization format only by speed.

Consider:

- consumers;
- tooling;
- compatibility;
- observability;
- schema registry;
- language support;
- governance.

## 24.5 Internal vs external

HTTP public APIs often JSON/OpenAPI.

Kafka internal streams may use Avro/Protobuf/JSON Schema.

---

# 25. Database Serialization: JSON Column, BLOB, Text

## 25.1 JSON column

Useful for flexible variant payloads.

Pros:

- easy to store nested structure;
- schema flexibility;
- some DBs support JSON indexing.

Cons:

- weaker relational constraints;
- migration complexity;
- query complexity;
- application-level validation needed.

## 25.2 BLOB binary

Use for opaque binary data.

Cons:

- hard to inspect/query;
- migration pain;
- security scanning/validation.

## 25.3 Text serialized object

```sql
payload TEXT
```

May be okay for event/outbox payload.

## 25.4 Relational columns

For core queryable data, prefer explicit columns.

## 25.5 Version field

If storing serialized payload, store schema/version.

## 25.6 Do not store Java serialized blobs casually

Hard to evolve/debug and Java-specific.

---

# 26. Cache Serialization

Distributed caches may serialize values.

## 26.1 Local cache

May store object reference directly.

Mutability matters.

## 26.2 Remote cache

Serializes/deserializes.

Contract matters.

## 26.3 Version mismatch

App version A writes cache value. Version B reads it.

Need compatibility or cache invalidation.

## 26.4 TTL

Serialized cached data can outlive deployment.

## 26.5 Cache key serialization

Keys must be stable.

Bad:

```java
toString()
```

if toString can change.

## 26.6 Cache strategy

For complex incompatible change, change cache namespace/version prefix.

---

# 27. File Serialization dan Export Format

Files can outlive software versions.

## 27.1 Human-readable

CSV/JSON useful for export/debug.

## 27.2 Machine-readable

Parquet/Avro/Protobuf/custom binary for large data.

## 27.3 Include version

```json
{
  "formatVersion": 1,
  "data": [...]
}
```

## 27.4 Locale

Do not serialize localized date/number as machine format.

## 27.5 CSV pitfalls

- commas;
- quotes;
- newlines;
- encoding;
- date format;
- decimal separator;
- leading zeros;
- Excel auto-conversion.

## 27.6 Encoding

Use UTF-8 explicitly.

---

# 28. Binary Serialization

Binary formats are useful when:

- payload size matters;
- speed matters;
- schema tooling available;
- cross-language support needed.

Examples:

- Protobuf;
- Avro;
- MessagePack;
- CBOR;
- FlatBuffers;
- custom binary.

## 28.1 Pros

- compact;
- faster parsing sometimes;
- schema support depending format.

## 28.2 Cons

- less human-readable;
- tooling needed;
- compatibility discipline;
- debugging harder.

## 28.3 Custom binary

Avoid unless strong reason.

If custom:

- define endianness;
- versioning;
- length prefixes;
- checksums;
- compatibility;
- fuzz testing.

## 28.4 Security

Binary input still untrusted.

Validate lengths and bounds.

## 28.5 Observability

Provide tooling to inspect/decode.

---

# 29. Validation at Serialization Boundary

## 29.1 Inbound

External payload should be validated before domain use.

Steps:

```text
parse syntax
validate schema
validate field constraints
map to domain types
validate domain invariants
```

## 29.2 Outbound

Before emitting event/API response:

- ensure required fields present;
- no sensitive fields;
- correct version;
- stable format;
- valid schema.

## 29.3 Domain constructors

Domain types enforce invariants, but boundary should collect user-friendly errors.

## 29.4 Unknown fields

Policy:

- reject;
- ignore;
- log;
- preserve extension fields.

## 29.5 Size limits

Validate:

- max payload size;
- max array length;
- max string length;
- nesting depth;
- numeric bounds.

## 29.6 Security

Never deserialize and trust.

---

# 30. Versioning Strategy

## 30.1 Field versioning

Add fields optional first.

## 30.2 Type versioning

```json
"type": "case.closed.v1"
```

or:

```json
"type": "CASE_CLOSED",
"version": 1
```

## 30.3 Endpoint versioning

```text
/api/v1/cases
/api/v2/cases
```

## 30.4 Schema registry versioning

Schema ID/version managed centrally.

## 30.5 Consumer-driven contracts

Test provider changes against consumer expectations.

## 30.6 Deprecation

Do not remove immediately.

Plan:

```text
add new
dual write/read
migrate consumers
stop writing old
remove after retention
```

## 30.7 Semantic versioning

Schema version should reflect compatibility.

---

# 31. Canonical Serialization dan Determinism

Sometimes serialized form must be deterministic.

Use cases:

- hashing;
- signing;
- deduplication;
- cache key;
- idempotency key;
- audit comparison.

## 31.1 JSON object order

JSON object order is semantically insignificant, but byte representation differs.

## 31.2 Canonicalization

Define:

- field order;
- number format;
- string normalization;
- timestamp format;
- null omission policy;
- whitespace.

## 31.3 BigDecimal

`1.0` vs `1.00`.

Define canonical representation.

## 31.4 Time

Always UTC? Fraction precision?

## 31.5 Hash key

Do not hash arbitrary JSON serialization unless canonical.

## 31.6 Safer cache keys

Build explicit key:

```java
tenantId + ":" + normalizedQueryHash
```

not generic object JSON.

---

# 32. Performance Considerations

## 32.1 JSON cost

- parsing;
- reflection;
- allocation;
- UTF-8;
- BigDecimal;
- date/time;
- collections.

## 32.2 Binary formats

Can reduce payload size/CPU but may add tooling complexity.

## 32.3 DTO mapping cost

Usually not bottleneck compared to network/DB, but in high-throughput streams it can matter.

## 32.4 Reuse ObjectMapper/JsonMapper

Do not create serializer object per request if expensive.

## 32.5 Streaming

For huge payloads, streaming parser/generator avoids loading entire object graph.

## 32.6 Compression

Compression saves bandwidth but costs CPU.

## 32.7 Measure

Use JFR/profilers/load tests.

---

# 33. Observability dan Debuggability

## 33.1 Human-readable events

JSON easier to debug than binary.

## 33.2 Schema registry

Helps inspect/validate event contracts.

## 33.3 Log payload carefully

Avoid sensitive data.

## 33.4 Redaction

Redact:

- tokens;
- passwords;
- PII;
- secrets;
- large free text.

## 33.5 Event metadata

Include:

- eventId;
- correlationId;
- causationId;
- aggregateId;
- occurredAt;
- schemaVersion.

## 33.6 Failure visibility

Serialization failures should include field path and type, but avoid leaking secrets.

---

# 34. Production Failure Modes

## 34.1 Direct domain serialization leaks field

New internal field appears in API.

Fix:

- explicit DTO;
- serialization tests.

## 34.2 Enum rename breaks clients

Serialized enum name changed.

Fix:

- stable code;
- compatibility test.

## 34.3 BigDecimal as JSON number loses precision

JavaScript client parses as Number.

Fix:

- decimal as string for finance.

## 34.4 LocalDateTime interpreted in client zone

No offset/zone.

Fix:

- Instant/OffsetDateTime or explicit zone contract.

## 34.5 Missing vs null confusion

PATCH clears field unexpectedly.

Fix:

- explicit patch type.

## 34.6 Sealed subtype lacks discriminator

Deserializer cannot instantiate.

Fix:

- stable type discriminator.

## 34.7 Class-name polymorphic deserialization vulnerability

Untrusted payload controls class.

Fix:

- logical discriminator;
- whitelist/validator;
- avoid default typing for untrusted input.

## 34.8 Java serialized blob incompatible after deploy

Class changed.

Fix:

- avoid Java serialization for long-lived/cache/shared data;
- version cache key;
- explicit schema.

## 34.9 Event schema changed breaking old consumer

Producer emits new required field/removes field.

Fix:

- schema compatibility checks;
- rollout choreography.

## 34.10 Cache value version mismatch

New app reads old cached serialized value.

Fix:

- cache namespace version;
- tolerant reader;
- invalidate cache.

## 34.11 Map with non-string key serialized weirdly

JSON object keys become strings.

Fix:

- explicit array-of-entry representation.

## 34.12 Generated record toString used as wire format

Record component change breaks parsing.

Fix:

- never use toString as serialization.

---

# 35. Best Practices

## 35.1 General

- Treat serialization as contract.
- Separate domain model from DTO/wire model for public/shared boundaries.
- Validate inbound data before domain use.
- Use explicit mappers.
- Do not use `toString` for serialization.
- Do not serialize enum ordinal.
- Prefer stable enum/code values.
- Use ISO-8601 for date/time.
- Document null/missing/default semantics.
- Use stable type discriminator for polymorphism.
- Avoid class-name-based polymorphic deserialization for untrusted input.
- Avoid native Java serialization for service/event boundary.
- Version long-lived data formats.
- Test serialization compatibility.
- Redact sensitive fields.
- Measure performance before changing format.

## 35.2 JSON

- Use strings for IDs that may exceed JS safe integer.
- Use strings for exact decimals in financial APIs.
- Use arrays for ordered collections.
- Validate duplicate arrays if representing sets.
- Avoid raw `Map<String,Object>` as domain.
- Limit payload size/nesting.

## 35.3 Events

- Use explicit event DTO.
- Include event metadata.
- Use schema registry/compatibility checks where possible.
- Add fields compatibly.
- Never change field meaning silently.
- Maintain old consumers during rollout.

## 35.4 Records/sealed

- Records are good DTOs, but component names can become contract.
- Serializable records invoke canonical constructor in Java serialization.
- Sealed types need explicit wire discriminator.
- Map domain sealed hierarchy to stable event/API representation.

---

# 36. Decision Matrix

| Situation | Recommended |
|---|---|
| public HTTP API | DTO records + JSON/OpenAPI |
| internal Java-only short-lived object | direct object maybe okay |
| long-lived event stream | schema-based format + versioning |
| Kafka with governance | Avro/Protobuf/JSON Schema + Schema Registry |
| financial decimal | string decimal or minor units |
| timestamp event | ISO Instant UTC string |
| local date | `yyyy-MM-dd` string |
| polymorphic event | stable discriminator + payload |
| enum wire value | stable code string |
| cache value shared across versions | versioned serialized DTO or namespace version |
| DB core queryable fields | relational columns |
| DB flexible payload | JSON column with schema/version |
| secret/sensitive data | explicit redaction/no serialization |
| Java native serialization | avoid except controlled legacy/internal |
| huge payload | streaming/binary/compression after measurement |
| deterministic hash/signature | canonical serialization |

---

# 37. Latihan

## Latihan 1 — Domain vs DTO

Create domain:

```java
record CaseId(String value)
record CaseClosed(CaseId id, ClosureReason reason, Instant occurredAt)
```

Create separate DTO and mapper.

## Latihan 2 — Enum Code

Serialize enum by stable code, not ordinal/name. Add parser for unknown code.

## Latihan 3 — Money JSON

Design Money JSON using amount string + currency. Validate scale.

## Latihan 4 — Date/Time JSON

Serialize `Instant`, `LocalDate`, `ZonedDateTime` correctly. Explain semantics.

## Latihan 5 — Missing vs Null

Design PATCH request for display name with no-change/set/clear.

## Latihan 6 — Sealed Type Discriminator

Create sealed `PaymentResult` and JSON DTO with `type` discriminator.

## Latihan 7 — Unknown Event Type

Implement consumer that routes unknown type to DLQ.

## Latihan 8 — Schema Evolution

Take event v1. Add optional field v2. Explain backward/forward compatibility.

## Latihan 9 — Breaking Change

Rename field and explain why it breaks. Design migration.

## Latihan 10 — Cache Version

Implement cache key prefix:

```text
case-summary:v2:{caseId}
```

## Latihan 11 — Java Serialization Record

Create serializable record with validation in canonical constructor. Serialize/deserialize and observe constructor behavior.

## Latihan 12 — Security Review

Review polymorphic deserialization config and remove class-name-based type exposure.

---

# 38. Ringkasan

Serialization boundary mengubah Java type menjadi external contract.

Core lessons:

- Domain model tidak otomatis cocok menjadi wire format.
- DTO/wire contract harus stabil, eksplisit, dan tervalidasi.
- Native Java serialization jarang cocok untuk service/event boundary.
- Serializable records berbeda dari ordinary serializable objects: canonical constructor dipanggil saat deserialization.
- JSON tidak membawa Java type information.
- Null, missing, empty, default harus dibedakan.
- Enum ordinal tidak boleh diserialisasi.
- BigDecimal/money butuh exact representation.
- Date/time harus punya semantics jelas.
- Optional bukan wire model ideal.
- Sealed types butuh discriminator stabil.
- Polymorphic deserialization harus aman.
- Schema evolution adalah bagian dari desain.
- Events hidup lama; compatibility wajib.
- Cache/file/DB serialized payload juga butuh versioning.
- Performance penting, tapi jangan mengorbankan compatibility/security tanpa data.

Senior Java engineer tidak bertanya hanya:

```text
Bagaimana object ini jadi JSON?
```

Mereka bertanya:

```text
Kontrak apa yang sedang saya buat?
Siapa consumer-nya?
Berapa lama data ini hidup?
Apa yang terjadi saat field berubah?
Apa semantics null/missing?
Apakah aman dari untrusted input?
Bagaimana schema berevolusi?
Bagaimana saya membuktikan compatibility?
```

Serialization adalah boundary architecture, bukan annotation convenience.

---

# 39. Referensi

1. Java SE 25 API — `Record`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Record.html

2. Java SE 25 API — `Serializable`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Serializable.html

3. Java Object Serialization Specification  
   https://docs.oracle.com/en/java/javase/25/docs/specs/serialization/index.html

4. Jackson Docs — Polymorphic Deserialization  
   https://github.com/FasterXML/jackson-docs/wiki/JacksonPolymorphicDeserialization

5. Jackson Databind — `PolymorphicTypeValidator`  
   https://javadoc.io/doc/tools.jackson.core/jackson-databind/latest/tools.jackson.databind/tools/jackson/databind/jsontype/PolymorphicTypeValidator.html

6. Confluent Schema Registry — Schema Evolution and Compatibility  
   https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html

7. Confluent Schema Registry — Supported Formats  
   https://docs.confluent.io/platform/current/schema-registry/index.html

8. Java SE 25 API — `BigDecimal`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigDecimal.html

9. Java SE 25 API — `Instant`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/Instant.html

10. Java SE 25 API — `Optional`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-data-types-part-023.md">⬅️ Java Data Types — Part 023</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-data-types-part-025.md">Java Data Types — Part 025 ➡️</a>
</div>
