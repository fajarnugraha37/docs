# learn-jaxrs-advanced-part-011.md

# Bagian 011 — Content Negotiation Deep Dive: `@Consumes`, `@Produces`, `MediaType`, `Variant`, `Accept`, `Content-Type`, `q/qs`, `Vary`, dan Debugging `406/415`

> Target pembaca: Java/Jakarta engineer yang ingin memahami **content negotiation** di JAX-RS/Jakarta REST secara mendalam. Fokus part ini bukan hanya “pasang `@Produces(MediaType.APPLICATION_JSON)`”, tetapi memahami bagaimana client dan server menyepakati representasi, bagaimana `Content-Type` berbeda dari `Accept`, bagaimana JAX-RS memilih resource method/provider, bagaimana `q` dan `qs` mempengaruhi preferensi, kapan `406`/`415` terjadi, kapan memakai `Variant`, serta bagaimana `Vary` menjaga cache/proxy tetap benar.
>
> Namespace utama: `jakarta.ws.rs.Consumes`, `jakarta.ws.rs.Produces`, `jakarta.ws.rs.core.MediaType`, `jakarta.ws.rs.core.Variant`, `jakarta.ws.rs.core.Request`, `jakarta.ws.rs.core.HttpHeaders`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Representation Negotiation, Bukan Sekadar JSON](#2-mental-model-representation-negotiation-bukan-sekadar-json)
3. [Content Negotiation dalam HTTP](#3-content-negotiation-dalam-http)
4. [Request Entity Negotiation vs Response Entity Negotiation](#4-request-entity-negotiation-vs-response-entity-negotiation)
5. [`Content-Type`: Apa yang Client Kirim](#5-content-type-apa-yang-client-kirim)
6. [`Accept`: Apa yang Client Mau Terima](#6-accept-apa-yang-client-mau-terima)
7. [`@Consumes`: Server Menerima Request Media Type](#7-consumes-server-menerima-request-media-type)
8. [`@Produces`: Server Menghasilkan Response Media Type](#8-produces-server-menghasilkan-response-media-type)
9. [Class-Level vs Method-Level `@Consumes/@Produces`](#9-class-level-vs-method-level-consumesproduces)
10. [Method Matching dan Media Type Filtering](#10-method-matching-dan-media-type-filtering)
11. [`415 Unsupported Media Type`: Kapan Terjadi](#11-415-unsupported-media-type-kapan-terjadi)
12. [`406 Not Acceptable`: Kapan Terjadi](#12-406-not-acceptable-kapan-terjadi)
13. [`MediaType`: Type, Subtype, Parameters, Wildcard](#13-mediatype-type-subtype-parameters-wildcard)
14. [Media Type Compatibility: `application/json`, `application/*`, `*/*`](#14-media-type-compatibility-applicationjson-application--star)
15. [Structured Syntax Suffix: `+json`, `+xml`](#15-structured-syntax-suffix-json-xml)
16. [`q` Client Preference di `Accept`](#16-q-client-preference-di-accept)
17. [`qs` Server Preference di `@Produces`](#17-qs-server-preference-di-produces)
18. [Specificity, Quality, dan Tie-Breaking](#18-specificity-quality-dan-tie-breaking)
19. [Default `Accept` dan Browser `Accept` Header](#19-default-accept-dan-browser-accept-header)
20. [Content Negotiation by Header vs Path Suffix vs Query Param](#20-content-negotiation-by-header-vs-path-suffix-vs-query-param)
21. [`Vary`: Kenapa Cache/Proxy Harus Tahu Variasi Response](#21-vary-kenapa-cacheproxy-harus-tahu-variasi-response)
22. [`Vary: Accept`, `Vary: Accept-Language`, `Vary: Accept-Encoding`](#22-vary-accept-vary-accept-language-vary-accept-encoding)
23. [`HttpHeaders`: Membaca Negotiation Metadata](#23-httpheaders-membaca-negotiation-metadata)
24. [`Request#selectVariant`: Dynamic Variant Selection](#24-requestselectvariant-dynamic-variant-selection)
25. [`Variant`: Media Type, Language, Encoding](#25-variant-media-type-language-encoding)
26. [Language Negotiation: `Accept-Language`](#26-language-negotiation-accept-language)
27. [Encoding Negotiation: `Accept-Encoding`](#27-encoding-negotiation-accept-encoding)
28. [Charset: Kenapa Jarang Dipakai untuk JSON Modern](#28-charset-kenapa-jarang-dipakai-untuk-json-modern)
29. [JSON, JSON-B, JSON-P, Jackson, dan Provider Selection](#29-json-json-b-jsonp-jackson-dan-provider-selection)
30. [XML Negotiation dan Jakarta REST 4.0 JAXB Removal](#30-xml-negotiation-dan-jakarta-rest-40-jaxb-removal)
31. [Binary/File Negotiation: PDF, CSV, ZIP, Octet Stream](#31-binaryfile-negotiation-pdf-csv-zip-octet-stream)
32. [Problem Details: `application/problem+json`](#32-problem-details-applicationproblemjson)
33. [Vendor Media Types dan API Versioning](#33-vendor-media-types-dan-api-versioning)
34. [Negotiation dalam Resource Method Design](#34-negotiation-dalam-resource-method-design)
35. [Satu Method Banyak Media vs Banyak Method Satu Media](#35-satu-method-banyak-media-vs-banyak-method-satu-media)
36. [Negotiation dan `MessageBodyReader/Writer`](#36-negotiation-dan-messagebodyreaderwriter)
37. [Negotiation dan OpenAPI](#37-negotiation-dan-openapi)
38. [Debugging `415`](#38-debugging-415)
39. [Debugging `406`](#39-debugging-406)
40. [Testing Content Negotiation](#40-testing-content-negotiation)
41. [Observability: Metrics untuk Media Type dan Negotiation Errors](#41-observability-metrics-untuk-media-type-dan-negotiation-errors)
42. [Security Considerations](#42-security-considerations)
43. [Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus](#43-runtime-differences-jersey-resteasy-cxf-liberty-quarkus)
44. [Common Failure Modes](#44-common-failure-modes)
45. [Best Practices](#45-best-practices)
46. [Anti-Patterns](#46-anti-patterns)
47. [Production Checklist](#47-production-checklist)
48. [Latihan](#48-latihan)
49. [Referensi Resmi](#49-referensi-resmi)
50. [Penutup](#50-penutup)

---

# 1. Tujuan Part Ini

Content negotiation adalah proses saat client dan server menyepakati representasi data yang dikirim dan diterima.

Contoh sederhana:

```http
POST /customers
Content-Type: application/json
Accept: application/json
```

Artinya:

```text
Request body yang client kirim berbentuk JSON.
Client ingin response dalam JSON.
```

Di resource JAX-RS:

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public Response create(CreateCustomerRequest request) {
    ...
}
```

Namun di production, negotiation lebih kompleks:

```http
Accept: application/json;q=0.9, application/xml;q=0.5, */*;q=0.1
Accept-Language: id-ID,id;q=0.9,en-US;q=0.7
Accept-Encoding: gzip, br
Content-Type: application/merge-patch+json
```

## 1.1 Kenapa ini penting?

Karena error berikut sering membingungkan:

```text
415 Unsupported Media Type
406 Not Acceptable
MessageBodyReader not found
MessageBodyWriter not found
Wrong method selected
Browser gets HTML instead of JSON
Cache serves XML to JSON client
```

## 1.2 Target pemahaman

Setelah part ini, kamu bisa:

- membedakan `Content-Type` dan `Accept`;
- menjelaskan `@Consumes` dan `@Produces`;
- mendebug `415` dan `406`;
- memahami `MediaType`, wildcard, parameters;
- memahami `q` dan `qs`;
- memakai `Variant` dan `Request#selectVariant`;
- menentukan kapan perlu `Vary`;
- mendesain endpoint yang support JSON/CSV/PDF/XML dengan benar;
- menulis test negotiation yang kuat.

---

# 2. Mental Model: Representation Negotiation, Bukan Sekadar JSON

REST berbicara tentang resource dan representation.

Resource:

```text
Customer CUST-000001
```

Representation bisa:

```text
application/json
application/xml
text/csv
application/pdf
```

## 2.1 Resource sama, representasi berbeda

```http
GET /customers/CUST-000001
Accept: application/json
```

Response JSON.

```http
GET /customers/CUST-000001
Accept: application/xml
```

Response XML jika didukung.

## 2.2 URI bukan selalu format

Satu URI bisa punya banyak representation.

Namun dalam banyak enterprise API, kita memilih JSON saja untuk simplicity.

## 2.3 Negotiation direction

Ada dua arah:

```text
Client → Server: Content-Type / @Consumes / MessageBodyReader
Server → Client: Accept / @Produces / MessageBodyWriter
```

## 2.4 Top-tier rule

```text
Do not treat JSON as default magic.
Treat media type as part of the API contract.
```

---

# 3. Content Negotiation dalam HTTP

HTTP content negotiation memungkinkan client menyatakan preferensi representation.

Headers yang umum:

```http
Accept
Accept-Language
Accept-Encoding
```

Server memilih representation yang paling sesuai jika tersedia.

## 3.1 Proactive negotiation

Client mengirim preference di request.

Server memilih response.

Contoh:

```http
Accept: application/json
Accept-Language: id-ID
```

## 3.2 Reactive negotiation

Server bisa memberi pilihan kepada client, misalnya response 300 atau links ke variants.

Jarang dipakai di REST API enterprise.

## 3.3 Representation metadata

Response biasanya menyatakan:

```http
Content-Type: application/json
Content-Language: id-ID
Content-Encoding: gzip
```

## 3.4 Cache correctness

Jika response berbeda berdasarkan `Accept`, cache perlu tahu melalui:

```http
Vary: Accept
```

## 3.5 JAX-RS mapping

JAX-RS menghubungkan HTTP negotiation dengan:

```java
@Consumes
@Produces
MediaType
Variant
Request#selectVariant
HttpHeaders
MessageBodyReader
MessageBodyWriter
```

---

# 4. Request Entity Negotiation vs Response Entity Negotiation

## 4.1 Request entity negotiation

Client mengirim body dengan media type:

```http
Content-Type: application/json
```

Server method harus bisa consume:

```java
@Consumes(MediaType.APPLICATION_JSON)
```

Runtime butuh `MessageBodyReader`.

Failure:

```text
415 Unsupported Media Type
```

## 4.2 Response entity negotiation

Client mengirim:

```http
Accept: application/json
```

Server method harus bisa produce:

```java
@Produces(MediaType.APPLICATION_JSON)
```

Runtime butuh `MessageBodyWriter`.

Failure:

```text
406 Not Acceptable
```

or writer failure later if method selected but provider missing.

## 4.3 Example

```java
@POST
@Consumes("application/json")
@Produces("application/json")
public CustomerResponse create(CreateCustomerRequest request) { ... }
```

## 4.4 Direction diagram

```text
Request body:
  Content-Type → @Consumes → MessageBodyReader → Java object

Response body:
  Accept → @Produces → Java return value → MessageBodyWriter → Content-Type
```

## 4.5 Debugging implication

`415` and `406` are different.

Do not treat both as “JSON error”.

---

# 5. `Content-Type`: Apa yang Client Kirim

`Content-Type` describes media type of request body.

## 5.1 JSON body

```http
Content-Type: application/json
```

## 5.2 Merge Patch

```http
Content-Type: application/merge-patch+json
```

## 5.3 Multipart

```http
Content-Type: multipart/form-data; boundary=...
```

## 5.4 Plain text

```http
Content-Type: text/plain; charset=UTF-8
```

## 5.5 No body

GET usually has no request body, so `Content-Type` is irrelevant.

## 5.6 Missing Content-Type

If request has body but no `Content-Type`, server behavior may be undesirable/implementation-specific.

Define policy.

## 5.7 Top-tier rule

```text
If client sends a body, Content-Type must tell the truth.
```

Do not sniff content as substitute for contract.

---

# 6. `Accept`: Apa yang Client Mau Terima

`Accept` declares media types acceptable for response.

## 6.1 JSON

```http
Accept: application/json
```

## 6.2 Multiple accepted types

```http
Accept: application/json, application/xml;q=0.5
```

## 6.3 Wildcard

```http
Accept: */*
```

means client accepts any media type.

## 6.4 Missing Accept

HTTP semantics treats missing `Accept` broadly; server can send its default representation.

## 6.5 Browser Accept

Browser often sends broad and HTML-biased Accept.

Example style:

```text
text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
```

If API should return JSON, clients should explicitly send:

```http
Accept: application/json
```

## 6.6 API client policy

Require API clients to send `Accept: application/json` if contract demands.

## 6.7 Rule

`Accept` is response preference; it is not the request body's type.

---

# 7. `@Consumes`: Server Menerima Request Media Type

`@Consumes` declares media types a resource method/class/provider accepts.

## 7.1 Example

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response create(CreateCustomerRequest request) { ... }
```

## 7.2 Multiple

```java
@Consumes({
    MediaType.APPLICATION_JSON,
    "application/merge-patch+json"
})
```

## 7.3 Class-level

```java
@Path("/customers")
@Consumes(MediaType.APPLICATION_JSON)
public class CustomerResource { ... }
```

## 7.4 Method override

Method-level `@Consumes` overrides class-level for that method.

## 7.5 Provider-level

Entity providers can declare `@Consumes` too.

## 7.6 Best practice

For body-bearing endpoints, be explicit.

```java
@Consumes(MediaType.APPLICATION_JSON)
```

## 7.7 Anti-pattern

Endpoint accepts everything:

```java
@Consumes("*/*")
```

unless intentionally generic upload/proxy.

---

# 8. `@Produces`: Server Menghasilkan Response Media Type

`@Produces` declares media types resource method/class/provider can produce.

## 8.1 Example

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public CustomerResponse get(...) { ... }
```

## 8.2 Multiple

```java
@Produces({
    MediaType.APPLICATION_JSON,
    MediaType.APPLICATION_XML
})
```

## 8.3 Class-level

```java
@Path("/customers")
@Produces(MediaType.APPLICATION_JSON)
public class CustomerResource { ... }
```

## 8.4 Method override

```java
@GET
@Path("/{id}/file")
@Produces("application/pdf")
public Response download(...) { ... }
```

## 8.5 Provider-level

`MessageBodyWriter` can declare `@Produces`.

## 8.6 Best practice

For JSON-only APIs, put class-level:

```java
@Produces(MediaType.APPLICATION_JSON)
```

and override for binary/download endpoints.

## 8.7 Rule

`@Produces` is part of external contract and method selection.

---

# 9. Class-Level vs Method-Level `@Consumes/@Produces`

## 9.1 Class-level default

```java
@Path("/orders")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class OrderResource {
    ...
}
```

All methods inherit unless overridden.

## 9.2 Method override

```java
@GET
@Path("/{id}/invoice")
@Produces("application/pdf")
public Response invoicePdf(...) { ... }
```

## 9.3 Override means replace, not merge

If method has `@Produces`, it overrides class-level `@Produces`.

So this method no longer produces class-level JSON unless included explicitly.

## 9.4 Common bug

```java
@Path("/reports")
@Produces(MediaType.APPLICATION_JSON)
public class ReportResource {

    @GET
    @Path("/{id}")
    @Produces("application/pdf")
    public ReportResponse get(...) { ... }
}
```

Developer expected JSON and PDF, but method produces only PDF.

## 9.5 Fix

```java
@Produces({
    MediaType.APPLICATION_JSON,
    "application/pdf"
})
```

or split endpoints.

## 9.6 Recommendation

Use class-level JSON defaults, method-level overrides only when intentionally different.

---

# 10. Method Matching dan Media Type Filtering

JAX-RS method selection includes media type filtering.

## 10.1 Stage concept

After path matching, runtime filters candidate methods by:

1. HTTP method.
2. Request `Content-Type` against `@Consumes`.
3. Request `Accept` against `@Produces`.

## 10.2 Same path different consumes

```java
@POST
@Consumes("application/json")
public Response createJson(CreateCustomerRequest request) { ... }

@POST
@Consumes("text/csv")
public Response createCsv(String csv) { ... }
```

## 10.3 Same path different produces

```java
@GET
@Produces("application/json")
public CustomerResponse getJson() { ... }

@GET
@Produces("application/pdf")
public Response getPdf() { ... }
```

## 10.4 No match consumes

```text
415
```

## 10.5 No match produces

```text
406
```

## 10.6 If method selected but provider missing

May become runtime writer/reader error.

Example: method produces XML but XML provider missing.

## 10.7 Debug rule

Always inspect:

```text
Content-Type
Accept
@Consumes
@Produces
reader/writer providers
```

---

# 11. `415 Unsupported Media Type`: Kapan Terjadi

`415` means server cannot consume request entity media type for the selected path/method.

## 11.1 Example

Resource:

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response create(CreateCustomerRequest request) { ... }
```

Request:

```http
POST /customers
Content-Type: text/plain
```

Result:

```text
415 Unsupported Media Type
```

## 11.2 Common causes

- wrong `Content-Type`;
- missing `Content-Type`;
- endpoint consumes different media;
- method-level override changed consumes;
- provider not registered;
- custom media type not included;
- multipart support missing.

## 11.3 Body is JSON but header wrong

Runtime trusts header, not content.

## 11.4 `+json`

If endpoint consumes `application/json`, does it automatically consume `application/merge-patch+json`?

Do not assume. Declare supported media explicitly.

## 11.5 Error response

Map to Problem Details:

```json
{
  "code": "UNSUPPORTED_MEDIA_TYPE",
  "status": 415,
  "supportedMediaTypes": ["application/json"]
}
```

## 11.6 Rule

`415` is about request body format.

---

# 12. `406 Not Acceptable`: Kapan Terjadi

`406` means server cannot produce a response acceptable under client `Accept`.

## 12.1 Example

Resource:

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public CustomerResponse get(...) { ... }
```

Request:

```http
GET /customers/C001
Accept: application/xml
```

Result:

```text
406 Not Acceptable
```

## 12.2 Common causes

- client sends strict unsupported `Accept`;
- endpoint only produces JSON;
- method-level `@Produces` overrides class-level;
- server lacks writer for requested media;
- browser sends unexpected Accept and method selection differs.

## 12.3 Missing Accept

Usually not a problem; server default acceptable.

## 12.4 Multiple candidates

Runtime picks best method/variant based on media preference.

## 12.5 Error response

Return supported media types if helpful.

```json
{
  "code": "NOT_ACCEPTABLE",
  "status": 406,
  "supportedMediaTypes": ["application/json"]
}
```

## 12.6 Rule

`406` is about response representation.

---

# 13. `MediaType`: Type, Subtype, Parameters, Wildcard

JAX-RS `MediaType` represents media type.

## 13.1 Structure

```text
type/subtype;parameter=value
```

Example:

```text
application/json;charset=UTF-8
```

## 13.2 Type

```text
application
text
image
multipart
```

## 13.3 Subtype

```text
json
xml
plain
pdf
octet-stream
```

## 13.4 Parameters

```text
charset=UTF-8
boundary=...
```

## 13.5 Wildcard

```text
*/*
application/*
```

## 13.6 Constants

```java
MediaType.APPLICATION_JSON
MediaType.APPLICATION_JSON_TYPE
MediaType.TEXT_PLAIN
MediaType.MULTIPART_FORM_DATA
MediaType.APPLICATION_OCTET_STREAM
```

String constants vs object constants.

## 13.7 Use object constant for builders

```java
MediaType.APPLICATION_JSON_TYPE
```

## 13.8 Rule

Media type is more than a string; parameters and wildcard matter.

---

# 14. Media Type Compatibility: `application/json`, `application/*`, `*/*`

## 14.1 Exact

```text
application/json
```

matches application/json.

## 14.2 Type wildcard

```text
application/*
```

matches:

```text
application/json
application/xml
application/pdf
```

## 14.3 Full wildcard

```text
*/*
```

matches anything.

## 14.4 Parameters

Parameters may affect compatibility and selection.

Example:

```text
application/json;charset=UTF-8
```

is compatible with:

```text
application/json
```

in typical media matching.

## 14.5 Practical caution

Do not rely on overly broad `@Produces("*/*")`.

It can select wrong writer/format.

## 14.6 Rule

Declare narrow media types at boundary; use wildcards only for generic infrastructure endpoints.

---

# 15. Structured Syntax Suffix: `+json`, `+xml`

Media types can use structured suffix.

Examples:

```text
application/problem+json
application/merge-patch+json
application/vnd.example.customer.v1+json
```

## 15.1 Meaning

The suffix indicates underlying representation structure.

`+json` means JSON-based.

## 15.2 JAX-RS matching

Do not assume `application/json` automatically matches every `application/*+json` in all contexts.

Declare explicitly:

```java
@Consumes({
    MediaType.APPLICATION_JSON,
    "application/merge-patch+json"
})
```

## 15.3 Providers

Some JSON providers can read `+json` media types if configured/declared.

Test.

## 15.4 Problem Details

```text
application/problem+json
```

should be used for error response body if adopting RFC 9457.

## 15.5 Vendor versioning

```text
application/vnd.example.customer.v2+json
```

can encode version in media type.

## 15.6 Rule

If your API supports structured suffix media, include it in contract and tests.

---

# 16. `q` Client Preference di `Accept`

Client can rank acceptable media types using `q`.

## 16.1 Example

```http
Accept: application/json;q=0.9, application/xml;q=0.5
```

Client prefers JSON.

## 16.2 Default q

If omitted, q is 1.0.

## 16.3 q=0

Means not acceptable.

```http
Accept: application/json;q=0
```

## 16.4 Wildcard preference

```http
Accept: application/json, */*;q=0.1
```

Prefer JSON, but accept fallback.

## 16.5 JAX-RS

Runtime uses `Accept` q values in method/variant selection.

## 16.6 Test

Negotiation tests should include q-values, not only exact Accept.

## 16.7 Rule

`q` is client-side preference; server should respect it when choosing representation.

---

# 17. `qs` Server Preference di `@Produces`

Server can express source quality with `qs` parameter.

## 17.1 Example

```java
@Produces({
    "application/json;qs=1.0",
    "application/xml;qs=0.5"
})
```

This says server prefers JSON over XML when client accepts both equally.

## 17.2 Use cases

- prefer JSON but support XML;
- prefer compact representation;
- prefer canonical media type.

## 17.3 Rare in everyday APIs

Most APIs use one media type.

## 17.4 Beware docs/tooling

OpenAPI and client docs may not expose `qs` clearly.

## 17.5 Recommendation

Use `qs` only if multiple variants share same endpoint and preference matters.

## 17.6 Rule

`q` is client preference; `qs` is server preference.

---

# 18. Specificity, Quality, dan Tie-Breaking

When multiple representations are possible, runtime considers:

- media compatibility;
- specificity;
- client q;
- server qs;
- method/provider priority;
- implementation-specific tie cases.

## 18.1 More specific beats wildcard

```text
application/json
```

is more specific than:

```text
application/*
```

## 18.2 Client preference

```text
application/xml;q=1.0
application/json;q=0.5
```

Client prefers XML.

## 18.3 Server preference

If client accepts both equally, server may prefer based on `qs`.

## 18.4 Ambiguity

If two methods are equally suitable, runtime may warn and choose implementation-dependently.

## 18.5 Avoid relying on obscure tie-breaks

Design clear media behavior.

## 18.6 Rule

If the team cannot predict chosen response media type, the endpoint is too ambiguous.

---

# 19. Default `Accept` dan Browser `Accept` Header

## 19.1 Missing Accept

No `Accept` usually means any representation acceptable.

Server sends default/best.

## 19.2 Browser

Browser often prefers HTML/XML but also accepts anything.

This can cause unexpected response if endpoint supports HTML and JSON.

## 19.3 API client

Use explicit:

```http
Accept: application/json
```

## 19.4 API gateway

Some gateways/clients add default Accept.

Check actual request.

## 19.5 Test no Accept

Your contract tests should specify what happens if no `Accept`.

## 19.6 Rule

For APIs, require/document explicit Accept for deterministic behavior.

---

# 20. Content Negotiation by Header vs Path Suffix vs Query Param

## 20.1 Header negotiation

```http
GET /reports/R001
Accept: application/pdf
```

RESTful and standard.

## 20.2 Path suffix

```http
GET /reports/R001.pdf
```

Human-friendly/download-friendly.

## 20.3 Query param

```http
GET /reports/R001?format=pdf
```

Simple but less HTTP-native.

## 20.4 Trade-off

Header negotiation is semantically clean but less visible.

Path/query format is easier for browser/manual use.

## 20.5 Avoid supporting all

Supporting:

```text
Accept
.format
?format=
```

increases complexity.

## 20.6 Recommendation

For API representation variants, use `Accept`.

For file download UX, consider dedicated subresource:

```text
/reports/{id}/file
```

with `Accept: application/pdf`.

## 20.7 Rule

Choose one primary negotiation mechanism and document it.

---

# 21. `Vary`: Kenapa Cache/Proxy Harus Tahu Variasi Response

If response representation varies by request headers, caches need to know which headers affect selection.

## 21.1 Example

Same URI:

```text
/customers/C001
```

can return JSON or XML depending on:

```http
Accept
```

Response should include:

```http
Vary: Accept
```

## 21.2 Without Vary

Cache might store XML response and serve it to JSON client.

## 21.3 Vary is cache contract

It says:

```text
Cache key must include these request header fields.
```

## 21.4 Common Vary headers

```http
Vary: Accept
Vary: Accept-Language
Vary: Accept-Encoding
```

## 21.5 Compression

If response compressed depending on `Accept-Encoding`, caches need `Vary: Accept-Encoding`.

Often server/gateway handles this.

## 21.6 Rule

If representation changes based on request header, set `Vary`.

---

# 22. `Vary: Accept`, `Vary: Accept-Language`, `Vary: Accept-Encoding`

## 22.1 Accept

Use when media type varies:

```http
Vary: Accept
```

## 22.2 Accept-Language

Use when language/localization changes response body:

```http
Vary: Accept-Language
```

## 22.3 Accept-Encoding

Use when content encoding changes:

```http
Vary: Accept-Encoding
```

Usually compression layer handles this.

## 22.4 Multiple

```http
Vary: Accept, Accept-Language
```

## 22.5 Be careful with Vary

Too many vary headers reduce cache efficiency.

## 22.6 Dynamic auth

If response varies by Authorization/Cookie, use private/no-store cache policies rather than casually `Vary: Authorization`.

## 22.7 Rule

Set Vary for negotiable public/cacheable representations; for user-specific data, also set proper cache control.

---

# 23. `HttpHeaders`: Membaca Negotiation Metadata

`HttpHeaders` provides parsed request header metadata.

## 23.1 Acceptable media

```java
@Context
HttpHeaders headers;

List<MediaType> acceptable = headers.getAcceptableMediaTypes();
```

Sorted by q preference.

## 23.2 Acceptable languages

```java
List<Locale> languages = headers.getAcceptableLanguages();
```

Sorted by q preference.

## 23.3 Request content type

```java
MediaType requestMedia = headers.getMediaType();
```

## 23.4 Header string

```java
String accept = headers.getHeaderString(HttpHeaders.ACCEPT);
```

## 23.5 Prefer helpers

Do not hand-parse `Accept` unless necessary.

## 23.6 Request scope

Methods throw `IllegalStateException` outside request scope.

## 23.7 Rule

Use `HttpHeaders` for advanced negotiation logic inside resource/provider.

---

# 24. `Request#selectVariant`: Dynamic Variant Selection

`Request#selectVariant` selects best response variant from server-provided list.

## 24.1 Example

```java
@GET
public Response get(@Context Request request) {
    List<Variant> variants = Variant
        .mediaTypes(
            MediaType.APPLICATION_JSON_TYPE,
            MediaType.APPLICATION_XML_TYPE
        )
        .languages(Locale.ENGLISH, Locale.forLanguageTag("id-ID"))
        .add()
        .build();

    Variant selected = request.selectVariant(variants);
    if (selected == null) {
        return Response.notAcceptable(variants).build();
    }

    Object entity = render(selected);
    return Response.ok(entity, selected)
        .build();
}
```

## 24.2 When useful

- one method dynamically chooses media/language;
- multiple languages;
- custom variant list;
- conditional requests with variants.

## 24.3 When not needed

Most APIs use `@Produces` and separate writer.

## 24.4 Null

If no acceptable variant, returns null.

## 24.5 Response helper

`Response.notAcceptable(variants)` can build 406 response.

## 24.6 Rule

Use `selectVariant` when variant selection is part of resource logic, not normal static `@Produces`.

---

# 25. `Variant`: Media Type, Language, Encoding

`Variant` represents one representation variant.

## 25.1 Components

- `MediaType`;
- `Locale` language;
- encoding.

## 25.2 Build variants

```java
List<Variant> variants = Variant
    .mediaTypes(MediaType.APPLICATION_JSON_TYPE)
    .languages(Locale.ENGLISH, Locale.forLanguageTag("id-ID"))
    .encodings("gzip")
    .add()
    .build();
```

## 25.3 Response with variant

```java
return Response.ok(entity, selectedVariant).build();
```

This can set appropriate metadata.

## 25.4 Vary

When variants are involved, response should reflect correct Vary behavior.

## 25.5 Complexity

Variant-based APIs are more complex to document/test.

## 25.6 Rule

Use `Variant` for genuine multi-dimensional negotiation; avoid if JSON-only.

---

# 26. Language Negotiation: `Accept-Language`

## 26.1 Header

```http
Accept-Language: id-ID,id;q=0.9,en-US;q=0.7
```

## 26.2 Use cases

- localized error messages;
- localized labels;
- localized documentation fields;
- human-readable reports.

## 26.3 Stable codes

Even if message localized, error code remains stable.

```json
{
  "code": "VALIDATION_FAILED",
  "title": "Validasi gagal"
}
```

## 26.4 Content-Language

Response can include:

```http
Content-Language: id-ID
```

## 26.5 Vary

If body varies by language:

```http
Vary: Accept-Language
```

## 26.6 Do not localize machine fields

Enum wire values, codes, JSON property names should remain stable.

## 26.7 Rule

Localize human text, not machine contract.

---

# 27. Encoding Negotiation: `Accept-Encoding`

## 27.1 Header

```http
Accept-Encoding: gzip, br
```

## 27.2 Usually infrastructure

Compression is often handled by server/gateway, not resource method.

## 27.3 Content-Encoding

Response:

```http
Content-Encoding: gzip
```

## 27.4 Vary

```http
Vary: Accept-Encoding
```

## 27.5 Application-level streaming

For file downloads, be careful not to double-compress already compressed formats:

- zip;
- pdf sometimes;
- images;
- video.

## 27.6 Rule

Let server/gateway handle compression unless application has special streaming needs.

---

# 28. Charset: Kenapa Jarang Dipakai untuk JSON Modern

## 28.1 Text media types

`text/plain` may use charset:

```http
Content-Type: text/plain; charset=UTF-8
```

## 28.2 JSON

Modern JSON is generally UTF-8 on the wire.

Avoid charset negotiation complexity for JSON APIs.

## 28.3 If accepting text

Declare and test encoding.

## 28.4 Incorrect charset

Client says ISO-8859-1 but sends UTF-8.

Parsing errors.

## 28.5 Recommendation

Use UTF-8 everywhere.

## 28.6 Rule

Charset is representation metadata; don't ignore it for text formats.

---

# 29. JSON, JSON-B, JSON-P, Jackson, dan Provider Selection

## 29.1 JAX-RS provider model

JSON serialization/deserialization is done by providers.

## 29.2 JSON-B

Jakarta JSON Binding is common in Jakarta EE.

## 29.3 JSON-P

Jakarta JSON Processing types such as `JsonObject` can be used for dynamic JSON.

## 29.4 Jackson

Common in many Java stacks; often added as implementation-specific provider.

## 29.5 Provider differences

- unknown field behavior;
- null inclusion;
- date format;
- enum format;
- records support;
- polymorphism;
- property naming;
- annotations.

## 29.6 Contract risk

Changing JSON provider can change wire format.

## 29.7 Rule

JSON provider configuration is API contract, not implementation detail.

---

# 30. XML Negotiation dan Jakarta REST 4.0 JAXB Removal

Jakarta REST 4.0 removed JAXB dependency.

## 30.1 Implication

If endpoint produces/consumes XML, ensure XML binding provider/dependency exists.

## 30.2 Example

```java
@Produces(MediaType.APPLICATION_XML)
```

does not magically guarantee writer available.

## 30.3 Security

XML carries risks:

- XXE;
- entity expansion;
- external entity SSRF;
- huge DOM memory.

## 30.4 Test

Test XML request/response after migration.

## 30.5 Rule

If XML is in API contract, explicitly manage XML provider and security configuration.

---

# 31. Binary/File Negotiation: PDF, CSV, ZIP, Octet Stream

## 31.1 PDF

```java
@GET
@Produces("application/pdf")
public Response pdf(...) { ... }
```

Headers:

```http
Content-Type: application/pdf
Content-Disposition: attachment; filename="report.pdf"
```

## 31.2 CSV

```java
@GET
@Produces("text/csv")
public StreamingOutput exportCsv(...) { ... }
```

## 31.3 ZIP

```java
@Produces("application/zip")
```

## 31.4 Octet stream

```java
@Produces(MediaType.APPLICATION_OCTET_STREAM)
```

Generic binary. Prefer specific media type when known.

## 31.5 Same URI or separate resource?

Option A:

```http
GET /reports/R001
Accept: application/pdf
```

Option B:

```http
GET /reports/R001/file
Accept: application/pdf
```

Choose based on API style.

## 31.6 Rule

File response needs correct media type, disposition, length/stream strategy, and cache/security headers.

---

# 32. Problem Details: `application/problem+json`

Problem Details uses media type:

```text
application/problem+json
```

## 32.1 Error response

```java
@Provider
public class ProblemMapper implements ExceptionMapper<Throwable> {
    public Response toResponse(Throwable ex) {
        Problem problem = ...
        return Response.status(problem.status())
            .type("application/problem+json")
            .entity(problem)
            .build();
    }
}
```

## 32.2 Negotiation question

If client sends:

```http
Accept: application/json
```

is `application/problem+json` acceptable?

Many APIs send Problem Details regardless for errors.

Document policy.

## 32.3 Alternative

If strict negotiation, support both:

```text
application/problem+json
application/json
```

## 32.4 Vary

If error language varies, add `Vary: Accept-Language`.

## 32.5 Rule

Error media type is part of API contract too.

---

# 33. Vendor Media Types dan API Versioning

## 33.1 Vendor media type

```text
application/vnd.example.customer.v1+json
```

## 33.2 Use case

Version representation without changing URI.

## 33.3 JAX-RS

```java
@Produces("application/vnd.example.customer.v1+json")
```

## 33.4 Pros

- URI stable;
- precise representation version.

## 33.5 Cons

- harder browser/manual testing;
- client tooling complexity;
- OpenAPI/client generation friction;
- gateway routing harder.

## 33.6 Alternative

Path version:

```text
/api/v1/customers
```

## 33.7 Rule

Choose versioning strategy intentionally and test media matching.

---

# 34. Negotiation dalam Resource Method Design

## 34.1 JSON-only create

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public Response create(CreateCustomerRequest request) { ... }
```

## 34.2 JSON and CSV export

```java
@GET
@Path("/customers")
@Produces({MediaType.APPLICATION_JSON, "text/csv"})
public Response listOrExport(@Context HttpHeaders headers) { ... }
```

May be less clear.

## 34.3 Separate export endpoint

```java
@GET
@Path("/customer-exports")
@Produces("text/csv")
public StreamingOutput export(...) { ... }
```

Often clearer.

## 34.4 Same resource different representation

Good when truly same resource in different representation.

## 34.5 Different operation

Use different resource path.

Example:

```text
/customers
/customer-export-jobs
```

## 34.6 Rule

Do not use content negotiation to hide different business operations.

---

# 35. Satu Method Banyak Media vs Banyak Method Satu Media

## 35.1 One method multiple produces

```java
@GET
@Produces({"application/json", "application/xml"})
public Customer get(...) { ... }
```

Pros:

- one business code path;
- provider handles serialization.

Cons:

- entity type must serialize correctly in all formats;
- hard to customize per media.

## 35.2 Multiple methods same path

```java
@GET
@Produces("application/json")
public CustomerJson getJson(...) { ... }

@GET
@Produces("text/csv")
public String getCsv(...) { ... }
```

Pros:

- media-specific response;
- easier for CSV/PDF.

Cons:

- possible ambiguity;
- duplicated logic.

## 35.3 Separate path

```text
/customers/{id}
/customers/{id}/file
```

Pros:

- clear operation/resource;
- easier docs.

Cons:

- less pure representation negotiation.

## 35.4 Recommendation

- JSON/XML same DTO: one method may be fine.
- CSV/PDF/export/download: usually separate method/resource.
- Different business operation: separate resource.

---

# 36. Negotiation dan `MessageBodyReader/Writer`

## 36.1 Request

```text
Content-Type + Java target type → MessageBodyReader
```

## 36.2 Response

```text
Accept + Java return type + @Produces → MessageBodyWriter
```

## 36.3 Provider media annotations

Readers use `@Consumes`.

Writers use `@Produces`.

## 36.4 Writer missing

Method may match `@Produces("application/xml")`, but if no writer exists for entity type/XML, runtime fails while writing.

## 36.5 Debugging

Check:

- provider registered;
- provider media type;
- entity class;
- generic type;
- annotations;
- priority.

## 36.6 Rule

`@Consumes/@Produces` select method and provider capabilities must still exist.

---

# 37. Negotiation dan OpenAPI

## 37.1 Document request body media types

```yaml
requestBody:
  content:
    application/json:
      schema: ...
```

## 37.2 Document responses

```yaml
responses:
  '200':
    content:
      application/json:
      text/csv:
```

## 37.3 Errors

Document:

```text
application/problem+json
```

## 37.4 Avoid undocumented variants

If endpoint produces CSV but OpenAPI says JSON only, clients break.

## 37.5 Generate from annotations?

Tools may read `@Consumes/@Produces`, but custom variants/filters may need explicit annotations.

## 37.6 Rule

Negotiation contract must appear in docs and tests.

---

# 38. Debugging `415`

## 38.1 Checklist

- What is actual `Content-Type`?
- Does request have body?
- Does method/class have `@Consumes`?
- Did method-level annotation override class-level?
- Is media suffix supported?
- Is JSON provider available?
- Is multipart provider/config available?
- Did path/method matching select different method?
- Is custom reader registered and narrow enough?

## 38.2 cURL test

```bash
curl -i \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"name":"Fajar"}' \
  https://api.example.com/customers
```

## 38.3 Common fix

Client sends wrong header.

Do not fix server by accepting `*/*` unless truly intended.

## 38.4 Log safely

Log content type and route template, not body.

## 38.5 Rule

`415` is fixed by aligning request media type, `@Consumes`, and reader provider.

---

# 39. Debugging `406`

## 39.1 Checklist

- What is actual `Accept`?
- Does method/class have `@Produces`?
- Did method-level annotation override class-level?
- Does endpoint support requested media?
- Does writer provider exist?
- Is browser sending HTML-preferred Accept?
- Is wildcard acceptable?
- Are multiple methods ambiguous?

## 39.2 cURL test

```bash
curl -i \
  -H "Accept: application/json" \
  https://api.example.com/customers/CUST-000001
```

Unsupported:

```bash
curl -i \
  -H "Accept: application/xml" \
  https://api.example.com/customers/CUST-000001
```

## 39.3 Common fix

API client should send correct Accept.

Server should document supported media.

## 39.4 Rule

`406` is fixed by aligning `Accept`, `@Produces`, and writer provider.

---

# 40. Testing Content Negotiation

## 40.1 Request media tests

For POST/PUT/PATCH:

- `Content-Type: application/json` success.
- `Content-Type: text/plain` → 415.
- missing Content-Type → defined response.
- malformed JSON → 400.

## 40.2 Response media tests

For GET:

- `Accept: application/json` success.
- `Accept: application/xml` → 406 if unsupported.
- `Accept: */*` defined default.
- no Accept defined default.

## 40.3 q-value tests

```text
Accept: application/xml;q=1.0, application/json;q=0.5
```

If both supported, XML should win.

## 40.4 Vary tests

If response differs by Accept:

```http
Vary: Accept
```

## 40.5 Problem Details tests

Errors return:

```http
Content-Type: application/problem+json
```

## 40.6 Multipart tests

Wrong multipart content type/part media.

## 40.7 Runtime tests

Must use actual HTTP runtime, not direct method calls.

---

# 41. Observability: Metrics untuk Media Type dan Negotiation Errors

## 41.1 Metrics

Track:

```text
http_requests_total{route,method,status}
rest_negotiation_errors_total{route,type="unsupported_media"}
rest_negotiation_errors_total{route,type="not_acceptable"}
```

## 41.2 Media type labels

Use bounded labels:

```text
request_media="application/json"
response_media="application/json"
```

Avoid raw arbitrary media values if unbounded.

## 41.3 Logs

Log:

- route template;
- content type;
- accept header summarized;
- selected media type;
- status;
- error code.

## 41.4 Do not log body

Negotiation does not require body logging.

## 41.5 Dashboards

Useful panels:

- top 415 endpoints;
- top 406 endpoints;
- media distribution;
- client version vs media errors.

## 41.6 Rule

Negotiation failures often indicate client contract drift; observe them separately.

---

# 42. Security Considerations

## 42.1 Content-Type spoofing

Client can lie.

Do not trust file type solely by `Content-Type`.

## 42.2 JSON parser security

Configure max depth/size where possible.

## 42.3 XML security

XXE/entity expansion protections.

## 42.4 Problem Details leak

Do not expose internal provider/parser exception details.

## 42.5 Browser content sniffing

Set:

```http
X-Content-Type-Options: nosniff
```

where appropriate.

## 42.6 Download safety

For files:

```http
Content-Disposition: attachment
```

depending use case.

## 42.7 Rule

Media type is contract metadata, not proof of safe content.

---

# 43. Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus

## 43.1 Provider defaults differ

- JSON-B vs Jackson;
- XML provider availability;
- multipart defaults;
- Problem Details support/customization;
- records support;
- `+json` handling.

## 43.2 q/qs diagnostics differ

Spec behavior should align, logs/warnings may differ.

## 43.3 OpenAPI integration differs

Some tools infer consumes/produces differently.

## 43.4 Test runtime

Run content negotiation tests on deployed runtime.

## 43.5 Migration risk

Changing runtime/provider can change serialization and negotiation.

## 43.6 Rule

Content negotiation is spec-driven but provider/runtime-sensitive.

---

# 44. Common Failure Modes

## 44.1 Client sends `Content-Type: text/plain` with JSON body

415.

## 44.2 Client sends `Accept: application/xml` to JSON-only endpoint

406.

## 44.3 Method-level `@Produces` overrides class JSON default

Unexpected 406.

## 44.4 Missing JSON provider

Reader/writer failure.

## 44.5 `application/problem+json` not declared/tested

Error client confusion.

## 44.6 Cache serves wrong variant

Missing `Vary`.

## 44.7 Browser Accept selects unexpected representation

Wrong method/format.

## 44.8 `+json` media not supported

Merge patch/vendor/problem media fails.

## 44.9 Custom reader/writer too broad

Hijacks JSON/XML.

## 44.10 XML endpoint broken after Jakarta REST 4.0 migration

JAXB dependency removed.

## 44.11 q/qs not tested

Unexpected response media.

## 44.12 File download uses `application/octet-stream` for everything

Poor client behavior.

---

# 45. Best Practices

## 45.1 Be explicit

Use `@Consumes` and `@Produces`.

## 45.2 Prefer JSON-only unless real need

Complex negotiation increases testing/documentation burden.

## 45.3 Use specific media types

Avoid `*/*` in resource methods.

## 45.4 Support `application/problem+json`

For error contract.

## 45.5 Add `Vary` when response varies

Especially `Accept` and `Accept-Language`.

## 45.6 Test q-values and wildcards

Not only exact headers.

## 45.7 Use separate resource for different business operation

Do not hide operations behind media type.

## 45.8 Manage provider configuration

JSON/XML providers are API behavior.

## 45.9 Document OpenAPI content types

Request and response.

## 45.10 Observe 406/415 separately

They indicate client contract mismatch.

---

# 46. Anti-Patterns

## 46.1 Accepting all media

```java
@Consumes("*/*")
```

without reason.

## 46.2 Producing all media

```java
@Produces("*/*")
```

on normal API method.

## 46.3 Ignoring `Content-Type`

Trying to parse body regardless of media type.

## 46.4 Ignoring `Accept`

Always returning JSON even when client explicitly rejects it.

## 46.5 Supporting header/path/query format all at once

Too much complexity.

## 46.6 Missing `Vary`

Cache correctness bug.

## 46.7 Returning Problem Details with wrong media type

Contract inconsistency.

## 46.8 Treating XML as available by default in Jakarta REST 4.0

Migration bug.

## 46.9 Custom provider with broad `isWriteable/isReadable`

Provider hijack.

## 46.10 No negotiation tests

Production surprises.

---

# 47. Production Checklist

## 47.1 Resource annotations

- [ ] `@Consumes` explicit on body endpoints.
- [ ] `@Produces` explicit on response endpoints.
- [ ] Class-level defaults understood.
- [ ] Method-level overrides intentional.
- [ ] Structured suffix media declared if supported.

## 47.2 Media contract

- [ ] Request body media documented.
- [ ] Response media documented.
- [ ] Error media documented.
- [ ] File/download media documented.
- [ ] Vendor/version media documented if used.

## 47.3 Providers

- [ ] JSON reader/writer configured.
- [ ] XML reader/writer configured if needed.
- [ ] Multipart provider tested.
- [ ] Custom providers narrow.
- [ ] Provider priority tested.

## 47.4 HTTP/cache

- [ ] `Vary` set where representation varies.
- [ ] Cache-Control aligns with user-specific/public data.
- [ ] Content-Language set if localized.
- [ ] Content-Encoding handled by server/gateway.

## 47.5 Errors

- [ ] 415 mapped to stable problem response.
- [ ] 406 mapped to stable problem response.
- [ ] Malformed body maps to 400.
- [ ] Provider errors do not leak internals.

## 47.6 Tests

- [ ] Exact Accept tests.
- [ ] Wildcard Accept tests.
- [ ] q-value tests.
- [ ] Wrong Content-Type tests.
- [ ] No Accept tests.
- [ ] Missing Content-Type tests.
- [ ] Vary header tests.

## 47.7 Observability/security

- [ ] 406/415 counted separately.
- [ ] Content type values normalized.
- [ ] Body not logged.
- [ ] Download security headers set.

---

# 48. Latihan

## Latihan 1 — JSON-only API

Buat endpoint:

```text
POST /customers
```

Dengan:

```java
@Consumes(application/json)
@Produces(application/json)
```

Test:

- correct headers;
- wrong Content-Type;
- wrong Accept;
- no Accept;
- missing Content-Type.

## Latihan 2 — JSON vs XML

Buat satu `GET /customers/{id}` yang support JSON dan XML.

Test:

```http
Accept: application/json
Accept: application/xml
Accept: application/xml;q=1, application/json;q=0.5
```

## Latihan 3 — `qs`

Set server preference:

```java
@Produces({
  "application/json;qs=1.0",
  "application/xml;qs=0.5"
})
```

Test `Accept: */*`.

## Latihan 4 — Vary

Jika endpoint bisa JSON/XML, pastikan:

```http
Vary: Accept
```

Jika localized:

```http
Vary: Accept, Accept-Language
```

## Latihan 5 — Problem Details

Buat mapper untuk `NotAcceptableException` dan `NotSupportedException`.

Return:

```text
application/problem+json
```

## Latihan 6 — `Request#selectVariant`

Implement endpoint yang memilih:

- JSON/CSV;
- English/Indonesian.

Gunakan `Variant`.

## Latihan 7 — Vendor Media Type

Implement:

```text
application/vnd.example.customer.v1+json
application/vnd.example.customer.v2+json
```

Bandingkan dengan path versioning.

## Latihan 8 — File Download

Buat endpoint PDF:

```text
GET /reports/{id}/file
Accept: application/pdf
```

Set:

- Content-Type;
- Content-Disposition;
- Cache-Control.

## Latihan 9 — Runtime Provider Audit

Cari semua JSON/XML/multipart provider dalam dependency tree/runtime.

Dokumentasikan mana yang aktif.

---

# 49. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

2. Jakarta RESTful Web Services 4.0 — `Consumes` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/consumes

3. Jakarta RESTful Web Services 4.0 — `Produces` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/produces

4. Jakarta RESTful Web Services 4.0 — `MediaType` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/mediatype

5. Jakarta RESTful Web Services 4.0 — `Variant` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/variant

6. Jakarta RESTful Web Services 4.0 — `Request` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/request

7. Jakarta RESTful Web Services 4.0 — `HttpHeaders` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/httpheaders

8. Jakarta EE Tutorial — Building RESTful Web Services with Jakarta REST  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/websvcs/rest/rest.html

9. RFC 9110 — HTTP Semantics  
   https://www.rfc-editor.org/rfc/rfc9110.html

10. RFC 9111 — HTTP Caching  
    https://www.rfc-editor.org/rfc/rfc9111.html

11. RFC 9457 — Problem Details for HTTP APIs  
    https://www.rfc-editor.org/rfc/rfc9457.html

---

# 50. Penutup

Content negotiation adalah mekanisme yang membuat resource bisa punya representasi yang benar untuk request dan response.

Mental model utama:

```text
Request body:
  Content-Type
  ↓
  @Consumes
  ↓
  MessageBodyReader
  ↓
  Java entity parameter

Response body:
  Accept
  ↓
  @Produces / Variant
  ↓
  Java return value
  ↓
  MessageBodyWriter
  ↓
  Content-Type
```

Error mapping:

```text
Unsupported request body media → 415
Unsupported response media requested → 406
Malformed body with supported media → 400
Writer/reader provider missing → provider/runtime error unless mapped
```

Cache correctness:

```text
If response varies by Accept, set Vary: Accept.
If response varies by language, set Vary: Accept-Language.
If response varies by encoding, set Vary: Accept-Encoding.
```

Prinsip final:

```text
Media type is an API contract.
Negotiation is not decoration.
It controls method selection, provider selection, cache correctness, and client compatibility.
```

Part berikutnya:

```text
Bagian 012 — JSON in JAX-RS: JSON-B, JSON-P, Jackson, Provider Selection, DTO Contract
```

Kita akan membahas JSON secara sangat mendalam: JSON-B vs JSON-P vs Jackson, provider registration, records, null policy, unknown fields, date/time, enum wire values, polymorphism, security, schema, and production JSON contract design.
