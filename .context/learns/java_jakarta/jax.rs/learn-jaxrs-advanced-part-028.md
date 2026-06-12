# learn-jaxrs-advanced-part-028.md

# Bagian 028 — JAX-RS Client API: Mental Model and Core Usage: `Client`, `ClientBuilder`, `WebTarget`, `Invocation.Builder`, `Entity`, `Response`, Headers, Cookies, Timeouts, Providers, and Safe Resource Management

> Target pembaca: Java/Jakarta engineer yang ingin menguasai **Jakarta REST / JAX-RS Client API** secara production-grade. Fokus bagian ini bukan hanya “cara GET/POST”, tetapi mental model client-side HTTP: lifecycle `Client`, target derivation, URI template, request builder, content negotiation, request entity, response entity consumption, resource closing, timeout, TLS, headers/cookies, provider registration, error handling, observability, dan kapan lebih baik memakai MicroProfile Rest Client / generated client / raw HTTP client.
>
> Namespace utama: `jakarta.ws.rs.client.Client`, `ClientBuilder`, `WebTarget`, `Invocation`, `Invocation.Builder`, `Entity`, `Response`, `GenericType`, `ProcessingException`, `ResponseProcessingException`, `ClientRequestFilter`, `ClientResponseFilter`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: JAX-RS Client adalah HTTP Client dengan REST Abstractions](#2-mental-model-jax-rs-client-adalah-http-client-dengan-rest-abstractions)
3. [Client API Object Model](#3-client-api-object-model)
4. [`ClientBuilder`: Bootstrap dan Configuration](#4-clientbuilder-bootstrap-dan-configuration)
5. [`Client`: Heavy-Weight Root Object](#5-client-heavy-weight-root-object)
6. [Client Lifecycle: Create Few, Reuse, Close](#6-client-lifecycle-create-few-reuse-close)
7. [Dependency: API vs Implementation](#7-dependency-api-vs-implementation)
8. [`WebTarget`: Immutable Resource Target](#8-webtarget-immutable-resource-target)
9. [Path Construction](#9-path-construction)
10. [URI Template Resolution](#10-uri-template-resolution)
11. [Query Parameters](#11-query-parameters)
12. [`Invocation.Builder`: Request Builder](#12-invocationbuilder-request-builder)
13. [Accept Header and Content Negotiation](#13-accept-header-and-content-negotiation)
14. [Headers, Cookies, Cache-Control, and Conditional Headers](#14-headers-cookies-cache-control-and-conditional-headers)
15. [Synchronous GET](#15-synchronous-get)
16. [Reading Entity Directly vs Reading `Response`](#16-reading-entity-directly-vs-reading-response)
17. [`Response` Lifecycle and `close()`](#17-response-lifecycle-and-close)
18. [`readEntity(...)`, `bufferEntity()`, and Entity Consumption](#18-readentity-bufferentity-and-entity-consumption)
19. [Generic Types with `GenericType<T>`](#19-generic-types-with-generictypet)
20. [POST/PUT/PATCH with `Entity<T>`](#20-postputpatch-with-entityt)
21. [DELETE, HEAD, OPTIONS](#21-delete-head-options)
22. [Error Handling Strategy](#22-error-handling-strategy)
23. [Problem Details Client Decoder](#23-problem-details-client-decoder)
24. [ProcessingException vs ResponseProcessingException](#24-processingexception-vs-responseprocessingexception)
25. [Timeouts: Connect Timeout and Read Timeout](#25-timeouts-connect-timeout-and-read-timeout)
26. [Retry, Idempotency, and Safe Methods](#26-retry-idempotency-and-safe-methods)
27. [TLS, TrustStore, KeyStore, HostnameVerifier](#27-tls-truststore-keystore-hostnameverifier)
28. [Provider Registration](#28-provider-registration)
29. [JSON Provider: JSON-B/Jackson/JSON-P](#29-json-provider-json-bjacksonjson-p)
30. [Client Request/Response Filters](#30-client-requestresponse-filters)
31. [Correlation ID and Authentication Filters](#31-correlation-id-and-authentication-filters)
32. [Client-Side DTO Boundary](#32-client-side-dto-boundary)
33. [Streaming Downloads](#33-streaming-downloads)
34. [Uploads with Client API](#34-uploads-with-client-api)
35. [Thread Safety and Sharing](#35-thread-safety-and-sharing)
36. [Configuration Scope: Client vs WebTarget vs Request](#36-configuration-scope-client-vs-webtarget-vs-request)
37. [JAX-RS Client vs MicroProfile Rest Client vs Generated Client vs Raw HTTP Client](#37-jax-rs-client-vs-microprofile-rest-client-vs-generated-client-vs-raw-http-client)
38. [Testing JAX-RS Client Code](#38-testing-jax-rs-client-code)
39. [Observability](#39-observability)
40. [Runtime Differences](#40-runtime-differences)
41. [Common Failure Modes](#41-common-failure-modes)
42. [Best Practices](#42-best-practices)
43. [Anti-Patterns](#43-anti-patterns)
44. [Production Checklist](#44-production-checklist)
45. [Latihan](#45-latihan)
46. [Referensi Resmi](#46-referensi-resmi)
47. [Penutup](#47-penutup)

---

# 1. Tujuan Part Ini

Sejauh ini kita banyak membahas sisi server JAX-RS:

```text
resource method
request matching
entity providers
filters/interceptors
security
streaming
multipart
```

Sekarang kita pindah ke sisi client. Client API dipakai ketika service Java perlu memanggil HTTP endpoint lain:

```java
Client client = ClientBuilder.newClient();

CustomerResponse customer = client
    .target("https://api.example.com")
    .path("customers")
    .path("{id}")
    .resolveTemplate("id", "C001")
    .request(MediaType.APPLICATION_JSON_TYPE)
    .get(CustomerResponse.class);
```

Ini terlihat mudah, tetapi production client-side integration sering gagal karena:

- membuat `Client` baru per request;
- lupa close `Response`;
- tidak set timeout;
- retry unsafe method;
- membaca response body dua kali tanpa buffering;
- menganggap semua 2xx punya body;
- tidak menangani Problem Details;
- tidak propagate correlation ID;
- logging Authorization header;
- provider JSON tidak sama antara client/server;
- TLS/truststore salah;
- connection pool leak;
- tidak test failure/timeout;
- menggunakan low-level client padahal butuh typed contract;
- menggunakan typed client padahal butuh streaming control.

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- memahami object model JAX-RS Client API;
- membuat dan mengelola lifecycle `Client`;
- membangun URI aman dengan `WebTarget`;
- membuat request dengan `Invocation.Builder`;
- mengirim entity dengan `Entity<T>`;
- membaca response dengan benar;
- menutup `Response`;
- menangani error, timeout, retry, dan TLS;
- mendaftarkan provider/filter;
- membuat wrapper client yang production-safe;
- menghindari resource leak.

## 1.2 Prinsip utama

```text
JAX-RS Client is not just a convenience wrapper.
It is your outbound HTTP boundary.
```

---

# 2. Mental Model: JAX-RS Client adalah HTTP Client dengan REST Abstractions

JAX-RS Client API memberi fluent Java API untuk mengakses Web resources. Ia tidak terbatas untuk memanggil server yang dibangun dengan JAX-RS; ia adalah client untuk HTTP/Web resources secara umum.

Mental model:

```text
Client
  ↓ creates
WebTarget
  ↓ creates
Invocation.Builder
  ↓ builds/submits
HTTP request
  ↓ returns
Response or typed entity
```

## 2.1 Higher-level than raw HTTP

Client API menyediakan:

- URI target building;
- URI template resolution;
- query parameter handling;
- entity provider integration;
- request/response filters;
- content negotiation;
- sync/async invocation;
- `Response` abstraction;
- typed entity mapping.

## 2.2 Still HTTP

Semua prinsip HTTP tetap berlaku:

- method semantics;
- status codes;
- headers;
- media types;
- caching;
- timeouts;
- TLS;
- retries;
- idempotency.

## 2.3 Top-tier rule

```text
Model outbound calls as contracts, not as random HTTP helper calls.
```

---

# 3. Client API Object Model

## 3.1 `ClientBuilder`

Bootstraps `Client`.

```java
Client client = ClientBuilder.newBuilder()
    .connectTimeout(2, TimeUnit.SECONDS)
    .readTimeout(5, TimeUnit.SECONDS)
    .build();
```

## 3.2 `Client`

Root object managing communication infrastructure.

```java
WebTarget target = client.target(baseUri);
```

## 3.3 `WebTarget`

Represents a resource URI or URI template.

```java
WebTarget customerTarget = client
    .target(baseUri)
    .path("customers")
    .path("{id}");
```

## 3.4 `Invocation.Builder`

Represents request configuration.

```java
Invocation.Builder request = customerTarget
    .resolveTemplate("id", "C001")
    .request(MediaType.APPLICATION_JSON_TYPE);
```

## 3.5 `Invocation`

Prepared request.

```java
Invocation invocation = request.buildGet();
Response response = invocation.invoke();
```

## 3.6 `Response`

HTTP response metadata + entity stream.

## 3.7 `Entity<T>`

Request entity plus media type/variant.

```java
Entity.json(requestDto)
```

## 3.8 Rule

```text
ClientBuilder configures.
Client owns infrastructure.
WebTarget owns URI.
Invocation.Builder owns request metadata.
Entity owns outbound body metadata.
Response owns inbound status/headers/body stream.
```

---

# 4. `ClientBuilder`: Bootstrap dan Configuration

`ClientBuilder` adalah entry point utama untuk membuat `Client`.

## 4.1 Simple

```java
Client client = ClientBuilder.newClient();
```

## 4.2 Configured

```java
Client client = ClientBuilder.newBuilder()
    .connectTimeout(2, TimeUnit.SECONDS)
    .readTimeout(5, TimeUnit.SECONDS)
    .register(MyJsonProvider.class)
    .register(CorrelationIdFilter.class)
    .build();
```

## 4.3 TLS

```java
Client client = ClientBuilder.newBuilder()
    .trustStore(trustStore)
    .keyStore(keyStore, keyPassword)
    .build();
```

## 4.4 Executors for async

```java
Client client = ClientBuilder.newBuilder()
    .executorService(executor)
    .scheduledExecutorService(scheduler)
    .build();
```

## 4.5 Rule

```text
Centralize client construction. Do not scatter ClientBuilder.newClient() across business code.
```

---

# 5. `Client`: Heavy-Weight Root Object

`Client` mengelola infrastruktur komunikasi client-side. Dalam implementasi nyata, ini bisa mencakup:

- connection pools;
- TLS configuration;
- providers;
- filters;
- executors;
- connector-specific resources.

## 5.1 Expensive lifecycle

Membuat dan membuang `Client` bisa mahal. `Client` sebaiknya dibuat dalam jumlah kecil dan dipakai ulang.

## 5.2 Close

```java
client.close();
```

Close saat aplikasi shutdown.

## 5.3 Do not close per request

Bad:

```java
try (Client client = ClientBuilder.newClient()) {
    return client.target(url).request().get(String.class);
}
```

Ini menghilangkan connection reuse dan menambah overhead.

## 5.4 Rule

```text
Client is like a connection-pool owner: reuse it and close it when the application stops.
```

---

# 6. Client Lifecycle: Create Few, Reuse, Close

## 6.1 Application scoped client

```java
@ApplicationScoped
public class DownstreamClients {

    private Client client;

    @PostConstruct
    void init() {
        client = ClientBuilder.newBuilder()
            .connectTimeout(2, TimeUnit.SECONDS)
            .readTimeout(5, TimeUnit.SECONDS)
            .register(CorrelationIdFilter.class)
            .register(ProblemDetailsReader.class)
            .build();
    }

    @PreDestroy
    void shutdown() {
        if (client != null) {
            client.close();
        }
    }

    public Client client() {
        return client;
    }
}
```

## 6.2 Per downstream service

Buat konfigurasi berbeda jika service berbeda membutuhkan:

- base URL berbeda;
- timeout berbeda;
- TLS berbeda;
- auth berbeda;
- provider berbeda;
- resilience policy berbeda.

## 6.3 Rule

```text
Create clients by outbound integration boundary, not by method call.
```

---

# 7. Dependency: API vs Implementation

`jakarta.ws.rs-api` menyediakan API, tetapi Java SE application tetap butuh implementation.

## 7.1 API dependency

```xml
<dependency>
  <groupId>jakarta.ws.rs</groupId>
  <artifactId>jakarta.ws.rs-api</artifactId>
  <version>4.0.0</version>
</dependency>
```

## 7.2 Implementation dependency examples

- Jersey Client;
- RESTEasy Client;
- Apache CXF client;
- Jakarta EE/Open Liberty provided feature.

## 7.3 Common error

```text
Provider for jakarta.ws.rs.client.ClientBuilder cannot be found
```

Biasanya ini berarti hanya API dependency yang tersedia, bukan implementation provider.

## 7.4 Rule

```text
In Java SE, include a JAX-RS client implementation. In Jakarta EE, verify runtime-provided feature.
```

---

# 8. `WebTarget`: Immutable Resource Target

`WebTarget` merepresentasikan URI atau URI template.

## 8.1 Create base target

```java
WebTarget api = client.target("https://api.example.com");
```

## 8.2 Derive child target

```java
WebTarget customers = api.path("customers");
WebTarget customerById = customers.path("{id}");
```

## 8.3 Derivation creates new target

Methods seperti `path`, `queryParam`, dan `resolveTemplate` menghasilkan target baru. Parent target dapat dipakai ulang sebagai base.

## 8.4 Good pattern

```java
@ApplicationScoped
public class CustomerHttpClient {
    private final WebTarget customers;

    public CustomerHttpClient(Client client, URI baseUri) {
        this.customers = client.target(baseUri).path("customers");
    }

    public CustomerResponse get(CustomerId id) {
        return customers.path("{id}")
            .resolveTemplate("id", id.value())
            .request(MediaType.APPLICATION_JSON_TYPE)
            .get(CustomerResponse.class);
    }
}
```

## 8.5 Rule

```text
Share base WebTarget; derive concrete target per request.
```

---

# 9. Path Construction

## 9.1 Good

```java
WebTarget target = client.target(baseUri)
    .path("tenants")
    .path("{tenantId}")
    .path("customers")
    .path("{customerId}");
```

## 9.2 Avoid raw concatenation

Bad:

```java
String url = baseUri + "/tenants/" + tenantId + "/customers/" + customerId;
```

Problems:

- encoding;
- slashes;
- path traversal-like confusion;
- duplicate separators;
- query injection;
- hard-to-test string handling.

## 9.3 Rule

```text
Use path builders and URI templates for path variables.
```

---

# 10. URI Template Resolution

## 10.1 Template

```java
WebTarget target = client.target(baseUri)
    .path("customers")
    .path("{customerId}");
```

## 10.2 Resolve

```java
WebTarget concrete = target.resolveTemplate("customerId", "C001");
```

## 10.3 Multiple templates

```java
target.resolveTemplates(Map.of(
    "tenantId", tenantId.value(),
    "customerId", customerId.value()
));
```

## 10.4 Encoding

Template resolution handles URI encoding according to API method semantics. Prefer default resolve methods unless you intentionally provide already-encoded values.

## 10.5 Rule

```text
Do not inject raw user input into URI strings.
```

---

# 11. Query Parameters

## 11.1 Add query param

```java
WebTarget target = client.target(baseUri)
    .path("customers")
    .queryParam("status", "active")
    .queryParam("limit", 20);
```

## 11.2 Multiple values

```java
target.queryParam("status", "open", "pending");
```

This produces repeated query parameters.

## 11.3 Null removal

The API defines behavior where a single `null` value removes inherited query params with that name.

## 11.4 Avoid manual encoding

Bad:

```java
client.target(baseUri + "/search?q=" + URLEncoder.encode(q, UTF_8));
```

Use:

```java
client.target(baseUri)
    .path("search")
    .queryParam("q", q);
```

## 11.5 Rule

```text
Use queryParam for query parameters and let the API handle encoding.
```

---

# 12. `Invocation.Builder`: Request Builder

`Invocation.Builder` diperoleh dari `WebTarget.request(...)`.

## 12.1 Example

```java
Invocation.Builder request = target
    .request(MediaType.APPLICATION_JSON_TYPE)
    .header("X-Correlation-ID", correlationId)
    .acceptLanguage(Locale.ENGLISH);
```

## 12.2 Responsibilities

- Accept headers;
- request headers;
- cookies;
- cache control;
- per-request properties;
- build/submit invocation.

## 12.3 Submit directly

```java
CustomerResponse customer = request.get(CustomerResponse.class);
```

## 12.4 Build invocation

```java
Invocation invocation = request.buildGet();
Response response = invocation.invoke();
```

## 12.5 Rule

```text
WebTarget is URI. Invocation.Builder is request metadata and execution.
```

---

# 13. Accept Header and Content Negotiation

## 13.1 Accept JSON

```java
CustomerResponse customer = target
    .request(MediaType.APPLICATION_JSON_TYPE)
    .get(CustomerResponse.class);
```

## 13.2 Multiple accepted types

```java
target.request()
    .accept(MediaType.APPLICATION_JSON_TYPE, MediaType.APPLICATION_XML_TYPE)
    .get();
```

## 13.3 Language

```java
request.acceptLanguage(Locale.forLanguageTag("id-ID"));
```

## 13.4 Encoding

```java
request.acceptEncoding("gzip");
```

Implementation/connector behavior for compression/decompression should be tested.

## 13.5 Rule

```text
Client should explicitly declare the representation it expects.
```

---

# 14. Headers, Cookies, Cache-Control, and Conditional Headers

## 14.1 Add header

```java
request.header("X-Correlation-ID", correlationId);
```

## 14.2 Replace all headers

```java
request.headers(headers);
```

Be careful: this replaces existing headers.

## 14.3 Cookies

```java
request.cookie("session", sessionValue);
request.cookie(new Cookie("tenant", tenantId));
```

JAX-RS client cookies are not browser cookies; there is no browser SameSite/CORS enforcement here.

## 14.4 Cache-Control

```java
CacheControl cc = new CacheControl();
cc.setNoCache(true);
request.cacheControl(cc);
```

## 14.5 Conditional headers

```java
request.header(HttpHeaders.IF_MATCH, etag);
request.header(HttpHeaders.IF_NONE_MATCH, etag);
```

## 14.6 Common outbound headers

```text
Authorization
X-Correlation-ID
Idempotency-Key
If-Match
If-None-Match
Accept-Language
User-Agent
```

## 14.7 Rule

```text
Headers are part of outbound contract and security boundary.
```

---

# 15. Synchronous GET

## 15.1 Typed direct GET

```java
CustomerResponse customer = target
    .request(MediaType.APPLICATION_JSON_TYPE)
    .get(CustomerResponse.class);
```

Pros:

- concise;
- useful for simple success path.

Cons:

- less control over status/header/error body;
- not ideal for Problem Details decoding;
- less explicit resource management.

## 15.2 Response GET

```java
try (Response response = target.request().get()) {
    if (response.getStatus() == 200) {
        return response.readEntity(CustomerResponse.class);
    }
    throw mapError(response);
}
```

Pros:

- full HTTP control;
- inspect status;
- inspect headers;
- decode error contract;
- support no-body statuses.

## 15.3 Rule

```text
Use typed direct methods for simple calls; use Response for production boundary logic.
```

---

# 16. Reading Entity Directly vs Reading `Response`

## 16.1 Direct entity

```java
CustomerResponse customer = request.get(CustomerResponse.class);
```

## 16.2 Response entity

```java
try (Response response = request.get()) {
    return decode(response, CustomerResponse.class);
}
```

## 16.3 Production pattern

Wrap response decode in a client adapter:

```java
public CustomerResponse getCustomer(CustomerId id) {
    try (Response response = customerTarget(id).request(JSON).get()) {
        return decoder.decode(response, CustomerResponse.class);
    }
}
```

## 16.4 Rule

```text
Outbound integration code should own status/header/body decoding explicitly.
```

---

# 17. `Response` Lifecycle and `close()`

`Response` may hold an underlying entity input stream. If you do not consume or close it, resources can leak.

## 17.1 Try-with-resources

```java
try (Response response = target.request().get()) {
    return response.readEntity(CustomerResponse.class);
}
```

## 17.2 If no body needed

```java
try (Response response = target.request().delete()) {
    if (response.getStatus() == 204) {
        return;
    }
    throw mapError(response);
}
```

## 17.3 Direct typed methods

When using `get(Class<T>)`, response handling is managed by runtime.

## 17.4 Rule

```text
If you obtain Response, close it.
```

---

# 18. `readEntity(...)`, `bufferEntity()`, and Entity Consumption

## 18.1 Read as class

```java
CustomerResponse customer = response.readEntity(CustomerResponse.class);
```

## 18.2 Read as `InputStream`

```java
InputStream in = response.readEntity(InputStream.class);
```

If reading stream manually, close response and stream appropriately.

## 18.3 Entity can be consumed once

Unless buffered, the response entity stream cannot be read repeatedly.

## 18.4 `bufferEntity()`

```java
response.bufferEntity();
String raw = response.readEntity(String.class);
ProblemDetails problem = response.readEntity(ProblemDetails.class);
```

This reads the full entity stream into memory.

## 18.5 Use carefully

Good for small error responses. Bad for large downloads.

## 18.6 Zero-length body

Handle status codes like `204`, `205`, and `304` explicitly before attempting to map entity.

## 18.7 Rule

```text
Read entity once, or buffer only small bounded response bodies.
```

---

# 19. Generic Types with `GenericType<T>`

Java erases generic type information at runtime.

## 19.1 Bad

```java
List<CustomerResponse> list = response.readEntity(List.class);
```

Depending JSON provider, you may get raw maps rather than typed DTOs.

## 19.2 Good

```java
List<CustomerResponse> customers = response.readEntity(
    new GenericType<List<CustomerResponse>>() {}
);
```

## 19.3 Page response

```java
Page<CustomerResponse> page = response.readEntity(
    new GenericType<Page<CustomerResponse>>() {}
);
```

## 19.4 Rule

```text
Use GenericType for generic response bodies.
```

---

# 20. POST/PUT/PATCH with `Entity<T>`

`Entity<T>` wraps request body and media type/variant.

## 20.1 POST JSON

```java
CreateCustomerRequest body = new CreateCustomerRequest(...);

try (Response response = target
    .request(MediaType.APPLICATION_JSON_TYPE)
    .post(Entity.json(body))) {
    return decode(response, CustomerResponse.class);
}
```

## 20.2 PUT JSON

```java
try (Response response = target
    .request(MediaType.APPLICATION_JSON_TYPE)
    .put(Entity.entity(body, MediaType.APPLICATION_JSON_TYPE))) {
    return decode(response, CustomerResponse.class);
}
```

## 20.3 PATCH merge patch

```java
JsonObject patch = Json.createObjectBuilder()
    .add("displayName", "New Name")
    .build();

try (Response response = target
    .request(MediaType.APPLICATION_JSON_TYPE)
    .header(HttpHeaders.IF_MATCH, etag)
    .method("PATCH", Entity.entity(patch, "application/merge-patch+json"))) {
    return decode(response, CustomerResponse.class);
}
```

## 20.4 Entity helpers

```java
Entity.json(dto)
Entity.text("hello")
Entity.xml(dto)
Entity.entity(dto, MediaType.APPLICATION_JSON_TYPE)
```

## 20.5 Custom media types

Use explicit media type:

```java
Entity.entity(patch, "application/json-patch+json")
Entity.entity(command, "application/vnd.example.command+json")
```

## 20.6 Rule

```text
Request entity must declare the exact content type expected by the server contract.
```

---

# 21. DELETE, HEAD, OPTIONS

## 21.1 DELETE

```java
try (Response response = target.request().delete()) {
    if (response.getStatus() == 204) {
        return;
    }
    throw mapError(response);
}
```

Conditional delete:

```java
try (Response response = target.request()
    .header(HttpHeaders.IF_MATCH, etag)
    .delete()) {
    ...
}
```

## 21.2 HEAD

```java
try (Response response = target.request().head()) {
    EntityTag etag = response.getEntityTag();
    long length = response.getLength();
}
```

Use HEAD for metadata without body.

## 21.3 OPTIONS

```java
try (Response response = target.request().options()) {
    Set<String> allow = response.getAllowedMethods();
}
```

Useful for `Allow`, capabilities, and sometimes `Accept-Patch`.

## 21.4 Rule

```text
Use HTTP methods according to protocol semantics, not only CRUD convenience.
```

---

# 22. Error Handling Strategy

Outbound client code should map HTTP status to domain-specific exceptions.

## 22.1 Bad

```java
if (response.getStatus() != 200) {
    throw new RuntimeException("downstream failed");
}
```

## 22.2 Better

```java
switch (response.getStatus()) {
    case 200 -> response.readEntity(CustomerResponse.class);
    case 404 -> throw new DownstreamNotFoundException(readProblem(response));
    case 409 -> throw new DownstreamConflictException(readProblem(response));
    case 412 -> throw new DownstreamPreconditionException(readProblem(response));
    case 429 -> throw new DownstreamRateLimitedException(readProblem(response), retryAfter(response));
    default -> throw new DownstreamHttpException(response.getStatus(), safeReadProblem(response));
}
```

## 22.3 Preserve details

Keep:

- downstream service name;
- operation name;
- status;
- error code;
- correlation ID;
- retryable flag;
- retry-after;
- selected safe response headers.

## 22.4 Rule

```text
HTTP status is not enough; decode the downstream error contract.
```

---

# 23. Problem Details Client Decoder

## 23.1 DTO

```java
public record ProblemDetails(
    URI type,
    String title,
    int status,
    String detail,
    String code,
    String correlationId,
    Map<String, Object> extensions
) {}
```

## 23.2 Decoder

```java
ProblemDetails readProblem(Response response) {
    MediaType mediaType = response.getMediaType();

    if (mediaType != null
        && mediaType.isCompatible(MediaType.valueOf("application/problem+json"))) {
        return response.readEntity(ProblemDetails.class);
    }

    String text = safeReadSmallText(response);
    return fallbackProblem(response.getStatus(), text);
}
```

## 23.3 Safe text read

Do not read arbitrary huge error body into memory.

Pseudo-rule:

```text
read at most 64 KiB from error body
```

## 23.4 Rule

```text
Clients should understand the server's Problem Details contract.
```

---

# 24. ProcessingException vs ResponseProcessingException

## 24.1 `ProcessingException`

Client-side runtime processing failure.

Examples:

- connection refused;
- timeout;
- DNS failure;
- TLS handshake failure;
- no provider;
- serialization problem;
- IO issue.

## 24.2 `ResponseProcessingException`

Failure while processing a received response.

Examples:

- response body received but cannot be mapped;
- malformed JSON for expected DTO;
- response provider failure.

## 24.3 HTTP non-2xx is not transport failure

A `404`, `409`, or `500` with HTTP response is still an HTTP response. It should be mapped from `Response`, not confused with network timeout.

## 24.4 Rule

```text
No response received, response received with error status, and response body mapping failure are different failure classes.
```

---

# 25. Timeouts: Connect Timeout and Read Timeout

## 25.1 Connect timeout

Maximum time to establish connection.

```java
Client client = ClientBuilder.newBuilder()
    .connectTimeout(2, TimeUnit.SECONDS)
    .build();
```

## 25.2 Read timeout

Maximum time to wait for response/read.

```java
Client client = ClientBuilder.newBuilder()
    .readTimeout(5, TimeUnit.SECONDS)
    .build();
```

## 25.3 Value `0`

In the API, timeout value `0` represents infinity.

Avoid infinite timeouts in production.

## 25.4 Negative values

Negative timeout values are invalid.

## 25.5 Timeout budget

Outbound timeout must fit inbound request budget:

```text
inbound gateway timeout: 30s
service request budget: 25s
outbound customer API timeout: 3s
outbound retry budget: max 2 attempts within 8s
```

## 25.6 Rule

```text
Every production client needs explicit connect and read timeout.
```

---

# 26. Retry, Idempotency, and Safe Methods

## 26.1 Retry candidates

Usually safe to consider:

- GET;
- HEAD;
- OPTIONS;
- idempotent PUT with version/concurrency protection;
- POST only if Idempotency-Key contract exists.

## 26.2 Do not blindly retry

Bad:

```text
retry every POST 3 times on timeout
```

This can duplicate side effects.

## 26.3 Retry signals

Potentially retryable:

- connection reset before response;
- DNS/transient network error;
- 503 with `Retry-After`;
- 429 with `Retry-After`;
- read timeout if operation is safe/idempotent.

## 26.4 Retry policy

Use:

- max attempts;
- exponential backoff;
- jitter;
- deadline;
- circuit breaker if needed.

## 26.5 Rule

```text
Retry policy belongs to operation semantics, not generic HTTP helper.
```

---

# 27. TLS, TrustStore, KeyStore, HostnameVerifier

## 27.1 TrustStore

Controls trusted server certificates.

```java
Client client = ClientBuilder.newBuilder()
    .trustStore(trustStore)
    .build();
```

## 27.2 KeyStore

Client certificate/private key for mTLS.

```java
Client client = ClientBuilder.newBuilder()
    .keyStore(keyStore, keyPassword)
    .build();
```

## 27.3 SSLContext

```java
Client client = ClientBuilder.newBuilder()
    .sslContext(sslContext)
    .build();
```

## 27.4 HostnameVerifier

Do not disable hostname verification in production.

Bad:

```java
.hostnameVerifier((host, session) -> true)
```

## 27.5 Rule

```text
TLS client configuration is security-critical. Never bypass hostname verification casually.
```

---

# 28. Provider Registration

JAX-RS client supports providers/features.

## 28.1 Register class

```java
client.register(MyClientFilter.class);
```

## 28.2 Register instance

```java
client.register(new BearerAuthFilter(tokenProvider));
```

## 28.3 Register on WebTarget

```java
WebTarget target = client.target(baseUri)
    .register(SpecificFeature.class);
```

## 28.4 Provider types

- `MessageBodyReader`;
- `MessageBodyWriter`;
- `ClientRequestFilter`;
- `ClientResponseFilter`;
- `ReaderInterceptor`;
- `WriterInterceptor`;
- `Feature`.

## 28.5 Rule

```text
Provider registration should be explicit, centralized, and tested.
```

---

# 29. JSON Provider: JSON-B/Jackson/JSON-P

## 29.1 Client needs provider

If no JSON provider is available, JSON mapping can fail.

## 29.2 Match server contract

Configure consistently:

- naming strategy;
- null policy;
- unknown fields;
- date/time format;
- enum wire values;
- BigDecimal handling;
- polymorphism restrictions.

## 29.3 DTO compatibility

Client DTO is contract model, not server entity and not internal persistence entity.

## 29.4 Unknown fields

For forward compatibility, many clients should ignore unknown response fields while being strict on request DTO construction.

## 29.5 Rule

```text
Client/server JSON semantics must align at the wire contract, not just compile.
```

---

# 30. Client Request/Response Filters

## 30.1 Request filter

Runs before outbound request is sent.

```java
@Provider
public class CorrelationIdClientFilter implements ClientRequestFilter {
    @Override
    public void filter(ClientRequestContext ctx) {
        ctx.getHeaders().putSingle("X-Correlation-ID", Correlation.current());
    }
}
```

Use cases:

- Authorization header;
- correlation ID;
- tenant header;
- idempotency key;
- User-Agent;
- signing;
- tracing.

## 30.2 Response filter

Runs after response received.

Use cases:

- metrics;
- status logging;
- capture downstream correlation ID;
- header validation.

## 30.3 Entity stream caution

If a response filter reads the entity stream, it must buffer/replace stream correctly. Otherwise downstream code cannot read the body.

## 30.4 Rule

```text
Filters are for cross-cutting behavior, not business-specific response decoding.
```

---

# 31. Correlation ID and Authentication Filters

## 31.1 Correlation ID

```java
public class CorrelationIdClientFilter implements ClientRequestFilter {
    @Override
    public void filter(ClientRequestContext ctx) {
        String correlationId = CorrelationContext.currentOrNew();
        ctx.getHeaders().putSingle("X-Correlation-ID", correlationId);
    }
}
```

## 31.2 Bearer auth

```java
public class BearerAuthFilter implements ClientRequestFilter {
    private final TokenProvider tokenProvider;

    public BearerAuthFilter(TokenProvider tokenProvider) {
        this.tokenProvider = tokenProvider;
    }

    @Override
    public void filter(ClientRequestContext ctx) {
        ctx.getHeaders().putSingle(
            HttpHeaders.AUTHORIZATION,
            "Bearer " + tokenProvider.currentToken()
        );
    }
}
```

## 31.3 Token refresh

Do not refresh token naively inside every request without concurrency control. Use a token provider with caching, expiry skew, and single-flight refresh.

## 31.4 Secret-safe logging

Never log:

- Authorization;
- Cookie;
- API key;
- signed URL;
- client secret;
- private key data.

## 31.5 Rule

```text
Outbound auth is infrastructure concern; token lifecycle is security design.
```

---

# 32. Client-Side DTO Boundary

Do not reuse persistence entities or domain aggregates as outbound DTOs.

## 32.1 Request DTO

```java
public record CreateCustomerRequest(
    String displayName,
    String email
) {}
```

## 32.2 Response DTO

```java
public record CustomerResponse(
    String id,
    String displayName,
    String status
) {}
```

## 32.3 Adapter mapping

```text
CustomerResponse → DownstreamCustomerSnapshot → Domain decision
```

## 32.4 Rule

```text
Outbound DTOs represent remote wire contract, not your internal object model.
```

---

# 33. Streaming Downloads

## 33.1 Read as InputStream

```java
try (Response response = target.request().get()) {
    if (response.getStatus() != 200) {
        throw mapError(response);
    }

    try (InputStream in = response.readEntity(InputStream.class)) {
        Files.copy(in, destination);
    }
}
```

## 33.2 Do not buffer large response

Bad:

```java
byte[] all = response.readEntity(byte[].class);
```

for large downloads.

## 33.3 Capture headers first

```java
long length = response.getLength();
EntityTag etag = response.getEntityTag();
String disposition = response.getHeaderString("Content-Disposition");
```

## 33.4 Rule

```text
Streaming download client must close both response and consumed stream path.
```

---

# 34. Uploads with Client API

## 34.1 JSON upload

```java
try (Response response = target.request()
    .post(Entity.entity(dto, MediaType.APPLICATION_JSON_TYPE))) {
    return decode(response, UploadResponse.class);
}
```

## 34.2 Multipart upload

Multipart client support details can vary by Jakarta REST version and implementation. For standard Jakarta REST multipart support, use `EntityPart` where supported by your runtime. For older stacks, Jersey/RESTEasy/CXF may require implementation-specific multipart providers.

## 34.3 Large file upload

Avoid `byte[]`. Use streamable entity/provider or direct-to-object-storage upload pattern when file is large.

## 34.4 Rule

```text
Multipart and streaming upload behavior must be tested on the exact client implementation.
```

---

# 35. Thread Safety and Sharing

## 35.1 Share

- `Client`;
- base `WebTarget` if configuration stable;
- immutable DTOs;
- provider instances if thread-safe.

## 35.2 Do not share

- `Invocation.Builder` across requests/threads;
- `Response`;
- mutable request bodies;
- per-request state.

## 35.3 Rule

```text
Share infrastructure objects; keep invocation and response objects request-scoped.
```

---

# 36. Configuration Scope: Client vs WebTarget vs Request

## 36.1 Client scope

Global to all targets:

- TLS;
- providers;
- executor;
- default properties;
- connection infrastructure.

## 36.2 WebTarget scope

Specific service/resource configuration:

```java
WebTarget internalApi = client.target(baseUri)
    .register(InternalApiFeature.class);
```

## 36.3 Request scope

Specific invocation metadata:

```java
target.request()
    .header("Idempotency-Key", key)
    .header(HttpHeaders.IF_MATCH, etag);
```

## 36.4 Rule

```text
Put configuration at the narrowest scope that matches its semantics.
```

---

# 37. JAX-RS Client vs MicroProfile Rest Client vs Generated Client vs Raw HTTP Client

## 37.1 JAX-RS Client

Good for:

- dynamic URI building;
- low-level HTTP control;
- streaming;
- custom response mapping;
- ad-hoc integration;
- runtime provider reuse.

## 37.2 MicroProfile Rest Client

Good for:

- typed interface clients;
- CDI integration;
- config-driven base URI;
- fault tolerance integration;
- declarative headers;
- service-to-service APIs.

## 37.3 Generated OpenAPI client

Good when:

- third-party API has stable OpenAPI spec;
- many endpoints/models;
- type-safety matters;
- contract version is controlled.

Wrap generated clients behind your own application interface.

## 37.4 Lower-level HTTP client

Use Java `HttpClient`, Apache HttpClient, OkHttp, Netty, etc., when you need:

- advanced HTTP/2 control;
- detailed connection tuning;
- WebSocket;
- custom protocol behavior;
- reactive/non-blocking stack specifics.

## 37.5 Rule

```text
Choose the client abstraction based on contract stability, control needs, and operational requirements.
```

---

# 38. Testing JAX-RS Client Code

## 38.1 Do not mock too low-level by default

Mocking `Client`, `WebTarget`, and `Invocation.Builder` chains is often brittle.

Better:

```java
interface CustomerGateway {
    CustomerResponse get(CustomerId id);
}
```

Unit test business code by mocking `CustomerGateway`.

## 38.2 Integration test client adapter with mock server

Verify:

- method;
- path;
- query params;
- headers;
- body;
- content type;
- status mapping;
- timeout;
- malformed response;
- connection reset.

## 38.3 Mock server options

- WireMock;
- MockWebServer;
- local JAX-RS test server;
- container integration test.

## 38.4 Contract tests

For service-to-service, test against agreed contract:

- request shape;
- response shape;
- enum values;
- error body;
- headers;
- status code.

## 38.5 Rule

```text
HTTP client code should be tested with actual HTTP behavior, not only mocked fluent chains.
```

---

# 39. Observability

Outbound calls are dependencies and must be observable.

## 39.1 Metrics

Suggested metrics:

```text
http_client_requests_total{client,operation,method,status_family,status}
http_client_duration_seconds{client,operation,method}
http_client_failures_total{client,operation,reason}
http_client_timeouts_total{client,operation,type}
http_client_retries_total{client,operation,result}
http_client_inflight_requests{client,operation}
```

Avoid high-cardinality labels:

- full URL;
- user ID;
- customer ID;
- query string.

Use operation name/route template.

## 39.2 Tracing

Client request filter can inject trace context.

Capture:

- downstream service;
- operation name;
- method;
- status;
- retry attempt;
- error type.

## 39.3 Logging

Log:

- downstream service;
- operation;
- status;
- duration;
- error code;
- correlation ID.

Do not log:

- full bodies by default;
- tokens;
- cookies;
- signed URLs;
- PII.

## 39.4 Rule

```text
Outbound clients should be visible in metrics, logs, and traces without leaking data.
```

---

# 40. Runtime Differences

Core API is portable, but implementations differ in:

- connector implementation;
- connection pool config;
- async executor defaults;
- proxy properties;
- timeout properties beyond standard;
- JSON provider choice;
- multipart client support;
- redirect behavior;
- TLS configuration nuances;
- response buffering behavior.

## 40.1 Examples

- Jersey Client may use different connector providers.
- RESTEasy has its own client engine configuration.
- Apache CXF has different transport configuration.
- Open Liberty provides Jakarta REST client as server feature.
- Quarkus may prefer REST Client Reactive for typed clients depending stack.

## 40.2 Rule

```text
Write portable code where possible; isolate implementation-specific tuning.
```

---

# 41. Common Failure Modes

## 41.1 New `Client` per request

Connection reuse lost and overhead high.

## 41.2 `Client` never closed

Resource leak.

## 41.3 `Response` not closed

Connection leak.

## 41.4 No timeout

Thread can hang indefinitely.

## 41.5 Reading entity twice

`IllegalStateException` unless buffered.

## 41.6 Buffering huge response

OOM risk.

## 41.7 Retrying unsafe POST

Duplicate side effects.

## 41.8 Logging Authorization

Secret leak.

## 41.9 Missing JSON provider

Processing failure.

## 41.10 DTO/date/enum mismatch

Response mapping failure.

## 41.11 No Problem Details decoder

Opaque errors.

## 41.12 Raw string URI concatenation

Encoding bugs.

---

# 42. Best Practices

## 42.1 Reuse `Client`

Create few, close on shutdown.

## 42.2 Always set timeouts

Connect and read.

## 42.3 Use `WebTarget` builders

Path/template/query methods.

## 42.4 Close `Response`

Try-with-resources.

## 42.5 Decode errors explicitly

Problem Details and status mapping.

## 42.6 Use `GenericType` for generics

Avoid raw `List.class`.

## 42.7 Register providers/filters centrally

JSON, auth, correlation, metrics.

## 42.8 Redact secrets

Headers/body logs.

## 42.9 Test failure modes

Timeout, 4xx, 5xx, malformed body, connection reset.

## 42.10 Wrap outbound client behind application interface

Keep business code clean.

---

# 43. Anti-Patterns

## 43.1 Static helper with `ClientBuilder.newClient()` every call

Bad lifecycle.

## 43.2 `response.readEntity(String.class)` for all errors without size limit

Memory risk.

## 43.3 `bufferEntity()` on large downloads

Memory risk.

## 43.4 One catch-all `Exception`

Loses HTTP/transport distinction.

## 43.5 Retry all failures

Dangerous.

## 43.6 Put business logic in filters

Hard to reason/test.

## 43.7 Share `Invocation.Builder`

Request cross-talk.

## 43.8 Disable hostname verification

Critical security bug.

## 43.9 Trust downstream response blindly

Validate contract.

## 43.10 No integration tests

Client works only in happy path imagination.

---

# 44. Production Checklist

## 44.1 Lifecycle/config

- [ ] `Client` created centrally.
- [ ] `Client` reused.
- [ ] `Client` closed on shutdown.
- [ ] Implementation dependency present.
- [ ] Connect timeout set.
- [ ] Read timeout set.
- [ ] TLS/truststore configured.
- [ ] Proxy config isolated.
- [ ] Connection pool tuned if implementation-specific.

## 44.2 Request contract

- [ ] `WebTarget` path/query builders used.
- [ ] Accept header set.
- [ ] Content-Type set for entity requests.
- [ ] Auth header/filter configured.
- [ ] Correlation ID propagated.
- [ ] Idempotency-Key used where needed.
- [ ] Conditional headers used where needed.

## 44.3 Response handling

- [ ] `Response` closed.
- [ ] Status mapped explicitly.
- [ ] Problem Details decoded.
- [ ] 204/304 no-body handled.
- [ ] `GenericType` used for generics.
- [ ] Large response streamed.
- [ ] Entity not read twice unless buffered.

## 44.4 Resilience/security

- [ ] Retry policy operation-specific.
- [ ] Secrets redacted.
- [ ] No hostname verifier bypass.
- [ ] Token refresh safe.
- [ ] Rate limit/backoff handled.
- [ ] Downstream failures classified.

## 44.5 Testing/observability

- [ ] Mock server tests.
- [ ] Timeout tests.
- [ ] Error body tests.
- [ ] Malformed response tests.
- [ ] Metrics for outbound calls.
- [ ] Tracing propagation.
- [ ] Safe logs.

---

# 45. Latihan

## Latihan 1 — Basic Client Wrapper

Buat `CustomerGateway` menggunakan JAX-RS Client:

```java
CustomerResponse getCustomer(CustomerId id)
```

Dengan:

- base URL dari config;
- timeout;
- Accept JSON;
- Response close.

## Latihan 2 — Problem Details Decoder

Mock server return:

```http
409 Conflict
Content-Type: application/problem+json
```

Map ke `DownstreamConflictException`.

## Latihan 3 — GenericType

Endpoint return:

```json
[
  {"id":"C001"},
  {"id":"C002"}
]
```

Read as:

```java
new GenericType<List<CustomerResponse>>() {}
```

## Latihan 4 — Retry Policy

Implement retry only for GET on:

- connection reset;
- 503;
- 429 with Retry-After.

Do not retry POST without Idempotency-Key.

## Latihan 5 — Streaming Download

Download 500MB to file using `InputStream`.

No `byte[]`.

Assert `Response` closed.

## Latihan 6 — Correlation Filter

Client request filter adds `X-Correlation-ID`.

Mock server asserts header exists.

## Latihan 7 — Token Filter

Bearer auth filter uses `TokenProvider`.

Ensure logs redact token.

## Latihan 8 — Timeout Test

Mock server delays response beyond read timeout.

Assert `ProcessingException` classification.

## Latihan 9 — Client Lifecycle

Prove only one `Client` is created for service lifetime and closed at shutdown.

---

# 46. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 — `jakarta.ws.rs.client` Package  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/client/package-summary

2. Jakarta RESTful Web Services 4.0 — `ClientBuilder` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/client/clientbuilder

3. Jakarta RESTful Web Services 4.0 — `Client` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/client/client

4. Jakarta RESTful Web Services 4.0 — `WebTarget` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/client/webtarget

5. Jakarta RESTful Web Services 4.0 — `Invocation.Builder` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/client/invocation.builder

6. Jakarta RESTful Web Services 4.0 — `Entity` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/client/entity

7. Jakarta RESTful Web Services 4.0 — `Response` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/response

8. Jakarta EE Tutorial — Accessing REST Resources with the Jakarta REST Client API  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/websvcs/rest-client/rest-client.html

9. RFC 9110 — HTTP Semantics  
   https://www.rfc-editor.org/rfc/rfc9110.html

---

# 47. Penutup

JAX-RS Client API memberi fluent abstraction untuk outbound HTTP, tetapi tetap harus dipakai dengan disiplin production.

Mental model final:

```text
ClientBuilder configures
Client owns infrastructure
WebTarget identifies URI
Invocation.Builder configures request
Entity wraps outbound body/media type
Response carries status/headers/body stream
```

Prinsip final:

```text
Create few Clients.
Reuse them.
Close them on shutdown.
Close every Response you obtain.
Set timeouts.
Map errors deliberately.
Do not log secrets.
```

Top-tier JAX-RS engineer memastikan:

- outbound client adalah boundary yang jelas;
- `Client` lifecycle benar;
- URI dibangun dengan target/template/query builder;
- request/response contract eksplisit;
- provider/filter terdaftar terpusat;
- JSON semantics konsisten;
- timeout/retry/idempotency dirancang per operation;
- TLS aman;
- response entity tidak bocor;
- Problem Details didecode;
- streaming download tidak masuk memory;
- observability dan contract tests tersedia.

Part berikutnya:

```text
Bagian 029 — Advanced Client API: Filters, Interceptors, Features, Async, SSE Client
```

Kita akan membahas client-side extension dan advanced invocation: `ClientRequestFilter`, `ClientResponseFilter`, `ReaderInterceptor`, `WriterInterceptor`, `Feature`, async invoker, reactive invoker, SSE client, resilience hooks, and production instrumentation.
