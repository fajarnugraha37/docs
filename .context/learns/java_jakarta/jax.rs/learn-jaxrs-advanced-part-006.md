# learn-jaxrs-advanced-part-006.md

# Bagian 006 — Parameter Injection: `@PathParam`, `@QueryParam`, `@HeaderParam`, `@CookieParam`, `@MatrixParam`, `@DefaultValue`, `@BeanParam`

> Target pembaca: Java/Jakarta engineer yang ingin menguasai **parameter injection** di JAX-RS/Jakarta REST bukan hanya sebagai “cara ambil query param”, tetapi sebagai boundary conversion mechanism dari HTTP metadata menjadi tipe Java yang aman, jelas, tervalidasi, observable, dan production-friendly.
>
> Namespace utama: `jakarta.ws.rs.*`; legacy mapping: `javax.ws.rs.*`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Parameter Injection adalah Boundary Conversion](#2-mental-model-parameter-injection-adalah-boundary-conversion)
3. [Jenis-Jenis Parameter Injection](#3-jenis-jenis-parameter-injection)
4. [Injection Target: Method Parameter, Field, Bean Property](#4-injection-target-method-parameter-field-bean-property)
5. [Lifecycle Constraint: Kenapa Field Injection Request Param Berbahaya pada Singleton](#5-lifecycle-constraint-kenapa-field-injection-request-param-berbahaya-pada-singleton)
6. [`@PathParam`: URI Template Parameter](#6-pathparam-uri-template-parameter)
7. [`@PathParam` dengan `PathSegment`](#7-pathparam-dengan-pathsegment)
8. [Latest Scope Rule pada `@PathParam`](#8-latest-scope-rule-pada-pathparam)
9. [`@QueryParam`: Query String Binding](#9-queryparam-query-string-binding)
10. [Repeated Query Params dan Collection Binding](#10-repeated-query-params-dan-collection-binding)
11. [Single Value vs Multiple Values: First Lexical Value Rule](#11-single-value-vs-multiple-values-first-lexical-value-rule)
12. [`@HeaderParam`: HTTP Header Binding](#12-headerparam-http-header-binding)
13. [Header Case-Insensitive dan Multi-Value Header](#13-header-case-insensitive-dan-multi-value-header)
14. [`@CookieParam`: Cookie Binding](#14-cookieparam-cookie-binding)
15. [Cookie Value vs `Cookie` Object](#15-cookie-value-vs-cookie-object)
16. [`@MatrixParam`: Matrix Parameter Binding](#16-matrixparam-matrix-parameter-binding)
17. [Matrix Param Last Matched Segment Rule](#17-matrix-param-last-matched-segment-rule)
18. [`@DefaultValue`: Missing Metadata Default](#18-defaultvalue-missing-metadata-default)
19. [Default Value vs Empty String vs Invalid Value](#19-default-value-vs-empty-string-vs-invalid-value)
20. [`@BeanParam`: Parameter Aggregator](#20-beanparam-parameter-aggregator)
21. [Designing Query Parameter Object](#21-designing-query-parameter-object)
22. [`@BeanParam` + Jakarta Validation](#22-beanparam--jakarta-validation)
23. [Built-In Conversion Rules](#23-built-in-conversion-rules)
24. [Primitive, Wrapper, Constructor, `valueOf`, `fromString`](#24-primitive-wrapper-constructor-valueof-fromstring)
25. [Collection and Array Conversion](#25-collection-and-array-conversion)
26. [Read-Only Collection Injection](#26-read-only-collection-injection)
27. [Conversion Failure: 400 atau 404?](#27-conversion-failure-400-atau-404)
28. [`ParamConverterProvider` dan Custom Domain Types](#28-paramconverterprovider-dan-custom-domain-types)
29. [Kapan Pakai Custom Converter, Kapan Jangan](#29-kapan-pakai-custom-converter-kapan-jangan)
30. [Value Object ID: `CustomerId`, `OrderId`, `TenantId`](#30-value-object-id-customerid-orderid-tenantid)
31. [`@Encoded`: Encoded vs Decoded Parameter Values](#31-encoded-encoded-vs-decoded-parameter-values)
32. [Parameter Name Encoding Rules](#32-parameter-name-encoding-rules)
33. [`UriInfo` vs `@QueryParam`](#33-uriinfo-vs-queryparam)
34. [`HttpHeaders` vs `@HeaderParam`](#34-httpheaders-vs-headerparam)
35. [`CookieParam` vs `HttpHeaders#getCookies()`](#35-cookieparam-vs-httpheadersgetcookies)
36. [Form Param dan Kenapa Tidak Jadi Fokus Part Ini](#36-form-param-dan-kenapa-tidak-jadi-fokus-part-ini)
37. [Parameter Injection + Security Context](#37-parameter-injection--security-context)
38. [Parameter Injection + Multi-Tenancy](#38-parameter-injection--multi-tenancy)
39. [Parameter Injection + Pagination/Filtering/Sorting](#39-parameter-injection--paginationfilteringsorting)
40. [Parameter Injection + Conditional Requests](#40-parameter-injection--conditional-requests)
41. [Parameter Injection + Idempotency-Key](#41-parameter-injection--idempotency-key)
42. [Parameter Injection + Observability](#42-parameter-injection--observability)
43. [Testing Parameter Injection](#43-testing-parameter-injection)
44. [Common Failure Modes](#44-common-failure-modes)
45. [Best Practices](#45-best-practices)
46. [Anti-Patterns](#46-anti-patterns)
47. [Production Checklist](#47-production-checklist)
48. [Latihan](#48-latihan)
49. [Referensi Resmi](#49-referensi-resmi)
50. [Penutup](#50-penutup)

---

# 1. Tujuan Part Ini

Part ini membahas cara JAX-RS mengambil data dari request HTTP dan menyuntikkannya ke kode Java.

Contoh sederhana:

```java
@GET
@Path("/customers/{customerId}")
public CustomerResponse get(
    @PathParam("customerId") String customerId,
    @QueryParam("include") List<String> include,
    @HeaderParam("If-None-Match") String ifNoneMatch
) {
    ...
}
```

Namun di production, parameter injection jauh lebih dalam daripada “ambil string”.

Kamu harus memahami:

- dari mana data berasal;
- kapan nilainya decoded;
- bagaimana conversion ke tipe Java dilakukan;
- apa yang terjadi jika param tidak ada;
- apa yang terjadi jika param ada berkali-kali;
- bagaimana default value bekerja;
- bagaimana collection binding bekerja;
- kapan field injection aman/tidak aman;
- kapan harus memakai `@BeanParam`;
- kapan harus memakai `UriInfo`/`HttpHeaders`;
- bagaimana memetakan conversion error ke error contract;
- bagaimana menghindari security leak dan cardinality problem.

## 1.1 Prinsip utama

```text
Parameter injection is the first boundary where untrusted HTTP metadata becomes typed Java input.
```

Kalau boundary ini didesain asal-asalan, downstream service/domain akan menerima input yang ambigu, tidak tervalidasi, atau salah semantics.

## 1.2 Target akhir

Setelah part ini, kamu bisa mendesain signature resource method yang:

- jelas;
- aman;
- typed;
- tervalidasi;
- mudah dites;
- tidak bergantung lifecycle yang salah;
- tidak menyembunyikan complexity;
- mudah didokumentasikan OpenAPI.

---

# 2. Mental Model: Parameter Injection adalah Boundary Conversion

HTTP request membawa banyak metadata dalam bentuk string.

```http
GET /customers/C001/orders?page=1&size=20&status=ACTIVE&status=PENDING
If-None-Match: "v3"
Cookie: session=abc
```

JAX-RS mengkonversi ini menjadi Java input:

```java
@PathParam("customerId") CustomerId customerId
@QueryParam("page") int page
@QueryParam("size") int size
@QueryParam("status") List<OrderStatus> statuses
@HeaderParam("If-None-Match") String ifNoneMatch
@CookieParam("session") Cookie sessionCookie
```

## 2.1 HTTP metadata is untrusted

Semua param dari client harus dianggap:

- bisa hilang;
- bisa kosong;
- bisa malformed;
- bisa duplikat;
- bisa terlalu panjang;
- bisa encoded aneh;
- bisa malicious;
- bisa tidak authorized.

## 2.2 Injection bukan validation lengkap

Injection/conversion menjawab:

```text
Can this string become this Java type?
```

Validation menjawab:

```text
Is this value allowed by boundary contract?
```

Business rules menjawab:

```text
Is this operation allowed in current domain state?
```

## 2.3 Example layers

```text
"20" → int 20                  // conversion
20 <= maxPageSize              // validation
user allowed to see this page  // authorization/business
```

## 2.4 Jangan overload converter

Converter tidak boleh melakukan database lookup atau authorization.

Bad:

```java
@PathParam("customerId") Customer customer
```

jika converter lookup DB.

Better:

```java
@PathParam("customerId") CustomerId customerId
```

Lalu service:

```java
customerService.get(customerId)
```

## 2.5 Resource method signature sebagai API documentation

Signature ini menceritakan HTTP contract.

Good:

```java
public PageResponse<OrderResponse> list(
    @PathParam("customerId") CustomerId customerId,
    @BeanParam OrderQueryParams query,
    @HeaderParam("If-None-Match") String ifNoneMatch
)
```

Bad:

```java
public Response list(@Context HttpServletRequest request)
```

Karena contract tersembunyi.

---

# 3. Jenis-Jenis Parameter Injection

## 3.1 URI path

```java
@PathParam
```

Source:

```text
/customers/{customerId}
```

## 3.2 Query string

```java
@QueryParam
```

Source:

```text
/customers?status=ACTIVE
```

## 3.3 Header

```java
@HeaderParam
```

Source:

```http
If-Match: "v1"
```

## 3.4 Cookie

```java
@CookieParam
```

Source:

```http
Cookie: session=abc
```

## 3.5 Matrix parameter

```java
@MatrixParam
```

Source:

```text
/cars;color=red
```

## 3.6 Form parameter

```java
@FormParam
```

Source:

```text
application/x-www-form-urlencoded
multipart/form-data
```

Kita akan singgung, tapi detail form/multipart punya part sendiri.

## 3.7 Bean aggregator

```java
@BeanParam
```

Aggregates multiple params into one object.

## 3.8 Context

```java
@Context
```

Not `@XxxParam`, but related for retrieving request context:

- `UriInfo`;
- `HttpHeaders`;
- `Request`;
- `SecurityContext`.

---

# 4. Injection Target: Method Parameter, Field, Bean Property

JAX-RS param annotations can target:

- resource method parameter;
- resource class field;
- resource class bean property setter.

## 4.1 Method parameter

Recommended for request-specific values.

```java
@GET
@Path("/{id}")
public CustomerResponse get(@PathParam("id") CustomerId id) {
    ...
}
```

## 4.2 Field

```java
@Path("/customers/{id}")
public class CustomerResource {

    @PathParam("id")
    CustomerId id;

    @GET
    public CustomerResponse get() { ... }
}
```

Works under default per-request lifecycle.

## 4.3 Bean property setter

```java
private CustomerId id;

@PathParam("id")
public void setId(CustomerId id) {
    this.id = id;
}
```

## 4.4 Recommendation

Use method parameters for request data.

Use constructor/field CDI injection for dependencies.

```java
@Inject CustomerService service;
```

Do not confuse dependency injection with request parameter injection.

## 4.5 Why method param is clearer

- visible at method boundary;
- safe with singleton/application scoped resources;
- easier tests;
- no hidden mutable state;
- better OpenAPI/tooling.

---

# 5. Lifecycle Constraint: Kenapa Field Injection Request Param Berbahaya pada Singleton

JAX-RS API docs repeat an important rule:

```text
Because injection occurs at object creation time, param annotations on resource class fields/properties are only supported for default per-request resource class lifecycle.
```

## 5.1 Default lifecycle

Default root resource class lifecycle creates new instance per request.

Field param injection can be safe.

## 5.2 Singleton problem

```java
@Path("/customers/{id}")
@ApplicationScoped
public class CustomerResource {

    @PathParam("id")
    String id; // dangerous

    @GET
    public CustomerResponse get() {
        return service.get(id);
    }
}
```

If instance shared by requests, `id` is mutable shared state.

## 5.3 Method param fix

```java
@GET
public CustomerResponse get(@PathParam("id") CustomerId id) {
    return service.get(id);
}
```

## 5.4 `@Context` exception nuance

Context proxies can be safe depending runtime because they resolve per request, but still prefer method parameters or request-scoped beans for clarity.

## 5.5 Rule

```text
Request metadata belongs in method parameters or request scope.
Never store request metadata in shared resource fields.
```

---

# 6. `@PathParam`: URI Template Parameter

`@PathParam` binds URI template parameter value.

## 6.1 Basic

```java
@Path("/customers/{customerId}")
public class CustomerResource {

    @GET
    public CustomerResponse get(@PathParam("customerId") String customerId) {
        ...
    }
}
```

Request:

```http
GET /customers/C001
```

Injected:

```text
customerId = "C001"
```

## 6.2 Decoding

Value is URL decoded unless disabled with `@Encoded`.

Request:

```text
/files/report%202026
```

Injected:

```text
report 2026
```

## 6.3 Default value

Can use `@DefaultValue`, but path params are usually required by route shape.

```java
@PathParam("id") @DefaultValue("UNKNOWN") String id
```

Rarely meaningful for path params.

## 6.4 Type conversion

Can inject:

```java
@PathParam("id") long id
@PathParam("id") UUID id
@PathParam("id") CustomerId id
```

if conversion rules satisfied.

## 6.5 Path param vs resource lookup

Good:

```java
@PathParam("customerId") CustomerId customerId
```

Bad:

```java
@PathParam("customerId") CustomerEntity customer
```

if converter queries DB.

## 6.6 Missing param

If route matched, path param exists.

If no route match, request fails earlier with 404.

## 6.7 Invalid conversion

If route matches but conversion fails:

```text
usually client error
```

Often `BadRequestException`/400 or implementation-specific mapping.

You should test and map consistently.

## 6.8 Path param names

Use domain names:

```java
@PathParam("customerId")
@PathParam("orderId")
```

not repeated generic `id` in nested paths.

---

# 7. `@PathParam` dengan `PathSegment`

`PathSegment` lets you access:

- segment path;
- matrix params on that segment.

## 7.1 Example

Request:

```text
GET /cars/C001;color=red
```

Resource:

```java
@GET
@Path("/cars/{car}")
public Response get(@PathParam("car") PathSegment carSegment) {
    String carId = carSegment.getPath();
    MultivaluedMap<String, String> matrix = carSegment.getMatrixParameters();
    ...
}
```

## 7.2 When useful

- matrix params are used;
- need segment-level metadata;
- need distinguish path value and matrix values.

## 7.3 List of PathSegment

If a template parameter captures multiple path segments in advanced regex, `List<PathSegment>` can represent corresponding segments.

## 7.4 Practical warning

Matrix parameters are rare and often problematic behind proxies.

## 7.5 Recommendation

Use `PathSegment` only if you truly need segment metadata.

For normal ID:

```java
@PathParam("customerId") CustomerId customerId
```

is clearer.

---

# 8. Latest Scope Rule pada `@PathParam`

If same template variable name appears at multiple scopes, injected value corresponds to latest use in scope.

## 8.1 Example

```java
@Path("/customers/{id}")
public class CustomerResource {

    @GET
    @Path("/orders/{id}")
    public Response getOrder(@PathParam("id") String id) {
        ...
    }
}
```

Request:

```text
/customers/C001/orders/O100
```

`@PathParam("id")` in method binds latest method-level `{id}`:

```text
O100
```

not customer ID.

## 8.2 This is confusing

Avoid reusing variable names in nested paths.

Better:

```java
@Path("/customers/{customerId}")
public class CustomerResource {

    @GET
    @Path("/orders/{orderId}")
    public Response getOrder(
        @PathParam("customerId") String customerId,
        @PathParam("orderId") String orderId
    ) { ... }
}
```

## 8.3 Rule

```text
Never reuse generic {id} across nested path scopes.
```

Use domain-specific names.

## 8.4 Testing

Add path param binding tests for nested resources.

---

# 9. `@QueryParam`: Query String Binding

`@QueryParam` binds HTTP query parameter values.

## 9.1 Basic

```java
@GET
@Path("/customers")
public PageResponse<CustomerResponse> list(
    @QueryParam("status") String status,
    @QueryParam("page") @DefaultValue("1") int page,
    @QueryParam("size") @DefaultValue("20") int size
) {
    ...
}
```

Request:

```text
/customers?status=ACTIVE&page=2&size=50
```

## 9.2 Query for filters/views

Use query params for:

- pagination;
- filtering;
- sorting;
- optional includes;
- projections;
- search criteria;
- representation modifiers.

## 9.3 Query param is decoded

Values are URL decoded unless `@Encoded`.

## 9.4 Parameter name decoded form

Annotation value is specified in decoded form.

If parameter name is `"a b"`, use:

```java
@QueryParam("a b")
```

not:

```java
@QueryParam("a+b")
@QueryParam("a%20b")
```

## 9.5 Missing query param

Object type becomes `null` unless `@DefaultValue`.

Primitive may become Java default? Avoid relying on ambiguous defaults; use `@DefaultValue` or wrapper types.

## 9.6 Empty query param

Request:

```text
/customers?status=
```

Parameter is present with empty string.

`@DefaultValue` is used when metadata is not present, not necessarily when empty.

Design policy for empty values.

## 9.7 Recommendation

Use query param object:

```java
@BeanParam CustomerQueryParams params
```

for complex endpoints.

---

# 10. Repeated Query Params dan Collection Binding

Query params can repeat.

```text
/orders?status=NEW&status=PAID&status=SHIPPED
```

## 10.1 Collection injection

```java
@QueryParam("status")
List<OrderStatus> statuses
```

Supported collection types include:

- `List<T>`;
- `Set<T>`;
- `SortedSet<T>`;
- `T[]`.

## 10.2 Read-only

Injected collection is read-only.

Do not mutate.

Copy if needed:

```java
List<OrderStatus> copy = List.copyOf(statuses);
```

## 10.3 Order

For `List`, order may reflect request order, but do not rely on it for semantics unless tested/documented.

## 10.4 Set

Use `Set` for uniqueness.

## 10.5 Empty vs missing

Missing list usually empty or null depending implementation? Test.

Safer:

```java
@DefaultValue("")
```

is not always ideal for collections.

Better handle null/empty in query object normalization.

## 10.6 Comma-separated alternative

Some APIs prefer:

```text
?status=NEW,PAID
```

JAX-RS default collection injection treats repeated parameters, not necessarily comma splitting.

If you want comma-splitting, implement parser/converter/query object logic.

## 10.7 Recommendation

For public APIs, choose one style:

```text
?status=NEW&status=PAID
```

or:

```text
?status=NEW,PAID
```

Document and test.

---

# 11. Single Value vs Multiple Values: First Lexical Value Rule

API docs state that if type is not collection/array and parameter has multiple values, the first value lexically is used for `@QueryParam`, `@HeaderParam`, and `@MatrixParam`.

## 11.1 Example

```java
@QueryParam("status")
String status
```

Request:

```text
/orders?status=NEW&status=PAID
```

Injected value:

```text
first value lexically
```

This can be surprising.

## 11.2 Better

If parameter may repeat, declare collection:

```java
@QueryParam("status") List<OrderStatus> statuses
```

## 11.3 Security concern

Attackers can exploit duplicate params.

Example:

```text
?role=user&role=admin
```

If gateway/security layer and app choose different value, auth bypass risk.

## 11.4 Recommendation

For params that must be single-valued, reject duplicates explicitly.

Use `UriInfo#getQueryParameters()` to inspect all values.

## 11.5 Example duplicate rejection

```java
MultivaluedMap<String, String> query = uriInfo.getQueryParameters();
List<String> values = query.get("page");
if (values != null && values.size() > 1) {
    throw new BadRequestException("Duplicate page parameter");
}
```

## 11.6 Rule

```text
Know whether every query/header/matrix parameter is single-valued or multi-valued.
```

---

# 12. `@HeaderParam`: HTTP Header Binding

`@HeaderParam` binds HTTP header values.

## 12.1 Basic

```java
@GET
public Response get(
    @HeaderParam("If-None-Match") String ifNoneMatch,
    @HeaderParam("Accept-Language") String acceptLanguage,
    @HeaderParam("X-Correlation-ID") String correlationId
) {
    ...
}
```

## 12.2 Header name case-insensitive

HTTP header field names are case-insensitive.

JAX-RS `@HeaderParam` name is case-insensitive.

## 12.3 Use for semantic headers

Good:

- `If-Match`;
- `If-None-Match`;
- `Idempotency-Key`;
- `Accept-Language`;
- `X-Correlation-ID`;
- `Prefer`;
- `Range`.

## 12.4 Avoid raw Authorization parsing in resource

Instead of:

```java
@HeaderParam("Authorization") String auth
```

prefer security integration/filter and `SecurityContext`.

Only parse Authorization in dedicated auth component/filter.

## 12.5 Multiple header values

Can inject collection:

```java
@HeaderParam("Accept-Language")
List<String> languages
```

But for complex standard headers, use `HttpHeaders` API when available.

## 12.6 Default

```java
@HeaderParam("X-Client-Version")
@DefaultValue("unknown")
String clientVersion
```

## 12.7 Header validation

Headers can be malicious/huge.

Set gateway/server limits.

## 12.8 Recommendation

Use `@HeaderParam` for simple, resource-specific header values.

Use `HttpHeaders` for complex negotiation/multi-value parsing.

---

# 13. Header Case-Insensitive dan Multi-Value Header

## 13.1 Case-insensitive names

These are equivalent:

```http
If-Match
if-match
IF-MATCH
```

## 13.2 Multi-value

Headers can be repeated or comma-combined depending header semantics.

Example:

```http
Accept: application/json
Accept: text/csv
```

or:

```http
Accept: application/json, text/csv
```

## 13.3 Not all headers comma-merge safely

Some headers have special syntax.

Be careful with:

- `Set-Cookie`;
- `Cookie`;
- authorization-related headers.

## 13.4 `HttpHeaders`

For standard headers, `HttpHeaders` has methods:

- `getAcceptableMediaTypes()`;
- `getAcceptableLanguages()`;
- `getCookies()`;
- `getRequestHeaders()`;
- `getHeaderString()`.

## 13.5 Recommendation

If header grammar is complex, do not parse manually in resource method.

## 13.6 Duplicate sensitive headers

Reject ambiguous duplicates for security-critical headers.

Example:

- duplicate `Idempotency-Key`;
- duplicate custom tenant header;
- duplicate auth header.

---

# 14. `@CookieParam`: Cookie Binding

`@CookieParam` binds cookie values.

## 14.1 Basic

```java
@GET
public Response get(@CookieParam("session") String sessionId) {
    ...
}
```

## 14.2 Cookie object

```java
@CookieParam("session")
Cookie sessionCookie
```

`Cookie` can expose metadata like name/value/version/domain/path depending representation.

## 14.3 Use cases

- browser session;
- CSRF token;
- user preference;
- feature flag cookie.

## 14.4 Security

Cookies are security-sensitive.

Consider:

- HttpOnly;
- Secure;
- SameSite;
- path/domain;
- CSRF;
- session fixation;
- rotation.

## 14.5 Do not trust cookie blindly

Validate session/token in security layer.

Resource should usually use `SecurityContext`.

## 14.6 Default value

```java
@CookieParam("theme")
@DefaultValue("light")
String theme
```

OK for non-security preference.

## 14.7 Avoid cookie for API clients

Machine-to-machine APIs usually use Authorization headers, not cookies.

## 14.8 Recommendation

Use `@CookieParam` sparingly in REST API resources; prefer security framework for auth cookies.

---

# 15. Cookie Value vs `Cookie` Object

## 15.1 String value

```java
@CookieParam("theme") String theme
```

Only cookie value.

## 15.2 Cookie object

```java
@CookieParam("session") Cookie cookie
```

Can access:

```java
cookie.getName()
cookie.getValue()
cookie.getPath()
cookie.getDomain()
cookie.getVersion()
```

depending available cookie data.

## 15.3 When use `Cookie`

Use when metadata matters.

## 15.4 For setting cookie

`@CookieParam` reads cookies.

To set cookie, use response:

```java
return Response.ok()
    .cookie(new NewCookie.Builder("theme")
        .value("dark")
        .path("/")
        .secure(true)
        .httpOnly(true)
        .sameSite(NewCookie.SameSite.STRICT)
        .build())
    .build();
```

Exact API depends Jakarta REST version.

## 15.5 Security cookie handling

Set cookies in dedicated auth/session component, not scattered across resources.

---

# 16. `@MatrixParam`: Matrix Parameter Binding

Matrix parameters are segment-scoped parameters in URI path.

Example:

```text
/cars;color=red;year=2026
```

## 16.1 Basic

```java
@Path("/cars")
public class CarResource {

    @GET
    public List<CarResponse> list(
        @MatrixParam("color") String color,
        @MatrixParam("year") int year
    ) {
        ...
    }
}
```

## 16.2 Decoding

Matrix values are URL decoded unless `@Encoded`.

## 16.3 Collections

Can inject:

```java
@MatrixParam("color") List<String> colors
```

## 16.4 Last segment rule

`@MatrixParam` binds from last matched path segment for the Java element doing injection.

This is often misunderstood.

## 16.5 Rare in public APIs

Many infrastructures strip semicolon content.

## 16.6 Recommendation

Prefer query params for most API filters.

Use matrix only if segment-scoped semantics is essential and infrastructure supports it.

---

# 17. Matrix Param Last Matched Segment Rule

## 17.1 Example

Resource:

```java
@Path("/cars")
public class CarResource {

    @GET
    @Path("/models")
    public Response models(@MatrixParam("year") String year) {
        ...
    }
}
```

Request:

```text
/cars;color=red/models;year=2026
```

`@MatrixParam("year")` binds from:

```text
models;year=2026
```

not from:

```text
cars;color=red
```

## 17.2 Access earlier segment matrix params

Use `PathSegment`.

```java
@Path("/cars/{car}/models")
public Response models(@PathParam("car") PathSegment car) {
    MultivaluedMap<String, String> matrix = car.getMatrixParameters();
}
```

## 17.3 Why this rule matters

Without understanding it, you will read `null` and think matrix params are broken.

## 17.4 Test

If using matrix params, always test exact segment ownership.

---

# 18. `@DefaultValue`: Missing Metadata Default

`@DefaultValue` defines default value for request metadata bound using param annotations.

Supported with:

- `@PathParam`;
- `@QueryParam`;
- `@MatrixParam`;
- `@CookieParam`;
- `@FormParam`;
- `@HeaderParam`.

## 18.1 Basic

```java
@QueryParam("page")
@DefaultValue("1")
int page
```

If `page` metadata not present:

```text
page = 1
```

## 18.2 Default is string then converted

Default string goes through same conversion pipeline.

```java
@DefaultValue("20")
@QueryParam("size")
PageSize size
```

If `PageSize` converter cannot parse `"20"`, deployment may fail early depending converter behavior.

## 18.3 Not for validation

Default value is not validation.

Still validate:

```java
@Min(1)
@Max(100)
```

## 18.4 Default on required concepts

Be careful:

```java
@PathParam("id") @DefaultValue("unknown")
```

usually hides routing bugs.

## 18.5 Missing vs empty

`@DefaultValue` used if metadata is not present.

If param is present but empty:

```text
?page=
```

behavior depends conversion; it may inject empty string or fail converting int.

## 18.6 Recommendation

Use `@DefaultValue` for optional query/header/cookie with safe defaults.

Avoid default for identity/security-critical params.

---

# 19. Default Value vs Empty String vs Invalid Value

These are different:

```text
missing: /customers
empty:   /customers?status=
invalid: /customers?page=abc
```

## 19.1 Missing

Can use default:

```java
@DefaultValue("1")
@QueryParam("page")
int page
```

## 19.2 Empty string

For String:

```java
status = ""
```

For int:

```java
page = ?
```

likely conversion error.

## 19.3 Invalid value

```text
page=abc
```

conversion error.

## 19.4 Recommended policy

Define:

- missing optional param → default;
- empty optional param → reject or treat as missing, but document;
- invalid param → 400 with problem details.

## 19.5 Do not silently ignore invalid values

Bad:

```text
?page=abc
```

becomes page 1.

This hides client bugs.

## 19.6 Query object normalization

Use query object to normalize and validate explicitly:

```java
public PageRequest toPageRequest() {
    if (page < 1) throw ...
    if (size > 100) throw ...
}
```

---

# 20. `@BeanParam`: Parameter Aggregator

`@BeanParam` injects a custom value object containing fields/properties annotated with `@XxxParam` or `@Context`.

## 20.1 Example

```java
public class CustomerQueryParams {

    @QueryParam("status")
    private List<CustomerStatus> statuses;

    @QueryParam("page")
    @DefaultValue("1")
    private int page;

    @QueryParam("size")
    @DefaultValue("20")
    private int size;

    @HeaderParam("Accept-Language")
    private String language;

    // getters
}
```

Resource:

```java
@GET
public CustomerPageResponse list(@BeanParam CustomerQueryParams query) {
    return service.search(query.toCommand());
}
```

## 20.2 Why useful

- resource method signature cleaner;
- related params grouped;
- validation co-located;
- reusable query object;
- easier OpenAPI docs;
- easier unit tests for parameter normalization.

## 20.3 BeanParam instantiation

JAX-RS runtime instantiates the object and injects its annotated fields/properties.

Same instantiation/injection rules apply as request-scoped root resource classes.

## 20.4 Lifecycle constraint

Using `@BeanParam` on resource fields/properties only supported for default per-request lifecycle.

Use method parameter:

```java
public Response list(@BeanParam QueryParams query)
```

## 20.5 Should BeanParam be immutable?

JAX-RS needs to inject fields/setters.

Plain mutable POJO often easiest.

Records may not work portably because field injection/setters absent, though some runtimes/frameworks may support.

## 20.6 Recommendation

Use simple POJO for `@BeanParam`.

Convert to immutable command object after injection.

---

# 21. Designing Query Parameter Object

## 21.1 Bad method signature

```java
public Response list(
    @QueryParam("page") int page,
    @QueryParam("size") int size,
    @QueryParam("sort") String sort,
    @QueryParam("status") List<String> status,
    @QueryParam("from") String from,
    @QueryParam("to") String to,
    @QueryParam("include") List<String> include,
    @QueryParam("q") String q
)
```

Hard to read/test.

## 21.2 Better

```java
public Response list(@BeanParam CustomerSearchParams params)
```

## 21.3 Query param class

```java
public class CustomerSearchParams {

    @QueryParam("page")
    @DefaultValue("1")
    @Min(1)
    private int page;

    @QueryParam("size")
    @DefaultValue("20")
    @Min(1)
    @Max(100)
    private int size;

    @QueryParam("status")
    private List<CustomerStatus> statuses = List.of();

    @QueryParam("sort")
    private List<String> sort = List.of();

    public CustomerSearchCommand toCommand() {
        return new CustomerSearchCommand(
            PageRequest.of(page, size),
            Set.copyOf(statuses),
            SortSpec.parse(sort)
        );
    }
}
```

## 21.4 Normalize once

Do not parse sort/filter in every service method.

## 21.5 Validate allowed fields

Sorting/filtering must allowlist fields.

## 21.6 Avoid exposing DB column names

Use API-level field names:

```text
createdAt
status
name
```

Map to DB safely.

---

# 22. `@BeanParam` + Jakarta Validation

You can validate aggregator object.

## 22.1 Method validation

```java
@GET
public Response list(@Valid @BeanParam CustomerSearchParams params) {
    ...
}
```

## 22.2 Field validation

```java
public class CustomerSearchParams {

    @QueryParam("page")
    @DefaultValue("1")
    @Min(1)
    private int page;

    @QueryParam("size")
    @DefaultValue("20")
    @Min(1)
    @Max(100)
    private int size;
}
```

## 22.3 Class-level validation

For cross-field constraints:

```java
@ValidDateRange
public class CustomerSearchParams {
    @QueryParam("from") LocalDate from;
    @QueryParam("to") LocalDate to;
}
```

## 22.4 Error mapping

Constraint violations should map to consistent error response.

## 22.5 Validation vs conversion

If `from=abc`, conversion to `LocalDate` may fail before validation.

If `from=2026-01-10&to=2026-01-01`, conversion succeeds then validation fails.

## 22.6 Recommendation

Separate error codes:

- `PARAMETER_CONVERSION_FAILED`;
- `PARAMETER_VALIDATION_FAILED`.

---

# 23. Built-In Conversion Rules

For most param annotations, target type must be one of:

- primitive type;
- type with single-`String` constructor;
- type with static `valueOf(String)` or `fromString(String)`;
- type supported by registered `ParamConverterProvider`;
- supported collection/array of convertible element type.

## 23.1 PathParam extra

`@PathParam` can be `PathSegment` or `List<PathSegment>`.

## 23.2 CookieParam extra

`@CookieParam` can be `Cookie`.

## 23.3 Query/Header/Matrix collection

Support:

- `List<T>`;
- `Set<T>`;
- `SortedSet<T>`;
- `T[]`.

## 23.4 What about Optional?

Some implementations support `Optional`, `OptionalInt`, etc., but this is not necessarily standard in Jakarta REST 4.0 core param annotation docs.

Use with portability caution unless runtime docs guarantee.

## 23.5 Java time types

`LocalDate` has no single String constructor and no `valueOf` in the expected shape for JAX-RS default conversion.

You likely need `ParamConverterProvider` or parse in query object.

## 23.6 UUID

`UUID.fromString(String)` exists, so conversion can work.

## 23.7 Enum

Enums have `valueOf(String)`.

Case-sensitive by default.

## 23.8 Domain value objects

Add `fromString` or ParamConverter.

Example:

```java
public record CustomerId(String value) {
    public static CustomerId fromString(String value) {
        if (!value.matches("CUST-[0-9]{6}")) {
            throw new IllegalArgumentException("Invalid customer id");
        }
        return new CustomerId(value);
    }
}
```

---

# 24. Primitive, Wrapper, Constructor, `valueOf`, `fromString`

## 24.1 Primitive

```java
@QueryParam("page") int page
```

Conversion to primitive.

Missing value can be problematic if no default.

Prefer:

```java
@DefaultValue("1") int page
```

or wrapper:

```java
Integer page
```

## 24.2 Wrapper

```java
@QueryParam("page") Integer page
```

Allows null for missing.

## 24.3 Constructor

```java
public final class PageSize {
    public PageSize(String value) { ... }
}
```

## 24.4 Static `valueOf`

```java
public static PageSize valueOf(String value) { ... }
```

## 24.5 Static `fromString`

```java
public static PageSize fromString(String value) { ... }
```

## 24.6 Prefer static factory for value objects

It makes conversion intentional.

## 24.7 Error

Throw `IllegalArgumentException` for invalid string.

Then map conversion errors consistently.

## 24.8 Avoid side effects

Conversion must be pure.

No DB, no network, no security lookup.

---

# 25. Collection and Array Conversion

## 25.1 Query list

```java
@QueryParam("status") List<OrderStatus> statuses
```

Request:

```text
/orders?status=NEW&status=PAID
```

## 25.2 Header list

```java
@HeaderParam("X-Feature") Set<String> features
```

## 25.3 Matrix list

```java
@MatrixParam("color") List<String> colors
```

## 25.4 Array

```java
@QueryParam("tag") String[] tags
```

## 25.5 SortedSet

Element type must be comparable or set needs ordering.

## 25.6 Collection is read-only

Copy before modifying.

## 25.7 Empty list handling

Normalize in query object.

## 25.8 Comma-separated not automatic standard

Do not assume:

```text
?status=NEW,PAID
```

will become two values.

Implement custom parser if needed.

## 25.9 Recommendation

Repeated param style is more aligned with multivalued map.

---

# 26. Read-Only Collection Injection

API docs state resulting injected collection is read-only.

## 26.1 Bad

```java
statuses.add(OrderStatus.NEW); // may throw UnsupportedOperationException
```

## 26.2 Good

```java
List<OrderStatus> normalized = new ArrayList<>(statuses == null ? List.of() : statuses);
```

or:

```java
Set<OrderStatus> unique = statuses == null ? Set.of() : Set.copyOf(statuses);
```

## 26.3 Design

Normalize as early as possible in query object.

## 26.4 Do not leak injected collection to domain

Copy into immutable application command.

```java
new SearchCommand(Set.copyOf(statuses))
```

## 26.5 Rule

Treat injected collections as untrusted read-only input.

---

# 27. Conversion Failure: 400 atau 404?

Conversion failure can happen at different stages.

## 27.1 Path regex mismatch

```java
@Path("/{id:\\d+}")
```

Request:

```text
/customers/abc
```

No path match.

Result:

```text
404
```

because route did not match.

## 27.2 Path param conversion failure

```java
@Path("/{id}")
public Response get(@PathParam("id") UUID id)
```

Request:

```text
/customers/not-a-uuid
```

Route matches, conversion fails.

Likely:

```text
400 Bad Request
```

depending runtime/error mapping.

## 27.3 Query conversion failure

```java
@QueryParam("page") int page
```

Request:

```text
?page=abc
```

Conversion fails.

Should be client error.

## 27.4 Validation failure

```java
@Min(1) @QueryParam("page") int page
```

Request:

```text
?page=0
```

Conversion succeeds, validation fails.

## 27.5 Recommendation

Use consistent error taxonomy:

```text
INVALID_PATH_PARAMETER
INVALID_QUERY_PARAMETER
INVALID_HEADER_PARAMETER
INVALID_COOKIE
VALIDATION_FAILED
```

## 27.6 Regex vs converter choice

If invalid ID should look like not found, use regex path constraints.

If invalid ID should produce parameter error, use converter.

Choose deliberately.

---

# 28. `ParamConverterProvider` dan Custom Domain Types

For custom types, use `ParamConverterProvider`.

## 28.1 ParamConverter

```java
public final class CustomerIdParamConverter implements ParamConverter<CustomerId> {

    @Override
    public CustomerId fromString(String value) {
        return CustomerId.fromString(value);
    }

    @Override
    public String toString(CustomerId value) {
        return value.value();
    }
}
```

## 28.2 Provider

```java
@Provider
public final class DomainParamConverterProvider implements ParamConverterProvider {

    @Override
    @SuppressWarnings("unchecked")
    public <T> ParamConverter<T> getConverter(
        Class<T> rawType,
        Type genericType,
        Annotation[] annotations
    ) {
        if (rawType.equals(CustomerId.class)) {
            return (ParamConverter<T>) new CustomerIdParamConverter();
        }
        return null;
    }
}
```

## 28.3 Registration

Provider must be:

- annotated with `@Provider` and discovered; or
- programmatically registered.

## 28.4 Priority over other strategies

If a `ParamConverter` is available, it must be preferred over constructor/`valueOf`/`fromString`.

## 28.5 Default conversion timing

ParamConverter conversion of default values happens eagerly at deployment by default, unless converter class is annotated with `@ParamConverter.Lazy`.

## 28.6 Use cases

- domain IDs;
- typed pagination;
- custom date format;
- comma-separated lists if provider supports;
- strongly typed enum alias.

## 28.7 Warning

RESTEasy and other runtimes may provide non-standard extensions for multi-valued converters.

Do not rely on extension if portability matters.

---

# 29. Kapan Pakai Custom Converter, Kapan Jangan

## 29.1 Use converter when

- type is reused across many resources;
- conversion is pure and deterministic;
- type represents syntax-level value object;
- error can be described as invalid parameter format.

Examples:

```java
CustomerId
OrderId
TenantId
CurrencyCode
PageSize
SortDirection
```

## 29.2 Do not use converter when

- conversion needs database;
- conversion needs authorization;
- conversion calls external service;
- conversion depends on request body;
- conversion has side effect;
- conversion is business operation.

Bad:

```java
@PathParam("customerId") Customer customer
```

if it loads from DB.

## 29.3 Use service instead

```java
Customer customer = customerService.requireAccessible(customerId, principal);
```

## 29.4 Converter should not decide 404/403

Converter should say:

```text
this string is syntactically invalid
```

Service decides:

```text
not found / forbidden / conflict
```

## 29.5 Rule

```text
Converters parse syntax. Services resolve meaning.
```

---

# 30. Value Object ID: `CustomerId`, `OrderId`, `TenantId`

Strongly typed IDs improve correctness.

## 30.1 Bad

```java
public Response get(
    @PathParam("customerId") String customerId,
    @PathParam("orderId") String orderId
)
```

Both are String. Easy to swap.

## 30.2 Better

```java
public Response get(
    @PathParam("customerId") CustomerId customerId,
    @PathParam("orderId") OrderId orderId
)
```

## 30.3 Value object

```java
public record CustomerId(String value) {

    public CustomerId {
        if (value == null || !value.matches("CUST-[0-9]{6}")) {
            throw new IllegalArgumentException("Invalid customer id");
        }
    }

    public static CustomerId fromString(String value) {
        return new CustomerId(value);
    }
}
```

## 30.4 Benefit

- type safety;
- validation centralized;
- clearer service API;
- fewer accidental ID swaps;
- easier logging redaction policy.

## 30.5 Caution

Keep constructor/factory fast and pure.

## 30.6 Error contract

Map invalid value object conversion to 400 with field name.

## 30.7 Testing

Test conversion via actual HTTP, not only unit test factory.

---

# 31. `@Encoded`: Encoded vs Decoded Parameter Values

By default, `@PathParam`, `@QueryParam`, `@FormParam`, and `@MatrixParam` values are decoded.

`@Encoded` disables automatic decoding.

## 31.1 Param-level

```java
@GET
@Path("/files/{name}")
public Response get(@Encoded @PathParam("name") String rawName) {
    ...
}
```

## 31.2 Method-level

```java
@Encoded
@GET
public Response get(@PathParam("id") String id, @QueryParam("q") String q) {
    ...
}
```

All params in method not decoded.

## 31.3 Class-level

```java
@Encoded
@Path("/files")
public class FileResource { ... }
```

All params of all methods not decoded.

## 31.4 Use cases

- signature verification;
- proxying;
- raw object key;
- security scanner/testing;
- exact canonical URI handling.

## 31.5 Danger

- double decode;
- encoded slash;
- path traversal;
- inconsistent auth;
- wrong logs;
- cache mismatch.

## 31.6 Recommendation

Use decoded values for normal application IDs.

Use `@Encoded` only with explicit security tests.

---

# 32. Parameter Name Encoding Rules

API docs for query/matrix param names state annotation name is specified in decoded form.

## 32.1 Example

If query param name is:

```text
a b
```

Use:

```java
@QueryParam("a b")
```

not:

```java
@QueryParam("a+b")
@QueryParam("a%20b")
```

## 32.2 Practical recommendation

Avoid spaces or special chars in parameter names.

Use simple ASCII:

```text
page
size
status
createdFrom
createdTo
sort
include
```

## 32.3 Header names

Header names are case-insensitive and should use standard hyphen convention:

```text
Idempotency-Key
X-Correlation-ID
```

## 32.4 Cookie names

Use simple safe names.

## 32.5 Matrix names

Avoid spaces/special chars.

## 32.6 Rule

Readable parameter names reduce encoding ambiguity.

---

# 33. `UriInfo` vs `@QueryParam`

## 33.1 Use `@QueryParam` when

- known parameter;
- simple extraction;
- good for docs;
- type conversion useful.

```java
@QueryParam("page") int page
```

## 33.2 Use `UriInfo` when

- need all query params;
- need detect duplicates;
- dynamic filter grammar;
- unknown keys;
- raw multivalued map;
- need encoded/decoded options.

```java
@Context UriInfo uriInfo;
MultivaluedMap<String, String> params = uriInfo.getQueryParameters();
```

## 33.3 Dynamic filter example

```text
?filter.status=ACTIVE&filter.country=ID
```

Use `UriInfo` to parse dynamic map.

## 33.4 Duplicate detection

```java
List<String> values = uriInfo.getQueryParameters().get("page");
if (values != null && values.size() > 1) { ... }
```

## 33.5 Recommendation

Prefer `@BeanParam` for normal known query contract.

Use `UriInfo` for advanced/dynamic contract.

## 33.6 Avoid raw `UriInfo` everywhere

It hides API contract.

---

# 34. `HttpHeaders` vs `@HeaderParam`

## 34.1 Use `@HeaderParam` when

Specific header is part of method contract:

```java
@HeaderParam("If-Match") String ifMatch
@HeaderParam("Idempotency-Key") String idempotencyKey
```

## 34.2 Use `HttpHeaders` when

Need:

- all headers;
- cookies;
- acceptable media types;
- acceptable languages;
- header string normalization;
- complex multi-value handling.

```java
@Context HttpHeaders headers;
```

## 34.3 HttpHeaders request scope

`HttpHeaders` methods throw `IllegalStateException` if called outside request scope, such as provider constructor.

## 34.4 Standard header parsing

Prefer `HttpHeaders.getAcceptableMediaTypes()` over manually parsing `Accept`.

## 34.5 Security

Avoid logging all headers.

Redact:

- Authorization;
- Cookie;
- Set-Cookie;
- tokens;
- API keys.

## 34.6 Recommendation

Resource-specific semantic header → `@HeaderParam`.

Complex/request-wide header logic → filter or `HttpHeaders`.

---

# 35. `CookieParam` vs `HttpHeaders#getCookies()`

## 35.1 `@CookieParam`

Use for one cookie:

```java
@CookieParam("theme") String theme
```

## 35.2 `HttpHeaders#getCookies()`

Use when:

- need all cookies;
- need multiple cookie decisions;
- security/session layer;
- cookie metadata.

```java
Map<String, Cookie> cookies = headers.getCookies();
```

## 35.3 Auth cookies

Do not process auth cookies in every resource.

Use security layer/filter.

## 35.4 CSRF

CSRF token comparison often involves cookie + header/body token.

Handle in security filter.

## 35.5 Recommendation

Use `@CookieParam` for harmless preferences.

Use security infrastructure for auth/session cookies.

---

# 36. Form Param dan Kenapa Tidak Jadi Fokus Part Ini

`@FormParam` binds form parameter values in request entity body.

## 36.1 Form URL encoded

```http
Content-Type: application/x-www-form-urlencoded
```

## 36.2 Multipart

Jakarta REST 4.0 includes special handling for `multipart/form-data` with `EntityPart` and `@FormParam`.

## 36.3 Why separate

Form/multipart involves entity body reading, media type, file upload, streaming, size limits, security, malware scanning.

It deserves separate dedicated part.

## 36.4 Warning

`@FormParam` consumes entity body.

Do not mix blindly with raw entity body parameter.

## 36.5 For JSON APIs

Prefer JSON request DTO over form params.

---

# 37. Parameter Injection + Security Context

Parameters often interact with security.

## 37.1 Do not trust userId path alone

```http
GET /users/{userId}
```

User can request another user ID.

Need authorization.

## 37.2 Current user

Instead of:

```http
GET /users/{userId}
```

for current user, maybe:

```http
GET /users/me
```

with principal from `SecurityContext`.

## 37.3 Tenant param

```java
@PathParam("tenantId") TenantId tenantId
```

must be checked against principal claims.

## 37.4 Security-sensitive headers

Do not parse `Authorization` manually in resource.

Use security filter/container.

## 37.5 Idempotency-Key

Treat as client input but scoped to authenticated principal/client.

## 37.6 Rule

```text
Parameter injection identifies what client asked for.
Authorization decides whether they may access it.
```

---

# 38. Parameter Injection + Multi-Tenancy

## 38.1 Tenant in path

```java
@Path("/tenants/{tenantId}/customers")
public Response list(@PathParam("tenantId") TenantId tenantId) { ... }
```

## 38.2 Tenant in header

```java
@HeaderParam("X-Tenant-ID") TenantId tenantId
```

## 38.3 Tenant in token

```java
@Context SecurityContext security
```

plus JWT claims from security integration.

## 38.4 Avoid spoofing

If tenant appears in path/header, verify against authenticated identity.

## 38.5 Multi-tenant query object

```java
public SearchCommand toCommand(TenantId authorizedTenant) { ... }
```

Do not let query param override authorized tenant.

## 38.6 Metrics cardinality

Do not label metrics with raw tenant ID unless bounded and intentional.

## 38.7 Audit

Audit tenant context.

---

# 39. Parameter Injection + Pagination/Filtering/Sorting

## 39.1 Page params

```java
public class PageParams {
    @QueryParam("page")
    @DefaultValue("1")
    @Min(1)
    int page;

    @QueryParam("size")
    @DefaultValue("20")
    @Min(1)
    @Max(100)
    int size;
}
```

## 39.2 Cursor params

```java
@QueryParam("cursor")
String cursor;

@QueryParam("limit")
@DefaultValue("20")
int limit;
```

Cursor should be opaque.

## 39.3 Sort params

```text
?sort=createdAt:desc&sort=name:asc
```

```java
@QueryParam("sort")
List<String> sort;
```

Parse and allowlist.

## 39.4 Include params

```text
?include=addresses&include=orders
```

Use enum:

```java
@QueryParam("include") Set<CustomerInclude> includes;
```

## 39.5 Filter params

For simple filters:

```java
@QueryParam("status") Set<CustomerStatus> statuses;
```

For complex filters, use POST search body.

## 39.6 Reject unknown filters

Avoid silently ignoring typos:

```text
?statsu=ACTIVE
```

Could hide client bugs.

If using `UriInfo`, check unknown keys.

---

# 40. Parameter Injection + Conditional Requests

Conditional requests use headers.

## 40.1 If-Match

```java
@HeaderParam("If-Match")
String ifMatch
```

Used for optimistic concurrency on PUT/PATCH/DELETE.

## 40.2 If-None-Match

```java
@HeaderParam("If-None-Match")
String ifNoneMatch
```

For cache validation.

## 40.3 Prefer `Request` for preconditions

```java
@Context Request request
```

and:

```java
request.evaluatePreconditions(entityTag)
```

## 40.4 Header parsing

ETag header syntax can be complex.

Avoid naive string comparison when possible.

## 40.5 Error status

Failed precondition:

```text
412 Precondition Failed
```

## 40.6 Rule

Use headers for concurrency/cache semantics, not query params.

---

# 41. Parameter Injection + Idempotency-Key

For unsafe retriable operations:

```java
@POST
public Response create(
    @HeaderParam("Idempotency-Key") String idempotencyKey,
    @Valid CreatePaymentRequest request
) { ... }
```

## 41.1 Required?

For payment/order command, require it.

If missing:

```text
400 Bad Request
```

or policy-specific error.

## 41.2 Validate format

- max length;
- allowed chars;
- entropy;
- no PII.

## 41.3 Scope

Key scoped by:

- authenticated client;
- endpoint/operation;
- request hash;
- time window.

## 41.4 Duplicate header

Reject duplicates.

Use `HttpHeaders` if you need detect duplicates.

## 41.5 Do not trust key alone

It is not authentication.

## 41.6 Observability

Log hashed/truncated key only if needed.

---

# 42. Parameter Injection + Observability

## 42.1 Do not log all params

Parameters can contain:

- PII;
- tokens;
- search terms;
- IDs;
- email;
- secrets.

## 42.2 Safe logging

Log:

- route template;
- status;
- error code;
- pagination size;
- sanitized ID when policy allows;
- correlation ID.

## 42.3 Redact

Redact:

- Authorization;
- Cookie;
- API key;
- token;
- password;
- document number;
- email if sensitive.

## 42.4 Metrics labels

Never use raw query param values as high-cardinality labels.

Bad:

```text
status="ACTIVE" may be okay if bounded
email="fajar@example.com" never
customerId="C001" never
q="free text" never
```

## 42.5 Param conversion errors metric

Track count by:

- param kind;
- param name;
- error category.

```text
rest_param_errors_total{param="page",kind="query",reason="conversion"}
```

## 42.6 Trace attributes

Use low-cardinality attributes.

## 42.7 Rule

Parameter values are data; observability needs data minimization.

---

# 43. Testing Parameter Injection

## 43.1 Path param tests

- valid ID;
- invalid format;
- encoded value;
- nested same-name avoidance.

## 43.2 Query param tests

- missing;
- empty;
- invalid;
- repeated;
- max/min;
- unknown param;
- comma vs repeated style.

## 43.3 Header tests

- missing required header;
- duplicate header;
- case-insensitive name;
- invalid ETag;
- idempotency key.

## 43.4 Cookie tests

- missing cookie;
- invalid cookie;
- Secure/SameSite behavior at browser/integration level.

## 43.5 Matrix tests

If used:

- segment ownership;
- gateway preserving semicolon;
- repeated values;
- encoded values.

## 43.6 BeanParam tests

- injection works;
- validation works;
- default works;
- conversion error maps correctly;
- lifecycle safe.

## 43.7 Runtime tests

Direct unit test does not test injection.

Use JAX-RS runtime integration test.

## 43.8 Contract tests

Assert status and error body for invalid params.

---

# 44. Common Failure Modes

## 44.1 Field `@QueryParam` in singleton

Shared mutable state.

## 44.2 Reused `{id}` in nested paths

Wrong value injected.

## 44.3 Missing `@DefaultValue` on primitive

Unexpected default/behavior.

## 44.4 Empty string not handled

`?page=` fails or becomes unexpected.

## 44.5 Duplicate query param accepted accidentally

Security or logic bug.

## 44.6 Comma-separated assumed but not parsed

`?status=A,B` becomes one string.

## 44.7 Header manually parsed incorrectly

Accept/ETag/Authorization grammar bugs.

## 44.8 Cookie used for auth inside resource

Scattered security logic.

## 44.9 Matrix param read from wrong segment

Null value.

## 44.10 Converter loads DB

Slow, side-effectful, wrong error mapping.

## 44.11 `@Encoded` double decode

Security bug.

## 44.12 Raw param values in metrics

Cardinality/PII problem.

---

# 45. Best Practices

## 45.1 Use method parameters for request metadata

Especially in shared/scoped resources.

## 45.2 Use `@BeanParam` for complex query objects

Keeps signature clean.

## 45.3 Use domain value objects for IDs

But keep converters pure.

## 45.4 Use defaults intentionally

Only for optional safe metadata.

## 45.5 Reject invalid/duplicate critical params

Especially security and idempotency headers.

## 45.6 Validate after conversion

Use Jakarta Validation and domain validation.

## 45.7 Prefer `UriInfo`/`HttpHeaders` for dynamic/complex cases

Do not force everything into simple annotations.

## 45.8 Avoid `@Encoded` unless necessary

Encoded values are security-sensitive.

## 45.9 Document multi-value style

Repeated params vs comma-separated.

## 45.10 Test injection through runtime

Not only direct method invocation.

---

# 46. Anti-Patterns

## 46.1 All params as String forever

No type safety.

## 46.2 Database lookup in ParamConverter

Wrong layer.

## 46.3 Generic `{id}` everywhere

Binding confusion.

## 46.4 Large method signatures

Too many params; use `@BeanParam`.

## 46.5 Query params for identity hierarchy

Bad URI design.

## 46.6 Path params for filters

Bad representation design.

## 46.7 Cookie auth in every resource

Security duplication.

## 46.8 Silent fallback on invalid param

Hides client bugs.

## 46.9 Logging headers/cookies wholesale

Secret leak.

## 46.10 Using matrix params without infra validation

Production breakage.

---

# 47. Production Checklist

## 47.1 Method signature

- [ ] Method parameters clearly represent HTTP contract.
- [ ] Request metadata in method params or request scope.
- [ ] No request state in singleton fields.
- [ ] Complex query grouped with `@BeanParam`.

## 47.2 Conversion

- [ ] IDs typed as value objects where useful.
- [ ] Custom converters are pure and fast.
- [ ] Conversion errors mapped consistently.
- [ ] Default values valid and tested.
- [ ] Collections copied before mutation.

## 47.3 Query params

- [ ] Missing/empty/invalid behavior defined.
- [ ] Duplicate behavior defined.
- [ ] Pagination bounds enforced.
- [ ] Sort/filter fields allowlisted.
- [ ] Unknown params policy defined.

## 47.4 Headers

- [ ] Security headers not parsed casually.
- [ ] Conditional headers parsed correctly.
- [ ] Idempotency-Key required where needed.
- [ ] Duplicate critical headers rejected.

## 47.5 Cookies

- [ ] Auth cookies handled by security layer.
- [ ] Cookie security flags considered.
- [ ] Cookie values not logged.

## 47.6 Matrix/encoded

- [ ] Matrix params infra-tested.
- [ ] `@Encoded` use justified.
- [ ] Encoded traversal tested.

## 47.7 Observability

- [ ] Param errors counted.
- [ ] Sensitive values redacted.
- [ ] No high-cardinality param labels.

---

# 48. Latihan

## Latihan 1 — Query Object

Buat `CustomerSearchParams` dengan:

- `page`;
- `size`;
- `status`;
- `sort`;
- `include`;
- `createdFrom`;
- `createdTo`.

Tambahkan defaults, validation, dan `toCommand()`.

## Latihan 2 — Duplicate Detection

Buat endpoint yang menolak duplicate `page` dan duplicate `Idempotency-Key`.

Gunakan `UriInfo` dan `HttpHeaders`.

## Latihan 3 — Value Object Converter

Buat:

```java
CustomerId
OrderId
TenantId
```

dengan `fromString`.

Test via HTTP:

```text
/customers/CUST-000001
/customers/invalid
```

## Latihan 4 — Empty vs Missing

Test:

```text
/customers
/customers?page=
/customers?page=abc
/customers?page=0
/customers?page=1
```

Tentukan status dan error body.

## Latihan 5 — Repeated Query

Support:

```text
/orders?status=NEW&status=PAID
```

Tolak:

```text
/orders?size=20&size=50
```

## Latihan 6 — Header Param

Implement conditional update with `If-Match`.

Test missing, malformed, stale, valid.

## Latihan 7 — Idempotency-Key

Implement `POST /payments` requiring `Idempotency-Key`.

Test retry same body and same key.

Test same key different body.

## Latihan 8 — Matrix Param

Buat endpoint matrix param sederhana.

Test direct runtime dan via proxy/gateway.

## Latihan 9 — Observability

Create metric for parameter conversion errors:

```text
param kind
param name
reason
```

Ensure no raw value label.

---

# 49. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 — Package `jakarta.ws.rs`  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/package-summary

2. `PathParam` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/pathparam

3. `QueryParam` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/queryparam

4. `HeaderParam` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/headerparam

5. `CookieParam` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/cookieparam

6. `MatrixParam` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/matrixparam

7. `DefaultValue` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/defaultvalue

8. `BeanParam` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/beanparam

9. `Encoded` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/encoded

10. `MultivaluedMap` API Docs  
    https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/multivaluedmap

11. `HttpHeaders` API Docs  
    https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/httpheaders

12. `ParamConverter` API Docs  
    https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/paramconverter

13. `ParamConverterProvider` API Docs  
    https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/paramconverterprovider

14. Jakarta RESTful Web Services 4.0 Specification  
    https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

---

# 50. Penutup

Parameter injection adalah titik pertama tempat HTTP metadata menjadi tipe Java.

Mental model utama:

```text
HTTP string metadata
  ↓
JAX-RS injection
  ↓
conversion
  ↓
validation
  ↓
application command/query
  ↓
business semantics
```

JAX-RS menyediakan:

```java
@PathParam
@QueryParam
@HeaderParam
@CookieParam
@MatrixParam
@DefaultValue
@BeanParam
@Encoded
```

Tetapi top-tier engineer tidak hanya memakai annotation.

Ia menentukan:

- mana identity dan mana filter;
- mana missing/empty/invalid behavior;
- mana single-value dan multi-value;
- mana harus typed value object;
- mana butuh custom converter;
- mana harus dicek duplicate;
- mana harus diproses oleh security layer;
- mana tidak boleh masuk logs/metrics;
- mana harus diuji via runtime.

Prinsip final:

```text
Make the resource method signature a clean, typed, explicit contract.
Do not let raw HTTP metadata leak deep into the domain.
```

Part berikutnya:

```text
Bagian 007 — Advanced Parameter Conversion: ParamConverter, ParamConverterProvider, valueOf, Constructor
```

Kita akan membedah custom conversion jauh lebih detail: provider priority, error taxonomy, date/time parsing, enum alias, typed IDs, generic handling, collection caveats, runtime differences, and production-grade converter design.
