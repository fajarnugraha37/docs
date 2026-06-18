# Part 32 — Capstone: Building a Production-Grade Jersey Platform Module

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
Status: **Part terakhir / Capstone**  
Target pembaca: software engineer senior/lead yang ingin mampu membangun, mengaudit, mengembangkan, dan men-debug platform Jersey production-grade dari Java 8 sampai Java 25.

---

## 0. Posisi Part Ini Dalam Seri

Part ini adalah penutup. Semua part sebelumnya membedah Jersey dari banyak sisi:

- runtime mental model,
- bootstrap,
- resource model,
- request matching,
- parameter injection,
- entity provider,
- JSON strategy,
- response engineering,
- exception mapper,
- filters/interceptors,
- HK2/CDI/Spring integration,
- Jersey Client,
- resilience,
- async,
- SSE,
- multipart,
- security,
- validation,
- versioning,
- hypermedia,
- observability,
- performance,
- virtual threads,
- deployment,
- configuration,
- testing,
- extension engineering,
- migration,
- production failure modes,
- enterprise architecture patterns.

Capstone ini mengubah seluruh pemahaman itu menjadi satu blueprint:

> bagaimana membangun **internal Jersey platform module** yang bisa dipakai berulang oleh banyak service, konsisten secara behavior, aman secara security, mudah diobservasi, mudah dites, dan defensible dalam production incident.

Yang dibangun bukan sekadar aplikasi contoh. Yang dibangun adalah pola berpikir dan struktur platform.

---

## 1. Problem Besar Yang Diselesaikan Platform Module

Dalam banyak organisasi, setiap service Jersey biasanya tumbuh seperti ini:

```text
Service A:
  punya error format sendiri
  logging format sendiri
  timeout client sendiri
  security filter sendiri
  JSON ObjectMapper sendiri
  validation mapper sendiri

Service B:
  mirip, tapi beda detail

Service C:
  copy-paste dari A 2 tahun lalu
  dependency sudah berbeda
  behavior error berbeda

Service D:
  memakai Jersey Client tanpa timeout
  response tidak selalu ditutup
  logging body tidak masking PII
```

Masalahnya bukan Jersey-nya. Masalahnya adalah **runtime policy tidak dipusatkan**.

Platform module menyelesaikan problem berikut:

1. Konsistensi bootstrap.
2. Konsistensi error response.
3. Konsistensi security context.
4. Konsistensi logging, metrics, tracing.
5. Konsistensi JSON serialization.
6. Konsistensi validation error.
7. Konsistensi outbound HTTP client behavior.
8. Konsistensi idempotency dan audit hook.
9. Konsistensi testing harness.
10. Konsistensi migration path antar Java/Jersey/Jakarta generation.

Tanpa platform module, tim cenderung menyelesaikan problem yang sama berulang kali dengan variasi kecil yang menjadi sumber incident.

---

## 2. Prinsip Desain Utama

Platform module yang baik harus mengikuti prinsip berikut.

### 2.1 Explicit Over Magical

Jersey mendukung scanning dan auto-discovery. Itu berguna untuk development cepat, tapi production platform sebaiknya eksplisit.

```java
public final class ApiApplication extends ResourceConfig {
    public ApiApplication(ApiPlatformConfig config) {
        register(new ApiPlatformFeature(config));
        register(HealthResource.class);
        register(CaseResource.class);
        register(DocumentResource.class);
    }
}
```

Lebih verbose, tapi lebih mudah diaudit.

Pertanyaan production-nya:

> provider apa saja yang aktif, filter apa saja yang berjalan, mapper mana yang akan menang, dan property apa yang dipakai?

Kalau jawabannya tidak bisa dilihat dari bootstrap/config, berarti platform terlalu magical.

---

### 2.2 Runtime Policy Harus Dipisah Dari Business Logic

Resource class seharusnya tidak mengurus:

- correlation ID,
- exception envelope,
- metrics,
- authentication token parsing,
- audit envelope,
- JSON mapper,
- outbound client timeout,
- logging masking,
- validation error shape.

Resource class cukup menjadi HTTP adapter.

```text
HTTP request
  -> Jersey platform policy
  -> resource boundary
  -> application service
  -> domain/service layer
  -> repository/integration
```

Kalau resource class penuh dengan boilerplate runtime policy, maka setiap endpoint menjadi tempat risiko inconsistency.

---

### 2.3 Boundary Harus Jelas

Platform module harus membuat boundary ini eksplisit:

```text
Inbound HTTP boundary:
  request identity
  correlation
  validation
  authorization
  idempotency
  audit intent
  response/error contract

Application boundary:
  command/query use case
  transaction
  domain invariant
  workflow/state transition

Outbound HTTP boundary:
  timeout
  retry
  circuit breaker
  correlation propagation
  error normalization
  response closing
```

Jersey paling kuat ketika dipakai sebagai boundary runtime, bukan sebagai tempat business process dicampur dengan HTTP detail.

---

## 3. Target Arsitektur Platform Module

Kita akan membayangkan module internal bernama:

```text
company-jersey-platform
```

Dengan package konseptual:

```text
com.company.platform.jersey
  ├── bootstrap
  ├── config
  ├── error
  ├── json
  ├── logging
  ├── metrics
  ├── tracing
  ├── security
  ├── validation
  ├── idempotency
  ├── audit
  ├── client
  ├── testing
  └── migration
```

Tujuan module ini bukan memaksa semua service identik. Tujuannya menyediakan **default yang aman** dan **extension point yang terkendali**.

---

## 4. Dependency Profile: Java 8, Java 17+, Java 21/25

Karena seri ini membahas Java 8 sampai Java 25, platform harus punya strategi profile.

### 4.1 Legacy Profile — Java 8 / Jersey 2.x

Karakteristik:

```text
Java       : 8
Namespace  : javax.ws.rs
Jersey     : 2.x
Servlet    : javax.servlet
Validation : javax.validation
JSON       : Jackson 2.x / JSON-B lama / MOXy tergantung stack
```

Cocok untuk legacy enterprise application.

Risiko:

- namespace lama,
- dependency rentan tertinggal,
- tidak ada records/sealed/virtual threads,
- classpath conflict lebih sering,
- migration ke Jakarta butuh effort besar.

Platform module untuk Java 8 harus dibuat konservatif.

---

### 4.2 Jakarta EE 10 Profile — Java 11/17+ / Jersey 3.1.x

Karakteristik:

```text
Namespace  : jakarta.ws.rs
Jersey     : 3.1.x
Jakarta EE : 10
```

Ini biasanya menjadi target realistis untuk banyak modernisasi dari Java EE lama.

---

### 4.3 Jakarta EE 11 Profile — Java 17+ / Jersey 4.x

Karakteristik:

```text
Namespace  : jakarta.ws.rs
Jersey     : 4.x
Jakarta EE : 11
Jakarta REST : 4.0
Java baseline : Java SE 17+
```

Jakarta REST 4.0 adalah release Jakarta EE 11. Jersey 4.0.x diposisikan sebagai implementasi Jakarta REST 4.0/Jakarta EE 11.

---

### 4.4 Modern Runtime Profile — Java 21/25

Karakteristik:

```text
Java       : 21 atau 25
Runtime    : virtual-thread-aware, modern GC, better TLS/runtime behavior
Jersey     : tergantung target Jakarta EE/container
```

Catatan penting:

- Virtual threads bukan fitur Jersey saja; behavior bergantung pada servlet container/runtime.
- Jangan mengklaim aplikasi “scalable” hanya karena memakai Java 21/25.
- Cek blocking points, DB pool, outbound pool, synchronized blocks, ThreadLocal/MDC propagation.

---

## 5. Modul 1 — Explicit Bootstrap

### 5.1 Tujuan

Bootstrap harus menjawab:

- resource apa yang aktif,
- provider apa yang aktif,
- feature apa yang aktif,
- config apa yang dipakai,
- mode runtime apa yang dipilih,
- apakah auto-discovery diizinkan,
- apakah startup fail-fast.

### 5.2 Desain `ApiPlatformFeature`

```java
public final class ApiPlatformFeature implements Feature {

    private final ApiPlatformConfig config;

    public ApiPlatformFeature(ApiPlatformConfig config) {
        this.config = Objects.requireNonNull(config, "config");
    }

    @Override
    public boolean configure(FeatureContext context) {
        validate(config);

        context.register(new PlatformBinder(config));
        context.register(new JsonFeature(config.json()));
        context.register(new ErrorFeature(config.errors()));
        context.register(new ObservabilityFeature(config.observability()));
        context.register(new SecurityFeature(config.security()));
        context.register(new ValidationFeature(config.validation()));
        context.register(new ClientFeature(config.client()));

        if (config.idempotency().enabled()) {
            context.register(new IdempotencyFeature(config.idempotency()));
        }

        if (config.audit().enabled()) {
            context.register(new AuditFeature(config.audit()));
        }

        return true;
    }

    private static void validate(ApiPlatformConfig config) {
        if (config.client().defaultConnectTimeoutMillis() <= 0) {
            throw new IllegalArgumentException("defaultConnectTimeoutMillis must be positive");
        }
        if (config.client().defaultReadTimeoutMillis() <= 0) {
            throw new IllegalArgumentException("defaultReadTimeoutMillis must be positive");
        }
    }
}
```

### 5.3 ResourceConfig

```java
public final class CaseManagementApplication extends ResourceConfig {

    public CaseManagementApplication() {
        ApiPlatformConfig platformConfig = ApiPlatformConfig.fromEnvironment();

        property(ServerProperties.PROVIDER_SCANNING_RECURSIVE, false);
        property(ServerProperties.METAINF_SERVICES_LOOKUP_DISABLE, true);

        register(new ApiPlatformFeature(platformConfig));

        register(CaseResource.class);
        register(DocumentResource.class);
        register(DecisionResource.class);
        register(SearchResource.class);
    }
}
```

### 5.4 Kenapa Ini Penting

Dengan explicit bootstrap:

- startup lebih deterministik,
- dependency conflict lebih cepat terlihat,
- provider yang aktif bisa diaudit,
- migration lebih mudah,
- test lebih bisa mengontrol runtime.

---

## 6. Modul 2 — Configuration Model

### 6.1 Prinsip Config

Config platform harus:

1. immutable setelah startup,
2. tervalidasi saat startup,
3. tidak membaca environment langsung di banyak tempat,
4. bisa di-dump secara aman,
5. membedakan public config dan secret config,
6. bisa dioverride untuk test.

### 6.2 Contoh Config Object

```java
public final class ApiPlatformConfig {
    private final JsonConfig json;
    private final ErrorConfig errors;
    private final ObservabilityConfig observability;
    private final SecurityConfig security;
    private final ValidationConfig validation;
    private final ClientConfig client;
    private final IdempotencyConfig idempotency;
    private final AuditConfig audit;

    // constructor + getters omitted
}
```

### 6.3 Startup Validation

```java
public final class PlatformConfigValidator {

    public static void validate(ApiPlatformConfig config) {
        requirePositive(config.client().defaultConnectTimeoutMillis(), "client.connectTimeout");
        requirePositive(config.client().defaultReadTimeoutMillis(), "client.readTimeout");
        requireNonBlank(config.observability().serviceName(), "observability.serviceName");

        if (config.audit().enabled() && config.security().mode() == SecurityMode.NONE) {
            throw new IllegalStateException("Audit requires security identity context");
        }
    }

    private static void requirePositive(long value, String name) {
        if (value <= 0) {
            throw new IllegalArgumentException(name + " must be positive");
        }
    }

    private static void requireNonBlank(String value, String name) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
    }
}
```

### 6.4 Runtime Config Dump

Expose safe config only:

```json
{
  "serviceName": "case-api",
  "environment": "uat",
  "jsonProvider": "jackson",
  "errorContract": "problem-details-v1",
  "securityMode": "jwt",
  "clientDefaultConnectTimeoutMs": 1000,
  "clientDefaultReadTimeoutMs": 3000,
  "auditEnabled": true,
  "idempotencyEnabled": true
}
```

Never dump:

- private key,
- client secret,
- token,
- DB password,
- signing material,
- internal personal data.

---

## 7. Modul 3 — JSON Strategy

### 7.1 Goal

JSON strategy harus memastikan:

- tanggal konsisten,
- enum konsisten,
- unknown field policy jelas,
- null policy jelas,
- lazy proxy tidak bocor,
- polymorphism tidak berbahaya,
- error response dan success response memakai provider yang sama.

### 7.2 Jackson Provider Example

```java
public final class JsonFeature implements Feature {

    private final JsonConfig config;

    public JsonFeature(JsonConfig config) {
        this.config = config;
    }

    @Override
    public boolean configure(FeatureContext context) {
        ObjectMapper mapper = createObjectMapper(config);
        JacksonJsonProvider provider = new JacksonJsonProvider(mapper);
        context.register(provider, Priorities.ENTITY_CODER);
        return true;
    }

    private static ObjectMapper createObjectMapper(JsonConfig config) {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        mapper.disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
        mapper.disable(SerializationFeature.FAIL_ON_EMPTY_BEANS);
        return mapper;
    }
}
```

### 7.3 Policy Decision Table

| Concern | Recommended Default | Reason |
|---|---:|---|
| Date/time | ISO-8601 | readable, interoperable |
| Unknown fields inbound | tolerate for public API | forward compatibility |
| Unknown fields internal command | maybe fail | stricter correctness |
| Null outbound | explicit policy per DTO | avoid accidental contract drift |
| Entity serialization | avoid JPA entity directly | prevents lazy proxy and overexposure |
| Polymorphism | disabled unless strictly controlled | security and compatibility |
| Records | allowed in Java 16+ profile | immutable DTO benefit |

### 7.4 Anti-Pattern

```java
@GET
public UserEntity getUser() {
    return repository.findById(id);
}
```

Problem:

- exposes persistence model,
- triggers lazy loading,
- leaks internal fields,
- couples API to DB schema,
- hard to version.

Better:

```java
@GET
public UserResponse getUser() {
    User user = service.getUser(id);
    return mapper.toResponse(user);
}
```

---

## 8. Modul 4 — Error Contract

### 8.1 Goal

Error contract harus:

- konsisten,
- tidak membocorkan stack trace,
- punya correlation ID,
- bisa dibaca manusia,
- bisa diproses client,
- bisa dipakai audit/incident review.

### 8.2 Problem Details Shape

Gunakan bentuk seperti RFC 9457/Problem Details secara pragmatis:

```json
{
  "type": "https://api.company.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "The request contains invalid fields.",
  "instance": "/cases/123/decision",
  "correlationId": "01J9S4KQ7Y...",
  "code": "CASE_VALIDATION_FAILED",
  "errors": [
    {
      "field": "decisionDate",
      "message": "must not be in the future"
    }
  ]
}
```

### 8.3 Exception Taxonomy

```text
Client fault:
  BadRequestException
  ValidationException
  UnsupportedMediaTypeException
  NotAcceptableException

Domain fault:
  CaseNotFoundException
  InvalidStateTransitionException
  DuplicateSubmissionException

Security fault:
  AuthenticationRequiredException
  AuthorizationDeniedException
  TenantAccessDeniedException

Dependency fault:
  RemoteServiceTimeoutException
  RemoteServiceUnavailableException
  DatabaseUnavailableException

Server fault:
  UnexpectedRuntimeException
  SerializationFailure
  ConfigurationBug
```

### 8.4 Mapper Layering

```java
@Provider
public final class DomainExceptionMapper implements ExceptionMapper<DomainException> {
    @Context UriInfo uriInfo;
    @Context HttpHeaders headers;

    @Override
    public Response toResponse(DomainException exception) {
        Problem problem = Problem.builder()
            .type("https://api.company.com/problems/domain-error")
            .title(exception.safeTitle())
            .status(exception.httpStatus())
            .detail(exception.safeDetail())
            .instance(uriInfo.getRequestUri().getPath())
            .correlationId(Correlation.currentId())
            .code(exception.code())
            .build();

        return Response.status(exception.httpStatus())
            .type("application/problem+json")
            .entity(problem)
            .build();
    }
}
```

Generic fallback:

```java
@Provider
public final class UnexpectedExceptionMapper implements ExceptionMapper<Throwable> {

    @Override
    public Response toResponse(Throwable exception) {
        String correlationId = Correlation.currentId();
        log.error("Unhandled exception correlationId={}", correlationId, exception);

        Problem problem = Problem.builder()
            .type("https://api.company.com/problems/internal-server-error")
            .title("Internal server error")
            .status(500)
            .detail("An unexpected error occurred.")
            .correlationId(correlationId)
            .code("INTERNAL_SERVER_ERROR")
            .build();

        return Response.serverError()
            .type("application/problem+json")
            .entity(problem)
            .build();
    }
}
```

### 8.5 Top 1% Discipline

A weaker engineer asks:

> What exception should I throw?

A stronger engineer asks:

> What failure category is this, who can act on it, what should be exposed to client, what must be logged, and how will this be correlated during incident review?

---

## 9. Modul 5 — Correlation ID and Request Context

### 9.1 Goal

Every inbound request should have:

- correlation ID,
- request ID,
- authenticated actor,
- tenant/agency context if applicable,
- source channel,
- client app ID if applicable.

### 9.2 Request Filter

```java
@Provider
@Priority(Priorities.AUTHENTICATION - 100)
public final class CorrelationIdFilter implements ContainerRequestFilter, ContainerResponseFilter {

    public static final String HEADER = "X-Correlation-Id";

    @Override
    public void filter(ContainerRequestContext request) {
        String incoming = request.getHeaderString(HEADER);
        String correlationId = isValid(incoming) ? incoming : generateId();

        request.setProperty("correlationId", correlationId);
        Correlation.set(correlationId);
        MDC.put("correlationId", correlationId);
    }

    @Override
    public void filter(ContainerRequestContext request, ContainerResponseContext response) {
        Object id = request.getProperty("correlationId");
        if (id != null) {
            response.getHeaders().putSingle(HEADER, id.toString());
        }
        MDC.remove("correlationId");
        Correlation.clear();
    }

    private static boolean isValid(String value) {
        return value != null && value.length() <= 128 && value.matches("[A-Za-z0-9._:-]+ ".trim());
    }

    private static String generateId() {
        return UUID.randomUUID().toString();
    }
}
```

### 9.3 Request Context Object

```java
public final class RequestContext {
    private final String correlationId;
    private final String requestId;
    private final Actor actor;
    private final String tenantId;
    private final Instant receivedAt;

    // constructor + getters
}
```

Bind with HK2 factory:

```java
public final class PlatformBinder extends AbstractBinder {
    private final ApiPlatformConfig config;

    public PlatformBinder(ApiPlatformConfig config) {
        this.config = config;
    }

    @Override
    protected void configure() {
        bind(config).to(ApiPlatformConfig.class);
        bindFactory(RequestContextFactory.class)
            .to(RequestContext.class)
            .in(RequestScoped.class);
    }
}
```

---

## 10. Modul 6 — Security Context

### 10.1 Goal

Security platform harus memastikan:

- authentication dilakukan sebelum resource method,
- identity normalized,
- role/permission jelas,
- tenant isolation tidak bergantung pada client input mentah,
- security failure masuk error contract aman,
- audit punya actor yang reliable.

### 10.2 Authentication Filter

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public final class JwtAuthenticationFilter implements ContainerRequestFilter {

    private final TokenVerifier tokenVerifier;

    public JwtAuthenticationFilter(TokenVerifier tokenVerifier) {
        this.tokenVerifier = tokenVerifier;
    }

    @Override
    public void filter(ContainerRequestContext request) {
        String header = request.getHeaderString(HttpHeaders.AUTHORIZATION);
        if (header == null || !header.startsWith("Bearer ")) {
            throw new NotAuthorizedException("Bearer");
        }

        String token = header.substring("Bearer ".length());
        AuthenticatedActor actor = tokenVerifier.verify(token);

        SecurityContext original = request.getSecurityContext();
        request.setSecurityContext(new PlatformSecurityContext(actor, original.isSecure(), original.getAuthenticationScheme()));
        request.setProperty("actor", actor);
    }
}
```

### 10.3 Authorization Is Not Only Role Check

Role checks answer:

```text
Can this type of user call this operation?
```

Object-level authorization answers:

```text
Can this actor access this specific case/document/decision/tenant record?
```

Example:

```java
public DecisionResponse approve(String caseId, ApproveDecisionRequest request, RequestContext ctx) {
    CaseAggregate caze = caseRepository.get(caseId);

    authorizationService.assertCanApprove(ctx.actor(), caze);

    Decision decision = caze.approve(request.reason(), ctx.actor(), ctx.receivedAt());
    caseRepository.save(caze);

    return mapper.toResponse(decision);
}
```

### 10.4 Confused Deputy Prevention

Do not trust:

```json
{
  "agencyId": "CEA",
  "userId": "someone-else"
}
```

as authority.

Trust:

- verified token claims,
- server-side session,
- server-side role mapping,
- server-side tenant mapping,
- data ownership checks.

---

## 11. Modul 7 — Validation Strategy

### 11.1 Goal

Validation module harus membedakan:

```text
Transport/request validation:
  syntactic correctness of input

Application validation:
  use-case precondition

Domain validation:
  invariant that must always hold

Persistence validation:
  database constraint and uniqueness enforcement
```

### 11.2 Validation Error Mapper

```java
@Provider
public final class ConstraintViolationMapper implements ExceptionMapper<ConstraintViolationException> {

    @Override
    public Response toResponse(ConstraintViolationException exception) {
        List<FieldError> errors = exception.getConstraintViolations().stream()
            .map(v -> new FieldError(normalizePath(v.getPropertyPath()), v.getMessage()))
            .sorted(Comparator.comparing(FieldError::field))
            .toList();

        Problem problem = Problem.builder()
            .type("https://api.company.com/problems/validation-error")
            .title("Validation failed")
            .status(400)
            .detail("The request contains invalid fields.")
            .code("VALIDATION_FAILED")
            .correlationId(Correlation.currentId())
            .errors(errors)
            .build();

        return Response.status(400)
            .type("application/problem+json")
            .entity(problem)
            .build();
    }
}
```

### 11.3 Partial Update Trap

PUT and PATCH must not use the same validation assumptions.

```text
PUT:
  replacement semantics
  required fields usually required

PATCH:
  partial mutation semantics
  absent means unchanged
  null may mean clear field or may be invalid
```

A strong platform should provide distinct DTO conventions:

```java
public final class UpdateCaseRequest {
    @NotBlank
    private String title;
}

public final class PatchCaseRequest {
    private OptionalField<String> title;
}
```

---

## 12. Modul 8 — Idempotency

### 12.1 Problem

Client retries can duplicate mutation.

Examples:

- create case,
- submit appeal,
- approve decision,
- upload document metadata,
- trigger external payment,
- send email.

If client times out after server commits, retry can create duplicate effects.

### 12.2 Idempotency Key Filter

```java
@Provider
@Priority(Priorities.USER)
@IdempotentOperation
public final class IdempotencyFilter implements ContainerRequestFilter, ContainerResponseFilter {

    private final IdempotencyStore store;

    @Override
    public void filter(ContainerRequestContext request) throws IOException {
        String key = request.getHeaderString("Idempotency-Key");
        if (key == null || key.isBlank()) {
            throw new BadRequestException("Missing Idempotency-Key");
        }

        String fingerprint = requestFingerprint(request);
        IdempotencyRecord existing = store.find(key);

        if (existing != null) {
            if (!existing.fingerprint().equals(fingerprint)) {
                throw new ConflictException("Idempotency-Key reused with different request");
            }
            request.abortWith(replay(existing));
            return;
        }

        store.reserve(key, fingerprint, Correlation.currentId());
        request.setProperty("idempotencyKey", key);
    }

    @Override
    public void filter(ContainerRequestContext request, ContainerResponseContext response) {
        Object key = request.getProperty("idempotencyKey");
        if (key != null && response.getStatus() >= 200 && response.getStatus() < 300) {
            store.complete(key.toString(), responseSnapshot(response));
        }
    }
}
```

### 12.3 Design Caveat

Capturing response body in `ContainerResponseFilter` is non-trivial because entity serialization may not yet have happened. Safer designs:

1. Application service stores operation result by idempotency key.
2. Resource returns deterministic result fetched from operation record.
3. Idempotency filter only validates/reserves key.

Do not over-engineer response replay in filter unless you control buffering carefully.

---

## 13. Modul 9 — Audit Hook

### 13.1 Goal

Audit is not normal logging.

Logging answers:

```text
What happened technically?
```

Audit answers:

```text
Who did what, when, on which object, under what authority, with what significant input, producing what business outcome?
```

### 13.2 Audit Event Shape

```json
{
  "eventId": "01J9...",
  "correlationId": "01J9...",
  "actorId": "user-123",
  "actorType": "OFFICER",
  "tenantId": "CEA",
  "action": "CASE_APPROVED",
  "resourceType": "CASE",
  "resourceId": "CASE-2026-0001",
  "authority": ["CASE_APPROVER"],
  "occurredAt": "2026-06-16T10:15:30Z",
  "outcome": "SUCCESS",
  "metadata": {
    "previousState": "PENDING_APPROVAL",
    "newState": "APPROVED"
  }
}
```

### 13.3 Annotation-Based Audit Intent

```java
@NameBinding
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.TYPE, ElementType.METHOD})
public @interface Audited {
    String action();
    String resourceType();
}
```

```java
@POST
@Path("/{caseId}/approve")
@Audited(action = "CASE_APPROVED", resourceType = "CASE")
public DecisionResponse approve(@PathParam("caseId") String caseId, ApproveRequest request) {
    return service.approve(caseId, request);
}
```

### 13.4 Warning

A filter can observe HTTP request/response. It cannot always infer domain outcome correctly.

Best design:

- filter captures envelope,
- service emits domain audit event,
- transaction commits audit consistently with business outcome,
- async audit publisher handles external delivery.

---

## 14. Modul 10 — Observability

### 14.1 Logs

Recommended structured log fields:

```text
timestamp
level
service
environment
correlationId
requestId
actorId or anonymous marker
tenantId
method
pathTemplate
status
latencyMs
errorCode
exceptionClass
remoteDependency
```

Do not log:

- access token,
- password,
- session cookie,
- full ID number,
- full document content,
- sensitive PII,
- cryptographic secret.

### 14.2 Metrics

Core server metrics:

```text
http.server.requests.count
http.server.requests.duration
http.server.requests.in_flight
http.server.errors.count
http.server.request.size
http.server.response.size
```

Dimensions should be controlled:

```text
method
route template
status class
exception category
```

Avoid high-cardinality labels:

```text
userId
caseId
full URL with query
raw exception message
```

### 14.3 Tracing

Trace structure:

```text
server span: POST /cases/{caseId}/approve
  validation span
  authorization span
  service span
  db span
  outbound client span
  audit span
```

For Jersey Client, propagate:

- `traceparent`,
- correlation ID,
- request ID if required.

### 14.4 Slow Endpoint Diagnosis

When endpoint is slow, separate:

```text
request queue time
resource method time
validation time
authorization time
DB time
outbound HTTP time
serialization time
response write time
```

Many teams only measure resource method duration and miss serialization/streaming/proxy behavior.

---

## 15. Modul 11 — Jersey Client Factory

### 15.1 Goal

Never let each team create Jersey Client ad hoc.

Bad:

```java
Client client = ClientBuilder.newClient();
Response r = client.target(url).request().get();
```

Problems:

- no timeout,
- no pooling policy,
- no TLS policy,
- no correlation propagation,
- no metrics,
- no response closing discipline,
- no consistent error mapping.

### 15.2 Platform Client Factory

```java
public final class PlatformJerseyClientFactory {

    private final ClientConfig config;
    private final List<Object> commonProviders;

    public Client create(String dependencyName, DependencyClientConfig dependencyConfig) {
        org.glassfish.jersey.client.ClientConfig jerseyConfig = new org.glassfish.jersey.client.ClientConfig();

        jerseyConfig.property(ClientProperties.CONNECT_TIMEOUT, dependencyConfig.connectTimeoutMillis());
        jerseyConfig.property(ClientProperties.READ_TIMEOUT, dependencyConfig.readTimeoutMillis());

        commonProviders.forEach(jerseyConfig::register);
        jerseyConfig.register(new OutboundCorrelationFilter());
        jerseyConfig.register(new OutboundMetricsFilter(dependencyName));
        jerseyConfig.register(new OutboundErrorMappingFilter(dependencyName));

        return ClientBuilder.newBuilder()
            .withConfig(jerseyConfig)
            .sslContext(dependencyConfig.sslContext())
            .hostnameVerifier(dependencyConfig.hostnameVerifier())
            .build();
    }
}
```

### 15.3 Response Closing Pattern

```java
public CustomerResponse getCustomer(String id) {
    try (Response response = target.path("/customers/{id}")
        .resolveTemplate("id", id)
        .request(MediaType.APPLICATION_JSON_TYPE)
        .get()) {

        if (response.getStatus() == 404) {
            throw new CustomerNotFoundException(id);
        }
        if (response.getStatusInfo().getFamily() != Response.Status.Family.SUCCESSFUL) {
            throw mapRemoteError(response);
        }
        return response.readEntity(CustomerResponse.class);
    }
}
```

### 15.4 Resilience Wrapper

The platform should expose higher-level dependency client pattern:

```java
public interface RemoteCustomerClient {
    CustomerResponse getCustomer(String id);
}
```

Internally:

```text
Jersey Client
  -> timeout
  -> retry if safe
  -> circuit breaker
  -> bulkhead
  -> remote error mapper
  -> metrics/traces
```

---

## 16. Modul 12 — Health and Readiness

### 16.1 Health Resource

```java
@Path("/internal/health")
public final class HealthResource {

    @GET
    @Path("/live")
    public Response live() {
        return Response.ok(Map.of("status", "UP")).build();
    }

    @GET
    @Path("/ready")
    public Response ready() {
        ReadinessStatus status = readiness.check();
        return Response.status(status.up() ? 200 : 503)
            .entity(status)
            .build();
    }
}
```

### 16.2 Readiness Should Check

- required config loaded,
- DB connectivity if service cannot operate without DB,
- critical cache only if hard dependency,
- outbound dependency only if startup truly requires it,
- migration state if relevant.

Do not make readiness depend on optional external systems unless you want rolling outage during dependency outage.

---

## 17. Modul 13 — Testing Harness

### 17.1 Why Platform Testing Is Different

Testing resource class directly is not enough. Platform module must test runtime behavior:

- provider selection,
- mapper selection,
- filter order,
- security context injection,
- request/response headers,
- JSON serialization,
- validation error shape,
- correlation propagation,
- outbound client behavior.

### 17.2 Base Test Class

```java
public abstract class PlatformJerseyTest extends JerseyTest {

    @Override
    protected Application configure() {
        ApiPlatformConfig config = testConfig();

        ResourceConfig rc = new ResourceConfig();
        rc.register(new ApiPlatformFeature(config));
        registerResources(rc);
        return rc;
    }

    protected ApiPlatformConfig testConfig() {
        return ApiPlatformConfig.testDefaults();
    }

    protected abstract void registerResources(ResourceConfig rc);
}
```

### 17.3 Contract Tests

Example assertions:

```java
@Test
void validationErrorHasStableShape() {
    Response response = target("/cases")
        .request()
        .post(Entity.json("{}"));

    assertEquals(400, response.getStatus());

    Problem problem = response.readEntity(Problem.class);
    assertEquals("VALIDATION_FAILED", problem.code());
    assertNotNull(problem.correlationId());
    assertFalse(problem.errors().isEmpty());
}
```

### 17.4 Failure Mode Test Matrix

| Scenario | Expected |
|---|---|
| missing auth | 401 Problem |
| invalid role | 403 Problem |
| validation fail | 400 Problem with fields |
| malformed JSON | 400 Problem |
| unsupported content type | 415 Problem |
| unacceptable accept header | 406 Problem |
| unknown route | 404 Problem |
| method mismatch | 405 Problem |
| domain conflict | 409 Problem |
| unexpected exception | 500 Problem without stack trace |
| outbound timeout | 504/502 mapped dependency error |
| duplicate idempotency key | replay or conflict |

---

## 18. Modul 14 — Migration Compatibility Layer

### 18.1 Goal

Migration should be designed, not improvised.

Platform module should provide:

```text
platform-jersey2-java8
platform-jersey3-jakarta10
platform-jersey4-jakarta11
```

or at least profile-specific build variants.

### 18.2 Namespace Boundary

Do not expose `javax.ws.rs` or `jakarta.ws.rs` types deep into business modules if you want easier migration.

Bad:

```java
public interface CaseService {
    Response approve(String caseId, ApproveRequest request);
}
```

Better:

```java
public interface CaseService {
    DecisionResult approve(ApproveCommand command);
}
```

Let Jersey adapter translate HTTP `Response`.

### 18.3 Migration Checklist

```text
Dependency inventory:
  jersey-server
  jersey-container-servlet
  jersey-hk2
  jersey-media-json-jackson
  jersey-client
  jersey-test-framework
  validation
  servlet
  jackson
  logging bridge
  metrics/tracing

Namespace scan:
  javax.ws.rs
  javax.servlet
  javax.validation
  javax.annotation
  javax.inject

Runtime scan:
  app server version
  servlet container version
  Java baseline
  classpath conflict
  shaded jars
  transitive dependencies

Behavior regression:
  route matching
  JSON serialization
  validation error
  exception mapper
  filters/interceptors order
  client timeout
  multipart upload
  SSE if used
```

---

## 19. Full Request Lifecycle In The Final Platform

The target request lifecycle:

```text
HTTP request enters container
  -> Jersey application mapping
  -> correlation filter
  -> authentication filter
  -> request logging start
  -> security context creation
  -> idempotency reserve if mutation
  -> resource matching
  -> parameter conversion
  -> entity MessageBodyReader
  -> validation
  -> resource method
  -> application service
       -> authorization
       -> transaction
       -> domain invariant
       -> repository/outbound clients
       -> domain audit event
  -> resource response mapping
  -> MessageBodyWriter
  -> response filters
       -> audit envelope
       -> metrics
       -> correlation response header
       -> request logging end
  -> HTTP response leaves container
```

A top-tier engineer can locate failures along this lifecycle without guessing.

---

## 20. Example End-to-End Resource

```java
@Path("/cases")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public final class CaseResource {

    private final CaseApplicationService service;
    private final CaseApiMapper mapper;

    @Context
    private RequestContext requestContext;

    public CaseResource(CaseApplicationService service, CaseApiMapper mapper) {
        this.service = service;
        this.mapper = mapper;
    }

    @POST
    @IdempotentOperation
    @Audited(action = "CASE_CREATED", resourceType = "CASE")
    public Response create(@Valid CreateCaseRequest request, @Context UriInfo uriInfo) {
        CreateCaseCommand command = mapper.toCommand(request, requestContext);
        CaseResult result = service.create(command);

        URI location = uriInfo.getAbsolutePathBuilder()
            .path(result.caseId())
            .build();

        return Response.created(location)
            .entity(mapper.toResponse(result))
            .build();
    }

    @GET
    @Path("/{caseId}")
    public CaseResponse get(@PathParam("caseId") String caseId) {
        CaseResult result = service.get(caseId, requestContext);
        return mapper.toResponse(result);
    }

    @POST
    @Path("/{caseId}/approve")
    @Audited(action = "CASE_APPROVED", resourceType = "CASE")
    public DecisionResponse approve(
        @PathParam("caseId") String caseId,
        @Valid ApproveCaseRequest request
    ) {
        ApproveCaseCommand command = mapper.toCommand(caseId, request, requestContext);
        DecisionResult result = service.approve(command);
        return mapper.toResponse(result);
    }
}
```

Notice what is absent:

- no manual try/catch for all errors,
- no manual logging boilerplate,
- no token parsing,
- no JSON mapper manipulation,
- no manual correlation header,
- no direct persistence entity exposure,
- no remote HTTP details.

The platform owns runtime policy.

The resource owns HTTP adaptation.

The service owns use-case behavior.

The domain owns invariants.

---

## 21. Production Readiness Checklist

### 21.1 Bootstrap

```text
[ ] ResourceConfig explicit
[ ] Provider registration explicit
[ ] Auto-discovery policy decided
[ ] Startup config validation
[ ] Dependency version locked
[ ] javax/jakarta namespace clean
[ ] Startup diagnostics available
```

### 21.2 Error Contract

```text
[ ] Problem/error shape stable
[ ] Correlation ID included
[ ] No stack trace leaked
[ ] Domain errors mapped
[ ] Validation errors mapped
[ ] Security errors mapped
[ ] Dependency errors mapped
[ ] Fallback mapper exists
[ ] Mapper precedence tested
```

### 21.3 Security

```text
[ ] Authentication filter priority correct
[ ] SecurityContext set
[ ] Principal normalized
[ ] Role mapping tested
[ ] Object-level authorization implemented
[ ] Tenant isolation enforced server-side
[ ] Security failures audit-safe
```

### 21.4 Observability

```text
[ ] Correlation ID inbound/outbound
[ ] MDC cleanup guaranteed
[ ] Request log structured
[ ] Sensitive data masked
[ ] Metrics low-cardinality
[ ] Traces propagated
[ ] Jersey Client instrumented
[ ] Slow endpoint diagnostic fields available
```

### 21.5 Client

```text
[ ] Client reused
[ ] Timeout configured
[ ] Response closed
[ ] TLS configured
[ ] Retry only for safe cases
[ ] Circuit breaker/bulkhead considered
[ ] Remote error mapped
[ ] Correlation propagated
```

### 21.6 Data and Payload

```text
[ ] DTO only, no entity exposure
[ ] JSON ObjectMapper stable
[ ] Date/time policy stable
[ ] Unknown/null field policy known
[ ] Multipart size limit
[ ] Streaming for large downloads
[ ] Upload filename sanitized
[ ] MIME/hash/scanner policy defined
```

### 21.7 Testing

```text
[ ] Runtime test uses JerseyTest/container
[ ] Provider test
[ ] Filter order test
[ ] Exception mapper test
[ ] Validation error contract test
[ ] Security context test
[ ] Client timeout/close test
[ ] Contract regression test
[ ] Migration smoke test
```

---

## 22. Common Design Failures and Better Alternatives

| Weak Design | Why It Fails | Better Design |
|---|---|---|
| Every service defines its own error JSON | inconsistent client handling | central error module |
| Resource catches all exceptions | hides taxonomy | exception mappers |
| New Jersey Client per request | connection/pool overhead | singleton/factory-managed client |
| No client timeout | thread exhaustion | mandatory timeout defaults |
| Entity classes returned directly | overexposure/lazy proxy | DTO mapping |
| Logging full body | PII leak | allowlist/masking strategy |
| Role-only authorization | object access bypass | object-level authorization |
| Auto-scanning everything | unpredictable providers | explicit registration |
| Health checks all dependencies | cascading outage | readiness scoped to hard dependencies |
| `Throwable` mapper only | loses semantics | layered mapper taxonomy |
| Retry all POST | duplicate mutation | idempotency key + safe retry rules |
| ThreadLocal without cleanup | context leak | response filter cleanup/finally discipline |

---

## 23. What “Top 1%” Looks Like In Jersey Work

A top-tier engineer does not merely know annotations.

They can answer these questions under pressure:

1. Why did this request resolve to this resource method?
2. Why did this request fail with 406 instead of 404?
3. Which MessageBodyWriter handled this response?
4. Which ExceptionMapper won and why?
5. Did the request body stream get consumed twice?
6. Is this dependency timeout bounded?
7. Can this retry duplicate a command?
8. Is this actor authorized for this object, not only this endpoint?
9. Does this error message leak internal state?
10. Can we correlate this outbound call with the inbound request?
11. Will this endpoint survive large payloads?
12. Will migration from Jersey 2 to 3/4 break namespace or provider behavior?
13. Are we measuring resource method time or full response time?
14. Is readiness making deployment safer or causing cascading failure?
15. Which layer owns this invariant?

The difference is not memorization. It is runtime and boundary reasoning.

---

## 24. Final Blueprint Diagram

```text
company-jersey-platform

  Bootstrap
    ApiPlatformFeature
    ResourceConfig conventions
    startup validation

  Runtime Context
    CorrelationIdFilter
    RequestContextFactory
    SecurityContext bridge

  Serialization
    JsonFeature
    ObjectMapper policy
    DTO compatibility rules

  Error
    Problem model
    ExceptionMapper taxonomy
    Validation mapper
    Security mapper
    Dependency mapper
    Fallback mapper

  Security
    Authentication filter
    Principal normalization
    Role/permission bridge
    Tenant context

  Observability
    Structured request log
    Metrics filters
    Tracing propagation
    Sensitive data masking

  Integration
    Jersey Client factory
    Timeout policy
    Retry/circuit/bulkhead wrapper
    Remote error mapper

  Business Boundary Support
    Idempotency annotation/filter
    Audit annotation/hook
    URI/link utilities

  Testing
    JerseyTest base
    contract assertions
    failure mode test suite

  Migration
    Java/Jersey/Jakarta profile
    dependency convergence check
    namespace scanner
```

---

## 25. Capstone Exercise

Build a small internal platform module with these deliverables:

```text
1. ApiPlatformFeature
2. ApiPlatformConfig
3. CorrelationIdFilter
4. Problem model
5. ExceptionMapper taxonomy
6. ConstraintViolation mapper
7. Jackson JsonFeature
8. JwtAuthenticationFilter stub
9. RequestContext injection
10. Audit annotation
11. Idempotency annotation
12. Jersey Client factory
13. HealthResource
14. PlatformJerseyTest base
15. Failure mode test matrix
```

Then build one sample service:

```text
case-api
  POST /cases
  GET /cases/{caseId}
  POST /cases/{caseId}/approve
  GET /cases/{caseId}/documents/{documentId}/download
```

Test:

```text
[ ] valid create
[ ] invalid JSON
[ ] validation fail
[ ] missing auth
[ ] forbidden object access
[ ] duplicate idempotency key
[ ] domain conflict
[ ] outbound timeout
[ ] download streaming
[ ] correlation header response
```

---

## 26. Series Closure

This is the final part of:

```text
learn-java-jersey-runtime-resource-client-extension-engineering
```

You have now covered Jersey not merely as an API framework, but as a production runtime surface:

- inbound HTTP boundary,
- outbound HTTP client layer,
- serialization pipeline,
- exception architecture,
- security context,
- validation contract,
- audit/logging/metrics/tracing,
- extension design,
- migration strategy,
- operational failure diagnosis,
- enterprise architecture boundary.

The practical next step is not to learn more annotations. The next step is to build a small platform module and force every concept to pass through tests, failure scenarios, and deployment constraints.

That is where Jersey knowledge becomes engineering capability.

---

## 27. Final Mental Model

A weak Jersey application is a set of annotated methods.

A strong Jersey application is a runtime boundary with explicit policies.

A production-grade Jersey platform is a reusable system that makes the safe path the default path:

```text
explicit bootstrap
  + stable contracts
  + secure context
  + bounded outbound calls
  + observable runtime
  + tested failure behavior
  + migration discipline
  = maintainable enterprise API platform
```

That is the end-state of this series.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 31 — Architecture Patterns: Jersey as API Boundary in Enterprise Systems](./31-architecture-patterns-jersey-as-api-boundary-enterprise-systems.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: 00 — Orientation: Data Transformation as Software Boundary](../../mapper/00-orientation-data-transformation-as-software-boundary.md)

</div>