# learn-jaxrs-advanced-part-035.md

# Bagian 035 — Testing JAX-RS Server: Unit Test, Integration Test, Runtime Pipeline, Filters, Providers, Exception Mappers, Validation, Security, Async, Streaming, Multipart, Contract Tests, and Production-Grade Test Strategy

> Target pembaca: Java/Jakarta engineer yang ingin menguasai **testing server-side Jakarta REST/JAX-RS** secara production-grade. Fokus bagian ini bukan hanya “test endpoint dengan REST Assured”, tetapi membangun test strategy berlapis: unit test resource/service boundary, integration test runtime pipeline, provider/filter/interceptor/mapper, JSON contract, validation, security, persistence, concurrency, async, SSE, streaming, multipart, OpenAPI contract testing, negative testing, dan observability.
>
> Namespace utama: `jakarta.ws.rs.core.Application`, `jakarta.ws.rs.core.Response`, `jakarta.ws.rs.ext.ExceptionMapper`, `jakarta.ws.rs.container.ContainerRequestFilter`, `jakarta.ws.rs.container.ContainerResponseFilter`, `jakarta.ws.rs.ext.MessageBodyReader`, `MessageBodyWriter`, `jakarta.validation.*`, `org.junit.jupiter.api.*`, JAX-RS Client API, Jersey Test Framework/RESTEasy/CXF runtime-specific test tools, REST Assured, Testcontainers.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Test Pyramid untuk JAX-RS](#2-mental-model-test-pyramid-untuk-jax-rs)
3. [Apa yang Harus Diuji di REST API?](#3-apa-yang-harus-diuji-di-rest-api)
4. [Unit Test Resource Method](#4-unit-test-resource-method)
5. [Unit Test Application Service](#5-unit-test-application-service)
6. [Unit Test Mapper/DTO](#6-unit-test-mapperdto)
7. [Unit Test Exception Mapper](#7-unit-test-exception-mapper)
8. [Unit Test Filter/Interceptor](#8-unit-test-filterinterceptor)
9. [Kenapa Unit Test Tidak Cukup](#9-kenapa-unit-test-tidak-cukup)
10. [Runtime Integration Test](#10-runtime-integration-test)
11. [JAX-RS Test Container Strategy](#11-jax-rs-test-container-strategy)
12. [In-Memory vs Embedded Server vs Real Container](#12-in-memory-vs-embedded-server-vs-real-container)
13. [Jersey Test Framework](#13-jersey-test-framework)
14. [RESTEasy/CXF/Liberty/Quarkus Test Notes](#14-resteasycxflibertyquarkus-test-notes)
15. [REST Assured as Black-Box HTTP Test DSL](#15-rest-assured-as-black-box-http-test-dsl)
16. [JAX-RS Client API for Tests](#16-jax-rs-client-api-for-tests)
17. [Testcontainers for Real Dependencies](#17-testcontainers-for-real-dependencies)
18. [Application Registration Test](#18-application-registration-test)
19. [Request Matching Tests](#19-request-matching-tests)
20. [Parameter Binding Tests](#20-parameter-binding-tests)
21. [Content Negotiation Tests](#21-content-negotiation-tests)
22. [JSON Serialization/Deserialization Tests](#22-json-serializationdeserialization-tests)
23. [Validation Tests](#23-validation-tests)
24. [Error Handling and Problem Details Tests](#24-error-handling-and-problem-details-tests)
25. [Security Tests](#25-security-tests)
26. [Authorization and Tenant Isolation Tests](#26-authorization-and-tenant-isolation-tests)
27. [CORS/CSRF/Cookie Tests](#27-corscsrfcookie-tests)
28. [Conditional Request / ETag Tests](#28-conditional-request--etag-tests)
29. [PATCH Tests](#29-patch-tests)
30. [Pagination/Filtering/Sorting Tests](#30-paginationfilteringsorting-tests)
31. [AsyncResponse/CompletionStage Tests](#31-asyncresponsecompletionstage-tests)
32. [SSE Tests](#32-sse-tests)
33. [Streaming Download Tests](#33-streaming-download-tests)
34. [Multipart Upload Tests](#34-multipart-upload-tests)
35. [Persistence and Transaction Tests](#35-persistence-and-transaction-tests)
36. [Concurrency Tests](#36-concurrency-tests)
37. [Idempotency Tests](#37-idempotency-tests)
38. [Outbox/Event Tests](#38-outboxevent-tests)
39. [OpenAPI Contract Tests](#39-openapi-contract-tests)
40. [Consumer-Driven Contract Tests](#40-consumer-driven-contract-tests)
41. [Snapshot/Golden File Tests](#41-snapshotgolden-file-tests)
42. [Negative Testing](#42-negative-testing)
43. [Property-Based and Fuzz Testing](#43-property-based-and-fuzz-testing)
44. [Performance Smoke Tests](#44-performance-smoke-tests)
45. [Observability Tests](#45-observability-tests)
46. [Test Data Strategy](#46-test-data-strategy)
47. [Database Cleanup Strategy](#47-database-cleanup-strategy)
48. [Mocking External Services](#48-mocking-external-services)
49. [Clock, UUID, and Determinism](#49-clock-uuid-and-determinism)
50. [CI Pipeline Strategy](#50-ci-pipeline-strategy)
51. [Coverage: Code Coverage vs API Contract Coverage](#51-coverage-code-coverage-vs-api-contract-coverage)
52. [Common Failure Modes](#52-common-failure-modes)
53. [Best Practices](#53-best-practices)
54. [Anti-Patterns](#54-anti-patterns)
55. [Production Checklist](#55-production-checklist)
56. [Latihan](#56-latihan)
57. [Referensi Resmi](#57-referensi-resmi)
58. [Penutup](#58-penutup)

---

# 1. Tujuan Part Ini

Testing JAX-RS server tidak cukup dengan satu jenis test.

Endpoint sederhana:

```java
@GET
@Path("/customers/{id}")
@Produces(MediaType.APPLICATION_JSON)
public CustomerResponse get(@PathParam("id") CustomerId id) {
    return service.get(id);
}
```

Bisa gagal di banyak layer:

```text
@Path matching salah
@PathParam conversion gagal
@Produces tidak cocok
JSON provider tidak register
DTO mapping salah
validation tidak jalan
ExceptionMapper tidak terpakai
security filter tidak aktif
tenant filter lupa
transaction rollback tidak terjadi
response header hilang
OpenAPI tidak match implementasi
```

Unit test method Java tidak akan menangkap semuanya.

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- membedakan unit, slice, integration, contract, dan E2E test;
- tahu apa yang diuji di masing-masing layer;
- test resource method tanpa runtime;
- test JAX-RS runtime pipeline dengan embedded/real server;
- test filter, interceptor, mapper, provider;
- test JSON, validation, security, async, streaming, multipart;
- memakai Testcontainers untuk DB/broker/storage;
- membuat negative/fuzz/concurrency tests;
- menghubungkan OpenAPI dengan test;
- menyusun CI test suite yang cepat dan reliable.

## 1.2 Prinsip utama

```text
Unit tests prove logic.
Integration tests prove runtime wiring.
Contract tests prove API compatibility.
Security tests prove boundary enforcement.
Concurrency tests prove correctness under race.
```

---

# 2. Mental Model: Test Pyramid untuk JAX-RS

Layer test yang sehat:

```text
Many:
  unit tests
  mapper tests
  service tests
  validation tests

Some:
  JAX-RS runtime integration tests
  repository/database tests
  security/filter/provider tests
  contract tests

Few:
  full-stack E2E tests
  performance/load tests
  chaos/fault injection tests
```

## 2.1 Jangan semua jadi E2E

E2E lambat, flaky, mahal.

## 2.2 Jangan semua jadi unit test

Unit test tidak membuktikan runtime behavior.

## 2.3 Rule

Gunakan test paling murah yang bisa membuktikan risiko yang ingin dibuktikan.

---

# 3. Apa yang Harus Diuji di REST API?

REST API contract meliputi:

- URI/path;
- method;
- query/header/cookie/body binding;
- media type;
- status code;
- response headers;
- response body;
- error body;
- validation;
- authentication;
- authorization;
- idempotency;
- caching/ETag;
- pagination;
- async lifecycle;
- streaming;
- file upload/download;
- observability.

## 3.1 Test tidak hanya happy path

Untuk setiap endpoint penting, test:

```text
success
validation failure
auth failure
authorization failure
not found
conflict
precondition failure
unsupported media type
not acceptable
malformed JSON
downstream/persistence failure
```

## 3.2 Rule

A REST endpoint is not tested until its failure contract is tested.

---

# 4. Unit Test Resource Method

Unit test resource cocok untuk resource yang tipis.

## 4.1 Example

```java
class CustomerResourceTest {

    @Test
    void getCustomerReturnsResponse() {
        CustomerService service = mock(CustomerService.class);
        CustomerResource resource = new CustomerResource(service);

        when(service.get(new CustomerId("C001")))
            .thenReturn(new CustomerResponse("C001", "Fajar", "ACTIVE"));

        CustomerResponse response = resource.get(new CustomerId("C001"));

        assertEquals("C001", response.id());
    }
}
```

## 4.2 What it proves

- resource delegates correctly;
- response construction logic;
- location/link building if mockable;
- simple branching.

## 4.3 What it does not prove

- `@Path` works;
- `@PathParam` conversion works;
- JSON serialization;
- filters;
- validation;
- exception mapping;
- CDI injection;
- media negotiation.

## 4.4 Rule

Unit test resource method only if resource logic exists. Keep it thin.

---

# 5. Unit Test Application Service

Application service contains use case logic and transaction boundary.

## 5.1 Example

```java
@Test
void createCustomerRejectsDuplicateEmail() {
    CustomerRepository repo = mock(CustomerRepository.class);
    when(repo.existsByEmail(tenant, email)).thenReturn(true);

    CustomerService service = new CustomerService(repo, mapper, clock);

    assertThrows(DuplicateEmailException.class,
        () -> service.create(command));
}
```

## 5.2 Good for

- domain branching;
- authorization orchestration;
- command validation;
- idempotency logic;
- mapping to result;
- business errors.

## 5.3 Use fake repositories carefully

Mocked repositories do not prove DB constraints/transactions.

## 5.4 Rule

Service unit tests should focus on business behavior, not HTTP.

---

# 6. Unit Test Mapper/DTO

Mappers are API security boundary.

## 6.1 Test field exposure

```java
@Test
void responseDoesNotExposeTenantIdOrInternalRiskScore() {
    CustomerResponse dto = mapper.toResponse(entity);

    assertThat(dto).hasNoFieldOrProperty("tenantId");
}
```

## 6.2 Test version mapping

V1 and V2 DTOs should differ intentionally.

## 6.3 Test null/missing handling

DTO mapping can break client contracts.

## 6.4 Rule

Mapper tests prevent accidental data leak and version drift.

---

# 7. Unit Test Exception Mapper

Exception mapper can often be tested directly.

## 7.1 Example

```java
@Test
void mapsNotFoundTo404Problem() {
    ProblemExceptionMapper mapper = new ProblemExceptionMapper(factory);

    Response response = mapper.toResponse(new CustomerNotFoundException("C001"));

    assertEquals(404, response.getStatus());
    ProblemDetails problem = (ProblemDetails) response.getEntity();
    assertEquals("RESOURCE_NOT_FOUND", problem.code());
}
```

## 7.2 Also integration test

Need verify runtime selects mapper correctly.

## 7.3 Rule

Unit test mapper content; integration test mapper registration/selection.

---

# 8. Unit Test Filter/Interceptor

Filters often depend on `ContainerRequestContext`.

## 8.1 Use fake context

Implement simple fake or use mocking framework.

## 8.2 Test auth filter

- missing token aborts 401;
- invalid token aborts 401;
- valid token sets security context/current actor;
- tenant mismatch aborts.

## 8.3 Test response filter

- security headers added;
- correlation ID header set;
- CORS headers correct.

## 8.4 Rule

Unit test filter decisions; integration test ordering and runtime context.

---

# 9. Kenapa Unit Test Tidak Cukup

JAX-RS is annotation/runtime driven.

Unit test cannot verify:

- request matching algorithm;
- provider discovery;
- content negotiation;
- message body reader/writer;
- CDI injection;
- validation integration;
- filter/interceptor order;
- exception mapper selection;
- server-generated headers;
- actual HTTP serialization.

## 9.1 Rule

Every important API needs at least some runtime integration tests.

---

# 10. Runtime Integration Test

Runtime integration test starts JAX-RS runtime and sends real HTTP request.

## 10.1 It proves

- route registration;
- annotations;
- parameter conversion;
- JSON provider;
- filters;
- exception mappers;
- validation;
- CDI integration;
- response headers;
- actual HTTP contract.

## 10.2 Example shape

```java
@Test
void getCustomerReturnsJson() {
    given()
      .accept("application/json")
    .when()
      .get("/customers/C001")
    .then()
      .statusCode(200)
      .contentType("application/json")
      .body("id", equalTo("C001"));
}
```

## 10.3 Rule

If behavior depends on runtime, test with runtime.

---

# 11. JAX-RS Test Container Strategy

Options:

```text
in-memory JAX-RS test container
embedded HTTP server
runtime-specific test extension
real application container
full Docker/container deployment
```

## 11.1 Choose based on risk

- resource matching: embedded enough;
- filters/providers: embedded runtime;
- CDI/security/transactions: target runtime;
- gateway/CORS: full deployment path;
- DB behavior: real DB container.

## 11.2 Rule

Test as low as possible, as real as necessary.

---

# 12. In-Memory vs Embedded Server vs Real Container

## 12.1 In-memory

Fast but may not use real HTTP stack.

Good for route/provider tests.

## 12.2 Embedded server

Uses real HTTP port and runtime.

Good balance.

## 12.3 Real container

Closest to production.

Needed for:

- CDI/security integration;
- transactions;
- server filters;
- deployment descriptors;
- TLS/gateway behavior.

## 12.4 Rule

Do not assume in-memory container catches production container bugs.

---

# 13. Jersey Test Framework

Jersey Test Framework provides test utilities for Jersey-based JAX-RS applications.

## 13.1 Concept

Extend `JerseyTest` and provide `Application`/`ResourceConfig`.

```java
class CustomerResourceIT extends JerseyTest {

    @Override
    protected Application configure() {
        return new ResourceConfig()
            .register(CustomerResource.class)
            .register(ProblemExceptionMapper.class)
            .register(JsonProvider.class);
    }

    @Test
    void getCustomer() {
        Response response = target("customers/C001")
            .request()
            .get();

        assertEquals(200, response.getStatus());
    }
}
```

## 13.2 Use case

Fast runtime integration for Jersey stack.

## 13.3 Caveat

Jersey-specific. If production is not Jersey, use target runtime tests too.

## 13.4 Rule

JerseyTest is excellent for Jersey apps, not universal proof for all JAX-RS runtimes.

---

# 14. RESTEasy/CXF/Liberty/Quarkus Test Notes

## 14.1 RESTEasy

Use RESTEasy-specific test support or Quarkus/Spring/EE container depending stack.

## 14.2 CXF

Use CXF test support / embedded server.

## 14.3 Open Liberty

Use container/integration testing tools and enabled features.

## 14.4 Quarkus

Use `@QuarkusTest` with REST Assured for HTTP-level tests.

## 14.5 Rule

Use runtime-native test tools for final confidence.

---

# 15. REST Assured as Black-Box HTTP Test DSL

REST Assured is a Java DSL for testing REST services.

## 15.1 Good for

- status assertions;
- JSON body assertions;
- headers;
- cookies;
- auth;
- multipart;
- binary;
- contract-ish tests.

## 15.2 Example

```java
given()
  .contentType("application/json")
  .body("""
      {"displayName":"Fajar","email":"fajar@example.com"}
      """)
.when()
  .post("/customers")
.then()
  .statusCode(201)
  .header("Location", containsString("/customers/"))
  .body("id", notNullValue());
```

## 15.3 Rule

REST Assured tests the API from consumer perspective.

---

# 16. JAX-RS Client API for Tests

JAX-RS Client can be used for tests too.

## 16.1 Example

```java
try (Client client = ClientBuilder.newClient()) {
    Response response = client.target(baseUri)
        .path("customers/C001")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .get();

    assertEquals(200, response.getStatus());
}
```

## 16.2 Good for

- same stack tests;
- streaming/SSE client tests;
- low-level response handling.

## 16.3 Rule

Use REST Assured for expressive HTTP assertions; use JAX-RS Client when testing JAX-RS client interactions or streaming APIs.

---

# 17. Testcontainers for Real Dependencies

Testcontainers provides throwaway Docker containers for tests.

## 17.1 Use cases

- PostgreSQL/Oracle/MySQL;
- Kafka/Redpanda;
- Redis;
- MinIO/S3-compatible storage;
- WireMock/MockServer;
- OpenSearch/Elasticsearch;
- Keycloak.

## 17.2 Example idea

```java
@Testcontainers
class CustomerResourceIT {
    @Container
    static PostgreSQLContainer<?> postgres =
        new PostgreSQLContainer<>("postgres:16");
}
```

## 17.3 Why

Real dependencies catch:

- SQL dialect issues;
- transaction isolation;
- constraints;
- migration errors;
- serialization quirks.

## 17.4 Rule

Use real dependency containers for persistence/integration behavior that mocks cannot prove.

---

# 18. Application Registration Test

Test `Application`/resource registration.

## 18.1 What to test

- base path;
- resource classes available;
- providers registered;
- filters active;
- unsupported path returns 404;
- unsupported method returns 405.

## 18.2 Example

```http
GET /unknown → 404
POST /customers/{id} when only GET exists → 405
```

## 18.3 Rule

Registration bugs should fail early in tests.

---

# 19. Request Matching Tests

Test ambiguous routes.

## 19.1 Examples

```text
/customers/search
/customers/{id}
```

Ensure `search` does not get treated as ID.

## 19.2 Regex path

Test valid and invalid IDs.

## 19.3 Subresources

Test subresource locator routes.

## 19.4 Rule

Every non-trivial routing design needs matching tests.

---

# 20. Parameter Binding Tests

Test:

- `@PathParam`;
- `@QueryParam`;
- `@HeaderParam`;
- `@CookieParam`;
- `@MatrixParam`;
- `@DefaultValue`;
- `@BeanParam`;
- `ParamConverter`.

## 20.1 Invalid conversion

Invalid ID should produce stable error:

```http
400 Bad Request
```

with Problem Details if mapped.

## 20.2 Multi-value query

Test repeated params.

## 20.3 Rule

Parameter binding is part of API contract.

---

# 21. Content Negotiation Tests

Test:

- `Accept: application/json`;
- unsupported Accept → 406;
- wrong Content-Type → 415;
- multiple acceptable media types;
- vendor media type version;
- `Vary` header if needed.

## 21.1 Example

```java
given()
  .accept("application/xml")
.when()
  .get("/customers/C001")
.then()
  .statusCode(406);
```

## 21.2 Rule

Media type negotiation failures should be tested, not left to runtime defaults.

---

# 22. JSON Serialization/Deserialization Tests

Test JSON contract.

## 22.1 Serialization

- field names;
- date format;
- enum values;
- null handling;
- unknown field policy;
- BigDecimal precision.

## 22.2 Deserialization

- missing required field;
- null field;
- unknown field;
- invalid enum;
- invalid date;
- invalid number.

## 22.3 Rule

JSON provider configuration must be tested through HTTP, not only mapper unit tests.

---

# 23. Validation Tests

Test Jakarta Validation integration.

## 23.1 Request body validation

```http
POST /customers
{"displayName": ""}
```

Expect 400/422 per policy with field error.

## 23.2 Parameter validation

```http
GET /customers?limit=999999
```

Expect validation error.

## 23.3 Nested validation

Test `@Valid`.

## 23.4 Rule

Validation tests should assert error path/code, not only status.

---

# 24. Error Handling and Problem Details Tests

For each mapped error, test:

- status;
- content type `application/problem+json`;
- stable `code`;
- no stack trace;
- correlation ID;
- field errors if applicable;
- localization if supported.

## 24.1 Example

```java
then()
  .statusCode(404)
  .contentType("application/problem+json")
  .body("code", equalTo("CUSTOMER_NOT_FOUND"));
```

## 24.2 Rule

Error contract deserves same quality tests as success response.

---

# 25. Security Tests

Test:

- missing auth;
- invalid token;
- expired token;
- wrong audience;
- missing scope;
- wrong role;
- mTLS/client cert if used.

## 25.1 Assert

- 401 vs 403;
- `WWW-Authenticate`;
- no sensitive error details;
- audit/log markers if observable.

## 25.2 Rule

Security is not covered by happy-path tests with admin token.

---

# 26. Authorization and Tenant Isolation Tests

## 26.1 Object-level authorization

User A cannot access User B resource.

## 26.2 Tenant isolation

Tenant A cannot see Tenant B data.

## 26.3 Existence leakage

Decide 403 vs hidden 404 and test it.

## 26.4 Write operations

Unauthorized mutation must not change DB.

## 26.5 Rule

Authorization tests must verify both response and data state.

---

# 27. CORS/CSRF/Cookie Tests

## 27.1 CORS preflight

```http
OPTIONS /api/resource
Origin: https://app.example.com
Access-Control-Request-Method: POST
```

Assert allowed origin/method/headers.

## 27.2 Credentialed CORS

No wildcard origin with credentials.

## 27.3 CSRF

For cookie-authenticated mutation:

- missing token rejected;
- invalid token rejected;
- valid token accepted;
- Origin/Referer policy if used.

## 27.4 Rule

Browser security behavior needs dedicated tests.

---

# 28. Conditional Request / ETag Tests

Test:

- GET returns ETag;
- `If-None-Match` returns 304;
- PATCH without `If-Match` returns 428 if required;
- stale `If-Match` returns 412;
- fresh `If-Match` succeeds and returns new ETag.

## 28.1 Rule

Concurrency/conditional behavior is HTTP contract and must be tested.

---

# 29. PATCH Tests

Test:

- JSON Merge Patch null vs missing;
- JSON Patch operations;
- invalid path;
- unauthorized field;
- validation after patch;
- optimistic concurrency;
- idempotency if claimed.

## 29.1 Rule

PATCH tests should focus on partial update semantics, not only status.

---

# 30. Pagination/Filtering/Sorting Tests

Test:

- default limit;
- max limit;
- invalid sort field;
- stable ordering;
- next/prev links;
- cursor validity;
- cursor tampering;
- filter allowlist;
- empty result.

## 30.1 Rule

List APIs need contract tests for stability and safety.

---

# 31. AsyncResponse/CompletionStage Tests

## 31.1 Success

Use deterministic latch/future.

```java
CompletableFuture<Response> future = new CompletableFuture<>();
```

Trigger completion from test.

## 31.2 Timeout

Configure short timeout and assert response.

## 31.3 Error

Complete exceptionally and assert exception mapper.

## 31.4 Cleanup

Assert registry cleaned.

## 31.5 Avoid sleeps

Use latches/awaitility-like pattern.

## 31.6 Rule

Async tests must control time deterministically.

---

# 32. SSE Tests

Test:

- content type `text/event-stream`;
- named event;
- data JSON;
- event ID;
- heartbeat;
- reconnect with `Last-Event-ID`;
- client close cleanup;
- authorization per stream.

## 32.1 Use JAX-RS SSE client

`SseEventSource` can be useful.

## 32.2 Caveat

Browser EventSource behavior also needs browser/E2E test if frontend depends on it.

## 32.3 Rule

SSE tests must prove lifecycle, not only first event.

---

# 33. Streaming Download Tests

Test:

- headers;
- `Content-Disposition`;
- `Content-Length`;
- checksum;
- large file memory behavior;
- `Range`;
- `206`;
- `416`;
- client abort cleanup.

## 33.1 Avoid buffering in test client

Streaming test should stream to sink/file.

## 33.2 Rule

Large file tests should prove bounded memory and correct protocol.

---

# 34. Multipart Upload Tests

Test:

- valid upload;
- missing part;
- duplicate part;
- unknown part;
- file too large;
- content type mismatch;
- malicious filename;
- empty file;
- client abort;
- malware/quarantine workflow.

## 34.1 REST Assured multipart example

```java
given()
  .multiPart("file", new File("sample.pdf"), "application/pdf")
  .multiPart("metadata", """
      {"documentType":"IDENTITY"}
      """, "application/json")
.when()
  .post("/documents")
.then()
  .statusCode(202);
```

## 34.2 Rule

Upload tests are security tests.

---

# 35. Persistence and Transaction Tests

Use real DB container when possible.

Test:

- rollback on exception;
- constraint mapping;
- transaction boundary;
- lazy loading;
- N+1 query;
- tenant filter;
- optimistic lock.

## 35.1 Rule

Persistence behavior cannot be fully proven with mocks.

---

# 36. Concurrency Tests

Test race conditions:

- two PATCH with same ETag;
- duplicate POST with same idempotency key;
- two uploads same logical file;
- lock timeout;
- concurrent delete/update.

## 36.1 Use barriers/latches

Synchronize threads to create race.

## 36.2 Rule

Concurrency bugs require actual concurrent execution tests.

---

# 37. Idempotency Tests

Test:

- same key + same request returns same result;
- same key + different body returns conflict;
- retry after timeout returns original operation;
- concurrent same-key requests do not create duplicates;
- key scoped to actor/tenant.

## 37.1 Rule

Idempotency must be tested under concurrency and failure.

---

# 38. Outbox/Event Tests

Test:

- state change and outbox row committed together;
- rollback removes both;
- publisher retry;
- duplicate publish idempotent;
- event payload schema;
- event order where required.

## 38.1 Rule

Outbox tests protect integration consistency.

---

# 39. OpenAPI Contract Tests

Test implementation against OpenAPI.

## 39.1 Validate examples

Send example request, assert response matches documented schema.

## 39.2 Validate actual responses

Run integration tests and validate response against OpenAPI.

## 39.3 OpenAPI diff in CI

Breaking changes fail build.

## 39.4 Rule

OpenAPI must be executable contract, not passive docs.

---

# 40. Consumer-Driven Contract Tests

Consumers define expectations.

## 40.1 Useful for

- internal service-to-service;
- partner APIs;
- SDK compatibility;
- version migration.

## 40.2 Test provider

Provider verifies all active consumer contracts.

## 40.3 Rule

Consumer-driven contracts catch breaking changes important to real consumers.

---

# 41. Snapshot/Golden File Tests

Snapshot tests compare response JSON to stored expected file.

## 41.1 Good for

- versioned DTO contract;
- complex examples;
- OpenAPI examples.

## 41.2 Risk

- brittle;
- developers blindly update snapshots;
- field ordering issues.

## 41.3 Rule

Snapshot tests require review discipline.

---

# 42. Negative Testing

Negative tests are essential.

## 42.1 Examples

- malformed JSON;
- unknown field;
- wrong media type;
- unsupported accept;
- invalid path ID;
- invalid enum;
- oversized body;
- missing auth;
- forbidden tenant;
- invalid ETag;
- invalid cursor.

## 42.2 Rule

Negative tests prove boundary hardening.

---

# 43. Property-Based and Fuzz Testing

Useful for:

- query parser;
- cursor parser;
- patch document;
- file name sanitizer;
- range header parser;
- content negotiation edge cases.

## 43.1 Example properties

```text
sanitize(filename) never contains path separator
parseRange(format(range)) == range
cursor decode rejects tampered cursor
```

## 43.2 Rule

Use property tests for parsers and security-sensitive input handling.

---

# 44. Performance Smoke Tests

Not full load test, but catches obvious regressions.

## 44.1 Examples

- GET list p95 under threshold with 1000 rows;
- JSON serialization not N+1;
- upload 100MB memory bounded;
- streaming download time to first byte;
- concurrent 20 requests no thread starvation.

## 44.2 Rule

Performance smoke tests catch catastrophic mistakes before load testing.

---

# 45. Observability Tests

Verify:

- correlation ID returned/logged;
- metrics increment;
- trace propagated;
- error logs redacted;
- audit event emitted;
- security event recorded.

## 45.1 Rule

If observability is required, test it.

---

# 46. Test Data Strategy

## 46.1 Builders

Use test data builders.

```java
CustomerBuilder.active().withTenant(tenantA).build();
```

## 46.2 Fixtures

For stable contract examples.

## 46.3 Avoid shared mutable data

Tests should be isolated.

## 46.4 Rule

Good test data makes tests readable and reliable.

---

# 47. Database Cleanup Strategy

Options:

- transaction rollback per test;
- truncate tables;
- recreate schema/container;
- unique tenant/test ID per test;
- migration before suite.

## 47.1 Trade-offs

Rollback is fast but may not work with async/outbox.

Truncate is reliable but slower.

Container per suite is realistic but costs time.

## 47.2 Rule

Choose cleanup strategy based on isolation and speed.

---

# 48. Mocking External Services

Use mock server for downstream HTTP.

## 48.1 Test

- request method/path/body/header;
- response statuses;
- timeouts;
- connection reset;
- malformed response;
- retry.

## 48.2 Tools

WireMock/MockServer/Testcontainers-based mocks.

## 48.3 Rule

Mock external services at HTTP boundary, not by mocking your HTTP client internals in integration tests.

---

# 49. Clock, UUID, and Determinism

Avoid random/time flaky tests.

## 49.1 Inject Clock

```java
Clock fixedClock = Clock.fixed(...);
```

## 49.2 Inject ID generator

Use deterministic IDs.

## 49.3 Rule

Tests should not depend on wall-clock randomness unless intentionally testing time.

---

# 50. CI Pipeline Strategy

Suggested groups:

```text
unit tests: every commit
integration tests: every PR
contract tests: every PR
security/negative tests: every PR or nightly
performance smoke: nightly or pre-release
full E2E: pre-release
```

## 50.1 Tags

Use JUnit tags:

```java
@Tag("integration")
@Tag("contract")
@Tag("slow")
```

## 50.2 Rule

Fast feedback first, realism before merge/release.

---

# 51. Coverage: Code Coverage vs API Contract Coverage

## 51.1 Code coverage

Measures lines/branches.

Useful but insufficient.

## 51.2 API contract coverage

Measures whether endpoints/status/media/errors documented/tested.

## 51.3 Need both

High code coverage can miss:

- 406;
- 415;
- security failure;
- Problem Details shape;
- headers.

## 51.4 Rule

For REST APIs, contract coverage matters as much as code coverage.

---

# 52. Common Failure Modes

## 52.1 Only service unit tests

Runtime broken.

## 52.2 Only happy path HTTP tests

Boundary weak.

## 52.3 Tests use admin token only

Authorization bugs missed.

## 52.4 Tests read entity into string for large download

Streaming not tested.

## 52.5 Mock DB only

Constraint/transaction bugs missed.

## 52.6 No 406/415 tests

Content negotiation broken.

## 52.7 No Problem Details assertions

Error contract drifts.

## 52.8 No concurrency tests

Lost updates slip.

## 52.9 Snapshots blindly updated

Breaking changes accepted.

## 52.10 In-memory runtime only

Production container bug missed.

---

# 53. Best Practices

## 53.1 Keep resource thin

More logic can be unit tested.

## 53.2 Test runtime pipeline

At least one integration test per important endpoint category.

## 53.3 Test failures

Errors are API contract.

## 53.4 Use real DB for persistence tests

Migrations, constraints, locking.

## 53.5 Test security by role/tenant

Not only authenticated happy path.

## 53.6 Test content negotiation

Accept/Content-Type.

## 53.7 Test streaming/upload with large data

Memory and protocol.

## 53.8 Validate OpenAPI

Lint/diff/contract.

## 53.9 Use deterministic time/IDs

Reduce flakiness.

## 53.10 Group tests for CI speed

Fast + realistic.

---

# 54. Anti-Patterns

## 54.1 “Controller tests” that call method directly and claim API tested

Not enough.

## 54.2 Mocking JAX-RS runtime everywhere

You test mocks.

## 54.3 Ignoring headers

REST contract includes headers.

## 54.4 Ignoring negative paths

Boundary bugs.

## 54.5 Testing with production auth bypass

False confidence.

## 54.6 Sharing state across tests

Flaky.

## 54.7 Sleeping in async tests

Flaky/slow.

## 54.8 Testcontainers per test unnecessarily

Slow.

## 54.9 No failure injection

Resilience untested.

## 54.10 Treating OpenAPI as docs only

Contract drift.

---

# 55. Production Checklist

## 55.1 Unit/slice

- [ ] Resource method logic tested where present.
- [ ] Service use cases tested.
- [ ] Mapper tests prevent field leaks.
- [ ] Exception mapper unit tests.
- [ ] Filter/interceptor unit tests.
- [ ] Deterministic clock/ID injection.

## 55.2 Runtime integration

- [ ] Resource registration tested.
- [ ] Request matching tested.
- [ ] Parameter binding tested.
- [ ] Content negotiation tested.
- [ ] JSON provider tested.
- [ ] Validation integration tested.
- [ ] Exception mapper selection tested.
- [ ] Filters/interceptors order tested.

## 55.3 Security/data

- [ ] Auth missing/invalid/expired tested.
- [ ] Scope/role tested.
- [ ] Tenant isolation tested.
- [ ] Unauthorized mutation leaves DB unchanged.
- [ ] CORS/CSRF tested if browser-facing.
- [ ] Audit/observability tested where required.

## 55.4 Advanced behavior

- [ ] ETag/preconditions tested.
- [ ] PATCH semantics tested.
- [ ] Pagination/cursor tested.
- [ ] Async timeout/success/error tested.
- [ ] SSE lifecycle tested.
- [ ] Streaming download tested.
- [ ] Multipart upload tested.
- [ ] Idempotency/concurrency tested.
- [ ] Outbox/event consistency tested.

## 55.5 Contract/CI

- [ ] OpenAPI lint.
- [ ] OpenAPI breaking diff.
- [ ] Contract tests.
- [ ] Real DB/container tests.
- [ ] External service mock tests.
- [ ] Test groups/tags defined.
- [ ] Flaky tests monitored.

---

# 56. Latihan

## Latihan 1 — Resource Unit Test

Buat `CustomerResource` tipis.

Unit test hanya memastikan command dibentuk benar dan service dipanggil.

## Latihan 2 — Runtime Route Test

Start embedded JAX-RS runtime.

Test:

```text
GET /customers/C001 → 200
POST /customers/C001 → 405
GET /unknown → 404
```

## Latihan 3 — Content Negotiation Test

Test:

```text
Accept: application/json → 200
Accept: application/xml → 406
Content-Type: text/plain untuk POST JSON → 415
```

## Latihan 4 — Problem Details Test

Trigger domain not found, validation failure, conflict.

Assert `application/problem+json`, `code`, `correlationId`.

## Latihan 5 — Tenant Isolation Test

Create data tenant A/B.

User tenant A requests tenant B resource.

Assert hidden 404/403 per policy and no data leak.

## Latihan 6 — ETag Concurrency Test

Two clients GET same resource.

Both PATCH with same ETag.

One succeeds, one 412.

## Latihan 7 — Multipart Security Test

Upload:

- path traversal filename;
- wrong content type;
- too large file;
- missing metadata.

Assert rejection and cleanup.

## Latihan 8 — Streaming Download Test

Download large file without buffering.

Assert checksum and memory bounded.

## Latihan 9 — OpenAPI Contract Test

Use OpenAPI examples to send requests and validate responses.

Add CI breaking-change diff.

---

# 57. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

2. Jakarta RESTful Web Services 4.0 — `Application` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/application

3. Jersey Test Framework Documentation  
   https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest/test-framework.html

4. REST Assured  
   https://rest-assured.io/

5. JUnit User Guide  
   https://docs.junit.org/6.1.0/overview.html

6. Testcontainers for Java  
   https://java.testcontainers.org/

7. Testcontainers JUnit 5 Integration  
   https://java.testcontainers.org/test_framework_integration/junit_5/

8. OpenAPI Specification 3.2.0  
   https://spec.openapis.org/oas/v3.2.0.html

---

# 58. Penutup

Testing JAX-RS server yang kuat tidak bergantung pada satu framework test.

Mental model final:

```text
Unit tests:
  prove Java logic

Runtime integration tests:
  prove JAX-RS/CDI/provider pipeline

Contract tests:
  prove API compatibility

Security tests:
  prove boundary enforcement

Concurrency tests:
  prove correctness under race

Container tests:
  prove real dependency behavior
```

Prinsip final:

```text
If it is part of the API contract, it deserves a test.
If it depends on runtime wiring, test with runtime.
If it depends on database behavior, test with real database.
If it affects security, test negative cases.
If it affects compatibility, test against OpenAPI/consumer contracts.
```

Top-tier JAX-RS engineer memastikan:

- test suite cepat tapi realistis;
- resource/service/mapper punya unit tests;
- runtime pipeline punya integration tests;
- errors, validation, security, negotiation, headers, dan media type diuji;
- async/streaming/upload punya lifecycle tests;
- persistence/concurrency diuji dengan real dependency;
- OpenAPI menjadi executable contract;
- CI memisahkan fast tests, integration tests, contract tests, dan slow tests.

Part berikutnya:

```text
Bagian 036 — Testing JAX-RS Client
```

Kita akan membahas testing outbound HTTP client: mock server, timeout/retry/circuit tests, Problem Details decoder, request verification, streaming download, upload, SSE client, contract tests, and resilience fault injection.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-jaxrs-advanced-part-034.md">⬅️ Bagian 034 — OpenAPI and Documentation Strategy: Contract Artifact, Code-First vs Spec-First, MicroProfile OpenAPI, Schema Design, Examples, Error Docs, Versioned Specs, Governance, CI Validation, Codegen, and Docs-as-Product</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-jaxrs-advanced-part-036.md">Bagian 036 — Testing JAX-RS Client: Mock Server, Request Verification, Timeout/Retry/Circuit Tests, Problem Details Decoder, Streaming Download, Upload, SSE Client, Contract Tests, and Resilience Fault Injection ➡️</a>
</div>
