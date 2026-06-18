# learn-jaxrs-advanced-part-054.md

# Bagian 054 — Capstone: Top 1% JAX-RS Reference Architecture — Resource Design, Domain Model, API Gateway, Security, Tenancy, Persistence, Outbox/Events, Clients, Resilience, Observability, Testing, CI/CD, Deployment, and Operational Excellence

> Ini adalah bagian penutup seri advanced JAX-RS/Jakarta REST. Tujuannya menyatukan semua pembahasan sebelumnya menjadi **reference architecture** yang bisa dipakai untuk mendesain, mereview, membangun, memigrasikan, dan mengoperasikan REST API enterprise-grade.
>
> Prinsip utama:
>
> ```text
> Top 1% JAX-RS engineering is not about memorizing annotations.
> It is about designing reliable HTTP contracts, domain boundaries, security, data consistency, observability, tests, and operations as one system.
> ```

---

## Daftar Isi

1. [Tujuan Capstone](#1-tujuan-capstone)
2. [Reference Architecture Overview](#2-reference-architecture-overview)
3. [System Context](#3-system-context)
4. [Core Architecture Diagram](#4-core-architecture-diagram)
5. [Architectural Principles](#5-architectural-principles)
6. [API Surface and Resource Design](#6-api-surface-and-resource-design)
7. [Domain-First Resource Modeling](#7-domain-first-resource-modeling)
8. [Command Resources and Workflow](#8-command-resources-and-workflow)
9. [HTTP Semantics Baseline](#9-http-semantics-baseline)
10. [DTO and Representation Strategy](#10-dto-and-representation-strategy)
11. [Validation and Domain Invariants](#11-validation-and-domain-invariants)
12. [Error Contract](#12-error-contract)
13. [Security Architecture](#13-security-architecture)
14. [Tenant and Data Authorization](#14-tenant-and-data-authorization)
15. [API Gateway and Proxy Contract](#15-api-gateway-and-proxy-contract)
16. [Application Layer](#16-application-layer)
17. [Domain Layer](#17-domain-layer)
18. [Persistence Layer](#18-persistence-layer)
19. [Transaction Boundary](#19-transaction-boundary)
20. [Outbox and Event Integration](#20-outbox-and-event-integration)
21. [Long-Running Operations](#21-long-running-operations)
22. [Outbound HTTP Clients](#22-outbound-http-clients)
23. [Resilience Architecture](#23-resilience-architecture)
24. [Observability Architecture](#24-observability-architecture)
25. [Performance Architecture](#25-performance-architecture)
26. [OpenAPI and Documentation](#26-openapi-and-documentation)
27. [Testing Architecture](#27-testing-architecture)
28. [CI/CD Quality Gates](#28-cicd-quality-gates)
29. [Deployment Architecture](#29-deployment-architecture)
30. [Runtime Operations](#30-runtime-operations)
31. [Reference Package Structure](#31-reference-package-structure)
32. [Reference Endpoint Set](#32-reference-endpoint-set)
33. [Request Flow: Create Application](#33-request-flow-create-application)
34. [Request Flow: Submit Application](#34-request-flow-submit-application)
35. [Request Flow: Download Document](#35-request-flow-download-document)
36. [Failure Flow: Downstream Timeout](#36-failure-flow-downstream-timeout)
37. [Failure Flow: Stale ETag](#37-failure-flow-stale-etag)
38. [Failure Flow: Cross-Tenant Access](#38-failure-flow-cross-tenant-access)
39. [Capability Maturity Model](#39-capability-maturity-model)
40. [Architecture Review Checklist](#40-architecture-review-checklist)
41. [Top 1% Engineer Heuristics](#41-top-1-engineer-heuristics)
42. [Common Architecture Smells](#42-common-architecture-smells)
43. [Best Practices](#43-best-practices)
44. [Anti-Patterns](#44-anti-patterns)
45. [Final Production Checklist](#45-final-production-checklist)
46. [Capstone Exercises](#46-capstone-exercises)
47. [Referensi Resmi](#47-referensi-resmi)
48. [Penutup Seri](#48-penutup-seri)

---

# 1. Tujuan Capstone

Kita sudah mempelajari JAX-RS dari dasar internal sampai production concerns:

- HTTP semantics;
- resource matching;
- parameters;
- context;
- request/response entities;
- providers;
- content negotiation;
- error handling;
- validation;
- filters/interceptors;
- security;
- CORS/CSRF;
- pagination;
- PATCH;
- ETag;
- hypermedia;
- async;
- SSE;
- streaming;
- multipart;
- client API;
- resilience;
- CDI;
- transactions;
- versioning;
- OpenAPI;
- testing;
- implementation differences;
- migration;
- observability;
- performance;
- security hardening;
- enterprise domain design;
- long-running operations;
- multi-tenancy;
- gateway/proxy;
- MicroProfile;
- OAuth/OIDC/JWT;
- runtime internals;
- legacy refactoring.

Bagian ini menyatukan semuanya menjadi satu reference architecture.

## 1.1 Output yang diharapkan

Setelah capstone ini, kamu punya mental model untuk menjawab:

```text
Bagaimana saya mendesain JAX-RS API enterprise dari nol?
Bagaimana saya menilai apakah API sudah production-grade?
Bagaimana saya menempatkan security, tenancy, persistence, observability, dan tests?
Bagaimana saya menghindari API menjadi database-over-HTTP?
Bagaimana saya memastikan system bisa dioperasikan?
```

## 1.2 Rule

A production API is a socio-technical contract: code, consumers, operators, security, data, and runtime all matter.

---

# 2. Reference Architecture Overview

Reference architecture:

```text
Client / Partner / UI / Service
  ↓
CDN / WAF / API Gateway / Load Balancer
  ↓
JAX-RS Application
  ├─ API Layer
  ├─ Application Layer
  ├─ Domain Layer
  └─ Infrastructure Layer
       ├─ Database
       ├─ Outbox/Event Broker
       ├─ Object Storage
       ├─ Downstream HTTP Services
       └─ Observability Backend
```

## 2.1 Responsibilities

Gateway:

- TLS;
- routing;
- WAF;
- coarse rate limit;
- request size;
- auth offload optionally;
- forwarded headers.

JAX-RS app:

- HTTP contract;
- domain authorization;
- validation;
- business invariants;
- transaction;
- error mapping;
- observability;
- outbound integration.

Database:

- durable state;
- constraints;
- optimistic locking;
- tenant defense.

Outbox/event broker:

- reliable event publication.

Observability backend:

- logs;
- metrics;
- traces;
- dashboards;
- alerts.

## 2.2 Rule

Each layer must have clear ownership and failure semantics.

---

# 3. System Context

Actors:

```text
Applicant
Officer
Supervisor
Admin
Partner System
Batch Job
Downstream Services
Support Operator
```

Main resource domains:

```text
Application
Case
Document
Profile
Payment
Notification
Operation
AuditEvent
```

Cross-cutting:

```text
Identity
Tenant
Authorization
Audit
Observability
Idempotency
Outbox
OpenAPI
```

## 3.1 Rule

Architecture starts by naming actors, resources, and trust boundaries.

---

# 4. Core Architecture Diagram

```text
                    ┌─────────────────────┐
                    │   Client / Partner   │
                    └──────────┬──────────┘
                               │ HTTPS
                    ┌──────────▼──────────┐
                    │ API Gateway / WAF    │
                    │ TLS, Auth, RateLimit │
                    └──────────┬──────────┘
                               │ trusted forwarded context
              ┌────────────────▼────────────────┐
              │        JAX-RS Application         │
              │                                  │
              │  ┌──────────────┐                │
              │  │ API Layer     │ Resources, DTO │
              │  └──────┬───────┘                │
              │         │                        │
              │  ┌──────▼────────┐               │
              │  │ Application    │ Use cases     │
              │  └──────┬────────┘               │
              │         │                        │
              │  ┌──────▼────────┐               │
              │  │ Domain         │ Invariants    │
              │  └──────┬────────┘               │
              │         │                        │
              │  ┌──────▼────────┐               │
              │  │ Infrastructure │ DB/Clients    │
              │  └──────┬────────┘               │
              └─────────┼────────────────────────┘
                        │
        ┌───────────────┼────────────────────┐
        │               │                    │
   ┌────▼────┐    ┌─────▼────┐         ┌─────▼─────┐
   │Database │    │Event Bus │         │Downstream │
   └─────────┘    └──────────┘         └───────────┘
```

## 4.1 Rule

A good architecture diagram shows boundaries and data/control flow, not just boxes.

---

# 5. Architectural Principles

## 5.1 Contract-first

OpenAPI and examples are reviewed before implementation.

## 5.2 Domain-first

Resources reflect domain capabilities and lifecycle.

## 5.3 Boundary discipline

DTOs, domain, persistence, and external clients are separate.

## 5.4 Secure by default

Deny by default, validate token, authorize object, isolate tenant.

## 5.5 Failure is designed

Problem Details, retryability, idempotency, fallback, timeout.

## 5.6 Observable by default

Every request has correlation, metrics, logs, traces.

## 5.7 Testable by design

Domain, resources, security, persistence, and clients are independently testable.

## 5.8 Operable by design

Health, dashboards, alerts, runbooks, rollout/rollback.

## 5.9 Rule

Principles are only useful if enforced by code review and CI gates.

---

# 6. API Surface and Resource Design

Resource set example:

```text
/applications
/applications/{applicationId}
/applications/{applicationId}/submission
/applications/{applicationId}/withdrawal
/applications/{applicationId}/documents
/applications/{applicationId}/timeline
/cases/{caseId}
/cases/{caseId}/assignee
/operations/{operationId}
/audit-events
```

## 6.1 Avoid

```text
/updateStatus
/doAction
/saveApplication
/processRequest
```

## 6.2 Rule

Endpoint names should speak domain language.

---

# 7. Domain-First Resource Modeling

## 7.1 Aggregate

`Application` aggregate owns state transition:

```text
DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED/REJECTED
```

## 7.2 Resource representation

```json
{
  "id": "APP-2026-0001",
  "status": "SUBMITTED",
  "version": 7,
  "_links": {
    "self": { "href": "/applications/APP-2026-0001" },
    "withdrawal": { "href": "/applications/APP-2026-0001/withdrawal" }
  }
}
```

## 7.3 Rule

Resource state should reflect domain lifecycle, not raw database fields.

---

# 8. Command Resources and Workflow

State transition example:

```http
POST /applications/{id}/submission
If-Match: "7"
Idempotency-Key: 01J...
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
ETag: "8"
```

## 8.1 Why not PATCH status?

Because `submit` is a business transition, not arbitrary field update.

## 8.2 Rule

Command resource expresses intention and lets server enforce workflow.

---

# 9. HTTP Semantics Baseline

Use:

- `GET` for safe read;
- `POST` for create/command;
- `PUT` for full replacement or singleton set;
- `PATCH` for partial update with explicit media type;
- `DELETE` for removal or association deletion;
- `202` for accepted async processing;
- `201` for created resource;
- `409` for domain conflict;
- `412` for stale precondition;
- `429` for rate limit;
- `503/504` for dependency availability/timeouts.

## 9.1 Rule

HTTP semantics are part of correctness, not decoration.

---

# 10. DTO and Representation Strategy

Use DTOs per audience/use case:

```text
ApplicationListItemResponse
ApplicationDetailResponse
OfficerApplicationDetailResponse
CreateApplicationRequest
SubmitApplicationRequest
```

## 10.1 DTO duties

- API compatibility;
- field authorization;
- serialization shape;
- validation;
- examples;
- docs.

## 10.2 Rule

Never expose JPA entity or domain aggregate directly.

---

# 11. Validation and Domain Invariants

## 11.1 Jakarta Validation

Boundary shape:

```text
required field
length
format
enum
number range
```

## 11.2 Domain invariant

Business truth:

```text
application cannot be submitted without required documents
officer cannot approve own case
tenant cannot access another tenant data
```

## 11.3 Rule

Validation protects input shape; domain protects business consistency.

---

# 12. Error Contract

Use Problem Details:

```json
{
  "type": "https://api.example.com/problems/application-not-submittable",
  "title": "Application cannot be submitted",
  "status": 409,
  "code": "APPLICATION_NOT_SUBMITTABLE",
  "retryable": false,
  "correlationId": "..."
}
```

## 12.1 Error taxonomy

```text
VALIDATION
DOMAIN
SECURITY
TENANT_ACCESS
CONFLICT
CONCURRENCY
RATE_LIMIT
DEPENDENCY
INTERNAL
```

## 12.2 Rule

Error codes are stable API contract.

---

# 13. Security Architecture

```text
TLS
  ↓
JWT/OIDC validation
  ↓
CurrentActor
  ↓
@RolesAllowed / scope gate
  ↓
domain authorization policy
  ↓
tenant-safe repository
  ↓
DTO redaction
  ↓
audit log
```

## 13.1 Token validation

Validate:

- signature;
- issuer;
- audience;
- expiration;
- algorithm;
- required claims.

## 13.2 Rule

Authentication is not authorization.

---

# 14. Tenant and Data Authorization

Tenant boundary must exist in:

- token/actor context;
- service policy;
- repository query;
- database constraints/RLS if applicable;
- cache key;
- search filter;
- object storage key;
- async job;
- audit.

## 14.1 Rule

Every object ID is an authorization challenge.

---

# 15. API Gateway and Proxy Contract

Gateway handles:

- public TLS;
- WAF;
- route;
- forwarded headers;
- coarse rate limit;
- request size;
- auth offload optionally.

App must know:

- trusted forwarded header convention;
- external scheme/host/prefix;
- timeout budget;
- buffering rules;
- identity header trust model.

## 15.1 Rule

Test JAX-RS generated `Location` and links through gateway.

---

# 16. Application Layer

Application layer orchestrates use cases:

```java
@Transactional
public ApplicationResponse submit(CurrentActor actor, ApplicationId id, SubmitRequest request) {
    Application app = repository.findByTenantAndId(actor.tenantId(), id)
        .orElseThrow(ResourceNotFoundException::new);

    policy.requireCanSubmit(actor, app);
    app.submit(actor.actorId(), request.declarationAccepted());

    repository.save(app);
    outbox.add(ApplicationSubmitted.from(app));
    audit.record(actor, "APPLICATION_SUBMITTED", app.id());

    return mapper.toResponse(app, actor);
}
```

## 16.1 Rule

Application service owns transaction/use-case orchestration, not resource method.

---

# 17. Domain Layer

Domain layer owns:

- aggregate state;
- value objects;
- invariants;
- domain policies;
- domain events;
- domain exceptions.

## 17.1 No dependencies

Domain should not depend on:

- JAX-RS;
- JPA;
- JSON;
- OpenAPI;
- HTTP status;
- database.

## 17.2 Rule

Domain model should be testable without container.

---

# 18. Persistence Layer

Persistence responsibilities:

- map domain to entity/table;
- enforce constraints;
- tenant-aware queries;
- optimistic locking;
- migrations;
- query performance.

## 18.1 Repository shape

```java
Optional<Application> findByTenantAndId(TenantId tenantId, ApplicationId id);
```

## 18.2 Rule

Persistence model is internal and should not leak to API.

---

# 19. Transaction Boundary

Transaction should include:

- aggregate mutation;
- audit record;
- outbox event;
- idempotency record.

Avoid:

- long external HTTP calls inside transaction;
- streaming response inside transaction;
- slow user-driven workflow.

## 19.1 Rule

Keep transactions short and consistency-focused.

---

# 20. Outbox and Event Integration

Outbox ensures reliable event publication.

```text
update aggregate
insert audit
insert outbox event
commit
relay publishes event
consumer processes idempotently
```

## 20.1 Event examples

```text
ApplicationCreated
ApplicationSubmitted
DocumentUploaded
CaseAssigned
DecisionRecorded
```

## 20.2 Rule

Publish committed facts, not hopeful side effects.

---

# 21. Long-Running Operations

For long work:

```http
POST /reports
202 Accepted
Location: /operations/OP-123
Retry-After: 10
```

Operation states:

```text
QUEUED
RUNNING
SUCCEEDED
FAILED
CANCELLED
EXPIRED
```

## 21.1 Rule

Long-running operation is durable resource, not hanging request.

---

# 22. Outbound HTTP Clients

Outbound call boundary:

```text
ApplicationService → CustomerGateway → Typed Rest Client/JAX-RS Client → Downstream
```

Gateway handles:

- timeout;
- retry;
- Problem Details decode;
- token strategy;
- trace propagation;
- DTO mapping;
- error translation.

## 22.1 Rule

Do not scatter raw HTTP client calls through business code.

---

# 23. Resilience Architecture

Per downstream operation define:

- connect timeout;
- read timeout;
- total deadline;
- retry policy;
- circuit breaker;
- bulkhead;
- rate limit;
- fallback;
- idempotency key.

## 23.1 Retry discipline

Retry only:

- safe reads;
- idempotent operations;
- writes with idempotency key;
- transient failures within deadline.

## 23.2 Rule

Resilience is semantics-aware, not annotation spray.

---

# 24. Observability Architecture

Signals:

```text
logs
metrics
traces
audit
```

## 24.1 Required correlation

Every request:

- correlation ID;
- trace ID;
- route;
- status;
- duration;
- error code.

## 24.2 Metrics

- HTTP request duration;
- error rate by code;
- downstream latency;
- DB pool;
- outbox lag;
- operation status;
- security denials.

## 24.3 Traces

Show:

```text
JAX-RS request
  application service
    DB
    outbox
    downstream HTTP
```

## 24.4 Rule

If you cannot observe it, you cannot operate it.

---

# 25. Performance Architecture

Performance design points:

- DTO shape;
- pagination;
- JSON serialization;
- filter overhead;
- DB query count;
- connection pools;
- streaming for large files;
- async for long wait;
- cache with tenant-safe keys;
- timeout budget;
- GC/allocation awareness.

## 25.1 Rule

Performance is designed at API/domain/data boundaries before tuning JVM flags.

---

# 26. OpenAPI and Documentation

OpenAPI must include:

- security scheme;
- paths and schemas;
- Problem Details;
- examples;
- pagination;
- idempotency key;
- ETag/If-Match;
- deprecation/sunset;
- SSE/streaming notes;
- upload/download limits.

## 26.1 Rule

OpenAPI is part of source of truth.

---

# 27. Testing Architecture

Test levels:

```text
domain unit tests
application service tests
resource integration tests
security tests
persistence tests
client mock-server tests
contract tests
performance smoke
end-to-end smoke
```

## 27.1 Rule

The API is not production-grade until failure paths and security paths are tested.

---

# 28. CI/CD Quality Gates

Minimum gates:

- unit tests;
- integration tests;
- security tests;
- OpenAPI diff;
- dependency vulnerability scan;
- container scan;
- static analysis;
- migration validation;
- performance smoke;
- deployment smoke.

## 28.1 Rule

CI/CD enforces architecture when humans forget.

---

# 29. Deployment Architecture

Deployment includes:

- container image;
- runtime config;
- secrets;
- DB migration;
- health checks;
- readiness/liveness;
- gateway routes;
- TLS/auth config;
- resource limits;
- autoscaling;
- telemetry exporter.

## 29.1 Rule

Deployment is part of API architecture, not separate paperwork.

---

# 30. Runtime Operations

Operational assets:

- dashboards;
- alerts;
- runbooks;
- SLOs;
- error budget;
- on-call playbooks;
- incident review;
- rollback guide;
- data repair scripts;
- feature flags.

## 30.1 Rule

A service is not done when code is merged; it is done when it can be operated.

---

# 31. Reference Package Structure

```text
com.example.application
  api
    resource
    dto
    error
    filter
    openapi
  application
    service
    command
    query
    idempotency
  domain
    model
    policy
    event
    exception
  infrastructure
    persistence
    client
    messaging
    security
    observability
    config
```

## 31.1 Rule

Architecture should be visible from package names.

---

# 32. Reference Endpoint Set

```text
POST   /applications
GET    /applications/{id}
PATCH  /applications/{id}
POST   /applications/{id}/submission
POST   /applications/{id}/withdrawal
GET    /applications/{id}/documents
POST   /applications/{id}/documents
GET    /applications/{id}/timeline
GET    /applications
POST   /reports
GET    /operations/{id}
POST   /operations/{id}/cancellation
```

## 32.1 Rule

Endpoint set should express resource lifecycle and operational processes.

---

# 33. Request Flow: Create Application

```text
POST /applications
  ↓
gateway validates size/TLS/rate
  ↓
JAX-RS auth filter validates token
  ↓
resource parses DTO + validation
  ↓
service creates aggregate
  ↓
repository saves
  ↓
audit/outbox inserted
  ↓
201 Created + Location + ETag
```

## 33.1 Failure points

- invalid request → 400/422;
- auth missing → 401;
- duplicate → 409;
- DB unavailable → 503/500;
- unexpected → 500.

## 33.2 Rule

Happy path and failure path should both be designed.

---

# 34. Request Flow: Submit Application

```text
POST /applications/{id}/submission
If-Match: "7"
Idempotency-Key: ...
  ↓
validate idempotency key
  ↓
load by tenant + id
  ↓
policy requireCanSubmit
  ↓
domain submit transition
  ↓
save version 8
  ↓
outbox ApplicationSubmitted
  ↓
audit
  ↓
200 OK + ETag "8"
```

## 34.1 Rule

Submission combines idempotency, authorization, state machine, transaction, and event.

---

# 35. Request Flow: Download Document

```text
GET /documents/{id}/download
  ↓
auth + tenant check
  ↓
document metadata lookup
  ↓
policy requireCanDownload
  ↓
object storage stream or signed URL
  ↓
Content-Disposition + Content-Type
```

## 35.1 Security

- no path traversal;
- safe filename;
- malware scan status;
- authorization before stream;
- audit download.

## 35.2 Rule

File download is security-sensitive data access.

---

# 36. Failure Flow: Downstream Timeout

```text
resource → service → CustomerGateway
  ↓
timeout
  ↓
retry if safe and budget remains
  ↓
circuit metrics
  ↓
map to domain/downstream exception
  ↓
Problem Details 503/504
  ↓
logs/metrics/traces include downstream operation
```

## 36.1 Rule

Downstream failure should be visible, classified, and safe.

---

# 37. Failure Flow: Stale ETag

```text
GET /applications/{id} → ETag "7"
Client A updates → version 8
Client B submits If-Match "7"
  ↓
stale precondition
  ↓
412 STALE_RESOURCE_VERSION
```

## 37.1 Rule

Lost update prevention is part of API correctness.

---

# 38. Failure Flow: Cross-Tenant Access

```text
Tenant A token
GET /applications/{tenantBAppId}
  ↓
repository findByTenantAndId(A, tenantBAppId)
  ↓
not found
  ↓
404 or 403 per security policy
  ↓
security metric/audit if suspicious
```

## 38.1 Rule

Cross-tenant attempt must not leak data or existence accidentally.

---

# 39. Capability Maturity Model

## Level 0 — Annotation CRUD

- JAX-RS resources;
- entity as JSON;
- no contract/tests/security depth.

## Level 1 — Basic API

- DTOs;
- validation;
- simple error handling;
- auth.

## Level 2 — Production Foundation

- Problem Details;
- OpenAPI;
- tests;
- security policy;
- metrics/logs;
- timeouts.

## Level 3 — Enterprise-Grade

- tenant/object auth;
- idempotency;
- ETag;
- outbox;
- resilience;
- dashboards;
- runbooks;
- CI gates.

## Level 4 — Top 1%

- domain-first architecture;
- compatibility governance;
- SLO/error budget;
- full observability;
- runtime internals understood;
- refactoring/migration strategy;
- threat/performance testing;
- operational excellence.

## 39.1 Rule

Know your current level and next upgrade path.

---

# 40. Architecture Review Checklist

Ask:

```text
What domain capability does each endpoint expose?
What are HTTP semantics?
What are failure modes?
What is error contract?
What is authn/authz model?
Where is tenant enforced?
Where is transaction boundary?
What events are emitted?
What are idempotency rules?
What are concurrency rules?
What are timeout/retry policies?
What are observability signals?
What tests protect this?
How is it deployed/rolled back?
```

## 40.1 Rule

A top-tier review covers runtime behavior, not only code style.

---

# 41. Top 1% Engineer Heuristics

## 41.1 When seeing POST

Ask:

```text
Is it idempotent? What happens on retry?
```

## 41.2 When seeing object ID

Ask:

```text
Where is object-level authorization?
```

## 41.3 When seeing status field update

Ask:

```text
Is this a workflow transition?
```

## 41.4 When seeing 500

Ask:

```text
Can this be classified?
```

## 41.5 When seeing outbound call

Ask:

```text
What is timeout, retry, token, error mapping, and observability?
```

## 41.6 When seeing list endpoint

Ask:

```text
Where is pagination, stable sort, tenant predicate, index?
```

## 41.7 When seeing file upload

Ask:

```text
Where are size limit, magic check, malware scan, storage safety?
```

## 41.8 Rule

Great engineers ask operational questions while reading code.

---

# 42. Common Architecture Smells

- resource method with business logic;
- JPA entity as response;
- `Map<String,Object>` API;
- no `Location` on create;
- no ETag on mutable resource;
- no idempotency for side-effecting POST;
- role-only authorization;
- no tenant predicate;
- raw downstream error returned;
- no timeout in client;
- no OpenAPI error docs;
- no correlation ID;
- no tests for 4xx/5xx;
- gateway path rewrite untested;
- SSE through buffered proxy;
- legacy behavior changed without compatibility plan.

## 42.1 Rule

Smells are prompts for deeper investigation.

---

# 43. Best Practices

## 43.1 Design from domain

Resource = domain capability.

## 43.2 Preserve HTTP semantics

Status/method/header matter.

## 43.3 Use DTOs

Contract boundary.

## 43.4 Centralize errors

Problem Details and catalog.

## 43.5 Secure at multiple layers

Token, role, object, tenant, data.

## 43.6 Make writes safe

Idempotency, ETag, transaction.

## 43.7 Isolate outbound dependencies

Gateways/adapters.

## 43.8 Observe everything important

Logs/metrics/traces/audit.

## 43.9 Test failure paths

Not only happy path.

## 43.10 Operate deliberately

SLO, alerts, runbooks, rollback.

---

# 44. Anti-Patterns

## 44.1 Database-over-HTTP

No domain boundary.

## 44.2 Annotation-driven architecture

Annotations without design.

## 44.3 Security by gateway only

No domain auth.

## 44.4 Retry everywhere

Duplicate side effects and storms.

## 44.5 Catch all exceptions as 200

Breaks HTTP.

## 44.6 One DTO for everything

Data exposure and compatibility pain.

## 44.7 No compatibility governance

Consumer breakage.

## 44.8 Observability after incident

Too late.

## 44.9 Rewrite legacy without characterization

Risky.

## 44.10 Vendor internals everywhere

Migration pain.

---

# 45. Final Production Checklist

## 45.1 Contract

- [ ] Domain-first resource model.
- [ ] OpenAPI reviewed.
- [ ] DTOs explicit.
- [ ] Status codes documented.
- [ ] Problem Details.
- [ ] Error catalog.
- [ ] ETag/If-Match where needed.
- [ ] Idempotency where needed.
- [ ] Deprecation/versioning policy.

## 45.2 Security

- [ ] TLS/gateway contract.
- [ ] JWT/OIDC validation.
- [ ] CurrentActor.
- [ ] Route-level security.
- [ ] Object-level policy.
- [ ] Tenant-aware repository.
- [ ] DTO redaction.
- [ ] CORS/CSRF policy.
- [ ] Audit logging.
- [ ] Security tests.

## 45.3 Data

- [ ] Transaction boundaries.
- [ ] Optimistic locking.
- [ ] DB constraints.
- [ ] Migrations.
- [ ] Outbox/events.
- [ ] Repository tests.
- [ ] Query performance.

## 45.4 Integration

- [ ] Typed clients/gateways.
- [ ] Timeouts.
- [ ] Retry semantics.
- [ ] Circuit/bulkhead.
- [ ] Token strategy.
- [ ] Problem decoder.
- [ ] Mock server tests.

## 45.5 Operations

- [ ] Structured logs.
- [ ] Metrics.
- [ ] Traces.
- [ ] Dashboards.
- [ ] Alerts.
- [ ] SLOs.
- [ ] Health checks.
- [ ] Runbooks.
- [ ] Rollback plan.

## 45.6 CI/CD

- [ ] Unit tests.
- [ ] Integration tests.
- [ ] Contract tests.
- [ ] Security tests.
- [ ] OpenAPI diff.
- [ ] Dependency/container scan.
- [ ] Performance smoke.
- [ ] Deployment smoke.

---

# 46. Capstone Exercises

## Exercise 1 — Architecture Review

Ambil salah satu API existing.

Nilai dengan capability maturity model Level 0–4.

Tulis 10 improvement paling berdampak.

## Exercise 2 — Vertical Slice

Bangun vertical slice:

```text
POST /applications
GET /applications/{id}
POST /applications/{id}/submission
```

Dengan:

- DTO;
- validation;
- domain;
- repository;
- Problem Details;
- security;
- ETag;
- idempotency;
- outbox;
- tests;
- OpenAPI.

## Exercise 3 — Failure Matrix

Untuk submission endpoint, buat matrix:

```text
missing token
wrong tenant
validation error
invalid state
stale ETag
duplicate idempotency key
DB unavailable
outbox publish delay
downstream timeout
```

Definisikan status, error code, retryability, logs, metrics.

## Exercise 4 — Operational Readiness Review

Buat dashboard dan runbook untuk:

- high 5xx;
- high p99;
- DB pool saturation;
- downstream timeout;
- cross-tenant denied spike;
- outbox lag;
- stuck operations.

## Exercise 5 — Legacy Modernization Plan

Ambil legacy endpoint.

Buat plan:

- inventory;
- characterization tests;
- DTO extraction;
- service extraction;
- error migration;
- security hardening;
- rollout;
- rollback.

---

# 47. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services  
   https://jakarta.ee/specifications/restful-ws/

2. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

3. MicroProfile 7.1  
   https://microprofile.io/compatible/7-1/

4. MicroProfile Specifications  
   https://microprofile.io/specifications/

5. OpenTelemetry Semantic Conventions for HTTP  
   https://opentelemetry.io/docs/specs/semconv/http/

6. OpenTelemetry Semantic Conventions for HTTP Metrics  
   https://opentelemetry.io/docs/specs/semconv/http/http-metrics/

7. OWASP REST Security Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html

8. OWASP API Security Project  
   https://owasp.org/www-project-api-security/

9. RFC 9110 — HTTP Semantics  
   https://www.rfc-editor.org/rfc/rfc9110.html

10. RFC 9457 — Problem Details for HTTP APIs  
    https://www.rfc-editor.org/rfc/rfc9457.html

11. OpenAPI Specification v3.1.0  
    https://spec.openapis.org/oas/v3.1.0.html

---

# 48. Penutup Seri

Kita sudah menyelesaikan seri advanced JAX-RS/Jakarta REST.

Jika diringkas menjadi satu kalimat:

```text
JAX-RS adalah API untuk membangun RESTful HTTP boundary,
tetapi engineering excellence datang dari bagaimana boundary itu didesain,
diamankan, diuji, diobservasi, dan dioperasikan.
```

## 48.1 Mental model akhir

```text
HTTP semantics
  ↓
resource model
  ↓
DTO contract
  ↓
validation
  ↓
domain invariant
  ↓
authorization
  ↓
transaction and persistence
  ↓
events and integration
  ↓
resilience
  ↓
observability
  ↓
tests
  ↓
operations
```

## 48.2 Final principles

```text
Do not expose database as API.
Do not confuse authentication with authorization.
Do not retry unsafe writes.
Do not let legacy behavior change accidentally.
Do not ship unobservable APIs.
Do not treat OpenAPI as decoration.
Do not treat security as one filter.
Do not tune performance before measuring.
Do not make async a hiding place for bad design.
```

## 48.3 What top 1% looks like

A top-tier engineer can:

- design API from domain;
- reason with HTTP semantics;
- predict runtime selection behavior;
- build stable error contracts;
- secure object and tenant data;
- design safe retries and idempotency;
- integrate downstreams safely;
- model long-running operations;
- observe and operate production;
- refactor legacy without breaking consumers;
- explain trade-offs clearly to team and stakeholders.

## 48.4 Final note

Annotations are syntax.

Architecture is decision-making.

Production excellence is disciplined feedback from tests, telemetry, incidents, and consumers.

That is the real mastery of JAX-RS.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-053.md](./learn-jaxrs-advanced-part-053.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-055.md](./learn-jaxrs-advanced-part-055.md)

</div>