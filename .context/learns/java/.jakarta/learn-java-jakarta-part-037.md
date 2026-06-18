# learn-java-jakarta-part-037.md

# Bagian 37 — Jakarta Managed Beans / Legacy Managed Beans: `@ManagedBean`, Container-Managed POJO, Faces Managed Bean, dan Migrasi ke CDI

> Target pembaca: Java engineer yang ingin memahami Managed Beans bukan sebagai “fitur yang harus dipakai”, tetapi sebagai **konsep historis** dalam Java EE/Jakarta EE: bagaimana container pernah menyediakan lifecycle/resource injection/interceptor untuk POJO dengan requirements minimal, kenapa konsep ini sering tertukar dengan JSF/Faces Managed Beans, kenapa Jakarta EE 11 menghapus Managed Beans dari platform, dan bagaimana migrasi mental model maupun kode ke CDI.
>
> Fokus bagian ini: Jakarta Managed Beans 2.0, `jakarta.annotation.ManagedBean` yang deprecated di Jakarta EE 10 dan diganti CDI, perbedaan Managed Beans spec vs Faces Managed Beans vs CDI beans vs EJB, lifecycle `@PostConstruct`/`@PreDestroy`, injection/resource limitation, naming, scopes, interceptors, legacy code diagnosis, migration to CDI (`@Named`, `@ApplicationScoped`, `@RequestScoped`, `@Dependent`, qualifiers, producers), testing, production pitfalls, and modernization strategy.

---

## Daftar Isi

1. [Orientasi: Kenapa Managed Beans Membingungkan?](#1-orientasi-kenapa-managed-beans-membingungkan)
2. [Status Modern: Managed Beans 2.0, Deprecation, dan Jakarta EE 11 Removal](#2-status-modern-managed-beans-20-deprecation-dan-jakarta-ee-11-removal)
3. [Mental Model: Container-Managed POJO dengan Basic Services](#3-mental-model-container-managed-pojo-dengan-basic-services)
4. [Tiga Hal yang Sering Tertukar: Managed Beans Spec, `@ManagedBean`, Faces Managed Beans](#4-tiga-hal-yang-sering-tertukar-managed-beans-spec-managedbean-faces-managed-beans)
5. [Managed Beans vs CDI Beans vs EJB vs Spring Bean](#5-managed-beans-vs-cdi-beans-vs-ejb-vs-spring-bean)
6. [Package dan Dependency](#6-package-dan-dependency)
7. [`jakarta.annotation.ManagedBean`: Apa Maksudnya?](#7-jakartaannotationmanagedbean-apa-maksudnya)
8. [Lifecycle: `@PostConstruct` dan `@PreDestroy`](#8-lifecycle-postconstruct-dan-predestroy)
9. [Resource Injection: `@Resource` dan Environment Dependency](#9-resource-injection-resource-dan-environment-dependency)
10. [Interceptors pada Managed Beans](#10-interceptors-pada-managed-beans)
11. [Naming dan Discovery](#11-naming-dan-discovery)
12. [Scope: Kenapa Managed Beans Tidak Selevel CDI](#12-scope-kenapa-managed-beans-tidak-selevel-cdi)
13. [Faces Managed Beans: Legacy JSF Bean Model](#13-faces-managed-beans-legacy-jsf-bean-model)
14. [Kenapa CDI Menggantikan Managed Beans?](#14-kenapa-cdi-menggantikan-managed-beans)
15. [CDI sebagai Single Component Model](#15-cdi-sebagai-single-component-model)
16. [Migration Pattern 1: `@ManagedBean` → CDI `@Named`](#16-migration-pattern-1-managedbean--cdi-named)
17. [Migration Pattern 2: Faces Managed Bean → CDI Backing Bean](#17-migration-pattern-2-faces-managed-bean--cdi-backing-bean)
18. [Migration Pattern 3: Managed Bean Resource Injection → CDI Producer/Config](#18-migration-pattern-3-managed-bean-resource-injection--cdi-producerconfig)
19. [Migration Pattern 4: Interceptors ke CDI Interceptor Binding](#19-migration-pattern-4-interceptors-ke-cdi-interceptor-binding)
20. [Migration Pattern 5: Eager Application Bean](#20-migration-pattern-5-eager-application-bean)
21. [Legacy Code Smell Checklist](#21-legacy-code-smell-checklist)
22. [Design Guideline untuk Kode Baru](#22-design-guideline-untuk-kode-baru)
23. [Testing Strategy](#23-testing-strategy)
24. [Production Failure Modes](#24-production-failure-modes)
25. [Best Practices dan Anti-Patterns](#25-best-practices-dan-anti-patterns)
26. [Checklist Review](#26-checklist-review)
27. [Case Study 1: `@ManagedBean` Tidak Jalan Setelah Upgrade Jakarta EE 11](#27-case-study-1-managedbean-tidak-jalan-setelah-upgrade-jakarta-ee-11)
28. [Case Study 2: JSF/Faces `@ManagedBean` ke CDI `@Named`](#28-case-study-2-jsffaces-managedbean-ke-cdi-named)
29. [Case Study 3: Resource Injection Legacy ke CDI Producer](#29-case-study-3-resource-injection-legacy-ke-cdi-producer)
30. [Case Study 4: Bean Name Collision Setelah Migrasi](#30-case-study-4-bean-name-collision-setelah-migrasi)
31. [Latihan Bertahap](#31-latihan-bertahap)
32. [Mini Project: Managed Beans to CDI Migration Lab](#32-mini-project-managed-beans-to-cdi-migration-lab)
33. [Referensi Resmi](#33-referensi-resmi)

---

# 1. Orientasi: Kenapa Managed Beans Membingungkan?

Istilah **Managed Bean** di ekosistem Java EE/Jakarta EE punya sejarah yang membingungkan.

Dalam legacy code, kamu bisa menemukan beberapa bentuk:

```java
@javax.annotation.ManagedBean
public class MyBean { ... }
```

atau:

```java
@javax.faces.bean.ManagedBean
@SessionScoped
public class LoginBean { ... }
```

atau di Jakarta namespace lama/baru:

```java
@jakarta.annotation.ManagedBean
public class MyBean { ... }
```

atau di CDI modern:

```java
@Named
@RequestScoped
public class LoginBean { ... }
```

Semua sering disebut “managed bean” oleh developer, tetapi artinya tidak selalu sama.

## 1.1 Akar kebingungan

Ada setidaknya tiga konsep:

1. **Jakarta Managed Beans specification**  
   Spesifikasi umum untuk container-managed POJO dengan basic services.

2. **`@ManagedBean` annotation di Common Annotations**  
   Annotation untuk menandai POJO sebagai ManagedBean.

3. **Faces/JSF Managed Beans**  
   Bean model lama milik JSF/Faces, sebelum CDI menjadi standard utama.

Selain itu, CDI juga sering disebut “managed beans” secara generik, karena CDI bean memang managed oleh container.

## 1.2 Kenapa perlu dipahami kalau sudah deprecated/removed?

Karena saat modernisasi Java EE/Jakarta EE, kamu mungkin perlu:

- membaca legacy code;
- upgrade dari Java EE 6/7/8;
- migrate JSF/Faces app;
- upgrade Jakarta EE 10 ke 11;
- mengganti `@ManagedBean` dengan CDI;
- memahami kenapa bean tidak ditemukan;
- memahami scope berubah;
- memahami lifecycle callback berubah;
- menghindari subtle behavior change.

## 1.3 Prinsip utama

```text
For new Jakarta EE code, use CDI.
Treat Managed Beans as legacy compatibility knowledge.
```

---

# 2. Status Modern: Managed Beans 2.0, Deprecation, dan Jakarta EE 11 Removal

Jakarta Managed Beans 2.0 adalah release untuk Jakarta EE 9.

Perubahan utamanya adalah pindah ke `jakarta.*` namespace.

Spesifikasi ini mendefinisikan basic services untuk container-managed objects dengan minimal requirements, alias POJO.

## 2.1 `@ManagedBean` deprecated di Jakarta EE 10

Di Jakarta EE 10 API docs, `jakarta.annotation.ManagedBean` ditandai deprecated.

Dokumentasinya menyatakan annotation ini akan dihapus setelah Jakarta EE 10 dan harus diganti dengan CDI beans.

## 2.2 Jakarta EE 11

Jakarta EE 11 secara eksplisit menyatakan removal of Managed Beans dan menggantikannya dengan CDI alternatives.

Release plan Jakarta EE 11 juga menyebut tujuan untuk menjadikan CDI single component model di EE dengan menghapus Managed Beans dari Annotations dan call sites yang menggunakan Managed Beans.

## 2.3 Practical impact

Jika aplikasi masih memakai:

```java
@jakarta.annotation.ManagedBean
```

atau konsep Managed Beans lama, upgrade ke Jakarta EE 11 bisa gagal atau behavior berubah.

## 2.4 What about Faces Managed Beans?

Faces Managed Beans sudah deprecated lama dan model modernnya juga CDI.

Dalam Jakarta Faces modern, backing bean sebaiknya CDI bean:

```java
@Named
@RequestScoped
public class UserForm { ... }
```

## 2.5 Bottom line

```text
Managed Beans is historical.
CDI is the modern replacement.
```

---

# 3. Mental Model: Container-Managed POJO dengan Basic Services

Managed Bean pada konsep lama adalah POJO yang dikelola container.

Mental model:

```text
Plain Java class
  + annotation/metadata
  ↓
container creates instance
  ↓
container performs injections/lifecycle/interceptors
  ↓
application uses bean
  ↓
container destroys bean
```

## 3.1 Minimal requirements

Managed Beans dirancang sebagai POJO dengan requirements minimal.

Tidak seperti EJB yang memiliki banyak enterprise services.

## 3.2 Basic services

Basic services dapat meliputi:

- resource injection;
- lifecycle callbacks;
- interceptors.

## 3.3 Tidak sama dengan CDI

Managed Beans lama tidak menyediakan CDI model penuh:

- qualifier;
- producer;
- observer events;
- alternatives;
- decorators;
- portable extensions;
- normal scopes dengan proxy model modern;
- typesafe injection yang kaya.

## 3.4 Tidak sama dengan EJB

Managed Beans bukan EJB.

Tidak otomatis punya:

- container-managed transaction;
- remoting;
- pooling EJB;
- timer service EJB;
- message-driven bean;
- security model EJB penuh.

## 3.5 Kenapa dulu berguna?

Dulu ia memberikan common foundation untuk berbagai component types di platform.

Namun CDI akhirnya menjadi model komponen yang lebih kuat dan konsisten.

---

# 4. Tiga Hal yang Sering Tertukar: Managed Beans Spec, `@ManagedBean`, Faces Managed Beans

## 4.1 Jakarta Managed Beans specification

Spesifikasi umum.

Mendefinisikan konsep Managed Bean sebagai container-managed object.

## 4.2 `jakarta.annotation.ManagedBean`

Annotation di Common Annotations.

Digunakan untuk menandai POJO sebagai ManagedBean.

Status modern: deprecated di Jakarta EE 10 dan diganti CDI.

## 4.3 `javax.faces.bean.ManagedBean` / `jakarta.faces.bean.ManagedBean`

Faces/JSF managed bean annotation lama.

Dipakai untuk backing bean Faces sebelum CDI.

Status modern: deprecated/removed dari Faces modern.

## 4.4 CDI bean

Modern component model:

```java
@Named
@RequestScoped
public class UserForm { ... }
```

## 4.5 How to read legacy code

Jika lihat:

```java
@ManagedBean
```

cek import.

```java
import jakarta.annotation.ManagedBean;
```

berarti Common Annotations/Managed Beans.

```java
import javax.faces.bean.ManagedBean;
```

berarti JSF/Faces legacy bean.

```java
import jakarta.inject.Named;
```

berarti CDI named bean.

## 4.6 Rule

```text
Always inspect the import.
The annotation name alone is not enough.
```

---

# 5. Managed Beans vs CDI Beans vs EJB vs Spring Bean

## 5.1 Managed Bean legacy

```java
@ManagedBean
public class ReportBean { ... }
```

Basic container-managed POJO.

## 5.2 CDI bean

```java
@ApplicationScoped
public class ReportService { ... }
```

Typesafe dependency injection, scopes, qualifiers, producers, interceptors, events, decorators.

## 5.3 EJB

```java
@Stateless
public class PaymentService { ... }
```

Enterprise services like transactions, security, concurrency, timers, remoting, MDB.

## 5.4 Spring Bean

```java
@Component
public class ReportService { ... }
```

Spring container-managed bean.

## 5.5 Decision table

| Need | Prefer |
|---|---|
| New Jakarta EE component | CDI |
| Web/Faces backing bean | CDI `@Named` + CDI scope |
| Transactional business service | CDI + Jakarta Transactions or EJB depending runtime/style |
| Messaging MDB | EJB MDB / Messaging |
| Legacy JSF bean migration | CDI |
| Basic POJO container lifecycle | CDI |
| Spring app | Spring bean |
| Old `@ManagedBean` maintenance | Migrate to CDI |

## 5.6 Top-tier conclusion

For Jakarta EE 11 and beyond:

```text
CDI is the default component model.
```

---

# 6. Package dan Dependency

## 6.1 Managed Beans specification page

Jakarta Managed Beans 2.0 exists as a spec release for Jakarta EE 9.

## 6.2 `@ManagedBean` annotation location

In Jakarta namespace:

```java
jakarta.annotation.ManagedBean
```

Historically:

```java
javax.annotation.ManagedBean
```

## 6.3 Faces legacy annotation

Historically:

```java
javax.faces.bean.ManagedBean
```

In Jakarta Faces intermediate versions:

```java
jakarta.faces.bean.ManagedBean
```

But Faces managed bean model is removed/deprecated in modern Faces.

## 6.4 CDI replacement

```java
jakarta.inject.Named
jakarta.enterprise.context.RequestScoped
jakarta.enterprise.context.SessionScoped
jakarta.enterprise.context.ApplicationScoped
jakarta.enterprise.context.Dependent
```

## 6.5 Dependency for CDI

In Jakarta EE runtime, CDI is part of profile/platform.

For standalone testing, use CDI implementation/testing extension.

## 6.6 Avoid adding Managed Beans dependency for new code

Do not revive Managed Beans in new Jakarta EE 11 project.

Use CDI.

---

# 7. `jakarta.annotation.ManagedBean`: Apa Maksudnya?

`@ManagedBean` marks a POJO as ManagedBean.

## 7.1 Conceptual example

```java
@ManagedBean
public class LegacyReportBean {

    @Resource
    private DataSource dataSource;

    @PostConstruct
    void init() {
        ...
    }
}
```

## 7.2 Basic services

A ManagedBean supports small set of services such as:

- resource injection;
- lifecycle callbacks;
- interceptors.

## 7.3 Name attribute

Depending annotation version, `@ManagedBean` can define a name.

```java
@ManagedBean("reportBean")
```

## 7.4 Why deprecated?

Because CDI provides richer and more consistent model.

## 7.5 Replacement

Use CDI:

```java
@Named("reportBean")
@RequestScoped
public class ReportBean {
    @Inject
    ReportService reportService;
}
```

## 7.6 Important

Do not confuse:

```java
jakarta.annotation.ManagedBean
```

with:

```java
jakarta.inject.Named
```

`@Named` exposes CDI bean to EL and gives name.

---

# 8. Lifecycle: `@PostConstruct` dan `@PreDestroy`

Managed Beans can use lifecycle callbacks.

## 8.1 `@PostConstruct`

Called after dependency injection.

```java
@PostConstruct
void init() {
    ...
}
```

## 8.2 `@PreDestroy`

Called before bean destruction.

```java
@PreDestroy
void destroy() {
    ...
}
```

## 8.3 Same annotations in CDI

CDI beans also support these lifecycle callbacks.

So migration often preserves methods.

## 8.4 Pitfall

Lifecycle timing can change due scope/proxy.

Example:

- old bean created eagerly or by specific runtime behavior;
- CDI bean created lazily by default unless observed/triggered.

## 8.5 Do not do heavy startup blindly

Use application startup event if needed.

## 8.6 Avoid external calls in constructor

Use `@PostConstruct` for initialization after injection.

## 8.7 Keep lifecycle deterministic

If lifecycle order matters, document and test.

---

# 9. Resource Injection: `@Resource` dan Environment Dependency

Managed Beans support resource injection.

## 9.1 Example

```java
@Resource(lookup = "java:comp/env/jdbc/Main")
private DataSource dataSource;
```

## 9.2 What is resource injection?

Container injects environment resource:

- `DataSource`;
- JMS connection factory;
- mail session;
- executor;
- environment entry;
- other container resource.

## 9.3 CDI can also work with resources

Modern code can use:

```java
@Resource
DataSource dataSource;
```

in supported Jakarta EE components, or define CDI producer.

## 9.4 Producer pattern

```java
@ApplicationScoped
public class DataSourceProducer {

    @Resource(lookup = "java:comp/env/jdbc/Main")
    private DataSource dataSource;

    @Produces
    @MainDataSource
    public DataSource dataSource() {
        return dataSource;
    }
}
```

Then inject:

```java
@Inject
@MainDataSource
DataSource dataSource;
```

## 9.5 Why producer can be better

- qualifier;
- test replacement;
- central lookup;
- less JNDI string duplication;
- clearer dependency.

## 9.6 Testing

Resource injection requires container or test substitute.

CDI producer makes mocking easier.

---

# 10. Interceptors pada Managed Beans

Managed Beans can use interceptors.

## 10.1 Example concept

```java
@Logged
@ManagedBean
public class LegacyBean {
    public void run() { ... }
}
```

## 10.2 Interceptor services

Interceptors allow cross-cutting behavior:

- logging;
- auditing;
- metrics;
- security checks;
- validation;
- idempotency.

## 10.3 CDI replacement

Use CDI interceptor binding:

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface Logged {}
```

```java
@Logged
@Interceptor
@Priority(Interceptor.Priority.APPLICATION)
public class LoggedInterceptor {
    @AroundInvoke
    Object around(InvocationContext ctx) throws Exception {
        ...
    }
}
```

## 10.4 Pitfall

Interceptors run on proxy/container invocation boundaries.

Self-invocation still commonly bypasses interceptor.

## 10.5 Test migration

Verify interceptor still triggers after moving to CDI.

## 10.6 Avoid business logic in interceptor

Cross-cutting only.

---

# 11. Naming dan Discovery

Managed Beans and CDI both have naming concepts, but semantics differ.

## 11.1 ManagedBean name

```java
@ManagedBean("legacyName")
```

## 11.2 CDI named bean

```java
@Named("legacyName")
```

## 11.3 Default CDI name

Class:

```java
UserForm
```

Default EL name:

```text
userForm
```

when using `@Named` without value.

## 11.4 Discovery

CDI bean discovery depends on CDI rules and bean archive configuration.

## 11.5 Migration issue

Bean name can change accidentally.

Legacy page:

```xml
#{loginBean.username}
```

New CDI bean must expose same name:

```java
@Named("loginBean")
```

## 11.6 Collision

Two beans with same EL name can cause ambiguous resolution.

## 11.7 Recommendation

During migration, explicitly preserve legacy names.

---

# 12. Scope: Kenapa Managed Beans Tidak Selevel CDI

Managed Beans legacy model is not a rich scope model like CDI.

CDI has well-defined scopes:

```java
@RequestScoped
@SessionScoped
@ApplicationScoped
@ConversationScoped
@Dependent
```

## 12.1 CDI normal scopes

Normal scopes use proxies and contextual instances.

## 12.2 Dependent scope

Default CDI pseudo-scope if no scope annotation.

## 12.3 Faces view scope

Faces has `@ViewScoped` for view lifecycle.

Modern Faces view scope integrates with CDI in Jakarta Faces.

## 12.4 Migration issue

Old JSF/Faces scope annotations differ from CDI scope annotations.

Example old:

```java
@javax.faces.bean.SessionScoped
```

New:

```java
@jakarta.enterprise.context.SessionScoped
```

Also requires serializable for passivation-capable scopes.

## 12.5 SessionScoped requirement

CDI `@SessionScoped` beans must be serializable.

## 12.6 ApplicationScoped eager

CDI `@ApplicationScoped` is not necessarily eager by default.

Use startup event observer if needed.

---

# 13. Faces Managed Beans: Legacy JSF Bean Model

Faces had its own managed bean model.

## 13.1 Old example

```java
@javax.faces.bean.ManagedBean(name = "login")
@javax.faces.bean.SessionScoped
public class LoginBean implements Serializable {
    ...
}
```

## 13.2 Problems

- separate bean model from CDI;
- limited injection;
- deprecated;
- removed from modern Faces;
- confusion with CDI scopes/naming.

## 13.3 Replacement

```java
@Named("login")
@SessionScoped
public class LoginBean implements Serializable {
    ...
}
```

using CDI scope:

```java
jakarta.enterprise.context.SessionScoped
```

## 13.4 ManagedProperty replacement

Old:

```java
@ManagedProperty("#{userService}")
private UserService userService;
```

New:

```java
@Inject
private UserService userService;
```

## 13.5 Eager application bean replacement

Old Faces eager application bean can be replaced by observing application initialized event.

## 13.6 Rule

For Faces backing beans:

```text
Use CDI @Named + CDI/Faces CDI-compatible scopes.
```

---

# 14. Kenapa CDI Menggantikan Managed Beans?

CDI solves more problems:

- typesafe injection;
- qualifiers;
- producers;
- disposers;
- events;
- decorators;
- interceptors;
- alternatives;
- stereotypes;
- portable extensions/build compatible extensions;
- normal scopes;
- contextual lifecycle;
- integration across Jakarta EE specs.

## 14.1 Single component model

Jakarta EE 11 direction is to make CDI the single component model used across EE.

## 14.2 Better composition

CDI lets you write:

```java
@Inject
@Primary
PaymentGateway gateway;
```

## 14.3 Better testability

Producers/alternatives/test containers.

## 14.4 Better extensibility

Extensions.

## 14.5 Better integration

REST, Faces, Validation, Transactions, Security, Persistence, etc. all integrate with CDI in modern Jakarta EE.

## 14.6 Less duplicate bean systems

Removes confusion from multiple managed bean models.

---

# 15. CDI sebagai Single Component Model

For modern Jakarta EE:

```java
@ApplicationScoped
public class OrderService {
    @Inject PaymentRepository repository;
}
```

## 15.1 Named backing bean

```java
@Named
@RequestScoped
public class OrderForm {
    @Inject OrderService orderService;
}
```

## 15.2 Qualifier

```java
@Qualifier
@Retention(RUNTIME)
@Target({FIELD, PARAMETER, METHOD, TYPE})
public @interface Main {}
```

## 15.3 Producer

```java
@Produces
@Main
DataSource dataSource() { ... }
```

## 15.4 Event

```java
@Inject
Event<OrderSubmitted> event;
```

## 15.5 Interceptor

```java
@Audited
public void submit() { ... }
```

## 15.6 Modern baseline

If you need container-managed object, think CDI first.

---

# 16. Migration Pattern 1: `@ManagedBean` → CDI `@Named`

## 16.1 Before

```java
import jakarta.annotation.ManagedBean;

@ManagedBean("reportBean")
public class ReportBean {

    @Resource(lookup = "java:comp/env/jdbc/Main")
    private DataSource dataSource;

    @PostConstruct
    void init() { ... }
}
```

## 16.2 After

```java
import jakarta.enterprise.context.RequestScoped;
import jakarta.inject.Named;

@Named("reportBean")
@RequestScoped
public class ReportBean {

    @Inject
    ReportService reportService;

    @PostConstruct
    void init() { ... }
}
```

## 16.3 Preserve name

If view uses:

```text
#{reportBean}
```

preserve:

```java
@Named("reportBean")
```

## 16.4 Add scope intentionally

Do not rely on default `@Dependent` accidentally.

Choose:

- `@RequestScoped` for request form/controller;
- `@ViewScoped` for Faces view;
- `@SessionScoped` for user session state;
- `@ApplicationScoped` for shared singleton-like service;
- `@Dependent` for dependent helper.

## 16.5 Move resource access

Put JNDI/resource injection into producer/service layer if possible.

---

# 17. Migration Pattern 2: Faces Managed Bean → CDI Backing Bean

## 17.1 Before

```java
import javax.faces.bean.ManagedBean;
import javax.faces.bean.ViewScoped;

@ManagedBean(name = "userForm")
@ViewScoped
public class UserForm implements Serializable {
    private String email;

    public String save() {
        ...
        return "success";
    }
}
```

## 17.2 After

```java
import jakarta.inject.Named;
import jakarta.faces.view.ViewScoped;

@Named("userForm")
@ViewScoped
public class UserForm implements Serializable {
    private String email;

    @Inject
    UserService userService;

    public String save() {
        ...
        return "success";
    }
}
```

## 17.3 Use correct ViewScoped

Modern Faces CDI-compatible view scope:

```java
jakarta.faces.view.ViewScoped
```

not old:

```java
javax.faces.bean.ViewScoped
```

## 17.4 ManagedProperty

Before:

```java
@ManagedProperty("#{userService}")
private UserService userService;
```

After:

```java
@Inject
private UserService userService;
```

## 17.5 Serialization

View/session scoped beans should implement `Serializable`.

Injected dependencies should be proxyable/serializable as needed by runtime.

## 17.6 Test navigation/action

Faces lifecycle can reveal migration issues.

---

# 18. Migration Pattern 3: Managed Bean Resource Injection → CDI Producer/Config

## 18.1 Before

```java
@ManagedBean
public class LegacyMailer {

    @Resource(lookup = "java:comp/env/mail/Main")
    private Session mailSession;
}
```

## 18.2 Producer

```java
@ApplicationScoped
public class MailSessionProducer {

    @Resource(lookup = "java:comp/env/mail/Main")
    private Session mailSession;

    @Produces
    @MainMail
    public Session mailSession() {
        return mailSession;
    }
}
```

## 18.3 Consumer

```java
@ApplicationScoped
public class Mailer {

    @Inject
    @MainMail
    Session mailSession;
}
```

## 18.4 Benefits

- centralizes lookup;
- enables qualifier;
- improves testing;
- reduces string duplication;
- separates infrastructure from business logic.

## 18.5 Alternative

Use MicroProfile Config or Jakarta Config if available for non-container resources.

## 18.6 Test

Use test producer/alternative.

---

# 19. Migration Pattern 4: Interceptors ke CDI Interceptor Binding

## 19.1 Before

Legacy managed bean with interceptor.

## 19.2 Define binding

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface Audited {}
```

## 19.3 Interceptor

```java
@Audited
@Interceptor
@Priority(Interceptor.Priority.APPLICATION)
public class AuditInterceptor {
    @AroundInvoke
    Object audit(InvocationContext ctx) throws Exception {
        ...
        return ctx.proceed();
    }
}
```

## 19.4 Usage

```java
@Audited
@ApplicationScoped
public class PaymentService {
    public void pay() { ... }
}
```

## 19.5 Verify activation

CDI interceptors require binding and enablement.

`@Priority` enables globally.

## 19.6 Common failure

No interceptor runs because annotation is not `@InterceptorBinding`.

## 19.7 Self-invocation

Same caveat as many proxy/interceptor models.

---

# 20. Migration Pattern 5: Eager Application Bean

## 20.1 Legacy eager bean

Faces ManagedBean had eager application-scope concept.

## 20.2 CDI replacement

Observe initialized event:

```java
@ApplicationScoped
public class StartupInitializer {

    void onStart(@Observes @Initialized(ApplicationScoped.class) Object event) {
        ...
    }
}
```

## 20.3 Or use Startup feature if runtime provides

Some runtimes/frameworks have startup annotations/features.

Use standard CDI event where possible.

## 20.4 Keep startup light

Do not block startup with long external calls unless necessary.

## 20.5 Failure policy

If init fails, should app fail startup or degrade?

Decide.

## 20.6 Observability

Log startup tasks and duration.

---

# 21. Legacy Code Smell Checklist

Look for imports:

```java
javax.annotation.ManagedBean
jakarta.annotation.ManagedBean
javax.faces.bean.ManagedBean
jakarta.faces.bean.ManagedBean
javax.faces.bean.ManagedProperty
javax.faces.bean.RequestScoped
javax.faces.bean.SessionScoped
javax.faces.bean.ApplicationScoped
```

## 21.1 Smells

- `@ManagedBean` without CDI;
- old Faces scopes;
- `@ManagedProperty`;
- no explicit CDI scope after migration;
- session bean not serializable;
- resource lookup strings duplicated;
- business logic in JSF backing bean;
- bean names relying on default naming;
- old `javax` imports in Jakarta app;
- mixed CDI and Faces managed bean models.

## 21.2 Migration priority

1. Faces managed beans.
2. `@ManagedBean` annotation.
3. Resource injection centralization.
4. Scope correctness.
5. Interceptors.
6. Tests.

## 21.3 Use static analysis

Search imports and annotations.

## 21.4 Run app with strict logs

Bean discovery ambiguities often show at startup.

---

# 22. Design Guideline untuk Kode Baru

## 22.1 Use CDI

```java
@ApplicationScoped
public class Service { ... }
```

## 22.2 Use `@Named` only for EL exposure

Not every CDI bean needs `@Named`.

Use:

```java
@Named
@RequestScoped
public class UserForm { ... }
```

for Faces/EL.

## 22.3 Service beans do not need `@Named`

```java
@ApplicationScoped
public class UserService { ... }
```

## 22.4 Choose scope intentionally

Do not omit scope because you are unsure.

## 22.5 Keep backing bean thin

Faces form bean should delegate to service.

## 22.6 Use qualifiers

Avoid string-based names for injection.

## 22.7 Use producers for resources

Centralize external resources.

## 22.8 Avoid legacy annotations

Do not introduce `@ManagedBean`.

---

# 23. Testing Strategy

## 23.1 Compile-time migration test

Fail build if old imports exist.

Examples:

```text
javax.faces.bean.*
jakarta.faces.bean.ManagedBean
jakarta.annotation.ManagedBean
```

depending target.

## 23.2 CDI boot test

Start CDI container and verify injection.

## 23.3 Faces integration test

Render page and execute form action.

## 23.4 Scope test

Verify request/view/session behavior.

## 23.5 Serialization test

For session/view scoped beans.

## 23.6 Interceptor test

Verify interceptor invoked once.

## 23.7 Resource producer test

Use alternative/test producer.

## 23.8 Name preservation test

Evaluate EL expressions:

```text
#{loginBean}
#{userForm}
```

## 23.9 Regression test

Old behavior vs migrated behavior.

---

# 24. Production Failure Modes

## 24.1 Bean not found after upgrade

Cause:

- `@ManagedBean` removed/ignored;
- missing `@Named`;
- wrong bean name;
- CDI discovery issue.

## 24.2 Scope changed accidentally

Cause:

- forgot CDI scope, bean becomes `@Dependent`.

## 24.3 Session serialization failure

Cause:

- CDI `@SessionScoped` bean not serializable.

## 24.4 Injection fails

Cause:

- `@ManagedProperty` not migrated to `@Inject`;
- ambiguous CDI dependency;
- missing producer.

## 24.5 Interceptor not invoked

Cause:

- interceptor binding missing;
- self-invocation;
- interceptor not enabled.

## 24.6 Startup task not executed

Cause:

- eager ManagedBean replaced with lazy CDI bean but no startup observer.

## 24.7 Bean name collision

Cause:

- two `@Named("login")`.

## 24.8 Resource lookup fails

Cause:

- JNDI name changed;
- resource producer not initialized;
- container resource missing.

## 24.9 Legacy `javax` import remains

Cause:

- partial migration.

## 24.10 Faces page still uses old scope package

Cause:

- old annotation import in bean.

---

# 25. Best Practices dan Anti-Patterns

## 25.1 Best practices

- Use CDI for all new managed components.
- Use `@Named` only when needed by EL.
- Preserve bean names during migration.
- Choose CDI scope intentionally.
- Use CDI producers for resources.
- Replace `@ManagedProperty` with `@Inject`.
- Replace Faces scopes with CDI/Faces CDI-compatible scopes.
- Keep backing beans thin.
- Test lifecycle and scope behavior.
- Search imports, not just annotation names.
- Do not mix old Faces Managed Beans and CDI.

## 25.2 Anti-pattern: new code with `@ManagedBean`

Do not use deprecated/removed model.

## 25.3 Anti-pattern: all CDI beans `@Named`

Only EL-facing beans need names.

## 25.4 Anti-pattern: business logic in Faces backing bean

Delegate to service.

## 25.5 Anti-pattern: default `@Dependent` accidentally

Add intended scope.

## 25.6 Anti-pattern: string-based dependency through EL

Use typesafe `@Inject`.

## 25.7 Anti-pattern: migration without tests

Scope/lifecycle bugs are subtle.

---

# 26. Checklist Review

## 26.1 Discovery

- [ ] Search imports for `ManagedBean`.
- [ ] Distinguish annotation package.
- [ ] Identify Faces legacy beans.
- [ ] Identify `@ManagedProperty`.
- [ ] Identify old Faces scopes.
- [ ] Identify eager application beans.

## 26.2 Migration

- [ ] Replace with CDI `@Named` if EL needs it.
- [ ] Add correct CDI/Faces scope.
- [ ] Replace `@ManagedProperty` with `@Inject`.
- [ ] Add producers/qualifiers for resources.
- [ ] Preserve bean names.
- [ ] Verify serialization.
- [ ] Verify interceptors.
- [ ] Verify startup observers.

## 26.3 Jakarta EE 11

- [ ] No dependency on Managed Beans removal.
- [ ] No deprecated `@ManagedBean`.
- [ ] CDI enabled.
- [ ] Faces pages updated.
- [ ] Tests run on target runtime.

## 26.4 Production

- [ ] Bean resolution logs clean.
- [ ] Scope behavior tested.
- [ ] Resource lookup tested.
- [ ] Startup behavior tested.
- [ ] Rollback plan.

---

# 27. Case Study 1: `@ManagedBean` Tidak Jalan Setelah Upgrade Jakarta EE 11

## 27.1 Problem

Legacy code:

```java
@ManagedBean("jobRunner")
public class JobRunner { ... }
```

After upgrade, bean not created/resolved.

## 27.2 Root cause

Managed Beans removed from Jakarta EE 11; `@ManagedBean` should be replaced by CDI.

## 27.3 Fix

```java
@Named("jobRunner")
@ApplicationScoped
public class JobRunner { ... }
```

If startup required:

```java
void onStart(@Observes @Initialized(ApplicationScoped.class) Object event) {
    ...
}
```

## 27.4 Test

- CDI boot;
- EL resolution if used;
- lifecycle;
- startup behavior.

## 27.5 Lesson

`@ManagedBean` was not just renamed; the component model moved to CDI.

---

# 28. Case Study 2: JSF/Faces `@ManagedBean` ke CDI `@Named`

## 28.1 Before

```java
@ManagedBean(name = "loginBean")
@SessionScoped
public class LoginBean implements Serializable {

    @ManagedProperty("#{authService}")
    private AuthService authService;
}
```

## 28.2 After

```java
@Named("loginBean")
@SessionScoped
public class LoginBean implements Serializable {

    @Inject
    private AuthService authService;
}
```

Imports:

```java
jakarta.inject.Named
jakarta.enterprise.context.SessionScoped
jakarta.inject.Inject
```

## 28.3 Common mistake

Using old:

```java
javax.faces.bean.SessionScoped
```

with CDI `@Named`.

Wrong.

## 28.4 Test

Login flow, session persistence, serialization.

## 28.5 Lesson

Migration is annotation package + scope semantics + injection model.

---

# 29. Case Study 3: Resource Injection Legacy ke CDI Producer

## 29.1 Before

Multiple beans:

```java
@Resource(lookup = "java:comp/env/jdbc/Main")
DataSource ds;
```

duplicated everywhere.

## 29.2 After

Central producer:

```java
@ApplicationScoped
public class Resources {

    @Resource(lookup = "java:comp/env/jdbc/Main")
    DataSource main;

    @Produces
    @MainDataSource
    DataSource main() {
        return main;
    }
}
```

Consumer:

```java
@Inject
@MainDataSource
DataSource ds;
```

## 29.3 Benefits

- one lookup string;
- qualifier;
- easier testing;
- clearer dependency.

## 29.4 Lesson

CDI migration is chance to improve architecture, not only annotation replacement.

---

# 30. Case Study 4: Bean Name Collision Setelah Migrasi

## 30.1 Problem

Two classes:

```java
@Named
public class UserBean { ... }
```

in different packages.

Both default name:

```text
userBean
```

## 30.2 Result

Ambiguous EL resolution or deployment error depending context.

## 30.3 Fix

Explicit names:

```java
@Named("adminUserBean")
@Named("profileUserBean")
```

or only expose one to EL.

## 30.4 Better design

Service beans do not need `@Named`.

Only UI backing beans need names.

## 30.5 Lesson

Do not put `@Named` on every CDI bean.

---

# 31. Latihan Bertahap

## Latihan 1 — Import audit

Create script to find:

```text
ManagedBean
ManagedProperty
javax.faces.bean
jakarta.faces.bean
```

## Latihan 2 — Convert `@ManagedBean`

Replace with `@Named` + scope.

## Latihan 3 — Convert Faces SessionScoped

Replace old Faces scope with CDI scope.

## Latihan 4 — Convert `@ManagedProperty`

Replace with `@Inject`.

## Latihan 5 — Resource producer

Create `DataSource` producer with qualifier.

## Latihan 6 — Interceptor migration

Create CDI interceptor binding.

## Latihan 7 — Startup observer

Replace eager application bean.

## Latihan 8 — EL test

Evaluate `#{beanName}`.

## Latihan 9 — Serialization test

Test session/view scoped bean serialization.

## Latihan 10 — Runtime test

Run app on Jakarta EE 11 runtime.

---

# 32. Mini Project: Managed Beans to CDI Migration Lab

## 32.1 Goal

Create:

```text
managed-beans-to-cdi-migration-lab/
```

## 32.2 Modules

```text
legacy-annotation-managedbean/
legacy-faces-managedbean/
cdi-named-bean/
scope-migration/
managedproperty-to-inject/
resource-producer/
interceptor-migration/
startup-observer/
bean-name-collision/
jakarta-ee11-runtime-test/
```

## 32.3 Deliverables

```text
README.md
MANAGED-BEANS-HISTORY.md
ANNOTATION-DIFFERENCES.md
CDI-MIGRATION.md
FACES-MIGRATION.md
SCOPES.md
RESOURCE-PRODUCERS.md
INTERCEPTORS.md
FAILURE-MODES.md
CHECKLIST.md
```

## 32.4 Required experiments

1. Show old `@ManagedBean` compile/runtime issue.
2. Migrate to CDI `@Named`.
3. Preserve EL name.
4. Replace Faces scope.
5. Replace `@ManagedProperty`.
6. Add producer/qualifier.
7. Add CDI interceptor.
8. Add startup observer.
9. Trigger bean name collision.
10. Run on target Jakarta EE 11 runtime.

## 32.5 Evaluation questions

1. What is Jakarta Managed Beans?
2. Why is `@ManagedBean` deprecated/removed?
3. Difference between `jakarta.annotation.ManagedBean` and Faces `ManagedBean`?
4. Why is CDI preferred?
5. What does `@Named` do?
6. Why not put `@Named` on all beans?
7. What scope should a Faces form bean use?
8. How to replace `@ManagedProperty`?
9. How to replace eager application bean?
10. What breaks during Jakarta EE 11 upgrade?

---

# 33. Referensi Resmi

Referensi utama:

1. Jakarta Managed Beans  
   https://jakarta.ee/specifications/managedbeans/

2. Jakarta Managed Beans 2.0  
   https://jakarta.ee/specifications/managedbeans/2.0/

3. Jakarta Managed Beans 2.0 Specification  
   https://jakarta.ee/specifications/managedbeans/2.0/jakarta-managed-beans-spec-2.0

4. Jakarta EE 10 API — `jakarta.annotation.ManagedBean`  
   https://jakarta.ee/specifications/platform/10/apidocs/jakarta/annotation/managedbean

5. Jakarta EE 11 Release  
   https://jakarta.ee/release/11/

6. Jakarta EE 11 Release Plan  
   https://jakartaee.github.io/platform/jakartaee11/JakartaEE11ReleasePlan

7. Jakarta CDI 4.1  
   https://jakarta.ee/specifications/cdi/4.1/

8. Jakarta Faces 4.1  
   https://jakarta.ee/specifications/faces/4.1/

9. Jakarta EE 8 API — Faces `javax.faces.bean.ManagedBean`  
   https://jakarta.ee/specifications/platform/8/apidocs/javax/faces/bean/managedbean

10. Jakarta Common Annotations  
    https://jakarta.ee/specifications/annotations/

---

# Penutup

Jakarta Managed Beans adalah konsep historis untuk container-managed POJO dengan basic services.

Mental model lama:

```text
@ManagedBean
  ↓
container creates POJO
  ↓
resource injection + lifecycle callbacks + interceptors
```

Mental model modern:

```text
CDI bean
  ↓
typesafe injection
  ↓
scopes
  ↓
qualifiers
  ↓
producers
  ↓
events
  ↓
interceptors/decorators
  ↓
integration across Jakarta EE
```

Hal paling penting:

```text
Untuk Jakarta EE 11 dan kode baru, gunakan CDI.
Managed Beans adalah pengetahuan legacy/migration.
```

Jangan tertipu oleh nama annotation yang sama.

Selalu cek import:

```java
jakarta.annotation.ManagedBean        // legacy Managed Beans/Common Annotations
javax.faces.bean.ManagedBean          // legacy Faces/JSF managed bean
jakarta.inject.Named                  // CDI named bean for EL
```

Engineer top-tier tidak hanya mengganti annotation. Ia memahami perubahan component model, scope, lifecycle, injection, proxy, serialization, interceptor activation, EL naming, startup behavior, dan resource boundary.

Bagian berikutnya akan membahas **Jakarta Config / Configuration-related model** bila relevan terhadap stack Jakarta modern, lalu dilanjutkan ke bagian synthesis tentang **Jakarta EE application architecture, migration strategy, runtime selection, and production readiness**.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-jakarta-part-036.md](./learn-java-jakarta-part-036.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-java-jakarta-part-038.md](./learn-java-jakarta-part-038.md)

</div>