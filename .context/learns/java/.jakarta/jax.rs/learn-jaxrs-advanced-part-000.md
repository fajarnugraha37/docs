# learn-jaxrs-advanced-part-000.md

# Bagian 000 — Big Picture JAX-RS: From Annotation API to HTTP Runtime Contract

> Target pembaca: Java/Jakarta engineer yang ingin memahami JAX-RS / Jakarta RESTful Web Services bukan hanya sebagai kumpulan annotation seperti `@Path`, `@GET`, `@Produces`, tetapi sebagai **runtime contract** antara HTTP, resource model, entity providers, context, exception mapping, filters/interceptors, CDI, servlet container, dan production architecture.
>
> Fokus bagian ini: big picture, sejarah `javax.ws.rs` → `jakarta.ws.rs`, Jakarta REST 4.0, mental model request pipeline, peran runtime implementation, relationship dengan Servlet/CDI/JSON-B/Validation/Security, dan fondasi berpikir untuk seluruh seri advanced berikutnya.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Apa Itu JAX-RS / Jakarta RESTful Web Services?](#2-apa-itu-jax-rs--jakarta-restful-web-services)
3. [Nama dan Namespace: JAX-RS, Jakarta REST, `javax.ws.rs`, `jakarta.ws.rs`](#3-nama-dan-namespace-jax-rs-jakarta-rest-javaxxwsrs-jakartawsrs)
4. [Sejarah Ringkas Versi: JAX-RS 1.x sampai Jakarta REST 4.0](#4-sejarah-ringkas-versi-jax-rs-1x-sampai-jakarta-rest-40)
5. [Jakarta REST 4.0: Apa yang Penting untuk Jakarta EE 11?](#5-jakarta-rest-40-apa-yang-penting-untuk-jakarta-ee-11)
6. [Mental Model Utama: HTTP Request → Resource Method → Response](#6-mental-model-utama-http-request--resource-method--response)
7. [JAX-RS Bukan REST Itu Sendiri](#7-jax-rs-bukan-rest-itu-sendiri)
8. [REST Architectural Style vs HTTP JSON API](#8-rest-architectural-style-vs-http-json-api)
9. [JAX-RS sebagai Declarative HTTP Boundary](#9-jax-rs-sebagai-declarative-http-boundary)
10. [Komponen Utama JAX-RS](#10-komponen-utama-jax-rs)
11. [Request Processing Pipeline: Big Picture](#11-request-processing-pipeline-big-picture)
12. [Resource Matching Pipeline](#12-resource-matching-pipeline)
13. [Parameter Injection Pipeline](#13-parameter-injection-pipeline)
14. [Entity Provider Pipeline](#14-entity-provider-pipeline)
15. [Response Pipeline](#15-response-pipeline)
16. [Exception Pipeline](#16-exception-pipeline)
17. [Filter dan Interceptor Pipeline](#17-filter-dan-interceptor-pipeline)
18. [Context Injection dan Request Context](#18-context-injection-dan-request-context)
19. [Hubungan JAX-RS dengan Servlet](#19-hubungan-jax-rs-dengan-servlet)
20. [Hubungan JAX-RS dengan CDI](#20-hubungan-jax-rs-dengan-cdi)
21. [Hubungan JAX-RS dengan JSON-B, JSON-P, dan Provider JSON](#21-hubungan-jax-rs-dengan-json-b-json-p-dan-provider-json)
22. [Hubungan JAX-RS dengan Jakarta Validation](#22-hubungan-jax-rs-dengan-jakarta-validation)
23. [Hubungan JAX-RS dengan Jakarta Security](#23-hubungan-jax-rs-dengan-jakarta-security)
24. [Server API vs Client API](#24-server-api-vs-client-api)
25. [Implementation vs Specification](#25-implementation-vs-specification)
26. [Jersey, RESTEasy, Apache CXF, Open Liberty, Payara, Quarkus: Apa Bedanya?](#26-jersey-resteasy-apache-cxf-open-liberty-payara-quarkus-apa-bedanya)
27. [Dependency dan Runtime Model](#27-dependency-dan-runtime-model)
28. [Minimal Example: Jangan Tertipu Kesederhanaannya](#28-minimal-example-jangan-tertipu-kesederhanaannya)
29. [Kenapa Resource Class Harus Tipis](#29-kenapa-resource-class-harus-tipis)
30. [Boundary Layer Design](#30-boundary-layer-design)
31. [JAX-RS dan Domain-Driven API](#31-jax-rs-dan-domain-driven-api)
32. [JAX-RS dan Production Reality](#32-jax-rs-dan-production-reality)
33. [Kesalahan Mental Model yang Sering Terjadi](#33-kesalahan-mental-model-yang-sering-terjadi)
34. [Best Practices Awal](#34-best-practices-awal)
35. [Anti-Patterns Awal](#35-anti-patterns-awal)
36. [Checklist Pemahaman Part 000](#36-checklist-pemahaman-part-000)
37. [Latihan](#37-latihan)
38. [Referensi Resmi](#38-referensi-resmi)
39. [Penutup](#39-penutup)

---

# 1. Tujuan Part Ini

Part ini bukan tutorial “hello world”.

Part ini membangun **mental model**.

Setelah part ini, kamu harus bisa menjelaskan:

```text
Apa yang sebenarnya terjadi ketika HTTP request masuk ke JAX-RS runtime?
```

Bukan hanya:

```java
@GET
@Path("/hello")
public String hello() {
    return "hello";
}
```

Tetapi:

```text
HTTP request
  ↓
servlet/container transport layer
  ↓
JAX-RS application/runtime
  ↓
request filters
  ↓
resource matching
  ↓
parameter conversion
  ↓
entity body reading
  ↓
resource method invocation
  ↓
exception mapping if failure
  ↓
entity body writing
  ↓
response filters/interceptors
  ↓
HTTP response
```

## 1.1 Yang ingin kita hindari

Kita tidak ingin memahami JAX-RS sebagai:

```text
@Path = URL
@GET = GET
@Produces = JSON
```

Itu terlalu dangkal.

Kita ingin memahami JAX-RS sebagai:

```text
declarative framework for mapping HTTP semantics to Java boundary code,
with extensible runtime hooks for entity conversion, metadata, exceptions,
filters, interceptors, security, validation, and client communication.
```

## 1.2 Skill yang dibangun

- Membaca bug request matching.
- Mendesain endpoint yang benar secara HTTP.
- Membuat error contract yang stabil.
- Memahami provider pipeline.
- Memilih JSON provider dengan sadar.
- Menulis filter/interceptor tanpa merusak body stream.
- Mendesain client JAX-RS yang resilient.
- Menghindari coupling resource class ke domain/entity.
- Migrasi `javax.ws.rs` ke `jakarta.ws.rs`.
- Mengoperasikan JAX-RS API di production.

---

# 2. Apa Itu JAX-RS / Jakarta RESTful Web Services?

**JAX-RS** adalah nama historis untuk Java API for RESTful Web Services.

Nama modernnya adalah:

```text
Jakarta RESTful Web Services
```

Package modern:

```java
jakarta.ws.rs
```

Package legacy:

```java
javax.ws.rs
```

Secara sederhana:

```text
JAX-RS/Jakarta REST adalah specification API untuk membangun RESTful web services
di Java/Jakarta ecosystem.
```

Namun secara arsitektural:

```text
JAX-RS adalah HTTP boundary runtime abstraction.
```

Ia menghubungkan:

- HTTP method;
- URI path;
- request headers;
- request body;
- cookies;
- media type;
- status code;
- response headers;
- response body;
- exception handling;
- content negotiation;
- filters;
- interceptors;
- context;
- client API.

## 2.1 Contoh sederhana

```java
@Path("/customers")
public class CustomerResource {

    @GET
    @Path("/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public CustomerResponse getCustomer(@PathParam("id") String id) {
        return service.getCustomer(id);
    }
}
```

Banyak engineer berhenti di sini.

Tapi di balik kode ini terjadi banyak keputusan runtime:

1. Runtime menemukan `CustomerResource`.
2. Runtime menggabungkan base path application dengan class path dan method path.
3. Runtime mencocokkan request `GET /customers/C001`.
4. Runtime mengkonversi path segment `C001` ke parameter `String`.
5. Runtime memilih method berdasarkan HTTP method dan media type.
6. Runtime memanggil method.
7. Runtime mencari `MessageBodyWriter` untuk `CustomerResponse`.
8. Runtime menulis response body JSON.
9. Runtime mengisi `Content-Type`.
10. Runtime mengirim HTTP response.

## 2.2 JAX-RS sebagai contract

JAX-RS membuat kontrak:

```text
Java method can be exposed as HTTP resource method,
as long as runtime can match request and convert data in/out.
```

## 2.3 Ia bukan web server

JAX-RS bukan TCP server mentah.

Ia biasanya berjalan di atas:

- Servlet container;
- Jakarta EE runtime;
- lightweight runtime;
- framework-specific HTTP layer.

## 2.4 Ia bukan JSON library

JAX-RS bisa menggunakan JSON-B, JSON-P, Jackson, MOXy, atau provider lain.

JAX-RS mendefinisikan provider extension point.

## 2.5 Ia bukan security framework penuh

JAX-RS menyediakan `SecurityContext` dan integration points, tetapi authentication/authorization biasanya melibatkan:

- Servlet container;
- Jakarta Security;
- OIDC/JWT runtime;
- filters;
- gateway;
- custom policy layer.

---

# 3. Nama dan Namespace: JAX-RS, Jakarta REST, `javax.ws.rs`, `jakarta.ws.rs`

## 3.1 Nama historis

Dulu disebut:

```text
JAX-RS — Java API for RESTful Web Services
```

Versi umum:

- JAX-RS 1.0;
- JAX-RS 1.1;
- JAX-RS 2.0;
- JAX-RS 2.1.

Root package:

```java
javax.ws.rs
```

## 3.2 Nama modern

Setelah Java EE pindah ke Eclipse Foundation dan menjadi Jakarta EE:

```text
Jakarta RESTful Web Services
```

Root package:

```java
jakarta.ws.rs
```

## 3.3 Kenapa nama JAX-RS masih dipakai?

Karena komunitas, dokumentasi, runtime, dan engineer masih sering menyebut “JAX-RS”.

Jadi dalam praktik:

```text
JAX-RS = nama umum/historis
Jakarta REST = nama specification modern
```

## 3.4 Namespace migration

Legacy:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.Produces;
```

Modern:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
```

## 3.5 Mixed namespace trap

Ini berbahaya:

```java
jakarta.ws.rs.Path
```

dipakai bersama dependency/provider yang masih expecting:

```java
javax.ws.rs.Path
```

Mereka adalah tipe berbeda.

Tidak compatible.

## 3.6 Aturan migrasi

```text
Aplikasi, runtime, provider, filters, interceptors, client API,
test libraries, and third-party extensions must agree on namespace.
```

## 3.7 Spring Boot context

Spring Boot 2 era masih banyak `javax`.

Spring Boot 3 era pindah ke `jakarta`.

Jadi JAX-RS/Jakarta REST migration juga berdampak pada library ecosystem.

---

# 4. Sejarah Ringkas Versi: JAX-RS 1.x sampai Jakarta REST 4.0

## 4.1 JAX-RS 1.x

Fokus awal:

- resource classes;
- annotations;
- request matching;
- basic providers;
- server-side REST API.

## 4.2 JAX-RS 2.0

Menambahkan banyak hal penting:

- Client API;
- filters;
- interceptors;
- asynchronous server processing;
- improved provider model.

## 4.3 JAX-RS 2.1 / JSR 370

Masih menggunakan package:

```java
javax.ws.rs
```

JAX-RS 2.1 menambahkan/memperkuat:

- reactive client style;
- `CompletionStage`;
- Server-Sent Events;
- `@PATCH`;
- Java SE bootstrap improvements.

## 4.4 Jakarta REST 2.1

Rilis pertama di Jakarta EE 8.

Masih re-release dari JSR 370 dan masih memakai `javax.ws.rs`.

## 4.5 Jakarta REST 3.0

Rilis untuk Jakarta EE 9.

Perubahan besar:

```text
javax.ws.rs → jakarta.ws.rs
```

## 4.6 Jakarta REST 3.1

Rilis untuk Jakarta EE 10.

Menyelaraskan dengan Jakarta EE 10 ecosystem.

## 4.7 Jakarta REST 4.0

Rilis untuk Jakarta EE 11.

Poin penting:

- remove JAXB dependency;
- remove ManagedBean support;
- add JSON Merge Patch;
- add `UriInfo#getMatchedResourceTemplate`;
- add convenience method for checking header value lists;
- clarify Java SE support.

## 4.8 Kenapa sejarah penting?

Karena banyak production apps masih berada di:

- JAX-RS 2.0 / Java EE 7;
- JAX-RS 2.1 / Java EE 8;
- Jakarta REST 2.1 / Jakarta EE 8;
- Jakarta REST 3.1 / Jakarta EE 10;
- Jakarta REST 4.0 / Jakarta EE 11.

Engineer senior harus bisa membaca dan memigrasikan semuanya.

---

# 5. Jakarta REST 4.0: Apa yang Penting untuk Jakarta EE 11?

Jakarta REST 4.0 adalah release untuk Jakarta EE 11.

## 5.1 Remove JAXB dependency

Sebelumnya, XML Binding/JAXB historically related to entity provider and XML payload handling.

Jakarta EE 11 menghapus XML Binding dari Platform.

Jakarta REST 4.0 menghapus dependency JAXB dari spec.

Implikasi:

```text
Do not assume JAXB/XML support is automatically there.
```

Jika API butuh XML/JAXB:

- add explicit dependency;
- register provider;
- test runtime behavior.

## 5.2 Remove ManagedBean support

Managed Beans removed/deprecated direction.

CDI is modern component model.

Implikasi:

```text
Use CDI for resource/provider lifecycle/injection.
```

## 5.3 JSON Merge Patch

Jakarta REST 4.0 menambahkan dukungan terkait JSON Merge Patch.

Ini relevan untuk partial update:

```http
PATCH /customers/C001
Content-Type: application/merge-patch+json
```

Kita akan bahas detail di part PATCH.

## 5.4 `UriInfo#getMatchedResourceTemplate`

Membantu observability/metrics karena kamu bisa mendapatkan template matched resource.

Contoh:

```text
/customers/{id}
```

bukan path aktual:

```text
/customers/C001
```

Ini penting untuk metrics cardinality.

Bad metric:

```text
http_requests_total{path="/customers/C001"}
http_requests_total{path="/customers/C002"}
```

Good metric:

```text
http_requests_total{path_template="/customers/{id}"}
```

## 5.5 Header value list convenience

Membantu ergonomics saat memeriksa header list values.

## 5.6 Clarify Java SE support

JAX-RS historically can run outside full Jakarta EE runtime.

Tapi behavior tergantung implementation/bootstrap.

## 5.7 Jakarta EE 11 context

Jakarta EE 11 juga membawa Java 21/virtual threads-aware runtime support dan modernization.

Namun JAX-RS API sendiri tetap perlu dipahami sebagai portable spec, bukan runtime tunggal.

---

# 6. Mental Model Utama: HTTP Request → Resource Method → Response

Core mental model:

```text
HTTP Request
  ↓
JAX-RS Application
  ↓
Filters
  ↓
Resource Matching
  ↓
Parameter Injection
  ↓
Entity Reading
  ↓
Resource Method Invocation
  ↓
Response/Exception
  ↓
Entity Writing
  ↓
Filters/Interceptors
  ↓
HTTP Response
```

## 6.1 Example request

```http
GET /api/customers/C001?include=address
Accept: application/json
Authorization: Bearer ...
X-Correlation-ID: abc-123
```

## 6.2 Runtime responsibilities

Runtime harus menjawab:

1. Aplikasi JAX-RS mana yang menangani path `/api`?
2. Resource class mana cocok `/customers/C001`?
3. Method mana cocok `GET`?
4. Parameter `C001` dikonversi ke tipe apa?
5. Query param `include` dibaca bagaimana?
6. Apakah `Accept: application/json` cocok dengan `@Produces`?
7. Apakah user authenticated/authorized?
8. Provider mana menulis response?
9. Filter/interceptor mana jalan?
10. Jika error, mapper mana dipakai?

## 6.3 JAX-RS boundary

Resource method adalah boundary antara:

```text
HTTP world
```

dan

```text
application/domain world
```

## 6.4 Boundary input

Input HTTP:

- path;
- query;
- header;
- cookie;
- matrix param;
- body;
- method;
- content type;
- accept media type;
- security principal.

## 6.5 Boundary output

Output HTTP:

- status code;
- headers;
- cookies;
- body;
- media type;
- cache metadata;
- location/link metadata.

## 6.6 Top-tier resource design

Resource class seharusnya:

- parse HTTP boundary;
- validate request boundary;
- call application service;
- map domain result to response;
- not contain heavy domain logic.

---

# 7. JAX-RS Bukan REST Itu Sendiri

REST adalah architectural style.

JAX-RS adalah Java API untuk membangun RESTful-ish web services.

Kamu bisa menulis API buruk dengan JAX-RS.

Contoh buruk:

```java
@POST
@Path("/doGetCustomer")
public Customer get(CustomerRequest request) { ... }
```

Ini memakai HTTP sebagai RPC tunnel.

## 7.1 REST constraints

REST as architectural style melibatkan constraints seperti:

- client-server;
- stateless;
- cacheable;
- uniform interface;
- layered system;
- code-on-demand optional.

## 7.2 JAX-RS tidak memaksa REST maturity

JAX-RS tidak memaksa:

- resource-oriented URI;
- correct status code;
- idempotency;
- cache headers;
- hypermedia;
- conditional requests;
- link relations;
- representation versioning.

Itu tanggung jawab desain API.

## 7.3 Annotation tidak menjamin semantics

`@GET` tidak otomatis membuat method safe.

Jika method `@GET` mengubah state, kamu melanggar HTTP semantics.

## 7.4 Top-tier mindset

```text
JAX-RS gives you tools.
HTTP semantics gives you correctness.
Domain modeling gives you usefulness.
Production engineering gives you safety.
```

---

# 8. REST Architectural Style vs HTTP JSON API

Banyak API yang disebut REST sebenarnya adalah HTTP JSON API.

Itu tidak selalu buruk.

Yang penting sadar.

## 8.1 HTTP JSON API

Ciri:

- uses HTTP;
- JSON request/response;
- status codes;
- resource-ish URLs;
- not necessarily hypermedia.

## 8.2 RESTful API lebih ketat

Ciri:

- resource representation;
- uniform interface;
- cacheability;
- links/affordances where useful;
- stateless interaction;
- standardized semantics.

## 8.3 Enterprise pragmatism

Tidak semua enterprise API perlu hypermedia penuh.

Namun harus benar dalam:

- status code;
- method semantics;
- idempotency;
- validation;
- error contract;
- versioning;
- security;
- observability.

## 8.4 Maturity model praktis

Level pragmatis:

1. HTTP as transport.
2. Resource URI + proper methods.
3. Proper status codes and media types.
4. Cache/conditional requests where relevant.
5. Links/hypermedia where useful.

## 8.5 Jangan dogmatis

Tujuan API:

```text
safe, clear, evolvable, observable, secure, and useful
```

bukan “REST purity”.

---

# 9. JAX-RS sebagai Declarative HTTP Boundary

JAX-RS bersifat declarative.

Kamu mendeklarasikan mapping:

```java
@Path("/orders")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class OrderResource { ... }
```

Lalu runtime mengeksekusi mapping itu.

## 9.1 Declarative annotations

- `@Path`;
- `@GET`;
- `@POST`;
- `@PUT`;
- `@PATCH`;
- `@DELETE`;
- `@HEAD`;
- `@OPTIONS`;
- `@Consumes`;
- `@Produces`;
- `@PathParam`;
- `@QueryParam`;
- `@HeaderParam`;
- `@CookieParam`;
- `@MatrixParam`;
- `@BeanParam`;
- `@Context`.

## 9.2 Extension annotations/classes

- `@Provider`;
- `@NameBinding`;
- `@PreMatching`;
- `@Priority`;
- `DynamicFeature`;
- `MessageBodyReader`;
- `MessageBodyWriter`;
- `ExceptionMapper`;
- `ContainerRequestFilter`;
- `ContainerResponseFilter`;
- `ReaderInterceptor`;
- `WriterInterceptor`.

## 9.3 Declarative does not mean invisible

You still need to understand runtime rules.

Example:

```java
@GET
@Path("/{id}")
public Response get(@PathParam("id") UUID id) { ... }
```

If UUID conversion fails, what status?

Who maps error?

How is error body shaped?

This must be designed.

## 9.4 Annotation is API surface

Annotation choices affect external contract.

Changing `@Path`, `@Produces`, `@Consumes`, status code, JSON shape can break clients.

---

# 10. Komponen Utama JAX-RS

## 10.1 Application

```java
@ApplicationPath("/api")
public class ApiApplication extends Application { }
```

Defines JAX-RS application.

## 10.2 Resource class

```java
@Path("/customers")
public class CustomerResource { ... }
```

Handles HTTP resources.

## 10.3 Resource method

```java
@GET
@Path("/{id}")
public CustomerResponse get(@PathParam("id") String id) { ... }
```

Handles specific HTTP operation.

## 10.4 Entity class / DTO

```java
public record CustomerResponse(String id, String name) {}
```

Representation payload.

## 10.5 Providers

Convert, intercept, map errors, handle body.

## 10.6 Filters

Operate around request/response metadata.

## 10.7 Interceptors

Operate around entity streams.

## 10.8 Context objects

Expose request/runtime metadata.

## 10.9 Client API

Outbound HTTP client abstraction.

## 10.10 Runtime implementation

Executes the spec.

Examples:

- Jersey;
- RESTEasy;
- Apache CXF;
- Open Liberty implementation;
- Payara/GlassFish implementation;
- Quarkus RESTEasy Reactive.

---

# 11. Request Processing Pipeline: Big Picture

A useful pipeline:

```text
[Transport/Servlet]
  ↓
[Application selection]
  ↓
[Pre-matching request filters]
  ↓
[Resource class/method matching]
  ↓
[Post-matching request filters]
  ↓
[Reader interceptors]
  ↓
[MessageBodyReader]
  ↓
[Param conversion/injection]
  ↓
[Resource method]
  ↓
[ExceptionMapper if exception]
  ↓
[Writer interceptors]
  ↓
[MessageBodyWriter]
  ↓
[Response filters]
  ↓
[Transport/Servlet response]
```

The exact order has details we will study later.

## 11.1 Why pipeline matters

Bugs often happen because engineer misunderstands stage.

Examples:

- Trying to read body in request filter then resource gets empty stream.
- Expecting exception mapper to catch filter exception but implementation behavior differs.
- CORS filter registered after abort.
- Auth filter needs pre-matching but runs post-matching.
- Provider not selected because media type mismatch.
- Response already committed before streaming error.

## 11.2 Mental rule

```text
If you know the pipeline, you can debug JAX-RS.
```

## 11.3 Pipeline is also architecture

Each stage should have purpose:

- filter for metadata/security/correlation;
- interceptor for entity stream;
- provider for body conversion;
- mapper for error contract;
- resource for boundary orchestration;
- service for business logic.

Do not put everything in resource method.

---

# 12. Resource Matching Pipeline

Request matching decides which method is invoked.

## 12.1 Input

- HTTP method;
- request path;
- path templates;
- `@Consumes`;
- `@Produces`;
- subresources;
- media type;
- maybe request headers.

## 12.2 Class-level path

```java
@Path("/customers")
public class CustomerResource { ... }
```

## 12.3 Method-level path

```java
@GET
@Path("/{id}")
public CustomerResponse get(...) { ... }
```

Combined:

```text
/customers/{id}
```

## 12.4 HTTP method

```java
@GET
@POST
@PUT
@PATCH
@DELETE
```

## 12.5 Subresource locator

```java
@Path("/{customerId}/orders")
public OrderResource orders(@PathParam("customerId") String customerId) {
    return new OrderResource(customerId);
}
```

## 12.6 Ambiguity

Ambiguous paths can cause runtime errors or surprising matching.

Example:

```java
@Path("/{id}")
@Path("/search")
```

Literal usually more specific, but exact rules matter.

## 12.7 Media type matching

If path and method match but `Content-Type`/`Accept` do not:

- `415 Unsupported Media Type`;
- `406 Not Acceptable`.

## 12.8 Top-tier debugging

When endpoint not called, check:

1. application base path;
2. class path;
3. method path;
4. HTTP method;
5. trailing slash;
6. media type;
7. provider registration;
8. filters aborting;
9. deployment discovery.

---

# 13. Parameter Injection Pipeline

JAX-RS injects HTTP data into Java parameters/fields.

## 13.1 Common params

```java
@PathParam
@QueryParam
@HeaderParam
@CookieParam
@MatrixParam
@FormParam
@BeanParam
```

## 13.2 Conversion

JAX-RS can convert strings to:

- primitives;
- boxed primitives;
- enums;
- types with constructor from String;
- static `valueOf(String)`;
- static `fromString(String)`;
- types handled by `ParamConverter`.

## 13.3 Example

```java
@GET
@Path("/{id}")
public CustomerResponse get(
    @PathParam("id") UUID id,
    @QueryParam("include") List<String> include
) { ... }
```

## 13.4 Conversion failure

Conversion failure should become client error, but exact exception mapping and error body should be designed.

## 13.5 Boundary decision

Do you inject domain ID directly?

```java
@PathParam("id") CustomerId id
```

This can be elegant if converter is robust.

But avoid doing database lookup inside converter.

## 13.6 Validation

Conversion is syntax.

Validation is semantics.

Example:

```text
UUID syntax valid
but customer does not exist
```

Different concern.

---

# 14. Entity Provider Pipeline

Entity provider converts HTTP body to Java and Java to HTTP body.

## 14.1 Request body

```http
POST /customers
Content-Type: application/json

{"name":"Fajar"}
```

Runtime needs `MessageBodyReader<CreateCustomerRequest>`.

## 14.2 Response body

```java
return new CustomerResponse("C001", "Fajar");
```

Runtime needs `MessageBodyWriter<CustomerResponse>`.

## 14.3 Built-in providers

JAX-RS includes certain standard providers.

JSON support is commonly integrated via JSON-B/JSON-P provider in Jakarta EE runtime, but implementation details vary.

## 14.4 Custom provider

```java
@Provider
@Consumes("application/x-custom")
public class CustomReader implements MessageBodyReader<MyType> { ... }
```

## 14.5 Provider matching

Provider selected by:

- Java type;
- generic type;
- annotations;
- media type;
- priority;
- runtime rules.

## 14.6 Common failures

- no writer for type;
- no reader for content type;
- wrong generic type;
- JSON provider missing;
- old JAXB dependency assumption;
- `InputStream` already consumed.

## 14.7 Top-tier design

Use DTOs with explicit media type and provider behavior.

Do not let entity provider accidentally serialize your entire domain graph.

---

# 15. Response Pipeline

A resource method can return many things:

```java
String
DTO
Response
CompletionStage<Response>
void
StreamingOutput
```

## 15.1 Return DTO

```java
public CustomerResponse get(...) {
    return service.get(...);
}
```

Simple and readable.

Runtime chooses status `200` generally.

## 15.2 Return Response

```java
return Response
    .created(uri)
    .entity(response)
    .build();
```

Useful when controlling:

- status;
- headers;
- location;
- cookies;
- cache;
- links.

## 15.3 Status matters

Correct status is part of API contract.

Examples:

- `200 OK` for successful retrieval/update with entity.
- `201 Created` with `Location`.
- `202 Accepted` for async accepted work.
- `204 No Content` when no body.
- `409 Conflict` for state conflict.
- `412 Precondition Failed` for ETag mismatch.

## 15.4 Headers matter

Production APIs often need:

- `Location`;
- `ETag`;
- `Cache-Control`;
- `Vary`;
- `Retry-After`;
- `Link`;
- `Content-Disposition`;
- correlation ID.

## 15.5 Response should not be afterthought

HTTP response is contract.

Design it intentionally.

---

# 16. Exception Pipeline

Exceptions happen in:

- request filters;
- resource matching;
- param conversion;
- message body reading;
- validation;
- resource method;
- service layer;
- message body writing;
- response filters;
- streaming.

## 16.1 `WebApplicationException`

JAX-RS exception that carries HTTP response.

Example:

```java
throw new NotFoundException("Customer not found");
```

## 16.2 `ExceptionMapper`

Maps exception to response.

```java
@Provider
public class DomainExceptionMapper implements ExceptionMapper<DomainException> {
    public Response toResponse(DomainException ex) {
        return Response.status(409)
            .entity(error)
            .build();
    }
}
```

## 16.3 Mapper hierarchy

Most specific mapper should be used.

Need understand implementation behavior for competing mappers.

## 16.4 Error contract

Do not return random strings.

Use stable error format.

Example:

```json
{
  "code": "CUSTOMER_NOT_FOUND",
  "message": "Customer was not found",
  "correlationId": "abc-123"
}
```

## 16.5 Do not leak internals

No stack trace to client.

No SQL error.

No class names.

## 16.6 Top-tier error taxonomy

Distinguish:

- validation error;
- authentication error;
- authorization error;
- not found;
- conflict;
- precondition failed;
- rate limit;
- dependency unavailable;
- internal bug.

---

# 17. Filter dan Interceptor Pipeline

## 17.1 Filters

Filters operate on request/response metadata.

Server side:

```java
ContainerRequestFilter
ContainerResponseFilter
```

Client side:

```java
ClientRequestFilter
ClientResponseFilter
```

Use cases:

- correlation ID;
- auth;
- CORS;
- logging metadata;
- headers;
- metrics;
- security hardening.

## 17.2 Interceptors

Interceptors operate around entity streams.

```java
ReaderInterceptor
WriterInterceptor
```

Use cases:

- compression;
- encryption;
- body wrapping;
- payload auditing metadata;
- stream transformations.

## 17.3 Difference

Filter:

```text
headers, URI, method, status
```

Interceptor:

```text
body stream
```

## 17.4 Common mistake

Reading entity stream in filter without resetting.

Then resource gets empty body.

## 17.5 Ordering

Controlled by:

- registration;
- `@Priority`;
- name binding;
- pre-matching.

## 17.6 Top-tier rule

```text
Use filters for metadata and control.
Use interceptors for entity stream.
Do not put business logic in either.
```

---

# 18. Context Injection dan Request Context

JAX-RS exposes context objects.

## 18.1 Common context

```java
@Context UriInfo uriInfo;
@Context HttpHeaders headers;
@Context Request request;
@Context SecurityContext security;
@Context Providers providers;
@Context ResourceContext resourceContext;
```

## 18.2 `UriInfo`

URI details:

- absolute path;
- base URI;
- path params;
- query params;
- matched resources;
- matched URIs;
- in Jakarta REST 4.0, matched resource template support.

## 18.3 `HttpHeaders`

Request headers and acceptable media types/languages.

## 18.4 `Request`

Conditional request helpers.

Useful for ETag/preconditions.

## 18.5 `SecurityContext`

Principal, roles, secure flag, auth scheme.

## 18.6 Thread safety

Context is request-related.

Do not store request context globally.

## 18.7 Top-tier usage

Use context to implement HTTP semantics, not as dumping ground.

---

# 19. Hubungan JAX-RS dengan Servlet

Most Jakarta REST runtimes in Jakarta EE web environments run on top of Servlet.

## 19.1 Servlet as transport

Servlet container handles:

- HTTP connection;
- request/response objects;
- filters;
- session;
- security integration;
- async IO;
- deployment.

JAX-RS maps higher-level resource model on top.

## 19.2 `@ApplicationPath`

Often maps JAX-RS application via servlet integration.

```java
@ApplicationPath("/api")
public class ApiApplication extends Application {}
```

## 19.3 Servlet filters vs JAX-RS filters

Servlet filter sees all servlet traffic before JAX-RS.

JAX-RS filter sees traffic within JAX-RS runtime.

## 19.4 When use Servlet filter?

- cross-cutting for all web traffic;
- low-level HTTP;
- before JAX-RS application selection;
- security integration;
- compression at container level.

## 19.5 When use JAX-RS filter?

- resource-aware behavior;
- JAX-RS context;
- API-specific headers;
- resource method name binding.

## 19.6 Servlet-specific injection

Some runtimes allow:

```java
@Context HttpServletRequest
```

But this reduces portability outside servlet runtime.

Use only when needed.

---

# 20. Hubungan JAX-RS dengan CDI

CDI is the modern component model in Jakarta EE.

## 20.1 Resource classes can be CDI-managed

This enables:

```java
@Inject CustomerService service;
```

## 20.2 Providers can be CDI-managed

Filters, interceptors, exception mappers may inject services/config.

## 20.3 Scopes matter

Resource classes are often request-scoped or per-request by runtime.

Do not store request mutable state in application-scoped providers unless thread-safe.

## 20.4 Jakarta REST 4.0 removes ManagedBean support

Use CDI instead of legacy Managed Beans.

## 20.5 Common pitfall

Provider registered manually may not be CDI-managed depending runtime.

Example:

```java
register(new MyFilter())
```

may bypass injection.

Prefer class registration or CDI-managed registration where runtime supports.

## 20.6 Top-tier CDI integration

- resource class thin;
- services `@ApplicationScoped`;
- request state in request scope;
- producers for config/resources;
- interceptors for cross-cutting;
- no static singleton hacks.

---

# 21. Hubungan JAX-RS dengan JSON-B, JSON-P, dan Provider JSON

JAX-RS does not hardcode one JSON library.

It relies on providers.

## 21.1 JSON-B

Standard object mapping.

```text
Java object ↔ JSON
```

## 21.2 JSON-P

Low-level JSON object/stream API.

Useful for:

- JSON Patch;
- Merge Patch;
- dynamic JSON;
- precise control.

## 21.3 Jackson

Common non-standard library.

Often used for advanced customization/ecosystem compatibility.

## 21.4 Provider selection

Runtime may choose provider based on what is available.

This can affect:

- date/time format;
- null handling;
- unknown properties;
- records;
- polymorphism;
- enum naming;
- property visibility.

## 21.5 Jakarta REST 4.0 and JSON Merge Patch

Patch semantics require careful JSON handling.

## 21.6 Top-tier strategy

Do not let JSON serialization be accidental.

Define:

- DTOs;
- serialization rules;
- date/time standard;
- null behavior;
- unknown fields behavior;
- error schema.

Test golden JSON.

---

# 22. Hubungan JAX-RS dengan Jakarta Validation

Jakarta Validation validates request DTOs/params.

## 22.1 Request DTO

```java
public record CreateCustomerRequest(
    @NotBlank String name,
    @Email String email
) {}
```

Resource:

```java
@POST
public Response create(@Valid CreateCustomerRequest request) { ... }
```

## 22.2 Parameter validation

```java
public Response list(@Min(1) @QueryParam("page") int page) { ... }
```

## 22.3 Mapping violations

Need error contract.

Default runtime response may not be good enough.

## 22.4 Validation vs business rule

Validation:

```text
email format valid
name not blank
```

Business rule:

```text
email not already registered
customer can submit application only if license active
```

## 22.5 Top-tier rule

Use Jakarta Validation for boundary invariants.

Use domain/service validation for business invariants.

---

# 23. Hubungan JAX-RS dengan Jakarta Security

JAX-RS provides `SecurityContext`.

But authentication usually happens before/around resource method.

## 23.1 SecurityContext

```java
@Context SecurityContext security;
```

Can access:

- principal;
- role check;
- is secure;
- auth scheme.

## 23.2 Container security

Servlet/Jakarta Security may authenticate request.

JAX-RS sees principal.

## 23.3 Filter-based auth

Some APIs use request filter for token validation.

Need careful ordering and error handling.

## 23.4 Authorization is more than roles

Role check:

```java
security.isUserInRole("ADMIN")
```

is not enough for data-level policies.

Need domain authorization:

```text
Can user X access customer Y under tenant Z?
```

## 23.5 OIDC/JWT

Modern APIs commonly use bearer JWT/OIDC.

Map claims to:

- subject;
- tenant;
- scopes;
- roles;
- permissions.

## 23.6 Top-tier security boundary

- authenticate early;
- authorize at domain action;
- audit sensitive actions;
- never trust client tenant/user IDs blindly;
- avoid leaking security details in errors.

---

# 24. Server API vs Client API

JAX-RS includes both:

```text
server-side API
client-side API
```

## 24.1 Server-side

Build endpoints:

- resources;
- providers;
- filters;
- interceptors;
- exception mappers.

## 24.2 Client-side

Call HTTP services:

```java
Client client = ClientBuilder.newClient();
Response response = client
    .target("https://api.example.com/customers")
    .path("{id}")
    .resolveTemplate("id", "C001")
    .request(MediaType.APPLICATION_JSON)
    .get();
```

## 24.3 Symmetry

Both sides use:

- media types;
- providers;
- filters;
- interceptors;
- entity conversion.

## 24.4 Client is production risk

Outbound calls need:

- timeout;
- connection pool;
- retry policy;
- circuit breaker;
- metrics;
- tracing;
- TLS/mTLS;
- error mapping.

## 24.5 Top-tier rule

```text
JAX-RS Client should be wrapped in a typed adapter,
not scattered as raw target calls across business code.
```

---

# 25. Implementation vs Specification

JAX-RS/Jakarta REST is a specification.

Runtime implementation executes it.

## 25.1 Specification defines

- annotations;
- interfaces;
- matching rules;
- provider contracts;
- client API;
- required behavior.

## 25.2 Implementation provides

- actual runtime;
- integration with servlet/CDI;
- JSON provider defaults;
- multipart extensions;
- client transport;
- performance characteristics;
- non-standard features.

## 25.3 TCK/compatibility

Compatible implementation should pass test compatibility kit.

But production differences still exist.

## 25.4 Portable code

Use standard APIs where possible.

## 25.5 Intentional extensions

Use implementation-specific features only with documentation.

## 25.6 Migration cost

Every vendor extension is future migration cost.

## 25.7 Top-tier mindset

```text
Spec for portability.
Implementation for reality.
Documentation for future maintainers.
```

---

# 26. Jersey, RESTEasy, Apache CXF, Open Liberty, Payara, Quarkus: Apa Bedanya?

## 26.1 Jersey

Historically reference implementation lineage.

Often used in GlassFish/Payara and standalone apps.

## 26.2 RESTEasy

JBoss/WildFly ecosystem.

RESTEasy Classic and RESTEasy Reactive in Quarkus context have different models.

## 26.3 Apache CXF

Supports JAX-RS and JAX-WS, often used in integration-heavy systems.

## 26.4 Open Liberty

Provides Jakarta REST features integrated into Liberty runtime.

## 26.5 Payara/GlassFish

Jakarta EE application server ecosystem with Jakarta REST support.

## 26.6 Quarkus

Uses RESTEasy Classic or Reactive depending extension.

Quarkus is not “plain Jakarta EE server”, but supports Jakarta APIs with framework-specific build/runtime model.

## 26.7 Differences that matter

- CDI integration;
- JSON provider default;
- multipart support;
- client transport;
- reactive support;
- configuration;
- metrics/tracing integration;
- exception defaults;
- provider discovery;
- startup/memory profile.

## 26.8 Rule

Test on actual runtime.

Do not assume behavior from another implementation.

---

# 27. Dependency dan Runtime Model

## 27.1 API dependency

Jakarta REST API artifact:

```xml
<dependency>
  <groupId>jakarta.ws.rs</groupId>
  <artifactId>jakarta.ws.rs-api</artifactId>
  <version>4.0.0</version>
  <scope>provided</scope>
</dependency>
```

In Jakarta EE app server, API and implementation usually provided by runtime.

## 27.2 Standalone app

If running standalone, you need implementation dependencies.

API alone is not enough.

## 27.3 Jakarta EE umbrella

For Jakarta EE Web Profile:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-web-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

## 27.4 Avoid API jar conflict

Do not package old `javax.ws.rs-api` into Jakarta runtime.

Do not package `jakarta.ws.rs-api` if runtime provides incompatible copy.

## 27.5 Library compatibility

Third-party filters/providers must match namespace.

## 27.6 Test classpath

Test dependencies can hide production conflicts.

Run packaged artifact.

---

# 28. Minimal Example: Jangan Tertipu Kesederhanaannya

## 28.1 Code

```java
@ApplicationPath("/api")
public class ApiApplication extends Application {
}
```

```java
@Path("/hello")
public class HelloResource {

    @GET
    @Produces(MediaType.TEXT_PLAIN)
    public String hello() {
        return "hello";
    }
}
```

Request:

```http
GET /api/hello
Accept: text/plain
```

Response:

```http
200 OK
Content-Type: text/plain

hello
```

## 28.2 Apa yang tersembunyi?

- Application discovery.
- Resource discovery.
- Path matching.
- Method matching.
- Accept negotiation.
- MessageBodyWriter for String.
- Response status default.
- Content-Type generation.
- Servlet mapping.
- Runtime lifecycle.

## 28.3 Tambahkan JSON

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public Greeting hello() {
    return new Greeting("hello");
}
```

Now runtime needs JSON provider.

## 28.4 Tambahkan parameter

```java
@GET
@Path("/{name}")
public Greeting hello(@PathParam("name") String name) { ... }
```

Now runtime needs path conversion/injection.

## 28.5 Tambahkan validation

```java
public Greeting hello(@NotBlank @PathParam("name") String name) { ... }
```

Now runtime needs validation integration and violation mapping.

## 28.6 Tambahkan security

Now runtime needs auth and authorization.

## 28.7 Lesson

Simple endpoint grows into platform interaction quickly.

---

# 29. Kenapa Resource Class Harus Tipis

Resource class is HTTP adapter.

It should not become God class.

## 29.1 Bad

```java
@Path("/orders")
public class OrderResource {
    @POST
    public Response create(CreateOrderRequest request) {
        // validate business rules
        // open transaction
        // query DB
        // call payment
        // publish message
        // send email
        // build audit
        // map response
    }
}
```

## 29.2 Better

```java
@Path("/orders")
public class OrderResource {
    @Inject OrderApplicationService service;
    @Inject OrderRestMapper mapper;

    @POST
    public Response create(@Valid CreateOrderRequest request, @Context UriInfo uriInfo) {
        CreateOrderCommand command = mapper.toCommand(request);
        CreatedOrder result = service.create(command);

        URI location = uriInfo.getAbsolutePathBuilder()
            .path(result.id())
            .build();

        return Response.created(location)
            .entity(mapper.toResponse(result))
            .build();
    }
}
```

## 29.3 Resource responsibility

- HTTP request extraction.
- DTO validation trigger.
- Security context extraction if needed.
- Call service/application layer.
- Map result to HTTP response.
- Set status/header.

## 29.4 Service responsibility

- business rules;
- transaction boundary;
- domain orchestration;
- repository calls;
- external dependency orchestration.

## 29.5 Why thin matters

- testability;
- maintainability;
- protocol independence;
- easier migration;
- cleaner error handling.

---

# 30. Boundary Layer Design

JAX-RS is boundary layer.

Design layers:

```text
Resource / Controller
  ↓
Application Service
  ↓
Domain Service / Domain Model
  ↓
Repository / External Adapter
```

## 30.1 Resource DTO

Request/response shapes for HTTP.

## 30.2 Command/query object

Internal application input.

## 30.3 Domain object

Business model.

## 30.4 Entity object

Persistence model.

Sometimes domain and entity same, but beware exposing it.

## 30.5 Mapper

Maps between boundary and internal model.

## 30.6 Error mapping

Domain exceptions mapped by `ExceptionMapper`.

## 30.7 Boundary rule

```text
HTTP details should not leak deep into domain.
Domain details should not leak raw into HTTP.
```

## 30.8 Practical exceptions

Small apps can be simpler.

But for top-tier enterprise systems, boundaries save migration and maintenance cost.

---

# 31. JAX-RS dan Domain-Driven API

REST resource design should reflect domain concepts.

## 31.1 Resource nouns

Good:

```text
/customers/{id}
/orders/{id}
/applications/{id}/status
```

Bad:

```text
/doCreateCustomer
/processOrderNow
/getApplicationStatus
```

## 31.2 Commands as resources

Not everything is CRUD.

Example state transition:

```http
POST /applications/{id}/submission
```

or:

```http
POST /applications/{id}/actions/submit
```

Design depends domain.

## 31.3 Long-running operation

```http
POST /reports
→ 202 Accepted
Location: /reports/jobs/{jobId}
```

## 31.4 Workflow state

Represent state transitions intentionally.

## 31.5 Avoid CRUD-only thinking

Enterprise domains are workflows, policies, state machines, documents, events.

## 31.6 Top-tier design

HTTP API should make domain behavior understandable.

---

# 32. JAX-RS dan Production Reality

Production API requires more than endpoint code.

## 32.1 Need observability

- request count;
- latency;
- status code;
- error code;
- path template;
- correlation ID;
- trace ID.

## 32.2 Need resilience

- timeout;
- retry when client;
- circuit breaker;
- rate limiting;
- idempotency.

## 32.3 Need security

- auth;
- authorization;
- input validation;
- output redaction;
- CORS/CSRF;
- file upload safety.

## 32.4 Need governance

- OpenAPI;
- versioning;
- compatibility;
- deprecation;
- contract tests.

## 32.5 Need performance

- pagination;
- streaming;
- compression;
- JSON tuning;
- DB pool tuning.

## 32.6 Need operations

- dashboards;
- alerts;
- runbooks;
- canary;
- rollback.

## 32.7 Lesson

JAX-RS is API surface.

Production readiness is the rest of the iceberg.

---

# 33. Kesalahan Mental Model yang Sering Terjadi

## 33.1 “JAX-RS automatically means RESTful”

No.

You can misuse HTTP.

## 33.2 “Resource method is business service”

No.

Resource is boundary adapter.

## 33.3 “Returning entity is harmless”

No.

Can expose lazy-loaded graph, internal fields, security data.

## 33.4 “JSON provider behavior is universal”

No.

Runtime/provider differences matter.

## 33.5 “Filter can read body freely”

No.

Entity stream is usually one-time.

## 33.6 “Client API call is just method call”

No.

It is network call: timeout, retry, failures.

## 33.7 “Status code is minor”

No.

Status code is part of client contract.

## 33.8 “SecurityContext role check is enough”

No.

Need domain authorization.

## 33.9 “Compile means compatible”

No.

Runtime provider/namespace/classloading matters.

## 33.10 “Metrics path can use raw URI”

No.

High cardinality disaster.

Use path template.

---

# 34. Best Practices Awal

## 34.1 Design HTTP semantics first

Before annotation, decide:

- method;
- URI;
- request body;
- response status;
- headers;
- error cases;
- idempotency.

## 34.2 Use DTOs

Never casually expose entities.

## 34.3 Keep resources thin

Delegate to application services.

## 34.4 Define error contract

Use exception mappers.

## 34.5 Validate at boundary

Use Jakarta Validation and business validation.

## 34.6 Standardize media types

Usually:

```text
application/json
```

But be explicit.

## 34.7 Instrument from start

Correlation ID, metrics, traces.

## 34.8 Make clients resilient

Timeout, retry, circuit breaker, error classification.

## 34.9 Test on actual runtime

Spec is portable, runtime still matters.

## 34.10 Document API

Use OpenAPI/contract tests.

---

# 35. Anti-Patterns Awal

## 35.1 God resource class

All business logic in resource.

## 35.2 Entity exposure

Returning JPA entity directly.

## 35.3 Status code abuse

Always returning `200`.

## 35.4 RPC over POST everywhere

```text
POST /doSomething
```

for all operations.

## 35.5 No pagination

Unbounded list endpoint.

## 35.6 No timeout on client

Threads hang.

## 35.7 Raw URI metric labels

High cardinality.

## 35.8 Exception stack trace to client

Security and UX problem.

## 35.9 Mixed `javax`/`jakarta`

Runtime mismatch.

## 35.10 Implementation-specific extension everywhere

Hard migration.

---

# 36. Checklist Pemahaman Part 000

Pastikan kamu bisa menjawab:

- [ ] Apa perbedaan JAX-RS dan Jakarta REST?
- [ ] Apa beda `javax.ws.rs` dan `jakarta.ws.rs`?
- [ ] Apa yang terjadi ketika request masuk ke JAX-RS runtime?
- [ ] Apa peran `Application`?
- [ ] Apa resource class?
- [ ] Apa resource method?
- [ ] Apa provider?
- [ ] Apa filter?
- [ ] Apa interceptor?
- [ ] Apa `ExceptionMapper`?
- [ ] Apa bedanya JAX-RS server API dan client API?
- [ ] Apa hubungan JAX-RS dengan Servlet?
- [ ] Apa hubungan JAX-RS dengan CDI?
- [ ] Kenapa resource class sebaiknya tipis?
- [ ] Kenapa status code bagian dari kontrak?
- [ ] Kenapa JAX-RS tidak otomatis membuat API RESTful?
- [ ] Kenapa JSON provider behavior harus dites?
- [ ] Kenapa Jakarta REST 4.0 removing JAXB dependency penting?
- [ ] Kenapa `UriInfo#getMatchedResourceTemplate` penting untuk metrics?

---

# 37. Latihan

## Latihan 1 — Gambar pipeline

Gambar pipeline request JAX-RS dari HTTP masuk sampai response keluar.

Tambahkan:

- filters;
- resource matching;
- parameter conversion;
- message body reader;
- resource method;
- exception mapper;
- message body writer;
- response filters.

## Latihan 2 — Namespace audit

Ambil project Java lama.

Cari:

```text
javax.ws.rs
jakarta.ws.rs
```

Buat matrix dependency:

```text
source imports
runtime
test libs
provider libs
client libs
```

## Latihan 3 — Resource responsibility

Ambil satu endpoint.

Pisahkan:

- HTTP boundary logic;
- business logic;
- persistence logic;
- mapping logic.

Refactor resource agar tipis.

## Latihan 4 — Status code audit

List semua endpoint write.

Tentukan status ideal:

- create;
- update;
- delete;
- async command;
- conflict;
- validation error.

## Latihan 5 — Provider awareness

Cari JSON provider runtime yang dipakai.

Cek:

- JSON-B?
- Jackson?
- MOXy?
- RESTEasy JSON?
- Jersey media-json?

## Latihan 6 — Error contract draft

Buat standard error JSON untuk API.

Minimal:

```json
{
  "code": "string",
  "message": "string",
  "correlationId": "string"
}
```

## Latihan 7 — Observability labels

Tentukan metric labels aman:

- method;
- status;
- path template;
- error code.

Hindari raw path.

---

# 38. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0  
   https://jakarta.ee/specifications/restful-ws/4.0/

2. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

3. Jakarta RESTful Web Services 4.0 API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/

4. API Module `jakarta.ws.rs`  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/module-summary

5. Jakarta RESTful Web Services Specifications Overview  
   https://jakarta.ee/specifications/restful-ws/

6. JSR 370 — JAX-RS 2.1  
   https://jcp.org/en/jsr/detail?id=370

7. Jakarta EE 11 Release  
   https://jakarta.ee/release/11/

8. Jakarta EE 11 Platform  
   https://jakarta.ee/specifications/platform/11/

9. Jakarta EE Compatible Products  
   https://jakarta.ee/compatibility/

10. Maven Central — `jakarta.ws.rs-api`  
    https://central.sonatype.com/artifact/jakarta.ws.rs/jakarta.ws.rs-api/4.0.0/jar

---

# 39. Penutup

Part ini adalah fondasi.

Mental model paling penting:

```text
JAX-RS is not just annotations.
JAX-RS is a runtime contract for mapping HTTP semantics to Java boundary code.
```

Pipeline mental model:

```text
HTTP request
  ↓
JAX-RS application
  ↓
filters
  ↓
resource matching
  ↓
param/entity conversion
  ↓
resource method
  ↓
response/exception mapping
  ↓
entity writing
  ↓
HTTP response
```

Top-tier JAX-RS engineer tidak hanya tahu:

```java
@Path
@GET
@Produces
```

Ia tahu:

- bagaimana request matching bekerja;
- bagaimana media type negotiation terjadi;
- bagaimana entity provider dipilih;
- bagaimana exception mapper mengubah failure menjadi API contract;
- kapan filter vs interceptor dipakai;
- bagaimana CDI/runtime/provider lifecycle mempengaruhi behavior;
- bagaimana `javax.ws.rs` legacy berbeda dari `jakarta.ws.rs`;
- bagaimana membuat API observable, secure, resilient, and evolvable.

Part berikutnya akan membahas:

```text
Bagian 001 — HTTP Semantics yang Wajib Dikuasai Sebelum JAX-RS
```

Karena banyak bug JAX-RS sebenarnya bukan bug JAX-RS, melainkan salah memahami HTTP.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-035](../dependency/learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-035.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-001.md](./learn-jaxrs-advanced-part-001.md)
