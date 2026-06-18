# learn-jaxrs-advanced-part-045.md

# Bagian 045 — Error Contract and Enterprise Error Taxonomy: Problem Details, Stable Error Code, Domain vs Validation vs Security vs Infrastructure Errors, Localization, Retryability, Field Errors, Correlation ID, Supportability, Compatibility, and Governance

> Target pembaca: Java/Jakarta engineer yang ingin mendesain **kontrak error enterprise-grade untuk Jakarta REST/JAX-RS APIs**. Fokus bagian ini bukan hanya “pakai `ExceptionMapper`”, tetapi bagaimana membuat error contract yang stabil, machine-readable, aman, supportable, observable, dan compatible lintas versi/service/client.
>
> Teknologi utama: RFC 9457 Problem Details, HTTP status code semantics, `jakarta.ws.rs.ext.ExceptionMapper`, `WebApplicationException`, `Response`, `application/problem+json`, Jakarta Validation, domain exceptions, security exceptions, persistence exceptions, downstream exceptions, OpenTelemetry error semantics, audit/support correlation.
>
> Prinsip utama:
>
> ```text
> Error response is an API contract.
> If clients depend on it, it must be designed, versioned, tested, and governed.
> ```

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Error adalah Contract, Bukan Exception Dump](#2-mental-model-error-adalah-contract-bukan-exception-dump)
3. [Kenapa Error Contract Enterprise Sulit](#3-kenapa-error-contract-enterprise-sulit)
4. [HTTP Status vs Error Code vs Exception Class](#4-http-status-vs-error-code-vs-exception-class)
5. [Problem Details RFC 9457](#5-problem-details-rfc-9457)
6. [`application/problem+json`](#6-applicationproblemjson)
7. [Base Problem Schema](#7-base-problem-schema)
8. [Enterprise Extension Fields](#8-enterprise-extension-fields)
9. [Stable Error Code Design](#9-stable-error-code-design)
10. [Error Code Naming Convention](#10-error-code-naming-convention)
11. [Error Taxonomy Overview](#11-error-taxonomy-overview)
12. [Validation Errors](#12-validation-errors)
13. [Field Errors](#13-field-errors)
14. [Domain Errors](#14-domain-errors)
15. [State/Workflow Errors](#15-stateworkflow-errors)
16. [Conflict Errors](#16-conflict-errors)
17. [Concurrency and Precondition Errors](#17-concurrency-and-precondition-errors)
18. [Authentication Errors](#18-authentication-errors)
19. [Authorization Errors](#19-authorization-errors)
20. [Tenant/Object Access Errors](#20-tenantobject-access-errors)
21. [Rate Limit and Quota Errors](#21-rate-limit-and-quota-errors)
22. [Resource Consumption Errors](#22-resource-consumption-errors)
23. [Payload and Media Type Errors](#23-payload-and-media-type-errors)
24. [Not Found vs Forbidden vs Hidden Resource](#24-not-found-vs-forbidden-vs-hidden-resource)
25. [Dependency/Downstream Errors](#25-dependencydownstream-errors)
26. [Infrastructure Errors](#26-infrastructure-errors)
27. [Unexpected Internal Errors](#27-unexpected-internal-errors)
28. [Retryability](#28-retryability)
29. [User Action and Developer Action](#29-user-action-and-developer-action)
30. [Localization Strategy](#30-localization-strategy)
31. [Supportability: Correlation ID, Trace ID, Incident ID](#31-supportability-correlation-id-trace-id-incident-id)
32. [Security and Error Detail](#32-security-and-error-detail)
33. [ExceptionMapper Architecture](#33-exceptionmapper-architecture)
34. [Domain Exception Hierarchy](#34-domain-exception-hierarchy)
35. [Validation Exception Mapping](#35-validation-exception-mapping)
36. [Persistence Exception Mapping](#36-persistence-exception-mapping)
37. [Client/Downstream Exception Mapping](#37-clientdownstream-exception-mapping)
38. [WebApplicationException Handling](#38-webapplicationexception-handling)
39. [Error Response Factory](#39-error-response-factory)
40. [HTTP Status Mapping Table](#40-http-status-mapping-table)
41. [Error Catalog](#41-error-catalog)
42. [OpenAPI Documentation](#42-openapi-documentation)
43. [Error Compatibility Rules](#43-error-compatibility-rules)
44. [Versioning Error Contracts](#44-versioning-error-contracts)
45. [Observability: Logs, Metrics, Traces](#45-observability-logs-metrics-traces)
46. [Client Handling Guidelines](#46-client-handling-guidelines)
47. [Testing Error Contract](#47-testing-error-contract)
48. [Governance Model](#48-governance-model)
49. [Common Failure Modes](#49-common-failure-modes)
50. [Best Practices](#50-best-practices)
51. [Anti-Patterns](#51-anti-patterns)
52. [Production Checklist](#52-production-checklist)
53. [Latihan](#53-latihan)
54. [Referensi Resmi](#54-referensi-resmi)
55. [Penutup](#55-penutup)

---

# 1. Tujuan Part Ini

Banyak API gagal bukan karena success response buruk, tetapi karena error response buruk.

Contoh buruk:

```json
{
  "message": "Something went wrong"
}
```

atau:

```json
{
  "error": "java.lang.NullPointerException at com.company..."
}
```

atau:

```json
{
  "status": 500,
  "message": "ORA-00001 unique constraint SYS.C004128 violated"
}
```

Masalahnya:

- client tidak tahu harus retry atau tidak;
- frontend tidak tahu pesan apa yang aman ditampilkan;
- support tidak punya correlation ID;
- error code berubah setiap refactor exception class;
- validation error tidak punya field path;
- domain error bercampur dengan infrastructure error;
- security error membocorkan resource existence;
- observability tidak bisa aggregate error;
- OpenAPI tidak mendokumentasikan error;
- antar service error shape berbeda.

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- mendesain Problem Details response enterprise-grade;
- membedakan HTTP status, error code, dan exception class;
- membuat taxonomy error yang stabil;
- mendesain `fieldErrors`;
- menandai retryability dan user/developer action;
- menjaga error detail agar aman;
- membuat `ExceptionMapper` architecture;
- mendokumentasikan error di OpenAPI;
- menguji error contract;
- membuat governance error catalog lintas service.

---

# 2. Mental Model: Error adalah Contract, Bukan Exception Dump

Exception adalah internal implementation detail.

Error response adalah public API contract.

## 2.1 Internal

```java
OptimisticLockException
SQLIntegrityConstraintViolationException
ConstraintViolationException
AccessDeniedException
DownstreamTimeoutException
```

## 2.2 External

```json
{
  "type": "https://api.example.com/problems/stale-resource-version",
  "title": "Stale resource version",
  "status": 412,
  "code": "STALE_RESOURCE_VERSION",
  "retryable": false,
  "correlationId": "..."
}
```

## 2.3 Rule

Never expose internal exception model directly to API consumers.

---

# 3. Kenapa Error Contract Enterprise Sulit

Enterprise API punya banyak caller:

- browser UI;
- mobile app;
- backend service;
- partner;
- batch job;
- generated SDK;
- support tools;
- monitoring.

Masing-masing butuh informasi berbeda.

## 3.1 Frontend

Butuh:

- pesan user-friendly;
- field errors;
- action;
- localization key.

## 3.2 Backend service

Butuh:

- stable code;
- retryability;
- status;
- correlation ID;
- whether safe to retry.

## 3.3 Support

Butuh:

- correlation ID;
- trace ID;
- error code;
- timestamp;
- affected resource maybe.

## 3.4 Security

Butuh:

- no stack trace;
- no sensitive resource existence leak;
- no token/SQL/path leak.

## 3.5 Rule

Good error contract balances client automation, user experience, supportability, and security.

---

# 4. HTTP Status vs Error Code vs Exception Class

## 4.1 HTTP status

Protocol-level classification.

Examples:

```text
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
412 Precondition Failed
422 Unprocessable Content
429 Too Many Requests
500 Internal Server Error
503 Service Unavailable
```

## 4.2 Error code

Application/domain-level stable machine-readable code.

Examples:

```text
APPLICATION_NOT_SUBMITTABLE
CUSTOMER_EMAIL_ALREADY_EXISTS
STALE_RESOURCE_VERSION
TENANT_ACCESS_DENIED
DOWNSTREAM_TIMEOUT
```

## 4.3 Exception class

Internal Java implementation.

Examples:

```java
ApplicationNotSubmittableException
SQLIntegrityConstraintViolationException
OptimisticLockException
```

## 4.4 Rule

HTTP status tells class of failure; error code tells exact API reason; exception class stays internal.

---

# 5. Problem Details RFC 9457

Problem Details defines common format for HTTP API errors.

Base members:

```text
type
title
status
detail
instance
```

## 5.1 `type`

URI reference identifying problem type.

Use stable URL/URN.

## 5.2 `title`

Short human-readable summary.

Should not vary by occurrence except localization.

## 5.3 `status`

HTTP status code.

## 5.4 `detail`

Human-readable explanation specific to occurrence.

Careful with sensitive data.

## 5.5 `instance`

URI reference identifying specific occurrence.

Could be request/incident/problem instance.

## 5.6 Rule

Use Problem Details as base format, then add enterprise extension fields carefully.

---

# 6. `application/problem+json`

Error response content type should be:

```http
Content-Type: application/problem+json
```

## 6.1 Why

Clients can parse error consistently.

## 6.2 Negotiation

If client sends `Accept: application/problem+json`, return it.

Many APIs return Problem Details for errors even when success media type is `application/json`.

## 6.3 Rule

Make error content type consistent and documented.

---

# 7. Base Problem Schema

Recommended enterprise base:

```json
{
  "type": "https://api.example.com/problems/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "detail": "One or more request fields are invalid.",
  "instance": "/problems/instances/01JABC",
  "code": "VALIDATION_FAILED",
  "correlationId": "9f4f1a",
  "traceId": "4bf92f...",
  "timestamp": "2026-06-12T10:00:00Z"
}
```

## 7.1 Required minimum

At least:

```text
type
title
status
code
correlationId
```

## 7.2 Optional

```text
detail
instance
traceId
timestamp
fieldErrors
retryable
userAction
developerAction
```

## 7.3 Rule

Keep base schema stable across all services.

---

# 8. Enterprise Extension Fields

Problem Details allows extension members.

Useful extensions:

```text
code
correlationId
traceId
timestamp
fieldErrors
retryable
retryAfterSeconds
userAction
developerAction
docs
severity
supportReference
```

## 8.1 Extension field rule

Every extension field must have:

- documented meaning;
- type;
- stability guarantee;
- security review.

## 8.2 Avoid

- Java exception name;
- stackTrace;
- sqlState if sensitive;
- raw downstream response;
- debug object dump.

## 8.3 Rule

Problem extensions are contract fields, not dumping ground.

---

# 9. Stable Error Code Design

Error code is what clients should branch on.

## 9.1 Stable

Once published, do not casually rename.

## 9.2 Specific enough

Bad:

```text
ERROR
BAD_REQUEST
FAILED
```

Good:

```text
APPLICATION_NOT_SUBMITTABLE
STALE_RESOURCE_VERSION
DOCUMENT_MALWARE_DETECTED
```

## 9.3 Not too specific

Bad:

```text
POSTGRES_UNIQUE_CONSTRAINT_CUSTOMERS_EMAIL_TENANT_ID_IDX_FAILED
```

Better:

```text
CUSTOMER_EMAIL_ALREADY_EXISTS
```

## 9.4 Rule

Error code should express API/domain meaning, not implementation cause.

---

# 10. Error Code Naming Convention

Recommended:

```text
UPPER_SNAKE_CASE
DOMAIN_REASON
```

Examples:

```text
VALIDATION_FAILED
AUTHENTICATION_REQUIRED
ACCESS_DENIED
RESOURCE_NOT_FOUND
APPLICATION_NOT_SUBMITTABLE
CUSTOMER_EMAIL_ALREADY_EXISTS
STALE_RESOURCE_VERSION
RATE_LIMIT_EXCEEDED
DOWNSTREAM_TIMEOUT
INTERNAL_ERROR
```

## 10.1 Domain prefix?

For large systems:

```text
APPLICATION_NOT_SUBMITTABLE
CASE_ALREADY_ASSIGNED
DOCUMENT_TYPE_NOT_ALLOWED
```

## 10.2 Avoid HTTP status in code

Bad:

```text
HTTP_400_VALIDATION
```

Status already exists.

## 10.3 Rule

Use one naming convention across services.

---

# 11. Error Taxonomy Overview

Top-level categories:

```text
VALIDATION
DOMAIN
STATE
CONFLICT
CONCURRENCY
AUTHENTICATION
AUTHORIZATION
TENANT_ACCESS
RATE_LIMIT
RESOURCE_LIMIT
PAYLOAD_MEDIA
NOT_FOUND
DEPENDENCY
INFRASTRUCTURE
INTERNAL
```

## 11.1 Why taxonomy matters

- consistent mapping;
- observability;
- support routing;
- client handling;
- governance.

## 11.2 Rule

Every error code belongs to one category.

---

# 12. Validation Errors

Validation errors mean request shape/value invalid before domain operation.

Examples:

```text
missing required field
invalid email format
string too long
invalid enum
invalid date range format
invalid query parameter
```

## 12.1 HTTP status

Common:

```text
400 Bad Request
```

or:

```text
422 Unprocessable Content
```

depending API policy.

## 12.2 Problem

```json
{
  "type": "https://api.example.com/problems/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "code": "VALIDATION_FAILED",
  "fieldErrors": [...]
}
```

## 12.3 Rule

Validation error should be precise enough for client to fix request.

---

# 13. Field Errors

Field errors describe invalid fields.

## 13.1 Schema

```json
{
  "field": "applicant.email",
  "code": "EMAIL_INVALID",
  "message": "Email address is invalid.",
  "rejectedValue": null
}
```

## 13.2 Safer schema

Avoid returning rejected value for sensitive fields.

```json
{
  "field": "password",
  "code": "PASSWORD_TOO_WEAK",
  "message": "Password does not meet complexity requirements."
}
```

## 13.3 Field path

Use stable API field path, not Java property path if they differ.

## 13.4 Multiple errors

Return all actionable field errors, but cap count.

## 13.5 Rule

Field error paths are API schema paths, not entity/internal paths.

---

# 14. Domain Errors

Domain error means request is syntactically valid but business rule rejects it.

Examples:

```text
APPLICATION_NOT_SUBMITTABLE
OFFICER_NOT_ELIGIBLE
DOCUMENT_REQUIRED
PAYMENT_NOT_COMPLETED
CASE_ALREADY_CLOSED
```

## 14.1 HTTP status

Often:

```text
409 Conflict
```

or `422` depending policy.

## 14.2 Example

```json
{
  "type": "https://api.example.com/problems/application-not-submittable",
  "title": "Application cannot be submitted",
  "status": 409,
  "code": "APPLICATION_NOT_SUBMITTABLE",
  "detail": "Application is missing required supporting documents."
}
```

## 14.3 Rule

Domain errors should use domain language and stable code.

---

# 15. State/Workflow Errors

State errors occur when action is not valid in current lifecycle state.

## 15.1 Example

```text
Cannot approve application in DRAFT state.
Cannot cancel already completed operation.
Cannot assign closed case.
```

## 15.2 Error

```json
{
  "status": 409,
  "code": "INVALID_STATE_TRANSITION",
  "currentState": "DRAFT",
  "requestedTransition": "APPROVE"
}
```

## 15.3 Security caveat

Do not expose state if caller should not know resource exists.

## 15.4 Rule

Workflow errors should help valid clients recover and guide UI actions.

---

# 16. Conflict Errors

Conflict means request conflicts with current state.

Examples:

- duplicate email;
- duplicate idempotency key with different body;
- unique constraint;
- already exists;
- invalid state transition;
- active operation already exists.

## 16.1 HTTP status

Usually:

```text
409 Conflict
```

## 16.2 Rule

Use 409 when conflict can be resolved by changing request or resource state.

---

# 17. Concurrency and Precondition Errors

## 17.1 Stale update

Client sends stale ETag.

```http
412 Precondition Failed
```

Error:

```json
{
  "code": "STALE_RESOURCE_VERSION",
  "status": 412
}
```

## 17.2 Missing precondition

If API requires `If-Match`:

```http
428 Precondition Required
```

## 17.3 Rule

Use precondition statuses for optimistic concurrency, not generic 409 only.

---

# 18. Authentication Errors

Authentication means caller is not authenticated.

## 18.1 Missing/invalid token

```http
401 Unauthorized
WWW-Authenticate: Bearer
```

Problem:

```json
{
  "status": 401,
  "code": "AUTHENTICATION_REQUIRED",
  "title": "Authentication required"
}
```

## 18.2 Avoid detail

Do not reveal:

```text
token expired vs signature invalid vs wrong audience
```

unless trusted/internal policy allows.

## 18.3 Rule

401 means authenticate and try again.

---

# 19. Authorization Errors

Authorization means caller authenticated but not allowed.

## 19.1 Example

```http
403 Forbidden
```

Problem:

```json
{
  "status": 403,
  "code": "ACCESS_DENIED",
  "title": "Access denied"
}
```

## 19.2 No retry

Usually not retryable without permission change.

## 19.3 Rule

403 should not invite blind retry.

---

# 20. Tenant/Object Access Errors

BOLA and tenant isolation need careful error.

## 20.1 Hidden resource strategy

Return 404 for resources caller cannot access to avoid existence leak.

## 20.2 Explicit forbidden strategy

Return 403 when resource existence is not sensitive or caller already has context.

## 20.3 Consistency

Pick policy per endpoint/resource sensitivity.

## 20.4 Rule

Security policy determines 403 vs hidden 404.

---

# 21. Rate Limit and Quota Errors

## 21.1 Rate limit

```http
429 Too Many Requests
Retry-After: 60
```

Problem:

```json
{
  "status": 429,
  "code": "RATE_LIMIT_EXCEEDED",
  "retryable": true,
  "retryAfterSeconds": 60
}
```

## 21.2 Quota exceeded

Could be:

```text
429
403
409
```

depending if temporary/permanent/business quota.

## 21.3 Rule

Rate/quota errors should tell client whether and when retry is useful.

---

# 22. Resource Consumption Errors

Examples:

- request body too large;
- file too large;
- JSON depth too high;
- too many items;
- query too complex;
- too many active jobs.

## 22.1 Status

- `413 Content Too Large`;
- `400/422`;
- `429`;
- `409`.

## 22.2 Error code

```text
REQUEST_BODY_TOO_LARGE
FILE_TOO_LARGE
QUERY_TOO_COMPLEX
TOO_MANY_ACTIVE_OPERATIONS
```

## 22.3 Rule

Resource limit errors are security and product contract.

---

# 23. Payload and Media Type Errors

## 23.1 Malformed JSON

```http
400 Bad Request
```

Code:

```text
MALFORMED_JSON
```

## 23.2 Unsupported request media type

```http
415 Unsupported Media Type
```

Code:

```text
UNSUPPORTED_MEDIA_TYPE
```

## 23.3 Not acceptable response media type

```http
406 Not Acceptable
```

Code:

```text
NOT_ACCEPTABLE
```

## 23.4 Rule

Content negotiation errors should be explicit and tested.

---

# 24. Not Found vs Forbidden vs Hidden Resource

## 24.1 True not found

Resource does not exist.

```http
404
RESOURCE_NOT_FOUND
```

## 24.2 Forbidden

Resource exists but caller lacks permission, and exposing existence is acceptable.

```http
403
ACCESS_DENIED
```

## 24.3 Hidden not found

Resource may exist, but caller should not know.

```http
404
RESOURCE_NOT_FOUND
```

or generic.

## 24.4 Rule

Document policy; do not implement random 403/404 behavior per developer.

---

# 25. Dependency/Downstream Errors

Downstream failure should not leak downstream internals.

## 25.1 Examples

- payment provider timeout;
- document scanner unavailable;
- identity provider error;
- object storage unavailable.

## 25.2 Status

Often:

```text
502 Bad Gateway
503 Service Unavailable
504 Gateway Timeout
```

depending role/proxy policy.

## 25.3 Problem

```json
{
  "status": 503,
  "code": "DOCUMENT_SCANNER_UNAVAILABLE",
  "retryable": true
}
```

## 25.4 Rule

Expose service-level failure semantics, not vendor error dumps.

---

# 26. Infrastructure Errors

Infrastructure errors:

- database unavailable;
- connection pool exhausted;
- message broker down;
- disk full;
- config missing;
- timeout acquiring lock.

## 26.1 Status

Usually:

```text
500
503
```

depending temporary/service availability.

## 26.2 Client action

Most clients cannot fix infrastructure errors.

## 26.3 Rule

Infrastructure errors should be supportable via correlation ID and observable metrics.

---

# 27. Unexpected Internal Errors

Unexpected bugs:

```text
NullPointerException
IllegalStateException
unhandled mapping bug
```

## 27.1 Response

```json
{
  "type": "https://api.example.com/problems/internal-error",
  "title": "Internal server error",
  "status": 500,
  "code": "INTERNAL_ERROR",
  "correlationId": "..."
}
```

## 27.2 Logs

Log full stack internally with correlation/trace ID.

## 27.3 Rule

Client gets safe generic error; internal logs get details.

---

# 28. Retryability

Clients need know whether retry may help.

## 28.1 Add field

```json
{
  "retryable": true,
  "retryAfterSeconds": 30
}
```

## 28.2 Retryable examples

- 429 after delay;
- 503 temporary;
- 504 timeout;
- downstream timeout;
- lock timeout maybe.

## 28.3 Non-retryable examples

- validation failure;
- authorization denied;
- duplicate unique conflict;
- invalid state;
- stale ETag without refetch.

## 28.4 Rule

Retryability is operation-specific, not only status-code-specific.

---

# 29. User Action and Developer Action

## 29.1 User action

```json
"userAction": "UPLOAD_REQUIRED_DOCUMENT"
```

or localized message key.

## 29.2 Developer action

```json
"developerAction": "REFETCH_RESOURCE_AND_RETRY_WITH_LATEST_ETAG"
```

## 29.3 Keep optional

Not every error needs both.

## 29.4 Rule

Action hints can improve UX and reduce support load.

---

# 30. Localization Strategy

## 30.1 Do not localize `code`

Code is stable machine field.

## 30.2 Localize `title/detail` if needed

Based on `Accept-Language`.

## 30.3 Better for frontend

Return message key/params:

```json
{
  "code": "DOCUMENT_REQUIRED",
  "messageKey": "error.document.required",
  "messageParams": {
    "documentType": "IDENTITY"
  }
}
```

## 30.4 Rule

Separate machine code from human language.

---

# 31. Supportability: Correlation ID, Trace ID, Incident ID

## 31.1 Correlation ID

Returned to client.

Support asks user for it.

## 31.2 Trace ID

Useful internally to find distributed trace.

May be returned if safe.

## 31.3 Incident/support reference

For high-risk errors, create support reference.

## 31.4 Rule

Every 5xx should be supportable with a stable reference.

---

# 32. Security and Error Detail

## 32.1 Do not leak

- stack trace;
- SQL;
- table name;
- internal host;
- file path;
- token reason;
- user existence;
- tenant existence;
- downstream raw body.

## 32.2 Environment difference

Development can show more detail locally.

Production must be safe.

## 32.3 Rule

Error detail must pass security review.

---

# 33. ExceptionMapper Architecture

Centralize error mapping.

## 33.1 Specific mappers

```java
@Provider
public class DomainExceptionMapper implements ExceptionMapper<DomainException> { ... }

@Provider
public class ValidationExceptionMapper implements ExceptionMapper<ConstraintViolationException> { ... }

@Provider
public class ThrowableMapper implements ExceptionMapper<Throwable> { ... }
```

## 33.2 Mapper specificity

JAX-RS chooses mapper by exception type specificity.

## 33.3 Catch-all mapper

Have fallback for unexpected exceptions.

## 33.4 Rule

Exception mappers define external error contract.

---

# 34. Domain Exception Hierarchy

Example:

```java
public abstract class DomainException extends RuntimeException {
    private final ErrorCode code;
    private final Map<String, Object> params;
}

public final class ApplicationNotSubmittableException extends DomainException { ... }

public final class DuplicateCustomerEmailException extends DomainException { ... }
```

## 34.1 Domain exception should not contain HTTP

Prefer domain code and category.

Mapping layer decides HTTP status.

## 34.2 Rule

Domain layer knows domain reason; API layer maps to HTTP.

---

# 35. Validation Exception Mapping

Jakarta Validation exceptions should become field errors.

## 35.1 Constraint violations

Map:

- property path;
- constraint code;
- message;
- rejected value if safe.

## 35.2 API field path

Translate internal path to API path if DTO differs.

## 35.3 Rule

Validation mapper should not expose Java class/property internals.

---

# 36. Persistence Exception Mapping

DB exceptions should map to API meaning.

## 36.1 Unique constraint

Do not expose constraint name directly.

Map known constraint:

```text
uk_customer_tenant_email → CUSTOMER_EMAIL_ALREADY_EXISTS
```

## 36.2 FK violation

Could be:

```text
RELATED_RESOURCE_NOT_FOUND
```

or conflict.

## 36.3 Optimistic lock

```text
STALE_RESOURCE_VERSION
```

## 36.4 Rule

Persistence error mapper needs constraint-name-to-domain-code registry.

---

# 37. Client/Downstream Exception Mapping

JAX-RS Client exceptions include:

- `ProcessingException`;
- `ResponseProcessingException`;
- status-specific `WebApplicationException` in some client flows;
- timeout exceptions depending implementation.

## 37.1 Map to domain/integration errors

```text
DOWNSTREAM_TIMEOUT
DOWNSTREAM_UNAVAILABLE
DOWNSTREAM_INVALID_RESPONSE
DOWNSTREAM_REJECTED_REQUEST
```

## 37.2 Rule

Downstream error mapping should classify retryability.

---

# 38. WebApplicationException Handling

`WebApplicationException` carries a `Response`.

## 38.1 Risk

Developers throw:

```java
throw new WebApplicationException("bad", 400);
```

This can bypass enterprise error contract.

## 38.2 Strategy

- avoid direct `WebApplicationException` in domain/service;
- allow in resource for simple cases only if mapped;
- catch/map to Problem Details;
- standardize helper factory.

## 38.3 Rule

Do not let random `WebApplicationException` produce inconsistent error shapes.

---

# 39. Error Response Factory

Central factory ensures consistency.

## 39.1 Example

```java
@ApplicationScoped
public class ProblemFactory {

    public ProblemDetails create(
        ErrorDescriptor descriptor,
        RequestContext context,
        Map<String, Object> params
    ) {
        return new ProblemDetails(
            descriptor.type(),
            descriptor.title(),
            descriptor.status(),
            descriptor.code(),
            context.correlationId(),
            context.traceId(),
            Instant.now(),
            params
        );
    }
}
```

## 39.2 Benefits

- consistent shape;
- correlation ID always present;
- redaction centralized;
- localization hook;
- metrics hook.

## 39.3 Rule

Build Problem Details through one approved path.

---

# 40. HTTP Status Mapping Table

| Category | Example Code | HTTP |
|---|---|---|
| Malformed request | `MALFORMED_JSON` | 400 |
| Validation | `VALIDATION_FAILED` | 400/422 |
| Auth missing | `AUTHENTICATION_REQUIRED` | 401 |
| Forbidden | `ACCESS_DENIED` | 403 |
| Hidden forbidden | `RESOURCE_NOT_FOUND` | 404 |
| Not found | `RESOURCE_NOT_FOUND` | 404 |
| Duplicate/conflict | `CUSTOMER_EMAIL_ALREADY_EXISTS` | 409 |
| Invalid state | `INVALID_STATE_TRANSITION` | 409 |
| Stale ETag | `STALE_RESOURCE_VERSION` | 412 |
| Missing precondition | `PRECONDITION_REQUIRED` | 428 |
| Unsupported media | `UNSUPPORTED_MEDIA_TYPE` | 415 |
| Not acceptable | `NOT_ACCEPTABLE` | 406 |
| Too large | `REQUEST_BODY_TOO_LARGE` | 413 |
| Rate limit | `RATE_LIMIT_EXCEEDED` | 429 |
| Downstream bad response | `DOWNSTREAM_BAD_GATEWAY` | 502 |
| Downstream unavailable | `DOWNSTREAM_UNAVAILABLE` | 503 |
| Downstream timeout | `DOWNSTREAM_TIMEOUT` | 504 |
| Unexpected bug | `INTERNAL_ERROR` | 500 |

## 40.1 Rule

Mapping table should be shared across services and documented.

---

# 41. Error Catalog

An error catalog lists all stable codes.

## 41.1 Fields

```text
code
category
httpStatus
title
description
retryable
userAction
developerAction
owner
introducedIn
deprecatedIn
replacementCode
```

## 41.2 Example

```yaml
- code: APPLICATION_NOT_SUBMITTABLE
  category: DOMAIN
  httpStatus: 409
  retryable: false
  owner: licensing-domain
  userAction: COMPLETE_REQUIRED_FIELDS
```

## 41.3 Rule

Enterprise APIs need error catalog just like endpoint catalog.

---

# 42. OpenAPI Documentation

Document reusable Problem schema.

## 42.1 Schema

```yaml
ProblemDetails:
  type: object
  required: [type, title, status, code, correlationId]
  properties:
    type:
      type: string
      format: uri
    title:
      type: string
    status:
      type: integer
    detail:
      type: string
    code:
      type: string
    correlationId:
      type: string
    fieldErrors:
      type: array
      items:
        $ref: '#/components/schemas/FieldError'
```

## 42.2 Per operation

List possible error codes.

## 42.3 Rule

Do not document only `default: Error`; document meaningful errors.

---

# 43. Error Compatibility Rules

Breaking changes:

- remove error code;
- rename error code;
- change HTTP status for existing code;
- change field type;
- remove required field;
- change retryability semantics;
- remove field error path;
- make previously safe retry unsafe.

Non-breaking:

- add optional extension field;
- add new error code for new operation;
- add docs;
- add more specific detail if safe.

## 43.1 Rule

Error contract has backward compatibility rules like success contract.

---

# 44. Versioning Error Contracts

## 44.1 Same major version

Keep error shape and codes compatible.

## 44.2 New major version

Can change taxonomy/shape, but provide migration guide.

## 44.3 Deprecation

Mark old code deprecated before removal.

```yaml
deprecated: true
replacementCode: NEW_CODE
```

## 44.4 Rule

Error codes live long; choose carefully.

---

# 45. Observability: Logs, Metrics, Traces

## 45.1 Logs

Log:

- correlation ID;
- trace ID;
- error code;
- status;
- exception type internal;
- safe context.

## 45.2 Metrics

```text
api.errors.total{code,status,operation}
api.validation.errors.total{field,code?}
api.downstream.errors.total{downstream,code}
```

Watch cardinality.

## 45.3 Traces

Add span attributes:

```text
app.error_code
http.response.status_code
error.type
```

Record exception details internally for unexpected errors.

## 45.4 Rule

Every error code should be observable.

---

# 46. Client Handling Guidelines

Tell clients:

- branch on `code`, not `title/detail`;
- use HTTP status for broad class;
- use `retryable` and `Retry-After` for retries;
- display localized frontend message based on code;
- show correlation ID for support;
- tolerate unknown optional fields;
- handle unknown error code generically.

## 46.1 Rule

Error contract includes client behavior guidance.

---

# 47. Testing Error Contract

## 47.1 Unit tests

- mapper maps domain exception to descriptor;
- factory includes correlation ID;
- redaction works.

## 47.2 Integration tests

- malformed JSON;
- validation failure;
- auth failure;
- forbidden;
- not found;
- conflict;
- stale ETag;
- downstream timeout;
- unexpected exception.

## 47.3 Contract tests

Assert:

- content type `application/problem+json`;
- status;
- code;
- required fields;
- field errors;
- no stack trace;
- no internal message.

## 47.4 Rule

Error contract must be tested as heavily as success contract.

---

# 48. Governance Model

## 48.1 Error review

New error code needs:

- owner;
- category;
- HTTP status;
- retryability;
- docs;
- tests;
- security review if detail includes domain info.

## 48.2 Lint

CI can check:

- code convention;
- OpenAPI documents Problem schema;
- every 4xx/5xx uses Problem Details;
- no stackTrace field;
- error codes in catalog.

## 48.3 Rule

Without governance, taxonomy decays into chaos.

---

# 49. Common Failure Modes

## 49.1 One generic error code

Client cannot act.

## 49.2 Exception class as code

Refactor breaks clients.

## 49.3 Stack trace to client

Information leak.

## 49.4 SQL error leaked

Security/support issue.

## 49.5 Validation path uses entity field

API/client mismatch.

## 49.6 Different services use different shapes

Client complexity.

## 49.7 All errors return 200

Breaks HTTP semantics.

## 49.8 All domain errors return 500

Wrong and noisy.

## 49.9 Retryable not defined

Retry storms or missed recovery.

## 49.10 Error codes not documented

Support/client confusion.

## 49.11 403/404 policy inconsistent

Existence leakage.

## 49.12 Catch-all mapper hides important status

Bad mapper ordering/specificity.

---

# 50. Best Practices

## 50.1 Use Problem Details

Standard base.

## 50.2 Add stable `code`

Machine handling.

## 50.3 Keep errors safe

No internal leaks.

## 50.4 Use taxonomy

Validation/domain/security/dependency/internal.

## 50.5 Include correlation ID

Supportability.

## 50.6 Document retryability

Clients need safe behavior.

## 50.7 Map exceptions centrally

Consistent `ExceptionMapper`.

## 50.8 Test errors

Contract-level tests.

## 50.9 Maintain catalog

Governance.

## 50.10 Preserve compatibility

Error codes are API.

---

# 51. Anti-Patterns

## 51.1 `throw new RuntimeException("bad")`

No domain meaning.

## 51.2 Random `WebApplicationException`

Inconsistent.

## 51.3 `message` only

Not machine-readable.

## 51.4 Localized message as only error identifier

Cannot branch reliably.

## 51.5 Return raw downstream error

Leaks implementation.

## 51.6 Use 500 for validation

Wrong.

## 51.7 Use 400 for every business error

Too coarse.

## 51.8 Expose rejected password/token value

Security leak.

## 51.9 No correlation ID

Support blind.

## 51.10 Rename code casually

Breaking change.

---

# 52. Production Checklist

## 52.1 Schema

- [ ] Uses `application/problem+json`.
- [ ] Base schema defined.
- [ ] `code` required.
- [ ] `correlationId` required.
- [ ] `fieldErrors` schema defined.
- [ ] Sensitive fields excluded.
- [ ] Retryability modeled.

## 52.2 Mapping

- [ ] Domain exception mapper.
- [ ] Validation exception mapper.
- [ ] Security exception mapper.
- [ ] Persistence exception mapper.
- [ ] Downstream exception mapper.
- [ ] Catch-all mapper.
- [ ] WebApplicationException policy.

## 52.3 Catalog/docs

- [ ] Error catalog exists.
- [ ] OpenAPI references Problem schema.
- [ ] Per operation errors documented.
- [ ] Retry/client guidance documented.
- [ ] Localization strategy documented.
- [ ] Compatibility rules documented.

## 52.4 Tests/observability

- [ ] Error integration tests.
- [ ] No stack trace tests.
- [ ] Validation field error tests.
- [ ] 403/404 policy tests.
- [ ] Metrics by error code.
- [ ] Logs include correlation/trace.
- [ ] Security review done.

---

# 53. Latihan

## Latihan 1 — Base Problem Schema

Buat Java record:

```java
ProblemDetails
FieldError
```

Dengan fields enterprise.

## Latihan 2 — Error Catalog

Buat YAML berisi 20 error codes:

- validation;
- domain;
- security;
- dependency;
- internal.

## Latihan 3 — ExceptionMapper

Implement mapper untuk:

- `DomainException`;
- `ConstraintViolationException`;
- `OptimisticLockException`;
- `Throwable`.

## Latihan 4 — Persistence Mapping

Map unique constraint:

```text
uk_customer_tenant_email
```

ke:

```text
CUSTOMER_EMAIL_ALREADY_EXISTS
```

## Latihan 5 — Error Contract Tests

Test:

- content type;
- required fields;
- no stackTrace;
- stable code;
- field error path.

## Latihan 6 — 403/404 Policy

Design policy untuk:

```text
GET /customers/{id}
GET /admin/users/{id}
GET /documents/{id}
```

Kapan hidden 404, kapan 403?

## Latihan 7 — Retryability

Buat table retryability untuk:

- 400;
- 409;
- 412;
- 429;
- 503;
- 504.

## Latihan 8 — OpenAPI Error Docs

Tambahkan reusable Problem Details schema dan per-operation error examples.

---

# 54. Referensi Resmi

Referensi utama:

1. RFC 9457 — Problem Details for HTTP APIs  
   https://www.rfc-editor.org/rfc/rfc9457.html

2. RFC 9110 — HTTP Semantics  
   https://www.rfc-editor.org/rfc/rfc9110.html

3. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

4. Jakarta RESTful Web Services 4.0 API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/

5. OpenTelemetry Semantic Conventions — Exceptions  
   https://opentelemetry.io/docs/specs/semconv/exceptions/

6. OpenTelemetry Semantic Conventions — Exceptions in Logs  
   https://opentelemetry.io/docs/specs/semconv/exceptions/exceptions-logs/

7. OpenTelemetry Semantic Conventions — Recording Errors  
   https://opentelemetry.io/docs/specs/semconv/general/recording-errors/

---

# 55. Penutup

Error contract enterprise-grade membuat API lebih mudah dipakai, di-debug, diamankan, dan dievolusi.

Mental model final:

```text
exception
  ↓
classification
  ↓
error descriptor
  ↓
Problem Details
  ↓
stable code
  ↓
client behavior
  ↓
observability/support
```

Prinsip final:

```text
HTTP status is broad class.
Error code is precise contract.
Exception class is internal.
Problem Details is the envelope.
Correlation ID makes support possible.
Retryability prevents unsafe retries.
Field errors make UX actionable.
Governance keeps taxonomy stable.
```

Top-tier JAX-RS engineer memastikan:

- semua error memakai shape konsisten;
- code stabil dan terdokumentasi;
- validation/domain/security/dependency/internal error dibedakan;
- detail aman dari leakage;
- retryability dan action jelas;
- OpenAPI dan tests mencakup error;
- observability mengaggregate error by code;
- error contract dikelola seperti success contract.

Part berikutnya:

```text
Bagian 046 — Multi-Tenancy and Data Authorization in JAX-RS
```

Kita akan membahas tenant context propagation, tenant-aware resource design, data authorization, row-level security, repository safeguards, DTO redaction, cross-tenant leakage prevention, testing, and observability.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 044 — Long-Running Operations and Async API Design: 202 Accepted, Operation Resource, Polling, Webhook, SSE Progress, Cancellation, Retry, Idempotency, Timeout, Result Resources, Failure Recovery, and Production Job Orchestration](./learn-jaxrs-advanced-part-044.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Bagian 046 — Multi-Tenancy and Data Authorization in JAX-RS: Tenant Context Propagation, Tenant-Aware Resource Design, Object-Level Authorization, Row-Level Security, Repository Safeguards, DTO Redaction, Cross-Tenant Leakage Prevention, Testing, and Observability](./learn-jaxrs-advanced-part-046.md)
