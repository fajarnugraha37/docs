# learn-java-jakarta-part-005.md

# Bagian 5 — `jakarta.annotation` dan Common Annotations

> Target pembaca: Java engineer yang ingin memahami annotation umum di Jakarta EE bukan sebagai “tempelan import”, tetapi sebagai **kontrak semantik lintas teknologi** yang dipakai container/runtime untuk lifecycle, resource injection, ordering, security role declaration, dan migration dari `javax.annotation`.
>
> Fokus bagian ini: `jakarta.annotation` sebagai paket common annotations, terutama `@PostConstruct`, `@PreDestroy`, `@Resource`, `@Resources`, `@Priority`, `@Generated`, dan package terkait seperti `jakarta.annotation.security` serta `jakarta.annotation.sql`. Kita akan bahas mental model, lifecycle, container behavior, dependency, migration, failure modes, testing, dan production usage.

---

## Daftar Isi

1. [Orientasi: Apa Itu `jakarta.annotation`?](#1-orientasi-apa-itu-jakartaannotation)
2. [Mental Model: Annotation sebagai Metadata untuk Container](#2-mental-model-annotation-sebagai-metadata-untuk-container)
3. [Sejarah Singkat: Common Annotations → `javax.annotation` → `jakarta.annotation`](#3-sejarah-singkat-common-annotations--javaxannotation--jakartaannotation)
4. [Jakarta Annotations 3.0 dan Jakarta EE 11](#4-jakarta-annotations-30-dan-jakarta-ee-11)
5. [Dependency dan Packaging](#5-dependency-dan-packaging)
6. [Peta Package: `jakarta.annotation`, `jakarta.annotation.security`, `jakarta.annotation.sql`](#6-peta-package-jakartaannotation-jakartaannotationsecurity-jakartaannotationsql)
7. [`@PostConstruct`: Initialization Callback](#7-postconstruct-initialization-callback)
8. [`@PreDestroy`: Destruction Callback](#8-predestroy-destruction-callback)
9. [Lifecycle Ordering: Constructor → Injection → PostConstruct → Service → PreDestroy](#9-lifecycle-ordering-constructor--injection--postconstruct--service--predestroy)
10. [`@Resource`: Resource Injection dan Environment Reference](#10-resource-resource-injection-dan-environment-reference)
11. [`@Resources`: Multiple Resource Declarations](#11-resources-multiple-resource-declarations)
12. [`@Priority`: Ordering dan Selection Semantics](#12-priority-ordering-dan-selection-semantics)
13. [`@Generated`: Generated Code Metadata](#13-generated-generated-code-metadata)
14. [`jakarta.annotation.security`: `@RolesAllowed`, `@PermitAll`, `@DenyAll`, `@DeclareRoles`, `@RunAs`](#14-jakartaannotationsecurity-rolesallowed-permitall-denyall-declareroles-runas)
15. [`jakarta.annotation.sql`: `@DataSourceDefinition` dan `@DataSourceDefinitions`](#15-jakartaannotationsql-datasourcedefinition-dan-datasourcedefinitions)
16. [Common Annotations vs CDI Annotations](#16-common-annotations-vs-cdi-annotations)
17. [Common Annotations vs Spring Lifecycle Annotations](#17-common-annotations-vs-spring-lifecycle-annotations)
18. [Managed Object vs Plain Object](#18-managed-object-vs-plain-object)
19. [Startup Design: Apa yang Boleh dan Tidak Boleh di `@PostConstruct`](#19-startup-design-apa-yang-boleh-dan-tidak-boleh-di-postconstruct)
20. [Shutdown Design: Apa yang Boleh dan Tidak Boleh di `@PreDestroy`](#20-shutdown-design-apa-yang-boleh-dan-tidak-boleh-di-predestroy)
21. [Resource Injection Design: `@Resource` vs `@Inject` vs Config](#21-resource-injection-design-resource-vs-inject-vs-config)
22. [Migration: `javax.annotation` ke `jakarta.annotation`](#22-migration-javaxannotation-ke-jakartaannotation)
23. [Testing Strategy](#23-testing-strategy)
24. [Production Failure Modes](#24-production-failure-modes)
25. [Debugging Playbook](#25-debugging-playbook)
26. [Best Practices dan Anti-Patterns](#26-best-practices-dan-anti-patterns)
27. [Checklist Review](#27-checklist-review)
28. [Latihan Bertahap](#28-latihan-bertahap)
29. [Mini Project: Lifecycle and Resource Lab](#29-mini-project-lifecycle-and-resource-lab)
30. [Referensi Resmi](#30-referensi-resmi)

---

# 1. Orientasi: Apa Itu `jakarta.annotation`?

`jakarta.annotation` adalah paket Jakarta yang berisi **common annotations**: annotation umum yang merepresentasikan konsep semantik yang dipakai lintas teknologi Java enterprise.

Contoh:

```java
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;

@ApplicationScoped
public class CaseStartupCache {

    @PostConstruct
    void init() {
        // called by container after dependency injection
    }

    @PreDestroy
    void shutdown() {
        // called by container before instance is removed
    }
}
```

Annotation ini bukan milik CDI saja, bukan milik JAX-RS saja, bukan milik Servlet saja, bukan milik Spring saja.

Ia adalah annotation umum yang dapat didukung oleh berbagai container/framework.

## 1.1 Apa fungsi `jakarta.annotation`?

Fungsi utamanya:

- lifecycle callback;
- resource declaration/injection;
- ordering/priority;
- generated-code metadata;
- security role annotation package;
- datasource definition package.

## 1.2 Kenapa penting?

Karena banyak behavior enterprise Java terlihat seperti “magic” tetapi sebenarnya dimulai dari metadata annotation.

Contoh:

```java
@PostConstruct
void init() {}
```

Artinya:

```text
Container, setelah dependency injection selesai, panggil method ini sebelum object dipakai.
```

Contoh:

```java
@Resource(lookup = "jdbc/CaseDS")
DataSource dataSource;
```

Artinya:

```text
Container, inject resource yang tersedia di environment/JNDI ke field ini.
```

Jika kamu paham annotation ini, kamu akan lebih mudah men-debug:

- initialization tidak jalan;
- dependency null;
- resource lookup gagal;
- shutdown tidak membersihkan resource;
- migration Java 8 ke 11+ gagal karena `javax.annotation` hilang;
- Spring Boot 2 ke 3 error package;
- container lifecycle berbeda dari plain object.

## 1.3 Common annotations bukan business annotation

`jakarta.annotation` bukan tempat membuat business rule seperti:

```java
@ApproveCase
@HighRisk
@AuditCase
```

Itu custom annotation/domain/framework-level kamu sendiri.

`jakarta.annotation` adalah common platform annotation.

---

# 2. Mental Model: Annotation sebagai Metadata untuk Container

Annotation sendiri tidak melakukan apa-apa.

Annotation adalah metadata.

Yang membuat annotation “berfungsi” adalah runtime/container/framework yang membaca metadata tersebut.

## 2.1 Annotation without processor/runtime

Contoh:

```java
@PostConstruct
void init() {
    System.out.println("init");
}
```

Jika object dibuat manual:

```java
var bean = new MyBean();
```

Method `init()` tidak otomatis dipanggil.

Kenapa?

Karena tidak ada container yang membaca annotation dan memanggil callback.

## 2.2 Annotation with container

Jika object dibuat oleh container:

```text
container creates bean
  ↓
injects dependencies/resources
  ↓
sees @PostConstruct
  ↓
calls init()
  ↓
bean ready
```

## 2.3 Annotation adalah kontrak, bukan implementation

`jakarta.annotation-api` menyediakan annotation classes.

Tetapi behavior:

- kapan callback dipanggil;
- resource apa yang diinject;
- bagaimana lookup dilakukan;
- bagaimana ordering diterapkan;

ditentukan oleh specification terkait dan container/runtime.

## 2.4 Pertanyaan wajib saat melihat annotation

Saat melihat annotation Jakarta, tanya:

1. Siapa yang membaca annotation ini?
2. Kapan dibaca?
3. Pada object apa berlaku?
4. Apakah object ini managed?
5. Apakah runtime mendukung annotation ini?
6. Apa failure mode jika metadata invalid?
7. Apakah annotation ini standard atau vendor-specific?
8. Apa konsekuensi test-nya?

---

# 3. Sejarah Singkat: Common Annotations → `javax.annotation` → `jakarta.annotation`

## 3.1 Common Annotations era

Dulu common annotations hadir di Java EE/Java SE era sebagai `javax.annotation`.

Common usage:

```java
javax.annotation.PostConstruct
javax.annotation.PreDestroy
javax.annotation.Resource
```

Banyak framework seperti Spring juga mendukung annotation ini.

## 3.2 JDK 6–8

Pada JDK 6 sampai 8, beberapa annotation seperti `@PostConstruct`, `@PreDestroy`, dan `@Resource` tersedia sebagai bagian dari standard Java libraries.

Akibatnya banyak aplikasi tidak menambahkan dependency eksplisit.

## 3.3 JDK 9–11

Dengan modularisasi JDK dan penghapusan Java EE/CORBA modules dari JDK, `javax.annotation` tidak lagi bisa diasumsikan tersedia dari JDK.

Mulai JDK 11, banyak aplikasi lama mengalami error seperti:

```text
NoClassDefFoundError: javax/annotation/PostConstruct
```

Solusi untuk stack lama bisa menambahkan dependency `javax.annotation-api`, tetapi untuk Jakarta EE modern namespace-nya pindah menjadi `jakarta.annotation`.

## 3.4 Jakarta EE 9 namespace switch

Jakarta EE 9 mengganti namespace enterprise specs dari `javax.*` ke `jakarta.*`.

Maka:

```java
javax.annotation.PostConstruct
```

menjadi:

```java
jakarta.annotation.PostConstruct
```

## 3.5 Jakarta EE 11 / Jakarta Annotations 3.0

Jakarta Annotations 3.0 adalah release untuk Jakarta EE 11 dan menghapus `@ManagedBean` yang sebelumnya deprecated.

Implikasi:

- jangan gunakan `jakarta.annotation.ManagedBean` di Jakarta Annotations 3.0;
- gunakan CDI bean model untuk managed objects;
- migration dari legacy ManagedBean harus ke CDI/Spring/framework-specific component model.

---

# 4. Jakarta Annotations 3.0 dan Jakarta EE 11

Jakarta Annotations 3.0 adalah versi Jakarta Annotations untuk Jakarta EE 11.

## 4.1 Apa yang didefinisikan?

Jakarta Annotations mendefinisikan kumpulan annotation untuk konsep semantik umum.

Termasuk:

- `jakarta.annotation.PostConstruct`;
- `jakarta.annotation.PreDestroy`;
- `jakarta.annotation.Resource`;
- `jakarta.annotation.Resources`;
- `jakarta.annotation.Priority`;
- `jakarta.annotation.Generated`;
- package `jakarta.annotation.security`;
- package `jakarta.annotation.sql`.

## 4.2 Perubahan besar 3.0

Perubahan penting:

```text
Remove deprecated @ManagedBean
```

Ini API breakage untuk code yang masih menggunakannya.

## 4.3 Apa artinya untuk engineer?

Jika kamu migrate ke Jakarta EE 11:

- cek penggunaan `ManagedBean`;
- migrate ke CDI;
- pastikan import `jakarta.annotation.*`;
- pastikan dependency `jakarta.annotation-api` sesuai;
- pastikan runtime profile/Platform menyediakan API;
- pastikan framework/container mendukung lifecycle annotation.

## 4.4 Jakarta Annotations 3.1

Halaman spesifikasi Jakarta mencatat Jakarta Annotations 3.1 under development untuk Jakarta EE 12.

Untuk production sekarang, gunakan versi stable sesuai target runtime, misalnya Jakarta Annotations 3.0 untuk Jakarta EE 11.

---

# 5. Dependency dan Packaging

## 5.1 Maven dependency

Individual API:

```xml
<dependency>
  <groupId>jakarta.annotation</groupId>
  <artifactId>jakarta.annotation-api</artifactId>
  <version>3.0.0</version>
</dependency>
```

Dalam Jakarta EE runtime, sering dependency ini sudah tercakup oleh profile/platform API:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-web-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

Atau:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

## 5.2 Scope in container deployment

Untuk WAR yang deploy ke compatible Jakarta EE runtime:

```xml
<scope>provided</scope>
```

karena runtime/container menyediakan API.

## 5.3 Plain Java / non-container

Jika aplikasi plain Java atau Spring Boot membutuhkan annotation class di classpath, dependency harus tersedia dalam runtime classpath.

Contoh Spring Boot 3 biasanya sudah membawa dependency terkait lewat starters/dependency management. Jangan override sembarangan.

## 5.4 Dependency mistake

### Mistake 1 — import benar tapi runtime classpath tidak ada

Compile berhasil, runtime gagal:

```text
ClassNotFoundException: jakarta.annotation.PostConstruct
```

### Mistake 2 — memakai `javax.annotation` di Jakarta stack

Compile error atau runtime mismatch.

### Mistake 3 — memakai `jakarta.annotation-api` 3.0 dengan runtime lama

Runtime tidak mendukung namespace/version yang sesuai.

### Mistake 4 — menganggap API jar memanggil lifecycle

`jakarta.annotation-api` hanya menyediakan annotation classes. Yang memanggil lifecycle adalah container/framework.

---

# 6. Peta Package: `jakarta.annotation`, `jakarta.annotation.security`, `jakarta.annotation.sql`

## 6.1 `jakarta.annotation`

Berisi annotation umum:

- `PostConstruct`;
- `PreDestroy`;
- `Resource`;
- `Resources`;
- `Priority`;
- `Generated`.

## 6.2 `jakarta.annotation.security`

Berisi annotation security umum:

- `DeclareRoles`;
- `DenyAll`;
- `PermitAll`;
- `RolesAllowed`;
- `RunAs`.

Annotation ini menyatakan intent security. Enforcement bergantung container/security runtime dan spec terkait.

## 6.3 `jakarta.annotation.sql`

Berisi annotation terkait datasource definition:

- `DataSourceDefinition`;
- `DataSourceDefinitions`.

Annotation ini bisa dipakai untuk mendeklarasikan datasource di environment tertentu.

## 6.4 Package boundary

Jangan menganggap semua annotation di Jakarta EE ada di `jakarta.annotation`.

Banyak annotation ada di spec masing-masing:

```java
jakarta.inject.Inject
jakarta.enterprise.context.ApplicationScoped
jakarta.ws.rs.Path
jakarta.persistence.Entity
jakarta.transaction.Transactional
jakarta.validation.constraints.NotNull
jakarta.servlet.annotation.WebServlet
```

`jakarta.annotation` hanya common annotations tertentu.

---

# 7. `@PostConstruct`: Initialization Callback

`@PostConstruct` digunakan pada method yang harus dijalankan setelah dependency injection selesai untuk melakukan initialization, dan method tersebut dipanggil sebelum class ditempatkan ke service.

## 7.1 Basic example

```java
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

@ApplicationScoped
public class CaseNumberCache {

    @Inject
    CaseNumberRepository repository;

    private Map<String, String> cache;

    @PostConstruct
    void init() {
        this.cache = repository.loadCaseNumberPrefixes();
    }
}
```

Flow:

```text
construct CaseNumberCache
  ↓
inject repository
  ↓
call init()
  ↓
bean ready
```

## 7.2 Method constraints

Secara umum:

- hanya satu method `@PostConstruct` pada class;
- method tidak boleh static kecuali application client case tertentu dalam spec historis;
- method biasanya no-arg;
- method bisa memiliki access modifier non-public depending spec rules;
- method tidak boleh mengandalkan object dipakai sebelum injection selesai;
- exception dari method dapat menggagalkan initialization/deployment.

Selalu cek specification/version untuk aturan detail.

## 7.3 Kapan memakai `@PostConstruct`

Gunakan untuk:

- validate configuration;
- initialize lightweight in-memory structure;
- create derived immutable state;
- warm metadata kecil;
- check required dependency presence;
- fail fast jika config invalid;
- register local hooks yang akan dibersihkan di `@PreDestroy`.

Contoh baik:

```java
@PostConstruct
void validateConfig() {
    if (timeout.isNegative() || timeout.isZero()) {
        throw new IllegalStateException("case.client.timeout must be positive");
    }
}
```

Contoh baik:

```java
@PostConstruct
void compilePatterns() {
    this.caseIdPattern = Pattern.compile(config.caseIdRegex());
}
```

## 7.4 Apa yang sebaiknya tidak dilakukan di `@PostConstruct`

Hati-hati dengan:

- remote call tanpa timeout;
- blocking lama;
- migration database;
- cache warmup besar;
- publish event;
- memulai unmanaged thread;
- infinite retry;
- menelan exception;
- mengakses request/session context;
- logic business state-changing;
- network call ke dependency volatile sebagai syarat liveness.

Buruk:

```java
@PostConstruct
void init() {
    while (true) {
        externalService.connect(); // may block forever
    }
}
```

Buruk:

```java
@PostConstruct
void init() {
    new Thread(this::backgroundLoop).start();
}
```

Gunakan managed executor/lifecycle service.

## 7.5 Startup probe impact

Jika `@PostConstruct` lambat, aplikasi belum siap.

Di Kubernetes:

- gunakan startup probe untuk aplikasi yang startup-nya lama;
- readiness false sampai ready;
- jangan biarkan liveness membunuh aplikasi yang masih initialization.

## 7.6 Exception policy

Jika config mandatory invalid, fail fast.

Jika optional dependency unavailable, lebih baik:

- readiness false;
- retry bounded/background;
- circuit breaker;
- clear log.

Tidak semua failure harus menggagalkan startup.

## 7.7 `@PostConstruct` dan transaction

Jangan mengasumsikan transaksi aktif di `@PostConstruct` kecuali runtime/spec/framework menjamin untuk component tertentu.

Jika perlu database operation, pikirkan:

- apakah harus saat startup?
- apakah transaction tersedia?
- apakah datasource ready?
- apakah ini migration job?
- apa timeout-nya?
- apa rollback behavior?

## 7.8 `@PostConstruct` dan proxy

Calling another method on `this` inside `@PostConstruct` may bypass interceptor/proxy behavior.

Contoh:

```java
@PostConstruct
void init() {
    transactionalInit(); // internal call
}

@Transactional
void transactionalInit() {}
```

Jangan mengandalkan interceptor bekerja pada self-invocation.

---

# 8. `@PreDestroy`: Destruction Callback

`@PreDestroy` digunakan pada method sebagai callback notification untuk menandakan instance sedang dihapus oleh container. Biasanya dipakai untuk melepas resources yang dipegang.

## 8.1 Basic example

```java
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class CaseExportBuffer {

    private BufferedWriter writer;

    @PreDestroy
    void close() {
        if (writer != null) {
            try {
                writer.close();
            } catch (IOException e) {
                // log carefully
            }
        }
    }
}
```

## 8.2 Kapan `@PreDestroy` dipanggil?

Container memanggil sebelum instance dihancurkan/removed.

Contoh:

- application shutdown;
- context end;
- undeploy;
- scope destruction;
- bean removal depending lifecycle.

## 8.3 Apa yang cocok dilakukan?

Gunakan untuk:

- close client/resource yang kamu buat sendiri;
- stop scheduler yang managed oleh bean;
- flush buffer;
- release native handle;
- unregister listener;
- close local cache;
- signal background worker to stop;
- cleanup temporary file.

## 8.4 Apa yang tidak cocok dilakukan?

Hindari:

- long blocking operation;
- remote call yang tidak perlu;
- business mutation;
- publish event penting yang harus guaranteed;
- starting new work;
- waiting forever;
- throwing exception tanpa handling;
- relying on request/security context.

## 8.5 Shutdown budget

Di Kubernetes, shutdown punya deadline:

```text
terminationGracePeriodSeconds
```

`@PreDestroy` harus selesai dalam budget tersebut.

Jika tidak:

```text
container killed
cleanup incomplete
message may be lost
resource may leak
```

## 8.6 Idempotent cleanup

`@PreDestroy` sebaiknya idempotent:

```java
private final AtomicBoolean closed = new AtomicBoolean();

@PreDestroy
void shutdown() {
    if (closed.compareAndSet(false, true)) {
        client.close();
    }
}
```

## 8.7 Exception handling

Jika cleanup gagal, log dengan context tetapi jangan membuat shutdown hang.

```java
@PreDestroy
void shutdown() {
    try {
        exporter.flush(Duration.ofSeconds(5));
    } catch (Exception e) {
        log.warn("Failed to flush exporter during shutdown", e);
    }
}
```

## 8.8 `@PreDestroy` is not a durable workflow mechanism

Jangan gunakan `@PreDestroy` untuk hal yang harus pasti terjadi secara business.

Misalnya:

```text
mark all in-flight orders failed
publish final audit event
send regulatory notification
```

Karena proses bisa mati mendadak tanpa callback:

- `kill -9`;
- node crash;
- OOMKilled;
- hardware failure;
- forced container kill.

Gunakan durable state/outbox/transactional mechanism.

---

# 9. Lifecycle Ordering: Constructor → Injection → PostConstruct → Service → PreDestroy

## 9.1 Typical lifecycle

```text
class loaded
  ↓
constructor called
  ↓
dependency/resource injection
  ↓
@PostConstruct
  ↓
object in service
  ↓
business methods invoked
  ↓
@PreDestroy
  ↓
object eligible for GC
```

## 9.2 Constructor phase

At constructor time:

- injected fields are not set yet;
- container context may not be fully ready;
- avoid calling methods that depend on injection;
- initialize final fields and simple invariants.

Bad:

```java
@Inject
CaseRepository repository;

public CaseService() {
    repository.load(); // repository null
}
```

Better:

```java
@PostConstruct
void init() {
    repository.load();
}
```

Or constructor injection:

```java
@Inject
public CaseService(CaseRepository repository) {
    this.repository = repository;
}
```

## 9.3 Injection phase

Container sets dependencies/resources.

## 9.4 PostConstruct phase

Use for initialization that depends on injected fields.

## 9.5 Service phase

Object can handle requests/calls.

## 9.6 PreDestroy phase

Release resources before destruction.

## 9.7 Lifecycle and scopes

Application-scoped:

```text
created around app startup / first use
destroyed at app shutdown
```

Request-scoped:

```text
created per request
destroyed after request
```

Dependent-scoped:

```text
lifecycle depends on injection target
```

## 9.8 Lifecycle with lazy initialization

Some runtimes lazily create beans. Do not assume all beans initialize at startup unless eager initialization is configured/guaranteed.

If startup validation is required, make it explicit.

---

# 10. `@Resource`: Resource Injection dan Environment Reference

`@Resource` declares a reference to a resource. When applied to field or method, container injects requested resource into application during initialization. When applied to class, it declares a resource for runtime lookup.

## 10.1 Basic field injection

```java
import jakarta.annotation.Resource;
import javax.sql.DataSource;

public class CaseRepository {

    @Resource(lookup = "jdbc/CaseDS")
    private DataSource dataSource;
}
```

Note:

```java
javax.sql.DataSource
```

is Java SE package and remains `javax.sql`, not `jakarta.sql`.

## 10.2 Method injection

```java
@Resource(lookup = "jdbc/CaseDS")
public void setDataSource(DataSource dataSource) {
    this.dataSource = dataSource;
}
```

## 10.3 Class-level resource declaration

```java
@Resource(name = "jdbc/CaseDS", type = DataSource.class)
public class CaseRepository {
    ...
}
```

Class-level declaration declares resource in component environment; it does not necessarily inject into a field. Application may look it up.

## 10.4 `name` vs `lookup`

Common concepts:

- `name`: logical name in component environment;
- `lookup`: global JNDI lookup name;
- `type`: resource type;
- `authenticationType`;
- `shareable`;
- `mappedName` vendor-specific-ish legacy concern.

Exact behavior can depend on container/resource configuration.

## 10.5 What resources?

Common resources:

- `DataSource`;
- JMS connection factory;
- JMS destination;
- Mail session;
- URL;
- environment entries;
- executor services depending runtime;
- other container resources.

## 10.6 `@Resource` vs CDI `@Inject`

`@Inject` resolves CDI beans.

`@Resource` resolves container resources/environment entries.

Use:

```java
@Inject CaseService service;
```

for application beans.

Use:

```java
@Resource(lookup = "jdbc/CaseDS")
DataSource ds;
```

for runtime-managed resources.

## 10.7 Resource injection is container-dependent

In plain Java object:

```java
new CaseRepository()
```

`@Resource` does nothing.

In container-managed component, container can inject resource.

## 10.8 Resource injection failure modes

- JNDI name not found;
- type mismatch;
- resource not configured in server;
- missing driver;
- datasource credentials invalid;
- wrong namespace;
- injection target not managed;
- deployment descriptor conflict;
- vendor config mismatch;
- environment differs local/prod.

## 10.9 Production resource design

Resource injection must align with operations:

- who configures datasource?
- where credentials live?
- how pool is sized?
- how secrets rotate?
- how resource is monitored?
- what timeout?
- how many replicas?
- what happens if resource unavailable at startup?
- is resource portable across runtimes?

## 10.10 Example with configuration clarity

```java
@ApplicationScoped
public class CaseJdbcRepository {

    private final DataSource dataSource;

    @Inject
    public CaseJdbcRepository(@CaseDataSource DataSource dataSource) {
        this.dataSource = dataSource;
    }
}
```

Producer/adapters can wrap `@Resource` so domain/application does not depend on JNDI names everywhere.

---

# 11. `@Resources`: Multiple Resource Declarations

`@Resources` is container annotation for multiple `@Resource` declarations.

Example:

```java
@Resources({
    @Resource(name = "jdbc/CaseDS", type = DataSource.class),
    @Resource(name = "mail/NotificationSession", type = jakarta.mail.Session.class)
})
public class CaseNotificationComponent {
}
```

## 11.1 When useful?

Useful when declaring multiple resources at class level.

But in modern code, field/producer-based approach is often clearer.

## 11.2 Repeated `@Resource`

In modern annotation design, `@Resource` is repeatable in Jakarta Annotations 3.0 API form, with `@Resources` as container annotation.

## 11.3 Best practice

Avoid large resource declaration block if it hides operational config.

Prefer explicit resource wiring/config documentation.

---

# 12. `@Priority`: Ordering dan Selection Semantics

`@Priority` represents ordering/priority metadata.

It can be used by specifications/frameworks that define how priority values are interpreted.

## 12.1 Important mental model

`@Priority` itself does not define universal ordering behavior.

A specification that uses `@Priority` defines:

- where it applies;
- lower number or higher number precedence;
- default priority;
- special ranges;
- selection semantics.

## 12.2 Example usage concept

In JAX-RS filters/providers, priority may determine order of execution.

```java
@Provider
@Priority(1000)
public class CorrelationIdFilter implements ContainerRequestFilter {
    ...
}
```

But exact ordering semantics should be checked in Jakarta REST specification.

## 12.3 CDI alternatives/interceptors

Some CDI mechanisms also use priority semantics for enabling/ordering alternatives/interceptors.

Again, read spec-specific behavior.

## 12.4 Pitfall

Do not assume:

```text
higher number always first
```

or:

```text
lower number always first
```

without checking the spec using it.

## 12.5 Production use

Use named constants for priority:

```java
public final class FilterPriorities {
    public static final int CORRELATION = 1000;
    public static final int AUTHENTICATION = 2000;
    public static final int AUDIT = 3000;
}
```

Avoid magic numbers scattered.

## 12.6 Review question

When seeing `@Priority`, ask:

```text
Which spec/framework consumes this priority?
What is the ordering rule?
What other components compete in same chain?
What happens if priority changes?
```

---

# 13. `@Generated`: Generated Code Metadata

`@Generated` marks generated source/code.

Example:

```java
@Generated(
    value = "com.example.codegen.CaseMapperGenerator",
    date = "2026-06-12T10:15:30Z",
    comments = "Generated from case-schema.yaml"
)
public final class GeneratedCaseMapper {
    ...
}
```

## 13.1 Why useful?

Useful for:

- code generators;
- annotation processors;
- source generation tools;
- excluding generated code from coverage/static analysis;
- tracking generator version;
- debugging generated artifacts.

## 13.2 What to include

Good metadata:

- generator name;
- generator version;
- source schema/config;
- generation time if reproducibility policy allows;
- comments.

## 13.3 Reproducible build concern

Including timestamp can break reproducible builds.

For reproducible builds, avoid dynamic date or make it deterministic.

## 13.4 Generated code review

Generated code should not be manually edited.

Add comment:

```java
// Do not modify. Generated by ...
```

## 13.5 Generated code and annotation processors

Many Java tools generate code:

- MapStruct;
- QueryDSL;
- Dagger;
- Immutables;
- OpenAPI generator;
- JAXB/XJC;
- internal codegen.

`@Generated` helps distinguish tool-generated code from hand-written code.

---

# 14. `jakarta.annotation.security`: `@RolesAllowed`, `@PermitAll`, `@DenyAll`, `@DeclareRoles`, `@RunAs`

Security annotations declare role-based access metadata.

## 14.1 `@RolesAllowed`

Example:

```java
@RolesAllowed({"OFFICER", "SUPERVISOR"})
public void approveCase(CaseId id) {
    ...
}
```

Means only callers in allowed roles should access method/resource, if runtime/spec context enforces it.

## 14.2 `@PermitAll`

Allows all authenticated/allowed callers depending context.

```java
@PermitAll
public CaseSummary getSummary(CaseId id) { ... }
```

## 14.3 `@DenyAll`

Denies all access.

```java
@DenyAll
public void internalOnly() { ... }
```

Useful to block inherited/default methods or explicitly deny public exposure.

## 14.4 `@DeclareRoles`

Declares security roles used by application.

```java
@DeclareRoles({"OFFICER", "SUPERVISOR", "ADMIN"})
public class CaseApplication { ... }
```

## 14.5 `@RunAs`

Declares identity role used when component calls downstream component.

```java
@RunAs("SYSTEM")
public class CaseEscalationJob { ... }
```

Use carefully. It can obscure true actor if audit is weak.

## 14.6 Role annotation is not full authorization model

Role-based access is coarse.

Domain authorization often needs:

- actor;
- resource ownership;
- assignment;
- jurisdiction;
- case status;
- delegation;
- organization;
- policy version;
- data sensitivity.

Example:

```text
OFFICER role can close a case only if assigned to that case and case is RESOLVED.
```

This is domain/application policy, not just `@RolesAllowed("OFFICER")`.

## 14.7 Security annotation enforcement depends on context

If object is not managed or method not invoked through managed security boundary, annotation may not be enforced.

Always test security behavior in container/runtime.

## 14.8 Audit

For regulated systems, security decision must be auditable:

- who;
- role;
- resource;
- action;
- decision;
- reason;
- policy version;
- timestamp.

---

# 15. `jakarta.annotation.sql`: `@DataSourceDefinition` dan `@DataSourceDefinitions`

`jakarta.annotation.sql` provides annotations for declaring datasource definitions.

## 15.1 Basic idea

You can declare a datasource in application metadata:

```java
@DataSourceDefinition(
    name = "java:app/jdbc/CaseDS",
    className = "org.postgresql.ds.PGSimpleDataSource",
    serverName = "localhost",
    portNumber = 5432,
    databaseName = "case_db",
    user = "case_user",
    password = "secret"
)
public class DataSourceConfig {
}
```

## 15.2 Production caution

Hardcoding credentials in annotation is not production-grade.

Avoid:

```java
password = "secret"
```

Use runtime config/secrets.

## 15.3 When useful?

Useful for:

- examples;
- tests;
- simple deployments;
- portable declaration in certain environments;
- local dev if secrets safe.

For production, datasource config usually lives in:

- runtime/server config;
- Kubernetes Secret;
- environment variables;
- cloud secret manager;
- runtime-specific datasource config.

## 15.4 `@DataSourceDefinitions`

Container for multiple datasource definitions.

## 15.5 Best practice

Use annotations for portable metadata if appropriate, but keep secrets and environment-specific details outside source.

---

# 16. Common Annotations vs CDI Annotations

## 16.1 Different packages, different purpose

Common annotations:

```java
jakarta.annotation.PostConstruct
jakarta.annotation.Resource
jakarta.annotation.Priority
```

CDI annotations:

```java
jakarta.inject.Inject
jakarta.enterprise.context.ApplicationScoped
jakarta.enterprise.inject.Produces
jakarta.enterprise.event.Observes
jakarta.enterprise.inject.Alternative
```

## 16.2 `@PostConstruct` with CDI

CDI supports lifecycle callbacks with `@PostConstruct`.

Example:

```java
@ApplicationScoped
public class CaseService {
    @PostConstruct
    void init() {}
}
```

## 16.3 `@Resource` vs CDI producer

Direct:

```java
@Resource(lookup = "jdbc/CaseDS")
DataSource ds;
```

Producer-based:

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

Then:

```java
@Inject
@CaseDatabase
DataSource ds;
```

This centralizes resource lookup.

## 16.4 CDI scopes vs lifecycle callbacks

Scope determines when object lives. `@PostConstruct`/`@PreDestroy` are callbacks inside that lifecycle.

## 16.5 Avoid annotation soup

Bad:

```java
@Resource
@Inject
@ApplicationScoped
@PostConstruct
@SomeVendorAnnotation
@Transactional
...
```

Use only annotations that express clear responsibility.

---

# 17. Common Annotations vs Spring Lifecycle Annotations

Spring supports `jakarta.annotation.PostConstruct` and `jakarta.annotation.PreDestroy` in modern versions.

## 17.1 Spring Boot 2 vs 3

- Spring Boot 2 era often used `javax.annotation`.
- Spring Boot 3 moved to Jakarta EE namespace, so use `jakarta.annotation`.

## 17.2 Spring-specific alternatives

Spring has alternatives:

- `InitializingBean`;
- `DisposableBean`;
- `@Bean(initMethod=..., destroyMethod=...)`;
- `ApplicationRunner`;
- `CommandLineRunner`;
- lifecycle interfaces;
- `SmartLifecycle`;
- events like `ApplicationReadyEvent`.

## 17.3 When to use Jakarta annotations in Spring?

Use `@PostConstruct`/`@PreDestroy` for simple lifecycle callbacks.

Use Spring-specific lifecycle when you need:

- application context event timing;
- ordered startup/shutdown phases;
- async lifecycle;
- conditional startup;
- integration with Spring Boot readiness;
- more control.

## 17.4 Spring caution

Same rule:

```text
@PostConstruct is called by container/framework only for managed beans.
```

If object is created with `new`, Spring will not call it.

---

# 18. Managed Object vs Plain Object

## 18.1 Managed object

Created by container/framework.

Lifecycle annotation works.

```java
@ApplicationScoped
public class ManagedBean {
    @PostConstruct
    void init() {}
}
```

## 18.2 Plain object

Created manually.

```java
var bean = new ManagedBean();
```

Lifecycle annotation does not run automatically.

## 18.3 Unit test implication

In plain unit test:

```java
var service = new CaseService();
```

`@PostConstruct` not called unless you call it manually or use container test.

Better design:

- keep heavy logic outside `@PostConstruct`;
- expose explicit package-private init for tests only if justified;
- test behavior, not lifecycle framework;
- use integration test for lifecycle.

## 18.4 Design guideline

Business correctness should not depend solely on `@PostConstruct`.

If object must always be valid, prefer constructor invariants.

Use `@PostConstruct` for container-dependent initialization.

---

# 19. Startup Design: Apa yang Boleh dan Tidak Boleh di `@PostConstruct`

## 19.1 Good startup tasks

Good:

- validate required config;
- initialize small immutable maps;
- compile regex;
- create client object if lightweight;
- log version/config summary without secrets;
- verify local resource presence;
- register local metrics;
- initialize bounded in-memory cache metadata.

## 19.2 Risky startup tasks

Risky:

- load entire database table;
- call external service;
- start infinite loop;
- run database migration;
- publish Kafka event;
- schedule unmanaged job;
- perform long blocking task;
- warm huge cache;
- wait for all downstream services.

## 19.3 Startup should be bounded

If startup task needs external call:

- set timeout;
- set retry budget;
- log clearly;
- decide fail-fast vs degraded readiness.

## 19.4 Readiness model

App can be alive but not ready.

```text
liveness: process not dead
readiness: ready to serve traffic
startup: initialization still in progress
```

`@PostConstruct` affects startup/readiness.

## 19.5 Startup metrics

Expose:

- startup duration;
- init step duration;
- failed init count;
- cache warmup state;
- datasource init status.

## 19.6 Example pattern

```java
@ApplicationScoped
public class StartupValidator {

    @Inject AppConfig config;

    @PostConstruct
    void validate() {
        config.validateRequiredFields();
        log.info("Startup config validated");
    }
}
```

---

# 20. Shutdown Design: Apa yang Boleh dan Tidak Boleh di `@PreDestroy`

## 20.1 Good shutdown tasks

Good:

- stop accepting internal work;
- close local client;
- flush telemetry with timeout;
- close bounded executor;
- release file handle;
- close cache;
- deregister callback.

## 20.2 Risky shutdown tasks

Risky:

- long remote call;
- start new async work;
- publish critical business event;
- wait forever;
- depend on unavailable DB;
- mutate domain state without durable transaction;
- throw unchecked exception that hides other cleanup.

## 20.3 Shutdown is not guaranteed

`@PreDestroy` may not run under:

- process crash;
- OOMKilled;
- `kill -9`;
- node failure;
- forced termination after grace timeout.

Therefore:

```text
critical business correctness must not rely on @PreDestroy
```

## 20.4 Graceful shutdown integration

For workers:

```text
stop polling
finish in-flight
ack/commit success
nack/retry unfinished
close resource
```

`@PreDestroy` can trigger this process, but the workflow must be idempotent and bounded.

## 20.5 Example

```java
@ApplicationScoped
public class CaseWorkerLifecycle {

    private final AtomicBoolean stopping = new AtomicBoolean();

    @PreDestroy
    void shutdown() {
        stopping.set(true);
        worker.stop(Duration.ofSeconds(20));
    }
}
```

---

# 21. Resource Injection Design: `@Resource` vs `@Inject` vs Config

## 21.1 Use `@Inject` for application beans

```java
@Inject
CaseService caseService;
```

## 21.2 Use `@Resource` for container resources

```java
@Resource(lookup = "jdbc/CaseDS")
DataSource dataSource;
```

## 21.3 Use config for environment values

```text
case.timeout=2s
case.max-page-size=100
```

Do not use `@Resource` for every config value unless environment model requires it.

## 21.4 Centralize resource lookup

Instead of scattering:

```java
@Resource(lookup = "jdbc/CaseDS")
```

in many classes, centralize:

```java
@ApplicationScoped
public class ResourceProducer {
    @Resource(lookup = "jdbc/CaseDS")
    private DataSource caseDataSource;

    @Produces
    @CaseDatabase
    DataSource caseDataSource() {
        return caseDataSource;
    }
}
```

## 21.5 Benefits

- one place for JNDI name;
- easier testing;
- easier migration;
- easier documentation;
- less coupling to runtime names.

## 21.6 Qualifiers

```java
@Qualifier
@Retention(RUNTIME)
@Target({FIELD, PARAMETER, METHOD})
public @interface CaseDatabase {}
```

Then:

```java
@Inject
@CaseDatabase
DataSource ds;
```

---

# 22. Migration: `javax.annotation` ke `jakarta.annotation`

## 22.1 Common old imports

Old:

```java
import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;
import javax.annotation.Resource;
import javax.annotation.Priority;
import javax.annotation.Generated;
import javax.annotation.security.RolesAllowed;
```

New:

```java
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import jakarta.annotation.Resource;
import jakarta.annotation.Priority;
import jakarta.annotation.Generated;
import jakarta.annotation.security.RolesAllowed;
```

## 22.2 JDK 11 issue

Legacy app on Java 11 may fail with:

```text
NoClassDefFoundError: javax/annotation/PostConstruct
```

because old `javax.annotation` was no longer provided by JDK.

If staying on old Java EE/Spring Boot 2 stack, add appropriate legacy dependency.

If migrating to Jakarta EE 9+/Spring Boot 3+, migrate source to `jakarta.annotation`.

## 22.3 Jakarta EE 11 issue

If using Jakarta Annotations 3.0, `ManagedBean` is removed.

Old:

```java
@ManagedBean
public class MyBean {}
```

Migrate to CDI:

```java
@ApplicationScoped
public class MyBean {}
```

or other appropriate scope/component annotation.

## 22.4 Do not blind replace all `javax`

Remember Java SE packages:

```java
javax.sql.DataSource
javax.net.ssl.SSLContext
javax.crypto.Cipher
javax.management.MBeanServer
```

remain `javax.*`.

## 22.5 Migration tooling

Tools such as OpenRewrite provide recipes for migrating `javax.annotation` to `jakarta.annotation`.

But still review:

- imports;
- dependency versions;
- runtime compatibility;
- tests;
- generated source;
- descriptors/config;
- reflection string constants.

## 22.6 Migration checklist

- [ ] Replace enterprise `javax.annotation` imports with `jakarta.annotation`.
- [ ] Keep Java SE `javax.*` packages unchanged.
- [ ] Upgrade dependency to `jakarta.annotation-api`.
- [ ] Align with Jakarta EE Platform/Profile version.
- [ ] Remove deprecated/removed `ManagedBean`.
- [ ] Update generated sources.
- [ ] Update documentation/config string references if needed.
- [ ] Run tests in target runtime.

---

# 23. Testing Strategy

## 23.1 Unit testing `@PostConstruct`

Plain unit test does not automatically run lifecycle.

Option:

```java
var bean = new MyBean(...);
bean.init(); // if method package-private and test in same package
```

But be careful: you are testing method logic, not container lifecycle.

## 23.2 Integration testing lifecycle

Use container/framework test to verify:

- dependency injection;
- `@PostConstruct` called;
- `@PreDestroy` called;
- resource injection;
- security annotations enforced;
- priority ordering.

## 23.3 Testing resource injection

For `@Resource`, prefer integration test with runtime/container config.

Mocking `DataSource` manually doesn't prove JNDI/resource injection works.

## 23.4 Testing shutdown

Shutdown tests should verify:

- `@PreDestroy` called;
- executor closed;
- resource closed;
- no thread leak;
- graceful shutdown within budget.

## 23.5 Testing migration

Add compile/test checks:

- no old `javax.annotation` import;
- no `ManagedBean`;
- dependency tree clean;
- runtime smoke test.

Example grep:

```bash
grep -R "import javax.annotation" src/main/java
```

PowerShell:

```powershell
Select-String -Path "src/main/java/**/*.java" -Pattern "import javax.annotation"
```

---

# 24. Production Failure Modes

## 24.1 `@PostConstruct` not called

Possible causes:

- object not managed;
- wrong import namespace;
- annotation API missing;
- lifecycle method invalid;
- bean not discovered;
- class excluded from scanning;
- test not using container.

## 24.2 App hangs during startup

Possible causes:

- blocking remote call in `@PostConstruct`;
- infinite retry;
- DB unavailable with no timeout;
- cache warmup huge;
- deadlock in initialization;
- DNS/TLS issue.

## 24.3 Pod restart loop

Possible causes:

- `@PostConstruct` too slow;
- no startup probe;
- liveness kills app during initialization;
- readiness incorrectly configured.

## 24.4 Resource injection fails

Possible causes:

- wrong JNDI name;
- resource not configured;
- type mismatch;
- missing driver;
- server config differs;
- injection target not managed;
- class-level resource misunderstood.

## 24.5 `@PreDestroy` not called

Possible causes:

- process killed forcibly;
- unmanaged object;
- shutdown timeout too short;
- runtime crash;
- OOMKilled;
- manual thread prevents clean shutdown.

## 24.6 Security annotation ignored

Possible causes:

- method not invoked through managed/security boundary;
- runtime not enforcing for component type;
- missing security configuration;
- wrong annotation namespace;
- tests bypass container;
- using role annotation but no auth mechanism.

## 24.7 Priority ordering surprising

Possible causes:

- wrong assumption lower/higher value;
- spec-specific ordering not checked;
- multiple chains;
- default priority;
- vendor extension.

---

# 25. Debugging Playbook

## 25.1 Ask first: managed or unmanaged?

```text
Who created this object?
Container/framework or new?
```

If `new`, lifecycle/resource annotations won't run automatically.

## 25.2 Verify namespace

Check imports:

```java
jakarta.annotation.PostConstruct
```

not:

```java
javax.annotation.PostConstruct
```

for Jakarta EE 9+ stack.

## 25.3 Verify dependency

Maven:

```bash
mvn dependency:tree | grep annotation
```

PowerShell:

```powershell
mvn dependency:tree | Select-String "annotation"
```

## 25.4 Verify bean discovery

For CDI:

- bean-defining annotation present?
- `beans.xml` behavior understood?
- package scanned?
- archive included?
- deployment logs?

## 25.5 Verify lifecycle logs

Add temporary log:

```java
@PostConstruct
void init() {
    log.info("CaseService initialized");
}
```

Do not leave noisy logs in hot path.

## 25.6 Verify resource config

Check runtime/server config:

- resource name;
- JNDI lookup;
- datasource driver;
- credentials;
- pool config;
- environment-specific config.

## 25.7 Verify shutdown

- send SIGTERM;
- check logs;
- check `@PreDestroy`;
- check in-flight work;
- check termination grace;
- check no message loss.

## 25.8 Verify security annotation

Use integration test:

- unauthenticated;
- authenticated wrong role;
- authenticated correct role;
- method/resource access.

---

# 26. Best Practices dan Anti-Patterns

## 26.1 Best practices

- Keep `@PostConstruct` lightweight and bounded.
- Use `@PreDestroy` for cleanup, not durable business workflow.
- Centralize `@Resource` lookup.
- Use `@Inject` for application beans.
- Use qualifiers for multiple resources.
- Treat `@Priority` as spec-specific.
- Keep generated code reproducibility in mind with `@Generated`.
- Test lifecycle/resource behavior in container.
- Document runtime resource names.
- Avoid direct dependency on JNDI names across codebase.

## 26.2 Anti-pattern: Heavy startup logic

```java
@PostConstruct
void init() {
    allCases = repository.loadAllCases();
}
```

If table huge, startup slow/OOM.

## 26.3 Anti-pattern: Business correctness in shutdown

```java
@PreDestroy
void onShutdown() {
    repository.markAllJobsFailed();
}
```

May not run. Use durable job state/lease/heartbeat.

## 26.4 Anti-pattern: Scattered resource names

```java
@Resource(lookup = "jdbc/CaseDS")
```

in 40 classes.

Hard to migrate/configure.

## 26.5 Anti-pattern: Blind migration

```text
replace all javax with jakarta
```

Breaks Java SE packages like `javax.sql`.

## 26.6 Anti-pattern: Magic priority numbers

```java
@Priority(1234)
```

without constants/docs.

## 26.7 Anti-pattern: Trusting security annotation without test

Security annotation must be tested in runtime context.

---

# 27. Checklist Review

## 27.1 Lifecycle

- [ ] Is object managed?
- [ ] Is `@PostConstruct` lightweight?
- [ ] Are timeouts used for external calls?
- [ ] Does startup fail fast only for mandatory config?
- [ ] Is readiness modeled correctly?
- [ ] Is `@PreDestroy` bounded?
- [ ] Is cleanup idempotent?
- [ ] Are critical workflows not dependent on shutdown callback?

## 27.2 Resource

- [ ] Is `@Resource` used only for container resources?
- [ ] Is resource name documented?
- [ ] Is lookup centralized?
- [ ] Are secrets outside source?
- [ ] Is pool sizing reviewed?
- [ ] Is resource injection tested in container?

## 27.3 Security

- [ ] Are role annotations enforced by runtime?
- [ ] Are domain-level authorization rules separate?
- [ ] Are security decisions auditable?
- [ ] Are tests covering role combinations?

## 27.4 Migration

- [ ] `javax.annotation` imports removed where targeting Jakarta?
- [ ] Java SE `javax.*` packages preserved?
- [ ] `ManagedBean` removed/migrated?
- [ ] Dependency version aligned?
- [ ] Runtime supports Jakarta Annotations version?

## 27.5 Priority/generated

- [ ] `@Priority` ordering documented?
- [ ] Constants used?
- [ ] `@Generated` does not break reproducible builds?
- [ ] Generated code excluded from manual edits?

---

# 28. Latihan Bertahap

## Latihan 1 — Managed lifecycle

Buat CDI bean:

```java
@ApplicationScoped
public class LifecycleBean {
    @PostConstruct
    void init() { ... }

    @PreDestroy
    void destroy() { ... }
}
```

Deploy dan amati logs.

## Latihan 2 — Manual object

Buat object yang sama dengan `new`.

Buktikan `@PostConstruct` tidak otomatis terpanggil.

## Latihan 3 — Slow startup

Tambahkan sleep 30 detik di `@PostConstruct`.

Simulasikan startup probe/liveness behavior.

## Latihan 4 — Resource injection

Buat datasource/resource di runtime.

Inject dengan `@Resource`.

Buat salah lookup name dan amati failure.

## Latihan 5 — Producer wrapping resource

Centralize `@Resource` di producer, inject dengan qualifier ke repository.

## Latihan 6 — PreDestroy

Buat bean yang membuka resource lokal, tutup di `@PreDestroy`.

Test graceful shutdown.

## Latihan 7 — Security annotation

Buat method dengan `@RolesAllowed`.

Test wrong role/correct role dalam container.

## Latihan 8 — Priority ordering

Buat dua JAX-RS filters dengan `@Priority`.

Amati order eksekusi.

## Latihan 9 — Migration

Ambil code dengan `javax.annotation.PostConstruct`.

Migrasikan ke `jakarta.annotation.PostConstruct`.

Pastikan dependency/runtime sesuai.

## Latihan 10 — Generated annotation

Buat annotation processor/simple generator yang menambahkan `@Generated`.

Diskusikan reproducible build concern.

---

# 29. Mini Project: Lifecycle and Resource Lab

## 29.1 Goal

Buat repository:

```text
jakarta-annotation-lifecycle-lab/
```

## 29.2 Modules

```text
lifecycle/
resource-injection/
security-annotations/
priority-filters/
migration-javax-jakarta/
shutdown/
```

## 29.3 Requirements

- Jakarta EE 11 compatible runtime;
- use `jakarta.annotation-api` 3.0 or platform API;
- demonstrate managed vs unmanaged object;
- demonstrate `@PostConstruct` and `@PreDestroy`;
- demonstrate `@Resource`;
- demonstrate `@Priority`;
- demonstrate `@RolesAllowed`;
- demonstrate migration from `javax.annotation`.

## 29.4 Docs

Create:

```text
README.md
LIFECYCLE-FLOW.md
RESOURCE-INJECTION.md
SECURITY-ANNOTATIONS.md
MIGRATION-NOTES.md
FAILURE-MODES.md
KUBERNETES-SHUTDOWN-NOTES.md
```

## 29.5 Experiments

1. `@PostConstruct` success.
2. `@PostConstruct` failure stops deployment.
3. Slow `@PostConstruct` causes readiness delay.
4. `@PreDestroy` on graceful shutdown.
5. `@PreDestroy` not reliable after forced kill.
6. Correct `@Resource` lookup.
7. Wrong `@Resource` lookup.
8. `@Priority` filter ordering.
9. `@RolesAllowed` enforcement.
10. `javax.annotation` import migration.

## 29.6 Evaluation questions

1. Who calls `@PostConstruct`?
2. What happens if `@PostConstruct` throws?
3. Is `@PreDestroy` guaranteed?
4. Why should startup be bounded?
5. What is the difference between `@Inject` and `@Resource`?
6. Why should resource lookup be centralized?
7. What does `@Priority` mean in this spec?
8. Why is `@Generated` useful?
9. Which `javax.*` packages should not be migrated?
10. How do you test lifecycle behavior?

---

# 30. Referensi Resmi

Referensi utama:

1. Jakarta Annotations 3.0  
   https://jakarta.ee/specifications/annotations/3.0/

2. Jakarta Annotations 3.0 Specification  
   https://jakarta.ee/specifications/annotations/3.0/annotations-spec-3.0

3. Jakarta Annotations 3.0 API Docs  
   https://jakarta.ee/specifications/annotations/3.0/apidocs/jakarta.annotation/

4. `PostConstruct` API Documentation  
   https://jakarta.ee/specifications/platform/10/apidocs/jakarta/annotation/postconstruct

5. `PreDestroy` API Documentation  
   https://jakarta.ee/specifications/platform/9/apidocs/jakarta/annotation/predestroy

6. Jakarta Annotations API Maven Central  
   https://central.sonatype.com/artifact/jakarta.annotation/jakarta.annotation-api/3.0.0/jar

7. Jakarta EE Tutorial — CDI Basic / `@PostConstruct`  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/cdi/cdi-basic/cdi-basic.html

8. Jakarta EE Tutorial — Dependency Injection  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/platform/injection/injection.html

9. Spring Framework Reference — `@PostConstruct` and `@PreDestroy`  
   https://docs.spring.io/spring-framework/reference/core/beans/annotation-config/postconstruct-and-predestroy-annotations.html

10. OpenRewrite — Migrate `javax.annotation` to `jakarta.annotation`  
    https://docs.openrewrite.org/recipes/java/migrate/jakarta/javaxannotationmigrationtojakartaannotation

---

# Penutup

`jakarta.annotation` tampak kecil, tetapi ia mengajarkan salah satu mental model paling penting dalam Jakarta EE:

```text
annotation is metadata
container/runtime gives it behavior
```

`@PostConstruct` dan `@PreDestroy` bukan sekadar callback lucu. Mereka menentukan bagaimana object masuk dan keluar dari lifecycle container.

`@Resource` bukan sekadar injection. Ia menghubungkan aplikasi dengan resource environment yang dikelola runtime.

`@Priority` bukan angka bebas. Ia bermakna hanya dalam konteks spec/framework yang membacanya.

`@RolesAllowed` bukan pengganti domain authorization. Ia hanya salah satu layer security metadata.

Engineer yang kuat tidak hanya tahu annotation mana yang dipakai. Ia tahu:

```text
siapa yang membaca annotation
kapan annotation dibaca
apa lifecycle-nya
apa failure mode-nya
bagaimana testing-nya
apa konsekuensi production-nya
```

Dengan mental model ini, bagian berikutnya tentang **`jakarta.inject` dan Dependency Injection minimal** akan jauh lebih mudah dipahami.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-jakarta-part-004.md](./learn-java-jakarta-part-004.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-java-jakarta-part-006.md](./learn-java-jakarta-part-006.md)
