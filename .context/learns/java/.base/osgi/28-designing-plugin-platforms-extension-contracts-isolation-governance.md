# Part 28 — Designing Plugin Platforms with OSGi: Extension Contracts, Isolation, Governance

> Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
> File: `28-designing-plugin-platforms-extension-contracts-isolation-governance.md`  
> Target: Java 8 sampai Java 25  
> Level: Advanced / Platform Engineering / Top 1% Software Engineer

---

## 0. Posisi Part Ini dalam Series

Sampai Part 27, kita sudah membangun fondasi besar:

1. mental model OSGi,
2. bundle lifecycle,
3. classloading,
4. dependency model,
5. resolver,
6. versioning,
7. service registry,
8. Declarative Services,
9. dynamic service topology,
10. Configuration Admin,
11. bnd,
12. Felix,
13. Equinox,
14. Karaf,
15. HTTP,
16. persistence,
17. messaging,
18. security,
19. JPMS interop,
20. Java 8–25 compatibility,
21. enterprise integration,
22. extender pattern,
23. fragments/native code,
24. testing,
25. observability,
26. performance,
27. provisioning/deployment.

Part 28 menggabungkan semuanya ke dalam satu problem nyata:

> Bagaimana mendesain **plugin platform** yang aman, evolvable, operable, dan defensible menggunakan OSGi?

Ini bukan lagi sekadar “bagaimana membuat bundle”.  
Ini tentang membangun **platform runtime** di mana pihak berbeda bisa menambahkan kemampuan baru tanpa merusak kernel, tanpa mengacaukan resolver, tanpa membocorkan dependency internal, dan tanpa membuat production menjadi tidak bisa diprediksi.

Di level engineer biasa, plugin berarti:

> “Kita load JAR secara dinamis.”

Di level platform engineer, plugin berarti:

> “Kita menyediakan kontrak ekstensi, lifecycle, versioning, isolation, governance, certification, observability, upgrade, rollback, dan security boundary yang eksplisit.”

OSGi sangat kuat untuk ini karena OSGi memang menyediakan:

- bundle identity,
- lifecycle,
- service registry,
- dynamic discovery,
- package-level visibility,
- versioned dependencies,
- resolver,
- repository metadata,
- configuration,
- capability/requirement model,
- extensibility via whiteboard/extender pattern.

Tetapi kekuatan ini juga membuat OSGi mudah disalahgunakan. Plugin platform yang buruk bisa lebih berbahaya daripada monolith biasa, karena failure-nya terjadi di runtime dan sering tampak seperti masalah acak.

---

## 1. Apa Itu Plugin Platform?

Plugin platform adalah sistem yang memiliki **kernel stabil** dan mengizinkan modul eksternal menambahkan behavior melalui extension contract yang dikontrol.

Contoh sederhana:

- IDE yang bisa ditambah plugin bahasa baru.
- CMS yang bisa ditambah renderer baru.
- Workflow engine yang bisa ditambah custom task handler.
- Payment platform yang bisa ditambah payment provider.
- Monitoring platform yang bisa ditambah collector/exporter.
- Regulatory case management yang bisa ditambah rule evaluator, escalation policy, document generator, connector, atau notification channel.

Plugin platform bukan hanya dynamic class loading.

Dynamic class loading hanya menjawab:

> Bagaimana bytecode dimuat?

Plugin platform menjawab:

> Siapa boleh menambahkan apa, lewat kontrak mana, dengan dependency apa, lifecycle apa, isolation apa, compatibility apa, permission apa, observability apa, rollback apa, dan support policy apa?

---

## 2. Plugin Platform vs Modular Monolith vs Microservices

Tiga model ini sering tercampur.

### 2.1 Modular Monolith

Modular monolith memecah aplikasi menjadi modul, tetapi biasanya modul dipasang sebagai bagian dari satu deployment artifact.

Karakteristik:

- module boundary ada di codebase/build,
- runtime biasanya statis,
- deployment bersama,
- dependency graph relatif tetap,
- tidak selalu mendukung install/uninstall dynamic.

Contoh:

```text
app.jar
 ├─ case-management module
 ├─ user-management module
 ├─ document module
 └─ report module
```

### 2.2 Microservices

Microservices memisahkan runtime menjadi proses/network boundary.

Karakteristik:

- isolation kuat lewat process/container,
- komunikasi network,
- failure isolation lebih baik,
- latency dan distributed complexity lebih tinggi,
- deployment independen.

Contoh:

```text
case-service      -> HTTP/Kafka -> document-service
workflow-service  -> HTTP/Kafka -> notification-service
```

### 2.3 Plugin Platform

Plugin platform berada di tengah:

- extensibility runtime,
- biasanya satu process/JVM,
- plugin bisa diinstall/update/uninstall,
- extension contract eksplisit,
- dependency dan class visibility diatur,
- isolation lebih kuat dari classpath biasa, tetapi lebih lemah dari process isolation.

Contoh:

```text
OSGi Runtime
 ├─ platform.kernel
 ├─ platform.api
 ├─ platform.spi
 ├─ plugin.validation.basic
 ├─ plugin.validation.advanced
 ├─ plugin.document.pdf
 └─ plugin.connector.external-agency
```

### 2.4 Decision Matrix

| Kebutuhan | Modular Monolith | OSGi Plugin Platform | Microservices |
|---|---:|---:|---:|
| Runtime extension | Lemah | Kuat | Sedang/kuat |
| Process isolation | Lemah | Lemah/sedang | Kuat |
| Classloader isolation | Lemah | Kuat | Tidak relevan |
| Hot deploy | Jarang | Native model | Bisa via deploy service |
| Latency in-process | Kuat | Kuat | Lemah |
| Distributed complexity | Rendah | Rendah/sedang | Tinggi |
| Plugin governance | Manual | Natural fit | Lewat API gateway/deploy policy |
| Multi-version library dalam satu JVM | Sulit | Bisa, dengan disiplin | Tidak perlu dalam JVM yang sama |
| Cocok untuk untrusted code | Tidak | Terbatas | Lebih cocok |

OSGi plugin platform cocok jika kamu butuh **runtime extensibility in-process** dengan dependency governance yang serius.

Kalau kebutuhan utamanya adalah menjalankan kode pihak ketiga yang tidak dipercaya, proses/container isolation biasanya lebih defensible daripada OSGi in-process sandbox, terutama di Java modern setelah Security Manager tidak lagi bisa dijadikan fondasi sandbox kuat.

---

## 3. Prinsip Utama: Plugin Bukan Dependensi Biasa

Kesalahan umum:

```text
host depends on plugin
```

Ini salah untuk platform plugin.

Yang benar:

```text
plugin depends on platform API/SPI
host discovers plugin via service registry or extender metadata
```

Host tidak boleh compile-time depend pada plugin konkret.

Struktur sehat:

```text
platform-api
   ↑
plugin-a
plugin-b
plugin-c

platform-kernel discovers implementations through OSGi service registry
```

Atau:

```text
platform-spi
   ↑
rule-plugin-a
rule-plugin-b

rule-engine tracks RuleProvider services
```

Kernel menyediakan kontrak. Plugin mengimplementasikan kontrak. Kernel menemukan plugin secara dinamis.

Ini mirip Dependency Inversion Principle, tetapi diterapkan pada runtime module system.

---

## 4. Kernel, API, SPI, dan Plugin Boundary

Plugin platform OSGi yang sehat biasanya memiliki beberapa jenis bundle.

### 4.1 Kernel Bundle

Kernel adalah runtime inti.

Tanggung jawab:

- bootstrap platform,
- menyediakan orchestration utama,
- memuat registry layanan platform,
- mengelola lifecycle plugin,
- menghubungkan subsystem,
- menyediakan diagnostics,
- memastikan invariant platform.

Kernel sebaiknya tidak mengekspos package implementasi.

Contoh bundle:

```text
com.acme.platform.kernel
```

### 4.2 API Bundle

API bundle berisi contract yang digunakan oleh plugin dan host.

Isi:

- interface service publik,
- DTO stabil,
- enum stabil,
- exception contract,
- annotation contract,
- event contract.

Contoh:

```text
com.acme.platform.api
```

Package:

```text
com.acme.platform.api.casework
com.acme.platform.api.document
com.acme.platform.api.validation
```

API bundle harus:

- kecil,
- stabil,
- versioned,
- minim dependency,
- bebas framework internal,
- bebas implementation class,
- tidak bergantung ke plugin.

### 4.3 SPI Bundle

SPI adalah contract untuk extension provider.

API sering dipakai oleh consumer umum. SPI dipakai oleh plugin implementor.

Contoh:

```text
com.acme.platform.spi
```

Package:

```text
com.acme.platform.spi.validation
com.acme.platform.spi.rendering
com.acme.platform.spi.connector
```

SPI biasanya berisi:

- `RuleProvider`,
- `DocumentRenderer`,
- `ExternalAgencyConnector`,
- `EscalationPolicyProvider`,
- `WorkflowTaskHandler`,
- `NotificationChannel`,
- `PluginHealthContributor`.

### 4.4 Internal Implementation Bundle

Implementation bundle berisi detail internal.

Contoh:

```text
com.acme.platform.validation.impl
com.acme.platform.document.impl
com.acme.platform.connector.impl
```

Package internal tidak boleh diekspor.

Di bnd:

```properties
Private-Package: com.acme.platform.validation.internal.*
Export-Package: com.acme.platform.spi.validation;version=1.4.0
```

### 4.5 Plugin Bundle

Plugin bundle adalah bundle ekstensi.

Contoh:

```text
com.acme.plugins.validation.basic
com.acme.plugins.validation.risk-score
com.acme.plugins.rendering.pdf
com.acme.plugins.connector.onemap
```

Plugin bundle:

- import API/SPI platform,
- register service extension,
- punya metadata plugin,
- punya config sendiri,
- punya health sendiri,
- punya compatibility requirement,
- tidak boleh mengakses internal host.

---

## 5. Diagram Boundary yang Benar

```text
+---------------------------------------------------------------+
|                        OSGi Framework                         |
|                                                               |
|  +------------------+       +------------------------------+  |
|  | platform.api     |<------| plugin.validation.risk       |  |
|  | platform.spi     |<------| plugin.document.pdf          |  |
|  +------------------+       | plugin.connector.external    |  |
|          ^                  +------------------------------+  |
|          |                                  |                 |
|          | imports API/SPI                  | registers       |
|          |                                  v                 |
|  +------------------+       +------------------------------+  |
|  | platform.kernel  |<------| OSGi Service Registry        |  |
|  +------------------+       +------------------------------+  |
|          |                                                    |
|          v                                                    |
|  +------------------+                                        |
|  | platform.impl    |                                        |
|  +------------------+                                        |
+---------------------------------------------------------------+
```

Yang tidak boleh:

```text
platform.kernel ---> plugin.validation.risk
platform.impl    ---> plugin.document.pdf
plugin           ---> platform.impl.internal
```

Jika kernel compile-time depend pada plugin konkret, itu bukan plugin architecture. Itu hanya modular monolith dengan nama plugin.

---

## 6. Extension Contract: Bentuk-Bentuk Ekstensi

OSGi menyediakan beberapa model extension. Pilih berdasarkan sifat behavior.

### 6.1 Service Contract

Plugin register service.

Contoh:

```java
public interface DocumentRenderer {
    String format();
    RenderedDocument render(RenderRequest request) throws RenderException;
}
```

Plugin:

```java
@Component(service = DocumentRenderer.class, property = {
    "format=pdf",
    "region=sg",
    "renderer.version=1.0"
})
public class PdfDocumentRenderer implements DocumentRenderer {
    @Override
    public String format() {
        return "pdf";
    }

    @Override
    public RenderedDocument render(RenderRequest request) {
        // render implementation
    }
}
```

Host:

```java
@Component
public class RenderingService {
    private final List<DocumentRenderer> renderers = new CopyOnWriteArrayList<>();

    @Reference(
        service = DocumentRenderer.class,
        cardinality = ReferenceCardinality.MULTIPLE,
        policy = ReferencePolicy.DYNAMIC,
        policyOption = ReferencePolicyOption.GREEDY
    )
    void bindRenderer(DocumentRenderer renderer, Map<String, Object> props) {
        renderers.add(renderer);
    }

    void unbindRenderer(DocumentRenderer renderer) {
        renderers.remove(renderer);
    }
}
```

Cocok untuk:

- rule evaluator,
- renderer,
- connector,
- validator,
- handler,
- command,
- codec,
- adapter.

### 6.2 Whiteboard Contract

Plugin tidak dipanggil lewat registry lookup langsung oleh consumer. Plugin mendaftarkan dirinya, lalu manager/whiteboard mengambil semua service yang cocok.

Contoh:

```text
Plugin registers ValidationRule service
ValidationEngine tracks all ValidationRule services
```

Whiteboard cocok ketika:

- banyak provider,
- provider bisa muncul/hilang,
- host mengelola orchestration,
- provider tidak perlu tahu manager,
- absence of manager tidak membuat provider gagal.

### 6.3 Extender Contract

Plugin membawa metadata. Extender membaca metadata itu dan membangun runtime behavior.

Contoh:

```text
Bundle contains: META-INF/acme/rules/customer-risk.json
RuleExtender tracks bundles containing this resource
RuleExtender registers compiled RuleSet service
```

Cocok ketika:

- plugin lebih deklaratif,
- non-Java authoring diinginkan,
- ada file descriptor,
- perlu validation/certification sebelum service expose,
- plugin lifecycle harus dikontrol oleh platform.

### 6.4 Event Contract

Plugin subscribe/publish event.

Cocok untuk:

- notification,
- audit hooks,
- asynchronous side effect,
- non-critical enrichment.

Tidak cocok untuk:

- mandatory transactional behavior,
- behavior yang harus mengembalikan keputusan sinkron,
- flow utama yang butuh deterministic ordering tanpa engine eksplisit.

### 6.5 Capability Contract

Plugin mendeklarasikan capability.

Contoh:

```properties
Provide-Capability: \
  acme.plugin; \
    plugin.type="validation"; \
    plugin.id="risk-score"; \
    plugin.api.version:Version="1.2.0"; \
    region:List<String>="sg,id"
```

Runtime/provisioner bisa memilih plugin berdasarkan capability.

Cocok untuk:

- provisioning,
- compatibility matching,
- repository selection,
- product variant,
- tenant-specific runtime.

---

## 7. Memilih Model Ekstensi

| Kebutuhan | Model yang Cocok |
|---|---|
| Implementasi Java dipanggil sinkron | Service contract |
| Banyak provider dinamis | Whiteboard |
| Plugin deklaratif berbasis metadata | Extender |
| Side effect async | Event contract |
| Provisioning dan compatibility metadata | Capability contract |
| Perlu lifecycle/config/health per plugin | Service + metadata + health service |
| Perlu tenant-specific plugin set | Capability + Config Admin + resolver/provisioning |
| Perlu untrusted execution | External process/container, bukan hanya OSGi |

Top 1% engineer tidak memilih pattern karena familiar. Mereka memilih berdasarkan lifecycle, failure mode, dan governance requirement.

---

## 8. Plugin Identity

Plugin harus punya identity yang stabil.

Minimal identity:

```text
plugin.id
plugin.version
plugin.vendor
plugin.type
plugin.api.compatibility
plugin.display.name
```

Di OSGi, ada bundle identity:

```text
Bundle-SymbolicName
Bundle-Version
```

Tetapi bundle identity belum tentu cukup untuk business/plugin identity.

Contoh:

```properties
Bundle-SymbolicName: com.acme.plugins.validation.risk
Bundle-Version: 2.3.1
Provide-Capability: \
  acme.plugin; \
    plugin.id="risk-score-validation"; \
    plugin.type="validation"; \
    plugin.version:Version="2.3.1"; \
    plugin.vendor="Acme"; \
    acme.spi.validation.version:Version="1.4.0"
```

Kenapa perlu dua identity?

- Bundle identity dipakai framework.
- Plugin identity dipakai platform governance.
- Satu bundle bisa menyediakan beberapa plugin capability.
- Satu plugin logical bisa tersebar dalam beberapa bundle.
- Business audit biasanya butuh plugin ID yang stabil, bukan sekadar symbolic name.

---

## 9. Plugin Metadata

Plugin metadata dapat disimpan di:

1. manifest capability,
2. service properties,
3. descriptor file,
4. Config Admin,
5. repository metadata,
6. platform registry database.

### 9.1 Manifest Capability

Cocok untuk metadata statis yang memengaruhi resolving/provisioning.

```properties
Provide-Capability: \
  acme.plugin; \
    plugin.id="case-escalation-basic"; \
    plugin.type="escalation-policy"; \
    plugin.version:Version="1.0.0"
```

### 9.2 Service Properties

Cocok untuk runtime selection.

```java
@Component(service = EscalationPolicy.class, property = {
    "policy.id=basic-sla",
    "case.type=complaint",
    "priority=100"
})
public class BasicSlaEscalationPolicy implements EscalationPolicy {
}
```

### 9.3 Descriptor File

Cocok untuk metadata kaya.

```json
{
  "pluginId": "risk-score-validation",
  "pluginType": "validation",
  "version": "2.3.1",
  "requiresPlatform": "[1.4.0,2.0.0)",
  "permissions": [
    "case.read",
    "risk-score.compute"
  ],
  "configurationSchema": "META-INF/acme/config/risk-score.schema.json",
  "healthCheck": true
}
```

### 9.4 Config Admin

Cocok untuk operator-defined runtime behavior.

```properties
risk.threshold.high=85
risk.threshold.medium=50
enabled=true
```

### 9.5 Platform Registry Database

Cocok untuk:

- tenant enablement,
- approval status,
- certification status,
- installation audit,
- rollout stage,
- operator notes,
- disable reason.

---

## 10. Plugin Lifecycle

OSGi bundle lifecycle bukan otomatis sama dengan plugin lifecycle.

Bundle lifecycle:

```text
INSTALLED -> RESOLVED -> STARTING -> ACTIVE -> STOPPING -> RESOLVED -> UNINSTALLED
```

Plugin lifecycle biasanya lebih kaya:

```text
DISCOVERED
  -> VALIDATING
  -> REJECTED
  -> INSTALLED
  -> CONFIG_REQUIRED
  -> READY
  -> ENABLED
  -> DEGRADED
  -> DISABLED
  -> RETIRED
  -> REMOVED
```

### 10.1 Kenapa Perlu Plugin Lifecycle Sendiri?

Karena `ACTIVE` hanya berarti bundle berhasil start.

`ACTIVE` tidak berarti:

- plugin valid,
- plugin approved,
- config lengkap,
- dependency eksternal reachable,
- schema kompatibel,
- health OK,
- tenant boleh memakai plugin,
- plugin sudah melewati certification.

Jadi jangan pernah menjadikan bundle `ACTIVE` sebagai satu-satunya sinyal readiness plugin.

### 10.2 Plugin Lifecycle State Machine

```text
             +-------------+
             | DISCOVERED  |
             +-------------+
                    |
                    v
             +-------------+
             | VALIDATING  |
             +-------------+
              |           |
              v           v
       +----------+   +-----------+
       | REJECTED |   | INSTALLED |
       +----------+   +-----------+
                          |
                          v
                  +----------------+
                  | CONFIG_REQUIRED|
                  +----------------+
                          |
                          v
                     +---------+
                     | READY   |
                     +---------+
                          |
                          v
                    +----------+
                    | ENABLED  |
                    +----------+
                     |      |
                     v      v
              +---------+  +----------+
              | DEGRADED|  | DISABLED |
              +---------+  +----------+
                     \        /
                      v      v
                     +---------+
                     | RETIRED |
                     +---------+
                          |
                          v
                     +---------+
                     | REMOVED |
                     +---------+
```

### 10.3 Lifecycle Operations

| Operation | Meaning |
|---|---|
| install | make bundle/resource available |
| resolve | satisfy dependencies |
| start | activate bundle runtime |
| validate | verify plugin metadata/config/API |
| enable | expose plugin to business flow |
| disable | stop routing new work to plugin |
| drain | wait for in-flight work to finish |
| update | replace plugin version |
| rollback | restore previous plugin/runtime set |
| retire | mark no longer supported |
| uninstall | remove from runtime |

---

## 11. Host/Plugin Contract Design

A plugin contract must be boring, stable, and explicit.

Bad contract:

```java
public interface RulePlugin {
    Object execute(Object input);
}
```

Why bad:

- no domain semantics,
- no error contract,
- no versioning,
- no observability,
- no timeout expectation,
- no thread-safety contract,
- no compatibility guarantee,
- no audit context,
- no deterministic behavior.

Better:

```java
public interface ValidationRule {
    RuleDescriptor descriptor();

    ValidationResult validate(ValidationContext context, CaseSnapshot caseSnapshot)
        throws ValidationException;
}
```

Where:

```java
public final class RuleDescriptor {
    private final String ruleId;
    private final Version ruleVersion;
    private final String displayName;
    private final Set<String> supportedCaseTypes;
    private final boolean deterministic;
    private final Duration expectedMaxDuration;
}
```

```java
public final class ValidationContext {
    private final String correlationId;
    private final String tenantId;
    private final Instant evaluationTime;
    private final Locale locale;
    private final Map<String, String> attributes;
}
```

```java
public final class ValidationResult {
    private final String ruleId;
    private final Decision decision;
    private final List<ValidationMessage> messages;
    private final Map<String, Object> auditFacts;
}
```

Good contracts specify:

- input boundary,
- output boundary,
- exceptions,
- timeout expectation,
- thread-safety,
- idempotency,
- determinism,
- audit semantics,
- compatibility policy,
- configuration semantics,
- observability expectation.

---

## 12. Contract Types: API vs SPI vs Internal

### 12.1 API

Used by application consumers.

Example:

```java
public interface CaseService {
    CaseView getCase(String caseId);
}
```

### 12.2 SPI

Implemented by plugin providers.

Example:

```java
public interface CaseActionProvider {
    List<CaseAction> availableActions(CaseActionContext context);
}
```

### 12.3 Internal

Used only inside platform implementation.

Example:

```java
class DefaultCaseActionRouter {
}
```

Never export internal package.

```properties
Private-Package: com.acme.platform.case.internal.*
```

Do not let plugin import:

```text
com.acme.platform.case.internal
```

Even if it “works” during development, it destroys platform governance.

---

## 13. Package Boundary Strategy

Good plugin platform usually has package layout like:

```text
com.acme.platform.api.*
com.acme.platform.spi.*
com.acme.platform.event.*
com.acme.platform.config.*
com.acme.platform.internal.*
```

Export only:

```text
com.acme.platform.api.*
com.acme.platform.spi.*
com.acme.platform.event.*
```

Private:

```text
com.acme.platform.internal.*
```

Avoid:

```text
com.acme.platform.common.*
```

Why?

`common` becomes dumping ground. Once exported, everyone depends on it. It becomes impossible to evolve.

Prefer specific packages:

```text
com.acme.platform.api.casework
com.acme.platform.api.document
com.acme.platform.spi.validation
com.acme.platform.spi.rendering
```

---

## 14. API Surface Minimization

A plugin API should be intentionally small.

Bad:

```java
public interface CaseRepository {
    EntityManager entityManager();
    Connection connection();
    InternalCaseEntity findEntity(String id);
}
```

This leaks:

- persistence technology,
- internal entity,
- transaction model,
- database coupling,
- classloader coupling.

Better:

```java
public interface CaseReadModel {
    CaseSnapshot getSnapshot(CaseId caseId);
}
```

Plugin receives stable DTO, not internal entity.

Why?

- DTO can be versioned.
- Entity model can evolve.
- Persistence provider can change.
- Transaction boundary is controlled by host.
- Plugin cannot accidentally flush DB state.

---

## 15. DTO Design for Plugin Boundaries

DTOs crossing plugin boundaries should be:

- immutable,
- serializable if needed,
- free of lazy proxies,
- free of framework annotations unless part of contract,
- versioned,
- documented,
- behavior-light,
- semantically explicit.

Example:

```java
public final class CaseSnapshot {
    private final String caseId;
    private final String caseType;
    private final String status;
    private final Instant submittedAt;
    private final Map<String, String> facts;

    // constructor + getters
}
```

Avoid passing:

- JPA entities,
- Hibernate proxies,
- servlet request,
- Spring application context,
- OSGi `BundleContext`,
- raw database connection,
- internal mutable map,
- classloader-sensitive object.

---

## 16. Error Contract

Plugin failure must not be ambiguous.

Bad:

```java
throw new RuntimeException("failed");
```

Better:

```java
public class PluginExecutionException extends Exception {
    private final String pluginId;
    private final ErrorCategory category;
    private final boolean retryable;
}
```

Error categories:

```text
CONFIGURATION_ERROR
INPUT_VALIDATION_ERROR
TEMPORARY_EXTERNAL_DEPENDENCY
PERMANENT_EXTERNAL_DEPENDENCY
TIMEOUT
BUG
UNSUPPORTED_VERSION
PERMISSION_DENIED
```

Design questions:

- Should platform retry?
- Should plugin be disabled?
- Should case processing continue degraded?
- Should incident be opened?
- Should operator be notified?
- Should audit record include partial result?

Without error taxonomy, plugin platforms become operationally painful.

---

## 17. Timeout and Latency Contract

Every plugin contract should define latency expectation.

Example:

```java
public interface ExternalAgencyConnector {
    ConnectorResponse query(ConnectorRequest request, ConnectorExecutionContext context)
        throws ConnectorException;
}
```

Context includes deadline:

```java
public final class ConnectorExecutionContext {
    private final Instant deadline;
    private final String correlationId;
    private final CancellationToken cancellationToken;
}
```

Why not let plugin decide everything?

Because platform owns SLA.

Plugin must respect:

- request deadline,
- cancellation,
- thread interruption if applicable,
- idempotency,
- retry policy,
- circuit breaker decision.

OSGi service call is in-process and synchronous by default. That makes it easy to accidentally block platform threads.

---

## 18. Thread-Safety Contract

OSGi services are often singleton services.

Plugin implementor must know whether service object may be called concurrently.

Contract should state:

```text
Implementations must be thread-safe. The platform may call validate() concurrently for different cases.
```

Or:

```text
Implementations are not required to be thread-safe. The platform will create one service instance per bundle using prototype scope.
```

In Declarative Services:

```java
@Component(service = RuleEvaluator.class, scope = ServiceScope.PROTOTYPE)
public class StatefulRuleEvaluator implements RuleEvaluator {
}
```

But prototype scope has lifecycle and lookup implications. Use intentionally.

---

## 19. Service Selection Strategy

When many plugins implement same SPI, platform needs deterministic selection.

Selection inputs:

- service properties,
- service ranking,
- plugin metadata,
- tenant config,
- case type,
- version compatibility,
- health status,
- approval status,
- feature flag,
- rollout percentage.

Avoid relying only on `service.ranking` for business routing.

`service.ranking` is useful for technical preference, but business routing should be explicit.

Example:

```java
public final class PluginRoute {
    private final String pluginId;
    private final String tenantId;
    private final String caseType;
    private final int priority;
    private final boolean enabled;
}
```

Then runtime router chooses from active service snapshot.

---

## 20. Atomic Service Snapshot Pattern

Dynamic services can appear/disappear. During a request, you want consistent view.

Pattern:

```java
@Component
public class ValidationPluginRegistry {
    private final AtomicReference<List<ValidationRuleEntry>> snapshot =
        new AtomicReference<>(List.of());

    @Reference(
        service = ValidationRule.class,
        cardinality = ReferenceCardinality.MULTIPLE,
        policy = ReferencePolicy.DYNAMIC
    )
    void bind(ValidationRule rule, Map<String, Object> props) {
        update(old -> add(old, new ValidationRuleEntry(rule, props)));
    }

    void unbind(ValidationRule rule) {
        update(old -> remove(old, rule));
    }

    public List<ValidationRuleEntry> currentRules() {
        return snapshot.get();
    }

    private void update(Function<List<ValidationRuleEntry>, List<ValidationRuleEntry>> f) {
        while (true) {
            List<ValidationRuleEntry> oldValue = snapshot.get();
            List<ValidationRuleEntry> newValue = List.copyOf(f.apply(oldValue));
            if (snapshot.compareAndSet(oldValue, newValue)) {
                return;
            }
        }
    }
}
```

Benefit:

- readers never lock,
- each request sees consistent list,
- bind/unbind does not mutate list in-place,
- no `ConcurrentModificationException`,
- no half-updated topology.

---

## 21. Graceful Disable and Draining

Unregistering a plugin while requests are executing can cause inconsistency.

Do not do this:

```text
operator disables plugin -> immediately unregister service -> in-flight flow fails weirdly
```

Better lifecycle:

```text
ENABLED
  -> DRAINING
  -> DISABLED
```

DRAINING means:

- no new work routed,
- existing work can finish,
- timeout applies,
- metrics record drain duration,
- forced stop possible.

A registry entry can have state:

```java
enum PluginRuntimeState {
    ENABLED,
    DRAINING,
    DISABLED,
    DEGRADED
}
```

Routing checks state before selecting.

---

## 22. Plugin Configuration

Each plugin needs config boundary.

Bad:

```text
global.properties
  timeout=30
  endpoint=https://...
```

Better:

```text
PID: com.acme.plugin.connector.onemap
  enabled=true
  endpoint=https://api.example
  connect.timeout.ms=1000
  read.timeout.ms=3000
  retry.max=2
```

For multiple instances:

```text
Factory PID: com.acme.plugin.connector.external-agency
Instance: agency-a
Instance: agency-b
```

Design config as part of plugin lifecycle:

```text
bundle ACTIVE + config missing = CONFIG_REQUIRED, not READY
bundle ACTIVE + invalid config = REJECTED or CONFIG_ERROR
bundle ACTIVE + valid config + health OK = READY
```

---

## 23. Configuration Schema Governance

For serious plugin platform, config schema should be versioned.

Example:

```json
{
  "schemaVersion": "1.2.0",
  "pluginId": "risk-score-validation",
  "properties": {
    "threshold.high": {
      "type": "integer",
      "minimum": 0,
      "maximum": 100,
      "required": true
    },
    "mode": {
      "type": "string",
      "enum": ["STRICT", "WARN", "DISABLED"]
    }
  }
}
```

Important:

- validate before enabling plugin,
- reject unknown dangerous properties,
- provide safe defaults,
- log/audit config changes,
- support migration from old schema,
- test config compatibility.

---

## 24. Plugin Health Model

Bundle active is not health.

A plugin health model can include:

```text
UP
DEGRADED
DOWN
CONFIG_ERROR
UNSUPPORTED
DISABLED
UNKNOWN
```

Health should expose:

- plugin ID,
- plugin version,
- bundle symbolic name,
- bundle version,
- current state,
- dependency state,
- config state,
- last failure,
- last successful execution,
- in-flight count,
- rejection reason.

Example SPI:

```java
public interface PluginHealthContributor {
    PluginHealth health();
}
```

Or platform can wrap each plugin invocation and infer health.

Be careful: health check itself must not overload external systems.

---

## 25. Observability Contract

A plugin should not be a black box.

Minimum observability:

- invocation count,
- success count,
- failure count,
- timeout count,
- latency histogram,
- last error category,
- current state,
- enabled/disabled flag,
- version,
- config version,
- route decisions,
- audit facts.

Correlation propagation:

```text
request correlation id -> plugin execution context -> logs/metrics/audit/events
```

Plugin logs should include:

```text
plugin.id
plugin.version
bundle.symbolicName
bundle.version
correlation.id
tenant.id
case.id if allowed
operation
```

But avoid leaking PII or secrets.

---

## 26. Plugin Permission Model

Even if OSGi in modern Java cannot be treated as strong sandbox for arbitrary untrusted code, you still need platform-level permissions.

Example permissions:

```text
case.read
case.write
document.render
document.store
external.call.onemap
external.call.registry
audit.write
workflow.transition
notification.send
```

Plugin declares requested permissions:

```json
{
  "pluginId": "risk-score-validation",
  "requestedPermissions": [
    "case.read",
    "audit.write"
  ]
}
```

Operator approves:

```json
{
  "pluginId": "risk-score-validation",
  "grantedPermissions": [
    "case.read",
    "audit.write"
  ],
  "approvedBy": "platform-admin",
  "approvedAt": "2026-06-18T00:00:00Z"
}
```

Platform checks permission at service boundary:

```java
public final class PermissionCheckingCaseReadModel implements CaseReadModel {
    @Override
    public CaseSnapshot getSnapshot(CaseId id) {
        PluginExecutionContext ctx = PluginExecutionContext.current();
        permissions.require(ctx.pluginId(), "case.read");
        return delegate.getSnapshot(id);
    }
}
```

This is not a JVM sandbox. It is an application-level access control layer.

---

## 27. Trust Levels

Classify plugins.

| Trust Level | Description | Recommended Isolation |
|---|---|---|
| Platform-owned | Built by same team | OSGi in-process OK |
| Partner-certified | Reviewed/certified | OSGi with strict governance |
| Customer-authored | Less trusted | Prefer process/container boundary for risky operations |
| Third-party arbitrary | Untrusted | Do not run in same JVM as privileged platform |

A defensible platform does not pretend all plugin code is equally trusted.

---

## 28. Supply-Chain Governance

Plugin governance starts before runtime.

Controls:

- source ownership,
- code review,
- dependency scan,
- SBOM,
- license scan,
- signature,
- reproducible build,
- baseline check,
- resolver test,
- certification test suite,
- vulnerability policy,
- deprecation policy,
- repository promotion.

Repository stages:

```text
DEV_REPO -> CERTIFIED_REPO -> STAGING_REPO -> PRODUCTION_REPO
```

Only production runtime should pull from production-approved repository.

Avoid:

```text
production runtime can install arbitrary Maven artifact by URL
```

That is not a platform. That is remote code execution with ceremony.

---

## 29. Plugin Certification

Certification proves plugin conforms to platform contract.

Certification should check:

### 29.1 Metadata

- plugin ID exists,
- version valid,
- type valid,
- vendor valid,
- required API range valid,
- permissions declared,
- config schema present.

### 29.2 Resolver

- all imports resolved,
- no forbidden imports,
- no internal host package imports,
- no split package,
- no dynamic import unless approved,
- no broad optional imports.

### 29.3 API Compatibility

- imports allowed API/SPI versions,
- does not depend on internal packages,
- baseline-compatible if plugin itself exposes API.

### 29.4 Runtime Behavior

- starts cleanly,
- registers expected services,
- handles config missing,
- handles config update,
- handles service dependency disappearing,
- can be disabled,
- can be uninstalled,
- no thread leak,
- no classloader leak after refresh.

### 29.5 Operational Behavior

- metrics emitted,
- health check works,
- logs include correlation,
- no secrets logged,
- failure classified,
- timeout respected.

### 29.6 Security

- dependency vulnerability scan,
- no forbidden package access,
- no filesystem/network access unless permissioned,
- no reflective JDK internal access,
- no unsafe agent/weaving unless approved.

---

## 30. Forbidden Imports Policy

A serious plugin platform should define forbidden imports.

Example:

```text
Forbidden:
- com.acme.platform.internal.*
- org.hibernate.internal.*
- sun.*
- com.sun.* unless specifically allowed
- jdk.internal.*
- org.osgi.framework.launch.* for normal plugin
- java.lang.instrument
- unsafe native/JNA packages unless approved
```

Enforce using:

- bnd analysis,
- CI rule,
- manifest inspection,
- bytecode scanning,
- repository admission gate.

---

## 31. Version Compatibility Policy

Plugin platform needs explicit compatibility policy.

Example:

```text
Platform API package version: 1.4.0
Plugin imports: [1.4,2)
```

Policy:

- patch version: bug fix, no contract change,
- minor version: backward-compatible addition,
- major version: breaking change,
- provider packages use tighter ranges where necessary,
- internal packages are not imported.

For plugin SPI:

```text
com.acme.platform.spi.validation;version="1.4.0"
```

Plugin import:

```properties
Import-Package: \
  com.acme.platform.spi.validation;version="[1.4,2)", \
  com.acme.platform.api.casework;version="[2.1,3)"
```

Platform can run multiple major API versions if necessary:

```text
com.acme.platform.spi.validation.v1
com.acme.platform.spi.validation.v2
```

But do not do this casually; multiple contract generations increase runtime complexity.

---

## 32. Deprecation Policy

Without deprecation policy, plugin platforms ossify.

Deprecation lifecycle:

```text
ACTIVE -> DEPRECATED -> REMOVAL_SCHEDULED -> REMOVED
```

Communicate:

- deprecated API/SPI package,
- replacement,
- removal target version,
- migration guide,
- compatibility test,
- last supported runtime.

Example:

```java
@Deprecated(forRemoval = true, since = "2.3")
public interface LegacyRuleProvider {
}
```

OSGi package version should reflect compatibility impact.

---

## 33. Multi-Version Plugin Support

Sometimes production needs old and new plugins simultaneously.

OSGi can support multiple versions of the same package if wiring is consistent.

Example:

```text
plugin-a imports spi.validation [1.0,2)
plugin-b imports spi.validation [2.0,3)
```

Possible architecture:

```text
platform.spi.validation.v1 bundle
platform.spi.validation.v2 bundle
adapter.v1-to-v2 bundle
```

But cost:

- duplicate contract support,
- adapter complexity,
- testing matrix grows,
- resolver graph grows,
- operational diagnostics harder.

Use multi-version support for migration windows, not permanent lifestyle.

---

## 34. Plugin Dependency Policy

Can plugins depend on other plugins?

Options:

### 34.1 No Plugin-to-Plugin Dependency

Simplest and safest.

```text
plugin -> platform API/SPI only
```

Pros:

- simpler resolver,
- easier certification,
- easier uninstall,
- less coupling.

Cons:

- shared utilities need platform/common API,
- plugin ecosystem less expressive.

### 34.2 Plugin-to-Plugin via API Bundle

A plugin may expose API bundle.

```text
plugin-a.api
plugin-a.impl
plugin-b imports plugin-a.api
```

Requires governance:

- API versioning,
- certification,
- deprecation,
- lifecycle dependency,
- uninstall protection.

### 34.3 Arbitrary Plugin-to-Plugin Dependency

Dangerous.

Avoid unless you are building an ecosystem like Eclipse IDE with mature tooling and governance.

---

## 35. Shared Libraries Policy

Should each plugin embed dependencies, or share platform-provided libraries?

### 35.1 Platform-Provided Shared Library

```text
platform exports com.fasterxml.jackson.*
plugins import it
```

Pros:

- less duplication,
- consistent version,
- easier patching security issue once.

Cons:

- plugin compatibility tied to platform library,
- upgrade can break many plugins,
- platform API may leak library types.

### 35.2 Plugin-Embedded Library

```text
plugin embeds its own library privately
```

Pros:

- plugin controls dependency version,
- less platform coupling,
- multiple versions possible.

Cons:

- bigger runtime,
- duplicate classes,
- security patch per plugin,
- class identity issues if library types cross boundary.

### 35.3 Rule

If library types appear in public plugin contract, platform owns the version.

If library is implementation detail, plugin may embed privately.

Bad contract:

```java
JsonNode evaluate(JsonNode input);
```

This forces Jackson type across boundary.

Better:

```java
ValidationResult evaluate(CaseSnapshot input);
```

Keep third-party library types out of SPI unless deliberately standardized.

---

## 36. Isolation Model

OSGi provides:

- package visibility isolation,
- classloader isolation,
- lifecycle isolation,
- dependency graph isolation.

OSGi does not fully provide:

- CPU isolation,
- memory isolation,
- thread isolation,
- filesystem isolation,
- network isolation,
- malicious code isolation,
- process crash isolation.

A plugin can still:

- spawn threads,
- allocate memory,
- block CPU,
- call `System.exit` unless blocked externally,
- use reflection if allowed,
- access filesystem/network via JVM permissions/environment,
- deadlock shared locks,
- corrupt shared mutable objects passed by host.

So isolation strategy must be layered.

### 36.1 In-Process Trusted Plugin

Use OSGi only.

### 36.2 Semi-Trusted Plugin

Use OSGi plus:

- certification,
- permission checks,
- service wrappers,
- timeout,
- circuit breaker,
- config governance,
- dependency scan,
- runtime monitoring.

### 36.3 Untrusted Plugin

Use out-of-process execution:

```text
platform JVM -> RPC -> plugin worker/container
```

OSGi may still be used inside plugin worker, but not as sole security boundary.

---

## 37. Resource Control

Because OSGi runs in one JVM, platform must control plugin resource usage.

Controls:

- dedicated executor per plugin type,
- bounded queue,
- timeout,
- circuit breaker,
- bulkhead,
- memory-sensitive payload size limit,
- rate limit,
- cancellation,
- health degradation,
- disable policy.

Example:

```text
validation plugins -> bounded CPU executor
external connector plugins -> bounded IO executor
rendering plugins -> separate process for heavy documents
```

Do not let arbitrary plugin run on request thread if execution can block.

---

## 38. Thread Ownership

Plugins should not freely create unmanaged threads.

Bad:

```java
new Thread(() -> runForever()).start();
```

Better:

- platform provides `ExecutorService` service,
- plugin uses managed scheduler,
- plugin stops work on deactivate,
- plugin names tasks with plugin ID,
- platform tracks in-flight jobs.

Contract:

```java
public interface PlatformExecutorProvider {
    ExecutorService executorFor(PluginExecutionType type);
}
```

Plugin should release resources on `@Deactivate`.

---

## 39. State Ownership

Who owns plugin state?

Options:

1. Stateless plugin.
2. Plugin stores config only.
3. Plugin stores cache.
4. Plugin stores durable business data.

Preferred order:

```text
stateless > cache-only > platform-managed state > plugin-owned durable state
```

Plugin-owned durable state makes upgrade/rollback/migration harder.

If plugin has durable state, require:

- schema version,
- migration scripts,
- backup/restore strategy,
- rollback strategy,
- data ownership policy,
- uninstall policy,
- retention policy,
- audit policy.

---

## 40. Data Boundary

Plugin should not receive unrestricted database access by default.

Bad:

```java
plugin gets DataSource to platform DB
```

Better:

```java
plugin gets CaseReadModel / CaseCommandGateway
```

For write behavior:

```java
public interface CaseCommandGateway {
    CommandResult submit(Command command, PluginExecutionContext context);
}
```

Platform validates:

- permission,
- state transition,
- audit,
- idempotency,
- optimistic locking,
- business rule.

Plugin suggests action; platform owns authoritative state change.

---

## 41. Auditability

For regulated platforms, plugin actions must be auditable.

Audit record should include:

```text
plugin.id
plugin.version
bundle.symbolicName
bundle.version
contract.version
input reference/hash
output decision
execution time
correlation id
tenant/agency
operator/requestor
config version
permission set
route decision
failure category
```

Avoid storing full sensitive payload unless required. Use hash/reference when possible.

Audit must answer:

- Which plugin made this decision?
- Which version?
- Under which configuration?
- Was it approved?
- What input did it see?
- What output did it produce?
- Was decision deterministic?
- Could a later plugin version produce a different result?

---

## 42. Determinism and Replay

Some plugin categories must be replayable.

Example:

- eligibility rule,
- compliance validation,
- enforcement escalation,
- fee computation.

Replay requires:

- versioned plugin,
- versioned input snapshot,
- versioned config,
- deterministic execution,
- external data snapshot or recorded response,
- stable clock/time source.

Do not let plugin call `Instant.now()` directly if decision must be replayable.

Provide:

```java
public interface PlatformClock {
    Instant now();
}
```

Or pass evaluation time in context.

---

## 43. Plugin Routing Architecture

Basic routing:

```text
request -> platform service -> plugin registry -> plugin -> result
```

Advanced routing:

```text
request
  -> route context builder
  -> policy evaluator
  -> health/permission/config filter
  -> plugin candidate ranking
  -> execution wrapper
  -> audit + metrics
  -> result aggregation
```

Pipeline:

```text
+---------+    +----------+    +----------+    +---------+
| Request | -> | Selector | -> | Executor | -> | Auditor |
+---------+    +----------+    +----------+    +---------+
                    |
                    v
              +------------+
              | Plugin Set |
              +------------+
```

Selection must be deterministic.

---

## 44. Result Aggregation

If multiple plugins run, how are results combined?

Strategies:

| Strategy | Meaning |
|---|---|
| first-match | first plugin that can handle wins |
| highest-priority | highest priority selected |
| all-must-pass | every plugin must approve |
| any-can-pass | at least one approval enough |
| weighted score | combine scores |
| ordered pipeline | output of one becomes input next |
| independent side-effect | all run independently |

Contract must define aggregation semantics.

Example validation:

```text
If any mandatory rule returns BLOCK, validation result is BLOCK.
If no BLOCK and at least one WARN, result is WARN.
Otherwise PASS.
```

Without aggregation rules, plugin behavior becomes political and unpredictable.

---

## 45. Plugin Update Strategy

Updating plugin at runtime is dangerous if plugin affects active business flow.

Safe strategy:

```text
1. install new plugin bundle
2. resolve dependency graph
3. validate metadata
4. run certification smoke test
5. mark new version READY
6. route small percentage/tenant to new version
7. monitor
8. drain old version
9. disable old version
10. uninstall old version later
```

Do not immediately replace active plugin for all traffic just because bundle update succeeded.

Bundle update is technical. Plugin rollout is business/operational.

---

## 46. Side-by-Side Version Rollout

OSGi can run two plugin versions if symbolic names or versions/wiring allow.

Example:

```text
com.acme.plugins.validation.risk v2.3.1
com.acme.plugins.validation.risk v2.4.0
```

But OSGi framework normally identifies installed bundle by location and symbolic name/version. Operationally, side-by-side requires explicit provisioning design.

Platform routing can choose:

```text
tenant A -> v2.3.1
tenant B -> v2.4.0
```

Need:

- route table,
- audit version,
- config per version,
- health per version,
- rollback path.

---

## 47. Rollback Strategy

Rollback must be planned before deployment.

Questions:

- Can old plugin still read new config?
- Can old plugin handle state written by new plugin?
- Did new plugin perform irreversible side effects?
- Did new plugin migrate schema?
- Did new plugin emit event schema incompatible with old consumers?
- Did route table change?

Rollback taxonomy:

```text
code rollback only
config rollback
route rollback
schema rollback
state compensation
external side-effect compensation
```

If plugin writes durable state, rollback becomes much harder.

---

## 48. Plugin Disable Strategy

Plugins should be disable-able without undeploying bundle.

Why?

- emergency kill switch,
- bad config,
- external system down,
- discovered vulnerability,
- tenant-specific suspension,
- partial rollout stop.

Disable levels:

```text
global disabled
tenant disabled
operation disabled
route disabled
capability disabled
```

Design plugin registry to distinguish:

```text
service exists but not routable
```

Do not equate service registration with business enablement.

---

## 49. Plugin Repository Model

A plugin platform needs repository as governance boundary.

Repository metadata includes:

- bundle identity,
- capabilities,
- requirements,
- checksums,
- signatures,
- SBOM link,
- certification status,
- supported platform versions,
- release notes,
- deprecation status,
- vulnerability status.

Example stages:

```text
local dev repository
integration repository
certification repository
staging repository
production repository
```

Runtime should not discover plugin from uncontrolled directory unless in dev mode.

---

## 50. Tenant-Specific Plugin Enablement

In enterprise/regulatory platforms, not all tenants/agencies use same plugin set.

Routing table:

```text
tenant_id | plugin_type | plugin_id | version | enabled | priority
CEA       | validation  | risk-v2   | 2.4.0   | true    | 100
CEA       | rendering   | pdf-sg    | 1.3.2   | true    | 50
CPDS      | validation  | risk-v1   | 1.9.5   | true    | 100
```

Runtime selection:

```text
case tenant + operation + plugin type -> candidate plugins -> health filter -> route
```

Audit must record chosen route.

---

## 51. Product-Line Runtime

OSGi can assemble different product variants from same platform.

Example:

```text
base platform
 + enforcement module
 + compliance rule plugins
 + agency connector plugins
```

Variant A:

```text
SG agency runtime:
  onemap connector
  singpass integration adapter
  sg document templates
```

Variant B:

```text
ID agency runtime:
  local geocoding connector
  id document templates
```

Use capabilities/repository/provisioning instead of `if (country == ...)` everywhere.

---

## 52. Plugin Registry Design

A robust plugin registry stores runtime and governance data.

In-memory view:

```java
public final class PluginRuntimeEntry {
    private final PluginId pluginId;
    private final Version pluginVersion;
    private final Bundle bundle;
    private final Object service;
    private final PluginType type;
    private final PluginRuntimeState state;
    private final PluginHealth health;
    private final Set<Permission> grantedPermissions;
    private final Map<String, Object> serviceProperties;
}
```

Persistent view:

```text
plugin_installation
  plugin_id
  plugin_version
  bundle_symbolic_name
  bundle_version
  status
  approved_by
  approved_at
  installed_at
  config_version
  repository_artifact
  checksum
```

Do not rely only on OSGi service registry for business governance. Use service registry for runtime discovery, plus platform registry for policy.

---

## 53. Plugin Manager Responsibilities

A plugin manager may be responsible for:

- discovering plugin bundles,
- validating metadata,
- reading plugin descriptors,
- checking compatibility,
- checking approval status,
- tracking services,
- managing enable/disable,
- exposing plugin status API,
- controlling route table,
- triggering certification tests,
- collecting plugin health,
- coordinating drain/update/rollback.

But avoid god-object plugin manager.

Split responsibilities:

```text
PluginDescriptorReader
PluginCompatibilityChecker
PluginPermissionService
PluginRuntimeRegistry
PluginRouteService
PluginHealthAggregator
PluginLifecycleCoordinator
PluginAuditService
```

---

## 54. Whiteboard-Based Plugin Registry

Example SPI:

```java
public interface CaseActionProvider {
    Collection<CaseAction> actions(CaseActionContext context);
}
```

Plugin:

```java
@Component(service = CaseActionProvider.class, property = {
    "plugin.id=approve-case-action",
    "case.type=application",
    "service.ranking:Integer=100"
})
public class ApproveCaseActionProvider implements CaseActionProvider {
    @Override
    public Collection<CaseAction> actions(CaseActionContext context) {
        return List.of(new CaseAction("APPROVE", "Approve"));
    }
}
```

Registry:

```java
@Component
public class CaseActionRegistry {
    private final AtomicReference<List<ProviderEntry>> providers =
        new AtomicReference<>(List.of());

    @Reference(
        service = CaseActionProvider.class,
        cardinality = ReferenceCardinality.MULTIPLE,
        policy = ReferencePolicy.DYNAMIC
    )
    void bind(CaseActionProvider provider, Map<String, Object> props) {
        providers.updateAndGet(old -> sortedAdd(old, provider, props));
    }

    void unbind(CaseActionProvider provider) {
        providers.updateAndGet(old -> remove(old, provider));
    }

    public Collection<CaseAction> actions(CaseActionContext context) {
        return providers.get().stream()
            .filter(entry -> entry.matches(context))
            .flatMap(entry -> safeActions(entry, context).stream())
            .toList();
    }
}
```

This is better than hardcoding plugin list.

---

## 55. Extender-Based Plugin Platform

Sometimes service registration alone is too permissive. You want platform to validate descriptor first.

Plugin bundle:

```text
META-INF/acme/plugin.json
META-INF/acme/rules/rule-001.json
META-INF/acme/rules/rule-002.json
```

Manifest:

```properties
Acme-Plugin: true
Require-Capability: acme.platform;filter:="(version>=1.4.0)"
```

Extender:

```java
public class PluginExtender {
    private final BundleTracker<PluginHandle> tracker;

    public void open(BundleContext context) {
        tracker = new BundleTracker<>(context, Bundle.ACTIVE, new PluginCustomizer());
        tracker.open();
    }
}
```

Customizer:

```java
class PluginCustomizer implements BundleTrackerCustomizer<PluginHandle> {
    @Override
    public PluginHandle addingBundle(Bundle bundle, BundleEvent event) {
        URL descriptor = bundle.getEntry("META-INF/acme/plugin.json");
        if (descriptor == null) {
            return null;
        }

        PluginDescriptor parsed = parse(descriptor);
        compatibility.check(parsed);
        certification.check(parsed, bundle);

        return pluginRuntime.install(bundle, parsed);
    }

    @Override
    public void removedBundle(Bundle bundle, BundleEvent event, PluginHandle handle) {
        handle.close();
    }
}
```

Extender gives stronger control:

- plugin cannot simply register arbitrary service and become enabled,
- descriptor can be validated,
- permissions can be checked,
- config can be required,
- runtime entry can be controlled.

---

## 56. Capability-Gated Plugin

Use capability requirements to ensure plugin only resolves in compatible runtime.

Platform provides:

```properties
Provide-Capability: \
  acme.platform; \
    version:Version="2.1.0"; \
    features:List<String>="validation,rendering,workflow"
```

Plugin requires:

```properties
Require-Capability: \
  acme.platform; \
    filter:="(&(version>=2.0.0)(features=validation))"
```

This catches incompatibility earlier at resolve/provisioning time.

Do not rely only on runtime `if` checks.

---

## 57. Avoiding Host Internal Dependency

Bad plugin:

```java
import com.acme.platform.case.internal.CaseEntity;
import com.acme.platform.case.internal.CaseRepositoryImpl;
```

This may compile if internal packages accidentally exported.

Consequences:

- host cannot refactor,
- plugin breaks on internal change,
- hidden data coupling,
- governance bypass,
- rollback harder.

Enforcement:

```properties
Export-Package: \
  com.acme.platform.api.casework;version=2.1.0, \
  com.acme.platform.spi.validation;version=1.4.0
Private-Package: \
  com.acme.platform.case.internal.*
```

CI check:

```text
fail if Import-Package contains com.acme.platform.*.internal.*
```

---

## 58. Avoiding Framework Leakage

Should plugin SPI expose OSGi types?

Usually no.

Bad:

```java
public interface Plugin {
    void start(BundleContext context);
}
```

This couples plugin contract to OSGi.

Better:

```java
public interface RuleProvider {
    RuleDescriptor descriptor();
    RuleResult evaluate(RuleContext context);
}
```

Let DS handle OSGi lifecycle outside business SPI.

Exceptions:

- low-level OSGi extension platform,
- framework tooling plugin,
- diagnostic plugin,
- repository/provisioning plugin.

For business plugins, keep OSGi hidden.

---

## 59. Avoiding DI Container Leakage

Similarly, avoid exposing Spring/CDI/Blueprint types in plugin SPI.

Bad:

```java
ApplicationContext getApplicationContext();
```

Bad:

```java
EntityManager entityManager();
```

Bad:

```java
HttpServletRequest currentRequest();
```

These leak runtime details. Use platform-specific abstraction.

---

## 60. Plugin API Binary Compatibility

OSGi plugin platforms live long. Binary compatibility matters.

Breaking changes:

- removing method from interface,
- adding abstract method to interface used by implementors,
- changing method descriptor,
- changing field type,
- changing return type incompatibly,
- removing exported class,
- moving package,
- changing checked exception in incompatible ways,
- changing semantic behavior relied upon by plugin.

Safer evolution:

- add new interface,
- add default method carefully if Java 8+ and semantics safe,
- add optional service,
- add DTO field with backward-compatible default,
- introduce v2 package,
- provide adapter.

Example:

```java
public interface ValidationRuleV2 extends ValidationRule {
    ValidationCapabilities capabilities();
}
```

But be careful with interface inheritance and service selection. Sometimes separate SPI package is clearer.

---

## 61. Plugin API Source Compatibility vs Runtime Compatibility

A plugin may compile against API 1.4 and run against API 1.6 if binary-compatible.

But semantic compatibility may still break.

Example:

```text
API 1.5 changes default timeout from 5s to 500ms.
```

Binary-compatible, behavior-breaking.

Top-tier versioning documents:

- binary compatibility,
- source compatibility,
- semantic compatibility,
- operational compatibility,
- config compatibility.

---

## 62. Service Ranking Pitfalls

OSGi `service.ranking` can select highest-ranked service. But ranking is global and blunt.

Bad:

```text
Use highest service.ranking for all validation rules.
```

Problems:

- no tenant context,
- no case type context,
- no feature flag,
- no health filtering,
- accidental override,
- operator cannot reason clearly.

Better:

- use service ranking only as one input,
- have explicit plugin route table,
- log selection decision.

---

## 63. Service Property Schema

If service properties drive routing, schema them.

Example required properties:

```text
plugin.id: String
plugin.type: String
plugin.version: Version
case.type: String[]
priority: Integer
tenant.scope: String[] optional
```

Validate at bind time.

```java
PluginMetadata metadata = PluginMetadata.from(props);
if (!metadata.isValid()) {
    quarantine(provider, metadata.errors());
    return;
}
```

Do not accept arbitrary property map as trusted.

---

## 64. Quarantine Pattern

Invalid plugin should not crash whole runtime.

States:

```text
QUARANTINED_METADATA_INVALID
QUARANTINED_PERMISSION_DENIED
QUARANTINED_CONFIG_INVALID
QUARANTINED_HEALTH_FAILED
QUARANTINED_COMPATIBILITY_FAILED
```

Quarantined plugin:

- remains installed for diagnostics,
- not routed business traffic,
- exposes reason,
- can be repaired by config/update,
- can be removed safely.

This is better than either accepting bad plugin or killing runtime.

---

## 65. Plugin Execution Wrapper

Never call plugin directly from core flow without wrapper.

Wrapper responsibilities:

- set execution context,
- enforce permission,
- enforce timeout/deadline,
- collect metrics,
- catch/classify exceptions,
- write audit,
- update health,
- apply circuit breaker,
- sanitize logs,
- clear ThreadLocal/TCCL after call.

Pseudo-code:

```java
public ValidationResult execute(PluginEntry entry, ValidationRequest request) {
    PluginExecutionContext ctx = contextFactory.create(entry, request);

    return metrics.timed(entry.id(), () -> {
        try (PluginContextScope ignored = PluginContextScope.open(ctx)) {
            permissions.check(entry, "validation.execute");
            deadlines.check(ctx);
            return entry.rule().validate(ctx.validationContext(), request.caseSnapshot());
        } catch (Exception ex) {
            PluginFailure failure = classifier.classify(entry, ex);
            health.recordFailure(entry, failure);
            audit.recordFailure(ctx, failure);
            throw failure.toPlatformException();
        }
    });
}
```

---

## 66. TCCL and Plugin Execution

Some plugin libraries may use Thread Context ClassLoader.

Platform wrapper may need controlled TCCL switch:

```java
ClassLoader old = Thread.currentThread().getContextClassLoader();
try {
    Thread.currentThread().setContextClassLoader(pluginClassLoader);
    return plugin.execute(request);
} finally {
    Thread.currentThread().setContextClassLoader(old);
}
```

Use only when necessary and document why.

Do not leave TCCL pointing to plugin after invocation. That causes classloader leaks and weird behavior.

---

## 67. Plugin Classloader Leak Prevention

Common leak sources:

- static caches,
- ThreadLocal,
- executor threads,
- timer threads,
- JDBC drivers,
- logging appenders,
- MBeans,
- global registries,
- `ServiceLoader` caches,
- XML/JAXB/Jackson caches,
- TCCL retained by thread pool,
- lambda/metafactory references in static singletons.

Plugin unload test:

```text
install plugin
start plugin
execute plugin
disable plugin
drain plugin
stop/uninstall bundle
refresh framework
force GC in test env
assert classloader eligible for GC
```

Not perfect, but catches many leaks.

---

## 68. Plugin Compatibility Matrix

Maintain matrix:

```text
plugin version | platform version | Java version | API/SPI version | status
risk 2.3.1     | 2.1.x            | 17,21        | validation 1.4  | supported
risk 2.4.0     | 2.2.x            | 21,25        | validation 1.5  | supported
risk 1.9.5     | 1.8.x-2.0.x      | 8,11,17      | validation 1.2  | deprecated
```

Use for:

- provisioning,
- support,
- upgrade planning,
- incident triage,
- certification.

---

## 69. Java 8–25 Plugin Design Implications

### Java 8

- baseline for many old OSGi systems,
- no JPMS strong encapsulation,
- default methods available,
- Security Manager historically available,
- javax ecosystem common.

### Java 9–11

- JPMS introduced,
- Java EE modules removed by Java 11,
- reflective access warnings begin,
- module path/classpath interaction matters.

### Java 17

- common LTS baseline,
- stronger encapsulation pressure,
- many old bytecode libraries need updates,
- Security Manager deprecated for removal.

### Java 21

- virtual threads available,
- useful but plugin blocking/resource control still matters,
- old libraries may still assume platform threads.

### Java 24/25

- do not depend on Security Manager for in-process sandboxing,
- strong encapsulation and modern JDK restrictions matter,
- plugin platform should use governance/process isolation for untrusted code.

Contract design should avoid JDK-internal APIs and old Java EE assumptions.

---

## 70. Plugin Platform Security Architecture

Layered model:

```text
Repository admission
  -> signature/checksum/SBOM
  -> certification tests
  -> resolver policy
  -> install approval
  -> runtime permission grant
  -> execution wrapper
  -> audit/monitoring
  -> disable/rollback
```

No single control is enough.

Security questions:

- Who built this plugin?
- Was it reviewed?
- Which dependencies does it include?
- Which permissions does it request?
- Which permissions were granted?
- Which API/SPI version does it target?
- Can it access network/filesystem?
- Can it mutate business state directly?
- Can it block platform threads?
- Can it be disabled instantly?
- Can we prove what it did?

---

## 71. Plugin Marketplace vs Internal Plugin Catalog

Not every plugin platform needs marketplace.

### Internal Catalog

- platform team controls all plugins,
- strong code review,
- simple governance,
- faster integration.

### Partner Catalog

- partners submit plugins,
- certification required,
- support matrix required,
- permission approval required.

### Public Marketplace

- highest governance burden,
- legal/license/security concerns,
- vulnerability response process required,
- rating/support/deprecation model.

Most enterprise OSGi systems should start with internal or partner catalog, not public marketplace.

---

## 72. Administrative API

Plugin platform needs admin operations.

Examples:

```text
GET /plugins
GET /plugins/{id}
POST /plugins/{id}/enable
POST /plugins/{id}/disable
POST /plugins/{id}/drain
POST /plugins/{id}/rollback
GET /plugins/{id}/health
GET /plugins/{id}/routes
GET /plugins/{id}/audit
```

Do not expose raw OSGi operations directly to business admins.

Bad:

```text
Admin clicks “stop bundle 143”
```

Better:

```text
Admin disables plugin risk-score-validation v2.4.0 for tenant CEA
```

OSGi bundle ID is operational detail. Plugin ID is business/platform concept.

---

## 73. Runtime Diagnostics UX

Good diagnostics should map layers:

```text
Plugin: risk-score-validation
State: ENABLED
Health: UP
Bundle: com.acme.plugins.validation.risk/2.4.0
Bundle state: ACTIVE
Services:
  ValidationRule registered=true
  PluginHealthContributor registered=true
Config:
  PID=com.acme.plugin.validation.risk
  version=3
Routes:
  tenant=CEA, caseType=application, priority=100
Permissions:
  case.read, audit.write
Last execution:
  success at ... latency p95=42ms
```

This is more useful than:

```text
Bundle 143 ACTIVE
```

---

## 74. Example: Regulatory Enforcement Rule Plugin Platform

Imagine a regulatory case management system.

Needs:

- rule plugins for validation,
- escalation policy plugins,
- document template/rendering plugins,
- external agency connector plugins,
- notification channel plugins,
- audit defensibility,
- tenant/agency-specific enablement,
- controlled upgrade.

Bundle architecture:

```text
com.gov.platform.api.casework
com.gov.platform.api.audit
com.gov.platform.spi.validation
com.gov.platform.spi.escalation
com.gov.platform.spi.rendering
com.gov.platform.kernel
com.gov.platform.validation.engine
com.gov.platform.plugin.registry
com.gov.plugins.validation.licence-risk
com.gov.plugins.escalation.sla
com.gov.plugins.rendering.notice-pdf
com.gov.plugins.connector.address-api
```

Validation SPI:

```java
public interface EnforcementValidationRule {
    RuleDescriptor descriptor();

    ValidationOutcome evaluate(
        EnforcementCaseSnapshot caseSnapshot,
        ValidationExecutionContext context
    ) throws ValidationRuleException;
}
```

Execution context:

```java
public final class ValidationExecutionContext {
    private final String correlationId;
    private final String agencyId;
    private final Instant decisionTime;
    private final String configVersion;
    private final Deadline deadline;
}
```

Outcome:

```java
public final class ValidationOutcome {
    private final Decision decision;
    private final List<ValidationFinding> findings;
    private final Map<String, String> auditFacts;
}
```

Audit:

```text
case_id=CASE-123
plugin_id=licence-risk
plugin_version=2.1.0
decision=BLOCK
finding_code=LICENCE_EXPIRED
config_version=7
execution_time_ms=31
correlation_id=...
```

---

## 75. Example: Document Renderer Plugin

SPI:

```java
public interface DocumentRenderer {
    RendererDescriptor descriptor();

    RenderedDocument render(
        DocumentTemplate template,
        DocumentData data,
        RenderContext context
    ) throws RenderException;
}
```

Potential plugins:

```text
pdf-renderer
html-renderer
docx-renderer
agency-specific-notice-renderer
```

Design concerns:

- rendering can be CPU/memory heavy,
- template injection risk,
- font/resource loading,
- output size limit,
- deterministic rendering,
- audit of template version,
- native library risk,
- possible out-of-process isolation for heavy rendering.

This plugin type may need stronger resource isolation than simple validation rule.

---

## 76. Example: External Connector Plugin

SPI:

```java
public interface ExternalConnector {
    ConnectorDescriptor descriptor();

    ConnectorResponse execute(
        ConnectorRequest request,
        ConnectorContext context
    ) throws ConnectorException;
}
```

Design concerns:

- network timeout,
- retry,
- circuit breaker,
- credentials,
- rate limit,
- endpoint config,
- response caching,
- PII protection,
- error taxonomy,
- external SLA,
- replay/audit of response.

Credential access should be through platform secret abstraction, not raw environment access.

---

## 77. Plugin Secret Access

Bad:

```java
String secret = System.getenv("API_SECRET");
```

Better:

```java
public interface SecretHandleProvider {
    SecretHandle getSecret(String logicalName, PluginExecutionContext context);
}
```

Plugin requests logical secret:

```text
external.connector.onemap.client-secret
```

Platform checks:

- plugin permission,
- tenant,
- environment,
- audit,
- rotation policy.

Plugin should not log secret value.

---

## 78. Plugin Eventing

Plugins may emit domain events.

But define event contract.

Bad:

```java
eventAdmin.postEvent(new Event("plugin/event", Map.of("data", object)));
```

Better:

```java
public interface PlatformEventPublisher {
    void publish(DomainEvent event, PluginExecutionContext context);
}
```

Platform validates:

- event type,
- schema version,
- permission,
- payload size,
- audit sensitivity,
- routing.

Do not let plugin spam Event Admin freely.

---

## 79. Plugin UI Extensions

OSGi is backend/runtime-centric, but plugin platforms sometimes need UI extension.

Options:

1. Backend plugin exposes metadata; frontend renders generic UI.
2. Plugin provides static resources via HTTP Whiteboard.
3. Plugin provides frontend bundle loaded by host UI.
4. Plugin integrates through external iframe/microfrontend.

Risks:

- XSS,
- incompatible frontend dependencies,
- asset versioning,
- authorization mismatch,
- inconsistent UX,
- cache invalidation,
- CSP policy.

For regulated systems, generic metadata-driven UI is often safer than arbitrary plugin UI code.

---

## 80. Plugin Documentation Contract

Every plugin should include:

- plugin purpose,
- supported platform versions,
- supported Java versions,
- required permissions,
- configuration schema,
- operational behavior,
- failure modes,
- timeout/retry behavior,
- data accessed,
- audit fields,
- upgrade notes,
- rollback notes,
- deprecation status,
- support owner.

Documentation is part of governance, not optional.

---

## 81. Common Anti-Patterns

### 81.1 “Everything is a Plugin”

Not everything needs runtime extension.

If behavior is always deployed together and never customized independently, normal module may be enough.

### 81.2 Exporting Host Internals

Destroys future evolution.

### 81.3 Plugin Gets Database Access

Bypasses business invariants and audit.

### 81.4 Plugin Uses Static Singleton

Breaks lifecycle and unloadability.

### 81.5 DynamicImport-Package Everywhere

Bypasses resolver discipline and makes behavior non-deterministic.

### 81.6 Service Ranking as Business Policy

Too implicit.

### 81.7 Bundle ACTIVE Equals Plugin Ready

False.

### 81.8 No Certification

Every production install becomes experiment.

### 81.9 No Kill Switch

Bad plugin becomes outage.

### 81.10 Untrusted Code In Same JVM

Not defensible for high-risk plugin.

### 81.11 Shared Mutable DTO

Plugin can mutate host state accidentally.

### 81.12 Contract Uses Third-Party Library Types

Locks plugin ecosystem to platform library version.

### 81.13 No Audit of Plugin Version

Cannot explain historical decisions.

### 81.14 Plugin Manager God Object

Hard to test and evolve.

### 81.15 Hot Update Without Drain

In-flight work fails unpredictably.

---

## 82. Design Review Checklist

### 82.1 Boundary

- What is kernel?
- What is API?
- What is SPI?
- What is internal?
- Are internal packages private?
- Can plugin compile without implementation bundle?

### 82.2 Contract

- Is input DTO stable?
- Is output DTO stable?
- Is error taxonomy explicit?
- Is timeout defined?
- Is thread-safety defined?
- Is idempotency defined?
- Is audit requirement defined?

### 82.3 Versioning

- Are exported packages versioned?
- Are import ranges sane?
- Is baseline check enabled?
- Is deprecation policy defined?
- Is multi-version support needed?

### 82.4 Lifecycle

- What does installed mean?
- What does ready mean?
- What does enabled mean?
- Can plugin be disabled?
- Can plugin be drained?
- Can plugin be rolled back?
- What happens to in-flight work?

### 82.5 Security

- Who built plugin?
- Is plugin signed?
- Is dependency scanned?
- What permissions are requested?
- What permissions are granted?
- Does plugin access filesystem/network?
- Does plugin handle secrets safely?

### 82.6 Isolation

- Is OSGi isolation enough?
- Does plugin need process isolation?
- Does plugin run heavy CPU/memory work?
- Can plugin create threads?
- Are executors managed?

### 82.7 Observability

- Is plugin visible in diagnostics?
- Are metrics per plugin/version?
- Is health per plugin?
- Are route decisions logged/audited?
- Is correlation propagated?

### 82.8 Operations

- How is plugin installed?
- Which repository stage?
- How is config provided?
- How is rollback done?
- How is emergency disable done?
- How is compatibility checked?

---

## 83. Decision Framework: Should This Be a Plugin?

Ask:

1. Does behavior vary independently by customer/tenant/product?
2. Does behavior need runtime install/update?
3. Is there a stable contract boundary?
4. Can the plugin be tested/certified independently?
5. Can plugin failure be isolated/degraded?
6. Can plugin be disabled safely?
7. Can we audit its decisions?
8. Can we govern dependencies and permissions?
9. Does plugin need direct access to internal state?
10. Would microservice/process isolation be safer?

If answers are mostly no, do not make it a plugin.

---

## 84. OSGi-Specific Implementation Blueprint

Minimal bundle set:

```text
com.acme.platform.api
com.acme.platform.spi
com.acme.platform.kernel
com.acme.platform.plugin.registry
com.acme.platform.plugin.admin
com.acme.platform.plugin.health
com.acme.platform.plugin.audit
com.acme.platform.validation.engine
com.acme.plugins.validation.sample
```

SPI package:

```text
com.acme.platform.spi.validation;version=1.0.0
```

Plugin import:

```properties
Import-Package: \
  com.acme.platform.spi.validation;version="[1.0,2)", \
  com.acme.platform.api.casework;version="[1.0,2)", \
  org.osgi.service.component.annotations;version="[1.4,2)";resolution:=optional, \
  *
```

Platform registry tracks:

```java
@Reference(
    service = ValidationRule.class,
    cardinality = ReferenceCardinality.MULTIPLE,
    policy = ReferencePolicy.DYNAMIC
)
void bindRule(ValidationRule rule, Map<String, Object> props) {
    registry.register(rule, props);
}
```

Use bnd to enforce:

```properties
-baseline: *
-fixupmessages: \
  "Export com.acme.platform.internal.*";is:=error
```

Use repository/certification to enforce plugin approval before production.

---

## 85. Production Readiness Checklist

A plugin platform is production-ready when:

- plugin contracts are stable and versioned,
- API/SPI bundles are small and governed,
- internal packages are not exported,
- import ranges are reviewed,
- baseline checks run in CI,
- resolver tests run in CI,
- plugin certification exists,
- plugin repository has promotion stages,
- plugin metadata is validated,
- plugin config schema exists,
- plugin health is visible,
- plugin metrics are per plugin/version,
- plugin audit includes version/config/route,
- plugin can be disabled,
- plugin can be drained,
- plugin rollback is defined,
- untrusted plugin policy is explicit,
- secrets are controlled,
- thread/executor ownership is controlled,
- classloader leak tests exist,
- support matrix exists,
- operational runbook exists.

---

## 86. Mental Model Final

A good OSGi plugin platform is not “a folder where we drop JARs”.

It is a governed runtime ecosystem.

The main abstraction is not class loading. The main abstraction is **controlled extension**.

Controlled extension means:

```text
contract + lifecycle + compatibility + governance + isolation + observability + rollback
```

OSGi gives strong primitives:

- bundle identity,
- package visibility,
- dynamic lifecycle,
- service registry,
- metadata,
- resolver,
- capabilities,
- configuration,
- provisioning.

But OSGi does not automatically give:

- good API design,
- business permission model,
- trusted plugin governance,
- safe rollback,
- audit semantics,
- resource isolation,
- operator-friendly diagnostics.

Those are platform responsibilities.

Top 1% engineering is not knowing that `@Component` registers a service.  
Top 1% engineering is knowing what must be true before that service is allowed to influence production behavior.

---

## 87. Key Takeaways

1. Plugin architecture is not dynamic class loading; it is governed runtime extensibility.
2. Host should depend on API/SPI, not concrete plugin.
3. Plugin should depend on platform contract, not platform internals.
4. Bundle `ACTIVE` is not plugin `READY`.
5. Plugin lifecycle should be separate from bundle lifecycle.
6. API/SPI packages must be versioned and baseline-checked.
7. Service registry is runtime discovery, not complete business governance.
8. Plugin routing should be deterministic and auditable.
9. Plugin execution needs wrapper for timeout, permission, metrics, audit, and failure classification.
10. OSGi classloader isolation is not security sandbox for arbitrary untrusted code.
11. Plugin state, config, secrets, and external side effects need explicit ownership.
12. Production plugin platforms need certification, repository promotion, kill switch, health, and rollback.

---

## 88. Latihan Praktis

### Latihan 1 — Boundary Review

Ambil satu sistem modular yang kamu kenal. Pisahkan package menjadi:

```text
api
spi
internal
plugin
```

Tentukan package mana yang boleh diekspor.

### Latihan 2 — Plugin Contract Design

Desain SPI untuk:

```text
DocumentRenderer
ValidationRule
ExternalConnector
NotificationChannel
```

Untuk setiap SPI, definisikan:

- input,
- output,
- error taxonomy,
- timeout,
- thread-safety,
- audit fields,
- versioning policy.

### Latihan 3 — Plugin Lifecycle State Machine

Gambar lifecycle plugin dari install sampai uninstall. Pastikan ada state:

```text
CONFIG_REQUIRED
READY
ENABLED
DRAINING
DISABLED
QUARANTINED
```

### Latihan 4 — Certification Checklist

Buat CI gate untuk plugin:

- manifest valid,
- no forbidden import,
- import range sane,
- DS component registers expected service,
- config schema valid,
- health check exists,
- dynamic uninstall safe.

### Latihan 5 — Audit Design

Untuk rule plugin yang menghasilkan keputusan enforcement, desain audit record yang bisa menjawab pertanyaan:

> Mengapa case ini diblokir oleh rule pada tanggal tertentu?

---

## 89. Referensi Lanjutan

Referensi yang relevan untuk memperdalam part ini:

- OSGi Core Release 8 — lifecycle, module, service, resolver, capability/requirement model.
- OSGi Compendium Release 8 — Declarative Services, Configuration Admin, Metatype, Event Admin, HTTP Whiteboard.
- OSGi Repository and Resolver specifications.
- bnd / Bndtools documentation — manifest generation, resolving, baseline, bndrun.
- Apache Felix documentation — framework, SCR, Gogo, FileInstall, Web Console.
- Eclipse Equinox documentation — runtime, p2, extension registry.
- Apache Karaf documentation — features, provisioning, shell, operations.
- OSGi whiteboard and extender pattern materials.

---

## 90. Status Series

Part ini adalah:

```text
Part 28 dari 35
```

Series belum selesai.

Part berikutnya:

```text
Part 29 — Architecture Patterns: Modular Monolith, Dynamic Kernel, Product Lines, and Runtime Composition
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 27 — Provisioning and Deployment: Repositories, Features, p2, Karaf, Containers, and Rollback](./27-provisioning-deployment-repositories-features-p2-karaf-containers-rollback.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 29 — Architecture Patterns: Modular Monolith, Dynamic Kernel, Product Lines, and Runtime Composition](./29-architecture-patterns-modular-monolith-dynamic-kernel-product-lines-runtime-composition.md)
