# OpenAPI Mastery for Java Engineers — Part 004
# Paths and Operations: Modelling API Capabilities Correctly

> **Filename:** `learn-openapi-mastery-for-java-engineers-part-004.md`  
> **Series:** `learn-openapi-mastery-for-java-engineers`  
> **Part:** `004 / 030`  
> **Status:** In progress  
> **Previous:** Part 003 — Anatomy of an OpenAPI Document  
> **Next:** Part 005 — Parameters: Path, Query, Header, Cookie, Style, Explode, and Encoding

---

## 0. Why This Part Matters

OpenAPI becomes useful only when its `paths` and operations describe **what the API exposes as stable capabilities**.

A weak OpenAPI document often looks structurally valid but fails semantically:

```yaml
paths:
  /case/doSomething:
    post:
      summary: Do something
      responses:
        '200':
          description: OK
```

This may satisfy a validator, but it does not help a consumer understand:

- what business capability is exposed,
- what state transition happens,
- whether the operation is safe or idempotent,
- what failures can occur,
- whether the operation can be called repeatedly,
- what client method name should be generated,
- which team owns it,
- how it evolves over time.

Top-tier OpenAPI usage starts by treating each operation as a **public promise**.

An operation is not merely a controller method. It is not merely a route. It is not merely an annotation output. It is a named, reviewable, testable, evolvable capability exposed across a boundary.

---

## 1. Core Mental Model

In OpenAPI, the `paths` section describes the addressable surface area of an HTTP API.

A simplified hierarchy looks like this:

```text
OpenAPI Description
└── paths
    ├── /cases
    │   ├── get     -> Operation: list cases
    │   └── post    -> Operation: create case
    ├── /cases/{caseId}
    │   ├── get     -> Operation: get case detail
    │   ├── patch   -> Operation: update case
    │   └── delete  -> Operation: delete/archive case
    └── /cases/{caseId}/submit
        └── post    -> Operation: submit case for review
```

The important distinction:

```text
Path      = addressable resource or capability location
Method    = HTTP interaction type
Operation = concrete API capability at method + path
```

So this:

```text
GET /cases/{caseId}
```

is one operation.

And this:

```text
PATCH /cases/{caseId}
```

is another operation, even though it uses the same path.

A strong OpenAPI document makes each operation answer:

```text
What can a consumer do here?
What input is accepted?
What output is promised?
What errors are possible?
What security applies?
What lifecycle state does this touch?
What must stay compatible over time?
```

---

## 2. Specification Grounding

In OpenAPI 3.2.0, the `Paths Object` holds relative paths to API endpoints and their operations. Each path is appended to a server URL to construct the full endpoint URL. The official spec also allows the `Paths Object` to be empty in some access-control constrained descriptions.

Conceptually:

```yaml
servers:
  - url: https://api.example.com/v1

paths:
  /cases:
    get:
      summary: List cases
```

The full endpoint represented here is:

```text
GET https://api.example.com/v1/cases
```

The OpenAPI Initiative describes OpenAPI as a formal standard for HTTP APIs that allows humans and tools to understand APIs, generate client code, create tests, and apply design standards. This is why path and operation modelling must be precise, not merely syntactically valid.

---

## 3. Path Is Not Just URL Text

A path in OpenAPI is an architectural signal.

Compare:

```text
POST /process
POST /caseAction
POST /cases/{caseId}/submit
POST /cases/{caseId}/assignments
POST /cases/{caseId}/evidence
```

The first two are vague. They hide the domain capability behind generic action words.

The last three reveal:

- what entity is involved,
- what relationship or sub-resource is being changed,
- which operation belongs to which lifecycle,
- how a consumer should reason about the API.

A good path communicates structure without requiring source code knowledge.

---

## 4. Path Design Principles

### 4.1 Prefer Stable Domain Concepts

Good paths are built from stable business concepts, not internal implementation names.

Weak:

```text
/getCaseDto
/createCaseEntity
/caseController/findById
/caseWorkflowService/submit
```

Better:

```text
GET /cases/{caseId}
POST /cases
POST /cases/{caseId}/submission
```

The API consumer should not see:

- Java class names,
- JPA entity names,
- service names,
- repository names,
- internal module names,
- temporary implementation structure.

If your Java package changes, your public API should not necessarily change.

---

### 4.2 Model Resources and Capabilities Explicitly

A path often represents a resource:

```text
/cases
/cases/{caseId}
/cases/{caseId}/evidence
```

But not every important API capability is a pure CRUD resource.

Real systems expose operations like:

```text
POST /cases/{caseId}/submission
POST /cases/{caseId}/assignment
POST /cases/{caseId}/escalation
POST /cases/{caseId}/closure
POST /cases/{caseId}/appeal
```

These are not fake REST. They are valid resource-oriented ways to model domain events or lifecycle commands.

The key is to make the capability explicit.

Bad:

```text
POST /cases/{caseId}/actions
```

Better:

```text
POST /cases/{caseId}/submission
POST /cases/{caseId}/escalation
POST /cases/{caseId}/closure
```

Why?

Because each operation has different:

- authorization,
- validation,
- idempotency behavior,
- state transition rules,
- response shape,
- audit requirements,
- failure modes.

If you collapse them into a generic action endpoint, the contract becomes opaque.

---

### 4.3 Avoid Controller Thinking

Java/Spring developers often think in controllers:

```java
@RestController
@RequestMapping("/case")
class CaseController {
    @PostMapping("/submit")
    void submit(...) {}
}
```

This can lead to paths shaped by code layout rather than API capability.

A better mental model:

```text
Consumer capability first:
  "Submit an existing case for supervisory review"

Then path:
  POST /cases/{caseId}/submission

Then operationId:
  submitCase

Then implementation:
  CaseSubmissionController.submitCase(...)
```

The direction should be:

```text
API capability -> contract -> implementation
```

not:

```text
controller method -> generated OpenAPI -> accidental contract
```

---

## 5. Path Templates

OpenAPI supports templated paths:

```yaml
paths:
  /cases/{caseId}:
    get:
      operationId: getCase
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
```

The `{caseId}` segment is a path template expression.

Important invariant:

```text
Every path template variable must have a corresponding path parameter definition.
```

This means the following is invalid or incomplete:

```yaml
paths:
  /cases/{caseId}:
    get:
      operationId: getCase
      responses:
        '200':
          description: OK
```

Because `caseId` is used in the path but not described as a parameter.

Correct:

```yaml
paths:
  /cases/{caseId}:
    get:
      operationId: getCase
      parameters:
        - name: caseId
          in: path
          required: true
          description: Stable identifier of the case.
          schema:
            type: string
            pattern: '^CASE-[0-9]{8}$'
      responses:
        '200':
          description: Case found.
```

---

## 6. Path Parameter Naming

Path parameter names matter because they become part of:

- generated method signatures,
- SDK argument names,
- documentation,
- test fixtures,
- gateway validation,
- monitoring dimensions,
- consumer mental models.

Weak:

```text
/cases/{id}
/evidence/{id}
/users/{id}
```

Better:

```text
/cases/{caseId}
/evidence-items/{evidenceItemId}
/users/{userId}
```

Why?

Because `id` becomes ambiguous in nested paths:

```text
/cases/{id}/evidence/{id}
```

This is bad. Which `id` is which?

Better:

```text
/cases/{caseId}/evidence-items/{evidenceItemId}
```

This produces clearer generated code:

```java
getEvidenceItem(String caseId, String evidenceItemId)
```

instead of:

```java
getEvidenceItem(String id, String id2)
```

---

## 7. Path Specificity and Ambiguity

Path ambiguity is a classic API design failure.

Consider:

```yaml
paths:
  /cases/{caseId}:
    get: ...
  /cases/search:
    get: ...
```

A human sees `/cases/search` as a search endpoint.

But depending on router behavior, `/cases/search` may also match `/cases/{caseId}` with `caseId = "search"`.

OpenAPI has path matching rules, but implementation routers and gateways may behave differently if configured carelessly.

Better designs avoid ambiguous overlap where possible.

Options:

```text
GET /cases?query=...
POST /case-searches
GET /search/cases
```

Or reserve identifier formats:

```yaml
/cases/{caseId}:
  parameters:
    - name: caseId
      in: path
      required: true
      schema:
        type: string
        pattern: '^CASE-[0-9]{8}$'
```

Then `search` cannot be a valid `caseId`.

---

## 8. Path Hierarchy

Path hierarchy should reflect meaningful containment or relationship.

Good examples:

```text
/cases/{caseId}/evidence-items
/cases/{caseId}/evidence-items/{evidenceItemId}
/cases/{caseId}/assignments
/cases/{caseId}/decisions
```

These suggest evidence, assignments, and decisions are accessed in the context of a case.

But over-nesting can create brittle APIs.

Possibly too nested:

```text
/agencies/{agencyId}/departments/{departmentId}/teams/{teamId}/users/{userId}/cases/{caseId}/evidence/{evidenceId}
```

This exposes organizational hierarchy in the URL. If a team moves departments, do existing URLs break?

A better approach may be:

```text
/cases/{caseId}/evidence-items/{evidenceItemId}
```

with authorization and ownership resolved internally.

Rule of thumb:

```text
Nest when the child resource is not meaningfully addressable outside the parent context.
Avoid nesting when the hierarchy is administrative, volatile, or authorization-only.
```

---

## 9. Operations

An OpenAPI operation describes one HTTP method applied to one path.

Example:

```yaml
paths:
  /cases/{caseId}/submission:
    post:
      operationId: submitCase
      summary: Submit a case for supervisory review
      description: |
        Transitions a draft case into the submitted state.
        The case must contain at least one allegation and one evidence item.
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
      responses:
        '202':
          description: Case submission accepted.
        '409':
          description: Case cannot be submitted in its current state.
```

The operation is the unit of:

- generated client method,
- documentation section,
- test case,
- security override,
- deprecation,
- monitoring label,
- governance review,
- compatibility analysis.

---

## 10. Operation Object Fields

A production operation commonly uses these fields:

```yaml
operationId: submitCase
summary: Submit a case for review
description: |
  Transitions a draft case into submitted state.
  This operation is idempotent for the same case when the case is already submitted.
tags:
  - Cases
parameters: []
requestBody: {}
responses: {}
security: []
deprecated: false
```

Important fields:

| Field | Purpose |
|---|---|
| `operationId` | Stable unique identifier for tools and generated clients |
| `summary` | Short human-readable label |
| `description` | Detailed semantic explanation |
| `tags` | Grouping/navigation/documentation organization |
| `parameters` | Path/query/header/cookie inputs |
| `requestBody` | Body input |
| `responses` | Possible outputs and errors |
| `security` | Operation-specific auth requirements |
| `deprecated` | Deprecation signal |
| `servers` | Operation-specific server override |
| `callbacks` | Async callback descriptions |

---

## 11. `operationId`: Small Field, Huge Consequences

`operationId` is one of the most underestimated OpenAPI fields.

It often becomes:

- Java generated client method name,
- TypeScript function name,
- SDK documentation anchor,
- test name,
- traceability key,
- changelog identity,
- code generation hook,
- API catalog operation key.

Bad operation IDs:

```yaml
operationId: get
operationId: getUsingGET
operationId: caseControllerGetCase
operationId: postApiV1CasesByIdSubmit
operationId: doAction
```

Better:

```yaml
operationId: listCases
operationId: createCase
operationId: getCase
operationId: updateCase
operationId: submitCase
operationId: assignCase
operationId: closeCase
```

A good `operationId` should be:

```text
unique
stable
human-readable
action-oriented
implementation-independent
SDK-friendly
semantically precise
```

---

## 12. `operationId` Naming Conventions

A strong convention:

```text
<verb><DomainObject>
<verb><DomainObject><Qualifier>
```

Examples:

```text
listCases
createCase
getCase
updateCase
submitCase
assignCase
reopenCase
listCaseEvidenceItems
addCaseEvidenceItem
getCaseDecision
publishCaseDecision
```

Avoid including:

- HTTP method: `getCaseUsingGet`,
- version: `v1GetCase`,
- controller name: `caseControllerGetCase`,
- internal action codes: `executeC001`,
- generic verbs: `process`, `handle`, `do`, `manage`.

Why avoid version in `operationId`?

Because versioning should usually be represented at API/package/artifact level, not sprayed into every generated method name unless truly needed.

---

## 13. Summary vs Description

`summary` should be short.

```yaml
summary: Submit a case for review
```

`description` should explain semantics.

```yaml
description: |
  Submits a draft case for supervisory review.

  Preconditions:
  - The case must be in `draft` state.
  - The case must contain at least one allegation.
  - The case must contain at least one evidence item.

  Effects:
  - The case state changes to `submitted`.
  - The submitting user and timestamp are recorded.
  - The case becomes read-only for the submitting officer until review is completed.

  Idempotency:
  - Repeating the request after successful submission returns the current submitted case.
```

A good description captures information that schema alone cannot:

- preconditions,
- side effects,
- state transition,
- idempotency,
- authorization nuance,
- audit implications,
- retry behavior,
- concurrency behavior.

---

## 14. Tags

Tags group operations for documentation and discovery.

Example:

```yaml
paths:
  /cases:
    get:
      tags:
        - Cases
      operationId: listCases
```

Do not treat tags as random labels.

Weak tags:

```text
Controller
API
Public
V1
Misc
```

Better tags:

```text
Cases
Evidence
Assignments
Decisions
Appeals
Audit
```

For large APIs, tags become a navigation and governance structure.

Good tag design answers:

```text
Which capability area owns this operation?
Where should a consumer look for related operations?
Which part of the API portfolio does this belong to?
```

---

## 15. Operation Granularity

Operation granularity is a design choice.

Too coarse:

```text
POST /cases/{caseId}/actions
```

Request:

```json
{
  "action": "SUBMIT",
  "reason": "Ready for review"
}
```

This hides different domain operations behind one generic endpoint.

Too fine:

```text
POST /cases/{caseId}/set-title
POST /cases/{caseId}/set-priority
POST /cases/{caseId}/set-owner
POST /cases/{caseId}/set-description
```

This can become noisy and tightly coupled to field-level UI behavior.

Balanced:

```text
PATCH /cases/{caseId}
POST /cases/{caseId}/submission
POST /cases/{caseId}/assignment
POST /cases/{caseId}/closure
```

Use field update operations when fields are ordinary editable attributes.

Use explicit command/lifecycle operations when the operation has:

- distinct authorization,
- business preconditions,
- state transition,
- audit event,
- different response semantics,
- important failure modes,
- separate ownership or review requirements.

---

## 16. CRUD-ish Operations

Basic resource operations are still useful.

Example:

```text
GET    /cases              -> listCases
POST   /cases              -> createCase
GET    /cases/{caseId}     -> getCase
PATCH  /cases/{caseId}     -> updateCase
DELETE /cases/{caseId}     -> deleteCase or archiveCase
```

But real APIs usually need more than CRUD.

For example, a regulatory case system has lifecycle transitions:

```text
POST /cases/{caseId}/submission
POST /cases/{caseId}/assignment
POST /cases/{caseId}/escalation
POST /cases/{caseId}/decision-publication
POST /cases/{caseId}/closure
POST /cases/{caseId}/reopening
```

These should not be hidden inside generic update endpoints if they represent meaningful domain actions.

---

## 17. Action-Oriented Operations

Action-oriented operations are acceptable when they represent domain capabilities.

Weak action endpoint:

```text
POST /cases/{caseId}/do-submit
```

Better resource-like command endpoint:

```text
POST /cases/{caseId}/submission
```

Weak:

```text
POST /cases/{caseId}/do-close
```

Better:

```text
POST /cases/{caseId}/closure
```

Why noun-like command resources?

Because submission and closure can be treated as domain records:

```text
A submission has actor, timestamp, reason, target reviewer, validation result.
A closure has reason, authority, timestamp, final state, appeal eligibility.
```

This gives your API room to evolve.

---

## 18. Process-Oriented Operations

Some APIs expose workflow processes.

Example:

```text
POST /case-import-jobs
GET  /case-import-jobs/{jobId}
POST /case-import-jobs/{jobId}/cancellation
```

This is better than pretending a long-running import is synchronous:

```text
POST /cases/import
```

with a response that times out unpredictably.

A process-oriented operation should make lifecycle visible:

```text
submitted -> running -> completed
                   -> failed
                   -> cancelled
```

OpenAPI should describe the operation surface, while schema describes the job states and responses.

---

## 19. Search and Query Operations

Search operations deserve careful modelling.

Simple filtering:

```text
GET /cases?status=open&priority=high
```

Complex search:

```text
POST /case-searches
```

or:

```text
POST /cases/search
```

The better choice depends on whether search is treated as:

- simple list filtering,
- a complex query command,
- a saved resource,
- an asynchronous job,
- an auditable query.

For regulated systems, searches may need auditability:

```text
POST /case-searches
GET  /case-searches/{searchId}/results
```

This exposes search as a first-class object with traceability.

---

## 20. Operation-Level Overrides

OpenAPI allows some definitions at global, path, or operation level.

For example:

```yaml
servers:
  - url: https://api.example.com/v1

paths:
  /cases/{caseId}/evidence-files/{fileId}/content:
    get:
      operationId: downloadEvidenceFile
      servers:
        - url: https://files.example.com/v1
```

This can be useful when one operation uses a different server.

But use overrides sparingly. Too many operation-level overrides make an API hard to reason about.

Common operation-level overrides:

- `security`,
- `servers`,
- `parameters`,
- `requestBody`,
- `responses`,
- `deprecated`.

Good reason for operation-level security:

```yaml
security:
  - bearerAuth: []

paths:
  /health:
    get:
      operationId: getHealth
      security: []
```

This says the API is generally authenticated, but health is public.

---

## 21. `deprecated`

OpenAPI operations can be marked deprecated:

```yaml
paths:
  /legacy-cases/{caseId}:
    get:
      operationId: getLegacyCase
      deprecated: true
      summary: Get legacy case
      description: |
        Deprecated. Use `GET /cases/{caseId}` instead.
        This operation will be removed after 2027-06-30.
```

Deprecation should not be a lonely boolean.

A useful deprecation description includes:

- replacement operation,
- migration guidance,
- reason,
- date or policy,
- support window,
- compatibility notes.

Weak:

```yaml
deprecated: true
```

Better:

```yaml
deprecated: true
description: |
  Deprecated because this operation returns legacy status codes that do not map to the current case lifecycle.
  Use `GET /cases/{caseId}`.
  Existing consumers are supported until 2027-06-30.
```

---

## 22. Operation Security

Security can be global:

```yaml
security:
  - bearerAuth: []
```

And overridden per operation:

```yaml
paths:
  /public-notices:
    get:
      operationId: listPublicNotices
      security: []
```

Or made stricter:

```yaml
paths:
  /cases/{caseId}/closure:
    post:
      operationId: closeCase
      security:
        - bearerAuth:
            - case:close
```

This does not fully model authorization logic, but it signals required security scheme and scope expectations.

Important distinction:

```text
OpenAPI can describe auth requirements.
OpenAPI does not prove authorization correctness.
```

A user may have the `case:close` scope but still not be allowed to close a specific case due to assignment, jurisdiction, conflict of interest, or state constraints.

That nuance belongs in description, error responses, and implementation.

---

## 23. Path-Level Parameters

If multiple operations share the same path parameter, define it once at path level:

```yaml
paths:
  /cases/{caseId}:
    parameters:
      - name: caseId
        in: path
        required: true
        description: Stable identifier of the case.
        schema:
          type: string
          pattern: '^CASE-[0-9]{8}$'
    get:
      operationId: getCase
      responses:
        '200':
          description: Case found.
    patch:
      operationId: updateCase
      responses:
        '200':
          description: Case updated.
```

This avoids repetition.

But do not overuse path-level definitions when operations have meaningfully different constraints.

For example, if one operation accepts additional headers or query parameters, keep those operation-specific.

---

## 24. Path Item Reuse

OpenAPI 3.2.0 includes support for reusable Path Item Objects via `components.pathItems`.

This can help in advanced modular APIs where a standard set of operations is reused.

Conceptually:

```yaml
components:
  pathItems:
    HealthCheck:
      get:
        operationId: getHealth
        responses:
          '200':
            description: Service is healthy.
```

Then a path can reference it.

Use this cautiously.

Path item reuse is useful for standardized cross-cutting endpoints like:

- health,
- readiness,
- metadata,
- version information.

It is risky for business endpoints if reuse hides differences between domains.

---

## 25. Hidden Coupling Between Routing and Contract

OpenAPI path design often gets entangled with framework routing.

Example Spring code:

```java
@RequestMapping("/api/v1/cases")
@RestController
class CaseController {
    @GetMapping("/{id}")
    CaseDto get(@PathVariable String id) { ... }
}
```

Generated OpenAPI may produce:

```yaml
paths:
  /api/v1/cases/{id}:
    get:
      operationId: get
```

Problems:

- version is embedded in path without explicit strategy,
- path parameter is generic `id`,
- operation ID is generic `get`,
- response schema may mirror DTO,
- business semantics are absent.

Better contract:

```yaml
paths:
  /cases/{caseId}:
    get:
      operationId: getCase
      summary: Get case detail
      description: Returns the current detail representation of a case visible to the caller.
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
```

The implementation can still route under `/api/v1`, but the public contract should be consciously designed.

---

## 26. Path Versioning

Paths often include API version:

```text
/v1/cases
```

This is common and practical.

But be careful: versioning strategy belongs to API lifecycle design, not individual operation naming.

Avoid:

```yaml
operationId: v1GetCase
operationId: v1SubmitCase
```

Prefer:

```yaml
operationId: getCase
operationId: submitCase
```

with version represented by:

- server URL,
- base path,
- artifact version,
- package name,
- API catalog metadata.

Example:

```yaml
servers:
  - url: https://api.example.com/v1
```

or:

```yaml
paths:
  /v1/cases:
    get:
      operationId: listCases
```

Pick one style deliberately.

---

## 27. Endpoint Shape Patterns

### 27.1 Collection and Item

```text
GET  /cases
POST /cases
GET  /cases/{caseId}
PATCH /cases/{caseId}
```

Good for standard resources.

### 27.2 Sub-Collection

```text
GET  /cases/{caseId}/evidence-items
POST /cases/{caseId}/evidence-items
GET  /cases/{caseId}/evidence-items/{evidenceItemId}
```

Good when child resources belong to parent context.

### 27.3 Command Resource

```text
POST /cases/{caseId}/submission
POST /cases/{caseId}/closure
```

Good for explicit lifecycle actions.

### 27.4 Job Resource

```text
POST /case-import-jobs
GET  /case-import-jobs/{jobId}
```

Good for async processing.

### 27.5 Search Resource

```text
POST /case-searches
GET  /case-searches/{searchId}/results
```

Good for complex, auditable, or persisted search.

---

## 28. Case Study: Weak API Surface

Suppose a case management API starts like this:

```yaml
paths:
  /case/get:
    post:
      operationId: getCaseUsingPOST
  /case/save:
    post:
      operationId: saveCase
  /case/action:
    post:
      operationId: action
  /case/list:
    post:
      operationId: list
```

Problems:

1. Uses verbs in paths without clear resource model.
2. Uses POST for everything.
3. Operation IDs are unstable or generic.
4. `action` hides multiple lifecycle operations.
5. `save` does not distinguish create vs update.
6. `list` does not show what is listed.
7. Generated clients will be ugly.
8. Security and error modelling will be coarse.
9. Breaking changes are hard to detect because semantics are hidden in request payloads.

A stronger surface:

```yaml
paths:
  /cases:
    get:
      operationId: listCases
      summary: List cases visible to the caller
    post:
      operationId: createCase
      summary: Create a draft case

  /cases/{caseId}:
    get:
      operationId: getCase
      summary: Get case detail
    patch:
      operationId: updateCase
      summary: Update editable case fields

  /cases/{caseId}/submission:
    post:
      operationId: submitCase
      summary: Submit a case for review

  /cases/{caseId}/assignment:
    post:
      operationId: assignCase
      summary: Assign a case to an officer

  /cases/{caseId}/closure:
    post:
      operationId: closeCase
      summary: Close a case
```

Now the API surface reveals capabilities.

---

## 29. Complete Example: Production-Style Path and Operations

```yaml
openapi: 3.2.0
info:
  title: Case Management API
  version: 1.0.0
  summary: API for managing regulatory case lifecycle operations.

servers:
  - url: https://api.example.gov/v1

paths:
  /cases:
    get:
      operationId: listCases
      tags:
        - Cases
      summary: List cases visible to the caller
      description: |
        Returns a paginated list of cases the authenticated caller is allowed to view.
        Results may be filtered by lifecycle state, assigned officer, priority, and creation date.
      parameters:
        - name: state
          in: query
          required: false
          schema:
            type: string
            enum: [draft, submitted, under_review, closed]
        - name: limit
          in: query
          required: false
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 25
      responses:
        '200':
          description: Cases returned successfully.
        '400':
          description: Invalid filter or pagination parameter.
        '401':
          description: Authentication is required.
        '403':
          description: Caller is not allowed to list cases.

    post:
      operationId: createCase
      tags:
        - Cases
      summary: Create a draft case
      description: |
        Creates a new case in draft state.
        Server-generated fields include `caseId`, `state`, `createdAt`, and `createdBy`.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateCaseRequest'
      responses:
        '201':
          description: Case created successfully.
          headers:
            Location:
              description: URL of the created case resource.
              schema:
                type: string
                format: uri
        '400':
          description: Request body is structurally invalid.
        '422':
          description: Request body is structurally valid but violates business rules.

  /cases/{caseId}:
    parameters:
      - name: caseId
        in: path
        required: true
        description: Stable identifier of the case.
        schema:
          type: string
          pattern: '^CASE-[0-9]{8}$'

    get:
      operationId: getCase
      tags:
        - Cases
      summary: Get case detail
      description: |
        Returns the current case detail representation visible to the caller.
        Some fields may be omitted or redacted depending on caller authorization.
      responses:
        '200':
          description: Case found.
        '401':
          description: Authentication is required.
        '403':
          description: Caller is not allowed to view this case.
        '404':
          description: Case does not exist or is not visible to the caller.

    patch:
      operationId: updateCase
      tags:
        - Cases
      summary: Update editable case fields
      description: |
        Updates editable fields of a draft case.
        This operation does not perform lifecycle transitions such as submission or closure.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateCaseRequest'
      responses:
        '200':
          description: Case updated successfully.
        '400':
          description: Request body is structurally invalid.
        '403':
          description: Caller is not allowed to update this case.
        '409':
          description: Case cannot be updated in its current state.

  /cases/{caseId}/submission:
    parameters:
      - name: caseId
        in: path
        required: true
        schema:
          type: string
          pattern: '^CASE-[0-9]{8}$'

    post:
      operationId: submitCase
      tags:
        - Cases
      summary: Submit a case for supervisory review
      description: |
        Transitions a draft case into submitted state.

        Preconditions:
        - The case must be in `draft` state.
        - The case must contain at least one allegation.
        - The case must contain at least one evidence item.

        Effects:
        - Case state changes to `submitted`.
        - Submission timestamp is recorded.
        - Submitting officer is recorded.
        - The case becomes unavailable for ordinary draft updates.
      responses:
        '202':
          description: Submission accepted.
        '403':
          description: Caller is not allowed to submit this case.
        '404':
          description: Case does not exist or is not visible to the caller.
        '409':
          description: Case cannot be submitted in its current state.
        '422':
          description: Case is structurally valid but incomplete for submission.

components:
  schemas:
    CreateCaseRequest:
      type: object
      required:
        - subjectId
        - allegationSummary
      properties:
        subjectId:
          type: string
        allegationSummary:
          type: string
          minLength: 20
          maxLength: 4000

    UpdateCaseRequest:
      type: object
      properties:
        priority:
          type: string
          enum: [low, normal, high, urgent]
        summary:
          type: string
          minLength: 20
          maxLength: 4000
```

Notice several design properties:

- `operationId` values are stable and meaningful.
- Lifecycle commands are explicit.
- `PATCH /cases/{caseId}` is not overloaded with submission.
- Path parameter has a format constraint.
- Errors are documented beyond `200`.
- Descriptions capture semantics not visible from schema.
- Request schemas are not reused blindly across create and update.

---

## 30. Mapping to Java/Spring

A good OpenAPI operation can map cleanly to Spring without letting Spring dictate the contract.

Example:

```java
@RestController
@RequestMapping("/cases")
class CaseController {

    @GetMapping
    ResponseEntity<ListCasesResponse> listCases(...) {
        ...
    }

    @PostMapping
    ResponseEntity<CaseResponse> createCase(...) {
        ...
    }

    @GetMapping("/{caseId}")
    ResponseEntity<CaseResponse> getCase(@PathVariable String caseId) {
        ...
    }

    @PatchMapping("/{caseId}")
    ResponseEntity<CaseResponse> updateCase(...) {
        ...
    }

    @PostMapping("/{caseId}/submission")
    ResponseEntity<CaseSubmissionResponse> submitCase(...) {
        ...
    }
}
```

But implementation naming should not leak into the contract.

This is bad:

```yaml
operationId: caseControllerSubmitCase
```

This is better:

```yaml
operationId: submitCase
```

The API contract belongs to the boundary, not the controller class.

---

## 31. Operation Design Review Checklist

For every operation, ask:

```text
1. Is the path stable and domain-oriented?
2. Does the path leak implementation details?
3. Is the HTTP method appropriate?
4. Is the operationId unique, stable, and SDK-friendly?
5. Does the summary explain the operation in one line?
6. Does the description explain important semantics?
7. Are path parameters explicit and constrained?
8. Are all likely error responses documented?
9. Is this operation overloaded with multiple hidden actions?
10. Does this operation have distinct authorization requirements?
11. Does this operation cause state transition?
12. Is idempotency clear?
13. Is retry behavior clear?
14. Is concurrency behavior clear?
15. Would a generated client method name be pleasant to use?
16. Would a consumer understand this without reading server code?
17. Would this design survive internal refactoring?
18. Would this operation be auditable if needed?
```

If the answer to several of these is no, the operation is probably under-designed.

---

## 32. Common Anti-Patterns

### 32.1 Generic Action Endpoint

```text
POST /cases/{caseId}/action
```

with body:

```json
{
  "action": "SUBMIT"
}
```

Problem:

- hides lifecycle semantics,
- makes authorization coarse,
- makes errors generic,
- weakens auditability,
- makes breaking changes harder to detect.

---

### 32.2 CRUD Tunnel with POST Everything

```text
POST /cases/list
POST /cases/get
POST /cases/update
POST /cases/delete
```

Problem:

- loses HTTP method semantics,
- harms caching/discoverability,
- creates awkward generated clients,
- makes tooling less useful.

---

### 32.3 Controller-Leaking Paths

```text
/caseController/getCase
/workflowService/submit
```

Problem:

- exposes implementation,
- breaks when code is refactored,
- weakens external contract.

---

### 32.4 Unstable Operation IDs

```yaml
operationId: getUsingGET_1
operationId: getUsingGET_2
operationId: submit_3
```

Problem:

- generated clients become unstable,
- method names change accidentally,
- consumer code breaks for no semantic reason.

---

### 32.5 Ambiguous Path Parameters

```text
/cases/{id}/evidence/{id}
```

Problem:

- impossible to generate clean method names,
- confusing documentation,
- error-prone implementation.

---

### 32.6 Missing Non-Success Responses

```yaml
responses:
  '200':
    description: OK
```

Problem:

- consumer cannot plan failure handling,
- generated clients lack error semantics,
- contract tests miss important behavior.

---

## 33. Heuristics for Top 1% API Operation Design

Use these heuristics:

```text
A path should reveal the domain surface.
An operationId should survive implementation refactoring.
A lifecycle transition deserves an explicit operation.
A generic action endpoint is usually a smell.
A generated SDK should feel hand-designed.
A path parameter name should be globally understandable.
A description should document semantics that schemas cannot express.
A response list should describe realistic failure modes.
An operation should be reviewable as a business capability.
```

---

## 34. Practical Exercise

Take this weak API:

```text
POST /api/v1/case/list
POST /api/v1/case/get
POST /api/v1/case/save
POST /api/v1/case/action
POST /api/v1/case/evidence/upload
POST /api/v1/case/evidence/delete
```

Rewrite it into a stronger OpenAPI path surface.

Possible answer:

```text
GET    /cases
POST   /cases
GET    /cases/{caseId}
PATCH  /cases/{caseId}
POST   /cases/{caseId}/submission
GET    /cases/{caseId}/evidence-items
POST   /cases/{caseId}/evidence-items
DELETE /cases/{caseId}/evidence-items/{evidenceItemId}
```

Then assign operation IDs:

```text
listCases
createCase
getCase
updateCase
submitCase
listCaseEvidenceItems
addCaseEvidenceItem
deleteCaseEvidenceItem
```

Then ask:

```text
Which operations are safe?
Which are idempotent?
Which require special authorization?
Which create audit events?
Which need conflict responses?
Which can be retried safely?
```

That is the beginning of real contract design.

---

## 35. Key Takeaways

1. `paths` is the visible surface area of your API.
2. An operation is a stable capability, not merely a controller method.
3. `operationId` is a long-term automation key and should be designed carefully.
4. Path names should reflect domain concepts, not Java internals.
5. Lifecycle transitions should usually be explicit operations.
6. Generic action endpoints hide important semantics.
7. Path parameter names should be precise and unambiguous.
8. Descriptions should capture semantics that schemas cannot express.
9. Operation-level security, deprecation, and server overrides are powerful but should be used deliberately.
10. A strong OpenAPI operation is readable by humans, usable by tools, safe for generated clients, and stable across implementation refactoring.

---

## 36. What Comes Next

Part 005 will go deeper into **parameters**:

- path parameters,
- query parameters,
- header parameters,
- cookie parameters,
- array serialization,
- object serialization,
- `style`,
- `explode`,
- filtering,
- sorting,
- pagination,
- Java binding implications.

This matters because many real integration bugs come not from the endpoint path itself, but from ambiguous parameter serialization.

---

# Series Progress

```text
Current part: 004 / 030
Status: In progress
Series complete: No
Remaining parts: 26
Next: Part 005 — Parameters: Path, Query, Header, Cookie, Style, Explode, and Encoding
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-003.md">⬅️ Part 003 — Anatomy of an OpenAPI Document</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-005.md">Part 005 — Parameters: Path, Query, Header, Cookie, Style, Explode, and Encoding ➡️</a>
</div>
