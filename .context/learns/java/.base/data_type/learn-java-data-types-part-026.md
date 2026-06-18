# learn-java-data-types-part-026.md

# Java Data Types — Part 026  
# API Contract Data Types: JSON, OpenAPI, Nullability, ID, Decimal, Date-Time, Error Model, dan Compatibility

> Seri: **Advanced Java Data Types**  
> Bagian: **026**  
> Fokus: memahami bagaimana Java data types diterjemahkan menjadi API contract yang stabil: JSON types, OpenAPI/JSON Schema, DTO vs domain, nullability, required/optional fields, ID, integer/decimal precision, enum, date/time, collections, pagination, filtering, errors, Problem Details, versioning, backward compatibility, validation, and client generation.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: API Contract adalah Type System Publik](#2-mental-model-api-contract-adalah-type-system-publik)
3. [Java Type vs JSON Type vs OpenAPI Schema](#3-java-type-vs-json-type-vs-openapi-schema)
4. [Domain Model vs API DTO](#4-domain-model-vs-api-dto)
5. [JSON Data Types](#5-json-data-types)
6. [OpenAPI 3.1 dan JSON Schema](#6-openapi-31-dan-json-schema)
7. [Required, Optional, Nullable, Missing](#7-required-optional-nullable-missing)
8. [String Types: ID, Code, Text, Email, URI](#8-string-types-id-code-text-email-uri)
9. [Numeric Types: integer, long, decimal, money](#9-numeric-types-integer-long-decimal-money)
10. [Boolean dan Tri-State](#10-boolean-dan-tri-state)
11. [Enum dan Stable Code](#11-enum-dan-stable-code)
12. [Date/Time API Types](#12-datetime-api-types)
13. [Arrays, Sets, Lists, dan Uniqueness](#13-arrays-sets-lists-dan-uniqueness)
14. [Map/Object Types](#14-mapobject-types)
15. [Polymorphism: oneOf, anyOf, allOf, discriminator](#15-polymorphism-oneof-anyof-allof-discriminator)
16. [Sealed Types ke API Contract](#16-sealed-types-ke-api-contract)
17. [Request DTO Design](#17-request-dto-design)
18. [Response DTO Design](#18-response-dto-design)
19. [PATCH/Partial Update Data Types](#19-patchpartial-update-data-types)
20. [Pagination, Sorting, Filtering](#20-pagination-sorting-filtering)
21. [Error Data Types dan RFC 9457 Problem Details](#21-error-data-types-dan-rfc-9457-problem-details)
22. [Validation Error Shape](#22-validation-error-shape)
23. [Security-Sensitive Fields](#23-security-sensitive-fields)
24. [Backward and Forward Compatibility](#24-backward-and-forward-compatibility)
25. [API Versioning](#25-api-versioning)
26. [Client Generation and Type Safety](#26-client-generation-and-type-safety)
27. [OpenAPI Schema as Testable Contract](#27-openapi-schema-as-testable-contract)
28. [Serialization Naming Policy](#28-serialization-naming-policy)
29. [Internationalization and Localization](#29-internationalization-and-localization)
30. [Observability and API Debuggability](#30-observability-and-api-debuggability)
31. [Performance and Payload Size](#31-performance-and-payload-size)
32. [Production Failure Modes](#32-production-failure-modes)
33. [Best Practices](#33-best-practices)
34. [Decision Matrix](#34-decision-matrix)
35. [Latihan](#35-latihan)
36. [Ringkasan](#36-ringkasan)
37. [Referensi](#37-referensi)

---

# 1. Tujuan Bagian Ini

Dalam Java, kita bisa punya type kaya:

```java
record CaseId(String value) {}
record OfficerId(String value) {}
record Money(BigDecimal amount, Currency currency) {}
record BusinessDate(LocalDate value) {}
record CloseCaseCommand(CaseId caseId, OfficerId actorId, ClosureReason reason) {}
```

Tetapi API HTTP/JSON biasanya hanya melihat:

```json
{
  "caseId": "CASE-000001",
  "actorId": "OFF-ABC123",
  "reason": "Evidence sufficient"
}
```

Java compiler tidak menjaga client TypeScript, Python, Go, atau mobile app.

Karena itu API contract harus mendeskripsikan type secara eksplisit:

- field required atau optional;
- nullable atau tidak;
- string pattern;
- numeric range;
- decimal precision;
- enum values;
- date/time format;
- array constraints;
- polymorphic discriminator;
- error response shape;
- compatibility rules.

Tujuan bagian ini:

- memahami API contract sebagai public type system;
- mapping Java/domain type ke JSON/OpenAPI;
- membedakan domain model dan API DTO;
- memahami null/missing/default;
- mendesain ID, decimal, money, enum, date/time;
- mendesain request/response/PATCH/pagination/error data types;
- memahami compatibility dan versioning;
- menghindari production bugs akibat API type yang lemah.

---

# 2. Mental Model: API Contract adalah Type System Publik

Internal Java type system hanya berlaku di dalam service.

API contract adalah type system untuk dunia luar.

```text
Java domain type -> DTO -> JSON schema/OpenAPI -> generated client type -> consumer code
```

## 2.1 Contract lebih tahan lama dari code

Java class bisa refactor setiap minggu.

API contract bisa hidup bertahun-tahun karena client bergantung.

## 2.2 Wire compatibility matters

Mengubah:

```json
"caseId": "CASE-000001"
```

menjadi:

```json
"id": "CASE-000001"
```

bisa breaking walaupun Java refactor terlihat kecil.

## 2.3 API field name is public

Nama field JSON adalah public API.

## 2.4 API data type is public

Mengubah integer menjadi string, nullable menjadi required, atau enum value adalah contract change.

## 2.5 Rule

```text
Never let internal refactoring accidentally become API breaking change.
```

---

# 3. Java Type vs JSON Type vs OpenAPI Schema

## 3.1 Java type

```java
CaseId
BigDecimal
Instant
List<Violation>
Optional<EmailAddress>
```

## 3.2 JSON type

```text
string
number
integer
boolean
object
array
null
```

## 3.3 OpenAPI/JSON Schema

```yaml
type: string
pattern: '^CASE-[0-9]{6}$'
maxLength: 11
```

## 3.4 Mapping is not always one-to-one

Java `long` might become JSON string if JavaScript precision risk.

Java `BigDecimal` might become JSON string for exact decimal.

Java `Instant` becomes RFC 3339 date-time string.

Java `Set<T>` becomes JSON array plus uniqueness validation if needed.

## 3.5 Domain type must be projected

```java
CaseId -> string + pattern
Money -> object { amount: string, currency: string }
BusinessDate -> string format date
```

## 3.6 OpenAPI schema is executable documentation

It can generate:

- docs;
- client code;
- server stubs;
- validators;
- contract tests;
- mock servers.

---

# 4. Domain Model vs API DTO

## 4.1 Domain model

```java
record CloseCaseCommand(
    CaseId caseId,
    OfficerId actorId,
    ClosureReason reason
) {}
```

## 4.2 API DTO

```java
record CloseCaseRequest(
    String caseId,
    String actorId,
    String reason
) {}
```

## 4.3 Why not expose domain directly?

Because domain type may contain:

- internal fields;
- invariants not aligned with raw input validation;
- sensitive values;
- Java-specific names;
- structures not ideal for client;
- future refactoring risk.

## 4.4 Mapping

```java
CloseCaseCommand toCommand(CloseCaseRequest request) {
    return new CloseCaseCommand(
        new CaseId(request.caseId()),
        new OfficerId(request.actorId()),
        new ClosureReason(request.reason())
    );
}
```

## 4.5 DTO as boundary

DTO can accept raw values and produce validation errors.

Domain model should receive already meaningful values.

## 4.6 Rule

Use DTOs as anti-corruption layer between wire format and domain type system.

---

# 5. JSON Data Types

JSON has limited data types:

```text
object
array
string
number
boolean
null
```

JSON.org describes JSON as a lightweight text data-interchange format that is easy for humans to read/write and easy for machines to parse/generate.

## 5.1 Object

```json
{"caseId": "CASE-000001"}
```

## 5.2 Array

```json
["READ", "WRITE"]
```

## 5.3 String

Used for:

- IDs;
- codes;
- date/time;
- exact decimals;
- enum values;
- text.

## 5.4 Number

No distinction between Java int/long/double/BigDecimal in plain JSON.

## 5.5 Boolean

Only true/false.

## 5.6 Null

Explicit empty/null value. Different from missing field.

## 5.7 Contract must add meaning

Plain JSON cannot express all constraints. OpenAPI/JSON Schema adds constraints.

---

# 6. OpenAPI 3.1 dan JSON Schema

OpenAPI Specification provides a formal standard for describing HTTP APIs. OpenAPI 3.1 aligns its Schema Object more closely with JSON Schema 2020-12.

## 6.1 Schema example

```yaml
CaseId:
  type: string
  pattern: '^CASE-[0-9]{6}$'
  minLength: 11
  maxLength: 11
```

## 6.2 Object schema

```yaml
CloseCaseRequest:
  type: object
  required:
    - caseId
    - actorId
    - reason
  properties:
    caseId:
      $ref: '#/components/schemas/CaseId'
    actorId:
      $ref: '#/components/schemas/OfficerId'
    reason:
      $ref: '#/components/schemas/ClosureReason'
  additionalProperties: false
```

## 6.3 JSON Schema type array

JSON Schema supports type as a string or array of strings, so nullable can be represented as:

```yaml
type:
  - string
  - 'null'
```

in OpenAPI 3.1 style.

## 6.4 Required

`required` means property must be present, regardless of whether its value can be null.

## 6.5 oneOf/anyOf/allOf

Used for composition/polymorphism.

## 6.6 Contract linting

Use OpenAPI linter/checker to enforce style.

---

# 7. Required, Optional, Nullable, Missing

This is one of the most important API type topics.

## 7.1 Required

Field must be present.

```yaml
required:
  - caseId
```

## 7.2 Optional

Field may be missing.

```yaml
properties:
  middleName:
    type: string
```

not listed in required.

## 7.3 Nullable

Field may be present with null.

OpenAPI 3.1 / JSON Schema style:

```yaml
type:
  - string
  - 'null'
```

## 7.4 Required but nullable

```json
{"middleName": null}
```

Valid if required and type includes null.

## 7.5 Optional but non-null if present

```yaml
middleName:
  type: string
```

Not required, but if present must be string.

## 7.6 Missing vs null

```json
{}
```

different from:

```json
{"middleName": null}
```

## 7.7 PATCH

PATCH often requires distinguishing:

```text
missing = no change
null = clear
value = set
```

## 7.8 Rule

Never say “optional” when you mean “nullable”. They are different.

---

# 8. String Types: ID, Code, Text, Email, URI

Many API types are JSON strings, but they are not semantically the same.

## 8.1 ID

```yaml
CaseId:
  type: string
  pattern: '^CASE-[0-9]{6}$'
  example: CASE-000001
```

## 8.2 Code

```yaml
CurrencyCode:
  type: string
  pattern: '^[A-Z]{3}$'
  example: SGD
```

## 8.3 Free text

```yaml
ClosureReason:
  type: string
  minLength: 10
  maxLength: 2000
```

## 8.4 Email

```yaml
EmailAddress:
  type: string
  format: email
  maxLength: 254
```

Remember: format email is not full business verification.

## 8.5 URI

```yaml
type: string
format: uri
```

## 8.6 Machine string vs human string

Machine strings:

- caseId;
- status code;
- currency;
- country code.

Use strict pattern/enum.

Human strings:

- name;
- reason;
- comment.

Use length/normalization/security policy.

## 8.7 Rule

Do not model every JSON string as same concept.

---

# 9. Numeric Types: integer, long, decimal, money

## 9.1 JSON number precision problem

JSON number does not encode Java numeric type.

JavaScript `number` cannot exactly represent all 64-bit integers.

## 9.2 IDs as string

For large IDs:

```yaml
CaseNumericId:
  type: string
  pattern: '^[0-9]+$'
```

instead of JSON number.

## 9.3 integer

```yaml
type: integer
format: int32
```

## 9.4 long

```yaml
type: integer
format: int64
```

But beware client language precision.

## 9.5 Decimal

For exact decimal, prefer string:

```yaml
Amount:
  type: string
  pattern: '^-?[0-9]+(\\.[0-9]{1,2})?$'
  example: '10.50'
```

## 9.6 Money

```yaml
Money:
  type: object
  required: [amount, currency]
  properties:
    amount:
      $ref: '#/components/schemas/DecimalAmount'
    currency:
      $ref: '#/components/schemas/CurrencyCode'
```

## 9.7 Floating values

Use number/double for approximate measurements/scores if acceptable.

## 9.8 Rule

If exactness matters, avoid ambiguous JSON number.

---

# 10. Boolean dan Tri-State

## 10.1 Boolean

```yaml
type: boolean
```

Good for true/false.

## 10.2 Boolean blindness

```json
{"active": true}
```

Clear enough.

But:

```json
{"approved": false}
```

Could mean rejected? pending? not reviewed?

## 10.3 Tri-state

Do not use nullable boolean if states have domain meaning.

Bad:

```yaml
approved:
  type:
    - boolean
    - 'null'
```

if null means pending.

Better:

```yaml
ApprovalStatus:
  type: string
  enum: [PENDING, APPROVED, REJECTED]
```

## 10.4 Feature state

```yaml
FeatureState:
  type: string
  enum: [ENABLED, DISABLED, UNSPECIFIED]
```

## 10.5 Rule

Boolean only when there are exactly two states and names are unambiguous.

---

# 11. Enum dan Stable Code

## 11.1 Enum schema

```yaml
CaseStatus:
  type: string
  enum:
    - DRAFT
    - SUBMITTED
    - CLOSED
```

## 11.2 Stable value

Do not expose display labels.

Bad:

```json
"Under Review"
```

Good:

```json
"UNDER_REVIEW"
```

or stable code:

```json
"UR"
```

## 11.3 Unknown enum value

Clients generated from OpenAPI may fail on new enum values.

Adding enum value can be breaking for strict clients.

## 11.4 Extensible enum pattern

For public APIs, consider:

- document enum extensibility;
- clients handle unknown;
- string code not closed in schema when needed;
- `x-extensible-enum` vendor extension if tooling supports.

## 11.5 Java enum mapping

Java enum may map to stable API code.

Do not expose ordinal.

## 11.6 Rule

Adding enum value is not always non-breaking. Treat carefully.

---

# 12. Date/Time API Types

RFC 3339 defines date and time format for Internet protocols as a profile of ISO 8601.

## 12.1 Instant timestamp

Use string date-time with UTC `Z`.

```yaml
OccurredAt:
  type: string
  format: date-time
  example: '2026-06-12T03:15:30Z'
```

## 12.2 Local date

```yaml
BusinessDate:
  type: string
  format: date
  example: '2026-06-12'
```

## 12.3 Local date-time

Use only if intentionally zone-less.

```yaml
LocalAppointmentDateTime:
  type: string
  example: '2026-06-12T10:00:00'
```

Document zone context separately.

## 12.4 Zoned schedule

```yaml
AppointmentSchedule:
  type: object
  required: [localDateTime, zoneId]
  properties:
    localDateTime:
      type: string
      example: '2026-06-12T10:00:00'
    zoneId:
      type: string
      example: Asia/Jakarta
```

## 12.5 OffsetDateTime

```json
"2026-06-12T10:15:30+07:00"
```

Useful for external timestamp with offset.

## 12.6 Avoid epoch millis unless necessary

Epoch millis is compact but less self-describing.

## 12.7 Rule

Every API date/time field must state whether it is instant, local date, local time, local date-time, offset timestamp, or zoned schedule.

---

# 13. Arrays, Sets, Lists, dan Uniqueness

JSON only has array.

Java distinctions:

```java
List<T>
Set<T>
SequencedCollection<T>
```

need schema constraints.

## 13.1 Ordered list

```yaml
type: array
items:
  $ref: '#/components/schemas/ApprovalStep'
```

Document ordering.

## 13.2 Set

```yaml
type: array
uniqueItems: true
items:
  $ref: '#/components/schemas/Permission'
```

But uniqueness semantics depend on JSON equality, not Java equals.

## 13.3 Non-empty list

```yaml
minItems: 1
```

## 13.4 Max items

Always consider maxItems for public API to prevent abuse.

## 13.5 Null elements

If null elements not allowed, item schema should not include null.

## 13.6 Stable sorting

If response list order matters, document:

```text
sorted by createdAt desc, id asc
```

## 13.7 Rule

JSON array needs extra constraints to represent collection semantics.

---

# 14. Map/Object Types

JSON object property names are strings.

Java:

```java
Map<CaseId, CaseSummary>
```

JSON object:

```json
{
  "CASE-000001": {...}
}
```

## 14.1 Problem

OpenAPI schema for arbitrary typed keys is limited.

## 14.2 Additional properties

```yaml
type: object
additionalProperties:
  $ref: '#/components/schemas/CaseSummary'
```

This says arbitrary string keys.

## 14.3 Pattern properties

JSON Schema supports pattern-based properties, but tooling may vary.

## 14.4 Array of entries

Often clearer:

```json
[
  {"caseId": "CASE-000001", "summary": {...}}
]
```

## 14.5 Ordered map

JSON object order should not be relied on.

Use array if order matters.

## 14.6 Rule

For public APIs, prefer explicit arrays of objects over maps with complex keys unless map semantics are essential.

---

# 15. Polymorphism: oneOf, anyOf, allOf, discriminator

## 15.1 oneOf

Exactly one schema must match.

```yaml
oneOf:
  - $ref: '#/components/schemas/CardPayment'
  - $ref: '#/components/schemas/BankTransferPayment'
```

## 15.2 anyOf

At least one schema must match.

## 15.3 allOf

All schemas apply. Often used for composition, not inheritance magic.

## 15.4 discriminator

OpenAPI 3.1.1 says discriminator cannot change validation result of `oneOf`; it can help make deserialization more efficient and improve error messaging.

## 15.5 Avoid ambiguous schemas

If two oneOf variants can both match, validation fails or becomes confusing.

## 15.6 Rule

Use explicit discriminator property and make each variant schema unambiguous.

---

# 16. Sealed Types ke API Contract

Java sealed type:

```java
sealed interface PaymentResult permits PaymentCaptured, PaymentRejected, PaymentFailed {}
```

API representation:

```yaml
PaymentResult:
  oneOf:
    - $ref: '#/components/schemas/PaymentCaptured'
    - $ref: '#/components/schemas/PaymentRejected'
    - $ref: '#/components/schemas/PaymentFailed'
  discriminator:
    propertyName: type
```

## 16.1 Variant DTO

```yaml
PaymentCaptured:
  type: object
  required: [type, paymentId, capturedAt]
  properties:
    type:
      type: string
      const: CAPTURED
    paymentId:
      type: string
    capturedAt:
      type: string
      format: date-time
```

## 16.2 Stable type

Use `CAPTURED`, not Java class name.

## 16.3 Unknown variants

Adding a new sealed subtype/API variant can break clients.

## 16.4 Internal vs external closed set

Java sealed hierarchy is closed at compile time. API clients may still need tolerant handling for future variants.

## 16.5 Rule

Polymorphic API is a compatibility commitment. Use only when it improves contract clarity.

---

# 17. Request DTO Design

## 17.1 Request accepts raw external values

```java
record CloseCaseRequest(
    String caseId,
    String reason
) {}
```

Then validate/map.

## 17.2 Do not expose internal IDs accidentally

Use public IDs if needed.

## 17.3 Avoid server-generated fields in request

Bad:

```json
{"createdAt":"..."}
```

unless client really controls it.

## 17.4 Required fields

Request should define required fields explicitly.

## 17.5 Unknown fields

Policy:

- reject with `additionalProperties: false`;
- allow for forward compatibility.

For public APIs, strictness vs extensibility is a design decision.

## 17.6 Command style

Request DTO should reflect command intent.

```json
{
  "reason": "Evidence sufficient"
}
```

for endpoint:

```http
POST /cases/{caseId}/close
```

No need to repeat status.

---

# 18. Response DTO Design

## 18.1 Response is read model

Do not return entity directly.

```java
record CaseResponse(
    String caseId,
    String status,
    String createdAt,
    String updatedAt
) {}
```

## 18.2 Hide internal fields

Do not expose:

- DB ID;
- internal version if not contract;
- security flags;
- lazy relations;
- audit internals;
- PII not needed.

## 18.3 Stable shape

Avoid changing response field names.

## 18.4 Links/actions

For REST-ish APIs, response may include allowed actions.

## 18.5 Null policy

Prefer absent/empty collection over null where appropriate.

## 18.6 Rule

Response DTO should be optimized for consumer understanding, not ORM convenience.

---

# 19. PATCH/Partial Update Data Types

PATCH is tricky because field states differ.

## 19.1 Three-state field

```text
missing -> no change
null -> clear
value -> set
```

## 19.2 JSON Merge Patch

JSON Merge Patch has semantics where null removes field. Useful but must be understood.

## 19.3 JSON Patch

RFC 6902 style operations:

```json
[
  {"op":"replace","path":"/displayName","value":"Fajar"}
]
```

## 19.4 Command-specific patch

```json
{
  "displayName": {
    "operation": "SET",
    "value": "Fajar"
  }
}
```

or:

```json
{
  "displayName": "Fajar",
  "clearSecondaryEmail": true
}
```

depending API style.

## 19.5 Optional not enough

Java `Optional<T>` represents present/empty, not missing/null/value precisely in JSON.

## 19.6 Rule

Design PATCH data types explicitly; do not improvise with nullable fields.

---

# 20. Pagination, Sorting, Filtering

## 20.1 Page request

```yaml
PageRequest:
  type: object
  properties:
    page:
      type: integer
      minimum: 0
    size:
      type: integer
      minimum: 1
      maximum: 100
```

## 20.2 Cursor pagination

```json
{
  "cursor": "opaque-token",
  "limit": 50
}
```

Cursor should be opaque string.

## 20.3 Page response

```json
{
  "items": [...],
  "pageInfo": {
    "nextCursor": "...",
    "hasNext": true
  }
}
```

## 20.4 Sorting

Use stable allowed fields:

```text
sort=createdAt:desc,caseId:asc
```

Do not expose raw DB columns.

## 20.5 Filtering

Prefer typed filters.

```json
{
  "status": ["SUBMITTED", "CLOSED"],
  "createdFrom": "2026-01-01T00:00:00Z"
}
```

## 20.6 Rule

Pagination/filtering types are contract too. Bound page sizes.

---

# 21. Error Data Types dan RFC 9457 Problem Details

RFC 9457 defines a "problem detail" format for HTTP APIs to carry machine-readable error details and avoid defining new error formats for every API.

Problem Details standard fields include concepts such as:

```json
{
  "type": "https://example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "Request body contains invalid fields",
  "instance": "/cases/CASE-000001"
}
```

## 21.1 Use stable type URI/code

`type` identifies problem class.

## 21.2 title is human-readable

Do not parse title in clients.

## 21.3 status

HTTP status code.

## 21.4 detail

Human-readable detail.

## 21.5 instance

Specific occurrence URI/path.

## 21.6 Extensions

Add fields like:

```json
{
  "errors": [...]
}
```

## 21.7 Rule

Error response is also data type. Make it stable and machine-readable.

---

# 22. Validation Error Shape

## 22.1 Field errors

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "errors": [
    {
      "field": "caseId",
      "code": "PATTERN_MISMATCH",
      "message": "caseId must match CASE-[0-9]{6}"
    }
  ]
}
```

## 22.2 Path format

Use stable field paths:

```text
caseId
items[0].amount
```

or JSON Pointer:

```text
/items/0/amount
```

## 22.3 Error code

Machine-readable code.

## 22.4 Message

Human-readable, maybe localized.

Clients should rely on code, not message.

## 22.5 Multiple errors

Return multiple validation errors when possible.

## 22.6 Security

Do not echo secrets in error messages.

---

# 23. Security-Sensitive Fields

## 23.1 Never expose secrets

Fields like:

- password;
- token;
- apiKey;
- refreshToken;
- privateKey;
- internal auth claims;

must not appear in response DTO/logs/errors.

## 23.2 Write-only fields

OpenAPI supports `writeOnly`/`readOnly`.

```yaml
password:
  type: string
  writeOnly: true
```

## 23.3 Read-only fields

```yaml
createdAt:
  type: string
  format: date-time
  readOnly: true
```

## 23.4 PII minimization

Only include fields needed by client.

## 23.5 Masking

If partially shown:

```json
"email": "f***@example.com"
```

Name it clearly if masked.

## 23.6 Rule

DTO design is a security boundary.

---

# 24. Backward and Forward Compatibility

## 24.1 Usually safe changes

- add optional response field;
- add optional request field that old clients can omit;
- relax validation carefully;
- add new endpoint;
- add new enum only if clients tolerate unknown.

## 24.2 Breaking changes

- remove field;
- rename field;
- change type;
- make optional field required;
- make nullable non-nullable;
- change date format;
- change enum values;
- change semantic meaning;
- change error shape;
- change pagination semantics.

## 24.3 Response compatibility

Old clients should ignore unknown fields if possible.

But generated clients may behave differently.

## 24.4 Request compatibility

Server must handle old request shapes during migration.

## 24.5 Semantic compatibility

Changing meaning without schema change is still breaking.

Example:

```text
amount from dollars to cents
```

## 24.6 Rule

Compatibility is about consumers, not just schema diff.

---

# 25. API Versioning

## 25.1 URI version

```http
/v1/cases
/v2/cases
```

Simple and visible.

## 25.2 Header version

```http
Accept: application/vnd.example.case-v2+json
```

More complex.

## 25.3 Query version

Usually less preferred.

## 25.4 Field-level evolution

Often better than whole API version for small additive changes.

## 25.5 Deprecation

Document sunset schedule.

## 25.6 Version only when needed

Do not create v2 for every additive change.

## 25.7 Rule

Prefer backward-compatible evolution. Version when contract semantics truly break.

---

# 26. Client Generation and Type Safety

OpenAPI can generate clients.

## 26.1 Type generation impact

Schema choices affect generated types.

Example:

```yaml
type:
  - string
  - 'null'
```

may become:

```typescript
string | null
```

## 26.2 Enum generation

Strict enum can break when server adds value.

## 26.3 additionalProperties

If allowed, generated clients may include index signatures/maps.

## 26.4 oneOf generation

Polymorphic models vary greatly by generator.

## 26.5 Date-time generation

Some generators use string, some Date, some custom.

## 26.6 Rule

Test generated clients as part of API contract.

---

# 27. OpenAPI Schema as Testable Contract

## 27.1 Contract tests

Validate real responses against OpenAPI schema.

## 27.2 Request tests

Validate sample requests.

## 27.3 Golden examples

Keep examples for:

- valid request;
- validation error;
- not found;
- pagination;
- polymorphic variants.

## 27.4 Breaking change detection

Use tools to diff OpenAPI specs.

## 27.5 Consumer-driven contract

Consumers define expectations; provider tests them.

## 27.6 Rule

OpenAPI should not be stale documentation. It should be checked.

---

# 28. Serialization Naming Policy

## 28.1 Java camelCase

```java
caseId
createdAt
```

## 28.2 JSON camelCase

Common:

```json
"caseId": "CASE-000001"
```

## 28.3 snake_case

```json
"case_id": "CASE-000001"
```

Pick one policy.

## 28.4 Do not rename casually

Changing JSON property name is breaking.

## 28.5 Acronyms

Be consistent:

```text
id vs ID
url vs URL
apiKey vs APIKey
```

## 28.6 Rule

JSON property names are public API. Treat like method signatures.

---

# 29. Internationalization and Localization

## 29.1 Do not localize machine fields

Status code:

```json
"CLOSED"
```

not:

```json
"Ditutup"
```

## 29.2 Localized label field

If needed:

```json
{
  "status": "CLOSED",
  "statusLabel": "Ditutup"
}
```

## 29.3 Error messages

Error `code` stable, `message` localizable.

## 29.4 Date/time display

API should generally send machine date/time, client displays localized.

## 29.5 Number formatting

Do not send localized numbers for machine fields.

Bad:

```json
"amount": "1.234,56"
```

## 29.6 Rule

Separate machine value from display label.

---

# 30. Observability and API Debuggability

## 30.1 Include correlation IDs

In error response or headers.

## 30.2 Instance field

Problem Details `instance` helps identify occurrence.

## 30.3 Examples

OpenAPI examples reduce ambiguity.

## 30.4 Redaction

Do not log sensitive request/response raw bodies without redaction.

## 30.5 Field-level error

Make validation failure debuggable.

## 30.6 Rule

Good API data types are easy to debug without leaking secrets.

---

# 31. Performance and Payload Size

## 31.1 Payload size

Large nested DTOs increase latency.

## 31.2 Overfetching

Response includes fields client doesn't need.

Use projection endpoints or query parameters carefully.

## 31.3 Pagination

Never return unbounded arrays.

## 31.4 Compression

HTTP compression helps text JSON but costs CPU.

## 31.5 Binary?

Use binary/Protobuf for high-throughput internal APIs if justified.

## 31.6 JSON streaming

For huge export, stream response instead of building huge object graph.

## 31.7 Rule

Optimize API payload based on measurement and client needs.

---

# 32. Production Failure Modes

## 32.1 Long ID precision loss

JSON number consumed by JS loses precision.

Fix:

- ID as string.

## 32.2 Enum value added breaks generated client

Strict enum cannot parse unknown.

Fix:

- extensible enum policy;
- client fallback;
- versioning.

## 32.3 Null vs missing bug in PATCH

Null clears field unexpectedly.

Fix:

- explicit patch type.

## 32.4 LocalDateTime interpreted as local browser time

No zone.

Fix:

- Instant/OffsetDateTime or explicit zoneId.

## 32.5 BigDecimal sent as JSON number

Client rounds.

Fix:

- decimal as string for exact money.

## 32.6 Direct entity serialization leaks field

Internal field exposed.

Fix:

- DTO layer.

## 32.7 Validation error unstructured

Clients parse message text.

Fix:

- stable error codes.

## 32.8 Map key issue

Java `Map<CaseId,Value>` serialized as object with string keys; generated client weakly typed.

Fix:

- array of entries if public contract needs strong key type.

## 32.9 oneOf ambiguous

Two schemas match same payload.

Fix:

- discriminator + const type + distinct required fields.

## 32.10 additionalProperties surprise

Client sends unknown field accepted silently.

Fix:

- decide strict vs tolerant intentionally.

## 32.11 Field renamed by Java refactor

Record component rename changes JSON.

Fix:

- explicit property annotations and contract tests.

## 32.12 Error response changes

Client error handler breaks.

Fix:

- Problem Details stable shape.

---

# 33. Best Practices

## 33.1 General

- Treat API schema as public type system.
- Use DTOs, not domain/entity direct serialization.
- Make required/optional/nullable explicit.
- Use string IDs for public APIs when precision matters.
- Use stable enum codes.
- Use decimal string or minor units for money.
- Use RFC 3339 date-time strings for instants.
- Use `date` for LocalDate.
- Include zoneId for local scheduled times.
- Bound arrays with maxItems.
- Use explicit error data type.
- Use Problem Details for errors.
- Do not expose secrets.
- Test generated clients.
- Run schema diff/contract tests.
- Avoid breaking changes unless versioned.
- Document semantics, not only format.

## 33.2 OpenAPI

- Reuse component schemas.
- Use examples.
- Use `additionalProperties: false` where strictness desired.
- Use `oneOf` with discriminator for polymorphism.
- Avoid ambiguous schemas.
- Mark readOnly/writeOnly.
- Define constraints: minLength, maxLength, pattern, minimum, maximum, minItems, maxItems.

## 33.3 Compatibility

- Add optional fields instead of renaming/removing.
- Never change field meaning silently.
- Treat enum additions carefully.
- Keep old fields during migration.
- Version API when semantics break.

---

# 34. Decision Matrix

| Domain/Java concept | API contract recommendation |
|---|---|
| typed ID | string + pattern/example |
| DB long public ID | string if JS/client precision risk |
| UUID | string format uuid |
| Money | object `{amount: string, currency: string}` |
| BigDecimal exact | string decimal |
| approximate score | number/double |
| boolean two-state | boolean |
| tri-state | enum string |
| Java enum | stable string code |
| Instant | string format date-time, UTC example |
| LocalDate | string format date |
| LocalDateTime local | string + documented zone context |
| Zoned schedule | localDateTime + zoneId |
| List | array, document order |
| Set | array + uniqueItems true if appropriate |
| Map with typed key | consider array of entries |
| sealed type | oneOf + discriminator + const type |
| Optional field | optional or nullable explicitly, not vague |
| PATCH field | explicit patch semantics |
| validation error | RFC 9457 Problem Details + errors array |
| secret request field | writeOnly |
| server-generated field | readOnly |
| paged response | items + pageInfo/cursor |
| large export | streaming/download format |

---

# 35. Latihan

## Latihan 1 — CaseId Schema

Create OpenAPI schema for:

```java
record CaseId(String value)
```

with pattern and example.

## Latihan 2 — Money Schema

Design Money API type with amount string and currency code.

## Latihan 3 — Instant vs LocalDate

Create schemas for `createdAt` and `businessDate`.

## Latihan 4 — Nullable vs Optional

Model fields:

```text
middleName optional non-null if present
secondaryEmail required but nullable
```

Explain difference.

## Latihan 5 — PATCH

Design update profile request where displayName can be unchanged/set/cleared.

## Latihan 6 — Enum Compatibility

Add enum value and reason about generated clients.

## Latihan 7 — Sealed Result

Map Java sealed payment result to OpenAPI oneOf/discriminator.

## Latihan 8 — Validation Error

Design RFC 9457 validation error with field errors.

## Latihan 9 — Pagination

Design cursor-based list response.

## Latihan 10 — Map Key

Convert `Map<CaseId, CaseSummary>` API response into array of entries.

## Latihan 11 — Contract Test

Write a test that validates sample JSON response against OpenAPI schema.

## Latihan 12 — Breaking Change Review

Take an API DTO, rename field, change decimal type, add enum value. Classify each as breaking/non-breaking.

---

# 36. Ringkasan

API contract adalah type system publik.

Java domain types yang kuat harus diterjemahkan menjadi JSON/OpenAPI schema yang juga kuat.

Hal penting:

- JSON punya type terbatas; OpenAPI/JSON Schema memberi constraints.
- DTO melindungi domain dan contract dari saling bocor.
- Required, optional, nullable, missing adalah konsep berbeda.
- ID sering lebih aman sebagai string.
- Exact decimal/money sebaiknya string/object dengan currency.
- Boolean hanya untuk dua state.
- Enum harus stable dan hati-hati saat ditambah.
- Date/time harus menyatakan semantics: instant, date, local date-time, zone.
- JSON array tidak otomatis berarti Set/List semantics.
- Polymorphism butuh discriminator stabil.
- PATCH butuh explicit three-state design.
- Error response adalah data type; gunakan Problem Details.
- Compatibility bergantung pada consumer, bukan hanya server compile.
- OpenAPI harus diuji, bukan sekadar dokumentasi.

Senior Java engineer melihat API field:

```json
{
  "id": 123,
  "amount": 10.5,
  "status": "Closed",
  "date": "12/06/2026",
  "active": null
}
```

dan langsung bertanya:

```text
Apakah ID aman untuk JS?
Apakah decimal exact?
Apakah status stable machine code?
Format date standar?
Null artinya apa?
Field required?
Client generated type apa?
Apa yang terjadi jika enum bertambah?
```

API data type design yang baik membuat client aman, evolution terkendali, dan bug lintas bahasa jauh berkurang.

---

# 37. Referensi

1. OpenAPI Specification 3.1.1  
   https://spec.openapis.org/oas/v3.1.1.html

2. OpenAPI Specification 3.1.0  
   https://swagger.io/specification/

3. JSON Schema Draft 2020-12  
   https://json-schema.org/draft/2020-12

4. JSON Schema Validation Vocabulary 2020-12  
   https://json-schema.org/draft/2020-12/draft-bhutton-json-schema-validation-00

5. RFC 3339 — Date and Time on the Internet: Timestamps  
   https://datatracker.ietf.org/doc/html/rfc3339

6. RFC 9457 — Problem Details for HTTP APIs  
   https://www.rfc-editor.org/rfc/rfc9457.html

7. JSON.org  
   https://www.json.org/json-en.html

8. Java SE 25 API — `BigDecimal`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigDecimal.html

9. Java SE 25 API — `Instant`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/Instant.html

10. Java SE 25 API — `Optional`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-data-types-part-025.md](./learn-java-data-types-part-025.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-data-types-part-027.md](./learn-java-data-types-part-027.md)

</div>