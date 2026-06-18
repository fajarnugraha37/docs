# learn-jaxrs-advanced-part-017.md

# Bagian 017 — Name Binding, `DynamicFeature`, Priorities, Provider Lifecycle, Registration Strategy, CDI Integration, dan Production Extension Architecture

> Target pembaca: Java/Jakarta engineer yang ingin menguasai cara **mengikat dan mengelola extension points** di JAX-RS/Jakarta REST secara production-grade. Bagian ini memperdalam mekanisme yang sebelumnya muncul di filters/interceptors: global providers, name-bound providers, dynamic providers, priority ordering, provider discovery, explicit registration, singleton lifecycle, thread safety, CDI integration, application configuration, duplicate provider pitfalls, dan strategi arsitektur extension untuk sistem enterprise.
>
> Namespace utama: `jakarta.ws.rs.NameBinding`, `jakarta.ws.rs.container.DynamicFeature`, `jakarta.ws.rs.core.FeatureContext`, `jakarta.ws.rs.Priorities`, `jakarta.annotation.Priority`, `jakarta.ws.rs.ext.Provider`, `jakarta.ws.rs.core.Application`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Extension Binding adalah Routing untuk Cross-Cutting Behavior](#2-mental-model-extension-binding-adalah-routing-untuk-cross-cutting-behavior)
3. [Apa Itu Provider dalam JAX-RS](#3-apa-itu-provider-dalam-jax-rs)
4. [Provider Types yang Umum](#4-provider-types-yang-umum)
5. [`@Provider`: Discovery Marker, Bukan Scope/Lifecycle Annotation](#5-provider-discovery-marker-bukan-scopelifecycle-annotation)
6. [Global Provider Binding](#6-global-provider-binding)
7. [Name Binding: Selective Binding via Annotation](#7-name-binding-selective-binding-via-annotation)
8. [Membuat Custom Name Binding Annotation](#8-membuat-custom-name-binding-annotation)
9. [Name Binding pada Resource Method](#9-name-binding-pada-resource-method)
10. [Name Binding pada Resource Class](#10-name-binding-pada-resource-class)
11. [Name Binding pada `Application`](#11-name-binding-pada-application)
12. [Multiple Name Bindings: AND Semantics](#12-multiple-name-bindings-and-semantics)
13. [Name Binding dan Inheritance/Subresource Caveat](#13-name-binding-dan-inheritancesubresource-caveat)
14. [`@PreMatching` dan Name Binding: Jangan Dicampur Sembarangan](#14-prematching-dan-name-binding-jangan-dicampur-sembarangan)
15. [Dynamic Binding dengan `DynamicFeature`](#15-dynamic-binding-dengan-dynamicfeature)
16. [`DynamicFeature#configure(ResourceInfo, FeatureContext)`](#16-dynamicfeatureconfigureresourceinfo-featurecontext)
17. [`FeatureContext` dan `Configurable#register`](#17-featurecontext-dan-configurableregister)
18. [DynamicFeature vs Name Binding](#18-dynamicfeature-vs-name-binding)
19. [DynamicFeature untuk Annotation Value](#19-dynamicfeature-untuk-annotation-value)
20. [DynamicFeature untuk ResourceInfo-Based Policy](#20-dynamicfeature-untuk-resourceinfo-based-policy)
21. [Global vs Name-Bound vs Dynamic: Decision Matrix](#21-global-vs-name-bound-vs-dynamic-decision-matrix)
22. [Priority Ordering: Why Order is Architecture](#22-priority-ordering-why-order-is-architecture)
23. [`@Priority` dan `jakarta.ws.rs.Priorities`](#23-priority-dan-jakartawsrspriorities)
24. [Pre, PreMatch, ReadFrom, WriteTo vs Post Ordering](#24-pre-prematch-readfrom-writeto-vs-post-ordering)
25. [Same Priority = Implementation-Defined](#25-same-priority--implementation-defined)
26. [Designing Priority Bands](#26-designing-priority-bands)
27. [Authentication Before Authorization](#27-authentication-before-authorization)
28. [Header Decoration Priority](#28-header-decoration-priority)
29. [Entity Coder Priority](#29-entity-coder-priority)
30. [Provider Lifecycle: Default Singleton](#30-provider-lifecycle-default-singleton)
31. [Thread Safety Rules for Providers](#31-thread-safety-rules-for-providers)
32. [Mutable State Anti-Pattern](#32-mutable-state-anti-pattern)
33. [Request State: Local Variables, Context, Request Properties, RequestScoped Bean](#33-request-state-local-variables-context-request-properties-requestscoped-bean)
34. [Dependency Injection in Providers](#34-dependency-injection-in-providers)
35. [CDI Integration: What to Expect, What to Test](#35-cdi-integration-what-to-expect-what-to-test)
36. [`@Context` Injection in Providers](#36-context-injection-in-providers)
37. [Constructor vs Field Injection Caveat](#37-constructor-vs-field-injection-caveat)
38. [Application Registration: `getClasses()`](#38-application-registration-getclasses)
39. [Application Registration: `getSingletons()` and Why It Is Deprecated](#39-application-registration-getsingletons-and-why-it-is-deprecated)
40. [Application Properties: `getProperties()`](#40-application-properties-getproperties)
41. [Provider Auto-Discovery vs Explicit Registration](#41-provider-auto-discovery-vs-explicit-registration)
42. [Duplicate Providers and Ambiguity](#42-duplicate-providers-and-ambiguity)
43. [Provider Conflict: JSON-B vs Jackson, Global vs Name-Bound](#43-provider-conflict-json-b-vs-jackson-global-vs-name-bound)
44. [Provider Registration Order vs Priority](#44-provider-registration-order-vs-priority)
45. [Feature vs DynamicFeature](#45-feature-vs-dynamicfeature)
46. [Using `Feature` for Bundled Extension Modules](#46-using-feature-for-bundled-extension-modules)
47. [Design Pattern: REST Extension Module](#47-design-pattern-rest-extension-module)
48. [Design Pattern: Annotation-Driven Policy](#48-design-pattern-annotation-driven-policy)
49. [Design Pattern: Policy Registry + DynamicFeature](#49-design-pattern-policy-registry--dynamicfeature)
50. [Design Pattern: Stable Provider Catalog](#50-design-pattern-stable-provider-catalog)
51. [Testing Binding, Priority, and Lifecycle](#51-testing-binding-priority-and-lifecycle)
52. [Observability for Provider Execution](#52-observability-for-provider-execution)
53. [Security Considerations](#53-security-considerations)
54. [Runtime Differences: Jersey, RESTEasy, CXF, Open Liberty, Payara, Quarkus](#54-runtime-differences-jersey-resteasy-cxf-open-liberty-payara-quarkus)
55. [Migration: `javax.ws.rs` to `jakarta.ws.rs`](#55-migration-javaxxwrs-to-jakartawrs)
56. [Common Failure Modes](#56-common-failure-modes)
57. [Best Practices](#57-best-practices)
58. [Anti-Patterns](#58-anti-patterns)
59. [Production Checklist](#59-production-checklist)
60. [Latihan](#60-latihan)
61. [Referensi Resmi](#61-referensi-resmi)
62. [Penutup](#62-penutup)

---

# 1. Tujuan Part Ini

Pada part sebelumnya kita membahas:

- filters;
- interceptors;
- `@Provider`;
- `@Priority`;
- `@NameBinding`;
- `DynamicFeature`.

Namun itu baru penggunaan praktis.

Di production, pertanyaan yang lebih penting adalah:

```text
Bagaimana saya memastikan extension behavior berjalan di endpoint yang benar,
dalam urutan yang benar,
dengan lifecycle yang benar,
tanpa race condition,
tanpa provider conflict,
tanpa dependency scanning magic yang sulit di-debug?
```

Contoh kasus:

```java
@RequiresScope("case:read")
@RateLimited("case-read")
@Audited(action = "VIEW_CASE")
@GET
@Path("/cases/{caseId}")
public CaseResponse getCase(...) { ... }
```

Bagaimana filter/interceptor yang sesuai terpasang?

- global?
- name-bound?
- dynamic?
- urutannya bagaimana?
- state-nya disimpan di mana?
- apakah provider singleton?
- apakah CDI injection aman?
- apakah ada duplicate provider?
- apakah `@PreMatching` mengabaikan name binding?
- apakah test direct resource method cukup? Tidak.

## 1.1 Prinsip utama

```text
Provider binding is the routing layer for JAX-RS extension behavior.
Provider lifecycle is the concurrency contract for that behavior.
Provider priority is the execution order contract.
```

## 1.2 Target akhir

Setelah part ini, kamu bisa:

- memilih global vs name-bound vs dynamic binding;
- membuat custom `@NameBinding` dengan benar;
- memahami multiple binding annotation;
- memahami `DynamicFeature`;
- menggunakan `FeatureContext#register`;
- mengatur priority chain;
- menghindari same-priority dependency;
- memahami provider default singleton lifecycle;
- menulis provider yang thread-safe;
- mengintegrasikan CDI dan `@Context` secara aman;
- mengelola registration strategy di `Application`;
- mendesain extension module production-grade.

---

# 2. Mental Model: Extension Binding adalah Routing untuk Cross-Cutting Behavior

JAX-RS resource matching memilih:

```text
HTTP request → resource method
```

Provider binding memilih:

```text
resource method / application / dynamic rule → filters/interceptors/providers yang berlaku
```

## 2.1 Tanpa binding

Provider global berlaku untuk semuanya.

```java
@Provider
public class CorrelationFilter implements ContainerRequestFilter { ... }
```

## 2.2 Dengan name binding

Provider hanya berlaku pada endpoint yang diberi annotation.

```java
@Audited
@POST
public Response create(...) { ... }
```

## 2.3 Dengan dynamic binding

Runtime saat deployment memeriksa resource method metadata dan mendaftarkan provider tertentu.

```java
@RateLimited(policy = "payment-create")
```

`DynamicFeature` membaca annotation tersebut, lalu register filter dengan policy yang sesuai.

## 2.4 Analogi

Binding seperti routing table untuk middleware:

```text
all routes            → correlation
@Secured routes       → authentication/authorization
@Compressed routes    → gzip interceptor
@Audited(action=...)  → audit filter with action value
```

## 2.5 Top-tier rule

```text
Do not let cross-cutting behavior be implicit magic.
Make binding visible, deterministic, and testable.
```

---

# 3. Apa Itu Provider dalam JAX-RS

Provider adalah extension component yang diketahui JAX-RS runtime.

Provider bisa:

- membaca body;
- menulis body;
- memetakan exception;
- memfilter request/response;
- mengintercept entity stream;
- menyediakan context resolver;
- mendaftarkan feature;
- melakukan dynamic binding.

## 3.1 Marker

`@Provider` menandai implementation of extension interface agar discoverable saat provider scanning.

## 3.2 Provider vs resource

Resource method adalah endpoint.

Provider adalah infrastructure extension yang mengelilingi atau mendukung endpoint.

## 3.3 Common examples

```java
@Provider
public class ProblemExceptionMapper implements ExceptionMapper<Throwable> { ... }

@Provider
public class JsonbContextResolver implements ContextResolver<Jsonb> { ... }

@Provider
public class CorrelationFilter implements ContainerRequestFilter { ... }
```

## 3.4 Provider tidak selalu global behavior

A provider class can be:

- global;
- name-bound;
- dynamically bound;
- registered only for client or server depending contract.

## 3.5 Rule

Provider is extension infrastructure, not business service.

---

# 4. Provider Types yang Umum

## 4.1 Entity providers

```java
MessageBodyReader<T>
MessageBodyWriter<T>
```

## 4.2 Exception mapping

```java
ExceptionMapper<E>
```

## 4.3 Context resolver

```java
ContextResolver<T>
```

## 4.4 Filters

```java
ContainerRequestFilter
ContainerResponseFilter
```

## 4.5 Interceptors

```java
ReaderInterceptor
WriterInterceptor
```

## 4.6 Feature

```java
Feature
DynamicFeature
```

## 4.7 Param conversion

```java
ParamConverterProvider
```

## 4.8 Rule

Each provider type has different binding and selection semantics. Do not generalize blindly.

---

# 5. `@Provider`: Discovery Marker, Bukan Scope/Lifecycle Annotation

`@Provider` means:

```text
JAX-RS runtime may discover this class during provider scanning.
```

It does **not** mean:

- request-scoped;
- CDI-scoped;
- singleton annotation;
- priority annotation;
- name binding;
- automatic correctness.

## 5.1 Example

```java
@Provider
public class SecurityHeadersFilter implements ContainerResponseFilter { ... }
```

## 5.2 Without `@Provider`

Provider might still be registered manually.

```java
getClasses() returns Set.of(SecurityHeadersFilter.class)
```

## 5.3 With `@Provider` but scanning disabled

May not be discovered.

## 5.4 Recommendation

For production, know which registration mode you use.

## 5.5 Rule

`@Provider` only says “this is discoverable extension component.”

---

# 6. Global Provider Binding

Global providers apply broadly.

## 6.1 Example

```java
@Provider
@Priority(Priorities.HEADER_DECORATOR)
public class SecurityHeadersFilter implements ContainerResponseFilter { ... }
```

## 6.2 Good global providers

- correlation ID;
- access log metadata;
- security headers;
- global exception mapper;
- JSON provider;
- validation mapper;
- metrics filter.

## 6.3 Dangerous global providers

- response body envelope;
- compression for all responses;
- auth if public endpoints exist and no bypass policy;
- request body logging;
- generic `MessageBodyWriter<Object>`;
- broad `ExceptionMapper<Throwable>` without specific mappers.

## 6.4 Global means every matched request/response where provider type applies.

## 6.5 Rule

Make provider global only if it is safe and intended for almost all endpoints.

---

# 7. Name Binding: Selective Binding via Annotation

Name binding restricts filters/interceptors to annotated resource classes/methods/application.

## 7.1 Official model

Define meta-annotation:

```java
@NameBinding
@Target({ ElementType.TYPE, ElementType.METHOD })
@Retention(RetentionPolicy.RUNTIME)
public @interface Logged {}
```

Use it on provider:

```java
@Logged
@Provider
public class LoggingFilter implements ContainerRequestFilter, ContainerResponseFilter { ... }
```

Use it on resource:

```java
@GET
@Logged
public Response get(...) { ... }
```

## 7.2 Applies to filters and interceptors

Name binding is primarily for server filters/interceptors.

## 7.3 Not for message body providers

`MessageBodyReader/Writer` selection is based on type/media/provider priority, not name binding in the same way.

## 7.4 Not for `ExceptionMapper`

Exception mapper selection is by exception type, not resource method annotation.

## 7.5 Rule

Use name binding to attach filters/interceptors selectively.

---

# 8. Membuat Custom Name Binding Annotation

## 8.1 Correct annotation

```java
@NameBinding
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
public @interface Audited {
}
```

## 8.2 Why runtime retention?

JAX-RS runtime must read annotation at runtime.

## 8.3 Why type/method target?

Can annotate resource class or method.

## 8.4 Do not forget `@NameBinding`

Without it, it is just normal annotation.

## 8.5 Document semantics

```java
/**
 * Enables audit logging for this resource method.
 */
```

## 8.6 Rule

A name-binding annotation should represent a clear policy.

---

# 9. Name Binding pada Resource Method

## 9.1 Example

```java
@POST
@Path("/payments")
@Audited
public Response createPayment(...) { ... }
```

Only `@Audited` providers apply to this method.

## 9.2 Multiple methods

```java
@GET
public Response list() { ... }

@POST
@Audited
public Response create() { ... }
```

Audit only create.

## 9.3 Good for endpoint-specific policy

- audit create/update/delete;
- require idempotency key;
- enable compression for export;
- enable response signing;
- apply rate limit category.

## 9.4 Avoid annotation soup

Too many policy annotations can hurt readability.

Group or document.

## 9.5 Rule

Method-level binding is precise and explicit.

---

# 10. Name Binding pada Resource Class

## 10.1 Example

```java
@Path("/admin")
@RequiresAdmin
public class AdminResource {
    @GET
    public Response dashboard() { ... }

    @DELETE
    @Path("/users/{id}")
    public Response deleteUser(...) { ... }
}
```

All methods in class get binding.

## 10.2 Method override?

Name binding usually accumulates; a method annotation can add more.

There is no standard “un-bind” annotation.

## 10.3 Use case

- all admin endpoints;
- all internal endpoints;
- all audited resource class;
- all compressed reports.

## 10.4 Caution

If one method should be public, separate class may be clearer.

## 10.5 Rule

Class-level binding is good when every endpoint in class shares the policy.

---

# 11. Name Binding pada `Application`

A name-binding annotation may be attached to custom `Application` subclass.

## 11.1 Example

```java
@Audited
@ApplicationPath("/api")
public class ApiApplication extends Application {
}
```

## 11.2 Effect

A provider bound by `@Audited` applies to all resource/subresource methods in the application.

## 11.3 Use cases

- audit every endpoint;
- enforce app-wide custom policy;
- shared app-level behavior while still using name-binding semantics.

## 11.4 Caution

This can surprise maintainers because policy is not visible on each resource.

## 11.5 Rule

Application-level binding should be documented prominently.

---

# 12. Multiple Name Bindings: AND Semantics

If a provider has multiple binding annotations, all must be present on resource class/method for binding.

## 12.1 Example

```java
@Provider
@Audited
@Verbose
public class VerboseAuditFilter implements ContainerRequestFilter { ... }
```

Resource must have both:

```java
@Audited
@Verbose
@POST
public Response create(...) { ... }
```

## 12.2 Not OR

It is not:

```text
Audited OR Verbose
```

It is:

```text
Audited AND Verbose
```

## 12.3 If you need OR

Create separate providers or use DynamicFeature.

## 12.4 Design implication

Multiple bindings are good for very specific provider combinations.

But they can be confusing.

## 12.5 Rule

Avoid accidental AND semantics by keeping bindings simple.

---

# 13. Name Binding dan Inheritance/Subresource Caveat

## 13.1 Resource class inheritance

Annotation inheritance rules in Java and JAX-RS can be subtle.

Do not assume all bindings propagate through inheritance exactly as desired.

## 13.2 Interfaces

Annotations on interfaces may or may not be respected depending JAX-RS annotation inheritance semantics and runtime.

## 13.3 Subresources

Subresource locators introduce additional matching stages.

Class-level binding on parent does not necessarily mean every returned subresource behaves as you assume.

## 13.4 Recommendation

Test actual endpoint path and method.

## 13.5 Rule

For security-critical binding, do not rely on untested inheritance/subresource assumptions.

---

# 14. `@PreMatching` dan Name Binding: Jangan Dicampur Sembarangan

A pre-matching request filter runs before resource matching.

## 14.1 Key consequence

Since no resource method is matched yet, name binding cannot be applied meaningfully.

Specification/API states name-binding annotations are ignored on `@PreMatching` components.

## 14.2 Example bad

```java
@PreMatching
@RequiresAdmin
@Provider
public class AdminPreMatchingFilter implements ContainerRequestFilter { ... }
```

This is misleading.

## 14.3 Correct

Use pre-matching for:

- method override;
- URI rewrite;
- CORS preflight;
- global early reject.

Use post-matching name-bound filter for endpoint-specific policy.

## 14.4 Rule

`@PreMatching` is global pre-routing behavior. Do not expect method-level binding.

---

# 15. Dynamic Binding dengan `DynamicFeature`

`DynamicFeature` is a meta-provider for dynamic registration of post-matching providers at deployment time.

## 15.1 Use case

You want to inspect resource method/class metadata and register filters/interceptors selectively.

## 15.2 Example

```java
@Provider
public class RateLimitFeature implements DynamicFeature {

    @Override
    public void configure(ResourceInfo resourceInfo, FeatureContext context) {
        RateLimited ann = resourceInfo.getResourceMethod()
            .getAnnotation(RateLimited.class);

        if (ann != null) {
            context.register(new RateLimitFilter(ann.policy()));
        }
    }
}
```

## 15.3 Deployment time

`configure` is called during application deployment/resource discovery, typically once per discovered resource/subresource method.

## 15.4 Post-matching providers

DynamicFeature binds post-matching providers to particular resource methods.

## 15.5 Overrides annotation-based binding

The official API describes dynamic feature as overriding annotation-based binding definitions for registered resource filter/interceptor instances.

## 15.6 Rule

Use DynamicFeature when static name binding is not expressive enough.

---

# 16. `DynamicFeature#configure(ResourceInfo, FeatureContext)`

Method:

```java
void configure(ResourceInfo resourceInfo, FeatureContext context)
```

## 16.1 `ResourceInfo`

Provides:

```java
Class<?> getResourceClass()
Method getResourceMethod()
```

## 16.2 `FeatureContext`

Configurable context for registering providers/features/properties in method-level runtime configuration.

## 16.3 Register provider class

```java
context.register(RateLimitFilter.class);
```

## 16.4 Register provider instance

```java
context.register(new RateLimitFilter(policy));
```

## 16.5 Register with priority

Depending overloads:

```java
context.register(filter, Priorities.AUTHORIZATION)
```

or map of contracts/priorities.

## 16.6 Rule

`configure` is configuration-time code, not request-time code.

---

# 17. `FeatureContext` dan `Configurable#register`

`FeatureContext` extends `Configurable<FeatureContext>`.

That means it supports registration operations.

## 17.1 Register class

```java
context.register(MyFilter.class);
```

## 17.2 Register instance

```java
context.register(new MyFilter(config));
```

## 17.3 Register with priority

```java
context.register(MyFilter.class, Priorities.AUTHORIZATION);
```

## 17.4 Register with contracts

Advanced:

```java
context.register(provider, Map.of(ContainerRequestFilter.class, priority));
```

## 17.5 Properties

```java
context.property("policy", "value");
```

## 17.6 Rule

Use class registration when runtime/CDI should construct provider; use instance registration when annotation value/config must be captured.

---

# 18. DynamicFeature vs Name Binding

## 18.1 Name binding

Best when annotation is boolean-like.

```java
@Audited
@Compressed
@RequiresAdmin
```

## 18.2 DynamicFeature

Best when annotation has values.

```java
@RateLimited("payment-create")
@RequiresScope("case:read")
@Audit(action = "APPROVE_CASE")
```

## 18.3 Name binding is simpler

Runtime sees same annotation on provider and resource.

## 18.4 DynamicFeature is more powerful

Can inspect:

- method annotations;
- class annotations;
- return type;
- HTTP method;
- resource class;
- package conventions.

## 18.5 DynamicFeature is easier to hide behavior

Too much logic makes system hard to reason about.

## 18.6 Rule

Prefer name binding for simple on/off policies; use DynamicFeature for parameterized/metadata-driven policies.

---

# 19. DynamicFeature untuk Annotation Value

## 19.1 Annotation

```java
@Target({TYPE, METHOD})
@Retention(RUNTIME)
public @interface RequiresScope {
    String value();
}
```

## 19.2 Filter

```java
public final class ScopeAuthorizationFilter implements ContainerRequestFilter {
    private final String requiredScope;

    public ScopeAuthorizationFilter(String requiredScope) {
        this.requiredScope = requiredScope;
    }

    @Override
    public void filter(ContainerRequestContext ctx) {
        CurrentUser user = (CurrentUser) ctx.getProperty("currentUser");
        if (!user.hasScope(requiredScope)) {
            ctx.abortWith(forbidden("INSUFFICIENT_SCOPE"));
        }
    }
}
```

## 19.3 Feature

```java
@Provider
public final class ScopeAuthorizationFeature implements DynamicFeature {

    @Override
    public void configure(ResourceInfo resourceInfo, FeatureContext context) {
        RequiresScope ann = findAnnotation(resourceInfo, RequiresScope.class);
        if (ann != null) {
            context.register(
                new ScopeAuthorizationFilter(ann.value()),
                Priorities.AUTHORIZATION
            );
        }
    }
}
```

## 19.4 Thread safety

Filter instance has immutable `requiredScope`.

Safe.

## 19.5 Rule

Dynamic provider instances should be immutable.

---

# 20. DynamicFeature untuk ResourceInfo-Based Policy

Sometimes no annotation is needed.

## 20.1 Example: all `@POST` gets idempotency check

```java
if (resourceInfo.getResourceMethod().isAnnotationPresent(POST.class)) {
    context.register(IdempotencyHeaderFilter.class);
}
```

## 20.2 Example: methods returning `StreamingOutput` get metrics interceptor

```java
if (resourceInfo.getResourceMethod().getReturnType().equals(StreamingOutput.class)) {
    context.register(StreamingMetricsInterceptor.class);
}
```

## 20.3 Example: package-based internal policy

```java
if (resourceInfo.getResourceClass().getPackageName().contains(".internal.")) {
    context.register(InternalOnlyFilter.class);
}
```

## 20.4 Caution

Convention-based binding is less visible.

## 20.5 Recommendation

Prefer explicit annotations for security/business-relevant policies.

## 20.6 Rule

Use ResourceInfo-based convention only when it is clear, documented, and tested.

---

# 21. Global vs Name-Bound vs Dynamic: Decision Matrix

## 21.1 Use global when

- applies to all requests;
- safe for public/internal endpoints;
- no endpoint-specific config needed;
- order fixed.

Examples:

- correlation ID;
- security headers;
- access log;
- catch-all exception mapper.

## 21.2 Use name binding when

- simple on/off per endpoint;
- explicit endpoint policy desired;
- no annotation values needed.

Examples:

- `@Audited`;
- `@Compressed`;
- `@RequiresAdmin`.

## 21.3 Use DynamicFeature when

- annotation has values;
- binding depends on method/class metadata;
- need per-method configured provider instance.

Examples:

- `@RateLimited("payment")`;
- `@RequiresScope("case:read")`;
- `@Audit(action="SUBMIT_APPLICATION")`.

## 21.4 Avoid magic

If future maintainer cannot see why a filter runs, design is too hidden.

## 21.5 Rule

Choose the least powerful binding that expresses the policy clearly.

---

# 22. Priority Ordering: Why Order is Architecture

Provider order can change behavior.

## 22.1 Example auth order

```text
Correlation → Authentication → Tenant → Authorization → Rate Limit → Resource
```

If authorization runs before authentication, no identity exists.

## 22.2 Example interceptor order

```text
Hash → Decompress → JSON Reader
```

Hash is over wire compressed bytes.

```text
Decompress → Hash → JSON Reader
```

Hash is over representation bytes.

## 22.3 Example response order

```text
Writer → Compress → Sign
```

Signature over compressed bytes.

```text
Writer → Sign → Compress
```

Signature over uncompressed bytes.

## 22.4 Rule

Priority is not cosmetic. It defines semantics.

---

# 23. `@Priority` dan `jakarta.ws.rs.Priorities`

`@Priority` declares ordering.

`Priorities` provides built-in constants.

## 23.1 Example

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class AuthenticationFilter implements ContainerRequestFilter { ... }
```

## 23.2 Built-in priority categories

```java
Priorities.AUTHENTICATION
Priorities.AUTHORIZATION
Priorities.HEADER_DECORATOR
Priorities.ENTITY_CODER
Priorities.USER
```

## 23.3 Default

If no `@Priority`, default is `Priorities.USER`.

## 23.4 Same priority

Execution order is implementation-defined.

## 23.5 Recommendation

Use constants for broad categories and small offsets for local ordering:

```java
@Priority(Priorities.AUTHENTICATION - 100)
```

for correlation before auth.

## 23.6 Rule

If order matters, annotate it and test it.

---

# 24. Pre, PreMatch, ReadFrom, WriteTo vs Post Ordering

JAX-RS groups filters/interceptors into chains for extension points:

- Pre;
- PreMatch;
- Post;
- ReadFrom;
- WriteTo;
- client equivalents.

## 24.1 Ascending chains

Most chains are sorted ascending:

```text
lower number = higher priority = earlier
```

Includes:

- ContainerRequest;
- PreMatchContainerRequest;
- ReadFrom;
- WriteTo.

## 24.2 Post chain

ContainerResponse/Post chain is sorted descending:

```text
higher number runs earlier
```

This ensures response filters run in reverse order of request filters.

## 24.3 Example

Request:

```text
A(priority 1000) → B(priority 5000) → resource
```

Response:

```text
B(priority 5000) → A(priority 1000)
```

## 24.4 Rule

Request and response priority direction are intentionally different.

---

# 25. Same Priority = Implementation-Defined

If two providers have same priority, order is not portable.

## 25.1 Bad

```java
@Priority(Priorities.AUTHENTICATION)
class JwtAuthFilter {}

@Priority(Priorities.AUTHENTICATION)
class ApiKeyAuthFilter {}
```

If one must run first, this is ambiguous.

## 25.2 Good

```java
@Priority(Priorities.AUTHENTICATION)
class CredentialExtractionFilter {}

@Priority(Priorities.AUTHENTICATION + 100)
class AuthenticationDecisionFilter {}
```

## 25.3 Sometimes same priority okay

If providers are independent.

Examples:

- two response headers filters that don't depend on order.

## 25.4 Rule

Same priority is acceptable only when order truly does not matter.

---

# 26. Designing Priority Bands

Create project-level priority guidelines.

## 26.1 Example server request chain

```text
  900  Correlation ID
 1000  Authentication
 1900  Tenant resolution
 2000  Authorization
 2500  Rate limit / quota
 3000  Idempotency header validation
 4000  Audit start
 5000  User/default
```

## 26.2 Response chain

Remember reverse order.

Plan response filters accordingly.

## 26.3 Interceptor chain

```text
3500  Decrypt/decode
4000  Digest/hash
5000  User
6000  Encrypt/encode
```

But exact order depends semantics.

## 26.4 Document

Put priority bands in `ARCHITECTURE.md` or coding standard.

## 26.5 Rule

Priority numbers should not be random per class.

---

# 27. Authentication Before Authorization

## 27.1 Authentication

Establish identity.

```java
@Priority(Priorities.AUTHENTICATION)
```

## 27.2 Authorization

Check permission.

```java
@Priority(Priorities.AUTHORIZATION)
```

## 27.3 Required order

Authorization needs identity.

## 27.4 Tenant resolution

May depend on authentication.

Often between auth and authorization.

## 27.5 Rule

No authorization without authenticated/current user context.

---

# 28. Header Decoration Priority

Header decoration is often response-side.

## 28.1 Security headers

```java
@Priority(Priorities.HEADER_DECORATOR)
```

## 28.2 Correlation response header

Needs to run for both success and error/abort.

## 28.3 CORS headers

May need to run even for errors.

## 28.4 Response order

Because response filters run descending, ensure decorator runs in intended sequence.

## 28.5 Rule

Header decorators should not depend on business logic.

---

# 29. Entity Coder Priority

`Priorities.ENTITY_CODER` is for message encoder/decoder filter/interceptor priority.

## 29.1 Use cases

- compression;
- decompression;
- encryption;
- decryption;
- signing;
- stream wrapping.

## 29.2 Interceptor priority matters

Order defines byte transformation semantics.

## 29.3 Example

If response is compressed then signed:

```text
writer → compression → signing
```

If signed then compressed:

```text
writer → signing → compression
```

Not equivalent.

## 29.4 Rule

Entity coder priorities must be security/protocol reviewed.

---

# 30. Provider Lifecycle: Default Singleton

JAX-RS default provider lifecycle is singleton per application.

## 30.1 Official model

By default, a single instance of each filter or entity interceptor is instantiated for each JAX-RS application; constructor runs, dependencies are injected, then methods may be called simultaneously as needed.

## 30.2 Consequence

Provider code must be thread-safe.

## 30.3 Resource class differs

Default resource class lifecycle is per-request.

## 30.4 Registered classes

`Application#getClasses()` returns provider classes; default provider lifecycle is singleton.

## 30.5 Registered singleton instances

`getSingletons()` returns instances but is deprecated in Jakarta REST 4 API docs.

## 30.6 Rule

Assume provider instance is shared by many concurrent requests.

---

# 31. Thread Safety Rules for Providers

## 31.1 No per-request fields

Bad:

```java
private String currentUserId;
```

## 31.2 Use method-local variables

Good:

```java
String currentUserId = resolve(ctx);
```

## 31.3 Use request context properties

```java
ctx.setProperty("currentUser", user);
```

## 31.4 Use request-scoped CDI bean

```java
@Inject RequestMetadata metadata;
```

if runtime supports.

## 31.5 Thread-safe collaborators

Injected services should be stateless/thread-safe.

## 31.6 Non-thread-safe objects

Do not share:

- `SimpleDateFormat`;
- mutable `MessageDigest`;
- mutable `Mac`;
- mutable buffers;
- StringBuilder as field;
- request DTOs.

## 31.7 Rule

Provider fields should be immutable configuration or thread-safe collaborators.

---

# 32. Mutable State Anti-Pattern

## 32.1 Bad filter

```java
@Provider
public class BadAuthFilter implements ContainerRequestFilter {
    private CurrentUser currentUser;

    @Override
    public void filter(ContainerRequestContext ctx) {
        this.currentUser = authenticate(ctx);
        ctx.setSecurityContext(new ApiSecurityContext(currentUser));
    }
}
```

Concurrent requests can overwrite `currentUser`.

## 32.2 Correct

```java
@Override
public void filter(ContainerRequestContext ctx) {
    CurrentUser currentUser = authenticate(ctx);
    ctx.setSecurityContext(new ApiSecurityContext(currentUser));
    ctx.setProperty("currentUser", currentUser);
}
```

## 32.3 Rule

Never store request-specific values in provider instance fields.

---

# 33. Request State: Local Variables, Context, Request Properties, RequestScoped Bean

## 33.1 Local variable

Best for logic inside same method.

```java
CurrentUser user = authenticate(ctx);
```

## 33.2 Request property

Good for filter → response filter/interceptor handoff.

```java
ctx.setProperty("correlationId", id);
```

## 33.3 SecurityContext

Good for identity/role access.

```java
ctx.setSecurityContext(securityContext);
```

## 33.4 Request-scoped CDI bean

Good for app-level request metadata.

```java
@RequestScoped
public class RequestMetadata { ... }
```

## 33.5 Avoid ThreadLocal unless carefully managed

MDC uses ThreadLocal; must clear.

## 33.6 Rule

Choose request state carrier based on who needs the state.

---

# 34. Dependency Injection in Providers

Providers may need dependencies.

## 34.1 Examples

```java
@Inject TokenVerifier tokenVerifier;
@Inject ProblemFactory problemFactory;
@Inject MeterRegistry meterRegistry;
```

## 34.2 CDI-managed providers

In Jakarta EE runtimes, providers may be CDI-managed.

But details can vary by runtime/configuration.

## 34.3 Provider construction

If you register provider instance manually with `new`, CDI injection may not happen.

```java
context.register(new MyFilter(...));
```

## 34.4 Class registration

```java
context.register(MyFilter.class);
```

gives runtime chance to instantiate/inject.

## 34.5 Instance registration with constructor args

Useful for DynamicFeature annotation values, but injected fields may not be handled as expected.

Pass dependencies explicitly or use CDI `Instance`.

## 34.6 Rule

If provider needs DI, test how your runtime constructs it.

---

# 35. CDI Integration: What to Expect, What to Test

## 35.1 Common expectation

```java
@Provider
@ApplicationScoped
public class AuthFilter implements ContainerRequestFilter {
    @Inject TokenVerifier verifier;
}
```

## 35.2 Test

Verify:

- filter discovered;
- CDI injection works;
- request-scoped bean access works;
- interceptors work;
- exception mappers work.

## 35.3 CDI scopes

Provider default JAX-RS lifecycle may interact with CDI scope.

Avoid mixing assumptions.

## 35.4 RequestScoped injection

A singleton provider can inject request-scoped proxy.

Use only during request callback.

## 35.5 Rule

CDI integration is powerful but must be verified on target runtime.

---

# 36. `@Context` Injection in Providers

Providers can inject JAX-RS context.

```java
@Context
UriInfo uriInfo;

@Context
HttpHeaders headers;

@Context
ResourceInfo resourceInfo;
```

## 36.1 Request-scoped methods

Many context methods throw `IllegalStateException` outside request scope.

## 36.2 Do not call in constructor

Bad:

```java
public MyFilter() {
    uriInfo.getPath(); // no request yet
}
```

## 36.3 Use in callback

```java
@Override
public void filter(ContainerRequestContext ctx) {
    String path = uriInfo.getPath();
}
```

## 36.4 Prefer context parameter when available

`ContainerRequestContext` already provides many things.

## 36.5 Rule

`@Context` in providers is request-aware, not constructor-time config.

---

# 37. Constructor vs Field Injection Caveat

## 37.1 Constructor injection with CDI

Good for CDI-managed class.

```java
@Inject
public AuthFilter(TokenVerifier verifier) { ... }
```

## 37.2 JAX-RS provider instantiation

Runtime may require no-arg constructor depending environment.

## 37.3 Manual instance registration

```java
new RateLimitFilter(policy)
```

constructor args work, but CDI injection may not.

## 37.4 Best practice

For DynamicFeature with annotation values:

- use immutable provider instance with explicit constructor dependencies;
- or use a factory/CDI `Instance` if runtime supports cleanly.

## 37.5 Rule

Do not assume all construction/injection models work across runtimes.

---

# 38. Application Registration: `getClasses()`

`Application#getClasses()` returns root resource, provider, and feature classes.

## 38.1 Example

```java
@ApplicationPath("/api")
public class ApiApplication extends Application {

    @Override
    public Set<Class<?>> getClasses() {
        return Set.of(
            CustomerResource.class,
            ProblemExceptionMapper.class,
            CorrelationFilter.class,
            SecurityHeadersFilter.class,
            ScopeAuthorizationFeature.class
        );
    }
}
```

## 38.2 Advantages

- explicit;
- predictable;
- avoids scanning surprises;
- easier code review.

## 38.3 Disadvantages

- manual maintenance;
- can forget new resource/provider.

## 38.4 Lifecycle

Default lifecycle for provider classes is singleton.

## 38.5 Rule

For regulated/large systems, explicit registration is often worth the verbosity.

---

# 39. Application Registration: `getSingletons()` and Why It Is Deprecated

`Application#getSingletons()` returns provider/resource instances.

## 39.1 Deprecated

Jakarta REST 4 API docs mark `getSingletons()` deprecated and prefer automatic discovery or `getClasses()`.

## 39.2 Why cautious?

Singleton instances make lifecycle/injection/threading explicit and easy to get wrong.

## 39.3 Example risk

```java
return Set.of(new AuthFilter());
```

Dependencies not injected.

## 39.4 Duplicate instance risk

Implementations should flag error if more than one instance of same class.

## 39.5 Recommendation

Use `getClasses()` or container-managed registration.

## 39.6 Rule

Avoid `getSingletons()` for new applications.

---

# 40. Application Properties: `getProperties()`

`Application#getProperties()` returns application-wide properties.

## 40.1 Example

```java
@Override
public Map<String, Object> getProperties() {
    return Map.of("api.audit.enabled", true);
}
```

## 40.2 Visibility

Properties are reflected in application configuration passed to server-side features or injected into JAX-RS components.

## 40.3 Deployment overrides

Container-specific deployment descriptors/properties may extend or override.

## 40.4 Use cases

- feature flags;
- provider config;
- extension module config;
- limits.

## 40.5 Caution

Do not put secrets here casually.

## 40.6 Rule

Use application properties for extension configuration, not domain state.

---

# 41. Provider Auto-Discovery vs Explicit Registration

## 41.1 Auto-discovery

Runtime scans classes annotated with `@Provider`.

Pros:

- less boilerplate;
- easy plugin-like behavior.

Cons:

- harder to audit;
- transitive provider surprises;
- runtime/build differences;
- test/prod mismatch.

## 41.2 Explicit registration

Register classes in `Application`.

Pros:

- deterministic;
- reviewable;
- easier security audit;
- avoids accidental providers.

Cons:

- manual.

## 41.3 Hybrid

Auto-discover resources, explicitly register critical providers.

## 41.4 Recommendation

For security-critical providers, prefer explicit registration or at least provider catalog tests.

## 41.5 Rule

Provider discovery strategy is an architecture decision.

---

# 42. Duplicate Providers and Ambiguity

## 42.1 Same exception mapper type

Two `ExceptionMapper<Throwable>` providers.

Ambiguous.

## 42.2 Multiple JSON providers

JSON-B and Jackson both registered.

Output may change.

## 42.3 Multiple filters same priority

Order implementation-defined.

## 42.4 Duplicate name-bound filters

Could run twice if registered twice.

## 42.5 Detection

- startup logs;
- runtime tests;
- provider catalog endpoint/test;
- dependency tree audit.

## 42.6 Rule

Duplicate providers are often invisible until production behavior changes.

---

# 43. Provider Conflict: JSON-B vs Jackson, Global vs Name-Bound

## 43.1 JSON provider conflict

Symptoms:

- `@JsonbProperty` ignored;
- `@JsonProperty` ignored;
- date format changes;
- null policy changes.

## 43.2 Exception mapper conflict

Specific mapper may not be chosen if generic mapper catches/wraps incorrectly.

## 43.3 Filter conflict

Two auth filters both set `SecurityContext`.

## 43.4 Interceptor conflict

Two compression interceptors.

## 43.5 Rule

For every provider family, define one owner and one registration policy.

---

# 44. Provider Registration Order vs Priority

## 44.1 Do not rely on registration order

Priority should control order for ordered chains.

## 44.2 Some provider selection uses specificity

Message body providers use media/type/provider rules, not simply registration order.

## 44.3 Exception mapper selection uses exception type specificity.

## 44.4 If priority not applicable

Use specific types/media/bindings.

## 44.5 Rule

Registration is “what exists”; priority/specificity is “what runs/selected”.

---

# 45. Feature vs DynamicFeature

## 45.1 `Feature`

Registers providers/properties globally or when application/client config is built.

```java
public class ObservabilityFeature implements Feature {
    @Override
    public boolean configure(FeatureContext context) {
        context.register(CorrelationFilter.class);
        context.register(AccessLogFilter.class);
        return true;
    }
}
```

## 45.2 `DynamicFeature`

Registers providers per resource method based on `ResourceInfo`.

## 45.3 Use Feature for module bundles

- observability module;
- security module;
- problem details module.

## 45.4 Use DynamicFeature for per-endpoint policies

- annotation values;
- method metadata;
- resource-specific binding.

## 45.5 Rule

Feature is module registration; DynamicFeature is per-resource binding.

---

# 46. Using `Feature` for Bundled Extension Modules

## 46.1 Example

```java
@Provider
public class ProblemDetailsFeature implements Feature {

    @Override
    public boolean configure(FeatureContext context) {
        context.register(ValidationExceptionMapper.class);
        context.register(WebApplicationExceptionMapper.class);
        context.register(ThrowableMapper.class);
        return true;
    }
}
```

## 46.2 Benefit

One registration imports a coherent module.

## 46.3 Good modules

- ProblemDetailsFeature;
- ObservabilityFeature;
- SecurityHeadersFeature;
- JsonContractFeature;
- TenantFeature.

## 46.4 Caution

Feature can hide many providers.

Document what it registers.

## 46.5 Rule

Feature is good when it creates a named, documented extension module.

---

# 47. Design Pattern: REST Extension Module

Package structure:

```text
com.example.api.extension.problem
  ProblemDetailsFeature
  ProblemExceptionMapper
  ValidationExceptionMapper
  ProblemFactory

com.example.api.extension.observability
  ObservabilityFeature
  CorrelationFilter
  AccessLogFilter
  MetricsFilter

com.example.api.extension.security
  SecurityFeature
  AuthenticationFilter
  ScopeAuthorizationFeature
  RequiresScope
```

## 47.1 Benefits

- clear ownership;
- easier testing;
- reusable;
- provider catalog manageable;
- avoids provider sprawl.

## 47.2 Module README

Document:

- providers registered;
- priorities;
- bindings;
- error codes;
- configuration properties.

## 47.3 Rule

Treat JAX-RS extensions as infrastructure modules, not random classes.

---

# 48. Design Pattern: Annotation-Driven Policy

## 48.1 Annotation

```java
@Target({TYPE, METHOD})
@Retention(RUNTIME)
public @interface Audit {
    String action();
}
```

## 48.2 DynamicFeature

Reads annotation and registers policy filter.

## 48.3 Filter

Receives immutable policy config.

## 48.4 Resource

```java
@Audit(action = "SUBMIT_APPLICATION")
@POST
public Response submit(...) { ... }
```

## 48.5 Benefits

- policy visible in resource;
- values typed;
- easy code review;
- runtime binding central.

## 48.6 Rule

Annotation-driven policy works well for cross-cutting behavior with endpoint-specific metadata.

---

# 49. Design Pattern: Policy Registry + DynamicFeature

For many policies, avoid putting too much logic in annotation feature.

## 49.1 Registry

```java
@ApplicationScoped
public class EndpointPolicyRegistry {
    Policy resolve(ResourceInfo info) { ... }
}
```

## 49.2 Feature

```java
Policy policy = registry.resolve(resourceInfo);
context.register(new PolicyFilter(policy));
```

## 49.3 Use cases

- tenant policy;
- rate limit class;
- audit action;
- auth scope;
- deprecation policy.

## 49.4 Caution

If registry uses external config, ensure deployment-time availability.

## 49.5 Rule

DynamicFeature should bind; policy registry should decide complex policy.

---

# 50. Design Pattern: Stable Provider Catalog

Create test/diagnostic that lists expected providers.

## 50.1 Example catalog

```text
Provider Catalog:
- CorrelationFilter: global, priority 900
- AuthenticationFilter: global, priority 1000
- ScopeAuthorizationFeature: dynamic
- ProblemDetailsFeature: global mappers
- GzipWriterInterceptor: name-bound @Compressed
```

## 50.2 Contract test

Assert providers exist and responses prove behavior.

## 50.3 Avoid exposing publicly

Provider catalog can reveal security architecture.

Make internal.

## 50.4 Rule

Large API systems need provider inventory.

---

# 51. Testing Binding, Priority, and Lifecycle

## 51.1 Runtime tests required

Direct resource method tests do not run providers.

## 51.2 Binding tests

- global filter runs for all endpoints;
- name-bound filter only annotated endpoint;
- class binding applies all methods;
- application binding applies all resources;
- DynamicFeature binds based on annotation value.

## 51.3 Priority tests

Create test filters appending markers.

Assert order.

## 51.4 Lifecycle tests

Create provider with atomic counter/concurrency test to prove thread safety.

## 51.5 CDI tests

Ensure `@Inject` works in providers.

## 51.6 Negative tests

- unannotated method not affected;
- duplicate provider not registered;
- wrong namespace provider ignored.

## 51.7 Rule

Binding/priority/lifecycle are observable behaviors and must be tested via HTTP runtime.

---

# 52. Observability for Provider Execution

## 52.1 What to observe

- filter/interceptor duration;
- abort count by provider/error code;
- exception mapper count;
- reader/writer errors;
- dynamic policy execution count;
- auth success/failure.

## 52.2 Low-cardinality labels

- provider name;
- route template;
- status;
- error code;
- policy name.

## 52.3 Avoid

- raw path;
- raw annotation value if unbounded;
- user ID;
- token;
- exception message.

## 52.4 Logs

Provider startup logs can list registration/binding.

## 52.5 Rule

Provider observability helps debug “why did this behavior run?” without leaking data.

---

# 53. Security Considerations

## 53.1 Provider discovery risk

Unexpected provider on classpath can affect behavior.

## 53.2 Security filters priority

Auth/authz order must be deterministic.

## 53.3 Annotation visibility

Security policies should be visible and reviewed.

## 53.4 Dynamic binding risk

Hidden convention-based security policy can be missed.

## 53.5 Provider state

Race conditions can become security bugs.

## 53.6 Manual instance registration

May bypass DI/security dependencies.

## 53.7 Rule

Security-critical providers require explicit registration, explicit priority, tests, and code review.

---

# 54. Runtime Differences: Jersey, RESTEasy, CXF, Open Liberty, Payara, Quarkus

## 54.1 Discovery

Classpath scanning and build-time indexing differ.

## 54.2 CDI integration

Provider CDI management differs by runtime/config.

## 54.3 DynamicFeature timing

Should be deployment-time, but diagnostics/logs differ.

## 54.4 Priority behavior

Spec defines chain sorting, but same-priority execution is implementation-defined.

## 54.5 Quarkus

Build-time augmentation means missing indexes/imports can affect provider discovery.

## 54.6 Jakarta EE servers

Feature enablement may affect REST/CDI integration.

## 54.7 Rule

Run provider binding tests on the exact runtime and deployment mode.

---

# 55. Migration: `javax.ws.rs` to `jakarta.ws.rs`

## 55.1 Old imports

```java
javax.ws.rs.NameBinding
javax.ws.rs.container.DynamicFeature
javax.ws.rs.ext.Provider
javax.ws.rs.Priorities
javax.ws.rs.core.Application
```

## 55.2 New imports

```java
jakarta.ws.rs.NameBinding
jakarta.ws.rs.container.DynamicFeature
jakarta.ws.rs.ext.Provider
jakarta.ws.rs.Priorities
jakarta.ws.rs.core.Application
```

## 55.3 Mixed namespace trap

A provider implementing `javax.ws.rs.container.ContainerRequestFilter` will not be a Jakarta REST provider.

## 55.4 Annotation trap

A custom binding annotation using `javax.ws.rs.NameBinding` will not work with Jakarta REST runtime expecting `jakarta.ws.rs.NameBinding`.

## 55.5 Rule

Migration includes provider interfaces, annotations, binding annotations, and registration classes.

---

# 56. Common Failure Modes

## 56.1 Forgot `@NameBinding`

Custom annotation does nothing.

## 56.2 Forgot `@Provider`

Provider not discovered.

## 56.3 `@PreMatching` used with name binding

Binding ignored.

## 56.4 Multiple binding annotations misunderstood

Expected OR, got AND.

## 56.5 Same priority dependency

Order changes across runtime.

## 56.6 Mutable provider field

Concurrency bug.

## 56.7 DynamicFeature registers non-provider class

Ignored with warning.

## 56.8 DynamicFeature runs expensive logic at deployment

Slow/fragile startup.

## 56.9 Manual `new` provider loses CDI injection

Null dependency.

## 56.10 `getSingletons()` used with stateful provider

Thread safety bug.

## 56.11 JSON-B and Jackson both registered

Contract drift.

## 56.12 Old `javax` provider in Jakarta app

Provider invisible.

---

# 57. Best Practices

## 57.1 Prefer explicit critical provider registration

Security, error handling, JSON contract.

## 57.2 Use name binding for simple selective policies

Readable and testable.

## 57.3 Use DynamicFeature for parameterized policy

Annotation value → provider config.

## 57.4 Assign explicit priority

If order matters.

## 57.5 Treat providers as singleton and thread-safe

No request fields.

## 57.6 Keep DynamicFeature deployment-time logic cheap

No network/DB calls.

## 57.7 Test provider behavior through runtime

Direct method invocation is insufficient.

## 57.8 Document provider catalog

Especially in enterprise/microservice systems.

## 57.9 Avoid provider conflicts

One JSON strategy, one problem strategy, one auth strategy.

## 57.10 Keep business logic out of providers

Providers are boundary/infrastructure.

---

# 58. Anti-Patterns

## 58.1 Annotation soup

Resource method has 12 policy annotations.

## 58.2 Hidden convention-based security

DynamicFeature binds auth based on package name only.

## 58.3 Random priority numbers

No architecture.

## 58.4 Stateful singleton provider

Race conditions.

## 58.5 Manual provider instances with missing DI

Null service in production.

## 58.6 Global body-transforming interceptor

Breaks downloads/errors/streaming.

## 58.7 Duplicate mappers/providers

Ambiguous behavior.

## 58.8 No startup/provider catalog tests

Provider missing unnoticed.

## 58.9 Relying on auto-discovery for security-critical components

Hard to audit.

## 58.10 Mixing `javax` and `jakarta`

Silent non-discovery.

---

# 59. Production Checklist

## 59.1 Binding

- [ ] Global providers intentionally global.
- [ ] Name-binding annotations include `@NameBinding`.
- [ ] Name-binding annotations have `RUNTIME` retention.
- [ ] Name-binding target includes `TYPE` and/or `METHOD`.
- [ ] Multiple binding annotations reviewed for AND semantics.
- [ ] `@PreMatching` not mixed with expected name binding.
- [ ] DynamicFeature only where needed.

## 59.2 Registration

- [ ] Critical providers explicitly registered or verified.
- [ ] `@Provider` present where relying on scanning.
- [ ] `Application#getClasses()` reviewed.
- [ ] `getSingletons()` avoided for new code.
- [ ] Provider duplicates audited.
- [ ] JSON provider strategy explicit.

## 59.3 Priority

- [ ] Priority set where order matters.
- [ ] Priority bands documented.
- [ ] Same-priority dependency avoided.
- [ ] Request/response reverse ordering understood.
- [ ] Interceptor transformation order tested.

## 59.4 Lifecycle/thread safety

- [ ] Providers have no request-specific mutable fields.
- [ ] Collaborators are thread-safe or scoped.
- [ ] Request state uses local/context/request-scoped bean.
- [ ] CDI injection tested.
- [ ] `@Context` methods not used in constructor.

## 59.5 Security

- [ ] Auth before authorization.
- [ ] Security policies visible/reviewed.
- [ ] Dynamic binding not hiding critical policy.
- [ ] Forwarded/gateway policy not implicit.
- [ ] Provider catalog internal, not public.

## 59.6 Tests

- [ ] Runtime test for global provider.
- [ ] Runtime test for name-bound provider.
- [ ] Runtime test for DynamicFeature.
- [ ] Priority order test.
- [ ] CDI injection test.
- [ ] Migration namespace test.
- [ ] Negative unbound endpoint test.

---

# 60. Latihan

## Latihan 1 — Custom Name Binding

Buat:

```java
@Audited
```

Apply hanya pada `POST /customers`.

Pastikan filter tidak berjalan pada `GET /customers`.

## Latihan 2 — Multiple Binding AND

Buat:

```java
@Audited
@Verbose
```

Provider dengan dua annotation.

Test bahwa provider hanya jalan jika resource method punya keduanya.

## Latihan 3 — DynamicFeature Annotation Value

Buat:

```java
@RequiresScope("case:read")
```

DynamicFeature membaca value lalu register authorization filter.

Test forbidden jika scope tidak ada.

## Latihan 4 — Rate Limit Dynamic Binding

Buat:

```java
@RateLimited(policy = "payment-create")
```

Register `RateLimitFilter(policy)`.

Test dua endpoint dengan policy berbeda.

## Latihan 5 — Priority Chain

Buat filters:

- correlation priority 900;
- authentication 1000;
- tenant 1900;
- authorization 2000.

Test urutan via request property/header.

## Latihan 6 — Provider Lifecycle Race

Buat provider dengan mutable field request-specific.

Load test paralel.

Lihat race.

Refactor ke local variable/request property.

## Latihan 7 — CDI Injection Test

Buat provider yang `@Inject ProblemFactory`.

Test provider via runtime.

Lalu register provider manual dengan `new`.

Amati perbedaan.

## Latihan 8 — Application Registration

Buat `ApiApplication#getClasses()` eksplisit.

Pastikan semua provider critical terdaftar.

## Latihan 9 — Provider Conflict Audit

Tambahkan JSON-B dan Jackson provider sekaligus.

Buat test output JSON.

Lalu hapus salah satu dan dokumentasikan strategi.

---

# 61. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

2. Jakarta RESTful Web Services 4.0 — `NameBinding` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/namebinding

3. Jakarta RESTful Web Services 4.0 — `DynamicFeature` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/dynamicfeature

4. Jakarta RESTful Web Services 4.0 — `FeatureContext` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/featurecontext

5. Jakarta RESTful Web Services 4.0 — `Provider` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/provider

6. Jakarta RESTful Web Services 4.0 — `Priorities` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/priorities

7. Jakarta RESTful Web Services 4.0 — `Application` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/application

8. Jakarta RESTful Web Services 4.0 — `Configurable` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/configurable

9. Jersey Documentation — Filters and Interceptors  
   https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest/filters-and-interceptors.html

10. RESTEasy User Guide — Interceptors and Filters  
    https://docs.resteasy.dev/5.0/userguide/html/ch31.html

---

# 62. Penutup

Provider binding dan lifecycle adalah bagian yang sering tidak terlihat, tetapi sangat menentukan stabilitas API.

Mental model final:

```text
@Provider        = discoverable extension component
global provider = applies broadly
@NameBinding    = selective static binding
DynamicFeature  = deployment-time dynamic per-method binding
@Priority       = execution order contract
Application     = registration/configuration root
Provider lifecycle = usually singleton, therefore must be thread-safe
```

Prinsip final:

```text
Make extension behavior visible.
Make order explicit.
Make lifecycle safe.
Make registration deterministic.
Test via runtime.
```

Top-tier JAX-RS engineer tidak hanya menulis filter/interceptor.

Ia mendesain:

- provider catalog;
- priority bands;
- binding strategy;
- explicit security modules;
- CDI/lifecycle rules;
- thread-safety constraints;
- tests that prove behavior.

Part berikutnya:

```text
Bagian 018 — Security in JAX-RS: Authentication, Authorization, Principal, Roles
```

Kita akan membahas security boundary secara mendalam: authentication mechanisms, `SecurityContext`, principal mapping, role/scope mapping, Jakarta Security, JWT/OIDC integration, authorization architecture, tenant/data authorization, and production hardening.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-jaxrs-advanced-part-016.md">⬅️ Bagian 016 — Interceptors: `ReaderInterceptor`, `WriterInterceptor`, Entity Stream Pipeline, Compression, Encryption, Signature, Body Hash, Priority, Name Binding, dan Production-Safe Stream Transformation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-jaxrs-advanced-part-018.md">Bagian 018 — Security in JAX-RS: Authentication, Authorization, `SecurityContext`, Principal, Roles, Scopes, JWT/OIDC, Jakarta Security, Tenant/Data Authorization, dan Production Hardening ➡️</a>
</div>
