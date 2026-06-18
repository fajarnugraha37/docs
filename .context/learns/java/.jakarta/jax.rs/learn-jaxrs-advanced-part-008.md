# learn-jaxrs-advanced-part-008.md

# Bagian 008 — Context Injection: `@Context`, `UriInfo`, `HttpHeaders`, `Request`, `SecurityContext`, `Providers`, `ResourceContext`, dan Runtime Metadata Boundary

> Target pembaca: Java/Jakarta engineer yang ingin memahami **context injection** di JAX-RS/Jakarta REST secara mendalam. Part ini membahas `@Context` bukan sebagai “magic injection”, tetapi sebagai akses terkontrol ke request/runtime metadata: URI, headers, conditional request, security principal, provider lookup, subresource instantiation, configuration, application, dan servlet bridge.
>
> Namespace utama: `jakarta.ws.rs.core.Context`, `jakarta.ws.rs.core.UriInfo`, `jakarta.ws.rs.core.HttpHeaders`, `jakarta.ws.rs.core.Request`, `jakarta.ws.rs.core.SecurityContext`, `jakarta.ws.rs.ext.Providers`, `jakarta.ws.rs.container.ResourceContext`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: `@Context` adalah Runtime Metadata Access, Bukan Dependency Injection Umum](#2-mental-model-context-adalah-runtime-metadata-access-bukan-dependency-injection-umum)
3. [`@Context`: Apa yang Bisa Di-inject](#3-context-apa-yang-bisa-di-inject)
4. [Injection Target: Parameter, Field, Property, Constructor](#4-injection-target-parameter-field-property-constructor)
5. [Request Scope dan `IllegalStateException`](#5-request-scope-dan-illegalstateexception)
6. [Context Object vs CDI Bean](#6-context-object-vs-cdi-bean)
7. [`UriInfo`: Application URI, Request URI, Path, Query, Matched Resources](#7-uriinfo-application-uri-request-uri-path-query-matched-resources)
8. [`UriInfo#getBaseUri()` vs `getRequestUri()` vs `getAbsolutePath()`](#8-uriinfogetbaseuri-vs-getrequesturi-vs-getabsolutepath)
9. [`UriInfo#getPath()` dan Decode Policy](#9-uriinfogetpath-dan-decode-policy)
10. [`UriInfo#getPathParameters()` dan `getQueryParameters()`](#10-uriinfogetpathparameters-dan-getqueryparameters)
11. [`UriInfo#getPathSegments()` dan Matrix Params](#11-uriinfogetpathsegments-dan-matrix-params)
12. [`UriInfo#getMatchedURIs()`, `getMatchedResources()`, `getMatchedResourceTemplate()`](#12-uriinfogetmatcheduris-getmatchedresources-getmatchedresourcetemplate)
13. [`UriInfo` untuk Observability: Path Template, Bukan Raw URI](#13-uriinfo-untuk-observability-path-template-bukan-raw-uri)
14. [`UriInfo` untuk URI Building dan `Location` Header](#14-uriinfo-untuk-uri-building-dan-location-header)
15. [`UriInfo` di Belakang Gateway/Reverse Proxy](#15-uriinfo-di-belakang-gatewayreverse-proxy)
16. [`HttpHeaders`: Header Metadata, Accept, Language, Cookies](#16-httpheaders-header-metadata-accept-language-cookies)
17. [`HttpHeaders#getRequestHeaders()` vs `getHeaderString()`](#17-httpheadersgetrequestheaders-vs-getheaderstring)
18. [`HttpHeaders#getAcceptableMediaTypes()` dan `getAcceptableLanguages()`](#18-httpheadersgetacceptablemediatypes-dan-getacceptablelanguages)
19. [`HttpHeaders#getMediaType()` dan Request Entity Content-Type](#19-httpheadersgetmediatype-dan-request-entity-content-type)
20. [`HttpHeaders#getCookies()`](#20-httpheadersgetcookies)
21. [Header Security: Jangan Log Semua Header](#21-header-security-jangan-log-semua-header)
22. [`Request`: Conditional Requests dan Content Negotiation Helper](#22-request-conditional-requests-dan-content-negotiation-helper)
23. [`Request#evaluatePreconditions` dengan `ETag`](#23-requestevaluatepreconditions-dengan-etag)
24. [`Request#evaluatePreconditions` dengan `Last-Modified`](#24-requestevaluatepreconditions-dengan-last-modified)
25. [`Request#selectVariant`](#25-requestselectvariant)
26. [`SecurityContext`: Principal, Role, Scheme, Secure Channel](#26-securitycontext-principal-role-scheme-secure-channel)
27. [`SecurityContext#getUserPrincipal()`](#27-securitycontextgetuserprincipal)
28. [`SecurityContext#isUserInRole()` dan Role-Based Authorization](#28-securitycontextisuserinrole-dan-role-based-authorization)
29. [`SecurityContext#isSecure()` di Belakang TLS Termination](#29-securitycontextissecure-di-belakang-tls-termination)
30. [`SecurityContext#getAuthenticationScheme()`](#30-securitycontextgetauthenticationscheme)
31. [`SecurityContext` vs Domain Authorization](#31-securitycontext-vs-domain-authorization)
32. [`Providers`: Runtime Provider Lookup](#32-providers-runtime-provider-lookup)
33. [`Providers#getMessageBodyReader/Writer`](#33-providersgetmessagebodyreaderwriter)
34. [`Providers#getExceptionMapper`](#34-providersgetexceptionmapper)
35. [`Providers#getContextResolver`](#35-providersgetcontextresolver)
36. [Kapan Memakai `Providers`, Kapan Tidak](#36-kapan-memakai-providers-kapan-tidak)
37. [`ResourceContext`: Managed Subresource Instantiation](#37-resourcecontext-managed-subresource-instantiation)
38. [`ResourceContext#getResource()`](#38-resourcecontextgetresource)
39. [`ResourceContext#initResource()`](#39-resourcecontextinitresource)
40. [`ResourceContext` vs Manual `new`](#40-resourcecontext-vs-manual-new)
41. [`Application`, `Configuration`, dan Runtime Config Context](#41-application-configuration-dan-runtime-config-context)
42. [Servlet Bridge: `HttpServletRequest`, `HttpServletResponse`, `ServletContext`, `ServletConfig`](#42-servlet-bridge-httpservletrequest-httpservletresponse-servletcontext-servletconfig)
43. [Portability Cost dari Servlet Bridge](#43-portability-cost-dari-servlet-bridge)
44. [Context Injection di Filters, Interceptors, Providers](#44-context-injection-di-filters-interceptors-providers)
45. [Context Injection dan Async/Other Threads](#45-context-injection-dan-asyncother-threads)
46. [Jangan Membocorkan HTTP Context ke Domain Layer](#46-jangan-membocorkan-http-context-ke-domain-layer)
47. [Pattern: RequestMetadata / RequestContext Bean](#47-pattern-requestmetadata--requestcontext-bean)
48. [Pattern: Correlation ID dari Header ke Request Scope](#48-pattern-correlation-id-dari-header-ke-request-scope)
49. [Pattern: Tenant Resolution](#49-pattern-tenant-resolution)
50. [Testing Context Injection](#50-testing-context-injection)
51. [Observability dan Context Objects](#51-observability-dan-context-objects)
52. [Common Failure Modes](#52-common-failure-modes)
53. [Best Practices](#53-best-practices)
54. [Anti-Patterns](#54-anti-patterns)
55. [Production Checklist](#55-production-checklist)
56. [Latihan](#56-latihan)
57. [Referensi Resmi](#57-referensi-resmi)
58. [Penutup](#58-penutup)

---

# 1. Tujuan Part Ini

`@Context` adalah salah satu fitur JAX-RS yang sering dipakai tetapi sering disalahpahami.

Contoh sederhana:

```java
@GET
@Path("/customers/{customerId}")
public Response get(
    @PathParam("customerId") CustomerId customerId,
    @Context UriInfo uriInfo,
    @Context HttpHeaders headers,
    @Context SecurityContext security
) {
    ...
}
```

Banyak engineer hanya tahu:

```text
@Context bisa inject UriInfo/HttpHeaders/SecurityContext.
```

Tapi top-tier engineer harus tahu:

- object mana yang request-scoped;
- kapan method context object boleh dipanggil;
- apa perbedaan `UriInfo#getBaseUri`, `getRequestUri`, `getAbsolutePath`;
- bagaimana memakai `Request#evaluatePreconditions`;
- bagaimana `SecurityContext` berbeda dari domain authorization;
- bagaimana `Providers` melakukan runtime provider lookup;
- bagaimana `ResourceContext` menyelesaikan masalah manual `new` pada subresource locator;
- kenapa context object jangan bocor ke service/domain;
- bagaimana context dipakai untuk observability, gateway-aware URL generation, security, multi-tenancy, dan testing.

## 1.1 Prinsip utama

```text
@Context gives access to request/runtime metadata.
It is not a replacement for application service dependencies.
```

## 1.2 Tujuan praktis

Setelah part ini, kamu bisa:

- membedakan kapan memakai `@HeaderParam` vs `HttpHeaders`;
- membedakan kapan memakai `@QueryParam` vs `UriInfo`;
- membuat `Location` header dengan benar;
- memakai ETag/conditional request dengan `Request`;
- membaca principal/role dari `SecurityContext` tanpa mencampurnya dengan domain policy;
- memakai `ResourceContext` untuk subresource managed instance;
- menghindari `IllegalStateException` karena context dipakai di luar request;
- membuat request metadata bean yang bersih.

---

# 2. Mental Model: `@Context` adalah Runtime Metadata Access, Bukan Dependency Injection Umum

`@Context` bukan CDI `@Inject`.

`@Context` menginject object yang disediakan JAX-RS runtime.

## 2.1 CDI dependency

```java
@Inject
CustomerApplicationService service;
```

Ini dependency aplikasi.

## 2.2 JAX-RS context

```java
@Context
UriInfo uriInfo;
```

Ini metadata request/runtime.

## 2.3 Jangan tukar peran

Bad:

```java
@Context
CustomerService service; // wrong
```

Good:

```java
@Inject
CustomerService service;
```

## 2.4 Context sebagai protocol boundary

Context object mengandung HTTP/JAX-RS details:

- URI;
- headers;
- cookies;
- request method;
- security principal;
- matched resource;
- providers;
- resource context.

## 2.5 Domain layer tidak perlu tahu

Domain service sebaiknya tidak menerima:

```java
UriInfo
HttpHeaders
Request
SecurityContext
Response
```

Domain menerima value object:

```java
CustomerId
CurrentUser
TenantId
CorrelationId
Command
```

## 2.6 Top-tier rule

```text
Use @Context at the REST boundary.
Translate context into application-level objects before calling service/domain.
```

---

# 3. `@Context`: Apa yang Bisa Di-inject

Annotation:

```java
jakarta.ws.rs.core.Context
```

`@Context` bisa dipakai untuk inject banyak context types.

## 3.1 Common request context

```java
UriInfo
HttpHeaders
Request
SecurityContext
```

## 3.2 Runtime/provider context

```java
Providers
ResourceContext
Configuration
Application
```

## 3.3 Servlet bridge types

Jika berjalan di Servlet environment, beberapa runtime mendukung:

```java
HttpServletRequest
HttpServletResponse
ServletContext
ServletConfig
```

But portability depends on runtime/environment.

## 3.4 Resource information

Ada juga context seperti:

```java
ResourceInfo
```

pada filter/feature/provider tertentu untuk mengetahui resource class/method.

## 3.5 Injection locations

Can be injected into:

- resource class;
- provider;
- filter;
- interceptor;
- subresource;
- method parameter;
- field;
- constructor depending type/runtime.

## 3.6 Recommendation

Use method parameter injection for request-specific context when possible:

```java
public Response get(@Context UriInfo uriInfo)
```

Use field injection for shared helpers carefully.

---

# 4. Injection Target: Parameter, Field, Property, Constructor

## 4.1 Method parameter

```java
@GET
public Response get(@Context UriInfo uriInfo) { ... }
```

Clear and safe.

## 4.2 Field

```java
@Context
UriInfo uriInfo;
```

Common.

Usually injected proxy or request-scoped object.

## 4.3 Property setter

```java
@Context
public void setUriInfo(UriInfo uriInfo) {
    this.uriInfo = uriInfo;
}
```

Rare.

## 4.4 Constructor

```java
public CustomerResource(@Context UriInfo uriInfo) {
    this.uriInfo = uriInfo;
}
```

Supported for resource constructors with annotated params, but CDI constructor injection may be preferable for dependencies.

## 4.5 Providers

```java
@Provider
public class CorrelationFilter implements ContainerRequestFilter {
    @Context
    HttpHeaders headers;
}
```

Works, but know request scope rules.

## 4.6 Recommendation

For clarity:

```text
Method parameter for per-operation context.
Field for reusable context access in providers/resources.
Constructor for dependencies using CDI, not request context unless deliberate.
```

---

# 5. Request Scope dan `IllegalStateException`

Many context interfaces state their methods throw `IllegalStateException` if called outside request scope.

## 5.1 Example

`UriInfo` docs say all methods throw `IllegalStateException` outside request scope, e.g. from provider constructor.

Bad:

```java
@Provider
public class MyProvider {

    @Context
    UriInfo uriInfo;

    public MyProvider() {
        uriInfo.getPath(); // wrong: constructor, no request scope
    }
}
```

## 5.2 Correct

```java
@Provider
public class MyProvider implements ContainerRequestFilter {

    @Context
    UriInfo uriInfo;

    @Override
    public void filter(ContainerRequestContext context) {
        String path = uriInfo.getPath(); // request scope
    }
}
```

## 5.3 Why?

Context object may be proxy resolved per request.

Before request exists, there is no path/header/principal.

## 5.4 Async/thread caution

If you capture context object and use it later in another thread, request scope may be gone.

## 5.5 Rule

```text
Do not call request context methods in constructors, static initializers, background threads, or after response lifecycle ends.
```

---

# 6. Context Object vs CDI Bean

## 6.1 `@Context`

Runtime-provided metadata.

```java
@Context
UriInfo uriInfo;
```

## 6.2 `@Inject`

Application/container dependency.

```java
@Inject
CustomerService service;
```

## 6.3 CDI request-scoped metadata bean

You can create:

```java
@RequestScoped
public class RequestMetadata {
    private CorrelationId correlationId;
    private TenantId tenantId;
    private CurrentUser currentUser;
}
```

Populated by filter.

## 6.4 Why useful?

Resource/service can depend on application-level context, not raw HTTP context.

## 6.5 Bad service dependency

```java
@ApplicationScoped
public class CustomerService {
    public Customer get(UriInfo uriInfo, SecurityContext security) { ... }
}
```

## 6.6 Better

```java
public Customer get(CustomerId id, CurrentUser user, TenantId tenant) { ... }
```

or inject request-scoped `RequestMetadata` carefully.

## 6.7 Rule

Use `@Context` to read protocol metadata.

Convert to app-level context before service/domain.

---

# 7. `UriInfo`: Application URI, Request URI, Path, Query, Matched Resources

`UriInfo` gives access to application and request URI information.

## 7.1 Basic injection

```java
@GET
public Response get(@Context UriInfo uriInfo) {
    URI requestUri = uriInfo.getRequestUri();
    ...
}
```

## 7.2 Important capabilities

- base URI;
- request URI;
- absolute path;
- path relative to base URI;
- path segments;
- path parameters;
- query parameters;
- matched URIs;
- matched resources;
- matched resource template;
- URI builder helpers;
- resolve/relativize.

## 7.3 Request-scope only

Calling methods outside request scope throws `IllegalStateException`.

## 7.4 Decoded vs encoded variants

Many methods have boolean `decode` overload.

Examples:

```java
getPath()
getPath(boolean decode)
getPathParameters()
getPathParameters(boolean decode)
getQueryParameters()
getQueryParameters(boolean decode)
```

## 7.5 Why top-tier engineers care

`UriInfo` is central for:

- `Location` header;
- canonical links;
- pagination links;
- path template observability;
- dynamic query parsing;
- gateway-aware URI issues;
- matrix params.

---

# 8. `UriInfo#getBaseUri()` vs `getRequestUri()` vs `getAbsolutePath()`

These methods are often confused.

## 8.1 `getBaseUri()`

Base URI of the application.

Example:

```text
https://api.example.com/app/api/
```

where `/api` is application path.

Root resource paths are relative to base URI.

## 8.2 `getRequestUri()`

Full absolute request URI including query.

Example:

```text
https://api.example.com/app/api/customers/C001?include=orders
```

## 8.3 `getAbsolutePath()`

Absolute path of request excluding query.

Example:

```text
https://api.example.com/app/api/customers/C001
```

## 8.4 Builders

```java
getBaseUriBuilder()
getRequestUriBuilder()
getAbsolutePathBuilder()
```

## 8.5 Use cases

- Build URI to another resource: `getBaseUriBuilder()`.
- Add child path to current collection: `getAbsolutePathBuilder()`.
- Modify current query: `getRequestUriBuilder()`.
- Build canonical self link: depends on current context.

## 8.6 Common bug

Using `getRequestUriBuilder()` to create `Location` after POST to collection:

```text
/customers?page=1
```

could include query parameters accidentally.

Use `getAbsolutePathBuilder()`.

## 8.7 Rule

```text
Base URI = app root.
Request URI = full current request including query.
Absolute path = current request without query.
```

---

# 9. `UriInfo#getPath()` dan Decode Policy

## 9.1 Default decoded

```java
String path = uriInfo.getPath();
```

Equivalent to:

```java
uriInfo.getPath(true)
```

It decodes escaped octets.

## 9.2 Explicit decode false

```java
String rawishPath = uriInfo.getPath(false);
```

Keeps escaped octets.

## 9.3 Example

Request:

```text
/files/report%202026
```

Decoded:

```text
files/report 2026
```

Encoded:

```text
files/report%202026
```

## 9.4 Use cases for decode false

- signature verification;
- audit raw route;
- proxy-like behavior;
- detecting encoded slash/traversal.

## 9.5 Security warning

Do not perform authorization on one representation and file access on another representation.

Double decoding can cause vulnerabilities.

## 9.6 Recommendation

Use decoded values for normal app logic.

Use encoded values only in controlled security-aware code.

---

# 10. `UriInfo#getPathParameters()` dan `getQueryParameters()`

## 10.1 Path parameters

```java
MultivaluedMap<String, String> pathParams = uriInfo.getPathParameters();
```

Returns decoded path template parameters by default.

## 10.2 Query parameters

```java
MultivaluedMap<String, String> queryParams = uriInfo.getQueryParameters();
```

Returns decoded query parameter names/values by default.

## 10.3 MultivaluedMap

Useful for repeated params:

```text
?status=NEW&status=PAID
```

## 10.4 Unmodifiable

Returned maps are generally unmodifiable.

Copy if needed.

## 10.5 When use instead of `@QueryParam`

Use `UriInfo` when:

- need all query params;
- dynamic filter keys;
- duplicate detection;
- unknown param rejection;
- encoded control.

## 10.6 Duplicate detection

```java
List<String> pageValues = queryParams.get("page");
if (pageValues != null && pageValues.size() > 1) {
    throw new BadRequestException("Duplicate page parameter");
}
```

## 10.7 Unknown param rejection

```java
Set<String> allowed = Set.of("page", "size", "status", "sort");
for (String key : queryParams.keySet()) {
    if (!allowed.contains(key)) {
        throw new BadRequestException("Unknown query parameter: " + key);
    }
}
```

Do not echo raw sensitive values.

## 10.8 Rule

Use `@QueryParam` for simple explicit contract; use `UriInfo` for dynamic or full-map behavior.

---

# 11. `UriInfo#getPathSegments()` dan Matrix Params

`getPathSegments()` returns a list of `PathSegment`.

## 11.1 Use case

Parsing matrix params.

Request:

```text
/cars;color=red/models;year=2026
```

## 11.2 Code

```java
List<PathSegment> segments = uriInfo.getPathSegments();
for (PathSegment segment : segments) {
    String path = segment.getPath();
    MultivaluedMap<String, String> matrix = segment.getMatrixParameters();
}
```

## 11.3 Decode behavior

Default decodes path segment and matrix param values.

Use:

```java
getPathSegments(false)
```

to avoid decoding.

## 11.4 Unmodifiable

Returned list and matrix maps are unmodifiable.

## 11.5 Public API caution

Matrix params often break through gateways.

## 11.6 Security

Encoded path segment handling is security-sensitive.

## 11.7 Rule

If matrix params are not part of API contract, ignore or reject semicolon usage explicitly.

---

# 12. `UriInfo#getMatchedURIs()`, `getMatchedResources()`, `getMatchedResourceTemplate()`

These are advanced but very useful.

## 12.1 `getMatchedURIs()`

Returns read-only list of URIs matched by resource classes/methods/locators, reverse order.

Current resource first.

## 12.2 `getMatchedResources()`

Returns read-only list of matched resource class instances, reverse order.

Useful for debugging subresource matching.

## 12.3 `getMatchedResourceTemplate()`

Jakarta REST 4.0 adds method to get URI template including all matched paths, including application path.

This is extremely useful for route template observability.

## 12.4 Pre-matching filter behavior

Before request matching, matched template may be empty.

## 12.5 Example

Request:

```text
GET /api/customers/C001/orders/O100
```

Template:

```text
/api/customers/{customerId}/orders/{orderId}
```

## 12.6 Use for metrics

Good:

```text
route="/api/customers/{customerId}/orders/{orderId}"
```

Bad:

```text
path="/api/customers/C001/orders/O100"
```

## 12.7 Use for debugging

If wrong endpoint selected, matched resources and URIs help explain.

## 12.8 Do not expose internal class names publicly

Use internally/logs/metrics only.

---

# 13. `UriInfo` untuk Observability: Path Template, Bukan Raw URI

## 13.1 Metrics cardinality problem

Bad:

```text
http_requests_total{path="/customers/C001"}
http_requests_total{path="/customers/C002"}
```

Each ID creates new time series.

## 13.2 Good

```text
http_requests_total{route="/customers/{customerId}"}
```

## 13.3 Jakarta REST 4.0 support

Use:

```java
String template = uriInfo.getMatchedResourceTemplate();
```

Where available.

## 13.4 For 404

No matched template.

Use:

```text
route="UNMATCHED"
```

or low-cardinality route group.

## 13.5 Logs

Logs may include actual path if needed, but apply redaction/security policy.

## 13.6 Traces

Span name should use route template.

```text
GET /customers/{customerId}
```

## 13.7 Rule

`UriInfo` is a bridge between routing and observability.

---

# 14. `UriInfo` untuk URI Building dan `Location` Header

## 14.1 Create child resource

```java
@POST
@Path("/customers")
public Response create(CreateCustomerRequest request, @Context UriInfo uriInfo) {
    CreatedCustomer created = service.create(request);

    URI location = uriInfo.getAbsolutePathBuilder()
        .path(created.id().value())
        .build();

    return Response.created(location)
        .entity(mapper.toResponse(created))
        .build();
}
```

## 14.2 Build URI to another resource

```java
URI jobUri = uriInfo.getBaseUriBuilder()
    .path(ReportJobResource.class)
    .path(ReportJobResource.class, "get")
    .build(jobId.value());
```

## 14.3 Pagination links

```java
URI next = uriInfo.getRequestUriBuilder()
    .replaceQueryParam("page", page + 1)
    .build();
```

## 14.4 Avoid manual string concatenation

Bad:

```java
URI.create("/customers/" + id)
```

Encoding and base path bugs.

## 14.5 Generated URI as contract

`Location` and `Link` headers are part of API contract.

Test them.

## 14.6 Gateway warning

Generated URI may use internal host unless forwarded header handling configured.

---

# 15. `UriInfo` di Belakang Gateway/Reverse Proxy

## 15.1 Problem

Internal app sees:

```text
http://service:8080/app/api/customers
```

Client sees:

```text
https://api.example.com/customers
```

## 15.2 `UriInfo` may generate internal URL

```java
uriInfo.getBaseUri()
```

could return internal base.

## 15.3 Forwarded headers

Proxy may send:

```text
Forwarded
X-Forwarded-Proto
X-Forwarded-Host
X-Forwarded-Port
X-Forwarded-Prefix
```

Runtime/server must be configured to honor them.

## 15.4 Security

Trust forwarded headers only from known proxy.

Client can spoof them otherwise.

## 15.5 Test

Smoke test through gateway:

- `201 Location`;
- pagination links;
- canonical self links;
- redirects if any;
- OpenAPI server URL.

## 15.6 Workaround

Sometimes use configured external base URL from config for link generation.

But keep it environment-specific and tested.

## 15.7 Rule

Do not assume `UriInfo` external URI correctness until tested behind real ingress/gateway.

---

# 16. `HttpHeaders`: Header Metadata, Accept, Language, Cookies

`HttpHeaders` is injectable interface for HTTP header information.

## 16.1 Injection

```java
@GET
public Response get(@Context HttpHeaders headers) {
    List<MediaType> acceptable = headers.getAcceptableMediaTypes();
    ...
}
```

## 16.2 Capabilities

- all request headers;
- single combined header string;
- request media type;
- acceptable response media types;
- acceptable languages;
- cookies;
- language;
- header constants.

## 16.3 Request scope

Methods throw `IllegalStateException` outside request scope.

## 16.4 When prefer `HttpHeaders`

Use when:

- need multiple headers;
- need standard parsing;
- need cookies map;
- need content negotiation metadata;
- need dynamic header behavior.

## 16.5 When prefer `@HeaderParam`

Use when one specific header is part of method contract:

```java
@HeaderParam("If-Match") String ifMatch
```

## 16.6 Top-tier rule

`HttpHeaders` is useful, but do not turn every resource into raw header parser.

---

# 17. `HttpHeaders#getRequestHeaders()` vs `getHeaderString()`

## 17.1 `getRequestHeaders()`

Returns multivalued map of request headers.

```java
MultivaluedMap<String, String> map = headers.getRequestHeaders();
```

Useful for duplicate detection and full inspection.

## 17.2 `getHeaderString(name)`

Returns string value for header.

If header has multiple values, they may be combined according to JAX-RS/header rules.

```java
String idempotencyKey = headers.getHeaderString("Idempotency-Key");
```

## 17.3 Duplicate security-sensitive header

For headers like `Idempotency-Key`, duplicate should usually be rejected.

Use `getRequestHeaders()`.

## 17.4 Header names

Case-insensitive.

## 17.5 Do not log full map

Contains secrets:

- Authorization;
- Cookie;
- API keys;
- tokens.

## 17.6 Recommendation

Use `getHeaderString` for harmless/simple header.

Use multivalued map for validation/security-sensitive headers.

---

# 18. `HttpHeaders#getAcceptableMediaTypes()` dan `getAcceptableLanguages()`

## 18.1 Accept media types

```java
List<MediaType> mediaTypes = headers.getAcceptableMediaTypes();
```

Returns acceptable media types sorted by client preference.

## 18.2 Accept languages

```java
List<Locale> languages = headers.getAcceptableLanguages();
```

Useful for localization.

## 18.3 Content negotiation

JAX-RS runtime already uses `Accept` and `@Produces` for method selection.

But inside resource, you may choose response details or localized error messages.

## 18.4 Avoid manual parsing

Do not parse `Accept` manually if `HttpHeaders` provides helpers.

## 18.5 `Vary`

If response varies by `Accept-Language`, add:

```http
Vary: Accept-Language
```

## 18.6 Localization caution

Error code should remain stable even if message localized.

## 18.7 Rule

Accept headers are client preferences, not authorization/security signals.

---

# 19. `HttpHeaders#getMediaType()` dan Request Entity Content-Type

## 19.1 Request media type

```java
MediaType contentType = headers.getMediaType();
```

Returns media type of request entity or null if no request entity.

## 19.2 Use cases

- dynamic parsing;
- audit;
- validation;
- custom endpoint supporting multiple body formats.

## 19.3 Usually not needed

For normal resource method, use:

```java
@Consumes(MediaType.APPLICATION_JSON)
```

Runtime selects method and body reader.

## 19.4 415

If content type unsupported, runtime may fail before method invocation.

## 19.5 Multipart/form

Content-Type includes boundary.

Do not compare raw string naively.

## 19.6 Rule

Let `@Consumes` and providers handle media matching; use `getMediaType()` for advanced cases.

---

# 20. `HttpHeaders#getCookies()`

## 20.1 Cookies map

```java
Map<String, Cookie> cookies = headers.getCookies();
```

## 20.2 Use cases

- session/csrf filter;
- user preference;
- feature flag;
- browser-facing API.

## 20.3 Prefer security layer

Authentication cookie should be handled by security layer/filter/container.

Resource methods should use:

```java
SecurityContext
```

or app-level `CurrentUser`.

## 20.4 Cookie privacy

Do not log cookies.

## 20.5 Cookie setting

Use response cookies:

```java
Response.ok().cookie(newCookie).build()
```

## 20.6 Rule

Cookies are credentials/state; treat them as sensitive.

---

# 21. Header Security: Jangan Log Semua Header

## 21.1 Sensitive headers

Redact:

- `Authorization`;
- `Cookie`;
- `Set-Cookie`;
- `X-API-Key`;
- `Proxy-Authorization`;
- custom token headers.

## 21.2 PII headers

Some systems send:

- user ID;
- email;
- tenant;
- device ID.

Treat carefully.

## 21.3 Header spoofing

Headers like:

```text
X-Forwarded-For
X-User-ID
X-Tenant-ID
```

must be trusted only from known infrastructure.

## 21.4 Duplicate header attack

Different layers may handle duplicates differently.

Reject duplicates for critical custom headers.

## 21.5 Rule

Headers are untrusted input unless produced by trusted infrastructure after authentication.

---

# 22. `Request`: Conditional Requests dan Content Negotiation Helper

`Request` is injectable helper for request processing.

## 22.1 Injection

```java
@GET
public Response get(@Context Request request) {
    ...
}
```

## 22.2 Capabilities

- get request method;
- evaluate preconditions;
- select variant.

## 22.3 Preconditions

Methods:

```java
evaluatePreconditions()
evaluatePreconditions(EntityTag eTag)
evaluatePreconditions(Date lastModified)
evaluatePreconditions(Date lastModified, EntityTag eTag)
```

## 22.4 Return semantics

`evaluatePreconditions` returns:

- `null` if preconditions are met and request should continue;
- non-null `ResponseBuilder` if preconditions are not met.

## 22.5 Caller responsibility

If builder returned, caller may need to add metadata such as ETag/cache headers.

## 22.6 Use cases

- conditional GET;
- optimistic concurrency for PUT/PATCH/DELETE;
- cache revalidation.

---

# 23. `Request#evaluatePreconditions` dengan `ETag`

## 23.1 Conditional GET

```java
@GET
@Path("/{customerId}")
public Response get(
    @PathParam("customerId") CustomerId id,
    @Context Request request
) {
    CustomerDto dto = service.get(id);
    EntityTag tag = new EntityTag(dto.version());

    Response.ResponseBuilder preconditions = request.evaluatePreconditions(tag);
    if (preconditions != null) {
        return preconditions.tag(tag).build();
    }

    return Response.ok(dto)
        .tag(tag)
        .build();
}
```

## 23.2 Client request

```http
GET /customers/C001
If-None-Match: "v3"
```

If unchanged:

```http
304 Not Modified
```

## 23.3 Optimistic update

For PUT/PATCH/DELETE:

```http
If-Match: "v3"
```

If stale:

```http
412 Precondition Failed
```

## 23.4 Important

You need current ETag/version before evaluating.

This may require DB lookup.

## 23.5 Strong vs weak

For write concurrency, use strong version semantics.

## 23.6 Rule

Use `Request` helper rather than hand-parsing conditional headers where possible.

---

# 24. `Request#evaluatePreconditions` dengan `Last-Modified`

## 24.1 Last modified

```java
Date lastModified = Date.from(dto.updatedAt());

Response.ResponseBuilder preconditions =
    request.evaluatePreconditions(lastModified);
```

## 24.2 Client

```http
If-Modified-Since: ...
```

## 24.3 Precision issue

HTTP date precision is seconds.

DB timestamps may be more precise.

ETag is usually better for concurrency.

## 24.4 Combined

```java
request.evaluatePreconditions(lastModified, entityTag)
```

## 24.5 Use cases

- static-ish resources;
- documents;
- reference data;
- cache validation.

## 24.6 Rule

Prefer ETag for precise resource versioning; use Last-Modified as additional cache metadata.

---

# 25. `Request#selectVariant`

`selectVariant` helps content negotiation when resource supports variants.

## 25.1 Variants

A `Variant` combines media type, language, and encoding.

## 25.2 Example

```java
List<Variant> variants = Variant
    .mediaTypes(MediaType.APPLICATION_JSON_TYPE, MediaType.APPLICATION_XML_TYPE)
    .languages(Locale.ENGLISH, Locale.forLanguageTag("id-ID"))
    .add()
    .build();

Variant selected = request.selectVariant(variants);
if (selected == null) {
    return Response.notAcceptable(variants).build();
}
```

## 25.3 Runtime method selection already handles `@Produces`

Use `selectVariant` when one method dynamically chooses among variants.

## 25.4 Vary header

If `selectVariant` is called before `evaluatePreconditions`, the returned precondition response builder may include `Vary`.

## 25.5 Practical use

Less common in JSON-only APIs.

Useful for:

- multi-language representations;
- JSON/XML in one method;
- document rendering.

## 25.6 Rule

For simple APIs, use `@Produces`. For dynamic variant selection, use `Request#selectVariant`.

---

# 26. `SecurityContext`: Principal, Role, Scheme, Secure Channel

`SecurityContext` provides security-related information.

## 26.1 Injection

```java
@GET
public Response get(@Context SecurityContext security) {
    Principal principal = security.getUserPrincipal();
    ...
}
```

## 26.2 Methods

- `getUserPrincipal()`;
- `isUserInRole(String role)`;
- `isSecure()`;
- `getAuthenticationScheme()`.

## 26.3 Constants

Authentication scheme constants include:

- `BASIC_AUTH`;
- `CLIENT_CERT_AUTH`;
- `DIGEST_AUTH`;
- `FORM_AUTH`.

## 26.4 Source

SecurityContext is populated by runtime/container/security integration.

Could be Servlet security, Jakarta Security, JWT integration, filters, etc.

## 26.5 Not full authorization system

It gives principal/roles/scheme.

Domain authorization still required.

## 26.6 Rule

Use `SecurityContext` to identify authenticated caller and coarse roles, not to encode all business access control.

---

# 27. `SecurityContext#getUserPrincipal()`

## 27.1 Principal

```java
Principal principal = security.getUserPrincipal();
```

May be null if unauthenticated.

## 27.2 Name

```java
String name = principal.getName();
```

This may be username, subject, client ID, or runtime-specific.

## 27.3 Do not assume format

For OIDC/JWT, principal name may be:

- `sub`;
- username;
- email;
- client ID;
- configured claim.

## 27.4 Convert to app user

```java
CurrentUser user = currentUserResolver.from(security);
```

## 27.5 Missing principal

If endpoint requires auth, missing principal should be caught by security layer.

Still defensive code can help.

## 27.6 Rule

Principal name is identity input; map it to application identity model explicitly.

---

# 28. `SecurityContext#isUserInRole()` dan Role-Based Authorization

## 28.1 Basic use

```java
if (!security.isUserInRole("ADMIN")) {
    throw new ForbiddenException();
}
```

## 28.2 Role source

Roles/groups can come from:

- container;
- Jakarta Security identity store;
- JWT claims;
- LDAP;
- Keycloak group/role mapping;
- custom filter.

## 28.3 Role is coarse

Role check says:

```text
caller has role X
```

It does not answer:

```text
can caller access customer C001?
```

## 28.4 Domain policy

```java
authorizationService.assertCanViewCustomer(user, customerId);
```

## 28.5 Scopes vs roles

OAuth scopes are not identical to app roles.

Do mapping explicitly.

## 28.6 Rule

Use roles for coarse endpoint gate; use domain authorization for resource-level decisions.

---

# 29. `SecurityContext#isSecure()` di Belakang TLS Termination

## 29.1 `isSecure`

Returns whether request was made using secure channel such as HTTPS.

## 29.2 Behind proxy

If TLS terminates at gateway, internal request to app may be HTTP.

`isSecure()` may return false unless server/runtime honors forwarded proto.

## 29.3 Security bug

App may generate insecure links or reject request incorrectly.

## 29.4 Configure forwarded headers

Server/gateway must be configured.

## 29.5 Do not blindly trust headers

Only trusted proxy should set/forward.

## 29.6 Rule

Test `isSecure()` behavior in actual deployment topology.

---

# 30. `SecurityContext#getAuthenticationScheme()`

## 30.1 Scheme

```java
String scheme = security.getAuthenticationScheme();
```

Examples:

```text
BASIC
FORM
CLIENT_CERT
Bearer? runtime-specific
```

## 30.2 Use cases

- audit;
- metrics;
- conditional behavior by auth method;
- debugging.

## 30.3 Caution

For OAuth2/JWT, scheme value may be runtime-specific.

## 30.4 Do not base business policy solely on scheme

Better use authenticated identity/claims.

## 30.5 Audit

Store scheme if useful, but not credentials.

---

# 31. `SecurityContext` vs Domain Authorization

## 31.1 Bad

```java
if (security.isUserInRole("OFFICER")) {
    return service.getCase(caseId);
}
```

This ignores whether officer assigned to that case.

## 31.2 Better

```java
CurrentUser user = currentUserResolver.resolve(security);
CaseDetail detail = caseService.getAccessibleCase(caseId, user);
```

## 31.3 Domain policy

```java
policy.assertCanViewCase(user, case);
```

## 31.4 Multi-tenant policy

Ensure tenant from token/path/header matches resource tenant.

## 31.5 Error strategy

- not authenticated → 401;
- authenticated but forbidden → 403;
- hidden resource policy → 404.

## 31.6 Rule

`SecurityContext` identifies caller; domain service authorizes action.

---

# 32. `Providers`: Runtime Provider Lookup

`Providers` is injectable interface for runtime lookup of provider instances.

## 32.1 Injection

```java
@Context
Providers providers;
```

## 32.2 Capabilities

Lookup:

- `MessageBodyReader`;
- `MessageBodyWriter`;
- `ExceptionMapper`;
- `ContextResolver`.

## 32.3 Advanced tool

Most resource methods do not need `Providers`.

It is mostly useful in:

- custom providers;
- filters/interceptors;
- advanced serialization logic;
- framework/infrastructure code.

## 32.4 Runtime-dependent registry

It uses currently registered providers.

## 32.5 Null

Methods may return null if no provider found.

## 32.6 Rule

Use `Providers` sparingly; do not manually reimplement JAX-RS dispatch.

---

# 33. `Providers#getMessageBodyReader/Writer`

## 33.1 Reader lookup

```java
MessageBodyReader<MyType> reader =
    providers.getMessageBodyReader(
        MyType.class,
        MyType.class,
        annotations,
        MediaType.APPLICATION_JSON_TYPE
    );
```

## 33.2 Writer lookup

```java
MessageBodyWriter<MyType> writer =
    providers.getMessageBodyWriter(
        MyType.class,
        MyType.class,
        annotations,
        MediaType.APPLICATION_JSON_TYPE
    );
```

## 33.3 Use cases

- custom wrapper provider delegates to actual JSON provider;
- custom envelope/de-envelope;
- diagnostics;
- fallback serialization.

## 33.4 Danger

Manual provider invocation can be tricky:

- stream handling;
- annotations;
- generic type;
- media type;
- interceptors;
- priority;
- lifecycle.

## 33.5 Recommendation

Let runtime select providers normally.

Use lookup only in provider infrastructure code.

---

# 34. `Providers#getExceptionMapper`

## 34.1 Lookup

```java
ExceptionMapper<MyException> mapper =
    providers.getExceptionMapper(MyException.class);
```

## 34.2 Use cases

- custom infrastructure that wants to delegate error mapping;
- nested provider behavior;
- testing/diagnostics.

## 34.3 Caution

Exception mapper selection has specificity rules.

Provider lookup behavior follows runtime registry.

## 34.4 Avoid in resource

Do not manually call exception mapper in resource method.

Instead throw exception and let runtime handle.

## 34.5 Rule

Exception mappers are runtime error boundary; don't bypass runtime unless building infrastructure.

---

# 35. `Providers#getContextResolver`

## 35.1 ContextResolver

A provider that supplies context object for type/media.

Often used for:

- JSON-B config;
- JAXB/Jackson config;
- custom serialization config.

## 35.2 Lookup

```java
ContextResolver<Jsonb> resolver =
    providers.getContextResolver(Jsonb.class, MediaType.APPLICATION_JSON_TYPE);
```

## 35.3 Use cases

- custom message body reader/writer needing config;
- serialization provider customization.

## 35.4 Caution

Do not scatter serialization config lookup across resources.

Keep in provider layer.

## 35.5 Rule

ContextResolver is provider infrastructure, not business API.

---

# 36. Kapan Memakai `Providers`, Kapan Tidak

## 36.1 Use `Providers` when

- writing custom `MessageBodyReader`/`Writer`;
- writing wrapper/envelope provider;
- building framework-level extension;
- debugging provider selection;
- integrating with `ContextResolver`.

## 36.2 Avoid when

- normal resource method;
- service/domain layer;
- manual serialization in endpoint;
- manual exception mapping.

## 36.3 Bad

```java
public Response get(@Context Providers providers) {
    MessageBodyWriter<Customer> writer = providers.getMessageBodyWriter(...);
    ...
}
```

Why are you manually writing body?

## 36.4 Better

```java
return Response.ok(customerResponse).build();
```

Let runtime handle.

## 36.5 Rule

`Providers` is an escape hatch for infrastructure code.

---

# 37. `ResourceContext`: Managed Subresource Instantiation

`ResourceContext` provides access to instances of resource classes.

## 37.1 Injection

```java
@Context
ResourceContext resourceContext;
```

## 37.2 Why exists

Subresource locator often returns object.

Manual `new` can bypass injection/lifecycle.

`ResourceContext` lets runtime create/initialize managed resource.

## 37.3 Example

```java
@Path("/customers/{customerId}")
public class CustomerResource {

    @Context
    ResourceContext resourceContext;

    @Path("/orders")
    public CustomerOrdersResource orders() {
        return resourceContext.getResource(CustomerOrdersResource.class);
    }
}
```

## 37.4 Subresource

```java
public class CustomerOrdersResource {

    @PathParam("customerId")
    CustomerId customerId;

    @Inject
    OrderService service;

    @GET
    public List<OrderResponse> list() { ... }
}
```

## 37.5 Benefit

Subresource can be properly initialized and managed in current request scope.

## 37.6 Rule

Use `ResourceContext` instead of `new` when subresource needs injection/context/lifecycle.

---

# 38. `ResourceContext#getResource()`

## 38.1 Method

```java
<T> T getResource(Class<T> resourceClass)
```

Returns resolved resource/subresource instance.

## 38.2 Scope

Resolved instance properly initialized in current request processing scope.

For JAX-RS-managed resources, default scope is per-request.

## 38.3 Null

May return null if resource cannot be resolved.

Handle carefully.

## 38.4 Use case

Subresource locator.

```java
@Path("/items")
public ItemsResource items() {
    return resourceContext.getResource(ItemsResource.class);
}
```

## 38.5 Avoid caching returned resource

It is request-scoped.

Do not store in static/global field.

## 38.6 Test

Integration test to verify injection works.

---

# 39. `ResourceContext#initResource()`

## 39.1 Method

```java
<T> T initResource(T resource)
```

Initializes a resource/subresource instance.

All JAX-RS injectable fields are initialized in current request context.

## 39.2 Example

```java
@Path("/orders")
public OrderSubResource orders(@PathParam("customerId") CustomerId id) {
    OrderSubResource resource = new OrderSubResource(id);
    return resourceContext.initResource(resource);
}
```

## 39.3 Use case

You need constructor argument not managed by runtime, but still want JAX-RS injection.

## 39.4 CDI caution

`initResource()` initializes JAX-RS injectable fields, but manual construction may still bypass CDI lifecycle/interceptors depending runtime.

If CDI dependencies needed, prefer `getResource()` or CDI `Instance`.

## 39.5 Recommendation

Use `getResource()` where possible.

Use `initResource()` for controlled hybrid cases.

## 39.6 Test carefully

Subresource lifecycle differs by runtime.

---

# 40. `ResourceContext` vs Manual `new`

## 40.1 Manual new

```java
return new CustomerOrdersResource(customerId);
```

Risks:

- `@Context` fields not initialized;
- `@PathParam` fields not initialized;
- CDI `@Inject` not injected;
- interceptors not applied;
- lifecycle callbacks not run.

## 40.2 ResourceContext

```java
return resourceContext.getResource(CustomerOrdersResource.class);
```

Runtime-managed.

## 40.3 Constructor argument problem

If subresource requires parent ID constructor, consider:

- inject parent ID via `@PathParam`;
- use request-scoped context bean;
- use `initResource`;
- use CDI assisted creation carefully.

## 40.4 Best pattern

```java
public class CustomerOrdersResource {
    @PathParam("customerId")
    CustomerId customerId;
}
```

or method param in subresource methods.

## 40.5 Rule

Manual `new` is okay only for simple stateless objects not needing injection/context.

---

# 41. `Application`, `Configuration`, dan Runtime Config Context

## 41.1 Application

```java
@Context
Application application;
```

Gives JAX-RS application object.

Use sparingly.

## 41.2 Configuration

```java
@Context
Configuration configuration;
```

Gives runtime configuration information.

## 41.3 Use cases

- inspect registered features/properties;
- provider behavior;
- diagnostic endpoints;
- infrastructure code.

## 41.4 Avoid business logic dependence

Do not make domain behavior depend on JAX-RS configuration.

## 41.5 Implementation-specific properties

Many config properties are vendor-specific.

Document if used.

## 41.6 Rule

Configuration context is for runtime/infrastructure, not application business state.

---

# 42. Servlet Bridge: `HttpServletRequest`, `HttpServletResponse`, `ServletContext`, `ServletConfig`

In Servlet-based runtime, JAX-RS may support injecting Servlet objects.

## 42.1 Example

```java
@Context
HttpServletRequest servletRequest;
```

## 42.2 Use cases

- migration from Servlet apps;
- session access;
- low-level attributes;
- remote address;
- servlet-specific integration;
- legacy security context.

## 42.3 Portability cost

Servlet bridge assumes Servlet environment.

Not portable to non-servlet JAX-RS runtime.

## 42.4 Prefer standard JAX-RS context

Use:

- `UriInfo` instead of servlet request URI;
- `HttpHeaders` instead of servlet headers;
- `SecurityContext` instead of servlet principal;
- JAX-RS filters instead of servlet filters when resource-aware.

## 42.5 When acceptable

- app is explicitly Servlet/Jakarta EE WAR;
- legacy integration;
- unavoidable container feature.

## 42.6 Rule

Servlet bridge is an escape hatch; standard JAX-RS context is more portable.

---

# 43. Portability Cost dari Servlet Bridge

## 43.1 Vendor/framework migration

If resource depends on `HttpServletRequest`, migration to embedded non-servlet runtime becomes harder.

## 43.2 Testing

Unit/integration tests need servlet mocks/runtime.

## 43.3 Hidden behavior

Servlet attributes/sessions may not exist in all contexts.

## 43.4 Security

Servlet session/cookie handling may interact with JAX-RS security.

## 43.5 Recommendation

Wrap servlet-specific access behind adapter.

```java
@ApplicationScoped
public class ClientIpResolver {
    public ClientIp resolve(HttpHeaders headers, HttpServletRequest req) { ... }
}
```

Still keep resource clean.

## 43.6 Rule

If using Servlet context, document it as runtime coupling.

---

# 44. Context Injection di Filters, Interceptors, Providers

Context injection is not only for resources.

## 44.1 Request filter

```java
@Provider
public class CorrelationFilter implements ContainerRequestFilter {

    @Context
    HttpHeaders headers;

    @Override
    public void filter(ContainerRequestContext ctx) {
        String correlationId = headers.getHeaderString("X-Correlation-ID");
        ...
    }
}
```

## 44.2 Response filter

Can access headers/security/uri context within request.

## 44.3 Exception mapper

```java
@Provider
public class ProblemMapper implements ExceptionMapper<Throwable> {

    @Context
    UriInfo uriInfo;

    @Override
    public Response toResponse(Throwable ex) {
        String path = uriInfo.getPath();
        ...
    }
}
```

## 44.4 MessageBodyReader/Writer

Can use `Providers`, `HttpHeaders`, etc.

## 44.5 Constructor warning

Do not call request methods in provider constructor.

## 44.6 Rule

Context is usable during request callback, not provider construction.

---

# 45. Context Injection dan Async/Other Threads

## 45.1 Problem

Request context may not automatically propagate to background threads.

Bad:

```java
@GET
public void async(@Context UriInfo uriInfo) {
    executor.submit(() -> {
        uriInfo.getPath(); // may fail or wrong context
    });
}
```

## 45.2 Capture data, not context object

Good:

```java
String path = uriInfo.getPath();
String correlationId = headers.getHeaderString("X-Correlation-ID");

executor.submit(() -> {
    log.info("path {}", path);
});
```

## 45.3 Use managed executor/context propagation

In Jakarta EE, use Jakarta Concurrency or runtime-supported context propagation.

## 45.4 Security context

Do not assume principal propagates.

Capture app-level identity:

```java
CurrentUser user = currentUserResolver.resolve(security);
```

## 45.5 AsyncResponse

If using JAX-RS async, understand lifecycle and context availability.

## 45.6 Rule

Do not pass `UriInfo`, `HttpHeaders`, or `SecurityContext` to background/domain code. Extract immutable app-level values.

---

# 46. Jangan Membocorkan HTTP Context ke Domain Layer

## 46.1 Bad service API

```java
public CustomerDetail get(UriInfo uriInfo, HttpHeaders headers, SecurityContext security) { ... }
```

## 46.2 Problems

- domain tied to HTTP;
- hard unit tests;
- hidden dependency on request scope;
- impossible reuse from messaging/batch;
- poor layering;
- security policy mixed with transport.

## 46.3 Better

```java
public CustomerDetail get(CustomerId id, CurrentUser user, TenantId tenant) { ... }
```

## 46.4 Resource translation

```java
CurrentUser user = currentUserResolver.resolve(security);
TenantId tenant = tenantResolver.resolve(headers, security);

CustomerDetail detail = service.get(customerId, user, tenant);
```

## 46.5 Domain event

Do not put raw headers into domain events.

Use:

```java
CorrelationId
ActorId
TenantId
```

## 46.6 Rule

Context objects stop at boundary.

---

# 47. Pattern: RequestMetadata / RequestContext Bean

A clean pattern is to convert HTTP context into app context once.

## 47.1 Bean

```java
@RequestScoped
public class RequestMetadata {
    private CorrelationId correlationId;
    private TenantId tenantId;
    private CurrentUser currentUser;

    // getters/setters
}
```

## 47.2 Filter populates

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class RequestMetadataFilter implements ContainerRequestFilter {

    @Inject
    RequestMetadata metadata;

    @Context
    HttpHeaders headers;

    @Context
    SecurityContext security;

    @Override
    public void filter(ContainerRequestContext ctx) {
        metadata.setCorrelationId(resolveCorrelationId(headers));
        metadata.setCurrentUser(resolveCurrentUser(security));
        metadata.setTenantId(resolveTenant(headers, security));
    }
}
```

## 47.3 Resource uses

```java
@Inject
RequestMetadata metadata;

@GET
public Response get(@PathParam("customerId") CustomerId id) {
    CustomerDetail detail = service.get(id, metadata.currentUser(), metadata.tenantId());
    ...
}
```

## 47.4 Benefits

- services do not depend on HTTP;
- consistent resolution;
- testable;
- avoids repeating header parsing;
- centralizes security/tenant/correlation.

## 47.5 Caution

Request-scoped bean in async/background needs context propagation.

## 47.6 Rule

Translate once, use typed metadata everywhere.

---

# 48. Pattern: Correlation ID dari Header ke Request Scope

## 48.1 Header

```http
X-Correlation-ID: abc-123
```

## 48.2 Filter

```java
@Provider
public class CorrelationIdFilter implements ContainerRequestFilter, ContainerResponseFilter {

    @Inject
    RequestMetadata metadata;

    @Override
    public void filter(ContainerRequestContext request) {
        String raw = request.getHeaderString("X-Correlation-ID");
        CorrelationId id = CorrelationId.fromOrGenerate(raw);
        metadata.setCorrelationId(id);
        request.setProperty("correlationId", id.value());
    }

    @Override
    public void filter(ContainerRequestContext request, ContainerResponseContext response) {
        response.getHeaders().putSingle("X-Correlation-ID", metadata.getCorrelationId().value());
    }
}
```

## 48.3 Validation

Limit length and allowed characters.

## 48.4 Logging

Put correlation ID into MDC/log context.

Clear after request.

## 48.5 Security

Correlation ID is not authentication.

Do not trust it for identity.

## 48.6 Rule

Correlation ID should be propagated and returned, but sanitized.

---

# 49. Pattern: Tenant Resolution

## 49.1 Sources

Tenant can come from:

- JWT claim;
- mTLS client cert;
- path param;
- trusted gateway header;
- subdomain;
- explicit admin path.

## 49.2 Resolver

```java
@ApplicationScoped
public class TenantResolver {
    public TenantId resolve(HttpHeaders headers, SecurityContext security) {
        ...
    }
}
```

## 49.3 Resource

```java
TenantId tenant = tenantResolver.resolve(headers, security);
service.search(tenant, query);
```

## 49.4 Security

If tenant also appears in path:

```text
/tenants/{tenantId}/customers
```

verify principal may access that tenant.

## 49.5 Do not trust header blindly

Only trusted infrastructure can set tenant header.

## 49.6 Rule

Tenant resolution is security-sensitive and should be centralized.

---

# 50. Testing Context Injection

## 50.1 Unit test resource

Mock/stub `UriInfo`, `HttpHeaders`, `SecurityContext`.

But mocks can be tedious.

## 50.2 Integration test

Better for context behavior:

- actual path;
- actual headers;
- actual security context if possible;
- actual `Location`;
- actual ETag.

## 50.3 Test UriInfo

- base URI;
- request URI;
- query params;
- generated `Location`;
- matched template.

## 50.4 Test HttpHeaders

- duplicate headers;
- Accept language;
- cookies;
- content type.

## 50.5 Test Request

- `If-None-Match`;
- `If-Match`;
- `If-Modified-Since`;
- response `304`/`412`.

## 50.6 Test SecurityContext

- unauthenticated;
- authenticated;
- roles;
- tenant mismatch.

## 50.7 Test ResourceContext

Subresource locator with injected dependencies.

## 50.8 Test gateway

For `UriInfo` external URL correctness.

---

# 51. Observability dan Context Objects

## 51.1 Route template

Use `UriInfo#getMatchedResourceTemplate`.

## 51.2 Headers

Use `HttpHeaders` or request context for correlation ID, user agent, accepted language.

## 51.3 Security

Use `SecurityContext` to derive actor ID, but don't log sensitive principal details without policy.

## 51.4 Request method

Use `Request#getMethod()` or container context.

## 51.5 Error mapper

Use `UriInfo`, correlation metadata, and exception type to build error response.

## 51.6 Redaction

Headers/cookies/query values often sensitive.

## 51.7 Metrics

Labels:

- method;
- route template;
- status;
- error code;
- auth scheme maybe low-cardinality;
- tenant category maybe bounded.

Avoid:

- raw path;
- raw query;
- user ID;
- customer ID;
- token.

---

# 52. Common Failure Modes

## 52.1 Calling `UriInfo` in provider constructor

Throws `IllegalStateException`.

## 52.2 Passing `SecurityContext` into background task

Context gone/wrong.

## 52.3 Generating internal `Location` URL

Gateway not configured.

## 52.4 Metrics raw URI

Cardinality explosion.

## 52.5 Manually parsing Accept

Wrong content negotiation.

## 52.6 Using `isUserInRole` as full authorization

Data-level access bug.

## 52.7 Trusting `X-Forwarded-*` from public client

Host header/link poisoning.

## 52.8 Manual `new` subresource

Injection missing.

## 52.9 Using `Providers` in resource to serialize manually

Bypasses runtime behavior.

## 52.10 Logging all headers/cookies

Credential leak.

## 52.11 Servlet bridge dependency everywhere

Portability loss.

## 52.12 Context object leaks into domain service

Layering violation.

---

# 53. Best Practices

## 53.1 Use context at boundary only

Translate to app-level objects.

## 53.2 Prefer standard context objects over servlet objects

`UriInfo`, `HttpHeaders`, `Request`, `SecurityContext`.

## 53.3 Use `Request` for conditional logic

Do not hand-roll ETag parsing unless needed.

## 53.4 Use `UriBuilder`

No manual URL concatenation.

## 53.5 Use route template for metrics

Use `getMatchedResourceTemplate` where available.

## 53.6 Centralize correlation/tenant/user resolution

Use filters and request-scoped metadata.

## 53.7 Test behind gateway

Especially generated links.

## 53.8 Use `ResourceContext` for managed subresources

Avoid manual `new`.

## 53.9 Treat headers/cookies as sensitive

Redact.

## 53.10 Keep domain HTTP-free

No `UriInfo`/`HttpHeaders`/`SecurityContext` in domain.

---

# 54. Anti-Patterns

## 54.1 `@Context` as service locator

Using context to access everything.

## 54.2 Domain receives `SecurityContext`

Business logic tied to HTTP.

## 54.3 Calling context in constructor

Request scope not active.

## 54.4 Manual header parsing everywhere

Duplication and bugs.

## 54.5 `HttpServletRequest` everywhere

Portability loss.

## 54.6 Raw URI metrics

High cardinality.

## 54.7 Trusting forwarded headers blindly

Security bug.

## 54.8 Manual subresource `new`

Injection/lifecycle bug.

## 54.9 Using `Providers` to bypass runtime

Complex and fragile.

## 54.10 Passing context across threads

Scope/lifecycle bug.

---

# 55. Production Checklist

## 55.1 Context usage

- [ ] Context objects used only at REST/infrastructure boundary.
- [ ] No context object in domain model.
- [ ] No request context method called in constructors.
- [ ] No context object passed to background tasks.
- [ ] Request data extracted into immutable/app-level values.

## 55.2 URI

- [ ] `Location` headers tested.
- [ ] Pagination links tested.
- [ ] Gateway external URL tested.
- [ ] Forwarded headers configured safely.
- [ ] `UriBuilder` used.

## 55.3 Headers

- [ ] Sensitive headers redacted.
- [ ] Duplicate critical headers handled.
- [ ] `Accept`/language parsing uses helpers.
- [ ] Cookies handled securely.

## 55.4 Conditional requests

- [ ] ETag generated consistently.
- [ ] `If-None-Match` tested.
- [ ] `If-Match` tested.
- [ ] `304`/`412` responses correct.

## 55.5 Security

- [ ] Principal mapped to app user.
- [ ] Roles not used as only authorization.
- [ ] Tenant resolution centralized.
- [ ] `isSecure()` tested behind TLS termination.

## 55.6 Subresource

- [ ] `ResourceContext` used if subresource needs injection.
- [ ] Manual `new` justified/tested.
- [ ] Subresource injection tested.

## 55.7 Observability

- [ ] Matched resource template used.
- [ ] No raw IDs in metrics.
- [ ] Correlation ID propagated.
- [ ] Error responses include correlation ID.

---

# 56. Latihan

## Latihan 1 — UriInfo Lab

Buat endpoint:

```text
GET /customers/{customerId}/orders/{orderId}?include=items
```

Log/return safely:

- base URI;
- request URI;
- absolute path;
- path;
- path params;
- query params;
- matched template.

## Latihan 2 — Location Header

Implement:

```text
POST /customers
```

Return:

```text
201 Created
Location: /customers/{id}
```

Test direct runtime dan behind gateway.

## Latihan 3 — Conditional GET

Implement ETag:

```text
GET /customers/{id}
If-None-Match
```

Return `304` when unchanged.

## Latihan 4 — Conditional PUT

Implement:

```text
PUT /customers/{id}
If-Match
```

Return `412` if stale.

## Latihan 5 — SecurityContext Mapping

Create `CurrentUserResolver` from `SecurityContext`.

Do not pass `SecurityContext` to service.

## Latihan 6 — Role vs Domain Policy

Create endpoint where role is necessary but not sufficient.

Implement domain policy check.

## Latihan 7 — ResourceContext Subresource

Create subresource locator.

First return `new`.

Observe missing injection.

Then refactor to `ResourceContext#getResource`.

## Latihan 8 — Header Redaction

Implement request logging filter that logs safe headers only.

Redact Authorization/Cookie.

## Latihan 9 — RequestMetadata

Create request-scoped metadata bean with:

- correlation ID;
- tenant ID;
- current user.

Populate via filter.

Use in resource/service.

---

# 57. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 — `Context` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/context

2. Jakarta RESTful Web Services 4.0 — `UriInfo` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/uriinfo

3. Jakarta RESTful Web Services 4.0 — `HttpHeaders` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/httpheaders

4. Jakarta RESTful Web Services 4.0 — `Request` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/request

5. Jakarta RESTful Web Services 4.0 — `SecurityContext` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/securitycontext

6. Jakarta RESTful Web Services 4.0 — `Providers` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/providers

7. Jakarta RESTful Web Services 4.0 — `ResourceContext` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/resourcecontext

8. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

9. RFC 9110 — HTTP Semantics  
   https://www.rfc-editor.org/rfc/rfc9110.html

10. RFC 9111 — HTTP Caching  
    https://www.rfc-editor.org/rfc/rfc9111.html

---

# 58. Penutup

`@Context` adalah fitur yang sangat kuat karena memberi akses ke metadata request/runtime.

Namun kekuatan ini harus dibatasi.

Mental model utama:

```text
@Context = access to HTTP/JAX-RS runtime metadata
@Inject  = application dependency injection
```

Gunakan context untuk:

- URI/path/query/matched template;
- headers/cookies/content negotiation;
- conditional requests;
- principal/role/auth scheme;
- provider lookup dalam infrastructure code;
- managed subresource creation.

Jangan gunakan context untuk:

- menggantikan service dependency;
- membawa HTTP object ke domain layer;
- melakukan authorization hanya dengan role check;
- menyimpan request object untuk background task;
- logging semua header/cookie;
- manual serialization/error dispatch tanpa alasan kuat.

Prinsip final:

```text
Read HTTP context at the edge.
Translate it into typed application context.
Keep domain code HTTP-free.
```

Part berikutnya:

```text
Bagian 009 — Request Entity Binding: Input Entity, Streams, Readers, DTO Boundary
```

Kita akan membahas bagaimana request body dibaca: entity parameter, `InputStream`, JSON DTO, form body, stream one-time read, payload limits, large request strategy, DTO boundary, and `MessageBodyReader` interaction.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-007.md](./learn-jaxrs-advanced-part-007.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-009.md](./learn-jaxrs-advanced-part-009.md)
