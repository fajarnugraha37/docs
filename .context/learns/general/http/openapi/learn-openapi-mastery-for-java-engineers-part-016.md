# OpenAPI Mastery for Java Engineers — Part 016
# Examples, Samples, Mocks, and Documentation as Executable Understanding

> **Filename:** `learn-openapi-mastery-for-java-engineers-part-016.md`  
> **Series:** `learn-openapi-mastery-for-java-engineers`  
> **Part:** `016 / 030`  
> **Status:** In progress  
> **Previous:** Part 015 — Breaking Changes and Compatibility  
> **Next:** Part 017 — Security Schemes

---

## 0. Why This Part Exists

A lot of teams treat examples in OpenAPI as decoration.

They write something like:

```yaml
example:
  id: "123"
  name: "John Doe"
```

Then they move on.

That is not enough.

In a serious API program, examples are not cosmetic. They are a compact form of executable understanding. A good OpenAPI example can do at least seven jobs:

1. Help a human understand the operation quickly.
2. Help a frontend/mobile/partner engineer build against the API before the backend is ready.
3. Feed mock servers.
4. Feed documentation portals.
5. Feed integration tests.
6. Feed generated SDK tests.
7. Reveal ambiguity in the contract.

Bad examples do the opposite. They create false confidence. They show happy paths only, omit required headers, hide error behavior, use fake values that do not pass validation, and drift away from the actual schema.

For a Java engineer, especially one working in backend/platform/regulatory systems, this part matters because examples often become the first thing another team copies. If the example is weak, the consumer implementation becomes weak.

The mental shift:

```text
Weak view:
OpenAPI examples are sample JSON for documentation.

Strong view:
OpenAPI examples are validated scenario artifacts that connect contract, docs, mocks, tests, and consumer behavior.
```

This part is about designing examples and documentation as **usable engineering assets**, not as pretty Swagger UI screenshots.

---

## 1. Official Baseline

OpenAPI lets you attach descriptive and example information in several places:

- `summary`
- `description`
- `externalDocs`
- `example`
- `examples`
- `components/examples`
- schema-level examples
- media-type-level examples
- parameter examples
- request body examples
- response examples
- header examples
- link and callback examples

OpenAPI v3.2.0 defines an OpenAPI document as a JSON object representable in JSON or YAML, and the official specification uses YAML examples for brevity. The specification is the normative source for how fields such as `example`, `examples`, `Example Object`, and `Media Type Object` behave.

References used while preparing this part:

- OpenAPI Specification v3.2.0: `https://spec.openapis.org/oas/v3.2.0.html`
- OpenAPI Initiative: `https://www.openapis.org/`
- OpenAPI v3.2 announcement: `https://www.openapis.org/blog/2025/09/23/announcing-openapi-v3-2`

The important design implication:

```text
OpenAPI examples are not isolated text blocks.
They are structured artifacts inside a machine-readable contract.
```

---

## 2. Documentation Example vs Contract Example

A documentation example is for reading.

A contract example is for reading **and verification**.

### 2.1 Documentation-Only Example

```yaml
example:
  id: "case-123"
  status: "OPEN"
  title: "Noise complaint"
```

This might be helpful, but it is weak if:

- it is not validated against schema,
- it does not represent realistic values,
- it ignores required fields,
- it is not connected to tests,
- it is not reused by mocks,
- it does not show edge cases,
- nobody notices when it becomes stale.

### 2.2 Contract-Grade Example

A contract-grade example should satisfy stronger properties:

```text
For the operation and scenario it represents:
- the example matches the schema,
- required fields are present,
- value formats are realistic,
- business semantics are plausible,
- headers are included where relevant,
- error examples match the error model,
- examples can be reused in tests or mocks,
- examples are reviewed as part of contract review.
```

In other words:

```text
A contract example should be boringly correct.
```

Not flashy. Not vague. Not generated without review. Correct.

---

## 3. Why Examples Are Harder Than They Look

Examples look easy because they are small.

But they encode many assumptions:

- What does a real ID look like?
- Are timestamps UTC?
- Is `status` internal or public?
- Can the response include empty arrays?
- Are missing optional fields omitted or returned as `null`?
- Does an error include a stable machine-readable code?
- Is a validation error flat or field-level?
- Does `201 Created` include `Location`?
- Does `202 Accepted` include a job resource?
- Does the system expose state transition links?
- Does a `409 Conflict` mean duplicate, stale version, invalid state transition, or all of them?

A weak example hides these questions.

A strong example forces the team to answer them.

This is why examples are a design tool, not just documentation output.

---

## 4. Where Examples Can Appear

### 4.1 Schema-Level Example

A schema-level example describes a sample value for that schema.

```yaml
components:
  schemas:
    CaseSummary:
      type: object
      required: [id, referenceNumber, status, title]
      properties:
        id:
          type: string
          format: uuid
        referenceNumber:
          type: string
          example: "ENF-2026-000042"
        status:
          type: string
          enum: [DRAFT, SUBMITTED, UNDER_REVIEW, CLOSED]
        title:
          type: string
      example:
        id: "4fd22db0-c687-450f-8bfd-08f5c754d023"
        referenceNumber: "ENF-2026-000042"
        status: "UNDER_REVIEW"
        title: "Unlicensed activity investigation"
```

Use this when the example is generally representative of the schema across contexts.

But be careful: the same schema may appear in different operations with different semantics. A schema-level example can become too generic.

### 4.2 Media-Type-Level Example

A media type example is attached to a specific payload representation.

```yaml
responses:
  '200':
    description: Case found.
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/CaseDetail'
        example:
          id: "4fd22db0-c687-450f-8bfd-08f5c754d023"
          referenceNumber: "ENF-2026-000042"
          status: "UNDER_REVIEW"
          title: "Unlicensed activity investigation"
          assignedUnit: "Market Conduct"
```

This is stronger when the example is operation-specific.

### 4.3 Multiple Named Examples

Use `examples` when one example is not enough.

```yaml
responses:
  '200':
    description: Case found.
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/CaseDetail'
        examples:
          underReview:
            summary: Case under review
            value:
              id: "4fd22db0-c687-450f-8bfd-08f5c754d023"
              referenceNumber: "ENF-2026-000042"
              status: "UNDER_REVIEW"
              title: "Unlicensed activity investigation"
              assignedUnit: "Market Conduct"
          closedWithAction:
            summary: Closed case with enforcement action
            value:
              id: "c4dd6e4f-c4de-4e1b-995e-142c6fd8135a"
              referenceNumber: "ENF-2026-000099"
              status: "CLOSED"
              title: "Late disclosure investigation"
              outcome:
                type: "ENFORCEMENT_ACTION"
                actionId: "5a761ce2-cb1a-4a8e-946c-158accdc5b07"
```

Multiple examples are very useful when behavior depends on lifecycle state, permissions, resource type, error cause, or business scenario.

### 4.4 Component-Level Reusable Examples

You can define reusable examples under `components/examples`.

```yaml
components:
  examples:
    ValidationErrorExample:
      summary: Validation error for missing required fields
      value:
        type: "https://api.example.gov/problems/validation-error"
        title: "Request validation failed"
        status: 422
        detail: "One or more fields failed validation."
        errors:
          - field: "title"
            code: "REQUIRED"
            message: "Title is required."
```

Then reference them:

```yaml
responses:
  '422':
    description: Validation failed.
    content:
      application/problem+json:
        schema:
          $ref: '#/components/schemas/ValidationProblem'
        examples:
          missingTitle:
            $ref: '#/components/examples/ValidationErrorExample'
```

Reusable examples are powerful for standardized errors and common scenarios, but dangerous if reused where the scenario does not really match.

---

## 5. `example` vs `examples`

A common source of confusion:

```text
example  = one inline example
examples = named map of examples
```

You generally should prefer `examples` for operation-level payloads because names carry scenario meaning.

Weak:

```yaml
example:
  status: "CLOSED"
```

Better:

```yaml
examples:
  closedWithNoAction:
    summary: Closed case with no enforcement action
    value:
      status: "CLOSED"
      outcome:
        type: "NO_ACTION"
  closedWithPenalty:
    summary: Closed case with monetary penalty
    value:
      status: "CLOSED"
      outcome:
        type: "MONETARY_PENALTY"
        penaltyAmount:
          amount: "25000.00"
          currency: "USD"
```

The example names become documentation anchors and sometimes test fixture names.

Good names should describe scenarios, not just values.

Bad names:

```text
example1
example2
validExample
invalidExample
sample
foo
```

Good names:

```text
submittedCase
closedCaseWithPenalty
validationErrorMissingTitle
conflictDueToStaleVersion
notFoundForUnknownCaseId
rateLimitedPartnerRequest
```

---

## 6. Examples Should Match Schema, But Schema Match Is Not Enough

Schema validation catches structural mismatch.

It can catch:

- missing required property,
- wrong type,
- invalid enum,
- too short string,
- invalid numeric range,
- invalid array shape,
- disallowed additional property, depending on schema.

But schema validation usually cannot fully catch:

- unrealistic business values,
- invalid lifecycle transition,
- wrong permission scenario,
- inconsistent timestamps,
- incorrect correlation between fields,
- domain-inaccurate status/outcome combination,
- misleading human description,
- privacy leak,
- stale business terminology.

Example:

```yaml
value:
  status: "CLOSED"
  closedAt: null
```

This might pass schema if `closedAt` is nullable. But semantically, a closed case without a closure timestamp may be invalid.

Another example:

```yaml
value:
  decision: "NO_VIOLATION"
  enforcementAction:
    type: "MONETARY_PENALTY"
```

The schema might allow both fields. But the combination is probably nonsensical.

Therefore:

```text
Example correctness has two layers:
1. Structural correctness: validates against schema.
2. Semantic correctness: makes sense in the domain.
```

Top-tier API review checks both.

---

## 7. The Example Quality Ladder

Think of example quality as levels.

### Level 0 — No Example

The spec only has schemas.

Consumer must infer everything.

This is common but weak.

### Level 1 — Toy Example

```json
{
  "id": "123",
  "name": "test"
}
```

This is slightly better than nothing, but often misleading.

### Level 2 — Structurally Valid Example

The example matches the schema.

Good start, but still not enough.

### Level 3 — Realistic Scenario Example

The example uses realistic IDs, timestamps, state, error codes, and field combinations.

### Level 4 — Multi-Scenario Examples

The operation includes examples for happy path, edge cases, errors, and lifecycle variants.

### Level 5 — Executable Examples

Examples are validated in CI and reused by mock servers/tests/docs.

### Level 6 — Governed Examples

Examples follow organizational standards, are reviewed for semantic quality, and are treated as release artifacts.

For serious APIs, target at least Level 4. For public/partner/regulatory APIs, target Level 5 or 6.

---

## 8. Designing Examples by Scenario, Not by Schema

A common mistake is to create examples from schemas mechanically.

Schema-driven example:

```json
{
  "id": "string",
  "status": "DRAFT",
  "createdAt": "2026-01-01T00:00:00Z"
}
```

This is not very useful.

Scenario-driven example:

```json
{
  "id": "4fd22db0-c687-450f-8bfd-08f5c754d023",
  "referenceNumber": "ENF-2026-000042",
  "status": "UNDER_REVIEW",
  "createdAt": "2026-03-12T09:18:32Z",
  "submittedAt": "2026-03-12T10:04:51Z",
  "assignedUnit": "Market Conduct",
  "riskRating": "HIGH"
}
```

The second example tells a story.

It answers:

- What does a real reference number look like?
- Are timestamps UTC?
- Can submitted cases be under review?
- Does assignment appear in this response?
- Is risk rating visible to this consumer?

Examples should be scenario-first:

```text
Start with: What consumer situation is this example explaining?
Then write payload.
Then validate payload against schema.
Then review semantics.
```

---

## 9. Scenario Inventory for Each Operation

For each operation, ask:

```text
What are the important scenarios a consumer needs to understand?
```

For `GET /cases/{caseId}`, examples might include:

- case found in draft state,
- case found under review,
- case closed with no action,
- case closed with enforcement action,
- case redacted for insufficient permission,
- case not found,
- case not accessible,
- malformed ID,
- response with minimal optional fields,
- response with all commonly present fields.

For `POST /cases`, examples might include:

- valid creation request,
- valid response with `201 Created`,
- validation error,
- duplicate client reference,
- idempotency replay,
- unauthorized request,
- forbidden request due to role,
- rate-limited request.

For `POST /cases/{caseId}/submit`, examples might include:

- successful submission,
- conflict because case is already submitted,
- conflict because required evidence is missing,
- forbidden because user is not owner,
- validation problem for missing declaration.

The point:

```text
Examples should cover behaviorally important variants, not every possible field permutation.
```

---

## 10. Request Examples

Request examples should help consumers construct valid calls.

### 10.1 Good Request Example

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        $ref: '#/components/schemas/CreateCaseRequest'
      examples:
        marketConductComplaint:
          summary: Create a market conduct complaint case
          value:
            clientReference: "PORTAL-2026-03-000418"
            title: "Alleged misleading product disclosure"
            category: "MARKET_CONDUCT"
            complainant:
              type: "INDIVIDUAL"
              fullName: "Ari Pratama"
              contactEmail: "ari.pratama@example.test"
            description: "Customer reports disclosure mismatch in product terms."
```

This is useful because it shows a real scenario and field relationships.

### 10.2 Weak Request Example

```yaml
example:
  clientReference: "string"
  title: "string"
  category: "string"
```

This technically shows shape, but not behavior.

### 10.3 Request Example Checklist

A good request example should answer:

- Which fields are consumer-provided?
- Which fields are omitted because server generates them?
- What realistic enum value should be used?
- What does a realistic reference look like?
- How are nested objects shaped?
- Are optional fields omitted or included?
- Are nullable fields intentionally null?
- Does the example represent a business-valid input?

---

## 11. Response Examples

Response examples should help consumers parse and use returned data.

### 11.1 `201 Created` Example

```yaml
responses:
  '201':
    description: Case created.
    headers:
      Location:
        description: URL of the created case resource.
        schema:
          type: string
          format: uri
        example: "https://api.example.gov/cases/4fd22db0-c687-450f-8bfd-08f5c754d023"
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/CaseDetail'
        examples:
          createdDraftCase:
            summary: Newly created case in draft state
            value:
              id: "4fd22db0-c687-450f-8bfd-08f5c754d023"
              referenceNumber: "ENF-2026-000042"
              status: "DRAFT"
              title: "Alleged misleading product disclosure"
              createdAt: "2026-03-12T09:18:32Z"
              createdBy: "user-7842"
```

This example communicates:

- status after creation is `DRAFT`,
- server assigns ID and reference number,
- `Location` header is present,
- timestamp format is UTC ISO-like string,
- creator is visible.

### 11.2 `202 Accepted` Example

For long-running operations, do not pretend the operation has completed.

```yaml
responses:
  '202':
    description: Submission accepted and queued for review workflow initialization.
    headers:
      Location:
        description: URL of the submission job resource.
        schema:
          type: string
          format: uri
        example: "https://api.example.gov/jobs/6f74884c-9f6c-4d38-8318-bfc4742b1147"
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/JobAcceptedResponse'
        examples:
          submissionQueued:
            summary: Case submission queued
            value:
              jobId: "6f74884c-9f6c-4d38-8318-bfc4742b1147"
              status: "QUEUED"
              submittedAt: "2026-03-12T10:04:51Z"
              estimatedCompletionSeconds: 30
```

This helps consumers know they must poll or subscribe, not assume immediate completion.

### 11.3 Empty Response Example

For `204 No Content`, do not fake a body.

```yaml
responses:
  '204':
    description: Case note deleted. No response body is returned.
```

The description matters because it prevents consumers from expecting a response payload.

---

## 12. Error Examples

Error examples are more important than success examples in many APIs.

Success paths are often straightforward. Error paths determine resilience.

A serious API should document error scenarios clearly.

### 12.1 Problem Details Example

Using `application/problem+json`:

```yaml
components:
  schemas:
    Problem:
      type: object
      required: [type, title, status]
      properties:
        type:
          type: string
          format: uri
        title:
          type: string
        status:
          type: integer
        detail:
          type: string
        instance:
          type: string
          format: uri
        traceId:
          type: string

    ValidationProblem:
      allOf:
        - $ref: '#/components/schemas/Problem'
        - type: object
          required: [errors]
          properties:
            errors:
              type: array
              items:
                $ref: '#/components/schemas/FieldError'

    FieldError:
      type: object
      required: [field, code, message]
      properties:
        field:
          type: string
        code:
          type: string
        message:
          type: string
```

Example:

```yaml
responses:
  '422':
    description: Request body is structurally valid JSON but fails validation rules.
    content:
      application/problem+json:
        schema:
          $ref: '#/components/schemas/ValidationProblem'
        examples:
          missingRequiredTitle:
            summary: Required title is missing
            value:
              type: "https://api.example.gov/problems/validation-error"
              title: "Request validation failed"
              status: 422
              detail: "One or more fields failed validation."
              traceId: "00-b3a1f8808f564fc0a4d1b86f1af21e2c-53ad1f4db2be85f1-01"
              errors:
                - field: "title"
                  code: "REQUIRED"
                  message: "Title is required."
```

### 12.2 Conflict Example

```yaml
responses:
  '409':
    description: Case cannot be submitted from its current state.
    content:
      application/problem+json:
        schema:
          $ref: '#/components/schemas/Problem'
        examples:
          invalidStateTransition:
            summary: Case is already closed
            value:
              type: "https://api.example.gov/problems/invalid-state-transition"
              title: "Invalid state transition"
              status: 409
              detail: "A closed case cannot be submitted."
              traceId: "00-f24f4c367eb0478bbf9849f2b94f1fa2-6f9b0f6cf98cb76b-01"
```

### 12.3 Permission Error Example

```yaml
responses:
  '403':
    description: Caller is authenticated but not allowed to access the case.
    content:
      application/problem+json:
        schema:
          $ref: '#/components/schemas/Problem'
        examples:
          restrictedCaseAccess:
            summary: Caller lacks case access entitlement
            value:
              type: "https://api.example.gov/problems/forbidden"
              title: "Forbidden"
              status: 403
              detail: "You do not have permission to access this case."
              traceId: "00-d0c3f05a80b34d848d78f2d4f3e39444-4c41bc24ff8c7b1f-01"
```

### 12.4 Error Example Checklist

For each error example, ask:

- Is the HTTP status code specific enough?
- Is the error body shape standard?
- Is there a stable machine-readable `type` or `code`?
- Is `detail` safe to expose?
- Does it avoid leaking internal implementation details?
- Does it help the consumer decide next action?
- Does it distinguish validation, conflict, authorization, not-found, and rate-limit cases?
- Is the example consistent with actual implementation?

---

## 13. Edge Case Examples

Happy path examples are necessary but insufficient.

Edge case examples teach consumers what happens near boundaries.

### 13.1 Empty List

```yaml
examples:
  emptyResult:
    summary: No cases match the filter
    value:
      data: []
      page:
        size: 25
        nextCursor: null
```

This tells consumers not to treat empty arrays as errors.

### 13.2 Minimal Object

```yaml
examples:
  minimalDraftCase:
    summary: Draft case with only required fields
    value:
      id: "4fd22db0-c687-450f-8bfd-08f5c754d023"
      referenceNumber: "ENF-2026-000042"
      status: "DRAFT"
      title: "Alleged misleading product disclosure"
```

This tells consumers optional fields may be absent.

### 13.3 Full Object

```yaml
examples:
  detailedClosedCase:
    summary: Closed case with decision and enforcement action
    value:
      id: "c4dd6e4f-c4de-4e1b-995e-142c6fd8135a"
      referenceNumber: "ENF-2026-000099"
      status: "CLOSED"
      title: "Late disclosure investigation"
      createdAt: "2026-02-04T08:12:10Z"
      closedAt: "2026-05-18T15:22:43Z"
      decision:
        finding: "VIOLATION_CONFIRMED"
        decidedAt: "2026-05-16T11:30:00Z"
      enforcementAction:
        id: "5a761ce2-cb1a-4a8e-946c-158accdc5b07"
        type: "MONETARY_PENALTY"
        amount:
          value: "25000.00"
          currency: "USD"
```

This helps consumers see richer response structure.

### 13.4 Redacted Object

Regulatory and case systems often need redaction examples.

```yaml
examples:
  redactedCase:
    summary: Case visible with redacted sensitive fields
    value:
      id: "4fd22db0-c687-450f-8bfd-08f5c754d023"
      referenceNumber: "ENF-2026-000042"
      status: "UNDER_REVIEW"
      title: "Alleged misleading product disclosure"
      complainant:
        type: "INDIVIDUAL"
        fullName: "REDACTED"
        contactEmail: null
      redactions:
        - field: "complainant.contactEmail"
          reason: "INSUFFICIENT_PERMISSION"
```

This is valuable because it documents a real access-control behavior that schema alone cannot fully explain.

---

## 14. Examples and Null Semantics

Examples are one of the best places to clarify null vs absent.

There are three distinct states:

```text
1. Field is present with a value.
2. Field is present with null.
3. Field is absent.
```

These are not equivalent.

Example:

```json
{
  "closedAt": null
}
```

This might mean:

- the case is not closed yet,
- the closure date is unknown,
- the caller lacks permission,
- the field is nullable for legacy reasons.

If you omit the field:

```json
{}
```

That might mean:

- the field is optional,
- the server suppresses empty fields,
- the requested representation is sparse,
- the field is not applicable.

A good OpenAPI description should clarify this. Examples reinforce it.

Better:

```yaml
closedAt:
  type:
    - string
    - 'null'
  format: date-time
  description: >
    Timestamp when the case was closed. Null when the case is not yet closed.
    The field is included in detail responses but omitted from summary responses.
```

Example:

```yaml
examples:
  underReviewCase:
    value:
      status: "UNDER_REVIEW"
      closedAt: null
  closedCase:
    value:
      status: "CLOSED"
      closedAt: "2026-05-18T15:22:43Z"
```

For Java engineers, this matters because JSON null/absent semantics interact with:

- Jackson serialization inclusion rules,
- Java primitive vs boxed types,
- `Optional` misuse,
- Bean Validation,
- generated clients,
- frontend TypeScript types.

---

## 15. Examples and Enum Evolution

Examples often accidentally teach consumers to hard-code enum assumptions.

Weak:

```yaml
status:
  type: string
  enum: [DRAFT, SUBMITTED, UNDER_REVIEW, CLOSED]
  example: "DRAFT"
```

If every example uses `DRAFT`, consumers may not understand state diversity.

Better:

```yaml
examples:
  draftCase:
    value:
      status: "DRAFT"
  submittedCase:
    value:
      status: "SUBMITTED"
  underReviewCase:
    value:
      status: "UNDER_REVIEW"
  closedCase:
    value:
      status: "CLOSED"
```

Also include descriptions:

```yaml
status:
  type: string
  description: >
    Public lifecycle status of the case. Consumers should tolerate unknown future values
    by displaying them as unrecognized statuses instead of failing deserialization.
  enum:
    - DRAFT
    - SUBMITTED
    - UNDER_REVIEW
    - CLOSED
```

In generated Java clients, enum expansion can break consumers if deserialization is strict. Examples cannot solve that alone, but they can signal expected handling.

---

## 16. Examples and Headers

Many APIs document body examples but forget headers.

Headers often carry important behavior:

- `Location`
- `ETag`
- `If-Match`
- `Retry-After`
- correlation IDs
- rate-limit headers
- idempotency keys
- pagination cursors, if header-based
- deprecation/sunset headers

Example:

```yaml
parameters:
  - name: Idempotency-Key
    in: header
    required: true
    description: >
      Unique key supplied by the client to make case creation safely retryable.
    schema:
      type: string
      minLength: 16
      maxLength: 128
    examples:
      uuidKey:
        summary: UUID idempotency key
        value: "16b79354-7d8f-4e67-8af2-38b313b7e7d7"
```

Response header example:

```yaml
responses:
  '429':
    description: Too many requests.
    headers:
      Retry-After:
        description: Number of seconds to wait before retrying.
        schema:
          type: integer
          minimum: 1
        example: 60
    content:
      application/problem+json:
        schema:
          $ref: '#/components/schemas/Problem'
        examples:
          rateLimited:
            value:
              type: "https://api.example.gov/problems/rate-limited"
              title: "Too many requests"
              status: 429
              detail: "The rate limit for this API plan has been exceeded."
```

If a consumer must handle the header, include a header example.

---

## 17. Examples and Multipart Requests

Multipart is a place where examples are often weak.

Suppose you have an evidence upload endpoint:

```yaml
paths:
  /cases/{caseId}/evidence:
    post:
      operationId: uploadCaseEvidence
      summary: Upload evidence for a case
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [file, metadata]
              properties:
                file:
                  type: string
                  format: binary
                metadata:
                  $ref: '#/components/schemas/EvidenceMetadata'
            encoding:
              metadata:
                contentType: application/json
      responses:
        '201':
          description: Evidence uploaded.
```

For multipart, inline examples are tool-dependent and not always rendered well. Use descriptions aggressively:

```yaml
components:
  schemas:
    EvidenceMetadata:
      type: object
      required: [title, evidenceType, collectedAt]
      properties:
        title:
          type: string
        evidenceType:
          type: string
          enum: [DOCUMENT, IMAGE, AUDIO, VIDEO, OTHER]
        collectedAt:
          type: string
          format: date-time
      example:
        title: "Signed disclosure form"
        evidenceType: "DOCUMENT"
        collectedAt: "2026-03-12T08:45:00Z"
```

Also add operation description:

```yaml
description: >
  Uploads one evidence file with JSON metadata. The `file` part contains the binary file.
  The `metadata` part must use `Content-Type: application/json` and match EvidenceMetadata.
```

The point is not to force every tool to render multipart perfectly. The point is to remove ambiguity.

---

## 18. Examples and Pagination

List APIs need examples for pagination behavior.

### 18.1 Non-Empty Page

```yaml
examples:
  firstPage:
    summary: First page with next cursor
    value:
      data:
        - id: "4fd22db0-c687-450f-8bfd-08f5c754d023"
          referenceNumber: "ENF-2026-000042"
          status: "UNDER_REVIEW"
          title: "Alleged misleading product disclosure"
        - id: "c4dd6e4f-c4de-4e1b-995e-142c6fd8135a"
          referenceNumber: "ENF-2026-000099"
          status: "CLOSED"
          title: "Late disclosure investigation"
      page:
        size: 2
        nextCursor: "eyJjcmVhdGVkQXQiOiIyMDI2LTAzLTEyVDA5OjE4OjMyWiJ9"
```

### 18.2 Last Page

```yaml
examples:
  lastPage:
    summary: Last page has no next cursor
    value:
      data:
        - id: "57b422c0-f59c-4d51-9dd7-f3e9c71c521d"
          referenceNumber: "ENF-2026-000115"
          status: "SUBMITTED"
          title: "Incomplete disclosure submission"
      page:
        size: 25
        nextCursor: null
```

### 18.3 Empty Result

```yaml
examples:
  noMatches:
    summary: Filter produced no results
    value:
      data: []
      page:
        size: 25
        nextCursor: null
```

These examples answer important questions:

- Is empty result `200` or `404`?
- Is `nextCursor` null, omitted, or absent?
- Does `size` mean requested size or actual result count?
- Is pagination metadata inside body or headers?

---

## 19. Examples and Filtering/Sorting

Filtering examples should show valid query combinations.

```yaml
parameters:
  - name: status
    in: query
    required: false
    schema:
      type: array
      items:
        type: string
        enum: [DRAFT, SUBMITTED, UNDER_REVIEW, CLOSED]
    style: form
    explode: true
    examples:
      activeStatuses:
        summary: Return submitted or under-review cases
        value: [SUBMITTED, UNDER_REVIEW]

  - name: sort
    in: query
    required: false
    schema:
      type: string
      example: "-createdAt,referenceNumber"
    description: >
      Comma-separated sort fields. Prefix a field with '-' for descending order.
      Supported fields: createdAt, referenceNumber, status.
```

But do not rely only on parameter examples. Include full request examples in description when helpful:

```text
Example request:
GET /cases?status=SUBMITTED&status=UNDER_REVIEW&sort=-createdAt,referenceNumber&pageSize=25
```

In OpenAPI, examples explain parameters individually; descriptions often explain cross-parameter behavior.

Important cross-parameter questions:

- Can `status` appear multiple times?
- Are filters ANDed or ORed?
- Are sort fields whitelisted?
- What happens with unsupported filter values?
- Does filter order matter?
- Are filters case-sensitive?

Examples can show common use, but descriptions must define semantics.

---

## 20. Examples and State Machines

For workflow-heavy APIs, examples should represent state transitions.

Suppose a case lifecycle is:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> DECISION_PENDING -> CLOSED
```

Do not only show object shape. Show transition operations.

### 20.1 Submit Case Request

```yaml
paths:
  /cases/{caseId}/submit:
    post:
      operationId: submitCase
      summary: Submit a draft case for review
      description: >
        Submits a draft case. Only cases in DRAFT status can be submitted.
        On success, the case transitions to SUBMITTED.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SubmitCaseRequest'
            examples:
              submitWithDeclaration:
                value:
                  declarationAccepted: true
                  comment: "All required evidence has been attached."
      responses:
        '200':
          description: Case submitted.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CaseDetail'
              examples:
                submittedCase:
                  value:
                    id: "4fd22db0-c687-450f-8bfd-08f5c754d023"
                    referenceNumber: "ENF-2026-000042"
                    status: "SUBMITTED"
                    submittedAt: "2026-03-12T10:04:51Z"
```

### 20.2 Invalid Transition Error

```yaml
        '409':
          description: Case is not in a state that allows submission.
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/Problem'
              examples:
                alreadyClosed:
                  value:
                    type: "https://api.example.gov/problems/invalid-state-transition"
                    title: "Invalid state transition"
                    status: 409
                    detail: "Only draft cases can be submitted. Current status is CLOSED."
```

These examples make lifecycle semantics visible.

---

## 21. Examples and Idempotency

For APIs with retries, examples should show idempotency behavior.

### 21.1 Request Header

```yaml
parameters:
  - name: Idempotency-Key
    in: header
    required: true
    description: >
      Unique client-generated key used to make this operation safely retryable.
      Reusing the same key with the same request returns the original result.
    schema:
      type: string
      minLength: 16
      maxLength: 128
    examples:
      generatedUuid:
        value: "16b79354-7d8f-4e67-8af2-38b313b7e7d7"
```

### 21.2 Replay Response Example

```yaml
responses:
  '200':
    description: Existing result returned for an idempotent replay.
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/CaseDetail'
        examples:
          idempotentReplay:
            summary: Same result returned for repeated idempotency key
            value:
              id: "4fd22db0-c687-450f-8bfd-08f5c754d023"
              referenceNumber: "ENF-2026-000042"
              status: "DRAFT"
```

### 21.3 Key Conflict Example

```yaml
responses:
  '409':
    description: Idempotency key was reused with a different request body.
    content:
      application/problem+json:
        schema:
          $ref: '#/components/schemas/Problem'
        examples:
          idempotencyKeyConflict:
            value:
              type: "https://api.example.gov/problems/idempotency-key-conflict"
              title: "Idempotency key conflict"
              status: 409
              detail: "This idempotency key was already used with a different request."
```

Without examples, idempotency is easy to misunderstand.

---

## 22. Examples as Mock Inputs

Mock servers can generate responses from OpenAPI examples.

This enables parallel development:

```text
Backend contract ready -> mock server -> frontend/mobile/partner integration starts -> backend implementation catches up.
```

### 22.1 What Mocks Are Good For

Mocks are good for:

- early UI development,
- partner onboarding,
- SDK demonstrations,
- contract review,
- API documentation demos,
- basic integration wiring,
- scenario walkthroughs.

### 22.2 What Mocks Are Not Good For

Mocks are not enough for:

- proving business rules,
- proving authorization correctness,
- proving performance,
- proving transactional behavior,
- proving concurrency safety,
- proving backend state transitions,
- proving production reliability.

A mock can tell a consumer what the API should look like. It cannot prove the provider actually behaves correctly.

### 22.3 Static Mock vs Dynamic Mock

Static mock:

```text
Always returns the same example response.
```

Dynamic mock:

```text
Can choose examples based on path, method, parameters, status code, or scenario configuration.
```

For advanced usage, provide multiple named examples and let consumers choose scenario names where tooling supports it.

Example scenario names:

```text
createdDraftCase
validationErrorMissingTitle
conflictDueToStaleVersion
forbiddenRestrictedCase
rateLimitedPartnerRequest
```

---

## 23. Examples as Test Fixtures

You can use OpenAPI examples as test fixtures.

### 23.1 Provider Test

Provider test idea:

```text
For each documented response example:
1. Load example from OpenAPI.
2. Validate against response schema.
3. Optionally compare provider response shape to example shape.
4. Ensure implementation can produce equivalent scenario.
```

Pseudo-Java-ish structure:

```java
@Test
void createCase_responseExample_shouldValidateAgainstOpenApiSchema() {
    OpenApiDocument document = loadOpenApi("openapi.yaml");
    JsonNode example = document.example(
        "createCase",
        "201",
        "application/json",
        "createdDraftCase"
    );

    SchemaValidationResult result = openApiValidator.validateResponse(
        "createCase",
        201,
        "application/json",
        example
    );

    assertThat(result.isValid()).isTrue();
}
```

This is conceptual. The actual library can vary.

### 23.2 Consumer Test

Consumer test idea:

```text
For each documented response example:
1. Feed example JSON into generated/client-side parser.
2. Assert the client can deserialize it.
3. Assert application mapping handles it.
```

```java
@Test
void generatedClient_shouldDeserializeClosedCaseExample() throws Exception {
    String json = fixture("examples/case-closed-with-penalty.json");

    CaseDetail caseDetail = objectMapper.readValue(json, CaseDetail.class);

    assertThat(caseDetail.getStatus()).isEqualTo(CaseStatus.CLOSED);
    assertThat(caseDetail.getEnforcementAction()).isNotNull();
}
```

This catches client-side breakage early.

### 23.3 Documentation Test

Documentation test idea:

```text
No example should be published unless it validates against schema.
```

This is a simple CI rule but very effective.

---

## 24. Examples and Generated SDKs

Generated SDKs consume the spec. Examples influence developer expectations.

Bad examples can produce bad SDK documentation.

Example problems:

- all IDs are `123`,
- timestamps are not realistic,
- enum examples only show one state,
- error examples do not match generated error models,
- optional fields are always present,
- unknown enum handling is not explained,
- nullable fields are shown inconsistently.

A generated SDK is already one abstraction away from the API. Bad examples make it even harder for consumers to understand the real contract.

A practical SDK-focused example rule:

```text
Every public operation should have at least one example that can be used in generated SDK documentation without embarrassment.
```

For generated Java clients, pay extra attention to:

- date/time values,
- decimal money values,
- nullability,
- enum values,
- arrays with empty and non-empty cases,
- polymorphic response examples,
- error response examples.

---

## 25. Examples and Documentation UX

OpenAPI documentation is not just schema rendering.

Good documentation should help a consumer answer:

```text
What can I do?
What should I send?
What will I get?
What can go wrong?
What should I do next?
```

### 25.1 `summary`

Use `summary` as a concise operation label.

Weak:

```yaml
summary: Create
```

Better:

```yaml
summary: Create a draft enforcement case
```

### 25.2 `description`

Use `description` for behavior, constraints, lifecycle, and caveats.

Weak:

```yaml
description: Creates a case.
```

Better:

```yaml
description: >
  Creates a draft enforcement case. The case remains in DRAFT status until submitted.
  Server-generated fields include id, referenceNumber, createdAt, and createdBy.
  Use Idempotency-Key when retrying this request after timeout or network failure.
```

### 25.3 Parameter Description

Weak:

```yaml
description: Case ID.
```

Better:

```yaml
description: >
  Stable UUID assigned by the case service. This is not the human-facing reference number.
```

### 25.4 Field Description

Weak:

```yaml
status:
  type: string
```

Better:

```yaml
status:
  type: string
  description: >
    Public lifecycle status of the case. This value controls which transition operations
    are allowed for the current caller.
```

Descriptions explain semantics. Examples make semantics concrete.

---

## 26. Documentation Smells

Documentation can be structurally valid but semantically weak.

Common smells:

### 26.1 Empty Descriptions

```yaml
description: ""
```

or no description for complex fields.

### 26.2 Repeating the Field Name

```yaml
caseId:
  description: Case ID.
```

This does not add meaning.

### 26.3 Implementation Leakage

```yaml
description: >
  Primary key from CASE_TBL.
```

This leaks persistence internals and is usually not consumer-relevant.

### 26.4 Vague Error Documentation

```yaml
'400':
  description: Bad request.
```

What kind of bad request? JSON parse error? validation error? unsupported filter? malformed ID?

### 26.5 Inconsistent Language

One operation says “complaint”; another says “case”; another says “ticket” for the same concept.

### 26.6 Documentation Says More Than Contract

Description says:

```text
Status can be DRAFT, SUBMITTED, CLOSED.
```

But schema says:

```yaml
enum: [DRAFT, SUBMITTED, UNDER_REVIEW, CLOSED]
```

Now humans and tools disagree.

### 26.7 Example Violates Schema

Example has:

```json
{"status": "IN_REVIEW"}
```

Schema allows:

```yaml
enum: [DRAFT, SUBMITTED, UNDER_REVIEW, CLOSED]
```

This is not harmless. It is contract corruption.

### 26.8 Example Violates Business Semantics

Example has:

```json
{
  "status": "DRAFT",
  "submittedAt": "2026-03-12T10:04:51Z"
}
```

If draft cases cannot have `submittedAt`, the example is wrong even if schema permits it.

---

## 27. Mocking Strategy

A useful mocking strategy has layers.

### 27.1 Layer 1 — Static Examples

Return examples exactly as written.

Useful for:

- docs,
- UI layout,
- simple consumer onboarding.

### 27.2 Layer 2 — Scenario Selection

Allow consumer to choose scenario.

Example query convention for mock environment:

```text
GET /cases/{caseId}?__example=closedWithPenalty
```

This is usually mock-only and must not leak into production contract unless intentionally documented.

### 27.3 Layer 3 — Rule-Based Mock

Mock behavior based on request:

```text
If request title is missing -> return validation error.
If caseId is unknown -> return 404.
If status filter is CLOSED -> return closed case examples.
```

### 27.4 Layer 4 — Stateful Mock

Mock stores created resources and simulates transitions.

Useful for:

- demos,
- partner sandboxes,
- UI flows.

But be careful: stateful mocks can become pseudo-implementations. They require maintenance and can drift from real behavior.

### 27.5 Recommended Approach

For most teams:

```text
Use static examples for docs.
Use scenario-selectable mocks for consumer development.
Use contract tests against real provider for correctness.
Do not rely on mocks as proof of backend behavior.
```

---

## 28. Example Validation in CI

A practical CI pipeline for examples:

```text
1. Validate OpenAPI document syntax.
2. Bundle multi-file specs.
3. Validate examples against schemas.
4. Validate examples against style guide rules.
5. Run semantic checks where possible.
6. Generate docs/mocks from the validated artifact.
7. Fail build if examples are invalid.
```

Example rules:

```text
- Every 2xx response must have at least one example unless response has no body.
- Every operation must document at least one non-2xx response.
- Every application/problem+json response must have an example.
- Example names must be lowerCamelCase and scenario-oriented.
- No example may use placeholder values like "string", "foo", "bar", "test" in public APIs.
- Timestamps in examples must use UTC offset or Z notation.
- UUID fields must contain UUID-shaped values.
- Money fields must use string decimal or documented numeric convention consistently.
- No example may include secrets, tokens, real PII, or production identifiers.
```

CI cannot catch everything, but it can eliminate a large class of preventable documentation bugs.

---

## 29. Semantic Review Checklist

Use this checklist during API review.

### 29.1 Operation-Level Examples

For each operation:

```text
[ ] At least one success example exists.
[ ] Important error examples exist.
[ ] Examples are named by scenario.
[ ] Examples match schema.
[ ] Examples are semantically realistic.
[ ] Examples show relevant headers.
[ ] Examples do not expose sensitive data.
[ ] Examples match documented status codes.
[ ] Examples are compatible with generated clients.
```

### 29.2 Request Examples

```text
[ ] Consumer-provided fields are clear.
[ ] Server-generated fields are not included in request.
[ ] Required fields are present.
[ ] Optional fields are intentionally included or omitted.
[ ] Null values have clear meaning.
[ ] Enum values are realistic.
[ ] Nested objects are realistic.
[ ] File/multipart semantics are clear.
```

### 29.3 Response Examples

```text
[ ] Response example matches actual lifecycle.
[ ] Server-generated fields are present where expected.
[ ] Empty-list behavior is shown where relevant.
[ ] Pagination metadata is shown.
[ ] Redaction/permission behavior is shown if relevant.
[ ] Long-running operation behavior is shown if relevant.
[ ] Response headers are shown where relevant.
```

### 29.4 Error Examples

```text
[ ] Error body shape is standardized.
[ ] Machine-readable type/code exists.
[ ] Detail message is safe.
[ ] Validation errors show field-level detail.
[ ] Conflict errors distinguish cause.
[ ] Auth errors do not leak sensitive information.
[ ] Rate-limit errors show retry behavior.
[ ] Not-found errors do not leak existence where that matters.
```

---

## 30. Example Governance Standards

For an organization, define standards.

### 30.1 Naming

```text
Examples must be named as scenarios:
- createdDraftCase
- closedCaseWithPenalty
- validationErrorMissingTitle
- conflictDueToStaleVersion
```

Avoid:

```text
example1
sample
test
success
error
```

### 30.2 Placeholder Values

Disallow meaningless placeholders in production-grade examples:

```text
string
foo
bar
test
123
example
lorem ipsum
```

Use `.test` domains for fake emails when needed:

```text
ari.pratama@example.test
```

Do not use real-looking personal data unless approved and synthetic.

### 30.3 Time

Standardize timestamp examples:

```text
Use UTC `Z` unless the API explicitly carries local time semantics.
```

Example:

```json
"createdAt": "2026-03-12T09:18:32Z"
```

### 30.4 IDs

Use realistic ID shapes:

```json
"id": "4fd22db0-c687-450f-8bfd-08f5c754d023"
```

Do not use:

```json
"id": "1"
```

unless your API really uses integer IDs.

### 30.5 Money

Pick a representation and show it consistently.

Example:

```json
"amount": {
  "value": "25000.00",
  "currency": "USD"
}
```

Avoid accidental floating-point ambiguity in examples if the API uses decimal money semantics.

### 30.6 Sensitive Data

Never include:

- real access tokens,
- real emails,
- real phone numbers,
- real national identifiers,
- real case identifiers,
- real production URLs with secrets,
- real customer names,
- real evidence metadata.

Examples are often copied into docs, repos, SDKs, tickets, and external portals. Treat them as publishable artifacts.

---

## 31. Documentation as Consumer Journey

OpenAPI documentation should follow a consumer journey.

A consumer usually asks:

```text
1. What is this API for?
2. How do I authenticate?
3. Which operation should I call?
4. What request should I send?
5. What response should I expect?
6. What errors can happen?
7. How do I retry safely?
8. How does pagination work?
9. How do state transitions work?
10. How do I know if the API changed?
```

OpenAPI can answer many of these, but only if you use `description`, examples, tags, external docs, and reusable components intentionally.

### 31.1 Operation Documentation Template

For complex operations, use a consistent description template:

```md
Creates a draft enforcement case.

Lifecycle:
- The created case starts in DRAFT status.
- It must be submitted separately before review begins.

Idempotency:
- Supply `Idempotency-Key` for safe retries.
- Reusing the same key with a different request returns 409.

Authorization:
- Requires `case:create` permission.

Validation:
- `title`, `category`, and `complainant` are required.
- `clientReference` must be unique per submitting organization.

Errors:
- 400 for malformed JSON.
- 401 for missing/invalid authentication.
- 403 for insufficient permission.
- 409 for duplicate client reference or idempotency conflict.
- 422 for field-level validation errors.
```

That is far more useful than:

```text
Creates a case.
```

---

## 32. OpenAPI Examples and AI/Agent Consumption

Modern consumers are not only humans and generated clients. API descriptions are increasingly consumed by internal developer tools, AI agents, code assistants, and workflow automation.

This raises the bar for examples.

An agent or code assistant may rely on:

- operation summaries,
- parameter descriptions,
- examples,
- error descriptions,
- schema field descriptions,
- operation IDs.

If examples are vague or wrong, automated consumers may construct wrong calls.

Agent-ready OpenAPI descriptions need:

```text
- clear operation intent,
- unambiguous parameter semantics,
- realistic examples,
- explicit error behavior,
- stable operation IDs,
- no misleading placeholder values,
- precise auth/security documentation,
- clear lifecycle constraints.
```

This does not mean writing documentation for AI instead of humans. It means writing documentation that is semantically precise enough for both.

---

## 33. End-to-End Example: Case Creation Operation

Below is a more complete example that combines many ideas.

```yaml
paths:
  /cases:
    post:
      operationId: createCase
      summary: Create a draft enforcement case
      description: >
        Creates a draft enforcement case. The case remains in DRAFT status until
        submitted through submitCase. Supply Idempotency-Key when retrying this
        operation after timeout or network failure.
      tags:
        - Cases
      parameters:
        - name: Idempotency-Key
          in: header
          required: true
          description: Unique client-generated key used to make the request safely retryable.
          schema:
            type: string
            minLength: 16
            maxLength: 128
          examples:
            uuid:
              value: "16b79354-7d8f-4e67-8af2-38b313b7e7d7"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateCaseRequest'
            examples:
              marketConductComplaint:
                summary: Create a market conduct complaint case
                value:
                  clientReference: "PORTAL-2026-03-000418"
                  title: "Alleged misleading product disclosure"
                  category: "MARKET_CONDUCT"
                  complainant:
                    type: "INDIVIDUAL"
                    fullName: "Ari Pratama"
                    contactEmail: "ari.pratama@example.test"
                  description: "Customer reports disclosure mismatch in product terms."
      responses:
        '201':
          description: Case created.
          headers:
            Location:
              description: URL of the created case resource.
              schema:
                type: string
                format: uri
              example: "https://api.example.gov/cases/4fd22db0-c687-450f-8bfd-08f5c754d023"
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CaseDetail'
              examples:
                createdDraftCase:
                  summary: Newly created draft case
                  value:
                    id: "4fd22db0-c687-450f-8bfd-08f5c754d023"
                    referenceNumber: "ENF-2026-000042"
                    status: "DRAFT"
                    title: "Alleged misleading product disclosure"
                    category: "MARKET_CONDUCT"
                    createdAt: "2026-03-12T09:18:32Z"
                    createdBy: "user-7842"
        '409':
          description: Conflict with an existing request or resource.
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/Problem'
              examples:
                duplicateClientReference:
                  summary: Client reference already exists
                  value:
                    type: "https://api.example.gov/problems/duplicate-client-reference"
                    title: "Duplicate client reference"
                    status: 409
                    detail: "A case with clientReference PORTAL-2026-03-000418 already exists."
                idempotencyKeyConflict:
                  summary: Idempotency key reused with a different request
                  value:
                    type: "https://api.example.gov/problems/idempotency-key-conflict"
                    title: "Idempotency key conflict"
                    status: 409
                    detail: "This idempotency key was already used with a different request."
        '422':
          description: Request validation failed.
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/ValidationProblem'
              examples:
                missingRequiredTitle:
                  summary: Required title is missing
                  value:
                    type: "https://api.example.gov/problems/validation-error"
                    title: "Request validation failed"
                    status: 422
                    detail: "One or more fields failed validation."
                    errors:
                      - field: "title"
                        code: "REQUIRED"
                        message: "Title is required."
```

This operation is not perfect, but it is much better than a schema-only operation. It shows:

- operation intent,
- idempotency,
- realistic request,
- realistic success,
- `Location` header,
- duplicate conflict,
- idempotency conflict,
- validation error.

---

## 34. Anti-Patterns

### 34.1 Placeholder Examples

```json
{
  "id": "string",
  "name": "string"
}
```

This is almost useless.

### 34.2 Happy Path Only

Only documenting `200`/`201` tells consumers nothing about failure.

### 34.3 Examples That Do Not Validate

This creates toolchain mistrust.

### 34.4 Examples That Hide Lifecycle

A case-management API with no examples for different states is under-documented.

### 34.5 Real Sensitive Data in Examples

Never do this. Synthetic examples only.

### 34.6 Inconsistent Error Examples

If each endpoint has a different error shape, consumers must write endpoint-specific error handling.

### 34.7 Copy-Paste Examples

Example reused across endpoints even when the scenario is not true.

### 34.8 Generated Examples Without Review

Auto-generated examples are acceptable as drafts, not as final contract examples.

### 34.9 Documentation That Contradicts Schema

If prose and schema disagree, consumers do not know which one is true.

### 34.10 Mock-Only Confidence

Mocks can help consumer development. They do not prove provider correctness.

---

## 35. Java Implementation Alignment

From a Java backend perspective, examples should align with real boundary behavior.

### 35.1 Jackson

Check that examples match actual serialization rules:

- property naming strategy,
- date/time format,
- null inclusion,
- enum serialization,
- decimal serialization,
- polymorphic type fields.

If OpenAPI says:

```json
"createdAt": "2026-03-12T09:18:32Z"
```

but Jackson serializes:

```json
"createdAt": "2026-03-12T09:18:32.123456+00:00"
```

then you have a drift to resolve.

### 35.2 Bean Validation

If request examples omit a field annotated with `@NotNull`, something is wrong.

If schema allows a string length of 200 but Bean Validation caps at 100, example validation may pass but runtime may fail.

Align:

```text
OpenAPI schema constraints
Java Bean Validation constraints
Runtime validation behavior
Examples
Tests
```

### 35.3 Error Handling

If examples show `application/problem+json`, implementation should produce it consistently.

Spring exception handlers should not return ad hoc error bodies for some exceptions and Problem Details for others.

### 35.4 Generated DTOs

If using generated DTOs, example validation should be part of generation/testing.

If using hand-written DTOs, examples are a useful drift detector.

### 35.5 Test Fixture Strategy

Recommended structure:

```text
src/test/resources/openapi/examples/
  create-case-request-market-conduct.json
  create-case-response-created-draft.json
  problem-validation-missing-title.json
  problem-idempotency-key-conflict.json
```

These can be extracted from OpenAPI or maintained as source examples and referenced from OpenAPI, depending on your workflow.

---

## 36. Practical Workflow for Writing Good Examples

Use this process:

```text
1. Pick operation.
2. Identify consumer scenarios.
3. Pick success scenarios.
4. Pick error scenarios.
5. Write schema first or confirm schema exists.
6. Write examples by scenario.
7. Validate examples against schema.
8. Review examples for business semantics.
9. Review examples for sensitive data.
10. Use examples in docs/mocks/tests.
11. Add CI gate to prevent drift.
```

Do not start by generating random sample JSON.

Start from consumer need.

---

## 37. Exercise: Improve a Weak Example

Weak operation:

```yaml
paths:
  /cases:
    post:
      summary: Create case
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Case'
            example:
              id: "1"
              name: "test"
      responses:
        '200':
          description: OK
```

Problems:

- summary is vague,
- request uses `Case` schema, likely response/entity schema,
- request includes `id`, probably server-generated,
- `name` is vague,
- example uses toy values,
- response uses `200` for creation without explanation,
- no error responses,
- no idempotency,
- no lifecycle semantics,
- no realistic example,
- no response body contract.

Improved direction:

```yaml
paths:
  /cases:
    post:
      operationId: createCase
      summary: Create a draft enforcement case
      description: >
        Creates a draft enforcement case. Server-generated fields include id,
        referenceNumber, createdAt, and createdBy. The case starts in DRAFT status.
      parameters:
        - name: Idempotency-Key
          in: header
          required: true
          schema:
            type: string
            minLength: 16
            maxLength: 128
          examples:
            uuid:
              value: "16b79354-7d8f-4e67-8af2-38b313b7e7d7"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateCaseRequest'
            examples:
              marketConductComplaint:
                value:
                  clientReference: "PORTAL-2026-03-000418"
                  title: "Alleged misleading product disclosure"
                  category: "MARKET_CONDUCT"
                  description: "Customer reports disclosure mismatch in product terms."
      responses:
        '201':
          description: Case created.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CaseDetail'
              examples:
                createdDraftCase:
                  value:
                    id: "4fd22db0-c687-450f-8bfd-08f5c754d023"
                    referenceNumber: "ENF-2026-000042"
                    status: "DRAFT"
                    title: "Alleged misleading product disclosure"
                    category: "MARKET_CONDUCT"
                    createdAt: "2026-03-12T09:18:32Z"
        '422':
          description: Request validation failed.
```

Notice the improvement is not just more YAML. It is better semantics.

---

## 38. What Top 1% Engineers Do Differently

Average engineers often ask:

```text
Is the OpenAPI valid?
```

Strong engineers ask:

```text
Will the consumer understand the behavior correctly?
Can we validate examples automatically?
Will generated clients handle these examples?
Do examples show failure modes?
Do examples expose lifecycle and permission semantics?
Could this example be safely published externally?
Will this example still be true after schema evolution?
```

The difference is not syntax knowledge. It is contract thinking.

Top-tier OpenAPI examples are:

- scenario-based,
- valid,
- realistic,
- semantically reviewed,
- secure,
- testable,
- reusable,
- version-controlled,
- governed.

---

## 39. Summary

Examples are not decoration.

They are executable understanding.

A high-quality OpenAPI description uses examples to connect:

```text
schema
operation behavior
consumer expectation
documentation
mocking
testing
SDK generation
governance
```

The key rules:

```text
1. Prefer scenario-based examples.
2. Use `examples` when one example is not enough.
3. Validate examples against schemas.
4. Review examples for business semantics.
5. Include error examples.
6. Include headers where behavior depends on them.
7. Show edge cases: empty, minimal, full, redacted, conflict, rate-limited.
8. Never include sensitive real data.
9. Reuse examples carefully.
10. Treat examples as release artifacts.
```

A spec with no examples forces consumers to infer.

A spec with weak examples misleads consumers.

A spec with strong examples teaches, tests, mocks, and governs the API.

---

## 40. Part 016 Completion Checklist

You should now be able to:

```text
[ ] Explain why examples are not merely documentation.
[ ] Distinguish schema-level, media-type-level, and component examples.
[ ] Choose between `example` and `examples`.
[ ] Design scenario-based examples.
[ ] Write request, response, error, header, pagination, and lifecycle examples.
[ ] Identify documentation smells.
[ ] Use examples for mocks and tests.
[ ] Define example governance rules.
[ ] Align Java serialization/validation behavior with examples.
[ ] Review examples for structural and semantic correctness.
```

---

## 41. Next Part

Next:

```text
Part 017 — Security Schemes: Auth Modelling, OAuth2, JWT, API Keys, and Authorization Boundaries
```

We will cover:

- OpenAPI Security Scheme Object,
- Security Requirement Object,
- global vs operation-level security,
- API keys,
- HTTP bearer/JWT,
- OAuth2 flows,
- OpenID Connect discovery,
- scopes,
- optional authentication,
- multi-scheme security,
- Spring Security mapping,
- why OpenAPI can describe security expectations but cannot prove authorization correctness.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-015.md">⬅️ OpenAPI Mastery for Java Engineers — Part 015</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-017.md">OpenAPI Mastery for Java Engineers — Part 017 ➡️</a>
</div>
