# OpenAPI Mastery for Java Engineers — Part 030

# OpenAPI Mastery Capstone: Designing an Enforcement Lifecycle API Contract

> File: `learn-openapi-mastery-for-java-engineers-part-030.md`  
> Series: OpenAPI Mastery for Java Engineers  
> Part: 030 / 030  
> Status: Final Part  
> Focus: capstone design, enforcement lifecycle API, regulatory defensibility, state machine modelling, contract governance

---

## 0. Why This Capstone Exists

Part 030 is the synthesis of the whole series.

Up to this point, we have studied OpenAPI as:

- a machine-readable HTTP API description,
- a contract between provider and consumer,
- a schema and validation model,
- a Java integration artifact,
- a testing oracle,
- a CI/CD asset,
- a governance tool,
- an audit and compliance artifact.

This capstone applies all of that to a deliberately hard domain: **enforcement lifecycle case management**.

This is not a toy CRUD API.

A realistic enforcement API has:

- long-running lifecycle state,
- sensitive records,
- multiple actors,
- role and entitlement boundaries,
- audit obligations,
- evidence handling,
- document upload/download,
- decisions,
- appeals,
- escalation,
- redaction,
- conflict resolution,
- immutable history,
- external review,
- regulatory deadlines,
- public/private data boundaries,
- strict change control.

That makes it a perfect final exercise for OpenAPI mastery.

The objective is not to produce one perfect final YAML file. The objective is to learn how a senior engineer thinks when turning a complex lifecycle into an API contract that can survive real use.

---

## 1. Capstone Scenario

We will design an API for an enforcement agency or regulated organization that manages enforcement cases from intake through closure.

Example domain:

A complaint is received. It may become an investigation. Investigators collect evidence, identify subjects, record allegations, make findings, issue enforcement actions, support appeals, and eventually close the case. Some data is internal only. Some may be disclosed. Some may need redaction. Every important state transition must be auditable.

The API is consumed by:

- internal case management UI,
- investigator tools,
- supervisor dashboard,
- legal review system,
- external partner integration,
- audit/reporting pipeline,
- document management service,
- notification service,
- public disclosure portal.

We assume HTTP APIs documented with OpenAPI 3.2.x as the strategic contract baseline, while being aware that actual tooling may still require 3.1 or 3.0 compatibility in some organizations.

---

## 2. System Boundary

Before writing OpenAPI, define the boundary.

A weak API design starts with endpoints.

A strong API design starts with responsibility.

### 2.1 What This API Owns

The Enforcement Case API owns:

- case lifecycle state,
- allegations attached to a case,
- subjects attached to a case,
- evidence metadata attached to a case,
- findings and decisions,
- enforcement actions,
- appeal records,
- audit timeline exposed to authorized users,
- redaction/disclosure workflow metadata,
- state transition commands.

### 2.2 What This API Does Not Own

It does not directly own:

- binary file storage internals,
- identity provider internals,
- notification delivery internals,
- analytics warehouse schema,
- legal document rendering engine,
- external payment processing,
- public website rendering.

It may integrate with those systems, but the OpenAPI contract must not leak their internal implementation.

### 2.3 Boundary Rule

A good enforcement API contract says:

> “Here are the stable capabilities and representations available to consumers.”

It must not say:

> “Here is our database schema, workflow engine internals, storage bucket layout, and Java class model.”

---

## 3. Domain Model: Contract-Level Concepts

The API contract should expose concepts that are meaningful to consumers.

### 3.1 Core Resources

| Resource | Meaning | Stability |
|---|---|---|
| `Case` | Central enforcement lifecycle aggregate | Very stable |
| `Complaint` | Intake artifact that may initiate a case | Stable |
| `Subject` | Person/entity under review | Stable but sensitive |
| `Allegation` | Claimed violation or issue | Stable |
| `EvidenceItem` | Metadata for evidence | Stable |
| `Finding` | Determination about allegation | Stable |
| `EnforcementAction` | Formal action or remedy | Stable |
| `Appeal` | Challenge/review of decision/action | Stable |
| `AuditEvent` | Immutable lifecycle/event record | Stable |
| `DisclosurePackage` | Public/external disclosure unit | Context-dependent |
| `RedactionTask` | Redaction workflow item | Context-dependent |

### 3.2 Contract-Level Aggregate Boundary

The `Case` is the main aggregate from the API consumer perspective.

But that does not mean every operation should return the entire case with all related records.

A common mistake:

```text
GET /cases/{caseId}
returns everything:
- subjects
- allegations
- evidence
- notes
- documents
- decisions
- appeals
- audit history
- internal assignments
- raw workflow variables
```

This creates:

- performance risk,
- accidental data exposure,
- authorization complexity,
- incompatible evolution,
- giant generated models,
- consumer over-coupling.

A better pattern:

```text
GET /cases/{caseId}
GET /cases/{caseId}/subjects
GET /cases/{caseId}/allegations
GET /cases/{caseId}/evidence
GET /cases/{caseId}/findings
GET /cases/{caseId}/actions
GET /cases/{caseId}/appeals
GET /cases/{caseId}/timeline
```

The case summary remains stable. Related collections have their own contracts.

---

## 4. Lifecycle State Machine

OpenAPI does not execute a state machine. But it can document and constrain the API surface through which transitions happen.

### 4.1 Candidate Case States

```text
DRAFT
INTAKE_RECEIVED
INTAKE_SCREENING
SCREENED_OUT
INVESTIGATION_OPEN
EVIDENCE_COLLECTION
LEGAL_REVIEW
DECISION_PENDING
DECISION_ISSUED
ACTION_PENDING
ACTION_ACTIVE
APPEAL_OPEN
APPEAL_DECIDED
CLOSED
REOPENED
```

### 4.2 Why State Names Matter

State names become external contract.

If a consumer sees:

```json
{
  "status": "LEGAL_REVIEW"
}
```

that value may be used in:

- UI branching,
- partner integration,
- reporting,
- generated SDK enums,
- workflow automation,
- access-control rules,
- audit interpretation.

Changing it later is not trivial.

### 4.3 State Exposure Rule

Expose states that are meaningful to consumers.

Do not expose internal workflow engine node names like:

```text
ACT_982_WAIT_SUPERVISOR_REVIEW_V2
CAMUNDA_TASK_17B
WF_LEGAL_QA_HOLD_INTERNAL
```

Use stable public lifecycle states and keep internal workflow state behind the boundary.

### 4.4 Transition Commands

Avoid allowing arbitrary status update:

```http
PATCH /cases/{caseId}
{
  "status": "DECISION_ISSUED"
}
```

This is dangerous because it hides business semantics.

Prefer explicit transition commands:

```http
POST /cases/{caseId}:submit-intake
POST /cases/{caseId}:open-investigation
POST /cases/{caseId}:submit-for-legal-review
POST /cases/{caseId}:issue-decision
POST /cases/{caseId}:close
POST /cases/{caseId}:reopen
```

This makes the contract reveal real capabilities.

### 4.5 Command Endpoint Style

There are two common styles.

Colon action style:

```text
POST /cases/{caseId}:close
```

Subresource command style:

```text
POST /cases/{caseId}/closure-requests
```

Both can work. The key is consistency.

For this capstone, we use a hybrid:

- lifecycle commands use colon style for explicit transitions,
- long-running/reviewable processes use subresources.

Example:

```text
POST /cases/{caseId}:close
POST /cases/{caseId}/appeals
POST /cases/{caseId}/redaction-tasks
POST /cases/{caseId}/disclosure-packages
```

---

## 5. Actors and Authorization Boundary

OpenAPI can document authentication and security requirements, but object-level authorization is still application logic.

### 5.1 Actors

| Actor | Typical Capabilities |
|---|---|
| Intake Officer | Create complaint, screen intake |
| Investigator | Manage investigation, evidence, allegations |
| Supervisor | Assign, escalate, approve transitions |
| Legal Reviewer | Review findings/actions |
| Enforcement Officer | Issue actions |
| Appeals Officer | Manage appeal lifecycle |
| Auditor | Read immutable timeline |
| External Partner | Submit or retrieve limited records |
| Public Portal | Access redacted disclosure package |

### 5.2 Security Schemes

Possible OpenAPI security schemes:

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
    oauth2:
      type: oauth2
      flows:
        authorizationCode:
          authorizationUrl: https://auth.example.gov/oauth2/authorize
          tokenUrl: https://auth.example.gov/oauth2/token
          scopes:
            cases:read: Read cases
            cases:write: Modify cases
            cases:decide: Issue decisions
            evidence:write: Manage evidence metadata
            audit:read: Read audit timeline
            disclosure:publish: Publish disclosure packages
```

### 5.3 Authorization Caveat

Scopes are not enough.

A token with `cases:read` may still not be allowed to read every case.

Object-level rules may depend on:

- assigned region,
- case classification,
- conflict-of-interest restrictions,
- sealed/protected status,
- subject relationship,
- investigation team membership,
- legal privilege,
- disclosure embargo,
- jurisdiction.

Document this clearly in operation descriptions and error models.

Example:

```yaml
description: >
  Returns the case summary if the caller has case-level access. A caller with
  cases:read scope may still receive 403 if they are not assigned to the case,
  the case is sealed, or jurisdictional access rules deny access.
```

---

## 6. API Capability Map

A capability map is a bridge between product/domain requirements and OpenAPI operations.

### 6.1 Case Lifecycle

| Capability | Operation |
|---|---|
| Create case from intake | `POST /cases` |
| Get case summary | `GET /cases/{caseId}` |
| Search cases | `GET /cases` |
| Submit intake | `POST /cases/{caseId}:submit-intake` |
| Open investigation | `POST /cases/{caseId}:open-investigation` |
| Submit legal review | `POST /cases/{caseId}:submit-for-legal-review` |
| Issue decision | `POST /cases/{caseId}:issue-decision` |
| Close case | `POST /cases/{caseId}:close` |
| Reopen case | `POST /cases/{caseId}:reopen` |

### 6.2 Subjects and Allegations

| Capability | Operation |
|---|---|
| List subjects | `GET /cases/{caseId}/subjects` |
| Add subject | `POST /cases/{caseId}/subjects` |
| Update subject role/classification | `PATCH /cases/{caseId}/subjects/{subjectId}` |
| List allegations | `GET /cases/{caseId}/allegations` |
| Add allegation | `POST /cases/{caseId}/allegations` |
| Update allegation | `PATCH /cases/{caseId}/allegations/{allegationId}` |

### 6.3 Evidence

| Capability | Operation |
|---|---|
| List evidence metadata | `GET /cases/{caseId}/evidence` |
| Register evidence item | `POST /cases/{caseId}/evidence` |
| Get evidence metadata | `GET /cases/{caseId}/evidence/{evidenceId}` |
| Request upload URL | `POST /cases/{caseId}/evidence/{evidenceId}:create-upload-url` |
| Mark evidence received | `POST /cases/{caseId}/evidence/{evidenceId}:mark-received` |
| Download evidence | `GET /cases/{caseId}/evidence/{evidenceId}/content` |

### 6.4 Decisions and Actions

| Capability | Operation |
|---|---|
| Create finding | `POST /cases/{caseId}/findings` |
| List findings | `GET /cases/{caseId}/findings` |
| Issue enforcement action | `POST /cases/{caseId}/actions` |
| List actions | `GET /cases/{caseId}/actions` |
| Update action status | `POST /cases/{caseId}/actions/{actionId}:update-status` |

### 6.5 Appeals

| Capability | Operation |
|---|---|
| Submit appeal | `POST /cases/{caseId}/appeals` |
| List appeals | `GET /cases/{caseId}/appeals` |
| Get appeal | `GET /cases/{caseId}/appeals/{appealId}` |
| Decide appeal | `POST /cases/{caseId}/appeals/{appealId}:decide` |

### 6.6 Audit, Disclosure, and Redaction

| Capability | Operation |
|---|---|
| Read case timeline | `GET /cases/{caseId}/timeline` |
| Create redaction task | `POST /cases/{caseId}/redaction-tasks` |
| List redaction tasks | `GET /cases/{caseId}/redaction-tasks` |
| Create disclosure package | `POST /cases/{caseId}/disclosure-packages` |
| Publish disclosure package | `POST /cases/{caseId}/disclosure-packages/{packageId}:publish` |
| Retrieve public package | `GET /public/disclosure-packages/{packageId}` |

---

## 7. OpenAPI Skeleton

A compact but realistic top-level skeleton:

```yaml
openapi: 3.2.0
info:
  title: Enforcement Case API
  version: 1.0.0
  summary: Contract for managing enforcement lifecycle cases.
  description: >
    API for case intake, investigation, evidence metadata, findings,
    enforcement actions, appeals, audit timeline, redaction, and disclosure.
servers:
  - url: https://api.example.gov/enforcement/v1
    description: Production
  - url: https://sandbox-api.example.gov/enforcement/v1
    description: Sandbox
security:
  - oauth2:
      - cases:read
paths:
  /cases:
    get:
      operationId: searchCases
      tags: [Cases]
      summary: Search enforcement cases
      parameters:
        - $ref: '#/components/parameters/PageSize'
        - $ref: '#/components/parameters/PageCursor'
        - name: status
          in: query
          schema:
            $ref: '#/components/schemas/CaseStatus'
        - name: assignedUnitId
          in: query
          schema:
            type: string
      responses:
        '200':
          $ref: '#/components/responses/SearchCasesResponse'
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
    post:
      operationId: createCase
      tags: [Cases]
      summary: Create a new enforcement case
      security:
        - oauth2: [cases:write]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateCaseRequest'
            examples:
              complaintBased:
                $ref: '#/components/examples/CreateCaseFromComplaint'
      responses:
        '201':
          $ref: '#/components/responses/CaseCreated'
        '400':
          $ref: '#/components/responses/BadRequest'
        '409':
          $ref: '#/components/responses/Conflict'
components:
  securitySchemes:
    oauth2:
      type: oauth2
      flows:
        authorizationCode:
          authorizationUrl: https://auth.example.gov/oauth2/authorize
          tokenUrl: https://auth.example.gov/oauth2/token
          scopes:
            cases:read: Read case summaries and permitted case details
            cases:write: Create and update permitted cases
            cases:decide: Issue decisions and findings
            evidence:write: Register and manage evidence metadata
            audit:read: Read case audit timeline
            disclosure:publish: Publish disclosure packages
```

Notice that even this skeleton already communicates:

- API identity,
- version,
- environment URLs,
- default security posture,
- operations,
- reusable parameters,
- reusable responses,
- examples,
- scoped authorization.

---

## 8. Core Schemas

### 8.1 Case Status

```yaml
components:
  schemas:
    CaseStatus:
      type: string
      description: >
        Public lifecycle status of an enforcement case. Values are stable
        contract-level states and must not expose internal workflow engine nodes.
      enum:
        - DRAFT
        - INTAKE_RECEIVED
        - INTAKE_SCREENING
        - SCREENED_OUT
        - INVESTIGATION_OPEN
        - EVIDENCE_COLLECTION
        - LEGAL_REVIEW
        - DECISION_PENDING
        - DECISION_ISSUED
        - ACTION_PENDING
        - ACTION_ACTIVE
        - APPEAL_OPEN
        - APPEAL_DECIDED
        - CLOSED
        - REOPENED
```

### 8.2 Case Summary

```yaml
    CaseSummary:
      type: object
      additionalProperties: false
      required:
        - caseId
        - caseNumber
        - status
        - title
        - createdAt
        - updatedAt
        - version
      properties:
        caseId:
          type: string
          format: uuid
        caseNumber:
          type: string
          description: Human-readable stable case number.
          example: EC-2026-000184
        title:
          type: string
          minLength: 3
          maxLength: 240
        status:
          $ref: '#/components/schemas/CaseStatus'
        priority:
          $ref: '#/components/schemas/CasePriority'
        assignedUnitId:
          type: string
        leadInvestigatorId:
          type: string
        classification:
          $ref: '#/components/schemas/CaseClassification'
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
        version:
          type: integer
          minimum: 1
          description: Optimistic concurrency version.
```

### 8.3 Create Case Request

Do not reuse `CaseSummary` as create request.

Creation has different semantics.

```yaml
    CreateCaseRequest:
      type: object
      additionalProperties: false
      required:
        - title
        - intakeSource
        - classification
      properties:
        title:
          type: string
          minLength: 3
          maxLength: 240
        intakeSource:
          $ref: '#/components/schemas/IntakeSource'
        classification:
          $ref: '#/components/schemas/CaseClassification'
        complaintId:
          type: string
          format: uuid
          description: Optional complaint identifier when case is created from prior complaint intake.
        initialSummary:
          type: string
          maxLength: 5000
        requestedPriority:
          $ref: '#/components/schemas/CasePriority'
```

### 8.4 Case Detail

```yaml
    CaseDetail:
      allOf:
        - $ref: '#/components/schemas/CaseSummary'
        - type: object
          additionalProperties: false
          required:
            - lifecycle
            - links
          properties:
            lifecycle:
              $ref: '#/components/schemas/CaseLifecycleInfo'
            deadlines:
              type: array
              items:
                $ref: '#/components/schemas/CaseDeadline'
            links:
              type: object
              additionalProperties: false
              properties:
                subjects:
                  type: string
                  format: uri
                allegations:
                  type: string
                  format: uri
                evidence:
                  type: string
                  format: uri
                timeline:
                  type: string
                  format: uri
```

Be careful with `allOf`. It is acceptable here because `CaseDetail` is a structural extension of `CaseSummary`, not a Java inheritance hierarchy forced into the contract.

---

## 9. Request and Response Shapes

### 9.1 Case Created Response

```yaml
components:
  responses:
    CaseCreated:
      description: Case created.
      headers:
        Location:
          description: URL of the created case.
          schema:
            type: string
            format: uri
        ETag:
          description: Entity tag for concurrency control.
          schema:
            type: string
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/CaseDetail'
          examples:
            created:
              value:
                caseId: 018fbd76-2915-73db-b797-f56b6f1eced2
                caseNumber: EC-2026-000184
                title: Unlicensed activity investigation
                status: DRAFT
                priority: NORMAL
                assignedUnitId: UNIT-CENTRAL
                leadInvestigatorId: null
                classification: CONFIDENTIAL
                createdAt: '2026-06-20T03:14:21Z'
                updatedAt: '2026-06-20T03:14:21Z'
                version: 1
                lifecycle:
                  allowedTransitions:
                    - SUBMIT_INTAKE
                deadlines: []
                links:
                  subjects: https://api.example.gov/enforcement/v1/cases/018fbd76-2915-73db-b797-f56b6f1eced2/subjects
                  allegations: https://api.example.gov/enforcement/v1/cases/018fbd76-2915-73db-b797-f56b6f1eced2/allegations
                  evidence: https://api.example.gov/enforcement/v1/cases/018fbd76-2915-73db-b797-f56b6f1eced2/evidence
                  timeline: https://api.example.gov/enforcement/v1/cases/018fbd76-2915-73db-b797-f56b6f1eced2/timeline
```

### 9.2 Standard Error Model

Use Problem Details style.

```yaml
    Problem:
      type: object
      additionalProperties: true
      required:
        - type
        - title
        - status
        - detail
        - instance
        - traceId
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
        traceId:
          type: string
        errorCode:
          type: string
          description: Stable machine-readable application error code.
        violations:
          type: array
          items:
            $ref: '#/components/schemas/ValidationViolation'
```

### 9.3 Conflict Example

```yaml
components:
  responses:
    Conflict:
      description: Request conflicts with current resource state.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
          examples:
            invalidTransition:
              value:
                type: https://api.example.gov/problems/invalid-case-transition
                title: Invalid case transition
                status: 409
                detail: Case cannot be closed while legal review is pending.
                instance: /cases/018fbd76-2915-73db-b797-f56b6f1eced2:close
                traceId: 00-4bf92f3577b34da6a3ce929d0e0e4736
                errorCode: CASE_INVALID_TRANSITION
```

---

## 10. Lifecycle Command Design

### 10.1 Close Case Operation

```yaml
paths:
  /cases/{caseId}:close:
    post:
      operationId: closeCase
      tags: [Cases]
      summary: Close an enforcement case
      description: >
        Closes a case when all required findings, actions, appeal windows,
        and disclosure obligations are complete. The caller must have case-level
        authorization and cases:write scope. The operation is rejected with 409
        if the case is not in a closable state.
      security:
        - oauth2: [cases:write]
      parameters:
        - $ref: '#/components/parameters/CaseId'
        - $ref: '#/components/parameters/IfMatch'
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CloseCaseRequest'
      responses:
        '200':
          description: Case closed.
          headers:
            ETag:
              schema:
                type: string
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CaseDetail'
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '409':
          $ref: '#/components/responses/Conflict'
        '412':
          $ref: '#/components/responses/PreconditionFailed'
```

### 10.2 Close Case Request

```yaml
components:
  schemas:
    CloseCaseRequest:
      type: object
      additionalProperties: false
      required:
        - closureReason
        - closureSummary
      properties:
        closureReason:
          type: string
          enum:
            - NO_VIOLATION_FOUND
            - ACTION_COMPLETED
            - REFERRED_TO_OTHER_AUTHORITY
            - INSUFFICIENT_EVIDENCE
            - DUPLICATE_CASE
            - ADMINISTRATIVE_CLOSURE
        closureSummary:
          type: string
          minLength: 20
          maxLength: 5000
        effectiveDate:
          type: string
          format: date
        relatedCaseId:
          type: string
          format: uuid
          description: Required when closureReason is DUPLICATE_CASE.
```

Note the semantic rule:

> `relatedCaseId` is required when `closureReason = DUPLICATE_CASE`.

OpenAPI/JSON Schema may express conditional validation in newer schema dialects, but many tooling stacks may not enforce it consistently. For production, document the rule and enforce it in application validation too.

---

## 11. Evidence API Design

Evidence is high-risk.

Do not treat evidence as a simple file upload field.

Evidence has:

- metadata,
- classification,
- custody,
- source,
- chain of custody,
- storage state,
- virus/malware scanning status,
- redaction status,
- access restrictions,
- disclosure eligibility.

### 11.1 Evidence Metadata Schema

```yaml
components:
  schemas:
    EvidenceItem:
      type: object
      additionalProperties: false
      required:
        - evidenceId
        - caseId
        - title
        - evidenceType
        - classification
        - custodyStatus
        - createdAt
        - version
      properties:
        evidenceId:
          type: string
          format: uuid
        caseId:
          type: string
          format: uuid
        title:
          type: string
          minLength: 3
          maxLength: 240
        description:
          type: string
          maxLength: 5000
        evidenceType:
          type: string
          enum:
            - DOCUMENT
            - IMAGE
            - VIDEO
            - AUDIO
            - EMAIL
            - SYSTEM_LOG
            - INTERVIEW_NOTE
            - PHYSICAL_ITEM
            - OTHER
        classification:
          $ref: '#/components/schemas/DataClassification'
        custodyStatus:
          type: string
          enum:
            - REGISTERED
            - UPLOAD_PENDING
            - RECEIVED
            - QUARANTINED
            - VERIFIED
            - SEALED
            - RELEASED
            - RETAINED
            - DISPOSED
        source:
          type: string
          maxLength: 500
        contentHash:
          type: string
          description: Hash of the stored content when available.
        createdAt:
          type: string
          format: date-time
        version:
          type: integer
          minimum: 1
```

### 11.2 Upload URL Pattern

Avoid proxying large files through the case API unless required.

A common pattern:

1. register evidence metadata,
2. request upload URL,
3. upload binary to object/document service,
4. mark evidence received or receive async callback,
5. update evidence status.

OpenAPI operation:

```yaml
paths:
  /cases/{caseId}/evidence/{evidenceId}:create-upload-url:
    post:
      operationId: createEvidenceUploadUrl
      tags: [Evidence]
      summary: Create a short-lived upload URL for evidence content
      security:
        - oauth2: [evidence:write]
      parameters:
        - $ref: '#/components/parameters/CaseId'
        - $ref: '#/components/parameters/EvidenceId'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateEvidenceUploadUrlRequest'
      responses:
        '200':
          description: Upload URL created.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/EvidenceUploadUrl'
```

Schema:

```yaml
components:
  schemas:
    CreateEvidenceUploadUrlRequest:
      type: object
      additionalProperties: false
      required:
        - contentType
        - contentLength
      properties:
        contentType:
          type: string
          example: application/pdf
        contentLength:
          type: integer
          format: int64
          minimum: 1
        contentHash:
          type: string
          description: Optional client-computed content hash.

    EvidenceUploadUrl:
      type: object
      additionalProperties: false
      required:
        - uploadUrl
        - expiresAt
        - requiredHeaders
      properties:
        uploadUrl:
          type: string
          format: uri
        expiresAt:
          type: string
          format: date-time
        requiredHeaders:
          type: object
          additionalProperties:
            type: string
```

### 11.3 Access and Disclosure Rule

Evidence content is never automatically public just because metadata is visible.

Document separately:

- metadata access,
- content access,
- redacted content access,
- disclosure package access.

---

## 12. Findings, Decisions, and Enforcement Actions

Findings and actions are not ordinary updates.

They often have legal/regulatory effect.

### 12.1 Finding Schema

```yaml
components:
  schemas:
    Finding:
      type: object
      additionalProperties: false
      required:
        - findingId
        - allegationId
        - outcome
        - rationale
        - issuedAt
        - issuedBy
      properties:
        findingId:
          type: string
          format: uuid
        allegationId:
          type: string
          format: uuid
        outcome:
          type: string
          enum:
            - SUBSTANTIATED
            - NOT_SUBSTANTIATED
            - INCONCLUSIVE
            - WITHDRAWN
        rationale:
          type: string
          minLength: 20
          maxLength: 10000
        supportingEvidenceIds:
          type: array
          items:
            type: string
            format: uuid
        issuedAt:
          type: string
          format: date-time
        issuedBy:
          type: string
```

### 12.2 Enforcement Action Schema

```yaml
    EnforcementAction:
      type: object
      additionalProperties: false
      required:
        - actionId
        - caseId
        - actionType
        - status
        - issuedAt
      properties:
        actionId:
          type: string
          format: uuid
        caseId:
          type: string
          format: uuid
        actionType:
          type: string
          enum:
            - WARNING
            - FINE
            - LICENSE_SUSPENSION
            - LICENSE_REVOCATION
            - CORRECTIVE_ACTION_ORDER
            - REFERRAL
            - OTHER
        status:
          type: string
          enum:
            - DRAFT
            - ISSUED
            - ACTIVE
            - COMPLIED
            - OVERDUE
            - WITHDRAWN
            - SUPERSEDED
        effectiveDate:
          type: string
          format: date
        dueDate:
          type: string
          format: date
        issuedAt:
          type: string
          format: date-time
```

### 12.3 Avoiding Dangerous Mutation

Do not expose:

```http
PATCH /actions/{actionId}
{
  "status": "WITHDRAWN"
}
```

Prefer explicit operations:

```http
POST /cases/{caseId}/actions/{actionId}:withdraw
POST /cases/{caseId}/actions/{actionId}:mark-complied
POST /cases/{caseId}/actions/{actionId}:supersede
```

Why?

Because each transition may require:

- actor authorization,
- reason,
- effective date,
- audit event,
- notification,
- legal basis,
- document generation,
- downstream reporting.

---

## 13. Appeals

Appeals introduce a parallel lifecycle.

A case may be closed for investigation but still have appeal activity.

### 13.1 Appeal Schema

```yaml
components:
  schemas:
    Appeal:
      type: object
      additionalProperties: false
      required:
        - appealId
        - caseId
        - status
        - submittedAt
        - appellantType
      properties:
        appealId:
          type: string
          format: uuid
        caseId:
          type: string
          format: uuid
        actionId:
          type: string
          format: uuid
          description: Enforcement action being appealed, if applicable.
        status:
          type: string
          enum:
            - SUBMITTED
            - ACCEPTED_FOR_REVIEW
            - REJECTED_AS_INVALID
            - UNDER_REVIEW
            - ADDITIONAL_INFO_REQUESTED
            - DECIDED
            - WITHDRAWN
        appellantType:
          type: string
          enum:
            - SUBJECT
            - REPRESENTATIVE
            - THIRD_PARTY
        grounds:
          type: string
          minLength: 20
          maxLength: 10000
        submittedAt:
          type: string
          format: date-time
        decidedAt:
          type: string
          format: date-time
```

### 13.2 Decide Appeal Operation

```yaml
paths:
  /cases/{caseId}/appeals/{appealId}:decide:
    post:
      operationId: decideAppeal
      tags: [Appeals]
      summary: Decide an appeal
      security:
        - oauth2: [cases:decide]
      parameters:
        - $ref: '#/components/parameters/CaseId'
        - $ref: '#/components/parameters/AppealId'
        - $ref: '#/components/parameters/IfMatch'
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/DecideAppealRequest'
      responses:
        '200':
          description: Appeal decided.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Appeal'
        '409':
          $ref: '#/components/responses/Conflict'
        '412':
          $ref: '#/components/responses/PreconditionFailed'
```

---

## 14. Audit Timeline

Audit history is not the same as domain event streaming.

OpenAPI can expose a human/consumer-readable audit timeline.

### 14.1 Timeline Operation

```yaml
paths:
  /cases/{caseId}/timeline:
    get:
      operationId: getCaseTimeline
      tags: [Audit]
      summary: Get case audit timeline
      description: >
        Returns immutable audit events visible to the caller. Sensitive fields
        may be redacted based on case classification and caller authorization.
      security:
        - oauth2: [audit:read]
      parameters:
        - $ref: '#/components/parameters/CaseId'
        - name: since
          in: query
          schema:
            type: string
            format: date-time
        - name: eventType
          in: query
          schema:
            type: string
        - $ref: '#/components/parameters/PageSize'
        - $ref: '#/components/parameters/PageCursor'
      responses:
        '200':
          description: Timeline returned.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AuditTimelinePage'
```

### 14.2 Audit Event Schema

```yaml
components:
  schemas:
    AuditEvent:
      type: object
      additionalProperties: false
      required:
        - eventId
        - caseId
        - eventType
        - occurredAt
        - actor
        - summary
      properties:
        eventId:
          type: string
          format: uuid
        caseId:
          type: string
          format: uuid
        eventType:
          type: string
          example: CASE_CLOSED
        occurredAt:
          type: string
          format: date-time
        actor:
          $ref: '#/components/schemas/AuditActor'
        summary:
          type: string
        details:
          type: object
          additionalProperties: true
          description: Redacted event details suitable for caller authorization level.
```

### 14.3 Audit Invariants

The contract should state:

- audit events are append-only,
- audit event IDs are stable,
- audit timeline may be filtered by authorization,
- redacted details do not imply original event lacked data,
- timestamps are server-side authoritative,
- event order is by occurrence time plus deterministic tie-breaker.

---

## 15. Disclosure and Redaction

Disclosure is where API design, legal risk, privacy, and auditability intersect.

### 15.1 Redaction Task

```yaml
components:
  schemas:
    RedactionTask:
      type: object
      additionalProperties: false
      required:
        - redactionTaskId
        - caseId
        - status
        - requestedAt
      properties:
        redactionTaskId:
          type: string
          format: uuid
        caseId:
          type: string
          format: uuid
        status:
          type: string
          enum:
            - REQUESTED
            - IN_PROGRESS
            - READY_FOR_REVIEW
            - APPROVED
            - REJECTED
            - CANCELLED
        requestedAt:
          type: string
          format: date-time
        completedAt:
          type: string
          format: date-time
        reason:
          type: string
          maxLength: 2000
```

### 15.2 Disclosure Package

```yaml
    DisclosurePackage:
      type: object
      additionalProperties: false
      required:
        - packageId
        - caseId
        - status
        - createdAt
      properties:
        packageId:
          type: string
          format: uuid
        caseId:
          type: string
          format: uuid
        status:
          type: string
          enum:
            - DRAFT
            - REDACTION_PENDING
            - REVIEW_PENDING
            - APPROVED
            - PUBLISHED
            - WITHDRAWN
        publicUrl:
          type: string
          format: uri
        createdAt:
          type: string
          format: date-time
        publishedAt:
          type: string
          format: date-time
```

### 15.3 Public Endpoint Must Use Separate Schema

Do not expose internal `CaseDetail` to public disclosure.

Use separate public schema:

```yaml
    PublicDisclosurePackage:
      type: object
      additionalProperties: false
      required:
        - packageId
        - caseNumber
        - title
        - publishedAt
        - summary
      properties:
        packageId:
          type: string
          format: uuid
        caseNumber:
          type: string
        title:
          type: string
        summary:
          type: string
        publishedAt:
          type: string
          format: date-time
        documents:
          type: array
          items:
            $ref: '#/components/schemas/PublicDisclosureDocument'
```

This prevents accidental leakage of:

- internal assignments,
- legal review notes,
- sensitive subject details,
- raw evidence metadata,
- confidential classifications,
- audit internals.

---

## 16. Idempotency, Concurrency, and Conflict Control

High-risk lifecycle APIs need explicit conflict semantics.

### 16.1 Idempotency Key

Use for command operations that may be retried:

```yaml
components:
  parameters:
    IdempotencyKey:
      name: Idempotency-Key
      in: header
      required: false
      description: >
        Optional client-generated key used to make retryable command requests
        idempotent within the provider-defined retention window.
      schema:
        type: string
        minLength: 16
        maxLength: 128
```

### 16.2 If-Match

Use for optimistic concurrency:

```yaml
    IfMatch:
      name: If-Match
      in: header
      required: false
      description: >
        Entity tag from the latest representation. When supplied, the operation
        is applied only if the resource version still matches.
      schema:
        type: string
```

### 16.3 Response Codes

| Situation | Status |
|---|---|
| Validation failure | `400` or `422`, depending policy |
| Unauthorized token missing/invalid | `401` |
| Authenticated but no access | `403` |
| Resource not found or hidden | `404` or `403`, depending policy |
| State conflict | `409` |
| ETag/version mismatch | `412` |
| Too many requests | `429` |
| Long-running command accepted | `202` |

### 16.4 Conflict Example

Closing a case while appeal is open:

```json
{
  "type": "https://api.example.gov/problems/case-has-open-appeal",
  "title": "Case has open appeal",
  "status": 409,
  "detail": "Case EC-2026-000184 cannot be closed because appeal AP-2026-000031 is still under review.",
  "instance": "/cases/018fbd76-2915-73db-b797-f56b6f1eced2:close",
  "traceId": "00-4bf92f3577b34da6a3ce929d0e0e4736",
  "errorCode": "CASE_OPEN_APPEAL"
}
```

---

## 17. Long-Running Operations

Some operations should not pretend to finish synchronously.

Examples:

- large disclosure package generation,
- bulk evidence verification,
- external referral,
- mass redaction,
- report export,
- legal document generation.

### 17.1 Operation Resource Pattern

```http
POST /cases/{caseId}/disclosure-packages/{packageId}:publish
202 Accepted
Location: /operations/op_123
Retry-After: 10
```

Response:

```yaml
components:
  schemas:
    OperationStatus:
      type: object
      additionalProperties: false
      required:
        - operationId
        - status
        - createdAt
      properties:
        operationId:
          type: string
        status:
          type: string
          enum:
            - PENDING
            - RUNNING
            - SUCCEEDED
            - FAILED
            - CANCELLED
        resourceLocation:
          type: string
          format: uri
        error:
          $ref: '#/components/schemas/Problem'
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
```

### 17.2 Why This Matters

Without long-running operation modelling, consumers will:

- retry incorrectly,
- assume completion too early,
- duplicate commands,
- lose correlation,
- create support tickets for ambiguous outcomes.

---

## 18. Pagination and Search

Case search is not a database query endpoint.

It is a stable search contract.

### 18.1 Search Cases

```yaml
paths:
  /cases:
    get:
      operationId: searchCases
      parameters:
        - name: status
          in: query
          schema:
            $ref: '#/components/schemas/CaseStatus'
        - name: priority
          in: query
          schema:
            $ref: '#/components/schemas/CasePriority'
        - name: createdAfter
          in: query
          schema:
            type: string
            format: date-time
        - name: createdBefore
          in: query
          schema:
            type: string
            format: date-time
        - name: q
          in: query
          description: Free-text search over case number, title, and permitted indexed fields.
          schema:
            type: string
            maxLength: 200
        - $ref: '#/components/parameters/PageSize'
        - $ref: '#/components/parameters/PageCursor'
      responses:
        '200':
          description: Search results.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CaseSearchPage'
```

### 18.2 Page Envelope

```yaml
components:
  schemas:
    CaseSearchPage:
      type: object
      additionalProperties: false
      required:
        - items
        - page
      properties:
        items:
          type: array
          items:
            $ref: '#/components/schemas/CaseSummary'
        page:
          $ref: '#/components/schemas/CursorPageInfo'

    CursorPageInfo:
      type: object
      additionalProperties: false
      required:
        - hasMore
      properties:
        nextCursor:
          type: string
        hasMore:
          type: boolean
```

### 18.3 Search Rule

Do not expose arbitrary SQL-like filters unless the API intentionally owns a query language.

Avoid:

```text
GET /cases?where=status='OPEN' and assigned_unit in (...)
```

Prefer stable filters that you are willing to support long-term.

---

## 19. Java Implementation Alignment

The Java service should not allow OpenAPI DTOs to dominate the domain model.

### 19.1 Recommended Layers

```text
HTTP Controller / Generated Interface
        ↓
API DTO / OpenAPI Model
        ↓ mapper
Application Command / Query
        ↓
Domain Service / State Machine
        ↓
Repository / Integration Ports
        ↓
Database / Workflow / Storage / Notification
```

### 19.2 Example Command Mapping

OpenAPI request:

```java
record CloseCaseRequestDto(
    String closureReason,
    String closureSummary,
    LocalDate effectiveDate,
    UUID relatedCaseId
) {}
```

Application command:

```java
public record CloseCaseCommand(
    CaseId caseId,
    ClosureReason reason,
    String summary,
    Optional<LocalDate> effectiveDate,
    Optional<CaseId> relatedCaseId,
    ActorId actorId,
    Optional<String> idempotencyKey,
    Optional<String> expectedVersion
) {}
```

Domain logic:

```java
public Case close(CloseCaseCommand command) {
    Case existing = caseRepository.get(command.caseId());

    authorization.assertCanClose(command.actorId(), existing);
    stateMachine.assertTransitionAllowed(existing.status(), CaseTransition.CLOSE);
    closurePolicy.validate(existing, command);

    Case closed = existing.close(command.reason(), command.summary(), clock.now());

    audit.append(CaseAuditEvent.caseClosed(existing.id(), command.actorId(), command.reason()));

    return caseRepository.save(closed);
}
```

The OpenAPI contract defines the external shape. It should not be your business logic.

---

## 20. Validation Strategy

Validation has layers.

### 20.1 Syntactic Validation

Examples:

- JSON is valid,
- content type supported,
- field type correct,
- required field present.

OpenAPI can help strongly here.

### 20.2 Structural Validation

Examples:

- `closureSummary` length,
- `contentLength >= 1`,
- enum values,
- date-time format.

OpenAPI and Bean Validation can help.

### 20.3 Semantic Validation

Examples:

- duplicate closure requires related case,
- subject must belong to same jurisdiction,
- evidence cannot be released while sealed,
- appeal cannot be decided by conflicted actor.

OpenAPI can document this. Application code must enforce it.

### 20.4 State Validation

Examples:

- only `LEGAL_REVIEW` can move to `DECISION_PENDING`,
- cannot close with open appeal,
- cannot publish disclosure without approved redactions.

This belongs in domain/state-machine logic.

---

## 21. Contract Testing Strategy

### 21.1 Provider Tests

Validate actual responses against OpenAPI:

- success responses,
- error responses,
- edge cases,
- authorization failures,
- state conflicts.

### 21.2 Consumer Tests

Consumer teams should test against:

- mock server generated from OpenAPI,
- sample examples,
- generated client compatibility,
- known error responses.

### 21.3 CI Gates

Minimum gates:

```text
1. Validate OpenAPI syntax.
2. Lint against organizational rules.
3. Validate examples.
4. Bundle multi-file specs.
5. Compare against previous release.
6. Fail on unapproved breaking changes.
7. Generate docs/client/server artifacts.
8. Run provider contract tests.
9. Publish versioned contract artifact.
```

### 21.4 Breaking Change Examples

High-risk changes:

- removing enum value,
- adding required response field if generated clients are strict,
- changing `operationId`,
- changing `caseId` format,
- narrowing string length,
- changing error model,
- changing pagination envelope,
- changing `status` meaning without schema change,
- changing authorization requirement.

---

## 22. Governance Rules for This API

### 22.1 Naming Rules

- Operation IDs must be stable and verb-noun oriented.
- Public lifecycle states must not expose workflow engine names.
- Error codes must be stable, uppercase, and documented.
- Sensitive schemas must include classification metadata.
- Public schemas must not reuse internal schemas.

### 22.2 Required Response Rules

Every operation must document:

- success response,
- `400`,
- `401`,
- `403`,
- relevant `404`,
- relevant `409`,
- relevant `412`,
- relevant `429`,
- `500` only if represented through standard problem shape.

### 22.3 Required Header Rules

Command operations should consider:

- `Idempotency-Key`,
- `If-Match`,
- `ETag`,
- `Location`,
- `Retry-After`,
- correlation/trace header.

### 22.4 Review Checklist

Before accepting a new operation:

```text
[ ] Does the operation represent a stable consumer capability?
[ ] Is the operationId stable and meaningful?
[ ] Are authorization assumptions documented?
[ ] Are object-level access restrictions acknowledged?
[ ] Are non-200 responses documented?
[ ] Are examples realistic and valid?
[ ] Is the schema endpoint-specific where needed?
[ ] Does it avoid exposing persistence/workflow internals?
[ ] Does it define concurrency behavior?
[ ] Does it define idempotency behavior if retryable?
[ ] Does it preserve backward compatibility?
[ ] Does it create audit obligations?
[ ] Does it expose sensitive fields?
[ ] Does it need redaction/disclosure separation?
[ ] Does it need a long-running operation pattern?
```

---

## 23. Example Full Operation: Issue Decision

This operation has high consequence.

```yaml
paths:
  /cases/{caseId}:issue-decision:
    post:
      operationId: issueCaseDecision
      tags: [Decisions]
      summary: Issue a case decision
      description: >
        Issues a decision for the case after required findings and legal review
        are complete. This operation creates an immutable decision record,
        advances the case lifecycle, and appends audit events. It may trigger
        enforcement action creation, notifications, and appeal windows.
      security:
        - oauth2: [cases:decide]
      parameters:
        - $ref: '#/components/parameters/CaseId'
        - $ref: '#/components/parameters/IfMatch'
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/IssueDecisionRequest'
            examples:
              substantiatedWithAction:
                value:
                  decisionType: VIOLATION_FOUND
                  summary: Investigation substantiated the allegation based on verified documentary evidence.
                  findingIds:
                    - 018fbd76-2915-73db-b797-f56b6f1eced2
                  recommendedActionTypes:
                    - CORRECTIVE_ACTION_ORDER
                  effectiveDate: '2026-07-01'
      responses:
        '200':
          description: Decision issued.
          headers:
            ETag:
              schema:
                type: string
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CaseDecisionResult'
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '409':
          $ref: '#/components/responses/Conflict'
        '412':
          $ref: '#/components/responses/PreconditionFailed'
```

Schemas:

```yaml
components:
  schemas:
    IssueDecisionRequest:
      type: object
      additionalProperties: false
      required:
        - decisionType
        - summary
        - findingIds
      properties:
        decisionType:
          type: string
          enum:
            - NO_VIOLATION_FOUND
            - VIOLATION_FOUND
            - INCONCLUSIVE
            - REFERRED
        summary:
          type: string
          minLength: 20
          maxLength: 10000
        findingIds:
          type: array
          minItems: 1
          items:
            type: string
            format: uuid
        recommendedActionTypes:
          type: array
          items:
            type: string
            enum:
              - WARNING
              - FINE
              - LICENSE_SUSPENSION
              - LICENSE_REVOCATION
              - CORRECTIVE_ACTION_ORDER
              - REFERRAL
        effectiveDate:
          type: string
          format: date

    CaseDecisionResult:
      type: object
      additionalProperties: false
      required:
        - case
        - decisionId
        - auditEventId
      properties:
        case:
          $ref: '#/components/schemas/CaseDetail'
        decisionId:
          type: string
          format: uuid
        createdActionIds:
          type: array
          items:
            type: string
            format: uuid
        auditEventId:
          type: string
          format: uuid
```

This operation is not just a POST. It represents a regulated lifecycle transition.

---

## 24. OpenAPI Extensions for Governance

OpenAPI allows extension fields with `x-` prefix.

Use them carefully.

Examples:

```yaml
x-api-owner: enforcement-platform-team
x-data-classification: confidential
x-lifecycle-stage: production
x-change-approval-required: true
x-audit-required: true
x-regulatory-domain: enforcement
```

At operation level:

```yaml
x-risk-level: high
x-requires-audit-event: true
x-object-authorization: case-assignment-and-jurisdiction
x-breaking-change-review: mandatory
```

Rules:

- extensions should support automation or review,
- extensions should be documented in a style guide,
- extensions should not become a dumping ground,
- extensions should not pretend to enforce security by themselves.

---

## 25. What a Top 1% Engineer Watches For

### 25.1 Hidden State Machines

If the API exposes `PATCH status`, the real state machine is hidden.

Expose meaningful commands.

### 25.2 DTO Coupling

If Java DTOs are generated directly from JPA entities, the API will become unstable.

Maintain mapping boundaries.

### 25.3 Authorization Ambiguity

If `403` is undocumented, consumers cannot distinguish access failures from bugs.

Document authorization assumptions clearly.

### 25.4 Error Shape Drift

If each team returns different error formats, integration cost rises.

Use one problem model.

### 25.5 Enum Evolution

If business configuration is exposed as rigid enums, every new value may break consumers.

Be careful with volatile domains.

### 25.6 Public/Internal Schema Reuse

If public disclosure reuses internal case schema, sensitive data leakage becomes likely.

Separate schemas by audience.

### 25.7 Generated Code Overreach

Generated code is useful at the boundary.

It should not become the domain architecture.

### 25.8 Governance Without CI

A style guide without enforcement is a suggestion.

Use linting, diffing, and review gates.

---

## 26. Final Capstone Exercise

Design your own enforcement lifecycle API contract using this sequence.

### Step 1: Define Boundary

Write:

```text
This API owns:
- ...

This API does not own:
- ...
```

### Step 2: Define Actors

Create actor matrix:

```text
Actor | Capabilities | Restrictions | Required scopes
```

### Step 3: Define Lifecycle States

List public states and forbidden internal states.

### Step 4: Define Capability Map

Create operations grouped by:

- cases,
- subjects,
- allegations,
- evidence,
- findings,
- actions,
- appeals,
- audit,
- disclosure.

### Step 5: Define Core Schemas

Create endpoint-specific schemas:

- `CreateCaseRequest`,
- `CaseSummary`,
- `CaseDetail`,
- `CloseCaseRequest`,
- `EvidenceItem`,
- `Finding`,
- `EnforcementAction`,
- `Appeal`,
- `Problem`.

### Step 6: Define Error Catalogue

At minimum:

```text
CASE_INVALID_TRANSITION
CASE_VERSION_CONFLICT
CASE_ACCESS_DENIED
CASE_NOT_FOUND
EVIDENCE_SEALED
EVIDENCE_UPLOAD_EXPIRED
APPEAL_WINDOW_CLOSED
DISCLOSURE_REDACTION_REQUIRED
DECISION_LEGAL_REVIEW_PENDING
```

### Step 7: Define CI Gates

Require:

- spec validation,
- lint,
- examples validation,
- breaking diff,
- generated client smoke test,
- provider contract test,
- documentation publish.

### Step 8: Review for Regulatory Defensibility

Ask:

```text
Can we explain who did what, when, why, under what authority, using which contract version?
```

If the answer is no, the API is not ready for high-risk systems.

---

## 27. Final Mental Model

OpenAPI mastery is not the ability to remember YAML syntax.

It is the ability to turn complex service behavior into a clear, stable, reviewable, testable, evolvable, and defensible contract.

For a Java engineer, that means understanding the boundary between:

- HTTP interface,
- generated DTOs,
- application commands,
- domain state machine,
- persistence model,
- security policy,
- audit trail,
- CI/CD artifact,
- consumer SDK,
- governance process.

A weak OpenAPI spec says:

> “Here are our controllers.”

A strong OpenAPI contract says:

> “Here are the stable capabilities we commit to provide, the representations consumers may rely on, the errors they must handle, and the lifecycle rules that shape safe integration.”

That is the difference between Swagger documentation and API contract engineering.

---

## 28. Series Completion

This is the final part of the series.

Completed parts:

```text
000 — Series Index and Orientation
001 — OpenAPI Mental Model
002 — Specification Landscape
003 — Anatomy of an OpenAPI Document
004 — Paths and Operations
005 — Parameters
006 — Request Bodies
007 — Responses
008 — Components
009 — Schema Object
010 — Composition and Polymorphism
011 — Domain Resource Modelling
012 — Design-First, Code-First, Contract-First
013 — Java/Spring Ecosystem
014 — Contract Testing
015 — Breaking Changes and Compatibility
016 — Examples, Samples, Mocks, Documentation
017 — Security Schemes
018 — Pagination, Filtering, Sorting, Search, Bulk Operations
019 — Hypermedia, Links, Callbacks, Webhooks, Async Modelling
020 — Governance
021 — CI/CD Pipeline
022 — SDK and Client Generation
023 — Server Stub Generation
024 — Microservices and Platform Engineering
025 — API Gateways
026 — Regulated, Auditable, High-Risk Systems
027 — Advanced Schema Evolution
028 — Anti-Patterns and Failure Modes
029 — Production-Grade OpenAPI Case Study
030 — Capstone Enforcement Lifecycle API Contract
```

Status:

```text
Series complete: Yes
Total parts: 31 files including part 000
Main content parts: 30
```

---

## 29. Recommended Next Mastery Tracks

After OpenAPI, the most valuable continuation paths are:

1. **API Governance and Platform Engineering**
   - API catalog,
   - API lifecycle management,
   - developer portals,
   - API scorecards,
   - policy-as-code,
   - ownership models.

2. **JSON Schema Mastery**
   - validation semantics,
   - schema dialects,
   - conditional schemas,
   - schema evolution,
   - schema registries.

3. **AsyncAPI and Event Contract Engineering**
   - event schemas,
   - message channels,
   - event evolution,
   - Kafka/RabbitMQ contract modelling,
   - event-driven governance.

4. **API Security Engineering**
   - OAuth2/OIDC deep dive,
   - BOLA prevention,
   - authorization modelling,
   - token design,
   - API threat modelling.

5. **Contract Testing and Compatibility Engineering**
   - OpenAPI validation,
   - Pact,
   - schema diffing,
   - consumer impact analysis,
   - backward/forward compatibility.

6. **Regulatory Workflow Architecture**
   - state machines,
   - auditability,
   - evidence lifecycle,
   - decision traceability,
   - defensible case management.

---

## 30. Closing Statement

The goal of this series was not to make you “know OpenAPI”.

The goal was to make you capable of using OpenAPI as a serious engineering instrument.

At top-tier level, OpenAPI is not documentation after implementation.

It is part of how a system makes promises.

Those promises must be clear, testable, evolvable, automatable, and defensible.

That is the standard to aim for.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-029.md">⬅️ Part 029 — Building a Production-Grade OpenAPI from Scratch: End-to-End Case Study</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
