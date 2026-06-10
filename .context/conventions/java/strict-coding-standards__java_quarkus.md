# Strict Coding Standards — Java Quarkus

## 0. Purpose

This standard defines mandatory rules for building Java services using **Quarkus**.
It is intended for LLM code agents, reviewers, and engineers implementing production-grade Quarkus applications.

This document is not a Quarkus tutorial. It is an implementation contract.

## 1. Core Principle

Quarkus code must be:

1. build-time friendly,
2. container-native,
3. explicit about blocking vs non-blocking execution,
4. secure by default,
5. observable by default,
6. configuration-driven,
7. testable without production infrastructure,
8. compatible with the selected Quarkus platform version.

Quarkus is not “Spring Boot with different annotations.” Do not blindly port patterns from other frameworks.

## 2. Baseline References

Primary references:

- Quarkus official site and release stream: https://quarkus.io/
- Quarkus guides: https://quarkus.io/guides/
- Quarkus 3 Java baseline note: https://quarkus.io/blog/java-17/
- Quarkus 3 overview: https://quarkus.io/quarkus3/
- Quarkus REST guide: https://quarkus.io/guides/rest
- Quarkus reactive architecture: https://quarkus.io/guides/quarkus-reactive-architecture
- Quarkus Mutiny primer: https://quarkus.io/guides/mutiny-primer
- Quarkus configuration reference: https://quarkus.io/guides/config-reference
- Quarkus testing guide: https://quarkus.io/guides/getting-started-testing
- Quarkus native image guide: https://quarkus.io/guides/building-native-image
- Quarkus security guides: https://quarkus.io/guides/security
- Quarkus observability guides: https://quarkus.io/guides/observability

Current contextual facts to verify during upgrades:

- Quarkus 3.7+ requires Java 17 to build and run Quarkus applications.
- Quarkus 3 targets Java 17 minimum, with newer Java versions supported depending on the release stream.
- Quarkus releases frequent regular and LTS streams; always pin the platform BOM version.

## 3. Scope

This standard governs:

- Quarkus platform and BOM usage.
- REST APIs with Quarkus REST.
- CDI/Arc usage.
- Config with MicroProfile Config / SmallRye Config.
- Reactive and blocking execution.
- Hibernate ORM/Panache and reactive persistence.
- REST clients.
- Messaging.
- Scheduler/jobs.
- Security.
- Observability.
- Native image readiness.
- Testing.
- Docker/Kubernetes runtime behavior.

This file must be used with:

- `strict-coding-standards__java17.md` or later Java baseline.
- `strict-coding-standards__java_http.md`
- `strict-coding-standards__jaxrs.md`
- `strict-coding-standards__java_rective.md`
- `strict-coding-standards__java_testing.md`
- `strict-coding-standards__java_docker.md`
- `strict-coding-standards__java_kubernetes.md`
- persistence/messaging/service-specific standards where applicable.

## 4. Version and Platform Rules

### 4.1 Quarkus Platform BOM

Every Quarkus project must use the Quarkus platform BOM.

Maven example:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>io.quarkus.platform</groupId>
      <artifactId>quarkus-bom</artifactId>
      <version>${quarkus.platform.version}</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Gradle example:

```kotlin
dependencies {
    implementation(enforcedPlatform("io.quarkus.platform:quarkus-bom:$quarkusPlatformVersion"))
}
```

Rules:

- Pin Quarkus platform version.
- Do not mix random extension versions outside BOM unless explicitly required.
- Every extension version override must include reason and compatibility evidence.
- Do not combine extensions from incompatible Quarkus major/minor streams.
- Do not upgrade Quarkus without running migration notes and full test suite.

### 4.2 Java Version

Rules:

- Quarkus 3.7+ baseline is Java 17 minimum.
- Use Java toolchains in Maven/Gradle.
- Use `--release` where relevant for library modules.
- Java 21+ features may be used only if project baseline allows them.
- Java preview features are forbidden unless project explicitly enables preview and has approval.

### 4.3 LTS vs Latest

Production services should prefer:

1. Quarkus LTS stream where operational stability is priority.
2. Regular latest stream only when feature/security requirement justifies it.

Every Quarkus upgrade must document:

- from version,
- to version,
- Java baseline impact,
- extension compatibility,
- removed/deprecated behavior,
- test result,
- rollback plan.

## 5. Dependency Rules

Allowed:

- Quarkus extensions from the platform BOM.
- Libraries compatible with selected Java and Jakarta versions.
- SmallRye/MicroProfile libraries managed by Quarkus where possible.

Restricted:

- Direct Vert.x dependency.
- Direct RESTEasy/Jersey dependency.
- Direct Hibernate dependency.
- Direct Netty dependency.
- Direct Jackson/Gson override.
- Native-image-specific substitution dependencies.

Forbidden:

- Mixing `javax.*` and `jakarta.*` APIs in the same module.
- Adding Spring dependencies to imitate Spring Boot unless using Quarkus Spring compatibility extensions intentionally.
- Overriding extension transitive dependencies without compatibility evidence.
- Copying dependency snippets from old Quarkus 1.x/2.x docs into Quarkus 3.x code.

## 6. Project Structure Rules

Recommended structure:

```text
src/main/java/<base>/
  api/
    rest/
    dto/
  application/
    command/
    service/
    port/
  domain/
    model/
    policy/
    event/
  infrastructure/
    persistence/
    messaging/
    client/
    config/
  common/
```

Rules:

- REST resources must not contain business logic.
- Domain model must not depend on Quarkus APIs.
- Infrastructure adapters may depend on Quarkus extensions.
- Configuration mapping must stay in infrastructure/config layer.
- Generated code must be isolated.

## 7. CDI / Arc Rules

### 7.1 Injection

Use constructor injection where possible.

Allowed:

```java
@ApplicationScoped
public class OrderService {
    private final OrderRepository repository;

    public OrderService(OrderRepository repository) {
        this.repository = repository;
    }
}
```

Restricted:

```java
@Inject
OrderRepository repository;
```

Field injection is allowed only for framework-constrained classes or tests.

Forbidden:

- static injection,
- service locator pattern,
- hidden global mutable state,
- injecting request-scoped bean into singleton without understanding proxy/lifecycle,
- performing remote I/O in bean constructor.

### 7.2 Bean Scopes

Rules:

- Use `@ApplicationScoped` for stateless services/adapters.
- Use `@RequestScoped` only when request lifecycle matters.
- Use `@Singleton` only when CDI behavior difference is understood.
- Avoid mutable state in application-scoped beans.
- Do not store request-specific data in application-scoped fields.

### 7.3 Build-Time Removal

Quarkus performs aggressive build-time analysis and may remove unused beans.

Rules:

- Avoid reflection-based bean lookup unless necessary.
- Avoid relying on unused-looking beans without registration.
- Use explicit registration/annotations when framework discovery requires it.
- Test native/build mode if dynamic behavior exists.

## 8. Configuration Rules

### 8.1 Typed Config

Use typed configuration mapping for structured config.

Allowed:

```java
@ConfigMapping(prefix = "app.payment")
public interface PaymentConfig {
    URI endpoint();
    Duration timeout();
    int maxRetries();
}
```

Rules:

- Config keys must have clear prefix.
- Secret config values must not be logged.
- Defaults must be explicit and safe.
- Required values must fail fast at startup.
- Duration/size config must use proper typed value.

### 8.2 Environment-Specific Config

Rules:

- Separate dev/test/prod config clearly.
- Do not commit production secrets.
- Do not make prod use dev services.
- Do not put local-only credentials in shared config.
- Config profile behavior must be tested.

### 8.3 Forbidden Config Practices

Forbidden:

- hardcoded endpoint/credential/region;
- reading env vars directly throughout business code;
- magic string config keys scattered across code;
- defaulting to insecure mode when config is missing;
- logging full config dump.

## 9. REST API Rules

### 9.1 Quarkus REST

Use Quarkus REST for new Quarkus REST services unless project has explicit legacy RESTEasy Classic constraint.

Rules:

- Resource methods must be thin.
- DTOs must be explicit.
- Validation must happen at boundary.
- Error mapping must be centralized.
- HTTP semantics must follow RFC 9110.
- Problem Details or consistent error envelope must be used.

### 9.2 Resource Class Rules

Allowed:

```java
@Path("/orders")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class OrderResource {
    private final CreateOrderUseCase createOrder;

    public OrderResource(CreateOrderUseCase createOrder) {
        this.createOrder = createOrder;
    }

    @POST
    public Uni<Response> create(CreateOrderRequest request) {
        return createOrder.handle(request.toCommand())
            .map(result -> Response.status(Response.Status.CREATED).entity(OrderResponse.from(result)).build());
    }
}
```

Rules:

- Do not return entity/JPA model directly.
- Do not perform transaction-heavy logic in resource.
- Do not expose stack traces.
- Do not use GET for mutation.
- Do not use path variables for secrets/tokens.

### 9.3 Blocking vs Non-Blocking Resource

Rules:

- If method uses blocking dependency, mark or dispatch correctly.
- Do not call JDBC/JPA from event loop.
- Use `@Blocking` or appropriate worker strategy when required.
- Use reactive clients in non-blocking routes.
- Test blocked-thread warnings.

## 10. Reactive Rules

Quarkus is reactive-first in many parts, but imperative code is supported.

Rules:

- Use Mutiny `Uni`/`Multi` for Quarkus reactive APIs.
- Do not mix Reactor/RxJava unless project already standardizes on them.
- Do not convert between reactive libraries casually.
- Do not use `await().indefinitely()` in request/event-loop path.
- Do not block Vert.x event loop.
- Use `@Blocking` intentionally for blocking code.
- Use worker pools for unavoidable blocking integration.

Forbidden:

```java
@GET
public String slow() {
    return uni.await().indefinitely();
}
```

unless this is an explicitly blocking endpoint and justified.

## 11. Virtual Thread Rules

Quarkus supports virtual-thread usage in selected contexts depending on version and extension.

Rules:

- Use only on Java 21+ baseline.
- Use for high-concurrency blocking I/O when simpler than reactive.
- Do not use for CPU-bound speedup.
- Do not ignore downstream resource limits.
- Keep JDBC pool size bounded.
- Test pinning/blocking behavior if synchronized/native code is involved.

Forbidden:

- combining virtual threads with unbounded database connection demand;
- assuming virtual threads remove need for timeouts;
- using both reactive and virtual threads without clear boundary.

## 12. Persistence Rules

### 12.1 Hibernate ORM / Panache

Rules:

- Use `@Transactional` only at application service boundary.
- Avoid transaction in REST resource unless trivial and approved.
- Do not expose entities as API response.
- Avoid `FetchType.EAGER` by default.
- Define fetch plan for queries.
- Avoid Panache active-record style in complex domain model unless project standard allows it.

Restricted:

- Panache entity active-record pattern.
- Open Session in View-like behavior.
- Hibernate-specific annotations.
- Lazy loading in JSON serialization.

Forbidden:

- production schema update via ORM auto-DDL;
- blind `merge()` from request DTO;
- direct `@ManyToMany` for mutable business associations.

### 12.2 Hibernate Reactive

Rules:

- Use only with supported reactive drivers.
- Do not mix Hibernate ORM session and reactive session in same unit of work.
- Reactive transaction boundary must be explicit.
- Do not block inside reactive persistence chain.
- Test failure and rollback semantics.

### 12.3 JDBC / Agroal

Rules:

- Configure datasource explicitly.
- Pool sizing must match database capacity.
- Statement/query timeouts must be configured where supported.
- Transaction boundary must be explicit.
- Metrics must be exposed.

## 13. REST Client Rules

Rules:

- Use Quarkus REST Client / REST Client Reactive extension where standardized.
- Configure base URL via config.
- Configure timeout explicitly.
- Define retry policy outside low-level client where possible.
- Validate outbound URL if user-controlled.
- Propagate tracing headers.
- Do not log full request/response body by default.

Forbidden:

- creating raw HTTP client per request;
- hardcoding URLs;
- trust-all TLS;
- disabled hostname verification;
- retrying non-idempotent call without idempotency key;
- using blocking client on event loop.

## 14. Messaging Rules

For Kafka, AMQP, RabbitMQ, SNS/SQS, or other messaging extensions:

- channel name must be explicit;
- message schema must be versioned;
- idempotent consumer required;
- ack/nack behavior must be clear;
- retry and DLQ must be bounded;
- backpressure must be understood;
- ordering/partitioning must be documented;
- observability must include message ID, key, topic/queue/channel.

Do not ack before durable processing unless acceptable message loss is explicitly documented.

## 15. Scheduling Rules

Rules:

- Scheduled jobs must be idempotent.
- Job concurrency must be defined.
- Cluster behavior must be defined.
- Long jobs must have timeout and progress logging.
- External side effects must be retry-safe.
- Job ownership in Kubernetes replicas must be clear.

Forbidden:

- assuming one pod = one scheduler unless enforced;
- running destructive job on all replicas;
- unbounded job retry loop;
- no observability for scheduled job.

## 16. Security Rules

Rules:

- Use Quarkus security extensions where applicable.
- Authentication and authorization must be explicit.
- Do not implement custom auth unless required.
- Validate tenant/user boundary.
- Never log tokens/secrets.
- Use HTTPS/TLS correctly.
- Configure CORS explicitly if used.
- Use CSRF protection where browser session/cookie semantics apply.
- Use role/permission checks close to boundary and domain policy.

Forbidden:

- `permitAll` fallback for protected endpoint;
- trusting client-provided role/tenant;
- disabling TLS validation;
- exposing dev UI/config in production;
- shipping test credentials.

## 17. Native Image Rules

Native image support is restricted and must be intentional.

Rules:

- Every native image requirement must be tested in CI if production uses native.
- Reflection usage must be registered explicitly.
- Dynamic proxies/resources must be configured.
- Runtime initialization vs build-time initialization must be reviewed.
- Charset/locale/resource availability must be tested.
- Native binary behavior must be tested separately from JVM mode.

Forbidden:

- assuming JVM mode behavior equals native mode;
- adding reflection workaround without explaining why;
- using dynamic class loading without native compatibility plan;
- enabling native only at final release without earlier testing.

## 18. Dev Services Rules

Quarkus Dev Services are useful for local/test but must not leak to production.

Rules:

- Dev Services allowed in dev/test only.
- Testcontainers-backed dependencies must be deterministic.
- Production config must point to managed services explicitly.
- Do not rely on Dev Services data/state.

Forbidden:

- production profile using dev services;
- tests passing only because implicit dev service started with default config;
- hidden dependency on local Docker without documenting it.

## 19. Observability Rules

Every Quarkus service must expose:

- structured logs,
- health readiness/liveness where relevant,
- metrics,
- tracing for remote calls,
- correlation ID propagation,
- error classification.

Rules:

- Use Quarkus/Micrometer/OpenTelemetry extensions consistently.
- Do not create custom telemetry stack unless required.
- Avoid high-cardinality metric labels.
- Do not log secrets/PII.
- Include endpoint, dependency, status, duration, and error class where appropriate.

## 20. Health Check Rules

Rules:

- Startup check: application initialized and required config loaded.
- Readiness check: can serve traffic.
- Liveness check: process is not irrecoverably stuck.
- Dependency health checks must not overload dependencies.
- Do not make liveness fail for transient downstream outage.

Forbidden:

- liveness check that calls database and restarts pod during DB outage;
- readiness always returns UP regardless of critical dependency;
- health endpoint leaking secret/config details.

## 21. Testing Rules

### 21.1 Unit Tests

Rules:

- Domain/application logic should be testable without Quarkus runtime.
- Avoid starting Quarkus for pure unit test.
- Use deterministic clock/randomness.

### 21.2 Quarkus Tests

Rules:

- Use `@QuarkusTest` for integration tests requiring Quarkus runtime.
- Use test profiles for config differences.
- Use Dev Services/Testcontainers intentionally.
- Test REST endpoint status/error body.
- Test security behavior.

### 21.3 Native Tests

If native image is production target, native tests are mandatory for critical flows.

### 21.4 Forbidden Testing Practices

Forbidden:

- testing only happy path;
- relying on test order;
- hidden dependency on local machine service;
- test profile accidentally using production resource;
- ignoring blocked-thread warnings.

## 22. Build Rules

Rules:

- Use Maven/Gradle wrapper.
- Use Quarkus plugin version aligned with platform.
- Pin plugin versions.
- Enable reproducible build where possible.
- Run formatter/checkstyle/static analysis if project standard requires.
- Run dependency vulnerability scanning.
- Build container/native image through documented task.

Forbidden:

- using different Quarkus version in plugin and BOM;
- unpinned plugin versions;
- downloading dependencies from untrusted repositories;
- committing generated build output.

## 23. Docker Rules

Rules:

- Use multi-stage build or Quarkus-generated container flow.
- Run as non-root.
- Set JVM memory/container flags intentionally.
- Expose correct port.
- Log to stdout/stderr.
- Do not store secrets in image.
- Include SBOM/scanning where pipeline supports it.

## 24. Kubernetes Rules

Rules:

- Set resource requests/limits.
- Configure startup/readiness/liveness probes.
- Configure graceful shutdown.
- Use ConfigMap/Secret appropriately.
- Use ServiceAccount/RBAC least privilege.
- Use NetworkPolicy where cluster supports it.
- Consider HPA impact on database/pool/message consumers.

## 25. Configuration Profiles

Rules:

- `%dev`, `%test`, `%prod` overrides must be intentional.
- Prod profile must be secure by default.
- Test profile must not call production dependencies.
- Profile-specific behavior must be documented if it affects logic.

Forbidden:

- dev endpoint enabled in prod;
- prod secret value committed under profile;
- different auth behavior in prod without test coverage.

## 26. Error Handling Rules

Rules:

- Map domain errors to correct HTTP/problem error.
- Map validation errors to structured response.
- Map security failures correctly.
- Log infrastructure errors with correlation ID.
- Do not expose stack trace in response.
- Do not swallow exception in reactive chain.

## 27. Transaction Rules

Rules:

- Transaction boundary belongs in application service.
- One use case should have clear transaction scope.
- Do not perform slow remote calls inside DB transaction unless required.
- Outbox pattern required for reliable DB + message side effects.
- Retry transaction only when idempotent and error is transient.

Forbidden:

- transaction around HTTP call + DB update without failure model;
- transaction annotation on private method expecting proxy behavior;
- nested transaction assumptions without explicit support.

## 28. Panache Rules

Panache is restricted in complex systems.

Allowed:

- simple CRUD modules,
- admin/internal tools,
- small bounded contexts.

Restricted:

- core domain model,
- complex aggregate invariants,
- multi-tenant enforcement,
- strict repository abstraction required.

Forbidden:

- exposing Panache entity directly as REST response;
- putting business workflow in entity static methods;
- relying on active record style for cross-aggregate process.

## 29. Quarkus Extension Rules

Before adding an extension, document:

- extension name,
- purpose,
- version source,
- runtime impact,
- native-image impact,
- config keys added,
- security implications,
- test strategy.

Forbidden:

- adding extension just for one utility class;
- adding overlapping REST/JPA/JSON implementations;
- adding extension with incompatible Jakarta namespace.

## 30. JSON Rules

Rules:

- Use Quarkus-standard JSON stack for the project.
- Do not mix JSON-B/Jackson randomly.
- DTOs must be explicit.
- Unknown field policy must be defined.
- Date/time format must be ISO-8601 or documented contract.
- Sensitive fields must be excluded/redacted.

## 31. XML Rules

Rules:

- XML parsing must be XXE-safe.
- External entity/schema access must be disabled unless required.
- Payload size must be bounded.
- XML mappers must be configured centrally.

## 32. File Upload/Download Rules

Rules:

- size limit required;
- content type validation required;
- generated storage filename required;
- path traversal defense required;
- streaming required for large files;
- temp file cleanup required;
- antivirus/malware scanning if domain requires.

## 33. CORS Rules

CORS must be explicit.

Forbidden:

- wildcard origin with credentials;
- enabling all methods/headers without reason;
- using CORS as authorization mechanism;
- assuming CORS protects server-to-server API.

## 34. OpenAPI Rules

Rules:

- Public API must have OpenAPI generated/validated where project requires.
- Error responses must be documented.
- Security schemes must be documented.
- DTO field nullability must be accurate.
- Do not expose internal model names unnecessarily.

## 35. Migration Rules

When migrating into Quarkus:

- identify blocking dependencies;
- identify Java/Jakarta namespace changes;
- identify CDI lifecycle changes;
- identify config mapping changes;
- identify transaction model;
- identify REST behavior changes;
- identify native image impact;
- add regression tests before migration.

When upgrading Quarkus:

- read migration guide/release notes;
- update platform BOM/plugin together;
- run all tests;
- run container smoke test;
- run native test if applicable;
- validate operational config.

## 36. Anti-Patterns

Forbidden anti-patterns:

1. Treating Quarkus like Spring Boot and copying annotations blindly.
2. Mixing RESTEasy Classic and Quarkus REST accidentally.
3. Blocking on event loop.
4. Returning JPA entity as REST response.
5. Scattering config string keys across code.
6. Field injection everywhere.
7. Business logic in REST resource.
8. Production auto-DDL.
9. Dev Services leaking into production assumptions.
10. Incompatible Quarkus extension versions.
11. Native image enabled without native tests.
12. `permitAll` by accident.
13. Missing timeout on REST/database/messaging client.
14. Reactive type used without failure/cancellation model.
15. Ignoring Kubernetes resource impact.

## 37. Required Design Note for Non-Trivial Quarkus Change

```markdown
### Quarkus Design Note

- Quarkus version/platform:
- Java baseline:
- Extensions added/changed:
- Blocking/non-blocking model:
- REST/API impact:
- Persistence impact:
- Transaction boundary:
- Messaging impact:
- Config keys added/changed:
- Security impact:
- Observability impact:
- Native image impact:
- Docker/Kubernetes impact:
- Tests added:
- Migration/rollback plan:
```

## 38. Reviewer Checklist

Reject the change if:

- [ ] Quarkus BOM/plugin versions are inconsistent;
- [ ] Java baseline is unclear;
- [ ] extension added without justification;
- [ ] `javax.*` and `jakarta.*` are mixed;
- [ ] REST resource contains business logic;
- [ ] blocking call may run on event loop;
- [ ] timeout/retry missing for remote call;
- [ ] transaction boundary unclear;
- [ ] entity exposed as API response;
- [ ] config secret logged or hardcoded;
- [ ] health check is unsafe;
- [ ] observability missing;
- [ ] native image impact ignored;
- [ ] Kubernetes resource impact ignored;
- [ ] tests do not cover failure/security behavior.

## 39. LLM Prompt Contract

When implementing Quarkus code, the LLM must follow this contract:

```text
You are implementing a Quarkus service.
Before writing code:
1. Identify Quarkus platform version and Java baseline.
2. Use Quarkus platform BOM and compatible extensions only.
3. Do not mix javax and jakarta namespaces.
4. Keep REST resources thin and move business logic to application services.
5. Identify whether each endpoint/path is blocking, reactive, or virtual-thread based.
6. Do not run blocking JDBC/JPA/filesystem/HTTP work on event loop.
7. Use typed configuration and do not hardcode secrets/endpoints.
8. Define transaction boundaries explicitly.
9. Add timeout/retry/idempotency behavior for remote calls.
10. Add validation, error mapping, logging, metrics, tracing, and tests.
11. If native image or Kubernetes deployment is affected, document and test it.
12. If uncertain about Quarkus-specific behavior, state assumption instead of inventing.
```

## 40. Final Rule

Quarkus code must be explicit about runtime model. A change that compiles but hides blocking, hides configuration, hides security assumptions, or hides extension compatibility is not acceptable.
