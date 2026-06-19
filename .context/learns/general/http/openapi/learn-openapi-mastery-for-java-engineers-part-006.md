# OpenAPI Mastery for Java Engineers — Part 006
# Request Bodies: Media Types, Content Negotiation, Validation, and Semantics

> Series: `learn-openapi-mastery-for-java-engineers`  
> Part: `006 / 030`  
> Previous: `Part 005 — Parameters: Path, Query, Header, Cookie, Style, Explode, and Encoding`  
> Next: `Part 007 — Responses: Status Codes, Content, Headers, Errors, and Invariants`  
> Baseline: OpenAPI Specification 3.2.0, with compatibility notes for 3.0.x and 3.1.x tooling.

---

## 0. Purpose of This Part

This part is about **request body design**. Not merely how to write `requestBody:` in YAML, but how to model the message that crosses the API boundary.

Many production API failures happen because request bodies are treated as DTO dumps:

- The spec says a field is optional, but the server rejects it when missing.
- The server accepts extra fields, but the OpenAPI contract does not say whether this is allowed.
- `POST /cases` reuses the same schema as `GET /cases/{id}`, accidentally exposing `id`, `status`, `createdAt`, or internal fields.
- `PATCH` does not define whether missing, `null`, and empty string mean different things.
- Multipart upload works in Swagger UI but fails in generated Java/TypeScript clients because part names and encodings are unclear.
- Validation rules exist only in Java code, so mocks, client generation, and tests do not know them.

The core mental model:

> A request body is not “the JSON class”. It is the consumer’s message of intent, encoded in a specific media type, with explicit structural constraints and implicit business semantics that must be made visible enough for humans and tools.

For Java engineers, this matters because code-first habits often begin with a class:

```java
public record CreateCaseRequest(
    String title,
    String description,
    String priority
) {}
```

A contract-first mindset begins with harder questions:

- What is the caller allowed to ask the system to do?
- Which fields are caller-controlled?
- Which fields are server-generated?
- Which fields are required, nullable, defaulted, ignored, or rejected?
- What media type is accepted?
- What is the difference between missing, `null`, and empty?
- Which validation rules are structural and which are business rules?
- How does this body evolve without breaking consumers?

---

## 1. Request Body vs Parameters

OpenAPI operations accept input mainly through:

1. **Parameters** — path, query, header, cookie.
2. **Request body** — the HTTP message payload.

A practical distinction:

| Input kind | Usually means |
|---|---|
| Path parameter | Identifies a resource or resource scope. |
| Query parameter | Filters, selects, sorts, paginates, or modifies retrieval. |
| Header parameter | Protocol metadata, auth-adjacent metadata, idempotency, correlation, conditional requests. |
| Cookie parameter | Browser/session-oriented metadata. |
| Request body | Representation, command, document, file, form, or complex input payload. |

Example:

```yaml
paths:
  /cases/{caseId}/evidence:
    post:
      operationId: uploadEvidence
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [file, classification]
              properties:
                file:
                  type: string
                  format: binary
                classification:
                  type: string
                  enum: [PUBLIC, CONFIDENTIAL, RESTRICTED]
```

Here `caseId` identifies the parent case. `file` and `classification` are the submitted content.

Do not choose body vs query by habit. Choose based on semantics, interoperability, security, length limits, caching expectations, and consumer ergonomics.

---

## 2. Anatomy of `requestBody`

A typical request body object:

```yaml
requestBody:
  description: Payload used to create a draft enforcement case.
  required: true
  content:
    application/json:
      schema:
        $ref: '#/components/schemas/CreateCaseRequest'
      examples:
        webPortalComplaint:
          summary: Web portal complaint
          value:
            title: Misleading fee disclosure
            intakeChannel: WEB_PORTAL
```

Important fields:

| Field | Meaning |
|---|---|
| `description` | Explains what the body represents and any semantics schema cannot express. |
| `required` | Whether the HTTP request must include a body. |
| `content` | Map of media type to schema/examples/encoding. |

Inside each media type object:

| Field | Meaning |
|---|---|
| `schema` | Shape and constraints of the payload for that media type. |
| `example` | One example. |
| `examples` | Named examples. Prefer this for serious APIs. |
| `encoding` | Per-property encoding metadata, mainly for form and multipart bodies. |

A meaningful request body must specify at least one media type. Otherwise the consumer does not know whether to send JSON, multipart, form data, raw binary, or something else.

---

## 3. Body Required vs Field Required

This is a common source of confusion.

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [title]
        properties:
          title:
            type: string
          description:
            type: string
```

There are two different requiredness levels:

1. `requestBody.required: true` means the request must include a body.
2. `schema.required: [title]` means the JSON object must contain property `title`.

These requests fail for different reasons:

```http
POST /cases HTTP/1.1
Content-Type: application/json

{}
```

Body exists, but `title` is missing.

```http
POST /cases HTTP/1.1
Content-Type: application/json
```

Body itself is missing.

In Spring MVC/WebFlux terms:

```java
@PostMapping("/cases")
public CaseResponse create(@Valid @RequestBody CreateCaseRequest request) {
    ...
}
```

`@RequestBody(required = true)` corresponds roughly to body presence. Bean Validation annotations such as `@NotNull`, `@NotBlank`, and `@Size` correspond to constraints inside the body.

Do not collapse these into one idea. They have different failure modes and often different error responses.

---

## 4. Request Body Is Not Always JSON

JSON dominates modern APIs, but OpenAPI request bodies can describe many representations:

| Media type | Typical use |
|---|---|
| `application/json` | Standard structured payload. |
| `application/merge-patch+json` | JSON Merge Patch. |
| `application/json-patch+json` | JSON Patch operation list. |
| `multipart/form-data` | File plus metadata. |
| `application/x-www-form-urlencoded` | Browser/OAuth-style form payloads. |
| `text/plain` | Raw text input. |
| `application/octet-stream` | Raw binary. |
| `application/pdf`, `image/png`, etc. | Specific binary/document upload. |
| `application/vnd.company.resource+json` | Vendor/domain-specific representation. |

Example with two accepted JSON-compatible media types:

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        $ref: '#/components/schemas/CreateCaseRequest'
    application/vnd.acme.case-create+json:
      schema:
        $ref: '#/components/schemas/CreateCaseRequest'
```

This explicitly says the endpoint accepts both media types. This matters for generated clients, gateway validation, mocks, and documentation.

---

## 5. Content Negotiation: `Content-Type` vs `Accept`

For request bodies, the critical header is usually:

```http
Content-Type: application/json
```

`Content-Type` tells the server how to parse the request body.

`Accept` tells the server what response representation the client prefers:

```http
Accept: application/json
```

A complete operation usually documents both request and response media types:

```yaml
paths:
  /cases:
    post:
      operationId: createCase
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateCaseRequest'
      responses:
        '201':
          description: Case created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CaseResponse'
```

### Charset and media type parameters

Many Java clients send:

```http
Content-Type: application/json;charset=UTF-8
```

In most JSON APIs this should be accepted, but strict gateways or validators may reject it if configured narrowly. Practical guidance:

- Document canonical media type as `application/json`.
- Configure runtime/gateway to accept compatible parameters if desired.
- Add integration tests for common client behavior.
- Avoid listing every charset variant unless your tooling requires it.

---

## 6. Separate Request and Response Schemas

One of the most important rules:

> Do not reuse one schema for create request, update request, command request, and response unless their semantics are genuinely identical.

They usually are not.

Bad pattern:

```yaml
requestBody:
  content:
    application/json:
      schema:
        $ref: '#/components/schemas/Case'
```

where `Case` contains:

```yaml
Case:
  type: object
  required: [id, status, title, createdAt, updatedAt]
  properties:
    id:
      type: string
    status:
      type: string
      enum: [DRAFT, SUBMITTED, UNDER_REVIEW, CLOSED]
    title:
      type: string
    createdAt:
      type: string
      format: date-time
    updatedAt:
      type: string
      format: date-time
```

Problems:

- Can the client send `id`?
- Can the client set `status`?
- Are timestamps client-provided?
- Are response-required fields also request-required?
- Does every generator interpret `readOnly`/`writeOnly` as you expect?

Better:

```yaml
CreateCaseRequest:
  type: object
  additionalProperties: false
  required: [title, intakeChannel]
  properties:
    title:
      type: string
      minLength: 1
      maxLength: 200
    description:
      type: string
      maxLength: 5000
    intakeChannel:
      type: string
      enum: [WEB_PORTAL, EMAIL, PHONE, INTERNAL_REFERRAL]
```

Response:

```yaml
CaseResponse:
  type: object
  required: [id, status, title, createdAt, updatedAt]
  properties:
    id:
      type: string
    status:
      type: string
      enum: [DRAFT, SUBMITTED, UNDER_REVIEW, CLOSED]
    title:
      type: string
    description:
      type: string
    createdAt:
      type: string
      format: date-time
    updatedAt:
      type: string
      format: date-time
```

This is not “more YAML for no reason”. It is explicit boundary design.

---

## 7. Request Body as Command, Not Just Representation

Some request bodies represent a resource. Others represent a **command**.

Representation-like create:

```yaml
CreateNoteRequest:
  type: object
  required: [body]
  properties:
    body:
      type: string
      maxLength: 2000
```

Command-like transition:

```yaml
EscalateCaseRequest:
  type: object
  additionalProperties: false
  required: [targetQueue, reason, expectedCaseVersion]
  properties:
    targetQueue:
      type: string
      enum: [SENIOR_REVIEW, LEGAL_REVIEW, EXECUTIVE_REVIEW]
    reason:
      type: string
      minLength: 20
      maxLength: 2000
    expectedCaseVersion:
      type: integer
      format: int64
      minimum: 0
```

Bad workflow API:

```http
PATCH /cases/CASE-123
{
  "status": "ESCALATED"
}
```

Better workflow API:

```http
POST /cases/CASE-123/escalations
{
  "targetQueue": "LEGAL_REVIEW",
  "reason": "Potential statutory breach requires legal interpretation.",
  "expectedCaseVersion": 17
}
```

The second payload captures intent, audit reason, concurrency expectation, and transition semantics. That is much stronger for case management, enforcement lifecycle, regulated workflows, and high-risk business processes.

---

## 8. PUT, PATCH, and Partial Update Semantics

Update bodies require careful semantic design.

### 8.1 Full replacement with `PUT`

```yaml
ReplaceCaseRequest:
  type: object
  additionalProperties: false
  required: [title, description, priority]
  properties:
    title:
      type: string
      minLength: 1
      maxLength: 200
    description:
      type: string
      maxLength: 5000
    priority:
      type: string
      enum: [LOW, MEDIUM, HIGH]
```

If `PUT` means full replacement, missing fields should usually be invalid.

### 8.2 Domain-specific `PATCH`

```yaml
PatchCaseRequest:
  type: object
  additionalProperties: false
  minProperties: 1
  description: >
    Partial update. Missing properties are left unchanged. A null description clears
    the current description.
  properties:
    title:
      type: string
      minLength: 1
      maxLength: 200
    description:
      type:
        - string
        - 'null'
      maxLength: 5000
    priority:
      type: string
      enum: [LOW, MEDIUM, HIGH]
```

Here:

- Missing `description` means no change.
- `description: null` means clear it.
- `description: ""` means set to empty string, unless rejected by constraints.

### 8.3 JSON Merge Patch

```yaml
requestBody:
  required: true
  content:
    application/merge-patch+json:
      schema:
        type: object
```

Compact, but consumers must understand merge-patch semantics, especially `null` as removal.

### 8.4 JSON Patch

```yaml
requestBody:
  required: true
  content:
    application/json-patch+json:
      schema:
        type: array
        items:
          type: object
          required: [op, path]
          properties:
            op:
              type: string
              enum: [add, remove, replace, move, copy, test]
            path:
              type: string
            value: {}
```

Powerful, but often too low-level for domain APIs because it exposes document mutation instead of business intent.

Decision rule:

| Approach | Best when |
|---|---|
| `PUT` full replacement | Client owns the full replaceable representation. |
| Domain-specific `PATCH` | Business fields have clear partial update semantics. |
| JSON Merge Patch | Generic object merge semantics are acceptable. |
| JSON Patch | Fine-grained document operations are truly needed. |
| Command endpoint | State transitions, audit, permissions, and workflow semantics matter. |

---

## 9. Missing vs `null` vs Empty

These are not equivalent:

```json
{}
```

```json
{ "description": null }
```

```json
{ "description": "" }
```

Possible meanings:

| Shape | Possible meaning |
|---|---|
| Missing | Not supplied, no change, default applies, invalid if required. |
| `null` | Explicitly absent, clear existing value, unknown, invalid if not nullable. |
| Empty string | Supplied value is empty; may be valid or invalid depending on domain. |

Java warning:

```java
public record PatchCaseRequest(String description) {}
```

With normal Jackson binding, missing and explicit `null` can both become Java `null`. If your semantics require distinguishing them, consider:

- `JsonNode`,
- a presence-aware wrapper,
- `JsonNullable<T>` in generated models,
- a map-based patch model,
- explicit commands such as `clearDescription: true`.

The OpenAPI schema should express allowed nullability, but the Java implementation must preserve the distinction if the business logic depends on it.

---

## 10. Validation Boundary: Four Layers

Request validation has layers.

### 10.1 Syntax validation

Can the body be parsed?

Examples:

- Invalid JSON.
- Broken multipart boundary.
- Wrong encoding.
- Malformed form data.

### 10.2 Structural validation

Does the parsed body match the schema?

Examples:

- Required property missing.
- String too long.
- Enum value invalid.
- Array too large.
- Wrong JSON type.

### 10.3 Semantic validation

Does the body make sense in the domain?

Examples:

- `startDate` must be before `endDate`.
- `targetQueue` must be allowed for current case type.
- `evidenceId` must belong to the same case.
- `reason` is required for a specific transition.

### 10.4 Policy/authorization validation

Is the actor allowed to send this body now?

Examples:

- Partner users cannot set internal priority.
- Officers can update draft cases but not closed cases.
- Only legal reviewers can mark evidence privileged.

Design rule:

> Use OpenAPI/JSON Schema for structural truth. Use application logic for semantic and authorization truth. Document the important non-structural rules and test them.

---

## 11. Conditional Requirements

Examples:

- If `anonymous = false`, `reporterContact` is required.
- If `type = ORGANIZATION`, `registrationNumber` is required.
- If `decision = REJECT`, `rejectionReason` is required.

With OAS 3.1/3.2, JSON Schema alignment allows richer constraints such as `if`, `then`, and `else`, depending on tool support.

```yaml
ReporterRequest:
  type: object
  required: [anonymous]
  properties:
    anonymous:
      type: boolean
    reporterContact:
      $ref: '#/components/schemas/ReporterContact'
  if:
    properties:
      anonymous:
        const: false
    required: [anonymous]
  then:
    required: [reporterContact]
```

Production guidance:

- Use conditional schema only if your validators and generators support it well.
- Also explain critical conditions in descriptions.
- Add examples for each branch.
- Add provider tests for the same rule.

Do not assume every tool handles every JSON Schema feature equally.

---

## 12. Unknown Fields and `additionalProperties`

Question: should clients be allowed to send undocumented fields?

Strict schema:

```yaml
CreateCaseRequest:
  type: object
  additionalProperties: false
  required: [title]
  properties:
    title:
      type: string
```

Benefits:

- Catches client mistakes early.
- Prevents hidden mass assignment.
- Makes boundary explicit.

Costs:

- Less tolerant of future fields.
- Requires Jackson/runtime alignment.

Explicit extension container:

```yaml
CreateCaseRequest:
  type: object
  additionalProperties: false
  required: [title]
  properties:
    title:
      type: string
    extensions:
      type: object
      additionalProperties: true
      description: Consumer-specific extension data. The server may ignore unknown extension keys.
```

This is better than allowing arbitrary extra fields everywhere.

Java alignment:

```java
@JsonIgnoreProperties(ignoreUnknown = false)
public record CreateCaseRequest(String title) {}
```

or Spring Boot configuration:

```yaml
spring:
  jackson:
    deserialization:
      fail-on-unknown-properties: true
```

If the OpenAPI says unknown fields are rejected but Jackson ignores them, the contract is false. If OpenAPI implies tolerance but runtime rejects them, clients fail unexpectedly.

---

## 13. Defaults Are Not Runtime Magic

```yaml
priority:
  type: string
  enum: [LOW, MEDIUM, HIGH]
  default: MEDIUM
```

This does not guarantee the server applies `MEDIUM`. It declares a default in the schema; tooling may use it for documentation, examples, generated code, or validation behavior.

Better:

```yaml
priority:
  type: string
  enum: [LOW, MEDIUM, HIGH]
  default: MEDIUM
  description: If omitted, the server assigns MEDIUM unless risk rules derive a higher priority.
```

Then implement and test it in the provider.

---

## 14. `readOnly` and `writeOnly`

```yaml
User:
  type: object
  properties:
    id:
      type: string
      readOnly: true
    username:
      type: string
    password:
      type: string
      writeOnly: true
```

Mental model:

- `readOnly`: response-side field.
- `writeOnly`: request-side field.

Useful examples:

| Marker | Fields |
|---|---|
| `readOnly` | `id`, `createdAt`, `updatedAt`, computed status, assigned officer display name. |
| `writeOnly` | password, client secret, one-time token. |

But for long-lived business APIs, separate request/response schemas are still often clearer than one schema full of directional markers.

---

## 15. JSON Request Body Patterns

### 15.1 Create request

```yaml
CreateCaseRequest:
  type: object
  additionalProperties: false
  required: [title, intakeChannel]
  properties:
    title:
      type: string
      minLength: 1
      maxLength: 200
      pattern: '.*\S.*'
    description:
      type: string
      maxLength: 5000
    intakeChannel:
      type: string
      enum: [WEB_PORTAL, EMAIL, PHONE, INTERNAL_REFERRAL]
    complainantId:
      type: string
```

### 15.2 Command request

```yaml
SubmitCaseRequest:
  type: object
  additionalProperties: false
  required: [declarationAccepted, expectedVersion]
  properties:
    declarationAccepted:
      type: boolean
      const: true
      description: Caller confirms the case is ready for review.
    expectedVersion:
      type: integer
      format: int64
      minimum: 0
    comment:
      type: string
      maxLength: 2000
```

### 15.3 Batch request

```yaml
BatchAssignCasesRequest:
  type: object
  additionalProperties: false
  required: [caseIds, assigneeId, reason]
  properties:
    caseIds:
      type: array
      minItems: 1
      maxItems: 100
      uniqueItems: true
      items:
        type: string
    assigneeId:
      type: string
    reason:
      type: string
      minLength: 10
      maxLength: 2000
```

Batch APIs should also define partial success behavior, idempotency, ordering guarantees, and error response structure.

---

## 16. Form URL-Encoded Bodies

```yaml
requestBody:
  required: true
  content:
    application/x-www-form-urlencoded:
      schema:
        type: object
        required: [username, password]
        properties:
          username:
            type: string
          password:
            type: string
            format: password
```

Wire shape:

```http
POST /login HTTP/1.1
Content-Type: application/x-www-form-urlencoded

username=alice&password=s3cr3t
```

Concerns:

- Encoding rules differ from JSON.
- Nested objects and arrays need explicit design.
- Sensitive values can be logged by poor infrastructure.
- Tooling behavior can differ from JSON payloads.

Use JSON unless form encoding is required by browser behavior, protocol compatibility, or legacy constraints.

---

## 17. Multipart Request Bodies

Multipart is common for file upload plus metadata.

```yaml
paths:
  /cases/{caseId}/evidence:
    post:
      operationId: uploadEvidence
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              additionalProperties: false
              required: [file, metadata]
              properties:
                file:
                  type: string
                  format: binary
                metadata:
                  $ref: '#/components/schemas/EvidenceUploadMetadata'
            encoding:
              metadata:
                contentType: application/json
```

```yaml
EvidenceUploadMetadata:
  type: object
  additionalProperties: false
  required: [originalFileName, classification]
  properties:
    originalFileName:
      type: string
      minLength: 1
      maxLength: 255
    classification:
      type: string
      enum: [PUBLIC, CONFIDENTIAL, RESTRICTED]
    description:
      type: string
      maxLength: 2000
```

Spring mapping:

```java
@PostMapping(
    value = "/cases/{caseId}/evidence",
    consumes = MediaType.MULTIPART_FORM_DATA_VALUE
)
public EvidenceResponse uploadEvidence(
    @PathVariable String caseId,
    @RequestPart("file") MultipartFile file,
    @Valid @RequestPart("metadata") EvidenceUploadMetadata metadata
) {
    ...
}
```

Alignment checklist:

- OpenAPI property names match multipart part names.
- JSON metadata part declares `encoding.contentType`.
- File size and file type restrictions are documented and enforced.
- Async scanning/processing behavior is reflected in responses.
- Generated clients are tested against the real server.

---

## 18. Raw Binary Bodies

```yaml
requestBody:
  required: true
  content:
    application/pdf:
      schema:
        type: string
        format: binary
```

Useful for direct document upload, but metadata becomes harder. You may need headers:

```yaml
parameters:
  - name: X-File-Name
    in: header
    required: true
    schema:
      type: string
  - name: X-Content-Classification
    in: header
    required: true
    schema:
      type: string
      enum: [PUBLIC, CONFIDENTIAL, RESTRICTED]
```

For business APIs, multipart is often clearer because file and metadata move together in one structured request.

---

## 19. Idempotency and Request Bodies

Idempotency is often expressed with a header, but the body semantics matter too.

```yaml
paths:
  /payment-instructions:
    post:
      operationId: createPaymentInstruction
      parameters:
        - name: Idempotency-Key
          in: header
          required: true
          schema:
            type: string
            minLength: 16
            maxLength: 128
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreatePaymentInstructionRequest'
```

Questions to document:

- Same key and same body returns original result?
- Same key and different body returns `409 Conflict`?
- How long is the key retained?
- Is the key scoped per user, account, operation, or tenant?

OpenAPI can describe the header and body; operation descriptions should explain the behavioral contract.

---

## 20. Concurrency Control in Request Bodies

Two common patterns:

### Header-based

```yaml
parameters:
  - name: If-Match
    in: header
    required: true
    schema:
      type: string
```

### Body-based

```yaml
UpdateCaseRequest:
  type: object
  required: [expectedVersion]
  properties:
    expectedVersion:
      type: integer
      format: int64
      minimum: 0
    title:
      type: string
      maxLength: 200
```

Guidance:

| Pattern | Good for |
|---|---|
| `If-Match` / ETag | HTTP-native resource concurrency. |
| `expectedVersion` | Domain commands, aggregates, event-sourced or workflow-heavy systems. |

High-value state changes should not have no concurrency strategy.

---

## 21. Security-Sensitive Body Design

Avoid hidden mass assignment:

```java
@PostMapping("/cases")
public CaseEntity create(@RequestBody CaseEntity entity) {
    return repository.save(entity);
}
```

This can let callers submit fields they should not control.

Prefer boundary DTO + command mapping:

```java
@PostMapping("/cases")
public CaseResponse create(@Valid @RequestBody CreateCaseRequest request) {
    CreateCaseCommand command = mapper.toCommand(request);
    Case created = applicationService.create(command);
    return mapper.toResponse(created);
}
```

Sensitive fields should be directional and examples should not contain real secrets:

```yaml
CreateApiClientRequest:
  type: object
  required: [name]
  properties:
    name:
      type: string
    clientSecret:
      type: string
      writeOnly: true
      description: Optional caller-provided secret. If omitted, the server generates one.
```

Bad example:

```yaml
password: SuperSecret123!
```

Better:

```yaml
password: '<redacted-example-password>'
```

---

## 22. Examples as Design Tests

Examples should be realistic and valid:

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        $ref: '#/components/schemas/CreateCaseRequest'
      examples:
        webPortalComplaint:
          summary: Case created from web portal complaint
          value:
            title: Misleading fee disclosure
            description: Customer reports undisclosed recurring fee.
            intakeChannel: WEB_PORTAL
            complainantId: CMP-10091
        internalReferral:
          summary: Internal referral
          value:
            title: Suspicious transaction pattern
            intakeChannel: INTERNAL_REFERRAL
```

Good examples include:

- normal happy path,
- important variants,
- optional field omission,
- nullable behavior where relevant,
- realistic domain vocabulary,
- no secrets,
- values that validate against schema.

Invalid examples are a governance smell.

---

## 23. Java Type Mapping Concerns

### String constraints

OpenAPI:

```yaml
title:
  type: string
  minLength: 1
  maxLength: 200
```

Java:

```java
public record CreateCaseRequest(
    @NotBlank
    @Size(max = 200)
    String title
) {}
```

Subtle mismatch:

- `minLength: 1` rejects empty string but may allow whitespace-only strings.
- `@NotBlank` rejects null, empty, and whitespace-only strings.
- If the server trims before validation, raw contract semantics differ from runtime semantics.

If non-blank is required, document it:

```yaml
title:
  type: string
  minLength: 1
  maxLength: 200
  pattern: '.*\S.*'
  description: Must contain at least one non-whitespace character.
```

### Money and decimal values

For money, avoid casual JSON numbers if precision matters:

```yaml
amount:
  type: string
  pattern: '^\d+\.\d{2}$'
```

or use minor units:

```yaml
amountMinorUnits:
  type: integer
  format: int64
  minimum: 0
```

### Date/time

```yaml
dueDate:
  type: string
  format: date
submittedAt:
  type: string
  format: date-time
```

Java mapping:

```java
LocalDate dueDate;
OffsetDateTime submittedAt;
```

Avoid mapping `date-time` to `LocalDateTime` for distributed APIs unless omitting offset is intentional.

---

## 24. HTTP Methods and Request Bodies

| Method | Body guidance |
|---|---|
| `POST` | Normal for create, command, search, action, upload. |
| `PUT` | Normal for full replacement or upsert. |
| `PATCH` | Normal for partial modification. |
| `DELETE` | Be cautious; tooling/intermediaries may be inconsistent. |
| `GET` | Avoid bodies for interoperable APIs; use query parameters or `POST /search`. |

Even when a protocol does not strictly forbid a body, real-world tooling matters. API design is not only theoretical protocol legality; it is operational interoperability.

---

## 25. Reusable Request Bodies

Reusable request body component:

```yaml
components:
  requestBodies:
    CreateCaseBody:
      required: true
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/CreateCaseRequest'
```

Reference:

```yaml
paths:
  /cases:
    post:
      operationId: createCase
      requestBody:
        $ref: '#/components/requestBodies/CreateCaseBody'
```

Reuse only when media type, schema, and semantics are identical. Do not create generic request bodies such as `ReasonRequest` or `CommonPayload` merely because fields look similar.

---

## 26. Request Body Style Guide for Java Teams

### Naming

Prefer operation-specific names:

```text
CreateCaseRequest
UpdateCaseRequest
SubmitCaseRequest
EscalateCaseRequest
UploadEvidenceMetadata
BatchAssignCasesRequest
```

Avoid vague names:

```text
CaseDto
CaseRequest
Payload
ApiRequest
CommonRequest
```

### Requiredness

- Mark body required when payload is mandatory.
- Mark required fields in schema.
- Avoid Java primitive defaults hiding absence.
- Use presence-aware types when missing vs null matters.

### Validation

- Put structural constraints in schema.
- Put semantic rules in descriptions and application tests.
- Ensure Bean Validation, Jackson, and OpenAPI match.

### Evolution

- Avoid exposing persistence entities.
- Avoid volatile enums where values change often.
- Decide unknown-field policy deliberately.
- Prefer explicit extension containers over arbitrary extra fields.

### Examples

- Use named examples.
- Validate examples in CI.
- Include edge cases where semantics are subtle.
- Never include real secrets or real personal data.

---

## 27. Worked Example: Case Creation

```yaml
paths:
  /cases:
    post:
      operationId: createCase
      summary: Create a draft enforcement case
      description: >
        Creates a draft enforcement case from an intake source. The server assigns
        the case identifier, initial status, timestamps, ownership metadata, and
        may derive priority according to risk rules.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateCaseRequest'
            examples:
              webPortalComplaint:
                summary: Web portal complaint
                value:
                  title: Misleading fee disclosure
                  description: Customer reports undisclosed recurring fee.
                  intakeChannel: WEB_PORTAL
                  complainantId: CMP-10091
              internalReferral:
                summary: Internal referral with suggested priority
                value:
                  title: Suspicious transaction pattern
                  intakeChannel: INTERNAL_REFERRAL
                  initialPriority: HIGH
      responses:
        '201':
          description: Case created
```

```yaml
CreateCaseRequest:
  type: object
  additionalProperties: false
  required: [title, intakeChannel]
  properties:
    title:
      type: string
      minLength: 1
      maxLength: 200
      pattern: '.*\S.*'
    description:
      type: string
      maxLength: 5000
    intakeChannel:
      type: string
      enum: [WEB_PORTAL, EMAIL, PHONE, INTERNAL_REFERRAL]
    complainantId:
      type: string
    initialPriority:
      type: string
      enum: [LOW, MEDIUM, HIGH]
      description: Optional caller-suggested priority. The server may override based on risk rules.
```

Why this is strong:

- No server-generated fields in request.
- Required fields are explicit.
- Unknown fields are rejected.
- Strings are bounded.
- Examples reflect real use cases.
- Description states server behavior not visible in schema.

---

## 28. Worked Example: Escalation Command

```yaml
paths:
  /cases/{caseId}/escalations:
    post:
      operationId: escalateCase
      summary: Escalate a case
      description: >
        Requests escalation of a case to a higher review queue. The operation is
        valid only when the case is open and the caller has escalation permission.
        The escalation reason is retained in the audit trail.
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/EscalateCaseRequest'
            examples:
              legalReview:
                summary: Escalate to legal review
                value:
                  targetQueue: LEGAL_REVIEW
                  reason: Potential statutory breach requires legal interpretation before decision.
                  expectedCaseVersion: 17
      responses:
        '202':
          description: Escalation accepted for processing
        '409':
          description: Case version conflict or invalid state transition
```

```yaml
EscalateCaseRequest:
  type: object
  additionalProperties: false
  required: [targetQueue, reason, expectedCaseVersion]
  properties:
    targetQueue:
      type: string
      enum: [SENIOR_REVIEW, LEGAL_REVIEW, EXECUTIVE_REVIEW]
    reason:
      type: string
      minLength: 20
      maxLength: 2000
      pattern: '.*\S.*'
    expectedCaseVersion:
      type: integer
      format: int64
      minimum: 0
    notifyAssignedOfficer:
      type: boolean
      default: true
```

This is not merely a status update. It is a domain command with audit and concurrency semantics.

---

## 29. Common Anti-Patterns

### 29.1 Entity as request body

```java
@PostMapping("/cases")
public CaseEntity create(@RequestBody CaseEntity entity) { ... }
```

Leads to persistence leakage, mass assignment, poor validation boundaries, and unstable contracts.

### 29.2 Response schema as request schema

```yaml
requestBody:
  content:
    application/json:
      schema:
        $ref: '#/components/schemas/CaseResponse'
```

Creates ambiguity around IDs, timestamps, status, and read-only fields.

### 29.3 No required fields

```yaml
CreateCaseRequest:
  type: object
  properties:
    title:
      type: string
```

This often accidentally allows `{}`.

### 29.4 Unbounded strings

```yaml
description:
  type: string
```

Can create memory, database, UI, log, and security problems.

### 29.5 Patch without semantics

```yaml
PatchCaseRequest:
  type: object
  properties:
    description:
      type: string
```

Does not define missing vs null vs empty.

### 29.6 Multipart without encoding

If a multipart property is meant to be JSON, say so with `encoding`.

### 29.7 Contract/runtime mismatch

Examples:

- `additionalProperties: false`, but Jackson ignores unknown fields.
- `maxLength: 200`, but server accepts and silently truncates 10,000 characters.
- `default: MEDIUM`, but server does not apply the default.

A contract that does not match runtime is worse than no contract because it creates false confidence.

---

## 30. Review Checklist

Before approving a request body, check:

- Is the body requiredness correct?
- Is the media type explicit?
- Is this schema operation-specific enough?
- Are request and response models separated where needed?
- Are server-generated fields excluded?
- Are required fields explicit?
- Are strings, arrays, and numbers bounded?
- Is missing vs null vs empty defined where relevant?
- Is unknown-field behavior deliberate?
- Are defaults implemented, not only documented?
- Are examples realistic and valid?
- Are sensitive fields handled safely?
- Does Java/Jackson/Bean Validation behavior match OpenAPI?
- Are multipart part names and encodings aligned with implementation?
- Are semantic and authorization rules documented and tested?
- Can this body evolve without breaking known consumers?

---

## 31. Practical Exercise

Take this common Java endpoint:

```java
@PostMapping("/cases")
public CaseDto createCase(@RequestBody CaseDto caseDto) {
    ...
}
```

Refactor the API contract into:

1. `CreateCaseRequest`
2. `CaseResponse`
3. explicit `requestBody`
4. named examples
5. validation constraints
6. unknown field policy
7. server-generated field policy
8. Java mapping boundary

Ask:

- Which fields should consumers be allowed to send?
- Which fields are server-controlled?
- Which fields need maximum length?
- Which fields are stable enough to be enums?
- Which fields are optional but not nullable?
- Which fields are nullable?
- Which fields require semantic validation?
- Which fields are sensitive?
- Which future changes are likely?

This exercise quickly reveals whether your API is contract-designed or merely code-exposed.

---

## 32. Key Takeaways

- `requestBody.required` and schema `required` are different.
- Request body media types must be explicit.
- Create, update, patch, command, upload, and response schemas usually deserve separate models.
- Missing, `null`, and empty are different and must be designed deliberately.
- OpenAPI is strong for structural validation, but semantic and authorization rules still need application logic.
- Multipart bodies need precise property names and encoding metadata.
- `additionalProperties` must align with runtime deserialization.
- Defaults must be implemented, not merely declared.
- Examples are design tests, not decoration.
- A strong request body contract prevents mass assignment, accidental coupling, validation drift, and consumer confusion.

---

## 33. References

- OpenAPI Specification v3.2.0 — https://spec.openapis.org/oas/v3.2.0.html
- OpenAPI Initiative — https://www.openapis.org/
- OpenAPI Initiative, “Announcing OpenAPI v3.2” — https://www.openapis.org/blog/2025/09/23/announcing-openapi-v3-2
- OpenAPI Learn, “Parameters and Payload of an Operation” — https://learn.openapis.org/specification/parameters.html
- Swagger Docs, “Describing Request Body” — https://swagger.io/docs/specification/v3_0/describing-request-body/describing-request-body/

---

# End of Part 006

Next part:

`learn-openapi-mastery-for-java-engineers-part-007.md` — Responses: Status Codes, Content, Headers, Errors, and Invariants.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-005.md">⬅️ Part 005 — Parameters: Path, Query, Header, Cookie, Style, Explode, and Encoding</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-007.md">OpenAPI Mastery for Java Engineers — Part 007 ➡️</a>
</div>
