# Part 33 — Advanced Runtime Customization: Embedding Frameworks, Launcher Design, Hooks, Connect

> Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
> File: `33-advanced-runtime-customization-embedding-frameworks-launcher-hooks-connect.md`  
> Target: Java 8 sampai Java 25  
> Level: Advanced / platform engineering / runtime engineering

---

## 0. Posisi Part Ini Dalam Series

Sampai Part 32, kita sudah membahas OSGi dari mental model, bundle, classloading, resolver, service layer, Declarative Services, configuration, web, persistence, messaging, security, JPMS, compatibility Java 8–25, testing, observability, performance, deployment, plugin platform, architecture pattern, anti-pattern, migration, sampai case study production runtime.

Part 33 bergerak ke area yang lebih rendah levelnya: **mengubah atau menanamkan runtime OSGi itu sendiri**.

Topik ini bukan untuk aplikasi OSGi biasa.

Ini untuk situasi ketika kamu membangun:

- product platform yang perlu embedded plugin engine;
- enterprise desktop/runtime product;
- integration gateway dengan dynamic modules;
- application server internal;
- IDE-style platform;
- custom launcher untuk produk on-premise;
- policy-controlled plugin runtime;
- runtime yang perlu membatasi visibility bundle tertentu;
- observability/security instrumentation di level class loading;
- compatibility bridge antara non-OSGi classpath/JPMS world dan OSGi world;
- framework extension untuk use case sangat spesifik.

Di level top 1%, pertanyaannya bukan hanya:

> “Bagaimana cara start Felix/Equinox?”

Tetapi:

> “Apa invariant runtime yang boleh dan tidak boleh saya ubah, apa blast radius-nya, dan bagaimana saya membuktikan customization ini tetap deterministic, diagnosable, secure, dan maintainable?”

---

## 1. Core Mental Model: OSGi Framework Bisa Menjadi Produk, Bukan Hanya Dependency

Pada aplikasi Java biasa, runtime biasanya dianggap sebagai sesuatu yang “sudah ada”:

```text
main() -> Spring Boot / Jakarta Runtime / application code
```

Pada OSGi, kamu bisa memperlakukan framework sebagai **runtime kernel**:

```text
Custom Launcher
  -> OSGi Framework
      -> System Bundle
      -> Resolver
      -> Bundle Lifecycle
      -> Service Registry
      -> Extenders
      -> Application Bundles
      -> Plugin Bundles
```

Artinya, kamu punya kontrol atas:

- framework implementation yang dipakai;
- framework configuration;
- bundle storage/cache;
- system packages;
- boot delegation;
- initial bundles;
- start order;
- start level;
- repository source;
- resolver policy;
- service visibility policy;
- class loading instrumentation;
- management/diagnostic surface;
- shutdown/update semantics;
- bridging ke host application.

Namun kontrol ini datang dengan risiko besar: kamu bisa membuat runtime yang **tidak lagi mudah dipahami oleh engineer lain**.

Prinsip pertama:

> Runtime customization harus memperjelas invariant, bukan menyembunyikan coupling.

---

## 2. Kapan Advanced Runtime Customization Dibutuhkan?

Tidak semua sistem OSGi perlu custom launcher atau framework hooks.

Gunakan customization runtime hanya jika ada kebutuhan nyata seperti:

### 2.1 Embedded Plugin Engine

Contoh:

```text
Host Application
  - Spring Boot / Swing / CLI / server product
  - memiliki stable API
  - ingin load plugin OSGi secara dinamis
```

OSGi framework berjalan di dalam host process.

Host mengontrol:

- kapan framework start;
- folder plugin;
- policy plugin;
- lifecycle plugin;
- API bridge antara host dan OSGi;
- shutdown.

### 2.2 Product Runtime Dengan Controlled Distribution

Contoh:

```text
/opt/product
  /bin/launcher
  /runtime/framework.jar
  /bundles
  /plugins
  /config
  /data
  /logs
```

Runtime bukan sekadar `java -jar app.jar`, tapi platform lengkap.

### 2.3 Dynamic Policy Runtime

Misalnya:

- bundle tertentu hanya boleh resolve jika tenant tertentu aktif;
- plugin experimental hanya boleh di DEV/UAT;
- connector vendor tertentu tidak boleh dipasang di environment tertentu;
- package provider harus berasal dari signed repository;
- incompatible bundle harus disembunyikan dari resolver.

Ini bisa menggunakan repository policy, resolver pre-check, atau dalam kasus sangat khusus resolver hook.

### 2.4 Instrumentation dan Observability

Misalnya:

- bytecode weaving untuk tracing;
- classload monitoring;
- method-level audit injection;
- coverage/profiling agent;
- detecting forbidden API usage.

Ini bisa menggunakan Java agent, weaving hook, build-time instrumentation, atau kombinasi.

### 2.5 Bridging Non-OSGi World

Misalnya:

- host application sudah JPMS/classpath based;
- beberapa content/plugin tidak berbentuk bundle JAR biasa;
- resource/class dikelola oleh host;
- ingin content eksternal ikut lifecycle/service layer OSGi.

OSGi Connect masuk di area ini.

---

## 3. Kapan Jangan Melakukan Customization?

Jangan customize framework jika masalahnya bisa diselesaikan dengan mekanisme standar:

| Problem | Solusi standar yang lebih sehat |
|---|---|
| Butuh component lifecycle | Declarative Services |
| Butuh plugin registry | Service registry / whiteboard / extender |
| Butuh conditional plugin | Configuration Admin + DS condition + repository policy |
| Butuh deployment set | bndrun / Karaf features / p2 |
| Butuh versioning | package version + baseline |
| Butuh dynamic endpoint | HTTP Whiteboard |
| Butuh tracing | Java agent / observability library / wrapper service |
| Butuh hide implementation | `Private-Package`, no export |
| Butuh optional feature | capability/requirement, optional import, service dynamics |

Customization runtime adalah pilihan terakhir ketika extension point standar tidak cukup.

Rule of thumb:

> Kalau kamu bisa menyelesaikan dengan bundle/service/config/repository, jangan pakai hook.

---

## 4. Framework Launching: Dari `main()` ke OSGi Runtime

OSGi menyediakan konsep `FrameworkFactory` untuk membuat instance framework.

Model sederhananya:

```java
import org.osgi.framework.Bundle;
import org.osgi.framework.BundleContext;
import org.osgi.framework.Constants;
import org.osgi.framework.launch.Framework;
import org.osgi.framework.launch.FrameworkFactory;

import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.ServiceLoader;

public final class ProductLauncher {

    public static void main(String[] args) throws Exception {
        FrameworkFactory factory = ServiceLoader
                .load(FrameworkFactory.class)
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("No OSGi FrameworkFactory found"));

        Map<String, String> config = new HashMap<>();
        config.put(Constants.FRAMEWORK_STORAGE, "./runtime-cache");
        config.put(Constants.FRAMEWORK_STORAGE_CLEAN, Constants.FRAMEWORK_STORAGE_CLEAN_ONFIRSTINIT);
        config.put(Constants.FRAMEWORK_SYSTEMPACKAGES_EXTRA, "com.example.host.api;version=1.0.0");

        Framework framework = factory.newFramework(config);

        framework.init();
        BundleContext context = framework.getBundleContext();

        installAndStart(context, Path.of("bundles/api.jar"));
        installAndStart(context, Path.of("bundles/core.jar"));
        installAndStart(context, Path.of("bundles/plugin.jar"));

        framework.start();
        framework.waitForStop(0);
    }

    private static void installAndStart(BundleContext context, Path bundlePath) throws Exception {
        Bundle bundle = context.installBundle(bundlePath.toUri().toString());
        bundle.start();
    }
}
```

Ini hanya contoh minimal.

Di production, launcher perlu jauh lebih disiplin.

---

## 5. Lifecycle Custom Launcher Yang Benar

Custom launcher harus memisahkan fase berikut:

```text
1. Parse input / environment
2. Load product configuration
3. Validate runtime layout
4. Build framework configuration
5. Create framework
6. Init framework
7. Install bootstrap bundles
8. Resolve / verify expected bundles
9. Start framework
10. Start application bundles according to policy
11. Publish management/health status
12. Wait for stop signal
13. Graceful shutdown
14. Persist diagnostics / exit code
```

Jangan campur semua logic dalam satu `main()`.

### 5.1 Launcher Architecture

Struktur yang lebih baik:

```text
product-launcher
  src/main/java
    ProductMain.java
    RuntimeLayout.java
    FrameworkConfigBuilder.java
    BundlePlanLoader.java
    BundleInstaller.java
    StartLevelPlanner.java
    HealthWaiter.java
    ShutdownCoordinator.java
    DiagnosticsWriter.java
```

Launcher adalah production component.

Ia harus punya test.

---

## 6. Runtime Layout Design

Contoh layout:

```text
product-home/
  bin/
    product
    product.bat
  lib/
    launcher.jar
    org.apache.felix.framework.jar
  system/
    org.osgi.service.component.jar
    org.apache.felix.scr.jar
    org.apache.felix.configadmin.jar
    org.apache.felix.fileinstall.jar
  bundles/
    product.api.jar
    product.core.jar
    product.web.jar
    product.persistence.jar
  plugins/
    validation-rule-tax.jar
    connector-agency-a.jar
  config/
    framework.properties
    product.properties
    pid/
      com.example.product.core.cfg
  data/
    framework-cache/
  logs/
  diagnostics/
```

Pemisahan penting:

| Folder | Isi | Mutable? |
|---|---|---|
| `lib/` | launcher dan framework | sebaiknya immutable |
| `system/` | runtime services wajib | immutable per release |
| `bundles/` | application bundles | immutable per release |
| `plugins/` | optional/customer plugins | controlled mutable atau immutable per deployment |
| `config/` | runtime config | mutable terkontrol |
| `data/framework-cache` | framework storage | mutable |
| `logs/` | logs | mutable |
| `diagnostics/` | dumps/report | mutable |

Top 1% runtime engineering selalu menjawab:

- mana artifact release;
- mana runtime state;
- mana config;
- mana cache;
- mana plugin user-supplied;
- mana diagnostics.

---

## 7. Framework Configuration: Tidak Semua Property Aman Diubah

Framework config menentukan perilaku module layer.

Contoh properti umum:

```properties
org.osgi.framework.storage=./data/framework-cache
org.osgi.framework.storage.clean=onFirstInit
org.osgi.framework.system.packages.extra=com.example.host.api;version=1.0.0
org.osgi.framework.bootdelegation=
org.osgi.framework.startlevel.beginning=10
```

### 7.1 Storage Policy

`org.osgi.framework.storage` menentukan lokasi cache.

Pertanyaan desain:

- cache persistent atau ephemeral?
- apakah cache dibersihkan setiap start?
- bagaimana bundle update dideteksi?
- bagaimana rollback bekerja?
- apakah cache corrupt bisa dipulihkan?

Untuk container immutable, sering lebih aman:

```text
framework cache ephemeral per pod/container
```

Untuk desktop/on-premise product, persistent cache bisa lebih cepat, tapi perlu recovery mode.

### 7.2 System Packages Extra

`org.osgi.framework.system.packages.extra` mengekspos package dari launcher/host classloader ke OSGi.

Contoh:

```properties
org.osgi.framework.system.packages.extra=\
  com.example.host.api;version=1.0.0,\
  com.example.host.spi;version=1.0.0
```

Gunakan sangat hati-hati.

Jika terlalu banyak package diekspos dari host, kamu merusak isolation.

Prinsip:

> Expose only stable host API packages. Never expose host implementation packages.

### 7.3 Boot Delegation

Boot delegation memungkinkan class loading tertentu didelegasikan ke parent/boot loader.

Contoh buruk:

```properties
org.osgi.framework.bootdelegation=*
```

Ini pada dasarnya mematikan manfaat OSGi classloader isolation.

Boot delegation kadang dibutuhkan untuk:

- instrumentation agent tertentu;
- JDK internal compatibility workaround lama;
- vendor library yang sangat classloader-hostile.

Tapi harus spesifik:

```properties
org.osgi.framework.bootdelegation=com.vendor.agent.*,sun.misc
```

Bahkan ini pun harus diaudit.

---

## 8. Install Plan: Jangan Scan Folder Secara Naif

Contoh buruk:

```java
Files.list(Path.of("bundles"))
     .filter(p -> p.toString().endsWith(".jar"))
     .forEach(installAndStart);
```

Masalah:

- urutan tidak deterministic;
- tidak ada expected version;
- tidak ada checksum;
- tidak ada signature validation;
- tidak ada feature grouping;
- tidak ada rollback plan;
- tidak ada dependency validation sebelum start;
- plugin berbahaya bisa ikut terinstall.

### 8.1 Bundle Plan

Gunakan manifest deployment plan:

```yaml
runtime:
  id: enforcement-platform
  version: 2026.06.18
  framework: felix
  java: "[17,26)"

bundles:
  - symbolicName: com.example.enforcement.api
    version: 1.4.0
    file: bundles/com.example.enforcement.api-1.4.0.jar
    sha256: "..."
    start: false
    startLevel: 1

  - symbolicName: com.example.enforcement.core
    version: 2.1.3
    file: bundles/com.example.enforcement.core-2.1.3.jar
    sha256: "..."
    start: true
    startLevel: 5

plugins:
  - symbolicName: com.example.enforcement.rules.highrisk
    version: 1.2.0
    file: plugins/highrisk-rule-1.2.0.jar
    sha256: "..."
    trust: certified
    start: true
    startLevel: 20
```

Launcher membaca plan, memvalidasi, baru install.

---

## 9. Start Level Planning

Start level bukan dependency solver.

Start level hanya mengatur **urutan start kasar**.

Contoh:

```text
Start Level 1  : API bundles, logging facade
Start Level 2  : Config Admin, SCR, Event Admin
Start Level 3  : infrastructure services
Start Level 5  : core domain services
Start Level 8  : persistence/web/messaging adapters
Start Level 10 : application entrypoints
Start Level 20 : plugins
```

Jangan gunakan start level untuk menutupi dependency model yang salah.

Jika bundle hanya bisa start setelah bundle lain karena service dependency, gunakan DS reference, bukan start-level hack.

---

## 10. Embedded OSGi Dalam Host Application

Ada dua model embedding utama.

### 10.1 Host Outside, OSGi Inside

```text
Host Application
  -> starts OSGi framework
  -> exposes host API to OSGi
  -> receives callbacks/services from OSGi
```

Cocok untuk:

- plugin engine;
- desktop app;
- product platform;
- existing monolith yang ingin extension island.

### 10.2 OSGi As Main Runtime

```text
Launcher
  -> OSGi framework
      -> app bundles own the application
```

Cocok untuk:

- native OSGi product;
- Karaf-like distribution;
- Equinox RCP/headless product;
- modular server runtime.

### 10.3 Host/OSGi Boundary

Jangan biarkan host dan OSGi saling memanggil implementation class langsung.

Gunakan stable API:

```text
host-api.jar
  com.example.host.api.PluginContribution
  com.example.host.api.HostContext
```

OSGi plugin mengimplementasikan API.

Host mengambil service dari OSGi registry atau lewat bridge.

---

## 11. Host Bridge Pattern

Contoh host ingin memanggil service OSGi:

```java
public final class OsgiPluginBridge implements AutoCloseable {
    private final Framework framework;
    private final BundleContext context;

    public OsgiPluginBridge(Framework framework) {
        this.framework = framework;
        this.context = framework.getBundleContext();
    }

    public <T> T getRequiredService(Class<T> type) {
        var ref = context.getServiceReference(type);
        if (ref == null) {
            throw new IllegalStateException("Required service not available: " + type.getName());
        }
        T service = context.getService(ref);
        if (service == null) {
            throw new IllegalStateException("Service disappeared: " + type.getName());
        }
        return service;
    }

    @Override
    public void close() throws Exception {
        framework.stop();
        framework.waitForStop(10_000L);
    }
}
```

Namun contoh ini masih terlalu sederhana karena service bisa disappear.

Untuk production, bridge harus:

- track service dynamically;
- handle missing service;
- expose readiness state;
- avoid leaking service object after unregister;
- unget service properly;
- publish diagnostics.

---

## 12. Host API Export Strategy

Ada beberapa strategi.

### 12.1 Host API Sebagai System Package

Host package diekspos via `system.packages.extra`.

Kelebihan:

- mudah;
- host dan plugin melihat class API yang sama.

Kekurangan:

- host API terikat ke launcher classloader;
- versioning bisa sulit;
- sulit side-by-side major versions.

### 12.2 Host API Sebagai Bundle Biasa

Host API dikemas sebagai bundle:

```text
com.example.host.api-1.0.0.jar
```

Launcher menginstall bundle API.

Host juga memakai JAR API yang sama di classpath.

Kelebihan:

- OSGi-native;
- versioning jelas;
- baseline bisa jalan;
- package export standard.

Kekurangan:

- harus hati-hati class identity antara host classpath dan OSGi bundle;
- jika host memuat class API dari classpath, plugin memuat dari bundle, bisa terjadi class identity mismatch.

Solusi:

- letakkan API di parent classloader dan expose as system package; atau
- host tidak melakukan cast langsung ke object plugin, melainkan memakai serialization/DTO bridge; atau
- gunakan framework embedding model yang memastikan API class identity tunggal.

### 12.3 IPC Boundary

Jika plugin tidak trusted atau butuh isolation kuat, jangan embedded in-process.

Gunakan:

```text
Host -> local process plugin runtime -> IPC/RPC
```

OSGi tetap bisa dipakai di process plugin, tapi isolation OS-level lebih kuat.

---

## 13. Framework Hooks: Apa Itu dan Mengapa Berbahaya?

OSGi Core menyediakan hook services untuk memengaruhi perilaku framework.

Kategori penting:

- Resolver Hook;
- Bundle Hooks;
- Service Hooks;
- Weaving Hook;
- Woven Class Listener.

Hook adalah level rendah.

Ia bisa memengaruhi:

- bundle mana terlihat;
- service mana terlihat;
- resolver memilih provider apa;
- class bytecode sebelum didefinisikan;
- event mana sampai ke listener.

Dengan kata lain, hook bisa mengubah “hukum fisika” runtime.

Prinsip:

> Hook harus diperlakukan seperti kernel extension, bukan application feature.

---

## 14. Resolver Hook

Resolver Hook memungkinkan bundle memengaruhi proses resolve.

Secara konseptual:

```text
Resolver collects candidates
  -> resolver hook can remove candidates
  -> resolver computes wiring
```

Resolver hook tidak seharusnya menambah candidate sembarangan. Ia biasanya membatasi visibility atau policy.

Use case:

- hide experimental bundles;
- enforce tenant/product edition constraints;
- prevent wiring to non-certified provider;
- isolate plugin groups;
- implement region-like policy;
- avoid certain package providers.

### 14.1 Contoh Policy

```text
Plugin A hanya boleh wire ke:
  - platform API bundles
  - certified library bundles
  - bundles in same plugin region
```

Resolver hook bisa menghapus candidate yang tidak sesuai.

Namun ada risiko:

- resolver error menjadi sulit dipahami;
- wiring berbeda antara environment;
- policy tidak terlihat dari manifest;
- debugging lebih berat;
- update bisa gagal dengan pesan yang tidak intuitif.

### 14.2 Better Alternative

Sebelum resolver hook, pertimbangkan:

- repository filtering;
- deployment plan validation;
- capability/requirement;
- feature repository;
- region/subsystem model;
- separate framework instance;
- process isolation.

Resolver hook cocok jika policy memang harus enforce di framework level.

---

## 15. Bundle Hooks

Bundle hooks dapat memengaruhi bundle lifecycle/event/find behavior.

Kategori umum:

- event hook;
- find hook;
- collision hook.

Use case:

- hide bundle tertentu dari bundle lain;
- filter bundle events;
- enforce symbolic name collision policy;
- region isolation.

Contoh conceptual:

```text
Plugin tenant-A tidak boleh melihat bundles tenant-B.
```

Namun ini tidak otomatis membuat security isolation kuat.

Jika kode sudah mendapat object reference, hook tidak menarik kembali object itu.

Visibility policy harus dikombinasikan dengan:

- service hook;
- resolver policy;
- classloading/package policy;
- deployment governance;
- permission/trust model;
- process/container isolation jika perlu.

---

## 16. Service Hooks

Service hook dapat memengaruhi service registry visibility.

Use case:

- hide services from certain bundles;
- implement service region;
- restrict plugin access;
- auditing service listener registration;
- policy-based service discovery.

Contoh conceptual:

```text
A plugin may only see:
  - platform extension APIs
  - tenant-scoped services
  - services tagged with allowed capability
```

Risiko:

- DS references bisa unsatisfied tanpa alasan jelas;
- service graph yang terlihat berbeda per bundle;
- troubleshooting membutuhkan visibility-aware diagnostics;
- policy bug bisa membuat runtime tampak nondeterministic.

### 16.1 Diagnostic Requirement

Jika kamu memakai service hook, kamu wajib punya diagnostic seperti:

```text
service-policy explain --consumer com.example.plugin.a --service com.example.audit.AuditService
```

Output ideal:

```text
Decision: DENIED
Reason  : consumer region tenant-a cannot access provider region platform-internal
Rule    : R-017
Provider: com.example.audit.impl [bundle 42]
Consumer: com.example.plugin.a [bundle 88]
```

Tanpa diagnostics seperti ini, service hook akan membuat production support sangat sulit.

---

## 17. Weaving Hook

Weaving hook dipanggil saat class sedang dimuat framework.

Ia dapat:

- membaca nama class;
- membaca bytecode;
- mengubah bytecode;
- menambah dynamic import tertentu;
- mencatat classloading event.

Use case:

- instrumentation;
- tracing;
- security guard injection;
- bytecode compatibility patch;
- framework-level profiling;
- custom annotation processing at load time.

### 17.1 Contoh Konseptual

```text
Bundle loads com.example.case.CaseService
  -> framework calls weaving hook
  -> weaving hook transforms bytecode
  -> framework defines transformed class
```

### 17.2 Risiko Weaving

Weaving adalah salah satu customization paling berisiko:

- class verification error;
- performance overhead;
- incompatibility dengan Java bytecode baru;
- conflict dengan Java agent lain;
- hard-to-debug behavior;
- security issue;
- non-reproducible runtime jika weaving tergantung environment.

### 17.3 Design Rule

Pilih urutan preferensi:

```text
1. build-time code generation/instrumentation
2. Java agent standard observability
3. library wrapper/decorator
4. DS/service proxy
5. weaving hook
```

Weaving hook hanya jika opsi lain tidak cukup.

---

## 18. Woven Class Listener

Woven class listener mengamati lifecycle woven class.

Berguna untuk:

- diagnostics;
- audit instrumentation;
- detecting transformed classes;
- classload observability;
- debugging weaving errors.

Namun jangan jadikan woven class listener sebagai business logic.

Ia bagian dari infrastructure.

---

## 19. OSGi Connect

OSGi Connect adalah mekanisme Core R8 untuk membuat framework dapat “menghubungkan” bundle dengan content yang dikelola di luar framework.

Mental model:

```text
Normal OSGi:
  installed bundle -> framework owns bundle content

OSGi Connect:
  connected bundle -> framework sees bundle identity/lifecycle/service participation
                   -> content/class/resource can be managed externally
```

Use case:

- bridging classpath application dengan OSGi service/lifecycle layer;
- connecting content not stored as normal bundle JAR;
- framework participates in lifecycle but host controls content;
- special runtime packaging;
- migration path dari non-OSGi app ke OSGi semantics.

### 19.1 Why Connect Matters

Sebelum Connect, untuk ikut OSGi module/lifecycle/service layer, content biasanya harus menjadi bundle normal.

Connect membuka opsi:

```text
Host-managed content
  -> represented as connected bundle
  -> participates in OSGi lifecycle and services
```

Namun karena content berada di luar kontrol penuh framework, tidak semua invariant module layer sama dengan bundle biasa.

Jangan gunakan Connect untuk menghindari disiplin packaging.

Gunakan untuk bridge/migration/advanced packaging yang memang butuh.

---

## 20. Custom Launcher vs bnd Launcher vs Karaf vs Equinox Launcher

### 20.1 Custom Launcher

Cocok jika:

- runtime embedded dalam host;
- product punya layout khusus;
- bootstrap policy custom;
- integration dengan native/service wrapper khusus;
- perlu strict deployment plan.

Risiko:

- kamu harus maintain sendiri;
- lifecycle bugs;
- diagnostics kurang matang;
- operator perlu belajar tool custom.

### 20.2 bnd Launcher

Cocok untuk:

- development;
- testing;
- reproducible `.bndrun`;
- resolver-based assembly;
- lightweight runtime.

### 20.3 Karaf

Cocok untuk:

- operational shell;
- features provisioning;
- enterprise runtime;
- production admin tooling;
- OSGi distribution out-of-box.

### 20.4 Equinox Launcher

Cocok untuk:

- Eclipse/RCP-style product;
- p2 provisioning;
- desktop/headless Equinox platform;
- extension registry ecosystem.

### 20.5 Decision Table

| Need | Recommended |
|---|---|
| Simple dev/test runtime | bndrun |
| Production OSGi server distro | Karaf |
| Eclipse/RCP product | Equinox launcher/p2 |
| Embedded plugin engine | custom launcher or embedded Felix/Equinox |
| Strict product-specific bootstrap | custom launcher |
| Advanced provisioning | Karaf features / p2 / bnd repository |
| Non-JAR connected content | OSGi Connect |

---

## 21. Custom Repository Resolver

Daripada install random files, runtime bisa resolve dari repository.

Architecture:

```text
Product requirements
  -> repository index
  -> resolver
  -> selected resources
  -> install plan
  -> framework runtime
```

Custom resolver layer bisa menambahkan policy:

- only signed bundles;
- only certified plugins;
- environment-specific filtering;
- no snapshot versions in PROD;
- no vulnerable dependencies;
- exact product edition constraints;
- license constraints.

Important distinction:

```text
Repository policy happens before runtime.
Framework hooks happen during runtime.
```

Sebisa mungkin enforce policy sebelum runtime.

Runtime hook adalah last line of defense.

---

## 22. Multi-Framework Architecture

Kadang satu OSGi framework tidak cukup.

Contoh:

```text
Host Process
  Framework A: platform core
  Framework B: untrusted/customer plugins
  Framework C: experimental plugin sandbox
```

Kelebihan:

- stronger separation;
- independent lifecycle;
- separate service registry;
- easier unload of entire plugin group;
- less visibility complexity.

Kekurangan:

- communication lebih kompleks;
- class identity boundary lebih keras;
- memory overhead;
- diagnostics lebih kompleks;
- transaction boundary sulit.

Gunakan multi-framework jika isolation/lifecycle group benar-benar berbeda.

---

## 23. Region Isolation

Region adalah konsep arsitektural untuk membagi runtime menjadi visibility zones.

Contoh:

```text
Region: platform
  - API bundles
  - core services

Region: tenant-a
  - tenant-a plugins

Region: tenant-b
  - tenant-b plugins
```

Visibility rules:

```text
plugin regions can see platform API
platform may see selected plugin services
tenant-a cannot see tenant-b
```

Region bisa diimplementasikan dengan:

- repository/provisioning layout;
- service hooks;
- bundle hooks;
- resolver hooks;
- separate framework;
- Apache Aries Subsystems/region-like mechanisms;
- process isolation.

Untuk production, prefer desain yang paling mudah dijelaskan dan di-debug.

---

## 24. Runtime Customization Untuk Observability

Custom launcher bisa menambahkan observability sejak awal.

Minimal:

```text
- framework start timestamp
- bundle install timestamp
- bundle resolve timestamp
- bundle start timestamp
- DS readiness timestamp
- service count
- unresolved bundle list
- unsatisfied component list
- config error list
```

Contoh startup report:

```text
Runtime Startup Report
----------------------
Java              : 21.0.5
Framework          : Apache Felix 7.x
Framework storage  : /data/framework-cache
Bundles installed  : 148
Bundles resolved   : 148
Bundles active     : 132
DS components      : 421
Unsatisfied DS      : 3
HTTP endpoints      : 28
Readiness           : NOT READY
Reason              : Missing DataSource service for pid enforcement.datasource
```

OSGi `ACTIVE` bukan readiness.

Custom launcher harus menunggu readiness condition yang domain-specific.

---

## 25. Runtime Readiness With Conditions

OSGi R8 memperkenalkan Condition Service.

Mental model:

```text
A condition is a service representing whether a runtime condition is satisfied.
```

Contoh condition:

- database ready;
- migration completed;
- plugin catalog loaded;
- HTTP endpoint registered;
- message broker connected;
- config validated;
- required DS components active.

Readiness aggregator:

```text
Ready if:
  - framework started
  - required bundles active
  - required components active
  - critical services available
  - critical conditions true
```

Ini lebih benar daripada:

```text
process is alive == application ready
```

---

## 26. Shutdown Engineering

Custom runtime harus punya shutdown discipline.

Urutan ideal:

```text
1. Stop accepting external traffic
2. Mark readiness false
3. Drain in-flight work
4. Stop plugin bundles
5. Stop application bundles
6. Stop infrastructure bundles
7. Stop framework
8. Wait for stop event
9. Flush logs/diagnostics
10. Exit with meaningful code
```

Kesalahan umum:

- langsung `System.exit()`;
- tidak menunggu framework stop;
- tidak drain async executor;
- tidak unregister service;
- tidak menutup JDBC/broker connection;
- tidak mark readiness false sebelum shutdown.

---

## 27. Update and Refresh Semantics In Custom Runtime

Updating bundle tidak selalu cukup.

OSGi punya refresh semantics karena classloader/wiring lama mungkin masih dipakai.

Operasi:

```text
install -> resolve -> start
update -> refresh dependent bundles -> restart affected graph
uninstall -> refresh affected graph
```

Refresh bisa menyebabkan:

- classloader lama eligible for GC;
- dependent bundles stopped/restarted;
- service disappeared/reappeared;
- DS components deactivated/reactivated;
- HTTP endpoints temporarily removed;
- in-flight operations fail if not drained.

Custom runtime harus memutuskan:

- apakah hot update diizinkan;
- bundle mana boleh update;
- apakah update perlu maintenance mode;
- bagaimana rollback;
- bagaimana draining;
- bagaimana dependency impact dihitung.

---

## 28. Hot Deploy Policy

Hot deploy bukan default aman.

Policy yang defensible:

| Environment | Policy |
|---|---|
| local dev | hot deploy allowed |
| CI test | controlled hot deploy/failure injection |
| UAT | controlled deployment window |
| PROD low-risk plugin | controlled with certification and rollback |
| PROD core bundles | immutable rollout preferred |

Untuk regulated systems, hot deploy perlu:

- artifact identity;
- approval;
- checksum;
- audit log;
- compatibility report;
- rollback plan;
- evidence of tests;
- operator identity.

---

## 29. Custom Runtime Diagnostics API

Jika kamu membuat custom launcher/runtime, kamu juga wajib membuat diagnostics API.

Minimal commands/API:

```text
runtime info
runtime bundles
runtime unresolved
runtime wiring <bundle>
runtime services <filter>
runtime components unsatisfied
runtime config errors
runtime start-timeline
runtime explain-readiness
runtime plugin-status
runtime update-impact <bundle>
runtime dump
```

Tanpa diagnostics, customization akan menjadi black box.

---

## 30. Security Implications

Advanced customization membuka attack surface.

Risiko:

- malicious plugin abuses service registry;
- plugin sees internal service due to hook bug;
- boot delegation exposes sensitive host classes;
- weaving hook modifies security-sensitive class;
- custom launcher installs unverified bundle;
- management shell exposed;
- framework cache tampered;
- system packages expose host internals;
- resolver hook hides malicious dependency path.

Security checklist:

```text
[ ] Artifact checksum verified
[ ] Signature/trust verified
[ ] No wildcard boot delegation
[ ] No host implementation package exposed
[ ] Management endpoint protected
[ ] Plugin repository controlled
[ ] Service visibility documented
[ ] Hook policy has diagnostics
[ ] Framework cache permissions locked down
[ ] Hot update audited
[ ] Secrets not exposed as service properties
[ ] Java 24/25 no Security Manager assumption
```

---

## 31. Java 8–25 Considerations

### 31.1 Java 8

- weaker encapsulation;
- Security Manager still usable historically;
- many legacy OSGi apps target Java 8;
- javax packages often present/expected;
- older bytecode tools common.

### 31.2 Java 9+

- JPMS introduced;
- strong encapsulation begins;
- module path/classpath distinction;
- many internal JDK accesses become problematic.

### 31.3 Java 11

- Java EE modules removed from JDK;
- JAXB/JAX-WS/Activation must be explicit dependencies;
- legacy bundles may break.

### 31.4 Java 17

- common enterprise baseline;
- stronger encapsulation increasingly painful for old reflection libraries;
- many OSGi runtimes support it but library ecosystem must be checked.

### 31.5 Java 21

- virtual threads stable;
- runtime/threading design changes;
- old bytecode libraries must support newer class file versions.

### 31.6 Java 24/25

- Security Manager no longer a viable sandbox foundation;
- bytecode/instrumentation libraries must support new class file versions;
- internal API access assumptions must be removed;
- prefer process/container isolation for untrusted plugins.

---

## 32. Weaving and Java Version Compatibility

Weaving hook depends on bytecode transformation libraries.

Checklist:

```text
[ ] ASM/ByteBuddy/Javassist supports target Java class file version
[ ] Multi-release JAR behavior understood
[ ] Preview features not used in production bundles unless explicitly allowed
[ ] Transformed bytecode passes verification on Java target
[ ] Transformation deterministic
[ ] Instrumentation disabled path tested
[ ] Performance overhead measured
[ ] Interaction with Java agents tested
```

A weaving hook that works on Java 8 can break on Java 21/25 because class file format evolves.

---

## 33. Custom Launcher Testing Strategy

Test custom launcher like production software.

### 33.1 Unit Tests

- parse runtime layout;
- validate deployment plan;
- build framework config;
- detect invalid bundle checksum;
- reject unsupported Java version;
- reject duplicate symbolic name.

### 33.2 Integration Tests

- start framework;
- install bundles;
- wait readiness;
- stop framework;
- restart with persistent cache;
- start with corrupted cache;
- missing bundle file;
- incompatible plugin;
- invalid config.

### 33.3 Hook Tests

- resolver hook allows valid candidate;
- resolver hook blocks invalid provider;
- service hook hides internal service;
- diagnostics explain denied visibility;
- weaving hook transforms expected classes;
- weaving hook does not transform forbidden packages.

### 33.4 Failure Injection

```text
- delete framework cache while stopped
- corrupt plugin JAR
- duplicate bundle symbolic name
- remove required API bundle
- introduce incompatible package version
- slow plugin activation
- plugin throws on start
- service disappears during request
- update plugin while service in use
```

---

## 34. Example: Embedded Enforcement Plugin Runtime

Architecture:

```text
Spring Boot Host / Product Host
  - owns external HTTP/API/security/session
  - starts embedded OSGi framework
  - exposes host API package
  - loads certified rule plugins
  - calls rule evaluation bridge

Embedded OSGi Runtime
  - com.example.enforcement.api
  - com.example.enforcement.spi
  - com.example.enforcement.plugin.registry
  - com.example.enforcement.rules.*
```

### 34.1 Boundary

Host does not know plugin implementation.

Host knows:

```java
public interface EnforcementRule {
    RuleDecision evaluate(RuleContext context);
}
```

Plugin registers:

```java
@Component(service = EnforcementRule.class, property = {
    "rule.id=high-risk-business-profile",
    "rule.version=1.2.0",
    "rule.category=risk"
})
public final class HighRiskBusinessProfileRule implements EnforcementRule {
    @Override
    public RuleDecision evaluate(RuleContext context) {
        // rule logic
        return RuleDecision.pass();
    }
}
```

Bridge tracks rules dynamically and exposes stable snapshot to host.

### 34.2 Deployment Plan

```yaml
plugins:
  - symbolicName: com.example.rules.highrisk
    version: 1.2.0
    trust: certified
    sha256: abc...
    allowedApis:
      - com.example.enforcement.spi;range="[1.4,2)"
```

Launcher validates before install.

### 34.3 Readiness

Runtime ready if:

```text
- framework active
- SCR active
- config loaded
- plugin registry active
- at least one rule bundle active
- no mandatory plugin failed
```

---

## 35. Example: Resolver Hook For Certified Providers

Conceptual policy:

```text
A plugin cannot wire to provider bundle unless provider is certified.
```

Better first option:

- repository excludes uncertified provider;
- deployment plan rejects uncertified provider.

Resolver hook only if runtime must enforce even when bundle is already installed.

Pseudo-flow:

```text
resolve(plugin)
  candidates for Import-Package com.fasterxml.jackson.databind:
    - jackson.bundle.2.15 certified
    - random.jackson.2.15 uncertified
  resolver hook removes uncertified candidate
  resolver wires to certified candidate
```

Diagnostic must explain this.

---

## 36. Example: Service Hook For Tenant-Scoped Services

Service property:

```text
tenant.scope=tenant-a
```

Consumer bundle metadata:

```text
X-Tenant-Region: tenant-a
```

Policy:

```text
consumer can see service if:
  service.tenant.scope == consumer.tenant.region
  OR service.scope == platform-public
```

Again, this is dangerous without explainability.

Better alternatives:

- use explicit target filters;
- create tenant-specific framework;
- create tenant-specific plugin registry;
- avoid same JVM for strong tenant isolation.

---

## 37. Example: Weaving Hook For Audit Injection

Use case:

- every implementation of `CaseTransitionHandler` must emit audit event;
- plugin authors might forget;
- platform wants instrumentation.

Options:

1. Require service decorator/proxy.
2. Use abstract base class/template.
3. Use annotation processor/build-time validation.
4. Use runtime service wrapper.
5. Use weaving hook.

Prefer service wrapper:

```text
Plugin service -> Registry -> Audited proxy -> Host uses proxy
```

Weaving hook only if wrapper cannot intercept required behavior.

Top-tier judgment is knowing that the clever hook is often worse than boring explicit composition.

---

## 38. Runtime Customization Anti-Patterns

### 38.1 Wildcard Boot Delegation

```properties
org.osgi.framework.bootdelegation=*
```

This destroys OSGi semantics.

### 38.2 Exposing Host Internals

```properties
org.osgi.framework.system.packages.extra=com.example.host.*
```

This turns host implementation into accidental API.

### 38.3 Hook Without Diagnostics

If policy changes runtime visibility, explainability is mandatory.

### 38.4 Custom Launcher Without Tests

Launcher bugs are production outage bugs.

### 38.5 Hot Deploy Without Compatibility Gate

Dynamic update is not safe just because OSGi supports it.

### 38.6 Weaving Business Logic

Business policy should not be hidden in bytecode transformer.

### 38.7 Treating OSGi Connect As Packaging Escape Hatch

Connect is for advanced bridging, not avoiding clean bundle design.

### 38.8 Framework Cache As Release Source of Truth

Cache is runtime state, not deployment evidence.

### 38.9 Static Host-to-Plugin Cast Across Classloader Boundary

Can produce class identity failure.

### 38.10 Security Manager Assumption On Java 24/25

No longer defensible.

---

## 39. Production Readiness Checklist

### 39.1 Launcher

```text
[ ] Framework config deterministic
[ ] Runtime layout validated
[ ] Deployment plan validated
[ ] Bundle checksums verified
[ ] Duplicate symbolic names rejected
[ ] Unsupported Java version rejected
[ ] Framework storage policy documented
[ ] Clean/recovery mode available
[ ] Shutdown graceful
[ ] Exit codes meaningful
```

### 39.2 Hooks

```text
[ ] Hook has clear use case
[ ] Standard alternative considered and rejected with reason
[ ] Hook behavior deterministic
[ ] Hook has diagnostics/explain API
[ ] Hook tested with failure injection
[ ] Hook performance measured
[ ] Hook does not hide security risk
[ ] Hook documented as runtime invariant
```

### 39.3 Connect

```text
[ ] Reason for Connect documented
[ ] Normal bundle packaging considered
[ ] Class/resource ownership clear
[ ] Lifecycle behavior tested
[ ] Diagnostics available
[ ] Migration path clear
```

### 39.4 Security

```text
[ ] No wildcard boot delegation
[ ] Host API minimal
[ ] Management surface protected
[ ] Plugin trust model defined
[ ] Bundle signing/checksum policy exists
[ ] Framework cache protected
[ ] No Java Security Manager dependency for Java 24/25
```

### 39.5 Operations

```text
[ ] Startup report generated
[ ] Readiness explanation available
[ ] Bundle/service/component graph inspectable
[ ] Update impact analysis available
[ ] Rollback tested
[ ] Diagnostic dump available
[ ] Operator runbook written
```

---

## 40. Design Review Questions

Ask these before approving runtime customization:

1. What exact OSGi invariant are we changing or extending?
2. Can this be solved with DS, Config Admin, repository policy, or capability model instead?
3. Is behavior visible from bundle manifests, deployment plan, or diagnostics?
4. What happens during bundle update/refresh?
5. What happens if service disappears mid-call?
6. What happens after framework restart with persistent cache?
7. Can two environments produce different wiring?
8. How do we explain policy decisions to operators?
9. What is the Java 8–25 compatibility story?
10. What is the rollback path?
11. Does this weaken classloader isolation?
12. Does this expose host implementation as API?
13. Does this create hidden security assumptions?
14. How is this tested in CI?
15. Who owns this runtime customization long-term?

---

## 41. Practical Decision Framework

Use this decision sequence:

```text
Need dynamic behavior?
  -> Use OSGi services / DS / config first.

Need runtime assembly control?
  -> Use bndrun / features / p2 / repository metadata.

Need embedded plugin engine?
  -> Use custom launcher or embedded Felix/Equinox.

Need host API bridge?
  -> Expose minimal stable API, avoid implementation leakage.

Need visibility policy?
  -> Prefer repository/deployment policy.
  -> If runtime enforcement required, consider hooks with diagnostics.

Need bytecode instrumentation?
  -> Prefer build-time or Java agent/service proxy.
  -> Use weaving hook only with strong justification.

Need non-standard content source?
  -> Consider OSGi Connect.

Need strong isolation for untrusted code?
  -> Use process/container isolation, not same-JVM OSGi alone.
```

---

## 42. What Top 1% Engineers Understand About This Topic

Top-tier OSGi engineers understand that advanced runtime customization is about **control vs comprehensibility**.

They do not customize because it is clever.

They customize when:

- standard OSGi mechanisms are insufficient;
- policy must be enforced at runtime;
- embedding is required by product architecture;
- operational diagnostics are designed together with customization;
- test strategy covers lifecycle and failure modes;
- security assumptions are explicit;
- rollback and upgrade are engineered;
- future maintainers can still reason about the system.

They also know that:

- hooks are kernel-level mechanisms;
- boot delegation can destroy modularity;
- weaving can become invisible business logic;
- custom launcher is production infrastructure;
- OSGi Connect is a bridge, not a shortcut;
- Java 24/25 changes make in-process sandboxing weaker as a security story;
- the boring explicit design is often superior to magical runtime behavior.

---

## 43. Summary

Part 33 covered:

- OSGi framework as embeddable runtime kernel;
- custom launcher design;
- runtime layout;
- framework configuration;
- system packages and boot delegation;
- install plan and deployment validation;
- embedded host/plugin boundary;
- host bridge pattern;
- resolver hooks;
- bundle hooks;
- service hooks;
- weaving hooks;
- OSGi Connect;
- multi-framework architecture;
- region isolation;
- observability/readiness;
- shutdown/update semantics;
- hot deploy policy;
- security implications;
- Java 8–25 compatibility;
- testing strategy;
- production checklists;
- decision framework.

The core lesson:

> Advanced OSGi runtime customization is not about making the framework do magic. It is about building a runtime whose dynamic behavior remains explicit, testable, diagnosable, secure, and evolvable.

---

## 44. Bridge to Part 34

Part 34 will be the final synthesis of the series:

```text
34-top-1-percent-osgi-engineering-design-reviews-invariants-checklists-decision-framework.md
```

It will consolidate everything into:

- OSGi design review framework;
- invariant checklist;
- bundle boundary checklist;
- resolver checklist;
- service dynamics checklist;
- production readiness checklist;
- migration decision checklist;
- anti-pattern detection;
- architecture decision records;
- final top 1% mental model.

