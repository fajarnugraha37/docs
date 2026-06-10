# Strict Coding Standards — Java Validation

> **Purpose**: This document defines mandatory rules for LLMs, code agents, and human contributors when designing and implementing validation in Java systems.
>
> **Scope**: Java 11, Java 17, Java 21, and Java 25 applications using REST, gRPC, messaging, CLI, batch, database, Jakarta Validation, Hibernate Validator, Spring Validation, Quarkus validation, custom validation, schema validation, and domain invariants.
>
> **Mode**: Strict. Validation is a boundary and invariant enforcement mechanism, not decorative annotation placement.

---

## 0. Core Principle

Validation must protect a contract at the correct boundary.

A code agent must never add validation only because a field exists. Before implementing validation, it must identify:

1. the input source;
2. the trust boundary;
3. the owning layer;
4. the business invariant;
5. the error contract;
6. whether validation rejects invalid input, normalizes input, or enforces domain state;
7. whether validation must happen before persistence, before command execution, before remote calls, or at domain construction time;
8. whether the same rule must exist at API, domain, database, or event schema level.

If the owning boundary is unclear, the implementation must not silently place validation in a random DTO, entity, or controller.

---

## 1. Validation Taxonomy

### 1.1 Validation categories

| Category                 | Purpose                             | Example                                     | Owner                      |
| ------------------------ | ----------------------------------- | ------------------------------------------- | -------------------------- |
| Syntax validation        | Shape, type, parseability           | email format, ISO date, UUID string         | API/DTO/schema layer       |
| Semantic validation      | Meaning inside business context     | end date after start date                   | application/domain layer   |
| Authorization validation | Actor can perform action            | user can approve this case                  | authorization policy layer |
| State validation         | Transition is allowed               | DRAFT → SUBMITTED                           | domain state machine       |
| Referential validation   | referenced object exists/usable     | product ID exists and active                | application/service layer  |
| Consistency validation   | multi-field or cross-aggregate rule | quota cannot exceed remaining balance       | domain/application layer   |
| Persistence validation   | DB-level integrity                  | unique key, FK, check constraint            | database schema            |
| Integration validation   | external contract compatibility     | OpenAPI/protobuf/JSON schema                | boundary contract          |
| Security validation      | reject dangerous input              | path traversal, SSRF URL, injection payload | security boundary          |
| Operational validation   | safe execution limits               | max batch size, max file size               | platform/application layer |

### 1.2 Forbidden validation confusion

A code agent must not:

- treat DTO annotation validation as complete domain validation;
- treat database constraints as complete API validation;
- perform authorization inside generic field validation annotations;
- perform network/database lookups inside simple validators unless explicitly classified as application validation;
- convert invalid input into default values without explicit business rule;
- silently trim, lowercase, normalize, or coerce data unless the contract says normalization is required;
- rely on frontend validation for backend safety;
- replace domain invariants with controller annotations;
- use validation as a substitute for transaction isolation, locking, or database constraints;
- use regular expressions as the only security control for complex grammars.

---

## 2. Boundary Rules

### 2.1 External input boundary

Every external entry point must validate input before executing business side effects.

External entry points include:

- HTTP request body;
- HTTP query/path parameters;
- gRPC request messages;
- CLI arguments;
- batch file rows;
- CSV/XML/JSON imports;
- Kafka/RabbitMQ/message payloads;
- scheduler parameters;
- webhook callbacks;
- admin console input;
- environment/config values;
- database values consumed from shared or legacy tables.

External input validation must be explicit, tested, and mapped to a stable error contract.

### 2.2 Internal boundary

Internal method calls do not need repeated validation if all of these are true:

1. the caller is trusted;
2. the object is already validated or constructed through a safe constructor/factory;
3. the invariant cannot be broken through mutation;
4. the method is not part of a public API, plugin API, message handler, or framework callback.

If any condition is false, the method must validate or require an already validated type.

### 2.3 Domain boundary

Domain objects must protect their own invariants.

Allowed:

- constructor/factory validation;
- value object validation;
- state transition validation;
- domain policy validation;
- explicit command validation before mutation.

Forbidden:

- public setters that allow invalid intermediate domain state;
- entity creation with invalid state followed by later “fix-up” validation;
- assuming ORM/Jackson/JAXB will always call constructors/factories;
- relying only on annotations for complex invariants.

### 2.4 Persistence boundary

Database constraints must exist for durable invariants.

Mandatory for durable data:

- primary key;
- required field constraint where applicable;
- unique constraint for uniqueness invariant;
- foreign key for referential integrity where architecture permits;
- check constraint for stable simple invariant;
- length/precision/scale constraint;
- migration test for schema change.

Application validation improves error messages and early rejection, but must not replace database constraints for durable invariants.

---

## 3. Input Normalization Policy

### 3.1 Normalize only when contract says so

Normalization changes data. It is not harmless.

Allowed normalization examples:

- trimming surrounding whitespace for username field if explicitly specified;
- canonicalizing email domain to lowercase if specified;
- Unicode normalization for identifier comparison if specified;
- parsing date string into `LocalDate` using fixed formatter;
- converting empty string to `null` only if API contract says empty means absent.

Forbidden by default:

- automatically trimming all strings globally;
- lowercasing names, addresses, comments, or case-sensitive identifiers;
- silently converting invalid number/date to zero/current date;
- silently truncating strings to fit database column;
- silently replacing unsupported characters;
- automatically escaping instead of validating output context;
- normalizing secrets, passwords, tokens, or cryptographic values.

### 3.2 Validate after normalization

If normalization is required, validation must be applied to the normalized value.

Required order:

```text
raw input -> parse -> normalize if explicitly required -> validate -> construct domain/request command
```

The raw value must not be used after normalized value is accepted unless raw preservation is part of audit or legal requirement.

---

## 4. Null, Empty, Blank, and Absent

### 4.1 Required distinction

A validation rule must distinguish:

| State                | Meaning                     |
| -------------------- | --------------------------- |
| `null`               | absent value at Java level  |
| empty string `""`    | present but empty           |
| blank string `"   "` | present but only whitespace |
| absent JSON property | not submitted               |
| explicit JSON `null` | submitted as null           |
| empty collection     | submitted with no elements  |
| missing collection   | no value supplied           |

A code agent must not collapse these states unless the API contract explicitly defines equivalence.

### 4.2 Patch/update semantics

For partial updates:

- absent field means “do not change”;
- explicit `null` means one of: clear value, reject, or set to null — it must be defined;
- empty string/collection must not be interpreted as absent unless defined;
- validation must run only on fields intended to change, plus cross-field rules affected by the change.

Forbidden:

- using the same DTO for create and patch when required/null semantics differ;
- blindly copying patch DTO fields to entity;
- using primitive fields in patch DTO when absence must be represented.

---

## 5. DTO, Command, Domain, and Entity Validation

### 5.1 DTO validation

DTO validation may enforce:

- syntactic shape;
- primitive size/range;
- required/optional API fields;
- collection size limits;
- request-level field combinations;
- deserialization-safe constraints.

DTO validation must not own:

- authorization;
- durable uniqueness;
- complex state transitions;
- cross-aggregate consistency;
- expensive external checks;
- irreversible side-effect checks.

### 5.2 Command validation

Commands must represent validated intent.

A command object must:

- use strong types when possible;
- preserve actor/context information required for authorization;
- represent an operation, not just mirror an HTTP payload;
- be immutable where baseline Java permits;
- validate operation-level preconditions before mutation.

### 5.3 Domain validation

Domain validation must protect invariants even when called outside HTTP/gRPC.

Examples:

- amount must be positive;
- status transition must be allowed;
- approval requires approver role and current state;
- expiration date cannot be before issue date;
- aggregate cannot exceed configured quota.

### 5.4 Entity validation

Entities may have simple validation annotations, but entity annotations are not enough.

Allowed:

- `@NotNull` equivalent on mandatory field;
- `@Size` equivalent matching database length;
- `@Digits` equivalent matching precision/scale;
- simple domain-safe constraints.

Restricted:

- cross-entity validation in entity callbacks;
- lazy-loading relationships during validation;
- validators that query repositories;
- validation groups mapped directly to workflow states.

Forbidden by default:

- exposing entity validation errors directly as API response;
- treating entity validation as REST validation;
- placing user-facing message text only in entity annotations;
- validating detached partial entities as if they were complete aggregates.

---

## 6. Error Contract

### 6.1 Validation error response

Validation errors must have a stable machine-readable contract.

Minimum fields:

```json
{
  "type": "https://example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "One or more fields are invalid.",
  "errors": [
    {
      "code": "FIELD_REQUIRED",
      "field": "applicant.email",
      "message": "Email is required.",
      "rejectedValue": null
    }
  ],
  "correlationId": "..."
}
```

Rules:

- `code` must be stable;
- `field` must identify API field path, not internal Java property if names differ;
- `message` may be localized;
- `rejectedValue` must be redacted for secrets/tokens/passwords/files/PII according to policy;
- `correlationId` must be included where observability standard requires it;
- internal exception class names must not leak.

### 6.2 HTTP status

Default mapping:

| Case                                                 |                           HTTP status |
| ---------------------------------------------------- | ------------------------------------: |
| malformed JSON/XML/body                              |                                   400 |
| syntactically valid but semantically invalid request | 400 or 422, according to API standard |
| authentication missing/invalid                       |                                   401 |
| authenticated but forbidden                          |                                   403 |
| referenced resource not found                        |                                   404 |
| state conflict / optimistic lock / duplicate key     |                                   409 |
| unsupported media type                               |                                   415 |
| payload too large                                    |                                   413 |
| rate limit                                           |                                   429 |

The project must choose 400 vs 422 consistently. A code agent must not mix both for the same class of validation error.

### 6.3 gRPC status

Default mapping:

| Case                     | gRPC status                                                      |
| ------------------------ | ---------------------------------------------------------------- |
| invalid request argument | `INVALID_ARGUMENT`                                               |
| missing authentication   | `UNAUTHENTICATED`                                                |
| authorization denied     | `PERMISSION_DENIED`                                              |
| resource not found       | `NOT_FOUND`                                                      |
| conflicting state        | `FAILED_PRECONDITION` or `ABORTED`, depending on retry semantics |
| quota/rate limit         | `RESOURCE_EXHAUSTED`                                             |

Do not encode validation failure as `UNKNOWN` or application-specific success response unless contract explicitly requires it.

---

## 7. Security Validation

### 7.1 Input validation is not output encoding

Validation must not be used as the only defense against XSS, SQL injection, command injection, or log injection.

Required:

- validate input shape at boundary;
- use parameterized SQL/JPQL;
- use context-specific output encoding;
- escape logs or structure logs safely;
- enforce allow-lists for identifiers, file paths, URLs, and enum-like fields.

### 7.2 Allow-list by default

Allow-list validation is required for:

- enum-like request fields;
- sort fields;
- dynamic SQL identifiers;
- file extensions/content categories;
- URL schemes/hosts/ports;
- callback/webhook destinations;
- command names;
- feature flags;
- role names;
- workflow action names.

Deny-list validation is allowed only as defense-in-depth and must not be the primary control.

### 7.3 Regex safety

Regular expressions must be reviewed for ReDoS risk.

Required:

- bounded input length before regex;
- avoid nested ambiguous quantifiers;
- prefer simple parser for complex formats;
- test pathological inputs;
- avoid user-controlled regex unless sandboxed and bounded.

Forbidden:

- regex validation on unbounded input;
- catastrophic backtracking patterns;
- complex email/URL validation implemented by ad-hoc regex when library/parser exists.

### 7.4 File validation

File validation must check:

- total request size;
- file size;
- file count;
- generated storage filename;
- base-directory containment;
- extension allow-list if relevant;
- content type as advisory only;
- magic bytes/content sniffing where needed;
- archive bomb risk;
- malware scanning if policy requires;
- no native deserialization of file content.

### 7.5 URL validation

URL validation must check:

- scheme allow-list;
- host allow-list or strict policy;
- no loopback/private/link-local/metadata endpoint unless explicitly allowed;
- resolved IP validation;
- redirect policy;
- DNS rebinding risk;
- timeout and body size limit.

---

## 8. Collection and Batch Validation

### 8.1 Collection constraints

For collection inputs, validate:

- maximum element count;
- minimum element count if required;
- per-element constraints;
- duplicate policy;
- ordering policy;
- null element policy;
- aggregate size limit;
- stable error path including index/key.

Example error path:

```text
items[3].price.amount
attachments[report.pdf].size
```

### 8.2 Batch input

Batch validation must define:

- fail-fast or collect-all mode;
- maximum row count;
- maximum error count returned;
- whether one bad row rejects the whole batch;
- transaction behavior;
- deduplication policy;
- row identity in error messages;
- partial success contract.

Forbidden:

- validating entire unbounded batch in memory;
- returning millions of validation errors;
- committing partial results without explicit partial success contract;
- hiding failed rows in logs only.

---

## 9. Fail-Fast vs Aggregate Errors

### 9.1 Default mode

Default for external API validation: aggregate field errors up to a safe limit.

Default for internal domain invariant violation: fail-fast.

Default for batch import: configurable, documented, and bounded.

### 9.2 Aggregate error limit

Error collection must be bounded.

Required:

```text
maxValidationErrors = project-defined finite number
```

Once exceeded, return a summary error such as:

```text
Too many validation errors. First 100 errors returned.
```

### 9.3 Fail-fast use cases

Fail-fast is appropriate when:

- later validation depends on earlier valid parse;
- checks are expensive;
- validation is internal invariant enforcement;
- failing early avoids side effects;
- security policy requires early rejection.

---

## 10. Internationalization and Messages

### 10.1 Stable codes before messages

User-facing messages may change. Error codes must be stable.

Required:

- stable machine code;
- localized message key;
- default message;
- field path;
- optional parameters.

Example:

```json
{
  "code": "AMOUNT_MUST_BE_POSITIVE",
  "messageKey": "validation.amount.positive",
  "parameters": { "min": "0.01" }
}
```

### 10.2 Message safety

Validation messages must not include:

- passwords;
- tokens;
- raw secrets;
- full file contents;
- untrusted HTML;
- stack traces;
- SQL fragments;
- internal class/package names;
- authorization policy internals.

---

## 11. Validation and Type Design

### 11.1 Prefer strong types

Validation should move weak primitive strings into stronger types as early as possible.

Examples:

| Weak input           | Strong type                  |
| -------------------- | ---------------------------- |
| `String applicantId` | `ApplicantId`                |
| `String email`       | `EmailAddress`               |
| `BigDecimal amount`  | `Money`                      |
| `String status`      | `ApplicationStatus`          |
| `String date`        | `LocalDate`                  |
| `String url`         | `URI` plus allow-list policy |

### 11.2 Value object rule

A value object constructor/factory must reject invalid values.

Forbidden:

- `new EmailAddress("not-email")` succeeding;
- `Money.of(null, amount)` succeeding;
- value object with public setters;
- invalid placeholder value object used to satisfy framework mapping.

### 11.3 Enum validation

Enum-like external values must be mapped explicitly.

Rules:

- do not expose Java enum names if API names must be stable independently;
- reject unknown values unless forward compatibility policy says otherwise;
- define case sensitivity;
- define deprecation/alias behavior;
- do not use enum ordinal in persistence/API.

---

## 12. Validation in Layered Architecture

### 12.1 Controller/resource layer

Must:

- parse and validate request DTO;
- map validation failure to API error contract;
- not run business rule checks that require transaction/state mutation unless delegated;
- not duplicate domain invariant logic.

### 12.2 Application service layer

Must:

- validate command preconditions;
- load references needed for rule evaluation;
- call authorization policy;
- coordinate transaction;
- handle optimistic/concurrency conflicts.

### 12.3 Domain layer

Must:

- enforce invariant and transition validity;
- reject impossible state;
- remain valid regardless of caller.

### 12.4 Repository layer

Must:

- rely on database constraints for durable integrity;
- translate constraint violations into domain/application errors where appropriate;
- not silently ignore duplicate/constraint failures.

---

## 13. Validation with Java Baselines

| Java baseline | Rule                                                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Java 11       | Use classic DTO classes/builders; avoid record-based validation.                                                                                    |
| Java 17       | Records may be used for immutable request/value carriers when framework supports constructor/component validation.                                  |
| Java 21       | Pattern matching/switch may be used only if baseline standard allows it; validation logic must remain clear.                                        |
| Java 25       | Scoped values may carry immutable validation context only if project baseline allows; preview validation APIs/features remain forbidden by default. |

A code agent must not use Java 17+ records or Java 21+ pattern matching in validation code for a Java 11 project.

---

## 14. Configuration Validation

Application configuration must be validated at startup.

Required:

- required property present;
- numeric range;
- URL/URI validity;
- timeout positive and bounded;
- pool size reasonable;
- enum values valid;
- secret reference present, not secret literal in config file;
- feature flags known;
- incompatible options rejected.

Forbidden:

- starting application with invalid critical config;
- silently defaulting missing production secrets;
- lazy failure on first request for config that could be validated at startup.

---

## 15. Validation and Observability

Validation failure logging must be useful but safe.

Log:

- validation error code;
- field path;
- request/correlation ID;
- actor/tenant if safe;
- input source;
- count of errors;
- rejected value only if non-sensitive and policy allows.

Do not log:

- passwords;
- bearer tokens;
- full request bodies by default;
- PII unless explicitly permitted;
- file contents;
- stack trace for expected validation failures.

Metrics:

- validation failures by endpoint/use case;
- validation failures by error code;
- payload too large count;
- malformed request count;
- batch validation rejected rows.

---

## 16. Testing Rules

Every validation rule must have tests for:

- valid input;
- null/absent input;
- empty/blank input where relevant;
- boundary minimum;
- boundary maximum;
- just below/above boundary;
- malformed input;
- localized or formatted input where relevant;
- malicious input where relevant;
- collection element path;
- error code stability;
- redaction of sensitive rejected value.

Cross-field rules must test combinations, not only individual fields.

Batch validation must test:

- first error;
- many errors;
- max error limit;
- duplicate rows;
- partial success/failure contract;
- transaction behavior.

---

## 17. Anti-Patterns

Forbidden by default:

- validation only in frontend;
- validation only in database;
- validation only in annotations without domain invariants;
- controller doing all validation/business logic;
- repository validators querying unrelated aggregates;
- validator methods with hidden side effects;
- `catch (Exception)` and return generic “invalid”;
- returning stack trace as validation error;
- using validation to hide authorization failure inconsistently;
- silently correcting invalid input;
- duplicate validation rules with inconsistent limits;
- magic regex copied from internet without tests;
- accepting unknown JSON fields without compatibility/security decision;
- accepting unknown enum values and mapping them to default;
- unbounded recursive validation of object graphs;
- locale-dependent parsing without explicit locale.

---

## 18. LLM Implementation Protocol

Before adding or changing validation, the code agent must produce a short design note:

```text
Validation Design Note
- Input source:
- Trust boundary:
- Owning layer:
- Rule category:
- Normalization policy:
- Null/blank/absent semantics:
- Error code(s):
- HTTP/gRPC/message mapping:
- Sensitive fields to redact:
- Database constraint needed: yes/no
- Domain invariant needed: yes/no
- Tests added:
```

The agent must not implement validation until this information can be inferred from existing code or explicit requirements.

---

## 19. Reviewer Checklist

A reviewer must reject validation changes if any answer is “no”:

- Is the validation located at the correct boundary?
- Are DTO, command, domain, and persistence responsibilities separated?
- Are null, absent, empty, and blank semantics explicit?
- Are normalization rules intentional?
- Are error codes stable and messages safe?
- Are sensitive rejected values redacted?
- Are collection/batch limits bounded?
- Are expensive checks placed in application layer rather than simple validators?
- Are domain invariants enforced inside domain construction/transition?
- Are durable invariants backed by database constraints?
- Are regexes bounded and tested against pathological inputs?
- Are tests covering boundaries and failure modes?
- Are API/gRPC/message error mappings consistent?
- Is the solution compatible with the project Java baseline?

---

## 20. Sources and References

- Jakarta Validation 3.1 Specification: https://jakarta.ee/specifications/bean-validation/3.1/jakarta-validation-spec-3.1.html
- Jakarta Validation 3.1 release page: https://jakarta.ee/specifications/bean-validation/3.1/
- OWASP Input Validation Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
- OWASP Bean Validation Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Bean_Validation_Cheat_Sheet.html
- OWASP API Security Top 10: https://owasp.org/API-Security/
- RFC 9457 Problem Details for HTTP APIs: https://www.rfc-editor.org/rfc/rfc9457.html
- RFC 9110 HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
