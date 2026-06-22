# learn-jaxrs-advanced-part-005.md

# Bagian 005 — Path Template, Regex, Matrix Param, and URI Design: Canonical Resource Identity, Reserved Literals, Nested Resources, Versioning, dan Gateway-Aware URI

> Target pembaca: Java/Jakarta engineer yang ingin menguasai URI/resource design di JAX-RS/Jakarta REST secara mendalam. Part ini tidak hanya membahas `@Path("{id}")`, tetapi juga **bagaimana URI menjadi kontrak publik**, bagaimana path template dicocokkan, bagaimana regex dipakai dengan aman, bagaimana matrix parameters bekerja, kapan nested resource tepat, bagaimana versioning path dipilih, bagaimana trailing slash dan encoded path mempengaruhi routing/security, serta bagaimana membangun URI yang benar di belakang API gateway/reverse proxy.
>
> Namespace utama: `jakarta.ws.rs.*`; mapping legacy: `javax.ws.rs.*`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: URI adalah Resource Identity, Bukan Nama Method](#2-mental-model-uri-adalah-resource-identity-bukan-nama-method)
3. [URI vs URL vs Path dalam Praktik JAX-RS](#3-uri-vs-url-vs-path-dalam-praktik-jax-rs)
4. [RFC 3986 Mental Model: Scheme, Authority, Path, Query, Fragment](#4-rfc-3986-mental-model-scheme-authority-path-query-fragment)
5. [JAX-RS `@Path`: Relative URI Template](#5-jax-rs-path-relative-uri-template)
6. [Anatomi Path Template](#6-anatomi-path-template)
7. [Default Template Variable: Satu Path Segment](#7-default-template-variable-satu-path-segment)
8. [Regex dalam Path Template](#8-regex-dalam-path-template)
9. [Regex: Kapan Membantu, Kapan Membahayakan](#9-regex-kapan-membantu-kapan-membahayakan)
10. [Reserved Literals: `search`, `export`, `me`, `current`, `stats`](#10-reserved-literals-search-export-me-current-stats)
11. [Variable Name: Untuk Extraction, Bukan Routing Differentiation](#11-variable-name-untuk-extraction-bukan-routing-differentiation)
12. [Canonical URI: Satu Resource, Satu Identitas Utama](#12-canonical-uri-satu-resource-satu-identitas-utama)
13. [Collection Resource URI](#13-collection-resource-uri)
14. [Item Resource URI](#14-item-resource-uri)
15. [Nested Resource URI](#15-nested-resource-uri)
16. [Kapan Nested Resource Tepat](#16-kapan-nested-resource-tepat)
17. [Kapan Nested Resource Menjadi Buruk](#17-kapan-nested-resource-menjadi-buruk)
18. [Relationship Resource](#18-relationship-resource)
19. [Command/Action Resource tanpa RPC Smell](#19-commandaction-resource-tanpa-rpc-smell)
20. [Search URI Design](#20-search-uri-design)
21. [Pagination, Sorting, Filtering: Query Param vs Path](#21-pagination-sorting-filtering-query-param-vs-path)
22. [Path Param vs Query Param: Decision Framework](#22-path-param-vs-query-param-decision-framework)
23. [Matrix Parameters: Apa Itu dan Kenapa Jarang Dipakai](#23-matrix-parameters-apa-itu-dan-kenapa-jarang-dipakai)
24. [`@MatrixParam`: Binding Rules dan Last Matched Segment](#24-matrixparam-binding-rules-dan-last-matched-segment)
25. [`PathSegment`: Segment + Matrix Parameters](#25-pathsegment-segment--matrix-parameters)
26. [Matrix Param Use Cases](#26-matrix-param-use-cases)
27. [Matrix Param Pitfalls di Gateway/Proxy/Framework](#27-matrix-param-pitfalls-di-gatewayproxyframework)
28. [PathSegment dan Encoded Values](#28-pathsegment-dan-encoded-values)
29. [`@Encoded`: Kapan Perlu, Kapan Bahaya](#29-encoded-kapan-perlu-kapan-bahaya)
30. [Percent Encoding, Reserved Characters, dan Encoded Slash](#30-percent-encoding-reserved-characters-dan-encoded-slash)
31. [Trailing Slash Policy](#31-trailing-slash-policy)
32. [Case Sensitivity dan Naming Convention](#32-case-sensitivity-dan-naming-convention)
33. [Plural vs Singular Resource Names](#33-plural-vs-singular-resource-names)
34. [Hyphen, Underscore, CamelCase, and Readability](#34-hyphen-underscore-camelcase-and-readability)
35. [File Extension dalam URI: `.json`, `.csv`, `.pdf`](#35-file-extension-dalam-uri-json-csv-pdf)
36. [Media Type Negotiation vs Path Suffix](#36-media-type-negotiation-vs-path-suffix)
37. [Versioning in URI Path](#37-versioning-in-uri-path)
38. [Alternative Versioning: Header dan Media Type](#38-alternative-versioning-header-dan-media-type)
39. [Gateway-Aware URI Design](#39-gateway-aware-uri-design)
40. [UriInfo dan UriBuilder](#40-uriinfo-dan-uribuilder)
41. [Building `Location` Header dengan Benar](#41-building-location-header-dengan-benar)
42. [Path Template dan Observability Cardinality](#42-path-template-dan-observability-cardinality)
43. [Security: Path Traversal, SSRF, Open Redirect, Authorization Bypass](#43-security-path-traversal-ssrf-open-redirect-authorization-bypass)
44. [URI Design untuk Multi-Tenancy](#44-uri-design-untuk-multi-tenancy)
45. [URI Design untuk Admin/Internal API](#45-uri-design-untuk-admininternal-api)
46. [URI Design untuk Long-Running Jobs](#46-uri-design-untuk-long-running-jobs)
47. [URI Design untuk File/Document API](#47-uri-design-untuk-filedocument-api)
48. [URI Design untuk State Machine / Workflow](#48-uri-design-untuk-state-machine--workflow)
49. [Testing URI Design](#49-testing-uri-design)
50. [Common Failure Modes](#50-common-failure-modes)
51. [Best Practices](#51-best-practices)
52. [Anti-Patterns](#52-anti-patterns)
53. [Production Checklist](#53-production-checklist)
54. [Latihan](#54-latihan)
55. [Referensi Resmi](#55-referensi-resmi)
56. [Penutup](#56-penutup)

---

# 1. Tujuan Part Ini

Part ini membahas satu topik yang terlihat sederhana tetapi berdampak besar:

```text
URI design.
```

Di JAX-RS, URI design diekspresikan dengan:

```java
@ApplicationPath
@Path
@PathParam
@MatrixParam
PathSegment
UriInfo
UriBuilder
```

Namun URI bukan sekadar “string URL”.

URI adalah:

```text
public resource identity contract
```

Begitu URI dipakai client, gateway, monitoring, documentation, cache, dan integration partner, URI menjadi kontrak jangka panjang.

## 1.1 Bug yang biasanya berasal dari URI design buruk

- `/users/{id}` bentrok dengan `/users/me`.
- `/customers/{id}` menangkap `/customers/search`.
- Nested path terlalu dalam dan membingungkan.
- Query dan path dipakai tidak konsisten.
- Matrix param hilang karena gateway menghapus semicolon.
- `Location` header berisi internal host/pod IP.
- Metrics pakai raw URI dan meledakkan cardinality.
- Encoded slash menyebabkan bypass/security issue.
- `/api/v1` dan `/v1/api` tidak konsisten antar service.
- `GET /orders/{id}/cancel` mengubah state.
- Resource canonical punya banyak URI tanpa redirect/link policy.

## 1.2 Yang akan kamu kuasai

Setelah part ini, kamu bisa:

- mendesain URI resource-oriented;
- memakai path template dan regex secara aman;
- membedakan path param, query param, matrix param;
- menghindari matching ambiguity;
- mendesain nested resource dengan batas;
- membangun URI/`Location` header yang benar;
- memahami trailing slash, encoding, dan gateway behavior;
- membuat URI yang observable dan aman.

## 1.3 Prinsip utama

```text
A URI is not just how clients call your code.
A URI is how the world identifies your resource.
```

---

# 2. Mental Model: URI adalah Resource Identity, Bukan Nama Method

Bad API biasanya lahir dari mental model:

```text
URL = nama method Java
```

Contoh:

```text
/getCustomer
/createCustomer
/updateCustomer
/deleteCustomer
/submitApplication
/cancelOrder
```

Ini RPC-over-HTTP style.

JAX-RS bisa membuat ini, tetapi tidak berarti bagus.

## 2.1 Better mental model

```text
URI identifies resource.
HTTP method expresses operation semantics.
```

Contoh:

```http
GET /customers/C001
POST /customers
PUT /customers/C001
DELETE /customers/C001
POST /orders/O100/cancellation
```

## 2.2 Resource bukan selalu entity

Resource bisa berupa:

- collection;
- item;
- relationship;
- command result;
- job;
- document;
- status;
- projection;
- search result;
- state transition;
- policy/capability.

## 2.3 URI harus noun-ish

Biasanya URI menggunakan noun/resource name:

```text
/customers
/customers/{customerId}
/orders/{orderId}/cancellation
/reports/jobs/{jobId}
```

Bukan Java method name:

```text
/getCustomerById
/doCancelOrder
/processReport
```

## 2.4 Method membawa verb

```http
GET
POST
PUT
PATCH
DELETE
```

Jadi path tidak perlu mengulang verb untuk CRUD.

## 2.5 Exception: action resource

State transition/command kadang butuh action-like subresource.

Contoh:

```text
/orders/{id}/cancellation
/applications/{id}/submission
```

Ini masih resource-oriented karena `cancellation`/`submission` dianggap resource/event/intention.

## 2.6 Top-tier rule

```text
Use URI to model resource identity.
Use HTTP method to model interaction semantics.
Use request body to carry representation/command details.
```

---

# 3. URI vs URL vs Path dalam Praktik JAX-RS

## 3.1 URI

Uniform Resource Identifier.

Identifies resource.

Example:

```text
https://api.example.com/customers/C001
```

## 3.2 URL

Uniform Resource Locator.

A URI that also describes location/access.

In practice people say URL for web address.

## 3.3 Path

Part after authority and before query.

For:

```text
https://api.example.com/customers/C001?include=addresses
```

Path:

```text
/customers/C001
```

Query:

```text
include=addresses
```

## 3.4 JAX-RS mostly deals with path templates

```java
@Path("/customers/{id}")
```

This maps path portion.

## 3.5 Full URI building

JAX-RS uses `UriInfo` and `UriBuilder` to build URI including scheme/host/base path.

## 3.6 Deployment context

Effective path includes:

```text
context root + application path + resource path
```

## 3.7 Gateway external URI

Internal URI may differ from external public URI.

This matters for:

- `Location`;
- `Link`;
- OpenAPI server URL;
- redirects;
- file download URLs.

---

# 4. RFC 3986 Mental Model: Scheme, Authority, Path, Query, Fragment

RFC 3986 defines URI generic syntax.

General form:

```text
scheme ":" hier-part [ "?" query ] [ "#" fragment ]
```

Example:

```text
https://api.example.com:443/customers/C001?include=orders#section
```

## 4.1 Scheme

```text
https
```

## 4.2 Authority

```text
api.example.com:443
```

Can include user-info, host, port, though user-info should not be used for modern API credentials.

## 4.3 Path

```text
/customers/C001
```

Hierarchical identifier.

## 4.4 Query

```text
include=orders
```

Non-hierarchical data, often filtering/modifiers.

## 4.5 Fragment

```text
#section
```

Client-side reference. Not sent to server in HTTP request.

## 4.6 Reserved characters

RFC 3986 defines reserved characters:

```text
:/?#[]@!$&'()*+,;=
```

They may have special meaning.

## 4.7 Percent encoding

Characters can be percent-encoded.

Example:

```text
space = %20
```

## 4.8 Path segments

Path consists of segments separated by `/`.

Semicolon `;` can appear in path segments and is relevant for matrix parameters.

## 4.9 API design impact

Understand which component belongs where:

- stable identity → path;
- filtering/search modifiers → query;
- representation format → `Accept`/media type;
- command payload → body;
- client-only navigation → fragment.

---

# 5. JAX-RS `@Path`: Relative URI Template

`@Path` identifies URI path that a resource class or method serves.

## 5.1 Class-level

```java
@Path("/customers")
public class CustomerResource { ... }
```

Path is relative to application path.

## 5.2 Method-level

```java
@GET
@Path("/{id}")
public CustomerResponse get(...) { ... }
```

Path is relative to effective URI of containing class.

## 5.3 Leading slash ignored for absolutizing

JAX-RS docs say leading `/` in `@Path` value is ignored for absolutizing against base URI.

These are equivalent in practice:

```java
@Path("customers")
@Path("/customers")
```

Team should choose one style.

## 5.4 Path must not include matrix parameters

Jakarta REST 4.0 API docs for `@Path` state that the URI template value must not include matrix parameters.

So avoid:

```java
@Path("/cars;color={color}") // wrong style
```

Matrix params are accessed with `@MatrixParam`/`PathSegment`, not embedded in `@Path`.

## 5.5 Path template variable

```java
@Path("/customers/{customerId}")
```

## 5.6 Regex variable

```java
@Path("/customers/{customerId:CUST-[0-9]+}")
```

## 5.7 Resource method matching

`@Path` participates in matching algorithm.

Poor path templates create ambiguous routes.

---

# 6. Anatomi Path Template

Path template can contain:

- literal text;
- path separators `/`;
- template variables `{name}`;
- template variables with regex `{name: regex}`.

## 6.1 Literal

```java
@Path("/customers")
```

## 6.2 Variable

```java
@Path("/customers/{id}")
```

## 6.3 Regex variable

```java
@Path("/customers/{id:\\d+}")
```

Note Java string escaping:

```java
"\\d+"
```

## 6.4 Multiple variables

```java
@Path("/customers/{customerId}/orders/{orderId}")
```

## 6.5 Embedded variable

```java
@Path("/files/{name}.{ext}")
```

Matches:

```text
/files/report.pdf
```

## 6.6 Variable name syntax

JAX-RS path variable name supports letters, digits, underscore, dot, hyphen, with syntax constraints described in API docs.

## 6.7 Avoid overly clever templates

Readable:

```java
@Path("/reports/{reportId}/file")
```

Too clever:

```java
@Path("/{a:[a-z]+}-{b:\\d+}.{ext:[a-z]+}")
```

Unless clearly needed.

## 6.8 Rule

Path template should be readable by humans before runtime.

---

# 7. Default Template Variable: Satu Path Segment

Default template variable matches one path segment.

```java
@Path("/customers/{id}")
```

Default regex is like:

```text
[^/]+
```

Meaning:

```text
match one or more characters until slash
```

## 7.1 Matches

```text
/customers/C001
/customers/abc-123
/customers/search
```

## 7.2 Does not match multiple segments

```text
/customers/a/b
```

because `id` does not cross `/`.

## 7.3 Why it matters

If you use:

```java
@Path("/{id}")
```

it catches:

```text
/search
/export
/me
```

unless more specific literal path wins or regex restricts.

## 7.4 Use regex for ID shape

```java
@Path("/{id:CUST-[0-9]+}")
```

Now `/search` won't match.

## 7.5 But don't overdo regex

Regex is for syntax shape, not business policy.

## 7.6 Business validation

Valid syntax but resource not found:

```text
GET /customers/C999
→ 404
```

Valid syntax but forbidden:

```text
→ 403 or hidden 404
```

## 7.7 Syntax vs semantics

Regex handles syntax.

Service/domain handles semantics.

---

# 8. Regex dalam Path Template

Regex allows path template to be more precise.

## 8.1 Numeric ID

```java
@Path("/orders/{orderId:\\d+}")
```

## 8.2 Domain prefix

```java
@Path("/customers/{customerId:CUST-[0-9]{6}}")
```

## 8.3 UUID

```java
@Path("/documents/{id:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}}")
```

Long but explicit.

## 8.4 Slug

```java
@Path("/articles/{slug:[a-z0-9]+(?:-[a-z0-9]+)*}")
```

## 8.5 File extension

```java
@Path("/exports/{name:[a-z0-9-]+}.{ext:csv|json}")
```

## 8.6 Java escaping

Remember Java string escaping inside annotation:

```java
@Path("/{id:\\d+}")
```

not:

```java
@Path("/{id:\d+}") // invalid Java escape
```

## 8.7 Regex literal escaping

JAX-RS docs warn that implementations will not automatically escape literal characters inside regex; author must escape regex literals appropriately.

## 8.8 Regex testing

Always test regex path values.

---

# 9. Regex: Kapan Membantu, Kapan Membahayakan

## 9.1 Helps when

- ID has known syntax.
- Reserved literals must not be captured.
- Multiple lookup modes need separation.
- Ambiguity must be removed.
- Early rejection is useful.

## 9.2 Example helpful

```java
@GET
@Path("/search")
public SearchResponse search(...) { ... }

@GET
@Path("/{customerId:CUST-[0-9]+}")
public CustomerResponse get(...) { ... }
```

Now `/search` cannot be mistaken as customer ID.

## 9.3 Dangerous when

- regex too complex;
- regex encodes business rules;
- regex overlaps with another route;
- regex performance risk;
- ID format may evolve;
- encoded chars behave unexpectedly.

## 9.4 Business rule example bad

```java
@Path("/{username:(?!admin|root|system)[a-z0-9_]{3,32}}")
```

This hides policy in regex.

Better:

```java
@Path("/{username:[a-z0-9_]{3,32}}")
```

Then service validates reserved usernames.

## 9.5 Overlap example

```java
@Path("/{id:\\d+}")
@Path("/{code:[0-9]{1,10}}")
```

Overlaps.

## 9.6 Recommendation

Use regex as syntactic guard.

Use service/domain as semantic guard.

## 9.7 Test suite

For every regex path, test:

- valid examples;
- invalid examples;
- reserved literals;
- boundary length;
- encoded values;
- uppercase/lowercase;
- future format samples if known.

---

# 10. Reserved Literals: `search`, `export`, `me`, `current`, `stats`

A common trap:

```java
@Path("/users/{id}")
```

Then later adding:

```java
@Path("/users/me")
```

or:

```java
@Path("/users/search")
```

## 10.1 Literal usually wins

JAX-RS specificity generally selects literal path over variable.

But relying only on this can still create:

- confusing design;
- reserved word collision;
- accidental ID value conflict.

## 10.2 Reserved literal list

Common reserved literals:

```text
search
export
import
stats
metrics
me
current
self
batch
jobs
status
actions
validate
preview
history
audit
attachments
download
```

## 10.3 ID format strategy

If IDs are generated, choose format that cannot collide.

Example:

```text
usr_123
cust_001
ord_999
```

Then regex:

```java
@Path("/{userId:usr_[A-Za-z0-9]+}")
```

## 10.4 `me` endpoint

```http
GET /users/me
```

Can be convenient.

But define canonical user URI too:

```http
GET /users/{userId}
```

`/users/me` is alias for current user's resource.

## 10.5 Alias policy

If `/users/me` and `/users/{id}` refer to same resource, decide:

- return same representation;
- include canonical link;
- redirect or not;
- caching rules.

## 10.6 Test reserved literals

Add matching tests:

```text
/users/me
/users/search
/users/usr_123
```

---

# 11. Variable Name: Untuk Extraction, Bukan Routing Differentiation

These two routes are same for matching shape:

```java
@Path("/customers/{id}")
@Path("/customers/{customerId}")
```

Variable name only matters for extraction:

```java
@PathParam("customerId")
```

## 11.1 Bad design

```java
@GET
@Path("/{id}")
public Customer getById(...) { ... }

@GET
@Path("/{email}")
public Customer getByEmail(...) { ... }
```

Ambiguous.

## 11.2 Better

```java
@GET
@Path("/by-id/{id}")
public Customer getById(...) { ... }

@GET
@Path("/by-email/{email}")
public Customer getByEmail(...) { ... }
```

or:

```http
GET /customers?email=a@example.com
```

## 11.3 Regex alternative

```java
@Path("/{id:\\d+}")
@Path("/{email:.+@.+}")
```

But email in path is often awkward due encoding and privacy.

## 11.4 Use query for alternate lookup

```http
GET /customers?email=a@example.com
```

Better for search/filter.

## 11.5 Rule

```text
If two identifiers have different meaning but same path shape, do not overload path variable names.
```

---

# 12. Canonical URI: Satu Resource, Satu Identitas Utama

Canonical URI is primary stable URI for resource.

## 12.1 Example

Customer canonical URI:

```text
/customers/C001
```

Alternative access:

```text
/users/me
/accounts/current/customer
```

may exist but should point/link to canonical.

## 12.2 Why canonical matters

- cache;
- bookmarks;
- audit;
- logs;
- links;
- deduplication;
- API documentation;
- client consistency.

## 12.3 Multiple URI problem

If same resource accessible through many paths:

```text
/customers/C001
/accounts/A1/customer
/users/U1/profile
```

then clients may treat them as different resources.

## 12.4 Link relation

Response can include link:

```json
{
  "id": "C001",
  "links": [
    {"rel": "self", "href": "/customers/C001"}
  ]
}
```

## 12.5 Redirect?

For aliases, you may return:

```http
303 See Other
Location: /customers/C001
```

But APIs often avoid redirects and include canonical link.

## 12.6 Rule

```text
Every important resource should have one canonical self URI.
```

---

# 13. Collection Resource URI

Collection resource represents set of resources.

```text
/customers
/orders
/applications
/reports
```

## 13.1 GET collection

```http
GET /customers?page=1&size=20
```

## 13.2 POST collection

```http
POST /customers
```

Creates subordinate resource.

Response:

```http
201 Created
Location: /customers/C001
```

## 13.3 Collection should be plural

Common convention:

```text
/customers
/orders
/invoices
```

## 13.4 Collection filtering

Use query params:

```text
/customers?status=ACTIVE&city=Jakarta
```

## 13.5 Collection action?

For bulk import:

```text
POST /customer-imports
```

or:

```text
POST /customers/import-jobs
```

depending domain.

Avoid:

```text
POST /customers/importCustomers
```

## 13.6 Collection metadata

Response may include:

- items;
- paging;
- total count;
- links;
- filters applied.

## 13.7 Avoid unbounded collection

Always define pagination/limit.

---

# 14. Item Resource URI

Item resource represents one resource.

```text
/customers/{customerId}
```

## 14.1 GET item

```http
GET /customers/C001
```

## 14.2 PUT item

```http
PUT /customers/C001
```

Replace resource.

## 14.3 PATCH item

```http
PATCH /customers/C001
```

Partial update.

## 14.4 DELETE item

```http
DELETE /customers/C001
```

Remove resource or association.

## 14.5 Path param name

Use domain-specific name:

```java
@Path("/customers/{customerId}")
```

rather than generic `{id}` when nested.

## 14.6 Canonical ID

Use stable identifier, not mutable natural key if possible.

Bad if email can change:

```text
/customers/fajar@example.com
```

Better:

```text
/customers/C001
```

Query by email:

```text
/customers?email=fajar@example.com
```

## 14.7 Avoid sensitive identifiers

Do not put secrets/tokens in path.

Paths are logged widely.

## 14.8 Item response

Include self link or ID.

---

# 15. Nested Resource URI

Nested resource expresses hierarchy/relationship.

Examples:

```text
/customers/{customerId}/orders
/customers/{customerId}/addresses/{addressId}
/orders/{orderId}/items
/applications/{applicationId}/documents
```

## 15.1 Meaning

Nested URI means child is scoped by parent.

## 15.2 Benefits

- clearer relationship;
- easier authorization by parent;
- natural navigation;
- avoids global ID exposure for child;
- domain context explicit.

## 15.3 Cost

- longer paths;
- duplicate canonical routes;
- authorization complexity;
- matching complexity;
- resource identity ambiguity.

## 15.4 Canonical child resource

If order has global identity:

```text
/orders/O100
```

Then:

```text
/customers/C001/orders/O100
```

may be relationship view, not canonical identity.

## 15.5 Use links

Customer response can link to orders:

```json
{
  "id": "C001",
  "links": [
    {"rel": "orders", "href": "/customers/C001/orders"}
  ]
}
```

## 15.6 Depth rule

Avoid deep nesting beyond 2 or 3 levels unless strongly justified.

---

# 16. Kapan Nested Resource Tepat

## 16.1 Child has no independent identity

Example:

```text
/orders/{orderId}/items/{itemNo}
```

If item only meaningful inside order.

## 16.2 Parent context required

Example:

```text
/customers/{customerId}/addresses
```

Addresses belong to customer.

## 16.3 Authorization by parent

If access to child always through parent, nesting is clear.

## 16.4 Relationship collection

```text
/users/{userId}/roles
```

represents roles assigned to user.

## 16.5 Workflow documents

```text
/applications/{applicationId}/documents
```

Documents scoped to application.

## 16.6 Narrow collection

```text
/customers/{customerId}/orders
```

queries orders for customer.

## 16.7 Good sign

If removing parent ID makes child ambiguous or insecure, nesting helps.

---

# 17. Kapan Nested Resource Menjadi Buruk

## 17.1 Too deep

Bad:

```text
/companies/{companyId}/departments/{departmentId}/teams/{teamId}/members/{memberId}/devices/{deviceId}
```

Hard to maintain/use.

## 17.2 Child has global identity

If device ID globally unique:

```text
/devices/{deviceId}
```

may be canonical.

Parent relationship can be query/filter:

```text
/devices?teamId=T001
```

or relationship path:

```text
/teams/{teamId}/devices
```

## 17.3 Parent chain creates stale path

If member moves team, old nested URI changes.

Canonical member URI should not depend on mutable hierarchy.

## 17.4 Duplicated endpoints

```text
/customers/{id}/orders/{orderId}
/orders/{orderId}
```

If both return same resource, define canonical.

## 17.5 Authorization confusion

Parent ID in path does not guarantee child belongs to parent.

Always verify relationship.

## 17.6 Rule

```text
Nested URI should express stable containment or relationship, not arbitrary navigation.
```

---

# 18. Relationship Resource

Relationships can be resources.

## 18.1 User roles

```text
/users/{userId}/roles
```

## 18.2 Assign role

```http
PUT /users/{userId}/roles/{roleId}
```

Creates/replaces membership relation.

## 18.3 Remove role

```http
DELETE /users/{userId}/roles/{roleId}
```

Deletes membership relation.

## 18.4 Response

```http
204 No Content
```

## 18.5 Why PUT?

The relation URI is known:

```text
/users/U1/roles/ADMIN
```

Putting it repeatedly has same effect.

## 18.6 Alternative POST

```http
POST /users/{userId}/role-assignments
```

Creates role assignment resource.

Use if assignment has its own ID/metadata/lifecycle.

## 18.7 Many-to-many

Relationship resource is often clearer than embedding arrays in user update.

## 18.8 Authorization

Relationship modifications require explicit policy.

---

# 19. Command/Action Resource tanpa RPC Smell

Some operations are actions.

Examples:

- submit application;
- approve request;
- cancel order;
- resend email;
- generate report;
- recalculate risk.

## 19.1 Bad RPC naming

```text
POST /applications/{id}/submitApplication
POST /orders/{id}/cancelOrder
POST /reports/generateReport
```

## 19.2 Better action-as-resource

```text
POST /applications/{id}/submission
POST /orders/{id}/cancellation
POST /reports
```

## 19.3 Action collection

For repeated action records:

```text
POST /orders/{id}/cancellations
```

Creates cancellation request/event.

## 19.4 Action endpoint with `actions`

Sometimes acceptable:

```text
POST /orders/{id}/actions/cancel
```

This is explicit command style.

Use consistently.

## 19.5 When command resource is better

If operation has lifecycle/history:

```text
/applications/{id}/submissions/{submissionId}
```

## 19.6 Status code

- immediate success: `200`/`204`;
- created action resource: `201`;
- async: `202`;
- invalid state: `409`;
- stale ETag: `412`.

## 19.7 Idempotency

Commands often need idempotency key.

## 19.8 Rule

Avoid Java method names in URI; model operation as resource/event/intention.

---

# 20. Search URI Design

## 20.1 Simple search via GET

```http
GET /customers?status=ACTIVE&city=Jakarta&page=1&size=20
```

Use when query is simple and safe.

## 20.2 Complex search via POST

```http
POST /customers/search
Content-Type: application/json
```

Payload:

```json
{
  "filters": [
    {"field": "status", "op": "eq", "value": "ACTIVE"}
  ],
  "sort": ["createdAt:desc"],
  "page": {"size": 20}
}
```

## 20.3 Is POST search wrong?

Not necessarily.

If search payload is complex, GET URL length and encoding become pain.

But define:

- idempotency;
- caching behavior;
- whether result is ephemeral;
- request body schema.

## 20.4 Saved search as resource

```http
POST /customer-searches
GET /customer-searches/{searchId}/results
```

Use when search has lifecycle, sharing, async processing, or audit.

## 20.5 Search result as job

For heavy search/report:

```http
POST /customer-search-jobs
GET /customer-search-jobs/{jobId}
```

## 20.6 Avoid path filter explosion

Bad:

```text
/customers/status/ACTIVE/city/Jakarta/page/1
```

Use query params.

## 20.7 Security

Validate fields/operators.

Do not map query directly to SQL.

---

# 21. Pagination, Sorting, Filtering: Query Param vs Path

## 21.1 Pagination

Use query:

```text
/customers?page=1&size=20
```

or cursor:

```text
/customers?cursor=abc&limit=20
```

## 21.2 Sorting

```text
/customers?sort=createdAt:desc,name:asc
```

## 21.3 Filtering

```text
/customers?status=ACTIVE&type=PREMIUM
```

## 21.4 Why query?

Pagination/sorting/filtering modify collection representation, not resource identity hierarchy.

## 21.5 Path misuse

Bad:

```text
/customers/page/1/size/20
/customers/sort/name/asc
```

## 21.6 Bounded query grammar

Define allowed fields.

Do not accept arbitrary DB column names.

## 21.7 Multi-value params

```text
/customers?status=ACTIVE&status=PENDING
```

or:

```text
/customers?status=ACTIVE,PENDING
```

Choose policy.

## 21.8 Cursor

Cursor should be opaque.

Do not expose raw SQL offset/state.

## 21.9 Total count

Can be expensive.

Define whether response includes total count.

---

# 22. Path Param vs Query Param: Decision Framework

## 22.1 Use path param when

The value identifies resource or stable hierarchy.

Examples:

```text
/customers/{customerId}
/orders/{orderId}
/customers/{customerId}/orders
```

## 22.2 Use query param when

The value filters/modifies representation of a collection or operation.

Examples:

```text
/customers?status=ACTIVE
/orders?customerId=C001
/reports?from=2026-01-01&to=2026-01-31
```

## 22.3 Use header when

It is metadata about request/representation or cross-cutting context.

Examples:

```text
Authorization
Accept-Language
If-Match
Idempotency-Key
X-Correlation-ID
```

## 22.4 Use body when

Data is complex representation/command.

Examples:

```text
POST /orders
PATCH /customers/{id}
POST /customers/search
```

## 22.5 Tenant in path?

Depends.

Path:

```text
/tenants/{tenantId}/customers
```

good for explicit tenant-scoped admin APIs.

Header/claim:

```text
X-Tenant-ID or JWT claim
```

better when tenant is security context.

Do not trust tenant path without authorization.

## 22.6 Decision question

```text
If this value changes, is it a different resource identity or just a different view/filter?
```

Different identity → path.

Different view/filter → query/header.

---

# 23. Matrix Parameters: Apa Itu dan Kenapa Jarang Dipakai

Matrix parameters are parameters embedded in path segments using semicolon syntax.

Example:

```text
/cars;color=red;year=2024/drivers;region=EU
```

Here:

- `color` and `year` belong to `cars` segment;
- `region` belongs to `drivers` segment.

## 23.1 Compared to query params

Query:

```text
/cars/drivers?color=red&year=2024&region=EU
```

Query params apply to whole resource URI.

Matrix params attach to specific path segments.

## 23.2 Why rare

- not widely used in public APIs;
- gateway/proxy may strip or normalize semicolon content;
- client libraries may not preserve them;
- many developers unfamiliar;
- query params are simpler.

## 23.3 Why JAX-RS supports it

JAX-RS originated with strong URI template support including matrix URIs.

## 23.4 Use with caution

Use matrix params only when segment-scoped parameters are genuinely useful and infrastructure supports them.

## 23.5 Public API recommendation

For public HTTP APIs, prefer query params unless you have strong reason.

## 23.6 Internal APIs

Matrix params may be acceptable in controlled environments.

## 23.7 Test infrastructure

Always test through gateway, load balancer, WAF, ingress.

---

# 24. `@MatrixParam`: Binding Rules dan Last Matched Segment

`@MatrixParam` binds URI matrix parameter values to method parameter, field, or bean property.

## 24.1 Example

Request:

```text
GET /cars;color=red;year=2024
```

Resource:

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

## 24.2 Last matched path segment rule

The `@MatrixParam` annotation value refers to matrix parameter in the **last matched path segment** of the `@Path`-annotated Java structure that injects it.

This matters a lot.

## 24.3 Example with method path

```java
@Path("/cars")
public class CarResource {

    @GET
    @Path("/models")
    public Response models(@MatrixParam("year") String year) { ... }
}
```

Request:

```text
/cars;color=red/models;year=2024
```

`@MatrixParam("year")` on method parameter refers to last matched segment for method path:

```text
models;year=2024
```

not `cars;color=red`.

## 24.4 Collections

`@MatrixParam` supports collections like `List<T>`, `Set<T>`, `SortedSet<T>`, arrays if element conversion supported.

## 24.5 Conversion

Same conversion model as other string params:

- primitive;
- constructor from String;
- `valueOf`/`fromString`;
- `ParamConverter`;
- collections.

## 24.6 Field injection lifecycle

Like other param field injection, using `@MatrixParam` on fields/properties only supported for default per-request lifecycle.

## 24.7 Recommendation

Use method parameters to make segment binding clearer.

---

# 25. `PathSegment`: Segment + Matrix Parameters

`PathSegment` represents one URI path segment and associated matrix params.

## 25.1 Example

Request:

```text
GET /cars;color=red;year=2024
```

Resource:

```java
@Path("/cars")
public class CarResource {

    @GET
    public Response list(@Context UriInfo uriInfo) {
        List<PathSegment> segments = uriInfo.getPathSegments();
        ...
    }
}
```

## 25.2 Inject `PathSegment` via `@PathParam`

```java
@Path("/cars/{car}")
public class CarResource {

    @GET
    public Response get(@PathParam("car") PathSegment carSegment) {
        String carId = carSegment.getPath();
        MultivaluedMap<String, String> matrix = carSegment.getMatrixParameters();
        ...
    }
}
```

Request:

```text
/cars/C001;color=red
```

`getPath()`:

```text
C001
```

matrix:

```text
color=red
```

## 25.3 Why useful

When matrix params belong to variable segment.

Example:

```text
/flights/JKT-SIN;date=2026-06-12
```

## 25.4 Encoded handling

Presence of `@Encoded` affects whether path/matrix values are supplied encoded.

## 25.5 Recommendation

If using matrix params, `PathSegment` often gives clearer control.

## 25.6 But again

Prefer query params unless segment-scoped params are truly needed.

---

# 26. Matrix Param Use Cases

## 26.1 Segment-specific filters

```text
/routes/JKT;terminal=3/SIN;terminal=1
```

Each segment has own terminal metadata.

## 26.2 Graph traversal

```text
/nodes/A;depth=2/edges;type=outgoing
```

## 26.3 Multi-dimensional path selection

```text
/products;category=book;lang=en/chapters;level=beginner
```

## 26.4 Versioned segment metadata

```text
/documents/D001;version=3/content
```

Though query/headers may be clearer.

## 26.5 Internal DSL-like APIs

Matrix params can model segment annotations.

## 26.6 Why query often better

Most clients understand:

```text
/documents/D001/content?version=3
```

better than:

```text
/documents/D001;version=3/content
```

## 26.7 Decision

Use matrix only when:

- segment-specific semantics are important;
- infra supports semicolons;
- clients can generate them;
- docs/tests cover them.

---

# 27. Matrix Param Pitfalls di Gateway/Proxy/Framework

## 27.1 Semicolon stripping

Some servers/proxies historically strip semicolon content for security or session ID handling.

Example:

```text
/path;jsessionid=...
```

## 27.2 WAF normalization

WAF may normalize or reject semicolon.

## 27.3 Load balancer path rewriting

May drop matrix params.

## 27.4 Client libraries

Some HTTP clients encode or normalize semicolon unexpectedly.

## 27.5 Servlet containers

Servlet behavior around path parameters can differ/configurable.

## 27.6 Security devices

Semicolon path tricks are often used in bypass attempts.

## 27.7 Production rule

If matrix params used, test through full chain:

```text
client → CDN/WAF → gateway/ingress → app server → JAX-RS
```

## 27.8 Public API warning

Matrix params are rarely worth the operational risk for public APIs.

---

# 28. PathSegment dan Encoded Values

## 28.1 Default decoding

JAX-RS param values are usually URL-decoded.

## 28.2 `@Encoded`

If `@Encoded` is present, values may be supplied encoded.

Example:

```java
@GET
@Path("/{id}")
public Response get(@Encoded @PathParam("id") String encodedId) { ... }
```

## 28.3 PathSegment with encoded

```java
public Response get(@Encoded @PathParam("segment") PathSegment segment)
```

Path and matrix values supplied encoded.

## 28.4 Why use encoded?

- signature verification;
- exact URI preservation;
- IDs where `%2F` must stay encoded;
- proxying/gateway-like resources.

## 28.5 Danger

Manual decoding errors can cause:

- double decode;
- path traversal;
- auth bypass;
- cache key mismatch.

## 28.6 Recommendation

Avoid `@Encoded` unless exact encoded form is a requirement.

## 28.7 Test

For encoded inputs, test:

- `%20`;
- `%2F`;
- `%25`;
- unicode;
- invalid percent sequences.

---

# 29. `@Encoded`: Kapan Perlu, Kapan Bahaya

## 29.1 Default

Without `@Encoded`, values are decoded.

```java
@PathParam("name") String name
```

Request:

```text
/files/report%202026
```

Parameter:

```text
report 2026
```

## 29.2 With `@Encoded`

```java
@Encoded
@PathParam("name")
String name
```

Parameter:

```text
report%202026
```

## 29.3 Use cases

- raw signature verification;
- building canonical string;
- reverse proxy behavior;
- object storage keys where encoded form matters;
- advanced path forwarding.

## 29.4 Security danger

Encoded values can hide malicious paths:

```text
..%2F..%2Fsecret
```

Double decoding can reveal traversal.

## 29.5 Rule

If you use `@Encoded`, define:

- decoding layer;
- validation;
- logging policy;
- security tests;
- no double decode.

## 29.6 Avoid for normal IDs

For normal domain IDs, decoded value is easier and safer.

---

# 30. Percent Encoding, Reserved Characters, dan Encoded Slash

## 30.1 Reserved characters

RFC 3986 reserved chars include:

```text
:/?#[]@!$&'()*+,;=
```

Some have structural meaning.

## 30.2 Percent encoding

Example:

```text
space -> %20
slash -> %2F
percent -> %25
```

## 30.3 Encoded slash problem

If client sends:

```text
/files/a%2Fb
```

Does it mean:

- one path segment with value `a/b`;
- or two segments `a` and `b`?

Different layers may decode at different times.

## 30.4 Security risk

Encoded slash can bypass path-based security rules.

## 30.5 Best practice

Avoid IDs that require slash in path.

If natural key has slash, use:

- query param;
- base64url safe encoding;
- opaque ID;
- body parameter.

## 30.6 Base64URL

Use URL-safe encoding without slash:

```text
A-Z a-z 0-9 - _
```

## 30.7 Do not put arbitrary file path in URI path

Bad:

```text
/files/{path:.*}
```

unless building controlled file gateway with strict validation.

## 30.8 Test through infrastructure

Encoded slash handling can differ between app server and gateway.

---

# 31. Trailing Slash Policy

Trailing slash can be meaningful.

```text
/customers
/customers/
```

## 31.1 Choose policy

Options:

1. Treat both as same.
2. Redirect one to canonical.
3. Reject non-canonical.
4. Let runtime default.

## 31.2 API recommendation

For APIs, choose one canonical form.

Common:

```text
/customers
/customers/{id}
```

no trailing slash.

## 31.3 Why it matters

- cache keys;
- client consistency;
- documentation;
- routing/matching;
- SEO for web content;
- gateway rewrites.

## 31.4 Redirect

For browser-facing API, redirect can help.

For machine API, redirect may complicate clients.

## 31.5 JAX-RS runtime

Trailing slash behavior can be implementation/config dependent.

## 31.6 Testing

Test both:

```text
GET /customers
GET /customers/
```

## 31.7 Rule

Do not let trailing slash behavior be accidental.

---

# 32. Case Sensitivity dan Naming Convention

URI paths are generally case-sensitive.

## 32.1 Choose lowercase

Recommended:

```text
/customers
/customer-orders
/report-jobs
```

Avoid:

```text
/Customers
/customerOrders
/customer_orders
```

## 32.2 Why lowercase

- easier typing;
- fewer client bugs;
- conventional;
- avoids case normalization surprises.

## 32.3 IDs may be case-sensitive

If domain ID is case-sensitive, document.

Better use opaque stable IDs with clear rules.

## 32.4 Case-insensitive lookup?

If username/email case-insensitive, avoid direct path identity or canonicalize.

## 32.5 Redirect/canonical

If supporting mixed-case paths, redirect to lowercase.

## 32.6 Rule

```text
Resource path names lowercase; identifier semantics explicit.
```

---

# 33. Plural vs Singular Resource Names

Common REST convention: plural collection nouns.

## 33.1 Collection

```text
/customers
/orders
/invoices
```

## 33.2 Item

```text
/customers/{customerId}
```

## 33.3 Singleton resource

Singular can be okay:

```text
/profile
/me
/settings
```

if truly singleton in context.

## 33.4 Avoid mixing

Bad:

```text
/customer/{id}
/orders/{id}
/invoice/{id}
```

Pick style.

## 33.5 Domain terms

Use business language:

```text
/applications
/licences
/compliance-cases
```

## 33.6 Acronyms

Lowercase or hyphenated consistently:

```text
/api-keys
/id-cards
```

## 33.7 Rule

Consistency beats philosophical debate.

---

# 34. Hyphen, Underscore, CamelCase, and Readability

## 34.1 Recommended

Use hyphen for multi-word path segments:

```text
/report-jobs
/customer-orders
/api-keys
```

## 34.2 Avoid camelCase in path

```text
/customerOrders
```

Less URL-conventional.

## 34.3 Avoid underscore

```text
/customer_orders
```

Possible but less common.

## 34.4 Query params

For query params, choose convention:

```text
pageSize
page_size
page-size
```

Be consistent.

Many Java/JSON APIs use camelCase for query params:

```text
pageSize
sortBy
```

But hyphen is also okay if documented.

## 34.5 Do not rename lightly

URI and param names are contract.

## 34.6 Rule

Use:

```text
kebab-case path segments
camelCase JSON fields
documented query param convention
```

unless team standard says otherwise.

---

# 35. File Extension dalam URI: `.json`, `.csv`, `.pdf`

Some APIs use path suffix:

```text
/reports/R001.pdf
/customers.csv
```

## 35.1 Pros

- easy browser download;
- human-friendly;
- legacy compatibility;
- static-like resource feel.

## 35.2 Cons

- duplicates content negotiation;
- ambiguous resource identity;
- extension can lie;
- harder versioning;
- conflicts with path variable parsing.

## 35.3 JAX-RS embedded template

```java
@GET
@Path("/{reportId}.{ext}")
public Response get(
    @PathParam("reportId") String reportId,
    @PathParam("ext") String ext
) { ... }
```

## 35.4 Prefer media type for representation

```http
GET /reports/R001
Accept: application/pdf
```

## 35.5 Download-specific resource

Alternative:

```text
/reports/R001/file
```

with:

```http
Accept: application/pdf
```

## 35.6 CSV export

For export jobs:

```text
POST /customer-export-jobs
GET /customer-export-jobs/{id}/file
```

## 35.7 Rule

Use suffix only if it improves interoperability/usability and is documented.

---

# 36. Media Type Negotiation vs Path Suffix

## 36.1 Negotiation style

```http
GET /reports/R001
Accept: application/pdf
```

## 36.2 Path suffix style

```http
GET /reports/R001.pdf
```

## 36.3 Query style

```http
GET /reports/R001?format=pdf
```

## 36.4 Recommended hierarchy

For REST-pure representation variants:

```text
Accept header
```

For user-facing download convenience:

```text
/file or .pdf can be acceptable
```

## 36.5 Avoid supporting too many ways

If you support all three:

```text
Accept
.format
?format=
```

you increase complexity.

## 36.6 Caching

If response varies by `Accept`, add:

```http
Vary: Accept
```

## 36.7 Observability

Metrics should group by path template and media type.

## 36.8 Rule

Pick one primary representation selection mechanism.

---

# 37. Versioning in URI Path

Common:

```text
/api/v1/customers
```

or if app path includes version:

```java
@ApplicationPath("/api/v1")
```

## 37.1 Pros

- obvious;
- gateway routing easy;
- docs easy;
- can deploy v1/v2 side-by-side.

## 37.2 Cons

- version explosion;
- encourages breaking changes;
- duplicates resources;
- clients pinned forever.

## 37.3 Better default

Try backward-compatible evolution first.

Use path version only for breaking API contract.

## 37.4 Version granularity

Avoid versioning every endpoint separately.

Usually version API group.

## 37.5 URI version with multiple Application classes

```java
@ApplicationPath("/api/v1")
public class ApiV1Application extends Application {}

@ApplicationPath("/api/v2")
public class ApiV2Application extends Application {}
```

## 37.6 Danger

Duplicated resource classes drift.

Use shared service/domain, separate boundary DTO/resources as needed.

## 37.7 Deprecation

Use:

- docs;
- `Sunset` header where applicable;
- deprecation notices;
- monitoring old version usage.

## 37.8 Rule

Versioning is a governance process, not just a path prefix.

---

# 38. Alternative Versioning: Header dan Media Type

## 38.1 Header versioning

```http
API-Version: 2
```

## 38.2 Media type versioning

```http
Accept: application/vnd.example.customer.v2+json
```

## 38.3 Pros

- URI stable;
- aligns with representation version;
- can version by media type.

## 38.4 Cons

- harder for humans/browser;
- gateway routing harder;
- clients/proxies may not handle as easily;
- docs/testing more complex.

## 38.5 Hybrid

Path major version + compatible evolution within.

```text
/api/v1
```

with backwards-compatible fields.

## 38.6 Recommendation

Enterprise teams often prefer URI major version for clarity.

But do not create new major version for every small change.

## 38.7 Rule

Choose versioning style once and document compatibility policy.

---

# 39. Gateway-Aware URI Design

Production path often passes through gateway.

## 39.1 External vs internal path

External:

```text
https://api.example.com/licensing/customers/C001
```

Internal:

```text
http://service:8080/app/api/customers/C001
```

## 39.2 Path rewriting

Gateway may strip:

```text
/licensing
```

before sending to service.

## 39.3 URI building issue

JAX-RS:

```java
uriInfo.getAbsolutePathBuilder()
```

may produce internal host/path.

## 39.4 Forwarded headers

Common:

```text
Forwarded
X-Forwarded-Proto
X-Forwarded-Host
X-Forwarded-Port
X-Forwarded-Prefix
```

Runtime must be configured to trust them only from gateway.

## 39.5 Security

Do not trust client-supplied forwarded headers directly.

Attackers can manipulate generated links/redirects.

## 39.6 Gateway route design

Align:

```text
gateway path prefix
@ApplicationPath
resource path
```

Avoid double prefixes.

## 39.7 OpenAPI servers

OpenAPI server URL should reflect external API, not internal pod.

## 39.8 Test

Smoke test `Location` headers through gateway.

---

# 40. UriInfo dan UriBuilder

JAX-RS provides URI building tools.

## 40.1 `UriInfo`

```java
@Context
UriInfo uriInfo;
```

Gives:

- base URI;
- absolute path;
- request URI;
- path parameters;
- query parameters;
- matched resources/templates.

## 40.2 `UriBuilder`

Build URI safely.

```java
URI location = uriInfo.getAbsolutePathBuilder()
    .path(created.id())
    .build();
```

## 40.3 Build by resource method

```java
URI uri = uriInfo.getBaseUriBuilder()
    .path(CustomerResource.class)
    .path(CustomerResource.class, "get")
    .build(customerId);
```

## 40.4 Benefit

Less string concatenation.

## 40.5 Pitfall

Resource method name refactoring can break if not tested.

## 40.6 Encoding

`UriBuilder` handles encoding, but understand when values are already encoded.

Avoid double encoding.

## 40.7 Query params

```java
URI uri = uriInfo.getAbsolutePathBuilder()
    .queryParam("page", 2)
    .build();
```

## 40.8 Rule

Use `UriBuilder` for generated URIs; avoid manual string concatenation.

---

# 41. Building `Location` Header dengan Benar

For `201 Created`:

```http
Location: /customers/C001
```

or absolute URI.

## 41.1 JAX-RS create example

```java
@POST
public Response create(CreateCustomerRequest request, @Context UriInfo uriInfo) {
    CreatedCustomer created = service.create(request);

    URI location = uriInfo.getAbsolutePathBuilder()
        .path(created.id())
        .build();

    return Response.created(location)
        .entity(mapper.toResponse(created))
        .build();
}
```

## 41.2 If current path is collection

`getAbsolutePathBuilder()` works:

Current:

```text
/customers
```

Add ID:

```text
/customers/C001
```

## 41.3 If current path is command

For:

```text
POST /reports
```

Location should be job:

```text
/reports/jobs/J001
```

Use base builder and resource class:

```java
URI jobUri = uriInfo.getBaseUriBuilder()
    .path(ReportJobResource.class)
    .path(ReportJobResource.class, "get")
    .build(jobId);
```

## 41.4 Relative vs absolute

HTTP allows `Location` as URI reference in modern specs, but absolute URI historically common.

Be consistent.

## 41.5 Gateway issue

Ensure generated URI external.

## 41.6 Security

Do not build redirect/location from untrusted arbitrary URL without validation.

Open redirect risk.

## 41.7 Test

Contract test must assert `Location`.

---

# 42. Path Template dan Observability Cardinality

Metrics must not use raw path.

## 42.1 Bad

```text
http_server_requests{path="/customers/C001"} 1
http_server_requests{path="/customers/C002"} 1
```

This creates time series per ID.

## 42.2 Good

```text
http_server_requests{route="/customers/{customerId}"} 2
```

## 42.3 Jakarta REST 4.0

`UriInfo#getMatchedResourceTemplate` helps get matched template.

## 42.4 For nested resources

Use template:

```text
/customers/{customerId}/orders/{orderId}
```

not actual IDs.

## 42.5 404 paths

For 404, no matched route.

Do not label with full raw path.

Use:

```text
route="UNMATCHED"
```

or low-cardinality path group.

## 42.6 Logs vs metrics

Logs may include raw path for debugging, with redaction/security controls.

Metrics must avoid high cardinality.

## 42.7 Tracing

Span names should also use route template.

## 42.8 Rule

URI design and observability design are connected.

---

# 43. Security: Path Traversal, SSRF, Open Redirect, Authorization Bypass

## 43.1 Path traversal

Bad:

```java
@Path("/files/{path:.*}")
public Response get(@PathParam("path") String path) {
    return Response.ok(new File(baseDir, path)).build();
}
```

Attack:

```text
/files/../../etc/passwd
/files/..%2F..%2Fsecret
```

## 43.2 Safe file access

Use opaque file IDs:

```text
/files/{fileId}
```

Map to storage key in DB/service.

## 43.3 SSRF

If path/query accepts URL:

```text
/fetch?url=http://...
```

Validate allowlist.

## 43.4 Open redirect

Bad:

```text
/login?redirect=https://evil.com
```

Validate redirects as relative or allowlisted.

## 43.5 Authorization bypass via nested path

Request:

```text
/customers/C001/orders/O999
```

Service must verify order O999 belongs to customer C001 and user can access both.

## 43.6 Encoded path bypass

Normalize before authorization.

## 43.7 Sensitive IDs

Avoid secrets in path.

Paths appear in:

- access logs;
- browser history;
- proxy logs;
- metrics;
- referrer headers.

## 43.8 Rule

Treat path params as untrusted input.

---

# 44. URI Design untuk Multi-Tenancy

## 44.1 Tenant in path

```text
/tenants/{tenantId}/customers
```

Good for admin/control plane APIs.

## 44.2 Tenant in token/claim

For normal user APIs, tenant often comes from JWT/session.

```text
/customers
```

with tenant resolved from security context.

## 44.3 Tenant in header

```http
X-Tenant-ID: tenant-a
```

Use carefully. Must validate against principal.

## 44.4 Danger

Never trust tenant ID just because it appears in path/header.

Always authorize.

## 44.5 Cross-tenant admin

Path tenant is explicit:

```text
/admin/tenants/{tenantId}/customers
```

## 44.6 Metrics

Do not use raw tenant ID as high-cardinality metric label unless controlled and intentionally supported.

## 44.7 Cache

Tenant-specific responses must not be cached publicly.

## 44.8 Rule

Tenant identifier placement is a security architecture decision.

---

# 45. URI Design untuk Admin/Internal API

## 45.1 Separate base path

```text
/internal
/admin
/ops
```

## 45.2 Separate application

```java
@ApplicationPath("/internal-api")
public class InternalApiApplication extends Application {}
```

## 45.3 Gateway protection

Internal paths should be protected at network/gateway layer, not only app code.

## 45.4 Avoid public exposure

Ingress rules must not route internal API publicly.

## 45.5 Admin resource naming

```text
/admin/users
/admin/jobs
/admin/audit-events
/internal/reindex-jobs
```

## 45.6 Verb caution

Admin often has operations. Model as job/action resource:

```text
POST /internal/reindex-jobs
```

not:

```text
POST /internal/doReindex
```

## 45.7 Audit

Admin operations must be audited.

## 45.8 Rule

Internal URI is still a contract; design it clearly.

---

# 46. URI Design untuk Long-Running Jobs

## 46.1 Start job

```http
POST /report-jobs
```

or:

```http
POST /reports
```

depending whether report resource is created immediately.

## 46.2 Response

```http
202 Accepted
Location: /report-jobs/J001
Retry-After: 5
```

## 46.3 Job status

```http
GET /report-jobs/J001
```

## 46.4 Result

```http
GET /reports/R001
```

or:

```http
GET /report-jobs/J001/result
```

## 46.5 Cancel

```http
POST /report-jobs/J001/cancellation
```

or:

```http
DELETE /report-jobs/J001
```

depending semantics.

## 46.6 Job collection

```http
GET /report-jobs?status=RUNNING
```

## 46.7 Rule

If operation is async, expose its state as resource.

---

# 47. URI Design untuk File/Document API

## 47.1 Use opaque document ID

```text
/documents/{documentId}
```

not filesystem path.

## 47.2 Metadata

```http
GET /documents/D001
Accept: application/json
```

## 47.3 Content download

```http
GET /documents/D001/content
Accept: application/pdf
```

or:

```text
/documents/D001/file
```

## 47.4 Upload new document

```http
POST /documents
```

or scoped:

```http
POST /applications/A001/documents
```

## 47.5 Replace content

```http
PUT /documents/D001/content
```

## 47.6 Partial upload/chunk

Use upload session resource:

```text
/upload-sessions/{sessionId}/parts/{partNo}
```

## 47.7 Filename

Filename is metadata, not path identity.

Use `Content-Disposition` for download filename.

## 47.8 Security

- size limits;
- malware scan;
- content type validation;
- authorization;
- no path traversal;
- audit downloads.

---

# 48. URI Design untuk State Machine / Workflow

## 48.1 Resource state

```text
/applications/{applicationId}
```

has state:

```text
DRAFT
SUBMITTED
APPROVED
REJECTED
```

## 48.2 Submit

```http
POST /applications/{applicationId}/submission
```

## 48.3 Approve

```http
POST /applications/{applicationId}/approval
```

## 48.4 Reject

```http
POST /applications/{applicationId}/rejection
```

with body:

```json
{
  "reason": "Incomplete documents"
}
```

## 48.5 History

```http
GET /applications/{applicationId}/events
```

or:

```http
GET /applications/{applicationId}/status-history
```

## 48.6 Invalid transition

```http
409 Conflict
```

## 48.7 Concurrency

Use ETag:

```http
If-Match: "v3"
```

## 48.8 Rule

Workflow URI should express domain action as resource/event, not Java method call.

---

# 49. Testing URI Design

## 49.1 Matching tests

Test:

- literals;
- variables;
- regex;
- reserved words;
- invalid IDs;
- trailing slash;
- encoded values.

## 49.2 Contract tests

Assert:

- method;
- URI;
- status;
- headers;
- body.

## 49.3 Location tests

For create/async endpoints:

- `Location` path correct;
- external gateway URL correct if required.

## 49.4 Gateway tests

Run tests through ingress/gateway for:

- path rewrite;
- semicolon/matrix param;
- encoded slash;
- forwarded headers.

## 49.5 Security tests

- path traversal;
- encoded traversal;
- tenant mismatch;
- relationship mismatch;
- open redirect.

## 49.6 Observability tests

Verify metrics use path template.

## 49.7 Documentation tests

OpenAPI paths match actual runtime.

## 49.8 Regression matrix

Create test table:

```text
request path | method | expected status | expected route template
```

---

# 50. Common Failure Modes

## 50.1 `/search` captured as `{id}`

Reserved literal not protected/tested.

## 50.2 `{id}` and `{slug}` ambiguity

Variable names don't route.

## 50.3 Regex too strict

New ID format fails with 404.

## 50.4 Regex too loose

Sensitive paths captured.

## 50.5 Matrix params stripped

Gateway removes semicolon content.

## 50.6 `Location` header internal host

App unaware of proxy.

## 50.7 Encoded slash bypass

Path authorization sees different path than app.

## 50.8 Trailing slash inconsistent

Client gets 404 in production.

## 50.9 Deep nested path stale after hierarchy changes

Canonical identity tied to mutable parent.

## 50.10 File path traversal

Path param used as filesystem path.

## 50.11 Metrics cardinality explosion

Raw path used as label.

## 50.12 Versioning sprawl

`/v1`, `/v2`, `/v3` with duplicated logic.

---

# 51. Best Practices

## 51.1 Resource-oriented paths

Use nouns/resource concepts.

## 51.2 Stable canonical URI

Each important resource has self URI.

## 51.3 Path for identity, query for filtering

Keep distinction clear.

## 51.4 Use regex for syntax shape

Especially IDs with known format.

## 51.5 Avoid ambiguous templates

Do not overload `{id}` and `{slug}`.

## 51.6 Reserve literal words

Document and test.

## 51.7 Keep nesting shallow

Prefer canonical root resources for globally identifiable objects.

## 51.8 Prefer query over matrix for public APIs

Unless segment-specific semantics required and infra supports it.

## 51.9 Use UriBuilder

Avoid manual URL concatenation.

## 51.10 Test behind gateway

Especially `Location`, semicolon, encoding, forwarded headers.

## 51.11 Use path templates in observability

No raw IDs in metric labels.

## 51.12 Treat path params as untrusted

Validate and authorize.

---

# 52. Anti-Patterns

## 52.1 Verb URIs

```text
/getCustomer
/deleteOrder
/processApplication
```

## 52.2 Overloaded variable routes

```text
/{id}
/{slug}
/{name}
```

## 52.3 Catch-all path

```java
@Path("/{path:.*}")
```

without strict controls.

## 52.4 Deep hierarchy

```text
/a/{a}/b/{b}/c/{c}/d/{d}
```

## 52.5 Sensitive data in path

```text
/reset-password/{token}
```

Prefer short-lived token in body or controlled flow; if URL required, understand logs/referrers.

## 52.6 Matrix params in public API without infra tests

Likely break.

## 52.7 Manual URI concatenation

```java
URI.create("/customers/" + id)
```

encoding bugs.

## 52.8 Encoding twice

Leads to wrong links/security issues.

## 52.9 Raw URI metric labels

Cardinality explosion.

## 52.10 Version everything aggressively

Maintenance burden.

---

# 53. Production Checklist

## 53.1 URI identity

- [ ] Resource has canonical URI.
- [ ] Aliases documented.
- [ ] Path names stable.
- [ ] No Java method names in URI.
- [ ] Path conventions consistent.

## 53.2 Path templates

- [ ] Variables named domain-specifically.
- [ ] Regex used for known ID syntax.
- [ ] Regex tested.
- [ ] Reserved literals tested.
- [ ] No ambiguous variable-only routes.
- [ ] No unsafe catch-all.

## 53.3 Params

- [ ] Path params identify resource/hierarchy.
- [ ] Query params used for filtering/sorting/pagination.
- [ ] Matrix params avoided or infrastructure-tested.
- [ ] Encoded behavior defined.
- [ ] No sensitive secrets in path.

## 53.4 Gateway

- [ ] External path documented.
- [ ] Path rewrite tested.
- [ ] Forwarded headers configured safely.
- [ ] `Location` and links correct externally.
- [ ] Semicolon/encoded slash behavior known.

## 53.5 Security

- [ ] Path traversal tests.
- [ ] Encoded traversal tests.
- [ ] Relationship authorization tests.
- [ ] Tenant spoofing tests.
- [ ] Open redirect tests.
- [ ] No file path direct mapping.

## 53.6 Observability

- [ ] Metrics use route template.
- [ ] 404 route label low-cardinality.
- [ ] Traces use route template.
- [ ] Logs redacted.

## 53.7 Versioning

- [ ] Versioning strategy documented.
- [ ] Deprecation policy.
- [ ] Compatibility rules.
- [ ] Old version usage monitored.

---

# 54. Latihan

## Latihan 1 — URI Audit

Ambil 20 endpoint dari project.

Kategorikan:

```text
collection
item
relationship
command/action
job
search
file/document
admin/internal
```

Tandai endpoint yang masih verb-based.

## Latihan 2 — Reserved Literal Test

Untuk resource:

```text
/users/{userId}
```

Tambahkan literals:

```text
/users/me
/users/search
/users/export
```

Buat tests untuk memastikan tidak salah route.

## Latihan 3 — Regex Design

Desain regex untuk:

```text
customer ID: CUST-000001
order ID: ORD-2026-0001
UUID
slug
```

Lalu test valid/invalid/boundary.

## Latihan 4 — Matrix Param Experiment

Buat endpoint:

```text
/cars;color=red;year=2026
```

Ambil dengan `@MatrixParam`.

Lalu test lewat gateway/proxy jika ada.

## Latihan 5 — Canonical URI

Pilih resource yang bisa diakses lewat beberapa path.

Tentukan canonical URI dan alias policy.

## Latihan 6 — Location Header

Implement `POST /customers`.

Assert:

```text
201 Created
Location: /customers/{id}
```

Test direct runtime dan via gateway.

## Latihan 7 — Path Traversal Defense

Buat file download endpoint dengan opaque file ID.

Tulis negative tests:

```text
../secret
..%2Fsecret
%2e%2e%2fsecret
```

## Latihan 8 — Versioning ADR

Tulis ADR:

```text
Why we use /api/v1 path versioning
or why we use media type/header versioning
```

## Latihan 9 — Observability

Pastikan metrics untuk:

```text
/customers/C001
/customers/C002
```

masuk ke route label yang sama:

```text
/customers/{customerId}
```

---

# 55. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 — `@Path` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/path

2. Jakarta RESTful Web Services 4.0 — `@MatrixParam` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/matrixparam

3. Jakarta RESTful Web Services 4.0 — `PathSegment` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/pathsegment

4. Jakarta RESTful Web Services 4.0 — `PathParam` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/pathparam

5. Jakarta RESTful Web Services 4.0 — `Encoded` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/encoded

6. Jakarta RESTful Web Services 4.0 — `UriInfo` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/uriinfo

7. Jakarta RESTful Web Services 4.0 — `UriBuilder` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/uribuilder

8. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

9. RFC 3986 — Uniform Resource Identifier: Generic Syntax  
   https://www.rfc-editor.org/rfc/rfc3986.html

10. W3C Matrix URIs  
    https://www.w3.org/DesignIssues/MatrixURIs.html

11. RFC 9110 — HTTP Semantics  
    https://www.rfc-editor.org/rfc/rfc9110.html

---

# 56. Penutup

Part ini membahas URI design sebagai fondasi resource contract.

Mental model utama:

```text
Path identifies resource hierarchy/identity.
Query modifies view/filtering.
Header carries request metadata/negotiation.
Body carries representation/command detail.
```

JAX-RS tools:

```java
@Path
@PathParam
@MatrixParam
PathSegment
@Encoded
UriInfo
UriBuilder
```

Hal terpenting:

```text
Do not design URI as Java method name.
Design URI as stable resource identity.
```

Top-tier JAX-RS engineer tidak hanya membuat path yang “bisa dipanggil”. Ia memastikan path:

- tidak ambiguous;
- tidak mudah bentrok reserved literal;
- aman terhadap encoding/path traversal;
- jelas antara identity vs filter;
- punya canonical URI;
- compatible dengan gateway;
- bisa menghasilkan `Location` header yang benar;
- bisa diobservasi tanpa cardinality explosion;
- punya versioning/deprecation policy.

Part berikutnya:

```text
Bagian 006 — Parameter Injection: @PathParam, @QueryParam, @HeaderParam, @CookieParam, @MatrixParam
```

Kita akan membedah semua mekanisme parameter injection, conversion, default values, collection params, error behavior, lifecycle constraints, and production patterns.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-jaxrs-advanced-part-004.md">⬅️ Bagian 004 — Request Matching Algorithm Deep Dive: Path Template, Specificity, Subresource, Media Type, dan Debugging 404/405/406/415</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-jaxrs-advanced-part-006.md">Bagian 006 — Parameter Injection: `@PathParam`, `@QueryParam`, `@HeaderParam`, `@CookieParam`, `@MatrixParam`, `@DefaultValue`, `@BeanParam` ➡️</a>
</div>
