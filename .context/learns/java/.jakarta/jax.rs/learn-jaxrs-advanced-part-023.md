# learn-jaxrs-advanced-part-023.md

# Bagian 023 — Hypermedia and Links: `Link`, HATEOAS, Practical REST Maturity, `Location`, `Content-Location`, Pagination Links, Action Affordances, dan API Evolvability

> Target pembaca: Java/Jakarta engineer yang ingin memahami **hypermedia/linking** dalam JAX-RS/Jakarta REST secara pragmatic-production. Fokus bagian ini bukan propaganda “semua API harus HATEOAS”, tetapi kapan link berguna, bagaimana mendesain relation types, bagaimana memakai `jakarta.ws.rs.core.Link`, `Location`, `Content-Location`, pagination links, action affordances, state-dependent links, security/authorization-aware links, dan bagaimana menghindari over-engineered hypermedia.
>
> Namespace utama: `jakarta.ws.rs.core.Link`, `jakarta.ws.rs.core.Response`, `jakarta.ws.rs.core.UriInfo`, `jakarta.ws.rs.core.UriBuilder`, `jakarta.ws.rs.core.Context`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Link adalah Contract of Possibility](#2-mental-model-link-adalah-contract-of-possibility)
3. [Hypermedia, HATEOAS, dan REST Maturity](#3-hypermedia-hateoas-dan-rest-maturity)
4. [Kenapa Banyak API “REST” Tidak Pakai Hypermedia](#4-kenapa-banyak-api-rest-tidak-pakai-hypermedia)
5. [Pragmatic Hypermedia: Gunakan Jika Membantu Client](#5-pragmatic-hypermedia-gunakan-jika-membantu-client)
6. [Web Linking Model: Context, Target, Relation Type](#6-web-linking-model-context-target-relation-type)
7. [RFC 8288 dan Link Relation Types](#7-rfc-8288-dan-link-relation-types)
8. [IANA Link Relation Registry](#8-iana-link-relation-registry)
9. [Registered Relation vs Extension Relation](#9-registered-relation-vs-extension-relation)
10. [`Link` Header vs Link di Response Body](#10-link-header-vs-link-di-response-body)
11. [`jakarta.ws.rs.core.Link`](#11-jakartawsrscorelink)
12. [`Link.Builder`: `fromUri`, `fromPath`, `fromResource`, `fromMethod`](#12-linkbuilder-fromuri-frompath-fromresource-frommethod)
13. [Menambahkan Link ke Response](#13-menambahkan-link-ke-response)
14. [Membaca Link dari Response](#14-membaca-link-dari-response)
15. [`Location` Header](#15-location-header)
16. [`Content-Location` Header](#16-content-location-header)
17. [`self`, `canonical`, `alternate`](#17-self-canonical-alternate)
18. [`next`, `prev`, `first`, `last` untuk Pagination](#18-next-prev-first-last-untuk-pagination)
19. [Pagination: Link Header dan Body Links](#19-pagination-link-header-dan-body-links)
20. [Action/Affordance Links](#20-actionaffordance-links)
21. [State-Dependent Links](#21-state-dependent-links)
22. [Authorization-Aware Links](#22-authorization-aware-links)
23. [Links Are Hints, Not Authorization](#23-links-are-hints-not-authorization)
24. [URI Generation dengan `UriInfo`](#24-uri-generation-dengan-uriinfo)
25. [Relative vs Absolute Links](#25-relative-vs-absolute-links)
26. [Gateway/Reverse Proxy-Aware Links](#26-gatewayreverse-proxy-aware-links)
27. [Link Relation Naming Strategy](#27-link-relation-naming-strategy)
28. [Custom Relation URI Strategy](#28-custom-relation-uri-strategy)
29. [Typed Links: `type`, `title`, `hreflang`, `profile`](#29-typed-links-type-title-hreflang-profile)
30. [Profiles and Documentation Links](#30-profiles-and-documentation-links)
31. [Links in Error Responses](#31-links-in-error-responses)
32. [Links in Long-Running Operations](#32-links-in-long-running-operations)
33. [Links in Created Resource Responses](#33-links-in-created-resource-responses)
34. [Links in Domain Workflow](#34-links-in-domain-workflow)
35. [Hypermedia Forms: HAL-FORMS, Siren, JSON:API, Collection+JSON](#35-hypermedia-forms-hal-forms-siren-jsonapi-collectionjson)
36. [HAL-like Minimal Pattern](#36-hal-like-minimal-pattern)
37. [JSON:API-like Links Pattern](#37-jsonapi-like-links-pattern)
38. [Problem Details Links](#38-problem-details-links)
39. [Client Design with Links](#39-client-design-with-links)
40. [When Not to Use Hypermedia](#40-when-not-to-use-hypermedia)
41. [Versioning and Evolvability](#41-versioning-and-evolvability)
42. [Caching and Links](#42-caching-and-links)
43. [Security Considerations](#43-security-considerations)
44. [Observability](#44-observability)
45. [Testing Links](#45-testing-links)
46. [OpenAPI Documentation](#46-openapi-documentation)
47. [Runtime Differences and Implementation Notes](#47-runtime-differences-and-implementation-notes)
48. [Common Failure Modes](#48-common-failure-modes)
49. [Best Practices](#49-best-practices)
50. [Anti-Patterns](#50-anti-patterns)
51. [Production Checklist](#51-production-checklist)
52. [Latihan](#52-latihan)
53. [Referensi Resmi](#53-referensi-resmi)
54. [Penutup](#54-penutup)

---

# 1. Tujuan Part Ini

Hypermedia sering menjadi topik yang penuh debat.

Sebagian engineer berkata:

```text
REST harus HATEOAS. Tanpa hypermedia bukan REST sejati.
```

Sebagian lain berkata:

```text
HATEOAS tidak berguna. Client tetap butuh dokumentasi.
```

Production engineer perlu posisi yang lebih matang:

```text
Hypermedia berguna jika link membantu client memahami navigasi,
state transition, recoverability, pagination, long-running operation,
atau documentation discovery tanpa hardcode berlebihan.
```

Hypermedia tidak harus berarti framework besar atau response terlalu rumit.

Kadang cukup:

```http
Location: /customers/C001
Link: </customers/C001>; rel="self"
Link: </customers/C001/orders>; rel="orders"
```

atau body:

```json
{
  "id": "C001",
  "displayName": "Fajar",
  "_links": {
    "self": { "href": "/customers/C001" },
    "orders": { "href": "/customers/C001/orders" }
  }
}
```

## 1.1 Tujuan utama

Bagian ini membantu kamu:

- memahami link sebagai contract;
- memakai `jakarta.ws.rs.core.Link`;
- membedakan `Location`, `Content-Location`, `Link`;
- mendesain pagination links;
- mendesain action links;
- membuat links berdasarkan state dan authorization;
- menghindari hardcoded URI string;
- membuat link yang gateway-aware;
- menentukan kapan hypermedia layak dan kapan tidak.

## 1.2 Prinsip utama

```text
A link says: from this representation, this related resource or affordance is available under this relation.
```

---

# 2. Mental Model: Link adalah Contract of Possibility

Link bukan sekadar URL.

Link punya tiga bagian:

```text
context resource
relation
target resource
```

Contoh:

```http
Link: </customers/C001/orders>; rel="orders"
```

Artinya:

```text
Dalam konteks customer C001,
ada related resource “orders”
di /customers/C001/orders.
```

## 2.1 Link sebagai navigasi

```text
self
next
prev
first
last
collection
item
```

## 2.2 Link sebagai relationship

```text
customer → orders
case → documents
application → applicant
```

## 2.3 Link sebagai affordance/action

```text
application → submit
case → approve
order → cancel
```

## 2.4 Link sebagai recovery

```text
error → help
problem → describedby
long-running operation → status
```

## 2.5 Top-tier rule

```text
A link should reduce client hardcoding or clarify available transitions.
If it does neither, it is probably noise.
```

---

# 3. Hypermedia, HATEOAS, dan REST Maturity

HATEOAS = Hypermedia as the Engine of Application State.

Mental model:

```text
Client starts from known entry point.
Server responses contain links/actions.
Client follows links instead of hardcoding every URI transition.
```

## 3.1 REST maturity simplified

Common maturity model:

- Level 0: one endpoint, RPC over HTTP;
- Level 1: resources;
- Level 2: HTTP methods/status codes;
- Level 3: hypermedia controls.

## 3.2 Important nuance

Maturity model is useful teaching tool, not law.

## 3.3 In real enterprise APIs

Many successful APIs use:

- resourceful URLs;
- proper methods/status codes;
- OpenAPI docs;
- some links for pagination/created resources;
- limited hypermedia actions.

## 3.4 Pragmatic position

Hypermedia is a tool, not religion.

## 3.5 Rule

Use hypermedia where client behavior benefits from runtime discoverability.

---

# 4. Kenapa Banyak API “REST” Tidak Pakai Hypermedia

## 4.1 Client already code-generated

OpenAPI clients often hardcode operations.

## 4.2 Product UI fixed

Frontend knows workflow from product design.

## 4.3 Hypermedia media type missing

Plain JSON has no standardized action semantics unless you define convention.

## 4.4 More response complexity

Links can increase payload and testing.

## 4.5 Security complexity

Available actions differ by user/tenant/state.

## 4.6 Still useful

Even without full HATEOAS, links are valuable for:

- pagination;
- created resource location;
- long-running operation status;
- documents/downloads;
- related resources;
- Problem Details help;
- state-dependent actions.

## 4.7 Rule

Do not force full HATEOAS when simple links solve the real problem.

---

# 5. Pragmatic Hypermedia: Gunakan Jika Membantu Client

## 5.1 Good candidates

- pagination;
- resource creation;
- file download;
- async job status;
- next available workflow actions;
- relationship navigation;
- documentation/profile;
- error recovery.

## 5.2 Weak candidates

- every field has link;
- internal admin-only relations;
- static frontend already knows all route patterns;
- links duplicate docs without runtime value.

## 5.3 Test usefulness

Ask:

```text
Can client do something simpler/safer because this link exists?
```

If no, reconsider.

## 5.4 Rule

Hypermedia should be client-value driven.

---

# 6. Web Linking Model: Context, Target, Relation Type

RFC 8288 defines a model for links on the Web.

## 6.1 Context

The resource where link appears.

Example response:

```http
GET /customers/C001
```

Context is:

```text
/customers/C001
```

## 6.2 Target

The linked resource.

```text
/customers/C001/orders
```

## 6.3 Relation type

Meaning of relationship.

```text
orders
```

or registered relation:

```text
self
next
describedby
```

## 6.4 Target attributes

Metadata about target:

- type;
- title;
- hreflang;
- media;
- profile.

## 6.5 Rule

A URL without relation is just an address; a link has typed meaning.

---

# 7. RFC 8288 dan Link Relation Types

RFC 8288 defines Web Linking: a model for relationships between web resources and relation types.

## 7.1 Link header serialization

Example:

```http
Link: </orders/123>; rel="self"; type="application/json"
```

## 7.2 Multiple links

```http
Link: </customers?page=2>; rel="next"
Link: </customers?page=1>; rel="prev"
```

or comma-separated according HTTP header rules.

## 7.3 Relation type

Can be registered token:

```text
next
prev
self
```

or extension URI.

## 7.4 Rule

Use registered relation types when semantics match.

---

# 8. IANA Link Relation Registry

IANA maintains registry of link relation types.

Examples include:

```text
self
next
prev
first
last
alternate
canonical
describedby
help
item
collection
profile
service-desc
service-doc
```

## 8.1 Why use registered relations?

They are understood beyond your API.

## 8.2 When not enough

For domain-specific actions:

```text
approve
submit
cancel
assign
```

you can define extension relation types.

## 8.3 Rule

Prefer IANA relations for generic semantics; define custom relation only for domain-specific meaning.

---

# 9. Registered Relation vs Extension Relation

## 9.1 Registered relation

```http
rel="next"
rel="self"
rel="describedby"
```

## 9.2 Extension relation URI

```http
rel="https://api.example.com/rels/approve"
```

URI relation avoids collision.

## 9.3 Short custom tokens

```http
rel="approve"
```

Can work inside your API but risks ambiguity.

## 9.4 Recommendation

For public APIs, use URI-based extension relations or carefully documented namespaced convention.

## 9.5 Rule

Relation names are public contract. Treat them like API names.

---

# 10. `Link` Header vs Link di Response Body

## 10.1 `Link` header

Pros:

- standardized;
- media-type independent;
- useful for pagination/discovery;
- accessible before parsing body.

Cons:

- frontend CORS must expose header;
- some clients ignore headers;
- harder to include rich action metadata.

## 10.2 Body links

Pros:

- visible in JSON schema;
- easy for frontend;
- can include richer metadata;
- works with codegen if schema includes it.

Cons:

- media-type specific;
- you define convention;
- duplicated if also in header.

## 10.3 Practical choice

Use headers for:

- pagination;
- `describedby`;
- profile;
- generic relations.

Use body for:

- resource links;
- action links;
- UI/client affordances.

## 10.4 Rule

Use header links for protocol-level navigation, body links for representation-level affordances.

---

# 11. `jakarta.ws.rs.core.Link`

JAX-RS provides `Link` class representing hypermedia links.

## 11.1 Basic

```java
Link self = Link.fromUri("/customers/C001")
    .rel("self")
    .type(MediaType.APPLICATION_JSON)
    .build();
```

## 11.2 Link has

- URI;
- rel;
- rels;
- title;
- type;
- params.

## 11.3 Serialization

`Link#toString()` serializes as Link header representation.

```http
</customers/C001>; rel="self"; type="application/json"
```

## 11.4 Parsing

```java
Link link = Link.valueOf("</customers/C001>; rel=\"self\"");
```

## 11.5 Rule

Use `Link` builder instead of manual string concatenation.

---

# 12. `Link.Builder`: `fromUri`, `fromPath`, `fromResource`, `fromMethod`

## 12.1 From URI

```java
Link.fromUri(uri)
    .rel("self")
    .build();
```

## 12.2 From path

```java
Link.fromPath("/customers/{id}")
    .rel("self")
    .build(customerId);
```

## 12.3 From resource

```java
Link.fromResource(CustomerResource.class)
    .rel("collection")
    .build();
```

## 12.4 From method

```java
Link.fromMethod(CustomerResource.class, "getCustomer")
    .rel("self")
    .build(customerId);
```

## 12.5 Caveat

Resource/method based builders produce relative links unless base URI is supplied.

Use `UriInfo#getBaseUri()` or request URI builder for absolute external links.

## 12.6 Rule

Prefer framework builders to avoid URI drift when paths change.

---

# 13. Menambahkan Link ke Response

## 13.1 Link header

```java
Link self = Link.fromUri(uriInfo.getRequestUri())
    .rel("self")
    .build();

return Response.ok(customer)
    .links(self)
    .build();
```

## 13.2 Multiple links

```java
return Response.ok(customer)
    .links(self, orders, documents)
    .build();
```

## 13.3 Response builder shortcut

```java
return Response.created(location)
    .link(location, "self")
    .entity(response)
    .build();
```

## 13.4 Body links

```java
public record CustomerResponse(
    String id,
    String displayName,
    Map<String, LinkDto> links
) {}
```

## 13.5 Rule

Use response headers for standard link relations, body for client-facing navigation/action model.

---

# 14. Membaca Link dari Response

On server/client response object:

```java
Link self = response.getLink("self");
Set<Link> links = response.getLinks();
boolean hasNext = response.hasLink("next");
```

## 14.1 Client API

A JAX-RS client can create target/invocation from `Link`.

```java
WebTarget target = client.target(link);
```

or use invocation builder depending API.

## 14.2 Use case

- follow pagination next link;
- follow status link;
- follow describedby link;
- test response links.

## 14.3 Rule

Clients should prefer relation lookup over hardcoded response index.

---

# 15. `Location` Header

`Location` identifies URI for newly created resource or redirect target depending status code.

## 15.1 Created resource

```http
201 Created
Location: /customers/C001
```

JAX-RS:

```java
return Response.created(customerUri)
    .entity(response)
    .build();
```

## 15.2 202 Accepted

For async operation:

```http
202 Accepted
Location: /operations/OP123
```

The location can identify operation/status resource.

## 15.3 3xx redirect

Location indicates redirect target.

## 15.4 Rule

Use `Location` for new resource/status resource target, not as generic related-link bucket.

---

# 16. `Content-Location` Header

`Content-Location` identifies a URI for the representation enclosed in the response.

## 16.1 Example

```http
GET /customers/C001
Content-Location: /customers/C001?view=summary
```

## 16.2 Difference from Location

`Location` often points to created/redirect target.

`Content-Location` describes enclosed representation identity.

## 16.3 Use cases

- response representation has more specific URI;
- variant-specific URI;
- cached representation.

## 16.4 In APIs

Less common than `Location` and `Link`.

## 16.5 Rule

Do not confuse `Location` and `Content-Location`.

---

# 17. `self`, `canonical`, `alternate`

## 17.1 self

The link target identifies the current resource/representation context.

```http
Link: </customers/C001>; rel="self"
```

## 17.2 canonical

Preferred URI for the resource.

Useful if resource has aliases.

```http
Link: </customers/C001>; rel="canonical"
```

## 17.3 alternate

Alternative representation.

```http
Link: </customers/C001?format=csv>; rel="alternate"; type="text/csv"
```

## 17.4 Rule

Use standard relations for standard semantics.

---

# 18. `next`, `prev`, `first`, `last` untuk Pagination

## 18.1 Offset pagination

Can provide:

```text
first
prev
next
last
```

if total count known.

## 18.2 Cursor pagination

Usually provide:

```text
next
prev
```

maybe no `last`.

## 18.3 Link header example

```http
Link: </customers?cursor=abc&limit=20>; rel="next"
```

## 18.4 Body example

```json
{
  "items": [],
  "links": {
    "self": { "href": "/customers?limit=20" },
    "next": { "href": "/customers?cursor=abc&limit=20" }
  }
}
```

## 18.5 Rule

Pagination links should preserve filters, sorting, projection, and limit.

---

# 19. Pagination: Link Header dan Body Links

## 19.1 Build with `UriInfo`

```java
URI nextUri = uriInfo.getRequestUriBuilder()
    .replaceQueryParam("cursor", page.nextCursor())
    .replaceQueryParam("limit", page.limit())
    .build();

Link next = Link.fromUri(nextUri).rel("next").build();
```

## 19.2 Response

```java
return Response.ok(body)
    .links(next)
    .build();
```

## 19.3 CORS

If browser frontend must read `Link` header:

```http
Access-Control-Expose-Headers: Link
```

## 19.4 Body links often easier

For frontend apps, including links in JSON body avoids exposed-header issue.

## 19.5 Rule

Pagination links are one of the highest-value hypermedia use cases.

---

# 20. Action/Affordance Links

Action link tells client what operation may be available.

## 20.1 Example body

```json
{
  "id": "APP-001",
  "status": "draft",
  "_links": {
    "self": { "href": "/applications/APP-001" },
    "submit": {
      "href": "/applications/APP-001/submissions",
      "method": "POST",
      "type": "application/json"
    }
  }
}
```

## 20.2 Link header limitation

HTTP `Link` header does not standardize method/action body schema.

For rich affordances, body format is better.

## 20.3 Useful for workflows

- submit;
- approve;
- reject;
- cancel;
- assign;
- upload document;
- download certificate.

## 20.4 Rule

Action links should reflect available transitions from current state.

---

# 21. State-Dependent Links

Links can depend on resource state.

## 21.1 Draft application

```json
"_links": {
  "submit": { "href": "/applications/A1/submissions", "method": "POST" }
}
```

## 21.2 Submitted application

```json
"_links": {
  "withdraw": { "href": "/applications/A1/withdrawals", "method": "POST" }
}
```

## 21.3 Approved application

```json
"_links": {
  "certificate": { "href": "/applications/A1/certificate", "method": "GET" }
}
```

## 21.4 Benefit

Client can render possible actions without duplicating all state machine logic.

## 21.5 Rule

State-dependent links are practical HATEOAS.

---

# 22. Authorization-Aware Links

Links should generally only include actions caller is allowed to attempt.

## 22.1 Example

Supervisor sees:

```json
"approve": { "href": "/cases/C1/approvals", "method": "POST" }
```

Officer does not.

## 22.2 Avoid leaking hidden actions

If user has no permission, omit action link.

## 22.3 But server still enforces authorization

Even if link exists, request must be authorized.

## 22.4 Why include authorized links?

Better UX and less client policy duplication.

## 22.5 Rule

Links can be authorization-aware hints, but never replace authorization checks.

---

# 23. Links Are Hints, Not Authorization

## 23.1 Client can forge request

Even if link absent, malicious client can call endpoint directly.

## 23.2 Server must check

Every endpoint still needs:

- authentication;
- authorization;
- tenant/resource access;
- state transition checks;
- validation.

## 23.3 Link omission is UX/security minimization

It avoids advertising unavailable actions.

It is not access control.

## 23.4 Rule

Never rely on absence of a link for security.

---

# 24. URI Generation dengan `UriInfo`

Avoid hardcoded URI strings.

## 24.1 Current request URI

```java
uriInfo.getRequestUri()
```

## 24.2 Base URI

```java
uriInfo.getBaseUri()
```

## 24.3 Absolute path builder

```java
URI customerUri = uriInfo.getBaseUriBuilder()
    .path(CustomerResource.class)
    .path(CustomerResource.class, "getCustomer")
    .build(customerId);
```

## 24.4 Request URI builder

Good for pagination:

```java
uriInfo.getRequestUriBuilder()
    .replaceQueryParam("cursor", nextCursor)
    .build();
```

## 24.5 Rule

URI construction should use builders and resource methods, not string concatenation.

---

# 25. Relative vs Absolute Links

## 25.1 Absolute

```text
https://api.example.com/customers/C001
```

Pros:

- works outside context;
- email/external clients;
- Location often absolute-friendly.

Cons:

- gateway/proxy issues;
- environment-specific.

## 25.2 Relative

```text
/customers/C001
```

Pros:

- gateway-friendly;
- less environment coupling;
- compact.

Cons:

- client must resolve against base.

## 25.3 Recommendation

- `Location`: often absolute or absolute-path depending policy/client.
- body links: relative is often fine for same API.
- public APIs: document.

## 25.4 Rule

Pick relative/absolute policy and be consistent.

---

# 26. Gateway/Reverse Proxy-Aware Links

App behind gateway may see internal URI:

```text
http://service:8080
```

but external client needs:

```text
https://api.example.com
```

## 26.1 Problem

Using `uriInfo.getBaseUri()` may generate internal links if proxy headers not configured.

## 26.2 Solutions

- configure runtime to honor `Forwarded`/`X-Forwarded-*`;
- let gateway rewrite links;
- use relative links;
- external base URL config.

## 26.3 Security

Trust forwarded headers only from trusted proxy.

## 26.4 Rule

Test link generation in deployed topology, not only localhost.

---

# 27. Link Relation Naming Strategy

## 27.1 Standard first

Use:

```text
self
next
prev
first
last
collection
item
describedby
help
profile
alternate
canonical
```

when semantics fit.

## 27.2 Domain-specific

For custom actions:

```text
approve
submit
cancel
assign
download-certificate
```

## 27.3 Naming

Prefer verbs for actions, nouns for relations.

```text
orders
documents
submit
approve
```

## 27.4 Consistency

Use same relation name across API.

## 27.5 Rule

Relation names are a vocabulary. Curate them.

---

# 28. Custom Relation URI Strategy

For public APIs, custom relation can be URI.

```json
{
  "rel": "https://api.example.com/rels/approve"
}
```

or in header:

```http
Link: </applications/A1/approvals>; rel="https://api.example.com/rels/approve"
```

## 28.1 Benefits

- collision-free;
- can link to documentation;
- globally meaningful.

## 28.2 Cost

- verbose;
- clients may prefer short keys in body.

## 28.3 Hybrid

Use short keys in body but document them.

For standards-heavy integrations, use URI relations.

## 28.4 Rule

The more public/third-party the API, the more formal relation naming should be.

---

# 29. Typed Links: `type`, `title`, `hreflang`, `profile`

## 29.1 type

Target media type.

```http
Link: </customers/C001.pdf>; rel="alternate"; type="application/pdf"
```

## 29.2 title

Human-readable title.

```http
Link: </help/errors/validation>; rel="help"; title="Validation error help"
```

## 29.3 hreflang

Target language.

```http
Link: </docs/id/customers>; rel="describedby"; hreflang="id"
```

## 29.4 profile

Identifies additional semantics/profile.

## 29.5 Rule

Use link attributes when clients need target metadata before fetching.

---

# 30. Profiles and Documentation Links

## 30.1 profile relation

Profile can identify semantic profile for representation.

```http
Link: <https://api.example.com/profiles/customer-v1>; rel="profile"
```

## 30.2 describedby

Documentation describing resource.

```http
Link: <https://developer.example.com/docs/customers>; rel="describedby"
```

## 30.3 service-doc

Can link to service documentation where appropriate.

## 30.4 Use in error responses

Problem Details can include `type` URI, but links can add help docs.

## 30.5 Rule

Documentation links make APIs more self-descriptive without bloating body.

---

# 31. Links in Error Responses

## 31.1 Problem Details

```json
{
  "type": "https://api.example.com/problems/precondition-failed",
  "title": "Precondition failed",
  "status": 412,
  "code": "PRECONDITION_FAILED",
  "_links": {
    "help": { "href": "/docs/errors/precondition-failed" },
    "resource": { "href": "/customers/C001" }
  }
}
```

## 31.2 Useful links

- help;
- describedby;
- retry;
- resource;
- login;
- support.

## 31.3 Do not leak

Do not include resource link if caller not authorized to know it exists.

## 31.4 Rule

Error links should aid recovery without leaking information.

---

# 32. Links in Long-Running Operations

## 32.1 Start operation

```http
POST /exports
```

Response:

```http
202 Accepted
Location: /operations/OP123
Link: </operations/OP123>; rel="status"
```

Body:

```json
{
  "operationId": "OP123",
  "_links": {
    "self": { "href": "/operations/OP123" },
    "cancel": { "href": "/operations/OP123/cancellations", "method": "POST" }
  }
}
```

## 32.2 Completed operation

```json
{
  "status": "completed",
  "_links": {
    "result": { "href": "/exports/E123/download", "method": "GET" }
  }
}
```

## 32.3 Rule

Async APIs benefit strongly from links.

---

# 33. Links in Created Resource Responses

## 33.1 Create

```http
POST /customers
```

Response:

```http
201 Created
Location: /customers/C001
Link: </customers/C001>; rel="self"
```

Body:

```json
{
  "id": "C001",
  "_links": {
    "self": { "href": "/customers/C001" },
    "collection": { "href": "/customers" }
  }
}
```

## 33.2 If creation triggers workflow

Add action links:

```json
"submit": { "href": "/applications/A1/submissions", "method": "POST" }
```

## 33.3 Rule

Created responses should identify the created resource clearly.

---

# 34. Links in Domain Workflow

## 34.1 Workflow resource

Application status:

```text
draft → submitted → under_review → approved/rejected
```

## 34.2 Draft response

```json
"_links": {
  "self": { "href": "/applications/A1" },
  "submit": { "href": "/applications/A1/submissions", "method": "POST" },
  "delete": { "href": "/applications/A1", "method": "DELETE" }
}
```

## 34.3 Under review response

```json
"_links": {
  "approve": { "href": "/applications/A1/approvals", "method": "POST" },
  "reject": { "href": "/applications/A1/rejections", "method": "POST" }
}
```

## 34.4 Approved response

```json
"_links": {
  "certificate": { "href": "/applications/A1/certificate", "method": "GET" }
}
```

## 34.5 Rule

Workflow links are executable documentation of current state.

---

# 35. Hypermedia Forms: HAL-FORMS, Siren, JSON:API, Collection+JSON

Some media types define richer hypermedia controls.

## 35.1 HAL

Common `_links` convention.

## 35.2 HAL-FORMS

Adds templated forms/actions.

## 35.3 Siren

Entities, actions, links.

## 35.4 JSON:API

Defines `links` object and relationships.

## 35.5 Collection+JSON

Designed for collection interactions.

## 35.6 Rule

If you need rich actions/forms, consider existing hypermedia media types before inventing everything.

---

# 36. HAL-like Minimal Pattern

## 36.1 Example

```json
{
  "id": "C001",
  "displayName": "Fajar",
  "_links": {
    "self": { "href": "/customers/C001" },
    "orders": { "href": "/customers/C001/orders" }
  }
}
```

## 36.2 Benefits

- simple;
- familiar;
- easy for clients.

## 36.3 Limitations

Does not standardize method/body schema for actions.

## 36.4 Add method?

Some APIs add:

```json
"submit": { "href": "...", "method": "POST" }
```

This is custom extension. Document it.

## 36.5 Rule

Minimal HAL-like links are good starting point if you document conventions.

---

# 37. JSON:API-like Links Pattern

## 37.1 Example

```json
{
  "data": {
    "type": "customers",
    "id": "C001",
    "attributes": {
      "displayName": "Fajar"
    },
    "links": {
      "self": "/customers/C001"
    }
  },
  "links": {
    "self": "/customers/C001"
  }
}
```

## 37.2 Relationship links

```json
"relationships": {
  "orders": {
    "links": {
      "related": "/customers/C001/orders"
    }
  }
}
```

## 37.3 Use if adopting JSON:API

Do not partially imitate without clarity.

## 37.4 Rule

If using a named media type/convention, follow its semantics consistently.

---

# 38. Problem Details Links

Problem Details has `type` URI.

## 38.1 Type URI

```json
"type": "https://api.example.com/problems/validation-failed"
```

This can be documentation link.

## 38.2 Additional links

```json
"_links": {
  "help": { "href": "/docs/errors/validation-failed" }
}
```

## 38.3 When useful

- validation docs;
- auth recovery;
- conflict resolution;
- precondition failed docs.

## 38.4 Rule

For errors, the `type` URI is already a kind of documentation link; add `_links` only if it helps.

---

# 39. Client Design with Links

## 39.1 Use relation, not array index

```js
const next = response.links.next.href
```

## 39.2 Do not parse IDs from URI

Bad:

```js
const id = href.split("/").pop()
```

Use response `id`.

## 39.3 Treat unknown links as ignorable

Forward compatibility.

## 39.4 Do not assume link presence

Links may vary by state/authorization.

## 39.5 Rule

Link-aware clients follow known relations and ignore unknown ones.

---

# 40. When Not to Use Hypermedia

Avoid hypermedia when:

- it adds no client value;
- client is internal and generated from OpenAPI;
- response size is critical;
- actions are static and obvious;
- media type conventions are not agreed;
- links would reveal sensitive workflow;
- team cannot test/maintain links.

## 40.1 Use docs instead

OpenAPI may be enough.

## 40.2 Use limited links

Even in non-hypermedia APIs, use:

- Location;
- pagination next;
- async operation status.

## 40.3 Rule

Hypermedia should be intentionally scoped.

---

# 41. Versioning and Evolvability

Links can improve evolvability by reducing URI hardcoding.

## 41.1 URI changes

If client follows `rel="orders"`, server can change target URI more easily.

## 41.2 Action availability

Server can add new action links without breaking old clients.

## 41.3 Relation stability

Changing relation name is breaking.

## 41.4 Response shape

If `_links` convention changes, breaking.

## 41.5 Rule

Hypermedia moves coupling from URI patterns to relation vocabulary.

---

# 42. Caching and Links

## 42.1 Links are representation data

If links vary by authorization/state, response varies.

## 42.2 Cache private

Authorization-aware links usually mean:

```http
Cache-Control: private
```

or no-store for sensitive.

## 42.3 Link target freshness

Link can become stale after state changes.

Server still validates action on call.

## 42.4 Rule

Do not assume link presence guarantees future action success.

---

# 43. Security Considerations

## 43.1 Do not leak hidden resources

If user cannot know documents exist, do not include documents link.

## 43.2 Do not include forbidden actions

Omit action links user cannot perform.

## 43.3 But re-check server-side

Links are hints.

## 43.4 Signed temporary links

For downloads, use short-lived signed URLs if needed.

## 43.5 Open redirect

Do not include untrusted user-controlled URLs in links without validation.

## 43.6 Rule

Links are part of output security review.

---

# 44. Observability

## 44.1 Metrics

```text
api_links_emitted_total{route,rel}
api_link_generation_errors_total{route}
api_action_link_omitted_total{route,rel,reason}
```

## 44.2 Logs

Log link generation failures, not every link.

## 44.3 High cardinality

Do not label by raw href.

Use relation and route.

## 44.4 Debug

In lower env, provider tests can snapshot links.

## 44.5 Rule

Observe relation-level behavior, not URL-level high cardinality.

---

# 45. Testing Links

## 45.1 Unit tests

Test link builder functions.

## 45.2 Resource integration tests

Assert:

- `Location` on create;
- `Link` header rels;
- body `_links`;
- pagination `next` preserves filters/sorts;
- absent `next` on last page;
- action link appears in correct state;
- forbidden action omitted;
- link target endpoint works.

## 45.3 Gateway tests

Assert external scheme/host in generated links if absolute.

## 45.4 Contract tests

Ensure relation names stable.

## 45.5 Rule

Links are API contract and need tests.

---

# 46. OpenAPI Documentation

## 46.1 Headers

Document:

- `Location`;
- `Link`;
- `Content-Location`.

## 46.2 Body schema

If using `_links`:

```yaml
_links:
  type: object
  additionalProperties:
    $ref: '#/components/schemas/Link'
```

## 46.3 Relation docs

Document known rels:

```text
self
orders
submit
approve
cancel
```

## 46.4 Examples

Hypermedia is easiest to understand via examples.

## 46.5 Rule

Hypermedia contract must be documented even if discoverable.

---

# 47. Runtime Differences and Implementation Notes

## 47.1 JAX-RS standard

`Link`, `Response.links`, `Response.getLink`, `UriInfo`, and `UriBuilder` are standard.

## 47.2 Proxy handling

External URI generation is runtime/server configuration dependent.

## 47.3 Serialization

`jakarta.ws.rs.core.Link` is not always ideal as JSON DTO directly.

Use your own `LinkDto`.

## 47.4 Rule

Use JAX-RS `Link` for headers/builders; use API-specific DTO for JSON body links.

---

# 48. Common Failure Modes

## 48.1 Hardcoded URI strings

Break when path changes.

## 48.2 Missing proxy awareness

Links show internal host.

## 48.3 Link relation names inconsistent

Client confusion.

## 48.4 Action link shown but action forbidden

Bad UX/security smell.

## 48.5 Action link omitted but server allows

Inconsistent policy.

## 48.6 `Location` missing on 201

Client cannot discover created resource.

## 48.7 Pagination link loses filters

Client gets wrong next page.

## 48.8 Link header not exposed via CORS

Browser cannot read it.

## 48.9 Custom rel conflicts with standard semantics

Interoperability issue.

## 48.10 Hypermedia bloats every response

Performance/noise problem.

---

# 49. Best Practices

## 49.1 Use standard rels when possible

`self`, `next`, `prev`, `first`, `last`, `canonical`, `alternate`, `describedby`.

## 49.2 Generate links with builders

`UriInfo`, `UriBuilder`, `Link`.

## 49.3 Include Location on 201

And often self link.

## 49.4 Use pagination links

They are high-value and low-controversy.

## 49.5 Make action links state/authorization-aware

But always enforce server-side.

## 49.6 Document custom rels

Relation vocabulary is contract.

## 49.7 Prefer relative body links unless absolute needed

Avoid proxy host issues.

## 49.8 Test links

Including gateway topology.

## 49.9 Avoid over-linking

Every link must have purpose.

## 49.10 Expose Link header in CORS if browser needs it

`Access-Control-Expose-Headers: Link, Location, ETag`.

---

# 50. Anti-Patterns

## 50.1 HATEOAS theater

Adding `_links.self` everywhere but no useful affordances.

## 50.2 Business authorization by link hiding

Security bug.

## 50.3 Random custom rels

No stable vocabulary.

## 50.4 Links to internal hostnames

Proxy config bug.

## 50.5 Full URLs hardcoded in service layer

Environment coupling.

## 50.6 Action links without method/type

Client does not know how to call.

## 50.7 Huge embedded graph

Response bloat.

## 50.8 Changing rel names casually

Breaking clients.

## 50.9 Client ignores links but API relies on them

Contract mismatch.

## 50.10 Using `Location` for every related resource

Misuse; use `Link`.

---

# 51. Production Checklist

## 51.1 Link design

- [ ] Standard rels used where possible.
- [ ] Custom rel vocabulary documented.
- [ ] Link relation names stable.
- [ ] Action links include method/media type if body links.
- [ ] Links are state-aware.
- [ ] Links are authorization-aware.
- [ ] Server still enforces authorization.

## 51.2 URI generation

- [ ] URI builders used.
- [ ] No hardcoded base URL in resources.
- [ ] Proxy/gateway behavior tested.
- [ ] Relative/absolute policy defined.
- [ ] Pagination links preserve filters/sorts/cursor/limit.

## 51.3 Response headers

- [ ] 201 includes `Location`.
- [ ] `Link` headers used where useful.
- [ ] `Content-Location` used only when semantically correct.
- [ ] CORS exposes `Link`/`Location`/`ETag` if browser needs them.

## 51.4 Security/cache

- [ ] Links do not reveal hidden resources.
- [ ] Temporary download links expire.
- [ ] Open redirect/user-controlled href risk checked.
- [ ] Cache policy accounts for authorization-aware links.

## 51.5 Testing/docs

- [ ] Link builder unit tests.
- [ ] Integration tests assert links.
- [ ] Link targets valid.
- [ ] OpenAPI documents headers/body links.
- [ ] Examples provided.

---

# 52. Latihan

## Latihan 1 — Created Resource Links

Implement:

```http
POST /customers
```

Return:

- `201 Created`;
- `Location`;
- `Link: rel="self"`;
- body `_links.self`;
- body `_links.collection`.

## Latihan 2 — Pagination Link Header

Implement cursor pagination response with:

```http
Link: <...>; rel="next"
```

Preserve:

- query filters;
- sort;
- limit.

## Latihan 3 — Body Links

Add `_links` to `CustomerResponse`:

- self;
- orders;
- documents.

## Latihan 4 — State-Dependent Action Links

Application in `draft` has `submit`.

Application in `submitted` has no `submit`.

Supervisor sees `approve`; normal applicant does not.

## Latihan 5 — Authorization-Aware Link Test

Ensure forbidden action link omitted.

Then call forbidden endpoint manually and ensure server still returns 403/404.

## Latihan 6 — Gateway-Aware Links

Run service behind reverse proxy.

Assert generated absolute links use external scheme/host.

Then switch to relative links and compare.

## Latihan 7 — Link Header CORS

Browser client needs `Link` and `ETag`.

Configure:

```http
Access-Control-Expose-Headers: Link, ETag, Location
```

Test in browser.

## Latihan 8 — Custom Relation Vocabulary

Create `/rels` documentation page listing:

- submit;
- approve;
- cancel;
- download-certificate.

## Latihan 9 — Problem Details Help Link

For validation error, add help/describedby link.

Ensure no hidden resource links leak.

---

# 53. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 — `Link` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/link

2. Jakarta RESTful Web Services 4.0 — `Response` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/response

3. Jakarta RESTful Web Services 4.0 — `UriInfo` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/uriinfo

4. Jakarta RESTful Web Services 4.0 — `UriBuilder` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/uribuilder

5. RFC 8288 — Web Linking  
   https://datatracker.ietf.org/doc/html/rfc8288

6. IANA Link Relations Registry  
   https://www.iana.org/assignments/link-relations/

7. RFC 9110 — HTTP Semantics  
   https://www.rfc-editor.org/rfc/rfc9110.html

8. RFC 9457 — Problem Details for HTTP APIs  
   https://www.rfc-editor.org/rfc/rfc9457.html

---

# 54. Penutup

Hypermedia bukan harus menjadi dogma.

Mental model final:

```text
Link = context + relation + target + optional target metadata
```

Gunakan link untuk:

```text
created resource discovery
pagination
related resources
long-running operation status/result
state-dependent workflow actions
error recovery/help
documentation/profile discovery
```

Jangan gunakan link sebagai:

```text
pengganti authorization
hiasan response
duplikasi random URI
cara memaksa semua client menjadi generic browser
```

Prinsip final:

```text
Hypermedia is useful when it reduces hardcoding, clarifies state transitions,
or improves recoverability/discoverability.
```

Top-tier JAX-RS engineer memastikan:

- link rel vocabulary stabil;
- links dibangun dengan `UriInfo`/`UriBuilder`/`Link`;
- `Location` digunakan benar;
- pagination links preserve query contract;
- action links state-aware dan authorization-aware;
- server tetap enforce authorization;
- proxy/gateway URI benar;
- CORS expose headers jika perlu;
- link contract terdokumentasi dan dites.

Part berikutnya:

```text
Bagian 024 — Asynchronous JAX-RS Server: AsyncResponse, Timeouts, Cancellation
```

Kita akan membahas server-side async secara mendalam: `@Suspended AsyncResponse`, timeout, cancellation, executor model, backpressure, request lifecycle, error handling, and production-safe async APIs.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-jaxrs-advanced-part-022.md">⬅️ Bagian 022 — Conditional Requests, ETag, Last-Modified, Optimistic Concurrency: Validators, `If-Match`, `If-None-Match`, `If-Modified-Since`, `If-Unmodified-Since`, `304`, `412`, `428`, Cache Revalidation, dan Lost Update Prevention</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-jaxrs-advanced-part-024.md">Bagian 024 — Asynchronous JAX-RS Server: `AsyncResponse`, `@Suspended`, `CompletionStage`, Timeouts, Cancellation, Lifecycle Callbacks, Executor Model, Backpressure, and Production-Safe Async APIs ➡️</a>
</div>
