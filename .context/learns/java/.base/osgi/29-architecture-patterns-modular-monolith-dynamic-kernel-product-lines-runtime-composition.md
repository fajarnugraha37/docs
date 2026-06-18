# Part 29 — Architecture Patterns: Modular Monolith, Dynamic Kernel, Product Lines, and Runtime Composition

Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
File: `29-architecture-patterns-modular-monolith-dynamic-kernel-product-lines-runtime-composition.md`  
Java scope: Java 8 sampai Java 25  
OSGi scope: OSGi Core/Compendium R7/R8-era concepts, Apache Felix, Eclipse Equinox, Apache Karaf, bnd/Bndtools

---

## 0. Tujuan Part Ini

Part sebelumnya sudah banyak membahas mekanisme: bundle, manifest, classloading, resolver, services, Declarative Services, Configuration Admin, fragments, testing, observability, performance, deployment, dan plugin governance.

Part ini naik ke level arsitektur.

Pertanyaan utamanya bukan lagi:

> Bagaimana cara membuat bundle OSGi?

Tetapi:

> Bentuk arsitektur sistem seperti apa yang masuk akal dibangun di atas OSGi, apa invariant-nya, apa trade-off-nya, dan kapan desain tersebut akan gagal?

Setelah bagian ini, kamu harus bisa membaca sebuah sistem OSGi dan menjawab:

1. Apakah ini modular monolith, dynamic kernel, plugin platform, product-line runtime, embedded runtime, edge gateway, atau campuran?
2. Boundary mana yang stabil dan mana yang volatile?
3. Apa yang harus menjadi API bundle, SPI bundle, implementation bundle, feature bundle, atau configuration/runtime assembly?
4. Apakah modularitasnya terlalu kasar, terlalu halus, atau salah axis?
5. Apakah OSGi dipakai karena memang membutuhkan runtime composition, atau hanya karena ingin terlihat modular?
6. Apa strategi evolusi, rollback, compatibility, dan operational containment-nya?
7. Kapan modul harus tetap in-process dan kapan harus diekstrak menjadi service/microservice?

OSGi bukan hanya teknologi packaging. OSGi adalah cara mendesain sistem yang bisa berubah saat runtime dengan boundary eksplisit.

---

## 1. Premis Dasar: OSGi Architecture Is Runtime Composition Architecture

Banyak engineer memahami arsitektur modular hanya sebagai struktur folder, Maven modules, Gradle projects, atau package naming.

OSGi memaksa definisi yang lebih ketat.

Dalam OSGi, modul bukan sekadar unit build. Modul adalah unit runtime yang memiliki:

- identity,
- version,
- lifecycle,
- classloader,
- import/export contract,
- capabilities,
- service registrations,
- configuration,
- wiring,
- operational state.

Karena itu, arsitektur OSGi selalu memiliki dua dimensi sekaligus:

1. **Static architecture** — apa package, API, dependency, dan bundle boundary-nya.
2. **Runtime architecture** — bundle mana yang terpasang, resolved, active, menyediakan service, tergantung pada service lain, dan bisa berubah.

Pada aplikasi Java biasa, arsitektur runtime sering collapse menjadi satu proses dengan satu classpath.

Pada OSGi, runtime tetap satu JVM, tetapi composition graph-nya eksplisit.

```text
Traditional Java App

  process
    └── single classpath
          ├── app classes
          ├── library A
          ├── library B
          └── library C

OSGi Runtime

  process / JVM
    └── OSGi framework
          ├── bundle A  classloader A  lifecycle A  services A
          ├── bundle B  classloader B  lifecycle B  services B
          ├── bundle C  classloader C  lifecycle C  services C
          └── resolver wiring graph
```

Ini memberi kekuatan besar, tetapi juga menambah disiplin. Setiap boundary yang salah akan terlihat di resolver, classloading, lifecycle, atau service dynamics.

---

## 2. Architecture Axes: Cara Memetakan Sistem OSGi

Sebelum memilih pattern, petakan sistem terhadap beberapa axis.

### 2.1 Static vs Dynamic

```text
Static system:
- dependency graph fixed at startup
- runtime jarang berubah
- deployment biasanya whole-app redeploy
- dynamic service replacement tidak penting

Dynamic system:
- module bisa hadir/hilang/update
- service provider bisa berubah
- plugin bisa enable/disable
- runtime composition adalah fitur produk
```

OSGi paling bernilai ketika ada kebutuhan dynamic runtime. Jika sistemmu static, OSGi masih bisa berguna untuk modularity discipline, tapi cost-nya harus dibenarkan.

### 2.2 Product vs Platform

```text
Product:
- satu aplikasi spesifik
- fitur relatif known
- variasi terbatas

Platform:
- menyediakan extension model
- dipakai oleh beberapa produk/tenant/customer
- butuh governance dan compatibility policy
```

OSGi jauh lebih natural untuk platform daripada aplikasi sederhana.

### 2.3 Internal Modules vs External Plugins

```text
Internal module:
- dikembangkan oleh tim yang sama
- trust tinggi
- release cadence relatif sama

External plugin:
- dikembangkan oleh tim lain/vendor/customer
- trust lebih rendah
- version compatibility harus eksplisit
- butuh certification test
```

Banyak kegagalan OSGi terjadi karena sistem memperlakukan external plugin seperti internal module.

### 2.4 Same JVM vs Distributed Boundary

OSGi memberi modularitas di dalam satu JVM. Microservices memberi modularitas antar proses/network.

```text
OSGi boundary:
- call murah
- memory shared
- transaction bisa lokal
- failure tidak otomatis isolated
- version conflict ditangani resolver/classloader

Microservice boundary:
- call mahal
- network unreliable
- data ownership lebih jelas
- failure isolated lebih kuat
- version conflict pindah ke API/protocol/schema
```

Top-tier engineer tidak bertanya “OSGi atau microservices mana yang lebih modern?”

Pertanyaan yang benar:

> Boundary ini butuh isolation, deployability, scalability, dan failure containment di level process/network, atau cukup di level module/runtime?

### 2.5 Stable Core vs Volatile Extensions

Semakin volatile sebuah area, semakin kuat alasan untuk menjadikannya extension/plugin.

```text
Stable core:
- domain identity
- lifecycle invariant
- security model
- persistence consistency
- platform APIs

Volatile extension:
- rules
- connectors
- renderers
- protocol adapters
- report templates
- feature variants
- customer-specific behavior
```

OSGi sangat cocok saat ada stable kernel + volatile extension set.

---

## 3. Pattern 1 — OSGi Modular Monolith

### 3.1 Definisi

OSGi modular monolith adalah satu aplikasi runtime dalam satu JVM, tetapi domain dan technical components dipecah menjadi bundle dengan dependency, API, dan lifecycle eksplisit.

```text
OSGi Modular Monolith

  Runtime
    ├── case-api
    ├── case-impl
    ├── appeal-api
    ├── appeal-impl
    ├── correspondence-api
    ├── correspondence-impl
    ├── document-api
    ├── document-impl
    ├── persistence
    ├── web-api
    └── platform-observability
```

Ini mirip modular monolith biasa, tetapi enforcement-nya lebih kuat karena class visibility dan service boundary nyata di runtime.

### 3.2 Kapan Cocok

Gunakan pattern ini bila:

- aplikasi besar tetapi masih satu deployment unit,
- team ingin boundary eksplisit,
- domain modules banyak,
- ingin menghindari classpath spaghetti,
- belum perlu distributed services,
- lifecycle beberapa module mungkin berbeda,
- runtime diagnostics per module berguna,
- API compatibility internal penting.

### 3.3 Kapan Tidak Cocok

Tidak cocok bila:

- aplikasi sangat kecil,
- tidak ada kebutuhan dynamic loading,
- team tidak disiplin versioning,
- semua bundle selalu dirilis bersama dan tidak ada runtime benefit,
- dependency ecosystem sulit dibuat OSGi-friendly,
- overhead tooling lebih besar daripada manfaat.

### 3.4 Struktur Bundle yang Sehat

```text
com.company.case.api
  exports: com.company.case.api
  contains: service interfaces, DTOs, value contracts

com.company.case.impl
  imports: com.company.case.api
  private: implementation, repository adapter, validators
  registers: CaseService

com.company.case.web
  imports: com.company.case.api
  registers: servlet/JAX-RS resource

com.company.case.persistence
  imports: com.company.case.api
  registers: repository services
```

Boundary penting:

- API package diekspor.
- Implementation package private.
- Web layer tidak melihat implementation class langsung.
- Persistence implementation tidak bocor sebagai entity/proxy ke bundle lain.
- Service contract menjadi primary runtime boundary.

### 3.5 Dependency Direction

```text
Bad direction:

  case-api ───────► case-impl
  appeal-api ─────► appeal-impl
  common-api ─────► everything

Good direction:

  case-impl ──────► case-api
  case-web ───────► case-api
  appeal-impl ────► appeal-api
  orchestration ──► case-api + appeal-api
```

API tidak boleh tergantung implementation.

### 3.6 Design Invariant

Modular monolith OSGi yang sehat memiliki invariant berikut:

1. Tidak ada implementation package yang diekspor hanya karena “dibutuhkan bundle lain”.
2. API bundle kecil, stabil, dan versioned.
3. Runtime dependency antar domain lewat service/interface, bukan class concrete.
4. Cross-domain call eksplisit dan bisa diobservasi.
5. Shared utility tidak menjadi dumping ground.
6. Refresh satu bundle tidak menyebabkan seluruh runtime harus restart karena dependency terlalu tangled.

### 3.7 Anti-Pattern: Distributed Monolith Thinking Inside OSGi

Kadang engineer mendesain setiap bundle seperti microservice kecil:

- terlalu banyak DTO mapping internal,
- semua call dibuat async padahal in-process,
- terlalu banyak event untuk hal yang seharusnya function call,
- data ownership dibuat terlalu kaku,
- transaksi lokal dipersulit tanpa alasan.

OSGi bukan network boundary. Jangan membawa semua ceremony microservices ke dalam satu JVM.

### 3.8 Anti-Pattern: Classpath Monolith Wearing Bundle Clothes

Kebalikannya, ada sistem yang semua bundle mengekspor semua package dan import optional semuanya.

```text
Export-Package: *
Import-Package: *;resolution:=optional
DynamicImport-Package: *
```

Ini bukan modular architecture. Ini classpath chaos yang memakai file manifest.

---

## 4. Pattern 2 — Dynamic Kernel Architecture

### 4.1 Definisi

Dynamic kernel adalah arsitektur dengan kernel kecil dan stabil yang menyediakan runtime services, lalu behavior sistem dikomposisi dari module/plugin yang bisa hadir, hilang, atau diganti.

```text
Dynamic Kernel

  kernel
    ├── lifecycle manager
    ├── config service
    ├── security service
    ├── event service
    ├── plugin registry
    ├── observability
    └── compatibility enforcement

  extensions
    ├── rule-plugin-a
    ├── connector-plugin-b
    ├── renderer-plugin-c
    └── workflow-plugin-d
```

Kernel tidak boleh tahu semua extension concrete. Kernel hanya tahu kontrak.

### 4.2 Kapan Cocok

Cocok bila sistem membutuhkan:

- plugin lifecycle,
- extensible rule engine,
- customer-specific behavior,
- runtime enable/disable,
- connector architecture,
- vendor extension,
- product variants,
- long-lived platform runtime.

### 4.3 Kernel Harus Kecil

Kesalahan umum adalah kernel tumbuh menjadi monolith baru.

Kernel seharusnya berisi:

- extension contract,
- runtime registry,
- governance enforcement,
- security/trust policy,
- configuration abstraction,
- lifecycle orchestration,
- diagnostics,
- stable platform API.

Kernel tidak seharusnya berisi:

- semua business rule,
- semua connector implementation,
- customer-specific logic,
- report-specific rendering,
- workflow-specific branching.

### 4.4 Kernel API vs Plugin SPI

Pisahkan API yang dipakai application dari SPI yang dipakai plugin.

```text
platform-api
  - stable domain-facing API
  - used by normal modules

platform-spi
  - extension points
  - implemented by plugins
  - may expose controlled runtime hooks

platform-internal
  - kernel implementation
  - never exported to plugin
```

Contoh:

```java
// API used by application modules
public interface CaseDecisionService {
    Decision decide(CaseContext context);
}

// SPI implemented by plugins
public interface DecisionRulePlugin {
    String ruleCode();
    RuleResult evaluate(RuleEvaluationContext context);
}
```

### 4.5 Kernel Must Control Composition

Plugin tidak boleh bebas memanggil semua service internal. Kernel harus mengatur composition.

```text
Bad:

  plugin ──► database
  plugin ──► user repository
  plugin ──► notification impl
  plugin ──► internal workflow engine

Good:

  plugin ──► stable SPI context
  kernel ──► platform services
  kernel ──► plugin registry
```

Plugin diberi context yang sengaja terbatas.

```java
public interface RuleEvaluationContext {
    CaseSnapshot caseSnapshot();
    Clock clock();
    FeatureFlags featureFlags();
    AuditSink auditSink();
}
```

Bukan:

```java
public interface RuleEvaluationContext {
    EntityManager entityManager();
    UserRepository userRepository();
    WorkflowEngineImpl workflowEngine();
}
```

### 4.6 Dynamic Kernel Failure Modes

| Failure | Penyebab | Mitigasi |
|---|---|---|
| Plugin breaks kernel | Plugin diberi akses internal | SPI context terbatas |
| Kernel becomes giant | Semua logic dimasukkan ke core | Enforce extension boundary |
| Runtime nondeterministic | Service ranking/filter tidak jelas | Explicit metadata + deterministic ordering |
| Update unsafe | Plugin state tidak dikelola | Drain/quiesce protocol |
| Compatibility chaos | SPI berubah tanpa baseline | Semantic version + certification |
| Security weak | Plugin trusted implicitly | Signing, repository governance, isolation |

### 4.7 Dynamic Kernel Dalam Regulatory System

Contoh untuk platform enforcement lifecycle:

```text
kernel
  ├── case lifecycle engine
  ├── escalation coordinator
  ├── audit model
  ├── rule plugin registry
  ├── document renderer registry
  ├── notification channel registry
  └── connector registry

plugins
  ├── late-submission-rule
  ├── suspicious-pattern-rule
  ├── agency-a-document-template
  ├── agency-b-connector
  └── high-risk-escalation-policy
```

Kunci desain:

- core case state machine tetap stabil,
- rule extension bisa berubah,
- audit result tetap deterministic,
- plugin version tercatat dalam decision trail,
- evaluation context immutable,
- plugin failure tidak boleh corrupt case state.

---

## 5. Pattern 3 — Product-Line Runtime

### 5.1 Definisi

Product-line runtime adalah arsitektur di mana beberapa varian produk/customer/tenant dirakit dari basis bundle yang sama dengan subset fitur berbeda.

```text
Shared platform bundles
  ├── platform-core
  ├── platform-security
  ├── platform-document
  ├── platform-audit
  └── platform-web

Product A runtime
  ├── platform-core
  ├── platform-security
  ├── product-a-rules
  ├── product-a-connectors
  └── product-a-ui

Product B runtime
  ├── platform-core
  ├── platform-security
  ├── product-b-rules
  ├── product-b-reporting
  └── product-b-ui
```

OSGi cocok karena runtime assembly bisa berbeda tanpa mengubah core.

### 5.2 Kapan Cocok

Cocok bila:

- vendor punya beberapa produk berbasis platform sama,
- customer membutuhkan fitur berbeda,
- deployment harus bisa dirakit per environment/customer,
- compatibility antar extension harus dikelola,
- bundle repository dan resolver bisa menentukan valid runtime.

### 5.3 Product-Line Axis

Varian bisa berdasarkan:

- customer,
- agency,
- region,
- regulation set,
- license tier,
- device type,
- deployment environment,
- integration partner,
- feature package.

### 5.4 Jangan Campur Product Variant ke Core

Anti-pattern:

```java
if (customer.equals("A")) {
    applyRuleA();
} else if (customer.equals("B")) {
    applyRuleB();
} else if (customer.equals("C")) {
    applyRuleC();
}
```

OSGi-friendly pattern:

```text
Customer A runtime installs:
  - rule-a.bundle

Customer B runtime installs:
  - rule-b.bundle

Kernel discovers:
  - RulePlugin services filtered by tenant/product metadata
```

### 5.5 Runtime Assembly as Architecture Artifact

Dalam product-line architecture, file runtime bukan detail deployment. Ia adalah artifact arsitektur.

Contoh artifact:

- `.bndrun`,
- Karaf `features.xml`,
- Equinox p2 product,
- custom distribution manifest,
- release bill of materials,
- OSGi repository index.

Runtime assembly menjawab:

- bundle apa yang ikut,
- versi mana,
- capability apa yang required,
- config apa yang wajib,
- extension apa yang enabled,
- compatibility baseline apa yang valid.

### 5.6 Product-Line Invariant

Sistem product-line sehat bila:

1. Core tidak tahu varian concrete.
2. Runtime assembly bisa direproduksi.
3. Resolver failure terjadi sebelum production deploy.
4. Varian punya certification test.
5. Semua varian menggunakan API/SPI version policy yang sama.
6. Difference antar varian terlihat di artifact deployment, bukan tersembunyi di `if-else`.

---

## 6. Pattern 4 — Embedded OSGi Runtime Inside Larger Application

### 6.1 Definisi

Kadang OSGi bukan keseluruhan aplikasi, tetapi embedded subsystem di dalam aplikasi lain.

```text
Spring Boot / Java Application
  ├── normal app runtime
  ├── REST API
  ├── database integration
  └── embedded OSGi plugin engine
        ├── OSGi framework
        ├── plugin API
        ├── plugin bundles
        └── plugin service registry
```

Ini sering dipakai saat aplikasi utama sudah ada, tetapi membutuhkan plugin subsystem.

### 6.2 Kapan Cocok

Cocok bila:

- aplikasi existing bukan OSGi,
- hanya satu area butuh plugin dynamics,
- ingin membatasi OSGi complexity,
- plugin system harus isolated dari main classpath,
- migration full OSGi terlalu mahal.

### 6.3 Boundary Harus Tegas

Embedded OSGi harus diperlakukan sebagai subsystem.

Bad:

```text
main app classes visible everywhere
plugin calls arbitrary Spring beans
Spring calls arbitrary plugin impl
shared static state
```

Good:

```text
main app ──► plugin gateway API
plugin gateway ──► OSGi services
plugin ──► limited SPI/context
```

### 6.4 Bridge Pattern

```java
public final class PluginEngineGateway {
    private final OsgiRuntime runtime;

    public RuleResult evaluate(String ruleCode, RuleInput input) {
        RulePlugin plugin = runtime.findRulePlugin(ruleCode);
        return plugin.evaluate(toContext(input));
    }
}
```

Main application tidak perlu tahu detail `BundleContext`, `ServiceReference`, atau resolver.

### 6.5 Embedded Runtime Failure Modes

| Failure | Penyebab | Mitigasi |
|---|---|---|
| Classloader conflict | Main app lib berbeda dengan plugin lib | API DTO minimal + package isolation |
| Lifecycle conflict | Main app shutdown tidak stop framework | explicit lifecycle adapter |
| Memory leak | Plugin class referenced by main static cache | copy DTO, no plugin class escape |
| Security leak | Plugin receives main app internals | SPI context limited |
| Observability gap | OSGi subsystem invisible | expose runtime health/metrics |

### 6.6 Java 8–25 Considerations

Pada Java 9+, embedded runtime harus memperhatikan:

- JPMS strong encapsulation,
- reflective access,
- `--add-opens`,
- TCCL bridging,
- libraries yang tidak OSGi-aware,
- multi-release JAR behavior,
- Security Manager removal untuk sandbox assumption.

---

## 7. Pattern 5 — Edge Gateway / Device Runtime

### 7.1 Definisi

OSGi secara historis kuat untuk gateway/device runtime: sistem yang berjalan lama, dekat dengan hardware/network edge, dan membutuhkan module update tanpa full OS redeploy.

```text
Edge Gateway Runtime
  ├── device-protocol-api
  ├── mqtt-connector
  ├── modbus-connector
  ├── local-cache
  ├── telemetry-uploader
  ├── rules-engine
  ├── diagnostics
  └── remote-management
```

### 7.2 Kapan Cocok

Cocok bila:

- runtime long-lived,
- koneksi remote terbatas,
- update harus granular,
- device/protocol adapters banyak,
- offline mode penting,
- operational diagnostics penting,
- footprint perlu dikontrol.

### 7.3 Edge-Specific Invariants

1. Runtime harus tetap beroperasi walau connector tertentu gagal.
2. Update tidak boleh merusak kemampuan recovery remote.
3. Management channel harus sangat aman.
4. Bundle update harus atomic atau recoverable.
5. Config dan credential harus robust terhadap power loss.
6. Local state migration harus terencana.

### 7.4 OSGi vs Container di Edge

Docker/Kubernetes bisa menjalankan OSGi, tetapi problem yang diselesaikan berbeda.

```text
Container:
- process image deployment
- OS-level isolation
- infrastructure orchestration

OSGi:
- in-process module lifecycle
- bundle/service composition
- dynamic plugin update
- package/classloader versioning
```

Untuk edge, kombinasi bisa masuk akal:

```text
container image = base runtime
OSGi bundles = managed extensions/connectors
```

---

## 8. Pattern 6 — IDE/RCP-Style Platform

### 8.1 Definisi

Eclipse RCP-style platform adalah aplikasi kaya fitur yang dibangun dari plugin/bundle dan extension points.

```text
RCP Platform
  ├── workbench/kernel
  ├── command framework
  ├── menu contributions
  ├── editor plugins
  ├── view plugins
  ├── model services
  └── update/provisioning
```

Ini adalah contoh besar dari OSGi sebagai plugin ecosystem.

### 8.2 Pelajaran Arsitektur dari Eclipse

Pelajaran penting:

- plugin API harus sangat stabil,
- extension metadata memungkinkan lazy discovery,
- extension registry berbeda dari service registry,
- UI contribution perlu ordering dan conflict management,
- p2-style provisioning penting untuk product-line runtime,
- compatibility policy menjadi budaya engineering, bukan optional.

### 8.3 Extension Registry vs Service Registry

```text
Service Registry:
- runtime object
- dynamic service availability
- service ranking/filter

Extension Registry:
- metadata contribution
- lazy activation possible
- declarative extension point
- common in Eclipse ecosystem
```

Top-tier design bisa menggabungkan keduanya:

- extension metadata untuk deklarasi,
- service registry untuk runtime behavior.

---

## 9. Pattern 7 — Integration Hub / Connector Platform

### 9.1 Definisi

Integration hub adalah platform yang mengelola banyak connector/adapters ke sistem eksternal.

```text
Integration Hub
  ├── connector-api
  ├── connector-registry
  ├── retry-policy
  ├── credential-provider
  ├── audit-logger
  ├── connector-a
  ├── connector-b
  ├── connector-c
  └── protocol adapters
```

OSGi cocok karena connector biasanya volatile dan dependency-nya berbeda-beda.

### 9.2 Mengapa OSGi Cocok untuk Connector

Connector punya karakteristik:

- library dependency berbeda,
- protocol berbeda,
- release cadence berbeda,
- vendor-specific change,
- credential/config berbeda,
- failure isolated secara logical,
- sering butuh enable/disable.

Dengan OSGi, connector bisa punya dependency private tanpa mencemari runtime lain.

### 9.3 Connector Contract

```java
public interface ExternalConnector {
    ConnectorId id();
    ConnectorCapabilities capabilities();
    ConnectorHealth health();
    ConnectorResponse execute(ConnectorRequest request);
}
```

Contract harus mencakup:

- identity,
- capability,
- health,
- timeout expectation,
- retry semantics,
- idempotency key,
- error taxonomy,
- credential reference,
- audit metadata.

### 9.4 Connector Isolation Limits

OSGi memberi classloader/module isolation, bukan process-level fault isolation.

Connector yang:

- bisa crash JVM,
- memanggil native unsafe code,
- tidak trusted,
- butuh resource limit keras,
- butuh independent scaling,

lebih aman sebagai external process/service.

---

## 10. Pattern 8 — Rule Engine / Policy Platform

### 10.1 Definisi

Rule/policy platform memungkinkan domain rules dipasang sebagai plugin.

```text
Policy Platform
  ├── policy-api
  ├── policy-spi
  ├── policy-engine
  ├── policy-registry
  ├── audit-trail
  ├── rule-plugin-a
  ├── rule-plugin-b
  └── rule-plugin-c
```

### 10.2 Kapan Cocok

Cocok bila:

- policy sering berubah,
- policy berbeda antar tenant/customer/agency,
- rule perlu versioned dan auditable,
- rule bisa certified,
- core state machine harus stabil,
- decision trail penting.

### 10.3 Rule Plugin Design

```java
public interface PolicyRule {
    RuleDescriptor descriptor();
    RuleEvaluationResult evaluate(RuleEvaluationContext context);
}
```

Descriptor harus mencakup:

- rule code,
- version,
- supported domain object,
- required capabilities,
- effective date,
- owner,
- severity,
- deterministic flag,
- audit category.

### 10.4 Determinism

Untuk regulatory/defensible systems, deterministic behavior sangat penting.

Rule plugin tidak boleh bebas:

- membaca waktu sistem langsung,
- membaca database langsung,
- memanggil remote API tanpa trace,
- menggunakan random tanpa seed,
- mengubah global state.

Gunakan controlled context:

```java
public interface RuleEvaluationContext {
    Instant evaluationTime();
    CaseSnapshot caseSnapshot();
    ReferenceDataSnapshot referenceData();
    AuditRecorder audit();
}
```

### 10.5 Audit Invariant

Setiap decision harus bisa menjawab:

- rule mana yang dievaluasi,
- versi rule mana,
- input snapshot apa,
- config apa,
- hasil apa,
- siapa owner rule,
- runtime bundle version apa,
- kenapa rule skipped/failed/applied.

OSGi bundle identity dan version bisa menjadi bagian dari audit evidence.

---

## 11. Pattern 9 — Runtime Feature Composition

### 11.1 Definisi

Fitur direpresentasikan sebagai bundle/capability/configuration composition, bukan hanya boolean flag.

```text
Feature: advanced-reporting
  requires:
    - report-api >= 2.0
    - template-engine capability
    - pdf-renderer service
    - storage service
  provides:
    - report-generator service
    - report-web endpoint
```

### 11.2 Feature Flag vs Feature Bundle

Feature flag:

- enable/disable behavior in existing code,
- murah,
- cocok untuk rollout kecil,
- bisa menumpuk technical debt.

Feature bundle:

- composition-level unit,
- dependency eksplisit,
- bisa punya lifecycle,
- lebih cocok untuk product variant,
- butuh resolver/provisioning discipline.

### 11.3 Capability-Oriented Feature Design

Daripada bergantung pada bundle name, gunakan capability.

```text
Require-Capability: com.company.feature;filter:="(feature=advanced-reporting)"
Provide-Capability: com.company.renderer;type=pdf;version:Version=2.1.0
```

Ini membuat runtime assembly lebih deklaratif.

### 11.4 Feature Dependency Graph

```text
case-management
  ├── document-management
  │     └── storage
  ├── notification
  │     └── mail-provider
  └── audit

advanced-reporting
  ├── template-engine
  ├── pdf-renderer
  └── report-storage
```

Feature graph harus diuji oleh resolver sebelum deploy.

---

## 12. Bundle Boundary Heuristics

Salah satu pertanyaan tersulit:

> Kapan sesuatu layak menjadi bundle terpisah?

### 12.1 Buat Bundle Terpisah Jika

Pertimbangkan bundle terpisah bila unit tersebut punya:

1. API boundary yang jelas.
2. Lifecycle yang berbeda.
3. Version cadence berbeda.
4. Dependency set berbeda.
5. Ownership berbeda.
6. Operational diagnostics berbeda.
7. Optionality berbeda.
8. Product/customer variant berbeda.
9. Security/trust boundary berbeda.
10. Plugin/extension semantics.

### 12.2 Jangan Buat Bundle Terpisah Jika

Jangan pecah bundle bila:

1. Hanya karena package banyak.
2. Hanya karena class count besar.
3. Semua class selalu berubah bersama.
4. Tidak ada API boundary stabil.
5. Split akan menciptakan circular dependency.
6. Split hanya memindahkan coupling ke service locator.
7. Runtime tidak pernah butuh enable/disable/update terpisah.
8. Testing dan provisioning menjadi jauh lebih kompleks tanpa manfaat.

### 12.3 Granularity Spectrum

```text
Too coarse:
  one giant bundle exports everything

Healthy:
  API bundles + implementation bundles + feature/runtime bundles

Too fine:
  one bundle per small class group, resolver graph noisy, startup slow
```

### 12.4 Practical Rule

Sebuah bundle seharusnya mewakili **runtime responsibility**, bukan sekadar folder.

Contoh baik:

- `case-api`,
- `case-impl`,
- `case-web`,
- `case-rules-spi`,
- `case-rule-high-risk`,
- `document-renderer-pdf`,
- `connector-onemap`,
- `platform-audit`.

Contoh buruk:

- `utils`,
- `helpers`,
- `common-impl`,
- `business-logic`,
- `all-services`,
- `model-everything`.

---

## 13. Service Boundary Heuristics

Tidak semua interface harus menjadi OSGi service.

### 13.1 Jadikan OSGi Service Jika

Gunakan service registry bila:

- provider bisa lebih dari satu,
- provider bisa diganti,
- consumer tidak perlu tahu implementation,
- dynamic availability penting,
- lifecycle provider berbeda,
- service menjadi extension point,
- selection via property/filter relevan,
- operational inspection berguna.

### 13.2 Jangan Jadikan OSGi Service Jika

Jangan jadikan service bila:

- hanya internal helper,
- object terlalu fine-grained,
- call sangat hot dan dependency static,
- lifecycle selalu sama dengan component owner,
- interface dibuat hanya untuk testing tanpa runtime meaning,
- dynamic behavior tidak diinginkan.

### 13.3 Service Contract Checklist

Untuk setiap service, jawab:

1. Apakah thread-safe?
2. Apakah reentrant?
3. Apakah call boleh blocking?
4. Timeout expectation?
5. Error taxonomy?
6. Idempotency?
7. Transaction boundary?
8. Dynamic replacement behavior?
9. Configuration dependency?
10. Observability signal?

---

## 14. API Bundle, SPI Bundle, Implementation Bundle

### 14.1 API Bundle

API bundle digunakan oleh consumer normal.

Isi:

- stable service interfaces,
- DTOs,
- value objects,
- enums yang carefully versioned,
- exceptions,
- annotations contract.

Tidak boleh berisi:

- implementation,
- framework-specific internals,
- persistence entity if entity leaks provider details,
- random utility,
- customer-specific behavior.

### 14.2 SPI Bundle

SPI bundle digunakan oleh extension/plugin implementer.

Isi:

- extension point interfaces,
- plugin context,
- descriptor model,
- lifecycle callback contract,
- validation/certification annotations.

SPI biasanya lebih sensitif daripada API karena perubahan kecil bisa merusak plugin ecosystem.

### 14.3 Implementation Bundle

Implementation bundle berisi concrete behavior.

- private package sebanyak mungkin,
- register service via DS,
- import API/SPI,
- tidak diekspos langsung.

### 14.4 Feature/Assembly Bundle

Kadang ada bundle yang hampir tidak berisi kode, tetapi berisi metadata/capabilities/configuration.

Ini bisa valid bila menjadi unit runtime composition.

---

## 15. Dependency Direction Patterns

### 15.1 Layered OSGi

```text
web ───────► application-api
application-impl ─► domain-api
persistence ──────► domain-api
integration ──────► connector-api
```

Layering masih berguna, tetapi jangan menjadikannya rigid jika service dynamics butuh extension.

### 15.2 Hexagonal OSGi

```text
           inbound adapters
             ├── http
             ├── scheduler
             └── messaging
                  │
                  ▼
              application service API
                  │
                  ▼
              domain core
                  ▲
                  │
           outbound ports/API
             ├── repository SPI
             ├── notification SPI
             └── connector SPI
```

OSGi cocok untuk port/adapter karena adapter bisa bundle/service terpisah.

### 15.3 Plugin-Oriented Dependency

```text
plugin ─────► platform-spi
kernel ─────► platform-spi
kernel ─────► platform-api
consumer ───► platform-api
```

Kernel menemukan plugin melalui service registry, bukan direct dependency ke plugin bundle.

### 15.4 Capability-Oriented Dependency

```text
runtime requires capability X
some bundle provides capability X
resolver selects matching provider
```

Ini cocok untuk feature/runtime assembly.

---

## 16. Data Ownership in OSGi Architecture

OSGi tidak otomatis menyelesaikan data ownership.

Dalam satu JVM, mudah tergoda semua bundle mengakses database yang sama.

### 16.1 Model 1 — Shared Database, Service Boundary

```text
bundle A ──► repository service A ──► DB
bundle B ──► service A API ────────► bundle A
```

Bundle lain tidak akses tabel A langsung.

### 16.2 Model 2 — Shared Schema, Modular Repositories

```text
case-persistence owns case tables
appeal-persistence owns appeal tables
report-persistence reads reporting views
```

Bisa praktis, tetapi perlu governance.

### 16.3 Model 3 — Plugin Data Extension

Plugin butuh data sendiri.

Opsi:

1. Plugin-specific tables.
2. JSON/document extension store.
3. Key-value plugin state store.
4. External storage per plugin.

Pilih berdasarkan:

- query need,
- migration complexity,
- audit need,
- ownership,
- rollback,
- plugin uninstall behavior.

### 16.4 Entity Leakage Problem

Jangan expose JPA entity sebagai API antar bundle jika entity membawa provider proxy/classloader assumptions.

Lebih aman:

```text
persistence entity private
service API uses DTO/value object
```

---

## 17. Transaction Boundary in OSGi Architecture

OSGi service call in-process bukan berarti semua boleh satu transaksi raksasa.

### 17.1 Transaction Boundary Choices

| Boundary | Cocok untuk | Risiko |
|---|---|---|
| Single local transaction | cohesive domain operation | cross-module coupling |
| Service-owned transaction | domain service ownership | nested transaction confusion |
| Saga/process orchestration | long-running process | complexity |
| Event/outbox | integration boundary | eventual consistency |

### 17.2 Jangan Buat Plugin Mengontrol Transaksi Core

Plugin rule sebaiknya tidak membuka/commit transaction sendiri untuk core state.

Bad:

```text
plugin receives EntityManager
plugin modifies case state
plugin commits transaction
```

Good:

```text
plugin evaluates pure decision
kernel applies decision inside controlled transaction
```

### 17.3 Transaction Invariant untuk Extensible Domain

1. Plugin boleh memberi recommendation/result.
2. Core/kernel memutuskan state mutation.
3. Audit ditulis oleh core berdasarkan plugin output.
4. Side effect eksternal lewat outbox/connector boundary.
5. Plugin failure tidak meninggalkan partial domain mutation.

---

## 18. In-Process Boundary vs Microservice Boundary

### 18.1 Pertanyaan Keputusan

Sebelum mengekstrak bundle menjadi microservice, jawab:

1. Apakah perlu independent scaling?
2. Apakah perlu independent deployment oleh team berbeda?
3. Apakah failure harus isolated secara process?
4. Apakah data ownership bisa dipisah?
5. Apakah latency/network cost acceptable?
6. Apakah contract cukup stabil untuk API remote?
7. Apakah operational maturity cukup?

Jika mayoritas “tidak”, OSGi/module boundary mungkin cukup.

### 18.2 Kapan Bundle Harus Menjadi Service Terpisah

Ekstrak ke service bila:

- resource usage besar dan berbeda,
- failure sering dan harus isolated,
- dependency native/unsafe,
- security trust rendah,
- external scaling penting,
- ownership team berbeda,
- data lifecycle berbeda,
- release cadence sangat berbeda.

### 18.3 Kapan Tetap Bundle

Tetap bundle bila:

- call sangat chatty,
- state shared kuat,
- transaction lokal penting,
- latency rendah penting,
- deployment bersama acceptable,
- failure impact manageable,
- extension dynamic lebih penting daripada network isolation.

### 18.4 Hybrid Pattern

```text
OSGi runtime
  ├── core domain
  ├── plugin engine
  ├── connector facade bundle
  └── external heavy service client
          └── calls separate service/process
```

Plugin bisa tetap in-process, tetapi heavy/unsafe work dipindahkan keluar.

---

## 19. Runtime Topology Diagrams

Dalam OSGi, diagram arsitektur harus menunjukkan lebih dari package.

### 19.1 Bundle Diagram

```text
[case-api] <── [case-impl]
    ▲             ▲
    │             │
[case-web]    [case-rule-high-risk]
```

### 19.2 Service Diagram

```text
CaseResource
   └── consumes CaseService
             ├── consumes ValidationRule[*]
             ├── consumes AuditService
             └── consumes CaseRepository
```

### 19.3 Runtime Assembly Diagram

```text
Runtime: agency-a
  framework: Felix 7.x
  Java: 21
  bundles:
    - platform-core 3.2.0
    - case-api 4.1.0
    - case-impl 4.1.3
    - agency-a-rules 2.5.0
    - document-pdf 1.8.2
```

### 19.4 Update/Refresh Blast Radius Diagram

```text
Updating case-api 4.1.0 -> 5.0.0

Affected:
  - case-impl
  - case-web
  - case-rule-high-risk
  - appeal-integration
  - report-case-summary
```

Arsitektur OSGi matang selalu punya cara melihat blast radius.

---

## 20. Architecture Decision Records untuk OSGi

Setiap keputusan besar sebaiknya punya ADR.

### 20.1 ADR: Why OSGi?

Isi:

- problem yang membutuhkan runtime modularity,
- alternative considered,
- why JPMS not sufficient,
- why microservices not chosen,
- operational cost accepted,
- team capability assumptions.

### 20.2 ADR: Runtime Distribution Choice

Felix vs Equinox vs Karaf vs embedded:

- provisioning need,
- shell/ops need,
- p2/features need,
- footprint,
- ecosystem,
- deployment target.

### 20.3 ADR: API/SPI Version Policy

- package semantic versioning,
- import range policy,
- baseline check,
- deprecation policy,
- plugin certification.

### 20.4 ADR: Hot Deploy Policy

- allowed in dev only?
- allowed in production for plugin only?
- requires quiesce/drain?
- rollback strategy?
- audit requirement?

### 20.5 ADR: Plugin Trust Model

- internal trusted,
- vendor certified,
- customer plugin,
- untrusted not allowed in-process,
- signing/repository governance.

---

## 21. Architecture Fitness Functions

Fitness function adalah automated/operational check bahwa arsitektur tetap sehat.

### 21.1 Bundle Boundary Fitness

- no implementation package exported,
- no wildcard exports,
- no `DynamicImport-Package: *`,
- no accidental `Require-Bundle`,
- import ranges valid,
- API package baseline passes.

### 21.2 Resolver Fitness

- all product runtime variants resolve in CI,
- no optional dependency required for normal operation,
- no uses constraint violation,
- no duplicate API provider,
- no unresolved bundle in release.

### 21.3 Service Fitness

- required services available,
- no circular mandatory DS references,
- component activation time bounded,
- service ranking deterministic,
- all extension services have metadata.

### 21.4 Runtime Fitness

- startup time threshold,
- readiness threshold,
- bundle active count expected,
- service count expected,
- config validation passes,
- memory/metaspace stable after update/refresh.

### 21.5 Governance Fitness

- plugin certification suite passes,
- signed bundles only,
- release BOM complete,
- SBOM generated,
- deprecated API usage tracked,
- Java version matrix green.

---

## 22. Case Study: Modular Enforcement Lifecycle Platform

### 22.1 Requirements

Bayangkan platform case management/enforcement:

- case lifecycle state machine stabil,
- escalation rule berbeda antar agency,
- document templates berubah,
- connectors ke external agencies berbeda,
- audit defensibility wajib,
- reporting bisa berbeda,
- runtime harus observable,
- plugin update harus controlled.

### 22.2 Proposed Architecture

```text
platform-kernel
  ├── lifecycle engine
  ├── audit coordinator
  ├── plugin registry
  ├── config validation
  └── health/readiness

case-api
case-impl
case-persistence
case-web

rule-spi
rule-engine
rule-plugin-late-response
rule-plugin-high-risk
rule-plugin-agency-a

document-spi
document-engine
document-template-agency-a
pdf-renderer

connector-spi
connector-engine
connector-agency-a
connector-agency-b

observability
security
configuration
runtime-distribution
```

### 22.3 Dependency Direction

```text
rule-plugin-* ─────► rule-spi
rule-engine ───────► rule-spi
case-impl ─────────► case-api + rule-spi
case-web ──────────► case-api
connector-* ───────► connector-spi
kernel ────────────► platform-api/spi
```

### 22.4 Runtime Decision Flow

```text
Case submitted
  └── CaseService starts controlled transaction
        ├── takes immutable CaseSnapshot
        ├── gets active RulePlugin snapshot
        ├── evaluates rules deterministically
        ├── records plugin versions/results
        ├── applies state transition
        ├── writes audit trail
        └── publishes integration event/outbox
```

### 22.5 Plugin Failure Handling

| Scenario | Behavior |
|---|---|
| Rule plugin missing | Rule marked unavailable, policy decides block/degrade |
| Rule plugin throws | Error captured, no partial state mutation |
| Rule plugin incompatible | Resolver/certification prevents deploy |
| Rule plugin slow | Timeout, degraded decision or fail-closed based on severity |
| Rule plugin updated | drain old evaluations, snapshot new provider for new cases |

### 22.6 Audit Record

```json
{
  "caseId": "CASE-123",
  "decision": "ESCALATE",
  "rules": [
    {
      "ruleCode": "HIGH_RISK_ENTITY",
      "bundle": "com.company.rules.highrisk",
      "bundleVersion": "2.4.1",
      "apiVersion": "3.1.0",
      "result": "MATCHED",
      "reasonCode": "ENTITY_SCORE_ABOVE_THRESHOLD"
    }
  ],
  "evaluationTime": "2026-06-18T00:00:00Z",
  "inputSnapshotHash": "...",
  "configVersion": "agency-a-policy-2026.06"
}
```

OSGi bundle identity bukan hanya technical detail. Dalam sistem defensible, ia menjadi bagian dari evidence.

---

## 23. Case Study: Product-Line Runtime per Agency

### 23.1 Runtime Variants

```text
agency-a-runtime
  - platform-core
  - case-management
  - rule-agency-a
  - connector-agency-a
  - template-agency-a

agency-b-runtime
  - platform-core
  - case-management
  - rule-agency-b
  - connector-agency-b
  - template-agency-b
```

### 23.2 Shared vs Variant

| Area | Shared | Variant |
|---|---|---|
| Case lifecycle core | Yes | No |
| Rule thresholds | No | Yes |
| Document templates | No | Yes |
| Audit model | Yes | No |
| External connector | Partial | Yes |
| UI wording | Partial | Yes |
| Security model | Yes | Configurable |

### 23.3 Deployment Model

- base distribution immutable,
- variant bundles installed per runtime,
- config packaged separately,
- resolver test per variant,
- certification test per plugin,
- release BOM per variant.

---

## 24. Common Architecture Anti-Patterns

### 24.1 “Everything Is a Bundle”

Memecah semua package menjadi bundle menyebabkan:

- resolver graph noisy,
- startup overhead,
- lifecycle complexity,
- service overuse,
- false modularity.

### 24.2 “Everything Is a Service”

Service registry bukan replacement untuk method call biasa.

Jika semua object menjadi service, kamu mendapat:

- dependency graph sulit dipahami,
- dynamic behavior yang tidak dibutuhkan,
- testing lebih sulit,
- runtime nondeterminism.

### 24.3 “Common Bundle of Doom”

`common` bundle membesar menjadi dependency semua orang.

Gejala:

- semua module import `common.*`,
- utility bercampur domain model,
- perubahan kecil memengaruhi seluruh runtime,
- API boundary menjadi kabur.

Solusi:

- pecah berdasarkan responsibility,
- domain-specific shared API,
- platform primitives kecil,
- avoid dumping ground.

### 24.4 “Plugin Has God Context”

Plugin diberi context terlalu besar:

```java
interface PluginContext {
    ApplicationContext spring();
    BundleContext bundleContext();
    EntityManager entityManager();
    DataSource dataSource();
    UserRepository users();
    WorkflowEngine engine();
}
```

Ini menghancurkan isolation.

Gunakan minimal capability-oriented context.

### 24.5 “Hot Deploy Without State Model”

OSGi bisa update bundle, tetapi aplikasi belum tentu aman diupdate.

Pertanyaan wajib:

- ada request yang sedang jalan?
- ada transaction yang sedang aktif?
- ada thread milik bundle?
- ada cache object class lama?
- ada serialized state lama?
- ada service reference stale?

Jika tidak bisa menjawab, hot deploy production berbahaya.

### 24.6 “OSGi as Security Sandbox for Untrusted Code”

Untuk Java 24/25-era, jangan mengandalkan Security Manager untuk sandbox kuat. OSGi tetap berguna untuk modularity dan governance, tetapi untrusted code butuh process/container isolation.

### 24.7 “Microservices Avoidance Excuse”

OSGi tidak menggantikan microservices jika kebutuhan sebenarnya adalah:

- independent scaling,
- blast-radius isolation,
- separate team deployment,
- process security boundary,
- independent data ownership.

Jangan memakai OSGi untuk menghindari distributed system jika distributed boundary memang dibutuhkan.

---

## 25. Architecture Review Checklist

Gunakan checklist ini saat menilai desain OSGi.

### 25.1 Runtime Fit

- Apakah ada kebutuhan runtime composition?
- Apakah module lifecycle berbeda?
- Apakah update/enable/disable per module berguna?
- Apakah plugin/variant/connector architecture nyata?
- Apakah OSGi lebih tepat daripada JPMS/classpath biasa?

### 25.2 Bundle Boundary

- Apakah setiap bundle punya runtime responsibility jelas?
- Apakah API/private boundary bersih?
- Apakah implementation package tidak diekspor?
- Apakah split package dihindari?
- Apakah dependency direction benar?

### 25.3 Service Boundary

- Apakah service benar-benar runtime contract?
- Apakah lifecycle/dynamic behavior dipahami?
- Apakah circular mandatory dependency dihindari?
- Apakah service metadata cukup untuk selection?
- Apakah service contract thread-safe/error-aware?

### 25.4 Versioning

- Apakah API package versioned?
- Apakah baseline check aktif?
- Apakah import range policy konsisten?
- Apakah multiple major version strategy jelas?
- Apakah deprecation policy ada?

### 25.5 Product/Plugin Governance

- Apakah plugin punya SPI terbatas?
- Apakah certification test ada?
- Apakah trust model jelas?
- Apakah plugin update/rollback aman?
- Apakah plugin decision auditable?

### 25.6 Operational Readiness

- Apakah runtime assembly reproducible?
- Apakah resolver test jalan di CI?
- Apakah bundle/service/component health observable?
- Apakah refresh blast radius diketahui?
- Apakah startup/readiness threshold jelas?
- Apakah rollback tested?

---

## 26. Decision Matrix: Pattern Mana yang Dipilih?

| Kebutuhan | Pattern cocok |
|---|---|
| Aplikasi besar, satu deployment, boundary kuat | OSGi Modular Monolith |
| Stable core + dynamic extensions | Dynamic Kernel |
| Banyak customer/product variant | Product-Line Runtime |
| Existing app butuh plugin subsystem | Embedded OSGi Runtime |
| Device/edge/gateway long-lived runtime | Edge Gateway Runtime |
| Desktop/plugin platform | IDE/RCP-style Platform |
| Banyak connector/protocol/vendor integration | Integration Hub |
| Rule/policy sering berubah dan perlu audit | Rule Engine/Policy Platform |
| Feature composition berdasarkan capability | Runtime Feature Composition |

---

## 27. Top 1% Mental Model

Engineer biasa melihat OSGi sebagai:

> Java plugin framework.

Engineer kuat melihat OSGi sebagai:

> Runtime composition system dengan explicit module identity, classloader isolation, lifecycle, service dynamics, resolver constraints, dan versioned contracts.

Engineer top-tier bertanya:

1. Apa yang stabil?
2. Apa yang volatile?
3. Apa yang harus bisa berubah saat runtime?
4. Apa yang harus tetap immutable untuk safety?
5. Boundary mana yang butuh process isolation?
6. Boundary mana cukup in-process?
7. Apa evidence bahwa runtime composition valid?
8. Bagaimana compatibility dijaga selama bertahun-tahun?
9. Bagaimana failure satu extension tidak merusak kernel?
10. Bagaimana operasi melihat, menguji, dan rollback composition ini?

OSGi bukan tujuan. OSGi adalah alat untuk menjaga evolusi sistem tetap terkendali.

---

## 28. Practical Architecture Exercises

### Exercise 1 — Classify Architecture

Ambil sistem existing dan klasifikasikan:

- modular monolith,
- plugin platform,
- dynamic kernel,
- product-line runtime,
- connector platform,
- hybrid.

Jelaskan kenapa.

### Exercise 2 — Bundle Boundary Review

Pilih 10 package utama. Untuk masing-masing, jawab:

- apakah perlu bundle sendiri?
- API/private boundary apa?
- siapa consumer?
- apakah lifecycle berbeda?
- apakah version cadence berbeda?

### Exercise 3 — Plugin SPI Design

Desain SPI untuk rule plugin:

- interface,
- context,
- descriptor,
- result,
- error taxonomy,
- audit metadata,
- compatibility version.

### Exercise 4 — Runtime Variant Assembly

Buat runtime assembly untuk dua customer/agency:

- shared bundles,
- variant bundles,
- config,
- capability requirements,
- resolver checks,
- certification tests.

### Exercise 5 — Extract or Keep In-Process

Pilih satu module berat. Putuskan apakah tetap OSGi bundle atau jadi microservice berdasarkan:

- scaling,
- failure isolation,
- data ownership,
- team ownership,
- latency,
- transaction,
- security.

---

## 29. Summary

OSGi architecture patterns bukan tentang membuat sebanyak mungkin bundle. Intinya adalah memilih runtime boundary yang tepat.

Pola utama:

1. **Modular Monolith** — satu runtime, boundary kuat.
2. **Dynamic Kernel** — stable core, volatile extensions.
3. **Product-Line Runtime** — assembly berbeda untuk varian berbeda.
4. **Embedded OSGi** — plugin subsystem dalam aplikasi non-OSGi.
5. **Edge Gateway** — long-lived managed runtime.
6. **IDE/RCP Platform** — plugin ecosystem dan extension metadata.
7. **Integration Hub** — connector/adapters sebagai dynamic modules.
8. **Rule/Policy Platform** — auditable versioned runtime rules.
9. **Runtime Feature Composition** — fitur sebagai capability/bundle/config composition.

OSGi memberi kemampuan kuat:

- explicit dependency,
- classloader isolation,
- dynamic service registry,
- lifecycle control,
- versioned package contracts,
- resolver-based composition,
- runtime diagnostics.

Tetapi OSGi tidak otomatis memberi:

- process isolation,
- distributed scalability,
- security sandbox kuat untuk untrusted code,
- clean architecture tanpa discipline,
- safe hot deploy tanpa state model.

Architecture OSGi yang matang selalu memiliki:

- boundary yang jelas,
- version policy,
- resolver tests,
- runtime assembly artifact,
- observability,
- rollback strategy,
- plugin governance,
- operational runbook.

---

## 30. Referensi

- OSGi Core Release 8 Specification — Framework, Module Layer, Lifecycle Layer, Service Layer, Resource/Resolver model: https://docs.osgi.org/specification/osgi.core/8.0.0/toc.html
- OSGi Architecture overview — bundles, imports/exports, collaborative runtime environment: https://www.osgi.org/resources/architecture/
- OSGi Core Release 8 Introduction: https://docs.osgi.org/specification/osgi.core/8.0.0/framework.introduction.html
- bnd/Bndtools runtime documentation — OSGi runtime as framework + classpath + configuration: https://bndtools.org/tutorial_eval/380-run.html
- OSGi enRoute resolving discussion: https://enroute.osgi.org/FAQ/200-resolving.html
- Apache Felix documentation: https://felix.apache.org/documentation/
- Eclipse Equinox documentation: https://equinox.eclipseprojects.io/
- Apache Karaf documentation: https://karaf.apache.org/manual/latest/

---

## 31. Status Series

Part 29 selesai.

Masih tersisa:

- Part 30 — Anti-Patterns and Failure Modes: The Things That Make OSGi Projects Fail
- Part 31 — Migration Playbooks: Legacy Classpath App to OSGi, OSGi to Modern Java, and Hybrid Systems
- Part 32 — Building a Production-Grade OSGi Case Study Runtime from Scratch
- Part 33 — Advanced Runtime Customization: Embedding Frameworks, Launcher Design, Hooks, Connect
- Part 34 — Top 1% OSGi Engineering: Design Reviews, Invariants, Checklists, and Decision Framework

Series belum selesai.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 28 — Designing Plugin Platforms with OSGi: Extension Contracts, Isolation, Governance](./28-designing-plugin-platforms-extension-contracts-isolation-governance.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 30 — Anti-Patterns and Failure Modes: The Things That Make OSGi Projects Fail](./30-anti-patterns-failure-modes-things-that-make-osgi-projects-fail.md)

</div>