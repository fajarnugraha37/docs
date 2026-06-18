# learn-jaxrs-advanced-part-020.md

# Bagian 020 — Pagination, Sorting, Filtering, Search, and Query Contract Design: Offset vs Cursor, Stable Ordering, Allowlist, Query DTO, Index-Aware API, dan Enterprise Search Semantics

> Target pembaca: Java/Jakarta engineer yang ingin mendesain **query contract** REST API secara production-grade. Fokus bagian ini bukan hanya `?page=1&size=20`, tetapi bagaimana membuat pagination, sorting, filtering, dan search yang stabil, aman, index-aware, backward-compatible, observable, dan tidak membocorkan data.
>
> Namespace utama: `jakarta.ws.rs.QueryParam`, `jakarta.ws.rs.DefaultValue`, `jakarta.ws.rs.BeanParam`, `jakarta.ws.rs.core.UriInfo`, `jakarta.ws.rs.core.MultivaluedMap`, `jakarta.ws.rs.core.UriBuilder`, `jakarta.ws.rs.core.Link`, `jakarta.ws.rs.core.Response`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Query Contract adalah API, Bukan Detail Database](#2-mental-model-query-contract-adalah-api-bukan-detail-database)
3. [GET, Safe Semantics, dan Query Parameters](#3-get-safe-semantics-dan-query-parameters)
4. [JAX-RS Building Blocks: `@QueryParam`, `@DefaultValue`, `@BeanParam`, `UriInfo`](#4-jax-rs-building-blocks-queryparam-defaultvalue-beanparam-uriinfo)
5. [Kenapa Query Contract Harus Didesain Serius](#5-kenapa-query-contract-harus-didesain-serius)
6. [Pagination: Masalah yang Terlihat Mudah Tapi Sulit](#6-pagination-masalah-yang-terlihat-mudah-tapi-sulit)
7. [Offset Pagination](#7-offset-pagination)
8. [Page Number Pagination](#8-page-number-pagination)
9. [Limit/Offset Pagination](#9-limitoffset-pagination)
10. [Cursor Pagination](#10-cursor-pagination)
11. [Keyset Pagination](#11-keyset-pagination)
12. [Cursor vs Keyset: Hubungan dan Perbedaan](#12-cursor-vs-keyset-hubungan-dan-perbedaan)
13. [Stable Ordering: Syarat Wajib Pagination yang Benar](#13-stable-ordering-syarat-wajib-pagination-yang-benar)
14. [Tie-Breaker Sort Key](#14-tie-breaker-sort-key)
15. [Pagination Consistency: Insert/Delete During Paging](#15-pagination-consistency-insertdelete-during-paging)
16. [Snapshot vs Live View](#16-snapshot-vs-live-view)
17. [Cursor Token Design](#17-cursor-token-design)
18. [Opaque Cursor vs Transparent Cursor](#18-opaque-cursor-vs-transparent-cursor)
19. [Cursor Security: Signing, Expiry, Tenant, Filter Binding](#19-cursor-security-signing-expiry-tenant-filter-binding)
20. [Pagination Response Shape](#20-pagination-response-shape)
21. [`Link` Header Pagination with RFC 8288](#21-link-header-pagination-with-rfc-8288)
22. [Response Body Links vs Link Headers](#22-response-body-links-vs-link-headers)
23. [Total Count: Mahal, Berguna, dan Sering Disalahgunakan](#23-total-count-mahal-berguna-dan-sering-disalahgunakan)
24. [Approximate Count dan Has-Next Strategy](#24-approximate-count-dan-has-next-strategy)
25. [Page Size Limits](#25-page-size-limits)
26. [Sorting Contract](#26-sorting-contract)
27. [Sort Syntax Options](#27-sort-syntax-options)
28. [Sort Field Allowlist](#28-sort-field-allowlist)
29. [Sort Direction dan Null Ordering](#29-sort-direction-dan-null-ordering)
30. [Multi-Column Sorting](#30-multi-column-sorting)
31. [Sorting by Derived/Computed Fields](#31-sorting-by-derivedcomputed-fields)
32. [Filtering Contract](#32-filtering-contract)
33. [Simple Field Filters](#33-simple-field-filters)
34. [Range Filters](#34-range-filters)
35. [Repeated Query Parameters](#35-repeated-query-parameters)
36. [Filter Operators: eq, ne, gt, gte, lt, lte, in, contains](#36-filter-operators-eq-ne-gt-gte-lt-lte-in-contains)
37. [Filter Grammar Options](#37-filter-grammar-options)
38. [Unknown Filter Policy](#38-unknown-filter-policy)
39. [Filtering and Authorization](#39-filtering-and-authorization)
40. [Search Semantics](#40-search-semantics)
41. [Search vs Filter](#41-search-vs-filter)
42. [Full-Text Search Query Contract](#42-full-text-search-query-contract)
43. [Search Ranking vs Stable Pagination](#43-search-ranking-vs-stable-pagination)
44. [Index-Aware API Design](#44-index-aware-api-design)
45. [Database/Storage Implications](#45-databasestorage-implications)
46. [Query DTO with `@BeanParam`](#46-query-dto-with-beanparam)
47. [Manual Query Parsing with `UriInfo`](#47-manual-query-parsing-with-uriinfo)
48. [ParamConverter for Sort/Filter/Cursor](#48-paramconverter-for-sortfiltercursor)
49. [Validation for Query Contract](#49-validation-for-query-contract)
50. [Error Handling and Problem Details](#50-error-handling-and-problem-details)
51. [URI Building for Next/Prev Links](#51-uri-building-for-nextprev-links)
52. [Caching Query Responses](#52-caching-query-responses)
53. [ETag and Conditional Requests for Collections](#53-etag-and-conditional-requests-for-collections)
54. [Performance Patterns](#54-performance-patterns)
55. [Security Considerations](#55-security-considerations)
56. [Observability](#56-observability)
57. [Testing Query Contracts](#57-testing-query-contracts)
58. [OpenAPI Documentation](#58-openapi-documentation)
59. [Evolution and Backward Compatibility](#59-evolution-and-backward-compatibility)
60. [Runtime Differences and Implementation Notes](#60-runtime-differences-and-implementation-notes)
61. [Common Failure Modes](#61-common-failure-modes)
62. [Best Practices](#62-best-practices)
63. [Anti-Patterns](#63-anti-patterns)
64. [Production Checklist](#64-production-checklist)
65. [Latihan](#65-latihan)
66. [Referensi Resmi](#66-referensi-resmi)
67. [Penutup](#67-penutup)

---

# 1. Tujuan Part Ini

Endpoint list/search sering tampak sederhana:

```http
GET /customers?page=1&size=20
```

atau:

```http
GET /cases?status=open&sort=createdAt:desc
```

Tetapi di sistem production, list/search endpoint sering menjadi sumber:

- query lambat;
- database overload;
- pagination duplicate/missing data;
- inconsistent ordering;
- data leak lintas tenant;
- filter injection;
- sort field tidak terindeks;
- client coupling terhadap field internal;
- total count mahal;
- API tidak backward-compatible;
- observability high-cardinality;
- search result berubah saat user pindah halaman;
- export endpoint mem-bypass authorization.

## 1.1 Tujuan utama

Bagian ini membantu kamu mendesain query API yang:

- jelas untuk client;
- aman dari abuse;
- predictable;
- compatible;
- index-aware;
- mudah dites;
- bisa diobservasi;
- tidak membocorkan data;
- bisa evolve tanpa breaking change besar.

## 1.2 Prinsip utama

```text
Query parameters are public API contract.
They are not direct database query builders.
```

---

# 2. Mental Model: Query Contract adalah API, Bukan Detail Database

Query contract adalah bahasa yang kamu berikan kepada client untuk meminta subset, urutan, dan bentuk hasil.

## 2.1 Bad mental model

```text
Client mengirim query param → langsung translate ke SQL WHERE/ORDER BY.
```

Contoh buruk:

```http
GET /customers?orderBy=database_column_name&where=status='ACTIVE'
```

Masalah:

- SQL injection;
- schema leak;
- index-unaware;
- breaking ketika DB schema berubah;
- authorization bypass;
- API terlalu dekat ke database.

## 2.2 Better mental model

```text
Client menggunakan query vocabulary yang diizinkan.
Server memvalidasi.
Server menerjemahkan ke query plan internal yang aman.
Server menambahkan authorization/tenant constraints.
```

Example:

```http
GET /customers?status=active&sort=createdAt:desc&limit=20
```

Internal:

```text
status=active → allowed public filter
sort=createdAt:desc → mapped to indexed column customers.created_at
tenantId from CurrentActor → always applied
limit capped at 100
```

## 2.3 Query API sebagai DSL

Setiap list/search endpoint memiliki DSL kecil:

```text
pagination params
sort syntax
filter fields
filter operators
search terms
include fields
projection
```

## 2.4 Top-tier rule

```text
Expose business query vocabulary, not storage vocabulary.
```

---

# 3. GET, Safe Semantics, dan Query Parameters

List/search biasanya memakai `GET`.

## 3.1 GET should be safe

GET tidak boleh mengubah state server yang signifikan.

Bad:

```http
GET /orders/123/cancel
```

Good:

```http
POST /orders/123/cancellations
```

## 3.2 Query parameters refine resource representation

```http
GET /cases?status=open&assignedTo=me
```

Query string mengidentifikasi representasi subset dari collection resource.

## 3.3 GET body

Jangan desain search API yang bergantung pada request body di GET.

Meskipun beberapa stack bisa menerima, interoperabilitas/cache/proxy/tooling buruk.

## 3.4 Search terlalu kompleks?

Jika query sangat kompleks, gunakan:

```http
POST /case-searches
```

atau:

```http
POST /search-jobs
```

dengan semantics jelas, bukan GET body.

## 3.5 Rule

Use GET for safe, URI-expressible queries. Use POST for complex query resources/jobs when needed.

---

# 4. JAX-RS Building Blocks: `@QueryParam`, `@DefaultValue`, `@BeanParam`, `UriInfo`

## 4.1 `@QueryParam`

```java
@GET
public Response list(
    @QueryParam("page") @DefaultValue("1") int page,
    @QueryParam("size") @DefaultValue("20") int size
) {
    ...
}
```

`@QueryParam` binds HTTP query parameter values to Java parameters/fields/properties.

## 4.2 `@DefaultValue`

```java
@DefaultValue("20")
```

Supplies default when parameter missing.

## 4.3 Collection query params

```java
@QueryParam("status")
List<String> statuses
```

Can capture repeated values:

```http
?status=open&status=pending
```

## 4.4 `@BeanParam`

Aggregates parameters into a bean.

```java
public class CustomerSearchParams {
    @QueryParam("cursor")
    String cursor;

    @QueryParam("limit")
    @DefaultValue("20")
    int limit;

    @QueryParam("sort")
    List<String> sort;
}
```

Resource:

```java
@GET
public Response search(@BeanParam @Valid CustomerSearchParams params) {
    ...
}
```

## 4.5 `UriInfo`

```java
@Context
UriInfo uriInfo;

MultivaluedMap<String, String> query = uriInfo.getQueryParameters();
```

Useful when you need:

- all query params;
- duplicate detection;
- unknown parameter policy;
- next/prev link building;
- raw URI info.

## 4.6 Rule

Use `@BeanParam` for structured public params; use `UriInfo` for full query contract enforcement.

---

# 5. Kenapa Query Contract Harus Didesain Serius

## 5.1 Client compatibility

Once clients rely on:

```http
sort=createdAt:desc
```

removing/changing it is breaking.

## 5.2 Performance

A filter can make query scan millions of rows.

## 5.3 Security

A filter can expose data across tenant if authorization not applied.

## 5.4 UX

Pagination that duplicates/skips items breaks UI.

## 5.5 Operations

Unbounded `size=1000000` can take service down.

## 5.6 Rule

Every query parameter needs owner, semantics, validation, and performance model.

---

# 6. Pagination: Masalah yang Terlihat Mudah Tapi Sulit

Pagination solves:

```text
Return manageable chunks instead of entire collection.
```

But real challenges:

- stable order;
- concurrent inserts/deletes;
- large offsets;
- total count cost;
- cursor integrity;
- user changing filters between pages;
- authorization changes;
- index design;
- search ranking changes;
- cache behavior.

## 6.1 Basic API

```http
GET /customers?limit=20&cursor=...
```

or:

```http
GET /customers?page=1&size=20
```

## 6.2 Two big families

```text
offset/page-based pagination
cursor/keyset pagination
```

## 6.3 Rule

Choose pagination based on data size, consistency needs, UX, and query pattern.

---

# 7. Offset Pagination

Offset pagination asks:

```text
skip N rows, return M rows
```

Example:

```http
GET /customers?offset=40&limit=20
```

SQL-ish:

```sql
ORDER BY created_at DESC, id DESC
OFFSET 40
LIMIT 20
```

## 7.1 Pros

- easy to understand;
- easy jump to page;
- simple UI;
- common.

## 7.2 Cons

- slow for large offset;
- unstable under insert/delete;
- can duplicate/miss rows;
- count often expensive.

## 7.3 Good for

- small datasets;
- admin UI;
- low-frequency queries;
- static-ish data;
- simple reporting.

## 7.4 Bad for

- large feeds;
- high-write collections;
- infinite scroll;
- very deep pagination;
- search results with changing ranking.

## 7.5 Rule

Offset is simple but not always scalable or consistent.

---

# 8. Page Number Pagination

Page pagination is offset in disguise.

```http
GET /customers?page=3&size=20
```

Internal:

```text
offset = (page - 1) * size
```

## 8.1 Pros

- intuitive for UI;
- easy first/last if total count known;
- familiar.

## 8.2 Cons

Same as offset:

- deep page slow;
- inconsistent under mutations;
- needs count for total pages.

## 8.3 Page starts at 0 or 1?

Choose one and document.

Human UI usually page 1.

APIs should avoid ambiguity.

## 8.4 Validate

```java
@Min(1)
int page;

@Min(1)
@Max(100)
int size;
```

## 8.5 Rule

Page pagination should be used only when jump-to-page UX is truly needed.

---

# 9. Limit/Offset Pagination

Limit/offset is more direct than page.

```http
GET /customers?limit=20&offset=40
```

## 9.1 Pros

- precise;
- common in APIs;
- easy for clients.

## 9.2 Cons

- offset performance issue;
- harder page UI semantics;
- still inconsistent under data changes.

## 9.3 Validate

```java
@Min(0)
int offset;

@Min(1)
@Max(100)
int limit;
```

## 9.4 Cap deep offset

Example:

```text
offset <= 10_000
```

or require cursor for deeper access.

## 9.5 Rule

Limit/offset is okay for bounded datasets; cap it.

---

# 10. Cursor Pagination

Cursor pagination uses a token representing position.

```http
GET /customers?limit=20&cursor=eyJjcmVhdGVkQXQiOiIyMDI2...
```

Response includes next cursor.

## 10.1 Pros

- scalable for large data;
- stable with index;
- good for infinite scroll;
- avoids deep offset scan;
- can bind to filter/sort.

## 10.2 Cons

- cannot jump to arbitrary page easily;
- cursor design complexity;
- token security needed;
- client must follow sequence.

## 10.3 Good for

- feeds;
- audit logs;
- events;
- large collections;
- high-write tables;
- search results if ranking captured.

## 10.4 Example response

```json
{
  "items": [...],
  "page": {
    "limit": 20,
    "nextCursor": "eyJ2IjoxLCJrZXkiOns..."
  }
}
```

## 10.5 Rule

Cursor pagination is preferred for large or frequently changing collections.

---

# 11. Keyset Pagination

Keyset pagination uses last seen sort key.

Example sort:

```text
createdAt DESC, id DESC
```

First page:

```sql
WHERE tenant_id = ?
ORDER BY created_at DESC, id DESC
LIMIT 21
```

Next page after last row:

```sql
WHERE tenant_id = ?
  AND (created_at, id) < (?, ?)
ORDER BY created_at DESC, id DESC
LIMIT 21
```

## 11.1 Pros

- efficient with index;
- stable;
- no large offset;
- natural cursor backing.

## 11.2 Cons

- requires deterministic sort;
- harder with arbitrary sorting;
- complex with nullable/computed fields;
- cannot jump to page.

## 11.3 API cursor

Client does not send raw keys; server sends opaque cursor.

## 11.4 Rule

Cursor pagination is often implemented with keyset pagination internally.

---

# 12. Cursor vs Keyset: Hubungan dan Perbedaan

## 12.1 Cursor

API concept:

```text
token passed by client to continue.
```

## 12.2 Keyset

Database/query technique:

```text
WHERE key < last_seen_key
```

## 12.3 Cursor may contain keyset

Cursor token can encode:

```json
{
  "lastCreatedAt": "2026-06-12T10:00:00Z",
  "lastId": "C001"
}
```

## 12.4 Cursor can also represent snapshot

Cursor may encode snapshot ID, search session ID, or scroll token.

## 12.5 Rule

Cursor is contract; keyset is implementation.

---

# 13. Stable Ordering: Syarat Wajib Pagination yang Benar

Pagination without stable order is broken.

## 13.1 Bad

```sql
ORDER BY created_at DESC
```

If multiple rows have same `created_at`, order can change.

## 13.2 Good

```sql
ORDER BY created_at DESC, id DESC
```

`id` is tie-breaker.

## 13.3 API sort

If client says:

```http
sort=createdAt:desc
```

Server internally appends:

```text
id:desc
```

as stable tie-breaker.

## 13.4 Document?

You can document that order is deterministic but not expose tie-breaker unless needed.

## 13.5 Rule

Every paginated collection must have deterministic total ordering.

---

# 14. Tie-Breaker Sort Key

Tie-breaker ensures uniqueness.

## 14.1 Good tie-breakers

- immutable ID;
- createdAt + ID;
- sequence number;
- event offset;
- monotonically increasing version.

## 14.2 Bad tie-breakers

- mutable display name;
- status;
- non-unique timestamp alone;
- random order unless intentionally random snapshot.

## 14.3 Direction

If primary sort descending, tie-breaker should usually match direction for keyset consistency.

## 14.4 Index

Index should match sort:

```sql
CREATE INDEX idx_customer_tenant_created_id
ON customer(tenant_id, created_at DESC, id DESC);
```

## 14.5 Rule

Tie-breaker is not optional.

---

# 15. Pagination Consistency: Insert/Delete During Paging

## 15.1 Offset issue

Page 1:

```text
A B C D
```

New item inserted before page 2.

Page 2 may duplicate or skip.

## 15.2 Cursor/keyset issue

Cursor based on last seen key avoids many duplicate/skip problems.

But if data mutates or sort field changes, complexity remains.

## 15.3 Deletes

Deleted rows may disappear; cursor should still move.

## 15.4 Updates to sort field

If sort field changes between pages, item may move.

## 15.5 Rule

Document pagination consistency guarantees.

---

# 16. Snapshot vs Live View

## 16.1 Live view

Each page reads current database state.

Pros:

- simple;
- fresh.

Cons:

- changes between pages visible.

## 16.2 Snapshot

All pages come from same snapshot/search session.

Pros:

- consistent results.

Cons:

- storage/session cost;
- expiry;
- complex.

## 16.3 Use cases for snapshot

- legal/audit exports;
- reporting;
- long-running search;
- compliance-sensitive review.

## 16.4 Cursor can include snapshot ID

```json
{
  "snapshotId": "S123",
  "lastKey": ...
}
```

## 16.5 Rule

Most APIs use live cursor; reports/exports may need snapshot/job.

---

# 17. Cursor Token Design

Cursor token can contain:

```json
{
  "v": 1,
  "sort": ["createdAt:desc", "id:desc"],
  "last": {
    "createdAt": "2026-06-12T10:00:00Z",
    "id": "C001"
  },
  "filterHash": "abc",
  "tenantId": "T1",
  "exp": 1780000000
}
```

## 17.1 Version

Include cursor format version.

## 17.2 Last key

Represents position.

## 17.3 Sort binding

Cursor only valid for same sort.

## 17.4 Filter binding

Cursor only valid for same filters.

## 17.5 Tenant/user binding

Prevents cursor reuse across tenants/users.

## 17.6 Expiry

Prevents indefinite token validity.

## 17.7 Rule

Cursor is not just last ID. It is continuation contract.

---

# 18. Opaque Cursor vs Transparent Cursor

## 18.1 Transparent cursor

Client can read:

```text
createdAt=...&id=...
```

Pros:

- debuggable;
- simple.

Cons:

- leaks internals;
- client may construct invalid cursors;
- hard to evolve.

## 18.2 Opaque cursor

```text
base64url(signed-json)
```

Pros:

- hides internals;
- can sign;
- evolvable;
- binds to filters.

Cons:

- less debuggable;
- server code more complex.

## 18.3 Recommendation

Use opaque cursor for public APIs.

## 18.4 Rule

Clients should treat cursor as opaque string.

---

# 19. Cursor Security: Signing, Expiry, Tenant, Filter Binding

## 19.1 Signing

Use HMAC or authenticated encryption to prevent tampering.

## 19.2 Expiry

Cursor should expire if it represents snapshot/security context.

## 19.3 Tenant binding

Cursor for tenant T1 should not work for T2.

## 19.4 Filter binding

Cursor generated for:

```http
status=open
```

should not be reused with:

```http
status=closed
```

## 19.5 User binding

If authorization differs per user, bind cursor to actor or policy hash.

## 19.6 Rule

Cursor token is untrusted client input. Validate and verify it.

---

# 20. Pagination Response Shape

## 20.1 Minimal cursor response

```json
{
  "items": [
    { "id": "C001" }
  ],
  "page": {
    "limit": 20,
    "hasNext": true,
    "nextCursor": "..."
  }
}
```

## 20.2 Offset response

```json
{
  "items": [],
  "page": {
    "page": 1,
    "size": 20,
    "totalItems": 123,
    "totalPages": 7
  }
}
```

## 20.3 Link response

```json
{
  "items": [],
  "links": {
    "self": "...",
    "next": "...",
    "prev": "..."
  }
}
```

## 20.4 Avoid top-level array only

Top-level array:

```json
[]
```

Cannot include metadata cleanly.

## 20.5 Rule

Use envelope for collection responses.

---

# 21. `Link` Header Pagination with RFC 8288

RFC 8288 defines Web Linking and `Link` header field.

Pagination can use:

```http
Link: </customers?cursor=abc&limit=20>; rel="next"
Link: </customers?cursor=prev&limit=20>; rel="prev"
```

## 21.1 JAX-RS `Link`

```java
Link next = Link.fromUri(nextUri)
    .rel("next")
    .build();

return Response.ok(page)
    .links(next)
    .build();
```

## 21.2 Common rels

```text
self
next
prev
first
last
```

## 21.3 Cursor pagination

Usually:

```text
next
prev optional
```

No `last` unless meaningful.

## 21.4 Offset pagination

Can provide:

```text
first prev next last
```

if count known.

## 21.5 Rule

Use `Link` headers for navigation metadata, especially for REST/hypermedia-friendly clients.

---

# 22. Response Body Links vs Link Headers

## 22.1 Link header

Pros:

- standard;
- works outside JSON body;
- cache/link-aware tooling.

Cons:

- frontend JS needs exposed header in CORS;
- clients may ignore headers.

## 22.2 Body links

Pros:

- easy for JSON clients;
- visible in response schema;
- easier frontend.

Cons:

- format-specific;
- duplicates header if both.

## 22.3 Recommendation

For public APIs, body links are often easiest.

For standards-oriented APIs, include both if justified.

## 22.4 CORS

If frontend needs `Link` header:

```http
Access-Control-Expose-Headers: Link
```

## 22.5 Rule

Choose link location based on client ecosystem.

---

# 23. Total Count: Mahal, Berguna, dan Sering Disalahgunakan

## 23.1 Why useful

UI wants:

```text
123 total items
7 pages
```

## 23.2 Why expensive

`COUNT(*)` with filters/joins/authorization can be expensive.

## 23.3 Inconsistent

Total can change between page requests.

## 23.4 Alternatives

- `hasNext`;
- approximate count;
- count endpoint;
- async report;
- capped count.

## 23.5 Rule

Do not return exact total count by default unless you can afford and define semantics.

---

# 24. Approximate Count dan Has-Next Strategy

## 24.1 Has next

Fetch `limit + 1`.

If extra row exists:

```text
hasNext = true
```

Return only `limit`.

## 24.2 Approx count

Return:

```json
"totalEstimate": 10000,
"totalCountExact": false
```

## 24.3 Count endpoint

```http
GET /customers/count?status=open
```

Can be cached/rate-limited separately.

## 24.4 Capped count

```text
10000+
```

## 24.5 Rule

Use `hasNext` for pagination; exact count only when truly needed.

---

# 25. Page Size Limits

## 25.1 Default size

Example:

```text
limit default = 20
```

## 25.2 Max size

Example:

```text
limit max = 100
```

## 25.3 Validation

```java
@Min(1)
@Max(100)
@DefaultValue("20")
@QueryParam("limit")
int limit;
```

## 25.4 Endpoint-specific max

Export/list/search may differ.

## 25.5 Rule

Never allow unbounded collection response.

---

# 26. Sorting Contract

Sorting defines result order.

## 26.1 Example

```http
GET /customers?sort=createdAt:desc
```

## 26.2 Contract must define

- allowed fields;
- direction syntax;
- default sort;
- multi-sort support;
- null ordering;
- tie-breaker;
- stability guarantee.

## 26.3 Server maps public field to internal field

```text
createdAt → customer.created_at
displayName → customer.display_name_normalized
```

## 26.4 Rule

Sort fields are public API names, not DB columns.

---

# 27. Sort Syntax Options

## 27.1 Colon syntax

```http
sort=createdAt:desc
sort=displayName:asc
```

## 27.2 Prefix syntax

```http
sort=-createdAt
sort=displayName
```

## 27.3 Repeated sort

```http
sort=createdAt:desc&sort=id:desc
```

## 27.4 Comma syntax

```http
sort=createdAt:desc,id:desc
```

## 27.5 Recommendation

Repeated parameters are clean with JAX-RS collection binding:

```java
@QueryParam("sort")
List<String> sort
```

## 27.6 Rule

Choose one syntax and reject ambiguous alternatives.

---

# 28. Sort Field Allowlist

Never allow arbitrary sort fields.

## 28.1 Bad

```http
sort=anyDatabaseColumn
```

## 28.2 Good

```java
Map<String, SortField> allowed = Map.of(
    "createdAt", SortField.CREATED_AT,
    "displayName", SortField.DISPLAY_NAME,
    "status", SortField.STATUS
);
```

## 28.3 Error

Unknown field:

```text
400 INVALID_SORT_FIELD
```

## 28.4 Security

Avoid exposing internal fields:

```text
passwordHash
deletedAt
internalScore
```

## 28.5 Rule

Sort fields must be allowlisted and documented.

---

# 29. Sort Direction dan Null Ordering

## 29.1 Direction

Allow:

```text
asc
desc
```

Reject:

```text
ascending
descending
random
```

unless documented.

## 29.2 Null ordering

Define:

```text
nulls last
```

or:

```text
nulls first
```

## 29.3 DB differences

Different databases sort nulls differently.

Do not let DB default become API contract accidentally.

## 29.4 Rule

Null ordering is part of sorting contract.

---

# 30. Multi-Column Sorting

## 30.1 Example

```http
sort=status:asc&sort=createdAt:desc
```

## 30.2 Server appends tie-breaker

```text
status ASC, created_at DESC, id DESC
```

## 30.3 Limit number

Max sort fields:

```text
3
```

## 30.4 Index

Multi-column sort should match indexes for hot queries.

## 30.5 Rule

Multi-sort support requires query planning, not just string parsing.

---

# 31. Sorting by Derived/Computed Fields

## 31.1 Examples

```text
sort=fullName
sort=priorityScore
sort=distance
sort=relevance
```

## 31.2 Risks

- expensive computation;
- no index;
- unstable values;
- unclear null ordering;
- ranking changes.

## 31.3 Use cases

Search relevance sort is legitimate.

## 31.4 Document

If derived sort is approximate or unstable, document.

## 31.5 Rule

Derived sorting must have explicit performance and stability model.

---

# 32. Filtering Contract

Filtering selects subset.

## 32.1 Simple

```http
status=open
```

## 32.2 Range

```http
createdFrom=2026-01-01&createdTo=2026-06-12
```

## 32.3 Multi-value

```http
status=open&status=pending
```

## 32.4 Operator

```http
createdAt[gte]=2026-01-01
```

## 32.5 Rule

Filtering syntax is mini-language; keep it small and clear.

---

# 33. Simple Field Filters

## 33.1 Example

```http
GET /cases?status=open&priority=high
```

## 33.2 Maps to equality

```text
status == open
priority == high
```

## 33.3 Good for enum fields

- status;
- type;
- category;
- priority.

## 33.4 Validate allowed values

```text
INVALID_FILTER_VALUE
```

## 33.5 Rule

Simple filters are best for common indexed fields.

---

# 34. Range Filters

## 34.1 Date range

```http
createdFrom=2026-01-01&createdTo=2026-06-12
```

## 34.2 Numeric range

```http
amountMin=100&amountMax=500
```

## 34.3 Validation

- from <= to;
- max range length;
- timezone policy;
- inclusive/exclusive semantics.

## 34.4 Naming

Use clear suffix:

```text
From/To
Min/Max
Start/End
```

## 34.5 Rule

Range filters must define inclusivity and timezone.

---

# 35. Repeated Query Parameters

## 35.1 Example

```http
status=open&status=pending
```

## 35.2 JAX-RS binding

```java
@QueryParam("status")
List<String> statuses;
```

## 35.3 Semantics

Usually OR:

```text
status IN (open, pending)
```

## 35.4 Duplicate single-value fields

If `page=1&page=2`, decide:

- reject duplicate;
- first wins;
- last wins.

Reject is safest.

## 35.5 Use `UriInfo`

To detect duplicates:

```java
MultivaluedMap<String, String> q = uriInfo.getQueryParameters();
if (q.get("page").size() > 1) reject;
```

## 35.6 Rule

Repeated query parameters need explicit semantics.

---

# 36. Filter Operators: eq, ne, gt, gte, lt, lte, in, contains

## 36.1 Operator examples

```http
filter[createdAt][gte]=2026-01-01
filter[status][in]=open,pending
filter[name][contains]=fajar
```

## 36.2 Pros

- expressive;
- consistent grammar.

## 36.3 Cons

- complex parsing;
- URL encoding;
- OpenAPI complexity;
- potential abuse;
- index planning harder.

## 36.4 Keep allowlist

Allowed operator depends on field.

```text
createdAt: gte,lte
status: eq,in
name: startsWith
```

## 36.5 Rule

Operators are not free; each needs validation, index strategy, and docs.

---

# 37. Filter Grammar Options

## 37.1 Flat parameters

```http
status=open&createdFrom=...
```

Best for simple APIs.

## 37.2 RSQL/FIQL-like string

```http
filter=status==open;createdAt>=2026-01-01
```

Powerful but complex.

## 37.3 JSON in query

```http
filter={"status":"open"}
```

Avoid. Encoding/caching/logging/debugging awkward.

## 37.4 POST search body

For highly complex search:

```http
POST /case-searches
```

or:

```http
POST /case-search-jobs
```

## 37.5 Recommendation

Start flat. Add grammar only if product truly needs it.

## 37.6 Rule

Do not create GraphQL-by-accident inside query string.

---

# 38. Unknown Filter Policy

## 38.1 Ignore unknown

Pros:

- forward-compatible.

Cons:

- hides client bugs;
- typos silently ignored;
- security ambiguity.

## 38.2 Reject unknown

Pros:

- strict contract;
- catches typos;
- safer.

Cons:

- less tolerant.

## 38.3 Recommendation

For query APIs, reject unknown filters/sorts by default.

## 38.4 Error

```json
{
  "code": "UNKNOWN_QUERY_PARAMETER",
  "parameter": "statsu"
}
```

## 38.5 Rule

Unknown query parameters should not silently change nothing unless documented.

---

# 39. Filtering and Authorization

Filtering must never replace authorization.

## 39.1 Bad

```http
GET /cases?tenantId=T1
```

then trust client-provided tenant.

## 39.2 Good

Server adds tenant/user constraints:

```sql
WHERE tenant_id = actor.tenant_id
```

regardless of client filters.

## 39.3 List endpoint

Must filter by accessible resources.

## 39.4 Search endpoint

Search index must enforce security filtering too.

## 39.5 Rule

Authorization constraints are mandatory server-side filters, not optional client filters.

---

# 40. Search Semantics

Search is different from filter.

## 40.1 Filter

Exact structured predicate:

```text
status=open
```

## 40.2 Search

Human text relevance:

```http
q=licence renewal appeal
```

## 40.3 Search may include

- tokenization;
- stemming;
- typo tolerance;
- ranking;
- synonyms;
- language;
- highlighting.

## 40.4 Document limitations

Client should know:

- which fields searched;
- min length;
- max length;
- language;
- ranking order;
- pagination behavior.

## 40.5 Rule

Search result semantics are product contract, not just SQL `LIKE`.

---

# 41. Search vs Filter

## 41.1 Use filter for exact fields

```http
status=open
type=renewal
```

## 41.2 Use search for free text

```http
q=real estate agent
```

## 41.3 Combine

```http
q=appeal&status=open&sort=relevance:desc
```

## 41.4 Default sort

For search, default sort is often relevance.

For list, default sort is often createdAt desc.

## 41.5 Rule

Do not overload `q` to mean arbitrary filter grammar.

---

# 42. Full-Text Search Query Contract

## 42.1 Parameters

```http
q=...
limit=20
cursor=...
sort=relevance:desc
```

## 42.2 Validate

- min length;
- max length;
- allowed characters if needed;
- language;
- fields;
- fuzziness.

## 42.3 Empty query

Define behavior:

- reject;
- return all;
- return recent;
- require at least one filter.

## 42.4 Highlighting

Optional:

```http
include=highlights
```

## 42.5 Rule

Search APIs need explicit behavior for empty/short/ambiguous queries.

---

# 43. Search Ranking vs Stable Pagination

Search ranking can change.

## 43.1 Problem

Page 1 generated with ranking version A.

Page 2 generated after index refresh/ranking change.

Results shift.

## 43.2 Solutions

- cursor with search snapshot;
- point-in-time search;
- search_after key;
- stable tie-breaker;
- accept live inconsistency and document.

## 43.3 Search sort

```text
_score desc, id asc
```

Tie-breaker still needed.

## 43.4 Rule

Search pagination needs stable ranking/snapshot strategy.

---

# 44. Index-Aware API Design

API must align with storage indexes.

## 44.1 Hot query examples

```http
GET /cases?status=open&assignedTo=me&sort=createdAt:desc
```

Needs index:

```text
tenant_id, assigned_to, status, created_at, id
```

## 44.2 Bad API

Allow arbitrary filter combinations.

No database can index all combinations efficiently.

## 44.3 Strategy

- support common access patterns;
- reject unsupported expensive combinations;
- async job for heavy report;
- search engine for text search;
- separate endpoints for different query models.

## 44.4 Rule

Design query contract with indexes in mind.

---

# 45. Database/Storage Implications

## 45.1 Relational DB

Good for structured filters/sorts.

Need composite indexes.

## 45.2 Elasticsearch/OpenSearch

Good for text search/ranking.

Need mapping/security filter.

## 45.3 ClickHouse/analytics store

Good for large analytical queries.

May not be transactional.

## 45.4 Cache

Good for common queries.

Need invalidation and tenant-aware keys.

## 45.5 Rule

Do not expose a query contract that your storage cannot support.

---

# 46. Query DTO with `@BeanParam`

## 46.1 DTO

```java
public class CustomerListQuery {

    @QueryParam("limit")
    @DefaultValue("20")
    @Min(1)
    @Max(100)
    private int limit;

    @QueryParam("cursor")
    private String cursor;

    @QueryParam("sort")
    private List<String> sort;

    @QueryParam("status")
    private List<String> status;

    public int limit() { return limit; }
    public String cursor() { return cursor; }
    public List<String> sort() { return sort == null ? List.of() : sort; }
    public List<String> status() { return status == null ? List.of() : status; }
}
```

Resource:

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public Response list(@BeanParam @Valid CustomerListQuery query) {
    CustomerQuerySpec spec = queryMapper.toSpec(query);
    Page<CustomerResponse> page = service.list(spec, currentActor());
    return responseFactory.page(page);
}
```

## 46.2 Benefits

- resource method stays clean;
- validation centralized;
- mapper converts to domain query spec;
- easier tests.

## 46.3 Caveat

`@BeanParam` may not catch unknown query params.

Use `UriInfo`.

## 46.4 Rule

Use query DTO for expected params; use UriInfo to enforce whole query grammar.

---

# 47. Manual Query Parsing with `UriInfo`

`UriInfo` exposes full query parameters.

## 47.1 Example

```java
@GET
public Response list(@Context UriInfo uriInfo) {
    MultivaluedMap<String, String> q = uriInfo.getQueryParameters();

    rejectUnknown(q.keySet(), Set.of("limit", "cursor", "sort", "status"));
    rejectDuplicates(q, Set.of("limit", "cursor"));

    CustomerQuerySpec spec = parser.parse(q);
    ...
}
```

## 47.2 Use when

- unknown param policy;
- duplicate detection;
- custom grammar;
- raw decoded/encoded handling;
- canonical link building.

## 47.3 Query parameters are multivalued

Do not lose values accidentally.

## 47.4 Rule

For strict query contract, parse with `UriInfo` or combine with `@BeanParam`.

---

# 48. ParamConverter for Sort/Filter/Cursor

## 48.1 Sort converter

```java
public record SortSpec(String field, Direction direction) {}
```

Converter parses:

```text
createdAt:desc
```

## 48.2 Cursor converter

```java
public record PageCursor(...) {}
```

Converter verifies token syntax/signature.

## 48.3 Filter converter

For simple value objects:

```java
CustomerStatus
DateRange
```

## 48.4 Caveat

Do not do DB lookup in converter.

## 48.5 Error

Throw `BadRequestException` or mapping-friendly exception.

## 48.6 Rule

Converters are good for syntax-to-value-object, not business resolution.

---

# 49. Validation for Query Contract

## 49.1 Basic validation

```java
@Min(1)
@Max(100)
int limit;
```

## 49.2 Cross-field validation

```text
from <= to
range <= 90 days
cursor not combined with page
```

## 49.3 Custom validation

```java
@ValidSort
List<String> sort;
```

## 49.4 Query grammar validation

May be easier in parser than annotations.

## 49.5 Rule

Validate query before service/storage execution.

---

# 50. Error Handling and Problem Details

## 50.1 Invalid query response

```json
{
  "type": "https://api.example.com/problems/invalid-query",
  "title": "Invalid query parameter",
  "status": 400,
  "code": "INVALID_QUERY_PARAMETER",
  "violations": [
    {
      "field": "limit",
      "code": "OUT_OF_RANGE",
      "message": "limit must be between 1 and 100"
    }
  ]
}
```

## 50.2 Error codes

```text
UNKNOWN_QUERY_PARAMETER
DUPLICATE_QUERY_PARAMETER
INVALID_SORT_FIELD
INVALID_SORT_DIRECTION
UNSUPPORTED_FILTER_OPERATOR
INVALID_CURSOR
EXPIRED_CURSOR
FILTER_CURSOR_MISMATCH
QUERY_TOO_COMPLEX
```

## 50.3 Status

Usually:

```text
400 Bad Request
```

for invalid query contract.

## 50.4 Rule

Query errors should be precise and actionable.

---

# 51. URI Building for Next/Prev Links

Use `UriInfo` and `UriBuilder`.

## 51.1 Example

```java
URI nextUri = uriInfo.getRequestUriBuilder()
    .replaceQueryParam("cursor", nextCursor)
    .replaceQueryParam("limit", limit)
    .build();

Link next = Link.fromUri(nextUri)
    .rel("next")
    .build();

return Response.ok(body)
    .links(next)
    .build();
```

## 51.2 Preserve filters/sorts

Next link must preserve:

- filters;
- sort;
- limit;
- search query;
- include/projection.

## 51.3 Remove obsolete params

If cursor pagination, remove `page`/`offset`.

## 51.4 Gateway awareness

If app behind proxy, generated absolute URI must respect external scheme/host.

## 51.5 Rule

Next/prev links should be generated server-side and canonical.

---

# 52. Caching Query Responses

## 52.1 GET cacheable

GET responses can be cacheable if headers allow.

## 52.2 Private data

User/tenant-specific lists should use:

```http
Cache-Control: private
```

or `no-store` if sensitive.

## 52.3 Public lists

Can be cached with:

```http
Cache-Control: public, max-age=60
```

if safe.

## 52.4 Vary

If response varies by auth, language, accept, set proper cache policy/headers.

## 52.5 Cursor

Cursors may include expiry/security context. Cache carefully.

## 52.6 Rule

Collection cacheability depends on authorization, freshness, and query params.

---

# 53. ETag and Conditional Requests for Collections

## 53.1 Collection ETag

Can represent:

- query result version;
- max updated_at;
- snapshot ID;
- search index version;
- hash of IDs.

## 53.2 Hard problem

Collections change often.

ETag can be expensive.

## 53.3 Use cases

- small reference data;
- stable catalogs;
- lookup lists.

## 53.4 Avoid for hot large search

May not be worth cost.

## 53.5 Rule

Use collection ETag only when versioning is cheap and meaningful.

---

# 54. Performance Patterns

## 54.1 Fetch limit + 1

To determine `hasNext`.

## 54.2 Avoid deep offset

Cap offset or switch to cursor.

## 54.3 Composite indexes

Align filters + sort + tenant.

## 54.4 Covering indexes

Include selected columns if DB supports.

## 54.5 Projection

Return only needed fields.

## 54.6 Async export

Heavy queries should be job-based.

## 54.7 Rate limit search

Search endpoints can be expensive.

## 54.8 Rule

Query API performance is designed, not patched after launch.

---

# 55. Security Considerations

## 55.1 Query injection

Never concatenate sort/filter into SQL directly.

## 55.2 Allowlist

Allow sort/filter fields and operators.

## 55.3 Tenant enforcement

Always server-side.

## 55.4 Cursor tampering

Sign/verify.

## 55.5 Sensitive query in logs

Search terms can contain PII.

## 55.6 URL length

Reject too-long query strings.

## 55.7 Denial of service

Limit complexity, result size, range, date span.

## 55.8 Rule

Query endpoints are attack surface.

---

# 56. Observability

## 56.1 Metrics

```text
api_query_requests_total{route,query_type}
api_query_invalid_total{code,route}
api_query_duration_seconds{route,query_shape}
api_query_result_size_bucket{route}
api_query_total_count_duration_seconds{route}
```

## 56.2 Query shape

Use low-cardinality labels:

```text
status_filter
date_range
search_text
cursor
offset
```

Not raw query values.

## 56.3 Logs

Log:

- route template;
- query shape;
- limit;
- sort fields;
- result count;
- duration;
- error code.

Do not log raw search text if PII risk.

## 56.4 Traces

Add DB query timing, index hints if available.

## 56.5 Rule

Observe query behavior without leaking query contents.

---

# 57. Testing Query Contracts

## 57.1 Pagination tests

- default limit;
- max limit;
- invalid limit;
- cursor next page;
- cursor tampering;
- cursor expiry;
- filter mismatch cursor;
- stable ordering duplicates.

## 57.2 Sort tests

- allowed field;
- disallowed field;
- invalid direction;
- multi-sort;
- null ordering;
- tie-breaker.

## 57.3 Filter tests

- equality;
- range;
- repeated values;
- unknown filter;
- duplicate single param;
- invalid enum/date.

## 57.4 Authorization tests

- tenant isolation;
- list only accessible resources;
- export applies same rules.

## 57.5 Performance tests

- large dataset;
- deep offset cap;
- hot query latency;
- count latency.

## 57.6 Rule

Test query API with data mutations and multi-tenant data.

---

# 58. OpenAPI Documentation

## 58.1 Document params

```yaml
parameters:
  - name: limit
    in: query
    schema:
      type: integer
      minimum: 1
      maximum: 100
      default: 20
```

## 58.2 Document sort fields

Use description or enum.

```text
Allowed sort fields: createdAt, displayName, status
Syntax: field:asc|desc
```

## 58.3 Document filters

For each filter:

- type;
- allowed values;
- repeated semantics;
- date timezone;
- operators.

## 58.4 Document pagination response

Schema includes:

- items;
- page metadata;
- links.

## 58.5 Rule

If clients cannot know valid query syntax from docs, contract is incomplete.

---

# 59. Evolution and Backward Compatibility

## 59.1 Adding filter

Usually backward-compatible.

## 59.2 Removing filter

Breaking.

## 59.3 Changing default sort

Can be breaking for clients.

## 59.4 Changing page size default

Can affect clients/performance.

## 59.5 Cursor format

Can evolve if opaque and versioned.

## 59.6 Deprecation

Return warnings/docs for deprecated params.

## 59.7 Rule

Query contract changes need API versioning/deprecation discipline.

---

# 60. Runtime Differences and Implementation Notes

## 60.1 JAX-RS param binding

Repeated query params and defaults are portable, but complex parsing behavior/errors can vary.

## 60.2 `@BeanParam` lifecycle

Works well for request-scoped parameter aggregation.

## 60.3 Validation integration

Constraint violation handling can vary by runtime; map errors consistently.

## 60.4 Uri generation

Proxy/gateway external URI handling can vary.

## 60.5 Rule

Test query handling in actual runtime and deployment topology.

---

# 61. Common Failure Modes

## 61.1 No stable sort

Duplicate/missing items between pages.

## 61.2 Deep offset kills DB

Slow queries and high CPU.

## 61.3 No max limit

Huge response.

## 61.4 Client sort maps to DB column directly

Injection/schema leak.

## 61.5 Unknown filters ignored

Client bugs hidden.

## 61.6 Total count on every request

Latency spike.

## 61.7 Cursor not signed

Tampering.

## 61.8 Cursor not bound to filter

Wrong continuation.

## 61.9 Tenant filter optional

Data leak.

## 61.10 Search ranking pagination unstable

Bad UX.

## 61.11 Raw search text logged

PII leak.

## 61.12 OpenAPI missing query docs

Client misuse.

---

# 62. Best Practices

## 62.1 Use envelope responses

Avoid top-level array for pageable results.

## 62.2 Prefer cursor/keyset for large data

Offset only for bounded/simple datasets.

## 62.3 Always define stable ordering

Append tie-breaker.

## 62.4 Limit page size

Default and max.

## 62.5 Allowlist sort/filter fields

Never expose raw DB.

## 62.6 Reject unknown params

Catch typos and abuse.

## 62.7 Bind cursor to filter/sort/tenant

Sign and version cursor.

## 62.8 Avoid exact total by default

Use hasNext.

## 62.9 Enforce authorization server-side

Tenant/data constraints always applied.

## 62.10 Test with realistic data

Including concurrent inserts/deletes.

---

# 63. Anti-Patterns

## 63.1 `GET /search` with huge JSON body

Poor interoperability.

## 63.2 `sort=` arbitrary SQL

Injection risk.

## 63.3 `filter=` as unbounded mini language

Accidental query engine.

## 63.4 No index-aware design

Production outage.

## 63.5 Exact total count everywhere

Slow.

## 63.6 Page number for infinite scroll feed

Duplicate/skip risk.

## 63.7 Cursor exposes raw DB internals

Client coupling/security leak.

## 63.8 Trusting client tenant filter

Cross-tenant vulnerability.

## 63.9 Search endpoint returns unauthorized data

Index security bug.

## 63.10 Query values in metric labels

High-cardinality explosion.

---

# 64. Production Checklist

## 64.1 Pagination

- [ ] Pagination style chosen per endpoint.
- [ ] Default limit defined.
- [ ] Max limit enforced.
- [ ] Stable sort defined.
- [ ] Tie-breaker included.
- [ ] Cursor signed if used.
- [ ] Cursor versioned.
- [ ] Cursor bound to filter/sort/tenant/user where needed.
- [ ] Total count policy defined.
- [ ] Concurrent mutation behavior tested.

## 64.2 Sorting

- [ ] Allowed sort fields documented.
- [ ] Direction syntax documented.
- [ ] Null ordering defined.
- [ ] Multi-sort limit defined.
- [ ] Sort fields mapped to internal query model.
- [ ] Indexes support hot sorts.

## 64.3 Filtering/search

- [ ] Allowed filters documented.
- [ ] Operators documented.
- [ ] Unknown params rejected.
- [ ] Duplicate single params handled.
- [ ] Range inclusivity/timezone defined.
- [ ] Search min/max length defined.
- [ ] Search ranking/pagination strategy defined.
- [ ] Query complexity limits enforced.

## 64.4 Security

- [ ] Tenant/data authorization mandatory.
- [ ] Raw DB fields not exposed.
- [ ] No raw SQL construction.
- [ ] Cursor tampering rejected.
- [ ] Sensitive query logging avoided.
- [ ] URL length/complexity limits enforced.

## 64.5 Observability/testing

- [ ] Query shape metrics.
- [ ] Invalid query metrics.
- [ ] Slow query tracing.
- [ ] Contract tests for params.
- [ ] Performance tests on realistic data.
- [ ] OpenAPI accurate.

---

# 65. Latihan

## Latihan 1 — Offset Pagination

Implement:

```http
GET /customers?page=1&size=20
```

Dengan:

- default size 20;
- max size 100;
- stable sort `createdAt desc, id desc`;
- envelope response.

Test invalid page/size.

## Latihan 2 — Cursor Pagination

Implement:

```http
GET /customers?limit=20&cursor=...
```

Cursor berisi:

- version;
- last key;
- filter hash;
- tenant ID;
- expiry;
- HMAC.

Test tampered/expired/mismatched cursor.

## Latihan 3 — Sort Parser

Support:

```http
sort=createdAt:desc&sort=displayName:asc
```

Reject:

- unknown field;
- invalid direction;
- too many sort fields.

## Latihan 4 — Filter Parser

Support:

```http
status=open&status=pending&createdFrom=2026-01-01&createdTo=2026-06-12
```

Validate date range and enum values.

## Latihan 5 — Unknown Param Policy

Reject:

```http
?statsu=open
```

with `UNKNOWN_QUERY_PARAMETER`.

## Latihan 6 — URI Link Builder

Generate `self` and `next` links with `UriInfo#getRequestUriBuilder()`.

Preserve filter/sort.

## Latihan 7 — Authorization in List

Create multi-tenant data.

Ensure user T1 never sees T2 in list/search/export.

## Latihan 8 — Search Endpoint

Implement:

```http
GET /cases?q=appeal&status=open&limit=20
```

Define:

- min query length;
- default sort;
- stable tie-breaker;
- no raw query logs.

## Latihan 9 — Performance Test

Seed 1 million rows.

Compare:

- offset page 5000;
- cursor/keyset page traversal.

Document query plan/index impact.

---

# 66. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 — `UriInfo` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/uriinfo

2. Jakarta EE Tutorial — Extracting Request Parameters with `@QueryParam` and `UriInfo`  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/websvcs/rest/rest.html

3. Jakarta RESTful Web Services 4.0 — `UriBuilder` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/uribuilder

4. Jakarta RESTful Web Services 4.0 — `Link` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/link

5. RFC 8288 — Web Linking  
   https://datatracker.ietf.org/doc/html/rfc8288

6. RFC 9110 — HTTP Semantics  
   https://datatracker.ietf.org/doc/html/rfc9110

7. RFC 3986 — Uniform Resource Identifier  
   https://www.rfc-editor.org/rfc/rfc3986

---

# 67. Penutup

Query contract adalah salah satu area REST API yang paling sering diremehkan.

Mental model final:

```text
Query params are not database query strings.
They are a public, versioned, validated, authorized, index-aware API language.
```

Pagination yang baik butuh:

```text
stable order
tie-breaker
limit cap
cursor/offset choice
consistency model
link generation
authorization
observability
```

Sorting yang baik butuh:

```text
allowed public fields
direction
null ordering
tie-breaker
index support
```

Filtering/search yang baik butuh:

```text
small grammar
field/operator allowlist
range semantics
unknown param policy
tenant/data authorization
query complexity limits
```

Prinsip final:

```text
Design query APIs from product behavior, data access pattern, and security boundary.
Do not expose storage details and hope the database survives.
```

Part berikutnya:

```text
Bagian 021 — PATCH, JSON Patch, JSON Merge Patch, and Partial Update Semantics
```

Kita akan membahas partial update secara mendalam: PUT vs PATCH, JSON Merge Patch, JSON Patch, null vs missing, validation, optimistic locking, idempotency, field authorization, audit, and domain state semantics.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 019 — CORS, CSRF, Cookies, Browser Security, and REST APIs: Preflight, Credentialed Requests, SameSite, Token Storage, XSS Interaction, Security Headers, dan JAX-RS Implementation](./learn-jaxrs-advanced-part-019.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Bagian 021 — PATCH, JSON Patch, JSON Merge Patch, and Partial Update Semantics: PUT vs PATCH, Null vs Missing, Field Authorization, Validation, Optimistic Locking, Idempotency, Audit, dan Domain State Semantics](./learn-jaxrs-advanced-part-021.md)
