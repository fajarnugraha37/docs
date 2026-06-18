# learn-java-jakarta-part-015.md

# Bagian 15 — Jakarta Validation (`jakarta.validation`): Contract Validation, Constraints, Groups, dan Integration Boundary

> Target pembaca: Java engineer yang ingin memahami Jakarta Validation bukan sekadar `@NotNull`, `@Size`, dan `@Valid`, tetapi sebagai **contract validation system** yang bisa dipakai di object model, method/constructor, REST boundary, CDI services, persistence lifecycle, dan application workflow.
>
> Fokus bagian ini: mental model validation, built-in constraints, custom constraints, cascaded validation, groups, group sequence, method validation, class-level/cross-parameter constraint, message interpolation, payload, metadata API, integration dengan Jakarta REST/CDI/JPA, error contract, security, performance, testing, dan production failure modes.

---

## Daftar Isi

1. [Orientasi: Apa Itu Jakarta Validation?](#1-orientasi-apa-itu-jakarta-validation)
2. [Mental Model: Validation sebagai Contract Boundary](#2-mental-model-validation-sebagai-contract-boundary)
3. [Jakarta Validation 3.1 dalam Jakarta EE 11](#3-jakarta-validation-31-dalam-jakarta-ee-11)
4. [Dependency, Provider, dan Runtime](#4-dependency-provider-dan-runtime)
5. [Peta API `jakarta.validation`](#5-peta-api-jakartavalidation)
6. [Constraint Basics: Annotation, Validator, Violation](#6-constraint-basics-annotation-validator-violation)
7. [Built-in Constraints](#7-built-in-constraints)
8. [`@NotNull`, `@NotEmpty`, `@NotBlank`: Mirip Tapi Tidak Sama](#8-notnull-notempty-notblank-mirip-tapi-tidak-sama)
9. [Number Constraints: `@Min`, `@Max`, `@DecimalMin`, `@Positive`](#9-number-constraints-min-max-decimalmin-positive)
10. [String/Collection Constraints: `@Size`, `@Pattern`, `@Email`](#10-stringcollection-constraints-size-pattern-email)
11. [Temporal Constraints: `@Past`, `@Future`, `@PastOrPresent`, `@FutureOrPresent`](#11-temporal-constraints-past-future-pastorpresent-futureorpresent)
12. [Boolean Constraints: `@AssertTrue`, `@AssertFalse`](#12-boolean-constraints-asserttrue-assertfalse)
13. [`@Valid`: Cascaded Validation](#13-valid-cascaded-validation)
14. [Container Element Constraints](#14-container-element-constraints)
15. [Records, Immutable DTO, dan Constructor Validation](#15-records-immutable-dto-dan-constructor-validation)
16. [Class-Level Constraint](#16-class-level-constraint)
17. [Cross-Parameter Constraint](#17-cross-parameter-constraint)
18. [Custom Constraint Annotation](#18-custom-constraint-annotation)
19. [`ConstraintValidator`: Implementasi Validasi](#19-constraintvalidator-implementasi-validasi)
20. [`ConstraintValidatorContext`: Custom Violation Path](#20-constraintvalidatorcontext-custom-violation-path)
21. [Groups: Create vs Update vs Patch](#21-groups-create-vs-update-vs-patch)
22. [Group Sequence dan Ordered Validation](#22-group-sequence-dan-ordered-validation)
23. [Group Conversion](#23-group-conversion)
24. [Method dan Constructor Validation](#24-method-dan-constructor-validation)
25. [Return Value Validation](#25-return-value-validation)
26. [Message Interpolation dan Internationalization](#26-message-interpolation-dan-internationalization)
27. [Payload: Metadata Tambahan untuk Constraint](#27-payload-metadata-tambahan-untuk-constraint)
28. [Programmatic Validation: `Validator`, `ValidatorFactory`, `ExecutableValidator`](#28-programmatic-validation-validator-validatorfactory-executablevalidator)
29. [Metadata API](#29-metadata-api)
30. [Jakarta REST Integration](#30-jakarta-rest-integration)
31. [CDI Integration](#31-cdi-integration)
32. [Jakarta Persistence Integration](#32-jakarta-persistence-integration)
33. [Validation vs Business Rule](#33-validation-vs-business-rule)
34. [Validation vs Authorization](#34-validation-vs-authorization)
35. [Validation vs Database Constraints](#35-validation-vs-database-constraints)
36. [Validation Error Contract untuk REST API](#36-validation-error-contract-untuk-rest-api)
37. [PATCH, Partial Update, dan Validation Groups](#37-patch-partial-update-dan-validation-groups)
38. [Security: PII, Regex DoS, dan Over-Validation](#38-security-pii-regex-dos-dan-over-validation)
39. [Performance Engineering](#39-performance-engineering)
40. [Testing Strategy](#40-testing-strategy)
41. [Observability dan Debugging](#41-observability-dan-debugging)
42. [Production Failure Modes](#42-production-failure-modes)
43. [Best Practices dan Anti-Patterns](#43-best-practices-dan-anti-patterns)
44. [Checklist Review](#44-checklist-review)
45. [Case Study 1: Create License Application API](#45-case-study-1-create-license-application-api)
46. [Case Study 2: Update vs Patch Validation](#46-case-study-2-update-vs-patch-validation)
47. [Case Study 3: Domain Rule Salah Ditaruh di Annotation](#47-case-study-3-domain-rule-salah-ditaruh-di-annotation)
48. [Latihan Bertahap](#48-latihan-bertahap)
49. [Mini Project: Jakarta Validation Contract Lab](#49-mini-project-jakarta-validation-contract-lab)
50. [Referensi Resmi](#50-referensi-resmi)

---

# 1. Orientasi: Apa Itu Jakarta Validation?

Jakarta Validation adalah spesifikasi untuk mendeklarasikan dan menjalankan validasi terhadap object, object members, method, constructor, parameter, dan return value.

Contoh paling sederhana:

```java
public record CreateCustomerRequest(
    @NotBlank String name,
    @Email @NotBlank String email,
    @Past LocalDate dateOfBirth
) {}
```

Jika request tidak memenuhi constraint, validation menghasilkan violations.

```text
name must not be blank
email must be a well-formed email address
dateOfBirth must be a past date
```

## 1.1 Apa yang divalidasi?

Jakarta Validation bisa memvalidasi:

- field;
- getter/property;
- class/object;
- method parameter;
- constructor parameter;
- method return value;
- container element seperti `List<@Email String>`;
- nested object melalui `@Valid`.

## 1.2 Kenapa penting?

Karena validation adalah salah satu boundary pertama yang melindungi sistem dari input invalid.

Tanpa validation yang rapi:

- API menerima data rusak;
- business logic penuh `if` defensif;
- error contract tidak konsisten;
- constraint tersebar di controller/service/database;
- user mendapat error membingungkan;
- database constraint menjadi satu-satunya pertahanan;
- security issue seperti oversized payload atau malformed data lebih mudah masuk.

## 1.3 Validation bukan hanya form validation

Banyak engineer menganggap Bean Validation hanya untuk form/request DTO.

Padahal ia bisa dipakai untuk:

- REST request validation;
- method validation di service layer;
- return value validation;
- persistence lifecycle validation;
- domain command validation;
- batch input validation;
- configuration object validation;
- generated client/server contract validation;
- internal API contract.

## 1.4 Nama: Bean Validation vs Jakarta Validation

Versi lama sering disebut Bean Validation.

Pada Jakarta Validation 3.1, nama spesifikasi menjadi **Jakarta Validation**. Namun banyak dokumentasi/tutorial masih memakai istilah “Bean Validation”.

Package modern:

```java
jakarta.validation
jakarta.validation.constraints
```

Bukan:

```java
javax.validation
```

---

# 2. Mental Model: Validation sebagai Contract Boundary

Validation bukan sekadar “cek field”.

Validation adalah cara menyatakan **contract**:

```text
Object ini valid jika memenuhi constraints berikut.
```

## 2.1 Boundary validation

Contoh API boundary:

```java
public record CreateCaseRequest(
    @NotBlank String applicantName,
    @NotBlank String licenseType,
    @Email String contactEmail
) {}
```

Contract:

```text
Sebelum request masuk use case, applicantName dan licenseType wajib ada, contactEmail jika ada harus berbentuk email.
```

## 2.2 Domain invariant vs input validation

Input validation:

```text
field wajib ada, format benar, panjang masuk akal
```

Domain invariant:

```text
case hanya bisa approved jika status sekarang SUBMITTED dan actor punya authority
```

Jangan mencampur keduanya.

## 2.3 Declarative validation

Constraint annotation membuat validation deklaratif:

```java
@NotBlank
@Size(max = 100)
String name
```

Dibanding imperative:

```java
if (name == null || name.isBlank()) throw ...;
if (name.length() > 100) throw ...;
```

## 2.4 Declarative tidak selalu lebih baik

Jika rule membutuhkan:

- database lookup;
- current actor;
- domain state;
- external service;
- transaction;
- business policy;
- temporal workflow;

maka annotation validation mungkin bukan tempat terbaik.

## 2.5 Layered validation

Validation idealnya berlapis:

```text
Transport/API validation
  ↓
Application command validation
  ↓
Domain invariant
  ↓
Database constraint
```

Setiap layer punya responsibility.

## 2.6 Golden rule

> Use Jakarta Validation for structural and contract validation. Use domain/application logic for business decisions.

---

# 3. Jakarta Validation 3.1 dalam Jakarta EE 11

Jakarta Validation 3.1 adalah release untuk Jakarta EE 11.

Spesifikasi ini mendefinisikan metadata model dan API untuk JavaBean dan method validation.

## 3.1 Apa yang baru/terkait 3.1?

Highlight penting:

- targeting Jakarta EE 11;
- clarified support for Java Records;
- updated dependencies for Jakarta EE 11;
- no removals/deprecations/backwards incompatible changes pada halaman release;
- Java 17 minimum disebut dalam catatan update komunitas/spec lineage.

## 3.2 Jakarta Validation di Java SE dan Jakarta EE

Jakarta Validation dapat dipakai di:

- Jakarta EE container;
- CDI environment;
- Jakarta REST;
- Jakarta Persistence;
- plain Java SE dengan provider seperti Hibernate Validator.

## 3.3 Specification vs provider

`jakarta.validation-api` menyediakan API.

Provider menyediakan implementation.

Contoh provider umum:

- Hibernate Validator;
- Apache BVal;
- provider bawaan Jakarta EE runtime.

## 3.4 API tidak cukup

Jika hanya menambahkan:

```xml
<dependency>
  <groupId>jakarta.validation</groupId>
  <artifactId>jakarta.validation-api</artifactId>
</dependency>
```

belum tentu validation bisa berjalan.

Kamu butuh provider implementation.

## 3.5 Jakarta EE container integration

Dalam Jakarta EE, validation terintegrasi dengan container/services sehingga constraints dapat diterapkan lebih natural di REST, CDI, dan persistence lifecycle.

---

# 4. Dependency, Provider, dan Runtime

## 4.1 Maven API dependency

Untuk compile against API:

```xml
<dependency>
  <groupId>jakarta.validation</groupId>
  <artifactId>jakarta.validation-api</artifactId>
  <version>3.1.0</version>
</dependency>
```

## 4.2 Provider dependency di Java SE

Di Java SE/plain app, tambahkan provider.

Contoh umum:

```xml
<dependency>
  <groupId>org.hibernate.validator</groupId>
  <artifactId>hibernate-validator</artifactId>
  <version>...</version>
</dependency>
```

Versi harus kompatibel dengan Jakarta Validation target.

## 4.3 Dalam Jakarta EE runtime

Dalam Jakarta EE server/runtime, API dan provider biasanya disediakan oleh runtime.

Untuk WAR/container:

```xml
<scope>provided</scope>
```

melalui Jakarta EE platform/web API.

## 4.4 API jar vs provider

API jar berisi:

- annotation;
- interfaces;
- bootstrap API;
- constraint types.

Provider berisi:

- implementation `Validator`;
- metadata parser;
- constraint execution;
- message interpolation;
- value extractor;
- integration behavior.

## 4.5 Dependency mismatch

Common issue:

```text
jakarta.validation-api 3.x
provider lama masih javax.validation
```

atau:

```text
Spring Boot/Jakarta EE runtime membawa provider versi tertentu,
aplikasi override ke versi tidak kompatibel.
```

## 4.6 Namespace migration

Old:

```java
import javax.validation.constraints.NotNull;
```

New:

```java
import jakarta.validation.constraints.NotNull;
```

`javax.validation` dan `jakarta.validation` adalah namespace berbeda.

---

# 5. Peta API `jakarta.validation`

## 5.1 Top-level package

`jakarta.validation` berisi core API seperti:

- `Validation`;
- `Validator`;
- `ValidatorFactory`;
- `ConstraintViolation`;
- `Constraint`;
- `Valid`;
- `GroupSequence`;
- `Payload`;
- `ConstraintValidator`;
- exceptions.

## 5.2 Constraints package

`jakarta.validation.constraints` berisi built-in constraints:

- `@NotNull`;
- `@Null`;
- `@NotEmpty`;
- `@NotBlank`;
- `@Size`;
- `@Min`;
- `@Max`;
- `@DecimalMin`;
- `@DecimalMax`;
- `@Positive`;
- `@PositiveOrZero`;
- `@Negative`;
- `@NegativeOrZero`;
- `@Email`;
- `@Pattern`;
- `@Past`;
- `@PastOrPresent`;
- `@Future`;
- `@FutureOrPresent`;
- `@AssertTrue`;
- `@AssertFalse`;
- `@Digits`.

## 5.3 Bootstrap package

`jakarta.validation.bootstrap` berisi bootstrap-specific objects.

## 5.4 Constraint validator package

`jakarta.validation.constraintvalidation` berisi constructs specific to constraint validators.

## 5.5 Value extraction

Validation juga mendukung value extraction untuk container element validation.

## 5.6 Executable validation

Method/constructor validation memakai `ExecutableValidator`.

---

# 6. Constraint Basics: Annotation, Validator, Violation

## 6.1 Constraint annotation

Constraint biasanya annotation:

```java
@NotBlank
private String name;
```

## 6.2 Constraint validator

Setiap constraint punya validator yang tahu cara mengecek nilai.

Contoh mental model:

```java
class NotBlankValidator implements ConstraintValidator<NotBlank, CharSequence> {
    boolean isValid(CharSequence value, ConstraintValidatorContext context) {
        return value != null && !value.toString().trim().isEmpty();
    }
}
```

Actual implementation milik provider.

## 6.3 Constraint violation

Jika invalid, provider menghasilkan `ConstraintViolation<T>`.

Informasi violation:

- root bean;
- invalid value;
- property path;
- message;
- message template;
- constraint descriptor;
- leaf bean;
- executable parameter/return context.

## 6.4 Null convention

Banyak constraints menganggap `null` sebagai valid kecuali constraint tersebut memang tentang null.

Contoh:

```java
@Email
String email;
```

Jika `email == null`, umumnya valid.

Jika wajib ada dan harus email:

```java
@NotBlank
@Email
String email;
```

## 6.5 Composition

Constraint bisa dikombinasikan:

```java
@NotBlank
@Size(max = 100)
@Pattern(regexp = "[A-Za-z ]+")
String name;
```

## 6.6 Fail fast vs collect all

Default validation biasanya mengumpulkan semua violations.

Provider tertentu bisa mendukung fail-fast mode.

Pilih sesuai UX/performance.

---

# 7. Built-in Constraints

Built-in constraints adalah constraints yang disediakan oleh Jakarta Validation API.

## 7.1 Nullness

```java
@NotNull
@Null
@NotEmpty
@NotBlank
```

## 7.2 Size/content

```java
@Size(min = 1, max = 100)
@Pattern(regexp = "...")
@Email
```

## 7.3 Numeric

```java
@Min(1)
@Max(100)
@DecimalMin("0.01")
@DecimalMax("9999.99")
@Positive
@PositiveOrZero
@Negative
@NegativeOrZero
@Digits(integer = 10, fraction = 2)
```

## 7.4 Temporal

```java
@Past
@PastOrPresent
@Future
@FutureOrPresent
```

## 7.5 Boolean

```java
@AssertTrue
@AssertFalse
```

## 7.6 Selection principle

Pilih constraint yang paling jelas menyatakan contract.

Bad:

```java
@Pattern(regexp = ".+")
String name;
```

Better:

```java
@NotBlank
String name;
```

---

# 8. `@NotNull`, `@NotEmpty`, `@NotBlank`: Mirip Tapi Tidak Sama

Ini salah satu sumber bug paling umum.

## 8.1 `@NotNull`

Valid jika value bukan `null`.

```java
@NotNull
String name;
```

Valid:

```text
""
"   "
"Fajar"
```

Invalid:

```text
null
```

## 8.2 `@NotEmpty`

Valid jika tidak null dan tidak empty.

Untuk String/Collection/Map/Array.

Valid:

```text
" "
"abc"
[1]
```

Invalid:

```text
null
""
[]
```

## 8.3 `@NotBlank`

Valid jika tidak null dan setelah trim/blank check masih punya non-whitespace character.

Untuk CharSequence.

Valid:

```text
"abc"
" a "
```

Invalid:

```text
null
""
"   "
```

## 8.4 Rule of thumb

Untuk required text input:

```java
@NotBlank
String name;
```

Untuk required collection:

```java
@NotEmpty
List<Item> items;
```

Untuk required object:

```java
@NotNull
Address address;
```

## 8.5 Common mistake

```java
@NotNull
String applicantName;
```

User kirim:

```json
{"applicantName":"   "}
```

Valid secara `@NotNull`, tetapi business meaningless.

Gunakan `@NotBlank`.

---

# 9. Number Constraints: `@Min`, `@Max`, `@DecimalMin`, `@Positive`

## 9.1 Integer-like constraints

```java
@Min(1)
@Max(100)
int pageSize;
```

## 9.2 BigDecimal/decimal constraints

```java
@DecimalMin(value = "0.01")
@DecimalMax(value = "999999.99")
BigDecimal amount;
```

Gunakan string untuk menghindari floating precision issue.

## 9.3 Positive/negative

```java
@Positive
BigDecimal price;

@PositiveOrZero
int retryCount;
```

## 9.4 Digits

```java
@Digits(integer = 10, fraction = 2)
BigDecimal amount;
```

Menyatakan precision/scale expectation.

## 9.5 Common mistake: primitive default

```java
@Min(1)
int quantity;
```

Jika field missing pada deserialization, `int` default `0`, lalu violation.

Untuk membedakan missing vs invalid, pakai wrapper:

```java
@NotNull
@Min(1)
Integer quantity;
```

## 9.6 Money

Untuk money:

```java
@NotNull
@DecimalMin("0.00")
@Digits(integer = 12, fraction = 2)
BigDecimal amount;
```

Jangan gunakan `double` untuk money.

---

# 10. String/Collection Constraints: `@Size`, `@Pattern`, `@Email`

## 10.1 `@Size`

```java
@Size(min = 2, max = 100)
String name;

@Size(max = 10)
List<Document> documents;
```

## 10.2 `@Pattern`

```java
@Pattern(regexp = "[A-Z]{3}-\\d{6}")
String caseNumber;
```

## 10.3 Regex caution

Regex can be slow or vulnerable to catastrophic backtracking.

Avoid complex regex for untrusted long input.

## 10.4 `@Email`

```java
@Email
String contactEmail;
```

Remember null may be valid unless combined with `@NotBlank`.

```java
@NotBlank
@Email
String contactEmail;
```

## 10.5 Email validation reality

`@Email` checks format, not deliverability.

It does not prove:

- mailbox exists;
- domain accepts mail;
- user owns email.

Need verification workflow for that.

## 10.6 Size vs database column

If DB column:

```sql
varchar(100)
```

DTO/entity constraint should align:

```java
@Size(max = 100)
String name;
```

But do not rely only on validation. Keep DB constraint.

---

# 11. Temporal Constraints: `@Past`, `@Future`, `@PastOrPresent`, `@FutureOrPresent`

## 11.1 Date of birth

```java
@Past
LocalDate dateOfBirth;
```

## 11.2 Deadline

```java
@FutureOrPresent
Instant dueAt;
```

## 11.3 Clock concern

Temporal validation depends on clock.

Provider determines current time, sometimes configurable via `ClockProvider`.

## 11.4 Time zone concern

`LocalDate`, `OffsetDateTime`, `Instant`, `ZonedDateTime` have different semantics.

For API contracts, be explicit:

- date-only: `LocalDate`;
- timestamp: `Instant` or `OffsetDateTime`;
- user timezone display: application/UI concern.

## 11.5 Business time vs system time

If rule is business-specific:

```text
Application can be submitted until 17:00 Singapore business day.
```

Do not encode only with `@Future`.

Use business calendar/policy service.

---

# 12. Boolean Constraints: `@AssertTrue`, `@AssertFalse`

## 12.1 Terms acceptance

```java
@AssertTrue(message = "terms must be accepted")
boolean acceptedTerms;
```

## 12.2 Internal consistency

Can be used on getter:

```java
@AssertTrue(message = "endDate must be after startDate")
public boolean isDateRangeValid() {
    return endDate == null || startDate == null || endDate.isAfter(startDate);
}
```

## 12.3 Prefer class-level constraint for complex multi-field rule

Getter-based `@AssertTrue` can expose artificial property.

Class-level custom constraint is often cleaner.

## 12.4 Primitive vs wrapper

`boolean` default false.

If user must explicitly choose true/false:

```java
@NotNull
Boolean consent;
```

If user must agree:

```java
@AssertTrue
Boolean consent;
```

Need understand null behavior.

---

# 13. `@Valid`: Cascaded Validation

`@Valid` tells validator to validate nested object.

## 13.1 Example

```java
public record CreateCustomerRequest(
    @NotBlank String name,
    @Valid AddressRequest address
) {}

public record AddressRequest(
    @NotBlank String street,
    @NotBlank String city,
    @NotBlank String postalCode
) {}
```

Without `@Valid`, nested `AddressRequest` constraints may not run.

## 13.2 Collection

```java
public record SubmitOrderRequest(
    @NotEmpty
    List<@Valid OrderItemRequest> items
) {}
```

## 13.3 Map

```java
Map<@NotBlank String, @Valid AttributeRequest> attributes;
```

## 13.4 Cycles

Object graph with cycles can be tricky.

Provider must avoid infinite validation, but design should avoid overly complex validation graphs.

## 13.5 Cascade only where needed

Do not blindly annotate everything with `@Valid` if object graph huge.

It can cause performance issue and unexpected validation.

## 13.6 DTO graph vs entity graph

Validate request DTO graph, not huge JPA entity graph returned from database unless intentionally needed.

---

# 14. Container Element Constraints

Jakarta Validation supports constraints on container elements.

## 14.1 List of email

```java
List<@Email String> emails;
```

## 14.2 Non-empty list with valid elements

```java
@NotEmpty
List<@Valid DocumentRequest> documents;
```

## 14.3 Map key/value

```java
Map<@NotBlank String, @NotBlank String> labels;
```

## 14.4 Optional

```java
Optional<@Email String> email;
```

But be cautious with `Optional` as DTO field. Many teams avoid it in DTO models.

## 14.5 Nested container

```java
List<@NotEmpty List<@Email String>> groupedEmails;
```

Readable? Maybe not.

Simplify model if validation annotation becomes unreadable.

## 14.6 Value extractors

Provider uses value extractors to get elements out of containers.

For custom container types, you may need custom value extractor.

---

# 15. Records, Immutable DTO, dan Constructor Validation

Jakarta Validation 3.1 clarified support for Java Records.

## 15.1 Record DTO

```java
public record CreateLicenseRequest(
    @NotBlank String applicantName,
    @NotBlank String licenseType,
    @Email String contactEmail
) {}
```

Records are excellent for immutable request DTO.

## 15.2 Record component constraints

Constraints on record components describe validation of those components.

## 15.3 Constructor validation

Jakarta Validation supports constructor validation through executable validation.

In Jakarta REST, request entity validation usually occurs after deserialization into DTO.

## 15.4 Record compact constructor

You can still enforce invariants:

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount);
        Objects.requireNonNull(currency);
    }
}
```

But do not duplicate all Jakarta Validation constraints manually unless invariant is always required.

## 15.5 DTO vs value object

DTO validation:

```java
@NotBlank applicantName
```

Value object invariant:

```java
new ApplicantName(value) rejects blank always
```

For domain value objects, constructor/factory invariant is stronger than annotation validation.

---

# 16. Class-Level Constraint

Class-level constraint validates relationship between fields.

## 16.1 Example: date range

```java
@ValidDateRange
public record SearchRequest(
    LocalDate from,
    LocalDate to
) {}
```

Rule:

```text
to must be greater than or equal to from
```

## 16.2 Annotation

```java
@Constraint(validatedBy = DateRangeValidator.class)
@Target(TYPE)
@Retention(RUNTIME)
public @interface ValidDateRange {
    String message() default "invalid date range";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

## 16.3 Validator

```java
public class DateRangeValidator
        implements ConstraintValidator<ValidDateRange, SearchRequest> {

    @Override
    public boolean isValid(SearchRequest value, ConstraintValidatorContext context) {
        if (value == null) return true;
        if (value.from() == null || value.to() == null) return true;
        return !value.to().isBefore(value.from());
    }
}
```

## 16.4 Custom property path

Better violation path:

```text
to: must be after or equal to from
```

rather than object-level generic error.

Use `ConstraintValidatorContext` to build custom violation.

## 16.5 When to use

Use class-level constraints for structural consistency.

Do not use for stateful business decision requiring repository lookup.

---

# 17. Cross-Parameter Constraint

Cross-parameter constraint validates multiple method/constructor parameters together.

## 17.1 Example

```java
public void schedule(
    @NotNull Instant start,
    @NotNull Instant end
) { ... }
```

Need rule:

```text
end must be after start
```

Can use cross-parameter constraint on method.

## 17.2 Why not class-level?

If data exists only as method params and no DTO object, cross-parameter constraint can be useful.

## 17.3 Caution

Cross-parameter validation can be harder to read and test.

Often better to introduce command object:

```java
@ValidSchedule
record ScheduleCommand(Instant start, Instant end) {}
```

## 17.4 Use sparingly

Use cross-parameter constraints for framework/internal API contracts, not as default design for business commands.

---

# 18. Custom Constraint Annotation

Custom constraint lets you define reusable validation annotation.

## 18.1 Example: Case number format

```java
@Constraint(validatedBy = CaseNumberValidator.class)
@Target({ FIELD, PARAMETER, RECORD_COMPONENT })
@Retention(RUNTIME)
public @interface CaseNumber {
    String message() default "invalid case number";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

## 18.2 Required elements

Every constraint annotation must usually define:

```java
String message() default "...";
Class<?>[] groups() default {};
Class<? extends Payload>[] payload() default {};
```

## 18.3 Target

Choose target carefully:

```java
@Target({ FIELD, METHOD, PARAMETER, RECORD_COMPONENT, TYPE_USE })
```

If you want container element support:

```java
List<@CaseNumber String> caseNumbers;
```

include `TYPE_USE`.

## 18.4 Retention

Use runtime retention:

```java
@Retention(RUNTIME)
```

## 18.5 Naming

Good:

```java
@CaseNumber
@LicenseNumber
@ValidDateRange
@AllowedFileType
```

Bad:

```java
@Check1
@ValidString
@MyValidator
```

## 18.6 Message

Default message should be user/developer friendly.

For API, you may map to machine-readable error code separately.

---

# 19. `ConstraintValidator`: Implementasi Validasi

## 19.1 Interface

```java
public class CaseNumberValidator
        implements ConstraintValidator<CaseNumber, String> {

    private static final Pattern PATTERN = Pattern.compile("CASE-[0-9]{8}");

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) return true;
        return PATTERN.matcher(value).matches();
    }
}
```

## 19.2 Null handling convention

Most validators return true for null and let `@NotNull` handle requiredness.

```java
if (value == null) return true;
```

This allows optional field with format constraint:

```java
@CaseNumber
String previousCaseNumber;
```

If required:

```java
@NotBlank
@CaseNumber
String caseNumber;
```

## 19.3 `initialize`

Validator can read annotation attributes:

```java
public class AllowedValuesValidator
        implements ConstraintValidator<AllowedValues, String> {

    private Set<String> allowed;

    @Override
    public void initialize(AllowedValues constraint) {
        this.allowed = Set.of(constraint.value());
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        return value == null || allowed.contains(value);
    }
}
```

## 19.4 Thread safety

Provider may reuse validator instances.

Keep validators thread-safe.

Avoid mutable request-specific state.

## 19.5 CDI injection in validators

Jakarta Validation integrates with CDI. Validators may support dependency injection depending environment/provider.

Use carefully:

- OK for stateless helper/service;
- risky for repository/database lookup;
- can make validation slow/stateful;
- can create cycles.

## 19.6 Do not put remote calls in validator

Bad:

```java
public boolean isValid(String id, Context ctx) {
    return externalService.exists(id);
}
```

This makes validation slow/unreliable and changes failure semantics.

Use application service for existence checks.

---

# 20. `ConstraintValidatorContext`: Custom Violation Path

## 20.1 Default violation

Class-level constraint often reports error at object path:

```text
request: invalid date range
```

Better:

```text
to: must be after from
```

## 20.2 Custom path

```java
context.disableDefaultConstraintViolation();
context.buildConstraintViolationWithTemplate("must be after or equal to from")
    .addPropertyNode("to")
    .addConstraintViolation();
```

## 20.3 Multiple violations

You can add multiple constraint violations.

Example password policy:

```text
password: must contain uppercase
password: must contain digit
```

But too many errors may reveal policy details. Decide UX/security.

## 20.4 Avoid complex path construction unless needed

Simple field constraints usually do not need custom context.

## 20.5 API error mapping

Custom path helps produce clean REST error response:

```json
{
  "field": "to",
  "message": "must be after or equal to from"
}
```

---

# 21. Groups: Create vs Update vs Patch

Validation groups allow different constraints in different contexts.

## 21.1 Define groups

```java
public interface OnCreate {}
public interface OnUpdate {}
public interface OnPatch {}
```

## 21.2 Apply groups

```java
public record CustomerRequest(
    @Null(groups = OnCreate.class)
    @NotNull(groups = OnUpdate.class)
    UUID id,

    @NotBlank(groups = OnCreate.class)
    @Size(max = 100, groups = {OnCreate.class, OnUpdate.class})
    String name
) {}
```

## 21.3 Validate group programmatically

```java
Set<ConstraintViolation<CustomerRequest>> violations =
    validator.validate(request, OnCreate.class);
```

## 21.4 REST group integration

Standard Jakarta REST validation typically validates default group unless framework/provider integration supports group selection via custom mechanism.

For create/update differences, many teams use separate DTOs:

```java
CreateCustomerRequest
UpdateCustomerRequest
PatchCustomerRequest
```

This is often clearer than heavy groups.

## 21.5 Groups can become complex

If group matrix grows:

```text
OnCreate, OnUpdate, OnAdminUpdate, OnPatch, OnInternal, OnExternal
```

maybe DTOs or explicit validators are better.

## 21.6 Rule of thumb

Use groups for small, stable differences.

Use separate DTOs for major contract differences.

---

# 22. Group Sequence dan Ordered Validation

Group sequence defines validation order.

## 22.1 Example

```java
public interface BasicChecks {}
public interface ExpensiveChecks {}

@GroupSequence({BasicChecks.class, ExpensiveChecks.class})
public interface OrderedChecks {}
```

Validate:

```java
validator.validate(request, OrderedChecks.class);
```

If `BasicChecks` fails, `ExpensiveChecks` may not run.

## 22.2 Use cases

- validate cheap syntax before expensive semantic checks;
- avoid noisy error cascade;
- ensure required fields present before cross-field checks.

## 22.3 Danger

Group sequence makes validation flow less obvious.

Document it.

## 22.4 Default group sequence

You can redefine default group sequence for class.

Use carefully; it can surprise other callers.

## 22.5 Prefer simple validation

If ordered validation becomes complex, consider application-level validation pipeline.

---

# 23. Group Conversion

Group conversion changes validation group when cascading to nested object.

## 23.1 Example concept

Parent validates with `OnCreate`, nested object should validate with another group.

```java
@Valid
@ConvertGroup(from = OnCreate.class, to = AddressChecks.class)
AddressRequest address;
```

## 23.2 Why useful?

Different object may define its own groups.

Parent context maps to child context.

## 23.3 Risk

Group conversion can become hard to reason about.

Use when DTO graph is stable and documented.

## 23.4 Alternative

Separate DTOs for request use cases.

---

# 24. Method dan Constructor Validation

Jakarta Validation supports method and constructor validation.

## 24.1 Method parameter constraints

```java
public CaseResult approve(
    @NotNull CaseId caseId,
    @NotNull Actor actor,
    @NotBlank String reason
) { ... }
```

## 24.2 Constructor parameter constraints

```java
public Money(
    @NotNull @DecimalMin("0.00") BigDecimal amount,
    @NotNull Currency currency
) { ... }
```

## 24.3 Automatic method validation

In Jakarta EE/CDI environments, method validation can be integrated with container/interceptors depending component/runtime.

In plain Java, use `ExecutableValidator` manually.

## 24.4 Good use cases

- service API contract;
- public application service boundary;
- library API;
- command handler boundary;
- scheduled job parameter contract.

## 24.5 Avoid overusing on private helpers

Validation should guard boundaries, not every internal helper.

## 24.6 Self-invocation trap

If method validation is implemented via interceptor/proxy, self-invocation may bypass validation.

Same mental model as CDI interceptors.

---

# 25. Return Value Validation

Return value validation ensures method returns valid object.

## 25.1 Example

```java
@NotNull
public CustomerDto getCustomer(@NotNull CustomerId id) {
    ...
}
```

## 25.2 Cascaded return value

```java
@Valid
public CustomerDto getCustomer(...) { ... }
```

## 25.3 Use cases

- public service contract;
- generated API;
- internal library quality gate;
- defensive programming around external data.

## 25.4 Caution

Return validation can add overhead and may fail after business work already happened.

For commands with side effects, think carefully.

## 25.5 Error semantics

If return value violates contract, it is server bug, not client input error.

Map differently from request validation.

---

# 26. Message Interpolation dan Internationalization

Constraint messages can use templates.

```java
@Size(min = 2, max = 100, message = "name must be between {min} and {max} characters")
String name;
```

## 26.1 Default messages

Built-in constraints have default messages.

## 26.2 Resource bundles

Messages can be externalized:

```properties
customer.name.required=Customer name is required
```

Usage:

```java
@NotBlank(message = "{customer.name.required}")
String name;
```

## 26.3 API message vs UI message

REST API should often return:

- machine-readable code;
- field path;
- human-readable message;
- rejected value policy;
- correlation ID.

Do not rely only on localized string as error identity.

## 26.4 Locale

Locale selection depends runtime/framework/application.

For public API, default to stable messages/error codes.

## 26.5 Avoid leaking internal detail

Constraint message should not reveal:

- internal regex;
- database rule;
- security policy details;
- sensitive value.

---

# 27. Payload: Metadata Tambahan untuk Constraint

Each constraint annotation includes:

```java
Class<? extends Payload>[] payload() default {};
```

## 27.1 What is payload?

Payload allows attaching metadata to constraint declaration.

Example severity:

```java
public class Severity {
    public interface Info extends Payload {}
    public interface Error extends Payload {}
}
```

Use:

```java
@NotBlank(payload = Severity.Error.class)
String name;
```

## 27.2 Use cases

- severity;
- UI hint;
- error category;
- machine-readable metadata.

## 27.3 Caution

Payload usage is not common in everyday applications.

Do not over-engineer.

## 27.4 Alternative

Many APIs use explicit error mapping layer instead of payload.

---

# 28. Programmatic Validation: `Validator`, `ValidatorFactory`, `ExecutableValidator`

## 28.1 Bootstrap

```java
ValidatorFactory factory = Validation.buildDefaultValidatorFactory();
Validator validator = factory.getValidator();
```

In Jakarta EE/CDI, inject if supported:

```java
@Inject
Validator validator;
```

## 28.2 Validate object

```java
Set<ConstraintViolation<CreateCustomerRequest>> violations =
    validator.validate(request);
```

## 28.3 Validate property

```java
validator.validateProperty(request, "email");
```

## 28.4 Validate value

```java
validator.validateValue(Customer.class, "email", "bad-email");
```

## 28.5 ExecutableValidator

```java
ExecutableValidator executableValidator = validator.forExecutables();
```

Validate method params/return manually.

## 28.6 Factory lifecycle

`ValidatorFactory` is expensive; create once and reuse.

`Validator` is generally thread-safe according to provider/spec expectations.

## 28.7 Do not bootstrap repeatedly

Bad:

```java
Validation.buildDefaultValidatorFactory().getValidator().validate(obj);
```

inside hot path repeatedly.

---

# 29. Metadata API

Jakarta Validation provides constraint metadata repository/query API.

## 29.1 Why metadata API?

Can inspect constraints at runtime.

Use cases:

- documentation generation;
- UI form generation;
- API contract tooling;
- test assertions;
- framework integration.

## 29.2 Example concept

```java
BeanDescriptor descriptor = validator.getConstraintsForClass(CustomerRequest.class);
```

Then inspect constrained properties.

## 29.3 Caution

Metadata API is powerful but can create runtime coupling.

Do not build overly dynamic validation-driven UI without understanding limitations.

## 29.4 Contract generation

Validation constraints can complement OpenAPI schema but do not replace explicit API documentation.

---

# 30. Jakarta REST Integration

Jakarta REST integrates with Jakarta Validation.

## 30.1 Request body validation

```java
@POST
public Response create(@Valid CreateCustomerRequest request) {
    ...
}
```

## 30.2 Parameter validation

```java
@GET
@Path("/{id}")
public Response get(@PathParam("id") @NotBlank String id) {
    ...
}
```

## 30.3 Query param validation

```java
@GET
public Response search(
    @QueryParam("page") @Min(0) int page,
    @QueryParam("size") @Min(1) @Max(100) int size
) { ... }
```

## 30.4 Violation handling

Jakarta REST may throw validation exceptions such as `ConstraintViolationException` or validation-related exceptions depending context/runtime.

Map to consistent error response.

## 30.5 HTTP status

Typical mapping:

```text
request entity/parameter invalid → 400 Bad Request
semantic business conflict → 409 Conflict
server return value invalid → 500 Internal Server Error
```

But exact mapping must align with API standard.

## 30.6 DTO validation

Validate DTO, not JPA entity exposed directly.

## 30.7 Error response

Return structured error, not raw exception message.

---

# 31. CDI Integration

## 31.1 Inject Validator

In CDI environment:

```java
@Inject
Validator validator;
```

## 31.2 Method validation

CDI integration can enable method validation through interceptors.

Example:

```java
@ApplicationScoped
public class CreateCaseUseCase {
    public Result handle(@Valid CreateCaseCommand command) { ... }
}
```

## 31.3 Validator injection into ConstraintValidator

Custom validators can use CDI injection if provider/runtime supports it.

```java
public class CountryCodeValidator implements ConstraintValidator<CountryCode, String> {
    @Inject
    CountryCatalog catalog;
}
```

Use carefully.

## 31.4 Avoid stateful validators

ConstraintValidator should be thread-safe.

## 31.5 Dependency cycle risk

If validator injects service that triggers validation again, you can create cycles.

## 31.6 Prefer pure validators

Best validators are pure:

```text
input value → boolean
```

No DB, no remote call, no side effects.

---

# 32. Jakarta Persistence Integration

Jakarta Persistence integrates Bean Validation with entity lifecycle.

## 32.1 Entity constraints

```java
@Entity
public class CustomerEntity {
    @Id
    private UUID id;

    @NotBlank
    @Size(max = 100)
    private String name;
}
```

## 32.2 Pre-persist/pre-update validation

JPA provider can validate entities before persist/update.

## 32.3 Useful but not enough

JPA validation catches invalid entity before DB write.

But API should validate earlier and return better error.

## 32.4 Entity validation vs DTO validation

DTO constraint can differ from entity constraint.

Example create request:

```java
@NotBlank name
```

Entity:

```java
@NotBlank
@Size(max = 100)
@Column(nullable = false, length = 100)
```

## 32.5 Lazy association validation risk

Cascaded validation on entities can trigger lazy loading or large graph traversal.

Be careful with `@Valid` on JPA relationships.

## 32.6 Database constraint still required

Validation is application-level.

Database constraint is final integrity defense.

Use both.

---

# 33. Validation vs Business Rule

## 33.1 Validation rule

```text
email must be syntactically valid
name must not be blank
page size max 100
submittedAt must not be future
```

## 33.2 Business rule

```text
license can only be renewed within 90 days before expiry
case can only be approved by assigned supervisor
applicant cannot submit duplicate active application
fee waiver requires eligibility policy
```

## 33.3 Why distinction matters

Validation usually has no side effect and no database.

Business rule may need:

- current entity state;
- actor;
- database lookup;
- policy version;
- external system;
- transaction.

## 33.4 Bad custom validator

```java
@UniqueEmail
String email;
```

Validator queries database.

Race condition remains:

```text
request A validates unique
request B validates unique
both insert
```

Need DB unique constraint.

## 33.5 Better

- Use `@Email` and `@NotBlank` for format.
- Use application service to check duplicate if needed for UX.
- Use database unique constraint for correctness.
- Map constraint violation to 409.

---

# 34. Validation vs Authorization

Validation answers:

```text
Is this data structurally valid?
```

Authorization answers:

```text
Is this actor allowed to do this action on this resource?
```

## 34.1 Do not use validation for authorization

Bad:

```java
@CanApproveCase
UUID caseId;
```

if validator checks current actor permissions.

## 34.2 Use application/security policy

```java
authorization.checkCanApprove(actor, case);
```

## 34.3 Why?

Authorization needs:

- actor identity;
- resource state;
- roles/permissions;
- organization/jurisdiction;
- audit;
- policy version;
- transaction consistency.

Validation framework is not the right primary owner.

## 34.4 Validation can support security

Validation can enforce:

- max size;
- format;
- allowed characters;
- non-null actor ID format;
- safe pagination limits.

---

# 35. Validation vs Database Constraints

## 35.1 Validation catches early

Application validation gives better user error.

## 35.2 Database constraint ensures integrity

DB constraint protects against:

- race condition;
- other apps;
- scripts;
- bugs;
- missing validation path;
- concurrent writes.

## 35.3 Align both

Java:

```java
@NotBlank
@Size(max = 100)
String name;
```

DB:

```sql
name varchar(100) not null
```

## 35.4 Unique constraint

Java cannot guarantee uniqueness under concurrency.

DB:

```sql
unique(email)
```

Application maps violation.

## 35.5 Check constraint

DB check:

```sql
amount >= 0
```

Java:

```java
@PositiveOrZero
BigDecimal amount;
```

Use both for defense-in-depth.

---

# 36. Validation Error Contract untuk REST API

## 36.1 Bad error response

```json
{
  "error": "ConstraintViolationException"
}
```

Not useful.

## 36.2 Better error response

```json
{
  "type": "https://example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "traceId": "01HX...",
  "violations": [
    {
      "field": "applicantName",
      "code": "NotBlank",
      "message": "must not be blank"
    },
    {
      "field": "contactEmail",
      "code": "Email",
      "message": "must be a well-formed email address"
    }
  ]
}
```

## 36.3 Field path

Use property path from `ConstraintViolation`.

Examples:

```text
name
address.postalCode
items[0].quantity
```

## 36.4 Error code

Do not use message as stable code.

Use:

- constraint annotation simple name;
- custom error code mapping;
- message key.

## 36.5 Invalid value

Be careful returning rejected value.

Never echo:

- password;
- token;
- secret;
- document content;
- PII-heavy data.

## 36.6 Sorting errors

Sort violations for stable response:

```text
by property path, then code
```

This helps tests and clients.

---

# 37. PATCH, Partial Update, dan Validation Groups

PATCH is tricky.

## 37.1 Create request

```java
public record CreateCustomerRequest(
    @NotBlank String name,
    @NotBlank @Email String email
) {}
```

All required.

## 37.2 Update request

PUT often replaces full resource:

```java
public record UpdateCustomerRequest(
    @NotBlank String name,
    @NotBlank @Email String email
) {}
```

## 37.3 Patch request

PATCH partial update:

```java
public record PatchCustomerRequest(
    @Size(max = 100) String name,
    @Email String email
) {}
```

Fields optional, but if present must be valid.

## 37.4 Problem with null

In JSON merge patch:

```json
{"name": null}
```

may mean remove name.

But if name required, this should fail.

You need distinguish:

```text
absent vs present null
```

Plain DTO with nullable fields cannot distinguish.

## 37.5 Solutions

- Use JSON Patch operations;
- Use wrapper like `OptionalField<T>`;
- Use JSON-P Merge Patch and validate resulting object;
- Use separate patch command model;
- Validate after applying patch to aggregate/current state.

## 37.6 Groups vs DTOs

Groups can handle create/update differences, but for PATCH, explicit patch model is often clearer.

---

# 38. Security: PII, Regex DoS, dan Over-Validation

## 38.1 PII in validation errors

Do not include full invalid value for sensitive fields.

Bad:

```json
{"field":"password", "rejectedValue":"abc123"}
```

## 38.2 Regex DoS

Complex regex can be exploited with crafted input causing catastrophic backtracking.

Mitigation:

- keep regex simple;
- limit input length;
- precompile patterns;
- use safe regex;
- test worst-case input.

## 38.3 Oversized payload

Validation runs after parsing/deserialization. It may be too late for huge payload.

Set request size limits at server/API gateway.

## 38.4 Over-validation leaks policy

Password validation message:

```text
must contain uppercase, lowercase, digit, special char, not include username, not in breach list
```

Could leak too much policy. Balance UX/security.

## 38.5 Do not trust validation alone

Validation is not sanitizer.

Still need:

- output encoding;
- SQL parameter binding;
- authorization;
- CSRF protection where relevant;
- file scanning;
- content-type validation;
- rate limiting.

---

# 39. Performance Engineering

## 39.1 Metadata building

Validator builds metadata for classes.

Reuse `ValidatorFactory`/`Validator`.

## 39.2 Large object graph

Cascaded validation can traverse large graphs.

Avoid validating full persistence graph accidentally.

## 39.3 Expensive validators

Custom validators should be fast and pure.

Avoid:

- database lookup;
- remote calls;
- heavy regex;
- file I/O;
- synchronized global lock;
- large allocations.

## 39.4 Fail fast

Provider fail-fast mode can reduce work but returns fewer errors.

Use for internal high-throughput validation if UX doesn't need all errors.

## 39.5 Reflection overhead

Validation uses metadata/reflection internally but providers optimize.

Measure before optimizing.

## 39.6 Container element validation overhead

Deep nested containers can be expensive.

Simplify DTOs.

## 39.7 Hot path rule

Do not validate same object repeatedly in tight loop if it is immutable and already validated.

---

# 40. Testing Strategy

## 40.1 Constraint unit tests

For custom validators:

```java
assertValid(new CaseNumber("CASE-20260001"));
assertInvalid("bad");
```

## 40.2 DTO validation tests

Test each request DTO:

- valid minimal;
- missing required;
- blank string;
- invalid format;
- boundary sizes;
- nested object invalid;
- list element invalid.

## 40.3 Group tests

For groups:

- `OnCreate`;
- `OnUpdate`;
- `OnPatch`;
- group sequence behavior.

## 40.4 REST integration tests

Send invalid request and assert:

- HTTP status;
- error contract;
- field path;
- error code;
- no sensitive data leakage.

## 40.5 Persistence validation tests

If relying on JPA lifecycle validation, test persist/update invalid entity.

## 40.6 Method validation tests

Use container integration test if method validation is interceptor-based.

## 40.7 Property-based testing

Useful for custom constraints with complex input.

Example:

- random invalid case number;
- random date range;
- regex worst case.

---

# 41. Observability dan Debugging

## 41.1 Log validation failures carefully

Log summary, not full payload.

```text
Validation failed: requestId=..., violations=3, fields=[name,email]
```

## 41.2 Metrics

Track:

- validation failure count;
- endpoint;
- constraint code;
- client/app version;
- payload size rejected upstream.

Avoid high cardinality field values.

## 41.3 Debugging missing validation

Checklist:

- Is `@Valid` present on nested object/request body?
- Is validation provider present?
- Is REST/CDI integration enabled?
- Are annotations `jakarta.validation`, not `javax.validation`?
- Is method called through proxy/container?
- Is group correct?
- Is `@NotNull` missing for optional-null constraint?
- Are record components annotated correctly?
- Is DTO actually used?

## 41.4 Debugging unexpected validation

- Entity lifecycle validation may run during persist/update.
- Cascaded `@Valid` may traverse nested object.
- Group sequence may trigger additional group.
- Method return validation may fail.

## 41.5 Trace ID

Include trace/correlation ID in error response and logs.

---

# 42. Production Failure Modes

## 42.1 Validation not running

Causes:

- missing `@Valid`;
- missing provider;
- wrong namespace `javax.validation`;
- object created manually without programmatic validation;
- method validation bypassed by self-invocation;
- REST integration not configured;
- validation group not selected.

## 42.2 Null accepted unexpectedly

Cause:

```java
@Email String email;
```

`null` valid.

Need:

```java
@NotBlank @Email String email;
```

## 42.3 Blank accepted unexpectedly

Cause:

```java
@NotNull String name;
```

Use `@NotBlank`.

## 42.4 Nested object not validated

Cause:

Missing `@Valid`.

## 42.5 Validation too slow

Causes:

- custom validator calls DB/remote;
- huge graph cascade;
- catastrophic regex;
- repeated bootstrap;
- validating large collections without limits.

## 42.6 Error response leaks PII

Cause:

- returning invalid value;
- logging request body;
- verbose message.

## 42.7 Domain rule implemented as validator

Causes:

- uniqueness validator;
- authorization validator;
- state transition validator.

Leads to race conditions and poor separation.

## 42.8 Persistence fails despite DTO validation

Cause:

- DB constraints stricter;
- DTO/entity mismatch;
- concurrent uniqueness violation;
- field length mismatch;
- encoding/collation issue.

## 42.9 PATCH bug

Cause:

- cannot distinguish absent vs null;
- create constraints reused for patch;
- group misuse.

---

# 43. Best Practices dan Anti-Patterns

## 43.1 Best practices

- Validate at system boundaries.
- Use DTOs for REST request validation.
- Combine `@NotBlank` with format constraints for required strings.
- Use `@Valid` for nested DTOs intentionally.
- Keep custom validators pure and fast.
- Keep domain invariants in domain/application code.
- Keep DB constraints as final integrity layer.
- Return structured validation errors.
- Avoid leaking rejected sensitive values.
- Test validation error contract.
- Use separate DTOs when groups become too complex.
- Align validation constraints with DB schema.

## 43.2 Anti-pattern: Entity as API request

Bad:

```java
public Response create(@Valid CustomerEntity entity) { ... }
```

Use request DTO.

## 43.3 Anti-pattern: Database lookup validator

Bad:

```java
@UniqueEmail
String email;
```

for correctness.

Use DB unique constraint and application conflict mapping.

## 43.4 Anti-pattern: `@NotNull` for text

Use `@NotBlank` for required text.

## 43.5 Anti-pattern: no error contract

Raw exception response is not API design.

## 43.6 Anti-pattern: validation groups explosion

If many groups, use separate DTOs/commands.

## 43.7 Anti-pattern: huge regex

Keep regex simple and bounded.

## 43.8 Anti-pattern: trust validation as security

Validation is not authorization, sanitization, or access control.

---

# 44. Checklist Review

## 44.1 DTO constraints

- [ ] Required text uses `@NotBlank`.
- [ ] Required object uses `@NotNull`.
- [ ] Required collection uses `@NotEmpty`.
- [ ] Nested DTO uses `@Valid`.
- [ ] Collection elements constrained if needed.
- [ ] Size limits exist for strings/lists.
- [ ] Numeric ranges defined.
- [ ] Temporal constraints use correct type.

## 44.2 Custom validators

- [ ] Pure and fast.
- [ ] No remote calls.
- [ ] No DB lookup for correctness.
- [ ] Thread-safe.
- [ ] Null handling intentional.
- [ ] Custom property path if class-level.
- [ ] Unit-tested.

## 44.3 Groups

- [ ] Groups are necessary.
- [ ] Group matrix documented.
- [ ] Separate DTO considered.
- [ ] PATCH absent/null semantics handled.

## 44.4 REST errors

- [ ] Consistent 400 response.
- [ ] Field path included.
- [ ] Error code included.
- [ ] Message safe.
- [ ] Sensitive rejected value omitted.
- [ ] Trace ID included.

## 44.5 Persistence

- [ ] DB constraints align.
- [ ] Unique constraints enforced in DB.
- [ ] Entity validation does not cascade huge graph.
- [ ] Constraint violation mapped.

## 44.6 Security/performance

- [ ] Payload size limited before validation.
- [ ] Regex safe.
- [ ] No PII logs.
- [ ] Validator factory reused.
- [ ] Validation failure metrics bounded cardinality.

---

# 45. Case Study 1: Create License Application API

## 45.1 Request

```java
public record CreateLicenseApplicationRequest(
    @NotBlank @Size(max = 100) String applicantName,
    @NotBlank @Size(max = 30) String licenseType,
    @NotBlank @Email String contactEmail,
    @NotNull @Valid AddressRequest address,
    @NotEmpty List<@Valid QualificationRequest> qualifications
) {}
```

## 45.2 Nested DTO

```java
public record AddressRequest(
    @NotBlank @Size(max = 150) String line1,
    @Size(max = 150) String line2,
    @NotBlank @Size(max = 80) String city,
    @NotBlank @Size(max = 20) String postalCode
) {}
```

## 45.3 Resource

```java
@POST
public Response create(@Valid CreateLicenseApplicationRequest request) {
    ApplicationId id = useCase.create(mapper.toCommand(request));
    return Response.status(201).entity(Map.of("id", id.value())).build();
}
```

## 45.4 Application rule

Business rule:

```text
Applicant cannot have another active application for same license type.
```

Do not put this as `@UniqueActiveApplication` validator.

Do:

```java
applicationPolicy.ensureNoDuplicateActiveApplication(applicant, licenseType);
```

plus DB/application consistency strategy.

## 45.5 Lesson

DTO validation ensures request shape. Application policy enforces business meaning.

---

# 46. Case Study 2: Update vs Patch Validation

## 46.1 Full update

```java
public record UpdateProfileRequest(
    @NotBlank @Size(max = 100) String displayName,
    @NotBlank @Email String email
) {}
```

All fields required.

## 46.2 Patch request

```java
public record PatchProfileRequest(
    OptionalField<@Size(max = 100) String> displayName,
    OptionalField<@Email String> email
) {}
```

Need distinguish:

```text
field absent → do not change
field present null → maybe clear or reject
field present value → validate and update
```

## 46.3 Validation after merge

Alternative:

1. load current profile;
2. apply patch;
3. validate resulting profile/update command;
4. save.

## 46.4 Lesson

PATCH semantics are not simple Bean Validation problem only.

---

# 47. Case Study 3: Domain Rule Salah Ditaruh di Annotation

## 47.1 Bad design

```java
public record ApproveCaseRequest(
    @CanApproveCase UUID caseId,
    @NotBlank String reason
) {}
```

Validator:

```java
class CanApproveCaseValidator implements ConstraintValidator<CanApproveCase, UUID> {
    @Inject CaseRepository repository;
    @Inject CurrentUser currentUser;

    public boolean isValid(UUID caseId, Context ctx) {
        Case c = repository.get(caseId);
        return c.canBeApprovedBy(currentUser.actor());
    }
}
```

## 47.2 Problems

- validation does DB lookup;
- uses current user hidden dependency;
- may run outside transaction;
- race condition between validation and approval;
- poor error semantics;
- authorization hidden;
- hard testing;
- slow validation.

## 47.3 Better design

```java
public Result approve(ApproveCaseCommand command) {
    EnforcementCase c = repository.get(command.caseId());
    authorization.checkCanApprove(command.actor(), c);
    c.approve(command.reason(), clock.instant());
    repository.save(c);
}
```

DTO validation still checks:

```java
@NotNull UUID caseId
@NotBlank String reason
```

## 47.4 Lesson

Do not hide domain decision in validation annotation.

---

# 48. Latihan Bertahap

## Latihan 1 — Basic DTO validation

Buat `CreateCustomerRequest` dengan:

- `@NotBlank name`;
- `@Email email`;
- `@Size max`.

Validate programmatically.

## Latihan 2 — Null vs blank

Test `@NotNull`, `@NotEmpty`, `@NotBlank` dengan:

```text
null
""
"   "
"abc"
```

## Latihan 3 — Nested validation

Buat DTO dengan nested `AddressRequest`.

Hilangkan `@Valid`, lihat nested constraint tidak jalan.

Tambahkan `@Valid`.

## Latihan 4 — Container element

Validasi:

```java
List<@Email String> emails
```

## Latihan 5 — Custom constraint

Buat `@CaseNumber`.

Test valid/invalid.

## Latihan 6 — Class-level constraint

Buat `@ValidDateRange`.

Custom violation path ke `to`.

## Latihan 7 — Groups

Buat `OnCreate` dan `OnUpdate`.

Bandingkan dengan separate DTO.

## Latihan 8 — REST error mapper

Buat mapper untuk `ConstraintViolationException`.

Return structured error.

## Latihan 9 — JPA integration

Persist entity invalid.

Lihat validation/DB behavior.

## Latihan 10 — Performance

Buat custom validator regex buruk.

Test input worst-case.

Refactor regex.

---

# 49. Mini Project: Jakarta Validation Contract Lab

## 49.1 Goal

Buat project:

```text
jakarta-validation-contract-lab/
```

## 49.2 Modules

```text
basic-constraints/
nested-validation/
custom-constraints/
groups-and-patch/
rest-error-contract/
method-validation/
jpa-validation/
performance-security/
```

## 49.3 Requirements

- Jakarta EE 11 target;
- Jakarta Validation 3.1;
- Jakarta REST integration;
- CDI integration;
- JPA integration optional;
- structured validation error response;
- custom constraints;
- integration tests.

## 49.4 Deliverables

```text
README.md
VALIDATION-MENTAL-MODEL.md
DTO-CONTRACTS.md
CUSTOM-CONSTRAINTS.md
GROUPS-VS-DTO.md
REST-ERROR-CONTRACT.md
DOMAIN-RULES-VS-VALIDATION.md
SECURITY-NOTES.md
FAILURE-MODES.md
```

## 49.5 Suggested use case

License application submission:

```text
Create application
Update draft
Patch contact info
Submit application
Approve application
```

## 49.6 Evaluation questions

1. Why does `@Email` allow null?
2. When do you need `@Valid`?
3. Why should custom validators be pure?
4. What is the difference between validation and business rule?
5. Why still need DB constraints?
6. When should groups be replaced by separate DTOs?
7. How do you map validation errors to REST response?
8. What is risk of regex validation?
9. How do records work with validation?
10. Why is PATCH difficult?

---

# 50. Referensi Resmi

Referensi utama:

1. Jakarta Validation 3.1
   https://jakarta.ee/specifications/bean-validation/3.1/

2. Jakarta Validation 3.1 Specification
   https://jakarta.ee/specifications/bean-validation/3.1/jakarta-validation-spec-3.1.html

3. Jakarta Validation API Docs
   https://jakarta.ee/specifications/bean-validation/3.1/apidocs/

4. Jakarta EE Tutorial — Introduction to Jakarta Bean Validation
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/beanvalidation/bean-validation/bean-validation.html

5. Jakarta EE Tutorial — Advanced Jakarta Bean Validation
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/beanvalidation/bean-validation-advanced/bean-validation-advanced.html

6. Jakarta REST Advanced — Using Constraint Annotations on Resource Methods
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/websvcs/rest-advanced/rest-advanced.html

7. Bean Validation / Jakarta Validation home
   https://beanvalidation.org/

8. Jakarta Validation 3.1 announcement
   https://beanvalidation.org/news/2025/02/17/bean-validation-3-1/

9. Hibernate Validator Reference Guide
   https://docs.jboss.org/hibernate/stable/validator/reference/en-US/html_single/

10. Jakarta Validation GitHub Project
    https://github.com/jakartaee/validation

---

# Penutup

Jakarta Validation terlihat sederhana karena annotation-nya mudah:

```java
@NotBlank
@Email
@Size(max = 100)
```

Tetapi di production, validation adalah contract boundary yang sangat strategis.

Mental model paling penting:

```text
Validation checks structural contract.
Business logic enforces domain meaning.
Database constraints enforce final integrity.
Authorization decides actor permission.
```

Jika semua dicampur ke custom annotation, sistem menjadi lambat, sulit dites, rentan race condition, dan error semantics kacau.

Engineer top-tier menggunakan Jakarta Validation untuk membuat API dan object contract eksplisit, tetapi tetap tahu kapan harus berhenti dan memindahkan rule ke application/domain/database layer.

Bagian berikutnya akan membahas **Jakarta Security (`jakarta.security.enterprise`)**: authentication, identity store, security context, role mapping, authorization boundary, integration dengan Jakarta REST/CDI, dan bagaimana membedakan framework security dari domain authorization.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 14 — Jakarta Transactions: Transaction Boundary, Rollback, XA, dan Consistency Engineering](./learn-java-jakarta-part-014.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: Bagian 16 — Jakarta Servlet (`jakarta.servlet`): Fondasi Web Container](./learn-java-jakarta-part-016.md)
