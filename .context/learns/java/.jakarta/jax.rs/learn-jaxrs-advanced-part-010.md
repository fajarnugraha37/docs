# learn-jaxrs-advanced-part-010.md

# Bagian 010 — Response Entity Writing: `Response`, `GenericEntity`, `StreamingOutput`, Headers, Cookies, Links, Cache, dan `MessageBodyWriter`

> Target pembaca: Java/Jakarta engineer yang ingin menguasai **response writing** di JAX-RS/Jakarta REST secara mendalam. Part ini membahas bagaimana return value Java berubah menjadi HTTP response: kapan return DTO langsung, kapan return `Response`, bagaimana runtime memilih `MessageBodyWriter`, bagaimana menangani generic type dengan `GenericEntity`, bagaimana streaming output besar dengan `StreamingOutput`, bagaimana mengatur status/header/cookie/link/cache/ETag, serta bagaimana mendesain response contract yang aman, stabil, observable, dan production-grade.
>
> Namespace utama: `jakarta.ws.rs.core.Response`, `jakarta.ws.rs.ext.MessageBodyWriter`, `jakarta.ws.rs.core.GenericEntity`, `jakarta.ws.rs.core.StreamingOutput`, `jakarta.ws.rs.core.EntityTag`, `jakarta.ws.rs.core.CacheControl`, `jakarta.ws.rs.core.Link`, `jakarta.ws.rs.core.NewCookie`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Response adalah HTTP Contract, Bukan Sekadar Return Value](#2-mental-model-response-adalah-http-contract-bukan-sekadar-return-value)
3. [Response Pipeline: Java Return Value → `MessageBodyWriter` → HTTP Bytes](#3-response-pipeline-java-return-value--messagebodywriter--http-bytes)
4. [Return DTO Langsung vs Return `Response`](#4-return-dto-langsung-vs-return-response)
5. [Return Type `void`, `null`, DTO, `Response`, `CompletionStage`](#5-return-type-void-null-dto-response-completionstage)
6. [`Response` dan `Response.ResponseBuilder`](#6-response-dan-responseresponsebuilder)
7. [Status Code sebagai Bagian dari Contract](#7-status-code-sebagai-bagian-dari-contract)
8. [`Response.ok()`, `created()`, `accepted()`, `noContent()`, `status()`](#8-responseok-created-accepted-nocontent-status)
9. [`entity(...)`: Response Body dan Metadata](#9-entity-response-body-dan-metadata)
10. [`@Produces` sebagai Kontrak Response Body](#10-produces-sebagai-kontrak-response-body)
11. [`Accept` dan `406 Not Acceptable`](#11-accept-dan-406-not-acceptable)
12. [Bagaimana Runtime Memilih `MessageBodyWriter`](#12-bagaimana-runtime-memilih-messagebodywriter)
13. [`MessageBodyWriter#isWriteable`](#13-messagebodywriteriswriteable)
14. [`MessageBodyWriter#writeTo`](#14-messagebodywriterwriteto)
15. [Provider Registration: `@Provider`, `@Produces`, `@Priority`](#15-provider-registration-provider-produces-priority)
16. [JSON Response DTO Writing](#16-json-response-dto-writing)
17. [DTO Boundary: Jangan Return JPA Entity Langsung](#17-dto-boundary-jangan-return-jpa-entity-langsung)
18. [Records, POJO, JSON-B/Jackson, dan Serialization Shape](#18-records-pojo-json-bjackson-dan-serialization-shape)
19. [Generic Type Problem dan Type Erasure](#19-generic-type-problem-dan-type-erasure)
20. [`GenericEntity<T>` untuk Preserve Generic Type](#20-genericentityt-untuk-preserve-generic-type)
21. [Wrapper DTO vs `GenericEntity`](#21-wrapper-dto-vs-genericentity)
22. [`StreamingOutput`: Response Streaming](#22-streamingoutput-response-streaming)
23. [Streaming Large File / CSV / Export](#23-streaming-large-file--csv--export)
24. [Streaming Error Semantics: Sebelum vs Sesudah Response Commit](#24-streaming-error-semantics-sebelum-vs-sesudah-response-commit)
25. [Binary Download: `Content-Type`, `Content-Length`, `Content-Disposition`](#25-binary-download-content-type-content-length-content-disposition)
26. [Range Request dan Partial Content](#26-range-request-dan-partial-content)
27. [Headers: Metadata, Contract, and Security](#27-headers-metadata-contract-and-security)
28. [`Location` Header untuk `201 Created` dan `202 Accepted`](#28-location-header-untuk-201-created-dan-202-accepted)
29. [`ETag`, `Last-Modified`, dan Conditional Responses](#29-etag-last-modified-dan-conditional-responses)
30. [`CacheControl` dan HTTP Caching](#30-cachecontrol-dan-http-caching)
31. [`Vary` Header dan Content Negotiation](#31-vary-header-dan-content-negotiation)
32. [`Link` Header dan HATEOAS Pragmatic](#32-link-header-dan-hateoas-pragmatic)
33. [Cookies: `NewCookie` dan Response Cookie Security](#33-cookies-newcookie-dan-response-cookie-security)
34. [Security Headers](#34-security-headers)
35. [CORS Headers: Resource vs Filter/Gateway](#35-cors-headers-resource-vs-filtergateway)
36. [Problem Details sebagai Error Response Entity](#36-problem-details-sebagai-error-response-entity)
37. [Response for Collection: Pagination Envelope dan Links](#37-response-for-collection-pagination-envelope-dan-links)
38. [Response for Create/Update/Delete](#38-response-for-createupdatedelete)
39. [Response for Long-Running Operation](#39-response-for-long-running-operation)
40. [Response for File/Document API](#40-response-for-filedocument-api)
41. [Custom `MessageBodyWriter`](#41-custom-messagebodywriter)
42. [Writer vs `WriterInterceptor`](#42-writer-vs-writerinterceptor)
43. [Serialization Failure dan Error Mapping](#43-serialization-failure-dan-error-mapping)
44. [Response Commit, Buffering, dan Observability](#44-response-commit-buffering-dan-observability)
45. [Response Entity dan Transactions](#45-response-entity-dan-transactions)
46. [Response Entity dan Lazy Loading](#46-response-entity-dan-lazy-loading)
47. [Response Entity dan Multi-Tenancy/Security](#47-response-entity-dan-multitenancysecurity)
48. [Testing Response Writing](#48-testing-response-writing)
49. [Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus](#49-runtime-differences-jersey-resteasy-cxf-liberty-quarkus)
50. [Common Failure Modes](#50-common-failure-modes)
51. [Best Practices](#51-best-practices)
52. [Anti-Patterns](#52-anti-patterns)
53. [Production Checklist](#53-production-checklist)
54. [Latihan](#54-latihan)
55. [Referensi Resmi](#55-referensi-resmi)
56. [Penutup](#56-penutup)

---

# 1. Tujuan Part Ini

Part sebelumnya membahas request entity binding.

Sekarang kita membahas sisi sebaliknya:

```text
Java object / Response
  ↓
JAX-RS runtime
  ↓
MessageBodyWriter
  ↓
HTTP response status + headers + body bytes
```

Contoh sederhana:

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public CustomerResponse get(@PathParam("customerId") CustomerId id) {
    return service.get(id);
}
```

Kelihatannya return object saja.

Tetapi runtime harus memutuskan:

- status code apa?
- media type apa?
- writer apa yang menulis object?
- header apa yang dikirim?
- apakah body boleh ada?
- apakah response cacheable?
- apakah ETag/Last-Modified dikirim?
- apakah generic type masih diketahui?
- apakah stream besar perlu ditulis chunked?
- apakah error terjadi sebelum atau sesudah response commit?

## 1.1 Yang akan kamu kuasai

Setelah part ini, kamu bisa:

- memilih return DTO langsung vs `Response`;
- membangun `201 Created`, `202 Accepted`, `204 No Content` yang benar;
- memahami `MessageBodyWriter` selection;
- menangani generic response dengan `GenericEntity`;
- melakukan streaming response dengan `StreamingOutput`;
- menulis download response yang aman;
- mengatur headers/cookies/cache/link/ETag;
- menghindari lazy loading/serialization leak;
- membuat response contract yang stabil dan testable.

## 1.2 Prinsip utama

```text
A response is not just data.
A response is status + headers + representation + cache/security semantics.
```

---

# 2. Mental Model: Response adalah HTTP Contract, Bukan Sekadar Return Value

Dalam Java, return value terlihat seperti ini:

```java
return customerResponse;
```

Dalam HTTP, response adalah:

```http
HTTP/1.1 200 OK
Content-Type: application/json
ETag: "v3"
Cache-Control: private, max-age=60

{"id":"CUST-000001","name":"Fajar"}
```

## 2.1 Response contract terdiri dari

- status code;
- response headers;
- media type;
- entity body;
- cookies;
- links;
- caching metadata;
- security headers;
- content negotiation behavior;
- error format.

## 2.2 DTO hanya satu bagian

DTO hanya entity representation.

```java
CustomerResponse
```

Tetapi API contract juga memerlukan:

- `200` vs `404`;
- `ETag`;
- `Cache-Control`;
- `Vary`;
- `Location`;
- `Content-Disposition`;
- cookies if browser/session;
- consistent error response.

## 2.3 Return DTO cocok ketika response sederhana

```java
@GET
public CustomerResponse get(...) { ... }
```

Runtime defaults to `200 OK` and writes entity.

## 2.4 Return `Response` cocok ketika butuh kontrol

```java
return Response.ok(dto)
    .tag(entityTag)
    .cacheControl(cache)
    .build();
```

## 2.5 Top-tier rule

```text
Use the simplest return type that still expresses the full HTTP contract correctly.
```

---

# 3. Response Pipeline: Java Return Value → `MessageBodyWriter` → HTTP Bytes

Response writing happens after resource method returns.

## 3.1 Basic flow

```text
resource method returns value
  ↓
if value is Response, inspect status/entity/headers
  ↓
if entity exists, select MessageBodyWriter
  ↓
write entity to output stream
  ↓
commit response
```

## 3.2 Inputs for writer selection

Runtime considers:

- entity Java class;
- generic type;
- annotations;
- selected response media type;
- registered `MessageBodyWriter`s;
- `@Produces`;
- provider priority.

## 3.3 If no writer

If no writer can write entity type/media type, response fails.

Often appears as server error.

## 3.4 If writer fails

If writer throws before response commit, exception mapper may still shape response.

If writer fails after partial bytes committed, client may receive truncated response and mapper cannot fix body.

## 3.5 Response entity is not serialized in resource method

```java
return Response.ok(dto).build();
```

Serialization happens later.

## 3.6 Implication

Do not close resources or transactions too early if serializer needs lazy data.

Better: materialize DTO fully before returning.

---

# 4. Return DTO Langsung vs Return `Response`

## 4.1 Return DTO directly

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public CustomerResponse get(@PathParam("customerId") CustomerId id) {
    return mapper.toResponse(service.get(id));
}
```

Pros:

- simple;
- clear body type;
- easier OpenAPI generation;
- less boilerplate.

Cons:

- limited status/header control;
- not suitable for `201`, `204`, `202`, ETag, cache, cookies, links.

## 4.2 Return `Response`

```java
@GET
public Response get(@PathParam("customerId") CustomerId id) {
    CustomerResponse dto = mapper.toResponse(service.get(id));
    return Response.ok(dto)
        .tag(new EntityTag(dto.version()))
        .build();
}
```

Pros:

- full HTTP control;
- status;
- headers;
- cookies;
- links;
- ETag/cache;
- streaming.

Cons:

- hides entity type;
- more verbose;
- can encourage inconsistent response patterns;
- OpenAPI tools may need annotations.

## 4.3 Rule of thumb

Use DTO directly for:

```text
simple 200 OK response with default headers
```

Use `Response` for:

```text
201, 202, 204, Location, ETag, Cache-Control, Link, cookies, streaming, file download, conditional response
```

## 4.4 Team consistency

Some teams mandate returning `Response` everywhere for uniformity.

This is acceptable if response contract is consistently documented and tested.

## 4.5 Top-tier preference

Do not create boilerplate `Response.ok(dto).build()` everywhere if direct DTO is clearer.

But do not return DTO directly when headers/status matter.

---

# 5. Return Type `void`, `null`, DTO, `Response`, `CompletionStage`

## 5.1 DTO return

```java
public CustomerResponse get() { ... }
```

Usually:

```text
200 OK + entity
```

## 5.2 `Response` return

```java
public Response create() { ... }
```

Status/body/headers defined by builder.

## 5.3 `void`

```java
public void delete() { ... }
```

Often maps to `204 No Content`, but be explicit for clarity:

```java
return Response.noContent().build();
```

## 5.4 `null`

Returning null can result in no content or other runtime behavior depending return type.

Avoid returning null from resource methods.

Use:

- throw `NotFoundException`;
- return `Response.noContent()`;
- return optional mapped explicitly.

## 5.5 Async return

JAX-RS supports async patterns such as `CompletionStage<T>` in modern versions.

Design async carefully:

- exception mapping;
- context propagation;
- timeouts;
- cancellation;
- transaction boundaries.

## 5.6 Streaming type

```java
StreamingOutput
```

Used as entity.

## 5.7 Rule

```text
Avoid ambiguous null/void behavior. Be explicit when response semantics matter.
```

---

# 6. `Response` dan `Response.ResponseBuilder`

`Response` represents HTTP response metadata and entity.

## 6.1 Builder pattern

```java
Response response = Response.status(201)
    .header("X-Correlation-ID", correlationId)
    .entity(body)
    .build();
```

## 6.2 Common builder methods

- `status(...)`;
- `ok(...)`;
- `created(URI)`;
- `accepted(...)`;
- `noContent()`;
- `notModified()`;
- `seeOther(URI)`;
- `temporaryRedirect(URI)`;
- `entity(...)`;
- `type(...)`;
- `header(...)`;
- `replaceAll(...)`;
- `tag(...)`;
- `lastModified(...)`;
- `cacheControl(...)`;
- `cookie(...)`;
- `link(...)`.

## 6.3 Response is immutable-ish result

After `build()`, response is created.

Do not mutate response entity later.

## 6.4 Header values

Header values can be objects with registered header delegates or stringified.

Examples:

```java
EntityTag
CacheControl
NewCookie
Link
MediaType
```

## 6.5 Entity annotations

`entity(Object, Annotation[])` can pass annotations to `MessageBodyWriter`.

Rare but useful for advanced provider behavior.

## 6.6 Rule

`ResponseBuilder` is your HTTP semantics DSL. Use it deliberately.

---

# 7. Status Code sebagai Bagian dari Contract

Status code is not decoration.

It controls client behavior.

## 7.1 Common successful statuses

```text
200 OK
201 Created
202 Accepted
204 No Content
206 Partial Content
304 Not Modified
```

## 7.2 Common client error statuses

```text
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
405 Method Not Allowed
406 Not Acceptable
409 Conflict
412 Precondition Failed
415 Unsupported Media Type
422 Unprocessable Content
429 Too Many Requests
```

## 7.3 Common server statuses

```text
500 Internal Server Error
502 Bad Gateway
503 Service Unavailable
504 Gateway Timeout
```

## 7.4 Do not always return 200

Bad:

```json
{"success": false, "error": "not found"}
```

with:

```http
200 OK
```

## 7.5 Do not abuse 500

Validation errors are not server errors.

## 7.6 Rule

```text
HTTP status code is part of API behavior and must be tested.
```

---

# 8. `Response.ok()`, `created()`, `accepted()`, `noContent()`, `status()`

## 8.1 `ok`

```java
return Response.ok(dto).build();
```

Means:

```text
200 OK
```

## 8.2 `created`

```java
return Response.created(location)
    .entity(response)
    .build();
```

Means:

```text
201 Created
Location: ...
```

Use when new resource created.

## 8.3 `accepted`

```java
return Response.accepted(statusRepresentation)
    .location(jobUri)
    .header("Retry-After", "5")
    .build();
```

Means:

```text
202 Accepted
```

Use when processing not completed.

## 8.4 `noContent`

```java
return Response.noContent().build();
```

Means:

```text
204 No Content
```

No response body.

## 8.5 `status`

```java
return Response.status(Status.CONFLICT)
    .entity(problem)
    .build();
```

Use for custom/non-convenience status.

## 8.6 Rule

Choose builder by semantics, not habit.

---

# 9. `entity(...)`: Response Body dan Metadata

## 9.1 Entity body

```java
Response.ok(customerResponse).build();
```

`customerResponse` is entity.

## 9.2 Entity with media type

```java
Response.ok(customerResponse, MediaType.APPLICATION_JSON).build();
```

## 9.3 Entity with annotations

```java
Response.ok()
    .entity(customerResponse, annotations)
    .build();
```

Advanced provider use.

## 9.4 No entity for 204

Do not send entity with `204 No Content`.

## 9.5 Entity and writer

Entity is not bytes yet.

Runtime later selects `MessageBodyWriter`.

## 9.6 Entity should be stable

Do not return object whose serialization depends on open session/lazy state.

## 9.7 Rule

Response entity should be a ready-to-serialize representation.

---

# 10. `@Produces` sebagai Kontrak Response Body

`@Produces` declares response media types.

## 10.1 Method-level

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public CustomerResponse get() { ... }
```

## 10.2 Class-level

```java
@Path("/customers")
@Produces(MediaType.APPLICATION_JSON)
public class CustomerResource { ... }
```

Method-level overrides class-level.

## 10.3 Multiple media

```java
@Produces({MediaType.APPLICATION_JSON, "text/csv"})
```

## 10.4 Drives method selection

`Accept` header and `@Produces` participate in request matching.

## 10.5 Drives writer selection

Selected media type helps choose `MessageBodyWriter`.

## 10.6 Good policy

Most JSON APIs set class-level:

```java
@Produces(MediaType.APPLICATION_JSON)
```

Then override for file/CSV endpoints.

## 10.7 Rule

Be explicit about media types your API produces.

---

# 11. `Accept` dan `406 Not Acceptable`

Client sends `Accept` to say what response media types it can accept.

## 11.1 Example

```http
Accept: application/json
```

## 11.2 If server cannot produce acceptable media

Response:

```text
406 Not Acceptable
```

## 11.3 Missing Accept

Default effectively accepts anything.

## 11.4 Multiple representations

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public ReportMetadata metadata() { ... }

@GET
@Produces("application/pdf")
public Response pdf() { ... }
```

Same path can produce different representation depending `Accept`.

## 11.5 `Vary`

If response varies by `Accept`, send:

```http
Vary: Accept
```

Often runtime/framework handles; verify.

## 11.6 Rule

Media negotiation is contract. Test it.

---

# 12. Bagaimana Runtime Memilih `MessageBodyWriter`

`MessageBodyWriter<T>` maps Java object to response entity bytes.

## 12.1 Selection inputs

Runtime considers:

- entity class;
- generic type;
- annotations;
- response media type;
- registered writers;
- writer `@Produces`;
- `isWriteable` result;
- provider priority.

## 12.2 Simplified flow

```text
entity = CustomerResponse
media = application/json
  ↓
find compatible MessageBodyWriter
  ↓
call isWriteable(...)
  ↓
call writeTo(...)
  ↓
bytes written to response stream
```

## 12.3 Standard/common writers

Common writers include:

- `String`;
- `byte[]`;
- `InputStream`;
- `Reader`;
- `StreamingOutput`;
- file-like types depending runtime;
- JSON-B/JSON-P/Jackson DTO writers;
- multipart writers.

## 12.4 If no writer

You may see runtime error such as:

```text
MessageBodyWriter not found
```

## 12.5 Debug checklist

- selected media type;
- actual entity class;
- generic type;
- `@Produces`;
- JSON provider installed;
- custom provider priority;
- `GenericEntity` needed?

## 12.6 Rule

Response serialization is provider-driven. Know your writers.

---

# 13. `MessageBodyWriter#isWriteable`

Method:

```java
boolean isWriteable(
    Class<?> type,
    Type genericType,
    Annotation[] annotations,
    MediaType mediaType
)
```

## 13.1 Purpose

Tell runtime whether writer can write given type/media.

## 13.2 Good `isWriteable`

```java
return CustomerExport.class.equals(type)
    && mediaType.isCompatible(MediaType.valueOf("text/csv"));
```

## 13.3 Bad `isWriteable`

```java
return true;
```

It hijacks all responses.

## 13.4 Generic type

Use `genericType` if writer handles generic collections.

## 13.5 Annotations

Use annotations only for advanced serialization behavior.

## 13.6 Rule

Be narrow and deterministic.

---

# 14. `MessageBodyWriter#writeTo`

Method writes entity to output stream.

```java
void writeTo(
    T t,
    Class<?> type,
    Type genericType,
    Annotation[] annotations,
    MediaType mediaType,
    MultivaluedMap<String, Object> httpHeaders,
    OutputStream entityStream
) throws IOException, WebApplicationException;
```

## 14.1 Responsibilities

- serialize object;
- set headers if needed;
- write bytes to output stream;
- handle IO/format errors.

## 14.2 Do not close stream casually

Runtime owns response stream lifecycle.

Flush/close behavior should follow provider/runtime expectations.

## 14.3 Headers

Writer can set headers before bytes are committed.

Example:

```java
httpHeaders.putSingle(HttpHeaders.CONTENT_TYPE, "text/csv");
```

But usually resource sets headers.

## 14.4 Error before commit

Throw `WebApplicationException` before writing if possible.

## 14.5 Error after partial write

Hard to recover.

## 14.6 Rule

Writers serialize representation format. Do not put business logic inside.

---

# 15. Provider Registration: `@Provider`, `@Produces`, `@Priority`

## 15.1 Register writer

```java
@Provider
@Produces("text/csv")
public class CustomerCsvWriter implements MessageBodyWriter<CustomerExport> { ... }
```

## 15.2 Programmatic registration

```java
@Override
public Set<Class<?>> getClasses() {
    return Set.of(CustomerResource.class, CustomerCsvWriter.class);
}
```

## 15.3 Priority

```java
@Priority(500)
```

Lower number usually higher priority in provider ordering contexts.

## 15.4 Avoid overriding JSON provider accidentally

A writer for `Object.class` and `application/json` is dangerous.

## 15.5 Test actual selection

If custom writer overlaps with JSON-B/Jackson, integration test.

## 15.6 Rule

Custom writers should be type/media-specific unless you are building framework infrastructure.

---

# 16. JSON Response DTO Writing

## 16.1 DTO example

```java
public record CustomerResponse(
    String id,
    String name,
    String status,
    List<LinkResponse> links
) {}
```

Resource:

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public CustomerResponse get(@PathParam("customerId") CustomerId id) {
    return mapper.toResponse(service.get(id));
}
```

## 16.2 Serialization provider

Runtime uses JSON writer:

- JSON-B;
- Jackson;
- other provider.

## 16.3 Shape is contract

Fields, names, null behavior, date formats, enum values are public contract.

## 16.4 Test JSON output

Use golden/contract tests.

## 16.5 Avoid accidental fields

Do not return entity/domain object with extra getters.

## 16.6 Versioning

Adding optional fields is usually backward-compatible.

Removing/renaming/changing type is breaking.

## 16.7 Rule

Response DTO serialization shape must be intentional and tested.

---

# 17. DTO Boundary: Jangan Return JPA Entity Langsung

## 17.1 Bad

```java
@GET
public CustomerEntity get(@PathParam("id") String id) {
    return entityManager.find(CustomerEntity.class, id);
}
```

## 17.2 Problems

- lazy loading exception;
- infinite recursion;
- security leak;
- internal fields exposed;
- JPA annotations mixed with API;
- serialization triggers DB queries;
- entity change breaks API;
- difficult versioning.

## 17.3 Better

```java
Customer customer = service.get(id);
CustomerResponse dto = mapper.toResponse(customer);
return dto;
```

## 17.4 Projection DTO

For read-heavy endpoint, service/repository can return projection DTO directly.

## 17.5 Security filtering

Only include fields caller may see.

## 17.6 Rule

```text
Response DTO defines what server promises to expose.
```

---

# 18. Records, POJO, JSON-B/Jackson, dan Serialization Shape

## 18.1 Records

```java
public record OrderResponse(
    String id,
    String status,
    Instant createdAt
) {}
```

Good for immutable DTO.

## 18.2 POJO

Works broadly with getters/setters.

## 18.3 Provider differences

JSON-B and Jackson differ in:

- property naming;
- null handling;
- date/time format;
- enum serialization;
- records support;
- annotations;
- polymorphism;
- unknown/ignored behavior.

## 18.4 Avoid provider-specific annotations unless committed

If using Jackson intentionally:

```java
@JsonProperty
```

is okay, but document dependency.

## 18.5 Null policy

Decide whether null fields are included.

```json
{"middleName": null}
```

vs omitted.

## 18.6 Date/time policy

Prefer ISO-8601 strings.

## 18.7 Rule

Serialization provider is part of API behavior. Pin and test it.

---

# 19. Generic Type Problem dan Type Erasure

Java erases generic type at runtime.

## 19.1 Example

```java
List<CustomerResponse> list = service.list();
return Response.ok(list).build();
```

At runtime, entity class is `ArrayList`, generic type may be lost.

## 19.2 Why matters

MessageBodyWriter may need element type.

JSON providers often handle runtime values, but generic information can still matter.

## 19.3 Direct return method

```java
public List<CustomerResponse> list() { ... }
```

The method generic return type is known to runtime.

## 19.4 Response entity loses method return generic

When wrapping in `Response`, generic type information may be less obvious.

## 19.5 Solution

Use `GenericEntity`.

## 19.6 Alternative

Use wrapper DTO:

```java
public record CustomerPageResponse(List<CustomerResponse> items, PageMeta page) {}
```

## 19.7 Rule

If returning generic collection inside `Response`, consider `GenericEntity` or wrapper DTO.

---

# 20. `GenericEntity<T>` untuk Preserve Generic Type

`GenericEntity` preserves generic type information at runtime.

## 20.1 Example

```java
List<CustomerResponse> customers = service.list();
GenericEntity<List<CustomerResponse>> entity =
    new GenericEntity<List<CustomerResponse>>(customers) {};

return Response.ok(entity).build();
```

## 20.2 Why anonymous subclass?

Anonymous subclass captures generic type information.

## 20.3 Use case

When response entity type is generic:

```java
List<CustomerResponse>
Map<String, CustomerResponse>
Page<CustomerResponse>
```

and you return `Response`.

## 20.4 Constructor with explicit type

`GenericEntity` also has constructors for explicit generic type use.

## 20.5 Limit

Still not a substitute for clear response schema.

## 20.6 Recommendation

For API responses, wrapper DTO is often clearer than returning bare list.

Use `GenericEntity` when you intentionally return generic type and need `Response` control.

---

# 21. Wrapper DTO vs `GenericEntity`

## 21.1 Bare list

```json
[
  {"id":"C1"},
  {"id":"C2"}
]
```

## 21.2 Wrapper response

```json
{
  "items": [
    {"id":"C1"},
    {"id":"C2"}
  ],
  "page": {
    "size": 20,
    "nextCursor": "abc"
  }
}
```

## 21.3 Wrapper pros

- pagination metadata;
- links;
- future fields;
- stable schema;
- easier validation/docs.

## 21.4 GenericEntity pros

- minimal body shape;
- preserves generic type;
- useful for simple technical endpoints.

## 21.5 Recommendation

Public collection APIs should usually use wrapper DTO.

## 21.6 Rule

`GenericEntity` solves Java type erasure. It does not solve API design.

---

# 22. `StreamingOutput`: Response Streaming

`StreamingOutput` lets you write response body directly to output stream.

## 22.1 Example

```java
@GET
@Path("/exports/customers.csv")
@Produces("text/csv")
public Response export() {
    StreamingOutput stream = output -> {
        try (Writer writer = new OutputStreamWriter(output, StandardCharsets.UTF_8)) {
            customerExportService.writeCsv(writer);
        }
    };

    return Response.ok(stream)
        .header("Content-Disposition", "attachment; filename=customers.csv")
        .build();
}
```

## 22.2 Use cases

- large CSV export;
- file download;
- generated report;
- proxying stream;
- avoiding full buffering.

## 22.3 Advantages

- lower memory;
- start sending earlier;
- can handle large output.

## 22.4 Responsibilities

You own:

- streaming logic;
- error behavior;
- resource cleanup;
- transaction/session boundaries;
- flush behavior;
- content length if known.

## 22.5 Rule

Use streaming for large output, but design failure semantics carefully.

---

# 23. Streaming Large File / CSV / Export

## 23.1 CSV export pattern

```java
StreamingOutput stream = output -> {
    try (BufferedWriter writer = new BufferedWriter(
        new OutputStreamWriter(output, StandardCharsets.UTF_8))) {
        writer.write("id,name,status\n");
        service.streamCustomers(row -> {
            writer.write(toCsv(row));
            writer.write('\n');
        });
    }
};
```

## 23.2 Avoid loading all rows

Bad:

```java
List<Row> rows = repository.findAll();
```

for million rows.

## 23.3 DB cursor/stream

Use repository streaming carefully.

Watch transaction/session lifetime.

## 23.4 Export job alternative

For long export, prefer async job:

```text
POST /customer-export-jobs
GET /customer-export-jobs/{id}/file
```

## 23.5 Content-Disposition

```http
Content-Disposition: attachment; filename="customers.csv"
```

Need safe filename.

## 23.6 Rule

If export takes long or is huge, make it a job, not a long request.

---

# 24. Streaming Error Semantics: Sebelum vs Sesudah Response Commit

## 24.1 Before commit

If error happens before any bytes written, runtime may still send error response.

## 24.2 After commit

Once headers/body bytes are committed, status cannot change.

If error happens mid-stream:

- client receives partial file;
- connection may close;
- exception mapper cannot produce clean JSON problem response.

## 24.3 Mitigation

- validate permissions/inputs before streaming;
- check resource exists before streaming;
- avoid starting stream until ready;
- for generated long reports, pre-generate then download;
- include checksums/manifests where needed.

## 24.4 Transaction issue

If DB cursor fails mid-stream, client gets partial output.

## 24.5 Rule

Streaming shifts some failures from structured HTTP errors to transport failures. Design accordingly.

---

# 25. Binary Download: `Content-Type`, `Content-Length`, `Content-Disposition`

## 25.1 Basic download

```java
@GET
@Path("/documents/{documentId}/content")
public Response download(@PathParam("documentId") DocumentId id) {
    DocumentContent content = service.openContent(id);

    return Response.ok(content.inputStream(), content.mediaType().toString())
        .header("Content-Length", content.size())
        .header("Content-Disposition", contentDisposition(content.filename()))
        .tag(new EntityTag(content.version()))
        .build();
}
```

## 25.2 Content-Type

Use actual verified media type, not blindly client-provided upload type.

## 25.3 Content-Length

Set if known.

If unknown, response may be chunked.

## 25.4 Content-Disposition

Controls inline vs attachment and filename.

## 25.5 Filename security

Sanitize filename.

Avoid CRLF injection.

Support RFC-compliant encoding for non-ASCII filenames if needed.

## 25.6 Rule

Download response is a contract and a security boundary.

---

# 26. Range Request dan Partial Content

Range requests allow clients to request byte ranges.

## 26.1 Header

```http
Range: bytes=0-1023
```

## 26.2 Response

```http
206 Partial Content
Content-Range: bytes 0-1023/10000
```

## 26.3 Use cases

- video/audio;
- large files;
- resume download;
- document viewer.

## 26.4 JAX-RS

You can implement manually using headers and stream slicing.

Some runtimes/libraries may help.

## 26.5 Complexity

Need handle:

- invalid ranges;
- multiple ranges;
- ETag/If-Range;
- content length;
- storage seek support.

## 26.6 Recommendation

For serious file serving, delegate to object storage/CDN/server optimized for range requests.

## 26.7 Rule

Do not implement Range casually unless you test thoroughly.

---

# 27. Headers: Metadata, Contract, and Security

Headers communicate metadata around entity.

## 27.1 Common response headers

- `Content-Type`;
- `Content-Length`;
- `Location`;
- `ETag`;
- `Last-Modified`;
- `Cache-Control`;
- `Vary`;
- `Link`;
- `Content-Disposition`;
- `Retry-After`;
- `X-Correlation-ID`.

## 27.2 JAX-RS builder

```java
return Response.ok(entity)
    .header("X-Correlation-ID", correlationId)
    .build();
```

## 27.3 Avoid custom headers when standard exists

Use `ETag`, not `X-Version` for HTTP caching/concurrency when possible.

Use `Location`, not `X-Resource-URL`.

## 27.4 Security

Header values must not contain CRLF/untrusted raw input.

## 27.5 Rule

Headers are API contract. Document and test them.

---

# 28. `Location` Header untuk `201 Created` dan `202 Accepted`

## 28.1 Created resource

```java
URI location = uriInfo.getAbsolutePathBuilder()
    .path(created.id().value())
    .build();

return Response.created(location)
    .entity(response)
    .build();
```

## 28.2 Async accepted

```java
return Response.accepted(jobStatus)
    .location(jobUri)
    .header("Retry-After", "5")
    .build();
```

## 28.3 `201` vs `202`

Use `201` when resource exists now.

Use `202` when processing accepted but not complete.

## 28.4 Gateway issue

Ensure `Location` is externally correct.

## 28.5 Relative vs absolute

Modern HTTP allows relative references, but choose team policy.

## 28.6 Rule

Every `201` and many `202` responses should have `Location`.

---

# 29. `ETag`, `Last-Modified`, dan Conditional Responses

## 29.1 ETag

```java
EntityTag tag = new EntityTag(customer.version());
return Response.ok(dto)
    .tag(tag)
    .build();
```

## 29.2 Last-Modified

```java
return Response.ok(dto)
    .lastModified(Date.from(customer.updatedAt()))
    .build();
```

## 29.3 Conditional GET

Use `Request#evaluatePreconditions` before returning body.

## 29.4 Optimistic concurrency

For updates:

```http
If-Match: "v3"
```

If stale:

```text
412 Precondition Failed
```

## 29.5 Strong vs weak ETag

For write concurrency, use strong entity version.

## 29.6 Do not use timestamps only if precision insufficient

DB timestamp precision and HTTP date precision can mismatch.

## 29.7 Rule

ETag is one of the best tools for REST correctness under concurrency.

---

# 30. `CacheControl` dan HTTP Caching

## 30.1 CacheControl object

```java
CacheControl cc = new CacheControl();
cc.setPrivate(true);
cc.setMaxAge(60);

return Response.ok(dto)
    .cacheControl(cc)
    .tag(tag)
    .build();
```

## 30.2 Sensitive data

For user-specific data:

```http
Cache-Control: private, no-store
```

depending sensitivity.

## 30.3 Public reference data

For stable public data:

```http
Cache-Control: public, max-age=3600
ETag: "..."
```

## 30.4 No-store

Use for highly sensitive data.

## 30.5 Must-revalidate

Useful when caches must revalidate stale response.

## 30.6 Rule

Every response has cache behavior, even if you do not specify it. Be explicit for sensitive/expensive endpoints.

---

# 31. `Vary` Header dan Content Negotiation

## 31.1 Why Vary matters

If response changes based on request header, caches need know.

Example:

```http
Vary: Accept
```

## 31.2 Language

If localized by `Accept-Language`:

```http
Vary: Accept-Language
```

## 31.3 Auth/session

Authenticated responses usually not public-cacheable.

## 31.4 Accept-Encoding

Often handled by server/proxy.

## 31.5 JAX-RS

Some negotiation helpers set Vary; verify runtime behavior.

## 31.6 Rule

If representation varies by header and can be cached, set `Vary` correctly.

---

# 32. `Link` Header dan HATEOAS Pragmatic

JAX-RS has `Link` abstraction.

## 32.1 Link builder

```java
Link self = Link.fromUri(location)
    .rel("self")
    .type(MediaType.APPLICATION_JSON)
    .build();

return Response.ok(dto)
    .links(self)
    .build();
```

## 32.2 Common relations

- `self`;
- `next`;
- `prev`;
- `first`;
- `last`;
- `describedby`;
- domain-specific rels.

## 32.3 Pagination links

```http
Link: </customers?cursor=abc>; rel="next"
```

## 32.4 Body links vs header links

Many JSON APIs include links in body.

Both can be valid.

## 32.5 Pragmatic HATEOAS

You do not need to over-engineer.

Use links where they reduce client coupling:

- pagination;
- job status;
- download;
- related resources.

## 32.6 Rule

Links should help clients navigate state, not decorate responses randomly.

---

# 33. Cookies: `NewCookie` dan Response Cookie Security

## 33.1 Set cookie

```java
NewCookie cookie = new NewCookie.Builder("session")
    .value(sessionId)
    .path("/")
    .secure(true)
    .httpOnly(true)
    .sameSite(NewCookie.SameSite.STRICT)
    .build();

return Response.ok()
    .cookie(cookie)
    .build();
```

## 33.2 Cookie security attributes

- `HttpOnly`;
- `Secure`;
- `SameSite`;
- `Path`;
- `Domain`;
- `Max-Age`;
- `Expires`.

## 33.3 Auth cookie

Should be handled by auth/session component, not scattered resource logic.

## 33.4 CSRF

Cookie-authenticated APIs need CSRF strategy.

## 33.5 Do not log cookie value

Never.

## 33.6 Rule

Set-Cookie is security-sensitive response behavior.

---

# 34. Security Headers

Common security headers:

```http
X-Content-Type-Options: nosniff
Content-Security-Policy: ...
Referrer-Policy: no-referrer
Strict-Transport-Security: max-age=...
X-Frame-Options: DENY
```

## 34.1 API vs browser

Some headers matter more for browser-facing APIs/apps.

## 34.2 Centralize

Set via response filter/gateway rather than every resource.

## 34.3 Content-Type correctness

`nosniff` helps prevent MIME sniffing.

## 34.4 HSTS

Only when HTTPS is guaranteed and domain policy understood.

## 34.5 Rule

Security headers are cross-cutting. Use filter/gateway policy.

---

# 35. CORS Headers: Resource vs Filter/Gateway

## 35.1 CORS response headers

- `Access-Control-Allow-Origin`;
- `Access-Control-Allow-Methods`;
- `Access-Control-Allow-Headers`;
- `Access-Control-Allow-Credentials`;
- `Access-Control-Max-Age`.

## 35.2 Do not set ad-hoc in resources

CORS is cross-cutting.

Use:

- gateway;
- servlet filter;
- JAX-RS filter;
- runtime config.

## 35.3 Credentials

If using cookies/auth, wildcard origin is not allowed with credentials.

## 35.4 Preflight

OPTIONS request must be handled before auth blocks incorrectly.

## 35.5 Rule

CORS is security policy, not per-method decoration.

---

# 36. Problem Details sebagai Error Response Entity

Use RFC 9457 Problem Details for errors.

## 36.1 Example

```json
{
  "type": "https://api.example.com/problems/customer-not-found",
  "title": "Customer not found",
  "status": 404,
  "code": "CUSTOMER_NOT_FOUND",
  "detail": "Customer CUST-000001 was not found.",
  "correlationId": "abc-123"
}
```

## 36.2 JAX-RS mapper

```java
@Provider
public class DomainExceptionMapper implements ExceptionMapper<DomainException> {
    @Override
    public Response toResponse(DomainException ex) {
        ProblemDetails problem = mapper.toProblem(ex);
        return Response.status(problem.status())
            .type("application/problem+json")
            .entity(problem)
            .build();
    }
}
```

## 36.3 Error response still uses writer

`ProblemDetails` must be serializable by JSON writer.

## 36.4 Do not return HTML error from API

Configure default exception mappers.

## 36.5 Rule

Error response body is as important as success DTO.

---

# 37. Response for Collection: Pagination Envelope dan Links

## 37.1 Good response

```json
{
  "items": [
    {"id":"C001","name":"Fajar"}
  ],
  "page": {
    "size": 20,
    "nextCursor": "abc"
  },
  "links": [
    {"rel":"self","href":"/customers?size=20"},
    {"rel":"next","href":"/customers?cursor=abc&size=20"}
  ]
}
```

## 37.2 Headers optional

Can also use `Link` header.

## 37.3 Avoid bare list for evolving public API

Bare list cannot add metadata later without breaking shape.

## 37.4 Cache

Collection cache is often tricky because filters/user/tenant change output.

## 37.5 Rule

Collection response should include pagination metadata and stable structure.

---

# 38. Response for Create/Update/Delete

## 38.1 Create

```java
return Response.created(location)
    .entity(createdResponse)
    .build();
```

Status:

```text
201 Created
```

## 38.2 Replace/update

Common options:

```text
200 OK + updated representation
204 No Content
```

If returning updated DTO:

```java
return Response.ok(updated).tag(tag).build();
```

If no body:

```java
return Response.noContent().tag(tag).build();
```

## 38.3 Delete

Usually:

```text
204 No Content
```

## 38.4 Idempotent delete

Define behavior for repeated delete:

- `204` if already absent;
- `404` if not found;
- domain-specific.

## 38.5 Rule

Write lifecycle response semantics down; do not let each developer decide ad hoc.

---

# 39. Response for Long-Running Operation

## 39.1 Start operation

```http
POST /report-jobs
```

Response:

```http
202 Accepted
Location: /report-jobs/J001
Retry-After: 5
```

Body:

```json
{
  "jobId": "J001",
  "status": "QUEUED",
  "links": [
    {"rel":"self","href":"/report-jobs/J001"}
  ]
}
```

## 39.2 Why 202

Request accepted, processing not complete.

## 39.3 Status resource

```http
GET /report-jobs/J001
```

## 39.4 Result link

When completed:

```json
{
  "status": "SUCCEEDED",
  "links": [
    {"rel":"result","href":"/reports/R001/file"}
  ]
}
```

## 39.5 Rule

Async operation response should tell client where and when to check state.

---

# 40. Response for File/Document API

## 40.1 Metadata endpoint

```http
GET /documents/D001
Accept: application/json
```

## 40.2 Content endpoint

```http
GET /documents/D001/content
Accept: application/pdf
```

## 40.3 Response headers

```http
Content-Type: application/pdf
Content-Length: 12345
Content-Disposition: attachment; filename="document.pdf"
ETag: "v7"
Cache-Control: private, max-age=300
```

## 40.4 Inline vs attachment

Use `inline` for browser preview where safe.

Use `attachment` for forced download.

## 40.5 Security

- authorize before streaming;
- sanitize filename;
- verify media type;
- do not expose storage path;
- no body logging.

## 40.6 Rule

File response design is as much security as serialization.

---

# 41. Custom `MessageBodyWriter`

## 41.1 Use cases

- CSV writer;
- custom binary format;
- NDJSON;
- envelope format;
- legacy fixed-width text;
- custom media type.

## 41.2 Example CSV writer

```java
@Provider
@Produces("text/csv")
public class CustomerCsvWriter implements MessageBodyWriter<CustomerExport> {

    @Override
    public boolean isWriteable(
        Class<?> type,
        Type genericType,
        Annotation[] annotations,
        MediaType mediaType
    ) {
        return CustomerExport.class.equals(type);
    }

    @Override
    public void writeTo(
        CustomerExport export,
        Class<?> type,
        Type genericType,
        Annotation[] annotations,
        MediaType mediaType,
        MultivaluedMap<String, Object> headers,
        OutputStream output
    ) throws IOException {
        try (Writer writer = new OutputStreamWriter(output, StandardCharsets.UTF_8)) {
            writer.write("id,name,status\n");
            for (CustomerRow row : export.rows()) {
                writer.write(escape(row.id()));
                writer.write(',');
                writer.write(escape(row.name()));
                writer.write(',');
                writer.write(escape(row.status()));
                writer.write('\n');
            }
        }
    }
}
```

## 41.3 Caveat

Do not close output stream if runtime expects control. Some examples use try-with-resource writer; understand runtime/provider convention.

## 41.4 Business logic

Writer should not query database.

It writes representation.

## 41.5 Rule

Custom writer is format serialization layer, not application service.

---

# 42. Writer vs `WriterInterceptor`

## 42.1 MessageBodyWriter

Serializes Java entity to bytes.

## 42.2 WriterInterceptor

Wraps around writing process.

Use for cross-cutting concerns:

- compression;
- encryption;
- checksum;
- envelope;
- metrics;
- signing.

## 42.3 Do not overuse

Interceptor can affect all responses.

## 42.4 Ordering

Interceptors have priority/order.

Test carefully.

## 42.5 Rule

Writer defines format. Interceptor modifies/wraps writing pipeline.

---

# 43. Serialization Failure dan Error Mapping

## 43.1 Failure examples

- no `MessageBodyWriter`;
- lazy loading exception;
- JSON serialization recursion;
- invalid property getter;
- IO error;
- broken client connection.

## 43.2 Before response commit

Exception mapper may still produce error response.

## 43.3 After commit

Cannot change status/body reliably.

## 43.4 Prevent by materializing DTO

Do mapping before response returned:

```java
CustomerResponse dto = mapper.toResponse(service.get(id));
return Response.ok(dto).build();
```

## 43.5 Avoid lazy entity return

Do not return JPA entities with lazy collections.

## 43.6 Observability

Track serialization errors separately from business errors.

## 43.7 Rule

Serialization should be boring. If it can fail due domain/lazy logic, fix boundary.

---

# 44. Response Commit, Buffering, dan Observability

## 44.1 Commit

Once response committed, headers/status cannot be changed.

## 44.2 Buffering

Runtime may buffer small responses.

Streaming often commits earlier.

## 44.3 Observability timing

Response filters may run before full streaming completes depending runtime.

For streaming, total bytes/duration may need lower-level instrumentation.

## 44.4 Broken pipe

Client disconnect during streaming can cause IO exception.

Classify separately from server bug.

## 44.5 Rule

For streaming, your “request completed” metric must reflect actual write outcome if possible.

---

# 45. Response Entity dan Transactions

## 45.1 Bad pattern

Return JPA entity from transactional service.

Transaction closes.

Serializer later accesses lazy relation.

Boom.

## 45.2 Better

Inside service/transaction:

- fetch needed data;
- map to DTO/projection;
- return DTO.

## 45.3 Resource transaction

Annotating resource method with transaction can keep transaction open during serialization depending interceptor order/runtime, but this is not a clean design.

## 45.4 Streaming DB cursor

If streaming directly from DB, transaction may need stay open during stream.

This is risky; prefer export job/materialization.

## 45.5 Rule

Response entity should not require open persistence context to serialize.

---

# 46. Response Entity dan Lazy Loading

## 46.1 Problem

```java
public class CustomerEntity {
    @OneToMany(fetch = LAZY)
    List<OrderEntity> orders;
}
```

Returning entity may trigger lazy load during JSON writing.

## 46.2 Consequences

- N+1 queries;
- LazyInitializationException;
- infinite recursion;
- huge response;
- sensitive data leak.

## 46.3 Fix

Use DTO/projection.

```java
CustomerDetailResponse dto = repository.fetchCustomerDetail(id);
```

## 46.4 Avoid Open Session in View

Keeping persistence context open through serialization hides data access in view layer.

## 46.5 Rule

Serialization must not be a database access strategy.

---

# 47. Response Entity dan Multi-Tenancy/Security

## 47.1 Field-level security

Same resource may expose different fields depending role.

Be explicit.

## 47.2 Bad

Return full internal DTO then rely on JSON ignore dynamically.

## 47.3 Better

Mapper builds response for caller:

```java
CustomerResponse response = mapper.toResponse(customer, currentUser.permissions());
```

## 47.4 Tenant isolation

Do not include cross-tenant links/IDs.

## 47.5 Cache

User-specific/tenant-specific response should be private/no-store as appropriate.

## 47.6 Rule

Response shape is part of authorization boundary.

---

# 48. Testing Response Writing

## 48.1 Status tests

Assert exact status:

- create → 201;
- delete → 204;
- async → 202;
- cache hit → 304;
- stale update → 412.

## 48.2 Header tests

Assert:

- `Content-Type`;
- `Location`;
- `ETag`;
- `Cache-Control`;
- `Vary`;
- `Content-Disposition`;
- `Set-Cookie` attributes.

## 48.3 JSON shape tests

Golden JSON or schema/contract tests.

## 48.4 Media negotiation

Test:

```http
Accept: application/json
Accept: application/xml
Accept: text/csv
Accept: */*
```

## 48.5 Generic response tests

If using `Response.ok(list)`, test writer output.

## 48.6 Streaming tests

Test large output without OOM.

Test client disconnect if possible.

## 48.7 File download tests

- content length;
- content type;
- content disposition;
- ETag;
- unauthorized access;
- range if supported.

## 48.8 Runtime tests

Direct unit tests do not test `MessageBodyWriter`.

Use HTTP integration tests.

---

# 49. Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus

## 49.1 JSON writer

Runtime may use JSON-B or Jackson.

Differences:

- null serialization;
- date/time;
- records;
- polymorphism;
- enum casing;
- unknown properties for roundtrip tests.

## 49.2 Generic type

Some writers handle erased generic values better than others.

Do not rely on luck.

## 49.3 Streaming behavior

Buffering, commit timing, exception behavior can differ.

## 49.4 File response optimization

Some runtimes support sendfile/file optimizations; others do not.

## 49.5 Cookies API

Jakarta REST versions evolve `NewCookie` builder/features.

## 49.6 Quarkus/reactive

Blocking streaming and reactive responses have runtime-specific guidance.

## 49.7 Rule

Test response contract on the runtime you deploy.

---

# 50. Common Failure Modes

## 50.1 `MessageBodyWriter not found`

Entity type/media lacks writer.

## 50.2 Wrong media type

Missing/incorrect `@Produces`.

## 50.3 `Response.ok(list)` loses generic type

Serialization weirdness.

## 50.4 Returning entity causes lazy loading exception

JPA entity exposed.

## 50.5 Infinite recursion

Bidirectional entity relationship serialized.

## 50.6 `204` with body

Protocol violation/confusing client behavior.

## 50.7 Missing `Location` on `201`

Client cannot locate created resource.

## 50.8 Internal URL in `Location`

Gateway/proxy not handled.

## 50.9 Body logged or sensitive fields exposed

Security incident.

## 50.10 Streaming error after commit

Partial response.

## 50.11 Content-Disposition injection

Unsafe filename.

## 50.12 Cache leaks private data

Wrong `Cache-Control`.

## 50.13 Cookie missing Secure/HttpOnly/SameSite

Session risk.

## 50.14 Custom writer too broad

Hijacks responses.

---

# 51. Best Practices

## 51.1 Use DTOs/projections

Never expose JPA entity by default.

## 51.2 Be explicit with `@Produces`

Especially non-JSON endpoints.

## 51.3 Return DTO for simple 200

Return `Response` when status/headers matter.

## 51.4 Use `GenericEntity` or wrapper DTO for generics

Prefer wrapper for public collection responses.

## 51.5 Use `StreamingOutput` for large responses

But validate before streaming.

## 51.6 Set correct headers

`Location`, `ETag`, `Cache-Control`, `Content-Disposition`, `Vary`.

## 51.7 Secure cookies

Use `Secure`, `HttpOnly`, `SameSite`.

## 51.8 Centralize security/CORS headers

Use filters/gateway.

## 51.9 Test actual HTTP responses

Status + headers + body + media negotiation.

## 51.10 Keep writers narrow

Custom `MessageBodyWriter` should target specific type/media.

---

# 52. Anti-Patterns

## 52.1 Returning JPA entities

Security/lazy/versioning problems.

## 52.2 Always returning 200

Breaks HTTP semantics.

## 52.3 `Response` everywhere with no reason

Boilerplate and weak schema docs.

## 52.4 Bare list for paginated public API

No metadata evolution.

## 52.5 Streaming from DB inside request for huge report

Long transaction/partial failure.

## 52.6 Manual JSON string building

Escaping/security bugs.

## 52.7 Custom writer catches all objects

Provider hijack.

## 52.8 Missing cache policy

Sensitive data risk/performance loss.

## 52.9 Unsafe filename in header

Header injection/path leak.

## 52.10 Cookie set in random resource

Scattered security behavior.

---

# 53. Production Checklist

## 53.1 Response contract

- [ ] Status codes documented.
- [ ] `@Produces` explicit.
- [ ] JSON shape tested.
- [ ] Error shape tested.
- [ ] No JPA entities returned.
- [ ] DTOs/projections ready before serialization.

## 53.2 Headers

- [ ] `Location` for `201`/async `202`.
- [ ] `ETag` where concurrency/cache needed.
- [ ] `Cache-Control` for sensitive/cacheable responses.
- [ ] `Vary` for negotiated/cacheable responses.
- [ ] `Content-Disposition` safe for downloads.
- [ ] Security headers centralized.

## 53.3 Serialization

- [ ] JSON provider known.
- [ ] Generic responses handled.
- [ ] Custom writers registered/narrow.
- [ ] Serialization failures mapped/logged.
- [ ] No lazy loading during writing.

## 53.4 Streaming/download

- [ ] Authorization before streaming.
- [ ] Resource existence before streaming.
- [ ] No long DB transaction unless intentional.
- [ ] Content length known or chunked policy.
- [ ] Partial failure behavior understood.
- [ ] Large exports use job if needed.

## 53.5 Security/privacy

- [ ] Sensitive fields filtered.
- [ ] Cookies secure.
- [ ] Private responses not publicly cached.
- [ ] Header values sanitized.
- [ ] No body/secret logging.

## 53.6 Tests

- [ ] Integration tests for body writing.
- [ ] Media negotiation tests.
- [ ] Header tests.
- [ ] Cookie tests.
- [ ] Streaming tests.
- [ ] Gateway URL tests.

---

# 54. Latihan

## Latihan 1 — DTO vs Response

Buat dua endpoint:

```text
GET /customers/{id}
POST /customers
```

- GET return DTO langsung.
- POST return `201 Created` dengan `Location` dan body.

Jelaskan kenapa berbeda.

## Latihan 2 — ETag Response

Tambahkan ETag ke:

```text
GET /customers/{id}
PUT /customers/{id}
```

Test `If-None-Match` dan `If-Match`.

## Latihan 3 — GenericEntity

Buat endpoint:

```java
Response.ok(List<CustomerResponse>)
```

Lalu ubah ke `GenericEntity<List<CustomerResponse>>`.

Bandingkan behavior/runtime docs.

## Latihan 4 — Pagination Envelope

Refactor bare list response menjadi:

```json
{
  "items": [],
  "page": {},
  "links": []
}
```

Tambahkan `Link` header untuk next page.

## Latihan 5 — Streaming CSV

Implement:

```text
GET /customer-exports/current/file
Accept: text/csv
```

Gunakan `StreamingOutput`.

Test 100k rows tanpa menyimpan semua di memory.

## Latihan 6 — Download Security

Implement document download dengan:

- sanitized `Content-Disposition`;
- verified `Content-Type`;
- `Content-Length`;
- `ETag`;
- authorization before streaming.

## Latihan 7 — Custom MessageBodyWriter

Buat `MessageBodyWriter<CustomerExport>` untuk `text/csv`.

Pastikan `isWriteable` narrow.

## Latihan 8 — Problem Details Mapper

Implement `ExceptionMapper<DomainException>` yang return:

```text
application/problem+json
```

Test JSON shape.

## Latihan 9 — Gateway Location Test

Deploy behind gateway/path prefix.

Pastikan `Location` header external benar.

---

# 55. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

2. Jakarta RESTful Web Services 4.0 — `MessageBodyWriter` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/messagebodywriter

3. Jakarta RESTful Web Services 4.0 — `Response` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/response

4. Jakarta RESTful Web Services 4.0 — `Response.ResponseBuilder` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/response.responsebuilder

5. Jakarta RESTful Web Services 4.0 — `GenericEntity` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/genericentity

6. Jakarta RESTful Web Services 4.0 — `StreamingOutput` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/streamingoutput

7. Jakarta RESTful Web Services 4.0 — `EntityTag` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/entitytag

8. Jakarta RESTful Web Services 4.0 — `CacheControl` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/cachecontrol

9. Jakarta RESTful Web Services 4.0 — `Link` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/link

10. Jakarta RESTful Web Services 4.0 — `NewCookie` API Docs  
    https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/newcookie

11. Jakarta EE Tutorial — Building RESTful Web Services with Jakarta REST  
    https://jakarta.ee/learn/docs/jakartaee-tutorial/current/websvcs/rest/rest.html

12. RFC 9110 — HTTP Semantics  
    https://www.rfc-editor.org/rfc/rfc9110.html

13. RFC 9111 — HTTP Caching  
    https://www.rfc-editor.org/rfc/rfc9111.html

14. RFC 9457 — Problem Details for HTTP APIs  
    https://www.rfc-editor.org/rfc/rfc9457.html

---

# 56. Penutup

Response writing adalah sisi output dari JAX-RS runtime.

Mental model utama:

```text
resource return value
  ↓
Response metadata/status/entity
  ↓
MessageBodyWriter selection
  ↓
serialization/streaming
  ↓
HTTP response bytes
```

Untuk response sederhana:

```java
return CustomerResponse;
```

Untuk response yang butuh HTTP semantics:

```java
return Response.created(location)
    .tag(entityTag)
    .cacheControl(cacheControl)
    .entity(body)
    .build();
```

Top-tier JAX-RS engineer memahami bahwa response bukan hanya JSON:

- status code mengatur client behavior;
- headers membawa metadata dan policy;
- `ETag` mencegah lost update;
- `Cache-Control` mencegah data leak atau meningkatkan performance;
- `Location` menghubungkan create/async flow;
- `Link` membantu navigasi;
- cookies adalah security-sensitive;
- streaming mengubah failure semantics;
- custom writer adalah format boundary;
- DTO boundary mencegah lazy loading/security leak.

Prinsip final:

```text
Return ready-to-serialize representations.
Use Response when HTTP semantics matter.
Let MessageBodyWriter handle format.
Never let serialization accidentally perform business/data/security work.
```

Part berikutnya:

```text
Bagian 011 — Content Negotiation Deep Dive: @Consumes, @Produces, MediaType, Variant, q/qs, Vary
```

Kita akan membedah negotiation secara sangat detail: request `Content-Type`, response `Accept`, `@Consumes`, `@Produces`, media type specificity, `q`, `qs`, `Variant`, `Vary`, JSON/XML/CSV/PDF strategy, and production negotiation testing.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-009.md](./learn-jaxrs-advanced-part-009.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-011.md](./learn-jaxrs-advanced-part-011.md)

</div>