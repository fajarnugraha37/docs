# learn-java-jakarta-part-004.md

# Bagian 4 — Runtime / Container Model: Cara Jakarta EE Benar-Benar Menjalankan Aplikasi

> Target pembaca: Java engineer yang ingin memahami **apa yang sebenarnya dilakukan Jakarta EE runtime/container** di balik annotation seperti `@Inject`, `@Path`, `@Transactional`, `@PersistenceContext`, `@PostConstruct`, security, request context, resource pooling, dan deployment.
>
> Fokus bagian ini: membedakan **plain Java object** vs **container-managed component**, memahami lifecycle, classloading, deployment, injection, transaction, security, resource management, thread rules, runtime services, dan failure mode production.

---

## Daftar Isi

1. [Orientasi: Kenapa Runtime / Container Model Penting](#1-orientasi-kenapa-runtime--container-model-penting)
2. [Mental Model Besar: Application Code vs Container Services](#2-mental-model-besar-application-code-vs-container-services)
3. [Apa Itu Jakarta EE Component?](#3-apa-itu-jakarta-ee-component)
4. [Apa Itu Container?](#4-apa-itu-container)
5. [Jenis Container dan Runtime Environment](#5-jenis-container-dan-runtime-environment)
6. [Deployment Pipeline: Dari Artifact ke Running Application](#6-deployment-pipeline-dari-artifact-ke-running-application)
7. [Classloading Model](#7-classloading-model)
8. [Component Discovery dan Metadata Processing](#8-component-discovery-dan-metadata-processing)
9. [Object Creation: Siapa yang Membuat Object?](#9-object-creation-siapa-yang-membuat-object)
10. [Dependency Injection Lifecycle](#10-dependency-injection-lifecycle)
11. [Lifecycle Callback: `@PostConstruct` dan `@PreDestroy`](#11-lifecycle-callback-postconstruct-dan-predestroy)
12. [Scope dan Context](#12-scope-dan-context)
13. [Proxy dan Indirection](#13-proxy-dan-indirection)
14. [Servlet Container Model](#14-servlet-container-model)
15. [JAX-RS Runtime Model](#15-jax-rs-runtime-model)
16. [CDI Container Model](#16-cdi-container-model)
17. [Persistence dan EntityManager Runtime Model](#17-persistence-dan-entitymanager-runtime-model)
18. [Transaction Runtime Model](#18-transaction-runtime-model)
19. [Security Runtime Model](#19-security-runtime-model)
20. [Resource Management: DataSource, JMS, Mail, JNDI](#20-resource-management-datasource-jms-mail-jndi)
21. [Thread dan Concurrency Rules](#21-thread-dan-concurrency-rules)
22. [Configuration dan Environment](#22-configuration-dan-environment)
23. [Packaging dan Runtime Boot Model](#23-packaging-dan-runtime-boot-model)
24. [Runtime Services: Health, Metrics, Logging, Tracing](#24-runtime-services-health-metrics-logging-tracing)
25. [Portability vs Vendor Extension](#25-portability-vs-vendor-extension)
26. [Common Failure Modes](#26-common-failure-modes)
27. [Debugging Playbook](#27-debugging-playbook)
28. [Production Checklist](#28-production-checklist)
29. [Latihan Bertahap](#29-latihan-bertahap)
30. [Mini Project: Tiny Jakarta Runtime Mental Model](#30-mini-project-tiny-jakarta-runtime-mental-model)
31. [Referensi Resmi](#31-referensi-resmi)

---

# 1. Orientasi: Kenapa Runtime / Container Model Penting

Pada Java SE biasa, object dibuat oleh code kamu:

```java
CaseService service = new CaseService(new CaseRepository());
service.escalate(command);
```

Pada Jakarta EE, banyak object tidak dibuat langsung oleh kamu. Mereka dibuat, dikonfigurasi, dikelola, dihubungkan, dan dihancurkan oleh **container/runtime**.

Contoh:

```java
@Path("/cases")
@RequestScoped
public class CaseResource {

    @Inject
    CaseService service;

    @POST
    public Response create(CreateCaseRequest request) {
        return Response.ok(service.create(request)).build();
    }
}
```

Kamu tidak pernah menulis:

```java
new CaseResource()
```

Tetapi endpoint bisa jalan.

Mengapa?

Karena runtime melakukan banyak pekerjaan:

```text
read deployment artifact
  ↓
scan classes/resources
  ↓
detect Jakarta components
  ↓
build metadata model
  ↓
create component instances/proxies
  ↓
resolve injection points
  ↓
register HTTP routes
  ↓
manage request context
  ↓
apply security checks
  ↓
start/commit/rollback transactions
  ↓
serialize/deserialize request/response
  ↓
call lifecycle callbacks
  ↓
manage resources/pools
  ↓
shutdown cleanly
```

## 1.1 Container adalah sumber “magic”

Jika kamu tidak paham container, kamu akan bingung saat:

- `@Inject` null;
- `@PostConstruct` tidak terpanggil;
- `@Transactional` tidak bekerja;
- request scoped bean dipakai di background thread;
- JPA `EntityManager` closed/detached;
- resource lookup gagal;
- REST endpoint tidak terdaftar;
- filter tidak berjalan;
- security context kosong;
- class exists saat compile tapi hilang saat deploy;
- app jalan lokal tapi gagal di server;
- shutdown tidak memanggil cleanup;
- thread manual menyebabkan leak.

## 1.2 Tujuan bagian ini

Setelah bagian ini, kamu harus bisa menjelaskan:

1. Apa yang membedakan object biasa dan container-managed component?
2. Kapan injection terjadi?
3. Siapa yang membuat proxy?
4. Apa itu request/application/session context?
5. Mengapa scope matters?
6. Bagaimana deployment artifact diproses?
7. Bagaimana REST resource didaftarkan?
8. Bagaimana transaction/security/resource dikelola?
9. Kenapa thread manual bisa berbahaya?
10. Bagaimana men-debug runtime/container issue?

---

# 2. Mental Model Besar: Application Code vs Container Services

Jakarta EE membagi dunia menjadi dua:

```text
Application code
  + Container services
```

## 2.1 Application code

Ini code yang kamu tulis:

- resource class;
- CDI bean;
- entity;
- repository;
- application service;
- domain model;
- interceptor;
- filter;
- listener;
- message listener;
- batch step;
- custom validator;
- security mechanism;
- DTO;
- exception mapper.

## 2.2 Container services

Container menyediakan services seperti:

- component lifecycle;
- dependency injection;
- context management;
- transaction management;
- security;
- persistence integration;
- resource pooling;
- HTTP request dispatch;
- servlet filter chain;
- JAX-RS routing;
- JSON binding provider;
- validation provider;
- thread/concurrency management;
- classloading/deployment;
- event/listener dispatch.

## 2.3 Container sebagai layer interposition

Container berada di antara caller dan component.

```text
HTTP request
  ↓
container
  ↓
filters/security/context
  ↓
resource method
  ↓
container
  ↓
response
```

Atau:

```text
business method call
  ↓
proxy/interceptor
  ↓
transaction/security
  ↓
target method
```

Ini memungkinkan declarative programming:

```java
@Transactional
@RolesAllowed("OFFICER")
public void approve(...) { ... }
```

Tetapi konsekuensinya:

```text
behavior bergantung pada apakah call melewati container/proxy atau tidak
```

## 2.4 Plain Java vs managed Java

Plain Java:

```java
new MyBean()
```

- no injection;
- no lifecycle callback;
- no container context;
- no transaction interceptor;
- no security context;
- no managed proxy.

Managed component:

```text
created by container
```

- injection works;
- lifecycle callback works;
- context works;
- interceptors can apply;
- resources can be injected;
- runtime can manage cleanup.

## 2.5 Golden rule

> Jika kamu ingin container services bekerja, object harus dikelola oleh container dan method call harus melewati boundary yang dikenali container.

---

# 3. Apa Itu Jakarta EE Component?

Jakarta EE component adalah unit fungsional aplikasi yang memakai satu atau lebih container services.

Contoh component:

- Servlet;
- Filter;
- Listener;
- JAX-RS resource;
- CDI bean;
- JPA entity;
- EJB/session bean;
- Message-driven bean;
- Batch artifact;
- WebSocket endpoint;
- Validator;
- Interceptor.

## 3.1 Component punya contract

Component bukan sekadar class.

Component biasanya punya:

- annotation;
- lifecycle;
- injection rules;
- threading rules;
- scope;
- deployment metadata;
- invocation model;
- security/transaction integration.

Contoh JAX-RS resource:

```java
@Path("/cases")
public class CaseResource {
    @GET
    public List<CaseDto> list() { ... }
}
```

Runtime harus:

- menemukan class;
- membaca `@Path`;
- membuat resource instance;
- menyambungkan dependency;
- mengatur request;
- memanggil method;
- serialize response.

## 3.2 Component identity

Component identity sering bukan hanya class name.

Runtime bisa membedakan:

- bean type;
- qualifiers;
- name;
- scope;
- deployment archive;
- module;
- classloader;
- descriptor config.

## 3.3 Component harus mengikuti rule runtime

Contoh:

- jangan membuat thread manual sembarangan;
- jangan menyimpan request-scoped object di singleton;
- jangan menganggap constructor injection selalu cukup jika runtime tidak mendukung;
- jangan mengakses `EntityManager` setelah transaction/context selesai;
- jangan menyimpan container-managed object ke static global state.

---

# 4. Apa Itu Container?

Container adalah runtime environment yang menyediakan services untuk components.

Jakarta EE Platform specification menggambarkan container sebagai runtime environment yang menyediakan services yang dibutuhkan application components.

## 4.1 Container responsibilities

Container bertanggung jawab atas:

- loading application artifact;
- reading metadata;
- creating components;
- dependency injection;
- lifecycle callbacks;
- scope/context lifecycle;
- interceptor/proxy application;
- security checks;
- transaction demarcation;
- resource pooling;
- persistence integration;
- request dispatching;
- error mapping;
- shutdown.

## 4.2 Container bukan hanya web server

Servlet container menangani HTTP, tetapi Jakarta EE runtime lebih luas.

Full runtime bisa juga menangani:

- JPA/JTA;
- CDI;
- JMS;
- Batch;
- Mail;
- EJB;
- security;
- connector;
- WebSocket.

## 4.3 Container as contract boundary

Aplikasi Jakarta EE tidak langsung mengelola semuanya sendiri.

Misalnya:

```java
@Inject DataSource ds;
```

Atau:

```java
@Resource(lookup = "jdbc/CaseDS")
DataSource ds;
```

DataSource bisa disediakan/dikelola runtime:

- pool;
- credentials;
- transaction enlistment;
- lifecycle;
- monitoring.

## 4.4 Container-managed services reduce boilerplate

Tanpa container, kamu harus:

- create connection pool;
- configure transactions;
- create HTTP routing;
- instantiate components;
- wire dependencies;
- manage request context;
- serialize JSON;
- handle security;
- shutdown resources.

Container menyederhanakan ini, tetapi menambah aturan runtime.

---

# 5. Jenis Container dan Runtime Environment

## 5.1 Servlet container

Menangani:

- servlet;
- filter;
- listener;
- session;
- request/response;
- async servlet;
- web app lifecycle.

Contoh kategori:

- Tomcat-like;
- Jetty-like;
- Undertow-like.

Servlet container saja belum tentu full Jakarta EE runtime.

## 5.2 CDI container

Menangani:

- bean discovery;
- injection;
- scopes;
- qualifiers;
- producers;
- interceptors;
- events;
- lifecycle.

Contoh implementation category:

- Weld-like;
- OpenWebBeans-like;
- runtime-integrated CDI.

## 5.3 JPA provider

Menangani:

- entity mapping;
- persistence context;
- dirty checking;
- queries;
- flush;
- lazy loading;
- caching;
- SQL generation.

JPA provider bukan selalu “container”, tapi di Jakarta EE ia diintegrasikan dengan container.

## 5.4 Transaction manager

Menangani:

- begin/commit/rollback;
- resource enlistment;
- transaction propagation;
- synchronization;
- timeout;
- XA coordination jika digunakan.

## 5.5 Full Jakarta EE runtime

Menggabungkan banyak container/services:

```text
Servlet + CDI + JAX-RS + JPA + JTA + Validation + Security + JMS + Batch + Mail + ...
```

## 5.6 Embedded/executable runtime

Beberapa runtime bisa dikemas bersama aplikasi:

```text
java -jar app.jar
```

Tetapi tetap memiliki container services internal.

## 5.7 External runtime

Aplikasi deploy sebagai WAR/EAR ke server.

```text
server starts
  ↓
app deployed
  ↓
container processes artifact
```

---

# 6. Deployment Pipeline: Dari Artifact ke Running Application

## 6.1 Artifact

Aplikasi Jakarta bisa dikemas sebagai:

- WAR;
- EAR;
- JAR module;
- executable jar/runtime image;
- container image.

## 6.2 Deployment pipeline umum

```text
Receive artifact
  ↓
Validate archive structure
  ↓
Create application classloader
  ↓
Read descriptors
  ↓
Scan classes/resources
  ↓
Build component metadata
  ↓
Resolve dependencies/injection points
  ↓
Initialize services/resources
  ↓
Create application context
  ↓
Register endpoints/listeners
  ↓
Call initialization callbacks
  ↓
Mark application ready
```

## 6.3 Deployment descriptor vs annotation

Metadata bisa berasal dari:

- annotations;
- `web.xml`;
- `beans.xml`;
- `persistence.xml`;
- runtime config;
- vendor descriptor;
- generated metadata;
- service loader;
- build-time index.

## 6.4 Deployment failure examples

- unsatisfied injection;
- ambiguous injection;
- invalid persistence unit;
- missing datasource;
- duplicate endpoint path;
- invalid security role mapping;
- incompatible API version;
- classloading conflict;
- invalid descriptor;
- provider missing.

## 6.5 Deployment-time validation is good

Lebih baik gagal saat deployment daripada saat request pertama.

Container biasanya melakukan validation awal untuk banyak hal.

Namun tidak semua error bisa ditemukan saat deployment.

Contoh runtime-only:

- DB credentials expired;
- downstream unavailable;
- query path rarely executed;
- lazy loading issue;
- transaction timeout under load.

---

# 7. Classloading Model

Classloading adalah salah satu penyebab bug paling sulit di Jakarta EE.

## 7.1 Class identity

Di Java:

```text
class identity = fully qualified class name + defining classloader
```

Dua class dengan nama sama bisa berbeda jika loaded oleh classloader berbeda.

## 7.2 Container classloader hierarchy

Conceptual:

```text
Bootstrap ClassLoader
  ↓
Platform/System ClassLoader
  ↓
Runtime/Server ClassLoader
  ↓
Application ClassLoader
  ↓
Module/Web ClassLoader
```

Detail tiap runtime bisa berbeda.

## 7.3 Parent-first vs child-first

Beberapa runtime memakai parent-first, beberapa punya opsi child-first untuk aplikasi.

Dampaknya:

- versi library mana yang dipakai;
- apakah app bisa override server library;
- risiko conflict;
- portability.

## 7.4 API jar conflict

Jika container menyediakan `jakarta.servlet.*`, aplikasi seharusnya tidak membawa API jar berbeda di `WEB-INF/lib`.

Karena annotation/interface yang terlihat sama bisa loaded berbeda.

## 7.5 Shared library

Server dapat menyediakan shared library global.

Risiko:

- semua aplikasi terdampak saat upgrade;
- version conflict antar apps;
- hidden dependency;
- local/prod mismatch.

## 7.6 Classloader leak

Classloader leak terjadi saat application undeployed/redeployed tetapi classloader lama masih direferensikan.

Penyebab:

- static cache;
- ThreadLocal tidak dibersihkan;
- thread manual masih hidup;
- JDBC driver not deregistered;
- logging framework refs;
- timer/scheduler;
- native library refs;
- global singleton.

## 7.7 Debugging classloading

Check:

- artifact contents;
- server libs;
- dependency tree;
- runtime classloader logs;
- `Class.getClassLoader()`;
- duplicate classes;
- `NoSuchMethodError` version mismatch;
- `ClassCastException` same FQCN different loader.

---

# 8. Component Discovery dan Metadata Processing

## 8.1 Discovery sources

Runtime menemukan component dari:

- annotation;
- deployment descriptor;
- classpath scanning;
- `beans.xml`;
- `persistence.xml`;
- service loader;
- module metadata;
- generated index;
- runtime config.

## 8.2 CDI bean discovery

CDI discovery membaca bean archives dan menentukan bean mana yang tersedia untuk injection.

CDI 4.x mengubah beberapa default discovery behavior, misalnya default `bean-discovery-mode` untuk empty `beans.xml` menjadi `annotated` dalam CDI 4.0 era.

## 8.3 JAX-RS discovery

JAX-RS runtime menemukan:

- `Application` subclass;
- resource classes annotated `@Path`;
- providers;
- filters;
- exception mappers;
- features.

## 8.4 Servlet discovery

Servlet container menemukan:

- servlet class;
- filters;
- listeners;
- annotations;
- `web.xml`.

## 8.5 JPA discovery

JPA runtime membaca:

- `persistence.xml`;
- entity classes;
- mapping metadata;
- provider config;
- datasource;
- transaction type.

## 8.6 Metadata model

Runtime biasanya membangun internal model:

```text
BeanDefinition
ResourceMethod
ServletRegistration
PersistenceUnitInfo
TransactionAttribute
SecurityConstraint
```

## 8.7 Metadata processing cost

Startup bisa lambat jika:

- classpath besar;
- scanning terlalu luas;
- banyak annotations;
- reflection-heavy processing;
- provider initialization berat;
- persistence unit besar;
- entity metamodel besar;
- bytecode enhancement;
- slow resource lookup.

## 8.8 Build-time processing

Modern runtimes dapat memindahkan sebagian processing ke build-time.

Keuntungan:

- faster startup;
- lower reflection;
- AOT/native friendliness;
- predictable deployment.

Trade-off:

- less dynamic behavior;
- build complexity;
- runtime extension constraints.

---

# 9. Object Creation: Siapa yang Membuat Object?

## 9.1 Container-created object

Jika class adalah managed component, container membuat object.

Contoh:

```java
@RequestScoped
public class CaseResource {
    @Inject CaseService service;
}
```

Runtime:

```text
create CaseResource
inject CaseService
associate with request context
destroy at end of request
```

## 9.2 User-created object

Jika kamu menulis:

```java
CaseResource r = new CaseResource();
```

maka injection tidak terjadi kecuali kamu manual.

## 9.3 Factory/producer

CDI bisa membuat object melalui producer method:

```java
@Produces
public ObjectMapper objectMapper() {
    return JsonMapper.builder().build();
}
```

Container mengelola produced object sesuai scope/disposal rules.

## 9.4 Constructor rules

Managed components punya aturan constructor tergantung spec/runtime.

Modern CDI mendukung constructor injection:

```java
@ApplicationScoped
public class CaseService {
    private final CaseRepository repository;

    @Inject
    public CaseService(CaseRepository repository) {
        this.repository = repository;
    }
}
```

Namun beberapa component type historically require no-arg constructor or specific lifecycle. Selalu cek spec/runtime.

## 9.5 Object creation anti-pattern

```java
public class CaseResource {
    private final CaseService service = new CaseService();
}
```

Ini bypass container.

## 9.6 Static singleton anti-pattern

```java
public static final CaseService INSTANCE = new CaseService();
```

Risiko:

- no injection;
- no lifecycle;
- classloader leak;
- test isolation buruk;
- hidden global state.

---

# 10. Dependency Injection Lifecycle

## 10.1 Injection point

Injection point:

```java
@Inject
CaseService service;
```

or:

```java
@Inject
public CaseResource(CaseService service) { ... }
```

or:

```java
@Inject
void init(CaseService service) { ... }
```

## 10.2 Resolution

Container resolve dependency berdasarkan:

- type;
- qualifier;
- bean availability;
- scope;
- alternatives;
- producers;
- visibility;
- archive/module.

## 10.3 Unsatisfied dependency

No bean matches:

```text
Unsatisfied dependency for type CaseService
```

Penyebab:

- class not discovered;
- missing annotation;
- package not in bean archive;
- wrong profile/runtime;
- dependency excluded;
- qualifier mismatch.

## 10.4 Ambiguous dependency

Multiple beans match:

```text
Ambiguous dependency
```

Solusi:

- qualifier;
- alternative;
- priority;
- specialization;
- remove duplicate.

## 10.5 Injection timing

Typical lifecycle:

```text
construct object
  ↓
inject fields/methods
  ↓
call @PostConstruct
  ↓
object ready
```

Constructor injection differs because dependencies are provided during construction.

## 10.6 Injection into non-managed object

`@Inject` in non-managed object does nothing automatically.

Common bug:

```java
public class MyMapper {
    @Inject Validator validator; // null if MyMapper created with new
}
```

Fix:

- make mapper CDI bean;
- pass dependency explicitly;
- use producer;
- avoid injection in pure utility object.

---

# 11. Lifecycle Callback: `@PostConstruct` dan `@PreDestroy`

## 11.1 `@PostConstruct`

Called after dependency injection, before object is put into service.

Use for:

- validate configuration;
- initialize lightweight resource;
- precompute metadata;
- register internal state;
- fail fast if config invalid.

Avoid:

- long blocking I/O;
- remote call dependency check without timeout;
- heavy cache warmup blocking startup;
- starting unmanaged threads;
- swallowing init errors.

## 11.2 `@PreDestroy`

Called before component destruction.

Use for:

- close resources;
- flush buffers;
- stop background task;
- deregister listeners;
- cleanup native handles.

## 11.3 Startup and readiness

If `@PostConstruct` takes too long, Kubernetes startup can fail if probes are wrong.

Prefer:

- startup probe;
- async warmup with readiness false until complete;
- bounded timeout;
- clear logs.

## 11.4 Failure in lifecycle callback

If `@PostConstruct` fails, deployment/startup may fail.

This is often good for invalid config.

But distinguish:

- required config invalid → fail fast;
- optional downstream unavailable → maybe readiness false/retry.

## 11.5 Lifecycle callback ordering

Ordering across components may not be obvious unless dependency relation is explicit.

If A must initialize before B, express dependency.

Do not rely on incidental startup order.

---

# 12. Scope dan Context

Scope determines lifecycle and visibility.

## 12.1 Common scopes

Conceptual:

- dependent;
- request;
- session;
- application;
- conversation;
- custom scopes.

## 12.2 Request scope

One instance per HTTP request/context.

Good for:

- request-specific data;
- request lifecycle;
- per-request helper.

Bad for:

- storing beyond request;
- background thread usage;
- caching.

## 12.3 Application scope

One instance for application.

Good for:

- stateless services;
- shared clients;
- singleton config;
- cache if bounded;
- producer objects.

Need thread safety.

## 12.4 Session scope

One instance per user session.

Risiko:

- memory growth;
- clustering/sticky session;
- serialization;
- stale state;
- security/session fixation.

## 12.5 Dependent scope

Lifecycle tied to injection target.

Can create many instances. Be mindful of cleanup/disposal.

## 12.6 Context not active

Error:

```text
ContextNotActiveException
```

Occurs when accessing context-specific bean outside active context, e.g. request-scoped bean in background thread.

## 12.7 Scope mismatch

Application-scoped bean injecting request-scoped bean may use proxy. But storing request data in application singleton is dangerous.

## 12.8 Scope design rule

Choose scope by ownership:

```text
Who owns this state?
How long is it valid?
Who destroys it?
Is it thread-safe?
```

---

# 13. Proxy dan Indirection

## 13.1 Why proxies exist

Container uses proxies for:

- scoped beans;
- lazy resolution;
- interception;
- transaction;
- security;
- decorators;
- lifecycle indirection.

## 13.2 Proxy flow

```text
caller
  ↓
proxy
  ↓
resolve contextual instance
  ↓
interceptors
  ↓
target
```

## 13.3 Normal scoped CDI bean

Normal scoped bean is often injected as proxy, not raw instance.

This allows:

- request-scoped bean injected into application-scoped bean;
- actual instance resolved per request;
- lifecycle management.

## 13.4 Proxy limitations

Proxy may require:

- non-final class/method in some models;
- accessible constructor;
- no private method interception;
- call through proxy.

## 13.5 Self-invocation problem

If interceptor/transaction is proxy-based:

```java
public void outer() {
    inner(); // this.inner()
}

@Transactional
public void inner() {}
```

Internal call may bypass proxy/interceptor.

This concept applies broadly in proxy-based frameworks.

## 13.6 Debugging proxy

If class name looks like:

```text
$Proxy...
...ClientProxy...
...Subclass...
```

do not panic. It may be container proxy.

But avoid:

```java
bean.getClass() == MyService.class
```

Use interface/type checks carefully.

---

# 14. Servlet Container Model

Jakarta Servlet defines server-side API for HTTP request/response handling.

## 14.1 Servlet lifecycle

Conceptual:

```text
load servlet class
  ↓
instantiate
  ↓
init()
  ↓
service requests
  ↓
destroy()
```

## 14.2 Request flow

```text
HTTP socket
  ↓
container parses request
  ↓
creates request/response objects
  ↓
runs filters
  ↓
dispatches to servlet/resource
  ↓
commits response
```

## 14.3 Filter chain

Filters can handle:

- authentication;
- logging;
- tracing;
- compression;
- CORS;
- request validation;
- security headers;
- rate limit;
- metrics.

Order matters.

## 14.4 Listeners

Listeners observe lifecycle events:

- context startup/shutdown;
- session create/destroy;
- request initialized/destroyed.

Useful for resource setup/cleanup, but avoid heavy logic without control.

## 14.5 Threading

Servlet container uses threads to handle requests.

With virtual thread support in modern runtimes, model may differ, but resource limits still matter.

## 14.6 Async servlet

Async servlet allows request processing to continue without holding original request thread.

But complexity increases:

- timeout;
- dispatch;
- context propagation;
- error handling;
- cleanup.

## 14.7 Common servlet mistakes

- blocking slow downstream without timeout;
- storing request object beyond request lifecycle;
- thread-local not cleared;
- liveness depends on DB;
- session used as cache;
- filters doing heavy work for every request;
- response committed before error handling.

---

# 15. JAX-RS Runtime Model

JAX-RS / Jakarta REST provides resource-oriented HTTP programming.

## 15.1 Resource discovery

Runtime finds:

```java
@Path("/cases")
public class CaseResource { ... }
```

and registers resource methods.

## 15.2 Resource method matching

Request:

```http
GET /cases/123
Accept: application/json
```

Runtime matches:

- HTTP method;
- path template;
- consumes/produces media type;
- parameter converters;
- filters/interceptors;
- exception mappers.

## 15.3 Providers

Providers include:

- message body reader/writer;
- exception mapper;
- filters;
- interceptors;
- context resolver;
- param converter.

## 15.4 JSON integration

Runtime chooses JSON provider:

- JSON-B;
- JSON-P;
- Jackson if runtime/framework config uses it;
- vendor-specific provider.

Be explicit if contract matters.

## 15.5 Resource lifecycle

JAX-RS resource instance lifecycle can vary depending CDI integration/runtime.

Do not assume singleton unless specified/configured.

## 15.6 Exception mapping

Use exception mapper to produce stable error response.

```java
@Provider
public class DomainExceptionMapper implements ExceptionMapper<DomainException> {
    public Response toResponse(DomainException ex) {
        ...
    }
}
```

## 15.7 Common JAX-RS issues

- resource not discovered;
- provider not registered;
- ambiguous path;
- wrong media type;
- missing JSON provider;
- validation not triggered;
- exception leaks stack trace;
- request context used outside request.

---

# 16. CDI Container Model

CDI provides contextual dependency injection.

CDI 4.1 is the Jakarta EE 11-era CDI release.

## 16.1 CDI goals

CDI improves:

- reusability;
- testability;
- maintainability;
- loose coupling;
- strong typing.

## 16.2 Bean discovery

CDI discovers beans from bean archives and annotations.

Important concepts:

- bean-defining annotations;
- `beans.xml`;
- discovery mode;
- CDI Lite vs Full;
- alternatives/producers/extensions.

## 16.3 Qualifiers

Qualifiers disambiguate beans.

```java
@Qualifier
@Retention(RUNTIME)
@Target({FIELD, PARAMETER, METHOD, TYPE})
public @interface PrimaryDatabase {}
```

## 16.4 Producers

Producer methods create injectable objects:

```java
@Produces
@ApplicationScoped
public Clock clock() {
    return Clock.systemUTC();
}
```

## 16.5 Interceptors

Interceptors provide cross-cutting behavior.

```java
@Audited
public void approve(...) {}
```

## 16.6 Events

CDI events allow decoupled in-process notifications.

Use carefully:

- synchronous/asynchronous semantics;
- transaction relation;
- error handling;
- observability.

## 16.7 CDI Lite vs Full

CDI Lite targets lighter runtimes and build-time processing. CDI Full provides broader capabilities.

Core Profile often aligns with smaller CDI model.

## 16.8 CDI pitfalls

- ambiguous injection;
- unsatisfied dependency;
- scope mismatch;
- proxy limitations;
- circular dependency;
- event side effects hidden;
- producer method too magical;
- relying on discovery without tests.

---

# 17. Persistence dan EntityManager Runtime Model

## 17.1 Persistence unit

JPA configuration defines persistence unit.

Sources:

- `persistence.xml`;
- runtime config;
- annotations;
- provider-specific config.

## 17.2 EntityManager

`EntityManager` is interface to persistence context.

Container may inject:

```java
@PersistenceContext
EntityManager em;
```

## 17.3 Container-managed persistence context

In Jakarta EE runtime, `EntityManager` can be container-managed and transaction-scoped.

Conceptual:

```text
request/use case
  ↓
transaction starts
  ↓
persistence context associated
  ↓
entities loaded/managed
  ↓
flush before commit
  ↓
transaction commits
  ↓
context ends
```

## 17.4 Application-managed EntityManager

You can create/manage EM manually in some modes.

Then you own:

- open;
- close;
- transaction handling if resource-local;
- lifecycle.

## 17.5 Lazy loading and context

Lazy association needs active persistence context/session.

If accessed after context closed:

```text
LazyInitializationException or provider-specific error
```

## 17.6 Transaction integration

JPA integrates with transaction manager.

Container can:

- join transaction;
- flush on commit;
- rollback on failure;
- enlist datasource.

## 17.7 JPA runtime pitfalls

- entity serialized to REST;
- N+1 query;
- long persistence context;
- detached entity merge confusion;
- no transaction;
- wrong datasource;
- provider mismatch;
- persistence.xml not found;
- entity not scanned;
- lazy load outside transaction.

---

# 18. Transaction Runtime Model

## 18.1 Declarative transaction

Jakarta transaction allows declarative transaction behavior.

Example:

```java
@Transactional
public void approve(ApproveCase command) {
    ...
}
```

Runtime/interceptor handles:

```text
begin
  ↓
invoke method
  ↓
commit if success
  ↓
rollback if failure rule
```

## 18.2 Transaction boundary

Transaction boundary should usually be application service/use case.

Not controller-specific logic, not domain object, not random utility.

## 18.3 Resource enlistment

Resources like JDBC connections can be enlisted in transaction.

In XA/distributed transaction, multiple resources can be coordinated, but at cost/complexity.

## 18.4 Local transaction vs distributed transaction

Local:

```text
single database/resource
```

Distributed/XA:

```text
multiple transactional resources
```

Modern cloud architecture often prefers outbox/saga over XA for service-to-service/event consistency.

## 18.5 Rollback rules

Understand which exceptions trigger rollback in your spec/runtime/framework configuration.

Do not assume all checked exceptions rollback unless defined.

## 18.6 Transaction pitfalls

- external HTTP call inside transaction;
- transaction too long;
- lazy loading outside transaction;
- self-invocation bypass;
- swallowed exception causes commit;
- retry inside same transaction;
- transaction boundary around batch too large;
- nested transaction misunderstanding.

---

# 19. Security Runtime Model

Jakarta EE security is container-integrated.

## 19.1 Container security responsibilities

Container can provide:

- authentication;
- role mapping;
- authorization checks;
- security context;
- principal;
- declarative constraints;
- integration with servlet/JAX-RS/CDI;
- application-layer security services.

## 19.2 Authentication

Authentication establishes identity.

Mechanisms can include:

- form/basic;
- container-specific;
- Jakarta Security mechanisms;
- token/OIDC integration through runtime/framework;
- enterprise identity provider.

## 19.3 Authorization

Authorization checks whether identity may perform action.

Layers:

- URL/resource;
- method;
- domain policy;
- data-level authorization.

Container role checks are not a full domain authorization model.

## 19.4 Security context

Application can access security context/principal.

But avoid leaking security logic everywhere.

## 19.5 Declarative security

Annotations/descriptors can declare:

```text
roles allowed
security constraints
login config
transport guarantee
```

## 19.6 Security pitfalls

- assuming authentication equals authorization;
- role-only model too coarse;
- missing method/resource enforcement;
- no audit of security decisions;
- trust-all TLS;
- session fixation;
- CSRF for browser session apps;
- logging token/PII;
- custom security bypassing container.

---

# 20. Resource Management: DataSource, JMS, Mail, JNDI

## 20.1 Resource is not just object

Resource often has:

- pool;
- credentials;
- lifecycle;
- transaction integration;
- monitoring;
- timeout;
- retry;
- security context.

## 20.2 DataSource

Container-managed DataSource can provide:

- connection pooling;
- JTA integration;
- credential management;
- metrics;
- validation;
- leak detection.

## 20.3 JNDI

Historically, resources can be looked up through JNDI names.

Example:

```java
@Resource(lookup = "jdbc/CaseDS")
DataSource ds;
```

## 20.4 JMS resources

Container can manage:

- connection factory;
- destination;
- listener;
- transaction;
- redelivery/DLQ depending provider.

## 20.5 Mail session

Container can provide mail session config:

- SMTP host;
- auth;
- TLS;
- default sender.

## 20.6 Resource pitfalls

- resource name differs local/prod;
- pool not sized for replicas;
- missing credentials;
- transaction enlistment mismatch;
- connection leak;
- blocking startup on resource test;
- vendor-specific resource config not documented.

---

# 21. Thread dan Concurrency Rules

## 21.1 Why thread rules exist

Container manages contexts:

- request;
- security;
- transaction;
- naming;
- classloader;
- CDI scopes;
- resource lifecycle.

Manual threads may not have these contexts.

## 21.2 Bad pattern

```java
new Thread(() -> {
    service.doWork();
}).start();
```

Risks:

- context missing;
- classloader leak;
- no shutdown control;
- no security context;
- no transaction context;
- unmanaged lifecycle;
- resource leak.

## 21.3 Managed concurrency

Jakarta Concurrency provides managed executors/thread factories.

Use container-managed executor when you need background work in Jakarta EE.

## 21.4 Virtual threads

Modern Jakarta EE acknowledges virtual thread runtime support.

But virtual threads still need:

- managed context rules;
- downstream bulkhead;
- transaction caution;
- ThreadLocal audit;
- graceful shutdown;
- observability.

## 21.5 Request-scoped beans in background thread

Do not pass request-scoped object into background job unless context propagation is explicitly supported and intended.

Extract immutable data:

```java
record WorkItem(CaseId caseId, ActorId actorId, CorrelationId correlationId) {}
```

## 21.6 Concurrency checklist

- use managed executor;
- bound queues/concurrency;
- set timeouts;
- propagate only needed context;
- observe queue/active/rejected;
- shutdown gracefully;
- avoid transaction across async boundary unless explicitly supported.

---

# 22. Configuration dan Environment

## 22.1 Configuration sources

Jakarta runtimes may support config through:

- deployment descriptors;
- server config;
- environment variables;
- system properties;
- MicroProfile Config;
- vendor config;
- Kubernetes configmap/secret;
- application properties.

Jakarta EE itself is not identical to MicroProfile Config, but many runtimes support both.

## 22.2 Runtime config vs application config

Runtime config:

- datasource;
- transaction manager;
- security realm;
- JMS resources;
- thread pools;
- HTTP ports;
- TLS;
- classloading.

Application config:

- business feature flags;
- thresholds;
- external endpoint;
- timeout values;
- batch size.

## 22.3 Configuration anti-pattern

- hardcoded environment;
- credentials in artifact;
- config only in server UI;
- no config versioning;
- local/prod mismatch;
- no validation at startup;
- no documentation.

## 22.4 Configuration validation

At startup, validate required config.

But don't block indefinitely on remote optional services.

---

# 23. Packaging dan Runtime Boot Model

## 23.1 External server boot

```text
server starts
  ↓
deploy app
  ↓
container initializes app
```

Pros:

- runtime shared;
- standard deployment;
- server-managed resources.

Cons:

- app/server coupling;
- patching server separately;
- classloader complexity;
- local/prod drift.

## 23.2 Executable boot

```text
java -jar app-with-runtime.jar
  ↓
runtime starts
  ↓
app deployed internally
```

Pros:

- predictable artifact;
- container-friendly;
- easier local/prod parity.

Cons:

- runtime included;
- portability depends on runtime packaging;
- artifact larger.

## 23.3 Container image boot

```text
container starts
  ↓
JVM starts
  ↓
runtime starts
  ↓
application starts
  ↓
readiness true
```

Need consider:

- startup probe;
- memory;
- CPU;
- graceful shutdown;
- logs to stdout;
- config/secrets;
- image scanning.

## 23.4 Boot-time tasks

Common tasks:

- class scanning;
- CDI bootstrap;
- REST route registration;
- JPA metamodel;
- datasource initialization;
- schema migration;
- cache warmup;
- security realm init.

Do not make boot too fragile.

---

# 24. Runtime Services: Health, Metrics, Logging, Tracing

## 24.1 Jakarta EE vs MicroProfile/Observability

Some observability capabilities may come from runtime/vendor/MicroProfile/OpenTelemetry integration rather than Jakarta EE core specs.

Document source:

```text
Health endpoint: runtime/MicroProfile
Metrics: runtime/Micrometer/OpenTelemetry
Tracing: OpenTelemetry agent/SDK/runtime
```

## 24.2 Logging

Runtime logs and application logs must be correlated.

Use:

- structured logs;
- trace/correlation ID;
- deployment version;
- component name.

## 24.3 Metrics

Critical runtime metrics:

- request rate/latency/error;
- JVM heap/GC/thread;
- datasource pool active/pending;
- transaction count/failures;
- CDI/request context if available;
- JAX-RS/servlet metrics;
- JMS/batch metrics;
- CPU/memory container.

## 24.4 Tracing

Trace key boundaries:

- servlet/JAX-RS request;
- CDI/application service;
- JPA/DB;
- JMS publish/consume;
- external HTTP;
- batch step.

## 24.5 JFR

JFR is JVM-level and works regardless of Jakarta runtime.

Use for:

- CPU profiling;
- allocation;
- GC;
- lock contention;
- socket I/O;
- thread activity;
- method profiling.

## 24.6 Health checks

Separate:

- liveness;
- readiness;
- startup.

Liveness should not depend on volatile downstream.

---

# 25. Portability vs Vendor Extension

## 25.1 Standard API

Portable:

```java
jakarta.ws.rs.GET
jakarta.inject.Inject
jakarta.persistence.Entity
jakarta.transaction.Transactional
```

## 25.2 Vendor extension

Non-portable:

```text
runtime-specific annotation
server-specific config
proprietary deployment descriptor
custom classloader setting
non-standard health endpoint
vendor-specific datasource config
```

## 25.3 Extension is not evil

Vendor extension can be justified for:

- performance;
- observability;
- cloud integration;
- security integration;
- operational convenience;
- missing standard capability.

But document it.

## 25.4 ADR required

For vendor extension:

```markdown
Decision: Use runtime-specific datasource config.
Reason: required for cloud secret integration.
Risk: runtime lock-in.
Mitigation: isolate config and document migration path.
```

## 25.5 Portability test

If portability matters, periodically deploy to another compatible runtime or at least avoid APIs/configs that prevent it.

---

# 26. Common Failure Modes

## 26.1 `@Inject` is null

Likely:

- object created with `new`;
- class not CDI bean;
- bean discovery issue;
- wrong archive;
- field static/final issue;
- injection in unsupported component;
- test not using container.

## 26.2 Unsatisfied dependency

Likely:

- missing bean-defining annotation;
- missing producer;
- dependency not on classpath;
- qualifier mismatch;
- profile/runtime missing spec.

## 26.3 Ambiguous dependency

Likely:

- multiple implementations;
- missing qualifier;
- duplicate bean from library;
- producer + class both available.

## 26.4 `@PostConstruct` not called

Likely:

- object not managed;
- wrong annotation namespace;
- lifecycle method invalid;
- deployment failed before init.

## 26.5 REST endpoint not found

Likely:

- resource not discovered;
- wrong `Application` config;
- deployment path mismatch;
- runtime lacks JAX-RS;
- classloading conflict;
- package excluded.

## 26.6 Transaction not active

Likely:

- method not invoked through container/proxy;
- component not transactional;
- wrong transaction annotation;
- self-invocation;
- async boundary;
- no transaction manager.

## 26.7 Persistence provider not found

Likely:

- provider missing;
- persistence.xml not found;
- wrong classpath;
- wrong packaging;
- runtime not full/web profile;
- config mismatch.

## 26.8 Security context missing

Likely:

- endpoint not protected;
- auth mechanism not configured;
- async/background thread;
- wrong security integration;
- test bypasses security.

## 26.9 Classloader conflict

Likely:

- API jar packaged in WAR;
- duplicate libraries;
- server shared library mismatch;
- `javax`/`jakarta` mixed;
- old transitive dependency.

## 26.10 Shutdown leak

Likely:

- manual thread;
- executor not stopped;
- ThreadLocal not cleared;
- resource not closed;
- static cache;
- driver not deregistered.

---

# 27. Debugging Playbook

## 27.1 Start with deployment logs

Check:

- deployment start/end;
- class scanning;
- CDI bootstrap;
- JAX-RS registration;
- persistence unit;
- datasource;
- security realm;
- transaction manager;
- warnings.

## 27.2 Inspect artifact

WAR:

```bash
jar tf target/app.war | sort
```

Check:

```text
WEB-INF/classes
WEB-INF/lib
WEB-INF/web.xml
META-INF/persistence.xml
WEB-INF/beans.xml
```

## 27.3 Inspect dependency tree

```bash
mvn dependency:tree
```

Look for:

- `javax`;
- duplicate `jakarta`;
- old providers;
- conflicting logging;
- runtime API packaged.

## 27.4 Verify managed object

Ask:

```text
Who created this object?
Is it managed by container?
Is it injected by container?
Is method invoked through proxy/container?
```

## 27.5 Verify context

For context-related errors:

- request context active?
- transaction active?
- security context active?
- persistence context active?
- CDI context active?

## 27.6 Minimal reproduction

Create smallest component:

```java
@Path("/health-test")
public class RuntimeTestResource {
    @Inject BeanManager beanManager;

    @GET
    public String ok() {
        return "ok";
    }
}
```

If this fails, runtime setup problem.

## 27.7 Use runtime admin/diagnostic tools

Depending runtime:

- list deployed apps;
- list endpoints;
- list datasource;
- list CDI beans;
- thread dump;
- server logs;
- config dump;
- metrics.

## 27.8 Use JFR for runtime issue

JFR can reveal:

- startup CPU;
- class loading;
- allocation;
- lock contention;
- socket I/O;
- thread activity;
- GC.

---

# 28. Production Checklist

## 28.1 Runtime selection

- [ ] Jakarta EE version selected.
- [ ] Profile selected.
- [ ] Runtime compatible.
- [ ] Java version supported.
- [ ] Runtime patch strategy defined.
- [ ] Vendor extensions documented.

## 28.2 Artifact

- [ ] Correct packaging.
- [ ] API jars not duplicated.
- [ ] Dependency tree clean.
- [ ] `javax`/`jakarta` checked.
- [ ] Runtime-specific config documented.
- [ ] Build reproducible.

## 28.3 Lifecycle

- [ ] Startup bounded.
- [ ] `@PostConstruct` safe.
- [ ] `@PreDestroy` cleanup safe.
- [ ] Graceful shutdown tested.
- [ ] No unmanaged threads.

## 28.4 Resources

- [ ] DataSource configured.
- [ ] Pool sized with replicas.
- [ ] Timeouts set.
- [ ] Transaction timeout set.
- [ ] JMS/Mail resources configured if used.
- [ ] Secrets externalized.

## 28.5 Observability

- [ ] Logs structured.
- [ ] Metrics exported.
- [ ] Tracing integrated.
- [ ] JFR plan exists.
- [ ] Runtime health checks configured.
- [ ] Dashboard/runbook available.

## 28.6 Security

- [ ] Auth configured.
- [ ] Authorization policy defined.
- [ ] TLS configured.
- [ ] Roles mapped.
- [ ] Security context tested.
- [ ] Sensitive data not logged.

## 28.7 Testing

- [ ] Unit tests pure.
- [ ] Integration tests in container/runtime.
- [ ] Deployment smoke test.
- [ ] Transaction test.
- [ ] Security test.
- [ ] Resource failure test.
- [ ] Shutdown test.

---

# 29. Latihan Bertahap

## Latihan 1 — Managed vs unmanaged object

Buat CDI bean:

```java
@ApplicationScoped
public class GreetingService {
    public String hello() { return "hello"; }
}
```

Buat resource yang di-manage container dan satu class yang dibuat dengan `new`.

Amati injection bekerja/tidak bekerja.

## Latihan 2 — `@PostConstruct`

Buat bean dengan:

```java
@PostConstruct
void init() {
    System.out.println("initialized");
}
```

Coba:

- managed bean;
- manually constructed object.

Bandingkan.

## Latihan 3 — Scope

Buat request-scoped bean dengan ID random.

Panggil endpoint beberapa kali.

Amati instance per request.

## Latihan 4 — Ambiguous injection

Buat dua implementation untuk interface yang sama.

Amati ambiguous dependency.

Fix dengan qualifier.

## Latihan 5 — JAX-RS provider

Buat custom exception mapper.

Throw domain exception dari resource.

Pastikan response stabil.

## Latihan 6 — JPA context

Buat endpoint yang load entity dan akses lazy relation di luar transaction.

Amati failure.

Fix dengan transaction/projection.

## Latihan 7 — Classloading duplicate

Package API jar ke WAR secara sengaja.

Deploy ke runtime yang sudah menyediakan API.

Amati warning/error.

## Latihan 8 — Managed executor

Bandingkan unmanaged `new Thread` dengan managed executor.

Test shutdown.

## Latihan 9 — Startup probe simulation

Tambahkan slow `@PostConstruct`.

Deploy ke Kubernetes-like setup atau simulate probe behavior.

## Latihan 10 — Runtime diagnostics

Ambil JFR saat startup.

Lihat class loading, allocation, dan CPU.

---

# 30. Mini Project: Tiny Jakarta Runtime Mental Model

## 30.1 Goal

Buat project:

```text
jakarta-runtime-model-lab/
```

Dengan modul:

```text
managed-vs-unmanaged/
cdi-scope-lab/
jaxrs-provider-lab/
jpa-transaction-lab/
resource-management-lab/
shutdown-lab/
```

## 30.2 Requirements

- Jakarta EE 11 target;
- deploy ke compatible runtime;
- gunakan Web Profile atau Core sesuai modul;
- dokumentasikan runtime;
- tulis failure notes.

## 30.3 Deliverables

```text
README.md
RUNTIME-MODEL.md
CLASSLOADING-NOTES.md
LIFECYCLE-NOTES.md
INJECTION-FAILURES.md
TRANSACTION-FAILURES.md
SHUTDOWN-RUNBOOK.md
```

## 30.4 Experiments

1. Injection works only in managed component.
2. `@PostConstruct` only called by container.
3. Request scope differs from application scope.
4. Qualifier resolves ambiguity.
5. JAX-RS provider maps exception.
6. EntityManager requires provider/context.
7. Transaction boundary affects persistence.
8. Manual thread causes shutdown issue.
9. Packaged API jar causes conflict.
10. JFR shows startup processing.

## 30.5 Evaluation questions

1. Who creates this object?
2. Which context is active?
3. Which classloader loaded this class?
4. Which runtime provides this implementation?
5. Is method invoked through proxy/container?
6. Is transaction active?
7. Is security context active?
8. Who owns this resource lifecycle?
9. What happens on shutdown?
10. Is this behavior portable?

---

# 31. Referensi Resmi

Referensi utama:

1. Jakarta EE Tutorial — Overview  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/intro/overview/overview.html

2. Jakarta EE Tutorial — Dependency Injection  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/platform/injection/injection.html

3. Jakarta EE Tutorial — Introduction to Security in the Jakarta EE Platform  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/security/security-intro/security-intro.html

4. Jakarta EE Platform Specification 11  
   https://jakarta.ee/specifications/platform/11/

5. Jakarta EE Platform Specification 10 — Containers and Services discussion  
   https://jakarta.ee/specifications/platform/10/jakarta-platform-spec-10.0

6. Jakarta Contexts and Dependency Injection 4.1  
   https://jakarta.ee/specifications/cdi/4.1/

7. Jakarta CDI Specification 4.1  
   https://jakarta.ee/specifications/cdi/4.1/jakarta-cdi-spec-4.1

8. Jakarta Servlet 6.1  
   https://jakarta.ee/specifications/servlet/6.1/

9. Jakarta Servlet Specification 6.1  
   https://jakarta.ee/specifications/servlet/6.1/jakarta-servlet-spec-6.1

10. Jakarta EE Tutorial — Jakarta Servlet  
    https://jakarta.ee/learn/docs/jakartaee-tutorial/current/web/servlets/servlets.html

11. Jakarta EE Tutorial — Getting Started with Web Applications  
    https://jakarta.ee/learn/docs/jakartaee-tutorial/current/web/webapp/webapp.html

---

# Penutup

Jakarta EE runtime/container adalah pusat dari “magic” Jakarta.

Jika kamu hanya melihat source code, annotation seperti ini terlihat sederhana:

```java
@Path("/cases")
@RequestScoped
public class CaseResource {
    @Inject CaseService service;
}
```

Namun runtime melakukan pekerjaan besar:

```text
deployment
classloading
metadata processing
component discovery
object creation
dependency injection
scope/context management
proxy/interceptor
transaction/security/resource integration
HTTP dispatch
serialization
lifecycle cleanup
```

Mental model paling penting:

> Jakarta EE application bukan hanya kumpulan class. Ia adalah kumpulan component yang berjalan dalam runtime/container yang menyediakan services.

Karena itu setiap bug harus ditanya dari perspektif container:

```text
Apakah object ini managed?
Apakah context aktif?
Apakah dependency discoverable?
Apakah runtime menyediakan implementation?
Apakah classloader memuat versi yang benar?
Apakah call melewati proxy?
Apakah resource lifecycle dikelola container?
```

Jika kamu bisa menjawab pertanyaan itu, kamu sudah jauh melampaui level “bisa pakai annotation”. Kamu mulai memahami Jakarta EE sebagai runtime platform.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-jakarta-part-003.md](./learn-java-jakarta-part-003.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-java-jakarta-part-005.md](./learn-java-jakarta-part-005.md)

</div>