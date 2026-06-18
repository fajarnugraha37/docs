# Part 32 — Building a Production-Grade OSGi Case Study Runtime from Scratch

> Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
> File: `32-building-production-grade-osgi-case-study-runtime-from-scratch.md`  
> Scope: advanced OSGi engineering, Java 8–25  
> Goal: membangun satu mental model dan blueprint implementasi untuk runtime OSGi production-grade dari nol.

---

## 0. Posisi Part Ini Dalam Series

Sampai Part 31, kita sudah membahas OSGi dari banyak sisi:

- mental model runtime modular;
- lifecycle framework dan bundle;
- manifest, dependency model, resolver, wiring, dan versioning;
- service registry dan Declarative Services;
- configuration, tooling, Felix, Equinox, Karaf;
- web, persistence, messaging, security, JPMS, Java 8–25;
- testing, observability, performance, provisioning, plugin platform, architecture pattern, anti-pattern, dan migration playbook.

Part 32 adalah **synthetic case study**.

Artinya, kita tidak lagi membahas satu konsep secara terpisah. Kita akan membangun rancangan runtime OSGi dari nol seolah-olah kita sedang membuat platform nyata.

Targetnya bukan membuat toy example seperti:

```text
hello-world-bundle
```

Targetnya adalah platform yang punya ciri production:

- ada kernel;
- ada API contract;
- ada domain module;
- ada plugin runtime;
- ada HTTP entry point;
- ada persistence boundary;
- ada configuration;
- ada observability;
- ada runtime diagnostics;
- ada failure injection;
- ada compatibility strategy;
- ada deployment model;
- ada governance.

Kita akan menggunakan contoh domain:

```text
Regulatory Enforcement Case Platform
```

Contoh ini cocok untuk OSGi karena punya banyak kebutuhan runtime modular:

- aturan validasi dapat berubah;
- workflow/escalation dapat berbeda per agency/tenant;
- connector eksternal dapat ditambahkan/diganti;
- renderer dokumen dapat modular;
- policy dapat versioned;
- sistem harus long-lived;
- auditability dan defensibility penting;
- upgrade harus terkendali;
- runtime harus dapat menjelaskan “plugin apa yang aktif dan kenapa”.

---

## 1. Requirement Case Study

Kita mulai dari requirement, bukan dari framework.

OSGi sering gagal karena engineer mulai dari:

```text
bagaimana membuat bundle?
```

Padahal pertanyaan yang lebih tepat:

```text
perubahan runtime apa yang perlu dikelola secara eksplisit?
```

### 1.1 Business Requirement

Platform harus mendukung lifecycle enforcement case:

```text
Draft Case
  -> Submit
  -> Screening
  -> Assignment
  -> Investigation
  -> Recommendation
  -> Approval
  -> Notice Issued
  -> Appeal / Closure
```

Beberapa capability yang perlu modular:

1. validation rule;
2. escalation policy;
3. notification channel;
4. document renderer;
5. external agency connector;
6. report exporter;
7. case scoring strategy;
8. audit enrichment;
9. tenant/agency-specific policy.

### 1.2 Technical Requirement

Runtime harus:

- berjalan di Java 17/21/25, masih bisa mempertimbangkan library Java 8;
- bisa diuji lokal dengan framework ringan;
- bisa dirakit reproducibly;
- bisa mendeteksi dependency conflict sebelum production;
- bisa menjalankan plugin side-by-side;
- bisa men-disable plugin bermasalah;
- bisa expose health/diagnostics;
- bisa melakukan controlled rollout;
- tidak boleh mengandalkan classpath global;
- tidak boleh mengandalkan Security Manager sebagai sandbox untuk Java 24/25;
- harus memisahkan API, SPI, implementation, adapter, dan runtime;
- harus punya versioning policy.

### 1.3 Non-Goal

Kita tidak akan membangun:

- distributed microservices penuh;
- full BPMN engine;
- full JPA implementation;
- UI SPA;
- production-ready Kubernetes YAML lengkap;
- real database schema lengkap.

Kita fokus pada **OSGi runtime architecture**.

---

## 2. Architecture Overview

Target runtime:

```text
+---------------------------------------------------------------+
|                     OSGi Framework Runtime                    |
|                  Felix / Equinox / Karaf / bndrun             |
+---------------------------------------------------------------+
|                                                               |
|  +-------------------+      +-------------------------------+  |
|  | Platform Kernel   |      | Runtime Diagnostics           |  |
|  | - lifecycle       |      | - bundle/service/component    |  |
|  | - health model    |      | - wiring summary              |  |
|  | - plugin registry |      | - config summary              |  |
|  +-------------------+      +-------------------------------+  |
|                                                               |
|  +-------------------+      +-------------------------------+  |
|  | API Bundles       |      | SPI Bundles                   |  |
|  | - case-api        |      | - validation-spi              |  |
|  | - audit-api       |      | - escalation-spi              |  |
|  | - notification-api|      | - connector-spi               |  |
|  +-------------------+      +-------------------------------+  |
|                                                               |
|  +-------------------+      +-------------------------------+  |
|  | Domain Services   |      | Plugin Bundles                |  |
|  | - case-core       |      | - validation-basic            |  |
|  | - audit-core      |      | - validation-agency-a         |  |
|  | - workflow-core   |      | - doc-renderer-pdf            |  |
|  +-------------------+      +-------------------------------+  |
|                                                               |
|  +-------------------+      +-------------------------------+  |
|  | Infrastructure    |      | Entry Points                  |  |
|  | - persistence     |      | - HTTP Whiteboard/JAX-RS      |  |
|  | - messaging       |      | - admin command               |  |
|  | - config          |      | - health endpoint             |  |
|  +-------------------+      +-------------------------------+  |
|                                                               |
+---------------------------------------------------------------+
```

Mental model:

```text
OSGi runtime = explicitly governed in-process platform.
```

Bukan:

```text
banyak JAR ditaruh di folder lalu berharap jalan.
```

---

## 3. Core Design Principle

### 3.1 API First, Implementation Hidden

Setiap boundary penting harus punya package API yang diekspor secara eksplisit.

Contoh:

```text
com.acme.enforcement.case.api
com.acme.enforcement.validation.spi
com.acme.enforcement.notification.api
```

Implementation tidak diekspor:

```text
com.acme.enforcement.case.internal
com.acme.enforcement.validation.basic.internal
```

Aturan:

```text
Export-Package hanya untuk contract.
Private-Package untuk implementation.
```

Jika implementation perlu diakses lintas bundle, itu biasanya tanda boundary salah.

### 3.2 Service Boundary, Not Object Boundary

Di OSGi, bundle lain tidak seharusnya instantiate implementation class milik bundle lain.

Yang dipublikasikan adalah service:

```java
public interface CaseService {
    CaseView openCase(CaseId id);
    CaseDecision submit(CaseSubmission submission);
}
```

Yang dikonsumsi adalah service contract:

```java
@Reference
private CaseService caseService;
```

Bukan:

```java
new CaseServiceImpl(...)
```

### 3.3 Runtime Dynamics Are Normal

Service bisa:

- muncul;
- hilang;
- diganti;
- ranking berubah;
- config berubah;
- bundle di-refresh;
- plugin dinonaktifkan.

Production-grade OSGi design tidak menganggap semua dependency immutable sepanjang lifetime JVM.

### 3.4 Compatibility Is a Product Feature

Kalau platform mendukung plugin, maka compatibility bukan urusan developer internal saja.

Compatibility adalah fitur produk.

Konsekuensinya:

- API package version harus benar;
- plugin harus menyatakan required API range;
- breaking change harus direncanakan;
- deprecated API harus punya masa transisi;
- plugin certification test wajib.

### 3.5 Runtime Must Be Explainable

Untuk platform regulatory, jawaban seperti ini tidak cukup:

```text
Sepertinya plugin X yang jalan.
```

Runtime harus bisa menjawab:

```text
Rule plugin apa yang aktif?
Versi berapa?
Dipilih karena ranking/filter apa?
Config apa yang dipakai?
API version apa yang di-wire?
Bundle mana yang menyediakan service?
Kapan plugin aktif/nonaktif?
Apa health status-nya?
```

---

## 4. Suggested Project Structure

Kita gunakan nama workspace:

```text
learn-java-osgi-case-platform/
```

Struktur konseptual:

```text
learn-java-osgi-case-platform/
├── cnf/
│   ├── build.bnd
│   └── ext/
├── platform.api.case/
│   └── bnd.bnd
├── platform.api.audit/
│   └── bnd.bnd
├── platform.spi.validation/
│   └── bnd.bnd
├── platform.spi.escalation/
│   └── bnd.bnd
├── platform.kernel/
│   └── bnd.bnd
├── platform.case.core/
│   └── bnd.bnd
├── platform.audit.core/
│   └── bnd.bnd
├── platform.persistence.jdbc/
│   └── bnd.bnd
├── platform.web.http/
│   └── bnd.bnd
├── platform.diagnostics/
│   └── bnd.bnd
├── plugin.validation.basic/
│   └── bnd.bnd
├── plugin.validation.highrisk/
│   └── bnd.bnd
├── plugin.escalation.agency-a/
│   └── bnd.bnd
├── runtime.local/
│   ├── local.bndrun
│   └── debug.bndrun
├── runtime.prod/
│   ├── prod.bndrun
│   └── release-notes.md
└── test.runtime/
    └── bnd.bnd
```

Why this structure?

Karena ia memisahkan:

| Area | Purpose |
|---|---|
| `api` | stable domain contract |
| `spi` | extension contract untuk plugin |
| `kernel` | runtime coordination |
| `core` | domain implementation |
| `infrastructure` | persistence, messaging, HTTP |
| `plugin` | optional runtime extension |
| `diagnostics` | explainability dan operation |
| `runtime` | assembly descriptor |
| `test.runtime` | in-framework verification |

---

## 5. Bundle Boundary Design

### 5.1 API Bundle: `platform.api.case`

Purpose:

```text
Mendefinisikan contract utama case management.
```

Packages:

```text
com.acme.enforcement.case.api
com.acme.enforcement.case.api.command
com.acme.enforcement.case.api.event
com.acme.enforcement.case.api.model
```

Exported:

```text
com.acme.enforcement.case.api;version=1.0.0
com.acme.enforcement.case.api.command;version=1.0.0
com.acme.enforcement.case.api.event;version=1.0.0
com.acme.enforcement.case.api.model;version=1.0.0
```

Not included:

- database entity;
- repository implementation;
- web DTO if not stable domain contract;
- framework-specific annotations unless deliberately part of API.

Example:

```java
package com.acme.enforcement.case.api;

public interface CaseService {
    CaseView get(CaseId id);
    SubmitCaseResult submit(SubmitCaseCommand command);
    CaseTransitionResult transition(TransitionCaseCommand command);
}
```

Design rule:

```text
API bundle must not import implementation bundles.
```

### 5.2 SPI Bundle: `platform.spi.validation`

Purpose:

```text
Mendefinisikan extension point untuk validation plugins.
```

Example:

```java
package com.acme.enforcement.validation.spi;

public interface CaseValidationRule {
    ValidationRuleId id();
    ValidationOutcome validate(ValidationContext context);
}
```

Service property convention:

```text
validation.rule.id
validation.rule.domain
validation.rule.stage
validation.rule.priority
validation.rule.agency
validation.rule.version
```

Example DS plugin:

```java
@Component(
    service = CaseValidationRule.class,
    property = {
        "validation.rule.id=missing-required-documents",
        "validation.rule.stage=SUBMISSION",
        "validation.rule.priority:Integer=100",
        "validation.rule.agency=*"
    }
)
public class MissingRequiredDocumentsRule implements CaseValidationRule {
    @Override
    public ValidationRuleId id() {
        return new ValidationRuleId("missing-required-documents");
    }

    @Override
    public ValidationOutcome validate(ValidationContext context) {
        // rule implementation
        return ValidationOutcome.pass();
    }
}
```

### 5.3 Core Bundle: `platform.case.core`

Purpose:

```text
Implement CaseService dan orchestrate domain behavior.
```

Imports:

- case API;
- validation SPI;
- audit API;
- persistence service;
- maybe Event Admin or domain event publisher.

Exports:

Usually none, or only internal operational API if explicitly intended.

Example:

```java
@Component(service = CaseService.class)
public class DefaultCaseService implements CaseService {

    private final CaseRepository repository;
    private final CaseValidationEngine validationEngine;
    private final AuditService auditService;

    @Activate
    public DefaultCaseService(
            @Reference CaseRepository repository,
            @Reference CaseValidationEngine validationEngine,
            @Reference AuditService auditService) {
        this.repository = repository;
        this.validationEngine = validationEngine;
        this.auditService = auditService;
    }

    @Override
    public SubmitCaseResult submit(SubmitCaseCommand command) {
        ValidationReport report = validationEngine.validate(command);
        if (!report.accepted()) {
            return SubmitCaseResult.rejected(report);
        }

        CaseAggregate aggregate = repository.load(command.caseId());
        aggregate.submit(command.submittedBy());
        repository.save(aggregate);

        auditService.record(AuditRecord.caseSubmitted(command.caseId(), command.submittedBy()));
        return SubmitCaseResult.accepted(command.caseId());
    }
}
```

Important:

`DefaultCaseService` is not exported as a class contract. It is registered as a service.

---

## 6. Runtime Service Topology

Service graph:

```text
HTTP Resource
   -> CaseService
        -> CaseValidationEngine
             -> List<CaseValidationRule>
        -> CaseRepository
             -> DataSource
        -> AuditService
             -> AuditSink
```

Dynamic plugin point:

```text
CaseValidationEngine
   -> CaseValidationRule services
      - plugin.validation.basic
      - plugin.validation.highrisk
      - plugin.validation.agency-a
```

The validation engine must expect rule changes at runtime.

Bad design:

```java
@Reference
private List<CaseValidationRule> rules;
```

Then directly iterate mutable list in business operation without snapshot discipline.

Better design:

```java
@Component(service = CaseValidationEngine.class)
public class DefaultCaseValidationEngine implements CaseValidationEngine {

    private final AtomicReference<List<RuleRegistration>> snapshot =
            new AtomicReference<>(List.of());

    @Reference(
        service = CaseValidationRule.class,
        cardinality = ReferenceCardinality.MULTIPLE,
        policy = ReferencePolicy.DYNAMIC,
        policyOption = ReferencePolicyOption.GREEDY
    )
    void bindRule(CaseValidationRule rule, Map<String, Object> props) {
        RuleRegistration registration = RuleRegistration.from(rule, props);
        snapshot.updateAndGet(existing -> sortedCopyWith(existing, registration));
    }

    void unbindRule(CaseValidationRule rule, Map<String, Object> props) {
        snapshot.updateAndGet(existing -> copyWithout(existing, rule));
    }

    @Override
    public ValidationReport validate(SubmitCaseCommand command) {
        List<RuleRegistration> rulesAtStart = snapshot.get();
        ValidationContext context = ValidationContext.from(command);

        ValidationReport.Builder report = ValidationReport.builder();
        for (RuleRegistration registration : rulesAtStart) {
            ValidationOutcome outcome = registration.rule().validate(context);
            report.add(registration.id(), outcome);
        }
        return report.build();
    }
}
```

Why snapshot?

Karena runtime bisa berubah saat business call sedang berjalan.

Top-tier OSGi code tidak cuma bertanya:

```text
Bagaimana inject multiple services?
```

Tapi:

```text
Apa semantic guarantee saat service list berubah di tengah operation?
```

---

## 7. Bundle Metadata Strategy

### 7.1 API Bundle Manifest Intent

`platform.api.case/bnd.bnd`:

```properties
Bundle-SymbolicName: com.acme.enforcement.platform.api.case
Bundle-Version: 1.0.0
Bundle-Name: Enforcement Case API

Export-Package: \
  com.acme.enforcement.case.api;version=1.0.0,\
  com.acme.enforcement.case.api.command;version=1.0.0,\
  com.acme.enforcement.case.api.event;version=1.0.0,\
  com.acme.enforcement.case.api.model;version=1.0.0

Private-Package: \
  com.acme.enforcement.case.api.internal.*
```

But API bundles should avoid `internal` unless necessary for package annotations or helpers that are not exported.

### 7.2 SPI Bundle Manifest Intent

`platform.spi.validation/bnd.bnd`:

```properties
Bundle-SymbolicName: com.acme.enforcement.platform.spi.validation
Bundle-Version: 1.0.0
Bundle-Name: Enforcement Validation SPI

Export-Package: \
  com.acme.enforcement.validation.spi;version=1.0.0,\
  com.acme.enforcement.validation.spi.model;version=1.0.0

Import-Package: \
  com.acme.enforcement.case.api;version="[1.0,2)",\
  *
```

### 7.3 Implementation Bundle Manifest Intent

`platform.case.core/bnd.bnd`:

```properties
Bundle-SymbolicName: com.acme.enforcement.platform.case.core
Bundle-Version: 1.0.0
Bundle-Name: Enforcement Case Core

Private-Package: \
  com.acme.enforcement.case.core.*

Import-Package: \
  com.acme.enforcement.case.api;version="[1.0,2)",\
  com.acme.enforcement.validation.spi;version="[1.0,2)",\
  com.acme.enforcement.audit.api;version="[1.0,2)",\
  org.osgi.service.component.annotations;version="[1.4,2)",\
  *

-serviceannotations: *
```

Implementation bundle does not export its internal packages.

### 7.4 Plugin Bundle Manifest Intent

`plugin.validation.basic/bnd.bnd`:

```properties
Bundle-SymbolicName: com.acme.enforcement.plugin.validation.basic
Bundle-Version: 1.0.0
Bundle-Name: Basic Validation Rules Plugin

Private-Package: \
  com.acme.enforcement.plugin.validation.basic.*

Import-Package: \
  com.acme.enforcement.validation.spi;version="[1.0,2)",\
  com.acme.enforcement.case.api;version="[1.0,2)",\
  *

Provide-Capability: \
  com.acme.enforcement.plugin;\
    plugin.type=validation;\
    plugin.id=basic-validation;\
    plugin.version:Version=1.0.0
```

This lets runtime/repository tooling inspect plugin capability.

---

## 8. Declarative Services Component Design

### 8.1 Prefer Constructor Injection for Mandatory Dependencies

Example:

```java
@Component(service = CaseService.class)
public class DefaultCaseService implements CaseService {
    private final CaseRepository repository;
    private final CaseValidationEngine validationEngine;
    private final AuditService auditService;

    @Activate
    public DefaultCaseService(
            @Reference CaseRepository repository,
            @Reference CaseValidationEngine validationEngine,
            @Reference AuditService auditService) {
        this.repository = repository;
        this.validationEngine = validationEngine;
        this.auditService = auditService;
    }
}
```

Why?

Because mandatory dependencies become construction invariants.

### 8.2 Use Dynamic References Only When Runtime Change Is Intended

Bad:

```java
@Reference(policy = ReferencePolicy.DYNAMIC)
private PaymentService paymentService;
```

If the code is not designed for replacement, dynamic policy creates invisible risk.

Better:

```text
static policy for stable mandatory infrastructure;
dynamic policy for explicit plugin lists or hot-swappable strategies.
```

### 8.3 Avoid Heavy Activation

Bad activation:

```java
@Activate
void activate() {
    migrateDatabase();
    callExternalAgency();
    precomputeOneMillionRules();
}
```

Better:

- validate config quickly;
- initialize lightweight structures;
- defer heavy work;
- expose readiness based on actual dependency health;
- use explicit background worker service if needed.

### 8.4 Idempotent Deactivation

Deactivation must handle:

- partial activation;
- repeated cleanup attempt;
- async worker already stopped;
- service dependencies gone;
- config update restart.

Example:

```java
@Deactivate
void deactivate() {
    Worker worker = this.workerRef.getAndSet(null);
    if (worker != null) {
        worker.stopGracefully(Duration.ofSeconds(10));
    }
}
```

---

## 9. Configuration Model

### 9.1 Config as Runtime Contract

Example validation engine config:

```java
@ObjectClassDefinition(
    name = "Case Validation Engine",
    description = "Controls runtime behavior of the validation engine"
)
public @interface ValidationEngineConfig {
    int maxRulesPerCase() default 100;
    boolean failClosed() default true;
    String[] disabledRuleIds() default {};
}
```

Component:

```java
@Component(
    service = CaseValidationEngine.class,
    configurationPid = "com.acme.enforcement.validation.engine"
)
@Designate(ocd = ValidationEngineConfig.class)
public class DefaultCaseValidationEngine implements CaseValidationEngine {

    private final AtomicReference<RuntimeConfig> config =
        new AtomicReference<>(RuntimeConfig.defaults());

    @Activate
    void activate(ValidationEngineConfig cfg) {
        config.set(RuntimeConfig.from(cfg));
    }

    @Modified
    void modified(ValidationEngineConfig cfg) {
        config.set(RuntimeConfig.from(cfg));
    }
}
```

### 9.2 Fail Open vs Fail Closed

Validation plugin platform must define behavior when plugin fails.

Options:

| Mode | Meaning | Use Case |
|---|---|---|
| fail closed | reject/stop when rule fails unexpectedly | high-risk compliance |
| fail open | continue with warning | low-risk optional enrichment |
| quarantine | disable only failing plugin | plugin marketplace |
| degrade | use fallback rule set | operational continuity |

Top-tier design makes this explicit in config and audit.

### 9.3 Secrets Are Not Normal Config

Do not put raw secrets in Config Admin files unless environment is trusted and encrypted controls exist.

Better pattern:

```text
config contains secret reference:
  secretRef = /prod/enforcement/db/password

secret provider service resolves it:
  SecretProvider.get(secretRef)
```

This keeps OSGi config explainable without dumping secret values.

---

## 10. HTTP Entry Point

We can expose case API via HTTP Whiteboard or JAX-RS Whiteboard.

Conceptual resource:

```java
@Component(service = CaseResource.class)
public class CaseResource {

    private final CaseService caseService;

    @Activate
    public CaseResource(@Reference CaseService caseService) {
        this.caseService = caseService;
    }

    public HttpResponse submit(HttpRequest request) {
        SubmitCaseCommand command = map(request);
        SubmitCaseResult result = caseService.submit(command);
        return response(result);
    }
}
```

In real OSGi HTTP Whiteboard, registration depends on servlet/JAX-RS implementation.

Important design:

```text
HTTP DTO != domain API DTO by default.
```

Why?

Because HTTP versioning and domain service versioning may evolve differently.

Recommended layout:

```text
platform.web.http
  com.acme.enforcement.web.case.v1
  com.acme.enforcement.web.case.mapper
  com.acme.enforcement.web.common
```

Web bundle imports domain API:

```text
Import-Package:
  com.acme.enforcement.case.api;version="[1.0,2)"
```

But domain API does not import web packages.

---

## 11. Persistence Boundary

### 11.1 Repository as Service

Define repository contract in core/infrastructure boundary:

```java
public interface CaseRepository {
    CaseAggregate load(CaseId id);
    void save(CaseAggregate aggregate);
}
```

Implementation:

```java
@Component(service = CaseRepository.class)
public class JdbcCaseRepository implements CaseRepository {

    private final DataSource dataSource;

    @Activate
    public JdbcCaseRepository(@Reference DataSource dataSource) {
        this.dataSource = dataSource;
    }
}
```

### 11.2 Entity Boundary Rule

Do not expose JPA entity classes from persistence bundle as public API.

Bad:

```java
public interface CaseService {
    CaseEntity getCase(...);
}
```

Better:

```java
public interface CaseService {
    CaseView getCase(...);
}
```

Why?

Entity classes are tied to:

- persistence provider;
- enhancer/weaver;
- lazy proxy;
- transaction context;
- classloader;
- schema mapping.

They are bad plugin API.

### 11.3 Schema Migration

Schema migration must be tied to runtime release, not random plugin activation.

Recommended:

```text
platform.persistence.migration
  runs before domain services become ready
  records schema version
  exposes MigrationStatus service
```

CaseService should depend on readiness indirectly:

```text
CaseService requires CaseRepository
CaseRepository is registered only after migration status OK
```

This prevents business service from being ACTIVE while DB schema is not ready.

---

## 12. Plugin Registry

OSGi service registry is powerful, but for product-level explainability we often build a domain registry on top.

Example:

```java
public interface PluginRegistry {
    List<PluginDescriptor> plugins();
    Optional<PluginDescriptor> plugin(PluginId id);
    PluginHealth health(PluginId id);
}
```

Implementation observes services and bundle metadata:

```text
PluginRegistry
  reads service properties
  maps service -> bundle
  reads bundle symbolic name/version
  checks health marker service
  exposes operational view
```

PluginDescriptor:

```java
public record PluginDescriptor(
    PluginId id,
    String type,
    Version version,
    String bundleSymbolicName,
    Version bundleVersion,
    PluginState state,
    Map<String, Object> properties
) {}
```

Important:

```text
A bundle being ACTIVE does not mean plugin is healthy.
```

Plugin states:

```text
INSTALLED
RESOLVED
ACTIVE
REGISTERED
READY
DEGRADED
QUARANTINED
DISABLED
FAILED
```

Some states come from OSGi, some from platform layer.

---

## 13. Diagnostics Bundle

Production runtime needs explainability endpoints/commands.

Diagnostics should answer:

```text
Which bundles are installed?
Which are unresolved?
Which services implement CaseValidationRule?
Which plugin provides each rule?
Which config PID affects validation?
Which rules are disabled?
Which API package version is wired?
Which bundle exports com.acme.enforcement.validation.spi?
Which references are unsatisfied?
```

Possible commands:

```text
case:plugins
case:rules
case:rule <id>
case:health
case:config
case:wiring <bundle>
case:services <interface>
case:readiness
```

Example output:

```text
Rule ID                    Plugin Bundle                         Version  Stage       Status
missing-required-docs       plugin.validation.basic              1.0.0    SUBMISSION  READY
high-risk-amount            plugin.validation.highrisk           1.2.1    SCREENING   READY
agency-a-special-condition  plugin.escalation.agency-a           2.0.0    APPROVAL    DEGRADED
```

Diagnostics should not expose secrets.

---

## 14. Runtime Assembly With bndrun

Conceptual `local.bndrun`:

```properties
-runfw: org.apache.felix.framework

-runee: JavaSE-17

-runrequires: \
  osgi.identity;filter:='(osgi.identity=com.acme.enforcement.platform.web.http)',\
  osgi.identity;filter:='(osgi.identity=com.acme.enforcement.platform.case.core)',\
  osgi.identity;filter:='(osgi.identity=com.acme.enforcement.platform.diagnostics)',\
  osgi.identity;filter:='(osgi.identity=com.acme.enforcement.plugin.validation.basic)'

-runproperties: \
  org.osgi.framework.storage=generated/fw-cache,\
  org.osgi.framework.storage.clean=onFirstInit
```

The point of bndrun:

```text
Declare runtime requirements, let resolver compute runbundles.
```

Not:

```text
Manually copy random JARs until it starts.
```

Resolved `-runbundles` should be committed only according to team policy.

For production, prefer deterministic runtime descriptor:

- locked bundle versions;
- repository snapshot;
- release manifest;
- SBOM;
- baseline report;
- resolver report.

---

## 15. Local Development Flow

Recommended flow:

```text
1. Write API/SPI package.
2. Run baseline check.
3. Implement DS component.
4. Generate manifest with bnd.
5. Resolve local.bndrun.
6. Start runtime.
7. Inspect components/services.
8. Run in-framework tests.
9. Inject failure.
10. Check diagnostics.
```

Developer command mental model:

```text
build -> resolve -> run -> inspect -> mutate -> verify
```

Not:

```text
build -> copy jar -> hope
```

---

## 16. In-Framework Testing Strategy

### 16.1 Resolver Test

Goal:

```text
Runtime can be assembled with declared requirements.
```

Test failure examples:

- missing package exporter;
- incompatible version range;
- uses constraint violation;
- missing DS runtime;
- missing HTTP runtime;
- Java EE package removed on Java 17+;
- plugin requires wrong API major.

### 16.2 DS Component Test

Goal:

```text
Components become satisfied and active only when required dependencies/config exist.
```

Cases:

- CaseService active when repository and validation engine exist;
- CaseService inactive when repository missing;
- ValidationEngine updates when rule plugin appears;
- ValidationEngine updates when rule plugin disappears;
- config update disables rule;
- invalid config does not corrupt old runtime config.

### 16.3 Dynamic Plugin Test

Scenario:

```text
1. Start runtime without high-risk validation plugin.
2. Submit low-risk case.
3. Install high-risk plugin.
4. Submit high-risk case.
5. Update plugin config.
6. Uninstall plugin.
7. Verify validation engine still works.
```

Expected property:

```text
No stale references, no classloader leak, no undefined partial state.
```

### 16.4 Bundle Refresh Test

Refresh is dangerous.

Test:

```text
1. Start runtime.
2. Capture service graph.
3. Update SPI provider bundle.
4. Refresh affected bundles.
5. Verify impacted services rebind.
6. Verify old classes are GC eligible.
7. Verify diagnostics reports new wiring.
```

---

## 17. Failure Injection Matrix

Production-grade case study must include failure injection.

| Failure | Expected Runtime Behavior |
|---|---|
| validation plugin throws exception | rule marked failed, engine follows fail-open/fail-closed policy |
| rule service disappears during validation | current operation uses snapshot, next operation sees updated list |
| config update invalid | reject or quarantine config, keep last known good config |
| repository unavailable | CaseService readiness false, HTTP returns controlled 503 |
| plugin imports incompatible API | resolver rejects plugin before activation |
| plugin exports duplicate API | resolver/baseline policy catches or runtime diagnostics flags |
| bundle ACTIVE but component unsatisfied | readiness false, diagnostics explains missing reference |
| refresh affects API bundle | dependent bundles re-resolve/restart according to controlled plan |
| native dependency missing | plugin not ready, core runtime remains alive |
| long activation blocks startup | startup watchdog reports component activation delay |

The mindset:

```text
Every runtime dynamic feature needs a failure semantics.
```

---

## 18. Health and Readiness Model

Do not use bundle state alone.

Bad readiness:

```text
All bundles ACTIVE -> app ready
```

Better readiness:

```text
Framework started
AND required components active
AND required configs valid
AND database reachable
AND migrations complete
AND critical plugin set ready
AND HTTP endpoint registered
```

Health service:

```java
public interface PlatformHealthService {
    PlatformHealthSnapshot snapshot();
}
```

Snapshot:

```java
public record PlatformHealthSnapshot(
    HealthStatus status,
    List<HealthCheckResult> checks,
    Instant generatedAt
) {}
```

Health categories:

```text
framework
bundle
component
service
config
repository
database
http
plugin
external connector
```

---

## 19. Runtime Release Package

A production release should include:

```text
release-2026.06.18/
├── bundles/
├── config/
├── runtime/
├── checksums/
├── sbom/
├── resolver-report.json
├── baseline-report.html
├── bundle-inventory.csv
├── package-wiring-report.txt
├── service-contract-report.md
├── plugin-certification-report.md
├── release-notes.md
└── rollback-plan.md
```

Minimum inventory:

| Field | Example |
|---|---|
| bundle symbolic name | `com.acme.enforcement.platform.case.core` |
| bundle version | `1.0.3` |
| source revision | git SHA |
| exported packages | package + version |
| imported packages | package + range |
| capabilities | plugin/runtime capabilities |
| required capabilities | DS/HTTP/config/etc |
| config PIDs | list |
| services provided | interface names |
| services consumed | interface names |

This is not bureaucracy. It is how you make dynamic runtime defensible.

---

## 20. Java 8–25 Strategy for This Case Study

Recommended baseline for new production runtime:

```text
Java 17 or Java 21 minimum.
```

But because this series covers Java 8–25, we design intentionally.

### 20.1 Java 8 Compatibility

If supporting Java 8:

- avoid records in API;
- avoid sealed classes;
- avoid varhandles if not guarded;
- use older compatible bytecode;
- be careful with old javax APIs;
- Security Manager may exist but should not become sole defense.

### 20.2 Java 11+

Important changes:

- Java EE modules removed;
- JAXB/JAX-WS/Activation must become explicit dependencies;
- reflective access warnings start to matter;
- libraries relying on JDK internals may break.

### 20.3 Java 17/21

Recommended modern baseline:

- strong encapsulation is real;
- `--add-opens` must be explicit and reviewed;
- modern bytecode libraries required;
- virtual threads in Java 21 can help blocking IO, but DS activation and service lifecycle still need discipline.

### 20.4 Java 24/25

Security Manager cannot be used as real in-process sandbox foundation.

Therefore plugin risk model must use:

- trusted plugin repository;
- bundle signing;
- certification tests;
- service boundary;
- limited SPI;
- process/container isolation for untrusted code;
- audit;
- admission control.

---

## 21. Example Dependency Direction

Correct dependency direction:

```text
plugin.validation.basic
  -> platform.spi.validation
  -> platform.api.case

platform.case.core
  -> platform.api.case
  -> platform.spi.validation
  -> platform.api.audit

platform.web.http
  -> platform.api.case

platform.persistence.jdbc
  -> platform.case.core repository contract or persistence SPI
```

Avoid:

```text
platform.api.case -> platform.case.core
platform.spi.validation -> plugin.validation.basic
plugin.validation.basic -> platform.case.core.internal
platform.web.http -> platform.persistence.jdbc.internal
```

If a plugin imports `*.internal`, that is a governance failure.

---

## 22. Case Study Implementation Sequence

### Step 1 — Create API Bundles

Create:

```text
platform.api.case
platform.api.audit
```

Define stable model:

- IDs;
- commands;
- results;
- events;
- exceptions.

Rule:

```text
Do not put implementation convenience into API too early.
```

### Step 2 — Create SPI Bundles

Create:

```text
platform.spi.validation
platform.spi.escalation
```

Define extension point:

- minimal;
- versioned;
- metadata-driven;
- testable;
- not coupled to internal aggregate.

### Step 3 — Implement Core Services

Create:

```text
platform.case.core
platform.audit.core
```

Register services through DS.

### Step 4 — Add Plugin Bundles

Create:

```text
plugin.validation.basic
plugin.validation.highrisk
```

Each plugin registers SPI service.

### Step 5 — Add Configuration

Add Metatype and Config Admin PIDs:

```text
com.acme.enforcement.validation.engine
com.acme.enforcement.case.core
com.acme.enforcement.audit.core
```

### Step 6 — Add Persistence

Implement repository service.

For local test, use in-memory repository first.

Then JDBC repository.

This avoids mixing OSGi lifecycle debugging with DB debugging too early.

### Step 7 — Add HTTP

Expose minimal case endpoints.

Ensure HTTP endpoint depends on `CaseService`, not repository.

### Step 8 — Add Diagnostics

Before production hardening, add diagnostics.

Do not wait until incidents happen.

### Step 9 — Add Runtime Assembly

Use `.bndrun` or Karaf features.

Resolve runtime.

Commit release descriptor.

### Step 10 — Add Failure Injection Tests

Test dynamic behavior deliberately.

---

## 23. Sample Package Layout

```text
platform.api.case
└── src/main/java/com/acme/enforcement/case/api
    ├── CaseService.java
    ├── CaseId.java
    ├── CaseView.java
    ├── command
    │   ├── SubmitCaseCommand.java
    │   └── TransitionCaseCommand.java
    ├── event
    │   ├── CaseSubmitted.java
    │   └── CaseTransitioned.java
    └── model
        ├── CaseStage.java
        └── CaseStatus.java
```

```text
platform.spi.validation
└── src/main/java/com/acme/enforcement/validation/spi
    ├── CaseValidationRule.java
    ├── ValidationContext.java
    ├── ValidationOutcome.java
    ├── ValidationReport.java
    └── ValidationRuleId.java
```

```text
platform.case.core
└── src/main/java/com/acme/enforcement/case/core
    ├── DefaultCaseService.java
    ├── DefaultCaseValidationEngine.java
    ├── repository
    │   ├── CaseRepository.java
    │   └── InMemoryCaseRepository.java
    └── internal
        ├── CaseAggregate.java
        └── CaseStateMachine.java
```

---

## 24. Production Design Review Checklist

### 24.1 Bundle Checklist

- Does each bundle have a clear responsibility?
- Does the symbolic name follow naming policy?
- Are implementation packages private?
- Are exported packages versioned?
- Are imports version-ranged?
- Is `DynamicImport-Package` absent unless justified?
- Is `Require-Bundle` absent unless justified?
- Are embedded dependencies deliberate?
- Are Java execution requirements clear?

### 24.2 Service Checklist

- Is each service contract stable?
- Does the contract define thread-safety expectations?
- Does it define exception semantics?
- Does it avoid implementation/entity leakage?
- Are dynamic references intentionally dynamic?
- Is service ranking deterministic enough?
- Are service properties documented?
- Is stale reference avoided?

### 24.3 Configuration Checklist

- Does each PID have schema documentation?
- Are defaults safe?
- Are invalid updates handled?
- Is last-known-good config preserved if needed?
- Are secrets references, not raw values?
- Is config change audited?
- Is config drift detectable?

### 24.4 Plugin Checklist

- Does plugin depend only on API/SPI?
- Is plugin metadata complete?
- Is plugin health visible?
- Is plugin compatible with platform API range?
- Is plugin certified?
- Is plugin disable/quarantine behavior defined?
- Does plugin cleanup on deactivate?
- Does plugin avoid static global state?

### 24.5 Runtime Checklist

- Is runtime resolved before deployment?
- Is bundle inventory generated?
- Is wiring report available?
- Is baseline report clean?
- Is SBOM generated?
- Is rollback plan tested?
- Are diagnostics protected?
- Are readiness checks meaningful?

---

## 25. What Makes This Production-Grade?

Not the amount of code.

The runtime is production-grade because:

1. boundaries are explicit;
2. APIs are versioned;
3. implementation is hidden;
4. plugins are governed;
5. resolver is used before deployment;
6. config is schema-driven;
7. dynamic service changes are designed;
8. diagnostics can explain runtime state;
9. readiness is semantic, not superficial;
10. failure modes are tested;
11. deployment is reproducible;
12. rollback is planned;
13. Java version compatibility is explicit;
14. security claims are realistic.

---

## 26. Common Mistakes While Building This Runtime

### Mistake 1 — Starting With Too Many Bundles

Do not split every class into its own bundle.

Start with meaningful boundaries:

```text
api
spi
core
plugin
infrastructure
entrypoint
runtime
```

Then split only when lifecycle/versioning/deployment differs.

### Mistake 2 — Exporting Core Implementation

If plugin imports core implementation, plugin compatibility becomes impossible.

### Mistake 3 — Treating Plugin as Trusted Without Governance

A plugin is code running in your JVM.

Without process isolation, it can still damage availability, memory, CPU, and data integrity.

### Mistake 4 — Thinking `ACTIVE` Means Ready

DS component can be unsatisfied even if bundle is active.

External dependency can be down even if component is active.

### Mistake 5 — Forgetting Refresh Blast Radius

Updating an API bundle can refresh many dependent bundles.

Production update plan must know blast radius.

### Mistake 6 — Allowing Random Library Versions

OSGi gives you tools to manage versions. If you ignore them, you recreate classpath hell inside a modular runtime.

---

## 27. Suggested Minimal Implementation Milestone

If implementing this for real, do not try everything at once.

Milestone 1:

```text
API + SPI + core + one plugin + local bndrun + diagnostics
```

Milestone 2:

```text
Config Admin + plugin enable/disable + dynamic service tests
```

Milestone 3:

```text
HTTP endpoint + readiness + health
```

Milestone 4:

```text
Persistence + schema migration + transaction boundary
```

Milestone 5:

```text
Runtime packaging + resolver report + baseline + SBOM
```

Milestone 6:

```text
Failure injection + upgrade/rollback test
```

Milestone 7:

```text
Plugin certification pipeline
```

---

## 28. Mental Model Recap

A production OSGi runtime is not merely:

```text
a JVM running many bundles
```

It is:

```text
a governed runtime composition system
where dependencies, services, configuration, lifecycle,
versioning, diagnostics, and deployment are explicit.
```

For the case study:

```text
Bundle = unit of deployment and classloader identity.
Package = unit of type visibility and semantic versioning.
Service = unit of runtime collaboration.
Component = unit of lifecycle and dependency satisfaction.
Configuration = unit of runtime behavior control.
Capability = unit of resolver-level feature declaration.
Runtime descriptor = unit of deployment composition.
Diagnostics = unit of operational explainability.
```

This is the level of thinking that separates:

```text
I can run OSGi
```

from:

```text
I can design and operate an evolvable modular runtime.
```

---

## 29. Practical Exercises

### Exercise 1 — Define API/SPI Boundary

Take one domain from your own system, for example:

```text
case escalation
notification
document rendering
validation
external connector
```

Define:

- API package;
- SPI package;
- implementation package;
- plugin package;
- exported packages;
- private packages;
- version ranges.

### Exercise 2 — Design Failure Semantics

For one plugin type, define what happens if:

- plugin throws exception;
- plugin disappears;
- plugin returns invalid result;
- plugin is slow;
- plugin requires incompatible API;
- plugin config is invalid.

### Exercise 3 — Build Diagnostics Output

Design a command output that explains:

```text
which validation rules are active and why
```

Include:

- rule ID;
- plugin bundle;
- bundle version;
- service ranking;
- filter match;
- config status;
- health status.

### Exercise 4 — Define Release Evidence

Create a release checklist with:

- resolver report;
- baseline report;
- plugin certification report;
- config diff;
- bundle inventory;
- rollback plan.

---

## 30. Part Summary

Di Part 32, kita menyatukan hampir semua konsep OSGi advance ke dalam satu case study runtime.

Kita membangun blueprint untuk:

- API bundle;
- SPI bundle;
- core service bundle;
- plugin bundle;
- HTTP entrypoint;
- persistence boundary;
- diagnostics bundle;
- runtime assembly;
- configuration model;
- health/readiness;
- testing;
- failure injection;
- release packaging;
- Java 8–25 compatibility.

Inti terpenting:

```text
Production-grade OSGi bukan soal membuat bundle.
Production-grade OSGi adalah soal membuat runtime composition yang bisa berevolusi,
dijelaskan, diuji, diamankan, dan dioperasikan.
```

---

## 31. Referensi Untuk Pendalaman

Gunakan referensi berikut sebagai anchor konseptual saat mengimplementasikan case study nyata:

- OSGi Core Release 8 Specification — lifecycle, service layer, module layer, resolver, capabilities.
- OSGi Compendium Release 8 — Declarative Services, Configuration Admin, Metatype, Event Admin, HTTP Whiteboard.
- bnd / Bndtools documentation — manifest generation, resolving, baseline, bndrun, testing.
- Apache Felix documentation — framework runtime, Gogo shell, SCR, FileInstall, Web Console.
- Eclipse Equinox documentation — framework runtime, p2, extension registry, execution environments.
- Apache Karaf documentation — features, provisioning, shell, custom distribution, operations.

---

## 32. Status

```text
Part 32 selesai.
Series belum selesai.
Lanjut ke Part 33: Advanced Runtime Customization: Embedding Frameworks, Launcher Design, Hooks, Connect.
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 31 — Migration Playbooks: Legacy Classpath App to OSGi, OSGi to Modern Java, and Hybrid Systems](./31-migration-playbooks-legacy-classpath-app-to-osgi-osgi-to-modern-java-hybrid-systems.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 33 — Advanced Runtime Customization: Embedding Frameworks, Launcher Design, Hooks, Connect](./33-advanced-runtime-customization-embedding-frameworks-launcher-hooks-connect.md)
