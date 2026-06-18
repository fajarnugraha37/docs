# learn-jaxrs-advanced-part-033.md

# Bagian 033 — API Versioning Strategy: URI Versioning, Media Type Versioning, Header Versioning, Compatibility Rules, Deprecation, Sunset, Consumer Migration, and Enterprise API Governance

> Target pembaca: Java/Jakarta engineer yang ingin mendesain **strategi versioning REST API** secara production-grade. Fokus bagian ini bukan hanya “pakai `/v1` atau header”, tetapi memahami compatibility contract, breaking vs non-breaking change, versioning granularity, URI/media type/header/query versioning, consumer migration, deprecation/sunset, OpenAPI governance, contract testing, gateway routing, observability, dan pola implementasi di JAX-RS/Jakarta REST.
>
> Namespace utama: `jakarta.ws.rs.Path`, `jakarta.ws.rs.Produces`, `jakarta.ws.rs.Consumes`, `jakarta.ws.rs.HeaderParam`, `jakarta.ws.rs.core.MediaType`, `jakarta.ws.rs.core.Response`, `jakarta.ws.rs.core.HttpHeaders`, `jakarta.ws.rs.core.Variant`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Versioning adalah Consumer Compatibility Management](#2-mental-model-versioning-adalah-consumer-compatibility-management)
3. [Kenapa API Versioning Sulit](#3-kenapa-api-versioning-sulit)
4. [API Contract Surface](#4-api-contract-surface)
5. [Apa Itu Breaking Change?](#5-apa-itu-breaking-change)
6. [Non-Breaking / Backward-Compatible Change](#6-non-breaking--backward-compatible-change)
7. [Potentially Breaking Change](#7-potentially-breaking-change)
8. [Behavioral Breaking Change](#8-behavioral-breaking-change)
9. [Versioning Granularity: API, Resource, Operation, Representation](#9-versioning-granularity-api-resource-operation-representation)
10. [Major/Minor/Patch Mental Model](#10-majorminorpatch-mental-model)
11. [URI Path Versioning](#11-uri-path-versioning)
12. [Media Type Versioning](#12-media-type-versioning)
13. [Header Versioning](#13-header-versioning)
14. [Query Parameter Versioning](#14-query-parameter-versioning)
15. [Date-Based Versioning](#15-date-based-versioning)
16. [No Explicit Version / Evolvable Contract](#16-no-explicit-version--evolvable-contract)
17. [Decision Matrix](#17-decision-matrix)
18. [Recommended Enterprise Baseline](#18-recommended-enterprise-baseline)
19. [JAX-RS Implementation: URI Versioning](#19-jax-rs-implementation-uri-versioning)
20. [JAX-RS Implementation: Media Type Versioning](#20-jax-rs-implementation-media-type-versioning)
21. [JAX-RS Implementation: Header Versioning](#21-jax-rs-implementation-header-versioning)
22. [Routing Multiple Versions](#22-routing-multiple-versions)
23. [DTO Package Strategy](#23-dto-package-strategy)
24. [Mapper Strategy](#24-mapper-strategy)
25. [Service Layer Reuse Across Versions](#25-service-layer-reuse-across-versions)
26. [Versioned Error Contract](#26-versioned-error-contract)
27. [Versioned Pagination/Filtering Contract](#27-versioned-paginationfiltering-contract)
28. [Versioned Security/Auth Contract](#28-versioned-securityauth-contract)
29. [Versioned Event/Async Contract](#29-versioned-eventasync-contract)
30. [Versioned File Upload/Download Contract](#30-versioned-file-uploaddownload-contract)
31. [Deprecation vs Sunset vs Removal](#31-deprecation-vs-sunset-vs-removal)
32. [`Deprecation` Header](#32-deprecation-header)
33. [`Sunset` Header](#33-sunset-header)
34. [`Link` Header for Deprecation/Sunset Docs](#34-link-header-for-deprecationsunset-docs)
35. [Consumer Communication](#35-consumer-communication)
36. [Migration Window](#36-migration-window)
37. [Compatibility Tests](#37-compatibility-tests)
38. [Consumer-Driven Contract Testing](#38-consumer-driven-contract-testing)
39. [OpenAPI Strategy](#39-openapi-strategy)
40. [Schema Evolution Rules](#40-schema-evolution-rules)
41. [Enum Evolution](#41-enum-evolution)
42. [Date/Time and Number Evolution](#42-datetime-and-number-evolution)
43. [Null/Missing/Default Evolution](#43-nullmissingdefault-evolution)
44. [Field Rename Strategy](#44-field-rename-strategy)
45. [Resource Rename/Reorganization Strategy](#45-resource-renamereorganization-strategy)
46. [Database Migration vs API Versioning](#46-database-migration-vs-api-versioning)
47. [Gateway and Routing Strategy](#47-gateway-and-routing-strategy)
48. [Observability for Versioning](#48-observability-for-versioning)
49. [Metrics](#49-metrics)
50. [Logging](#50-logging)
51. [Testing Versioned APIs](#51-testing-versioned-apis)
52. [Runtime Differences and Implementation Notes](#52-runtime-differences-and-implementation-notes)
53. [Common Failure Modes](#53-common-failure-modes)
54. [Best Practices](#54-best-practices)
55. [Anti-Patterns](#55-anti-patterns)
56. [Production Checklist](#56-production-checklist)
57. [Latihan](#57-latihan)
58. [Referensi Resmi](#58-referensi-resmi)
59. [Penutup](#59-penutup)

---

# 1. Tujuan Part Ini

Versioning sering dipersempit menjadi pertanyaan:

```text
Mending /v1/customers atau Accept: application/vnd.company.customer.v1+json?
```

Padahal masalah sebenarnya jauh lebih besar.

API versioning adalah tentang:

```text
Bagaimana server berubah tanpa merusak consumer yang sudah berjalan di production.
```

REST API tidak hidup sendiri. Ia dipakai oleh:

- frontend web;
- mobile app;
- backend service lain;
- batch job;
- partner integration;
- API gateway;
- SDK/generated client;
- reporting tools;
- test automation;
- external consumers.

Jika API berubah sembarangan:

- client compile tapi runtime gagal;
- field hilang;
- enum baru membuat deserializer error;
- status code berubah;
- pagination cursor berubah;
- error code berubah;
- security scope berubah;
- webhook/event berubah;
- SLA/migration window tidak jelas;
- old client mati mendadak.

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- membedakan breaking dan non-breaking changes;
- memilih strategy URI/media type/header/query/date versioning;
- mendesain versioned DTO/package/mapping;
- membuat deprecation dan sunset policy;
- memakai `Deprecation`, `Sunset`, dan `Link` header;
- mengelola OpenAPI per versi;
- membuat contract tests;
- mengukur usage versi lama;
- merencanakan consumer migration;
- menghindari version explosion.

## 1.2 Prinsip utama

```text
Versioning is consumer compatibility management.
A version is a promise, not a folder name.
```

---

# 2. Mental Model: Versioning adalah Consumer Compatibility Management

API adalah kontrak runtime.

Kontrak itu terdiri dari:

```text
URI shape
HTTP methods
request headers
request body
response status
response headers
response body
error body
media type
auth/scopes
pagination/filtering behavior
side effects
idempotency
rate limits
semantics
```

Versioning adalah cara mengelola perubahan kontrak.

## 2.1 Versioning bukan solusi desain buruk

Jika API berubah setiap minggu dengan breaking change, menambah `/v2`, `/v3`, `/v4` tidak menyelesaikan masalah. Itu hanya membuat banyak versi buruk.

## 2.2 Versioning harus jarang

Idealnya banyak perubahan bisa backward-compatible.

Versi mayor baru dibuat ketika perubahan benar-benar memutus consumer.

## 2.3 Top-tier rule

```text
Do not version because you changed code.
Version because you changed a consumer-visible contract incompatibly.
```

---

# 3. Kenapa API Versioning Sulit

## 3.1 Consumer tidak upgrade serentak

Mobile app bisa tertinggal lama.

Partner bisa punya release cycle bulanan.

Internal service bisa punya dependency chain.

## 3.2 Breaking change tidak selalu terlihat

Mengubah enum, default sort, error code, atau nullability bisa merusak client.

## 3.3 Banyak surface

Versioning bukan hanya response JSON.

Juga:

- headers;
- cache behavior;
- rate limit;
- auth scopes;
- SSE events;
- async operation status;
- file media types;
- Problem Details.

## 3.4 Operational cost

Menjalankan dua versi berarti:

- dua route;
- dua docs;
- dua tests;
- dua monitoring;
- dua bugfix paths;
- dua support windows.

## 3.5 Rule

Versioning strategy harus mempertimbangkan engineering cost dan consumer migration cost.

---

# 4. API Contract Surface

Contract surface meliputi:

## 4.1 Protocol

- HTTP method;
- URI;
- status code;
- headers;
- media type;
- caching;
- conditional requests.

## 4.2 Request

- path params;
- query params;
- headers;
- cookies;
- request body schema;
- validation rules;
- default values.

## 4.3 Response

- status;
- headers;
- body schema;
- field semantics;
- nullability;
- enum values;
- sort order;
- pagination;
- links.

## 4.4 Error

- status;
- Problem Details schema;
- error code;
- retryability;
- correlation ID;
- field error shape.

## 4.5 Behavior

- side effects;
- idempotency;
- authorization;
- rate limits;
- consistency;
- timeout/polling semantics.

## 4.6 Rule

Breaking change can happen anywhere in contract surface.

---

# 5. Apa Itu Breaking Change?

Breaking change adalah perubahan yang bisa membuat consumer existing gagal atau berperilaku salah tanpa perubahan dari consumer.

## 5.1 Obvious breaking

- remove endpoint;
- rename URI;
- remove field;
- rename field;
- change field type;
- change required request field;
- remove enum value;
- change media type;
- change auth requirement.

## 5.2 Less obvious breaking

- adding enum value if client exhaustively switches;
- changing default sort;
- changing pagination cursor shape if client persists it;
- changing error code;
- making nullable field non-null? Usually safe, but can be breaking for expectation.
- making non-null field nullable;
- changing date format;
- changing numeric precision;
- changing 200 to 204;
- changing 404 to 403;
- changing cache behavior;
- changing idempotency semantics.

## 5.3 Rule

Breaking is judged from consumer behavior, not server developer intention.

---

# 6. Non-Breaking / Backward-Compatible Change

Usually safe:

- add optional response field;
- add new endpoint;
- add optional query parameter;
- add new link relation;
- add new Problem Details extension field;
- add support for new media type while keeping old;
- improve performance without semantic change;
- add new error type only for new behavior;
- widen accepted request values carefully.

## 6.1 Caveat

Even adding response field can break badly written clients that reject unknown fields.

But well-designed clients should ignore unknown fields.

## 6.2 Compatibility rule

Your API guidelines should require clients to:

```text
ignore unknown response fields
ignore unknown links
handle unknown enum defensively
not depend on field ordering
not parse undocumented error messages
```

## 6.3 Rule

Backward compatibility requires both server discipline and client tolerance.

---

# 7. Potentially Breaking Change

Some changes are situational.

## 7.1 Adding enum value

If clients are robust, non-breaking.

If generated client maps enum strictly, breaking.

## 7.2 Adding validation

Rejecting requests previously accepted can break consumers.

## 7.3 Changing default pagination limit

Can break UI/performance expectations.

## 7.4 Adding rate limit

Can break high-volume consumers.

## 7.5 Rule

Potentially breaking changes require consumer impact analysis.

---

# 8. Behavioral Breaking Change

Behavioral changes are dangerous because schema diff may not catch them.

Examples:

- same endpoint now excludes inactive records;
- search ranking changes;
- “approved” status meaning changes;
- update endpoint now triggers email;
- delete changes from soft delete to hard delete;
- idempotency key TTL changes;
- async job expires sooner.

## 8.1 Detection

Need:

- behavior tests;
- contract examples;
- consumer feedback;
- release notes.

## 8.2 Rule

Versioning is not only schema management; it is behavior management.

---

# 9. Versioning Granularity: API, Resource, Operation, Representation

## 9.1 Whole API version

```text
/api/v1/...
/api/v2/...
```

Simple, but can force large migration.

## 9.2 Resource version

```text
/v1/customers
/v2/customers
/v1/orders
```

Can reduce blast radius.

## 9.3 Operation version

Specific endpoint versioned separately.

Can become messy.

## 9.4 Representation version

Same resource, different media type/schema.

```http
Accept: application/vnd.example.customer.v2+json
```

## 9.5 Rule

Choose granularity based on how consumers adopt change.

---

# 10. Major/Minor/Patch Mental Model

Do not blindly copy SemVer to HTTP APIs, but use the mental model.

## 10.1 Major

Breaking contract change.

Example:

```text
v1 → v2
```

## 10.2 Minor

Backward-compatible feature addition.

Could be documented as API release but same major version.

## 10.3 Patch

Bugfix without intended contract change.

## 10.4 Rule

Expose major version to consumers; track minor/patch in docs/release notes.

---

# 11. URI Path Versioning

Example:

```http
GET /api/v1/customers/C001
GET /api/v2/customers/C001
```

## 11.1 Pros

- obvious;
- easy routing/gateway;
- easy docs;
- easy browser/testing;
- easy metrics;
- simple for consumers.

## 11.2 Cons

- version in resource URI;
- duplicates endpoints;
- can encourage whole-API versioning;
- less aligned with pure “same resource different representation” philosophy.

## 11.3 Good for

- public/partner APIs;
- gateway-managed APIs;
- enterprise APIs needing clarity;
- large breaking changes.

## 11.4 Rule

URI versioning is pragmatic and operationally simple.

---

# 12. Media Type Versioning

Example:

```http
Accept: application/vnd.example.customer.v2+json
Content-Type: application/vnd.example.customer.create.v2+json
```

## 12.1 Pros

- versions representation, not resource URI;
- works with HTTP content negotiation;
- can support multiple representations at same URI;
- elegant for schema evolution.

## 12.2 Cons

- less visible;
- more complex client/gateway config;
- docs/testing harder for casual consumers;
- content negotiation complexity;
- can be overkill for many enterprise APIs.

## 12.3 JAX-RS support

Use `@Produces` and `@Consumes` with custom media types.

## 12.4 Rule

Media type versioning is powerful when representation negotiation is first-class in your API.

---

# 13. Header Versioning

Example:

```http
GET /customers/C001
API-Version: 2
```

or:

```http
X-API-Version: 2
```

## 13.1 Pros

- URI clean;
- easy to switch version per request;
- gateway can route on header;
- can version whole API or endpoint.

## 13.2 Cons

- hidden in headers;
- cache `Vary` complexity;
- browser/manual testing less obvious;
- custom header convention;
- docs must be strict.

## 13.3 Required

If response varies by header, set:

```http
Vary: API-Version
```

where cacheable.

## 13.4 Rule

Header versioning works if your clients and gateway consistently handle headers.

---

# 14. Query Parameter Versioning

Example:

```http
GET /customers/C001?api-version=2
```

## 14.1 Pros

- visible;
- easy browser/testing;
- gateway can route;
- useful for management/control-plane APIs.

## 14.2 Cons

- version as query not resource identity;
- can pollute links/cache;
- easy to forget in pagination links;
- some consider less clean.

## 14.3 Good for

- Azure-style management APIs;
- explicit date versions;
- administrative APIs.

## 14.4 Rule

If using query versioning, URI builders must preserve version parameter in all links.

---

# 15. Date-Based Versioning

Example:

```http
api-version=2026-06-12
```

or:

```http
API-Version: 2026-06-12
```

## 15.1 Pros

- precise release snapshot;
- clear compatibility contract;
- no arbitrary v1/v2 debates;
- useful for cloud APIs.

## 15.2 Cons

- many versions;
- harder mental model for consumers;
- governance required;
- docs per date version.

## 15.3 Rule

Date-based versioning requires mature release/version lifecycle management.

---

# 16. No Explicit Version / Evolvable Contract

Some APIs avoid explicit versioning and rely on backward-compatible evolution.

## 16.1 Works when

- internal consumers;
- strict compatibility rules;
- strong contract testing;
- good client tolerance;
- rapid coordinated deploys.

## 16.2 Risk

Eventually breaking change needs path.

## 16.3 Rule

No explicit versioning is a valid strategy only with strong compatibility governance.

---

# 17. Decision Matrix

| Strategy | Visibility | Gateway Simplicity | HTTP Purity | Consumer Ease | Best For |
|---|---:|---:|---:|---:|---|
| URI path `/v1` | High | High | Medium | High | Public/enterprise APIs |
| Media type | Medium | Medium | High | Medium | Representation evolution |
| Header | Low-Medium | Medium | Medium | Medium | Controlled clients |
| Query param | High | High | Low-Medium | High | Management APIs |
| Date-based | Medium | Medium | Medium | Medium | Cloud/provider APIs |
| No explicit | High simplicity | High | Medium | High until break | Internal compatible APIs |

## 17.1 Rule

Pick the strategy your consumers can reliably use and your platform can reliably operate.

---

# 18. Recommended Enterprise Baseline

For many enterprise APIs:

```text
Use URI major versioning for breaking changes:
  /api/v1/...
  /api/v2/...

Maintain backward-compatible evolution within same major version.

Use Deprecation/Sunset headers and docs for old versions.

Use OpenAPI per major version.

Use contract tests for compatibility.
```

## 18.1 Why

- easy for frontend/backend teams;
- easy gateway routing;
- easy logs/metrics;
- easy documentation;
- easy phased migration.

## 18.2 When to add media type versioning

If you need representation variants for same resource while URI remains stable.

## 18.3 Rule

Prefer boring versioning unless your API ecosystem needs more sophistication.

---

# 19. JAX-RS Implementation: URI Versioning

## 19.1 Separate resource classes

```java
@Path("/v1/customers")
public class CustomerResourceV1 { ... }

@Path("/v2/customers")
public class CustomerResourceV2 { ... }
```

## 19.2 Shared service

```java
@Inject
CustomerApplicationService service;
```

## 19.3 Separate DTOs

```java
com.example.api.v1.CustomerResponseV1
com.example.api.v2.CustomerResponseV2
```

## 19.4 Pros

Clear separation.

## 19.5 Cons

Duplication.

## 19.6 Rule

Separate HTTP contract by version, share application/domain layer where semantics compatible.

---

# 20. JAX-RS Implementation: Media Type Versioning

## 20.1 Media constants

```java
public final class ApiMediaTypes {
    public static final String CUSTOMER_V1_JSON =
        "application/vnd.example.customer.v1+json";
    public static final String CUSTOMER_V2_JSON =
        "application/vnd.example.customer.v2+json";
}
```

## 20.2 Resource methods

```java
@GET
@Path("/customers/{id}")
@Produces(ApiMediaTypes.CUSTOMER_V1_JSON)
public CustomerV1 getV1(@PathParam("id") String id) { ... }

@GET
@Path("/customers/{id}")
@Produces(ApiMediaTypes.CUSTOMER_V2_JSON)
public CustomerV2 getV2(@PathParam("id") String id) { ... }
```

## 20.3 Client

```http
Accept: application/vnd.example.customer.v2+json
```

## 20.4 Vary

```http
Vary: Accept
```

## 20.5 Rule

Media type versioning requires disciplined content negotiation and docs.

---

# 21. JAX-RS Implementation: Header Versioning

## 21.1 Single resource method dispatch

```java
@GET
@Path("/customers/{id}")
public Response get(
    @PathParam("id") String id,
    @HeaderParam("API-Version") String version
) {
    return switch (versionOrDefault(version)) {
        case "1" -> Response.ok(service.getV1(id)).build();
        case "2" -> Response.ok(service.getV2(id)).build();
        default -> throw new UnsupportedApiVersionException(version);
    };
}
```

## 21.2 Alternative

Use filter or gateway to route to versioned sub-applications.

## 21.3 Vary

```http
Vary: API-Version
```

## 21.4 Rule

Header versioning should be centralized, not switch statements everywhere.

---

# 22. Routing Multiple Versions

## 22.1 In app

Multiple resource classes/packages.

## 22.2 In gateway

Route `/v1` to v1 deployment, `/v2` to v2 deployment.

## 22.3 Hybrid

Same service deployment supports multiple versions, gateway routes by prefix.

## 22.4 Independent deployments

High isolation but higher operational cost.

## 22.5 Rule

Routing strategy should match support window and team ownership.

---

# 23. DTO Package Strategy

## 23.1 Versioned API DTOs

```text
api.v1.customer.CustomerResponse
api.v2.customer.CustomerResponse
```

## 23.2 Shared internal DTO?

Avoid sharing if it becomes accidental contract coupling.

## 23.3 Mapper

```java
CustomerV1Dto toV1(CustomerView view)
CustomerV2Dto toV2(CustomerView view)
```

## 23.4 Rule

Version DTOs at API boundary.

---

# 24. Mapper Strategy

## 24.1 Internal view

```java
CustomerView view = service.getCustomer(id);
```

## 24.2 Map to v1

```java
CustomerResponseV1 v1 = v1Mapper.toResponse(view);
```

## 24.3 Map to v2

```java
CustomerResponseV2 v2 = v2Mapper.toResponse(view);
```

## 24.4 Benefit

Business logic shared; representation differs.

## 24.5 Rule

Separate domain/service model from versioned representation model.

---

# 25. Service Layer Reuse Across Versions

## 25.1 Reuse if semantics same

Both v1 and v2 can call same application service.

## 25.2 Separate service if semantics changed

If v2 changes behavior, create version-specific use case or strategy.

## 25.3 Avoid branching inside service by version everywhere

Bad:

```java
if (version == V1) ...
else if (version == V2) ...
```

unless small and isolated.

## 25.4 Rule

Version branching belongs near boundary unless business semantics truly differ.

---

# 26. Versioned Error Contract

Error contract can break too.

## 26.1 V1

```json
{
  "error": "NOT_FOUND"
}
```

## 26.2 V2

```json
{
  "type": "...",
  "title": "Not found",
  "status": 404,
  "code": "RESOURCE_NOT_FOUND"
}
```

## 26.3 Transition

Support both for respective versions.

## 26.4 Rule

Problem Details shape and error codes are part of API version.

---

# 27. Versioned Pagination/Filtering Contract

Pagination changes can break clients.

## 27.1 V1

```http
?page=1&size=20
```

## 27.2 V2

```http
?cursor=...&limit=20
```

## 27.3 Not backward-compatible

Do not silently change within same version.

## 27.4 Rule

Query contract is versioned API contract.

---

# 28. Versioned Security/Auth Contract

Auth changes are breaking if consumers must change tokens/scopes.

## 28.1 Examples

- new required OAuth scope;
- changed audience claim;
- switched cookie to bearer;
- changed role semantics;
- stricter tenant check.

## 28.2 Security fixes

Sometimes must break quickly.

Document emergency policy.

## 28.3 Rule

Security contract changes need migration plan unless emergency.

---

# 29. Versioned Event/Async Contract

Async APIs and event streams have contracts too.

## 29.1 Operation status schema

Changing status enum can break clients.

## 29.2 SSE event type

Changing event name/schema can break clients.

## 29.3 Webhook/event payload

Version events separately.

## 29.4 Rule

Version async/event payloads like REST response DTOs.

---

# 30. Versioned File Upload/Download Contract

Upload/download contracts include:

- multipart part names;
- max size;
- allowed media types;
- response status;
- scanning lifecycle;
- download headers;
- range support.

Changing these can break consumers.

## 30.1 Rule

Binary/file contracts are still API contracts.

---

# 31. Deprecation vs Sunset vs Removal

## 31.1 Deprecation

API still works but should no longer be used.

## 31.2 Sunset

API/resource is expected to become unavailable at a future date.

## 31.3 Removal

API no longer works.

## 31.4 Rule

Deprecation is communication; sunset is timeline; removal is enforcement.

---

# 32. `Deprecation` Header

The `Deprecation` response header communicates that a resource is or will be deprecated.

Example:

```http
Deprecation: @1719792000
```

or depending supported syntax/date representation per RFC.

## 32.1 Use with docs

Do not just send header.

Also include link to migration docs.

## 32.2 Scope

Header applies to resource in response context.

## 32.3 Rule

Runtime deprecation signals help consumers detect usage automatically.

---

# 33. `Sunset` Header

The `Sunset` header indicates a URI is likely to become unresponsive at specified future time.

Example:

```http
Sunset: Tue, 31 Dec 2026 23:59:59 GMT
```

## 33.1 Use for planned retirement

Send on deprecated version responses.

## 33.2 Combine with Link

Provide policy/migration docs.

## 33.3 Rule

Sunset should be realistic and backed by support policy.

---

# 34. `Link` Header for Deprecation/Sunset Docs

## 34.1 Deprecation link

```http
Link: <https://developer.example.com/deprecations/customer-v1>; rel="deprecation"
```

## 34.2 Sunset link

```http
Link: <https://developer.example.com/sunsets/customer-v1>; rel="sunset"
```

## 34.3 Migration link

Custom or documented relation.

```http
Link: <https://developer.example.com/migrate/customer-v1-to-v2>; rel="alternate"
```

## 34.4 Rule

Headers should lead to actionable migration docs.

---

# 35. Consumer Communication

## 35.1 Channels

- release notes;
- email/Slack;
- developer portal;
- OpenAPI diff;
- runtime headers;
- dashboard;
- SDK warnings;
- support tickets.

## 35.2 Content

- what changes;
- why;
- who is affected;
- migration steps;
- deadline;
- test environment;
- rollback/exception policy.

## 35.3 Rule

Version migration is product/program management, not only code.

---

# 36. Migration Window

## 36.1 Public APIs

Often need long support window.

Microsoft Graph, for example, declares deprecated versions/APIs at least 24 months before retirement for GA APIs.

## 36.2 Internal APIs

Can be shorter if teams coordinate.

## 36.3 Critical clients

May need exception/extended support.

## 36.4 Rule

Set explicit support windows before versioning starts.

---

# 37. Compatibility Tests

Compatibility tests ensure old consumers still work.

## 37.1 Snapshot examples

Store request/response examples for v1.

Test v1 still produces compatible shape after code changes.

## 37.2 Schema diff

Detect breaking OpenAPI changes.

## 37.3 Behavior tests

Validate semantics, not only JSON schema.

## 37.4 Rule

Compatibility must be tested, not hoped.

---

# 38. Consumer-Driven Contract Testing

Consumers define expectations.

## 38.1 Useful when

- many internal services;
- provider team and consumer team separate;
- breaking changes costly.

## 38.2 Tests include

- request;
- response;
- headers;
- status;
- error bodies.

## 38.3 Rule

Consumer contracts reduce accidental breaks.

---

# 39. OpenAPI Strategy

## 39.1 Separate specs

```text
openapi-v1.yaml
openapi-v2.yaml
```

## 39.2 Version metadata

```yaml
info:
  version: "1.0.0"
```

## 39.3 Deprecation

OpenAPI supports marking operations/parameters/schema properties as deprecated.

## 39.4 Diff tooling

Use OpenAPI diff in CI.

## 39.5 Rule

OpenAPI is versioned artifact, not generated afterthought.

---

# 40. Schema Evolution Rules

## 40.1 Response fields

Safe:

- add optional field.

Breaking:

- remove field;
- rename field;
- change type;
- change meaning;
- make required field absent.

## 40.2 Request fields

Safe:

- add optional request field.

Breaking:

- add required field;
- remove accepted field;
- make validation stricter.

## 40.3 Rule

Document schema evolution rules and enforce in CI.

---

# 41. Enum Evolution

Enums are tricky.

## 41.1 Adding enum value

Can break clients with exhaustive switch or generated enum.

## 41.2 Safer design

Clients should handle unknown enum.

Server can document:

```text
Consumers must treat unknown status as UNKNOWN and not fail deserialization.
```

## 41.3 Alternative

Use string with documented values and unknown handling.

## 41.4 Rule

Enum additions are only safe if clients are designed for unknowns.

---

# 42. Date/Time and Number Evolution

## 42.1 Date/time

Changing format is breaking.

Example:

```text
"2026-06-12T10:00:00Z"
```

to:

```text
"12/06/2026"
```

breaking.

## 42.2 Precision

Changing seconds to nanoseconds may break parsers.

## 42.3 Numbers

Changing integer to string or number precision can break.

## 42.4 Rule

Date/time/number formats are contract.

---

# 43. Null/Missing/Default Evolution

## 43.1 Missing field

Field absent.

## 43.2 Null field

Field present with null.

## 43.3 Default

Server assumes value if absent.

## 43.4 Breaking changes

- non-null becomes nullable;
- field removed;
- absent vs null semantics change.

## 43.5 Rule

Define null/missing semantics early.

---

# 44. Field Rename Strategy

Renaming field is breaking.

## 44.1 Compatible migration

Add new field while keeping old.

```json
{
  "displayName": "Fajar",
  "name": "Fajar"
}
```

Mark old deprecated.

After support window, remove in next major version.

## 44.2 Rule

Rename is add-new + deprecate-old, not immediate replace.

---

# 45. Resource Rename/Reorganization Strategy

Moving:

```text
/customers/{id}/orders
```

to:

```text
/orders?customerId={id}
```

can break clients.

## 45.1 Compatible options

- keep old endpoint;
- redirect carefully if method safe;
- add link relation;
- document new canonical;
- deprecate old.

## 45.2 Rule

URI changes are breaking unless old URI remains supported.

---

# 46. Database Migration vs API Versioning

Database migration is internal.

API versioning is external.

## 46.1 DB change not necessarily API change

You can refactor tables without changing API.

## 46.2 API change not necessarily DB change

You can add response field derived from same table.

## 46.3 Rule

Do not version API because database migration happened. Version if consumer contract changed.

---

# 47. Gateway and Routing Strategy

## 47.1 Gateway responsibilities

- route `/v1` and `/v2`;
- apply auth policies;
- rate limit per version;
- collect usage;
- deprecation headers maybe;
- block removed version.

## 47.2 App responsibilities

- implement contract;
- map errors;
- support docs;
- tests.

## 47.3 Rule

API gateway can help version routing but cannot define compatibility alone.

---

# 48. Observability for Versioning

You need know who still uses old version.

## 48.1 Track

- version;
- operation;
- consumer/app/client ID;
- status;
- deprecation header emitted;
- sunset date;
- error rate.

## 48.2 Migration dashboard

Show v1 usage over time.

## 48.3 Rule

Never sunset a version blindly without usage visibility.

---

# 49. Metrics

Suggested metrics:

```text
api_requests_total{version,operation,consumer,status}
api_deprecated_requests_total{version,operation,consumer}
api_version_error_rate{version,operation}
api_version_latency_seconds{version,operation}
api_sunset_requests_total{version,operation}
api_unknown_version_requests_total
```

## 49.1 Avoid high cardinality

Consumer ID can be high cardinality. Use controlled client ID registry or aggregate.

## 49.2 Rule

Version usage metrics are migration tools.

---

# 50. Logging

## 50.1 Log version

Include:

- API version;
- operation;
- consumer/client ID;
- correlation ID;
- deprecation flag.

## 50.2 Do not log full body

Version migration debugging still needs safe logs.

## 50.3 Rule

Logs should identify consumers using deprecated versions.

---

# 51. Testing Versioned APIs

## 51.1 Per-version tests

Each version needs tests.

## 51.2 Cross-version tests

Same domain state can produce v1 and v2 response shapes.

## 51.3 Backward compatibility tests

Ensure v1 continues to work.

## 51.4 Unsupported version tests

```http
400 / 404 / 406
```

depending strategy.

## 51.5 Rule

Versioned API doubles contract test responsibility.

---

# 52. Runtime Differences and Implementation Notes

## 52.1 JAX-RS matching

URI versioning uses normal `@Path`.

Media type versioning uses `@Produces`/`@Consumes` matching and Accept negotiation.

Header versioning often needs manual dispatch/filter/gateway.

## 52.2 Gateway

Some gateways route by path/header/query easily; media type routing may require config.

## 52.3 Caching

If version varies by header/media type, use correct `Vary`.

## 52.4 Rule

Version strategy must fit runtime and infrastructure.

---

# 53. Common Failure Modes

## 53.1 Version everything too often

Version explosion.

## 53.2 No compatibility rules

Every change risky.

## 53.3 No usage metrics

Cannot sunset.

## 53.4 Old version code untested

Buggy legacy.

## 53.5 Shared DTO accidentally changes v1

Breaks old clients.

## 53.6 Header versioning without Vary

Cache serves wrong version.

## 53.7 Deprecation announced only in docs

Runtime consumers unaware.

## 53.8 Breaking enum addition

Generated clients fail.

## 53.9 Error contract changed silently

Client error handling breaks.

## 53.10 Gateway routes old version to new implementation accidentally

Unexpected break.

---

# 54. Best Practices

## 54.1 Define compatibility rules

Before first public release.

## 54.2 Version only breaking changes

Do not version every feature.

## 54.3 Prefer backward-compatible evolution

Add optional fields/endpoints.

## 54.4 Use URI major versioning for enterprise baseline

Simple and operable.

## 54.5 Separate DTO packages per major version

Avoid accidental breaks.

## 54.6 Track usage per version

Before deprecation/sunset.

## 54.7 Use Deprecation/Sunset headers

Make runtime signal machine-readable.

## 54.8 Maintain OpenAPI per version

And diff in CI.

## 54.9 Keep old version tests alive

Until removal.

## 54.10 Communicate migration clearly

Docs, examples, timelines.

---

# 55. Anti-Patterns

## 55.1 `/v2` for every field addition

Unnecessary.

## 55.2 No version but breaking changes

Consumer pain.

## 55.3 One DTO shared by v1 and v2

Accidental break.

## 55.4 Deprecate without migration docs

Unhelpful.

## 55.5 Sunset without usage data

Risky.

## 55.6 Header versioning hidden from caches

Wrong cached response.

## 55.7 Removing old API before clients migrate

Incident.

## 55.8 Treating OpenAPI as docs only

Should be contract artifact.

## 55.9 Behavioral changes without version/release note

Silent break.

## 55.10 Supporting every version forever

Maintenance collapse.

---

# 56. Production Checklist

## 56.1 Strategy

- [ ] Versioning strategy documented.
- [ ] Breaking change definition documented.
- [ ] Backward-compatible change rules documented.
- [ ] Version granularity defined.
- [ ] Default enterprise strategy chosen.
- [ ] Unsupported version response defined.

## 56.2 Implementation

- [ ] DTO packages versioned.
- [ ] Mappers versioned.
- [ ] Service reuse/version-specific semantics clear.
- [ ] Error contract versioned.
- [ ] Pagination/filtering contract versioned.
- [ ] Auth/scope changes reviewed.
- [ ] `Vary` set for header/media versioning.

## 56.3 Governance

- [ ] OpenAPI per version.
- [ ] OpenAPI diff in CI.
- [ ] Consumer contract tests.
- [ ] Deprecation policy.
- [ ] Sunset/removal policy.
- [ ] Migration docs.
- [ ] Support window defined.

## 56.4 Operations

- [ ] Metrics by version.
- [ ] Deprecated version dashboard.
- [ ] Consumer usage tracked.
- [ ] Deprecation header emitted.
- [ ] Sunset header emitted when applicable.
- [ ] Gateway routing tests.
- [ ] Old version still tested until removed.

---

# 57. Latihan

## Latihan 1 — Breaking Change Classifier

Ambil 20 perubahan API.

Klasifikasikan:

```text
breaking
non-breaking
potentially breaking
behavioral breaking
```

## Latihan 2 — URI Versioning

Implement:

```text
/v1/customers/{id}
/v2/customers/{id}
```

V1 response:

```json
{ "id": "C001", "name": "Fajar" }
```

V2 response:

```json
{ "id": "C001", "displayName": "Fajar", "status": "ACTIVE" }
```

Service layer sama, DTO mapper beda.

## Latihan 3 — Media Type Versioning

Implement:

```http
Accept: application/vnd.example.customer.v1+json
Accept: application/vnd.example.customer.v2+json
```

Dengan `@Produces`.

Test `406` jika unsupported.

## Latihan 4 — Header Versioning

Implement header:

```http
API-Version: 2
```

Pastikan response menambahkan:

```http
Vary: API-Version
```

## Latihan 5 — Deprecation/Sunset Headers

Untuk v1, tambahkan:

```http
Deprecation
Sunset
Link: rel="deprecation"
```

Test headers muncul.

## Latihan 6 — OpenAPI Diff

Buat OpenAPI v1 dan v2.

Jalankan diff dan tandai breaking change.

## Latihan 7 — Enum Unknown Handling

Tambahkan enum status baru.

Pastikan client test punya fallback `UNKNOWN`.

## Latihan 8 — Consumer Usage Dashboard

Tambahkan metric/log label version dan consumer ID.

Buat dashboard v1 usage over time.

## Latihan 9 — Field Rename Migration

Tambahkan field baru tanpa menghapus lama.

Mark lama deprecated di docs/schema.

Plan removal di v2.

---

# 58. Referensi Resmi

Referensi utama:

1. RFC 9110 — HTTP Semantics  
   https://www.rfc-editor.org/rfc/rfc9110.html

2. RFC 8594 — The Sunset HTTP Header Field  
   https://www.rfc-editor.org/rfc/rfc8594.html

3. RFC 9745 — The Deprecation HTTP Response Header Field  
   https://datatracker.ietf.org/doc/html/rfc9745

4. Google AIP-185 — API Versioning  
   https://google.aip.dev/185

5. Google AIP-180 — Backwards Compatibility  
   https://google.aip.dev/180

6. Microsoft Graph — Versioning, Support, and Breaking Change Policies  
   https://learn.microsoft.com/en-us/graph/versioning-and-support

7. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

8. Jakarta RESTful Web Services 4.0 — `@Produces` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/produces

9. Jakarta RESTful Web Services 4.0 — `@Consumes` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/consumes

---

# 59. Penutup

API versioning bukan soal estetika URL.

Mental model final:

```text
API versioning = managing consumer-visible incompatible change.
```

Prinsip final:

```text
Version only breaking changes.
Prefer compatible evolution.
Define breaking change rules.
Keep old contracts tested.
Track old version usage.
Deprecate before sunset.
Sunset before removal.
Communicate migration clearly.
```

Top-tier JAX-RS engineer memastikan:

- strategy versioning dipilih berdasarkan consumer dan operasi, bukan selera;
- URI/media/header/query versioning dipakai secara sadar;
- DTO dan mapper versioned di boundary;
- service layer tetap reusable jika semantics sama;
- `Deprecation`, `Sunset`, dan `Link` headers dipakai untuk lifecycle;
- OpenAPI dan contract tests menjaga compatibility;
- usage versi lama terukur sebelum removal;
- migration window jelas dan realistis.

Part berikutnya:

```text
Bagian 034 — OpenAPI and Documentation Strategy
```

Kita akan membahas OpenAPI sebagai contract artifact: schema design, examples, error docs, generated docs, versioned specs, governance, CI validation, codegen implications, and docs-as-product.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 032 — Transactions, Persistence, and REST Boundary: JPA Entity vs DTO, Service-Layer Transaction, Lazy Loading, Optimistic Locking, Outbox, Pagination Query, Streaming/Export, and Consistency Patterns](./learn-jaxrs-advanced-part-032.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Bagian 034 — OpenAPI and Documentation Strategy: Contract Artifact, Code-First vs Spec-First, MicroProfile OpenAPI, Schema Design, Examples, Error Docs, Versioned Specs, Governance, CI Validation, Codegen, and Docs-as-Product](./learn-jaxrs-advanced-part-034.md)
