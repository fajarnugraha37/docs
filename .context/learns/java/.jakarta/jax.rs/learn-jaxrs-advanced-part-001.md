# learn-jaxrs-advanced-part-001.md

# Bagian 001 — HTTP Semantics yang Wajib Dikuasai Sebelum JAX-RS

> Target pembaca: Java/Jakarta engineer yang ingin menjadi sangat kuat di JAX-RS/Jakarta REST. Part ini membahas fondasi yang sering dilewati: **HTTP semantics**. Banyak bug JAX-RS sebenarnya bukan bug annotation, provider, atau runtime, melainkan salah memahami method semantics, status code, content negotiation, cache, conditional request, idempotency, dan error contract.
>
> Fokus: RFC 9110 HTTP Semantics, RFC 9111 HTTP Caching, RFC 5789 PATCH, RFC 9457 Problem Details, safe/idempotent/cacheable methods, status code taxonomy, conditional requests, caching headers, content negotiation, idempotency-key, long-running operation semantics, and how these map to JAX-RS design.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: HTTP adalah Application Protocol, Bukan Sekadar Transport](#2-mental-model-http-adalah-application-protocol-bukan-sekadar-transport)
3. [Resource, Representation, State, dan Transfer](#3-resource-representation-state-dan-transfer)
4. [Request Semantics: Method + Target URI + Headers + Body](#4-request-semantics-method--target-uri--headers--body)
5. [Response Semantics: Status Code + Headers + Body](#5-response-semantics-status-code--headers--body)
6. [Safe, Idempotent, Cacheable: Tiga Konsep yang Sering Tertukar](#6-safe-idempotent-cacheable-tiga-konsep-yang-sering-tertukar)
7. [`GET`: Retrieve Representation, Jangan Ubah State](#7-get-retrieve-representation-jangan-ubah-state)
8. [`HEAD`: Metadata Tanpa Body](#8-head-metadata-tanpa-body)
9. [`OPTIONS`: Capability Discovery dan CORS Preflight](#9-options-capability-discovery-dan-cors-preflight)
10. [`POST`: Process Representation / Create Subordinate Resource / Command](#10-post-process-representation--create-subordinate-resource--command)
11. [`PUT`: Replace Resource State](#11-put-replace-resource-state)
12. [`PATCH`: Partial Modification](#12-patch-partial-modification)
13. [`DELETE`: Remove Association / Delete Resource](#13-delete-remove-association--delete-resource)
14. [Method Semantics Summary Table](#14-method-semantics-summary-table)
15. [Status Code Families](#15-status-code-families)
16. [2xx Success: `200`, `201`, `202`, `204`, `206`](#16-2xx-success-200-201-202-204-206)
17. [3xx Redirection dan Cache Revalidation: `301`, `302`, `303`, `304`, `307`, `308`](#17-3xx-redirection-dan-cache-revalidation-301-302-303-304-307-308)
18. [4xx Client Error: `400`, `401`, `403`, `404`, `405`, `409`, `412`, `415`, `422`, `429`](#18-4xx-client-error-400-401-403-404-405-409-412-415-422-429)
19. [5xx Server Error: `500`, `502`, `503`, `504`](#19-5xx-server-error-500-502-503-504)
20. [`400` vs `422`: Syntax Error vs Semantic Validation](#20-400-vs-422-syntax-error-vs-semantic-validation)
21. [`401` vs `403`: Authentication vs Authorization](#21-401-vs-403-authentication-vs-authorization)
22. [`404` vs `403`: Information Disclosure Trade-Off](#22-404-vs-403-information-disclosure-trade-off)
23. [`409` vs `412`: Conflict vs Failed Precondition](#23-409-vs-412-conflict-vs-failed-precondition)
24. [`405` vs `404`: Method Tidak Didukung vs Resource Tidak Ada](#24-405-vs-404-method-tidak-didukung-vs-resource-tidak-ada)
25. [`415` vs `406`: Request Content-Type vs Accept Negotiation](#25-415-vs-406-request-content-type-vs-accept-negotiation)
26. [`429` vs `503`: Rate Limit vs Temporary Unavailability](#26-429-vs-503-rate-limit-vs-temporary-unavailability)
27. [Headers as Semantics: Bukan Dekorasi](#27-headers-as-semantics-bukan-dekorasi)
28. [Media Type, `Content-Type`, `Accept`, dan Representation Format](#28-media-type-content-type-accept-dan-representation-format)
29. [Content Negotiation: `Accept`, `Accept-Language`, `Accept-Encoding`, `Vary`](#29-content-negotiation-accept-accept-language-accept-encoding-vary)
30. [Caching: `Cache-Control`, `ETag`, `Last-Modified`, `Expires`, `Vary`](#30-caching-cache-control-etag-last-modified-expires-vary)
31. [Conditional Requests: `If-Match`, `If-None-Match`, `If-Modified-Since`, `If-Unmodified-Since`](#31-conditional-requests-if-match-if-none-match-if-modified-since-if-unmodified-since)
32. [Optimistic Concurrency dengan ETag](#32-optimistic-concurrency-dengan-etag)
33. [Idempotency-Key untuk `POST`/Command yang Bisa Diulang](#33-idempotency-key-untuk-postcommand-yang-bisa-diulang)
34. [Long-Running Operations: `202 Accepted`, Job Resource, Polling/SSE](#34-long-running-operations-202-accepted-job-resource-pollingsse)
35. [Problem Details dan Error Contract](#35-problem-details-dan-error-contract)
36. [How HTTP Semantics Maps to JAX-RS](#36-how-http-semantics-maps-to-jax-rs)
37. [JAX-RS Code Patterns untuk HTTP Semantics](#37-jax-rs-code-patterns-untuk-http-semantics)
38. [Common Failure Modes](#38-common-failure-modes)
39. [Best Practices](#39-best-practices)
40. [Anti-Patterns](#40-anti-patterns)
41. [Production Checklist](#41-production-checklist)
42. [Latihan](#42-latihan)
43. [Referensi Resmi](#43-referensi-resmi)
44. [Penutup](#44-penutup)

---

# 1. Tujuan Part Ini

Sebelum mendalami JAX-RS annotation, provider, filters, dan client API, kita harus menguasai HTTP semantics.

Kenapa?

Karena JAX-RS hanyalah API Java untuk mengekspresikan HTTP resource boundary.

Jika HTTP semantics salah, maka JAX-RS code yang “benar secara syntax” tetap menghasilkan API buruk.

## 1.1 Contoh bug yang bukan bug JAX-RS

```java
@GET
@Path("/orders/{id}/cancel")
public Response cancel(@PathParam("id") String id) {
    orderService.cancel(id);
    return Response.ok().build();
}
```

Secara JAX-RS, ini bisa berjalan.

Secara HTTP semantics, ini buruk:

- `GET` harus safe.
- Cancel mengubah state.
- Browser/proxy/prefetcher bisa memanggil `GET`.
- Crawler bisa men-trigger side effect.
- Cache bisa salah memahami behavior.

Lebih tepat:

```http
POST /orders/{id}/cancellation
```

atau:

```http
POST /orders/{id}/actions/cancel
```

tergantung API style.

## 1.2 Tujuan utama

Setelah part ini, kamu harus bisa:

- memilih HTTP method berdasarkan semantics, bukan kebiasaan;
- memilih status code secara konsisten;
- membedakan `400`, `401`, `403`, `404`, `409`, `412`, `415`, `422`, `429`;
- mendesain idempotent write;
- menggunakan `ETag` untuk optimistic concurrency;
- mendesain `202 Accepted` untuk long-running operation;
- memahami cache dan conditional requests;
- memetakan HTTP semantics ke JAX-RS API.

## 1.3 Prinsip utama

```text
JAX-RS is only as correct as your HTTP semantics.
```

---

# 2. Mental Model: HTTP adalah Application Protocol, Bukan Sekadar Transport

HTTP bukan hanya “cara kirim JSON”.

HTTP adalah application-level protocol yang membawa semantics.

Request HTTP membawa intent:

```text
method + target URI + headers + representation
```

Response HTTP membawa outcome:

```text
status code + headers + representation
```

## 2.1 Request bukan hanya URL

Request:

```http
PUT /customers/C001
Content-Type: application/json
If-Match: "v3"

{
  "name": "Fajar"
}
```

Semantics-nya:

```text
Replace representation/state of resource /customers/C001
with given representation,
but only if current ETag matches "v3".
```

## 2.2 Response bukan hanya body

Response:

```http
412 Precondition Failed
Content-Type: application/problem+json
ETag: "v4"

{
  "type": "https://example.com/problems/stale-resource",
  "title": "Resource has changed",
  "status": 412
}
```

Semantics-nya:

```text
Write rejected because client's precondition was false.
Client should refetch latest representation.
```

## 2.3 Headers are semantics

Headers seperti:

- `Content-Type`;
- `Accept`;
- `ETag`;
- `If-Match`;
- `Location`;
- `Cache-Control`;
- `Retry-After`;
- `Vary`;
- `Authorization`;

bukan dekorasi.

Mereka mengubah arti request/response.

## 2.4 HTTP is stateless

Setiap request harus membawa cukup informasi untuk dipahami server.

Session/cookie bisa ada, tapi protocol semantics tetap stateless.

## 2.5 JAX-RS mapping

JAX-RS memberi API untuk semantics ini:

- method annotation: `@GET`, `@POST`, dll;
- media: `@Consumes`, `@Produces`;
- headers: `@HeaderParam`, `HttpHeaders`, `Response.header`;
- status: `Response.status`;
- conditional: `Request.evaluatePreconditions`;
- URI: `UriInfo`;
- cache: `CacheControl`, `EntityTag`.

---

# 3. Resource, Representation, State, dan Transfer

REST berbicara tentang resource dan representation.

## 3.1 Resource

Resource adalah sesuatu yang bisa diidentifikasi oleh URI.

Contoh:

```text
/customers/C001
/orders/O100
/applications/A123/status
/reports/jobs/J777
```

Resource bukan selalu row database.

Resource bisa berupa:

- domain entity;
- collection;
- state transition;
- command result;
- job;
- search result;
- projection;
- document;
- relationship.

## 3.2 Representation

Representation adalah bentuk data dari resource pada waktu tertentu.

Contoh JSON representation:

```json
{
  "id": "C001",
  "name": "Fajar",
  "status": "ACTIVE"
}
```

Resource sama bisa punya representation berbeda:

```text
application/json
application/xml
text/csv
application/pdf
```

## 3.3 Resource state vs representation state

Resource state adalah state di server/domain.

Representation state adalah data yang dikirim ke client.

Representation tidak harus sama persis dengan internal entity.

## 3.4 Transfer

HTTP mentransfer representation.

Jadi REST = Representational State Transfer.

## 3.5 Design consequence

Jangan expose JPA entity mentah sebagai representation.

Buat DTO/representation khusus API.

## 3.6 Resource identity

URI harus stabil dan bermakna.

Bad:

```text
/getCustomer?id=C001
```

Better:

```text
/customers/C001
```

Not always absolute rule, but resource-style URI biasanya lebih jelas.

---

# 4. Request Semantics: Method + Target URI + Headers + Body

Request semantics terutama ditentukan oleh method.

RFC 9110 menyatakan salah satu design goal HTTP adalah memisahkan resource identification dari request semantics; request semantics berada di method dan beberapa request-modifying header fields.

## 4.1 Target URI

```http
GET /customers/C001
```

Target URI identifies resource.

## 4.2 Method

```http
GET
POST
PUT
PATCH
DELETE
```

Method defines action semantics.

## 4.3 Headers

Headers modify semantics.

Examples:

```http
Accept: application/json
If-Match: "v1"
Authorization: Bearer ...
Content-Type: application/json
Idempotency-Key: abc-123
```

## 4.4 Body

Body is representation or data for processing.

But body semantics depend on method and content type.

## 4.5 JAX-RS mapping

```java
@POST
@Path("/customers")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public Response create(@Valid CreateCustomerRequest request) { ... }
```

## 4.6 Top-tier question

Before writing resource method, define:

```text
What is the resource?
What does method mean?
What headers affect behavior?
What representation is accepted?
What response status and headers are returned?
```

---

# 5. Response Semantics: Status Code + Headers + Body

Response tells result of request.

## 5.1 Status code

Three-digit code.

Examples:

```text
200 OK
201 Created
202 Accepted
204 No Content
400 Bad Request
404 Not Found
409 Conflict
500 Internal Server Error
```

## 5.2 Headers

Headers carry metadata.

Examples:

```http
Location: /customers/C001
ETag: "v1"
Cache-Control: max-age=60
Retry-After: 120
Content-Type: application/json
```

## 5.3 Body

Body is representation of result, error, resource, or status.

## 5.4 No body cases

Some responses should not have body, e.g.:

- `204 No Content`;
- `304 Not Modified`;
- `HEAD` response body omitted.

## 5.5 Response design examples

Create:

```http
201 Created
Location: /customers/C001
Content-Type: application/json

{
  "id": "C001",
  "name": "Fajar"
}
```

Async accepted:

```http
202 Accepted
Location: /jobs/J001
Retry-After: 5
```

Delete:

```http
204 No Content
```

## 5.6 JAX-RS mapping

```java
return Response
    .created(location)
    .entity(response)
    .tag(new EntityTag(version))
    .build();
```

---

# 6. Safe, Idempotent, Cacheable: Tiga Konsep yang Sering Tertukar

## 6.1 Safe

A method is safe when client does not request state change.

Safe does not mean “no side effect at all”.

Server may log, collect metrics, update analytics.

But client-requested semantics must be read-only.

Safe methods:

- `GET`;
- `HEAD`;
- `OPTIONS`;
- `TRACE`.

In API practice, `TRACE` often disabled for security.

## 6.2 Idempotent

A method is idempotent if multiple identical requests have same intended effect on server as one request.

Idempotent methods include:

- safe methods;
- `PUT`;
- `DELETE`.

Important nuance:

```text
Response status may differ between first and repeated call,
but intended server state effect is same.
```

Example:

```http
DELETE /customers/C001
```

First call:

```http
204 No Content
```

Second call might be:

```http
404 Not Found
```

But resource remains deleted.

## 6.3 Cacheable

Response to method can be stored and reused by cache if cache rules allow.

Commonly cacheable:

- `GET`;
- `HEAD`;
- sometimes `POST` if explicit freshness and content-location semantics, but much less common.

## 6.4 Common confusion

`PUT` is idempotent but not safe.

`POST` is usually neither safe nor idempotent.

`GET` is safe and idempotent and cacheable.

## 6.5 Why it matters

- Browser can prefetch GET.
- Proxies can cache GET.
- Clients can retry idempotent methods more safely.
- Retry `POST` can duplicate orders/payments without idempotency key.
- API gateway may treat safe/idempotent methods differently.

---

# 7. `GET`: Retrieve Representation, Jangan Ubah State

`GET` requests representation of target resource.

## 7.1 Correct use

```http
GET /customers/C001
Accept: application/json
```

## 7.2 JAX-RS

```java
@GET
@Path("/{id}")
@Produces(MediaType.APPLICATION_JSON)
public CustomerResponse get(@PathParam("id") String id) {
    return service.get(id);
}
```

## 7.3 Must be safe

Do not use GET for:

- create;
- update;
- delete;
- cancel;
- submit;
- approve;
- send email;
- trigger job.

## 7.4 Side effects allowed?

Operational side effects:

- access log;
- metrics;
- cache warm;
- analytics.

But not business state change requested by client.

## 7.5 Query params

Good:

```http
GET /customers?status=ACTIVE&page=1&size=20
```

## 7.6 Request body with GET

Avoid.

Even if some libraries allow, semantics and interoperability are problematic.

Use query params or `POST /search` for complex search.

## 7.7 Cache

GET response can be cacheable if headers allow.

## 7.8 Conditional GET

Use `ETag`/`Last-Modified`.

Client:

```http
GET /customers/C001
If-None-Match: "v3"
```

Server:

```http
304 Not Modified
```

## 7.9 Failure modes

- GET changes state.
- GET returns unbounded list.
- GET leaks data due missing authorization.
- GET cache stores private data due bad `Cache-Control`.
- GET endpoint uses raw path metrics causing high cardinality.

---

# 8. `HEAD`: Metadata Tanpa Body

`HEAD` is like GET but response has no body.

## 8.1 Use cases

- check existence;
- check metadata;
- check ETag;
- check content length;
- preflight download metadata.

Example:

```http
HEAD /files/F001
```

Response:

```http
200 OK
Content-Type: application/pdf
Content-Length: 1048576
ETag: "abc"
```

No body.

## 8.2 JAX-RS

JAX-RS can infer HEAD from GET in some cases, or you can define:

```java
@HEAD
@Path("/{id}")
public Response head(@PathParam("id") String id) {
    FileMetadata meta = service.metadata(id);
    return Response.ok()
        .type(meta.contentType())
        .tag(new EntityTag(meta.etag()))
        .header(HttpHeaders.CONTENT_LENGTH, meta.size())
        .build();
}
```

## 8.3 Important

Do not return body.

## 8.4 Production use

Useful for large downloads.

Client can check whether file changed before downloading.

---

# 9. `OPTIONS`: Capability Discovery dan CORS Preflight

`OPTIONS` describes communication options for target resource/server.

## 9.1 Use cases

- allowed methods;
- CORS preflight;
- API capability discovery.

## 9.2 Response example

```http
204 No Content
Allow: GET, POST, OPTIONS
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, POST
Access-Control-Allow-Headers: Authorization, Content-Type
```

## 9.3 CORS preflight

Browser sends:

```http
OPTIONS /api/customers
Origin: https://app.example.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: Authorization, Content-Type
```

Server must answer correctly.

## 9.4 JAX-RS

CORS often implemented as filter.

## 9.5 Common bugs

- missing OPTIONS handling;
- incorrect `Access-Control-Allow-Origin`;
- wildcard with credentials;
- missing `Vary: Origin`;
- returning 401 for preflight when auth filter should allow OPTIONS.

---

# 10. `POST`: Process Representation / Create Subordinate Resource / Command

`POST` asks target resource to process enclosed representation according to resource semantics.

It is flexible.

## 10.1 Create subordinate resource

```http
POST /customers
Content-Type: application/json

{
  "name": "Fajar"
}
```

Response:

```http
201 Created
Location: /customers/C001
```

## 10.2 Command/action

```http
POST /orders/O100/cancellation
```

or:

```http
POST /orders/O100/actions/cancel
```

## 10.3 Search with complex body

```http
POST /customers/search
Content-Type: application/json
```

Good when query too complex for URL.

## 10.4 Long-running operation

```http
POST /reports
```

Response:

```http
202 Accepted
Location: /reports/jobs/J001
```

## 10.5 Not idempotent by default

Repeated POST can create duplicates.

Use idempotency key for retry-safe commands.

## 10.6 JAX-RS create example

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public Response create(@Valid CreateCustomerRequest request, @Context UriInfo uriInfo) {
    Customer created = service.create(request);

    URI location = uriInfo.getAbsolutePathBuilder()
        .path(created.id())
        .build();

    return Response.created(location)
        .entity(mapper.toResponse(created))
        .build();
}
```

## 10.7 Failure modes

- returning `200` for creation without `Location`;
- duplicate creation due retry;
- command endpoint not idempotent;
- no audit for state-changing POST;
- using POST for everything without semantics.

---

# 11. `PUT`: Replace Resource State

`PUT` requests that state of target resource be created or replaced with enclosed representation.

## 11.1 Full replacement

```http
PUT /customers/C001
Content-Type: application/json

{
  "name": "Fajar",
  "email": "fajar@example.com"
}
```

Meaning:

```text
Set resource /customers/C001 to this representation.
```

## 11.2 Idempotent

Sending same PUT repeatedly should produce same intended state.

## 11.3 Create or replace?

PUT can create resource at client-chosen URI if allowed.

But API must define behavior.

## 11.4 Partial update?

Do not use PUT for partial update unless your contract explicitly defines merge semantics, but that violates common expectation.

Use PATCH for partial.

## 11.5 Missing fields

Because PUT is replacement, missing fields may mean remove/default fields.

This is why DTO design matters.

## 11.6 Concurrency

Use `If-Match` with ETag to avoid lost update.

```http
PUT /customers/C001
If-Match: "v3"
```

## 11.7 JAX-RS

```java
@PUT
@Path("/{id}")
@Consumes(MediaType.APPLICATION_JSON)
public Response replace(
    @PathParam("id") String id,
    @HeaderParam("If-Match") String ifMatch,
    @Valid ReplaceCustomerRequest request
) {
    service.replace(id, request, ifMatch);
    return Response.noContent().build();
}
```

## 11.8 Failure modes

- treating PUT as partial update accidentally;
- no ETag causing lost update;
- server-generated ID but using PUT incorrectly;
- non-idempotent side effect inside PUT.

---

# 12. `PATCH`: Partial Modification

PATCH applies partial modification to resource.

RFC 5789 introduced PATCH because PUT only allows complete replacement.

## 12.1 Use cases

```http
PATCH /customers/C001
Content-Type: application/merge-patch+json

{
  "email": "new@example.com"
}
```

## 12.2 Patch document

PATCH body is not necessarily partial resource.

It is a patch document.

Media type defines semantics.

Common:

- `application/json-patch+json`;
- `application/merge-patch+json`.

## 12.3 JSON Merge Patch

`null` often means remove field.

Example:

```json
{
  "middleName": null
}
```

Semantics depends JSON Merge Patch.

## 12.4 JSON Patch

Operation list:

```json
[
  { "op": "replace", "path": "/email", "value": "new@example.com" }
]
```

## 12.5 Idempotency

PATCH is not guaranteed idempotent.

Some patch documents can be idempotent, some not.

Example replace same field is idempotent.

Increment operation would not be, depending patch format/semantics.

## 12.6 Concurrency

Use `If-Match`.

## 12.7 JAX-RS

```java
@PATCH
@Path("/{id}")
@Consumes("application/merge-patch+json")
public Response patch(
    @PathParam("id") String id,
    JsonObject mergePatch,
    @HeaderParam("If-Match") String ifMatch
) {
    service.patch(id, mergePatch, ifMatch);
    return Response.noContent().build();
}
```

## 12.8 Failure modes

- ambiguous null semantics;
- partial validation missing;
- no concurrency protection;
- patch changes forbidden fields;
- audit cannot explain change;
- using PATCH as arbitrary action endpoint.

---

# 13. `DELETE`: Remove Association / Delete Resource

DELETE requests removal of association between target resource and current functionality.

In practice: delete/remove resource.

## 13.1 Example

```http
DELETE /customers/C001
```

## 13.2 Idempotent

Repeated DELETE should leave resource deleted.

Response may differ.

## 13.3 Response

Common:

```http
204 No Content
```

or:

```http
202 Accepted
```

if deletion asynchronous.

## 13.4 Soft delete

DELETE can implement soft delete if API semantics says resource is no longer available.

## 13.5 Authorization

DELETE is dangerous.

Audit required.

## 13.6 Concurrency

Can use `If-Match`:

```http
DELETE /customers/C001
If-Match: "v3"
```

## 13.7 JAX-RS

```java
@DELETE
@Path("/{id}")
public Response delete(@PathParam("id") String id) {
    service.delete(id);
    return Response.noContent().build();
}
```

## 13.8 Failure modes

- hard delete when audit/retention requires soft delete;
- no idempotency;
- no authorization;
- no audit;
- deleting child resources unexpectedly.

---

# 14. Method Semantics Summary Table

| Method | Safe | Idempotent | Common use | Request body? | Common response |
|---|---:|---:|---|---|---|
| `GET` | Yes | Yes | retrieve representation | avoid | `200`, `304`, `404` |
| `HEAD` | Yes | Yes | retrieve metadata | no | `200`, `304`, `404` |
| `OPTIONS` | Yes | Yes | capabilities/CORS | usually no | `204`, `200` |
| `POST` | No | No by default | create subordinate resource, command, process | yes | `200`, `201`, `202`, `204` |
| `PUT` | No | Yes | create/replace target resource | yes | `200`, `201`, `204` |
| `PATCH` | No | not guaranteed | partial modification | yes | `200`, `204` |
| `DELETE` | No | Yes | delete/remove resource | usually no | `202`, `204`, `404` |

## 14.1 Retry implication

Safer to retry:

- GET;
- HEAD;
- OPTIONS;
- PUT;
- DELETE.

Dangerous to retry without idempotency:

- POST;
- PATCH.

## 14.2 Cache implication

Most relevant:

- GET;
- HEAD.

## 14.3 API design implication

Choose method by semantics.

Not by “what is easiest in frontend”.

---

# 15. Status Code Families

IANA maintains official HTTP status code registry.

Status code families:

```text
1xx Informational
2xx Successful
3xx Redirection
4xx Client Error
5xx Server Error
```

## 15.1 1xx

Request received, continuing process.

Examples:

- `100 Continue`;
- `103 Early Hints`.

Rarely handled directly in JAX-RS app code.

## 15.2 2xx

Request successfully received, understood, accepted.

## 15.3 3xx

Further action needed or cached response valid.

## 15.4 4xx

Client-side issue:

- malformed request;
- invalid input;
- unauthorized;
- forbidden;
- not found;
- conflict;
- unsupported media.

## 15.5 5xx

Server-side issue:

- bug;
- dependency failure;
- unavailable service;
- gateway timeout.

## 15.6 Top-tier rule

Status code should help client decide:

```text
retry?
fix request?
authenticate?
ask permission?
refetch?
wait?
contact support?
```

---

# 16. 2xx Success: `200`, `201`, `202`, `204`, `206`

## 16.1 `200 OK`

Generic success with response body.

Use for:

- GET success;
- PUT/PATCH success with representation;
- POST command returning result.

```java
return Response.ok(response).build();
```

## 16.2 `201 Created`

Resource created.

Should include `Location`.

```java
return Response.created(location)
    .entity(response)
    .build();
```

## 16.3 `202 Accepted`

Request accepted for processing but not completed.

Use for async/long-running work.

Should provide status resource.

```http
202 Accepted
Location: /jobs/J001
Retry-After: 5
```

## 16.4 `204 No Content`

Success with no body.

Use for:

- successful delete;
- update with no representation returned;
- command success with no result.

```java
return Response.noContent().build();
```

Do not include body.

## 16.5 `206 Partial Content`

Used with range requests.

Important for large downloads.

JAX-RS may need custom handling for `Range` header.

## 16.6 Common mistakes

- `201` without `Location`;
- `204` with body;
- `202` without way to check progress;
- always `200`.

---

# 17. 3xx Redirection dan Cache Revalidation: `301`, `302`, `303`, `304`, `307`, `308`

## 17.1 `301 Moved Permanently`

Resource permanently moved.

## 17.2 `302 Found`

Temporary redirect historically ambiguous.

## 17.3 `303 See Other`

Useful after POST to direct client to result resource.

Example:

```http
POST /orders
→ 303 See Other
Location: /orders/O100
```

## 17.4 `304 Not Modified`

Used for cache validation.

No response body.

## 17.5 `307 Temporary Redirect`

Temporary redirect preserving method.

## 17.6 `308 Permanent Redirect`

Permanent redirect preserving method.

## 17.7 JAX-RS redirect

```java
return Response.seeOther(uri).build();
```

## 17.8 API usage

REST APIs often use fewer redirects than browsers, but `304` is important for caching.

## 17.9 Common mistakes

- Using `302` when method preservation matters.
- Returning body with `304`.
- Not using `Vary` with content negotiation.

---

# 18. 4xx Client Error: `400`, `401`, `403`, `404`, `405`, `409`, `412`, `415`, `422`, `429`

## 18.1 `400 Bad Request`

Malformed syntax or invalid request framing.

Examples:

- invalid JSON syntax;
- wrong parameter type;
- invalid header format.

## 18.2 `401 Unauthorized`

Actually means unauthenticated or invalid authentication.

Should include `WWW-Authenticate` where appropriate.

## 18.3 `403 Forbidden`

Authenticated/understood but not allowed.

## 18.4 `404 Not Found`

Resource not found or intentionally hidden.

## 18.5 `405 Method Not Allowed`

Resource exists but method not allowed.

Should include `Allow` header.

## 18.6 `409 Conflict`

Request conflicts with current resource/application state.

Examples:

- duplicate unique business key;
- invalid state transition;
- resource conflict.

## 18.7 `412 Precondition Failed`

Conditional request header false.

Example ETag mismatch with `If-Match`.

## 18.8 `415 Unsupported Media Type`

Request `Content-Type` unsupported.

## 18.9 `422 Unprocessable Content`

Request syntax/media valid, but semantic validation fails.

## 18.10 `429 Too Many Requests`

Rate limit.

Usually include `Retry-After`.

## 18.11 Top-tier mapping

Client error should be actionable.

Return machine-readable error code.

---

# 19. 5xx Server Error: `500`, `502`, `503`, `504`

## 19.1 `500 Internal Server Error`

Unexpected server bug.

Do not expose internals.

## 19.2 `502 Bad Gateway`

Server as gateway/proxy got invalid response from upstream.

Common at API gateway/reverse proxy.

## 19.3 `503 Service Unavailable`

Temporary overload/maintenance/dependency unavailable.

Can include `Retry-After`.

## 19.4 `504 Gateway Timeout`

Gateway/proxy timed out waiting for upstream.

## 19.5 App-level mapping

If your JAX-RS service depends on partner API and partner is down, possible mappings:

- `503` if dependency unavailable and your service cannot fulfill.
- `502` if acting as gateway and upstream returned bad response.
- `504` if upstream timed out and you are gateway-like.

## 19.6 Do not use 500 for everything

Classify server failures.

## 19.7 Observability

All 5xx should have:

- correlation ID;
- error category;
- trace;
- alert if SLO impacted.

---

# 20. `400` vs `422`: Syntax Error vs Semantic Validation

## 20.1 `400`

Use when request is malformed.

Examples:

```text
invalid JSON syntax
query param expected integer but got "abc"
missing required header format
invalid Content-Length
```

## 20.2 `422`

Use when request is syntactically valid and media type understood, but semantic validation fails.

Examples:

```text
email format invalid
startDate after endDate
quantity must be positive
business validation on payload fields
```

## 20.3 Debate

Some APIs use `400` for all validation errors.

That is acceptable if consistent.

But `422` gives sharper distinction.

## 20.4 Recommendation

Pick policy and document it.

For enterprise API:

```text
400 = malformed request / parsing / type conversion
422 = validation violation in well-formed request
```

## 20.5 JAX-RS

- JSON parse exception → `400`;
- `ConstraintViolationException` / DTO validation → often `400` or `422` based on your mapper policy.

---

# 21. `401` vs `403`: Authentication vs Authorization

## 21.1 `401 Unauthorized`

Despite name, means authentication needed/failed.

Examples:

- missing token;
- expired token;
- invalid token;
- malformed credentials.

## 21.2 `403 Forbidden`

Authentication succeeded, but user lacks permission.

Examples:

- role missing;
- scope insufficient;
- tenant mismatch;
- data-level policy denies.

## 21.3 Response body

Use same error format.

Example:

```json
{
  "code": "AUTHENTICATION_REQUIRED",
  "message": "Authentication is required",
  "correlationId": "..."
}
```

## 21.4 Security caution

Do not reveal too much.

## 21.5 JAX-RS

Auth may happen in:

- container;
- Jakarta Security;
- request filter;
- gateway.

But final error contract should be consistent.

---

# 22. `404` vs `403`: Information Disclosure Trade-Off

Sometimes returning `404` instead of `403` prevents resource existence leak.

## 22.1 Example

User requests:

```http
GET /accounts/A123
```

If account exists but user cannot access it, `403` reveals existence.

`404` can hide it.

## 22.2 Policy decision

For sensitive resources, use:

```text
404 if user cannot know resource existence
```

For admin/internal APIs, `403` may be more helpful.

## 22.3 Consistency

Document policy.

## 22.4 Audit

Even if returning `404`, audit authorization denial internally.

## 22.5 JAX-RS mapper

Domain exception can carry visibility policy:

```text
NOT_FOUND_VISIBLE
FORBIDDEN
HIDDEN_AS_NOT_FOUND
```

---

# 23. `409` vs `412`: Conflict vs Failed Precondition

## 23.1 `409 Conflict`

Request conflicts with current state or business invariant.

Examples:

- duplicate username;
- order already cancelled;
- cannot approve rejected application;
- resource state incompatible.

## 23.2 `412 Precondition Failed`

Client supplied precondition header and it evaluated false.

Example:

```http
PUT /customers/C001
If-Match: "v3"
```

But current ETag is `"v4"`.

Return:

```http
412 Precondition Failed
```

## 23.3 Rule

If using `If-Match`/`If-Unmodified-Since`, use `412` for stale write.

If conflict is domain/business state, use `409`.

## 23.4 Client behavior

`412` tells client:

```text
Refetch and retry with latest version.
```

`409` tells client:

```text
Resolve conflict/business state.
```

## 23.5 JAX-RS

Use `Request.evaluatePreconditions`.

---

# 24. `405` vs `404`: Method Tidak Didukung vs Resource Tidak Ada

## 24.1 `404 Not Found`

No resource found.

## 24.2 `405 Method Not Allowed`

Resource exists, but method not supported.

Example:

```http
DELETE /customers/C001
```

If customer resource exists but delete not allowed by API:

```http
405 Method Not Allowed
Allow: GET, PUT
```

## 24.3 Security trade-off

Some APIs intentionally hide with `404`.

## 24.4 JAX-RS

Runtime often handles 405 if path matches but method doesn't.

## 24.5 Good API behavior

Return `Allow` header for 405.

---

# 25. `415` vs `406`: Request Content-Type vs Accept Negotiation

## 25.1 `415 Unsupported Media Type`

Client sent body in unsupported format.

Example:

```http
POST /customers
Content-Type: text/plain
Accept: application/json
```

Endpoint consumes JSON only.

Return:

```http
415 Unsupported Media Type
```

## 25.2 `406 Not Acceptable`

Server cannot produce any representation acceptable to client.

Example:

```http
GET /customers/C001
Accept: application/xml
```

Endpoint produces JSON only.

Return:

```http
406 Not Acceptable
```

## 25.3 JAX-RS mapping

```java
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
```

## 25.4 Common bug

Frontend sends:

```http
Content-Type: application/json;charset=UTF-8
```

Should usually still match `application/json`.

Provider/runtime should handle compatible parameters.

## 25.5 Debugging

Check:

- `Content-Type`;
- `Accept`;
- `@Consumes`;
- `@Produces`;
- provider availability.

---

# 26. `429` vs `503`: Rate Limit vs Temporary Unavailability

## 26.1 `429 Too Many Requests`

Client is sending too many requests.

Usually rate limiting/quota.

Include:

```http
Retry-After: 60
```

## 26.2 `503 Service Unavailable`

Server temporarily unable to handle due overload/maintenance/dependency.

Also can include `Retry-After`.

## 26.3 Difference

`429` is about client quota/rate.

`503` is about service availability.

## 26.4 API gateway

Rate limiting often at gateway.

But app can also enforce business rate limits.

## 26.5 Error body

Include code:

```text
RATE_LIMIT_EXCEEDED
SERVICE_TEMPORARILY_UNAVAILABLE
```

## 26.6 Observability

Track separately.

---

# 27. Headers as Semantics: Bukan Dekorasi

Headers modify and describe request/response.

## 27.1 Request headers

- `Accept`;
- `Content-Type`;
- `Authorization`;
- `If-Match`;
- `If-None-Match`;
- `If-Modified-Since`;
- `Idempotency-Key`;
- `X-Correlation-ID`;
- `Origin`;
- `User-Agent`.

## 27.2 Response headers

- `Content-Type`;
- `Location`;
- `ETag`;
- `Last-Modified`;
- `Cache-Control`;
- `Vary`;
- `Retry-After`;
- `WWW-Authenticate`;
- `Allow`;
- `Link`;
- `Content-Disposition`.

## 27.3 JAX-RS

Read:

```java
@HeaderParam("If-Match") String ifMatch;
@Context HttpHeaders headers;
```

Write:

```java
Response.ok(entity)
    .header("Retry-After", "60")
    .build();
```

## 27.4 Header design

Custom headers okay, but prefer standard headers when semantics already exist.

## 27.5 Avoid misuse

Do not put core resource identity only in custom header if URI should represent it.

---

# 28. Media Type, `Content-Type`, `Accept`, dan Representation Format

## 28.1 `Content-Type`

Describes request/response body format.

Request:

```http
Content-Type: application/json
```

Response:

```http
Content-Type: application/json
```

## 28.2 `Accept`

Client says what response media types it accepts.

```http
Accept: application/json
```

## 28.3 JAX-RS

```java
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
```

## 28.4 Vendor media type

```text
application/vnd.example.customer+json
```

Can support versioning/custom format.

## 28.5 Problem details

```text
application/problem+json
```

## 28.6 Merge patch

```text
application/merge-patch+json
```

## 28.7 JSON Patch

```text
application/json-patch+json
```

## 28.8 Charset

For text:

```text
text/plain; charset=UTF-8
```

JSON is normally Unicode; avoid unnecessary charset debates, but be consistent.

---

# 29. Content Negotiation: `Accept`, `Accept-Language`, `Accept-Encoding`, `Vary`

Content negotiation selects representation.

## 29.1 Media type negotiation

Client:

```http
Accept: application/json, application/xml;q=0.5
```

Server chooses best producible type.

## 29.2 Language negotiation

```http
Accept-Language: id-ID, en;q=0.8
```

Useful for localized messages.

## 29.3 Encoding negotiation

```http
Accept-Encoding: gzip, br
```

Usually handled by server/proxy.

## 29.4 `Vary`

If response varies by header, include `Vary`.

Example:

```http
Vary: Accept, Accept-Language
```

## 29.5 JAX-RS `Variant`

JAX-RS has `Variant` and `Request.selectVariant`.

## 29.6 Failure

No acceptable representation:

```http
406 Not Acceptable
```

## 29.7 Production note

Many APIs choose only JSON.

Still, `Accept` handling matters.

---

# 30. Caching: `Cache-Control`, `ETag`, `Last-Modified`, `Expires`, `Vary`

RFC 9111 defines HTTP caching and associated header fields.

## 30.1 Why caching matters

- reduce latency;
- reduce server load;
- improve scalability;
- enable conditional GET.

## 30.2 `Cache-Control`

Examples:

```http
Cache-Control: no-store
Cache-Control: no-cache
Cache-Control: private, max-age=60
Cache-Control: public, max-age=3600
```

## 30.3 `no-store`

Do not store response.

Use for sensitive data.

## 30.4 `no-cache`

Can store but must revalidate before reuse.

Name is confusing.

## 30.5 `private`

Only private cache, not shared proxy.

Use for user-specific data.

## 30.6 `public`

Shared caches may store.

Use only for safe public data.

## 30.7 `ETag`

Opaque version identifier.

```http
ETag: "v3"
```

## 30.8 `Last-Modified`

Timestamp of last modification.

Less precise than ETag.

## 30.9 `Expires`

Older absolute expiration.

`Cache-Control` generally preferred.

## 30.10 `Vary`

Cache key includes specified request headers.

## 30.11 JAX-RS

```java
CacheControl cc = new CacheControl();
cc.setPrivate(true);
cc.setMaxAge(60);

return Response.ok(entity)
    .cacheControl(cc)
    .tag(new EntityTag(version))
    .build();
```

## 30.12 Security

Do not cache private sensitive responses in shared caches.

---

# 31. Conditional Requests: `If-Match`, `If-None-Match`, `If-Modified-Since`, `If-Unmodified-Since`

Conditional requests make request depend on resource state.

## 31.1 `If-None-Match`

Common for cache validation.

Client:

```http
GET /customers/C001
If-None-Match: "v3"
```

Server if unchanged:

```http
304 Not Modified
```

## 31.2 `If-Match`

Common for optimistic concurrency.

Client:

```http
PUT /customers/C001
If-Match: "v3"
```

Server if current is not `"v3"`:

```http
412 Precondition Failed
```

## 31.3 `If-Modified-Since`

Time-based cache validation.

## 31.4 `If-Unmodified-Since`

Time-based write precondition.

## 31.5 ETag preferred

For concurrency, ETag usually more robust than timestamp.

## 31.6 JAX-RS

```java
Response.ResponseBuilder preconditions =
    request.evaluatePreconditions(new EntityTag(currentVersion));

if (preconditions != null) {
    return preconditions.build();
}
```

## 31.7 Lost update prevention

Use conditional PUT/PATCH/DELETE.

---

# 32. Optimistic Concurrency dengan ETag

## 32.1 Problem: lost update

Two clients read version 1.

Client A updates to version 2.

Client B updates based on stale version 1 and overwrites A.

## 32.2 ETag solution

GET:

```http
GET /customers/C001
```

Response:

```http
200 OK
ETag: "v1"
```

Update:

```http
PUT /customers/C001
If-Match: "v1"
```

If current version still v1, update succeeds.

If current changed:

```http
412 Precondition Failed
```

## 32.3 JPA integration

If entity has:

```java
@Version
private long version;
```

ETag can be based on version.

Example:

```text
"customer-C001-v42"
```

## 32.4 Strong vs weak ETag

Strong ETag means byte-for-byte representation equivalence.

Weak ETag means semantically equivalent.

For write concurrency, use strong-ish version ETag.

## 32.5 JAX-RS code sketch

```java
@GET
@Path("/{id}")
public Response get(@PathParam("id") String id) {
    CustomerDto dto = service.get(id);
    EntityTag tag = new EntityTag("\"" + dto.version() + "\"");

    return Response.ok(dto)
        .tag(tag)
        .build();
}
```

```java
@PUT
@Path("/{id}")
public Response update(
    @PathParam("id") String id,
    @HeaderParam("If-Match") String ifMatch,
    @Valid UpdateCustomerRequest body
) {
    service.update(id, body, parseVersion(ifMatch));
    return Response.noContent().build();
}
```

## 32.6 Better

Use `Request.evaluatePreconditions` where appropriate.

## 32.7 Failure mode

No ETag on mutable resources leads to lost updates.

---

# 33. Idempotency-Key untuk `POST`/Command yang Bisa Diulang

`POST` is not idempotent by default.

But network failures cause clients to retry.

## 33.1 Problem

Client sends:

```http
POST /payments
```

Server processes payment, but response times out.

Client retries.

Without idempotency, duplicate payment.

## 33.2 Idempotency-Key

Client sends stable key:

```http
Idempotency-Key: 3f9d...
```

Server stores outcome for key.

Repeated request returns same result or safe response.

## 33.3 Scope

Idempotency key should be scoped by:

- client/account/user;
- operation type;
- request fingerprint;
- time window.

## 33.4 Response replay

Server can replay previous response.

## 33.5 Conflict

If same key used with different payload, return conflict/error.

## 33.6 Persistence

Store key in DB/redis with TTL.

## 33.7 JAX-RS

```java
@POST
@Path("/payments")
public Response pay(
    @HeaderParam("Idempotency-Key") String key,
    @Valid PaymentRequest request
) {
    PaymentResult result = service.process(key, request);
    return Response.status(result.created() ? 201 : 200)
        .entity(result.response())
        .build();
}
```

## 33.8 Top-tier requirement

Any externally retried non-idempotent command should have idempotency strategy.

---

# 34. Long-Running Operations: `202 Accepted`, Job Resource, Polling/SSE

Not every request should block until completion.

## 34.1 Use `202 Accepted`

Client:

```http
POST /reports
```

Server:

```http
202 Accepted
Location: /reports/jobs/J001
Retry-After: 5
```

## 34.2 Job resource

```http
GET /reports/jobs/J001
```

Response:

```json
{
  "id": "J001",
  "status": "RUNNING",
  "progress": 45
}
```

Final:

```json
{
  "id": "J001",
  "status": "SUCCEEDED",
  "result": {
    "downloadUrl": "/reports/R001"
  }
}
```

## 34.3 Failure

```json
{
  "id": "J001",
  "status": "FAILED",
  "error": {
    "code": "SOURCE_UNAVAILABLE"
  }
}
```

## 34.4 Cancellation

```http
POST /reports/jobs/J001/cancellation
```

or:

```http
DELETE /reports/jobs/J001
```

depending semantics.

## 34.5 SSE notification

Can use SSE to push progress.

## 34.6 Important

`202` means accepted, not completed.

Do not return `202` without status resource.

## 34.7 JAX-RS

```java
@POST
@Path("/reports")
public Response startReport(CreateReportRequest request, @Context UriInfo uriInfo) {
    Job job = service.submit(request);

    URI jobUri = uriInfo.getBaseUriBuilder()
        .path(ReportJobResource.class)
        .path(ReportJobResource.class, "get")
        .build(job.id());

    return Response.accepted()
        .location(jobUri)
        .header(HttpHeaders.RETRY_AFTER, "5")
        .build();
}
```

---

# 35. Problem Details dan Error Contract

RFC 9457 defines Problem Details for HTTP APIs and obsoletes RFC 7807.

Media type:

```text
application/problem+json
```

## 35.1 Standard fields

Common fields:

```json
{
  "type": "https://example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "detail": "Request contains invalid fields",
  "instance": "/customers"
}
```

## 35.2 Extensions

You can add fields:

```json
{
  "code": "VALIDATION_FAILED",
  "correlationId": "abc-123",
  "violations": [
    {
      "field": "email",
      "message": "must be a well-formed email address"
    }
  ]
}
```

## 35.3 Why useful

- standard shape;
- machine-readable;
- client-friendly;
- consistent across APIs.

## 35.4 JAX-RS

Use `ExceptionMapper`.

```java
@Provider
public class ValidationExceptionMapper
    implements ExceptionMapper<ConstraintViolationException> {

    @Override
    public Response toResponse(ConstraintViolationException ex) {
        Problem problem = Problem.validation(ex);
        return Response.status(422)
            .type("application/problem+json")
            .entity(problem)
            .build();
    }
}
```

## 35.5 Security

Do not expose stack traces/internal classes.

## 35.6 Consistency

All errors should follow same format.

---

# 36. How HTTP Semantics Maps to JAX-RS

## 36.1 Methods

```java
@GET
@POST
@PUT
@PATCH
@DELETE
@HEAD
@OPTIONS
```

## 36.2 Status

```java
Response.status(409)
Response.created(uri)
Response.accepted()
Response.noContent()
```

## 36.3 Headers

```java
@HeaderParam("If-Match")
@Context HttpHeaders
Response.header("Retry-After", "60")
```

## 36.4 Media types

```java
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
```

## 36.5 URI

```java
@Context UriInfo
```

## 36.6 Conditional request

```java
@Context Request
```

## 36.7 Cache

```java
CacheControl
EntityTag
```

## 36.8 Error

```java
ExceptionMapper<T>
WebApplicationException
```

## 36.9 Validation

```java
@Valid
@NotBlank
@Min
```

## 36.10 Security

```java
@Context SecurityContext
```

---

# 37. JAX-RS Code Patterns untuk HTTP Semantics

## 37.1 Create with `201 Created`

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public Response create(@Valid CreateCustomerRequest request, @Context UriInfo uriInfo) {
    CustomerResult result = service.create(request);

    URI location = uriInfo.getAbsolutePathBuilder()
        .path(result.id())
        .build();

    return Response.created(location)
        .entity(result)
        .build();
}
```

## 37.2 Update with `204 No Content`

```java
@PUT
@Path("/{id}")
@Consumes(MediaType.APPLICATION_JSON)
public Response replace(@PathParam("id") String id, @Valid ReplaceCustomerRequest request) {
    service.replace(id, request);
    return Response.noContent().build();
}
```

## 37.3 Conditional update

```java
@PUT
@Path("/{id}")
public Response replace(
    @PathParam("id") String id,
    @HeaderParam("If-Match") String ifMatch,
    ReplaceCustomerRequest request
) {
    service.replace(id, request, ifMatch);
    return Response.noContent().build();
}
```

## 37.4 Cacheable GET

```java
@GET
@Path("/{id}")
public Response get(@PathParam("id") String id, @Context Request request) {
    CustomerDto dto = service.get(id);
    EntityTag tag = new EntityTag(dto.version());

    Response.ResponseBuilder preconditions = request.evaluatePreconditions(tag);
    if (preconditions != null) {
        return preconditions.tag(tag).build();
    }

    CacheControl cache = new CacheControl();
    cache.setPrivate(true);
    cache.setMaxAge(60);

    return Response.ok(dto)
        .tag(tag)
        .cacheControl(cache)
        .build();
}
```

## 37.5 Rate limit error

```java
return Response.status(429)
    .header("Retry-After", "60")
    .type("application/problem+json")
    .entity(problem)
    .build();
```

## 37.6 Problem details error

```java
return Response.status(problem.status())
    .type("application/problem+json")
    .entity(problem)
    .build();
```

---

# 38. Common Failure Modes

## 38.1 GET mutates state

Dangerous with caches/prefetchers.

## 38.2 POST duplicate side effects

No idempotency key.

## 38.3 PUT as partial update

Missing fields accidentally deleted or ignored inconsistently.

## 38.4 PATCH without defined patch media type

Ambiguous semantics.

## 38.5 Always 200

Client cannot distinguish outcomes.

## 38.6 500 for validation

Client thinks server bug.

## 38.7 No ETag on mutable resources

Lost updates.

## 38.8 Cache private data publicly

Security incident.

## 38.9 Missing `Location` on create/accepted

Client cannot discover resource/job.

## 38.10 `204` with body

Protocol confusion.

## 38.11 `401` for forbidden user

Client keeps trying to authenticate.

## 38.12 `404` for validation error

Misleading.

## 38.13 Missing `Vary`

Cache serves wrong representation.

## 38.14 Missing `Retry-After`

Clients retry aggressively.

---

# 39. Best Practices

## 39.1 Choose method by semantics

Not by frontend convenience.

## 39.2 Use status codes intentionally

Document status per endpoint.

## 39.3 Use `Location`

For `201` and `202`.

## 39.4 Use `ETag`

For mutable resources.

## 39.5 Use idempotency key

For externally retried POST commands.

## 39.6 Define error contract

Prefer Problem Details or similar standard shape.

## 39.7 Separate validation categories

Parsing/type errors vs semantic validation vs business conflicts.

## 39.8 Set cache headers

Especially for sensitive data.

## 39.9 Use `Retry-After`

For `429` and `503`.

## 39.10 Test HTTP semantics

Contract tests should assert status/headers/body.

---

# 40. Anti-Patterns

## 40.1 `GET /deleteUser?id=1`

Unsafe GET.

## 40.2 `POST /getCustomer`

RPC tunneling.

## 40.3 `PUT` partial merge without documentation

Unexpected.

## 40.4 `PATCH` arbitrary action

Use POST command resource.

## 40.5 `200 OK` with error body

Bad client semantics.

## 40.6 `500` for all exceptions

Poor error classification.

## 40.7 No cache policy

Defaults may surprise.

## 40.8 No concurrency control

Lost updates.

## 40.9 Retry unsafe command

Duplicate side effect.

## 40.10 Leaking stack trace

Security issue.

---

# 41. Production Checklist

For each endpoint:

## 41.1 Method and URI

- [ ] Method matches semantics.
- [ ] URI identifies resource/command clearly.
- [ ] Safe methods do not mutate state.
- [ ] Idempotent methods are actually idempotent.

## 41.2 Request

- [ ] `Content-Type` defined.
- [ ] `Accept` behavior defined.
- [ ] Payload validation defined.
- [ ] Max payload size defined.
- [ ] Auth requirements defined.

## 41.3 Response

- [ ] Success status defined.
- [ ] Error statuses defined.
- [ ] `Location` where needed.
- [ ] `ETag` where needed.
- [ ] Cache headers defined.
- [ ] Error format stable.

## 41.4 Resilience

- [ ] Idempotency key for unsafe retriable commands.
- [ ] Conditional requests for mutable resources.
- [ ] `Retry-After` for rate limit/unavailable.
- [ ] Long-running operation has job resource.

## 41.5 Security

- [ ] `401`/`403` policy.
- [ ] `404` hiding policy.
- [ ] No sensitive cache leak.
- [ ] No stack traces.

## 41.6 Observability

- [ ] Method/status/path-template metric.
- [ ] Error code metric.
- [ ] Correlation ID.
- [ ] Trace span.
- [ ] Logs redacted.

---

# 42. Latihan

## Latihan 1 — Method audit

Ambil 10 endpoint.

Buat tabel:

```text
endpoint
current method
ideal method
safe?
idempotent?
cacheable?
reason
```

## Latihan 2 — Status code contract

Untuk satu resource `Order`, desain status code untuk:

- create;
- get;
- update;
- partial update;
- cancel;
- delete;
- duplicate;
- stale update;
- validation error;
- unauthorized;
- forbidden;
- rate limited.

## Latihan 3 — ETag design

Ambil entity dengan `version`.

Desain:

- GET response ETag;
- PUT with If-Match;
- stale update response.

## Latihan 4 — Idempotency key

Desain tabel DB:

```text
idempotency_key
client_id
request_hash
status
response_body
created_at
expires_at
```

Jelaskan behavior retry.

## Latihan 5 — Long-running operation

Desain API untuk generate report:

- start;
- status;
- result download;
- cancel;
- failure.

## Latihan 6 — Cache policy

Untuk endpoint berikut, tentukan cache header:

- public product catalog;
- user profile;
- bank balance;
- static reference data;
- PDF document.

## Latihan 7 — Problem details

Buat error response untuk:

- validation failed;
- stale version;
- duplicate email;
- unauthorized;
- forbidden;
- rate limited;
- dependency unavailable.

---

# 43. Referensi Resmi

Referensi utama:

1. RFC 9110 — HTTP Semantics  
   https://www.rfc-editor.org/rfc/rfc9110.html

2. RFC 9111 — HTTP Caching  
   https://www.rfc-editor.org/rfc/rfc9111.html

3. RFC 5789 — PATCH Method for HTTP  
   https://www.rfc-editor.org/info/rfc5789/

4. RFC 9457 — Problem Details for HTTP APIs  
   https://www.rfc-editor.org/rfc/rfc9457.html

5. IANA HTTP Method Registry  
   https://www.iana.org/assignments/http-methods

6. IANA HTTP Status Code Registry  
   https://www.iana.org/assignments/http-status-codes

7. Jakarta RESTful Web Services 4.0  
   https://jakarta.ee/specifications/restful-ws/4.0/

8. Jakarta RESTful Web Services 4.0 API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/

9. MDN HTTP Request Methods  
   https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods

10. MDN HTTP Response Status Codes  
    https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status

---

# 44. Penutup

Part ini adalah fondasi wajib untuk semua part JAX-RS berikutnya.

Mental model utama:

```text
HTTP method tells intent.
URI identifies resource.
Headers modify semantics.
Status code tells outcome.
Body carries representation.
```

JAX-RS hanya membantu memetakan semua itu ke Java:

```java
@GET
@POST
@PUT
@PATCH
@DELETE
@Consumes
@Produces
Response
Request
EntityTag
CacheControl
ExceptionMapper
```

Top-tier JAX-RS engineer tidak hanya bertanya:

```text
Annotation apa yang harus dipakai?
```

Ia bertanya:

```text
Apa semantics HTTP yang benar untuk domain operation ini?
Apa status code yang membuat client bisa bertindak benar?
Apakah operation ini idempotent?
Apakah perlu ETag?
Apakah response boleh dicache?
Apakah long-running?
Apakah retry aman?
Apakah error contract actionable?
```

Part berikutnya:

```text
Bagian 002 — Anatomy of JAX-RS Application: Application, Base Path, Deployment, Runtime
```

Kita akan masuk ke bagaimana JAX-RS application dibootstrap, bagaimana `Application` dan `@ApplicationPath` bekerja, bagaimana resource/provider ditemukan, dan bagaimana runtime berbeda mempengaruhi deployment.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-000.md](./learn-jaxrs-advanced-part-000.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-002.md](./learn-jaxrs-advanced-part-002.md)
