# learn-jaxrs-advanced-part-049.md

# Bagian 049 — JAX-RS with MicroProfile: Config, Rest Client, Fault Tolerance, Telemetry/Metrics, OpenAPI, JWT, Health, and Production Runtime Patterns

> Target pembaca: Java/Jakarta engineer yang ingin memakai **Jakarta REST/JAX-RS bersama MicroProfile** untuk membangun microservice production-grade. Fokus bagian ini bukan sekadar mengenal annotation, tetapi bagaimana MicroProfile melengkapi JAX-RS: configuration, typed REST client, fault tolerance, telemetry/metrics, OpenAPI, JWT security, health checks, runtime portability, testing, dan operational patterns.
>
> Prinsip utama:
>
> ```text
> Jakarta REST gives you the HTTP resource model.
> MicroProfile gives you the microservice production toolkit around it.
> ```

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Jakarta REST vs MicroProfile](#2-mental-model-jakarta-rest-vs-microprofile)
3. [MicroProfile sebagai Production Toolkit](#3-microprofile-sebagai-production-toolkit)
4. [MicroProfile Version Awareness](#4-microprofile-version-awareness)
5. [Runtime Compatibility](#5-runtime-compatibility)
6. [Project Structure](#6-project-structure)
7. [MicroProfile Config](#7-microprofile-config)
8. [Configuration Source and Precedence](#8-configuration-source-and-precedence)
9. [`@ConfigProperty`](#9-configproperty)
10. [Config for JAX-RS Resources](#10-config-for-jax-rs-resources)
11. [Config for Clients and Resilience](#11-config-for-clients-and-resilience)
12. [Config Anti-Patterns](#12-config-anti-patterns)
13. [MicroProfile Rest Client](#13-microprofile-rest-client)
14. [Typed Client Interface](#14-typed-client-interface)
15. [`@RegisterRestClient`](#15-registerrestclient)
16. [Rest Client Configuration](#16-rest-client-configuration)
17. [Header Propagation](#17-header-propagation)
18. [ResponseExceptionMapper](#18-responseexceptionmapper)
19. [Rest Client Providers](#19-rest-client-providers)
20. [JAX-RS Client API vs MP Rest Client](#20-jax-rs-client-api-vs-mp-rest-client)
21. [MicroProfile Fault Tolerance](#21-microprofile-fault-tolerance)
22. [`@Timeout`](#22-timeout)
23. [`@Retry`](#23-retry)
24. [`@CircuitBreaker`](#24-circuitbreaker)
25. [`@Bulkhead`](#25-bulkhead)
26. [`@Fallback`](#26-fallback)
27. [`@Asynchronous`](#27-asynchronous)
28. [Fault Tolerance Policy Ordering](#28-fault-tolerance-policy-ordering)
29. [Fault Tolerance with HTTP Semantics](#29-fault-tolerance-with-http-semantics)
30. [MicroProfile Telemetry and Metrics](#30-microprofile-telemetry-and-metrics)
31. [OpenTelemetry Integration](#31-opentelemetry-integration)
32. [Custom Metrics vs Standard HTTP Metrics](#32-custom-metrics-vs-standard-http-metrics)
33. [MicroProfile OpenAPI](#33-microprofile-openapi)
34. [OpenAPI Annotations](#34-openapi-annotations)
35. [Documenting Security, Errors, and Versioning](#35-documenting-security-errors-and-versioning)
36. [MicroProfile JWT](#36-microprofile-jwt)
37. [`JsonWebToken`, Roles, and Claims](#37-jsonwebtoken-roles-and-claims)
38. [JWT + JAX-RS SecurityContext](#38-jwt--jax-rs-securitycontext)
39. [JWT Security Caveats](#39-jwt-security-caveats)
40. [MicroProfile Health](#40-microprofile-health)
41. [Liveness vs Readiness vs Startup](#41-liveness-vs-readiness-vs-startup)
42. [Health Check Design](#42-health-check-design)
43. [Putting It Together: Example Service](#43-putting-it-together-example-service)
44. [Production Runtime Patterns](#44-production-runtime-patterns)
45. [Testing MicroProfile + JAX-RS](#45-testing-microprofile--jax-rs)
46. [Configuration Testing](#46-configuration-testing)
47. [Fault Tolerance Testing](#47-fault-tolerance-testing)
48. [OpenAPI Contract Testing](#48-openapi-contract-testing)
49. [Security Testing](#49-security-testing)
50. [Observability Testing](#50-observability-testing)
51. [Runtime Differences](#51-runtime-differences)
52. [Common Failure Modes](#52-common-failure-modes)
53. [Best Practices](#53-best-practices)
54. [Anti-Patterns](#54-anti-patterns)
55. [Production Checklist](#55-production-checklist)
56. [Latihan](#56-latihan)
57. [Referensi Resmi](#57-referensi-resmi)
58. [Penutup](#58-penutup)

---

# 1. Tujuan Part Ini

Jakarta REST/JAX-RS memberi kita API HTTP:

```java
@Path("/applications")
public class ApplicationResource {
    @GET
    public List<ApplicationResponse> list() { ... }
}
```

Tetapi service production perlu lebih dari resource method:

```text
configuration
typed outbound clients
timeouts/retries/circuit breakers
health checks
OpenAPI docs
JWT authentication
telemetry/metrics/traces
runtime portability
```

MicroProfile mengisi ruang ini.

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- memahami relasi Jakarta REST dan MicroProfile;
- memakai MicroProfile Config untuk konfigurasi service;
- membuat typed REST client;
- memasang fault tolerance secara aman;
- expose OpenAPI yang berguna;
- memakai JWT integration;
- membuat health checks yang benar;
- menghubungkan telemetry/metrics;
- menguji semua ini di runtime target.

---

# 2. Mental Model: Jakarta REST vs MicroProfile

## 2.1 Jakarta REST

Fokus:

```text
HTTP resources
request matching
entity providers
filters/interceptors
exception mappers
client API
SSE
```

## 2.2 MicroProfile

Fokus:

```text
cloud-native microservice concerns
configuration
typed REST clients
fault tolerance
JWT auth
OpenAPI
telemetry
health
```

## 2.3 Rule

Jakarta REST models your API surface. MicroProfile adds operational and integration standards around it.

---

# 3. MicroProfile sebagai Production Toolkit

MicroProfile bukan replacement Jakarta EE.

Ia memanfaatkan Jakarta EE/Jakarta APIs untuk kebutuhan microservice.

Typical service stack:

```text
Jakarta REST
CDI
MicroProfile Config
MicroProfile Rest Client
MicroProfile Fault Tolerance
MicroProfile OpenAPI
MicroProfile JWT
MicroProfile Telemetry
MicroProfile Health
```

## 3.1 Why it matters

Tanpa standard toolkit, setiap runtime/framework punya cara sendiri untuk:

- config;
- health;
- docs;
- tracing;
- outbound client;
- resilience.

## 3.2 Rule

Use MicroProfile to reduce vendor-specific production plumbing.

---

# 4. MicroProfile Version Awareness

MicroProfile versions bundle component specs.

Modern MicroProfile releases align with Jakarta namespace.

## 4.1 Why version matters

A codebase using `jakarta.*` needs MicroProfile version aligned with Jakarta EE generation.

## 4.2 Common issue

Mixing old MicroProfile library compiled against `javax.*` with Jakarta EE runtime causes class mismatch.

## 4.3 Rule

Always check MicroProfile platform version and component spec versions before coding.

---

# 5. Runtime Compatibility

MicroProfile runs on compatible runtimes, for example:

- Open Liberty;
- WildFly;
- Payara;
- Helidon;
- Quarkus;
- TomEE and others depending version.

## 5.1 Compatibility does not mean identical behavior

Spec defines portable contract.

Runtime still differs in:

- config source integration;
- dev mode;
- telemetry backend;
- OpenAPI endpoint path;
- JWT configuration;
- fault tolerance implementation;
- native-image behavior.

## 5.2 Rule

Write against spec, test on runtime.

---

# 6. Project Structure

A clean service structure:

```text
src/main/java
  api/
    ApplicationResource.java
    ProblemMapper.java
  application/
    ApplicationService.java
  domain/
    Application.java
    ApplicationPolicy.java
  infrastructure/
    client/
      CustomerClient.java
      CustomerGateway.java
    config/
      ApplicationConfig.java
    telemetry/
    security/
```

## 6.1 Boundary rule

- JAX-RS resource is API boundary.
- MicroProfile Rest Client interface is outbound boundary.
- Domain does not depend on MicroProfile annotations unless intentionally accepted.

## 6.2 Rule

Keep production annotations at boundary/infrastructure layer.

---

# 7. MicroProfile Config

MicroProfile Config provides unified configuration mechanism.

Examples:

```properties
application.max-page-size=100
customer-api/mp-rest/url=https://customer-api.internal
customer-api/mp-rest/connectTimeout=1000
customer-api/mp-rest/readTimeout=2000
```

## 7.1 Why important

Production config differs by environment:

```text
local
test
dev
staging
production
```

Hardcoding values breaks deployment flexibility.

## 7.2 Rule

Everything environment-dependent should be config-driven.

---

# 8. Configuration Source and Precedence

MicroProfile Config aggregates config from multiple sources.

Common sources:

- system properties;
- environment variables;
- property files;
- runtime-specific sources;
- custom `ConfigSource`.

## 8.1 Precedence

Config sources have ordinal/priority rules.

Higher-priority sources override lower-priority sources.

## 8.2 Use case

Default in `microprofile-config.properties`, override via environment in Kubernetes.

## 8.3 Rule

Document config keys, defaults, and override source.

---

# 9. `@ConfigProperty`

Inject config:

```java
@Inject
@ConfigProperty(name = "application.max-page-size", defaultValue = "100")
int maxPageSize;
```

Optional:

```java
@Inject
@ConfigProperty(name = "feature.new-search.enabled")
Optional<Boolean> newSearchEnabled;
```

Provider:

```java
@Inject
@ConfigProperty(name = "rate.limit")
Provider<Integer> rateLimit;
```

## 9.1 Rule

Use strongly typed config and validate at startup.

---

# 10. Config for JAX-RS Resources

Resource should not be full of raw config.

Better:

```java
@ApplicationScoped
public class PagingPolicy {
    private final int maxPageSize;

    @Inject
    public PagingPolicy(@ConfigProperty(name = "application.max-page-size") int maxPageSize) {
        this.maxPageSize = maxPageSize;
    }

    public int clamp(int requested) { ... }
}
```

## 10.1 Resource usage

```java
int limit = pagingPolicy.clamp(request.limit());
```

## 10.2 Rule

Wrap config in domain/application policy objects.

---

# 11. Config for Clients and Resilience

Config examples:

```properties
customer-api/mp-rest/url=https://customer-api.internal
customer-api/mp-rest/connectTimeout=500
customer-api/mp-rest/readTimeout=1500

payment.timeout.ms=1000
payment.retry.max=2
payment.circuit.failure-ratio=0.5
```

## 11.1 Rule

Every downstream should have explicit config for URL, timeout, and resilience policy.

---

# 12. Config Anti-Patterns

## 12.1 Magic defaults

No one knows production behavior.

## 12.2 Config read everywhere

Hard to trace.

## 12.3 Secrets in config file

Risk.

## 12.4 No startup validation

Invalid config fails under load.

## 12.5 Rule

Configuration is API of deployment. Treat it as contract.

---

# 13. MicroProfile Rest Client

MicroProfile Rest Client provides type-safe REST clients.

Instead of:

```java
target.path("customers/{id}").resolveTemplate("id", id)
```

you write:

```java
customerClient.get(id);
```

## 13.1 Benefits

- typed interface;
- CDI injection;
- config key;
- provider integration;
- exception mapping;
- fault tolerance annotations;
- cleaner tests.

## 13.2 Rule

Use MP Rest Client for stable downstream APIs.

---

# 14. Typed Client Interface

```java
@Path("/customers")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@RegisterRestClient(configKey = "customer-api")
public interface CustomerApiClient {

    @GET
    @Path("/{id}")
    CustomerResponse get(@PathParam("id") String id);

    @POST
    CustomerResponse create(CreateCustomerRequest request);
}
```

## 14.1 Interface as contract

This interface represents downstream contract.

Keep it in infrastructure client package.

## 14.2 Rule

Do not expose downstream client interface directly to domain layer.

---

# 15. `@RegisterRestClient`

Registers interface as injectable Rest Client.

```java
@Inject
@RestClient
CustomerApiClient customerApiClient;
```

## 15.1 Config key

```java
@RegisterRestClient(configKey = "customer-api")
```

Config:

```properties
customer-api/mp-rest/url=https://customer-api.internal
```

## 15.2 Rule

Use configKey to avoid coupling config to fully qualified class name.

---

# 16. Rest Client Configuration

Common config:

```properties
customer-api/mp-rest/url=https://customer-api.internal
customer-api/mp-rest/connectTimeout=500
customer-api/mp-rest/readTimeout=1500
customer-api/mp-rest/providers=com.example.client.CorrelationHeaderFactory
```

Exact keys depend spec/runtime.

## 16.1 Per-client policy

Each downstream should have independent timeout and provider config.

## 16.2 Rule

Do not share one timeout policy for all downstreams blindly.

---

# 17. Header Propagation

Use `ClientHeadersFactory` for generating/propagating headers.

## 17.1 Example

```java
@RegisterClientHeaders(CorrelationHeadersFactory.class)
public interface CustomerApiClient { ... }

@ApplicationScoped
public class CorrelationHeadersFactory implements ClientHeadersFactory {
    @Override
    public MultivaluedMap<String, String> update(
        MultivaluedMap<String, String> incomingHeaders,
        MultivaluedMap<String, String> clientOutgoingHeaders
    ) {
        MultivaluedHashMap<String, String> result = new MultivaluedHashMap<>();
        result.putSingle("X-Correlation-ID", Correlation.current());
        return result;
    }
}
```

## 17.2 Security

Do not propagate all incoming headers.

## 17.3 Rule

Header propagation must be allowlist-based.

---

# 18. ResponseExceptionMapper

Maps HTTP response to exception.

## 18.1 Example

```java
@Provider
public class ProblemResponseExceptionMapper
    implements ResponseExceptionMapper<DownstreamException> {

    @Override
    public DownstreamException toThrowable(Response response) {
        ProblemDetails problem = tryReadProblem(response);
        return DownstreamException.from(response.getStatus(), problem);
    }

    @Override
    public boolean handles(int status, MultivaluedMap<String, Object> headers) {
        return status >= 400;
    }
}
```

## 18.2 Rule

Rest Client exception mapping should preserve downstream semantics safely.

---

# 19. Rest Client Providers

Providers can include:

- request filters;
- response filters;
- exception mappers;
- JSON providers;
- header factories.

## 19.1 Register

- annotation;
- config;
- CDI;
- runtime-specific mechanism.

## 19.2 Rule

Keep provider registration explicit for critical clients.

---

# 20. JAX-RS Client API vs MP Rest Client

| Need | Better Fit |
|---|---|
| stable typed downstream | MP Rest Client |
| dynamic URLs | JAX-RS Client |
| streaming low-level Response | JAX-RS Client |
| simple declarative CDI client | MP Rest Client |
| fault tolerance annotations | MP Rest Client/CDI wrapper |
| custom complex request builder | JAX-RS Client |

## 20.1 Rule

Pick the highest-level client that still gives the control you need.

---

# 21. MicroProfile Fault Tolerance

Fault Tolerance adds annotations/interceptors:

- `@Timeout`;
- `@Retry`;
- `@CircuitBreaker`;
- `@Bulkhead`;
- `@Fallback`;
- `@Asynchronous`.

## 21.1 Example wrapper

```java
@ApplicationScoped
public class CustomerGateway {

    @Inject
    @RestClient
    CustomerApiClient client;

    @Timeout(1000)
    @Retry(maxRetries = 2, delay = 100, jitter = 50)
    @CircuitBreaker(requestVolumeThreshold = 20, failureRatio = 0.5)
    public CustomerResponse getCustomer(String id) {
        return client.get(id);
    }
}
```

## 21.2 Rule

Apply fault tolerance to gateway methods where domain semantics are known, not blindly on every client method.

---

# 22. `@Timeout`

`@Timeout` limits execution duration.

## 22.1 Use

```java
@Timeout(1000)
public CustomerResponse getCustomer(String id) { ... }
```

## 22.2 Caveat

Timeout behavior with blocking IO may not interrupt underlying operation cleanly depending runtime/client.

Still set HTTP client read timeout.

## 22.3 Rule

Use both HTTP client timeout and FT timeout/deadline thoughtfully.

---

# 23. `@Retry`

```java
@Retry(maxRetries = 2, delay = 100, jitter = 50)
```

## 23.1 Only safe when

- method is idempotent;
- or idempotency key exists;
- or operation known not applied.

## 23.2 Avoid

Retrying POST create/payment without idempotency.

## 23.3 Rule

Retry annotation must be justified by HTTP/domain semantics.

---

# 24. `@CircuitBreaker`

```java
@CircuitBreaker(
    requestVolumeThreshold = 20,
    failureRatio = 0.5,
    delay = 5000
)
```

## 24.1 Use

Prevent repeated calls to failing downstream.

## 24.2 Scope

Apply per downstream operation, not too broad.

## 24.3 Rule

Circuit breaker should fail fast before saturating resources.

---

# 25. `@Bulkhead`

Limits concurrent calls.

## 25.1 Example

```java
@Bulkhead(10)
public PaymentResponse charge(...) { ... }
```

## 25.2 Async bulkhead

May include queue depending spec usage.

## 25.3 Rule

Bulkhead prevents one dependency from consuming all service capacity.

---

# 26. `@Fallback`

```java
@Fallback(fallbackMethod = "fallbackCustomer")
```

## 26.1 Safe fallback examples

- cached reference data;
- default feature flag off;
- stale read with marker.

## 26.2 Unsafe

- assume payment approved;
- assume authorization allowed.

## 26.3 Rule

Fallback must preserve domain correctness and security.

---

# 27. `@Asynchronous`

Runs method asynchronously and returns `Future`/`CompletionStage` depending spec version/runtime support.

## 27.1 Use carefully

Async changes execution/resource model.

## 27.2 Context propagation

Actor/tenant/correlation may need explicit propagation.

## 27.3 Rule

Do not use async just to hide slow calls.

---

# 28. Fault Tolerance Policy Ordering

When multiple annotations apply, ordering matters.

Conceptually:

```text
bulkhead/timeout/retry/circuit/fallback
```

Exact semantics are defined by spec.

## 28.1 Why it matters

Timeout inside retry can mean each attempt has timeout.

Retry outside timeout can mean total call exceeds expected budget.

## 28.2 Rule

Read spec/runtime behavior and test actual attempt/timing.

---

# 29. Fault Tolerance with HTTP Semantics

Fault tolerance must respect HTTP semantics.

## 29.1 GET

Usually safe for retry.

## 29.2 POST

Only retry when idempotency key or known safe.

## 29.3 409

Usually no retry unless conflict expected to resolve.

## 29.4 429

Retry after server guidance.

## 29.5 503/504

Retry may help if budget remains.

## 29.6 Rule

Resilience annotations are not aware of your domain unless you design wrapper logic.

---

# 30. MicroProfile Telemetry and Metrics

MicroProfile Telemetry integrates with OpenTelemetry.

Modern MicroProfile replaces older metrics/tracing approaches with OTel-oriented telemetry in many runtimes.

## 30.1 What to observe

- HTTP server spans/metrics;
- Rest Client spans;
- Fault Tolerance metrics;
- custom domain metrics;
- logs correlation.

## 30.2 Rule

Telemetry should reveal both inbound API behavior and outbound dependency behavior.

---

# 31. OpenTelemetry Integration

Typical flow:

```text
JAX-RS request
  → server span
  → resource/service
  → MP Rest Client outbound span
  → downstream server span
```

## 31.1 Propagation

Trace context must be propagated by runtime/client or explicit filters.

## 31.2 Rule

End-to-end trace is more valuable than isolated spans.

---

# 32. Custom Metrics vs Standard HTTP Metrics

## 32.1 Standard metrics

Use runtime/OTel provided HTTP metrics where possible.

## 32.2 Custom metrics

Add for domain:

```text
application.submitted.total
case.assigned.total
document.upload.rejected.total
```

## 32.3 Avoid duplication

Do not create duplicate HTTP duration metrics if runtime already emits them unless needed.

## 32.4 Rule

Use standard metrics for infrastructure; custom metrics for domain.

---

# 33. MicroProfile OpenAPI

MicroProfile OpenAPI generates/serves OpenAPI documentation for REST apps.

## 33.1 Value

- runtime-generated contract;
- annotation augmentation;
- docs endpoint;
- API governance;
- client generation;
- contract validation.

## 33.2 Rule

Generated OpenAPI should be reviewed and tested, not blindly trusted.

---

# 34. OpenAPI Annotations

Common annotations:

```java
@Operation
@APIResponse
@Parameter
@RequestBody
@Schema
@Tag
@SecurityScheme
@OpenAPIDefinition
```

## 34.1 Example

```java
@GET
@Path("/{id}")
@Operation(summary = "Get application by ID")
@APIResponse(
    responseCode = "200",
    description = "Application found"
)
@APIResponse(
    responseCode = "404",
    description = "Application not found"
)
public ApplicationResponse get(@PathParam("id") String id) { ... }
```

## 34.2 Rule

Annotations should clarify contract, not decorate obvious code.

---

# 35. Documenting Security, Errors, and Versioning

OpenAPI must include:

- JWT bearer scheme;
- scopes/roles if applicable;
- Problem Details schema;
- error examples;
- versioning policy;
- deprecation/sunset;
- idempotency headers;
- pagination schema.

## 35.1 Rule

OpenAPI that documents only 200 response is incomplete.

---

# 36. MicroProfile JWT

MicroProfile JWT standardizes JWT-based security for MicroProfile services.

## 36.1 Use

- inject `JsonWebToken`;
- map groups to roles;
- use role annotations;
- access claims.

## 36.2 Example

```java
@Inject
JsonWebToken jwt;

@GET
@RolesAllowed("officer")
public Response getSecure() {
    String subject = jwt.getSubject();
    Set<String> groups = jwt.getGroups();
    ...
}
```

## 36.3 Rule

JWT integration is authentication foundation; domain authorization still needed.

---

# 37. `JsonWebToken`, Roles, and Claims

## 37.1 Common claims

- `sub`;
- `iss`;
- `aud`;
- `groups`;
- `scope`;
- `tenant_id`;
- `client_id`.

## 37.2 Mapping

Map JWT to `CurrentActor`.

```java
CurrentActor actor = actorMapper.from(jwt);
```

## 37.3 Rule

Do not pass raw JWT claims deep into domain. Normalize to application identity.

---

# 38. JWT + JAX-RS SecurityContext

JWT runtime integration may populate `SecurityContext`.

## 38.1 Role annotations

```java
@RolesAllowed("admin")
```

## 38.2 Caveat

Role-level authorization does not replace object-level authorization.

## 38.3 Rule

Use `@RolesAllowed` for coarse checks and domain policy for fine-grained access.

---

# 39. JWT Security Caveats

Validate:

- issuer;
- audience;
- expiration;
- signature;
- allowed algorithms;
- required claims.

Do not:

- trust decoded token before validation;
- accept wrong audience;
- log raw token;
- rely only on frontend claims.

## 39.1 Rule

MicroProfile JWT reduces boilerplate, not security thinking.

---

# 40. MicroProfile Health

Health endpoints communicate service state to orchestrators/platforms.

Common categories:

- liveness;
- readiness;
- startup.

## 40.1 Liveness

Should process be restarted?

## 40.2 Readiness

Should service receive traffic?

## 40.3 Startup

Has service finished startup?

## 40.4 Rule

Health checks drive platform decisions. Design them carefully.

---

# 41. Liveness vs Readiness vs Startup

## 41.1 Bad liveness

Liveness checks DB and restarts app when DB is down.

This can cause restart storm.

## 41.2 Good liveness

Checks app process/event loop not deadlocked.

## 41.3 Readiness

Checks if service can handle traffic.

May include critical dependencies.

## 41.4 Rule

Liveness is for restart; readiness is for traffic routing.

---

# 42. Health Check Design

## 42.1 Example readiness

```java
@Readiness
@ApplicationScoped
public class DatabaseReadinessCheck implements HealthCheck {
    @Override
    public HealthCheckResponse call() {
        return db.ping()
            ? HealthCheckResponse.up("database")
            : HealthCheckResponse.down("database");
    }
}
```

## 42.2 Avoid heavy health checks

Do not run expensive queries every second.

## 42.3 Rule

Health checks must be cheap, meaningful, and platform-aligned.

---

# 43. Putting It Together: Example Service

## 43.1 Resource

```java
@Path("/applications")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class ApplicationResource {

    @Inject ApplicationService service;

    @POST
    @RolesAllowed("applicant")
    @Operation(summary = "Create application")
    @APIResponse(responseCode = "201", description = "Application created")
    public Response create(CreateApplicationRequest request, @Context UriInfo uriInfo) {
        ApplicationResponse created = service.create(request);

        URI location = uriInfo.getAbsolutePathBuilder()
            .path(created.id())
            .build();

        return Response.created(location).entity(created).build();
    }
}
```

## 43.2 Outbound Gateway

```java
@ApplicationScoped
public class CustomerGateway {

    @Inject
    @RestClient
    CustomerApiClient client;

    @Timeout(1000)
    @Retry(maxRetries = 1, delay = 100, jitter = 50)
    @CircuitBreaker(requestVolumeThreshold = 20, failureRatio = 0.5)
    public CustomerSnapshot getCustomer(String id) {
        CustomerResponse response = client.get(id);
        return mapper.toSnapshot(response);
    }
}
```

## 43.3 Rule

Keep resource, client, fault tolerance, and domain mapping separated.

---

# 44. Production Runtime Patterns

## 44.1 Runtime config

All environment differences in config.

## 44.2 Typed clients

One gateway per downstream.

## 44.3 Fault tolerance

Configured per operation.

## 44.4 Telemetry

Runtime emits HTTP/client spans, app adds domain metrics.

## 44.5 Health

Readiness protects traffic; liveness protects process.

## 44.6 OpenAPI

Published and diffed.

## 44.7 Rule

MicroProfile specs should work together as production platform, not isolated demos.

---

# 45. Testing MicroProfile + JAX-RS

Test categories:

- unit test domain/service;
- JAX-RS integration test;
- Rest Client mock server test;
- Fault Tolerance behavior test;
- Config override test;
- JWT auth test;
- OpenAPI snapshot/diff;
- Health endpoint test;
- telemetry smoke.

## 45.1 Rule

Spec annotations are behavior and must be tested in runtime.

---

# 46. Configuration Testing

## 46.1 Test defaults

Run with no env override.

## 46.2 Test override

Set environment/system property.

## 46.3 Test invalid config

Fail fast.

## 46.4 Rule

Production config bugs should be caught before deployment.

---

# 47. Fault Tolerance Testing

Use mock server/fake service.

Test:

- retry attempt count;
- timeout;
- circuit opens;
- bulkhead rejects;
- fallback used;
- non-idempotent methods not retried by wrapper logic.

## 47.1 Rule

Do not trust annotation behavior without integration tests.

---

# 48. OpenAPI Contract Testing

## 48.1 Validate generated OpenAPI

Check:

- paths;
- operation IDs;
- schemas;
- Problem Details;
- security;
- examples.

## 48.2 Diff

Compare against committed baseline.

## 48.3 Rule

Generated spec drift is contract drift.

---

# 49. Security Testing

Test:

- missing token;
- invalid JWT;
- wrong role;
- wrong tenant;
- missing scope;
- expired token;
- object-level access.

## 49.1 Rule

MicroProfile JWT tests must include object/domain authorization, not just roles.

---

# 50. Observability Testing

Verify:

- server span;
- client span;
- correlation ID;
- FT metrics/events;
- error code attributes;
- health check status;
- custom domain metrics.

## 50.1 Rule

Telemetry is part of production behavior and should be smoke-tested.

---

# 51. Runtime Differences

MicroProfile spec gives portability, but runtime differences exist.

Examples:

- config source integration;
- MP Rest Client connector/pool;
- OpenAPI endpoint path;
- JWT configuration keys;
- telemetry exporter config;
- health endpoint path;
- dev/test mode.

## 51.1 Rule

Keep runtime-specific docs in deployment guide and test target runtime.

---

# 52. Common Failure Modes

## 52.1 Wrong MicroProfile/Jakarta version mix

Class mismatch.

## 52.2 Config key typo

Default accidentally used.

## 52.3 Rest Client timeout missing

Hanging calls.

## 52.4 Retry annotation on unsafe POST

Duplicate side effect.

## 52.5 Circuit breaker too broad

Unrelated operations blocked.

## 52.6 Header propagation too broad

Token/secret leaks.

## 52.7 JWT roles used as full authorization

BOLA.

## 52.8 OpenAPI generated but not reviewed

Bad contract docs.

## 52.9 Health check too heavy

Self-inflicted load.

## 52.10 Telemetry not connected across services

Trace gaps.

---

# 53. Best Practices

## 53.1 Align versions

MicroProfile, Jakarta EE, runtime.

## 53.2 Use configKey

For Rest Client.

## 53.3 Wrap typed clients in gateways

Domain mapping and policies.

## 53.4 Apply FT at semantic boundary

Not blindly on interface.

## 53.5 Allowlist propagated headers

Security.

## 53.6 Document OpenAPI fully

Errors/security/examples.

## 53.7 Use JWT for coarse auth

Domain policy for object auth.

## 53.8 Keep health cheap

Liveness vs readiness.

## 53.9 Test annotations in runtime

Spec behavior is runtime behavior.

## 53.10 Observe everything

Inbound, outbound, resilience.

---

# 54. Anti-Patterns

## 54.1 Treat MicroProfile as magic

Specs need configuration and tests.

## 54.2 Put `@Retry` everywhere

Danger.

## 54.3 Propagate all headers

Security leak.

## 54.4 Use raw Rest Client DTO as domain model

Coupling.

## 54.5 Config in random classes

Hard to govern.

## 54.6 Health check calls every dependency deeply

Load problem.

## 54.7 Only annotate OpenAPI 200 responses

Incomplete docs.

## 54.8 Rely on role annotation for tenant authorization

BOLA risk.

## 54.9 Ignore runtime differences

Production surprise.

## 54.10 No contract tests

Spec drift.

---

# 55. Production Checklist

## 55.1 Version/runtime

- [ ] MicroProfile version selected.
- [ ] Component versions known.
- [ ] Jakarta EE namespace aligned.
- [ ] Runtime compatibility confirmed.
- [ ] Runtime-specific config documented.

## 55.2 Config

- [ ] All env-specific values externalized.
- [ ] Defaults documented.
- [ ] Required config validated at startup.
- [ ] Secrets not in repo.
- [ ] Config overrides tested.

## 55.3 Rest Client

- [ ] Typed client per downstream.
- [ ] configKey used.
- [ ] Timeout configured.
- [ ] Header propagation allowlist.
- [ ] ResponseExceptionMapper.
- [ ] Gateway wrapper.
- [ ] Mock server tests.

## 55.4 Fault Tolerance

- [ ] Timeout budget.
- [ ] Retry safe/idempotent.
- [ ] Circuit scope correct.
- [ ] Bulkhead where needed.
- [ ] Fallback reviewed.
- [ ] FT metrics/behavior tested.

## 55.5 OpenAPI/JWT/Health/Telemetry

- [ ] OpenAPI generated and reviewed.
- [ ] Problem Details documented.
- [ ] Security schemes documented.
- [ ] JWT issuer/audience/roles configured.
- [ ] Object-level authorization tested.
- [ ] Liveness/readiness/startup designed.
- [ ] Traces/metrics/logs verified.

---

# 56. Latihan

## Latihan 1 — Config Policy

Buat config object untuk pagination:

```text
application.pagination.default-limit
application.pagination.max-limit
```

Tambahkan startup validation.

## Latihan 2 — Typed Rest Client

Buat `CustomerApiClient` dengan `@RegisterRestClient`.

Tambahkan config URL/timeout.

Test dengan mock server.

## Latihan 3 — Header Factory

Buat `ClientHeadersFactory` yang hanya propagate:

```text
X-Correlation-ID
traceparent
```

Bukan Authorization.

## Latihan 4 — Problem Mapper

Buat `ResponseExceptionMapper` untuk downstream Problem Details.

Test HTML error dan malformed JSON.

## Latihan 5 — Fault Tolerance

Tambahkan `@Timeout`, `@Retry`, `@CircuitBreaker` pada gateway.

Test attempt count dan circuit open.

## Latihan 6 — OpenAPI Error Docs

Tambahkan Problem Details schema ke OpenAPI.

Pastikan 400/401/403/404/409/500 documented.

## Latihan 7 — JWT Test

Test:

- missing token;
- wrong role;
- valid role but wrong object tenant.

## Latihan 8 — Health

Buat liveness dan readiness.

Pastikan DB down tidak menyebabkan liveness restart storm.

## Latihan 9 — Telemetry Smoke

Panggil endpoint yang memanggil Rest Client.

Verifikasi server span dan client span terhubung.

---

# 57. Referensi Resmi

Referensi utama:

1. MicroProfile 7.1  
   https://microprofile.io/compatible/7-1/

2. MicroProfile Config 3.1 Specification  
   https://download.eclipse.org/microprofile/microprofile-config-3.1/microprofile-config-spec-3.1.html

3. MicroProfile Rest Client 4.0  
   https://microprofile.io/specifications/rest-client/4-0/

4. MicroProfile Rest Client 4.0 Specification  
   https://download.eclipse.org/microprofile/microprofile-rest-client-4.0/microprofile-rest-client-spec-4.0.html

5. MicroProfile Fault Tolerance  
   https://microprofile.io/specifications/microprofile-fault-tolerance/

6. MicroProfile OpenAPI  
   https://microprofile.io/specifications/open-api/

7. MicroProfile Telemetry  
   https://microprofile.io/specifications/telemetry/

8. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

---

# 58. Penutup

MicroProfile membuat JAX-RS service lebih siap production.

Mental model final:

```text
JAX-RS resource
  + MicroProfile Config
  + MicroProfile Rest Client
  + Fault Tolerance
  + Telemetry
  + OpenAPI
  + JWT
  + Health
  =
production-grade microservice surface
```

Prinsip final:

```text
Config drives environment behavior.
Typed clients clarify downstream contracts.
Fault tolerance must respect HTTP/domain semantics.
OpenAPI is contract, not decoration.
JWT is identity foundation, not full authorization.
Health checks drive platform routing.
Telemetry makes runtime behavior visible.
Runtime differences must be tested.
```

Top-tier JAX-RS engineer memastikan:

- MicroProfile/Jakarta versions aligned;
- config valid dan terdokumentasi;
- outbound clients typed, tested, and resilient;
- JWT/roles tidak menggantikan object authorization;
- OpenAPI mencakup errors/security/examples;
- health checks tidak menyebabkan restart storm;
- telemetry menghubungkan inbound/outbound behavior;
- semua annotation behavior diuji di runtime target.

Part berikutnya:

```text
Bagian 050 — JAX-RS and Jakarta Security / OAuth2 / OIDC / JWT
```

Kita akan membahas authentication/authorization lebih dalam: Jakarta Security, OAuth2/OIDC flows, JWT validation, token exchange, scopes/roles/claims, SecurityContext, method security, tenant-aware authorization, and production identity architecture.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-048.md](./learn-jaxrs-advanced-part-048.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-050.md](./learn-jaxrs-advanced-part-050.md)

</div>