# OpenAPI Mastery for Java Engineers — Part 028
# OpenAPI Anti-Patterns and Failure Modes in Real Projects

> Filename: `learn-openapi-mastery-for-java-engineers-part-028.md`  
> Series: `learn-openapi-mastery-for-java-engineers`  
> Part: `028 / 030`  
> Audience: Java software engineers, tech leads, API platform engineers, backend architects  
> Focus: recognizing OpenAPI designs that are syntactically valid but operationally dangerous

---

## 0. Why This Part Exists

At this point in the series, you already understand the building blocks:

- paths,
- operations,
- parameters,
- request bodies,
- responses,
- schemas,
- components,
- security schemes,
- examples,
- generated clients,
- generated servers,
- CI/CD,
- governance,
- schema evolution,
- regulated-system concerns.

But real OpenAPI failures usually do not happen because someone completely misunderstood the syntax.

They happen because the team produces a spec that is:

- syntactically valid,
- renderable in Swagger UI,
- accepted by CI,
- maybe even used to generate clients,

but still semantically weak.

That is the dangerous zone.

A bad OpenAPI document can look professional while hiding:

- ambiguous behavior,
- consumer-breaking changes,
- generated SDK instability,
- undocumented authorization rules,
- response drift,
- entity leakage,
- workflow confusion,
- compliance gaps,
- inconsistent errors,
- platform governance blind spots.

This part is about developing diagnostic skill.

A top-tier engineer should not only be able to write a good OpenAPI contract. They should be able to look at an existing OpenAPI document and say:

> “This is valid YAML, but it is not a reliable contract.”

---

## 1. The Core Mental Model: Valid Specification Is Not Equal to Good Contract

OpenAPI validation usually answers a narrow question:

> “Does this document follow the OpenAPI structure?”

But a good API contract must answer broader engineering questions:

1. Can a consumer understand how to use the API correctly?
2. Can a generated client be stable across releases?
3. Can non-happy-path behavior be predicted?
4. Can breaking changes be detected before deployment?
5. Can security expectations be understood?
6. Can examples be trusted?
7. Can the API evolve without surprising consumers?
8. Can auditors, reviewers, QA, and platform teams trace behavior from contract to implementation?

A spec can pass validation and fail all of these.

### Bad OpenAPI Often Has This Shape

```yaml
openapi: 3.0.3
info:
  title: User API
  version: 1.0.0
paths:
  /users:
    get:
      summary: Get users
      responses:
        '200':
          description: OK
```

This is superficially valid, but it tells the consumer almost nothing.

Missing:

- pagination,
- filtering,
- authentication,
- response schema,
- error responses,
- rate-limit behavior,
- examples,
- operation ID,
- ownership,
- data sensitivity,
- sorting semantics,
- empty result behavior,
- authorization differences,
- response headers,
- stability guarantees.

A valid document can still be operationally useless.

---

## 2. Anti-Pattern #1 — OpenAPI as an Afterthought

### Symptom

The API is designed, implemented, tested, deployed, and only then someone says:

> “Can we add Swagger docs?”

The OpenAPI document becomes a documentation artifact generated from whatever the code currently does.

### Why It Happens

Common causes:

- teams are delivery-pressure driven,
- API review is not part of the development lifecycle,
- documentation is treated as a post-delivery chore,
- generated Swagger UI gives the illusion that the API is documented,
- developers believe code is the only source of truth,
- consumers are internal, so contract discipline is undervalued.

### Why It Is Dangerous

If OpenAPI comes after implementation, the spec often inherits implementation accidents:

- internal DTO names,
- database field names,
- undocumented validation quirks,
- accidental nullability,
- inconsistent error structures,
- unstable enum values,
- implementation-specific pagination,
- framework default behavior,
- leaky security assumptions.

The problem is not code-first itself.

The problem is **review-last**.

Code-first can work if the generated contract is reviewed, diffed, linted, tested, and treated as a release artifact.

### Bad Workflow

```text
Implement endpoint
    ↓
Generate OpenAPI
    ↓
Expose Swagger UI
    ↓
Call it documentation
```

### Better Workflow

```text
Design operation contract
    ↓
Review consumer impact
    ↓
Implement endpoint
    ↓
Generate or update OpenAPI
    ↓
Validate implementation against OpenAPI
    ↓
Diff against previous version
    ↓
Publish contract artifact
```

### Diagnostic Question

Ask:

> “Could this OpenAPI document have prevented a bad API design, or does it merely describe one after the fact?”

If the answer is “it only describes what already exists,” governance is weak.

---

## 3. Anti-Pattern #2 — Generated Spec Without Review

### Symptom

The team uses Spring annotations, springdoc-openapi, or Swagger Core to generate an OpenAPI document automatically, and no human meaningfully reviews the output.

### Typical Failure

A Java controller like this:

```java
@GetMapping("/cases/{id}")
public CaseEntity getCase(@PathVariable Long id) {
    return caseRepository.findById(id).orElseThrow();
}
```

Generates a spec that exposes the persistence entity structure.

The generated spec may contain:

- internal IDs,
- internal timestamps,
- lazy-loaded relationship shapes,
- persistence-oriented enum names,
- fields consumers should never rely on,
- fields that are present only because of Jackson serialization.

### Why It Is Dangerous

Generated OpenAPI documents are outputs of framework interpretation.

They are not automatically good contracts.

Generation can infer:

- Java method names,
- annotations,
- Bean Validation constraints,
- Jackson configuration,
- class structures,
- generic wrappers,
- response types.

But it cannot fully infer:

- business meaning,
- compatibility intent,
- security boundary,
- consumer relevance,
- operational constraints,
- deprecation policy,
- cross-field business rules,
- domain lifecycle semantics.

### Top-Tier Rule

Generated OpenAPI is a **draft**, not a contract, until reviewed.

### Practical Guardrail

Use CI checks:

```text
Generate OpenAPI from application
    ↓
Compare against committed reviewed contract
    ↓
Fail if undocumented drift appears
```

This prevents accidental changes such as:

- renamed fields,
- removed responses,
- changed nullability,
- changed operation IDs,
- changed schemas,
- changed parameter serialization.

---

## 4. Anti-Pattern #3 — DTO Dump

### Symptom

The OpenAPI schema mirrors Java DTO classes directly.

Example:

```yaml
components:
  schemas:
    UserDto:
      type: object
      properties:
        id:
          type: integer
        firstName:
          type: string
        lastName:
          type: string
        passwordHash:
          type: string
        internalStatus:
          type: string
        createdByBatchJob:
          type: boolean
```

### Why It Happens

Java teams often have classes named:

- `UserDto`,
- `CreateUserDto`,
- `UpdateUserDto`,
- `UserResponseDto`,
- `UserEntityDto`,
- `UserResourceDto`.

These classes are treated as if they are the API contract.

But DTO is a code-level transport structure.

OpenAPI schema is an external contract representation.

They may align, but they are not the same concept.

### Failure Modes

DTO dump causes:

1. internal field exposure,
2. accidental backward compatibility promises,
3. consumers depending on fields not intended for them,
4. domain refactor becoming API breaking change,
5. generated clients polluted with implementation names,
6. poor documentation readability,
7. excessive schema reuse,
8. unclear request/response separation.

### Better Approach

Design schemas by contract role:

```yaml
components:
  schemas:
    UserSummary:
      type: object
      required: [id, displayName]
      properties:
        id:
          type: string
        displayName:
          type: string

    UserDetail:
      type: object
      required: [id, displayName, email, status]
      properties:
        id:
          type: string
        displayName:
          type: string
        email:
          type: string
          format: email
        status:
          $ref: '#/components/schemas/UserStatus'

    CreateUserRequest:
      type: object
      required: [displayName, email]
      properties:
        displayName:
          type: string
          minLength: 1
        email:
          type: string
          format: email
```

Names express API roles, not Java implementation artifacts.

---

## 5. Anti-Pattern #4 — Entity Exposure

### Symptom

The API contract exposes persistence entities directly.

Example:

```java
@Entity
public class EnforcementCase {
    @Id
    private Long id;

    @OneToMany(mappedBy = "case")
    private List<CaseAssignment> assignments;

    @Enumerated(EnumType.STRING)
    private InternalCaseStatus status;

    private boolean softDeleted;
}
```

Then the generated API exposes something like:

```yaml
EnforcementCase:
  type: object
  properties:
    id:
      type: integer
    assignments:
      type: array
      items:
        $ref: '#/components/schemas/CaseAssignment'
    status:
      type: string
    softDeleted:
      type: boolean
```

### Why It Is Dangerous

Persistence entities are optimized for storage and domain operations.

API representations are optimized for consumer understanding and stability.

These are different forces.

Entity exposure creates coupling to:

- database schema,
- ORM mapping,
- internal lifecycle states,
- lazy/eager loading decisions,
- internal relationship cardinality,
- soft-delete implementation,
- audit implementation,
- naming conventions,
- refactoring choices.

### Regulatory System Risk

In enforcement/case-management systems, entity exposure can leak:

- internal investigation state,
- confidential reviewer notes,
- assignment details,
- redaction flags,
- soft-deleted records,
- internal risk scores,
- appeal-routing logic,
- non-disclosable metadata.

This is not merely bad API design.

It can become a compliance and legal defensibility issue.

### Better Boundary

Use explicit API representations:

```text
Persistence Entity
    ↓ mapping
Domain/Application Model
    ↓ mapping
API Response Schema
```

Never assume:

```text
Entity == DTO == OpenAPI Schema
```

---

## 6. Anti-Pattern #5 — Schema Over-Reuse

### Symptom

One schema is reused everywhere because it seems DRY.

Example:

```yaml
components:
  schemas:
    Case:
      type: object
      properties:
        id:
          type: string
        title:
          type: string
        status:
          type: string
        assignedOfficer:
          type: string
        evidenceCount:
          type: integer
        internalRiskScore:
          type: number
        closureReason:
          type: string
```

Used for:

- create request,
- update request,
- list response,
- detail response,
- audit response,
- export response,
- admin response.

### Why It Seems Good

It feels DRY:

- fewer schemas,
- fewer files,
- less duplication,
- easier generation,
- faster changes.

### Why It Fails

Over-reuse couples unrelated operations.

A field needed in one response becomes visible everywhere.

A constraint needed for create accidentally affects update.

A field deprecated for public consumers becomes hard to remove because internal consumers reuse the same schema.

### Example Failure

You add `closureReason` for closed cases.

Because `Case` is reused in create request, generated clients now think they can send `closureReason` during case creation.

Even if the server ignores it, the contract becomes confusing.

### Better Approach

Use role-specific schemas:

```text
CreateCaseRequest
UpdateCaseRequest
CaseSummary
CaseDetail
CaseAuditView
CaseAdminView
CaseExportRecord
```

This is not duplication.

This is contract separation.

### Rule

Reuse only when lifecycle, visibility, validation, and compatibility semantics are truly the same.

---

## 7. Anti-Pattern #6 — Schema Under-Reuse

### Symptom

Every endpoint defines nearly identical schemas with slightly different names.

Example:

```yaml
CreateCaseApplicantAddress
UpdateCaseApplicantAddress
CaseDetailApplicantAddress
CaseSearchApplicantAddress
CaseExportApplicantAddress
```

All have the same properties:

```yaml
street
city
postalCode
country
```

### Why It Is Dangerous

Under-reuse causes:

- inconsistent constraints,
- inconsistent examples,
- inconsistent naming,
- duplicated fixes,
- schema drift,
- generated SDK bloat,
- documentation fatigue.

### Better Approach

Separate stable value objects from operation-specific envelopes.

Example:

```yaml
components:
  schemas:
    PostalAddress:
      type: object
      required: [street, city, postalCode, country]
      properties:
        street:
          type: string
        city:
          type: string
        postalCode:
          type: string
        country:
          type: string
          minLength: 2
          maxLength: 2
```

Then use it where it truly means the same thing.

### The Balance

Bad reuse says:

> “Same shape means same schema.”

Good reuse says:

> “Same semantics, lifecycle, visibility, and compatibility means same schema.”

---

## 8. Anti-Pattern #7 — Inconsistent Error Model

### Symptom

Each endpoint invents its own error shape.

Examples:

```json
{
  "error": "Invalid request"
}
```

```json
{
  "message": "Case not found"
}
```

```json
{
  "code": 404,
  "details": "No case"
}
```

```json
{
  "errors": [
    "title must not be blank"
  ]
}
```

### Why It Is Dangerous

Consumers cannot build one error handling strategy.

Generated clients cannot map errors consistently.

Support teams cannot correlate incidents.

QA cannot write generic error assertions.

Security teams cannot review error leakage consistently.

Regulated systems cannot produce consistent evidence of failure behavior.

### Better Error Contract

Use a standard envelope, often based on Problem Details style:

```yaml
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
    code:
      type: string
    correlationId:
      type: string
    violations:
      type: array
      items:
        $ref: '#/components/schemas/Violation'

Violation:
  type: object
  required: [field, message]
  properties:
    field:
      type: string
    message:
      type: string
    code:
      type: string
```

### Operational Rule

Document at least:

- validation errors,
- authentication errors,
- authorization errors,
- not found,
- conflict,
- rate limit,
- server error,
- retryable conditions.

If only `200` is documented, the API is not documented.

---

## 9. Anti-Pattern #8 — Missing Non-200 Responses

### Symptom

The spec documents only success responses.

```yaml
responses:
  '200':
    description: OK
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/CaseDetail'
```

### Why It Happens

Teams often think errors are obvious:

- 400 means bad request,
- 401 means unauthenticated,
- 403 means unauthorized,
- 404 means not found,
- 500 means server error.

But the consumer needs more than numeric codes.

They need to know:

- error shape,
- retryability,
- correlation mechanism,
- field-level validation structure,
- business conflict reason,
- authorization failure behavior,
- whether missing resource and forbidden resource are intentionally indistinguishable,
- how rate limits are communicated.

### Real Failure

A frontend receives `409 Conflict` but the contract does not say when it occurs.

Developers guess:

- duplicate request?
- stale version?
- invalid state transition?
- locked record?
- concurrent assignment?
- business rule violation?

Each guess creates inconsistent UX.

### Better Response Contract

```yaml
responses:
  '200':
    description: Case returned.
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/CaseDetail'

  '401':
    $ref: '#/components/responses/Unauthorized'

  '403':
    $ref: '#/components/responses/Forbidden'

  '404':
    $ref: '#/components/responses/CaseNotFound'

  '409':
    $ref: '#/components/responses/CaseStateConflict'

  '500':
    $ref: '#/components/responses/InternalServerError'
```

### Top-Tier Principle

Error responses are not secondary documentation.

They are part of the executable behavior contract.

---

## 10. Anti-Pattern #9 — Invalid or Unrealistic Examples

### Symptom

Examples are syntactically invalid, schema-invalid, or unrealistic.

Example:

```yaml
example:
  id: 123
  createdAt: yesterday
  status: done
```

But schema says:

```yaml
id:
  type: string
createdAt:
  type: string
  format: date-time
status:
  enum: [OPEN, UNDER_REVIEW, CLOSED]
```

### Why It Is Dangerous

Consumers copy examples.

QA writes tests from examples.

Mock servers use examples.

Documentation sites render examples.

Generated SDK docs include examples.

If examples lie, the entire integration surface is polluted.

### Common Example Failures

1. IDs use wrong type.
2. Dates use non-ISO values.
3. Enums use friendly labels instead of actual values.
4. Required fields are missing.
5. Nullable fields are represented inconsistently.
6. Error examples do not match error schemas.
7. Pagination examples omit cursor metadata.
8. Security examples contain fake-but-realistic secrets.
9. Domain examples use impossible states.
10. Examples show internal-only fields.

### Better Practice

Examples should be:

- schema-valid,
- domain-plausible,
- safe,
- stable,
- representative,
- tested in CI,
- useful for onboarding,
- useful as mock fixtures.

### Example Test Gate

```text
For every example in OpenAPI:
    validate example against schema
    validate required fields
    validate enum values
    validate date/time format
    validate no forbidden sensitive sample data
```

---

## 11. Anti-Pattern #10 — Bad `operationId`

### Symptom

Operation IDs are missing, duplicated, unstable, or implementation-centric.

Bad examples:

```yaml
operationId: get
operationId: getUsingGET
operationId: caseControllerGetCase
operationId: getCase_1
operationId: list
```

### Why It Matters

`operationId` is often used by tooling for:

- generated SDK method names,
- documentation anchors,
- test naming,
- mock routing,
- gateway policies,
- tracing metadata,
- change impact analysis.

Changing `operationId` can break generated clients even if the HTTP path and schema do not change.

### Better Naming

```yaml
operationId: listCases
operationId: createCase
operationId: getCaseById
operationId: submitCase
operationId: assignCaseOfficer
operationId: closeCase
operationId: listCaseEvidence
```

### Design Rule

An operation ID should be:

- unique,
- stable,
- consumer-readable,
- action-oriented,
- not tied to controller class names,
- not tied to framework-generated suffixes.

### Failure Detection

Lint rules should fail:

- missing operation ID,
- duplicate operation ID,
- operation ID with generated suffixes,
- operation ID containing controller names,
- operation ID not matching naming convention.

---

## 12. Anti-Pattern #11 — Ambiguous Polymorphism

### Symptom

The spec uses `oneOf`, `anyOf`, `allOf`, or discriminators without clear validation semantics.

Example:

```yaml
CaseActor:
  oneOf:
    - $ref: '#/components/schemas/PersonActor'
    - $ref: '#/components/schemas/OrganizationActor'
```

But both schemas allow the same fields:

```yaml
PersonActor:
  type: object
  properties:
    id:
      type: string
    name:
      type: string

OrganizationActor:
  type: object
  properties:
    id:
      type: string
    name:
      type: string
```

Now an instance with `id` and `name` matches both.

`oneOf` fails because exactly one schema must match.

### Why It Is Dangerous

Ambiguous polymorphism causes:

- validation errors,
- generated client confusion,
- Jackson mapping problems,
- unclear SDK model hierarchy,
- poor documentation,
- compatibility traps.

### Better Version

Use an explicit discriminator field:

```yaml
CaseActor:
  oneOf:
    - $ref: '#/components/schemas/PersonActor'
    - $ref: '#/components/schemas/OrganizationActor'
  discriminator:
    propertyName: actorType
    mapping:
      PERSON: '#/components/schemas/PersonActor'
      ORGANIZATION: '#/components/schemas/OrganizationActor'

PersonActor:
  type: object
  required: [actorType, id, fullName]
  properties:
    actorType:
      type: string
      const: PERSON
    id:
      type: string
    fullName:
      type: string

OrganizationActor:
  type: object
  required: [actorType, id, legalName]
  properties:
    actorType:
      type: string
      const: ORGANIZATION
    id:
      type: string
    legalName:
      type: string
```

### Top-Tier Rule

Do not use polymorphism to look elegant.

Use it only when consumers genuinely need variant-specific shapes.

Sometimes a simple enum field is better.

---

## 13. Anti-Pattern #12 — `allOf` as Java Inheritance Mirror

### Symptom

The API schema mirrors Java inheritance.

```yaml
BaseCase:
  type: object
  properties:
    id:
      type: string
    createdAt:
      type: string
      format: date-time

InvestigationCase:
  allOf:
    - $ref: '#/components/schemas/BaseCase'
    - type: object
      properties:
        investigatorId:
          type: string
```

### Why It Seems Natural to Java Engineers

Java developers see:

```java
class InvestigationCase extends BaseCase
```

and map it to:

```yaml
allOf:
  - BaseCase
  - InvestigationCaseFields
```

### Why It Can Be Wrong

JSON Schema composition is not Java inheritance.

`allOf` means the instance must satisfy all referenced schemas.

It does not mean “copy fields from parent class” in a Java sense.

Common issues:

- required fields behave unexpectedly,
- generators produce awkward inheritance,
- discriminator mapping is unclear,
- validation does not match Java intuition,
- base schema evolves and breaks all children,
- consumer mental model becomes too implementation-centric.

### Better Alternative

For simple field reuse, prefer explicit composition only if semantics are clear.

Sometimes duplication is safer:

```yaml
InvestigationCase:
  type: object
  required: [id, createdAt, investigatorId]
  properties:
    id:
      type: string
    createdAt:
      type: string
      format: date-time
    investigatorId:
      type: string
```

Duplication is acceptable when it protects contract clarity.

---

## 14. Anti-Pattern #13 — Weak Security Documentation

### Symptom

The spec says an endpoint is secured, but not how.

```yaml
security:
  - bearerAuth: []
```

But it does not explain:

- required scopes,
- roles,
- tenant restrictions,
- ownership rules,
- case-level permissions,
- field-level visibility,
- admin vs user behavior,
- error response differences.

### Why It Is Dangerous

OpenAPI can model authentication mechanisms and OAuth scopes, but most authorization logic is domain-specific.

If that is not documented, consumers cannot predict access behavior.

In regulated systems, this is serious.

Example:

```text
GET /cases/{caseId}
```

Who can call it?

- assigned officer?
- supervisor?
- appeal reviewer?
- external complainant?
- subject representative?
- auditor?
- system integration client?

Do all roles see the same fields?

Do forbidden and not-found responses intentionally collapse to avoid information leakage?

### Better Contract Documentation

```yaml
get:
  operationId: getCaseById
  summary: Get case details visible to the authenticated actor.
  description: |
    Returns case details according to the caller's authorization context.

    Access rules:
    - Assigned officers can view operational fields.
    - Supervisors can view escalation metadata.
    - External complainants can only view disclosure-safe fields.
    - If the caller has no case-level access, the API returns 404 to avoid confirming case existence.
  security:
    - oauth2:
        - cases:read
```

### Top-Tier Rule

Do not pretend OpenAPI can fully encode authorization.

Use OpenAPI to document what consumers need to know, and link to deeper policy documentation where needed.

---

## 15. Anti-Pattern #14 — No Ownership Metadata

### Symptom

The spec does not reveal who owns the API.

No team.

No contact.

No lifecycle.

No support channel.

No escalation path.

### Why It Is Dangerous

An API without ownership becomes orphaned.

Consumers do not know:

- who to ask before integrating,
- who approves changes,
- who handles incidents,
- who communicates deprecations,
- who reviews breaking changes,
- who owns generated SDKs,
- who owns documentation quality.

### Minimal Ownership Metadata

OpenAPI has `info.contact`:

```yaml
info:
  title: Enforcement Case API
  version: 1.4.0
  contact:
    name: Enforcement Platform Team
    email: enforcement-platform@example.gov
```

You can also use extensions:

```yaml
x-api-owner: enforcement-platform
x-lifecycle-stage: production
x-support-channel: '#api-enforcement-support'
x-data-classification: confidential
x-contract-review-required: true
```

### Governance Rule

Every production API should have:

- owner,
- lifecycle stage,
- support channel,
- change policy,
- versioning policy,
- data classification,
- consumer visibility.

---

## 16. Anti-Pattern #15 — No Consumer Impact Analysis

### Symptom

The team changes OpenAPI based on provider convenience only.

Example:

```text
We renamed `caseStatus` to `status` because the Java model changed.
```

No one checks:

- who uses the old field,
- whether generated clients break,
- whether dashboards depend on it,
- whether mobile apps parse it,
- whether partner integrations map it,
- whether documentation examples change,
- whether contract diff flags it.

### Why It Is Dangerous

API changes are not local.

They affect consumer code, tests, SDKs, mocks, documentation, data mapping, workflows, and operations.

### Better Change Process

Before merging an OpenAPI change, answer:

1. Is it additive or breaking?
2. Which operations changed?
3. Which schemas changed?
4. Which consumers are affected?
5. Are generated clients affected?
6. Are examples still valid?
7. Are contract tests updated?
8. Is deprecation needed?
9. Is migration documentation needed?
10. Is release communication needed?

### Practical Gate

```text
OpenAPI diff detects change
    ↓
Change classified as additive / risky / breaking
    ↓
Consumer impact assessed
    ↓
Migration or deprecation plan attached
    ↓
Review approved
```

---

## 17. Anti-Pattern #16 — Runtime Drift

### Symptom

OpenAPI says one thing, runtime does another.

Examples:

- spec says field is required, runtime omits it,
- spec says `status` enum has 3 values, runtime returns 5,
- spec says endpoint returns `404`, runtime returns `200` with error body,
- spec says request body rejects unknown fields, runtime accepts them,
- spec says endpoint requires OAuth scope, runtime does not enforce it,
- spec says `application/json`, runtime returns `text/plain`,
- spec says `date-time`, runtime returns custom timestamp format.

### Why It Is Dangerous

Runtime drift destroys trust.

Once consumers learn the spec is unreliable, they start reverse engineering behavior.

Then the real contract becomes:

```text
whatever production currently does
```

That is the worst possible contract.

### Causes

- generated spec not validated against runtime,
- manual spec not synchronized with implementation,
- gateway transformations not reflected,
- framework defaults changed,
- exception handler returns undocumented bodies,
- feature flags alter response shape,
- versioned deployments inconsistent,
- different environments behave differently.

### Guardrails

Use:

- provider contract tests,
- response validation in integration tests,
- schema validation in CI,
- synthetic tests against deployed environments,
- gateway validation where appropriate,
- diff between generated runtime spec and committed contract,
- monitoring for undocumented status codes/content types.

---

## 18. Anti-Pattern #17 — Tool-Driven Architecture

### Symptom

The API shape is determined by what the tool generates easily.

Examples:

- choosing schemas based on generator limitations,
- exposing awkward names because codegen emits them,
- avoiding proper error modelling because annotation support is annoying,
- using Java inheritance because generator supports it,
- avoiding `oneOf` because a client generator handles it poorly,
- changing contract structure to match framework controller structure.

### The Subtlety

Tool constraints are real.

You should not ignore them.

But tooling should inform architecture, not dominate it.

### Bad Reasoning

> “The generator produces nicer Java if we design the API this way.”

### Better Reasoning

> “The contract should be clear and stable. Then we evaluate which generation strategy can support it safely.”

### Practical Approach

When tool constraints appear:

1. Identify whether the issue is contract-level or tooling-level.
2. Avoid weakening the public contract for internal convenience.
3. Consider generator configuration.
4. Consider custom templates.
5. Consider handwritten clients for critical APIs.
6. Consider simpler contract design if semantic clarity is preserved.
7. Document known tooling limitations.

### Rule

Optimize the contract for consumers first.

Optimize generation second.

---

## 19. Anti-Pattern #18 — Public API Treated Like Internal API

### Symptom

A partner/public API changes casually:

- fields renamed,
- enum values changed,
- response structures reshaped,
- errors changed,
- auth behavior changed,
- deprecated endpoints removed abruptly,
- generated SDK regenerated without migration notes.

### Why It Is Dangerous

External consumers have slower upgrade cycles.

They may have:

- release windows,
- certification processes,
- regulatory approval,
- mobile app store delays,
- partner integration contracts,
- limited observability,
- generated code checked into internal repos.

Your “small change” can become their incident.

### Public API Requires

- strict versioning,
- deprecation policy,
- sunset timeline,
- migration guide,
- changelog,
- compatibility testing,
- communication plan,
- stable operation IDs,
- stable generated SDK versioning,
- support channel.

### Rule

The more external the API, the more conservative the evolution model.

---

## 20. Anti-Pattern #19 — Internal API Treated Like No-Contract API

### Symptom

The team says:

> “It is internal, so we do not need a proper OpenAPI contract.”

### Why It Is Dangerous

Internal APIs often have more consumers than public APIs.

They are used by:

- frontend apps,
- mobile apps,
- other services,
- data pipelines,
- QA automation,
- admin tools,
- workflow engines,
- reporting tools,
- platform tooling.

Internal does not mean low impact.

It means the consumers are inside your organization.

### Better Distinction

Use different governance levels:

```text
Experimental internal API:
    lightweight contract
    unstable lifecycle allowed

Production internal API:
    reviewed contract
    breaking-change detection
    ownership metadata

External/partner API:
    stricter compatibility
    deprecation policy
    formal communication
```

### Rule

Do not ask whether the API is internal.

Ask:

> “Who depends on this API, and how expensive is breakage?”

---

## 21. Anti-Pattern #20 — Version Number Theatre

### Symptom

The `info.version` changes, but the API compatibility story is unclear.

```yaml
info:
  version: 2.0.0
```

But:

- path stays the same,
- clients are not notified,
- old behavior disappears,
- generated SDK versions are unrelated,
- gateway routes are unchanged,
- docs do not explain migration.

### Why It Is Dangerous

Version numbers alone do not protect consumers.

A meaningful versioning strategy must define:

- what changes require major version,
- whether path versioning is used,
- whether media type versioning is used,
- whether clients can choose versions,
- how long old versions are supported,
- how deprecation is announced,
- how SDK versions map to API versions,
- how compatibility is tested.

### Better Contract Metadata

```yaml
info:
  title: Enforcement Case API
  version: 1.6.0
x-api-versioning:
  strategy: semantic-contract-versioning
  compatibility: backward-compatible-with-1.x
  deprecationPolicy: 180-days-minimum
```

### Rule

Version is not a strategy.

Version is a label attached to a strategy.

---

## 22. Anti-Pattern #21 — Hidden Defaults

### Symptom

The API has defaults that are not documented.

Examples:

- default page size,
- maximum page size,
- default sort order,
- default date range,
- default filtering behavior,
- default inclusion/exclusion of archived records,
- default locale,
- default timezone,
- default currency,
- default authorization scope behavior.

### Why It Is Dangerous

Hidden defaults cause consumers to depend on behavior they do not understand.

Later, changing a default becomes a breaking change even though no schema changed.

### Example

```text
GET /cases
```

Originally returns open cases only.

Later, it returns open and under-review cases.

The schema did not change.

But dashboards, reports, and workflows may break.

### Better Documentation

```yaml
parameters:
  - name: includeClosed
    in: query
    required: false
    schema:
      type: boolean
      default: false
    description: |
      When false or omitted, closed cases are excluded.
      This default is part of the compatibility contract.
```

### Rule

Document defaults as contract.

A hidden default is hidden coupling.

---

## 23. Anti-Pattern #22 — Field Semantics Hidden in Description Only

### Symptom

Important machine-readable constraints are written only in prose.

Bad example:

```yaml
amount:
  type: number
  description: Must be positive and have at most two decimal places.
```

Better:

```yaml
amount:
  type: number
  exclusiveMinimum: 0
  multipleOf: 0.01
  description: Monetary amount in the specified currency.
```

### Why It Is Dangerous

Prose is useful for humans but weak for automation.

If constraints are not machine-readable:

- validators cannot enforce them,
- generated clients cannot reflect them,
- tests cannot derive them,
- mock data may violate them,
- diff tools may miss changes.

### Rule

Use schema keywords for structural constraints.

Use descriptions for semantic explanation.

Do not use prose as a substitute for machine-readable contract.

---

## 24. Anti-Pattern #23 — Enum Abuse

### Symptom

Enums are used for volatile business configuration.

Example:

```yaml
CaseCategory:
  type: string
  enum:
    - FINANCIAL_MISCONDUCT
    - LICENSING_VIOLATION
    - FRAUD
    - MARKET_ABUSE
```

This seems reasonable until business adds categories monthly.

### Why It Is Dangerous

Enums are often compiled into generated clients.

Adding an enum value may break consumers that use exhaustive switch statements.

Removing or renaming values is clearly breaking.

Even adding values can be operationally breaking.

### Better Options

Use enum when the value set is stable and protocol-like:

- lifecycle states,
- fixed status values,
- known permission grant types,
- finite protocol modes.

Use reference data when values change frequently:

```yaml
categoryCode:
  type: string
  description: |
    Case category code. Valid values are managed as reference data and can be retrieved from GET /reference-data/case-categories.
```

### Rule

Do not use OpenAPI enum for business values that product or policy teams change regularly.

---

## 25. Anti-Pattern #24 — Vague `additionalProperties`

### Symptom

Object schemas allow arbitrary fields without intent.

```yaml
metadata:
  type: object
```

In many JSON Schema contexts, this can mean arbitrary object contents unless constrained.

### Why It Is Dangerous

Unconstrained maps become junk drawers.

Consumers put important data there.

Providers return undocumented fields there.

Validation becomes weak.

Generated clients use `Map<String, Object>`.

Compatibility becomes unclear.

### Better Version

If it is a string map:

```yaml
metadata:
  type: object
  additionalProperties:
    type: string
```

If arbitrary extension metadata is intentional:

```yaml
metadata:
  type: object
  additionalProperties: true
  description: |
    Consumer-defined metadata. The server stores and returns keys without interpreting them.
    Keys beginning with `system.` are reserved.
```

If unknown fields should not be allowed:

```yaml
additionalProperties: false
```

### Rule

Every extensible object needs an extension policy.

---

## 26. Anti-Pattern #25 — Nullable Confusion

### Symptom

The spec does not clearly distinguish:

- field absent,
- field present with null,
- field present with empty string,
- field present with empty array,
- field present with default value.

### Why It Is Dangerous

Nullable behavior affects:

- JSON serialization,
- Java boxed vs primitive types,
- Jackson inclusion rules,
- generated TypeScript clients,
- validation,
- PATCH semantics,
- database updates,
- UI display logic,
- compatibility.

### Example Failure

For PATCH:

```json
{
  "assignedOfficerId": null
}
```

Does that mean:

- clear assignment?
- ignore assignment?
- invalid request?
- set to unknown?

If not documented, consumers guess.

### Better Documentation

```yaml
assignedOfficerId:
  type:
    - string
    - 'null'
  description: |
    On PATCH, null explicitly clears the assignment.
    If the field is omitted, the existing assignment is unchanged.
```

### Rule

Absence and null are different contract states.

Document them explicitly.

---

## 27. Anti-Pattern #26 — Response Envelope Inconsistency

### Symptom

List endpoints use inconsistent shapes.

Endpoint A:

```json
[
  { "id": "case-1" }
]
```

Endpoint B:

```json
{
  "items": [
    { "id": "case-1" }
  ],
  "total": 100
}
```

Endpoint C:

```json
{
  "data": [
    { "id": "case-1" }
  ],
  "page": 1
}
```

### Why It Is Dangerous

Consumers cannot reuse pagination logic.

Generated clients produce inconsistent response models.

Documentation becomes harder.

Cross-service API style fragments.

### Better Standard

```yaml
CaseListResponse:
  type: object
  required: [items, page]
  properties:
    items:
      type: array
      items:
        $ref: '#/components/schemas/CaseSummary'
    page:
      $ref: '#/components/schemas/PageMetadata'
```

Or cursor-based:

```yaml
CaseCursorPage:
  type: object
  required: [items, pageInfo]
  properties:
    items:
      type: array
      items:
        $ref: '#/components/schemas/CaseSummary'
    pageInfo:
      $ref: '#/components/schemas/CursorPageInfo'
```

### Rule

List response shapes should be standardized unless there is a strong reason not to.

---

## 28. Anti-Pattern #27 — Search Grammar Hidden in a String

### Symptom

The API exposes a query parameter like this:

```yaml
- name: q
  in: query
  schema:
    type: string
  description: Search query.
```

But the actual grammar supports:

```text
status:OPEN assignedTo:me createdAt>2025-01-01 sort:-createdAt
```

### Why It Is Dangerous

The query language is part of the API contract.

If undocumented:

- consumers build invalid queries,
- backend changes grammar accidentally,
- injection risks increase,
- test coverage is weak,
- generated docs are useless.

### Better Contract

At minimum:

```yaml
- name: q
  in: query
  schema:
    type: string
  description: |
    Search expression.

    Supported filters:
    - status:<OPEN|UNDER_REVIEW|CLOSED>
    - assignedTo:<userId|me>
    - createdAt>YYYY-MM-DD
    - createdAt<YYYY-MM-DD

    Terms are combined with implicit AND.
```

For complex cases, define a structured request body search endpoint instead:

```text
POST /case-searches
```

with a typed schema.

### Rule

A string that contains a mini-language must have a contract for that mini-language.

---

## 29. Anti-Pattern #28 — Gateway and Spec Mismatch

### Symptom

The OpenAPI spec describes backend behavior, but the API gateway modifies requests/responses.

Examples:

- gateway strips headers,
- gateway injects tenant ID,
- gateway enforces rate limits,
- gateway changes error body,
- gateway transforms paths,
- gateway validates request differently,
- gateway blocks content types,
- gateway adds auth requirements.

### Why It Is Dangerous

Consumers interact with the gateway-facing API, not the backend controller.

If the contract documents the backend but runtime exposes the gateway behavior, the contract is wrong.

### Better Approach

Distinguish:

```text
Internal service contract
External gateway-facing contract
```

Sometimes they are the same.

Often they are not.

Gateway policies that affect consumers should be visible in the API contract or companion policy documentation:

- auth,
- rate limits,
- request size limits,
- content type restrictions,
- timeout behavior,
- error envelope,
- headers,
- correlation IDs.

### Rule

Document the API as consumed, not merely as implemented.

---

## 30. Anti-Pattern #29 — Documentation Without Narrative

### Symptom

Swagger UI renders operations and schemas, but no one understands the workflow.

There is no explanation of:

- lifecycle,
- sequence,
- state transitions,
- role-specific behavior,
- retry strategy,
- conflict resolution,
- async processing,
- migration path,
- business constraints.

### Why It Is Dangerous

API consumers need more than endpoint inventory.

They need usage understanding.

For workflow-heavy systems, endpoints are not independent.

Example enforcement lifecycle:

```text
create complaint
    ↓
triage complaint
    ↓
open case
    ↓
assign investigator
    ↓
collect evidence
    ↓
issue finding
    ↓
apply enforcement action
    ↓
handle appeal
    ↓
close case
```

A list of endpoints does not explain this.

### Better Documentation Model

Combine OpenAPI with narrative docs:

- lifecycle overview,
- common flows,
- sequence diagrams,
- state transition rules,
- example scenarios,
- error handling guide,
- migration notes,
- role/permission matrix.

OpenAPI is necessary.

It is not always sufficient.

---

## 31. Case Study 1 — Mobile App Breakage From Enum Expansion

### Scenario

Backend has:

```yaml
CaseStatus:
  type: string
  enum:
    - OPEN
    - UNDER_REVIEW
    - CLOSED
```

Mobile app generates enum types and uses exhaustive switch logic:

```kotlin
when (status) {
    OPEN -> showOpen()
    UNDER_REVIEW -> showReview()
    CLOSED -> showClosed()
}
```

Backend adds:

```text
ESCALATED
```

No path changed.

No field changed.

Only enum value added.

### Failure

Older mobile app fails to parse or crashes.

### Root Cause

The team classified enum addition as safe.

But for generated clients and exhaustive switches, it was not operationally safe.

### Prevention

Options:

1. Document enum forward-compatibility expectation.
2. Provide `UNKNOWN` fallback in clients.
3. Avoid enum for volatile status values.
4. Use SDK generation config that tolerates unknown values.
5. Treat enum expansion as risky and require consumer impact review.
6. Use staged rollout.

### Lesson

Schema-additive is not always consumer-safe.

---

## 32. Case Study 2 — Generated SDK Breakage From `operationId` Change

### Scenario

Old spec:

```yaml
operationId: getCaseById
```

Generated Java client:

```java
caseApi.getCaseById(caseId)
```

New spec generated from renamed controller method:

```yaml
operationId: findCase
```

Generated Java client:

```java
caseApi.findCase(caseId)
```

### Failure

No HTTP behavior changed.

But client code no longer compiles after SDK upgrade.

### Root Cause

`operationId` was treated as cosmetic.

### Prevention

- stable operation ID linting,
- operation ID diff gate,
- manual operation ID annotation,
- no framework-generated operation IDs in production contracts,
- generated SDK compatibility tests.

### Lesson

Tooling-facing identifiers are part of the contract.

---

## 33. Case Study 3 — Partner Integration Failure From Hidden Pagination Default

### Scenario

`GET /cases` returns 20 records by default.

Default is undocumented.

Partner integration assumes all records are returned.

Later backend changes default to 50.

Partner reconciliation logic changes unexpectedly.

### Failure

Partner system duplicates processing and misses records under certain timing conditions.

### Root Cause

Pagination was implicit.

The partner did not know they had to follow pagination metadata.

### Prevention

Document:

- default page size,
- max page size,
- cursor behavior,
- stable sort order,
- next-page mechanism,
- empty page semantics.

Also make list response envelope unavoidable:

```json
{
  "items": [],
  "pageInfo": {
    "nextCursor": null,
    "hasNextPage": false
  }
}
```

### Lesson

Pagination is not a performance detail.

It is a contract.

---

## 34. Case Study 4 — Compliance Evidence Gap From Undocumented Redaction

### Scenario

A regulated case API returns different fields depending on caller role.

Officer response includes:

```json
{
  "caseId": "case-123",
  "subjectName": "Jane Doe",
  "internalRiskScore": 0.87
}
```

External complainant response includes:

```json
{
  "caseId": "case-123",
  "subjectName": "REDACTED"
}
```

The OpenAPI spec documents only one response schema.

### Failure

Audit asks:

> “Where is the redaction behavior specified, approved, tested, and released?”

The team has implementation logic but no contract evidence.

### Root Cause

OpenAPI was treated as developer documentation, not evidence.

### Prevention

Document role-specific visibility:

- separate schemas,
- description of redaction policy,
- `x-data-classification`,
- examples per role,
- tests linked to contract,
- authorization matrix.

### Lesson

In high-risk systems, undocumented behavior may be indefensible even if implementation is correct.

---

## 35. Case Study 5 — Gateway Error Drift

### Scenario

Backend returns Problem Details:

```json
{
  "type": "https://api.example.gov/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "violations": []
}
```

Spec documents that shape.

But gateway rejects oversized requests before they reach backend and returns:

```json
{
  "message": "Request Entity Too Large"
}
```

### Failure

Clients have generic problem parser but fail on gateway errors.

### Root Cause

The spec documented backend errors, not consumer-visible errors.

### Prevention

Include gateway-originated errors in public API contract:

- `413 Payload Too Large`,
- `429 Too Many Requests`,
- `401/403` gateway auth failures,
- timeout errors,
- request validation failures.

### Lesson

The contract must describe the edge behavior seen by consumers.

---

## 36. Practical Diagnostic Checklist

Use this checklist when reviewing an OpenAPI document.

### 36.1 Basic Contract Quality

Ask:

- Does every operation have a stable `operationId`?
- Does every operation have meaningful summary and description?
- Are non-200 responses documented?
- Are request and response schemas explicit?
- Are examples valid and realistic?
- Are parameters serialized clearly?
- Are defaults documented?
- Are nullable semantics clear?

### 36.2 Schema Quality

Ask:

- Are schemas named by API role rather than Java class?
- Are request and response schemas separated where needed?
- Are constraints machine-readable?
- Are enums stable enough to be enums?
- Is `additionalProperties` intentional?
- Is polymorphism unambiguous?
- Are deprecated fields marked?
- Are read-only/write-only fields correct?

### 36.3 Compatibility Quality

Ask:

- Can breaking changes be detected?
- Are operation IDs stable?
- Are enum changes reviewed?
- Are required/optional changes controlled?
- Are constraints tightening reviewed?
- Are response shape changes reviewed?
- Are generated SDKs tested?
- Is deprecation lifecycle documented?

### 36.4 Runtime Alignment

Ask:

- Is implementation validated against spec?
- Are gateway behaviors reflected?
- Are exception handlers aligned with documented errors?
- Are content types accurate?
- Are auth requirements enforced as documented?
- Are examples tested against schema?
- Are deployed environments consistent?

### 36.5 Governance Quality

Ask:

- Is there an owner?
- Is lifecycle stage known?
- Is data classification documented?
- Is review required for sensitive APIs?
- Are style rules enforced automatically?
- Are exceptions documented?
- Is API catalog metadata present?
- Are consumers known?

---

## 37. OpenAPI Smell Catalogue

A smell is not always a bug.

It is a signal that deeper review is needed.

### Smell: Every response is `200`

Likely issue:

- poor error modelling,
- weak consumer guidance.

### Smell: Every schema ends with `Dto`

Likely issue:

- code-centric contract,
- DTO dump,
- implementation leakage.

### Smell: One schema reused everywhere

Likely issue:

- over-reuse,
- request/response coupling,
- poor lifecycle separation.

### Smell: No examples

Likely issue:

- poor onboarding,
- weak test fixtures,
- hard mock generation.

### Smell: Examples do not validate

Likely issue:

- stale documentation,
- untrusted contract.

### Smell: No `operationId`

Likely issue:

- unstable generated clients,
- poor automation.

### Smell: `Map<String, Object>` everywhere

Likely issue:

- weak schema constraints,
- undocumented extension model.

### Smell: `string` everywhere

Likely issue:

- missing formats,
- weak validation,
- poor domain precision.

### Smell: Security only documented globally

Likely issue:

- operation-specific authorization unclear,
- public/protected boundaries vague.

### Smell: No owner/contact

Likely issue:

- orphaned API,
- weak governance.

### Smell: Spec generated only at runtime

Likely issue:

- no release artifact,
- no diff baseline,
- contract drift risk.

---

## 38. Failure Mode Map

| Failure Mode | Visible Symptom | Hidden Cause | Prevention |
|---|---|---|---|
| Consumer cannot integrate | Docs render but behavior unclear | Missing examples/errors/defaults | Examples, error model, narrative docs |
| SDK breaks after harmless change | Client method or enum changes | Operation ID/enum instability | Diff gates, SDK tests |
| Runtime differs from spec | Tests pass but production surprises | No provider validation | Contract tests, deployed validation |
| Sensitive data exposed | Unexpected fields in response | Entity/DTO leakage | API-specific schemas, review |
| Breaking change missed | Schema diff passes | Semantic behavior changed | Human review, semantic checklist |
| Gateway errors inconsistent | Client parser fails | Edge behavior undocumented | Gateway-facing contract |
| API impossible to govern | No owner/lifecycle | Missing metadata | Catalog + ownership extensions |
| Long-term evolution painful | Everything reused | Coupled schemas | Role-specific schemas |
| Documentation untrusted | Examples invalid | No example validation | CI example validation |
| Authorization misunderstood | 403/404 behavior unclear | Auth rules absent from contract | Security descriptions + policy links |

---

## 39. Review Questions for Tech Leads

When reviewing an OpenAPI PR, ask:

1. What consumer capability is being introduced or changed?
2. Is this contract written from the consumer perspective?
3. What behavior is intentionally not documented, and why?
4. Can this change break generated clients?
5. Can this change break old mobile or partner clients?
6. Are examples valid and useful?
7. Are error cases documented?
8. Are security expectations clear?
9. Are defaults and implicit behaviors documented?
10. Are schema constraints machine-readable?
11. Are request and response models separated correctly?
12. Are we leaking internal implementation details?
13. Is the API gateway behavior aligned?
14. Is this change compatible with existing consumers?
15. If this is breaking, where is the migration path?

These questions are more valuable than checking whether YAML indentation is correct.

---

## 40. Practical Remediation Strategy

If you inherit a poor OpenAPI portfolio, do not try to fix everything at once.

Use risk-based remediation.

### Step 1 — Inventory

List APIs by:

- owner,
- lifecycle,
- consumers,
- external/internal status,
- data sensitivity,
- business criticality,
- generated SDK usage,
- incident history.

### Step 2 — Classify Risk

High-risk APIs:

- external partner APIs,
- mobile APIs,
- regulated data APIs,
- payment/financial APIs,
- identity/security APIs,
- workflow/state transition APIs,
- APIs with many consumers.

### Step 3 — Add Basic Gates

Start with:

- OpenAPI validation,
- operation ID uniqueness,
- no undocumented 2xx-only operations,
- required owner metadata,
- no invalid examples,
- breaking-change diff.

### Step 4 — Standardize Shared Patterns

Define reusable standards for:

- errors,
- pagination,
- auth,
- rate limits,
- correlation IDs,
- deprecation,
- examples,
- naming.

### Step 5 — Fix Highest-Impact Specs

Prioritize:

- public APIs,
- high-consumer APIs,
- APIs with generated SDKs,
- APIs with sensitive data,
- APIs with frequent changes.

### Step 6 — Introduce Review Workflow

Do not rely only on linting.

Linting catches structural issues.

Humans catch semantic risks.

### Step 7 — Connect Contract to Tests

Provider tests should verify that runtime behavior matches the OpenAPI contract.

Contract without tests can drift.

Tests without contract can encode accidental behavior.

You need both.

---

## 41. The Top 1% OpenAPI Review Mindset

A weak reviewer asks:

> “Is the spec valid?”

A stronger reviewer asks:

> “Does it render nicely?”

A very strong reviewer asks:

> “Can a consumer safely build against this?”

A top 1% reviewer asks:

> “Can this contract survive real evolution, real tooling, real failures, real governance, real consumers, and real audits?”

That is the bar.

---

## 42. Summary

OpenAPI anti-patterns usually arise from one of five root causes:

1. treating OpenAPI as documentation instead of contract,
2. letting implementation structure leak into API surface,
3. trusting tools without review,
4. ignoring consumer impact,
5. failing to connect contract to runtime behavior.

The most dangerous specs are not obviously broken.

They are valid, generated, documented, and published — but misleading.

To avoid that, a mature OpenAPI practice needs:

- consumer-first operation design,
- clear schemas,
- stable operation IDs,
- explicit errors,
- valid examples,
- controlled reuse,
- careful compatibility analysis,
- runtime validation,
- governance metadata,
- ownership,
- consumer impact review,
- and disciplined evolution.

The goal is not beautiful YAML.

The goal is a contract that consumers, providers, tools, tests, reviewers, and auditors can trust.

---

## 43. Part 028 Completion Marker

You have completed:

```text
Part 028 — OpenAPI Anti-Patterns and Failure Modes in Real Projects
```

You should now be able to:

- identify valid-but-dangerous OpenAPI specs,
- detect DTO/entity leakage,
- recognize schema reuse problems,
- spot weak error contracts,
- evaluate `operationId` stability,
- assess runtime drift risk,
- reason about generated SDK failure modes,
- distinguish internal API from no-contract API,
- review OpenAPI PRs with consumer-impact thinking,
- and build a remediation plan for existing API portfolios.

Next part:

```text
Part 029 — Building a Production-Grade OpenAPI from Scratch: End-to-End Case Study
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-027.md">⬅️ OpenAPI Mastery for Java Engineers — Part 027</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-029.md">Part 029 — Building a Production-Grade OpenAPI from Scratch: End-to-End Case Study ➡️</a>
</div>
