# Part 019 — CDI Extensions and Portable Runtime Customization

Series: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
File: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-019.md`  
Target Java: 8–25  
Target Enterprise Stack: Java EE `javax.*`, Jakarta EE `jakarta.*`, CDI Full, CDI Lite, Jakarta EE runtimes, MicroProfile-style runtimes

---

## 0. Why This Part Exists

Sampai part sebelumnya, kita memakai CDI sebagai user:

- mendefinisikan bean,
- memilih scope,
- memakai qualifier,
- membuat producer,
- mengirim event,
- memasang interceptor,
- memasang decorator,
- menyusun stereotype,
- memahami lifecycle callback.

Di part ini, levelnya naik satu lapis: **kita tidak hanya memakai container, tetapi mulai memahami bagaimana container bisa dikustomisasi**.

CDI extension adalah mekanisme untuk mempengaruhi proses bootstrap CDI:

- menambahkan bean secara programmatic,
- membaca annotation khusus,
- mengubah metadata bean,
- mendaftarkan synthetic bean,
- membuat framework mini di atas CDI,
- menghubungkan library non-CDI ke CDI,
- membangun runtime plugin model,
- membuat integration layer untuk configuration, security, observability, messaging, feature flag, dan domain module.

Namun ini juga salah satu area paling berbahaya dalam CDI. Extension bisa membuat aplikasi terasa “magis”: class yang tidak terlihat sebagai bean tiba-tiba injectable, annotation kecil mengubah runtime behavior besar, startup error menjadi sulit dibaca, dan dependency graph tidak lagi eksplisit.

Tujuan part ini bukan membuat kita asal bisa menulis extension. Tujuannya adalah memahami:

> kapan extension adalah solusi arsitektural yang tepat, kapan cukup producer/interceptor/decorator, dan kapan extension justru membuat sistem terlalu sulit dipahami.

---

## 1. Mental Model: CDI Extension adalah Compiler/Bootstrap Hook untuk Container

Secara sederhana:

```text
Normal CDI application:

  source code
      |
      v
  CDI scans classes
      |
      v
  CDI discovers beans
      |
      v
  CDI validates injection graph
      |
      v
  app runs
```

Dengan extension:

```text
CDI application with extension:

  source code
      |
      v
  CDI scans classes
      |
      v
  extension observes bootstrap phases
      |
      +--> inspect classes
      +--> inspect annotations
      +--> add metadata
      +--> veto classes
      +--> register synthetic beans
      +--> validate custom rules
      |
      v
  CDI finalizes bean model
      |
      v
  CDI validates injection graph
      |
      v
  app runs with modified container model
```

Extension bukan business service biasa. Extension adalah **container integration code**.

Analogi:

| Area | Normal Usage | Extension-Level Usage |
|---|---|---|
| Java compiler | menulis class | annotation processor/compiler plugin |
| Build tool | memakai dependency | membuat Gradle/Maven plugin |
| Database | query data | membuat trigger/extension engine |
| HTTP framework | menulis controller | membuat framework auto-discovery controller |
| CDI | menulis bean | memodifikasi bean discovery/model |

Extension bekerja lebih dekat ke level “runtime construction”, bukan “business operation”.

---

## 2. Why Top Engineers Need This Knowledge

Banyak engineer bisa memakai `@Inject`. Lebih sedikit yang paham mengapa dependency tertentu tersedia. Lebih sedikit lagi yang bisa menjawab:

- kenapa bean muncul padahal tidak ada scope annotation?
- kenapa bean hilang setelah upgrade CDI/runtime?
- kenapa library tertentu otomatis menambahkan interceptor?
- kenapa annotation custom bisa mengubah injection behavior?
- kenapa Quarkus-style extension sangat berbeda dari portable extension klasik?
- kenapa runtime yang build-time optimized tidak cocok dengan extension tertentu?
- kenapa CDI Lite tidak sama dengan CDI Full?
- kenapa extension bisa merusak startup time?
- kenapa extension bisa membuat native-image/build-time runtime menjadi sulit?

Top engineer tidak harus selalu membuat extension. Tetapi ia harus bisa mengenali kapan sebuah framework/library sedang memakai extension dan bagaimana dampaknya pada:

- deployment,
- startup,
- observability,
- testability,
- dependency graph,
- classloader isolation,
- migration `javax` → `jakarta`,
- Java 8 → 17/21/25 modernization,
- Jakarta EE server portability,
- Quarkus/Open Liberty/WildFly/Payara behavior.

---

## 3. CDI Extension Families

Secara praktis, ada beberapa family extension/integration mechanism.

```text
CDI extension landscape

  CDI Full Portable Extension
      |
      +-- classic runtime bootstrap hooks
      +-- observes container lifecycle events
      +-- uses jakarta.enterprise.inject.spi.Extension
      +-- powerful but runtime-oriented

  CDI Build Compatible Extension
      |
      +-- introduced for CDI Lite / build-time friendly model
      +-- designed to be usable by build-time optimized runtimes
      +-- avoids direct runtime reflection-heavy assumptions

  Vendor-specific extension
      |
      +-- Weld-specific hooks
      +-- OpenWebBeans-specific hooks
      +-- Quarkus Arc build items/extensions
      +-- Open Liberty features/configuration
      +-- WildFly subsystem integration

  Application-level pattern
      |
      +-- producer
      +-- interceptor
      +-- decorator
      +-- event observer
      +-- qualifier registry
      +-- does not alter container bootstrap deeply
```

Poin penting:

> Jangan langsung membuat CDI extension hanya karena ingin behavior custom. Mulai dari mekanisme paling sederhana yang cukup.

Urutan pertimbangan:

```text
Need custom behavior?

  Is it just object construction?
      -> Producer

  Is it cross-cutting method behavior?
      -> Interceptor

  Is it semantic wrapping of interface behavior?
      -> Decorator

  Is it local decoupling notification?
      -> CDI Event

  Is it implementation selection?
      -> Qualifier / Alternative / Producer / Instance<T>

  Is it container model customization?
      -> CDI Extension
```

---

## 4. What Problem Extensions Solve

Extension berguna saat kita perlu mengubah atau menambah **metadata model** CDI.

Contoh problem yang cocok:

### 4.1 Auto-register Bean dari Annotation Custom

Misalnya kita ingin annotation:

```java
@RegulatoryAdapter("onemap")
public class OneMapAddressAdapter implements ExternalAdapter {
    ...
}
```

Lalu framework internal otomatis:

- menemukan semua `@RegulatoryAdapter`,
- mendaftarkan metadata adapter,
- membuat registry,
- expose health indicator,
- validate duplicate adapter name,
- fail-fast saat ada adapter yang salah contract.

Tanpa extension, kita bisa membuat registry manual. Dengan extension, registry bisa dibangun saat container bootstrap.

### 4.2 Framework Integration

Contoh library non-CDI:

```java
public final class LegacyCryptoClient {
    public LegacyCryptoClient(String keyAlias, KeyStore keyStore) { ... }
}
```

Jika library besar perlu integrated ke CDI dengan lifecycle, configuration, cleanup, dan injection point metadata, extension dapat membuat adapter layer.

Namun untuk kasus sederhana, producer sudah cukup.

### 4.3 Custom Scope

Misalnya aplikasi regulatory punya lifecycle:

```text
Case Processing Context
  starts when case command begins
  contains correlation id, actor, case id, regulatory mode
  ends after command committed/audited
```

Custom scope dapat dibuat untuk object yang hidup selama “case command execution”. Ini advanced dan harus sangat hati-hati.

### 4.4 Enforce Architecture Rules at Bootstrap

Misalnya:

- class dengan `@ApplicationBoundary` tidak boleh inject repository langsung,
- class dengan `@RegulatoryWorkflowStep` wajib punya `@AuditedOperation`,
- adapter external wajib punya timeout config,
- feature-gated service wajib punya fallback,
- command handler tidak boleh `@SessionScoped`,
- singleton mutable wajib declare concurrency policy.

Extension bisa scan metadata dan fail-fast saat bootstrap.

### 4.5 Synthetic Bean Registration

Synthetic bean adalah bean yang tidak berasal langsung dari class biasa. Ia dibuat programmatically oleh extension.

Contoh:

- config-backed client,
- generated proxy,
- runtime registry,
- discovered plugin,
- tenant-specific adapter,
- dynamic external connector,
- health check aggregate.

---

## 5. What Extensions Should Not Solve

Extension bukan pengganti design yang jelas.

Jangan pakai extension untuk:

- menghindari constructor yang jelas,
- menyembunyikan dependency penting,
- membuat “magic auto-wiring” tanpa dokumentasi,
- memilih implementasi business logic secara diam-diam,
- membuat service locator global,
- membaca config secara liar di banyak tempat,
- bypass compile-time structure,
- menghindari refactor module boundary,
- membuat runtime terlalu sulit diuji.

Rule of thumb:

> Jika behavior penting untuk memahami business flow, jangan sembunyikan sepenuhnya di extension.

Extension cocok untuk framework/infrastructure concern. Business-critical routing sebaiknya tetap terlihat melalui interface, qualifier, policy object, atau use-case orchestration.

---

## 6. Portable Extension Model: CDI Full

Portable extension klasik memakai interface:

```java
import jakarta.enterprise.inject.spi.Extension;

public class MyExtension implements Extension {
}
```

Extension didaftarkan melalui Java Service Provider mechanism.

Untuk namespace `jakarta.*`:

```text
META-INF/services/jakarta.enterprise.inject.spi.Extension
```

Isi file:

```text
com.example.cdi.MyExtension
```

Untuk era Java EE / `javax.*`:

```text
META-INF/services/javax.enterprise.inject.spi.Extension
```

Isi file:

```text
com.example.cdi.MyExtension
```

Poin migration penting:

| Era | Extension Interface | Service File |
|---|---|---|
| Java EE / CDI 1.x–2.x | `javax.enterprise.inject.spi.Extension` | `META-INF/services/javax.enterprise.inject.spi.Extension` |
| Jakarta EE 9+ / CDI 3+ | `jakarta.enterprise.inject.spi.Extension` | `META-INF/services/jakarta.enterprise.inject.spi.Extension` |

Mixed namespace di extension sering gagal diam-diam: JAR ada, class ada, tetapi container tidak mengenali extension karena service file/interface namespace salah.

---

## 7. Portable Extension Event Model

Portable extension bekerja dengan meng-observe lifecycle events CDI bootstrap.

Secara konseptual:

```text
CDI bootstrap event flow

  BeforeBeanDiscovery
      |
      v
  ProcessAnnotatedType<T>
      |
      v
  ProcessInjectionPoint<T, X>
      |
      v
  ProcessInjectionTarget<T>
      |
      v
  ProcessBeanAttributes<T>
      |
      v
  ProcessBean<T>
      |
      v
  AfterTypeDiscovery
      |
      v
  AfterBeanDiscovery
      |
      v
  AfterDeploymentValidation
      |
      v
  Application ready
      |
      v
  BeforeShutdown
```

Tidak semua event perlu dipakai. Bahkan sebaiknya extension memakai event sesedikit mungkin.

---

## 8. Bootstrap Phase by Responsibility

### 8.1 `BeforeBeanDiscovery`

Digunakan untuk menambahkan metadata awal sebelum discovery berjalan.

Possible use:

- menambahkan qualifier annotation,
- menambahkan scope annotation,
- menambahkan interceptor binding,
- menambahkan stereotype,
- menyiapkan metadata global.

Mental model:

```text
BeforeBeanDiscovery = sebelum container mulai serius membangun model bean
```

### 8.2 `ProcessAnnotatedType<T>`

Digunakan untuk melihat atau memodifikasi annotated type yang ditemukan.

Possible use:

- membaca class annotation,
- veto class agar tidak menjadi bean,
- menambahkan annotation secara programmatic,
- mengganti metadata annotation,
- enforce rule pada class level.

Contoh konseptual:

```java
void observe(@Observes ProcessAnnotatedType<?> event) {
    AnnotatedType<?> type = event.getAnnotatedType();

    if (type.isAnnotationPresent(DoNotRegister.class)) {
        event.veto();
    }
}
```

Gunakan hati-hati. `ProcessAnnotatedType` bisa dipanggil untuk banyak class dan mempengaruhi startup time.

### 8.3 `ProcessInjectionPoint<T, X>`

Digunakan untuk melihat injection point.

Possible use:

- validate custom injection rule,
- menemukan semua injection point dengan qualifier tertentu,
- enforce “no direct infrastructure injection into domain layer”,
- collect metadata dependency.

Contoh use case:

```text
If an injection point has @ExternalSystem("X"), validate that config exists:

  external.X.base-url
  external.X.timeout
  external.X.enabled
```

### 8.4 `ProcessBeanAttributes<T>`

Digunakan untuk memodifikasi bean attributes.

Possible use:

- mengubah scope,
- menambah qualifier,
- mengubah stereotypes,
- memodifikasi name,
- validate bean metadata.

Ini lebih semantik daripada sekadar annotated type karena sudah berada di level bean attributes.

### 8.5 `ProcessBean<T>`

Digunakan untuk melihat bean yang sudah diproses.

Possible use:

- collect registry dari bean tertentu,
- inspect final bean model,
- validate duplicate roles,
- build metadata for runtime registry.

### 8.6 `AfterTypeDiscovery`

Digunakan setelah type discovery.

Possible use:

- menambahkan annotated type,
- mengatur alternatives/interceptors/decorators ordering,
- finalisasi metadata type-level.

### 8.7 `AfterBeanDiscovery`

Salah satu event paling penting untuk synthetic beans.

Possible use:

- register custom context,
- add synthetic bean,
- add observer method,
- add custom bean programmatically.

Mental model:

```text
AfterBeanDiscovery = kesempatan terakhir menambahkan bean/context/observer sebelum deployment validation final
```

### 8.8 `AfterDeploymentValidation`

Digunakan setelah dependency graph divalidasi.

Possible use:

- throw deployment problem jika custom validation gagal,
- initialize registry metadata,
- fail-fast jika rule arsitektur dilanggar.

Jangan melakukan business startup heavy I/O di sini kecuali memang lifecycle-nya jelas.

### 8.9 `BeforeShutdown`

Digunakan saat container shutdown.

Possible use:

- cleanup extension-managed metadata,
- close resources not managed by CDI bean lifecycle,
- flush diagnostics.

Namun resource normal lebih baik dikelola oleh CDI bean + `@PreDestroy` atau disposer.

---

## 9. Minimal Portable Extension Example

Contoh: extension yang mendeteksi semua bean dengan annotation custom `@WorkflowStep`.

### 9.1 Annotation

```java
package com.example.workflow;

import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.TYPE;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@Target(TYPE)
@Retention(RUNTIME)
public @interface WorkflowStep {
    String value();
}
```

### 9.2 Example Bean

```java
package com.example.caseflow;

import com.example.workflow.WorkflowStep;
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
@WorkflowStep("validate-case")
public class ValidateCaseStep {
    public void execute() {
        // business behavior
    }
}
```

### 9.3 Extension

```java
package com.example.workflow;

import jakarta.enterprise.event.Observes;
import jakarta.enterprise.inject.spi.Extension;
import jakarta.enterprise.inject.spi.ProcessAnnotatedType;

import java.util.LinkedHashMap;
import java.util.Map;

public class WorkflowStepExtension implements Extension {

    private final Map<String, Class<?>> steps = new LinkedHashMap<>();

    <T> void collectWorkflowSteps(@Observes ProcessAnnotatedType<T> event) {
        Class<T> javaClass = event.getAnnotatedType().getJavaClass();
        WorkflowStep annotation = javaClass.getAnnotation(WorkflowStep.class);

        if (annotation == null) {
            return;
        }

        String stepName = annotation.value();

        Class<?> previous = steps.putIfAbsent(stepName, javaClass);
        if (previous != null) {
            throw new IllegalStateException(
                "Duplicate @WorkflowStep name '" + stepName + "': "
                    + previous.getName() + " and " + javaClass.getName()
            );
        }
    }

    public Map<String, Class<?>> getSteps() {
        return Map.copyOf(steps);
    }
}
```

### 9.4 Service Registration

File:

```text
src/main/resources/META-INF/services/jakarta.enterprise.inject.spi.Extension
```

Content:

```text
com.example.workflow.WorkflowStepExtension
```

### 9.5 What This Does

Saat CDI bootstrap:

```text
1. Container scans classes.
2. For each discovered annotated type, extension receives ProcessAnnotatedType.
3. Extension checks @WorkflowStep.
4. Extension records mapping stepName -> class.
5. Duplicate names fail fast.
```

Ini bukan bean registry runtime yang langsung mengeksekusi step. Ini baru metadata collection.

Untuk membuat metadata ini injectable, kita perlu pattern tambahan.

---

## 10. Making Extension Metadata Available to Beans

Extension object sendiri bukan selalu pilihan ideal untuk diinjeksi langsung ke business code. Lebih baik expose metadata melalui bean biasa.

### 10.1 Registry Bean

```java
package com.example.workflow;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

import java.util.Map;

@ApplicationScoped
public class WorkflowStepRegistry {

    private final WorkflowStepExtension extension;

    @Inject
    public WorkflowStepRegistry(WorkflowStepExtension extension) {
        this.extension = extension;
    }

    public Map<String, Class<?>> steps() {
        return extension.getSteps();
    }
}
```

Namun ini couples application bean ke extension class.

Lebih clean:

```java
public interface WorkflowStepCatalog {
    Map<String, Class<?>> steps();
}
```

Kemudian extension menambahkan synthetic bean untuk interface tersebut, atau producer membuatnya dari extension metadata.

### 10.2 Producer-Based Bridge

```java
package com.example.workflow;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;

@ApplicationScoped
public class WorkflowStepCatalogProducer {

    @Produces
    @ApplicationScoped
    WorkflowStepCatalog produceCatalog(WorkflowStepExtension extension) {
        return extension::getSteps;
    }
}
```

Jika producer biasa cukup, synthetic bean belum diperlukan.

---

## 11. Synthetic Beans

Synthetic bean adalah bean yang dibuat oleh extension, bukan berasal dari class bean biasa.

Mental model:

```text
Class-based bean:

  @ApplicationScoped
  public class MyService { }

  -> container discovers class
  -> class becomes bean

Synthetic bean:

  extension.addBean(...)

  -> no direct bean class required
  -> extension tells container: "please expose this object as bean"
```

Use cases:

- expose generated registry,
- expose config-derived object,
- expose framework integration object,
- expose dynamic adapter,
- expose custom metadata catalog,
- expose proxy/wrapper not represented as normal class.

High-level pseudo example:

```java
void afterBeanDiscovery(@Observes AfterBeanDiscovery abd, BeanManager bm) {
    abd.addBean()
       .types(WorkflowStepCatalog.class, Object.class)
       .scope(ApplicationScoped.class)
       .produceWith(instance -> new DefaultWorkflowStepCatalog(collectedSteps));
}
```

Exact APIs vary by CDI version and style. The key concept is more important than memorizing method chain.

Synthetic bean should be used when:

- no normal class-based bean makes sense,
- object must be constructed from extension-time metadata,
- object is infrastructure/catalog/provider-level,
- lifecycle is clear.

Avoid synthetic bean when:

- a simple producer is enough,
- business dependency should be explicit,
- the object needs complex lifecycle better represented by normal class,
- it hides critical decision logic.

---

## 12. Custom Context and Custom Scope

CDI scopes are backed by contexts. If you create a custom scope, you usually need a custom context.

Example custom scope idea:

```java
@CaseCommandScoped
public class CaseCommandAuditBuffer {
    private final List<AuditEntry> entries = new ArrayList<>();
}
```

Desired lifecycle:

```text
Case command starts
    -> activate CaseCommand context
    -> create CaseCommandScoped beans lazily
    -> use them during command execution
Case command ends
    -> flush audit buffer
    -> destroy CaseCommandScoped beans
    -> deactivate context
```

This is powerful but risky.

You must define:

- when context activates,
- when context deactivates,
- what thread/request owns it,
- whether it propagates to async tasks,
- whether it can nest,
- how destruction happens,
- what happens on exception,
- how memory is released,
- how it interacts with transactions,
- how it behaves in tests.

Custom scope should be rare. Many teams are better served by explicit parameter passing or a request object.

Bad version:

```java
@CaseCommandScoped
public class CurrentCase {
    private String caseId;
    private String officerId;
}
```

Then every service reads implicit state from `CurrentCase`. This can become hidden global state.

Better in many cases:

```java
public record CaseCommandContext(
    String caseId,
    String actorId,
    String correlationId,
    RegulatoryMode mode
) {}
```

Pass it explicitly through application service boundary.

Use custom scope only when container-managed contextual state is truly the better abstraction.

---

## 13. Build Compatible Extensions

CDI Full portable extensions are very powerful, but historically they assume runtime bootstrap access to Java reflection and mutable container lifecycle.

Modern runtimes increasingly do work at build time:

- Quarkus,
- native image oriented platforms,
- ahead-of-time analysis,
- optimized startup runtimes,
- containerized serverless workloads.

Build Compatible Extensions were introduced to provide a model friendlier to build-time processing and CDI Lite.

Mental model:

```text
Portable Extension:

  runtime bootstrap phase
  observes container events
  can inspect/mutate CDI model deeply
  powerful but less build-time-friendly

Build Compatible Extension:

  designed for build-time-compatible transformation
  uses a more restricted model
  avoids assumptions that break AOT/native-style runtimes
  better for CDI Lite ecosystem
```

Why it matters:

- If you build reusable library for modern Java/Jakarta ecosystem, portable extension may limit compatibility.
- If target runtime includes Quarkus-like build-time augmentation, classic portable extension may not behave the same way or may be unsupported in the same form.
- If target is traditional Jakarta EE server, CDI Full portable extensions remain relevant.

Decision:

| Target | Preferred Mechanism |
|---|---|
| Traditional Jakarta EE Full Profile | Portable Extension acceptable |
| CDI Lite / Core Profile style | Build Compatible Extension likely preferred |
| Quarkus extension ecosystem | Quarkus extension/Arc build-time model |
| Simple app logic | Producer/interceptor/decorator first |
| Internal framework across many servers | Prefer standard CDI APIs, avoid vendor lock where possible |

---

## 14. CDI Lite vs CDI Full: Why Extension Choice Depends on Runtime

CDI Full includes the classic enterprise/server-friendly model. CDI Lite is a smaller subset intended for lighter runtimes and build-time use cases.

Conceptual difference:

```text
CDI Full
  - traditional portable extensions
  - more complete dynamic/runtime model
  - common in Jakarta EE servers

CDI Lite
  - smaller CDI subset
  - build compatible extension model
  - suitable for build-time optimized runtimes
```

Practical consequence:

A library that depends on CDI Full portable extension may not work in CDI Lite-only runtime.

Therefore, before writing extension, ask:

```text
Where must this run?

  WildFly / Payara / Open Liberty full profile?
  TomEE?
  Quarkus?
  Helidon?
  Micronaut integration?
  CDI SE bootstrap?
  Native image?
```

Portability is not just “does it compile”. Portability is:

- supported API subset,
- bootstrap model,
- classpath scanning behavior,
- reflection availability,
- build-time vs runtime processing,
- generated proxy model,
- native-image constraints,
- container integration layer.

---

## 15. Extension vs Annotation Processor

Do not confuse CDI extension with Java annotation processor.

| Aspect | CDI Extension | Annotation Processor |
|---|---|---|
| Runs during | CDI bootstrap/build-compatible processing | Java compilation |
| Sees | CDI/container model | source/annotation model |
| Can affect injection graph | yes | indirectly by generating code |
| Can fail deployment | yes | can fail compilation |
| Good for | container metadata/integration | generated code/static validation |
| Runtime dependency | yes, usually | often no after compile |
| Startup impact | possible | none at runtime if compile-only |

If rule can be checked at compile-time, annotation processor may be better.

Example:

- “Every `@WorkflowStep` must have unique name” across module may be compile-time or bootstrap-time.
- “Every external adapter config must exist in runtime environment” needs bootstrap/startup-time.
- “Generate strongly typed registry class from annotations” may be annotation processor.
- “Register runtime config-derived bean” may be CDI extension/producer.

Top-level heuristic:

```text
Can this be known at compile-time?
  yes -> annotation processor or build plugin may be better
  no  -> CDI extension or runtime validation may be needed
```

---

## 16. Extension vs Reflection Scanner

Many teams build their own reflection scanner:

```java
Set<Class<?>> classes = scan("com.example");
for (Class<?> cls : classes) {
    if (cls.isAnnotationPresent(MyAnnotation.class)) {
        ...
    }
}
```

This often breaks in enterprise runtime because:

- classloader hierarchy is complex,
- JAR scanning differs by server,
- nested archive layout differs,
- JPMS access may restrict reflection,
- native image may not include metadata,
- performance can be bad,
- duplicate classes can appear,
- app server already has discovery system.

CDI extension lets you piggyback on CDI’s discovery pipeline.

Better:

```text
Instead of scanning classpath yourself,
observe CDI discovery events.
```

But again: only if you really need bootstrap metadata.

---

## 17. Extension Use Case: Architecture Rule Enforcement

Imagine regulatory application layers:

```text
api-rest
application-service
workflow-domain
infrastructure-db
infrastructure-external
```

Rule:

```text
A class annotated @DomainService must not inject:
  - EntityManager
  - DataSource
  - RestClient
  - ExternalConnector
  - JNDI resources
```

Why? Because domain service should not directly depend on infrastructure.

Custom annotation:

```java
@Target(TYPE)
@Retention(RUNTIME)
public @interface DomainService {
}
```

Extension observes injection points:

```java
void validateInjectionPoint(@Observes ProcessInjectionPoint<?, ?> event) {
    InjectionPoint ip = event.getInjectionPoint();

    Class<?> declaringClass = ip.getMember().getDeclaringClass();
    if (!declaringClass.isAnnotationPresent(DomainService.class)) {
        return;
    }

    Type injectedType = ip.getType();

    if (isForbiddenInfrastructureType(injectedType)) {
        event.addDefinitionError(new IllegalStateException(
            "@DomainService " + declaringClass.getName()
                + " must not inject infrastructure type " + injectedType
        ));
    }
}
```

This gives fail-fast architecture enforcement.

Compare with code review:

| Method | Strength | Weakness |
|---|---|---|
| Code review only | human judgment | inconsistent |
| ArchUnit test | good static check | test must run |
| CDI extension validation | fail at deployment | more runtime complexity |
| Compiler plugin | fail at compile | harder to build |

Best practice:

- use ArchUnit/static test for most architecture checks,
- use CDI extension only when the rule depends on CDI metadata/runtime resolution.

---

## 18. Extension Use Case: Config-Backed External Client Catalog

Suppose application has external systems:

```properties
external.onemap.base-url=https://...
external.onemap.timeout=3s
external.onemap.enabled=true

external.myinfo.base-url=https://...
external.myinfo.timeout=5s
external.myinfo.enabled=true
```

And adapters:

```java
@ExternalSystem("onemap")
@ApplicationScoped
public class OneMapClient implements ExternalClient { }

@ExternalSystem("myinfo")
@ApplicationScoped
public class MyInfoClient implements ExternalClient { }
```

Extension can:

- collect all `@ExternalSystem` beans,
- validate unique names,
- validate each has required config,
- build catalog for observability,
- expose a health check registry,
- fail deployment if required config missing.

But do not let extension decide complex runtime business policy. For example:

```text
if agency = X and case type = Y and feature flag = Z,
choose connector A otherwise connector B
```

That belongs in explicit policy/service code, not hidden extension bootstrap.

---

## 19. Extension Use Case: Plugin Modules

Suppose enterprise product has optional modules:

```text
case-core.jar
case-appeal-plugin.jar
case-compliance-plugin.jar
case-legal-plugin.jar
case-survey-plugin.jar
```

Each plugin contributes workflow steps:

```java
@WorkflowStep("appeal-review")
public class AppealReviewStep implements CaseWorkflowStep { }
```

Extension collects them and produces registry.

Benefits:

- plugin modules can be added without central registry edit,
- duplicate names fail-fast,
- observability can expose all installed steps,
- deployment validates plugin contract.

Risks:

- startup order complexity,
- hidden coupling through string step names,
- hard-to-debug missing plugin due to discovery mode,
- classloader issues in EAR/WAR/module server,
- feature flag/profile interactions.

Better design:

```java
public interface CaseWorkflowStep {
    StepId id();
    StepMetadata metadata();
    StepResult execute(StepCommand command);
}
```

Then extension merely builds catalog; business workflow engine remains explicit.

---

## 20. Extension Use Case: Custom Annotation to Interceptor Binding Bridge

Suppose team wants:

```java
@RegulatoryOperation(
    module = "CASE",
    activity = "APPROVE",
    audit = true,
    metrics = true,
    idempotent = true
)
public ApprovalResult approve(ApproveCaseCommand command) { ... }
```

Potential extension behavior:

- validate required metadata,
- ensure method has allowed return type,
- ensure command has correlation id,
- add interceptor binding metadata programmatically.

But often simpler and clearer:

```java
@AuditedOperation(module = CASE, activity = APPROVE)
@MeasuredOperation
@IdempotentOperation
public ApprovalResult approve(ApproveCaseCommand command) { ... }
```

Question:

```text
Are we simplifying semantics or hiding important behavior?
```

If custom annotation becomes an unreadable “god annotation”, it is harmful.

---

## 21. Common Extension Failure Modes

### 21.1 Extension Not Loaded

Symptoms:

- expected synthetic bean missing,
- custom annotation ignored,
- validation did not run,
- app starts without expected registry.

Possible causes:

- missing `META-INF/services/...Extension`,
- wrong namespace `javax` vs `jakarta`,
- service file not packaged,
- extension JAR not in bean archive/deployment,
- classloader cannot see extension,
- runtime only supports CDI Lite/build-compatible subset,
- extension disabled by server packaging rules.

Checklist:

```text
[ ] Is service provider file present in final JAR?
[ ] Is the service file path using correct namespace?
[ ] Is extension class loadable?
[ ] Does extension implement correct Extension interface?
[ ] Is JAR included in deployment unit?
[ ] Is server using CDI Full or Lite?
[ ] Are startup logs showing extension discovery?
```

### 21.2 Extension Loaded Too Broadly

Symptoms:

- startup slow,
- extension processes thousands of classes,
- unexpected classes affected,
- third-party library classes vetoed/modified accidentally.

Causes:

- observing all `ProcessAnnotatedType<?>` without filtering,
- scanning packages too broadly,
- expensive reflection in bootstrap event,
- not using `@WithAnnotations`-style filtering where available,
- doing I/O in bootstrap event.

Rule:

```text
Filter as early and specifically as possible.
```

### 21.3 Hidden Dependency Graph

Symptoms:

- injection works but no visible bean class,
- tests fail because synthetic bean not registered,
- IDE cannot infer runtime dependency,
- team members cannot find implementation.

Causes:

- synthetic bean used for business service,
- extension magic undocumented,
- no architecture diagram,
- no startup log showing registered beans.

Mitigation:

- keep synthetic beans infrastructure-level,
- log concise registration summary,
- document extension contract,
- expose diagnostic endpoint in non-prod,
- write integration test verifying extension output.

### 21.4 Order-Dependent Bugs

Symptoms:

- works in one server but not another,
- changes after dependency upgrade,
- multiple extensions conflict.

Causes:

- relying on unspecified event ordering,
- multiple extensions modifying same metadata,
- alternative/interceptor/decorator ordering conflict,
- vendor implementation differences.

Mitigation:

- avoid order dependency,
- fail if conflicting metadata found,
- make extension idempotent,
- prefer explicit priority where supported,
- test on target runtime.

### 21.5 Startup Failure Hard to Understand

Symptoms:

- deployment exception with long stacktrace,
- unsatisfied dependency caused by extension veto,
- ambiguous dependency caused by extension-added bean.

Mitigation:

- custom errors must include:
  - affected class,
  - annotation,
  - injection point,
  - expected rule,
  - remediation.

Bad error:

```text
Invalid workflow step
```

Good error:

```text
Invalid @WorkflowStep on com.example.caseflow.ApproveCaseStep:
step name 'approve' is duplicated by com.example.legacy.LegacyApproveStep.
Use a unique @WorkflowStep value or disable one module.
```

---

## 22. Extension Design Principles

### Principle 1: Extension Must Be Boringly Deterministic

Given same deployment and same config, extension should produce same bean model.

Avoid:

- random ordering,
- time-based behavior,
- network call during bootstrap,
- environment-dependent scan without explicit config,
- reading mutable external state unpredictably.

### Principle 2: Extension Must Fail Fast and Loud

If contract violated, fail at deployment with precise error.

Do not silently ignore:

- duplicate plugin id,
- missing required config,
- unsupported scope,
- invalid annotation target,
- ambiguous runtime provider.

### Principle 3: Extension Must Be Narrow

Do not make extension inspect entire world if it only cares about one annotation.

Prefer:

```text
Observe only annotated types with @MyFrameworkAnnotation.
```

Avoid:

```text
Observe all classes and reflect on everything.
```

### Principle 4: Extension Must Not Hide Business Policy

It can register components. It should not secretly decide regulatory business flow.

Bad:

```text
Extension picks approval route based on hidden annotation rules.
```

Better:

```text
Extension builds catalog of available approval strategies.
Application policy explicitly chooses route.
```

### Principle 5: Extension Must Be Testable in Container

Pure unit tests are not enough. You need at least:

- extension bootstrap test,
- duplicate metadata failure test,
- missing config failure test,
- synthetic bean injection test,
- target runtime smoke test.

### Principle 6: Extension Must Be Version-Aware

A CDI extension is sensitive to:

- CDI version,
- Jakarta namespace,
- target runtime,
- Java version,
- server module/classloader behavior,
- CDI Lite vs Full.

Document compatibility.

---

## 23. Testing CDI Extensions

Testing extension requires bootstrapping CDI container.

Typical approaches:

- Weld JUnit for CDI SE style tests,
- Arquillian-style deployment tests,
- vendor runtime integration test,
- Quarkus test for Quarkus-specific extension,
- Open Liberty/WildFly/Payara smoke deployment.

Test categories:

### 23.1 Extension Discovery Test

Goal: ensure service file loads extension.

```text
Given extension JAR included
When CDI container starts
Then extension runs and registry bean exists
```

### 23.2 Positive Metadata Test

```text
Given two @WorkflowStep beans with unique names
When container starts
Then WorkflowStepCatalog contains both
```

### 23.3 Duplicate Failure Test

```text
Given two @WorkflowStep beans with same name
When container starts
Then deployment fails with duplicate step message
```

### 23.4 Injection Graph Test

```text
Given synthetic WorkflowStepCatalog bean
When ApplicationService injects WorkflowStepCatalog
Then injection is satisfied
```

### 23.5 Runtime Compatibility Test

```text
Run same extension on actual target runtime:
  - WildFly version X
  - Open Liberty version Y
  - Payara version Z
  - Quarkus if supported
```

Do not assume provider behavior from one runtime equals all runtimes.

---

## 24. Observability for Extensions

Extensions affect runtime model, so they need observability.

Useful startup logs:

```text
[workflow-extension] discovered 7 workflow steps:
  - validate-case -> com.example.case.ValidateCaseStep
  - approve-case  -> com.example.case.ApproveCaseStep
  - reject-case   -> com.example.case.RejectCaseStep
```

But avoid noisy logs in production.

Expose diagnostics carefully:

```text
/nonprod/runtime/workflow-steps
/nonprod/runtime/cdi-extension-summary
/nonprod/runtime/feature-adapters
```

For production, expose safe aggregate:

```json
{
  "workflowStepsCount": 7,
  "externalAdaptersCount": 4,
  "extensionVersion": "1.3.0"
}
```

Never expose:

- secrets,
- internal classpath paths,
- sensitive config values,
- user/case data,
- full dependency graph publicly.

---

## 25. Version and Namespace Compatibility

Extension compatibility matrix:

| Dimension | Questions |
|---|---|
| Java version | Does extension use APIs unavailable in Java 8/11/17? |
| Namespace | Is it `javax.*` or `jakarta.*`? |
| CDI version | CDI 1.x/2.x/3.x/4.x/4.1? |
| CDI mode | Full or Lite? |
| Runtime | WildFly/Open Liberty/Payara/TomEE/Quarkus? |
| Packaging | JAR/WAR/EAR? |
| Classloader | Can extension see target classes? |
| Build-time | Runtime extension or build-compatible? |
| Native image | Reflection metadata available? |

For Java 8–25 learning path:

```text
Java 8
  often Java EE 7/8, javax namespace, CDI 1.1/1.2/2.0 depending server

Java 11
  transition era, still many Java EE 8/javax systems

Java 17
  modern Jakarta EE baseline, Jakarta EE 10/11 relevant

Java 21
  common modern LTS, virtual thread consideration, Jakarta runtimes modernizing

Java 25
  latest LTS-era target, still verify Jakarta runtime support and vendor certification
```

Do not only check Java compiler version. Check server support matrix.

---

## 26. Performance Considerations

CDI extensions run during bootstrap, so they affect startup.

Cost sources:

- observing too many classes,
- reflection on every class/method/field,
- annotation scanning without filtering,
- reading files/JARs manually,
- building large registries,
- network calls during bootstrap,
- complex validation across modules,
- generating many synthetic beans,
- increasing injection graph ambiguity.

Guidelines:

```text
[ ] Filter early.
[ ] Avoid I/O during bootstrap.
[ ] Avoid network calls.
[ ] Cache metadata locally within extension.
[ ] Use immutable registry after validation.
[ ] Log summary, not every tiny step.
[ ] Benchmark startup with and without extension.
[ ] Test large deployment, not only tiny sample app.
```

---

## 27. Security Considerations

Extension can accidentally widen attack surface.

Risks:

- automatically exposing classes as beans,
- registering handlers based on annotation without allowlist,
- reading arbitrary config keys,
- reflecting private fields/methods,
- exposing diagnostic metadata,
- plugin JAR registering unexpected behavior,
- classpath injection/supply chain issue,
- extension from dependency running automatically.

Security principles:

```text
[ ] Trust boundary: which JARs may contribute components?
[ ] Explicit package allowlist for plugin discovery.
[ ] Fail on unknown/duplicate plugin id.
[ ] Do not execute plugin logic during discovery.
[ ] Do not expose full internal metadata publicly.
[ ] Verify dependencies/SBOM.
[ ] Keep extension dependencies minimal.
```

In regulated systems, extension behavior should be documented because it changes runtime composition.

---

## 28. Extension and Feature Flags

It is tempting to use extension to include/exclude beans based on feature flags.

Be careful.

There are three decision times:

```text
Build-time decision
  -> feature compiled/packaged or not

Startup-time decision
  -> bean active or not based on config/profile

Runtime-per-request decision
  -> flag evaluated for actor/tenant/case/request
```

Extension can help with startup-time decision, but not every feature flag is startup-time.

Bad:

```text
At bootstrap, extension disables NewApprovalService if flag is false.
Later ops turns flag on dynamically, but bean does not exist.
```

Better:

```text
Both implementations exist.
Policy/strategy chooses at runtime based on flag.
```

Use extension for:

- validating feature metadata,
- registering available feature handlers,
- ensuring fallback exists,
- building feature catalog.

Use runtime service for:

- per-user targeting,
- gradual rollout,
- tenant-specific decision,
- kill switch,
- dynamic flag change.

---

## 29. Extension and Profiles

Profiles are often startup/deployment-level.

Extension may use profile config to:

- enable synthetic bean for local/dev/test,
- validate prod-only restrictions,
- block unsafe bean in prod,
- register mock adapter in test.

But beware profile explosion.

Bad:

```text
Extension contains 30 if statements for dev/uat/prod/agency/country/client.
```

Better:

```text
Use config/profile to select small number of infrastructure variants.
Business variability remains explicit in policy layer.
```

---

## 30. Extension and Enterprise Beans

In Jakarta EE runtimes, CDI may integrate with Enterprise Beans depending platform/runtime.

Extension design must consider:

- EJB session bean class discovery,
- CDI injection into EJB,
- EJB injection into CDI,
- transaction interceptor behavior,
- security annotations,
- timers/async methods,
- local/remote interfaces,
- container proxies.

Do not assume CDI extension can freely modify EJB semantics. EJB container has its own lifecycle and rules.

Practical advice:

```text
For EJB-heavy legacy systems:
  - use extension mostly for validation/cataloging
  - avoid synthetic replacement of EJB services
  - prefer gradual migration to CDI where possible
```

---

## 31. Extension and Classloaders

Part 005 becomes very relevant here.

Potential issue:

```text
extension.jar loaded by server/module classloader
application classes loaded by deployment classloader
```

If extension stores `Class<?>` references or tries to instantiate classes, classloader boundaries matter.

Symptoms:

- extension sees no app classes,
- `ClassCastException: X cannot be cast to X`,
- service provider file not visible,
- duplicate extension loaded,
- extension loaded once per module unexpectedly.

Guidelines:

```text
[ ] Keep extension inside application deployment unless intentionally server-level.
[ ] Avoid static global registries across deployments.
[ ] Do not assume one JVM = one application.
[ ] Clear metadata on shutdown.
[ ] Avoid caching deployment classes in global static fields.
```

This is critical in application servers where redeploy happens without JVM restart.

---

## 32. Extension and Memory Leaks

Bad extension pattern:

```java
public class MyExtension implements Extension {
    private static final Map<String, Class<?>> GLOBAL = new HashMap<>();
}
```

Why dangerous:

- class references keep deployment classloader alive,
- redeploy leaks memory,
- old version classes remain referenced,
- behavior differs after redeployment.

Better:

```java
public class MyExtension implements Extension {
    private final Map<String, Class<?>> local = new LinkedHashMap<>();

    void shutdown(@Observes BeforeShutdown event) {
        local.clear();
    }
}
```

Even better: avoid storing `Class<?>` if not needed; store stable metadata and let CDI resolve beans via type/qualifier when needed.

---

## 33. Extension Decision Matrix

Before writing extension, answer:

| Question | If Yes | If No |
|---|---|---|
| Do I need to change CDI bean model? | Extension may fit | Use normal CDI pattern |
| Can producer solve it? | Use producer | Continue analysis |
| Can interceptor/decorator solve it? | Use those | Continue analysis |
| Is behavior infrastructure/framework-level? | Extension more acceptable | Avoid hiding business logic |
| Must it work on CDI Lite? | Consider build-compatible extension | Portable extension okay for CDI Full |
| Must it work on multiple servers? | Keep standard APIs only | Vendor extension acceptable if locked in |
| Does it depend on runtime config? | Validate carefully | Maybe compile-time tool better |
| Does it need network I/O at bootstrap? | Probably redesign | Safer |
| Can you test it on real runtime? | Proceed cautiously | Do not ship |
| Can new engineers understand it? | Document and log | Avoid |

---

## 34. Practical Patterns

### 34.1 Registry Extension Pattern

Use extension to collect annotated components.

```text
@WorkflowStep classes
    -> extension collects metadata
    -> catalog bean exposes registry
    -> workflow engine explicitly chooses step
```

Good for:

- plugin model,
- domain handler catalog,
- connector catalog,
- command handler registry.

Risk:

- hidden string keys,
- duplicate metadata,
- unclear selection.

### 34.2 Validation Extension Pattern

Use extension to enforce architecture/runtime constraints.

```text
@ExternalAdapter must have config
@RegulatoryOperation must have audit metadata
@DomainService must not inject infrastructure type
```

Good for:

- fail-fast governance,
- compliance-heavy systems,
- large teams.

Risk:

- false positives,
- complex rules hard to maintain,
- portability differences.

### 34.3 Synthetic Infrastructure Bean Pattern

Use extension to expose infrastructure object.

```text
collected metadata
    -> synthetic WorkflowStepCatalog bean
    -> application injects catalog interface
```

Good for:

- framework metadata,
- generated registry,
- config-derived catalog.

Risk:

- hidden bean source,
- test complexity.

### 34.4 Custom Scope Pattern

Use only if lifecycle truly maps to domain/runtime context.

Good for:

- request-like custom execution context,
- batch chunk context,
- command execution context.

Risk:

- hidden global state,
- async/thread propagation bugs,
- memory leaks,
- testing difficulty.

---

## 35. Enterprise Regulatory Example: Case Workflow Plugin Catalog

Imagine modules:

```text
case-core
case-appeal
case-compliance
case-legal
case-revenue
```

Each contributes handlers:

```java
@CaseActionHandler(
    action = "APPROVE_CASE",
    module = "CASE",
    requiresAudit = true
)
@ApplicationScoped
public class ApproveCaseHandler implements CaseCommandHandler<ApproveCaseCommand> {
    @Override
    public CaseCommandResult handle(ApproveCaseCommand command) {
        ...
    }
}
```

Extension responsibilities:

```text
During bootstrap:
  [x] find @CaseActionHandler beans
  [x] validate action name uniqueness
  [x] validate requiresAudit=true has @AuditedOperation or equivalent
  [x] validate handler implements CaseCommandHandler
  [x] validate module code is known
  [x] build catalog metadata
  [x] expose CaseActionCatalog bean
```

Application service remains explicit:

```java
@ApplicationScoped
public class CaseCommandDispatcher {

    private final CaseActionCatalog catalog;
    private final FeatureFlagService flags;
    private final AuditService audit;

    @Inject
    public CaseCommandDispatcher(
        CaseActionCatalog catalog,
        FeatureFlagService flags,
        AuditService audit
    ) {
        this.catalog = catalog;
        this.flags = flags;
        this.audit = audit;
    }

    public CaseCommandResult dispatch(CaseCommand command) {
        CaseActionDescriptor descriptor = catalog.require(command.action());

        if (!flags.isEnabled(descriptor.featureKey(), command.context())) {
            return CaseCommandResult.rejected("Feature disabled");
        }

        CaseCommandHandler handler = descriptor.resolveHandler();
        CaseCommandResult result = handler.handle(command);

        if (descriptor.requiresAudit()) {
            audit.record(command, result);
        }

        return result;
    }
}
```

The extension builds the catalog. It does not hide the dispatch policy.

That separation is the architecture win.

---

## 36. Anti-Patterns

### 36.1 Magic Framework Syndrome

Everything is annotation-driven, but nobody can trace runtime behavior.

Symptoms:

- “Where is this bean created?” unclear.
- “Why is this handler called?” unclear.
- “Why did prod select this implementation?” unclear.
- Only one senior understands the extension.

Fix:

- reduce extension scope,
- expose catalog/diagnostics,
- make selection explicit,
- document bootstrap model.

### 36.2 Extension as Service Locator

Bad:

```java
public class GlobalBeanResolverExtension implements Extension {
    public static <T> T get(Class<T> type) { ... }
}
```

This bypasses DI and creates global hidden dependency.

Fix:

- inject dependencies normally,
- use `Instance<T>` where dynamic selection is needed,
- keep extension out of business path.

### 36.3 Runtime I/O During Discovery

Bad:

```text
During ProcessAnnotatedType:
  call external config server
  call database
  call network service
```

Discovery should be deterministic and fast.

Fix:

- read local config only if needed,
- defer I/O to managed bean initialization,
- use health check/readiness for external dependency.

### 36.4 Overusing Custom Scope

Bad:

```text
Create custom scope for every domain idea:
  @CaseScoped
  @OfficerScoped
  @AgencyScoped
  @ApprovalScoped
  @ScreeningScoped
```

This creates lifecycle confusion.

Fix:

- use explicit context objects,
- use request scope where appropriate,
- reserve custom scopes for true lifecycle boundaries.

---

## 37. Checklist Before Shipping a CDI Extension

```text
Purpose
[ ] Is the extension solving container/framework-level problem?
[ ] Is there a simpler CDI mechanism that would work?
[ ] Is business policy still explicit?

Portability
[ ] Is target CDI Full or CDI Lite?
[ ] Is namespace javax/jakarta correct?
[ ] Is target runtime tested?
[ ] Is Java version compatibility documented?

Bootstrap
[ ] Does extension avoid network calls?
[ ] Does it filter discovered types early?
[ ] Does it avoid broad reflection?
[ ] Does it fail fast with useful error messages?

Classloader
[ ] Does it avoid static global class caches?
[ ] Does it clean metadata on shutdown?
[ ] Does it behave correctly on redeploy?

Testing
[ ] Positive bootstrap test exists?
[ ] Negative validation test exists?
[ ] Synthetic bean injection test exists?
[ ] Real runtime smoke test exists?

Observability
[ ] Startup summary log exists?
[ ] Non-prod diagnostics available?
[ ] Sensitive data not exposed?

Maintenance
[ ] Extension contract documented?
[ ] Version compatibility documented?
[ ] New team member can understand behavior?
```

---

## 38. Key Takeaways

1. CDI extension is not normal application code; it is container integration code.
2. Portable extensions are powerful but more runtime/bootstrap-oriented.
3. Build Compatible Extensions exist for a more build-time-friendly/CDI Lite world.
4. Producers, interceptors, decorators, events, qualifiers, and alternatives should be considered before extension.
5. Extension is suitable for framework-level behavior: metadata collection, validation, synthetic infrastructure beans, custom scopes, and integration with non-CDI libraries.
6. Extension should not hide business-critical routing or policy.
7. Namespace migration matters: `javax.enterprise.inject.spi.Extension` and `jakarta.enterprise.inject.spi.Extension` are different worlds.
8. Classloader, redeploy, startup performance, and runtime portability are major concerns.
9. A good extension is deterministic, narrow, well-tested, observable, and boring.
10. In top-tier enterprise engineering, extension knowledge helps diagnose frameworks and build disciplined runtime models—not just write clever magic.

---

## 39. How This Part Connects to the Next Parts

This part completes the advanced CDI customization block.

Next, the series moves into Enterprise Beans:

```text
Part 020 — Enterprise Beans / EJB Mental Model: Why It Exists and What Still Matters
```

That transition matters because Enterprise Beans also rely heavily on container ownership, proxies, lifecycle, transactions, concurrency, timers, security, and deployment-time semantics.

CDI extension teaches how CDI can be customized. Enterprise Beans teaches what the older/full enterprise container already provides as built-in managed behavior.

---

## 40. References

- Jakarta CDI 4.1 Specification
- Jakarta CDI 4.1 Release Page
- Jakarta CDI article: Build Compatible Extensions
- Weld documentation: Portable extensions
- Jakarta EE 11 Platform release information

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime — Part 018](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-018.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 020 — Enterprise Beans / EJB Mental Model: Why It Exists and What Still Matters](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-020.md)

</div>