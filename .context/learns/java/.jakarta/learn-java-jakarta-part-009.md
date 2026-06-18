# learn-java-jakarta-part-009.md

# Bagian 9 — Jakarta RESTful Web Services (`jakarta.ws.rs`) Production-Grade

> Target pembaca: Java engineer yang ingin memahami Jakarta REST / JAX-RS bukan hanya sebagai kumpulan annotation `@Path`, `@GET`, `@POST`, tetapi sebagai **runtime programming model** untuk membangun HTTP API yang benar, evolvable, observable, secure, testable, dan production-grade.
>
> Fokus bagian ini: resource model, URI matching, HTTP method semantics, request/response pipeline, parameter binding, entity body, content negotiation, providers, filters, interceptors, exception mapping, validation, async, SSE, client API, security, idempotency, error contract, versioning, observability, testing, performance, dan failure mode.

---

## Daftar Isi

1. [Orientasi: Jakarta REST Itu Apa?](#1-orientasi-jakarta-rest-itu-apa)
2. [Mental Model: HTTP API sebagai Contract, Bukan Method Call](#2-mental-model-http-api-sebagai-contract-bukan-method-call)
3. [Jakarta REST 4.0 dalam Jakarta EE 11](#3-jakarta-rest-40-dalam-jakarta-ee-11)
4. [Dependency dan Runtime](#4-dependency-dan-runtime)
5. [Application Class dan Base Path](#5-application-class-dan-base-path)
6. [Resource Class dan Resource Method](#6-resource-class-dan-resource-method)
7. [URI Path Matching](#7-uri-path-matching)
8. [HTTP Method Semantics](#8-http-method-semantics)
9. [Parameter Injection: Path, Query, Header, Cookie, Matrix, Bean](#9-parameter-injection-path-query-header-cookie-matrix-bean)
10. [Entity Body: Request Payload dan Response Payload](#10-entity-body-request-payload-dan-response-payload)
11. [`Response` dan Status Code Design](#11-response-dan-status-code-design)
12. [Content Negotiation: `@Consumes`, `@Produces`, `Accept`, `Content-Type`](#12-content-negotiation-consumes-produces-accept-content-type)
13. [Providers: MessageBodyReader/Writer, ContextResolver, ParamConverter](#13-providers-messagebodyreaderwriter-contextresolver-paramconverter)
14. [JSON Integration: JSON-B, JSON-P, Jackson, dan Contract Stability](#14-json-integration-json-b-json-p-jackson-dan-contract-stability)
15. [Filters: Request/Response Pipeline](#15-filters-requestresponse-pipeline)
16. [JAX-RS Interceptors: Entity Stream Interception](#16-jax-rs-interceptors-entity-stream-interception)
17. [CDI Interceptors vs JAX-RS Filters/Interceptors](#17-cdi-interceptors-vs-jax-rs-filtersinterceptors)
18. [Exception Mapping: Error Contract Production-Grade](#18-exception-mapping-error-contract-production-grade)
19. [Validation Integration](#19-validation-integration)
20. [Security Integration](#20-security-integration)
21. [Asynchronous Server API](#21-asynchronous-server-api)
22. [Server-Sent Events/SSE](#22-server-sent-eventssse)
23. [Jakarta REST Client API](#23-jakarta-rest-client-api)
24. [API Design: Resource Modeling](#24-api-design-resource-modeling)
25. [Command API, Idempotency, dan Duplicate Request](#25-command-api-idempotency-dan-duplicate-request)
26. [Pagination, Filtering, Sorting, Search](#26-pagination-filtering-sorting-search)
27. [Partial Update: PUT vs PATCH, JSON Patch, JSON Merge Patch](#27-partial-update-put-vs-patch-json-patch-json-merge-patch)
28. [Caching: ETag, Last-Modified, Cache-Control](#28-caching-etag-last-modified-cache-control)
29. [Versioning dan Compatibility](#29-versioning-dan-compatibility)
30. [OpenAPI dan Documentation Strategy](#30-openapi-dan-documentation-strategy)
31. [Observability: Logs, Metrics, Traces](#31-observability-logs-metrics-traces)
32. [Performance Engineering](#32-performance-engineering)
33. [Testing Strategy](#33-testing-strategy)
34. [Common Failure Modes](#34-common-failure-modes)
35. [Production Checklist](#35-production-checklist)
36. [Case Study 1: Endpoint Tidak Ditemukan](#36-case-study-1-endpoint-tidak-ditemukan)
37. [Case Study 2: `415 Unsupported Media Type`](#37-case-study-2-415-unsupported-media-type)
38. [Case Study 3: `406 Not Acceptable`](#38-case-study-3-406-not-acceptable)
39. [Case Study 4: Error Contract Bocor Stack Trace](#39-case-study-4-error-contract-bocor-stack-trace)
40. [Case Study 5: POST Tidak Idempotent dan Double Submit](#40-case-study-5-post-tidak-idempotent-dan-double-submit)
41. [Latihan Bertahap](#41-latihan-bertahap)
42. [Mini Project: Jakarta REST Production API](#42-mini-project-jakarta-rest-production-api)
43. [Referensi Resmi](#43-referensi-resmi)

---

# 1. Orientasi: Jakarta REST Itu Apa?

Jakarta RESTful Web Services, sering disebut **Jakarta REST** atau historisnya **JAX-RS**, adalah API standar Jakarta untuk membangun web services mengikuti style REST.

Package utamanya:

```java
jakarta.ws.rs
jakarta.ws.rs.core
jakarta.ws.rs.container
jakarta.ws.rs.ext
jakarta.ws.rs.client
jakarta.ws.rs.sse
```

Contoh paling sederhana:

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

Pada permukaan, ini terlihat mudah.

Tetapi production REST API bukan hanya soal endpoint bisa dipanggil. Production REST API harus menjawab:

- resource apa yang dimodelkan?
- URI contract-nya stabil?
- method HTTP-nya benar?
- status code-nya konsisten?
- error response-nya predictable?
- validasi input-nya jelas?
- authorization-nya tepat?
- request idempotency-nya aman?
- observability-nya cukup?
- backward compatibility-nya dijaga?
- pagination/filtering-nya scalable?
- exception mapper-nya tidak bocor stack trace?
- JSON contract-nya tidak berubah diam-diam?
- client timeout/retry-nya aman?
- streaming/async-nya tidak membocorkan resource?

## 1.1 Jakarta REST sebagai standard API

Jakarta REST menyediakan annotation dan API untuk:

- mendefinisikan resource;
- mapping URI ke method;
- binding parameter;
- membaca request body;
- menulis response body;
- content negotiation;
- filters/interceptors;
- exception mapping;
- client API;
- async processing;
- Server-Sent Events.

## 1.2 Jakarta REST bukan full application architecture

Jakarta REST adalah API layer.

Ia tidak menggantikan:

- domain model;
- application service;
- transaction design;
- persistence design;
- security policy;
- idempotency model;
- event/outbox design;
- observability architecture.

Resource class sebaiknya tipis:

```text
HTTP request
  ↓
Resource class
  ↓
DTO/command mapping
  ↓
Application service/use case
  ↓
Domain model
  ↓
Repository/adapter
```

## 1.3 Jakarta REST vs Servlet

Jakarta REST biasanya berjalan di atas Servlet environment dalam banyak runtime.

Servlet adalah low-level HTTP request/response API.

Jakarta REST memberikan higher-level resource abstraction:

```text
Servlet:
  doGet(HttpServletRequest, HttpServletResponse)

Jakarta REST:
  @GET
  @Path("/{id}")
  Response get(@PathParam("id") CaseId id)
```

## 1.4 Jakarta REST vs Spring MVC

Keduanya bisa membangun REST API, tetapi:

```text
Jakarta REST = specification standard
Spring MVC = Spring framework web stack
```

Spring bisa memakai sebagian Jakarta APIs, tetapi programming model dan runtime-nya berbeda.

## 1.5 Target mental model

Jangan berpikir:

```text
@Path = URL mapping
@GET = method
return DTO = JSON
```

Itu terlalu dangkal.

Pikirkan:

```text
JAX-RS resource method adalah HTTP contract boundary
yang melakukan mapping antara protocol semantics dan application use case.
```

---

# 2. Mental Model: HTTP API sebagai Contract, Bukan Method Call

REST API bukan remote method call.

Buruk:

```http
POST /caseService/approveCase
```

Lebih resource-oriented:

```http
POST /cases/{caseId}/approval
```

atau command-oriented but explicit:

```http
POST /case-approvals
```

## 2.1 HTTP contract boundary

HTTP API adalah contract antara client dan server.

Contract meliputi:

- URI;
- method;
- request headers;
- request body schema;
- response status;
- response headers;
- response body schema;
- error format;
- authentication;
- authorization;
- idempotency;
- rate limit;
- pagination;
- caching;
- versioning.

## 2.2 Resource method bukan tempat business logic besar

Buruk:

```java
@POST
@Path("/{id}/approve")
public Response approve(@PathParam("id") String id, ApproveRequest req) {
    // 200 lines business logic
}
```

Lebih baik:

```java
@POST
@Path("/{id}/approval")
public Response approve(
        @PathParam("id") String id,
        @Valid ApproveCaseRequest request,
        @Context UriInfo uriInfo
) {
    ApproveCaseCommand command = request.toCommand(CaseId.of(id), actor());
    ApproveCaseResult result = approveCaseUseCase.handle(command);
    return Response.ok(ApproveCaseResponse.from(result)).build();
}
```

Resource class bertugas:

- protocol mapping;
- request validation trigger;
- actor/context extraction;
- DTO ↔ command/response mapping;
- response building;
- exception delegated to mapper.

Application service bertugas:

- business use case;
- transaction boundary;
- domain invariant;
- persistence/event/audit orchestration.

## 2.3 HTTP semantics matters

GET berbeda dari POST.

PUT berbeda dari PATCH.

DELETE harus dipahami dari idempotency semantics.

Status code bukan dekorasi.

Header bukan tambahan sepele.

REST API production-grade harus menghormati HTTP semantics agar client, proxy, gateway, cache, retry, observability, dan humans bisa memahami behavior.

## 2.4 API stability

Begitu API dipakai client, ia menjadi contract.

Mengubah field JSON, status code, error code, pagination format, atau media type bisa menjadi breaking change.

## 2.5 Jakarta REST membantu implementasi, bukan menggantikan API design

JAX-RS membuat mapping mudah, tetapi tidak otomatis membuat design benar.

---

# 3. Jakarta REST 4.0 dalam Jakarta EE 11

Jakarta RESTful Web Services 4.0 adalah release untuk Jakarta EE 11.

## 3.1 Posisi dalam Jakarta EE

Jakarta REST adalah bagian dari Jakarta EE ecosystem dan tersedia dalam Platform/Profile yang relevan.

Ia adalah foundational API untuk mengembangkan REST-style web services.

## 3.2 Jakarta REST 4.0 goals

Jakarta REST 4.0 merupakan update yang menjaga backward compatibility sambil membersihkan dependency legacy.

Beberapa perubahan penting yang tercatat untuk release ini:

- menghapus JAXB dependency;
- menghapus ManagedBean support;
- menambah/meningkatkan beberapa API convenience;
- menambah dukungan terkait JSON Merge Patch;
- memperjelas Java SE support;
- memperbaiki/menambah TCK coverage.

## 3.3 Kenapa remove JAXB dependency penting?

Historisnya REST API Java sering terkait XML/JAXB.

Modern REST API banyak menggunakan JSON. Menghapus dependency legacy seperti JAXB membantu mengurangi coupling dan footprint.

Namun jika aplikasi masih memakai XML/JAXB, kamu perlu dependency/implementation yang sesuai.

## 3.4 ManagedBean removal

ManagedBean adalah model lama. Jakarta EE modern bergerak ke CDI.

Implikasi:

- gunakan CDI bean untuk resource/component;
- jangan bergantung pada legacy ManagedBean support;
- migration dari Java EE lama harus dicek.

## 3.5 Java baseline

Karena Jakarta EE 11 menargetkan Java SE 17 atau lebih tinggi, aplikasi Jakarta REST 4.0 dalam EE 11 harus disiapkan untuk Java modern.

## 3.6 Practical impact

Untuk engineer:

- gunakan `jakarta.ws.rs.*`;
- pilih runtime Jakarta EE 11-compatible;
- gunakan CDI sebagai component model;
- pastikan JSON provider tersedia;
- jangan asumsi JAXB otomatis;
- cek generated clients/schemas jika migrate dari versi lama.

---

# 4. Dependency dan Runtime

## 4.1 API dependency

Individual API:

```xml
<dependency>
  <groupId>jakarta.ws.rs</groupId>
  <artifactId>jakarta.ws.rs-api</artifactId>
  <version>4.0.0</version>
  <scope>provided</scope>
</dependency>
```

Dalam Jakarta EE Web/Profile/Platform:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-web-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

## 4.2 API jar bukan implementation

`jakarta.ws.rs-api` hanya menyediakan annotation, interface, classes.

Ia tidak menyediakan:

- HTTP server;
- JAX-RS runtime implementation;
- JSON provider;
- servlet container;
- dependency injection container.

Jika kamu hanya membuat plain `java -jar` dengan `jakarta.ws.rs-api`, endpoint tidak akan jalan.

## 4.3 Runtime implementation

Kamu butuh runtime seperti:

- Jakarta EE compatible runtime;
- JAX-RS implementation embedded in runtime;
- framework/runtime that integrates JAX-RS.

Contoh implementation category:

- Jersey-like;
- RESTEasy-like;
- CXF-like;
- runtime-specific JAX-RS implementation.

## 4.4 Container model

Typical:

```text
WAR deployed to runtime
  ↓
runtime scans Application/resource/provider classes
  ↓
registers endpoints
  ↓
handles HTTP request
  ↓
invokes resource method
```

## 4.5 Packaging

WAR deployment:

```text
JAX-RS API scope provided
runtime provides implementation
```

Executable runtime:

```text
follow runtime/framework dependency model
```

## 4.6 Common dependency mistakes

- adding only API and expecting server;
- mixing `javax.ws.rs` and `jakarta.ws.rs`;
- bundling API jar into WAR causing conflict;
- using Jakarta REST 4 API with runtime only supporting 3.x;
- missing JSON provider;
- generated client still imports `javax.ws.rs`.

---

# 5. Application Class dan Base Path

JAX-RS application can be configured with `Application` subclass.

## 5.1 Basic `Application`

```java
@ApplicationPath("/api")
public class CaseApplication extends Application {
}
```

Now resources are under:

```text
/api/...
```

Example:

```java
@Path("/cases")
public class CaseResource {}
```

Full path:

```text
/api/cases
```

## 5.2 Why define Application class?

It defines application root and can provide:

- application path;
- resource classes;
- provider classes;
- singleton instances;
- application properties depending implementation.

## 5.3 Empty subclass

Common:

```java
@ApplicationPath("/api")
public class RestApplication extends Application {
}
```

Runtime discovers resources automatically.

## 5.4 Explicit registration

```java
@ApplicationPath("/api")
public class RestApplication extends Application {
    @Override
    public Set<Class<?>> getClasses() {
        return Set.of(CaseResource.class, ErrorMapper.class);
    }
}
```

Pros:

- explicit;
- predictable;
- smaller scan surface.

Cons:

- must maintain list;
- missed provider/resource if not registered.

## 5.5 Base path versioning

Bad:

```java
@ApplicationPath("/api/v1")
```

Maybe okay if version path strategy is chosen.

Better decision should come from API versioning strategy, not habit.

## 5.6 Common base path mistakes

- double `/api/api`;
- resource path missing slash assumption;
- servlet context path confusion;
- gateway path rewriting;
- mismatch local/prod deployment context.

## 5.7 Runtime path components

Full URL may include:

```text
scheme://host:port/{context-root}/{application-path}/{resource-path}
```

Example:

```text
https://example.com/case-service/api/cases/123
```

Where:

```text
context-root: /case-service
application-path: /api
resource-path: /cases/123
```

---

# 6. Resource Class dan Resource Method

## 6.1 Resource class

A resource class is Java class annotated with `@Path` or containing resource methods/sub-resources.

```java
@Path("/cases")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class CaseResource {
}
```

## 6.2 Resource method

```java
@GET
@Path("/{id}")
public CaseResponse get(@PathParam("id") String id) {
    ...
}
```

Resource method maps an HTTP request.

## 6.3 Common annotations

- `@Path`;
- `@GET`;
- `@POST`;
- `@PUT`;
- `@PATCH`;
- `@DELETE`;
- `@HEAD`;
- `@OPTIONS`;
- `@Consumes`;
- `@Produces`.

## 6.4 Resource class should be thin

Good:

```java
@POST
public Response create(@Valid CreateCaseRequest request, @Context UriInfo uriInfo) {
    CreateCaseResult result = createCase.handle(request.toCommand(actor()));
    URI location = uriInfo.getAbsolutePathBuilder()
            .path(result.caseId().value())
            .build();

    return Response.created(location)
            .entity(CaseResponse.from(result))
            .build();
}
```

Avoid:

- transaction logic;
- SQL logic;
- complex domain rules;
- direct entity mutation;
- external call orchestration;
- giant method.

## 6.5 CDI integration

Resource classes are often CDI-managed in modern Jakarta runtimes.

Use constructor injection if runtime supports it:

```java
@Path("/cases")
public class CaseResource {
    private final CreateCaseUseCase createCase;

    @Inject
    public CaseResource(CreateCaseUseCase createCase) {
        this.createCase = createCase;
    }
}
```

If constructor injection is not working, verify runtime/CDI integration.

## 6.6 Resource instance lifecycle

Do not assume resource class is singleton unless configured/guaranteed.

Avoid mutable request-specific fields:

```java
private String currentCaseId; // bad
```

Use method local variables.

## 6.7 Sub-resource locator

Sub-resource locator returns object that handles deeper path.

```java
@Path("/cases")
public class CaseResource {

    @Path("/{caseId}/documents")
    public DocumentResource documents(@PathParam("caseId") String caseId) {
        return new DocumentResource(caseId);
    }
}
```

Use carefully because manual `new` may bypass CDI unless runtime supports injection for sub-resource instances.

---

# 7. URI Path Matching

## 7.1 Basic path

```java
@Path("/cases")
```

matches:

```text
/cases
```

## 7.2 Path parameter

```java
@GET
@Path("/{id}")
public CaseResponse get(@PathParam("id") String id) {}
```

matches:

```text
/cases/123
```

## 7.3 Regex path parameter

```java
@Path("/{id: [A-Z0-9-]+}")
```

Use sparingly. Complex regex can hurt readability/performance.

## 7.4 Ambiguous paths

Example:

```java
@Path("/{id}")
public CaseResponse getById(...) {}

@Path("/search")
public SearchResponse search(...) {}
```

Request:

```text
/cases/search
```

Depending matching rules, literal path usually should be more specific, but avoid ambiguity by design.

## 7.5 Path design

Good:

```text
/cases
/cases/{caseId}
/cases/{caseId}/documents
/cases/{caseId}/events
```

Bad:

```text
/getCase
/createCase
/doApprove
/caseAction
```

## 7.6 No verbs in resource name unless command resource

Prefer HTTP method for action when resource semantics fit.

However command endpoints can be acceptable when domain action is not simple CRUD.

Example:

```text
POST /cases/{caseId}/approval
POST /cases/{caseId}/rejection
POST /cases/{caseId}/assignment
```

## 7.7 Trailing slash

Decide policy:

```text
/cases
/cases/
```

Should they both work? Redirect? 404?

Be consistent.

## 7.8 URL encoding

Path params are URL-decoded by runtime according to rules.

Be careful with IDs containing `/`, spaces, unicode, reserved characters.

Prefer opaque IDs that are URL-safe.

---

# 8. HTTP Method Semantics

## 8.1 GET

Use for safe read.

Properties:

- safe;
- should not mutate server state;
- cacheable;
- idempotent.

Example:

```java
@GET
@Path("/{id}")
public CaseResponse get(@PathParam("id") String id) {}
```

Do not use GET for command:

```http
GET /cases/123/approve
```

Bad because it mutates state.

## 8.2 POST

Use for create or command processing.

Examples:

```http
POST /cases
POST /cases/{id}/approval
POST /case-searches
```

POST is not inherently idempotent.

Use idempotency key for command endpoints if client retry possible.

## 8.3 PUT

Use for full replacement or idempotent upsert semantics.

Example:

```http
PUT /cases/{id}/profile
```

If repeated with same payload, result should be same.

## 8.4 PATCH

Use for partial update.

Need define patch document semantics:

- JSON Patch;
- JSON Merge Patch;
- custom partial DTO.

## 8.5 DELETE

Use for deleting/removing/canceling resource.

DELETE is idempotent in HTTP semantics: repeating should not create additional different side effects, though response may differ.

## 8.6 HEAD

Like GET without body.

Useful for existence/metadata.

## 8.7 OPTIONS

May be handled by runtime/gateway for allowed methods/CORS.

## 8.8 Method design table

| Operation | Good method/path |
|---|---|
| List cases | `GET /cases` |
| Get case | `GET /cases/{id}` |
| Create case | `POST /cases` |
| Replace profile | `PUT /cases/{id}/profile` |
| Patch details | `PATCH /cases/{id}` |
| Approve case | `POST /cases/{id}/approval` |
| Cancel case | `POST /cases/{id}/cancellation` or `DELETE /cases/{id}` depending domain |
| Search complex | `POST /case-searches` or `GET /cases?...` depending query complexity |

---

# 9. Parameter Injection: Path, Query, Header, Cookie, Matrix, Bean

Jakarta REST can inject request data into method parameters.

## 9.1 `@PathParam`

```java
@GET
@Path("/{id}")
public CaseResponse get(@PathParam("id") String id) {}
```

Convert to domain type manually or via converter.

```java
CaseId caseId = CaseId.of(id);
```

## 9.2 `@QueryParam`

```java
@GET
public CasePage list(
        @QueryParam("status") String status,
        @QueryParam("page") @DefaultValue("0") int page,
        @QueryParam("size") @DefaultValue("20") int size
) {}
```

## 9.3 `@HeaderParam`

```java
@POST
public Response create(
        @HeaderParam("Idempotency-Key") String idempotencyKey,
        CreateCaseRequest request
) {}
```

## 9.4 `@CookieParam`

```java
@CookieParam("SESSION") Cookie sessionCookie
```

Use carefully; REST APIs often prefer Authorization headers/tokens.

## 9.5 `@MatrixParam`

Matrix params are path segment parameters:

```text
/cases;status=OPEN
```

Less common in modern public APIs.

## 9.6 `@BeanParam`

Group parameters into object:

```java
public class CaseSearchParams {
    @QueryParam("status")
    public String status;

    @QueryParam("page")
    @DefaultValue("0")
    public int page;

    @QueryParam("size")
    @DefaultValue("20")
    public int size;
}
```

Resource:

```java
@GET
public CasePage list(@BeanParam CaseSearchParams params) {}
```

## 9.7 `@Context`

Inject context objects:

```java
@Context UriInfo uriInfo
@Context HttpHeaders headers
@Context SecurityContext securityContext
@Context Request request
```

Use for protocol metadata.

## 9.8 Type conversion

JAX-RS can convert simple types from string.

For domain types, use:

- static `valueOf(String)`;
- constructor from String;
- `ParamConverterProvider`.

But do not over-magic all conversion.

## 9.9 Validation

Parameter validation can use Bean Validation depending integration:

```java
@QueryParam("size")
@Min(1)
@Max(100)
int size
```

## 9.10 Parameter design warning

Too many query parameters mean API might need a search resource/POST search request.

---

# 10. Entity Body: Request Payload dan Response Payload

## 10.1 Single entity parameter

Resource method can have entity body parameter:

```java
@POST
public Response create(CreateCaseRequest request) {}
```

Generally one unannotated parameter represents entity body.

## 10.2 Request DTO

```java
public record CreateCaseRequest(
    String applicantId,
    String caseType,
    String description
) {}
```

Do not expose JPA entity directly.

## 10.3 Response DTO

```java
public record CaseResponse(
    String caseId,
    String status,
    Instant createdAt,
    List<LinkResponse> links
) {}
```

## 10.4 Entity vs DTO

Bad:

```java
public CaseEntity create(CaseEntity entity) {}
```

Risks:

- persistence fields exposed;
- lazy loading;
- security leak;
- over-posting;
- contract coupled to DB;
- bidirectional relationship recursion;
- accidental updates.

## 10.5 Command mapping

```java
CreateCaseCommand toCommand(Actor actor) {
    return new CreateCaseCommand(
        ApplicantId.of(applicantId),
        CaseType.of(caseType),
        Description.of(description),
        actor
    );
}
```

## 10.6 Large payload

For large uploads:

- avoid loading entire payload into memory;
- use streaming/multipart support depending runtime/provider;
- set size limit;
- validate content type;
- scan if file;
- store to object storage;
- trace upload.

## 10.7 Response streaming

For large download:

- streaming output;
- proper content headers;
- range requests if needed;
- backpressure/connection handling;
- timeout.

## 10.8 Immutable DTO

Records are good for request/response DTO if JSON provider supports them.

Be careful with:

- default constructor requirements;
- validation support;
- date/time serialization;
- backward compatibility.

---

# 11. `Response` dan Status Code Design

## 11.1 Returning DTO directly

```java
@GET
public CaseResponse get(...) {
    return response;
}
```

Simple and good for 200 OK.

## 11.2 Returning `Response`

```java
return Response.status(Response.Status.CREATED)
        .entity(body)
        .header("Location", location)
        .build();
```

Use when controlling:

- status;
- headers;
- cookies;
- location;
- cache;
- entity;
- media type.

## 11.3 Status code guide

| Situation | Status |
|---|---|
| Successful GET | 200 |
| Created resource | 201 + Location |
| Accepted async command | 202 |
| Successful no body | 204 |
| Invalid syntax/payload | 400 |
| Unauthenticated | 401 |
| Authenticated but forbidden | 403 |
| Resource not found | 404 |
| Method not allowed | 405 |
| Conflict/current state prevents action | 409 |
| Unsupported media type | 415 |
| Validation semantic error | 400 or 422 depending API standard |
| Rate limited | 429 |
| Unexpected server error | 500 |
| Downstream unavailable | 502/503 depending gateway/service role |
| Timeout | 504 or app-specific 503/500 depending layer |

## 11.4 201 Created

For resource creation:

```java
URI location = uriInfo.getAbsolutePathBuilder()
        .path(result.caseId().value())
        .build();

return Response.created(location)
        .entity(CaseResponse.from(result))
        .build();
```

## 11.5 202 Accepted

For async processing:

```java
return Response.accepted(new CommandAcceptedResponse(commandId, statusUrl))
        .location(statusUrl)
        .build();
```

## 11.6 204 No Content

For delete/update with no body:

```java
return Response.noContent().build();
```

Do not return body with 204.

## 11.7 Avoid always 200

Bad:

```json
{
  "success": false,
  "error": "not found"
}
```

with HTTP 200.

This breaks HTTP semantics.

## 11.8 Error code consistency

Use HTTP status + stable application error code.

Example:

```json
{
  "errorCode": "CASE_NOT_FOUND",
  "message": "Case was not found.",
  "correlationId": "..."
}
```

---

# 12. Content Negotiation: `@Consumes`, `@Produces`, `Accept`, `Content-Type`

## 12.1 `@Consumes`

Defines request media types resource can consume.

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response create(CreateCaseRequest request) {}
```

Client must send:

```http
Content-Type: application/json
```

If not, 415 may occur.

## 12.2 `@Produces`

Defines response media types.

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public CaseResponse get(...) {}
```

Client can send:

```http
Accept: application/json
```

If not acceptable, 406 may occur.

## 12.3 Class-level default

```java
@Path("/cases")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class CaseResource {}
```

## 12.4 Method-level override

```java
@GET
@Path("/{id}/document")
@Produces("application/pdf")
public Response download(...) {}
```

## 12.5 Content negotiation failure

- `415 Unsupported Media Type`: server cannot consume request Content-Type.
- `406 Not Acceptable`: server cannot produce requested Accept type.

## 12.6 Vendor media types

For versioning:

```text
application/vnd.example.case.v1+json
```

Useful but increases complexity.

## 12.7 Charset

For JSON, UTF-8 is standard expectation.

Avoid inconsistent encodings.

## 12.8 Contract tests

Test content negotiation explicitly:

- correct content type;
- missing content type;
- wrong content type;
- wrong accept;
- multiple accept values.

---

# 13. Providers: MessageBodyReader/Writer, ContextResolver, ParamConverter

Providers extend Jakarta REST behavior.

## 13.1 `MessageBodyReader`

Reads request entity body into Java type.

```java
@Provider
@Consumes("application/vnd.example.case+json")
public class CaseRequestReader implements MessageBodyReader<CreateCaseRequest> {
    ...
}
```

## 13.2 `MessageBodyWriter`

Writes Java type to response entity.

```java
@Provider
@Produces("application/vnd.example.case+json")
public class CaseResponseWriter implements MessageBodyWriter<CaseResponse> {
    ...
}
```

## 13.3 ContextResolver

Provides contextual objects, commonly JSON mapper config.

```java
@Provider
public class JsonbConfigResolver implements ContextResolver<Jsonb> {
    ...
}
```

or for Jackson in runtime supporting it:

```java
@Provider
public class ObjectMapperResolver implements ContextResolver<ObjectMapper> {
    ...
}
```

## 13.4 ParamConverterProvider

Convert path/query/header string values into custom types.

```java
@Provider
public class CaseIdParamConverterProvider implements ParamConverterProvider {
    ...
}
```

Then:

```java
@GET
@Path("/{id}")
public CaseResponse get(@PathParam("id") CaseId id) {}
```

## 13.5 Provider discovery

Provider must be discovered/registered.

Ways:

- `@Provider` scanning;
- `Application#getClasses`;
- runtime config;
- feature registration.

## 13.6 Provider ordering

Some providers can have priority.

Understand runtime/provider selection rules.

## 13.7 Provider anti-pattern

Do not create provider that globally changes JSON format unexpectedly.

JSON contract change can break clients.

## 13.8 Provider testing

Test providers directly and through integration endpoint.

---

# 14. JSON Integration: JSON-B, JSON-P, Jackson, dan Contract Stability

Jakarta REST itself defines REST API. JSON serialization is provider responsibility.

## 14.1 JSON-B

Jakarta JSON Binding provides standard binding.

Good for:

- Jakarta-standard stack;
- simple DTO mapping;
- portable API;
- integration with Jakarta runtime.

## 14.2 JSON-P

Jakarta JSON Processing provides object/streaming model.

Good for:

- low-level JSON manipulation;
- streaming;
- patch;
- dynamic JSON;
- memory-sensitive processing.

## 14.3 Jackson

Jackson is popular in Java ecosystem.

Some Jakarta runtimes/frameworks support Jackson provider integration.

Pros:

- rich features;
- huge ecosystem;
- Spring familiarity;
- advanced configuration.

Cons:

- not Jakarta standard JSON-B;
- provider/runtime-specific integration;
- contract may differ from JSON-B.

## 14.4 Contract stability

Whatever provider used, freeze contract with tests.

Golden JSON test:

```json
{
  "caseId": "CASE-001",
  "status": "OPEN",
  "createdAt": "2026-06-12T10:15:30Z"
}
```

## 14.5 Date/time

Be explicit.

Prefer ISO-8601 string for API.

Avoid provider default surprise like timestamps.

## 14.6 Unknown fields

Decide policy:

- ignore unknown fields for forward compatibility;
- reject unknown fields for strict contracts.

Document.

## 14.7 Null fields

Decide:

- include null;
- omit null;
- use explicit empty array/object;
- avoid ambiguous missing vs null.

## 14.8 Enum serialization

Avoid exposing raw Java enum names if names may change.

Consider stable string values.

## 14.9 Records

Java records are good DTOs, but verify provider support and validation behavior.

---

# 15. Filters: Request/Response Pipeline

JAX-RS filters operate on request/response.

## 15.1 ContainerRequestFilter

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class CorrelationIdFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String correlationId = requestContext.getHeaderString("X-Correlation-Id");
        ...
    }
}
```

## 15.2 ContainerResponseFilter

```java
@Provider
public class SecurityHeadersFilter implements ContainerResponseFilter {

    @Override
    public void filter(ContainerRequestContext request, ContainerResponseContext response) {
        response.getHeaders().putSingle("X-Content-Type-Options", "nosniff");
    }
}
```

## 15.3 Use cases

Request filters:

- authentication;
- correlation ID;
- tenant resolution;
- request logging;
- rate limit;
- request size policy;
- CORS preflight;
- feature flag;
- header validation.

Response filters:

- security headers;
- response logging;
- correlation header;
- cache headers;
- CORS headers.

## 15.4 Abort request

A request filter can abort:

```java
requestContext.abortWith(Response.status(401).build());
```

Use for auth/rate limit/invalid headers.

## 15.5 Priority

Filter order matters.

Use constants:

```java
@Priority(Priorities.AUTHENTICATION)
```

or application-specific constants.

## 15.6 Name binding

JAX-RS supports name binding for filters/interceptors.

Example:

```java
@NameBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface Logged {}
```

Then filter:

```java
@Logged
@Provider
public class LoggedFilter implements ContainerRequestFilter { ... }
```

Apply:

```java
@Logged
@GET
public CaseResponse get(...) {}
```

## 15.7 Filter vs resource

Do not put business logic in filter.

Filter should handle protocol/cross-cutting concerns.

## 15.8 Filter ThreadLocal cleanup

If setting MDC/ThreadLocal:

```java
try {
    ...
} finally {
    ...
}
```

Response filter may not run in all exceptional paths depending runtime. Use robust cleanup.

---

# 16. JAX-RS Interceptors: Entity Stream Interception

JAX-RS interceptors differ from Jakarta/CDI interceptors.

## 16.1 ReaderInterceptor

Intercepts entity input stream before MessageBodyReader.

Use cases:

- decompression;
- request body logging with limits;
- encryption/decryption;
- input stream wrapping.

## 16.2 WriterInterceptor

Intercepts entity output stream before MessageBodyWriter writes response.

Use cases:

- compression;
- response body signing;
- output stream wrapping;
- response body logging with limits.

## 16.3 Example

```java
@Provider
public class BodySizeLimitReaderInterceptor implements ReaderInterceptor {
    @Override
    public Object aroundReadFrom(ReaderInterceptorContext context)
            throws IOException, WebApplicationException {
        // wrap input stream with limiting stream
        return context.proceed();
    }
}
```

## 16.4 Use carefully

Entity stream interception can be expensive and dangerous.

Do not log full body by default.

Risks:

- memory blowup;
- PII leak;
- consumed stream;
- backpressure issues;
- performance overhead.

## 16.5 Difference from CDI interceptor

JAX-RS interceptor:

```text
intercepts HTTP entity stream serialization/deserialization
```

CDI interceptor:

```text
intercepts business method invocation
```

---

# 17. CDI Interceptors vs JAX-RS Filters/Interceptors

## 17.1 JAX-RS filter

Works at HTTP request/response level.

Good for:

- headers;
- auth token extraction;
- CORS;
- correlation ID;
- status/header manipulation;
- request abort.

## 17.2 JAX-RS interceptor

Works at entity stream read/write level.

Good for:

- body transformation;
- stream wrapping;
- compression/encryption.

## 17.3 CDI interceptor

Works at method invocation level.

Good for:

- audit use case method;
- metrics around application service;
- policy enforcement;
- transaction-ish cross-cutting;
- tracing internal call.

## 17.4 Where to put concern?

| Concern | Best place |
|---|---|
| Correlation header | JAX-RS filter |
| CORS | JAX-RS filter / gateway |
| Authentication token parsing | filter/security layer |
| Domain authorization | application service/domain policy |
| Method latency metric | CDI interceptor or JAX-RS filter |
| HTTP response security header | response filter |
| Body compression | server/gateway or writer interceptor |
| Audit business command | application service/domain event or CDI interceptor |
| JSON mapping config | provider/context resolver |
| Error response | ExceptionMapper |

## 17.5 Avoid duplicate instrumentation

If gateway, runtime, OpenTelemetry agent, filter, and CDI interceptor all create spans/logs, output becomes noisy.

Decide layers.

---

# 18. Exception Mapping: Error Contract Production-Grade

Unhandled exceptions can leak internal detail.

Use `ExceptionMapper`.

## 18.1 Basic mapper

```java
@Provider
public class CaseNotFoundMapper implements ExceptionMapper<CaseNotFoundException> {

    @Override
    public Response toResponse(CaseNotFoundException ex) {
        ErrorResponse body = new ErrorResponse(
                "CASE_NOT_FOUND",
                "Case was not found.",
                correlationId()
        );

        return Response.status(Response.Status.NOT_FOUND)
                .entity(body)
                .type(MediaType.APPLICATION_JSON)
                .build();
    }
}
```

## 18.2 Error response shape

Example:

```json
{
  "errorCode": "CASE_NOT_FOUND",
  "message": "Case was not found.",
  "details": [],
  "correlationId": "b91d70f2",
  "timestamp": "2026-06-12T10:15:30Z"
}
```

## 18.3 Do not expose stack trace

Bad:

```json
{
  "exception": "java.sql.SQLException",
  "stackTrace": "..."
}
```

## 18.4 Stable error codes

Use stable machine-readable codes:

```text
CASE_NOT_FOUND
CASE_ALREADY_CLOSED
VALIDATION_FAILED
UNAUTHORIZED_ACTION
IDEMPOTENCY_KEY_CONFLICT
```

## 18.5 Mapper hierarchy

Specific mapper beats generic mapper depending rules.

Have:

- domain exception mapper;
- validation exception mapper;
- authentication/authorization mapper if needed;
- generic fallback mapper.

## 18.6 Generic fallback mapper

```java
@Provider
public class UnhandledExceptionMapper implements ExceptionMapper<Throwable> {
    public Response toResponse(Throwable ex) {
        log.error("Unhandled error", ex);
        return Response.serverError()
                .entity(ErrorResponse.internal(correlationId()))
                .build();
    }
}
```

Be careful mapping `Throwable`; some runtimes have built-in mappers and behavior.

## 18.7 `WebApplicationException`

JAX-RS has `WebApplicationException` carrying response.

Do not throw it everywhere from domain/application layer. Keep HTTP concerns in API layer.

## 18.8 Problem Details

Consider RFC 7807/9457 Problem Details style if project standard allows.

Example media type:

```text
application/problem+json
```

Fields:

```json
{
  "type": "https://example.com/problems/case-not-found",
  "title": "Case not found",
  "status": 404,
  "detail": "Case was not found.",
  "instance": "/cases/CASE-001"
}
```

## 18.9 Error contract tests

Test:

- invalid JSON;
- validation failure;
- not found;
- conflict;
- unauthorized;
- forbidden;
- unsupported media type;
- unhandled exception.

---

# 19. Validation Integration

Jakarta REST integrates with Bean Validation in Jakarta EE runtimes.

## 19.1 Request body validation

```java
@POST
public Response create(@Valid CreateCaseRequest request) {
    ...
}
```

DTO:

```java
public record CreateCaseRequest(
    @NotBlank String applicantId,
    @NotBlank String caseType,
    @Size(max = 2000) String description
) {}
```

## 19.2 Parameter validation

```java
@GET
public CasePage list(
        @QueryParam("page") @Min(0) int page,
        @QueryParam("size") @Min(1) @Max(100) int size
) {}
```

## 19.3 Validation error mapping

Map validation exceptions to stable error response.

Example:

```json
{
  "errorCode": "VALIDATION_FAILED",
  "details": [
    {
      "field": "description",
      "message": "must not exceed 2000 characters"
    }
  ]
}
```

## 19.4 Input validation vs domain validation

Input validation:

```text
field present, string length, format
```

Domain validation:

```text
case can only be approved when status is UNDER_REVIEW
officer must be assigned
deadline not expired
```

Do not put all domain rules into Bean Validation annotations.

## 19.5 Validation groups

Can be useful for create/update differences.

But overuse makes validation hard to understand.

## 19.6 Security

Validation prevents malformed input, not authorization.

Do not confuse.

---

# 20. Security Integration

Jakarta REST can integrate with Jakarta Security/container security/CDI security.

## 20.1 SecurityContext

```java
@Context
SecurityContext securityContext;
```

Use to access:

- principal;
- authentication scheme;
- role checks.

## 20.2 Role annotation

```java
@RolesAllowed("OFFICER")
@POST
@Path("/{id}/approval")
public Response approve(...) {}
```

Works if runtime/security configured to enforce.

## 20.3 Authentication

May be handled by:

- container;
- Jakarta Security;
- OIDC/JWT runtime feature;
- gateway;
- filter;
- custom mechanism.

Document source of truth.

## 20.4 Authorization levels

1. Endpoint-level role.
2. Use case permission.
3. Domain/resource-level policy.
4. Data filtering.
5. Audit.

Example:

```java
authorization.checkCanApprove(actor, case);
```

must be explicit domain logic.

## 20.5 Do not trust client-provided actor

Bad:

```json
{
  "approvedBy": "officer-123"
}
```

Server should derive actor from authenticated identity.

## 20.6 Security headers

Set in response filter or gateway:

- `X-Content-Type-Options`;
- `Cache-Control`;
- `Content-Security-Policy` for browser apps;
- CORS policy;
- HSTS at edge.

## 20.7 CORS

CORS is browser security policy, not authentication.

Configure carefully:

- allowed origins;
- methods;
- headers;
- credentials;
- preflight max age.

Do not use `*` with credentials.

## 20.8 Audit

For critical commands, log/audit:

- actor;
- action;
- resource;
- decision;
- reason;
- timestamp;
- correlation ID.

---

# 21. Asynchronous Server API

Jakarta REST supports asynchronous server-side response processing.

## 21.1 `AsyncResponse`

```java
@GET
@Path("/{id}/report")
public void generateReport(
        @PathParam("id") String id,
        @Suspended AsyncResponse async
) {
    executor.submit(() -> {
        try {
            Report report = reportService.generate(id);
            async.resume(Response.ok(report).build());
        } catch (Exception e) {
            async.resume(e);
        }
    });
}
```

## 21.2 Why async?

Use for:

- long-running operation;
- freeing request thread;
- non-blocking flow;
- async backend;
- streaming/SSE.

## 21.3 Timeout

Set timeout:

```java
async.setTimeout(30, TimeUnit.SECONDS);
async.setTimeoutHandler(ar ->
    ar.resume(Response.status(503)
        .entity(ErrorResponse.timeout())
        .build())
);
```

## 21.4 Do not create unmanaged threads

Use managed executor/container-supported async.

Manual threads can lose context and leak.

## 21.5 Context concerns

Async execution may lose:

- security context;
- request context;
- MDC;
- transaction;
- CDI request scope.

Capture necessary immutable data.

## 21.6 Alternative: return `CompletionStage`

Jakarta REST supports async patterns using completion types depending version/runtime.

Example conceptual:

```java
@GET
public CompletionStage<CaseResponse> getAsync(...) {
    return service.getAsync(...);
}
```

Verify runtime support.

## 21.7 For long business process

For truly long process, do not hold HTTP connection.

Use:

```text
POST command → 202 Accepted → status endpoint / SSE
```

---

# 22. Server-Sent Events/SSE

SSE allows server to stream events to client over HTTP.

## 22.1 Use cases

- status updates;
- notifications;
- progress events;
- monitoring dashboard;
- command status;
- read model catch-up.

## 22.2 JAX-RS SSE API

Jakarta REST includes SSE server API.

Conceptual:

```java
@GET
@Path("/cases/{id}/events")
@Produces(MediaType.SERVER_SENT_EVENTS)
public void events(@Context SseEventSink sink, @Context Sse sse) {
    OutboundSseEvent event = sse.newEventBuilder()
            .name("case-status")
            .data(String.class, "APPROVED")
            .build();

    sink.send(event);
}
```

## 22.3 SSE vs WebSocket

SSE:

- server → client;
- HTTP-friendly;
- auto-reconnect in browsers;
- simpler for event stream.

WebSocket:

- bidirectional;
- stateful connection;
- more complex scaling.

## 22.4 Production concerns

- connection count;
- heartbeat;
- timeout;
- backpressure;
- reconnect;
- last-event-id;
- authorization;
- tenant isolation;
- resource cleanup;
- cluster fanout;
- sticky session/gateway behavior.

## 22.5 Do not stream unbounded without control

Track:

- open sinks;
- per-client queue;
- dropped events;
- slow clients;
- memory.

---

# 23. Jakarta REST Client API

Jakarta REST includes a Client API for calling HTTP services.

## 23.1 Basic client

```java
Client client = ClientBuilder.newClient();

CaseResponse response = client
        .target("https://api.example.com")
        .path("/cases/{id}")
        .resolveTemplate("id", "CASE-001")
        .request(MediaType.APPLICATION_JSON)
        .get(CaseResponse.class);
```

## 23.2 Resource management

Close client:

```java
client.close();
```

Better: create and manage client lifecycle as application-scoped resource.

## 23.3 Timeouts

Always configure timeouts.

Exact properties can be implementation-specific.

Without timeout, threads can hang.

## 23.4 Filters

Client filters can add:

- auth headers;
- correlation ID;
- tracing;
- logging;
- retry metadata.

## 23.5 Error handling

Do not blindly call `.get(Entity.class)` without handling non-2xx.

Use `Response`:

```java
Response response = request.get();
if (response.getStatus() == 404) ...
```

## 23.6 Retry

HTTP client retry must respect idempotency.

Safe retries:

- GET usually;
- PUT/DELETE depending semantics;
- POST only with idempotency key or proven safe.

## 23.7 Connection pooling

Client implementation may use connection pooling.

Manage:

- max connections;
- per-route connections;
- idle timeout;
- TLS;
- DNS;
- keepalive;
- circuit breaker.

## 23.8 Avoid per-request Client creation

Bad:

```java
Client client = ClientBuilder.newClient();
try {
    ...
} finally {
    client.close();
}
```

for every request.

Use shared client per target with proper config.

---

# 24. API Design: Resource Modeling

## 24.1 Resource nouns

Prefer nouns:

```text
/cases
/cases/{id}
/cases/{id}/documents
/cases/{id}/events
```

## 24.2 Actions as sub-resources

For domain commands:

```text
POST /cases/{id}/approval
POST /cases/{id}/rejection
POST /cases/{id}/assignment
```

This is acceptable when approval/rejection are domain events/resources.

## 24.3 Avoid RPC-style naming

Avoid:

```text
/approveCase
/rejectCase
/processCase
/getCaseList
```

## 24.4 Resource granularity

Too coarse:

```text
/api
```

Too fine:

```text
/cases/{id}/status/value/current/read
```

Find domain boundary.

## 24.5 URI stability

Avoid embedding implementation details:

```text
/jpa/case-table/{id}
```

## 24.6 Link relation

For hypermedia/internal API, include links if useful:

```json
{
  "caseId": "CASE-001",
  "status": "UNDER_REVIEW",
  "links": [
    { "rel": "approve", "href": "/cases/CASE-001/approval", "method": "POST" }
  ]
}
```

Do not overdo HATEOAS if clients do not use it.

## 24.7 Naming convention

Decide:

- plural nouns;
- kebab-case paths;
- camelCase JSON fields;
- stable enum strings;
- timestamp format;
- error code format.

Document.

---

# 25. Command API, Idempotency, dan Duplicate Request

POST commands are often not idempotent.

## 25.1 Duplicate scenario

```text
client sends approve
server processes success
network times out before response
client retries
server approves again / sends duplicate notification
```

## 25.2 Idempotency-Key

Require:

```http
Idempotency-Key: 01JZ...
```

For critical commands:

```java
@POST
@Path("/{id}/approval")
public Response approve(
        @PathParam("id") String id,
        @HeaderParam("Idempotency-Key") String idempotencyKey,
        ApproveCaseRequest request
) {}
```

## 25.3 Server behavior

```text
if key not seen:
  reserve key + request hash
  process command
  store result
  return result

if key seen with same request:
  return stored result

if key seen with different request:
  409 Conflict
```

## 25.4 Store idempotency with transaction

Use DB unique constraint.

```sql
CREATE TABLE idempotency_record (
    idempotency_key VARCHAR(200) PRIMARY KEY,
    request_hash VARCHAR(128) NOT NULL,
    response_json JSONB,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
```

## 25.5 Idempotency response

For conflict:

```json
{
  "errorCode": "IDEMPOTENCY_KEY_CONFLICT",
  "message": "Idempotency key was already used with a different request.",
  "correlationId": "..."
}
```

## 25.6 Which endpoints need idempotency?

Need:

- create payment;
- approve case;
- submit application;
- send notification;
- create order;
- state-changing command with side effects.

Maybe not needed:

- simple GET;
- deterministic PUT replacement;
- safe read-only query.

## 25.7 Client retry policy

Document:

- retryable status codes;
- backoff;
- idempotency requirement;
- timeout.

---

# 26. Pagination, Filtering, Sorting, Search

## 26.1 Offset pagination

```http
GET /cases?page=0&size=20
```

Simple but can be slow/inconsistent for large data.

## 26.2 Cursor pagination

```http
GET /cases?cursor=eyJpZCI6...&limit=20
```

Better for large datasets.

## 26.3 Sorting

```http
GET /cases?sort=createdAt,desc
```

Whitelist sortable fields.

Do not pass raw SQL column names.

## 26.4 Filtering

```http
GET /cases?status=OPEN&assignedTo=officer-1
```

Good for simple filters.

For complex search:

```http
POST /case-searches
```

with body:

```json
{
  "status": ["OPEN", "UNDER_REVIEW"],
  "createdFrom": "2026-01-01",
  "createdTo": "2026-06-01",
  "sort": [{"field": "createdAt", "direction": "DESC"}],
  "limit": 50
}
```

## 26.5 Pagination response

```json
{
  "items": [],
  "page": {
    "size": 20,
    "nextCursor": "...",
    "hasNext": true
  }
}
```

## 26.6 Total count

Total count can be expensive.

Do not always return it if large.

Consider:

- optional count;
- approximate count;
- no count;
- asynchronous report.

## 26.7 Validation

Validate:

- size max;
- allowed sort fields;
- date range;
- filter values;
- cursor signature.

## 26.8 Index design

API filtering must align with DB/search index.

Do not expose arbitrary filtering that DB cannot support.

---

# 27. Partial Update: PUT vs PATCH, JSON Patch, JSON Merge Patch

## 27.1 PUT

Full replacement.

```http
PUT /cases/{id}/profile
```

Request represents full profile.

## 27.2 PATCH

Partial update.

```http
PATCH /cases/{id}
Content-Type: application/merge-patch+json
```

## 27.3 JSON Merge Patch

Merge patch represents changes by example object.

```json
{
  "description": "Updated description",
  "assignedOfficer": null
}
```

`null` usually means remove/set null depending semantics.

## 27.4 JSON Patch

JSON Patch is operation list.

```json
[
  { "op": "replace", "path": "/description", "value": "Updated" },
  { "op": "remove", "path": "/assignedOfficer" }
]
```

## 27.5 Jakarta REST 4.0 and JSON Merge Patch

Jakarta REST 4.0 added API support around JSON Merge Patch media type/value.

## 27.6 Domain caution

Partial update can bypass invariants if directly applied to entity.

Bad:

```java
patch.apply(entity);
repository.save(entity);
```

Better:

```java
PatchCaseCommand command = parsePatch(...);
useCase.handle(command);
```

Domain validates transition/invariant.

## 27.7 Audit

Partial update audit should show:

- fields changed;
- actor;
- reason;
- old/new values if allowed;
- policy version.

## 27.8 Concurrency

Use ETag/version:

```http
If-Match: "v42"
```

Avoid lost updates.

---

# 28. Caching: ETag, Last-Modified, Cache-Control

## 28.1 Cache-Control

For sensitive data:

```http
Cache-Control: no-store
```

For public cacheable data:

```http
Cache-Control: max-age=3600
```

## 28.2 ETag

ETag represents resource version.

Response:

```http
ETag: "case-123-v42"
```

Client:

```http
If-None-Match: "case-123-v42"
```

If unchanged:

```http
304 Not Modified
```

## 28.3 Lost update prevention

Client update:

```http
If-Match: "case-123-v42"
```

If current version differs:

```http
412 Precondition Failed
```

## 28.4 Last-Modified

Use timestamp-based validation.

Less precise than strong ETag.

## 28.5 JAX-RS Request evaluation

`Request` context can help evaluate preconditions.

Conceptual:

```java
@Context Request request;

Response.ResponseBuilder preconditions = request.evaluatePreconditions(entityTag);
if (preconditions != null) {
    return preconditions.build();
}
```

## 28.6 Sensitive systems

For regulatory/personal data, default to conservative caching.

Avoid caching sensitive responses in shared caches.

## 28.7 Cache invalidation

If using cache, define invalidation/TTL/version strategy.

---

# 29. Versioning dan Compatibility

## 29.1 Avoid breaking changes

Breaking examples:

- remove field;
- rename field;
- change enum value;
- change status code;
- change error code;
- change date format;
- change pagination semantics;
- change required field;
- change media type.

## 29.2 Additive changes

Usually safe:

- add optional response field;
- add optional request field if unknown fields ignored;
- add new endpoint;
- add enum value only if clients tolerate unknown values.

## 29.3 Version strategies

### URI version

```text
/api/v1/cases
```

Simple, visible.

### Header/media type version

```http
Accept: application/vnd.example.case.v1+json
```

More REST/content-negotiation oriented but more complex.

### Compatibility without explicit version

Keep API backward compatible over time.

Requires discipline.

## 29.4 Deprecation

Document:

- deprecated endpoint/field;
- replacement;
- date;
- removal plan;
- telemetry usage.

## 29.5 Consumer-driven contract tests

For internal clients, use contract tests to prevent breaking change.

## 29.6 Golden JSON tests

Freeze serialization.

## 29.7 API changelog

Maintain:

```text
Added
Changed
Deprecated
Removed
Fixed
Security
```

---

# 30. OpenAPI dan Documentation Strategy

Jakarta REST annotations can be used with tools/frameworks to generate OpenAPI, often through MicroProfile OpenAPI or runtime tooling.

## 30.1 Documentation should include

- endpoint;
- method;
- auth;
- request schema;
- response schema;
- status codes;
- error codes;
- idempotency;
- pagination;
- rate limit;
- examples;
- deprecation notes.

## 30.2 Do not rely solely on generated docs

Generated docs can miss business semantics.

Add human-written notes.

## 30.3 Examples

Include realistic examples:

- success;
- validation failure;
- conflict;
- not found;
- unauthorized;
- idempotency retry.

## 30.4 Documentation as contract

API docs should be reviewed like code.

## 30.5 Drift prevention

- generate from tests/spec;
- contract tests;
- CI check;
- docs versioned with code.

---

# 31. Observability: Logs, Metrics, Traces

## 31.1 Logs

Use structured logs:

```json
{
  "level": "INFO",
  "event": "http_request_completed",
  "method": "POST",
  "pathTemplate": "/cases/{id}/approval",
  "status": 200,
  "durationMs": 42,
  "correlationId": "..."
}
```

Avoid raw path high-cardinality if metrics label.

## 31.2 Metrics

Important:

- request count;
- request duration;
- error count;
- status class;
- endpoint/template;
- payload size;
- active requests;
- exception count.

Label cardinality:

Good:

```text
method=POST
route=/cases/{id}/approval
status=200
```

Bad:

```text
path=/cases/CASE-123/approval
```

## 31.3 Traces

Trace spans:

```text
HTTP server span
  → application service
  → DB
  → external API
  → Kafka publish
```

Propagate trace headers.

## 31.4 Correlation ID

Accept or generate:

```http
X-Correlation-Id
```

Return in response.

## 31.5 Error response

Include correlation ID.

## 31.6 Audit vs logs

Audit is business/regulatory evidence.

Logs are operational diagnostic data.

Do not substitute one for the other.

---

# 32. Performance Engineering

## 32.1 Avoid heavy resource methods

Resource should not perform heavy mapping/reflection repeatedly.

## 32.2 JSON serialization

Watch:

- per-request mapper creation;
- reflection cost;
- large object graphs;
- lazy JPA relationships;
- circular references;
- huge payload;
- date formatting overhead.

## 32.3 N+1 query via response mapping

Bad:

```java
entity.getDocuments().size()
```

inside DTO mapper for list of cases.

Use projection/read model.

## 32.4 Streaming

Use streaming for large files.

Avoid `byte[]` for huge response.

## 32.5 Compression

Prefer server/gateway-level compression.

If using writer interceptor, test overhead.

## 32.6 Connection/resource usage

Each request can hold:

- request thread/virtual thread;
- DB connection;
- transaction;
- memory buffers;
- response stream;
- downstream connection.

Minimize time holding scarce resources.

## 32.7 Timeouts

Set timeouts for downstream.

Do not let request hang indefinitely.

## 32.8 Backpressure

For high-load APIs:

- rate limit;
- queue bound;
- reject fast;
- async status endpoints;
- bulkhead.

## 32.9 JFR

Use JFR to inspect:

- CPU;
- allocation;
- socket I/O;
- lock contention;
- exception volume;
- serialization hotspots.

---

# 33. Testing Strategy

## 33.1 Unit test resource mapping

You can unit-test mapping logic if resource is simple.

But resource behavior often needs integration.

## 33.2 Integration test with runtime

Test:

- path matching;
- status code;
- headers;
- content negotiation;
- JSON serialization;
- validation;
- exception mapper;
- filters;
- security;
- CDI injection.

## 33.3 Testcontainers

Run real runtime/dependencies:

- database;
- message broker;
- service dependencies.

## 33.4 Contract tests

For API clients:

- request/response schema;
- error formats;
- status codes.

## 33.5 Negative tests

- invalid JSON;
- missing Content-Type;
- wrong Accept;
- invalid path param;
- unauthorized;
- forbidden;
- not found;
- conflict;
- duplicate idempotency key.

## 33.6 Performance tests

- list endpoint with large data;
- JSON serialization;
- pagination;
- concurrent POST commands;
- downstream timeout;
- large upload/download.

## 33.7 Security tests

- auth missing;
- wrong role;
- tenant escape;
- injection payload;
- CORS misconfig;
- sensitive data in response.

---

# 34. Common Failure Modes

## 34.1 Endpoint not found

Causes:

- missing `@ApplicationPath`;
- wrong context root;
- resource not discovered;
- package not scanned;
- path mismatch;
- gateway rewrite;
- deployment failure.

## 34.2 405 Method Not Allowed

Path exists, method not supported.

Check `@GET/@POST`.

## 34.3 415 Unsupported Media Type

Request `Content-Type` not supported by `@Consumes` or provider missing.

## 34.4 406 Not Acceptable

Client `Accept` cannot be produced by `@Produces`.

## 34.5 400 Bad Request

Invalid query/path conversion, invalid JSON, validation failure.

Need stable mapper.

## 34.6 500 due to JSON serialization

Causes:

- lazy JPA proxy;
- circular object graph;
- unsupported type;
- date/time provider issue;
- no no-arg constructor if provider needs it;
- record unsupported in old provider.

## 34.7 Exception mapper not used

Causes:

- mapper not registered/discovered;
- wrong generic type;
- another mapper more specific;
- exception wrapped;
- runtime config.

## 34.8 Filter not invoked

Causes:

- not `@Provider`;
- name binding mismatch;
- not registered;
- wrong priority assumption;
- path not under app.

## 34.9 Security not enforced

Causes:

- security not configured;
- annotation not supported for component;
- method not invoked through managed boundary;
- gateway bypass;
- tests bypass auth.

## 34.10 Slow endpoint

Causes:

- DB query;
- N+1;
- serialization;
- downstream;
- connection pool wait;
- CPU throttling;
- blocking I/O;
- large response;
- logging full body.

---

# 35. Production Checklist

## 35.1 API contract

- [ ] URI design reviewed.
- [ ] HTTP methods semantically correct.
- [ ] Status codes consistent.
- [ ] Error contract stable.
- [ ] Content types documented.
- [ ] Versioning strategy defined.
- [ ] Pagination/filtering bounded.
- [ ] Idempotency defined for commands.

## 35.2 Implementation

- [ ] Resource class thin.
- [ ] DTO separate from entity.
- [ ] Exception mappers registered.
- [ ] Validation integrated.
- [ ] Providers registered intentionally.
- [ ] Filters/interceptors ordered.
- [ ] JSON config explicit.
- [ ] No per-request heavy object creation.

## 35.3 Security

- [ ] Authentication configured.
- [ ] Authorization policy tested.
- [ ] Actor derived server-side.
- [ ] Sensitive fields not exposed.
- [ ] CORS configured.
- [ ] Security headers added where relevant.
- [ ] Audit for critical commands.

## 35.4 Operability

- [ ] Structured access logs.
- [ ] Metrics by route template.
- [ ] Tracing enabled.
- [ ] Correlation ID returned.
- [ ] Timeouts set.
- [ ] Rate limit/backpressure.
- [ ] Health/readiness.
- [ ] Runbook.

## 35.5 Testing

- [ ] Integration tests cover endpoints.
- [ ] Contract tests.
- [ ] Negative tests.
- [ ] Security tests.
- [ ] Performance tests.
- [ ] Serialization golden tests.

---

# 36. Case Study 1: Endpoint Tidak Ditemukan

## 36.1 Symptom

```http
GET /api/cases
404 Not Found
```

## 36.2 Code

```java
@Path("/cases")
public class CaseResource {}
```

But no `Application` class.

## 36.3 Possible causes

- no `@ApplicationPath`;
- context root different;
- resource not discovered;
- app failed deployment;
- gateway strips `/api`;
- wrong HTTP method;
- runtime lacks JAX-RS.

## 36.4 Fix

Add:

```java
@ApplicationPath("/api")
public class RestApplication extends Application {}
```

Verify full path:

```text
/{context-root}/api/cases
```

## 36.5 Prevention

- endpoint smoke test;
- deployment logs;
- route documentation;
- gateway path contract.

---

# 37. Case Study 2: `415 Unsupported Media Type`

## 37.1 Symptom

Client sends:

```http
POST /api/cases
Content-Type: text/plain
```

Server expects:

```java
@Consumes(MediaType.APPLICATION_JSON)
```

## 37.2 Root cause

Request media type unsupported.

## 37.3 Fix client

```http
Content-Type: application/json
```

## 37.4 Fix server only if desired

If server should support more media types, add provider/consumes.

## 37.5 Error response

Map to stable error format if runtime default not acceptable.

---

# 38. Case Study 3: `406 Not Acceptable`

## 38.1 Symptom

Client sends:

```http
Accept: application/xml
```

Resource:

```java
@Produces(MediaType.APPLICATION_JSON)
```

## 38.2 Root cause

Server cannot produce requested media type.

## 38.3 Fix

Client sends:

```http
Accept: application/json
```

or server supports XML intentionally.

## 38.4 Prevention

- API docs;
- contract tests;
- client SDK default Accept.

---

# 39. Case Study 4: Error Contract Bocor Stack Trace

## 39.1 Symptom

500 response:

```json
{
  "exception": "java.lang.NullPointerException",
  "stackTrace": "..."
}
```

## 39.2 Root cause

No generic exception mapper or runtime dev mode exposed detail.

## 39.3 Fix

Add generic mapper:

```java
@Provider
public class GenericExceptionMapper implements ExceptionMapper<Throwable> {
    public Response toResponse(Throwable ex) {
        log.error("Unhandled error", ex);
        return Response.serverError()
                .entity(ErrorResponse.internal(correlationId()))
                .build();
    }
}
```

## 39.4 Prevention

- no stack trace in prod response;
- structured error contract;
- integration test for unhandled exception.

---

# 40. Case Study 5: POST Tidak Idempotent dan Double Submit

## 40.1 Symptom

User retries approve request. Case notification sent twice.

## 40.2 Endpoint

```http
POST /cases/CASE-001/approval
```

No idempotency key.

## 40.3 Root cause

Client retry after timeout produced duplicate side effect.

## 40.4 Fix

Require:

```http
Idempotency-Key
```

Store request hash and response.

## 40.5 Prevention

- API standard for command endpoints;
- idempotency tests;
- unique constraints;
- client retry docs.

---

# 41. Latihan Bertahap

## Latihan 1 — Basic resource

Create:

```java
@ApplicationPath("/api")
public class RestApplication extends Application {}

@Path("/hello")
public class HelloResource {
    @GET
    public String hello() { return "hello"; }
}
```

## Latihan 2 — CRUD cases

Implement:

```text
GET /cases
GET /cases/{id}
POST /cases
POST /cases/{id}/approval
```

## Latihan 3 — Error mapper

Create domain exception and mapper.

## Latihan 4 — Validation

Add Bean Validation to request DTO and query params.

## Latihan 5 — Content negotiation

Test `Content-Type` and `Accept`.

## Latihan 6 — Filter

Add correlation ID filter.

Return `X-Correlation-Id`.

## Latihan 7 — Metrics filter

Record route, method, status, duration.

Avoid high-cardinality path.

## Latihan 8 — Idempotency

Implement idempotency table for approve command.

## Latihan 9 — Client API

Create JAX-RS client with timeout, error handling, correlation header.

## Latihan 10 — SSE

Stream command status update with SSE.

---

# 42. Mini Project: Jakarta REST Production API

## 42.1 Project name

```text
jakarta-rest-production-api
```

## 42.2 Domain

Case management API.

## 42.3 Endpoints

```text
GET    /api/cases
GET    /api/cases/{caseId}
POST   /api/cases
POST   /api/cases/{caseId}/approval
POST   /api/cases/{caseId}/rejection
GET    /api/cases/{caseId}/events
GET    /api/cases/{caseId}/status-stream
PATCH  /api/cases/{caseId}
```

## 42.4 Requirements

- Jakarta REST 4.0;
- CDI;
- JSON-B or selected JSON provider;
- Bean Validation;
- exception mappers;
- correlation ID filter;
- security role check;
- idempotency for command endpoint;
- pagination;
- ETag for GET;
- OpenAPI docs;
- integration tests;
- contract tests;
- performance test;
- runbook.

## 42.5 Docs

```text
README.md
API-CONTRACT.md
ERROR-CONTRACT.md
IDEMPOTENCY.md
PAGINATION.md
SECURITY.md
OBSERVABILITY.md
TESTING.md
RUNBOOK.md
```

## 42.6 Evaluation

You should prove:

- correct status codes;
- stable JSON;
- validation errors mapped;
- duplicate POST safe;
- unauthorized blocked;
- traces/logs contain correlation ID;
- p99 latency under baseline;
- no entity leak;
- no stack trace in response;
- content negotiation tested.

---

# 43. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0  
   https://jakarta.ee/specifications/restful-ws/4.0/

2. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

3. Jakarta RESTful Web Services 4.0 API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/

4. Jakarta EE Tutorial — Building RESTful Web Services with Jakarta REST  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/websvcs/rest/rest.html

5. Jakarta RESTful Web Services Project Page  
   https://jakarta.ee/specifications/restful-ws/

6. Jakarta RESTful Web Services 4.0.0 Release  
   https://projects.eclipse.org/projects/ee4j.rest/releases/4.0.0

7. Jakarta REST AsyncResponse API  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/asyncresponse

8. Jakarta REST 4.0 Specification — Asynchronous Processing and SSE sections  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

---

# Penutup

Jakarta REST `jakarta.ws.rs` adalah salah satu spesifikasi Jakarta yang paling praktis dan paling sering dipakai.

Namun production-grade REST API bukan hanya:

```java
@Path
@GET
@POST
```

Yang jauh lebih penting:

```text
HTTP semantics
resource modeling
status code discipline
error contract
content negotiation
provider/filter pipeline
validation
security
idempotency
observability
compatibility
testing
```

Mental model utama:

```text
Resource class adalah protocol adapter.
Application service adalah use case boundary.
Domain model adalah business truth.
```

Jangan biarkan resource class menjadi god service.

Engineer top-tier tidak hanya bisa membuat endpoint. Ia bisa merancang API yang:

- aman terhadap retry;
- jelas terhadap error;
- mudah diobservasi;
- stabil terhadap perubahan;
- efisien di bawah load;
- tidak membocorkan domain/internal detail;
- bisa dipakai client selama bertahun-tahun.

Bagian berikutnya akan membahas **JSON Processing (`jakarta.json` / JSON-P)**: object model, streaming API, JSON Pointer, JSON Patch, memory trade-off, dan kapan memilih JSON-P dibanding JSON-B/Jackson.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-jakarta-part-008.md](./learn-java-jakarta-part-008.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-java-jakarta-part-010.md](./learn-java-jakarta-part-010.md)
