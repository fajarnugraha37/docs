# Part 22 — Extender Pattern Internals: How OSGi Frameworks Add Runtime Semantics

> Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
> File: `22-extender-pattern-internals-runtime-semantics.md`  
> Scope: Java 8 sampai Java 25, OSGi Core/Compendium, Felix, Equinox, Karaf, bnd/Bndtools  
> Fokus: memahami bagaimana fitur runtime OSGi dibangun di atas bundle lifecycle, service registry, metadata, tracker, dan requirement/capability model.

---

## 0. Tujuan Pembelajaran

Di bagian sebelumnya kita sudah membahas bundle, classloading, dependency model, resolver, semantic versioning, service registry, Declarative Services, Configuration Admin, runtime Felix/Equinox/Karaf, HTTP, persistence, messaging, security, JPMS, Java compatibility, dan enterprise integration.

Part ini membahas salah satu pola paling penting di OSGi: **Extender Pattern**.

Setelah selesai, kamu harus bisa:

1. Menjelaskan kenapa banyak fitur OSGi modern sebenarnya bukan fitur framework core, tetapi **bundle yang memperluas semantik bundle lain**.
2. Memahami bagaimana DS, Blueprint, HTTP Whiteboard, JPA extender, SPI-Fly, annotation scanner, dan custom plugin runtime bekerja secara konseptual.
3. Mendesain extender sendiri dengan aman:
   - tracking bundle lifecycle,
   - membaca metadata,
   - memvalidasi kontrak,
   - membuat runtime object,
   - meregistrasi service,
   - membersihkan resource saat bundle berhenti,
   - menangani update/refresh.
4. Menggunakan `BundleTracker`, `ServiceTracker`, `BundleListener`, `FrameworkListener`, `ServiceComponentRuntime`, dan capability namespace dengan benar.
5. Membedakan extender pattern dari whiteboard pattern, service tracker pattern, annotation scanning, plugin registry, dan container DI tradisional.
6. Menganalisis failure modes extender:
   - target bundle sudah aktif sebelum extender start,
   - target bundle berhenti saat sedang diproses,
   - metadata invalid,
   - missing extender capability,
   - duplicate processing,
   - stale registration,
   - classloader leak,
   - race condition,
   - partial activation.
7. Membuat mental model yang cukup kuat untuk membangun platform plugin enterprise/regulatory yang runtime-semantics-nya eksplisit dan defensible.

---

## 1. Masalah yang Diselesaikan Extender Pattern

OSGi Core menyediakan mekanisme dasar:

- bundle lifecycle,
- bundle metadata,
- classloading isolation,
- dependency resolver,
- service registry,
- event model,
- security layer,
- hooks tertentu.

Tetapi banyak kebutuhan aplikasi enterprise tidak langsung disediakan oleh core framework:

- “Baca XML component description lalu instantiate component.”
- “Baca annotation servlet lalu register endpoint HTTP.”
- “Baca persistence unit lalu buat EntityManagerFactory.”
- “Baca blueprint XML lalu buat object graph.”
- “Baca custom manifest header lalu register plugin.”
- “Baca konfigurasi extension point lalu build command handler.”
- “Scan resource tertentu lalu publish service.”

Framework core tidak tahu semantik domain tersebut. Ia hanya tahu bundle, package, service, lifecycle, dan wiring.

**Extender Pattern** menyelesaikan masalah ini dengan membuat bundle khusus yang:

1. mengamati bundle lain,
2. mengenali metadata tertentu,
3. menambahkan perilaku runtime baru terhadap bundle tersebut,
4. membersihkan hasilnya saat bundle target berubah/hilang.

Contoh mental sederhana:

```text
Framework Core:
  "Saya tahu bundle A ACTIVE."

Extender:
  "Bundle A punya header Service-Component.
   Saya akan baca descriptor DS-nya,
   instantiate component-nya,
   bind reference-nya,
   dan register service-nya."
```

Jadi extender adalah cara OSGi menambahkan “container behavior” tanpa memasukkan semua container behavior ke dalam framework core.

---

## 2. Definisi Mental: Apa Itu Extender?

Secara praktis:

> Extender adalah bundle yang memperluas arti bundle lain berdasarkan metadata, resource, service, atau capability tertentu.

Extender biasanya melakukan hal berikut:

```text
1. Start
2. Track target bundles
3. Identify target metadata
4. Parse metadata
5. Validate dependencies
6. Create runtime model
7. Register services / resources / handlers
8. Monitor configuration and dependencies
9. React to update/stop/uninstall
10. Cleanup everything owned for that bundle
```

Extender bukan sekadar listener. Listener hanya menerima event. Extender membangun runtime semantic layer di atas event dan service registry.

---

## 3. Contoh Extender di Ekosistem OSGi

Beberapa extender penting:

| Extender | Metadata yang dibaca | Runtime semantic yang ditambahkan |
|---|---|---|
| Declarative Services / SCR | `Service-Component` XML | component lifecycle, dependency injection, service registration |
| Blueprint | `OSGI-INF/blueprint/*.xml` | XML-based dependency container |
| HTTP Whiteboard | service properties | servlet/filter/resource/listener registration |
| JPA extender | `META-INF/persistence.xml` | EntityManagerFactory / persistence unit management |
| CDI Integration | bean archive metadata/capabilities | CDI container lifecycle integration |
| ServiceLoader Mediator / SPI-Fly | `META-INF/services/*` | bridge Java SPI to OSGi services/classloading |
| Karaf Features | features XML | provisioning groups of bundles/config |
| Eclipse Extension Registry | `plugin.xml` | extension point model |
| Custom Rule Extender | custom header/resource | domain-specific plugin lifecycle |

Declarative Services adalah contoh paling canonical: SCR membaca component description dari bundle dan mengelola lifecycle component. OSGi specification mendeskripsikan SCR sebagai aktor yang mengelola component dan lifecycle-nya serta menyediakan introspection API. Ini menunjukkan pola extender dengan sangat jelas: bundle target hanya membawa metadata; extender-lah yang memberi metadata itu makna runtime.

---

## 4. Extender Pattern vs Whiteboard Pattern

Keduanya sering tertukar.

### 4.1 Extender Pattern

Extender melihat bundle atau resource tertentu, lalu melakukan sesuatu.

```text
Target bundle --metadata/resource/header--> Extender --runtime behavior-->
```

Contoh:

```text
Bundle has Service-Component header
SCR reads XML
SCR creates DS components
```

### 4.2 Whiteboard Pattern

Whiteboard memakai service registry sebagai papan pengumuman. Provider mendaftarkan service dengan properti tertentu. Runtime memilih service tersebut.

```text
Bundle registers Servlet service + properties
HTTP Whiteboard implementation picks it up
Endpoint becomes available
```

### 4.3 Perbedaan penting

| Aspek | Extender | Whiteboard |
|---|---|---|
| Trigger utama | bundle/resource/manifest metadata | service registration |
| Target tracking | bundle lifecycle | service lifecycle |
| Metadata source | manifest, XML, annotations, files | service properties |
| Runtime object | sering dibuat oleh extender | biasanya disediakan bundle target |
| Contoh | DS, Blueprint, JPA | HTTP Whiteboard, Event Handler whiteboard |

Namun realita bisa hybrid. HTTP Whiteboard adalah whiteboard service pattern, tetapi implementasinya sendiri adalah bundle runtime yang memperluas semantik service registration tertentu.

---

## 5. Mengapa Extender Pattern Sangat Cocok dengan OSGi

OSGi memiliki properti yang membuat extender pattern sangat natural:

1. Bundle punya lifecycle eksplisit.
2. Bundle punya metadata manifest.
3. Bundle punya classloader terisolasi.
4. Bundle dapat datang dan pergi saat runtime hidup.
5. Service registry mendukung publish/find/bind dinamis.
6. Resolver bisa mengekspresikan kebutuhan extender lewat requirement/capability.
7. Bundle dapat menyediakan resource internal yang bisa dibaca via `Bundle.getEntry`.

Tanpa OSGi, implementasi extender biasanya menjadi:

- classpath scanning global,
- custom plugin loader,
- static registry,
- manual reflection,
- uncontrolled lifecycle,
- sulit hot update,
- sulit versioning.

Di OSGi, extender dapat dibangun di atas runtime primitive yang sudah ada.

---

## 6. Core Runtime Primitive untuk Membuat Extender

Extender biasanya memakai beberapa API ini:

### 6.1 `BundleContext`

Digunakan untuk:

- mencari bundle,
- menambah listener,
- mendaftarkan service,
- mengambil service,
- membaca property framework,
- berinteraksi dengan runtime.

### 6.2 `BundleTracker`

Digunakan untuk melacak bundle berdasarkan state tertentu.

Contoh state yang umum:

- `Bundle.RESOLVED`,
- `Bundle.STARTING`,
- `Bundle.ACTIVE`,
- `Bundle.STOPPING`.

OSGi Tracker specification menyebut `BundleTracker` sebagai alat untuk menyederhanakan tracking bundle, dan extender pattern adalah contoh populer penggunaannya: extender memakai informasi dari bundle lain untuk menyediakan fungsinya.

### 6.3 `ServiceTracker`

Digunakan untuk melacak service dependency yang dibutuhkan extender.

Contoh:

- Config Admin,
- Log Service,
- Transaction Manager,
- HTTP runtime,
- custom registry service.

### 6.4 `BundleListener`

Lebih low-level dibanding `BundleTracker`. Cocok bila perlu event granularity khusus.

### 6.5 `FrameworkListener`

Digunakan untuk framework-level event:

- error,
- warning,
- package refresh,
- start level change.

### 6.6 `ServiceRegistration`

Extender sering mendaftarkan service hasil pemrosesan metadata.

### 6.7 `BundleWiring`

Digunakan untuk memahami class/resource wiring bundle.

### 6.8 `Capability` dan `Requirement`

Digunakan supaya bundle target bisa menyatakan:

```text
Saya membutuhkan extender X tersedia di runtime.
```

Ini mencegah bundle target terlihat resolve padahal runtime semantic yang dibutuhkannya tidak ada.

---

## 7. Lifecycle Mental Model Extender

Extender yang benar harus memodelkan target bundle sebagai stateful resource.

```text
Extender START
  -> open tracker
  -> discover already existing bundles
  -> process matching bundles

Target bundle INSTALLED
  -> maybe ignored until resolved/active

Target bundle RESOLVED/ACTIVE
  -> inspect metadata
  -> create runtime model
  -> register services/resources

Target bundle UPDATED/STOPPING
  -> unregister generated services
  -> close resources
  -> discard model

Target bundle UNINSTALLED
  -> final cleanup

Extender STOP
  -> close tracker
  -> cleanup all processed bundles
```

Top 1% mental model:

> Extender harus memperlakukan setiap target bundle sebagai ownership scope. Semua object, service, thread, resource, cache, dan registration yang dibuat karena bundle tersebut harus bisa dilepas saat bundle tersebut berhenti.

Jika tidak, extender akan menyebabkan memory leak, classloader leak, stale service, atau ghost endpoint.

---

## 8. Anatomy of an Extender

Extender yang matang biasanya punya komponen berikut:

```text
Extender Bundle
├── Activator / DS Component
├── BundleTracker
├── Metadata Detector
├── Metadata Parser
├── Validator
├── Runtime Model Builder
├── Dependency Binder
├── Registration Manager
├── Per-Bundle Runtime Context
├── Cleanup Manager
├── Diagnostics / Introspection Service
└── Logging / Metrics / Health
```

### 8.1 Metadata Detector

Menentukan apakah bundle target relevan.

Contoh sinyal:

- manifest header,
- resource path,
- capability,
- annotation index,
- service registration,
- naming convention.

Contoh:

```text
Service-Component: OSGI-INF/com.example.MyComponent.xml
```

Atau:

```text
Custom-Rule-Plugin: OSGI-INF/rules/*.json
```

### 8.2 Metadata Parser

Membaca metadata dari bundle target.

Parser harus:

- tidak mengasumsikan file selalu ada,
- validasi schema,
- memberikan error jelas,
- tidak memuat semua class tanpa kebutuhan,
- tidak memakai TCCL sembarangan.

### 8.3 Validator

Memastikan metadata masuk akal sebelum runtime object dibuat.

Contoh validasi:

- duplicate rule ID,
- unsupported metadata version,
- missing required class,
- incompatible API version,
- invalid service filter,
- invalid configuration schema.

### 8.4 Runtime Model Builder

Mengubah metadata menjadi model internal.

Contoh:

```text
RuleDescriptor
  id
  version
  targetCaseType
  implementationClass
  configurationPid
  requiredCapabilities
```

### 8.5 Registration Manager

Mendaftarkan service atau resource ke runtime.

Contoh:

- register `ValidationRule`,
- register servlet,
- register command,
- register health contributor,
- register event handler,
- register JPA persistence unit.

### 8.6 Per-Bundle Runtime Context

Sangat penting.

```java
final class ProcessedBundleContext {
    final Bundle bundle;
    final List<ServiceRegistration<?>> registrations = new ArrayList<>();
    final List<AutoCloseable> closeables = new ArrayList<>();
    final Map<String, Object> runtimeObjects = new HashMap<>();
}
```

Tanpa konteks per-bundle, cleanup akan kacau.

---

## 9. Minimal Extender dengan BundleTracker

Contoh konseptual:

```java
public final class RuleExtender implements BundleActivator {

    private BundleTracker<ProcessedBundle> tracker;

    @Override
    public void start(BundleContext context) {
        tracker = new BundleTracker<>(
            context,
            Bundle.RESOLVED | Bundle.ACTIVE,
            new RuleBundleTrackerCustomizer(context)
        );
        tracker.open();
    }

    @Override
    public void stop(BundleContext context) {
        if (tracker != null) {
            tracker.close();
        }
    }
}
```

Tracker customizer:

```java
final class RuleBundleTrackerCustomizer
        implements BundleTrackerCustomizer<ProcessedBundle> {

    private final BundleContext extenderContext;

    RuleBundleTrackerCustomizer(BundleContext extenderContext) {
        this.extenderContext = extenderContext;
    }

    @Override
    public ProcessedBundle addingBundle(Bundle bundle, BundleEvent event) {
        if (!hasRuleMetadata(bundle)) {
            return null;
        }

        ProcessedBundle processed = new ProcessedBundle(bundle);

        try {
            List<RuleDescriptor> descriptors = parseRules(bundle);
            validate(bundle, descriptors);

            for (RuleDescriptor descriptor : descriptors) {
                ValidationRule rule = instantiateRule(bundle, descriptor);

                Dictionary<String, Object> props = new Hashtable<>();
                props.put("rule.id", descriptor.id());
                props.put("rule.version", descriptor.version().toString());
                props.put("case.type", descriptor.caseType());

                ServiceRegistration<ValidationRule> reg =
                    extenderContext.registerService(
                        ValidationRule.class,
                        rule,
                        props
                    );

                processed.addRegistration(reg);
            }

            return processed;
        } catch (Exception e) {
            processed.closeQuietly();
            logFailure(bundle, e);
            return null;
        }
    }

    @Override
    public void modifiedBundle(Bundle bundle, BundleEvent event, ProcessedBundle processed) {
        // Usually reprocess carefully, or ignore unless metadata can change without update.
    }

    @Override
    public void removedBundle(Bundle bundle, BundleEvent event, ProcessedBundle processed) {
        if (processed != null) {
            processed.closeQuietly();
        }
    }
}
```

Catatan penting:

- `addingBundle` boleh dipanggil untuk bundle yang sudah ada saat tracker dibuka.
- `removedBundle` harus membersihkan semua registration.
- Jangan menyimpan class/object target bundle di static field extender tanpa cleanup.
- Jangan spawn thread per bundle tanpa close/interrupt.

---

## 10. Metadata Discovery Pattern

Extender harus punya cara eksplisit untuk menemukan target.

### 10.1 Manifest Header

Contoh:

```text
Custom-Rule-Plugin: OSGI-INF/rules/case-rules.json
```

Kelebihan:

- cepat,
- eksplisit,
- mudah dipakai resolver/tooling,
- tidak perlu scan seluruh JAR.

Kekurangan:

- developer harus mengisi metadata,
- build tooling harus menjaga konsistensi.

### 10.2 Resource Convention

Contoh:

```text
OSGI-INF/rules/*.json
META-INF/persistence.xml
OSGI-INF/blueprint/*.xml
```

Kelebihan:

- familiar,
- mudah di-wrap.

Kekurangan:

- scanner perlu mencari resource,
- potensi accidental activation.

### 10.3 Annotation Index

Contoh:

```text
OSGI-INF/rule-index.json
```

Kelebihan:

- build-time scanning,
- runtime lebih cepat,
- lebih compatible dengan classloader isolation.

Kekurangan:

- butuh annotation processor/plugin,
- index bisa stale jika build salah.

### 10.4 Service-Based Discovery

Whiteboard style:

```java
@Component(service = ValidationRule.class, property = {
    "case.type=APPEAL",
    "rule.id=appeal-risk-check"
})
public class AppealRiskRule implements ValidationRule { ... }
```

Kelebihan:

- dynamic natural,
- DS handles lifecycle,
- tidak perlu custom bundle tracker.

Kekurangan:

- runtime object dibuat oleh DS, bukan extender,
- kurang cocok jika extender perlu parse domain metadata kompleks sebelum expose service.

### 10.5 Capability-Based Discovery

Contoh:

```text
Provide-Capability: com.example.rule.plugin;
  rule.namespace="enforcement";
  version:Version="1.2.0"
```

Kelebihan:

- resolver-aware,
- metadata bisa masuk repository index,
- bagus untuk provisioning.

Kekurangan:

- lebih advanced,
- butuh tooling discipline.

---

## 11. `Require-Capability` dan `osgi.extender`

Masalah umum:

Bundle target membawa metadata DS, Blueprint, atau custom extender. Tetapi runtime tidak punya extender-nya.

Tanpa requirement eksplisit, bundle bisa resolve/start, tetapi metadata tidak diproses. Ini berbahaya karena sistem terlihat hidup namun fitur tidak aktif.

Karena itu OSGi menggunakan namespace extender.

Contoh umum untuk DS:

```text
Require-Capability: osgi.extender;
  filter:="(&(osgi.extender=osgi.component)(version>=1.5)(!(version>=2.0)))"
```

Maknanya:

```text
Bundle ini membutuhkan extender bernama osgi.component,
dengan versi extender tertentu,
agar metadata component-nya punya makna runtime.
```

bnd biasanya dapat menghasilkan requirement ini dari annotation/metadata tertentu.

### 11.1 Kenapa ini penting?

Tanpa `Require-Capability`, kesalahan terjadi terlambat:

```text
Bundle ACTIVE
Tetapi component tidak muncul
Service tidak terdaftar
Endpoint tidak hidup
```

Dengan `Require-Capability`, kesalahan terjadi saat resolve/provisioning:

```text
Unresolved requirement: osgi.extender=osgi.component
```

Ini jauh lebih baik karena failure menjadi eksplisit.

### 11.2 Capability Extender Custom

Untuk custom rule extender:

Extender bundle:

```text
Provide-Capability: osgi.extender;
  osgi.extender="com.example.rule.extender";
  version:Version="1.0.0"
```

Plugin bundle:

```text
Require-Capability: osgi.extender;
  filter:="(&(osgi.extender=com.example.rule.extender)(version>=1.0.0)(!(version>=2.0.0)))"
```

Ini membuat dependency runtime semantic menjadi eksplisit.

Top-tier rule:

> Jika metadata bundle tidak berguna tanpa runtime processor tertentu, bundle tersebut harus menyatakan `Require-Capability` terhadap processor/extender itu.

---

## 12. Extender dan Resolver: Jangan Membuat Semantik Tersembunyi

Extender bisa menjadi masalah bila semantik runtime tidak terlihat oleh resolver.

Contoh buruk:

```text
Bundle A punya OSGI-INF/rules/rules.json
Extender rule-extender akan membaca rules.json jika ada
Tetapi Bundle A tidak require rule-extender
```

Akibat:

- di dev runtime extender ada, fitur hidup,
- di test runtime extender lupa dipasang, bundle tetap resolve,
- di production rule tidak aktif,
- tidak ada resolver error.

Desain yang benar:

```text
Bundle A declares Require-Capability: osgi.extender=com.example.rule.extender
Runtime without extender fails at resolve/provisioning stage
```

Ini adalah prinsip defensibility:

> Runtime semantic dependency harus menjadi dependency graph, bukan assumption.

---

## 13. Extender dan ClassLoader Target Bundle

Extender biasanya perlu memuat class dari bundle target.

Contoh:

```json
{
  "ruleClass": "com.example.appeal.AppealRiskRule"
}
```

Jangan lakukan:

```java
Class<?> clazz = Class.forName(descriptor.ruleClass());
```

Karena `Class.forName` akan memakai classloader caller atau TCCL, bukan otomatis classloader bundle target.

Lebih tepat:

```java
Class<?> clazz = bundle.loadClass(descriptor.ruleClass());
```

Tetapi tetap hati-hati:

- class harus visible di bundle target,
- dependency class rule harus resolved lewat import/export,
- jangan cast ke interface yang dimuat dari classloader berbeda,
- interface kontrak harus berasal dari API package yang sama wiring-nya.

### 13.1 Cast Safety

Interface `ValidationRule` harus berasal dari API bundle yang diimpor oleh target bundle dan extender.

```text
rule-api bundle exports com.example.rule.api;version=1.0.0
rule-extender imports com.example.rule.api;version=[1.0,2)
plugin imports com.example.rule.api;version=[1.0,2)
```

Kalau plugin embed copy sendiri dari `rule-api`, maka:

```text
plugin ValidationRule != extender ValidationRule
```

Akibat:

```text
ClassCastException: AppealRiskRule cannot be cast to ValidationRule
```

Ini bukan bug Java. Ini class identity OSGi bekerja benar.

---

## 14. Extender dan TCCL

Banyak library lama memakai Thread Context ClassLoader untuk:

- XML parser discovery,
- JAXB/Jakarta XML Binding,
- ServiceLoader,
- logging provider,
- JDBC driver,
- annotation scanning,
- proxy generation.

Extender kadang perlu set TCCL sementara ke classloader target bundle.

Contoh controlled TCCL bridge:

```java
ClassLoader previous = Thread.currentThread().getContextClassLoader();
try {
    Thread.currentThread().setContextClassLoader(bundle.adapt(BundleWiring.class).getClassLoader());
    processLibraryThatUsesTCCL();
} finally {
    Thread.currentThread().setContextClassLoader(previous);
}
```

Aturan:

1. Set TCCL hanya di scope kecil.
2. Selalu restore di `finally`.
3. Jangan membiarkan worker thread membawa TCCL bundle target setelah proses selesai.
4. Jangan pakai TCCL sebagai dependency model.

Top-tier perspective:

> TCCL bridge adalah adapter untuk library lama, bukan fondasi desain OSGi.

---

## 15. Extender dan Annotation Scanning

Annotation scanning runtime sering bermasalah di OSGi karena:

- classpath global tidak ada,
- bundle classloader isolated,
- resource discovery harus per bundle,
- scanning semua class mahal,
- annotation class identity harus konsisten,
- Java 9+ strong encapsulation bisa mengganggu reflection,
- multi-release JAR bisa memengaruhi class bytes.

Strategi lebih baik:

### 15.1 Build-Time Index

Saat build:

```text
@Rule(id="appeal-risk")
class AppealRiskRule { ... }
```

Processor menghasilkan:

```text
OSGI-INF/rule-index.json
```

Runtime extender hanya membaca index.

Kelebihan:

- cepat,
- deterministic,
- mudah divalidasi,
- tidak perlu scan classpath.

### 15.2 Explicit Manifest Header

```text
Custom-Rule-Plugin: OSGI-INF/rule-index.json
```

Kelebihan:

- runtime discovery sangat murah,
- resolver/provisioning lebih jelas.

### 15.3 Controlled Reflection

Jika perlu reflection:

- gunakan `bundle.loadClass`,
- hindari scan semua package,
- validasi annotation version,
- cache per bundle dan cleanup saat bundle removed,
- jangan simpan `Class<?>` target setelah bundle stopped.

---

## 16. Declarative Services sebagai Extender

DS bukan magic. DS adalah extender/runtime yang:

1. menemukan component description dari bundle target,
2. membaca XML component descriptor,
3. memahami component implementation class,
4. mengelola activation/deactivation,
5. mengikat service reference,
6. mendaftarkan service component,
7. bereaksi terhadap config/service changes,
8. menyediakan introspection melalui SCR API.

Manifest target DS biasanya berisi:

```text
Service-Component: OSGI-INF/com.example.Foo.xml
Require-Capability: osgi.extender;filter:="(osgi.extender=osgi.component)"
```

Runtime SCR melakukan:

```text
Bundle ACTIVE/RESOLVED
  -> read Service-Component resources
  -> parse component XML
  -> create component description
  -> wait until references/config satisfied
  -> activate component
  -> register service if declared
```

DS mengajarkan prinsip extender penting:

- metadata declarative,
- runtime dynamic,
- dependency satisfaction explicit,
- introspection available,
- cleanup lifecycle-aware.

---

## 17. Blueprint sebagai Extender

Blueprint extender membaca file:

```text
OSGI-INF/blueprint/*.xml
```

Lalu membangun object graph mirip Spring XML.

Blueprint cocok untuk:

- aplikasi legacy XML config,
- Karaf-era enterprise integration,
- Apache Aries stack,
- sistem yang banyak memakai XML wiring.

Tetapi untuk desain OSGi modern, DS sering lebih sederhana dan lebih natural.

Blueprint extender failure mode:

- blueprint XML invalid,
- bean dependency missing,
- circular dependency,
- class not visible,
- lifecycle conflict dengan DS/Spring,
- startup lambat karena object graph besar,
- error tersembunyi di container log.

---

## 18. HTTP Whiteboard sebagai Runtime Processor

HTTP Whiteboard secara konseptual lebih dekat ke whiteboard service pattern, tetapi implementasinya tetap bertindak sebagai runtime processor:

```text
Bundle registers Servlet service with osgi.http.whiteboard.servlet.pattern=/cases/*
HTTP Whiteboard runtime tracks it
HTTP endpoint appears
Service unregistered
Endpoint disappears
```

Poin penting:

- target entity adalah service registration,
- metadata ada di service properties,
- lifecycle mengikuti service lifecycle,
- context selection memakai service properties,
- runtime harus unregister endpoint saat service hilang.

Ini mengajarkan bahwa extender tidak selalu harus membaca manifest/resource. Kadang ia memperluas semantik service registration.

---

## 19. JPA Extender Pattern

JPA di OSGi biasanya membutuhkan extender karena persistence unit discovery pada classpath biasa tidak cukup.

Extender membaca:

```text
META-INF/persistence.xml
```

Lalu:

- memahami persistence unit,
- menemukan provider,
- mengelola classloader entity,
- membuat `EntityManagerFactory`,
- mendaftarkan EMF sebagai service,
- berinteraksi dengan transaction service,
- cleanup saat bundle berhenti.

Failure mode:

- entity class tidak visible,
- provider class tidak visible,
- weaving gagal,
- DataSource service belum tersedia,
- persistence unit metadata tidak compatible,
- EMF leak setelah bundle update.

Prinsip:

> JPA extender harus memperlakukan persistence unit sebagai resource milik bundle target, bukan global application artifact.

---

## 20. SPI-Fly / ServiceLoader Mediator sebagai Extender

Java SPI (`ServiceLoader`) mengasumsikan classpath global:

```text
META-INF/services/com.example.Provider
```

Di OSGi, classpath global tidak ada. Setiap bundle punya visibility sendiri.

SPI-Fly/mediator pattern membantu bridging:

- membaca SPI metadata,
- mengatur classloader/TCCL,
- expose provider sebagai OSGi service atau membuat ServiceLoader bekerja di konteks tertentu.

Namun ini harus dipakai dengan hati-hati:

- jangan jadikan SPI global implicit dependency,
- prefer OSGi service registry untuk desain baru,
- pakai SPI bridge untuk library yang memang tidak OSGi-native.

---

## 21. Designing a Custom Extender: Enforcement Rule Plugin Example

Misalkan kita ingin membuat platform plugin untuk enforcement lifecycle.

Kebutuhan:

- Setiap agency/module bisa menambah validation rule.
- Rule bisa dipasang/dilepas tanpa rebuild kernel.
- Rule punya metadata:
  - ID,
  - version,
  - target case type,
  - lifecycle state,
  - severity,
  - required data scope,
  - implementation class,
  - config schema.
- Runtime harus bisa audit rule mana yang aktif.
- Jika rule invalid, bundle tidak boleh membuat sistem crash.
- Rule API harus versioned.

### 21.1 API Bundle

```text
com.example.enforcement.rule.api
```

Export:

```text
com.example.enforcement.rule.api;version=1.0.0
```

Interface:

```java
public interface EnforcementRule {
    RuleResult evaluate(RuleContext context) throws RuleEvaluationException;
}
```

DTO:

```java
public final class RuleContext { ... }
public final class RuleResult { ... }
```

### 21.2 Extender Bundle

```text
com.example.enforcement.rule.extender
```

Responsibilities:

- track rule plugin bundles,
- read rule metadata,
- validate API compatibility,
- instantiate rule classes,
- register `EnforcementRule` services,
- expose diagnostics,
- cleanup on stop/update.

Provide capability:

```text
Provide-Capability: osgi.extender;
  osgi.extender="com.example.enforcement.rule";
  version:Version="1.0.0"
```

### 21.3 Plugin Bundle

Manifest:

```text
Bundle-SymbolicName: com.example.rules.appeal
Bundle-Version: 1.2.0
Import-Package: com.example.enforcement.rule.api;version="[1.0,2.0)"
Custom-Rule-Plugin: OSGI-INF/rules/appeal-rules.json
Require-Capability: osgi.extender;
  filter:="(&(osgi.extender=com.example.enforcement.rule)(version>=1.0.0)(!(version>=2.0.0)))"
```

Metadata:

```json
{
  "schemaVersion": "1.0",
  "rules": [
    {
      "id": "appeal-risk-check",
      "version": "1.2.0",
      "caseType": "APPEAL",
      "lifecycleState": "SUBMITTED",
      "severity": "HIGH",
      "implementationClass": "com.example.rules.appeal.AppealRiskRule"
    }
  ]
}
```

Runtime service properties:

```text
rule.id=appeal-risk-check
rule.version=1.2.0
case.type=APPEAL
lifecycle.state=SUBMITTED
severity=HIGH
bundle.symbolicName=com.example.rules.appeal
bundle.version=1.2.0
```

Now the platform can query rule services dynamically.

---

## 22. Per-Bundle Ownership and Cleanup

Custom extender harus punya ownership table.

```java
final class ExtenderState {
    private final ConcurrentMap<Long, ProcessedBundle> processed = new ConcurrentHashMap<>();
}
```

`ProcessedBundle`:

```java
final class ProcessedBundle implements AutoCloseable {
    private final Bundle bundle;
    private final List<ServiceRegistration<?>> registrations = new CopyOnWriteArrayList<>();
    private final List<AutoCloseable> closeables = new CopyOnWriteArrayList<>();
    private final AtomicBoolean closed = new AtomicBoolean(false);

    ProcessedBundle(Bundle bundle) {
        this.bundle = bundle;
    }

    void addRegistration(ServiceRegistration<?> registration) {
        registrations.add(registration);
    }

    void addCloseable(AutoCloseable closeable) {
        closeables.add(closeable);
    }

    @Override
    public void close() {
        if (!closed.compareAndSet(false, true)) {
            return;
        }

        for (ServiceRegistration<?> registration : registrations) {
            try {
                registration.unregister();
            } catch (IllegalStateException ignored) {
                // Already unregistered.
            }
        }

        for (AutoCloseable closeable : closeables) {
            try {
                closeable.close();
            } catch (Exception e) {
                // Log and continue cleanup.
            }
        }
    }
}
```

Design requirements:

- cleanup idempotent,
- unregister before close if external callers must stop seeing service,
- close resources even if unregister fails,
- never throw from cleanup path if it prevents other cleanup,
- log with bundle identity.

---

## 23. Handling Already-Active Bundles

Extender bisa start setelah target bundles sudah active.

Karena itu jangan hanya mengandalkan future events.

Salah:

```java
context.addBundleListener(event -> {
    if (event.getType() == BundleEvent.STARTED) {
        process(event.getBundle());
    }
});
```

Jika extender start setelah bundle target already started, target tidak diproses.

Benar:

```java
BundleTracker<?> tracker = new BundleTracker<>(context, Bundle.ACTIVE, customizer);
tracker.open();
```

`BundleTracker.open()` akan mempertimbangkan bundle yang sudah ada sesuai state mask.

---

## 24. Handling Bundle Update and Refresh

Bundle update dapat mengubah:

- metadata,
- implementation classes,
- imported package wiring,
- resource content,
- version,
- service dependencies.

Extender harus menganggap update sebagai:

```text
old runtime model invalid
new runtime model must be built from new bundle revision
```

Cleanup harus terjadi sebelum new model exposed.

Potential sequence:

```text
Bundle STOPPING
  -> unregister old generated services
Bundle UPDATED
  -> bundle revision changes
Bundle RESOLVED/ACTIVE
  -> parse new metadata
  -> register new generated services
```

Jangan mempertahankan `Class<?>`, `Method`, `Constructor`, `ClassLoader`, atau object instance dari revision lama.

---

## 25. Extender Startup Ordering

Extender runtime sering punya dependency sendiri.

Contoh rule extender butuh:

- Log Service,
- Config Admin,
- Validation API,
- Audit service,
- Metrics service.

Masalah:

- target bundle muncul sebelum dependency extender siap,
- dependency hilang saat target sedang aktif,
- extender partially active.

Strategi:

### 25.1 DS untuk Extender Internal

Gunakan DS untuk extender itu sendiri:

```java
@Component(immediate = true)
public class RuleExtenderComponent {
    @Reference
    LogService log;

    @Reference
    ConfigurationAdmin configAdmin;

    private BundleTracker<ProcessedBundle> tracker;

    @Activate
    void activate(BundleContext context) {
        tracker = new BundleTracker<>(context, Bundle.ACTIVE, customizer());
        tracker.open();
    }

    @Deactivate
    void deactivate() {
        tracker.close();
    }
}
```

### 25.2 Graceful Degradation

Jika optional dependency hilang:

- stop accepting new target bundle,
- mark generated services degraded,
- unregister generated services,
- keep metadata parsed but inactive.

### 25.3 Explicit Capability

Jika dependency wajib untuk semantic correctness, express it as requirement.

---

## 26. Extender Error Handling Philosophy

Extender tidak boleh menjatuhkan seluruh framework hanya karena satu target bundle invalid.

Prinsip:

```text
Invalid plugin should fail closed for that plugin,
not fail open,
and not crash the platform.
```

Failure handling:

| Failure | Recommended behavior |
|---|---|
| Missing metadata file | ignore or mark bundle invalid depending header |
| Invalid metadata schema | do not register generated services; log diagnostic |
| Implementation class missing | fail target bundle processing |
| ClassCastException | fail target; report API wiring issue |
| Duplicate plugin ID | reject duplicate or deterministic winner policy |
| Optional dependency missing | degraded mode if safe |
| Mandatory dependency missing | no service registration |
| Cleanup failure | continue cleanup, emit warning |

Expose diagnostics as service:

```java
public interface RuleExtenderDiagnostics {
    List<RulePluginStatus> listPlugins();
    Optional<RulePluginStatus> getPlugin(long bundleId);
}
```

---

## 27. Diagnostics and Introspection

A production-grade extender must be observable.

At minimum expose:

- processed bundle count,
- ignored bundle count,
- failed bundle count,
- generated service count,
- metadata schema versions,
- duplicate IDs,
- processing duration,
- last error per bundle,
- extender version,
- required capability version,
- dependency status.

Example status:

```text
Bundle: com.example.rules.appeal/1.2.0
State: ACTIVE
Extender status: PROCESSED
Rules registered: 3
Metadata: OSGI-INF/rules/appeal-rules.json
API import: com.example.enforcement.rule.api [1.0,2.0)
Last processed: 2026-06-18T21:00:00+07:00
Errors: none
```

For failure:

```text
Bundle: com.example.rules.renewal/2.0.0
State: ACTIVE
Extender status: FAILED
Error code: RULE_CLASS_NOT_ASSIGNABLE
Message: com.example.renewal.RenewalRule does not implement ValidationRule from wired API package
Likely cause: plugin embeds stale copy of rule-api
```

This kind of diagnostic is top-tier because it turns classloader/resolver chaos into actionable operational data.

---

## 28. Extender and Threading

Extender often processes bundles on framework event thread or tracker callback path.

Do not perform long blocking work directly in event callback.

Bad:

```java
public ProcessedBundle addingBundle(Bundle bundle, BundleEvent event) {
    callRemoteServer();
    migrateDatabase();
    scanHugeJar();
    return processed;
}
```

Better:

- do quick metadata detection synchronously,
- schedule heavy processing on managed executor,
- expose state `PROCESSING`,
- register services only after processing complete,
- cancel processing if bundle removed.

But async processing creates race conditions:

```text
Bundle detected
Async processing starts
Bundle stops before processing finishes
Async task registers stale service
```

Use generation token:

```java
record ProcessingToken(long bundleId, long lastModified, int stateGeneration) {}
```

Or check bundle state before final registration:

```java
if (bundle.getState() != Bundle.ACTIVE) {
    processed.close();
    return;
}
```

---

## 29. Extender and Concurrency Safety

Common race conditions:

1. bundle removed while being parsed,
2. extender stopped while async processing still running,
3. duplicate processing due to modified event,
4. service dependency changed while generated service being created,
5. config update during activation,
6. multiple extenders processing same metadata,
7. old revision cleanup racing with new revision registration.

Safety patterns:

- per-bundle lock,
- idempotent processing,
- idempotent cleanup,
- atomic replace model,
- copy-on-write service lists,
- generation numbers,
- close-before-register rollback,
- state machine per bundle.

Example states:

```text
IGNORED
DETECTED
PARSING
INVALID
WAITING_FOR_DEPENDENCY
REGISTERING
ACTIVE
DEGRADED
STOPPING
REMOVED
```

Top-tier recommendation:

> Build extender state explicitly. Do not let callback order become your hidden state machine.

---

## 30. Extender and Configuration Admin

Extender may need config for itself and for target plugin.

There are two separate concerns:

### 30.1 Extender Configuration

Controls extender behavior globally:

```text
com.example.rule.extender
  strictMode=true
  duplicatePolicy=reject
  maxProcessingThreads=4
  allowExperimentalSchemas=false
```

### 30.2 Target Plugin Configuration

Controls each plugin/rule:

```text
com.example.rule.appeal-risk-check
  threshold=70
  enabled=true
```

Do not mix them.

Extender config should not be stored inside plugin metadata if operator needs runtime control.

Plugin metadata should define default and schema, not necessarily live operational value.

---

## 31. Extender and Versioned Metadata Schema

Custom extender metadata must be versioned.

Example:

```json
{
  "schemaVersion": "1.0",
  "rules": []
}
```

Schema evolution:

| Change | Compatibility |
|---|---|
| Add optional field | minor |
| Add required field | major unless default exists |
| Remove field | major |
| Change meaning of field | major |
| Add enum value | depends on consumer tolerance |
| Change validation rule | potentially behavioral breaking |

Extender should support a range:

```text
Supported schema: [1.0,2.0)
```

If metadata says `2.0`, extender 1.x should reject clearly:

```text
Unsupported schema version 2.0; supported range is [1.0,2.0)
```

---

## 32. Extender and API Compatibility

Extender must validate not only metadata version but API wiring.

Questions:

- Does plugin import the correct API package range?
- Does plugin implementation class implement expected interface?
- Is API class loaded from expected exporter?
- Are DTO classes compatible?
- Does plugin require extender version compatible with metadata?

Possible validation:

```java
Class<?> ruleApi = ValidationRule.class;
Class<?> impl = bundle.loadClass(descriptor.implementationClass());

if (!ruleApi.isAssignableFrom(impl)) {
    throw new PluginValidationException("Rule class does not implement wired ValidationRule API");
}
```

If this fails, diagnostic should mention classloader/wiring possibility, not just “bad class”.

---

## 33. Extender and Service Registration Design

Generated services should include enough properties for selection and diagnostics.

Example:

```java
Dictionary<String, Object> props = new Hashtable<>();
props.put("rule.id", descriptor.id());
props.put("rule.version", descriptor.version().toString());
props.put("case.type", descriptor.caseType());
props.put("lifecycle.state", descriptor.lifecycleState());
props.put("bundle.id", bundle.getBundleId());
props.put("bundle.symbolicName", bundle.getSymbolicName());
props.put("bundle.version", bundle.getVersion().toString());
props.put("schema.version", descriptor.schemaVersion().toString());
```

Avoid properties that expose sensitive details unnecessarily.

Service properties should be:

- stable,
- typed correctly,
- documented,
- usable in LDAP filters,
- not overloaded with business payload.

---

## 34. Extender vs Framework Hook

Do not confuse extender with framework hooks.

Extender:

- normal bundle,
- uses public lifecycle/service APIs,
- adds application/platform semantics.

Framework hook:

- low-level framework extension,
- can influence resolver/service visibility/event delivery,
- much riskier,
- should be rare.

If you can solve with extender, do not use framework hook.

Framework hooks are for runtime infrastructure-level behavior, not normal plugin processing.

---

## 35. Extender vs Custom ClassLoader

Common mistake:

> “I need plugins, so I will write my own URLClassLoader system.”

In OSGi, prefer extender over custom classloader because:

- framework already manages class identity,
- resolver handles package imports,
- lifecycle is explicit,
- service registry handles dynamic binding,
- versioning is formal,
- diagnostics are better,
- provisioning can be repository-based.

Custom classloader inside OSGi often creates double isolation and impossible debugging.

Use custom classloader only for very specific cases, such as scripting sandbox or non-JAR external content, and even then consider OSGi Connect or separate process isolation.

---

## 36. Extender and OSGi Connect

OSGi Connect lets a framework connect bundles to content managed outside the normal framework storage model.

For extender design, this matters because future/advanced systems may process plugin content not stored as normal bundle JARs.

However:

- keep metadata model independent from physical storage,
- do not assume `bundle.getLocation()` is a file path,
- use bundle/resource APIs,
- avoid `new File(bundle.getLocation())`,
- support non-file URL/resource access.

Top-tier rule:

> Extender should process bundles through OSGi abstractions, not filesystem assumptions.

---

## 37. Production Failure Modes

### 37.1 Missing Extender

Symptom:

```text
Unresolved requirement: osgi.extender=...
```

Best case: resolver fails early.

Fix:

- install extender bundle,
- correct version range,
- correct repository capability,
- ensure feature includes extender.

### 37.2 Extender Present but Not Active

Symptom:

- bundle resolves,
- metadata exists,
- generated services missing.

Check:

- extender bundle state,
- DS component state inside extender,
- missing dependency of extender,
- start level,
- logs.

### 37.3 Metadata Invalid

Symptom:

- target bundle active,
- extender reports FAILED.

Fix:

- validate metadata schema,
- run build-time validation,
- add CI test.

### 37.4 Class Not Found

Likely causes:

- class not in bundle,
- package not imported,
- implementation class private but expected incorrectly,
- generated metadata stale,
- wrong Java bytecode level.

### 37.5 ClassCastException

Likely causes:

- duplicate API package,
- embedded API JAR,
- inconsistent wiring,
- split package,
- wrong version range.

### 37.6 Stale Service After Bundle Stop

Likely causes:

- missing cleanup,
- registration not tracked,
- async task registered after removal,
- cleanup exception prevented remaining unregister.

### 37.7 ClassLoader Leak

Likely causes:

- static cache in extender holding target classes,
- thread TCCL still target classloader,
- executor thread created by target not stopped,
- generated proxy cached globally,
- service object not unregistered.

---

## 38. Testing an Extender

Testing layers:

### 38.1 Pure Unit Tests

- parser,
- schema validator,
- version compatibility,
- duplicate detection,
- property mapping.

### 38.2 Bundle Integration Tests

Run inside OSGi framework:

- install extender,
- install valid target bundle,
- assert generated service registered,
- uninstall target,
- assert service removed.

### 38.3 Resolver Tests

- target bundle requires extender,
- runtime without extender fails resolve,
- runtime with extender resolves.

### 38.4 Dynamic Tests

- target bundle installed before extender,
- extender installed before target,
- target updated,
- target stopped,
- extender stopped,
- metadata invalid,
- dependency missing,
- config updated.

### 38.5 Leak Tests

- install/uninstall plugin repeatedly,
- inspect classloader references,
- check generated service count returns to zero,
- check threads stop,
- check caches shrink.

---

## 39. Build-Time Tooling for Extender Ecosystem

For serious custom extender, do not rely only on runtime validation.

Add build tooling:

- annotation processor,
- Gradle/Maven plugin,
- bnd analyzer plugin,
- manifest header generator,
- metadata schema validator,
- baseline check,
- capability generator,
- integration test bundle generator.

Example responsibilities:

```text
Build plugin:
  - finds @EnforcementRule classes
  - validates they implement EnforcementRule
  - generates OSGI-INF/rule-index.json
  - adds Custom-Rule-Plugin header
  - adds Require-Capability for rule extender
  - validates package imports
```

This is how mature OSGi ecosystems work: runtime semantics are supported by build-time intelligence.

---

## 40. Extender Design Checklist

### 40.1 Metadata

- Is target discovery explicit?
- Is metadata schema versioned?
- Is metadata validated before runtime exposure?
- Is metadata generated at build time where possible?
- Are errors actionable?

### 40.2 Dependency

- Does target bundle require the extender capability?
- Does extender provide correct `osgi.extender` capability?
- Are API package versions explicit?
- Are optional dependencies truly optional?

### 40.3 Lifecycle

- Are already-active bundles processed?
- Are stopped/uninstalled bundles cleaned?
- Is cleanup idempotent?
- Are update/refresh semantics handled?
- Are async tasks cancelable?

### 40.4 Classloading

- Does extender use `bundle.loadClass` where needed?
- Are API packages shared through imports, not embedded copies?
- Are TCCL bridges scoped?
- Are target classes removed from caches on cleanup?

### 40.5 Runtime Safety

- Can one bad plugin fail without crashing the platform?
- Are duplicate IDs handled deterministically?
- Are generated services registered only after full validation?
- Is partial processing rolled back?

### 40.6 Observability

- Is there diagnostics API/shell/endpoint?
- Are bundle ID/symbolic name/version logged?
- Are generated services countable?
- Are last errors visible?
- Are processing durations measured?

### 40.7 Production

- Does provisioning include extender and target bundles together?
- Is rollback safe?
- Is metadata compatible with old/new extender?
- Are security boundaries clear?
- Are plugin admission and certification defined?

---

## 41. Anti-Patterns

### 41.1 Hidden Extender Dependency

Bundle metadata needs extender, but no `Require-Capability`.

Result:

- runtime silently lacks behavior.

### 41.2 Runtime Classpath Scanning

Extender scans every class in every bundle.

Result:

- slow startup,
- classloading side effects,
- annotation identity bugs.

### 41.3 Static Global Registry

Extender stores plugin classes in static maps forever.

Result:

- classloader leak after update/uninstall.

### 41.4 No Per-Bundle Cleanup

Generated services are registered but not tied to target bundle lifecycle.

Result:

- ghost services/endpoints/rules.

### 41.5 Blocking Event Callback

Extender performs long work in framework event callback.

Result:

- startup stalls,
- deadlock risk,
- unpredictable runtime delay.

### 41.6 Catch-and-Ignore

Extender catches all exceptions and ignores them.

Result:

- production feature missing with no diagnosis.

### 41.7 Overusing Extender for Simple Service Discovery

If DS + whiteboard service is enough, custom extender may be unnecessary.

Top-tier judgment:

> Build custom extender only when you need metadata-driven runtime semantics that ordinary service registration cannot express cleanly.

---

## 42. Decision Framework: Do You Need a Custom Extender?

Use a custom extender if:

- target bundles carry declarative metadata,
- runtime behavior must be generated from that metadata,
- lifecycle must follow target bundle lifecycle,
- metadata needs validation/certification,
- generated services/resources must be observable,
- plugins should not instantiate/register everything themselves,
- you need domain-specific runtime governance.

Prefer DS/whiteboard/service registry if:

- plugin can simply register service implementation,
- metadata is simple service properties,
- no complex schema/version validation,
- no generated runtime object graph,
- no special provisioning semantics.

Prefer separate process/microservice if:

- plugin is untrusted,
- strong resource isolation is required,
- plugin can crash/hang independently,
- different language/runtime is needed,
- security boundary must be hard.

---

## 43. Example Architecture: Regulatory Workflow Extender

Imagine an enforcement lifecycle platform.

Core states:

```text
DRAFT -> SUBMITTED -> SCREENING -> INVESTIGATION -> DECISION -> CLOSED
```

Different agencies want custom extensions:

- screening risk score,
- escalation rule,
- document generation rule,
- notification routing,
- SLA exception policy,
- appeal eligibility check.

A custom extender can define extension metadata:

```json
{
  "schemaVersion": "1.0",
  "extensions": [
    {
      "id": "high-risk-screening",
      "type": "SCREENING_RULE",
      "caseType": "LICENSE_RENEWAL",
      "state": "SCREENING",
      "implementationClass": "com.agency.rules.HighRiskScreeningRule",
      "requiredFacts": ["applicant", "priorCases", "financialStanding"],
      "severity": "HIGH"
    }
  ]
}
```

Extender registers:

```text
ScreeningRule service
  id=high-risk-screening
  caseType=LICENSE_RENEWAL
  state=SCREENING
  severity=HIGH
  sourceBundle=com.agency.rules
```

Workflow engine queries:

```text
(caseType=LICENSE_RENEWAL)(state=SCREENING)
```

Advantages:

- core workflow remains stable,
- agency-specific logic isolated,
- plugin lifecycle explicit,
- audit can say which rule bundle/version evaluated a case,
- rollback possible by uninstalling/updating bundle,
- compatibility enforced by API/package versioning.

This is the kind of architecture where OSGi extender pattern becomes powerful.

---

## 44. Java 8 sampai 25 Considerations

### 44.1 Java 8

- weaker encapsulation,
- Security Manager still available historically,
- many old OSGi stacks built here,
- javax libraries often assumed.

### 44.2 Java 9+

- JPMS introduced,
- strong encapsulation begins,
- reflective scanning can break,
- `--add-opens` may be needed for legacy libraries.

### 44.3 Java 11+

- Java EE modules removed,
- JAXB/JAX-WS/Activation must be explicit dependencies,
- classloading assumptions break in old extenders.

### 44.4 Java 17/21

- stronger operational baseline,
- many old bytecode/scanning libraries need upgrade,
- sealed classes/records may affect metadata reflection if used.

### 44.5 Java 24/25

- Security Manager no longer viable as sandbox foundation,
- virtual threads can help async processing but do not solve lifecycle ownership,
- modern reflection restrictions and library compatibility must be tested.

Extender implication:

> Avoid deep reflection where metadata/index can solve the problem. Treat bytecode scanning and TCCL manipulation as compatibility adapters, not the primary model.

---

## 45. Summary Mental Model

Extender Pattern is one of the most important OSGi architecture ideas.

Core essence:

```text
OSGi framework gives lifecycle + classloading + services.
Extender adds meaning to bundle metadata/service registration.
```

A good extender:

- discovers target bundles deterministically,
- expresses dependency via capability,
- parses metadata safely,
- validates before exposing runtime behavior,
- owns all generated resources per target bundle,
- cleans up on stop/update/uninstall,
- handles dynamic dependencies,
- avoids classloader leaks,
- exposes diagnostics,
- supports versioned metadata and APIs,
- fails closed per plugin, not globally.

A bad extender:

- scans everything,
- hides dependency,
- leaks classes,
- blocks event threads,
- swallows errors,
- has no per-bundle state,
- creates services that survive bundle removal,
- makes runtime behavior invisible to resolver/provisioning.

The top-tier understanding is this:

> Extender Pattern is not just an implementation trick. It is how you create new runtime semantics in OSGi while preserving lifecycle, modularity, versioning, and operational control.

---

## 46. What Comes Next

Part 23 akan membahas:

```text
Fragments, Extension Bundles, Native Code, and Low-Level Runtime Tricks
```

Topik berikutnya akan masuk ke bagian yang lebih rendah level:

- fragment bundle,
- fragment-host relationship,
- host classpath contribution,
- localization fragments,
- native code loading,
- framework extension,
- patch fragment,
- resource override,
- Java 9+ impact,
- anti-pattern fragments,
- kapan fragment berguna dan kapan berbahaya.

