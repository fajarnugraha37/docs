# OpenAPI Mastery for Java Engineers — Part 007

# Responses: Status Codes, Content, Headers, Errors, and Invariants

> Filename: `learn-openapi-mastery-for-java-engineers-part-007.md`  
> Series: `learn-openapi-mastery-for-java-engineers`  
> Part: `007 / 030`  
> Previous: `Part 006 — Request Bodies: Media Types, Content Negotiation, Validation, and Semantics`  
> Next: `Part 008 — Components: Reuse Without Coupling Yourself Into a Corner`

---

## 0. Why This Part Matters

Banyak engineer mendesain response API seperti ini:

```yaml
responses:
  "200":
    description: OK
```

Secara teknis itu bisa terlihat cukup. Secara engineering, itu hampir tidak memberi kontrak yang berguna.

Consumer API tidak hanya butuh tahu bahwa endpoint bisa sukses. Consumer butuh tahu:

- sukses seperti apa yang mungkin terjadi,
- kapan response berisi body dan kapan tidak,
- error apa yang bisa muncul,
- apakah error bisa di-retry,
- apakah konflik bisa diselesaikan,
- apakah resource ditemukan tetapi user tidak punya akses,
- apakah operasi diterima tetapi belum selesai,
- apakah response membawa header penting seperti `Location`, `ETag`, `Retry-After`, atau correlation ID,
- apakah shape error konsisten di seluruh API,
- apakah response schema bisa dipakai untuk generated client, test, monitoring, dan incident diagnosis.

Dalam OpenAPI, response bukan dekorasi. Response adalah bagian utama dari kontrak perilaku API.

OpenAPI Specification mendefinisikan `responses` sebagai container dari expected responses untuk sebuah operation, dan setiap operation harus memiliki response definition. HTTP status code sendiri mengikuti semantik HTTP, di mana status code menjelaskan hasil request dan class response berada pada rentang 1xx sampai 5xx. Untuk error body modern, RFC 9457 mendefinisikan Problem Details for HTTP APIs dan secara eksplisit menggantikan RFC 7807.

Referensi utama:

- OpenAPI Specification v3.2.0 — Responses Object, Response Object, Header Object, Media Type Object.
- RFC 9110 — HTTP Semantics, terutama status code semantics.
- RFC 9457 — Problem Details for HTTP APIs.

---

## 1. Core Mental Model: Response Is a Consumer Decision Contract

Response contract menjawab pertanyaan paling penting dari consumer:

> “Setelah saya memanggil operation ini, apa yang harus saya lakukan?”

Response bukan hanya “data yang dikembalikan server”. Response adalah instruksi implisit untuk caller.

Contoh:

| Response | Meaning for Consumer |
|---|---|
| `200 OK` with resource body | Use returned representation. Operation completed synchronously. |
| `201 Created` with `Location` header | New resource created. Store returned ID or follow `Location`. |
| `202 Accepted` with job resource | Request accepted but not complete. Poll status or wait callback. |
| `204 No Content` | Operation succeeded, no representation to parse. |
| `400 Bad Request` | Request structurally or syntactically invalid. Fix request. |
| `401 Unauthorized` | Authentication missing/invalid. Refresh credentials or login. |
| `403 Forbidden` | Authenticated but not allowed. Do not retry blindly. |
| `404 Not Found` | Resource absent or intentionally hidden. Handle absence. |
| `409 Conflict` | State conflict. Fetch current state or resolve conflict. |
| `412 Precondition Failed` | Conditional request failed. Refresh version/ETag. |
| `422 Unprocessable Content` | Structurally valid but semantically invalid. Show domain validation error. |
| `429 Too Many Requests` | Back off according to rate limit policy. |
| `500`/`502`/`503`/`504` | Server or upstream problem. Retry depending on idempotency and policy. |

Top-tier API design does not ask only:

> “What object do I return?”

It asks:

> “What decision does each response enable?”

---

## 2. OpenAPI Response Structure

A simplified operation response block looks like this:

```yaml
paths:
  /cases/{caseId}:
    get:
      operationId: getCaseById
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Case found.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CaseDetailResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "500":
          $ref: "#/components/responses/InternalServerError"
```

The response object can contain:

```yaml
responses:
  "200":
    description: Human-readable description of this response.
    headers:
      X-Correlation-Id:
        schema:
          type: string
    content:
      application/json:
        schema:
          type: object
    links:
      nextOperation:
        operationId: someOtherOperation
```

Core fields:

| Field | Purpose |
|---|---|
| `description` | Required description of what this response means. |
| `headers` | Response-specific headers. |
| `content` | Response body by media type. |
| `links` | Relationship to possible follow-up operations. |

Important: in OpenAPI, response status keys are strings, not integers:

```yaml
"200":
  description: OK
```

Not:

```yaml
200:
  description: OK
```

Some YAML parsers may tolerate unquoted numeric keys, but quoted status codes are safer and clearer.

---

## 3. The Responses Object: Explicit Codes, Ranges, and Default

OpenAPI allows response keys like:

```yaml
responses:
  "200":
    description: OK
  "404":
    description: Not found
  "5XX":
    description: Any server error
  default:
    description: Unexpected error
```

You can define:

1. Specific status code:

```yaml
"201":
  description: Created
```

2. Range status code:

```yaml
"4XX":
  description: Any client error
```

3. Default response:

```yaml
default:
  description: Unexpected error
```

But there is a practical design rule:

> Use specific status codes for meaningful consumer behavior. Use range/default only as fallback.

Bad:

```yaml
responses:
  default:
    description: Something happened.
```

Better:

```yaml
responses:
  "200":
    description: Case returned.
  "401":
    $ref: "#/components/responses/Unauthorized"
  "403":
    $ref: "#/components/responses/Forbidden"
  "404":
    $ref: "#/components/responses/CaseNotFound"
  "409":
    $ref: "#/components/responses/CaseStateConflict"
  "500":
    $ref: "#/components/responses/InternalServerError"
  default:
    $ref: "#/components/responses/UnexpectedError"
```

Why? Because `401`, `403`, `404`, `409`, and `500` imply different caller decisions.

---

## 4. Response Description Is Not a Placeholder

This is weak:

```yaml
"404":
  description: Not Found
```

This is better:

```yaml
"404":
  description: No case exists for the supplied caseId, or the caller is not allowed to observe its existence.
```

This is even better if the API has a privacy/security policy around existence disclosure:

```yaml
"404":
  description: >
    No visible case exists for the supplied caseId. For resources outside the caller's
    access boundary, the API also returns 404 to avoid disclosing resource existence.
```

Descriptions should clarify:

- what happened,
- whether body exists,
- whether caller should retry,
- whether response is security-filtered,
- whether response is terminal or transitional,
- whether response is domain-specific.

Do not duplicate only the status phrase. `description: Not Found` adds almost no value.

---

## 5. Success Responses: More Than 200

### 5.1 `200 OK`

Use `200` when the operation completed successfully and a response representation is returned.

```yaml
"200":
  description: Case details returned.
  content:
    application/json:
      schema:
        $ref: "#/components/schemas/CaseDetailResponse"
```

Good for:

- get resource,
- search results,
- successful command with result,
- update returning updated representation.

Be explicit about representation.

Bad:

```yaml
"200":
  description: OK
```

Better:

```yaml
"200":
  description: Updated case details returned after successful reassignment.
```

### 5.2 `201 Created`

Use `201` when a new resource is created.

Common pattern:

```yaml
"201":
  description: Case created.
  headers:
    Location:
      description: Absolute or relative URI of the created case resource.
      schema:
        type: string
        format: uri-reference
  content:
    application/json:
      schema:
        $ref: "#/components/schemas/CaseDetailResponse"
```

Important design decision: Should `201` return the resource body?

Options:

| Option | Pros | Cons |
|---|---|---|
| Return full resource | Consumer can use created state immediately | More payload, server must assemble representation |
| Return minimal creation result | Efficient | Consumer may need follow-up GET |
| Return only `Location` | Clean HTTP style | Less ergonomic for many clients |

For business APIs, returning at least the server-generated ID and initial state is often useful:

```yaml
CaseCreatedResponse:
  type: object
  required: [caseId, status, createdAt]
  properties:
    caseId:
      type: string
    status:
      type: string
      enum: [DRAFT, SUBMITTED]
    createdAt:
      type: string
      format: date-time
```

### 5.3 `202 Accepted`

Use `202` when the request is accepted but not completed.

This is common for:

- long-running workflows,
- asynchronous validation,
- document processing,
- evidence scanning,
- batch operations,
- external-system integration,
- regulatory review queues.

Bad:

```yaml
"202":
  description: Accepted
```

Better:

```yaml
"202":
  description: Evidence upload accepted for asynchronous malware scanning and classification.
  headers:
    Location:
      description: URI of the asynchronous processing job.
      schema:
        type: string
        format: uri-reference
  content:
    application/json:
      schema:
        $ref: "#/components/schemas/AsyncJobAcceptedResponse"
```

Example schema:

```yaml
AsyncJobAcceptedResponse:
  type: object
  required: [jobId, status, submittedAt, statusUrl]
  properties:
    jobId:
      type: string
    status:
      type: string
      enum: [QUEUED, RUNNING]
    submittedAt:
      type: string
      format: date-time
    statusUrl:
      type: string
      format: uri-reference
    correlationId:
      type: string
```

Mental model:

> `202` without a way to observe completion is an incomplete contract.

If you return `202`, document how the caller learns the final outcome:

- polling endpoint,
- callback/webhook,
- event stream,
- notification resource,
- later GET on target resource.

### 5.4 `204 No Content`

Use `204` when operation succeeds and no response body is returned.

```yaml
"204":
  description: Case note deleted. No response body is returned.
```

Do not define `content` for `204`.

Good for:

- delete success,
- idempotent command with no representation,
- update where caller does not need returned data.

Be careful with generated clients. Some generated clients handle `204` differently than `200` with empty object.

Avoid this:

```yaml
"200":
  description: Deleted successfully.
  content:
    application/json:
      schema:
        type: object
```

If there is no useful body, use `204`.

### 5.5 `206 Partial Content`

Use `206` for range requests or partial content semantics, not normal pagination.

Most paginated APIs should use `200` with page/cursor metadata, not `206`.

Correct-ish for byte ranges:

```yaml
"206":
  description: Partial document content returned for the requested byte range.
  headers:
    Content-Range:
      schema:
        type: string
  content:
    application/pdf:
      schema:
        type: string
        format: binary
```

For normal list pagination:

```yaml
"200":
  description: Page of cases returned.
  content:
    application/json:
      schema:
        $ref: "#/components/schemas/CasePageResponse"
```

---

## 6. Redirection Responses

Many JSON APIs rarely use redirects, but if your API can return them, document them.

Examples:

```yaml
"301":
  description: Resource has permanently moved.
  headers:
    Location:
      schema:
        type: string
        format: uri-reference
```

```yaml
"303":
  description: Operation result can be retrieved from the URI in the Location header.
  headers:
    Location:
      schema:
        type: string
        format: uri-reference
```

Do not ignore redirects if they are emitted by gateway, storage layer, authentication middleware, or CDN. Consumers using generated clients may need to know whether redirects occur and whether credentials are preserved.

---

## 7. Client Error Responses: Make Failures Actionable

Client error response modelling is where many APIs become either easy or painful to integrate.

### 7.1 `400 Bad Request`

Use for malformed syntax, invalid structure, invalid parameter format, invalid JSON, invalid request shape.

Example:

```yaml
"400":
  description: Request is syntactically invalid or cannot be parsed.
  content:
    application/problem+json:
      schema:
        $ref: "#/components/schemas/Problem"
```

Use for:

- invalid JSON,
- invalid query parameter type,
- invalid date format,
- malformed UUID,
- unsupported parameter combination at syntax level.

Do not overload `400` for all domain failures if you need consumer-specific handling.

### 7.2 `401 Unauthorized`

Despite the name, `401` is about authentication, not authorization.

Use when:

- token is missing,
- token is expired,
- token is invalid,
- credentials cannot be verified.

Example:

```yaml
"401":
  description: Authentication credentials are missing, invalid, or expired.
  headers:
    WWW-Authenticate:
      description: Authentication challenge or bearer token error information.
      schema:
        type: string
  content:
    application/problem+json:
      schema:
        $ref: "#/components/schemas/Problem"
```

Consumer action:

- login,
- refresh token,
- provide credentials,
- stop if service credential misconfigured.

### 7.3 `403 Forbidden`

Use when authentication succeeded but caller is not allowed to perform the operation.

```yaml
"403":
  description: Caller is authenticated but does not have permission to access this case.
  content:
    application/problem+json:
      schema:
        $ref: "#/components/schemas/Problem"
```

Consumer action:

- do not retry with same identity,
- request permission,
- hide UI action,
- escalate access issue.

For sensitive systems, you may intentionally return `404` instead of `403` to avoid disclosing existence. If so, document the policy.

### 7.4 `404 Not Found`

Use when resource is not found or not visible.

```yaml
"404":
  description: No visible case exists for the supplied caseId.
  content:
    application/problem+json:
      schema:
        $ref: "#/components/schemas/Problem"
```

Do not use `404` for every business error.

Bad:

```text
Cannot submit closed case -> 404
```

Better:

```text
Cannot submit closed case -> 409 Conflict or 422 Unprocessable Content, depending on semantic model.
```

### 7.5 `409 Conflict`

Use when request conflicts with current resource state.

Examples:

- submit case that is already closed,
- update stale version,
- assign case that has been reassigned by another worker,
- create duplicate resource where uniqueness is domain-visible,
- state transition not allowed from current state.

Example:

```yaml
"409":
  description: Case cannot be submitted because its current lifecycle state does not allow submission.
  content:
    application/problem+json:
      schema:
        $ref: "#/components/schemas/CaseStateConflictProblem"
```

Domain-specific conflict schema:

```yaml
CaseStateConflictProblem:
  allOf:
    - $ref: "#/components/schemas/Problem"
    - type: object
      required: [currentState, attemptedTransition, allowedTransitions]
      properties:
        currentState:
          type: string
          example: CLOSED
        attemptedTransition:
          type: string
          example: SUBMIT
        allowedTransitions:
          type: array
          items:
            type: string
          example: []
```

Why this matters:

- UI can show correct message,
- workflow engine can reconcile,
- automated consumer can fetch current state,
- support team can debug.

### 7.6 `410 Gone`

Use when resource used to exist but is intentionally no longer available.

Useful for:

- retired API version endpoint,
- deleted resource with known tombstone,
- expired export/download,
- expired evidence access link.

```yaml
"410":
  description: The export existed but has expired and is no longer available.
  content:
    application/problem+json:
      schema:
        $ref: "#/components/schemas/Problem"
```

### 7.7 `412 Precondition Failed`

Use with conditional requests, especially optimistic concurrency with `If-Match` / `ETag`.

```yaml
"412":
  description: The supplied If-Match precondition does not match the current resource version.
  content:
    application/problem+json:
      schema:
        $ref: "#/components/schemas/Problem"
```

Typical flow:

1. Consumer GETs resource.
2. Server returns `ETag`.
3. Consumer sends update with `If-Match`.
4. Server rejects stale update with `412` if resource changed.

This is better than silent overwrite.

### 7.8 `415 Unsupported Media Type`

Use when request `Content-Type` is unsupported.

```yaml
"415":
  description: The request Content-Type is not supported for this operation.
  content:
    application/problem+json:
      schema:
        $ref: "#/components/schemas/Problem"
```

Example:

```text
POST /cases
Content-Type: text/plain
```

But operation only supports `application/json`.

### 7.9 `422 Unprocessable Content`

Use when request is structurally valid, but semantically invalid.

Examples:

- `dateOfBirth` is in the future,
- `startDate` is after `endDate`,
- allegation category is incompatible with enforcement type,
- required domain evidence is missing,
- transition reason is invalid for selected transition.

Example:

```yaml
"422":
  description: Request is structurally valid but violates domain validation rules.
  content:
    application/problem+json:
      schema:
        $ref: "#/components/schemas/ValidationProblem"
```

Validation problem schema:

```yaml
ValidationProblem:
  allOf:
    - $ref: "#/components/schemas/Problem"
    - type: object
      required: [violations]
      properties:
        violations:
          type: array
          items:
            $ref: "#/components/schemas/ValidationViolation"

ValidationViolation:
  type: object
  required: [field, code, message]
  properties:
    field:
      type: string
      description: JSON Pointer or field path identifying the invalid input.
      example: /subject/dateOfBirth
    code:
      type: string
      example: DATE_MUST_NOT_BE_IN_FUTURE
    message:
      type: string
      example: Date of birth must not be in the future.
```

### 7.10 `429 Too Many Requests`

Use when caller exceeds rate limits.

```yaml
"429":
  description: Caller exceeded the configured rate limit for this operation.
  headers:
    Retry-After:
      description: Number of seconds to wait before retrying, or HTTP date after which retry is allowed.
      schema:
        type: string
    RateLimit-Limit:
      schema:
        type: integer
    RateLimit-Remaining:
      schema:
        type: integer
    RateLimit-Reset:
      schema:
        type: integer
  content:
    application/problem+json:
      schema:
        $ref: "#/components/schemas/Problem"
```

Consumer action:

- back off,
- retry after delay,
- reduce concurrency,
- request quota increase,
- avoid hammering API.

---

## 8. Server Error Responses: Be Useful Without Leaking Internals

Server errors should be documented too.

### 8.1 `500 Internal Server Error`

Use for unexpected server failures.

```yaml
"500":
  description: Unexpected server error. The response includes a correlation ID for support diagnostics.
  content:
    application/problem+json:
      schema:
        $ref: "#/components/schemas/Problem"
```

Do not expose:

- stack traces,
- SQL query text,
- internal hostnames,
- secrets,
- class names if security-sensitive,
- implementation-specific exception messages.

### 8.2 `502 Bad Gateway`

Use when gateway/proxy receives invalid response from upstream.

Document if gateway can emit it.

```yaml
"502":
  description: Upstream service returned an invalid response.
```

### 8.3 `503 Service Unavailable`

Use when service is temporarily unavailable.

```yaml
"503":
  description: Service is temporarily unavailable due to maintenance or overload.
  headers:
    Retry-After:
      schema:
        type: string
  content:
    application/problem+json:
      schema:
        $ref: "#/components/schemas/Problem"
```

### 8.4 `504 Gateway Timeout`

Use when upstream timeout occurs.

```yaml
"504":
  description: Gateway timed out waiting for upstream service.
  content:
    application/problem+json:
      schema:
        $ref: "#/components/schemas/Problem"
```

Important: retry behavior depends on operation idempotency.

A retry of `GET /cases/{id}` is usually safe. A retry of `POST /payments` without idempotency key is dangerous. Response documentation should align with operation semantics.

---

## 9. Error Body Strategy: Use a Stable Error Shape

Bad error model:

```json
"Something went wrong"
```

Slightly better but still weak:

```json
{
  "error": "Invalid request"
}
```

Better:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation error",
  "status": 422,
  "detail": "One or more fields failed validation.",
  "instance": "/cases/submit-requests/req_123",
  "correlationId": "b3e5f1b2-9d8e-4f4e-9e8a-3c631c5f6c11",
  "violations": [
    {
      "field": "/subject/dateOfBirth",
      "code": "DATE_MUST_NOT_BE_IN_FUTURE",
      "message": "Date of birth must not be in the future."
    }
  ]
}
```

RFC 9457 defines Problem Details for HTTP APIs. Its standard members are commonly:

- `type`,
- `title`,
- `status`,
- `detail`,
- `instance`.

You can extend it with domain-specific members.

OpenAPI schema:

```yaml
Problem:
  type: object
  required: [type, title, status]
  properties:
    type:
      type: string
      format: uri-reference
      description: URI reference identifying the problem type.
      example: https://api.example.com/problems/validation-error
    title:
      type: string
      description: Short, human-readable summary of the problem type.
      example: Validation error
    status:
      type: integer
      format: int32
      description: HTTP status code generated by the origin server.
      minimum: 100
      maximum: 599
      example: 422
    detail:
      type: string
      description: Human-readable explanation specific to this occurrence.
      example: One or more fields failed validation.
    instance:
      type: string
      format: uri-reference
      description: URI reference identifying this specific occurrence.
      example: /problems/occurrences/01HZX...
    correlationId:
      type: string
      description: Correlation ID for support and tracing.
      example: b3e5f1b2-9d8e-4f4e-9e8a-3c631c5f6c11
```

Note: `correlationId` is an extension member, not one of the core problem detail members.

---

## 10. Error Catalogue: Problem Types as API Surface

For serious APIs, error types should be catalogued.

Example problem types:

```text
https://api.example.com/problems/authentication-required
https://api.example.com/problems/access-denied
https://api.example.com/problems/case-not-found
https://api.example.com/problems/case-state-conflict
https://api.example.com/problems/validation-error
https://api.example.com/problems/rate-limit-exceeded
https://api.example.com/problems/idempotency-conflict
https://api.example.com/problems/precondition-failed
https://api.example.com/problems/upstream-unavailable
```

Why this matters:

- generated clients can switch on stable `type`,
- UI can map error type to user-facing copy,
- QA can assert error classes,
- support can search incidents by problem type,
- compliance can review error language,
- API governance can enforce consistency.

Avoid treating error `message` as the primary machine key.

Bad:

```java
if (error.getMessage().contains("already closed")) { ... }
```

Better:

```java
if (problem.getType().equals("https://api.example.com/problems/case-state-conflict")) { ... }
```

Best:

```java
switch (problem.typeKey()) {
  case CASE_STATE_CONFLICT -> refreshCaseAndShowAllowedActions();
  case VALIDATION_ERROR -> showFieldViolations();
  case RATE_LIMIT_EXCEEDED -> scheduleRetry();
}
```

---

## 11. Validation Errors: Field-Level, Object-Level, and Business-Level

Validation error modelling needs more nuance than many teams give it.

There are at least four validation layers:

| Layer | Example | Typical Status |
|---|---|---|
| Parse/syntax | Invalid JSON | `400` |
| Structural schema | Missing required property | `400` or `422`, depending policy |
| Field semantic | Date in future | `422` |
| Business semantic | Cannot submit case without required evidence | `422` or `409` |

A robust validation problem:

```yaml
ValidationProblem:
  allOf:
    - $ref: "#/components/schemas/Problem"
    - type: object
      required: [violations]
      properties:
        violations:
          type: array
          minItems: 1
          items:
            $ref: "#/components/schemas/ValidationViolation"

ValidationViolation:
  type: object
  required: [location, code, message]
  properties:
    location:
      type: string
      description: JSON Pointer, parameter name, or header name identifying the invalid input.
      examples:
        - /subject/dateOfBirth
        - query:pageSize
        - header:If-Match
    code:
      type: string
      description: Stable machine-readable validation code.
      examples:
        - REQUIRED
        - INVALID_FORMAT
        - OUT_OF_RANGE
        - DATE_MUST_NOT_BE_IN_FUTURE
    message:
      type: string
      description: Human-readable explanation.
    rejectedValue:
      description: Rejected value when safe to expose.
```

Be careful with `rejectedValue`. Do not expose:

- passwords,
- tokens,
- secrets,
- personal identifiers if unnecessary,
- evidence text,
- confidential investigation data.

For regulated systems, error response design is part of disclosure control.

---

## 12. Response Headers as Contract

Headers are not incidental. Some headers are essential to correct behavior.

### 12.1 `Location`

Used with `201`, sometimes `202` or `303`.

```yaml
headers:
  Location:
    description: URI of the created case resource.
    schema:
      type: string
      format: uri-reference
```

### 12.2 `ETag`

Used for optimistic concurrency and cache validation.

```yaml
headers:
  ETag:
    description: Entity tag representing the current resource version.
    schema:
      type: string
      example: '"case-v17"'
```

A response contract with ETag:

```yaml
"200":
  description: Case details returned with a version tag for conditional updates.
  headers:
    ETag:
      $ref: "#/components/headers/ETag"
  content:
    application/json:
      schema:
        $ref: "#/components/schemas/CaseDetailResponse"
```

### 12.3 `Retry-After`

Used with `429` and `503`.

```yaml
Retry-After:
  description: Seconds or HTTP date after which retry is allowed.
  schema:
    type: string
```

Why string? `Retry-After` can be either delay seconds or an HTTP date.

### 12.4 Correlation ID

Common headers:

- `X-Correlation-Id`,
- `X-Request-Id`,
- `Traceparent`.

Example:

```yaml
X-Correlation-Id:
  description: Correlation identifier used for support, tracing, and audit diagnostics.
  schema:
    type: string
```

If every response includes it, define reusable header component.

### 12.5 Rate Limit Headers

Possible headers:

```yaml
RateLimit-Limit:
  schema:
    type: integer
RateLimit-Remaining:
  schema:
    type: integer
RateLimit-Reset:
  schema:
    type: integer
```

Document semantics precisely:

- per API key,
- per user,
- per tenant,
- per endpoint,
- per time window,
- reset epoch seconds vs seconds until reset.

### 12.6 Deprecation and Sunset Headers

For API lifecycle:

```yaml
Deprecation:
  description: Indicates whether the operation is deprecated.
  schema:
    type: string
Sunset:
  description: Date/time after which this operation may no longer be available.
  schema:
    type: string
```

Do not rely only on documentation pages for deprecation. Headers make lifecycle visible at runtime.

---

## 13. Media Types in Responses

OpenAPI response `content` is keyed by media type.

Example with JSON:

```yaml
content:
  application/json:
    schema:
      $ref: "#/components/schemas/CaseDetailResponse"
```

Example with PDF:

```yaml
content:
  application/pdf:
    schema:
      type: string
      format: binary
```

Example with CSV:

```yaml
content:
  text/csv:
    schema:
      type: string
```

Example with problem details:

```yaml
content:
  application/problem+json:
    schema:
      $ref: "#/components/schemas/Problem"
```

An operation can return different content types:

```yaml
"200":
  description: Evidence document returned in requested format.
  content:
    application/pdf:
      schema:
        type: string
        format: binary
    image/png:
      schema:
        type: string
        format: binary
    application/json:
      schema:
        $ref: "#/components/schemas/EvidenceMetadataResponse"
```

But avoid documenting formats the implementation does not really support.

---

## 14. Empty Body vs Empty Object vs Empty Array

These are different contracts.

### 14.1 Empty body

```yaml
"204":
  description: Deleted successfully. No response body is returned.
```

Consumer should not parse body.

### 14.2 Empty object

```json
{}
```

Means body exists and is an object with no properties.

OpenAPI:

```yaml
"200":
  description: Operation result returned.
  content:
    application/json:
      schema:
        type: object
        additionalProperties: false
```

Usually not useful unless intentionally designed.

### 14.3 Empty array

```json
[]
```

Means successful result with zero items.

Example:

```yaml
"200":
  description: Matching cases returned. Empty array means no cases matched the filter.
  content:
    application/json:
      schema:
        type: array
        items:
          $ref: "#/components/schemas/CaseSummary"
```

### 14.4 Empty page

For paginated APIs, prefer page envelope:

```json
{
  "items": [],
  "page": {
    "size": 50,
    "nextCursor": null
  }
}
```

Document this explicitly.

---

## 15. Partial Success and Batch Responses

Batch APIs are dangerous if response modelling is weak.

Suppose:

```http
POST /cases/bulk-assign
```

Some cases were assigned. Some failed.

Bad response:

```json
{
  "success": false
}
```

Better:

```json
{
  "batchId": "batch_123",
  "summary": {
    "requested": 3,
    "succeeded": 2,
    "failed": 1
  },
  "results": [
    {
      "caseId": "case_001",
      "status": "ASSIGNED"
    },
    {
      "caseId": "case_002",
      "status": "ASSIGNED"
    },
    {
      "caseId": "case_003",
      "status": "FAILED",
      "problem": {
        "type": "https://api.example.com/problems/case-state-conflict",
        "title": "Case state conflict",
        "status": 409,
        "detail": "Closed cases cannot be reassigned."
      }
    }
  ]
}
```

OpenAPI schema sketch:

```yaml
BulkAssignCasesResponse:
  type: object
  required: [batchId, summary, results]
  properties:
    batchId:
      type: string
    summary:
      $ref: "#/components/schemas/BulkOperationSummary"
    results:
      type: array
      items:
        $ref: "#/components/schemas/BulkAssignCaseResult"

BulkAssignCaseResult:
  type: object
  required: [caseId, status]
  properties:
    caseId:
      type: string
    status:
      type: string
      enum: [ASSIGNED, FAILED]
    problem:
      $ref: "#/components/schemas/Problem"
```

Status code choices:

| HTTP Status | Meaning |
|---|---|
| `200` | Batch processed synchronously; inspect item results. |
| `202` | Batch accepted for asynchronous processing. |
| `207` | Multi-status style; less common outside WebDAV-influenced APIs. |
| `400` | Entire batch request invalid. |
| `409` | Entire batch conflicts with system state. |

For most JSON APIs, `200` with item-level result or `202` with job resource is clearer than obscure status handling.

---

## 16. Idempotency and Response Contracts

For unsafe operations like `POST`, idempotency keys are often critical.

Example operation:

```yaml
post:
  operationId: createCase
  parameters:
    - name: Idempotency-Key
      in: header
      required: false
      schema:
        type: string
  responses:
    "201":
      description: Case created.
    "409":
      description: Idempotency key conflicts with a different request payload.
    "422":
      description: Request violates domain validation rules.
```

Important responses:

| Situation | Response |
|---|---|
| First request creates resource | `201 Created` |
| Retry with same key and same payload | Same successful result or replayed result |
| Same key with different payload | `409 Conflict` |
| Request invalid | `400` or `422` |

Documenting idempotency behavior is essential for reliable retry logic.

---

## 17. Response Invariants

A response invariant is a rule that must always hold if that response is returned.

Examples:

### 17.1 Creation invariant

For `201 Created`:

- response contains stable resource ID,
- `Location` points to retrievable resource,
- resource state is one of allowed initial states,
- `createdAt` is server-generated.

### 17.2 Update invariant

For successful update:

- returned version is newer than previous version,
- ETag changes if representation changed,
- updated fields reflect accepted command,
- server-generated audit fields are present.

### 17.3 Delete invariant

For `204 No Content` delete:

- resource will no longer appear in normal GET/list, or
- resource enters deleted/tombstoned state if soft delete is used.

### 17.4 Conflict invariant

For `409 Conflict`:

- response explains conflicting state,
- caller can determine whether to retry, refresh, or stop,
- conflict type is machine-readable.

### 17.5 Validation invariant

For `422`:

- each violation has stable code,
- field paths are stable,
- sensitive rejected values are not leaked,
- problem type is stable.

OpenAPI cannot encode every invariant mechanically. But descriptions, schemas, examples, and tests can.

---

## 18. Java/Spring Implications

### 18.1 Status Code Mapping

Spring MVC examples:

```java
@GetMapping("/cases/{caseId}")
public ResponseEntity<CaseDetailResponse> getCase(@PathVariable String caseId) {
    CaseDetailResponse response = caseQueryService.getCase(caseId);
    return ResponseEntity.ok()
            .eTag(response.versionTag())
            .body(response);
}
```

Create:

```java
@PostMapping("/cases")
public ResponseEntity<CaseCreatedResponse> createCase(@RequestBody CreateCaseRequest request) {
    CaseCreatedResponse response = caseCommandService.createCase(request);
    URI location = URI.create("/cases/" + response.caseId());
    return ResponseEntity.created(location).body(response);
}
```

Delete:

```java
@DeleteMapping("/cases/{caseId}/notes/{noteId}")
@ResponseStatus(HttpStatus.NO_CONTENT)
public void deleteNote(@PathVariable String caseId, @PathVariable String noteId) {
    caseCommandService.deleteNote(caseId, noteId);
}
```

### 18.2 Exception-to-Problem Mapping

A disciplined Java API should centralize error mapping.

```java
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(CaseNotFoundException.class)
    ResponseEntity<ProblemResponse> handleCaseNotFound(CaseNotFoundException ex) {
        ProblemResponse problem = ProblemResponse.builder()
                .type("https://api.example.com/problems/case-not-found")
                .title("Case not found")
                .status(404)
                .detail("No visible case exists for the supplied caseId.")
                .correlationId(CurrentRequest.correlationId())
                .build();

        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(problem);
    }

    @ExceptionHandler(CaseStateConflictException.class)
    ResponseEntity<CaseStateConflictProblem> handleConflict(CaseStateConflictException ex) {
        CaseStateConflictProblem problem = CaseStateConflictProblem.from(ex);
        return ResponseEntity.status(HttpStatus.CONFLICT).body(problem);
    }
}
```

Key rule:

> The exception hierarchy should map to documented response contracts, not leak random internal exceptions.

### 18.3 Bean Validation Does Not Equal API Error Contract

Bean Validation can detect invalid fields:

```java
public record CreateCaseRequest(
    @NotBlank String title,
    @Size(max = 5000) String description
) {}
```

But raw Spring validation errors are not automatically a good API contract.

You still need to map them into your documented `ValidationProblem` shape.

Bad:

```json
{
  "timestamp": "...",
  "status": 400,
  "error": "Bad Request",
  "trace": "..."
}
```

Better:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation error",
  "status": 422,
  "detail": "One or more fields failed validation.",
  "violations": [
    {
      "location": "/title",
      "code": "REQUIRED",
      "message": "Title is required."
    }
  ],
  "correlationId": "..."
}
```

### 18.4 Generated Clients Care About Response Shape

Generated clients often produce different return paths for:

- `200` with JSON body,
- `201` with JSON body,
- `204` no body,
- error responses,
- binary responses,
- multiple media types.

If your OpenAPI says `200` but implementation returns `204`, generated clients may break.

If your OpenAPI says error body is `Problem`, but implementation returns plain text, generated clients may fail to parse.

Contract drift in responses is one of the most common client integration failures.

---

## 19. Designing Reusable Response Components

Reusable responses reduce inconsistency.

Example:

```yaml
components:
  responses:
    Unauthorized:
      description: Authentication credentials are missing, invalid, or expired.
      headers:
        X-Correlation-Id:
          $ref: "#/components/headers/CorrelationId"
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Problem"

    Forbidden:
      description: Caller is authenticated but does not have permission to perform this operation.
      headers:
        X-Correlation-Id:
          $ref: "#/components/headers/CorrelationId"
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Problem"

    InternalServerError:
      description: Unexpected server error. Use the correlation ID when contacting support.
      headers:
        X-Correlation-Id:
          $ref: "#/components/headers/CorrelationId"
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Problem"

  headers:
    CorrelationId:
      description: Correlation identifier for tracing and support.
      schema:
        type: string
```

But avoid too-generic responses that hide domain meaning.

Bad:

```yaml
components:
  responses:
    Error:
      description: Error
```

Good:

```yaml
components:
  responses:
    CaseStateConflict:
      description: Case lifecycle state prevents the requested operation.
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/CaseStateConflictProblem"
```

Reusable response design rule:

> Reuse infrastructure errors globally; specialize domain errors locally.

Good candidates for reusable responses:

- `Unauthorized`,
- `Forbidden`,
- `RateLimited`,
- `InternalServerError`,
- `ServiceUnavailable`,
- generic `ValidationProblem` if validation shape is standard.

Poor candidates for generic reuse:

- every `404`,
- every `409`,
- every `422`,
- workflow-specific failures.

---

## 20. Complete Example: Case Submission Operation

This example shows how response modelling captures real consumer decisions.

```yaml
paths:
  /cases/{caseId}/submission:
    post:
      operationId: submitCase
      summary: Submit a draft case for review.
      description: >
        Transitions a draft case into the submitted state. The operation fails if the
        case is not visible to the caller, is not in DRAFT state, lacks required evidence,
        or the supplied version precondition is stale.
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
        - name: If-Match
          in: header
          required: true
          description: Current case version ETag required for optimistic concurrency.
          schema:
            type: string
        - name: Idempotency-Key
          in: header
          required: false
          description: Optional idempotency key for safe retry of submission command.
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/SubmitCaseRequest"
      responses:
        "200":
          description: Case submitted successfully and updated case state returned.
          headers:
            ETag:
              $ref: "#/components/headers/ETag"
            X-Correlation-Id:
              $ref: "#/components/headers/CorrelationId"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CaseDetailResponse"
        "400":
          description: Request is syntactically invalid or cannot be parsed.
          content:
            application/problem+json:
              schema:
                $ref: "#/components/schemas/Problem"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          description: No visible case exists for the supplied caseId.
          content:
            application/problem+json:
              schema:
                $ref: "#/components/schemas/Problem"
        "409":
          description: Case current state does not allow submission.
          content:
            application/problem+json:
              schema:
                $ref: "#/components/schemas/CaseStateConflictProblem"
        "412":
          description: If-Match precondition does not match the current case version.
          content:
            application/problem+json:
              schema:
                $ref: "#/components/schemas/Problem"
        "422":
          description: Case is structurally valid but lacks required submission evidence or metadata.
          content:
            application/problem+json:
              schema:
                $ref: "#/components/schemas/ValidationProblem"
        "429":
          $ref: "#/components/responses/RateLimited"
        "500":
          $ref: "#/components/responses/InternalServerError"
```

Notice the decision model:

| Response | Consumer Decision |
|---|---|
| `200` | Update local case state to submitted. |
| `400` | Fix request serialization/shape. |
| `401` | Refresh authentication. |
| `403` | Hide/disable action or request access. |
| `404` | Treat case as not visible. |
| `409` | Refresh case state and show allowed actions. |
| `412` | Re-fetch latest version and retry intentionally. |
| `422` | Show validation/evidence requirements. |
| `429` | Back off. |
| `500` | Show temporary failure and use correlation ID. |

This is a real contract.

---

## 21. Response Examples

Examples should validate against schema and represent realistic scenarios.

### 21.1 Success example

```yaml
"200":
  description: Case submitted successfully and updated case state returned.
  content:
    application/json:
      schema:
        $ref: "#/components/schemas/CaseDetailResponse"
      examples:
        submittedCase:
          summary: Submitted case
          value:
            caseId: case_123
            status: SUBMITTED
            title: Alleged reporting violation
            submittedAt: "2026-06-20T09:30:00Z"
            version: 18
```

### 21.2 Conflict example

```yaml
"409":
  description: Case current state does not allow submission.
  content:
    application/problem+json:
      schema:
        $ref: "#/components/schemas/CaseStateConflictProblem"
      examples:
        alreadyClosed:
          summary: Cannot submit closed case
          value:
            type: https://api.example.com/problems/case-state-conflict
            title: Case state conflict
            status: 409
            detail: Closed cases cannot be submitted.
            currentState: CLOSED
            attemptedTransition: SUBMIT
            allowedTransitions: []
            correlationId: b3e5f1b2-9d8e-4f4e-9e8a-3c631c5f6c11
```

Good examples are not decoration. They are executable understanding.

---

## 22. Documentation and Runtime Alignment

A response is only useful if implementation, gateway, tests, docs, and clients agree.

Check alignment across:

| Layer | Risk |
|---|---|
| Controller | Returns undocumented status. |
| Exception handler | Emits inconsistent error body. |
| Gateway | Rewrites errors. |
| Security middleware | Emits HTML error page. |
| Load balancer | Emits plain text `502`. |
| Generated client | Expects documented schema. |
| Test suite | Tests only success path. |
| Documentation UI | Shows incomplete error contract. |

For production-grade APIs, test response contracts:

- status code,
- content type,
- schema,
- headers,
- examples,
- error type,
- correlation ID presence,
- no sensitive leakage.

---

## 23. Response Contract Testing Strategy

At minimum, test these categories:

### 23.1 Success path

Assert:

- expected status,
- expected content type,
- response body validates against OpenAPI schema,
- required headers present,
- invariants hold.

### 23.2 Validation failures

Assert:

- invalid JSON -> expected status,
- missing required field -> expected problem type,
- invalid domain field -> violation code,
- sensitive rejected values not echoed.

### 23.3 Authorization failures

Assert:

- no token -> `401`,
- insufficient scope -> `403`,
- forbidden resource existence policy -> `403` or `404` consistently.

### 23.4 Conflict and concurrency

Assert:

- stale ETag -> `412`,
- invalid state transition -> `409`,
- duplicate idempotency key mismatch -> `409`.

### 23.5 Rate limit and retry

Assert:

- `429`,
- `Retry-After`,
- stable problem type.

### 23.6 Infrastructure errors

Harder to test, but at least simulate:

- upstream unavailable,
- timeout,
- maintenance mode,
- dependency failure.

---

## 24. Anti-Patterns

### 24.1 Only documenting `200`

Bad:

```yaml
responses:
  "200":
    description: OK
```

Why bad:

- consumers do not know how errors look,
- generated clients may fail on real errors,
- QA cannot test contract,
- support cannot rely on error structure.

### 24.2 Generic `default` for everything

Bad:

```yaml
responses:
  default:
    description: Error
```

Use `default` only as catch-all fallback.

### 24.3 String errors

Bad:

```json
"Case already closed"
```

Use stable object error shape.

### 24.4 Error message as machine contract

Bad:

```json
{
  "message": "Case already closed"
}
```

Messages change. Use stable codes/types.

### 24.5 Returning `200` for errors

Bad:

```json
{
  "success": false,
  "error": "Forbidden"
}
```

with HTTP `200`.

This breaks intermediaries, generated clients, observability, retry policies, and semantic correctness.

### 24.6 Inconsistent error shapes

Bad:

```json
// endpoint A
{"error":"Invalid"}

// endpoint B
{"message":"Invalid"}

// endpoint C
{"errors":[...]}

// endpoint D
"Invalid"
```

Use one standard baseline.

### 24.7 Leaking internal exception details

Bad:

```json
{
  "error": "org.postgresql.util.PSQLException: duplicate key value violates unique constraint case_unique_idx"
}
```

Expose safe problem type instead.

### 24.8 Undocumented gateway/security errors

If gateway emits `401`, `403`, `413`, `429`, `502`, `503`, `504`, they are part of consumer reality. Document them or align gateway to your response standard.

### 24.9 Wrong success status

Examples:

- creating resource but returning `200` without reason,
- deleting resource but returning `200 {}`,
- async operation returning `200` while still processing,
- returning `204` but actually sending body.

### 24.10 No response headers documented

If client needs `Location`, `ETag`, `Retry-After`, `RateLimit-*`, or correlation ID, document them.

---

## 25. Practical Response Design Checklist

For each operation, ask:

1. What is the primary success status?
2. Does success return a body?
3. If resource is created, is `Location` returned?
4. If operation is async, how does caller track completion?
5. What are realistic client errors?
6. What validation failures can happen?
7. What domain conflicts can happen?
8. What auth/authz failures can happen?
9. What rate limit behavior can happen?
10. What server/gateway failures can caller observe?
11. Does every error use a consistent shape?
12. Are error types machine-readable and stable?
13. Are sensitive details hidden?
14. Are required response headers documented?
15. Are examples valid and realistic?
16. Are status codes aligned with implementation?
17. Are generated clients likely to parse responses correctly?
18. Are response invariants testable?

---

## 26. A Strong Reusable Response Foundation

A practical base structure:

```yaml
components:
  headers:
    CorrelationId:
      description: Correlation identifier for tracing, support, and audit diagnostics.
      schema:
        type: string

    ETag:
      description: Entity tag representing the current resource version.
      schema:
        type: string

    RetryAfter:
      description: Seconds or HTTP date after which retry is allowed.
      schema:
        type: string

  schemas:
    Problem:
      type: object
      required: [type, title, status]
      properties:
        type:
          type: string
          format: uri-reference
        title:
          type: string
        status:
          type: integer
          minimum: 100
          maximum: 599
        detail:
          type: string
        instance:
          type: string
          format: uri-reference
        correlationId:
          type: string

    ValidationProblem:
      allOf:
        - $ref: "#/components/schemas/Problem"
        - type: object
          required: [violations]
          properties:
            violations:
              type: array
              minItems: 1
              items:
                $ref: "#/components/schemas/ValidationViolation"

    ValidationViolation:
      type: object
      required: [location, code, message]
      properties:
        location:
          type: string
        code:
          type: string
        message:
          type: string

  responses:
    Unauthorized:
      description: Authentication credentials are missing, invalid, or expired.
      headers:
        X-Correlation-Id:
          $ref: "#/components/headers/CorrelationId"
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Problem"

    Forbidden:
      description: Caller is authenticated but is not allowed to perform this operation.
      headers:
        X-Correlation-Id:
          $ref: "#/components/headers/CorrelationId"
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Problem"

    RateLimited:
      description: Caller exceeded the configured rate limit.
      headers:
        Retry-After:
          $ref: "#/components/headers/RetryAfter"
        X-Correlation-Id:
          $ref: "#/components/headers/CorrelationId"
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Problem"

    InternalServerError:
      description: Unexpected server error. Use the correlation ID when contacting support.
      headers:
        X-Correlation-Id:
          $ref: "#/components/headers/CorrelationId"
      content:
        application/problem+json:
          schema:
            $ref: "#/components/schemas/Problem"
```

Then specialize domain responses per operation.

---

## 27. Regulatory and Case Management Perspective

For enforcement lifecycle or complex case management systems, response modelling has extra importance.

### 27.1 State transition transparency

A failed transition should not merely say:

```json
{"message":"Invalid state"}
```

It should help explain:

- current state,
- attempted transition,
- allowed transitions,
- missing prerequisites,
- responsible actor or permission category if safe,
- whether the failure is retryable.

### 27.2 Audit diagnostics

Every error should include or correlate to:

- request ID,
- trace ID,
- timestamp in logs,
- actor identity in audit system,
- operation ID,
- case ID if safe.

The API response should not expose all audit data, but should provide a safe correlation handle.

### 27.3 Disclosure control

`404` vs `403` is not only technical. It can be a disclosure policy.

Example:

- Public complaint portal may return `404` for inaccessible complaints.
- Internal officer portal may return `403` when a known case exists but officer lacks assignment.

Document this deliberately.

### 27.4 Error language governance

In regulated systems, error details can create risk:

- revealing investigation existence,
- revealing subject identity,
- revealing evidence classification,
- implying legal conclusion prematurely,
- exposing internal workflow stages.

Response contract should balance usefulness and confidentiality.

---

## 28. Top 1% Heuristics

A strong engineer thinks about responses like this:

1. A response is a decision point for the consumer.
2. Every documented status code should imply distinct caller behavior.
3. Error shapes should be stable, machine-readable, and safe.
4. `404`, `403`, `409`, `412`, and `422` are not interchangeable.
5. `202` requires an observability/completion story.
6. `204` means no body; do not fake empty JSON.
7. Headers are part of the contract.
8. Gateway and middleware responses are real API behavior.
9. Examples should validate and include non-happy paths.
10. Response invariants should be tested.
11. Generated clients punish sloppy response specs.
12. Domain-specific failures deserve domain-specific problem types.
13. Do not leak implementation exceptions.
14. Do not make humans parse prose when machines need stable codes.
15. Contract precision reduces integration cost more than long documentation pages.

---

## 29. Summary

OpenAPI responses are not merely status-code documentation. They define how consumers interpret the result of an operation.

A production-grade response contract should include:

- explicit success responses,
- realistic client errors,
- server/gateway errors,
- consistent error body format,
- Problem Details-compatible structure,
- domain-specific problem types,
- validation violation structure,
- important response headers,
- async completion strategy for `202`,
- conflict and concurrency semantics,
- examples for happy and unhappy paths,
- testable invariants.

If Part 006 taught you how to model what the client sends, this part teaches how to model what the server promises back.

The most important shift:

> Do not design responses as output data. Design them as consumer decision contracts.

---

## 30. References

- OpenAPI Specification v3.2.0 — Responses Object, Response Object, Header Object, Media Type Object: https://spec.openapis.org/oas/v3.2.0.html
- RFC 9110 — HTTP Semantics, Status Codes: https://datatracker.ietf.org/doc/html/rfc9110
- RFC 9457 — Problem Details for HTTP APIs: https://www.rfc-editor.org/rfc/rfc9457.html
- OpenAPI Initiative: https://www.openapis.org/

---

## 31. Series Progress

```text
Current part: 007 / 030
Status: In progress
Series complete: No
Remaining parts: 23
Next: Part 008 — Components: Reuse Without Coupling Yourself Into a Corner
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-006.md">⬅️ OpenAPI Mastery for Java Engineers — Part 006</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-008.md">OpenAPI Mastery for Java Engineers — Part 008 ➡️</a>
</div>
