# learn-java-oop-functional-reflection-codegen-modules-part-027

# JPMS Deep Dive II: Opens, Reflection, Services, Layers, and Runtime Images

> Seri: `learn-java-oop-functional-reflection-codegen-modules`  
> Part: `027`  
> Topik: Java Platform Module System level lanjut — `opens`, reflection, services, module layers, plugin architecture, dan custom runtime image.

---

## 0. Posisi Part Ini Dalam Seri

Pada Part 026, kita sudah membahas bagian pertama JPMS:

- apa itu module;
- `module-info.java`;
- `requires`, `requires transitive`, `requires static`;
- `exports` dan qualified exports;
- module path vs classpath;
- named module, automatic module, unnamed module;
- split package problem;
- strategi migrasi awal.

Part 027 masuk ke lapisan yang lebih sering membuat engineer senior harus berpikir keras:

1. bagaimana strong encapsulation berinteraksi dengan reflection;
2. kapan memakai `exports`, kapan memakai `opens`;
3. bagaimana service provider mechanism bekerja di dunia modular;
4. bagaimana membuat plugin architecture dengan `ModuleLayer`;
5. bagaimana menghasilkan runtime image kecil/terkendali dengan `jlink`;
6. bagaimana mendesain module boundary yang tetap kompatibel dengan framework enterprise.

Mental model utamanya:

> `exports` adalah kontrak compile-time dan runtime untuk akses public type.  
> `opens` adalah izin runtime untuk deep reflection.  
> `uses/provides` adalah mekanisme discovery.  
> `ModuleLayer` adalah graph module runtime tambahan.  
> `jlink` adalah packaging runtime berbasis module graph.

---

## 1. Mengapa Part Ini Penting

Banyak tim mengira JPMS hanya tentang menulis file:

```java
module com.example.app {
    requires com.example.domain;
    exports com.example.api;
}
```

Itu baru permukaan. Di sistem nyata, Anda akan bertemu masalah seperti:

- framework JSON tidak bisa mengakses private field;
- dependency injection gagal instantiate class;
- ORM gagal membuat proxy;
- test gagal karena package tidak terbuka;
- service implementation tidak ditemukan oleh `ServiceLoader`;
- plugin jar perlu dimuat setelah aplikasi start;
- runtime image perlu diperkecil untuk container;
- library internal ingin expose API tanpa membocorkan implementation;
- migration dari classpath ke module path membuat reflective access error;
- `--add-opens` muncul di startup script tanpa ownership jelas.

Di level engineer biasa, solusinya sering:

```bash
--add-opens everything/to.everyone=ALL-UNNAMED
```

Di level engineer matang, pertanyaannya berbeda:

- package mana yang benar-benar perlu dibuka?
- ke module siapa ia dibuka?
- apakah ini API contract atau hanya framework integration?
- apakah reflection bisa diganti dengan generated code?
- apakah plugin boundary perlu classloader/module layer isolation?
- apakah runtime image harus dibuat dari explicit module graph?

---

## 2. Recap Singkat: `exports` Bukan `opens`

JPMS memiliki dua bentuk akses package yang sering tertukar:

```java
exports com.example.payment.api;
opens com.example.payment.model;
```

Keduanya membuka package, tetapi untuk tujuan berbeda.

| Directive | Membuka Untuk | Compile-Time Access | Runtime Normal Access | Deep Reflection |
|---|---:|---:|---:|---:|
| `exports` | public types | ya | ya | tidak otomatis |
| `opens` | reflective access | tidak untuk compile-time import | tidak untuk normal access | ya |

`exports` menjawab:

> “Module lain boleh memakai public API package ini.”

`opens` menjawab:

> “Framework/reflection boleh mengakses member package ini pada runtime, termasuk non-public members bila access check diizinkan.”

Contoh:

```java
module com.acme.case.domain {
    exports com.acme.case.domain.api;
    opens com.acme.case.domain.model to com.fasterxml.jackson.databind;
}
```

Maknanya:

- `com.acme.case.domain.api` adalah API publik module;
- `com.acme.case.domain.model` tidak otomatis bisa diimport module lain;
- tetapi Jackson boleh melakukan reflective access terhadap package model.

---

## 3. Strong Encapsulation dan Reflection

Sebelum JPMS, banyak framework Java hidup dari asumsi:

> “Kalau saya bisa menemukan class di classpath, saya bisa reflect ke dalamnya.”

JPMS mengubah asumsi itu.

Module system memberi dua kontrol besar:

1. **readability** — module A membaca module B atau tidak;
2. **accessibility/encapsulation** — package/type/member boleh diakses atau tidak.

Reflection tidak lagi otomatis menjadi jalan pintas universal. Public member di exported package masih relatif mudah diakses. Namun deep reflection ke private fields, private constructors, package-private classes, atau non-exported packages perlu package tersebut **opened**.

Contoh domain class:

```java
package com.acme.case.domain.model;

public class CaseFile {
    private String status;

    private CaseFile() {
    }
}
```

Kalau package ini tidak `opens`, framework serializer/ORM/DI yang mencoba:

```java
constructor.setAccessible(true);
field.setAccessible(true);
```

bisa gagal karena module boundary tidak mengizinkan deep reflection.

---

## 4. `opens` Directive

Bentuk dasar:

```java
module com.acme.case.domain {
    opens com.acme.case.domain.model;
}
```

Ini berarti package `com.acme.case.domain.model` terbuka untuk deep reflection oleh semua module.

Contoh:

```java
module com.acme.case.domain {
    exports com.acme.case.domain.api;
    opens com.acme.case.domain.model;
}
```

Konsekuensinya:

- package `api` bisa dipakai normal oleh module lain;
- package `model` tidak diexport, tetapi bisa direfleksi;
- framework runtime bisa instantiate/read/write bila Java access checks dilewati secara reflektif;
- compile-time import ke `model` dari module lain tetap tidak menjadi API normal.

### 4.1 Kapan `opens` Masuk Akal?

`opens` masuk akal untuk:

- JSON/XML serialization/deserialization;
- ORM mapping;
- dependency injection framework;
- validation framework;
- test framework;
- object mapper;
- reflection-based metadata scanner;
- migration legacy framework yang belum sepenuhnya module-aware.

Namun `opens` sebaiknya diperlakukan sebagai **privilege**, bukan default.

---

## 5. Qualified `opens`

Bentuk lebih aman:

```java
module com.acme.case.domain {
    opens com.acme.case.domain.model to com.fasterxml.jackson.databind;
}
```

Artinya:

> Package `model` hanya dibuka untuk module `com.fasterxml.jackson.databind`.

Contoh multi-framework:

```java
module com.acme.case.domain {
    opens com.acme.case.domain.model
        to com.fasterxml.jackson.databind,
           org.hibernate.orm.core,
           jakarta.validation;
}
```

Qualified opens jauh lebih baik daripada unqualified opens karena:

- intention terlihat jelas;
- attack/debug surface lebih kecil;
- module descriptor menjadi dokumentasi integration boundary;
- review security lebih mudah;
- dependency ownership lebih jelas.

Rule praktis:

> Mulai dari qualified `opens`. Gunakan unqualified `opens` hanya bila benar-benar perlu dan bisa dijelaskan.

---

## 6. `open module`

Ada bentuk ekstrem:

```java
open module com.acme.legacy.app {
    requires com.fasterxml.jackson.databind;
    requires org.hibernate.orm.core;
}
```

`open module` berarti semua package di module tersebut terbuka untuk deep reflection.

Ini berguna untuk:

- migrasi legacy aplikasi besar;
- framework-heavy monolith;
- fase transisi dari classpath ke module path;
- aplikasi internal yang belum siap granular `opens`.

Tetapi buruk untuk long-term module hygiene.

### 6.1 Risiko `open module`

Risiko:

- semua package bisa direfleksi;
- boundary API/internal menjadi kabur;
- framework coupling tersembunyi;
- audit sulit;
- accidental dependency tetap mudah terjadi;
- module descriptor kehilangan nilai arsitektural.

Gunakan `open module` seperti scaffolding proyek konstruksi:

> boleh untuk membantu bangunan berdiri, tetapi jangan dibiarkan menjadi struktur permanen.

---

## 7. `exports` vs `opens` Decision Table

| Kebutuhan | Directive yang Cocok |
|---|---|
| Module lain perlu import public API | `exports` |
| Module tertentu saja boleh import public API | qualified `exports ... to ...` |
| Framework perlu access private fields/constructors | `opens` |
| Framework tertentu saja perlu deep reflection | qualified `opens ... to ...` |
| Legacy app semua package perlu reflection | `open module` sementara |
| Package internal tidak boleh dipakai dan tidak perlu reflection | jangan `exports`, jangan `opens` |
| Generated code perlu dipakai module lain | biasanya `exports`, tergantung API |
| Test perlu akses package internal | test-specific module args atau qualified opens ke test framework |

---

## 8. Command-Line Escape Hatch: `--add-opens`

Kadang Anda tidak bisa mengubah `module-info.java`, misalnya:

- third-party jar;
- old library;
- migration cepat;
- test runtime;
- production hotfix sementara.

JDK menyediakan command-line option seperti:

```bash
--add-opens com.acme.case.domain/com.acme.case.domain.model=com.fasterxml.jackson.databind
```

atau untuk classpath/unnamed module:

```bash
--add-opens com.acme.case.domain/com.acme.case.domain.model=ALL-UNNAMED
```

Ini membuka package pada runtime.

### 8.1 Kapan `--add-opens` Dapat Diterima?

Dapat diterima bila:

- sifatnya sementara;
- dicatat dalam ADR/runbook;
- ada owner;
- ada target penghapusan;
- hanya package yang spesifik;
- hanya target module yang spesifik.

Buruk bila:

```bash
--add-opens java.base/java.lang=ALL-UNNAMED
--add-opens java.base/java.util=ALL-UNNAMED
--add-opens java.base/sun.nio.ch=ALL-UNNAMED
```

lalu tidak ada yang tahu kenapa.

### 8.2 Smell Checklist

`--add-opens` adalah smell bila:

- ditambahkan karena “biar jalan” tanpa root cause;
- membuka package JDK internal;
- terlalu luas memakai `ALL-UNNAMED`;
- tidak ada automated test yang membuktikan kebutuhan;
- tidak ada issue tracker/ADR;
- tetap ada bertahun-tahun setelah migrasi.

---

## 9. Reflection Under JPMS: Mental Model Access Check

Ketika reflective code mencoba mengakses member, kira-kira ada beberapa pertanyaan:

1. Apakah class bisa ditemukan?
2. Apakah module caller membaca module target?
3. Apakah package target exported untuk normal public access?
4. Apakah package target opened untuk deep reflection?
5. Apakah member public/protected/package/private?
6. Apakah `setAccessible(true)` atau API setara dipakai?
7. Apakah security/access policy mengizinkan?

Dengan kata lain:

> Reflection bukan cuma soal `Class.getDeclaredFields()`. Reflection adalah pertemuan antara metadata, access control, module graph, dan runtime permission.

---

## 10. Framework Compatibility Pattern

Banyak framework modern menyediakan cara untuk bekerja lebih baik dengan JPMS.

Biasanya pola yang muncul:

```java
module com.acme.case.app {
    requires com.fasterxml.jackson.databind;
    requires jakarta.validation;

    exports com.acme.case.api;

    opens com.acme.case.dto to com.fasterxml.jackson.databind;
    opens com.acme.case.domain.model to jakarta.validation;
}
```

Tetapi ada beberapa design question:

- Apakah DTO harus di module yang sama dengan domain?
- Apakah domain object perlu direfleksi langsung oleh serializer?
- Apakah bisa memakai explicit constructor/factory sehingga tidak perlu private field reflection?
- Apakah bisa memakai generated mapper?
- Apakah package internal perlu dibuka hanya untuk test?

### 10.1 Senior-Level Principle

Jangan biarkan framework menentukan boundary domain Anda secara diam-diam.

Jika framework butuh reflection, buat boundary eksplisit:

- DTO package dibuka untuk mapper/serializer;
- entity package dibuka untuk ORM;
- domain core package tetap tertutup;
- API package diexport;
- internal package tidak diexport dan tidak diopens.

---

## 11. Services in JPMS: `uses` dan `provides`

JPMS tidak hanya mengatur akses package. Ia juga mendukung service provider mechanism secara modular.

Ada tiga konsep:

1. **service interface** — contract;
2. **service provider** — implementation;
3. **service consumer** — module yang mencari provider.

Consumer menulis:

```java
module com.acme.case.app {
    requires com.acme.case.spi;
    uses com.acme.case.spi.EscalationPolicyProvider;
}
```

Provider menulis:

```java
module com.acme.case.policy.standard {
    requires com.acme.case.spi;

    provides com.acme.case.spi.EscalationPolicyProvider
        with com.acme.case.policy.standard.StandardEscalationPolicyProvider;
}
```

SPI module:

```java
module com.acme.case.spi {
    exports com.acme.case.spi;
}
```

Consumer code:

```java
ServiceLoader<EscalationPolicyProvider> loader =
    ServiceLoader.load(EscalationPolicyProvider.class);

for (EscalationPolicyProvider provider : loader) {
    EscalationPolicy policy = provider.createPolicy();
    // register/use policy
}
```

---

## 12. Why `ServiceLoader` Matters

`ServiceLoader` berguna ketika Anda ingin:

- plugin-style extension;
- provider discovery tanpa hard dependency ke implementation;
- SPI design;
- pluggable algorithms;
- pluggable exporters/importers;
- pluggable validation rules;
- runtime optional features;
- internal platform extension.

Contoh JDK sendiri banyak memakai service/provider style.

Mental model:

> `requires` membuat module dependency eksplisit.  
> `uses/provides` membuat implementation discovery eksplisit tanpa consumer bergantung langsung ke concrete provider.

---

## 13. ServiceLoader Contract Design

Misalnya Anda mendesain SPI:

```java
package com.acme.case.spi;

public interface EscalationPolicyProvider {
    String code();
    int priority();
    EscalationPolicy createPolicy(EscalationPolicyContext context);
}
```

Jangan buat provider terlalu magic.

Lebih baik provider punya:

- stable code;
- priority/order;
- capability metadata;
- explicit factory method;
- clear failure behavior;
- no hidden global state;
- deterministic initialization.

Buruk:

```java
public interface Plugin {
    void start(Object context);
}
```

Masalah:

- `Object` tidak punya contract;
- lifecycle tidak jelas;
- failure mode tidak jelas;
- dependency provider tidak jelas;
- testing sulit.

Lebih baik:

```java
public interface CaseRulePlugin {
    PluginDescriptor descriptor();
    List<RuleDefinition> rules(RulePluginContext context);
}
```

---

## 14. Provider Instantiation Rules: Jangan Terlalu Berat

`ServiceLoader` dapat menemukan provider, tetapi provider design tetap tanggung jawab Anda.

Anti-pattern:

```java
public final class HeavyProvider implements EscalationPolicyProvider {
    public HeavyProvider() {
        connectToDatabase();
        callRemoteConfig();
        startThreadPool();
    }
}
```

Masalah:

- provider discovery jadi mahal;
- failure muncul saat loading, bukan saat penggunaan eksplisit;
- sulit retry;
- sulit observability;
- sulit test.

Lebih baik:

```java
public final class StandardProvider implements EscalationPolicyProvider {
    public StandardProvider() {
        // cheap constructor
    }

    @Override
    public EscalationPolicy createPolicy(EscalationPolicyContext context) {
        return new StandardEscalationPolicy(context.clock(), context.config());
    }
}
```

Rule:

> Provider constructor harus murah, deterministik, dan tidak melakukan I/O berat.

---

## 15. `ServiceLoader.Provider` Stream

Modern `ServiceLoader` mendukung stream provider. Ini berguna untuk membaca metadata provider class tanpa langsung instantiate semuanya.

Contoh:

```java
ServiceLoader<EscalationPolicyProvider> loader =
    ServiceLoader.load(EscalationPolicyProvider.class);

List<EscalationPolicyProvider> providers = loader.stream()
    .map(ServiceLoader.Provider::get)
    .sorted(Comparator.comparingInt(EscalationPolicyProvider::priority))
    .toList();
```

Namun hati-hati:

- `Provider::get` tetap instantiate provider;
- ordering default tidak boleh diasumsikan sebagai business contract;
- duplicate provider harus ditangani;
- failure satu provider jangan selalu menjatuhkan semua aplikasi bila plugin optional.

---

## 16. ServiceLoader Failure Model

Failure yang umum:

1. Provider module tidak ada di module path.
2. Consumer lupa `uses`.
3. Provider lupa `provides ... with`.
4. Provider class tidak public/accessible sesuai aturan.
5. Provider constructor bermasalah.
6. Provider melempar exception saat initialization.
7. Duplicate provider code.
8. Provider bergantung ke module yang tidak resolved.
9. Provider ada di classpath/unnamed module tapi consumer modular tidak mengantisipasi.
10. Custom classloader/layer tidak sama dengan lokasi provider.

Desain loading yang baik:

```java
public final class PluginRegistry {
    private final Map<String, EscalationPolicyProvider> providers;

    public PluginRegistry(ServiceLoader<EscalationPolicyProvider> loader) {
        Map<String, EscalationPolicyProvider> discovered = new LinkedHashMap<>();

        for (ServiceLoader.Provider<EscalationPolicyProvider> candidate : loader.stream().toList()) {
            EscalationPolicyProvider provider = candidate.get();
            EscalationPolicyProvider previous = discovered.putIfAbsent(provider.code(), provider);
            if (previous != null) {
                throw new IllegalStateException("Duplicate provider code: " + provider.code());
            }
        }

        this.providers = Map.copyOf(discovered);
    }

    public EscalationPolicyProvider require(String code) {
        EscalationPolicyProvider provider = providers.get(code);
        if (provider == null) {
            throw new IllegalArgumentException("Unknown provider: " + code);
        }
        return provider;
    }
}
```

---

## 17. Module Layers: Runtime Module Graph Tambahan

Module graph aplikasi biasanya dibentuk saat startup. Namun JPMS juga punya konsep `ModuleLayer`.

Sederhananya:

> `ModuleLayer` adalah sekumpulan module yang sudah resolved dan didefinisikan ke JVM, dengan parent layer tertentu.

Boot layer adalah layer awal yang berisi module aplikasi/JDK yang di-resolve saat launch.

Anda bisa membuat layer tambahan untuk:

- plugin architecture;
- dynamic feature loading;
- isolated provider set;
- tenant-specific extension;
- tool runtime;
- script/extension engine;
- modular test fixture;
- controlled classloader boundary.

---

## 18. Kapan Butuh `ModuleLayer`?

Tidak semua aplikasi butuh `ModuleLayer`.

Anda butuh mempertimbangkannya bila:

- plugin tidak diketahui saat compile time;
- plugin jar bisa ditambahkan/diubah di deployment tertentu;
- provider perlu diisolasi dari main app;
- beberapa versi provider mungkin perlu dipisahkan;
- Anda ingin module graph plugin explicit;
- Anda ingin scanning plugin tanpa mencampur classpath global.

Tidak perlu bila:

- semua dependency sudah static;
- DI container sudah cukup;
- plugin hanya konfigurasi biasa;
- tidak perlu isolation;
- classpath/module path deployment statis.

---

## 19. Conceptual Example: Loading Plugin Modules

Misalnya struktur:

```text
app/
  com.acme.case.app.jar
plugins/
  com.acme.case.policy.standard.jar
  com.acme.case.policy.special.jar
```

Kita ingin load plugin modules dari directory `plugins`.

Pseudo-code:

```java
Path pluginsDir = Path.of("plugins");

ModuleFinder finder = ModuleFinder.of(pluginsDir);

Set<String> pluginModuleNames = finder.findAll().stream()
    .map(ref -> ref.descriptor().name())
    .collect(Collectors.toUnmodifiableSet());

ModuleLayer parent = ModuleLayer.boot();

Configuration configuration = parent.configuration()
    .resolve(finder, ModuleFinder.of(), pluginModuleNames);

ClassLoader systemClassLoader = ClassLoader.getSystemClassLoader();

ModuleLayer pluginLayer = parent.defineModulesWithOneLoader(
    configuration,
    systemClassLoader
);

ServiceLoader<EscalationPolicyProvider> loader =
    ServiceLoader.load(pluginLayer, EscalationPolicyProvider.class);
```

Ini bukan kode production lengkap, tetapi cukup menggambarkan pipeline:

1. cari module plugin;
2. resolve module graph;
3. define layer;
4. load services dari layer.

---

## 20. `defineModulesWithOneLoader` vs `defineModulesWithManyLoaders`

Ketika membuat layer, Anda bisa memilih strategi classloader.

Secara konseptual:

- `defineModulesWithOneLoader`: module dalam layer memakai satu classloader;
- `defineModulesWithManyLoaders`: module bisa mendapat classloader berbeda;
- ada juga API lebih advanced dengan kontrol mapping loader.

Trade-off:

| Strategy | Kelebihan | Kekurangan |
|---|---|---|
| One loader | sederhana, lebih mudah debug | isolation lebih lemah |
| Many loaders | isolation lebih baik | class identity issue lebih kompleks |
| Custom mapping | kontrol tinggi | kompleksitas tinggi |

Classloader identity penting karena di Java:

> Class identity bukan hanya binary name, tetapi juga classloader yang mendefinisikannya.

Dua class dengan nama sama dari loader berbeda adalah type berbeda.

---

## 21. Plugin Architecture: Contract Boundary

Plugin architecture yang sehat membutuhkan minimal tiga layer konseptual:

```text
com.acme.case.spi
        ↑
        │ uses/provides
        │
com.acme.case.app  ← loads → com.acme.case.plugin.x
```

SPI module:

```java
module com.acme.case.spi {
    exports com.acme.case.spi;
}
```

App module:

```java
module com.acme.case.app {
    requires com.acme.case.spi;
    uses com.acme.case.spi.CaseRulePlugin;
}
```

Plugin module:

```java
module com.acme.case.plugin.special {
    requires com.acme.case.spi;

    provides com.acme.case.spi.CaseRulePlugin
        with com.acme.case.plugin.special.SpecialCaseRulePlugin;
}
```

SPI harus kecil dan stabil. Jangan bocorkan internal app ke SPI.

Buruk:

```java
public interface CaseRulePlugin {
    void apply(AppDatabaseConnection conn, InternalCaseEntity entity, InternalAuditLogger logger);
}
```

Lebih baik:

```java
public interface CaseRulePlugin {
    RuleEvaluationResult evaluate(RuleEvaluationInput input);
}
```

Dengan input/output stable, serializable-friendly, dan tidak bergantung ke internal object graph.

---

## 22. ModuleLayer dan Lifecycle

ModuleLayer bukan container lifecycle lengkap. Ia tidak otomatis menyediakan:

- dependency injection;
- plugin start/stop;
- health check;
- config binding;
- thread cleanup;
- transaction boundary;
- graceful shutdown;
- resource ownership;
- hot reload aman.

Anda tetap perlu lifecycle model.

Contoh:

```java
public interface ManagedPlugin extends AutoCloseable {
    PluginDescriptor descriptor();
    void start(PluginContext context);
    @Override void close();
}
```

Registry:

```java
public final class PluginManager implements AutoCloseable {
    private final List<ManagedPlugin> plugins = new ArrayList<>();

    public void startAll(PluginContext context) {
        for (ManagedPlugin plugin : plugins) {
            plugin.start(context);
        }
    }

    @Override
    public void close() {
        ListIterator<ManagedPlugin> it = plugins.listIterator(plugins.size());
        while (it.hasPrevious()) {
            try {
                it.previous().close();
            } catch (Exception ex) {
                // log and continue shutdown
            }
        }
    }
}
```

---

## 23. Dynamic Plugin Loading: Reality Check

ModuleLayer memungkinkan membuat layer baru, tetapi tidak berarti unloading plugin selalu mudah.

Agar plugin bisa di-GC/unloaded, Anda harus memastikan:

- tidak ada strong reference ke class/plugin instance;
- thread plugin berhenti;
- executor ditutup;
- static cache dibersihkan;
- ThreadLocal dibersihkan;
- MBean/listener deregistered;
- service registry dilepas;
- classloader tidak direferensikan global.

Di produksi, hot unload sering lebih sulit daripada hot load.

Prinsip realistis:

> Untuk sistem enterprise, lebih aman mendesain plugin loading saat startup/deployment daripada hot-reload runtime kecuali Anda benar-benar punya lifecycle isolation yang matang.

---

## 24. ServiceLoader vs DI Container

`ServiceLoader` bukan pengganti penuh Spring/CDI/Guice.

| Aspek | ServiceLoader | DI Container |
|---|---|---|
| Provider discovery | kuat | kuat |
| Constructor injection kompleks | terbatas | kuat |
| Lifecycle | manual | biasanya tersedia |
| Scope | manual | tersedia |
| Conditional bean | manual | kuat |
| Module-layer integration | native JPMS-friendly | tergantung framework |
| Simplicity | tinggi | lebih kompleks |

Gunakan `ServiceLoader` untuk SPI boundary yang sederhana/stabil.

Gunakan DI container untuk object graph aplikasi yang kaya lifecycle/configuration.

Hybrid pattern:

- `ServiceLoader` menemukan plugin provider;
- provider membuat child container/plugin context;
- app tetap mengontrol lifecycle dan permission.

---

## 25. `jlink`: Runtime Image Berbasis Module Graph

`jlink` adalah tool JDK untuk membuat custom runtime image dari sekumpulan module dan transitive dependencies-nya.

Sebelum JPMS, deployment Java umumnya membawa full JRE/JDK atau bergantung pada runtime yang sudah ada.

Dengan JPMS + `jlink`, Anda bisa membuat runtime image yang hanya berisi module yang diperlukan.

Contoh konseptual:

```bash
jlink \
  --module-path mods:$JAVA_HOME/jmods \
  --add-modules com.acme.case.app \
  --output build/case-runtime
```

Output `build/case-runtime` berisi runtime image dengan launcher/java runtime sesuai module graph.

---

## 26. Mengapa `jlink` Berguna?

Manfaat:

- runtime lebih kecil;
- dependency JDK lebih eksplisit;
- attack surface lebih terkendali;
- container image bisa lebih ramping;
- deployment lebih reproducible;
- tidak perlu bergantung ke JRE global di host;
- cocok untuk CLI/tooling/internal runtime;
- memperjelas module dependency runtime.

Namun bukan silver bullet.

Trade-off:

- build pipeline lebih kompleks;
- image harus di-update saat JDK security update;
- observability/debug tooling perlu dipastikan tersedia;
- dynamic plugin dengan module eksternal perlu strategi khusus;
- framework classpath-heavy bisa menyulitkan modular image;
- container base image dan OS dependency tetap perlu dikelola.

---

## 27. `jlink` dan Custom Runtime Maintenance

Poin penting:

> Jika Anda membuat custom runtime image, Anda bertanggung jawab memperbarui image itu ketika ada update JDK/security patch.

Jangan menganggap image hasil `jlink` sebagai artifact abadi.

Governance yang perlu ada:

- JDK vendor/version dicatat;
- build reproducible;
- SBOM dibuat;
- vulnerability scanning dilakukan;
- rebuild runtime saat JDK update;
- integration test berjalan terhadap image final;
- observability/diagnostic tools yang dibutuhkan tersedia;
- rollback image jelas.

---

## 28. `jlink` Dalam Container World

Di container, banyak tim bertanya:

> “Masih perlu `jlink` kalau sudah pakai container image kecil?”

Jawabannya tergantung.

`jlink` berguna bila:

- aplikasi modular jelas;
- image size penting;
- startup/distribution artifact perlu diperkecil;
- runtime surface ingin dikontrol;
- aplikasi CLI/agent/tool internal;
- environment sangat regulated.

Tidak selalu worth it bila:

- aplikasi belum modular;
- framework sangat classpath-heavy;
- base image JRE sudah cukup kecil;
- operational complexity lebih mahal daripada size saving;
- dependency native/tools sering berubah.

Decision rule:

> Gunakan `jlink` jika Anda bisa mengoperasionalkan update runtime image dengan disiplin yang sama seperti dependency update biasa.

---

## 29. JPMS, Reflection, and Generated Code

Dalam beberapa kasus, generated code lebih baik daripada reflection.

Reflection-based mapper:

```text
runtime scans class → access fields reflectively → map values
```

Generated mapper:

```text
compile-time reads model → generates mapper source → normal method calls at runtime
```

Dengan JPMS, generated code punya kelebihan:

- tidak butuh `opens` untuk deep reflection;
- access error lebih cepat muncul saat compile time;
- performance lebih predictable;
- module dependency lebih eksplisit;
- debugging lebih mudah;
- native/runtime-image compatibility sering lebih baik.

Namun generated code juga punya biaya:

- generator harus benar;
- build lebih kompleks;
- incremental compilation perlu diperhatikan;
- generated API bisa bocor;
- compatibility generator harus dijaga.

Rule:

> Jika reflection hanya dipakai untuk menghindari boilerplate deterministik, pertimbangkan generated code. Jika reflection dipakai untuk runtime discovery yang memang dinamis, desain `opens` secara eksplisit.

---

## 30. JPMS and Testing

Testing modular application sering butuh akses tambahan.

Masalah umum:

- test ingin mengakses package-private class;
- mocking framework perlu reflect ke private member;
- test framework perlu discover test classes;
- JUnit/module path configuration belum benar;
- generated test fixtures berada di package/module berbeda.

Pendekatan:

1. Test public API only.
2. Gunakan package-private tests dalam package yang sama bila build tool mendukung.
3. Buat test fixtures module.
4. Gunakan test-specific `--add-opens`.
5. Hindari membuka production module hanya karena test convenience.

Contoh test-time only:

```bash
--add-opens com.acme.case.domain/com.acme.case.domain.model=org.junit.platform.commons
```

Prinsip:

> Test boleh membutuhkan akses khusus, tetapi akses khusus itu harus terlihat sebagai konfigurasi test, bukan menjadi production API.

---

## 31. JPMS and Frameworks: Common Patterns

### 31.1 JSON Serialization

```java
module com.acme.case.api {
    requires com.fasterxml.jackson.databind;

    exports com.acme.case.api.dto;
    opens com.acme.case.api.dto to com.fasterxml.jackson.databind;
}
```

DTO diexport karena client module boleh memakai type-nya. DTO juga diopens karena serializer mungkin perlu reflection.

### 31.2 ORM Entity

```java
module com.acme.case.persistence {
    requires org.hibernate.orm.core;
    requires jakarta.persistence;

    exports com.acme.case.persistence.repository;
    opens com.acme.case.persistence.entity to org.hibernate.orm.core;
}
```

Entity tidak harus menjadi public API aplikasi. Repository/API persistence diexport sesuai kebutuhan.

### 31.3 Validation

```java
module com.acme.case.validation {
    requires jakarta.validation;

    exports com.acme.case.validation.api;
    opens com.acme.case.validation.model to jakarta.validation;
}
```

### 31.4 Dependency Injection

```java
module com.acme.case.app {
    requires jakarta.inject;
    requires com.acme.case.domain;

    opens com.acme.case.app.config to some.di.framework;
}
```

### 31.5 Reflection-Free Boundary

```java
module com.acme.case.domain {
    exports com.acme.case.domain.api;
    // no opens
}
```

Domain core tetap tertutup. Mapping dilakukan di adapter layer.

---

## 32. Advanced Boundary Design: Domain Core vs Adapter Layer

Dalam enterprise system, terutama regulatory/case management, boundary yang sehat sering seperti ini:

```text
com.acme.case.domain
  exports api
  no opens

com.acme.case.application
  exports usecase API if needed
  no or minimal opens

com.acme.case.adapter.rest
  exports DTO if consumed
  opens DTO to JSON framework

com.acme.case.adapter.persistence
  exports repository adapter if needed
  opens entity to ORM

com.acme.case.plugin.spi
  exports SPI

com.acme.case.plugin.standard
  provides SPI implementation
```

Makna:

- domain tidak tunduk pada serializer/ORM;
- adapter yang berurusan dengan framework dibuka secara eksplisit;
- SPI terpisah dari implementation;
- module descriptor menjadi peta arsitektur.

---

## 33. Failure Model: JPMS Advanced

### 33.1 `InaccessibleObjectException`

Biasanya muncul ketika reflection mencoba membuka member tapi package tidak opened.

Root cause:

- lupa `opens`;
- salah target module;
- framework berjalan dari unnamed module;
- package berubah;
- test runtime berbeda dari production runtime.

Solusi matang:

- identifikasi caller module;
- tambahkan qualified `opens` jika benar;
- pindahkan reflection ke adapter package;
- ganti reflection dengan explicit API/generated code bila mungkin.

### 33.2 `ServiceConfigurationError`

Muncul saat service provider gagal dimuat/diinstansiasi.

Root cause:

- provider declaration salah;
- class provider tidak valid;
- constructor melempar exception;
- dependency provider hilang;
- module graph tidak resolve.

Solusi:

- validasi provider saat startup;
- log provider class/module;
- constructor provider harus ringan;
- duplicate/invalid provider ditangani eksplisit.

### 33.3 `LayerInstantiationException`

Muncul saat membuat module layer gagal.

Root cause:

- split package;
- duplicate module;
- classloader mapping invalid;
- module graph conflict.

Solusi:

- pre-validate plugin directory;
- enforce naming/versioning;
- hindari split package;
- isolasi plugin ABI.

### 33.4 Class Identity Bug

Gejala:

```text
ClassCastException: com.acme.Plugin cannot be cast to com.acme.Plugin
```

Penyebab:

- class sama dimuat oleh classloader berbeda;
- SPI class ikut dibundel di plugin jar;
- parent/child loader boundary salah.

Solusi:

- SPI harus dimuat parent layer/loader;
- plugin jangan membawa copy SPI;
- shading/relocation harus hati-hati;
- classloader strategy didokumentasikan.

---

## 34. Anti-Pattern JPMS Advanced

### 34.1 Export Everything

```java
module com.acme.case {
    exports com.acme.case.internal;
    exports com.acme.case.persistence.entity;
    exports com.acme.case.util;
}
```

Masalah:

- semua menjadi public contract;
- refactoring mahal;
- internal API dipakai sembarangan;
- module system kehilangan nilai.

### 34.2 Open Everything Forever

```java
open module com.acme.case {
    requires ...;
}
```

Bisa untuk migrasi, buruk untuk long-term.

### 34.3 `--add-opens` Blanket

```bash
--add-opens java.base/java.lang=ALL-UNNAMED
--add-opens java.base/java.util=ALL-UNNAMED
```

Tanpa owner, ini technical debt dan security smell.

### 34.4 SPI Bocor Internal

```java
public interface Plugin {
    void execute(InternalService service);
}
```

Plugin menjadi tightly coupled ke internal app.

### 34.5 Plugin Constructor Melakukan I/O

Provider discovery menjadi unpredictable.

### 34.6 ModuleLayer Untuk Hal yang Cukup Dengan DI

Tidak semua extension butuh module layer. Jangan menambah runtime graph complexity tanpa manfaat isolation/discovery yang jelas.

---

## 35. Design Checklist: `opens`

Sebelum menambah `opens`, tanya:

1. Siapa caller reflective-nya?
2. Apakah package perlu dibuka ke semua module atau hanya module tertentu?
3. Apakah reflection terjadi di production atau hanya test?
4. Apakah package ini domain core atau adapter/framework boundary?
5. Apakah bisa diganti explicit constructor/accessor?
6. Apakah bisa diganti generated code?
7. Apakah ada data sensitif di object yang dibuka?
8. Apakah annotation/field private menjadi implicit contract?
9. Apakah future refactor akan sulit karena framework bergantung ke internals?
10. Apakah directive ini didokumentasikan?

---

## 36. Design Checklist: ServiceLoader/SPI

Sebelum membuat SPI:

1. Apakah extension point benar-benar perlu?
2. Apakah SPI lebih stabil daripada implementation?
3. Apakah SPI kecil?
4. Apakah input/output SPI tidak membocorkan internal model?
5. Apakah provider discovery deterministic?
6. Apakah duplicate provider ditangani?
7. Apakah provider failure model jelas?
8. Apakah provider lifecycle jelas?
9. Apakah provider constructor ringan?
10. Apakah versioning SPI direncanakan?

---

## 37. Design Checklist: ModuleLayer Plugin

Sebelum memakai `ModuleLayer`:

1. Apakah plugin perlu dimuat dari lokasi runtime?
2. Apakah plugin perlu isolation?
3. Apakah hot load/unload benar-benar dibutuhkan?
4. Apakah classloader identity dipahami?
5. Apakah SPI dimuat dari parent layer?
6. Apakah plugin dependency graph divalidasi?
7. Apakah split package dicegah?
8. Apakah lifecycle plugin eksplisit?
9. Apakah resource cleanup bisa diverifikasi?
10. Apakah observability plugin tersedia?

---

## 38. Design Checklist: `jlink`

Sebelum memakai `jlink`:

1. Apakah aplikasi/module graph cukup modular?
2. Apakah image size/startup/runtime control benar-benar penting?
3. Apakah build pipeline bisa membuat image reproducible?
4. Apakah security update JDK akan rebuild image?
5. Apakah diagnostic tools yang dibutuhkan ada?
6. Apakah plugin/runtime dynamic loading kompatibel?
7. Apakah container strategy sudah mempertimbangkan image final?
8. Apakah SBOM/scanning tersedia?
9. Apakah integration test dijalankan pada runtime image final?
10. Apakah rollback image jelas?

---

## 39. Case Study: Modular Regulatory Case Rule Engine

Misalnya Anda membuat rule engine untuk case management.

Kebutuhan:

- core domain tidak boleh bergantung ke framework;
- adapter REST butuh JSON reflection;
- persistence butuh ORM reflection;
- rule plugin bisa ditambah per agency;
- runtime image perlu kecil untuk deployment tertentu;
- SPI harus stabil.

Desain module:

```text
com.gov.case.domain
com.gov.case.application
com.gov.case.adapter.rest
com.gov.case.adapter.persistence
com.gov.case.rule.spi
com.gov.case.rule.standard
com.gov.case.app
```

### 39.1 Domain Module

```java
module com.gov.case.domain {
    exports com.gov.case.domain.api;
    // no opens: domain core tidak dibuka untuk framework
}
```

### 39.2 REST Adapter

```java
module com.gov.case.adapter.rest {
    requires com.gov.case.application;
    requires com.fasterxml.jackson.databind;

    exports com.gov.case.adapter.rest.api;
    opens com.gov.case.adapter.rest.dto to com.fasterxml.jackson.databind;
}
```

### 39.3 Persistence Adapter

```java
module com.gov.case.adapter.persistence {
    requires com.gov.case.domain;
    requires jakarta.persistence;
    requires org.hibernate.orm.core;

    exports com.gov.case.adapter.persistence.repository;
    opens com.gov.case.adapter.persistence.entity to org.hibernate.orm.core;
}
```

### 39.4 Rule SPI

```java
module com.gov.case.rule.spi {
    exports com.gov.case.rule.spi;
}
```

```java
package com.gov.case.rule.spi;

public interface CaseRuleProvider {
    RuleProviderDescriptor descriptor();
    List<CaseRule> rules(RuleProviderContext context);
}
```

### 39.5 Rule Provider

```java
module com.gov.case.rule.standard {
    requires com.gov.case.rule.spi;

    provides com.gov.case.rule.spi.CaseRuleProvider
        with com.gov.case.rule.standard.StandardCaseRuleProvider;
}
```

### 39.6 Application Module

```java
module com.gov.case.app {
    requires com.gov.case.application;
    requires com.gov.case.rule.spi;

    uses com.gov.case.rule.spi.CaseRuleProvider;
}
```

### 39.7 Architectural Result

- Domain tetap bersih.
- Framework reflection terbatas di adapter.
- Rules bisa discover via service mechanism.
- SPI tidak membocorkan persistence/REST internals.
- Module descriptor menjadi architecture map.
- Jika butuh plugin external, module layer bisa ditambahkan kemudian.
- Jika deployment stabil, `jlink` bisa membangun custom runtime.

---

## 40. Migration Strategy: Dari Classpath Framework-Heavy ke JPMS

Tahapan realistis:

### Step 1 — Inventory

Buat daftar:

- package public API;
- package internal;
- package DTO;
- package entity;
- package config;
- package test fixture;
- framework yang memakai reflection;
- command-line `--add-opens` saat ini.

### Step 2 — Tambahkan `Automatic-Module-Name`

Untuk library jar yang belum modular, tambahkan stable automatic module name via manifest.

### Step 3 — Modularisasi Leaf Module

Mulai dari module yang dependency-nya sedikit:

- utility yang jelas;
- domain API;
- SPI;
- library internal kecil.

### Step 4 — Tambahkan `exports` Minimal

Export hanya package API.

### Step 5 — Tambahkan Qualified `opens`

Buka package reflective hanya ke framework target.

### Step 6 — Jalankan Test di Module Path

Banyak masalah baru muncul saat benar-benar memakai module path.

### Step 7 — Kurangi `--add-opens`

Ganti command-line escape hatch dengan descriptor yang eksplisit.

### Step 8 — Evaluasi Generated Code

Ganti reflection yang tidak perlu dengan compile-time generation bila masuk akal.

### Step 9 — Pertimbangkan Services

Gunakan `uses/provides` untuk extension point yang stabil.

### Step 10 — Pertimbangkan `jlink`

Setelah module graph sehat, baru evaluasi runtime image.

---

## 41. Mental Model Final

JPMS advanced bukan tentang membuat aplikasi “lebih ribet”. Tujuannya adalah membuat boundary yang sebelumnya implicit menjadi explicit.

Tanpa JPMS:

```text
classpath besar
  semua bisa melihat banyak hal
  framework reflect ke mana saja
  dependency error muncul lambat
  internal API mudah bocor
```

Dengan JPMS yang sehat:

```text
module graph eksplisit
  API diexport secara sadar
  reflection dibuka secara sadar
  provider discovery dideklarasikan
  plugin layer bisa diisolasi
  runtime image bisa dikontrol
```

Tetapi JPMS bisa gagal bila dipakai secara mekanis:

- export semua package;
- open semua package;
- menambah `--add-opens` tanpa ownership;
- memakai module layer tanpa lifecycle strategy;
- membuat SPI yang membocorkan internals;
- memakai `jlink` tanpa patch governance.

Top engineer tidak bertanya:

> “Bagaimana supaya error module hilang?”

Top engineer bertanya:

> “Boundary mana yang memang harus terlihat, boundary mana yang hanya perlu direfleksi, extension mana yang perlu discovery, dan runtime mana yang ingin kita operasikan?”

---

## 42. Practical Rules of Thumb

1. Export API, bukan implementation.
2. Open adapter/model package hanya ke framework yang butuh.
3. Hindari `open module` kecuali untuk transisi.
4. Treat `--add-opens` as technical debt with owner.
5. Keep domain core reflection-free bila memungkinkan.
6. Use generated code untuk boilerplate deterministic.
7. Use `ServiceLoader` untuk SPI sederhana dan stabil.
8. Use DI container untuk object graph aplikasi yang kompleks.
9. Use `ModuleLayer` hanya bila butuh runtime modular isolation/discovery.
10. Use `jlink` hanya bila runtime image governance matang.
11. Jangan bocorkan internal classes ke SPI.
12. Provider constructor harus murah.
13. Plugin lifecycle harus explicit.
14. Test-time opening jangan menjadi production opening.
15. Module descriptor adalah architecture document; jaga agar tetap meaningful.

---

## 43. Ringkasan

Di Part 027, kita membahas:

- perbedaan `exports` dan `opens`;
- qualified `opens`;
- `open module` dan risikonya;
- command-line `--add-opens` sebagai escape hatch;
- reflection under strong encapsulation;
- framework compatibility pattern;
- service mechanism dengan `uses` dan `provides`;
- `ServiceLoader` design dan failure model;
- `ModuleLayer` untuk plugin architecture;
- classloader identity risk;
- plugin lifecycle;
- `jlink` dan custom runtime image;
- testing modular application;
- JPMS migration strategy;
- case study modular regulatory rule engine.

Inti bagian ini:

> JPMS advanced adalah seni membuat akses menjadi eksplisit: akses compile-time lewat `exports`, akses reflection lewat `opens`, discovery lewat `uses/provides`, isolation lewat `ModuleLayer`, dan runtime footprint lewat `jlink`.

---

## 44. Status Seri

Seri **belum selesai**.

Part yang sudah selesai:

- Part 000 — Orientation
- Part 001 — Java Type System Deep Dive
- Part 002 — Class Anatomy
- Part 003 — Object Identity, Equality, Hashing, Immutability
- Part 004 — Encapsulation Beyond `private`
- Part 005 — Inheritance Deep Dive
- Part 006 — Interfaces Deep Dive
- Part 007 — Sealed Classes and Controlled Hierarchies
- Part 008 — Records Deep Dive
- Part 009 — Enums as Type-Safe State, Strategy, Registry, and Domain Model
- Part 010 — Nested, Inner, Local, and Anonymous Classes
- Part 011 — Generics for API Designers
- Part 012 — Advanced Polymorphism
- Part 013 — Composition, Delegation, Mixins, and Object Collaboration Design
- Part 014 — Functional Java Mental Model
- Part 015 — Lambdas Under the Hood
- Part 016 — Functional Interfaces and Higher-Order API Design
- Part 017 — Optional, Nullability, Result Modeling, and Error Channels
- Part 018 — Reflection Deep Dive I
- Part 019 — Reflection Deep Dive II
- Part 020 — MethodHandles and VarHandles
- Part 021 — Annotation Design
- Part 022 — Annotation Processing
- Part 023 — Code Generation Strategy
- Part 024 — Dynamic Proxy, Bytecode Libraries, Agents, and Instrumentation Concepts
- Part 025 — Package Architecture
- Part 026 — JPMS Deep Dive I
- Part 027 — JPMS Deep Dive II

Berikutnya:

- Part 028 — Maven/Gradle Dependency Governance for Serious Java Systems
