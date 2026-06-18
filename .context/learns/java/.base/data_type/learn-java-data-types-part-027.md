# learn-java-data-types-part-027.md

# Java Data Types — Part 027  
# Validation, Constraint, dan Type-Driven Design: Boundary Validation, Domain Invariant, Jakarta Validation, dan Error Modeling

> Seri: **Advanced Java Data Types**  
> Bagian: **027**  
> Fokus: memahami validation bukan sebagai kumpulan `if`, tetapi sebagai desain data type: boundary validation, domain invariants, constraints, fail-fast constructor, parsing result, Jakarta Validation, validation groups, container element constraints, cross-field validation, method validation, API/DB/schema constraints, error modeling, and type-driven design.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Validation vs Invariant](#2-mental-model-validation-vs-invariant)
3. [Validation Layer: Boundary, Application, Domain, Persistence](#3-validation-layer-boundary-application-domain-persistence)
4. [Type-Driven Design: Make Invalid State Unrepresentable](#4-type-driven-design-make-invalid-state-unrepresentable)
5. [Boundary Validation](#5-boundary-validation)
6. [Domain Invariant](#6-domain-invariant)
7. [Constructor Validation dan Fail Fast](#7-constructor-validation-dan-fail-fast)
8. [Factory Method, Parse, dan TryParse](#8-factory-method-parse-dan-tryparse)
9. [Exception vs Validation Result](#9-exception-vs-validation-result)
10. [Jakarta Validation Overview](#10-jakarta-validation-overview)
11. [Common Built-in Constraints](#11-common-built-in-constraints)
12. [`@NotNull`, `@NotEmpty`, `@NotBlank`](#12-notnull-notempty-notblank)
13. [Numeric Constraints](#13-numeric-constraints)
14. [String Constraints dan Regex](#14-string-constraints-dan-regex)
15. [Container Element Constraints](#15-container-element-constraints)
16. [Cascaded Validation: `@Valid`](#16-cascaded-validation-valid)
17. [Validation Groups](#17-validation-groups)
18. [Payload dan Severity](#18-payload-dan-severity)
19. [Custom Constraint Annotation](#19-custom-constraint-annotation)
20. [Cross-Field/Class-Level Validation](#20-cross-fieldclass-level-validation)
21. [Method and Constructor Validation](#21-method-and-constructor-validation)
22. [Records dan Jakarta Validation](#22-records-dan-jakarta-validation)
23. [Validation for Sealed Types](#23-validation-for-sealed-types)
24. [Validation for Collections](#24-validation-for-collections)
25. [Validation for Date/Time](#25-validation-for-datetime)
26. [Validation for Money and Decimal](#26-validation-for-money-and-decimal)
27. [Validation for ID, Code, Email, Name, Reason](#27-validation-for-id-code-email-name-reason)
28. [Validation and Normalization Order](#28-validation-and-normalization-order)
29. [API Schema Validation](#29-api-schema-validation)
30. [Database Constraints](#30-database-constraints)
31. [Validation Error Model](#31-validation-error-model)
32. [Localization and Message Interpolation](#32-localization-and-message-interpolation)
33. [Security Considerations](#33-security-considerations)
34. [Performance Considerations](#34-performance-considerations)
35. [Testing Validation](#35-testing-validation)
36. [Production Failure Modes](#36-production-failure-modes)
37. [Best Practices](#37-best-practices)
38. [Decision Matrix](#38-decision-matrix)
39. [Latihan](#39-latihan)
40. [Ringkasan](#40-ringkasan)
41. [Referensi](#41-referensi)

---

# 1. Tujuan Bagian Ini

Validation sering ditulis seperti ini:

```java
if (request.caseId() == null || request.caseId().isBlank()) {
    throw new BadRequestException("Invalid caseId");
}
if (!request.caseId().matches("CASE-[0-9]{6}")) {
    throw new BadRequestException("Invalid caseId");
}
if (request.reason() == null || request.reason().length() < 10) {
    throw new BadRequestException("Invalid reason");
}
```

Kode ini bekerja, tetapi mudah menjadi:

- tersebar;
- tidak konsisten;
- sulit diuji;
- error message tidak stabil;
- domain object tetap bisa invalid dari jalur lain;
- API validation berbeda dari DB constraint;
- normalization terjadi setelah validation atau sebaliknya tanpa policy;
- invariant domain tidak eksplisit.

Part ini bertujuan membuat validation menjadi bagian dari desain data type.

Kita akan membedakan:

```text
boundary validation:
  memvalidasi input mentah dari luar

domain invariant:
  kondisi yang harus selalu benar untuk object domain valid

schema constraint:
  kontrak API/DB yang ikut menjaga bentuk data

error modeling:
  bagaimana validasi gagal dikomunikasikan
```

Target akhirnya:

```java
record CloseCaseCommand(CaseId caseId, OfficerId actorId, ClosureReason reason) {}
```

Bukan:

```java
record CloseCaseCommand(String caseId, String actorId, String reason) {}
```

Dengan raw strings divalidasi berulang di mana-mana.

---

# 2. Mental Model: Validation vs Invariant

Validation dan invariant sering dicampur, padahal berbeda.

## 2.1 Validation

Validation adalah proses memeriksa input atau state.

```text
Apakah request ini valid?
Apakah field ini formatnya benar?
Apakah data ini boleh diproses?
```

Validation bisa menghasilkan banyak error.

## 2.2 Invariant

Invariant adalah kondisi yang harus selalu benar untuk sebuah object/domain state.

```text
CaseId tidak boleh null dan harus match pattern.
Money harus punya currency.
DateRange start harus sebelum end.
ClosedCase harus punya closedAt dan reason.
```

Jika invariant dilanggar, object seharusnya tidak bisa dibuat.

## 2.3 Boundary validation can be lenient

Boundary validation sering perlu mengumpulkan semua error:

```json
{
  "errors": [
    {"field": "caseId", "code": "REQUIRED"},
    {"field": "reason", "code": "TOO_SHORT"}
  ]
}
```

## 2.4 Domain invariant should be strict

Domain constructor/factory boleh fail fast.

```java
new CaseId(raw)
```

Jika invalid, jangan biarkan object hidup.

## 2.5 Rule

```text
Boundary validation answers: "What is wrong with this input?"
Domain invariant answers: "Can this object exist?"
```

---

# 3. Validation Layer: Boundary, Application, Domain, Persistence

Validation terjadi di beberapa layer.

## 3.1 API boundary

Memeriksa request body/path/query/header.

Examples:

- required fields;
- format;
- max length;
- JSON schema;
- authentication shape;
- pagination bounds.

## 3.2 Application layer

Memeriksa use-case specific rules.

Examples:

- actor allowed to submit command;
- case exists;
- duplicate request;
- feature enabled;
- transition allowed.

## 3.3 Domain layer

Memastikan invariant.

Examples:

- `CaseId` format;
- `Money` same currency;
- `DateRange` valid;
- `ClosureReason` non-blank and length.

## 3.4 Persistence layer

Database constraints.

Examples:

- NOT NULL;
- CHECK;
- UNIQUE;
- FOREIGN KEY;
- precision/scale.

## 3.5 External integration layer

Validates payload from other systems.

Examples:

- Kafka event schema;
- SFTP file row;
- third-party API response;
- webhook signature.

## 3.6 Principle

Validation should be layered, but not duplicated blindly.

```text
Boundary validates user-friendly errors.
Domain validates invariants.
DB validates durable constraints.
```

---

# 4. Type-Driven Design: Make Invalid State Unrepresentable

Best validation is type design that prevents invalid states.

## 4.1 Bad

```java
record CaseRecord(
    String status,
    Instant closedAt,
    String closedReason
) {}
```

Allows:

```text
status = CLOSED, closedAt = null
status = OPEN, closedReason = "done"
status = "CLOESD"
```

## 4.2 Better enum

```java
enum CaseStatus {
    OPEN,
    CLOSED
}
```

Fixes typo but not state-specific fields.

## 4.3 Better sealed state

```java
sealed interface CaseState permits Open, Closed {}

record Open() implements CaseState {}

record Closed(Instant closedAt, ClosureReason reason, OfficerId closedBy) implements CaseState {
    Closed {
        Objects.requireNonNull(closedAt);
        Objects.requireNonNull(reason);
        Objects.requireNonNull(closedBy);
    }
}
```

Now closed data only exists for closed state.

## 4.4 Bad primitive obsession

```java
String email
```

Better:

```java
EmailAddress email
```

## 4.5 Bad boolean flags

```java
boolean approved;
boolean rejected;
```

Better:

```java
enum ApprovalStatus { PENDING, APPROVED, REJECTED }
```

## 4.6 Rule

If an invalid combination can be represented, it will eventually occur.

---

# 5. Boundary Validation

Boundary validation handles raw input.

## 5.1 Request DTO

```java
record CloseCaseRequest(
    String caseId,
    String reason
) {}
```

## 5.2 Validate raw fields

```java
List<FieldError> errors = new ArrayList<>();

if (request.caseId() == null || request.caseId().isBlank()) {
    errors.add(FieldError.required("caseId"));
}
if (request.reason() == null || request.reason().isBlank()) {
    errors.add(FieldError.required("reason"));
}
```

## 5.3 Map to domain only after basic validation

```java
CloseCaseCommand command = new CloseCaseCommand(
    new CaseId(request.caseId()),
    actorId,
    new ClosureReason(request.reason())
);
```

## 5.4 Collect errors

Boundary should often collect many errors rather than fail at first field.

## 5.5 Do not trust client-side validation

Client validation is UX. Server validation is correctness/security.

## 5.6 Keep raw DTO at edge

Do not pass raw DTO deep into domain.

---

# 6. Domain Invariant

Domain invariant should be enforced by type.

## 6.1 CaseId

```java
public record CaseId(String value) {
    private static final Pattern PATTERN = Pattern.compile("^CASE-[0-9]{6}$");

    public CaseId {
        Objects.requireNonNull(value, "value");
        value = value.strip().toUpperCase(Locale.ROOT);
        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid CaseId");
        }
    }
}
```

## 6.2 DateRange

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

## 6.3 Money

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount);
        Objects.requireNonNull(currency);
    }

    public Money add(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("Currency mismatch");
        }
        return new Money(amount.add(other.amount), currency);
    }
}
```

## 6.4 Entity invariant

```java
void close(ClosureReason reason, OfficerId actor, Clock clock) {
    if (state instanceof Closed) {
        throw new IllegalStateException("Case already closed");
    }
    this.state = new Closed(clock.instant(), reason, actor);
}
```

## 6.5 Rule

Domain invariant is not optional documentation. It must be enforced by construction/behavior.

---

# 7. Constructor Validation dan Fail Fast

Constructor validation ensures invalid object cannot exist.

## 7.1 `Objects.requireNonNull`

Java SE 25 `Objects.requireNonNull` checks that object reference is not null and throws `NullPointerException` if it is.

```java
this.id = Objects.requireNonNull(id, "id");
```

## 7.2 Compact constructor

```java
record EmailAddress(String value) {
    EmailAddress {
        value = Objects.requireNonNull(value).strip();
        if (!value.contains("@")) {
            throw new IllegalArgumentException("Invalid email");
        }
    }
}
```

## 7.3 Fail fast

If invalid domain object is programmer error or corrupted data, fail fast.

## 7.4 User input

For user input, direct exception can produce poor UX unless translated to validation error.

Use boundary validation or parser result.

## 7.5 Constructor should not do IO

Bad:

```java
new EmailAddress(raw) // sends verification email
```

Constructor validates structural invariant only.

## 7.6 Rule

Constructor enforces intrinsic invariant, not external business rule requiring repository/network.

---

# 8. Factory Method, Parse, dan TryParse

Sometimes constructor is too blunt.

## 8.1 Constructor

```java
new CaseId(raw)
```

Throws if invalid.

## 8.2 Static factory

```java
CaseId.of(raw)
```

Can express creation semantics.

## 8.3 Parse with exception

```java
CaseId.parse(raw)
```

Good if invalid is exceptional.

## 8.4 TryParse with Optional

```java
Optional<CaseId> tryParse(String raw)
```

Good if only success/failure matters.

## 8.5 Parse result

```java
sealed interface CaseIdParseResult permits ParsedCaseId, InvalidCaseId {}

record ParsedCaseId(CaseId value) implements CaseIdParseResult {}
record InvalidCaseId(String code, String message) implements CaseIdParseResult {}
```

Good if reason needed.

## 8.6 Boundary parser

For API, return field-specific validation errors.

## 8.7 Rule

Choose creation API based on expected failure mode and error detail needs.

---

# 9. Exception vs Validation Result

## 9.1 Exception

Good for:

- programmer error;
- impossible state;
- invariant violation;
- corrupted persisted data;
- unexpected failure.

## 9.2 Validation result

Good for:

- user input;
- API request validation;
- import file row validation;
- batch row processing;
- collecting multiple errors.

## 9.3 Bad use of exception

Throw/catch exception for every invalid CSV row in huge file can be slow/noisy.

Use validation result.

## 9.4 Bad use of result

Returning `Result` from every small domain constructor can make code heavy.

## 9.5 Hybrid

- Boundary validates and accumulates.
- Domain constructor still fail-fast as safety net.
- Application translates invariant exception at boundary if needed.

## 9.6 Rule

Expected invalid external data should be modeled as data, not only exceptions.

---

# 10. Jakarta Validation Overview

Jakarta Validation defines a metadata model and API for JavaBean and method validation; Jakarta Validation 3.1 targets Jakarta EE 11 and clarifies Java Records support.

Hibernate Validator is the reference implementation used widely in Java ecosystems.

## 10.1 Basic idea

Annotate fields/properties/parameters:

```java
public record CreateUserRequest(
    @NotBlank
    @Size(max = 100)
    String displayName,

    @NotBlank
    @Email
    String email
) {}
```

Validate:

```java
Set<ConstraintViolation<CreateUserRequest>> violations =
    validator.validate(request);
```

## 10.2 Strengths

- declarative;
- framework integration;
- reusable constraints;
- message interpolation;
- groups;
- method validation;
- container element constraints;
- custom constraints.

## 10.3 Weaknesses

- annotations can become scattered;
- complex domain rules awkward;
- cross-field validation can become opaque;
- not a replacement for domain invariants;
- validation groups can be overused.

## 10.4 Use cases

Great for:

- API DTO validation;
- form/request validation;
- simple field constraints;
- method parameter validation;
- integration boundary.

## 10.5 Rule

Jakarta Validation is boundary/application validation tool, not the entire domain model.

---

# 11. Common Built-in Constraints

Common constraints include:

```java
@NotNull
@NotEmpty
@NotBlank
@Size
@Min
@Max
@Positive
@PositiveOrZero
@Negative
@NegativeOrZero
@DecimalMin
@DecimalMax
@Digits
@Pattern
@Email
@Past
@PastOrPresent
@Future
@FutureOrPresent
@AssertTrue
@AssertFalse
```

## 11.1 Example

```java
record RegisterRequest(
    @NotBlank
    @Size(max = 100)
    String displayName,

    @NotBlank
    @Email
    @Size(max = 254)
    String email,

    @Min(18)
    int age
) {}
```

## 11.2 Constraint target

Can apply to:

- fields;
- methods/getters;
- constructor parameters;
- method parameters;
- type use;
- class-level.

## 11.3 Provider-specific constraints

Hibernate Validator adds extra constraints. Use them deliberately because they reduce portability.

## 11.4 Constraint message

```java
@NotBlank(message = "displayName is required")
```

But for API, prefer machine-readable error codes in your error model.

## 11.5 Rule

Use built-ins for simple structural checks, not complex business workflows.

---

# 12. `@NotNull`, `@NotEmpty`, `@NotBlank`

These three are often confused.

## 12.1 `@NotNull`

Value cannot be null.

```java
@NotNull
String value;
```

Allows empty string.

## 12.2 `@NotEmpty`

For string/collection/array/map: not null and size > 0.

```java
@NotEmpty
List<String> items;
```

For string, `""` invalid but `"   "` valid.

## 12.3 `@NotBlank`

For string: not null and trimmed/non-whitespace content.

```java
@NotBlank
String name;
```

## 12.4 Common mistake

Using `@NotNull` for user text that should not be blank.

## 12.5 Collections

Use:

```java
@NotEmpty
List<Item> items
```

or:

```java
@Size(min = 1)
List<Item> items
```

## 12.6 Rule

Choose based on actual semantic, not habit.

---

# 13. Numeric Constraints

## 13.1 Integer

```java
@Min(1)
@Max(100)
int size;
```

## 13.2 BigDecimal

```java
@DecimalMin("0.00")
@DecimalMax("9999999.99")
@Digits(integer = 7, fraction = 2)
BigDecimal amount;
```

## 13.3 Positive

```java
@Positive
int count;
```

## 13.4 Zero allowed

```java
@PositiveOrZero
BigDecimal amount;
```

## 13.5 Primitive issue

Primitive int defaults to 0 if missing in deserialization unless configured.

For request DTO, `Integer` may distinguish missing/null from zero.

## 13.6 Rule

For request numeric fields, wrapper often better than primitive if you need required validation.

---

# 14. String Constraints dan Regex

## 14.1 Size

```java
@Size(min = 1, max = 100)
String name;
```

Size for string usually counts Java `char` length, not grapheme clusters.

## 14.2 Pattern

```java
@Pattern(regexp = "^CASE-[0-9]{6}$")
String caseId;
```

## 14.3 Email

```java
@Email
String email;
```

Email validation is pragmatic, not ownership verification.

## 14.4 Regex performance

Use simple regex. Avoid catastrophic backtracking.

## 14.5 Normalize before validate?

Annotation validation usually sees raw value. If normalization needed, handle in mapper/domain type.

## 14.6 Rule

Regex proves format, not semantic existence/authorization.

---

# 15. Container Element Constraints

Jakarta Bean Validation 2.0+ supports constraints on type arguments; Hibernate Validator docs call these container element constraints.

Example:

```java
record BulkCloseRequest(
    @NotEmpty
    List<@NotBlank String> caseIds
) {}
```

## 15.1 Map keys/values

```java
Map<@NotBlank String, @Valid ItemRequest> itemsByCode
```

## 15.2 Optional

```java
Optional<@Email String> email
```

But avoid Optional fields in DTO unless team convention clear.

## 15.3 Nested collection

```java
List<@Valid OrderLineRequest> lines
```

## 15.4 Type use constraints

Requires constraints targeted at `TYPE_USE`.

## 15.5 Rule

If collection is valid only when elements are valid, validate elements explicitly.

---

# 16. Cascaded Validation: `@Valid`

`@Valid` triggers validation of nested object.

```java
record CreateOrderRequest(
    @NotEmpty
    List<@Valid OrderLineRequest> lines
) {}
```

## 16.1 Nested object

```java
record AddressRequest(
    @NotBlank String street,
    @NotBlank String city
) {}

record UserRequest(
    @Valid AddressRequest address
) {}
```

## 16.2 Null nested object

`@Valid` does not imply not null.

Use:

```java
@NotNull
@Valid
AddressRequest address
```

## 16.3 Collections

```java
List<@Valid ItemRequest>
```

## 16.4 Cycles

Cascaded validation can be complex with object graphs.

## 16.5 Rule

Use `@Valid` for nested DTOs, plus `@NotNull` if nested object required.

---

# 17. Validation Groups

Groups let constraints apply in different validation contexts.

```java
interface Create {}
interface Update {}

record UserRequest(
    @NotNull(groups = Update.class)
    String id,

    @NotBlank(groups = Create.class)
    String name
) {}
```

Validate:

```java
validator.validate(request, Create.class);
```

## 17.1 Use cases

- create vs update;
- draft vs submit;
- admin vs public;
- step-based workflow.

## 17.2 Danger

Groups can make validation hard to reason about.

## 17.3 Alternative

Separate DTOs:

```java
CreateUserRequest
UpdateUserRequest
SubmitApplicationRequest
```

Often clearer.

## 17.4 Rule

Use groups for modest variation. Use separate types for different commands.

---

# 18. Payload dan Severity

Jakarta Validation constraint annotations include `message`, `groups`, and `payload`.

Payload can attach metadata to a constraint.

## 18.1 Severity example concept

```java
interface Severity {
    class Info implements Payload {}
    class Error implements Payload {}
}
```

```java
@NotNull(payload = Severity.Error.class)
```

## 18.2 Practical use

Payload is less commonly used than groups/messages.

Could be used to classify violations.

## 18.3 API error model

Many teams map violations to their own error codes/severity outside payload.

## 18.4 Avoid overengineering

Do not use payload unless you have a clear violation processing pipeline.

## 18.5 Rule

Payload is metadata extension, not primary validation logic.

---

# 19. Custom Constraint Annotation

## 19.1 Annotation

```java
@Target({ FIELD, PARAMETER, RECORD_COMPONENT, TYPE_USE })
@Retention(RUNTIME)
@Constraint(validatedBy = CaseIdStringValidator.class)
public @interface CaseIdFormat {
    String message() default "invalid case id";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

## 19.2 Validator

```java
public final class CaseIdStringValidator
        implements ConstraintValidator<CaseIdFormat, String> {

    private static final Pattern PATTERN = Pattern.compile("^CASE-[0-9]{6}$");

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) {
            return true; // let @NotNull handle requiredness
        }
        return PATTERN.matcher(value).matches();
    }
}
```

## 19.3 Null handling

Custom validators often return true for null and rely on `@NotNull` separately.

## 19.4 Reuse domain parser?

Be careful to avoid throwing exceptions for normal validation.

```java
return CaseId.tryParse(value).isPresent();
```

## 19.5 Rule

Custom annotation should validate one clear reusable rule.

---

# 20. Cross-Field/Class-Level Validation

Some rules involve multiple fields.

Example:

```text
startDate < endDate
if status=CLOSED then closedAt required
password == confirmPassword
```

## 20.1 Class-level constraint

```java
@ValidDateRange
record DateRangeRequest(
    LocalDate startDate,
    LocalDate endDate
) {}
```

## 20.2 Validator

```java
public final class ValidDateRangeValidator
        implements ConstraintValidator<ValidDateRange, DateRangeRequest> {

    @Override
    public boolean isValid(DateRangeRequest value, ConstraintValidatorContext context) {
        if (value == null) return true;
        if (value.startDate() == null || value.endDate() == null) return true;
        return value.startDate().isBefore(value.endDate());
    }
}
```

## 20.3 Add field-specific violation

Use `ConstraintValidatorContext` to attach violation to `endDate`.

## 20.4 Alternative domain type

Instead of cross-field validation everywhere, map to:

```java
DateRange
```

which enforces invariant.

## 20.5 Rule

Cross-field validation at boundary is good; domain should still use a type that cannot be invalid.

---

# 21. Method and Constructor Validation

Jakarta Validation supports method and constructor validation.

Example:

```java
public void assign(
    @NotNull CaseId caseId,
    @NotNull OfficerId officerId
) {}
```

Return value validation:

```java
@NotNull
public CaseSummary findSummary(...) {}
```

## 21.1 Framework integration

Spring/Jakarta EE can validate method parameters with configuration.

## 21.2 Use cases

- service boundary;
- public API in library;
- controller method;
- scheduled job input.

## 21.3 Limitations

Method validation is not substitute for type invariants.

## 21.4 Performance

Method validation via proxies/interceptors adds overhead.

Usually fine at boundary; avoid in hot internal loops.

## 21.5 Rule

Use method validation at boundaries, not everywhere in core domain.

---

# 22. Records dan Jakarta Validation

Jakarta Validation 3.1 clarifies support for Java Records.

## 22.1 Record component constraints

```java
public record CreateUserRequest(
    @NotBlank String name,
    @Email String email
) {}
```

## 22.2 Constructor validation

Framework can validate record components depending integration.

## 22.3 Compact constructor still useful

For domain record:

```java
record CaseId(String value) {
    CaseId {
        value = Objects.requireNonNull(value).strip();
        if (!PATTERN.matcher(value).matches()) throw ...
    }
}
```

## 22.4 DTO vs domain

Use annotations on DTO records.

Use constructor invariants on domain records.

## 22.5 Rule

Records make validation annotation placement concise, but do not remove need for domain invariants.

---

# 23. Validation for Sealed Types

Sealed types model alternatives.

## 23.1 Validate each variant

```java
sealed interface PaymentRequest permits CardPaymentRequest, BankTransferRequest {}

record CardPaymentRequest(
    @NotBlank String cardToken
) implements PaymentRequest {}

record BankTransferRequest(
    @NotBlank String bankAccountId
) implements PaymentRequest {}
```

## 23.2 Boundary polymorphism

API deserialization must select variant before validation.

## 23.3 Common constraints

Put common fields in parent DTO only if serialization/validation framework supports it clearly.

## 23.4 Exhaustive handling

After validation, switch exhaustively:

```java
switch (request) {
    case CardPaymentRequest card -> ...
    case BankTransferRequest bank -> ...
}
```

## 23.5 Rule

Sealed types reduce invalid combinations by separating variant-specific required data.

---

# 24. Validation for Collections

## 24.1 Non-empty

```java
@NotEmpty
List<@Valid OrderLineRequest> lines
```

## 24.2 Max size

```java
@Size(max = 100)
List<@Valid ItemRequest> items
```

Prevents abuse.

## 24.3 Unique elements

Jakarta Validation has no universal semantic uniqueness for complex objects. Use custom constraint or domain type.

## 24.4 No null elements

```java
List<@NotNull ItemRequest> items
```

## 24.5 Domain type

```java
record NonEmptyList<T>(List<T> values) {
    NonEmptyList {
        values = List.copyOf(values);
        if (values.isEmpty()) throw ...
    }
}
```

## 24.6 Rule

Collection validity includes collection itself and each element.

---

# 25. Validation for Date/Time

## 25.1 Past/Future

```java
@Past
LocalDate birthDate;

@Future
Instant expiresAt;
```

## 25.2 Clock provider

Jakarta Validation uses clock provider for time-based constraints.

Configure for testability if needed.

## 25.3 Date range

Use cross-field validation or `DateRange` type.

## 25.4 Time zone

`LocalDateTime` validation without zone can be ambiguous.

## 25.5 Business date

Business rules like “must be working day” require domain service/calendar, not simple annotation.

## 25.6 Rule

Use annotations for simple temporal constraints; use domain services/types for business calendars.

---

# 26. Validation for Money and Decimal

## 26.1 Amount

```java
@NotNull
@Digits(integer = 17, fraction = 2)
@PositiveOrZero
BigDecimal amount;
```

## 26.2 Currency

```java
@NotBlank
@Pattern(regexp = "^[A-Z]{3}$")
String currency;
```

## 26.3 Cross-field

Amount scale may depend on currency.

Example JPY scale 0, SGD scale 2.

This requires domain validation, not simple static annotation.

## 26.4 Money type

```java
record Money(BigDecimal amount, Currency currency) {}
```

enforces money invariant.

## 26.5 Rule

Decimal shape can be annotated. Monetary meaning belongs in Money type/policy.

---

# 27. Validation for ID, Code, Email, Name, Reason

## 27.1 ID

```java
@NotBlank
@Pattern(regexp = "^CASE-[0-9]{6}$")
String caseId
```

Domain:

```java
CaseId
```

## 27.2 Code

```java
@Pattern(regexp = "^[A-Z0-9_]{3,64}$")
String policyCode
```

## 27.3 Email

```java
@NotBlank
@Email
@Size(max = 254)
String email
```

Plus verification workflow.

## 27.4 Name

```java
@NotBlank
@Size(max = 200)
String displayName
```

But Unicode code point/grapheme length may need custom validation.

## 27.5 Reason

```java
@NotBlank
@Size(min = 10, max = 2000)
String reason
```

But log/privacy policy belongs elsewhere.

## 27.6 Rule

Annotation validates boundary text; domain type defines canonical meaning.

---

# 28. Validation and Normalization Order

Order matters.

## 28.1 Example

Raw input:

```text
" case-000001 "
```

If validate before normalize:

```text
fails pattern
```

If normalize first:

```text
CASE-000001 passes
```

## 28.2 Decide policy

For IDs, strip + uppercase may be accepted.

For passwords, never trim silently.

For legal names/reasons, do not over-normalize.

## 28.3 Pipeline

```text
raw input
basic type check
normalization/canonicalization
validation
domain object construction
```

or validation before normalization depending security/requirements.

## 28.4 Boundary vs domain

DTO annotation may validate raw value. Domain constructor may normalize.

If API should accept flexible input, mapper may normalize before domain construction.

## 28.5 Rule

Normalization is a domain/security decision, not a random `.trim()`.

---

# 29. API Schema Validation

OpenAPI/JSON Schema constraints should reflect boundary validation.

## 29.1 Example

```yaml
CaseId:
  type: string
  pattern: '^CASE-[0-9]{6}$'
  minLength: 11
  maxLength: 11
```

## 29.2 Required

```yaml
required: [caseId, reason]
```

## 29.3 Nullable

```yaml
type:
  - string
  - 'null'
```

## 29.4 Max array size

```yaml
maxItems: 100
```

## 29.5 Contract tests

Validate examples and real responses against schema.

## 29.6 Rule

If API schema says value is allowed, server should handle it. If server rejects, schema should reflect that.

---

# 30. Database Constraints

DB constraints protect durable data.

## 30.1 NOT NULL

```sql
case_id VARCHAR(11) NOT NULL
```

## 30.2 CHECK

```sql
CHECK (amount >= 0)
CHECK (start_date < end_date)
```

## 30.3 UNIQUE

```sql
UNIQUE (tenant_id, email_search_key)
```

## 30.4 FOREIGN KEY

```sql
currency_code REFERENCES currency(code)
```

## 30.5 Why duplicate domain invariant?

Because data can enter DB outside this code path.

## 30.6 Rule

Critical invariant should exist in both domain and DB when data is durable/shared.

---

# 31. Validation Error Model

Do not return only text.

Bad:

```json
{"error": "Invalid request"}
```

Better:

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

## 31.1 Field

Path to field.

## 31.2 Code

Machine-readable stable code.

## 31.3 Message

Human-readable.

## 31.4 Rejected value?

Be careful. Do not echo secrets/PII.

## 31.5 Multiple errors

Return multiple when possible.

## 31.6 Rule

Validation error is a data type. Design it.

---

# 32. Localization and Message Interpolation

Jakarta Validation supports message interpolation.

```java
@Size(min = 2, max = 14, message = "{license.plate.size}")
```

## 32.1 Message bundle

Messages can be externalized.

## 32.2 API clients

Clients should not parse localized messages.

## 32.3 Stable code

Use error code for logic, localized message for display.

## 32.4 Locale source

Decide locale from:

- Accept-Language;
- user profile;
- tenant config.

## 32.5 Security

Localized messages should not leak internal details.

## 32.6 Rule

Separate machine error code from human message.

---

# 33. Security Considerations

Validation is security boundary.

## 33.1 Size limits

Always limit:

- string length;
- array size;
- nesting depth;
- file size;
- numeric range.

## 33.2 Regex DoS

Avoid catastrophic backtracking.

Use safe regex.

## 33.3 Path traversal

Validate file names/paths carefully.

## 33.4 Injection

Validation is not escaping.

SQL/HTML/LDAP/command injection must be handled by safe APIs/escaping at sink.

## 33.5 PII in errors

Do not echo sensitive values.

## 33.6 Authorization is not validation

A syntactically valid request can still be unauthorized.

## 33.7 Rule

Validation reduces attack surface but does not replace authentication/authorization/output encoding.

---

# 34. Performance Considerations

## 34.1 Annotation validation overhead

Usually fine at API boundary.

Avoid in tight loops.

## 34.2 Regex cost

Precompile patterns where manual validation in hot path.

## 34.3 Exception cost

Do not use exceptions for millions of expected invalid rows.

## 34.4 Batch validation

For imports, collect errors per row with efficient validators.

## 34.5 Fail fast vs collect all

Fail fast reduces work; collect all improves UX.

Choose per context.

## 34.6 Rule

Validation cost is usually worth correctness at boundary. Optimize only measured hot paths.

---

# 35. Testing Validation

## 35.1 Unit tests for domain types

Test valid/invalid values.

```java
assertThrows(IllegalArgumentException.class, () -> new CaseId("bad"));
```

## 35.2 DTO validation tests

Use `Validator` and assert violations.

## 35.3 Boundary tests

HTTP request invalid body returns structured error.

## 35.4 DB constraint tests

Insert invalid data and ensure DB rejects.

## 35.5 Property-based tests

Good for parsers/IDs/date ranges.

## 35.6 Fuzz tests

Useful for regex/parsers/security-sensitive input.

## 35.7 Rule

Every important domain type deserves validation tests.

---

# 36. Production Failure Modes

## 36.1 Only API validates, domain accepts invalid

Batch job bypasses API and creates invalid object.

Fix:

- domain constructor invariant.

## 36.2 Only domain validates, API error poor

User gets generic 500/400.

Fix:

- boundary validation + error model.

## 36.3 DB lacks constraint

Manual SQL inserts invalid row.

Fix:

- DB constraints.

## 36.4 Nullable primitive bug

Missing numeric request becomes 0.

Fix:

- wrapper DTO + `@NotNull`.

## 36.5 `@NotNull` used for blank string

Blank name accepted.

Fix:

- `@NotBlank`.

## 36.6 Optional field validation confusion

Optional empty passes but semantics unclear.

Fix:

- explicit DTO state.

## 36.7 Cross-field invariant missing

`startDate > endDate`.

Fix:

- class-level validation + DateRange.

## 36.8 Regex accepts dangerous input or times out

Fix:

- safe regex; test/fuzz; simpler parser.

## 36.9 Validation groups become unreadable

Different contexts silently skip constraints.

Fix:

- separate DTOs/commands.

## 36.10 Enum unknown value crashes consumer

Fix:

- stable parsing strategy; validation error/DLQ.

## 36.11 Normalization inconsistent

Same email stored with different case/Unicode form.

Fix:

- canonicalization policy and DB unique key.

## 36.12 Error messages leak secrets

Fix:

- don't echo sensitive rejected values.

---

# 37. Best Practices

## 37.1 General

- Distinguish validation from invariant.
- Validate at boundary for user-friendly errors.
- Enforce invariants in domain types.
- Mirror durable invariants in DB constraints.
- Use OpenAPI/JSON Schema to document API constraints.
- Prefer type-driven design over scattered `if`.
- Make invalid states unrepresentable where possible.
- Use Jakarta Validation for DTO/simple constraints.
- Use domain constructors/factories for value objects.
- Use sealed types for variant-specific data.
- Use explicit error model with stable codes.
- Normalize consistently and deliberately.
- Test validation at DTO/domain/DB/API layers.
- Avoid Optional fields/parameters as validation shortcut.
- Avoid validation groups when separate DTOs are clearer.
- Do not use exceptions for expected high-volume invalid input.

## 37.2 Jakarta Validation

- Use `@NotBlank` for required text.
- Use wrapper types for required numeric request fields.
- Use container element constraints for lists/maps.
- Use `@Valid` for nested DTOs.
- Use class-level constraints for cross-field rules.
- Use custom constraints for reusable simple rules.
- Keep complex business rules in domain/application services.

## 37.3 Security

- Limit sizes.
- Avoid unsafe regex.
- Do not echo secrets.
- Validate before parsing deeply.
- Authorization is separate from validation.
- Escape at output/sink, not as generic validation.

---

# 38. Decision Matrix

| Situation | Recommended |
|---|---|
| API request simple field constraints | Jakarta Validation annotations |
| API request nested object | `@Valid` + nested DTO |
| API request list elements | container element constraints |
| cross-field request rule | class-level validator or command parser |
| domain value object invariant | constructor/factory fail-fast |
| external parse with error detail | parse result / validation result |
| optional field in response | explicit optional/nullable schema |
| PATCH field | explicit patch type |
| DB durable invariant | NOT NULL/CHECK/UNIQUE/FK |
| money validation | DTO annotations + Money domain type |
| date range | DateRange type + API/DB constraints |
| complex business rule | domain/application service |
| create vs update validation | separate DTOs, groups only if modest |
| high-volume import invalid rows | validation result, not exceptions |
| polymorphic request | discriminator + sealed DTO variants |
| security-sensitive input | size limits + safe parser + no echo |

---

# 39. Latihan

## Latihan 1 — CaseId

Implement `CaseId` with constructor invariant and `tryParse`.

## Latihan 2 — DTO Validation

Create `CloseCaseRequest` with Jakarta Validation annotations.

## Latihan 3 — Boundary to Domain

Map valid `CloseCaseRequest` to `CloseCaseCommand`.

## Latihan 4 — Validation Error Model

Convert `ConstraintViolation` set to RFC 9457-style validation error JSON.

## Latihan 5 — DateRange

Create class-level validator for request and domain `DateRange`.

## Latihan 6 — Collection Validation

Validate `BulkCloseRequest(List<@Pattern ... String> caseIds)` with min/max items.

## Latihan 7 — Money

Validate request amount/currency then create `Money`.

## Latihan 8 — Groups vs DTO

Implement create/update validation with groups, then refactor into separate DTOs. Compare readability.

## Latihan 9 — DB Constraint

Write SQL constraints for `amount >= 0`, `start_date < end_date`, and unique email search key.

## Latihan 10 — Normalization

Design normalization policy for `PolicyCode`, `EmailAddress`, and `DisplayName`.

## Latihan 11 — Security

Create malicious long input and regex case. Ensure validation is safe.

## Latihan 12 — Sealed Validation

Create sealed payment request variants and validate each variant.

---

# 40. Ringkasan

Validation is not just `if`.

It is type design.

Core distinction:

```text
Boundary validation:
  raw input -> user-friendly error

Domain invariant:
  invalid object cannot exist

Schema constraint:
  API/DB contract prevents invalid external/durable data
```

Key lessons:

- Make invalid state unrepresentable.
- Use domain-specific types for meaningful values.
- Use sealed types for variant-specific states.
- Use Jakarta Validation for boundary DTOs and simple declarative constraints.
- Use constructor/factory validation for domain invariants.
- Use validation result for expected invalid external input.
- Use exceptions for impossible/invariant violations.
- Use DB constraints for durable invariants.
- Normalize deliberately, not randomly.
- Error response shape is a data type.
- Security requires size limits, safe regex, no secret echoing.
- Validation does not replace authorization or output escaping.

Senior Java engineer does not ask only:

```text
Apakah field ini valid?
```

They ask:

```text
Valid di layer mana?
Untuk konteks apa?
Apakah invalid state bisa direpresentasikan?
Apakah constraint ada di API schema?
Apakah invariant ada di domain type?
Apakah DB juga menjaga?
Apa error model-nya?
Bagaimana normalisasi dilakukan?
Apakah aman dari abuse?
```

Validation yang baik membuat codebase lebih benar, lebih aman, lebih mudah berevolusi, dan lebih mudah dioperasikan.

---

# 41. Referensi

1. Jakarta Validation 3.1 Specification  
   https://jakarta.ee/specifications/bean-validation/3.1/

2. Jakarta Bean Validation 3.0 Specification  
   https://jakarta.ee/specifications/bean-validation/3.0/jakarta-bean-validation-spec-3.0.html

3. Hibernate Validator 9.1 Reference Guide  
   https://docs.jboss.org/hibernate/stable/validator/reference/en-US/html_single/

4. Hibernate Validator 9.0 Release Notes  
   https://hibernate.org/validator/releases/9.0/

5. Java SE 25 API — `Objects`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Objects.html

6. Java SE 25 API — `Pattern`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Pattern.html

7. OpenAPI Specification 3.1.1  
   https://spec.openapis.org/oas/v3.1.1.html

8. JSON Schema Draft 2020-12  
   https://json-schema.org/draft/2020-12

9. RFC 9457 — Problem Details for HTTP APIs  
   https://www.rfc-editor.org/rfc/rfc9457.html

10. Java SE 25 API — `Optional`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-data-types-part-026.md](./learn-java-data-types-part-026.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-data-types-part-028.md](./learn-java-data-types-part-028.md)

</div>