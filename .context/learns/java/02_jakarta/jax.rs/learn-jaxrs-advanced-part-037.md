# learn-jaxrs-advanced-part-037.md

# Bagian 037 — Implementation Deep Dive: Jersey, RESTEasy, Apache CXF, Open Liberty, Quarkus REST, Provider Discovery, CDI Integration, Client Connector, Multipart, SSE, Async, Testing Tools, Performance Knobs, and Migration Strategy

> Target pembaca: Java/Jakarta engineer yang ingin memahami **perbedaan implementasi Jakarta REST/JAX-RS** secara production-grade. Fokus bagian ini bukan “mana yang paling bagus”, tetapi bagaimana memilih dan mengoperasikan implementation/runtime: Jersey, RESTEasy, Apache CXF, Open Liberty, Quarkus REST, dan ekosistem terkait. Kita akan membahas portability, extension APIs, provider discovery, CDI integration, client connector, multipart, SSE, async, filters/interceptors, JSON provider, testing tools, performance knobs, migration, dan runtime selection.
>
> Catatan penting: **Jakarta REST adalah specification/API**, sedangkan Jersey/RESTEasy/CXF/Liberty/Quarkus adalah implementation/runtime atau platform yang mengimplementasikan/mengemas specification tersebut. Top-tier engineer harus bisa menulis portable code, tetapi juga tahu kapan dan bagaimana memakai extension secara sadar.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Specification vs Implementation vs Runtime Platform](#2-mental-model-specification-vs-implementation-vs-runtime-platform)
3. [Jakarta REST Portability Boundary](#3-jakarta-rest-portability-boundary)
4. [Implementation Selection Criteria](#4-implementation-selection-criteria)
5. [Jersey Overview](#5-jersey-overview)
6. [RESTEasy Overview](#6-resteasy-overview)
7. [Apache CXF Overview](#7-apache-cxf-overview)
8. [Open Liberty Overview](#8-open-liberty-overview)
9. [Quarkus REST Overview](#9-quarkus-rest-overview)
10. [Comparison Matrix](#10-comparison-matrix)
11. [Provider Discovery and Registration](#11-provider-discovery-and-registration)
12. [Application Class and Scanning](#12-application-class-and-scanning)
13. [CDI Integration Differences](#13-cdi-integration-differences)
14. [Resource Lifecycle Differences](#14-resource-lifecycle-differences)
15. [Provider Lifecycle and Thread Safety](#15-provider-lifecycle-and-thread-safety)
16. [JSON Provider Strategy](#16-json-provider-strategy)
17. [JSON-B vs Jackson Defaults](#17-json-b-vs-jackson-defaults)
18. [Exception Mapper Differences](#18-exception-mapper-differences)
19. [Filters and Interceptors](#19-filters-and-interceptors)
20. [Name Binding and DynamicFeature](#20-name-binding-and-dynamicfeature)
21. [Multipart Support](#21-multipart-support)
22. [SSE Support](#22-sse-support)
23. [Async and Reactive Behavior](#23-async-and-reactive-behavior)
24. [Streaming and Large File Handling](#24-streaming-and-large-file-handling)
25. [Client API Implementation Differences](#25-client-api-implementation-differences)
26. [Client Connector and Connection Pool](#26-client-connector-and-connection-pool)
27. [Timeout and Proxy Configuration](#27-timeout-and-proxy-configuration)
28. [TLS/mTLS Configuration](#28-tlsmtls-configuration)
29. [OpenAPI and MicroProfile Integration](#29-openapi-and-microprofile-integration)
30. [Metrics, Tracing, and Observability](#30-metrics-tracing-and-observability)
31. [Testing Tools per Runtime](#31-testing-tools-per-runtime)
32. [Packaging: WAR, Fat JAR, Native Image, Cloud Runtime](#32-packaging-war-fat-jar-native-image-cloud-runtime)
33. [Servlet Container vs Jakarta EE Runtime vs Build-Time Runtime](#33-servlet-container-vs-jakarta-ee-runtime-vs-build-time-runtime)
34. [Performance Knobs](#34-performance-knobs)
35. [Memory and Startup Time](#35-memory-and-startup-time)
36. [Native Image Caveats](#36-native-image-caveats)
37. [Migration: Jersey ↔ RESTEasy ↔ CXF ↔ Liberty ↔ Quarkus](#37-migration-jersey--resteasy--cxf--liberty--quarkus)
38. [Migration from javax.ws.rs to jakarta.ws.rs](#38-migration-from-javaxwsrs-to-jakartawsrs)
39. [Portable Code Guidelines](#39-portable-code-guidelines)
40. [When to Use Implementation-Specific APIs](#40-when-to-use-implementation-specific-apis)
41. [Runtime Selection Playbook](#41-runtime-selection-playbook)
42. [Architecture Patterns](#42-architecture-patterns)
43. [Operational Checklist](#43-operational-checklist)
44. [Common Failure Modes](#44-common-failure-modes)
45. [Best Practices](#45-best-practices)
46. [Anti-Patterns](#46-anti-patterns)
47. [Production Checklist](#47-production-checklist)
48. [Latihan](#48-latihan)
49. [Referensi Resmi](#49-referensi-resmi)
50. [Penutup](#50-penutup)

---

# 1. Tujuan Part Ini

Kamu bisa menulis resource class seperti ini:

```java
@Path("/customers")
public class CustomerResource {

    @GET
    @Path("/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public CustomerResponse get(@PathParam("id") String id) {
        return service.get(id);
    }
}
```

Kode tersebut terlihat portable.

Tetapi di production, behavior sebenarnya dipengaruhi oleh runtime/implementation:

- siapa yang menemukan resource/provider?
- apakah CDI injection aktif?
- provider lifecycle singleton atau CDI scoped?
- JSON provider default apa?
- multipart behavior streaming atau buffering?
- SSE client/server supported bagaimana?
- async worker thread model bagaimana?
- client connector/pool apa?
- timeout config standard atau vendor property?
- testing tool apa?
- apakah native image butuh reflection config?
- bagaimana observability integrated?
- apa beda behavior saat deploy di WildFly, Liberty, Quarkus, Tomcat+Jersey, atau CXF?

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- membedakan Jakarta REST specification vs implementation vs runtime platform;
- mengevaluasi Jersey, RESTEasy, Apache CXF, Open Liberty, dan Quarkus REST;
- menulis code portable tetapi sadar extension points;
- memahami provider/CDI/lifecycle differences;
- memilih JSON provider dan multipart/SSE/async strategy;
- menguji behavior di target runtime;
- memigrasikan aplikasi antar runtime;
- membuat runtime selection playbook.

## 1.2 Prinsip utama

```text
Write portable API code by default.
Use implementation-specific features intentionally.
Test on the runtime you deploy.
```

---

# 2. Mental Model: Specification vs Implementation vs Runtime Platform

## 2.1 Specification/API

Jakarta REST defines standard API:

```text
@Path
@GET
@POST
@Produces
@Consumes
Response
UriInfo
HttpHeaders
Client
MessageBodyReader/Writer
ContainerRequestFilter
ExceptionMapper
Sse
EntityPart
```

Specification defines expected contract and TCK verification.

## 2.2 Implementation

Implementation provides actual runtime behavior.

Examples:

- Jersey;
- RESTEasy;
- Apache CXF;
- Quarkus REST;
- runtime-specific integration layers.

## 2.3 Runtime platform

Runtime platform packages implementation with:

- CDI;
- Servlet;
- JSON provider;
- security;
- config;
- metrics;
- OpenAPI;
- deployment model;
- classloading;
- testing support.

Examples:

- WildFly;
- Open Liberty;
- Quarkus;
- Payara;
- standalone Servlet container with Jersey/CXF.

## 2.4 Top-tier rule

```text
The spec defines what should work.
The implementation defines how it actually behaves.
The platform defines how it is configured, deployed, observed, and tested.
```

---

# 3. Jakarta REST Portability Boundary

Portable code uses only standardized APIs:

```java
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.*;
import jakarta.ws.rs.ext.*;
import jakarta.ws.rs.client.*;
```

## 3.1 Portable examples

- `@Path`;
- `@ApplicationPath`;
- `Response`;
- `ExceptionMapper`;
- `ContainerRequestFilter`;
- `ReaderInterceptor`;
- `ParamConverterProvider`;
- `StreamingOutput`;
- `EntityPart`;
- `SseEventSink`;
- JAX-RS Client API.

## 3.2 Non-portable examples

- Jersey `ResourceConfig`;
- RESTEasy-specific multipart classes;
- CXF-specific search extension;
- Quarkus REST-specific reactive annotations/features;
- connector-specific client properties;
- runtime-specific config files.

## 3.3 Non-portable does not mean bad

It means:

```text
document it
isolate it
test it
own migration cost
```

## 3.4 Rule

Keep implementation-specific code at infrastructure boundary.

---

# 4. Implementation Selection Criteria

Choose implementation/runtime based on:

## 4.1 Compatibility

- Jakarta REST version;
- Jakarta EE version;
- Java version;
- CDI/JPA/Security integration;
- MicroProfile support.

## 4.2 Operational model

- WAR on app server;
- executable JAR;
- containerized cloud-native;
- native image;
- serverless-ish deployment.

## 4.3 Feature needs

- multipart;
- SSE;
- async/reactive;
- OpenAPI;
- metrics/tracing;
- client connector tuning;
- security integration.

## 4.4 Team capability

- existing platform;
- debugging familiarity;
- support model;
- documentation;
- upgrade cadence.

## 4.5 Performance/scale

- startup time;
- memory;
- throughput;
- latency;
- connection pool;
- event-loop vs worker model.

## 4.6 Rule

Runtime choice is architecture decision, not just dependency choice.

---

# 5. Jersey Overview

Jersey is an Eclipse EE4J REST framework and historically the JAX-RS reference implementation line.

## 5.1 Strengths

- mature JAX-RS ecosystem;
- good documentation;
- rich extension SPIs;
- Jersey Test Framework;
- works well standalone/Servlet containers;
- explicit `ResourceConfig`;
- strong client API support.

## 5.2 Common use cases

- standalone Java services;
- Servlet container apps;
- apps that want Jersey-specific features;
- tests using JerseyTest;
- custom JAX-RS extensions.

## 5.3 Common dependencies

Conceptually:

```text
jersey-server
jersey-container-servlet
jersey-hk2 or CDI integration module
jersey-media-json-binding / jackson module
jersey-media-multipart
jersey-client
```

Exact artifacts depend version.

## 5.4 Caveats

- Jersey-specific APIs reduce portability;
- dependency/module choice affects JSON/multipart/CDI behavior;
- HK2 vs CDI integration can confuse teams;
- ensure Jakarta namespace version matches your app.

## 5.5 Mental model

```text
Jersey is excellent when you want a direct JAX-RS implementation with rich control.
```

---

# 6. RESTEasy Overview

RESTEasy is a JBoss/Red Hat Jakarta REST implementation and is deeply associated with WildFly/JBoss ecosystem.

## 6.1 Strengths

- mature server implementation;
- strong WildFly integration;
- CDI/Jakarta EE integration;
- client support;
- multipart support;
- widely used in enterprise Java;
- Quarkus historically had RESTEasy Classic and now Quarkus REST.

## 6.2 Common use cases

- WildFly/JBoss EAP applications;
- Jakarta EE apps with RESTEasy built-in;
- Quarkus legacy RESTEasy Classic apps;
- enterprise environments already standardized on Red Hat stack.

## 6.3 Caveats

- classic RESTEasy vs Quarkus REST/RESTEasy Reactive can differ significantly;
- extension APIs may be non-portable;
- migration to Quarkus REST may require attention to blocking/reactive behavior;
- config depends platform.

## 6.4 Mental model

```text
RESTEasy is strong when your platform is WildFly/Red Hat/Quarkus-related and you value Jakarta EE integration.
```

---

# 7. Apache CXF Overview

Apache CXF is a broader services framework that includes JAX-RS support along with SOAP/JAX-WS and integration capabilities.

## 7.1 Strengths

- broad web services platform;
- JAX-RS and JAX-WS heritage;
- strong integration with enterprise service concerns;
- interceptors/features;
- Spring/OSGi style deployment history;
- useful when REST and SOAP coexist.

## 7.2 Common use cases

- enterprises with CXF already for SOAP/JAX-WS;
- integration-heavy platforms;
- services needing CXF-specific features;
- apps that combine REST with other web service paradigms.

## 7.3 Caveats

- CXF-specific APIs/extensions reduce portability;
- docs/examples may span old JAX-RS versions;
- dependency and bus configuration require familiarity;
- if only simple REST API, CXF may be more framework than needed.

## 7.4 Mental model

```text
CXF is attractive when REST is part of a larger enterprise services integration stack.
```

---

# 8. Open Liberty Overview

Open Liberty is a lightweight, modular Jakarta EE/MicroProfile runtime.

It packages features such as Jakarta REST, CDI, MicroProfile OpenAPI, Metrics, JWT, etc., via server features.

## 8.1 Strengths

- standards-oriented runtime;
- feature-based server configuration;
- Jakarta EE/MicroProfile integration;
- good cloud/container story;
- supports Jakarta REST features via `restfulWS-*`;
- CDI integration documented;
- operational configuration centralized in `server.xml`.

## 8.2 Common use cases

- enterprise Jakarta EE apps;
- teams wanting standards and app-server-managed runtime;
- apps needing MicroProfile features;
- cloud-native Jakarta EE workloads.

## 8.3 Caveats

- behavior tied to enabled Liberty features;
- app server classloading/config needs understanding;
- exact Jakarta REST implementation under feature may be hidden from app developer;
- local/unit tests should still include Liberty integration tests.

## 8.4 Mental model

```text
Open Liberty is strong when you want standards-first Jakarta EE/MicroProfile runtime with modular server features.
```

---

# 9. Quarkus REST Overview

Quarkus REST is a Jakarta REST implementation designed for Quarkus build-time processing and Vert.x-based runtime.

## 9.1 Strengths

- build-time processing;
- low startup/memory goals;
- cloud-native developer workflow;
- tight CDI/Arc integration;
- reactive and imperative endpoint support;
- REST Client integration;
- native image support focus;
- strong test/dev mode.

## 9.2 Common use cases

- microservices;
- Kubernetes/cloud-native apps;
- fast startup;
- native image;
- teams using Quarkus ecosystem;
- reactive streaming/event-loop-aware workloads.

## 9.3 Caveats

- event-loop vs worker thread rules matter;
- migration from RESTEasy Classic may need code/config changes;
- not all traditional JAX-RS assumptions map 1:1;
- extensions/features can be Quarkus-specific;
- native image imposes reflection/resource constraints.

## 9.4 Mental model

```text
Quarkus REST is strong when build-time optimization, fast startup, cloud-native ergonomics, and reactive foundations matter.
```

---

# 10. Comparison Matrix

| Area | Jersey | RESTEasy | Apache CXF | Open Liberty | Quarkus REST |
|---|---|---|---|---|---|
| Type | JAX-RS implementation | Jakarta REST implementation | Services framework with JAX-RS | Jakarta EE/MicroProfile runtime | Quarkus Jakarta REST implementation |
| Best fit | Standalone/Servlet/Jersey apps | WildFly/JBoss/Red Hat ecosystem | Enterprise services/SOAP+REST | Standards-first runtime | Cloud-native/build-time optimized apps |
| Testing | JerseyTest | Runtime-specific/WildFly/Quarkus | CXF/embedded tests | Liberty integration tests | `@QuarkusTest` |
| CDI | Via integration/runtime | Strong in EE runtimes | Depends setup/runtime | Runtime feature integration | Arc/CDI integrated |
| Reactive model | Traditional JAX-RS | Classic + Quarkus variants | Traditional | Traditional/runtime-managed | Vert.x/build-time/reactive-aware |
| Portability risk | Jersey APIs | RESTEasy APIs | CXF APIs | Feature/runtime config | Quarkus APIs/runtime model |
| Native image | Not primary | Quarkus path | Not primary | Possible via ecosystem | First-class focus |

## 10.1 Rule

No implementation is universally best. Fit depends on platform constraints and operational goals.

---

# 11. Provider Discovery and Registration

Provider discovery differs by runtime and deployment model.

## 11.1 Portable registration

```java
@Provider
public class ProblemMapper implements ExceptionMapper<Throwable> { ... }
```

## 11.2 Application registration

```java
@ApplicationPath("/api")
public class RestApplication extends Application {
    @Override
    public Set<Class<?>> getClasses() {
        return Set.of(CustomerResource.class, ProblemMapper.class);
    }
}
```

## 11.3 Runtime-specific registration

Jersey:

```java
public class MyResourceConfig extends ResourceConfig {
    public MyResourceConfig() {
        register(CustomerResource.class);
        register(ProblemMapper.class);
    }
}
```

## 11.4 Operational issue

Provider not discovered is common.

Test:

- mapper selected;
- filter active;
- reader/writer active;
- OpenAPI includes endpoints.

## 11.5 Rule

Use explicit registration for critical providers or test discovery thoroughly.

---

# 12. Application Class and Scanning

## 12.1 No Application subclass

Some runtimes discover automatically.

## 12.2 With `@ApplicationPath`

Defines base URI path.

## 12.3 Overriding `getClasses()`

Can limit discovery to explicit set.

## 12.4 Overriding `getSingletons()`

Avoid for new code; it creates lifecycle/CDI complexity and is deprecated in Jakarta REST 4 API.

## 12.5 Rule

Be deliberate about scanning vs explicit registration.

---

# 13. CDI Integration Differences

CDI integration affects:

- constructor injection;
- provider injection;
- resource scope;
- interceptors;
- request context;
- proxy behavior;
- testing.

## 13.1 Jakarta EE runtimes

Often integrate JAX-RS and CDI by default/feature.

## 13.2 Standalone Jersey/CXF

May need explicit CDI integration modules/config.

## 13.3 Quarkus

CDI via Arc and build-time discovery.

## 13.4 Rule

Do not assume `@Inject` works in a resource until target runtime integration test proves it.

---

# 14. Resource Lifecycle Differences

Spec says default resource class lifecycle is per-request in standard model.

But CDI scopes can override contextual behavior.

## 14.1 Per-request resource

Safe for request fields, though method locals still better.

## 14.2 Application-scoped resource

Shared across requests; must be thread-safe.

## 14.3 Proxy resource

CDI proxy may represent contextual instance.

## 14.4 Rule

Declare scope explicitly and avoid mutable request state.

---

# 15. Provider Lifecycle and Thread Safety

Providers are usually singleton-like or application-scoped.

## 15.1 Thread safety

Providers must not hold per-request mutable state.

Bad:

```java
private CurrentActor currentActor;
```

Good:

```java
public void filter(ContainerRequestContext ctx) {
    CurrentActor actor = resolve(ctx);
    ctx.setProperty("actor", actor);
}
```

## 15.2 Dependency injection

Injected services must be thread-safe or contextual proxies.

## 15.3 Rule

Design all providers as shared objects unless proven otherwise.

---

# 16. JSON Provider Strategy

Runtime may default to:

- JSON-B;
- Jackson;
- JSON-P;
- vendor/default provider.

## 16.1 Risks

Different provider means different behavior for:

- unknown fields;
- null serialization;
- date/time;
- enum casing;
- records;
- BigDecimal;
- polymorphism;
- generics.

## 16.2 Production strategy

Explicitly choose and configure JSON provider.

## 16.3 Tests

Integration tests should assert JSON shape.

## 16.4 Rule

Never rely blindly on default JSON provider semantics.

---

# 17. JSON-B vs Jackson Defaults

## 17.1 JSON-B

Jakarta standard JSON binding.

Good for standards-oriented apps.

## 17.2 Jackson

Very common ecosystem; rich features.

Often used in Quarkus/Jersey/RESTEasy via modules.

## 17.3 Decision

Pick based on:

- ecosystem;
- existing DTO annotations;
- custom serializers;
- security policy;
- OpenAPI/codegen alignment.

## 17.4 Rule

Provider choice is API contract decision.

---

# 18. Exception Mapper Differences

Exception mapper selection should follow spec specificity, but default errors may differ.

## 18.1 Differences

- default 404/405/406/415 body;
- validation exception mapping;
- JSON parse error mapping;
- framework-specific exception classes;
- wrapped exceptions.

## 18.2 Strategy

Create explicit mappers for your public error contract.

## 18.3 Tests

Test actual runtime errors:

- malformed JSON;
- validation failure;
- unsupported media type;
- conversion failure.

## 18.4 Rule

Do not expose runtime default error bodies in public APIs.

---

# 19. Filters and Interceptors

Portable filters/interceptors work across implementations.

## 19.1 Differences

Can appear in:

- ordering around vendor filters;
- pre-matching behavior;
- stream buffering;
- response commit timing;
- exception propagation.

## 19.2 Tests

Integration test:

- correlation filter;
- auth filter;
- security headers;
- gzip/hash interceptors;
- body read/write behavior.

## 19.3 Rule

Cross-cutting HTTP behavior must be integration-tested per runtime.

---

# 20. Name Binding and DynamicFeature

Name binding and DynamicFeature are portable but runtime scanning differs.

## 20.1 Risk

DynamicFeature not registered/discovered.

## 20.2 Test

Endpoint with annotation has filter; endpoint without annotation does not.

## 20.3 Rule

Feature binding tests are essential when provider selection matters.

---

# 21. Multipart Support

Jakarta REST 3.1+ standardized `EntityPart`, but runtime support and behavior can vary.

## 21.1 Differences

- memory vs temp file threshold;
- max request/part size;
- file name parsing;
- content stream lifecycle;
- multipart client support;
- old vendor-specific multipart APIs.

## 21.2 Strategy

Use `EntityPart` for new portable code where supported.

Use vendor-specific APIs only if needed and isolated.

## 21.3 Rule

Multipart must be tested with large files and malicious metadata on target runtime.

---

# 22. SSE Support

SSE APIs are standard, but operational behavior differs.

## 22.1 Differences

- thread usage;
- broadcaster behavior;
- disconnect detection;
- buffering;
- heartbeat/proxy handling;
- client reconnect behavior.

## 22.2 Runtime considerations

SSE in traditional Servlet runtime may occupy different resources than reactive runtime.

## 22.3 Rule

SSE must be tested through deployment path including proxy/gateway.

---

# 23. Async and Reactive Behavior

## 23.1 Traditional async

`AsyncResponse`, `CompletionStage`, callbacks.

## 23.2 Reactive runtime

Quarkus REST uses Vert.x and build-time/reactive-aware model.

## 23.3 Blocking vs non-blocking

Event-loop runtime punishes blocking IO on event-loop.

Traditional worker-thread runtime may tolerate blocking but consumes threads.

## 23.4 Rule

Understand execution model before doing DB/file/network work in resource methods.

---

# 24. Streaming and Large File Handling

`StreamingOutput` is portable.

But runtime behavior differs:

- buffer size;
- commit timing;
- chunked transfer;
- compression interaction;
- client disconnect exception;
- sendfile/zero-copy support;
- gateway buffering.

## 24.1 Strategy

For large file downloads:

- set headers explicitly;
- test memory;
- test disconnect;
- test range if supported;
- test through proxy.

## 24.2 Rule

Streaming is not fully proven until tested on actual container + proxy.

---

# 25. Client API Implementation Differences

JAX-RS Client API is standard, but underlying connector varies.

## 25.1 Differences

- connection pooling;
- proxy config;
- TLS config;
- redirect behavior;
- cookie management;
- async executor;
- HTTP/2 support;
- compression;
- streaming upload/download;
- default timeouts.

## 25.2 Rule

Use standard API for common behavior, but connector tuning is implementation-specific.

---

# 26. Client Connector and Connection Pool

## 26.1 Jersey

Can use different connectors depending modules/config.

## 26.2 RESTEasy

Client engine/config depends version/runtime.

## 26.3 CXF

Uses CXF client infrastructure and HTTP conduits.

## 26.4 Liberty/Quarkus

Runtime-managed/config-driven client behavior may apply.

## 26.5 Rule

Document and test connection pool settings; do not assume defaults are production-ready.

---

# 27. Timeout and Proxy Configuration

Standard API has:

```java
ClientBuilder.newBuilder()
    .connectTimeout(...)
    .readTimeout(...);
```

But per-request timeout, pool acquisition timeout, proxy, socket options are often implementation-specific.

## 27.1 Strategy

Centralize client construction.

Use config object:

```text
baseUrl
connectTimeout
readTimeout
maxConnections
proxy
tls
```

## 27.2 Rule

Do not scatter vendor properties across business code.

---

# 28. TLS/mTLS Configuration

Portable `ClientBuilder` supports SSL context/trust/key store APIs.

But runtime/platform may have centralized TLS config.

## 28.1 Liberty

Often configured through server features/config.

## 28.2 Quarkus

Uses Quarkus config/extensions.

## 28.3 Standalone client

May use `SSLContext`, truststore, keystore.

## 28.4 Rule

TLS policy should be platform-owned and tested.

---

# 29. OpenAPI and MicroProfile Integration

Runtimes differ in MicroProfile OpenAPI support.

## 29.1 Open Liberty/Quarkus

Strong MicroProfile OpenAPI story.

## 29.2 Jersey standalone

Can integrate with OpenAPI tools, but not automatically same as MP runtime.

## 29.3 Rule

Treat OpenAPI output as runtime artifact; validate actual generated spec.

---

# 30. Metrics, Tracing, and Observability

Observability integration differs.

## 30.1 Jakarta EE/MicroProfile runtimes

May provide MicroProfile Metrics/OpenTelemetry integrations.

## 30.2 Standalone Jersey/CXF

Need explicit filters/interceptors/instrumentation.

## 30.3 Quarkus

Strong extension-based instrumentation.

## 30.4 Rule

Define observability behavior independent of runtime defaults, then implement per platform.

---

# 31. Testing Tools per Runtime

## 31.1 Jersey

- Jersey Test Framework;
- JUnit;
- REST Assured;
- Testcontainers.

## 31.2 RESTEasy/WildFly

- Arquillian historically;
- REST Assured against embedded/real server;
- runtime-specific tests.

## 31.3 CXF

- CXF embedded server tests;
- Spring/CXF test setup where applicable.

## 31.4 Open Liberty

- Liberty Maven/Gradle plugin;
- integration tests against Liberty server;
- Testcontainers possible.

## 31.5 Quarkus

- `@QuarkusTest`;
- REST Assured;
- Dev Services/Testcontainers.

## 31.6 Rule

Use runtime-native testing for final confidence; use black-box HTTP tests for contract.

---

# 32. Packaging: WAR, Fat JAR, Native Image, Cloud Runtime

## 32.1 WAR

Common for Jakarta EE app servers.

Pros:

- platform-managed features;
- standard deployment.

Cons:

- app server lifecycle/classloading.

## 32.2 Fat/executable JAR

Common for microservices.

Pros:

- self-contained;
- container-friendly.

Cons:

- own runtime responsibility.

## 32.3 Native image

Pros:

- fast startup;
- low memory.

Cons:

- reflection/resource/proxy constraints;
- build complexity;
- runtime differences.

## 32.4 Rule

Packaging affects framework behavior, deployment, tests, and observability.

---

# 33. Servlet Container vs Jakarta EE Runtime vs Build-Time Runtime

## 33.1 Servlet container + Jersey/CXF

You assemble dependencies.

More control, more responsibility.

## 33.2 Jakarta EE runtime

Runtime provides Jakarta REST/CDI/etc.

Less dependency burden, more platform config.

## 33.3 Build-time runtime

Quarkus processes many things at build time.

Fast runtime, but build-time constraints.

## 33.4 Rule

Choose runtime model intentionally.

---

# 34. Performance Knobs

Performance knobs vary.

## 34.1 Server-side

- worker threads;
- event loops;
- request body buffer;
- response buffer;
- compression;
- JSON provider;
- connection keep-alive;
- max request size;
- multipart temp threshold;
- SSE heartbeat;
- async executor.

## 34.2 Client-side

- connection pool;
- connect/read timeout;
- executor;
- proxy;
- compression;
- DNS/cache;
- TLS session reuse.

## 34.3 Rule

Performance tuning is runtime-specific and must be measured.

---

# 35. Memory and Startup Time

## 35.1 Traditional runtimes

May have higher startup but mature runtime features.

## 35.2 Build-time optimized runtimes

Can reduce startup and memory.

## 35.3 JSON/reflection

Serialization libraries can affect footprint.

## 35.4 Rule

Measure startup, RSS, heap, latency, and throughput in your target deployment.

---

# 36. Native Image Caveats

Native image can affect:

- reflection;
- dynamic provider discovery;
- JSON serialization;
- CDI proxies;
- resource loading;
- ServiceLoader;
- JAX-RS client providers;
- TLS certificates.

## 36.1 Quarkus advantage

Quarkus extensions handle much native-image metadata.

## 36.2 Rule

Native image requires native-specific test suite.

---

# 37. Migration: Jersey ↔ RESTEasy ↔ CXF ↔ Liberty ↔ Quarkus

Migration checklist:

## 37.1 Compile portability

- remove implementation-specific imports;
- switch to `jakarta.ws.rs.*`;
- align dependencies;
- avoid deprecated APIs.

## 37.2 Runtime behavior

Test:

- request matching;
- provider discovery;
- JSON shape;
- errors;
- validation;
- CDI;
- multipart;
- SSE;
- async;
- streaming;
- client timeouts;
- OpenAPI output.

## 37.3 Operational behavior

Test:

- startup;
- memory;
- logging;
- metrics;
- tracing;
- health checks;
- config;
- deployment.

## 37.4 Rule

Migration is not done when code compiles; it is done when contract and operations match.

---

# 38. Migration from javax.ws.rs to jakarta.ws.rs

## 38.1 Namespace

Old:

```java
javax.ws.rs.Path
```

New:

```java
jakarta.ws.rs.Path
```

## 38.2 Dependency alignment

All Jakarta EE libraries must align.

Mixing `javax.*` and `jakarta.*` dependencies can cause runtime issues.

## 38.3 Provider ecosystem

JSON, validation, servlet, CDI, persistence dependencies must match Jakarta namespace.

## 38.4 Rule

Namespace migration is ecosystem migration, not just search/replace.

---

# 39. Portable Code Guidelines

## 39.1 Use spec APIs

Default to `jakarta.ws.rs.*`.

## 39.2 Isolate vendor APIs

Package:

```text
infrastructure.jersey
infrastructure.resteasy
infrastructure.cxf
infrastructure.quarkus
```

## 39.3 Write integration tests

For provider behavior and JSON contract.

## 39.4 Avoid hidden defaults

Explicitly configure:

- JSON provider;
- error mappers;
- filters;
- timeouts;
- media types;
- scopes.

## 39.5 Rule

Portability comes from disciplined boundaries and tests.

---

# 40. When to Use Implementation-Specific APIs

Use extension APIs when they provide significant value:

- performance tuning;
- multipart streaming controls;
- connector pool config;
- reactive model;
- OpenAPI integration;
- runtime-native auth/security;
- testing support;
- native image integration.

## 40.1 Conditions

Before adopting:

```text
Is value worth lock-in?
Is API isolated?
Is migration path documented?
Is test coverage runtime-specific?
```

## 40.2 Rule

Vendor APIs are acceptable infrastructure dependencies, not domain dependencies.

---

# 41. Runtime Selection Playbook

## 41.1 If you want pure JAX-RS on Servlet with lots of docs/testing

Consider Jersey.

## 41.2 If you are on WildFly/JBoss/Red Hat stack

RESTEasy is natural.

## 41.3 If you have SOAP/JAX-WS and integration-heavy CXF ecosystem

CXF may fit.

## 41.4 If you want standards-first Jakarta EE/MicroProfile server

Open Liberty fits.

## 41.5 If you want Quarkus/cloud-native/native/build-time optimization

Quarkus REST fits.

## 41.6 Rule

Select by platform strategy, not popularity.

---

# 42. Architecture Patterns

## 42.1 Portable core

```text
api resources
application services
domain
repositories
```

Use Jakarta APIs.

## 42.2 Runtime adapter layer

```text
runtime config
provider registration
client connector
OpenAPI integration
metrics/tracing
```

May use implementation-specific APIs.

## 42.3 Test layer

Runtime-specific tests live separately.

## 42.4 Rule

Keep runtime-specific code outside business logic.

---

# 43. Operational Checklist

Before production:

- verify exact Jakarta REST version;
- list implementation/runtime version;
- list JSON provider;
- list CDI behavior;
- list client connector;
- configure timeouts;
- configure max request size;
- configure multipart limits;
- configure error mappers;
- configure observability;
- run integration tests on target runtime.

## 43.1 Rule

Document your runtime stack explicitly in README/Architecture Decision Record.

---

# 44. Common Failure Modes

## 44.1 Works in JerseyTest, fails in Liberty

Different runtime/CDI/provider behavior.

## 44.2 JSON shape changes after runtime migration

Different provider defaults.

## 44.3 Exception mapper not selected

Registration/discovery issue.

## 44.4 Multipart loads whole file into memory

Runtime config issue.

## 44.5 Async blocks event loop

Reactive runtime misuse.

## 44.6 Client timeout not applied

Wrong property/connector config.

## 44.7 Native image misses reflection metadata

Serialization/provider failure.

## 44.8 OpenAPI generated differently per runtime

Docs drift.

## 44.9 CDI injection works for resources but not providers

Integration/scanning issue.

## 44.10 Deprecated/implementation-specific API locks migration

Unplanned lock-in.

---

# 45. Best Practices

## 45.1 Start portable

Use spec APIs first.

## 45.2 Explicitly choose JSON provider

And test contract.

## 45.3 Register critical providers explicitly

Or test discovery.

## 45.4 Make scopes explicit

Resource/provider lifecycle.

## 45.5 Test on target runtime

Not only mocks/in-memory.

## 45.6 Isolate implementation-specific code

Infrastructure layer.

## 45.7 Measure performance

Do not trust defaults.

## 45.8 Document runtime decision

Use ADR.

## 45.9 Keep migration tests

Contract tests across runtime.

## 45.10 Verify observability

Metrics/tracing/logging.

---

# 46. Anti-Patterns

## 46.1 “It is JAX-RS, runtime does not matter”

False.

## 46.2 Vendor API in domain/service layer

Hard lock-in.

## 46.3 Relying on default JSON provider

Contract drift.

## 46.4 No runtime integration test

Migration surprises.

## 46.5 Using `getSingletons()` with mutable providers

Thread-safety/injection bugs.

## 46.6 Blocking event loop in reactive runtime

Latency collapse.

## 46.7 Setting timeout via random vendor property in resource method

Unmaintainable.

## 46.8 Treating native image as same as JVM

Missing reflection/resources.

## 46.9 Using Jersey docs to configure RESTEasy/CXF/Liberty

Wrong assumptions.

## 46.10 Ignoring gateway/proxy behavior

Streaming/SSE/CORS fail in production.

---

# 47. Production Checklist

## 47.1 Runtime identity

- [ ] Jakarta REST spec version known.
- [ ] Implementation/runtime known.
- [ ] Java version known.
- [ ] Deployment model known.
- [ ] JSON provider chosen.
- [ ] CDI integration verified.
- [ ] Client connector known.
- [ ] OpenAPI provider known.

## 47.2 Portability

- [ ] No vendor imports in domain/application layer.
- [ ] Vendor APIs isolated.
- [ ] Provider registration tested.
- [ ] Resource matching tested.
- [ ] Error contract tested.
- [ ] JSON contract tested.
- [ ] Multipart/SSE/streaming tested if used.

## 47.3 Operations

- [ ] Server thread/worker model understood.
- [ ] Blocking rules documented.
- [ ] Client pool configured.
- [ ] Timeouts configured.
- [ ] Request size limits configured.
- [ ] Multipart limits configured.
- [ ] Observability configured.
- [ ] Performance smoke test run.
- [ ] Target-runtime integration test in CI.

## 47.4 Migration readiness

- [ ] `javax`/`jakarta` dependencies aligned.
- [ ] Implementation-specific features listed.
- [ ] Contract tests available.
- [ ] Runtime config documented.
- [ ] Rollback plan.
- [ ] Compatibility matrix.

---

# 48. Latihan

## Latihan 1 — Runtime Inventory

Untuk project kamu, buat dokumen:

```text
Jakarta REST version
implementation/runtime
JSON provider
CDI provider
client connector
OpenAPI provider
deployment model
```

## Latihan 2 — Provider Discovery Test

Buat custom `ExceptionMapper`.

Pastikan runtime memakai mapper itu untuk exception tertentu.

## Latihan 3 — JSON Provider Contract

Test DTO berisi:

- date-time;
- enum;
- null;
- BigDecimal;
- unknown field.

Jalankan di target runtime.

## Latihan 4 — Multipart Runtime Test

Upload file besar.

Pastikan tidak masuk heap penuh.

Cek temp file/limit behavior.

## Latihan 5 — SSE Through Proxy

Jalankan SSE endpoint melalui reverse proxy.

Test heartbeat, reconnect, disconnect.

## Latihan 6 — Client Timeout Portability

Buat JAX-RS Client di runtime kamu.

Test connect/read timeout benar-benar berlaku.

## Latihan 7 — Migration Spike

Ambil satu endpoint.

Jalankan di dua runtime berbeda.

Bandingkan:

- status;
- headers;
- JSON;
- errors;
- OpenAPI;
- logs.

## Latihan 8 — Vendor API Isolation

Cari semua import:

```text
org.glassfish.jersey
org.jboss.resteasy
org.apache.cxf
io.quarkus
```

Kategorikan:

```text
acceptable infrastructure
should refactor
```

## Latihan 9 — Runtime ADR

Tulis Architecture Decision Record:

```text
Why this implementation/runtime?
What alternatives considered?
What lock-in accepted?
How to migrate?
What tests prove portability?
```

---

# 49. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0  
   https://jakarta.ee/specifications/restful-ws/4.0/

2. Eclipse Jersey  
   https://jersey.github.io/

3. Eclipse Jersey Project  
   https://projects.eclipse.org/projects/ee4j.jersey

4. RESTEasy Documentation  
   https://docs.resteasy.dev/

5. Apache CXF JAX-RS  
   https://cxf.apache.org/docs/jax-rs.html

6. Open Liberty Jakarta RESTful Web Services Feature  
   https://openliberty.io/docs/latest/reference/feature/restfulWS-3.1.html

7. Open Liberty RESTful Web Services Integration with CDI  
   https://openliberty.io/docs/latest/jaxrs-integration-cdi.html

8. IBM/Open Liberty Jakarta RESTful Web Services 4.0 Feature  
   https://www.ibm.com/docs/en/was-liberty/nd?topic=features-jakarta-restful-web-services-40

9. Quarkus REST Guide  
   https://quarkus.io/guides/rest

10. Quarkus REST Migration Guide  
    https://quarkus.io/guides/rest-migration

---

# 50. Penutup

Implementation deep dive bukan untuk membuat kita fanatik pada satu framework.

Tujuannya adalah membuat kita paham:

```text
apa yang portable
apa yang runtime-specific
apa yang harus diuji
apa yang harus diisolasi
apa konsekuensi migration
```

Mental model final:

```text
Jakarta REST specification:
  standard API and behavior contract

Implementation:
  provider discovery, runtime mechanics, extensions

Platform:
  CDI/security/config/testing/deployment/observability
```

Prinsip final:

```text
Portable by default.
Runtime-aware in production.
Vendor-specific only with intention.
Integration-test on target runtime.
```

Top-tier JAX-RS engineer memastikan:

- tidak menyamakan spec dengan runtime behavior;
- JSON provider dipilih, bukan kebetulan;
- provider/CDI/lifecycle behavior diuji;
- multipart/SSE/streaming/async diuji di runtime sebenarnya;
- client connector dan timeout dikonfigurasi;
- implementation-specific APIs diisolasi;
- runtime selection punya ADR;
- migration punya contract tests dan checklist.

Part berikutnya:

```text
Bagian 038 — Migration: javax.ws.rs to jakarta.ws.rs
```

Kita akan membahas migrasi namespace dan ekosistem secara mendalam: dependency alignment, Servlet/CDI/Validation/Persistence namespace, JSON provider, app server versions, test strategy, OpenRewrite, build tooling, and migration failure modes.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-jaxrs-advanced-part-036.md">⬅️ Bagian 036 — Testing JAX-RS Client: Mock Server, Request Verification, Timeout/Retry/Circuit Tests, Problem Details Decoder, Streaming Download, Upload, SSE Client, Contract Tests, and Resilience Fault Injection</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-jaxrs-advanced-part-038.md">Bagian 038 — Migration: `javax.ws.rs` to `jakarta.ws.rs`: Namespace Shift, Dependency Alignment, Runtime Upgrade, OpenRewrite, Eclipse Transformer, CDI/Servlet/Validation/Persistence Ecosystem, Testing Strategy, and Migration Failure Modes ➡️</a>
</div>
