# Part 28 — Multi-Tenancy, Multi-Module, and Enterprise Platform Patterns

> Series: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `28-multitenancy-enterprise-platform-patterns.md`  
> Status: Part 28 of 35 — not final part  
> Target audience: senior Java/Spring engineers, tech leads, platform engineers, architects, and engineers building enterprise/regulatory systems with strong isolation, auditability, and operational constraints.

---

## 0. Why This Part Exists

Multi-tenancy looks deceptively simple from the outside:

```text
request comes in
→ identify tenant
→ query tenant data
→ return response
```

But in a real Spring system, tenant identity is not only a request parameter. It affects:

1. authentication and authorization,
2. datasource selection,
3. schema selection,
4. cache keys,
5. scheduled jobs,
6. async execution,
7. messaging,
8. outbound integration,
9. audit records,
10. observability tags,
11. feature availability,
12. configuration lookup,
13. data migration,
14. support tooling,
15. incident blast radius.

A weak multi-tenancy design usually fails in one of these ways:

```text
Tenant A can see Tenant B data.
Tenant A's cache result leaks into Tenant B.
Tenant context disappears inside @Async.
A scheduled job runs for all tenants accidentally.
An admin endpoint bypasses tenant checks.
A batch job migrates the wrong tenant schema.
A feature flag enables behavior globally instead of per tenant.
A support user performs an action under ambiguous tenant context.
A log/audit record cannot prove which tenant was affected.
```

This part treats multi-tenancy as an **enterprise isolation model**, not as a Hibernate trick.

Spring gives the building blocks:

- `Filter`, `HandlerInterceptor`, `ArgumentResolver`, and Spring Security filters for tenant resolution.
- `ThreadLocal`, Reactor `Context`, request attributes, and task decorators for context propagation.
- `AbstractRoutingDataSource` for datasource routing.
- Spring Data and Hibernate integration for database/schema/discriminator strategies.
- Spring Security multi-tenant resource server patterns for resolving and propagating tenant identity.
- Spring Boot configuration, auto-configuration, Actuator, Micrometer, and testing facilities for platform-grade guardrails.

But Spring does **not** automatically decide your isolation model. That is the architect's job.

---

## 1. Core Definition: What Is a Tenant?

A tenant is not always a company.

Depending on the system, a tenant can be:

| Domain | Tenant Example |
|---|---|
| SaaS | customer organization |
| government platform | agency, department, statutory board |
| regulatory system | regulated entity, licensee, agency, jurisdiction |
| banking | legal entity, branch, region, client institution |
| internal platform | business unit, product group, project |
| marketplace | seller, merchant, partner |
| education | school, campus, district |

The wrong first assumption is:

```text
one tenant = one database
```

That may be true in one architecture, but a tenant is first a **logical isolation boundary**. Storage layout is an implementation decision.

Better definition:

```text
A tenant is a logical boundary that determines which identity, data, configuration,
features, policies, operational limits, integrations, and audit trails apply to a request,
job, message, or administrative action.
```

That definition matters because a tenant boundary must apply even when no HTTP request exists.

Examples:

```text
HTTP request           → tenant from host/header/token/path
Kafka message          → tenant from message header/payload envelope
scheduled job          → tenant from explicit iteration over tenant registry
batch migration        → tenant from job parameter
admin action           → tenant selected by privileged operator with audit reason
outbound webhook       → tenant from originating aggregate/event
support script         → tenant from mandatory command argument
```

If tenant identity is only extracted from HTTP headers, the system is not truly tenant-aware. It is only request-aware.

---

## 2. Mental Model: Tenant Context as a First-Class Runtime Context

In Spring, several runtime contexts already exist:

```text
SecurityContext
TransactionContext
LocaleContext
RequestContext
MDC / logging context
Observation / tracing context
Reactor Context
```

A serious multi-tenant system usually needs one more:

```text
TenantContext
```

The tenant context answers:

```text
Who is the tenant for the current unit of work?
Where did the tenant identity come from?
Was it verified?
What authority allows this actor to operate in that tenant?
What tenant-scoped policies/configurations apply?
```

A minimal tenant context should not be just a string.

Bad:

```java
public final class TenantContext {
    private static final ThreadLocal<String> TENANT = new ThreadLocal<>();
}
```

Better:

```java
public record TenantContext(
        TenantId tenantId,
        TenantResolutionSource source,
        boolean verified,
        String issuer,
        String actorId,
        String correlationId
) {}
```

Even better for enterprise systems:

```java
public record TenantContext(
        TenantId tenantId,
        TenantType tenantType,
        TenantResolutionSource source,
        TenantTrustLevel trustLevel,
        ActorRef actor,
        Set<String> tenantRoles,
        String issuer,
        String authenticationMethod,
        String correlationId,
        Instant resolvedAt
) {}
```

Where:

```java
enum TenantResolutionSource {
    HOSTNAME,
    PATH,
    HEADER,
    TOKEN_CLAIM,
    SESSION,
    MESSAGE_HEADER,
    JOB_PARAMETER,
    ADMIN_SELECTION,
    SYSTEM_TASK
}

enum TenantTrustLevel {
    UNTRUSTED_INPUT,
    AUTHENTICATED_CLAIM,
    AUTHORIZED_SELECTION,
    SYSTEM_INTERNAL
}
```

The important invariant:

```text
A tenant context is valid only after resolution, verification, and authorization.
```

Resolution alone is not enough.

If a request says:

```http
X-Tenant-Id: agency-a
```

that only means the caller **claimed** tenant `agency-a`. The system still must verify whether the authenticated actor may operate under `agency-a`.

---

## 3. Tenant Resolution vs Tenant Authorization

These two are often confused.

### 3.1 Tenant Resolution

Tenant resolution answers:

```text
Which tenant is being requested?
```

Sources:

```text
subdomain: agency-a.example.com
path: /tenants/agency-a/cases
header: X-Tenant-Id: agency-a
token claim: tenant_id=agency-a
issuer: https://idp.example.com/agency-a
session attribute: selectedTenant=agency-a
message header: tenant-id=agency-a
job parameter: tenantId=agency-a
```

### 3.2 Tenant Authorization

Tenant authorization answers:

```text
Is this actor allowed to operate on this tenant in this operation?
```

That depends on:

```text
actor identity
actor type
roles/authorities
organization membership
delegation
support/admin privilege
operation type
target tenant
target resource
current workflow state
policy version
```

### 3.3 The Critical Invariant

```text
Never treat tenant resolution as tenant authorization.
```

Bad flow:

```text
Read X-Tenant-Id
→ set TenantContext
→ query tenant data
```

Better flow:

```text
Authenticate actor
→ resolve requested tenant
→ verify actor belongs to / may administer tenant
→ set verified TenantContext
→ proceed
```

For Spring Security based systems, tenant resolution usually must happen close to authentication and authorization. Spring Security's resource server multi-tenancy documentation frames this as two linked concerns: resolve the tenant and propagate the tenant.

---

## 4. Tenant Resolution Patterns in Spring MVC

### 4.1 Host/Subdomain-Based Tenant

Example:

```text
agency-a.platform.gov.example
agency-b.platform.gov.example
```

Pros:

- natural SaaS UX,
- strong tenant boundary at routing layer,
- works well with per-tenant branding,
- can be integrated with ingress/gateway rules.

Cons:

- wildcard DNS/TLS complexity,
- local development overhead,
- harder for internal admin tools that switch tenant,
- tenant renaming affects DNS.

Spring implementation:

```java
public final class HostTenantResolver implements TenantResolver {

    @Override
    public TenantId resolve(HttpServletRequest request) {
        String host = request.getServerName();
        String subdomain = host.split("\\.")[0];
        return TenantId.of(subdomain);
    }
}
```

But production code must validate the host:

```java
public final class HostTenantResolver implements TenantResolver {

    private final TenantRegistry tenantRegistry;
    private final AllowedHostPolicy allowedHostPolicy;

    public TenantResolution resolve(HttpServletRequest request) {
        String host = request.getServerName();

        if (!allowedHostPolicy.isAllowed(host)) {
            return TenantResolution.rejected("host_not_allowed");
        }

        Optional<TenantId> tenantId = tenantRegistry.findByHost(host);
        return tenantId
                .map(id -> TenantResolution.unverified(id, TenantResolutionSource.HOSTNAME))
                .orElseGet(() -> TenantResolution.rejected("unknown_tenant_host"));
    }
}
```

### 4.2 Path-Based Tenant

Example:

```text
/tenants/agency-a/cases/123
/tenants/agency-b/cases/456
```

Pros:

- explicit,
- easy to test,
- works with one domain,
- useful for admin/support tools.

Cons:

- tenant id appears everywhere,
- more risk of resource-id/tenant mismatch,
- harder to hide tenant identity from URL,
- controller paths become noisier.

Pattern:

```java
@GetMapping("/tenants/{tenantId}/cases/{caseId}")
public CaseResponse getCase(
        @PathVariable TenantId tenantId,
        @PathVariable CaseId caseId
) {
    // tenantId from path is still not authorization
}
```

For large systems, avoid manually passing `tenantId` everywhere from controller to repository. Instead:

```text
controller extracts/validates tenant
→ tenant context established
→ service/repository uses verified context
```

### 4.3 Header-Based Tenant

Example:

```http
X-Tenant-Id: agency-a
```

Pros:

- clean URL,
- good for internal APIs,
- easy for service-to-service calls.

Cons:

- easy to spoof if not protected,
- invisible to browser/user,
- dangerous behind proxies unless gateway normalizes/removes client-supplied headers,
- must be explicitly propagated.

Header-based tenant should be treated as untrusted until verified.

```java
public final class HeaderTenantResolver implements TenantResolver {

    public TenantResolution resolve(HttpServletRequest request) {
        String raw = request.getHeader("X-Tenant-Id");
        if (raw == null || raw.isBlank()) {
            return TenantResolution.missing();
        }
        return TenantResolution.unverified(TenantId.of(raw), TenantResolutionSource.HEADER);
    }
}
```

Gateway rule:

```text
External client-supplied X-Tenant-Id must be stripped unless the gateway itself sets it.
```

### 4.4 Token-Claim-Based Tenant

Example JWT claims:

```json
{
  "sub": "user-123",
  "iss": "https://idp.example.com",
  "tenant_id": "agency-a",
  "roles": ["case.officer"]
}
```

Pros:

- tenant tied to authenticated identity,
- reduces spoofing,
- natural for machine-to-machine calls,
- works with resource server.

Cons:

- users with multiple tenants require tenant selection model,
- stale token can carry outdated tenant membership,
- token claim design becomes critical,
- issuer-per-tenant complicates JWT decoder selection.

Spring Security multi-tenant resource server scenarios usually involve multiple issuers or multiple token verification strategies keyed by tenant identity.

### 4.5 Session-Selected Tenant

Example:

```text
user logs in
→ user has access to tenant A and B
→ user selects tenant A
→ session stores selectedTenant=A
```

Pros:

- good UX for browser apps,
- avoids repeated tenant path/header,
- supports tenant switching.

Cons:

- session state complexity,
- stale selected tenant after membership change,
- more difficult for stateless APIs,
- must audit tenant switch.

Invariant:

```text
Changing selected tenant is an auditable security event.
```

---

## 5. Where to Implement Tenant Resolution in Spring

There are several possible hooks.

| Hook | Best For | Caution |
|---|---|---|
| Servlet Filter | earliest request boundary, security/header normalization | ordering with Spring Security matters |
| Spring Security filter | tenant tied to authentication | requires security architecture discipline |
| HandlerInterceptor | MVC-level tenant context | runs after security filters |
| ArgumentResolver | explicit controller parameter | can be bypassed by services/jobs |
| ControllerAdvice | validation/error enrichment | not primary tenant resolution |
| WebFlux WebFilter | reactive request boundary | must use Reactor context |
| Message listener interceptor | messaging tenant context | must clear after processing |
| TaskDecorator | async context propagation | does not resolve tenant by itself |

### 5.1 Servlet Filter Pattern

```java
public final class TenantContextFilter extends OncePerRequestFilter {

    private final TenantResolver tenantResolver;
    private final TenantVerifier tenantVerifier;

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        TenantResolution resolution = tenantResolver.resolve(request);

        if (resolution.isMissing()) {
            filterChain.doFilter(request, response);
            return;
        }

        TenantVerification verification = tenantVerifier.verify(resolution, request);
        if (!verification.allowed()) {
            response.sendError(HttpServletResponse.SC_FORBIDDEN, "Tenant access denied");
            return;
        }

        try {
            TenantContextHolder.set(verification.context());
            filterChain.doFilter(request, response);
        } finally {
            TenantContextHolder.clear();
        }
    }
}
```

The `finally` block is not optional.

In servlet containers, worker threads are reused. If a tenant context is stored in `ThreadLocal` and not cleared, Tenant A can accidentally affect Tenant B request later on the same thread.

### 5.2 HandlerInterceptor Pattern

```java
public final class TenantInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(
            HttpServletRequest request,
            HttpServletResponse response,
            Object handler
    ) {
        TenantContext context = resolveAndVerify(request);
        TenantContextHolder.set(context);
        return true;
    }

    @Override
    public void afterCompletion(
            HttpServletRequest request,
            HttpServletResponse response,
            Object handler,
            Exception ex
    ) {
        TenantContextHolder.clear();
    }
}
```

This is simpler for MVC apps, but remember:

```text
Spring Security filters run before MVC interceptors.
```

So if authentication needs tenant context, a MVC interceptor may be too late.

### 5.3 ArgumentResolver Pattern

```java
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
public @interface CurrentTenant {}
```

```java
public final class CurrentTenantArgumentResolver implements HandlerMethodArgumentResolver {

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.hasParameterAnnotation(CurrentTenant.class)
                && parameter.getParameterType().equals(TenantContext.class);
    }

    @Override
    public Object resolveArgument(
            MethodParameter parameter,
            ModelAndViewContainer mavContainer,
            NativeWebRequest webRequest,
            WebDataBinderFactory binderFactory
    ) {
        return TenantContextHolder.required();
    }
}
```

Controller:

```java
@GetMapping("/cases/{caseId}")
public CaseResponse getCase(
        @CurrentTenant TenantContext tenant,
        @PathVariable CaseId caseId
) {
    return caseQueryService.getCase(tenant.tenantId(), caseId);
}
```

This is excellent for explicitness, but do not make it the only tenant enforcement layer.

---

## 6. Tenant Context Holder: ThreadLocal, Request Attribute, Reactor Context

### 6.1 ThreadLocal in Servlet MVC

Basic pattern:

```java
public final class TenantContextHolder {

    private static final ThreadLocal<TenantContext> CURRENT = new ThreadLocal<>();

    private TenantContextHolder() {}

    public static void set(TenantContext context) {
        Objects.requireNonNull(context, "context");
        CURRENT.set(context);
    }

    public static Optional<TenantContext> get() {
        return Optional.ofNullable(CURRENT.get());
    }

    public static TenantContext required() {
        TenantContext context = CURRENT.get();
        if (context == null) {
            throw new MissingTenantContextException();
        }
        return context;
    }

    public static void clear() {
        CURRENT.remove();
    }
}
```

Critical rules:

```text
Set once at boundary.
Clear in finally.
Never silently default to a tenant.
Never mutate tenant context midway through a service operation.
Never allow repositories to resolve tenant from HTTP request directly.
```

### 6.2 Request Attribute

Alternative:

```java
request.setAttribute(TenantContext.class.getName(), context);
```

Pros:

- scoped to request,
- no thread reuse leakage,
- explicit at web layer.

Cons:

- not available in service code without web coupling,
- not available in async/job/message contexts,
- awkward outside MVC.

### 6.3 Reactor Context in WebFlux

In reactive applications, `ThreadLocal` is usually the wrong primitive because execution may shift across threads.

Use Reactor `Context`:

```java
public final class TenantWebFilter implements WebFilter {

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        TenantContext tenantContext = resolveAndVerify(exchange);

        return chain.filter(exchange)
                .contextWrite(context -> context.put(TenantContext.class, tenantContext));
    }
}
```

Read it:

```java
public Mono<CaseResponse> getCase(CaseId caseId) {
    return Mono.deferContextual(ctx -> {
        TenantContext tenant = ctx.get(TenantContext.class);
        return caseRepository.findByTenantAndId(tenant.tenantId(), caseId);
    });
}
```

Important:

```text
Do not assume servlet ThreadLocal patterns transfer to WebFlux.
```

### 6.4 Async Context Propagation

Spring `@Async` runs on another thread. ThreadLocal tenant context does not automatically propagate.

Use `TaskDecorator`:

```java
public final class TenantAwareTaskDecorator implements TaskDecorator {

    @Override
    public Runnable decorate(Runnable runnable) {
        Optional<TenantContext> captured = TenantContextHolder.get();

        return () -> {
            try {
                captured.ifPresent(TenantContextHolder::set);
                runnable.run();
            } finally {
                TenantContextHolder.clear();
            }
        };
    }
}
```

Executor config:

```java
@Bean
ThreadPoolTaskExecutor applicationTaskExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(16);
    executor.setMaxPoolSize(64);
    executor.setQueueCapacity(500);
    executor.setTaskDecorator(new TenantAwareTaskDecorator());
    executor.initialize();
    return executor;
}
```

Caution:

```text
Context propagation is not the same as authorization.
```

If an async task performs sensitive action later, it may need to re-check whether the actor still has permission, or store an explicit system command/audit reason instead of blindly inheriting a user context.

---

## 7. Tenant Isolation Models

There are three common data isolation models.

```text
1. Database per tenant
2. Schema per tenant
3. Shared schema with tenant discriminator
```

There are also hybrid models.

### 7.1 Database Per Tenant

```text
Tenant A → jdbc:postgresql://db-a/app
Tenant B → jdbc:postgresql://db-b/app
```

Pros:

- strongest operational isolation,
- easiest backup/restore per tenant,
- easier tenant-specific scaling,
- better blast radius control,
- easier data residency/compliance.

Cons:

- many connection pools,
- many migrations,
- expensive at high tenant count,
- harder cross-tenant analytics,
- more operational metadata.

Spring pattern:

- `AbstractRoutingDataSource`, or
- dynamic datasource registry, or
- tenant-specific `EntityManagerFactory` in extreme cases.

### 7.2 Schema Per Tenant

```text
same database
schema agency_a
schema agency_b
```

Pros:

- moderate isolation,
- easier than database-per-tenant,
- can support tenant-specific backup depending on database,
- good for medium tenant count.

Cons:

- schema switching risk,
- migrations still per schema,
- connection state leakage if schema not reset,
- harder than discriminator model for query tooling.

Spring/Hibernate pattern:

- Hibernate multi-tenancy schema strategy,
- connection provider sets schema based on tenant,
- or datasource routing to schema-specific datasource.

### 7.3 Shared Schema with Tenant Discriminator

```sql
case_record(
    id,
    tenant_id,
    case_number,
    status,
    ...
)
```

Pros:

- simplest operationally,
- one schema migration,
- one connection pool,
- easy shared reporting,
- good for high tenant count with small tenants.

Cons:

- weakest isolation,
- every query must include tenant predicate,
- high risk of missing tenant filter,
- noisy neighbor risk,
- backup/restore per tenant harder,
- indexes must account for tenant.

Spring pattern:

- repository methods include tenant id,
- Hibernate filters or multi-tenancy discriminator where appropriate,
- database row-level security where possible,
- query review/testing guardrails.

### 7.4 Hybrid Model

Example:

```text
large regulated tenants → database per tenant
small tenants           → shared database with tenant_id
highly sensitive module → isolated schema
common catalog          → shared global schema
```

Hybrid is realistic, but dangerous without clear classification.

You need:

```text
tenant tier
storage strategy
data residency
migration strategy
backup policy
observability grouping
cost allocation
support procedure
```

---

## 8. Choosing the Isolation Model

Decision matrix:

| Criterion | DB per Tenant | Schema per Tenant | Shared Schema / Discriminator |
|---|---:|---:|---:|
| data isolation | strongest | medium | weakest |
| operational simplicity | low | medium | high |
| per-tenant backup | easiest | medium | hard |
| migration complexity | high | medium/high | low |
| connection pool cost | high | medium | low |
| tenant count scalability | low/medium | medium | high |
| noisy neighbor isolation | strong | medium | weak |
| cross-tenant analytics | hard | medium | easiest |
| query safety burden | lower | medium | highest |
| compliance fit | strong | medium | depends |

A practical rule:

```text
Use database-per-tenant when legal/compliance/blast-radius isolation dominates.
Use shared-schema when tenant count and operational simplicity dominate.
Use schema-per-tenant when you need moderate isolation but cannot afford full DB isolation.
```

For regulatory/case-management systems, tenant often maps to agency/jurisdiction. In that domain, auditability and cross-tenant access control frequently matter more than raw cost minimization.

---

## 9. Database Per Tenant with AbstractRoutingDataSource

Spring Framework provides `AbstractRoutingDataSource`, which routes `getConnection()` calls to a target datasource based on a lookup key.

### 9.1 Basic Routing Datasource

```java
public final class TenantRoutingDataSource extends AbstractRoutingDataSource {

    @Override
    protected Object determineCurrentLookupKey() {
        return TenantContextHolder.required().tenantId().value();
    }
}
```

Configuration:

```java
@Bean
DataSource dataSource(TenantDataSourceRegistry registry) {
    TenantRoutingDataSource routing = new TenantRoutingDataSource();
    routing.setTargetDataSources(registry.asTargetDataSources());
    routing.setDefaultTargetDataSource(registry.defaultDataSource());
    routing.afterPropertiesSet();
    return routing;
}
```

But this basic version has risks.

### 9.2 Do Not Use a Default Tenant Casually

Dangerous:

```java
routing.setDefaultTargetDataSource(publicDataSource);
```

If tenant context is missing, the app may silently query the default datasource.

Safer pattern:

```java
public final class StrictTenantRoutingDataSource extends AbstractRoutingDataSource {

    @Override
    protected Object determineCurrentLookupKey() {
        return TenantContextHolder.get()
                .map(ctx -> ctx.tenantId().value())
                .orElseThrow(MissingTenantContextException::new);
    }
}
```

Invariant:

```text
A tenant-scoped datasource must fail closed when tenant context is missing.
```

### 9.3 Transaction Boundary Interaction

Datasource routing happens when Spring obtains a connection. After a transaction binds a connection to the thread, switching tenant context mid-transaction does not magically switch connection.

Bad:

```java
@Transactional
public void processTwoTenants() {
    TenantContextHolder.set(tenantA);
    repository.save(aRecord);

    TenantContextHolder.set(tenantB);
    repository.save(bRecord); // may still use tenant A connection depending on transaction/resource binding
}
```

Correct:

```text
One tenant per transaction boundary.
```

If a batch job must process multiple tenants:

```java
public void runForAllTenants() {
    for (TenantId tenantId : tenantRegistry.activeTenantIds()) {
        tenantExecutor.runForTenant(tenantId, () -> tenantJobService.processTenant(tenantId));
    }
}
```

```java
@Service
public class TenantJobService {

    @Transactional
    public void processTenant(TenantId tenantId) {
        // transaction starts after tenant context is set by caller/decorator
    }
}
```

### 9.4 Dynamic Tenant Onboarding

Adding tenants dynamically is more complex than putting an entry in a map.

You need:

```text
tenant metadata persisted
datasource credentials provisioned
schema/database migrated
connection pool created
health check passed
routing registry updated atomically
audit event recorded
rollback plan available
```

Possible registry model:

```java
public interface TenantDataSourceRegistry {
    DataSource get(TenantId tenantId);
    boolean exists(TenantId tenantId);
    Map<Object, Object> asTargetDataSources();
    void register(TenantDataSourceDefinition definition);
    void disable(TenantId tenantId);
}
```

Danger:

```text
Creating unbounded Hikari pools per tenant can exhaust database connections.
```

Capacity model:

```text
tenant_count × max_pool_size_per_tenant ≤ database_connection_budget
```

For many tenants, database-per-tenant may require:

- small pools,
- on-demand pool creation,
- pool eviction for inactive tenants,
- proxy/pooler layer,
- tenant tiering,
- async backpressure.

---

## 10. Schema Per Tenant

Schema-per-tenant uses the same database server but changes schema based on tenant.

Example PostgreSQL:

```sql
SET search_path TO agency_a;
```

Example Oracle:

```sql
ALTER SESSION SET CURRENT_SCHEMA = AGENCY_A;
```

### 10.1 Risk: Connection State Leakage

Connection pools reuse physical connections.

If you set schema on a connection and forget to reset it, the next request can inherit the previous tenant schema.

Invariant:

```text
Every borrowed connection must be tenant-initialized before use and reset/validated before reuse.
```

### 10.2 Hibernate Multi-Tenancy Integration

Hibernate supports multi-tenancy strategies, and Spring Data JPA can integrate with Hibernate's multi-tenant features. A Spring blog article demonstrates partitioned table, schema, and database approaches and notes that database separation can also use `AbstractRoutingDataSource` when not depending on Hibernate-specific features.

Typical Hibernate components:

```text
CurrentTenantIdentifierResolver
MultiTenantConnectionProvider
```

Sketch:

```java
public final class SpringTenantIdentifierResolver
        implements CurrentTenantIdentifierResolver<String> {

    @Override
    public String resolveCurrentTenantIdentifier() {
        return TenantContextHolder.required().tenantId().value();
    }

    @Override
    public boolean validateExistingCurrentSessions() {
        return true;
    }
}
```

Connection provider:

```java
public final class SchemaSwitchingConnectionProvider
        implements MultiTenantConnectionProvider<String> {

    private final DataSource dataSource;

    @Override
    public Connection getConnection(String tenantIdentifier) throws SQLException {
        Connection connection = dataSource.getConnection();
        connection.setSchema(tenantIdentifier);
        return connection;
    }

    @Override
    public void releaseConnection(String tenantIdentifier, Connection connection) throws SQLException {
        try {
            connection.setSchema("public");
        } finally {
            connection.close();
        }
    }
}
```

Caution:

```text
Implementation details differ by database and Hibernate version.
Always verify schema reset semantics under your actual pool and driver.
```

---

## 11. Shared Schema with Tenant Discriminator

This is the most common and most dangerous strategy.

Every tenant-scoped table includes tenant id:

```sql
create table case_record (
    tenant_id varchar(64) not null,
    id uuid not null,
    case_number varchar(64) not null,
    status varchar(32) not null,
    created_at timestamp not null,
    primary key (tenant_id, id)
);
```

### 11.1 Repository Pattern

Bad:

```java
Optional<CaseRecord> findById(CaseId id);
```

Better:

```java
Optional<CaseRecord> findByTenantIdAndId(TenantId tenantId, CaseId id);
```

Service:

```java
public CaseDetails getCase(CaseId caseId) {
    TenantId tenantId = TenantContextHolder.required().tenantId();

    return caseRepository.findByTenantIdAndId(tenantId, caseId)
            .map(mapper::toDetails)
            .orElseThrow(CaseNotFoundException::new);
}
```

### 11.2 Composite Keys and Indexing

Prefer indexes that start with `tenant_id` for tenant-scoped queries:

```sql
create index idx_case_record_tenant_status_created
    on case_record (tenant_id, status, created_at desc);
```

Not always, but commonly:

```text
Tenant predicate should be part of the leading index strategy.
```

### 11.3 Database Row-Level Security

Where available, row-level security can be an extra guardrail.

But do not assume database RLS replaces application authorization.

Better framing:

```text
Application authorization decides whether an operation is allowed.
Database row-level security reduces blast radius if a query misses tenant predicate.
```

### 11.4 Testing Tenant Predicate Safety

Write tests that try to access another tenant's data:

```java
@Test
void cannotReadCaseFromAnotherTenant() {
    TenantId tenantA = TenantId.of("agency-a");
    TenantId tenantB = TenantId.of("agency-b");

    CaseId caseId = seedCase(tenantB);

    runAsTenant(tenantA, () -> {
        assertThatThrownBy(() -> caseService.getCase(caseId))
                .isInstanceOf(CaseNotFoundException.class);
    });
}
```

Important:

```text
Return 404 vs 403 deliberately.
```

For cross-tenant resource access, many systems return 404 to avoid revealing the existence of another tenant's resource. But admin/support flows may need explicit 403 plus audit.

---

## 12. Tenant-Aware Cache

Cache leakage is one of the easiest multi-tenant mistakes.

Bad:

```java
@Cacheable(cacheNames = "caseSummary", key = "#caseId")
public CaseSummary getCaseSummary(CaseId caseId) { ... }
```

If `caseId` is globally unique, this may be safe. If not, Tenant A may receive Tenant B's cached data.

Safer:

```java
@Cacheable(
    cacheNames = "caseSummary",
    key = "T(com.example.TenantContextHolder).required().tenantId().value() + ':' + #caseId.value()"
)
public CaseSummary getCaseSummary(CaseId caseId) { ... }
```

Better: centralize key generation.

```java
public final class TenantAwareKeyGenerator implements KeyGenerator {

    @Override
    public Object generate(Object target, Method method, Object... params) {
        TenantId tenantId = TenantContextHolder.required().tenantId();
        return new TenantCacheKey(tenantId, method.getName(), List.of(params));
    }
}
```

Config:

```java
@Bean("tenantAwareKeyGenerator")
KeyGenerator tenantAwareKeyGenerator() {
    return new TenantAwareKeyGenerator();
}
```

Usage:

```java
@Cacheable(cacheNames = "caseSummary", keyGenerator = "tenantAwareKeyGenerator")
public CaseSummary getCaseSummary(CaseId caseId) { ... }
```

### 12.1 Tenant-Aware Cache Naming

Two strategies:

```text
shared cache name + tenant-aware key
separate cache namespace per tenant
```

Shared cache:

```text
caseSummary::agency-a:case-123
caseSummary::agency-b:case-123
```

Separate namespace:

```text
agency-a:caseSummary::case-123
agency-b:caseSummary::case-123
```

Trade-off:

| Strategy | Pros | Cons |
|---|---|---|
| tenant in key | simple, fewer caches | eviction per tenant harder |
| tenant in cache namespace | easier tenant flush | many cache regions |

### 12.2 Cache Invalidation per Tenant

A useful operational ability:

```text
clear all cache entries for tenant X
```

If using Redis, design keys intentionally:

```text
app:{tenantId}:case-summary:{caseId}
app:{tenantId}:reference-data:{code}
```

But avoid using `KEYS app:tenant:*` in production on large Redis. Use:

- versioned namespace,
- tenant cache epoch,
- explicit index sets,
- scan with care,
- cache manager support where available.

Tenant cache epoch pattern:

```text
tenant agency-a cache epoch = 42
key = agency-a:v42:case-summary:case-123
```

To invalidate tenant:

```text
increment agency-a epoch to 43
old keys naturally expire
```

---

## 13. Tenant-Aware Security

Tenant-aware security requires answering:

```text
Which tenants can this actor access?
What roles does the actor have per tenant?
Can the actor switch tenant?
Can the actor access cross-tenant administration?
Can the actor act on behalf of another tenant?
How is that audited?
```

### 13.1 Per-Tenant Authorities

Bad:

```text
ROLE_ADMIN
```

Better:

```text
TENANT_agency-a_CASE_READ
TENANT_agency-a_CASE_APPROVE
TENANT_agency-b_CASE_READ
```

But encoding tenant into authorities can explode in size.

Alternative:

```java
public record TenantMembership(
        TenantId tenantId,
        Set<TenantRole> roles
) {}
```

Then use a custom authorization component:

```java
@Component
public class TenantAuthorizationService {

    public boolean canReadCase(Authentication authentication, TenantId tenantId) {
        Actor actor = Actor.from(authentication);
        return actor.memberships().stream()
                .anyMatch(m -> m.tenantId().equals(tenantId)
                        && m.roles().contains(TenantRole.CASE_READ));
    }
}
```

Method security:

```java
@PreAuthorize("@tenantAuthorizationService.canReadCase(authentication, #tenantId)")
public CaseDetails getCase(TenantId tenantId, CaseId caseId) { ... }
```

### 13.2 Avoid Tenant Authorization by Query Filtering Alone

Bad mental model:

```text
If the query includes tenant_id, authorization is done.
```

No. Query filtering prevents data leakage, but does not prove the actor may perform the operation.

Proper layers:

```text
Authentication → who is actor?
Tenant resolution → which tenant is requested?
Tenant authorization → may actor operate in tenant?
Resource authorization → may actor operate on this resource?
Query filter → ensure only authorized tenant data is fetched
Audit → record decision/action
```

### 13.3 Support/Admin Access

Support users are dangerous because they often operate across tenants.

Required controls:

```text
explicit tenant selection
reason required
limited time session
strong audit trail
least privilege support role
no silent tenant default
visible banner/UI context
break-glass flow separated from normal admin flow
```

Service API:

```java
public void runAsTenantForSupport(
        TenantId tenantId,
        SupportActor actor,
        SupportReason reason,
        Runnable action
) {
    authorization.requireSupportAccess(actor, tenantId, reason);
    audit.recordSupportTenantEntry(actor, tenantId, reason);

    try {
        TenantContextHolder.set(TenantContext.support(actor, tenantId, reason));
        action.run();
    } finally {
        TenantContextHolder.clear();
        audit.recordSupportTenantExit(actor, tenantId);
    }
}
```

---

## 14. Tenant-Aware Scheduled Jobs

A scheduled job has no incoming tenant request.

Bad:

```java
@Scheduled(cron = "0 0 * * * *")
public void expireCases() {
    caseExpiryService.expireCases(); // what tenant?
}
```

Better:

```java
@Scheduled(cron = "0 0 * * * *")
public void expireCasesForAllTenants() {
    for (TenantId tenantId : tenantRegistry.activeTenants()) {
        tenantJobRunner.runForTenant(tenantId, () -> caseExpiryService.expireCasesForTenant());
    }
}
```

Runner:

```java
@Component
public class TenantJobRunner {

    public void runForTenant(TenantId tenantId, Runnable runnable) {
        TenantContext context = TenantContext.systemTask(tenantId, "case-expiry-job");
        try {
            TenantContextHolder.set(context);
            runnable.run();
        } finally {
            TenantContextHolder.clear();
        }
    }
}
```

But multi-replica deployments require locking:

```text
Only one replica should run tenant X expiry job for time window Y.
```

Use:

- database lock table,
- ShedLock-like pattern,
- Kubernetes CronJob instead of in-app scheduler,
- queue-based tenant job distribution,
- batch job repository.

### 14.1 Per-Tenant Job Isolation

For long-running tenant jobs:

```text
job_instance_id
tenant_id
job_type
status
started_at
ended_at
last_cursor
error_code
retry_count
```

This gives restartability and visibility.

---

## 15. Tenant-Aware Messaging

Every tenant-scoped message should carry tenant identity explicitly.

Envelope:

```json
{
  "messageId": "msg-123",
  "tenantId": "agency-a",
  "eventType": "CaseSubmitted",
  "aggregateId": "case-456",
  "occurredAt": "2026-06-21T10:15:30Z",
  "payload": {
    "caseNumber": "C-2026-001"
  }
}
```

Listener:

```java
@KafkaListener(topics = "case-events")
public void onMessage(CaseEventEnvelope envelope) {
    TenantContext context = TenantContext.message(envelope.tenantId(), envelope.messageId());

    try {
        TenantContextHolder.set(context);
        caseEventHandler.handle(envelope);
    } finally {
        TenantContextHolder.clear();
    }
}
```

Rules:

```text
Tenant id must be part of message contract.
Listener must set and clear tenant context.
Dead-letter record must preserve tenant id.
Retry must not lose tenant id.
Idempotency key should include tenant id.
```

Bad idempotency key:

```text
messageId
```

Better:

```text
tenantId + messageId
```

If message ids are globally unique, tenant may not be required for uniqueness, but including tenant helps operational queries and audit.

---

## 16. Tenant-Aware Outbound Integrations

A tenant often has custom integration settings:

```text
endpoint URL
API key
client certificate
rate limit
callback URL
payload format
feature capability
retry policy
```

Never hard-code integration config globally if behavior is tenant-specific.

Model:

```java
public record TenantIntegrationConfig(
        TenantId tenantId,
        URI endpoint,
        CredentialRef credentialRef,
        Duration connectTimeout,
        Duration readTimeout,
        RetryPolicy retryPolicy,
        RateLimitPolicy rateLimitPolicy,
        boolean enabled
) {}
```

Client:

```java
public void sendCaseUpdate(CaseUpdate update) {
    TenantId tenantId = TenantContextHolder.required().tenantId();
    TenantIntegrationConfig config = configService.getIntegrationConfig(tenantId, "case-update");

    if (!config.enabled()) {
        throw new TenantIntegrationDisabledException(tenantId);
    }

    externalClient.post(config, update);
}
```

Outbound headers:

```http
X-Correlation-Id: ...
X-Tenant-Id: agency-a
```

Only propagate tenant headers to trusted internal services or contractual external APIs. Do not leak internal tenant identifiers unnecessarily.

---

## 17. Tenant-Aware Configuration

Configuration may be layered:

```text
default platform config
environment config
tenant tier config
tenant-specific config
runtime override
```

Resolution order example:

```text
hard safety default
→ platform default
→ environment default
→ tenant tier default
→ tenant-specific override
→ temporary operational override
```

But not all config should be tenant-overridable.

Classify config:

| Config Type | Tenant Override? | Example |
|---|---:|---|
| safety invariant | no | max upload virus scan required |
| platform capacity | usually no | executor max pool |
| tenant feature | yes | enable advanced reporting |
| tenant integration | yes | external endpoint |
| tenant branding | yes | logo/theme |
| security policy | maybe | session timeout by agency policy |
| legal/compliance | controlled | retention period |

Pattern:

```java
public interface TenantConfigService {
    <T> T get(TenantId tenantId, TenantConfigKey<T> key);
}
```

Avoid scattering this:

```java
@Value("${tenant.agency-a.feature-x.enabled}")
```

That turns tenant config into static environment config and makes dynamic onboarding difficult.

---

## 18. Feature Flags in Tenant-Aware Systems

Feature flags answer:

```text
Should behavior X be active for this context?
```

In a multi-tenant system, the context usually includes:

```text
tenant id
environment
actor type
role
region
application module
request channel
version cohort
```

Feature flag decision interface:

```java
public interface FeatureDecisionService {
    boolean isEnabled(FeatureKey feature, TenantContext tenantContext);
}
```

Usage:

```java
if (featureDecisionService.isEnabled(Features.NEW_CASE_ROUTING, TenantContextHolder.required())) {
    newCaseRoutingService.route(caseId);
} else {
    legacyCaseRoutingService.route(caseId);
}
```

Rules:

```text
Feature flag decisions must be observable.
Critical flags need ownership and expiry date.
Flags must not bypass authorization.
Flags must be tested in both states.
Tenant-scoped flags must not default open accidentally.
```

Feature flags are not a substitute for configuration governance.

### 18.1 Flag Types

| Type | Purpose | Risk |
|---|---|---|
| release flag | gradual rollout | forgotten dead code |
| ops flag | disable risky path | inconsistent behavior |
| experiment flag | A/B testing | user fairness/compliance |
| permission flag | entitlement | confused with authz |
| tenant capability flag | per-tenant module | config drift |

For enterprise/regulatory systems, avoid casual experiment flags on legally meaningful workflows.

---

## 19. Extension Registry and Plugin-Like Architecture

Enterprise Spring systems often need tenant-specific behavior:

```text
tenant A requires custom validation
tenant B has custom approval routing
tenant C has custom document template
tenant D calls external system after approval
```

Naive solution:

```java
if (tenantId.equals("agency-a")) { ... }
else if (tenantId.equals("agency-b")) { ... }
```

This does not scale.

Better: extension registry.

```java
public interface TenantExtension<T> {
    boolean supports(TenantId tenantId);
    T extension();
}
```

Or capability-based:

```java
public interface CaseRoutingPolicy {
    boolean supports(TenantContext tenantContext, CaseType caseType);
    RoutingDecision route(CaseRoutingRequest request);
}
```

Registry:

```java
@Component
public class CaseRoutingPolicyRegistry {

    private final List<CaseRoutingPolicy> policies;

    public CaseRoutingPolicyRegistry(List<CaseRoutingPolicy> policies) {
        this.policies = List.copyOf(policies);
    }

    public CaseRoutingPolicy select(TenantContext tenant, CaseType caseType) {
        return policies.stream()
                .filter(p -> p.supports(tenant, caseType))
                .findFirst()
                .orElseThrow(() -> new MissingCaseRoutingPolicyException(tenant.tenantId(), caseType));
    }
}
```

Tenant-specific policy:

```java
@Component
@Order(100)
public class AgencyACaseRoutingPolicy implements CaseRoutingPolicy {

    @Override
    public boolean supports(TenantContext tenant, CaseType caseType) {
        return tenant.tenantId().value().equals("agency-a")
                && caseType.equals(CaseType.COMPLIANCE);
    }

    @Override
    public RoutingDecision route(CaseRoutingRequest request) {
        // agency-specific rule
    }
}
```

Default policy:

```java
@Component
@Order(1000)
public class DefaultCaseRoutingPolicy implements CaseRoutingPolicy { ... }
```

Critical invariant:

```text
Extension selection must be deterministic and testable.
```

Do not allow two extensions to match the same tenant/case type unless conflict resolution is explicit.

---

## 20. Multi-Module Spring Applications

A multi-tenant enterprise system often becomes a platform with modules:

```text
case-management
licensing
appeal
inspection
document
notification
payment
reporting
audit
admin
integration
```

Tenant features may vary by module.

Do not model this as hundreds of `if tenant has module` checks.

Model capabilities:

```java
public record TenantCapability(
        TenantId tenantId,
        ModuleKey module,
        CapabilityKey capability,
        boolean enabled
) {}
```

Check at boundary:

```java
capabilityService.requireEnabled(tenantId, Modules.APPEAL, Capabilities.CREATE_APPEAL);
```

Then service logic can assume capability exists.

Bad:

```java
if (capabilityService.isEnabled(...)) {
   // partial logic
}
// rest of method still continues accidentally
```

Better:

```java
public AppealId createAppeal(CreateAppealCommand command) {
    TenantContext tenant = TenantContextHolder.required();
    capabilityService.requireEnabled(tenant.tenantId(), Modules.APPEAL, Capabilities.CREATE_APPEAL);
    authorization.requireCanCreateAppeal(tenant, command);
    return appealWorkflow.start(command);
}
```

---

## 21. Tenant-Aware Audit Boundary

Audit must capture tenant context independently of application logs.

Minimum fields:

```text
audit_id
tenant_id
actor_id
actor_type
action
resource_type
resource_id
before_state
after_state
result
reason
source_ip
user_agent
correlation_id
request_id
timestamp
policy_version
```

Support/admin actions need additional fields:

```text
support_reason
approved_by
break_glass_ticket
impersonated_actor
session_id
```

Audit invariant:

```text
Every tenant-scoped state change must produce an audit record with tenant_id.
```

But be careful:

```text
Do not trust TenantContext alone for audit if the operation crosses tenants.
```

For cross-tenant admin actions, audit both:

```text
operator tenant/context
target tenant/context
```

Example:

```java
public record AuditEvent(
        TenantId targetTenantId,
        ActorRef actor,
        String action,
        String resourceType,
        String resourceId,
        String result,
        String reason,
        String correlationId,
        Instant occurredAt
) {}
```

---

## 22. Tenant-Aware Observability

Metrics, logs, and traces need tenant awareness, but tenant tags can create cardinality problems.

### 22.1 Logs

MDC:

```java
MDC.put("tenantId", tenantId.value());
MDC.put("correlationId", correlationId);
```

Clear it:

```java
finally {
    MDC.remove("tenantId");
    MDC.remove("correlationId");
}
```

### 22.2 Metrics Cardinality

Tagging every metric with tenant id can be dangerous if tenant count is high.

Bad:

```text
http.server.requests{tenantId="..."}
```

Maybe acceptable for low tenant count internal platforms, but risky for SaaS with thousands of tenants.

Alternative:

```text
tenant_tier
region
module
storage_strategy
```

For per-tenant metrics, use targeted business metrics or logs/events, not global high-volume technical metrics.

### 22.3 Traces

Trace baggage can carry tenant id across services, but only when safe.

Rules:

```text
Do not propagate sensitive tenant names externally.
Use stable opaque tenant id if needed.
Ensure baggage does not explode cardinality in metrics.
```

---

## 23. Tenant Registry

A serious multi-tenant system needs a tenant registry.

Not this:

```yaml
tenants:
  - agency-a
  - agency-b
```

Better registry fields:

```text
tenant_id
display_name
type/status/tier
storage_strategy
datasource_ref/schema_name
authentication_issuer
allowed_domains
region/data_residency
enabled_modules
integration_profile
created_at
activated_at
disabled_at
owner_contact
support_level
```

Model:

```java
public record TenantDescriptor(
        TenantId id,
        String displayName,
        TenantStatus status,
        TenantTier tier,
        StorageStrategy storageStrategy,
        Optional<String> schemaName,
        Optional<String> dataSourceRef,
        URI issuer,
        Set<String> allowedHosts,
        Set<ModuleKey> enabledModules
) {}
```

Status matters:

```java
enum TenantStatus {
    PROVISIONING,
    ACTIVE,
    SUSPENDED,
    READ_ONLY,
    DECOMMISSIONING,
    DECOMMISSIONED
}
```

Tenant status affects behavior:

| Status | Behavior |
|---|---|
| PROVISIONING | no user traffic, migration/setup only |
| ACTIVE | normal |
| SUSPENDED | login/action blocked, admin visible |
| READ_ONLY | reads allowed, writes blocked |
| DECOMMISSIONING | background export/delete only |
| DECOMMISSIONED | no access |

---

## 24. Tenant Provisioning Workflow

Tenant onboarding is not just inserting metadata.

Typical workflow:

```text
1. create tenant descriptor in PROVISIONING
2. allocate storage resources
3. create schema/database
4. run migrations
5. seed reference data
6. configure identity provider mapping
7. configure domains/routes
8. configure integrations/secrets
9. run health checks
10. enable modules/capabilities
11. mark tenant ACTIVE
12. emit audit and platform event
```

Spring implementation options:

- Spring Batch job,
- workflow engine such as Camunda/Temporal outside this series,
- internal state machine,
- transactional command table,
- admin service with resumable steps.

Important:

```text
Tenant provisioning must be resumable.
```

Because failures can occur after partial resource creation.

State table:

```sql
create table tenant_provisioning_task (
    task_id uuid primary key,
    tenant_id varchar(64) not null,
    step varchar(64) not null,
    status varchar(32) not null,
    attempts int not null,
    last_error text,
    updated_at timestamp not null
);
```

---

## 25. Tenant Decommissioning and Data Retention

Tenant deletion is rarely immediate.

Possible states:

```text
active
→ suspended
→ read-only
→ export pending
→ retention hold
→ deletion scheduled
→ deleted
```

Consider:

```text
legal retention
financial records
audit retention
backup retention
external integrations
search index deletion
cache eviction
message replay risk
analytics warehouse deletion
support access removal
identity provider cleanup
```

Deletion invariant:

```text
A tenant is not fully deleted until every data copy and derived index is accounted for.
```

For regulatory systems, audit may need to outlive tenant operational data.

---

## 26. Search, Reporting, and Analytics Across Tenants

Operational system:

```text
tenant-isolated
```

Reporting system:

```text
sometimes cross-tenant
```

This tension is dangerous.

Rules:

```text
Cross-tenant reporting must have explicit authorization.
Reporting queries must not reuse ordinary tenant-scoped service methods accidentally.
Aggregated data must define anonymization/redaction policy.
Export must be audited.
```

Design separate ports:

```java
public interface TenantScopedCaseQueryPort {
    Page<CaseSummary> searchCases(TenantId tenantId, CaseSearchCriteria criteria);
}

public interface CrossTenantCaseAnalyticsPort {
    CrossTenantReport runReport(CrossTenantReportCriteria criteria, AdminActor actor);
}
```

Do not hide cross-tenant behavior inside a boolean:

```java
searchCases(criteria, boolean includeAllTenants)
```

That is a future incident.

---

## 27. Tenant-Aware File/Object Storage

If using S3/object storage:

```text
s3://bucket/app/{tenantId}/documents/{documentId}
```

or:

```text
s3://tenant-specific-bucket/documents/{documentId}
```

Trade-off:

| Model | Pros | Cons |
|---|---|---|
| shared bucket + tenant prefix | simple, lower ops cost | IAM/prefix mistakes risky |
| bucket per tenant | stronger isolation | many buckets/policies |
| account/project per tenant | strongest isolation | highest ops complexity |

Rules:

```text
Object key must include tenant boundary unless bucket/account already provides it.
Presigned URL generation must verify tenant access.
Metadata must include tenant id.
Deletion/export must include object storage.
Virus scanning pipeline must preserve tenant context.
```

---

## 28. Tenant-Aware Search Index

Search systems often leak tenant data if index strategy is weak.

Options:

```text
index per tenant
shared index with tenant_id field
hybrid by tier
```

Shared index query must always filter:

```json
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "tenant_id": "agency-a" } },
        { "match": { "text": "inspection" } }
      ]
    }
  }
}
```

Rules:

```text
Tenant id must be indexed as keyword/exact field.
Search API must not expose arbitrary raw query DSL to tenant users.
Reindex jobs must be tenant-aware.
Delete tenant must delete or expire indexed documents.
```

---

## 29. Tenant-Aware API Design

Two common API styles:

### 29.1 Tenant in Path

```http
GET /tenants/{tenantId}/cases/{caseId}
```

Good for:

- admin tools,
- explicit APIs,
- multi-tenant user switching,
- audit readability.

### 29.2 Tenant from Context

```http
GET /cases/{caseId}
X-Tenant-Id: agency-a
```

or token claim.

Good for:

- tenant-specific host,
- cleaner public API,
- BFF/session-selected tenant.

### 29.3 Avoid Double Source Ambiguity

Dangerous:

```http
GET /tenants/agency-a/cases/123
Authorization: Bearer token-with-tenant-agency-b
X-Tenant-Id: agency-c
```

Define precedence and reject conflicts:

```text
If tenant appears in multiple sources, all verified sources must agree.
```

Implementation:

```java
public TenantResolution resolve(HttpServletRequest request) {
    List<TenantCandidate> candidates = List.of(
            fromPath(request),
            fromHeader(request),
            fromToken(request),
            fromHost(request)
    ).stream().flatMap(Optional::stream).toList();

    Set<TenantId> unique = candidates.stream()
            .map(TenantCandidate::tenantId)
            .collect(Collectors.toSet());

    if (unique.size() > 1) {
        throw new ConflictingTenantResolutionException(candidates);
    }

    return TenantResolution.from(candidates);
}
```

---

## 30. Multi-Tenant Testing Strategy

You need tests that specifically try to break isolation.

### 30.1 Unit Tests

Test tenant resolver:

```text
host → tenant
header → tenant
path → tenant
conflict detection
unknown tenant
suspended tenant
```

### 30.2 Integration Tests

Test cross-tenant data isolation:

```java
@Test
void tenantACannotSeeTenantBRecord() { ... }
```

### 30.3 Cache Tests

```java
@Test
void cacheKeyIncludesTenant() {
    runAsTenant(tenantA, () -> service.getCaseSummary(caseId));
    runAsTenant(tenantB, () -> service.getCaseSummary(caseId));

    assertThat(cacheNativeKeys()).contains(
        "agency-a:case-summary:" + caseId,
        "agency-b:case-summary:" + caseId
    );
}
```

### 30.4 Async Tests

```java
@Test
void asyncTaskReceivesTenantContext() { ... }
```

### 30.5 Scheduler Tests

```java
@Test
void scheduledJobRunsOncePerActiveTenant() { ... }
```

### 30.6 Security Tests

```java
@Test
void userWithTenantARoleCannotAccessTenantB() { ... }
```

### 30.7 Migration Tests

For schema/database per tenant:

```text
all active tenant schemas are at expected migration version
new tenant provisioning creates correct schema
failed migration leaves tenant inactive
```

---

## 31. Common Production Failure Models

### 31.1 Missing Tenant Context Defaults to Global

Symptom:

```text
some requests read global/default datasource
```

Cause:

```text
routing datasource has default target datasource
TenantContext missing
repository still runs
```

Fix:

```text
fail closed for tenant-scoped operations
separate global datasource from tenant datasource
```

### 31.2 Tenant Context Leak Across Requests

Symptom:

```text
Tenant B request sees Tenant A behavior intermittently
```

Cause:

```text
ThreadLocal not cleared
MDC not cleared
pooled thread reused
```

Fix:

```text
clear in finally
add integration test
use request-scoped validation
```

### 31.3 Cache Key Missing Tenant

Symptom:

```text
same resource id returns wrong tenant data
```

Cause:

```text
cache key uses id only
```

Fix:

```text
tenant-aware key generator
cache review checklist
```

### 31.4 Async Loses Tenant Context

Symptom:

```text
@Async task throws MissingTenantContextException
or writes to wrong/global context
```

Cause:

```text
ThreadLocal not propagated
```

Fix:

```text
TaskDecorator
explicit tenant command object
```

### 31.5 Scheduled Job Has No Tenant Boundary

Symptom:

```text
job processes all data or no data unexpectedly
```

Cause:

```text
scheduler invokes tenant-scoped service without tenant context
```

Fix:

```text
iterate tenant registry explicitly
one tenant per transaction/job scope
```

### 31.6 Query Missing Tenant Predicate

Symptom:

```text
cross-tenant data exposure
```

Cause:

```text
shared schema without mandatory tenant predicate
```

Fix:

```text
repository method conventions
static analysis/query review
RLS guardrail
integration tests
```

### 31.7 Tenant Conflict Between Path/Header/Token

Symptom:

```text
ambiguous access or privilege bypass
```

Cause:

```text
tenant resolved from one source while authorization checks another
```

Fix:

```text
central tenant resolution
conflict rejection
source precedence policy
```

---

## 32. Platform Starter Pattern for Multi-Tenancy

For large organizations, multi-tenancy should not be reimplemented in every service.

Create internal starter:

```text
company-spring-boot-starter-tenancy
```

Provides:

```text
TenantId value object
TenantContext
TenantContextHolder
TenantResolver SPI
TenantVerifier SPI
MVC/WebFlux filter/interceptor
TaskDecorator
MDC integration
Micrometer conventions
Cache key generator
AbstractRoutingDataSource support
Test utilities
Actuator tenant diagnostics endpoint
Auto-configuration
Configuration properties
```

Auto-config sketch:

```java
@AutoConfiguration
@EnableConfigurationProperties(TenancyProperties.class)
@ConditionalOnProperty(prefix = "platform.tenancy", name = "enabled", havingValue = "true")
public class TenancyAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    TenantContextHolderStrategy tenantContextHolderStrategy() {
        return new ThreadLocalTenantContextHolderStrategy();
    }

    @Bean
    @ConditionalOnMissingBean
    TenantAwareTaskDecorator tenantAwareTaskDecorator() {
        return new TenantAwareTaskDecorator();
    }

    @Bean
    @ConditionalOnMissingBean(name = "tenantAwareKeyGenerator")
    KeyGenerator tenantAwareKeyGenerator() {
        return new TenantAwareKeyGenerator();
    }
}
```

Rules for starter:

```text
fail closed by default
allow explicit opt-out only with documented reason
expose condition report-friendly beans
provide test helpers
avoid business tenant rules inside platform starter
```

---

## 33. Reference Architecture

```text
                    ┌───────────────────────────────┐
                    │        External Client         │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ Gateway / Ingress / WAF        │
                    │ - host/header normalization    │
                    │ - strip spoofed tenant headers │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│ Spring Application                                                │
│                                                                   │
│  ┌─────────────────────┐    ┌──────────────────────────────────┐ │
│  │ Tenant Resolver      │───▶│ Tenant Verifier / Authorization   │ │
│  └─────────────────────┘    └──────────────────────────────────┘ │
│             │                              │                      │
│             ▼                              ▼                      │
│  ┌─────────────────────┐    ┌──────────────────────────────────┐ │
│  │ TenantContext        │    │ SecurityContext                  │ │
│  └──────────┬──────────┘    └──────────────────────────────────┘ │
│             │                                                     │
│             ├──▶ MVC / WebFlux Controllers                        │
│             ├──▶ Application Services                             │
│             ├──▶ Tenant-Aware Repositories                        │
│             ├──▶ Tenant-Aware Cache                               │
│             ├──▶ Tenant-Aware HTTP Clients                        │
│             ├──▶ Tenant-Aware Events / Messaging                  │
│             ├──▶ Audit Writer                                     │
│             └──▶ Observability / Logs / Traces                    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                                    │
                 ┌──────────────────┼──────────────────┐
                 ▼                  ▼                  ▼
        ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
        │ Tenant DB /     │ │ Shared Cache    │ │ External APIs   │
        │ Schema / Rows   │ │ tenant-aware    │ │ tenant config   │
        └────────────────┘ └────────────────┘ └────────────────┘
```

---

## 34. Review Checklist for Multi-Tenant Spring Systems

### Tenant Resolution

```text
[ ] Is tenant resolved centrally?
[ ] Are multiple tenant sources conflict-checked?
[ ] Is tenant source recorded?
[ ] Are untrusted headers normalized at gateway?
[ ] Are unknown tenants rejected?
[ ] Are suspended/read-only tenants handled?
```

### Authorization

```text
[ ] Is tenant resolution separated from tenant authorization?
[ ] Are actor roles tenant-scoped?
[ ] Are support/admin actions explicitly audited?
[ ] Are cross-tenant operations separate APIs/services?
[ ] Are method-level checks used for sensitive operations?
```

### Data

```text
[ ] Is the isolation model explicitly chosen?
[ ] Is one tenant enforced per transaction?
[ ] Are repository methods tenant-safe?
[ ] Are native queries reviewed for tenant predicate?
[ ] Are migrations tenant-aware?
[ ] Is backup/restore policy tenant-aware?
```

### Cache

```text
[ ] Do cache keys include tenant or have tenant namespace?
[ ] Can tenant cache be invalidated?
[ ] Are authorization decisions cached safely?
[ ] Are mutable objects avoided in cache?
```

### Async / Scheduling / Messaging

```text
[ ] Is tenant context propagated to async tasks?
[ ] Do scheduled jobs iterate tenant registry explicitly?
[ ] Do messages carry tenant id?
[ ] Does DLQ preserve tenant id?
[ ] Are idempotency keys tenant-aware?
```

### Observability / Audit

```text
[ ] Do audit records include tenant id?
[ ] Are support actions audited with reason?
[ ] Are logs tenant-correlated?
[ ] Are metrics cardinality controlled?
[ ] Are traces safe to propagate externally?
```

### Platform

```text
[ ] Is tenancy provided as reusable platform starter/library?
[ ] Are defaults fail-closed?
[ ] Are test utilities available?
[ ] Are escape hatches explicit and audited?
[ ] Is tenant provisioning/decommissioning stateful and resumable?
```

---

## 35. How Top Engineers Think About Multi-Tenancy

A shallow implementation asks:

```text
How do I add tenant_id to queries?
```

A strong implementation asks:

```text
What is the isolation boundary?
Where is tenant identity resolved?
Where is it verified?
Where is it authorized?
Where is it propagated?
Where can it disappear?
Where can it leak?
Where can it be spoofed?
Where can cache bypass it?
Where can async jobs lose it?
Where can admin users cross it?
How do we prove it in audit?
How do we test it continuously?
```

The core invariant:

```text
Tenant identity is not a parameter. It is a runtime security, data, configuration,
operational, and audit boundary.
```

Once that mental model is internalized, Spring becomes a toolkit for enforcing tenant boundaries consistently across web, security, data, cache, async, messaging, and observability.

---

## 36. Practical Implementation Order

If building a new multi-tenant Spring platform, implement in this order:

```text
1. TenantId value object and tenant registry
2. Tenant resolution policy
3. Tenant authorization policy
4. TenantContext and propagation primitives
5. Web/security integration
6. Data isolation strategy
7. Cache key strategy
8. Audit model
9. Async/scheduler/message propagation
10. Tenant-aware config/capabilities
11. Test utilities and isolation tests
12. Observability and runbooks
13. Provisioning/decommissioning workflow
14. Internal starter/platform package
```

Do not start with Hibernate filters before deciding the enterprise isolation model.

---

## 37. References

- Spring Framework Javadoc — `AbstractRoutingDataSource`: routes `getConnection()` calls to target datasources based on a lookup key.
- Spring Blog — Integrating Hibernate multi-tenancy with Spring Data JPA.
- Spring Security Reference — OAuth2 Resource Server Multi-tenancy: resolving and propagating tenant identity.
- Spring Authorization Server Reference — multi-tenancy guide for multiple issuers per host.
- Spring Framework Reference — scheduling, async execution, web filters/interceptors, cache abstraction, transaction management.
- Spring Boot Reference — configuration properties, actuator, metrics, task execution, testing.

---

## 38. Completion Status

```text
Part completed : 28
Total planned  : 35
Series status  : not finished
Next part      : 29-native-image-aot-runtime-hints.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./27-modular-monolith-spring-modulith.md">⬅️ Part 27 — Modular Monolith with Spring and Spring Modulith</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./29-native-image-aot-runtime-hints.md">Native Image, AOT, Reflection, and Runtime Hints ➡️</a>
</div>
