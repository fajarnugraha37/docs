# learn-jaxrs-advanced-part-015.md

# Bagian 015 — Filters: `ContainerRequestFilter`, `ContainerResponseFilter`, Pre-Matching, Post-Matching, `abortWith`, Priority, Name Binding, dan Cross-Cutting REST Boundary

> Target pembaca: Java/Jakarta engineer yang ingin menguasai **JAX-RS/Jakarta REST filters** secara production-grade. Fokus part ini bukan hanya “buat logging filter”, tetapi memahami filter sebagai cross-cutting boundary: pre-matching vs post-matching, request/response mutation, authentication/authorization, correlation ID, CORS, security headers, cache short-circuit, `abortWith`, priority ordering, name binding, dynamic binding, interaction with exception mapper/interceptor, async/streaming caveat, observability, dan testing.
>
> Namespace utama: `jakarta.ws.rs.container.ContainerRequestFilter`, `jakarta.ws.rs.container.ContainerResponseFilter`, `jakarta.ws.rs.container.ContainerRequestContext`, `jakarta.ws.rs.container.ContainerResponseContext`, `jakarta.ws.rs.container.PreMatching`, `jakarta.ws.rs.NameBinding`, `jakarta.annotation.Priority`, `jakarta.ws.rs.Priorities`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Filter adalah Cross-Cutting Boundary](#2-mental-model-filter-adalah-cross-cutting-boundary)
3. [Filter vs Resource Method vs Interceptor vs Servlet Filter](#3-filter-vs-resource-method-vs-interceptor-vs-servlet-filter)
4. [JAX-RS Server-Side Filter Pipeline](#4-jax-rs-server-side-filter-pipeline)
5. [`ContainerRequestFilter`: Request Pre-Processing](#5-containerrequestfilter-request-pre-processing)
6. [`ContainerResponseFilter`: Response Post-Processing](#6-containerresponsefilter-response-post-processing)
7. [Global Filter Default Behavior](#7-global-filter-default-behavior)
8. [Pre-Matching Request Filter](#8-pre-matching-request-filter)
9. [Post-Matching Request Filter](#9-post-matching-request-filter)
10. [Pre-Matching vs Post-Matching: Decision Framework](#10-pre-matching-vs-post-matching-decision-framework)
11. [`ContainerRequestContext`: Apa yang Bisa Dibaca/Diubah](#11-containerrequestcontext-apa-yang-bisa-dibacadiubah)
12. [`ContainerResponseContext`: Apa yang Bisa Dibaca/Diubah](#12-containerresponsecontext-apa-yang-bisa-dibacadiubah)
13. [`abortWith(Response)`: Short-Circuit Request](#13-abortwithresponse-short-circuit-request)
14. [Chain Behavior saat `abortWith`](#14-chain-behavior-saat-abortwith)
15. [Priority Ordering dengan `@Priority`](#15-priority-ordering-dengan-priority)
16. [`Priorities`: AUTHENTICATION, AUTHORIZATION, HEADER_DECORATOR, ENTITY_CODER, USER](#16-priorities-authentication-authorization-header_decorator-entity_coder-user)
17. [Request Filter Order vs Response Filter Order](#17-request-filter-order-vs-response-filter-order)
18. [`@Provider` dan Provider Discovery](#18-provider-dan-provider-discovery)
19. [Name Binding dengan `@NameBinding`](#19-name-binding-dengan-namebinding)
20. [Name-Bound Request/Response Filter](#20-name-bound-requestresponse-filter)
21. [Name Binding pada `Application`](#21-name-binding-pada-application)
22. [Dynamic Binding dengan `DynamicFeature`](#22-dynamic-binding-dengan-dynamicfeature)
23. [Use Case: Correlation ID Filter](#23-use-case-correlation-id-filter)
24. [Use Case: Request Logging Filter](#24-use-case-request-logging-filter)
25. [Use Case: Security Headers Response Filter](#25-use-case-security-headers-response-filter)
26. [Use Case: Authentication Filter](#26-use-case-authentication-filter)
27. [Use Case: Authorization Filter](#27-use-case-authorization-filter)
28. [Use Case: Tenant Resolution Filter](#28-use-case-tenant-resolution-filter)
29. [Use Case: CORS Filter](#29-use-case-cors-filter)
30. [Use Case: Cache Short-Circuit Filter](#30-use-case-cache-short-circuit-filter)
31. [Use Case: Idempotency Filter](#31-use-case-idempotency-filter)
32. [Use Case: Rate Limit Filter](#32-use-case-rate-limit-filter)
33. [Use Case: Request Method Override](#33-use-case-request-method-override)
34. [Use Case: Maintenance Mode / Feature Flag Filter](#34-use-case-maintenance-mode--feature-flag-filter)
35. [Entity Stream di Request Filter: Bahaya Membaca Body](#35-entity-stream-di-request-filter-bahaya-membaca-body)
36. [Response Entity di Response Filter: Kapan Aman, Kapan Tidak](#36-response-entity-di-response-filter-kapan-aman-kapan-tidak)
37. [Filter dan Exception Handling](#37-filter-dan-exception-handling)
38. [Filter dan Problem Details](#38-filter-dan-problem-details)
39. [Filter dan Context Injection](#39-filter-dan-context-injection)
40. [Filter dan SecurityContext Override](#40-filter-dan-securitycontext-override)
41. [Filter dan Request Properties](#41-filter-dan-request-properties)
42. [Filter dan Async/Threading](#42-filter-dan-asyncthreading)
43. [Filter dan Streaming Response](#43-filter-dan-streaming-response)
44. [Filter dan Compression/Encryption: Kenapa Biasanya Interceptor](#44-filter-dan-compressionencryption-kenapa-biasanya-interceptor)
45. [Filter dan Gateway/Reverse Proxy](#45-filter-dan-gatewayreverse-proxy)
46. [Filter dan Observability](#46-filter-dan-observability)
47. [Filter Design Guidelines](#47-filter-design-guidelines)
48. [Testing Filters](#48-testing-filters)
49. [Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus](#49-runtime-differences-jersey-resteasy-cxf-liberty-quarkus)
50. [Migration: `javax.ws.rs.container` ke `jakarta.ws.rs.container`](#50-migration-javaxxwrscontainer-ke-jakartawrscontainer)
51. [Common Failure Modes](#51-common-failure-modes)
52. [Best Practices](#52-best-practices)
53. [Anti-Patterns](#53-anti-patterns)
54. [Production Checklist](#54-production-checklist)
55. [Latihan](#55-latihan)
56. [Referensi Resmi](#56-referensi-resmi)
57. [Penutup](#57-penutup)

---

# 1. Tujuan Part Ini

JAX-RS filter adalah salah satu extension point paling sering dipakai untuk cross-cutting concerns.

Contoh umum:

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class AuthenticationFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext requestContext) {
        ...
    }
}
```

atau:

```java
@Provider
public class SecurityHeadersFilter implements ContainerResponseFilter {

    @Override
    public void filter(
        ContainerRequestContext requestContext,
        ContainerResponseContext responseContext
    ) {
        responseContext.getHeaders().putSingle("X-Content-Type-Options", "nosniff");
    }
}
```

Namun production-grade filter jauh lebih rumit daripada “tambahkan header”.

Kamu harus memahami:

- kapan filter berjalan;
- apakah sebelum atau sesudah matching;
- apakah filter global atau name-bound;
- apa arti `abortWith`;
- filter mana berjalan lebih dulu;
- kenapa response filter order dibalik;
- kapan aman mengubah request method/header;
- kenapa membaca request body di filter berbahaya;
- bagaimana filter berinteraksi dengan exception mapper;
- bagaimana filter membuat security context;
- bagaimana menulis logging/correlation filter tanpa bocor PII;
- kapan seharusnya memakai interceptor, bukan filter.

## 1.1 Prinsip utama

```text
Filters are for protocol-level cross-cutting concerns around resource invocation.
They should not become hidden business logic.
```

## 1.2 Target akhir

Setelah part ini, kamu bisa:

- mendesain filter chain yang deterministik;
- memilih pre-matching vs post-matching;
- membuat auth/correlation/logging/security header filter;
- memakai `abortWith` dengan benar;
- memakai `@Priority` dan `Priorities`;
- memakai `@NameBinding` dan `DynamicFeature`;
- menghindari body logging/stream consumption bug;
- menulis test filter yang benar;
- membuat filter yang aman untuk production.

---

# 2. Mental Model: Filter adalah Cross-Cutting Boundary

Filter berada di sekitar resource method.

```text
HTTP request
  ↓
request filters
  ↓
resource method
  ↓
response filters
  ↓
HTTP response
```

Filter ideal untuk concern yang:

- berlaku di banyak endpoint;
- terkait HTTP/request/response;
- perlu berjalan sebelum/atau sesudah resource;
- tidak spesifik domain method;
- bisa diputuskan dari metadata request/response.

## 2.1 Good filter concerns

- correlation ID;
- request ID;
- authentication parsing;
- coarse authorization;
- CORS;
- security headers;
- request/response logging metadata;
- cache lookup/short-circuit;
- rate limiting;
- tenant resolution;
- maintenance mode;
- feature gate at protocol boundary.

## 2.2 Bad filter concerns

- calculate order total;
- approve licence;
- cancel case;
- decide workflow transition;
- update customer status;
- enrich domain object from DB for resource method silently;
- implement business rule because “applies to many endpoints”.

## 2.3 Top-tier rule

```text
If it changes HTTP protocol behavior, filter may be right.
If it changes business state/meaning, service/domain should own it.
```

---

# 3. Filter vs Resource Method vs Interceptor vs Servlet Filter

## 3.1 JAX-RS filter

Works at JAX-RS request/response context level.

Can inspect and mutate:

- method;
- URI;
- headers;
- request properties;
- security context;
- response status;
- response headers;
- response entity metadata.

## 3.2 Resource method

Business endpoint handler.

```java
@GET
@Path("/customers/{id}")
public CustomerResponse get(...) { ... }
```

## 3.3 JAX-RS interceptor

Primarily around entity input/output streams.

Use for:

- compression;
- encryption;
- signing;
- entity wrapping;
- stream metrics;
- reader/writer behavior.

## 3.4 Servlet filter

Runs at servlet container level, before JAX-RS dispatch.

Use for:

- app-wide servlet concerns;
- static assets;
- non-JAX-RS endpoints;
- container-level security.

## 3.5 Decision

```text
Need JAX-RS resource metadata/name binding? → JAX-RS filter.
Need entity stream transformation? → interceptor.
Need whole webapp including non-JAX-RS? → Servlet filter.
Need business operation? → resource/service.
```

## 3.6 Rule

Use the narrowest extension point that matches the concern.

---

# 4. JAX-RS Server-Side Filter Pipeline

Conceptually:

```text
Incoming HTTP request
  ↓
Pre-matching request filters
  ↓
Resource matching
  ↓
Post-matching request filters
  ↓
Resource method / subresource / entity reader
  ↓
Response produced
  ↓
Response filters
  ↓
Writer/interceptors
  ↓
Outgoing HTTP response
```

## 4.1 Pre-matching request filter

Runs before resource matching.

Can affect matching by changing:

- HTTP method;
- request URI;
- headers such as `Accept`;
- perhaps short-circuit from cache.

## 4.2 Post-matching request filter

Runs after method/resource matched.

Can use resource-specific binding and context.

Best for:

- name-bound auth;
- endpoint-specific logging;
- resource-based metadata.

## 4.3 Response filter

Runs after a response has been produced by:

- request filter via `abortWith`;
- matched resource method.

## 4.4 Important nuance

A response produced by a pre-matching filter is passed to the corresponding pre-match response filter chain; it can skip post-match request/response filters.

## 4.5 Rule

Filter pipeline is not just “before and after”; matching phase matters.

---

# 5. `ContainerRequestFilter`: Request Pre-Processing

Interface:

```java
public interface ContainerRequestFilter {
    void filter(ContainerRequestContext requestContext) throws IOException;
}
```

## 5.1 Simple example

```java
@Provider
public class RequestIdFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext ctx) {
        String requestId = ctx.getHeaderString("X-Request-ID");
        if (requestId == null || requestId.isBlank()) {
            requestId = UUID.randomUUID().toString();
        }
        ctx.setProperty("requestId", requestId);
    }
}
```

## 5.2 Called before dispatch

The method is called before request is dispatched to resource.

## 5.3 What it can do

- read/modify headers;
- read/modify method in pre-match;
- read/modify URI in pre-match;
- set request properties;
- set security context;
- abort request;
- inspect entity stream, but be careful;
- apply authentication/authorization.

## 5.4 Global vs name-bound

By default, a request filter without name binding is global but post-match unless annotated `@PreMatching`.

## 5.5 Provider discovery

Must be `@Provider` or registered dynamically/programmatically.

## 5.6 Rule

Use request filters for cross-cutting decisions before resource method logic.

---

# 6. `ContainerResponseFilter`: Response Post-Processing

Interface:

```java
public interface ContainerResponseFilter {
    void filter(
        ContainerRequestContext requestContext,
        ContainerResponseContext responseContext
    ) throws IOException;
}
```

## 6.1 Simple example

```java
@Provider
public class SecurityHeadersFilter implements ContainerResponseFilter {

    @Override
    public void filter(ContainerRequestContext request, ContainerResponseContext response) {
        response.getHeaders().putSingle("X-Content-Type-Options", "nosniff");
        response.getHeaders().putSingle("Referrer-Policy", "no-referrer");
    }
}
```

## 6.2 Called after response exists

Response can come from:

- resource method;
- request filter `abortWith`;
- exception mapper.

## 6.3 What it can do

- add/remove response headers;
- alter status in some cases;
- alter entity metadata;
- wrap/replace entity in limited scenarios;
- add cookies;
- add CORS headers;
- add cache/security headers;
- record metrics timing if start captured earlier.

## 6.4 What it should not do casually

- perform business logic;
- do expensive remote calls;
- serialize entity manually;
- read streaming entity;
- depend on response body being fully available.

## 6.5 Rule

Response filter is ideal for metadata decoration, not heavy response body transformation.

---

# 7. Global Filter Default Behavior

## 7.1 Request filter default

A `ContainerRequestFilter` without name binding is global, but by default it is applied after matching.

```java
@Provider
public class GlobalRequestFilter implements ContainerRequestFilter { ... }
```

## 7.2 Response filter default

A `ContainerResponseFilter` without name binding is global to outgoing responses.

```java
@Provider
public class GlobalResponseFilter implements ContainerResponseFilter { ... }
```

## 7.3 Name binding changes scope

If filter class has a name-binding annotation, it only applies to matched resource/method/application with same binding.

## 7.4 PreMatching changes phase

`@PreMatching` makes request filter run before matching and globally.

Name bindings are ignored on a pre-matching component.

## 7.5 Rule

Filter scope = global/name-bound/dynamic; filter phase = pre-match/post-match/response.

---

# 8. Pre-Matching Request Filter

Pre-matching filter runs before JAX-RS chooses resource method.

## 8.1 Annotation

```java
@Provider
@PreMatching
public class MethodOverrideFilter implements ContainerRequestFilter {
    ...
}
```

## 8.2 Use cases

- method override;
- normalize URI;
- rewrite path;
- modify `Accept` before method selection;
- respond from cache;
- reject early based on global policy;
- maintenance mode;
- CORS preflight handling.

## 8.3 Example method override

```java
@Provider
@PreMatching
@Priority(Priorities.HEADER_DECORATOR)
public class MethodOverrideFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext ctx) {
        String override = ctx.getHeaderString("X-HTTP-Method-Override");
        if (override != null && !override.isBlank()) {
            ctx.setMethod(override.toUpperCase(Locale.ROOT));
        }
    }
}
```

## 8.4 Caution

Changing method/URI affects routing.

Do this only with strict policy and audit.

## 8.5 Name binding ignored

Pre-matching filters are global; name bindings on them are ignored.

## 8.6 Rule

Use pre-matching only when matching input must be changed or request must be handled before matching.

---

# 9. Post-Matching Request Filter

Post-matching request filter runs after JAX-RS matched resource method.

## 9.1 Default request filter

```java
@Provider
public class AuditFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext ctx) { ... }
}
```

Without `@PreMatching`, this is post-matching.

## 9.2 Use cases

- resource-specific auth;
- name-bound logging;
- endpoint-level metrics metadata;
- role checks based on matched method annotation;
- feature flags tied to resource method.

## 9.3 Can use name binding

```java
@Audited
@Provider
public class AuditingFilter implements ContainerRequestFilter { ... }
```

Resource:

```java
@Audited
@POST
public Response create(...) { ... }
```

## 9.4 Can access matched resource info?

Use `@Context ResourceInfo` in filters where supported.

## 9.5 Rule

If concern depends on selected resource/method, use post-matching filter.

---

# 10. Pre-Matching vs Post-Matching: Decision Framework

## 10.1 Use pre-matching if you need to

- rewrite method;
- rewrite URI;
- alter `Accept` before selection;
- respond from cache before matching;
- handle CORS OPTIONS globally;
- reject request independent of endpoint.

## 10.2 Use post-matching if you need to

- know resource method;
- apply name binding;
- enforce endpoint-specific policy;
- inspect annotations;
- depend on selected path template;
- run after route exists.

## 10.3 Avoid pre-matching for normal auth?

Authentication that only parses token can be pre or post.

Authorization that depends on endpoint/resource should be post-match or service layer.

## 10.4 Performance consideration

Pre-matching can reject early before matching, but don't over-optimize.

## 10.5 Security consideration

Pre-matching URI/method rewriting can create confusing audit/security behavior.

## 10.6 Rule

Default to post-matching unless you specifically need pre-matching semantics.

---

# 11. `ContainerRequestContext`: Apa yang Bisa Dibaca/Diubah

`ContainerRequestContext` represents request context in filter.

## 11.1 Common reads

```java
ctx.getMethod()
ctx.getUriInfo()
ctx.getHeaders()
ctx.getHeaderString("Authorization")
ctx.getCookies()
ctx.getMediaType()
ctx.getAcceptableMediaTypes()
ctx.getSecurityContext()
ctx.getEntityStream()
ctx.hasEntity()
```

## 11.2 Common writes

```java
ctx.setMethod("GET")
ctx.setRequestUri(uri)
ctx.setRequestUri(baseUri, requestUri)
ctx.getHeaders().putSingle("X-...")
ctx.setSecurityContext(securityContext)
ctx.setEntityStream(inputStream)
ctx.setProperty("key", value)
ctx.abortWith(response)
```

## 11.3 Mutability restrictions

Some operations make sense only pre-matching.

For example, changing method/URI after matching can be illegal or meaningless.

## 11.4 Headers

Headers map is mutable in request filter.

## 11.5 Entity stream

You can replace entity stream, but if you read it without resetting, downstream body binding breaks.

## 11.6 Rule

Mutating request context changes what downstream sees. Keep it deliberate and minimal.

---

# 12. `ContainerResponseContext`: Apa yang Bisa Dibaca/Diubah

`ContainerResponseContext` represents response context.

## 12.1 Reads

```java
response.getStatus()
response.getStatusInfo()
response.getHeaders()
response.getMediaType()
response.hasEntity()
response.getEntity()
response.getEntityClass()
response.getEntityType()
```

## 12.2 Writes

```java
response.setStatus(200)
response.setStatusInfo(Response.Status.OK)
response.getHeaders().putSingle("X-...")
response.setEntity(entity)
response.setEntity(entity, annotations, mediaType)
```

## 12.3 Common safe mutations

- add security headers;
- add CORS headers;
- add correlation ID;
- add cache headers;
- add `Vary`;
- add `Server-Timing` if policy;
- add metrics properties.

## 12.4 Risky mutations

- replacing entity after resource;
- changing status after business response;
- modifying entity type causing writer mismatch;
- changing `Content-Type` inconsistently.

## 12.5 Rule

Response filter should mostly decorate metadata, not redesign response semantics.

---

# 13. `abortWith(Response)`: Short-Circuit Request

`abortWith` stops current request filter chain and supplies a response.

## 13.1 Example

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class ApiKeyAuthFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext ctx) {
        String apiKey = ctx.getHeaderString("X-API-Key");
        if (!isValid(apiKey)) {
            ctx.abortWith(Response.status(Response.Status.UNAUTHORIZED)
                .type("application/problem+json")
                .entity(problem("AUTHENTICATION_REQUIRED"))
                .build());
        }
    }
}
```

## 13.2 Use cases

- authentication failure;
- authorization failure;
- CORS preflight response;
- rate limit response;
- maintenance mode;
- cached response;
- invalid correlation ID/header;
- blocked request.

## 13.3 Not exception

`abortWith` is not throwing; it supplies response directly.

## 13.4 Response filters still apply

The response is passed to appropriate response filter chain.

## 13.5 Rule

Use `abortWith` for intentional early response, not for unexpected exceptions.

---

# 14. Chain Behavior saat `abortWith`

## 14.1 Request chain stops

If request filter calls `abortWith`, remaining request filters in that same chain are not executed.

## 14.2 Response chain continues

The response goes through corresponding response filter chain.

## 14.3 Pre-match abort

If pre-matching request filter aborts:

- post-match request filters are skipped;
- post-match response filters may be skipped;
- pre-match response filter chain processes response.

## 14.4 Post-match abort

If post-matching request filter aborts:

- resource method not called;
- response filters for post-match path apply.

## 14.5 Design implication

If correlation ID response header must always exist, ensure response filter that adds it runs for aborted responses too.

Global response filters are useful.

## 14.6 Rule

When using `abortWith`, test which response filters still run.

---

# 15. Priority Ordering dengan `@Priority`

Filters are ordered with `jakarta.annotation.Priority`.

## 15.1 Example

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class AuthenticationFilter implements ContainerRequestFilter { ... }
```

## 15.2 Lower number = higher priority

For most chains, lower priority value runs earlier.

## 15.3 Default

If `@Priority` absent, default is `Priorities.USER`.

## 15.4 Same priority

Execution order among same priority is implementation-defined.

## 15.5 Do not rely on class name order

If order matters, assign explicit priorities.

## 15.6 Rule

Filter ordering is architecture. Make it explicit.

---

# 16. `Priorities`: AUTHENTICATION, AUTHORIZATION, HEADER_DECORATOR, ENTITY_CODER, USER

`jakarta.ws.rs.Priorities` defines built-in priority constants.

## 16.1 `AUTHENTICATION`

Security authentication priority.

Use for:

- parse token;
- verify API key;
- establish security context.

## 16.2 `AUTHORIZATION`

Security authorization priority.

Use for:

- coarse role/scope checks;
- endpoint access decisions.

## 16.3 `HEADER_DECORATOR`

Header decoration priority.

Use for response headers or request header normalization.

## 16.4 `ENTITY_CODER`

Message encoder/decoder filter/interceptor priority.

Often more relevant to interceptors.

## 16.5 `USER`

Default user-level provider priority.

## 16.6 Example order

```text
AUTHENTICATION
  ↓
AUTHORIZATION
  ↓
USER
  ↓
HEADER_DECORATOR
```

depending actual numeric constants and chain direction.

## 16.7 Rule

Use named constants to communicate intent, not magic numbers everywhere.

---

# 17. Request Filter Order vs Response Filter Order

## 17.1 Request filters

Most chains are sorted ascending by priority.

Lower number runs earlier.

## 17.2 Response filters

Post response filter chain is sorted descending to execute response filters in reverse order.

## 17.3 Why reverse?

It mirrors wrapping behavior:

```text
Request:  A → B → resource
Response: resource → B → A
```

## 17.4 Example

```java
@Priority(1000) AuthFilter
@Priority(5000) UserFilter
```

Request:

```text
AuthFilter then UserFilter
```

Response post-chain:

```text
UserFilter then AuthFilter
```

if both are response filters and applicable.

## 17.5 Important

If one class implements both request and response filter, its response part may run in reverse order relative to request.

## 17.6 Rule

Test order for filters that depend on each other.

---

# 18. `@Provider` dan Provider Discovery

Filters implementing JAX-RS filter interfaces must be discoverable.

## 18.1 Annotation

```java
@Provider
public class MyFilter implements ContainerRequestFilter { ... }
```

## 18.2 Programmatic registration

```java
public class ApiApplication extends Application {
    @Override
    public Set<Class<?>> getClasses() {
        return Set.of(MyFilter.class, CustomerResource.class);
    }
}
```

## 18.3 Dynamic registration

Via `DynamicFeature`.

## 18.4 CDI bean

Depending runtime, provider can also be CDI-managed.

## 18.5 Missing filter symptoms

- no correlation ID;
- auth not applied;
- security headers missing;
- CORS not working;
- tests pass by direct resource invocation but fail in HTTP.

## 18.6 Rule

Filter registration must be tested through runtime.

---

# 19. Name Binding dengan `@NameBinding`

Name binding limits filters/interceptors to annotated resources/methods.

## 19.1 Define binding

```java
@NameBinding
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
public @interface Audited {
}
```

## 19.2 Bind filter

```java
@Audited
@Provider
public class AuditFilter implements ContainerRequestFilter, ContainerResponseFilter {
    ...
}
```

## 19.3 Apply to resource method

```java
@POST
@Audited
public Response create(...) { ... }
```

## 19.4 Apply to resource class

```java
@Audited
@Path("/admin")
public class AdminResource { ... }
```

## 19.5 Multiple filters

More than one filter can share same name binding.

## 19.6 Rule

Name binding makes cross-cutting policy explicit at endpoint level.

---

# 20. Name-Bound Request/Response Filter

## 20.1 Example secured annotation

```java
@NameBinding
@Target({TYPE, METHOD})
@Retention(RUNTIME)
public @interface RequiresAdmin {
}
```

## 20.2 Filter

```java
@RequiresAdmin
@Provider
@Priority(Priorities.AUTHORIZATION)
public class AdminAuthorizationFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext ctx) {
        if (!ctx.getSecurityContext().isUserInRole("ADMIN")) {
            ctx.abortWith(Response.status(Response.Status.FORBIDDEN)
                .type("application/problem+json")
                .entity(problem("FORBIDDEN"))
                .build());
        }
    }
}
```

## 20.3 Resource

```java
@RequiresAdmin
@DELETE
@Path("/{id}")
public Response delete(...) { ... }
```

## 20.4 Benefit

Security policy visible.

## 20.5 Caution

Role-based filter is coarse. Domain authorization still belongs in service.

## 20.6 Rule

Name-bound filters are great for declarative protocol/policy concerns.

---

# 21. Name Binding pada `Application`

A name-binding annotation can be attached to `Application` subclass.

## 21.1 Example

```java
@Audited
@ApplicationPath("/api")
public class ApiApplication extends Application {
}
```

## 21.2 Effect

Name-bound provider with same annotation applies to all resource/sub-resource methods in application.

## 21.3 Use case

- audit all endpoints;
- version-specific policy;
- application-wide custom behavior while still name-binding based.

## 21.4 Caution

Can be surprising if developers expect method-level only.

## 21.5 Rule

If binding at application level, document it clearly.

---

# 22. Dynamic Binding dengan `DynamicFeature`

`DynamicFeature` can bind filters dynamically based on resource method/class metadata.

## 22.1 Example use cases

- register filter if method annotated with custom annotation;
- bind rate limit policy based on annotation value;
- bind tenant filter only for tenant-scoped resources;
- avoid name-binding limitations.

## 22.2 Sketch

```java
@Provider
public class RateLimitFeature implements DynamicFeature {

    @Override
    public void configure(ResourceInfo resourceInfo, FeatureContext context) {
        RateLimited annotation = resourceInfo.getResourceMethod()
            .getAnnotation(RateLimited.class);

        if (annotation != null) {
            context.register(new RateLimitFilter(annotation.policy()));
        }
    }
}
```

## 22.3 Difference from name binding

Name binding is declarative and simple.

DynamicFeature allows runtime registration logic.

## 22.4 Caution

Can become complex and harder to trace.

## 22.5 Rule

Use name binding first. Use DynamicFeature when annotation values/metadata need programmatic binding.

---

# 23. Use Case: Correlation ID Filter

Correlation ID should exist for every request and response.

## 23.1 Request filter

```java
@Provider
@Priority(Priorities.AUTHENTICATION - 100)
public class CorrelationIdRequestFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext ctx) {
        String raw = ctx.getHeaderString("X-Correlation-ID");
        String correlationId = sanitizeOrGenerate(raw);
        ctx.setProperty("correlationId", correlationId);
        MDC.put("correlationId", correlationId);
    }

    private String sanitizeOrGenerate(String raw) {
        if (raw == null || raw.isBlank() || raw.length() > 128) {
            return UUID.randomUUID().toString();
        }
        return raw;
    }
}
```

## 23.2 Response filter

```java
@Provider
public class CorrelationIdResponseFilter implements ContainerResponseFilter {

    @Override
    public void filter(ContainerRequestContext request, ContainerResponseContext response) {
        Object id = request.getProperty("correlationId");
        if (id != null) {
            response.getHeaders().putSingle("X-Correlation-ID", id.toString());
        }
        MDC.remove("correlationId");
    }
}
```

## 23.3 Security

Correlation ID is not auth.

Validate length/characters.

## 23.4 Async caution

MDC may not propagate automatically.

## 23.5 Rule

Every response, including errors and aborts, should carry correlation ID.

---

# 24. Use Case: Request Logging Filter

## 24.1 What to log

Safe metadata:

- method;
- matched route template if available;
- status;
- duration;
- correlation ID;
- content type;
- content length;
- user/tenant safe IDs if policy allows;
- error code.

## 24.2 What not to log

- request body;
- authorization header;
- cookies;
- tokens;
- passwords;
- raw query with PII;
- uploaded file content.

## 24.3 Request + response pair

Use request property for start time.

```java
@Provider
public class AccessLogFilter implements ContainerRequestFilter, ContainerResponseFilter {

    @Override
    public void filter(ContainerRequestContext request) {
        request.setProperty("startNanos", System.nanoTime());
    }

    @Override
    public void filter(ContainerRequestContext request, ContainerResponseContext response) {
        long start = (long) request.getProperty("startNanos");
        long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);

        log.info("method={} status={} durationMs={}",
            request.getMethod(),
            response.getStatus(),
            durationMs
        );
    }
}
```

## 24.4 Route template

If available, use `UriInfo#getMatchedResourceTemplate()` in post-match/response.

## 24.5 Rule

Access logs are metadata logs, not body dumps.

---

# 25. Use Case: Security Headers Response Filter

## 25.1 Example

```java
@Provider
@Priority(Priorities.HEADER_DECORATOR)
public class SecurityHeadersFilter implements ContainerResponseFilter {

    @Override
    public void filter(ContainerRequestContext request, ContainerResponseContext response) {
        MultivaluedMap<String, Object> headers = response.getHeaders();

        headers.putSingle("X-Content-Type-Options", "nosniff");
        headers.putSingle("Referrer-Policy", "no-referrer");
        headers.putSingle("X-Frame-Options", "DENY");
        headers.putSingle("Content-Security-Policy", "default-src 'none'");
    }
}
```

## 25.2 API nuance

For pure JSON APIs, CSP may be less relevant but still can help if browser renders response.

## 25.3 HSTS

Usually set at gateway/server for HTTPS:

```http
Strict-Transport-Security
```

Only if HTTPS policy valid.

## 25.4 Do not override intentionally set headers

Use put-if-absent if resource has special policy.

## 25.5 Rule

Security headers are usually response filter/gateway concerns.

---

# 26. Use Case: Authentication Filter

Authentication filter establishes identity.

## 26.1 Example

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class BearerAuthenticationFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext ctx) {
        String authorization = ctx.getHeaderString(HttpHeaders.AUTHORIZATION);

        if (authorization == null || !authorization.startsWith("Bearer ")) {
            ctx.abortWith(unauthorized());
            return;
        }

        TokenPrincipal principal = tokenVerifier.verify(authorization.substring("Bearer ".length()));

        ctx.setSecurityContext(new ApiSecurityContext(
            principal,
            ctx.getSecurityContext().isSecure()
        ));
    }
}
```

## 26.2 SecurityContext

Set custom `SecurityContext` so resources can use:

```java
@Context SecurityContext security
```

## 26.3 401 headers

Include `WWW-Authenticate` where appropriate.

## 26.4 Avoid deep business logic

Authentication verifies identity/token, not domain access.

## 26.5 Rule

Authentication filter answers: who is calling?

---

# 27. Use Case: Authorization Filter

Authorization filter enforces coarse access policy.

## 27.1 Role-based

```java
@RequiresAdmin
@Provider
@Priority(Priorities.AUTHORIZATION)
public class RequiresAdminFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext ctx) {
        if (!ctx.getSecurityContext().isUserInRole("ADMIN")) {
            ctx.abortWith(forbidden());
        }
    }
}
```

## 27.2 Scope-based

```java
@RequiresScope("case:read")
```

Use DynamicFeature if annotation has value.

## 27.3 Domain/resource authorization

Still in service:

```java
caseService.getAccessibleCase(caseId, currentUser);
```

## 27.4 403 vs 404

Decide whether to hide resource existence.

## 27.5 Rule

Authorization filter answers coarse endpoint policy; service answers resource-specific policy.

---

# 28. Use Case: Tenant Resolution Filter

## 28.1 Sources

Tenant can come from:

- JWT claim;
- trusted gateway header;
- path segment;
- subdomain;
- mTLS cert.

## 28.2 Filter

```java
@Provider
@Priority(Priorities.AUTHORIZATION - 50)
public class TenantResolutionFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext ctx) {
        TenantId tenant = tenantResolver.resolve(ctx);
        ctx.setProperty("tenantId", tenant);
    }
}
```

## 28.3 Request-scoped bean

Better for app code:

```java
@Inject RequestMetadata metadata;
```

Filter sets metadata.

## 28.4 Security

Do not trust `X-Tenant-ID` from public client unless set by trusted proxy.

## 28.5 Rule

Tenant resolution is security-sensitive; centralize it.

---

# 29. Use Case: CORS Filter

CORS is browser security protocol.

## 29.1 Preflight request

```http
OPTIONS /api/customers
Origin: https://app.example.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: authorization, content-type
```

## 29.2 Pre-matching filter

CORS preflight often handled before resource matching.

```java
@Provider
@PreMatching
public class CorsPreflightFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext ctx) {
        if ("OPTIONS".equals(ctx.getMethod())
            && ctx.getHeaderString("Origin") != null
            && ctx.getHeaderString("Access-Control-Request-Method") != null) {

            ctx.abortWith(Response.noContent()
                .header("Access-Control-Allow-Origin", allowedOrigin(ctx))
                .header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
                .header("Access-Control-Allow-Headers", "authorization,content-type,idempotency-key")
                .header("Access-Control-Max-Age", "600")
                .build());
        }
    }
}
```

## 29.3 Response filter

Actual CORS response needs CORS headers too.

## 29.4 Security

Do not use `Access-Control-Allow-Origin: *` with credentials.

Validate origin allowlist.

## 29.5 Gateway

Often better handled at gateway.

## 29.6 Rule

CORS is not authentication; it controls browser access to responses.

---

# 30. Use Case: Cache Short-Circuit Filter

A request filter can serve cached response before resource method.

## 30.1 Pre-matching or post-matching?

Pre-matching if cache key independent of matched resource.

Post-matching if route/method annotations matter.

## 30.2 Example concept

```java
if (cacheHit) {
    ctx.abortWith(Response.ok(cachedBody)
        .tag(cachedEtag)
        .cacheControl(cacheControl)
        .build());
}
```

## 30.3 Caution

Cache must respect:

- method;
- URI;
- query;
- `Accept`;
- auth/user/tenant;
- `Vary`;
- authorization;
- invalidation.

## 30.4 Prefer infrastructure cache

Often CDN/gateway/application cache is better.

## 30.5 Rule

Cache filter is powerful but easy to make security bugs. Use carefully.

---

# 31. Use Case: Idempotency Filter

For unsafe operations like payment/order creation.

## 31.1 Responsibilities

- require idempotency key;
- validate key;
- check existing response/result;
- store in-progress marker;
- reject same key different body;
- replay same response if already completed.

## 31.2 Filter or service?

Boundary validation can be filter.

Full idempotency semantics often belongs in application service because it needs operation identity and transaction.

## 31.3 Filter use

Filter can validate header presence/format globally for annotated endpoints.

## 31.4 Dynamic binding

```java
@IdempotentCommand
```

with filter.

## 31.5 Rule

Do not hide business idempotency semantics entirely in filter if it depends on operation/domain transaction.

---

# 32. Use Case: Rate Limit Filter

## 32.1 Filter

```java
@Provider
@Priority(Priorities.AUTHORIZATION + 100)
public class RateLimitFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext ctx) {
        RateLimitDecision decision = rateLimiter.check(key(ctx));
        if (!decision.allowed()) {
            ctx.abortWith(Response.status(429)
                .header("Retry-After", decision.retryAfterSeconds())
                .type("application/problem+json")
                .entity(problem("RATE_LIMIT_EXCEEDED"))
                .build());
        }
    }
}
```

## 32.2 Key

Could be:

- API client;
- user;
- tenant;
- IP;
- route group.

## 32.3 Security

Do not trust IP without proxy config.

## 32.4 Headers

Consider standard rate limit headers if organization adopts them.

## 32.5 Rule

Rate limiting is boundary protection; policy storage/decision may be external.

---

# 33. Use Case: Request Method Override

Some clients cannot send PATCH/DELETE.

## 33.1 Header

```http
X-HTTP-Method-Override: PATCH
```

## 33.2 Pre-matching required

Because method affects resource matching.

```java
@PreMatching
public class MethodOverrideFilter implements ContainerRequestFilter {
    ...
}
```

## 33.3 Security

Allow only from trusted clients or specific methods.

Do not allow arbitrary override.

## 33.4 Audit

Log original and effective method.

## 33.5 Rule

Method override changes semantics; treat as compatibility escape hatch.

---

# 34. Use Case: Maintenance Mode / Feature Flag Filter

## 34.1 Global maintenance

```java
@Provider
@PreMatching
public class MaintenanceFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext ctx) {
        if (maintenanceMode.enabled()) {
            ctx.abortWith(Response.status(Response.Status.SERVICE_UNAVAILABLE)
                .header("Retry-After", "300")
                .type("application/problem+json")
                .entity(problem("SERVICE_UNAVAILABLE"))
                .build());
        }
    }
}
```

## 34.2 Endpoint feature flag

Use name binding or dynamic feature.

## 34.3 Avoid business flags in filter

If feature controls domain behavior, service should handle.

## 34.4 Rule

Filter is good for endpoint availability gates, not domain branching.

---

# 35. Entity Stream di Request Filter: Bahaya Membaca Body

## 35.1 Bad logging filter

```java
byte[] body = ctx.getEntityStream().readAllBytes();
log.info("body={}", new String(body, UTF_8));
```

Downstream resource receives consumed stream.

## 35.2 Reset if read

```java
byte[] body = ctx.getEntityStream().readAllBytes();
ctx.setEntityStream(new ByteArrayInputStream(body));
```

## 35.3 Still dangerous

- memory blow-up;
- PII leak;
- slow body read;
- breaks streaming;
- double parsing.

## 35.4 Safer

Do not read body in filter.

Log metadata:

```text
Content-Type
Content-Length
route
correlation ID
```

## 35.5 If signature verification needs body

Use bounded buffering or reader interceptor.

## 35.6 Rule

Request body is stream; filters should not consume it casually.

---

# 36. Response Entity di Response Filter: Kapan Aman, Kapan Tidak

## 36.1 Safe

Add headers:

```java
response.getHeaders().putSingle("X-Correlation-ID", id);
```

## 36.2 Risky

```java
Object entity = response.getEntity();
response.setEntity(wrap(entity));
```

Can break:

- generic type;
- message body writer selection;
- streaming output;
- file download;
- error contract.

## 36.3 Entity may be streaming

`StreamingOutput` cannot be inspected meaningfully.

## 36.4 If you need envelope

Better use DTO/resource design or writer interceptor.

## 36.5 Rule

Response filter should not transform entity body unless it is an intentional framework-level feature.

---

# 37. Filter dan Exception Handling

## 37.1 Throwing exception

Filter can throw:

```java
throw new NotAuthorizedException(...)
```

or custom exception.

Exception mappers can handle if response not committed.

## 37.2 `abortWith`

Use for expected early response.

## 37.3 Which is better?

Use `abortWith` when filter intentionally decides response.

Use exception when you want centralized mapper to format.

## 37.4 Consistency

If filter builds response manually, ensure same Problem Details format.

## 37.5 Rule

Do not let filters produce inconsistent error bodies.

---

# 38. Filter dan Problem Details

## 38.1 Helper

Centralize problem creation.

```java
ProblemResponse problem = problemFactory.of(
    "AUTHENTICATION_REQUIRED",
    401,
    correlationId
);
```

## 38.2 Abort response

```java
ctx.abortWith(Response.status(401)
    .type("application/problem+json")
    .entity(problem)
    .build());
```

## 38.3 Preserve headers

For auth:

```http
WWW-Authenticate
```

For rate limit:

```http
Retry-After
```

## 38.4 Global response filter

Add correlation ID even for errors.

## 38.5 Rule

Filter-generated errors must follow same error contract as exception mapper errors.

---

# 39. Filter dan Context Injection

Filters can use `@Context`.

## 39.1 Example

```java
@Provider
public class AuditFilter implements ContainerRequestFilter {

    @Context
    ResourceInfo resourceInfo;

    @Context
    HttpHeaders headers;

    @Override
    public void filter(ContainerRequestContext ctx) {
        ...
    }
}
```

## 39.2 Constructor warning

Do not call request-scoped context methods in constructor.

## 39.3 Method callback

Context is safe during filter callback.

## 39.4 Better

Often `ContainerRequestContext` already provides what you need.

## 39.5 Rule

Use `@Context` in filters, but respect request scope lifecycle.

---

# 40. Filter dan SecurityContext Override

Authentication filter can set security context.

## 40.1 Example

```java
ctx.setSecurityContext(new SecurityContext() {
    @Override
    public Principal getUserPrincipal() {
        return principal;
    }

    @Override
    public boolean isUserInRole(String role) {
        return roles.contains(role);
    }

    @Override
    public boolean isSecure() {
        return original.isSecure();
    }

    @Override
    public String getAuthenticationScheme() {
        return "Bearer";
    }
});
```

## 40.2 Preserve original data

Preserve `isSecure()` from original unless intentionally changed.

## 40.3 Role mapping

Map token scopes/claims to roles carefully.

## 40.4 Service layer

Convert security context to `CurrentUser`.

## 40.5 Rule

SecurityContext is boundary identity context, not full domain authorization.

---

# 41. Filter dan Request Properties

Request properties are useful for passing metadata along the request pipeline.

## 41.1 Set property

```java
ctx.setProperty("correlationId", correlationId);
```

## 41.2 Get property in response filter

```java
String correlationId = (String) request.getProperty("correlationId");
```

## 41.3 Use cases

- start time;
- correlation ID;
- auth result;
- tenant ID;
- rate limit decision;
- route group;
- audit metadata.

## 41.4 Avoid

Do not use properties as hidden business parameter bus.

## 41.5 Prefer typed request-scoped bean

For application code, use `RequestMetadata`.

## 41.6 Rule

Request properties are pipeline metadata, not domain model.

---

# 42. Filter dan Async/Threading

## 42.1 Request context lifecycle

Filter runs on request processing thread/context.

## 42.2 Async resource

If resource dispatches work to another thread, request properties/context may not propagate automatically.

## 42.3 Capture immutable metadata

```java
String correlationId = (String) ctx.getProperty("correlationId");
```

Pass value explicitly.

## 42.4 MDC

MDC is thread-local. Needs propagation/clear.

## 42.5 Rule

Do not assume filter-established thread-local state exists in async execution.

---

# 43. Filter dan Streaming Response

## 43.1 Response filter before write

Response filter runs before entity is written.

## 43.2 Streaming error

If streaming fails later, response filter cannot fix status/body after commit.

## 43.3 Metrics

Response filter may record response creation duration, not full streaming completion unless output stream wrapped/interceptor used.

## 43.4 Headers

Set streaming headers before response commit.

## 43.5 Rule

For stream byte-level monitoring/transformation, use writer interceptor or lower-level server hooks.

---

# 44. Filter dan Compression/Encryption: Kenapa Biasanya Interceptor

## 44.1 Filter sees metadata

Good for headers.

## 44.2 Interceptor wraps entity stream

Compression/encryption requires wrapping input/output stream.

Use:

```java
ReaderInterceptor
WriterInterceptor
```

## 44.3 Filter can set header

But actual compression should happen at stream level.

## 44.4 Usually gateway/server

HTTP compression often handled by server/gateway.

## 44.5 Rule

If concern modifies entity bytes, think interceptor, not filter.

---

# 45. Filter dan Gateway/Reverse Proxy

## 45.1 Forwarded headers

Filters may inspect:

```text
Forwarded
X-Forwarded-For
X-Forwarded-Proto
X-Forwarded-Host
X-Request-ID
```

## 45.2 Trust boundary

Only trust forwarded headers from known proxy.

## 45.3 Client IP

Do not use raw `X-Forwarded-For` from public traffic unless gateway sanitizes it.

## 45.4 Correlation ID

Gateway may generate request ID.

App filter should adopt or generate.

## 45.5 Security headers

Some response headers may be added by gateway instead of app.

Avoid conflicting duplication.

## 45.6 Rule

Filter behavior must match deployment topology.

---

# 46. Filter dan Observability

## 46.1 Metrics

Use filter for request duration/status metrics.

## 46.2 Route template

Post-match response filter can use `UriInfo#getMatchedResourceTemplate()` where available.

## 46.3 Error code

If error entity is Problem Details, extract safe error code carefully or set request property from mapper.

## 46.4 Logs

Access log filter can emit one log per request.

## 46.5 Tracing

OpenTelemetry may already instrument server.

Custom filter can add domain-safe attributes:

- tenant category;
- route group;
- auth scheme;
- error code.

## 46.6 Avoid high cardinality

Do not label by:

- raw path;
- customer ID;
- email;
- token;
- correlation ID.

## 46.7 Rule

Filters are good observability hooks, but cardinality/privacy rules still apply.

---

# 47. Filter Design Guidelines

## 47.1 Single responsibility

One filter should do one concern.

Good:

```text
CorrelationIdFilter
AuthenticationFilter
SecurityHeadersFilter
```

Bad:

```text
MegaRequestFilter
```

## 47.2 Explicit priority

If order matters, annotate.

## 47.3 Pure metadata operations

Avoid DB/remote calls unless concern requires it.

## 47.4 Fast

Filters run for many/all requests.

## 47.5 Safe failure

If observability filter fails, should it fail request? Usually no.

If auth filter fails, yes.

## 47.6 Document scope

Global, name-bound, dynamic, pre-match.

## 47.7 Rule

A filter should be easy to reason about in the request pipeline.

---

# 48. Testing Filters

## 48.1 Unit test

Directly mock/stub `ContainerRequestContext`.

Good for simple logic.

## 48.2 Integration test

Required for:

- registration/discovery;
- priority order;
- name binding;
- abortWith chain behavior;
- response filter behavior;
- CORS preflight;
- security context propagation.

## 48.3 Test cases

- filter runs where expected;
- filter does not run where not expected;
- abort response has Problem Details;
- response headers added on success and error;
- priorities respected;
- request body not consumed;
- CORS headers correct;
- auth sets `SecurityContext`.

## 48.4 Order test

Use test filters that append to header/property:

```text
A-request
B-request
B-response
A-response
```

## 48.5 Runtime test

Directly invoking resource method does not test filters.

## 48.6 Rule

Filter tests must go through JAX-RS runtime.

---

# 49. Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus

## 49.1 Spec behavior

Core interfaces/annotations are standard.

## 49.2 Differences

- provider scanning/discovery;
- CDI injection into filters;
- priority diagnostics;
- exception wrapping;
- preflight defaults;
- route template availability;
- reactive/non-blocking constraints;
- build-time indexing.

## 49.3 Quarkus

RESTEasy Reactive may have blocking/non-blocking considerations and build-time provider discovery.

## 49.4 Jersey/RESTEasy/CXF

Each has extensions for resource model introspection/logging.

## 49.5 Rule

Avoid non-standard filter behavior unless documented and tested.

---

# 50. Migration: `javax.ws.rs.container` ke `jakarta.ws.rs.container`

## 50.1 Old imports

```java
import javax.ws.rs.container.ContainerRequestFilter;
import javax.ws.rs.container.ContainerResponseFilter;
import javax.ws.rs.ext.Provider;
```

## 50.2 New imports

```java
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.ext.Provider;
```

## 50.3 Mixed namespace trap

A `javax.ws.rs.container.ContainerRequestFilter` is not Jakarta REST 4 filter.

It will not be discovered/used by Jakarta runtime.

## 50.4 Also update

- `@NameBinding`;
- `@PreMatching`;
- `Priorities`;
- `Response`;
- `HttpHeaders`;
- exception classes.

## 50.5 Test

If auth/logging/correlation stops, check imports/provider registration.

## 50.6 Rule

Migration includes filters and provider annotations, not only resources.

---

# 51. Common Failure Modes

## 51.1 Filter missing `@Provider`

Never runs.

## 51.2 Wrong namespace `javax`

Not discovered in Jakarta runtime.

## 51.3 Body logging consumes stream

Resource receives empty body.

## 51.4 Pre-matching used unnecessarily

Name binding ignored; route behavior changes.

## 51.5 Priority not set

Order implementation-defined.

## 51.6 Same priority dependency

Works locally, breaks in another runtime.

## 51.7 `abortWith` response inconsistent

Different error contract.

## 51.8 401 response missing `WWW-Authenticate`

Auth clients break.

## 51.9 CORS wildcard with credentials

Browser/security issue.

## 51.10 Raw headers/body logged

Secret/PII leak.

## 51.11 Manual response entity wrapping

Writer errors.

## 51.12 SecurityContext not set correctly

`isSecure` or roles wrong.

## 51.13 MDC not cleared

Correlation leak between requests.

## 51.14 Filter does DB call on every request

Latency/capacity problem.

---

# 52. Best Practices

## 52.1 Keep filters focused

One concern per filter.

## 52.2 Use explicit priority

Especially auth/logging/security headers.

## 52.3 Prefer post-matching by default

Use pre-matching only when required.

## 52.4 Use name binding for endpoint-specific policy

Avoid global filter with giant if/else.

## 52.5 Do not read body in filter

Unless bounded and replaced.

## 52.6 Use Problem Details consistently

Even for `abortWith`.

## 52.7 Preserve HTTP semantics

Auth headers, retry headers, CORS headers.

## 52.8 Keep business logic out

Service/domain owns business.

## 52.9 Test via runtime

Registration/order/name binding/abort cannot be proven by direct method call.

## 52.10 Redact aggressively

Headers, cookies, query, body.

---

# 53. Anti-Patterns

## 53.1 Mega filter

One class handles auth/logging/tenant/CORS/idempotency/business.

## 53.2 Business workflow in filter

Hidden domain logic.

## 53.3 `@PreMatching` everywhere

Bypasses name binding and surprises routing.

## 53.4 Reading entity stream for logging

Breaks request body binding.

## 53.5 Returning ad-hoc JSON error

Not Problem Details.

## 53.6 No priority

Accidental ordering.

## 53.7 Trusting forwarded headers

Spoofing risk.

## 53.8 Using filter instead of interceptor for body compression

Wrong extension point.

## 53.9 Direct resource tests only

Filters untested.

## 53.10 Catching all exceptions in filter

ExceptionMapper bypassed/inconsistent.

---

# 54. Production Checklist

## 54.1 Registration and scope

- [ ] Each filter has `@Provider` or explicit registration.
- [ ] Namespace is `jakarta.*`.
- [ ] Filter scope documented: global/name-bound/dynamic.
- [ ] Pre-matching use justified.
- [ ] Name binding tested.

## 54.2 Ordering

- [ ] `@Priority` set when order matters.
- [ ] Authentication before authorization.
- [ ] Correlation ID early.
- [ ] Response header filters run for abort/error responses.
- [ ] Same-priority dependency avoided.

## 54.3 Security

- [ ] Authorization not hidden as domain logic.
- [ ] SecurityContext set correctly.
- [ ] `WWW-Authenticate` preserved.
- [ ] CORS allowlist correct.
- [ ] Forwarded headers trusted only from proxy.
- [ ] Sensitive headers/body redacted.
- [ ] MDC cleared.

## 54.4 Body/stream

- [ ] Request body not read in filter unless bounded and reset.
- [ ] Streaming response caveats understood.
- [ ] Entity transformation uses interceptor if needed.

## 54.5 Error

- [ ] `abortWith` uses Problem Details.
- [ ] Retry/rate/auth headers included.
- [ ] Exception mapper not bypassed accidentally.
- [ ] Filter failures mapped/logged safely.

## 54.6 Observability

- [ ] Metrics use route template, not raw path.
- [ ] No high-cardinality labels.
- [ ] Correlation ID in response.
- [ ] Access logs metadata-only.
- [ ] 4xx/5xx separated.

## 54.7 Testing

- [ ] Runtime integration tests for every filter.
- [ ] Order tests.
- [ ] Abort tests.
- [ ] Name-binding tests.
- [ ] CORS tests.
- [ ] SecurityContext tests.
- [ ] Body-not-consumed tests.

---

# 55. Latihan

## Latihan 1 — Correlation ID Filter

Implement request + response filter:

- read `X-Correlation-ID`;
- validate/generate;
- set request property;
- set MDC;
- return header on every response;
- clear MDC.

Test success, error, abort.

## Latihan 2 — Access Log Filter

Log metadata:

- method;
- route template;
- status;
- duration;
- correlation ID.

Do not log body or Authorization/Cookie.

## Latihan 3 — Auth Filter

Implement bearer token filter:

- missing token → 401 Problem Details + `WWW-Authenticate`;
- valid token → set SecurityContext;
- invalid token → 401.

## Latihan 4 — Name-Bound Admin Filter

Create:

```java
@RequiresAdmin
```

Apply only to admin endpoint.

Test non-admin endpoint unaffected.

## Latihan 5 — Priority Order

Create three filters:

- correlation;
- authentication;
- authorization.

Assert order via request properties/log header.

## Latihan 6 — CORS

Implement preflight handling.

Test:

- allowed origin;
- disallowed origin;
- credentials policy;
- preflight headers.

## Latihan 7 — Body Consumption Trap

Write body logging filter that consumes stream.

Observe DTO endpoint broken.

Fix by removing body logging or bounded reset.

## Latihan 8 — Rate Limit Filter

Create name-bound `@RateLimited`.

Return 429 with Problem Details and `Retry-After`.

## Latihan 9 — DynamicFeature

Create annotation:

```java
@Audit(action = "CREATE_CUSTOMER")
```

Use `DynamicFeature` to bind audit filter with action value.

---

# 56. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 — `ContainerRequestFilter` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/containerrequestfilter

2. Jakarta RESTful Web Services 4.0 — `ContainerResponseFilter` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/containerresponsefilter

3. Jakarta RESTful Web Services 4.0 — `ContainerRequestContext` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/containerrequestcontext

4. Jakarta RESTful Web Services 4.0 — `ContainerResponseContext` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/containerresponsecontext

5. Jakarta RESTful Web Services 4.0 — `PreMatching` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/prematching

6. Jakarta RESTful Web Services 4.0 — `NameBinding` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/namebinding

7. Jakarta RESTful Web Services 4.0 — `Priorities` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/priorities

8. Jakarta RESTful Web Services 4.0 — `DynamicFeature` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/dynamicfeature

9. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

10. Jakarta EE Tutorial — Jakarta REST Advanced Topics  
    https://jakarta.ee/learn/docs/jakartaee-tutorial/current/websvcs/rest-advanced/rest-advanced.html

11. Jersey Documentation — Filters and Interceptors  
    https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest/filters-and-interceptors.html

12. RESTEasy User Guide — Interceptors and Filters  
    https://docs.resteasy.dev/5.0/userguide/html/ch31.html

---

# 57. Penutup

Filter adalah extension point yang sangat kuat.

Mental model final:

```text
request metadata enters
  ↓
pre-matching filters may alter matching input or short-circuit
  ↓
JAX-RS matches resource
  ↓
post-matching filters enforce endpoint-aware policy
  ↓
resource method runs
  ↓
response filters decorate outgoing response
  ↓
entity writer/interceptors produce bytes
```

Prinsip penting:

```text
Filter is for cross-cutting HTTP/resource-boundary concerns.
Interceptor is for entity stream concerns.
Service/domain is for business concerns.
```

Top-tier JAX-RS engineer memastikan:

- filter scope jelas;
- order eksplisit;
- auth/authz terpisah;
- body tidak dibaca sembarangan;
- error contract konsisten;
- response headers konsisten;
- observability rendah-cardinality;
- forwarded headers aman;
- CORS tidak disalahpahami sebagai security utama;
- semua filter dites via runtime.

Part berikutnya:

```text
Bagian 016 — Interceptors: ReaderInterceptor and WriterInterceptor
```

Kita akan membahas entity stream interception: reader/writer interceptor pipeline, compression/encryption/signature, body hash, logging pitfalls, priority, name binding, interaction with MessageBodyReader/Writer, and production-safe stream transformation.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-jaxrs-advanced-part-014.md">⬅️ Bagian 014 — Validation Integration: Jakarta Validation at REST Boundary, `@Valid`, Parameter Validation, Entity Validation, Groups, Cross-Field Constraint, dan Error Mapping</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-jaxrs-advanced-part-016.md">Bagian 016 — Interceptors: `ReaderInterceptor`, `WriterInterceptor`, Entity Stream Pipeline, Compression, Encryption, Signature, Body Hash, Priority, Name Binding, dan Production-Safe Stream Transformation ➡️</a>
</div>
