# learn-jaxrs-advanced-part-014.md

# Bagian 014 — Validation Integration: Jakarta Validation at REST Boundary, `@Valid`, Parameter Validation, Entity Validation, Groups, Cross-Field Constraint, dan Error Mapping

> Target pembaca: Java/Jakarta engineer yang ingin menguasai integrasi Jakarta Validation di JAX-RS/Jakarta REST secara production-grade. Fokus part ini bukan hanya “tambahkan `@NotNull`”, tetapi memahami validation sebagai **boundary contract** antara HTTP input dan application command: method parameter validation, request entity validation, nested validation, cross-field constraints, validation groups, custom constraints, error taxonomy, Problem Details, security, observability, dan testing.
>
> Namespace utama: `jakarta.validation.*`, `jakarta.ws.rs.*`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Validation Bukan Conversion, Bukan Business Rule](#2-mental-model-validation-bukan-conversion-bukan-business-rule)
3. [Jakarta Validation Overview](#3-jakarta-validation-overview)
4. [Di Mana Validation Terjadi dalam JAX-RS Pipeline](#4-di-mana-validation-terjadi-dalam-jax-rs-pipeline)
5. [Validation vs Deserialization vs Parameter Conversion](#5-validation-vs-deserialization-vs-parameter-conversion)
6. [Resource Method Parameter Validation](#6-resource-method-parameter-validation)
7. [Path Param Validation](#7-path-param-validation)
8. [Query Param Validation](#8-query-param-validation)
9. [Header/Cookie/Matrix/Form Param Validation](#9-headercookiematrixform-param-validation)
10. [Request Entity Validation dengan `@Valid`](#10-request-entity-validation-dengan-valid)
11. [Nested Validation](#11-nested-validation)
12. [Container Element Constraints](#12-container-element-constraints)
13. [Return Value Validation](#13-return-value-validation)
14. [Constructor/Method Validation Mental Model](#14-constructormethod-validation-mental-model)
15. [Common Built-in Constraints](#15-common-built-in-constraints)
16. [`@NotNull` vs `@NotEmpty` vs `@NotBlank`](#16-notnull-vs-notempty-vs-notblank)
17. [`@Size`, `@Min`, `@Max`, `@Positive`, `@Email`, `@Pattern`](#17-size-min-max-positive-email-pattern)
18. [Validation pada Java Records](#18-validation-pada-java-records)
19. [Validation pada POJO DTO](#19-validation-pada-pojo-dto)
20. [Validation Groups](#20-validation-groups)
21. [Create vs Update vs Patch Groups](#21-create-vs-update-vs-patch-groups)
22. [Group Sequence](#22-group-sequence)
23. [Cross-Field Validation](#23-cross-field-validation)
24. [Class-Level Constraint](#24-class-level-constraint)
25. [Custom Constraint Annotation](#25-custom-constraint-annotation)
26. [Custom `ConstraintValidator`](#26-custom-constraintvalidator)
27. [Dependency Injection dalam Constraint Validator](#27-dependency-injection-dalam-constraint-validator)
28. [Payload dan Severity Metadata](#28-payload-dan-severity-metadata)
29. [Message Interpolation dan Localization](#29-message-interpolation-dan-localization)
30. [Validation Error Path dan Field Mapping](#30-validation-error-path-dan-field-mapping)
31. [`ConstraintViolationException`](#31-constraintviolationexception)
32. [`ValidationException` vs `ConstraintViolationException`](#32-validationexception-vs-constraintviolationexception)
33. [HTTP Status: 400 vs 422](#33-http-status-400-vs-422)
34. [Problem Details untuk Validation Error](#34-problem-details-untuk-validation-error)
35. [Validation Error Code Strategy](#35-validation-error-code-strategy)
36. [Validation pada PATCH: Presence Semantics](#36-validation-pada-patch-presence-semantics)
37. [Validation pada JSON Merge Patch dan JSON Patch](#37-validation-pada-json-merge-patch-dan-json-patch)
38. [Validation dan Domain Invariants](#38-validation-dan-domain-invariants)
39. [Validation dan Authorization](#39-validation-dan-authorization)
40. [Validation dan Multi-Tenancy](#40-validation-dan-multi-tenancy)
41. [Validation dan Idempotency](#41-validation-dan-idempotency)
42. [Validation dan File/Multipart Upload](#42-validation-dan-filemultipart-upload)
43. [Validation dan Query DSL / Filtering / Sorting](#43-validation-dan-query-dsl--filtering--sorting)
44. [Validation dan OpenAPI](#44-validation-dan-openapi)
45. [Programmatic Validation dengan `Validator`](#45-programmatic-validation-dengan-validator)
46. [Validation di Service/Application Layer](#46-validation-di-serviceapplication-layer)
47. [Testing Validation](#47-testing-validation)
48. [Observability untuk Validation Errors](#48-observability-untuk-validation-errors)
49. [Security Considerations](#49-security-considerations)
50. [Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus](#50-runtime-differences-jersey-resteasy-cxf-liberty-quarkus)
51. [Migration: Bean Validation / Jakarta Validation Namespace](#51-migration-bean-validation--jakarta-validation-namespace)
52. [Common Failure Modes](#52-common-failure-modes)
53. [Best Practices](#53-best-practices)
54. [Anti-Patterns](#54-anti-patterns)
55. [Production Checklist](#55-production-checklist)
56. [Latihan](#56-latihan)
57. [Referensi Resmi](#57-referensi-resmi)
58. [Penutup](#58-penutup)

---

# 1. Tujuan Part Ini

Validation di REST API sering dipahami sebagai:

```java
@NotNull
@Size
@Email
```

Lalu selesai.

Padahal di production, validation adalah salah satu boundary paling penting.

Validation menentukan:

- request mana yang diterima;
- error apa yang client lihat;
- field mana yang invalid;
- apakah input boleh masuk ke service/domain;
- apakah error masuk 400, 422, 409, atau 412;
- bagaimana UI menampilkan error;
- bagaimana OpenAPI/schema didokumentasikan;
- bagaimana sistem aman dari input besar/aneh/malicious.

## 1.1 Example sederhana

```java
public record CreateCustomerRequest(
    @NotBlank
    @Size(max = 200)
    String displayName,

    @NotBlank
    @Email
    String email
) {}
```

Resource:

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response create(@Valid CreateCustomerRequest request) {
    ...
}
```

## 1.2 Tapi pertanyaannya lebih dalam

- Apa bedanya malformed JSON dengan validation error?
- Apa bedanya `@NotNull`, `@NotEmpty`, `@NotBlank`?
- Bagaimana validasi nested list?
- Bagaimana validasi `List<@Valid ItemRequest>`?
- Bagaimana validasi query param?
- Bagaimana mapping `ConstraintViolationException`?
- Bagaimana validasi create vs update vs patch?
- Bagaimana cross-field validation seperti `from <= to`?
- Apakah validation boleh cek database?
- Apakah validation boleh cek authorization?
- Apakah status yang tepat 400 atau 422?

## 1.3 Prinsip utama

```text
Validation is a boundary contract.
It verifies whether typed input satisfies declared request rules before business execution.
```

---

# 2. Mental Model: Validation Bukan Conversion, Bukan Business Rule

Banyak engineer mencampur 4 hal:

```text
conversion
deserialization
validation
business rule
```

Padahal berbeda.

## 2.1 Conversion

String HTTP metadata menjadi Java type.

```text
?page=20 → int 20
/customer/CUST-000001 → CustomerId
```

Jika gagal:

```text
INVALID_QUERY_PARAMETER
INVALID_PATH_PARAMETER
```

## 2.2 Deserialization

Request body bytes menjadi DTO.

```text
JSON → CreateCustomerRequest
```

Jika gagal:

```text
MALFORMED_JSON
JSON_DESERIALIZATION_FAILED
```

## 2.3 Validation

DTO/parameter sudah menjadi Java object, lalu dicek constraints.

```text
displayName must not be blank
size must be <= 100
from must be <= to
```

Jika gagal:

```text
VALIDATION_FAILED
```

## 2.4 Business rule

Input valid secara boundary, tapi domain menolak.

```text
order cannot be cancelled because already shipped
customer is suspended
licence expired
```

Jika gagal:

```text
409 Conflict
```

atau domain-specific status.

## 2.5 Top-tier rule

```text
Validation rejects invalid input shape/range/contract.
Domain rejects invalid business state.
Authorization rejects disallowed actor/resource relation.
```

---

# 3. Jakarta Validation Overview

Jakarta Validation menyediakan metadata model dan API untuk JavaBean dan method validation.

Ia mendukung:

- constraint annotation;
- validating object members;
- validating method/constructor parameters;
- validating return values;
- custom constraints;
- validation groups;
- group sequences;
- message interpolation;
- metadata API.

## 3.1 Basic constraint

```java
@NotBlank
@Size(max = 200)
private String displayName;
```

## 3.2 Built-in constraints

Examples:

```java
@NotNull
@NotEmpty
@NotBlank
@Size
@Min
@Max
@Positive
@Email
@Pattern
@Past
@Future
```

## 3.3 Custom constraints

You can define:

```java
@ValidDateRange
```

or:

```java
@ValidOrderTransition
```

But be careful with business logic.

## 3.4 Executable validation

Validation can apply to method parameters and return values.

This matters for JAX-RS resource methods.

## 3.5 ConstraintViolation

Validation failure reported as `ConstraintViolation`.

## 3.6 ConstraintViolationException

A set of violations can be wrapped in `ConstraintViolationException`.

---

# 4. Di Mana Validation Terjadi dalam JAX-RS Pipeline

Simplified:

```text
HTTP request
  ↓
resource matching
  ↓
parameter conversion
  ↓
entity body deserialization
  ↓
Jakarta Validation
  ↓
resource method invocation
  ↓
application/domain
  ↓
response
```

## 4.1 Parameter validation

```java
@GET
public Response list(
    @QueryParam("page") @DefaultValue("1") @Min(1) int page
) { ... }
```

Validation happens after query param conversion to `int`.

## 4.2 Entity validation

```java
public Response create(@Valid CreateCustomerRequest request) { ... }
```

Validation happens after JSON is deserialized into DTO.

## 4.3 Nested validation

```java
public record CreateOrderRequest(
    @NotEmpty List<@Valid OrderItemRequest> items
) {}
```

## 4.4 If conversion/deserialization fails

Validation does not run.

## 4.5 If validation fails

Resource method should not run.

## 4.6 Rule

Validation assumes input is already typed.

---

# 5. Validation vs Deserialization vs Parameter Conversion

## 5.1 Malformed JSON

Request:

```json
{"email":
```

Fails deserialization.

No DTO exists.

Error:

```text
400 MALFORMED_JSON
```

## 5.2 Wrong JSON type

```json
{
  "items": "not-array"
}
```

Fails deserialization or type binding.

Error:

```text
400 JSON_DESERIALIZATION_FAILED
```

## 5.3 Constraint violation

```json
{
  "email": "not-email"
}
```

DTO exists.

Validation fails.

Error:

```text
400/422 VALIDATION_FAILED
```

## 5.4 Business invalid

```json
{
  "email": "valid@example.com"
}
```

but email already registered.

Could be:

```text
409 EMAIL_ALREADY_REGISTERED
```

## 5.5 Rule

Error response should communicate which layer rejected request.

---

# 6. Resource Method Parameter Validation

Jakarta REST supports Bean/Jakarta Validation constraints on resource method parameters.

## 6.1 Query parameter example

```java
@GET
@Path("/customers")
public Response list(
    @QueryParam("page") @DefaultValue("1") @Min(1) int page,
    @QueryParam("size") @DefaultValue("20") @Min(1) @Max(100) int size
) {
    ...
}
```

## 6.2 Path parameter example

```java
@GET
@Path("/customers/{customerId}")
public Response get(
    @PathParam("customerId") @Pattern(regexp = "CUST-[0-9]{6}") String customerId
) {
    ...
}
```

## 6.3 Header example

```java
@POST
public Response create(
    @HeaderParam("Idempotency-Key")
    @NotBlank
    @Size(max = 128)
    String idempotencyKey,
    @Valid CreatePaymentRequest request
) {
    ...
}
```

## 6.4 Caveat

Conversion happens before validation.

If target type is `CustomerId`, its converter may reject invalid syntax before `@Pattern`.

## 6.5 Recommendation

For simple numeric/string query params, constraints on method params are excellent.

For complex query, use `@BeanParam`.

## 6.6 Rule

Method parameter validation is ideal for simple boundary rules.

---

# 7. Path Param Validation

Path parameters identify resources.

## 7.1 Regex in `@Path` vs validation

Option A:

```java
@Path("/customers/{customerId:CUST-[0-9]{6}}")
```

Invalid path does not match route → 404.

Option B:

```java
@Path("/customers/{customerId}")
public Response get(
    @PathParam("customerId")
    @Pattern(regexp = "CUST-[0-9]{6}")
    String customerId
)
```

Invalid path matches route, then validation fails → 400/422.

## 7.2 Which is better?

Depends on desired semantics.

If invalid shape should be route not found:

```text
404
```

Use regex path.

If invalid parameter should be explicit:

```text
400 invalid path parameter
```

Use converter/validation.

## 7.3 Typed ID

Better:

```java
@PathParam("customerId") CustomerId customerId
```

Converter validates syntax.

## 7.4 Validation still useful

For simple length/pattern on String.

## 7.5 Rule

Choose intentionally: path regex changes routing; validation changes error contract.

---

# 8. Query Param Validation

Query parameters often need validation.

## 8.1 Pagination

```java
@QueryParam("page")
@DefaultValue("1")
@Min(1)
int page;

@QueryParam("size")
@DefaultValue("20")
@Min(1)
@Max(100)
int size;
```

## 8.2 Sorting

```java
@QueryParam("sort")
List<@Pattern(regexp = "[a-zA-Z0-9]+:(asc|desc)") String> sort;
```

But for production, parse/allowlist fields in query object.

## 8.3 Date range

```java
@QueryParam("from") LocalDate from;
@QueryParam("to") LocalDate to;
```

Need cross-field validation:

```text
from <= to
```

## 8.4 Search text

```java
@QueryParam("q")
@Size(max = 200)
String q;
```

## 8.5 Duplicate query params

Validation annotations usually won't detect duplicates for single-value params.

Use `UriInfo`.

## 8.6 Rule

Validation handles values; duplicate/unknown query key policy often needs explicit parsing.

---

# 9. Header/Cookie/Matrix/Form Param Validation

## 9.1 Header

```java
@HeaderParam("Idempotency-Key")
@NotBlank
@Size(max = 128)
@Pattern(regexp = "[A-Za-z0-9._:-]+")
String idempotencyKey
```

## 9.2 Cookie

```java
@CookieParam("theme")
@Pattern(regexp = "light|dark")
String theme
```

Avoid doing auth cookie validation in resource; use security layer.

## 9.3 Matrix

```java
@MatrixParam("year")
@Min(2000)
@Max(2100)
int year
```

## 9.4 Form

```java
@FormParam("email")
@NotBlank
@Email
String email
```

## 9.5 Browser form + CSRF

If cookie-auth browser endpoint, validation is not enough. Need CSRF protection.

## 9.6 Rule

All metadata from client is untrusted, regardless of location.

---

# 10. Request Entity Validation dengan `@Valid`

To validate request body DTO, annotate entity parameter with `@Valid`.

## 10.1 Example

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response create(@Valid CreateCustomerRequest request) {
    ...
}
```

DTO:

```java
public record CreateCustomerRequest(
    @NotBlank @Size(max = 200) String displayName,
    @NotBlank @Email String email
) {}
```

## 10.2 Without `@Valid`

Constraints on DTO fields may not be evaluated automatically.

## 10.3 Validation happens after body read

Malformed JSON fails before validation.

## 10.4 Null entity

If empty body maps to null, `@Valid` alone does not necessarily reject null.

Use:

```java
@NotNull @Valid CreateCustomerRequest request
```

## 10.5 Recommended signature

```java
public Response create(@NotNull @Valid CreateCustomerRequest request)
```

## 10.6 Rule

Use `@Valid` on entity parameter; use `@NotNull` too if body is required.

---

# 11. Nested Validation

`@Valid` cascades validation to nested objects.

## 11.1 Example

```java
public record CreateCustomerRequest(
    @NotBlank String displayName,
    @Valid AddressRequest address
) {}
```

## 11.2 Nested DTO

```java
public record AddressRequest(
    @NotBlank String line1,
    @NotBlank String postalCode
) {}
```

## 11.3 List of nested DTO

```java
public record CreateOrderRequest(
    @NotEmpty
    List<@Valid OrderItemRequest> items
) {}
```

## 11.4 Without nested `@Valid`

Inner constraints may not run.

## 11.5 Field path

Violation path should identify nested field:

```text
address.postalCode
items[0].quantity
```

## 11.6 Rule

For nested DTOs, mark nested value or element with `@Valid`.

---

# 12. Container Element Constraints

Jakarta Validation supports constraints on container elements.

## 12.1 List element constraint

```java
public record SearchRequest(
    List<@NotBlank String> tags
) {}
```

## 12.2 Nested list DTO

```java
public record CreateOrderRequest(
    List<@Valid OrderItemRequest> items
) {}
```

## 12.3 Map key/value constraint

```java
Map<@Pattern(regexp = "[a-zA-Z0-9_-]+") String, @Size(max = 100) String> attributes
```

## 12.4 Optional

```java
Optional<@Email String> email
```

depending provider/runtime support.

## 12.5 Good use cases

- list of IDs;
- tags;
- includes;
- map attributes;
- nested request items.

## 12.6 Rule

Validate both container and elements:

```java
@NotEmpty List<@Valid ItemRequest> items
```

---

# 13. Return Value Validation

Jakarta Validation can validate method return values.

## 13.1 Example concept

```java
@GET
@NotNull
public CustomerResponse get(...) {
    ...
}
```

## 13.2 In REST APIs

Return value validation can catch server-side bugs.

If it fails, it is not client error.

Usually maps to:

```text
500 Internal Server Error
```

## 13.3 Use carefully

Good for internal safety on service layer.

Less common on resource return values.

## 13.4 Do not expose validation details

If response DTO violates server constraint, log internally; client gets internal error.

## 13.5 Rule

Input validation failure is client error; output validation failure is server bug.

---

# 14. Constructor/Method Validation Mental Model

Jakarta Validation supports executable validation:

- method parameters;
- method return values;
- constructor parameters;
- constructor return values.

JAX-RS uses this for resource methods.

## 14.1 Resource method

```java
public Response list(@Min(1) int page)
```

## 14.2 Service method

CDI/interceptor may validate service methods if method validation enabled.

```java
public Customer create(@Valid CreateCustomerCommand command)
```

## 14.3 Boundary duplication

Validation at resource and service can overlap.

## 14.4 Recommendation

- REST DTO validation at resource boundary;
- domain/application invariants inside service/domain;
- service method validation for internal API safety if useful.

## 14.5 Rule

Validation can exist at multiple layers, but each layer should validate its own contract.

---

# 15. Common Built-in Constraints

Common constraints:

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
@Email
@Pattern
@Past
@PastOrPresent
@Future
@FutureOrPresent
@AssertTrue
@AssertFalse
@DecimalMin
@DecimalMax
@Digits
```

## 15.1 Null behavior

Many constraints ignore null.

Example:

```java
@Email String email
```

`null` may be valid.

Use:

```java
@NotBlank @Email String email
```

## 15.2 Composition

Combine constraints.

## 15.3 Message

Default messages are generic.

For API, map to stable codes.

## 15.4 Rule

Always know whether constraint accepts null.

---

# 16. `@NotNull` vs `@NotEmpty` vs `@NotBlank`

## 16.1 `@NotNull`

Rejects null.

Allows:

```text
""
"   "
empty collection? if collection not null, @NotNull passes
```

## 16.2 `@NotEmpty`

Rejects null and empty.

Applies to:

- String;
- collection;
- map;
- array.

But string `"   "` is not empty.

## 16.3 `@NotBlank`

For strings.

Rejects:

- null;
- empty;
- whitespace-only.

## 16.4 Examples

```java
@NotBlank
String displayName;
```

```java
@NotEmpty
List<ItemRequest> items;
```

```java
@NotNull
Boolean acceptedTerms;
```

## 16.5 Rule

Use `@NotBlank` for human-entered text required fields.

Use `@NotEmpty` for required collections.

Use `@NotNull` for required non-string values.

---

# 17. `@Size`, `@Min`, `@Max`, `@Positive`, `@Email`, `@Pattern`

## 17.1 `@Size`

For length/collection size.

```java
@Size(max = 200)
String displayName
```

## 17.2 `@Min/@Max`

For numeric values.

```java
@Min(1)
@Max(100)
int size
```

## 17.3 `@Positive`

```java
@Positive
BigDecimal amount
```

## 17.4 `@Email`

Email syntax.

Do not assume deliverability.

## 17.5 `@Pattern`

Regex.

Use carefully; avoid catastrophic regex.

## 17.6 Null behavior

Combine with `@NotNull`/`@NotBlank` if required.

## 17.7 Rule

Constraints should be simple and stable; complex semantics belong in custom validator or service/domain.

---

# 18. Validation pada Java Records

Records are great DTOs.

## 18.1 Example

```java
public record CreateCustomerRequest(
    @NotBlank String displayName,
    @NotBlank @Email String email
) {}
```

## 18.2 Annotation target

Constraints on record components usually work with modern providers.

## 18.3 Constructor validation

Record canonical constructor can enforce invariants too.

```java
public CreateCustomerRequest {
    displayName = displayName == null ? null : displayName.trim();
}
```

Be careful with mutation/normalization.

## 18.4 Provider support

JSON provider and validation provider must support records properly.

Test runtime.

## 18.5 Recommendation

Records are good for immutable DTOs, but write contract tests.

## 18.6 Rule

Records reduce boilerplate; they do not remove need for validation design.

---

# 19. Validation pada POJO DTO

## 19.1 Example

```java
public class CreateCustomerRequest {

    @NotBlank
    private String displayName;

    @NotBlank
    @Email
    private String email;

    public String getDisplayName() { return displayName; }
    public void setDisplayName(String displayName) { this.displayName = displayName; }

    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
}
```

## 19.2 Field vs getter constraints

Both possible.

Choose one style.

## 19.3 Avoid duplicate constraints

Do not annotate both field and getter unless intended.

## 19.4 Mutable object

POJO can be partially initialized. Validation catches before use.

## 19.5 Rule

Consistency matters: choose field-based or property-based constraints per project.

---

# 20. Validation Groups

Groups allow different constraints in different contexts.

## 20.1 Define groups

```java
public interface OnCreate {}
public interface OnUpdate {}
```

## 20.2 DTO

```java
public record CustomerRequest(
    @NotNull(groups = OnUpdate.class)
    String id,

    @NotBlank(groups = OnCreate.class)
    String displayName
) {}
```

## 20.3 Validate group

In JAX-RS automatic validation, default group is usually used.

To use custom groups at boundary, you may need programmatic validation or framework-specific support.

## 20.4 Alternative

Use separate DTOs:

```java
CreateCustomerRequest
UpdateCustomerRequest
```

Often clearer.

## 20.5 When groups help

- same model reused;
- staged validation;
- internal service validation;
- admin vs user validation.

## 20.6 Rule

Prefer separate DTOs for different REST operations. Use groups when reuse is justified.

---

# 21. Create vs Update vs Patch Groups

## 21.1 Create

Required fields:

```java
public record CreateCustomerRequest(
    @NotBlank String displayName,
    @NotBlank @Email String email
) {}
```

## 21.2 Replace/PUT

All fields represent full replacement.

```java
public record ReplaceCustomerRequest(
    @NotBlank String displayName,
    @NotBlank @Email String email
) {}
```

## 21.3 Partial update/PATCH

Fields optional but presence matters.

```java
public record PatchCustomerRequest(
    OptionalField<@NotBlank String> displayName,
    OptionalField<@Email String> email
) {}
```

## 21.4 Groups approach

One DTO with groups can work, but can become confusing.

## 21.5 Recommendation

For REST clarity:

```text
Create DTO != Replace DTO != Patch DTO
```

## 21.6 Rule

HTTP method semantics should shape validation model.

---

# 22. Group Sequence

Group sequence controls validation order.

## 22.1 Example

```java
@GroupSequence({BasicChecks.class, ExpensiveChecks.class})
public interface OrderedChecks {}
```

## 22.2 Use cases

- validate cheap syntax first;
- then expensive cross-field;
- fail early before costly checks.

## 22.3 REST caution

If expensive checks call database, maybe not validation; maybe service/domain.

## 22.4 Good use

- field required before class-level relation;
- parse-independent checks before advanced consistency.

## 22.5 Rule

Group sequence helps organize validation, not replace business workflow.

---

# 23. Cross-Field Validation

Some rules involve multiple fields.

Example:

```text
from <= to
startDate <= endDate
min <= max
password == confirmPassword
```

## 23.1 DTO

```java
@ValidDateRange
public record SearchRequest(
    LocalDate from,
    LocalDate to
) {}
```

## 23.2 Constraint

```java
@Target(TYPE)
@Retention(RUNTIME)
@Constraint(validatedBy = DateRangeValidator.class)
public @interface ValidDateRange {
    String message() default "from must be before or equal to to";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

## 23.3 Validator

```java
public class DateRangeValidator implements ConstraintValidator<ValidDateRange, SearchRequest> {
    @Override
    public boolean isValid(SearchRequest value, ConstraintValidatorContext context) {
        if (value == null || value.from() == null || value.to() == null) {
            return true;
        }
        return !value.from().isAfter(value.to());
    }
}
```

## 23.4 Field-specific violation

Can customize violation path to `from` or `to`.

## 23.5 Rule

Use class-level constraints for structural cross-field request validation.

---

# 24. Class-Level Constraint

Class-level constraints validate the whole object.

## 24.1 Use cases

- date range;
- mutually exclusive fields;
- at least one of fields;
- conditional required fields;
- consistent min/max.

## 24.2 Example

```text
Either email or phone must be provided.
```

## 24.3 Validator can add specific property node

```java
context.disableDefaultConstraintViolation();
context.buildConstraintViolationWithTemplate("from must be <= to")
    .addPropertyNode("from")
    .addConstraintViolation();
```

## 24.4 Avoid business lookup

Class-level validator should not load database.

## 24.5 Rule

Class-level constraint validates object consistency, not resource existence/authorization.

---

# 25. Custom Constraint Annotation

## 25.1 Example: valid sort field

```java
@Target({FIELD, PARAMETER})
@Retention(RUNTIME)
@Constraint(validatedBy = SortSpecValidator.class)
public @interface ValidSort {
    String message() default "invalid sort";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

## 25.2 Validator

```java
public class SortSpecValidator implements ConstraintValidator<ValidSort, List<String>> {
    private static final Set<String> ALLOWED = Set.of("createdAt", "displayName");

    @Override
    public boolean isValid(List<String> value, ConstraintValidatorContext context) {
        if (value == null) return true;
        return value.stream().allMatch(this::isValidSort);
    }

    private boolean isValidSort(String raw) {
        String field = raw.split(":", 2)[0];
        return ALLOWED.contains(field);
    }
}
```

## 25.3 Annotation parameters

```java
String[] allowedFields() default {};
```

Could make reusable.

## 25.4 Caution

If allowed fields differ per endpoint, annotation config can become noisy.

## 25.5 Rule

Custom constraints should encode reusable boundary rules.

---

# 26. Custom `ConstraintValidator`

## 26.1 Contract

```java
public interface ConstraintValidator<A extends Annotation, T> {
    void initialize(A constraintAnnotation);
    boolean isValid(T value, ConstraintValidatorContext context);
}
```

## 26.2 Null handling

Common convention:

```java
if (value == null) return true;
```

Use `@NotNull` separately.

## 26.3 No exception for normal invalid

Return false.

Throw only for validator misconfiguration/unexpected internal failure.

## 26.4 Thread safety

Validator instances may be reused.

Avoid mutable non-thread-safe state.

## 26.5 Message

Use message interpolation keys:

```java
"{customer.email.invalid}"
```

## 26.6 Rule

Validator should be deterministic, safe, and side-effect-free.

---

# 27. Dependency Injection dalam Constraint Validator

In Jakarta EE/CDI environments, validators may support dependency injection depending provider/container integration.

## 27.1 Possible

```java
public class UniqueEmailValidator implements ConstraintValidator<UniqueEmail, String> {
    @Inject CustomerRepository repository;
}
```

## 27.2 But should you?

For REST request validation, uniqueness often belongs in application service/domain, because:

- requires transaction;
- race conditions;
- authorization/tenant context;
- database consistency;
- error status may be conflict, not validation.

## 27.3 Good injection use

- static config;
- safe dictionary;
- lightweight utility.

## 27.4 Bad injection use

- database existence check;
- remote service call;
- authorization check.

## 27.5 Rule

DI in validators is possible, but heavy stateful/business checks usually do not belong there.

---

# 28. Payload dan Severity Metadata

Jakarta Validation has payload mechanism.

## 28.1 Payload

Constraint annotation includes:

```java
Class<? extends Payload>[] payload() default {};
```

## 28.2 Use cases

- severity;
- category metadata;
- UI hint.

## 28.3 Example

```java
public class Severity {
    public interface Error extends Payload {}
    public interface Warning extends Payload {}
}
```

## 28.4 REST caution

Payload metadata is not always convenient in error mapping.

## 28.5 Alternative

Map constraint annotation type to error code/severity in mapper.

## 28.6 Rule

Use payload sparingly; stable error code mapping is usually more useful.

---

# 29. Message Interpolation dan Localization

Validation messages can be interpolated.

## 29.1 Message key

```java
@NotBlank(message = "{customer.displayName.required}")
String displayName;
```

## 29.2 Resource bundle

Provider resolves localized messages.

## 29.3 Accept-Language

REST layer can use `Accept-Language` to choose locale depending integration.

## 29.4 Stable code

Do not use localized message as error code.

## 29.5 Problem response

```json
{
  "field": "displayName",
  "code": "REQUIRED",
  "message": "Display name is required."
}
```

## 29.6 Rule

Messages are for humans. Codes are for machines.

---

# 30. Validation Error Path dan Field Mapping

`ConstraintViolation#getPropertyPath()` gives path.

## 30.1 Method parameter path

For resource method parameter, path may look runtime/provider-specific.

Example:

```text
list.arg0
create.request.email
```

or include parameter names if compiled with metadata.

## 30.2 DTO field path

```text
email
items[0].quantity
address.postalCode
```

## 30.3 Need mapping

Your mapper should convert internal violation path into public JSON field path.

## 30.4 Parameter names

Java parameter names require compilation with `-parameters` and provider support.

## 30.5 Annotated params

For JAX-RS params, parameter location/name may be in annotations:

```java
@QueryParam("page")
```

Mapper can inspect method metadata only with more advanced runtime-specific context.

## 30.6 Practical strategy

For DTO validation, property paths are clear.

For method parameter validation, produce location/name if possible; otherwise generic.

## 30.7 Rule

Error field paths should be client-facing names, not Java internals like `arg0`.

---

# 31. `ConstraintViolationException`

`ConstraintViolationException` reports result of constraint violations.

## 31.1 Contains set

```java
Set<ConstraintViolation<?>> violations = ex.getConstraintViolations();
```

## 31.2 Mapper

```java
@Provider
public class ConstraintViolationExceptionMapper
    implements ExceptionMapper<ConstraintViolationException> {

    @Override
    public Response toResponse(ConstraintViolationException ex) {
        List<ViolationResponse> violations = ex.getConstraintViolations().stream()
            .map(this::toViolation)
            .toList();

        ProblemResponse problem = ProblemResponse.validationFailed(violations);

        return Response.status(400)
            .type("application/problem+json")
            .entity(problem)
            .build();
    }
}
```

## 31.3 Status

Choose 400 or 422.

## 31.4 Be robust

Violation set can include method params, return values, nested fields.

## 31.5 Rule

Map `ConstraintViolationException` to structured validation problem.

---

# 32. `ValidationException` vs `ConstraintViolationException`

## 32.1 `ValidationException`

Base exception for validation problems.

May indicate:

- constraint declaration invalid;
- validator factory error;
- unexpected validation processing problem.

## 32.2 `ConstraintViolationException`

Specific: actual constraint violations.

## 32.3 Mapping

`ConstraintViolationException` → client validation error.

Other `ValidationException` → often server misconfiguration/internal error, unless runtime uses it for client validation.

## 32.4 JAX-RS integration nuance

Some REST runtimes may throw/wrap `ValidationException` for resource validation failures.

Test target runtime.

## 32.5 Rule

Do not blindly map every `ValidationException` to 400 without understanding cause.

---

# 33. HTTP Status: 400 vs 422

Both are used in real APIs.

## 33.1 400 Bad Request

Broad client error for invalid request syntax/semantics.

Pros:

- widely understood;
- works for all invalid input;
- simpler.

## 33.2 422 Unprocessable Content

Request syntactically correct and media type understood, but instructions semantically invalid.

Pros:

- distinguishes parse vs validation;
- useful for field validation.

Cons:

- not universally used in older clients;
- team may debate.

## 33.3 Recommendation

Choose one organization-wide.

A common policy:

```text
400 = syntax/conversion/deserialization/validation boundary errors
409 = domain conflict/state errors
412 = precondition failure
```

Alternative:

```text
400 = malformed/conversion
422 = validation
409 = state conflict
```

## 33.4 Rule

Consistency matters more than the 400-vs-422 debate.

---

# 34. Problem Details untuk Validation Error

Use `application/problem+json`.

## 34.1 Example

```json
{
  "type": "https://api.example.com/problems/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "code": "VALIDATION_FAILED",
  "detail": "One or more fields are invalid.",
  "violations": [
    {
      "field": "email",
      "code": "EMAIL_INVALID",
      "message": "must be a well-formed email address"
    }
  ],
  "correlationId": "01JZ..."
}
```

## 34.2 Include field path

Field path should map to request JSON/query/header field.

## 34.3 Multiple errors

Return array.

## 34.4 Avoid echoing invalid values

Especially secrets/PII.

## 34.5 Rule

Validation error response should be actionable for UI/API clients.

---

# 35. Validation Error Code Strategy

## 35.1 Annotation-to-code mapping

Examples:

```text
@NotNull   → REQUIRED
@NotBlank  → REQUIRED
@Email     → EMAIL_INVALID
@Size      → SIZE_OUT_OF_RANGE
@Min/@Max  → OUT_OF_RANGE
@Pattern   → FORMAT_INVALID
```

## 35.2 Domain-specific constraints

```text
@ValidDateRange → DATE_RANGE_INVALID
@ValidSort      → SORT_INVALID
```

## 35.3 Do not expose annotation names if unstable

`NotBlank` might be okay internally, but API code should be stable.

## 35.4 Include machine code per violation

```json
{"field": "email", "code": "EMAIL_INVALID"}
```

## 35.5 Global code

Overall:

```text
VALIDATION_FAILED
```

## 35.6 Rule

Use one overall code plus per-violation codes.

---

# 36. Validation pada PATCH: Presence Semantics

PATCH is hard because fields can be:

- absent;
- present null;
- present value.

## 36.1 Naive DTO

```java
public record PatchCustomerRequest(
    String displayName,
    String email
) {}
```

Cannot tell absent vs null reliably.

## 36.2 OptionalField wrapper

```java
public sealed interface OptionalField<T> {
    record Absent<T>() implements OptionalField<T> {}
    record Present<T>(T value) implements OptionalField<T> {}
}
```

## 36.3 Validation

If present value non-null, validate value.

If absent, no validation.

If present null, apply patch semantics.

## 36.4 Alternative

Use JSON Merge Patch / JSON Patch.

## 36.5 Rule

PATCH validation must preserve field presence.

---

# 37. Validation pada JSON Merge Patch dan JSON Patch

## 37.1 Merge Patch

```http
Content-Type: application/merge-patch+json
```

`null` means remove.

Validation steps:

1. Validate patch document shape.
2. Apply patch to current representation.
3. Validate resulting representation/domain command.
4. Apply business rules.

## 37.2 JSON Patch

```http
Content-Type: application/json-patch+json
```

Validate:

- operation names;
- allowed paths;
- value types;
- operation count;
- resulting document.

## 37.3 Security

Do not allow patching:

- id;
- tenantId;
- status if workflow-controlled;
- audit fields;
- roles/permissions.

## 37.4 Rule

Patch validation is a pipeline, not just annotations.

---

# 38. Validation dan Domain Invariants

## 38.1 Boundary validation

```text
email format valid
amount positive
quantity >= 1
from <= to
```

## 38.2 Domain invariant

```text
order cannot be shipped before payment captured
licence renewal only within renewal window
case cannot close with unresolved tasks
```

## 38.3 Where to put

Boundary validation in DTO/resource layer.

Domain invariant in domain/service layer.

## 38.4 Do not overuse custom validator for domain rule

Bad:

```java
@OrderCanBeCancelled
OrderId orderId
```

Validator queries order state.

Better:

```java
orderService.cancel(orderId, user)
```

domain checks state.

## 38.5 Rule

Validation checks request contract; domain checks business truth.

---

# 39. Validation dan Authorization

## 39.1 Validation is not authorization

A valid `customerId` does not mean user can access it.

## 39.2 Example

```java
@PathParam("customerId") @ValidCustomerId String customerId
```

Only syntax.

Authorization:

```java
authorizationService.assertCanViewCustomer(user, customerId);
```

## 39.3 Tenant

Body may contain tenant ID but must be checked against security context.

## 39.4 Custom validator should not check roles

Authorization belongs in security/application policy.

## 39.5 Rule

Do not hide authorization in validators.

---

# 40. Validation dan Multi-Tenancy

## 40.1 Tenant-scoped request

```text
/tenants/{tenantId}/customers
```

Path tenant syntax can be validated.

But access must be authorized.

## 40.2 Body tenant

If body includes tenant ID, validate consistency:

```text
body.tenantId == path.tenantId
```

or reject body tenant entirely.

## 40.3 Tenant-specific rules

Example postal code by country/tenant.

Can be validation if pure and config-based.

But if tenant policy comes from DB and changes, service may be better.

## 40.4 Rule

Tenant-aware validation must not trust client-provided tenant without security context.

---

# 41. Validation dan Idempotency

## 41.1 Header validation

```java
@HeaderParam("Idempotency-Key")
@NotBlank
@Size(max = 128)
@Pattern(regexp = "[A-Za-z0-9._:-]+")
String idempotencyKey
```

## 41.2 Idempotency conflict

Same key with different body is not validation failure.

It is conflict:

```text
409 IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY
```

## 41.3 Missing key

If required:

```text
400 MISSING_REQUIRED_HEADER
```

or validation error.

## 41.4 Rule

Validate key syntax at boundary; enforce idempotency semantics in application service.

---

# 42. Validation dan File/Multipart Upload

## 42.1 Metadata validation

Multipart metadata part can be DTO:

```java
@FormParam("metadata")
@Valid
UploadMetadataRequest metadata
```

if runtime/provider supports.

## 42.2 File part validation

Validate:

- required part exists;
- content type allowed;
- file size;
- filename length/safe chars;
- number of parts;
- checksum;
- malware scan result.

## 42.3 Annotation limitations

File size/content scan usually not simple Bean Validation.

Use upload service pipeline.

## 42.4 Filename

Do not trust.

## 42.5 Rule

Multipart validation combines metadata constraints + streaming/security pipeline checks.

---

# 43. Validation dan Query DSL / Filtering / Sorting

## 43.1 Query object

```java
public class CustomerSearchParams {
    @QueryParam("page")
    @DefaultValue("1")
    @Min(1)
    int page;

    @QueryParam("size")
    @DefaultValue("20")
    @Min(1)
    @Max(100)
    int size;

    @QueryParam("sort")
    List<String> sort;
}
```

## 43.2 Additional parse validation

```java
public SearchCommand toCommand() {
    SortSpec sortSpec = SortSpec.parseAllowed(sort, Set.of("createdAt", "name"));
    ...
}
```

## 43.3 Unknown query params

Bean Validation won't reject unknown query keys.

Use `UriInfo`.

## 43.4 Duplicate single params

Bean Validation won't know if `page` repeated and first value used.

Use `UriInfo`.

## 43.5 Rule

Validation annotations are not enough for dynamic query grammar.

---

# 44. Validation dan OpenAPI

## 44.1 Constraint to schema

Tools can map:

```java
@NotNull → required
@Size(max=200) → maxLength
@Min/@Max → minimum/maximum
@Pattern → pattern
@Email → format: email
```

## 44.2 Not always automatic

Custom constraints may not be reflected.

## 44.3 Add descriptions

Document semantics not expressible in annotations.

## 44.4 Keep docs in sync

If validation changes but OpenAPI not updated, clients break.

## 44.5 Rule

Validation annotations are source of truth only if your documentation tooling reads them correctly.

---

# 45. Programmatic Validation dengan `Validator`

You can inject/use `Validator`.

## 45.1 Example

```java
@Inject
Validator validator;
```

or:

```java
ValidatorFactory factory = Validation.buildDefaultValidatorFactory();
Validator validator = factory.getValidator();
```

## 45.2 Validate with group

```java
Set<ConstraintViolation<CreateCustomerRequest>> violations =
    validator.validate(request, OnCreate.class);
```

## 45.3 Use cases

- validation groups not automatically supported in resource method;
- validate after applying patch;
- validate generated command;
- validate internal DTO.

## 45.4 Do not duplicate automatic validation blindly

Avoid validating same object twice.

## 45.5 Rule

Use programmatic validation when automatic boundary validation is not expressive enough.

---

# 46. Validation di Service/Application Layer

## 46.1 Why validate service input?

Services may be called by:

- REST;
- messaging;
- batch;
- scheduler;
- CLI;
- tests.

REST validation alone may not protect other entry points.

## 46.2 Application command

```java
public record CreateCustomerCommand(
    @NotBlank String displayName,
    @Email String email,
    TenantId tenantId,
    CurrentUser actor
) {}
```

## 46.3 Service method validation

```java
public CustomerId create(@Valid CreateCustomerCommand command) { ... }
```

requires method validation integration.

## 46.4 Domain invariants

Still enforce in domain.

## 46.5 Rule

Validate boundary DTO at REST, and enforce application/domain invariants in use case/domain.

---

# 47. Testing Validation

## 47.1 DTO unit tests

Use `Validator` directly.

```java
Set<ConstraintViolation<CreateCustomerRequest>> violations =
    validator.validate(request);
```

## 47.2 Resource integration tests

Send HTTP request and assert:

- status;
- content type;
- problem code;
- violation field path;
- correlation ID.

## 47.3 Cases

- missing;
- null;
- empty;
- blank;
- too long;
- invalid email;
- invalid range;
- invalid nested item;
- multiple violations.

## 47.4 Parameter tests

- invalid query;
- invalid header;
- invalid path;
- duplicate query if policy.

## 47.5 Cross-field tests

- valid date range;
- invalid date range;
- null endpoints if allowed.

## 47.6 Rule

Test validation at both object level and HTTP boundary.

---

# 48. Observability untuk Validation Errors

## 48.1 Metrics

```text
api_validation_errors_total{route,field,code}
```

Be careful with field cardinality.

## 48.2 Good labels

- route template;
- validation code;
- high-level field name if bounded.

## 48.3 Bad labels

- raw invalid value;
- request body;
- email/customer ID;
- correlation ID.

## 48.4 Logs

Log validation failure summary.

Do not log full body.

## 48.5 Alerts

Validation spikes may indicate client regression.

## 48.6 Rule

Validation observability should help detect contract drift without leaking data.

---

# 49. Security Considerations

## 49.1 Validation is defense layer, not complete security

Still need:

- authentication;
- authorization;
- rate limiting;
- body size limits;
- parsing security;
- output encoding;
- business rules.

## 49.2 Regex ReDoS

Avoid complex vulnerable regex.

Precompile patterns in custom validators.

## 49.3 Length limits

Always set size limits on strings/collections.

## 49.4 PII

Do not echo invalid values.

## 49.5 Over-posting

DTO allowlist prevents many issues.

## 49.6 Rule

Validation reduces attack surface but does not replace security architecture.

---

# 50. Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus

## 50.1 Integration defaults

Jakarta REST runtimes integrate validation differently:

- mapper/default body;
- exception class wrapping;
- parameter name path;
- CDI integration;
- method validation behavior.

## 50.2 Hibernate Validator

Common reference implementation.

Version matters.

## 50.3 Quarkus

Build-time augmentation may affect reflection/validation metadata.

## 50.4 Open Liberty/Payara

Jakarta EE feature configuration matters.

## 50.5 Test target runtime

Do not rely only on unit validation tests.

## 50.6 Rule

Validation contract must be tested on the runtime you deploy.

---

# 51. Migration: Bean Validation / Jakarta Validation Namespace

## 51.1 Old namespace

```java
javax.validation.*
```

## 51.2 New namespace

```java
jakarta.validation.*
```

## 51.3 Mixed namespace trap

A DTO annotated with `javax.validation.NotNull` may not be recognized by Jakarta Validation runtime expecting `jakarta.validation.NotNull`.

## 51.4 Dependencies

Use Jakarta Validation API matching runtime.

For Jakarta EE 11, Jakarta Validation 3.1 is the platform version.

## 51.5 Tests

If validation suddenly stops, check imports first.

## 51.6 Rule

Migration must update imports, dependencies, provider versions, and tests.

---

# 52. Common Failure Modes

## 52.1 Missing `@Valid`

DTO constraints not executed.

## 52.2 Missing `@NotNull` on entity parameter

Empty/null body slips through.

## 52.3 Using `@NotNull` for string text

Blank string passes.

## 52.4 Nested DTO lacks `@Valid`

Nested violations missed.

## 52.5 List elements not validated

Missing `List<@Valid ItemRequest>`.

## 52.6 Validation error path is `arg0`

Client-unfriendly.

## 52.7 Mapping all `ValidationException` to 400

Server config errors hidden as client errors.

## 52.8 Business DB check in validator

Race condition/layering problem.

## 52.9 PATCH DTO loses presence

Null/missing confusion.

## 52.10 Unknown query params ignored

Client typo hidden.

## 52.11 Regex validator vulnerable

ReDoS risk.

## 52.12 `javax.validation` imports in Jakarta app

Validation not running.

---

# 53. Best Practices

## 53.1 Use DTOs and validate DTOs

No entity direct binding.

## 53.2 Use `@Valid` and `@NotNull` on required body

```java
@NotNull @Valid CreateRequest request
```

## 53.3 Use correct constraints

`@NotBlank` for required strings.

## 53.4 Validate nested structures

`List<@Valid ItemRequest>`.

## 53.5 Use class-level constraints for cross-field rules

Not random service code in resource.

## 53.6 Keep validators pure

No DB/remote/auth lookup.

## 53.7 Map validation errors to Problem Details

Field-level, stable code.

## 53.8 Test validation behavior via HTTP

Not just unit.

## 53.9 Keep domain rules in domain/service

Validation is boundary.

## 53.10 Document constraints in OpenAPI

Keep docs and runtime aligned.

---

# 54. Anti-Patterns

## 54.1 `@Valid` everywhere without understanding

Cargo-cult validation.

## 54.2 Validating domain entity directly from client JSON

Mass assignment risk.

## 54.3 Custom validator calls database

Wrong layer.

## 54.4 Using validation for authorization

Security hidden.

## 54.5 Returning raw `ConstraintViolationException`

Internal path/message leaks.

## 54.6 Ignoring validation groups but reusing one DTO everywhere

Create/update/patch confusion.

## 54.7 No size constraints on strings/lists

DoS risk.

## 54.8 Treating every invalid input as 500

Bad error mapping.

## 54.9 Localized message as machine code

Client break.

## 54.10 No validation contract tests

Provider/runtime changes unnoticed.

---

# 55. Production Checklist

## 55.1 DTO validation

- [ ] Request DTOs separate from entity/domain.
- [ ] Required body uses `@NotNull @Valid`.
- [ ] Required strings use `@NotBlank`.
- [ ] Required collections use `@NotEmpty`.
- [ ] Nested DTOs use `@Valid`.
- [ ] Container elements constrained where needed.
- [ ] String/collection max sizes defined.

## 55.2 Operation semantics

- [ ] Create DTO separate from update DTO.
- [ ] PATCH preserves presence semantics.
- [ ] Cross-field constraints defined.
- [ ] Domain invariants not hidden in validators.
- [ ] Authorization not hidden in validators.

## 55.3 Error contract

- [ ] `ConstraintViolationException` mapped.
- [ ] Problem Details used.
- [ ] Overall code `VALIDATION_FAILED`.
- [ ] Per-field violation codes.
- [ ] Field paths client-friendly.
- [ ] Invalid values not echoed.
- [ ] 400 vs 422 policy documented.

## 55.4 Runtime

- [ ] Jakarta Validation dependency/version correct.
- [ ] No `javax.validation` imports.
- [ ] Validation provider configured.
- [ ] CDI integration for validators tested if used.
- [ ] Target runtime HTTP tests pass.

## 55.5 Observability/security

- [ ] Validation errors counted safely.
- [ ] No raw body in logs.
- [ ] Regex safe.
- [ ] Length limits present.
- [ ] Spikes monitored.

## 55.6 Documentation

- [ ] OpenAPI reflects constraints.
- [ ] Examples include validation error.
- [ ] Custom constraints documented.
- [ ] Error codes documented.

---

# 56. Latihan

## Latihan 1 — Basic DTO Validation

Buat `CreateCustomerRequest` dengan:

- `displayName`: required, max 200;
- `email`: required, valid email;
- `type`: required enum;
- `tags`: optional max 10 items, each max 40 chars.

Test missing/null/blank/too long.

## Latihan 2 — Nested Validation

Buat `CreateOrderRequest`:

```java
@NotEmpty List<@Valid OrderItemRequest> items
```

`OrderItemRequest`:

- productId required;
- quantity positive;
- note max 200.

Test `items[0].quantity`.

## Latihan 3 — Query Param Validation

Endpoint:

```text
GET /customers?page=&size=&sort=
```

Validasi:

- page >= 1;
- size 1..100;
- q max 200.

Test invalid conversion vs validation.

## Latihan 4 — Cross-Field Constraint

Buat `SearchRequest` dengan `from` dan `to`.

Constraint:

```text
from <= to
range <= 90 days
```

Return field-level violation.

## Latihan 5 — Problem Details Mapper

Implement `ConstraintViolationExceptionMapper`.

Output:

```text
application/problem+json
VALIDATION_FAILED
violations[]
correlationId
```

## Latihan 6 — Create vs Patch

Buat create DTO yang mewajibkan email.

Buat patch flow yang membedakan missing/null/value.

Test presence semantics.

## Latihan 7 — Custom Constraint

Buat `@ValidSort` untuk query sort.

Allowed fields:

```text
createdAt
displayName
status
```

Reject unknown field.

## Latihan 8 — No DB in Validator Refactor

Buat contoh validator `@UniqueEmail` yang query DB.

Refactor ke service-level conflict check.

Return 409 `EMAIL_ALREADY_REGISTERED`.

## Latihan 9 — OpenAPI Alignment

Generate/open OpenAPI.

Pastikan constraints muncul:

- required;
- maxLength;
- minimum/maximum;
- pattern;
- email format.

---

# 57. Referensi Resmi

Referensi utama:

1. Jakarta Validation 3.1 Specification  
   https://jakarta.ee/specifications/bean-validation/3.1/jakarta-validation-spec-3.1.html

2. Jakarta Validation 3.1 API — `ConstraintViolationException`  
   https://jakarta.ee/specifications/bean-validation/3.1/apidocs/jakarta/validation/constraintviolationexception

3. Jakarta Validation 3.1 — Specification Page  
   https://jakarta.ee/specifications/bean-validation/3.1/

4. Jakarta EE Tutorial — Introduction to Jakarta Bean Validation  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/beanvalidation/bean-validation/bean-validation.html

5. Jakarta EE Tutorial — Jakarta REST Advanced Topics: Validation  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/websvcs/rest-advanced/rest-advanced.html

6. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

7. RFC 9457 — Problem Details for HTTP APIs  
   https://www.rfc-editor.org/rfc/rfc9457.html

8. Hibernate Validator Reference Guide  
   https://docs.jboss.org/hibernate/stable/validator/reference/en-US/html_single/

---

# 58. Penutup

Validation di JAX-RS/Jakarta REST adalah boundary contract.

Mental model final:

```text
HTTP metadata/body
  ↓
conversion/deserialization
  ↓
Jakarta Validation
  ↓
application command
  ↓
domain invariants
  ↓
authorization/business execution
```

Hal yang paling penting:

```text
Validation is not conversion.
Validation is not authorization.
Validation is not database lookup.
Validation is not domain state machine.
```

Validation menjawab:

```text
Apakah typed input ini memenuhi kontrak request?
```

Domain menjawab:

```text
Apakah operasi ini valid menurut keadaan bisnis sekarang?
```

Authorization menjawab:

```text
Apakah actor ini boleh melakukan operasi ini pada resource ini?
```

Top-tier JAX-RS engineer memastikan:

- constraints jelas;
- DTO tepat;
- nested validation berjalan;
- PATCH presence semantics benar;
- error response field-addressable;
- kode error stabil;
- tidak ada data sensitif bocor;
- validation tested via actual HTTP runtime;
- OpenAPI sesuai runtime.

Part berikutnya:

```text
Bagian 015 — Filters: ContainerRequestFilter and ContainerResponseFilter
```

Kita akan membahas filter pipeline: pre-matching vs post-matching, auth/correlation/logging/CORS, abortWith, priorities, name binding, request/response mutation, and safe cross-cutting architecture.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-013.md](./learn-jaxrs-advanced-part-013.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-015.md](./learn-jaxrs-advanced-part-015.md)
