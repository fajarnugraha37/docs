# learn-jaxrs-advanced-part-013.md

# Bagian 013 — Error Handling Architecture: Exceptions, `ExceptionMapper`, `WebApplicationException`, RFC 9457 Problem Details, Error Taxonomy, dan Production Error Contract

> Target pembaca: Java/Jakarta engineer yang ingin menguasai arsitektur error handling JAX-RS/Jakarta REST secara production-grade. Fokus part ini bukan “buat `ExceptionMapper` lalu selesai”, tetapi membangun **error boundary** yang stabil, aman, machine-readable, observable, konsisten lintas service, dan tidak membocorkan detail internal.
>
> Namespace utama: `jakarta.ws.rs.WebApplicationException`, `jakarta.ws.rs.ext.ExceptionMapper`, `jakarta.ws.rs.ext.Provider`, `jakarta.ws.rs.core.Response`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Error Handling adalah API Contract](#2-mental-model-error-handling-adalah-api-contract)
3. [Error Lifecycle di JAX-RS Request Pipeline](#3-error-lifecycle-di-jax-rs-request-pipeline)
4. [Kategori Error Berdasarkan Stage](#4-kategori-error-berdasarkan-stage)
5. [JAX-RS Exception Hierarchy](#5-jax-rs-exception-hierarchy)
6. [`WebApplicationException`: Runtime Exception dengan HTTP Response](#6-webapplicationexception-runtime-exception-dengan-http-response)
7. [Client Error Exceptions: 4xx](#7-client-error-exceptions-4xx)
8. [Server Error Exceptions: 5xx](#8-server-error-exceptions-5xx)
9. [`ProcessingException`: Runtime Processing Failure](#9-processingexception-runtime-processing-failure)
10. [`ExceptionMapper<E>`: Core Contract](#10-exceptionmappere-core-contract)
11. [Provider Registration: `@Provider` atau Programmatic](#11-provider-registration-provider-atau-programmatic)
12. [Mapper Specificity: Nearest Superclass Rule](#12-mapper-specificity-nearest-superclass-rule)
13. [Mapper Returning `null` atau Throwing Exception](#13-mapper-returning-null-atau-throwing-exception)
14. [Default Runtime Exceptions: 404, 405, 406, 415](#14-default-runtime-exceptions-404-405-406-415)
15. [Routing Errors vs Domain Not Found](#15-routing-errors-vs-domain-not-found)
16. [Conversion Errors](#16-conversion-errors)
17. [JSON Parse/Deserialize Errors](#17-json-parsedeserialize-errors)
18. [Jakarta Validation Errors](#18-jakarta-validation-errors)
19. [Authentication vs Authorization Errors](#19-authentication-vs-authorization-errors)
20. [Domain Errors: Conflict, Invariant, State Machine](#20-domain-errors-conflict-invariant-state-machine)
21. [Downstream/Infrastructure Errors](#21-downstreaminfrastructure-errors)
22. [Timeout, Rate Limit, Backpressure, Circuit Breaker](#22-timeout-rate-limit-backpressure-circuit-breaker)
23. [Streaming Errors and Response Already Committed](#23-streaming-errors-and-response-already-committed)
24. [RFC 9457 Problem Details](#24-rfc-9457-problem-details)
25. [Problem Details Fields: `type`, `title`, `status`, `detail`, `instance`](#25-problem-details-fields-type-title-status-detail-instance)
26. [Problem Details Extension Members](#26-problem-details-extension-members)
27. [Designing Enterprise Error Taxonomy](#27-designing-enterprise-error-taxonomy)
28. [Stable Error Codes](#28-stable-error-codes)
29. [HTTP Status vs Business Error Code](#29-http-status-vs-business-error-code)
30. [Error Response DTO Design](#30-error-response-dto-design)
31. [Validation Error Shape](#31-validation-error-shape)
32. [Correlation ID / Trace ID in Errors](#32-correlation-id--trace-id-in-errors)
33. [Security: What Not to Expose](#33-security-what-not-to-expose)
34. [Localization: Human Message vs Machine Code](#34-localization-human-message-vs-machine-code)
35. [Exception Design in Application Layer](#35-exception-design-in-application-layer)
36. [Domain Exception vs Application Exception vs Infrastructure Exception](#36-domain-exception-vs-application-exception-vs-infrastructure-exception)
37. [Avoiding Exception Explosion](#37-avoiding-exception-explosion)
38. [Mapping Strategy: One Mapper per Family](#38-mapping-strategy-one-mapper-per-family)
39. [Global Catch-All Mapper](#39-global-catch-all-mapper)
40. [`WebApplicationException` Mapper: Preserve or Normalize?](#40-webapplicationexception-mapper-preserve-or-normalize)
41. [Exception Mapper Ordering and Ambiguity](#41-exception-mapper-ordering-and-ambiguity)
42. [Error Handling in Filters, Interceptors, Providers](#42-error-handling-in-filters-interceptors-providers)
43. [Problem Details Media Type: `application/problem+json`](#43-problem-details-media-type-applicationproblemjson)
44. [Content Negotiation for Errors](#44-content-negotiation-for-errors)
45. [Logging Strategy for Errors](#45-logging-strategy-for-errors)
46. [Metrics and Tracing for Errors](#46-metrics-and-tracing-for-errors)
47. [Testing Error Handling](#47-testing-error-handling)
48. [Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus](#48-runtime-differences-jersey-resteasy-cxf-liberty-quarkus)
49. [Migration: `javax.ws.rs` to `jakarta.ws.rs`](#49-migration-javaxxwrs-to-jakartawsrs)
50. [Common Failure Modes](#50-common-failure-modes)
51. [Best Practices](#51-best-practices)
52. [Anti-Patterns](#52-anti-patterns)
53. [Production Checklist](#53-production-checklist)
54. [Latihan](#54-latihan)
55. [Referensi Resmi](#55-referensi-resmi)
56. [Penutup](#56-penutup)

---

# 1. Tujuan Part Ini

Error handling di API sering dimulai dengan kode seperti ini:

```java
@Provider
public class GlobalExceptionMapper implements ExceptionMapper<Throwable> {
    @Override
    public Response toResponse(Throwable exception) {
        return Response.serverError().build();
    }
}
```

Ini terlihat membantu, tetapi bisa merusak API jika tidak didesain serius.

Masalah umum:

- semua error jadi 500;
- 404 routing dan domain not found tercampur;
- validation error tidak jelas field-nya;
- stack trace bocor ke client;
- error code berubah-ubah;
- response body error berbeda antar endpoint;
- `WebApplicationException` bawaan runtime tertimpa mapper global;
- `ExceptionMapper<Throwable>` menyembunyikan bug;
- streaming error terjadi setelah response committed;
- observability tidak bisa membedakan client bug vs server bug.

## 1.1 Target akhir

Setelah part ini, kamu bisa membangun error handling yang:

- konsisten;
- machine-readable;
- berbasis RFC 9457 Problem Details;
- punya stable error code;
- aman dari information leakage;
- bisa membedakan 400/401/403/404/409/412/415/422/429/500/503;
- punya mapper specificity yang benar;
- bisa diamati dengan metrics/logs/traces;
- bisa dites dengan contract tests;
- tetap menjaga domain/application layer bersih.

## 1.2 Prinsip utama

```text
Error response is part of your API contract.
It deserves the same design discipline as success response.
```

---

# 2. Mental Model: Error Handling adalah API Contract

Error response bukan sekadar “pesan gagal”.

Error response adalah kontrak antara server dan client tentang:

- apa yang salah;
- apakah client bisa memperbaiki request;
- apakah request boleh di-retry;
- field mana yang invalid;
- apakah resource tidak ada atau akses dilarang;
- apakah concurrency conflict;
- apakah server sedang overload;
- bagaimana support team melacak masalah.

## 2.1 Bad error

```json
{
  "message": "Something went wrong"
}
```

atau lebih buruk:

```json
{
  "exception": "java.lang.NullPointerException",
  "stackTrace": "..."
}
```

## 2.2 Good error

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

## 2.3 Client usage

Client can:

- inspect HTTP status;
- inspect `code`;
- display localized message;
- highlight invalid fields;
- decide retry/no retry;
- report correlation ID.

## 2.4 Support usage

Support can search logs by correlation ID.

## 2.5 Rule

```text
HTTP status is not enough.
Human message is not enough.
Stable machine code is essential.
```

---

# 3. Error Lifecycle di JAX-RS Request Pipeline

Error bisa muncul di banyak stage.

```text
HTTP request
  ↓
pre-matching filters
  ↓
resource matching
  ↓
param conversion
  ↓
entity body reading
  ↓
validation
  ↓
resource method
  ↓
application/domain service
  ↓
response writing
  ↓
post-processing filters/interceptors
```

## 3.1 Pre-matching filter error

Example:

- invalid correlation ID;
- blocked IP;
- auth parsing failure.

## 3.2 Matching error

- no resource path → 404;
- method not allowed → 405;
- cannot consume → 415;
- cannot produce → 406.

## 3.3 Parameter conversion error

```text
?page=abc
```

when target is `int`.

## 3.4 Body reading error

Malformed JSON.

## 3.5 Validation error

DTO parsed but violates constraints.

## 3.6 Domain error

Business rule rejects operation.

## 3.7 Writer error

Serialization fails while writing response.

## 3.8 Streaming error

Failure after response committed; cannot reliably change status/body.

## 3.9 Rule

Always ask:

```text
At which stage did this error occur?
```

---

# 4. Kategori Error Berdasarkan Stage

## 4.1 Protocol/request syntax

- malformed JSON;
- invalid query param;
- unsupported content type;
- unacceptable response media;
- invalid header.

Typical status:

```text
400, 406, 415
```

## 4.2 Authentication/authorization

- no credentials;
- invalid credentials;
- insufficient permissions.

Typical status:

```text
401, 403
```

## 4.3 Resource existence

- route not found;
- domain entity not found.

Typical status:

```text
404
```

## 4.4 Concurrency/preconditions

- stale ETag;
- missing required `If-Match`.

Typical status:

```text
412, 428
```

## 4.5 Business conflict

- invalid state transition;
- duplicate active resource;
- cannot cancel shipped order.

Typical status:

```text
409
```

## 4.6 Validation

- required field missing;
- size out of range;
- invalid email.

Typical status:

```text
400 or 422 depending policy
```

## 4.7 Rate/load

- too many requests;
- system overloaded.

Typical status:

```text
429, 503
```

## 4.8 Server/infrastructure

- database down;
- unexpected bug;
- downstream timeout.

Typical status:

```text
500, 502, 503, 504
```

---

# 5. JAX-RS Exception Hierarchy

Key exception families:

```text
Throwable
  RuntimeException
    ProcessingException
    WebApplicationException
      RedirectionException
      ClientErrorException
        BadRequestException
        NotAuthorizedException
        ForbiddenException
        NotFoundException
        NotAllowedException
        NotAcceptableException
        NotSupportedException
      ServerErrorException
        InternalServerErrorException
        ServiceUnavailableException
```

## 5.1 `WebApplicationException`

Carries HTTP response/status.

## 5.2 `ClientErrorException`

Base for 4xx.

## 5.3 `ServerErrorException`

Base for 5xx.

## 5.4 `ProcessingException`

Processing failure not necessarily already mapped to HTTP status.

## 5.5 Runtime-generated exceptions

JAX-RS runtime throws many of these during matching/entity processing.

## 5.6 Application-thrown exceptions

Your resource/service can throw domain/application exceptions.

## 5.7 Rule

Do not map everything as `Throwable` first. Understand hierarchy.

---

# 6. `WebApplicationException`: Runtime Exception dengan HTTP Response

`WebApplicationException` is a runtime exception that can be thrown by resource method, provider, or `StreamingOutput` to produce a specific HTTP error response.

## 6.1 Example

```java
throw new NotFoundException("Customer not found");
```

or:

```java
throw new WebApplicationException(
    Response.status(Response.Status.CONFLICT)
        .entity(problem)
        .type("application/problem+json")
        .build()
);
```

## 6.2 Effective only before response committed

If thrown after bytes are committed, runtime cannot reliably change HTTP status or body.

This matters for streaming.

## 6.3 Pros

- easy to throw HTTP error;
- built-in subclasses;
- can carry response.

## 6.4 Cons

- HTTP concerns leak into deeper layers if thrown from domain/service;
- can bypass consistent error mapper if response already built;
- can create inconsistent body.

## 6.5 Recommendation

Use `WebApplicationException` mostly at REST boundary/infrastructure layer.

Application/domain should throw app/domain exceptions mapped at boundary.

## 6.6 Rule

```text
WebApplicationException is a boundary exception, not domain language.
```

---

# 7. Client Error Exceptions: 4xx

Common JAX-RS 4xx exceptions:

## 7.1 `BadRequestException`

Bad client request.

Use for malformed syntax, invalid request data, parse failure.

## 7.2 `NotAuthorizedException`

Authentication failure / missing credentials.

Often 401 and should include `WWW-Authenticate` where appropriate.

## 7.3 `ForbiddenException`

Authenticated but not allowed.

## 7.4 `NotFoundException`

Resource not found.

Could be routing not found or domain resource not found.

## 7.5 `NotAllowedException`

HTTP method not allowed.

Typically 405 and should include `Allow`.

## 7.6 `NotAcceptableException`

Client requested unacceptable response representation.

406.

## 7.7 `NotSupportedException`

Request entity media type unsupported.

415.

## 7.8 Rule

Use the most specific exception/status possible.

---

# 8. Server Error Exceptions: 5xx

Common JAX-RS 5xx exceptions:

## 8.1 `InternalServerErrorException`

Unexpected internal server error.

## 8.2 `ServiceUnavailableException`

Service temporarily unavailable.

Can include `Retry-After`.

## 8.3 `ServerErrorException`

Generic base for 5xx.

## 8.4 When to use

Usually not thrown from domain.

Use in infrastructure boundary if converting downstream failure to HTTP.

## 8.5 Avoid overusing 500

Many errors are client/domain errors:

- invalid state → 409;
- stale version → 412;
- invalid input → 400;
- unsupported media → 415.

## 8.6 Rule

500 means server failed unexpectedly. Do not use it for expected business rejection.

---

# 9. `ProcessingException`: Runtime Processing Failure

`ProcessingException` signals runtime processing failure during request or response processing.

## 9.1 Examples

- I/O error during provider processing;
- message body reader/writer failure;
- filter/interceptor processing failure;
- client API processing failure.

## 9.2 Mapping

You may map `ProcessingException` to 500 or more specific status depending cause.

## 9.3 Be careful

A malformed request body may surface as provider-specific exception wrapped inside processing exception.

Runtime-specific.

## 9.4 Recommendation

Inspect cause safely, map known parse/conversion cases to 400, unknown processing cases to 500.

## 9.5 Do not expose cause message blindly

Provider exceptions can include internal class names or raw data.

## 9.6 Rule

`ProcessingException` is a boundary symptom; classify cause carefully.

---

# 10. `ExceptionMapper<E>`: Core Contract

`ExceptionMapper<E extends Throwable>` maps exception to `Response`.

```java
public interface ExceptionMapper<E extends Throwable> {
    Response toResponse(E exception);
}
```

## 10.1 Example

```java
@Provider
public class CustomerNotFoundMapper implements ExceptionMapper<CustomerNotFoundException> {

    @Override
    public Response toResponse(CustomerNotFoundException ex) {
        Problem problem = Problem.notFound(
            "CUSTOMER_NOT_FOUND",
            "Customer was not found"
        );

        return Response.status(Response.Status.NOT_FOUND)
            .type("application/problem+json")
            .entity(problem)
            .build();
    }
}
```

## 10.2 Mapper responsibility

- choose HTTP status;
- create error entity;
- set media type;
- set headers if needed;
- avoid leaking internals;
- log if appropriate or rely on global logging.

## 10.3 What mapper should not do

- call database;
- perform business logic;
- mutate domain state;
- throw new unrelated exception;
- return inconsistent body.

## 10.4 Rule

Mapper is translation layer:

```text
Exception → HTTP error response
```

---

# 11. Provider Registration: `@Provider` atau Programmatic

Exception mappers are providers.

## 11.1 Annotation discovery

```java
@Provider
public class DomainExceptionMapper implements ExceptionMapper<DomainException> { ... }
```

## 11.2 Programmatic registration

```java
@ApplicationPath("/api")
public class ApiApplication extends Application {

    @Override
    public Set<Class<?>> getClasses() {
        return Set.of(
            CustomerResource.class,
            DomainExceptionMapper.class
        );
    }
}
```

## 11.3 Missing mapper symptom

- default runtime error body;
- HTML error page;
- stack trace;
- inconsistent JSON.

## 11.4 Recommendation

Register mappers explicitly in large systems or verify scanning.

## 11.5 Test

Contract test every important error type.

## 11.6 Rule

If an exception can cross REST boundary, it needs known mapping.

---

# 12. Mapper Specificity: Nearest Superclass Rule

When resolving mapper for exception type, runtime returns mapper whose generic type is nearest superclass of exception type.

## 12.1 Example

Exception:

```java
CustomerNotFoundException extends DomainNotFoundException
```

Mappers:

```java
ExceptionMapper<DomainNotFoundException>
ExceptionMapper<RuntimeException>
ExceptionMapper<Throwable>
```

Runtime should choose:

```text
ExceptionMapper<DomainNotFoundException>
```

because it is nearest.

## 12.2 More specific mapper

If also exists:

```java
ExceptionMapper<CustomerNotFoundException>
```

then it wins.

## 12.3 Why it matters

You can build mapper hierarchy:

```text
ValidationExceptionMapper
DomainExceptionMapper
WebApplicationExceptionMapper
ThrowableMapper
```

## 12.4 Ambiguity

Avoid multiple mappers for same exception type.

## 12.5 Rule

Design exception hierarchy and mapper hierarchy together.

---

# 13. Mapper Returning `null` atau Throwing Exception

`ExceptionMapper#toResponse` has special behavior.

## 13.1 Returning null

Returning null results in `204 No Content`.

This is almost never what you want for errors.

## 13.2 Throwing runtime exception

If mapper throws runtime exception, response is `500 Internal Server Error`.

## 13.3 Mapper must be robust

Mapper should not fail due to:

- null fields;
- serialization issue;
- missing context;
- localization failure.

## 13.4 Defensive mapper

If error formatting fails, fall back to minimal problem response.

## 13.5 Test mapper failure paths

Especially global mapper.

## 13.6 Rule

An exception mapper is your last line of defense. It must be boring and reliable.

---

# 14. Default Runtime Exceptions: 404, 405, 406, 415

JAX-RS runtime generates exceptions for common HTTP failures.

## 14.1 404

No matching resource path:

```java
NotFoundException
```

## 14.2 405

Path matched but method unsupported:

```java
NotAllowedException
```

## 14.3 406

No acceptable response media:

```java
NotAcceptableException
```

## 14.4 415

Unsupported request entity media:

```java
NotSupportedException
```

## 14.5 Why map them?

To return consistent `application/problem+json`.

## 14.6 Preserve headers

For 405, preserve `Allow`.

For 401, preserve `WWW-Authenticate`.

For 503, preserve `Retry-After`.

## 14.7 Rule

When normalizing JAX-RS exceptions, preserve important HTTP headers.

---

# 15. Routing Errors vs Domain Not Found

Both can be 404 but meaning differs.

## 15.1 Routing not found

```http
GET /no-such-path
```

No resource matched.

Error code:

```text
ROUTE_NOT_FOUND
```

## 15.2 Domain not found

```http
GET /customers/C999
```

Route exists, customer does not.

Error code:

```text
CUSTOMER_NOT_FOUND
```

## 15.3 Should client know difference?

Often yes for API clients.

But for security, sometimes hide forbidden resource as 404.

## 15.4 Mapping

Runtime `NotFoundException` may represent route not found or resource-thrown not found.

If your domain throws custom `CustomerNotFoundException`, you can distinguish.

## 15.5 Recommendation

Use domain-specific not-found exceptions in service/application layer.

Map JAX-RS `NotFoundException` as route not found unless intentionally thrown at boundary.

## 15.6 Rule

Same HTTP status can have different stable machine codes.

---

# 16. Conversion Errors

Conversion errors occur before resource method body.

Examples:

```text
/customers/not-a-uuid
?page=abc
?status=bad
```

## 16.1 Status

Usually 400.

## 16.2 Error code

```text
INVALID_PATH_PARAMETER
INVALID_QUERY_PARAMETER
INVALID_HEADER
```

## 16.3 Implementation-specific exception classes

Jersey/RESTEasy/CXF may wrap parameter conversion failures differently.

## 16.4 Portable strategy

- map common `BadRequestException`;
- inspect cause carefully if needed;
- use tests on target runtime;
- consider explicit parsing in `@BeanParam` when precise error required.

## 16.5 Error body

```json
{
  "code": "INVALID_QUERY_PARAMETER",
  "parameter": "page",
  "location": "query",
  "detail": "Parameter 'page' must be a positive integer."
}
```

## 16.6 Rule

Conversion error is client syntax error, not server error.

---

# 17. JSON Parse/Deserialize Errors

JSON body errors occur in `MessageBodyReader`.

## 17.1 Malformed JSON

```json
{"name":
```

Status:

```text
400
```

Error code:

```text
MALFORMED_JSON
```

## 17.2 Wrong type

```json
{"items": "not-array"}
```

Error code:

```text
JSON_DESERIALIZATION_FAILED
```

## 17.3 Unknown field

If policy rejects:

```text
UNKNOWN_JSON_FIELD
```

## 17.4 Provider-specific exceptions

Jackson/JSON-B exceptions differ.

Map at provider/runtime boundary.

## 17.5 Do not leak parser exception

Bad:

```text
com.fasterxml.jackson.databind.exc.MismatchedInputException...
```

## 17.6 Rule

JSON parse errors are 400 with safe, stable problem details.

---

# 18. Jakarta Validation Errors

Validation errors occur after successful conversion/deserialization.

## 18.1 Example

```java
public record CreateCustomerRequest(
    @NotBlank String name,
    @Email String email
) {}
```

## 18.2 Request

```json
{
  "name": "",
  "email": "not-email"
}
```

## 18.3 Status choice

Common choices:

- 400 Bad Request;
- 422 Unprocessable Content.

Choose one standard across organization.

## 18.4 Error shape

```json
{
  "code": "VALIDATION_FAILED",
  "violations": [
    {
      "field": "name",
      "code": "NOT_BLANK",
      "message": "must not be blank"
    },
    {
      "field": "email",
      "code": "EMAIL_INVALID",
      "message": "must be a well-formed email address"
    }
  ]
}
```

## 18.5 Field path

Nested examples:

```text
items[0].quantity
address.postalCode
```

## 18.6 Rule

Validation errors should be field-addressable.

---

# 19. Authentication vs Authorization Errors

## 19.1 401 Unauthorized

Means authentication is required or failed.

Examples:

- no token;
- expired token;
- invalid token.

Should include `WWW-Authenticate` for applicable auth schemes.

## 19.2 403 Forbidden

Authenticated but lacks permission.

Examples:

- user lacks role;
- user cannot access resource.

## 19.3 Hidden 404

Some APIs return 404 instead of 403 to avoid revealing resource existence.

Use deliberately.

## 19.4 Error codes

```text
AUTHENTICATION_REQUIRED
TOKEN_EXPIRED
FORBIDDEN
INSUFFICIENT_SCOPE
RESOURCE_ACCESS_DENIED
```

## 19.5 Do not reveal too much

For auth failures, avoid telling attackers exactly which part is valid.

## 19.6 Rule

401 is about identity not established; 403 is about identity established but not allowed.

---

# 20. Domain Errors: Conflict, Invariant, State Machine

Domain errors are expected business rejections.

## 20.1 Examples

- order already shipped, cannot cancel;
- duplicate active application;
- licence expired;
- workflow transition invalid;
- payment already captured.

## 20.2 Typical status

```text
409 Conflict
```

## 20.3 Sometimes 422

If semantic validation of request content fails.

## 20.4 Sometimes 400

If request violates boundary rule.

## 20.5 Example

```java
public class InvalidOrderStateException extends DomainException {
    public InvalidOrderStateException(OrderId id, OrderStatus status) {
        super("ORDER_INVALID_STATE", "Order cannot be cancelled from status " + status);
    }
}
```

## 20.6 Mapping

```json
{
  "code": "ORDER_INVALID_STATE",
  "status": 409,
  "detail": "Order cannot be cancelled from its current state."
}
```

## 20.7 Rule

Expected business errors are not 500.

---

# 21. Downstream/Infrastructure Errors

Infrastructure errors include:

- database unavailable;
- cache unavailable;
- message broker unavailable;
- downstream HTTP timeout;
- DNS failure;
- object storage failure.

## 21.1 Status mapping

Depends on role:

- dependency unavailable → 503;
- upstream gateway failure → 502;
- upstream timeout → 504;
- unexpected server bug → 500.

## 21.2 Retry headers

For 503 or 429, include:

```http
Retry-After
```

when appropriate.

## 21.3 Error code

```text
DEPENDENCY_UNAVAILABLE
DOWNSTREAM_TIMEOUT
DATABASE_UNAVAILABLE
MESSAGE_BROKER_UNAVAILABLE
```

## 21.4 Do not leak internal hostnames

Bad:

```text
Could not connect to jdbc:oracle:thin:@prod-rds...
```

## 21.5 Observability

Log full internal cause with correlation ID.

Client gets safe problem.

## 21.6 Rule

Client-facing error safe; logs/traces detailed.

---

# 22. Timeout, Rate Limit, Backpressure, Circuit Breaker

## 22.1 Rate limit

Status:

```text
429 Too Many Requests
```

Headers:

```http
Retry-After
RateLimit-*
```

if adopted.

## 22.2 Service overloaded

Status:

```text
503 Service Unavailable
```

## 22.3 Downstream timeout

Status:

```text
504 Gateway Timeout
```

if acting as gateway/proxy to downstream.

Sometimes 503 if dependency unavailable.

## 22.4 Circuit breaker open

```text
503
```

or domain-specific dependency unavailable.

## 22.5 Backpressure

Reject early with 429/503 instead of letting all requests time out.

## 22.6 Rule

Timeout and overload errors should tell clients whether retry is reasonable.

---

# 23. Streaming Errors and Response Already Committed

Streaming response has special problem.

## 23.1 Before commit

If error thrown before bytes written, JAX-RS can produce error response.

## 23.2 After commit

If bytes already written, status and headers may be committed.

Cannot reliably change to JSON Problem Details.

## 23.3 Example

```java
return Response.ok((StreamingOutput) output -> {
    output.write(header);
    // later DB read fails
    throw new WebApplicationException(500);
}).build();
```

Client may receive partial body.

## 23.4 Strategy

Validate everything possible before writing first byte.

## 23.5 For large exports

Use async job:

```text
POST /export-jobs
GET /export-jobs/{id}
GET /export-jobs/{id}/file
```

Generate file before download.

## 23.6 Rule

Do not assume exception mapper can fix errors after response commit.

---

# 24. RFC 9457 Problem Details

RFC 9457 defines a standard way to express machine-readable error details for HTTP APIs.

Media types:

```text
application/problem+json
application/problem+xml
```

## 24.1 Why use it?

Without standard error shape, every API invents its own.

Problem Details provides common fields and extension mechanism.

## 24.2 Core idea

A problem detail is a JSON/XML object describing problem occurrence.

## 24.3 Good fit for enterprise APIs

You can combine:

- RFC fields;
- stable application code;
- violations list;
- correlation ID;
- docs link.

## 24.4 RFC 7807 obsolete

RFC 9457 obsoletes RFC 7807.

## 24.5 Rule

Use RFC 9457 as baseline; add enterprise extensions carefully.

---

# 25. Problem Details Fields: `type`, `title`, `status`, `detail`, `instance`

## 25.1 `type`

URI identifying problem type.

Example:

```json
"type": "https://api.example.com/problems/validation-failed"
```

Can be dereferenceable documentation.

## 25.2 `title`

Short human-readable summary.

```json
"title": "Validation failed"
```

## 25.3 `status`

HTTP status code.

```json
"status": 400
```

Should match actual response status.

## 25.4 `detail`

Human-readable detail specific to occurrence.

```json
"detail": "One or more request fields are invalid."
```

## 25.5 `instance`

URI reference identifying this occurrence.

```json
"instance": "/problems/occurrences/01JZ..."
```

or request path, depending policy.

## 25.6 Extension fields

Add custom fields like `code`, `correlationId`, `violations`.

## 25.7 Rule

Keep RFC fields semantically correct; put app-specific data in extensions.

---

# 26. Problem Details Extension Members

Useful extensions:

```json
{
  "code": "VALIDATION_FAILED",
  "correlationId": "01JZ...",
  "violations": [],
  "retryable": false,
  "docs": "https://api.example.com/docs/errors/VALIDATION_FAILED"
}
```

## 26.1 `code`

Stable machine-readable application code.

## 26.2 `correlationId`

Log/trace lookup ID.

## 26.3 `violations`

Field-level errors.

## 26.4 `retryable`

Optional boolean. Be careful; retryability may depend on client behavior.

## 26.5 `timestamp`

Often not necessary if response/logs have date, but can be useful.

## 26.6 `details`

Avoid ambiguous generic `details` if `detail` already used.

## 26.7 Rule

Extensions should be stable, documented, and low-risk.

---

# 27. Designing Enterprise Error Taxonomy

A taxonomy groups errors by category.

## 27.1 Example categories

```text
REQUEST
AUTHENTICATION
AUTHORIZATION
VALIDATION
DOMAIN
CONFLICT
CONCURRENCY
RATE_LIMIT
DEPENDENCY
INTERNAL
```

## 27.2 Error code naming

Use stable uppercase snake case:

```text
INVALID_QUERY_PARAMETER
VALIDATION_FAILED
CUSTOMER_NOT_FOUND
ORDER_INVALID_STATE
DEPENDENCY_UNAVAILABLE
INTERNAL_ERROR
```

## 27.3 Namespace per domain

For large systems:

```text
CUSTOMER_NOT_FOUND
ORDER_ALREADY_SHIPPED
LICENCE_EXPIRED
CASE_ACCESS_DENIED
```

## 27.4 Do not expose Java class names

Bad:

```text
NullPointerException
CustomerServiceException
```

## 27.5 Versioning

Changing error code can be breaking.

## 27.6 Rule

Error taxonomy is shared API vocabulary.

---

# 28. Stable Error Codes

## 28.1 What makes good code?

- stable;
- machine-readable;
- language-neutral;
- not tied to Java class;
- specific enough to act on;
- not too granular.

## 28.2 Too generic

```text
ERROR
BAD_REQUEST
FAILED
```

## 28.3 Too specific

```text
CUSTOMER_EMAIL_FIELD_FAILED_REGEX_PATTERN_42
```

## 28.4 Good examples

```text
INVALID_EMAIL
MISSING_REQUIRED_FIELD
CUSTOMER_NOT_FOUND
ORDER_INVALID_STATE
IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY
```

## 28.5 Code is not message

Code stable.

Message localizable/changeable.

## 28.6 Rule

Clients should branch on `code`, not `detail`.

---

# 29. HTTP Status vs Business Error Code

HTTP status is broad class.

Business code is precise.

## 29.1 Example

```http
409 Conflict
```

Could mean:

```text
ORDER_INVALID_STATE
DUPLICATE_ACTIVE_APPLICATION
IDEMPOTENCY_KEY_CONFLICT
RESOURCE_VERSION_CONFLICT
```

## 29.2 Example response

```json
{
  "status": 409,
  "code": "ORDER_INVALID_STATE",
  "title": "Invalid order state"
}
```

## 29.3 Why not status only?

Client needs know how to handle.

## 29.4 Why not code only?

HTTP intermediaries/tools/clients use status.

## 29.5 Rule

Use both.

---

# 30. Error Response DTO Design

## 30.1 Problem DTO

```java
public record ProblemResponse(
    URI type,
    String title,
    int status,
    String detail,
    URI instance,
    String code,
    String correlationId,
    List<ViolationResponse> violations
) {}
```

## 30.2 Violation DTO

```java
public record ViolationResponse(
    String field,
    String code,
    String message
) {}
```

## 30.3 Null policy

Do not include empty `violations` for non-validation errors, or include empty array consistently.

Choose policy.

## 30.4 Type URI

Can be stable docs URL:

```text
https://api.example.com/problems/customer-not-found
```

## 30.5 Instance

Could be null, request path, or occurrence URI.

## 30.6 Rule

Error DTO is public contract; test it with golden JSON.

---

# 31. Validation Error Shape

## 31.1 Example

```json
{
  "type": "https://api.example.com/problems/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "code": "VALIDATION_FAILED",
  "detail": "One or more fields are invalid.",
  "violations": [
    {
      "field": "items[0].quantity",
      "code": "MIN",
      "message": "must be greater than or equal to 1"
    }
  ],
  "correlationId": "01JZ..."
}
```

## 31.2 Field path

Use consistent path format.

Options:

- dot notation;
- JSON pointer;
- bracket index.

## 31.3 Violation code

Do not expose provider annotation names if you want stable contract.

Map:

```text
@NotBlank → REQUIRED
@Email → INVALID_EMAIL
@Size → SIZE_OUT_OF_RANGE
```

## 31.4 Message

Can be localized.

## 31.5 Multiple errors

Return all useful field errors, not just first, if possible.

## 31.6 Rule

Validation error must be actionable by UI/client.

---

# 32. Correlation ID / Trace ID in Errors

## 32.1 Purpose

Client reports:

```text
correlationId = 01JZ...
```

Support finds logs/traces.

## 32.2 Source

- request header;
- generated by gateway;
- generated by app filter.

## 32.3 Response header

```http
X-Correlation-ID: 01JZ...
```

## 32.4 Problem field

```json
"correlationId": "01JZ..."
```

## 32.5 Validate ID

Limit length and allowed characters.

## 32.6 Do not use as auth

Correlation ID is not identity.

## 32.7 Rule

Every error response should include correlation ID.

---

# 33. Security: What Not to Expose

Never expose:

- stack traces;
- class names;
- SQL queries;
- table names;
- hostnames;
- IPs of internal services;
- file paths;
- secrets/tokens;
- full request body;
- internal config;
- exact auth failure internals if risky.

## 33.1 Bad

```json
{
  "detail": "ORA-00942 table ACEAS_CUSTOMER_SECRET does not exist"
}
```

## 33.2 Good

```json
{
  "code": "DEPENDENCY_FAILURE",
  "detail": "A required dependency failed."
}
```

Log internal detail server-side.

## 33.3 Auth error

Avoid telling attacker:

```text
token signature valid but user disabled
```

unless policy allows.

## 33.4 Validation error

Safe to return field-level errors for client input, but avoid echoing sensitive values.

## 33.5 Rule

Client gets enough to act; server logs get enough to debug.

---

# 34. Localization: Human Message vs Machine Code

## 34.1 Machine code stable

```json
"code": "VALIDATION_FAILED"
```

## 34.2 Human message localizable

```json
"title": "Validasi gagal"
```

## 34.3 Accept-Language

Use:

```http
Accept-Language: id-ID
```

## 34.4 Vary

If response body language varies:

```http
Vary: Accept-Language
```

## 34.5 Client behavior

Client should not branch on localized message.

## 34.6 Rule

Localize title/detail/message, never code.

---

# 35. Exception Design in Application Layer

## 35.1 Base exception

```java
public abstract class ApplicationException extends RuntimeException {
    private final String code;

    protected ApplicationException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
```

## 35.2 Domain exception

```java
public abstract class DomainException extends ApplicationException {
    protected DomainException(String code, String message) {
        super(code, message);
    }
}
```

## 35.3 Specific

```java
public final class CustomerNotFoundException extends ApplicationException {
    public CustomerNotFoundException(CustomerId id) {
        super("CUSTOMER_NOT_FOUND", "Customer was not found");
    }
}
```

## 35.4 Do not include sensitive values in message

IDs may be okay depending policy; secrets never.

## 35.5 Keep payload structured

Could include safe metadata:

```java
Map<String, Object> attributes
```

but avoid raw entity/body.

## 35.6 Rule

Application exceptions carry stable code and safe context.

---

# 36. Domain Exception vs Application Exception vs Infrastructure Exception

## 36.1 Domain exception

Business invariant/state.

Examples:

```text
ORDER_INVALID_STATE
LICENCE_EXPIRED
CASE_ALREADY_CLOSED
```

## 36.2 Application exception

Use-case orchestration issue.

Examples:

```text
CUSTOMER_NOT_FOUND
IDEMPOTENCY_CONFLICT
PRECONDITION_REQUIRED
```

## 36.3 Infrastructure exception

Technical dependency.

Examples:

```text
DATABASE_UNAVAILABLE
S3_UPLOAD_FAILED
DOWNSTREAM_TIMEOUT
```

## 36.4 Mapping

Domain/application expected exceptions map to 4xx/409/412.

Infrastructure unexpected maps to 5xx/503/504.

## 36.5 Rule

Exception type should express layer and category.

---

# 37. Avoiding Exception Explosion

Too many exception classes can become noise.

## 37.1 Bad

```text
CustomerNameEmptyException
CustomerNameTooLongException
CustomerNameContainsInvalidCharacterException
```

Maybe validation errors are enough.

## 37.2 Use structured error

```java
throw new ValidationFailedException(violations);
```

## 37.3 Specific exception when behavior differs

Create dedicated exception if:

- status differs;
- retryability differs;
- client action differs;
- metric/alert differs;
- domain meaning important.

## 37.4 Good balance

- `DomainConflictException` with code;
- specific subclass for common important cases;
- validation aggregate for field errors.

## 37.5 Rule

Exception classes should serve mapping/meaning, not mirror every `if`.

---

# 38. Mapping Strategy: One Mapper per Family

Recommended mappers:

```text
ValidationExceptionMapper
ParameterExceptionMapper
JsonParseExceptionMapper
DomainExceptionMapper
ApplicationExceptionMapper
WebApplicationExceptionMapper
ProcessingExceptionMapper
ThrowableMapper
```

## 38.1 Domain mapper

Maps domain/application codes to status.

## 38.2 Validation mapper

Builds violations array.

## 38.3 WebApplication mapper

Normalizes JAX-RS built-in exceptions to Problem Details while preserving status/headers.

## 38.4 Throwable mapper

Final fallback.

## 38.5 Avoid one giant mapper

Giant mapper becomes unmaintainable.

## 38.6 Rule

Group by exception family and mapping policy.

---

# 39. Global Catch-All Mapper

`ExceptionMapper<Throwable>` catches everything not mapped more specifically.

## 39.1 Purpose

Return safe 500 Problem Details.

## 39.2 Example

```java
@Provider
public class ThrowableMapper implements ExceptionMapper<Throwable> {

    @Override
    public Response toResponse(Throwable ex) {
        ProblemResponse problem = ProblemResponse.internalError(correlationId());

        return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
            .type("application/problem+json")
            .entity(problem)
            .build();
    }
}
```

## 39.3 Logging

Catch-all mapper should log error at error level with stack trace and correlation ID.

## 39.4 Danger

It can hide bugs if metrics/alerts not configured.

## 39.5 Do not map `Throwable` before specific mappers

Specificity should choose specific mapper, but still ensure registrations are correct.

## 39.6 Rule

Catch-all is safety net, not primary error logic.

---

# 40. `WebApplicationException` Mapper: Preserve or Normalize?

When runtime throws `NotFoundException`, `NotAllowedException`, etc., you may want consistent Problem Details.

## 40.1 Normalize

Map all `WebApplicationException` to Problem Details.

## 40.2 Preserve status

Use exception response status.

## 40.3 Preserve headers

Important:

- `Allow` for 405;
- `WWW-Authenticate` for 401;
- `Retry-After` for 503;
- custom headers.

## 40.4 Preserve entity?

If exception already has entity, decide:

- keep if already Problem Details;
- replace if inconsistent;
- avoid double-wrapping.

## 40.5 Example policy

```text
If response entity is ProblemResponse, preserve.
Otherwise replace body with standardized ProblemResponse and preserve headers.
```

## 40.6 Rule

Normalize body, preserve HTTP semantics.

---

# 41. Exception Mapper Ordering and Ambiguity

## 41.1 Specificity

Nearest superclass mapper wins.

## 41.2 Duplicate mapper

Two mappers for same type are ambiguous/non-portable.

## 41.3 Priority?

Provider priority may apply in some provider selection contexts, but do not rely on priority to choose between same exception type mappers.

## 41.4 Avoid

```java
ExceptionMapper<RuntimeException>
ExceptionMapper<Exception>
ExceptionMapper<Throwable>
```

without clear roles.

## 41.5 Test

Trigger exceptions and assert mapper result.

## 41.6 Rule

One exception type, one mapper owner.

---

# 42. Error Handling in Filters, Interceptors, Providers

## 42.1 Throwing exception

Filters/providers can throw `WebApplicationException` or custom exceptions.

Mappers may handle them if thrown before response committed.

## 42.2 Aborting request

Request filter can use:

```java
requestContext.abortWith(response);
```

Use for auth/CORS/precondition-like early responses.

## 42.3 Mapper in provider

If message body writer fails while writing, mapper behavior depends on commit state.

## 42.4 Reader parse error

Reader can throw `BadRequestException`.

## 42.5 Interceptor

Reader/writer interceptor can throw.

## 42.6 Rule

Error handling works best before response commit. Be extra cautious in writer/streaming stages.

---

# 43. Problem Details Media Type: `application/problem+json`

## 43.1 Set response type

```java
.type("application/problem+json")
```

## 43.2 Also class-level produces?

ExceptionMapper creates response manually, so set type explicitly.

## 43.3 Error negotiation

Even if client sent `Accept: application/json`, many APIs return `application/problem+json`.

Document policy.

## 43.4 XML

If supporting XML errors:

```text
application/problem+xml
```

But most JSON APIs only use problem+json.

## 43.5 Rule

Error response media type must be consistent.

---

# 44. Content Negotiation for Errors

## 44.1 Strict negotiation

If client only accepts XML and you only produce problem+json, should you return 406?

Many APIs still return problem+json to make errors readable.

## 44.2 Practical policy

For JSON APIs:

```text
All errors are application/problem+json.
Clients should accept it.
```

## 44.3 Document

OpenAPI must list:

```text
application/problem+json
```

for error responses.

## 44.4 Avoid HTML errors

Disable/default-map container HTML error pages for API paths.

## 44.5 Vary

If error text localized:

```http
Vary: Accept-Language
```

## 44.6 Rule

Error media negotiation policy should be explicit.

---

# 45. Logging Strategy for Errors

## 45.1 Client errors

4xx often log at INFO/WARN depending category.

Do not alert on normal validation errors.

## 45.2 Server errors

5xx log at ERROR with stack trace.

## 45.3 Include

- correlation ID;
- route template;
- method;
- status;
- error code;
- principal/tenant safe identifiers if policy allows;
- exception class internal logs only.

## 45.4 Exclude

- request body;
- tokens;
- cookies;
- passwords;
- secrets;
- raw PII unless allowed.

## 45.5 Sampling

High-volume 400s may need sampling.

## 45.6 Rule

Logs are for operators; response is for clients. Do not confuse audiences.

---

# 46. Metrics and Tracing for Errors

## 46.1 Metrics

```text
http_server_requests_total{method,route,status}
api_errors_total{code,status,route}
validation_errors_total{field,route}? careful cardinality
```

## 46.2 Avoid high cardinality

Do not label with:

- customer ID;
- request path raw;
- exception message;
- correlation ID;
- raw field value.

## 46.3 Trace

Set span status for 5xx and maybe selected 4xx.

Add event:

```text
exception.mapped
```

with safe attributes:

- error code;
- status;
- exception family.

## 46.4 Alerts

Alert on:

- high 5xx rate;
- dependency errors;
- spike in 415/406 after deploy;
- spike in validation after client release.

## 46.5 Rule

Error taxonomy should power observability.

---

# 47. Testing Error Handling

## 47.1 Contract tests

For each error category, assert:

- status;
- content type;
- problem fields;
- code;
- correlation ID;
- headers.

## 47.2 Routing errors

- unknown route → 404 Problem.
- wrong method → 405 + Allow.
- wrong Accept → 406.
- wrong Content-Type → 415.

## 47.3 Parameter errors

- invalid query;
- invalid path;
- duplicate header.

## 47.4 JSON errors

- malformed JSON;
- wrong field type;
- unknown field if rejected.

## 47.5 Validation errors

- missing required;
- nested violations.

## 47.6 Domain errors

- not found;
- conflict;
- invalid transition.

## 47.7 Security errors

- unauthenticated;
- forbidden.

## 47.8 Infrastructure fallback

Simulate dependency failure.

## 47.9 Mapper tests

Unit test mapper logic.

Runtime test mapper registration.

## 47.10 Golden tests

Problem JSON exact shape.

---

# 48. Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus

## 48.1 Default error bodies differ

Without mappers, runtimes may return plain text, HTML, or JSON.

## 48.2 Parameter exception classes differ

Conversion errors are often implementation-specific.

## 48.3 JSON provider exceptions differ

Jackson vs JSON-B exceptions differ.

## 48.4 NotFound ambiguity

Runtime route not found and application-thrown NotFound may look same.

## 48.5 Provider scanning differences

Mapper discovery may differ by runtime/build-time indexing.

## 48.6 Quarkus

Build-time augmentation may require correct registration/discovery patterns.

## 48.7 Rule

Error contract tests must run on target runtime.

---

# 49. Migration: `javax.ws.rs` to `jakarta.ws.rs`

## 49.1 Imports

Old:

```java
javax.ws.rs.ext.ExceptionMapper
javax.ws.rs.WebApplicationException
javax.ws.rs.core.Response
```

New:

```java
jakarta.ws.rs.ext.ExceptionMapper
jakarta.ws.rs.WebApplicationException
jakarta.ws.rs.core.Response
```

## 49.2 Mixed namespace issue

A `javax.ws.rs.ext.ExceptionMapper` is not a Jakarta REST 4 mapper.

It will not be discovered/used by Jakarta runtime.

## 49.3 Libraries

Check old exception mapper libraries.

## 49.4 Tests

If all error endpoints suddenly use runtime default body, mapper migration may be broken.

## 49.5 Rule

Migration includes mappers, providers, filters, annotations, and exceptions.

---

# 50. Common Failure Modes

## 50.1 Catch-all mapper returns 500 for everything

Client errors become server errors.

## 50.2 Mapper forgets content type

Response not `application/problem+json`.

## 50.3 405 mapper loses `Allow` header

HTTP semantics broken.

## 50.4 401 mapper loses `WWW-Authenticate`

Auth clients break.

## 50.5 Stack trace in response

Security leak.

## 50.6 Validation error not field-addressable

UI cannot highlight fields.

## 50.7 Domain conflict returned as 500

Expected business rejection treated as bug.

## 50.8 JSON parse errors expose provider internals

Bad client experience/security.

## 50.9 Duplicate mappers

Unpredictable/ambiguous runtime behavior.

## 50.10 Error code changes after refactor

Client breaks.

## 50.11 Error mapper itself fails serialization

500 or empty response.

## 50.12 Streaming error after commit

Client gets partial body.

---

# 51. Best Practices

## 51.1 Use RFC 9457 Problem Details

Baseline for error body.

## 51.2 Add stable `code`

HTTP status alone is not enough.

## 51.3 Separate mapper families

Validation, domain, JAX-RS, processing, fallback.

## 51.4 Preserve HTTP headers

Especially `Allow`, `WWW-Authenticate`, `Retry-After`.

## 51.5 Never expose internals

Stack traces and class names stay in logs.

## 51.6 Include correlation ID

In response and logs.

## 51.7 Test errors like success responses

Golden contract tests.

## 51.8 Map expected business errors to 4xx/409/412

Not 500.

## 51.9 Observe errors by code/status/route

Metrics and traces.

## 51.10 Keep domain HTTP-free

Map domain/application exceptions at REST boundary.

---

# 52. Anti-Patterns

## 52.1 `ExceptionMapper<Throwable>` only

Everything becomes generic.

## 52.2 Throwing `WebApplicationException` deep in domain

HTTP leaks into domain.

## 52.3 Returning plain string error

No machine contract.

## 52.4 Using exception message as code

Unstable and localizable.

## 52.5 Exposing raw provider exception

Leaky and ugly.

## 52.6 Logging all 4xx as ERROR

Noise.

## 52.7 Returning 200 with error body

Breaks HTTP semantics.

## 52.8 Returning 500 for validation/business errors

Wrong client behavior.

## 52.9 No mapper tests

Runtime default leaks.

## 52.10 Localizing error code

Clients break.

---

# 53. Production Checklist

## 53.1 Contract

- [ ] Error response uses `application/problem+json`.
- [ ] Every error has stable `code`.
- [ ] Problem fields follow RFC 9457.
- [ ] Error codes documented.
- [ ] OpenAPI documents error responses.
- [ ] Correlation ID included.

## 53.2 Mappers

- [ ] Specific mappers for validation/domain/JAX-RS/fallback.
- [ ] No duplicate mapper for same exception.
- [ ] `WebApplicationException` mapper preserves status and headers.
- [ ] Catch-all mapper safe and logs.
- [ ] Mapper serialization tested.

## 53.3 Status mapping

- [ ] 400 for syntax/conversion/body parse.
- [ ] 401 for unauthenticated.
- [ ] 403 for forbidden.
- [ ] 404 for not found.
- [ ] 405 preserves `Allow`.
- [ ] 406 for unacceptable response media.
- [ ] 409 for business conflict.
- [ ] 412 for failed precondition.
- [ ] 415 for unsupported request media.
- [ ] 429/503 with retry semantics where appropriate.
- [ ] 500 only for unexpected internal failure.

## 53.4 Security

- [ ] No stack trace in response.
- [ ] No internal host/table/file path.
- [ ] No raw request body.
- [ ] No token/cookie in error.
- [ ] Auth errors safe.

## 53.5 Observability

- [ ] Logs include correlation ID and code.
- [ ] Metrics by code/status/route.
- [ ] 4xx/5xx separated.
- [ ] Alerts on 5xx/dependency spikes.
- [ ] No high-cardinality labels.

## 53.6 Tests

- [ ] Runtime tests for all standard error categories.
- [ ] Golden JSON problem tests.
- [ ] Header preservation tests.
- [ ] Mapper registration tests.
- [ ] Migration namespace tests.

---

# 54. Latihan

## Latihan 1 — Problem DTO

Buat `ProblemResponse` dan `ViolationResponse`.

Pastikan JSON output sesuai RFC 9457 + extensions.

## Latihan 2 — Mapper Family

Implement:

- `DomainExceptionMapper`;
- `ValidationExceptionMapper`;
- `WebApplicationExceptionMapper`;
- `ThrowableMapper`.

Test mapper specificity.

## Latihan 3 — Preserve Headers

Trigger:

```text
405 Method Not Allowed
```

Pastikan response punya:

```http
Allow
```

dan body Problem Details.

## Latihan 4 — JSON Parse Error

Kirim malformed JSON.

Pastikan response:

```text
400 application/problem+json MALFORMED_JSON
```

Tanpa stack trace.

## Latihan 5 — Validation Error

Kirim DTO invalid.

Pastikan violations berisi field path.

## Latihan 6 — Domain Conflict

Buat state machine order.

Cancel shipped order.

Return:

```text
409 ORDER_INVALID_STATE
```

## Latihan 7 — Auth Errors

Simulasikan:

- no token → 401;
- token valid but insufficient role → 403;
- hidden resource policy → 404 if chosen.

## Latihan 8 — Downstream Failure

Mock dependency timeout.

Map ke 503/504 sesuai architecture.

## Latihan 9 — Error Observability

Tambahkan metrics:

```text
api_errors_total{code,status,route}
```

Pastikan tidak ada raw path/ID.

---

# 55. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 — `ExceptionMapper` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/exceptionmapper

2. Jakarta RESTful Web Services 4.0 — `WebApplicationException` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/webapplicationexception

3. Jakarta RESTful Web Services 4.0 — Package `jakarta.ws.rs` API Summary  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/package-summary

4. Jakarta RESTful Web Services 4.0 — `Providers#getExceptionMapper` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/providers

5. Jakarta RESTful Web Services 4.0 — `ProcessingException` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/processingexception

6. Jakarta RESTful Web Services 4.0 — `StreamingOutput` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/streamingoutput

7. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

8. RFC 9457 — Problem Details for HTTP APIs  
   https://www.rfc-editor.org/rfc/rfc9457.html

9. RFC 9110 — HTTP Semantics  
   https://www.rfc-editor.org/rfc/rfc9110.html

10. RESTEasy User Guide — Exception Handling  
    https://docs.resteasy.dev/5.0/userguide/html/ch30.html

---

# 56. Penutup

Error handling production-grade bukan `try-catch` acak.

Ia adalah arsitektur kontrak:

```text
exception/failure
  ↓
classification
  ↓
HTTP status
  ↓
stable error code
  ↓
Problem Details response
  ↓
logs/metrics/traces
  ↓
client action/support diagnosis
```

Mental model final:

```text
Routing/conversion/body parse/validation/security/domain/dependency/streaming
each fails differently
and must be mapped deliberately.
```

Prinsip final:

```text
Error response is API.
Stable code is API.
Problem shape is API.
Header preservation is API.
Correlation ID is operational contract.
```

Top-tier JAX-RS engineer memastikan:

- client bisa memahami dan memperbaiki error;
- support bisa melacak error;
- security tidak bocor;
- metrics bisa membedakan kategori;
- domain tetap HTTP-free;
- runtime-specific exceptions dinormalisasi;
- semua error penting punya test.

Part berikutnya:

```text
Bagian 014 — Validation Integration: Jakarta Validation at REST Boundary
```

Kita akan membahas integrasi Jakarta Validation secara mendalam: parameter validation, entity validation, `@Valid`, cross-field constraints, validation groups, method validation, error mapping, and designing validation as boundary contract.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 012 — JSON in JAX-RS: JSON-B, JSON-P, Jackson, Provider Selection, DTO Contract, Null Policy, Unknown Fields, Date/Time, Enum Wire Values, dan Security](./learn-jaxrs-advanced-part-012.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Bagian 014 — Validation Integration: Jakarta Validation at REST Boundary, `@Valid`, Parameter Validation, Entity Validation, Groups, Cross-Field Constraint, dan Error Mapping](./learn-jaxrs-advanced-part-014.md)
