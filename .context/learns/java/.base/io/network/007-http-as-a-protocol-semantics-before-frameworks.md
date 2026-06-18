# Part 7 — HTTP as a Protocol: Semantics Before Frameworks

Series: `learn-java-io-network-http-grpc-protocol-engineering`  
File: `007-http-as-a-protocol-semantics-before-frameworks.md`  
Target Java: 8–25  
Status: Part 7 of 35

---

## 0. Why This Part Exists

Many backend engineers learn HTTP through a framework:

- `@GetMapping`
- `@PostMapping`
- `ResponseEntity`
- `WebClient`
- `RestTemplate`
- JAX-RS `@GET`
- Feign client
- Retrofit
- OkHttp
- Apache HttpClient
- JDK `HttpClient`
- API gateway route configuration

That is useful, but it can also create a dangerous illusion:

> "HTTP is just a way to call another function over the network."

It is not.

HTTP is a distributed application protocol with its own semantics. It defines how requests describe intent, how responses communicate outcome, how intermediaries may cache or transform traffic, how clients may retry, how servers should model resource state, and how clients and servers can coordinate concurrency without sharing memory.

A top-tier Java engineer does not only know how to send an HTTP request. They understand:

- what a method promises;
- what a status code means and does not mean;
- which failures are safe to retry;
- which headers change semantics;
- when caches are allowed to reuse responses;
- how redirects affect method/body/security;
- how conditional requests prevent lost updates;
- how API error models should be machine-readable;
- why HTTP semantics remain relevant even when the transport is HTTP/1.1, HTTP/2, or HTTP/3;
- why a wrong HTTP contract can create correctness bugs even when the Java code is syntactically clean.

This part is not about building a REST controller. You already covered Java web frameworks earlier. This part builds the HTTP mental model that sits underneath every Java HTTP server, HTTP client, proxy, gateway, load balancer, and service mesh.

---

## 1. Learning Outcomes

After this part, you should be able to:

1. Explain HTTP as a protocol of **resource-oriented semantics**, not just endpoint invocation.
2. Distinguish resource identity, representation, method semantics, and application workflow.
3. Choose HTTP methods based on safety, idempotency, cacheability, and side-effect model.
4. Interpret status codes by class and by operational meaning.
5. Design error responses that are stable, debuggable, and machine-readable.
6. Use headers as part of the contract, not just metadata.
7. Understand conditional requests using `ETag`, `If-Match`, `If-None-Match`, `Last-Modified`, and related headers.
8. Reason about caching rules and why cache behavior can create both performance wins and correctness bugs.
9. Model redirects, authentication headers, content negotiation, and idempotency keys.
10. Recognize anti-patterns such as `POST /getData`, always returning `200`, putting business errors only in response body, and retrying unsafe operations blindly.
11. Build HTTP clients and servers in Java with semantic awareness.
12. Prepare for the next parts: HTTP/1.1 internals, HTTP/2 internals, and Java HTTP client implementations.

---

## 2. HTTP Is Not the Same as REST

HTTP is a protocol. REST is an architectural style. Many APIs called "REST APIs" are not strict REST. That is fine, but the distinction matters.

A typical enterprise API often looks like this:

```http
POST /application/search
POST /application/approve
POST /application/reject
POST /case/assign
POST /document/download
```

This can work, but it often ignores important HTTP semantics:

- `POST /application/search` may be read-only, but `POST` is not generally cacheable in the same way as `GET`.
- `POST /document/download` hides that the operation is retrieval.
- `POST /application/approve` may be correct as a command, but its retry behavior must be designed carefully.
- `POST /case/assign` may create duplicate side effects if retried without idempotency protection.

A good engineer does not blindly force everything into pure REST resources. But they also do not ignore protocol meaning. The goal is not religious purity. The goal is correctness, operability, evolvability, and predictable behavior across clients, proxies, caches, gateways, and logs.

---

## 3. Core HTTP Mental Model

At a high level:

```text
Client wants to perform an action involving a resource.
Client sends:
  method + target URI + headers + optional content

Server interprets:
  method semantics + target resource + representation metadata + body

Server replies:
  status code + headers + optional content
```

Do not think:

```text
HTTP request = remote method call
```

Think:

```text
HTTP request = protocol-level intent over a resource or command boundary
```

The important elements:

```text
URI            identifies a target resource
Method         describes requested semantics
Headers        modify request/response semantics
Body           carries representation or command payload
Status code    classifies protocol outcome
Response body  carries representation, result, or problem detail
```

A flawed API often mixes these incorrectly:

```text
URI says one thing
method says another
status code says success
body says failure
cache header says reusable
business rule says never reuse
client retries
server duplicates side effects
```

This is how "simple HTTP APIs" become incident generators.

---

## 4. Resource, Representation, and State

HTTP does not send Java objects. It sends representations.

A resource is a conceptual target:

```text
/application/123
/case/981
/users/42/profile
/reports/monthly/2026-06
```

A representation is a transferred view of that resource at some time:

```json
{
  "applicationId": "123",
  "status": "PENDING_REVIEW",
  "submittedAt": "2026-06-01T10:15:30+07:00"
}
```

A resource can have multiple representations:

```text
application/json
application/xml
text/csv
application/pdf
image/png
```

The domain state is not identical to the representation:

```text
Domain state:
  aggregate, invariants, event history, permissions, workflow state

Representation:
  selected fields, encoding, media type, language, version, cache metadata
```

This distinction matters because:

- a `GET` response may omit internal fields;
- a `PUT` request may not map one-to-one to database row replacement;
- a `PATCH` request may represent a partial change document;
- `ETag` may represent a version of the representation, not necessarily a domain event number;
- content negotiation can return different representations for the same resource.

---

## 5. HTTP Method Semantics

HTTP methods are not just route names. They carry semantic promises.

Common methods:

```text
GET      retrieve a representation
HEAD     retrieve metadata without body
POST     process enclosed representation according to resource semantics
PUT      create or replace target resource state
PATCH    apply partial modification
DELETE   remove target resource association/state
OPTIONS  describe communication options
TRACE    diagnostic loop-back, usually disabled in production
```

The most important dimensions:

```text
safe
idempotent
cacheable
body semantics
retry semantics
side-effect expectations
```

---

## 6. Safe Methods

A method is safe when the client is not requesting state change.

Common safe methods:

```text
GET
HEAD
OPTIONS
TRACE
```

Safe does not mean "nothing happens internally."

A `GET` may still:

- produce access logs;
- update metrics;
- refresh cache;
- trigger audit read event;
- update last-access timestamp if your system does that.

But those are not the requested semantic outcome.

The client asked to retrieve information, not mutate business state.

Bad example:

```http
GET /application/123/approve
```

This is dangerous because:

- browsers, crawlers, link previewers, monitoring tools, caches, and prefetchers may issue `GET`;
- operators may copy/paste URL;
- retries may happen at client/proxy layers;
- it violates the expectation that `GET` is safe.

Better:

```http
POST /application/123/approval-decisions
Content-Type: application/json

{
  "decision": "APPROVED",
  "reason": "All checks passed",
  "idempotencyKey": "approval-123-20260618-001"
}
```

Or, if modelling as resource replacement:

```http
PUT /application/123/decision
If-Match: "v17"
Content-Type: application/json

{
  "decision": "APPROVED",
  "reason": "All checks passed"
}
```

The right choice depends on domain semantics.

---

## 7. Idempotent Methods

A method is idempotent when making the same request once or multiple times has the same intended effect on server state.

Common idempotent methods:

```text
GET
HEAD
OPTIONS
TRACE
PUT
DELETE
```

Non-idempotent by default:

```text
POST
PATCH
```

But this is subtle.

### 7.1 `PUT` Idempotency

```http
PUT /users/42/email
Content-Type: application/json

{
  "email": "new@example.com"
}
```

Sending this once or five times should result in:

```text
user 42 email = new@example.com
```

That is idempotent.

### 7.2 `DELETE` Idempotency

```http
DELETE /documents/123
```

First request may delete the document. Second request may return `404` or `204` depending on API design, but the intended final state remains:

```text
document 123 is not available
```

The response can differ while the intended effect remains idempotent.

### 7.3 `POST` Is Usually Not Idempotent

```http
POST /payments
Content-Type: application/json

{
  "amount": 100000,
  "currency": "IDR"
}
```

If retried blindly, this may create multiple payments.

To make it retry-safe:

```http
POST /payments
Idempotency-Key: payment-order-7788-attempt-1
Content-Type: application/json

{
  "orderId": "7788",
  "amount": 100000,
  "currency": "IDR"
}
```

Server stores the idempotency key and returns the same result for duplicate attempts.

### 7.4 Idempotency Is a Contract, Not Just a Method Property

Even `PUT` can be non-idempotent if implemented badly:

```http
PUT /counters/abc
Content-Type: application/json

{
  "incrementBy": 1
}
```

This is not replacement. This is increment command disguised as `PUT`.

Better:

```http
POST /counters/abc/increments
Content-Type: application/json

{
  "amount": 1,
  "idempotencyKey": "inc-abc-001"
}
```

Or:

```http
PUT /counters/abc
Content-Type: application/json

{
  "value": 42
}
```

---

## 8. Cacheability

Caching is one of HTTP's core powers and one of its most common sources of correctness bugs.

A response can be reused by caches only under rules derived from method, status code, and cache headers.

The most commonly cached method is `GET`. `HEAD` can also participate in cache validation. Some responses to `POST` can be cacheable under explicit conditions, but many systems do not rely on that.

Important cache headers:

```text
Cache-Control
ETag
Last-Modified
Expires
Vary
Age
Pragma          legacy
```

Common `Cache-Control` directives:

```text
no-store
no-cache
max-age=60
s-maxage=300
private
public
must-revalidate
stale-while-revalidate
```

Important distinction:

```text
no-store  = do not store response
no-cache  = may store, but must revalidate before reuse
```

Many engineers confuse them.

### 8.1 Example: Public Static Resource

```http
HTTP/1.1 200 OK
Content-Type: application/javascript
Cache-Control: public, max-age=31536000, immutable
ETag: "app-js-8a7c"
```

This is suitable for fingerprinted static assets.

### 8.2 Example: Sensitive User Data

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store
```

Useful for personal, regulated, or high-risk data.

### 8.3 Example: Revalidatable Resource

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: private, no-cache
ETag: "case-123-v18"
```

Client may store but must validate before reuse.

---

## 9. Conditional Requests

Conditional requests allow clients and servers to coordinate based on resource version or modification time.

They are essential for:

- cache validation;
- avoiding lost updates;
- optimistic concurrency;
- bandwidth reduction;
- safe refresh;
- distributed editing.

Key headers:

```text
ETag
If-Match
If-None-Match
Last-Modified
If-Modified-Since
If-Unmodified-Since
```

### 9.1 ETag

An `ETag` is an entity tag: an opaque validator for a representation.

```http
HTTP/1.1 200 OK
ETag: "application-123-v17"
Content-Type: application/json

{
  "id": "123",
  "status": "PENDING_REVIEW"
}
```

The client should not parse the ETag as business data. Treat it as opaque.

### 9.2 Cache Revalidation with `If-None-Match`

Client has cached representation with ETag `"application-123-v17"`.

```http
GET /applications/123
If-None-Match: "application-123-v17"
```

If unchanged:

```http
HTTP/1.1 304 Not Modified
ETag: "application-123-v17"
```

No body needed.

If changed:

```http
HTTP/1.1 200 OK
ETag: "application-123-v18"
Content-Type: application/json

{
  "id": "123",
  "status": "UNDER_REVIEW"
}
```

### 9.3 Lost Update Protection with `If-Match`

User retrieves version 17:

```http
GET /applications/123
```

Server:

```http
HTTP/1.1 200 OK
ETag: "application-123-v17"
```

User attempts update:

```http
PUT /applications/123
If-Match: "application-123-v17"
Content-Type: application/json

{
  "status": "APPROVED"
}
```

If the resource is still version 17:

```http
HTTP/1.1 200 OK
ETag: "application-123-v18"
```

If someone else already updated it:

```http
HTTP/1.1 412 Precondition Failed
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/precondition-failed",
  "title": "Resource version mismatch",
  "status": 412,
  "detail": "The application was modified by another user.",
  "instance": "/applications/123"
}
```

This is HTTP-level optimistic locking.

### 9.4 Why This Matters in Case Management Systems

In regulatory case management, two officers may work on the same case:

```text
Officer A reads case v20.
Officer B updates case to v21.
Officer A submits old update based on v20.
```

Without conditional request:

```text
A can accidentally overwrite B.
```

With `If-Match`:

```text
A's update fails with 412.
Client reloads latest state.
User reconciles conflict.
```

This is not just technical correctness. It supports auditability, defensibility, and human workflow integrity.

---

## 10. HTTP Status Code Mental Model

Status codes are not decorations. They are protocol-level classification.

Classes:

```text
1xx informational
2xx successful
3xx redirection
4xx client error
5xx server error
```

A useful mental model:

```text
2xx: server accepted/performed request semantics
3xx: client needs another request target or cached representation logic
4xx: request is invalid/unacceptable from server's perspective
5xx: server/dependency failed to fulfill apparently valid request
```

Do not use only `200` and body flags.

Bad:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "success": false,
  "error": "Application not found"
}
```

Better:

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/application-not-found",
  "title": "Application not found",
  "status": 404,
  "detail": "Application 123 was not found.",
  "instance": "/applications/123"
}
```

Why this matters:

- clients can classify errors;
- gateways can route/observe failures correctly;
- retry logic can avoid retrying invalid requests;
- dashboards can distinguish application failures from success;
- caches understand response semantics;
- humans can debug using standard tooling.

---

## 11. Common 2xx Codes

### 11.1 `200 OK`

General success. Response usually contains representation or result.

```http
GET /applications/123

HTTP/1.1 200 OK
Content-Type: application/json
```

Use when response has a meaningful body.

### 11.2 `201 Created`

Use when a resource was created.

```http
POST /applications
Content-Type: application/json

{
  "applicantId": "A001"
}
```

Response:

```http
HTTP/1.1 201 Created
Location: /applications/123
Content-Type: application/json

{
  "id": "123",
  "status": "DRAFT"
}
```

`Location` is important.

### 11.3 `202 Accepted`

The request was accepted for processing, but processing is not complete.

Useful for async workflows:

```http
POST /reports/monthly-generation-jobs
Content-Type: application/json

{
  "month": "2026-06"
}
```

Response:

```http
HTTP/1.1 202 Accepted
Location: /jobs/report-7788
Retry-After: 10
Content-Type: application/json

{
  "jobId": "report-7788",
  "status": "QUEUED"
}
```

Do not return `202` if the operation is already complete.

### 11.4 `204 No Content`

Success with no response body.

```http
DELETE /applications/123

HTTP/1.1 204 No Content
```

Good for delete, update, or commands where client does not need representation.

### 11.5 `206 Partial Content`

Used with range requests.

```http
GET /documents/123/content
Range: bytes=0-1023
```

Response:

```http
HTTP/1.1 206 Partial Content
Content-Range: bytes 0-1023/10485760
```

Critical for resumable downloads and large file transfer.

---

## 12. Common 3xx Codes

Redirects are not simple. They affect method, body, security, and client behavior.

Common redirect codes:

```text
301 Moved Permanently
302 Found
303 See Other
307 Temporary Redirect
308 Permanent Redirect
304 Not Modified
```

### 12.1 `304 Not Modified`

Not a redirect to another URI. It is cache validation response.

```http
HTTP/1.1 304 Not Modified
ETag: "v17"
```

No message body.

### 12.2 `303 See Other`

Useful after `POST` when client should fetch result via `GET`.

```http
POST /applications
```

Response:

```http
HTTP/1.1 303 See Other
Location: /applications/123
```

Client then:

```http
GET /applications/123
```

### 12.3 `307` and `308`

These preserve method and body.

If a client sends:

```http
POST /payments
```

and receives:

```http
HTTP/1.1 307 Temporary Redirect
Location: https://payments-v2.example.com/payments
```

The client should repeat `POST` to the new URL.

This can be dangerous if authentication, host trust, or idempotency is not designed.

---

## 13. Common 4xx Codes

4xx means the server believes the problem is with the request, authentication, authorization, state conflict, precondition, or client-side assumption.

### 13.1 `400 Bad Request`

Malformed syntax or invalid request structure.

Examples:

- invalid JSON;
- missing required field;
- invalid enum value;
- impossible query parameter format.

```http
HTTP/1.1 400 Bad Request
```

### 13.2 `401 Unauthorized`

Despite the name, it means authentication is required or invalid.

Use with `WWW-Authenticate` when applicable.

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="api"
```

### 13.3 `403 Forbidden`

The server understood the authenticated user, but the user is not allowed.

```http
HTTP/1.1 403 Forbidden
```

Do not confuse:

```text
401 = who are you / token invalid / token missing
403 = I know who you are, but you cannot do this
```

### 13.4 `404 Not Found`

Target resource not found or intentionally hidden.

Security-sensitive systems sometimes return 404 instead of 403 to avoid revealing resource existence. That can be valid if consistent.

### 13.5 `405 Method Not Allowed`

Resource exists, method not supported.

Should include `Allow` header:

```http
HTTP/1.1 405 Method Not Allowed
Allow: GET, PUT, DELETE
```

### 13.6 `409 Conflict`

Request conflicts with current resource state.

Examples:

- approving an already rejected application;
- assigning a case already assigned under exclusive lock;
- creating duplicate resource where conflict is domain-level;
- state transition violation.

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/invalid-state-transition",
  "title": "Invalid state transition",
  "status": 409,
  "detail": "Application REJECTED cannot transition to APPROVED."
}
```

### 13.7 `412 Precondition Failed`

Conditional request precondition failed.

Usually used with `If-Match` or `If-Unmodified-Since`.

```http
HTTP/1.1 412 Precondition Failed
```

Use this for optimistic concurrency mismatch.

### 13.8 `415 Unsupported Media Type`

Client sent unsupported request `Content-Type`.

```http
HTTP/1.1 415 Unsupported Media Type
Accept: application/json
```

Example:

```http
Content-Type: text/plain
```

but server requires:

```http
application/json
```

### 13.9 `422 Unprocessable Content`

Useful when syntax is correct but semantic validation fails.

Example:

```json
{
  "startDate": "2026-07-10",
  "endDate": "2026-07-01"
}
```

The JSON is valid. But the date range is invalid.

Some systems use `400` for all validation failures. That is acceptable if documented. But separating `400` from `422` can improve clarity.

### 13.10 `429 Too Many Requests`

Rate limit exceeded.

Should often include:

```http
Retry-After: 30
```

and optionally rate limit headers depending on your API standard.

---

## 14. Common 5xx Codes

5xx means the server failed to fulfill an apparently valid request.

### 14.1 `500 Internal Server Error`

Generic unexpected server error.

Avoid using it for known domain outcomes.

### 14.2 `502 Bad Gateway`

A gateway/proxy received invalid response from upstream.

Typical in:

- API gateway;
- reverse proxy;
- service mesh;
- load balancer;
- backend dependency path.

### 14.3 `503 Service Unavailable`

Service temporarily unavailable.

Useful for overload, maintenance, dependency outage, or load shedding.

May include:

```http
Retry-After: 60
```

### 14.4 `504 Gateway Timeout`

Gateway/proxy timed out waiting for upstream.

Important: a `504` does not always mean the upstream did not process the request. It may have processed but responded too late.

For non-idempotent operations, this is dangerous.

Example:

```text
Client -> Gateway -> Payment Service
Payment Service creates payment.
Gateway times out.
Client sees 504.
Client retries POST.
Duplicate payment unless idempotency exists.
```

---

## 15. Choosing Status Codes: Practical Decision Table

| Situation | Suggested Status |
|---|---:|
| Read successful | 200 |
| Created resource | 201 |
| Accepted async job | 202 |
| Command/update successful, no body | 204 |
| Request syntax invalid | 400 |
| Authentication missing/invalid | 401 |
| Authenticated but not allowed | 403 |
| Resource not found | 404 |
| Method unsupported | 405 |
| Domain state conflict | 409 |
| Optimistic locking mismatch | 412 |
| Unsupported request media type | 415 |
| Semantic validation failed | 400 or 422 |
| Rate limit exceeded | 429 |
| Unexpected server error | 500 |
| Upstream invalid response | 502 |
| Temporary overload/unavailable | 503 |
| Gateway timed out | 504 |

The key is not memorizing codes. The key is keeping semantics consistent.

---

## 16. Error Response Design

A strong HTTP API has predictable error responses.

Bad error response:

```json
{
  "message": "Something went wrong"
}
```

Better:

```json
{
  "type": "https://api.example.com/problems/invalid-state-transition",
  "title": "Invalid state transition",
  "status": 409,
  "detail": "Application 123 cannot transition from REJECTED to APPROVED.",
  "instance": "/applications/123",
  "errorCode": "APPLICATION_INVALID_STATE_TRANSITION",
  "correlationId": "01JABCDEF123456789"
}
```

Recommended fields:

```text
type           stable problem type URI or identifier
title          short human-readable summary
status         HTTP status code
detail         human-readable explanation
instance       request/resource instance
errorCode      internal stable machine code
correlationId  trace/correlation support
violations     field-level validation details
```

Example validation error:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json
```

```json
{
  "type": "https://api.example.com/problems/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "One or more fields are invalid.",
  "errorCode": "VALIDATION_FAILED",
  "correlationId": "01JABCDEF123456789",
  "violations": [
    {
      "field": "endDate",
      "code": "MUST_BE_AFTER_START_DATE",
      "message": "endDate must be after startDate."
    }
  ]
}
```

Production rules:

1. Do not expose stack traces.
2. Do not expose secrets, SQL, internal hostnames, or token content.
3. Use stable machine-readable codes.
4. Keep human message useful but not security-sensitive.
5. Always include correlation/trace identifier where possible.
6. Align HTTP status with problem status.
7. Log more details server-side than you return client-side.
8. Make error schema versioned or backward-compatible.

---

## 17. Headers Are Part of the Contract

Headers are not just optional metadata. They often define protocol behavior.

Important request headers:

```text
Accept
Accept-Language
Authorization
Content-Type
Content-Length
Host
User-Agent
If-Match
If-None-Match
Idempotency-Key
Range
X-Correlation-ID / traceparent
```

Important response headers:

```text
Content-Type
Content-Length
Cache-Control
ETag
Last-Modified
Location
Retry-After
WWW-Authenticate
Vary
Content-Disposition
Set-Cookie
traceparent / correlation header depending on standard
```

### 17.1 `Content-Type` vs `Accept`

`Content-Type` describes the request or response body being sent.

```http
Content-Type: application/json
```

`Accept` describes what response media types the client can receive.

```http
Accept: application/json
```

Common bug:

```text
Client sends JSON but forgets Content-Type.
Server guesses incorrectly.
```

Another bug:

```text
Server returns HTML error page to Java client expecting JSON.
Client fails parsing and hides real HTTP error.
```

Always define error content type too.

### 17.2 `Location`

Important for resource creation and redirects.

```http
HTTP/1.1 201 Created
Location: /applications/123
```

### 17.3 `Retry-After`

Can be used with `429`, `503`, and sometimes `202`.

```http
Retry-After: 30
```

or HTTP-date:

```http
Retry-After: Wed, 18 Jun 2026 21:00:00 GMT
```

Clients should treat it as guidance, not an excuse to create synchronized retry storms. Combine with jitter.

### 17.4 `Vary`

`Vary` tells caches which request headers affect response selection.

Example:

```http
Vary: Accept-Language
```

If missing, cache may serve English representation to Indonesian clients or JSON to XML clients depending on system behavior.

---

## 18. Content Negotiation

Content negotiation lets client and server choose representation.

Request:

```http
GET /applications/123
Accept: application/json
Accept-Language: id-ID
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Content-Language: id-ID
Vary: Accept-Language, Accept
```

Common API simplification:

```text
Only support application/json.
Reject unsupported Accept with 406 or ignore based on policy.
Reject unsupported Content-Type with 415.
```

Do not overcomplicate unless you need multiple representations.

But if your API supports JSON, PDF, CSV, and XML for the same resource, content negotiation becomes important.

---

## 19. Request Body Semantics

A request body does not have the same meaning for every method.

Common patterns:

```text
POST body   command, creation representation, processing input
PUT body    full replacement representation
PATCH body  patch document
GET body    generally avoid for public APIs
DELETE body controversial; avoid unless tightly controlled
```

### 19.1 `PUT` vs `PATCH`

`PUT` usually means replace the target resource representation.

```http
PUT /users/42/profile
Content-Type: application/json

{
  "name": "Fajar",
  "timezone": "Asia/Jakarta"
}
```

If `phone` existed and is omitted, does it get deleted? For `PUT`, often yes if full replacement semantics apply. But many APIs implement partial update via `PUT`, which creates confusion.

`PATCH` means partial modification.

```http
PATCH /users/42/profile
Content-Type: application/merge-patch+json

{
  "timezone": "Asia/Jakarta"
}
```

But PATCH must define patch document semantics.

Options:

```text
application/json-patch+json
application/merge-patch+json
custom domain patch
```

### 19.2 Commands Are Sometimes Better Than Fake Resources

For workflows, command endpoints can be clearer:

```http
POST /applications/123/approval-decisions
```

Payload:

```json
{
  "decision": "APPROVED",
  "reason": "Checks passed",
  "idempotencyKey": "approval-123-v17-user42"
}
```

This is not "less professional" than forcing everything into `PUT /status`.

The important point is explicit semantics.

---

## 20. Designing HTTP APIs Around Workflows

In enterprise systems, many operations are not CRUD. They are workflow transitions.

Examples:

```text
submit application
assign case
request clarification
approve application
reject application
escalate enforcement case
generate report
send correspondence
sync external profile
```

Bad CRUD-only modelling:

```http
PUT /applications/123
{
  "status": "APPROVED"
}
```

Problems:

- hides transition rule;
- unclear actor intent;
- unclear audit event;
- unclear side effects;
- hard to validate state machine;
- hard to design idempotency;
- unclear authorization boundary.

Better command-style resource:

```http
POST /applications/123/approval-decisions
Content-Type: application/json
Idempotency-Key: approval-123-v17-user42

{
  "decision": "APPROVED",
  "reason": "All required checks passed"
}
```

Response:

```http
HTTP/1.1 200 OK
ETag: "application-123-v18"
Content-Type: application/json

{
  "applicationId": "123",
  "previousStatus": "PENDING_APPROVAL",
  "currentStatus": "APPROVED",
  "decisionId": "dec-9988"
}
```

Or async:

```http
HTTP/1.1 202 Accepted
Location: /application-transition-jobs/job-7788
```

This is more honest.

---

## 21. HTTP and State Machines

A strong API around workflows should align with state machine rules.

Example states:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
PENDING_CLARIFICATION
APPROVED
REJECTED
WITHDRAWN
```

Transitions:

```text
DRAFT -> SUBMITTED
SUBMITTED -> UNDER_REVIEW
UNDER_REVIEW -> PENDING_CLARIFICATION
UNDER_REVIEW -> APPROVED
UNDER_REVIEW -> REJECTED
PENDING_CLARIFICATION -> UNDER_REVIEW
```

HTTP design should expose operations that respect transitions:

```http
POST /applications/123/submissions
POST /applications/123/review-assignments
POST /applications/123/clarification-requests
POST /applications/123/approval-decisions
POST /applications/123/rejection-decisions
```

Conflict response:

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/invalid-state-transition",
  "title": "Invalid state transition",
  "status": 409,
  "detail": "Application 123 is already REJECTED and cannot be approved.",
  "errorCode": "APPLICATION_INVALID_TRANSITION",
  "currentState": "REJECTED",
  "allowedTransitions": []
}
```

A top-tier engineer does not separate API design from domain invariants.

---

## 22. Idempotency Keys for Unsafe Operations

For non-idempotent operations, use idempotency keys.

Useful for:

- payment creation;
- application submission;
- approval decision;
- email sending;
- document generation;
- external system sync;
- report job creation;
- case assignment;
- any operation where duplicate side effects are dangerous.

Request:

```http
POST /correspondence/email-send-requests
Idempotency-Key: email-case-123-template-abc-20260618T101530
Content-Type: application/json

{
  "caseId": "123",
  "templateId": "abc",
  "recipient": "user@example.com"
}
```

Server behavior:

```text
If key is new:
  process operation
  store key + request fingerprint + response/result
  return result

If key exists with same request fingerprint:
  return same result

If key exists with different request fingerprint:
  return 409 Conflict or 422 validation error
```

Storage design:

```text
idempotency_key
request_hash
status
response_status
response_body_reference
created_at
expires_at
actor_id
operation_type
```

Important rules:

1. Key must be scoped by actor/tenant/operation.
2. Key must have expiry policy.
3. Key must protect against concurrent duplicate attempts.
4. Request fingerprint prevents key reuse with different payload.
5. Return consistent response for duplicate attempts.
6. Store enough to reconcile after crash.
7. Do not treat idempotency as only a client concern.

---

## 23. Retry Semantics at HTTP Level

Do not retry based only on exception class.

Consider:

```text
method
idempotency
status code
timeout phase
body sent or not
server may have processed or not
idempotency key present or absent
deadline budget
Retry-After header
rate limit policy
```

Usually safer to retry:

```text
GET
HEAD
OPTIONS
PUT when truly idempotent
DELETE when semantics tolerate duplicate
POST only with idempotency key or documented safe retry
```

Possible retryable statuses:

```text
408 Request Timeout
429 Too Many Requests
500 sometimes
502 often
503 often
504 with caution
```

But even this is not absolute.

A `504` after `POST /payments` may mean:

```text
payment succeeded but response got lost
```

A `503` from overload may become worse if all clients retry immediately.

Retry must include:

```text
max attempts
overall deadline
exponential backoff
jitter
retry budget
status/method policy
idempotency awareness
observability
```

---

## 24. Authentication and Authorization Semantics

HTTP has standard auth concepts, but real systems combine them with application security.

Common headers:

```http
Authorization: Bearer <token>
WWW-Authenticate: Bearer realm="api"
```

Status distinction:

```text
401 Unauthorized    authentication missing/invalid/expired
403 Forbidden       authenticated but not permitted
404 Not Found       resource absent or intentionally hidden
```

Example expired token:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer error="invalid_token", error_description="The access token expired"
```

Example insufficient role:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "You do not have permission to approve this application.",
  "errorCode": "INSUFFICIENT_PERMISSION"
}
```

Security-sensitive systems may intentionally hide existence:

```http
HTTP/1.1 404 Not Found
```

instead of:

```http
HTTP/1.1 403 Forbidden
```

But this must be consistent and documented internally.

---

## 25. Java Client Perspective

Using Java 11+ JDK `HttpClient`:

```java
HttpClient client = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(3))
    .followRedirects(HttpClient.Redirect.NORMAL)
    .version(HttpClient.Version.HTTP_2)
    .build();

HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.example.com/applications/123"))
    .timeout(Duration.ofSeconds(5))
    .header("Accept", "application/json")
    .GET()
    .build();

HttpResponse<String> response = client.send(
    request,
    HttpResponse.BodyHandlers.ofString()
);

int status = response.statusCode();
String body = response.body();
```

Do not immediately parse body and ignore status.

Bad:

```java
ApplicationDto dto = objectMapper.readValue(response.body(), ApplicationDto.class);
```

Better:

```java
int status = response.statusCode();

if (status >= 200 && status < 300) {
    return objectMapper.readValue(response.body(), ApplicationDto.class);
}

if (status == 404) {
    throw new ApplicationNotFoundException(applicationId);
}

if (status == 409 || status == 412) {
    ProblemDetail problem = objectMapper.readValue(response.body(), ProblemDetail.class);
    throw new ConcurrencyOrConflictException(problem);
}

if (status == 429 || status == 503) {
    Optional<Duration> retryAfter = parseRetryAfter(response.headers());
    throw new RetryableRemoteException(status, retryAfter);
}

if (status >= 500) {
    throw new RemoteServiceException(status, response.body());
}

throw new RemoteClientException(status, response.body());
```

### 25.1 A Semantic Java HTTP Client Wrapper

A production-grade wrapper should centralize:

```text
base URL
timeout
deadline
headers
auth
correlation/trace propagation
idempotency key
status mapping
problem detail parsing
retry policy
metrics
logging
redaction
```

Example shape:

```java
public final class ApplicationApiClient {
    private final HttpClient httpClient;
    private final URI baseUri;
    private final ObjectMapper objectMapper;

    public ApplicationDto getApplication(String id, RequestContext ctx) {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(baseUri.resolve("/applications/" + urlEncode(id)))
            .timeout(ctx.remainingDeadlineOr(Duration.ofSeconds(5)))
            .header("Accept", "application/json")
            .header("traceparent", ctx.traceparent())
            .GET()
            .build();

        return sendJson(request, ApplicationDto.class, ctx);
    }

    public DecisionResult approve(String id, ApproveApplicationCommand command, RequestContext ctx) {
        String body = toJson(command);

        HttpRequest request = HttpRequest.newBuilder()
            .uri(baseUri.resolve("/applications/" + urlEncode(id) + "/approval-decisions"))
            .timeout(ctx.remainingDeadlineOr(Duration.ofSeconds(10)))
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .header("Idempotency-Key", command.idempotencyKey())
            .header("traceparent", ctx.traceparent())
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();

        return sendJson(request, DecisionResult.class, ctx);
    }

    private <T> T sendJson(HttpRequest request, Class<T> type, RequestContext ctx) {
        // Centralized send, metrics, tracing, retry policy, status mapping, problem parsing.
        throw new UnsupportedOperationException("example skeleton");
    }
}
```

Do not scatter raw HTTP behavior across service classes.

---

## 26. Java Server Perspective

Whether using Spring MVC, Spring WebFlux, JAX-RS, Quarkus, Micronaut, Helidon, or Servlet directly, the server must respect HTTP semantics.

Controller-level bad pattern:

```java
@PostMapping("/application/get")
public ResponseEntity<?> get(@RequestBody Query query) {
    return ResponseEntity.ok(service.search(query));
}
```

Better for simple search:

```http
GET /applications?status=PENDING_REVIEW&page=0&size=50
```

For complex search that cannot fit URI constraints:

```http
POST /application-searches
Content-Type: application/json
```

Response could be:

```http
HTTP/1.1 200 OK
Cache-Control: no-store
Content-Type: application/json
```

or if creating an async search job:

```http
HTTP/1.1 202 Accepted
Location: /application-search-jobs/job-123
```

### 26.1 Server Error Handling

Centralize exception-to-status mapping.

Example conceptual mapping:

```text
ValidationException               -> 400 or 422
AuthenticationException           -> 401
AccessDeniedException             -> 403
ResourceNotFoundException         -> 404
StateConflictException            -> 409
OptimisticLockException           -> 412
UnsupportedMediaTypeException     -> 415
RateLimitExceededException        -> 429
DependencyUnavailableException    -> 503
UnexpectedException               -> 500
```

Make sure framework default error pages do not leak HTML to API clients.

---

## 27. HTTP Semantics Through Proxies and Gateways

In production, your Java service may be behind:

```text
browser
corporate proxy
CDN
WAF
API gateway
reverse proxy
load balancer
service mesh sidecar
ingress controller
```

These intermediaries often interpret HTTP semantics.

They may:

- cache `GET`;
- reject large headers;
- normalize paths;
- strip hop-by-hop headers;
- rewrite `Host`;
- add `X-Forwarded-*`;
- terminate TLS;
- enforce body size limits;
- retry idempotent requests;
- buffer request/response bodies;
- transform errors into HTML;
- return 502/503/504 before your app sees anything.

Therefore, HTTP correctness is not only between your Java code and another Java code. It is a contract with the whole path.

---

## 28. Hop-by-Hop vs End-to-End Headers

Some headers apply only to a single transport connection. Others apply end-to-end.

Hop-by-hop examples:

```text
Connection
Keep-Alive
Transfer-Encoding
TE
Trailer
Upgrade
Proxy-Authorization
Proxy-Authenticate
```

End-to-end examples:

```text
Authorization
Content-Type
Cache-Control
ETag
Accept
traceparent
```

A proxy must not blindly forward hop-by-hop headers as if they were end-to-end semantics.

This becomes important in:

- custom proxies;
- gateway filters;
- service mesh debugging;
- request smuggling defense;
- HTTP/1.1 to HTTP/2 translation;
- WebSocket upgrade paths.

---

## 29. HTTP and Observability

For every HTTP client/server, observe by semantic dimension:

```text
method
route template, not raw URI with IDs
status code
status class
remote service
host
attempt number
retry outcome
timeout phase
request size
response size
duration histogram
error type
idempotency key presence, not value
correlation id / trace id
```

Good metric labels:

```text
http.client.request.duration{method="GET", route="/applications/{id}", status="200", remote_service="case-api"}
```

Bad metric labels:

```text
http.client.request.duration{url="/applications/123456789"}
```

High-cardinality labels destroy metrics systems.

### 29.1 Logs

Log:

```text
method
route
status
duration
correlation id
remote service
attempt
exception class
timeout phase
```

Do not log:

```text
Authorization header
cookie
full PII body
password
access token
refresh token
idempotency key raw value when sensitive
```

### 29.2 Traces

Trace spans should show:

```text
client span
server span
status
error
remote peer
retry attempts if modeled
downstream dependency chain
```

HTTP semantics make traces easier to understand.

---

## 30. HTTP Semantics and Regulatory Systems

For regulatory/case-management systems, HTTP semantics are especially important because many operations have audit, legal, or workflow consequences.

Examples:

```text
submit application
approve license
reject renewal
assign investigation
issue notice
send correspondence
freeze account
escalate enforcement case
close case
```

These are not casual CRUD updates.

Design concerns:

```text
who performed action
what state transition occurred
what preconditions were checked
what representation/version was used
whether duplicate request can repeat side effect
whether timeout leaves uncertain outcome
whether error response is auditable
whether retry can alter legal record
whether cached response can show stale decision
```

A strong API design may include:

```text
POST command resource
Idempotency-Key
If-Match
correlation id
problem detail error
state transition response
audit event id
no-store for sensitive data
explicit 409/412 distinction
```

Example:

```http
POST /cases/CASE-123/escalations
If-Match: "case-CASE-123-v44"
Idempotency-Key: escalation-CASE-123-v44-officer-789
Content-Type: application/json
Accept: application/json

{
  "reasonCode": "HIGH_RISK",
  "remarks": "Escalation required due to repeated non-compliance."
}
```

Response:

```http
HTTP/1.1 200 OK
ETag: "case-CASE-123-v45"
Cache-Control: no-store
Content-Type: application/json

{
  "caseId": "CASE-123",
  "previousState": "UNDER_REVIEW",
  "currentState": "ESCALATED",
  "transitionId": "TRN-9988",
  "auditEventId": "AUD-5566"
}
```

This is much stronger than:

```http
POST /updateCase
```

---

## 31. Anti-Patterns

### 31.1 Always Returning `200`

Bad:

```http
HTTP/1.1 200 OK

{
  "error": true,
  "message": "Unauthorized"
}
```

Consequences:

- gateways see success;
- monitoring underreports errors;
- clients parse body for control flow;
- retry logic fails;
- security tooling loses signal.

### 31.2 Using `GET` for Mutations

Bad:

```http
GET /users/42/delete
GET /applications/123/approve
```

Consequences:

- accidental execution;
- crawler/prefetch risk;
- unsafe caching;
- retry ambiguity.

### 31.3 Retrying `POST` Without Idempotency

Bad:

```text
POST times out.
Client retries.
Server performs operation twice.
```

Fix:

```text
idempotency key
operation store
request fingerprint
deduplication
status reconciliation endpoint
```

### 31.4 Ignoring `Content-Type`

Bad:

```text
Server accepts anything and tries to parse JSON.
```

Fix:

```text
Reject unsupported media type with 415.
```

### 31.5 Domain Conflict as `500`

Bad:

```text
User tries invalid transition.
Server returns 500.
```

Fix:

```text
Return 409 Conflict with clear problem detail.
```

### 31.6 Optimistic Lock Failure as Generic Validation Error

Bad:

```text
412/409-worthy conflict returned as "Invalid request".
```

Fix:

```text
Use If-Match + 412 Precondition Failed.
```

### 31.7 Leaking Framework Errors

Bad:

```text
Whitelabel error page
HTML stack trace
Tomcat default error response
```

Fix:

```text
consistent problem+json response
redaction
correlation id
central error handling
```

---

## 32. HTTP Design Checklist

Before publishing an API, ask:

### Resource and Method

```text
Does the URI identify a resource, collection, command, or job clearly?
Is the method semantically appropriate?
Is the operation safe?
Is it idempotent?
If not idempotent, is there an idempotency strategy?
```

### Status Codes

```text
Are success statuses meaningful?
Are validation/domain/security/concurrency failures mapped clearly?
Are 5xx used only for real server/dependency failure?
Does async operation use 202 + Location?
Does creation use 201 + Location?
```

### Headers

```text
Are Content-Type and Accept handled correctly?
Are cache headers explicit?
Are ETags used where concurrency matters?
Is Location used for created resources/jobs/redirects?
Is Retry-After used for 429/503/202 when helpful?
Is trace/correlation propagated?
```

### Body

```text
Is response schema stable?
Is error schema stable?
Are unknown fields tolerated?
Are sensitive fields excluded?
Are large payloads streamed or paginated?
```

### Caching

```text
Can this response be cached?
Should it be no-store?
Does Vary reflect content negotiation?
Are ETag/Last-Modified validators correct?
```

### Retry and Failure

```text
Can client retry safely?
What happens if response is lost after server commits?
What happens if client times out?
Can duplicate request be detected?
Is there a reconciliation endpoint?
```

### Security

```text
Are auth failures 401/403/404 consistently?
Are redirects safe?
Are headers sanitized?
Are request sizes limited?
Are error details redacted?
```

### Observability

```text
Are method, route, status, duration, and correlation id visible?
Are metrics low-cardinality?
Are retries observable?
Are status codes meaningful for dashboards?
```

---

## 33. Java 8–25 Perspective

### Java 8 Era

Typical HTTP clients:

```text
HttpURLConnection
Apache HttpClient
OkHttp
Jersey client
Spring RestTemplate
Netty-based clients
```

Common concerns:

```text
connection pooling library-specific
timeout configuration inconsistent
async support library-specific
HTTP/2 not standard in JDK client
```

### Java 11+

The JDK introduced `java.net.http.HttpClient` as the standard modern HTTP client.

Important traits:

```text
immutable client after build
sync send
async sendAsync
HTTP/1.1 and HTTP/2 support
WebSocket API in same module
builder-based configuration
BodyPublisher / BodyHandler abstraction
```

### Java 21–25 Era

Modern Java changes the concurrency strategy:

```text
virtual threads make blocking-style code scalable for many I/O-bound tasks
structured concurrency helps coordinate related concurrent subtasks
scoped values help context propagation in structured code
```

But HTTP semantics do not change:

```text
safe/idempotent/cacheable still matters
timeouts still matter
connection pools still matter
remote overload still matters
rate limits still matter
payload size still matters
retry correctness still matters
```

Virtual threads reduce the pain of blocking threads. They do not make remote systems infinitely fast.

---

## 34. Mini Case Study: Report Generation API

### Bad Design

```http
POST /getReport
Content-Type: application/json

{
  "month": "2026-06"
}
```

Response:

```http
HTTP/1.1 200 OK

{
  "success": true,
  "url": "/download/abc"
}
```

Problems:

```text
POST used for read-like operation
unclear whether report is generated or retrieved
no async job semantics
no cache semantics
no idempotency
no status resource
generic success body
download URL unclear
```

### Better Design: Existing Report Retrieval

```http
GET /reports/monthly/2026-06
Accept: application/pdf
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/pdf
Cache-Control: private, no-cache
ETag: "monthly-report-2026-06-v3"
```

### Better Design: Async Report Generation

```http
POST /report-generation-jobs
Idempotency-Key: monthly-report-2026-06-user-42
Content-Type: application/json
Accept: application/json

{
  "type": "MONTHLY",
  "month": "2026-06",
  "format": "PDF"
}
```

Response:

```http
HTTP/1.1 202 Accepted
Location: /report-generation-jobs/job-7788
Retry-After: 10
Content-Type: application/json

{
  "jobId": "job-7788",
  "status": "QUEUED"
}
```

Status check:

```http
GET /report-generation-jobs/job-7788
```

Completed:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "jobId": "job-7788",
  "status": "COMPLETED",
  "report": {
    "href": "/reports/monthly/2026-06",
    "contentType": "application/pdf"
  }
}
```

This design gives:

```text
clear async semantics
retry safety through idempotency key
status resource
download resource
cache control
observability
operational clarity
```

---

## 35. Mini Case Study: Approval Decision API

### Weak Design

```http
POST /application/updateStatus
Content-Type: application/json

{
  "id": "APP-123",
  "status": "APPROVED"
}
```

Problems:

```text
generic update hides command intent
no version precondition
no idempotency
unclear audit event
state transition error likely mapped poorly
duplicate POST can create duplicate notification
```

### Stronger Design

```http
POST /applications/APP-123/approval-decisions
If-Match: "app-APP-123-v17"
Idempotency-Key: approve-APP-123-v17-user-42
Content-Type: application/json
Accept: application/json

{
  "reason": "All eligibility checks passed."
}
```

Success:

```http
HTTP/1.1 200 OK
ETag: "app-APP-123-v18"
Cache-Control: no-store
Content-Type: application/json

{
  "applicationId": "APP-123",
  "previousStatus": "PENDING_APPROVAL",
  "currentStatus": "APPROVED",
  "decisionId": "DEC-9988",
  "auditEventId": "AUD-12345"
}
```

Concurrent modification:

```http
HTTP/1.1 412 Precondition Failed
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/precondition-failed",
  "title": "Resource version mismatch",
  "status": 412,
  "detail": "Application APP-123 has changed since it was loaded.",
  "errorCode": "RESOURCE_VERSION_MISMATCH"
}
```

Invalid transition:

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/invalid-state-transition",
  "title": "Invalid state transition",
  "status": 409,
  "detail": "Application APP-123 is already REJECTED.",
  "errorCode": "APPLICATION_INVALID_TRANSITION"
}
```

This is not just cleaner API design. It is safer workflow design.

---

## 36. Exercises

### Exercise 1 — Method Classification

Classify each operation as `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`.

1. Retrieve application by ID.
2. Submit draft application.
3. Replace user notification preference.
4. Partially update user phone number.
5. Delete uploaded document.
6. Generate monthly report asynchronously.
7. Approve application.
8. Search cases with 20 complex filters.
9. Download PDF file.
10. Resend failed email notification.

For each, explain:

```text
safe?
idempotent?
needs idempotency key?
needs ETag / If-Match?
cacheable?
expected status codes?
```

### Exercise 2 — Status Code Mapping

Map these situations:

1. JSON syntax invalid.
2. Auth token expired.
3. User authenticated but lacks permission.
4. Application not found.
5. Application already rejected but user tries approve.
6. User submits update based on stale version.
7. External dependency down.
8. API gateway timeout.
9. Rate limit exceeded.
10. Created new resource successfully.

### Exercise 3 — Design a Problem Detail

Design a `problem+json` response for:

```text
Officer tries to assign a case that is already exclusively assigned to another officer.
```

Include:

```text
status
type
title
detail
errorCode
correlationId
caseId
currentAssignee maybe if allowed by security policy
```

### Exercise 4 — Retry Policy

Given:

```http
POST /payments
```

Client receives:

```http
504 Gateway Timeout
```

Question:

```text
Should the client retry?
What if Idempotency-Key was present?
What if no idempotency key?
What status reconciliation endpoint would you design?
```

### Exercise 5 — Conditional Request

Design HTTP request/response sequence for:

```text
User opens case v9.
Another user updates case to v10.
First user tries to close case using stale view.
```

Use:

```text
ETag
If-Match
412 Precondition Failed
problem+json
```

---

## 37. Key Takeaways

1. HTTP is not just transport. It carries semantics.
2. Method choice affects safety, idempotency, caching, retry, and tooling behavior.
3. Status code correctness is operational correctness.
4. `200 OK` with body-level errors is an observability and client-design smell.
5. `GET` must not perform requested business mutation.
6. Non-idempotent operations need explicit idempotency strategy.
7. Conditional requests are powerful tools for optimistic concurrency.
8. `409 Conflict` and `412 Precondition Failed` are different.
9. Headers are contract, not decoration.
10. Caching must be explicit for sensitive or dynamic resources.
11. Redirect behavior can change method/body/security assumptions.
12. Error responses should be machine-readable and stable.
13. Java HTTP client/server code should centralize semantic handling.
14. Virtual threads and modern clients improve implementation ergonomics, but they do not change HTTP semantics.
15. Strong API design aligns protocol, domain invariants, failure behavior, and observability.

---

## 38. References

- RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
- RFC 9111 — HTTP Caching: https://www.rfc-editor.org/rfc/rfc9111.html
- RFC 9112 — HTTP/1.1: https://www.rfc-editor.org/rfc/rfc9112.html
- RFC 9457 — Problem Details for HTTP APIs: https://www.rfc-editor.org/rfc/rfc9457.html
- MDN — HTTP conditional requests: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Conditional_requests
- MDN — If-Match: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/If-Match
- MDN — If-None-Match: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/If-None-Match
- Oracle Java SE 25 — `java.net.http.HttpClient`: https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpClient.html
- Oracle Java SE 25 — `java.net.http` module: https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/module-summary.html

---

## 39. Series Progress

```text
Part 7 of 35 selesai.
Seri belum selesai.
Part berikutnya: Part 8 — HTTP/1.1 Deep Dive: Connections, Pipelining, Chunking, Keep-Alive, and Head-of-Line Blocking
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 6 — Serialization on the Wire: JSON, XML, Protobuf, Avro, CBOR, and Java Object Serialization Risks](./006-serialization-on-the-wire-json-xml-protobuf-avro-cbor-java-object-serialization-risks.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 8 — HTTP/1.1 Deep Dive: Connections, Pipelining, Chunking, Keep-Alive, and Head-of-Line Blocking](./008-http11-deep-dive-connections-pipelining-chunking-keepalive-head-of-line-blocking.md)

</div>