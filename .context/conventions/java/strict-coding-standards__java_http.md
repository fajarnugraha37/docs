# Strict Coding Standards — Java HTTP

Status: mandatory standard for LLM-generated Java code  
Scope: HTTP API design, HTTP clients, HTTP-facing adapters, REST-like resources, webhook clients, internal service-to-service HTTP, and Java `java.net.http.HttpClient` usage  
Applies with: `strict-coding-standards__java11.md`, `java17.md`, `java21.md`, `java25.md`, `java_network.md`, `java_json.md`, `java_xml.md`, `java_security.md`, `java_time_date.md`, and project-specific framework rules

---

## 1. Core Contract

LLM-generated Java HTTP code MUST be correct at the protocol boundary before it is clever in implementation.

HTTP code MUST explicitly define:

1. the resource or remote capability being accessed;
2. the HTTP method semantics;
3. request and response media types;
4. status-code contract;
5. timeout policy;
6. retry/idempotency policy;
7. authentication/authorization boundary;
8. validation boundary;
9. error contract;
10. observability contract.

If any of those are unknown, the LLM MUST choose a safe minimal implementation and leave an explicit `TODO`/decision note instead of inventing semantics.

---

## 2. HTTP Is Not Just Transport

HTTP semantics are part of the correctness model.

### 2.1 Mandatory semantic rules

| Method | Allowed meaning | Strict rule |
|---|---|---|
| `GET` | read representation | MUST NOT mutate durable server state intentionally |
| `HEAD` | read metadata only | MUST behave like `GET` without body |
| `POST` | create, command, submit, non-idempotent operation | MUST NOT be blindly retried unless idempotency key or explicit safe retry contract exists |
| `PUT` | replace/upsert known resource | SHOULD be idempotent |
| `PATCH` | partial update | MUST define patch format and concurrency behavior |
| `DELETE` | delete/cancel resource | SHOULD be idempotent at HTTP effect level |
| `OPTIONS` | capability discovery/preflight | MUST NOT implement business mutation |

Forbidden examples:

```http
GET /cases/123/approve
GET /users/delete?id=9
POST /get-user
PUT /cases/123/partial-update-with-hidden-merge
```

Required style:

```http
POST /cases/123/approval-requests
DELETE /sessions/{sessionId}
GET /users/{userId}
PATCH /cases/{caseId}
Content-Type: application/merge-patch+json
```

---

## 3. URI and Resource Design

### 3.1 URI rules

URIs MUST represent resources or stable remote capabilities.

Required:

- Use nouns for resources.
- Use plural collection names unless project convention says otherwise.
- Use path parameters for resource identity.
- Use query parameters for filtering, sorting, pagination, field selection, and optional modifiers.
- Use hyphenated lowercase path segments for public APIs.
- Avoid exposing internal table names, class names, package names, or database IDs unless those IDs are stable domain identifiers.

Allowed:

```http
GET /cases/{caseId}
GET /cases?status=OPEN&page=0&size=50
POST /cases/{caseId}/assignment-requests
GET /officers/{officerId}/workload-summary
```

Forbidden:

```http
GET /CaseService/getCaseById?id=123
POST /doApproveCase
GET /tbl_case_master/123
GET /cases?sql=...
```

### 3.2 Command resources

When a business operation is not naturally CRUD, use an explicit command-like sub-resource.

Allowed:

```http
POST /cases/{caseId}/approval-requests
POST /cases/{caseId}/reopen-requests
POST /payments/{paymentId}/refund-requests
```

Forbidden:

```http
PUT /cases/{caseId}?action=approve
GET /approveCase/{caseId}
```

---

## 4. Status Code Contract

Every endpoint/client integration MUST define expected status codes.

### 4.1 Success codes

| Code | Use |
|---|---|
| `200 OK` | Successful read or command with response body |
| `201 Created` | New resource created; SHOULD include `Location` header |
| `202 Accepted` | Async command accepted but not completed |
| `204 No Content` | Successful operation with no response body |
| `206 Partial Content` | Explicit range response only |

Rules:

- `201` MUST NOT be returned unless a resource has actually been created.
- `202` MUST include a way to observe eventual outcome when operation is asynchronous.
- `204` MUST NOT include a response body.

### 4.2 Client error codes

| Code | Use |
|---|---|
| `400 Bad Request` | syntactically invalid request or invalid shape |
| `401 Unauthorized` | missing/invalid authentication |
| `403 Forbidden` | authenticated but not allowed |
| `404 Not Found` | resource absent or intentionally hidden |
| `405 Method Not Allowed` | method not supported for resource |
| `409 Conflict` | state conflict, version conflict, duplicate command conflict |
| `412 Precondition Failed` | failed `If-Match`/precondition |
| `415 Unsupported Media Type` | unsupported request content type |
| `422 Unprocessable Content` | syntactically valid request with semantic validation errors, if project uses it |
| `429 Too Many Requests` | rate limit/throttle |

### 4.3 Server error codes

| Code | Use |
|---|---|
| `500 Internal Server Error` | unexpected server failure |
| `502 Bad Gateway` | upstream invalid response |
| `503 Service Unavailable` | temporary outage/capacity/dependency unavailable |
| `504 Gateway Timeout` | upstream timeout |

Rules:

- Do not map all exceptions to `500`.
- Do not leak stack traces or internal class names in response bodies.
- Do not convert authorization failures into validation errors.
- Do not return `200` with an error payload.

---

## 5. Error Response Standard

HTTP error responses MUST be machine-readable and stable.

Default format SHOULD be RFC 9457 Problem Details when compatible with the project.

Required fields:

```json
{
  "type": "https://example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "One or more fields are invalid.",
  "instance": "/cases/123/approval-requests",
  "code": "CASE_VALIDATION_FAILED",
  "correlationId": "..."
}
```

Rules:

- `type` MUST be stable and documented.
- `title` MUST be safe for clients.
- `detail` MUST NOT contain secrets, stack traces, SQL, LDAP filters, file paths, or internal hostnames.
- `code` MUST be stable for client branching.
- field-level validation errors MUST use stable field names from API DTOs, not entity/database fields unless identical by contract.
- correlation ID MUST be included where platform supports it.

Forbidden:

```json
{"success": false, "message": "NullPointerException at CaseServiceImpl.java:73"}
```

---

## 6. Request Validation Boundary

All HTTP inputs are untrusted.

The resource/controller/client adapter MUST validate:

- path parameters;
- query parameters;
- headers that affect behavior;
- request body shape;
- body size;
- content type;
- enum values;
- date/time formats;
- numeric ranges;
- string length;
- tenant/user identity binding;
- pagination bounds;
- sorting allow-list.

Rules:

- Do not trust client-supplied user ID, tenant ID, role, or ownership attributes without comparing to authenticated context.
- Do not pass raw HTTP DTOs directly into domain mutation without validation and mapping.
- Do not use entity classes as request DTOs.
- Do not silently ignore critical unknown fields for mutation APIs unless compatibility policy explicitly requires it.

---

## 7. DTO and Serialization Rules

### 7.1 DTO separation

HTTP DTOs MUST be separate from:

- JPA entities;
- domain aggregates;
- persistence records;
- external provider DTOs;
- generated gRPC/protobuf messages.

Allowed mapping:

```text
HTTP Request DTO -> Application Command -> Domain Model -> Persistence Model
Domain/Application Result -> HTTP Response DTO
```

Forbidden:

```text
HTTP Request Body -> JPA Entity -> repository.merge(entity)
```

### 7.2 JSON rules

- Use explicit JSON property names for public APIs.
- Use ISO-8601 date/time strings.
- Use string or minor-unit integer for money; do not use floating-point money.
- Use `BigDecimal` for exact decimal values.
- Define null vs missing semantics.
- Define unknown-field behavior.
- Define collection ordering if clients depend on it.

### 7.3 XML/multipart rules

- XML parsing MUST follow `strict-coding-standards__java_xml.md`.
- Multipart upload MUST enforce size, count, filename, content type, and storage path policy.
- File names from clients MUST NOT be used as storage paths.

---

## 8. Headers

### 8.1 Required header discipline

HTTP code MUST explicitly handle relevant headers:

| Header | Rule |
|---|---|
| `Content-Type` | Required for request bodies |
| `Accept` | Must be respected or rejected where API supports negotiation |
| `Authorization` | Must never be logged raw |
| `Location` | Required for `201 Created` when applicable |
| `ETag` | Required when optimistic HTTP concurrency is supported |
| `If-Match` | Use for lost-update prevention where exposed over HTTP |
| `Retry-After` | SHOULD be returned for `429`/`503` when retry is appropriate |
| `Cache-Control` | MUST be explicit for sensitive responses |
| `Correlation-Id` / `X-Correlation-Id` | SHOULD be propagated using project standard |
| `Idempotency-Key` | Required for retryable non-idempotent POST semantics |

Rules:

- Do not invent non-standard headers if standard headers fit.
- Do not propagate all inbound headers blindly to downstream services.
- Do not log cookies, authorization tokens, API keys, or session identifiers.

---

## 9. Caching and Conditional Requests

Caching MUST be explicit.

Sensitive APIs MUST default to:

```http
Cache-Control: no-store
```

Public/read-heavy APIs MAY use caching if the resource owner approves:

```http
Cache-Control: public, max-age=60
ETag: "..."
```

Rules:

- Do not cache personalized or authorization-dependent responses without `private`/`Vary` strategy.
- Do not emit `ETag` unless update/concurrency behavior is understood.
- Use `If-Match` for update preconditions when preventing lost updates at HTTP layer.
- Use `If-None-Match` for client-side cache revalidation when read caching is supported.

---

## 10. Java `HttpClient` Rules

Java 11+ code SHOULD prefer `java.net.http.HttpClient` for direct HTTP integrations unless the project standard uses another client.

### 10.1 Client lifecycle

Required:

- Create one configured `HttpClient` per remote service/client policy.
- Reuse the client.
- Do not create a new client per request.
- Configure connect timeout.
- Configure redirect policy intentionally.
- Configure executor intentionally if async behavior is used and project needs thread ownership.

Allowed:

```java
final class CaseRegistryHttpClient {
    private final HttpClient httpClient;
    private final URI baseUri;

    CaseRegistryHttpClient(URI baseUri) {
        this.baseUri = requireHttpsBaseUri(baseUri);
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(3))
                .followRedirects(HttpClient.Redirect.NEVER)
                .version(HttpClient.Version.HTTP_2)
                .build();
    }
}
```

Forbidden:

```java
HttpClient.newHttpClient().send(request, BodyHandlers.ofString()); // inside every service method
```

### 10.2 Request timeout

Every request MUST have a timeout.

```java
HttpRequest request = HttpRequest.newBuilder(baseUri.resolve("/cases/" + caseId))
        .timeout(Duration.ofSeconds(5))
        .header("Accept", "application/json")
        .GET()
        .build();
```

Rules:

- connect timeout is not enough.
- request timeout must be per call or per operation class.
- long polling/streaming must document longer timeout explicitly.
- timeout must be lower than upstream caller deadline where possible.

### 10.3 Body handling

Rules:

- Do not use `BodyHandlers.ofString()` for unbounded large responses.
- Use streaming/file handlers for large payloads.
- Enforce response size limits at adapter boundary.
- Specify charset when converting bytes/text if durable or cross-system.
- Do not deserialize JSON/XML before checking status code and content type.

### 10.4 Async HTTP

Allowed only when:

- concurrency need is real;
- executor/thread ownership is understood;
- cancellation is propagated;
- timeout exists;
- exceptional completion is mapped;
- tests cover success, timeout, failure, cancellation.

Forbidden:

```java
client.sendAsync(request, BodyHandlers.ofString()); // fire-and-forget without observing completion
```

Required:

```java
return client.sendAsync(request, BodyHandlers.ofString())
        .orTimeout(5, TimeUnit.SECONDS)
        .thenApply(this::mapResponse);
```

Even then, prefer `HttpRequest.timeout(...)` for actual HTTP request timeout.

---

## 11. HTTP Client Adapter Standard

Every outbound HTTP integration MUST be isolated behind an adapter/gateway.

Required shape:

```text
application service -> port/interface -> http adapter -> remote service
```

The adapter MUST own:

- base URI;
- path construction;
- authentication header creation;
- serialization/deserialization;
- timeout;
- retry;
- response mapping;
- error mapping;
- metrics/logging;
- correlation propagation.

Application/domain code MUST NOT know:

- remote HTTP paths;
- status code parsing;
- header names except domain-level correlation where approved;
- JSON library details;
- HTTP client library details.

---

## 12. Response Mapping

Outbound HTTP adapters MUST map responses explicitly.

Example:

```java
private CaseSnapshot mapResponse(HttpResponse<String> response) {
    return switch (response.statusCode()) {
        case 200 -> decodeCase(response.body());
        case 404 -> throw new RemoteCaseNotFoundException();
        case 409 -> throw new RemoteCaseConflictException();
        case 429, 503 -> throw new RemoteCaseTemporarilyUnavailableException();
        default -> throw new RemoteCaseProtocolException(response.statusCode());
    };
}
```

Rules:

- Do not treat all `2xx` as success if body contract differs by code.
- Do not parse error body as success DTO.
- Do not ignore `Content-Type`.
- Do not retry on deterministic client errors.
- Do not leak raw remote error messages to end users without sanitization.

---

## 13. Retry, Timeout, and Idempotency

### 13.1 Retry contract

Retries are forbidden unless all conditions are met:

1. operation is idempotent or protected by idempotency key;
2. retryable failure classes are defined;
3. max attempts are bounded;
4. backoff and jitter are used;
5. total deadline is bounded;
6. duplicate side effects are acceptable or prevented;
7. observability identifies retry count.

Retryable by default only when explicitly safe:

- connection reset before request is sent;
- timeout on idempotent read;
- `429` with policy;
- `503` temporary dependency outage;
- selected `502`/`504` when upstream semantics allow.

Never blindly retry:

- `POST` command without idempotency key;
- authentication failure;
- authorization failure;
- validation failure;
- conflict requiring user/domain decision;
- payment/approval/submission mutation without explicit duplicate protection.

### 13.2 Idempotency key

For non-idempotent commands that must be retryable, require:

```http
Idempotency-Key: <client-generated-stable-key>
```

Server-side behavior MUST define:

- deduplication key scope;
- key expiry;
- replay behavior;
- conflict behavior when same key is reused with different payload;
- storage transaction boundary.

---

## 14. Pagination, Sorting, and Filtering

Rules:

- Pagination MUST be bounded.
- Default page size MUST be explicit.
- Maximum page size MUST be enforced.
- Sorting fields MUST use allow-list.
- Filtering fields MUST use allow-list.
- Cursor pagination SHOULD be preferred for large or mutable result sets.
- Offset pagination MUST document consistency caveats.

Forbidden:

```http
GET /cases?sort=someRawSqlExpression
GET /cases?size=1000000
```

Allowed:

```http
GET /cases?status=OPEN&sort=createdAt,desc&page=0&size=50
```

---

## 15. Security Rules

### 15.1 Authentication and authorization

Rules:

- HTTP boundary MUST authenticate before business action.
- Authorization MUST be checked server-side per resource/action.
- Do not trust client-supplied role/tenant/user identifiers.
- Do not use API keys in query strings.
- Do not log bearer tokens, cookies, session IDs, or client secrets.
- For service-to-service calls, use platform-approved credential propagation.

### 15.2 SSRF protection

Any URL influenced by user input is dangerous.

Rules:

- Prefer configured base URIs, never arbitrary user-provided URLs.
- If arbitrary URL fetch is a business requirement, enforce scheme/host/port allow-list.
- Block localhost, loopback, link-local, private networks, metadata IPs, and internal control planes unless explicitly allowed.
- Disable redirects or revalidate every redirect target.
- Revalidate DNS/IP at connection time where feasible.

### 15.3 CORS

CORS MUST be configured explicitly.

Forbidden:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Rules:

- Use explicit origin allow-list.
- Do not expose sensitive headers unnecessarily.
- Keep preflight methods/headers minimal.

---

## 16. Observability

Every HTTP adapter/resource MUST produce safe observability.

Required logs/metrics/traces:

- method;
- route template, not raw full URL with secrets;
- status code;
- duration;
- timeout/failure class;
- retry count;
- remote system name;
- correlation/trace ID;
- payload size class, not raw body by default.

Forbidden logging:

- authorization headers;
- cookies;
- access tokens;
- refresh tokens;
- raw PII payload;
- raw file content;
- full query string if it may contain secrets.

---

## 17. Server-Side Resource/Controller Rules

Resource/controller classes MUST be thin.

Allowed responsibilities:

- parse HTTP inputs;
- validate HTTP shape;
- map DTO to command/query;
- call application service;
- map result to HTTP response;
- map known exceptions to response codes.

Forbidden responsibilities:

- domain decisions;
- transaction orchestration unless framework convention requires boundary there;
- SQL/JPA access;
- remote service orchestration logic;
- business state machine logic;
- security bypass logic;
- reflection magic.

---

## 18. Webhooks

Webhook handlers MUST be treated as untrusted external input.

Required:

- signature verification before parsing expensive body when possible;
- timestamp/replay window;
- idempotency/deduplication by event ID;
- bounded body size;
- schema validation;
- async processing when handler must return quickly;
- safe retry response semantics;
- audit trail of accepted/rejected webhook events.

Forbidden:

- trusting webhook payload user IDs without verification;
- doing irreversible side effects before signature/idempotency checks;
- returning `200` for invalid signature just to silence provider unless explicitly documented.

---

## 19. File Download/Upload over HTTP

File APIs MUST follow `strict-coding-standards__java_io.md` and `java_security.md`.

Upload rules:

- max request size;
- max file count;
- generated storage name;
- content sniffing or allow-list where appropriate;
- antivirus/malware workflow where required;
- quarantine before trust;
- no path from client filename.

Download rules:

- authorization per file;
- safe `Content-Disposition` filename;
- correct `Content-Type`;
- `Cache-Control` based on sensitivity;
- no path traversal;
- support range only when needed and tested.

---

## 20. Testing Requirements

HTTP code MUST include tests for:

- method/path mapping;
- request validation;
- status code mapping;
- error body mapping;
- content type behavior;
- timeout behavior;
- retry behavior;
- auth failure;
- authorization failure;
- rate limit/upstream unavailable;
- large body handling;
- unknown/invalid JSON;
- correlation propagation;
- logging redaction where feasible.

Outbound adapters SHOULD use test servers/mocks that validate actual HTTP request shape, not only mocked Java methods.

---

## 21. LLM HTTP Implementation Protocol

Before writing HTTP code, the LLM MUST answer internally:

1. Is this inbound resource, outbound client, webhook, or proxy?
2. What is the resource/capability?
3. Which method is semantically correct?
4. What are the success status codes?
5. What are the error status codes?
6. Is the operation idempotent?
7. Are retries allowed?
8. What timeout applies?
9. What authentication/authorization applies?
10. What DTOs are exposed?
11. What logging must be redacted?
12. What tests prove the contract?

If the answer is unknown, the LLM MUST choose the safer behavior:

- no retry;
- no redirect;
- no caching;
- explicit timeout;
- explicit content type;
- no raw entity exposure;
- no secret logging.

---

## 22. Forbidden Patterns

The following are forbidden by default:

- `GET` endpoints that mutate business state.
- Returning `200 OK` with error payload for failed business operations.
- Creating `HttpClient` per request.
- HTTP calls without timeout.
- Blind retry of `POST`.
- Trust-all TLS.
- Disabled hostname verification.
- User-supplied URL fetch without SSRF controls.
- Logging `Authorization`, `Cookie`, tokens, secrets, or full sensitive bodies.
- Passing JPA entities directly as HTTP DTOs.
- Swallowing non-2xx responses and returning null.
- Catching `Exception` and returning generic success.
- Dynamic sort/filter mapped directly to SQL identifiers.
- Unbounded `BodyHandlers.ofString()` for large/unknown responses.
- Global mutable HTTP client configuration changed at runtime.

---

## 23. Reviewer Checklist

A Java HTTP change is acceptable only if:

- [ ] method semantics are correct;
- [ ] URI design is stable and resource-oriented;
- [ ] DTOs are explicit and separate from entities;
- [ ] input validation exists;
- [ ] status code mapping is explicit;
- [ ] error response is stable and safe;
- [ ] timeout exists;
- [ ] retry policy is absent or justified;
- [ ] idempotency is addressed;
- [ ] authentication/authorization boundary is clear;
- [ ] sensitive headers/body are not logged;
- [ ] redirects are disabled or controlled;
- [ ] SSRF risk is handled for dynamic URLs;
- [ ] tests cover success/failure/timeout;
- [ ] observability uses route templates and redaction;
- [ ] code respects project Java baseline.

---

## 24. References

- Oracle Java `HttpClient` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.net.http/java/net/http/HttpClient.html
- Oracle Java `java.net.http` module: https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/module-summary.html
- RFC 9110 HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
- RFC 9457 Problem Details for HTTP APIs: https://www.rfc-editor.org/rfc/rfc9457.html
- OWASP SSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP API Security Project: https://owasp.org/API-Security/
