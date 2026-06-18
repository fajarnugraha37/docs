# learn-java-jakarta-part-007.md

# Bagian 7 — CDI: `jakarta.enterprise.*` sebagai Container Programming Model

> Target pembaca: Java engineer yang ingin memahami CDI bukan sebagai “DI seperti Spring”, tetapi sebagai **standard container programming model** di Jakarta EE: contextual lifecycle, type-safe injection, scopes, qualifiers, producers, disposers, events, interceptors, decorators, extension model, CDI Lite vs CDI Full, proxy, bean discovery, dan production failure modes.
>
> Fokus bagian ini: memahami bagaimana `jakarta.inject` menjadi “hidup” di dalam CDI, bagaimana CDI container membangun dependency graph, bagaimana context/scope bekerja, bagaimana extension point dipakai, dan bagaimana mendesain aplikasi Jakarta yang testable, observable, dan aman dari lifecycle/proxy pitfalls.

---

## Daftar Isi

1. [Orientasi: CDI Itu Apa?](#1-orientasi-cdi-itu-apa)
2. [Mental Model Besar CDI](#2-mental-model-besar-cdi)
3. [`jakarta.inject` vs CDI: Fondasi vs Rumah Lengkap](#3-jakartainject-vs-cdi-fondasi-vs-rumah-lengkap)
4. [CDI 4.1 dalam Jakarta EE 11](#4-cdi-41-dalam-jakarta-ee-11)
5. [CDI Lite vs CDI Full](#5-cdi-lite-vs-cdi-full)
6. [Dependency dan Artifact CDI](#6-dependency-dan-artifact-cdi)
7. [Bean: Unit Utama CDI](#7-bean-unit-utama-cdi)
8. [Bean Discovery dan Bean Archive](#8-bean-discovery-dan-bean-archive)
9. [`beans.xml` dan Discovery Mode](#9-beansxml-dan-discovery-mode)
10. [Bean-Defining Annotation](#10-bean-defining-annotation)
11. [Typesafe Resolution](#11-typesafe-resolution)
12. [Qualifiers: `@Default`, `@Any`, Custom Qualifier](#12-qualifiers-default-any-custom-qualifier)
13. [Scopes dan Contexts](#13-scopes-dan-contexts)
14. [`@Dependent`](#14-dependent)
15. [`@ApplicationScoped`](#15-applicationscoped)
16. [`@RequestScoped`](#16-requestscoped)
17. [`@SessionScoped` dan `@ConversationScoped`](#17-sessionscoped-dan-conversationscoped)
18. [Normal Scope, Pseudo Scope, dan Proxy](#18-normal-scope-pseudo-scope-dan-proxy)
19. [Client Proxy dan Contextual Reference](#19-client-proxy-dan-contextual-reference)
20. [Injection Point: Constructor, Field, Method](#20-injection-point-constructor-field-method)
21. [Producers: Membuat Bean dari Factory Method/Field](#21-producers-membuat-bean-dari-factory-methodfield)
22. [Disposers: Cleanup untuk Produced Object](#22-disposers-cleanup-untuk-produced-object)
23. [`Instance<T>`: Programmatic Lookup CDI](#23-instancet-programmatic-lookup-cdi)
24. [Alternatives, Specialization, dan Priority](#24-alternatives-specialization-dan-priority)
25. [Stereotypes](#25-stereotypes)
26. [Interceptors di CDI](#26-interceptors-di-cdi)
27. [Decorators di CDI](#27-decorators-di-cdi)
28. [CDI Events](#28-cdi-events)
29. [Observer Method, Transactional Observer, Async Event](#29-observer-method-transactional-observer-async-event)
30. [Portable Extensions dan Build Compatible Extensions](#30-portable-extensions-dan-build-compatible-extensions)
31. [CDI dan Jakarta EE Integration](#31-cdi-dan-jakarta-ee-integration)
32. [CDI dalam JAX-RS, Servlet, JPA, Transaction, Security](#32-cdi-dalam-jax-rs-servlet-jpa-transaction-security)
33. [CDI dan Cloud-Native Runtime](#33-cdi-dan-cloud-native-runtime)
34. [Design Guidelines: Menggunakan CDI Tanpa Mengacaukan Architecture](#34-design-guidelines-menggunakan-cdi-tanpa-mengacaukan-architecture)
35. [Testing Strategy](#35-testing-strategy)
36. [Performance dan Startup Considerations](#36-performance-dan-startup-considerations)
37. [Production Failure Modes](#37-production-failure-modes)
38. [Debugging Playbook](#38-debugging-playbook)
39. [Best Practices dan Anti-Patterns](#39-best-practices-dan-anti-patterns)
40. [Checklist Review CDI](#40-checklist-review-cdi)
41. [Latihan Bertahap](#41-latihan-bertahap)
42. [Mini Project: CDI Mastery Lab](#42-mini-project-cdi-mastery-lab)
43. [Referensi Resmi](#43-referensi-resmi)

---

# 1. Orientasi: CDI Itu Apa?

CDI adalah singkatan dari **Contexts and Dependency Injection**.

Nama ini penting:

```text
Contexts
  + Dependency Injection
```

Banyak orang hanya melihat “DI”-nya, padahal bagian “Contexts” sama pentingnya.

## 1.1 CDI bukan hanya `@Inject`

`@Inject` berasal dari `jakarta.inject`.

CDI memakai `@Inject`, tetapi CDI jauh lebih luas:

- bean discovery;
- contextual lifecycle;
- scopes;
- qualifiers;
- producers;
- disposers;
- alternatives;
- interceptors;
- decorators;
- events;
- programmatic lookup;
- extension model;
- integration dengan Jakarta EE runtime.

Dengan `jakarta.inject` saja, kamu punya annotation minimal.

Dengan CDI, kamu punya container yang memahami:

```text
object ini hidup selama request
object ini hidup selama aplikasi
object ini punya qualifier tertentu
object ini diproduksi oleh method ini
object ini perlu dihancurkan dengan disposer
event ini diamati oleh observer ini
method ini perlu interceptor
dependency ini ambiguous
dependency ini unsatisfied
```

## 1.2 CDI menyatukan komponen aplikasi

Jakarta EE Tutorial menjelaskan CDI sebagai salah satu fitur Jakarta EE yang membantu “menjahit” web tier dan transactional tier bersama-sama. Itu tepat secara mental model.

Contoh flow:

```text
JAX-RS resource
  injects application service
    injects repository
      injects EntityManager/DataSource
    injects policy
    fires CDI event
  transaction interceptor wraps use case
  security context available
```

CDI menjadi perekat antar layer.

## 1.3 Kenapa CDI penting untuk top-tier engineer?

Karena banyak bug Jakarta production berasal dari salah paham CDI:

- bean tidak ditemukan;
- dependency ambiguous;
- scope salah;
- request-scoped bean dipakai di singleton;
- proxy tidak bisa dibuat;
- interceptor tidak jalan;
- producer membuat resource leak;
- event punya side effect tersembunyi;
- startup lambat karena bean discovery;
- field injection membuat graph tidak terlihat;
- alternative aktif di environment yang salah;
- circular dependency muncul;
- object dibuat dengan `new`, lalu `@Inject` tidak jalan.

CDI yang dipahami dangkal bisa membuat aplikasi terasa “magical”. CDI yang dipahami dalam bisa membuat architecture sangat bersih.

---

# 2. Mental Model Besar CDI

Pegang model berikut:

```text
Deployment
  ↓
Bean discovery
  ↓
Bean metadata model
  ↓
Typesafe dependency resolution
  ↓
Context/scope management
  ↓
Proxy/reference creation
  ↓
Injection
  ↓
Lifecycle callbacks
  ↓
Interceptors/decorators/events
  ↓
Runtime invocation
  ↓
Destruction/disposal
```

## 2.1 CDI sebagai graph builder

CDI membangun dependency graph.

Contoh:

```java
@Path("/cases")
public class CaseResource {
    @Inject
    ApproveCaseUseCase approveCase;
}
```

```java
@ApplicationScoped
public class ApproveCaseUseCase {
    @Inject
    CaseRepository repository;

    @Inject
    AuditTrail auditTrail;
}
```

```java
@ApplicationScoped
public class JpaCaseRepository implements CaseRepository {
    @PersistenceContext
    EntityManager em;
}
```

CDI melihat:

```text
CaseResource
  → ApproveCaseUseCase
      → CaseRepository
          → JpaCaseRepository
      → AuditTrail
```

## 2.2 CDI sebagai lifecycle manager

CDI tidak hanya membuat object. CDI mengelola lifecycle object berdasarkan scope.

```text
@RequestScoped
  one contextual instance per request

@ApplicationScoped
  one contextual instance per application

@Dependent
  lifecycle tied to injection target
```

## 2.3 CDI sebagai context resolver

Saat kamu inject request-scoped bean ke application-scoped bean, yang diinjeksi sering bukan instance asli, tetapi proxy.

```text
ApplicationScoped bean
  holds proxy to RequestScoped bean

When method called:
  proxy resolves actual request instance from active request context
```

## 2.4 CDI sebagai extension ecosystem

CDI juga menyediakan extension points.

Framework/runtime bisa memperluas CDI untuk:

- automatic bean registration;
- framework integration;
- build-time processing;
- custom scopes;
- annotation processing;
- validation;
- REST integration;
- data repositories;
- telemetry;
- security.

---

# 3. `jakarta.inject` vs CDI: Fondasi vs Rumah Lengkap

## 3.1 `jakarta.inject`

Menyediakan:

- `@Inject`;
- `@Qualifier`;
- `@Named`;
- `Provider<T>`;
- `@Scope`;
- `@Singleton`.

Ia memberi vocabulary.

## 3.2 CDI

Menyediakan container behavior dan programming model:

- `@ApplicationScoped`;
- `@RequestScoped`;
- `@SessionScoped`;
- `@Dependent`;
- `@Produces`;
- `@Disposes`;
- `@Observes`;
- `@ObservesAsync`;
- `Instance<T>`;
- `@Alternative`;
- `@Specializes`;
- `@Stereotype`;
- interceptor/decorator model;
- extension model;
- bean archive/discovery;
- typesafe resolution rules.

## 3.3 Analogi

```text
jakarta.inject = grammar dasar
CDI = runtime bahasa lengkap
```

## 3.4 Practical rule

Jika kamu memakai:

```java
@Inject
```

di aplikasi Jakarta EE, behavior praktisnya biasanya ditentukan oleh CDI.

Jika kamu memakai:

```java
@ApplicationScoped
@Produces
@Observes
Instance<T>
```

kamu sudah berada dalam dunia CDI.

---

# 4. CDI 4.1 dalam Jakarta EE 11

Jakarta CDI 4.1 adalah release untuk Jakarta EE 11.

## 4.1 Fokus CDI 4.1

CDI 4.1 bukan release besar seperti CDI 4.0, tetapi berisi perbaikan berguna untuk application developers dan framework authors.

Poin penting dari dokumentasi resmi:

- CDI 4.1 release untuk Jakarta EE 11;
- CDI 4.1 tidak lagi menspesifikasikan integrasi dengan Jakarta EE; integrasi tersebut dipindahkan ke Platform, Web Profile, dan Core Profile specifications;
- CDI 4.x landscape sudah membedakan CDI Lite dan CDI Full;
- CDI 4.0 sebelumnya memperkenalkan pemisahan CDI Core menjadi Lite dan Full serta Build Compatible Extensions.

## 4.2 Kenapa integrasi dipindahkan penting?

Ini subtle tapi penting.

CDI specification fokus ke CDI sendiri.

Integrasi dengan Jakarta EE runtime/profile dijelaskan di specification Platform/Web/Core.

Artinya saat kamu bertanya:

```text
Bagaimana CDI terintegrasi dengan Jakarta REST?
Bagaimana CDI dipakai dalam Core Profile?
Apa yang wajib tersedia di Web Profile?
```

jawabannya bukan hanya di CDI spec, tetapi juga di Jakarta EE profile/platform spec.

## 4.3 Jakarta EE 11 dan Java baseline

Jakarta EE 11 target modern Java, dengan minimum Java SE 17 atau lebih tinggi pada profile specs. Ini penting untuk CDI karena:

- records/modern Java type style lebih umum;
- reflection/JPMS/strong encapsulation harus dipahami;
- cloud runtimes semakin build-time/AOT aware;
- CDI Lite makin relevan.

---

# 5. CDI Lite vs CDI Full

## 5.1 Kenapa ada CDI Lite?

Cloud-native runtimes ingin:

- startup cepat;
- memory rendah;
- build-time processing;
- AOT/native-image friendliness;
- minimal reflection;
- smaller runtime.

CDI Full historis sangat dinamis dan kaya fitur. Ini powerful tetapi tidak selalu ideal untuk runtimes kecil.

CDI Lite menyediakan subset CDI yang dirancang untuk restricted environments.

## 5.2 CDI Lite

CDI Lite cocok untuk:

- Core Profile;
- microservices;
- build-time augmentation;
- cloud-native frameworks;
- native-image/AOT-oriented runtimes.

Fitur tertentu yang sangat dinamis dapat tidak tersedia.

## 5.3 CDI Full

CDI Full menyediakan kemampuan lebih luas, seperti extension model tradisional dan fitur enterprise yang lebih lengkap.

Cocok untuk:

- full Jakarta EE runtime;
- aplikasi enterprise tradisional;
- runtime yang mendukung dynamic extension;
- use case yang membutuhkan fitur CDI lengkap.

## 5.4 Build Compatible Extensions

CDI 4.0 menambahkan Build Compatible Extensions untuk mendukung extension yang dapat bekerja lebih baik di build-time/AOT setting.

Mental model:

```text
Portable Extension traditional:
  runtime/deployment-time, reflection-heavy

Build Compatible Extension:
  build-time friendly, model-oriented
```

## 5.5 Practical implication

Saat memilih runtime seperti Quarkus-style/Core Profile runtime, pastikan fitur CDI yang kamu pakai tersedia di CDI Lite.

Jangan mengasumsikan semua CDI Full features tersedia.

## 5.6 Decision rule

Gunakan CDI Lite-compatible subset jika:

- kamu butuh cloud-native small runtime;
- startup/memory critical;
- native image/AOT menjadi target;
- service sederhana.

Gunakan CDI Full jika:

- app butuh fitur CDI dinamis/advanced;
- runtime full Jakarta EE;
- legacy/enterprise integration kompleks.

---

# 6. Dependency dan Artifact CDI

## 6.1 Jakarta EE profile dependency

Jika memakai Jakarta EE Platform/Web/Core, CDI API biasanya tersedia lewat profile API.

Contoh:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-web-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

## 6.2 CDI API artifacts

CDI 4.x memecah API artifact ke beberapa area.

Conceptual categories:

- CDI API;
- CDI Lite API;
- CDI language model API;
- CDI extension APIs.

Gunakan artifact sesuai runtime/profile/framework. Untuk Jakarta EE app, biasanya profile API lebih mudah.

## 6.3 API jar bukan implementation

Seperti bagian sebelumnya:

```text
CDI API ≠ CDI container
```

Butuh CDI implementation/runtime:

- Jakarta EE runtime;
- standalone CDI container;
- framework/runtime integration;
- build-time CDI implementation.

## 6.4 Maven scope

Container-deployed app:

```xml
<scope>provided</scope>
```

Executable runtime/framework:

```text
follow runtime framework BOM/extension/dependency model
```

## 6.5 Avoid mixing CDI versions

Jangan mencampur:

- CDI API 4.1;
- runtime CDI implementation 4.0/older;
- `javax.enterprise.*` legacy packages;
- Jakarta EE profile version berbeda.

Periksa dependency tree.

---

# 7. Bean: Unit Utama CDI

## 7.1 Apa itu bean?

Dalam CDI, bean adalah component yang dapat:

- memiliki type;
- memiliki qualifiers;
- memiliki scope;
- dibuat oleh container;
- diinject ke bean lain;
- memiliki lifecycle;
- memiliki injection points;
- mungkin memiliki name;
- mungkin memiliki interceptor/decorator;
- mungkin diproduksi oleh producer.

## 7.2 Bean type

Bean type menentukan type apa yang bisa dipakai untuk injection.

Contoh:

```java
@ApplicationScoped
public class JpaCaseRepository implements CaseRepository {
}
```

Bean types dapat mencakup:

```text
JpaCaseRepository
CaseRepository
Object
```

depending rules.

Injection:

```java
@Inject
CaseRepository repository;
```

bisa resolve ke `JpaCaseRepository`.

## 7.3 Bean qualifiers

Qualifiers membedakan bean dengan type sama.

```java
@ReadReplica
@ApplicationScoped
public class ReadOnlyCaseRepository implements CaseRepository {}
```

## 7.4 Bean scope

Scope menentukan lifecycle:

```java
@ApplicationScoped
@RequestScoped
@Dependent
```

## 7.5 Bean name

Bean bisa punya name, misalnya dengan `@Named`, sering untuk EL/UI integration.

## 7.6 Bean tidak harus class langsung

Bean bisa berasal dari:

- managed bean class;
- producer method;
- producer field;
- synthetic bean via extension;
- built-in bean;
- resource integration;
- framework-provided bean.

## 7.7 Bean adalah metadata + lifecycle

Bean bukan hanya object instance.

Bean adalah definisi yang dipakai container untuk membuat contextual instances.

---

# 8. Bean Discovery dan Bean Archive

## 8.1 Bean discovery

Bean discovery adalah proses CDI menemukan class/method/field yang menjadi bean.

Sumber discovery:

- bean-defining annotations;
- `beans.xml`;
- producer methods/fields;
- extensions;
- runtime integration;
- build-time index.

## 8.2 Bean archive

Bean archive adalah archive/module yang mengandung beans dan metadata CDI.

Contoh:

- WAR `WEB-INF/classes`;
- jar in `WEB-INF/lib`;
- application module;
- library jar with beans.xml or bean-defining annotations.

## 8.3 Discovery mode

CDI mengenal discovery mode seperti:

- `annotated`;
- `all`;
- `none`.

CDI 4.0 mengubah default empty `beans.xml` menjadi `annotated`.

## 8.4 Why discovery matters?

Jika class tidak discovered, injection gagal.

Contoh:

```java
public class CaseService {}
```

Tanpa bean-defining annotation, dalam mode `annotated` class ini mungkin tidak menjadi bean.

Fix:

```java
@ApplicationScoped
public class CaseService {}
```

or configure discovery appropriately.

## 8.5 Discovery performance

Mode `all` bisa membuat lebih banyak class diproses.

Di aplikasi besar:

- startup lebih lambat;
- more beans than expected;
- ambiguity lebih mungkin;
- memory metadata lebih besar.

Prefer explicit bean-defining annotations unless legacy requires otherwise.

## 8.6 Library beans

Jika library jar membawa CDI beans, aplikasi consumer bisa mendapat beans tambahan.

Ini bisa baik atau buruk.

Risiko:

- ambiguous dependency;
- accidental activation;
- hidden side effects;
- different behavior after library upgrade.

---

# 9. `beans.xml` dan Discovery Mode

`beans.xml` adalah descriptor CDI.

Lokasi umum:

```text
WEB-INF/beans.xml
META-INF/beans.xml
```

## 9.1 Minimal beans.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<beans xmlns="https://jakarta.ee/xml/ns/jakartaee"
       bean-discovery-mode="annotated">
</beans>
```

## 9.2 `annotated`

Only classes with bean-defining annotations are discovered.

Good for modern apps.

## 9.3 `all`

All classes in archive are considered.

Useful for legacy but can create surprises.

## 9.4 `none`

Disable discovery for archive.

Use carefully.

## 9.5 Empty beans.xml behavior

Since CDI 4.0, empty `beans.xml` default is treated as `annotated`.

This is important for migration from older CDI assumptions.

## 9.6 CDI Lite note

In CDI Lite environment, only bean-discovery-mode attribute is read from `beans.xml` according to CDI 4.0-era behavior. Many dynamic descriptor features may not apply.

## 9.7 Best practice

Prefer:

```xml
bean-discovery-mode="annotated"
```

and explicit scopes.

This improves clarity/startup.

---

# 10. Bean-Defining Annotation

A bean-defining annotation is annotation that causes a class to be discovered as a bean in annotated discovery.

Examples include CDI scopes/stereotypes:

```java
@ApplicationScoped
@RequestScoped
@SessionScoped
@Dependent
@Stereotype
```

## 10.1 Example

```java
@ApplicationScoped
public class CaseService {
}
```

This class is discoverable.

## 10.2 Class with only `@Inject` constructor?

Depending discovery mode/spec details, a class may not be bean if it lacks bean-defining annotation in annotated mode.

Do not rely on incidental discovery.

Be explicit:

```java
@ApplicationScoped
public class CaseService {
    @Inject
    public CaseService(...) {}
}
```

## 10.3 `@Dependent` as explicit marker

If no meaningful wider scope, use:

```java
@Dependent
public class CaseMapper {}
```

But think about lifecycle.

## 10.4 Avoid making every class bean

Domain entities/value objects should not be CDI beans.

Good:

```java
public record Money(BigDecimal amount, Currency currency) {}
```

No CDI annotation.

## 10.5 Review question

For each bean:

```text
Why is this container-managed?
What scope?
Who injects it?
Does it need lifecycle/proxy?
```

---

# 11. Typesafe Resolution

CDI resolves injection by type and qualifier.

## 11.1 Injection point

```java
@Inject
@ReadReplica
CaseRepository repository;
```

Resolution asks:

```text
Find beans assignable to CaseRepository
AND having @ReadReplica qualifier
```

## 11.2 Unsatisfied

No matching bean.

```text
Unsatisfied dependency
```

## 11.3 Ambiguous

More than one matching bean.

```text
Ambiguous dependency
```

## 11.4 Qualifier default

If no qualifier specified, CDI uses `@Default`.

All beans also have `@Any`.

## 11.5 Example ambiguity

```java
@ApplicationScoped
public class JpaCaseRepository implements CaseRepository {}

@ApplicationScoped
public class InMemoryCaseRepository implements CaseRepository {}
```

Injection:

```java
@Inject
CaseRepository repository;
```

Ambiguous if both have default qualifier.

Fix:

```java
@ProductionRepository
@ApplicationScoped
public class JpaCaseRepository implements CaseRepository {}
```

and:

```java
@Inject
@ProductionRepository
CaseRepository repository;
```

## 11.6 Resolution should fail fast

CDI usually validates injection points at deployment/startup.

This is good: wiring errors are caught early.

## 11.7 Design principle

Ambiguity is not an inconvenience. It is a design signal.

It means your architecture has multiple valid candidates but injection point did not express intent.

---

# 12. Qualifiers: `@Default`, `@Any`, Custom Qualifier

## 12.1 `@Default`

If no qualifier is specified, `@Default` is assumed.

```java
@Inject
CaseRepository repository;
```

means roughly:

```text
CaseRepository + @Default
```

## 12.2 `@Any`

All beans have `@Any`.

Useful for programmatic selection:

```java
@Inject
@Any
Instance<NotificationSender> senders;
```

## 12.3 Custom qualifier

```java
@Qualifier
@Retention(RUNTIME)
@Target({FIELD, PARAMETER, METHOD, TYPE})
public @interface AuditChannel {}
```

Usage:

```java
@AuditChannel
@ApplicationScoped
public class AuditEventPublisher implements EventPublisher {}
```

Injection:

```java
@Inject
public AuditService(@AuditChannel EventPublisher publisher) {}
```

## 12.4 Qualifier with member

```java
@Qualifier
@Retention(RUNTIME)
@Target({FIELD, PARAMETER, METHOD, TYPE})
public @interface Channel {
    ChannelType value();
}
```

## 12.5 Nonbinding members

In CDI, qualifier members participate in resolution unless marked `@Nonbinding`.

Example:

```java
@Qualifier
@Retention(RUNTIME)
@Target({FIELD, PARAMETER, METHOD, TYPE})
public @interface Endpoint {
    @Nonbinding String description() default "";
    String value();
}
```

Use carefully.

## 12.6 Qualifier naming

Good:

- `@PrimaryDatabase`;
- `@ReadReplica`;
- `@AuditChannel`;
- `@ExternalGateway`;
- `@CaseStorage`;
- `@SystemClock`.

Bad:

- `@ImplA`;
- `@NewOne`;
- `@Fast`;
- `@Default2`.

---

# 13. Scopes dan Contexts

CDI’s unique strength is not only injection, but contextual lifecycle.

## 13.1 Scope

Scope answers:

```text
How long does this bean instance live?
```

## 13.2 Context

Context is runtime storage/lifecycle for a scope.

Example:

```text
Request context stores request-scoped instances for current request.
Application context stores app-scoped instances.
Session context stores session-scoped instances.
```

## 13.3 Common scopes

- `@Dependent`;
- `@ApplicationScoped`;
- `@RequestScoped`;
- `@SessionScoped`;
- `@ConversationScoped`.

## 13.4 Scope selection questions

Ask:

1. Who owns this state?
2. How long is it valid?
3. Is it thread-safe?
4. Can it be shared?
5. Does it depend on request/user/session?
6. How is it destroyed?
7. Is context active where used?

## 13.5 Scope is not optimization only

Scope affects correctness.

Example:

```java
@ApplicationScoped
public class CurrentUser {
    private String userId;
}
```

This is a critical bug: user data leaks across requests.

## 13.6 Prefer stateless application services

Most application services should be:

```java
@ApplicationScoped
```

and stateless/thread-safe.

Request data should be method parameters or request-scoped metadata, not mutable fields.

---

# 14. `@Dependent`

`@Dependent` is the default CDI pseudo-scope.

## 14.1 Meaning

Dependent object lifecycle is tied to the object into which it is injected.

## 14.2 Example

```java
@Dependent
public class CaseMapper {
    CaseDto toDto(Case c) { ... }
}
```

## 14.3 When useful?

- small helper;
- state tied to owner;
- produced object lifecycle tied to consumer;
- no independent context.

## 14.4 Pitfall

If injected into application-scoped bean, dependent object may effectively live as long as application-scoped bean.

```java
@ApplicationScoped
public class CaseService {
    @Inject
    CaseMapper mapper; // mapper lives with service
}
```

## 14.5 Dependent and cleanup

Dependent objects needing cleanup require careful lifecycle/disposer.

Avoid resource-heavy dependent beans unless you know destruction semantics.

---

# 15. `@ApplicationScoped`

Application scoped bean has one contextual instance per application.

## 15.1 Example

```java
@ApplicationScoped
public class EscalationPolicy {
    public Decision evaluate(Case c) { ... }
}
```

## 15.2 Good for

- stateless services;
- policies;
- clients;
- repositories;
- mappers;
- configuration holders;
- bounded caches;
- producers.

## 15.3 Thread safety

Application-scoped beans are shared.

Avoid mutable request-specific fields.

Bad:

```java
@ApplicationScoped
public class CaseService {
    private CaseId currentCaseId;
}
```

Good:

```java
public Result handle(CaseId caseId) { ... }
```

## 15.4 Lazy vs eager

Do not assume eager initialization unless configured.

If startup validation must run, use explicit startup mechanism or runtime feature.

## 15.5 Application scope and proxies

`@ApplicationScoped` is a normal scope in CDI, often proxied. Be aware of proxy behavior.

---

# 16. `@RequestScoped`

Request-scoped bean lives for one request context.

## 16.1 Example

```java
@RequestScoped
public class RequestMetadata {
    private String correlationId;
    private String actorId;
}
```

## 16.2 Good for

- correlation ID;
- current actor metadata;
- request-specific cache;
- per-request validation state;
- request localization.

## 16.3 Not good for

- background worker state;
- application cache;
- cross-request user session;
- long-running process state.

## 16.4 Context active

`@RequestScoped` requires active request context.

In background thread:

```text
ContextNotActiveException
```

unless context is propagated/activated by runtime.

## 16.5 Injecting request-scoped into application-scoped

CDI usually injects proxy.

```java
@ApplicationScoped
public class AuditLogger {
    @Inject
    RequestMetadata metadata;
}
```

When method called during request, proxy resolves correct instance.

When called outside request, failure.

## 16.6 Design guideline

For background work, extract immutable payload:

```java
record WorkContext(String correlationId, String actorId) {}
```

Do not pass request-scoped bean.

---

# 17. `@SessionScoped` dan `@ConversationScoped`

## 17.1 Session scope

Session-scoped bean lives in user session.

Common in server-side UI apps.

## 17.2 Risks

- memory growth;
- clustering complexity;
- serialization;
- sticky session;
- stale user state;
- security/session fixation;
- invalidation behavior.

## 17.3 Use carefully in REST APIs

Stateless REST APIs usually should avoid server-side session.

## 17.4 Conversation scope

Conversation scope supports longer interaction across multiple requests, often used in web UI workflows.

## 17.5 Modern alternatives

For many modern apps:

- keep server stateless;
- store workflow state in DB;
- use token/session externally;
- use client-side SPA state carefully;
- model business process explicitly.

## 17.6 Review question

If using session/conversation scope:

```text
What happens on scale-out?
What happens after pod restart?
Is sticky session required?
Is data serializable?
How is memory bounded?
How is logout/invalidation handled?
```

---

# 18. Normal Scope, Pseudo Scope, dan Proxy

## 18.1 Normal scope

Normal scoped beans are accessed through client proxy.

Examples:

```java
@ApplicationScoped
@RequestScoped
@SessionScoped
```

## 18.2 Pseudo scope

`@Dependent` is pseudo-scope; object is often injected directly.

## 18.3 Why proxy?

Proxy allows:

- lazy contextual resolution;
- request-scoped into app-scoped;
- lifecycle indirection;
- interceptors/decorators;
- serialization support in some contexts.

## 18.4 Proxy limitations

CDI proxy may have limitations depending spec/runtime:

- final class/method issues;
- private method not interceptable;
- constructor requirements;
- non-proxyable type errors.

## 18.5 Non-proxyable dependency

If CDI cannot proxy a normal scoped bean, deployment may fail.

Example risk:

```java
@ApplicationScoped
public final class FinalService {}
```

Depending runtime/proxy mechanism, final class may be problematic.

## 18.6 Avoid class equality assumption

Injected bean may be proxy:

```java
bean.getClass() != MyBean.class
```

Do not write logic depending on exact runtime class.

## 18.7 Use interfaces?

Interfaces can reduce proxy friction.

But do not create interface for every class blindly. Use where abstraction is meaningful.

---

# 19. Client Proxy dan Contextual Reference

## 19.1 Client proxy flow

```text
caller holds proxy
  ↓
method invoked
  ↓
proxy asks current context for actual instance
  ↓
actual method called
```

## 19.2 Why this matters

Request-scoped bean injected into application-scoped bean:

```java
@ApplicationScoped
class Logger {
    @Inject RequestInfo requestInfo;
}
```

`Logger` lives long, but `requestInfo` must change per request. Proxy makes that possible.

## 19.3 Context not active

If no request context active:

```java
requestInfo.userId()
```

may throw context error.

## 19.4 Caching proxy result

Do not cache actual request object in application scope.

Bad:

```java
@PostConstruct
void init() {
    cached = requestInfo; // proxy or invalid context
}
```

## 19.5 Equality/hashCode

Proxy can affect equality expectations.

Avoid using injected contextual proxies as map keys unless you understand behavior.

---

# 20. Injection Point: Constructor, Field, Method

CDI supports injection points based on `@Inject`.

## 20.1 Constructor injection recommended

```java
@ApplicationScoped
public class ApproveCaseUseCase {
    private final CaseRepository repository;

    @Inject
    public ApproveCaseUseCase(CaseRepository repository) {
        this.repository = repository;
    }
}
```

## 20.2 Field injection common but weaker

```java
@Inject
CaseRepository repository;
```

Acceptable for framework glue or legacy, but less testable.

## 20.3 Method injection

```java
@Inject
void configure(CaseRepository repository, AuditTrail auditTrail) { ... }
```

Use sparingly.

## 20.4 Injection point metadata

CDI allows advanced producers to inspect `InjectionPoint`.

Example:

```java
@Produces
Logger produceLogger(InjectionPoint ip) {
    return LoggerFactory.getLogger(ip.getMember().getDeclaringClass());
}
```

This is powerful but can become magical.

## 20.5 Avoid container in domain

Do not put CDI annotations in:

- entities;
- value objects;
- aggregates;
- pure domain services if they should remain framework-independent.

---

# 21. Producers: Membuat Bean dari Factory Method/Field

Producers allow you to expose objects as CDI beans.

## 21.1 Why producers?

Some objects cannot be discovered as beans directly:

- third-party classes;
- configuration-derived objects;
- resources;
- client objects;
- clocks;
- object mappers;
- data sources;
- strategies selected by config.

## 21.2 Producer method

```java
@ApplicationScoped
public class TimeProducer {

    @Produces
    @ApplicationScoped
    public Clock clock() {
        return Clock.systemUTC();
    }
}
```

Inject:

```java
@Inject
Clock clock;
```

## 21.3 Producer with qualifier

```java
@Produces
@SystemClock
@ApplicationScoped
Clock systemClock() {
    return Clock.systemUTC();
}
```

## 21.4 Producer for resource wrapper

```java
@ApplicationScoped
public class DataSourceProducer {

    @Resource(lookup = "jdbc/CaseDS")
    private DataSource ds;

    @Produces
    @CaseDatabase
    DataSource caseDataSource() {
        return ds;
    }
}
```

## 21.5 Producer can depend on injection

```java
@Produces
ObjectMapper objectMapper(AppJsonConfig config) {
    return JsonMapper.builder()
        .findAndAddModules()
        .build();
}
```

## 21.6 Producer scope

Producer method has its own scope semantics.

Be explicit:

```java
@Produces
@ApplicationScoped
ObjectMapper objectMapper() { ... }
```

Without explicit scope, may be dependent depending CDI rules.

## 21.7 Producer pitfalls

- creates new expensive object per injection/request unintentionally;
- returns mutable singleton not thread-safe;
- hides complex logic;
- no disposer for closable resource;
- config read dynamically without clarity;
- ambiguous producer and class bean.

## 21.8 Good producer principles

- keep producer simple;
- name/qualify clearly;
- set scope intentionally;
- add disposer for resource;
- test producer behavior;
- avoid business logic in producer.

---

# 22. Disposers: Cleanup untuk Produced Object

If producer creates resource needing cleanup, disposer handles destruction.

## 22.1 Example

```java
@ApplicationScoped
public class ClientProducer {

    @Produces
    @ApplicationScoped
    ExternalClient client() {
        return new ExternalClient(...);
    }

    void close(@Disposes ExternalClient client) {
        client.close();
    }
}
```

## 22.2 Why disposer matters

Without disposer:

- connection leak;
- thread leak;
- file handle leak;
- metrics exporter leak;
- HTTP client not closed;
- classloader leak on redeploy.

## 22.3 Scope matters

Disposer called when contextual instance destroyed.

Application-scoped produced object disposed at app shutdown.

Dependent object disposed with owning instance.

## 22.4 Disposer pitfalls

- disposer not matched due to qualifier mismatch;
- cleanup blocks too long;
- cleanup throws and hides other shutdown issues;
- relying on disposer for critical durable business action.

## 22.5 Checklist for producers

If producer returns:

- closeable;
- executor;
- client with threads;
- resource pool;
- native handle;
- cache;

then ask: where is disposer?

---

# 23. `Instance<T>`: Programmatic Lookup CDI

`Instance<T>` is CDI programmatic lookup type.

It extends `Iterable<T>` and allows selecting beans at runtime.

## 23.1 Basic example

```java
@Inject
Instance<NotificationSender> senders;

public void sendAll(Notification n) {
    for (NotificationSender sender : senders) {
        sender.send(n);
    }
}
```

## 23.2 Select by qualifier

```java
NotificationSender emailSender =
    senders.select(new EmailChannelLiteral()).get();
```

In real CDI, annotation literals are often needed for programmatic qualifier selection.

## 23.3 Optional availability

`Instance<T>` lets you check:

```java
if (instance.isResolvable()) { ... }
if (instance.isUnsatisfied()) { ... }
if (instance.isAmbiguous()) { ... }
```

depending CDI API version.

## 23.4 Difference from Provider

`Provider<T>` is from `jakarta.inject`, minimal.

`Instance<T>` is CDI-specific and richer.

## 23.5 Use cases

- optional plugins;
- selecting strategy by qualifier;
- iterating all handlers;
- lazy lookup;
- dynamic feature integration;
- avoiding direct hard dependency.

## 23.6 Risks

`Instance<T>` can become service locator.

Bad:

```java
@Inject
Instance<Object> everything;
```

Good:

```java
@Inject
@Any
Instance<CaseValidationRule> rules;
```

## 23.7 Design guideline

Use programmatic lookup when dependency set is legitimately dynamic.

For normal required dependencies, use constructor injection.

---

# 24. Alternatives, Specialization, dan Priority

## 24.1 Alternative

Alternative is bean not enabled by default unless selected/enabled.

Use for:

- environment-specific implementation;
- test implementation;
- alternative strategy;
- feature toggle at wiring level.

Example:

```java
@Alternative
@ApplicationScoped
public class InMemoryCaseRepository implements CaseRepository {}
```

## 24.2 Enabling alternative

Can be enabled via `beans.xml` or `@Priority` depending CDI rules.

## 24.3 Priority

`@Priority` can enable/order certain beans/interceptors/alternatives.

CDI 4.1 includes improvements such as support for `@Priority` on producer methods/fields.

## 24.4 Specialization

Specialization lets one bean specialize/replace another.

Use carefully.

## 24.5 Alternatives vs config strategy

Do not overuse alternatives for business conditions.

If behavior changes per request/domain, use strategy/policy in application logic.

If implementation changes per deployment environment, alternatives/config may be appropriate.

## 24.6 Production risk

Wrong alternative enabled in production can be catastrophic.

Example:

```text
InMemoryPaymentGateway active in prod
```

## 24.7 Checklist

- alternative clearly named;
- enabled explicitly;
- production profile tested;
- integration test verifies active bean;
- no test alternative packaged accidentally.

---

# 25. Stereotypes

Stereotype groups annotations.

## 25.1 Why stereotypes?

To avoid repeating multiple annotations.

Example conceptual:

```java
@Stereotype
@ApplicationScoped
@Transactional
@Retention(RUNTIME)
@Target(TYPE)
public @interface UseCase {}
```

Then:

```java
@UseCase
public class ApproveCaseUseCase { ... }
```

## 25.2 Benefit

- standardize layer conventions;
- reduce boilerplate;
- encode architecture semantics.

## 25.3 Risk

- hides behavior;
- creates magic annotations;
- over-abstracts;
- makes code harder for newcomers.

## 25.4 Use case

Stereotype can be useful for:

- application service marker;
- adapter marker;
- domain event handler;
- command handler;
- policy component.

## 25.5 Rule

Use stereotype only if it improves clarity.

If engineer must inspect stereotype definition constantly, it may reduce clarity.

---

# 26. Interceptors di CDI

Interceptors apply cross-cutting behavior.

## 26.1 Use cases

- audit;
- logging;
- metrics;
- transaction-like behavior;
- security checks;
- retry;
- rate limit;
- validation;
- tracing.

## 26.2 Interceptor binding

Define binding:

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface Audited {}
```

Apply:

```java
@Audited
public void approve(...) { ... }
```

Interceptor:

```java
@Audited
@Interceptor
@Priority(Interceptor.Priority.APPLICATION)
public class AuditInterceptor {
    @AroundInvoke
    Object around(InvocationContext ctx) throws Exception {
        ...
        return ctx.proceed();
    }
}
```

## 26.3 Interceptor chain

Multiple interceptors can apply. Ordering matters.

## 26.4 Self-invocation problem

If method call does not go through interceptor/proxy, interceptor may not run.

```java
public void outer() {
    inner(); // may bypass interceptor
}

@Audited
public void inner() {}
```

## 26.5 Interceptor risks

- hidden side effects;
- exception handling confusion;
- performance overhead;
- ordering bugs;
- transactional interaction;
- recursive logging;
- security bypass if not invoked.

## 26.6 Best practice

Use interceptors for true cross-cutting concerns, not business rules.

Business rules belong in domain/application logic.

---

# 27. Decorators di CDI

Decorator wraps a bean of same type to add behavior.

## 27.1 Interceptor vs decorator

Interceptor:

```text
cross-cutting around method invocation, often annotation-based
```

Decorator:

```text
type-specific behavior wrapping/delegation
```

## 27.2 Example

```java
public interface NotificationSender {
    void send(Notification n);
}
```

Decorator could add audit around sender.

```java
@Decorator
public abstract class AuditingNotificationSender implements NotificationSender {

    @Inject
    @Delegate
    NotificationSender delegate;

    @Override
    public void send(Notification n) {
        audit(n);
        delegate.send(n);
    }
}
```

## 27.3 Use cases

- add behavior to specific interface;
- enrich external client;
- wrap repository;
- add metrics to port implementation.

## 27.4 Risks

- hidden stack;
- ordering if multiple decorators;
- recursion if delegate wrong;
- performance overhead;
- debugging complexity.

## 27.5 Guideline

Use decorators when type-specific wrapping is clearer than interceptor.

---

# 28. CDI Events

CDI events allow decoupled in-process communication.

## 28.1 Basic example

Event:

```java
public record CaseApproved(CaseId caseId, Instant occurredAt) {}
```

Producer:

```java
@Inject
Event<CaseApproved> caseApprovedEvent;

public void approve(...) {
    ...
    caseApprovedEvent.fire(new CaseApproved(id, clock.instant()));
}
```

Observer:

```java
public void onCaseApproved(@Observes CaseApproved event) {
    ...
}
```

## 28.2 In-process event

CDI events are in-process, not distributed messaging.

They do not replace Kafka/JMS/outbox.

## 28.3 Use cases

- decouple internal components;
- local cache invalidation;
- local audit hook;
- UI/session notification;
- extension integration.

## 28.4 Risks

- hidden side effects;
- ordering assumptions;
- exception propagation;
- transaction boundary confusion;
- test invisibility;
- not durable.

## 28.5 Domain event vs CDI event

Domain event is business fact:

```text
CaseApproved
```

CDI event is in-process mechanism to notify observers.

You can publish domain event via CDI event, but do not confuse mechanism with concept.

For durable integration, use outbox/message broker.

---

# 29. Observer Method, Transactional Observer, Async Event

## 29.1 Observer method

```java
void onApproved(@Observes CaseApproved event) { ... }
```

Called when event fired.

## 29.2 Transactional observer

CDI supports transactional observer phases in environments with transaction integration.

Example conceptual:

```java
void afterSuccess(@Observes(during = TransactionPhase.AFTER_SUCCESS) CaseApproved event) { ... }
```

Use to run observer after successful transaction.

## 29.3 Why transactional observer matters?

If event observer sends email before transaction commits, transaction rollback causes inconsistency.

Better:

```text
transaction commits
  → after success observer runs
```

But for durable messaging, outbox is still safer.

## 29.4 Async event

CDI supports asynchronous events.

```java
event.fireAsync(new CaseApproved(...));
```

Consider:

- executor;
- error handling;
- transaction context;
- ordering;
- backpressure;
- shutdown;
- observability.

## 29.5 Observer anti-pattern

Bad:

```java
@Observes CaseApproved
void doCriticalExternalSideEffect(...) { sendRegulatoryMessage(); }
```

If critical/durable, use outbox.

## 29.6 Event testing

Test:

- observer called;
- observer exception behavior;
- transaction phase;
- no hidden critical side effect;
- idempotency if event can fire twice.

---

# 30. Portable Extensions dan Build Compatible Extensions

## 30.1 Portable Extension

CDI Full has portable extensions allowing frameworks/libraries to interact with container bootstrap.

Use cases:

- register beans dynamically;
- inspect annotated types;
- add qualifiers;
- integrate framework;
- custom scopes;
- validation/metadata processing.

## 30.2 Power and risk

Extensions are powerful but can make application behavior hard to understand.

Risk:

- hidden beans;
- startup overhead;
- compatibility issue;
- CDI version coupling;
- reflection-heavy behavior;
- runtime-specific differences.

## 30.3 Build Compatible Extensions

Build Compatible Extensions are introduced for build-time friendly CDI model.

Useful for:

- AOT;
- native-image;
- cloud runtimes;
- lower startup overhead.

## 30.4 Application engineer perspective

Most application developers should not write extensions casually.

But you should know extensions exist because frameworks may use them.

## 30.5 Review question

If a library adds CDI extension:

```text
What beans does it register?
What annotations does it process?
Does it work in CDI Lite?
Does it affect startup?
Does it use reflection?
Does it work in native/AOT?
```

---

# 31. CDI dan Jakarta EE Integration

## 31.1 CDI integrated with platform

In Jakarta EE, CDI integrates with:

- REST resources;
- Servlet components;
- Bean Validation;
- Transactions;
- Security;
- Persistence;
- WebSocket;
- Batch;
- Messaging;
- EJB in legacy/full stack;
- JSON providers through runtime.

Integration details are specified by Jakarta EE Platform/Web/Core Profiles and individual specs.

## 31.2 Resource injection and CDI

CDI can inject beans; `@Resource` injects resources.

You can bridge resources to CDI with producers.

## 31.3 Transaction

CDI interceptors can integrate transaction behavior, e.g. `@Transactional` from Jakarta Transactions.

Method invocation must go through managed container/interceptor boundary.

## 31.4 Security

Security context can be available to CDI beans through platform integration.

But domain authorization should not be only role annotation.

## 31.5 Validation

Method validation and REST input validation can work with CDI-managed components depending runtime integration.

## 31.6 Persistence

Repositories can be CDI beans with injected `EntityManager`/datasource depending target stack.

---

# 32. CDI dalam JAX-RS, Servlet, JPA, Transaction, Security

## 32.1 JAX-RS resource as CDI bean

```java
@Path("/cases")
@RequestScoped
public class CaseResource {
    private final ApproveCaseUseCase approve;

    @Inject
    public CaseResource(ApproveCaseUseCase approve) {
        this.approve = approve;
    }
}
```

## 32.2 Servlet filter with CDI

Some runtimes support CDI injection in filters/listeners depending integration.

Test in target runtime.

## 32.3 JPA repository bean

```java
@ApplicationScoped
public class JpaCaseRepository implements CaseRepository {
    @PersistenceContext
    EntityManager em;
}
```

## 32.4 Transactional use case

```java
@ApplicationScoped
public class ApproveCaseUseCase {
    @Transactional
    public void handle(Command c) { ... }
}
```

Remember proxy/interceptor boundary.

## 32.5 Security

```java
@RolesAllowed("OFFICER")
public void approve(...) { ... }
```

But combine with domain policy.

## 32.6 Common pitfall

```java
var service = new ApproveCaseUseCase(...);
```

Manual object bypasses CDI/transaction/security/interceptor.

---

# 33. CDI dan Cloud-Native Runtime

## 33.1 Build-time DI

Modern runtimes often process CDI metadata at build time.

Benefits:

- faster startup;
- less reflection;
- lower memory;
- native-image support;
- fail-fast build validation.

## 33.2 CDI Lite relevance

CDI Lite is suitable for such runtimes.

## 33.3 Limitations

Some dynamic CDI Full features may not be supported.

Before using:

- portable extensions;
- decorators;
- complex producer/observer behavior;
- dynamic lookup;
- runtime classpath scanning;

check runtime support.

## 33.4 Native/AOT concern

Reflection/proxy/serialization may need configuration or build-time model.

Prefer:

- explicit beans;
- constructor injection;
- no dynamic classloading;
- minimal reflection;
- stable dependency graph.

## 33.5 Cloud operational concern

CDI startup/discovery affects:

- pod startup;
- readiness;
- memory;
- CPU;
- cold start;
- deployment rollout.

Measure.

---

# 34. Design Guidelines: Menggunakan CDI Tanpa Mengacaukan Architecture

## 34.1 Keep domain pure

Domain:

```java
public final class EnforcementCase { ... }
public record CaseId(String value) {}
public interface ApprovalPolicy { ... }
```

No CDI annotations.

## 34.2 Use CDI in application/infrastructure layers

Application service:

```java
@ApplicationScoped
public class ApproveCaseUseCase { ... }
```

Infrastructure:

```java
@ApplicationScoped
public class JpaCaseRepository implements CaseRepository { ... }
```

API:

```java
@Path("/cases")
@RequestScoped
public class CaseResource { ... }
```

## 34.3 Constructor injection by default

Make dependency graph visible.

## 34.4 Use qualifiers for semantic difference

```java
@ReadReplica
@PrimaryDatabase
@AuditPublisher
```

## 34.5 Avoid business logic in producers

Producer configures object creation, not business decision.

## 34.6 Avoid hidden event side effects

If CDI events cause side effects, document and test them.

For critical cross-service side effects, use outbox.

## 34.7 Scope intentionally

- services: application scoped, stateless;
- request metadata: request scoped;
- helpers: dependent if simple;
- session: only if UI/session architecture needs it;
- caches: application scoped but bounded.

## 34.8 Keep container at boundaries

CDI should wire architecture, not replace architecture.

---

# 35. Testing Strategy

## 35.1 Unit test without CDI

Constructor injection enables:

```java
var useCase = new ApproveCaseUseCase(fakeRepo, fakeAudit, clock);
```

Do this for domain/application behavior.

## 35.2 CDI integration test

Use runtime/container test to verify:

- bean discovery;
- injection;
- qualifiers;
- producers;
- observers;
- interceptors;
- transactions;
- scopes.

## 35.3 Test producer/disposer

If producer creates resource, test cleanup.

## 35.4 Test alternatives

Ensure production does not use test alternative.

## 35.5 Test CDI events

Test observer side effects explicitly.

Avoid surprises:

```text
approving case unexpectedly sends email in unit test
```

## 35.6 Test scopes

Test:

- request scoped instance differs per request;
- application scoped instance shared;
- context not active behavior.

## 35.7 Bootstrap failure test

A CDI bootstrap test catches unsatisfied/ambiguous dependencies before deployment.

## 35.8 Architecture test

Use ArchUnit-like rules conceptually:

- domain does not depend on `jakarta.enterprise`;
- application layer has constructor injection;
- no field injection in use cases;
- no circular package dependency.

---

# 36. Performance dan Startup Considerations

## 36.1 CDI startup cost

Startup includes:

- class scanning;
- annotation processing;
- bean discovery;
- typesafe resolution;
- proxy generation;
- extension execution;
- validation.

## 36.2 Reduce cost

- use `annotated` discovery;
- avoid giant classpath;
- remove unused dependencies;
- explicit bean-defining annotations;
- prefer build-time processing runtime if needed;
- avoid heavy producer initialization;
- avoid heavy `@PostConstruct`;
- avoid unnecessary extensions.

## 36.3 Proxy invocation overhead

Normally small, but can matter in extremely hot loops.

Avoid CDI bean method calls in per-item tight loop for millions of iterations if plain object/function is better.

## 36.4 Dynamic lookup cost

`Instance<T>.select().get()` repeatedly can be more expensive than direct injection.

Cache selected strategy if safe and scope permits.

## 36.5 JFR profiling

Use JFR for:

- startup CPU;
- classloading;
- allocation;
- proxy generation;
- reflection;
- lock contention.

## 36.6 Measure, don't guess

Do not disable CDI features blindly. Measure bottleneck.

---

# 37. Production Failure Modes

## 37.1 Unsatisfied dependency

Symptoms:

```text
Unsatisfied dependency for type ...
```

Causes:

- bean not discovered;
- missing scope annotation;
- wrong module/archive;
- dependency missing;
- qualifier mismatch;
- condition disabled.

## 37.2 Ambiguous dependency

Symptoms:

```text
Ambiguous dependency for type ...
```

Causes:

- multiple implementations;
- producer + class;
- library adds bean;
- missing qualifier.

## 37.3 Context not active

Symptoms:

```text
ContextNotActiveException
```

Causes:

- request-scoped bean used in background thread;
- async event;
- scheduled job;
- application startup;
- missing context propagation.

## 37.4 Non-proxyable bean

Symptoms:

```text
Unproxyable type
```

Causes:

- final class;
- final method;
- no suitable constructor;
- primitive/array/special type;
- private class.

## 37.5 Circular dependency

Symptoms:

- deployment failure;
- stack overflow;
- proxy workaround hides design smell.

## 37.6 Wrong alternative active

Symptoms:

- in-memory/test implementation in production;
- mock client used accidentally;
- no real side effect.

## 37.7 Event side effect surprise

Symptoms:

- action triggers unexpected email/audit/cache update;
- observer exception breaks use case;
- transactional timing wrong.

## 37.8 Producer resource leak

Symptoms:

- thread leak;
- connection leak;
- redeploy memory leak;
- client not closed.

## 37.9 Startup slow

Causes:

- discovery mode all;
- huge classpath;
- extensions;
- heavy producers;
- `@PostConstruct` database work;
- runtime not build-time optimized.

---

# 38. Debugging Playbook

## 38.1 Check bean discovery

Ask:

```text
Is this class a bean?
Does it have bean-defining annotation?
Is archive discovered?
What is beans.xml mode?
```

## 38.2 Check qualifiers

List:

```text
injection type
injection qualifiers
candidate bean types
candidate bean qualifiers
```

## 38.3 Check scope/context

Ask:

```text
What scope?
Is context active?
Is injected reference proxy?
Where is method called?
```

## 38.4 Check proxy

If interceptor not running:

- is method public/proxyable?
- is call self-invocation?
- is bean managed?
- is annotation binding correct?
- is interceptor enabled?
- is priority/order correct?

## 38.5 Check producer

- producer method discovered?
- producer scope?
- producer qualifiers?
- duplicate class bean?
- disposer exists?
- producer throws exception?

## 38.6 Check events

- event type exact?
- qualifiers?
- synchronous/async?
- observer enabled?
- transaction phase?
- exception propagation?

## 38.7 Check runtime logs

CDI runtimes often log deployment validation errors clearly. Read full deployment log, not only final exception.

## 38.8 Minimal reproduction

Create tiny CDI test:

```java
@ApplicationScoped
public class A {
    @Inject B b;
}

@ApplicationScoped
public class B {}
```

If simple injection fails, runtime/discovery config issue.

---

# 39. Best Practices dan Anti-Patterns

## 39.1 Best practices

- Use constructor injection for application services.
- Use explicit scopes.
- Prefer `annotated` discovery.
- Use qualifiers for multiple implementations.
- Keep domain model CDI-free.
- Use producers for third-party/resource objects.
- Add disposers for closable resources.
- Avoid hidden side effects in observers.
- Use events for in-process decoupling, not durable messaging.
- Test CDI wiring in container.
- Document alternatives and active profiles.
- Measure startup/performance.

## 39.2 Anti-pattern: Field injection everywhere

Hides dependency graph and hurts unit tests.

## 39.3 Anti-pattern: Domain entity as CDI bean

Domain object should not depend on container lifecycle.

## 39.4 Anti-pattern: `Instance<Object>` as service locator

Turns CDI into dynamic registry.

## 39.5 Anti-pattern: Full discovery mode for everything

Can create unexpected beans and slow startup.

## 39.6 Anti-pattern: Business workflow in observer

Critical business side effect hidden in observer makes flow hard to reason about.

## 39.7 Anti-pattern: Producer doing business logic

Producer should construct/configure dependencies, not decide business policy.

## 39.8 Anti-pattern: Request data in application singleton

Causes data leak/cross-request contamination.

## 39.9 Anti-pattern: Relying on CDI event for distributed integration

Use message broker/outbox for durable integration.

---

# 40. Checklist Review CDI

## 40.1 Bean discovery

- [ ] Does each bean have clear bean-defining annotation?
- [ ] Is `beans.xml` mode understood?
- [ ] Any accidental library beans?
- [ ] Any package/module excluded?

## 40.2 Injection

- [ ] Constructor injection used for required dependencies?
- [ ] No field injection in core use cases?
- [ ] No unsatisfied/ambiguous dependencies?
- [ ] Qualifiers clear?
- [ ] No circular dependencies?

## 40.3 Scope

- [ ] Scope chosen intentionally?
- [ ] Application-scoped beans stateless/thread-safe?
- [ ] Request-scoped beans not used outside request?
- [ ] Session scope justified?
- [ ] Dependent resources cleaned?

## 40.4 Producers/disposers

- [ ] Producer scope explicit?
- [ ] Producer simple?
- [ ] Qualifiers correct?
- [ ] Closable resource has disposer?
- [ ] No duplicate producer/class bean ambiguity?

## 40.5 Events

- [ ] Event is in-process only?
- [ ] Critical side effects durable elsewhere?
- [ ] Observer exception behavior understood?
- [ ] Transaction phase correct?
- [ ] Async event has executor/error strategy?

## 40.6 Interceptors/decorators

- [ ] Binding clear?
- [ ] Order clear?
- [ ] Self-invocation avoided?
- [ ] Not hiding business logic?
- [ ] Performance acceptable?

## 40.7 Runtime

- [ ] CDI Lite vs Full support checked?
- [ ] Runtime/profile supports features used?
- [ ] Startup measured?
- [ ] Native/AOT constraints considered if relevant?
- [ ] Deployment logs clean?

---

# 41. Latihan Bertahap

## Latihan 1 — Bean discovery

Buat class tanpa scope annotation. Coba inject. Tambahkan `@ApplicationScoped`. Bandingkan.

## Latihan 2 — `beans.xml`

Buat `beans.xml` dengan:

```xml
bean-discovery-mode="annotated"
```

Lalu coba mode `all` dan lihat perbedaannya.

## Latihan 3 — Qualifier ambiguity

Buat dua `CaseRepository`. Observe ambiguous dependency. Fix dengan qualifier.

## Latihan 4 — Scope behavior

Buat `@RequestScoped` bean dengan UUID instance. Panggil endpoint beberapa kali.

## Latihan 5 — Application scope thread safety

Buat mutable field di `@ApplicationScoped` bean. Simulasikan concurrent requests. Fix.

## Latihan 6 — Producer

Produce `Clock` dan `ObjectMapper`. Inject ke service.

## Latihan 7 — Disposer

Produce closable HTTP client. Pastikan disposer dipanggil saat shutdown.

## Latihan 8 — Instance lookup

Buat beberapa `CaseValidationRule`. Inject `Instance<CaseValidationRule>` dan iterasi semua rules.

## Latihan 9 — CDI event

Fire `CaseApproved` event. Buat observer audit lokal. Uji exception behavior.

## Latihan 10 — Interceptor

Buat `@Audited` interceptor. Test bahwa self-invocation tidak menjalankan interceptor.

## Latihan 11 — Alternative

Buat production repository dan in-memory repository sebagai alternative. Pastikan environment test/prod benar.

## Latihan 12 — CDI Lite compatibility

Ambil runtime CDI Lite. Coba fitur CDI Full. Catat yang tidak tersedia.

---

# 42. Mini Project: CDI Mastery Lab

## 42.1 Goal

Buat repository:

```text
jakarta-cdi-mastery-lab/
```

## 42.2 Modules

```text
01-bean-discovery/
02-qualifiers/
03-scopes/
04-producers-disposers/
05-instance-lookup/
06-events/
07-interceptors/
08-decorators/
09-alternatives/
10-lite-vs-full/
```

## 42.3 Required docs

```text
README.md
BEAN-DISCOVERY.md
SCOPE-MATRIX.md
QUALIFIER-MATRIX.md
PRODUCER-DISPOSER.md
EVENT-FLOW.md
INTERCEPTOR-NOTES.md
CDI-LITE-FULL-COMPATIBILITY.md
FAILURE-MODES.md
```

## 42.4 Required experiments

1. Unsatisfied dependency.
2. Ambiguous dependency.
3. Qualifier resolution.
4. Request scope active/inactive.
5. Application scope thread safety issue.
6. Non-proxyable bean.
7. Producer scope mistake.
8. Missing disposer leak.
9. CDI event hidden side effect.
10. Self-invocation interceptor problem.
11. Wrong alternative active.
12. CDI Lite feature limitation.

## 42.5 Evaluation questions

1. What makes a class a CDI bean?
2. What is the difference between bean type and implementation class?
3. What is a qualifier?
4. What is the difference between `@Default` and `@Any`?
5. What is a normal scope?
6. Why does CDI use proxies?
7. Why can request-scoped bean be injected into application-scoped bean?
8. When does context not active happen?
9. What is a producer?
10. When do you need a disposer?
11. How is `Instance<T>` different from `Provider<T>`?
12. Why are CDI events not a message broker?
13. When should you use alternatives?
14. What breaks in CDI Lite?
15. How do you debug ambiguous dependencies?

---

# 43. Referensi Resmi

Referensi utama:

1. Jakarta Contexts and Dependency Injection 4.1  
   https://jakarta.ee/specifications/cdi/4.1/

2. Jakarta CDI 4.1 Specification  
   https://jakarta.ee/specifications/cdi/4.1/jakarta-cdi-spec-4.1

3. Jakarta CDI 4.1 API Docs  
   https://jakarta.ee/specifications/cdi/4.1/apidocs/

4. Jakarta EE Tutorial — Introduction to CDI  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/cdi/cdi-basic/cdi-basic.html

5. Jakarta EE Tutorial — CDI Advanced Topics  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/cdi/cdi-adv/cdi-adv.html

6. Jakarta EE Tutorial — Dependency Injection  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/platform/injection/injection.html

7. Jakarta EE Core Profile 11 Specification  
   https://jakarta.ee/specifications/coreprofile/11/jakarta-coreprofile-spec-11.0

8. Jakarta CDI 4.0 Specification Notes  
   https://jakarta.ee/specifications/cdi/4.0/

9. Jakarta CDI Blog — What's New in CDI 4.1  
   https://jakartaee.github.io/cdi/2024/02/27/whats-new-in-cdi41.html

10. CDI Project Site  
    https://www.cdi-spec.org/

---

# Penutup

CDI adalah salah satu jantung Jakarta EE.

Jika `jakarta.inject` memberi vocabulary minimal:

```text
@Inject
@Qualifier
Provider<T>
```

maka CDI memberi runtime model lengkap:

```text
bean discovery
typesafe resolution
scopes
contexts
proxies
producers
disposers
events
interceptors
decorators
extensions
```

Mental model paling penting:

> CDI bukan sekadar dependency injection. CDI adalah contextual component model.

Engineer yang kuat tidak hanya bisa menulis:

```java
@Inject
MyService service;
```

Ia tahu:

```text
apakah MyService adalah bean
bagaimana bean ditemukan
scope apa yang dipakai
qualifier apa yang aktif
apakah reference itu proxy
apakah context sedang aktif
apakah method melewati interceptor
apakah producer punya disposer
apakah event synchronous/durable
apakah runtime CDI Lite atau Full
```

Dengan pemahaman ini, kamu bisa memakai CDI sebagai alat architecture yang powerful, bukan sumber magic yang sulit ditebak.

Bagian berikutnya akan membahas **Interceptors dan Decorators** secara lebih mendalam: bagaimana cross-cutting concern dibuat, bagaimana invocation chain berjalan, bagaimana ordering bekerja, bagaimana self-invocation menjadi bug, dan bagaimana membedakan interceptor/decorator dari business logic biasa.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jakarta-part-006.md">⬅️ Bagian 6 — `jakarta.inject`: Dependency Injection Minimal</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-java-jakarta-part-008.md">Bagian 8 — Jakarta Interceptors dan CDI Decorators ➡️</a>
</div>
