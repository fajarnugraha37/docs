# Strict Coding Standards — Eclipse Jersey for Java

> **Target:** Java REST services and clients implemented with Eclipse Jersey
> **Scope:** Jersey server runtime, Jersey client, ResourceConfig/Application setup, providers, filters/interceptors, dependency injection, JSON/XML/multipart, validation, security, testing, deployment, and LLM implementation rules
> **Audience:** LLM code agents, human reviewers, maintainers, tech leads
> **Purpose:** prevent Jersey-specific implementation mistakes: mixed Jersey/Jakarta versions, hidden classpath scanning assumptions, unsafe provider auto-discovery, fat resource classes, singleton resource race bugs, unmanaged Jersey clients, broken timeout/retry behavior, accidental entity serialization, and insecure filters/logging.

---

## 0. Non-negotiable operating rule for LLM agents

When implementing Eclipse Jersey code, an LLM agent **MUST** treat Jersey as the runtime adapter for a REST contract, not as the place to put business logic.

The agent **MUST NOT** implement Jersey code by merely adding a resource class and registering whatever dependency makes compilation pass.

Every Jersey implementation **MUST** make these decisions explicit:

1. Which Jersey major line is used.
2. Which namespace is used: `javax.ws.rs.*` or `jakarta.ws.rs.*`.
3. Which Java baseline is used.
4. Which container/runtime owns the application: Servlet container, Grizzly, Netty, JDK HTTP server, Java SE bootstrap, application server, or test runtime.
5. Which dependency injection mechanism is used: HK2, CDI/Weld, Spring bridge, or manual composition.
6. Which JSON provider is used: Jackson, JSON-B, MOXy, JSON-P, or custom provider.
7. Which providers, filters, interceptors, features, and binders are registered.
8. Which resource classes are explicitly registered or scanned.
9. Which timeout, retry, redirect, TLS, and proxy behavior applies for Jersey clients.
10. Which validation/error mapping contract is used.
11. Which observability data is emitted.
12. Which tests prove the Jersey runtime behavior.

If a version or runtime decision is unclear, the agent **MUST** avoid adding Jersey-specific code beyond the minimal portable JAX-RS/Jakarta REST layer and must document the uncertainty.

---

## 1. Relationship with other standards

This document is an overlay standard.

It **MUST** be used together with:

- `strict-coding-standards__java11.md`
- `strict-coding-standards__java17.md`
- `strict-coding-standards__java21.md`
- `strict-coding-standards__java25.md`
- `strict-coding-standards__jaxrs.md`
- `strict-coding-standards__java_http.md`
- `strict-coding-standards__java_json.md`
- `strict-coding-standards__java_xml.md`
- `strict-coding-standards__java_validation.md`
- `strict-coding-standards__java_hibernate_validation.md`
- `strict-coding-standards__java_logging.md`
- `strict-coding-standards__java_telemetry.md`
- `strict-coding-standards__java_security.md`
- `strict-coding-standards__java_testing.md`

The generic JAX-RS/Jakarta REST standard defines HTTP/resource semantics.

This Jersey standard defines **Jersey-specific runtime and implementation guardrails**.

If this document conflicts with project-specific platform documentation, the project-specific runtime contract wins, but the conflict **MUST** be documented.

---

## 2. Version and namespace policy

### 2.1 Jersey major version selection

A project **MUST** choose a Jersey line based on the target platform, not based on whatever version autocomplete suggests.

| Jersey line | Namespace | Platform target | Default status |
|---|---|---|---|
| Jersey 2.x | `javax.ws.rs.*` | Java EE 8 / JAX-RS 2.x era | Legacy only. Do not introduce into new Jakarta modules. |
| Jersey 3.0.x | `jakarta.ws.rs.*` | Jakarta EE 9 / Jakarta REST 3.0 | Migration line. Use only if platform requires it. |
| Jersey 3.1.x | `jakarta.ws.rs.*` | Jakarta EE 10 / Jakarta REST 3.1 | Allowed for Jakarta EE 10 style systems. |
| Jersey 4.0.x | `jakarta.ws.rs.*` | Jakarta EE 11 / Jakarta REST 4.0 | Allowed when project targets Jakarta EE 11 / Java 17+. |
| Jersey 5.0.x milestone or Jakarta EE 12 line | `jakarta.ws.rs.*` | Jakarta EE 12 / Jakarta REST 5.0 development | **Forbidden by default** unless explicitly approved. |

Rules:

1. The agent **MUST NOT** mix Jersey 2.x artifacts with Jakarta `jakarta.ws.rs.*` source code.
2. The agent **MUST NOT** mix Jersey 3.x/4.x artifacts with legacy `javax.ws.rs.*` source code.
3. The agent **MUST NOT** upgrade Jersey major versions as a drive-by change.
4. The agent **MUST** treat Jersey 4.x as potentially breaking relative to Jersey 3.1.x, especially injection/package changes.
5. The agent **MUST NOT** use milestone/pre-release Jersey artifacts in production modules unless the repository already does so and there is an explicit platform decision.

### 2.2 Namespace rule

Allowed legacy-only module:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
```

Allowed modern Jakarta module:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
```

Forbidden:

```java
// FORBIDDEN: namespace mixing
import javax.ws.rs.GET;
import jakarta.ws.rs.Path;
```

Namespace mixing creates binary/runtime incompatibility and usually means the dependency graph is wrong.

### 2.3 Artifact family rule

The agent **MUST** keep Jersey artifacts in one compatible family.

Allowed pattern for Jersey 3.1.x / Jakarta EE 10 style project:

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.glassfish.jersey</groupId>
            <artifactId>jersey-bom</artifactId>
            <version>${jersey.version}</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

Then use Jersey modules without repeating versions:

```xml
<dependency>
    <groupId>org.glassfish.jersey.containers</groupId>
    <artifactId>jersey-container-servlet-core</artifactId>
</dependency>

<dependency>
    <groupId>org.glassfish.jersey.inject</groupId>
    <artifactId>jersey-hk2</artifactId>
</dependency>

<dependency>
    <groupId>org.glassfish.jersey.media</groupId>
    <artifactId>jersey-media-json-jackson</artifactId>
</dependency>
```

Rules:

1. Use a BOM or centralized dependency management for Jersey artifacts.
2. Do not mix `jersey-client`, `jersey-common`, container modules, media modules, and injection modules from different Jersey versions.
3. Do not add both Jackson and JSON-B providers unless provider precedence is explicitly configured and tested.
4. Do not add MOXy/Jettison unless the project intentionally uses them.
5. Do not add container modules that are not used at runtime.

### 2.4 Java baseline compatibility

| Java baseline | Jersey guidance |
|---|---|
| Java 11 | Use Jersey 2.x for legacy `javax` modules or Jersey 3.1.x only if the chosen Jersey release supports the project baseline. Do not use records. |
| Java 17 | Good baseline for Jakarta EE 10/11 style Jersey. Records may be DTOs only if JSON provider and validation support are confirmed. |
| Java 21 | Virtual threads may be used only if Jersey runtime configuration explicitly supports them and downstream resources are bounded. |
| Java 25 | Follow Java 25 strict standard. Do not use preview/incubator features inside resources, filters, or providers. |

---

## 3. Application setup standards

### 3.1 Prefer explicit `ResourceConfig`

Jersey applications **SHOULD** use explicit `ResourceConfig` registration when maintainability, security, or deterministic startup matters.

Allowed:

```java
@ApplicationPath("/api")
public final class ApiApplication extends ResourceConfig {

    public ApiApplication() {
        register(CaseResource.class);
        register(GlobalExceptionMapper.class);
        register(CorrelationIdFilter.class);
        register(JacksonFeature.class);
        register(new AbstractBinder() {
            @Override
            protected void configure() {
                bind(CaseServiceImpl.class).to(CaseService.class);
            }
        });
    }
}
```

Rules:

1. `ResourceConfig` **MUST** be deterministic.
2. Registration order **MUST** be documented when order affects filters/interceptors/providers.
3. The agent **MUST NOT** rely on broad package scanning for security-sensitive providers.
4. The application root path **MUST** be stable and documented.
5. Jersey-specific configuration properties **MUST** be centralized.

### 3.2 Package scanning policy

Package scanning is **restricted**.

Allowed only when:

1. The scanned package is narrow.
2. The package contains only intended resource/provider classes.
3. Startup tests verify expected registered resources/providers.
4. Security filters and exception mappers are explicitly registered.

Allowed with caution:

```java
public final class ApiApplication extends ResourceConfig {

    public ApiApplication() {
        packages("com.acme.caseapi.adapter.http");
        register(GlobalExceptionMapper.class);
        register(AuthFilter.class);
        register(JacksonFeature.class);
    }
}
```

Forbidden:

```java
// FORBIDDEN: scans too much and can accidentally register test/internal/provider classes.
packages("com.acme");
```

### 3.3 Servlet deployment rule

For servlet deployments:

1. The Jersey servlet/filter mapping **MUST** be explicit.
2. The application class **MUST** be declared through `Application`/`ResourceConfig` or container config.
3. Filter order with authentication, tracing, CORS, compression, and Jersey **MUST** be documented.
4. If deployed behind a reverse proxy/API gateway, forwarded-header handling **MUST** be explicit and tested.

### 3.4 Java SE bootstrap rule

Jersey can be used in Java SE environments.

For Java SE bootstrap:

1. Startup and shutdown lifecycle **MUST** be owned by application boot code.
2. Ports, root path, host, protocol, and SSL settings **MUST** come from configuration, not literals.
3. The server instance **MUST** be stopped on shutdown.
4. Tests **MUST** avoid random untracked port conflicts.

Allowed:

```java
ResourceConfig app = new ApiApplication();

SeBootstrap.Configuration config = SeBootstrap.Configuration.builder()
        .property(SeBootstrap.Configuration.HOST, "127.0.0.1")
        .property(SeBootstrap.Configuration.PORT, port)
        .property(SeBootstrap.Configuration.ROOT_PATH, "/")
        .build();

CompletionStage<SeBootstrap.Instance> started = SeBootstrap.start(app, config);
```

### 3.5 Runtime module rule

The project **MUST** include exactly the Jersey runtime/container module it actually uses.

Examples:

| Runtime | Typical module family |
|---|---|
| Servlet container | `jersey-container-servlet-core` or equivalent platform integration |
| Grizzly | `jersey-container-grizzly2-http` |
| JDK HTTP server | `jersey-container-jdk-http` |
| Netty | `jersey-container-netty-http` |
| Java SE bootstrap | compatible container module required by runtime |

Rules:

1. Do not add Grizzly just because examples use it.
2. Do not add Netty connector/container unless runtime explicitly uses it.
3. Do not add multiple container modules unless fallback/selection behavior is understood.
4. If multiple Jersey container modules are on the classpath, startup behavior **MUST** be tested.

---

## 4. Resource class standards

### 4.1 Resource classes must be thin

A Jersey resource class **MUST** be an adapter.

Allowed responsibilities:

1. HTTP annotation mapping.
2. Request DTO validation boundary.
3. Authentication principal extraction.
4. Calling application service.
5. Mapping domain result to response DTO.
6. Returning correct status, headers, and entity.

Forbidden responsibilities:

1. Direct JDBC/JPA logic.
2. Workflow/state transition logic.
3. External API retry logic.
4. Complex authorization rule implementation.
5. Thread/executor management.
6. JSON parser configuration.
7. Transaction ownership unless project explicitly uses resource-level transactions.

Allowed:

```java
@Path("/cases")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public final class CaseResource {

    private final CaseService caseService;

    @Inject
    public CaseResource(CaseService caseService) {
        this.caseService = Objects.requireNonNull(caseService, "caseService");
    }

    @POST
    public Response create(@Valid CreateCaseRequest request, @Context UriInfo uriInfo) {
        CaseId id = caseService.create(request.toCommand());
        URI location = uriInfo.getAbsolutePathBuilder()
                .path(id.value())
                .build();
        return Response.created(location)
                .entity(new CreateCaseResponse(id.value()))
                .build();
    }
}
```

### 4.2 Resource lifecycle rule

The agent **MUST** know whether resource instances are per-request, singleton, CDI-managed, or HK2-managed.

Rules:

1. Default to stateless resources.
2. Do not store request-specific mutable state in fields.
3. Do not use static mutable state for request data.
4. Singleton resources **MUST** be thread-safe.
5. Injected dependencies in singleton resources **MUST** be thread-safe or proxied appropriately.

Forbidden:

```java
@Path("/cases")
public final class CaseResource {
    private String currentUserId; // FORBIDDEN: request state in a field
}
```

Allowed:

```java
@GET
@Path("/{id}")
public CaseResponse get(@PathParam("id") String id, @Context SecurityContext securityContext) {
    String userId = securityContext.getUserPrincipal().getName();
    return service.get(userId, id);
}
```

### 4.3 Constructor injection preferred

Constructor injection is preferred for required dependencies.

Allowed:

```java
@Inject
public CaseResource(CaseService service, CaseMapper mapper) {
    this.service = Objects.requireNonNull(service, "service");
    this.mapper = Objects.requireNonNull(mapper, "mapper");
}
```

Restricted:

```java
@Inject
private CaseService service;
```

Field injection is allowed only when required by framework constraints or legacy codebase style.

### 4.4 `@Context` use policy

`@Context` is allowed only for HTTP/runtime context values such as:

- `UriInfo`
- `HttpHeaders`
- `Request`
- `SecurityContext`
- `ContainerRequestContext`
- `ServletContext` when servlet-specific behavior is truly required

Rules:

1. Do not pass `@Context` objects into domain services.
2. Extract primitive/application-level values first.
3. Do not store context objects in fields unless lifecycle and proxy behavior are proven.
4. Prefer method parameter injection for request-specific values.

---

## 5. Dependency injection standards

### 5.1 Choose one DI model

A Jersey module **MUST** choose one primary DI model:

| Model | Use when | Guardrail |
|---|---|---|
| HK2 | Jersey standalone/simple service binding | Register binders explicitly. |
| CDI/Weld | Jakarta EE / CDI-native runtime | Ensure Jersey/CDI integration is configured and tested. |
| Spring bridge | Spring-owned application | Do not create parallel HK2 object graph for business services. |
| Manual composition | Small Java SE/test tool | Keep object graph explicit. |

Forbidden:

```text
Part of the app uses HK2 services, part uses CDI, part uses Spring, and nobody knows which object owns transactions.
```

### 5.2 HK2 binder rule

HK2 binders **MUST** be explicit, minimal, and typed.

Allowed:

```java
public final class ApiBinder extends AbstractBinder {
    @Override
    protected void configure() {
        bind(CaseServiceImpl.class).to(CaseService.class);
        bind(CaseMapper.class).to(CaseMapper.class);
    }
}
```

Rules:

1. Do not bind test doubles in production configuration.
2. Do not bind request-scoped objects as singletons.
3. Do not bind mutable stateful services as singletons unless thread-safe.
4. Use interfaces for external dependencies and application services.
5. Keep binder classes small and split by module if necessary.

### 5.3 Jersey 4 injection compatibility rule

When migrating to Jersey 4.x:

1. Re-check all imports for HK2 binding classes.
2. Re-check injection-related package changes.
3. Re-run startup tests that verify binders and provider registration.
4. Do not assume Jersey 3.1 injection examples compile unchanged.

---

## 6. Provider and feature standards

### 6.1 Provider registration must be intentional

Providers include:

- `MessageBodyReader`
- `MessageBodyWriter`
- `ExceptionMapper`
- `ContextResolver`
- filters
- interceptors
- features

Rules:

1. Security-sensitive providers **MUST** be explicitly registered.
2. JSON/XML providers **MUST** be selected intentionally.
3. Custom entity providers **MUST** declare media type constraints.
4. Provider precedence **MUST** be tested when multiple providers can match.
5. The agent **MUST NOT** register a provider globally if it is only safe for one resource.

### 6.2 `Feature` usage rule

Jersey `Feature` classes are allowed for coherent cross-cutting registration.

Allowed:

```java
public final class ApiFeature implements Feature {
    @Override
    public boolean configure(FeatureContext context) {
        context.register(CorrelationIdFilter.class);
        context.register(GlobalExceptionMapper.class);
        context.register(JacksonFeature.class);
        return true;
    }
}
```

Rules:

1. A feature **MUST** have one coherent purpose.
2. Features **MUST NOT** hide unrelated provider registrations.
3. Features **MUST** be testable through startup/runtime tests.

### 6.3 Auto-discovery policy

Provider auto-discovery is **restricted**.

The agent **MUST NOT** rely on provider auto-discovery for:

1. Authentication filters.
2. Authorization features.
3. Exception mappers.
4. JSON object mapper configuration.
5. XML parser hardening.
6. Audit logging.
7. Multi-tenant context propagation.

Explicit registration wins over classpath magic.

---

## 7. JSON standards for Jersey

### 7.1 Choose exactly one default JSON provider

A Jersey API **MUST** choose one default JSON provider.

Allowed common choices:

| Provider | When to use |
|---|---|
| Jackson | Existing Jackson DTO ecosystem, advanced configuration, Java records support through configured modules. |
| JSON-B | Jakarta EE aligned projects that standardize on JSON-B. |
| MOXy | Legacy Jersey/JAXB-oriented projects. |
| JSON-P | Low-level JSON object/stream processing. |

Forbidden by default:

1. Registering Jackson and JSON-B with undefined precedence.
2. Returning JPA entities directly and hoping provider serialization is safe.
3. Enabling polymorphic deserialization globally.
4. Logging full JSON bodies containing secrets or PII.
5. Dynamic JSON maps for stable API contracts.

### 7.2 Jackson provider rule

If Jackson is used:

1. Register `JacksonFeature` intentionally.
2. Provide a centralized `ContextResolver<ObjectMapper>` if customization is needed.
3. The shared `ObjectMapper` **MUST** be fully configured before use.
4. Java time module, record support, enum strategy, unknown-field policy, null policy, and date formatting **MUST** match `strict-coding-standards__java_json.md`.

Allowed:

```java
@Provider
public final class ObjectMapperProvider implements ContextResolver<ObjectMapper> {

    private final ObjectMapper mapper;

    public ObjectMapperProvider() {
        this.mapper = JsonMapper.builder()
                .findAndAddModules()
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
                .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                .build();
    }

    @Override
    public ObjectMapper getContext(Class<?> type) {
        return mapper;
    }
}
```

Rules:

1. Do not mutate the mapper after runtime startup.
2. Do not create one mapper per request.
3. Do not enable default typing globally.
4. Do not serialize domain entities directly.

### 7.3 JSON-B provider rule

If JSON-B is used:

1. JSON-B configuration **MUST** be centralized.
2. Date/time formatting **MUST** be explicit.
3. Null handling **MUST** be documented.
4. Unknown-field behavior **MUST** be tested.
5. Java record support **MUST** be verified if records are used as DTOs.

### 7.4 DTO boundary rule

Jersey resources **MUST** use explicit request/response DTOs.

Forbidden:

```java
@GET
public CaseEntity getCase() { // FORBIDDEN: persistence entity as API contract
    return repository.find(...);
}
```

Allowed:

```java
@GET
public CaseResponse getCase(@PathParam("id") String id) {
    return mapper.toResponse(service.get(id));
}
```

---

## 8. XML standards for Jersey

XML support is **restricted** and must follow `strict-coding-standards__java_xml.md`.

Rules:

1. XML endpoints **MUST** be explicitly declared with `@Consumes`/`@Produces`.
2. XML parser hardening **MUST** be configured where applicable.
3. External entity resolution **MUST** be disabled unless explicitly required and allow-listed.
4. JAXB/XML Binding support **MUST** match the runtime namespace and Java/Jakarta version.
5. XML and JSON representations **MUST** not accidentally expose different fields unless documented.

Forbidden:

```java
@Consumes({MediaType.APPLICATION_JSON, MediaType.APPLICATION_XML})
public Response submit(Object body) { // FORBIDDEN: vague representation contract
    ...
}
```

---

## 9. Multipart standards

Multipart support is **restricted** because it is often used for file upload.

Rules:

1. Multipart module dependency **MUST** be explicit.
2. File size limit **MUST** be enforced.
3. Part count limit **MUST** be enforced when supported by the runtime.
4. Filename from client **MUST NOT** be trusted as storage path.
5. Content type **MUST** be treated as advisory until validated.
6. Input streams **MUST** be closed or consumed according to provider lifecycle.
7. Uploaded files **MUST** be scanned/validated according to project security policy.
8. Temporary file cleanup **MUST** be tested.

Allowed:

```java
@POST
@Path("/attachments")
@Consumes(MediaType.MULTIPART_FORM_DATA)
public Response upload(@FormDataParam("file") InputStream input,
                       @FormDataParam("file") FormDataContentDisposition metadata) {
    UploadCommand command = UploadCommand.from(metadata.getFileName(), input);
    AttachmentId id = service.upload(command);
    return Response.status(Response.Status.CREATED)
            .entity(new UploadResponse(id.value()))
            .build();
}
```

Rules for this pattern:

1. `metadata.getFileName()` is never used as a filesystem path.
2. `service.upload` must stream or spool with bounded size.
3. Extension/content validation must happen outside Jersey resource if complex.

---

## 10. Filter and interceptor standards

### 10.1 Filter purpose rule

Use filters for request/response metadata and security gates.

Allowed filter responsibilities:

1. Correlation ID extraction/creation.
2. Authentication token extraction.
3. Authorization pre-check when policy is lightweight and centralized.
4. CORS policy.
5. Security headers.
6. Request/response metrics.
7. Audit event shell.
8. Tenant context extraction.

Forbidden filter responsibilities:

1. Business logic.
2. Database writes except audited, bounded, async-safe audit mechanism.
3. Retrying downstream calls.
4. Reading and replacing large request bodies without strict limits.
5. Logging raw request/response bodies.

### 10.2 Interceptor purpose rule

Use interceptors for entity stream transformations.

Allowed:

1. Compression/decompression if explicitly configured.
2. Controlled encryption/decryption layer if project architecture requires it.
3. Entity stream metering with bounded behavior.

Forbidden:

1. Business validation in writer/reader interceptors.
2. Hidden DTO mutation.
3. Unbounded buffering of request or response entities.

### 10.3 Ordering rule

Filter/interceptor order **MUST** be intentional.

Typical server request order:

1. Correlation/tracing context.
2. Security headers/context extraction.
3. Authentication.
4. Authorization.
5. Request metrics start.
6. Resource invocation.
7. Response mapping.
8. Response headers/metrics/audit finalization.

Rules:

1. Use `@Priority` when order matters.
2. Do not assume registration order if runtime semantics do not guarantee it.
3. Tests must verify critical ordering.

### 10.4 Security filter rules

Security filters **MUST** fail closed.

Allowed:

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public final class AuthenticationFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext context) {
        Optional<Principal> principal = authenticate(context.getHeaders());
        if (principal.isEmpty()) {
            context.abortWith(Response.status(Response.Status.UNAUTHORIZED).build());
            return;
        }
        context.setSecurityContext(new ApiSecurityContext(principal.get(), context.getSecurityContext()));
    }
}
```

Forbidden:

```java
// FORBIDDEN: authentication failure continues request processing.
try {
    authenticate(headers);
} catch (Exception ignored) {
}
```

### 10.5 Body logging rule

Raw body logging is **forbidden by default**.

Allowed only when:

1. Environment is local/test or explicitly approved.
2. Body size is capped.
3. Secrets/PII are redacted.
4. Binary/multipart bodies are excluded.
5. Logs are structured and correlated.

---

## 11. Exception mapping standards

### 11.1 Centralized mapper rule

A Jersey application **MUST** have a centralized error mapping strategy.

Allowed:

```java
@Provider
public final class DomainExceptionMapper implements ExceptionMapper<DomainException> {

    @Override
    public Response toResponse(DomainException exception) {
        ProblemDetails problem = ProblemDetails.from(exception);
        return Response.status(problem.status())
                .type("application/problem+json")
                .entity(problem)
                .build();
    }
}
```

Rules:

1. Do not leak stack traces to clients.
2. Preserve useful internal logs with correlation ID.
3. Map validation errors consistently.
4. Map unsupported media type, unacceptable media type, not found, method not allowed, and bad request explicitly or accept runtime defaults only if documented.
5. Return RFC 9457 Problem Details if project HTTP standard requires it.

### 11.2 Catch-all mapper rule

A catch-all mapper is **restricted**.

If used:

1. It **MUST** log server errors once.
2. It **MUST** return generic client-safe message.
3. It **MUST NOT** swallow `WebApplicationException` semantics accidentally.
4. It **MUST** preserve status codes where appropriate.

Forbidden:

```java
@Provider
public final class ThrowableMapper implements ExceptionMapper<Throwable> {
    public Response toResponse(Throwable t) {
        return Response.ok(t.getMessage()).build(); // FORBIDDEN
    }
}
```

---

## 12. Validation standards

Jersey validation **MUST** follow:

- `strict-coding-standards__java_validation.md`
- `strict-coding-standards__java_hibernate_validation.md`

Rules:

1. Request DTOs **SHOULD** use Bean Validation annotations for structural validation.
2. Domain invariants **MUST** still be enforced in domain/application layer.
3. Method validation **MUST** be enabled and tested if annotations are placed on resource method parameters.
4. Nested DTO validation **MUST** use `@Valid`.
5. Validation errors **MUST** be mapped to stable API error response.
6. Do not rely on validation annotations that the selected Jersey/runtime integration does not execute.

Allowed:

```java
public record CreateCaseRequest(
        @NotBlank String title,
        @Size(max = 1000) String description
) {
}
```

Forbidden:

```java
public record CreateCaseRequest(String title) {
    // FORBIDDEN as only validation if title is domain-critical.
}
```

---

## 13. Jersey client standards

### 13.1 Client lifecycle rule

Jersey `Client` instances are runtime resources.

Rules:

1. Do not create a new client for every request.
2. Create clients at application startup or through a managed factory.
3. Close clients during shutdown if owned by the application.
4. Configure timeouts, TLS, proxy, JSON provider, filters, and telemetry at construction.
5. Do not mutate shared client configuration after runtime starts unless explicitly safe.

Forbidden:

```java
public String call() {
    Client client = ClientBuilder.newClient(); // FORBIDDEN per call
    return client.target(baseUrl).path("/x").request().get(String.class);
}
```

Allowed:

```java
public final class PartnerClient implements AutoCloseable {

    private final Client client;
    private final URI baseUri;

    public PartnerClient(Client client, URI baseUri) {
        this.client = Objects.requireNonNull(client, "client");
        this.baseUri = Objects.requireNonNull(baseUri, "baseUri");
    }

    public PartnerResponse getPartner(String id) {
        return client.target(baseUri)
                .path("partners")
                .path(id)
                .request(MediaType.APPLICATION_JSON_TYPE)
                .get(PartnerResponse.class);
    }

    @Override
    public void close() {
        client.close();
    }
}
```

### 13.2 Timeout rule

Every Jersey client call **MUST** have configured timeouts.

Required timeout categories:

1. Connect timeout.
2. Read/request timeout.
3. Overall operation timeout at application layer when a workflow calls multiple services.

Allowed:

```java
ClientConfig config = new ClientConfig()
        .property(ClientProperties.CONNECT_TIMEOUT, 2_000)
        .property(ClientProperties.READ_TIMEOUT, 5_000)
        .register(JacksonFeature.class)
        .register(CorrelationClientFilter.class);

Client client = ClientBuilder.newClient(config);
```

Rules:

1. Timeout values **MUST** be configuration-driven.
2. Timeout values **MUST** be finite.
3. The client wrapper **MUST** translate timeout exceptions into application-specific failure types.

### 13.3 Retry rule

Jersey client wrappers **MUST NOT** blindly retry.

Retries are allowed only when:

1. Operation is idempotent or has an idempotency key.
2. Failure is transient and classified.
3. Retry budget is bounded.
4. Backoff and jitter are used.
5. Observability records attempts.
6. Response body/entity lifecycle is safe for retry.

Forbidden:

```java
for (int i = 0; i < 3; i++) {
    client.target(url).request().post(Entity.json(body)); // FORBIDDEN blind POST retry
}
```

### 13.4 Response lifecycle rule

When using `Response`, the agent **MUST** close it.

Allowed:

```java
try (Response response = target.request().get()) {
    if (response.getStatus() == 404) {
        return Optional.empty();
    }
    if (response.getStatusInfo().getFamily() != Response.Status.Family.SUCCESSFUL) {
        throw mapError(response);
    }
    return Optional.of(response.readEntity(PartnerResponse.class));
}
```

Rules:

1. Always consume or close response entities.
2. Do not read entity multiple times unless buffering is intentionally enabled and size-bounded.
3. Do not return raw `Response` from low-level client wrappers to service layer.

### 13.5 Connector provider rule

If a custom Jersey connector is used:

1. The connector **MUST** be documented.
2. Pooling behavior **MUST** be understood.
3. TLS behavior **MUST** be tested.
4. Proxy behavior **MUST** be tested.
5. Timeout property support **MUST** be verified for that connector.

Do not switch connector provider as a drive-by performance fix.

---

## 14. Security standards

### 14.1 Authorization rule

Jersey annotations such as `@RolesAllowed` are allowed only when the runtime security context is correctly populated.

Rules:

1. Authentication filter/container security **MUST** set a reliable `SecurityContext`.
2. Method-level authorization **MUST** be tested.
3. Multi-tenant authorization **MUST NOT** rely only on role names.
4. Domain object authorization **MUST** happen in service/domain layer.

### 14.2 SSRF and redirect rule for Jersey clients

When target URLs are user-controlled or indirectly user-controlled:

1. Use allow-listed hosts/schemes/ports.
2. Disable or strictly validate redirects.
3. Revalidate the final resolved address after redirects.
4. Block loopback, private, link-local, and cloud metadata addresses unless explicitly allow-listed.
5. Do not pass user input directly into `target(String)`.

Forbidden:

```java
client.target(request.getUrl()).request().get(); // FORBIDDEN SSRF risk
```

### 14.3 Header trust rule

Headers are untrusted input unless produced by trusted infrastructure.

Rules:

1. Do not trust `X-Forwarded-*` unless the service is behind a trusted proxy and configured accordingly.
2. Do not trust user-supplied correlation IDs without validation and length limit.
3. Do not reflect header values into logs/responses without sanitization.
4. Authorization headers must never be logged.

### 14.4 CORS rule

CORS must be explicit.

Forbidden:

```java
response.getHeaders().add("Access-Control-Allow-Origin", "*"); // FORBIDDEN for credentialed/private APIs
```

Required:

1. Allowed origins list.
2. Allowed methods list.
3. Allowed headers list.
4. Credential policy.
5. Preflight handling.
6. Tests.

---

## 15. Observability standards

### 15.1 Correlation ID

Every request **SHOULD** have a correlation/request ID.

Rules:

1. Accept trusted inbound ID only if valid.
2. Generate a new ID when missing/invalid.
3. Put ID into logging context.
4. Propagate ID to outbound Jersey client calls.
5. Include ID in error responses when safe.

### 15.2 Metrics

Jersey instrumentation **SHOULD** record:

1. Request count by route/template, method, status family.
2. Request duration by route/template, method, status family.
3. Exception count by mapped category.
4. Client call count/duration by dependency and outcome.
5. In-flight request gauge if supported.

Rules:

1. Do not use raw path with IDs as metric label.
2. Use route template if available.
3. Keep cardinality bounded.

### 15.3 Tracing

Tracing **SHOULD** propagate context through:

1. Server request filters.
2. Resource invocation.
3. Jersey client request filters.
4. Async callbacks/threads if used.

Rules:

1. Do not create spans around every trivial mapper.
2. Record important error status and dependency calls.
3. Avoid adding PII to span attributes.

---

## 16. Async, SSE, and streaming standards

### 16.1 Async resource rule

Async Jersey APIs are **restricted**.

Allowed only when:

1. The request genuinely waits on non-blocking/asynchronous work.
2. Timeout is configured.
3. Cancellation is handled.
4. Thread/executor ownership is clear.
5. Errors are mapped through standard error response.

Forbidden:

```java
@GET
public void get(@Suspended AsyncResponse response) {
    new Thread(() -> response.resume(service.get())).start(); // FORBIDDEN unmanaged thread
}
```

### 16.2 Streaming output rule

Streaming output is allowed only with:

1. Bounded source.
2. Backpressure or write failure handling.
3. Client disconnect handling.
4. No large in-memory aggregation.
5. Metrics/logging that do not require full buffering.

### 16.3 SSE rule

SSE is allowed only when:

1. Heartbeat/keepalive policy is defined.
2. Client disconnect cleanup is implemented.
3. Queue capacity is bounded.
4. Retry/reconnect semantics are documented.
5. Authentication/authorization is enforced for long-lived connections.

---

## 17. Configuration standards

### 17.1 Centralized Jersey configuration

Jersey configuration **MUST** be centralized in application setup or a dedicated module.

Forbidden:

```java
// FORBIDDEN: random runtime properties spread across resources.
System.setProperty("jersey.config.some.property", "...");
```

Allowed:

```java
public final class ApiApplication extends ResourceConfig {
    public ApiApplication(ApiSettings settings) {
        property(ServerProperties.BV_SEND_ERROR_IN_RESPONSE, false);
        register(new ApiBinder(settings));
    }
}
```

Rules:

1. Use typed settings where possible.
2. Keep secrets out of Jersey properties unless specifically required and protected.
3. Version config keys in documentation.
4. Test startup with production-like configuration.

### 17.2 Environment profile rule

Do not change API behavior silently by environment.

Allowed environment differences:

1. Log verbosity.
2. Metrics exporter endpoint.
3. Timeout values within approved range.
4. Base URLs.
5. TLS trust store location.

Forbidden differences:

1. Disabled auth in staging/prod path.
2. Different JSON field names.
3. Different validation rules.
4. Different exception response schema.

---

## 18. Testing standards

### 18.1 Required test layers

A Jersey feature/resource change **MUST** include appropriate tests:

| Change type | Required tests |
|---|---|
| New resource method | Resource integration test + service unit test |
| New filter | Request/response behavior test + ordering test if relevant |
| New exception mapper | Mapping test for status/body/content-type |
| New JSON provider config | Serialization/deserialization tests |
| New client wrapper | Mock HTTP server test + timeout/error mapping test |
| New multipart endpoint | Upload size/type/path traversal tests |
| New auth behavior | Unauthorized/forbidden/allowed tests |
| New ResourceConfig registration | Startup test |

### 18.2 JerseyTest rule

`JerseyTest` or equivalent in-memory/container test is allowed for Jersey runtime behavior.

Rules:

1. Use the same `ResourceConfig` path as production where possible.
2. Register test doubles explicitly.
3. Do not rely only on resource unit tests for filters/providers/mappers.
4. Verify content type, status code, headers, and response body.
5. Include negative tests.

Example:

```java
final class CaseResourceTest extends JerseyTest {

    @Override
    protected Application configure() {
        return new ResourceConfig()
                .register(new ApiBinder(new FakeCaseService()))
                .register(CaseResource.class)
                .register(GlobalExceptionMapper.class)
                .register(JacksonFeature.class);
    }

    @Test
    void createReturnsCreatedLocation() {
        Response response = target("cases")
                .request(MediaType.APPLICATION_JSON_TYPE)
                .post(Entity.json(new CreateCaseRequest("Title", "Description")));

        assertThat(response.getStatus()).isEqualTo(201);
        assertThat(response.getHeaderString("Location")).contains("/cases/");
    }
}
```

### 18.3 Client test rule

Jersey clients **MUST** be tested against a controllable HTTP server or mock server.

Required scenarios:

1. Success response.
2. 4xx mapped response.
3. 5xx mapped response.
4. Timeout.
5. Invalid JSON.
6. Retry behavior if retry exists.
7. Header propagation.
8. Response close/no connection leak where possible.

---

## 19. Migration standards

### 19.1 Jersey 2.x to 3.x

Migration rules:

1. Replace `javax.ws.rs.*` with `jakarta.ws.rs.*` only when all dependencies support Jakarta.
2. Update Jersey artifacts consistently.
3. Update servlet/container dependencies consistently.
4. Update validation, JSON-B, JSON-P, CDI, JAXB namespaces consistently.
5. Re-run serialization, validation, and startup tests.
6. Do not mix converted and unconverted modules in one runtime classpath.

### 19.2 Jersey 3.1.x to 4.x

Migration rules:

1. Confirm Jakarta REST 4.0 / Jakarta EE 11 target.
2. Confirm Java 17+ baseline if required by the platform stack.
3. Review injection/HK2/Weld package and behavior changes.
4. Review removed connector/container modules.
5. Review JSON/XML provider compatibility.
6. Re-run startup tests, integration tests, and deployment smoke tests.

### 19.3 JAX-RS/Jersey to another framework

Do not mechanically translate annotations.

The agent **MUST** preserve:

1. HTTP semantics.
2. Error schema.
3. Validation behavior.
4. Security behavior.
5. Provider/serialization behavior.
6. Timeout/retry behavior.
7. Observability behavior.

---

## 20. Forbidden patterns

The following are forbidden unless explicitly approved:

1. Mixing `javax.ws.rs.*` and `jakarta.ws.rs.*`.
2. Mixing Jersey major-version artifacts.
3. Adding random Jersey modules until compilation passes.
4. Creating `Client` per outbound call.
5. Returning JPA/domain entities directly from resources.
6. Storing request-specific data in resource fields.
7. Trust-all TLS or disabled hostname verification.
8. Raw request/response body logging in production.
9. Blind retry for non-idempotent calls.
10. Catch-all `ExceptionMapper` that returns stack trace or always 200.
11. Broad package scanning without tests.
12. Multipart upload without size/path/content controls.
13. Auto-discovered security/error providers.
14. Provider ambiguity between Jackson/JSON-B/MOXy.
15. Business logic in filters/interceptors.
16. Unmanaged threads from resources.
17. Unbounded async/SSE queues.
18. Environment-specific API behavior.
19. Turning on WADL or introspection endpoint in production without approval.
20. Using Jersey milestone releases in production without explicit platform approval.

---

## 21. Required implementation note for LLM agents

For any Jersey code change, the agent **MUST** include this implementation note in PR/summary form:

```markdown
## Jersey Implementation Note

- Jersey line:
- Namespace: javax.ws.rs / jakarta.ws.rs
- Java baseline:
- Runtime/container:
- Application config class:
- DI model:
- JSON provider:
- XML provider, if any:
- Multipart support, if any:
- Registered resources:
- Registered providers/features/filters/interceptors:
- Security behavior:
- Error mapping behavior:
- Validation behavior:
- Jersey client lifecycle/timeouts, if outbound calls exist:
- Observability behavior:
- Tests added/updated:
- Known compatibility constraints:
```

If the agent cannot fill this note, the implementation is incomplete.

---

## 22. Reviewer checklist

A reviewer **MUST** reject Jersey changes when any answer is unclear:

### Version and dependency

- [ ] Is the Jersey major line correct for the project?
- [ ] Is the namespace family consistent?
- [ ] Are Jersey artifacts version-aligned through BOM/dependency management?
- [ ] Are unnecessary Jersey modules avoided?
- [ ] Are milestone/pre-release artifacts absent unless approved?

### Application setup

- [ ] Is `ResourceConfig`/`Application` deterministic?
- [ ] Are resources/providers explicitly registered or narrowly scanned?
- [ ] Are security/error/JSON providers explicitly registered?
- [ ] Is deployment runtime/container clear?
- [ ] Is startup tested?

### Resource correctness

- [ ] Are resource classes thin adapters?
- [ ] Is request state kept out of fields?
- [ ] Is constructor injection used for required dependencies?
- [ ] Are status codes, headers, and media types correct?
- [ ] Are DTOs used instead of entities?

### Provider/filter correctness

- [ ] Are filters/interceptors purpose-specific?
- [ ] Is ordering explicit where needed?
- [ ] Are security filters fail-closed?
- [ ] Are body logs disabled or safely bounded/redacted?
- [ ] Is exception mapping centralized and client-safe?

### Client correctness

- [ ] Is `Client` reused and closed by owner?
- [ ] Are timeouts configured?
- [ ] Are retries safe and bounded?
- [ ] Are responses closed?
- [ ] Is SSRF/redirect risk controlled?

### Serialization/validation

- [ ] Is exactly one default JSON provider selected?
- [ ] Is mapper/provider configuration centralized?
- [ ] Are validation errors mapped consistently?
- [ ] Are XML/multipart endpoints hardened?

### Observability and testing

- [ ] Are correlation IDs propagated?
- [ ] Are route-level metrics low-cardinality?
- [ ] Are relevant tests added for resource/filter/provider/client behavior?
- [ ] Are negative/security tests included?

---

## 23. LLM prompt contract

Use this prompt snippet for LLM code agents implementing Jersey changes:

```text
You are modifying an Eclipse Jersey Java codebase.

Before coding:
1. Identify Jersey major version, namespace, Java baseline, runtime/container, DI model, JSON provider, and existing ResourceConfig/Application setup.
2. Do not mix javax.ws.rs and jakarta.ws.rs.
3. Do not add Jersey dependencies unless they match the existing Jersey family and are necessary.
4. Keep resources thin. Put business logic in application/domain services.
5. Explicitly register security/error/JSON providers. Do not rely on provider auto-discovery for critical behavior.
6. Reuse Jersey Client instances, configure finite timeouts, close Response objects, and do not retry non-idempotent calls blindly.
7. Use explicit DTOs. Do not expose JPA/domain entities directly.
8. Add tests for resource contract, provider/filter behavior, error mapping, validation, and client failure modes.
9. Include a Jersey Implementation Note in the final response or PR summary.

If any version/runtime/provider decision is unclear, choose the safest minimal change and document the uncertainty.
```

---

## 24. Source anchors

This standard is based on these source categories:

- Eclipse Jersey official documentation and user guide.
- Eclipse Jersey project/release/roadmap information.
- Jakarta RESTful Web Services specifications.
- Java/Jakarta namespace migration rules.
- OWASP security guidance for REST, SSRF, logging, and input handling.
- Existing strict standards in this repository.

