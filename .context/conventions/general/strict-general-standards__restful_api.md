# Strict General Standards: RESTful API

> File: `strict-general-standards__restfull_api.md`  
> Category: General Engineering Standard  
> Principle: RESTful HTTP API Design  
> Status: Mandatory for LLM-assisted API design, implementation, refactoring, review, and documentation

---

## 1. Purpose

This standard defines how an LLM code agent MUST design, implement, modify, and review RESTful HTTP APIs.

The goal is to prevent APIs that are technically reachable over HTTP but are inconsistent, hard to evolve, hard to test, unsafe for clients, and difficult to document.

This standard treats a RESTful API as a **resource-oriented HTTP contract**. The API MUST expose stable resources, use HTTP semantics correctly, preserve backward compatibility, and communicate errors, pagination, concurrency, caching, security, and deprecation explicitly.

This standard is not merely about URL naming. It covers the full external contract of an HTTP API.

---

## 2. Source Baseline

The LLM MUST align API behavior with these baseline references:

- REST architectural style as a set of constraints for distributed hypermedia systems, especially client-server separation, stateless interaction, cacheability, uniform interface, layered system, and optional code-on-demand.
- HTTP Semantics, especially method safety, idempotency, status codes, representation metadata, caching-related semantics, conditional requests, and content negotiation.
- Problem Details for HTTP APIs for standardized machine-readable error responses.
- Resource-oriented API design conventions used by large API platforms.
- OpenAPI as the machine-readable API contract.

References are listed at the end of this document.

---

## 3. Core Interpretation

### 3.1 RESTful means resource-oriented, not RPC over HTTP

The LLM MUST NOT treat REST as merely "JSON over HTTP".

A RESTful API exposes resources and representations. It does not expose arbitrary service methods as URLs.

Bad:

```http
POST /approveCase
POST /getUserDetails
POST /doSearch
POST /calculatePenalty
```

Good:

```http
GET  /cases/{caseId}
POST /cases/{caseId}/approval
GET  /users/{userId}
GET  /cases?status=OPEN&assigneeId=123
POST /penalty-calculations
```

### 3.2 Pragmatic REST boundary

Most enterprise HTTP APIs are not pure hypermedia REST. This standard therefore uses a pragmatic definition:

An API may be accepted as RESTful when it:

- exposes resources with stable identifiers;
- uses HTTP methods according to their semantics;
- uses HTTP status codes correctly;
- keeps requests stateless;
- uses representations explicitly;
- documents contracts in OpenAPI;
- uses consistent error, pagination, filtering, sorting, and versioning patterns;
- preserves backward compatibility unless a versioned breaking change is intentional.

If an API intentionally behaves like RPC, command bus, GraphQL, gRPC transcoding, event ingestion, or workflow command endpoint, the LLM MUST label it honestly and not force fake REST naming.

### 3.3 Resource is a domain concept, not a database table

The LLM MUST model API resources from the client-visible domain, not from internal persistence structures.

A resource MAY correspond to:

- an aggregate root;
- a collection;
- a document;
- a projection/read model;
- a workflow state;
- a command request;
- an operation result;
- a long-running job;
- a relationship;
- an audit record;
- a file/blob representation.

A resource MUST NOT expose internal implementation details such as table names, ORM entity names, package names, service class names, or microservice boundaries unless those names are already part of the public domain language.

---

## 4. Mandatory Rules

### REST-001: Design the resource model before writing endpoints

The LLM MUST identify the resource model before creating controllers, routers, handlers, DTOs, or OpenAPI paths.

For every new API, the LLM MUST define:

- resource name;
- resource identity;
- collection path;
- item path;
- allowed methods;
- representation schema;
- state transitions;
- authorization boundary;
- lifecycle ownership;
- pagination/filtering/sorting behavior where applicable;
- error model;
- backward compatibility impact.

Bad workflow:

```text
Need approve case -> create POST /approveCase.
```

Good workflow:

```text
Domain concept: Case Approval.
Parent resource: Case.
Action creates approval decision record.
Endpoint: POST /cases/{caseId}/approval.
Result: 201 Created or 200 OK depending on idempotency semantics.
```

---

### REST-002: Use nouns for resources, not verbs for normal CRUD

The LLM MUST name normal resources with nouns.

Use plural nouns for collections:

```http
GET    /cases
POST   /cases
GET    /cases/{caseId}
PUT    /cases/{caseId}
PATCH  /cases/{caseId}
DELETE /cases/{caseId}
```

The LLM MUST NOT create CRUD endpoints with action verbs:

```http
POST /createCase
POST /updateCase
POST /deleteCase
POST /getCase
```

Exception: domain commands MAY be represented as command resources when they are not simple CRUD.

Acceptable:

```http
POST /cases/{caseId}/approval
POST /cases/{caseId}/reopening-request
POST /reports/{reportId}/exports
POST /password-reset-requests
```

The command resource MUST have explicit request/response schemas and documented state impact.

---

### REST-003: Keep URI structure stable, predictable, and shallow

The LLM MUST design URIs that are stable and client-oriented.

Required URI rules:

- use lowercase path segments;
- use hyphenated words for readability;
- use plural collection names;
- use stable path parameter names;
- keep nesting shallow;
- avoid exposing implementation details;
- avoid file extensions in resource paths;
- avoid trailing slash differences as separate resources;
- avoid query strings for resource identity unless filtering a collection.

Good:

```http
GET /cases/{caseId}/documents/{documentId}
GET /case-documents/{documentId}
GET /cases?status=OPEN&createdFrom=2026-01-01
```

Bad:

```http
GET /CaseService/GetCaseDocument.do?id=1
GET /case/get/by/id/1
GET /case/{caseId}/document/{documentId}/binary/download/file
```

Deep nesting MUST be avoided when the child resource has independent identity.

Prefer:

```http
GET /documents/{documentId}
```

Over:

```http
GET /agencies/{agencyId}/users/{userId}/cases/{caseId}/documents/{documentId}
```

Unless the nested identity is genuinely scoped and cannot be resolved globally.

---

### REST-004: Use HTTP methods according to semantics

The LLM MUST use HTTP methods consistently.

| Method    | Required meaning                                              | Safe |     Idempotent | Typical use                          |
| --------- | ------------------------------------------------------------- | ---: | -------------: | ------------------------------------ |
| `GET`     | Retrieve representation                                       |  Yes |            Yes | read item/list                       |
| `HEAD`    | Retrieve metadata only                                        |  Yes |            Yes | existence/cache check                |
| `POST`    | Create subordinate resource or execute non-idempotent command |   No |  No by default | create, submit, command              |
| `PUT`     | Replace resource at known URI                                 |   No |            Yes | full replacement/upsert when allowed |
| `PATCH`   | Partially modify resource                                     |   No | Not guaranteed | partial update                       |
| `DELETE`  | Remove resource or mark deleted                               |   No |            Yes | delete/cancel resource               |
| `OPTIONS` | Describe communication options                                |  Yes |            Yes | CORS/discovery                       |

The LLM MUST NOT use:

```http
GET /cases/{caseId}/delete
GET /cases/{caseId}/approve
POST /cases/{caseId}/get
POST /cases/search   # unless search is too complex/sensitive for query params
```

`GET` MUST NOT change server state except for harmless operational side effects such as logging or metrics.

`GET` request bodies are forbidden by this standard for interoperability, even though HTTP semantics do not define general meaning for them.

---

### REST-005: Choose status codes by outcome, not by framework convenience

The LLM MUST return status codes that reflect the HTTP outcome.

Common success statuses:

|                Status | Use                                                           |
| --------------------: | ------------------------------------------------------------- |
|              `200 OK` | successful retrieval or update with response body             |
|         `201 Created` | new resource created; include `Location` header when possible |
|        `202 Accepted` | request accepted for asynchronous processing                  |
|      `204 No Content` | successful request with no response body                      |
| `206 Partial Content` | range response                                                |

Common client error statuses:

|                       Status | Use                                                  |
| ---------------------------: | ---------------------------------------------------- |
|            `400 Bad Request` | malformed syntax or invalid generic request          |
|           `401 Unauthorized` | authentication missing/invalid                       |
|              `403 Forbidden` | authenticated but not allowed                        |
|              `404 Not Found` | resource not found or intentionally hidden           |
|     `405 Method Not Allowed` | method unsupported for resource; include `Allow`     |
|               `409 Conflict` | state/version conflict                               |
|    `412 Precondition Failed` | failed conditional request such as `If-Match`        |
| `415 Unsupported Media Type` | request content type unsupported                     |
|  `422 Unprocessable Content` | syntactically valid but semantically invalid payload |
|      `429 Too Many Requests` | rate limit exceeded                                  |

Common server error statuses:

|                      Status | Use                                                   |
| --------------------------: | ----------------------------------------------------- |
| `500 Internal Server Error` | unexpected server failure                             |
|           `502 Bad Gateway` | upstream returned invalid response                    |
|   `503 Service Unavailable` | temporary overload/maintenance/dependency unavailable |
|       `504 Gateway Timeout` | upstream timeout                                      |

The LLM MUST NOT return `200 OK` for failed business operations.

Bad:

```json
{
  "success": false,
  "error": "Case not found"
}
```

With status:

```http
HTTP/1.1 200 OK
```

Good:

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json
```

---

### REST-006: Use Problem Details for errors

The LLM MUST use `application/problem+json` for error responses unless the existing platform has a stronger established standard.

Required fields:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "detail": "One or more fields are invalid.",
  "instance": "/cases/123/submissions/456",
  "traceId": "01HX..."
}
```

Validation errors SHOULD include field-level details:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "detail": "One or more fields are invalid.",
  "errors": [
    {
      "field": "applicant.email",
      "code": "EMAIL_INVALID",
      "message": "Email address is invalid."
    }
  ],
  "traceId": "01HX..."
}
```

Error responses MUST NOT expose:

- stack traces;
- SQL statements;
- table names;
- internal class names;
- framework exception names;
- secrets;
- access tokens;
- PII beyond what the client already submitted and is authorized to see.

---

### REST-007: Separate transport DTOs from internal domain/persistence models

The LLM MUST NOT expose ORM entities, database rows, or internal domain objects directly as API request/response contracts.

Required separation:

```text
HTTP request JSON -> Request DTO -> validation -> application command/query -> domain model -> response DTO -> HTTP response JSON
```

The public API contract MUST remain stable even if:

- database schema changes;
- entity relationships change;
- internal services are split/merged;
- field names are refactored internally;
- read models are optimized.

DTOs MUST define externally meaningful names, not internal column names.

Bad:

```json
{
  "case_tbl_id": 123,
  "usr_fk": 456,
  "del_flg": "N"
}
```

Good:

```json
{
  "id": "123",
  "assignedOfficerId": "456",
  "deleted": false
}
```

---

### REST-008: Use explicit content negotiation and media types

The LLM MUST set and validate `Content-Type` for requests with bodies.

The LLM SHOULD set `Accept` expectations in clients and document response media types in OpenAPI.

Default JSON APIs MUST use:

```http
Content-Type: application/json
Accept: application/json
```

Error responses MUST use:

```http
Content-Type: application/problem+json
```

Binary/file responses MUST document media type and disposition:

```http
Content-Type: application/pdf
Content-Disposition: attachment; filename="notice.pdf"
```

The LLM MUST NOT silently parse unsupported media types.

---

### REST-009: Define pagination for every unbounded collection

Every collection endpoint that can grow beyond a small fixed size MUST be paginated.

The LLM MUST NOT create unbounded list endpoints.

Bad:

```http
GET /cases
```

Returning all rows.

Good:

```http
GET /cases?limit=50&pageToken=eyJ..."
```

Preferred pagination for mutable large collections:

- cursor/token-based pagination;
- stable sort order;
- opaque page token;
- documented maximum page size;
- documented default page size.

Offset pagination MAY be used only when:

- dataset is small;
- ordering is stable enough;
- client needs random page access;
- performance impact is acceptable.

Required response metadata:

```json
{
  "items": [],
  "nextPageToken": "eyJ...",
  "limit": 50
}
```

The LLM MUST NOT expose database offsets or internal cursor structures as public tokens.

---

### REST-010: Filtering and sorting MUST be explicit and whitelisted

The LLM MUST define allowed filter and sort fields.

Good:

```http
GET /cases?status=OPEN&createdFrom=2026-01-01&sort=-createdAt
```

Rules:

- filters MUST be documented;
- unsupported filters MUST return `400` or `422`, not silently ignored;
- sorting MUST be whitelisted;
- default sorting MUST be deterministic;
- field names MUST use API contract names, not database column names;
- filtering MUST preserve authorization constraints.

The LLM MUST NOT generate dynamic SQL-like query parameters exposed directly to clients.

Bad:

```http
GET /cases?where=status='OPEN' and deleted=false&orderBy=created_at desc
```

---

### REST-011: Use conditional requests for concurrent updates where state integrity matters

For resources with concurrent modification risk, the LLM MUST use optimistic concurrency controls.

Preferred pattern:

```http
GET /cases/123
ETag: "case-123-v7"
```

Then:

```http
PATCH /cases/123
If-Match: "case-123-v7"
Content-Type: application/json
```

If the version no longer matches:

```http
HTTP/1.1 412 Precondition Failed
Content-Type: application/problem+json
```

Alternative version fields MAY be used when the platform already standardizes them:

```json
{
  "id": "123",
  "version": 7
}
```

But the concurrency contract MUST be explicit.

The LLM MUST NOT implement blind overwrite for critical state transitions.

---

### REST-012: Non-idempotent POST MUST support idempotency when duplicate submission is dangerous

For endpoints that create payments, applications, submissions, workflow actions, emails, external requests, or irreversible side effects, the LLM MUST support idempotency.

Preferred request header:

```http
Idempotency-Key: 6f2a7e2d-5e1e-4d6a-9f0e-3d6f0e0f8b45
```

Rules:

- key scope MUST be documented;
- key retention period MUST be documented;
- same key with same payload MUST return same result or current result;
- same key with different payload MUST return conflict;
- idempotency storage MUST be atomic with side-effect execution or protected by transactional/outbox pattern;
- retries MUST be safe across network timeouts.

The LLM MUST NOT assume client retries are rare.

---

### REST-013: Model long-running operations explicitly

If work may exceed normal request latency, the LLM MUST NOT block indefinitely.

Use `202 Accepted` and a job/status resource.

Example:

```http
POST /reports/{reportId}/exports
```

Response:

```http
HTTP/1.1 202 Accepted
Location: /report-exports/exp_123
Retry-After: 10
```

Status resource:

```http
GET /report-exports/exp_123
```

Response:

```json
{
  "id": "exp_123",
  "status": "PROCESSING",
  "createdAt": "2026-06-10T09:00:00Z",
  "links": {
    "self": "/report-exports/exp_123"
  }
}
```

Terminal status MAY include result link:

```json
{
  "id": "exp_123",
  "status": "SUCCEEDED",
  "downloadUrl": "/report-exports/exp_123/file"
}
```

---

### REST-014: State transitions MUST be explicit and guarded

For workflow/state-machine APIs, the LLM MUST NOT update state as an arbitrary field unless the domain explicitly allows it.

Bad:

```http
PATCH /cases/123
{
  "status": "APPROVED"
}
```

Good:

```http
POST /cases/123/approval
{
  "decision": "APPROVED",
  "reason": "All checks passed."
}
```

State transition endpoints MUST define:

- allowed source states;
- resulting state;
- authorization requirement;
- validation requirement;
- audit behavior;
- idempotency behavior;
- conflict behavior;
- emitted events if any.

If direct `status` updates are allowed for administrative repair, they MUST be separate privileged endpoints and auditable.

---

### REST-015: Security MUST be part of API design, not middleware afterthought

The LLM MUST define security behavior for every endpoint.

For each endpoint, define:

- authentication requirement;
- authorization rule;
- tenant boundary if multi-tenant;
- ownership rule;
- sensitive fields;
- audit requirement;
- rate limit requirement;
- input size limits;
- output redaction rules.

Required security rules:

- secrets MUST NOT appear in URLs;
- access tokens MUST NOT be accepted in query parameters;
- PII MUST NOT be logged by default;
- authorization MUST be enforced server-side;
- list endpoints MUST filter by caller permission;
- object-level authorization MUST be checked for item endpoints;
- error messages MUST NOT reveal unauthorized resource existence unless intended;
- file downloads MUST validate caller access at download time.

Bad:

```http
GET /documents/123?token=secret
```

Good:

```http
GET /documents/123
Authorization: Bearer <token>
```

---

### REST-016: Backward compatibility MUST be preserved by default

The LLM MUST treat public API changes as contract changes.

Backward-compatible changes usually include:

- adding optional response fields;
- adding optional request fields;
- adding new endpoints;
- adding new enum values only when clients are designed to tolerate unknown values;
- adding new non-required filters;
- adding new error `type` values if generic handling exists.

Breaking changes include:

- removing fields;
- renaming fields;
- changing field type;
- making optional request field required;
- changing status code semantics;
- changing pagination contract;
- changing sorting default in a way that affects clients;
- changing identifier format without compatibility layer;
- removing enum values;
- adding enum values when clients treat enum as closed;
- changing authorization behavior that blocks existing valid clients;
- changing error response shape.

Breaking changes MUST require versioning, migration plan, or explicit approval.

---

### REST-017: Versioning MUST be intentional and minimal

The LLM MUST NOT create a new API version for every small additive change.

Version only when backward compatibility cannot be preserved.

Accepted versioning strategies:

```http
/api/v1/cases
```

Or media-type/profile based versioning when the platform already supports it.

This standard prefers URI major versioning for enterprise interoperability unless the architecture has an established alternative.

Rules:

- major version changes MAY break compatibility;
- minor/additive changes MUST not require new path version;
- version lifecycle MUST be documented;
- deprecation MUST be communicated before removal;
- old and new versions MUST not silently diverge in security behavior.

---

### REST-018: Deprecation and sunset MUST be explicit

When an endpoint, field, enum, or behavior is deprecated, the LLM MUST document:

- replacement;
- reason;
- first deprecated version/date;
- support window;
- removal date if known;
- migration steps.

Where applicable, responses SHOULD include deprecation-related headers such as:

```http
Deprecation: true
Sunset: Wed, 31 Dec 2026 23:59:59 GMT
Link: </docs/migration/v2>; rel="deprecation"
```

The LLM MUST NOT remove a public contract without a migration path unless the API is private and all clients are migrated atomically.

---

### REST-019: Use cache headers intentionally

For every `GET`, the LLM SHOULD decide whether the response is cacheable.

For cacheable responses, define:

```http
Cache-Control: public, max-age=300
ETag: "..."
```

For user-specific or sensitive responses:

```http
Cache-Control: private, no-store
```

Rules:

- do not rely on implicit default cache behavior;
- never cache sensitive data publicly;
- use `ETag` or `Last-Modified` where revalidation matters;
- document cache semantics for clients;
- ensure cache keys vary by authorization/tenant/language when relevant.

---

### REST-020: Correlation and observability MUST be standardized

The LLM MUST include a standard correlation mechanism for APIs.

Recommended request/response headers:

```http
X-Request-Id: <client-supplied-or-generated-id>
Traceparent: <w3c-trace-context>
```

Rules:

- generate request ID if missing;
- echo request ID in response;
- include trace/request ID in problem details;
- log request ID with service logs;
- do not expose internal stack traces;
- measure latency, status code, endpoint, and error type;
- avoid logging raw payloads by default.

---

### REST-021: Date, time, money, and identifiers MUST be unambiguous

The LLM MUST use explicit formats for ambiguous values.

Rules:

- timestamps MUST use ISO 8601 / RFC 3339 style strings with timezone, preferably UTC `Z`;
- date-only values MUST be documented as calendar dates, not timestamps;
- monetary values MUST use decimal-safe representation;
- currency MUST be explicit;
- identifiers SHOULD be strings in public APIs, even if stored as numbers internally;
- do not expose sequential IDs if enumeration risk matters;
- enum casing MUST be consistent.

Good:

```json
{
  "submittedAt": "2026-06-10T09:30:00Z",
  "effectiveDate": "2026-07-01",
  "amount": "1250.50",
  "currency": "SGD",
  "caseId": "case_01HX..."
}
```

---

### REST-022: PATCH semantics MUST be explicit

If `PATCH` is used, the LLM MUST specify the patch format.

Accepted formats:

```http
Content-Type: application/merge-patch+json
```

Or:

```http
Content-Type: application/json-patch+json
```

Custom partial update JSON MAY be used only if documented clearly.

Bad:

```json
{
  "name": null
}
```

Without defining whether `null` means "clear value", "ignore field", or "set null".

The LLM MUST define:

- omitted field behavior;
- explicit `null` behavior;
- validation behavior;
- concurrency behavior;
- authorization per field where relevant.

---

### REST-023: Bulk and batch APIs MUST define partial failure behavior

For bulk endpoints, the LLM MUST specify atomicity.

Patterns:

1. All-or-nothing transaction.
2. Partial success with per-item result.
3. Accepted async job with later result resource.

Bad:

```http
POST /cases/bulk-update
```

Without stating whether partial success is possible.

Good:

```json
{
  "results": [
    {
      "clientReferenceId": "row-1",
      "status": "SUCCEEDED",
      "resourceId": "case_123"
    },
    {
      "clientReferenceId": "row-2",
      "status": "FAILED",
      "error": {
        "type": "https://api.example.com/problems/validation-error",
        "title": "Validation failed",
        "status": 422
      }
    }
  ]
}
```

---

### REST-024: Search endpoints MUST be modeled intentionally

Simple search/filtering SHOULD use collection query parameters:

```http
GET /cases?status=OPEN&keyword=license
```

Complex search MAY use a search resource:

```http
POST /case-searches
```

Use POST search only when:

- query is too large for URL;
- query contains sensitive values that must not appear in logs/history;
- query structure is complex;
- search is asynchronous;
- search creates reusable search resource.

The LLM MUST NOT use `POST /search` as a default escape hatch.

---

### REST-025: File upload/download MUST be designed as resources

For file upload:

```http
POST /cases/{caseId}/documents
Content-Type: multipart/form-data
```

Or pre-signed upload flow:

```http
POST /document-upload-requests
```

For file download:

```http
GET /documents/{documentId}/content
```

Rules:

- validate file type, size, and malware scanning status;
- never trust client file extension;
- separate metadata resource from binary content when useful;
- document retention and access control;
- support range requests for large files when required;
- define `Content-Disposition` behavior.

---

### REST-026: APIs MUST be documented contract-first or contract-synchronized

The LLM MUST create or update OpenAPI documentation when changing API behavior.

Every endpoint change MUST update:

- path;
- method;
- parameters;
- request body;
- response bodies;
- status codes;
- error responses;
- security requirements;
- examples;
- deprecation markers;
- schema constraints.

The implementation and OpenAPI contract MUST not diverge.

---

### REST-027: Rate limiting and quotas MUST be explicit when relevant

For public, partner, multi-tenant, or abuse-sensitive APIs, the LLM MUST define rate limits.

Recommended headers:

```http
RateLimit-Limit: 100
RateLimit-Remaining: 42
RateLimit-Reset: 60
Retry-After: 60
```

`429 Too Many Requests` MUST use Problem Details.

Rate limits MUST be scoped clearly:

- per user;
- per tenant;
- per client application;
- per IP;
- per endpoint;
- global service limit.

---

### REST-028: Never leak transport or infrastructure internals

The LLM MUST NOT expose internal implementation details in the API contract.

Forbidden unless explicitly required:

- database IDs that encode table semantics;
- service hostnames;
- pod names;
- internal queue/topic names;
- Java package/class names;
- stack traces;
- ORM lazy-loading artifacts;
- internal enum names not meaningful to clients;
- cloud provider resource names;
- raw upstream error responses.

---

## 5. Request and Response Shape Standards

### 5.1 JSON naming

Default JSON field naming MUST be `camelCase` unless the existing API standard uses another style.

Good:

```json
{
  "caseId": "case_123",
  "createdAt": "2026-06-10T09:30:00Z"
}
```

Bad:

```json
{
  "case_id": "case_123",
  "created_at": "2026-06-10T09:30:00Z"
}
```

Unless the platform standard is snake_case.

The LLM MUST NOT mix casing styles in the same API surface.

### 5.2 Envelope usage

The LLM MUST use response envelopes consistently.

For item responses, either direct resource:

```json
{
  "id": "case_123",
  "status": "OPEN"
}
```

Or enveloped resource:

```json
{
  "data": {
    "id": "case_123",
    "status": "OPEN"
  }
}
```

Do not mix styles randomly.

Collection responses SHOULD be enveloped to include pagination metadata:

```json
{
  "items": [],
  "nextPageToken": null,
  "limit": 50
}
```

### 5.3 Empty values

The LLM MUST distinguish:

- missing field;
- explicit `null`;
- empty string;
- empty array;
- empty object.

The contract MUST define which are allowed.

### 5.4 Boolean fields

Boolean fields SHOULD be positively named.

Good:

```json
{
  "active": true,
  "archived": false
}
```

Bad:

```json
{
  "notInactive": true,
  "disableFlag": "N"
}
```

### 5.5 Enum fields

Enums MUST be documented.

Recommended casing: upper snake case for machine states.

```json
{
  "status": "PENDING_REVIEW"
}
```

The LLM MUST decide whether enum values are open or closed for client compatibility.

---

## 6. Authorization and Error Disclosure Matrix

The LLM MUST decide not-found vs forbidden behavior intentionally.

| Situation                                                  | Recommended response | Reason                      |
| ---------------------------------------------------------- | -------------------: | --------------------------- |
| caller unauthenticated                                     |                `401` | needs authentication        |
| caller authenticated but lacks global permission           |                `403` | permission denied           |
| caller cannot know whether resource exists                 |                `404` | avoid enumeration           |
| resource exists but operation not allowed in current state |                `409` | state conflict              |
| caller provided stale version                              |                `412` | precondition failed         |
| request violates validation rule                           |                `422` | semantic validation failure |
| malformed JSON                                             |                `400` | syntactic failure           |

The LLM MUST NOT choose these randomly.

---

## 7. Anti-Patterns

The LLM MUST reject or refactor these patterns.

### 7.1 RPC disguised as REST

```http
POST /caseService/approveCase
POST /applicationManager/reject
POST /userController/getList
```

### 7.2 Success status with failure payload

```http
HTTP/1.1 200 OK
{
  "error": "Unauthorized"
}
```

### 7.3 Unbounded collection

```http
GET /audit-logs
```

Returning all historical logs.

### 7.4 Blind state overwrite

```http
PATCH /cases/123
{
  "status": "CLOSED"
}
```

Without transition validation, authorization, audit, or concurrency guard.

### 7.5 Leaking persistence model

```json
{
  "CASE_ID_PK": 1,
  "CASE_STATUS_CD": "P",
  "UPD_TS": "..."
}
```

### 7.6 Inconsistent error shapes

```json
{"message":"bad"}
{"error":"bad"}
{"errors":["bad"]}
{"success":false,"reason":"bad"}
```

Across the same API.

### 7.7 Endpoint version chaos

```http
/v1/cases
/v1.1/cases
/cases/v2
/cases?apiVersion=3
```

Without clear strategy.

### 7.8 Exposing secrets in URLs

```http
GET /download?access_token=...
```

### 7.9 Silent behavior changes

Changing filter defaults, sort defaults, enum behavior, or authorization rules without versioning or migration plan.

---

## 8. LLM API Design Algorithm

Before implementing any API endpoint, the LLM MUST perform this reasoning sequence:

```text
1. Identify the client use case.
2. Identify the domain resource or command resource.
3. Decide whether this is read, create, replace, partial update, delete, command, search, bulk, file, or async job.
4. Select URI based on resource identity.
5. Select HTTP method based on semantics.
6. Define request schema.
7. Define response schema.
8. Define success status codes.
9. Define error status codes using Problem Details.
10. Define authentication and authorization.
11. Define pagination/filtering/sorting if collection.
12. Define concurrency control if mutable critical state.
13. Define idempotency if duplicate side effects matter.
14. Define observability headers and trace behavior.
15. Define cache behavior.
16. Update OpenAPI contract.
17. Add tests for contract, validation, authorization, and error behavior.
```

The LLM MUST NOT jump directly from feature request to controller method.

---

## 9. REST Review Checklist

A RESTful API change is acceptable only if all relevant checks pass.

### Resource and URI

- [ ] Resource names are nouns.
- [ ] Collections use plural names.
- [ ] URI hierarchy is stable and not overly deep.
- [ ] No internal implementation details leak into paths.
- [ ] Action endpoints are modeled as command resources when needed.

### HTTP Semantics

- [ ] Methods match safe/idempotent semantics.
- [ ] `GET` has no state-changing behavior.
- [ ] Status codes reflect actual outcomes.
- [ ] `201` includes `Location` where possible.
- [ ] `202` uses status resource for long-running work.
- [ ] `405` includes `Allow` when relevant.

### Request/Response Contract

- [ ] DTOs are separate from persistence models.
- [ ] JSON naming is consistent.
- [ ] Required/optional/null behavior is defined.
- [ ] Dates/times/identifiers/money are unambiguous.
- [ ] Enum behavior is documented.

### Errors

- [ ] Error responses use Problem Details.
- [ ] Validation errors include field details.
- [ ] Sensitive internals are not exposed.
- [ ] Error status codes are consistent.

### Collections

- [ ] Unbounded lists are forbidden.
- [ ] Pagination exists for growing collections.
- [ ] Filters are whitelisted.
- [ ] Sorting is deterministic.
- [ ] Authorization applies before/while filtering.

### Mutation Safety

- [ ] Critical updates have concurrency protection.
- [ ] Dangerous POST operations support idempotency.
- [ ] State transitions are guarded and audited.
- [ ] Bulk APIs define partial failure behavior.

### Security and Operations

- [ ] Authentication is defined.
- [ ] Authorization is object-level where needed.
- [ ] Rate limiting is defined where needed.
- [ ] Sensitive data is not placed in URLs/logs.
- [ ] Cache behavior is explicit.
- [ ] Request ID/trace ID behavior exists.

### Compatibility

- [ ] No accidental breaking change.
- [ ] Versioning strategy is followed.
- [ ] Deprecated behavior has migration path.
- [ ] OpenAPI is updated.

---

## 10. Test Requirements

The LLM MUST create or update tests for API behavior.

Required tests where applicable:

- happy path per endpoint;
- validation failure;
- malformed JSON;
- unsupported media type;
- unauthorized request;
- forbidden request;
- not found;
- state conflict;
- stale version/precondition failure;
- idempotency replay;
- pagination next token;
- unsupported filter/sort;
- rate limit behavior;
- problem details shape;
- OpenAPI contract conformance.

For public APIs, contract tests SHOULD verify implementation against OpenAPI.

---

## 11. LLM Refactoring Rules

When modifying existing APIs, the LLM MUST preserve compatibility unless explicitly instructed otherwise.

The LLM MUST NOT:

- rename fields casually;
- remove old endpoints without migration;
- change status codes without checking clients;
- change enum casing;
- replace response shape globally;
- change pagination format;
- change authentication method;
- change authorization semantics without explicit approval;
- introduce new mandatory fields to existing requests;
- reorder state machine behavior without audit.

The LLM MAY add:

- optional response fields;
- new endpoints;
- new optional request fields;
- new documented error types;
- stronger validation only if invalid inputs were never contractually allowed or migration is planned.

---

## 12. Acceptance Criteria

An API implementation satisfies this standard only if:

1. Endpoints are resource-oriented.
2. HTTP methods and status codes follow HTTP semantics.
3. Public request/response DTOs are explicit and stable.
4. Errors use a standardized machine-readable format.
5. Collections are paginated and filtered safely.
6. Mutations define concurrency, idempotency, and state transition behavior where relevant.
7. Security and authorization are designed per endpoint.
8. Backward compatibility is preserved or versioned intentionally.
9. OpenAPI documentation is synchronized with implementation.
10. Tests prove contract behavior, not only controller reachability.

---

## 13. References

- Roy Fielding, REST architectural style: `https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm`
- RFC 9110, HTTP Semantics: `https://www.rfc-editor.org/rfc/rfc9110.html`
- RFC 9457, Problem Details for HTTP APIs: `https://www.rfc-editor.org/rfc/rfc9457.html`
- OpenAPI Specification: `https://spec.openapis.org/oas/latest.html`
- Microsoft REST API Guidelines: `https://github.com/microsoft/api-guidelines`
- Google AIP-121 Resource-oriented design: `https://google.aip.dev/121`
- Zalando RESTful API Guidelines: `https://opensource.zalando.com/restful-api-guidelines/`
