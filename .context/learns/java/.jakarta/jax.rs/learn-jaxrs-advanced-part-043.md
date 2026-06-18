# learn-jaxrs-advanced-part-043.md

# Bagian 043 — REST API Design for Enterprise Domains: Aggregate and Resource Modeling, Command vs Resource Endpoints, Workflows, State Machines, Domain Errors, Idempotency, Tenant/Security Boundaries, Event/Outbox Integration, and Long-Term Evolvability

> Target pembaca: Java/Jakarta engineer yang ingin mendesain **REST API untuk domain enterprise** secara serius, bukan sekadar CRUD table-to-endpoint. Fokus bagian ini adalah bagaimana memodelkan domain sebagai resource, kapan memakai command/action endpoint, bagaimana menangani workflow/state machine, domain invariant, idempotency, optimistic concurrency, long-running operation, tenant boundary, authorization, event/outbox, error taxonomy, versioning, dan evolvability jangka panjang.
>
> Prinsip utama:
>
> ```text
> REST API enterprise yang baik bukan “database over HTTP”.
> Ia adalah public contract untuk mengoperasikan domain model secara aman, konsisten, dan evolvable.
> ```

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: REST API sebagai Domain Contract](#2-mental-model-rest-api-sebagai-domain-contract)
3. [Resource ≠ Table](#3-resource--table)
4. [Aggregate, Entity, Value Object, Read Model](#4-aggregate-entity-value-object-read-model)
5. [Resource Modeling dari Domain](#5-resource-modeling-dari-domain)
6. [Noun Resource vs Verb Command](#6-noun-resource-vs-verb-command)
7. [CRUD is Not Enough](#7-crud-is-not-enough)
8. [Command Endpoints yang RESTful-Pragmatic](#8-command-endpoints-yang-restful-pragmatic)
9. [Workflow and State Machine Modeling](#9-workflow-and-state-machine-modeling)
10. [State Transition Endpoints](#10-state-transition-endpoints)
11. [Subresources](#11-subresources)
12. [Collection Resources](#12-collection-resources)
13. [Singleton Resources](#13-singleton-resources)
14. [Search Resources](#14-search-resources)
15. [Operation Resources for Long-Running Work](#15-operation-resources-for-long-running-work)
16. [POST, PUT, PATCH, DELETE Semantics](#16-post-put-patch-delete-semantics)
17. [Create Semantics](#17-create-semantics)
18. [Update Semantics](#18-update-semantics)
19. [PATCH Semantics](#19-patch-semantics)
20. [Delete Semantics](#20-delete-semantics)
21. [Idempotency](#21-idempotency)
22. [Optimistic Concurrency: ETag and If-Match](#22-optimistic-concurrency-etag-and-if-match)
23. [Domain Errors](#23-domain-errors)
24. [Problem Details and Error Taxonomy](#24-problem-details-and-error-taxonomy)
25. [Validation vs Domain Invariant](#25-validation-vs-domain-invariant)
26. [Authorization as Domain Constraint](#26-authorization-as-domain-constraint)
27. [Tenant Boundary](#27-tenant-boundary)
28. [Data Exposure and DTO Redaction](#28-data-exposure-and-dto-redaction)
29. [Pagination, Filtering, Sorting for Enterprise Data](#29-pagination-filtering-sorting-for-enterprise-data)
30. [Consistency Models](#30-consistency-models)
31. [Read-After-Write Behavior](#31-read-after-write-behavior)
32. [CQRS and Read Models](#32-cqrs-and-read-models)
33. [Events and Outbox](#33-events-and-outbox)
34. [Audit Trail](#34-audit-trail)
35. [Hypermedia and Affordances](#35-hypermedia-and-affordances)
36. [Versioning and Evolvability](#36-versioning-and-evolvability)
37. [Backward Compatibility Rules](#37-backward-compatibility-rules)
38. [API Boundary and Microservices](#38-api-boundary-and-microservices)
39. [Aggregate Boundaries vs Service Boundaries](#39-aggregate-boundaries-vs-service-boundaries)
40. [Anti-Corruption Layer](#40-anti-corruption-layer)
41. [API Gateway and BFF Considerations](#41-api-gateway-and-bff-considerations)
42. [OpenAPI as Design Artifact](#42-openapi-as-design-artifact)
43. [Testing Enterprise API Design](#43-testing-enterprise-api-design)
44. [Observability for Domain APIs](#44-observability-for-domain-apis)
45. [Example: Licensing Application Domain](#45-example-licensing-application-domain)
46. [Example: Case Management Domain](#46-example-case-management-domain)
47. [Example: Document Upload Domain](#47-example-document-upload-domain)
48. [Design Review Checklist](#48-design-review-checklist)
49. [Common Failure Modes](#49-common-failure-modes)
50. [Best Practices](#50-best-practices)
51. [Anti-Patterns](#51-anti-patterns)
52. [Production Checklist](#52-production-checklist)
53. [Latihan](#53-latihan)
54. [Referensi Resmi](#54-referensi-resmi)
55. [Penutup](#55-penutup)

---

# 1. Tujuan Part Ini

Banyak REST API enterprise dimulai seperti ini:

```text
/customers
/orders
/invoices
/applications
/cases
/documents
```

Lalu berubah menjadi:

```text
/updateStatus
/approve
/reject
/submit
/assign
/doAction
/process
/save
/deleteRecord
/searchAdvanced
```

Masalahnya bukan sekadar nama endpoint jelek.

Masalahnya adalah domain tidak dimodelkan.

Akibatnya:

- endpoint menjadi CRUD database;
- workflow tersebar di frontend;
- domain invariant tidak jelas;
- status transition tidak aman;
- authorization tidak konsisten;
- idempotency tidak dipikirkan;
- error tidak stabil;
- event dan audit sulit dipercaya;
- API sulit dievolusi;
- microservice boundary kabur.

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- memodelkan REST API dari domain, bukan table;
- membedakan resource, aggregate, command, operation, read model;
- menentukan kapan memakai CRUD, kapan command endpoint;
- mendesain workflow/state transition endpoint;
- memakai HTTP method semantics dengan benar;
- membuat idempotent write;
- menghubungkan ETag/If-Match dengan optimistic locking;
- mendesain domain error taxonomy;
- menjaga tenant/security boundary;
- mengintegrasikan outbox/event/audit;
- mendesain API yang evolvable bertahun-tahun.

---

# 2. Mental Model: REST API sebagai Domain Contract

REST API adalah kontrak antara consumer dan domain capability.

Bukan:

```text
HTTP wrapper around repository
```

Tetapi:

```text
A stable interface for performing domain operations and reading domain state.
```

## 2.1 Domain capability

Contoh domain licensing:

- create application draft;
- submit application;
- withdraw application;
- request amendment;
- approve application;
- reject application;
- upload supporting document;
- check application status.

## 2.2 REST representation

API harus mempresentasikan state dan affordance:

```json
{
  "id": "APP-2026-0001",
  "status": "DRAFT",
  "applicantName": "Fajar",
  "_links": {
    "self": { "href": "/applications/APP-2026-0001" },
    "submit": { "href": "/applications/APP-2026-0001/submission" }
  }
}
```

## 2.3 Rule

Design around what the domain can do and what consumers need to know.

---

# 3. Resource ≠ Table

Database table:

```text
applications
application_status_history
application_documents
application_remarks
```

REST resources might be:

```text
/applications/{id}
/applications/{id}/submission
/applications/{id}/documents
/applications/{id}/timeline
/applications/{id}/decision
```

## 3.1 Why not table-to-endpoint?

Because table structure is implementation detail.

If API mirrors tables:

- DB refactor breaks API;
- normalized data leaks;
- consumer must assemble domain meaning;
- authorization becomes scattered;
- invariants are easy to bypass.

## 3.2 Rule

Resource is a domain-facing concept, not necessarily one database table.

---

# 4. Aggregate, Entity, Value Object, Read Model

## 4.1 Aggregate

Consistency boundary.

Example:

```text
Application aggregate
```

Contains status, applicant, selected license type, declarations, version.

## 4.2 Entity

Object with identity inside domain.

Example:

```text
Document
CaseNote
Address
```

## 4.3 Value object

No identity, equality by value.

Example:

```text
EmailAddress
Money
DateRange
PostalAddress
```

## 4.4 Read model

Optimized representation for query/consumer.

Example:

```text
ApplicationListItem
CaseDashboardSummary
```

## 4.5 Rule

Resource design should respect aggregate consistency and read model needs.

---

# 5. Resource Modeling dari Domain

Start with domain language.

Ask:

```text
Apa nouns utama?
Apa lifecycle state?
Apa actions/transitions?
Apa relationships?
Apa views/searches?
Apa invariants?
Apa permissions?
Apa events?
```

## 5.1 Example

Domain words:

```text
Application
Draft
Submission
Assessment
Decision
Document
Payment
Case
OfficerAssignment
Timeline
```

Possible resources:

```text
/applications
/applications/{applicationId}
/applications/{applicationId}/submission
/applications/{applicationId}/decision
/applications/{applicationId}/documents
/applications/{applicationId}/timeline
```

## 5.2 Rule

Use ubiquitous language for resource names.

---

# 6. Noun Resource vs Verb Command

REST purists often say “resource should be nouns”.

Good:

```text
POST /applications/{id}/submission
PUT /cases/{id}/assignee
POST /applications/{id}/withdrawal
```

Less ideal:

```text
POST /applications/{id}/submit
POST /cases/{id}/assign
POST /applications/{id}/withdraw
```

## 6.1 Why noun command resource?

Submission/withdrawal/decision can be modeled as domain event/resource.

## 6.2 But pragmatic commands are sometimes okay

Enterprise workflow often has action semantics.

If action is not naturally a resource, command endpoint can be acceptable if:

- named clearly;
- idempotency defined;
- authorization defined;
- result/status defined;
- audit/event defined;
- documented as command.

## 6.3 Rule

Prefer noun resources, but do not twist domain into unnatural shapes. Be explicit.

---

# 7. CRUD is Not Enough

CRUD maps:

```text
Create
Read
Update
Delete
```

Enterprise domain needs:

```text
submit
approve
reject
assign
escalate
withdraw
archive
restore
request clarification
complete review
publish
cancel
retry
```

## 7.1 Bad CRUD update

```http
PATCH /applications/{id}
{"status":"APPROVED"}
```

This lets client pretend state transition is field update.

## 7.2 Better

```http
POST /applications/{id}/decision
{
  "decision": "APPROVE",
  "remarks": "Meets requirements"
}
```

or:

```http
PUT /applications/{id}/decision
```

if decision resource is unique/idempotent.

## 7.3 Rule

If operation changes domain lifecycle, model it as domain transition, not generic field update.

---

# 8. Command Endpoints yang RESTful-Pragmatic

## 8.1 Command resource

```http
POST /applications/{id}/submissions
```

Creates a submission attempt/event.

## 8.2 Singleton command resource

```http
PUT /applications/{id}/submission
```

Marks the application submitted if one submission state exists.

## 8.3 Action endpoint

```http
POST /applications/{id}:submit
```

Used by some API styles but less common in classic REST/JAX-RS.

## 8.4 Enterprise recommendation

Use resource-like command endpoints:

```text
/submission
/withdrawal
/decision
/assignment
/cancellation
```

## 8.5 Rule

Make command intent explicit and domain-owned.

---

# 9. Workflow and State Machine Modeling

Many enterprise resources have lifecycle.

Example application:

```text
DRAFT
  → SUBMITTED
  → UNDER_REVIEW
  → APPROVED
  → REJECTED
  → WITHDRAWN
```

## 9.1 State machine belongs server-side

Frontend may display possible actions, but server enforces transitions.

## 9.2 Invalid transition

```text
APPROVED → SUBMITTED
```

should fail with domain error.

## 9.3 Represent state

```json
{
  "status": "UNDER_REVIEW",
  "availableActions": ["REQUEST_CLARIFICATION", "APPROVE", "REJECT"]
}
```

## 9.4 Rule

Workflow API must make state and allowed transitions explicit.

---

# 10. State Transition Endpoints

## 10.1 Submit

```http
POST /applications/{id}/submission
```

Request:

```json
{
  "declarationAccepted": true
}
```

Response:

```http
200 OK
```

with updated application or transition result.

## 10.2 Approve

```http
POST /applications/{id}/decision
```

Request:

```json
{
  "decision": "APPROVE",
  "remarks": "Approved after review"
}
```

## 10.3 Assign case

```http
PUT /cases/{id}/assignee
```

Request:

```json
{
  "officerId": "U123"
}
```

## 10.4 Rule

Use endpoint shape that reflects domain transition and idempotency.

---

# 11. Subresources

Subresources express relationship and scoping.

Examples:

```text
/applications/{id}/documents
/applications/{id}/timeline
/cases/{id}/notes
/customers/{id}/addresses
```

## 11.1 Use when

- child belongs to parent context;
- authorization depends on parent;
- parent identity is needed;
- lifecycle tied to parent.

## 11.2 Avoid too deep nesting

Bad:

```text
/customers/{c}/applications/{a}/documents/{d}/versions/{v}/comments/{x}
```

Deep nesting can make API rigid.

## 11.3 Rule

Use nesting for ownership/context, not for every database relationship.

---

# 12. Collection Resources

Collection resource:

```text
/applications
```

Supports:

- create;
- list;
- search/filter;
- pagination.

## 12.1 POST to collection

```http
POST /applications
```

Server creates resource and returns `201 Created`.

## 12.2 GET collection

```http
GET /applications?status=SUBMITTED&limit=20
```

## 12.3 Rule

Collection resources should have clear query contract and limits.

---

# 13. Singleton Resources

Singleton resource represents exactly one child state.

Examples:

```text
/applications/{id}/submission
/applications/{id}/decision
/cases/{id}/assignee
/users/{id}/profile
```

## 13.1 PUT singleton

Good when replacing/setting unique state.

```http
PUT /cases/{id}/assignee
```

## 13.2 DELETE singleton

```http
DELETE /cases/{id}/assignee
```

if unassignment allowed.

## 13.3 Rule

Singleton resources are useful for domain concepts that exist once per parent.

---

# 14. Search Resources

Complex search may not fit GET query string.

## 14.1 Simple search

```http
GET /applications?status=SUBMITTED&createdAfter=...
```

## 14.2 Complex search

```http
POST /application-searches
```

or:

```http
POST /applications/search
```

Request body contains query.

## 14.3 Search as resource

For long-running/exportable search:

```http
POST /application-search-jobs
GET /application-search-jobs/{id}
```

## 14.4 Rule

Use GET for simple safe queries; use search resource/job for complex or long-running queries.

---

# 15. Operation Resources for Long-Running Work

Long-running operation should be resource.

## 15.1 Start

```http
POST /reports
```

Response:

```http
202 Accepted
Location: /operations/OP-123
```

## 15.2 Poll

```http
GET /operations/OP-123
```

Response:

```json
{
  "id": "OP-123",
  "status": "RUNNING",
  "percentComplete": 45,
  "_links": {
    "self": { "href": "/operations/OP-123" }
  }
}
```

## 15.3 Result

```json
{
  "status": "SUCCEEDED",
  "_links": {
    "result": { "href": "/reports/R-456" }
  }
}
```

## 15.4 Rule

If work outlives request, model operation state explicitly.

---

# 16. POST, PUT, PATCH, DELETE Semantics

HTTP semantics matter.

## 16.1 POST

Often create subordinate resource or process representation according to target resource semantics.

Not necessarily idempotent.

## 16.2 PUT

Replaces state of target resource.

Idempotent by method semantics.

## 16.3 PATCH

Applies partial modification.

Patch format must be defined.

## 16.4 DELETE

Removes target resource association/state.

Idempotent in desired effect.

## 16.5 Rule

Choose method by semantics and idempotency, not by UI button.

---

# 17. Create Semantics

## 17.1 Server-generated ID

```http
POST /applications
```

Response:

```http
201 Created
Location: /applications/APP-123
```

## 17.2 Client-provided ID

```http
PUT /applications/APP-123
```

Can be idempotent if client controls ID and representation.

## 17.3 Duplicate create

Use:

- idempotency key;
- natural unique constraint;
- conflict response.

## 17.4 Rule

Create endpoint must define identity, idempotency, and duplicate behavior.

---

# 18. Update Semantics

## 18.1 Full replace

```http
PUT /customers/{id}
```

Client sends complete representation.

## 18.2 Partial update

```http
PATCH /customers/{id}
```

Client sends patch document.

## 18.3 Domain update command

```http
POST /applications/{id}/decision
```

Client sends intention.

## 18.4 Rule

Do not use generic update for domain transitions.

---

# 19. PATCH Semantics

Patch formats:

- JSON Patch (`application/json-patch+json`);
- JSON Merge Patch (`application/merge-patch+json`);
- custom domain patch.

## 19.1 JSON Patch

Operations such as:

```json
[
  { "op": "replace", "path": "/displayName", "value": "Fajar" }
]
```

## 19.2 JSON Merge Patch

```json
{
  "displayName": "Fajar",
  "middleName": null
}
```

Null often means remove/set null depending target semantics.

## 19.3 Rule

PATCH must define media type and field authorization.

---

# 20. Delete Semantics

Delete can mean:

- hard delete;
- soft delete;
- archive;
- cancel;
- remove association.

## 20.1 Hard delete

```http
DELETE /documents/{id}
```

## 20.2 Soft delete/archive

Maybe better:

```http
POST /applications/{id}/archival
```

or:

```http
PUT /applications/{id}/archived-state
```

depending domain.

## 20.3 Rule

If “delete” is actually business transition, model the transition.

---

# 21. Idempotency

Idempotency is crucial for retries.

## 21.1 Idempotent methods

PUT and DELETE are defined as idempotent in HTTP semantics.

POST is not generally idempotent.

## 21.2 POST idempotency key

```http
Idempotency-Key: 01H...
```

Server stores key + request hash + result.

## 21.3 Where needed

- payment;
- application submission;
- report generation;
- document upload metadata;
- case creation;
- external side effects.

## 21.4 Rule

Every non-idempotent write that clients may retry needs idempotency strategy.

---

# 22. Optimistic Concurrency: ETag and If-Match

Mutable resources need lost-update prevention.

## 22.1 GET

```http
ETag: "v7"
```

## 22.2 Update

```http
If-Match: "v7"
```

## 22.3 Stale

```http
412 Precondition Failed
```

## 22.4 Rule

If two users can edit same resource, design concurrency explicitly.

---

# 23. Domain Errors

Domain errors are not infrastructure exceptions.

Examples:

```text
APPLICATION_ALREADY_SUBMITTED
APPLICATION_NOT_SUBMITTABLE
CASE_ALREADY_ASSIGNED
OFFICER_NOT_ELIGIBLE
DOCUMENT_REQUIRED
TENANT_ACCESS_DENIED
DECISION_NOT_ALLOWED_IN_CURRENT_STATE
```

## 23.1 Domain error characteristics

- stable code;
- user/consumer meaningful;
- maps to HTTP status;
- safe detail;
- observable.

## 23.2 Rule

Domain errors are part of API contract.

---

# 24. Problem Details and Error Taxonomy

Use Problem Details shape for errors.

## 24.1 Example

```json
{
  "type": "https://api.example.com/problems/invalid-state-transition",
  "title": "Invalid state transition",
  "status": 409,
  "code": "APPLICATION_NOT_SUBMITTABLE",
  "detail": "Application cannot be submitted while status is UNDER_REVIEW.",
  "correlationId": "..."
}
```

## 24.2 Suggested mapping

| Error | Status |
|---|---|
| malformed JSON | 400 |
| validation failure | 400/422 |
| authentication required | 401 |
| forbidden | 403 |
| not found | 404 |
| state conflict | 409 |
| stale ETag | 412 |
| precondition required | 428 |
| rate limited | 429 |
| dependency unavailable | 503 |

## 24.3 Rule

Do not leak exception class as API error code.

---

# 25. Validation vs Domain Invariant

## 25.1 Validation

Shape/format:

```text
email format
required field
max length
enum value
```

## 25.2 Domain invariant

Business truth:

```text
application cannot be submitted without declaration
officer cannot approve own case
payment must be completed before license issuance
```

## 25.3 DB constraint

Final consistency guard:

```text
unique email per tenant
not null
foreign key
```

## 25.4 Rule

Validation rejects malformed input; domain rejects invalid business intent.

---

# 26. Authorization as Domain Constraint

Authorization is not only technical.

Example:

```text
Officer cannot approve case assigned to themselves.
Applicant can withdraw only own draft/submitted application.
Supervisor can reassign case only within department.
```

These are domain rules.

## 26.1 Rule

Put domain-sensitive authorization in service/domain layer, not only route filter.

---

# 27. Tenant Boundary

Tenant-aware API design:

## 27.1 URL with tenant?

```text
/tenants/{tenantId}/applications
```

Good for admin/control-plane APIs.

## 27.2 Tenant from token

```text
/applications
```

Good for user-facing tenant-scoped APIs.

## 27.3 Rule

Do not accept tenant ID from body if it should come from identity context.

---

# 28. Data Exposure and DTO Redaction

Enterprise APIs often serve multiple roles.

## 28.1 Role-based view

Applicant sees:

```json
{
  "status": "SUBMITTED",
  "submittedAt": "..."
}
```

Officer sees:

```json
{
  "riskIndicators": [...],
  "internalRemarks": [...]
}
```

## 28.2 Strategy

Use separate endpoint or role-aware mapper.

Do not return one giant DTO with nulls everywhere unless intentional.

## 28.3 Rule

Response shape is authorization boundary.

---

# 29. Pagination, Filtering, Sorting for Enterprise Data

## 29.1 Stable ordering

Always deterministic.

```text
createdAt desc, id desc
```

## 29.2 Allowlist

Only indexed/filterable fields.

## 29.3 Cursor for large data

Prefer cursor/keyset for large datasets.

## 29.4 Rule

Query API design must match database/index reality.

---

# 30. Consistency Models

Not all APIs are immediately consistent.

## 30.1 Strong-ish consistency

Write and read same DB.

## 30.2 Eventual consistency

Read model updated asynchronously.

## 30.3 Client contract

Document:

- when state is visible;
- operation status;
- retry/polling;
- version;
- projection lag if relevant.

## 30.4 Rule

Consistency model is API contract.

---

# 31. Read-After-Write Behavior

After POST/PATCH, what can client expect?

## 31.1 Return updated representation

Good if available.

## 31.2 Return operation/status resource

Good for async processing.

## 31.3 Return 202

If work accepted but not complete.

## 31.4 Rule

Write endpoint should tell client what state exists now and where to check next.

---

# 32. CQRS and Read Models

Use CQRS when:

- write model complex;
- read queries expensive;
- dashboard/search views need denormalization;
- event-driven projection needed.

## 32.1 API implication

Write endpoint may return command result.

Read endpoint may return projection.

## 32.2 Eventual consistency

Must be documented.

## 32.3 Rule

CQRS changes API consistency expectations.

---

# 33. Events and Outbox

Enterprise APIs often emit events after writes.

## 33.1 Domain event

```text
ApplicationSubmitted
CaseAssigned
DocumentUploaded
DecisionRecorded
```

## 33.2 Outbox

Within same transaction:

```text
update aggregate
insert audit
insert outbox event
commit
```

## 33.3 Event payload

Version event contract separately.

## 33.4 Rule

REST write side effects should be committed facts, not hopeful notifications.

---

# 34. Audit Trail

Audit trail is domain evidence.

## 34.1 Audit events

- who;
- what;
- when;
- resource;
- before/after if needed;
- reason;
- correlation ID.

## 34.2 API endpoint

```text
GET /applications/{id}/timeline
```

or:

```text
GET /audit-events?resourceType=APPLICATION&resourceId=...
```

## 34.3 Rule

Audit is not debug log; it is business/security evidence.

---

# 35. Hypermedia and Affordances

For workflow APIs, links/actions can help clients.

## 35.1 Example

```json
{
  "id": "APP-1",
  "status": "DRAFT",
  "_links": {
    "self": { "href": "/applications/APP-1" },
    "submit": { "href": "/applications/APP-1/submission", "method": "POST" },
    "documents": { "href": "/applications/APP-1/documents" }
  }
}
```

## 35.2 Benefit

Clients discover available actions.

## 35.3 Caveat

Not all enterprise clients consume hypermedia fully.

## 35.4 Rule

Even if not full HATEOAS, exposing allowed actions can reduce invalid workflow calls.

---

# 36. Versioning and Evolvability

Enterprise API changes over years.

## 36.1 Design for change

- add optional response fields;
- ignore unknown fields;
- stable error codes;
- stable enum strategy;
- versioned major breaking changes;
- deprecation/sunset policy.

## 36.2 Rule

Evolvability is designed into first version, not patched later.

---

# 37. Backward Compatibility Rules

Non-breaking usually:

- add optional response field;
- add optional query param;
- add new endpoint;
- add new link relation;
- add new enum only if clients tolerate unknown.

Breaking:

- remove/rename field;
- change type;
- make optional request field required;
- change status semantics;
- change error code;
- change workflow state meaning.

## 37.1 Rule

Compatibility is judged by existing consumers, not server code diff.

---

# 38. API Boundary and Microservices

Microservices should expose capabilities, not database tables.

## 38.1 Bad

Service A exposes CRUD tables for Service B to orchestrate.

## 38.2 Better

Service A exposes domain operations:

```text
submit application
record decision
attach document
```

## 38.3 Rule

A service API should protect its aggregate invariants.

---

# 39. Aggregate Boundaries vs Service Boundaries

One service may own multiple aggregates.

One aggregate should generally have one owner service.

## 39.1 API implication

If endpoint mutates aggregate, route to owner service.

## 39.2 Cross-aggregate workflow

Use saga/process manager, not distributed transaction through REST.

## 39.3 Rule

REST API boundary should not violate aggregate ownership.

---

# 40. Anti-Corruption Layer

When integrating legacy/external services, use anti-corruption layer.

## 40.1 Purpose

Translate:

- external DTO;
- status codes;
- error codes;
- weird workflow;
- terminology.

into your domain model.

## 40.2 Rule

Do not let external API design pollute internal domain model.

---

# 41. API Gateway and BFF Considerations

## 41.1 Gateway

Good for:

- routing;
- auth integration;
- rate limit;
- CORS;
- TLS;
- observability.

Not good for:

- deep domain invariant;
- object-level authorization;
- workflow logic.

## 41.2 BFF

Backend-for-frontend can shape API for UI.

But BFF should not own core domain invariants.

## 41.3 Rule

Gateway/BFF adapt traffic; domain service owns truth.

---

# 42. OpenAPI as Design Artifact

Use OpenAPI before implementation.

## 42.1 Design review

Review:

- resource names;
- methods;
- request/response schema;
- errors;
- auth;
- idempotency;
- pagination;
- examples.

## 42.2 Rule

OpenAPI is API design artifact, not only generated docs.

---

# 43. Testing Enterprise API Design

Tests should cover:

- state transitions;
- invalid transitions;
- authorization;
- tenant isolation;
- idempotency;
- optimistic locking;
- outbox/audit;
- domain error codes;
- compatibility.

## 43.1 Rule

Test domain behavior through API, not only service unit tests.

---

# 44. Observability for Domain APIs

Metrics should include:

- operation;
- status;
- domain error code;
- transition;
- idempotency replay;
- outbox lag;
- audit failure;
- authorization denial.

## 44.1 Example

```text
domain.transition.total{resource="application",transition="submit",result="success"}
domain.error.total{code="APPLICATION_NOT_SUBMITTABLE"}
```

## 44.2 Rule

Domain observability helps debug business incidents.

---

# 45. Example: Licensing Application Domain

## 45.1 Resources

```text
POST /applications
GET /applications/{id}
PATCH /applications/{id}
POST /applications/{id}/submission
POST /applications/{id}/withdrawal
GET /applications/{id}/timeline
POST /applications/{id}/documents
GET /applications/{id}/available-actions
```

## 45.2 State machine

```text
DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED/REJECTED
DRAFT/SUBMITTED → WITHDRAWN
```

## 45.3 Domain errors

```text
APPLICATION_NOT_FOUND
APPLICATION_NOT_SUBMITTABLE
DECLARATION_REQUIRED
DOCUMENT_REQUIRED
STALE_APPLICATION_VERSION
```

## 45.4 Rule

Application API is workflow API, not CRUD status update API.

---

# 46. Example: Case Management Domain

## 46.1 Resources

```text
/cases
/cases/{id}
/cases/{id}/assignee
/cases/{id}/notes
/cases/{id}/status-transitions
/cases/{id}/timeline
```

## 46.2 Transitions

```text
OPEN → ASSIGNED → IN_REVIEW → RESOLVED → CLOSED
```

## 46.3 Authorization

- officer sees assigned cases;
- supervisor can reassign;
- applicant cannot see internal notes;
- tenant boundary enforced.

## 46.4 Rule

Case management API needs object/property-level authorization.

---

# 47. Example: Document Upload Domain

## 47.1 Resources

```text
POST /documents
GET /documents/{id}
GET /documents/{id}/download
GET /documents/{id}/scan-status
DELETE /documents/{id}
```

## 47.2 Async scan

Upload returns:

```http
202 Accepted
Location: /documents/{id}/scan-status
```

## 47.3 State

```text
UPLOADED
SCAN_PENDING
SCAN_PASSED
SCAN_FAILED
QUARANTINED
PUBLISHED
```

## 47.4 Rule

File upload is domain workflow and security workflow.

---

# 48. Design Review Checklist

Ask:

```text
What domain capability does endpoint expose?
Is resource name domain language?
Is method semantics correct?
Is operation idempotent?
What are allowed states?
What errors can occur?
What authorization applies?
What tenant boundary applies?
What concurrency control applies?
What event/audit is emitted?
What consistency does client observe?
What is pagination/search contract?
What are backward compatibility rules?
```

## 48.1 Rule

API design review should happen before coding.

---

# 49. Common Failure Modes

## 49.1 Database-over-HTTP

Tables leak.

## 49.2 Generic PATCH status

Workflow bypass.

## 49.3 No idempotency

Duplicate writes.

## 49.4 No ETag

Lost update.

## 49.5 Role-only authorization

BOLA.

## 49.6 Tenant from body

Tenant bypass.

## 49.7 Error code equals exception class

Unstable.

## 49.8 Search with arbitrary filters

Slow/injection-like query abuse.

## 49.9 Events emitted before commit

False event.

## 49.10 API version changes without migration

Consumer break.

## 49.11 One DTO for all roles

Data exposure.

## 49.12 Frontend owns workflow rules

Server invariant bypass.

---

# 50. Best Practices

## 50.1 Start from domain language

Not DB.

## 50.2 Model lifecycle explicitly

State machine and transitions.

## 50.3 Use command resources for domain actions

Submission, decision, assignment.

## 50.4 Make writes idempotent where needed

Idempotency key or PUT semantics.

## 50.5 Use optimistic concurrency

ETag/If-Match.

## 50.6 Use Problem Details with domain codes

Stable errors.

## 50.7 Enforce tenant/object authorization

At query/service boundary.

## 50.8 Emit audit/outbox transactionally

Committed facts.

## 50.9 Design for compatibility

Versioning/deprecation.

## 50.10 Test workflow through API

Not only service methods.

---

# 51. Anti-Patterns

## 51.1 `/updateStatus`

Ambiguous and unsafe.

## 51.2 `/doAction`

No domain meaning.

## 51.3 PATCH any field

Authorization/invariant bypass.

## 51.4 Expose JPA entity

Data leak and coupling.

## 51.5 Use 200 for every outcome

Breaks HTTP semantics.

## 51.6 Use error message as code

Unstable.

## 51.7 No tenant in repository methods

Data breach risk.

## 51.8 POST creates duplicate on retry

Bad idempotency.

## 51.9 Event publish before commit

Consistency bug.

## 51.10 Infinite endpoint nesting

Rigid API.

---

# 52. Production Checklist

## 52.1 Domain model

- [ ] Resource names use domain language.
- [ ] Aggregates identified.
- [ ] Read models identified.
- [ ] Lifecycle states documented.
- [ ] State transitions documented.
- [ ] Domain invariants documented.

## 52.2 HTTP contract

- [ ] Method semantics correct.
- [ ] Create/update/delete behavior defined.
- [ ] PATCH media type defined.
- [ ] Idempotency strategy defined.
- [ ] ETag/If-Match used where needed.
- [ ] Status codes documented.
- [ ] Problem Details error taxonomy documented.

## 52.3 Security/tenant

- [ ] Function authorization.
- [ ] Object-level authorization.
- [ ] Property-level redaction.
- [ ] Tenant-safe queries.
- [ ] Audit events.
- [ ] Sensitive fields not exposed.

## 52.4 Operations

- [ ] Events/outbox transactional.
- [ ] Observability metrics by domain operation.
- [ ] OpenAPI examples.
- [ ] Contract tests.
- [ ] Versioning/deprecation policy.
- [ ] Performance limits for list/search.

---

# 53. Latihan

## Latihan 1 — Refactor CRUD Status Update

Ubah:

```http
PATCH /applications/{id}
{"status":"SUBMITTED"}
```

menjadi transition endpoint.

Definisikan request/response/error.

## Latihan 2 — State Machine

Buat state machine untuk Case:

```text
OPEN, ASSIGNED, IN_REVIEW, RESOLVED, CLOSED
```

Tentukan allowed transitions dan endpoint.

## Latihan 3 — Domain Error Taxonomy

Buat 15 domain error code untuk Application domain.

Map ke HTTP status dan Problem Details.

## Latihan 4 — Idempotency Design

Design idempotency untuk:

```http
POST /payments
POST /reports
POST /applications/{id}/submission
```

## Latihan 5 — Tenant Isolation

Design repository methods agar semua query Application tenant-safe.

## Latihan 6 — Outbox Event

Untuk `ApplicationSubmitted`, definisikan:

- event payload;
- outbox table;
- transactional write;
- idempotent consumer rule.

## Latihan 7 — OpenAPI Design Review

Buat OpenAPI untuk Application API.

Review dengan checklist bagian 48.

## Latihan 8 — Workflow API Tests

Test:

- submit draft success;
- submit submitted app conflict;
- approve by unauthorized actor forbidden;
- stale ETag 412;
- retry idempotency returns same result.

---

# 54. Referensi Resmi

Referensi utama:

1. RFC 9110 — HTTP Semantics  
   https://www.rfc-editor.org/rfc/rfc9110.html

2. RFC 9457 — Problem Details for HTTP APIs  
   https://www.rfc-editor.org/info/rfc9457/

3. RFC 6902 — JavaScript Object Notation (JSON) Patch  
   https://www.rfc-editor.org/info/rfc6902/

4. RFC 7396 — JSON Merge Patch  
   https://www.rfc-editor.org/rfc/rfc7396.html

5. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

---

# 55. Penutup

REST API enterprise yang baik membuat domain mudah dioperasikan tanpa membocorkan internal implementation.

Mental model final:

```text
domain capability
  ↓
resource / command resource
  ↓
HTTP method semantics
  ↓
authorization + validation + invariant
  ↓
state transition
  ↓
transaction + audit + outbox
  ↓
representation + Problem Details
  ↓
evolvable contract
```

Prinsip final:

```text
Do not expose tables.
Model domain lifecycle.
Use commands for business transitions.
Make retries safe.
Prevent lost updates.
Make domain errors stable.
Enforce tenant and object authorization.
Publish committed events.
Design for long-term compatibility.
```

Top-tier JAX-RS engineer memastikan:

- endpoint mewakili domain capability;
- workflow/state machine ada di server;
- HTTP semantics dipakai dengan sadar;
- idempotency/concurrency/error/security bukan afterthought;
- read model dan write model dipisahkan jika perlu;
- outbox/audit menjadi bagian transactional design;
- API bisa berubah tanpa mematahkan consumer lama.

Part berikutnya:

```text
Bagian 044 — Long-Running Operations and Async API Design
```

Kita akan membahas desain API untuk operasi panjang: 202 Accepted, operation resource, polling, callback/webhook, SSE progress, cancellation, retry, idempotency, timeout, result resources, failure recovery, and production job orchestration.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 042 — Production Security Hardening for JAX-RS APIs: Authentication, Authorization, JWT/OIDC, CORS/CSRF, Input Limits, Security Headers, Rate Limit, Request Smuggling, SSRF, Deserialization Safety, File Upload Security, Audit, and Security Testing](./learn-jaxrs-advanced-part-042.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Bagian 044 — Long-Running Operations and Async API Design: 202 Accepted, Operation Resource, Polling, Webhook, SSE Progress, Cancellation, Retry, Idempotency, Timeout, Result Resources, Failure Recovery, and Production Job Orchestration](./learn-jaxrs-advanced-part-044.md)
