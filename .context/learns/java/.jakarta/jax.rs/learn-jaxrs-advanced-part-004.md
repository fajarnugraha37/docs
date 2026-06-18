# learn-jaxrs-advanced-part-004.md

# Bagian 004 — Request Matching Algorithm Deep Dive: Path Template, Specificity, Subresource, Media Type, dan Debugging 404/405/406/415

> Target pembaca: Java/Jakarta engineer yang ingin memahami **bagaimana runtime JAX-RS/Jakarta REST memilih resource method** secara mendalam. Fokus part ini adalah request matching algorithm: normalized URI, candidate root resource class, candidate resource/subresource method, method/media filtering, path template specificity, regex, subresource locator, ambiguity, dan mapping error ke `404`, `405`, `415`, `406`.
>
> Namespace utama: `jakarta.ws.rs.*`; legacy mapping: `javax.ws.rs.*`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Runtime Tidak “Mencari URL”, Runtime Menjalankan Matching Algorithm](#2-mental-model-runtime-tidak-mencari-url-runtime-menjalankan-matching-algorithm)
3. [Kenapa Request Matching Sulit?](#3-kenapa-request-matching-sulit)
4. [High-Level Algorithm: 3 Tahap Matching](#4-high-level-algorithm-3-tahap-matching)
5. [Tahap 0 — Request Preprocessing dan URI Normalization](#5-tahap-0--request-preprocessing-dan-uri-normalization)
6. [Tahap 1 — Candidate Root Resource Classes](#6-tahap-1--candidate-root-resource-classes)
7. [Tahap 2 — Candidate Resource Methods / Subresource Methods / Locators](#7-tahap-2--candidate-resource-methods--subresource-methods--locators)
8. [Tahap 3 — Final Resource Method Selection](#8-tahap-3--final-resource-method-selection)
9. [Path Template to Regex: Cara `@Path` Dicocokkan](#9-path-template-to-regex-cara-path-dicocokkan)
10. [Specificity Sorting: Literal Characters, Capturing Groups, Explicit Regex](#10-specificity-sorting-literal-characters-capturing-groups-explicit-regex)
11. [Literal vs Variable Path](#11-literal-vs-variable-path)
12. [Variable Names Tidak Mempengaruhi Matching](#12-variable-names-tidak-mempengaruhi-matching)
13. [Regex Path Segment: Power dan Risiko](#13-regex-path-segment-power-dan-risiko)
14. [Trailing Slash dan Normalization](#14-trailing-slash-dan-normalization)
15. [Percent Encoding dan Path Segment Normalization](#15-percent-encoding-dan-path-segment-normalization)
16. [Root Resource Classes dengan Path Sama](#16-root-resource-classes-dengan-path-sama)
17. [Subresource Method vs Subresource Locator Priority](#17-subresource-method-vs-subresource-locator-priority)
18. [Subresource Locator Recursion](#18-subresource-locator-recursion)
19. [HTTP Method Filtering: Kapan `405 Method Not Allowed`](#19-http-method-filtering-kapan-405-method-not-allowed)
20. [`@Consumes` Filtering: Kapan `415 Unsupported Media Type`](#20-consumes-filtering-kapan-415-unsupported-media-type)
21. [`@Produces` Filtering: Kapan `406 Not Acceptable`](#21-produces-filtering-kapan-406-not-acceptable)
22. [Media Type Specificity, `q`, `qs`, dan Distance](#22-media-type-specificity-q-qs-dan-distance)
23. [Annotation Inheritance dan Matching](#23-annotation-inheritance-dan-matching)
24. [Pre-Matching Filters: Mengubah Input Matching Algorithm](#24-pre-matching-filters-mengubah-input-matching-algorithm)
25. [HEAD dan OPTIONS Special Handling](#25-head-dan-options-special-handling)
26. [Ambiguity: Ketika Dua Method Sama-Sama Cocok](#26-ambiguity-ketika-dua-method-sama-sama-cocok)
27. [Implementation Warnings vs Runtime Errors](#27-implementation-warnings-vs-runtime-errors)
28. [Debugging Strategy: 404, 405, 415, 406](#28-debugging-strategy-404-405-415-406)
29. [Debugging 404 Not Found](#29-debugging-404-not-found)
30. [Debugging 405 Method Not Allowed](#30-debugging-405-method-not-allowed)
31. [Debugging 415 Unsupported Media Type](#31-debugging-415-unsupported-media-type)
32. [Debugging 406 Not Acceptable](#32-debugging-406-not-acceptable)
33. [Request Matching Examples](#33-request-matching-examples)
34. [Example 1: Literal Beats Variable](#34-example-1-literal-beats-variable)
35. [Example 2: Regex Beats Default Variable as Tertiary Key](#35-example-2-regex-beats-default-variable-as-tertiary-key)
36. [Example 3: Same Path, Different Methods](#36-example-3-same-path-different-methods)
37. [Example 4: Same Path, Different `@Consumes`](#37-example-4-same-path-different-consumes)
38. [Example 5: Same Path, Different `@Produces`](#38-example-5-same-path-different-produces)
39. [Example 6: Subresource Locator](#39-example-6-subresource-locator)
40. [Example 7: Ambiguous Methods](#40-example-7-ambiguous-methods)
41. [Design Guidelines untuk Menghindari Matching Ambiguity](#41-design-guidelines-untuk-menghindari-matching-ambiguity)
42. [Runtime Differences: Jersey, RESTEasy, CXF, Quarkus](#42-runtime-differences-jersey-resteasy-cxf-quarkus)
43. [Testing Request Matching](#43-testing-request-matching)
44. [Observability: Path Template dan Matched Resource](#44-observability-path-template-dan-matched-resource)
45. [Failure Modes](#45-failure-modes)
46. [Best Practices](#46-best-practices)
47. [Anti-Patterns](#47-anti-patterns)
48. [Production Checklist](#48-production-checklist)
49. [Latihan](#49-latihan)
50. [Referensi Resmi](#50-referensi-resmi)
51. [Penutup](#51-penutup)

---

# 1. Tujuan Part Ini

Part ini membuat kamu bisa menjawab:

```text
Kenapa request ini masuk ke method A, bukan method B?
Kenapa path yang kelihatannya benar malah 404?
Kenapa method ada tapi 405?
Kenapa request JSON malah 415?
Kenapa client minta JSON tapi 406?
Kenapa subresource locator saya tidak kepanggil?
Kenapa dua endpoint tampak ambiguous?
```

JAX-RS matching bukan “runtime mencari string URL yang sama”.

JAX-RS matching adalah algoritma yang mempertimbangkan:

- normalized request URI;
- class-level `@Path`;
- method-level `@Path`;
- subresource method;
- subresource locator;
- HTTP method;
- request `Content-Type`;
- request `Accept`;
- `@Consumes`;
- `@Produces`;
- path template specificity;
- regex specificity;
- media type specificity;
- `q` and `qs` factors;
- implementation-dependent ambiguity resolution in some cases.

## 1.1 Kenapa top-tier engineer harus menguasai ini?

Karena banyak production incidents berupa:

```text
404 setelah deploy
405 setelah frontend ubah method
415 setelah client ubah Content-Type
406 setelah Accept header berubah
endpoint salah yang kepanggil karena path template terlalu generik
custom provider tidak aktif karena method selection beda
```

Engineer yang hanya hafal annotation akan menebak.

Engineer yang paham matching algorithm akan membedah sistematis.

## 1.2 Prinsip utama

```text
Request matching is deterministic by spec result,
but not always obvious from reading annotations casually.
```

---

# 2. Mental Model: Runtime Tidak “Mencari URL”, Runtime Menjalankan Matching Algorithm

Saat request masuk:

```http
GET /api/customers/123/orders
Accept: application/json
```

Runtime tidak hanya mencari method dengan string:

```text
/customers/123/orders
```

Runtime melakukan langkah seperti:

```text
normalize URI
  ↓
match root resource classes
  ↓
sort candidate roots by specificity
  ↓
match resource methods / subresource methods / locators
  ↓
possibly recurse through locator
  ↓
filter by HTTP method
  ↓
filter by request Content-Type against @Consumes
  ↓
filter by Accept against @Produces
  ↓
sort by media type preference
  ↓
invoke selected method
```

## 2.1 Matching bukan routing table sederhana

Path template seperti:

```java
@Path("/customers/{id}")
```

diubah menjadi regular expression.

Path variable:

```text
{id}
```

bukan literal.

## 2.2 Matching tidak hanya path

Dua method bisa punya path sama:

```java
@POST
@Consumes("application/json")
public Response createJson(CustomerRequest request) { ... }

@POST
@Consumes("text/csv")
public Response createCsv(String csv) { ... }
```

Runtime memilih berdasarkan `Content-Type`.

## 2.3 Matching tidak hanya method

Dua method bisa sama-sama `@GET`, path sama, tetapi `@Produces` berbeda:

```java
@GET
@Produces("application/json")
public CustomerResponse getJson() { ... }

@GET
@Produces("text/csv")
public String getCsv() { ... }
```

Runtime memilih berdasarkan `Accept`.

## 2.4 Error code berasal dari stage berbeda

- root/path tidak match → `404`;
- path match tetapi HTTP method tidak → `405`;
- method match tetapi request media tidak didukung → `415`;
- method match tetapi response media tidak dapat diproduksi → `406`.

## 2.5 Debugging mindset

Jangan mulai dari “kenapa method saya tidak dipanggil”.

Mulai dari:

```text
Di tahap matching mana request ini gagal?
```

---

# 3. Kenapa Request Matching Sulit?

## 3.1 Banyak annotation berinteraksi

```java
@Path
@GET
@POST
@Consumes
@Produces
@PathParam
@DefaultValue
```

## 3.2 Path template bisa overlap

```java
@Path("/customers/search")
@Path("/customers/{id}")
```

Keduanya bisa tampak cocok untuk:

```text
/customers/search
```

Tapi literal lebih spesifik.

## 3.3 Regex bisa overlap

```java
@Path("/{id:\\d+}")
@Path("/{slug:[a-z0-9-]+}")
```

## 3.4 Subresource membuat matching bertahap

Path bisa sebagian match root, lalu sisanya diteruskan.

## 3.5 Media type negotiation non-trivial

`Accept` bisa kompleks:

```http
Accept: application/json;q=0.9, text/*;q=0.5, */*;q=0.1
```

## 3.6 Runtime boleh tidak memakai algoritma literal

Spec menyatakan implementation tidak wajib memakai algoritma persis sebagaimana ditulis, tetapi hasilnya harus equivalent.

## 3.7 Ambiguity kadang warning, bukan hard error

Spec menggunakan “SHOULD report warning” untuk beberapa ambiguity.

Maka behavior final bisa implementation-dependent.

## 3.8 Team biasanya tidak punya tests untuk matching

Endpoint regressions sering lolos karena tidak ada test untuk:

- `Accept`;
- `Content-Type`;
- trailing slash;
- regex path;
- `OPTIONS`;
- unsupported methods.

---

# 4. High-Level Algorithm: 3 Tahap Matching

Jakarta REST spec menjelaskan matching request ke resource class/method dalam 3 stages.

## 4.1 Tahap 1

Identify candidate root resource classes matching request URI.

Input:

```text
request URI path
set of root resource classes
```

Output:

```text
remaining unmatched URI part
candidate root classes matched so far
```

## 4.2 Tahap 2

Obtain candidate resource methods for request.

Input:

```text
remaining unmatched URI
candidate root classes
```

Output:

```text
candidate resource methods
```

Tahap ini juga menangani:

- resource methods;
- subresource methods;
- subresource locators;
- recursion through locators.

## 4.3 Tahap 3

Identify final method that handles request.

Filter by:

- HTTP method;
- `Content-Type` vs `@Consumes`;
- `Accept` vs `@Produces`.

Then sort by media type preference if multiple candidates remain.

## 4.4 Summary diagram

```text
U = normalized request path

Stage 1:
  root @Path matching
  ↓
  candidate root classes C'
  remaining path U'

Stage 2:
  method/subresource @Path matching
  ↓
  candidate methods M
  or recurse through locator

Stage 3:
  HTTP method + @Consumes + @Produces
  ↓
  selected method D
```

## 4.5 Error mapping by stage

```text
Stage 1 no root match       → 404
Stage 2 no method/path match→ 404
Stage 3 no HTTP method      → 405
Stage 3 no @Consumes match  → 415
Stage 3 no @Produces match  → 406
```

## 4.6 Practical use

This 3-stage model becomes your debugging checklist.

---

# 5. Tahap 0 — Request Preprocessing dan URI Normalization

Before matching, request URI is normalized.

Spec references RFC 3986 normalization rules for:

- case;
- path segment;
- percent encoding.

The normalized URI must be reflected in injected `UriInfo`.

## 5.1 Why normalization matters

These may be semantically equivalent in some ways:

```text
/customers/../customers/123
/customers/%31%32%33
/customers/123
```

Normalization can affect matching.

## 5.2 Percent encoding

Path matching is done on normalized request URI.

Be careful with encoded slash:

```text
%2F
```

Some servers decode it, reject it, or treat it specially for security.

## 5.3 Case

URI path is generally case-sensitive, but normalization rules may affect scheme/host and percent encoding.

Do not rely on case-insensitive path unless explicitly implemented.

## 5.4 Path traversal

Normalization matters for security.

Never treat path params as filesystem paths without sanitization.

## 5.5 `UriInfo`

`UriInfo` exposes request URI information after preprocessing.

## 5.6 Debugging

Log both:

- raw incoming path at gateway/server if available;
- normalized/matched path template.

Do not log sensitive values.

---

# 6. Tahap 1 — Candidate Root Resource Classes

Runtime starts with root resource classes.

Root resource class:

```java
@Path("/customers")
public class CustomerResource { ... }
```

## 6.1 Input

```text
U = request URI path
C = all root resource classes
```

Example:

```text
U = customers/123/orders
C = { CustomerResource, OrderResource, SearchResource }
```

## 6.2 Each class `@Path` becomes regex

Example:

```java
@Path("customers")
```

becomes conceptually:

```text
customers(/.*)?
```

so it can match prefix and leave remainder.

## 6.3 Candidate filtering

Remove root classes whose path template does not match.

Also remove candidates where there is leftover unmatched path but class has no subresource methods/locators.

## 6.4 If no candidate

Generate:

```text
404 Not Found
```

via `NotFoundException`.

No entity by algorithm, though your exception mapper may later shape error response depending runtime behavior.

## 6.5 Candidate sorting

Candidates are sorted by specificity:

1. number of literal characters, descending;
2. number of capturing groups, descending;
3. number of capturing groups with non-default regex, descending.

## 6.6 Important

Two classes can have same path template modulo variable names.

Example:

```java
@Path("/customers/{id}")
public class CustomerByIdResource {}

@Path("/customers/{customerId}")
public class CustomerResource {}
```

For matching purposes, variable names do not distinguish them.

## 6.7 Output

- matched root classes;
- remaining URI part.

Example:

```text
request = customers/123/orders
root = customers
remaining = /123/orders
```

---

# 7. Tahap 2 — Candidate Resource Methods / Subresource Methods / Locators

After root class matched, runtime finds methods.

## 7.1 If remaining path empty or `/`

Candidate methods are resource methods without subresource path.

Example:

```java
@Path("/customers")
public class CustomerResource {
    @GET
    public List<CustomerResponse> list() { ... }
}
```

Request:

```http
GET /customers
```

Remaining path after root match is empty.

Candidate:

```text
list()
```

## 7.2 If remaining path exists

Runtime looks at:

- subresource methods;
- subresource locators.

## 7.3 Subresource method

```java
@GET
@Path("/{id}")
public CustomerResponse get(@PathParam("id") String id) { ... }
```

## 7.4 Subresource locator

```java
@Path("/{id}/orders")
public CustomerOrdersResource orders(@PathParam("id") String id) { ... }
```

No HTTP method annotation.

## 7.5 Filtering subresource candidates

Remove method paths that do not match remaining URI.

For subresource methods, final capturing group must be empty or `/`.

Meaning: subresource method must consume all remaining path.

For subresource locator, it may consume part and continue.

## 7.6 Sorting

Candidates sorted similarly:

1. literal characters descending;
2. capturing groups descending;
3. explicit regex groups descending;
4. source: subresource methods before subresource locators.

## 7.7 If method candidate found

Proceed to Stage 3.

## 7.8 If locator selected

Runtime invokes locator, updates remaining URI, and repeats Stage 2 against returned resource.

## 7.9 If no candidate

Return `404`.

---

# 8. Tahap 3 — Final Resource Method Selection

Now runtime has candidate resource methods.

It filters by:

1. HTTP method support.
2. Request entity media type against `@Consumes`.
3. Acceptable response media type against `@Produces`.

## 8.1 HTTP method filtering

If no method supports request method:

```text
405 Method Not Allowed
```

JAX-RS throws `NotAllowedException`.

## 8.2 Request body media filtering

If request has entity body and no method supports `Content-Type`:

```text
415 Unsupported Media Type
```

JAX-RS throws `NotSupportedException`.

## 8.3 Response media filtering

If no method can produce acceptable response according to `Accept`:

```text
406 Not Acceptable
```

JAX-RS throws `NotAcceptableException`.

## 8.4 Multiple candidates remain

Runtime sorts by media type compatibility and preference.

## 8.5 Final output

```text
O = instance of resource class
D = selected resource method
```

Then runtime invokes method.

## 8.6 Ambiguity warning

If more than one maximum method remains, implementation should report warning and select one implementation-dependently.

## 8.7 Production implication

Do not rely on ambiguous tie-breaking.

Make endpoint definitions unambiguous.

---

# 9. Path Template to Regex: Cara `@Path` Dicocokkan

Spec defines conversion from URI template to regex.

## 9.1 Template variable

```java
@Path("/customers/{id}")
```

Default variable regex:

```text
([^/]+?)
```

Meaning it matches one path segment.

## 9.2 Explicit regex

```java
@Path("/customers/{id:\\d+}")
```

Variable regex:

```text
(\d+)
```

## 9.3 Append remainder

For matching root/subresource prefix, regex appends conceptually:

```text
(/.*)?
```

so root can match prefix and leave remaining path.

## 9.4 Variable names retained

Variable names don't affect matching, but are retained for:

- `@PathParam`;
- `UriInfo.getPathParameters`.

## 9.5 Regex special characters escaped

Literal template parts are escaped for regex matching.

## 9.6 Default variable does not cross slash

`{id}` does not match:

```text
a/b
```

unless regex allows slash or path matching behavior permits, which is tricky and often unsafe.

## 9.7 Greedy regex caution

```java
@Path("/{path:.*}")
```

Can catch everything.

Use extremely carefully.

---

# 10. Specificity Sorting: Literal Characters, Capturing Groups, Explicit Regex

Sorting chooses more specific template.

## 10.1 Primary key: literal characters

More literal characters win.

Example:

```java
@Path("/customers/search")
@Path("/customers/{id}")
```

For `/customers/search`, literal path wins.

## 10.2 Secondary key: capturing groups

If literal count equal, more capturing groups wins.

## 10.3 Tertiary key: explicit regex groups

If still tied, templates with explicit non-default regex groups sort ahead.

## 10.4 Why capturing groups descending?

This is spec-defined.

It may surprise developers.

## 10.5 Practical guidance

Do not depend on obscure tie-breaks.

Make paths clearly distinct.

## 10.6 Example

```java
@Path("/files/{name}.{ext}")
@Path("/files/{filename}")
```

Depending literal/capturing details, matching may be non-obvious.

Better be explicit and test.

## 10.7 Runtime warnings

Implementations may warn about ambiguity.

Treat warning as bug.

---

# 11. Literal vs Variable Path

Literal path is generally more specific.

## 11.1 Example

```java
@Path("/customers")
public class CustomerResource {

    @GET
    @Path("/search")
    public SearchResponse search(...) { ... }

    @GET
    @Path("/{id}")
    public CustomerResponse get(...) { ... }
}
```

Request:

```http
GET /customers/search
```

Expected:

```text
search()
```

because `/search` has more literal chars than `/{id}`.

## 11.2 Dangerous variable

If you have:

```java
@Path("/{id}")
```

it can catch many reserved words:

```text
search
export
stats
health
```

## 11.3 Strategy

Put literal operational subpaths intentionally.

Example:

```text
/customers/search
/customers/export
/customers/{customerId}
```

## 11.4 Alternative

Constrain IDs with regex:

```java
@Path("/{customerId:CUST-[0-9]+}")
```

Then `/search` won't match ID.

## 11.5 Recommendation

For domain IDs with known format, use regex or ParamConverter validation.

## 11.6 Test

Add tests for reserved literal paths.

---

# 12. Variable Names Tidak Mempengaruhi Matching

These are equivalent for matching:

```java
@Path("/customers/{id}")
@Path("/customers/{customerId}")
```

The variable name differs only for extraction.

## 12.1 Ambiguity example

```java
@Path("/customers/{id}")
public class CustomerByIdResource {}

@Path("/customers/{slug}")
public class CustomerBySlugResource {}
```

For matching, both are:

```text
/customers/([^/]+?)
```

Ambiguous.

## 12.2 Runtime behavior

Implementation may report warning/error or choose one depending context.

Do not rely on order.

## 12.3 Fix

Use distinct literal prefix:

```text
/customers/by-id/{id}
/customers/by-slug/{slug}
```

or regex constraints:

```java
@Path("/customers/{id:\\d+}")
@Path("/customers/{slug:[a-z][a-z0-9-]+}")
```

## 12.4 Still test regex overlap

Make sure regexes do not overlap.

## 12.5 Rule

```text
Variable names are documentation and extraction keys, not routing differentiators.
```

---

# 13. Regex Path Segment: Power dan Risiko

## 13.1 Basic regex

```java
@Path("/customers/{id:\\d+}")
```

Matches only digits.

## 13.2 Slug regex

```java
@Path("/articles/{slug:[a-z0-9-]+}")
```

## 13.3 UUID regex

```java
@Path("/resources/{id:[0-9a-fA-F\\-]{36}}")
```

## 13.4 Benefits

- avoids ambiguity;
- validates path syntax early;
- documents ID shape;
- separates literals from IDs.

## 13.5 Risks

- complex regex hard to read;
- overlap still possible;
- performance if pathological;
- URL encoding interactions;
- false rejection if ID format changes.

## 13.6 Avoid giant regex

Do not encode too much business validation in path regex.

Example bad:

```java
@Path("/{id:(?!(admin|root|system)$)[a-z0-9]{3,64}}")
```

Better handle in validation/domain policy.

## 13.7 Use ParamConverter for value object

Regex for rough shape.

ParamConverter for typed conversion.

Domain validation in service.

## 13.8 Test with edge cases

- valid;
- invalid;
- reserved words;
- encoded chars;
- uppercase/lowercase;
- trailing slash.

---

# 14. Trailing Slash dan Normalization

Trailing slash can affect routing.

```text
/customers
/customers/
```

They may not be equivalent depending runtime/config.

## 14.1 Spec conversion

Path regex conversion removes final slash in template then appends remainder matcher.

But practical behavior still depends on request path and matching context.

## 14.2 API policy

Choose policy:

- tolerate both;
- redirect canonical;
- reject non-canonical;
- configure gateway normalization.

## 14.3 Common issue

Frontend calls:

```text
/api/customers/
```

Backend only tested:

```text
/api/customers
```

## 14.4 SEO/browser APIs

For public web resources, canonical redirect may matter.

For APIs, consistency matters.

## 14.5 JAX-RS implementation options

Some runtimes/frameworks offer trailing slash matching options.

These are implementation-specific.

## 14.6 Recommendation

Avoid having two different resources distinguished only by trailing slash.

Test both if clients may send both.

## 14.7 Gateway

Ingress/gateway may normalize slash before JAX-RS sees it.

Document.

---

# 15. Percent Encoding dan Path Segment Normalization

## 15.1 Encoded characters

URI path can include percent encoding:

```text
/customers/C%20001
```

## 15.2 Decoding and matching

Runtime normalizes URI before matching.

`@PathParam` value may be decoded unless encoded handling requested.

## 15.3 Encoded slash

```text
%2F
```

is dangerous.

If decoded to `/`, it changes path segment structure.

Many servers restrict encoded slash.

## 15.4 JAX-RS `@Encoded`

You can use `@Encoded` to prevent automatic decoding for params/classes/methods.

Use carefully.

## 15.5 Security

Never use path param directly as file path.

Path traversal payloads:

```text
..%2F..%2Fetc%2Fpasswd
```

## 15.6 Observability

Log normalized safe values, not raw malicious payload.

## 15.7 Test

Test encoded spaces, unicode, percent, slash.

## 15.8 Rule

URI normalization is part of routing and security.

---

# 16. Root Resource Classes dengan Path Sama

JAX-RS 2.0+ matching supports multiple root resource classes sharing same URI path in algorithm.

## 16.1 Example

```java
@Path("/")
public class RootA {
    @GET
    @Path("/customers")
    public Response customers() { ... }
}
```

```java
@Path("/")
public class RootB {
    @GET
    @Path("/orders")
    public Response orders() { ... }
}
```

This can work.

## 16.2 Why it exists

Allows modular root resources with same top-level path.

## 16.3 Risk

Same root path plus overlapping methods can become ambiguous.

## 16.4 Better grouping

Often better:

```java
@Path("/customers")
public class CustomerResource {}

@Path("/orders")
public class OrderResource {}
```

## 16.5 Use case

Shared root:

```java
@Path("/")
public class HealthResource {}

@Path("/")
public class OpenApiResource {}
```

Maybe.

## 16.6 Rule

Same root path is allowed but should be intentional and tested.

---

# 17. Subresource Method vs Subresource Locator Priority

In Stage 2 sorting, if specificity ties, subresource methods sort ahead of subresource locators.

## 17.1 Example

```java
@Path("/customers")
public class CustomerResource {

    @GET
    @Path("/{id}/orders")
    public List<OrderResponse> ordersDirect(...) { ... }

    @Path("/{id}/orders")
    public CustomerOrdersResource ordersLocator(...) { ... }
}
```

The subresource method is preferred over locator for a matching `GET`.

## 17.2 Why this matters

You might expect locator to handle all `/orders` subtree, but direct method wins if it matches.

## 17.3 Design guidance

Avoid defining both direct subresource method and locator for same path unless deliberately overriding specific methods.

## 17.4 Pattern

You may use locator for nested operations and direct method for one special operation, but document.

## 17.5 Better

Separate paths:

```text
/{id}/orders
/{id}/orders-search
```

if semantics differ.

## 17.6 Test

Add tests for method selection.

---

# 18. Subresource Locator Recursion

A locator can return resource with more locators.

## 18.1 Example

```java
@Path("/customers/{customerId}")
public class CustomerResource {

    @Path("/orders")
    public CustomerOrdersResource orders() {
        return resourceContext.getResource(CustomerOrdersResource.class);
    }
}
```

```java
public class CustomerOrdersResource {

    @Path("/{orderId}/items")
    public OrderItemsResource items() {
        return resourceContext.getResource(OrderItemsResource.class);
    }
}
```

Request:

```text
/customers/C001/orders/O100/items
```

Runtime recursively matches.

## 18.2 Risks

- hard to trace;
- OpenAPI discovery issues;
- injection/lifecycle complexity;
- performance if each locator does work;
- authorization spread across locators.

## 18.3 Use when

- nested resource tree complex;
- parent context matters;
- modular structure worth complexity.

## 18.4 Avoid when

- simple endpoint;
- no real benefit;
- tooling/docs important;
- team unfamiliar.

## 18.5 Observability

Trace spans/logs should reveal selected resource/method.

## 18.6 Rule

Recursive locators need integration tests.

---

# 19. HTTP Method Filtering: Kapan `405 Method Not Allowed`

If path matches a candidate resource method path but none supports request HTTP method, runtime generates `NotAllowedException` with 405.

## 19.1 Example

```java
@Path("/customers/{id}")
public class CustomerResource {

    @GET
    public CustomerResponse get(...) { ... }
}
```

Request:

```http
DELETE /customers/C001
```

Path matches but DELETE not supported.

Response:

```http
405 Method Not Allowed
Allow: GET, HEAD, OPTIONS
```

depending runtime support.

## 19.2 404 vs 405

- No matching resource path → 404.
- Resource path exists but method not supported → 405.

## 19.3 Security trade-off

Some systems hide existence and return 404.

But default JAX-RS behavior is method-aware.

## 19.4 JAX-RS `NotAllowedException`

Generated by runtime.

Can be mapped by `ExceptionMapper<NotAllowedException>`.

## 19.5 Common bug

Client sends POST to endpoint designed PUT.

JAX-RS returns 405.

## 19.6 Checklist

For 405:

- path correct?
- method correct?
- trailing slash?
- gateway rewrites method?
- CORS preflight?
- method override headers?
- resource actually deployed?

---

# 20. `@Consumes` Filtering: Kapan `415 Unsupported Media Type`

If request entity body has media type unsupported by matched resource methods, runtime generates `NotSupportedException` with 415.

## 20.1 Example

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

Response:

```http
415 Unsupported Media Type
```

## 20.2 No body request

`@Consumes` matters when request has entity body.

GET without body usually not filtered by `Content-Type`.

## 20.3 Class-level `@Consumes`

```java
@Path("/customers")
@Consumes(MediaType.APPLICATION_JSON)
public class CustomerResource { ... }
```

Method-level overrides class-level.

## 20.4 Multiple media

```java
@Consumes({
    MediaType.APPLICATION_JSON,
    "application/merge-patch+json"
})
```

## 20.5 Multipart

Special handling exists for `multipart/form-data`.

Implementation support varies.

## 20.6 Common client bug

Client sends:

```http
Content-Type: application/json;charset=UTF-8
```

Should usually be compatible with `application/json`.

But if custom matching/provider behaves weird, test.

## 20.7 Checklist for 415

- Is `Content-Type` set?
- Does endpoint have `@Consumes`?
- Does class-level `@Consumes` override expectation?
- Is body actually sent?
- Is provider available?
- Does media type include unsupported suffix?
- Is request routed to different method than expected?

---

# 21. `@Produces` Filtering: Kapan `406 Not Acceptable`

If matched methods cannot produce any media type acceptable by request `Accept`, runtime generates `NotAcceptableException` with 406.

## 21.1 Example

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

Response:

```http
406 Not Acceptable
```

## 21.2 Missing Accept

If no `Accept`, HTTP default is effectively `*/*`.

JSON method can match.

## 21.3 Class-level `@Produces`

```java
@Path("/customers")
@Produces(MediaType.APPLICATION_JSON)
public class CustomerResource { ... }
```

Method-level overrides.

## 21.4 Multiple formats

```java
@GET
@Produces({MediaType.APPLICATION_JSON, "text/csv"})
public Response export(...) { ... }
```

## 21.5 Response type vs media type

Even if method matches `@Produces`, runtime still needs `MessageBodyWriter` for entity type/media type.

If no writer, error may be 500-ish/provider exception, not 406.

## 21.6 Checklist for 406

- What is `Accept` header?
- What does method/class `@Produces` say?
- Are there multiple methods same path with different `@Produces`?
- Does provider exist for selected media?
- Does gateway add unexpected `Accept`?

---

# 22. Media Type Specificity, `q`, `qs`, dan Distance

When multiple methods match, media type preference decides.

## 22.1 Client `q`

Client preference:

```http
Accept: application/json;q=0.9, text/csv;q=0.5
```

Higher q preferred.

## 22.2 Server `qs`

Server-side quality source parameter can be used in `@Produces`.

Example concept:

```java
@Produces({"application/json;qs=1.0", "application/xml;qs=0.5"})
```

Server preference only matters under certain tie situations.

## 22.3 Specificity

More specific media wins:

```text
text/html > text/* > */*
```

## 22.4 Distance factor

Spec defines a distance factor for wildcard matching.

Lower distance means more specific match.

## 22.5 `@Consumes` primary key

When sorting candidate methods, request content type vs `@Consumes` compatibility is primary key.

## 22.6 `@Produces` secondary key

Accept vs `@Produces` compatibility is secondary key.

## 22.7 Practical guidance

Avoid relying on subtle q/qs tie-breaking.

Define clear methods.

## 22.8 Test media negotiation

Contract tests should include:

- `Accept: application/json`;
- `Accept: text/csv`;
- `Accept: application/xml`;
- `Accept: */*`;
- no Accept header.

---

# 23. Annotation Inheritance dan Matching

JAX-RS annotations can be inherited from methods of superclass or implemented interface, under rules.

## 23.1 Method annotation inheritance

Annotations on methods and parameters of superclass/interface can be inherited by corresponding subclass/implementation method if subclass method has no JAX-RS annotations of its own.

## 23.2 Class annotations not inherited

Class/interface annotations are not inherited.

## 23.3 Partial override trap

If subclass method has any JAX-RS annotation, annotations from superclass/interface method are ignored.

Example:

```java
public interface FeedResource {
    @GET
    @Produces("application/json")
    Feed getFeed();
}
```

Implementation:

```java
@Path("/feed")
public class ActivityLog implements FeedResource {
    @Produces("application/json")
    public Feed getFeed() { ... }
}
```

Because implementation method has `@Produces`, inherited `@GET` may be ignored. Method may not be resource method.

## 23.4 Recommendation

Repeat annotations instead of relying on inheritance.

## 23.5 Why relevant to matching

Missing inherited `@GET` changes Stage 3 candidate method set.

## 23.6 Interface-based resources

Useful for contracts, but test runtime behavior.

## 23.7 Top-tier rule

```text
Annotation inheritance is convenience, not architecture foundation.
```

---

# 24. Pre-Matching Filters: Mengubah Input Matching Algorithm

`@PreMatching` request filters run before resource matching.

## 24.1 Example

```java
@Provider
@PreMatching
public class MethodOverrideFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext ctx) {
        String override = ctx.getHeaderString("X-HTTP-Method-Override");
        if (override != null) {
            ctx.setMethod(override);
        }
    }
}
```

## 24.2 Can alter matching

Pre-matching filter can modify:

- method;
- URI;
- headers.

This can change selected resource method.

## 24.3 Use cases

- method override;
- URI normalization;
- legacy path rewrite;
- early CORS handling;
- request canonicalization.

## 24.4 Risks

- hides true client request;
- makes routing hard to debug;
- security bypass if method changed incorrectly;
- metrics/logs inconsistent.

## 24.5 Recommendation

Use sparingly.

Prefer gateway rewrite for routing where appropriate.

## 24.6 Observability

Log when pre-matching filter changes method/path, without sensitive data.

## 24.7 Test

Tests must cover pre-matching behavior.

---

# 25. HEAD dan OPTIONS Special Handling

JAX-RS has additional support for HEAD and OPTIONS.

## 25.1 HEAD

If no explicit `@HEAD`, runtime can dispatch to `@GET` and suppress body.

## 25.2 OPTIONS

Runtime can generate response for OPTIONS, including `Allow`, if no explicit method.

## 25.3 Allow header

405 responses should include supported methods.

## 25.4 CORS preflight

Browser `OPTIONS` preflight often needs custom CORS handling.

If auth filter blocks OPTIONS, browser call fails before actual request.

## 25.5 Explicit HEAD

Use when generating body would be expensive.

```java
@HEAD
@Path("/{id}")
public Response head(...) { ... }
```

## 25.6 Explicit OPTIONS

Use for custom capability or CORS.

But many teams handle CORS with filter/gateway.

## 25.7 Testing

Test:

```bash
curl -I
curl -X OPTIONS
```

---

# 26. Ambiguity: Ketika Dua Method Sama-Sama Cocok

Ambiguity occurs when multiple candidates remain equally best.

## 26.1 Example

```java
@GET
@Path("/{x}")
public Response a(@PathParam("x") String x) { ... }

@GET
@Path("/{y}")
public Response b(@PathParam("y") String y) { ... }
```

Variable names don't distinguish.

## 26.2 Media ambiguity

```java
@GET
@Produces("application/json")
public Response a() { ... }

@GET
@Produces("application/json")
public Response b() { ... }
```

Same path/method/media.

## 26.3 Regex overlap

```java
@Path("/{id:[0-9]+}")
@Path("/{code:\\d+}")
```

Equivalent.

## 26.4 Runtime behavior

Implementation should report warning and select implementation-dependently in some ambiguity cases.

## 26.5 Production rule

Ambiguity warning should fail build/deploy if possible.

## 26.6 Prevention

- use distinct literal paths;
- use non-overlapping regex;
- avoid duplicate media/method combinations;
- write tests;
- enable strict runtime validation if available.

---

# 27. Implementation Warnings vs Runtime Errors

Spec sometimes uses:

```text
MUST generate exception
SHOULD report warning
implementation dependent
```

## 27.1 MUST

Example:

- no root/path match → `NotFoundException`;
- no HTTP method support → `NotAllowedException`;
- no consumes support → `NotSupportedException`;
- no produces support → `NotAcceptableException`.

## 27.2 SHOULD warning

Example:

- ambiguous maximum method after sorting;
- multiple subresource locators satisfying condition.

## 27.3 Implementation dependent

How warnings are logged/reported can vary.

## 27.4 Production implication

A deployment that “works” on Jersey might behave differently on RESTEasy if ambiguity exists.

## 27.5 Rule

Never rely on ambiguous behavior.

## 27.6 CI check

Use integration tests and log scanning.

---

# 28. Debugging Strategy: 404, 405, 415, 406

Use stage-based debugging.

## 28.1 First: reconstruct effective path

```text
gateway prefix
context root
@ApplicationPath
class @Path
method @Path
```

## 28.2 Second: check path candidates

- root resource exists?
- resource scanned/registered?
- path literal/variable conflict?
- regex too restrictive?
- trailing slash?
- encoded chars?

## 28.3 Third: check method

- client HTTP method?
- method annotation?
- HEAD/OPTIONS?
- gateway method override?

## 28.4 Fourth: check Content-Type

- request body exists?
- `Content-Type` set?
- `@Consumes`?
- class-level vs method-level override?

## 28.5 Fifth: check Accept

- `Accept` header?
- `@Produces`?
- JSON/XML provider?
- browser sends weird Accept?

## 28.6 Sixth: check filters

- pre-matching filter changing path/method?
- request filter aborting?
- auth/CORS filter?

## 28.7 Seventh: check runtime logs

Enable request matching logs if runtime supports.

## 28.8 Rule

```text
Do not debug 404 by staring at @GET only.
Debug the entire matching pipeline.
```

---

# 29. Debugging 404 Not Found

404 means no matching resource method/subresource found by path stage, or app path/context not reached.

## 29.1 Checklist

- Is application deployed?
- Is context root correct?
- Is `@ApplicationPath` correct?
- Is resource class registered/scanned?
- Is class annotated with `@Path`?
- Is method path correct?
- Is trailing slash different?
- Is gateway stripping/adding prefix?
- Is regex rejecting path?
- Is subresource locator returning null/wrong type?
- Is path encoded unexpectedly?

## 29.2 Example

Application path:

```java
@ApplicationPath("/api")
```

Resource:

```java
@Path("/customers")
```

Client calls:

```http
GET /customers
```

Actual should be:

```http
GET /api/customers
```

404.

## 29.3 Regex example

```java
@Path("/{id:\\d+}")
```

Client:

```http
GET /customers/ABC
```

404 because regex does not match.

## 29.4 Provider not relevant

If 404 at path matching, JSON provider is not issue.

## 29.5 Log matched templates

If possible, log matched template for successes and unmatched path for 404.

---

# 30. Debugging 405 Method Not Allowed

405 means path matched but HTTP method not supported.

## 30.1 Checklist

- Is client using correct method?
- Is method annotation present?
- Is method hidden by annotation inheritance issue?
- Is method overloaded ambiguously?
- Is `OPTIONS` preflight blocked?
- Is gateway converting method?
- Is path matched to a different resource than expected?

## 30.2 Example

```java
@GET
@Path("/{id}")
public CustomerResponse get(...) { ... }
```

Client:

```http
POST /customers/C001
```

405.

## 30.3 Annotation inheritance trap

Interface has `@POST`, implementation method has only `@Consumes`.

Inherited `@POST` may be ignored because implementation method has JAX-RS annotation.

Result: no POST method.

## 30.4 Allow header

Check `Allow` header.

It tells what methods runtime thinks are available.

## 30.5 CORS preflight

Browser sends `OPTIONS`; app returns 405/401.

Fix CORS handling.

---

# 31. Debugging 415 Unsupported Media Type

415 means method path and HTTP method match, but request `Content-Type` unsupported.

## 31.1 Checklist

- What is actual `Content-Type`?
- Is request body present?
- Does method/class `@Consumes` include it?
- Does method-level `@Consumes` override class-level?
- Is media type typo?
- Is multipart provider installed?
- Is client sending no `Content-Type`?
- Is request routed to method you expect?

## 31.2 Example

```java
@POST
@Consumes("application/json")
```

Client:

```http
Content-Type: application/x-www-form-urlencoded
```

415.

## 31.3 Multiple methods

```java
@POST
@Consumes("application/json")
public Response json(...)

@POST
@Consumes("text/csv")
public Response csv(...)
```

If client sends:

```text
application/xml
```

415.

## 31.4 Browser forms

HTML form default:

```text
application/x-www-form-urlencoded
```

If endpoint expects JSON, 415.

## 31.5 Multipart

`multipart/form-data; boundary=...` must be compatible with endpoint/provider.

## 31.6 Error mapper

Map `NotSupportedException` to consistent problem response.

---

# 32. Debugging 406 Not Acceptable

406 means server cannot produce media acceptable to client.

## 32.1 Checklist

- What is actual `Accept`?
- Does method/class `@Produces` include acceptable type?
- Does browser send broad Accept?
- Does client send strict XML while endpoint produces JSON?
- Are two methods with different `@Produces` behaving as expected?
- Is selected entity writer available?

## 32.2 Example

```java
@GET
@Produces("application/json")
```

Client:

```http
Accept: application/xml
```

406.

## 32.3 Missing Accept

Usually fine because default acceptable is `*/*`.

## 32.4 Browser Accept

Browser may send:

```text
text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
```

If endpoint only produces JSON, `*/*` may still allow JSON depending q and server choice.

## 32.5 API clients

API clients should set:

```http
Accept: application/json
```

## 32.6 Error mapper

Map `NotAcceptableException`.

---

# 33. Request Matching Examples

This section gives concrete reasoning.

## 33.1 Reading examples

For each example ask:

1. Which root class matches?
2. What remains?
3. Which method/subresource matches?
4. Does HTTP method match?
5. Does `Content-Type` match?
6. Does `Accept` match?
7. Which method wins?

## 33.2 Rule

If you cannot answer these seven questions, endpoint design may be too ambiguous.

---

# 34. Example 1: Literal Beats Variable

## 34.1 Code

```java
@Path("/customers")
public class CustomerResource {

    @GET
    @Path("/search")
    public SearchResponse search(@QueryParam("q") String q) {
        ...
    }

    @GET
    @Path("/{id}")
    public CustomerResponse get(@PathParam("id") String id) {
        ...
    }
}
```

## 34.2 Request

```http
GET /customers/search
Accept: application/json
```

## 34.3 Matching

Candidate methods:

```text
/search
/{id}
```

`/search` has more literal characters.

## 34.4 Selected

```java
search()
```

## 34.5 Risk

If search endpoint removed, `/customers/search` may become ID lookup.

Mitigation:

- reserve words;
- regex constrain IDs;
- tests.

---

# 35. Example 2: Regex Beats Default Variable as Tertiary Key

## 35.1 Code

```java
@Path("/files")
public class FileResource {

    @GET
    @Path("/{id:[0-9]+}")
    public FileResponse byNumericId(@PathParam("id") long id) { ... }

    @GET
    @Path("/{name}")
    public FileResponse byName(@PathParam("name") String name) { ... }
}
```

## 35.2 Request

```http
GET /files/123
```

Both can match.

## 35.3 Specificity

Literal count same.

Capturing group count same.

Explicit regex path has non-default regex capturing group.

It sorts ahead.

## 35.4 Selected

```java
byNumericId()
```

## 35.5 Caveat

Do not depend on subtle regex ordering for complex designs.

Better have distinct paths if ambiguity matters:

```text
/files/by-id/{id}
/files/by-name/{name}
```

---

# 36. Example 3: Same Path, Different Methods

## 36.1 Code

```java
@Path("/customers/{id}")
public class CustomerResource {

    @GET
    public CustomerResponse get(@PathParam("id") String id) { ... }

    @PUT
    public Response replace(@PathParam("id") String id, ReplaceCustomerRequest req) { ... }
}
```

## 36.2 Request

```http
DELETE /customers/C001
```

## 36.3 Path

Path matches.

## 36.4 Method

No DELETE method.

## 36.5 Result

```text
405 Method Not Allowed
```

## 36.6 Client fix

Use supported method or API adds DELETE.

---

# 37. Example 4: Same Path, Different `@Consumes`

## 37.1 Code

```java
@Path("/imports/customers")
public class CustomerImportResource {

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    public Response importJson(List<CustomerRequest> customers) { ... }

    @POST
    @Consumes("text/csv")
    public Response importCsv(String csv) { ... }
}
```

## 37.2 Request JSON

```http
POST /imports/customers
Content-Type: application/json
```

Selected:

```java
importJson()
```

## 37.3 Request CSV

```http
POST /imports/customers
Content-Type: text/csv
```

Selected:

```java
importCsv()
```

## 37.4 Request XML

```http
POST /imports/customers
Content-Type: application/xml
```

Path and method match, media does not.

Result:

```text
415 Unsupported Media Type
```

## 37.5 Design note

This is valid, but document supported media types.

---

# 38. Example 5: Same Path, Different `@Produces`

## 38.1 Code

```java
@Path("/reports/{id}")
public class ReportResource {

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public ReportMetadata getMetadata(@PathParam("id") String id) { ... }

    @GET
    @Produces("application/pdf")
    public Response downloadPdf(@PathParam("id") String id) { ... }
}
```

## 38.2 Request JSON

```http
GET /reports/R001
Accept: application/json
```

Selected:

```java
getMetadata()
```

## 38.3 Request PDF

```http
GET /reports/R001
Accept: application/pdf
```

Selected:

```java
downloadPdf()
```

## 38.4 Request XML

```http
GET /reports/R001
Accept: application/xml
```

Result:

```text
406 Not Acceptable
```

## 38.5 Design note

Same URI with representation negotiation is RESTful, but many enterprise teams prefer distinct download path:

```text
/reports/{id}
/reports/{id}/file
```

Choose consistently.

---

# 39. Example 6: Subresource Locator

## 39.1 Code

```java
@Path("/customers")
public class CustomerResource {

    @Path("/{customerId}/orders")
    public CustomerOrdersResource orders(@PathParam("customerId") String customerId) {
        return new CustomerOrdersResource(customerId);
    }
}
```

```java
public class CustomerOrdersResource {

    private final String customerId;

    public CustomerOrdersResource(String customerId) {
        this.customerId = customerId;
    }

    @GET
    public List<OrderResponse> list() { ... }

    @GET
    @Path("/{orderId}")
    public OrderResponse get(@PathParam("orderId") String orderId) { ... }
}
```

## 39.2 Request

```http
GET /customers/C001/orders/O100
```

## 39.3 Matching

- root class `/customers`;
- remaining `/C001/orders/O100`;
- locator `/{customerId}/orders` matches and leaves `/O100`;
- returned `CustomerOrdersResource`;
- method `@GET @Path("/{orderId}")` matches remainder;
- selected `get`.

## 39.4 Injection warning

`new CustomerOrdersResource(customerId)` means CDI injection in `CustomerOrdersResource` may not happen.

Use `ResourceContext` or CDI-managed pattern if injection needed.

---

# 40. Example 7: Ambiguous Methods

## 40.1 Code

```java
@Path("/things")
public class ThingResource {

    @GET
    @Path("/{x}")
    public Response a(@PathParam("x") String x) { ... }

    @GET
    @Path("/{y}")
    public Response b(@PathParam("y") String y) { ... }
}
```

## 40.2 Request

```http
GET /things/abc
```

## 40.3 Matching

Both templates equivalent.

Variable names do not matter.

## 40.4 Result

Ambiguous. Runtime may warn or select implementation-dependently.

## 40.5 Fix

Remove one method or distinguish:

```java
@Path("/by-code/{code}")
@Path("/by-slug/{slug}")
```

or non-overlapping regex:

```java
@Path("/{id:\\d+}")
@Path("/{slug:[a-z][a-z0-9-]+}")
```

## 40.6 Test

Add regression tests for representative values.

---

# 41. Design Guidelines untuk Menghindari Matching Ambiguity

## 41.1 Prefer distinct literal prefixes for different lookup modes

Bad:

```text
/users/{id}
/users/{username}
```

Better:

```text
/users/by-id/{id}
/users/by-username/{username}
```

or one canonical lookup.

## 41.2 Reserve literal words

If using `/{id}`, reserve:

```text
search
export
stats
me
current
```

Test them.

## 41.3 Use regex for known ID formats

```java
@Path("/{id:[0-9]+}")
```

## 41.4 Avoid catch-all early

```java
@Path("/{anything:.*}")
```

Can swallow API.

## 41.5 Avoid duplicate methods with same path/method/media

Do not rely on implementation tie-breaking.

## 41.6 Keep subresources understandable

If tree too deep, split into canonical root resources.

## 41.7 Document media choices

If same path returns JSON/PDF/CSV, document `Accept` behavior.

## 41.8 Add contract tests

Test paths that are likely ambiguous.

---

# 42. Runtime Differences: Jersey, RESTEasy, CXF, Quarkus

## 42.1 Spec result should be equivalent

Compatible implementations should produce equivalent matching result.

## 42.2 But diagnostics differ

Differences include:

- logging detail;
- startup warnings;
- ambiguity handling;
- debug tracing;
- config options;
- strictness;
- treatment of trailing slash;
- encoded slash handling;
- OpenAPI discovery of subresources;
- reactive routing integration.

## 42.3 Jersey

Often provides detailed tracing/debug features.

## 42.4 RESTEasy

Has user guide sections on resource locators/subresources and integrated behavior in WildFly/Quarkus.

## 42.5 CXF

Has its own logging and endpoint model.

## 42.6 Quarkus RESTEasy Reactive

Build-time routing/indexing may behave differently operationally than classic runtime scanning, while supporting Jakarta REST programming model.

## 42.7 Production rule

Test on the actual runtime/version deployed.

Do not assume local JerseyTest behavior equals production RESTEasy or Liberty.

## 42.8 Migration

When changing implementation, add request matching regression suite.

---

# 43. Testing Request Matching

## 43.1 Test path success

For each endpoint:

```text
method + URI + Content-Type + Accept
```

## 43.2 Test path not found

For invalid path, assert 404.

## 43.3 Test unsupported method

For valid path but unsupported method, assert 405 and `Allow`.

## 43.4 Test unsupported media

Wrong `Content-Type` → 415.

## 43.5 Test unacceptable media

Wrong `Accept` → 406.

## 43.6 Test literal vs variable

```text
/customers/search
/customers/{id}
```

## 43.7 Test regex boundary

- valid ID;
- invalid ID;
- reserved word;
- unicode;
- encoded chars.

## 43.8 Test trailing slash

If clients may send both.

## 43.9 Test subresource

Full nested path.

## 43.10 Test runtime not only unit

Request matching requires JAX-RS runtime integration test.

## 43.11 Golden test matrix

Create table:

```text
name | method | path | content-type | accept | expected status | expected handler
```

---

# 44. Observability: Path Template dan Matched Resource

Request matching should feed observability.

## 44.1 Bad metrics

```text
http_requests_total{path="/customers/C001"}
http_requests_total{path="/customers/C002"}
```

High cardinality.

## 44.2 Good metrics

```text
http_requests_total{path_template="/customers/{id}"}
```

## 44.3 Jakarta REST 4.0

`UriInfo#getMatchedResourceTemplate` helps retrieve matched template.

## 44.4 Resource/method label

Use stable labels:

```text
resource="CustomerResource"
method="get"
```

Not always portable automatically, but frameworks/instrumentation can.

## 44.5 404 metrics

For unmatched paths, avoid raw full path labels.

Use low-cardinality grouping:

```text
path_group="unmatched"
```

or normalized pattern from gateway.

## 44.6 Logs

For debugging, logs may include raw path carefully, but avoid metrics cardinality explosion.

## 44.7 Tracing

Span names should use route template:

```text
GET /customers/{id}
```

## 44.8 Rule

Matched template is production-critical observability data.

---

# 45. Failure Modes

## 45.1 Endpoint hidden by generic path

```java
@Path("/{id}")
```

catches reserved word.

## 45.2 Regex too strict

Valid new ID format returns 404.

## 45.3 Regex overlap

Ambiguous method selection.

## 45.4 Missing `@GET`

Due annotation inheritance override.

## 45.5 Class-level `@Produces` overridden unexpectedly

Method produces different type.

## 45.6 Class-level `@Consumes` too restrictive

GET/POST behavior surprising.

## 45.7 Client sends wrong Content-Type

415.

## 45.8 Browser sends unexpected Accept

406 or wrong representation.

## 45.9 Subresource locator manual instance

Injection missing.

## 45.10 Locator path matches but final method not found

404 at deeper stage.

## 45.11 Pre-matching filter rewrites path incorrectly

Wrong endpoint or 404.

## 45.12 Trailing slash mismatch

Works locally, fails behind gateway.

## 45.13 Encoded slash

Security/routing issue.

## 45.14 Ambiguous max method

Implementation-dependent selection.

---

# 46. Best Practices

## 46.1 Design path templates to be unambiguous

Prefer clarity over cleverness.

## 46.2 Use literals for special operations

```text
/search
/export
/stats
```

and test against `/{id}`.

## 46.3 Constrain IDs when format known

Use regex or typed converter.

## 46.4 Avoid overlapping regexes

If overlap unavoidable, document and test.

## 46.5 Keep media negotiation explicit

Use `@Consumes`/`@Produces` consistently.

## 46.6 Map JAX-RS matching exceptions

Provide consistent error body for 404/405/406/415.

## 46.7 Test with real HTTP

Not just direct method calls.

## 46.8 Enable runtime warnings/logs

Treat ambiguity warning seriously.

## 46.9 Be careful with pre-matching filters

Document and test rewrites.

## 46.10 Use path template for observability

Avoid raw URI metrics.

---

# 47. Anti-Patterns

## 47.1 Catch-all root

```java
@Path("/{anything:.*}")
```

unless building gateway-like resource.

## 47.2 Duplicate variable routes

```java
/{id}
/{name}
```

## 47.3 Business semantics hidden in regex

Regex becomes unreadable policy engine.

## 47.4 Same path/method/media duplicate

Implementation-dependent.

## 47.5 No Accept/Content-Type tests

Media bugs reach production.

## 47.6 Subresource locator everywhere

Hard to trace/docs.

## 47.7 Pre-matching filter path rewrite without logs

Debug nightmare.

## 47.8 Treating 404/405/415/406 as same error

They indicate different matching failures.

## 47.9 Metrics with raw path param

Cardinality explosion.

## 47.10 Depending on implementation-specific matching quirks

Portability issue.

---

# 48. Production Checklist

## 48.1 Path design

- [ ] Literal paths do not conflict with variables.
- [ ] Reserved words tested.
- [ ] Regexes are non-overlapping.
- [ ] No accidental catch-all.
- [ ] Trailing slash policy defined.
- [ ] Encoded path behavior understood.

## 48.2 Method/media

- [ ] HTTP methods correct.
- [ ] Unsupported method returns expected 405.
- [ ] `@Consumes` defined for body endpoints.
- [ ] Unsupported `Content-Type` returns expected 415.
- [ ] `@Produces` defined.
- [ ] Unsupported `Accept` returns expected 406.

## 48.3 Subresources

- [ ] Locators used intentionally.
- [ ] Locator lifecycle/injection tested.
- [ ] Nested paths tested.
- [ ] Dynamic locators documented.

## 48.4 Ambiguity

- [ ] Runtime warnings checked.
- [ ] Ambiguous paths removed.
- [ ] Tests cover overlap cases.

## 48.5 Observability

- [ ] Matched path template available.
- [ ] Raw path not used as metric label.
- [ ] 404/405/415/406 counted separately.
- [ ] Correlation ID in logs.

## 48.6 Gateway

- [ ] Path rewrite tested.
- [ ] `Forwarded` headers handled.
- [ ] Method override behavior known.
- [ ] CORS preflight tested.

---

# 49. Latihan

## Latihan 1 — Predict the Handler

Diberikan:

```java
@Path("/customers")
public class CustomerResource {
    @GET @Path("/search") Response search() { ... }
    @GET @Path("/{id}") Response get() { ... }
    @GET @Path("/{id:\\d+}") Response getNumeric() { ... }
}
```

Tentukan method untuk:

```text
GET /customers/search
GET /customers/123
GET /customers/abc
```

Jelaskan berdasarkan specificity.

## Latihan 2 — Build Matching Matrix

Buat tabel untuk satu resource:

```text
method | path | content-type | accept | expected status | expected handler
```

Minimal 20 row termasuk negative cases.

## Latihan 3 — Debug 415

Buat endpoint JSON-only.

Kirim:

```text
text/plain
application/xml
application/json;charset=UTF-8
```

Catat behavior runtime.

## Latihan 4 — Debug 406

Buat endpoint JSON-only.

Kirim:

```text
Accept: application/xml
Accept: */*
Accept: application/json
```

Catat behavior.

## Latihan 5 — Ambiguity

Buat dua method:

```java
@Path("/{x}")
@Path("/{y}")
```

Lihat warning/error runtime.

Refactor agar tidak ambiguous.

## Latihan 6 — Subresource Locator

Buat locator nested 2 level.

Tambahkan integration test untuk full nested path.

## Latihan 7 — PreMatching Filter

Buat filter yang rewrite `/v1/customers` ke `/customers`.

Log rewrite.

Test behavior dan risikonya.

## Latihan 8 — Observability

Implement metric label based on matched resource template.

Pastikan `/customers/1` dan `/customers/2` satu time series.

---

# 50. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 Specification — Matching Requests to Resource Methods  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

2. Jakarta RESTful Web Services 4.0 API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/

3. `@Path` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/path

4. `@Consumes` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/consumes

5. `@Produces` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/produces

6. `@PreMatching` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/prematching

7. `NotFoundException` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/notfoundexception

8. `NotAllowedException` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/notallowedexception

9. `NotSupportedException` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/notsupportedexception

10. `NotAcceptableException` API Docs  
    https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/notacceptableexception

11. RFC 3986 — URI Generic Syntax  
    https://www.rfc-editor.org/rfc/rfc3986

12. RESTEasy User Guide — Resource Locators and Sub Resources  
    https://docs.resteasy.dev/5.0/userguide/html/ch18.html

13. Apache CXF JAX-RS Basics — Matching Algorithm Notes  
    https://cwiki.apache.org/confluence/display/CXF20DOC/JAX-RS%2BBasics

---

# 51. Penutup

Request matching adalah salah satu bagian JAX-RS yang paling penting untuk dikuasai.

Mental model final:

```text
normalize URI
  ↓
match root resource class
  ↓
match resource/subresource path
  ↓
possibly recurse through locator
  ↓
filter by HTTP method
  ↓
filter by @Consumes
  ↓
filter by @Produces
  ↓
sort by specificity/media preference
  ↓
invoke selected method
```

Error status juga bisa dipahami dari stage:

```text
path/root/subresource not found → 404
path found but method unsupported → 405
request Content-Type unsupported → 415
requested Accept media unsupported → 406
```

Top-tier JAX-RS engineer tidak menebak-nebak kenapa endpoint gagal. Ia:

- menghitung effective URI;
- mengevaluasi path specificity;
- memeriksa regex;
- memeriksa subresource locator;
- memeriksa method;
- memeriksa `Content-Type`;
- memeriksa `Accept`;
- memeriksa runtime warnings;
- menulis matching regression tests.

Part berikutnya:

```text
Bagian 005 — Path Template, Regex, Matrix Param, and URI Design
```

Kita akan membahas URI design dan path template secara jauh lebih detail: canonical resource identity, nested resources, matrix parameters, reserved literals, regex constraints, versioning, trailing slash policy, and gateway-aware URI design.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-003.md](./learn-jaxrs-advanced-part-003.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-005.md](./learn-jaxrs-advanced-part-005.md)
