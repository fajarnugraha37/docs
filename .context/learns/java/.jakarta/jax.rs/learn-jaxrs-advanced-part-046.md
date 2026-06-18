# learn-jaxrs-advanced-part-046.md

# Bagian 046 — Multi-Tenancy and Data Authorization in JAX-RS: Tenant Context Propagation, Tenant-Aware Resource Design, Object-Level Authorization, Row-Level Security, Repository Safeguards, DTO Redaction, Cross-Tenant Leakage Prevention, Testing, and Observability

> Target pembaca: Java/Jakarta engineer yang ingin membangun **multi-tenant REST API** yang aman dan maintainable dengan Jakarta REST/JAX-RS. Fokus bagian ini bukan hanya “tambahkan `tenantId` di query”, tetapi desain end-to-end: tenant context dari identity/gateway, propagation, resource design, object-level authorization, row/property-level access, tenant-aware repository, database row-level security, DTO redaction, cache isolation, async/job tenant context, outbound propagation, audit, testing BOLA/cross-tenant leakage, dan observability.
>
> Prinsip utama:
>
> ```text
> Multi-tenancy is not a column.
> It is a security boundary that must be enforced at API, service, repository, database, cache, async, and observability layers.
> ```

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Tenant adalah Security Boundary](#2-mental-model-tenant-adalah-security-boundary)
3. [Jenis Multi-Tenancy](#3-jenis-multi-tenancy)
4. [Tenant Resolution](#4-tenant-resolution)
5. [Trusted vs Untrusted Tenant Source](#5-trusted-vs-untrusted-tenant-source)
6. [Tenant Context Model](#6-tenant-context-model)
7. [CurrentActor, TenantContext, PermissionSet](#7-currentactor-tenantcontext-permissionset)
8. [JAX-RS Authentication Filter](#8-jax-rs-authentication-filter)
9. [SecurityContext and Application Identity](#9-securitycontext-and-application-identity)
10. [Tenant Context Propagation](#10-tenant-context-propagation)
11. [Avoid ThreadLocal Traps](#11-avoid-threadlocal-traps)
12. [Resource Design for Tenant-Scoped APIs](#12-resource-design-for-tenant-scoped-apis)
13. [Tenant in URL vs Tenant from Token](#13-tenant-in-url-vs-tenant-from-token)
14. [Object-Level Authorization / BOLA](#14-object-level-authorization--bola)
15. [Tenant-Aware Repository Pattern](#15-tenant-aware-repository-pattern)
16. [Service-Layer Authorization](#16-service-layer-authorization)
17. [Domain Authorization Policies](#17-domain-authorization-policies)
18. [Property-Level Authorization and DTO Redaction](#18-property-level-authorization-and-dto-redaction)
19. [Mass Assignment Prevention](#19-mass-assignment-prevention)
20. [Query Design and Filtering](#20-query-design-and-filtering)
21. [Pagination and Tenant Isolation](#21-pagination-and-tenant-isolation)
22. [Database Isolation Models](#22-database-isolation-models)
23. [Shared Database + Tenant Column](#23-shared-database--tenant-column)
24. [Schema-per-Tenant](#24-schema-per-tenant)
25. [Database-per-Tenant](#25-database-per-tenant)
26. [PostgreSQL Row-Level Security](#26-postgresql-row-level-security)
27. [RLS with Application Tenant Context](#27-rls-with-application-tenant-context)
28. [RLS Caveats](#28-rls-caveats)
29. [Hibernate/JPA Tenant Strategies](#29-hibernatejpa-tenant-strategies)
30. [Cache Isolation](#30-cache-isolation)
31. [Search Index Isolation](#31-search-index-isolation)
32. [Object Storage Isolation](#32-object-storage-isolation)
33. [Async Jobs and Tenant Context](#33-async-jobs-and-tenant-context)
34. [SSE/WebSocket/Streaming Tenant Safety](#34-ssewebsocketstreaming-tenant-safety)
35. [Outbound Calls and Tenant Propagation](#35-outbound-calls-and-tenant-propagation)
36. [Admin / Cross-Tenant APIs](#36-admin--cross-tenant-apis)
37. [Impersonation and Support Access](#37-impersonation-and-support-access)
38. [Audit Logging](#38-audit-logging)
39. [Observability](#39-observability)
40. [OpenAPI Documentation](#40-openapi-documentation)
41. [Testing Strategy](#41-testing-strategy)
42. [BOLA Test Matrix](#42-bola-test-matrix)
43. [Repository Safeguard Tests](#43-repository-safeguard-tests)
44. [Cache/Search/Async Leakage Tests](#44-cachesearchasync-leakage-tests)
45. [JAX-RS Implementation Sketch](#45-jax-rs-implementation-sketch)
46. [Common Failure Modes](#46-common-failure-modes)
47. [Best Practices](#47-best-practices)
48. [Anti-Patterns](#48-anti-patterns)
49. [Production Checklist](#49-production-checklist)
50. [Latihan](#50-latihan)
51. [Referensi Resmi](#51-referensi-resmi)
52. [Penutup](#52-penutup)

---

# 1. Tujuan Part Ini

Multi-tenant API adalah API yang melayani banyak tenant/organization/customer dalam satu platform.

Contoh:

```text
Tenant A: agency-a
Tenant B: agency-b
Tenant C: partner-c
```

Masalah fatal:

```http
GET /applications/APP-B-001
Authorization: user from Tenant A
```

Jika response mengembalikan data Tenant B, itu data breach.

Bahkan jika ID resource berupa UUID random, tetap tidak boleh bergantung pada “sulit ditebak”.

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- mendesain tenant context yang terpercaya;
- membedakan tenant dari token/header/path/body;
- menerapkan object-level authorization;
- membuat repository tenant-safe by design;
- menggunakan database-level defense seperti RLS;
- mencegah excessive data exposure dan mass assignment;
- mengisolasi cache/search/object storage;
- membawa tenant context ke async jobs dan outbound calls;
- mendesain admin/cross-tenant APIs secara aman;
- menulis BOLA/cross-tenant tests;
- mengobservasi tenant access tanpa cardinality chaos.

---

# 2. Mental Model: Tenant adalah Security Boundary

Tenant bukan hanya kolom:

```sql
tenant_id
```

Tenant adalah boundary:

```text
who can see what
who can mutate what
where data is stored
what cache key is used
what events are emitted
what audit trail records
what worker can process
what search index is queried
```

## 2.1 Multi-layer enforcement

Ideal enforcement:

```text
token tenant claim
  ↓
request tenant context
  ↓
service authorization
  ↓
repository tenant predicate
  ↓
database policy/constraint
  ↓
cache/search/storage key isolation
  ↓
audit/observability
```

## 2.2 Rule

Never rely on only one tenant check.

---

# 3. Jenis Multi-Tenancy

## 3.1 Shared database, shared schema, tenant column

All tenants share tables.

```sql
applications(tenant_id, id, ...)
```

Pros:

- simple operations;
- efficient resource usage;
- easy global analytics.

Cons:

- highest leakage risk if predicates missed;
- noisy neighbor;
- harder per-tenant restore.

## 3.2 Shared database, schema per tenant

```text
tenant_a.applications
tenant_b.applications
```

Pros:

- stronger logical isolation;
- easier tenant export/restore.

Cons:

- migration complexity;
- many schemas;
- connection/search path management.

## 3.3 Database per tenant

Pros:

- strong isolation;
- custom scaling;
- per-tenant backup/restore.

Cons:

- operational overhead;
- routing complexity;
- cross-tenant analytics harder.

## 3.4 Rule

Isolation model is product/security/operations decision, not ORM preference.

---

# 4. Tenant Resolution

Tenant may come from:

- JWT/OIDC claim;
- mTLS certificate;
- API key mapping;
- subdomain;
- path segment;
- gateway-injected header;
- session;
- admin selected tenant.

## 4.1 Best source

Trusted identity source.

Example JWT claims:

```json
{
  "sub": "user-123",
  "tenant_id": "tenant-a",
  "scope": "applications:read"
}
```

## 4.2 Dangerous source

Request body:

```json
{
  "tenantId": "tenant-b"
}
```

A normal tenant-scoped user should not choose tenant by body.

## 4.3 Rule

Tenant context must come from authenticated trusted source, not arbitrary input.

---

# 5. Trusted vs Untrusted Tenant Source

## 5.1 Trusted

- verified JWT claim from trusted issuer;
- mTLS identity mapped server-side;
- API key mapped server-side;
- gateway header only if gateway-to-app channel is protected and spoofing blocked.

## 5.2 Untrusted

- client-provided header from internet;
- request body tenant field;
- query param tenant unless admin API;
- path tenant unless checked against identity.

## 5.3 Gateway header caveat

If gateway sends:

```http
X-Tenant-ID: tenant-a
```

App must ensure external clients cannot spoof it.

## 5.4 Rule

Never trust tenant headers unless you control the boundary that sets and strips them.

---

# 6. Tenant Context Model

Define explicit context:

```java
public record TenantContext(
    TenantId tenantId,
    TenantType tenantType,
    boolean crossTenantAllowed
) {}
```

## 6.1 Avoid primitive string everywhere

Bad:

```java
String tenantId
```

Better:

```java
TenantId tenantId
```

## 6.2 Why

- type safety;
- validation;
- avoids confusing tenant ID with org ID/client ID;
- central policy.

## 6.3 Rule

Tenant context should be a first-class type.

---

# 7. CurrentActor, TenantContext, PermissionSet

## 7.1 CurrentActor

```java
public record CurrentActor(
    UserId userId,
    TenantContext tenant,
    PermissionSet permissions,
    Set<Role> roles,
    AuthScheme authScheme
) {}
```

## 7.2 PermissionSet

```java
public boolean can(Permission permission) { ... }
```

## 7.3 Why not use SecurityContext everywhere?

`SecurityContext` is HTTP API boundary.

Application/domain should use application identity model.

## 7.4 Rule

Convert protocol identity into application identity once at boundary.

---

# 8. JAX-RS Authentication Filter

A filter can validate token and create `CurrentActor`.

## 8.1 Example

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class AuthenticationFilter implements ContainerRequestFilter {

    @Inject TokenVerifier tokenVerifier;

    @Override
    public void filter(ContainerRequestContext ctx) {
        String authorization = ctx.getHeaderString(HttpHeaders.AUTHORIZATION);

        VerifiedToken token = tokenVerifier.verify(authorization);
        CurrentActor actor = CurrentActorMapper.from(token);

        ctx.setProperty("currentActor", actor);
        ctx.setSecurityContext(new ActorSecurityContext(actor, ctx.getSecurityContext().isSecure()));
    }
}
```

## 8.2 Fail closed

If token invalid:

```http
401
```

## 8.3 Rule

Authentication filter must produce a validated actor, not merely parse claims.

---

# 9. SecurityContext and Application Identity

Jakarta REST `SecurityContext` provides access to security information such as principal and role checks.

## 9.1 Use at resource boundary

```java
@Context SecurityContext securityContext
```

## 9.2 But use custom context for domain

```java
CurrentActor actor = actorProvider.current();
```

## 9.3 Rule

`SecurityContext` is not enough for tenant/domain authorization.

---

# 10. Tenant Context Propagation

Tenant context must propagate to:

- service layer;
- repository;
- DB session/RLS;
- cache key;
- event payload metadata;
- async job;
- outbox;
- logs/traces;
- outbound headers if appropriate.

## 10.1 Explicit parameter

```java
service.getApplication(actor, applicationId);
```

## 10.2 Context provider

```java
actorProvider.current()
```

## 10.3 Rule

Every data access should be able to answer: “which tenant authorized this?”

---

# 11. Avoid ThreadLocal Traps

ThreadLocal works in simple request-thread model but fails in:

- async;
- CompletionStage;
- executor handoff;
- reactive runtime;
- worker jobs;
- tests with parallel execution.

## 11.1 Safer pattern

Pass actor/tenant explicitly into async job command.

```java
new GenerateReportCommand(actor.tenantId(), actor.userId(), request)
```

## 11.2 If using ThreadLocal

- clear in finally;
- propagate explicitly;
- test async behavior.

## 11.3 Rule

Tenant context must not disappear or leak across threads.

---

# 12. Resource Design for Tenant-Scoped APIs

## 12.1 User-facing tenant-scoped API

```text
GET /applications/{id}
```

Tenant comes from identity.

## 12.2 Admin API

```text
GET /tenants/{tenantId}/applications/{id}
```

Requires cross-tenant admin permission.

## 12.3 Avoid body tenant

```json
{
  "tenantId": "tenant-b"
}
```

for normal user operations.

## 12.4 Rule

Endpoint shape should make tenant authority explicit.

---

# 13. Tenant in URL vs Tenant from Token

## 13.1 Tenant from token

Good for normal tenant user:

```http
GET /applications/APP-123
Authorization: Bearer tenant-a-user
```

## 13.2 Tenant in URL

Good for platform admin:

```http
GET /tenants/tenant-a/applications/APP-123
```

But must verify admin can access tenant-a.

## 13.3 Tenant mismatch

If URL tenant differs from token tenant and caller is not cross-tenant admin:

```http
403
```

or hidden 404 depending policy.

## 13.4 Rule

Path tenant is request claim, not authorization proof.

---

# 14. Object-Level Authorization / BOLA

OWASP API1:2023 BOLA occurs when attacker manipulates object ID and gains unauthorized object access.

## 14.1 Bad

```java
Application app = repository.findById(applicationId)
    .orElseThrow(NotFound::new);
return mapper.toResponse(app);
```

## 14.2 Better

```java
Application app = repository.findByTenantAndId(actor.tenantId(), applicationId)
    .orElseThrow(NotFound::new);

authorization.checkCanView(actor, app);

return mapper.toResponse(app, actor);
```

## 14.3 Rule

Any endpoint that accepts object ID needs object-level authorization.

---

# 15. Tenant-Aware Repository Pattern

## 15.1 Make unsafe method unavailable

Avoid public:

```java
Optional<Application> findById(ApplicationId id);
```

Prefer:

```java
Optional<Application> findByTenantAndId(TenantId tenantId, ApplicationId id);
```

## 15.2 For admin

Explicit:

```java
Optional<Application> findByTenantAndIdForAdmin(TenantId tenantId, ApplicationId id, CurrentActor admin);
```

or separate admin repository/service.

## 15.3 Rule

Repository API should make tenant predicate hard to forget.

---

# 16. Service-Layer Authorization

Resource layer can check route-level permissions.

Service layer must check domain/object permissions.

## 16.1 Example

```java
public ApplicationResponse withdraw(CurrentActor actor, ApplicationId id) {
    Application app = repo.findByTenantAndId(actor.tenantId(), id)
        .orElseThrow(ResourceNotFoundException::new);

    policy.requireCanWithdraw(actor, app);

    app.withdraw(actor.userId());
    return mapper.toResponse(app, actor);
}
```

## 16.2 Rule

Domain-changing methods should accept actor/context explicitly.

---

# 17. Domain Authorization Policies

Create policy objects.

```java
@ApplicationScoped
public class ApplicationPolicy {

    public void requireCanWithdraw(CurrentActor actor, Application app) {
        if (!app.tenantId().equals(actor.tenantId())) {
            throw new AccessDeniedException();
        }

        if (!app.applicantUserId().equals(actor.userId())) {
            throw new AccessDeniedException();
        }

        if (!app.isWithdrawable()) {
            throw new InvalidStateTransitionException();
        }
    }
}
```

## 17.1 Why policy object

- reusable;
- testable;
- domain language;
- avoids scattering `if` checks.

## 17.2 Rule

Authorization logic should be explicit and testable.

---

# 18. Property-Level Authorization and DTO Redaction

Object access does not imply all fields access.

## 18.1 Example

Officer sees internal fields.

Applicant does not.

```java
public ApplicationResponse toResponse(Application app, CurrentActor actor) {
    return new ApplicationResponse(
        app.id(),
        app.status(),
        actor.can(VIEW_INTERNAL_REMARKS) ? app.internalRemarks() : null
    );
}
```

## 18.2 Alternative

Different DTOs/endpoints per audience.

```text
/applications/{id}
/officer/applications/{id}
```

## 18.3 Rule

Response mapper is a data authorization boundary.

---

# 19. Mass Assignment Prevention

Mass assignment occurs when client can set fields they should not.

## 19.1 Bad

```java
entity.setStatus(request.status());
entity.setTenantId(request.tenantId());
entity.setApprovedBy(request.approvedBy());
```

## 19.2 Good

Use command DTO:

```java
public record SubmitApplicationRequest(boolean declarationAccepted) {}
```

No tenant/status/admin fields.

## 19.3 PATCH risk

PATCH must allowlist fields.

## 19.4 Rule

Request DTO should contain only fields caller is allowed to control.

---

# 20. Query Design and Filtering

## 20.1 Bad

```http
GET /applications?tenantId=tenant-b
```

for normal tenant user.

## 20.2 Good

Tenant is implicit from actor.

```http
GET /applications?status=SUBMITTED
```

Repository adds tenant predicate.

## 20.3 Admin

```http
GET /tenants/{tenantId}/applications?status=SUBMITTED
```

with admin permission.

## 20.4 Rule

Do not expose tenant filter to normal users.

---

# 21. Pagination and Tenant Isolation

## 21.1 Tenant predicate first

Query must filter by tenant before pagination.

```sql
where tenant_id = :tenantId
order by created_at desc, id desc
limit :limit
```

## 21.2 Cursor must include tenant or be scoped

Cursor should not allow cross-tenant continuation.

## 21.3 Rule

Cursor tokens must be tamper-resistant and tenant-scoped.

---

# 22. Database Isolation Models

Compare isolation models.

| Model | Isolation | Ops Cost | Leakage Risk |
|---|---:|---:|---:|
| Shared schema + tenant column | Low/Medium | Low | High if bug |
| Schema per tenant | Medium | Medium | Medium |
| DB per tenant | High | High | Lower app-query leakage |

## 22.1 Rule

Stronger isolation costs more operationally but reduces blast radius.

---

# 23. Shared Database + Tenant Column

Most common SaaS/enterprise model.

## 23.1 Requirements

Every tenant-owned table includes `tenant_id`.

Every query includes tenant predicate.

Unique constraints include tenant:

```sql
unique(tenant_id, email)
```

FKs include tenant when possible.

## 23.2 Rule

Tenant column design must be enforced by schema and repository patterns.

---

# 24. Schema-per-Tenant

## 24.1 Routing

Tenant context selects schema.

## 24.2 Risk

Wrong schema selection leaks/mutates wrong tenant.

## 24.3 Migration

Migrations run per schema.

## 24.4 Rule

Schema-per-tenant moves leakage risk to connection/schema routing.

---

# 25. Database-per-Tenant

## 25.1 Routing

Tenant context selects datasource.

## 25.2 Operational concerns

- many pools;
- migrations;
- backups;
- cost;
- monitoring;
- failover.

## 25.3 Rule

Database-per-tenant needs platform automation.

---

# 26. PostgreSQL Row-Level Security

PostgreSQL Row-Level Security can restrict which rows are visible/modifiable based on policies.

## 26.1 Example concept

```sql
alter table applications enable row level security;

create policy tenant_isolation on applications
using (tenant_id = current_setting('app.tenant_id')::uuid)
with check (tenant_id = current_setting('app.tenant_id')::uuid);
```

## 26.2 Defense-in-depth

Even if application query forgets tenant predicate, RLS can prevent leakage.

## 26.3 Rule

RLS is powerful defense-in-depth, not replacement for application authorization.

---

# 27. RLS with Application Tenant Context

## 27.1 Set local variable per transaction

```sql
set local app.tenant_id = '...';
```

## 27.2 In Java transaction

Set after acquiring connection and before queries.

## 27.3 Reset

Use transaction-local settings or ensure cleanup on pooled connections.

## 27.4 Rule

RLS context must be set safely for every transaction/connection.

---

# 28. RLS Caveats

## 28.1 Superuser/table owner bypass

Some roles bypass RLS.

Use least-privilege DB role.

## 28.2 Connection pool leakage

Session variables can leak if not local/reset.

## 28.3 Admin queries

Need explicit bypass roles/policies with audit.

## 28.4 Performance

Policies can affect query planning/performance.

## 28.5 Rule

RLS needs DBA/security review and integration tests.

---

# 29. Hibernate/JPA Tenant Strategies

Common patterns:

- discriminator/tenant column;
- schema multi-tenancy;
- database multi-tenancy;
- filters;
- interceptors.

## 29.1 Risk

ORM filters can be disabled or missed.

## 29.2 Recommendation

Combine:

- repository API tenant parameter;
- schema constraints;
- ORM filter if useful;
- DB RLS if feasible.

## 29.3 Rule

Do not treat ORM tenant filter as sole security control.

---

# 30. Cache Isolation

Cache key must include tenant.

## 30.1 Bad

```text
application:APP-123
```

## 30.2 Good

```text
tenant:tenant-a:application:APP-123
```

## 30.3 Shared reference data

If truly global, mark as global explicitly.

## 30.4 Rule

Every cache key for tenant data includes tenant or uses isolated cache namespace.

---

# 31. Search Index Isolation

Search can leak data if tenant filter missing.

## 31.1 Options

- tenant field filter in every query;
- index per tenant;
- alias per tenant;
- document-level security if platform supports.

## 31.2 Cursor/search-after

Must preserve tenant filter.

## 31.3 Rule

Search queries need same authorization rigor as DB queries.

---

# 32. Object Storage Isolation

Object keys must be tenant-safe.

## 32.1 Bad

```text
documents/{documentId}.pdf
```

## 32.2 Good

```text
tenants/{tenantId}/documents/{documentId}/content
```

## 32.3 Download

Do not expose raw storage URL unless signed and authorization checked.

## 32.4 Rule

Object storage key design is data isolation design.

---

# 33. Async Jobs and Tenant Context

When creating job:

```json
{
  "operationId": "OP-1",
  "tenantId": "tenant-a",
  "actorId": "user-1",
  "permissionsSnapshot": [...]
}
```

## 33.1 Worker

Worker must load tenant context from job.

## 33.2 Do not rely on request thread context

Request is gone.

## 33.3 Rule

Async job must carry durable tenant/actor context.

---

# 34. SSE/WebSocket/Streaming Tenant Safety

## 34.1 SSE

Subscriber must only receive tenant-authorized events.

## 34.2 Streaming download

Check authorization before opening stream.

Do not continue after permission revoked if policy requires strict enforcement.

## 34.3 Broadcast

Never broadcast by global topic without tenant filtering.

## 34.4 Rule

Long-lived streams need tenant-aware subscription and cleanup.

---

# 35. Outbound Calls and Tenant Propagation

When calling downstream:

## 35.1 Propagate only necessary context

Possible headers:

```http
X-Tenant-ID
X-Actor-ID
X-Correlation-ID
```

Only if downstream is trusted and contract requires it.

## 35.2 Token relay

Do not blindly forward user token.

Use:

- token exchange;
- service token;
- scoped downstream token;
- mTLS identity.

## 35.3 Rule

Tenant propagation must be intentional and contract-defined.

---

# 36. Admin / Cross-Tenant APIs

Admin APIs are dangerous.

## 36.1 Separate route

```text
/admin/tenants/{tenantId}/applications
```

or:

```text
/tenants/{tenantId}/applications
```

with admin scope.

## 36.2 Requirements

- strong auth;
- explicit cross-tenant permission;
- audit;
- reason code;
- read/write separation;
- rate limits;
- approval workflow for sensitive actions.

## 36.3 Rule

Cross-tenant access should be rare, explicit, and audited.

---

# 37. Impersonation and Support Access

Support may need view as tenant/user.

## 37.1 Requirements

- explicit permission;
- target tenant/user;
- reason;
- time limit;
- audit;
- visible banner in UI;
- no sensitive actions unless allowed.

## 37.2 Audit identity

Record both:

```text
actualActor
impersonatedActor
tenant
reason
```

## 37.3 Rule

Impersonation must never erase original actor identity.

---

# 38. Audit Logging

Audit tenant-sensitive actions:

- read sensitive document;
- export data;
- cross-tenant admin access;
- permission change;
- tenant config change;
- failed tenant access;
- impersonation start/stop.

## 38.1 Fields

```text
tenantId
actorId
action
resourceType
resourceId
result
correlationId
reason
```

## 38.2 Rule

Audit logs are security evidence and must be tamper-resistant.

---

# 39. Observability

## 39.1 Metrics

Avoid tenant ID as high-cardinality metric label unless controlled.

Use:

- tenant tier;
- plan;
- region;
- service;
- operation;
- result.

## 39.2 Logs/traces

May include tenant ID if allowed by policy.

## 39.3 Security metrics

```text
authorization.denied.total
tenant.access.denied.total
cross_tenant.admin_access.total
bola.test.failures
```

## 39.4 Rule

Observe tenant access patterns without exploding cardinality or leaking sensitive data.

---

# 40. OpenAPI Documentation

Document:

- whether tenant comes from auth context;
- admin path tenant param;
- authorization errors;
- hidden 404 policy;
- tenant-scoped pagination;
- required scopes;
- Problem Details codes.

## 40.1 Do not expose internal model

OpenAPI should document contract, not DB tenant implementation.

## 40.2 Rule

Tenant behavior is API contract and should be documented.

---

# 41. Testing Strategy

Test layers:

- resource authorization;
- service policy;
- repository tenant predicate;
- DB RLS;
- cache keys;
- search queries;
- async jobs;
- streaming/SSE;
- admin APIs.

## 41.1 Test data

Always create at least two tenants.

```text
tenantA resourceA
tenantB resourceB
```

## 41.2 Rule

Multi-tenancy tests require multiple tenants in every relevant test.

---

# 42. BOLA Test Matrix

For every endpoint with object ID:

| Test | Expected |
|---|---|
| owner tenant reads own object | 200 |
| tenant A reads tenant B object | 403/404 |
| tenant A updates tenant B object | 403/404 and no mutation |
| tenant A deletes tenant B object | 403/404 and no mutation |
| tenant A guesses nonexistent object | 404 |
| admin reads tenant object | 200 + audit |
| admin without permission reads tenant object | 403 |
| stale cache after permission change | no leak |

## 42.1 Rule

BOLA tests must verify data state, not only response status.

---

# 43. Repository Safeguard Tests

## 43.1 Static/architecture test

Ban unsafe repository methods:

```text
findById(id)
findAll()
deleteById(id)
```

for tenant-owned aggregates.

## 43.2 Integration test

Seed two tenants and assert repository query returns only current tenant.

## 43.3 Rule

Make unsafe data access detectable in CI.

---

# 44. Cache/Search/Async Leakage Tests

## 44.1 Cache

Tenant A warms cache.

Tenant B requests same ID.

Must not receive tenant A data.

## 44.2 Search

Tenant filter missing should fail test.

## 44.3 Async

Job created by tenant A cannot be read/cancelled by tenant B.

## 44.4 Rule

Cross-tenant leakage often happens outside primary DB query path.

---

# 45. JAX-RS Implementation Sketch

## 45.1 Actor provider

```java
@RequestScoped
public class CurrentActorProvider {
    private CurrentActor actor;

    public CurrentActor current() {
        if (actor == null) {
            throw new IllegalStateException("No authenticated actor");
        }
        return actor;
    }

    public void set(CurrentActor actor) {
        this.actor = actor;
    }
}
```

## 45.2 Filter

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class TenantAuthenticationFilter implements ContainerRequestFilter {

    @Inject TokenVerifier verifier;
    @Inject CurrentActorProvider actorProvider;

    @Override
    public void filter(ContainerRequestContext ctx) {
        VerifiedToken token = verifier.verify(ctx.getHeaderString(HttpHeaders.AUTHORIZATION));
        CurrentActor actor = CurrentActor.from(token);

        actorProvider.set(actor);
        ctx.setSecurityContext(new ActorSecurityContext(actor));
    }
}
```

## 45.3 Resource

```java
@GET
@Path("/applications/{id}")
public ApplicationResponse get(@PathParam("id") ApplicationId id) {
    CurrentActor actor = actorProvider.current();
    return service.get(actor, id);
}
```

## 45.4 Service

```java
public ApplicationResponse get(CurrentActor actor, ApplicationId id) {
    Application app = repository.findByTenantAndId(actor.tenantId(), id)
        .orElseThrow(ResourceNotFoundException::new);

    policy.requireCanView(actor, app);

    return mapper.toResponse(app, actor);
}
```

## 45.5 Rule

Actor/tenant flows explicitly from boundary to data access and response mapping.

---

# 46. Common Failure Modes

## 46.1 Missing tenant predicate

Classic data leak.

## 46.2 Cache key missing tenant

Tenant sees another tenant's cached data.

## 46.3 Search query missing tenant filter

Search leak.

## 46.4 Tenant from body trusted

Tenant spoofing.

## 46.5 Admin API no audit

Untraceable cross-tenant access.

## 46.6 ThreadLocal tenant leaks

Wrong tenant in async/thread reuse.

## 46.7 Job lacks tenant

Worker processes under wrong context.

## 46.8 DTO exposes internal fields

Property-level authorization failure.

## 46.9 PATCH allows tenant/status fields

Mass assignment.

## 46.10 RLS session variable leaks in pool

Wrong tenant at DB layer.

## 46.11 Metrics label tenant ID blindly

Cardinality/cost issue.

## 46.12 Tests use only one tenant

BOLA bugs missed.

---

# 47. Best Practices

## 47.1 Tenant context from trusted identity

Not body/query/header from internet.

## 47.2 Make tenant explicit in service/repository

Pass `CurrentActor` or `TenantId`.

## 47.3 Avoid unsafe repository methods

Tenant-owned data needs tenant-aware methods.

## 47.4 Enforce object authorization

Every object ID access.

## 47.5 Redact DTO by permission

Object access ≠ field access.

## 47.6 Include tenant in cache/search/storage keys

Or isolate namespaces.

## 47.7 Use DB defense-in-depth

RLS/constraints where feasible.

## 47.8 Carry tenant into async jobs

Durably.

## 47.9 Audit cross-tenant/admin access

Always.

## 47.10 Test with multiple tenants

Every endpoint class.

---

# 48. Anti-Patterns

## 48.1 “UUID is enough”

No. Authorization still required.

## 48.2 `findById` then check tenant later

Risky and easy to misuse.

## 48.3 Tenant ID from request body

Spoofable.

## 48.4 One global cache keyspace

Leak risk.

## 48.5 Search service trusted blindly

Search also needs tenant filter.

## 48.6 Admin endpoint mixed with user endpoint

Authorization confusion.

## 48.7 Impersonation without audit

Dangerous.

## 48.8 ThreadLocal everywhere

Async leakage.

## 48.9 RLS as only control

Application still needs domain auth.

## 48.10 No BOLA tests

Security gap.

---

# 49. Production Checklist

## 49.1 Identity/context

- [ ] Tenant resolved from trusted identity.
- [ ] Tenant source documented.
- [ ] `CurrentActor` model defined.
- [ ] `TenantContext` first-class type.
- [ ] SecurityContext mapped to app identity.
- [ ] Context cleared/propagated safely.

## 49.2 Authorization

- [ ] Function-level permissions.
- [ ] Object-level authorization.
- [ ] Property-level authorization.
- [ ] Tenant-safe repository methods.
- [ ] Admin cross-tenant policy.
- [ ] Impersonation policy.
- [ ] Hidden 404/403 policy.

## 49.3 Data layers

- [ ] Tenant column/constraint strategy.
- [ ] Repository architecture tests.
- [ ] RLS or DB defense considered.
- [ ] Cache keys include tenant.
- [ ] Search queries include tenant filter.
- [ ] Object storage keys include tenant.
- [ ] Async jobs include tenant context.

## 49.4 Tests/observability

- [ ] Two-tenant test data.
- [ ] BOLA matrix tests.
- [ ] Cross-tenant mutation tests.
- [ ] Cache/search/async leakage tests.
- [ ] Audit tests for admin access.
- [ ] Security metrics/logging.
- [ ] OpenAPI documents tenant behavior.

---

# 50. Latihan

## Latihan 1 — Tenant Context

Buat:

```java
TenantId
TenantContext
CurrentActor
PermissionSet
```

Lalu map dari verified JWT claims.

## Latihan 2 — Tenant-Safe Repository

Refactor:

```java
findById(id)
```

menjadi:

```java
findByTenantAndId(tenantId, id)
```

Tambahkan architecture test agar method lama tidak boleh dipakai.

## Latihan 3 — BOLA Tests

Untuk endpoint:

```text
GET /applications/{id}
PATCH /applications/{id}
DELETE /documents/{id}
```

Buat tenant A/B dan test cross-tenant access.

## Latihan 4 — DTO Redaction

Role applicant dan officer mendapat response berbeda.

Test field internal tidak muncul untuk applicant.

## Latihan 5 — Cache Leak

Simulasikan cache key tanpa tenant.

Tulis test yang gagal.

Perbaiki dengan tenant-scoped key.

## Latihan 6 — RLS Spike

Di PostgreSQL, buat table `applications` dengan RLS policy.

Set `app.tenant_id` per transaction.

Test query tanpa tenant predicate tetap tidak leak.

## Latihan 7 — Async Job Tenant Context

Submit operation oleh tenant A.

Tenant B mencoba poll/cancel.

Pastikan ditolak.

Worker memproses dengan tenant context benar.

## Latihan 8 — Admin Audit

Admin melihat resource tenant lain.

Pastikan audit log mencatat actual actor, tenant target, reason, correlation ID.

---

# 51. Referensi Resmi

Referensi utama:

1. OWASP Authorization Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

2. OWASP API1:2023 — Broken Object Level Authorization  
   https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/

3. OWASP API Security Top 10 2023  
   https://owasp.org/API-Security/editions/2023/en/0x11-t10/

4. PostgreSQL Documentation — Row Security Policies  
   https://www.postgresql.org/docs/current/ddl-rowsecurity.html

5. Jakarta RESTful Web Services 4.0 API Docs — `SecurityContext` package summary  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/package-summary

6. Jakarta RESTful Web Services 4.0 API Docs — `ContainerRequestContext`  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/containerrequestcontext

7. OWASP REST Security Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html

---

# 52. Penutup

Multi-tenancy yang aman tidak selesai dengan menambahkan `tenant_id`.

Mental model final:

```text
trusted identity
  ↓
CurrentActor + TenantContext
  ↓
resource-level policy
  ↓
service/domain authorization
  ↓
tenant-aware repository
  ↓
database defense
  ↓
cache/search/storage isolation
  ↓
async/outbound propagation
  ↓
audit + observability
```

Prinsip final:

```text
Tenant is security boundary.
Every object ID needs authorization.
Repository API should make tenant impossible to forget.
DTO mapping is data authorization.
Cache/search/storage also need isolation.
Async jobs need durable tenant context.
Admin cross-tenant access must be explicit and audited.
Tests must use at least two tenants.
```

Top-tier JAX-RS engineer memastikan:

- tenant context berasal dari identity terpercaya;
- object-level authorization dilakukan setiap akses object;
- tenant predicate tidak bisa dilupakan di repository;
- database/cache/search/storage punya defense-in-depth;
- DTO tidak mengekspos field lintas permission;
- async/SSE/outbound membawa tenant context dengan aman;
- BOLA/cross-tenant tests menjadi bagian CI;
- audit dan observability mendukung investigasi data access.

Part berikutnya:

```text
Bagian 047 — API Gateway, Reverse Proxy, Load Balancer, and JAX-RS Apps
```

Kita akan membahas bagaimana gateway/proxy/LB memengaruhi Jakarta REST apps: forwarded headers, base URI, TLS termination, path rewriting, CORS, auth offload, rate limit, request size, timeout, buffering, streaming/SSE, observability, and security boundaries.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-045.md](./learn-jaxrs-advanced-part-045.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-047.md](./learn-jaxrs-advanced-part-047.md)

</div>