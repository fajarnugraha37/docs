# learn-jaxrs-advanced-part-022.md

# Bagian 022 — Conditional Requests, ETag, Last-Modified, Optimistic Concurrency: Validators, `If-Match`, `If-None-Match`, `If-Modified-Since`, `If-Unmodified-Since`, `304`, `412`, `428`, Cache Revalidation, dan Lost Update Prevention

> Target pembaca: Java/Jakarta engineer yang ingin menguasai **HTTP conditional requests** dan memakainya dengan benar di JAX-RS/Jakarta REST untuk caching, bandwidth efficiency, optimistic concurrency, dan lost-update prevention. Fokus bagian ini bukan hanya “tambahkan ETag”, tetapi memahami validator model, strong/weak ETag, Last-Modified, precondition headers, status code semantics, `Request.evaluatePreconditions(...)`, cache revalidation, write concurrency, collection validators, gateway/proxy behavior, dan production pitfalls.
>
> Namespace utama: `jakarta.ws.rs.core.Request`, `jakarta.ws.rs.core.EntityTag`, `jakarta.ws.rs.core.Response`, `jakarta.ws.rs.core.CacheControl`, `jakarta.ws.rs.core.HttpHeaders`, `jakarta.ws.rs.core.Context`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: HTTP Validator adalah Version Contract](#2-mental-model-http-validator-adalah-version-contract)
3. [Dua Use Case Besar: Cache Revalidation dan Lost Update Prevention](#3-dua-use-case-besar-cache-revalidation-dan-lost-update-prevention)
4. [HTTP Validators: ETag dan Last-Modified](#4-http-validators-etag-dan-last-modified)
5. [ETag: Entity Tag](#5-etag-entity-tag)
6. [Strong ETag vs Weak ETag](#6-strong-etag-vs-weak-etag)
7. [Last-Modified](#7-last-modified)
8. [ETag vs Last-Modified](#8-etag-vs-last-modified)
9. [Validator Scope: Representation, Resource, atau Domain Version?](#9-validator-scope-representation-resource-atau-domain-version)
10. [Conditional Request Headers Overview](#10-conditional-request-headers-overview)
11. [`If-None-Match`](#11-if-none-match)
12. [`If-Modified-Since`](#12-if-modified-since)
13. [`If-Match`](#13-if-match)
14. [`If-Unmodified-Since`](#14-if-unmodified-since)
15. [`If-Range`](#15-if-range)
16. [Precedence: ETag Validators vs Date Validators](#16-precedence-etag-validators-vs-date-validators)
17. [GET/HEAD Revalidation: 200 vs 304](#17-gethead-revalidation-200-vs-304)
18. [Unsafe Method Preconditions: 412](#18-unsafe-method-preconditions-412)
19. [428 Precondition Required](#19-428-precondition-required)
20. [409 Conflict vs 412 Precondition Failed vs 428 Precondition Required](#20-409-conflict-vs-412-precondition-failed-vs-428-precondition-required)
21. [JAX-RS `Request` and `evaluatePreconditions`](#21-jax-rs-request-and-evaluatepreconditions)
22. [Basic GET with ETag](#22-basic-get-with-etag)
23. [GET with ETag and Last-Modified](#23-get-with-etag-and-last-modified)
24. [PUT/PATCH with `If-Match`](#24-putpatch-with-if-match)
25. [DELETE with `If-Match`](#25-delete-with-if-match)
26. [Create If Absent with `If-None-Match: *`](#26-create-if-absent-with-if-none-match-)
27. [Designing ETag Values](#27-designing-etag-values)
28. [Version-Based ETag](#28-version-based-etag)
29. [Hash-Based ETag](#29-hash-based-etag)
30. [Timestamp-Based ETag](#30-timestamp-based-etag)
31. [Composite ETag for Aggregates](#31-composite-etag-for-aggregates)
32. [ETag and Content Negotiation](#32-etag-and-content-negotiation)
33. [ETag and Compression / Content-Encoding](#33-etag-and-compression--content-encoding)
34. [ETag and Authorization / User-Specific Representations](#34-etag-and-authorization--user-specific-representations)
35. [Cache-Control with Validators](#35-cache-control-with-validators)
36. [Private vs Public Cache](#36-private-vs-public-cache)
37. [`no-cache` vs `no-store`](#37-no-cache-vs-no-store)
38. [`must-revalidate`, `max-age`, `s-maxage`](#38-must-revalidate-max-age-s-maxage)
39. [Vary Header](#39-vary-header)
40. [Conditional Requests for Collections](#40-conditional-requests-for-collections)
41. [Conditional Requests for Search/List Responses](#41-conditional-requests-for-searchlist-responses)
42. [Optimistic Concurrency in Application Service](#42-optimistic-concurrency-in-application-service)
43. [JPA `@Version` and HTTP ETag](#43-jpa-version-and-http-etag)
44. [Strong Consistency vs Eventual Consistency](#44-strong-consistency-vs-eventual-consistency)
45. [Weak Validators for Expensive Representations](#45-weak-validators-for-expensive-representations)
46. [Clock Precision and Last-Modified Pitfalls](#46-clock-precision-and-last-modified-pitfalls)
47. [HTTP Date Parsing and Time Zones](#47-http-date-parsing-and-time-zones)
48. [304 Response Body and Headers](#48-304-response-body-and-headers)
49. [Response Codes Cheat Sheet](#49-response-codes-cheat-sheet)
50. [Problem Details for Concurrency Errors](#50-problem-details-for-concurrency-errors)
51. [Security Considerations](#51-security-considerations)
52. [Observability](#52-observability)
53. [Testing Conditional Requests](#53-testing-conditional-requests)
54. [OpenAPI Documentation](#54-openapi-documentation)
55. [Runtime Differences and Implementation Notes](#55-runtime-differences-and-implementation-notes)
56. [Common Failure Modes](#56-common-failure-modes)
57. [Best Practices](#57-best-practices)
58. [Anti-Patterns](#58-anti-patterns)
59. [Production Checklist](#59-production-checklist)
60. [Latihan](#60-latihan)
61. [Referensi Resmi](#61-referensi-resmi)
62. [Penutup](#62-penutup)

---

# 1. Tujuan Part Ini

Conditional request adalah fitur HTTP yang sering dianggap “caching stuff”.

Padahal untuk REST API production, ia punya dua fungsi besar:

1. **Cache revalidation**  
   Client/proxy bisa bertanya: “resource saya masih sama tidak?”  
   Jika masih sama, server balas `304 Not Modified` tanpa body.

2. **Optimistic concurrency / lost update prevention**  
   Client bisa berkata: “update ini hanya boleh dilakukan jika resource masih versi yang saya baca.”  
   Jika sudah berubah, server balas `412 Precondition Failed`.

Contoh:

```http
GET /customers/C001
```

Response:

```http
200 OK
ETag: "customer-C001-v7"
Last-Modified: Fri, 12 Jun 2026 08:30:00 GMT

{
  "id": "C001",
  "displayName": "Fajar"
}
```

Client update:

```http
PATCH /customers/C001
If-Match: "customer-C001-v7"
Content-Type: application/merge-patch+json

{
  "displayName": "Fajar Abdi"
}
```

Jika server current version masih v7, update boleh.

Jika sudah v8, update ditolak:

```http
412 Precondition Failed
```

## 1.1 Kenapa ini penting?

Tanpa conditional requests:

- client download data berulang walau tidak berubah;
- UI overwrite perubahan user lain;
- PATCH/PUT bisa lost update;
- DELETE bisa menghapus resource yang sudah berubah;
- cache tidak efisien;
- gateway/proxy tidak bisa revalidate dengan baik;
- concurrency logic jadi custom header non-HTTP.

## 1.2 Prinsip utama

```text
HTTP validators are representation version contracts.
Precondition headers are client-side assertions about the server state.
```

---

# 2. Mental Model: HTTP Validator adalah Version Contract

Validator adalah metadata yang merepresentasikan versi representation.

Contoh validator:

```http
ETag: "customer-C001-v7"
Last-Modified: Fri, 12 Jun 2026 08:30:00 GMT
```

Client menyimpan validator bersama response.

Kemudian client mengirim validator kembali:

```http
If-None-Match: "customer-C001-v7"
```

atau:

```http
If-Match: "customer-C001-v7"
```

Server membandingkan validator client dengan current validator.

## 2.1 Validator bukan sekadar header

Validator adalah kontrak:

```text
Client: saya punya versi X.
Server: current version masih X atau tidak?
```

## 2.2 Read scenario

```text
If current == client version → 304 Not Modified
If current != client version → 200 OK with new body
```

## 2.3 Write scenario

```text
If current == client version → allow update
If current != client version → 412 Precondition Failed
```

## 2.4 Top-tier rule

```text
The same ETag can serve both cache revalidation and optimistic concurrency, but only if its semantics are designed correctly.
```

---

# 3. Dua Use Case Besar: Cache Revalidation dan Lost Update Prevention

## 3.1 Cache revalidation

Client says:

```http
If-None-Match: "abc"
```

Meaning:

```text
Give me representation only if it does not match my cached one.
```

If match:

```http
304 Not Modified
```

No body.

## 3.2 Lost update prevention

Client says:

```http
If-Match: "abc"
```

Meaning:

```text
Apply write only if current representation matches what I saw.
```

If not match:

```http
412 Precondition Failed
```

## 3.3 Different headers, different semantics

```text
If-None-Match → usually cache/read/create-if-absent
If-Match      → usually update/delete only-if-current
```

## 3.4 Rule

Never confuse `If-None-Match` and `If-Match`; they are opposite conditions.

---

# 4. HTTP Validators: ETag dan Last-Modified

HTTP has two primary validator families:

```text
ETag
Last-Modified
```

## 4.1 ETag

Opaque identifier for selected representation version.

```http
ETag: "v7"
```

## 4.2 Last-Modified

Timestamp when server believes representation was last modified.

```http
Last-Modified: Fri, 12 Jun 2026 08:30:00 GMT
```

## 4.3 Both together

For `200 OK`, servers often send both if possible.

## 4.4 Which is better?

ETag is usually more precise and flexible.

Last-Modified is easy but timestamp precision/clock skew can be tricky.

## 4.5 Rule

Prefer ETag for correctness. Add Last-Modified when cheap and meaningful.

---

# 5. ETag: Entity Tag

ETag is an HTTP response header.

```http
ETag: "customer-C001-v7"
```

## 5.1 Opaque to client

Client should not parse meaning.

Even if server encodes version, client treats it as opaque string.

## 5.2 Quoted

ETag values are quoted.

## 5.3 JAX-RS `EntityTag`

```java
EntityTag tag = new EntityTag("customer-C001-v7");
```

Response:

```java
return Response.ok(customer)
    .tag(tag)
    .build();
```

## 5.4 Strong or weak

```http
ETag: "abc"
ETag: W/"abc"
```

## 5.5 Rule

ETag is public opaque representation validator.

---

# 6. Strong ETag vs Weak ETag

## 6.1 Strong ETag

```http
ETag: "abc"
```

Strong validator means representation data is equivalent at byte/semantics level required by strong comparison.

Use for:

- concurrency control;
- byte-level representation identity;
- range requests;
- precise cache validation.

## 6.2 Weak ETag

```http
ETag: W/"abc"
```

Weak validator means semantically equivalent enough for caching but not necessarily byte-identical.

Use for:

- expensive generated representations;
- approximate semantic version;
- representations that differ insignificantly.

## 6.3 JAX-RS

```java
new EntityTag("abc", true);  // weak=true
new EntityTag("abc", false); // strong
```

## 6.4 Write preconditions

For `If-Match`, use strong validators for lost-update prevention.

## 6.5 Rule

Use strong ETag for optimistic concurrency. Use weak ETag mainly for cache validation.

---

# 7. Last-Modified

Last-Modified indicates last modification time.

```http
Last-Modified: Fri, 12 Jun 2026 08:30:00 GMT
```

## 7.1 JAX-RS

```java
return Response.ok(entity)
    .lastModified(Date.from(lastModifiedInstant))
    .build();
```

## 7.2 Date precision

HTTP dates are second-level precision.

If your database stores milliseconds/nanoseconds, be careful.

## 7.3 Clock skew

If multiple nodes generate timestamps from local clocks, skew can break semantics.

## 7.4 Good use

- static content;
- simple resources with reliable updatedAt;
- additional validator with ETag.

## 7.5 Rule

Last-Modified is useful, but less precise than strong ETag.

---

# 8. ETag vs Last-Modified

## 8.1 ETag advantages

- precise version;
- can be based on DB version;
- independent of clock;
- can encode aggregate version/hash;
- better for concurrency.

## 8.2 Last-Modified advantages

- easy;
- human-readable;
- works with many caches;
- cheap for filesystem/static resources.

## 8.3 Combined

Send both when possible:

```http
ETag: "v7"
Last-Modified: Fri, 12 Jun 2026 08:30:00 GMT
```

## 8.4 Precedence

When ETag and date validators both appear, ETag-based condition generally takes precedence in modern HTTP semantics.

## 8.5 Rule

Use ETag as primary validator; Last-Modified as secondary.

---

# 9. Validator Scope: Representation, Resource, atau Domain Version?

This is subtle.

## 9.1 Representation validator

ETag changes when response representation changes.

Example:

- language changes;
- fields included differ;
- compression differs;
- user-specific redaction differs.

## 9.2 Resource state version

ETag changes when resource state changes.

Example:

```text
customer.version = 7
```

## 9.3 Domain aggregate version

ETag changes when aggregate/root changes, possibly including child entities.

## 9.4 Which should API use?

For caching, validator should match representation.

For concurrency, validator should protect state being updated.

Often you can use domain version as ETag if representation directly reflects state.

## 9.5 Rule

Define what your ETag validates. Do not assume one version fits all representations.

---

# 10. Conditional Request Headers Overview

Common headers:

```text
If-None-Match
If-Modified-Since
If-Match
If-Unmodified-Since
If-Range
```

## 10.1 Read/cache headers

```text
If-None-Match
If-Modified-Since
```

## 10.2 Write/concurrency headers

```text
If-Match
If-Unmodified-Since
```

## 10.3 Range header helper

```text
If-Range
```

used with range requests.

## 10.4 Rule

Conditional headers let client make request conditional on current resource state.

---

# 11. `If-None-Match`

## 11.1 Read revalidation

```http
GET /customers/C001
If-None-Match: "v7"
```

If current ETag matches:

```http
304 Not Modified
```

If not:

```http
200 OK
ETag: "v8"

{ ... }
```

## 11.2 Unsafe methods

For methods other than GET/HEAD, `If-None-Match` means process only if current ETag does **not** match.

## 11.3 Create-if-absent

```http
PUT /documents/D001
If-None-Match: *
```

Means:

```text
create only if resource does not already exist
```

If exists:

```text
412 Precondition Failed
```

## 11.4 Rule

`If-None-Match` is “only if not already matching/existing.”

---

# 12. `If-Modified-Since`

## 12.1 Read revalidation

```http
GET /customers/C001
If-Modified-Since: Fri, 12 Jun 2026 08:30:00 GMT
```

If resource has not changed since:

```http
304 Not Modified
```

If modified after date:

```http
200 OK
```

## 12.2 Usually GET/HEAD

Primarily cache revalidation.

## 12.3 Less precise

Timestamp precision and clock skew.

## 12.4 Use when ETag unavailable

Better than nothing.

## 12.5 Rule

Use `If-Modified-Since` for cache revalidation, but prefer ETag when possible.

---

# 13. `If-Match`

## 13.1 Write precondition

```http
PATCH /customers/C001
If-Match: "v7"
```

Process only if current ETag matches one listed.

## 13.2 If mismatch

```http
412 Precondition Failed
```

## 13.3 Multiple ETags

```http
If-Match: "v7", "v8"
```

## 13.4 Wildcard

```http
If-Match: *
```

Process only if resource exists.

## 13.5 Use for

- PUT;
- PATCH;
- DELETE;
- concurrent update prevention.

## 13.6 Rule

For mutable resources, `If-Match` is your main lost-update prevention header.

---

# 14. `If-Unmodified-Since`

## 14.1 Date-based write precondition

```http
PATCH /customers/C001
If-Unmodified-Since: Fri, 12 Jun 2026 08:30:00 GMT
```

Process only if resource has not been modified since that date.

## 14.2 If modified later

```http
412 Precondition Failed
```

## 14.3 Less reliable than ETag

Timestamp precision and clock skew.

## 14.4 Use when ETag unavailable

Prefer `If-Match`.

## 14.5 Rule

`If-Unmodified-Since` is a weaker fallback for write concurrency.

---

# 15. `If-Range`

`If-Range` is used with `Range`.

## 15.1 Use case

Client has partial cached representation and wants range only if representation unchanged.

```http
Range: bytes=1000-
If-Range: "file-v7"
```

## 15.2 If validator matches

Server sends partial content.

## 15.3 If validator does not match

Server sends full representation.

## 15.4 Relevant to JAX-RS?

Mostly for file/download endpoints.

## 15.5 Rule

For range downloads, `If-Range` protects partial transfer correctness.

---

# 16. Precedence: ETag Validators vs Date Validators

If client sends both ETag and date conditions, ETag conditions are generally more precise and take precedence.

## 16.1 Example

```http
If-None-Match: "v7"
If-Modified-Since: Fri, 12 Jun 2026 08:30:00 GMT
```

Server should evaluate ETag condition first.

## 16.2 Why

ETag is more precise than timestamp.

## 16.3 JAX-RS helper

`Request.evaluatePreconditions(lastModified, eTag)` exists to centralize evaluation.

## 16.4 Rule

Do not implement ad-hoc condition precedence unless you understand RFC semantics.

---

# 17. GET/HEAD Revalidation: 200 vs 304

## 17.1 Client first request

```http
GET /customers/C001
```

Server:

```http
200 OK
ETag: "v7"
Last-Modified: Fri, 12 Jun 2026 08:30:00 GMT
Cache-Control: private, max-age=0, must-revalidate

{ ... }
```

## 17.2 Client revalidates

```http
GET /customers/C001
If-None-Match: "v7"
```

If unchanged:

```http
304 Not Modified
ETag: "v7"
Cache-Control: private, max-age=0, must-revalidate
```

No body.

## 17.3 If changed

```http
200 OK
ETag: "v8"

{ ... updated ... }
```

## 17.4 Rule

304 saves response body but must include appropriate metadata headers.

---

# 18. Unsafe Method Preconditions: 412

Unsafe methods:

```text
PUT
PATCH
DELETE
POST in some conditional create cases
```

## 18.1 Example

```http
PATCH /customers/C001
If-Match: "v7"
```

Server current:

```text
v8
```

Response:

```http
412 Precondition Failed
```

## 18.2 No partial write

Do not apply update when precondition fails.

## 18.3 Problem Details

```json
{
  "code": "PRECONDITION_FAILED",
  "status": 412,
  "detail": "The resource has changed since the client retrieved it."
}
```

## 18.4 Rule

412 means client precondition was present but evaluated false.

---

# 19. 428 Precondition Required

`428 Precondition Required` means server requires conditional request but client did not send required precondition.

## 19.1 Example

```http
PATCH /customers/C001
Content-Type: application/merge-patch+json

{ "displayName": "New" }
```

If API requires `If-Match`, response:

```http
428 Precondition Required
```

## 19.2 Why use it?

To prevent lost update by forcing clients to use `If-Match`.

## 19.3 Difference from 412

```text
428 → required precondition missing
412 → precondition present but failed
```

## 19.4 Cache

Responses with 428 must not be stored by caches per RFC 6585.

## 19.5 Rule

Use 428 when your API requires `If-Match` but request omits it.

---

# 20. 409 Conflict vs 412 Precondition Failed vs 428 Precondition Required

## 20.1 428

Client forgot required conditional header.

```text
Missing If-Match
```

## 20.2 412

Client sent condition but it is false.

```text
If-Match stale
```

## 20.3 409

Request conflicts with domain state, not simply HTTP precondition.

Examples:

```text
cannot approve already rejected application
duplicate active licence
order cannot cancel after shipped
```

## 20.4 Decision

```text
Missing condition → 428
Stale condition → 412
Business conflict → 409
```

## 20.5 Rule

Do not use 409 as generic concurrency bucket if HTTP preconditions caused failure.

---

# 21. JAX-RS `Request` and `evaluatePreconditions`

JAX-RS provides `jakarta.ws.rs.core.Request`.

## 21.1 Inject

```java
@Context
Request request;
```

## 21.2 Methods

```java
Response.ResponseBuilder evaluatePreconditions(EntityTag eTag)
Response.ResponseBuilder evaluatePreconditions(Date lastModified)
Response.ResponseBuilder evaluatePreconditions(Date lastModified, EntityTag eTag)
Response.ResponseBuilder evaluatePreconditions()
```

## 21.3 Return value

If preconditions are met and request can continue:

```text
returns null
```

If preconditions fail and server should return precondition response:

```text
returns ResponseBuilder
```

## 21.4 Example pattern

```java
Response.ResponseBuilder preconditions = request.evaluatePreconditions(eTag);
if (preconditions != null) {
    return preconditions.build();
}
```

## 21.5 Rule

Use `evaluatePreconditions` to avoid hand-implementing conditional request semantics.

---

# 22. Basic GET with ETag

## 22.1 Resource

```java
@GET
@Path("/{customerId}")
@Produces(MediaType.APPLICATION_JSON)
public Response getCustomer(
    @PathParam("customerId") CustomerId customerId,
    @Context Request request
) {
    CustomerView customer = service.getCustomer(customerId);
    EntityTag etag = new EntityTag(customer.versionTag());

    Response.ResponseBuilder preconditions = request.evaluatePreconditions(etag);
    if (preconditions != null) {
        return preconditions
            .tag(etag)
            .cacheControl(privateRevalidate())
            .build();
    }

    return Response.ok(customer)
        .tag(etag)
        .cacheControl(privateRevalidate())
        .build();
}
```

## 22.2 Client flow

First request returns `200` with body and ETag.

Second request with matching `If-None-Match` returns `304`.

## 22.3 Include cache headers in 304

Keep metadata consistent.

## 22.4 Rule

GET should make conditional revalidation cheap and correct.

---

# 23. GET with ETag and Last-Modified

## 23.1 Code

```java
Date lastModified = Date.from(customer.lastModified());
EntityTag etag = new EntityTag(customer.versionTag());

Response.ResponseBuilder preconditions =
    request.evaluatePreconditions(lastModified, etag);

if (preconditions != null) {
    return preconditions
        .tag(etag)
        .lastModified(lastModified)
        .cacheControl(cacheControl)
        .build();
}

return Response.ok(customer)
    .tag(etag)
    .lastModified(lastModified)
    .cacheControl(cacheControl)
    .build();
```

## 23.2 Benefit

Supports both ETag and date-based clients.

## 23.3 Precision caution

Truncate/round lastModified to seconds consistently.

## 23.4 Rule

If sending both, ensure both represent the same selected representation version.

---

# 24. PUT/PATCH with `If-Match`

## 24.1 Boundary approach

```java
@PATCH
@Path("/{customerId}")
@Consumes("application/merge-patch+json")
public Response patchCustomer(
    @PathParam("customerId") CustomerId id,
    JsonObject patch,
    @HeaderParam(HttpHeaders.IF_MATCH) String ifMatchHeader
) {
    if (ifMatchHeader == null || ifMatchHeader.isBlank()) {
        throw new PreconditionRequiredException();
    }

    CustomerView updated = service.patchCustomer(id, patch, ifMatchHeader);

    return Response.ok(updated)
        .tag(new EntityTag(updated.versionTag()))
        .build();
}
```

## 24.2 Service checks version

```java
public CustomerView patchCustomer(CustomerId id, JsonObject patch, String ifMatch) {
    Customer customer = repository.get(id);
    EntityTag current = new EntityTag(customer.versionTag());

    if (!etagMatcher.matchesStrong(ifMatch, current)) {
        throw new PreconditionFailedException();
    }

    customer.applyPatch(...);
    repository.save(customer);
    return mapper.toView(customer);
}
```

## 24.3 Why service check?

For write operations, you often need check and update atomically with DB version.

`Request.evaluatePreconditions` helps, but the service/persistence layer must still protect against race between check and commit.

## 24.4 Rule

For writes, combine HTTP precondition with persistence-level optimistic locking.

---

# 25. DELETE with `If-Match`

## 25.1 Example

```http
DELETE /documents/D001
If-Match: "v3"
```

## 25.2 If current matches

```http
204 No Content
```

## 25.3 If current differs

```http
412 Precondition Failed
```

## 25.4 Why important

Prevents deleting resource that changed after client reviewed it.

## 25.5 Rule

Require `If-Match` for dangerous deletes.

---

# 26. Create If Absent with `If-None-Match: *`

## 26.1 Example

```http
PUT /documents/D001
If-None-Match: *
Content-Type: application/json

{ ... }
```

Meaning:

```text
Create only if D001 does not already exist.
```

## 26.2 If exists

```http
412 Precondition Failed
```

## 26.3 If absent

```http
201 Created
Location: /documents/D001
ETag: "v1"
```

## 26.4 Use cases

- client-chosen IDs;
- idempotent create;
- avoiding accidental overwrite.

## 26.5 Rule

`If-None-Match: *` is standard create-if-absent semantics.

---

# 27. Designing ETag Values

ETag should be:

- stable for same representation;
- changes when representation changes;
- opaque to clients;
- safe to expose;
- efficiently computable;
- compatible with selected representation;
- optionally strong/weak.

## 27.1 Bad ETag

```http
ETag: "updatedAt=2026-06-12T..."
```

Client may parse/couple.

## 27.2 Better

```http
ETag: "c-001-v7"
```

or signed/hashed:

```http
ETag: "pZ1l9a..."
```

## 27.3 Security

Do not expose sensitive internal version if it leaks business information.

## 27.4 Rule

ETag should be opaque and intentionally generated.

---

# 28. Version-Based ETag

## 28.1 Source

Database version column.

```java
@Version
long version;
```

ETag:

```java
new EntityTag("customer-" + id + "-v" + version);
```

## 28.2 Pros

- cheap;
- reliable;
- good for concurrency;
- aligns with optimistic locking.

## 28.3 Cons

- may not reflect representation variations;
- leaks update count if readable;
- aggregate child changes need combined version.

## 28.4 Good for

Mutable single-resource APIs.

## 28.5 Rule

Version-based ETag is excellent for lost-update prevention.

---

# 29. Hash-Based ETag

## 29.1 Source

Hash response bytes or canonical representation.

```text
ETag = sha256(canonical-json)
```

## 29.2 Pros

- accurate for representation;
- changes when content changes.

## 29.3 Cons

- expensive for large responses;
- canonicalization hard;
- if computed after serialization, hard to set before response without buffering;
- compression/content negotiation complexity.

## 29.4 Use for

- static/generated resources;
- small responses;
- content-addressed documents.

## 29.5 Rule

Hash ETag is accurate but can be expensive and tricky with streaming.

---

# 30. Timestamp-Based ETag

## 30.1 Source

UpdatedAt timestamp.

```java
new EntityTag("customer-" + updatedAtEpochSecond)
```

## 30.2 Pros

- simple;
- often available.

## 30.3 Cons

- precision issues;
- clock skew;
- concurrent updates in same second;
- not ideal for high-write systems.

## 30.4 Better

Use version column.

## 30.5 Rule

Timestamp ETag is acceptable for low-risk resources, not ideal for concurrency-critical writes.

---

# 31. Composite ETag for Aggregates

Resource representation may include child objects.

## 31.1 Example

Customer detail includes:

- customer profile;
- addresses;
- active licences;
- summary counts.

If any changes, detail representation changes.

## 31.2 Composite version

```text
customer.version
addresses.maxVersion
licences.maxVersion
```

ETag can hash these.

## 31.3 Avoid expensive full body hash

Use aggregate version/materialized projection version.

## 31.4 Rule

ETag must reflect all data that affects selected representation.

---

# 32. ETag and Content Negotiation

Same resource can have multiple representations.

```http
Accept: application/json
Accept-Language: id-ID
```

## 32.1 Representation-specific validator

If English and Indonesian response differ, ETag should differ or `Vary` should be correct and validator scoped.

## 32.2 Headers

```http
Vary: Accept, Accept-Language
```

## 32.3 Same version, different representation

Domain version can be same but representation bytes differ.

For strong ETag, representation matters.

## 32.4 Rule

ETag belongs to selected representation, not abstract resource only.

---

# 33. ETag and Compression / Content-Encoding

If response is compressed, bytes differ.

## 33.1 Strong ETag issue

Strong ETag for uncompressed bytes may not be strong for compressed bytes.

## 33.2 Options

- compute ETag per content-encoded representation;
- use weak ETag for semantic equivalence;
- let gateway handle ETag/compression consistently;
- set `Vary: Accept-Encoding`.

## 33.3 Gateway risk

CDN/gateway may compress or transform and weaken/alter ETags.

## 33.4 Rule

Coordinate ETag semantics with compression layer.

---

# 34. ETag and Authorization / User-Specific Representations

Same resource can render differently per user.

Example:

- admin sees internal notes;
- normal user does not.

## 34.1 Different representations

ETag should differ or cache should be private and keyed by user.

## 34.2 Cache-Control

```http
Cache-Control: private, no-cache
```

or `no-store` for sensitive.

## 34.3 Vary Authorization?

Usually responses to authenticated requests are not shared-cacheable unless carefully designed.

## 34.4 Rule

Do not share-cache user-specific representations accidentally.

---

# 35. Cache-Control with Validators

Validators enable revalidation, but freshness is controlled by `Cache-Control`.

## 35.1 Example revalidate every time

```http
Cache-Control: private, no-cache
ETag: "v7"
```

`no-cache` means cache may store but must revalidate before reuse.

## 35.2 Example short freshness

```http
Cache-Control: private, max-age=60
```

## 35.3 Example sensitive

```http
Cache-Control: no-store
```

Do not store.

## 35.4 Rule

ETag without Cache-Control may not express desired caching policy.

---

# 36. Private vs Public Cache

## 36.1 Public

Shared caches may store.

```http
Cache-Control: public, max-age=300
```

Use for public data.

## 36.2 Private

Only private user agent cache may store.

```http
Cache-Control: private, max-age=60
```

Use for user-specific data that can be cached by browser but not shared proxy.

## 36.3 Authenticated responses

Default conservative approach:

```http
Cache-Control: private, no-cache
```

or:

```http
no-store
```

for sensitive.

## 36.4 Rule

Public cache + authenticated personalized response is dangerous unless carefully designed.

---

# 37. `no-cache` vs `no-store`

## 37.1 `no-cache`

Misleading name.

Means cache may store, but must revalidate before reuse.

Good with ETag.

```http
Cache-Control: no-cache
```

## 37.2 `no-store`

Cache must not store request/response.

Use for sensitive data.

```http
Cache-Control: no-store
```

## 37.3 Difference

`no-cache` can still use 304 revalidation.

`no-store` prevents storage and revalidation.

## 37.4 Rule

Use `no-store` for highly sensitive data; use `no-cache` for revalidation-required cacheable data.

---

# 38. `must-revalidate`, `max-age`, `s-maxage`

## 38.1 `max-age`

Fresh lifetime for caches.

```http
Cache-Control: max-age=60
```

## 38.2 `s-maxage`

Shared cache override.

```http
Cache-Control: public, max-age=60, s-maxage=300
```

## 38.3 `must-revalidate`

Cache must not serve stale after expiration without successful validation.

## 38.4 Rule

Use cache directives deliberately; defaults vary by clients/proxies.

---

# 39. Vary Header

`Vary` tells caches which request headers affect representation selection.

## 39.1 Examples

```http
Vary: Accept
Vary: Accept-Language
Vary: Accept-Encoding
Vary: Origin
```

## 39.2 Why important

If cache ignores `Accept-Language`, Indonesian response might be served to English client.

## 39.3 Authorization

Usually avoid shared caching of auth-specific responses.

## 39.4 Rule

If representation varies by request header, set `Vary`.

---

# 40. Conditional Requests for Collections

Collections are harder than single resources.

## 40.1 Example

```http
GET /customers?status=active&limit=20
ETag: "customers-status-active-page1-v42"
```

## 40.2 What changes ETag?

- item added/removed;
- item updated;
- ordering changes;
- filter result changes;
- user authorization changes.

## 40.3 Expensive

Exact collection validator can be expensive.

## 40.4 Good candidates

- small reference data;
- catalogs;
- lookup lists;
- stable user-independent collections.

## 40.5 Rule

Collection ETags are useful only when you can define and compute them cheaply.

---

# 41. Conditional Requests for Search/List Responses

Search/list responses depend on:

- query params;
- sorting;
- pagination;
- authorization;
- search index version;
- language;
- projection.

## 41.1 ETag must include query shape

A response for:

```http
?status=open
```

must not validate:

```http
?status=closed
```

## 41.2 Cursor pages

ETag for cursor page may be less valuable because cursor already represents continuation.

## 41.3 Search index eventual consistency

ETag may be based on index snapshot/version.

## 41.4 Rule

Do not add collection/search ETags blindly. Define semantics first.

---

# 42. Optimistic Concurrency in Application Service

HTTP preconditions are boundary mechanism.

Persistence must still enforce concurrency.

## 42.1 Race

1. Request A checks ETag v7.
2. Request B updates to v8.
3. Request A writes based on v7.

If no DB-level check, lost update still possible.

## 42.2 DB condition

```sql
UPDATE customer
SET display_name = ?, version = version + 1
WHERE id = ?
  AND version = ?
```

If row count 0 → concurrency failure.

## 42.3 JPA

Use `@Version`.

## 42.4 Rule

HTTP `If-Match` should map to atomic version check in persistence.

---

# 43. JPA `@Version` and HTTP ETag

## 43.1 Entity

```java
@Entity
public class CustomerEntity {
    @Id
    private UUID id;

    @Version
    private long version;
}
```

## 43.2 ETag

```java
EntityTag etag = new EntityTag("customer-" + id + "-v" + version);
```

## 43.3 Update

Client sends `If-Match`.

Service verifies expected version.

JPA also verifies on commit.

## 43.4 Exception mapping

`OptimisticLockException` maps to:

```text
412 Precondition Failed
```

if tied to HTTP precondition, or 409 if detected as domain conflict without precondition.

## 43.5 Rule

Expose version via opaque ETag, not necessarily raw version field.

---

# 44. Strong Consistency vs Eventual Consistency

## 44.1 Strong read/write resource

ETag is straightforward.

## 44.2 Eventual read model

GET reads projection that lags command write.

After PATCH returns v8, GET projection may still show v7 briefly.

## 44.3 Solutions

- read-your-write consistency for resource;
- return command result from write model;
- expose operation status;
- document eventual consistency;
- avoid ETag until projection catches up.

## 44.4 Rule

ETag semantics must match consistency model.

---

# 45. Weak Validators for Expensive Representations

Weak ETags can represent semantic equivalence.

## 45.1 Example

```http
ETag: W/"report-2026-06-summary-v3"
```

## 45.2 Use for

- dashboards;
- approximate reports;
- generated summaries.

## 45.3 Do not use for

- `If-Match` lost-update prevention;
- byte range correctness;
- exact file identity.

## 45.4 Rule

Weak validators are for cache efficiency, not write concurrency safety.

---

# 46. Clock Precision and Last-Modified Pitfalls

HTTP dates are second precision.

## 46.1 Problem

Two updates in same second can have same Last-Modified.

Client using `If-Unmodified-Since` may accidentally pass.

## 46.2 DB precision

DB may store microseconds/nanoseconds.

## 46.3 Truncation

If you send HTTP date truncated to seconds, compare consistently.

## 46.4 Clock skew

Multiple app nodes with unsynchronized clocks can generate wrong times.

## 46.5 Rule

Do not rely on Last-Modified alone for high-concurrency writes.

---

# 47. HTTP Date Parsing and Time Zones

HTTP dates use GMT/UTC textual format.

## 47.1 Java

Use `Instant` internally.

Convert to `Date` for JAX-RS APIs where needed.

```java
Date.from(instant)
```

## 47.2 Avoid local timezone

Do not use server local time for semantics.

## 47.3 Parsing

Let runtime parse conditional headers where possible.

## 47.4 Rule

Store UTC instants; output HTTP dates via runtime.

---

# 48. 304 Response Body and Headers

304 must not include a message body.

## 48.1 Include metadata

Include headers that would update cached response metadata:

- ETag;
- Last-Modified;
- Cache-Control;
- Expires;
- Vary;
- maybe Content-Location.

## 48.2 Do not include entity

```java
return preconditions.build();
```

not with entity.

## 48.3 JAX-RS

`evaluatePreconditions` returns response builder for not modified/precondition responses.

## 48.4 Rule

304 is metadata-only revalidation response.

---

# 49. Response Codes Cheat Sheet

## 49.1 200 OK

Resource returned.

## 49.2 304 Not Modified

Conditional GET/HEAD validator matched; cached representation still valid.

## 49.3 412 Precondition Failed

Precondition header present but evaluated false.

## 49.4 428 Precondition Required

Server requires a precondition header but request omitted it.

## 49.5 409 Conflict

Domain/application state conflict not specifically HTTP precondition failure.

## 49.6 201 Created

Create-if-absent succeeded.

## 49.7 Rule

Use precise status. Clients behave differently.

---

# 50. Problem Details for Concurrency Errors

## 50.1 428

```json
{
  "type": "https://api.example.com/problems/precondition-required",
  "title": "Precondition required",
  "status": 428,
  "code": "PRECONDITION_REQUIRED",
  "detail": "This operation requires If-Match.",
  "requiredHeaders": ["If-Match"],
  "correlationId": "..."
}
```

## 50.2 412

```json
{
  "type": "https://api.example.com/problems/precondition-failed",
  "title": "Precondition failed",
  "status": 412,
  "code": "PRECONDITION_FAILED",
  "detail": "The resource has changed since the client retrieved it.",
  "correlationId": "..."
}
```

## 50.3 Do not expose current ETag?

Maybe include current ETag in response header, but be careful if representation/user-specific.

## 50.4 Rule

Concurrency errors should tell client how to recover: re-fetch, merge, retry with current ETag.

---

# 51. Security Considerations

## 51.1 ETag tracking

ETags can be abused for user tracking if long-lived and user-specific across origins.

Use proper cache/privacy controls.

## 51.2 Sensitive resources

Use:

```http
Cache-Control: no-store
```

for highly sensitive content.

## 51.3 Authorization-specific representation

Do not public-cache.

## 51.4 ETag leakage

Avoid exposing internal sequential versions if sensitive.

## 51.5 Timing

304 vs 404/403 can leak existence if unauthenticated/unauthorized checks are not ordered correctly.

## 51.6 Rule

Authorization comes before conditional response for protected resources.

---

# 52. Observability

## 52.1 Metrics

```text
http_conditional_requests_total{method,route,condition}
http_304_total{route}
http_412_total{route}
http_428_total{route}
etag_mismatch_total{resource}
cache_revalidation_hit_ratio{route}
```

## 52.2 Logs

Log:

- route template;
- method;
- status;
- condition header presence;
- ETag match/mismatch category;
- correlation ID.

Do not log raw personalized ETags if sensitive.

## 52.3 Traces

Add events:

```text
precondition.evaluated
precondition.failed
cache.revalidated
```

## 52.4 Rule

Measure whether validators actually reduce payload and prevent conflicts.

---

# 53. Testing Conditional Requests

## 53.1 GET ETag tests

1. GET returns 200 + ETag.
2. GET with matching `If-None-Match` returns 304 no body.
3. GET with stale `If-None-Match` returns 200 + new body.

## 53.2 Last-Modified tests

- matching If-Modified-Since → 304;
- older date → 200;
- precision boundary.

## 53.3 PATCH/PUT tests

- missing If-Match → 428 if required;
- stale If-Match → 412;
- current If-Match → update + new ETag.

## 53.4 DELETE tests

- stale If-Match → 412;
- current If-Match → 204.

## 53.5 Race tests

Concurrent update must not lost-update even if two requests pass early check.

## 53.6 Cache header tests

- Cache-Control;
- Vary;
- ETag;
- Last-Modified;
- 304 metadata.

## 53.7 Rule

Test both HTTP behavior and persistence-level race behavior.

---

# 54. OpenAPI Documentation

## 54.1 Document ETag response header

```yaml
headers:
  ETag:
    schema:
      type: string
```

## 54.2 Document If-Match request header

```yaml
parameters:
  - name: If-Match
    in: header
    required: true
    schema:
      type: string
```

## 54.3 Document responses

- 200/204 success;
- 304 for conditional GET;
- 412 precondition failed;
- 428 precondition required.

## 54.4 Document cache policy

Explain whether representation is private/public/no-store.

## 54.5 Rule

Concurrency contract must appear in API docs, not just backend code.

---

# 55. Runtime Differences and Implementation Notes

## 55.1 JAX-RS implementations

`Request.evaluatePreconditions` should follow spec, but edge cases around date precision can vary.

## 55.2 Date precision

Test on target runtime.

## 55.3 Compression layer

If gateway changes content encoding/ETags, app tests alone are insufficient.

## 55.4 Client behavior

Browsers/caches/proxies may revalidate differently depending cache directives.

## 55.5 Rule

Test conditional requests through deployed stack if gateway/CDN involved.

---

# 56. Common Failure Modes

## 56.1 Weak ETag used for If-Match

Concurrency bug.

## 56.2 ETag does not change when representation changes

Stale cache.

## 56.3 ETag changes every request

Cache never works.

## 56.4 Missing Vary

Wrong representation cached.

## 56.5 Last-Modified precision bug

Lost update.

## 56.6 304 includes body

Protocol violation.

## 56.7 Missing metadata headers on 304

Cache metadata stale.

## 56.8 If-Match checked before authorization

Information leak.

## 56.9 HTTP precondition checked but DB update not atomic

Race/lost update.

## 56.10 Public cache for personalized data

Data leak.

## 56.11 Exact body hash ETag forces buffering large stream

Memory/performance problem.

## 56.12 409 used for all stale writes

Client cannot distinguish missing/stale precondition.

---

# 57. Best Practices

## 57.1 Send ETag for mutable resources

Especially resources updated by clients.

## 57.2 Use strong ETag for writes

Lost-update prevention requires strong validator.

## 57.3 Require If-Match for critical PUT/PATCH/DELETE

Return 428 if missing.

## 57.4 Return 412 for stale validators

Do not apply write.

## 57.5 Pair HTTP preconditions with DB optimistic locking

No race windows.

## 57.6 Use Cache-Control deliberately

ETag alone is not cache policy.

## 57.7 Include Vary when representation varies

Content negotiation and authorization matter.

## 57.8 Prefer version-based ETag for domain resources

Cheap and safe.

## 57.9 Test through runtime/gateway

Especially compression/CDN.

## 57.10 Document recovery flow

Client should re-fetch/merge/retry.

---

# 58. Anti-Patterns

## 58.1 `ETag: UUID.randomUUID()` every response

Cache useless.

## 58.2 Raw database timestamp as only concurrency guard

Precision/skew bugs.

## 58.3 Exposing internal sequential version without thought

Potential information leak.

## 58.4 Using ETag but not checking If-Match on writes

Half implementation.

## 58.5 Checking If-Match only in controller, not DB

Race.

## 58.6 Cache-Control copied from static assets to auth API

Data leak.

## 58.7 Treating 304 as success with body

Wrong client behavior.

## 58.8 Using weak ETag for range/write semantics

Incorrect.

## 58.9 Collection ETag based on current time

Changes every request.

## 58.10 No tests for stale update

Lost update in production.

---

# 59. Production Checklist

## 59.1 Validators

- [ ] ETag generated for mutable resources.
- [ ] ETag semantics documented.
- [ ] Strong ETag used for write concurrency.
- [ ] Last-Modified added if meaningful.
- [ ] ETag changes when selected representation changes.
- [ ] ETag stable when representation unchanged.
- [ ] Vary set for negotiated representations.

## 59.2 Reads/cache

- [ ] Conditional GET supports `If-None-Match`.
- [ ] Conditional GET supports `If-Modified-Since` if Last-Modified sent.
- [ ] 304 has no body.
- [ ] 304 includes metadata headers.
- [ ] Cache-Control policy defined.
- [ ] Sensitive data uses no-store/private policy.

## 59.3 Writes/concurrency

- [ ] Critical PUT/PATCH/DELETE require `If-Match`.
- [ ] Missing `If-Match` returns 428.
- [ ] Stale `If-Match` returns 412.
- [ ] DB optimistic locking enforces same version atomically.
- [ ] New ETag returned after successful write.
- [ ] Conflict vs precondition errors differentiated.

## 59.4 Security

- [ ] Authorization before protected conditional response.
- [ ] Public caches not used for personalized data.
- [ ] ETag does not leak sensitive internals.
- [ ] Gateway/CDN behavior reviewed.
- [ ] Compression/ETag semantics consistent.

## 59.5 Testing

- [ ] 200→304 flow tested.
- [ ] stale revalidation tested.
- [ ] missing/stale If-Match tested.
- [ ] race condition tested.
- [ ] Last-Modified precision tested.
- [ ] CDN/gateway path tested if applicable.
- [ ] OpenAPI documents headers/statuses.

---

# 60. Latihan

## Latihan 1 — GET with ETag

Implement:

```http
GET /customers/{id}
```

Return:

```http
ETag
Cache-Control
```

Support:

```http
If-None-Match
```

Test 200 then 304.

## Latihan 2 — GET with Last-Modified

Add:

```http
Last-Modified
```

Support:

```http
If-Modified-Since
```

Test second-level precision.

## Latihan 3 — PATCH with If-Match

Require `If-Match`.

- missing → 428;
- stale → 412;
- current → update.

Return new ETag.

## Latihan 4 — DELETE with If-Match

Prevent stale delete.

Test concurrent update before delete.

## Latihan 5 — JPA Version Mapping

Use `@Version`.

Map version to ETag.

Ensure optimistic lock exception maps correctly.

## Latihan 6 — Compression and ETag

Enable gzip at gateway/app.

Verify ETag/Content-Encoding/Vary behavior.

Decide strong vs weak.

## Latihan 7 — Collection ETag

For small reference data:

```http
GET /countries
```

Implement stable ETag.

Test 304.

## Latihan 8 — Problem Details

Implement `PreconditionRequiredExceptionMapper` and `PreconditionFailedExceptionMapper`.

Use codes:

```text
PRECONDITION_REQUIRED
PRECONDITION_FAILED
```

## Latihan 9 — Race Test

Two clients read v1.

Both PATCH with If-Match v1.

Only one succeeds; other gets 412 or optimistic lock mapped to 412.

---

# 61. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 — `Request` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/request

2. Jakarta RESTful Web Services 4.0 — `EntityTag` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/entitytag

3. Jakarta RESTful Web Services 4.0 — `Response` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/response

4. Jakarta RESTful Web Services 4.0 — `CacheControl` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/cachecontrol

5. RFC 9110 — HTTP Semantics  
   https://www.rfc-editor.org/rfc/rfc9110.html

6. RFC 9111 — HTTP Caching  
   https://www.rfc-editor.org/rfc/rfc9111.html

7. RFC 6585 — Additional HTTP Status Codes  
   https://httpwg.org/specs/rfc6585.html

8. MDN — ETag  
   https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag

9. MDN — If-None-Match  
   https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/If-None-Match

10. MDN — If-Modified-Since  
    https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/If-Modified-Since

---

# 62. Penutup

Conditional request adalah salah satu fitur HTTP yang paling penting untuk API yang matang.

Mental model final:

```text
Server sends validator:
  ETag / Last-Modified

Client sends condition:
  If-None-Match / If-Modified-Since / If-Match / If-Unmodified-Since

Server evaluates:
  unchanged read → 304
  stale write → 412
  missing required condition → 428
  current write → apply and return new validator
```

Prinsip final:

```text
ETag is not decoration.
It is a version contract.
```

Dan:

```text
Cache revalidation improves efficiency.
If-Match prevents lost updates.
DB optimistic locking closes race windows.
Cache-Control decides storage/freshness.
Vary protects negotiated representations.
```

Top-tier JAX-RS engineer memastikan:

- ETag semantics jelas;
- validator stabil dan berubah pada waktu yang tepat;
- write operations punya `If-Match`;
- 428/412/409 dipakai secara berbeda;
- `Request.evaluatePreconditions` dimanfaatkan dengan benar;
- concurrency tetap aman di persistence layer;
- cache policy tidak membocorkan data;
- gateway/compression/CDN tidak merusak validator semantics;
- semua flow diuji.

Part berikutnya:

```text
Bagian 023 — Hypermedia and Links: Link, HATEOAS, and Practical REST Maturity
```

Kita akan membahas `Link`, link relations, `Location`, `Content-Location`, affordances, HATEOAS pragmatis, pagination links, action links, and when hypermedia is useful vs over-engineered.
