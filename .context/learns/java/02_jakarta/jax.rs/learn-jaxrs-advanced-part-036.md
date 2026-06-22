# learn-jaxrs-advanced-part-036.md

# Bagian 036 — Testing JAX-RS Client: Mock Server, Request Verification, Timeout/Retry/Circuit Tests, Problem Details Decoder, Streaming Download, Upload, SSE Client, Contract Tests, and Resilience Fault Injection

> Target pembaca: Java/Jakarta engineer yang ingin menguasai **testing outbound HTTP client** berbasis JAX-RS/Jakarta REST Client API secara production-grade. Fokus bagian ini bukan hanya “mock service class”, tetapi memastikan client benar-benar mengirim HTTP request sesuai contract, menangani response/error/timeout, menutup `Response`, menerapkan retry/idempotency dengan aman, memproses Problem Details, streaming download/upload dengan resource management, membaca SSE, dan diuji terhadap mock server/contract tests/fault injection.
>
> Namespace utama: `jakarta.ws.rs.client.Client`, `ClientBuilder`, `WebTarget`, `Invocation`, `Entity`, `Response`, `GenericType`, `ProcessingException`, `ResponseProcessingException`, `ClientRequestFilter`, `ClientResponseFilter`, `SseEventSource`, serta tools seperti WireMock, MockWebServer, REST Assured, JUnit 5, Testcontainers, OpenAPI validators.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Test Outbound Boundary, Not Mock Internals](#2-mental-model-test-outbound-boundary-not-mock-internals)
3. [Apa yang Harus Diuji pada JAX-RS Client?](#3-apa-yang-harus-diuji-pada-jax-rs-client)
4. [Test Pyramid untuk Outbound Client](#4-test-pyramid-untuk-outbound-client)
5. [Gateway/Adapter Pattern untuk Testability](#5-gatewayadapter-pattern-untuk-testability)
6. [Unit Test Client Decoder](#6-unit-test-client-decoder)
7. [Unit Test Request Builder Logic](#7-unit-test-request-builder-logic)
8. [Kenapa Mocking `WebTarget` Biasanya Buruk](#8-kenapa-mocking-webtarget-biasanya-buruk)
9. [Mock HTTP Server Strategy](#9-mock-http-server-strategy)
10. [WireMock](#10-wiremock)
11. [WireMock JUnit Jupiter Extension](#11-wiremock-junit-jupiter-extension)
12. [OkHttp MockWebServer](#12-okhttp-mockwebserver)
13. [Testcontainers WireMock](#13-testcontainers-wiremock)
14. [Choosing WireMock vs MockWebServer](#14-choosing-wiremock-vs-mockwebserver)
15. [Basic JAX-RS Client Integration Test](#15-basic-jax-rs-client-integration-test)
16. [Verifying Method, Path, Query, Headers, Body](#16-verifying-method-path-query-headers-body)
17. [Testing URI Encoding](#17-testing-uri-encoding)
18. [Testing Content Negotiation](#18-testing-content-negotiation)
19. [Testing Request Entity Serialization](#19-testing-request-entity-serialization)
20. [Testing Response Deserialization](#20-testing-response-deserialization)
21. [Testing GenericType Responses](#21-testing-generictype-responses)
22. [Testing `Response.close()` and Resource Management](#22-testing-responseclose-and-resource-management)
23. [Testing Problem Details Decoder](#23-testing-problem-details-decoder)
24. [Testing HTTP Status Mapping](#24-testing-http-status-mapping)
25. [Testing ProcessingException and Network Failures](#25-testing-processingexception-and-network-failures)
26. [Testing ResponseProcessingException](#26-testing-responseprocessingexception)
27. [Testing Connect Timeout](#27-testing-connect-timeout)
28. [Testing Read Timeout / Slow Response](#28-testing-read-timeout--slow-response)
29. [Testing Retry Policy](#29-testing-retry-policy)
30. [Testing Retry-After](#30-testing-retry-after)
31. [Testing Idempotency-Key](#31-testing-idempotency-key)
32. [Testing Circuit Breaker](#32-testing-circuit-breaker)
33. [Testing Bulkhead](#33-testing-bulkhead)
34. [Testing Rate Limiter](#34-testing-rate-limiter)
35. [Testing Fallback](#35-testing-fallback)
36. [Testing Auth Filter](#36-testing-auth-filter)
37. [Testing Token Refresh Single-Flight](#37-testing-token-refresh-single-flight)
38. [Testing Correlation/Tracing Headers](#38-testing-correlationtracing-headers)
39. [Testing Client Request/Response Filters](#39-testing-client-requestresponse-filters)
40. [Testing Reader/Writer Interceptors](#40-testing-readerwriter-interceptors)
41. [Testing TLS and mTLS](#41-testing-tls-and-mtls)
42. [Testing Proxy Configuration](#42-testing-proxy-configuration)
43. [Testing Streaming Download](#43-testing-streaming-download)
44. [Testing Range Resume Download](#44-testing-range-resume-download)
45. [Testing Upload / Multipart Client](#45-testing-upload--multipart-client)
46. [Testing SSE Client](#46-testing-sse-client)
47. [Testing Async Client Invocation](#47-testing-async-client-invocation)
48. [Testing Reactive/CompletionStage Client](#48-testing-reactivecompletionstage-client)
49. [Testing OpenAPI Contract](#49-testing-openapi-contract)
50. [Consumer-Driven Contract Tests](#50-consumer-driven-contract-tests)
51. [Fault Injection Matrix](#51-fault-injection-matrix)
52. [Deterministic Time, Clock, and Scheduler](#52-deterministic-time-clock-and-scheduler)
53. [Test Data and Fixtures](#53-test-data-and-fixtures)
54. [CI Strategy](#54-ci-strategy)
55. [Observability Tests](#55-observability-tests)
56. [Common Failure Modes](#56-common-failure-modes)
57. [Best Practices](#57-best-practices)
58. [Anti-Patterns](#58-anti-patterns)
59. [Production Checklist](#59-production-checklist)
60. [Latihan](#60-latihan)
61. [Referensi Resmi](#61-referensi-resmi)
62. [Penutup](#62-penutup)

---

# 1. Tujuan Part Ini

Pada Part 028 dan 030 kita sudah membahas JAX-RS Client API dan resilience policy.

Sekarang pertanyaannya:

```text
Bagaimana membuktikan outbound client kita benar?
```

Contoh client wrapper:

```java
@ApplicationScoped
public class CustomerGateway {

    private final WebTarget customers;

    @Inject
    public CustomerGateway(@CustomerApi Client client, CustomerApiConfig config) {
        this.customers = client.target(config.baseUri()).path("/customers");
    }

    public CustomerResponse getCustomer(CustomerId id) {
        try (Response response = customers
            .path("{id}")
            .resolveTemplate("id", id.value())
            .request(MediaType.APPLICATION_JSON_TYPE)
            .header("X-Correlation-ID", Correlation.current())
            .get()) {
            return decode(response, CustomerResponse.class);
        }
    }
}
```

Testing yang buruk:

```java
WebTarget target = mock(WebTarget.class);
Invocation.Builder builder = mock(Invocation.Builder.class);
```

Testing yang lebih baik:

```text
Start mock HTTP server
Configure real JAX-RS Client with base URL pointing to mock server
Call real CustomerGateway
Verify mock server received exact HTTP request
Return controlled response/failure
Assert gateway maps result/error correctly
```

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- mendesain outbound client agar mudah diuji;
- memakai mock HTTP server daripada mock fluent API internals;
- verify method/path/query/header/body;
- test timeout/retry/circuit/bulkhead/fallback;
- test Problem Details decoder;
- test `Response.close()` discipline;
- test streaming download/upload/SSE client;
- test auth/correlation filters;
- test contract compatibility dengan OpenAPI/consumer contract;
- membangun fault injection matrix untuk outbound dependency.

## 1.2 Prinsip utama

```text
Outbound client correctness is proven at the HTTP boundary.
Do not mock away the protocol you are trying to verify.
```

---

# 2. Mental Model: Test Outbound Boundary, Not Mock Internals

JAX-RS Client API adalah fluent API dengan banyak object:

```text
Client → WebTarget → Invocation.Builder → Response
```

Jika kamu mock semua object fluent itu, test menjadi:

```text
implementation detail test
```

bukan:

```text
HTTP contract test
```

## 2.1 Yang harus dibuktikan

Outbound client harus membuktikan:

- URL/path benar;
- template/query encoding benar;
- method benar;
- headers benar;
- request body benar;
- content type/accept benar;
- response body decoded benar;
- non-2xx mapped benar;
- transport failure classified benar;
- response ditutup;
- retry/circuit policy benar;
- token/correlation/idempotency benar.

## 2.2 Mock server gives realism

Mock server menerima request HTTP sungguhan.

Ini menguji:

- JAX-RS provider;
- filters;
- serialization;
- URI encoding;
- timeout;
- connection failure;
- streaming behavior.

## 2.3 Top-tier rule

```text
Mock the remote service, not your HTTP client library.
```

---

# 3. Apa yang Harus Diuji pada JAX-RS Client?

## 3.1 Request contract

- method;
- path;
- query params;
- headers;
- cookies;
- body;
- content type;
- accept;
- idempotency key;
- conditional headers.

## 3.2 Response contract

- success status;
- body decoding;
- headers;
- no-body statuses;
- generics;
- binary/streaming;
- SSE events.

## 3.3 Error contract

- Problem Details;
- status mapping;
- retryable flag;
- downstream correlation ID;
- response processing failure.

## 3.4 Resilience

- timeout;
- retry;
- backoff;
- circuit breaker;
- bulkhead;
- rate limit;
- fallback.

## 3.5 Security

- Authorization header;
- token refresh;
- mTLS;
- secret redaction;
- TLS trust.

## 3.6 Observability

- metrics;
- traces;
- logs;
- correlation ID.

## 3.7 Rule

Test outbound client as a product integration boundary.

---

# 4. Test Pyramid untuk Outbound Client

## 4.1 Unit tests

Fast.

Use for:

- decoder logic;
- error mapping;
- retry classifier;
- DTO mapper;
- idempotency key generator;
- auth token provider logic.

## 4.2 Mock server integration tests

Most important.

Use for:

- HTTP request/response behavior;
- timeout/retry;
- serialization/deserialization;
- filters.

## 4.3 Contract tests

Use for:

- OpenAPI compatibility;
- consumer/provider expectations;
- external API schema.

## 4.4 E2E tests

Few.

Use for:

- real dependency in staging;
- auth infrastructure;
- TLS/gateway/network path.

## 4.5 Rule

Most client confidence comes from mock-server HTTP tests plus targeted unit tests.

---

# 5. Gateway/Adapter Pattern untuk Testability

Wrap outbound HTTP in gateway/adapter.

## 5.1 Interface

```java
public interface CustomerDirectory {
    CustomerSnapshot getCustomer(CustomerId id);
}
```

## 5.2 Implementation

```java
@ApplicationScoped
public class JaxRsCustomerDirectory implements CustomerDirectory {
    ...
}
```

## 5.3 Business service depends on interface

```java
public class OrderService {
    private final CustomerDirectory customerDirectory;
}
```

## 5.4 Test levels

- Business service unit test mocks `CustomerDirectory`.
- Gateway integration test uses mock HTTP server.
- Contract test verifies remote contract.

## 5.5 Rule

Business code should not know JAX-RS Client details.

---

# 6. Unit Test Client Decoder

Decoder maps `Response` to result/error.

## 6.1 Decoder shape

```java
public <T> T decode(Response response, Class<T> type) {
    int status = response.getStatus();

    if (status >= 200 && status < 300) {
        if (status == 204) {
            return null;
        }
        return response.readEntity(type);
    }

    ProblemDetails problem = problemDecoder.decode(response);
    throw exceptionFactory.from(status, problem);
}
```

## 6.2 Unit test

Use a real `Response` built in memory:

```java
Response response = Response.status(409)
    .type("application/problem+json")
    .entity(problem)
    .build();
```

## 6.3 What it proves

- status mapping;
- Problem Details handling;
- no-body handling;
- retryable classification.

## 6.4 Rule

Keep response decoding logic small and unit-testable.

---

# 7. Unit Test Request Builder Logic

Some request values can be tested without HTTP.

## 7.1 Examples

- idempotency key generation;
- query parameter object to map;
- cursor encoding;
- conditional header creation;
- media type selection.

## 7.2 Avoid over-mocking JAX-RS fluent chain

Instead extract pure functions.

```java
Map<String, List<String>> toQueryParams(SearchRequest request)
```

## 7.3 Rule

Pure request-building decisions should be unit tested as pure functions.

---

# 8. Kenapa Mocking `WebTarget` Biasanya Buruk

## 8.1 Fluent chain pain

```java
when(client.target(...)).thenReturn(target);
when(target.path(...)).thenReturn(target2);
when(target2.request(...)).thenReturn(builder);
```

Fragile and unreadable.

## 8.2 It misses real bugs

- wrong encoding;
- missing header;
- provider config;
- JSON serialization;
- response close;
- exception behavior.

## 8.3 When acceptable?

Only for very small adapter tests when no mock server available.

But prefer refactor.

## 8.4 Rule

Mocking `WebTarget` tests your mocking setup more than your HTTP client.

---

# 9. Mock HTTP Server Strategy

A mock server is local HTTP server controlled by test.

## 9.1 Test flow

```text
start mock server on random port
configure JAX-RS Client base URL = mock server URL
stub expected response
call gateway method
verify request
assert result/error
stop mock server
```

## 9.2 Benefits

- real network I/O;
- real serialization;
- real filters;
- real headers;
- failure simulation;
- request verification.

## 9.3 Rule

Use random ports and isolated server per test/class to avoid conflicts.

---

# 10. WireMock

WireMock is powerful HTTP mocking tool.

## 10.1 Good for

- request matching;
- stubbing responses;
- verifying requests;
- response templating;
- delays;
- faults;
- scenarios/stateful tests;
- record/replay;
- proxying;
- OpenAPI-related workflows.

## 10.2 Example concept

```java
wireMock.stubFor(get(urlPathEqualTo("/customers/C001"))
    .willReturn(okJson("""
        {"id":"C001","displayName":"Fajar","status":"ACTIVE"}
        """)));
```

## 10.3 Verify

```java
wireMock.verify(getRequestedFor(urlEqualTo("/customers/C001"))
    .withHeader("Accept", containing("application/json")));
```

## 10.4 Rule

WireMock is excellent for feature-rich outbound integration tests.

---

# 11. WireMock JUnit Jupiter Extension

WireMock provides JUnit Jupiter extension for JUnit 5 tests.

## 11.1 Declarative style concept

```java
@WireMockTest
class CustomerGatewayTest {
    ...
}
```

## 11.2 Programmatic style concept

```java
@RegisterExtension
static WireMockExtension wm = WireMockExtension.newInstance()
    .options(wireMockConfig().dynamicPort())
    .build();
```

## 11.3 Dynamic port

Use dynamic port to avoid collisions.

## 11.4 Rule

Use JUnit Jupiter extension to manage server lifecycle cleanly.

---

# 12. OkHttp MockWebServer

MockWebServer is a lightweight mock HTTP server from OkHttp ecosystem.

## 12.1 Good for

- simple request/response tests;
- verifying recorded requests;
- queueing responses;
- low ceremony tests.

## 12.2 Example concept

```java
MockWebServer server = new MockWebServer();
server.enqueue(new MockResponse()
    .setResponseCode(200)
    .setHeader("Content-Type", "application/json")
    .setBody("""
        {"id":"C001","displayName":"Fajar"}
        """));
```

## 12.3 Verify request

```java
RecordedRequest request = server.takeRequest();
assertEquals("GET", request.getMethod());
assertEquals("/customers/C001", request.getPath());
```

## 12.4 Rule

MockWebServer is great for focused HTTP client tests with minimal tooling.

---

# 13. Testcontainers WireMock

WireMock can also be provisioned as a container via Testcontainers modules/community support.

## 13.1 Use cases

- test same Dockerized mock in CI;
- simulate dependency as container;
- more production-like network boundary;
- shared integration environment.

## 13.2 Trade-off

Slower than in-process WireMock.

## 13.3 Rule

Use containerized WireMock when container/network realism matters.

---

# 14. Choosing WireMock vs MockWebServer

| Need | Better Fit |
|---|---|
| Simple queue response and inspect request | MockWebServer |
| Rich stubs and matchers | WireMock |
| Stateful scenarios | WireMock |
| Fault/delay simulation | Both, WireMock richer |
| OpenAPI stub workflows | WireMock ecosystem |
| Minimal dependencies | MockWebServer |
| Containerized mock service | Testcontainers WireMock |

## 14.1 Rule

Use the simplest mock server that can express your contract and failures.

---

# 15. Basic JAX-RS Client Integration Test

## 15.1 Gateway

```java
public class CustomerGateway {

    private final WebTarget base;

    public CustomerGateway(Client client, URI baseUri) {
        this.base = client.target(baseUri).path("customers");
    }

    public CustomerResponse getCustomer(String id) {
        try (Response response = base.path("{id}")
            .resolveTemplate("id", id)
            .request(MediaType.APPLICATION_JSON_TYPE)
            .get()) {
            return decode(response, CustomerResponse.class);
        }
    }
}
```

## 15.2 Test flow

```java
@Test
void getCustomerSendsCorrectRequestAndDecodesResponse() {
    mockServer.stubFor(get(urlEqualTo("/customers/C001"))
        .willReturn(okJson("""
            {"id":"C001","displayName":"Fajar","status":"ACTIVE"}
            """)));

    CustomerResponse response = gateway.getCustomer("C001");

    assertEquals("C001", response.id());

    mockServer.verify(getRequestedFor(urlEqualTo("/customers/C001"))
        .withHeader("Accept", containing("application/json")));
}
```

## 15.3 Rule

Test both the returned result and the outbound request.

---

# 16. Verifying Method, Path, Query, Headers, Body

## 16.1 Method

```text
GET /customers/C001
POST /customers
PATCH /customers/C001
```

## 16.2 Query

Verify repeated params:

```text
status=OPEN&status=PENDING
```

## 16.3 Headers

- Accept;
- Content-Type;
- Authorization;
- Correlation ID;
- Idempotency-Key;
- If-Match.

## 16.4 Body

Assert JSON body with semantic comparison, not raw string if formatting irrelevant.

## 16.5 Rule

Outbound request shape is your client-side contract.

---

# 17. Testing URI Encoding

Encoding bugs are common.

## 17.1 Path value with spaces/slashes

Input:

```text
customer id = "A/B C"
```

Expected path segment encoded, not interpreted as two segments.

## 17.2 Query value

Input:

```text
q = "a+b & c"
```

Should be encoded correctly.

## 17.3 Test

Mock server records actual path/query.

## 17.4 Rule

Test URI encoding for IDs/search values containing reserved characters.

---

# 18. Testing Content Negotiation

## 18.1 Accept header

Verify client sends:

```http
Accept: application/json
```

or vendor media type.

## 18.2 Content-Type

For body requests:

```http
Content-Type: application/json
```

## 18.3 Unsupported media response

Mock server returns 406/415 and verify mapping.

## 18.4 Rule

Client tests should verify media types, especially versioned/vendor media types.

---

# 19. Testing Request Entity Serialization

## 19.1 Test body

Given request DTO:

```java
new CreateCustomerRequest("Fajar", "fajar@example.com")
```

Verify JSON:

```json
{
  "displayName": "Fajar",
  "email": "fajar@example.com"
}
```

## 19.2 Watch for

- field naming;
- null policy;
- date format;
- enum values;
- BigDecimal precision.

## 19.3 Rule

Serialization tests catch provider/config mismatch.

---

# 20. Testing Response Deserialization

Mock response:

```json
{
  "id": "C001",
  "displayName": "Fajar",
  "status": "ACTIVE"
}
```

Assert DTO.

## 20.1 Unknown field

Test whether client ignores unknown fields if that is required for compatibility.

## 20.2 Invalid enum

Test unknown/invalid enum handling.

## 20.3 Date/time

Test exact format.

## 20.4 Rule

Response deserialization tests are compatibility tests.

---

# 21. Testing GenericType Responses

## 21.1 Client method

```java
public List<CustomerResponse> search(...) {
    try (Response response = request.get()) {
        return response.readEntity(new GenericType<List<CustomerResponse>>() {});
    }
}
```

## 21.2 Test

Mock JSON array.

Assert list element type.

## 21.3 Rule

Generic response decoding must be tested because raw `List.class` mistakes are common.

---

# 22. Testing `Response.close()` and Resource Management

Resource leak is hard to see in unit tests.

## 22.1 Pattern

Ensure client wrapper uses try-with-resources.

## 22.2 Test indirectly

- many repeated calls do not exhaust connections;
- mock server sees connections reused or closed appropriately;
- static analysis/code review;
- wrapper utility enforces close.

## 22.3 Large streams

Response must stay open while stream consumed, then close.

## 22.4 Rule

If method obtains `Response`, test/code-review that it closes it in all paths.

---

# 23. Testing Problem Details Decoder

## 23.1 Mock

```http
409 Conflict
Content-Type: application/problem+json
```

Body:

```json
{
  "type": "https://api.example.com/problems/conflict",
  "title": "Conflict",
  "status": 409,
  "code": "CUSTOMER_EMAIL_ALREADY_EXISTS",
  "correlationId": "downstream-123"
}
```

## 23.2 Assert

Client throws:

```java
DownstreamConflictException
```

with:

- status;
- code;
- downstream correlation ID;
- retryable false.

## 23.3 Non-problem body

Mock HTML/text error.

Client should produce fallback error safely.

## 23.4 Rule

Error decoder must handle both expected and unexpected error bodies.

---

# 24. Testing HTTP Status Mapping

Test exact statuses:

- 200;
- 201 with Location;
- 202 with operation link;
- 204 no body;
- 304 no body;
- 400 validation;
- 401/403 auth;
- 404 not found;
- 409 conflict;
- 412 precondition;
- 429 rate limit;
- 500/502/503/504.

## 24.1 Rule

Do not only test 200 and 500.

---

# 25. Testing ProcessingException and Network Failures

`ProcessingException` covers client-side processing/runtime failures.

## 25.1 Simulate

- connection refused by pointing to unused port;
- connection reset/fault from mock server;
- DNS failure using invalid host;
- TLS failure with self-signed/untrusted cert;
- timeout.

## 25.2 Assert classification

```text
DOWNSTREAM_UNREACHABLE
DOWNSTREAM_TIMEOUT
TLS_FAILURE
DNS_FAILURE
```

## 25.3 Rule

Transport failures should not be confused with HTTP 5xx responses.

---

# 26. Testing ResponseProcessingException

Response received but client fails processing.

## 26.1 Simulate malformed JSON

```http
200 OK
Content-Type: application/json

{ invalid json
```

## 26.2 Assert

Client throws/returns:

```text
DOWNSTREAM_INVALID_RESPONSE
```

not retry blindly unless policy says.

## 26.3 Unknown enum

Can produce deserialization failure.

## 26.4 Rule

Invalid downstream response is a contract/integration failure.

---

# 27. Testing Connect Timeout

Connect timeout is hard to test deterministically because OS/network behavior varies.

## 27.1 Options

- connect to unroutable IP with short timeout;
- use test proxy that accepts slowly;
- use integration/fault injection tool;
- test configuration value separately and one integration scenario.

## 27.2 Avoid flaky tests

DNS/connect behavior can vary in CI.

## 27.3 Rule

For connect timeout, prefer deterministic network simulation if available.

---

# 28. Testing Read Timeout / Slow Response

Mock server can delay response.

## 28.1 WireMock fixed delay

Stub response with delay longer than read timeout.

## 28.2 Assert

- timeout exception classified;
- retry policy invoked if eligible;
- total elapsed time bounded;
- response resources cleaned.

## 28.3 Slow body

For streaming, delay chunks/body to test read timeout behavior.

## 28.4 Rule

Read timeout tests should assert total duration upper bound.

---

# 29. Testing Retry Policy

## 29.1 Sequence

Mock responses:

```text
503
200
```

Assert:

- two requests sent;
- result success;
- retry metric incremented.

## 29.2 Non-retry

Mock:

```text
400
```

Assert one request only.

## 29.3 Unsafe method

POST without idempotency key should not retry.

## 29.4 Rule

Retry tests must verify number of attempts.

---

# 30. Testing Retry-After

## 30.1 Mock

```http
429 Too Many Requests
Retry-After: 1
```

## 30.2 Assert

- client respects or caps delay based on policy;
- if delay exceeds deadline, no retry;
- exception contains retry-after metadata.

## 30.3 Use fake scheduler/clock

Avoid sleeping in unit tests.

## 30.4 Rule

Retry-After tests need time control.

---

# 31. Testing Idempotency-Key

## 31.1 POST retry-safe

Client sends:

```http
Idempotency-Key: key-123
```

Mock first request timeout/503 then success.

Assert both attempts use same key.

## 31.2 Same key scope

Test key includes or is tied to operation/tenant/request.

## 31.3 No key

POST should not retry if policy requires key.

## 31.4 Rule

Idempotency must be observable in request verification.

---

# 32. Testing Circuit Breaker

## 32.1 Trigger open

Return 503 repeatedly until threshold.

## 32.2 Assert open

Next call should fail fast without mock server receiving request.

## 32.3 Half-open

Advance fake clock or wait controlled duration.

Return success.

Assert breaker closes.

## 32.4 Rule

Circuit breaker tests must verify calls are blocked, not only exception thrown.

---

# 33. Testing Bulkhead

## 33.1 Setup

Bulkhead max concurrency = 2.

## 33.2 Test

Start two slow calls, then third.

Assert third rejected quickly.

## 33.3 Verify

Mock server receives only two active requests if rejection before HTTP call.

## 33.4 Rule

Bulkhead tests need concurrency coordination with latches/barriers.

---

# 34. Testing Rate Limiter

## 34.1 Setup

Allow 2 requests per second.

## 34.2 Test

Make 3 immediate calls.

Assert third rejected or delayed per policy.

## 34.3 Use fake clock if possible

Avoid slow tests.

## 34.4 Rule

Rate limiter tests should control time.

---

# 35. Testing Fallback

## 35.1 Cache fallback

Downstream 503, cache has fresh value.

Assert fallback value returned and degraded flag/metric.

## 35.2 Stale fallback

Cache too old.

Assert error, not stale return.

## 35.3 Security fallback

Auth/permission dependency failure should fail closed.

## 35.4 Rule

Fallback tests must prove semantic safety.

---

# 36. Testing Auth Filter

## 36.1 Bearer token

Mock server verifies:

```http
Authorization: Bearer token
```

## 36.2 Missing token

TokenProvider error should prevent outbound call or map error.

## 36.3 Redaction

Logs/exception messages should not include token.

## 36.4 Rule

Auth filter tests should verify both header and secret safety.

---

# 37. Testing Token Refresh Single-Flight

## 37.1 Scenario

10 concurrent calls receive 401 expired token.

Client should refresh token once.

## 37.2 Assert

- refresh endpoint called once;
- all retries use new token;
- no token refresh stampede;
- if refresh fails, calls fail consistently.

## 37.3 Rule

Token refresh is concurrency-sensitive.

---

# 38. Testing Correlation/Tracing Headers

## 38.1 Correlation ID

Mock server verifies:

```http
X-Correlation-ID: test-correlation
```

## 38.2 Trace context

If using W3C Trace Context:

```http
traceparent: ...
```

## 38.3 Missing inbound

Client creates or receives correlation according to policy.

## 38.4 Rule

Outbound observability headers need tests.

---

# 39. Testing Client Request/Response Filters

## 39.1 Request filter

Test by real call to mock server.

Verify headers/properties.

## 39.2 Response filter

Mock downstream header:

```http
X-Downstream-Correlation-ID
```

Assert captured.

## 39.3 Body caveat

If response filter reads body, test body still readable by decoder.

## 39.4 Rule

Filter tests should run through real JAX-RS Client pipeline.

---

# 40. Testing Reader/Writer Interceptors

## 40.1 Writer interceptor

Use case:

- request compression;
- signing;
- hashing;
- encryption.

Mock server verifies transformed body/header.

## 40.2 Reader interceptor

Use case:

- response decompression;
- signature verification;
- body hash.

Mock server returns transformed body.

Client reads correct DTO.

## 40.3 Rule

Interceptors should be tested end-to-end with actual entity streams.

---

# 41. Testing TLS and mTLS

## 41.1 TLS trust

Run mock server with self-signed cert.

Test:

- default client rejects;
- configured truststore accepts.

## 41.2 Hostname verification

Test hostname mismatch if feasible.

Do not disable verification in production tests except explicitly verifying rejection.

## 41.3 mTLS

Mock server requires client cert.

Test:

- no client cert rejected;
- correct keystore accepted.

## 41.4 Rule

TLS config tests prevent insecure “works on my machine” shortcuts.

---

# 42. Testing Proxy Configuration

## 42.1 Proxy mock

Run proxy/mock that records requests.

## 42.2 Verify

- client routes through proxy;
- proxy auth header present if required;
- target URL semantics correct;
- sensitive headers not logged by your app.

## 42.3 Rule

Proxy behavior is integration/environment-specific; test if production depends on it.

---

# 43. Testing Streaming Download

## 43.1 Mock large body

Mock server streams large response.

Client writes to temp file.

## 43.2 Assert

- checksum matches;
- no `byte[]` buffering;
- response closed;
- partial failure handled;
- Content-Length/ETag read.

## 43.3 Client code

```java
try (Response response = target.request().get();
     InputStream input = response.readEntity(InputStream.class)) {
    Files.copy(input, destination);
}
```

## 43.4 Rule

Streaming download tests should not read whole body into memory in test assertion.

---

# 44. Testing Range Resume Download

## 44.1 Scenario

First download fails after N bytes.

Client retries:

```http
Range: bytes=N-
If-Range: "etag"
```

## 44.2 Mock verifies

- first response partial/connection close;
- second request has Range/If-Range;
- final file checksum correct.

## 44.3 Rule

Resume download retry must be tested with partial data.

---

# 45. Testing Upload / Multipart Client

## 45.1 Verify multipart request

Mock server receives:

- `Content-Type: multipart/form-data`;
- metadata part;
- file part;
- file media type;
- filename if required.

## 45.2 Large upload

Ensure client streams file, not `byte[]`.

## 45.3 Failure

Mock 413/415/422 and assert mapping.

## 45.4 Rule

Multipart client tests are both contract and resource tests.

---

# 46. Testing SSE Client

## 46.1 Use SseEventSource

Client connects to mock SSE endpoint.

Mock server sends:

```text
id: 1
event: case-updated
data: {"caseId":"C001"}

```

## 46.2 Test

- event received;
- JSON decoded;
- event ID captured;
- reconnect behavior;
- close stops receiving;
- error handler called.

## 46.3 Last-Event-ID

If client reconnects, verify header if implementation supports/contract requires.

## 46.4 Rule

SSE client tests must cover lifecycle and reconnect/resume.

---

# 47. Testing Async Client Invocation

## 47.1 Future

```java
Future<Response> future = target.request().async().get();
```

## 47.2 Test

- success completion;
- timeout/cancellation;
- exception from Future.get;
- callback success/failure.

## 47.3 Avoid sleeps

Use mock server delay and bounded await.

## 47.4 Rule

Async client tests need deterministic completion control.

---

# 48. Testing Reactive/CompletionStage Client

## 48.1 CompletionStage

```java
CompletionStage<CustomerResponse> stage =
    target.request().rx().get(CustomerResponse.class);
```

## 48.2 Test

- stage completes with value;
- stage completes exceptionally;
- cancellation if supported;
- executor/context behavior.

## 48.3 Rule

Reactive tests should assert both value and exceptional path.

---

# 49. Testing OpenAPI Contract

If downstream provides OpenAPI:

## 49.1 Request validation

Verify client sends request matching spec.

## 49.2 Response validation

Mock responses from examples and assert client can decode.

## 49.3 Generated fixtures

Use spec examples as test fixtures.

## 49.4 Diff

Detect downstream spec breaking changes.

## 49.5 Rule

OpenAPI should feed client tests and fixtures.

---

# 50. Consumer-Driven Contract Tests

Your service is consumer of downstream.

## 50.1 Define expectations

- request your client sends;
- response it needs;
- error cases it handles.

## 50.2 Provider verifies

Downstream provider runs contracts.

## 50.3 Rule

Consumer-driven contracts prevent provider changes that break your client.

---

# 51. Fault Injection Matrix

Create matrix:

| Failure | Expected Client Behavior |
|---|---|
| 200 valid JSON | return DTO |
| 200 malformed JSON | invalid response error |
| 204 | no body handling |
| 400 Problem | validation exception |
| 401 expired token | refresh once if policy |
| 403 | forbidden exception |
| 404 | not found / optional empty |
| 409 | conflict |
| 412 | stale version |
| 429 Retry-After | retry/delay or fail with metadata |
| 500 | retry if policy |
| 503 | retry/circuit |
| connect refused | retry/fail transport |
| read timeout | retry if safe |
| connection reset mid-body | stream failure/resume if supported |
| slow response | timeout |
| TLS failure | security config error |
| invalid cert | fail closed |

## 51.1 Rule

Fault matrix turns resilience requirements into tests.

---

# 52. Deterministic Time, Clock, and Scheduler

Resilience tests often involve time.

## 52.1 Inject clock

```java
Clock fixedClock
```

## 52.2 Inject scheduler

For retry/backoff/circuit breaker if custom.

## 52.3 Library support

Use library testing hooks if available.

## 52.4 Rule

Avoid real sleeps for retry/circuit tests where possible.

---

# 53. Test Data and Fixtures

## 53.1 JSON fixtures

Store valid/invalid response examples.

## 53.2 Contract examples

Reuse OpenAPI examples.

## 53.3 Builders

Generate DTOs for request bodies.

## 53.4 Rule

Fixtures should be realistic and versioned with contract.

---

# 54. CI Strategy

## 54.1 Fast tests

- decoder unit tests;
- classifier tests;
- request pure function tests.

## 54.2 Integration tests

- mock server tests;
- serialization;
- retry/timeout;
- streaming.

## 54.3 Slow tests

- TLS/mTLS;
- containerized mock services;
- chaos/fault injection.

## 54.4 Rule

Run core client tests on every PR; run heavier network/TLS tests on PR or nightly depending cost.

---

# 55. Observability Tests

Test:

- metrics count attempts/retries/failures;
- timer records duration;
- circuit state metric changes;
- trace headers sent;
- logs redact secrets;
- downstream correlation ID captured.

## 55.1 Rule

Outbound observability is part of integration correctness.

---

# 56. Common Failure Modes

## 56.1 Mocking fluent JAX-RS chain

Brittle and misses protocol bugs.

## 56.2 No timeout tests

Production hangs.

## 56.3 Only 200 tested

Error mapping broken.

## 56.4 No request verification

Client may send wrong header/body silently.

## 56.5 Retry tested by return value only

Number of attempts not verified.

## 56.6 Token refresh not concurrency tested

Refresh stampede.

## 56.7 Streaming test buffers whole body

False confidence.

## 56.8 Problem Details parser assumes JSON always

HTML/text error breaks.

## 56.9 Tests use real external API

Flaky and slow.

## 56.10 TLS validation disabled in tests

Security bug hidden.

## 56.11 Response not closed

Connection leak under load.

## 56.12 No contract tests

Provider changes break client.

---

# 57. Best Practices

## 57.1 Wrap JAX-RS Client in gateway

Business code depends on interface.

## 57.2 Use mock HTTP server

Verify real HTTP request/response.

## 57.3 Test failure matrix

Not only happy path.

## 57.4 Verify attempts

Retry/circuit tests must verify calls made or blocked.

## 57.5 Use deterministic time

Avoid sleep-heavy tests.

## 57.6 Test serialization/deserialization

Provider config matters.

## 57.7 Test resource management

Response close, streaming close.

## 57.8 Redact secrets in logs

Test it.

## 57.9 Use contract fixtures

OpenAPI/provider examples.

## 57.10 Keep tests isolated

Dynamic ports, no shared mutable mock state.

---

# 58. Anti-Patterns

## 58.1 Mock `Client`, `WebTarget`, `Invocation.Builder`

Usually wrong level.

## 58.2 Call real third-party API in unit test

Flaky, slow, unsafe.

## 58.3 Ignore headers

Many integrations depend on headers.

## 58.4 Use Thread.sleep for all retry tests

Slow/flaky.

## 58.5 Retry POST tests without idempotency verification

Danger.

## 58.6 Assert raw JSON string ordering

Brittle.

## 58.7 Use production credentials in tests

Security incident waiting.

## 58.8 Test with admin token only

Authorization integration missed.

## 58.9 Suppress TLS validation to make tests pass

Bad habit.

## 58.10 No cleanup of Client/Response/mock server

Resource leak.

---

# 59. Production Checklist

## 59.1 Design/testability

- [ ] Outbound gateway interface exists.
- [ ] Business service mocks gateway, not JAX-RS internals.
- [ ] Gateway tests use mock HTTP server.
- [ ] Client base URL configurable.
- [ ] Client lifecycle controlled/closed.

## 59.2 Request/response

- [ ] Method/path/query verified.
- [ ] Headers verified.
- [ ] Content-Type/Accept verified.
- [ ] Request body verified semantically.
- [ ] Response body decoded.
- [ ] GenericType tested.
- [ ] No-body statuses tested.
- [ ] Response close discipline reviewed/tested.

## 59.3 Errors/resilience

- [ ] Problem Details decoded.
- [ ] Non-problem error handled.
- [ ] HTTP statuses mapped.
- [ ] ProcessingException classified.
- [ ] ResponseProcessingException tested.
- [ ] Timeout tested.
- [ ] Retry attempts verified.
- [ ] Retry-After tested.
- [ ] Idempotency-Key tested.
- [ ] Circuit/bulkhead/rate/fallback tested.

## 59.4 Security/observability

- [ ] Auth header/filter tested.
- [ ] Token refresh tested.
- [ ] Correlation/trace headers tested.
- [ ] Secret redaction tested.
- [ ] TLS/mTLS tested if used.
- [ ] Metrics/logging/tracing tested where required.

## 59.5 Advanced

- [ ] Streaming download tested.
- [ ] Range resume tested if supported.
- [ ] Multipart upload tested.
- [ ] SSE client lifecycle tested.
- [ ] Async/reactive client tested.
- [ ] OpenAPI/consumer contracts tested.
- [ ] Fault matrix implemented.

---

# 60. Latihan

## Latihan 1 — Replace Fluent Mock with Mock Server

Ambil test yang mock `WebTarget`.

Refactor menjadi WireMock/MockWebServer test.

Verify method/path/header/body.

## Latihan 2 — Problem Details Decoder

Mock:

```http
409 application/problem+json
```

Assert `DownstreamConflictException`.

Mock HTML 500.

Assert fallback downstream error.

## Latihan 3 — Timeout Test

Configure read timeout 300ms.

Mock server delays 1s.

Assert timeout classified and total duration bounded.

## Latihan 4 — Retry Attempts

Mock sequence:

```text
503, 503, 200
```

Policy maxRetries=2.

Assert exactly 3 requests.

## Latihan 5 — POST Idempotency

For POST `/exports`, policy retries only if idempotency key exists.

Assert retry attempts use same key.

## Latihan 6 — Circuit Breaker

After failure threshold, next call fails fast.

Verify mock server did not receive request while open.

## Latihan 7 — Token Refresh Single-Flight

10 concurrent calls get 401.

Only one refresh call.

All retries use new token.

## Latihan 8 — Streaming Download

Mock 100MB response.

Client streams to temp file.

Assert checksum and no byte-array buffering in client code.

## Latihan 9 — SSE Client

Mock SSE stream with three events and heartbeat.

Client receives events, closes source, and cleanup happens.

---

# 61. Referensi Resmi

Referensi utama:

1. Jakarta EE Tutorial — Accessing REST Resources with the Jakarta REST Client API  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/websvcs/rest-client/rest-client.html

2. Jakarta RESTful Web Services 4.0 — Client API Package  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/client/package-summary

3. Jakarta RESTful Web Services 4.0 — `Client` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/client/client

4. Jakarta RESTful Web Services 4.0 — `Response` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/response

5. WireMock — JUnit 5+ Jupiter  
   https://wiremock.org/docs/junit-jupiter/

6. WireMock and Testcontainers  
   https://wiremock.org/docs/solutions/testcontainers/

7. OkHttp MockWebServer JUnit 5 README  
   https://github.com/square/okhttp/blob/master/mockwebserver-junit5/README.md

8. Testcontainers Java Documentation  
   https://java.testcontainers.org/

9. OpenAPI Specification 3.2.0  
   https://spec.openapis.org/oas/v3.2.0.html

---

# 62. Penutup

Testing JAX-RS Client yang kuat berarti menguji outbound HTTP contract dan failure behavior secara nyata.

Mental model final:

```text
Business service tests:
  mock outbound gateway interface

Gateway tests:
  use real JAX-RS Client + mock HTTP server

Contract tests:
  verify against OpenAPI/provider expectations

Resilience tests:
  inject timeout, 429, 503, reset, malformed body, slow stream

Security/observability tests:
  verify auth, correlation, redaction, metrics
```

Prinsip final:

```text
Mock the remote HTTP service, not the JAX-RS fluent chain.
Verify requests, not just responses.
Test failures, not just 200.
Retry tests must count attempts.
Streaming tests must stream.
Token refresh tests must be concurrent.
Contracts must be executable.
```

Top-tier JAX-RS engineer memastikan:

- outbound gateway punya test boundary jelas;
- mock server dipakai untuk integration tests;
- request shape diverifikasi;
- status/error/Problem Details mapping diuji;
- timeout/retry/circuit/bulkhead/idempotency diuji;
- auth/correlation/tracing headers diuji;
- streaming/upload/SSE diuji dengan lifecycle;
- OpenAPI/consumer contract menjaga compatibility;
- CI menjalankan fast unit tests dan mock-server integration tests secara konsisten.

Part berikutnya:

```text
Bagian 037 — Implementation Deep Dive: Jersey, RESTEasy, Apache CXF, Open Liberty
```

Kita akan membahas perbedaan implementasi JAX-RS/Jakarta REST: provider discovery, CDI integration, client connector, multipart, SSE, async, config, testing tools, performance knobs, and migration/runtime selection.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-jaxrs-advanced-part-035.md">⬅️ Bagian 035 — Testing JAX-RS Server: Unit Test, Integration Test, Runtime Pipeline, Filters, Providers, Exception Mappers, Validation, Security, Async, Streaming, Multipart, Contract Tests, and Production-Grade Test Strategy</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-jaxrs-advanced-part-037.md">Bagian 037 — Implementation Deep Dive: Jersey, RESTEasy, Apache CXF, Open Liberty, Quarkus REST, Provider Discovery, CDI Integration, Client Connector, Multipart, SSE, Async, Testing Tools, Performance Knobs, and Migration Strategy ➡️</a>
</div>
