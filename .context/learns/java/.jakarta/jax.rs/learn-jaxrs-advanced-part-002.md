# learn-jaxrs-advanced-part-002.md

# Bagian 002 — Anatomy of JAX-RS Application: `Application`, Base Path, Deployment, Runtime

> Target pembaca: Java/Jakarta engineer yang ingin memahami **bagaimana aplikasi JAX-RS/Jakarta REST benar-benar dibootstrap dan ditemukan oleh runtime**. Fokus part ini bukan membuat endpoint, tetapi memahami application boundary: `Application`, `@ApplicationPath`, base URI, deployment context, classpath scanning, resource/provider registration, Servlet integration, WAR deployment, Java SE bootstrap, dan perbedaan implementation/runtime.
>
> Namespace utama: `jakarta.ws.rs.*` untuk Jakarta REST modern; mapping legacy `javax.ws.rs.*` tetap dibahas untuk migrasi.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: JAX-RS Application sebagai Runtime Boundary](#2-mental-model-jax-rs-application-sebagai-runtime-boundary)
3. [`Application`: Root Configuration Object](#3-application-root-configuration-object)
4. [`@ApplicationPath`: Base URI untuk Resource URIs](#4-applicationpath-base-uri-untuk-resource-uris)
5. [URI Composition: Deployment Context + Application Path + Resource Path](#5-uri-composition-deployment-context--application-path--resource-path)
6. [Minimal Application Class](#6-minimal-application-class)
7. [Tanpa `Application` Class: Kapan Bisa, Kapan Tidak](#7-tanpa-application-class-kapan-bisa-kapan-tidak)
8. [Resource Discovery: Scanning vs Explicit Registration](#8-resource-discovery-scanning-vs-explicit-registration)
9. [`getClasses()` vs `getSingletons()`](#9-getclasses-vs-getsingletons)
10. [Programmatic Registration: Resource, Provider, Feature](#10-programmatic-registration-resource-provider-feature)
11. [Provider Discovery dan `@Provider`](#11-provider-discovery-dan-provider)
12. [Application Subclass sebagai Composition Root](#12-application-subclass-sebagai-composition-root)
13. [Multiple JAX-RS Applications dalam Satu WAR](#13-multiple-jax-rs-applications-dalam-satu-war)
14. [WAR Deployment Model](#14-war-deployment-model)
15. [Servlet Integration dan `web.xml`](#15-servlet-integration-dan-webxml)
16. [Servlet Mapping vs `@ApplicationPath`](#16-servlet-mapping-vs-applicationpath)
17. [Classloading dan Dependency Boundary](#17-classloading-dan-dependency-boundary)
18. [Jakarta EE Runtime vs Standalone Runtime](#18-jakarta-ee-runtime-vs-standalone-runtime)
19. [Java SE Bootstrap dan Embedded Server](#19-java-se-bootstrap-dan-embedded-server)
20. [CDI Integration dalam Bootstrap](#20-cdi-integration-dalam-bootstrap)
21. [Resource Lifecycle: Per-Request, Singleton, CDI Scope](#21-resource-lifecycle-per-request-singleton-cdi-scope)
22. [Application Properties dan Runtime Configuration](#22-application-properties-dan-runtime-configuration)
23. [Implementation Differences: Jersey, RESTEasy, CXF, Open Liberty, Payara, Quarkus](#23-implementation-differences-jersey-resteasy-cxf-open-liberty-payara-quarkus)
24. [Jakarta REST 4.0 Context: JAXB Removed, ManagedBean Removed](#24-jakarta-rest-40-context-jaxb-removed-managedbean-removed)
25. [Base Path Versioning Strategy](#25-base-path-versioning-strategy)
26. [Deployment Context Pitfalls di Reverse Proxy / API Gateway](#26-deployment-context-pitfalls-di-reverse-proxy--api-gateway)
27. [Testing Application Bootstrap](#27-testing-application-bootstrap)
28. [Observability untuk Application Bootstrap](#28-observability-untuk-application-bootstrap)
29. [Failure Modes](#29-failure-modes)
30. [Best Practices](#30-best-practices)
31. [Anti-Patterns](#31-anti-patterns)
32. [Production Checklist](#32-production-checklist)
33. [Latihan](#33-latihan)
34. [Referensi Resmi](#34-referensi-resmi)
35. [Penutup](#35-penutup)

---

# 1. Tujuan Part Ini

Di part sebelumnya, kita membahas HTTP semantics.

Sekarang kita masuk ke pertanyaan:

```text
Bagaimana runtime tahu bahwa class Java kita adalah aplikasi JAX-RS?
Bagaimana URL /api/customers bisa sampai ke method getCustomer()?
Bagaimana resource dan provider ditemukan?
Apa bedanya Application class, ApplicationPath, Servlet mapping, dan deployment context?
```

Banyak bug JAX-RS terjadi bukan karena `@GET` salah, tetapi karena:

- base path salah;
- app deployed di context root berbeda;
- `@ApplicationPath` tidak sesuai;
- resource tidak ditemukan oleh scanning;
- provider tidak terdaftar;
- dependency API/implementation bentrok;
- aplikasi punya multiple `Application` subclass;
- runtime behavior berbeda;
- CDI injection tidak aktif karena cara registration salah;
- reverse proxy mengubah path tanpa `Forwarded`/`X-Forwarded-*` handling yang benar.

## 1.1 Fokus mental model

Kita akan memahami JAX-RS application sebagai:

```text
runtime boundary
```

yang mengikat:

- deployment unit;
- base URI;
- resource classes;
- provider classes;
- features;
- runtime configuration;
- CDI/Servlet integration.

## 1.2 Hasil yang diharapkan

Setelah part ini, kamu bisa:

- menjelaskan fungsi `Application`;
- menjelaskan fungsi `@ApplicationPath`;
- menghitung full endpoint path;
- memilih scanning vs explicit registration;
- memahami `getClasses()` dan `getSingletons()`;
- memahami relationship dengan Servlet;
- mendebug endpoint tidak ditemukan;
- mendesain multi-application WAR dengan sadar;
- menulis bootstrap test untuk memastikan JAX-RS app benar.

---

# 2. Mental Model: JAX-RS Application sebagai Runtime Boundary

JAX-RS application adalah boundary antara deployment/runtime dan resource model.

```text
Deployment unit
  ↓
JAX-RS Application
  ↓
Resource classes
  ↓
Resource methods
  ↓
Providers / filters / interceptors / mappers
```

## 2.1 `Application` bukan business application

Nama `Application` bisa menipu.

`jakarta.ws.rs.core.Application` bukan “aplikasi bisnis”.

Ia adalah configuration object untuk JAX-RS runtime.

## 2.2 Apa yang dikonfigurasi?

`Application` bisa mengontrol:

- resource classes yang aktif;
- provider classes yang aktif;
- singleton instances;
- application properties;
- application base path via `@ApplicationPath`;
- explicit registration strategy.

## 2.3 Application boundary

Dalam satu WAR, kamu bisa punya:

```text
/api
/admin-api
/internal-api
```

masing-masing dengan `Application` sendiri.

Tapi ini harus didesain hati-hati.

## 2.4 Application sebagai root of URI space

`@ApplicationPath("/api")` membuat semua resource path relatif terhadap `/api`.

## 2.5 Application sebagai root of provider scope

Provider registration bisa scoped ke application tersebut.

Provider di app A tidak harus berlaku ke app B, tergantung runtime/deployment setup.

## 2.6 Top-tier mindset

```text
Do not treat Application as boilerplate.
Treat it as the REST boundary composition root.
```

---

# 3. `Application`: Root Configuration Object

Class:

```java
jakarta.ws.rs.core.Application
```

Legacy:

```java
javax.ws.rs.core.Application
```

## 3.1 Basic role

`Application` defines components of a JAX-RS application.

Common subclass:

```java
@ApplicationPath("/api")
public class ApiApplication extends Application {
}
```

## 3.2 Default behavior

Default `Application` implementation returns empty sets.

In many runtimes, empty sets mean runtime may scan for resource/provider classes in deployment.

But exact scanning behavior depends on environment and registration strategy.

## 3.3 Explicit classes

```java
@ApplicationPath("/api")
public class ApiApplication extends Application {

    @Override
    public Set<Class<?>> getClasses() {
        return Set.of(
            CustomerResource.class,
            OrderResource.class,
            JsonExceptionMapper.class,
            CorrelationFilter.class
        );
    }
}
```

## 3.4 Singleton instances

```java
@Override
public Set<Object> getSingletons() {
    return Set.of(new HealthResource());
}
```

Be careful: manually-created instances may not be CDI-managed.

## 3.5 Properties

```java
@Override
public Map<String, Object> getProperties() {
    return Map.of("some.runtime.property", "value");
}
```

Properties are often implementation-specific.

## 3.6 Application is not a DI container

Do not put complex service construction inside `Application` unless standalone runtime demands it.

In Jakarta EE, prefer CDI.

## 3.7 When subclass is enough

Most Jakarta EE apps only need:

```java
@ApplicationPath("/api")
public class ApiApplication extends Application {}
```

Then let runtime discover resources/providers.

## 3.8 When customize

Customize when you need:

- explicit registration;
- avoid broad scanning;
- multiple applications;
- runtime-specific properties;
- controlled test app;
- constrained provider set;
- non-CDI Java SE bootstrap.

---

# 4. `@ApplicationPath`: Base URI untuk Resource URIs

Annotation:

```java
jakarta.ws.rs.ApplicationPath
```

Legacy:

```java
javax.ws.rs.ApplicationPath
```

It can only be applied to subclass of `Application`.

## 4.1 Role

`@ApplicationPath` identifies application path serving as base URI for all resource URIs provided by `@Path`.

Example:

```java
@ApplicationPath("/api")
public class ApiApplication extends Application {}
```

Resource:

```java
@Path("/customers")
public class CustomerResource { ... }
```

Effective path:

```text
/api/customers
```

## 4.2 Leading slash

Application path may be written with or without leading slash depending docs/runtime.

Prefer consistent:

```java
@ApplicationPath("/api")
```

## 4.3 Avoid root unless intentional

```java
@ApplicationPath("/")
```

can make all app paths JAX-RS-handled and may conflict with static resources, servlet pages, health endpoints, etc.

## 4.4 Version in application path?

You can do:

```java
@ApplicationPath("/api/v1")
```

But versioning strategy should be intentional.

Alternative:

```text
/api
```

with media type/header versioning.

## 4.5 Multiple app paths

```java
@ApplicationPath("/public")
public class PublicApi extends Application {}

@ApplicationPath("/internal")
public class InternalApi extends Application {}
```

Potentially useful, but increases complexity.

## 4.6 Production rule

Application path is external contract if exposed through gateway.

Changing it breaks clients unless gateway rewrites.

---

# 5. URI Composition: Deployment Context + Application Path + Resource Path

Effective URL is often:

```text
scheme://host:port/{context-root}/{application-path}/{resource-path}/{method-path}
```

## 5.1 Example

WAR name/context root:

```text
aceas-licensing
```

Application path:

```java
@ApplicationPath("/api")
```

Resource:

```java
@Path("/applications")
```

Method:

```java
@GET
@Path("/{id}")
```

Effective path:

```text
/aceas-licensing/api/applications/{id}
```

## 5.2 In Kubernetes/gateway

External URL may be:

```text
https://licensing.example.com/api/applications/{id}
```

because gateway strips context root.

## 5.3 Base URI confusion

Inside app:

```java
uriInfo.getBaseUri()
```

may include internal host/context, not public gateway host.

Need proxy headers handling.

## 5.4 Composition formula

```text
external path =
  gateway prefix
  + server context root
  + application path
  + resource class @Path
  + resource method @Path
```

Depending deployment, gateway may add/strip path.

## 5.5 `@Path` relative rule

`@Path` values are relative path templates.

Leading slash is generally ignored for absolutizing relative to base URI.

## 5.6 Practical example

```java
@ApplicationPath("api")
public class ApiApplication extends Application {}

@Path("customers")
public class CustomerResource {

    @GET
    @Path("{id}")
    public CustomerResponse get(@PathParam("id") String id) { ... }
}
```

Effective:

```text
/api/customers/{id}
```

## 5.7 Common bug

Developer calls:

```text
/customers/C001
```

but actual endpoint is:

```text
/app-context/api/customers/C001
```

---

# 6. Minimal Application Class

## 6.1 Jakarta modern

```java
package com.example.boundary.rest;

import jakarta.ws.rs.ApplicationPath;
import jakarta.ws.rs.core.Application;

@ApplicationPath("/api")
public class ApiApplication extends Application {
}
```

## 6.2 Legacy Javax

```java
package com.example.boundary.rest;

import javax.ws.rs.ApplicationPath;
import javax.ws.rs.core.Application;

@ApplicationPath("/api")
public class ApiApplication extends Application {
}
```

## 6.3 Minimal resource

```java
package com.example.boundary.rest.customer;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

@Path("/customers")
public class CustomerResource {

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public List<CustomerResponse> list() {
        return List.of();
    }
}
```

## 6.4 Deployment path

If WAR context root is `/myapp`:

```text
GET /myapp/api/customers
```

## 6.5 Why minimal works

Runtime discovers:

- `ApiApplication`;
- `CustomerResource`;
- JSON provider;
- resource method.

## 6.6 But minimal can hide runtime assumptions

It assumes:

- annotation scanning enabled;
- runtime has JSON provider;
- resource class visible in WAR;
- no conflicting `Application` subclass;
- correct context root.

---

# 7. Tanpa `Application` Class: Kapan Bisa, Kapan Tidak

Some runtimes support deployment without explicit `Application` subclass, using default servlet mapping/config.

But do not rely on that for portable Jakarta EE apps unless runtime docs say so.

## 7.1 Why explicit is better

An explicit `Application` class:

- documents API base path;
- makes bootstrap obvious;
- helps tests;
- avoids runtime magic;
- gives place for controlled registration.

## 7.2 When no Application may appear

Legacy apps may configure JAX-RS servlet in `web.xml`.

Example concept:

```xml
<servlet>
  <servlet-name>JAX-RS Servlet</servlet-name>
  <servlet-class>...</servlet-class>
</servlet>

<servlet-mapping>
  <servlet-name>JAX-RS Servlet</servlet-name>
  <url-pattern>/api/*</url-pattern>
</servlet-mapping>
```

Servlet class is implementation-specific.

## 7.3 Framework runtimes

Quarkus/Spring/Dropwizard-like frameworks may bootstrap JAX-RS differently.

## 7.4 Recommendation

For Jakarta EE:

```java
@ApplicationPath("/api")
public class ApiApplication extends Application {}
```

is clear and portable.

## 7.5 Anti-pattern

Relying on “it works in Jersey embedded” then failing in app server.

---

# 8. Resource Discovery: Scanning vs Explicit Registration

There are two broad strategies:

```text
automatic scanning
explicit registration
```

## 8.1 Automatic scanning

Runtime scans deployment for:

- `@Path` resource classes;
- `@Provider` providers;
- possibly features/extensions.

Example:

```java
@ApplicationPath("/api")
public class ApiApplication extends Application {}
```

This is simple.

## 8.2 Explicit registration

```java
@Override
public Set<Class<?>> getClasses() {
    return Set.of(
        CustomerResource.class,
        OrderResource.class,
        ProblemMapper.class
    );
}
```

This gives control.

## 8.3 Scanning pros

- less boilerplate;
- easy development;
- automatic provider discovery;
- typical Jakarta EE experience.

## 8.4 Scanning cons

- accidental provider/resource inclusion;
- startup cost;
- ambiguity in large apps;
- harder to reason about exact registry;
- runtime-specific scanning behavior.

## 8.5 Explicit pros

- deterministic;
- test-friendly;
- security by explicit surface;
- smaller provider set;
- easier for modular architecture.

## 8.6 Explicit cons

- must maintain list;
- missing class causes endpoint not registered;
- can bypass CDI if using instances incorrectly;
- more boilerplate.

## 8.7 Hybrid

Use scanning for resources, explicit for critical providers, or vice versa depending runtime.

## 8.8 Top-tier rule

```text
Small apps: scanning is fine.
Large/regulated apps: prefer explicit or at least audited registration.
```

---

# 9. `getClasses()` vs `getSingletons()`

`Application` has two important methods.

## 9.1 `getClasses()`

Returns resource/provider classes.

Runtime instantiates/manages them.

```java
@Override
public Set<Class<?>> getClasses() {
    return Set.of(CustomerResource.class, ProblemMapper.class);
}
```

## 9.2 `getSingletons()`

Returns singleton instances.

```java
@Override
public Set<Object> getSingletons() {
    return Set.of(new HealthResource());
}
```

## 9.3 Lifecycle difference

`getClasses()` lets runtime control lifecycle and injection.

`getSingletons()` gives runtime prebuilt instances.

## 9.4 CDI implication

If you instantiate object manually:

```java
new CustomerResource()
```

you may bypass CDI injection.

This can break:

```java
@Inject CustomerService service;
```

## 9.5 Thread safety

Singleton instances are shared.

They must be thread-safe.

## 9.6 Recommendation

In Jakarta EE/CDI environment:

```text
Prefer getClasses() over getSingletons().
Avoid manual new for CDI-dependent objects.
```

## 9.7 When use singleton

Use only for:

- stateless thread-safe providers;
- test doubles in controlled tests;
- standalone runtime without DI;
- deliberately preconfigured object.

## 9.8 Failure mode

Resource registered as singleton stores request state in fields.

Under concurrent requests, data leaks/corrupts.

---

# 10. Programmatic Registration: Resource, Provider, Feature

Programmatic registration means application defines components explicitly.

## 10.1 Basic

```java
@ApplicationPath("/api")
public class ApiApplication extends Application {

    @Override
    public Set<Class<?>> getClasses() {
        return Set.of(
            CustomerResource.class,
            OrderResource.class,
            CorrelationIdFilter.class,
            ProblemExceptionMapper.class,
            JsonMergePatchProvider.class
        );
    }
}
```

## 10.2 Why register providers explicitly?

- ensure custom mapper wins;
- avoid provider discovery surprises;
- control security filters;
- isolate admin/internal APIs;
- support tests.

## 10.3 Feature registration

Some implementations support `Feature` classes.

In JAX-RS:

```java
public class ObservabilityFeature implements Feature {
    @Override
    public boolean configure(FeatureContext context) {
        context.register(CorrelationIdFilter.class);
        context.register(MetricsFilter.class);
        return true;
    }
}
```

Then:

```java
return Set.of(ObservabilityFeature.class);
```

## 10.4 DynamicFeature

`DynamicFeature` registers filters/interceptors based on resource method/class.

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

## 10.5 Application-specific provider set

Different application:

```java
@ApplicationPath("/internal")
public class InternalApiApplication extends Application {
    @Override
    public Set<Class<?>> getClasses() {
        return Set.of(InternalResource.class, InternalAuthFilter.class);
    }
}
```

## 10.6 Avoid runtime-specific registration unless needed

Some implementations have richer registration APIs.

Use standard `Application` where portability matters.

---

# 11. Provider Discovery dan `@Provider`

Provider annotation:

```java
@Provider
```

Marks extension class discoverable by runtime.

## 11.1 Provider types

- `MessageBodyReader`;
- `MessageBodyWriter`;
- `ExceptionMapper`;
- `ContainerRequestFilter`;
- `ContainerResponseFilter`;
- `ReaderInterceptor`;
- `WriterInterceptor`;
- `ContextResolver`;
- `ParamConverterProvider`;
- `DynamicFeature`.

## 11.2 Example

```java
@Provider
public class ProblemExceptionMapper implements ExceptionMapper<Throwable> {
    @Override
    public Response toResponse(Throwable exception) {
        ...
    }
}
```

## 11.3 Discovery depends on scanning

If `Application#getClasses()` returns non-empty set, some runtimes may disable automatic scanning outside listed classes.

Therefore a `@Provider` class may not be registered unless included.

## 11.4 Explicit provider registration

```java
@Override
public Set<Class<?>> getClasses() {
    return Set.of(
        CustomerResource.class,
        ProblemExceptionMapper.class
    );
}
```

## 11.5 CDI provider lifecycle

If provider is CDI-managed, injection can work.

But manual instance registration may bypass CDI.

## 11.6 Provider ordering

Order may depend on:

- type specificity;
- media type;
- `@Priority`;
- name binding;
- registration order in implementation.

## 11.7 Top-tier rule

```text
Know exactly which providers are active in production.
```

---

# 12. Application Subclass sebagai Composition Root

In architecture, composition root is place where object graph/configuration starts.

`Application` can serve as REST composition root.

## 12.1 What belongs here

- REST base path;
- REST resources/providers list;
- REST features;
- runtime properties;
- application boundary documentation.

## 12.2 What does not belong here

- business initialization;
- database migration;
- manual service construction if CDI exists;
- environment-specific logic;
- hidden singleton state;
- complex runtime branching.

## 12.3 Example clean composition

```java
@ApplicationPath("/api")
public class ApiApplication extends Application {

    @Override
    public Set<Class<?>> getClasses() {
        return Set.of(
            CustomerResource.class,
            OrderResource.class,
            ProblemMapper.class,
            ValidationMapper.class,
            CorrelationIdFilter.class,
            SecurityHeadersFilter.class,
            ObservabilityFeature.class
        );
    }
}
```

## 12.4 Document provider purpose

A large app can have many providers.

Consider comments or registry classes:

```java
public final class RestComponents {
    public static Set<Class<?>> publicApiClasses() { ... }
}
```

## 12.5 Testing composition root

Test that expected classes are registered.

## 12.6 Governance

In regulated systems, REST surface registration should be reviewed.

---

# 13. Multiple JAX-RS Applications dalam Satu WAR

You can define multiple `Application` subclasses.

Example:

```java
@ApplicationPath("/public")
public class PublicApi extends Application { ... }
```

```java
@ApplicationPath("/internal")
public class InternalApi extends Application { ... }
```

## 13.1 Use cases

- public vs internal API;
- admin vs user API;
- versioned API;
- different provider/security stack;
- different OpenAPI docs;
- migration boundary.

## 13.2 Risks

- path conflicts;
- provider duplication;
- inconsistent error contract;
- security filter missing in one app;
- confusing deployment;
- scanning ambiguity;
- duplicated CDI/resource assumptions.

## 13.3 Alternative

Single `Application` with:

- path grouping;
- name-bound filters;
- security annotations;
- gateway routing.

## 13.4 When multiple makes sense

Use multiple when provider/security/runtime boundary truly differs.

Example:

```text
/public-api uses external auth and public error contract.
/internal-api uses mTLS and internal error details.
```

## 13.5 Production checklist

For each app:

- base path;
- resource list;
- provider list;
- auth filters;
- metrics labels;
- OpenAPI docs;
- tests.

## 13.6 Anti-pattern

Multiple applications just because packages differ.

---

# 14. WAR Deployment Model

Classic Jakarta REST app is deployed as WAR.

## 14.1 WAR structure

```text
myapp.war
  WEB-INF/
    web.xml
    classes/
      com/example/ApiApplication.class
      com/example/CustomerResource.class
    lib/
      app dependencies
  index.html
```

## 14.2 Context root

WAR deployed as:

```text
/myapp
```

or configured context root:

```text
/
```

## 14.3 Effective URL

```text
/{context-root}/{application-path}/{resource-path}
```

## 14.4 Jakarta EE server

Server provides:

- Servlet implementation;
- Jakarta REST implementation;
- CDI;
- JSON-B/JSON-P;
- Validation;
- Security;
- JPA if profile/platform supports.

## 14.5 Provided dependencies

For WAR on Jakarta EE runtime, Jakarta APIs usually `provided`.

## 14.6 Deployment descriptors

May include:

- `web.xml`;
- vendor descriptor;
- `beans.xml`;
- `persistence.xml`.

## 14.7 Cloud-native WAR

In Kubernetes, WAR can still be used inside immutable server image.

Example:

```text
base runtime image + app.war
```

## 14.8 Pitfall

WAR filename changes context root unexpectedly.

Use explicit context root config.

---

# 15. Servlet Integration dan `web.xml`

JAX-RS commonly integrates with Servlet.

## 15.1 Annotation-based

Preferred modern Jakarta EE:

```java
@ApplicationPath("/api")
public class ApiApplication extends Application {}
```

No `web.xml` needed for basic setup.

## 15.2 Descriptor-based

Legacy apps may define JAX-RS servlet mapping in `web.xml`.

Implementation-specific servlet class might be used.

Example concept:

```xml
<servlet>
  <servlet-name>JAXRS</servlet-name>
  <servlet-class>org.glassfish.jersey.servlet.ServletContainer</servlet-class>
</servlet>

<servlet-mapping>
  <servlet-name>JAXRS</servlet-name>
  <url-pattern>/api/*</url-pattern>
</servlet-mapping>
```

This is not portable across implementations.

## 15.3 Servlet filter vs JAX-RS filter

Servlet filter:

```text
before JAX-RS runtime
```

JAX-RS filter:

```text
inside JAX-RS runtime
```

## 15.4 Use Servlet filter for

- whole web app filtering;
- low-level request wrapping;
- static + REST traffic;
- before JAX-RS matching;
- some security integration.

## 15.5 Use JAX-RS filter for

- API-specific logic;
- resource-aware filters;
- name binding;
- response headers;
- API metrics;
- exception/error contract integration.

## 15.6 Servlet context path

Servlet context path affects base URI.

## 15.7 Production implication

When behind proxy, servlet container may see internal path/host.

Configure forwarded headers.

---

# 16. Servlet Mapping vs `@ApplicationPath`

There are two path concepts.

## 16.1 `@ApplicationPath`

Portable JAX-RS way:

```java
@ApplicationPath("/api")
```

## 16.2 Servlet mapping

Servlet container maps a servlet/filter to URL pattern.

Example:

```xml
<url-pattern>/api/*</url-pattern>
```

## 16.3 If both used

Behavior can become implementation-specific or confusing.

Avoid double-prefix accidentally:

```text
/api/api/customers
```

## 16.4 Modern recommendation

Use `@ApplicationPath` for Jakarta EE app unless you have legacy descriptor reasons.

## 16.5 Descriptor use cases

- legacy app;
- implementation-specific servlet config;
- integration with non-JAX-RS servlet routing;
- complex server configuration.

## 16.6 Debugging

Check:

- context root;
- servlet mapping;
- application path;
- resource path;
- gateway path rewrite.

---

# 17. Classloading dan Dependency Boundary

JAX-RS apps often fail due classloading.

## 17.1 API vs implementation

API:

```text
jakarta.ws.rs-api
```

Implementation:

```text
Jersey / RESTEasy / CXF / runtime provided
```

API alone cannot run server.

## 17.2 App server provides implementation

If using Jakarta EE runtime, it provides implementation.

Do not bundle competing implementation unless intended.

## 17.3 Common conflict

WAR contains:

```text
jakarta.ws.rs-api.jar
jersey-server.jar
```

while server already provides RESTEasy/Jakarta REST.

This can cause:

- class cast;
- provider not found;
- duplicate annotations;
- linkage errors;
- unexpected behavior.

## 17.4 `javax` vs `jakarta`

Never mix old `javax.ws.rs` providers with `jakarta.ws.rs` app.

They are different APIs.

## 17.5 Third-party libraries

Check if dependencies support Jakarta namespace.

Example:

- old Swagger/OpenAPI annotations/generators;
- old Jersey filters;
- old RESTEasy extensions;
- old Jackson JAX-RS provider.

## 17.6 Build hygiene

Use dependency tree.

Use enforcer rules.

## 17.7 Production rule

```text
Know whether JAX-RS classes come from app, server, or framework.
```

---

# 18. Jakarta EE Runtime vs Standalone Runtime

## 18.1 Jakarta EE runtime

Examples:

- GlassFish;
- Payara;
- Open Liberty;
- WildFly;
- TomEE;
- other compatible products.

Runtime provides:

- Servlet;
- CDI;
- REST implementation;
- JSON;
- Validation;
- JPA;
- Security;
- transactions;
- resources.

## 18.2 Standalone runtime

Examples:

- Jersey with Grizzly/Jetty;
- RESTEasy embedded;
- CXF embedded;
- framework-specific runtime.

You must configure:

- HTTP server;
- DI/CDI integration if needed;
- JSON provider;
- validation;
- security;
- lifecycle.

## 18.3 Jakarta EE pros

- integrated platform;
- standard resource management;
- transactions/security;
- deployment model;
- compatibility.

## 18.4 Standalone pros

- more control;
- smaller runtime possible;
- embedded testing;
- custom bootstrap.

## 18.5 Trade-off

Jakarta EE app:

```text
less bootstrap code, more container contract
```

Standalone:

```text
more bootstrap code, more explicit dependencies
```

## 18.6 Top-tier decision

Choose based on operational model, not personal preference.

---

# 19. Java SE Bootstrap dan Embedded Server

Jakarta REST can run in Java SE with implementation-specific bootstrap.

## 19.1 Specification note

Jakarta REST defines APIs, and Java SE support is clarified in modern spec context, but actual bootstrapping depends on implementation.

## 19.2 Jersey example concept

```java
ResourceConfig config = new ResourceConfig()
    .register(CustomerResource.class)
    .register(ProblemMapper.class);

HttpServer server = GrizzlyHttpServerFactory
    .createHttpServer(URI.create("http://localhost:8080/api"), config);
```

This is Jersey-specific.

## 19.3 RESTEasy embedded

RESTEasy has its own bootstrap patterns.

## 19.4 CXF embedded

CXF has its own server factory.

## 19.5 Portability boundary

`Application` is portable.

Embedded server bootstrap usually is not.

## 19.6 Testing use

Embedded bootstrap can be useful in integration tests.

## 19.7 Production caution

If running standalone, you own:

- server lifecycle;
- TLS;
- thread pools;
- graceful shutdown;
- metrics;
- logging;
- dependency injection;
- security.

---

# 20. CDI Integration dalam Bootstrap

CDI integration is crucial in Jakarta EE.

## 20.1 Resource injection

```java
@Path("/customers")
@RequestScoped
public class CustomerResource {

    @Inject
    CustomerService service;
}
```

## 20.2 Provider injection

```java
@Provider
@ApplicationScoped
public class ProblemMapper implements ExceptionMapper<DomainException> {

    @Inject
    ErrorMessageLocalizer localizer;
}
```

## 20.3 CDI discovery

CDI must discover bean classes.

Check:

- bean archive;
- `beans.xml` mode;
- annotations;
- runtime profile.

## 20.4 Manual singletons bypass CDI

```java
getSingletons() {
    return Set.of(new CustomerResource());
}
```

Bad if `CustomerResource` needs `@Inject`.

## 20.5 Application subclass CDI?

Some runtimes can inject into `Application` subclass, others may have limitations.

Avoid putting complex injection in `Application`.

## 20.6 Request context

JAX-RS request usually activates relevant request context.

But async processing and custom threads need care.

## 20.7 Top-tier rule

```text
Let CDI manage resources/providers whenever you need injection/lifecycle/interceptors.
```

---

# 21. Resource Lifecycle: Per-Request, Singleton, CDI Scope

Resource lifecycle affects thread safety.

## 21.1 Per-request default idea

Many JAX-RS implementations instantiate resource per request by default.

But CDI scope and registration method can change this.

## 21.2 Singleton resource

Singleton resources shared across requests.

Must be thread-safe.

## 21.3 CDI scopes

Common:

```java
@RequestScoped
@ApplicationScoped
@Dependent
```

## 21.4 Resource field state

Bad:

```java
@Path("/orders")
@ApplicationScoped
public class OrderResource {
    private String currentUser; // unsafe
}
```

## 21.5 Store request state locally

Good:

```java
public Response get(@Context SecurityContext security) {
    String currentUser = security.getUserPrincipal().getName();
}
```

## 21.6 Providers often singleton-ish

Filters/mappers/providers may be shared.

Make them stateless/thread-safe.

## 21.7 Mutable dependencies

If dependency is mutable, understand its scope.

## 21.8 Top-tier rule

```text
Assume providers are shared and resources may be concurrent unless scope guarantees otherwise.
```

---

# 22. Application Properties dan Runtime Configuration

`Application#getProperties()` can expose properties.

## 22.1 Example

```java
@Override
public Map<String, Object> getProperties() {
    return Map.of(
        "jersey.config.server.tracing.type", "ON_DEMAND"
    );
}
```

This example is implementation-specific.

## 22.2 Standard vs implementation-specific

JAX-RS defines some standard configuration interfaces, but most application properties are runtime-specific.

## 22.3 Better config boundary

Use:

- MicroProfile Config if available;
- runtime server config;
- environment variables;
- CDI config producer;
- application-specific typed config.

## 22.4 Do not hide production config in code

`Application#getProperties()` should not contain environment-specific secrets/settings.

## 22.5 Runtime property docs

If using implementation-specific properties, document them in ADR/config reference.

## 22.6 Testing

Include runtime property tests if behavior critical.

---

# 23. Implementation Differences: Jersey, RESTEasy, CXF, Open Liberty, Payara, Quarkus

## 23.1 Jersey

Often used standalone and in GlassFish/Payara lineage.

Has `ResourceConfig`, rich features, multipart support via extensions.

## 23.2 RESTEasy

Used in WildFly/JBoss ecosystem.

RESTEasy docs describe WAR scanning for JAX-RS services/provider classes and integration with CDI/EJB in WildFly.

RESTEasy has classic and reactive variants in Quarkus ecosystem.

## 23.3 Apache CXF

Supports JAX-RS and JAX-WS, common in integration-heavy environments.

## 23.4 Open Liberty

Feature-based runtime.

Jakarta REST features enabled explicitly in `server.xml`.

## 23.5 Payara/GlassFish

Jakarta EE runtimes with integrated Jakarta REST support.

## 23.6 Quarkus

Uses Jakarta REST APIs but with build-time augmentation and Quarkus-specific behavior.

Not identical to classic app server.

## 23.7 Differences to test

- resource discovery;
- provider priority;
- CDI injection;
- JSON provider defaults;
- multipart support;
- exception defaults;
- async/SSE behavior;
- client transport;
- metrics/tracing integration;
- configuration properties.

## 23.8 Portability strategy

Use portable JAX-RS core for application code.

Isolate implementation extensions.

---

# 24. Jakarta REST 4.0 Context: JAXB Removed, ManagedBean Removed

Jakarta REST 4.0 has important cleanup.

## 24.1 JAXB dependency removed

Do not assume JAXB provider is part of JAX-RS runtime.

If XML/JAXB needed:

- add explicit Jakarta XML Binding dependency;
- add implementation/provider;
- test `application/xml`.

## 24.2 ManagedBean support removed

Do not rely on legacy ManagedBean lifecycle.

Use CDI.

## 24.3 Why relevant to bootstrap

If old app relied on:

```java
@ManagedBean
```

for resources/providers, it may break.

If old app relied on JAXB XML by default, it may break.

## 24.4 Migration action

- replace Managed Beans with CDI;
- explicit XML provider dependencies;
- update tests for XML media types;
- verify runtime feature set.

## 24.5 Top-tier rule

```text
Jakarta REST 4.0 assumes modern Jakarta component model: CDI, explicit providers, no hidden JAXB assumption.
```

---

# 25. Base Path Versioning Strategy

You may place API version in application path.

```java
@ApplicationPath("/api/v1")
```

## 25.1 Pros

- obvious;
- gateway-friendly;
- easy route separation;
- easy parallel version deployment.

## 25.2 Cons

- version in every URL;
- can encourage version explosion;
- hard to evolve fine-grained resources;
- duplicated resource classes.

## 25.3 Alternative

Media type version:

```http
Accept: application/vnd.example.customer.v1+json
```

## 25.4 Alternative

Header version:

```http
API-Version: 1
```

## 25.5 Practical enterprise choice

URI versioning is common and easy operationally.

But still define compatibility policy.

## 25.6 App separation

Multiple `Application` classes can separate versions:

```java
@ApplicationPath("/api/v1")
public class ApiV1 extends Application {}

@ApplicationPath("/api/v2")
public class ApiV2 extends Application {}
```

Use carefully.

## 25.7 Better approach

Often:

```text
/api
```

with backward-compatible evolution until breaking change truly needed.

---

# 26. Deployment Context Pitfalls di Reverse Proxy / API Gateway

Production rarely exposes app server directly.

Common chain:

```text
Client
  ↓
CDN/WAF
  ↓
API Gateway / Ingress
  ↓
Service / Pod
  ↓
Jakarta runtime
  ↓
JAX-RS app
```

## 26.1 Path rewriting

Gateway may expose:

```text
/api/customers
```

but internal app sees:

```text
/myapp/api/customers
```

or:

```text
/customers
```

## 26.2 Base URI generation

If resource builds links:

```java
uriInfo.getAbsolutePathBuilder()
```

it might generate internal host:

```text
http://pod-ip:8080/myapp/api/customers/C001
```

instead of:

```text
https://api.example.com/customers/C001
```

## 26.3 Forwarded headers

Common headers:

```text
Forwarded
X-Forwarded-Proto
X-Forwarded-Host
X-Forwarded-Port
X-Forwarded-Prefix
```

Runtime/proxy must be configured to honor them safely.

## 26.4 Security risk

Do not blindly trust forwarded headers from public clients.

Only trust from known proxy.

## 26.5 Location header

`201 Created` and `202 Accepted` often use `Location`.

Wrong base URI breaks clients.

## 26.6 Testing

Test behind actual ingress/gateway.

## 26.7 Recommendation

Centralize URI building and test external URL generation.

---

# 27. Testing Application Bootstrap

## 27.1 Unit test `Application`

If explicit registration:

```java
@Test
void registersExpectedClasses() {
    ApiApplication app = new ApiApplication();

    assertThat(app.getClasses())
        .contains(CustomerResource.class, ProblemMapper.class);
}
```

## 27.2 Runtime boot test

Start target runtime and call:

```http
GET /api/health
```

## 27.3 Provider test

Trigger known exception and verify mapper active.

## 27.4 Filter test

Verify correlation/security headers.

## 27.5 Media test

Verify JSON provider active:

```http
Accept: application/json
```

## 27.6 Path test

Test full external path including context root/gateway prefix.

## 27.7 Multiple app test

Verify `/public` and `/internal` have correct providers/auth.

## 27.8 CI

Include packaged artifact deployed to target runtime if possible.

## 27.9 Contract

Bootstrap is part of API contract.

Test it.

---

# 28. Observability untuk Application Bootstrap

Bootstrap failure should be visible.

## 28.1 Startup logs

Log:

- Jakarta REST application base path;
- registered resource count;
- provider count if available;
- runtime version;
- active profile/environment;
- important runtime properties.

Avoid secret values.

## 28.2 Health endpoint

Expose readiness only after JAX-RS app and critical resources ready.

## 28.3 Metrics

Track:

- app startup time;
- request count per path template;
- 404/405 rates;
- provider errors;
- exception mapper categories.

## 28.4 Deployment verification

After deploy, smoke test:

- application base path;
- representative resource;
- error mapper;
- auth filter;
- JSON body.

## 28.5 Debug endpoint?

Avoid exposing internal registry publicly.

Can expose safe admin-only diagnostics if needed.

## 28.6 Top-tier rule

```text
A failed or partially registered REST app should be detected before users do.
```

---

# 29. Failure Modes

## 29.1 404 due wrong context root

Expected:

```text
/api/customers
```

Actual:

```text
/myapp/api/customers
```

## 29.2 404 due missing `@ApplicationPath`

No JAX-RS application path active.

## 29.3 404 due resource not scanned

Resource class not discovered.

## 29.4 405 due method mismatch

Path exists but HTTP method not allowed.

## 29.5 415 due provider/media mismatch

Request `Content-Type` unsupported.

## 29.6 406 due `Accept` mismatch

Client asks media type server cannot produce.

## 29.7 Injection null

Resource registered manually as singleton, bypassing CDI.

## 29.8 Provider not active

`@Provider` not scanned because explicit registration overrides scanning.

## 29.9 Duplicate application paths

Two `Application` classes conflict.

## 29.10 Mixed `javax`/`jakarta`

Old provider ignored or fails.

## 29.11 Wrong `Location` header

Generated internal URL behind proxy.

## 29.12 Resource not thread-safe

Singleton stores mutable request state.

## 29.13 API jar conflict

Packaged API/implementation conflicts with server.

## 29.14 `@ApplicationPath("/")` captures too much

Static pages or other servlets affected.

---

# 30. Best Practices

## 30.1 Always define explicit `Application` class

```java
@ApplicationPath("/api")
public class ApiApplication extends Application {}
```

## 30.2 Keep base path stable

Changing base path breaks clients.

## 30.3 Understand full path

Document:

```text
context root + application path + resource path
```

## 30.4 Prefer CDI-managed classes

Avoid manual singleton instances for injected resources/providers.

## 30.5 Audit provider registration

Know active filters/mappers/providers.

## 30.6 Use explicit registration for critical APIs

Especially regulated or large systems.

## 30.7 Test on target runtime

Implementation differences matter.

## 30.8 Avoid vendor-specific bootstrap unless needed

If using it, document ADR.

## 30.9 Be gateway-aware

Test `Location` headers and URI generation behind proxy.

## 30.10 Keep application class simple

No business logic.

---

# 31. Anti-Patterns

## 31.1 Treating `Application` as meaningless boilerplate

It defines boundary.

## 31.2 Manual `new` for CDI resource

Breaks injection/lifecycle.

## 31.3 Multiple `Application` classes without design

Confusing routing/provider behavior.

## 31.4 `@ApplicationPath("/")` by default

Can conflict with non-REST routes.

## 31.5 Relying on implementation scanning magic

Not portable.

## 31.6 Bundling random JAX-RS implementations in app server WAR

Classpath conflict.

## 31.7 Mixing `javax.ws.rs` and `jakarta.ws.rs`

Migration bug.

## 31.8 Path versioning everywhere without compatibility policy

Version explosion.

## 31.9 Generating absolute URLs without proxy awareness

Broken external links.

## 31.10 No bootstrap smoke test

Failures discovered by users.

---

# 32. Production Checklist

## 32.1 Application path

- [ ] `Application` subclass exists.
- [ ] `@ApplicationPath` clear.
- [ ] Context root documented.
- [ ] Effective external path tested.
- [ ] Gateway path rewrite documented.

## 32.2 Registration

- [ ] Resource discovery strategy known.
- [ ] Provider registration strategy known.
- [ ] Critical filters registered.
- [ ] Error mappers registered.
- [ ] JSON provider active.
- [ ] No accidental provider missing.

## 32.3 CDI/lifecycle

- [ ] Resources CDI-managed if injection needed.
- [ ] Providers CDI-managed if injection needed.
- [ ] No unsafe singleton state.
- [ ] Scope chosen intentionally.

## 32.4 Dependencies

- [ ] No `javax.ws.rs` in Jakarta app.
- [ ] No duplicate API jars.
- [ ] Runtime implementation known.
- [ ] Third-party providers namespace-compatible.

## 32.5 Runtime

- [ ] Tested on target runtime.
- [ ] Runtime version documented.
- [ ] Implementation-specific properties documented.
- [ ] Java version supported.

## 32.6 Proxy/deployment

- [ ] `Location` header external URL correct.
- [ ] Forwarded headers handled safely.
- [ ] Health endpoint reachable.
- [ ] Smoke tests pass after deploy.

---

# 33. Latihan

## Latihan 1 — Effective Path Calculation

Diberikan:

```text
context root: /licensing
@ApplicationPath("/api")
resource @Path("/applications")
method @Path("/{id}")
```

Tulis effective endpoint path.

Lalu ubah jika gateway mengekspos service di:

```text
https://licensing.example.com
```

dan menghapus `/licensing`.

## Latihan 2 — Scanning vs Explicit

Buat dua `Application` class:

1. Empty subclass dengan scanning.
2. Explicit `getClasses()`.

Tambahkan provider baru dan lihat apakah otomatis aktif.

## Latihan 3 — CDI Bypass

Register resource via `getSingletons()` menggunakan `new`.

Tambahkan `@Inject`.

Amati failure.

Refactor ke `getClasses()`.

## Latihan 4 — Provider Missing

Buat `ExceptionMapper<DomainException>`.

Jalankan test ketika mapper tidak registered.

Lalu register dan bandingkan response.

## Latihan 5 — Multiple Applications

Buat:

```text
/public
/internal
```

dengan filter berbeda.

Uji bahwa internal endpoint tidak bisa diakses tanpa internal auth.

## Latihan 6 — Proxy URL

Buat endpoint create yang return `Location`.

Test direct app server vs behind gateway.

Pastikan external URL benar.

## Latihan 7 — Dependency Audit

Run dependency tree.

Cari:

```text
javax.ws.rs
jakarta.ws.rs
jersey
resteasy
cxf
```

Tentukan mana API, mana implementation.

---

# 34. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0  
   https://jakarta.ee/specifications/restful-ws/4.0/

2. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

3. Jakarta RESTful Web Services 4.0 API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/

4. `ApplicationPath` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/applicationpath

5. `Application` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/application

6. `Path` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/path

7. Jakarta RESTful Web Services Explained  
   https://jakarta.ee/learn/specification-guides/restful-web-services-explained/

8. Jakarta EE Tutorial — Developing RESTful Web Services with Jakarta REST  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/websvcs/rest/rest.html

9. Maven Central — `jakarta.ws.rs-api` 4.0.0  
   https://central.sonatype.com/artifact/jakarta.ws.rs/jakarta.ws.rs-api/4.0.0/jar

10. RESTEasy User Guide  
    https://docs.resteasy.dev/5.0/userguide/html_single/

---

# 35. Penutup

Part ini menjelaskan anatomi aplikasi JAX-RS.

Mental model utama:

```text
Deployment context
  + @ApplicationPath
  + class @Path
  + method @Path
  =
effective endpoint URI
```

`Application` adalah:

```text
REST runtime boundary / composition root
```

Bukan sekadar boilerplate.

Hal yang harus selalu kamu pahami:

- dari mana base path berasal;
- bagaimana resource ditemukan;
- bagaimana provider aktif;
- apakah resource/provider CDI-managed;
- runtime implementation apa yang menjalankan;
- dependency mana yang disediakan server;
- apakah URL generation benar di belakang gateway;
- apakah bootstrap diuji.

Top-tier JAX-RS engineer bisa mendebug endpoint yang tidak ditemukan bukan dengan menebak-nebak, tetapi dengan memeriksa:

```text
context root
application path
resource path
method path
HTTP method
media type
registration strategy
provider/filter chain
runtime scanning
classpath namespace
proxy rewrite
```

Part berikutnya:

```text
Bagian 003 — Resource Class Mental Model: Class-Level Path, Method-Level Path, Subresource
```

Kita akan masuk sangat detail ke desain resource class, resource method, subresource locator, lifecycle, statefulness, thin resource principle, dan boundary design.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-001.md](./learn-jaxrs-advanced-part-001.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-003.md](./learn-jaxrs-advanced-part-003.md)

</div>