# learn-jaxrs-advanced-part-009.md

# Bagian 009 — Request Entity Binding: Input Entity, Streams, Readers, DTO Boundary, Payload Safety, dan `MessageBodyReader`

> Target pembaca: Java/Jakarta engineer yang ingin menguasai **request body binding** di JAX-RS/Jakarta REST secara mendalam. Part ini membahas bagaimana HTTP request entity body dibaca menjadi Java object, kapan runtime memakai `MessageBodyReader`, kapan menerima DTO, kapan menerima `InputStream`, bagaimana stream bersifat sekali baca, bagaimana mengelola large payload, JSON/XML/form/multipart, validation boundary, payload limits, security, observability, dan production-grade request body design.
>
> Namespace utama: `jakarta.ws.rs.*`, `jakarta.ws.rs.ext.MessageBodyReader`, `jakarta.ws.rs.core.EntityPart`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Request Entity adalah Stream Representasi, Bukan Object Otomatis](#2-mental-model-request-entity-adalah-stream-representasi-bukan-object-otomatis)
3. [HTTP Request Body vs Parameter Injection](#3-http-request-body-vs-parameter-injection)
4. [Entity Parameter: Unannotated Method Parameter](#4-entity-parameter-unannotated-method-parameter)
5. [Hanya Satu Entity Parameter](#5-hanya-satu-entity-parameter)
6. [Bagaimana Runtime Memilih `MessageBodyReader`](#6-bagaimana-runtime-memilih-messagebodyreader)
7. [`@Consumes` sebagai Kontrak Request Body](#7-consumes-sebagai-kontrak-request-body)
8. [`Content-Type` dan `415 Unsupported Media Type`](#8-content-type-dan-415-unsupported-media-type)
9. [JSON DTO Binding](#9-json-dto-binding)
10. [DTO Boundary: Jangan Bind Langsung ke Entity/Domain Object](#10-dto-boundary-jangan-bind-langsung-ke-entitydomain-object)
11. [Records, POJO, Constructor, dan JSON-B/Jackson Provider](#11-records-pojo-constructor-dan-json-bjackson-provider)
12. [Validation Flow: Deserialization lalu Jakarta Validation](#12-validation-flow-deserialization-lalu-jakarta-validation)
13. [Unknown Fields, Missing Fields, Null Fields](#13-unknown-fields-missing-fields-null-fields)
14. [PATCH/Merge Patch DTO Strategy](#14-patchmerge-patch-dto-strategy)
15. [Raw `String` Entity](#15-raw-string-entity)
16. [`byte[]` Entity](#16-byte-entity)
17. [`InputStream` Entity](#17-inputstream-entity)
18. [Stream is One-Time Read](#18-stream-is-one-time-read)
19. [Buffering: Kapan Boleh, Kapan Berbahaya](#19-buffering-kapan-boleh-kapan-berbahaya)
20. [Large Payload Strategy](#20-large-payload-strategy)
21. [Payload Size Limits](#21-payload-size-limits)
22. [Backpressure, Slow Client, dan Timeout](#22-backpressure-slow-client-dan-timeout)
23. [Streaming Upload ke Storage](#23-streaming-upload-ke-storage)
24. [Request Body Logging: Hampir Selalu Jangan](#24-request-body-logging-hampir-selalu-jangan)
25. [Idempotency dan Body Hash](#25-idempotency-dan-body-hash)
26. [Form URL Encoded dan `@FormParam`](#26-form-url-encoded-dan-formparam)
27. [Multipart Form Data dan `EntityPart`](#27-multipart-form-data-dan-entitypart)
28. [`List<EntityPart>` vs `@FormParam EntityPart`](#28-listentitypart-vs-formparam-entitypart)
29. [`EntityPart#getContent()` dan One-Time Content Read](#29-entitypartgetcontent-dan-one-time-content-read)
30. [Multipart Security: Filename, Content-Type, Size, Malware Scan](#30-multipart-security-filename-content-type-size-malware-scan)
31. [XML Request Body dan Jakarta REST 4.0 JAXB Removal](#31-xml-request-body-dan-jakarta-rest-40-jaxb-removal)
32. [Custom `MessageBodyReader`](#32-custom-messagebodyreader)
33. [`MessageBodyReader#isReadable`](#33-messagebodyreaderisreadable)
34. [`MessageBodyReader#readFrom`](#34-messagebodyreaderreadfrom)
35. [`@Provider`, `@Consumes`, `@Priority` untuk Reader](#35-provider-consumes-priority-untuk-reader)
36. [Reader vs ReaderInterceptor](#36-reader-vs-readerinterceptor)
37. [Reader Error Handling dan `BadRequestException`](#37-reader-error-handling-dan-badrequestexception)
38. [Generic Entity Types dan Type Erasure](#38-generic-entity-types-dan-type-erasure)
39. [Entity Body dan Transactions](#39-entity-body-dan-transactions)
40. [Entity Body dan Security](#40-entity-body-dan-security)
41. [Entity Body dan Multi-Tenancy](#41-entity-body-dan-multi-tenancy)
42. [Entity Body dan Observability](#42-entity-body-dan-observability)
43. [Testing Request Entity Binding](#43-testing-request-entity-binding)
44. [Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus](#44-runtime-differences-jersey-resteasy-cxf-liberty-quarkus)
45. [Common Failure Modes](#45-common-failure-modes)
46. [Best Practices](#46-best-practices)
47. [Anti-Patterns](#47-anti-patterns)
48. [Production Checklist](#48-production-checklist)
49. [Latihan](#49-latihan)
50. [Referensi Resmi](#50-referensi-resmi)
51. [Penutup](#51-penutup)

---

# 1. Tujuan Part Ini

Request body adalah salah satu boundary paling riskan dalam API.

Contoh sederhana:

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response create(@Valid CreateCustomerRequest request) {
    ...
}
```

Kelihatannya mudah.

Tetapi di balik method itu, runtime melakukan banyak hal:

```text
read HTTP entity stream
  ↓
select MessageBodyReader based on Java type + generic type + annotations + Content-Type
  ↓
deserialize bytes into Java object
  ↓
run validation if configured
  ↓
invoke resource method
```

Jika body besar, malformed, tidak sesuai `Content-Type`, mengandung field tidak dikenal, punya null berbahaya, membawa file besar, atau perlu streaming, resource method design harus berubah.

## 1.1 Yang akan kamu kuasai

Setelah part ini, kamu akan bisa:

- memahami entity parameter;
- membedakan request body binding vs parameter injection;
- memahami `MessageBodyReader`;
- memakai DTO dengan benar;
- memilih `String`, `byte[]`, `InputStream`, atau DTO;
- menangani large payload/file upload;
- memahami one-time stream read;
- mengatur payload limit;
- menghindari logging body berbahaya;
- memahami multipart `EntityPart`;
- membuat custom `MessageBodyReader` jika perlu;
- menulis tests untuk JSON/form/multipart/stream binding.

## 1.2 Prinsip utama

```text
Request body is an untrusted stream of representation bytes.
JAX-RS can convert it into Java objects, but you still own the contract, safety, validation, and lifecycle.
```

---

# 2. Mental Model: Request Entity adalah Stream Representasi, Bukan Object Otomatis

HTTP request body adalah stream bytes.

```http
POST /customers
Content-Type: application/json

{
  "name": "Fajar",
  "email": "fajar@example.com"
}
```

JAX-RS tidak “menerima object Java”.

Ia menerima stream bytes, lalu memilih provider untuk membaca stream menjadi Java type.

## 2.1 Representation bytes

Body bytes memiliki media type:

```http
Content-Type: application/json
```

## 2.2 Java target type

Resource method menentukan target:

```java
CreateCustomerRequest request
```

## 2.3 Reader

Runtime mencari:

```java
MessageBodyReader<CreateCustomerRequest>
```

yang bisa membaca:

```text
application/json
```

## 2.4 Result

Jika berhasil:

```java
CreateCustomerRequest
```

diinject sebagai entity parameter.

## 2.5 Failure

Jika tidak ada reader:

```text
415 Unsupported Media Type
```

atau provider error.

Jika JSON malformed:

```text
400 Bad Request
```

atau implementation-specific default unless mapped.

## 2.6 Top-tier mindset

```text
Entity binding is provider-driven stream deserialization.
```

---

# 3. HTTP Request Body vs Parameter Injection

JAX-RS punya dua kategori input besar:

## 3.1 Metadata parameter injection

```java
@PathParam
@QueryParam
@HeaderParam
@CookieParam
@MatrixParam
```

Source:

- URI path;
- query;
- headers;
- cookies;
- matrix params.

## 3.2 Entity body binding

Unannotated parameter or form/multipart binding reads request body.

```java
public Response create(CreateCustomerRequest request)
```

## 3.3 Example combined

```java
@PUT
@Path("/customers/{customerId}")
@Consumes(MediaType.APPLICATION_JSON)
public Response replace(
    @PathParam("customerId") CustomerId customerId,
    @HeaderParam("If-Match") String ifMatch,
    @Valid ReplaceCustomerRequest body
) {
    ...
}
```

Here:

- `customerId` from path;
- `ifMatch` from header;
- `body` from request entity.

## 3.4 Why distinction matters

Entity body is stream and usually can be read once.

Metadata params can be read many times from request metadata maps.

## 3.5 Avoid ambiguity

Do not hide body parsing inside `HttpServletRequest` if JAX-RS can bind DTO.

## 3.6 Rule

Use parameter annotations for metadata; use entity parameter for representation body.

---

# 4. Entity Parameter: Unannotated Method Parameter

A resource method can have an unannotated parameter representing request entity body.

## 4.1 JSON DTO

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response create(CreateCustomerRequest request) {
    ...
}
```

## 4.2 InputStream

```java
@POST
@Consumes("application/octet-stream")
public Response upload(InputStream body) {
    ...
}
```

## 4.3 String

```java
@POST
@Consumes(MediaType.TEXT_PLAIN)
public Response submit(String text) {
    ...
}
```

## 4.4 EntityPart list

```java
@POST
@Consumes(MediaType.MULTIPART_FORM_DATA)
public Response upload(List<EntityPart> parts) {
    ...
}
```

## 4.5 Combined with metadata

```java
public Response create(
    @HeaderParam("Idempotency-Key") String key,
    CreateOrderRequest request
)
```

## 4.6 Important

Do not annotate entity parameter with `@QueryParam`, etc.

If annotated, it is not entity body parameter.

---

# 5. Hanya Satu Entity Parameter

A resource method should have at most one unannotated entity body parameter.

## 5.1 Why?

HTTP request has one entity stream.

Example bad:

```java
public Response create(CustomerRequest customer, AuditRequest audit) {
    ...
}
```

Runtime cannot read same body into two unrelated objects.

## 5.2 Better

Create one request DTO:

```java
public record CreateCustomerRequest(
    CustomerPayload customer,
    AuditPayload audit
) {}
```

## 5.3 Metadata separate

It is okay to combine entity parameter with annotated metadata parameters:

```java
public Response create(
    @HeaderParam("Idempotency-Key") String key,
    @Valid CreatePaymentRequest request
)
```

## 5.4 Form/multipart exception

`@FormParam` reads parts/form fields from request entity, but conceptually still one body.

Mixing raw entity body with `@FormParam` is risky.

## 5.5 Rule

```text
One request body → one entity binding model.
```

---

# 6. Bagaimana Runtime Memilih `MessageBodyReader`

`MessageBodyReader<T>` converts request entity stream into Java type.

## 6.1 Selection inputs

Runtime considers:

- Java raw type;
- generic type;
- annotations;
- request `Content-Type`;
- registered readers;
- reader `@Consumes`;
- `isReadable`;
- provider priority.

## 6.2 Simplified flow

```text
request Content-Type = application/json
target type = CreateCustomerRequest
  ↓
find readers compatible with application/json
  ↓
call isReadable(type, genericType, annotations, mediaType)
  ↓
choose highest priority suitable reader
  ↓
call readFrom(...)
```

## 6.3 Built-in/standard providers

Implementations provide readers for common types.

Common examples:

- `String`;
- `byte[]`;
- `InputStream`;
- `Reader`;
- JSON-B/JSON-P types depending runtime/profile;
- `EntityPart` multipart in Jakarta REST 3.1+.

## 6.4 JSON provider

JSON DTO binding needs JSON provider such as JSON-B or Jackson provider.

Jakarta EE runtimes often include JSON-B integration, but exact defaults vary.

## 6.5 No reader

If no reader supports requested type/media, request cannot be consumed.

## 6.6 Top-tier rule

When request body binding fails, debug provider selection:

```text
Content-Type
@Consumes
target type
generic type
registered MessageBodyReaders
provider priority
runtime JSON/multipart support
```

---

# 7. `@Consumes` sebagai Kontrak Request Body

`@Consumes` declares media types resource can accept.

## 7.1 Method-level

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response create(CreateCustomerRequest request) { ... }
```

## 7.2 Class-level

```java
@Path("/customers")
@Consumes(MediaType.APPLICATION_JSON)
public class CustomerResource { ... }
```

Method-level overrides class-level.

## 7.3 Multiple media types

```java
@Consumes({
    MediaType.APPLICATION_JSON,
    "application/merge-patch+json"
})
```

## 7.4 Why important?

- drives method matching;
- documents API contract;
- protects from unexpected formats;
- influences `MessageBodyReader` selection.

## 7.5 Do not omit casually

If omitted, runtime may accept broad media types depending defaults/readers.

Be explicit for endpoints with body.

## 7.6 Good policy

For JSON APIs:

```java
@Consumes(MediaType.APPLICATION_JSON)
```

For upload:

```java
@Consumes(MediaType.MULTIPART_FORM_DATA)
```

For binary:

```java
@Consumes(MediaType.APPLICATION_OCTET_STREAM)
```

## 7.7 Error

Unsupported request media type:

```text
415 Unsupported Media Type
```

---

# 8. `Content-Type` dan `415 Unsupported Media Type`

`Content-Type` describes request body media type.

## 8.1 Example

```http
POST /customers
Content-Type: application/json
```

## 8.2 Matching with `@Consumes`

If endpoint consumes JSON only:

```java
@Consumes(MediaType.APPLICATION_JSON)
```

Request with:

```text
text/plain
```

should fail with 415.

## 8.3 Missing Content-Type

For body-bearing request, missing `Content-Type` is problematic.

Runtime may use `application/octet-stream` or default behavior.

Define policy.

## 8.4 Charset

```text
application/json;charset=UTF-8
```

should generally be compatible with `application/json`.

## 8.5 Wrong Content-Type with JSON body

Client sends:

```http
Content-Type: text/plain

{"name":"Fajar"}
```

Runtime may not use JSON reader.

Result 415 or wrong binding.

## 8.6 Debugging 415

Check:

- actual header;
- `@Consumes`;
- request body;
- selected resource method;
- provider registration;
- media suffix like `+json`.

## 8.7 Rule

Never rely on body content sniffing. Contract is `Content-Type`.

---

# 9. JSON DTO Binding

Most enterprise JAX-RS APIs bind JSON body into DTO.

## 9.1 Request DTO

```java
public record CreateCustomerRequest(
    @NotBlank String name,
    @Email String email
) {}
```

Resource:

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public Response create(@Valid CreateCustomerRequest request, @Context UriInfo uriInfo) {
    CreatedCustomer result = service.create(mapper.toCommand(request));

    URI location = uriInfo.getAbsolutePathBuilder()
        .path(result.id().value())
        .build();

    return Response.created(location)
        .entity(mapper.toResponse(result))
        .build();
}
```

## 9.2 Flow

```text
JSON bytes
  ↓ JSON MessageBodyReader
CreateCustomerRequest
  ↓ validation
resource method
  ↓ mapper
CreateCustomerCommand
  ↓ service
```

## 9.3 Why DTO?

Request representation is API contract.

Domain model is business model.

Persistence entity is database mapping.

They should not be the same by default.

## 9.4 JSON provider

Jakarta REST itself defines provider mechanism; JSON binding depends on providers and runtime.

In Jakarta EE, JSON-B integration is common.

In other runtimes, Jackson may be used.

## 9.5 Test actual JSON shape

Do not assume provider serializes/deserializes exactly as desired.

Test:

- missing fields;
- null fields;
- unknown fields;
- invalid types;
- date formats;
- enum values.

## 9.6 Rule

DTO is not boilerplate; it is your public input contract.

---

# 10. DTO Boundary: Jangan Bind Langsung ke Entity/Domain Object

## 10.1 Bad

```java
@POST
public Response create(CustomerEntity entity) {
    entityManager.persist(entity);
    ...
}
```

## 10.2 Problems

- client controls persistence fields;
- over-posting/mass assignment;
- lazy relations;
- internal fields exposed;
- JPA annotations affect JSON;
- domain invariants bypassed;
- versioning difficult;
- security risks.

## 10.3 Better

```java
public record CreateCustomerRequest(
    String name,
    String email
) {}
```

Map to command:

```java
CreateCustomerCommand command = mapper.toCommand(request);
```

## 10.4 Domain object input?

Sometimes a domain command/value object can be deserialized directly if it is intentionally API-facing and stable.

But be cautious.

## 10.5 Mass assignment example

Client sends:

```json
{
  "name": "Fajar",
  "role": "ADMIN",
  "status": "APPROVED"
}
```

If entity has those fields and binds directly, security disaster.

## 10.6 Rule

```text
Request DTO defines what client is allowed to say.
```

---

# 11. Records, POJO, Constructor, dan JSON-B/Jackson Provider

## 11.1 Java records

```java
public record CreateCustomerRequest(
    @NotBlank String name,
    @Email String email
) {}
```

Records are concise and immutable.

## 11.2 Provider support

JSON-B/Jackson support for records depends on versions/configuration.

Modern runtimes often support records, but test on target runtime.

## 11.3 POJO

```java
public class CreateCustomerRequest {
    public String name;
    public String email;
}
```

Simple but mutable.

## 11.4 Bean-style

```java
public class CreateCustomerRequest {
    private String name;

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
}
```

Portable for many JSON providers.

## 11.5 Constructor

Some providers need no-arg constructor or annotations.

## 11.6 Recommendation

For modern Java/Jakarta:

- records are excellent if provider/runtime supports;
- otherwise POJO with getters/setters;
- test deserialization.

## 11.7 Provider-specific annotations

Avoid binding DTO to Jackson-specific annotations if portability to JSON-B matters.

If using Jackson intentionally, document runtime dependency.

---

# 12. Validation Flow: Deserialization lalu Jakarta Validation

## 12.1 Flow

```text
read bytes
  ↓
deserialize into DTO
  ↓
validate DTO constraints
  ↓
resource method invoked
```

If deserialization fails, validation does not run.

## 12.2 Example

```java
public record CreateOrderRequest(
    @NotEmpty List<@Valid OrderItemRequest> items,
    @NotNull CustomerId customerId
) {}
```

Resource:

```java
public Response create(@Valid CreateOrderRequest request) { ... }
```

## 12.3 Deserialization error

JSON:

```json
{"items": "not-an-array"}
```

Reader fails.

Response should be 400.

## 12.4 Validation error

JSON:

```json
{"items": []}
```

Deserializes, then validation fails.

Response can be 400 or 422 depending policy.

## 12.5 Business validation

```text
customer is inactive
item out of stock
```

belongs in service/domain.

## 12.6 Error taxonomy

- malformed JSON → `MALFORMED_REQUEST_BODY`;
- wrong JSON type → `REQUEST_BODY_DESERIALIZATION_FAILED`;
- constraint violation → `VALIDATION_FAILED`;
- business invariant → `CONFLICT` or domain error.

## 12.7 Rule

Separate parse, validation, and business errors.

---

# 13. Unknown Fields, Missing Fields, Null Fields

JSON input has tricky cases.

## 13.1 Unknown fields

Client sends:

```json
{
  "name": "Fajar",
  "isAdmin": true
}
```

If DTO has no `isAdmin`.

Policy choices:

- reject unknown fields;
- ignore unknown fields.

## 13.2 Reject unknown

Pros:

- catches typos;
- prevents mass assignment confusion;
- strong contract.

Cons:

- less forward-compatible.

## 13.3 Ignore unknown

Pros:

- more tolerant;
- easier client evolution.

Cons:

- hides client bugs;
- may confuse clients.

## 13.4 Missing fields

```json
{
  "name": "Fajar"
}
```

Use validation:

```java
@NotNull String email
```

## 13.5 Null fields

```json
{
  "email": null
}
```

Use `@NotNull`/custom validation.

## 13.6 Empty string

```json
{
  "email": ""
}
```

Use `@NotBlank` and `@Email`.

## 13.7 Recommendation

For internal enterprise APIs, rejecting unknown fields is often safer.

For public APIs, consider compatibility policy.

## 13.8 Test these cases

Many bugs hide in null/missing/unknown semantics.

---

# 14. PATCH/Merge Patch DTO Strategy

PATCH is partial update.

## 14.1 Problem

With normal DTO:

```java
public record PatchCustomerRequest(
    String name,
    String email
) {}
```

How distinguish:

- field missing;
- field present null;
- field present value?

## 14.2 JSON Merge Patch

Media type:

```text
application/merge-patch+json
```

`null` usually means remove field.

## 14.3 JSON Patch

Media type:

```text
application/json-patch+json
```

Operations:

```json
[
  {"op":"replace","path":"/email","value":"new@example.com"}
]
```

## 14.4 Strategy options

1. Use `JsonObject`/JSON-P and apply patch.
2. Use dedicated OptionalField wrapper.
3. Use JSON Merge Patch provider.
4. Use operation command DTO.

## 14.5 Avoid naive DTO

If missing and null collapse, PATCH semantics are wrong.

## 14.6 JAX-RS

```java
@PATCH
@Consumes("application/merge-patch+json")
public Response patch(JsonObject patch) {
    ...
}
```

## 14.7 Validation

Validate resulting resource or patch document constraints.

## 14.8 Rule

PATCH DTO must preserve presence semantics.

---

# 15. Raw `String` Entity

You can bind request body to `String`.

## 15.1 Example

```java
@POST
@Consumes(MediaType.TEXT_PLAIN)
public Response submit(String body) {
    ...
}
```

## 15.2 Use cases

- plain text;
- webhook raw payload;
- signature verification;
- small DSL;
- legacy integration.

## 15.3 Risks

- entire body buffered into memory;
- encoding assumptions;
- no structural validation;
- easy to log accidentally.

## 15.4 JSON as String?

Possible:

```java
@Consumes(MediaType.APPLICATION_JSON)
public Response webhook(String rawJson) { ... }
```

Useful for signature verification before parsing.

## 15.5 Better for large body

Use `InputStream`.

## 15.6 Rule

Use `String` only for small text bodies where raw content matters.

---

# 16. `byte[]` Entity

`byte[]` binds full body into memory.

## 16.1 Example

```java
@POST
@Consumes(MediaType.APPLICATION_OCTET_STREAM)
public Response upload(byte[] bytes) {
    ...
}
```

## 16.2 Use cases

- small binary payload;
- checksum;
- cryptographic verification.

## 16.3 Risks

- memory blow-up;
- GC pressure;
- no streaming;
- easy DoS if no size limit.

## 16.4 Limit required

Only use with strict max payload size.

## 16.5 Better for large binary

Use `InputStream`.

## 16.6 Rule

`byte[]` means “I am okay buffering entire body in memory.”

---

# 17. `InputStream` Entity

`InputStream` gives raw request body stream.

## 17.1 Example

```java
@POST
@Consumes(MediaType.APPLICATION_OCTET_STREAM)
public Response upload(
    @HeaderParam("Content-Length") long contentLength,
    InputStream input
) {
    storage.store(input);
    return Response.accepted().build();
}
```

## 17.2 Use cases

- large file upload;
- streaming to object storage;
- custom parser;
- checksum while streaming;
- data import.

## 17.3 Responsibilities

If you accept `InputStream`, you own:

- reading;
- limit enforcement;
- timeouts/backpressure awareness;
- error handling;
- closing/lifecycle expectations;
- validation;
- checksum;
- storage cleanup on failure.

## 17.4 Do not read into memory accidentally

Bad:

```java
byte[] all = input.readAllBytes();
```

for large upload.

## 17.5 Stream to sink

```java
input.transferTo(outputStream);
```

But wrap with counting/limiting stream.

## 17.6 Rule

`InputStream` is for streaming; do not turn it into `byte[]` unless small and bounded.

---

# 18. Stream is One-Time Read

Request entity stream can generally be consumed once.

## 18.1 Problem

Filter reads body for logging.

Then resource method receives empty stream.

## 18.2 Example bad filter

```java
public void filter(ContainerRequestContext ctx) throws IOException {
    String body = new String(ctx.getEntityStream().readAllBytes(), UTF_8);
    log.info(body);
    // stream consumed, not reset
}
```

## 18.3 If buffering

Must replace entity stream:

```java
byte[] body = ctx.getEntityStream().readAllBytes();
ctx.setEntityStream(new ByteArrayInputStream(body));
```

## 18.4 But buffering dangerous

Large bodies can blow memory.

## 18.5 Better logging

Log metadata only:

- content length;
- content type;
- route;
- request ID;
- body hash maybe;
- not body content.

## 18.6 Rule

Never read request entity stream in filter/interceptor unless you own buffering/limit/security.

---

# 19. Buffering: Kapan Boleh, Kapan Berbahaya

## 19.1 Boleh

Small bounded payload:

```text
max 64 KB
```

Use case:

- webhook signature;
- audit hash;
- validation requiring full body;
- retry body within client.

## 19.2 Berbahaya

Unbounded JSON/file upload.

## 19.3 Memory amplification

Concurrent requests × max body size = memory risk.

Example:

```text
100 concurrent × 10 MB = 1 GB
```

## 19.4 Disk buffering

For large body, use temp file/spooling if needed.

## 19.5 Streaming parse

For large JSON/CSV/XML, use streaming parser rather than full object tree.

## 19.6 Rule

Buffer only with explicit size limit and reason.

---

# 20. Large Payload Strategy

Large payloads need different design.

## 20.1 Questions

- What is max size?
- Is upload synchronous?
- Is file scanned?
- Is checksum required?
- Is result immediate or async?
- Where is body stored?
- Can request be retried?
- Is operation idempotent?
- How to resume?
- How to clean partial uploads?

## 20.2 Strategies

1. Direct streaming to app then storage.
2. Pre-signed URL direct to object storage.
3. Multipart chunk upload session.
4. Async import job.
5. Message/event after upload complete.

## 20.3 Avoid app as file proxy

For very large files, app server may not be best data plane.

Use object storage pre-signed upload when possible.

## 20.4 Metadata first

Create upload session:

```http
POST /upload-sessions
```

Then upload content:

```http
PUT /upload-sessions/{id}/content
```

## 20.5 Async processing

Return:

```http
202 Accepted
Location: /import-jobs/J001
```

## 20.6 Rule

Large body endpoint is an ingestion pipeline, not normal CRUD.

---

# 21. Payload Size Limits

## 21.1 Why limits?

Prevent:

- memory exhaustion;
- disk exhaustion;
- slow upload DoS;
- huge JSON parsing;
- zip bomb/multipart abuse.

## 21.2 Layers

Enforce at:

- CDN/WAF;
- API gateway;
- ingress;
- servlet container;
- JAX-RS/runtime;
- app code counting stream.

## 21.3 Content-Length

If present, check early:

```java
@HeaderParam("Content-Length") long length
```

But clients can omit or lie in chunked transfer.

## 21.4 Counting stream

Wrap stream to enforce max bytes.

## 21.5 Error

Payload too large:

```text
413 Content Too Large
```

HTTP status naming in modern RFC is Content Too Large; many APIs still say Payload Too Large.

## 21.6 Multipart per-part limit

Need:

- total payload limit;
- per-part limit;
- filename length limit;
- number of parts limit.

## 21.7 Rule

Every entity-bearing endpoint needs size policy.

---

# 22. Backpressure, Slow Client, dan Timeout

## 22.1 Slow upload

Client sends body slowly.

Risk:

- thread occupied;
- connection occupied;
- request timeout;
- resource exhaustion.

## 22.2 Server/gateway timeout

Configure:

- request body read timeout;
- idle timeout;
- max request duration;
- upload timeout.

## 22.3 Backpressure

Classic servlet/JAX-RS blocking IO may tie threads to slow clients.

Reactive runtimes behave differently.

## 22.4 Application behavior

Do not start DB transaction before reading huge body.

## 22.5 Sequence

Better:

```text
authenticate
check metadata/size
stream to staging storage
scan/validate
then create DB record/transaction
```

## 22.6 Rule

Do not let slow request bodies hold scarce business resources.

---

# 23. Streaming Upload ke Storage

## 23.1 Example skeleton

```java
@POST
@Path("/documents/{documentId}/content")
@Consumes(MediaType.APPLICATION_OCTET_STREAM)
public Response upload(
    @PathParam("documentId") DocumentId documentId,
    @HeaderParam("Content-Type") String contentType,
    @HeaderParam("Content-Length") long contentLength,
    InputStream input
) {
    UploadResult result = documentService.storeContent(
        documentId,
        new ContentMetadata(contentType, contentLength),
        input
    );

    return Response.noContent()
        .tag(new EntityTag(result.version()))
        .build();
}
```

## 23.2 Service design

Service may accept stream at application boundary, but do not pass raw JAX-RS context.

InputStream itself is not HTTP-specific, but lifecycle is request-bound.

## 23.3 Transaction boundary

Do not keep DB transaction open for entire upload unless unavoidable.

## 23.4 Staging

Upload to staging location first.

Then validate/scan.

Then commit metadata.

## 23.5 Cleanup

On failure, delete partial object/temp file.

## 23.6 Checksum

Use:

```http
Digest
Content-MD5
custom checksum header
```

or app-level checksum metadata.

## 23.7 Rule

Streaming upload needs staging, cleanup, and failure model.

---

# 24. Request Body Logging: Hampir Selalu Jangan

## 24.1 Why dangerous?

Body can contain:

- PII;
- credentials;
- tokens;
- documents;
- medical/legal data;
- financial data;
- secrets;
- huge content.

## 24.2 Logging consumes stream

Reading body in filter can break entity binding.

## 24.3 Safer alternatives

Log:

- content type;
- content length;
- route;
- status;
- error code;
- hash of body if needed;
- schema validation summary;
- correlation ID.

## 24.4 Redacted body logging

If absolutely required:

- only in lower env;
- max bytes;
- explicit allowlist endpoint;
- redact fields;
- disabled by default;
- never for file uploads.

## 24.5 Compliance

Many systems prohibit body logs.

## 24.6 Rule

Request body is data, not telemetry.

---

# 25. Idempotency dan Body Hash

For retried unsafe operations, body matters.

## 25.1 Idempotency key

```http
Idempotency-Key: abc-123
```

## 25.2 Request fingerprint

Store hash of canonical request body.

If same key but different body:

```text
409 Conflict
```

or specific idempotency error.

## 25.3 Hashing raw body

Requires reading body.

For JSON DTO, you can canonicalize command instead.

## 25.4 Strategy

- for small JSON: hash buffered body or canonical DTO;
- for large upload: hash streaming while writing to storage;
- for multipart: hash each part or manifest.

## 25.5 Do not log body

Hash is safer but still consider if it can be used for correlation.

## 25.6 Rule

Idempotency should bind key to operation + principal + request payload identity.

---

# 26. Form URL Encoded dan `@FormParam`

`@FormParam` binds form parameters from request entity body.

## 26.1 Content type

```http
Content-Type: application/x-www-form-urlencoded
```

## 26.2 Example

```java
@POST
@Consumes(MediaType.APPLICATION_FORM_URLENCODED)
public Response submit(
    @FormParam("name") String name,
    @FormParam("email") String email
) {
    ...
}
```

## 26.3 Entity body

Form params come from body, unlike query params.

## 26.4 Browser forms

Useful for HTML form integration.

## 26.5 JSON API

For API-first services, JSON DTO is often clearer.

## 26.6 Mixing with entity parameter

Do not mix raw entity body parameter with `@FormParam` unless runtime specifically supports and you understand behavior.

## 26.7 Validation

Use validation on params or bean param.

## 26.8 Security

Form endpoints need CSRF protection if browser/cookie-authenticated.

---

# 27. Multipart Form Data dan `EntityPart`

Jakarta REST 3.1 introduced standard multipart support with `EntityPart`.

## 27.1 Content type

```http
Content-Type: multipart/form-data; boundary=...
```

## 27.2 Receive all parts

```java
@POST
@Consumes(MediaType.MULTIPART_FORM_DATA)
public Response upload(List<EntityPart> parts) {
    ...
}
```

## 27.3 Receive named part

```java
@POST
@Consumes(MediaType.MULTIPART_FORM_DATA)
public Response upload(
    @FormParam("metadata") String metadata,
    @FormParam("file") EntityPart file
) {
    ...
}
```

## 27.4 EntityPart contents

An `EntityPart` represents one part of multipart entity.

It can expose:

- name;
- filename;
- media type;
- headers;
- content stream;
- conversion to type using `MessageBodyReader`.

## 27.5 Use cases

- file upload with metadata;
- multiple files;
- form + binary;
- document ingestion.

## 27.6 Portability caution

Although `EntityPart` is standardized, runtime support/configuration/limits can still differ.

## 27.7 Rule

For multipart, test on target runtime and through gateway.

---

# 28. `List<EntityPart>` vs `@FormParam EntityPart`

## 28.1 `List<EntityPart>`

Use when:

- dynamic part names;
- multiple files;
- need iterate all parts;
- part count validation.

```java
public Response upload(List<EntityPart> parts)
```

## 28.2 `@FormParam EntityPart`

Use when expected named part is fixed:

```java
@FormParam("file") EntityPart file
```

## 28.3 `@FormParam InputStream`

Spec supports form part as:

```java
@FormParam("file") InputStream file
```

for multipart.

## 28.4 `@FormParam String`

Useful for text part.

## 28.5 Missing part

Define error:

```text
400 missing required part
```

## 28.6 Multiple parts with same name

Define behavior:

- allow list;
- reject duplicates;
- use first.

## 28.7 Recommendation

For strict upload API, use named parts and validate duplicates/required parts.

---

# 29. `EntityPart#getContent()` dan One-Time Content Read

`EntityPart` can convert content stream to a specified type.

## 29.1 Conversion

```java
MyMetadata metadata = part.getContent(MyMetadata.class);
```

Runtime finds `MessageBodyReader` for part media type.

## 29.2 One-time read

The implementation is required to close the content stream when `getContent` is invoked, so it may only be invoked once.

## 29.3 Consequence

Do not call:

```java
part.getContent(String.class);
part.getContent(InputStream.class);
```

on same part.

## 29.4 Store first if needed

If small and safe, read once into variable.

If large, stream once to storage.

## 29.5 Content stream responsibility

EntityPart builder docs indicate implementation code is responsible for closing content stream when appropriate.

## 29.6 Rule

Treat each part content like a request entity stream: one-time, untrusted, size-limited.

---

# 30. Multipart Security: Filename, Content-Type, Size, Malware Scan

## 30.1 Filename is untrusted

Client-provided filename can contain:

```text
../../evil
C:\path\file
unicode tricks
long names
```

Do not use directly as storage path.

## 30.2 Content-Type is untrusted

Client may claim:

```text
image/png
```

but send executable.

Validate content if security-sensitive.

## 30.3 Size limits

Need:

- total request size;
- per-part size;
- number of parts;
- filename length;
- metadata size.

## 30.4 Malware scan

For user-uploaded files, scan before making available.

## 30.5 Staging

Store in quarantine/staging first.

## 30.6 Extension policy

Do not trust extension alone.

## 30.7 Audit

Log file metadata safely, not content.

## 30.8 Rule

Multipart upload is security-sensitive ingestion pipeline.

---

# 31. XML Request Body dan Jakarta REST 4.0 JAXB Removal

Jakarta REST 4.0 removed JAXB dependency.

## 31.1 Implication

Do not assume JAXB/XML binding available by default.

If your endpoint consumes XML:

```java
@Consumes(MediaType.APPLICATION_XML)
```

you need runtime/provider support.

## 31.2 Add explicit dependency/provider

For standalone or EE11 environments, verify:

- Jakarta XML Binding API;
- implementation;
- JAX-RS XML provider.

## 31.3 Security

XML has additional risks:

- XXE;
- entity expansion;
- SSRF;
- large tree memory;
- schema validation abuse.

## 31.4 Use streaming parser for large XML

Do not build full DOM for huge XML.

## 31.5 Error mapping

Malformed XML should map to 400.

Unsupported XML media/provider to 415.

## 31.6 Recommendation

Prefer JSON for new APIs unless XML interoperability required.

---

# 32. Custom `MessageBodyReader`

Use custom reader when standard providers are insufficient.

## 32.1 Example use cases

- custom media type;
- CSV import;
- line-delimited JSON;
- encrypted body;
- signed payload envelope;
- custom binary protocol;
- strict JSON parser config;
- legacy text format.

## 32.2 Interface

```java
@Provider
@Consumes("text/csv")
public class CustomerCsvReader implements MessageBodyReader<List<CustomerImportRow>> {
    ...
}
```

## 32.3 Methods

```java
boolean isReadable(...)
T readFrom(...)
```

## 32.4 Registration

Provider must be:

- annotated with `@Provider` and discovered; or
- registered in `Application`.

## 32.5 Reader should be focused

Reader maps bytes to Java representation.

Business validation belongs elsewhere.

## 32.6 Rule

Write custom reader for representation format parsing, not for business workflow.

---

# 33. `MessageBodyReader#isReadable`

Method:

```java
boolean isReadable(
    Class<?> type,
    Type genericType,
    Annotation[] annotations,
    MediaType mediaType
)
```

## 33.1 Purpose

Tell runtime whether reader can produce requested Java type from media type.

## 33.2 Example

```java
@Override
public boolean isReadable(
    Class<?> type,
    Type genericType,
    Annotation[] annotations,
    MediaType mediaType
) {
    return type.equals(CustomerImport.class)
        && mediaType.isCompatible(MediaType.valueOf("text/csv"));
}
```

## 33.3 Be precise

If too broad, your reader may hijack requests.

Bad:

```java
return true;
```

## 33.4 Generic type

Use `genericType` for lists/maps.

## 33.5 Annotations

Can inspect annotations on entity parameter.

## 33.6 Rule

`isReadable` is routing for body provider. Make it narrow and deterministic.

---

# 34. `MessageBodyReader#readFrom`

Method:

```java
T readFrom(
    Class<T> type,
    Type genericType,
    Annotation[] annotations,
    MediaType mediaType,
    MultivaluedMap<String, String> httpHeaders,
    InputStream entityStream
) throws IOException, WebApplicationException;
```

## 34.1 Responsibilities

- read entity stream;
- parse representation;
- return Java object;
- throw appropriate exception on failure.

## 34.2 Do not close?

Runtime owns stream lifecycle generally, but reader consumes it. Be careful with wrapping/closing.

## 34.3 Error handling

For invalid syntax, throw `BadRequestException` or `WebApplicationException` with 400, depending design.

## 34.4 Size limits

Reader can enforce format-specific limits.

Example:

- max rows in CSV;
- max JSON depth;
- max line length.

## 34.5 Security

Do not log raw body.

## 34.6 Performance

Use streaming parser for large formats.

## 34.7 Rule

`readFrom` is the parser boundary. Keep business logic out.

---

# 35. `@Provider`, `@Consumes`, `@Priority` untuk Reader

## 35.1 Provider

```java
@Provider
```

Marks reader discoverable.

## 35.2 Consumes

```java
@Consumes("text/csv")
```

Restricts media type.

## 35.3 Priority

```java
@Priority(Priorities.ENTITY_CODER)
```

or custom priority.

Used when multiple readers match.

## 35.4 Be careful overriding JSON reader

Do not accidentally register broad reader for `Object.class` and `application/json`.

## 35.5 Test provider priority

If multiple providers can read same type/media, integration test actual selection.

## 35.6 Rule

Custom readers should have narrow type + narrow media + deliberate priority.

---

# 36. Reader vs ReaderInterceptor

## 36.1 MessageBodyReader

Parses stream into Java object.

## 36.2 ReaderInterceptor

Wraps around reading process.

Use for cross-cutting entity stream behavior:

- compression/decompression;
- encryption/decryption;
- logging metadata;
- checksum;
- metrics;
- envelope handling.

## 36.3 Do not parse business object in interceptor

Interceptor should not replace application parser unless designed as infrastructure.

## 36.4 Stream caution

Interceptor can consume stream.

If it reads, it must provide replacement stream or pass properly.

## 36.5 Example use

Compute body hash while passing stream through.

## 36.6 Rule

Reader handles format. Interceptor handles cross-cutting stream concern.

---

# 37. Reader Error Handling dan `BadRequestException`

## 37.1 Malformed body

Example JSON:

```json
{"name":
```

Should be 400.

## 37.2 Unsupported media

No compatible reader:

```text
415
```

## 37.3 Reader found but parsing fails

Usually:

```text
400
```

## 37.4 Custom reader

Throw:

```java
throw new BadRequestException("Invalid CSV format");
```

or custom exception mapped to problem details.

## 37.5 Avoid leaking parser internals

Do not return:

```text
com.fasterxml.jackson.databind.exc...
```

to client.

## 37.6 Problem details

```json
{
  "code": "MALFORMED_REQUEST_BODY",
  "status": 400,
  "detail": "Request body is not valid JSON."
}
```

## 37.7 Rule

Reader errors should become stable client-facing parse errors.

---

# 38. Generic Entity Types dan Type Erasure

## 38.1 Entity parameter with generic type

```java
public Response importCustomers(List<CustomerImportRow> rows)
```

Runtime receives:

- raw type: `List.class`;
- generic type: `List<CustomerImportRow>`.

## 38.2 Reader must use genericType

Custom reader can inspect genericType.

## 38.3 JSON provider handles generics

JSON providers generally use genericType to deserialize list element type.

## 38.4 Avoid raw collections

Bad:

```java
List rows
```

Type erased, unsafe.

## 38.5 Use wrapper DTO

Often better:

```java
public record ImportCustomersRequest(
    List<CustomerImportRow> rows
) {}
```

## 38.6 Benefits of wrapper

- easier validation;
- future fields;
- clearer schema;
- better error messages.

## 38.7 Rule

Prefer request DTO wrapper over bare generic collection for public API.

---

# 39. Entity Body dan Transactions

## 39.1 Do not open transaction too early

Body reading/deserialization happens before method body, but service transaction may start after method call.

If resource/service annotation starts transaction on resource method, transaction may include method body only.

## 39.2 Large stream

If resource method receives `InputStream` and service starts transaction before reading entire stream, transaction may stay open for upload duration.

Bad.

## 39.3 Better flow

```text
read/stream to staging
validate/scan
start transaction
write metadata/state
commit
```

## 39.4 JSON DTO

For normal small JSON, transaction around service method is fine.

## 39.5 Custom reader and transaction

Reader should not depend on transaction.

## 39.6 Rule

Large body IO and database transaction should be separated deliberately.

---

# 40. Entity Body dan Security

## 40.1 Authenticate before reading huge body

Ideally reject unauthenticated requests before consuming massive payload.

Gateway/security filter should run early.

## 40.2 Authorization before storing

Check user may upload to target resource before streaming data.

## 40.3 But body may be needed for auth?

Webhook signature may require raw body.

Design carefully:

- read bounded body;
- verify signature;
- then parse.

## 40.4 Content-Type allowlist

Reject unsupported media early.

## 40.5 Body schema validation

Reject unexpected fields/types.

## 40.6 File upload security

See multipart section.

## 40.7 Rule

Request body is untrusted, potentially hostile input.

---

# 41. Entity Body dan Multi-Tenancy

## 41.1 Tenant in path/security context

```text
/tenants/{tenantId}/documents
```

or JWT claim.

## 41.2 Body tenant field

Client may send:

```json
{"tenantId": "T2"}
```

Do not trust if authenticated context says `T1`.

## 41.3 Recommended

Do not accept tenant ID in body for tenant-scoped endpoints unless admin.

Use security/path context.

## 41.4 Cross-check

If body includes tenant for admin bulk import, validate against allowed tenant.

## 41.5 Storage path

Never derive storage partition solely from body tenant.

Use authorized tenant.

## 41.6 Rule

Tenant authority comes from authenticated context/policy, not arbitrary body field.

---

# 42. Entity Body dan Observability

## 42.1 Metrics

Track:

- content type;
- body size bucket;
- parse error count;
- validation error count;
- upload duration;
- upload bytes;
- reader type maybe;
- status.

## 42.2 Avoid labels

Do not label by:

- filename;
- customer ID;
- raw body field values;
- query content.

## 42.3 Logs

Log:

- route;
- content length;
- content type;
- request ID;
- validation error code;
- safe part metadata.

## 42.4 Tracing

Span events:

```text
request_body_deserialized
request_body_validation_failed
upload_stream_started
upload_stream_completed
```

No raw body.

## 42.5 Error body

Include correlation ID.

## 42.6 Rule

Observe body processing without recording sensitive body.

---

# 43. Testing Request Entity Binding

## 43.1 JSON happy path

```http
POST /customers
Content-Type: application/json
```

Assert 201.

## 43.2 Malformed JSON

```json
{"name":
```

Assert 400 problem details.

## 43.3 Wrong Content-Type

```http
Content-Type: text/plain
```

Assert 415.

## 43.4 Missing Content-Type

Define and test policy.

## 43.5 Unknown field

Test reject/ignore policy.

## 43.6 Missing/null fields

Assert validation response.

## 43.7 Large payload

Test max size enforcement.

## 43.8 InputStream

Test streaming path without loading entire body.

## 43.9 Multipart

Test:

- missing part;
- duplicate part;
- invalid file type;
- too large part;
- filename traversal;
- content scan failure.

## 43.10 Custom reader

Test provider selection and parse errors.

## 43.11 Runtime test

Do not only call Java method. Use actual HTTP runtime to test `MessageBodyReader`.

---

# 44. Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus

## 44.1 JSON provider defaults

Runtime may use JSON-B, Jackson, or configured provider.

Behavior differs:

- records;
- unknown fields;
- null handling;
- date format;
- enum casing;
- polymorphism.

## 44.2 Multipart support

`EntityPart` is standardized in Jakarta REST 3.1+, but runtime configuration/limits can differ.

## 44.3 Size limits

Payload limits often configured at server/gateway/runtime-specific level.

## 44.4 Provider priority

Provider selection should follow spec, but diagnostics and defaults differ.

## 44.5 Reactive runtimes

Quarkus RESTEasy Reactive may have different behavior for blocking streams vs reactive body handling.

## 44.6 Test target runtime

Always run contract tests on production runtime.

## 44.7 Rule

Request body behavior is provider/runtime-sensitive. Test, don't assume.

---

# 45. Common Failure Modes

## 45.1 415 due wrong Content-Type

Client sends JSON as text/plain.

## 45.2 400 due malformed body

Parser error not mapped consistently.

## 45.3 DTO exposes internal fields

Mass assignment.

## 45.4 Unknown fields ignored silently

Client typo hidden.

## 45.5 PATCH loses missing vs null distinction

Wrong partial update semantics.

## 45.6 Filter consumes entity stream

Resource receives empty body.

## 45.7 Logging body leaks PII

Compliance incident.

## 45.8 Large body buffered into memory

OutOfMemory/GC pressure.

## 45.9 Multipart filename traversal

Unsafe storage path.

## 45.10 Content-Type trusted as file type

Malicious upload.

## 45.11 DB transaction held during upload

Lock/resource exhaustion.

## 45.12 Missing XML provider after Jakarta REST 4.0

XML endpoint fails after migration.

## 45.13 Custom reader too broad

Hijacks other endpoints.

## 45.14 Generic collection raw type

Deserialization issue.

---

# 46. Best Practices

## 46.1 Use DTOs for JSON request bodies

Separate API contract from entity/domain.

## 46.2 Be explicit with `@Consumes`

Do not accept arbitrary media.

## 46.3 Validate DTOs

Use `@Valid` and domain validation.

## 46.4 Define unknown/null/missing policy

Test it.

## 46.5 Use InputStream for large binary

But enforce limits and stream safely.

## 46.6 Avoid body logging

Log metadata only.

## 46.7 Use multipart `EntityPart` carefully

Validate parts and file metadata.

## 46.8 Use custom reader narrowly

Type/media specific.

## 46.9 Keep business logic out of readers

Readers parse representation.

## 46.10 Test with actual runtime

Provider behavior matters.

---

# 47. Anti-Patterns

## 47.1 Binding request body directly to JPA entity

Mass assignment/security issue.

## 47.2 `InputStream.readAllBytes()` on unbounded upload

Memory DoS.

## 47.3 Body logging filter

Consumes stream and leaks data.

## 47.4 Custom reader returns true for everything

Provider hijack.

## 47.5 Business validation in MessageBodyReader

Wrong layer.

## 47.6 Trusting multipart filename

Path traversal.

## 47.7 Trusting Content-Type for security

File spoofing.

## 47.8 PATCH with simple nullable DTO

Missing/null ambiguity.

## 47.9 XML endpoint assuming JAXB exists in Jakarta REST 4.0

Migration failure.

## 47.10 No malformed body tests

Default error leaks or inconsistent response.

---

# 48. Production Checklist

## 48.1 Contract

- [ ] `@Consumes` explicit.
- [ ] DTO separate from entity/domain.
- [ ] Unknown field policy defined.
- [ ] Missing/null/empty policy defined.
- [ ] Validation annotations and mappers configured.
- [ ] Error format stable.

## 48.2 Security

- [ ] Payload size limit.
- [ ] Content-Type allowlist.
- [ ] Body not logged.
- [ ] Multipart filenames sanitized.
- [ ] File content validated/scanned.
- [ ] Tenant/body cross-check.
- [ ] Webhook signature body handling bounded.

## 48.3 Streaming

- [ ] Large body uses streaming.
- [ ] No unbounded buffering.
- [ ] Timeout/backpressure considered.
- [ ] Partial upload cleanup.
- [ ] DB transaction not held during upload.

## 48.4 Providers

- [ ] Required JSON/XML/custom readers registered.
- [ ] Custom readers narrow.
- [ ] Provider priority tested.
- [ ] Runtime defaults documented.
- [ ] Jakarta REST 4.0 JAXB removal handled.

## 48.5 Multipart

- [ ] Required parts validated.
- [ ] Duplicate part policy.
- [ ] Per-part and total limits.
- [ ] `EntityPart` one-time read respected.
- [ ] Runtime/gateway tested.

## 48.6 Observability

- [ ] Body size bucket metric.
- [ ] Parse error metric.
- [ ] Validation error metric.
- [ ] Upload duration/bytes metric.
- [ ] No raw body values in labels/logs.

---

# 49. Latihan

## Latihan 1 — JSON DTO Contract

Buat endpoint:

```http
POST /customers
Content-Type: application/json
```

DTO:

```java
CreateCustomerRequest
```

Test:

- valid;
- malformed JSON;
- missing field;
- null field;
- unknown field;
- wrong Content-Type.

## Latihan 2 — DTO vs Entity Refactor

Ambil endpoint yang menerima entity langsung.

Refactor ke:

```text
RequestDTO → Command → Service → Domain
```

Tambahkan test mass assignment.

## Latihan 3 — InputStream Upload

Buat:

```http
PUT /documents/{id}/content
Content-Type: application/octet-stream
```

Stream to temp file/storage with max 10MB.

Test oversized body.

## Latihan 4 — Body Logging Trap

Buat filter yang membaca body lalu endpoint DTO.

Amati endpoint gagal/kosong.

Perbaiki dengan buffering terbatas atau hilangkan body logging.

## Latihan 5 — Multipart Upload

Buat endpoint:

```text
POST /documents
multipart/form-data
parts:
  metadata: application/json
  file: application/pdf
```

Gunakan `EntityPart`.

Validate required parts, filename, media type, size.

## Latihan 6 — Custom CSV Reader

Buat `MessageBodyReader<CustomerImportRequest>` untuk:

```text
text/csv
```

Pastikan `isReadable` narrow.

Test malformed CSV.

## Latihan 7 — PATCH Presence Semantics

Implement merge patch endpoint.

Pastikan bisa membedakan:

- missing field;
- null field;
- value field.

## Latihan 8 — XML Migration Test

Buat endpoint XML.

Pastikan provider/dependency tersedia di Jakarta REST 4.0 runtime.

Test XXE disabled.

## Latihan 9 — Idempotency Body Hash

Implement `POST /payments` dengan `Idempotency-Key`.

Store request hash.

Reject same key different body.

---

# 50. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

2. Jakarta RESTful Web Services 4.0 — `MessageBodyReader` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/messagebodyreader

3. Jakarta RESTful Web Services 4.0 — `EntityPart` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/entitypart

4. Jakarta RESTful Web Services 4.0 — `EntityPart.Builder` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/entitypart.builder

5. Jakarta RESTful Web Services 4.0 — `Consumes` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/consumes

6. Jakarta RESTful Web Services 4.0 — `FormParam` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/formparam

7. Jakarta EE Tutorial — Building RESTful Web Services with Jakarta REST  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/websvcs/rest/rest.html

8. RFC 7578 — Returning Values from Forms: multipart/form-data  
   https://www.rfc-editor.org/rfc/rfc7578

9. RFC 9110 — HTTP Semantics  
   https://www.rfc-editor.org/rfc/rfc9110.html

10. RFC 7386 — JSON Merge Patch  
    https://www.rfc-editor.org/rfc/rfc7386

11. RFC 6902 — JSON Patch  
    https://www.rfc-editor.org/rfc/rfc6902

---

# 51. Penutup

Request entity binding adalah tempat HTTP body berubah menjadi Java object.

Mental model utama:

```text
HTTP entity stream
  + Content-Type
  + target Java type
  + registered MessageBodyReader
  =
entity parameter
```

Untuk JSON API biasa, pola terbaik:

```text
JSON body
  ↓
Request DTO
  ↓
Validation
  ↓
Mapper
  ↓
Application command
  ↓
Service/domain
```

Untuk large body/file upload, pola terbaik berubah:

```text
authenticate/authorize
  ↓
check metadata/limits
  ↓
stream to staging
  ↓
scan/validate/checksum
  ↓
commit metadata/state
  ↓
return resource/job location
```

Top-tier JAX-RS engineer tidak hanya menambahkan DTO parameter. Ia memahami:

- stream sekali baca;
- provider selection;
- media type contract;
- payload limits;
- logging risk;
- validation/error taxonomy;
- multipart security;
- runtime differences;
- transaction boundary;
- observability without leaking content.

Prinsip final:

```text
Small structured body → DTO + validation.
Large/raw body → stream + limits + staging.
Custom format → narrow MessageBodyReader.
Never let untrusted body leak directly into entity/domain/storage without validation and policy.
```

Part berikutnya:

```text
Bagian 010 — Response Entity Writing: Response, GenericEntity, StreamingOutput, Headers, Cookies, Links
```

Kita akan membahas sisi sebaliknya: bagaimana Java return value menjadi HTTP response entity, bagaimana `MessageBodyWriter` dipilih, kapan return DTO vs `Response`, bagaimana streaming response, headers/cookies/link, and production response contract design.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-jaxrs-advanced-part-008.md">⬅️ Bagian 008 — Context Injection: `@Context`, `UriInfo`, `HttpHeaders`, `Request`, `SecurityContext`, `Providers`, `ResourceContext`, dan Runtime Metadata Boundary</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-jaxrs-advanced-part-010.md">Bagian 010 — Response Entity Writing: `Response`, `GenericEntity`, `StreamingOutput`, Headers, Cookies, Links, Cache, dan `MessageBodyWriter` ➡️</a>
</div>
