# OpenAPI Mastery for Java Engineers — Part 026
# OpenAPI for Regulated, Auditable, and High-Risk Systems

> Filename: `learn-openapi-mastery-for-java-engineers-part-026.md`  
> Series: `learn-openapi-mastery-for-java-engineers`  
> Part: `026 / 030`  
> Audience: Java software engineer, tech lead, architect, platform engineer, regulatory systems engineer  
> Focus: regulated API contracts, auditability, defensibility, traceability, lifecycle evidence, and high-risk domain modelling

---

## 0. Why This Part Matters

Most OpenAPI tutorials treat the specification as documentation.

That is too weak for regulated systems.

In a low-risk product, an API contract answers:

> “How do I call this endpoint?”

In a regulated, auditable, or high-risk system, an API contract must also help answer:

> “What did the system promise, expose, restrict, validate, reject, disclose, hide, record, and preserve at a specific point in time?”

That distinction is enormous.

For a typical commercial API, incomplete OpenAPI documentation may create developer friction.

For a regulatory enforcement platform, case management system, healthcare workflow, financial decisioning platform, public-sector API, or safety-critical workflow, incomplete contract modelling can create:

- audit gaps,
- unauthorized disclosure risk,
- inconsistent enforcement decisions,
- weak change justification,
- failed partner integration,
- broken legal defensibility,
- inability to reconstruct historical behavior,
- unclear evidence handling,
- poor incident investigation,
- and ambiguous accountability.

OpenAPI cannot make a system compliant by itself.

But a well-designed OpenAPI contract can become one of the strongest pieces of engineering evidence that the system boundary was explicitly designed, reviewed, tested, versioned, and controlled.

This part teaches how to think about OpenAPI as an **interface evidence artifact**.

---

## 1. Core Mental Model

OpenAPI in regulated systems is not merely an API description.

It is a **controlled statement of externally observable system behavior**.

That statement can be used by:

- engineers,
- QA,
- auditors,
- security teams,
- compliance teams,
- legal reviewers,
- product owners,
- system integrators,
- partner organizations,
- and incident investigators.

A normal API contract says:

```text
POST /cases creates a case.
```

A regulated-grade API contract should clarify:

```text
POST /cases accepts a controlled set of input fields.
It requires caller authorization.
It rejects invalid jurisdiction/state combinations.
It creates an auditable case record.
It returns a stable case identifier.
It does not expose internal triage scores.
It may return conflict if a duplicate intake already exists.
It emits traceable errors with correlation IDs.
It preserves enough response metadata for reconciliation.
```

That does not mean OpenAPI should contain all legal policy.

It means OpenAPI should mark the **technical boundary** precisely enough that policy enforcement, testing, and audit evidence can be mapped to it.

---

## 2. What Counts as a Regulated or High-Risk API?

An API becomes high-risk when incorrect behavior may cause legal, financial, safety, privacy, or procedural harm.

Examples:

1. Enforcement lifecycle APIs.
2. Case management APIs.
3. Investigation APIs.
4. Evidence upload/download APIs.
5. Health record APIs.
6. Financial transaction APIs.
7. Credit/risk decision APIs.
8. Public-sector citizen-service APIs.
9. Identity verification APIs.
10. Permission/entitlement APIs.
11. Legal disclosure/redaction APIs.
12. Complaint intake APIs.
13. Sanction or penalty APIs.
14. Audit log export APIs.
15. AI-assisted decision support APIs.

In such systems, API design failures are rarely isolated technical failures.

They affect process integrity.

---

## 3. OpenAPI as Audit Evidence

Audit evidence is not just logs.

A mature regulated platform needs evidence across the lifecycle:

```text
Requirement
  ↓
API operation
  ↓
Security rule
  ↓
Implementation
  ↓
Test evidence
  ↓
Release artifact
  ↓
Runtime observation
  ↓
Incident/change history
```

OpenAPI can sit near the center of this chain.

It can show:

- what operations existed,
- what inputs were accepted,
- what outputs were promised,
- what fields were exposed,
- what security schemes were required,
- what errors were documented,
- what examples were validated,
- what schemas were controlled,
- what changes were introduced,
- and when an endpoint or field became deprecated.

The key phrase is **controlled artifact**.

If the OpenAPI file is generated casually from implementation and never reviewed, it is weak evidence.

If it is versioned, reviewed, linted, diffed, tested, approved, and published as part of release, it becomes much stronger.

---

## 4. Evidence Strength Ladder

Not all OpenAPI usage has equal evidentiary value.

Think of a ladder:

```text
Level 0 — No OpenAPI
    API behavior reconstructed from code, logs, tribal memory.

Level 1 — Generated Documentation
    OpenAPI exists, but only generated from code and not reviewed.

Level 2 — Reviewed Contract
    OpenAPI changes go through pull request review.

Level 3 — Validated Contract
    Spec is linted, schema-valid, examples validate, and docs are published.

Level 4 — Tested Contract
    Provider responses and consumer assumptions are tested against the spec.

Level 5 — Governed Contract
    Breaking changes, security metadata, data classification, and ownership are enforced.

Level 6 — Auditable Contract Lifecycle
    Spec versions are linked to requirements, approvals, releases, tests, and incidents.
```

For high-risk systems, Level 1 is usually not enough.

The practical target is Level 4 or Level 5.

For externally facing regulated APIs, Level 6 is often the long-term goal.

---

## 5. Traceability: The Real Backbone

Traceability means you can answer:

> “Why does this operation exist, who approved it, what requirement does it satisfy, how is it tested, and what release introduced it?”

OpenAPI alone does not provide full traceability.

But it can carry stable anchors.

Important anchors include:

- `operationId`,
- tags,
- external documentation links,
- custom extensions,
- component schema names,
- error codes,
- example IDs,
- lifecycle metadata,
- ownership metadata,
- data classification metadata,
- requirement references,
- and test references.

Example:

```yaml
paths:
  /enforcement-cases/{caseId}/escalations:
    post:
      operationId: createCaseEscalation
      summary: Create an escalation request for an enforcement case
      description: >
        Creates a controlled escalation request for a case that requires
        senior review. This operation does not approve the escalation; it
        records the request and moves the case into pending-escalation-review
        if business rules are satisfied.
      tags:
        - Enforcement Case Escalation
      x-owner-team: enforcement-platform
      x-requirement-ids:
        - ENF-REQ-214
        - ENF-REQ-219
      x-control-ids:
        - ACCESS-CASE-WRITE
        - AUDIT-ESCALATION-REQUEST
      x-data-classification: restricted
      security:
        - oauth2:
            - case.write
            - escalation.request
```

This is not standard OpenAPI semantics.

The `x-*` extensions are vendor/custom extensions.

But they allow your organization to connect the API surface to governance artifacts.

---

## 6. Custom Extensions for Regulated Systems

OpenAPI allows specification extensions using `x-*` fields.

In regulated systems, custom extensions can be extremely valuable when used carefully.

Common regulated extensions:

```yaml
x-owner-team: enforcement-platform
x-domain: case-management
x-data-classification: restricted
x-pii: true
x-retention-class: investigation-record
x-requirement-ids:
  - REQ-1234
x-control-ids:
  - CTRL-AUTHZ-CASE-ACCESS
  - CTRL-AUDIT-CASE-VIEW
x-risk-level: high
x-audit-event: CASE_ESCALATION_REQUESTED
x-approval-required: true
x-sunset-policy: 12-month-notice
```

Good uses:

- enriching catalog metadata,
- driving lint rules,
- generating compliance reports,
- linking operations to controls,
- flagging sensitive data,
- identifying ownership,
- routing review to responsible teams,
- and supporting audit questions.

Bad uses:

- encoding business rules only in extensions,
- inventing metadata nobody validates,
- adding compliance labels without ownership,
- treating labels as proof of enforcement,
- using extensions as a dumping ground.

A useful extension should be either:

1. reviewed by humans,
2. checked by tooling,
3. visible in catalog/search,
4. used in CI/CD,
5. or tied to an operational control.

If nobody consumes it, it is probably decorative.

---

## 7. Data Classification in OpenAPI

High-risk APIs need explicit thinking around data classification.

Fields are not equal.

A response may include:

- public data,
- internal-only data,
- confidential data,
- personal data,
- sensitive personal data,
- financial data,
- health data,
- law-enforcement sensitive data,
- legally privileged data,
- sealed/redacted data,
- or operational security data.

OpenAPI does not define a universal data classification vocabulary.

Organizations should define their own taxonomy and apply it consistently.

Example schema-level classification:

```yaml
components:
  schemas:
    EnforcementCase:
      type: object
      x-data-classification: restricted
      required:
        - id
        - status
        - createdAt
      properties:
        id:
          type: string
          format: uuid
          x-data-classification: internal
        status:
          $ref: '#/components/schemas/CaseStatus'
        complainantName:
          type: string
          x-data-classification: personal
          x-pii: true
        internalRiskScore:
          type: integer
          minimum: 0
          maximum: 100
          x-data-classification: confidential
          x-internal-only: true
```

But be careful.

If `internalRiskScore` appears in a public schema, adding `x-internal-only: true` does not make it safe.

For a public-facing API, the better design is usually to exclude that field entirely from the external response schema.

Classification is not a substitute for correct boundary modelling.

---

## 8. Public, Partner, Internal, and Privileged API Surfaces

Regulated systems often expose different API surfaces for different audiences.

Typical surfaces:

```text
Public API
  Used by citizens, customers, public clients, or unauthenticated users.

Partner API
  Used by trusted organizations under agreements.

Internal API
  Used by internal services and staff tools.

Privileged API
  Used by administrators, investigators, supervisors, auditors, or legal teams.

System API
  Used by batch jobs, integration workers, or automation.
```

The mistake is to use one schema everywhere and hide fields conditionally at runtime.

That may be convenient for Java code.

It is dangerous for contract clarity.

Better:

```yaml
components:
  schemas:
    PublicCaseSummary:
      type: object
      properties:
        referenceNumber:
          type: string
        publicStatus:
          type: string

    PartnerCaseDetail:
      type: object
      properties:
        referenceNumber:
          type: string
        partnerStatus:
          type: string
        requiredAction:
          type: string

    InternalCaseDetail:
      type: object
      properties:
        id:
          type: string
          format: uuid
        internalStatus:
          $ref: '#/components/schemas/InternalCaseStatus'
        assignedUnit:
          type: string
        riskScore:
          type: integer
```

This reduces accidental disclosure risk.

It also makes review easier because reviewers can inspect what each surface exposes.

---

## 9. Sensitive Field Modelling

Sensitive fields need explicit treatment.

Examples:

- names,
- addresses,
- birth dates,
- national IDs,
- health attributes,
- financial account details,
- evidence metadata,
- witness identity,
- confidential notes,
- investigator identity,
- internal risk scores,
- legal privilege flags,
- sealed record references.

A high-quality OpenAPI schema should make it difficult to accidentally expose sensitive fields.

Poor design:

```yaml
Case:
  type: object
  properties:
    id:
      type: string
    complainantName:
      type: string
    witnessName:
      type: string
    internalNote:
      type: string
    riskScore:
      type: integer
```

This schema gives no indication of exposure risk.

Better:

```yaml
InternalCaseRecord:
  type: object
  x-data-classification: restricted
  properties:
    id:
      type: string
      format: uuid
    complainant:
      $ref: '#/components/schemas/RestrictedPersonSummary'
    witness:
      $ref: '#/components/schemas/RestrictedPersonSummary'
    internalAssessment:
      $ref: '#/components/schemas/InternalAssessment'

PublicCaseRecord:
  type: object
  x-data-classification: public
  properties:
    referenceNumber:
      type: string
    publicStatus:
      type: string
    submittedAt:
      type: string
      format: date-time
```

The naming itself carries intent.

In regulated APIs, naming is a control.

---

## 10. Redaction and Disclosure APIs

Many high-risk systems need controlled disclosure.

Example operations:

- generate disclosure package,
- preview redacted document,
- approve redaction,
- release evidence bundle,
- download public copy,
- download privileged copy,
- record disclosure decision,
- revoke disclosure package.

These APIs must be precise.

A weak endpoint:

```text
GET /cases/{caseId}/documents/{documentId}/download
```

Questions:

- Which version is downloaded?
- Is it redacted?
- Who is allowed to download it?
- Is the access audited?
- Is the document sealed?
- Does the response include original filename?
- Is a disclosure package immutable?
- Does download imply disclosure?
- What happens if redaction is pending?

Better operation design:

```yaml
/cases/{caseId}/disclosure-packages/{packageId}/redacted-document:
  get:
    operationId: downloadRedactedDisclosureDocument
    summary: Download the approved redacted disclosure document
    description: >
      Downloads the immutable redacted document associated with an approved
      disclosure package. This operation must not return the unredacted source
      document. Access is audited.
    x-audit-event: REDACTED_DISCLOSURE_DOCUMENT_DOWNLOADED
    x-data-classification: restricted
    security:
      - oauth2:
          - disclosure.read
    parameters:
      - name: caseId
        in: path
        required: true
        schema:
          type: string
          format: uuid
      - name: packageId
        in: path
        required: true
        schema:
          type: string
          format: uuid
    responses:
      '200':
        description: Approved redacted document stream
        headers:
          Content-Disposition:
            schema:
              type: string
        content:
          application/pdf:
            schema:
              type: string
              contentEncoding: binary
      '403':
        $ref: '#/components/responses/ForbiddenProblem'
      '404':
        $ref: '#/components/responses/NotFoundProblem'
      '409':
        description: Disclosure package is not approved for download
        content:
          application/problem+json:
            schema:
              $ref: '#/components/schemas/Problem'
```

This operation name and description reduce ambiguity.

---

## 11. Audit Event Modelling

OpenAPI can document audit behavior expectations.

It should not replace the audit system.

But it can state which operations are expected to produce audit events.

Example:

```yaml
x-audit:
  eventType: CASE_STATUS_CHANGED
  subjectType: enforcement-case
  subjectIdExpression: $.path.caseId
  actorRequired: true
  reasonRequired: true
```

This extension can be used by governance tooling to verify that high-risk operations are reviewed.

For example, a lint rule could require `x-audit` on:

- evidence download,
- case reassignment,
- status transition,
- enforcement decision,
- redaction approval,
- privileged note creation,
- disclosure package release,
- permission override,
- data export.

Example operation:

```yaml
/cases/{caseId}/status-transitions:
  post:
    operationId: transitionCaseStatus
    summary: Transition an enforcement case to a new status
    x-risk-level: high
    x-audit:
      eventType: CASE_STATUS_TRANSITIONED
      actorRequired: true
      reasonRequired: true
    requestBody:
      required: true
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/CaseStatusTransitionRequest'
```

A top-tier design does not merely document the endpoint.

It documents the fact that the endpoint is part of an auditable process.

---

## 12. Reason Codes and Decision Traceability

In regulated workflows, many operations should require reason codes.

Examples:

- closing a case,
- escalating a case,
- rejecting a complaint,
- overriding an assignment,
- approving an enforcement action,
- granting access exception,
- releasing a redacted document,
- reopening a case.

Poor request:

```yaml
CloseCaseRequest:
  type: object
  properties:
    comment:
      type: string
```

This is weak because free-text comments are difficult to validate, report, and audit.

Better:

```yaml
CloseCaseRequest:
  type: object
  required:
    - reasonCode
    - rationale
  properties:
    reasonCode:
      $ref: '#/components/schemas/CaseClosureReasonCode'
    rationale:
      type: string
      minLength: 20
      maxLength: 4000
    supportingDocumentIds:
      type: array
      items:
        type: string
        format: uuid
```

Reason codes provide structure.

Rationale provides context.

Supporting documents provide evidence linkage.

OpenAPI should show that the process requires these elements.

---

## 13. Controlled Vocabulary and Enum Risk

Regulated systems often have controlled vocabularies:

- status codes,
- decision codes,
- violation types,
- jurisdiction codes,
- risk categories,
- closure reasons,
- enforcement action types,
- disclosure restriction reasons.

Enums can be useful.

But enum changes can break consumers.

Also, some vocabularies are not stable enough to embed directly into OpenAPI.

Ask:

1. Is this vocabulary stable across releases?
2. Is it legally controlled?
3. Is it configuration-driven?
4. Do clients need exhaustive switch handling?
5. Is unknown value tolerance required?
6. Does adding a new value require consumer release coordination?

For stable API-level state:

```yaml
CaseStatus:
  type: string
  enum:
    - intake
    - under-review
    - investigation-open
    - pending-decision
    - closed
```

For dynamic business configuration:

```yaml
ViolationTypeCode:
  type: string
  description: >
    Controlled violation type code. Valid codes are managed by the violation
    taxonomy service and may evolve without an API version change. Consumers
    must tolerate unknown values and retrieve display metadata from the taxonomy API.
```

This is a subtle but important distinction.

Do not encode volatile policy tables as rigid API enums unless you can manage the compatibility impact.

---

## 14. State Machine Exposure

Regulated systems usually have lifecycle states.

Examples:

```text
Complaint:
  received → triaged → accepted → rejected

Investigation:
  opened → assigned → active → pending-review → completed

Enforcement Action:
  proposed → approved → issued → appealed → final → closed
```

OpenAPI can expose state through fields and operations, but it cannot fully model the state machine.

Still, it should make state transitions explicit.

Weak design:

```text
PATCH /cases/{caseId}
```

with body:

```json
{
  "status": "closed"
}
```

This hides business meaning.

Better:

```text
POST /cases/{caseId}/closure-requests
POST /cases/{caseId}/reopen-requests
POST /cases/{caseId}/escalations
POST /cases/{caseId}/assignment-changes
```

Why?

Because regulated state transitions usually require:

- authorization,
- reason,
- validation,
- audit,
- side effects,
- workflow tasks,
- notification,
- immutable history.

If the operation is meaningful, give it a meaningful contract.

---

## 15. Idempotency and Replay Safety

High-risk APIs often need idempotency.

Examples:

- complaint submission,
- payment submission,
- enforcement action issuance,
- evidence upload finalization,
- appeal filing,
- partner data intake.

If a client retries after timeout, duplicate creation may create legal or operational harm.

Document idempotency explicitly.

Example:

```yaml
components:
  parameters:
    IdempotencyKey:
      name: Idempotency-Key
      in: header
      required: true
      description: >
        Client-generated key used to make this request idempotent. Reusing
        the same key with the same request body returns the original result.
        Reusing the same key with a different request body returns conflict.
      schema:
        type: string
        minLength: 16
        maxLength: 128

paths:
  /complaints:
    post:
      operationId: submitComplaint
      parameters:
        - $ref: '#/components/parameters/IdempotencyKey'
      responses:
        '201':
          description: Complaint submitted
        '409':
          description: Idempotency key conflict or duplicate complaint detected
```

The contract should also describe:

- retention window for idempotency keys,
- whether result replay is supported,
- whether body mismatch returns 409,
- and whether idempotency applies per caller, tenant, or global namespace.

---

## 16. Concurrency and Decision Integrity

High-risk systems need to prevent lost updates and invalid transitions.

Use concurrency controls where appropriate.

Common pattern:

- response includes `ETag`,
- update requires `If-Match`,
- conflict returns `412 Precondition Failed` or `409 Conflict` depending on semantics.

Example:

```yaml
/cases/{caseId}/assignment:
  put:
    operationId: updateCaseAssignment
    parameters:
      - name: caseId
        in: path
        required: true
        schema:
          type: string
          format: uuid
      - name: If-Match
        in: header
        required: true
        description: Current case version ETag required to prevent lost update.
        schema:
          type: string
    responses:
      '200':
        description: Assignment updated
        headers:
          ETag:
            schema:
              type: string
      '412':
        description: Case version precondition failed
        content:
          application/problem+json:
            schema:
              $ref: '#/components/schemas/Problem'
```

In regulated systems, concurrency failures are not technical noise.

They protect process integrity.

---

## 17. Error Message Safety

Errors can leak sensitive information.

Poor error:

```json
{
  "message": "User does not have access to case 7f1... because witness John Smith is sealed under protective order P-119."
}
```

This leaks too much.

Better:

```json
{
  "type": "https://api.example.gov/problems/access-denied",
  "title": "Access denied",
  "status": 403,
  "detail": "The caller is not permitted to access this resource.",
  "correlationId": "01HV...",
  "code": "ACCESS_DENIED"
}
```

OpenAPI should define safe error schemas.

Example:

```yaml
Problem:
  type: object
  required:
    - type
    - title
    - status
    - code
    - correlationId
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
      description: Safe human-readable explanation. Must not expose privileged internal facts.
    code:
      type: string
    correlationId:
      type: string
```

Do not expose stack traces, SQL errors, internal service names, rule engine internals, or sensitive authorization facts.

---

## 18. Access Control Documentation

OpenAPI can describe authentication and scopes.

It cannot fully prove authorization correctness.

Still, a regulated API should make access expectations explicit.

Example:

```yaml
security:
  - oauth2:
      - case.read

x-authorization:
  resource: enforcement-case
  action: read
  policy: caller must be assigned to the case or have supervisor/auditor entitlement
  dataScope: tenant-and-jurisdiction
```

This helps reviewers ask:

- Is this endpoint protected?
- Which scope is required?
- What resource-level policy applies?
- Is tenant isolation required?
- Is jurisdiction filtering required?
- Are privileged roles documented?
- Is break-glass access audited?

Again, extensions do not enforce policy.

But they improve traceability and reviewability.

---

## 19. Break-Glass and Privileged Access

Some regulated systems need emergency access.

Examples:

- emergency health record access,
- supervisory case override,
- legal hold access,
- fraud investigation override,
- system support access.

These operations should not be hidden behind generic endpoints.

If break-glass access exists, it should have a controlled contract.

Example:

```yaml
/cases/{caseId}/privileged-access-grants:
  post:
    operationId: grantPrivilegedCaseAccess
    summary: Grant temporary privileged access to a restricted case
    description: >
      Grants temporary privileged access to a restricted case. This operation
      requires supervisor authorization, a reason code, and produces a high-risk
      audit event.
    x-risk-level: critical
    x-audit:
      eventType: PRIVILEGED_CASE_ACCESS_GRANTED
      reasonRequired: true
    security:
      - oauth2:
          - privileged-access.grant
    requestBody:
      required: true
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/PrivilegedAccessGrantRequest'
```

A generic `PATCH /users/{id}/permissions` is too vague for this kind of control.

---

## 20. Retention and Records Lifecycle Metadata

Some API resources represent records subject to retention rules.

OpenAPI should not become the retention engine.

But it can expose relevant lifecycle metadata.

Example:

```yaml
EvidenceFile:
  type: object
  required:
    - id
    - caseId
    - recordClass
    - retentionUntil
    - createdAt
  properties:
    id:
      type: string
      format: uuid
    caseId:
      type: string
      format: uuid
    recordClass:
      type: string
      description: Records-management classification for the evidence file.
    retentionUntil:
      type: string
      format: date
      description: Earliest date this record may be eligible for disposal.
    legalHold:
      type: boolean
      description: Whether this record is currently subject to legal hold.
    createdAt:
      type: string
      format: date-time
```

This helps downstream systems avoid treating records as ordinary files.

---

## 21. Immutable Records and Append-Only Histories

Regulated processes often need immutable history.

Examples:

- case status history,
- assignment history,
- evidence custody chain,
- disclosure history,
- decision history,
- audit logs.

Avoid modelling history as mutable list replacement.

Weak:

```text
PUT /cases/{caseId}/history
```

Better:

```text
GET /cases/{caseId}/history
POST /cases/{caseId}/status-transitions
POST /evidence-files/{evidenceId}/custody-events
```

For append-only resources, say so.

```yaml
EvidenceCustodyEvent:
  type: object
  description: Immutable event in the evidence custody chain.
  required:
    - id
    - evidenceId
    - eventType
    - occurredAt
    - actorId
  properties:
    id:
      type: string
      format: uuid
    evidenceId:
      type: string
      format: uuid
    eventType:
      type: string
      enum:
        - uploaded
        - transferred
        - sealed
        - unsealed
        - downloaded
        - disposed
    occurredAt:
      type: string
      format: date-time
    actorId:
      type: string
      format: uuid
```

The API contract should reflect immutability where the domain requires it.

---

## 22. Evidence Upload and Download APIs

Evidence APIs are high-risk because they involve:

- file integrity,
- custody,
- access control,
- metadata accuracy,
- chain of custody,
- malware scanning,
- retention,
- redaction,
- and disclosure.

A production-grade evidence upload flow may be multi-step:

1. Create upload intent.
2. Upload binary content.
3. Complete upload.
4. Scan/validate content.
5. Seal evidence file.
6. Attach to case.
7. Record custody event.

OpenAPI can model this explicitly.

Example operations:

```text
POST /cases/{caseId}/evidence-upload-intents
PUT  /evidence-upload-intents/{intentId}/content
POST /evidence-upload-intents/{intentId}/completion
GET  /evidence-files/{evidenceId}
GET  /evidence-files/{evidenceId}/content
GET  /evidence-files/{evidenceId}/custody-events
```

This is better than a single vague upload endpoint when evidence integrity matters.

---

## 23. High-Risk Operation Checklist

For every high-risk operation, ask:

1. Is the operation name explicit?
2. Is the security requirement documented?
3. Is resource-level authorization described somewhere?
4. Is the request body constrained?
5. Are reason codes required when needed?
6. Is idempotency required?
7. Is optimistic concurrency required?
8. Are errors safe?
9. Are conflict states documented?
10. Are audit expectations documented?
11. Are sensitive fields excluded or classified?
12. Are examples realistic and safe?
13. Are all non-200 responses documented?
14. Is the operation linked to a requirement/control?
15. Is the lifecycle status clear?
16. Is the operation owner clear?
17. Is deprecation/sunset policy clear?
18. Are downstream consumers identified?
19. Is the contract tested?
20. Is the change reviewed by the right roles?

If many answers are “no,” the API is not ready for regulated use.

---

## 24. Change Approval and Contract History

In regulated systems, the question is not only:

> “What does the API look like now?”

It is also:

> “What did the API look like when this decision was made?”

Therefore, keep contract history.

Good practices:

- version OpenAPI files in Git,
- tag specs with releases,
- publish immutable contract artifacts,
- store generated docs per version,
- store diff reports,
- store breaking-change approvals,
- link PRs to requirements/tickets,
- record deprecation notices,
- include approval metadata where appropriate,
- and preserve artifacts beyond normal code retention if policy requires it.

Example release artifact structure:

```text
api-contracts/
  enforcement-api/
    2026.06.20/
      openapi.yaml
      bundled.yaml
      lint-report.json
      diff-report.html
      breaking-change-review.md
      generated-docs/
      examples-validation-report.json
```

This makes future reconstruction possible.

---

## 25. OpenAPI in Incident Investigation

During an incident, OpenAPI can help answer:

- Was the field supposed to be exposed?
- Was the endpoint documented as public or internal?
- Was authentication required in the contract?
- Did the implementation return a response not in the contract?
- Did a client rely on undocumented behavior?
- Was a breaking change introduced without approval?
- Did the gateway and provider disagree?
- Did the API contract omit an error case?
- Did examples encourage unsafe usage?
- Did generated SDKs reflect the released contract?

This is why contract drift is dangerous.

If the implementation and OpenAPI disagree, the audit value of OpenAPI collapses.

---

## 26. Regulatory Defensibility

A system is defensible when you can explain and justify its behavior.

For APIs, defensibility means you can explain:

- what was exposed,
- why it was exposed,
- who could access it,
- what validation occurred,
- what errors were possible,
- what records were produced,
- what side effects occurred,
- what changes were made over time,
- and how consumers were expected to use it.

OpenAPI contributes to defensibility by making the interface explicit.

But defensibility also requires:

- implementation evidence,
- tests,
- logs,
- access-control records,
- release approvals,
- security reviews,
- data classification,
- and incident response procedures.

Do not oversell OpenAPI.

It is necessary evidence in many mature systems.

It is not sufficient evidence by itself.

---

## 27. Practical Governance Rules for Regulated APIs

A regulated API style guide should include concrete rules.

Example rules:

```text
1. Every operation must have a stable operationId.
2. Every operation must have an owner team.
3. Every operation must declare security requirements unless explicitly public.
4. Every high-risk operation must declare audit metadata.
5. Every endpoint returning sensitive data must declare data classification.
6. Public APIs must not reference internal schemas.
7. Error responses must use the standard Problem schema.
8. Every operation must document 4xx responses relevant to its failure modes.
9. Every create/command operation must define idempotency policy.
10. Every state transition operation must require a reason code or rationale unless exempted.
11. Every binary download must document content type, access control, and audit behavior.
12. Every deprecated operation or field must include replacement guidance.
13. Examples must not contain real personal data.
14. Breaking changes require explicit approval.
15. Specs must be bundled, linted, diffed, and published per release.
```

These rules are enforceable.

That is the point.

A style guide that cannot be checked becomes a document people ignore.

---

## 28. Example: Regulated Case Closure Contract

Below is a compact example showing multiple concepts together.

```yaml
openapi: 3.2.0
info:
  title: Enforcement Case API
  version: 1.4.0

paths:
  /cases/{caseId}/closure-requests:
    post:
      operationId: requestCaseClosure
      summary: Request closure of an enforcement case
      description: >
        Creates a closure request for an enforcement case. This operation does
        not immediately close the case if supervisory approval is required. It
        records the requested closure reason, rationale, and supporting evidence.
      tags:
        - Case Lifecycle
      x-owner-team: enforcement-platform
      x-risk-level: high
      x-data-classification: restricted
      x-requirement-ids:
        - ENF-CASE-REQ-301
      x-control-ids:
        - CTRL-CASE-CLOSURE-AUDIT
        - CTRL-CASE-CLOSURE-AUTHZ
      x-audit:
        eventType: CASE_CLOSURE_REQUESTED
        actorRequired: true
        reasonRequired: true
      security:
        - oauth2:
            - case.write
            - case.closure.request
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
            format: uuid
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
              $ref: '#/components/schemas/CaseClosureRequest'
            examples:
              insufficientEvidence:
                summary: Closure due to insufficient evidence
                value:
                  reasonCode: insufficient-evidence
                  rationale: Investigation did not identify sufficient admissible evidence to proceed.
                  supportingEvidenceIds:
                    - 1c9d8f89-1ec1-42aa-9b6e-13c4a55d9af7
      responses:
        '202':
          description: Closure request accepted for review
          headers:
            Location:
              description: URL of the created closure request resource
              schema:
                type: string
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CaseClosureRequestStatus'
        '400':
          $ref: '#/components/responses/BadRequestProblem'
        '401':
          $ref: '#/components/responses/UnauthorizedProblem'
        '403':
          $ref: '#/components/responses/ForbiddenProblem'
        '404':
          $ref: '#/components/responses/NotFoundProblem'
        '409':
          description: Case is not in a state that allows closure request
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/Problem'

components:
  schemas:
    CaseClosureRequest:
      type: object
      required:
        - reasonCode
        - rationale
      properties:
        reasonCode:
          $ref: '#/components/schemas/CaseClosureReasonCode'
        rationale:
          type: string
          minLength: 20
          maxLength: 4000
        supportingEvidenceIds:
          type: array
          maxItems: 50
          items:
            type: string
            format: uuid

    CaseClosureReasonCode:
      type: string
      enum:
        - insufficient-evidence
        - out-of-jurisdiction
        - duplicate-case
        - resolved-through-voluntary-compliance
        - enforcement-action-completed

    CaseClosureRequestStatus:
      type: object
      required:
        - id
        - caseId
        - status
        - submittedAt
      properties:
        id:
          type: string
          format: uuid
        caseId:
          type: string
          format: uuid
        status:
          type: string
          enum:
            - pending-review
            - approved
            - rejected
        submittedAt:
          type: string
          format: date-time

    Problem:
      type: object
      required:
        - type
        - title
        - status
        - code
        - correlationId
      properties:
        type:
          type: string
          format: uri
        title:
          type: string
        status:
          type: integer
        code:
          type: string
        detail:
          type: string
        correlationId:
          type: string
```

Observe the design choices:

- operation is explicit,
- closure is not hidden as generic status update,
- reason code is required,
- rationale is bounded,
- evidence linkage exists,
- audit metadata exists,
- idempotency is required,
- error paths are documented,
- response uses `202` because closure may require review,
- and requirement/control IDs are traceable.

This is the difference between API documentation and defensible contract design.

---

## 29. Common Anti-Patterns

### 29.1 “We Have Swagger, So We Are Documented”

Swagger UI is not governance.

Generated docs do not prove review, security correctness, or compliance.

### 29.2 Sensitive Fields Hidden Only by Runtime Serialization

If a schema contains sensitive fields and you rely on runtime views/groups to hide them, your contract is ambiguous.

Prefer separate schemas per exposure surface.

### 29.3 Generic Update Endpoints for Meaningful Decisions

`PATCH /cases/{id}` may be fine for simple metadata.

It is usually bad for major lifecycle transitions.

### 29.4 Free-Text Reasons Only

Free text is hard to report and audit.

Use reason codes plus rationale.

### 29.5 Missing 403/409/412 Responses

High-risk APIs often fail due to authorization, invalid state, or concurrency.

If those are undocumented, consumers cannot handle process conflicts safely.

### 29.6 OpenAPI Extensions Nobody Uses

Compliance metadata that is not reviewed, linted, reported, or consumed creates false confidence.

### 29.7 Internal Enum Leakage

Internal workflow states may not be safe or stable for public/partner consumers.

Expose consumer-appropriate state models.

### 29.8 No Contract History

If old specs are overwritten, you cannot reconstruct past behavior.

### 29.9 Error Messages Leak Privileged Facts

Helpful errors are good.

Unsafe errors are dangerous.

### 29.10 Gateway, Implementation, and Spec Drift

A regulated contract is weak if runtime behavior disagrees with it.

---

## 30. Java Implementation Implications

For Java teams, regulated OpenAPI design has architectural consequences.

### 30.1 Do Not Expose JPA Entities

JPA entities are persistence models.

They are not regulated API contracts.

Use mapping layers:

```text
OpenAPI schema / API DTO
  ↔ mapper
Application command/query
  ↔ service layer
Domain model
  ↔ repository
Persistence entity
```

### 30.2 Keep Security at Multiple Layers

Do not rely only on controller annotations.

Use:

- endpoint security,
- method security,
- resource-level authorization,
- tenant/jurisdiction filters,
- audit interceptors,
- response filtering where necessary,
- and tests against the OpenAPI contract.

### 30.3 Avoid Annotation-Only Governance

Annotations can help generate docs.

But regulated metadata should often be reviewed in source-controlled OpenAPI or generated into a reviewed artifact.

### 30.4 Validate at the Boundary

Use Bean Validation, custom validators, request validators, and contract tests.

But remember:

- Bean Validation catches structural constraints,
- business rules need domain/application validation,
- authorization needs policy enforcement,
- audit needs event recording,
- OpenAPI only describes the expected boundary.

### 30.5 Use Explicit DTOs for Exposure Control

Avoid one class like `CaseDto` reused everywhere.

Prefer:

```text
PublicCaseSummaryResponse
PartnerCaseDetailResponse
InternalCaseDetailResponse
CaseClosureRequest
CaseClosureRequestStatusResponse
```

Verbose names are acceptable when they reduce risk.

---

## 31. Review Checklist for Regulated OpenAPI Pull Requests

Use this during API review.

```text
Contract Identity
[ ] Does every operation have a stable operationId?
[ ] Are tags meaningful?
[ ] Is the owner team declared?
[ ] Is lifecycle status clear?

Security
[ ] Is authentication declared?
[ ] Are scopes/roles documented?
[ ] Is resource-level authorization described where needed?
[ ] Are privileged/break-glass paths explicit?

Data Exposure
[ ] Are sensitive fields excluded from public/partner schemas?
[ ] Is data classification declared where required?
[ ] Are examples free of real personal/sensitive data?
[ ] Are internal-only fields absent from external schemas?

Auditability
[ ] Do high-risk operations declare audit expectations?
[ ] Are reason codes required for major decisions?
[ ] Is actor/correlation traceability supported?
[ ] Are immutable history resources modelled correctly?

Lifecycle and State
[ ] Are meaningful state transitions explicit operations?
[ ] Are invalid states documented with 409/422/412 responses?
[ ] Is concurrency control needed?
[ ] Is idempotency needed?

Errors
[ ] Are standard problem responses used?
[ ] Are 400/401/403/404/409/412/422 documented where relevant?
[ ] Are error messages safe?
[ ] Is correlation ID present?

Change Control
[ ] Is this change backward compatible?
[ ] Are breaking changes explicitly approved?
[ ] Are deprecated fields/endpoints documented?
[ ] Is migration guidance provided?

Evidence
[ ] Are requirement/control IDs linked?
[ ] Are examples valid?
[ ] Are contract tests updated?
[ ] Is the spec published as an immutable release artifact?
```

---

## 32. A Better Way to Think About Compliance

Weak mindset:

```text
Compliance team will review it later.
```

Better mindset:

```text
The API contract should make risky behavior visible before implementation ships.
```

OpenAPI should surface questions early:

- Are we exposing the right fields?
- Are we documenting the right failure modes?
- Are we requiring reason codes?
- Are we preserving audit trails?
- Are we safe under retry?
- Are we safe under concurrency?
- Are we safe under role changes?
- Are we safe under jurisdiction boundaries?
- Are we safe under disclosure restrictions?

That is the real value.

OpenAPI is not compliance paperwork.

It is a design instrument.

---

## 33. Summary

In regulated, auditable, and high-risk systems, OpenAPI should be treated as a controlled engineering artifact.

The strongest OpenAPI contracts do more than list endpoints.

They clarify:

- security expectations,
- data exposure,
- sensitive fields,
- lifecycle operations,
- state transitions,
- audit expectations,
- reason codes,
- idempotency,
- concurrency,
- error safety,
- ownership,
- change control,
- and traceability.

OpenAPI does not prove that implementation is compliant.

But without a precise contract, implementation correctness is harder to review, test, govern, and defend.

The top 1% engineer understands this:

> In high-risk systems, an API contract is not just a developer convenience. It is a boundary of accountability.

---

## 34. Practical Exercises

### Exercise 1 — Classify an Existing API

Take one existing endpoint and classify it:

```text
Endpoint:
Audience:
Risk level:
Data classification:
Authentication:
Authorization rule:
Audit event needed:
Reason code needed:
Idempotency needed:
Concurrency control needed:
Sensitive fields:
Required error responses:
```

Then compare that against the current OpenAPI spec.

### Exercise 2 — Split an Unsafe Schema

Given a broad `CaseDto`, split it into:

- `PublicCaseSummary`,
- `PartnerCaseDetail`,
- `InternalCaseDetail`,
- `PrivilegedCaseRecord`.

Document which fields belong where and why.

### Exercise 3 — Model a Decision Operation

Design OpenAPI for:

```text
POST /cases/{caseId}/enforcement-decisions
```

Include:

- reason code,
- rationale,
- supporting evidence,
- idempotency key,
- audit metadata,
- conflict response,
- forbidden response,
- validation error response.

### Exercise 4 — Create a Governance Rule

Define one lintable rule for high-risk APIs.

Example:

```text
Every operation with x-risk-level: high must include x-audit.eventType.
```

Then describe how the CI pipeline should fail if the rule is violated.

---

## 35. Key Takeaways

1. OpenAPI can become audit evidence when it is controlled, reviewed, versioned, and tested.
2. Regulated APIs need explicit modelling of exposure, authorization, auditability, state, errors, and change control.
3. Separate schemas by audience and purpose; do not reuse internal DTOs externally.
4. Meaningful lifecycle transitions deserve meaningful operations.
5. Sensitive fields should be excluded by design, not merely hidden at runtime.
6. Reason codes, idempotency, concurrency, and safe errors are core parts of defensible API design.
7. Custom `x-*` extensions are powerful only when reviewed or consumed by tooling.
8. Contract history matters because audits often ask what behavior was promised in the past.
9. OpenAPI is not compliance by itself, but it is a major boundary artifact for compliance-grade engineering.
10. In high-risk systems, unclear API contracts become accountability gaps.

---

## 36. What Comes Next

Next part:

```text
Part 027 — Advanced Schema Evolution: Long-Lived APIs, Consumer Diversity, and Semantic Drift
```

Part 027 will go deeper into schema evolution, long-lived API compatibility, consumer diversity, enum evolution, optional/nullable semantics, field replacement, semantic drift, and how to evolve APIs without creating constant version explosions.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-025.md">⬅️ OpenAPI Mastery for Java Engineers — Part 025</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-027.md">OpenAPI Mastery for Java Engineers — Part 027 ➡️</a>
</div>
