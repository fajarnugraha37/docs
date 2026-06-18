# Part 13 — Eclipse Equinox Runtime: Eclipse Platform, p2, Extension Registry, Enterprise Lessons

> Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
> File: `13-eclipse-equinox-runtime-eclipse-platform-p2-extension-registry-enterprise-lessons.md`  
> Scope: Java 8 sampai Java 25  
> Level: Advanced / platform engineering

---

## 0. Posisi Part Ini Dalam Series

Pada part sebelumnya kita sudah membahas:

- mental model OSGi sebagai dynamic module runtime,
- lifecycle framework dan bundle,
- manifest dan metadata bundle,
- class loading per bundle,
- dependency model,
- resolver engineering,
- semantic versioning,
- service registry,
- Declarative Services,
- Configuration Admin,
- bnd/Bndtools,
- Apache Felix runtime.

Sekarang kita masuk ke **Eclipse Equinox**.

Kalau Felix sering dipakai sebagai **OSGi framework ringan**, maka Equinox perlu dipahami sebagai:

1. implementasi OSGi framework,
2. runtime foundation untuk Eclipse Platform,
3. ekosistem provisioning lewat p2,
4. plugin platform dengan extension registry,
5. contoh nyata sistem modular besar yang sudah hidup lama,
6. sumber banyak pelajaran enterprise tentang modularitas, extensibility, compatibility, dan runtime evolution.

Equinox penting bukan hanya karena ia salah satu implementasi OSGi. Ia penting karena Eclipse IDE, Eclipse RCP, dan banyak produk berbasis Eclipse membuktikan bahwa OSGi dapat dipakai untuk membangun sistem plugin besar dengan ribuan bundle, update site, extension point, compatibility constraint, dan multi-version lifecycle.

Mental model utama part ini:

> Equinox adalah OSGi framework yang tumbuh bersama Eclipse Platform. Karena itu, memahami Equinox berarti memahami bagaimana OSGi dipakai bukan hanya untuk menjalankan bundle, tetapi untuk membangun platform produk yang extensible, provisionable, dan bisa berevolusi selama bertahun-tahun.

---

## 1. Apa Itu Equinox?

Secara teknis, **Equinox** adalah implementasi dari OSGi Core Framework dan beberapa optional services/infrastructure untuk menjalankan sistem berbasis OSGi.

Tetapi secara arsitektural, Equinox lebih dari itu.

Equinox berada di tengah beberapa dunia:

```text
+-------------------------------------------------------------+
|                    Eclipse IDE / RCP Product                |
+-------------------------------------------------------------+
|     Eclipse Platform Runtime, Workbench, Resources, UI      |
+-------------------------------------------------------------+
|      Extension Registry, Jobs, Preferences, Update/p2       |
+-------------------------------------------------------------+
|                  Equinox OSGi Framework                     |
+-------------------------------------------------------------+
|                       Java Runtime                          |
+-------------------------------------------------------------+
```

Dalam plain OSGi, kita biasanya bicara:

```text
Framework + Bundles + Services
```

Dalam Eclipse/Equinox ecosystem, kita sering bicara:

```text
Product + Features + Plugins + Extension Points + p2 + OSGi runtime
```

Istilahnya bisa berbeda, tapi fondasinya tetap OSGi:

| Eclipse term | OSGi/runtime meaning |
|---|---|
| plug-in | biasanya OSGi bundle |
| feature | grouping untuk provisioning/update |
| product | runnable distribution |
| extension point | deklaratif extension mechanism di atas OSGi |
| update site | repository/provisioning source |
| target platform | dependency universe untuk build/run |
| p2 | provisioning system |
| Equinox | OSGi framework/runtime implementation |

Yang perlu disadari: **Eclipse plugin model tidak identik dengan OSGi service model**.

OSGi service registry bersifat runtime-dynamic dan object/service oriented. Eclipse extension registry bersifat declarative metadata-driven. Keduanya bisa hidup bersama, tetapi mental modelnya berbeda.

---

## 2. Kenapa Engineer Backend Perlu Belajar Equinox?

Kalau kamu bukan Eclipse plugin developer, kenapa perlu peduli?

Karena Equinox mengajarkan beberapa hal yang jarang dipelajari dari Spring Boot atau microservices:

1. **Long-lived modular platform evolution**  
   Bagaimana menjaga kompatibilitas plugin/API selama bertahun-tahun.

2. **Provisioning sebagai problem arsitektur**  
   Bagaimana meng-install, update, uninstall, dan rollback modul dalam sistem besar.

3. **Runtime extension governance**  
   Bagaimana third-party extension bisa masuk tanpa membuka semua internal implementation.

4. **Declarative extension metadata**  
   Bagaimana platform menemukan kontribusi tanpa scanning seluruh classpath.

5. **Bundle granularity at scale**  
   Bagaimana ratusan/ribuan module disusun dan dikontrol.

6. **Classloader dan dependency isolation real-world**  
   Eclipse sudah lama menghadapi masalah yang baru belakangan muncul di plugin system modern.

7. **Product-line engineering**  
   Satu codebase/platform bisa menghasilkan banyak distribution/product.

Untuk engineer yang membangun regulated case management platform, enforcement lifecycle engine, workflow plugin runtime, atau domain-specific extensible backend, Equinox memberikan pola pikir yang sangat berguna.

---

## 3. Equinox vs Felix vs Karaf: Posisi Mental Model

Sebelum masuk detail, kita perlu bedakan tiga nama yang sering muncul:

| Runtime | Mental model | Kekuatan utama |
|---|---|---|
| Felix | lightweight OSGi framework | kecil, mudah di-embed, jelas |
| Equinox | OSGi framework + Eclipse platform heritage | plugin ecosystem, p2, RCP, extension registry |
| Karaf | OSGi distribution/container | ops, shell, features, config, deployment |

Secara sederhana:

```text
Felix  = good raw framework/kernel
Equinox = good platform foundation, especially Eclipse/RCP/plugin ecosystem
Karaf  = good operational distribution around OSGi
```

Namun ini bukan hukum absolut.

Equinox bisa dipakai headless. Felix bisa jadi basis platform produk. Karaf bisa memakai Felix atau Equinox sebagai framework di bawahnya pada beberapa konteks/version.

Yang membedakan bukan hanya API OSGi-nya, tetapi **tooling, ecosystem assumption, provisioning model, dan operational posture**.

---

## 4. Core Equinox Runtime Model

Di level core, Equinox tetap menjalankan konsep OSGi:

- bundle install,
- bundle resolve,
- bundle start,
- bundle stop,
- package import/export,
- service registry,
- framework events,
- bundle lifecycle,
- start level,
- resolver,
- bundle classloader.

Struktur runtime headless minimal dapat dibayangkan seperti ini:

```text
java
  └── Equinox launcher / org.eclipse.osgi
        ├── framework storage
        ├── configuration area
        ├── installed bundles
        ├── resolved wirings
        ├── service registry
        └── framework console / management hooks
```

Dalam Eclipse product, layout menjadi lebih kompleks:

```text
product-root/
  eclipse.ini
  configuration/
  plugins/
  features/
  p2/
  artifacts.xml / content.xml / repository metadata
  dropins/                 optional legacy/drop-in style
  workspace/               for IDE/RCP workspace-style apps
```

Beberapa direktori penting:

| Area | Fungsi |
|---|---|
| `plugins/` | tempat bundle/plug-in berada |
| `features/` | grouping feature untuk p2/product |
| `configuration/` | runtime configuration/cache |
| `p2/` | provisioning metadata/profile/artifact info |
| workspace metadata | state aplikasi Eclipse/RCP, bukan framework core saja |

Dalam backend headless, kamu mungkin tidak punya workspace seperti Eclipse IDE. Tetapi konsep configuration/provisioning/cache tetap relevan.

---

## 5. Launching Equinox

Ada beberapa cara menjalankan Equinox:

1. langsung memakai `org.eclipse.osgi` sebagai framework JAR,
2. memakai Equinox launcher,
3. memakai Eclipse product launcher,
4. embedding Equinox melalui OSGi `FrameworkFactory`,
5. memakai p2-created product/distribution.

### 5.1 Direct framework launch

Secara konseptual:

```bash
java -jar org.eclipse.osgi.jar -console
```

Namun dalam distribusi modern, Equinox sering dijalankan lewat launcher karena ada kebutuhan:

- membaca `.ini`,
- memilih VM args,
- menyiapkan configuration area,
- menemukan bundle startup,
- mengatur product/application,
- native launcher integration.

### 5.2 Eclipse launcher

Eclipse launcher memisahkan concern:

```text
native executable / launcher jar
  reads .ini
  prepares runtime args
  starts Equinox
  launches Eclipse application
```

Di Eclipse product, file `.ini` sangat penting.

Contoh mental `.ini`:

```text
-startup
plugins/org.eclipse.equinox.launcher_*.jar
--launcher.library
plugins/org.eclipse.equinox.launcher.*
-configuration
configuration
-data
workspace
-vmargs
-Xms512m
-Xmx2048m
```

Untuk backend/server-side Equinox, kamu mungkin tidak membutuhkan semua ini. Tetapi prinsipnya sama: launcher mengatur boundary antara OS process, JVM, framework, dan application.

---

## 6. `config.ini`: Bootstrap Configuration

Equinox sering memakai `configuration/config.ini` untuk mengatur runtime bootstrap.

Contoh konseptual:

```properties
osgi.bundles=\
  org.eclipse.equinox.common@2:start,\
  org.eclipse.equinox.ds@2:start,\
  com.example.platform.api@3:start,\
  com.example.platform.core@4:start

osgi.bundles.defaultStartLevel=4
osgi.framework=file:plugins/org.eclipse.osgi.jar
osgi.configuration.area=configuration
osgi.install.area=file:/opt/my-product
osgi.instance.area=file:/var/lib/my-product/workspace
```

Makna penting:

| Property | Makna |
|---|---|
| `osgi.bundles` | daftar bundle yang di-install/start saat bootstrap |
| `@start` | bundle langsung distart |
| `@<level>` | start level bundle |
| `osgi.bundles.defaultStartLevel` | default level bundle |
| `osgi.configuration.area` | configuration/cache area |
| `osgi.install.area` | install location product |
| `osgi.instance.area` | instance/workspace data area |

Kesalahan umum:

```text
Bundle ada di folder plugins, tetapi tidak masuk osgi.bundles/provisioning profile.
```

Di Equinox/Eclipse style, “file ada” tidak selalu berarti “bundle dipakai runtime”. Provisioning/profile/config menentukan apa yang menjadi runtime universe.

---

## 7. Install Area, Configuration Area, Instance Area, User Area

Equinox/Eclipse memperkenalkan konsep area yang penting untuk produk nyata.

```text
+----------------------+------------------------------------------+
| Area                 | Fungsi                                   |
+----------------------+------------------------------------------+
| install area         | lokasi produk/binaries                   |
| configuration area   | runtime config/cache/provisioning state  |
| instance area        | workspace/app instance data              |
| user area            | user-specific data/config                |
+----------------------+------------------------------------------+
```

Mental model:

```text
install area      = what product is installed
configuration area = how runtime is configured/resolved
instance area     = what this running instance works on
user area         = who is using it
```

Untuk backend/server-side, kamu bisa mapping:

| Eclipse area | Backend equivalent |
|---|---|
| install area | immutable container image / product dir |
| configuration area | generated runtime config / cache |
| instance area | persistent application state / data dir |
| user area | per-user preferences, rarely relevant server-side |

Pelajaran production penting:

> Jangan campur binary immutable, mutable runtime cache, dan business data dalam satu direktori tanpa batas yang jelas.

Ini berlaku di OSGi, Spring Boot, Kubernetes, maupun sistem enterprise biasa.

---

## 8. Equinox Console

Equinox menyediakan console untuk inspeksi dan manajemen framework.

Perintah dapat bervariasi berdasarkan bundle console yang dipasang, tetapi kategori umumnya:

- bundle list,
- bundle start/stop/update,
- service inspection,
- package/wiring inspection,
- framework properties,
- diagnostics.

Contoh konseptual command:

```text
ss
bundles
services
headers <bundle-id>
diag <bundle-id>
start <bundle-id>
stop <bundle-id>
refresh <bundle-id>
packages
```

Yang harus dicari saat troubleshooting:

```text
Bundle state:
  INSTALLED? -> resolver problem
  RESOLVED?  -> start/lifecycle problem
  ACTIVE?    -> maybe service/component problem

Service state:
  service registered?
  properties correct?
  ranking expected?
  consuming bundle sees it?

Wiring state:
  imported package wired to which exporter?
  multiple exporters?
  uses constraint violation?
```

Console bukan sekadar operational convenience. Dalam sistem OSGi, console adalah cara berpikir: runtime harus dapat diinspeksi sebagai graph, bukan hanya log stream.

---

## 9. Equinox p2: Provisioning as Runtime Architecture

Salah satu bagian paling khas Equinox adalah **p2**.

p2 adalah provisioning platform untuk Eclipse-based applications. Ia mengurus menemukan, memasang, memperbarui, dan menghapus functionality.

Dalam OSGi sederhana, kamu mungkin berpikir:

```text
copy bundle jar -> framework installs bundle
```

Dalam p2, kamu berpikir:

```text
repository metadata + artifact repository + installable units + profile + planner + engine
```

### 9.1 Kenapa p2 ada?

Karena sistem plugin besar butuh lebih dari sekadar copy JAR:

- dependency validation,
- install/update planning,
- artifact download,
- feature grouping,
- rollback profile,
- bundle pooling,
- product installation,
- update site,
- user-facing update mechanism,
- installation state management.

### 9.2 Konsep inti p2

| Konsep | Makna |
|---|---|
| Installable Unit / IU | unit logis yang bisa diinstall/update |
| Artifact | file fisik, misalnya bundle JAR |
| Metadata repository | dependency/capability info |
| Artifact repository | lokasi file artifact |
| Profile | state installation tertentu |
| Planner | menghitung perubahan yang valid |
| Engine | menjalankan provisioning action |
| Feature | grouping plugin/IU untuk distribution |
| Product | runnable application/distribution |

Mental model:

```text
Repository says: what exists and what it requires/provides
Profile says: what this installation currently has
Planner says: what change is valid
Engine says: apply the change
```

### 9.3 p2 vs Maven repository

Maven repository menjawab:

```text
Given groupId/artifactId/version, where is artifact?
```

p2 repository menjawab:

```text
Given product/profile/capability requirements, what installable units and artifacts produce a valid installation?
```

Maven dependency resolution mostly happens at build time. p2 provisioning is deeply tied to product installation/update.

### 9.4 p2 vs Karaf Features

| Aspect | p2 | Karaf Features |
|---|---|---|
| Heritage | Eclipse product provisioning | OSGi server/container provisioning |
| Unit | IU, feature, product | feature XML, bundle list |
| UX | update sites, product install/update | shell/deploy/server ops |
| State | profile-based installation | runtime/container oriented |
| Strength | product-line/update ecosystem | operational OSGi deployment |

Untuk backend server, Karaf sering terasa lebih natural. Untuk desktop/product/plugin ecosystem, p2 sangat kuat.

---

## 10. Features and Products

Dalam Eclipse ecosystem, bundle/plugin sering digabung menjadi **feature**.

```text
Feature: com.example.case-management.feature
  includes:
    com.example.case.api
    com.example.case.core
    com.example.case.ui
    com.example.case.persistence
```

Feature bukan runtime module OSGi dalam arti classloader. Feature adalah provisioning/package grouping.

Perbedaan penting:

| Item | Runtime classloader? | Provisioning unit? | Contains code? |
|---|---:|---:|---:|
| Bundle/plugin | yes | yes | yes |
| Feature | no | yes | usually metadata + grouping |
| Product | no direct classloader | yes | application definition |

Kesalahan mental umum:

```text
“Saya sudah include feature, berarti package-nya bisa di-import.”
```

Tidak langsung. Yang dieksekusi dan di-resolve tetap bundle/package capability. Feature hanya grouping provisioning.

### 10.1 Product-line engineering

Dengan feature/product, kamu bisa membuat varian:

```text
Base Platform
  + Case Management Feature
  + Compliance Feature
  + Reporting Feature
  + Agency A Connector Feature

Agency B Product
  Base Platform
  + Case Management Feature
  + Survey Feature
  + Agency B Connector Feature
```

Ini sangat relevan untuk enterprise/regulatory platform di mana satu kernel dipakai untuk banyak domain/agency/customer.

---

## 11. Eclipse Extension Registry vs OSGi Service Registry

Ini bagian paling penting secara arsitektur.

Eclipse punya **extension registry**. OSGi punya **service registry**.

Keduanya sama-sama mendukung extensibility, tetapi berbeda model.

### 11.1 OSGi Service Registry

```text
Provider registers object instance as service
Consumer tracks service by type/properties
Invocation happens directly through Java interface
Service can come and go dynamically
```

Cocok untuk:

- runtime service collaboration,
- dynamic implementation replacement,
- stateful runtime objects,
- lifecycle-aware components,
- service composition.

### 11.2 Eclipse Extension Registry

```text
Plugin declares contribution in plugin.xml
Platform reads extension metadata
Consumer reads extension declarations
Consumer may instantiate classes lazily
```

Cocok untuk:

- declarative contribution,
- menu/action/view/editor extension,
- static-ish plugin discovery,
- metadata-rich extension point,
- lazy instantiation,
- tooling support.

Contoh konseptual `plugin.xml`:

```xml
<extension point="com.example.validation.rules">
  <rule
      id="late-submission"
      label="Late Submission Rule"
      class="com.example.rules.LateSubmissionRule"
      priority="100" />
</extension>
```

Consumer membaca metadata:

```text
extensionRegistry.getConfigurationElementsFor("com.example.validation.rules")
```

Lalu instantiate class hanya jika dibutuhkan.

### 11.3 Kapan pakai extension registry?

Gunakan extension registry kalau kontribusi lebih tepat sebagai metadata deklaratif:

- menu item,
- editor/view contribution,
- command declaration,
- static extension point,
- plugin metadata,
- object perlu lazy-created,
- kontribusi perlu bisa dipahami tooling.

### 11.4 Kapan pakai OSGi service?

Gunakan OSGi service kalau kontribusi adalah runtime object aktif:

- validation service,
- connector service,
- renderer service,
- repository service,
- notification channel,
- processing pipeline,
- runtime health-aware dependency.

### 11.5 Mapping untuk backend plugin platform

Untuk backend, extension registry style bisa diadaptasi sebagai:

```text
plugin declares metadata:
  rule id
  supported module
  priority
  config schema
  required permission
  class/service type

runtime loads/activates implementation through OSGi service or DS
```

Pattern hybrid:

```text
Extension metadata = what contribution exists
OSGi service       = live executable implementation
```

Ini sangat kuat untuk regulated workflow platform: metadata bisa direview/audit, implementation tetap dynamic dan lifecycle-aware.

---

## 12. `plugin.xml` and Declarative Extension Model

Dalam Eclipse plugin, `plugin.xml` mendeklarasikan extension dan extension point.

### 12.1 Extension point provider

Platform/provider mendefinisikan extension point:

```xml
<extension-point
    id="validationRules"
    name="Validation Rules"
    schema="schema/validationRules.exsd" />
```

### 12.2 Extension contributor

Plugin lain contribute:

```xml
<extension point="com.example.platform.validationRules">
  <rule
      id="case-age-limit"
      label="Case Age Limit"
      class="com.example.rules.CaseAgeLimitRule" />
</extension>
```

### 12.3 Schema-driven governance

`.exsd` schema memungkinkan platform mendefinisikan:

- element valid,
- attribute required,
- data type,
- documentation,
- examples,
- tooling validation.

Ini pelajaran besar untuk platform engineering:

> Extension API bukan hanya Java interface. Extension API juga bisa berupa metadata schema.

Dalam backend modern, analoginya:

- JSON schema untuk plugin descriptor,
- YAML schema untuk connector definition,
- OpenAPI extension metadata,
- workflow DSL schema,
- policy/rule metadata schema.

---

## 13. Eclipse Runtime Applications

Eclipse/Equinox sering menjalankan application berdasarkan extension point tertentu.

Secara konseptual:

```text
-product com.example.product
-application com.example.application
```

Product menentukan branding/config/distribution. Application menentukan entry point runtime.

Dalam plain Java:

```text
main(String[] args)
```

Dalam Eclipse/Equinox:

```text
Launcher starts framework
Framework starts bundles
Application extension selected
Application object executed
```

Perbedaan mental:

```text
Java main owns the application lifecycle.
Equinox launcher/framework owns the runtime; application is one contribution inside platform.
```

Ini cocok untuk product platform karena entry point pun bisa menjadi extension.

---

## 14. Headless Equinox

Equinox tidak harus berarti Eclipse IDE atau UI.

Headless Equinox berarti:

```text
OSGi runtime using Equinox without Workbench/UI
```

Use case:

- backend modular platform,
- provisioning engine,
- command-line tool,
- batch processor,
- embedded plugin runtime,
- server-side extension platform,
- product-line service runtime.

Minimal headless runtime biasanya butuh:

- `org.eclipse.osgi`,
- DS/SCR bundle jika pakai Declarative Services,
- Config Admin jika pakai config,
- logging,
- application entry bundle,
- optional p2/provisioning bundles.

Yang tidak perlu:

- Workbench,
- SWT/JFace,
- UI bundles,
- workspace resources jika tidak relevan,
- PDE tooling at runtime.

Kesalahan umum:

```text
Menganggap Equinox selalu berat karena Eclipse IDE berat.
```

Equinox core framework tidak sama dengan seluruh Eclipse IDE.

---

## 15. RCP Architecture Lessons

Eclipse RCP adalah contoh besar aplikasi modular berbasis Equinox.

Pelajaran yang bisa diambil:

### 15.1 Platform kernel harus kecil

Kernel sebaiknya tidak tahu semua plugin.

```text
Bad:
  core imports every plugin implementation

Good:
  core defines API/extension point
  plugin contributes capability/service
```

### 15.2 API bundles harus stabil

Plugin ecosystem hanya sehat jika API stabil.

```text
com.example.platform.api
com.example.platform.spi
com.example.platform.internal
```

Public API tidak boleh bocor ke package internal.

### 15.3 Extension metadata perlu schema

Kalau extension hanya Java class, platform sulit:

- validate,
- document,
- discover,
- audit,
- version,
- show in UI,
- configure safely.

### 15.4 Lazy activation penting

Sistem besar tidak boleh instantiate semua plugin saat startup.

Extension registry model memberi pelajaran:

```text
Read metadata first.
Instantiate implementation only when needed.
```

Dalam backend, ini bisa menjadi:

```text
Load rule metadata at startup.
Activate expensive connector only when tenant/module uses it.
```

### 15.5 Product assembly adalah architecture concern

Produk bukan hanya deployment packaging.

Produk menentukan:

- fitur apa tersedia,
- extension mana aktif,
- dependency universe,
- compatibility policy,
- update path,
- support matrix.

---

## 16. PDE, Target Platform, and Build-Time Universe

Dalam Eclipse plugin development, **target platform** adalah universe dependency yang digunakan untuk compile, resolve, dan test plugin.

Mental model:

```text
Target Platform = the OSGi world your plugins are allowed to see
```

Ini mirip tetapi tidak sama dengan Maven dependency tree.

Target platform bisa berisi:

- bundles dari Eclipse SDK,
- third-party bundles,
- local workspace bundles,
- p2 repositories,
- specific product baseline.

Kenapa penting?

Karena plugin compile terhadap API yang tersedia di target platform. Kalau target platform berubah, plugin bisa resolve berbeda.

Enterprise lesson:

> Dependency universe harus dikunci. Kalau tidak, build bisa sukses hari ini dan gagal besok karena repository/update site berubah.

Praktik sehat:

- pin repository versions,
- use product baseline,
- generate deterministic target platform,
- isolate dev target from production target,
- run resolver tests in CI,
- baseline API changes.

---

## 17. Equinox Classloading Specifics and Eclipse Buddy Policy

Equinox mengikuti OSGi classloading, tetapi Eclipse ecosystem punya beberapa historical mechanism, salah satunya **buddy classloading**.

Buddy classloading muncul untuk mengatasi library/framework yang butuh mencari class di bundle lain secara lebih longgar, misalnya serialization, registry, atau reflection-heavy framework.

Contoh header historis:

```text
Eclipse-BuddyPolicy: registered
Eclipse-RegisterBuddy: com.example.host
```

Mental model:

```text
Normal OSGi:
  imports/exports define visibility

Buddy classloading:
  controlled escape hatch used by Eclipse ecosystem
```

Peringatan:

> Buddy classloading adalah escape hatch, bukan default architecture pattern.

Gunakan hanya saat benar-benar perlu dan dokumentasikan konsekuensinya.

Risiko:

- dependency visibility menjadi kurang eksplisit,
- resolver tidak selalu mencerminkan runtime lookup,
- portability ke framework OSGi lain turun,
- debugging classloading lebih sulit,
- hidden coupling meningkat.

Untuk sistem baru, lebih baik:

- define API package,
- use OSGi service registry,
- use extension metadata,
- use explicit imports,
- use TCCL bridge secara lokal bila library membutuhkan.

---

## 18. Extension Registry vs Annotation Scanning

Eclipse extension registry memberi pelajaran penting: sistem plugin besar tidak boleh bergantung pada scanning classpath global.

Dalam classpath app, framework sering melakukan:

```text
scan all classes
find annotations
build registry
```

Di OSGi, ini bermasalah karena:

- tidak ada global classpath,
- bundle visibility terbatas,
- scanning mahal,
- scanning memicu class loading terlalu awal,
- plugin belum tentu aktif,
- dynamic install/update membuat scanning tidak stabil.

Extension registry approach:

```text
Plugin declares metadata in XML
Runtime reads metadata resource
Classes instantiated lazily
```

Equivalent modern backend approach:

```text
Plugin descriptor declares contributions
Runtime validates descriptor
Implementation service activated lazily
```

Keuntungannya:

- startup lebih cepat,
- metadata bisa divalidasi tanpa load class,
- dependency lebih eksplisit,
- plugin bisa dianalisis static,
- governance lebih kuat,
- audit lebih mudah.

---

## 19. Equinox and Declarative Services

Equinox dapat menjalankan OSGi Declarative Services dengan bundle DS runtime yang sesuai.

Dalam Eclipse ecosystem historis, ada beberapa model komponen:

- Eclipse extension registry,
- OSGi services,
- Declarative Services,
- older plugin activator patterns,
- Eclipse application/extension lifecycle.

Untuk sistem modern, rekomendasi mental:

```text
Use DS for runtime service composition.
Use extension registry or descriptor metadata for declarative contribution metadata.
Avoid putting lifecycle-heavy logic in BundleActivator.
```

Contoh:

```java
@Component(service = CaseValidator.class)
public final class DefaultCaseValidator implements CaseValidator {
    private final List<ValidationRule> rules;

    public DefaultCaseValidator(
        @Reference(cardinality = ReferenceCardinality.MULTIPLE)
        List<ValidationRule> rules
    ) {
        this.rules = List.copyOf(rules);
    }
}
```

Dalam Equinox/Eclipse plugin platform, kamu bisa menggabungkan:

```text
plugin.xml declares rule metadata
DS component registers actual ValidationRule service
```

---

## 20. Start Levels in Equinox

Seperti OSGi framework lain, Equinox mendukung start levels.

Start level dipakai untuk mengontrol urutan startup bundle.

Contoh:

```text
level 1: framework essentials
level 2: logging/config/DS
level 3: platform APIs
level 4: core services
level 5: connectors/plugins
level 6: application entrypoint
```

Namun jangan salah gunakan start level untuk mengatasi semua dependency.

Prinsip:

```text
Dependency availability should be modeled using service dependencies.
Startup coarse ordering may use start levels.
```

Anti-pattern:

```text
“Service A null, naikkan start level bundle B.”
```

Masalahnya mungkin bukan start order, tetapi service contract/lifecycle/reference handling.

Start level cocok untuk:

- framework infrastructure first,
- logging/config before app,
- management bundle early,
- optional application late,
- controlled startup wave.

Tidak cocok untuk:

- fine-grained dependency injection,
- replacing service tracking,
- hiding circular dependency,
- enforcing business sequence.

---

## 21. p2 Update and Rollback Lessons

p2 mengajarkan bahwa update runtime bukan sekadar replace JAR.

Update perlu memikirkan:

- dependency closure,
- compatible versions,
- artifact availability,
- configuration migration,
- state migration,
- rollback profile,
- installed feature consistency,
- partial failure,
- restart requirement,
- user/product constraints.

Dalam backend OSGi, kamu bisa mengambil pelajaran berikut:

### 21.1 Treat deployment as planned graph mutation

Jangan deploy bundle satu-satu tanpa memahami graph.

```text
Before:
  installed graph G1

Update plan:
  remove A 1.2
  install A 1.3
  update B 2.0
  keep C 1.5

After:
  resolved graph G2
```

Validasi:

- apakah G2 resolve?
- apakah package version compatible?
- apakah config schema compatible?
- apakah service contract compatible?
- apakah state migration perlu?

### 21.2 Immutable distribution is often safer server-side

Untuk server-side production, sering lebih aman:

```text
build full distribution -> test -> deploy immutable runtime -> rollback image if needed
```

daripada:

```text
ssh into runtime -> update random bundle -> hope resolver is fine
```

p2 berguna untuk product update ecosystem. Tetapi backend production sering butuh stronger release discipline.

### 21.3 Update profile harus bisa diaudit

Di regulated system, update harus menjawab:

- bundle apa berubah?
- versi sebelum/sesudah?
- dependency impact apa?
- config apa berubah?
- siapa approve?
- kapan applied?
- rollback plan apa?

OSGi graph membuat ini mungkin, tetapi hanya jika metadata dan tooling dimanfaatkan.

---

## 22. Equinox in Server-Side Systems

Equinox bisa dipakai server-side, tetapi perlu sadar trade-off.

Cocok jika:

- kamu sudah punya Eclipse/Equinox ecosystem,
- butuh p2 provisioning,
- punya product/plugin model mirip Eclipse,
- butuh extension registry,
- membangun RCP/headless product,
- ingin align dengan Eclipse bundles/tools.

Kurang cocok jika:

- kamu hanya butuh lightweight embedded OSGi,
- operational model lebih cocok Karaf,
- tim tidak punya pengalaman Eclipse/p2,
- deployment standard kamu container immutable sederhana,
- tidak butuh extension registry/p2.

Decision table:

| Need | Better default |
|---|---|
| Minimal embedded OSGi kernel | Felix or Equinox direct |
| Eclipse plugin/RCP compatibility | Equinox |
| Update site/product provisioning | Equinox p2 |
| Server ops shell/features/config distribution | Karaf |
| Simple microservice | usually not OSGi |
| Plugin subsystem inside backend | Felix/Equinox embedded depending ecosystem |

---

## 23. Equinox and Java 8 to 25

Untuk Java 8 sampai 25, ada beberapa concern.

### 23.1 Execution Environment

OSGi mengenal Execution Environment untuk menyatakan Java runtime capability.

Contoh historis:

```text
Bundle-RequiredExecutionEnvironment: JavaSE-1.8
```

Di OSGi modern, capability model lebih disarankan:

```text
Require-Capability: osgi.ee;filter:="(&(osgi.ee=JavaSE)(version=17))"
```

Prinsip:

```text
Bundle compiled for Java 8 can usually run on Java 17/21/25 if dependencies compatible.
Bundle compiled for Java 21 cannot run on Java 8.
```

### 23.2 Java 9+ strong encapsulation

Masalah umum:

- reflective access to JDK internals,
- old bytecode libraries,
- old Eclipse/Equinox plugins,
- old annotation processors,
- old ASM/BCEL/CGLIB,
- libraries expecting Java EE modules in JDK.

Mitigation:

- upgrade dependencies,
- avoid JDK internal APIs,
- add explicit external JAXB/JAX-WS/Activation where needed,
- use `--add-opens` only as controlled bridge,
- run resolver/integration test across target JDKs.

### 23.3 Java EE modules removed after Java 8

If old Eclipse/OSGi bundles assume:

- JAXB,
- JAX-WS,
- CORBA,
- Activation,
- old javax packages,

they may break on Java 11+ unless provided explicitly as bundles/dependencies.

### 23.4 Java 17/21/25 runtime behavior

Potential impact:

- stricter encapsulation,
- newer bytecode versions,
- virtual threads if used by app code,
- TLS/security provider changes,
- GC/runtime changes,
- native access restrictions,
- agent/instrumentation behavior,
- deprecation/removal of Security Manager.

Checklist:

```text
[ ] Compile target bytecode defined?
[ ] Require-Capability osgi.ee accurate?
[ ] Old JDK internal usage removed?
[ ] Reflection libraries upgraded?
[ ] javax/jakarta dependencies explicit?
[ ] Equinox version tested on target JDK?
[ ] p2/product build uses same JDK baseline?
[ ] Integration tests run on Java 8/11/17/21/25 as needed?
```

---

## 24. Equinox Resolver and Diagnostics

Equinox resolver follows OSGi resolution semantics, but diagnostics tooling and messages may differ from Felix.

Common issue categories:

### 24.1 Bundle remains INSTALLED

Usually unresolved dependency.

Possible causes:

- missing imported package,
- version range not satisfied,
- missing required bundle,
- required capability missing,
- execution environment too low,
- fragment host mismatch,
- singleton conflict.

Diagnostic approach:

```text
1. Check bundle state.
2. Run diag on bundle.
3. Inspect Import-Package / Require-Bundle / Require-Capability.
4. Identify unsatisfied requirement.
5. Find whether provider absent or version incompatible.
6. Fix repository/product, not random runtime hack.
```

### 24.2 Bundle RESOLVED but service missing

Resolver problem is solved. Now lifecycle/service problem.

Check:

- bundle started?
- activator failed?
- DS component active?
- reference unsatisfied?
- config missing?
- extension registry contribution valid?
- service properties match filter?

### 24.3 Extension contribution not found

Check:

- plugin.xml included?
- extension point id correct?
- plugin installed/resolved?
- registry cache stale?
- product includes bundle?
- lazy bundle activation misconception?
- namespace typo?

### 24.4 ClassNotFound only when extension instantiated

Often caused by lazy instantiation.

Metadata can be visible even though implementation class fails later.

Check:

- implementation package private/imported correctly?
- class in bundle classpath?
- dependency imported?
- TCCL assumption?
- buddy classloading needed or misused?

---

## 25. Equinox Memory and Classloader Leak Diagnostics

Eclipse/Equinox systems can be long-lived and plugin-rich, so leak diagnostics matter.

Common leak sources:

- static singleton in bundle class,
- listener not unregistered,
- service tracker not closed,
- thread not stopped,
- executor not shutdown,
- TCCL referencing bundle classloader,
- extension object cached after bundle update,
- UI/resource object retained,
- registry cache holding stale reference,
- custom classloader bridge.

Bundle refresh/update should eventually allow old bundle classloader to be garbage-collected. If not, something still references it.

Mental model:

```text
Old Bundle ClassLoader
  retained by static field?
  retained by thread context classloader?
  retained by service consumer?
  retained by listener registry?
  retained by executor thread?
  retained by extension instance cache?
```

Practical checklist:

```text
[ ] All services unregistered on deactivate?
[ ] All listeners removed?
[ ] All trackers closed?
[ ] All threads stopped?
[ ] Executor shutdown?
[ ] TCCL restored after use?
[ ] No plugin instance cached globally?
[ ] No Class<?> from old bundle cached in host?
[ ] Heap dump checked by classloader dominator?
```

---

## 26. Enterprise Architecture Pattern: Equinox-Inspired Plugin Platform

Kita buat contoh arsitektur untuk enforcement/case management platform.

### 26.1 Requirements

Platform butuh:

- core case lifecycle engine,
- plugin validation rules,
- agency-specific connectors,
- document renderers,
- notification channels,
- audit trail,
- compatibility governance,
- controlled update,
- disabled/quarantined plugin support.

### 26.2 Bundle layout

```text
com.example.platform.api
com.example.platform.spi
com.example.platform.core
com.example.platform.config
com.example.platform.audit
com.example.platform.http
com.example.platform.persistence

com.example.rules.api
com.example.rules.engine
com.example.rules.basic
com.example.rules.agency-a
com.example.rules.agency-b

com.example.connector.api
com.example.connector.onemap
com.example.connector.payment
com.example.connector.identity
```

### 26.3 Extension metadata

Descriptor:

```xml
<extension point="com.example.platform.validationRule">
  <rule
      id="agency-a-case-age-rule"
      module="CASE"
      phase="PRE_SUBMISSION"
      priority="100"
      serviceFilter="(rule.id=agency-a-case-age-rule)"
      configPid="com.example.rules.agencyA.caseAge" />
</extension>
```

### 26.4 Runtime implementation

```java
@Component(
    service = ValidationRule.class,
    property = {
        "rule.id=agency-a-case-age-rule",
        "module=CASE",
        "phase=PRE_SUBMISSION",
        "priority:Integer=100"
    }
)
public final class AgencyACaseAgeRule implements ValidationRule {
    @Override
    public ValidationResult validate(ValidationContext context) {
        // domain-specific validation
        return ValidationResult.pass();
    }
}
```

### 26.5 Platform orchestration

```text
Extension Registry:
  knows rule metadata, module, phase, configPid, documentation

OSGi Service Registry:
  provides live ValidationRule instances

Rule Engine:
  joins metadata + live services
  filters by module/phase/tenant
  applies ordering
  handles missing/degraded rule
  emits audit event
```

This hybrid is powerful:

- metadata is auditable,
- implementation is dynamic,
- DS handles lifecycle,
- service registry handles replacement,
- config admin handles runtime config,
- p2/product/features can package per agency.

---

## 27. Equinox Anti-Patterns

### 27.1 Using Eclipse extension registry for everything

Bad:

```text
Every runtime service discovered through plugin.xml and instantiated manually.
```

Problem:

- lifecycle bypasses DS,
- dependencies hidden,
- service dynamics lost,
- testability weak.

Better:

```text
Use extension registry for metadata.
Use OSGi services/DS for live runtime objects.
```

### 27.2 Treating feature as dependency boundary

Feature is provisioning grouping, not Java visibility boundary.

Bad reasoning:

```text
Plugin A and B are in same feature, so A can use B classes.
```

Correct reasoning:

```text
A can use B package only if B exports and A imports it, or another explicit OSGi dependency exists.
```

### 27.3 Relying on buddy classloading by default

Buddy classloading may solve immediate issue but weakens modularity.

Use explicit imports/services first.

### 27.4 Product update without resolver testing

Bad:

```text
Update site published; users update; hope all plugin combinations work.
```

Better:

```text
Resolve product profile in CI.
Run compatibility and baseline checks.
Test update path from supported previous profiles.
```

### 27.5 Fat plugin with all dependencies embedded

This avoids provisioning complexity but creates:

- duplicate libraries,
- hidden CVE surface,
- class identity problems,
- memory overhead,
- inconsistent shared API.

### 27.6 BundleActivator as mini-container

Bad:

```java
public void start(BundleContext context) {
    // create 30 objects
    // start threads
    // read config
    // register listeners
    // register services
    // schedule jobs
    // connect database
    // scan plugins
}
```

Better:

- DS components,
- Config Admin,
- service references,
- explicit lifecycle,
- small activator or no activator.

---

## 28. Operational Runbook for Equinox Runtime

### 28.1 Startup failure

```text
1. Check JVM version and VM args.
2. Check install/configuration area paths.
3. Check config.ini / product launcher args.
4. Check framework starts.
5. Check bundle list.
6. Check unresolved bundles.
7. Run diagnostics for first failing bundle.
8. Check missing package/capability/EE.
9. Check DS/SCR state.
10. Check application extension/product id.
```

### 28.2 Plugin not loaded

```text
1. Is bundle physically present?
2. Is it included in product/profile/config?
3. Is it installed in framework?
4. Is it resolved?
5. Is it active if needed?
6. Is plugin.xml valid and included?
7. Is extension point id correct?
8. Is extension registry cache stale?
9. Is implementation class loadable?
10. Is required service/config available?
```

### 28.3 Update broke runtime

```text
1. Identify changed bundles/features/IUs.
2. Compare old and new profile.
3. Check unresolved bundles.
4. Check package version changes.
5. Check uses constraint violations.
6. Check removed/renamed extension point.
7. Check config schema migration.
8. Check persisted state compatibility.
9. Roll back profile/distribution if needed.
10. Add regression resolver/update test.
```

### 28.4 Memory leak after plugin update

```text
1. Take heap dump before/after update.
2. Find old bundle classloaders.
3. Inspect dominator tree.
4. Look for threads, static fields, listeners, service trackers.
5. Verify deactivate/unregister/shutdown logic.
6. Ensure TCCL restored.
7. Add lifecycle leak test.
```

---

## 29. Design Review Checklist

Use this when reviewing Equinox-based system.

### 29.1 Runtime choice

```text
[ ] Why Equinox over Felix/Karaf/plain JPMS?
[ ] Is p2 needed?
[ ] Is extension registry needed?
[ ] Is Eclipse plugin compatibility needed?
[ ] Is headless runtime enough?
```

### 29.2 Bundle design

```text
[ ] API packages separated from internal packages?
[ ] Exported packages versioned?
[ ] Internal packages not exported?
[ ] Require-Bundle avoided unless justified?
[ ] Bundle activators minimal?
[ ] DS used for service lifecycle?
```

### 29.3 Extension design

```text
[ ] Extension point schema exists?
[ ] Metadata versioned?
[ ] Extension contribution validated?
[ ] Implementation instantiated lazily?
[ ] Runtime object exposed as OSGi service where appropriate?
[ ] Missing/invalid extension handled gracefully?
```

### 29.4 Provisioning

```text
[ ] Product/features defined intentionally?
[ ] Repository pinned?
[ ] Build deterministic?
[ ] Update path tested?
[ ] Rollback plan exists?
[ ] Profile diff auditable?
```

### 29.5 Java compatibility

```text
[ ] Java 8/11/17/21/25 target clear?
[ ] EE/capability metadata accurate?
[ ] Old javax/JDK-internal assumptions removed?
[ ] Reflection/bytecode libraries compatible?
[ ] CI tests target supported JDKs?
```

### 29.6 Operations

```text
[ ] Console/diagnostics secured?
[ ] Bundle/service/component state observable?
[ ] Configuration area strategy defined?
[ ] Runtime cache cleanup understood?
[ ] Heap dump/classloader leak playbook exists?
[ ] Startup and update logs actionable?
```

---

## 30. Deep Mental Model Summary

Equinox is best understood through five layers:

```text
1. OSGi Framework Layer
   bundle lifecycle, resolver, classloading, service registry

2. Eclipse Runtime Layer
   application/product launching, extension registry, platform services

3. Provisioning Layer
   p2 repositories, IUs, profiles, features, products

4. Tooling Layer
   PDE, target platform, product export, update sites

5. Product Architecture Layer
   plugin governance, compatibility, extension schema, product variants
```

A top-level engineer does not ask only:

```text
Can I start this bundle?
```

They ask:

```text
Can this platform evolve safely?
Can this plugin be installed, resolved, configured, activated, observed, updated, disabled, and rolled back?
Can we explain why this bundle sees this package and not that package?
Can we support Java 8 to 25 without accidental runtime behavior?
Can we preserve extension compatibility for years?
```

That is the Equinox lesson.

---

## 31. Practical Decision Framework

Choose **Equinox** when:

- you need Eclipse plugin/RCP compatibility,
- you need p2 product/update infrastructure,
- you need extension registry model,
- you build a product-line platform,
- you already live in Eclipse ecosystem,
- you need proven large-scale plugin architecture lessons.

Choose **Felix** when:

- you need a small embeddable OSGi kernel,
- you want low conceptual overhead,
- you own provisioning yourself,
- you prefer bnd-centric runtime assembly.

Choose **Karaf** when:

- you need server/container operations,
- you want features, shell, config, deploy conventions,
- you run OSGi as server runtime,
- operational ergonomics matter more than Eclipse product model.

Choose **plain Java/JPMS/Spring Boot** when:

- you do not need dynamic module lifecycle,
- you do not need plugin runtime,
- service graph is static enough,
- deployment is simple immutable microservice,
- team cost of OSGi is not justified.

---

## 32. Key Takeaways

1. Equinox is an OSGi framework, but its real value is seen through Eclipse platform/product/plugin architecture.
2. Eclipse plugin is usually an OSGi bundle, but Eclipse extension registry is not the same as OSGi service registry.
3. p2 solves provisioning/update/product profile problems, not just dependency download.
4. Feature is a provisioning grouping, not a class visibility boundary.
5. Extension registry is strong for declarative metadata and lazy contribution discovery.
6. OSGi services/DS are stronger for live runtime object collaboration.
7. Headless Equinox is valid; Equinox does not require Eclipse UI.
8. Target platform discipline is essential for deterministic builds.
9. Java 8 to 25 compatibility requires explicit EE/capability, dependency, reflection, and bytecode planning.
10. Equinox teaches product platform thinking: extension governance, compatibility, provisioning, update, and rollback.

---

## 33. References

Primary references used while preparing this part:

- Eclipse Equinox Documentation — Equinox as implementation of OSGi core framework and optional services/infrastructure.
- Eclipse Equinox Console Commands documentation.
- Eclipse Equinox Execution Environment Descriptions.
- Eclipse Equinox p2 documentation and project pages.
- Eclipse Platform runtime options documentation.
- OSGi Core Release 8 specification.
- OSGi Compendium Release 8 specification.
- bnd/Bndtools documentation.
- Eclipse Platform / PDE / RCP conceptual documentation.

---

## 34. Series Progress

```text
Part 13 dari 35 selesai.
Series belum selesai.
```

Part berikutnya:

```text
14-apache-karaf-osgi-distribution-features-provisioning-operations.md
```

Topik berikutnya adalah **Apache Karaf**: OSGi distribution/container, features, repositories, shell, deploy folder, Config Admin integration, custom distribution, production operations, security, logging, hot deployment, rollback, dan kapan Karaf lebih tepat daripada Felix/Equinox.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 12 — Apache Felix Runtime: Lightweight Framework, Gogo Shell, SCR, FileInstall](./12-apache-felix-runtime-lightweight-framework-gogo-scr-fileinstall.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 14 — Apache Karaf: OSGi Distribution, Features, Provisioning, and Operations](./14-apache-karaf-osgi-distribution-features-provisioning-operations.md)
