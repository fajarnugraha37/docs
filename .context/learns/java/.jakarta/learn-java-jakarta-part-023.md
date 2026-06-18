# learn-java-jakarta-part-023.md

# Bagian 23 — Jakarta Enterprise Beans (`jakarta.ejb`): Session Bean, MDB, Transaction, Security, Timer, dan Legacy-Modern Boundary

> Target pembaca: Java engineer yang ingin memahami Jakarta Enterprise Beans / EJB dengan perspektif modern. Bukan sekadar “teknologi lama”, tetapi sebagai model komponen container-managed yang pernah menjadi pusat enterprise Java dan masih muncul di banyak sistem production, vendor runtime, aplikasi government/finance/telco, dan integrasi legacy.
>
> Fokus bagian ini: Jakarta Enterprise Beans 4.0, Enterprise Beans Lite vs Full, stateless/stateful/singleton session bean, no-interface view, local/remote view, transaction/security/interceptor model, timers, asynchronous methods, message-driven bean, concurrency, lifecycle, dependency injection, portability, modern relevance, migration to CDI/Jakarta Concurrency/Jakarta Messaging, dan failure modes production.

---

## Daftar Isi

1. [Orientasi: Kenapa Masih Perlu Memahami Enterprise Beans?](#1-orientasi-kenapa-masih-perlu-memahami-enterprise-beans)
2. [Mental Model: EJB sebagai Container-Managed Business Component](#2-mental-model-ejb-sebagai-container-managed-business-component)
3. [Jakarta Enterprise Beans 4.0 dalam Jakarta EE 11](#3-jakarta-enterprise-beans-40-dalam-jakarta-ee-11)
4. [Enterprise Beans Lite vs Full](#4-enterprise-beans-lite-vs-full)
5. [EJB vs CDI vs Spring Bean vs Jakarta Concurrency](#5-ejb-vs-cdi-vs-spring-bean-vs-jakarta-concurrency)
6. [Dependency, Packaging, dan Runtime](#6-dependency-packaging-dan-runtime)
7. [Peta API `jakarta.ejb`](#7-peta-api-jakartaejb)
8. [Session Beans: Stateless, Stateful, Singleton](#8-session-beans-stateless-stateful-singleton)
9. [Stateless Session Bean](#9-stateless-session-bean)
10. [Stateful Session Bean](#10-stateful-session-bean)
11. [Singleton Session Bean](#11-singleton-session-bean)
12. [No-Interface View, Local View, Remote View](#12-no-interface-view-local-view-remote-view)
13. [`@EJB` Injection dan Lookup](#13-ejb-injection-dan-lookup)
14. [EJB Lifecycle](#14-ejb-lifecycle)
15. [Callbacks: `@PostConstruct`, `@PreDestroy`, `@PostActivate`, `@PrePassivate`, `@Remove`](#15-callbacks-postconstruct-predestroy-postactivate-prepassivate-remove)
16. [Transaction Management](#16-transaction-management)
17. [Container-Managed Transaction / CMT](#17-container-managed-transaction--cmt)
18. [Bean-Managed Transaction / BMT](#18-bean-managed-transaction--bmt)
19. [Transaction Attributes: REQUIRED, REQUIRES_NEW, MANDATORY, SUPPORTS, NOT_SUPPORTED, NEVER](#19-transaction-attributes-required-requires_new-mandatory-supports-not_supported-never)
20. [Rollback Rules dan Exception Semantics](#20-rollback-rules-dan-exception-semantics)
21. [Security: Roles, RunAs, CallerPrincipal](#21-security-roles-runas-callerprincipal)
22. [Interceptors di EJB](#22-interceptors-di-ejb)
23. [Asynchronous EJB Methods](#23-asynchronous-ejb-methods)
24. [EJB Timer Service](#24-ejb-timer-service)
25. [Programmatic Timer dan Calendar Timer](#25-programmatic-timer-dan-calendar-timer)
26. [Singleton Concurrency: Container-Managed vs Bean-Managed](#26-singleton-concurrency-container-managed-vs-bean-managed)
27. [Message-Driven Beans / MDB](#27-message-driven-beans--mdb)
28. [MDB vs JMS Consumer Manual vs Jakarta Messaging Worker](#28-mdb-vs-jms-consumer-manual-vs-jakarta-messaging-worker)
29. [Pooling, Passivation, dan Instance Management](#29-pooling-passivation-dan-instance-management)
30. [Exception Handling dan Remote Boundary](#30-exception-handling-dan-remote-boundary)
31. [EJB dan CDI Integration](#31-ejb-dan-cdi-integration)
32. [EJB dan Jakarta Persistence](#32-ejb-dan-jakarta-persistence)
33. [EJB dan Jakarta REST / Servlet](#33-ejb-dan-jakarta-rest--servlet)
34. [Modern Relevance: Kapan EJB Masih Tepat?](#34-modern-relevance-kapan-ejb-masih-tepat)
35. [Kapan Jangan Memakai EJB?](#35-kapan-jangan-memakai-ejb)
36. [Migration Strategy: EJB ke CDI/Jakarta Concurrency/Jakarta Messaging](#36-migration-strategy-ejb-ke-cdijakarta-concurrencyjakarta-messaging)
37. [Observability](#37-observability)
38. [Testing Strategy](#38-testing-strategy)
39. [Production Failure Modes](#39-production-failure-modes)
40. [Best Practices dan Anti-Patterns](#40-best-practices-dan-anti-patterns)
41. [Checklist Review](#41-checklist-review)
42. [Case Study 1: Stateless Service dengan Transaction Boundary](#42-case-study-1-stateless-service-dengan-transaction-boundary)
43. [Case Study 2: Stateful Wizard yang Bocor Memory](#43-case-study-2-stateful-wizard-yang-bocor-memory)
44. [Case Study 3: Singleton Cache dengan Lock Bottleneck](#44-case-study-3-singleton-cache-dengan-lock-bottleneck)
45. [Case Study 4: MDB dan Poison Message](#45-case-study-4-mdb-dan-poison-message)
46. [Latihan Bertahap](#46-latihan-bertahap)
47. [Mini Project: Jakarta Enterprise Beans Modernization Lab](#47-mini-project-jakarta-enterprise-beans-modernization-lab)
48. [Referensi Resmi](#48-referensi-resmi)

---

# 1. Orientasi: Kenapa Masih Perlu Memahami Enterprise Beans?

Banyak developer modern menganggap EJB sebagai “masa lalu”.

Sebagian benar: untuk banyak aplikasi baru, CDI + Jakarta Transactions + Jakarta Persistence + Jakarta REST + Jakarta Concurrency/Jakarta Messaging sering lebih natural, ringan, dan cloud-friendly.

Namun EJB belum hilang dari dunia nyata.

Kamu masih akan menemukannya di:

- aplikasi legacy Java EE/Jakarta EE;
- government systems;
- banking/insurance/telco;
- enterprise monolith;
- application server runtime besar;
- sistem dengan MDB/JMS;
- sistem dengan remote EJB;
- aplikasi yang heavily menggunakan CMT;
- produk vendor lama;
- migrasi `javax.*` ke `jakarta.*`.

## 1.1 Kenapa top-tier engineer harus paham EJB?

Karena engineer kuat tidak hanya tahu teknologi terbaru. Ia bisa:

- membaca codebase lama dengan cepat;
- memahami transaction boundary tersembunyi;
- memahami kenapa method call ternyata remote;
- mendeteksi stateful bean memory leak;
- memahami MDB redelivery;
- memahami container-managed transaction;
- memahami singleton lock bottleneck;
- memigrasi EJB ke CDI/concurrency/messaging dengan aman;
- menjaga production system sambil modernization.

## 1.2 EJB bukan sekadar annotation

Contoh:

```java
@Stateless
public class PaymentService {
    public void pay(PaymentCommand command) {
        ...
    }
}
```

Kelihatannya seperti bean biasa.

Tapi container memberi banyak behavior:

- pooling;
- lifecycle callbacks;
- transaction demarcation;
- security interception;
- concurrency control;
- remote/local invocation;
- timer service;
- MDB activation;
- injection;
- passivation for stateful beans.

Itulah mental model yang perlu dipahami.

## 1.3 EJB sebagai “container contract”

EJB adalah kontrak antara application component dan EJB container.

Aplikasi berkata:

```text
Ini business component.
Tolong container kelola lifecycle, transaction, security, concurrency, pooling, remoting, timer, message delivery.
```

Container memberi:

```text
managed runtime semantics.
```

---

# 2. Mental Model: EJB sebagai Container-Managed Business Component

EJB container adalah runtime di dalam Jakarta EE server yang mengelola enterprise bean.

## 2.1 Container-managed services

EJB container dapat menyediakan:

- dependency injection;
- transaction;
- security;
- concurrency;
- lifecycle;
- pooling;
- remote access;
- timer service;
- asynchronous invocation;
- message-driven consumption;
- interceptor chain;
- naming/lookup;
- integration dengan persistence/messaging.

## 2.2 Invocation through proxy

EJB biasanya dipanggil melalui container proxy.

```text
client
  ↓
EJB proxy/interceptor
  ↓
security check
  ↓
transaction begin/join
  ↓
bean method
  ↓
transaction commit/rollback
  ↓
return
```

## 2.3 Self-invocation problem

Jika bean method memanggil method lain pada `this`, container interceptor mungkin tidak berlaku.

Bad:

```java
@Stateless
public class CaseService {

    public void approve() {
        this.auditInNewTransaction(); // may bypass proxy
    }

    @TransactionAttribute(REQUIRES_NEW)
    public void auditInNewTransaction() {
        ...
    }
}
```

Better:

```java
@EJB
CaseService self;

public void approve() {
    self.auditInNewTransaction();
}
```

atau pindahkan ke bean lain.

## 2.4 Annotation means runtime semantics

Annotations seperti:

```java
@Stateless
@TransactionAttribute(REQUIRED)
@RolesAllowed("ADMIN")
@Asynchronous
@Schedule(...)
```

bukan dekorasi metadata pasif. Mereka mengubah behavior runtime.

## 2.5 Business component vs domain model

EJB bukan domain entity.

EJB adalah service/component boundary.

Domain model bisa tetap POJO.

---

# 3. Jakarta Enterprise Beans 4.0 dalam Jakarta EE 11

Jakarta Enterprise Beans 4.0 mendefinisikan architecture untuk development dan deployment component-based business applications.

Versi 4.0 pertama kali dirilis untuk Jakarta EE 9 dengan perubahan utama namespace `jakarta.*`. Namun Jakarta EE 11 Platform masih mencantumkan Enterprise Beans 4.0, dan Web Profile mencantumkan Enterprise Beans Lite 4.0.

## 3.1 Package modern

```java
jakarta.ejb
```

Old namespace:

```java
javax.ejb
```

## 3.2 Jakarta EE 11 positioning

Di Jakarta EE 11:

- Enterprise Beans 4.0 ada di Platform;
- Enterprise Beans Lite 4.0 ada di Web Profile.

Artinya EJB masih ada dalam platform modern, tetapi kamu harus paham subset dan relevansi.

## 3.3 Jakarta EE 11 removes optional specs/features

Jakarta EE 11 menurunkan barrier vendor dengan menghapus optional specifications/features tertentu. Namun EJB core/lite tetap relevan di platform/profile sesuai daftar release.

## 3.4 EJB 4.1 under development

Jakarta Enterprise Beans 4.1 under development untuk Jakarta EE 12.

Untuk target Jakarta EE 11, gunakan 4.0.

## 3.5 Modern caution

Walaupun ada di platform, bukan berarti EJB selalu pilihan terbaik untuk aplikasi baru.

Pertimbangkan:

- CDI;
- Jakarta Transactions;
- Jakarta Concurrency;
- Jakarta Messaging;
- Jakarta Batch;
- MicroProfile;
- cloud-native constraints;
- runtime support.

---

# 4. Enterprise Beans Lite vs Full

## 4.1 Enterprise Beans Lite

Subset yang lebih ringan.

Biasanya mencakup fitur inti session bean yang umum untuk Web Profile.

Gunakan untuk:

- stateless services;
- singleton services;
- transaction/security/interceptor model;
- local/no-interface use case.

## 4.2 Enterprise Beans Full

Mencakup fitur yang lebih luas, termasuk fitur seperti remote access, MDB, timer service, dan historical/optional capabilities sesuai spec/runtime.

## 4.3 Kenapa ada Lite?

Untuk mengurangi complexity dan memberi subset yang cukup untuk banyak web applications.

## 4.4 Runtime support

Tidak semua runtime/profile menyediakan full EJB.

Cek:

```text
Jakarta EE Platform vs Web Profile vs Core Profile
```

## 4.5 Decision

Jika kamu butuh MDB/timer/remote EJB, pastikan runtime mendukung Enterprise Beans Full.

Jika hanya butuh transactional local service, CDI + `@Transactional` atau EJB Lite bisa dipertimbangkan.

---

# 5. EJB vs CDI vs Spring Bean vs Jakarta Concurrency

## 5.1 EJB

Strengths:

- container-managed transaction;
- security;
- pooling;
- timer;
- MDB;
- remote/local business view;
- enterprise app server integration.

## 5.2 CDI

Strengths:

- dependency injection;
- scopes/context;
- events;
- producers;
- interceptors/decorators;
- lightweight component model.

## 5.3 Spring Bean

Spring ecosystem component.

Similar in service concept but different runtime/model.

## 5.4 Jakarta Concurrency

For async tasks and managed executors.

Not business component model by itself.

## 5.5 Typical modern choice

For new Jakarta apps:

```text
CDI bean + @Transactional
```

often replaces simple stateless EJB.

For JMS consumption:

```text
MDB
```

may still be convenient in full Jakarta EE runtime.

For scheduled jobs:

```text
EJB Timer
```

can be okay, but Jakarta Batch/external scheduler may be better for durable batch workflows.

## 5.6 Rule

Choose EJB when you need EJB container semantics.

Do not use EJB only because old tutorials did.

---

# 6. Dependency, Packaging, dan Runtime

## 6.1 API dependency

```xml
<dependency>
  <groupId>jakarta.ejb</groupId>
  <artifactId>jakarta.ejb-api</artifactId>
  <version>4.0.0</version>
  <scope>provided</scope>
</dependency>
```

## 6.2 Runtime

Need Jakarta EE runtime supporting Enterprise Beans:

- GlassFish;
- Payara;
- WildFly;
- Open Liberty;
- WebLogic;
- other compatible app servers.

## 6.3 Packaging

EJB can be packaged in:

- EJB JAR;
- WAR with EJB classes;
- EAR containing modules.

Modern simplified packaging allows EJB modules inside web applications in many environments.

## 6.4 API jar is not container

Adding `jakarta.ejb-api` does not make EJB work.

You need EJB container/runtime.

## 6.5 Classpath warning

Do not bundle API duplicate if app server provides it.

## 6.6 Runtime feature flags

Some runtimes require enabling feature/module:

```text
enterpriseBeans-4.0
enterpriseBeansLite-4.0
```

Exact config depends runtime.

---

# 7. Peta API `jakarta.ejb`

Important annotations/classes:

```java
@Stateless
@Stateful
@Singleton
@MessageDriven
@EJB
@EJBs
@Local
@Remote
@LocalBean
@TransactionManagement
@TransactionAttribute
@TransactionAttributeType
@Asynchronous
@Schedule
@Schedules
@Timeout
@Timer
@TimerService
@Startup
@DependsOn
@Lock
@LockType
@AccessTimeout
@ConcurrencyManagement
@ConcurrencyManagementType
@StatefulTimeout
@Remove
@Init
@ApplicationException
SessionContext
EJBContext
MessageDrivenContext
```

## 7.1 Session bean annotations

```java
@Stateless
@Stateful
@Singleton
```

## 7.2 Injection/lookup

```java
@EJB
```

## 7.3 Transaction annotations

```java
@TransactionManagement
@TransactionAttribute
```

## 7.4 Timer annotations

```java
@Schedule
@Timeout
```

## 7.5 Concurrency annotations

```java
@Lock
@AccessTimeout
@ConcurrencyManagement
```

## 7.6 Security integration

Security annotations from `jakarta.annotation.security` often used:

```java
@RolesAllowed
@PermitAll
@DenyAll
@RunAs
```

## 7.7 Context

```java
@Resource
SessionContext sessionContext;
```

---

# 8. Session Beans: Stateless, Stateful, Singleton

Session bean represents business logic.

There are three main kinds:

```text
Stateless
Stateful
Singleton
```

## 8.1 Stateless

No conversational state for a specific client.

Container can pool instances.

## 8.2 Stateful

Maintains conversational state for a specific client/session.

Can be passivated/activated.

## 8.3 Singleton

Single shared instance per application.

Useful for shared state/config/cache/scheduler coordinator.

## 8.4 Choosing

| Need | Bean |
|---|---|
| transactional service | Stateless |
| per-client conversational workflow | Stateful |
| application-wide shared singleton | Singleton |
| message listener | MDB |
| simple CDI service | CDI bean |
| async task | ManagedExecutorService |
| durable batch | Jakarta Batch |
| durable message processing | JMS/MDB |

## 8.5 Modern caution

Stateful beans and singleton mutable state are easy to misuse.

Prefer stateless design unless stateful semantics are explicitly needed.

---

# 9. Stateless Session Bean

## 9.1 Example

```java
@Stateless
public class CaseApprovalService {

    @PersistenceContext
    EntityManager em;

    public void approve(UUID caseId) {
        CaseEntity c = em.find(CaseEntity.class, caseId);
        c.approve();
    }
}
```

## 9.2 Characteristics

- no client-specific conversational state;
- instances can be pooled;
- each method call independent from specific instance state;
- good for services/use cases;
- supports transaction/security/interceptors.

## 9.3 Instance variables

Allowed for shared dependencies/config, not per-client state.

Bad:

```java
private UUID currentCaseId;
```

Good:

```java
@Inject
AuditService auditService;
```

## 9.4 Pooling

Container can reuse instances across calls.

Do not assume same instance.

## 9.5 Transaction default

EJB methods often default to container-managed transaction with `REQUIRED`, depending bean/method context.

Be explicit when important.

## 9.6 Stateless vs CDI service

A CDI bean with `@Transactional` may be enough in modern Jakarta.

Use stateless EJB if runtime semantics needed or legacy consistency.

---

# 10. Stateful Session Bean

## 10.1 Example

```java
@Stateful
public class ApplicationWizard {

    private DraftApplication draft = new DraftApplication();

    public void setApplicant(Applicant applicant) {
        draft.setApplicant(applicant);
    }

    public void addDocument(DocumentRef doc) {
        draft.addDocument(doc);
    }

    public Application submit() {
        return draft.submit();
    }

    @Remove
    public void cancel() {
        draft = null;
    }
}
```

## 10.2 Characteristics

- maintains conversational state;
- associated with client;
- can be passivated;
- should be removed when done.

## 10.3 Use cases

- wizard-like interactions;
- conversational workflows;
- legacy rich-client sessions.

## 10.4 Modern caution

Stateful server memory does not fit stateless cloud scaling well.

Problems:

- memory usage;
- passivation serialization;
- clustering;
- failover;
- sticky session;
- cleanup;
- timeout;
- client lifecycle.

## 10.5 Passivation

Container may passivate idle stateful bean to save memory.

State must be serializable/passivation-capable.

## 10.6 Removal

Use `@Remove` to end session.

## 10.7 Prefer explicit persisted workflow

For important workflows, store draft/process state in DB instead of stateful bean memory.

---

# 11. Singleton Session Bean

## 11.1 Example

```java
@Singleton
@Startup
public class AppCache {

    private Map<String, ConfigValue> cache;

    @PostConstruct
    void load() {
        cache = loadConfig();
    }

    @Lock(READ)
    public ConfigValue get(String key) {
        return cache.get(key);
    }

    @Lock(WRITE)
    public void refresh() {
        cache = loadConfig();
    }
}
```

## 11.2 Characteristics

- one instance per application;
- shared by all clients;
- supports concurrency control;
- can be eagerly initialized with `@Startup`.

## 11.3 Use cases

- read-mostly cache;
- startup initialization;
- shared coordinator;
- config holder.

## 11.4 Danger

Singleton can become:

- global mutable state;
- bottleneck;
- hidden dependency;
- cluster inconsistency source.

## 11.5 Cluster caution

EJB singleton is per application instance/JVM, not necessarily cluster-wide singleton.

If deployed on 5 nodes, you may have 5 singletons.

For cluster-wide coordination, use DB lock, distributed lock, or external coordinator.

## 11.6 Concurrency

Use `@Lock(READ)` and `@Lock(WRITE)` carefully.

---

# 12. No-Interface View, Local View, Remote View

EJB supports different client views.

## 12.1 No-interface view

Bean class itself is business view.

```java
@Stateless
public class PricingService {
    public Money price(...) { ... }
}
```

Client injects bean type.

## 12.2 Local view

Plain Java interface.

```java
@Local
public interface Pricing {
    Money price(...);
}
```

Implementation:

```java
@Stateless
public class PricingBean implements Pricing { ... }
```

## 12.3 Remote view

Remote interface for access across JVM/process.

```java
@Remote
public interface RemotePricing {
    Money price(...);
}
```

## 12.4 Remote caution

Remote EJB introduces:

- network latency;
- serialization;
- version compatibility;
- exception boundary;
- security config;
- distributed failure;
- coupling.

For modern services, REST/gRPC/messaging often preferred.

## 12.5 Local vs no-interface

No-interface is simple for same app/module.

Local interface helps decouple contract/testability.

## 12.6 Dependency direction

Use interface when you want clean boundary.

---

# 13. `@EJB` Injection dan Lookup

`@EJB` indicates dependency on local, no-interface, or remote Enterprise Bean view.

## 13.1 Field injection

```java
@EJB
PricingService pricingService;
```

## 13.2 Interface injection

```java
@EJB
Pricing pricing;
```

## 13.3 Bean name / lookup

```java
@EJB(beanName = "PricingBean")
Pricing pricing;
```

or:

```java
@EJB(lookup = "java:global/app/module/PricingBean")
Pricing pricing;
```

Do not specify both `beanName` and `lookup`.

## 13.4 Modern CDI injection

In many Jakarta environments, EJBs can also be injected via CDI `@Inject`.

```java
@Inject
PricingService pricingService;
```

Test/runtime dependent.

## 13.5 Avoid service locator

Bad:

```java
InitialContext ctx = new InitialContext();
Pricing p = (Pricing) ctx.lookup(...);
```

Use injection unless dynamic lookup required.

## 13.6 Ambiguity

If multiple beans expose same type, injection can be ambiguous.

Use beanName/qualifier/explicit lookup.

---

# 14. EJB Lifecycle

## 14.1 Stateless lifecycle

```text
class loaded
instance created
dependency injection
@PostConstruct
pooled
business method invocations
@PreDestroy
destroyed
```

## 14.2 Stateful lifecycle

```text
created per client
@PostConstruct
business methods
passivation possible
activation possible
@Remove or timeout
@PreDestroy
```

## 14.3 Singleton lifecycle

```text
application startup if @Startup
@PostConstruct
shared invocations
@PreDestroy on shutdown
```

## 14.4 MDB lifecycle

```text
instances pooled
message delivery invokes onMessage
transactions/redelivery managed
destroyed on undeploy/shutdown
```

## 14.5 Lifecycle callback caveat

`@PreDestroy` not guaranteed on crash/kill.

Do not rely on it as only persistence/audit mechanism.

## 14.6 Expensive initialization

Avoid long/blocking `@PostConstruct` unless startup should fail if init fails.

---

# 15. Callbacks: `@PostConstruct`, `@PreDestroy`, `@PostActivate`, `@PrePassivate`, `@Remove`

## 15.1 `@PostConstruct`

Called after injection.

Use for initialization.

## 15.2 `@PreDestroy`

Called before bean destruction.

Use for cleanup.

## 15.3 `@PrePassivate`

Stateful bean callback before passivation.

Release non-serializable resources.

## 15.4 `@PostActivate`

After activation.

Reacquire transient resources.

## 15.5 `@Remove`

Marks method that removes stateful session bean.

```java
@Remove
public void finish() { ... }
```

## 15.6 Avoid resource handles across passivation

Do not keep open JDBC connection/socket in stateful bean.

## 15.7 Serialize state carefully

Stateful bean passivation means fields must be passivation-capable or transient.

---

# 16. Transaction Management

EJB transaction management is one of its biggest features.

Types:

```java
@TransactionManagement(CONTAINER)
@TransactionManagement(BEAN)
```

## 16.1 Container-managed transaction / CMT

Container starts/joins/commits/rolls back transaction based on annotations.

Most common.

## 16.2 Bean-managed transaction / BMT

Bean manually controls `UserTransaction`.

Used when custom transaction demarcation needed.

## 16.3 Default

Session beans default to container-managed transaction.

## 16.4 Transaction boundary via method invocation

EJB transaction semantics apply on business method invocation through container.

Self-invocation can bypass.

## 16.5 Interaction with JPA

`@PersistenceContext` EntityManager joins transaction.

## 16.6 Transaction and remote calls

Avoid long transactions over remote operations.

---

# 17. Container-Managed Transaction / CMT

## 17.1 Example

```java
@Stateless
public class TransferService {

    @TransactionAttribute(TransactionAttributeType.REQUIRED)
    public void transfer(AccountId from, AccountId to, Money amount) {
        debit(from, amount);
        credit(to, amount);
    }
}
```

## 17.2 Benefits

- less boilerplate;
- declarative;
- consistent;
- integrated with JPA/JMS;
- container handles rollback.

## 17.3 Transaction attributes

CMT behavior is configured per method/class.

## 17.4 Rollback

Runtime exception usually marks transaction rollback.

Checked exception does not automatically rollback unless configured as application exception with rollback.

## 17.5 Set rollback only

Use context:

```java
@Resource
SessionContext ctx;

ctx.setRollbackOnly();
```

## 17.6 Get rollback status

```java
ctx.getRollbackOnly();
```

## 17.7 Avoid swallowing exception

If you catch exception and return success, transaction may commit unless you mark rollback.

---

# 18. Bean-Managed Transaction / BMT

## 18.1 Example

```java
@Stateless
@TransactionManagement(TransactionManagementType.BEAN)
public class ManualTxService {

    @Resource
    UserTransaction tx;

    public void work() throws Exception {
        try {
            tx.begin();
            doPart1();
            tx.commit();
        } catch (Exception e) {
            tx.rollback();
            throw e;
        }
    }
}
```

## 18.2 Use cases

- multiple transaction boundaries inside one method;
- explicit commit before continuing;
- specialized integration;
- legacy behavior.

## 18.3 Risks

- missing rollback;
- transaction leak;
- inconsistent exception handling;
- hard to read;
- violates usual service transaction boundary.

## 18.4 Prefer CMT

Use BMT only when needed.

## 18.5 Timeout

Set transaction timeout if supported/needed.

## 18.6 External calls

Do not hold transaction during slow external calls.

---

# 19. Transaction Attributes: REQUIRED, REQUIRES_NEW, MANDATORY, SUPPORTS, NOT_SUPPORTED, NEVER

## 19.1 REQUIRED

Join existing transaction or create new one.

Default common behavior.

Use for normal business writes.

## 19.2 REQUIRES_NEW

Suspend existing transaction, start new.

Useful for audit/log that must commit independently.

Caution: can create inconsistency if overused.

## 19.3 MANDATORY

Requires existing transaction.

If none, error.

Useful for internal method that must be called in transaction.

## 19.4 SUPPORTS

Run with transaction if exists, otherwise without.

Use for read operations that can work either way.

## 19.5 NOT_SUPPORTED

Suspend transaction and run without.

Use for non-transactional slow work or operations that must not hold transaction.

## 19.6 NEVER

Must not run in transaction.

If transaction exists, error.

## 19.7 Decision table

| Use case | Attribute |
|---|---|
| normal write use case | REQUIRED |
| independent audit commit | REQUIRES_NEW |
| must be called within larger transaction | MANDATORY |
| optional read helper | SUPPORTS |
| slow non-transactional external call | NOT_SUPPORTED |
| must fail if transaction exists | NEVER |

## 19.8 Self-invocation warning

Attributes apply through container proxy, not direct `this` calls.

---

# 20. Rollback Rules dan Exception Semantics

## 20.1 System exception

Runtime exception usually indicates system exception and transaction rollback.

## 20.2 Application exception

Checked exceptions are application exceptions by default.

They may not rollback transaction automatically.

## 20.3 `@ApplicationException`

```java
@ApplicationException(rollback = true)
public class InsufficientBalanceException extends Exception {
}
```

## 20.4 Business exception

If business rule failure should rollback, configure.

If validation failure occurs before writes, rollback may not matter.

## 20.5 Catching exception

Bad:

```java
try {
    doWork();
} catch (Exception e) {
    log.warn("failed", e);
}
```

Transaction may commit partial work.

Better:

```java
catch (Exception e) {
    ctx.setRollbackOnly();
    throw e;
}
```

or rethrow runtime/application exception with rollback.

## 20.6 Remote exception mapping

Remote EJB exceptions cross serialization/network boundary.

Design remote contracts carefully.

## 20.7 REST boundary

If EJB called from REST, map exceptions to HTTP response at resource/application layer.

---

# 21. Security: Roles, RunAs, CallerPrincipal

EJB integrates with Jakarta security annotations.

## 21.1 Role protection

```java
@Stateless
@RolesAllowed("OFFICER")
public class CaseApprovalService {
    public void approve(...) { ... }
}
```

## 21.2 Method override

```java
@PermitAll
public CaseSummary viewPublicSummary(...) { ... }

@DenyAll
public void internalOnly(...) { ... }
```

## 21.3 Caller principal

```java
@Resource
SessionContext ctx;

public String caller() {
    return ctx.getCallerPrincipal().getName();
}
```

## 21.4 Role check

```java
ctx.isCallerInRole("ADMIN")
```

## 21.5 RunAs

```java
@RunAs("SYSTEM")
```

Lets bean execute calls to other beans under specified role.

Use carefully.

## 21.6 Security is coarse

`@RolesAllowed("OFFICER")` does not mean caller can approve every case.

Need domain policy.

## 21.7 Audit

Record caller principal and decision.

---

# 22. Interceptors di EJB

EJB supports interceptor facility.

## 22.1 Example

```java
@AroundInvoke
public Object audit(InvocationContext ctx) throws Exception {
    long start = System.nanoTime();
    try {
        return ctx.proceed();
    } finally {
        ...
    }
}
```

## 22.2 Use cases

- logging;
- metrics;
- audit;
- security;
- retry;
- validation;
- transaction-independent concern.

## 22.3 Interceptor ordering

Ordering matters.

Document if multiple interceptors.

## 22.4 Exceptions

Interceptor can alter exception/return behavior.

Be careful not to swallow transaction-triggering exceptions.

## 22.5 CDI interceptors

EJB and CDI interceptor models overlap.

Modern apps often use Jakarta Interceptors/CDI.

## 22.6 Self-invocation

Interceptors apply on container invocation.

---

# 23. Asynchronous EJB Methods

## 23.1 Example

```java
@Stateless
public class ReportService {

    @Asynchronous
    public Future<ReportResult> generate(ReportRequest request) {
        ReportResult result = doGenerate(request);
        return new AsyncResult<>(result);
    }
}
```

## 23.2 Void async

```java
@Asynchronous
public void sendNotification(...) {
    ...
}
```

## 23.3 Return type

EJB async methods may return `void` or `Future<V>`.

## 23.4 Transaction

Async method runs in separate thread/invocation context.

Transaction semantics follow its own method annotations.

## 23.5 Error handling

For `Future`, exception appears on `future.get()`.

For void, ensure logging/monitoring.

## 23.6 Modern alternative

Jakarta Concurrency `ManagedExecutorService` or `@Asynchronous` from Jakarta Concurrency may be more flexible in modern code.

## 23.7 Not durable

EJB async invocation is generally transient, not durable job queue.

For durable work, use messaging/batch/outbox.

---

# 24. EJB Timer Service

EJB Timer Service provides scheduling for enterprise beans.

## 24.1 Use cases

- periodic cleanup;
- scheduled polling;
- retry timeout;
- background maintenance.

## 24.2 Programmatic timer

Create timer via `TimerService`.

## 24.3 Declarative schedule

```java
@Schedule(hour = "2", minute = "0", persistent = true)
public void nightlyJob() {
    ...
}
```

## 24.4 Persistent timer

Can survive server restart depending runtime/provider.

## 24.5 Non-persistent timer

In-memory schedule only.

## 24.6 Cluster caution

Timer behavior in cluster is runtime-specific.

Ensure only one node runs if required.

## 24.7 Long job caution

For long batch jobs, Jakarta Batch may be better.

---

# 25. Programmatic Timer dan Calendar Timer

## 25.1 Inject TimerService

```java
@Resource
TimerService timerService;
```

## 25.2 Create single-action timer

```java
timerService.createSingleActionTimer(
    Duration.ofMinutes(10).toMillis(),
    new TimerConfig("reminder", true)
);
```

## 25.3 Timeout method

```java
@Timeout
public void onTimeout(Timer timer) {
    ...
}
```

## 25.4 Calendar schedule

Use calendar expressions for recurring schedule.

## 25.5 Persistent flag

TimerConfig can control persistence.

## 25.6 Timer info

Timer can carry serializable info object.

Do not put huge object graph.

## 25.7 Scheduling business workflows

For business deadline, store deadline in DB too.

Timer is trigger, not source of truth.

---

# 26. Singleton Concurrency: Container-Managed vs Bean-Managed

## 26.1 Container-managed concurrency

Default for singleton.

Use annotations:

```java
@Lock(READ)
@Lock(WRITE)
@AccessTimeout
```

## 26.2 Read lock

Multiple concurrent readers allowed.

```java
@Lock(LockType.READ)
public Config get(...) { ... }
```

## 26.3 Write lock

Exclusive.

```java
@Lock(LockType.WRITE)
public void refresh() { ... }
```

## 26.4 Access timeout

```java
@AccessTimeout(value = 5, unit = TimeUnit.SECONDS)
```

If lock unavailable, fail after timeout.

## 26.5 Bean-managed concurrency

```java
@ConcurrencyManagement(BEAN)
```

Bean handles synchronization.

Use only if necessary.

## 26.6 Bottleneck risk

A singleton with write lock around slow work blocks readers.

## 26.7 Cluster risk

Singleton lock is per JVM/application instance, not global cluster lock.

---

# 27. Message-Driven Beans / MDB

MDB is EJB component that processes messages asynchronously.

## 27.1 Example

```java
@MessageDriven(activationConfig = {
    @ActivationConfigProperty(propertyName = "destinationLookup", propertyValue = "jms/EmailQueue"),
    @ActivationConfigProperty(propertyName = "destinationType", propertyValue = "jakarta.jms.Queue")
})
public class EmailMessageBean implements MessageListener {

    @Override
    public void onMessage(Message message) {
        ...
    }
}
```

## 27.2 Characteristics

Jakarta EE Tutorial notes MDB:

- executes upon receipt of a single client message;
- has no conversational state for a specific client;
- instances are equivalent and can be pooled;
- can process messages from multiple clients;
- clients do not call MDB directly.

## 27.3 Transaction

MDB processing often occurs within container-managed transaction.

If method fails/transaction rolls back, message can be redelivered.

## 27.4 Use cases

- JMS consumers;
- background event processing;
- integration queues;
- transactional message handling.

## 27.5 Poison message

MDB must handle poison message/redelivery/DLQ with broker config.

## 27.6 Idempotency

MDB consumers must be idempotent.

## 27.7 Modern alternative

Standalone messaging worker may be preferred in microservices, but MDB remains convenient in full Jakarta EE runtime.

---

# 28. MDB vs JMS Consumer Manual vs Jakarta Messaging Worker

## 28.1 MDB

Pros:

- container-managed lifecycle;
- transaction integration;
- pooling;
- redelivery integration;
- injection;
- app server resource adapter.

Cons:

- runtime-specific activation config;
- less portable outside Jakarta EE server;
- less control than custom worker;
- full runtime needed.

## 28.2 Manual JMS consumer

Pros:

- explicit control;
- works standalone;
- custom lifecycle possible.

Cons:

- must manage threads/connections/transactions;
- more boilerplate;
- error-prone.

## 28.3 Jakarta Messaging worker

Could be plain service using `JMSContext` and managed executor.

Good for custom architecture.

## 28.4 Decision

| Need | Prefer |
|---|---|
| full Jakarta EE, JMS queue, CMT | MDB |
| standalone microservice | manual worker/client |
| custom streaming/retry framework | custom worker |
| app server resource adapter integration | MDB |
| high portability across non-Jakarta runtimes | custom worker |

## 28.5 Reliability still application responsibility

MDB gives delivery/transaction integration, not idempotency/business correctness.

---

# 29. Pooling, Passivation, dan Instance Management

## 29.1 Stateless pooling

Container can pool stateless instances.

Do not depend on instance identity.

## 29.2 MDB pooling

Container can pool MDB instances to process messages concurrently.

## 29.3 Stateful passivation

Container may passivate stateful bean.

## 29.4 Singleton no pool

One instance per app.

## 29.5 Pool size

Runtime config controls pool size.

Too small:

- bottleneck.

Too large:

- resource pressure.

## 29.6 Instance variables

Stateless/MDB instance variables can hold shared dependencies/cache, but not per-client state.

## 29.7 Resource cleanup

Use lifecycle callbacks.

---

# 30. Exception Handling dan Remote Boundary

## 30.1 Local call exception

Local EJB call exceptions behave like Java calls but with container semantics.

## 30.2 Remote call exception

Remote call adds:

- serialization;
- network failure;
- remote exception wrapper;
- timeout;
- version compatibility.

## 30.3 Application exception

Use `@ApplicationException` for expected business exceptions.

## 30.4 System exception

Runtime/system exception may discard bean instance and rollback transaction.

## 30.5 Do not leak internal exception

At REST boundary, map to safe error contract.

## 30.6 Remote DTO

Remote EJB params/returns must be serializable and version-compatible.

## 30.7 Avoid chatty remote EJB

Remote calls should be coarse-grained.

---

# 31. EJB dan CDI Integration

## 31.1 Injection between EJB and CDI

EJB can inject CDI beans and vice versa depending runtime rules.

```java
@Stateless
public class CaseService {
    @Inject
    CasePolicy policy;
}
```

## 31.2 CDI scopes vs EJB lifecycle

Be careful injecting request-scoped CDI bean into EJB used outside request.

Proxy may fail if context inactive.

## 31.3 EJB as CDI bean?

In modern Jakarta, EJBs integrate with CDI, but lifecycle/proxy semantics differ.

Test.

## 31.4 Prefer CDI for new simple services

If you only need DI + transaction, CDI + `@Transactional` may be cleaner.

## 31.5 Avoid double mental models

Do not mix EJB/CDI features randomly.

Document component model.

## 31.6 Interceptor overlap

CDI interceptors and EJB interceptors may both apply.

Be explicit.

---

# 32. EJB dan Jakarta Persistence

## 32.1 Persistence context injection

```java
@PersistenceContext
EntityManager em;
```

## 32.2 Transaction-scoped persistence context

Common with stateless EJB.

EntityManager joins method transaction.

## 32.3 Extended persistence context

Can be used with stateful session bean.

Useful for conversational persistence, but complex.

## 32.4 Lazy loading

EJB transaction boundaries affect lazy loading.

Accessing lazy relationship outside transaction/persistence context can fail.

## 32.5 Merge/detach

Remote EJB returns detached entities.

Avoid returning JPA entities over remote boundaries.

## 32.6 Use DTOs at boundaries

Especially for remote/web boundary.

## 32.7 Transaction boundary

EJB method transaction defines unit of work.

---

# 33. EJB dan Jakarta REST / Servlet

## 33.1 REST resource calls EJB

```java
@Path("/cases")
public class CaseResource {

    @EJB
    CaseApprovalService service;

    @POST
    @Path("/{id}/approve")
    public Response approve(@PathParam("id") UUID id) {
        service.approve(id);
        return Response.noContent().build();
    }
}
```

## 33.2 REST resource should remain adapter

EJB/service handles application use case.

## 33.3 Exception mapping

EJB business exception maps to HTTP response via exception mapper.

## 33.4 Security

REST endpoint can have `@RolesAllowed`, EJB can also have role checks.

Avoid inconsistent role config.

## 33.5 Transaction

Usually transaction starts at EJB service method, not REST resource.

## 33.6 Modern alternative

CDI service with `@Transactional`.

---

# 34. Modern Relevance: Kapan EJB Masih Tepat?

EJB may be appropriate when:

- maintaining existing EJB codebase;
- app server deeply integrated with EJB;
- using MDB with JMS in Jakarta EE runtime;
- needing EJB Timer Service;
- needing remote EJB with existing clients;
- relying on mature CMT behavior;
- platform standardizes EJB;
- vendor product depends on EJB;
- migration risk too high.

## 34.1 EJB as legacy literacy

Even if not using for new code, understanding EJB is essential for modernization.

## 34.2 EJB in regulated enterprise

Government/banking systems often value stable proven runtime.

EJB may remain.

## 34.3 MDB relevance

MDB remains a strong model for container-managed JMS consumption.

## 34.4 Timer relevance

EJB timers can be good for simple scheduled tasks inside app server.

## 34.5 Transactional service

Stateless EJB is still valid, but CDI + `@Transactional` often competes.

---

# 35. Kapan Jangan Memakai EJB?

Avoid EJB for new code when:

- runtime does not support Enterprise Beans;
- you target lightweight Core Profile runtime;
- simple CDI service is enough;
- remote interface would create tight coupling;
- stateful conversation can be stored in DB;
- cloud-native stateless scaling is priority;
- you need durable complex batch processing;
- you need event streaming not JMS/MDB;
- team lacks EJB operational expertise.

## 35.1 Avoid stateful server memory

For web/API apps, store conversation state explicitly.

## 35.2 Avoid remote EJB for public service API

Use REST/gRPC/messaging.

## 35.3 Avoid singleton global mutable state

Use distributed cache/DB/config service if cluster-wide.

## 35.4 Avoid EJB timers for critical clustered business schedules unless runtime behavior is clear.

## 35.5 Avoid mixing EJB/CDI/Spring without strong reason

Complex lifecycle/proxy stack increases debugging cost.

---

# 36. Migration Strategy: EJB ke CDI/Jakarta Concurrency/Jakarta Messaging

## 36.1 Inventory

Classify EJBs:

```text
@Stateless
@Stateful
@Singleton
@MessageDriven
@Schedule/@Timeout
@Remote
@Asynchronous
```

## 36.2 Map replacements

| EJB feature | Potential replacement |
|---|---|
| Stateless service | CDI bean + `@Transactional` |
| CMT | Jakarta Transactions `@Transactional` |
| MDB | Jakarta Messaging worker / MDB retained |
| Timer | Jakarta Batch / external scheduler / ManagedScheduledExecutor |
| Async method | Jakarta Concurrency |
| Stateful bean | persisted workflow/session state |
| Singleton cache | CDI singleton/application scoped + cache design |
| Remote EJB | REST/gRPC/messaging |

## 36.3 Preserve transaction semantics

Migration often fails by changing transaction boundary.

Document old behavior:

- transaction attributes;
- rollback rules;
- exception handling;
- self-invocation quirks.

## 36.4 Preserve security semantics

Map:

- roles;
- RunAs;
- caller principal;
- remote identity propagation.

## 36.5 Preserve timer semantics

Check:

- persistent timer?
- clustered?
- missed execution?
- overlap?
- retry?

## 36.6 MDB migration

If replacing MDB with worker, implement:

- ack;
- transaction;
- redelivery;
- DLQ;
- concurrency;
- idempotency.

## 36.7 Incremental migration

Do not big-bang.

Wrap legacy EJB behind interfaces and migrate one boundary at a time.

---

# 37. Observability

## 37.1 What to observe

- method invocation count;
- transaction commit/rollback;
- method latency;
- pool usage;
- timer execution;
- MDB success/failure/redelivery;
- security denial;
- remote call latency;
- exception type;
- thread usage.

## 37.2 Logs

Include:

- correlation ID;
- bean name;
- method;
- caller principal;
- transaction outcome;
- timer ID;
- message ID for MDB.

## 37.3 Metrics

- EJB pool active/idle;
- MDB pool size;
- timer failures;
- transaction rollback count;
- method duration;
- remote error rate.

## 37.4 Tracing

EJB method should be span boundary if it represents service/use case.

## 37.5 Audit

Business-critical EJB methods should record domain audit, not only technical logs.

## 37.6 Runtime tools

App servers expose EJB metrics differently.

Know your runtime.

---

# 38. Testing Strategy

## 38.1 Unit tests

Extract business logic into POJO/domain service.

EJB unit test alone cannot validate container semantics.

## 38.2 Integration tests

Test in container/runtime:

- transaction attributes;
- rollback rules;
- security roles;
- injection;
- timers;
- MDB redelivery;
- async behavior;
- singleton locks;
- passivation if used.

## 38.3 Embedded container

Some environments support embedded EJB container for tests.

But target runtime test is still important.

## 38.4 Transaction tests

Test:

- checked exception rollback/no rollback;
- runtime exception rollback;
- `REQUIRES_NEW`;
- self-invocation behavior.

## 38.5 Security tests

Test allowed/denied roles.

## 38.6 MDB tests

Use real broker.

Test redelivery/DLQ/idempotency.

## 38.7 Timer tests

Avoid flaky time-based tests.

Use programmatic timer or small controlled schedule.

## 38.8 Migration tests

Before migration, create characterization tests around EJB behavior.

---

# 39. Production Failure Modes

## 39.1 Transaction attribute not applied

Cause:

- self-invocation;
- not called via container proxy;
- wrong method visibility.

## 39.2 Unexpected commit

Cause:

- checked exception not rollback;
- exception swallowed;
- `setRollbackOnly` not called.

## 39.3 Stateful memory leak

Cause:

- client never calls remove;
- long timeout;
- large state;
- passivation disabled/failing.

## 39.4 Singleton bottleneck

Cause:

- write lock around slow operation;
- all readers blocked.

## 39.5 Cluster duplicate timer

Cause:

- timer configured per node or runtime behavior misunderstood.

## 39.6 MDB poison message loop

Cause:

- no DLQ/redelivery limit/idempotency.

## 39.7 Remote serialization failure

Cause:

- non-serializable DTO;
- class version mismatch.

## 39.8 Injection ambiguity

Cause:

- multiple beans same view.

## 39.9 Pool exhaustion

Cause:

- long-running method;
- blocked remote call;
- small pool.

## 39.10 EJB not found after migration

Cause:

- JNDI name changed;
- module/package change;
- `javax` to `jakarta` mismatch.

## 39.11 Security mismatch

Cause:

- role mapping changed;
- RunAs removed;
- endpoint protected but service not.

---

# 40. Best Practices dan Anti-Patterns

## 40.1 Best practices

- Prefer stateless beans for services.
- Keep bean methods coarse-grained.
- Be explicit about transaction attributes.
- Use `@ApplicationException` intentionally.
- Avoid self-invocation for annotated behavior.
- Keep stateful beans small and short-lived.
- Use `@Remove` and timeouts for stateful beans.
- Use singleton locks carefully.
- Make MDB idempotent.
- Configure DLQ/redelivery.
- Use DTOs for remote boundaries.
- Test container semantics.
- Document migration assumptions.

## 40.2 Anti-pattern: EJB as domain model

Entity/business domain should not depend on EJB container.

## 40.3 Anti-pattern: Stateful web session replacement

Stateful beans can become memory bottleneck.

## 40.4 Anti-pattern: Remote chatty service

Remote EJB per small getter/setter kills performance.

## 40.5 Anti-pattern: Swallow exception in CMT

Can commit partial work.

## 40.6 Anti-pattern: Singleton global mutable state in cluster

Not cluster-wide.

## 40.7 Anti-pattern: Timer as source of truth

Store business schedule/deadline in DB.

## 40.8 Anti-pattern: MDB without idempotency

Duplicate message eventually happens.

---

# 41. Checklist Review

## 41.1 Bean type

- [ ] Stateless/stateful/singleton/MDB chosen intentionally?
- [ ] Could CDI bean be enough?
- [ ] Is runtime/profile supporting required EJB features?

## 41.2 Transaction

- [ ] Transaction attribute explicit?
- [ ] Rollback rules documented?
- [ ] Checked exceptions handled?
- [ ] Self-invocation avoided?
- [ ] External calls outside long transaction?

## 41.3 State

- [ ] Stateless bean has no client state?
- [ ] Stateful bean has removal/timeout?
- [ ] Stateful state passivation-safe?
- [ ] Singleton concurrency controlled?

## 41.4 Messaging/timer

- [ ] MDB idempotent?
- [ ] Redelivery/DLQ configured?
- [ ] Timer persistent/non-persistent choice known?
- [ ] Cluster behavior understood?

## 41.5 Security

- [ ] Roles mapped?
- [ ] `RunAs` needed/documented?
- [ ] Resource-level policy implemented?
- [ ] Caller audited?

## 41.6 Operations

- [ ] Pool metrics monitored?
- [ ] Method latency monitored?
- [ ] Transaction rollback monitored?
- [ ] Timer/MDB failures alerted?

---

# 42. Case Study 1: Stateless Service dengan Transaction Boundary

## 42.1 Requirement

Approve case and write audit record.

## 42.2 Stateless EJB

```java
@Stateless
public class ApproveCaseBean {

    @PersistenceContext
    EntityManager em;

    @EJB
    AuditBean audit;

    @TransactionAttribute(REQUIRED)
    public void approve(UUID caseId, Actor actor) {
        CaseEntity c = em.find(CaseEntity.class, caseId);
        c.approve(actor);
        audit.recordApproval(caseId, actor);
    }
}
```

## 42.3 Independent audit

If audit must commit even when approval fails:

```java
@TransactionAttribute(REQUIRES_NEW)
public void recordAttempt(...) { ... }
```

But use carefully.

## 42.4 Better modern design

Could be CDI service with `@Transactional`.

## 42.5 Lesson

Transaction semantics are the value. Preserve them in migration.

---

# 43. Case Study 2: Stateful Wizard yang Bocor Memory

## 43.1 Problem

Stateful bean stores draft application and uploaded file bytes.

Users abandon flow.

Memory grows.

## 43.2 Root causes

- large state;
- no `@Remove`;
- long timeout;
- passivation failure;
- uploaded file bytes in memory.

## 43.3 Fix

- store draft in DB;
- store upload in object storage;
- stateful bean only keeps lightweight ID or remove entirely;
- configure timeout;
- call `@Remove`.

## 43.4 Modern replacement

Use REST stateless API with draft ID.

## 43.5 Lesson

Server-side conversational state is expensive.

---

# 44. Case Study 3: Singleton Cache dengan Lock Bottleneck

## 44.1 Problem

Singleton cache refresh method has write lock and calls slow remote API.

Readers blocked for seconds.

## 44.2 Bad

```java
@Lock(WRITE)
public void refresh() {
    cache = remoteClient.loadAll(); // slow
}
```

## 44.3 Better

Load outside lock where possible:

```java
public void refresh() {
    Map<String, Config> newCache = remoteClient.loadAll();

    lockWriteAndSwap(newCache);
}
```

or use immutable atomic reference.

## 44.4 Cluster issue

Each node has its own cache.

Need invalidation strategy.

## 44.5 Lesson

Singleton lock is powerful but can create bottleneck.

---

# 45. Case Study 4: MDB dan Poison Message

## 45.1 Problem

MDB consumes invalid message and throws exception.

Message redelivered endlessly.

Queue stuck.

## 45.2 Fix

- validate schema;
- distinguish retryable vs permanent;
- configure max redelivery;
- DLQ;
- idempotency;
- alert DLQ.

## 45.3 Transaction

If processing updates DB then fails, rollback triggers redelivery.

Need idempotent processing.

## 45.4 Lesson

MDB does not remove messaging reliability design.

---

# 46. Latihan Bertahap

## Latihan 1 — Stateless EJB

Create `@Stateless` calculator/service.

Inject into REST resource.

## Latihan 2 — Transaction rollback

Create method with checked and runtime exceptions.

Observe DB state.

## Latihan 3 — `@ApplicationException`

Configure checked exception rollback true/false.

## Latihan 4 — Self-invocation

Call `REQUIRES_NEW` method via `this` and via proxy.

Compare behavior.

## Latihan 5 — Singleton lock

Create singleton cache with read/write methods.

Load test read during refresh.

## Latihan 6 — Stateful bean

Create simple wizard.

Add `@Remove` and timeout.

## Latihan 7 — Timer

Create `@Schedule` timer.

Log executions.

## Latihan 8 — MDB

Consume JMS message.

Throw exception and observe redelivery.

## Latihan 9 — Remote view

Create remote interface if runtime supports.

Observe serialization/latency.

## Latihan 10 — Migration

Convert simple stateless EJB to CDI + `@Transactional`.

Verify behavior with tests.

---

# 47. Mini Project: Jakarta Enterprise Beans Modernization Lab

## 47.1 Goal

Create:

```text
jakarta-enterprise-beans-modernization-lab/
```

## 47.2 Modules

```text
stateless-service/
transaction-attributes/
application-exception/
stateful-wizard/
singleton-cache/
ejb-timer/
message-driven-bean/
remote-view/
cdi-migration/
observability/
```

## 47.3 Deliverables

```text
README.md
EJB-MENTAL-MODEL.md
TRANSACTION-SEMANTICS.md
STATEFUL-BEANS.md
SINGLETON-CONCURRENCY.md
MDB-RELIABILITY.md
TIMER-SERVICE.md
REMOTE-EJB.md
MIGRATION-PLAN.md
FAILURE-MODES.md
```

## 47.4 Required experiments

1. Stateless invocation through REST.
2. Transaction rollback rules.
3. `REQUIRES_NEW` behavior.
4. Self-invocation bug.
5. Stateful passivation/removal.
6. Singleton lock contention.
7. Timer execution.
8. MDB redelivery.
9. Remote EJB serialization.
10. Migration to CDI.

## 47.5 Evaluation questions

1. What does container manage for EJB?
2. Difference between stateless/stateful/singleton?
3. Why is self-invocation dangerous?
4. What is CMT?
5. What does `REQUIRES_NEW` do?
6. Why checked exception may not rollback?
7. Why stateful bean can leak memory?
8. Is singleton cluster-wide?
9. Why MDB needs idempotency?
10. When should EJB be replaced by CDI?

---

# 48. Referensi Resmi

Referensi utama:

1. Jakarta Enterprise Beans 4.0  
   https://jakarta.ee/specifications/enterprise-beans/4.0/

2. Jakarta Enterprise Beans 4.0 Core Specification  
   https://jakarta.ee/specifications/enterprise-beans/4.0/jakarta-enterprise-beans-spec-core-4.0

3. Jakarta Enterprise Beans 4.0 API Docs  
   https://jakarta.ee/specifications/enterprise-beans/4.0/apidocs/

4. `@EJB` API Docs  
   https://jakarta.ee/specifications/enterprise-beans/4.0/apidocs/jakarta/ejb/ejb

5. Jakarta EE 11 Release  
   https://jakarta.ee/release/11/

6. Jakarta EE Tutorial — Enterprise Beans  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/entbeans/ejb-intro/ejb-intro.html

7. Jakarta Transactions 2.0  
   https://jakarta.ee/specifications/transactions/2.0/

8. Jakarta Messaging 3.1  
   https://jakarta.ee/specifications/messaging/3.1/

9. Jakarta Concurrency 3.1  
   https://jakarta.ee/specifications/concurrency/3.1/

10. Jakarta CDI 4.1  
    https://jakarta.ee/specifications/cdi/4.1/

---

# Penutup

Jakarta Enterprise Beans adalah container-managed component model untuk enterprise business applications.

Mental model ringkas:

```text
Stateless:
  pooled transactional service

Stateful:
  per-client conversational component

Singleton:
  one shared application instance with concurrency control

MDB:
  container-managed async message listener

CMT:
  declarative transaction boundary

EJB Timer:
  scheduled callback managed by container

Remote view:
  distributed component boundary
```

Prinsip paling penting:

```text
EJB value is not the annotation.
EJB value is the container semantics behind the annotation.
```

Untuk sistem baru, sering kali CDI + Jakarta Transactions + Jakarta Concurrency + Jakarta Messaging lebih fleksibel. Namun untuk sistem enterprise existing, EJB literacy sangat penting.

Engineer top-tier bisa melakukan dua hal sekaligus:

1. memahami dan menjaga EJB production system dengan benar;
2. memigrasi fitur EJB ke model modern tanpa mengubah semantics secara tidak sengaja.

Bagian berikutnya akan membahas **Jakarta Connectors (`jakarta.resource`)**: resource adapter, connection management, transaction enlistment, message inflow, inbound/outbound integration, XA, and how application servers integrate with external enterprise information systems.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-jakarta-part-022.md](./learn-java-jakarta-part-022.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-java-jakarta-part-024.md](./learn-java-jakarta-part-024.md)
