# learn-java-jakarta-part-006.md

# Bagian 6 — `jakarta.inject`: Dependency Injection Minimal

> Target pembaca: Java engineer yang ingin memahami `jakarta.inject` secara mendalam: bukan hanya “pakai `@Inject`”, tetapi memahami kontrak minimal dependency injection, bagaimana ia berbeda dari CDI penuh, apa yang dijanjikan dan tidak dijanjikan oleh specification, bagaimana container melakukan resolution, kapan memakai constructor/field/method injection, bagaimana qualifier bekerja, bagaimana `Provider<T>` membantu lazy lookup/circular dependency, dan bagaimana mendesain dependency graph yang maintainable.
>
> Fokus bagian ini: `jakarta.inject` sebagai **minimal portable annotation set** untuk dependency injection, dan bagaimana ia menjadi fondasi CDI/Jakarta EE serta juga dipahami oleh banyak framework lain.

---

## Daftar Isi

1. [Orientasi: Kenapa `jakarta.inject` Penting?](#1-orientasi-kenapa-jakartainject-penting)
2. [Mental Model: DI API Minimal vs DI Container](#2-mental-model-di-api-minimal-vs-di-container)
3. [Sejarah: JSR-330, `javax.inject`, dan `jakarta.inject`](#3-sejarah-jsr-330-javaxinject-dan-jakartainject)
4. [Jakarta Dependency Injection 2.0](#4-jakarta-dependency-injection-20)
5. [Dependency dan Packaging](#5-dependency-dan-packaging)
6. [Peta API `jakarta.inject`](#6-peta-api-jakartainject)
7. [`@Inject`: Titik Masuk Dependency Injection](#7-inject-titik-masuk-dependency-injection)
8. [Constructor Injection](#8-constructor-injection)
9. [Field Injection](#9-field-injection)
10. [Method Injection / Initializer Method](#10-method-injection--initializer-method)
11. [`@Qualifier`: Menghindari Ambiguity](#11-qualifier-menghindari-ambiguity)
12. [`@Named`: String-Based Qualifier](#12-named-string-based-qualifier)
13. [`Provider<T>`: Lazy Lookup, Multiple Instances, dan Circular Dependency](#13-providert-lazy-lookup-multiple-instances-dan-circular-dependency)
14. [`@Scope` dan Scope Annotation](#14-scope-dan-scope-annotation)
15. [`@Singleton`: Scope Minimal](#15-singleton-scope-minimal)
16. [Injection Resolution: Apa yang Dijanjikan `jakarta.inject` dan Apa yang Tidak](#16-injection-resolution-apa-yang-dijanjikan-jakartainject-dan-apa-yang-tidak)
17. [Lifecycle: Apa yang Tidak Ada di `jakarta.inject`](#17-lifecycle-apa-yang-tidak-ada-di-jakartainject)
18. [`jakarta.inject` vs CDI](#18-jakartainject-vs-cdi)
19. [`jakarta.inject` vs Spring DI](#19-jakartainject-vs-spring-di)
20. [`jakarta.inject` vs Service Locator, Factory, dan Manual Wiring](#20-jakartainject-vs-service-locator-factory-dan-manual-wiring)
21. [Dependency Graph Design](#21-dependency-graph-design)
22. [Layering dan Dependency Direction](#22-layering-dan-dependency-direction)
23. [Circular Dependency](#23-circular-dependency)
24. [Optional Dependency dan Conditional Dependency](#24-optional-dependency-dan-conditional-dependency)
25. [Testing Strategy](#25-testing-strategy)
26. [Performance dan Startup Considerations](#26-performance-dan-startup-considerations)
27. [Production Failure Modes](#27-production-failure-modes)
28. [Best Practices dan Anti-Patterns](#28-best-practices-dan-anti-patterns)
29. [Checklist Review](#29-checklist-review)
30. [Latihan Bertahap](#30-latihan-bertahap)
31. [Mini Project: Minimal DI Container](#31-mini-project-minimal-di-container)
32. [Referensi Resmi](#32-referensi-resmi)

---

# 1. Orientasi: Kenapa `jakarta.inject` Penting?

Dalam aplikasi enterprise, object jarang berdiri sendiri.

Contoh:

```java
public final class EscalateCaseUseCase {
    private final CaseRepository repository;
    private final EscalationPolicy policy;
    private final AuditTrail auditTrail;
    private final Clock clock;

    public EscalateCaseUseCase(
            CaseRepository repository,
            EscalationPolicy policy,
            AuditTrail auditTrail,
            Clock clock
    ) {
        this.repository = repository;
        this.policy = policy;
        this.auditTrail = auditTrail;
        this.clock = clock;
    }
}
```

Object ini punya dependencies.

Tanpa dependency injection, kamu punya beberapa pilihan:

1. membuat dependency sendiri di dalam class;
2. memakai global/static singleton;
3. memakai service locator;
4. memakai factory manual;
5. memakai DI container.

Pilihan 1 buruk untuk testability:

```java
public class EscalateCaseUseCase {
    private final CaseRepository repository = new JpaCaseRepository();
}
```

Sekarang use case tergantung langsung pada implementation.

Pilihan 2 buruk untuk global state:

```java
CaseRepository repository = GlobalRegistry.get(CaseRepository.class);
```

Pilihan 3 service locator menyembunyikan dependency.

Pilihan 4 factory manual bisa bagus untuk aplikasi kecil, tetapi membesar saat dependency graph kompleks.

DI container membuat dependency graph dikelola secara deklaratif:

```java
public class EscalateCaseUseCase {
    private final CaseRepository repository;
    private final EscalationPolicy policy;

    @Inject
    public EscalateCaseUseCase(CaseRepository repository, EscalationPolicy policy) {
        this.repository = repository;
        this.policy = policy;
    }
}
```

## 1.1 Apa masalah yang diselesaikan DI?

Dependency Injection membantu:

- loose coupling;
- testability;
- replaceability;
- configuration flexibility;
- lifecycle management;
- separation of construction and behavior;
- explicit dependency graph;
- easier integration with runtime/container.

## 1.2 Kenapa ada `jakarta.inject`?

Karena banyak framework/container butuh annotation umum untuk menandai injection point.

`jakarta.inject` menyediakan set minimal annotation:

- `@Inject`;
- `@Qualifier`;
- `@Named`;
- `Provider<T>`;
- `@Scope`;
- `@Singleton`.

Ia tidak mencoba menjadi full DI framework. Ia hanya menyediakan vocabulary standar.

## 1.3 `jakarta.inject` adalah fondasi, bukan keseluruhan rumah

`jakarta.inject` seperti bahasa minimum:

```text
this constructor/field/method needs injection
this annotation is a qualifier
this dependency has a name
this provider can provide instances
this annotation is a scope
this class is singleton-scoped
```

Tetapi pertanyaan seperti:

```text
Bagaimana bean ditemukan?
Bagaimana ambiguity diselesaikan?
Apa lifecycle scope request/session/application?
Bagaimana proxy dibuat?
Bagaimana producer method bekerja?
Bagaimana event CDI bekerja?
Bagaimana alternative dipilih?
Bagaimana interceptor aktif?
```

itu bukan `jakarta.inject` minimal. Itu dibahas oleh CDI/container/framework.

---

# 2. Mental Model: DI API Minimal vs DI Container

## 2.1 DI API minimal

DI API minimal hanya mendefinisikan annotation dan interface.

Contoh:

```java
@Inject
private CaseService service;
```

Annotation ini memberi sinyal:

```text
This member is injectable.
```

Namun siapa yang melakukan injection?

```text
Injector/container/framework.
```

## 2.2 DI container

DI container bertanggung jawab untuk:

- menemukan bean/component;
- membuat object;
- memilih constructor;
- menyelesaikan dependency;
- mengelola scope;
- membuat proxy jika perlu;
- menangani qualifier;
- mendeteksi ambiguity;
- menangani lifecycle;
- menghancurkan object;
- menyediakan extension points.

`jakarta.inject` tidak mendefinisikan semua detail ini.

## 2.3 Analogi

`jakarta.inject` seperti colokan listrik standar.

DI container seperti jaringan listrik di gedung.

Colokan standar membuat perangkat bisa dipasang, tetapi listrik hanya mengalir jika ada sistem di baliknya.

## 2.4 Contoh tanpa container

```java
public class MyService {
    @Inject
    Repository repository;
}

var service = new MyService();
System.out.println(service.repository); // null
```

`@Inject` tidak melakukan apa pun jika tidak ada injector.

## 2.5 Contoh dengan container

```text
container sees MyService
  ↓
finds field annotated @Inject
  ↓
resolves Repository bean
  ↓
sets field
  ↓
MyService ready
```

## 2.6 Golden rule

> `jakarta.inject` describes injection points; an injector/container performs injection.

---

# 3. Sejarah: JSR-330, `javax.inject`, dan `jakarta.inject`

## 3.1 JSR-330

Sebelum Jakarta namespace, Java punya JSR-330: Dependency Injection for Java.

Package lama:

```java
javax.inject
```

Banyak framework mendukungnya:

- CDI;
- Guice;
- Spring;
- HK2;
- Dagger-like ecosystems;
- custom DI containers.

## 3.2 `javax.inject` ke `jakarta.inject`

Dengan Jakarta namespace migration, API berpindah menjadi:

```java
jakarta.inject
```

Old:

```java
import javax.inject.Inject;
```

New:

```java
import jakarta.inject.Inject;
```

## 3.3 Binary/source incompatibility

`javax.inject.Inject` dan `jakarta.inject.Inject` adalah class berbeda.

Library yang compiled dengan `javax.inject` tidak otomatis kompatibel dengan runtime yang mengharapkan `jakarta.inject`.

## 3.4 Jakarta Dependency Injection 2.0

Jakarta Dependency Injection 2.0 adalah release untuk Jakarta EE 9 dan menggunakan namespace `jakarta.inject`.

## 3.5 Jakarta EE 11 context

Jakarta EE 11 tetap memakai `jakarta.inject` API sebagai bagian dari platform/profile ecosystem. CDI 4.1 adalah spec DI/container yang lebih lengkap untuk Jakarta EE 11.

---

# 4. Jakarta Dependency Injection 2.0

Jakarta Dependency Injection mendefinisikan means untuk memperoleh objects dengan cara yang meningkatkan reusability, testability, dan maintainability dibanding constructors/factories/service locators tradisional.

## 4.1 Minimal API

Package:

```java
jakarta.inject
```

Core elements:

```text
@Inject
@Qualifier
@Named
Provider<T>
@Scope
@Singleton
```

## 4.2 Apa yang tidak didefinisikan secara penuh?

`jakarta.inject` tidak mendefinisikan seluruh behavior CDI.

Ia tidak secara lengkap mendefinisikan:

- bean discovery model;
- contextual scopes seperti request/session;
- producer methods;
- CDI events;
- interceptors;
- decorators;
- alternatives;
- portable extensions;
- build-compatible extensions;
- transaction integration;
- security integration;
- JAX-RS integration.

## 4.3 Package summary

API docs menyatakan package ini menyediakan dependency injection annotations yang memungkinkan portable classes, tetapi external dependency configuration diserahkan pada injector.

Ini kalimat penting.

Artinya:

```text
jakarta.inject gives portable annotations,
but injector/container decides configuration/resolution details.
```

## 4.4 Practical interpretation

Jika kamu menulis library:

```java
public final class CaseExporter {
    @Inject
    public CaseExporter(Clock clock) { ... }
}
```

Library ini bisa dipakai di CDI/Spring/Guice-like container yang memahami `jakarta.inject`, tetapi behavior detail akan bergantung injector tersebut.

---

# 5. Dependency dan Packaging

## 5.1 Maven dependency

Individual dependency:

```xml
<dependency>
  <groupId>jakarta.inject</groupId>
  <artifactId>jakarta.inject-api</artifactId>
  <version>2.0.1</version>
</dependency>
```

## 5.2 Dalam Jakarta EE runtime

Biasanya sudah tercakup melalui Platform/Web/Core API:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-core-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

atau Web/Profile/Platform sesuai target.

## 5.3 Scope

Untuk WAR/container runtime:

```xml
<scope>provided</scope>
```

Untuk library yang ingin compile against injection API:

```xml
<dependency>
  <groupId>jakarta.inject</groupId>
  <artifactId>jakarta.inject-api</artifactId>
  <version>2.0.1</version>
</dependency>
```

Scope tergantung packaging dan consumer.

## 5.4 API jar bukan injector

Menambahkan:

```xml
jakarta.inject-api
```

tidak membuat injection berjalan.

Kamu masih butuh:

- CDI runtime;
- Spring container;
- Guice-like injector;
- Dagger-generated component;
- custom injector;
- Jakarta EE runtime.

## 5.5 Migration dependency warning

Jangan campur:

```text
javax.inject
jakarta.inject
```

dalam stack yang sama tanpa alasan kompatibilitas.

Gunakan dependency tree:

```bash
mvn dependency:tree | grep inject
```

PowerShell:

```powershell
mvn dependency:tree | Select-String "inject"
```

---

# 6. Peta API `jakarta.inject`

## 6.1 `@Inject`

Menandai injectable constructor, method, atau field.

```java
@Inject
public CaseService(CaseRepository repository) { ... }
```

## 6.2 `@Qualifier`

Menandai annotation lain sebagai qualifier.

```java
@Qualifier
@Retention(RUNTIME)
@Target({FIELD, PARAMETER, METHOD, TYPE})
public @interface PrimaryDatabase {}
```

## 6.3 `@Named`

String-based qualifier.

```java
@Inject
@Named("caseRepository")
CaseRepository repository;
```

## 6.4 `Provider<T>`

Factory-like interface untuk mengambil instance.

```java
@Inject
Provider<RequestContext> requestContextProvider;
```

## 6.5 `@Scope`

Menandai annotation lain sebagai scope annotation.

```java
@Scope
@Retention(RUNTIME)
@Target(TYPE)
public @interface CustomScope {}
```

## 6.6 `@Singleton`

Scope annotation untuk satu instance.

```java
@Singleton
public class CaseNumberGenerator { ... }
```

## 6.7 Minimal surface, big implications

API kecil ini cukup untuk menulis class yang portable secara dependency injection style.

Namun untuk production, kamu tetap harus memahami container yang menjalankan injection.

---

# 7. `@Inject`: Titik Masuk Dependency Injection

`@Inject` mengidentifikasi constructors, methods, dan fields yang injectable.

## 7.1 Constructor injection

```java
public class CaseService {
    private final CaseRepository repository;

    @Inject
    public CaseService(CaseRepository repository) {
        this.repository = repository;
    }
}
```

## 7.2 Field injection

```java
public class CaseService {
    @Inject
    CaseRepository repository;
}
```

## 7.3 Method injection

```java
public class CaseService {
    private CaseRepository repository;

    @Inject
    void setRepository(CaseRepository repository) {
        this.repository = repository;
    }
}
```

## 7.4 Static injection

API docs menyebut `@Inject` dapat apply ke static maupun instance members. Namun dalam praktik Jakarta/CDI dan banyak container, static injection tidak dianjurkan dan support/semantics bisa terbatas.

Avoid static injection in production design.

## 7.5 Access modifier

`@Inject` dapat digunakan pada member dengan berbagai access modifier menurut API docs. Namun runtime/container/proxy/module constraints dapat memengaruhi behavior, terutama dengan JPMS/strong encapsulation.

## 7.6 At most one injectable constructor

API docs menyatakan injectable constructor ditandai `@Inject`, menerima zero or more dependencies, dan `@Inject` dapat diterapkan ke paling banyak satu constructor per class.

Jika lebih dari satu constructor annotated:

```java
public class BadService {
    @Inject
    public BadService(A a) {}

    @Inject
    public BadService(B b) {}
}
```

Injector tidak punya pilihan jelas.

## 7.7 No-arg constructor

Jika tidak ada injectable constructor, injector/container mungkin memakai no-arg constructor depending rules.

Namun untuk clarity dan testability, constructor injection eksplisit sering lebih baik.

## 7.8 Injection point should reveal dependency

Class dependency harus mudah terlihat.

Buruk:

```java
public class CaseService {
    @Inject CaseRepository repository;
    @Inject AuditTrail auditTrail;
    @Inject Clock clock;
    @Inject PolicyEngine policyEngine;
}
```

Lebih baik:

```java
@Inject
public CaseService(
        CaseRepository repository,
        AuditTrail auditTrail,
        Clock clock,
        PolicyEngine policyEngine
) {
    ...
}
```

Constructor memperlihatkan dependency graph.

---

# 8. Constructor Injection

Constructor injection adalah default terbaik untuk banyak service.

## 8.1 Example

```java
@ApplicationScoped
public class EscalateCaseUseCase {
    private final CaseRepository repository;
    private final EscalationPolicy policy;
    private final Clock clock;

    @Inject
    public EscalateCaseUseCase(
            CaseRepository repository,
            EscalationPolicy policy,
            Clock clock
    ) {
        this.repository = Objects.requireNonNull(repository);
        this.policy = Objects.requireNonNull(policy);
        this.clock = Objects.requireNonNull(clock);
    }
}
```

## 8.2 Keuntungan

- dependencies explicit;
- supports final fields;
- object valid after construction;
- easier unit testing;
- fail fast;
- no partially constructed state;
- dependency graph visible;
- good for immutability.

## 8.3 Unit testing

```java
var useCase = new EscalateCaseUseCase(
    fakeRepository,
    new DefaultEscalationPolicy(),
    Clock.fixed(instant, ZoneOffset.UTC)
);
```

No container needed for domain/application unit test.

## 8.4 Constructor injection and too many dependencies

Jika constructor terlalu panjang:

```java
public Service(A a, B b, C c, D d, E e, F f, G g, H h, I i) {}
```

Mungkin class punya terlalu banyak responsibilities.

Refactor:

- split use cases;
- introduce cohesive collaborator;
- separate orchestration;
- avoid god service.

## 8.5 Constructor injection in CDI/Jakarta

Modern CDI supports constructor injection.

For portability, ensure target runtime supports your style and component type.

## 8.6 Constructor injection vs framework proxy

Some proxy mechanisms need non-final classes/methods or no-arg constructors. CDI/Jakarta runtime can handle many cases, but provider/runtime specifics matter.

If proxying fails, error often appears at deployment.

## 8.7 Rule of thumb

Use constructor injection for:

- application services;
- domain services;
- adapters;
- clients;
- repositories;
- policies;
- classes with required dependencies.

---

# 9. Field Injection

Field injection:

```java
@Inject
private CaseRepository repository;
```

## 9.1 Keuntungan

- concise;
- common in older examples;
- avoids constructor boilerplate;
- useful in certain framework-managed classes.

## 9.2 Kerugian

- dependency hidden;
- fields cannot be final;
- object can be invalid after constructor;
- harder unit testing without container/reflection;
- encourages too many dependencies;
- lifecycle less explicit.

## 9.3 When acceptable?

Can be acceptable for:

- framework/resource classes where constructor injection not supported or awkward;
- test fixtures in container tests;
- simple glue code;
- legacy code.

But for core application services, prefer constructor injection.

## 9.4 Hidden dependency problem

```java
public class ReportService {
    @Inject Repository repository;
    @Inject Mailer mailer;
    @Inject Audit audit;
}
```

Constructor:

```java
public ReportService() {}
```

Reader cannot see dependency by constructor signature.

## 9.5 Testing problem

Without container:

```java
var service = new ReportService();
service.generate(); // repository null
```

Need reflection/manual field set.

## 9.6 Migration strategy

Convert field injection to constructor injection gradually:

1. identify required dependencies;
2. create constructor;
3. make fields final;
4. update tests;
5. remove no-arg constructor if not needed;
6. verify container can instantiate.

---

# 10. Method Injection / Initializer Method

Method injection injects dependencies by calling annotated method.

```java
public class CaseService {
    private CaseRepository repository;
    private AuditTrail auditTrail;

    @Inject
    void configure(CaseRepository repository, AuditTrail auditTrail) {
        this.repository = repository;
        this.auditTrail = auditTrail;
    }
}
```

## 10.1 Use cases

- optional-ish setup depending injector features;
- multiple dependencies that logically configure a subsystem;
- backward compatibility where constructor cannot change;
- framework lifecycle needs.

## 10.2 Risks

- less explicit than constructor;
- object partially initialized after constructor;
- ordering of multiple injection methods may matter;
- easier to misuse for arbitrary initialization.

## 10.3 Do not mix too much

Avoid:

```java
@Inject constructor
@Inject fields
@Inject multiple methods
@PostConstruct heavy init
```

unless there is clear reason.

## 10.4 Preferred pattern

Constructor injection for required dependencies, `@PostConstruct` for container-dependent initialization.

---

# 11. `@Qualifier`: Menghindari Ambiguity

Qualifier adalah annotation yang membedakan dependencies dengan type sama.

## 11.1 Problem

```java
public interface NotificationSender {
    void send(Notification notification);
}
```

Implementations:

```java
public class EmailNotificationSender implements NotificationSender {}
public class SmsNotificationSender implements NotificationSender {}
```

Injection:

```java
@Inject
NotificationSender sender;
```

Ambiguous. Mana yang dipilih?

## 11.2 Define qualifier

```java
import jakarta.inject.Qualifier;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.*;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@Qualifier
@Retention(RUNTIME)
@Target({FIELD, PARAMETER, METHOD, TYPE})
public @interface EmailChannel {}
```

Another:

```java
@Qualifier
@Retention(RUNTIME)
@Target({FIELD, PARAMETER, METHOD, TYPE})
public @interface SmsChannel {}
```

## 11.3 Apply qualifier

```java
@EmailChannel
public class EmailNotificationSender implements NotificationSender {}

@SmsChannel
public class SmsNotificationSender implements NotificationSender {}
```

Inject:

```java
@Inject
public NotificationService(@EmailChannel NotificationSender sender) {
    this.sender = sender;
}
```

## 11.4 Qualifier is type-safe

Qualifier annotation is better than string names because compiler helps.

## 11.5 Qualifier attributes

You can add attributes:

```java
@Qualifier
@Retention(RUNTIME)
@Target({FIELD, PARAMETER, METHOD, TYPE})
public @interface Channel {
    ChannelType value();
}
```

Usage:

```java
@Inject
public NotificationService(@Channel(ChannelType.EMAIL) NotificationSender sender) {}
```

But be mindful: qualifier member semantics are governed by injector/CDI rules.

## 11.6 Qualifier design

Good qualifier names express domain/role:

```java
@PrimaryDatabase
@ReadReplica
@AuditEventPublisher
@ExternalPaymentGateway
@CaseStorage
```

Bad:

```java
@Impl1
@Fast
@New
@Default2
```

## 11.7 Qualifier anti-pattern

Over-qualifying everything creates ceremony.

Use qualifier when there are multiple candidates or meaning differs.

---

# 12. `@Named`: String-Based Qualifier

`@Named` is a qualifier with string name.

```java
@Inject
@Named("emailSender")
NotificationSender sender;
```

## 12.1 When useful?

Useful for:

- integration with expression language;
- framework config;
- simple naming;
- legacy code;
- dynamic selection in some contexts.

## 12.2 Risks

String names are weak:

- typo not caught by compiler;
- refactoring unsafe;
- no semantic type;
- naming collision.

## 12.3 Prefer custom qualifier for core code

Instead of:

```java
@Named("auditPublisher")
EventPublisher publisher;
```

Prefer:

```java
@AuditPublisher
EventPublisher publisher;
```

## 12.4 When `@Named` is acceptable

- UI/EL binding;
- quick prototypes;
- framework-specific integration;
- when name is externally meaningful;
- legacy interoperability.

## 12.5 Naming convention

If using `@Named`, standardize names:

```text
caseRepository
auditPublisher
primaryDataSource
externalPaymentGateway
```

Avoid random names.

---

# 13. `Provider<T>`: Lazy Lookup, Multiple Instances, dan Circular Dependency

`Provider<T>` provides instances of `T`.

API docs mention that for any injectable type `T`, you can inject `Provider<T>`. Compared with injecting `T` directly, Provider enables retrieving multiple instances, lazy/optional retrieval, breaking circular dependencies, and abstracting scope.

## 13.1 Basic example

```java
@Inject
Provider<ExpensiveClient> clientProvider;

public Result handle(Command command) {
    ExpensiveClient client = clientProvider.get();
    return client.call(command);
}
```

## 13.2 Lazy retrieval

If dependency is expensive or only needed in certain branch:

```java
public void handle(Command command) {
    if (command.requiresExternalCheck()) {
        externalCheckerProvider.get().check(command);
    }
}
```

## 13.3 Multiple instances

If target type has dependent/prototype-like semantics, each `get()` may produce a new instance depending injector/scope.

```java
TaskContext c1 = provider.get();
TaskContext c2 = provider.get();
```

But exact reuse/new behavior depends scope/container.

## 13.4 Smaller scope lookup

Application-scoped bean may use `Provider<RequestContext>` to retrieve request-scoped instance when request context active.

```java
@ApplicationScoped
public class AuditLogger {
    @Inject
    Provider<RequestMetadata> requestMetadata;

    public void log(String event) {
        RequestMetadata metadata = requestMetadata.get();
        ...
    }
}
```

## 13.5 Circular dependency break

Direct circular:

```java
class A {
    @Inject A(B b) {}
}

class B {
    @Inject B(A a) {}
}
```

Can fail.

Provider can defer:

```java
class A {
    private final Provider<B> bProvider;

    @Inject
    A(Provider<B> bProvider) {
        this.bProvider = bProvider;
    }
}
```

But this may hide design smell.

## 13.6 Provider is not Service Locator?

Provider can become local service locator if abused:

```java
@Inject Provider<Everything> everything;
```

Use it for specific dependency, not arbitrary lookup.

## 13.7 Provider error handling

`provider.get()` can fail if:

- context not active;
- bean unavailable;
- provider cannot create instance;
- circular dependency still unresolved;
- scope destroyed.

Handle where appropriate.

## 13.8 Provider and optional dependency

`Provider<T>` is not a universal optional dependency API. If dependency absent, `get()` may throw. CDI has additional constructs like `Instance<T>` for availability/selection. That is CDI, not plain `jakarta.inject`.

---

# 14. `@Scope` dan Scope Annotation

`@Scope` identifies scope annotations.

A scope annotation applies to a class containing an injectable constructor and governs how injector reuses instances.

## 14.1 Default behavior

API docs state that by default, if no scope annotation is present, injector creates an instance, uses it for one injection, then forgets it.

This is minimal DI concept. CDI has its own default scope semantics such as `@Dependent`.

## 14.2 Scope annotation example

```java
@Scope
@Retention(RUNTIME)
@Target(TYPE)
public @interface RequestLike {}
```

But defining custom scopes requires injector/container support.

Annotation alone does nothing.

## 14.3 Scopes are injector-defined behavior

`@Scope` marks an annotation as scope, but:

- lifecycle;
- storage;
- activation;
- destruction;
- context;
- concurrency behavior;

must be implemented by container/injector.

## 14.4 Jakarta CDI scopes

CDI provides scope annotations such as:

```java
@RequestScoped
@ApplicationScoped
@SessionScoped
@Dependent
```

These are in `jakarta.enterprise.context`, not `jakarta.inject`.

## 14.5 Scope design questions

- Who owns lifecycle?
- When instance is created?
- When destroyed?
- Is it thread-safe?
- Can it be proxied?
- Is context always active?
- What happens in async/background thread?

---

# 15. `@Singleton`: Scope Minimal

`@Singleton` identifies a type that injector only instantiates once.

```java
@Singleton
public class CaseNumberGenerator {
    ...
}
```

## 15.1 Singleton scope vs static singleton

`@Singleton` is container-managed singleton.

Static singleton:

```java
public static final CaseNumberGenerator INSTANCE = new CaseNumberGenerator();
```

Problems:

- no injection;
- hard to test;
- lifecycle unmanaged;
- classloader leaks;
- hidden global state.

`@Singleton` allows injector/container to manage lifecycle and dependencies.

## 15.2 Thread safety

Singleton instance may be used by multiple threads.

Therefore:

- avoid mutable shared state;
- use thread-safe structures;
- protect caches;
- avoid request-specific fields;
- keep services stateless where possible.

Bad:

```java
@Singleton
public class CurrentUserHolder {
    private User currentUser;
}
```

This leaks users across requests.

## 15.3 `@Singleton` vs CDI `@ApplicationScoped`

In CDI/Jakarta EE, `@ApplicationScoped` is often preferred for application-wide beans because it participates in CDI context model.

`jakarta.inject.Singleton` and CDI scope behavior can differ depending container.

Use project standard.

## 15.4 Singleton initialization

Do not assume eager creation unless container guarantees or config specifies.

Singleton may be lazy.

If startup validation required, make it explicit through runtime mechanism.

---

# 16. Injection Resolution: Apa yang Dijanjikan `jakarta.inject` dan Apa yang Tidak

## 16.1 What `jakarta.inject` says

It gives annotations/interfaces for:

- identifying injection points;
- qualifying dependencies;
- named dependencies;
- provider lookup;
- scope metadata;
- singleton scope.

## 16.2 What it leaves to injector

External dependency configuration is left to injector.

This includes:

- which classes are beans;
- how to scan/discover;
- how to resolve ambiguity;
- how to configure alternatives;
- how to handle lifecycle;
- how to proxy;
- how to integrate with framework runtime.

## 16.3 Why this matters

Code using only `jakarta.inject` may compile across frameworks but not behave identically.

Example:

```java
@Inject
List<Handler> handlers;
```

One injector may support collection injection; another may not or has different semantics. `jakarta.inject` minimal API does not standardize every advanced injection feature.

## 16.4 Do not assume CDI behavior from `jakarta.inject` alone

If you rely on CDI features, say so.

Example CDI features:

- `@Produces`;
- `Instance<T>`;
- `@Alternative`;
- `@Specializes`;
- `@Observes`;
- `@ApplicationScoped`;
- `@RequestScoped`;
- interceptor binding;
- decorator;
- extension.

These are CDI, not plain `jakarta.inject`.

## 16.5 Write portable libraries carefully

If library wants to be portable across DI containers:

- use constructor injection;
- use minimal qualifiers;
- avoid CDI-only annotations in core library;
- avoid framework-specific lifecycle;
- document requirements;
- provide manual factory fallback if possible.

---

# 17. Lifecycle: Apa yang Tidak Ada di `jakarta.inject`

`jakarta.inject` does not define `@PostConstruct` or `@PreDestroy`.

Those are in:

```java
jakarta.annotation
```

## 17.1 No lifecycle callback in inject package

If you need lifecycle:

```java
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
```

## 17.2 No transaction

Transaction annotation is not in `jakarta.inject`.

Use:

```java
jakarta.transaction.Transactional
```

or framework-specific equivalent.

## 17.3 No validation

Validation annotations are not in `jakarta.inject`.

Use:

```java
jakarta.validation.constraints.NotNull
```

## 17.4 No context scopes except minimal `@Scope`/`@Singleton`

Request/application/session scopes are CDI/Jakarta EE concepts, not plain DI API.

## 17.5 No resource injection

Resource injection is:

```java
jakarta.annotation.Resource
```

not `jakarta.inject`.

## 17.6 Lesson

Do not overload `jakarta.inject`.

It is a small foundation. Other packages/specs provide other capabilities.

---

# 18. `jakarta.inject` vs CDI

## 18.1 Relationship

CDI uses Jakarta Dependency Injection annotations.

`@Inject` is defined by Jakarta Dependency Injection and used by CDI.

CDI defines a much richer programming model.

## 18.2 CDI adds

- contexts/scopes;
- bean discovery;
- qualifiers semantics;
- producers;
- disposers;
- alternatives;
- stereotypes;
- decorators;
- interceptors;
- events;
- `Instance<T>`;
- extensions;
- build-compatible extensions;
- CDI Lite and CDI Full;
- integration with Jakarta EE.

## 18.3 Example `jakarta.inject` only

```java
public class CaseService {
    @Inject
    public CaseService(CaseRepository repository) {}
}
```

## 18.4 Example CDI feature

```java
@ApplicationScoped
public class CaseRepositoryProducer {
    @Produces
    @ReadReplica
    DataSource readReplica() { ... }
}
```

`@Produces`, `@ApplicationScoped`, and `@ReadReplica` qualifier semantics in CDI context are CDI world.

## 18.5 CDI resolution is typesafe

CDI provides rich type-safe injection resolution.

If you write Jakarta EE app, practical behavior of `@Inject` is usually governed by CDI.

## 18.6 CDI Lite vs Full

CDI Lite is smaller/build-time friendly. CDI Full includes broader features.

This matters for Core Profile/cloud-native runtimes.

## 18.7 Rule

When teaching/designing:

```text
Use jakarta.inject for minimal injection vocabulary.
Use CDI to explain actual Jakarta EE container behavior.
```

---

# 19. `jakarta.inject` vs Spring DI

Spring supports injection annotations, including Jakarta annotations in modern Spring versions.

## 19.1 Spring equivalents

Spring has:

```java
@Autowired
@Component
@Service
@Configuration
@Bean
@Qualifier
@Primary
@Scope
```

Jakarta inject:

```java
@Inject
@Named
@Qualifier
@Singleton
Provider<T>
```

## 19.2 `@Inject` in Spring

Spring can process `@Inject`, but Spring-specific features are richer in Spring annotations/config.

## 19.3 Differences

Potential differences:

- bean discovery model;
- default scope;
- qualifier semantics;
- optional dependency handling;
- collection injection;
- lifecycle behavior;
- proxy/AOP integration;
- conditionals/profiles;
- configuration style.

## 19.4 Library design

If building framework-neutral library, using `@Inject` constructor can reduce coupling.

If building Spring application, follow project standard—often Spring annotations are clearer for Spring-specific features.

## 19.5 Migration Spring Boot 2 → 3

Package changes from `javax.inject` to `jakarta.inject` may occur if code uses injection annotations directly.

But many Spring apps use `@Autowired` and may not see this package.

---

# 20. `jakarta.inject` vs Service Locator, Factory, dan Manual Wiring

## 20.1 Service locator

Service locator:

```java
CaseRepository repository = registry.get(CaseRepository.class);
```

Problem:

- hidden dependencies;
- runtime failure;
- harder testing;
- global state;
- unclear graph.

## 20.2 Factory

Factory:

```java
public final class CaseServiceFactory {
    public CaseService create() {
        return new CaseService(new JpaCaseRepository(...));
    }
}
```

Can be good for small apps or complex construction.

## 20.3 Manual wiring

Manual wiring:

```java
var repository = new JpaCaseRepository(ds);
var service = new CaseService(repository);
var resource = new CaseResource(service);
```

Good for:

- small apps;
- tests;
- explicit bootstrap;
- no runtime magic.

Bad when graph large.

## 20.4 Dependency injection container

Container wiring:

```java
@Inject
public CaseService(CaseRepository repository) {}
```

Good for:

- large app;
- multiple integrations;
- lifecycle;
- scope;
- runtime services.

Risk:

- magic;
- runtime errors;
- ambiguity;
- hidden graph if field injection;
- overuse.

## 20.5 Use the right tool

Do not use DI container for domain entities/value objects.

Use DI for services/adapters/components.

---

# 21. Dependency Graph Design

## 21.1 Dependency graph should be acyclic

Good architecture:

```text
api → application → domain
infrastructure → application/domain ports
domain → no container/framework
```

Bad:

```text
domain → infrastructure → application → domain
```

## 21.2 Constructor shows graph

```java
@Inject
public ApproveCaseUseCase(
        CaseRepository repository,
        AuthorizationPolicy authorization,
        AuditTrail auditTrail,
        Clock clock
) { ... }
```

This tells reviewer what collaborator is needed.

## 21.3 Too many dependencies smell

If a class has 12 injected dependencies, ask:

- is this a god service?
- should use cases be split?
- is orchestration too broad?
- can collaborators be grouped by cohesive capability?
- is abstraction too fine-grained?

## 21.4 Dependency direction rule

High-level policy should not depend on low-level details.

Use interfaces/ports:

```java
public interface CaseRepository {
    EnforcementCase get(CaseId id);
    void save(EnforcementCase c);
}
```

Implementation:

```java
@ApplicationScoped
public class JpaCaseRepository implements CaseRepository {
    ...
}
```

## 21.5 Qualify infrastructure, not domain

Domain should not know CDI/Jakarta annotations.

Prefer:

```text
domain: pure Java
application: may use @Inject
infrastructure: uses Jakarta APIs
api layer: uses Jakarta REST/CDI/etc.
```

## 21.6 Dependency graph documentation

For critical apps, generate or document:

```text
component graph
module dependencies
package dependencies
runtime resources
```

---

# 22. Layering dan Dependency Direction

## 22.1 API layer

Jakarta REST resource:

```java
@Path("/cases")
public class CaseResource {
    private final ApproveCaseUseCase approveCase;

    @Inject
    public CaseResource(ApproveCaseUseCase approveCase) {
        this.approveCase = approveCase;
    }
}
```

API layer depends on application layer.

## 22.2 Application layer

```java
public class ApproveCaseUseCase {
    private final CaseRepository repository;
    private final AuditTrail auditTrail;

    @Inject
    public ApproveCaseUseCase(CaseRepository repository, AuditTrail auditTrail) {
        ...
    }
}
```

Application depends on domain ports.

## 22.3 Domain layer

```java
public final class EnforcementCase {
    public CaseApproved approve(ApproveCase command, ApprovalPolicy policy, Clock clock) {
        ...
    }
}
```

No `@Inject`.

## 22.4 Infrastructure layer

```java
@ApplicationScoped
public class JpaCaseRepository implements CaseRepository {
    @PersistenceContext
    EntityManager em;
}
```

Infrastructure implements ports.

## 22.5 Dependency injection binds layers

DI container wires:

```text
CaseResource → ApproveCaseUseCase → CaseRepository(interface) → JpaCaseRepository
```

But architecture decides direction.

## 22.6 Avoid framework leakage

Bad domain:

```java
@Entity
@RequestScoped
public class Case { ... }
```

unless intentionally using persistence entity as domain entity.

---

# 23. Circular Dependency

## 23.1 What is circular dependency?

```text
A depends on B
B depends on A
```

Example:

```java
public class CaseService {
    @Inject
    public CaseService(AuditService audit) {}
}

public class AuditService {
    @Inject
    public AuditService(CaseService caseService) {}
}
```

## 23.2 Why problematic?

- construction order impossible;
- design coupling;
- harder testing;
- hidden responsibilities;
- runtime proxy tricks;
- initialization bugs.

## 23.3 Provider as workaround

```java
public class AuditService {
    private final Provider<CaseService> caseService;

    @Inject
    public AuditService(Provider<CaseService> caseService) {
        this.caseService = caseService;
    }
}
```

This delays lookup.

But ask: should this dependency exist?

## 23.4 Better fixes

- extract shared policy/service;
- invert dependency through event;
- split responsibilities;
- introduce port;
- move orchestration to application service;
- use domain event/outbox for side effects.

## 23.5 Example refactor

Bad:

```text
CaseService approves case and calls AuditService
AuditService queries CaseService for details
```

Better:

```text
ApproveCaseUseCase loads case
  → case.approve()
  → audit.record(event)
```

Audit receives event data, not CaseService dependency.

---

# 24. Optional Dependency dan Conditional Dependency

## 24.1 Plain `jakarta.inject` limitation

`jakarta.inject` does not define rich optional dependency API.

Provider can defer lookup, but absent dependency may still fail.

## 24.2 CDI solution

CDI has `Instance<T>`:

```java
@Inject
Instance<ExternalChecker> checker;
```

You can check availability/select qualifiers in CDI.

But this is CDI, not plain `jakarta.inject`.

## 24.3 Spring solution

Spring has:

- `Optional<T>`;
- `ObjectProvider<T>`;
- conditional beans;
- profiles;
- properties.

Again framework-specific.

## 24.4 Design principle

Avoid optional dependency in core logic unless truly optional.

Prefer explicit strategy:

```java
public interface FraudCheckPolicy {
    FraudCheckResult check(Command command);
}

public final class NoOpFraudCheckPolicy implements FraudCheckPolicy { ... }
```

Then wire implementation by configuration.

## 24.5 Conditional dependency risk

Too many conditionals make runtime behavior hard to reason about.

Document:

- which implementation active;
- config;
- environment;
- test coverage.

---

# 25. Testing Strategy

## 25.1 Constructor injection enables plain unit tests

```java
@Test
void approvesCase() {
    var useCase = new ApproveCaseUseCase(
        fakeRepository,
        fakeAuditTrail,
        Clock.fixed(...)
    );

    useCase.handle(command);

    assertThat(fakeAuditTrail.events()).hasSize(1);
}
```

No container.

## 25.2 Field injection makes unit tests awkward

```java
var service = new Service();
ReflectionTestUtils.setField(service, "repository", fakeRepo);
```

This is a smell.

## 25.3 Container integration tests

Use container/runtime tests to verify:

- injection resolution;
- qualifier selection;
- scope behavior;
- lifecycle;
- ambiguity/unsatisfied failure;
- provider behavior.

## 25.4 Test doubles

DI makes it easy to replace:

- repository;
- clock;
- external client;
- event publisher;
- audit trail.

Avoid mocking domain model. Mock boundaries/adapters.

## 25.5 Qualifier tests

If multiple implementations exist, write integration tests proving correct qualifier wiring.

## 25.6 Dependency graph tests

For critical codebase:

- ArchUnit package dependency rules;
- CDI bootstrap test;
- no circular dependencies;
- no field injection in application layer if project standard forbids it.

## 25.7 Test for missing bean

A deployment/bootstrap test should fail if injection graph invalid.

This catches:

- unsatisfied dependency;
- ambiguous dependency;
- missing producer;
- wrong qualifier.

---

# 26. Performance dan Startup Considerations

## 26.1 DI container startup cost

Container may need:

- classpath scanning;
- annotation processing;
- metadata model building;
- proxy generation;
- dependency graph validation;
- scope/context setup.

## 26.2 Reflection/proxy cost

Injection and proxy creation can use reflection/bytecode generation.

Modern runtimes optimize via build-time processing.

## 26.3 Runtime invocation overhead

A proxied bean call may include:

- context resolution;
- interceptor chain;
- transaction/security;
- decorators.

Usually fine, but in hot path, know what happens.

## 26.4 Avoid excessive dynamic lookup

`Provider.get()` in tight loop can be costly depending scope/container.

Bad:

```java
for (Item item : items) {
    processorProvider.get().process(item);
}
```

If same processor can be reused, inject directly.

## 26.5 Startup optimization

- reduce classpath;
- avoid scanning unused packages;
- use profile appropriate to app;
- prefer build-time index if runtime supports;
- avoid heavy `@PostConstruct`;
- remove unused beans/dependencies.

## 26.6 Measurement

Use:

- startup logs;
- JFR;
- runtime metrics;
- container startup time;
- class loading metrics.

Do not optimize DI blindly.

---

# 27. Production Failure Modes

## 27.1 Unsatisfied dependency

Symptom:

```text
Unsatisfied dependency for type CaseRepository
```

Causes:

- implementation not discovered;
- missing bean annotation;
- wrong package/archive;
- missing dependency;
- qualifier mismatch;
- conditional config disabled.

## 27.2 Ambiguous dependency

Symptom:

```text
Ambiguous dependency for type NotificationSender
```

Causes:

- multiple beans same type;
- missing qualifier;
- producer + class both available;
- test double accidentally packaged.

## 27.3 Null injected field

Causes:

- object created manually;
- test not using container;
- static injection issue;
- injection not performed due to unsupported component.

## 27.4 Circular dependency

Causes:

- mutual constructor dependencies;
- god services;
- bidirectional service calls.

## 27.5 Scope/context failure

Symptom:

```text
Context not active
```

Causes:

- request-scoped bean used outside request;
- background thread;
- provider lookup outside context;
- async boundary without context propagation.

## 27.6 Wrong implementation injected

Causes:

- wrong qualifier;
- `@Named` typo;
- default bean selected unexpectedly;
- environment-specific config;
- alternative enabled in production accidentally.

## 27.7 Startup slow

Causes:

- huge bean graph;
- classpath scanning;
- proxy generation;
- heavy initialization in constructors/PostConstruct;
- too many unused dependencies.

## 27.8 Memory leak

Causes:

- singleton storing request-scoped state;
- Provider results cached incorrectly;
- static references;
- unclosed dependent objects;
- ThreadLocal in injected singleton.

---

# 28. Best Practices dan Anti-Patterns

## 28.1 Best practices

- Prefer constructor injection for required dependencies.
- Keep domain model free from DI annotations.
- Use custom qualifiers instead of string `@Named` for core code.
- Use `Provider<T>` sparingly and intentionally.
- Avoid circular dependencies; refactor design.
- Use scopes consciously.
- Keep singleton/application-scoped beans stateless or thread-safe.
- Test injection graph in container.
- Use DI at boundaries/services, not value objects/entities.
- Document dependency graph for critical modules.

## 28.2 Anti-pattern: DI everywhere

Bad:

```java
public record Money(@Inject CurrencyService service, BigDecimal amount) {}
```

Value objects should not depend on container.

## 28.3 Anti-pattern: God service injection

```java
public class CaseService {
    @Inject A a;
    @Inject B b;
    ...
    @Inject Z z;
}
```

Refactor responsibilities.

## 28.4 Anti-pattern: Service locator through Provider

```java
@Inject
Provider<Object> provider;
```

or generic registry usage. This hides dependencies.

## 28.5 Anti-pattern: Static injected state

```java
@Inject
static CaseRepository repository;
```

Avoid.

## 28.6 Anti-pattern: Qualifier explosion

Too many qualifiers with unclear meaning make wiring harder.

## 28.7 Anti-pattern: Business logic in injector config

Wiring config should choose components. Business decisions should be in domain/application logic.

## 28.8 Anti-pattern: Field injection in core services

It hides dependencies and hurts tests.

---

# 29. Checklist Review

## 29.1 Injection style

- [ ] Required dependencies use constructor injection?
- [ ] Fields final where possible?
- [ ] Field injection avoided in application core?
- [ ] Method injection justified?

## 29.2 Dependency graph

- [ ] No circular dependencies?
- [ ] No god service?
- [ ] Dependency direction follows architecture?
- [ ] Domain layer has no DI annotations?
- [ ] Infrastructure implements ports?

## 29.3 Qualifiers

- [ ] Multiple implementations use clear qualifier?
- [ ] Custom qualifier preferred over `@Named` for core code?
- [ ] Qualifier names domain-meaningful?
- [ ] Ambiguity tests exist?

## 29.4 Provider

- [ ] `Provider<T>` has clear reason?
- [ ] Not hiding service locator?
- [ ] Context availability considered?
- [ ] Not called in hot loop unnecessarily?

## 29.5 Scope

- [ ] Scope chosen intentionally?
- [ ] Singleton/application-scoped beans thread-safe?
- [ ] Request-scoped beans not stored globally?
- [ ] Context propagation needed for async?

## 29.6 Testing

- [ ] Unit tests can instantiate core service manually?
- [ ] Container integration test validates wiring?
- [ ] Missing/ambiguous dependency caught in CI?
- [ ] Test doubles not accidentally packaged to production?

## 29.7 Migration

- [ ] No stale `javax.inject` in Jakarta stack?
- [ ] Dependency versions aligned?
- [ ] Framework/runtime supports `jakarta.inject`?
- [ ] Library public API namespace reviewed?

---

# 30. Latihan Bertahap

## Latihan 1 — Constructor injection

Buat:

```java
ApproveCaseUseCase
CaseRepository
AuditTrail
Clock
```

Wire dengan constructor injection dan test tanpa container.

## Latihan 2 — Field injection pain

Ubah menjadi field injection. Tulis unit test. Rasakan perbedaannya.

## Latihan 3 — Qualifier

Buat dua implementation:

```java
EmailNotificationSender
SmsNotificationSender
```

Tambahkan qualifier:

```java
@EmailChannel
@SmsChannel
```

Inject yang benar.

## Latihan 4 — Named typo

Gunakan `@Named("emailSender")`, lalu typo menjadi `@Named("emialSender")`.

Bandingkan dengan custom qualifier.

## Latihan 5 — Provider lazy

Buat dependency mahal.

Inject langsung vs `Provider<T>`.

Amati kapan object dibuat di runtime/container yang kamu pakai.

## Latihan 6 — Circular dependency

Buat A → B → A.

Perbaiki dengan desain, bukan langsung Provider.

## Latihan 7 — Singleton thread safety

Buat singleton dengan mutable field request-specific. Simulasikan dua request concurrent. Perbaiki.

## Latihan 8 — Domain purity

Ambil domain class yang memakai `@Inject`. Refactor agar dependency diberikan sebagai method parameter atau domain service terpisah.

## Latihan 9 — Container wiring test

Bootstrap CDI/runtime test untuk memastikan injection graph valid.

## Latihan 10 — Migration

Ganti `javax.inject.Inject` ke `jakarta.inject.Inject`, update dependency, dan jalankan tests.

---

# 31. Mini Project: Minimal DI Container

## 31.1 Goal

Bangun mini DI container sederhana untuk memahami `jakarta.inject`.

Bukan untuk production. Tujuannya belajar.

## 31.2 Features

Support:

- class registration;
- constructor injection with `@Inject`;
- field injection;
- singleton cache for `@Singleton`;
- simple qualifier;
- `Provider<T>`;
- detect unsatisfied dependency;
- detect ambiguous dependency;
- detect circular dependency.

## 31.3 Package

```text
mini-di/
  src/main/java/com/example/minidi/
    MiniContainer.java
    BeanDefinition.java
    InjectionPoint.java
    QualifierKey.java
    CircularDependencyException.java
  src/test/java/
```

## 31.4 Example

```java
@Singleton
public class CaseRepository {}

public class ApproveCaseUseCase {
    private final CaseRepository repository;

    @Inject
    public ApproveCaseUseCase(CaseRepository repository) {
        this.repository = repository;
    }
}
```

Usage:

```java
MiniContainer container = new MiniContainer();
container.register(CaseRepository.class);
container.register(ApproveCaseUseCase.class);

ApproveCaseUseCase useCase = container.get(ApproveCaseUseCase.class);
```

## 31.5 Learning outcomes

You will understand:

- how constructor is selected;
- why multiple `@Inject` constructors fail;
- why qualifier matters;
- why circular dependencies are hard;
- why scopes need cache/context;
- why Provider defers lookup;
- why real CDI is much more complex.

## 31.6 Stretch goals

- add `@Named`;
- add scope abstraction;
- add package scanning;
- add lifecycle callbacks from `jakarta.annotation`;
- add error messages with dependency path;
- add graph visualization.

## 31.7 Evaluation questions

1. What does `@Inject` mark?
2. Who performs injection?
3. Why constructor injection improves tests?
4. What is a qualifier?
5. Why is `@Named` weaker than custom qualifier?
6. What does `Provider<T>` enable?
7. Why does circular dependency indicate design smell?
8. What is scope?
9. Why is `@Singleton` not the same as static singleton?
10. What features are CDI-specific, not `jakarta.inject`?

---

# 32. Referensi Resmi

Referensi utama:

1. Jakarta Dependency Injection  
   https://jakarta.ee/specifications/dependency-injection/

2. Jakarta Dependency Injection 2.0  
   https://jakarta.ee/specifications/dependency-injection/2.0/

3. Jakarta Dependency Injection 2.0 API Docs  
   https://jakarta.ee/specifications/dependency-injection/2.0/apidocs/

4. `@Inject` API Docs  
   https://jakarta.ee/specifications/dependency-injection/2.0/apidocs/jakarta/inject/inject

5. `Provider<T>` API Docs  
   https://jakarta.ee/specifications/dependency-injection/2.0/apidocs/jakarta/inject/provider

6. `@Scope` API Docs  
   https://jakarta.ee/specifications/dependency-injection/2.0/apidocs/jakarta/inject/scope

7. Jakarta EE Tutorial — Dependency Injection  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/platform/injection/injection.html

8. Jakarta CDI 4.1  
   https://jakarta.ee/specifications/cdi/4.1/

9. Jakarta CDI Specification 4.1  
   https://jakarta.ee/specifications/cdi/4.1/jakarta-cdi-spec-4.1

10. Jakarta EE Tutorial — Introduction to CDI  
    https://jakarta.ee/learn/docs/jakartaee-tutorial/current/cdi/cdi-basic/cdi-basic.html

---

# Penutup

`jakarta.inject` adalah API kecil dengan dampak besar.

Ia tidak memberi seluruh kemampuan CDI, Spring, atau runtime Jakarta EE. Ia memberi vocabulary minimal:

```text
@Inject       → dependency needed here
@Qualifier    → distinguish candidates
@Named        → string-based qualifier
Provider<T>   → lazy/multiple/deferred lookup
@Scope        → mark scope annotations
@Singleton    → one instance per injector
```

Mental model paling penting:

```text
jakarta.inject defines annotations.
The injector/container defines behavior.
```

Jika kamu paham batas ini, kamu tidak akan salah menganggap `@Inject` sebagai magic universal.

Engineer top-tier menggunakan DI bukan untuk membuat code terlihat modern, tetapi untuk membuat dependency graph:

- eksplisit;
- testable;
- loosely coupled;
- sesuai boundary;
- mudah diganti;
- mudah dianalisis;
- tidak circular;
- tidak bocor ke domain model.

Bagian berikutnya akan masuk ke **CDI (`jakarta.enterprise.*`)** sebagai DI container/model yang jauh lebih kaya: bean discovery, scopes, qualifiers, producers, disposers, interceptors, decorators, events, CDI Lite vs Full, dan extension model.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 5 — `jakarta.annotation` dan Common Annotations](./learn-java-jakarta-part-005.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: Bagian 7 — CDI: `jakarta.enterprise.*` sebagai Container Programming Model](./learn-java-jakarta-part-007.md)
