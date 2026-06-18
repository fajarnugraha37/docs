# learn-jaxrs-advanced-part-031.md

# Bagian 031 — CDI Integration and Resource/Provider Injection: Resource Lifecycle, Provider Lifecycle, `@Inject`, `@Context`, Scopes, Proxies, Request Context, Thread Safety, Testing, and Production Patterns

> Target pembaca: Java/Jakarta engineer yang ingin memahami **integrasi CDI dengan Jakarta REST/JAX-RS** secara production-grade. Fokus bagian ini bukan hanya “bisa inject service ke resource”, tetapi memahami dua component model yang bertemu: lifecycle resource/provider Jakarta REST, lifecycle CDI bean, scope, proxy, request context, provider singleton caveats, subresource injection, filters/interceptors, async boundary, testing, dan runtime-specific behavior.
>
> Namespace utama: `jakarta.inject.Inject`, `jakarta.enterprise.context.ApplicationScoped`, `RequestScoped`, `Dependent`, `jakarta.ws.rs.core.Context`, `jakarta.ws.rs.ApplicationPath`, `jakarta.ws.rs.core.Application`, `jakarta.ws.rs.ext.Provider`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Dua Component Model Bertemu](#2-mental-model-dua-component-model-bertemu)
3. [Jakarta REST Component Model](#3-jakarta-rest-component-model)
4. [CDI Component Model](#4-cdi-component-model)
5. [Resource Class sebagai CDI Bean](#5-resource-class-sebagai-cdi-bean)
6. [Provider sebagai CDI Bean](#6-provider-sebagai-cdi-bean)
7. [`@Inject` vs `@Context`](#7-inject-vs-context)
8. [Constructor Injection](#8-constructor-injection)
9. [Field Injection](#9-field-injection)
10. [Method/Setter Injection](#10-methodsetter-injection)
11. [Scope: `@RequestScoped`](#11-scope-requestscoped)
12. [Scope: `@ApplicationScoped`](#12-scope-applicationscoped)
13. [Scope: `@Dependent`](#13-scope-dependent)
14. [Scope Selection for Resources](#14-scope-selection-for-resources)
15. [Scope Selection for Providers](#15-scope-selection-for-providers)
16. [Provider Singleton Caveat](#16-provider-singleton-caveat)
17. [Mutable State and Thread Safety](#17-mutable-state-and-thread-safety)
18. [CDI Proxies](#18-cdi-proxies)
19. [Unproxyable Types](#19-unproxyable-types)
20. [Qualifiers](#20-qualifiers)
21. [Alternatives and Specialization](#21-alternatives-and-specialization)
22. [Producers](#22-producers)
23. [Disposers](#23-disposers)
24. [Events](#24-events)
25. [Interceptors and Decorators](#25-interceptors-and-decorators)
26. [`@Context` Objects](#26-context-objects)
27. [`UriInfo`, `HttpHeaders`, `SecurityContext`, `Request`](#27-uriinfo-httpheaders-securitycontext-request)
28. [Do Not Store Request Context Objects in Singletons](#28-do-not-store-request-context-objects-in-singletons)
29. [ResourceContext and Subresource Injection](#29-resourcecontext-and-subresource-injection)
30. [Application Class and Registration](#30-application-class-and-registration)
31. [`Application#getClasses()` vs CDI Discovery](#31-applicationgetclasses-vs-cdi-discovery)
32. [`Application#getSingletons()` Deprecated Caveat](#32-applicationgetsingletons-deprecated-caveat)
33. [Filters and CDI](#33-filters-and-cdi)
34. [Interceptors and CDI](#34-interceptors-and-cdi)
35. [ExceptionMapper and CDI](#35-exceptionmapper-and-cdi)
36. [MessageBodyReader/Writer and CDI](#36-messagebodyreaderwriter-and-cdi)
37. [DynamicFeature and CDI](#37-dynamicfeature-and-cdi)
38. [Name Binding and CDI](#38-name-binding-and-cdi)
39. [Validation and CDI](#39-validation-and-cdi)
40. [Transactions and CDI Boundary](#40-transactions-and-cdi-boundary)
41. [Security Context to CurrentActor](#41-security-context-to-currentactor)
42. [Multi-Tenancy Context](#42-multi-tenancy-context)
43. [Request Context Propagation](#43-request-context-propagation)
44. [Async Boundary Caveat](#44-async-boundary-caveat)
45. [SSE/Streaming Boundary Caveat](#45-ssestreaming-boundary-caveat)
46. [Client API Beans](#46-client-api-beans)
47. [Configuration Injection](#47-configuration-injection)
48. [Testing CDI + JAX-RS](#48-testing-cdi--jax-rs)
49. [Mocking Beans](#49-mocking-beans)
50. [Integration Testing](#50-integration-testing)
51. [Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus](#51-runtime-differences-jersey-resteasy-cxf-liberty-quarkus)
52. [Migration Notes: javax to jakarta and ManagedBean Removal](#52-migration-notes-javax-to-jakarta-and-managedbean-removal)
53. [Observability](#53-observability)
54. [Common Failure Modes](#54-common-failure-modes)
55. [Best Practices](#55-best-practices)
56. [Anti-Patterns](#56-anti-patterns)
57. [Production Checklist](#57-production-checklist)
58. [Latihan](#58-latihan)
59. [Referensi Resmi](#59-referensi-resmi)
60. [Penutup](#60-penutup)

---

# 1. Tujuan Part Ini

Di aplikasi Jakarta REST modern, resource class jarang berdiri sendiri.

Biasanya resource akan memakai:

```text
service
repository
mapper
validator
security context
tenant context
transaction boundary
configuration
client gateway
metrics/tracing
```

Contoh:

```java
@Path("/customers")
@RequestScoped
public class CustomerResource {

    private final CustomerService customerService;
    private final CurrentActorProvider actorProvider;

    @Inject
    public CustomerResource(
        CustomerService customerService,
        CurrentActorProvider actorProvider
    ) {
        this.customerService = customerService;
        this.actorProvider = actorProvider;
    }

    @GET
    @Path("/{id}")
    public CustomerResponse get(@PathParam("id") CustomerId id) {
        return customerService.getCustomer(actorProvider.currentActor(), id);
    }
}
```

Pertanyaannya bukan hanya “bisa inject atau tidak”.

Pertanyaan production:

- resource class dibuat oleh JAX-RS runtime atau CDI?
- scope resource apa?
- provider singleton atau CDI scoped?
- apakah `@Context` aman disimpan?
- apakah filter/provider thread-safe?
- kapan pakai `@Inject`, kapan pakai `@Context`?
- apakah request scope aktif di async worker?
- bagaimana mocking service untuk tests?
- apa konsekuensi `Application#getSingletons()`?
- bagaimana runtime Jersey/RESTEasy/CXF/Liberty/Quarkus berbeda?

## 1.1 Prinsip utama

```text
JAX-RS controls HTTP/resource/provider model.
CDI controls dependency injection, scopes, lifecycle, interceptors, and contextual beans.
A production app must make the boundary explicit.
```

---

# 2. Mental Model: Dua Component Model Bertemu

Jakarta REST punya model:

```text
@Path resource classes
@Provider extension classes
Application registration
request matching
HTTP context injection
message body providers
filters/interceptors
exception mappers
```

CDI punya model:

```text
bean discovery
@ApplicationScoped
@RequestScoped
@Dependent
qualifiers
producers
interceptors
events
decorators
alternatives
```

Integrasi CDI + JAX-RS berarti:

```text
JAX-RS component may also be CDI bean.
CDI services may be injected into JAX-RS components.
JAX-RS request context objects may be injected via @Context.
```

## 2.1 Kenapa ini penting?

Jika kamu salah memahami lifecycle:

- provider menyimpan mutable state lintas request;
- request-scoped bean dipakai di background thread;
- `SecurityContext` disimpan di singleton;
- entity manager dipakai setelah request selesai;
- tests gagal karena resource dibuat manual tanpa injection;
- runtime behavior beda antara local dan server.

## 2.2 Top-tier rule

```text
Never assume lifecycle. Declare scope and design state accordingly.
```

---

# 3. Jakarta REST Component Model

Jakarta REST components include:

- root resource classes;
- subresource classes;
- providers;
- filters;
- interceptors;
- exception mappers;
- features;
- dynamic features;
- entity providers.

## 3.1 Resource class

Class annotated with `@Path`.

```java
@Path("/customers")
public class CustomerResource { ... }
```

## 3.2 Provider

Class annotated with `@Provider`.

```java
@Provider
public class ProblemExceptionMapper implements ExceptionMapper<Throwable> { ... }
```

## 3.3 Registration

Components may be discovered or registered through `Application`.

## 3.4 Default lifecycle from Jakarta REST

Jakarta REST `Application` docs state default resource class lifecycle is per-request and default provider lifecycle is singleton when classes are returned from `getClasses()`.

## 3.5 Rule

Understand whether a class is managed as JAX-RS component, CDI bean, or both.

---

# 4. CDI Component Model

CDI defines contextual lifecycle and dependency injection.

## 4.1 Bean

A class can be CDI bean if discovered and satisfies bean rules.

## 4.2 Injection

```java
@Inject
CustomerService customerService;
```

## 4.3 Scopes

Common scopes:

```text
@ApplicationScoped
@RequestScoped
@Dependent
@SessionScoped
```

For REST APIs, `@ApplicationScoped`, `@RequestScoped`, and `@Dependent` are most common.

## 4.4 Context

A scope has an active context. Request scope is active during request processing.

## 4.5 Rule

CDI scope controls bean instance lifecycle, not HTTP semantics directly.

---

# 5. Resource Class sebagai CDI Bean

Resource class can be CDI-managed if discovered as CDI bean.

## 5.1 Example

```java
@Path("/customers")
@RequestScoped
public class CustomerResource {

    private final CustomerService service;

    @Inject
    public CustomerResource(CustomerService service) {
        this.service = service;
    }
}
```

## 5.2 Benefit

- constructor injection;
- interceptors;
- qualifiers;
- config injection;
- testability;
- lifecycle callbacks.

## 5.3 Scope choice matters

`@RequestScoped` resource gets one contextual instance per request.

`@ApplicationScoped` resource is shared and must be thread-safe.

## 5.4 Rule

Prefer CDI-managed resource classes with explicit scope.

---

# 6. Provider sebagai CDI Bean

Providers can also use CDI injection.

```java
@Provider
@ApplicationScoped
public class ProblemExceptionMapper implements ExceptionMapper<Throwable> {

    @Inject
    ProblemFactory problemFactory;

    @Override
    public Response toResponse(Throwable exception) {
        return problemFactory.toResponse(exception);
    }
}
```

## 6.1 Common providers

- `ExceptionMapper`;
- `ContainerRequestFilter`;
- `ContainerResponseFilter`;
- `MessageBodyReader`;
- `MessageBodyWriter`;
- `ReaderInterceptor`;
- `WriterInterceptor`;
- `DynamicFeature`.

## 6.2 Provider lifecycle caution

JAX-RS providers are often effectively singleton-like.

If CDI scopes them, behavior depends on integration/runtime.

## 6.3 Rule

Design providers as stateless/thread-safe unless scope and runtime behavior are verified.

---

# 7. `@Inject` vs `@Context`

## 7.1 `@Inject`

CDI dependency injection.

Use for application beans:

- services;
- repositories;
- mappers;
- config;
- gateways;
- current actor provider;
- tenant resolver;
- clock.

```java
@Inject
CustomerService service;
```

## 7.2 `@Context`

JAX-RS context injection.

Use for request/runtime objects:

- `UriInfo`;
- `HttpHeaders`;
- `Request`;
- `SecurityContext`;
- `Providers`;
- `ResourceContext`;
- `Application`;
- `Configuration`.

```java
@Context
UriInfo uriInfo;
```

## 7.3 Rule

Use `@Inject` for your application dependencies. Use `@Context` for JAX-RS runtime/request context.

---

# 8. Constructor Injection

Constructor injection is preferred for required dependencies.

## 8.1 Example

```java
@RequestScoped
@Path("/orders")
public class OrderResource {

    private final OrderService orderService;
    private final OrderMapper mapper;

    @Inject
    public OrderResource(OrderService orderService, OrderMapper mapper) {
        this.orderService = orderService;
        this.mapper = mapper;
    }
}
```

## 8.2 Benefits

- dependencies explicit;
- immutable fields;
- easier unit testing;
- no partially initialized object.

## 8.3 JAX-RS runtime caveat

If resource is not CDI-managed, constructor injection may not work.

## 8.4 Rule

Use constructor injection when CDI manages the resource/provider.

---

# 9. Field Injection

Field injection is common but less ideal.

```java
@Inject
CustomerService service;
```

## 9.1 Pros

- concise;
- common in examples.

## 9.2 Cons

- hidden dependencies;
- harder unit testing;
- mutable fields;
- reflection/proxy reliance.

## 9.3 Good use

Sometimes acceptable for `@Context` runtime objects:

```java
@Context
UriInfo uriInfo;
```

because they are request/runtime-provided.

## 9.4 Rule

Prefer constructor injection for CDI dependencies; use field injection sparingly.

---

# 10. Method/Setter Injection

```java
@Inject
void init(CustomerService service) {
    this.service = service;
}
```

## 10.1 Use cases

- optional setup;
- circular dependency workaround;
- framework compatibility.

## 10.2 Avoid for normal required deps

Constructor injection is clearer.

## 10.3 Rule

Setter/method injection is specialized, not default.

---

# 11. Scope: `@RequestScoped`

`@RequestScoped` creates one contextual instance per request.

## 11.1 Good for resources

```java
@Path("/customers")
@RequestScoped
public class CustomerResource { ... }
```

## 11.2 Benefits

- request state can be stored safely in fields if needed;
- no cross-request concurrency on same instance;
- natural for request-level resource classes.

## 11.3 Caveat

Request-scoped bean only valid when request context active.

Async/background thread may not have active request context.

## 11.4 Rule

`@RequestScoped` is a safe default for resource classes.

---

# 12. Scope: `@ApplicationScoped`

`@ApplicationScoped` has one contextual instance for application.

## 12.1 Good for stateless services

```java
@ApplicationScoped
public class CustomerService { ... }
```

## 12.2 Good for expensive shared objects

- mappers;
- client factories;
- caches;
- configuration;
- policy registries.

## 12.3 Dangerous for resources/providers if mutable

```java
@ApplicationScoped
@Path("/customers")
public class CustomerResource {
    private CustomerId currentId; // bad
}
```

## 12.4 Rule

Application-scoped beans must be thread-safe.

---

# 13. Scope: `@Dependent`

`@Dependent` means dependent object lifecycle follows injection target.

## 13.1 Default CDI scope

If no scope, many beans are dependent.

## 13.2 Good for lightweight helpers

```java
@Dependent
public class CustomerMapper { ... }
```

## 13.3 Caveat

If injected into singleton provider, dependent object effectively lives as long as provider.

## 13.4 Rule

Know where dependent beans are injected; their lifecycle follows owner.

---

# 14. Scope Selection for Resources

## 14.1 Default recommendation

```java
@RequestScoped
@Path("/...")
public class SomeResource { ... }
```

## 14.2 Use ApplicationScoped only if

- resource is stateless;
- all dependencies thread-safe;
- no request fields;
- performance/lifecycle reason exists.

## 14.3 Avoid storing request state

Even in request-scoped resource, prefer method locals for clarity.

## 14.4 Rule

Make resource scope explicit.

---

# 15. Scope Selection for Providers

## 15.1 ExceptionMapper

Usually stateless, can be `@ApplicationScoped`.

## 15.2 Filters

Usually stateless; use request context via method local.

## 15.3 MessageBodyReader/Writer

Must be thread-safe if singleton/application-scoped.

## 15.4 DynamicFeature

Deployment-time config; usually stateless.

## 15.5 Rule

Providers should be stateless and application-scoped unless you have a strong reason otherwise.

---

# 16. Provider Singleton Caveat

JAX-RS `Application#getClasses()` default provider lifecycle is singleton.

CDI may also inject proxies into provider.

## 16.1 Problem

```java
@Provider
public class AuthFilter implements ContainerRequestFilter {
    private User currentUser; // bad
}
```

A provider instance may handle many concurrent requests.

## 16.2 Correct

```java
public void filter(ContainerRequestContext ctx) {
    CurrentActor actor = authenticate(ctx);
    ctx.setProperty("currentActor", actor);
}
```

Use local variables/request properties/request-scoped beans.

## 16.3 Rule

Never store per-request mutable state in providers.

---

# 17. Mutable State and Thread Safety

## 17.1 Unsafe

```java
@ApplicationScoped
public class RequestCounter {
    private int count;

    public void increment() {
        count++;
    }
}
```

## 17.2 Safe alternatives

- stateless;
- immutable;
- atomic;
- concurrent collections;
- request-scoped state;
- external storage.

## 17.3 Provider example

```java
private final DateFormat formatter = new SimpleDateFormat(...); // bad
```

Use thread-safe `DateTimeFormatter`.

## 17.4 Rule

Shared bean + mutable state = concurrency design required.

---

# 18. CDI Proxies

CDI often injects proxies for normal scoped beans.

## 18.1 Example

`@RequestScoped CurrentRequest` injected into `@ApplicationScoped` service may be proxy.

At call time, proxy resolves current request instance.

## 18.2 Benefit

Allows injecting shorter-lived bean into longer-lived bean safely if context active.

## 18.3 Caveat

If context inactive, access fails.

## 18.4 Rule

A proxy is not the actual instance; it resolves context at invocation time.

---

# 19. Unproxyable Types

Some classes cannot be proxied by CDI depending rules.

Examples may include:

- final class;
- no non-private no-arg constructor;
- final methods;
- primitive/array types in certain contexts.

## 19.1 Fix

- use interface;
- avoid final class/method for normal-scoped beans;
- use `@Dependent`;
- provide no-arg constructor if needed;
- runtime-specific proxy support may vary.

## 19.2 Records

Java records are final and not suitable as normal-scoped CDI beans.

They are fine as DTOs.

## 19.3 Rule

Design CDI beans to be proxyable unless dependent.

---

# 20. Qualifiers

Qualifiers distinguish beans of same type.

## 20.1 Example

```java
@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD, TYPE })
public @interface PrimaryStorage {}
```

```java
@Inject
@PrimaryStorage
ObjectStorage storage;
```

## 20.2 Use cases

- primary vs quarantine storage;
- internal vs external client;
- read vs write repository;
- mapper variants.

## 20.3 Rule

Use qualifiers instead of string-based service lookup.

---

# 21. Alternatives and Specialization

Alternatives allow swapping implementation.

## 21.1 Test

```java
@Alternative
@Priority(1)
public class FakeObjectStorage implements ObjectStorage { ... }
```

## 21.2 Environment-specific

- local dev;
- integration test;
- production.

## 21.3 Rule

Alternatives are useful for tests and deployment variants.

---

# 22. Producers

Producer methods create beans.

## 22.1 Example Client

```java
@ApplicationScoped
public class ClientProducer {

    @Produces
    @ApplicationScoped
    @DownstreamCustomer
    Client customerClient() {
        return ClientBuilder.newBuilder()
            .connectTimeout(500, TimeUnit.MILLISECONDS)
            .readTimeout(2, TimeUnit.SECONDS)
            .build();
    }
}
```

## 22.2 Config-based producer

Create downstream client from config.

## 22.3 Rule

Use producers for external resources requiring construction logic.

---

# 23. Disposers

Disposer methods clean producer-created resources.

## 23.1 Example

```java
void closeCustomerClient(@Disposes @DownstreamCustomer Client client) {
    client.close();
}
```

## 23.2 Important

For clients, executor, object storage connectors.

## 23.3 Rule

Every producer that creates closeable resource should have lifecycle cleanup.

---

# 24. Events

CDI events can decouple internal components.

## 24.1 Example

```java
@Inject
Event<DocumentUploaded> uploadedEvent;

uploadedEvent.fire(new DocumentUploaded(documentId));
```

## 24.2 Caveat

CDI events are in-process, not distributed.

## 24.3 For domain events

Use outbox/message broker for cross-service durability.

## 24.4 Rule

CDI events are useful inside one app, not substitute for integration events.

---

# 25. Interceptors and Decorators

CDI interceptors can implement cross-cutting behavior.

## 25.1 Examples

- transaction;
- audit;
- authorization;
- metrics;
- retry/fault tolerance;
- idempotency.

## 25.2 Resource methods

If resource is CDI-managed, interceptors may apply.

## 25.3 Caveat

Interceptors apply based on CDI/proxy invocation rules. Self-invocation may bypass.

## 25.4 Rule

Use CDI interceptors for application-layer concerns, JAX-RS filters for HTTP-layer concerns.

---

# 26. `@Context` Objects

Common `@Context` injectables:

- `UriInfo`;
- `HttpHeaders`;
- `Request`;
- `SecurityContext`;
- `Providers`;
- `ResourceContext`;
- `Application`;
- `Configuration`.

## 26.1 Example

```java
@GET
public Response get(@Context UriInfo uriInfo) {
    URI self = uriInfo.getRequestUri();
    ...
}
```

## 26.2 Prefer parameter injection

For request-specific context, method parameter is explicit and avoids accidental storage.

## 26.3 Rule

Use `@Context` for JAX-RS runtime context, preferably as method parameters.

---

# 27. `UriInfo`, `HttpHeaders`, `SecurityContext`, `Request`

## 27.1 `UriInfo`

URI/path/query info.

## 27.2 `HttpHeaders`

Headers, cookies, acceptable media types/languages.

## 27.3 `SecurityContext`

Principal, roles, secure channel, auth scheme.

## 27.4 `Request`

Conditional request/precondition evaluation.

## 27.5 Rule

Map runtime context to stable application objects before passing deep into domain.

---

# 28. Do Not Store Request Context Objects in Singletons

Bad:

```java
@ApplicationScoped
public class LinkFactory {
    @Context
    UriInfo uriInfo; // dangerous depending runtime/proxy
}
```

Even if proxy works, this hides request dependency.

Better:

```java
public URI self(UriInfo uriInfo, CustomerId id) { ... }
```

or:

```java
@RequestScoped
public class RequestLinkFactory { ... }
```

## 28.1 Rule

Request context belongs to request boundary.

---

# 29. ResourceContext and Subresource Injection

`ResourceContext` can initialize resource instances.

## 29.1 Example

```java
@Context
ResourceContext resourceContext;

@Path("/{id}/orders")
public OrderSubresource orders(@PathParam("id") CustomerId id) {
    OrderSubresource sub = resourceContext.getResource(OrderSubresource.class);
    sub.setCustomerId(id);
    return sub;
}
```

## 29.2 Better

Avoid setter mutable handoff if possible.

Use constructor/CDI factories where runtime supports.

## 29.3 Subresource lifecycle

Subresource locator instances can have different lifecycle semantics.

## 29.4 Rule

Use ResourceContext to let runtime inject into subresources instead of manual `new`.

---

# 30. Application Class and Registration

`Application` defines JAX-RS application.

```java
@ApplicationPath("/api")
public class RestApplication extends Application { }
```

## 30.1 Explicit registration

```java
@Override
public Set<Class<?>> getClasses() {
    return Set.of(CustomerResource.class, ProblemMapper.class);
}
```

## 30.2 Discovery

If `getClasses()` not overridden, runtime may discover resources/providers.

## 30.3 CDI interaction

Explicitly registering a class can still allow CDI integration depending runtime, but test.

## 30.4 Rule

Choose discovery/registration strategy deliberately.

---

# 31. `Application#getClasses()` vs CDI Discovery

## 31.1 `getClasses()`

JAX-RS component classes.

Default resource lifecycle is per-request; provider lifecycle singleton per `Application` docs.

## 31.2 CDI bean discovery

CDI discovers beans according to CDI bean archive/discovery rules.

## 31.3 If class is both

Runtime should integrate, but exact behavior can vary.

## 31.4 Recommendation

Use explicit scopes and integration tests.

## 31.5 Rule

Do not rely on “it was scanned somehow” for critical components.

---

# 32. `Application#getSingletons()` Deprecated Caveat

`Application#getSingletons()` is deprecated in Jakarta REST 4.0 API docs.

## 32.1 Why avoid

Returning singleton instances bypasses normal lifecycle expectations and can complicate CDI injection.

## 32.2 If used

Instances are your responsibility.

They must be thread-safe.

## 32.3 Better

Register classes, not singleton instances.

Use CDI `@ApplicationScoped` for singleton-like behavior.

## 32.4 Rule

Avoid `getSingletons()` for new code.

---

# 33. Filters and CDI

## 33.1 Request filter

```java
@Provider
@ApplicationScoped
@Priority(Priorities.AUTHENTICATION)
public class AuthenticationFilter implements ContainerRequestFilter {

    @Inject
    TokenVerifier verifier;

    @Override
    public void filter(ContainerRequestContext ctx) {
        ...
    }
}
```

## 33.2 Request state

Use locals/request properties.

## 33.3 Inject services

OK if services are thread-safe/application-scoped or proxied/request-scoped correctly.

## 33.4 Rule

Filters are HTTP middleware; keep them small and stateless.

---

# 34. Interceptors and CDI

JAX-RS Reader/WriterInterceptors can inject CDI beans.

## 34.1 Example

```java
@Provider
@ApplicationScoped
public class BodyHashWriterInterceptor implements WriterInterceptor {

    @Inject
    HashingService hashingService;

    @Override
    public void aroundWriteTo(WriterInterceptorContext ctx) throws IOException {
        ...
        ctx.proceed();
    }
}
```

## 34.2 Caveat

Entity stream wrapping must be thread-safe and request-local.

## 34.3 Rule

Interceptor instance shared; wrapped stream state local.

---

# 35. ExceptionMapper and CDI

Exception mappers often need:

- problem factory;
- localization;
- correlation ID;
- metrics;
- config.

## 35.1 Example

```java
@Provider
@ApplicationScoped
public class DomainExceptionMapper implements ExceptionMapper<DomainException> {

    @Inject
    ProblemFactory factory;

    @Context
    HttpHeaders headers;

    @Override
    public Response toResponse(DomainException e) {
        return factory.toProblem(e, headers.getAcceptableLanguages());
    }
}
```

## 35.2 Caution

If mapper is singleton, injected request context may be proxy. Prefer method parameter impossible here, so verify runtime behavior.

Alternative: inject request-scoped context wrapper.

## 35.3 Rule

ExceptionMapper must be thread-safe and not store per-exception state.

---

# 36. MessageBodyReader/Writer and CDI

Entity providers can inject CDI services.

## 36.1 Use cases

- custom serialization;
- encryption/decryption;
- CSV writer;
- specialized media type.

## 36.2 Caveat

Message body providers can be called concurrently.

## 36.3 Avoid

- mutable serializer state if not thread-safe;
- request-specific fields;
- expensive per-call initialization.

## 36.4 Rule

Entity providers are performance-critical and should be stateless/thread-safe.

---

# 37. DynamicFeature and CDI

`DynamicFeature` configures providers for resource methods at deployment/setup.

## 37.1 Example

```java
@Provider
@ApplicationScoped
public class AuditDynamicFeature implements DynamicFeature {

    @Inject
    AuditPolicyRegistry policies;

    @Override
    public void configure(ResourceInfo info, FeatureContext ctx) {
        if (info.getResourceMethod().isAnnotationPresent(Audited.class)) {
            ctx.register(AuditFilter.class);
        }
    }
}
```

## 37.2 Caveat

`configure` is called during application setup, not per request.

Do not access request context there.

## 37.3 Rule

DynamicFeature is deployment-time binding logic.

---

# 38. Name Binding and CDI

Name-bound filters/interceptors can be CDI beans.

## 38.1 Annotation

```java
@NameBinding
@Retention(RUNTIME)
@Target({ TYPE, METHOD })
public @interface Audited {}
```

## 38.2 Provider

```java
@Audited
@Provider
@ApplicationScoped
public class AuditFilter implements ContainerRequestFilter { ... }
```

## 38.3 Resource

```java
@Audited
@POST
public Response create(...) { ... }
```

## 38.4 Rule

Name binding selects where provider applies; CDI injects provider dependencies.

---

# 39. Validation and CDI

Jakarta Validation validators can use dependency injection depending integration/runtime.

## 39.1 Resource validation

Parameter/entity validation happens at REST boundary.

## 39.2 ConstraintValidator injection

Can inject services if validation provider/CDI integrated.

## 39.3 Caution

Validators should be deterministic and lightweight.

Do not perform heavy DB calls casually.

## 39.4 Rule

Use validation for boundary constraints; use service/domain for business invariants.

---

# 40. Transactions and CDI Boundary

Transactions are usually handled by Jakarta Transactions/CDI interceptors/EJB.

## 40.1 Resource method transaction?

Avoid putting long HTTP streaming/SSE in transaction.

## 40.2 Service layer transaction

Better:

```java
@Path("/orders")
public class OrderResource {
    @Inject OrderService service;

    @POST
    public Response create(CreateOrderRequest request) {
        OrderResponse created = service.create(request);
        return Response.created(...).entity(created).build();
    }
}
```

```java
@ApplicationScoped
public class OrderService {
    @Transactional
    public OrderResponse create(...) { ... }
}
```

## 40.3 Rule

Keep transaction boundary in application service, not HTTP plumbing.

---

# 41. Security Context to CurrentActor

`SecurityContext` is HTTP/runtime object.

Convert it to application object.

## 41.1 Bad

```java
domainService.doSomething(securityContext);
```

## 41.2 Good

```java
CurrentActor actor = actorResolver.resolve(securityContext);
domainService.doSomething(actor, command);
```

## 41.3 RequestScoped provider

```java
@RequestScoped
public class CurrentActorProvider {
    @Context
    SecurityContext securityContext;

    public CurrentActor current() { ... }
}
```

## 41.4 Rule

Domain/application layer should not depend on JAX-RS `SecurityContext`.

---

# 42. Multi-Tenancy Context

## 42.1 Resolve at boundary

Filter/resource resolves tenant from:

- path;
- token claim;
- header;
- subdomain;
- request context.

## 42.2 Store in request-scoped bean

```java
@RequestScoped
public class TenantContext {
    private TenantId tenantId;
}
```

## 42.3 Avoid ThreadLocal unless controlled

If using ThreadLocal, clear reliably.

## 42.4 Rule

Tenant context must be explicit and request-bound.

---

# 43. Request Context Propagation

CDI request context is active during request.

## 43.1 Worker thread

If you start async work in raw executor, request context may not be active.

## 43.2 Managed executor/context propagation

Some runtimes provide context propagation.

Still understand what context propagates.

## 43.3 Safer

Capture immutable values:

```java
CurrentActor actor = actorProvider.current();
TenantId tenant = tenantContext.current();
String correlationId = correlation.current();
```

Pass to worker/job.

## 43.4 Rule

Do not pass contextual proxies to arbitrary threads and hope.

---

# 44. Async Boundary Caveat

For `AsyncResponse`, `CompletionStage`, SSE, streaming:

- request thread may return;
- response may complete later;
- request context may end or behave runtime-specifically;
- dependencies may be accessed on other threads.

## 44.1 Avoid

```java
executor.submit(() -> requestScopedBean.doWork());
```

## 44.2 Prefer

```java
RequestSnapshot snapshot = snapshotFactory.capture();
executor.submit(() -> service.doWork(snapshot));
```

## 44.3 Rule

Async boundary is also dependency-lifecycle boundary.

---

# 45. SSE/Streaming Boundary Caveat

SSE and streaming responses can live long.

## 45.1 Do not hold request-scoped resources for stream duration

Bad:

- DB transaction;
- EntityManager;
- request-scoped entity list;
- open ResultSet;
- security context object without policy.

## 45.2 Use stable state

- actor ID;
- tenant ID;
- stream subscription ID;
- service methods per event;
- event bus.

## 45.3 Rule

Long-lived streams should not depend on short-lived request context.

---

# 46. Client API Beans

JAX-RS `Client` should be produced and closed by CDI.

## 46.1 Producer

```java
@Produces
@ApplicationScoped
@CustomerApi
Client customerClient() {
    return ClientBuilder.newBuilder()
        .connectTimeout(500, TimeUnit.MILLISECONDS)
        .readTimeout(2, TimeUnit.SECONDS)
        .build();
}
```

## 46.2 Disposer

```java
void close(@Disposes @CustomerApi Client client) {
    client.close();
}
```

## 46.3 Gateway bean

```java
@ApplicationScoped
public class CustomerGateway {
    private final WebTarget target;

    @Inject
    public CustomerGateway(@CustomerApi Client client, Config config) {
        this.target = client.target(config.customerBaseUrl());
    }
}
```

## 46.4 Rule

Manage outbound clients as application-scoped resources with cleanup.

---

# 47. Configuration Injection

Configuration should be injected into boundary/gateway/policy beans.

## 47.1 Examples

- base URL;
- timeout;
- max upload size;
- allowed origins;
- feature flags;
- storage bucket.

## 47.2 Do not read env everywhere

Centralize config.

## 47.3 Validate config

Fail startup if invalid.

## 47.4 Rule

Configuration is dependency too; inject and validate it.

---

# 48. Testing CDI + JAX-RS

## 48.1 Unit test

Instantiate resource manually only if constructor injection and no `@Context` dependency.

```java
CustomerResource resource = new CustomerResource(fakeService, fakeActorProvider);
```

## 48.2 Integration test

Use container/runtime to test:

- CDI injection;
- JAX-RS matching;
- providers;
- filters;
- context injection;
- exception mapping.

## 48.3 Rule

Unit tests test business/resource logic; integration tests test runtime injection and pipeline.

---

# 49. Mocking Beans

## 49.1 Alternatives

Use CDI alternatives or runtime test framework features.

## 49.2 Producer override

Inject fake client/storage/service.

## 49.3 Avoid static singleton

Static singletons are hard to replace in tests.

## 49.4 Rule

Design dependencies as injectable interfaces.

---

# 50. Integration Testing

Test these:

- resource injection works;
- provider injection works;
- filter injection works;
- request-scoped beans are isolated;
- application-scoped beans shared safely;
- exception mapper can use injected factory;
- `@Context` values correct;
- async boundaries do not use dead request context.

## 50.1 Rule

CDI/JAX-RS integration must be tested on target runtime.

---

# 51. Runtime Differences: Jersey, RESTEasy, CXF, Liberty, Quarkus

## 51.1 Differences

- bean discovery rules;
- CDI integration depth;
- provider lifecycle;
- context proxy behavior;
- constructor injection support;
- async context propagation;
- native-image/proxy constraints;
- test framework behavior.

## 51.2 Portable principle

Use spec-standard patterns and test.

## 51.3 Rule

Do not assume behavior from one runtime applies perfectly to another.

---

# 52. Migration Notes: javax to jakarta and ManagedBean Removal

Jakarta REST 4.0 release goal includes removing ManagedBean support and JAXB dependency while maintaining backward compatibility in other areas.

## 52.1 Impact

Legacy code relying on `javax.annotation.ManagedBean` or old component model assumptions should be reviewed.

## 52.2 Namespace

Use:

```java
jakarta.ws.rs.*
jakarta.inject.*
jakarta.enterprise.context.*
```

not `javax.*`.

## 52.3 Rule

For new Jakarta EE 11/Jakarta REST 4 code, use CDI as component model.

---

# 53. Observability

CDI integration issues appear as:

- injection failures at startup;
- provider not registered;
- wrong scope causing shared state bug;
- request context inactive in async;
- proxy/unproxyable errors.

## 53.1 Log startup registrations

Know what resources/providers are active.

## 53.2 Metrics

Track provider/filter errors by type.

## 53.3 Rule

Make lifecycle/configuration failures fail fast at startup when possible.

---

# 54. Common Failure Modes

## 54.1 Resource created manually

CDI injection missing.

## 54.2 Provider stores request state

Data races.

## 54.3 ApplicationScoped resource with mutable fields

Cross-request contamination.

## 54.4 RequestScoped bean used in raw thread

Context inactive.

## 54.5 `@Context` object stored in singleton

Wrong request/leak.

## 54.6 `getSingletons()` returns provider instance with no CDI injection

Lifecycle mismatch.

## 54.7 Unproxyable CDI bean

Deployment failure.

## 54.8 Self-invocation bypasses interceptor

Transaction/security not applied.

## 54.9 DynamicFeature reads request context

No request at deployment time.

## 54.10 CDI event used as distributed event

Lost events across nodes.

## 54.11 Test manually new resource but production uses proxies

Behavior mismatch.

## 54.12 Runtime migration breaks bean discovery

Missing resource/provider.

---

# 55. Best Practices

## 55.1 Make resource scope explicit

Usually `@RequestScoped`.

## 55.2 Keep providers stateless

Application-scoped/thread-safe.

## 55.3 Constructor inject application dependencies

Services, repositories, mappers, gateways.

## 55.4 Use `@Context` only for JAX-RS context

Prefer method parameter for request context.

## 55.5 Convert runtime context to application model

`SecurityContext` → `CurrentActor`.

## 55.6 Avoid request state in singleton

Use local/request-scoped objects.

## 55.7 Use producers/disposers for clients/resources

Close resources.

## 55.8 Keep transactions in service layer

Not filters/resources.

## 55.9 Snapshot context across async

Do not pass request proxies to worker threads.

## 55.10 Test on target runtime

Especially providers and async.

---

# 56. Anti-Patterns

## 56.1 Resource as global mutable controller

Bad.

## 56.2 `static` service locator

Bypasses CDI/testability.

## 56.3 Inject everything everywhere

No clear boundary.

## 56.4 Business logic in filters

Hard to test/reason.

## 56.5 Provider with non-thread-safe formatter

Race bugs.

## 56.6 Raw `new Subresource()`

No injection.

## 56.7 Domain depends on `UriInfo`/`SecurityContext`

Framework leakage.

## 56.8 Raw executor with request-scoped beans

Context bug.

## 56.9 Overusing `@ApplicationScoped`

Thread-safety issues.

## 56.10 Assuming CDI event is reliable message broker

Wrong.

---

# 57. Production Checklist

## 57.1 Resource/provider lifecycle

- [ ] Resource classes have explicit scope.
- [ ] Providers are stateless/thread-safe.
- [ ] No per-request mutable fields in providers.
- [ ] No `getSingletons()` for new code.
- [ ] Subresources created via runtime/CDI pattern.
- [ ] Runtime registration strategy documented.

## 57.2 Injection

- [ ] Constructor injection for required CDI deps.
- [ ] `@Context` used only for JAX-RS context.
- [ ] Runtime context converted to app objects.
- [ ] Qualifiers used for multiple implementations.
- [ ] Producers/disposers for closeable resources.
- [ ] Config injected centrally.

## 57.3 Scopes/threading

- [ ] ApplicationScoped beans thread-safe.
- [ ] RequestScoped beans not used outside active request.
- [ ] Async work captures immutable context.
- [ ] Streaming/SSE does not hold request resources.
- [ ] Transactions in service layer.

## 57.4 Testing

- [ ] Unit tests with constructor-injected fakes.
- [ ] Integration tests verify CDI + JAX-RS pipeline.
- [ ] Provider injection tested.
- [ ] Request scope isolation tested.
- [ ] Async context boundary tested.
- [ ] Runtime migration smoke test.

---

# 58. Latihan

## Latihan 1 — Resource Constructor Injection

Buat `CustomerResource` `@RequestScoped` dengan constructor injection ke `CustomerService`.

Unit test dengan fake service.

## Latihan 2 — ExceptionMapper CDI

Buat `ProblemExceptionMapper` dengan injected `ProblemFactory`.

Integration test mapper berjalan dan factory terpanggil.

## Latihan 3 — Provider Thread Safety

Buat filter application-scoped.

Tambahkan mutable field request ID, lalu race test dan perbaiki dengan local variable/request property.

## Latihan 4 — CurrentActorProvider

Buat `@RequestScoped CurrentActorProvider` yang membaca `SecurityContext`.

Resource memanggil `actorProvider.current()`.

## Latihan 5 — Subresource Injection

Implement subresource locator.

Bandingkan raw `new` vs `ResourceContext#getResource`.

## Latihan 6 — Client Producer/Disposer

Produce `Client` dengan qualifier `@CustomerApi`.

Pastikan `close()` terpanggil saat shutdown/test.

## Latihan 7 — Async Context Snapshot

Endpoint async menangkap `CurrentActor`, `TenantId`, `correlationId`.

Worker tidak menggunakan request-scoped bean langsung.

## Latihan 8 — Alternative Bean for Test

Gunakan CDI alternative untuk mengganti `ObjectStorage` dengan fake.

## Latihan 9 — Migration Review

Cari penggunaan `javax.*`, `ManagedBean`, `getSingletons()`, dan raw singleton provider.

Refactor ke Jakarta/CDI pattern.

---

# 59. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

2. Jakarta RESTful Web Services 4.0 — `Application` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/application

3. Jakarta RESTful Web Services 4.0.0 Release Record  
   https://projects.eclipse.org/projects/ee4j.rest/releases/4.0.0

4. Jakarta Contexts and Dependency Injection 4.1 Specification  
   https://jakarta.ee/specifications/cdi/4.1/jakarta-cdi-spec-4.1

5. Jakarta Contexts and Dependency Injection 4.1  
   https://jakarta.ee/specifications/cdi/4.1/

6. Jakarta RESTful Web Services 4.0 — `@Context` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/context

7. Jakarta RESTful Web Services 4.0 — `ResourceContext` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/resourcecontext

8. Jakarta RESTful Web Services 4.0 — `@Provider` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/provider

9. Open Liberty Docs — RESTful Web Services Integration with CDI  
   https://openliberty.io/docs/latest/jaxrs-integration-cdi.html

10. RESTEasy User Guide — CDI Integration  
    https://docs.jboss.org/resteasy/docs/6.1.0.Final/userguide/html/CDI.html

---

# 60. Penutup

CDI integration membuat Jakarta REST application jauh lebih maintainable, testable, dan modular—asal lifecycle-nya dipahami.

Mental model final:

```text
JAX-RS:
  HTTP resource/provider model

CDI:
  dependency injection, scope, lifecycle, contextual beans

Good application:
  explicit scopes
  stateless providers
  constructor injection
  request context converted to app context
  async boundaries handled safely
```

Prinsip final:

```text
@Inject for application dependencies.
@Context for JAX-RS runtime context.
@RequestScoped for resource request state.
@ApplicationScoped only when thread-safe.
Providers are shared unless proven otherwise.
Async boundary breaks request-context assumptions.
```

Top-tier JAX-RS engineer memastikan:

- resource/provider scope eksplisit;
- provider tidak menyimpan request state;
- `SecurityContext` tidak bocor ke domain;
- tenant/current actor menjadi application context;
- closeable resources dikelola producer/disposer;
- transaction boundary di service;
- tests mencakup runtime injection, not just manual new;
- migration dari legacy component model ke CDI jelas.

Part berikutnya:

```text
Bagian 032 — Transactions, Persistence, and REST Boundary
```

Kita akan membahas bagaimana REST boundary berinteraksi dengan database transaction, JPA entity, DTO mapping, lazy loading, optimistic locking, outbox, pagination query, streaming/export, and service-layer consistency.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-030.md](./learn-jaxrs-advanced-part-030.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-032.md](./learn-jaxrs-advanced-part-032.md)
