# learn-jaxrs-advanced-part-052.md

# Bagian 052 — Building a Production-Grade JAX-RS API from Scratch: Package Structure, Resource Design, DTOs, Validation, Error Contract, Security, Persistence, Client Integration, Observability, OpenAPI, Tests, Deployment, and Operational Checklist

> Target pembaca: Java/Jakarta engineer yang ingin membangun **JAX-RS/Jakarta REST API production-grade dari nol** dengan mental model top-tier engineer. Fokus bagian ini bukan “hello world REST”, tetapi end-to-end blueprint: domain modeling, package structure, resource design, DTO boundary, validation, Problem Details, security, tenant authorization, persistence, transactions, outbound clients, idempotency, observability, OpenAPI, tests, CI/CD, deployment, and operations.
>
> Prinsip utama:
>
> ```text
> Production-grade API is not created by adding annotations.
> It is created by designing boundaries, contracts, failure behavior, security, tests, and operations together.
> ```

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Target Architecture](#2-target-architecture)
3. [Domain Example](#3-domain-example)
4. [Package Structure](#4-package-structure)
5. [Layering Rules](#5-layering-rules)
6. [Maven/Gradle Dependencies](#6-mavengradle-dependencies)
7. [Application Bootstrap](#7-application-bootstrap)
8. [Resource Design](#8-resource-design)
9. [DTO Boundary](#9-dto-boundary)
10. [Request DTOs](#10-request-dtos)
11. [Response DTOs](#11-response-dtos)
12. [Mapper Strategy](#12-mapper-strategy)
13. [Validation Boundary](#13-validation-boundary)
14. [Domain Model](#14-domain-model)
15. [Application Service](#15-application-service)
16. [Repository Boundary](#16-repository-boundary)
17. [Transactions](#17-transactions)
18. [Persistence Mapping](#18-persistence-mapping)
19. [Optimistic Locking and ETag](#19-optimistic-locking-and-etag)
20. [Idempotency](#20-idempotency)
21. [Error Contract](#21-error-contract)
22. [Problem Details Factory](#22-problem-details-factory)
23. [Exception Mappers](#23-exception-mappers)
24. [Security Architecture](#24-security-architecture)
25. [CurrentActor and TenantContext](#25-currentactor-and-tenantcontext)
26. [Authorization Policies](#26-authorization-policies)
27. [Pagination, Filtering, Sorting](#27-pagination-filtering-sorting)
28. [Outbound Client Integration](#28-outbound-client-integration)
29. [Resilience Policy](#29-resilience-policy)
30. [Observability](#30-observability)
31. [Structured Logging](#31-structured-logging)
32. [Metrics](#32-metrics)
33. [Tracing](#33-tracing)
34. [OpenAPI Contract](#34-openapi-contract)
35. [Health Checks](#35-health-checks)
36. [Configuration](#36-configuration)
37. [Testing Pyramid](#37-testing-pyramid)
38. [Resource/API Tests](#38-resourceapi-tests)
39. [Security Tests](#39-security-tests)
40. [Persistence Tests](#40-persistence-tests)
41. [Client Integration Tests](#41-client-integration-tests)
42. [Contract Tests](#42-contract-tests)
43. [Performance Smoke Tests](#43-performance-smoke-tests)
44. [CI/CD Quality Gates](#44-cicd-quality-gates)
45. [Deployment Readiness](#45-deployment-readiness)
46. [Runtime Operations](#46-runtime-operations)
47. [Step-by-Step Build Plan](#47-step-by-step-build-plan)
48. [Common Failure Modes](#48-common-failure-modes)
49. [Best Practices](#49-best-practices)
50. [Anti-Patterns](#50-anti-patterns)
51. [Production Checklist](#51-production-checklist)
52. [Latihan](#52-latihan)
53. [Referensi Resmi](#53-referensi-resmi)
54. [Penutup](#54-penutup)

---

# 1. Tujuan Part Ini

Kita sudah membahas banyak bagian JAX-RS secara terpisah:

- resources;
- request matching;
- parameters;
- providers;
- filters;
- security;
- validation;
- error handling;
- client;
- resilience;
- OpenAPI;
- observability;
- performance;
- multi-tenancy;
- runtime internals.

Sekarang kita satukan menjadi blueprint membangun API dari nol.

## 1.1 Output yang ingin dicapai

Kita ingin API yang:

- domain-driven, bukan table-driven;
- punya HTTP contract jelas;
- DTO tidak bocor dari entity;
- validation dan domain invariant dipisah;
- error response konsisten;
- security dan tenant authorization testable;
- persistence aman dan transactional;
- outbound client resilient;
- OpenAPI bisa dipakai consumer;
- observability siap production;
- tests cukup untuk refactor;
- deployment bisa dioperasikan.

## 1.2 Rule

Build the API as a product contract, not as controller methods around database calls.

---

# 2. Target Architecture

Target architecture sederhana tapi production-grade:

```text
api/
  JAX-RS resources
  request/response DTOs
  exception mappers
  filters
  OpenAPI annotations

application/
  use cases / application services
  command/query handlers
  transaction boundary
  idempotency orchestration

domain/
  aggregates
  value objects
  domain services
  policies
  domain exceptions

infrastructure/
  persistence repositories
  external clients
  config
  telemetry
  security integration
```

## 2.1 Direction rule

```text
api → application → domain
infrastructure → application/domain contracts
domain → no JAX-RS/JPA/HTTP dependency
```

## 2.2 Why

This prevents:

- JAX-RS annotations leaking into domain;
- JPA entities returned directly;
- outbound DTOs contaminating core model;
- security scattered in resources;
- tests requiring full container for everything.

---

# 3. Domain Example

We use `Application` domain.

Capabilities:

```text
create draft application
view application
update draft details
submit application
withdraw application
upload document
record decision
list applications
```

States:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
APPROVED
REJECTED
WITHDRAWN
```

Core API:

```text
POST   /applications
GET    /applications/{id}
PATCH  /applications/{id}
POST   /applications/{id}/submission
POST   /applications/{id}/withdrawal
GET    /applications
POST   /applications/{id}/documents
GET    /applications/{id}/timeline
```

## 3.1 Rule

Start from domain capability and lifecycle, not CRUD table.

---

# 4. Package Structure

Recommended:

```text
com.example.licensing
  api
    ApplicationResource
    dto
      CreateApplicationRequest
      ApplicationResponse
      FieldErrorResponse
    error
      ProblemDetails
      ProblemFactory
      DomainExceptionMapper
    filter
      CorrelationFilter
      SecurityHeadersFilter

  application
    ApplicationService
    ApplicationCommandService
    ApplicationQueryService
    IdempotencyService

  domain
    application
      Application
      ApplicationId
      ApplicationStatus
      ApplicationPolicy
      ApplicationNotSubmittableException
    common
      TenantId
      ActorId
      Money
      DateRange

  infrastructure
    persistence
      JpaApplicationRepository
      ApplicationEntity
    client
      CustomerApiClient
      CustomerGateway
    security
      CurrentActorProvider
      JwtActorMapper
    config
      AppConfig
```

## 4.1 Rule

Package structure should reveal architecture, not technical chaos.

---

# 5. Layering Rules

## 5.1 API layer may know

- JAX-RS;
- DTOs;
- HTTP status;
- headers;
- `UriInfo`;
- validation annotations;
- OpenAPI annotations.

## 5.2 Application layer may know

- use cases;
- transactions;
- repositories;
- policies;
- idempotency;
- outbound gateways.

## 5.3 Domain layer may know

- business rules;
- value objects;
- state machine;
- domain exceptions.

## 5.4 Infrastructure layer may know

- JPA/SQL;
- external HTTP clients;
- config;
- runtime integration.

## 5.5 Rule

Keep HTTP and persistence details out of domain.

---

# 6. Maven/Gradle Dependencies

Typical dependencies depend on runtime.

Categories:

```text
jakarta.ws.rs-api
jakarta.enterprise.cdi-api
jakarta.validation-api
jakarta.json.bind-api / JSON provider
jakarta.persistence-api
jakarta.transaction-api
microprofile-config-api
microprofile-openapi-api
microprofile-jwt-auth-api
microprofile-rest-client-api
microprofile-fault-tolerance-api
microprofile-health-api
opentelemetry APIs/instrumentation if used
test libraries
```

## 6.1 Runtime provides APIs

In Jakarta EE runtime, many APIs are provided by container.

In standalone/fat-jar runtime, dependencies may be packaged differently.

## 6.2 Rule

Dependency scope must match deployment runtime.

---

# 7. Application Bootstrap

Minimal:

```java
@ApplicationPath("/api")
public class RestApplication extends Application {
}
```

Explicit:

```java
@ApplicationPath("/api")
public class RestApplication extends Application {
    @Override
    public Set<Class<?>> getClasses() {
        return Set.of(
            ApplicationResource.class,
            DomainExceptionMapper.class,
            ValidationExceptionMapper.class,
            CorrelationFilter.class,
            SecurityHeadersFilter.class
        );
    }
}
```

## 7.1 Trade-off

Explicit registration improves determinism.

Scanning improves convenience.

## 7.2 Rule

Production apps should know exactly what resources/providers are registered.

---

# 8. Resource Design

Example resource:

```java
@Path("/applications")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class ApplicationResource {

    @Inject ApplicationService service;
    @Inject CurrentActorProvider actorProvider;

    @POST
    public Response create(CreateApplicationRequest request, @Context UriInfo uriInfo) {
        CurrentActor actor = actorProvider.current();
        ApplicationResponse created = service.create(actor, request);

        URI location = uriInfo.getAbsolutePathBuilder()
            .path(created.id())
            .build();

        return Response.created(location).entity(created).build();
    }

    @GET
    @Path("/{id}")
    public ApplicationResponse get(@PathParam("id") ApplicationId id) {
        return service.get(actorProvider.current(), id);
    }
}
```

## 8.1 Resource responsibilities

Resource should:

- receive HTTP input;
- call application service;
- build HTTP response;
- not contain business logic.

## 8.2 Rule

A resource method should be thin but not anemic in HTTP semantics.

---

# 9. DTO Boundary

DTOs are API contract.

Do not return:

- JPA entity;
- domain aggregate directly;
- downstream DTO directly.

## 9.1 Why

DTO protects:

- compatibility;
- field-level authorization;
- validation;
- documentation;
- serialization performance;
- security redaction.

## 9.2 Rule

Every external representation is intentionally designed.

---

# 10. Request DTOs

Example:

```java
public record CreateApplicationRequest(
    @NotBlank String licenseType,
    @NotNull ApplicantRequest applicant,
    List<DocumentReferenceRequest> documents
) {}
```

## 10.1 Request DTO rule

Only include fields caller can control.

Do not include:

```text
tenantId
status
approvedBy
createdAt
internalScore
```

unless caller truly controls them.

## 10.2 Rule

Request DTO prevents mass assignment.

---

# 11. Response DTOs

Example:

```java
public record ApplicationResponse(
    String id,
    String status,
    ApplicantResponse applicant,
    Instant createdAt,
    Instant updatedAt,
    List<LinkResponse> links
) {}
```

## 11.1 Role-aware response

```java
public ApplicationResponse toResponse(Application app, CurrentActor actor) {
    return new ApplicationResponse(
        app.id().value(),
        app.status().name(),
        applicantMapper.toResponse(app.applicant()),
        app.createdAt(),
        app.updatedAt(),
        linksFor(app, actor)
    );
}
```

## 11.2 Rule

Response DTO is where API compatibility and authorization meet.

---

# 12. Mapper Strategy

Mapper converts between:

```text
request DTO → command/value object
domain → response DTO
entity → domain
domain → entity
downstream DTO → domain snapshot
```

## 12.1 Avoid god mapper

Use focused mappers:

```text
ApplicationApiMapper
ApplicationPersistenceMapper
CustomerClientMapper
```

## 12.2 Rule

Mapping is boundary translation, not business logic dumping ground.

---

# 13. Validation Boundary

Use Jakarta Validation for shape constraints:

```java
public record SubmitApplicationRequest(
    @AssertTrue Boolean declarationAccepted
) {}
```

## 13.1 Validation types

- required fields;
- format;
- length;
- numeric range;
- enum;
- nested object validity.

## 13.2 Domain invariants

Keep in domain/service:

```text
cannot submit without required documents
cannot approve own application
cannot withdraw approved application
```

## 13.3 Rule

Validation checks input shape; domain checks business truth.

---

# 14. Domain Model

Example aggregate:

```java
public class Application {
    private ApplicationId id;
    private TenantId tenantId;
    private ActorId applicantId;
    private ApplicationStatus status;
    private long version;

    public void submit(ActorId actor, boolean declarationAccepted) {
        if (!applicantId.equals(actor)) {
            throw new AccessDeniedDomainException();
        }
        if (status != ApplicationStatus.DRAFT) {
            throw new ApplicationNotSubmittableException();
        }
        if (!declarationAccepted) {
            throw new DeclarationRequiredException();
        }
        this.status = ApplicationStatus.SUBMITTED;
    }
}
```

## 14.1 Rule

Domain aggregate owns state transition invariants.

---

# 15. Application Service

Application service orchestrates use case:

```java
@ApplicationScoped
public class ApplicationService {

    @Inject ApplicationRepository repository;
    @Inject ApplicationPolicy policy;
    @Inject ApplicationApiMapper mapper;

    @Transactional
    public ApplicationResponse submit(CurrentActor actor, ApplicationId id, SubmitApplicationRequest request) {
        Application app = repository.findByTenantAndId(actor.tenantId(), id)
            .orElseThrow(ResourceNotFoundException::new);

        policy.requireCanSubmit(actor, app);
        app.submit(actor.actorId(), request.declarationAccepted());

        repository.save(app);

        return mapper.toResponse(app, actor);
    }
}
```

## 15.1 Rule

Application service is transaction/use-case boundary.

---

# 16. Repository Boundary

Repository interface in domain/application:

```java
public interface ApplicationRepository {
    Optional<Application> findByTenantAndId(TenantId tenantId, ApplicationId id);
    void save(Application application);
}
```

Infrastructure implementation:

```java
@ApplicationScoped
public class JpaApplicationRepository implements ApplicationRepository {
    @PersistenceContext EntityManager em;

    public Optional<Application> findByTenantAndId(TenantId tenantId, ApplicationId id) {
        ...
    }
}
```

## 16.1 Rule

Repository methods for tenant-owned data must be tenant-aware by design.

---

# 17. Transactions

Transactions should wrap consistent state changes.

## 17.1 Use case boundary

```java
@Transactional
public ApplicationResponse submit(...) { ... }
```

## 17.2 Include

- aggregate update;
- audit insert;
- outbox insert;
- idempotency record update.

## 17.3 Avoid

- long external HTTP call inside DB transaction;
- streaming inside transaction;
- user think time inside transaction.

## 17.4 Rule

Transaction should protect consistency but stay short.

---

# 18. Persistence Mapping

Avoid exposing entity:

```java
@Entity
@Table(name = "applications")
class ApplicationEntity { ... }
```

Mapper:

```java
Application toDomain(ApplicationEntity entity) { ... }
ApplicationEntity toEntity(Application domain) { ... }
```

## 18.1 Rule

JPA entity is persistence model, not API or domain contract.

---

# 19. Optimistic Locking and ETag

Use version:

```java
@Version
long version;
```

GET response:

```http
ETag: "7"
```

Update request:

```http
If-Match: "7"
```

Stale:

```http
412 Precondition Failed
```

## 19.1 Rule

Mutable resources need lost update strategy.

---

# 20. Idempotency

For non-idempotent POST:

```http
Idempotency-Key: 01J...
```

Store:

- key;
- actor/tenant/client;
- request hash;
- result;
- status;
- expiry.

## 20.1 Use cases

- submit;
- payment;
- create operation;
- bulk action;
- external side effect.

## 20.2 Rule

If retry can duplicate side effect, design idempotency before production.

---

# 21. Error Contract

Use Problem Details.

```json
{
  "type": "https://api.example.com/problems/application-not-submittable",
  "title": "Application cannot be submitted",
  "status": 409,
  "code": "APPLICATION_NOT_SUBMITTABLE",
  "correlationId": "..."
}
```

## 21.1 Error categories

- validation;
- domain;
- security;
- not found;
- conflict;
- concurrency;
- downstream;
- internal.

## 21.2 Rule

Error contract is part of API contract.

---

# 22. Problem Details Factory

Centralize creation:

```java
@ApplicationScoped
public class ProblemFactory {

    public ProblemDetails domain(ErrorCode code, int status, String detail) {
        return new ProblemDetails(
            code.type(),
            code.title(),
            status,
            code.name(),
            detail,
            Correlation.current(),
            Trace.current(),
            Instant.now()
        );
    }
}
```

## 22.1 Rule

Do not create error JSON manually in many places.

---

# 23. Exception Mappers

Mappers:

```text
ValidationExceptionMapper
DomainExceptionMapper
AuthenticationExceptionMapper
AccessDeniedExceptionMapper
OptimisticLockExceptionMapper
DownstreamExceptionMapper
ThrowableMapper
```

## 23.1 Catch-all

```java
@Provider
public class UnhandledExceptionMapper implements ExceptionMapper<Throwable> {
    @Override
    public Response toResponse(Throwable exception) {
        log.error("Unhandled exception", exception);
        return Response.status(500)
            .type("application/problem+json")
            .entity(problemFactory.internalError())
            .build();
    }
}
```

## 23.2 Rule

Every exception path should produce consistent safe Problem Details.

---

# 24. Security Architecture

Security layers:

```text
TLS/gateway
  ↓
token validation
  ↓
CurrentActor
  ↓
route-level role/scope
  ↓
object/tenant policy
  ↓
DTO redaction
  ↓
audit
```

## 24.1 Rule

Authentication filter proves caller; policy decides operation/resource access.

---

# 25. CurrentActor and TenantContext

```java
public record CurrentActor(
    ActorId actorId,
    TenantId tenantId,
    Set<Permission> permissions,
    String clientId
) {}
```

## 25.1 Resource/service

Pass actor explicitly.

## 25.2 Rule

Actor is part of every sensitive use case.

---

# 26. Authorization Policies

Policy object:

```java
@ApplicationScoped
public class ApplicationPolicy {
    public void requireCanView(CurrentActor actor, Application app) {
        if (!actor.tenantId().equals(app.tenantId())) {
            throw new AccessDeniedException();
        }
        if (!actor.permissions().contains(Permission.APPLICATION_VIEW)) {
            throw new AccessDeniedException();
        }
    }
}
```

## 26.1 Rule

Authorization should be explicit, centralized, and tested.

---

# 27. Pagination, Filtering, Sorting

Define request model:

```java
public record ApplicationSearchRequest(
    String status,
    String cursor,
    @Min(1) @Max(100) Integer limit,
    String sort
) {}
```

## 27.1 Rules

- stable sort;
- allowlisted filters;
- max limit;
- tenant predicate;
- cursor signed/tamper-resistant;
- deterministic response.

## 27.2 Rule

List/search endpoints need product and database-aware contract.

---

# 28. Outbound Client Integration

Use gateway/adapter:

```java
@ApplicationScoped
public class CustomerGateway {
    @Inject CustomerApiClient client;

    public CustomerSnapshot getCustomer(CustomerId id) {
        try {
            return mapper.toSnapshot(client.get(id.value()));
        } catch (DownstreamException e) {
            throw customerErrorMapper.map(e);
        }
    }
}
```

## 28.1 Rule

Application service should depend on domain-level gateway, not raw HTTP client.

---

# 29. Resilience Policy

Per downstream operation:

- timeout;
- retry;
- circuit breaker;
- bulkhead;
- rate limit;
- fallback if safe.

## 29.1 Retry rule

Retry only idempotent or idempotency-protected operations.

## 29.2 Rule

Resilience policy must match domain semantics.

---

# 30. Observability

Minimum:

- correlation ID;
- structured access logs;
- HTTP server metrics;
- error metrics;
- downstream metrics;
- DB metrics;
- traces;
- audit for sensitive actions.

## 30.1 Rule

Production API without observability is unfinished.

---

# 31. Structured Logging

Access log fields:

```text
timestamp
correlationId
traceId
method
route
status
durationMs
actorId
tenantId
errorCode
```

## 31.1 Avoid

- tokens;
- passwords;
- full request body;
- PII unless approved.

## 31.2 Rule

Logs should support debugging without causing data leakage.

---

# 32. Metrics

Metrics:

```text
http.server.request.duration
api.errors.total{code,status,operation}
application.submitted.total{result}
downstream.request.duration{service,operation,status}
db.query.duration
```

## 32.1 Cardinality

Do not label metrics with:

- user ID;
- raw path;
- correlation ID;
- object ID.

## 32.2 Rule

Metrics aggregate behavior; logs/traces investigate detail.

---

# 33. Tracing

Trace shape:

```text
HTTP POST /applications/{id}/submission
  service submitApplication
    repository findByTenantAndId
    domain transition
    outbox insert
```

Outbound:

```text
customer-api GET /customers/{id}
```

## 33.1 Rule

Trace should show where latency/failure occurs.

---

# 34. OpenAPI Contract

OpenAPI must document:

- endpoints;
- request/response schemas;
- Problem Details;
- auth schemes;
- status codes;
- pagination;
- idempotency headers;
- ETag/If-Match;
- examples;
- deprecation.

## 34.1 Rule

OpenAPI is design/contract artifact, not generated afterthought.

---

# 35. Health Checks

Endpoints:

```text
/health/live
/health/ready
/health/started
```

or runtime-specific MicroProfile paths.

## 35.1 Liveness

Do not deeply check DB.

## 35.2 Readiness

Check critical dependencies needed to serve traffic.

## 35.3 Rule

Health checks should align with platform routing decisions.

---

# 36. Configuration

Config categories:

- server limits;
- pagination limits;
- downstream URLs;
- timeouts;
- resilience;
- feature flags;
- security issuers/audience;
- telemetry exporter;
- DB pool.

## 36.1 Rule

All environment-specific behavior is config-driven and validated at startup.

---

# 37. Testing Pyramid

Recommended:

```text
unit tests
  domain policies
  mappers
  validators

integration tests
  resources
  exception mappers
  persistence
  outbound clients

contract tests
  OpenAPI
  Problem Details
  consumer contracts

system tests
  security
  performance smoke
  deployment smoke
```

## 37.1 Rule

Most tests should not require full production stack, but critical HTTP behavior must be integration-tested.

---

# 38. Resource/API Tests

Test:

- status codes;
- headers;
- content type;
- Location;
- ETag;
- validation errors;
- Problem Details;
- pagination;
- idempotency;
- auth errors;
- content negotiation.

## 38.1 Rule

Test API contract, not resource method implementation.

---

# 39. Security Tests

Test:

- missing token;
- invalid token;
- wrong role;
- wrong tenant;
- object belongs to other tenant;
- field-level redaction;
- mass assignment;
- CORS/CSRF if browser-facing.

## 39.1 Rule

Security tests should include negative and cross-tenant cases.

---

# 40. Persistence Tests

Use real database when possible.

Test:

- tenant predicates;
- unique constraints;
- optimistic locking;
- transaction rollback;
- outbox insert;
- migration scripts;
- query performance on realistic indexes.

## 40.1 Rule

Persistence behavior cannot be fully trusted with only mocks.

---

# 41. Client Integration Tests

Use mock server.

Test:

- request path/query/body;
- headers;
- timeout;
- retry;
- Problem Details decode;
- malformed response;
- 429/503;
- connection reset.

## 41.1 Rule

Outbound HTTP code should be tested as HTTP code.

---

# 42. Contract Tests

Validate:

- generated OpenAPI;
- schemas;
- examples;
- backward compatibility;
- Problem Details shape;
- client expectations.

## 42.1 Rule

Contract tests catch accidental API drift.

---

# 43. Performance Smoke Tests

Smoke test:

- app startup;
- simple GET;
- list endpoint;
- create/submit;
- p95 under basic load;
- memory does not explode;
- DB query count predictable.

## 43.1 Rule

Performance smoke is not full load test, but catches obvious regressions.

---

# 44. CI/CD Quality Gates

Quality gates:

- compile;
- unit tests;
- integration tests;
- security tests;
- dependency scan;
- container scan;
- OpenAPI diff;
- static analysis;
- migration validation;
- smoke test.

## 44.1 Rule

Production-grade API needs automated gates.

---

# 45. Deployment Readiness

Check:

- config present;
- secrets injected;
- DB migration applied;
- health endpoints;
- observability exporter;
- resource limits;
- readiness/liveness;
- gateway routes;
- TLS/auth config;
- rollback plan.

## 45.1 Rule

Deployment is part of API design.

---

# 46. Runtime Operations

Runbooks:

- high 5xx;
- high latency;
- DB pool exhausted;
- downstream timeout;
- auth failure spike;
- idempotency conflict;
- stuck operation;
- outbox lag;
- upload failures.

## 46.1 Rule

If the team cannot operate the API, it is not production-grade.

---

# 47. Step-by-Step Build Plan

## Step 1 — Define domain capability

List resources, lifecycle, transitions, errors.

## Step 2 — Draft OpenAPI

Design before coding.

## Step 3 — Build domain model

Aggregate, value objects, policies.

## Step 4 — Build DTOs and mappers

Keep boundary explicit.

## Step 5 — Build resources

Thin HTTP layer.

## Step 6 — Add validation and error contract

Problem Details.

## Step 7 — Add security and tenant policy

CurrentActor, policies, repository safeguards.

## Step 8 — Add persistence

Transactions, optimistic locking, migrations.

## Step 9 — Add outbound clients

Gateways, timeouts, mapping.

## Step 10 — Add observability

Logs, metrics, traces.

## Step 11 — Add tests

Unit, integration, contract, security.

## Step 12 — Add deployment/operation assets

Health, config, dashboards, runbooks.

## 47.1 Rule

Build vertical slice first, then expand.

---

# 48. Common Failure Modes

## 48.1 Resource contains business logic

Hard to test/evolve.

## 48.2 Entity returned as JSON

Data leak/coupling.

## 48.3 No Problem Details

Inconsistent errors.

## 48.4 No object authorization

BOLA.

## 48.5 No idempotency

Duplicate side effects.

## 48.6 No ETag

Lost updates.

## 48.7 Outbound client no timeout

Thread exhaustion.

## 48.8 No OpenAPI examples

Consumer confusion.

## 48.9 Tests only happy path

Production failures missed.

## 48.10 Observability added after incident

Too late.

---

# 49. Best Practices

## 49.1 Design contract first

OpenAPI + examples.

## 49.2 Keep resources thin

HTTP orchestration only.

## 49.3 Use DTOs

Never expose entities.

## 49.4 Separate validation/invariants

Boundary vs domain.

## 49.5 Centralize errors

Problem factory + mappers.

## 49.6 Enforce authorization in service/domain

Not only annotations.

## 49.7 Use tenant-aware repositories

Impossible to forget tenant.

## 49.8 Configure clients safely

Timeouts/resilience.

## 49.9 Observe from day one

Logs/metrics/traces.

## 49.10 Test the contract

API behavior, not implementation details.

---

# 50. Anti-Patterns

## 50.1 CRUD database over HTTP

Weak domain model.

## 50.2 One giant service class

Unclear boundaries.

## 50.3 Generic `Map<String,Object>` request

No contract.

## 50.4 Catch exception and return 200

Breaks HTTP.

## 50.5 Security only in UI

Server must enforce.

## 50.6 Config hardcoded

Deployment pain.

## 50.7 Retry everything

Side effects.

## 50.8 No migration strategy

Data/runtime drift.

## 50.9 No runbook

Incident chaos.

## 50.10 No backward compatibility thinking

Consumer breakage.

---

# 51. Production Checklist

## 51.1 API contract

- [ ] Resources modeled from domain.
- [ ] OpenAPI drafted/reviewed.
- [ ] DTOs explicit.
- [ ] Problem Details schema.
- [ ] Error catalog.
- [ ] Pagination/filtering/sorting contract.
- [ ] Idempotency and ETag documented.

## 51.2 Security

- [ ] Token validation.
- [ ] CurrentActor.
- [ ] Route-level permission.
- [ ] Object-level policy.
- [ ] Tenant-aware repository.
- [ ] DTO redaction.
- [ ] Security tests.

## 51.3 Data/transactions

- [ ] Transaction boundary.
- [ ] Optimistic locking.
- [ ] Migrations.
- [ ] Constraints.
- [ ] Outbox/audit if needed.
- [ ] Persistence integration tests.

## 51.4 Integration/resilience

- [ ] Typed outbound gateways.
- [ ] Timeouts.
- [ ] Retry safe.
- [ ] Circuit/bulkhead.
- [ ] Problem decoder.
- [ ] Mock server tests.

## 51.5 Operations

- [ ] Structured logs.
- [ ] Metrics.
- [ ] Tracing.
- [ ] Health checks.
- [ ] Dashboards.
- [ ] Alerts.
- [ ] Runbooks.
- [ ] Deployment checklist.

---

# 52. Latihan

## Latihan 1 — Vertical Slice

Implement complete vertical slice:

```text
POST /applications
GET /applications/{id}
POST /applications/{id}/submission
```

Include DTO, service, domain, repository, Problem Details, tests.

## Latihan 2 — Error Contract

Create error catalog for application domain.

Map to Problem Details.

## Latihan 3 — Authorization

Create tenant A/B data.

Test cross-tenant GET/PATCH/SUBMIT.

## Latihan 4 — ETag

Add version and ETag.

Test stale `If-Match`.

## Latihan 5 — Idempotency

Add idempotency to submission.

Test duplicate retry.

## Latihan 6 — Outbound Client

Add customer snapshot client with mock server.

Test timeout and Problem Details.

## Latihan 7 — OpenAPI

Document all responses including errors.

Run OpenAPI diff.

## Latihan 8 — Observability Smoke

Verify correlation ID, route metrics, error code metrics, and trace for submit endpoint.

---

# 53. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services  
   https://jakarta.ee/specifications/restful-ws/

2. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

3. Jakarta RESTful Web Services 4.0 API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/

4. OpenAPI Specification v3.1.0  
   https://spec.openapis.org/oas/v3.1.0.html

5. OWASP REST Security Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html

6. RFC 9457 — Problem Details for HTTP APIs  
   https://www.rfc-editor.org/rfc/rfc9457.html

7. RFC 9110 — HTTP Semantics  
   https://www.rfc-editor.org/rfc/rfc9110.html

---

# 54. Penutup

Membangun JAX-RS API production-grade dari nol berarti mendesain semua boundary secara sadar.

Mental model final:

```text
domain capability
  ↓
HTTP contract
  ↓
DTO boundary
  ↓
validation + domain invariant
  ↓
application service + transaction
  ↓
security policy + tenant authorization
  ↓
persistence + outbound integration
  ↓
error contract + observability
  ↓
tests + deployment + operations
```

Prinsip final:

```text
Design contract first.
Keep domain independent.
Use DTOs deliberately.
Map errors consistently.
Authorize objects, not just routes.
Make writes safe with ETag/idempotency.
Test negative paths.
Observe from day one.
Operational readiness is part of API design.
```

Top-tier JAX-RS engineer memastikan:

- API tidak sekadar CRUD;
- resource method tipis dan HTTP-aware;
- service/domain memegang business truth;
- persistence tidak bocor ke API;
- error/security/observability/testability menjadi bagian awal desain;
- deployment dan operasi siap sebelum production.

Part berikutnya:

```text
Bagian 053 — Refactoring Legacy JAX-RS API
```

Kita akan membahas cara refactor API JAX-RS legacy: strangler pattern, endpoint inventory, compatibility preservation, error contract migration, javax→jakarta, DTO extraction, security hardening, test harness, OpenAPI recovery, and incremental rollout.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-051.md](./learn-jaxrs-advanced-part-051.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-053.md](./learn-jaxrs-advanced-part-053.md)
