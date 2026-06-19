# learn-http-for-web-backend-perspective-part-032.md

# Part 032 — Capstone: Designing a Production-Grade HTTP API

> Series: **HTTP for Web / Backend Perspective**  
> Audience: **Java Software Engineer / Tech Lead**  
> Focus: turning HTTP backend semantics into a defensible, observable, secure, evolvable production API design.

---

## 0. What This Capstone Is About

This final part is not a new isolated topic. It is the consolidation of everything from Part 000 to Part 031.

Up to this point, we have studied HTTP as:

- a semantic protocol,
- a resource contract,
- a validation boundary,
- a concurrency-control mechanism,
- a cache contract,
- an authentication and authorization surface,
- an operational interface,
- a security boundary,
- a Java framework implementation pipeline,
- and a service-to-service dependency boundary.

This capstone asks a harder question:

> How do we design a real production-grade HTTP API where correctness, workflow, security, auditability, reliability, and long-term evolution all matter at the same time?

The answer is not “use REST”, “use Spring Boot”, “return JSON”, or “document it with OpenAPI”. Those are tools. A production-grade backend API is a **system contract**.

In this part we will design an API for a regulatory enforcement case management platform.

The domain will include:

- case submission,
- case assignment,
- evidence upload,
- review,
- escalation,
- decision,
- appeal,
- audit trail,
- async exports,
- notifications/webhooks,
- authorization per role,
- optimistic concurrency,
- idempotent command handling,
- and operational observability.

The goal is not to produce a perfect universal API. The goal is to show how a strong backend engineer reasons through the design.

---

## 1. Scenario: Regulatory Enforcement Case Platform

Imagine we are building a backend platform used by a regulatory agency.

The platform manages enforcement cases against regulated entities. A case can be submitted, triaged, assigned, investigated, escalated, reviewed, decided, appealed, closed, and audited.

The users include:

- intake officers,
- investigators,
- supervisors,
- legal reviewers,
- enforcement directors,
- external agencies,
- regulated entities,
- respondents,
- system integration clients,
- reporting/audit users.

The system must support:

- strict authorization,
- auditable state transitions,
- large evidence files,
- idempotent submissions,
- workflow concurrency,
- long-running operations,
- external integrations,
- traceability,
- versioned contracts,
- defensible error handling,
- and operational resilience.

This is a good capstone domain because it is not CRUD-only. It contains long-lived state, role-sensitive actions, case lifecycle constraints, evidence handling, workflow transitions, legal consequences, and audit requirements.

---

## 2. The Core Design Principle

A production HTTP API should be designed around this invariant:

> Every externally visible HTTP operation must have clear semantics, clear authority, clear failure behavior, clear authorization boundaries, and clear operational signals.

That means every endpoint must answer:

1. **What resource or operation does this identify?**
2. **What method semantics apply?**
3. **Is the operation safe, idempotent, retryable, cacheable, or conditional?**
4. **Who is allowed to perform it?**
5. **What state transition does it cause?**
6. **What happens if the request is duplicated?**
7. **What happens if the resource changed concurrently?**
8. **What happens if the client disconnects?**
9. **What is the error contract?**
10. **What should be logged, metered, traced, and audited?**
11. **How can the contract evolve without breaking clients?**
12. **Where is enforcement performed: gateway, application, domain, database, or all of them?**

A weak API design starts with controllers.

A strong API design starts with invariants.

---

## 3. Domain Model Overview

A simplified domain model:

```text
RegulatedEntity
  └── EnforcementCase
        ├── CaseAssignment
        ├── EvidenceItem
        ├── CaseNote
        ├── Review
        ├── Decision
        ├── Appeal
        ├── AuditEvent
        └── ExternalSubmission
```

Important domain concepts:

- A **case** is the aggregate root for most workflow operations.
- Evidence files are large binary objects with metadata and lifecycle.
- Reviews and decisions are separate resources because they carry independent authorization, timestamps, approvals, and audit semantics.
- Audit events are append-only and should not be updated through normal APIs.
- Some operations are commands that trigger state transitions.
- Some operations are queries that return representations.
- Some operations are asynchronous because they involve external agencies, exports, scanning, or report generation.

---

## 4. Case Lifecycle State Machine

A possible lifecycle:

```text
DRAFT
  -> SUBMITTED
  -> TRIAGED
  -> ASSIGNED
  -> INVESTIGATION_OPEN
  -> REVIEW_PENDING
  -> LEGAL_REVIEW
  -> DECISION_PENDING
  -> DECIDED
  -> APPEAL_WINDOW_OPEN
  -> APPEALED
  -> APPEAL_REVIEW
  -> FINALIZED
  -> CLOSED
```

Exceptional paths:

```text
SUBMITTED -> REJECTED
TRIAGED -> CLOSED_AS_DUPLICATE
INVESTIGATION_OPEN -> ESCALATED
REVIEW_PENDING -> RETURNED_FOR_MORE_INFO
DECIDED -> APPEALED
ANY_ALLOWED_STATE -> ADMINISTRATIVELY_CLOSED
```

The state machine matters because HTTP operations should not mutate arbitrary fields directly when the true operation is a state transition.

For example:

Bad design:

```http
PATCH /cases/123
Content-Type: application/json

{ "status": "DECIDED" }
```

Better design:

```http
POST /cases/123/decision
Content-Type: application/json
Idempotency-Key: 8d8f7c3e-...
If-Match: "case-v17"

{
  "outcome": "VIOLATION_CONFIRMED",
  "sanctionCode": "ADMIN_FINE",
  "rationale": "Evidence supports..."
}
```

Why better?

- It expresses a domain operation.
- It can validate required decision fields.
- It can enforce role-specific authorization.
- It can create an audit event.
- It can prevent lost update through `If-Match`.
- It can deduplicate retries through `Idempotency-Key`.
- It can produce a stable decision resource.
- It prevents clients from pretending that status is just a field.

---

## 5. Resource Model

A strong resource model might look like this:

```text
/entities
/entities/{entityId}
/entities/{entityId}/cases

/cases
/cases/{caseId}
/cases/{caseId}/assignments
/cases/{caseId}/assignments/{assignmentId}
/cases/{caseId}/evidence
/cases/{caseId}/evidence/{evidenceId}
/cases/{caseId}/notes
/cases/{caseId}/notes/{noteId}
/cases/{caseId}/reviews
/cases/{caseId}/reviews/{reviewId}
/cases/{caseId}/decision
/cases/{caseId}/appeals
/cases/{caseId}/appeals/{appealId}
/cases/{caseId}/audit-events

/case-searches
/case-exports
/case-exports/{exportId}

/external-submissions
/external-submissions/{submissionId}

/webhook-subscriptions
/webhook-subscriptions/{subscriptionId}
```

There are several design choices here.

## 5.1 `/cases/{caseId}` as aggregate identity

The case resource is the stable external identity.

```http
GET /cases/CASE-2026-000123
```

Returns the current case representation.

The case representation should include state, metadata, links or identifiers to related resources, and fields appropriate for the caller's authorization level.

## 5.2 Sub-resources for lifecycle components

Evidence, reviews, assignments, appeals, notes, and audit events are sub-resources because they have distinct identity and behavior.

```http
GET /cases/CASE-2026-000123/evidence/EV-001
GET /cases/CASE-2026-000123/reviews/RV-009
GET /cases/CASE-2026-000123/audit-events
```

## 5.3 Command resources for state transitions

Some operations are not clean field replacements. They are commands. Use subordinate resources or action resources carefully.

Examples:

```text
POST /cases/{caseId}/assignments
POST /cases/{caseId}/reviews
POST /cases/{caseId}/decision
POST /cases/{caseId}/appeals
POST /cases/{caseId}/escalations
POST /cases/{caseId}/closures
```

This is not “impure REST”. It is explicit HTTP API design for workflow-heavy domains.

The key is to avoid arbitrary verb soup. Commands should map to durable domain events/resources.

Bad:

```text
POST /cases/{id}/doThing
POST /cases/{id}/process
POST /cases/{id}/updateStatus
```

Better:

```text
POST /cases/{id}/decision
POST /cases/{id}/appeals
POST /cases/{id}/closures
POST /cases/{id}/escalations
```

The better names describe domain concepts, not implementation mechanics.

---

## 6. URI Design Rules

For this platform:

1. Use nouns for durable resources.
2. Use subordinate resources for lifecycle events that have identity.
3. Use query parameters for filtering, sorting, pagination, and search criteria.
4. Do not encode authorization or state in the URI.
5. Do not expose database implementation IDs if the external ID has regulatory meaning.
6. Avoid ambiguous route patterns.
7. Keep URI stable even if backend service boundaries change.
8. Keep bulk and async operations explicit.
9. Avoid pretending complex workflow transitions are generic PATCHes.
10. Design URI with auditability and support diagnosis in mind.

Example search URI:

```http
GET /cases?state=INVESTIGATION_OPEN&assignedTo=me&limit=50&cursor=eyJ...
```

For complex search criteria, use a search resource:

```http
POST /case-searches
Content-Type: application/json

{
  "criteria": {
    "states": ["INVESTIGATION_OPEN", "REVIEW_PENDING"],
    "entityRiskLevel": ["HIGH", "CRITICAL"],
    "submittedAfter": "2026-01-01T00:00:00Z"
  },
  "pageSize": 100
}
```

Then return either immediate results or a search resource.

---

## 7. Method and Status Matrix

A production API should have a method/status matrix before implementation.

## 7.1 Case creation

```http
POST /cases
Content-Type: application/json
Idempotency-Key: 4f4e6d2e-...
```

Request:

```json
{
  "regulatedEntityId": "ENT-001",
  "allegationType": "REPORTING_FAILURE",
  "summary": "Quarterly report was not submitted.",
  "source": "PUBLIC_COMPLAINT"
}
```

Possible responses:

| Situation | Status | Notes |
|---|---:|---|
| Created immediately | `201 Created` | Include `Location: /cases/{caseId}` |
| Accepted for async intake | `202 Accepted` | Include operation/status resource |
| Invalid input | `400` or `422` | Depends on validation taxonomy |
| Duplicate idempotency key replay | Same as original | Response replay |
| Unauthorized | `401` | Missing/invalid auth |
| Forbidden | `403` | Authenticated but cannot submit |
| Rate limited | `429` | Include retry guidance |

Example success:

```http
HTTP/1.1 201 Created
Location: /cases/CASE-2026-000123
ETag: "case-v1"
Content-Type: application/json

{
  "id": "CASE-2026-000123",
  "state": "SUBMITTED",
  "regulatedEntityId": "ENT-001",
  "createdAt": "2026-06-19T04:15:30Z"
}
```

## 7.2 Case retrieval

```http
GET /cases/CASE-2026-000123
Accept: application/json
If-None-Match: "case-v17"
```

Possible responses:

| Situation | Status | Notes |
|---|---:|---|
| Found | `200 OK` | Include representation and `ETag` |
| Not modified | `304 Not Modified` | For conditional GET |
| Hidden by authorization policy | `404 Not Found` or `403 Forbidden` | Policy decision |
| Does not exist | `404 Not Found` | Stable problem response |
| Gone/retired | `410 Gone` | If policy uses tombstones |

## 7.3 Case update

For full replacement:

```http
PUT /cases/CASE-2026-000123
If-Match: "case-v17"
Content-Type: application/json
```

For partial update:

```http
PATCH /cases/CASE-2026-000123
If-Match: "case-v17"
Content-Type: application/merge-patch+json
```

Possible responses:

| Situation | Status | Notes |
|---|---:|---|
| Updated and representation returned | `200 OK` | Include new ETag |
| Updated, no body | `204 No Content` | Include new ETag if useful |
| Missing required precondition | `428 Precondition Required` | Enforce optimistic concurrency |
| Version mismatch | `412 Precondition Failed` | Prevent lost update |
| Domain conflict | `409 Conflict` | State does not permit operation |
| Invalid patch | `400` or `422` | Problem details |

## 7.4 Decision creation

```http
POST /cases/CASE-2026-000123/decision
Idempotency-Key: 7de1c6ca-...
If-Match: "case-v23"
Content-Type: application/json
```

Request:

```json
{
  "outcome": "VIOLATION_CONFIRMED",
  "sanctionCode": "ADMIN_FINE",
  "fineAmount": {
    "currency": "IDR",
    "amount": "25000000.00"
  },
  "rationale": "The regulated entity failed to submit the required report."
}
```

Possible responses:

| Situation | Status | Notes |
|---|---:|---|
| Decision created | `201 Created` | `Location: /cases/{id}/decision` |
| Decision already exists from same idempotency key | Same as original | Replay |
| Decision already exists from another request | `409 Conflict` | Domain conflict |
| Case version mismatch | `412 Precondition Failed` | Lost update prevention |
| Missing precondition | `428 Precondition Required` | Required for workflow decision |
| User lacks authority | `403 Forbidden` | Authorization failure |
| Case not in decidable state | `409 Conflict` | State machine guard |

---

## 8. Representation Design

A case representation should be stable, explicit, and authorization-aware.

Example:

```json
{
  "id": "CASE-2026-000123",
  "state": "INVESTIGATION_OPEN",
  "regulatedEntity": {
    "id": "ENT-001",
    "displayName": "Example Financial Services Ltd."
  },
  "summary": "Quarterly report was not submitted.",
  "priority": "HIGH",
  "assignedInvestigator": {
    "id": "USR-778",
    "displayName": "A. Investigator"
  },
  "version": 17,
  "createdAt": "2026-06-19T04:15:30Z",
  "updatedAt": "2026-06-19T09:20:12Z",
  "links": {
    "self": "/cases/CASE-2026-000123",
    "evidence": "/cases/CASE-2026-000123/evidence",
    "auditEvents": "/cases/CASE-2026-000123/audit-events",
    "reviews": "/cases/CASE-2026-000123/reviews"
  },
  "allowedActions": [
    "ADD_EVIDENCE",
    "SUBMIT_FOR_REVIEW",
    "ESCALATE"
  ]
}
```

Important representation choices:

- `id` is stable external identity.
- `state` is explicit, not inferred from nullable fields.
- `version` supports optimistic concurrency, though `ETag` is the HTTP-facing validator.
- `links` reduce client hardcoding.
- `allowedActions` are convenience hints, not authorization guarantees.
- Sensitive fields must be omitted or masked based on authorization.
- Audit-only fields should be clear and immutable.

## 8.1 Do not leak internal persistence model

Bad:

```json
{
  "case_tbl_id": 991827,
  "entity_fk": 9981,
  "status_cd": "S03",
  "row_version": 17
}
```

Better:

```json
{
  "id": "CASE-2026-000123",
  "regulatedEntityId": "ENT-001",
  "state": "INVESTIGATION_OPEN",
  "version": 17
}
```

External contracts should reflect domain language, not database leakage.

---

## 9. Error Model

Use a consistent Problem Details style response.

Example validation error:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json
Traceparent: 00-...

{
  "type": "https://api.example.gov/problems/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "The request contains invalid fields.",
  "instance": "/cases",
  "errorCode": "CASE_VALIDATION_FAILED",
  "correlationId": "req-9f1a...",
  "fieldErrors": [
    {
      "field": "regulatedEntityId",
      "code": "REQUIRED",
      "message": "regulatedEntityId is required."
    },
    {
      "field": "summary",
      "code": "TOO_SHORT",
      "message": "summary must contain at least 20 characters."
    }
  ]
}
```

Example concurrency error:

```http
HTTP/1.1 412 Precondition Failed
Content-Type: application/problem+json

{
  "type": "https://api.example.gov/problems/precondition-failed",
  "title": "Resource version mismatch",
  "status": 412,
  "detail": "The case has changed since the version used by the client.",
  "errorCode": "CASE_VERSION_MISMATCH",
  "currentResource": "/cases/CASE-2026-000123"
}
```

Example state conflict:

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.gov/problems/invalid-case-transition",
  "title": "Invalid case transition",
  "status": 409,
  "detail": "A decision cannot be created while the case is in INVESTIGATION_OPEN state.",
  "errorCode": "CASE_TRANSITION_NOT_ALLOWED",
  "currentState": "INVESTIGATION_OPEN",
  "requiredStates": ["DECISION_PENDING"]
}
```

## 9.1 Error taxonomy

Define stable error categories:

```text
AUTHENTICATION_FAILED
AUTHORIZATION_DENIED
VALIDATION_FAILED
RESOURCE_NOT_FOUND
RESOURCE_CONFLICT
PRECONDITION_REQUIRED
PRECONDITION_FAILED
IDEMPOTENCY_CONFLICT
RATE_LIMITED
UNSUPPORTED_MEDIA_TYPE
NOT_ACCEPTABLE
PAYLOAD_TOO_LARGE
DEPENDENCY_TIMEOUT
DEPENDENCY_UNAVAILABLE
INTERNAL_ERROR
```

Each category should map to:

- status code,
- problem type URI,
- log level,
- metric label,
- retry guidance,
- security redaction policy,
- audit relevance.

---

## 10. Validation Model

Validation must be layered.

```text
HTTP boundary validation
  -> media type
  -> body size
  -> JSON syntax
  -> DTO structure
  -> field constraints
  -> semantic request validation
  -> authorization-sensitive validation
  -> domain invariant validation
  -> persistence constraints
```

Example for creating a decision:

1. `Content-Type` must be `application/json`.
2. Body must not exceed configured limit.
3. JSON must parse.
4. Required fields must exist.
5. `outcome` must be known.
6. `fineAmount` must be valid if `sanctionCode` requires a fine.
7. Caller must be allowed to decide this case.
8. Case must be in `DECISION_PENDING`.
9. Case must match `If-Match` version.
10. Decision must not already exist.
11. Domain policy must validate sanction constraints.
12. Transaction must atomically persist decision, case transition, audit event, and outbox event.

A production system does not put all of this into controller annotations. Bean Validation handles structure. Domain services handle invariants. Authorization service handles access policy. Persistence handles uniqueness and transaction integrity.

---

## 11. Authorization Model

Roles:

```text
INTAKE_OFFICER
INVESTIGATOR
SUPERVISOR
LEGAL_REVIEWER
ENFORCEMENT_DIRECTOR
RESPONDENT_REPRESENTATIVE
EXTERNAL_AGENCY_CLIENT
AUDITOR
SYSTEM_ADMIN
```

But roles are not enough. Authorization must include:

- tenant/agency boundary,
- assigned investigator relationship,
- case sensitivity classification,
- case state,
- operation type,
- field/resource sensitivity,
- delegation,
- conflict-of-interest restrictions,
- external respondent visibility.

## 11.1 Authorization examples

| Operation | Required policy |
|---|---|
| `GET /cases/{id}` | User can view case metadata for agency/tenant and sensitivity level |
| `GET /cases/{id}/evidence/{evidenceId}` | User can view evidence and evidence is not sealed/restricted |
| `POST /cases/{id}/evidence` | User is assigned investigator or supervisor in allowed state |
| `POST /cases/{id}/decision` | User is enforcement director or delegated approver, no conflict, case in `DECISION_PENDING` |
| `GET /cases/{id}/audit-events` | User is auditor/admin/supervisor with audit visibility |
| `POST /cases/{id}/appeals` | Respondent representative is linked to entity and appeal window is open |

## 11.2 Query filtering is authorization too

For list endpoints:

```http
GET /cases?state=INVESTIGATION_OPEN
```

Do not fetch all cases and filter after serialization.

Better:

```sql
SELECT *
FROM cases c
WHERE c.state = ?
  AND c.agency_id IN (:authorizedAgencyIds)
  AND c.sensitivity_level <= :maxUserSensitivity
  AND EXISTS (...relationship policy...)
ORDER BY c.updated_at DESC
LIMIT ?
```

Authorization should shape the query.

---

## 12. Idempotency Model

Any operation that creates a durable business effect and may be retried should support idempotency.

Examples:

```text
POST /cases
POST /cases/{id}/evidence
POST /cases/{id}/decision
POST /cases/{id}/appeals
POST /case-exports
POST /external-submissions
POST /webhook-subscriptions
```

## 12.1 Idempotency-key behavior

Request:

```http
POST /cases/CASE-2026-000123/decision
Idempotency-Key: 2c68d31e-d5e5-4e6e-98e6-6b9fb3251f52
If-Match: "case-v23"
```

Server stores:

```text
scope: tenant + principal/client + endpoint + idempotency key
request fingerprint: hash(method + uri + normalized body + relevant headers)
status: IN_PROGRESS | COMPLETED | FAILED_RETRYABLE | FAILED_FINAL
response status
response headers
response body summary or full response
created_at
expires_at
```

Rules:

1. Same key + same fingerprint returns same result.
2. Same key + different fingerprint returns `409 Conflict` or `422` with idempotency-specific problem.
3. Concurrent same key should wait, reject, or return in-progress status depending on policy.
4. Key must expire after a documented retention window.
5. Do not scope idempotency globally across all users.
6. Never use idempotency key as authorization proof.
7. Persist idempotency record transactionally with domain effect.

---

## 13. Optimistic Concurrency Model

For mutable case resources, require conditional requests.

```http
GET /cases/CASE-2026-000123
```

Response:

```http
ETag: "case-v17"
```

Update:

```http
PATCH /cases/CASE-2026-000123
If-Match: "case-v17"
Content-Type: application/merge-patch+json
```

If the case is now version 18:

```http
HTTP/1.1 412 Precondition Failed
```

For critical workflow commands, require `If-Match` too:

```http
POST /cases/CASE-2026-000123/decision
If-Match: "case-v23"
Idempotency-Key: ...
```

Why require it?

Because workflow commands often depend on the state the user saw. Without preconditions, a user can unknowingly approve stale information.

## 13.1 Database mapping

Internal table:

```text
cases
  id
  state
  version
  updated_at
```

HTTP ETag:

```text
ETag = "case-v" + version
```

Update SQL:

```sql
UPDATE cases
SET state = ?, version = version + 1, updated_at = now()
WHERE id = ? AND version = ?;
```

If updated rows = 0, map to `412` if `If-Match` was supplied, or `409` if domain conflict discovered without precondition semantics.

---

## 14. Caching Model

Most regulatory case data is sensitive and user-specific.

Default:

```http
Cache-Control: no-store
```

For authenticated case detail responses containing sensitive information, `no-store` is usually safest.

For low-sensitivity reference data:

```http
GET /reference/allegation-types
```

Response:

```http
Cache-Control: public, max-age=3600
ETag: "allegation-types-v12"
Vary: Accept-Language
```

For user-specific dashboard summaries:

```http
Cache-Control: private, no-cache
ETag: "dashboard-user-123-v44"
```

Use cache consciously:

| Resource | Cache policy |
|---|---|
| Case detail | `no-store` or `private, no-cache` depending sensitivity |
| Evidence metadata | Usually `no-store` |
| Evidence binary download | Signed/authorized URL with strict headers |
| Reference codes | `public, max-age`, validators |
| Audit events | Usually `no-store`, maybe private validator |
| Static API metadata | Cacheable |
| Search results | Usually private, short-lived, or no-store |

Never let shared caches store user-specific sensitive data accidentally.

---

## 15. File Evidence Design

Evidence upload should not be a naive multipart field attached to case update.

Better lifecycle:

```text
1. Client creates upload session
2. Client uploads file directly or through backend
3. System validates size/type/hash
4. Malware scanner processes file
5. Evidence metadata becomes AVAILABLE or REJECTED
6. Audit event is appended
```

## 15.1 Create upload session

```http
POST /cases/CASE-2026-000123/evidence-upload-sessions
Idempotency-Key: ...
Content-Type: application/json
```

Request:

```json
{
  "filename": "bank-statement.pdf",
  "declaredContentType": "application/pdf",
  "sizeBytes": 3829912,
  "sha256": "...",
  "evidenceType": "FINANCIAL_RECORD"
}
```

Response:

```http
HTTP/1.1 201 Created
Location: /cases/CASE-2026-000123/evidence-upload-sessions/UP-001
```

```json
{
  "uploadSessionId": "UP-001",
  "status": "READY_FOR_UPLOAD",
  "uploadUrl": "https://object-storage.example/upload/temporary-signed-url",
  "expiresAt": "2026-06-19T10:00:00Z"
}
```

## 15.2 Evidence metadata resource

```http
GET /cases/CASE-2026-000123/evidence/EV-001
```

```json
{
  "id": "EV-001",
  "filename": "bank-statement.pdf",
  "contentType": "application/pdf",
  "sizeBytes": 3829912,
  "sha256": "...",
  "status": "AVAILABLE",
  "scanStatus": "CLEAN",
  "uploadedBy": "USR-778",
  "uploadedAt": "2026-06-19T05:12:00Z"
}
```

## 15.3 Secure download

```http
GET /cases/CASE-2026-000123/evidence/EV-001/content
```

Response headers:

```http
Content-Type: application/pdf
Content-Disposition: attachment; filename="bank-statement.pdf"
Cache-Control: no-store
X-Content-Type-Options: nosniff
```

Rules:

- Recheck authorization at download time.
- Do not trust original filename blindly.
- Do not serve unscanned file as available.
- Do not log signed URLs or file content.
- Consider `Range` support for large files.
- Separate metadata authorization from content authorization if needed.

---

## 16. Async Operations

Some operations cannot be completed synchronously.

Examples:

- large export,
- external agency submission,
- bulk reassignment,
- report generation,
- evidence malware scan,
- data reconciliation.

Use job resources.

## 16.1 Create export

```http
POST /case-exports
Idempotency-Key: ...
Content-Type: application/json
```

Request:

```json
{
  "criteria": {
    "states": ["DECIDED", "FINALIZED"],
    "decidedAfter": "2026-01-01T00:00:00Z"
  },
  "format": "CSV"
}
```

Response:

```http
HTTP/1.1 202 Accepted
Location: /case-exports/EXP-001
Retry-After: 10
```

```json
{
  "id": "EXP-001",
  "status": "QUEUED",
  "statusUrl": "/case-exports/EXP-001"
}
```

## 16.2 Poll export

```http
GET /case-exports/EXP-001
```

```json
{
  "id": "EXP-001",
  "status": "COMPLETED",
  "downloadUrl": "/case-exports/EXP-001/content",
  "expiresAt": "2026-06-20T00:00:00Z"
}
```

Do not hold a synchronous HTTP connection open for huge exports unless streaming is explicitly intended and operationally supported.

---

## 17. Rate Limiting and Abuse Control

For this platform, limits should not be one-dimensional.

Dimensions:

```text
tenant
user
client application
IP / network
endpoint
operation cost
evidence size
export complexity
search complexity
concurrent jobs
```

Examples:

| Operation | Limit type |
|---|---|
| Login/session creation | IP + account rate limit |
| Case search | user + tenant + query complexity limit |
| Evidence upload | tenant storage quota + upload concurrency |
| Export creation | user daily quota + tenant concurrency |
| Decision creation | not high rate, but strict auth/audit |
| Webhook delivery | outbound rate limit per subscriber |

Responses:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/problem+json
```

```json
{
  "type": "https://api.example.gov/problems/rate-limited",
  "title": "Too many requests",
  "status": 429,
  "detail": "The export creation quota has been exceeded.",
  "errorCode": "EXPORT_QUOTA_EXCEEDED"
}
```

Use `503` for service-wide overload/load shedding, not per-client quota.

---

## 18. Timeout and Retry Budget

A production API needs an end-to-end timeout budget.

Example inbound request budget:

```text
Client timeout: 10s
CDN/gateway timeout: 9s
Application request timeout: 8s
Database query timeout: 3s
Outbound dependency timeout: 2s
Internal queue wait limit: 100ms-500ms depending endpoint
```

Rules:

1. Downstream timeouts must be shorter than upstream timeouts.
2. Retries must only be used when operation is safe or idempotent.
3. Retry count and timeout must fit within the total deadline.
4. Long-running work should move to async job resources.
5. Client disconnect should cancel unnecessary work when safe.
6. Server overload should reject early, not queue forever.
7. Bulkheads should isolate evidence upload, exports, search, and core workflow commands.

---

## 19. Observability Design

Every request should be diagnosable.

## 19.1 Logs

Access log fields:

```text
timestamp
method
route_template
status
latency_ms
response_size
request_size
principal_id_hash
tenant_id
client_id
correlation_id
trace_id
user_agent_class
remote_ip_resolved
```

Application log fields:

```text
case_id
operation
state_before
state_after
actor_id_hash
policy_decision
error_code
idempotency_key_hash
etag_version
```

Never log:

- raw tokens,
- passwords,
- full evidence content,
- raw PII unless explicitly governed,
- signed URLs,
- sensitive legal rationale if logs are broadly accessible.

## 19.2 Metrics

Core HTTP metrics:

```text
http.server.requests.count
http.server.requests.duration
http.server.errors.count
http.server.request.size
http.server.response.size
```

Useful dimensions:

```text
method
route_template
status_class
status_code
client_type
tenant_tier
```

Avoid high cardinality labels:

```text
case_id
user_id
raw_path
query_string
idempotency_key
```

Domain metrics:

```text
case.transition.count{from,to}
evidence.upload.count{status}
case.decision.count{outcome}
export.job.count{status}
idempotency.replay.count
authorization.denied.count{operation}
precondition.failed.count{operation}
```

## 19.3 Traces

Trace important spans:

```text
HTTP inbound request
  -> authentication
  -> authorization
  -> validation
  -> domain command
  -> database transaction
  -> outbox insert
  -> outbound HTTP call
  -> response serialization
```

A trace should answer:

- where time was spent,
- which dependency failed,
- whether a retry happened,
- whether request was deduplicated,
- whether state transition occurred,
- which policy denied access,
- whether timeout was upstream or downstream.

## 19.4 Audit events

Audit log is not the same as application log.

Audit events must be durable, queryable, and governance-controlled.

Example audit event:

```json
{
  "id": "AUD-001",
  "caseId": "CASE-2026-000123",
  "actorId": "USR-778",
  "action": "CASE_DECISION_CREATED",
  "occurredAt": "2026-06-19T06:30:00Z",
  "stateBefore": "DECISION_PENDING",
  "stateAfter": "DECIDED",
  "sourceIpHash": "...",
  "clientId": "internal-case-portal",
  "correlationId": "req-abc123"
}
```

---

## 20. Security Threat Model

Threats to consider:

1. Broken object-level authorization.
2. Broken function-level authorization.
3. Broken object property-level authorization.
4. Mass assignment.
5. SSRF through URL fields.
6. Evidence file malware.
7. ZIP bombs and decompression bombs.
8. Request smuggling at proxy/app boundary.
9. Host header injection.
10. Cache poisoning.
11. Token leakage in logs.
12. CSRF for browser-based cookie sessions.
13. CORS misconfiguration.
14. Replay attacks.
15. Idempotency key abuse.
16. Search/export data exfiltration.
17. Overly verbose error messages.
18. Audit log tampering.
19. Privilege escalation through workflow transition gaps.
20. External webhook spoofing.

Security design should not rely on one layer.

```text
CDN/WAF
  -> gateway validation
  -> authentication
  -> app authorization
  -> domain policy
  -> query-level filtering
  -> database constraints
  -> audit events
  -> observability/alerting
```

---

## 21. Gateway and Proxy Contract

A production API should document what the application expects from the edge.

Example edge responsibilities:

- terminate TLS,
- enforce maximum header size,
- enforce maximum body size per route,
- normalize trusted forwarding headers,
- reject malformed requests,
- apply coarse rate limits,
- apply WAF rules,
- route based on stable path prefixes,
- attach request ID if absent,
- forward trace context,
- preserve `Host` only when trusted,
- avoid unsafe retries on non-idempotent methods.

Application responsibilities:

- do not blindly trust client-supplied forwarding headers,
- enforce authorization again,
- validate domain semantics,
- apply object-level security,
- handle idempotency,
- handle preconditions,
- generate audit events,
- return stable error responses.

---

## 22. OpenAPI Contract Sketch

A production OpenAPI document should describe more than paths and JSON shapes.

It should document:

- authentication schemes,
- authorization notes,
- idempotency header,
- ETag/If-Match behavior,
- pagination model,
- rate-limit responses,
- Problem Details schemas,
- error codes,
- media types,
- file upload/download behavior,
- async job resources,
- deprecation/sunset policy,
- examples.

Example excerpt conceptually:

```yaml
paths:
  /cases/{caseId}/decision:
    post:
      summary: Create a decision for a case
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
        - name: Idempotency-Key
          in: header
          required: true
          schema:
            type: string
        - name: If-Match
          in: header
          required: true
          schema:
            type: string
      responses:
        '201':
          description: Decision created
        '409':
          description: Case state does not permit decision
        '412':
          description: Case version mismatch
        '428':
          description: Missing required precondition
```

OpenAPI is not the design itself. It is the machine-readable representation of the design.

---

## 23. Spring MVC Implementation Sketch

A simplified controller:

```java
@RestController
@RequestMapping("/cases/{caseId}/decision")
class CaseDecisionController {

    private final CreateDecisionUseCase createDecisionUseCase;

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE,
                 produces = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<DecisionResponse> createDecision(
            @PathVariable String caseId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @RequestHeader("If-Match") String ifMatch,
            @Valid @RequestBody CreateDecisionRequest request,
            Authentication authentication) {

        Actor actor = Actor.from(authentication);

        CreateDecisionCommand command = new CreateDecisionCommand(
                caseId,
                request.outcome(),
                request.sanctionCode(),
                request.fineAmount(),
                request.rationale(),
                EntityTag.parse(ifMatch),
                IdempotencyKey.parse(idempotencyKey),
                actor
        );

        CreateDecisionResult result = createDecisionUseCase.execute(command);

        return ResponseEntity
                .created(URI.create("/cases/" + caseId + "/decision"))
                .eTag(result.newCaseEtag().value())
                .body(DecisionResponse.from(result));
    }
}
```

But the real production value is not in the controller. It is in the use case boundary.

```java
@Service
class CreateDecisionUseCase {

    @Transactional
    public CreateDecisionResult execute(CreateDecisionCommand command) {
        // 1. Validate idempotency key scope/fingerprint.
        // 2. Load case with version.
        // 3. Check authorization policy.
        // 4. Check ETag/If-Match.
        // 5. Check state machine transition.
        // 6. Validate domain decision rules.
        // 7. Persist decision.
        // 8. Transition case state.
        // 9. Append audit event.
        // 10. Insert outbox event.
        // 11. Store idempotency response.
        // 12. Return result.
    }
}
```

## 23.1 Exception mapping

```java
@RestControllerAdvice
class ApiExceptionHandler {

    @ExceptionHandler(PreconditionFailedException.class)
    ResponseEntity<ProblemDetail> preconditionFailed(PreconditionFailedException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.PRECONDITION_FAILED);
        problem.setTitle("Resource version mismatch");
        problem.setDetail("The resource has changed since the version used by the client.");
        problem.setProperty("errorCode", "CASE_VERSION_MISMATCH");
        return ResponseEntity.status(HttpStatus.PRECONDITION_FAILED).body(problem);
    }

    @ExceptionHandler(StateTransitionNotAllowedException.class)
    ResponseEntity<ProblemDetail> invalidTransition(StateTransitionNotAllowedException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setTitle("Invalid case transition");
        problem.setDetail(ex.publicMessage());
        problem.setProperty("errorCode", "CASE_TRANSITION_NOT_ALLOWED");
        return ResponseEntity.status(HttpStatus.CONFLICT).body(problem);
    }
}
```

The exception handler must not leak internal stack traces or SQL details.

---

## 24. WebFlux Implementation Considerations

Use WebFlux when the workload benefits from non-blocking I/O:

- many concurrent long-lived streams,
- SSE event feeds,
- high-volume gateway-style workloads,
- non-blocking database/drivers,
- async integrations.

Do not use WebFlux merely because it is modern.

Rules:

1. Do not block event loops.
2. Do not call blocking JDBC directly on event loop threads.
3. Use reactive repositories or isolate blocking calls carefully.
4. Understand cancellation.
5. Handle backpressure.
6. Avoid leaking `DataBuffer`.
7. Propagate trace/security context correctly.
8. Test reactive chains with cancellation and timeout scenarios.

For core transactional case workflow, Spring MVC + well-tuned thread pools may be simpler and more defensible. For event stream, WebFlux can be a strong fit.

A hybrid architecture is acceptable:

```text
case-command-service: Spring MVC + JDBC/JPA
case-event-stream-service: WebFlux + reactive messaging
api-gateway: Netty/Envoy/Kong/Nginx depending architecture
```

---

## 25. Backend-to-Backend Integration

The platform may call:

- identity provider,
- external agency API,
- document scanning service,
- notification service,
- object storage,
- reporting system,
- payment/fine collection API.

Each outbound client should be wrapped as a typed dependency.

```java
interface ExternalAgencyClient {
    ExternalSubmissionResult submitCase(ExternalSubmissionRequest request);
}
```

Client wrapper responsibilities:

- set base URL safely,
- enforce timeouts,
- apply retry policy only when safe,
- attach trace context,
- attach authentication,
- map errors to domain-specific exceptions,
- avoid token leakage in logs,
- expose metrics by dependency and operation,
- support test doubles.

Avoid scattering `WebClient` or `RestClient` calls across domain services.

---

## 26. Testing Strategy

A production-grade HTTP API needs multiple test layers.

## 26.1 Contract tests

Validate:

- status codes,
- headers,
- response shapes,
- error shapes,
- Problem Details fields,
- idempotency behavior,
- ETag behavior,
- pagination,
- auth failure responses.

## 26.2 Authorization tests

Matrix by:

- role,
- tenant,
- relationship to case,
- case state,
- sensitivity level,
- operation,
- field/resource visibility.

Example:

```text
Given case sensitivity = SEALED
And user role = INVESTIGATOR
And user is not assigned
When GET /cases/{id}/evidence/{evidenceId}
Then response is 403 or 404 according to hiding policy
And no evidence metadata is leaked
```

## 26.3 Idempotency tests

Test:

- same key same payload,
- same key different payload,
- concurrent same key,
- timeout after commit,
- retry after process restart,
- key expiration.

## 26.4 Concurrency tests

Test:

- stale `If-Match`,
- missing `If-Match`,
- two supervisors deciding at same time,
- update while evidence scan completes,
- appeal submission while case closes.

## 26.5 Security tests

Test:

- IDOR/BOLA,
- mass assignment,
- SSRF fields,
- path traversal filenames,
- large body,
- malformed JSON,
- duplicate headers,
- host header manipulation,
- CORS misconfiguration,
- CSRF for cookie-based flows.

## 26.6 Operational tests

Test:

- gateway timeout,
- downstream timeout,
- client disconnect,
- slow upload,
- slow download,
- overload/load shedding,
- dependency unavailable,
- partial failure with outbox.

---

## 27. Deployment and Runtime Checklist

Before production:

### HTTP semantics

- [ ] Method semantics are documented.
- [ ] Status code matrix exists.
- [ ] Error model is consistent.
- [ ] Media types are explicit.
- [ ] Unsupported content returns `415`.
- [ ] Unsupported accept returns `406` where appropriate.
- [ ] Unsafe operations are not exposed through GET.

### Correctness

- [ ] Idempotency is implemented for retry-sensitive commands.
- [ ] Optimistic concurrency uses `ETag`/`If-Match`.
- [ ] State transition guards are enforced in domain layer.
- [ ] Validation is layered.
- [ ] Partial update semantics are explicit.

### Security

- [ ] Authentication is verified.
- [ ] Authorization is resource-level and query-level.
- [ ] Sensitive cache headers are correct.
- [ ] CORS is least-privilege.
- [ ] CSRF is handled for cookie sessions.
- [ ] Headers are hardened.
- [ ] Request size limits exist.
- [ ] File upload is scanned and constrained.
- [ ] Logs redact secrets and PII.

### Operations

- [ ] Timeouts are aligned end-to-end.
- [ ] Retry policy is idempotency-aware.
- [ ] Load shedding exists.
- [ ] Rate limits and quotas exist.
- [ ] Metrics use route templates, not raw paths.
- [ ] Tracing propagates across services.
- [ ] Access logs, app logs, and audit logs are distinct.
- [ ] Health checks reflect dependency policy.

### Evolution

- [ ] OpenAPI contract exists.
- [ ] Breaking-change policy exists.
- [ ] Deprecation and sunset policy exists.
- [ ] Contract tests exist.
- [ ] Client migration strategy exists.

---

## 28. Common Capstone Anti-Patterns

## 28.1 Everything is PATCH

```http
PATCH /cases/{id}
{ "status": "DECIDED" }
```

This hides workflow semantics, authorization, audit, and validation.

## 28.2 Everything is POST action

```text
POST /cases/{id}/approve
POST /cases/{id}/reject
POST /cases/{id}/finish
POST /cases/{id}/do-review
```

This may be acceptable in limited cases, but often becomes ungoverned verb soup. Prefer durable resources and domain concepts.

## 28.3 Always returning 200

Bad:

```json
{ "success": false, "error": "Not authorized" }
```

with `200 OK`.

This breaks clients, metrics, retries, security semantics, and monitoring.

## 28.4 Authorization only in UI

If the backend does not enforce object-level authorization, the system is insecure even if the frontend hides buttons.

## 28.5 No idempotency on critical POST

Payment, decision, submission, appeal, export, and external integration requests can be retried. Pretending retries do not happen creates duplicate business effects.

## 28.6 No concurrency control

Workflow systems without version checks invite lost updates and stale approvals.

## 28.7 Logs as audit trail

Application logs are not a sufficient legal audit trail. Audit events need governance, durability, access control, and retention rules.

## 28.8 Framework-driven API design

If the API shape mirrors controller convenience instead of domain contract, the system will be brittle.

---

## 29. Final Mental Model

A top-tier backend engineer sees an HTTP API as five overlapping contracts.

```text
Semantic contract
  What does this method/resource/status/header mean?

Domain contract
  What business operation or state transition occurs?

Security contract
  Who can do it, under which context, and what is hidden?

Reliability contract
  What happens under retry, timeout, duplicate request, stale version, or partial failure?

Operational contract
  How do we observe, debug, audit, evolve, and defend it in production?
```

Most API bugs happen because one of these contracts is implicit.

Make them explicit.

---

## 30. End-to-End Example: Decision Creation Flow

Full flow:

```text
Client
  -> POST /cases/{id}/decision
     Authorization: Bearer ...
     Idempotency-Key: ...
     If-Match: "case-v23"

Gateway
  -> validates TLS, size, route, coarse rate limit
  -> normalizes forwarding headers
  -> forwards trace context

Application HTTP layer
  -> authenticates principal
  -> parses JSON
  -> validates DTO
  -> extracts idempotency key and ETag

Use case
  -> starts transaction
  -> checks idempotency scope/fingerprint
  -> loads case by ID and version
  -> authorizes actor for decision operation
  -> validates If-Match
  -> validates state transition
  -> validates decision domain rules
  -> persists decision
  -> updates case state/version
  -> appends audit event
  -> inserts outbox event
  -> stores idempotency response
  -> commits transaction

Outbox worker
  -> publishes CaseDecided event
  -> sends notifications/webhooks with retry-safe delivery

Response
  -> 201 Created
  -> Location: /cases/{id}/decision
  -> ETag: "case-v24"
  -> problem response if anything failed predictably

Observability
  -> access log
  -> app log
  -> domain metric
  -> trace spans
  -> audit event
```

This is what production-grade HTTP backend design looks like: not merely a controller method, but a full contract through layers.

---

## 31. Capstone Exercises

### Exercise 1 — Design appeal submission

Design:

```http
POST /cases/{caseId}/appeals
```

Specify:

- required headers,
- request body,
- status codes,
- idempotency behavior,
- authorization policy,
- state transition rules,
- audit event,
- error responses.

### Exercise 2 — Design evidence deletion

Should evidence deletion be:

```http
DELETE /cases/{caseId}/evidence/{evidenceId}
```

or:

```http
POST /cases/{caseId}/evidence/{evidenceId}/removals
```

Reason through:

- legal retention,
- tombstone vs physical delete,
- auditability,
- authorization,
- state constraints,
- idempotency,
- response codes.

### Exercise 3 — Design bulk reassignment

Design an async endpoint for reassigning 10,000 cases from one investigator to another.

Include:

- job resource,
- validation,
- authorization,
- partial failure report,
- idempotency,
- progress polling,
- cancellation,
- audit trail.

### Exercise 4 — Model stale approval

Two supervisors open the same case at version 17. Supervisor A returns it for more information. Supervisor B tries to approve it using version 17.

Specify:

- HTTP request,
- expected status,
- error response,
- domain behavior,
- observability signal.

### Exercise 5 — Threat model export API

Threat model:

```http
POST /case-exports
```

Consider:

- query complexity,
- data exfiltration,
- authorization filtering,
- async job abuse,
- storage exposure,
- signed URL leakage,
- rate limit,
- audit event.

---

## 32. Final Rubric: Top 1% HTTP Backend Engineer

You are operating at a high level when you can do all of this without relying on templates:

1. Explain HTTP semantics independent of framework.
2. Choose methods based on safety, idempotency, and resource meaning.
3. Use status codes as state contracts.
4. Design stable representations and media-type behavior.
5. Separate parsing, validation, authorization, and domain invariants.
6. Use Problem Details-style errors safely and consistently.
7. Design idempotency for retry-prone commands.
8. Prevent lost updates with conditional requests.
9. Use caching without leaking sensitive data.
10. Distinguish authentication, authorization, CSRF, and CORS.
11. Design object-level and field-level authorization.
12. Model rate limits, quotas, and load shedding.
13. Align timeouts and retry budgets end-to-end.
14. Handle file upload/download without memory or security failures.
15. Use streaming/async responses intentionally.
16. Understand HTTP/1.1, HTTP/2, and HTTP/3 operational impact.
17. Treat proxies/gateways as trust boundaries.
18. Choose API style based on domain, not fashion.
19. Evolve contracts without breaking clients unnecessarily.
20. Make logs, metrics, traces, and audit events meaningful.
21. Harden HTTP response and request surfaces.
22. Threat-model HTTP-specific attacks.
23. Map HTTP concepts to Servlet/Spring MVC internals.
24. Use WebFlux only when the workload justifies it.
25. Build safe backend-to-backend HTTP clients.
26. Integrate all of the above into a production-grade API design.

---

## 33. Series Completion

This is the final part of the series:

```text
learn-http-for-web-backend-perspective-part-032.md
```

The series **HTTP for Web / Backend Perspective** is now complete.

Recommended next series:

1. `learn-production-api-architecture-with-spring-boot`
2. `learn-api-security-engineering`
3. `learn-backend-reliability-patterns`
4. `learn-distributed-workflow-saga-and-state-machine-architecture`
5. `learn-observability-engineering-with-opentelemetry`
6. `learn-api-gateway-and-edge-architecture`
7. `learn-contract-testing-and-api-governance`
8. `learn-regulatory-case-management-system-architecture`

---

# Closing Thought

HTTP backend engineering is not about memorizing endpoint patterns.

It is about making distributed system behavior explicit at the boundary where clients, proxies, users, services, attackers, auditors, and operators all meet.

A controller is just the visible surface.

The real design is the contract behind it.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-031.md">⬅️ HTTP for Web/Backend Perspective — Part 031</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
