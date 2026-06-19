# OpenAPI Mastery for Java Engineers — Part 015
# Breaking Changes and Compatibility: The Hardest Part of API Evolution

> Filename: `learn-openapi-mastery-for-java-engineers-part-015.md`  
> Series: `learn-openapi-mastery-for-java-engineers`  
> Part: `015 / 030`  
> Previous: `Part 014 — Contract Testing: Validating Providers and Consumers Against OpenAPI`  
> Next: `Part 016 — Examples, Samples, Mocks, and Documentation as Executable Understanding`

---

## 0. Why This Part Matters

API compatibility is where OpenAPI stops being documentation and becomes engineering discipline.

A team can write beautiful schemas, publish Swagger UI, generate SDKs, and still break consumers accidentally. The hard part is not describing the API as it exists today. The hard part is changing it tomorrow without making consumers fail in production.

For a Java engineer, especially one working on distributed systems, case management, regulatory workflows, or platform APIs, this part is one of the most important in the series.

Breaking changes are not only obvious things like removing an endpoint. They include subtle shifts such as:

- a response field becomes required in the implementation but not documented,
- an enum gains a new value and a generated client throws an exception,
- a field remains the same type but its business meaning changes,
- a server tightens validation on a query parameter,
- an error response shape changes and a frontend no longer maps validation errors,
- an `operationId` changes and generated SDK method names change,
- a security scope changes and machine clients start receiving `403`,
- a previously synchronous operation starts returning `202 Accepted`,
- a list endpoint changes default sort order,
- a cursor becomes non-stable,
- a supposedly internal API is used by another team without your knowledge.

The central idea of this part:

> Compatibility is not a property of a schema alone. Compatibility is a property of the relationship between provider behavior, consumer assumptions, generated artifacts, validation rules, documentation, rollout timing, and business semantics.

OpenAPI helps because it gives us a structured artifact to compare, validate, lint, publish, and review. But OpenAPI alone does not know every semantic promise your API makes. Top-tier API engineering requires both machine-detectable change control and human semantic review.

---

## 1. Learning Objectives

After this part, you should be able to:

1. Define breaking change from multiple perspectives.
2. Distinguish additive changes, non-breaking changes, breaking changes, and semantic breaking changes.
3. Evaluate compatibility impact across paths, operations, parameters, request bodies, responses, schemas, enums, security, examples, and generated SDKs.
4. Understand why some changes that look safe in OpenAPI are unsafe in real consumers.
5. Design OpenAPI contracts for long-term evolution.
6. Build a compatibility policy for internal, external, partner, and regulated APIs.
7. Use OpenAPI diffing as a CI gate without blindly trusting tool output.
8. Manage deprecation, sunset, migration, and versioning responsibly.
9. Reason about rollout strategies that avoid breaking consumers.
10. Review API changes with the depth expected from a senior/platform-level engineer.

---

## 2. Core Mental Model

### 2.1 Provider View vs Consumer View

From the provider's perspective, a change may feel harmless:

```text
"We only renamed an internal DTO field."
"We only added one enum value."
"We only made validation stricter."
"We only changed the error message."
"We only changed generated operation names."
"We only added auth to an endpoint that should have been protected anyway."
```

From the consumer's perspective, those changes can be catastrophic:

```text
"Our generated client no longer compiles."
"Our deserializer fails on the new enum."
"Our form cannot display validation errors."
"Our retry logic no longer understands the error response."
"Our background job now receives 403."
"Our reconciliation process cannot find the expected field."
"Our case workflow automation broke."
```

A breaking change is not defined by provider intent. It is defined by whether existing conforming consumers can continue to operate correctly without coordinated change.

### 2.2 Contract Compatibility Is Directional

Compatibility must be analyzed in direction:

```text
Old consumer -> New provider
New consumer -> Old provider
Old provider -> New generated client
New provider -> Old generated client
```

For most public or partner APIs, the most important direction is:

```text
Existing consumer built against old contract
        ↓
New provider behavior after deployment
```

A change is backward compatible when old consumers can keep working against the new provider.

A change is forward compatible when consumers can tolerate future provider changes.

Both matter, but they are not the same.

### 2.3 Schema Compatibility Is Not Behavioral Compatibility

Example:

```yaml
components:
  schemas:
    CaseStatus:
      type: string
      enum:
        - DRAFT
        - SUBMITTED
        - UNDER_REVIEW
        - CLOSED
```

Adding a new enum value:

```yaml
        - REOPENED
```

may look additive. But if consumers have exhaustive `switch` statements, generated enum types, UI badge mappings, analytics grouping, or workflow state machines, this can break them.

The schema changed additively. The behavior may have changed incompatibly.

### 2.4 The Real Compatibility Surface

An API contract includes at least:

```text
URL shape
HTTP method
operationId
parameters
request body shape
request validation rules
response status codes
response body shape
response headers
error model
security requirements
rate limits
pagination semantics
sorting defaults
idempotency rules
state transitions
timeout behavior
retry expectations
async lifecycle
field meaning
field cardinality
field nullability
field ordering assumptions
SDK method names
example validity
documentation promises
```

OpenAPI captures many of these directly, some indirectly, and some only through description, extensions, examples, style guide, or governance review.

---

## 3. A Practical Definition of Breaking Change

A breaking change is any change where at least one existing consumer, previously valid against the published contract and reasonable documented behavior, can fail or produce incorrect results without changing its own code, configuration, data model, or operational process.

This definition is intentionally broader than schema diff.

### 3.1 Breaking Change Categories

| Category | Example | Machine Detectable? | Requires Human Review? |
|---|---|---:|---:|
| Structural | Remove endpoint | Usually yes | Usually no |
| Contractual | Make optional field required | Usually yes | Sometimes |
| Validation | Tighten max length | Usually yes | Sometimes |
| Behavioral | Change default sort order | Often no | Yes |
| Semantic | Same field, new meaning | Rarely | Yes |
| Security | Add required OAuth scope | Sometimes | Yes |
| Operational | Reduce rate limit | Rarely | Yes |
| SDK | Change `operationId` | Usually yes | Sometimes |
| Documentation | Remove promised behavior | Sometimes | Yes |
| Workflow | Change state transition rules | Rarely | Yes |

### 3.2 The Hidden Clause: Existing Consumers

A breaking change requires thinking about actual and possible consumers.

For internal APIs, teams often say:

```text
"Nobody uses this field."
```

That claim is weak unless you have evidence:

- request logs,
- response field usage telemetry,
- consumer registry,
- SDK download/adoption data,
- client version reporting,
- partner acknowledgement,
- formal deprecation notice,
- feature flag metrics,
- contract tests from consumers.

Without evidence, the safe assumption is:

> If a published contract exposes it, someone may rely on it.

---

## 4. Additive, Breaking, and Semantically Risky Changes

### 4.1 Clearly Additive Changes

Usually safe:

- adding a new endpoint,
- adding a new optional request field that old clients do not send,
- adding a new optional response field if clients tolerate unknown fields,
- adding a new non-required query parameter,
- adding a new response status code only for a new request scenario,
- adding examples,
- adding documentation details that clarify existing behavior,
- adding a new schema component unused by existing operations.

But every item still has context.

Adding a response field can break clients that fail on unknown properties. Java clients usually tolerate unknown JSON fields if configured with Jackson defaults, but generated clients or strict consumers may not.

### 4.2 Clearly Breaking Changes

Usually breaking:

- removing an endpoint,
- changing a path,
- changing an HTTP method,
- removing a response field,
- renaming a response field,
- changing a field type,
- making an optional request field required,
- adding a required request header,
- removing an enum value,
- changing status code semantics,
- removing a documented response code,
- changing authentication requirement,
- changing required OAuth scopes,
- changing `operationId` used by SDK generation,
- tightening validation constraints,
- changing pagination cursor semantics,
- changing idempotency behavior,
- changing error shape.

### 4.3 Risky but Context-Dependent Changes

These need review:

- adding enum values,
- adding stricter server-side validation to undocumented behavior,
- changing default page size,
- changing default sorting,
- adding rate limits,
- adding new error code values,
- changing text error messages,
- broadening a response schema,
- changing null vs absent behavior,
- changing field format,
- changing example data that tests rely on,
- changing server URLs,
- changing tags used by documentation generation,
- changing schema names used by generated code.

The maturity move is to classify changes not as simply safe/unsafe, but as:

```text
safe automatically
safe with consumer tolerance assumption
safe with notice
safe only for beta API
requires migration window
breaking, requires new version
forbidden without explicit approval
```

---

## 5. Path-Level Breaking Changes

Paths are among the most visible API commitments.

### 5.1 Removing a Path

Old:

```yaml
paths:
  /cases/{caseId}:
    get:
      operationId: getCase
```

New:

```yaml
paths: {}
```

This is breaking. Existing consumers calling `GET /cases/{caseId}` fail.

### 5.2 Renaming a Path

Old:

```yaml
/cases/{caseId}
```

New:

```yaml
/enforcement-cases/{caseId}
```

This is breaking unless the old path remains as alias during a migration window.

Safe migration pattern:

```yaml
paths:
  /cases/{caseId}:
    get:
      operationId: getCaseLegacy
      deprecated: true
      summary: Get case by ID. Deprecated alias.
      responses:
        '200':
          description: Case found.

  /enforcement-cases/{caseId}:
    get:
      operationId: getEnforcementCase
      summary: Get enforcement case by ID.
      responses:
        '200':
          description: Case found.
```

Then operationally:

1. Keep old path working.
2. Mark old path deprecated.
3. Publish migration guide.
4. Monitor usage.
5. Notify consumers.
6. Sunset only after policy window.

### 5.3 Changing Path Parameter Name

Old:

```yaml
/cases/{caseId}
```

New:

```yaml
/cases/{id}
```

The URL template might look equivalent at runtime if the router only cares about position, but it can break generated clients, documentation links, request validators, and tests.

In OpenAPI, path template variable names must match path parameters. Generated SDKs often use the parameter name in method signatures.

Old generated method:

```java
CaseDto getCase(String caseId);
```

New generated method:

```java
CaseDto getCase(String id);
```

This can be source-compatible in Java only if method signature does not include parameter names at compile time. But generated documentation, Kotlin named arguments, TypeScript clients, test fixtures, and human usage can be affected.

Treat path parameter rename as compatibility risk.

### 5.4 Adding a More Specific Path

Old:

```yaml
paths:
  /cases/{caseId}:
    get: ...
```

New:

```yaml
paths:
  /cases/{caseId}:
    get: ...
  /cases/search:
    get: ...
```

This can create routing ambiguity depending on router precedence. Some frameworks prioritize exact path over template; others require explicit ordering. OpenAPI path matching has rules, but runtime frameworks may differ.

If `/cases/search` previously matched `{caseId}=search`, adding a dedicated `/cases/search` endpoint changes behavior for consumers that used `search` as an ID, even if that seems unlikely.

Mitigation:

- reserve path segments early,
- validate IDs to exclude reserved words,
- avoid noun paths that collide with ID templates,
- design search as `/case-searches` or `/cases:search` if your style allows action suffixes,
- document ID constraints.

---

## 6. Method-Level Breaking Changes

### 6.1 Removing an Operation

Removing `POST /cases` is breaking.

### 6.2 Changing Method Semantics

Changing:

```text
POST /cases/{caseId}/submit
```

from synchronous completion to asynchronous acceptance is potentially breaking.

Old:

```yaml
responses:
  '200':
    description: Case submitted.
```

New:

```yaml
responses:
  '202':
    description: Submission accepted for asynchronous processing.
```

This is more than a status code change. Consumer flow changes from:

```text
call submit
assume submitted
refresh case
```

to:

```text
call submit
store operation/job id
poll or wait for callback
handle pending state
```

That is breaking unless the old synchronous contract is preserved or consumers were already told to treat submission as eventually consistent.

### 6.3 Changing Idempotency

Changing a method from idempotent behavior to non-idempotent behavior is breaking even if the OpenAPI shape is unchanged.

Example:

```text
PUT /cases/{caseId}/assignment
```

Old behavior:

```text
Repeated same request keeps same assignment.
```

New behavior:

```text
Repeated request creates duplicate assignment history entries and notifications.
```

The schema did not change. The contract did.

Document idempotency explicitly where it matters:

```yaml
put:
  operationId: replaceCaseAssignment
  description: |
    Replaces the current assignment for the case. This operation is idempotent
    for the same `assigneeId` and `assignmentReason` while the case remains in
    the same lifecycle state.
```

---

## 7. Parameter Breaking Changes

Parameters are a frequent source of subtle compatibility failures.

### 7.1 Adding Required Query Parameter

Old:

```yaml
parameters:
  - name: status
    in: query
    required: false
```

New:

```yaml
parameters:
  - name: jurisdiction
    in: query
    required: true
```

Breaking. Existing consumers that do not send `jurisdiction` now fail.

Safer migration:

```yaml
parameters:
  - name: jurisdiction
    in: query
    required: false
    schema:
      type: string
    description: |
      Optional during migration. If omitted, the server uses the consumer's
      default jurisdiction mapping. This parameter will become required after
      the migration window.
```

But be careful: documenting future requiredness does not make the current change safe. You still need notice, telemetry, and enforcement date.

### 7.2 Removing Optional Query Parameter

Old:

```yaml
- name: includeClosed
  in: query
  required: false
  schema:
    type: boolean
```

New: removed.

This can break consumers that relied on it. If the server ignores unknown query parameters, old clients may still get a response, but behavior changes because `includeClosed=true` no longer works.

That is breaking semantically.

### 7.3 Changing Parameter Type

Old:

```yaml
- name: limit
  in: query
  schema:
    type: integer
```

New:

```yaml
- name: limit
  in: query
  schema:
    type: string
```

Breaking. Generated clients, validators, docs, and consumer code can fail.

### 7.4 Tightening Parameter Constraints

Old:

```yaml
- name: limit
  in: query
  schema:
    type: integer
    maximum: 500
```

New:

```yaml
- name: limit
  in: query
  schema:
    type: integer
    maximum: 100
```

This is breaking for consumers that previously sent `limit=250` legally.

### 7.5 Loosening Parameter Constraints

Old:

```yaml
maximum: 100
```

New:

```yaml
maximum: 500
```

Usually non-breaking from request validation perspective. But operationally it can change load behavior. If consumers start requesting 500 items and your backend cannot handle it, you created a performance risk.

Not every non-breaking contract change is operationally safe.

### 7.6 Changing Serialization Style

Old:

```yaml
- name: status
  in: query
  style: form
  explode: true
  schema:
    type: array
    items:
      type: string
```

Example request:

```text
?status=OPEN&status=CLOSED
```

New:

```yaml
style: form
explode: false
```

Example request:

```text
?status=OPEN,CLOSED
```

Breaking. Existing consumers send arrays differently.

### 7.7 Changing Default Value

Old:

```yaml
- name: sort
  in: query
  required: false
  schema:
    type: string
    default: createdAt:desc
```

New:

```yaml
default: priority:desc
```

The schema type did not change. But consumers that omit `sort` see a different order. If they process first result, pagination, exports, or reconciliation based on ordering, behavior changes.

Default changes are semantic changes.

---

## 8. Request Body Breaking Changes

### 8.1 Adding a Required Request Field

Old:

```yaml
CreateCaseRequest:
  type: object
  required:
    - subjectId
    - allegationType
  properties:
    subjectId:
      type: string
    allegationType:
      type: string
```

New:

```yaml
required:
  - subjectId
  - allegationType
  - jurisdiction
```

Breaking. Existing clients do not send `jurisdiction`.

Safer pattern:

1. Add optional field.
2. Server derives value if absent.
3. Emit warning/deprecation metadata if possible.
4. Notify consumers.
5. Track absence.
6. Make required only in a new major version or after formal migration.

### 8.2 Removing a Request Field

If the server rejects unknown fields, removing a request field is breaking because old clients still send it.

If the server ignores unknown fields, removing it may still be semantic breaking because old clients expect it to affect behavior.

Example:

```yaml
expedite:
  type: boolean
```

If removed and ignored, old clients may think cases are expedited when they are not.

### 8.3 Changing Request Field Type

Old:

```yaml
priority:
  type: string
  enum: [LOW, NORMAL, HIGH]
```

New:

```yaml
priority:
  type: integer
  minimum: 1
  maximum: 3
```

Breaking.

Better migration:

```yaml
priority:
  oneOf:
    - type: string
      enum: [LOW, NORMAL, HIGH]
      deprecated: true
    - type: integer
      minimum: 1
      maximum: 3
```

But even this can be problematic in generated code. Supporting both representations can be awkward for SDKs. Often a new field is clearer:

```yaml
priority:
  type: string
  enum: [LOW, NORMAL, HIGH]
  deprecated: true
priorityLevel:
  type: integer
  minimum: 1
  maximum: 3
```

Then deprecate `priority` with a long migration window.

### 8.4 Tightening Validation

Old:

```yaml
notes:
  type: string
  maxLength: 4000
```

New:

```yaml
maxLength: 1000
```

Breaking.

Even if implementation always stored only 1000 characters and silently truncated, documenting 4000 created a contract expectation. Tightening to 1000 is a breaking contract correction.

### 8.5 Changing Unknown Field Policy

OpenAPI schema can imply object openness/closedness through `additionalProperties`, depending on version and schema dialect semantics.

Old behavior:

```text
Server ignores unknown JSON fields.
```

New behavior:

```text
Server rejects unknown JSON fields with 400.
```

This can break clients that send extra data, especially if they use broad DTOs shared across versions.

For Java/Spring/Jackson, this often appears as a change in `FAIL_ON_UNKNOWN_PROPERTIES`, validation layer, request DTO annotations, or generated server validation behavior.

### 8.6 Changing Null vs Absent Semantics

Old behavior:

```json
{
  "assignedOfficerId": null
}
```

means:

```text
Clear assigned officer.
```

Absent field means:

```text
Leave unchanged.
```

New behavior:

```text
null and absent are treated the same.
```

This is breaking for PATCH/update operations.

OpenAPI must be explicit when null and absent have distinct meaning.

---

## 9. Response Breaking Changes

### 9.1 Removing a Response Field

Old:

```yaml
CaseSummary:
  type: object
  properties:
    caseId:
      type: string
    status:
      type: string
    createdAt:
      type: string
      format: date-time
```

New:

```yaml
properties:
  caseId:
    type: string
  status:
    type: string
```

Breaking. Consumers may read `createdAt`.

### 9.2 Renaming a Response Field

Old:

```yaml
caseId:
  type: string
```

New:

```yaml
id:
  type: string
```

Breaking.

Safer migration:

```yaml
caseId:
  type: string
  deprecated: true
  description: Deprecated. Use `id`.
id:
  type: string
```

But the server must return both for the migration period.

### 9.3 Adding a Response Field

Usually additive, but can break strict clients.

Example strict Java/Jackson client:

```java
objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true);
```

If client generated model does not include the new field, deserialization can fail.

For public APIs, a good compatibility policy should state:

```text
Clients must ignore unknown response fields.
```

But publishing that policy does not guarantee every existing client already follows it.

### 9.4 Changing Response Field Type

Old:

```yaml
amount:
  type: number
```

New:

```yaml
amount:
  type: string
```

Breaking.

Even changes that look like precision improvements can break clients:

```yaml
amount:
  type: string
  pattern: '^\\d+\\.\\d{2}$'
```

If consumers expect numeric JSON, they fail.

### 9.5 Changing Numeric Range

Old:

```yaml
riskScore:
  type: integer
  minimum: 0
  maximum: 100
```

New:

```yaml
riskScore:
  type: integer
  minimum: 0
  maximum: 1000
```

Schema is loosened. But consumers may have UI progress bars, database columns, or validation expecting 0–100.

Loosening response constraints can still be breaking if consumers reasonably encoded the old documented range.

### 9.6 Changing Required Response Fields

Adding a required response field is usually not breaking for old clients at runtime because old clients ignore unknown fields or do not care about requiredness. But it can break generated clients, schema validators, and tests if they validate provider response against old/new specs differently.

Removing `required` from a response field means the field may be absent. That is breaking for consumers that rely on it.

Old:

```yaml
required:
  - caseId
  - status
```

New:

```yaml
required:
  - caseId
```

Now `status` can be absent. Existing consumers may fail.

### 9.7 Changing `nullable`

Old:

```yaml
assignedOfficerId:
  type:
    - string
    - 'null'
```

New:

```yaml
assignedOfficerId:
  type: string
```

For responses, removing nullability may be safe if clients can handle string. But if clients interpreted `null` as “unassigned” and now the server omits the field or returns an empty string, semantics changed.

Old:

```json
"assignedOfficerId": null
```

New:

```json
"assignedOfficerId": ""
```

This is semantic breaking.

### 9.8 Changing Response Status Codes

Old:

```yaml
responses:
  '200':
    description: Case found.
```

New:

```yaml
responses:
  '204':
    description: Case found, no content.
```

Breaking if consumers expect a body.

Old:

```yaml
responses:
  '200':
    description: Updated case.
```

New:

```yaml
responses:
  '202':
    description: Update accepted.
```

Potentially breaking because operation lifecycle changed.

Old:

```yaml
responses:
  '404':
    description: Case not found.
```

New:

```yaml
responses:
  '403':
    description: Caller cannot access case.
```

Can be breaking if consumers distinguish not found vs forbidden for UX or reconciliation.

### 9.9 Removing Error Response Documentation

If an endpoint previously documented `409 Conflict` and no longer does, consumers may assume conflict cannot happen. But if implementation still returns 409, contract drift occurs.

Removing error response documentation can be breaking for generated clients and test expectations.

---

## 10. Enum Evolution

Enums are deceptively dangerous.

### 10.1 Removing Enum Value

Old:

```yaml
CaseStatus:
  type: string
  enum:
    - DRAFT
    - SUBMITTED
    - CLOSED
```

New:

```yaml
enum:
  - DRAFT
  - CLOSED
```

Breaking. Existing data, clients, tests, and workflows may still use `SUBMITTED`.

### 10.2 Renaming Enum Value

Old:

```yaml
UNDER_REVIEW
```

New:

```yaml
IN_REVIEW
```

Breaking.

Safer migration:

```yaml
CaseStatus:
  type: string
  enum:
    - DRAFT
    - SUBMITTED
    - UNDER_REVIEW
    - IN_REVIEW
    - CLOSED
  description: |
    `UNDER_REVIEW` is deprecated. New responses use `IN_REVIEW`.
    Consumers must continue to tolerate `UNDER_REVIEW` until the sunset date.
```

But beware: OpenAPI has no standard per-enum-value deprecation in older patterns. Some teams use vendor extensions:

```yaml
x-enum-varnames:
  - DRAFT
  - SUBMITTED
  - UNDER_REVIEW
  - IN_REVIEW
  - CLOSED
x-enum-deprecated:
  UNDER_REVIEW: true
```

Tool support varies.

### 10.3 Adding Enum Value

This is the classic trap.

Old:

```yaml
enum:
  - OPEN
  - CLOSED
```

New:

```yaml
enum:
  - OPEN
  - CLOSED
  - REOPENED
```

For request bodies, adding an accepted enum value is often non-breaking for old consumers because they do not send it.

For responses, adding an enum value can break old consumers.

Generated Java example:

```java
switch (caseStatus) {
    case OPEN -> renderOpen();
    case CLOSED -> renderClosed();
}
```

Depending on language, enum deserialization, and switch exhaustiveness, new values can fail.

### 10.4 Open Enum Pattern

For volatile business values, consider not using closed enum.

Instead:

```yaml
status:
  type: string
  description: |
    Current case status. Consumers must tolerate unknown values.
    Known values include `OPEN`, `CLOSED`, and `REOPENED`.
  examples:
    - OPEN
```

Or use `enum` only for stable protocol-level values and keep business-configurable values as strings with a lookup endpoint.

### 10.5 Stable Enum vs Business Taxonomy

Good enum candidates:

- `ASC`, `DESC`,
- `application/problem+json` error type categories,
- protocol states that rarely change,
- small lifecycle states with strong migration governance.

Poor enum candidates:

- violation categories managed by policy,
- document types configured by administrators,
- product plans,
- jurisdictions,
- regulatory action types that change by law,
- UI labels.

For regulatory systems, many “enum-looking” values are actually controlled vocabularies. Model them carefully.

---

## 11. Security Breaking Changes

Security changes often break consumers even when endpoint schemas remain unchanged.

### 11.1 Adding Authentication

Old:

```yaml
get:
  operationId: getPublicCaseSummary
  security: []
```

New:

```yaml
security:
  - bearerAuth: []
```

Breaking. Existing unauthenticated consumers fail.

### 11.2 Changing Auth Scheme

Old:

```yaml
securitySchemes:
  apiKeyAuth:
    type: apiKey
    in: header
    name: X-API-Key
```

New:

```yaml
bearerAuth:
  type: http
  scheme: bearer
```

Breaking.

### 11.3 Adding Required OAuth Scope

Old:

```yaml
security:
  - oauth2:
      - cases:read
```

New:

```yaml
security:
  - oauth2:
      - cases:read
      - cases:sensitive-read
```

Breaking for tokens without new scope.

### 11.4 Tightening Authorization Semantics

OpenAPI may show the same security requirement, but implementation changes from:

```text
User can read all cases in organization.
```

to:

```text
User can read only assigned cases.
```

This is semantic breaking for consumers that depended on broader access.

Security tightening may be necessary for compliance, but it is still a breaking operational change and needs migration planning.

### 11.5 Error Code Changes Due to Security

Changing unauthorized access from `404` to `403`, or `403` to `404`, affects consumers.

Security teams may prefer hiding resource existence with `404`. Product teams may need `403` to show “request access”. Both are valid design choices, but changing between them is compatibility-relevant.

---

## 12. OperationId Breaking Changes

`operationId` is not decorative.

It is commonly used for:

- generated SDK method names,
- test names,
- documentation anchors,
- code samples,
- mocks,
- metrics mapping,
- API gateway imports,
- contract review references,
- client wrapper methods.

Old:

```yaml
operationId: getCase
```

New:

```yaml
operationId: retrieveCase
```

Even if path and behavior are unchanged, generated client method may change:

```java
api.getCase(caseId)
```

becomes:

```java
api.retrieveCase(caseId)
```

That is breaking for generated SDK consumers.

Guideline:

> Treat `operationId` as a stable public identifier.

If you must rename it, treat it like a method rename in a public library.

---

## 13. Schema Name and Component Breaking Changes

Component names often affect generated code.

Old:

```yaml
components:
  schemas:
    CaseSummary:
      type: object
```

New:

```yaml
components:
  schemas:
    EnforcementCaseSummary:
      type: object
```

Even if the schema content is identical, generated Java class names may change:

```java
CaseSummary
```

to:

```java
EnforcementCaseSummary
```

This can break consumers that use generated models.

Mitigation:

- avoid renaming schemas casually,
- maintain compatibility aliases where tooling supports it,
- use explicit generator mappings,
- separate public SDK model names from internal schema refactoring,
- treat schema names as part of published artifact compatibility.

---

## 14. Error Model Compatibility

Errors are part of the contract.

### 14.1 Changing Error Shape

Old:

```json
{
  "code": "VALIDATION_FAILED",
  "message": "Validation failed",
  "fieldErrors": [
    {
      "field": "subjectId",
      "message": "Required"
    }
  ]
}
```

New:

```json
{
  "type": "https://api.example.com/problems/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "violations": [
    {
      "path": "$.subjectId",
      "reason": "Required"
    }
  ]
}
```

This may be a better error model, but it is breaking.

Migration pattern:

1. Support both shapes with media type negotiation, or
2. introduce a new API version, or
3. add new fields while preserving old fields, then deprecate old fields.

### 14.2 Changing Error Code Values

Old:

```json
{
  "code": "CASE_ALREADY_CLOSED"
}
```

New:

```json
{
  "code": "INVALID_CASE_STATE"
}
```

Breaking if clients branch on `code`.

### 14.3 Changing Error Message Text

Text messages are often assumed to be human-only. But consumers sometimes parse them when no stable error code exists.

This is a design smell, but if your API gave no better machine-readable signal, consumers may have relied on text.

Rule:

> Never make consumers parse prose to understand errors.

Provide stable codes or problem types.

### 14.4 Problem Details Evolution

If using `application/problem+json`, keep extension fields stable.

Example:

```yaml
Problem:
  type: object
  required:
    - type
    - title
    - status
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
```

Adding `traceId` is usually safe. Removing `type` or changing problem type URIs is breaking.

---

## 15. Pagination Compatibility

Pagination changes are often schema-invisible but behavior-breaking.

### 15.1 Changing Default Page Size

Old default:

```text
limit=50
```

New default:

```text
limit=20
```

Consumers that omit `limit` now receive fewer records. Export jobs, UI lists, batch syncs, and reconciliation flows can break.

### 15.2 Changing Maximum Page Size

Old:

```yaml
maximum: 1000
```

New:

```yaml
maximum: 100
```

Breaking for clients using `limit=500`.

### 15.3 Changing Cursor Format

Old cursor:

```text
cursor=createdAt:2026-06-01T10:00:00Z,id:abc
```

New cursor:

```text
cursor=eyJ2IjoxLCJrIjoiLi4uIn0=
```

If cursor is documented as opaque, changing internal format is fine. If consumers were told to parse cursor, breaking.

Best practice:

```yaml
nextCursor:
  type: string
  description: |
    Opaque cursor returned by the server. Consumers must not parse or construct this value.
```

### 15.4 Changing Sort Stability

Old behavior:

```text
Sort by createdAt descending, tie-break by caseId ascending.
```

New behavior:

```text
Sort by updatedAt descending.
```

Breaking for consumers that paginate through changing data.

### 15.5 Changing Total Count Semantics

Old:

```json
{
  "total": 1234
}
```

means exact count.

New:

```json
{
  "total": 1000
}
```

means capped/estimated count.

Breaking unless field semantics change is documented through a new field:

```json
{
  "totalCount": 1000,
  "totalCountRelation": "GREATER_THAN_OR_EQUAL"
}
```

---

## 16. State Machine and Workflow Compatibility

In workflow-heavy domains, compatibility is not only about fields. It is about state transitions.

### 16.1 Adding a New State

Old:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> CLOSED
```

New:

```text
DRAFT -> SUBMITTED -> TRIAGED -> UNDER_REVIEW -> CLOSED
```

Adding `TRIAGED` may break consumers that assume `SUBMITTED` goes directly to `UNDER_REVIEW`.

### 16.2 Removing a Transition

Old:

```text
UNDER_REVIEW -> ESCALATED
```

New:

```text
UNDER_REVIEW -> ESCALATED` no longer allowed for certain case types.
```

OpenAPI might not capture this unless you document operation preconditions and error responses.

### 16.3 Changing State Meaning

Old:

```text
CLOSED means no further action possible.
```

New:

```text
CLOSED means initial process closed, but appeal can reopen it.
```

Same enum value. New meaning. Semantic breaking.

### 16.4 Compatibility Pattern for Workflow APIs

Expose capabilities rather than forcing clients to hard-code state logic.

Example:

```json
{
  "caseId": "CASE-123",
  "status": "UNDER_REVIEW",
  "availableActions": [
    {
      "action": "ESCALATE",
      "method": "POST",
      "href": "/cases/CASE-123/escalations"
    },
    {
      "action": "CLOSE",
      "method": "POST",
      "href": "/cases/CASE-123/closure"
    }
  ]
}
```

Then clients rely less on hard-coded state transition tables.

OpenAPI can describe the response shape, but runtime state determines available actions.

---

## 17. Behavioral Changes Not Visible in OpenAPI

OpenAPI cannot fully capture every behavior.

Examples:

| Behavior | Breaking Change Example |
|---|---|
| Sorting | Default order changes |
| Filtering | Filter becomes case-sensitive |
| Matching | Search changes from exact to fuzzy |
| Authorization | Access narrows by assignment |
| Rate limit | Quota reduced |
| Retry | 429 introduced without Retry-After |
| Timeout | Long operation times out sooner |
| Async | Completion becomes eventual |
| Consistency | Read-after-write guarantee removed |
| Idempotency | Repeated request now causes side effects |
| Deduplication | Idempotency key window shortened |
| Data masking | Response redacts fields previously visible |
| Localization | Error messages change language |
| Timezone | Date interpreted in different timezone |

These need human review, descriptions, tests, and operational rollout.

---

## 18. The Compatibility Matrix

When reviewing a change, inspect each dimension.

| Dimension | Questions |
|---|---|
| Path | Was any URL removed, renamed, or made ambiguous? |
| Method | Was any operation removed or semantic changed? |
| Operation ID | Did generated method names change? |
| Parameters | Added required? Removed? Type changed? Serialization changed? Defaults changed? |
| Request body | Required fields added? Types changed? Null behavior changed? Validation tightened? |
| Response body | Fields removed? Requiredness loosened? Type/range/format changed? Enum values added? |
| Status codes | Removed? Changed meaning? Async status introduced? |
| Headers | Required request header added? Response header removed? |
| Errors | Shape/code/type changed? Validation error path changed? |
| Security | Auth scheme/scope/authorization semantics changed? |
| Pagination | Limit/default/cursor/sort semantics changed? |
| SDK | Class/method/package names changed? Nullable mapping changed? |
| Examples | Examples invalidated? Consumers/tests depend on examples? |
| Docs | Promise removed or changed? |
| Runtime | Rate limits, timeouts, consistency, or idempotency changed? |
| Domain | State machine, lifecycle, or field meaning changed? |

---

## 19. OpenAPI Diffing

OpenAPI diff tools compare two OpenAPI documents and report changes.

They are useful for CI gates, PR reviews, release notes, and migration planning.

Common capabilities:

- detect removed paths,
- detect removed operations,
- detect parameter changes,
- detect request/response schema changes,
- detect enum changes,
- classify changes as breaking/non-breaking,
- generate reports,
- fail CI when breaking change appears.

But tools have limits.

### 19.1 What Diff Tools Are Good At

They are good at structural comparison:

```text
GET /cases/{caseId} removed
query parameter `limit` maximum changed 1000 -> 100
response property `status` removed
schema `CaseSummary` renamed
operationId changed
required field added
```

### 19.2 What Diff Tools Miss

They may miss or cannot infer:

```text
default sorting changed
field meaning changed
state transition semantics changed
authorization narrowed in implementation
consumer tolerance assumptions invalid
rate limits reduced
idempotency key retention changed
cursor became unstable
new enum value breaks generated client
```

### 19.3 CI Pattern

A strong CI workflow:

```text
1. Validate OpenAPI syntax.
2. Bundle multi-file spec.
3. Lint style rules.
4. Compare against last released contract.
5. Classify detected changes.
6. Fail automatically for forbidden breaking changes.
7. Require explicit approval for risky changes.
8. Generate changelog/migration notes.
9. Publish approved contract artifact.
```

### 19.4 Example GitHub Actions Concept

```yaml
name: openapi-compatibility

on:
  pull_request:
    paths:
      - 'openapi/**'

jobs:
  diff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Bundle current spec
        run: |
          npx @redocly/cli bundle openapi/root.yaml -o build/openapi.yaml

      - name: Download last released spec
        run: |
          curl -fsSL "$LAST_RELEASED_SPEC_URL" -o build/openapi-previous.yaml

      - name: Run breaking change diff
        run: |
          oasdiff breaking build/openapi-previous.yaml build/openapi.yaml
```

This is conceptual. Exact commands depend on your chosen tools.

---

## 20. Compatibility Policy

A compatibility policy makes review predictable.

### 20.1 Policy Template

```md
# API Compatibility Policy

## Scope

This policy applies to all published APIs under `/api/**` and all OpenAPI
artifacts published to the API catalog.

## Consumer Assumptions

Consumers may rely on:

- documented paths, methods, parameters, request bodies, responses, headers, and error codes;
- documented field names, types, requiredness, formats, and enum values;
- documented pagination, sorting, idempotency, and lifecycle semantics;
- published SDK method names and model names for stable releases.

Consumers must:

- ignore unknown response fields;
- treat cursors as opaque;
- avoid parsing human-readable error messages;
- tolerate undocumented response headers;
- use documented error codes/problem types for branching.

## Non-Breaking Changes

The following are generally non-breaking:

- adding a new endpoint;
- adding an optional request parameter;
- adding an optional request body field;
- adding an optional response field;
- adding examples or documentation clarifications;
- loosening request validation constraints, subject to operational review.

## Breaking Changes

The following are breaking unless explicitly approved under a versioned migration:

- removing or renaming paths, operations, parameters, fields, schemas, or enum values;
- changing field types or formats;
- adding required request parameters or required request body fields;
- tightening request validation;
- removing required response fields;
- changing response status semantics;
- changing error shape or stable error codes;
- changing authentication schemes or required scopes;
- changing operationId or published SDK names;
- changing pagination cursor, sorting, idempotency, or lifecycle semantics.

## Risky Changes Requiring Review

- adding response enum values;
- changing default values;
- adding new error codes;
- changing rate limits;
- changing state machine behavior;
- changing generated SDK package/class names;
- changing examples used as test fixtures.

## Deprecation

Deprecated elements must include:

- replacement guidance;
- first deprecated version/date;
- planned sunset date if known;
- migration documentation;
- owner contact;
- telemetry plan.

## Approval

Breaking changes require:

- API owner approval;
- consumer impact analysis;
- migration plan;
- release note;
- test evidence;
- rollback or compatibility strategy.
```

### 20.2 Why Policy Must Define Consumer Responsibilities

Provider teams cannot guarantee compatibility if consumers parse arbitrary prose, fail on unknown fields, construct cursors, or assume undocumented sort behavior.

A good contract defines both sides:

```text
Provider promises X.
Consumer must not assume Y.
```

---

## 21. Deprecation

Deprecation is not deletion. It is a communication state.

### 21.1 Marking Operations Deprecated

```yaml
paths:
  /cases/{caseId}/legacy-summary:
    get:
      operationId: getLegacyCaseSummary
      deprecated: true
      summary: Get legacy case summary.
      description: |
        Deprecated. Use `GET /cases/{caseId}/summary` instead.
        This operation will remain available until at least 2027-01-31.
      responses:
        '200':
          description: Legacy summary returned.
```

### 21.2 Deprecating Fields

OpenAPI supports `deprecated` on schema properties in many practical tooling flows.

```yaml
CaseSummary:
  type: object
  properties:
    caseId:
      type: string
      deprecated: true
      description: Deprecated. Use `id` instead.
    id:
      type: string
```

But field deprecation must be backed by server behavior:

- continue returning old field,
- add new field,
- document precedence if both exist,
- monitor old field usage if possible,
- remove only after migration window.

### 21.3 Deprecation Checklist

Before marking anything deprecated:

```text
[ ] Is there a replacement?
[ ] Is replacement available now?
[ ] Is replacement documented?
[ ] Do examples show the replacement?
[ ] Are SDKs updated?
[ ] Are consumers notified?
[ ] Is usage measurable?
[ ] Is there a minimum support window?
[ ] Is there a sunset date or policy?
[ ] Is rollback possible if migration fails?
```

### 21.4 Bad Deprecation

Bad:

```yaml
deprecated: true
```

with no explanation.

Better:

```yaml
deprecated: true
description: |
  Deprecated since 2026-06-20. Use `GET /cases/{caseId}/summary`.
  This operation will be supported until at least 2027-06-20.
  Contact the API owner before that date if migration is not possible.
```

---

## 22. Sunset

Sunset is stronger than deprecation. It means the resource or endpoint is expected to become unavailable at a future time.

The HTTP `Sunset` response header is defined by RFC 8594. It communicates that a URI is likely to become unresponsive at a specified point in the future.

Example response:

```http
HTTP/1.1 200 OK
Sunset: Wed, 31 Dec 2026 23:59:59 GMT
Link: <https://api.example.com/policies/sunset/case-legacy-summary>; rel="sunset"
Content-Type: application/json
```

OpenAPI modelling:

```yaml
responses:
  '200':
    description: Legacy summary returned.
    headers:
      Sunset:
        description: Date/time after which this endpoint may become unavailable.
        schema:
          type: string
          format: date-time
      Link:
        description: Link to sunset policy and migration guide.
        schema:
          type: string
```

Important:

- Deprecation says “do not start using this”.
- Sunset says “this is going away”.
- Removal says “it is gone”.

Do not jump from deprecation to removal without consumer evidence and policy compliance.

---

## 23. Versioning Strategies

Versioning is a compatibility tool, not a substitute for good evolution.

### 23.1 URL Versioning

```text
/v1/cases
/v2/cases
```

Pros:

- easy to see,
- easy to route,
- easy for consumers,
- easy gateway policy.

Cons:

- can duplicate large API surfaces,
- encourages big-bang versioning,
- mixes resource identity with contract version,
- migrations can be expensive.

### 23.2 Header Versioning

```http
API-Version: 2026-06-20
```

Pros:

- cleaner URLs,
- can version behavior without path changes,
- supports gradual evolution.

Cons:

- less visible,
- harder to test manually,
- gateway and cache complexity,
- consumers may forget header.

### 23.3 Media Type Versioning

```http
Accept: application/vnd.example.case.v2+json
```

Pros:

- aligns version with representation,
- useful when same resource has multiple representations.

Cons:

- more complex,
- harder for casual consumers,
- tooling support can vary.

### 23.4 Date-Based Versioning

```http
API-Version: 2026-06-20
```

Common in APIs where behavior evolves continuously.

Pros:

- explicit contract snapshot,
- supports incremental changes,
- avoids arbitrary major version numbers.

Cons:

- requires strong infrastructure,
- documentation must be version-aware,
- testing matrix can grow.

### 23.5 Capability-Based Evolution

Instead of versioning everything, expose new capability:

```text
POST /case-submission-requests
GET /case-submission-requests/{requestId}
```

rather than changing existing `POST /cases/{id}/submit` semantics.

Pros:

- avoids breaking old flows,
- models business evolution,
- keeps old capability stable.

Cons:

- API surface grows,
- requires lifecycle governance.

### 23.6 Which Strategy Should You Use?

| Context | Preferred Strategy |
|---|---|
| Public API | URL or date/header versioning with strong docs |
| Partner API | Explicit versioning + migration windows |
| Internal microservice API | Compatibility-first, version only when needed |
| Mobile API | Long support windows; avoid forced upgrades |
| Regulated API | Versioned contract artifacts with audit trail |
| Generated SDK API | Semantic SDK versioning tied to contract version |
| Experimental API | Preview/beta label, weaker guarantees clearly stated |

---

## 24. Semantic Versioning for API Contracts

Semantic versioning style:

```text
MAJOR.MINOR.PATCH
```

Possible mapping:

- `MAJOR`: breaking contract change,
- `MINOR`: backward-compatible new capability,
- `PATCH`: documentation clarification or non-contract bug fix.

But API contracts are not libraries. Runtime behavior, data, and consumers make versioning harder.

Example:

```text
1.4.2 -> 1.5.0: add optional field and endpoint
1.5.0 -> 2.0.0: remove deprecated endpoint
```

For OpenAPI artifacts, use explicit artifact versioning:

```yaml
info:
  title: Case Management API
  version: 1.5.0
```

But do not confuse:

```text
OpenAPI spec version: 3.2.0
API contract version: 1.5.0
Application release version: 2026.06.20
SDK version: 1.5.3
```

These are different.

---

## 25. Compatibility in Java Generated Clients

Java generated clients introduce extra compatibility surfaces.

### 25.1 Method Names

Driven by `operationId`.

Changing `operationId` can break source compatibility.

### 25.2 Model Class Names

Driven by schema/component names and generator config.

Changing schema names can break imports.

### 25.3 Enum Handling

Generated Java enums may fail when unknown values appear.

Mitigation options:

- configure generator to support unknown enum values if available,
- model volatile values as strings,
- add `UNKNOWN` fallback pattern,
- wrap generated models at application boundary,
- avoid exhaustive business logic directly on generated enums.

### 25.4 Nullable Mapping

OpenAPI nullability maps differently across generators:

- `String`,
- `Optional<String>`,
- nullable annotations,
- `JsonNullable<T>`,
- boxed primitives,
- Kotlin nullable types.

Changing nullability can change generated model APIs.

### 25.5 Date/Time Mapping

Changing `format` from `date` to `date-time` can change generated Java type:

```java
LocalDate
```

to:

```java
OffsetDateTime
```

Breaking.

### 25.6 Package and Template Changes

Even if OpenAPI does not change, generator version or config changes can break generated SDK surface.

Therefore:

```text
OpenAPI diff is not enough.
Also diff generated SDK public API.
```

---

## 26. Contract Change Review Workflow

A mature review process should not rely on “LGTM” alone.

### 26.1 Pull Request Checklist

```md
# API Contract Change Checklist

## Change Type

- [ ] Additive only
- [ ] Potentially breaking
- [ ] Intentionally breaking
- [ ] Documentation/example only
- [ ] Security-related
- [ ] Behavior-only implementation change

## OpenAPI Diff

- [ ] Diff generated against last released contract
- [ ] No unexpected breaking changes
- [ ] Risky changes reviewed manually

## Consumer Impact

- [ ] Known consumers identified
- [ ] SDK impact checked
- [ ] Frontend/mobile impact checked
- [ ] Partner impact checked
- [ ] Batch/integration jobs checked

## Compatibility

- [ ] Old clients continue to work
- [ ] Unknown field tolerance considered
- [ ] Enum evolution considered
- [ ] Error model impact considered
- [ ] Pagination/sorting impact considered
- [ ] Security scope impact considered

## Migration

- [ ] Deprecation marked if applicable
- [ ] Replacement exists
- [ ] Migration guide updated
- [ ] Sunset date/policy defined if applicable
- [ ] Telemetry plan exists

## Testing

- [ ] Provider contract tests updated
- [ ] Consumer tests or mocks updated
- [ ] Negative cases updated
- [ ] Generated SDK compile/test checked
```

### 26.2 Reviewer Questions

Ask:

```text
What can an old client still send?
What can an old client still receive?
What assumptions might consumers have encoded?
Will generated clients change?
Will validation become stricter?
Will error handling still work?
Does this affect workflow state transitions?
Is this compatible with documented examples?
Is the migration path real or imaginary?
```

---

## 27. Designing for Future Compatibility

Compatibility is easiest when designed from the start.

### 27.1 Prefer Additive Evolution

Design APIs so future features can be added without changing existing meaning.

Example:

```yaml
CaseSummary:
  type: object
  required:
    - id
    - status
  properties:
    id:
      type: string
    status:
      type: string
    attributes:
      type: object
      additionalProperties: true
      description: Optional extensible metadata. Consumers must ignore unknown keys.
```

Use extension maps carefully. They are useful for metadata, not core contract escape hatches.

### 27.2 Avoid Overly Tight Enums for Volatile Values

Use enums for stable protocols, not fast-changing business taxonomies.

### 27.3 Keep Response Objects Extensible

Consumer guidance:

```text
Ignore unknown fields.
Do not fail deserialization on additional properties.
```

Provider guidance:

```text
Do not remove or rename fields casually.
Do not change field meaning.
```

### 27.4 Use Capability Links or Available Actions

Avoid hard-coded client state machines where possible.

### 27.5 Make Cursors Opaque

Never let consumers construct or parse pagination cursors.

### 27.6 Separate Command Requests from Resource Representations

Bad:

```text
Use CaseDto for create, update, patch, and response.
```

Better:

```text
CreateCaseRequest
UpdateCaseRequest
PatchCaseRequest
CaseDetailResponse
CaseSummaryResponse
```

This allows each shape to evolve independently.

### 27.7 Avoid Generic Wrapper Overcoupling

Bad:

```yaml
ApiResponseCaseSummary:
  properties:
    success:
      type: boolean
    data:
      $ref: '#/components/schemas/CaseSummary'
    error:
      $ref: '#/components/schemas/Error'
```

If every endpoint uses the same wrapper, wrapper changes affect everything.

### 27.8 Document Defaults Explicitly

Undocumented defaults become hidden contracts.

---

## 28. Rollout Strategies

### 28.1 Expand and Contract

For field migration:

1. Add new field.
2. Return both old and new fields.
3. Accept both old and new request fields if possible.
4. Prefer new field in docs/examples.
5. Mark old field deprecated.
6. Monitor old field usage.
7. Remove old field only after migration policy.

Example:

```yaml
properties:
  caseId:
    type: string
    deprecated: true
    description: Deprecated. Use `id`.
  id:
    type: string
```

### 28.2 Dual Read / Dual Write

For request migration:

```text
accept old field
accept new field
if both present, define precedence
emit warning when old field is used
migrate consumers
remove old field later
```

### 28.3 Feature Flags

Use flags to roll out behavior changes gradually, but do not let flags create undocumented contract variants unless explicitly versioned or scoped.

### 28.4 Consumer Opt-In

Let consumers opt into new behavior:

```http
Prefer: handling=strict
API-Version: 2026-06-20
```

or via new endpoint.

### 28.5 Shadow Validation

Before tightening validation, run new validation in shadow mode:

```text
log would-fail requests
measure affected consumers
notify owners
fix clients
then enforce
```

---

## 29. Case Study: Adding Jurisdiction to Case Creation

### 29.1 Initial Contract

```yaml
CreateCaseRequest:
  type: object
  required:
    - subjectId
    - allegationType
  properties:
    subjectId:
      type: string
    allegationType:
      type: string
```

Business now needs jurisdiction for routing.

### 29.2 Bad Change

```yaml
required:
  - subjectId
  - allegationType
  - jurisdiction
```

This breaks every old client.

### 29.3 Better Change

```yaml
CreateCaseRequest:
  type: object
  required:
    - subjectId
    - allegationType
  properties:
    subjectId:
      type: string
    allegationType:
      type: string
    jurisdiction:
      type: string
      description: |
        Optional during migration. If omitted, jurisdiction is derived from
        the authenticated user's organization and subject location where possible.
        Future API versions may require this field.
```

Server behavior:

```text
if jurisdiction present:
  use it
else:
  derive it
  emit warning/telemetry
```

Migration:

```text
publish docs
update SDK
notify consumers
track missing jurisdiction
set migration date
make required only in v2 or after formal sunset
```

### 29.4 Even Better: Separate Routing Command

If jurisdiction routing becomes complex, avoid overloading create:

```text
POST /cases
POST /case-routing-decisions
```

or:

```text
POST /case-intake-submissions
```

The correct model depends on domain semantics.

---

## 30. Case Study: Changing Case Status Enum

### 30.1 Initial Contract

```yaml
CaseStatus:
  type: string
  enum:
    - DRAFT
    - SUBMITTED
    - UNDER_REVIEW
    - CLOSED
```

New business process adds `TRIAGED`.

### 30.2 Is Adding `TRIAGED` Breaking?

For request fields:

```text
Probably non-breaking if old clients do not send it.
```

For response fields:

```text
Potentially breaking because old clients may not handle it.
```

For workflow:

```text
Potentially breaking because old clients may assume SUBMITTED -> UNDER_REVIEW.
```

### 30.3 Safer Design

```yaml
status:
  type: string
  description: |
    Current lifecycle status. Consumers must tolerate unknown status values.
    Use `availableActions` to determine what transitions are currently allowed.
```

And:

```yaml
availableActions:
  type: array
  items:
    $ref: '#/components/schemas/CaseAction'
```

This shifts clients away from exhaustive status branching.

### 30.4 Migration Work

- update SDK enum handling,
- add unknown fallback,
- notify consumers,
- update UI mapping,
- add contract test with unknown future status,
- publish state transition documentation.

---

## 31. Case Study: Error Model Migration to Problem Details

### 31.1 Old Error

```yaml
LegacyError:
  type: object
  required:
    - code
    - message
  properties:
    code:
      type: string
    message:
      type: string
```

### 31.2 New Error

```yaml
Problem:
  type: object
  required:
    - type
    - title
    - status
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
    code:
      type: string
      description: Stable application error code.
```

### 31.3 Migration Options

Option A: Media type negotiation.

```http
Accept: application/problem+json
```

Option B: Add fields while preserving old shape.

```json
{
  "code": "VALIDATION_FAILED",
  "message": "Validation failed",
  "type": "https://api.example.com/problems/validation-failed",
  "title": "Validation failed",
  "status": 400
}
```

Option C: New API version.

```text
/v2/cases
```

Best choice depends on consumer base, tooling, and risk.

---

## 32. Regulated System Perspective

In regulated systems, compatibility is not only a convenience. It affects defensibility.

A breaking API change can cause:

- missed case deadlines,
- failed evidence submission,
- incorrect enforcement routing,
- inconsistent audit records,
- inability to reproduce a decision path,
- partner non-compliance,
- legal dispute over notice,
- reporting inconsistencies.

For these systems, API change records should include:

```text
contract diff
risk classification
affected operations
affected data fields
affected consumers
approval record
migration guide
test evidence
release version
rollback plan
sunset notice if applicable
```

OpenAPI becomes part of evidence.

---

## 33. Practical Compatibility Rules of Thumb

### 33.1 Request Side

Usually non-breaking:

```text
Add optional request field.
Add optional query parameter.
Loosen validation.
Accept additional media type while preserving old one.
```

Usually breaking:

```text
Add required request field.
Add required parameter.
Remove accepted field.
Change field type.
Tighten validation.
Change parameter serialization.
Reject unknown fields when previously accepted.
```

### 33.2 Response Side

Usually non-breaking:

```text
Add optional response field if consumers ignore unknown fields.
Add new endpoint.
Add new response header.
```

Usually breaking:

```text
Remove response field.
Rename response field.
Change field type.
Remove required response guarantee.
Change status code semantics.
Change error shape.
Remove response header used by clients.
```

Risky:

```text
Add enum value.
Loosen response constraints.
Change default sorting.
Change pagination metadata.
```

### 33.3 Documentation and Examples

Usually non-breaking:

```text
Clarify docs without changing behavior.
Add examples.
Fix typo.
```

Potentially breaking:

```text
Remove documented behavior.
Change examples used by tests.
Change documented default.
Change operation summary used by generated docs/navigation.
```

---

## 34. Anti-Patterns

### 34.1 “It Is Internal, So Breaking Is Fine”

Internal consumers are still consumers. Internal APIs can be more flexible, but they still need compatibility policy proportional to impact.

### 34.2 “No One Should Depend on That Field”

If it is in the response and documented, they might.

### 34.3 “Adding Enum Values Is Always Safe”

False. Generated clients and exhaustive logic can break.

### 34.4 “The Diff Tool Passed, So It Is Safe”

Diff tools cannot understand all semantics.

### 34.5 “We Deprecated It, So We Can Remove It”

Deprecation is not consent. You need migration window and evidence.

### 34.6 “We Can Fix Consumers After Release”

That is coordinated downtime disguised as agility.

### 34.7 “Only 200 Matters”

Error compatibility matters as much as success compatibility.

### 34.8 “Generated SDK Consumers Will Just Regenerate”

Regeneration can create source breaks, behavior breaks, and rollout coordination problems.

### 34.9 “Schema Did Not Change, So Contract Did Not Change”

Behavior can break without schema changes.

---

## 35. OpenAPI Extensions for Compatibility Governance

Vendor extensions can encode governance metadata.

Example:

```yaml
paths:
  /cases/{caseId}/legacy-summary:
    get:
      operationId: getLegacyCaseSummary
      deprecated: true
      x-lifecycle:
        status: deprecated
        deprecatedSince: 2026-06-20
        sunsetAfter: 2027-06-20
        replacement: getCaseSummary
        owner: case-platform-team
      x-compatibility:
        breakingChangeRequiresApproval: true
        consumerNoticeRequired: true
```

Schema field metadata:

```yaml
caseId:
  type: string
  deprecated: true
  x-lifecycle:
    replacement: id
    deprecatedSince: 2026-06-20
    removalNotBefore: 2027-06-20
```

Tool support is custom, but extensions can power lint rules, catalog views, and governance dashboards.

---

## 36. Building a Breaking Change Gate

### 36.1 Inputs

```text
previous released OpenAPI artifact
current candidate OpenAPI artifact
API compatibility policy
consumer registry
exception approvals
```

### 36.2 Outputs

```text
change classification
breaking change report
risky change report
migration checklist
approval requirements
release notes draft
```

### 36.3 Gate Logic

```text
if syntax invalid:
  fail

if lint critical violation:
  fail

if breaking diff detected and no approval:
  fail

if risky change detected and no review label:
  fail

if deprecated item has no replacement guidance:
  fail

if sunset date violates minimum policy:
  fail

if generated SDK public API diff has breaking change:
  require SDK major version or approval
```

### 36.4 Human Override

There must be a controlled override. Sometimes breaking changes are necessary for security, legal, or correctness reasons.

But override should require:

```text
reason
approver
consumer impact
migration/communication plan
release date
rollback/mitigation
```

---

## 37. Exercise 1 — Classify Changes

Given old schema:

```yaml
CaseSummary:
  type: object
  required:
    - id
    - status
    - createdAt
  properties:
    id:
      type: string
    status:
      type: string
      enum: [OPEN, CLOSED]
    createdAt:
      type: string
      format: date-time
    assignedOfficerId:
      type:
        - string
        - 'null'
```

Classify each change:

1. Add optional field `priority`.
2. Remove `createdAt` from `required`.
3. Add enum value `REOPENED`.
4. Rename `assignedOfficerId` to `ownerId`.
5. Change `createdAt` format from `date-time` to `date`.
6. Add new endpoint `GET /cases/{caseId}/audit-events`.
7. Change default sort for `GET /cases`.
8. Add required query parameter `jurisdiction`.
9. Change `operationId` from `listCases` to `searchCases`.
10. Add new documented `409` error response.

Suggested classification:

| Change | Classification |
|---|---|
| Add optional field `priority` | Usually non-breaking, assuming unknown field tolerance |
| Remove `createdAt` from required | Breaking/risky for consumers relying on presence |
| Add enum value `REOPENED` | Risky, possibly breaking for generated/exhaustive clients |
| Rename `assignedOfficerId` | Breaking |
| `date-time` to `date` | Breaking |
| Add new endpoint | Non-breaking |
| Change default sort | Semantic breaking/risky |
| Add required query parameter | Breaking |
| Change `operationId` | Breaking for SDK consumers |
| Add `409` error response | Risky; can be non-breaking if only for newly documented existing scenario, but clients may need handling |

---

## 38. Exercise 2 — Design a Migration

Problem:

Old field:

```yaml
caseId:
  type: string
```

New naming standard wants:

```yaml
id:
  type: string
```

Migration:

```yaml
CaseSummary:
  type: object
  required:
    - caseId
    - id
    - status
  properties:
    caseId:
      type: string
      deprecated: true
      description: |
        Deprecated. Use `id` instead. This field will remain available until
        at least 2027-06-20.
    id:
      type: string
    status:
      type: string
```

Server:

```text
return both fields
ensure values are identical
update examples to use id
update SDK docs
monitor clients that deserialize/read caseId if possible
remove only in next major version or after policy window
```

---

## 39. Exercise 3 — Add a Required Field Without Breaking Consumers

Problem:

Business wants `jurisdiction` required on create case.

Safe staged approach:

```text
Stage 1: Add optional jurisdiction.
Stage 2: Server derives jurisdiction if absent.
Stage 3: Emit warning metadata/logs for missing jurisdiction.
Stage 4: Notify consumers.
Stage 5: Update SDK and examples.
Stage 6: Measure usage.
Stage 7: Require field only in v2 or after formal migration.
```

OpenAPI stage 1:

```yaml
jurisdiction:
  type: string
  description: |
    Jurisdiction for routing and authority determination. Optional during
    migration. If omitted, the server derives it where possible. Future API
    versions may require this field.
```

---

## 40. Part Summary

Breaking changes are not just removed endpoints. They are any change that invalidates reasonable existing consumer assumptions.

Key takeaways:

1. Compatibility is consumer-centered.
2. Schema diff is necessary but insufficient.
3. OpenAPI captures structural contract well, but semantic compatibility requires human review.
4. Request-side tightening is usually breaking.
5. Response-side removal or meaning changes are usually breaking.
6. Enum evolution is dangerous, especially for generated clients.
7. `operationId` and schema names are public identifiers when SDKs are generated.
8. Errors, pagination, security, and workflow transitions are part of the contract.
9. Deprecation is not deletion.
10. Sunset requires notice, policy, and migration support.
11. Versioning is a tool, not a substitute for compatibility discipline.
12. Mature teams combine OpenAPI diffing, linting, contract tests, consumer registry, and explicit approval workflows.

The top 1% engineer does not ask only:

```text
Is this OpenAPI document valid?
```

They ask:

```text
Which consumers can this change break, how would we know, and what migration path protects them?
```

---

## 41. References

- OpenAPI Specification v3.2.0 — official specification.
- OpenAPI Initiative — official OpenAPI organization and specification home.
- RFC 9110 — HTTP Semantics.
- RFC 8594 — The Sunset HTTP Header Field.
- RFC 9457 — Problem Details for HTTP APIs.
- JSON Schema Draft 2020-12 — schema semantics used by OpenAPI 3.1+ alignment.
- oasdiff — OpenAPI diff and breaking change detection tooling.
- OpenAPI Generator — generated client/server artifact considerations.

---

## 42. Next Part

Next:

```text
Part 016 — Examples, Samples, Mocks, and Documentation as Executable Understanding
```

That part will cover how examples become more than documentation: they become onboarding material, mock data, test fixtures, validation inputs, scenario documentation, and executable understanding for API consumers.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-014.md">⬅️ OpenAPI Mastery for Java Engineers — Part 014</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-016.md">OpenAPI Mastery for Java Engineers — Part 016 ➡️</a>
</div>
