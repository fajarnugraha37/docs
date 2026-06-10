# Strict Coding Standards — Java Hibernate Validator / Jakarta Validation

> **Purpose**: This document defines mandatory rules for LLMs, code agents, and human contributors when using Jakarta Validation, Bean Validation, and Hibernate Validator in Java applications.
>
> **Scope**: `javax.validation` Bean Validation 2.x, `jakarta.validation` Jakarta Validation 3.x, Hibernate Validator 6/7/8/9, Spring Boot, Quarkus, Jakarta EE, REST, gRPC, persistence, method validation, custom constraints, validation groups, message interpolation, and test design.
>
> **Mode**: Strict. Annotation validation is a contract mechanism. It must not become scattered decoration, hidden business logic, or a substitute for domain invariants and database constraints.

---

## 0. Core Principle

Jakarta Validation/Hibernate Validator must be used to declare and execute validation contracts at explicit boundaries.

A code agent must not add annotations until it knows:

1. whether the project uses `javax.validation.*` or `jakarta.validation.*`;
2. the Bean/Jakarta Validation version;
3. the Hibernate Validator version;
4. the Java baseline;
5. the framework integration point;
6. whether validation runs on request DTOs, method parameters, return values, entities, records, or custom value objects;
7. the error mapping contract;
8. whether groups or group sequences are required;
9. whether nested/container element validation is required;
10. how custom constraints are tested.

---

## 1. Version and Namespace Policy

### 1.1 Namespace rule

Do not mix namespaces.

| Stack | Namespace | Typical versions |
|---|---|---|
| Bean Validation 2.x | `javax.validation.*` | Hibernate Validator 6.x |
| Jakarta Validation 3.0 | `jakarta.validation.*` | Hibernate Validator 7.x/8.x depending platform |
| Jakarta Validation 3.1 | `jakarta.validation.*` | Hibernate Validator 9.x |

Forbidden:

```java
import javax.validation.constraints.NotNull;
import jakarta.validation.Valid;
```

All validation imports in a module must use one namespace family.

### 1.2 Java baseline compatibility

| Project baseline | Rule |
|---|---|
| Java 11 | Use Bean Validation 2.x / compatible provider unless project explicitly supports Jakarta stack with Java 11-compatible provider. |
| Java 17+ | Jakarta Validation 3.1 / Hibernate Validator 9.x is allowed when dependency platform supports it. |
| Java 21/25 | Same as Java 17 unless project has stricter framework BOM. Preview Java features remain forbidden by default. |

Jakarta Validation 3.1 requires Java 17 or higher. A Java 11 project must not be silently upgraded to Hibernate Validator 9.x.

### 1.3 Dependency governance

Rules:

- validation API version must come from platform BOM or dependency management;
- Hibernate Validator version must be pinned or managed by BOM;
- do not declare multiple validator providers unless explicit selection is required;
- do not mix Spring Boot/Quarkus/Jakarta EE managed versions with arbitrary manual overrides;
- no snapshot validator versions in production;
- no deprecated `org.hibernate:*` relocation coordinates for new Hibernate Validator 9.x code.

Maven example:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.hibernate.validator</groupId>
      <artifactId>hibernate-validator-bom</artifactId>
      <version>${hibernate.validator.version}</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

---

## 2. Where Validation Must Run

### 2.1 Request DTO validation

Use Bean/Jakarta Validation on request DTOs for:

- required fields;
- string length;
- numeric range;
- collection size;
- element validation;
- simple format validation;
- nested object validation;
- cross-field request validation through class-level constraint.

Example:

```java
public final class CreateApplicantRequest {
    @NotBlank
    @Size(max = 320)
    @Email
    private String email;

    @NotBlank
    @Size(max = 100)
    private String displayName;
}
```

### 2.2 Method validation

Method validation is allowed for service boundary preconditions and postconditions.

Allowed:

```java
public Applicant createApplicant(
        @NotNull Actor actor,
        @Valid @NotNull CreateApplicantCommand command) {
    ...
}
```

Rules:

- method validation must be enabled by framework configuration;
- self-invocation limitations must be understood in proxy-based frameworks;
- parameter names must be stable if exposed in error paths;
- constraints on overridden methods must follow specification rules;
- return value validation must not replace construction-time domain invariants.

### 2.3 Entity validation

Entity validation is restricted.

Allowed:

- simple persistence-compatible constraints;
- constraints matching column length/nullable/precision;
- lifecycle validation as defense-in-depth.

Restricted:

- business workflow rules;
- relationship traversal that triggers lazy loading;
- repository/database lookup validators;
- user-facing messages directly on entity constraints.

Forbidden by default:

- using entity validation as the only API validation;
- exposing entity validation paths/messages directly to clients;
- validating detached partial entities as if complete.

### 2.4 Record validation

Records may be validated only when baseline and framework support it.

Rules:

- Java 16+ records only;
- Java 17+ recommended for Jakarta Validation 3.1;
- validation should target record components/constructor parameters clearly;
- records are suitable for immutable DTO/value carriers;
- records are not a substitute for rich domain entities.

---

## 3. Built-In Constraint Rules

### 3.1 Required fields

Use correct constraint by type.

| Need | Correct constraint |
|---|---|
| non-null reference | `@NotNull` |
| non-null, length > 0 string | `@NotEmpty` |
| non-null, not only whitespace string | `@NotBlank` |
| non-empty collection/map/array | `@NotEmpty` |

Forbidden:

- using `@NotNull` when blank string must be rejected;
- using `@NotBlank` on non-CharSequence values;
- relying on deserializer defaults for missing required fields.

### 3.2 String length

Rules:

- `@Size(max = n)` must align with API and database contract;
- do not assume `@Size` counts user-perceived characters;
- define whether length is code units, code points, bytes, or database column semantics when Unicode matters;
- validate encoded byte length separately if protocol/database byte limit matters.

### 3.3 Number range

Rules:

- use `@Min`/`@Max` for integral values;
- use `@DecimalMin`/`@DecimalMax` for decimal values;
- use `@Digits` for precision/scale;
- money values must define scale and rounding outside validation.

Forbidden:

- using `double`/`float` for money validation;
- assuming JSON numeric precision survives through all clients;
- trusting database rounding/truncation.

### 3.4 Email and URL

`@Email` is acceptable for basic email shape validation.

Rules:

- do not treat `@Email` as proof of deliverability;
- do not use email regex for authentication/identity trust;
- URL validation must use URI parsing plus SSRF allow-list policy, not only a format annotation;
- host/domain validation must be explicit.

### 3.5 Pattern

`@Pattern` is restricted.

Required:

- bounded input length;
- tested valid/invalid examples;
- ReDoS review;
- clear message/code;
- no overly complex unreviewed regex.

Forbidden:

- `@Pattern` on unbounded user input;
- catastrophic backtracking patterns;
- business rules encoded as unreadable regex when code would be clearer.

---

## 4. Nested and Container Element Validation

### 4.1 Nested object validation

Use `@Valid` for nested object validation.

```java
public final class CreateOrderRequest {
    @Valid
    @NotNull
    private CustomerRequest customer;
}
```

Rules:

- `@NotNull` and `@Valid` solve different problems;
- `@Valid` does not imply the nested object must be present;
- nested validation depth must be bounded by object model;
- circular object graphs must be avoided or understood.

### 4.2 Collection element validation

Use container element constraints when available.

```java
private List<@NotBlank @Size(max = 50) String> tags;

private Map<@NotBlank String, @Valid AttributeRequest> attributes;
```

Rules:

- validate collection size with `@Size`;
- validate element type with container element constraints;
- validate null element policy explicitly;
- error mapping must preserve indexes/keys.

### 4.3 Optional validation

Do not use `Optional` as a DTO field by default.

If used, define:

- absent vs present-null behavior;
- serialization/deserialization semantics;
- container element validation support;
- API documentation.

---

## 5. Validation Groups

### 5.1 Default rule

Avoid validation groups unless different operations require materially different rules.

Prefer separate DTOs for:

- create;
- update;
- patch;
- search;
- admin operation;
- workflow-specific action.

Groups are allowed when separate DTOs would duplicate most structure and the validation lifecycle is explicit.

### 5.2 Group naming

Group interfaces must be named after operation/context, not technical layer.

Allowed:

```java
interface Create {}
interface Update {}
interface Submit {}
interface Approve {}
```

Forbidden:

```java
interface Group1 {}
interface Basic {}
interface ControllerValidation {}
```

### 5.3 Group sequences

Group sequences are restricted.

Use only when:

- validation order matters;
- expensive constraints must run after cheap constraints;
- later constraints depend on earlier shape validation.

Required:

- tests proving order;
- documentation of why order matters;
- no hidden business workflow encoded only as group sequence.

Forbidden:

- using groups to simulate state machine transitions;
- using groups to hide inconsistent DTO design;
- running “all groups” by default.

---

## 6. Custom Constraints

### 6.1 When custom constraint is allowed

Custom constraints are allowed for reusable pure validation logic.

Good candidates:

- domain-specific identifier format;
- country-specific registration number format;
- cross-field consistency inside one DTO;
- bounded code list validation;
- normalized string policy;
- checksum validation.

Bad candidates:

- database uniqueness;
- authorization;
- state transition requiring aggregate load;
- remote API lookup;
- rule with side effects;
- highly operation-specific logic used once.

### 6.2 Custom annotation requirements

Every custom constraint annotation must define:

```java
@Documented
@Constraint(validatedBy = MyConstraintValidator.class)
@Target({ FIELD, METHOD, PARAMETER, ANNOTATION_TYPE, TYPE_USE })
@Retention(RUNTIME)
public @interface ValidSomething {
    String message() default "{validation.something.invalid}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

Rules:

- include `message`, `groups`, and `payload` elements;
- choose correct `@Target`;
- support `TYPE_USE` only when intended;
- keep default message as key, not hardcoded final user text;
- document null behavior.

### 6.3 ConstraintValidator rules

A `ConstraintValidator` must be:

- stateless after initialization, or immutable;
- thread-safe;
- side-effect free;
- deterministic;
- fast and bounded;
- null behavior explicit;
- free of request-specific mutable state.

Forbidden:

- injecting repository into validator for common DTO validation;
- calling remote service from validator;
- writing database/audit/log side effects other than safe debug/trace logging;
- depending on current time without injected `Clock` or explicit validation context;
- throwing random runtime exceptions for invalid value instead of returning `false`;
- using non-thread-safe mutable fields.

### 6.4 Null behavior

By convention, custom validators should return `true` for `null` unless the constraint itself means required.

Use `@NotNull` separately for requiredness.

Example:

```java
@Override
public boolean isValid(String value, ConstraintValidatorContext context) {
    if (value == null) {
        return true;
    }
    return isValidFormat(value);
}
```

---

## 7. Class-Level and Cross-Field Validation

### 7.1 Allowed use cases

Class-level constraints are allowed for rules such as:

- `startDate <= endDate`;
- exactly one of two fields must be present;
- if type is X then field Y is required;
- min/max range consistency;
- dependent fields in a single request DTO.

### 7.2 Error path requirement

Class-level validator must attach violation to a useful property path when possible.

Do not return only object-level error if field-level path can guide the user.

Rules:

- disable default violation when adding specific violations;
- add property node for field-specific error;
- use stable message keys;
- test property path.

---

## 8. Message Interpolation and I18N

### 8.1 Message key policy

Use message keys:

```java
@NotBlank(message = "{applicant.email.required}")
```

Avoid hardcoding final prose in annotations except for internal-only prototypes.

### 8.2 Message parameters

Messages may include constraint attributes such as `{min}` and `{max}`.

Rules:

- do not expose secrets/rejected raw values;
- avoid untrusted HTML;
- keep messages concise;
- code must not parse human messages for logic;
- stable error code must be separate from localized message when exposed externally.

### 8.3 Expression Language awareness

Hibernate Validator may use Jakarta Expression Language for dynamic interpolation.

Rules:

- ensure required EL implementation exists in Java SE apps;
- do not embed untrusted expressions;
- prefer simple interpolation over dynamic EL;
- if EL is not available and a non-spec interpolator is used, document the trade-off.

---

## 9. Fail-Fast Mode

### 9.1 Default

Fail-fast is disabled by default for external request validation so clients can receive multiple field errors.

Fail-fast may be enabled for:

- internal commands;
- expensive validation chains;
- large object graphs;
- security-sensitive early rejection;
- batch mode with strict first-error policy.

### 9.2 Configuration rule

Fail-fast must be configured centrally.

Forbidden:

- ad-hoc per-validator factory creation in application code;
- changing fail-fast behavior per request without explicit contract;
- assuming fail-fast means one error per field; fail-fast stops at first violation encountered globally.

---

## 10. Constraint Payload

Payload must not be abused for business logic.

Allowed:

- severity metadata;
- internal classification;
- UI hints if project standard permits.

Forbidden:

- authorization logic;
- hidden workflow control;
- transport-specific behavior buried in generic constraint;
- security decision based only on payload marker.

---

## 11. Clock and Time Validation

Time-sensitive validation must be deterministic.

Rules:

- use injected/configured `Clock` where framework supports it;
- avoid `Instant.now()`/`LocalDate.now()` inside validators unless provider clock is controlled;
- specify timezone for date business rules;
- test boundary at DST/leap day/month-end if relevant.

Examples:

- `@Future`/`@Past` are allowed for simple boundary rules;
- complex business calendars must use explicit policy service, not only annotations.

---

## 12. Framework Integration

### 12.1 Spring

Rules:

- use `@Valid`/`@Validated` according to Spring integration;
- do not assume method validation works without proxy/configuration;
- understand self-invocation limitation;
- map `MethodArgumentNotValidException` / validation exceptions to stable error response;
- do not expose raw Spring binding errors directly.

### 12.2 Quarkus

Rules:

- use Quarkus-managed Hibernate Validator extension;
- validate REST request/response only where explicitly configured;
- ensure native-image/reflection implications are understood for custom validators/classes;
- test validation in Quarkus integration tests when framework behavior matters.

### 12.3 Jakarta EE / JAX-RS

Rules:

- use container-provided validation provider where possible;
- do not package conflicting provider versions into application server without policy;
- map `ConstraintViolationException` consistently;
- avoid mixing CDI-managed and manually-created validators unless justified.

### 12.4 Manual validation

Manual validation with `Validator` is allowed when framework integration is not available.

Rules:

- `ValidatorFactory` must be application-scoped and closed on shutdown;
- `Validator` should be reused according to provider guidance;
- do not create a factory per request;
- centralize error mapping.

---

## 13. Programmatic Constraint Mapping

Programmatic constraint mapping is restricted.

Allowed:

- framework/library integration;
- multi-tenant/product-specific validation loaded at startup;
- generated DTOs where annotations cannot be modified;
- migration from legacy validation metadata.

Required:

- centralized configuration;
- tests proving mapping is active;
- documentation explaining why annotations are insufficient;
- no runtime mutation after application startup.

Forbidden:

- scattered ad-hoc mappings;
- dynamic user-controlled validation rules without sandbox and governance;
- hiding validation rules from code review.

---

## 14. XML Validation Descriptors

XML descriptors are restricted.

Allowed:

- legacy migration;
- generated or externalized validation metadata;
- overriding third-party classes.

Rules:

- descriptor files must be version controlled;
- XML parser security must follow `java_xml` standard;
- descriptor override behavior must be tested;
- do not keep duplicate contradictory annotation and XML rules.

---

## 15. Performance and Object Graph Safety

Validation must be bounded.

Rules:

- avoid validating huge object graphs eagerly;
- avoid relationship traversal that triggers N+1 queries;
- avoid recursive/cyclic graph validation;
- set collection size limits at DTO boundary;
- use groups or staged validation only when justified;
- benchmark custom validators if used on hot paths.

Forbidden:

- validator that loads lazy JPA collections accidentally;
- validator that performs one database query per collection element;
- validator that recursively validates unbounded graph from API payload;
- validator that reads entire file/content into memory.

---

## 16. Security Rules

Forbidden by default:

- using validation annotations as authorization;
- custom validator performing SSRF-prone URL fetch;
- custom validator executing scripts/expressions from user input;
- regex-based validation on unbounded input;
- exposing raw rejected sensitive values;
- trusting validation as SQL injection protection;
- native Java deserialization inside validators.

Required:

- allow-list policy for enum-like fields;
- URL/host validation through security policy;
- path validation through base-directory containment;
- error redaction;
- safe logging.

---

## 17. Error Mapping

### 17.1 ConstraintViolation mapping

Every `ConstraintViolation` exposed externally must be mapped to project error model.

Map:

- property path;
- invalid value redacted if sensitive;
- message key/resolved message;
- constraint type;
- stable error code;
- object/request location.

Do not expose:

- Java class names;
- package names;
- stack traces;
- validator implementation details;
- raw message templates if internal.

### 17.2 Property path translation

Internal property paths must be translated to API field names when names differ.

Example:

```text
Java path: applicantEmail
API path: applicant.email
```

The mapping must be tested.

---

## 18. Testing Hibernate/Jakarta Validation

### 18.1 DTO validation tests

Every DTO with non-trivial validation must have tests for:

- valid object;
- null field;
- empty/blank field;
- min boundary;
- max boundary;
- invalid format;
- nested object invalid path;
- collection element invalid path;
- group-specific behavior if any;
- message code/key if exposed;
- redaction if mapped to API error.

### 18.2 Custom constraint tests

Every custom constraint must test:

- valid value;
- invalid value;
- null behavior;
- boundary values;
- annotation attributes;
- thread-safety if validator has state;
- property path for class-level constraints;
- message interpolation parameters;
- groups/payload if supported;
- ReDoS/pathological input for regex validators.

### 18.3 Method validation tests

Method validation must be tested at framework boundary, not only by manually calling validator.

Required:

- proxy/container invocation path;
- invalid parameter;
- invalid return value if used;
- self-invocation behavior if relevant;
- error mapping.

---

## 19. Anti-Patterns

Forbidden by default:

- mixing `javax.validation` and `jakarta.validation`;
- adding annotations without tests;
- using validation groups to model full business workflow;
- using entity annotations as complete REST validation;
- using validators with repository/network side effects;
- custom validator with mutable non-thread-safe fields;
- creating `ValidatorFactory` per request;
- exposing raw `ConstraintViolationException` to clients;
- using `@Pattern` for complex unsafe parsing;
- marking everything `@Valid` without understanding object graph;
- validating secrets and then logging invalid value;
- swallowing validation exception and proceeding;
- relying on annotation validation for database uniqueness;
- manually checking `if (x == null)` everywhere when standard constraints and centralized mapping exist;
- using `@NotNull` where `@NotBlank` is required.

---

## 20. LLM Implementation Protocol

Before changing Hibernate/Jakarta Validation code, the agent must produce:

```text
Validation Annotation Design Note
- Namespace: javax.validation / jakarta.validation
- Validation API version:
- Hibernate Validator version:
- Java baseline:
- Target object: DTO / command / entity / method / record / custom value object
- Integration: Spring / Quarkus / Jakarta EE / manual / other
- Operation: create / update / patch / submit / approve / internal
- Groups needed: yes/no, why
- Nested/container validation needed: yes/no
- Custom constraint needed: yes/no, why
- Error mapping impact:
- Sensitive fields to redact:
- Tests added:
```

If the namespace or version is unknown, the agent must inspect the build files before editing imports.

---

## 21. Reviewer Checklist

Reject the change if any answer is “no”:

- Does the code use one validation namespace only?
- Is the validator version compatible with Java baseline?
- Are constraints placed on the right boundary object?
- Are DTO, entity, command, and domain responsibilities separated?
- Are required, empty, blank, and absent semantics correct?
- Are nested objects and container elements validated intentionally?
- Are groups avoided unless justified?
- Are custom validators stateless, thread-safe, deterministic, and side-effect free?
- Are repository/network calls kept out of simple validators?
- Is fail-fast/aggregate behavior consistent with API contract?
- Are validation errors mapped to stable codes and safe messages?
- Are sensitive values redacted?
- Are database invariants backed by database constraints?
- Are tests covering valid, invalid, null, boundary, nested, and group cases?
- Is the solution aligned with project framework integration?

---

## 22. Sources and References

- Jakarta Validation 3.1 release page: https://jakarta.ee/specifications/bean-validation/3.1/
- Jakarta Validation 3.1 specification: https://jakarta.ee/specifications/bean-validation/3.1/jakarta-validation-spec-3.1.html
- Hibernate Validator documentation: https://hibernate.org/validator/documentation/
- Hibernate Validator stable reference guide: https://docs.hibernate.org/stable/validator/reference/en-US/html_single/
- Hibernate Validator 9.0 release notes: https://in.relation.to/2025/05/20/hibernate-validator-9-0-0-Final/
- Hibernate Validator 9.1 release notes: https://in.relation.to/2025/11/07/hibernate-validator-9-1-0-Final/
- OWASP Bean Validation Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Bean_Validation_Cheat_Sheet.html
- OWASP Input Validation Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
