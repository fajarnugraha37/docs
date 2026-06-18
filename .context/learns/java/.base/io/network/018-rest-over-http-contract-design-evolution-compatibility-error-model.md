# Part 18 — REST Over HTTP: Contract Design, Evolution, Compatibility, and Error Model

> Series: `learn-java-io-network-http-grpc-protocol-engineering`  
> File: `018-rest-over-http-contract-design-evolution-compatibility-error-model.md`  
> Scope: Java 8–25, HTTP APIs, REST-ish systems, service-to-service APIs, regulatory/case-management platforms  
> Prerequisites: Part 7 HTTP semantics, Part 8 HTTP/1.1, Part 9 HTTP/2, Part 13 timeout engineering, Part 14 retry/idempotency

---

## 0. Why This Part Exists

Many engineers say they build REST APIs, but what they actually build is often this:

```text
POST /doSomething
POST /getSomething
POST /updateSomething
200 OK
{
  "success": false,
  "errorCode": "INVALID_INPUT"
}
```

That can work inside a small controlled system, but it breaks down when the API becomes a long-lived contract across teams, platforms, agencies, vendors, batch jobs, mobile apps, frontend SPAs, integration gateways, audit workflows, and external consumers.

This part is not about repeating JAX-RS, Spring MVC, controllers, annotations, DTO mapping, or JSON basics. You already covered those elsewhere. This part is about designing HTTP API contracts that remain understandable, observable, evolvable, retry-safe, and defensible under production and regulatory constraints.

The central idea:

```text
REST over HTTP is not mainly about URL style.
It is about making state, representation, transition, failure, and compatibility explicit through HTTP semantics.
```

A top-tier Java engineer does not ask only:

```text
How do I expose this method as an endpoint?
```

They ask:

```text
What resource or workflow state is being represented?
What operation semantics does the HTTP method communicate?
Can this request be retried safely?
What status code tells intermediaries and clients the truth?
What is the stable error contract?
What happens when the client is older than the server?
What happens when the server is older than the client?
How do we evolve the API without breaking consumers?
How do we audit state transitions and explain them later?
```

---

## 1. Learning Outcomes

After this part, you should be able to:

1. distinguish resource-oriented endpoints from command/workflow endpoints without forcing everything into fake CRUD;
2. design stable URI structures around domain identity, not controller methods;
3. use HTTP methods based on semantics: safe, idempotent, cacheable, and side-effect boundaries;
4. choose status codes that preserve retry behavior, observability, and consumer reasoning;
5. design pagination, filtering, sorting, and field selection without accidental performance or compatibility traps;
6. design `PUT`, `PATCH`, and command endpoints safely;
7. use optimistic concurrency with `ETag`, `If-Match`, versions, and conflict semantics;
8. design machine-readable error responses using Problem Details concepts;
9. separate technical errors, validation errors, domain errors, authorization errors, and dependency failures;
10. evolve request/response schemas without breaking old consumers;
11. design deprecation and sunset strategy for long-lived APIs;
12. build Java server/client patterns that preserve HTTP semantics instead of hiding them behind generic wrappers.

---

## 2. Mental Model: HTTP API as a Long-Lived Contract

A REST-ish HTTP API has at least five contracts:

```text
1. Identity contract
   Which things exist and how are they addressed?

2. Representation contract
   What shape is returned or accepted?

3. Operation contract
   What does a method on a resource mean?

4. Failure contract
   How does the server communicate invalid, impossible, unauthorized, conflicting, delayed, or failed outcomes?

5. Evolution contract
   How can server and consumers change independently?
```

Most bad APIs fail because they treat the endpoint as a remote function call:

```text
Controller method -> route -> JSON body -> response JSON
```

A better model:

```text
Resource identity
+ representation
+ method semantics
+ conditional constraints
+ error semantics
+ compatibility rules
+ observability fields
= durable API contract
```

### 2.1 The difference between API behavior and API contract

Behavior is what your current implementation happens to do.

Contract is what consumers can rely on.

Example:

```http
GET /cases/CASE-123
```

Implementation detail:

```text
The service queries Oracle, joins five tables, fetches documents from S3, checks access rights, and maps to JSON.
```

Contract:

```text
If the caller is authorized and the case exists, the endpoint returns the current representation of case CASE-123.
If the case does not exist, it returns 404.
If the caller is not allowed to know whether it exists, it may return 404 or 403 depending on security policy.
If the representation has not changed since the client's validator, it can return 304.
```

Top-tier API design means being very clear about which parts are observable contract and which parts are private implementation.

---

## 3. REST Is Not CRUD

CRUD is a persistence model:

```text
Create
Read
Update
Delete
```

REST is an interaction model around resources and representations.

That distinction matters because real systems are not just tables:

```text
case assignment
appeal submission
screening decision
document upload
officer recommendation
manager approval
compliance escalation
case closure
case reopening
email notification
payment initiation
audit event
batch import
```

Forcing all of these into CRUD often creates misleading APIs:

```http
PUT /cases/123/status
{"status":"APPROVED"}
```

This hides important business meaning:

```text
Who approved?
Based on which recommendation?
Was this transition allowed?
Was an approval record created?
Was notification sent?
Can approval be retried?
What if another officer changed the case concurrently?
What is the audit event?
```

A better API might model the transition explicitly:

```http
POST /cases/123/approval-decisions
Idempotency-Key: 9f48d4...
Content-Type: application/json

{
  "decision": "APPROVE",
  "reasonCode": "REQUIREMENTS_MET",
  "remarks": "All mandatory checks completed.",
  "basedOnVersion": 17
}
```

Response:

```http
201 Created
Location: /cases/123/approval-decisions/DEC-789
Content-Type: application/json

{
  "decisionId": "DEC-789",
  "caseId": "123",
  "decision": "APPROVE",
  "effectiveCaseStatus": "APPROVED",
  "recordedAt": "2026-06-18T10:15:30Z",
  "recordedBy": "officer-42"
}
```

This is still REST over HTTP. It models the approval decision as a resource/event rather than pretending a workflow transition is just a field update.

---

## 4. Resource, Representation, and State

A resource is a conceptual target of a link.

A representation is a current or selected view of that resource.

Domain state is the actual business state stored and enforced by the system.

They are related, but not identical.

```text
Resource:
  /cases/123

Representation:
  JSON summary of case 123 returned to this caller

Domain state:
  rows/events/documents/tasks/permissions that define case 123 internally
```

### 4.1 A representation is not your entity class

Avoid exposing persistence models directly:

```java
@Entity
class CaseEntity {
    @OneToMany(fetch = FetchType.LAZY)
    private List<InternalAuditRecord> auditRecords;

    private String internalRoutingCode;
    private String migratedLegacyFlag;
}
```

Bad:

```text
Entity -> JSON -> public API
```

Better:

```text
Entity / domain aggregate / read model
-> representation assembler
-> API DTO
-> explicit contract
```

Why?

Because persistence models change for internal reasons:

```text
normalization
denormalization
migration
indexing
LOB separation
archival
partitioning
performance tuning
security redaction
```

External contracts should change only for product/domain reasons.

### 4.2 One resource can have multiple representations

Example:

```http
GET /cases/123
Accept: application/json
```

Could return a full case detail.

```http
GET /cases/123/summary
```

Could return a smaller summary.

```http
GET /cases/123/documents
```

Could return document metadata.

```http
GET /cases/123/audit-events
```

Could return an audit timeline.

Do not overload a single endpoint with uncontrolled boolean flags:

```http
GET /cases/123?includeEverything=true&includeDocuments=true&includeAudit=true&includeInternalFields=true
```

That usually becomes an unbounded performance and authorization problem.

---

## 5. URI Design: Identity, Not Implementation

URIs should identify resources, not expose controller names, Java methods, database tables, or implementation layers.

Bad:

```http
POST /caseController/getCaseById
POST /applicationManagementService/findAllApplications
GET /tbl_case_header/123
POST /executeCaseApprovalWorkflow
```

Better:

```http
GET /cases/123
GET /applications?status=PENDING_REVIEW
POST /cases/123/approval-decisions
GET /officers/42/assigned-cases
```

### 5.1 URI stability matters

URIs are not just routing keys. They appear in:

```text
frontend code
mobile apps
integration clients
logs
audit records
documentation
monitoring dashboards
saved links
emails
third-party systems
contract tests
```

Changing URI structure is expensive.

Therefore, design URIs around durable domain concepts.

### 5.2 Nested resources: use with restraint

Nested resources are useful when the child identity is naturally scoped by the parent:

```http
GET /cases/123/documents/DOC-9
GET /cases/123/tasks/TASK-7
```

But avoid deeply nested routes:

```http
GET /agencies/1/departments/2/teams/3/officers/4/cases/5/documents/6/versions/7
```

Deep nesting makes authorization, caching, routing, and client usage harder.

A useful rule:

```text
Use nesting when it clarifies ownership or containment.
Stop nesting when it merely repeats navigational paths.
```

Often this is better:

```http
GET /document-versions/7
```

with links/fields:

```json
{
  "documentVersionId": "7",
  "documentId": "6",
  "caseId": "5"
}
```

---

## 6. Method Semantics: Do Not Lie to HTTP

HTTP method choice should communicate operational semantics.

From RFC 9110, HTTP separates resource identification from request semantics; methods carry the semantics that resources must not contradict.

### 6.1 Safe methods

Safe means the client does not request a state change.

```text
GET
HEAD
OPTIONS
TRACE
```

Safe does not mean nothing happens internally. Logging, metrics, cache refresh, or audit-read events may occur. But the client is not asking for a business state transition.

Bad:

```http
GET /cases/123/approve
```

Why bad?

```text
Browsers, crawlers, prefetchers, proxies, caches, and monitoring tools may call GET.
A GET that changes business state violates expectations and creates serious risk.
```

### 6.2 Idempotent methods

Idempotent means repeating the same request has the same intended effect as sending it once.

Usually idempotent:

```text
GET
HEAD
PUT
DELETE
OPTIONS
TRACE
```

Usually not inherently idempotent:

```text
POST
PATCH
```

But POST can be made idempotent with an idempotency key.

Example:

```http
POST /payments
Idempotency-Key: client-unique-key-123
```

The idempotency key tells the server:

```text
If this exact logical operation was already accepted, return the prior outcome instead of creating another payment.
```

### 6.3 Cacheable methods

Cacheability is not just CDN optimization. It is part of consistency and latency design.

Usually cacheable if response headers allow it:

```text
GET
HEAD
sometimes POST, but rarely used that way in APIs
```

For internal enterprise APIs, explicit `Cache-Control` still matters because intermediary behavior, browser behavior, and client libraries may preserve or reuse responses in ways you did not expect.

Sensitive endpoint default:

```http
Cache-Control: no-store
```

Stable reference data:

```http
Cache-Control: max-age=300
ETag: "postal-code-dictionary-v42"
```

---

## 7. Choosing Between GET, POST, PUT, PATCH, DELETE

### 7.1 GET

Use for retrieval.

```http
GET /cases/123
GET /cases?status=PENDING_REVIEW&assignedTo=officer-42
```

GET request bodies are a bad idea for public contracts. Even if some stacks allow them, many intermediaries, caches, libraries, and tools do not handle them consistently.

For complex search, consider:

```http
GET /cases?status=PENDING_REVIEW&from=2026-01-01&to=2026-06-30
```

or, if query is too complex:

```http
POST /case-searches
Content-Type: application/json

{
  "filters": {...},
  "sort": [...],
  "pageSize": 50
}
```

Then either return results directly or create a search resource:

```http
201 Created
Location: /case-searches/SRCH-123
```

### 7.2 POST

Use POST when the server decides the new resource identity or when the operation is command-like.

Create subordinate resource:

```http
POST /cases/123/comments
```

Execute workflow command:

```http
POST /cases/123/escalations
```

Start asynchronous job:

```http
POST /reports/generation-jobs
```

POST is not bad. Misusing POST for everything is bad.

### 7.3 PUT

Use PUT when the client replaces the representation of a known resource URI.

```http
PUT /user-preferences/42/notification-settings
Content-Type: application/json

{
  "emailEnabled": true,
  "smsEnabled": false
}
```

PUT should be full replacement at that resource boundary.

Danger:

```http
PUT /cases/123
{
  "remarks": "new remark"
}
```

If this is partial update but your contract says PUT, consumers may accidentally delete unspecified fields depending on implementation.

### 7.4 PATCH

Use PATCH for partial modification.

Common options:

```text
JSON Patch: application/json-patch+json
JSON Merge Patch: application/merge-patch+json
Custom domain patch document
```

Example JSON Merge Patch style:

```http
PATCH /cases/123/contact-details
Content-Type: application/merge-patch+json
If-Match: "case-contact-v7"

{
  "phoneNumber": "+65..."
}
```

PATCH is powerful but dangerous if patch semantics are unclear.

Always define:

```text
Does null mean clear field or ignored field?
Can arrays be partially modified?
Are unknown fields rejected or ignored?
Is this patch idempotent?
Is concurrency required through If-Match/version?
```

### 7.5 DELETE

Use DELETE to remove or deactivate a resource depending on your domain contract.

For regulatory systems, physical deletion is often not allowed. DELETE can mean:

```text
cancel draft
withdraw pending request
mark document as removed from active view
revoke token
close session
```

Be explicit:

```http
DELETE /draft-applications/DRAFT-123
```

Response:

```http
204 No Content
```

If the system keeps audit history internally, that does not violate DELETE. The external resource can be removed from active representation while audit records remain.

---

## 8. Status Code Design

Status codes are not decoration. They drive client behavior, retries, monitoring, dashboards, and incident triage.

### 8.1 Avoid always-200

Bad:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "success": false,
  "errorCode": "CASE_NOT_FOUND"
}
```

Why bad?

```text
Load balancers see success.
Monitoring sees success.
Client retry policy sees success.
HTTP cache semantics are wrong.
Intermediaries cannot reason about the response.
API consumers must parse every body before knowing outcome class.
```

Better:

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{
  "type": "https://api.example.gov/problems/case-not-found",
  "title": "Case not found",
  "status": 404,
  "detail": "No case exists with the provided identifier.",
  "instance": "/problems/req-20260618-abc123",
  "code": "CASE_NOT_FOUND",
  "correlationId": "req-20260618-abc123"
}
```

### 8.2 Common 2xx codes

#### 200 OK

Use when the request succeeded and the response contains a representation.

```http
GET /cases/123
200 OK
```

#### 201 Created

Use when a new resource was created.

```http
POST /cases
201 Created
Location: /cases/123
```

#### 202 Accepted

Use when request was accepted but not completed.

```http
POST /reports/generation-jobs
202 Accepted
Location: /reports/generation-jobs/JOB-123
Retry-After: 10
```

A `202` response should usually include a way to observe progress.

#### 204 No Content

Use when success has no response body.

```http
DELETE /drafts/DRAFT-123
204 No Content
```

Do not return a body with 204.

### 8.3 Common 3xx codes

Use redirects deliberately. For APIs, redirects can be dangerous when credentials or non-idempotent methods are involved.

Important distinction:

```text
301/302 historically may change method behavior in clients.
307/308 preserve method semantics.
```

For API relocation, prefer explicit versioning/deprecation communication over surprise redirect unless consumers are known to handle it.

### 8.4 Common 4xx codes

#### 400 Bad Request

Malformed syntax, invalid JSON, invalid query parameter shape.

```text
The server cannot understand the request as a valid request.
```

#### 401 Unauthorized

Authentication is missing, invalid, or expired.

Despite the name, 401 is about authentication.

#### 403 Forbidden

Caller is authenticated but not allowed.

#### 404 Not Found

Resource does not exist or is intentionally hidden.

Security-sensitive APIs may return 404 instead of 403 to avoid resource enumeration. This must be a deliberate policy.

#### 409 Conflict

Request conflicts with current resource state.

Example:

```text
Trying to approve a case that is already closed.
Trying to submit an appeal outside allowed workflow state.
```

#### 412 Precondition Failed

A conditional header such as `If-Match` failed.

Example:

```http
PATCH /cases/123
If-Match: "case-v17"
```

Server current version is `case-v18`, so return:

```http
412 Precondition Failed
```

Use this for optimistic concurrency based on HTTP preconditions.

#### 415 Unsupported Media Type

Request `Content-Type` is unsupported.

#### 422 Unprocessable Content

The request syntax is valid, but semantically invalid.

Example:

```text
Application date is after expiry date.
Postal code format is valid but not accepted for this workflow.
Required business declaration is missing.
```

#### 429 Too Many Requests

Rate limit exceeded.

Should often include:

```http
Retry-After: 30
```

### 8.5 Common 5xx codes

#### 500 Internal Server Error

Unexpected server failure.

Do not use 500 for normal domain validation.

#### 502 Bad Gateway

Gateway/proxy received invalid response from upstream.

#### 503 Service Unavailable

Service temporarily unavailable or overloaded.

Can include:

```http
Retry-After: 60
```

#### 504 Gateway Timeout

Gateway/proxy did not receive timely upstream response.

Important: a 504 does not prove the upstream operation did not happen. It only means the gateway did not observe a timely response.

This matters for retry and idempotency.

---

## 9. Error Model: From Message Strings to Machine-Readable Problems

A serious API needs a stable error model.

Bad:

```json
{
  "message": "Something went wrong"
}
```

Slightly better but still weak:

```json
{
  "error": "Validation failed"
}
```

Better:

```json
{
  "type": "https://api.example.gov/problems/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "One or more fields are invalid.",
  "instance": "/problems/req-01HZ...",
  "code": "VALIDATION_FAILED",
  "correlationId": "01HZ...",
  "violations": [
    {
      "field": "applicant.postalCode",
      "code": "INVALID_POSTAL_CODE",
      "message": "Postal code must contain six digits."
    }
  ]
}
```

RFC 9457 defines Problem Details for HTTP APIs as a common format for machine-readable error details and obsoletes RFC 7807.

### 9.1 Error fields

Recommended baseline:

```text
type
  Stable URI identifying the problem type.

title
  Human-readable summary, stable enough for documentation.

status
  HTTP status code.

detail
  Human-readable instance-specific explanation.

instance
  URI/reference identifying this specific occurrence.

code
  Your stable internal/business error code.

correlationId
  Trace or request correlation identifier.

violations
  Optional field-level or rule-level validation errors.
```

### 9.2 Stable code vs message

Do not make clients depend on human messages.

Bad client logic:

```java
if (error.getMessage().contains("already approved")) {
    // ...
}
```

Better:

```java
switch (error.code()) {
    case "CASE_ALREADY_APPROVED" -> ...;
    case "CASE_VERSION_CONFLICT" -> ...;
}
```

Human messages can change. Error codes should be stable.

### 9.3 Do not leak internals

Bad:

```json
{
  "message": "ORA-01653: unable to extend table ACEAS.AUDIT_TRAIL by 8192 in tablespace USERS"
}
```

Better external response:

```http
503 Service Unavailable
Content-Type: application/problem+json

{
  "type": "https://api.example.gov/problems/temporary-service-unavailable",
  "title": "Temporary service unavailable",
  "status": 503,
  "detail": "The service is temporarily unable to complete the request.",
  "code": "TEMPORARY_SERVICE_UNAVAILABLE",
  "correlationId": "01HZ..."
}
```

Internal logs can contain the Oracle error with access controls and redaction.

---

## 10. Domain Error Taxonomy

Separate errors by meaning.

```text
Syntax error
  Invalid JSON, bad query parameter syntax.
  Usually 400.

Authentication error
  Missing/expired/invalid token.
  Usually 401.

Authorization error
  Authenticated but not permitted.
  Usually 403 or hidden as 404.

Not found
  Target resource does not exist or is hidden.
  Usually 404.

Validation error
  Request is structurally valid but violates input rules.
  Usually 422.

Workflow conflict
  Request cannot be applied because current state changed or disallows transition.
  Usually 409.

Concurrency conflict
  Client's version/precondition is stale.
  Usually 412 if using If-Match; sometimes 409 with explicit version field.

Rate limit
  Caller exceeded quota.
  Usually 429.

Dependency unavailable
  Downstream service/database/external API unavailable.
  Usually 503 or 502 depending on gateway role.

Timeout
  Server/gateway did not complete in time.
  Usually 504 at gateway, sometimes 503/500 at service depending on boundary.
```

### 10.1 Why taxonomy matters

Because different errors imply different client actions:

| Error type | Client action |
|---|---|
| 400 | Fix request construction. Do not retry as-is. |
| 401 | Refresh credentials or reauthenticate. |
| 403 | Do not retry unless permissions changed. |
| 404 | Stop or refresh list/index. |
| 409 | Refresh resource state and decide next action. |
| 412 | Reload latest version and reapply change. |
| 422 | Show validation/domain error to user. |
| 429 | Retry later according to policy. |
| 503 | Retry with backoff if operation is safe/idempotent. |
| 504 | Unknown operation outcome; retry only with idempotency or reconciliation. |

---

## 11. Optimistic Concurrency: ETag, If-Match, Version Fields

Concurrent updates are normal in case-management systems.

Example scenario:

```text
Officer A opens case version 17.
Officer B updates assignment, creating version 18.
Officer A submits approval based on version 17.
```

The server must not blindly apply Officer A's update if the business decision depends on stale state.

### 11.1 ETag model

Response:

```http
GET /cases/123
200 OK
ETag: "case-123-v17"
Content-Type: application/json

{
  "caseId": "123",
  "status": "PENDING_APPROVAL",
  "version": 17
}
```

Update:

```http
PATCH /cases/123
If-Match: "case-123-v17"
Content-Type: application/merge-patch+json

{
  "priority": "HIGH"
}
```

If current version is still 17:

```http
200 OK
ETag: "case-123-v18"
```

If current version is already 18:

```http
412 Precondition Failed
Content-Type: application/problem+json

{
  "type": "https://api.example.gov/problems/precondition-failed",
  "title": "Resource version is stale",
  "status": 412,
  "code": "RESOURCE_VERSION_STALE",
  "currentVersion": 18,
  "correlationId": "01HZ..."
}
```

### 11.2 Version field alternative

Some APIs put version in body:

```json
{
  "basedOnVersion": 17,
  "decision": "APPROVE"
}
```

This is acceptable for command resources, especially when the command is not a direct representation update.

Example:

```http
POST /cases/123/approval-decisions
Idempotency-Key: abc

{
  "decision": "APPROVE",
  "basedOnCaseVersion": 17
}
```

Conflict response:

```http
409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.gov/problems/case-state-conflict",
  "title": "Case state changed",
  "status": 409,
  "code": "CASE_STATE_CHANGED",
  "expectedVersion": 17,
  "actualVersion": 18
}
```

### 11.3 ETag is not always a database version

ETag can represent:

```text
row version
aggregate version
hash of representation
last modified timestamp
composite version over multiple tables
```

For strong concurrency control, avoid weak validators.

A representation hash can be expensive and may expose subtle consistency issues if representation contains caller-specific redaction.

---

## 12. Pagination, Filtering, Sorting, and Search

List endpoints are often the source of performance incidents.

Bad:

```http
GET /cases
```

returning everything.

Better:

```http
GET /cases?status=PENDING_REVIEW&pageSize=50&pageToken=eyJvZmZzZXQi...
```

### 12.1 Offset pagination

```http
GET /cases?offset=1000&limit=50
```

Simple but can be slow and inconsistent for changing datasets.

Problems:

```text
large offset cost
duplicate/missing rows when data changes
unstable ordering
hard to scale with deep pages
```

### 12.2 Cursor/keyset pagination

```http
GET /cases?pageSize=50&pageToken=opaque-token
```

Better for large datasets.

Token can encode:

```text
last seen sort key
filter hash
direction
snapshot marker if supported
```

Make page token opaque. Do not make clients construct it.

### 12.3 Stable ordering

Always define deterministic ordering.

Bad:

```sql
SELECT * FROM cases WHERE status = 'PENDING'
```

No order means pages are unstable.

Better:

```text
ORDER BY createdAt DESC, caseId DESC
```

API:

```http
GET /cases?status=PENDING&sort=-createdAt,-caseId&pageSize=50
```

### 12.4 Filtering safety

Do not expose arbitrary SQL-like filters unless you are building a dedicated query product.

Dangerous:

```http
GET /cases?where=status='PENDING' OR 1=1
```

Prefer a controlled filter grammar:

```http
GET /cases?status=PENDING&assignedTo=officer-42&createdFrom=2026-01-01&createdTo=2026-06-30
```

For advanced search, use a dedicated search endpoint with strict schema:

```http
POST /case-searches
Content-Type: application/json

{
  "filters": {
    "status": ["PENDING_REVIEW", "PENDING_APPROVAL"],
    "assignedTo": "officer-42",
    "createdAt": {
      "from": "2026-01-01T00:00:00Z",
      "to": "2026-06-30T23:59:59Z"
    }
  },
  "sort": [
    {"field": "createdAt", "direction": "DESC"},
    {"field": "caseId", "direction": "DESC"}
  ],
  "pageSize": 50
}
```

### 12.5 Total count trap

Returning total count can be expensive.

```json
{
  "items": [...],
  "total": 123456789
}
```

Ask:

```text
Does the UI really need exact total?
Can it use hasNextPage?
Can total be approximate?
Can count be computed asynchronously?
```

Better for many systems:

```json
{
  "items": [...],
  "nextPageToken": "...",
  "hasNextPage": true
}
```

---

## 13. Field Selection and Sparse Responses

Large representations can waste CPU, memory, DB time, and network bandwidth.

Approaches:

### 13.1 Separate resources

```http
GET /cases/123
GET /cases/123/documents
GET /cases/123/audit-events
```

This is often cleaner than a giant expandable endpoint.

### 13.2 Include parameter

```http
GET /cases/123?include=documents,latestDecision
```

Use carefully. Define allowed values.

Avoid recursive includes:

```http
GET /cases/123?include=documents.versions.createdBy.department.agency...
```

### 13.3 Fields parameter

```http
GET /cases/123?fields=caseId,status,assignedOfficer,dueDate
```

Useful but can complicate cache keys, DTO mapping, and authorization. For top-tier systems, field selection must be integrated with:

```text
access control
redaction
query planning
cache Vary semantics
observability
contract documentation
```

---

## 14. Resource Modeling Patterns

### 14.1 Collection resource

```http
GET /cases
POST /cases
```

### 14.2 Item resource

```http
GET /cases/123
PATCH /cases/123
DELETE /cases/123
```

### 14.3 Sub-resource

```http
GET /cases/123/documents
POST /cases/123/documents
```

### 14.4 Action-as-resource / command resource

Workflow actions often deserve their own resource.

```http
POST /cases/123/escalations
POST /cases/123/approval-decisions
POST /cases/123/withdrawal-requests
POST /cases/123/reopen-requests
```

This is better than:

```http
POST /cases/123/actions/approve
```

because it creates a durable business artifact:

```text
approval decision
escalation record
withdrawal request
reopen request
```

### 14.5 Job resource

For long-running operations:

```http
POST /reports/generation-jobs
202 Accepted
Location: /reports/generation-jobs/JOB-123
```

Then:

```http
GET /reports/generation-jobs/JOB-123
```

Response:

```json
{
  "jobId": "JOB-123",
  "status": "RUNNING",
  "submittedAt": "2026-06-18T10:00:00Z",
  "progress": {
    "processed": 1200,
    "total": 5000
  }
}
```

When complete:

```json
{
  "jobId": "JOB-123",
  "status": "COMPLETED",
  "result": {
    "downloadUrl": "/reports/RPT-987/download"
  }
}
```

### 14.6 Event resource

Audit/event-oriented systems can expose append-only event resources:

```http
GET /cases/123/events
GET /cases/123/events/EVT-456
```

Do not confuse exposed domain events with internal implementation events. Public event contracts must be stable.

---

## 15. Command Endpoint Design Without RPC Smell

Not all operations fit pure CRUD. That is fine.

The key is to model commands with clear semantics.

Bad command:

```http
POST /execute
{
  "operation": "approveCase",
  "caseId": "123"
}
```

Better command resource:

```http
POST /cases/123/approval-decisions
Idempotency-Key: 01HZ...

{
  "decision": "APPROVE",
  "reasonCode": "REQUIREMENTS_MET",
  "remarks": "All checks passed.",
  "basedOnCaseVersion": 17
}
```

Properties of a good command endpoint:

```text
The URI names the business capability.
The body contains command intent, not hidden transport metadata.
The command has an idempotency strategy.
The response identifies created/affected resource.
The failure modes are explicit.
The command is auditable.
The command can be authorized independently.
```

---

## 16. Idempotency for REST APIs

Idempotency is not optional for unsafe operations in unreliable networks.

### 16.1 Why it matters

Client sends:

```http
POST /cases/123/approval-decisions
```

Server commits approval but response is lost due to timeout.

Client sees timeout.

What now?

Without idempotency:

```text
Retry may create duplicate approval.
No retry may leave client uncertain.
Manual reconciliation required.
```

With idempotency:

```http
POST /cases/123/approval-decisions
Idempotency-Key: officer42-case123-approve-20260618-001
```

Server can return the original committed result when the same logical request is retried.

### 16.2 Idempotency storage

Store:

```text
caller identity
idempotency key
request fingerprint
operation type
resource scope
status: IN_PROGRESS / SUCCEEDED / FAILED_RETRYABLE / FAILED_FINAL
response reference or response body hash
created resource id
expiry time
created timestamp
```

Unique constraint:

```sql
UNIQUE (caller_id, idempotency_key)
```

For scoped operation:

```sql
UNIQUE (case_id, operation_type, idempotency_key)
```

### 16.3 Request fingerprint

If same key is reused with different body, return conflict:

```http
409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.gov/problems/idempotency-key-conflict",
  "title": "Idempotency key reused with different request",
  "status": 409,
  "code": "IDEMPOTENCY_KEY_CONFLICT"
}
```

---

## 17. API Versioning and Evolution

Compatibility is not a documentation task. It is a design discipline.

### 17.1 Prefer additive changes

Usually safe:

```text
add optional response field
add optional request field with safe default
add new enum value only if clients are designed to tolerate unknown values
add new endpoint
add new link relation
add new problem type
```

Usually breaking:

```text
remove field
rename field
change field type
change meaning of field
make optional field required
change enum semantics
change status code class
change pagination token format in a client-visible way
change error code meaning
change id format if clients parse it
```

### 17.2 Unknown field tolerance

Server should generally ignore unknown request fields only if the contract says so.

There are two valid policies:

```text
Strict input
  Reject unknown fields to catch client mistakes.

Forward-compatible input
  Ignore unknown fields to allow gradual rollout.
```

Choose deliberately.

For external/public APIs, strict input is often safer.

For internal rolling upgrades, forward-compatible input can reduce deployment coupling.

### 17.3 Enum evolution

Enums are compatibility traps.

Bad client:

```java
switch (status) {
    case PENDING -> ...;
    case APPROVED -> ...;
    case REJECTED -> ...;
}
```

No default branch. New server status breaks client.

Better:

```java
switch (status) {
    case PENDING -> ...;
    case APPROVED -> ...;
    case REJECTED -> ...;
    default -> handleUnknownStatus(status);
}
```

API should document:

```text
Clients must tolerate unknown enum values.
```

If clients cannot tolerate unknown values, adding enum values is breaking.

### 17.4 URI versioning

Common:

```http
/api/v1/cases/123
/api/v2/cases/123
```

Pros:

```text
simple
visible
cache-friendly
route-friendly
```

Cons:

```text
encourages large-bang versions
can duplicate whole API surface
clients may pin forever
```

### 17.5 Media type versioning

```http
Accept: application/vnd.example.case.v2+json
```

Pros:

```text
representation-focused
same resource URI
```

Cons:

```text
harder for browser/manual tools
harder for gateways
more complex operationally
```

### 17.6 Header versioning

```http
API-Version: 2026-06-18
```

or:

```http
X-API-Version: 2
```

Pros:

```text
clean URI
central version negotiation
```

Cons:

```text
less visible
cache/proxy Vary implications
client tooling complexity
```

### 17.7 Recommendation

For enterprise Java systems:

```text
Use additive evolution by default.
Use URI major version only for truly breaking changes.
Avoid versioning every small change.
Document compatibility rules.
Use contract tests for supported clients.
Use deprecation/sunset process for removals.
```

---

## 18. Deprecation and Sunset

Deprecation is a communication process; sunset is an operational cutoff.

A mature API does not just delete endpoints.

It provides:

```text
deprecation notice
replacement endpoint
migration guide
consumer inventory
usage metrics
cutoff date
support window
rollback plan
```

### 18.1 HTTP headers for sunset

RFC 8594 defines the `Sunset` HTTP response header to indicate that a URI is likely to become unresponsive at a specified future point.

Example:

```http
HTTP/1.1 200 OK
Sunset: Wed, 31 Dec 2026 23:59:59 GMT
Link: <https://api.example.gov/docs/migrate-cases-v1-to-v2>; rel="sunset"
```

RFC 8288 defines Web Linking, including typed link relations.

### 18.2 Deprecation stages

```text
Stage 1: Announce
  Documentation marks endpoint deprecated.
  Response includes warning/deprecation metadata if appropriate.

Stage 2: Observe
  Track consumers still using endpoint.
  Notify owners.

Stage 3: Restrict
  Block new consumers.
  Keep existing consumers temporarily.

Stage 4: Sunset
  Return 410 Gone or suitable problem response.

Stage 5: Remove
  Remove route after logs prove no traffic or after policy cutoff.
```

### 18.3 410 Gone

Use when resource/endpoint is intentionally no longer available.

```http
410 Gone
Content-Type: application/problem+json

{
  "type": "https://api.example.gov/problems/api-sunset",
  "title": "API endpoint has been sunset",
  "status": 410,
  "code": "API_ENDPOINT_SUNSET",
  "detail": "This endpoint was sunset on 2026-12-31. Use /api/v2/cases instead."
}
```

---

## 19. Hypermedia and Links: Use Pragmatically

REST in its strict form emphasizes hypermedia as the engine of application state. Many enterprise APIs are not fully hypermedia-driven, but links are still useful.

Example:

```json
{
  "caseId": "123",
  "status": "PENDING_APPROVAL",
  "links": [
    {
      "rel": "self",
      "href": "/cases/123"
    },
    {
      "rel": "approval-decisions",
      "href": "/cases/123/approval-decisions"
    },
    {
      "rel": "documents",
      "href": "/cases/123/documents"
    }
  ]
}
```

Links are especially useful for:

```text
pagination
async job status
file download
migration/sunset docs
next allowed actions
external references
```

### 19.1 Links for workflow affordances

Instead of making the client hard-code all transitions, response can expose allowed actions:

```json
{
  "caseId": "123",
  "status": "PENDING_APPROVAL",
  "allowedActions": [
    {
      "rel": "approve",
      "method": "POST",
      "href": "/cases/123/approval-decisions",
      "requiredRole": "APPROVER"
    },
    {
      "rel": "request-more-info",
      "method": "POST",
      "href": "/cases/123/information-requests"
    }
  ]
}
```

This is useful when workflow rules differ by role, state, agency, or case type.

---

## 20. Security and Authorization in API Design

API shape affects security.

### 20.1 Avoid IDOR

Insecure Direct Object Reference occurs when API exposes object IDs but fails to enforce per-resource authorization.

Bad assumption:

```text
User is authenticated, therefore can access /cases/{id}.
```

Correct:

```text
User is authenticated.
Then check whether this user can access this case.
Then apply field-level redaction if needed.
```

### 20.2 403 vs 404 policy

For sensitive objects, returning 404 can prevent enumeration.

Policy example:

```text
If caller has no relationship to case, return 404.
If caller has relationship but lacks action permission, return 403.
```

This must be consistent and documented internally.

### 20.3 Field-level authorization

Different callers may see different representation fields.

Example:

```json
{
  "caseId": "123",
  "status": "PENDING_REVIEW",
  "applicantName": "...",
  "internalRiskScore": null
}
```

Better than returning forbidden fields accidentally.

But be careful: returning `null` may reveal field existence. Sometimes omit field entirely.

### 20.4 Query authorization

List endpoints need authorization-aware filtering.

Bad:

```sql
SELECT * FROM cases WHERE status = ?
```

Better:

```sql
SELECT * FROM cases
WHERE status = ?
AND agency_id IN (:callerAllowedAgencies)
```

Never rely only on frontend filtering.

---

## 21. Java Server-Side Implementation Pattern

Framework-neutral architecture:

```text
Controller / Resource class
  - parse HTTP request
  - validate transport-level shape
  - call application service
  - map domain result to HTTP response

Application service
  - enforce use case
  - transaction boundary
  - idempotency
  - authorization decision request
  - domain operation

Domain model / workflow engine
  - business rules
  - state transitions
  - invariants

Repository / integration adapters
  - persistence
  - external calls

Exception / result mapper
  - maps known failures to Problem Details
```

### 21.1 Avoid throwing generic exceptions for domain outcomes

Bad:

```java
throw new RuntimeException("Case already closed");
```

Better:

```java
sealed interface SubmitDecisionResult permits SubmitDecisionResult.Accepted,
        SubmitDecisionResult.CaseClosed,
        SubmitDecisionResult.VersionConflict,
        SubmitDecisionResult.NotAuthorized {

    record Accepted(String decisionId, long newVersion) implements SubmitDecisionResult {}
    record CaseClosed(String caseId) implements SubmitDecisionResult {}
    record VersionConflict(long expected, long actual) implements SubmitDecisionResult {}
    record NotAuthorized(String policyCode) implements SubmitDecisionResult {}
}
```

Then map:

```java
return switch (result) {
    case Accepted ok -> created(location(ok.decisionId()), body(ok));
    case CaseClosed err -> problem(409, "CASE_ALREADY_CLOSED", ...);
    case VersionConflict err -> problem(409, "CASE_VERSION_CONFLICT", ...);
    case NotAuthorized err -> problem(403, "NOT_ALLOWED_TO_SUBMIT_DECISION", ...);
};
```

For Java 8, use classes/interfaces instead of sealed types and switch pattern matching.

### 21.2 Centralized problem mapping

Do not duplicate error JSON in every controller.

Create:

```text
ProblemFactory
ExceptionMapper / ControllerAdvice
ErrorCode registry
CorrelationId provider
Violation mapper
```

Example shape:

```java
public record ApiProblem(
        URI type,
        String title,
        int status,
        String detail,
        URI instance,
        String code,
        String correlationId,
        List<Violation> violations
) {}
```

### 21.3 Preserve HTTP semantics at boundaries

Bad service method:

```java
ApiResponse approveCase(ApproveCaseRequest request);
```

This mixes HTTP into domain logic.

Better:

```java
SubmitDecisionResult submitApprovalDecision(SubmitApprovalDecisionCommand command);
```

HTTP mapping stays outside.

---

## 22. Java Client-Side Contract Consumption

A production client should not treat all non-2xx responses as generic exceptions.

Bad:

```java
HttpResponse<String> response = client.send(request, BodyHandlers.ofString());
if (response.statusCode() != 200) {
    throw new RuntimeException(response.body());
}
```

Better:

```java
int status = response.statusCode();

if (status >= 200 && status < 300) {
    return parseSuccess(response.body());
}

ApiProblem problem = parseProblem(response);

return switch (status) {
    case 400 -> Result.badRequest(problem);
    case 401 -> Result.authRequired(problem);
    case 403 -> Result.forbidden(problem);
    case 404 -> Result.notFound(problem);
    case 409 -> Result.conflict(problem);
    case 412 -> Result.staleVersion(problem);
    case 422 -> Result.validationFailed(problem);
    case 429 -> Result.rateLimited(problem, retryAfter(response));
    case 503 -> Result.temporarilyUnavailable(problem, retryAfter(response));
    default -> Result.unexpected(status, problem);
};
```

### 22.1 Typed client SDK pattern

Instead of exposing raw HTTP to application code:

```java
interface CaseApiClient {
    GetCaseResult getCase(String caseId);
    SubmitDecisionResult submitApprovalDecision(String caseId, SubmitApprovalDecisionRequest request, IdempotencyKey key);
}
```

The SDK handles:

```text
base URL
auth headers
correlation id
idempotency key
timeout/deadline
retry policy
problem parsing
metrics/tracing
redaction-safe logging
```

But it must not hide important outcomes behind generic exceptions.

---

## 23. Observability for REST APIs

For each endpoint, collect:

```text
request count by method/path template/status class
latency histogram by method/path template/status class
domain error code count
validation error count
conflict count
precondition failure count
rate limit count
idempotency replay count
request body size
response body size
downstream latency
correlation id / trace id
consumer/client id
API version
```

### 23.1 Path template, not raw path

Bad metric label:

```text
path=/cases/123
path=/cases/124
path=/cases/125
```

High cardinality.

Better:

```text
path_template=/cases/{caseId}
```

### 23.2 Error code as metric dimension

Useful:

```text
http.server.requests{status="409", error_code="CASE_ALREADY_CLOSED"}
```

Danger: do not put free-form validation messages in metric labels.

### 23.3 Audit vs observability

Observability tells engineers what happened operationally.

Audit tells the organization what happened from a business/legal perspective.

They overlap but are not the same.

Example:

```text
Observability log:
  POST /cases/{caseId}/approval-decisions returned 201 in 240ms.

Audit event:
  Officer X approved case CASE-123 at time T based on version 17 with reason code REQUIREMENTS_MET.
```

---

## 24. Regulatory / Case-Management API Design Lens

For enforcement lifecycle or complex case platforms, REST design must preserve defensibility.

### 24.1 State transitions must be explicit

Avoid:

```http
PATCH /cases/123
{"status":"APPROVED"}
```

Prefer:

```http
POST /cases/123/approval-decisions
```

Why?

Because approval is not just status mutation. It is a decision event with actor, authority, reason, time, evidence, and resulting state.

### 24.2 Every consequential command should answer

```text
Who requested it?
What resource was affected?
What version/state was it based on?
What business rule allowed it?
What was created?
What state changed?
Can it be retried?
How is it audited?
```

### 24.3 Do not collapse workflow states into generic status

Bad:

```json
{
  "status": "PENDING"
}
```

Better:

```json
{
  "status": "PENDING_REVIEW",
  "stage": "ASSESSMENT",
  "assignedRole": "CASE_OFFICER",
  "allowedTransitions": ["REQUEST_INFO", "RECOMMEND_APPROVAL", "ESCALATE"]
}
```

### 24.4 Decision resources improve auditability

Examples:

```http
POST /cases/123/recommendations
POST /cases/123/approval-decisions
POST /cases/123/escalations
POST /cases/123/information-requests
POST /cases/123/closure-decisions
POST /cases/123/reopen-requests
```

Each can have:

```text
id
actor
role
reason code
remarks
evidence references
basedOnVersion
createdAt
resultingCaseStatus
```

---

## 25. Anti-Patterns

### 25.1 Everything is POST

```http
POST /getCase
POST /updateCase
POST /deleteCase
```

Loss:

```text
caching
idempotency semantics
observability clarity
intermediary behavior
standard tooling
```

### 25.2 Always 200

Breaks monitoring and clients.

### 25.3 Exposing database IDs without policy

Can cause IDOR and data leakage.

### 25.4 Returning stack traces

Leaks internals.

### 25.5 Unbounded list endpoint

Leads to memory, DB, and latency incidents.

### 25.6 Ambiguous PATCH

If null semantics are unclear, clients will corrupt data.

### 25.7 Breaking enum changes

Adding enum value can break old clients if unknown handling is absent.

### 25.8 Versioning too early

Creating `/v2` for every small change creates fragmentation.

### 25.9 Versioning too late

Breaking clients silently is worse.

### 25.10 Hiding workflow transitions as field mutation

Weakens auditability and business rule clarity.

---

## 26. Design Checklist

Before publishing an endpoint, answer:

```text
Resource and operation
[ ] What resource or command resource does this endpoint represent?
[ ] Is the URI stable and domain-oriented?
[ ] Is the method semantically correct?
[ ] Is the operation safe, idempotent, or unsafe?
[ ] If unsafe, is there idempotency support?

Request contract
[ ] Is Content-Type required and validated?
[ ] Are unknown fields accepted or rejected?
[ ] Are enum evolution rules documented?
[ ] Are null/missing/empty semantics clear?
[ ] Are size limits defined?

Response contract
[ ] Are success status codes correct?
[ ] Is Location returned for created resources?
[ ] Is ETag/version returned when concurrency matters?
[ ] Are sensitive fields redacted based on caller?

Error contract
[ ] Are errors machine-readable?
[ ] Are error codes stable?
[ ] Are validation violations structured?
[ ] Are internal exception details hidden?
[ ] Are retryable errors distinguishable?

Concurrency
[ ] Does update require If-Match or version?
[ ] Is stale update behavior defined?
[ ] Is conflict vs precondition failure clear?

Pagination/search
[ ] Is pagination mandatory for lists?
[ ] Is ordering stable?
[ ] Is total count necessary?
[ ] Are filters controlled and indexed?

Evolution
[ ] Can fields be added safely?
[ ] Are clients expected to tolerate unknown enum values?
[ ] Is deprecation/sunset process defined?
[ ] Are contract tests in place?

Observability
[ ] Are method/path/status/error-code metrics available?
[ ] Is correlation id returned/logged?
[ ] Are audit events distinct from technical logs?
```

---

## 27. Mini Case Study: Designing a Case Approval API

### 27.1 Naive design

```http
POST /approveCase
Content-Type: application/json

{
  "caseId": "CASE-123"
}
```

Response:

```http
200 OK

{
  "success": true
}
```

Problems:

```text
No idempotency.
No version check.
No reason code.
No clear created resource.
No Location.
No audit shape.
No conflict model.
No retry safety.
No authorization-specific error.
No way to inspect decision later.
```

### 27.2 Better design

```http
POST /cases/CASE-123/approval-decisions
Authorization: Bearer ...
Idempotency-Key: 01HZR8Y8QH7X4V3S8GZXK4
Content-Type: application/json
Accept: application/json

{
  "decision": "APPROVE",
  "reasonCode": "REQUIREMENTS_MET",
  "remarks": "All mandatory requirements were verified.",
  "basedOnCaseVersion": 17,
  "evidenceDocumentIds": ["DOC-1", "DOC-2"]
}
```

Success:

```http
201 Created
Location: /cases/CASE-123/approval-decisions/DEC-456
ETag: "case-CASE-123-v18"
Content-Type: application/json

{
  "decisionId": "DEC-456",
  "caseId": "CASE-123",
  "decision": "APPROVE",
  "reasonCode": "REQUIREMENTS_MET",
  "resultingCaseStatus": "APPROVED",
  "basedOnCaseVersion": 17,
  "newCaseVersion": 18,
  "createdAt": "2026-06-18T10:15:30Z",
  "createdBy": "officer-42"
}
```

Version conflict:

```http
409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.gov/problems/case-version-conflict",
  "title": "Case version conflict",
  "status": 409,
  "detail": "The case changed after the approval form was loaded.",
  "code": "CASE_VERSION_CONFLICT",
  "expectedVersion": 17,
  "actualVersion": 18,
  "correlationId": "01HZ..."
}
```

Already approved, same idempotency key:

```http
201 Created
Location: /cases/CASE-123/approval-decisions/DEC-456
Idempotency-Replayed: true
```

Already approved, different request:

```http
409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.gov/problems/case-already-approved",
  "title": "Case already approved",
  "status": 409,
  "code": "CASE_ALREADY_APPROVED"
}
```

This design is more verbose, but it is operationally and legally stronger.

---

## 28. Exercises

### Exercise 1 — Fix the endpoint

Given:

```http
POST /updateStatus
{
  "caseId": "123",
  "status": "CLOSED"
}
```

Redesign it for a regulatory case-management system.

Answer should include:

```text
URI
method
request body
idempotency strategy
success response
conflict response
validation response
audit event shape
```

### Exercise 2 — Define error taxonomy

For a document upload API, define error responses for:

```text
invalid file type
file too large
virus scan unavailable
case not found
caller cannot upload document
case already closed
upload timeout after storage succeeded
```

Choose status codes and problem codes.

### Exercise 3 — Pagination design

Design:

```http
GET /cases
```

for a dataset with millions of cases and frequent updates.

Include:

```text
filters
sort rules
page token
page size limit
hasNextPage
total count policy
index implications
```

### Exercise 4 — Versioning strategy

You need to add a new case status:

```text
PENDING_SECONDARY_REVIEW
```

Explain whether this is breaking or non-breaking. Define what must be true for it to be safe.

### Exercise 5 — Java client handling

Write a pseudo-client result model for:

```text
200 success
404 not found
409 conflict
412 stale version
422 validation failed
429 rate limited
503 unavailable
```

Avoid generic `RuntimeException` for all failures.

---

## 29. Key Takeaways

1. REST over HTTP is not CRUD and not controller-method remoting.
2. Good URI design identifies stable domain resources and command resources.
3. HTTP method semantics matter because clients, proxies, caches, retries, and monitoring depend on them.
4. Status codes must tell the truth at the protocol level.
5. Error responses need stable machine-readable codes, not only human messages.
6. Optimistic concurrency must be explicit for collaborative workflows.
7. Pagination and filtering are API design and database design problems at the same time.
8. Idempotency is mandatory for unsafe operations that may be retried.
9. API evolution is easiest when contracts are additive and clients tolerate known extension points.
10. Regulatory systems should model consequential transitions as durable decision/command resources, not hidden field updates.

---

## 30. References

- RFC 9110 — HTTP Semantics: methods, status codes, resource semantics, conditional requests.
- RFC 9457 — Problem Details for HTTP APIs.
- RFC 8288 — Web Linking.
- RFC 8594 — Sunset HTTP Header Field.
- Java SE 25 `java.net.http.HttpClient` documentation for client-side HTTP behavior.

---

## 31. Series Progress

```text
Part 18 of 35 complete.
Series is not finished yet.
Next: Part 19 — Streaming HTTP: Server-Sent Events, Long Polling, Chunked Streaming, and Backpressure
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 17 — Proxy, Gateway, Load Balancer, Service Mesh, and Network Middleboxes](./017-proxy-gateway-load-balancer-service-mesh-network-middleboxes.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 19 — Streaming HTTP: Server-Sent Events, Long Polling, Chunked Streaming, and Backpressure](./019-streaming-http-server-sent-events-long-polling-chunked-streaming-backpressure.md)

</div>