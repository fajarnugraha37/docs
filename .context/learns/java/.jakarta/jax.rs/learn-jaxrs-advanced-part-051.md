# learn-jaxrs-advanced-part-051.md

# Bagian 051 — JAX-RS Runtime Internals and Extension Points: Bootstrap, Application Model, Resource Scanning, Request Matching, Provider Registry, Injection, Filters/Interceptors Pipeline, Entity Provider Selection, Exception Mapper Resolution, Async Internals, and Extension Design

> Target pembaca: Java/Jakarta engineer yang ingin memahami **bagaimana Jakarta REST/JAX-RS runtime bekerja di dalam**. Fokus bagian ini bukan hanya memakai annotation, tetapi memahami mental model runtime: bootstrap, `Application`, discovery, resource model, request matching, subresource locator, injection, provider registry, feature/dynamic feature, filters, interceptors, entity provider selection, exception mapper resolution, async processing, and portable extension design.
>
> Prinsip utama:
>
> ```text
> Top-tier JAX-RS engineer tidak hanya tahu annotation.
> Ia tahu kapan runtime memilih resource, provider, mapper, filter, interceptor, dan bagaimana extension memengaruhi request pipeline.
> ```

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Runtime as Request-to-Method Compiler](#2-mental-model-runtime-as-request-to-method-compiler)
3. [Spec vs Implementation](#3-spec-vs-implementation)
4. [Bootstrap Lifecycle](#4-bootstrap-lifecycle)
5. [`Application` and `@ApplicationPath`](#5-application-and-applicationpath)
6. [Application Model](#6-application-model)
7. [Resource Discovery and Registration](#7-resource-discovery-and-registration)
8. [Provider Discovery and Registration](#8-provider-discovery-and-registration)
9. [Class Scanning vs Explicit Registration](#9-class-scanning-vs-explicit-registration)
10. [Resource Model Construction](#10-resource-model-construction)
11. [Request Pipeline Overview](#11-request-pipeline-overview)
12. [Request Matching Internals](#12-request-matching-internals)
13. [Path Template and Regex Matching](#13-path-template-and-regex-matching)
14. [Subresource Locators](#14-subresource-locators)
15. [HTTP Method Selection](#15-http-method-selection)
16. [Content Negotiation Selection](#16-content-negotiation-selection)
17. [Parameter Injection Internals](#17-parameter-injection-internals)
18. [Context Injection](#18-context-injection)
19. [CDI Integration and Lifecycle](#19-cdi-integration-and-lifecycle)
20. [Provider Registry](#20-provider-registry)
21. [Feature and DynamicFeature](#21-feature-and-dynamicfeature)
22. [Name Binding](#22-name-binding)
23. [Priorities](#23-priorities)
24. [ContainerRequestFilter Pipeline](#24-containerrequestfilter-pipeline)
25. [ContainerResponseFilter Pipeline](#25-containerresponsefilter-pipeline)
26. [ReaderInterceptor Pipeline](#26-readerinterceptor-pipeline)
27. [WriterInterceptor Pipeline](#27-writerinterceptor-pipeline)
28. [MessageBodyReader Selection](#28-messagebodyreader-selection)
29. [MessageBodyWriter Selection](#29-messagebodywriter-selection)
30. [ContextResolver](#30-contextresolver)
31. [ParamConverterProvider](#31-paramconverterprovider)
32. [ExceptionMapper Resolution](#32-exceptionmapper-resolution)
33. [WebApplicationException](#33-webapplicationexception)
34. [AsyncResponse Internals](#34-asyncresponse-internals)
35. [CompletionStage Resource Methods](#35-completionstage-resource-methods)
36. [SSE Runtime Model](#36-sse-runtime-model)
37. [StreamingOutput Runtime Model](#37-streamingoutput-runtime-model)
38. [Client Runtime Internals](#38-client-runtime-internals)
39. [Configuration Model](#39-configuration-model)
40. [Properties and Vendor-Specific Extensions](#40-properties-and-vendor-specific-extensions)
41. [Portable Extension Design](#41-portable-extension-design)
42. [Performance Implications](#42-performance-implications)
43. [Debugging Runtime Behavior](#43-debugging-runtime-behavior)
44. [Testing Extension Points](#44-testing-extension-points)
45. [Implementation Differences](#45-implementation-differences)
46. [Common Failure Modes](#46-common-failure-modes)
47. [Best Practices](#47-best-practices)
48. [Anti-Patterns](#48-anti-patterns)
49. [Production Checklist](#49-production-checklist)
50. [Latihan](#50-latihan)
51. [Referensi Resmi](#51-referensi-resmi)
52. [Penutup](#52-penutup)

---

# 1. Tujuan Part Ini

Jika kita hanya tahu annotation:

```java
@Path("/customers")
@GET
@Produces(MediaType.APPLICATION_JSON)
```

kita bisa membuat API.

Tetapi saat production/debugging, muncul pertanyaan:

```text
Kenapa endpoint ini tidak match?
Kenapa 404 bukan 405?
Kenapa 415?
Kenapa provider JSON custom tidak dipakai?
Kenapa ExceptionMapper ini tidak terpanggil?
Kenapa filter jalan untuk semua endpoint?
Kenapa response filter tetap jalan saat abort?
Kenapa request body sudah consumed?
Kenapa @Context null di provider tertentu?
Kenapa async request kehilangan context?
Kenapa Jersey dan RESTEasy berbeda behavior di extension tertentu?
```

Untuk menjawab itu, kita perlu memahami runtime internals.

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- memahami bootstrap dan application model;
- membaca request matching behavior;
- memahami provider registry dan selection;
- mendesain filters/interceptors/features dengan benar;
- memahami exception mapper resolution;
- memahami async/SSE/streaming pipeline;
- membuat extension portable;
- men-debug JAX-RS runtime behavior secara sistematis.

---

# 2. Mental Model: Runtime as Request-to-Method Compiler

JAX-RS runtime melakukan pekerjaan seperti compiler saat startup dan dispatcher saat runtime.

## 2.1 Startup

Runtime membaca:

```text
Application
resource classes
provider classes
annotations
features
configuration
```

Lalu membangun model internal:

```text
resource tree
method mapping
provider registry
filter/interceptor chain
converter registry
exception mapper registry
```

## 2.2 Runtime request

Untuk setiap request:

```text
normalize request
match resource/method
inject params/context/entity
run filters/interceptors
invoke method
write response
map exceptions
```

## 2.3 Rule

JAX-RS runtime is a deterministic selection engine. Understand its selection rules.

---

# 3. Spec vs Implementation

Jakarta REST specification defines portable contract.

Implementations provide runtime:

- Jersey;
- RESTEasy;
- Apache CXF;
- Open Liberty;
- Quarkus REST;
- others.

## 3.1 Spec defines

- annotations;
- lifecycle rules;
- matching algorithm;
- providers;
- client API;
- filters/interceptors;
- exception mapping.

## 3.2 Implementation defines

- scanning performance;
- internal model;
- diagnostics;
- connector;
- non-standard features;
- build-time optimization;
- native image support.

## 3.3 Rule

Depend on spec for portability; isolate implementation-specific behavior.

---

# 4. Bootstrap Lifecycle

Typical bootstrap:

```text
container starts
  ↓
find Application subclass or servlet mapping
  ↓
scan/register resource/provider classes
  ↓
instantiate/configure providers/features
  ↓
build application model
  ↓
ready to dispatch requests
```

## 4.1 Servlet environment

JAX-RS often runs inside servlet container.

## 4.2 Jakarta EE environment

Runtime integrates with CDI/security/validation/etc.

## 4.3 Build-time runtimes

Some runtimes precompute model at build time.

## 4.4 Rule

Startup behavior affects discovery, injection, performance, and diagnostics.

---

# 5. `Application` and `@ApplicationPath`

`Application` defines JAX-RS application.

```java
@ApplicationPath("/api")
public class RestApplication extends Application {
}
```

## 5.1 Manual registration

```java
@Override
public Set<Class<?>> getClasses() {
    return Set.of(CustomerResource.class, ProblemMapper.class);
}
```

## 5.2 Singleton registration

```java
@Override
public Set<Object> getSingletons() {
    return Set.of(new CustomFeature());
}
```

## 5.3 Rule

`Application` is the root of runtime model and deployment boundary.

---

# 6. Application Model

Application model contains:

- root resource classes;
- subresource locator graph;
- resource methods;
- providers;
- features;
- properties;
- media type declarations;
- name bindings;
- priorities.

## 6.1 Why it matters

Most runtime decisions are based on this model.

## 6.2 Rule

If runtime model is wrong, request behavior is wrong.

---

# 7. Resource Discovery and Registration

Resource class usually has `@Path`.

```java
@Path("/customers")
public class CustomerResource { ... }
```

## 7.1 Discovery modes

- classpath scanning;
- explicit registration;
- framework build-time index;
- servlet config;
- runtime-specific package scanning.

## 7.2 Rule

Know how your runtime discovers resources.

---

# 8. Provider Discovery and Registration

Providers include:

- `MessageBodyReader`;
- `MessageBodyWriter`;
- `ExceptionMapper`;
- filters;
- interceptors;
- features;
- `ParamConverterProvider`;
- `ContextResolver`.

Provider often annotated:

```java
@Provider
public class ProblemMapper implements ExceptionMapper<DomainException> { ... }
```

## 8.1 Registration

- `@Provider` scanning;
- `Application#getClasses`;
- programmatic `Configurable#register`;
- feature registration;
- runtime-specific config.

## 8.2 Rule

A provider not registered is invisible.

---

# 9. Class Scanning vs Explicit Registration

## 9.1 Scanning

Pros:

- convenient;
- less boilerplate.

Cons:

- startup cost;
- accidental provider discovery;
- ambiguous behavior;
- harder to audit.

## 9.2 Explicit registration

Pros:

- deterministic;
- smaller runtime model;
- better startup;
- easier audit.

Cons:

- boilerplate;
- can forget classes.

## 9.3 Rule

For large enterprise services, prefer deterministic registration or runtime build-time indexing where available.

---

# 10. Resource Model Construction

Runtime reads annotations:

```text
@Path
@GET/@POST/...
@Consumes
@Produces
@BeanParam
@PathParam
@Context
```

Builds internal tree:

```text
/customer root
  /{id} method GET
  /{id}/orders subresource
```

## 10.1 Ambiguity

Ambiguous methods can cause startup error or runtime selection surprises depending situation.

## 10.2 Rule

Resource model should be unambiguous and reviewable.

---

# 11. Request Pipeline Overview

Simplified server pipeline:

```text
incoming request
  ↓
pre-matching request filters
  ↓
resource matching
  ↓
post-matching request filters
  ↓
entity reader interceptors
  ↓
MessageBodyReader
  ↓
param/context injection
  ↓
resource method
  ↓
exception mapper if exception
  ↓
writer interceptors
  ↓
MessageBodyWriter
  ↓
response filters
  ↓
response sent
```

Exact ordering details depend spec rules and whether exception/abort/async occurs.

## 11.1 Rule

Every extension point has position in pipeline. Use the right one.

---

# 12. Request Matching Internals

Matching determines resource method.

Inputs:

- request path;
- HTTP method;
- `Content-Type`;
- `Accept`;
- resource annotations.

High-level:

```text
match root resource path
match subresource path
select method by HTTP method
select by consumes
select by produces
```

## 12.1 Important outputs

- 404 if no path/resource match;
- 405 if path exists but method not allowed;
- 415 if media type not consumable;
- 406 if response media not acceptable.

## 12.2 Rule

Status 404/405/415/406 often indicates different stage of matching failed.

---

# 13. Path Template and Regex Matching

Path template:

```java
@Path("/customers/{id}")
```

Regex:

```java
@Path("/customers/{id:[0-9]+}")
```

## 13.1 Matching priority

Runtime chooses most specific match by spec algorithm.

## 13.2 Pitfall

Overlapping paths:

```java
@Path("/{id}")
@Path("/search")
```

can surprise if not designed carefully.

## 13.3 Rule

Avoid ambiguous path patterns and broad catch-all paths.

---

# 14. Subresource Locators

Subresource locator has `@Path` but no HTTP method annotation.

```java
@Path("/customers/{id}")
public CustomerSubresource customer(@PathParam("id") String id) {
    return new CustomerSubresource(id);
}
```

## 14.1 Runtime behavior

Runtime continues matching on returned subresource object/class.

## 14.2 Pros

- modular resource tree;
- dynamic dispatch;
- object-specific context.

## 14.3 Cons

- harder to trace;
- more lifecycle complexity;
- possible per-request allocation;
- less obvious OpenAPI generation.

## 14.4 Rule

Use subresource locators for meaningful hierarchical resources, not clever routing.

---

# 15. HTTP Method Selection

Methods annotated with:

```java
@GET
@POST
@PUT
@PATCH
@DELETE
@HEAD
@OPTIONS
```

## 15.1 HEAD/OPTIONS

Runtime may provide automatic behavior depending spec/implementation.

## 15.2 405

If path matches but method unavailable, should produce Method Not Allowed with Allow header.

## 15.3 Rule

Correct HTTP method annotations are part of runtime selection and client contract.

---

# 16. Content Negotiation Selection

## 16.1 `@Consumes`

Matches request entity media type.

If no reader/consumes match:

```text
415 Unsupported Media Type
```

## 16.2 `@Produces`

Matches `Accept`.

If no producible representation:

```text
406 Not Acceptable
```

## 16.3 Rule

Media type annotations participate in method selection, not only documentation.

---

# 17. Parameter Injection Internals

Runtime resolves:

- `@PathParam`;
- `@QueryParam`;
- `@HeaderParam`;
- `@CookieParam`;
- `@MatrixParam`;
- `@BeanParam`;
- entity parameter;
- `@Context`.

## 17.1 Conversion order

Uses built-in conversion and custom `ParamConverterProvider`.

## 17.2 Errors

Bad conversion usually produces 400-ish errors depending parameter type and implementation.

## 17.3 Rule

Parameter conversion should be deterministic, cheap, and side-effect-free.

---

# 18. Context Injection

`@Context` can inject contextual objects:

- `UriInfo`;
- `HttpHeaders`;
- `Request`;
- `SecurityContext`;
- `ContainerRequestContext` in filters;
- `Providers`;
- `Configuration`;
- `ResourceContext`;
- `Sse`;
- etc.

## 18.1 Runtime scope

Context is request-specific for many types.

## 18.2 Rule

Do not store request-scoped context in application singleton fields.

---

# 19. CDI Integration and Lifecycle

Resource/provider lifecycle may be managed by CDI in Jakarta EE runtimes.

## 19.1 CDI-managed benefits

- injection;
- interceptors;
- scopes;
- events;
- decorators.

## 19.2 Lifecycle ambiguity

A provider may be singleton-like; resource may be per-request or CDI scoped depending runtime/config.

## 19.3 Rule

Assume providers must be thread-safe unless you know lifecycle exactly.

---

# 20. Provider Registry

Provider registry contains all registered providers and metadata:

- class/type;
- media types;
- generic types;
- priority;
- name binding;
- contracts.

## 20.1 Selection

Runtime queries registry when it needs:

- read entity;
- write entity;
- map exception;
- convert param;
- resolve context;
- run filters/interceptors.

## 20.2 Rule

Provider registration order/priority/contracts matter.

---

# 21. Feature and DynamicFeature

## 21.1 Feature

Registers components globally/configurationally.

```java
public class ObservabilityFeature implements Feature {
    @Override
    public boolean configure(FeatureContext context) {
        context.register(CorrelationFilter.class);
        return true;
    }
}
```

## 21.2 DynamicFeature

Registers providers dynamically for selected resource method/class.

```java
@Provider
public class AuditDynamicFeature implements DynamicFeature {
    @Override
    public void configure(ResourceInfo resourceInfo, FeatureContext context) {
        if (resourceInfo.getResourceMethod().isAnnotationPresent(Audited.class)) {
            context.register(AuditFilter.class);
        }
    }
}
```

## 21.3 Rule

Use `Feature` for global modules, `DynamicFeature` for resource-aware conditional binding.

---

# 22. Name Binding

Name binding associates filters/interceptors with annotated resource methods/classes.

## 22.1 Define annotation

```java
@NameBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface Audited {}
```

## 22.2 Apply

```java
@Audited
@POST
public Response submit(...) { ... }
```

## 22.3 Provider

```java
@Provider
@Audited
public class AuditFilter implements ContainerRequestFilter { ... }
```

## 22.4 Rule

Name binding is declarative, simple, and portable.

---

# 23. Priorities

`@Priority` controls provider ordering.

Common constants in `Priorities`:

- authentication;
- authorization;
- header decorator;
- entity coder;
- user.

## 23.1 Example

```java
@Priority(Priorities.AUTHENTICATION)
public class AuthenticationFilter implements ContainerRequestFilter { ... }
```

## 23.2 Rule

Security and observability filters should have explicit priority.

---

# 24. ContainerRequestFilter Pipeline

Request filters can be:

- pre-matching;
- post-matching.

## 24.1 Pre-matching

Annotated with `@PreMatching`.

Runs before resource matching.

Use for:

- method override;
- URI normalization;
- early correlation ID;
- request rejection.

## 24.2 Post-matching

Runs after resource method selected.

Use for:

- authz based on resource;
- name-bound filters;
- operation-specific logic.

## 24.3 Abort

Filter can abort:

```java
requestContext.abortWith(response);
```

## 24.4 Rule

Use pre-matching only when matching itself must be affected or very early rejection is needed.

---

# 25. ContainerResponseFilter Pipeline

Response filters run before response is sent.

Use for:

- headers;
- CORS;
- security headers;
- metrics;
- correlation ID response header;
- cache headers.

## 25.1 Exception path

Response filters may run on mapped exception responses.

## 25.2 Rule

Response filters should not assume resource method succeeded.

---

# 26. ReaderInterceptor Pipeline

Reader interceptors wrap entity reading.

Use for:

- decompression;
- decryption;
- body auditing with care;
- input stream transformations.

## 26.1 Context

`ReaderInterceptorContext` can get/set input stream and proceed.

## 26.2 Rule

Reader interceptors operate on entity streams; misuse can consume/corrupt body.

---

# 27. WriterInterceptor Pipeline

Writer interceptors wrap entity writing.

Use for:

- compression;
- signing;
- encryption;
- response body transformation;
- output measurement.

## 27.1 Rule

Writer interceptors should preserve streaming semantics unless deliberately buffering.

---

# 28. MessageBodyReader Selection

Runtime chooses reader based on:

- Java type;
- generic type;
- annotations;
- media type;
- provider priority/specificity.

## 28.1 Example

```java
@Provider
@Consumes("application/vnd.customer+json")
public class CustomerReader implements MessageBodyReader<CustomerRequest> { ... }
```

## 28.2 Common issue

Custom reader not selected because media type or type mismatch.

## 28.3 Rule

Reader selection requires both type and media type compatibility.

---

# 29. MessageBodyWriter Selection

Runtime chooses writer based on:

- entity type;
- generic type;
- annotations;
- requested/selected media type;
- provider priority/specificity.

## 29.1 `GenericEntity`

Use to preserve generic type:

```java
GenericEntity<List<CustomerResponse>> entity =
    new GenericEntity<>(customers) {};
```

## 29.2 Rule

Generic type erasure can affect writer selection.

---

# 30. ContextResolver

`ContextResolver<T>` supplies context/config object for a type and media type.

## 30.1 Example

Configure JSON mapper/provider.

```java
@Provider
public class ObjectMapperResolver implements ContextResolver<ObjectMapper> {
    @Override
    public ObjectMapper getContext(Class<?> type) {
        return objectMapper;
    }
}
```

## 30.2 Rule

Use `ContextResolver` for provider configuration, not per-request mutable state.

---

# 31. ParamConverterProvider

Provides converters for parameter types.

## 31.1 Example

```java
@Provider
public class DomainIdParamConverterProvider implements ParamConverterProvider {
    @Override
    public <T> ParamConverter<T> getConverter(Class<T> rawType, Type genericType, Annotation[] annotations) {
        ...
    }
}
```

## 31.2 Rule

Param converters should parse/validate syntax, not hit database/downstream.

---

# 32. ExceptionMapper Resolution

Runtime maps thrown exceptions to responses.

## 32.1 Selection

Most specific mapper for exception type.

Example:

```text
ApplicationNotFoundException mapper
DomainException mapper
Throwable mapper
```

Most specific wins.

## 32.2 No mapper

Runtime uses default behavior, often 500 or WebApplicationException response.

## 32.3 Rule

Define specific mappers and safe catch-all mapper.

---

# 33. WebApplicationException

`WebApplicationException` carries response/status.

## 33.1 Use

Can be convenient at resource boundary.

## 33.2 Risk

Random throwing can bypass standard Problem Details shape.

## 33.3 Rule

Normalize `WebApplicationException` through enterprise error mapper/factory.

---

# 34. AsyncResponse Internals

`AsyncResponse` suspends request processing.

## 34.1 Flow

```text
request matched
resource method receives AsyncResponse
method returns quickly
response remains suspended
background work resumes response
runtime writes response
```

## 34.2 Timeout

Set timeout and timeout handler.

## 34.3 Context

Request context may not safely flow to background thread unless propagated.

## 34.4 Rule

Async response lifecycle must be completed, timed out, or cancelled.

---

# 35. CompletionStage Resource Methods

Resource method can return `CompletionStage<T>`.

```java
@GET
public CompletionStage<CustomerResponse> get() { ... }
```

Runtime writes response when stage completes.

## 35.1 Failure

Exception completion goes through exception mapping.

## 35.2 Rule

CompletionStage simplifies async response but does not remove need for executor/context/error handling.

---

# 36. SSE Runtime Model

SSE uses server-managed event sink/broadcaster.

## 36.1 Runtime concerns

- connection lifecycle;
- write failures;
- backpressure;
- heartbeat;
- resource cleanup.

## 36.2 Rule

SSE is long-lived response with resource management obligations.

---

# 37. StreamingOutput Runtime Model

`StreamingOutput` writes response body to output stream.

## 37.1 Flow

Resource returns entity.

Runtime invokes `write(OutputStream)` during entity writing.

## 37.2 Exceptions

IOException may happen after headers committed.

## 37.3 Rule

Streaming errors after commit cannot always become clean Problem Details.

---

# 38. Client Runtime Internals

Client side has:

- `Client`;
- connector;
- filters;
- interceptors;
- entity providers;
- response processing;
- exception mapping style if MP Rest Client;
- connection pool if connector supports.

## 38.1 Rule

Client runtime also has provider/filter pipeline; configure it explicitly.

---

# 39. Configuration Model

JAX-RS components can access `Configuration`.

```java
@Context
Configuration configuration;
```

## 39.1 Properties

Runtime properties can tune behavior.

## 39.2 Rule

Properties are often implementation-specific; isolate them.

---

# 40. Properties and Vendor-Specific Extensions

Examples:

- Jersey-specific properties;
- RESTEasy-specific features;
- CXF interceptors;
- Quarkus build-time config;
- Liberty feature config.

## 40.1 Risk

Portability loss.

## 40.2 Strategy

Wrap vendor-specific config in infrastructure module.

Document and test.

## 40.3 Rule

Use vendor extensions deliberately, not accidentally.

---

# 41. Portable Extension Design

Portable extension should:

- use Jakarta REST standard interfaces;
- avoid implementation internal classes;
- be stateless/thread-safe;
- use CDI only where runtime supports expected integration;
- expose config;
- have tests across target runtimes if portability matters.

## 41.1 Rule

A portable extension depends on contracts, not implementation internals.

---

# 42. Performance Implications

Runtime internals affect performance:

- scanning startup;
- provider lookup;
- filter count;
- interceptor buffering;
- JSON provider;
- subresource allocation;
- exception-heavy flow;
- async executor;
- response streaming.

## 42.1 Rule

Every extension point adds overhead. Measure before adding global providers.

---

# 43. Debugging Runtime Behavior

## 43.1 Debug matching

Check:

- application path;
- context path;
- proxy prefix;
- resource `@Path`;
- HTTP method;
- consumes/produces;
- media types.

## 43.2 Debug provider

Check:

- registered?
- media type compatible?
- type compatible?
- priority?
- generic type?
- annotations?

## 43.3 Debug mapper

Check:

- thrown exception exact type;
- mapper type parameter;
- provider registered;
- more specific mapper exists;
- WebApplicationException behavior.

## 43.4 Rule

Debug by pipeline stage.

---

# 44. Testing Extension Points

Test:

- filter ordering;
- name binding;
- DynamicFeature registration;
- request abort;
- response filter on errors;
- reader/writer selection;
- exception mapper specificity;
- async timeout;
- context propagation.

## 44.1 Rule

Extension behavior should have integration tests, not only unit tests.

---

# 45. Implementation Differences

## 45.1 Common differences

- discovery/scanning;
- CDI integration depth;
- default JSON provider;
- multipart support;
- native image support;
- diagnostics/logging;
- async executor;
- client connector.

## 45.2 Rule

If relying on non-trivial behavior, test on production runtime.

---

# 46. Common Failure Modes

## 46.1 Provider not registered

No effect.

## 46.2 Wrong media type

Reader/writer not selected.

## 46.3 Filter global accidentally

Unexpected overhead/behavior.

## 46.4 Consuming request body in filter

Entity reader fails.

## 46.5 Missing priority

Auth order wrong.

## 46.6 Catch-all mapper hides WebApplicationException

Wrong error response.

## 46.7 ThreadLocal context lost in async

Security/tenant bug.

## 46.8 Streaming error after commit

Cannot map cleanly.

## 46.9 Vendor extension used unknowingly

Migration pain.

## 46.10 Explicit Application registration excludes scanned providers

Feature missing.

---

# 47. Best Practices

## 47.1 Know pipeline stage

Choose correct extension point.

## 47.2 Use explicit priorities

For security/observability.

## 47.3 Keep providers stateless

Thread-safe.

## 47.4 Prefer name binding

For operation-specific filters.

## 47.5 Use DynamicFeature carefully

Powerful but hidden registration.

## 47.6 Standardize error mapping

Catch-all safe mapper.

## 47.7 Test provider selection

Especially custom JSON/media types.

## 47.8 Avoid body logging filters

Use interceptors/limited safe logging if needed.

## 47.9 Document runtime properties

Vendor-specific config.

## 47.10 Test target runtime

Portability reality check.

---

# 48. Anti-Patterns

## 48.1 “Annotation should just work”

Runtime model may not include it.

## 48.2 Put logic in global filter

Overreach.

## 48.3 Database call in ParamConverter

Bad pipeline abuse.

## 48.4 Store request context in singleton

Thread safety bug.

## 48.5 Use implementation internals in business code

Lock-in.

## 48.6 Catch Throwable and return 200

Breaks contract.

## 48.7 Buffer streaming responses in writer interceptor

Breaks streaming.

## 48.8 DynamicFeature with complex hidden rules

Hard to debug.

## 48.9 No integration tests for providers

Production surprise.

## 48.10 Assume same behavior across runtimes

Danger.

---

# 49. Production Checklist

## 49.1 Application model

- [ ] Application path documented.
- [ ] Resource registration deterministic.
- [ ] Providers registered explicitly or scanning verified.
- [ ] Runtime-specific scanning understood.
- [ ] Startup diagnostics enabled.

## 49.2 Pipeline

- [ ] Auth filter priority.
- [ ] CORS/security header filters ordered.
- [ ] Name-bound filters tested.
- [ ] DynamicFeatures tested.
- [ ] Reader/writer interceptors reviewed.
- [ ] Body consuming behavior safe.

## 49.3 Providers

- [ ] JSON provider selected intentionally.
- [ ] Custom readers/writers tested.
- [ ] ParamConverters side-effect-free.
- [ ] ContextResolvers stateless.
- [ ] ExceptionMappers specific + catch-all.
- [ ] Problem Details shape consistent.

## 49.4 Async/streaming

- [ ] Async timeouts.
- [ ] Context propagation.
- [ ] Cancellation handling.
- [ ] SSE cleanup.
- [ ] Streaming error behavior understood.

## 49.5 Portability/performance

- [ ] Vendor-specific properties isolated.
- [ ] Global provider overhead measured.
- [ ] Runtime target tested.
- [ ] Upgrade/migration notes documented.

---

# 50. Latihan

## Latihan 1 — Runtime Pipeline Trace

Buat filter/interceptor/mapper kecil yang mencatat urutan pipeline.

Trigger:

- success response;
- validation error;
- resource exception;
- abort in request filter.

## Latihan 2 — Provider Selection

Buat dua `MessageBodyWriter` untuk media type berbeda.

Test `Accept` memilih writer yang benar.

## Latihan 3 — ExceptionMapper Specificity

Buat:

```text
DomainExceptionMapper
ApplicationNotFoundMapper
ThrowableMapper
```

Test mapper paling spesifik dipilih.

## Latihan 4 — Name Binding

Buat `@Audited`.

Pastikan audit filter hanya jalan untuk annotated endpoint.

## Latihan 5 — DynamicFeature

Register filter hanya untuk method dengan `@RequiresTenant`.

Test endpoint lain tidak terkena.

## Latihan 6 — ParamConverter

Buat converter `ApplicationId`.

Pastikan invalid ID menghasilkan Problem Details valid.

## Latihan 7 — Async Context

Buat `CompletionStage` endpoint.

Test correlation/tenant context tetap ada di log/trace atau dipropagate eksplisit.

## Latihan 8 — Streaming Error

Buat `StreamingOutput` yang gagal setelah menulis sebagian data.

Amati behavior dan dokumentasikan recovery strategy.

---

# 51. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

2. Jakarta RESTful Web Services Project Website  
   https://jakarta.ee/specifications/restful-ws/

3. Jakarta RESTful Web Services 4.0 API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/

4. Jakarta RESTful Web Services 4.0 Release Notes  
   https://projects.eclipse.org/projects/ee4j.rest/releases/4.0.0

5. Jakarta RESTful Web Services GitHub Project  
   https://jakartaee.github.io/rest/

6. Jersey Documentation — Filters and Interceptors  
   https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest31x/filters-and-interceptors.html

7. Jersey Documentation — Resources and Subresources  
   https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest31x/jaxrs-resources.html

---

# 52. Penutup

Memahami runtime internals membuat kamu bisa men-debug dan mendesain extension dengan presisi.

Mental model final:

```text
bootstrap
  ↓
application model
  ↓
resource/provider registry
  ↓
request matching
  ↓
filter/interceptor/entity/provider pipeline
  ↓
resource invocation
  ↓
exception/response/entity writing
  ↓
async/streaming lifecycle
```

Prinsip final:

```text
Resource matching is deterministic.
Provider selection depends on type + media + priority.
Filters and interceptors are pipeline hooks.
ExceptionMapper is contract boundary.
Async changes lifecycle.
Streaming changes error semantics.
Vendor-specific extensions must be isolated.
Integration tests prove runtime behavior.
```

Top-tier JAX-RS engineer memastikan:

- runtime model bisa diprediksi;
- provider/filter/interceptor dipakai di posisi yang tepat;
- exception mapping konsisten;
- async/streaming lifecycle aman;
- extension portable atau vendor-specific dengan sadar;
- runtime behavior diuji di target implementation;
- debugging dilakukan berdasarkan pipeline stage, bukan tebak-tebakan.

Part berikutnya:

```text
Bagian 052 — Building a Production-Grade JAX-RS API from Scratch
```

Kita akan membangun desain API production-grade dari nol: package structure, resource design, DTOs, validation, error contract, security, persistence, client integration, observability, OpenAPI, tests, deployment, and operational checklist.
