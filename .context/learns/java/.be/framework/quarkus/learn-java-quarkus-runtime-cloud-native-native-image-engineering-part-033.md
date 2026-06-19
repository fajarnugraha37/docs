# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-033
# Custom Extension Engineering: Membuat Extension Quarkus Sendiri

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Part: `033`  
> Topik: Custom Extension Engineering: Membuat Extension Quarkus Sendiri  
> Status: Materi lanjutan advance — setelah runtime, testing, native image, Kubernetes, dan virtual threads  
> Target: Software engineer yang mampu memahami dan membangun Quarkus extension internal/platform-level secara benar: deployment/runtime split, build steps, build items, recorders, synthetic beans, Jandex, config, native metadata, testing, dan production governance

---

## 0. Ringkasan Besar

Quarkus bukan hanya framework runtime.

Quarkus adalah framework yang banyak memindahkan kerja framework ke **build time**.

Itulah kenapa Quarkus bisa:

- startup cepat,
- memory lebih rendah,
- native-image friendly,
- menghindari banyak runtime scanning,
- mengoptimalkan CDI,
- menghasilkan bytecode/resources saat build,
- mendaftarkan reflection/native metadata lebih awal.

Custom extension adalah cara resmi untuk mengintegrasikan library, platform standard, atau internal framework ke dalam model Quarkus.

Namun extension bukan sekadar “buat dependency wrapper”.

Extension adalah mekanisme untuk:

```text
Mengambil kerja yang biasanya dilakukan di runtime,
lalu memindahkannya ke build time secara aman.
```

Contoh kebutuhan extension internal:

- standar security/tenant context,
- audit trail platform,
- correlation ID/logging policy,
- internal REST client generator,
- policy-based authorization,
- custom scheduler/job framework,
- organization-wide config validation,
- native metadata untuk library internal,
- generated CDI beans,
- Dev UI page untuk diagnostics,
- health/metrics conventions,
- service binding integration,
- messaging convention,
- codegen dari internal schema.

Extension bisa powerful, tetapi juga berbahaya jika dibuat tanpa disiplin.

Part ini membahas custom extension engineering dari mental model sampai production checklist.

---

## 1. Mental Model: Extension Adalah Compiler Plugin + Runtime Integration

Quarkus extension terdiri dari dua sisi:

```text
deployment/build-time side
runtime side
```

Official Quarkus docs menjelaskan bahwa extension memiliki dua bagian utama:

1. **Build-time augmentation**
   - membaca metadata,
   - memproses annotation/XML/config,
   - menghasilkan build items,
   - mendaftarkan beans/resources/reflection/native metadata,
   - menghasilkan bytecode jika perlu,
   - merekam instruksi runtime.

2. **Runtime container**
   - code yang benar-benar ada di runtime classpath aplikasi,
   - service/library yang digunakan ketika app berjalan,
   - API yang dipakai application developer.

Mental model:

```text
Deployment module = compiler/augmentation logic.
Runtime module = runtime API/implementation.
```

Application developer biasanya hanya menambahkan dependency ke runtime artifact.

Quarkus build system akan menemukan deployment artifact terkait dan menjalankan build steps saat build.

---

## 2. Kenapa Tidak Cukup Pakai Library Biasa?

Library biasa sering melakukan runtime discovery:

```text
scan classpath
baca annotation
buat proxy
load resource
pakai reflection
ServiceLoader
generate metadata
```

Di Quarkus, terutama native image, itu kurang ideal.

Extension memungkinkan:

```text
scan once at build time
generate metadata
register reflection
create synthetic bean
validate config early
generate classes/resources
prepare runtime initialization
```

Hasil:

- startup lebih cepat,
- runtime lebih deterministik,
- native image lebih mudah,
- error muncul saat build, bukan production,
- developer experience lebih baik.

---

## 3. Kapan Membuat Custom Extension?

Buat custom extension jika:

1. Library internal dipakai banyak service.
2. Setup-nya repetitive dan rawan salah.
3. Perlu native-image metadata otomatis.
4. Perlu build-time validation.
5. Perlu generate CDI beans.
6. Perlu scan annotation saat build.
7. Perlu integrasi config/health/metrics/dev-ui.
8. Perlu enforce platform standard.
9. Perlu menghilangkan runtime scanning.
10. Perlu developer experience konsisten.

Jangan buat extension jika:

- hanya butuh satu utility class,
- hanya dipakai satu service,
- tidak ada build-time need,
- bisa diselesaikan dengan CDI bean biasa,
- abstraction belum stabil,
- tim belum paham Quarkus lifecycle,
- extension akan menjadi “god framework”.

Rule:

```text
Extension is justified when build-time integration gives clear value.
```

---

## 4. Extension vs Library vs Starter

### 4.1 Library Biasa

```text
Jar berisi runtime code.
Application menggunakannya langsung.
```

Good for:

- utility,
- domain shared code,
- simple client,
- no build-time integration.

### 4.2 “Starter” / Platform Module

```text
Jar berisi default beans/config wrappers.
```

Good for:

- shared CDI beans,
- standard interceptors,
- common filters,
- no deep Quarkus build integration.

### 4.3 Quarkus Extension

```text
Runtime artifact + deployment artifact.
Build steps integrate with Quarkus augmentation.
```

Good for:

- build-time discovery,
- native metadata,
- generated beans/classes,
- config root,
- Dev UI,
- capabilities,
- extension-to-extension integration.

Do not create extension just for branding.

---

## 5. Extension Project Structure

Typical extension has at least:

```text
my-extension/
  runtime/
    src/main/java/...
  deployment/
    src/main/java/...
```

Runtime module:

```text
my-extension
```

Deployment module:

```text
my-extension-deployment
```

Application depends on runtime artifact:

```xml
<dependency>
    <groupId>com.acme</groupId>
    <artifactId>acme-audit-extension</artifactId>
</dependency>
```

Deployment artifact is not directly used by application code. Quarkus resolves it during build.

Official Maven tooling guide notes that Quarkus extension dependencies are divided into runtime extension dependencies and deployment/build-time extension dependencies; application developers are expected to express dependencies only on runtime artifacts.

---

## 6. Runtime Module

Runtime module contains:

- public API,
- runtime service,
- CDI annotations if needed,
- interceptors,
- filters,
- config interfaces/classes used at runtime,
- recorder target classes,
- runtime DTOs,
- helper classes needed by application.

Example:

```text
acme-audit/runtime
  AuditService.java
  AuditEvent.java
  AuditRecorder.java
  AuditConfig.java
  AuditInterceptor.java
```

Runtime code must be safe to include in application runtime.

It should not depend on deployment-only Quarkus classes.

Do not import:

```text
io.quarkus.deployment.*
```

from runtime module.

---

## 7. Deployment Module

Deployment module contains:

- processors,
- build steps,
- build items,
- annotation scanning,
- Jandex index reading,
- native metadata registration,
- synthetic bean registration,
- generated classes/resources,
- validation,
- recorder invocation.

Example:

```text
acme-audit/deployment
  AcmeAuditProcessor.java
  AcmeAuditBuildItem.java
  AcmeAuditRecorderBuildStep.java
```

Deployment module can depend on:

```text
io.quarkus.deployment
io.quarkus.arc.deployment
io.quarkus.builder
```

It runs during build/augmentation.

Deployment code should not be in runtime classpath.

---

## 8. Build Steps

Build steps are methods annotated with `@BuildStep`.

Conceptual:

```java
import io.quarkus.deployment.annotations.BuildStep;
import io.quarkus.deployment.builditem.FeatureBuildItem;

class AcmeAuditProcessor {

    private static final String FEATURE = "acme-audit";

    @BuildStep
    FeatureBuildItem feature() {
        return new FeatureBuildItem(FEATURE);
    }
}
```

Build steps:

- consume build items,
- produce build items,
- run during augmentation,
- can validate application metadata,
- can register beans/resources/reflection,
- can call recorders.

Think of build steps as small compiler phases.

---

## 9. Build Items

Build items are messages between build steps.

They allow extensions to communicate.

Types:

1. Simple build item.
2. Multi build item.
3. Empty build item.
4. Build items provided by Quarkus core/extensions.
5. Custom build items.

Example:

```java
public final class AcmeAuditEventBuildItem extends MultiBuildItem {

    private final String eventType;

    public AcmeAuditEventBuildItem(String eventType) {
        this.eventType = eventType;
    }

    public String eventType() {
        return eventType;
    }
}
```

A build step can produce:

```java
@BuildStep
AcmeAuditEventBuildItem event() {
    return new AcmeAuditEventBuildItem("APPLICATION_APPROVED");
}
```

Other build step can consume:

```java
@BuildStep
void validate(List<AcmeAuditEventBuildItem> events) {
    ...
}
```

Build items are extension internal protocol.

Design them carefully.

---

## 10. FeatureBuildItem

FeatureBuildItem registers feature name visible in Quarkus output.

```java
@BuildStep
FeatureBuildItem feature() {
    return new FeatureBuildItem("acme-audit");
}
```

This is minimal extension identity.

Do it for your extension.

---

## 11. Jandex Index

Quarkus uses Jandex to index annotations/classes at build time.

Instead of runtime reflection scanning:

```text
scan classpath at runtime
```

extension uses Jandex index:

```text
read indexed annotations at build time
```

Example use cases:

- find classes annotated with `@Audited`,
- find methods annotated with `@RequiresPermission`,
- find DTOs annotated with `@ExternalContract`,
- find generated client interfaces.

Conceptual:

```java
@BuildStep
void scanAuditedMethods(CombinedIndexBuildItem index) {
    IndexView view = index.getIndex();

    Collection<AnnotationInstance> annotations =
            view.getAnnotations(DotName.createSimple(Audited.class.getName()));

    for (AnnotationInstance annotation : annotations) {
        // inspect target class/method
    }
}
```

This is native-friendly because discovery happens during build.

---

## 12. Annotation-Driven Extension

Example runtime annotation:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface Audited {
    String eventType();
}
```

Deployment processor scans:

```java
@BuildStep
void collectAuditedMethods(CombinedIndexBuildItem index,
                           BuildProducer<AcmeAuditEventBuildItem> events) {
    DotName audited = DotName.createSimple(Audited.class.getName());

    for (AnnotationInstance annotation : index.getIndex().getAnnotations(audited)) {
        String eventType = annotation.value("eventType").asString();
        events.produce(new AcmeAuditEventBuildItem(eventType));
    }
}
```

Then extension can:

- validate event type naming,
- generate registry,
- register interceptor,
- produce Dev UI diagnostics,
- ensure reflection if needed.

---

## 13. Recorders

Recorders bridge build-time knowledge to runtime initialization.

At build time, you cannot instantiate runtime CDI beans and mutate them directly because runtime container is not running yet.

Official docs note that obtaining bean instances during augmentation is illegal because CDI container is not started during augmentation.

Instead, use recorders.

Recorder methods are invoked during Quarkus bootstrap phases to create runtime initialization logic.

Conceptual runtime recorder:

```java
import io.quarkus.runtime.annotations.Recorder;

@Recorder
public class AcmeAuditRecorder {

    public void configureAuditRegistry(List<String> eventTypes) {
        AuditRegistry.initialize(eventTypes);
    }
}
```

Deployment build step:

```java
@BuildStep
@Record(STATIC_INIT)
void recordAuditEvents(AcmeAuditRecorder recorder,
                       List<AcmeAuditEventBuildItem> events) {
    List<String> eventTypes = events.stream()
            .map(AcmeAuditEventBuildItem::eventType)
            .toList();

    recorder.configureAuditRegistry(eventTypes);
}
```

Recorders are central to extension design.

---

## 14. Static Init vs Runtime Init in Extension

Recorder can run during:

```text
STATIC_INIT
RUNTIME_INIT
```

Use static init for:

- deterministic metadata,
- immutable registries,
- generated lookup tables,
- annotation-derived data,
- no runtime env dependency.

Use runtime init for:

- environment,
- secrets,
- runtime config,
- network clients,
- connections,
- current time,
- random,
- file system,
- runtime-specific state.

Bad:

```text
record runtime secret during STATIC_INIT
```

Good:

```text
record event metadata during STATIC_INIT
initialize client with runtime config during RUNTIME_INIT
```

This mirrors Part 028 native image static/runtime init.

---

## 15. Synthetic Beans

Synthetic beans are CDI beans registered by extension.

Use when:

- bean does not exist as application class,
- bean should be generated based on build-time metadata,
- third-party library object should be injectable,
- extension needs runtime bean with config.

CDI integration guide explains that Quarkus extensions can add/remove/transform metadata during bootstrap and register synthetic components.

Conceptual:

```java
@BuildStep
void registerSyntheticBean(BuildProducer<SyntheticBeanBuildItem> syntheticBeans) {
    syntheticBeans.produce(
        SyntheticBeanBuildItem.configure(AuditRegistry.class)
            .scope(Singleton.class)
            .supplier(AuditRegistry::new)
            .done()
    );
}
```

Exact API depends on Quarkus version.

Synthetic beans are powerful but must be clear.

---

## 16. AdditionalBeanBuildItem

If runtime module has CDI beans that might not be discovered automatically, deployment can register them as additional beans.

Example:

```java
@BuildStep
AdditionalBeanBuildItem beans() {
    return AdditionalBeanBuildItem.builder()
            .addBeanClass(AuditService.class)
            .addBeanClass(AuditInterceptor.class)
            .setUnremovable()
            .build();
}
```

Use `.setUnremovable()` carefully.

Quarkus removes unused beans aggressively.

If your bean is looked up dynamically or used by framework, it may need to be unremovable.

But overusing unremovable increases footprint.

---

## 17. Bean Removal and Unremovable Beans

Quarkus Arc removes unused beans to reduce startup/memory.

Extension authors must understand:

```text
If bean is only used reflectively/dynamically,
Arc may consider it unused and remove it.
```

Solutions:

- make injection explicit,
- produce additional bean,
- mark unremovable only when needed,
- use generated/synthetic bean with known usage,
- avoid dynamic lookup.

Do not mark entire packages unremovable unless necessary.

---

## 18. Native Metadata Registration

Extension can register native image metadata.

Examples:

- reflection classes,
- resources,
- runtime initialized classes,
- proxies,
- JNI,
- service providers.

Quarkus native tips mention `ReflectiveClassBuildItem` as an extension-friendly way to register reflection without JSON config.

Example:

```java
@BuildStep
ReflectiveClassBuildItem reflection() {
    return ReflectiveClassBuildItem.builder(PartnerDto.class)
            .methods()
            .fields()
            .build();
}
```

Resource example concept:

```java
@BuildStep
NativeImageResourceBuildItem resources() {
    return new NativeImageResourceBuildItem("templates/acme-audit.html");
}
```

Extension should make native compatibility automatic for users.

---

## 19. Generated Classes and Resources

Extension can generate:

- Java bytecode/classes,
- resources,
- service descriptors,
- config files,
- metadata,
- registries.

Use cases:

- generate client implementations,
- generate lookup tables,
- generate CDI beans,
- generate OpenAPI/contract metadata,
- generate reflection metadata,
- generate dev UI resources.

Generated classes avoid runtime reflection/dynamic proxies.

They are native-friendly.

But generation increases complexity.

Use only when it reduces runtime cost or developer boilerplate meaningfully.

---

## 20. Config in Extension

Quarkus config roots/categories matter.

Extension may expose config:

```properties
acme.audit.enabled=true
acme.audit.mode=strict
acme.audit.retention-days=365
```

Runtime config may be injected into runtime beans.

Build-time fixed config affects build output and cannot be freely changed at runtime.

Config design must be explicit:

- build-time config,
- build-and-run-time-fixed config,
- runtime config.

Avoid making runtime-varying behavior build-time accidentally.

Example:

```text
audit.enabled might be build-time if it adds/removes beans/interceptors.
audit.endpoint.url should be runtime.
```

Document each property.

---

## 21. Capabilities

Quarkus capabilities allow extensions to declare and query provided capabilities.

Example use:

```text
An extension requires REST capability.
Another extension provides it.
If missing, build fails early.
```

Capabilities build item can be injected into build steps to check if capability exists.

Use capabilities for extension integration:

- only configure REST filter if REST present,
- only configure Hibernate integration if ORM present,
- only configure Kafka integration if messaging present,
- fail if mutually exclusive providers exist.

This avoids runtime surprises.

---

## 22. Conditional Build Steps

Extension should be conditional.

Examples:

```text
If Hibernate ORM present, integrate audit entity listener.
If REST present, register filter.
If Micrometer present, register metrics.
If OIDC present, add principal resolver.
If native build, register native resources.
```

Do not assume every application has every extension.

Use capabilities/build items.

Fail fast with clear error if mandatory dependency missing.

---

## 23. Dev Mode and Hot Reload

Quarkus dev mode has special classloading and hot reload behavior.

Extension must tolerate:

- application classes reloaded,
- deployment module stays,
- runtime state reset,
- recorders rerun,
- generated classes updated,
- resources updated,
- config changes.

Quarkus extension maturity matrix notes that extensions may need special handling for dev mode and can add tests extending `QuarkusDevModeTest`.

If your extension works only in prod build but breaks dev mode, developer experience suffers.

---

## 24. Dev UI Integration

Quarkus Dev UI lets extensions expose developer diagnostics.

Useful internal extension Dev UI pages:

- registered audit event types,
- discovered annotations,
- generated clients,
- effective config,
- active feature flags,
- health integration,
- native metadata summary,
- security policy mapping,
- messaging channels.

Dev UI should not expose secrets.

It is for development diagnostics.

Official Dev UI guide covers how extension developers can integrate extension cards/pages/menu/footer.

---

## 25. Testing Extension

Testing extension requires multiple levels:

1. **Unit tests**
   - build item logic,
   - config parsing,
   - validation.

2. **QuarkusUnitTest**
   - extension in controlled application archive,
   - verify beans/resources/build behavior.

3. **QuarkusDevModeTest**
   - hot reload/dev mode behavior.

4. **QuarkusProdModeTest**
   - packaged application behavior.

5. **Native test**
   - native compatibility if extension supports native.

6. **Integration test with sample app**
   - realistic usage.

Extension maturity matrix mentions dev mode and native support as maturity dimensions.

A production-grade extension needs tests across modes.

---

## 26. `QuarkusUnitTest` Concept

Quarkus extension tests often use `QuarkusUnitTest`.

Conceptual:

```java
@RegisterExtension
static final QuarkusUnitTest config = new QuarkusUnitTest()
        .withApplicationRoot((jar) -> jar
                .addClass(MyResource.class)
                .addClass(Audited.class)
                .addAsResource("application.properties"));

@Test
void auditService_shouldBeAvailable() {
    assertNotNull(CDI.current().select(AuditService.class).get());
}
```

Use to verify:

- build steps,
- CDI registration,
- config,
- generated resources,
- failure messages,
- conditional behavior.

---

## 27. Failure Messages

Extension should fail at build time with clear messages.

Bad:

```text
NullPointerException at AcmeProcessor.java:42
```

Good:

```text
@Audited eventType must not be blank on com.acme.ApplicationService.approve().
Use @Audited(eventType = "APPLICATION_APPROVED").
```

Build-time validation is one of the main benefits of extensions.

Use it.

---

## 28. Internal Platform Extension Example: Audit

Goal:

```text
Standardize audit event registration and validation across services.
```

Runtime API:

```java
@Audited(eventType = "APPLICATION_APPROVED")
public void approve(...) {
    ...
}
```

Runtime module:

```text
Audited annotation
AuditService
AuditEvent
AuditInterceptor
AuditRecorder
AuditConfig
```

Deployment module:

```text
scan @Audited methods
validate eventType naming
register AuditInterceptor bean
register AuditService bean
generate audit registry
register native reflection for AuditEvent payloads
produce Dev UI summary
```

Benefits:

- no runtime scanning,
- event types validated at build,
- audit interceptor registered consistently,
- native metadata automatic,
- developer sees audit events in Dev UI.

---

## 29. Internal Platform Extension Example: Correlation

Goal:

```text
Enforce correlation ID filter and logging MDC convention.
```

Runtime:

- JAX-RS filter,
- REST client filter,
- MDC helper,
- correlation context.

Deployment:

- register filter if REST capability present,
- register REST client provider if REST client capability present,
- add health check maybe,
- validate config,
- expose Dev UI.

Config:

```properties
acme.correlation.header=X-Correlation-ID
acme.correlation.response-header-enabled=true
```

Benefit:

```text
Every service gets consistent correlation without copy-paste.
```

---

## 30. Internal Platform Extension Example: External Client Governance

Goal:

```text
Ensure every external REST client has timeout, retry, and correlation.
```

Deployment:

- scan `@RegisterRestClient`,
- validate config key,
- validate timeout config exists,
- register client filters,
- optionally register exception mapper,
- generate diagnostics.

Build-time failure:

```text
REST client com.acme.IdentityClient uses configKey identity-api
but acme.external.identity-api.timeout is missing.
```

This prevents production footgun.

---

## 31. Extension API Design

Extension runtime API should be:

- minimal,
- stable,
- explicit,
- not leak Quarkus deployment internals,
- easy to test,
- native-friendly,
- annotation/config names clear,
- backwards compatible.

Bad API:

```java
@Magic
```

Good API:

```java
@Audited(eventType = "APPLICATION_APPROVED", aggregate = "APPLICATION")
```

Avoid:

- hidden behavior,
- global static state,
- runtime classpath scanning,
- implicit network calls,
- surprise bean overrides,
- huge transitive dependencies.

---

## 32. Versioning Custom Extensions

Internal extension becomes platform dependency.

Need versioning:

- semantic version,
- compatibility matrix with Quarkus version,
- Java version compatibility,
- native support status,
- migration guide,
- deprecation policy,
- changelog.

If extension is used by 30 services, breaking change is costly.

Use platform BOM if possible.

---

## 33. Extension Dependency Hygiene

Deployment module dependencies should not leak to runtime.

Runtime artifact should be lean.

Avoid:

- putting deployment logic in runtime,
- runtime depending on `io.quarkus.deployment`,
- heavy libraries in runtime unnecessarily,
- conflicting transitive versions,
- shading without reason.

Check dependency tree.

---

## 34. Native Image Extension Responsibility

If extension wraps library, extension author should handle:

- reflection registration,
- resource inclusion,
- runtime init classes,
- proxy registration,
- service provider inclusion,
- native testing,
- docs.

Application developers should not need to add random native config for normal extension usage.

If they do, extension is incomplete.

---

## 35. Observability for Extension

Extension should expose:

- logs at build time if helpful,
- Dev UI diagnostics,
- runtime metrics if relevant,
- health checks if managing dependency,
- configuration visibility without secrets,
- meaningful error messages.

Example:

```text
acme_audit_events_registered_total
acme_audit_persist_failed_total
```

But do not over-instrument extension internals.

---

## 36. Production Checklist for Extension

### 36.1 Design

- [ ] Clear reason for extension.
- [ ] Runtime vs deployment split correct.
- [ ] API minimal/stable.
- [ ] Build-time value justified.
- [ ] No unnecessary magic.
- [ ] Config lifecycle documented.

### 36.2 Build-Time

- [ ] Build steps small.
- [ ] Build items well-designed.
- [ ] Jandex scanning used instead of runtime scanning.
- [ ] Clear build-time validation.
- [ ] Capabilities used for optional integration.
- [ ] Generated classes/resources deterministic.

### 36.3 Runtime

- [ ] Runtime artifact has no deployment dependencies.
- [ ] Beans registered intentionally.
- [ ] Unremovable only where needed.
- [ ] Runtime init vs static init correct.
- [ ] No build-time secrets.
- [ ] Thread safety reviewed.

### 36.4 Native

- [ ] Reflection registered if needed.
- [ ] Resources registered if needed.
- [ ] Proxies registered if needed.
- [ ] Runtime-init classes handled.
- [ ] Native tests pass.
- [ ] No user-side random native config required.

### 36.5 Dev Experience

- [ ] Dev mode works.
- [ ] Hot reload works.
- [ ] Dev UI optional but useful.
- [ ] Error messages actionable.
- [ ] Documentation and examples exist.

### 36.6 Governance

- [ ] Versioned.
- [ ] Compatibility matrix.
- [ ] Changelog.
- [ ] Migration guide.
- [ ] CI test matrix.
- [ ] Sample app.
- [ ] Release process.

---

## 37. Anti-Pattern Umum

### 37.1 Extension for Simple Utility

Overengineering.

### 37.2 Deployment Dependency in Runtime

Leaky architecture.

### 37.3 Runtime Scanning in Extension

Defeats Quarkus model.

### 37.4 Marking Everything Unremovable

Increases footprint and hides design issues.

### 37.5 Reflection Registration for Entire Package

Binary bloat and hidden dynamic behavior.

### 37.6 Static Init Reads Runtime State

Native bug/security risk.

### 37.7 No Dev Mode Test

Hot reload breaks.

### 37.8 No Native Test

Extension claims native support but fails native app.

### 37.9 Poor Build Error Messages

Developers hate the extension.

### 37.10 God Platform Extension

One extension controls everything and becomes unmaintainable.

### 37.11 Hidden Network Calls at Startup

Startup/readiness becomes fragile.

### 37.12 Breaking API Without Migration

All services suffer.

---

## 38. Latihan

### Latihan 1 — Extension Suitability

Untuk kebutuhan berikut, tentukan apakah perlu custom extension, library biasa, atau CDI starter:

1. Common string utility.
2. Standard audit annotation with build-time validation.
3. Shared REST client DTO.
4. Organization-wide correlation filter and REST client propagation.
5. Internal framework requiring native reflection metadata.
6. Feature flag helper.
7. Codegen from internal API schema.
8. Common exception classes.

Jelaskan alasannya.

### Latihan 2 — Audit Extension Design

Design extension `acme-audit-quarkus-extension`.

Tentukan:

- runtime module contents,
- deployment module contents,
- annotations,
- build items,
- build steps,
- synthetic/additional beans,
- native metadata,
- config,
- tests.

### Latihan 3 — Native Metadata

Library internal menggunakan reflection untuk DTO tertentu dan template resources.

Buat extension processor yang:

- scan annotation `@ExternalPayload`,
- register reflective classes,
- include `templates/**`,
- fail if DTO has no no-arg constructor jika library butuh.

### Latihan 4 — Capability Integration

Extension `acme-correlation` harus:

- register REST filter hanya jika REST extension ada,
- register REST client filter hanya jika REST client ada,
- register messaging propagation hanya jika messaging ada.

Buat design capability/build item usage.

### Latihan 5 — Extension Testing Matrix

Buat test matrix untuk extension internal:

- JVM mode,
- dev mode,
- prod mode,
- native mode,
- with REST,
- without REST,
- with OIDC,
- bad config,
- missing annotation value.

---

## 39. Ringkasan Invariants

Ingat invariants berikut:

```text
Quarkus extension is build-time augmentation plus runtime integration.
Runtime module is used by application.
Deployment module runs during build.
Application depends on runtime artifact, not deployment artifact.
Build steps communicate through build items.
Jandex replaces runtime classpath scanning.
Recorders bridge build-time knowledge to runtime initialization.
Synthetic beans allow build-time-generated CDI components.
Native metadata should be registered by extension, not app user.
Use capabilities for optional integration with other extensions.
Dev mode and native mode must be tested.
Extension is justified only when build-time integration gives real value.
```

---

## 40. Referensi Resmi yang Relevan

Referensi yang perlu dibaca saat implementasi nyata:

- Quarkus Writing Your Own Extension guide.
- Quarkus Building My First Extension guide.
- Quarkus CDI Integration Guide.
- Quarkus All Build Items reference.
- Quarkus Tips for Writing Native Applications.
- Quarkus Extension Metadata guide.
- Quarkus Extension Capabilities guide.
- Quarkus Extension Maturity Matrix.
- Quarkus Dev UI guide for extension developers.
- Quarkus Maven Tooling guide for extension runtime/deployment dependency model.
- Quarkus Native Reference guide.
- Quarkus Config Reference guide.

---

## 41. Kapan Seri Ini Lanjut ke Part Berikutnya

Part ini menyelesaikan custom extension engineering: deployment/runtime split, build steps, build items, recorders, synthetic beans, Jandex, native metadata, Dev UI, testing, dan governance.

Bagian berikutnya:

```text
Part 034 — Enterprise Architecture with Quarkus: Modular Monolith, Microservices, Regulatory Workflows
```

Di part berikutnya, fokus bergeser ke arsitektur enterprise:

- modular monolith vs microservices,
- bounded context,
- Quarkus module organization,
- regulatory workflow,
- audit/compliance,
- state machine,
- transaction boundary,
- outbox/event-driven integration,
- security/tenant boundary,
- operational ownership,
- migration strategy,
- production architecture blueprint.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-032.md">⬅️ Virtual Threads in Quarkus: Loom, Blocking Simplicity, Reactive Trade-Off</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-034.md">Enterprise Architecture with Quarkus: Modular Monolith, Microservices, Regulatory Workflows ➡️</a>
</div>
