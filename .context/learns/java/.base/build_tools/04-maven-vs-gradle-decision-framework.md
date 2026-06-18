# Part 4 — Maven vs Gradle: Bukan Mana yang Lebih Bagus, Tapi Mana yang Cocok untuk Constraint Tertentu

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `04-maven-vs-gradle-decision-framework.md`  
> Scope: Java 8–25, enterprise build engineering, Maven, Gradle, CI/CD, dependency governance, reproducibility, migration decision

---

## 0. Tujuan Bagian Ini

Setelah memahami Maven core mental model dan Gradle core mental model, pertanyaan berikutnya biasanya muncul:

> “Untuk project Java serius, lebih baik Maven atau Gradle?”

Pertanyaan itu kelihatannya sederhana, tetapi sebenarnya kurang tepat.

Pertanyaan yang lebih engineering adalah:

> “Dengan constraint organisasi, lifecycle aplikasi, kompleksitas dependency, kebutuhan CI/CD, model rilis, ukuran repository, skill tim, security policy, dan target Java 8–25, build system mana yang menghasilkan risiko paling rendah dan leverage paling tinggi?”

Bagian ini membangun cara berpikir untuk menjawab itu.

Kita tidak akan membahas Maven vs Gradle sebagai fan war. Kita akan membahasnya sebagai **decision framework**.

---

## 1. Premis Utama

Maven dan Gradle bukan hanya dua tool yang sama-sama bisa menjalankan compile dan test.

Mereka mewakili dua filosofi build yang berbeda.

### Maven

Maven adalah **model-driven lifecycle build system**.

Maven bertanya:

> “Apa tipe project ini, apa modelnya, dan lifecycle standar apa yang harus dijalankan?”

Maven kuat ketika organisasi ingin:

- standar yang sangat konsisten;
- struktur project predictable;
- lifecycle yang mudah dipahami lintas tim;
- governance lewat parent POM, BOM, plugin management, dan enforcer;
- onboarding cepat;
- minim custom logic;
- build yang eksplisit tapi tidak terlalu programmable.

### Gradle

Gradle adalah **programmable task graph build system**.

Gradle bertanya:

> “Graph pekerjaan apa yang perlu dibangun, input/output apa yang menentukan validitasnya, dan bagaimana graph itu bisa dieksekusi secara incremental, cacheable, dan extensible?”

Gradle kuat ketika organisasi ingin:

- build graph yang fleksibel;
- performa tinggi untuk repo besar;
- incremental build;
- local/remote build cache;
- custom task/plugin;
- multi-language build;
- complex generated-code pipeline;
- variant-aware dependency model;
- convention plugin sebagai build platform internal.

---

## 2. Ringkasan Perbedaan Filosofis

| Dimensi | Maven | Gradle |
|---|---|---|
| Mental model utama | Project model + lifecycle | Task graph + lazy model |
| Konfigurasi | XML declarative model | Kotlin/Groovy DSL executable model |
| Eksekusi | Phase menjalankan plugin goals | Requested tasks membentuk graph |
| Standarisasi | Sangat tinggi | Bergantung pada convention build logic |
| Fleksibilitas | Terbatas tapi predictable | Sangat fleksibel tapi butuh disiplin |
| Performa incremental | Lebih terbatas | Sangat kuat dengan incremental task/cache |
| Build cache native | Tidak sekuat Gradle | First-class concept |
| Dependency model | Scope + nearest-wins | Configuration + variant-aware resolution |
| Governance enterprise | Parent POM, BOM, Enforcer | Convention plugin, platforms, catalogs, verification |
| Plugin authoring | Mojo/lifecycle based | Task/extension/provider based |
| Learning curve dasar | Lebih mudah | Lebih curam |
| Learning curve advanced | Sedang–tinggi | Tinggi |
| Risiko utama | Lifecycle rigidity, XML sprawl, hidden inherited config | Over-programming, configuration-time side effects, DSL chaos |

---

## 3. Jangan Memilih Berdasarkan Selera Sintaks

Salah satu kesalahan umum adalah memilih berdasarkan:

- “XML jelek, jadi Gradle lebih baik.”
- “Groovy/Kotlin script terlalu bebas, jadi Maven lebih baik.”
- “Gradle lebih cepat, jadi pasti pilih Gradle.”
- “Maven lebih standar, jadi pasti pilih Maven.”

Semua pernyataan itu bisa benar dalam konteks tertentu, tetapi tidak cukup sebagai dasar keputusan.

Build system adalah bagian dari **sistem produksi**, bukan sekadar preferensi developer.

Build system memengaruhi:

- reliability release;
- waktu feedback developer;
- kecepatan CI;
- auditability;
- security posture;
- supply-chain risk;
- dependency hygiene;
- onboarding engineer baru;
- kemampuan migrasi Java version;
- struktur multi-module;
- kualitas artifact;
- kemampuan rollback;
- traceability dari commit ke artifact.

Karena itu, pemilihan build tool harus berbasis constraint.

---

## 4. Decision Axis 1 — Standardization vs Expressiveness

### Maven: standardization-first

Maven mengasumsikan bahwa sebagian besar Java project seharusnya mengikuti pola yang sama:

```text
src/main/java
src/main/resources
src/test/java
src/test/resources
pom.xml
```

Lifecycle Maven juga predictable:

```text
validate -> compile -> test -> package -> verify -> install -> deploy
```

Kekuatan pendekatan ini adalah rendahnya variasi.

Dalam organisasi besar, variasi build adalah biaya.

Jika 50 service punya 50 gaya build berbeda, maka:

- onboarding menjadi lambat;
- debugging CI menjadi sulit;
- governance menjadi lemah;
- security policy sulit dipaksakan;
- upgrade plugin menjadi mahal;
- release process tidak konsisten.

Maven membantu mengurangi variasi karena modelnya lebih sempit.

### Gradle: expressiveness-first

Gradle memberi ruang lebih besar untuk membuat build sesuai kebutuhan.

Contoh kebutuhan yang lebih natural di Gradle:

- custom generated source pipeline;
- multiple source sets;
- codegen sebelum compile;
- artifact transform;
- conditional task graph;
- build cache;
- convention plugin internal;
- composite build;
- affected-module build;
- multi-language monorepo;
- custom packaging;
- variant-aware publishing.

Tetapi expressiveness membawa risiko.

Jika tim tidak punya disiplin build engineering, Gradle build bisa berubah menjadi “aplikasi kecil” yang tidak dites, tidak terdokumentasi, dan penuh side effect.

### Prinsip

Gunakan Maven ketika variasi build sebaiknya ditekan.

Gunakan Gradle ketika variasi build memang dibutuhkan dan organisasi mampu mengelolanya.

---

## 5. Decision Axis 2 — Lifecycle Simplicity vs Graph Complexity

### Maven cocok untuk lifecycle linear

Maven cocok ketika pipeline project relatif linear:

```text
compile code
run unit test
package JAR/WAR
run integration test
publish artifact
```

Maven juga cocok ketika sebagian besar module mengikuti lifecycle yang sama.

Contoh:

```text
service-a
service-b
service-c
shared-domain
shared-utils
```

Semua module:

- Java;
- JUnit;
- JaCoCo;
- SpotBugs;
- package JAR;
- deploy ke internal repository.

Dalam kasus seperti ini, Maven memberi value besar karena lifecycle-nya sudah pas.

### Gradle cocok untuk graph kompleks

Gradle lebih cocok ketika build bukan lagi linear.

Contoh graph:

```text
openapi spec
   -> generate client
      -> compile generated code
         -> compile application
            -> run test
               -> package
                  -> build container image

protobuf schema
   -> generate grpc stubs
      -> compile java

frontend asset
   -> npm build
      -> copy resources
         -> package backend artifact

jooq generation
   -> start db container
      -> apply migration
         -> generate jooq classes
            -> compile
```

Maven bisa melakukan banyak hal ini dengan plugin, tetapi ketika orchestration semakin kompleks, POM bisa menjadi panjang, kaku, dan sulit dipahami.

Gradle lebih natural untuk merepresentasikan graph tersebut sebagai task dependency dengan input/output yang jelas.

### Prinsip

Jika build bisa dijelaskan sebagai lifecycle standar, Maven sering lebih sederhana.

Jika build harus dijelaskan sebagai graph pekerjaan kompleks, Gradle sering lebih tepat.

---

## 6. Decision Axis 3 — Team Skill and Maintenance Burden

Build tool tidak hanya dipakai oleh principal engineer.

Build tool dipakai oleh:

- junior developer;
- QA automation engineer;
- DevOps engineer;
- security engineer;
- release manager;
- production support;
- contractor;
- future maintainer.

### Maven skill profile

Maven lebih mudah dibaca oleh engineer yang sudah terbiasa Java enterprise.

Banyak engineer bisa memahami:

```xml
<dependency>
  <groupId>...</groupId>
  <artifactId>...</artifactId>
  <version>...</version>
</dependency>
```

Walaupun Maven advanced tetap kompleks, dasar penggunaannya sangat umum.

Risiko Maven bukan pada syntax, tetapi pada:

- inheritance berlapis;
- parent POM tersembunyi;
- effective POM tidak dibaca;
- plugin execution tidak dipahami;
- dependency mediation tidak terlihat;
- profile yang aktif secara tidak disadari.

### Gradle skill profile

Gradle membutuhkan pemahaman lebih dalam tentang:

- DSL Kotlin/Groovy;
- configuration phase;
- execution phase;
- lazy provider;
- task registration;
- input/output tracking;
- configuration cache compatibility;
- plugin model;
- dependency configurations.

Engineer yang hanya meniru snippet Gradle sering membuat build lambat atau tidak cacheable.

Contoh smell:

```kotlin
tasks.register("generateSomething") {
    val content = file("input.txt").readText() // read during configuration if placed wrong elsewhere
}
```

Atau:

```kotlin
subprojects {
    afterEvaluate {
        // hidden mutation after project evaluation
    }
}
```

Build Gradle yang bagus sering membutuhkan build/platform engineer yang memahami Gradle sebagai model lazy, bukan script procedural biasa.

### Prinsip

Jika organisasi belum punya build engineering maturity, Maven lebih aman.

Jika organisasi punya atau mau membangun platform build discipline, Gradle memberi leverage lebih besar.

---

## 7. Decision Axis 4 — CI Performance and Developer Feedback Loop

Build time bukan sekadar kenyamanan.

Build time memengaruhi:

- jumlah context switch developer;
- ukuran batch perubahan;
- kualitas review;
- willingness menjalankan test lokal;
- frekuensi integrasi;
- biaya CI;
- lead time delivery.

### Maven performance model

Maven dapat melakukan parallel build dengan:

```bash
mvn -T 1C clean verify
```

Maven juga mendapat benefit dari:

- local repository cache;
- dependency cache CI;
- incremental test via plugin tertentu;
- selective module build dengan `-pl` dan `-am`;
- skip stage tertentu jika valid.

Namun Maven secara desain tidak punya build cache native sekuat Gradle task output cache.

Maven lebih sering menjalankan ulang banyak work karena modelnya lifecycle/plugin-driven, bukan input-output task cache-first.

### Gradle performance model

Gradle punya beberapa mekanisme performa utama:

- Gradle Daemon;
- incremental build;
- task output cache;
- remote build cache;
- configuration cache;
- task configuration avoidance;
- parallel execution;
- build scan/profiling;
- selective task execution.

Gradle build cache menyimpan output build berdasarkan input task. Jika input tidak berubah dan output tersedia, Gradle dapat mengambil output dari cache alih-alih mengeksekusi task ulang.

Ini sangat powerful untuk:

- monorepo;
- multi-module besar;
- generated source mahal;
- test mahal;
- CI cold build;
- branch switching;
- distributed teams.

### Tetapi cache bukan magic

Gradle cache hanya efektif jika:

- task mendeklarasikan input/output dengan benar;
- task tidak punya side effect tersembunyi;
- timestamp/random/environment tidak bocor ke output;
- dependency resolution stabil;
- build script compatible dengan configuration cache;
- remote cache diamankan dari poisoning.

### Prinsip

Untuk project kecil/medium dengan build sederhana, perbedaan performa mungkin tidak cukup untuk justify migrasi.

Untuk repo besar dengan build mahal, Gradle bisa memberi keuntungan besar jika build logic dirancang benar.

---

## 8. Decision Axis 5 — Dependency Management and Graph Control

Dependency graph adalah salah satu sumber risiko terbesar dalam Java build.

Risiko dependency meliputi:

- version conflict;
- transitive vulnerability;
- duplicate classes;
- binary incompatibility;
- javax/jakarta split;
- logging binding conflict;
- dependency drift;
- dependency confusion;
- unapproved license;
- runtime-only missing dependency.

### Maven dependency model

Maven menggunakan:

- dependency scope;
- transitive dependency;
- nearest-wins mediation;
- `dependencyManagement`;
- BOM import;
- exclusions;
- optional dependencies;
- Maven Enforcer.

Maven dependency model sederhana dan luas dipahami.

Kelemahannya adalah modelnya tidak se-ekspresif Gradle untuk variant.

Misalnya Maven POM tidak memodelkan semua metadata yang bisa dimodelkan Gradle Module Metadata.

### Gradle dependency model

Gradle menggunakan:

- configurations;
- dependency constraints;
- platforms;
- version catalogs;
- capabilities;
- attributes;
- variants;
- component metadata rules;
- dependency locking;
- dependency verification.

Gradle lebih expressive.

Contoh Gradle bisa membedakan:

- API dependency vs implementation dependency;
- compile classpath vs runtime classpath;
- test fixture variant;
- feature variant;
- platform constraint;
- capability conflict;
- artifact transform.

Tetapi expressive model berarti engineer harus memahami modelnya.

### Prinsip

Jika dependency policy cukup standar: Maven BOM + Enforcer sering cukup.

Jika dependency graph butuh variant/capability/locking/verification yang kuat: Gradle memberi kontrol lebih detail.

---

## 9. Decision Axis 6 — Reproducibility and Auditability

Build yang baik harus bisa menjawab:

> “Artifact ini dibangun dari commit apa, dependency apa, plugin versi apa, JDK apa, command apa, environment apa, dan outputnya bisa direproduksi atau tidak?”

### Maven reproducibility posture

Maven dapat dibuat reproducible dengan:

- pin plugin versions;
- pin dependency versions;
- gunakan BOM;
- gunakan Maven Wrapper;
- gunakan Enforcer;
- gunakan reproducible build settings di plugin packaging;
- hindari dynamic version;
- gunakan CI container/toolchain tetap;
- gunakan internal repository mirror;
- gunakan SBOM plugin;
- audit effective POM.

Maven sangat auditable karena modelnya deklaratif dan standardized.

Tetapi dependency locking bukan first-class sekuat Gradle dependency locking.

### Gradle reproducibility posture

Gradle dapat dibuat reproducible dengan:

- Gradle Wrapper;
- dependency locking;
- dependency verification;
- version catalogs;
- platforms;
- toolchains;
- build cache discipline;
- configuration cache discipline;
- reproducible archives;
- remote cache governance;
- Build Scan/Develocity untuk observability;
- convention plugin untuk policy.

Gradle sangat kuat, tetapi juga lebih mudah dibuat non-reproducible jika build script membaca environment, file, network, atau waktu secara sembarangan pada configuration phase.

### Prinsip

Maven cenderung lebih mudah diaudit karena lebih sempit.

Gradle bisa lebih kuat untuk reproducibility modern, tetapi butuh governance lebih sadar.

---

## 10. Decision Axis 7 — Plugin Ecosystem and Custom Build Logic

### Maven plugin model

Maven plugin cocok untuk goal yang mengikuti lifecycle.

Contoh:

- compile;
- test;
- package;
- shade;
- deploy;
- generate sources;
- run static analysis;
- produce reports.

Maven plugin biasanya dikonfigurasi di POM.

Kelebihan:

- predictable;
- standar;
- lifecycle binding jelas;
- mudah dipakai lintas project.

Kekurangan:

- custom orchestration bisa verbose;
- lifecycle binding bisa membingungkan;
- plugin execution order harus dipahami;
- conditional logic tidak natural.

### Gradle plugin model

Gradle plugin cocok untuk membangun build platform internal.

Contoh:

```text
company-java-library-conventions
company-spring-service-conventions
company-jakarta-war-conventions
company-security-scanning-conventions
company-release-conventions
```

Plugin bisa:

- membuat tasks;
- menambah extensions;
- mengatur dependencies;
- mengatur test suites;
- mengatur publishing;
- membuat policy;
- membuat artifact transform;
- menggunakan Provider API;
- mendukung configuration cache;
- mendaftarkan BuildService.

Gradle unggul untuk build logic yang menjadi produk internal.

### Prinsip

Jika build customization kecil dan lifecycle-based, Maven plugin configuration cukup.

Jika build customization besar dan perlu dijadikan platform reusable, Gradle convention plugin sering lebih baik.

---

## 11. Decision Axis 8 — Enterprise Governance

Enterprise build bukan hanya “bisa jalan”.

Enterprise build harus bisa mengontrol:

- Java baseline;
- dependency version;
- repository source;
- plugin version;
- test policy;
- coverage policy;
- security scan;
- license approval;
- SBOM generation;
- release signing;
- artifact publishing;
- vulnerability response;
- exception process.

### Maven governance pattern

Maven biasanya memakai:

```text
corporate-parent-pom
  -> dependencyManagement
  -> pluginManagement
  -> repositories/mirrors via settings.xml
  -> enforcer rules
  -> reporting config
```

Pattern Maven governance:

```xml
<parent>
  <groupId>com.company.platform</groupId>
  <artifactId>company-parent</artifactId>
  <version>2026.06.0</version>
</parent>
```

Kelebihan:

- mudah diwariskan;
- mudah dipaksakan;
- familiar;
- bagus untuk banyak service mirip.

Kelemahan:

- inheritance bisa menjadi terlalu dalam;
- parent POM menjadi dumping ground;
- override bisa sulit dilacak;
- aggregator dan parent sering dicampur;
- effective POM harus sering dicek.

### Gradle governance pattern

Gradle biasanya memakai:

```text
build-logic included build
  -> convention plugins
  -> version catalogs
  -> platforms
  -> dependency verification
  -> repository policy
```

Pattern Gradle governance:

```kotlin
plugins {
    id("com.company.java-service-conventions")
}
```

Kelebihan:

- policy bisa diekspresikan sebagai code;
- reusable;
- testable dengan TestKit;
- cocok untuk repo besar;
- bisa lebih modular daripada parent POM.

Kelemahan:

- butuh build engineers;
- plugin harus dirawat;
- compatibility Gradle version penting;
- build logic bisa terlalu pintar;
- governance yang salah bisa menciptakan coupling tersembunyi.

### Prinsip

Maven governance lebih mudah dimulai.

Gradle governance lebih kuat jika organisasi memperlakukan build logic sebagai platform product.

---

## 12. Decision Axis 9 — Monorepo vs Polyrepo

### Polyrepo dengan service seragam

Jika organisasi punya banyak repo kecil/medium:

```text
service-a/
service-b/
service-c/
service-d/
```

Dan setiap service relatif mirip, Maven sering sangat cocok.

Governance bisa dilakukan lewat:

- corporate parent POM;
- BOM;
- internal repository;
- CI template;
- Maven Enforcer;
- Renovate/Dependabot;
- SBOM scanner.

### Monorepo besar

Jika organisasi punya satu repo besar:

```text
platform/
  services/
  libraries/
  adapters/
  generated-clients/
  test-fixtures/
  tools/
```

Gradle sering lebih unggul karena:

- multi-project build;
- composite build;
- affected tasks;
- task avoidance;
- remote build cache;
- custom convention plugin;
- dependency substitution;
- faster local feedback.

Maven reactor bisa menangani multi-module, tetapi untuk monorepo sangat besar dengan workflow parsial, Gradle biasanya memberi lebih banyak alat.

### Prinsip

Polyrepo seragam condong Maven.

Monorepo besar dan graph kompleks condong Gradle.

Tetapi bukan hukum absolut.

---

## 13. Decision Axis 10 — Java 8–25 Compatibility Strategy

Untuk project yang harus support Java 8 sampai Java 25, build tool harus membantu mengontrol:

- compile JDK;
- target bytecode;
- API availability;
- test runtime matrix;
- annotation processor behavior;
- dependency bytecode baseline;
- toolchain setup;
- preview feature policy;
- multi-release JAR jika perlu.

### Maven

Maven cocok untuk compatibility matrix dengan:

- Maven Compiler Plugin;
- Maven Toolchains Plugin;
- Maven Surefire/Failsafe;
- CI matrix;
- Maven Enforcer;
- Animal Sniffer untuk API baseline;
- profiles untuk matrix tertentu.

Maven bagus jika matrix-nya jelas dan lifecycle tetap.

### Gradle

Gradle cocok untuk compatibility matrix dengan:

- Java Toolchains;
- per-task toolchain;
- custom test suites;
- multiple JVM test tasks;
- source set modeling;
- dependency variants;
- toolchain resolver;
- build cache lintas JDK jika aman.

Gradle lebih fleksibel untuk multi-runtime testing.

### Prinsip

Jika hanya perlu compile `--release 8` dan test di beberapa JDK via CI matrix, Maven cukup.

Jika perlu banyak variant compile/test/package lintas JDK, Gradle lebih nyaman.

---

## 14. Decision Axis 11 — IDE Integration

Build tool harus cocok dengan IDE.

Untuk Java engineer, IDE integration penting karena:

- import project;
- source set detection;
- generated sources;
- annotation processing;
- test runner;
- dependency resolution;
- code navigation;
- refactoring;
- build delegation.

### Maven IDE behavior

Maven biasanya sangat predictable di IDE.

IntelliJ, Eclipse, NetBeans, dan VS Code Java tooling umumnya memahami Maven POM dengan baik.

Generated sources masih bisa tricky, tetapi pattern-nya umum.

### Gradle IDE behavior

Gradle IDE integration modern sudah kuat, tetapi build script yang terlalu custom bisa membuat IDE import lambat atau inconsistent.

Masalah yang sering terjadi:

- configuration phase lambat saat import;
- generated source tidak dimodelkan benar;
- custom source set tidak dikenali;
- task dependency tidak jelas;
- plugin internal belum compatible;
- composite build terlalu berat.

Gradle yang baik harus memikirkan IDE model, bukan hanya CLI build.

### Prinsip

Jika build customization rendah, keduanya baik.

Jika Gradle build custom-heavy, pastikan IDE import menjadi acceptance criterion.

---

## 15. Decision Axis 12 — Migration Cost

Memilih build tool baru bukan hanya menulis ulang file build.

Migration cost mencakup:

- dependency graph parity;
- plugin behavior parity;
- artifact output parity;
- test output parity;
- CI pipeline changes;
- IDE import changes;
- developer workflow changes;
- release process changes;
- repository publishing changes;
- security scan changes;
- documentation changes;
- rollback plan;
- training cost.

### Maven to Gradle

Maven to Gradle biasanya dilakukan untuk:

- build performance;
- monorepo;
- custom build logic;
- Android/Kotlin ecosystem;
- complex codegen;
- convention plugin platform;
- dependency locking/verification.

Risiko:

- hasil artifact berubah;
- dependency resolution berbeda;
- lifecycle plugin behavior tidak identik;
- scope mapping salah;
- CI cache belum aman;
- developer belum paham Gradle.

### Gradle to Maven

Gradle to Maven biasanya dilakukan untuk:

- standardisasi enterprise;
- mengurangi custom build complexity;
- menyesuaikan tim/vendor;
- auditability lebih sederhana;
- legacy Java enterprise ecosystem.

Risiko:

- kehilangan custom graph flexibility;
- POM menjadi verbose;
- build lebih lambat;
- codegen orchestration sulit;
- variant modeling hilang;
- build cache hilang.

### Prinsip

Migrasi hanya layak jika pain saat ini lebih mahal daripada biaya migrasi dan biaya maintenance tool baru.

---

## 16. Decision Matrix Praktis

Gunakan tabel ini sebagai starting point.

| Constraint | Condong Maven | Condong Gradle |
|---|---:|---:|
| Banyak service seragam | Tinggi | Sedang |
| Monorepo besar | Sedang | Tinggi |
| Build lifecycle standar | Tinggi | Sedang |
| Build graph kompleks | Sedang | Tinggi |
| Tim belum matang build engineering | Tinggi | Rendah–Sedang |
| Perlu remote build cache | Rendah | Tinggi |
| Perlu convention build platform | Sedang | Tinggi |
| Governance sederhana lintas repo | Tinggi | Sedang |
| Governance programmable/testable | Sedang | Tinggi |
| Dependency variant kompleks | Rendah | Tinggi |
| Tooling Java enterprise legacy | Tinggi | Sedang |
| Android/Kotlin-heavy | Rendah | Tinggi |
| Auditability oleh banyak vendor | Tinggi | Sedang |
| Custom plugin/task banyak | Sedang | Tinggi |
| Onboarding cepat | Tinggi | Sedang |
| Performance local incremental penting | Sedang | Tinggi |
| CI cold build sederhana | Tinggi | Sedang |
| CI build mahal dan repeated | Sedang | Tinggi |

---

## 17. Scenario 1 — Enterprise Spring Boot Microservices, Banyak Repo, Tim Campuran

### Kondisi

```text
- 80 Spring Boot services
- masing-masing repo terpisah
- struktur mirip
- CI template seragam
- Java 17/21 baseline
- dependency dikontrol via company BOM
- security scan wajib
- vendor/contractor sering masuk
- build customization rendah
```

### Rekomendasi

Maven biasanya lebih aman.

### Reasoning

Kebutuhan utama adalah standardisasi, bukan graph flexibility.

Gunakan:

- corporate parent POM;
- company BOM;
- Maven Enforcer;
- pinned pluginManagement;
- Maven Wrapper;
- CI reusable workflow;
- dependency scanning;
- SBOM generation;
- release profile terkunci.

### Risiko jika Gradle dipilih

Gradle tetap bisa, tetapi jika setiap service membuat build logic sendiri, governance melemah.

Gradle baru menjadi menarik jika organisasi membuat convention plugin yang matang.

---

## 18. Scenario 2 — Monorepo Platform Java dengan Banyak Module dan Codegen

### Kondisi

```text
- 200 modules dalam satu repo
- shared libraries
- generated OpenAPI clients
- Protobuf/gRPC
- jOOQ generation
- test fixtures
- integration tests mahal
- CI build lama
- developer sering hanya mengubah beberapa module
```

### Rekomendasi

Gradle biasanya lebih kuat.

### Reasoning

Masalah utamanya adalah graph complexity dan feedback loop.

Gunakan:

- multi-project Gradle;
- convention plugins;
- build cache lokal/remote;
- configuration cache;
- task avoidance;
- source set modeling;
- custom codegen tasks;
- affected module strategy;
- dependency locking;
- dependency verification.

### Risiko jika Maven dipilih

Maven reactor bisa dipakai, tetapi build parsial, cache task output, dan custom graph orchestration lebih terbatas.

---

## 19. Scenario 3 — Regulated Government/Finance System dengan Audit Ketat

### Kondisi

```text
- audit compliance kuat
- release harus explainable
- banyak vendor
- approval dependency manual
- production artifact harus traceable
- Java enterprise stack
- build customization rendah–sedang
```

### Rekomendasi

Maven atau Gradle bisa, tetapi default aman adalah Maven jika build sederhana.

### Reasoning

Auditor dan vendor lebih mudah membaca POM standar daripada build logic programmable yang kompleks.

Maven memberi:

- declarative model;
- effective POM;
- dependency tree;
- lifecycle standar;
- parent/BOM governance;
- Enforcer;
- predictable release process.

Namun jika organisasi sudah punya Gradle platform dengan verification, locking, SBOM, provenance, dan convention plugin, Gradle juga bisa sangat kuat.

### Prinsip

Di regulated environment, build tool yang lebih fleksibel harus dikompensasi dengan governance yang lebih kuat.

---

## 20. Scenario 4 — Library yang Harus Support Java 8 Sampai Java 25

### Kondisi

```text
- public/internal library
- minimum runtime Java 8
- test di Java 8, 11, 17, 21, 25
- publish ke Maven repository
- strict binary compatibility
- dependency minimal
```

### Rekomendasi

Keduanya valid.

Maven lebih sederhana jika build lifecycle standar.

Gradle lebih nyaman jika matrix test dan variant publishing kompleks.

### Maven approach

```bash
mvn -DskipTests=false verify
```

Dengan CI matrix:

```text
JDK 8  -> test
JDK 11 -> test
JDK 17 -> test
JDK 21 -> test
JDK 25 -> test
```

Compile pakai `--release 8` jika compiler mendukung.

### Gradle approach

Gradle bisa membuat task test berbeda untuk runtime berbeda.

Contoh konsep:

```kotlin
tasks.register<Test>("testOnJava21") {
    javaLauncher.set(javaToolchains.launcherFor {
        languageVersion.set(JavaLanguageVersion.of(21))
    })
}
```

### Prinsip

Jika compatibility matrix sederhana: Maven cukup.

Jika matrix menjadi bagian build model lokal: Gradle lebih fleksibel.

---

## 21. Scenario 5 — Legacy Java 8 Enterprise Application

### Kondisi

```text
- Java 8
- WAR deployment
- application server
- old plugins
- javax namespace
- vendor build scripts
- sedikit automated tests
- release manual
```

### Rekomendasi

Jangan migrasi build tool dulu kecuali ada alasan kuat.

Lebih penting:

1. pin plugin version;
2. rapikan dependencyManagement;
3. tambahkan Enforcer;
4. tambahkan wrapper;
5. buat CI repeatable;
6. pisahkan unit/integration test;
7. hasilkan SBOM;
8. dokumentasikan release command;
9. hilangkan dependency dynamic/SNAPSHOT liar;
10. baru evaluasi Maven/Gradle migration.

### Prinsip

Migrasi build tool tidak otomatis memperbaiki build maturity.

Build discipline lebih penting daripada tool choice.

---

## 22. Anti-Pattern Pemilihan Tool

### Anti-pattern 1 — Memilih Gradle karena XML tidak suka

Ini alasan lemah.

Build system bukan text aesthetics.

Jika kebutuhan utama adalah lifecycle standar dan governance sederhana, XML Maven bisa jadi trade-off yang sangat rasional.

### Anti-pattern 2 — Memilih Maven karena takut Gradle tanpa memahami constraint

Ini juga lemah.

Jika build lambat 40 menit dan repo punya ratusan module dengan codegen kompleks, menolak Gradle hanya karena “terlalu fleksibel” bisa membuang leverage besar.

### Anti-pattern 3 — Menggunakan Gradle seperti Maven

Contoh:

- semua logic ditaruh di root `build.gradle`;
- tidak memakai convention plugin;
- eager configuration di semua subproject;
- tidak mendeklarasikan input/output;
- tidak memakai build cache;
- tidak memakai configuration cache;
- copy-paste blocks antar module.

Jika Gradle dipakai seperti Maven yang ditulis dengan DSL, benefit Gradle banyak hilang.

### Anti-pattern 4 — Menggunakan Maven seperti Gradle

Contoh:

- POM dipaksa melakukan banyak conditional orchestration;
- profile terlalu banyak;
- antrun plugin di mana-mana;
- exec plugin menjalankan script tak terkontrol;
- lifecycle dipenuhi custom behavior yang tidak obvious.

Jika Maven dipaksa menjadi general scripting engine, POM menjadi sulit dirawat.

### Anti-pattern 5 — Tool migration tanpa parity test

Migrasi build harus membuktikan:

- dependency graph sama atau perubahan dipahami;
- artifact content sama atau perubahan dipahami;
- test yang sama berjalan;
- generated source sama;
- published metadata benar;
- CI result setara;
- rollback tersedia.

Tanpa parity, migration adalah risiko release.

---

## 23. Cara Mengevaluasi Build Tool di Organisasi Nyata

Gunakan proses berikut.

### Step 1 — Inventory build saat ini

Kumpulkan:

```text
- jumlah repo/module
- jenis artifact
- Java version
- framework
- plugin yang digunakan
- codegen pipeline
- test strategy
- build time lokal
- build time CI
- dependency conflict frequency
- release frequency
- failure CI paling umum
- security scan process
- repository publishing process
```

### Step 2 — Klasifikasikan build complexity

Gunakan kategori:

```text
Level 1: simple library/application
Level 2: standard service with tests and packaging
Level 3: multi-module enterprise service
Level 4: codegen + integration tests + publishing
Level 5: monorepo/platform build with custom orchestration
```

Maven sangat kuat di level 1–3.

Gradle mulai menarik kuat di level 3–5, terutama jika performance dan graph complexity penting.

### Step 3 — Hitung cost of inconsistency

Tanyakan:

- Berapa variasi build antar repo?
- Apakah developer tahu command yang benar?
- Apakah CI dan local build sama?
- Apakah plugin version terkunci?
- Apakah dependency policy seragam?
- Apakah release bisa diaudit?
- Apakah artifact reproducible?

Jika inconsistency tinggi, jangan langsung migrasi tool.

Buat governance dulu.

### Step 4 — Hitung performance pain

Ukur:

- clean build time;
- incremental build time;
- test time;
- configuration/import time;
- CI queue time;
- cache hit ratio;
- module affected per change;
- flaky test rate.

Jika pain terbesar adalah build ulang work yang tidak berubah, Gradle cache/incremental model bisa sangat bernilai.

### Step 5 — Buat proof of concept terbatas

POC harus punya acceptance criteria.

Contoh:

```text
- dependency graph parity >= 99% known/approved
- artifact checksum differs only due to expected metadata
- CI build time improves 30%
- IDE import < 2 minutes
- local incremental test < 1 minute
- security scan unchanged or improved
- release publishing works
- rollback to old build supported
```

### Step 6 — Putuskan berdasarkan evidence

Jangan memilih berdasarkan opini.

Pilih berdasarkan:

- risk reduction;
- speed improvement;
- maintainability;
- governance capability;
- team readiness;
- migration cost;
- long-term architecture.

---

## 24. Maven Strengths in Depth

Maven tetap sangat kuat karena alasan yang sering diremehkan.

### 24.1 Predictability

Maven build sering bisa ditebak hanya dari struktur project dan POM.

Command standar:

```bash
mvn clean verify
```

Biasanya cukup untuk banyak project.

Predictability ini sangat penting untuk:

- vendor onboarding;
- production support;
- audit;
- maintenance jangka panjang;
- regulated enterprise.

### 24.2 Ecosystem inertia

Banyak Java library, framework, documentation, dan enterprise process sudah mengasumsikan Maven coordinate:

```text
groupId:artifactId:version
```

Gradle juga memakai Maven repository dan coordinate, tetapi Maven adalah format sosial yang sangat melekat di ekosistem Java.

### 24.3 Strong convention

Maven convention mengurangi ruang keputusan.

Ruang keputusan yang kecil sering bagus untuk organisasi besar.

### 24.4 Effective POM as audit tool

Maven bisa menghasilkan effective POM.

Ini membantu menjawab:

- plugin apa yang aktif;
- versi dependency apa yang digunakan;
- konfigurasi apa yang diwarisi;
- profile apa yang memengaruhi build.

### 24.5 Parent/BOM governance

Maven parent/BOM adalah pattern enterprise yang sudah matang.

Jika digunakan disiplin, ini sangat efektif.

---

## 25. Maven Weaknesses in Depth

### 25.1 XML verbosity

Verbosity bukan masalah utama, tetapi bisa memperbesar friction.

POM besar sulit dibaca jika:

- terlalu banyak plugin execution;
- terlalu banyak profile;
- dependencyManagement terlalu besar;
- parent berlapis;
- modules terlalu banyak.

### 25.2 Lifecycle rigidity

Lifecycle Maven sangat membantu sampai project butuh behavior di luar lifecycle standar.

Setelah itu, POM bisa dipenuhi plugin execution yang tidak natural.

### 25.3 Limited native incremental/cache model

Maven bisa cepat untuk banyak kasus, tetapi tidak punya task output build cache native sekuat Gradle.

### 25.4 Dependency mediation surprise

Nearest-wins bisa menghasilkan versi yang tidak intuitif.

Karena itu dependency tree dan Enforcer sangat penting.

### 25.5 Parent POM abuse

Corporate parent POM sering berubah menjadi tempat semua hal:

- dependency versions;
- plugin configs;
- repository;
- reporting;
- profiles;
- code quality;
- release logic;
- environment config.

Jika tidak dijaga, parent POM menjadi coupling global.

---

## 26. Gradle Strengths in Depth

### 26.1 Programmable graph

Gradle sangat kuat karena build direpresentasikan sebagai graph task.

Ini membuat Gradle cocok untuk pekerjaan yang tidak linear.

### 26.2 Incremental and cache-first thinking

Gradle bisa menghindari work yang tidak perlu jika task input/output dimodelkan benar.

Ini mengubah build dari:

```text
run all phases again
```

menjadi:

```text
run only invalidated work
```

### 26.3 Convention plugin model

Build logic bisa dipindahkan dari project script ke plugin internal.

Ini membuat Gradle sangat cocok untuk platform engineering.

### 26.4 Variant-aware dependency management

Gradle bisa memodelkan dependency bukan hanya sebagai satu artifact, tetapi sebagai variants dengan attributes dan capabilities.

Ini powerful untuk library modern dan multi-platform ecosystem.

### 26.5 Composite builds

Composite build memungkinkan menggabungkan beberapa build independen tanpa harus publish artifact dulu.

Ini sangat berguna untuk:

- local development lintas repo;
- platform libraries;
- plugin development;
- dependency substitution.

---

## 27. Gradle Weaknesses in Depth

### 27.1 Too much power

Gradle bisa menjalankan arbitrary code.

Ini berarti build bisa:

- membaca file saat configuration;
- melakukan network call;
- mutate global state;
- bergantung pada waktu;
- membuat task secara eager;
- melakukan side effect tersembunyi.

Semua ini merusak performance, reproducibility, dan configuration cache.

### 27.2 DSL complexity

Kotlin DSL memberi type safety lebih baik daripada Groovy DSL, tetapi tetap butuh pemahaman Gradle API.

Engineer bisa salah paham antara:

```kotlin
val x = "value"
```

dan:

```kotlin
val x: Provider<String> = providers.gradleProperty("x")
```

Dalam Gradle modern, lazy value lebih sehat daripada eager value untuk banyak build logic.

### 27.3 Debugging advanced Gradle bisa sulit

Masalah Gradle advanced bisa melibatkan:

- configuration cache incompatibility;
- plugin ordering;
- Provider realization;
- task dependency inference;
- variant selection;
- capability conflict;
- build cache miss;
- daemon state;
- IDE import model.

Ini butuh skill khusus.

### 27.4 Build logic bisa menjadi produk tanpa owner

Convention plugin internal harus punya owner.

Jika tidak, build platform membusuk.

### 27.5 Version compatibility

Gradle, plugin, JDK, Kotlin DSL, dan framework plugin punya compatibility matrix.

Upgrade Gradle harus diuji.

---

## 28. Decision Heuristics untuk Senior Engineer

### Heuristic 1 — Pilih tool yang mengurangi jumlah keputusan tidak penting

Jika tim tidak perlu fleksibilitas, jangan bayar complexity tax.

### Heuristic 2 — Pilih Gradle hanya jika akan memakai kekuatan Gradle

Gradle layak jika Anda benar-benar butuh:

- build cache;
- incremental modeling;
- custom task/plugin;
- composite build;
- variant-aware dependency;
- complex graph;
- monorepo optimization.

Jika tidak, Maven mungkin lebih murah secara organisasi.

### Heuristic 3 — Maven bukan pilihan “junior”

Maven yang dirancang baik bisa sangat mature.

Top engineer tidak memilih tool paling canggih; top engineer memilih tool yang paling sesuai constraint.

### Heuristic 4 — Gradle bukan otomatis chaotic

Gradle menjadi chaotic jika tidak ada convention.

Gradle yang bagus biasanya punya:

```text
settings.gradle.kts
build.gradle.kts minimal
build-logic/ convention plugins
gradle/libs.versions.toml
dependency verification
locking
clear task inputs/outputs
```

### Heuristic 5 — Build tool harus membuat failure lebih mudah didiagnosis

Tool terbaik adalah tool yang ketika gagal, penyebabnya bisa dipersempit dengan cepat.

Jika build tool membuat failure opaque, maturity build rendah.

### Heuristic 6 — Migrasi harus punya business case

Jangan migrasi hanya karena tool baru lebih modern.

Migrasi layak jika menyelesaikan pain nyata:

- build terlalu lambat;
- graph tidak bisa dimodelkan;
- governance gagal;
- dependency drift tidak terkendali;
- CI cost tinggi;
- developer feedback loop buruk.

---

## 29. Command-Level Comparison

### Maven common commands

```bash
# full verification
mvn clean verify

# skip tests
mvn clean package -DskipTests

# skip test compilation and execution
mvn clean package -Dmaven.test.skip=true

# build selected module and required dependencies
mvn -pl service-a -am verify

# dependency tree
mvn dependency:tree

# effective POM
mvn help:effective-pom

# parallel build
mvn -T 1C clean verify
```

### Gradle common commands

```bash
# full build
./gradlew build

# clean build
./gradlew clean build

# run specific test task
./gradlew test

# run one module
./gradlew :service-a:build

# inspect dependencies
./gradlew dependencies

# inspect specific dependency path
./gradlew dependencyInsight --dependency jackson-databind

# dry run task graph
./gradlew build --dry-run

# build scan if enabled
./gradlew build --scan

# configuration cache
./gradlew build --configuration-cache
```

### Interpretation

Maven commands are lifecycle-centered.

Gradle commands are task-centered.

This is not just syntax. It reflects each tool's mental model.

---

## 30. How Top Engineers Discuss Maven vs Gradle

A weak discussion sounds like this:

```text
Gradle is faster.
Maven is simpler.
XML is bad.
Gradle is too complex.
```

A strong discussion sounds like this:

```text
Our repository has 140 modules, 18 generated-source pipelines, and CI spends 65% of time rebuilding unchanged outputs. We need task-level cacheability and affected-module builds. Gradle with convention plugins and remote cache is worth evaluating.
```

Or:

```text
Our organization has 120 relatively uniform Spring services maintained by mixed vendor teams. Build customization is low, auditability matters, and onboarding cost matters. Maven with corporate parent POM, BOM, Enforcer, and CI templates is the lower-risk default.
```

Top engineers do not argue tool identity.

They argue constraints, failure modes, and operational cost.

---

## 31. Migration Readiness Checklist

Sebelum migrasi Maven ke Gradle atau Gradle ke Maven, jawab ini.

### Current-state clarity

- [ ] Apakah dependency graph saat ini terdokumentasi?
- [ ] Apakah plugin versions dipin?
- [ ] Apakah artifact output diketahui?
- [ ] Apakah release command jelas?
- [ ] Apakah CI command sama dengan local command?
- [ ] Apakah generated sources deterministik?
- [ ] Apakah test suite stabil?
- [ ] Apakah repository publishing jelas?
- [ ] Apakah SBOM/security scan sudah ada?

### Target-state clarity

- [ ] Apa pain utama yang diselesaikan migration?
- [ ] Apa acceptance criteria migration?
- [ ] Siapa owner build logic?
- [ ] Bagaimana rollback?
- [ ] Bagaimana training developer?
- [ ] Bagaimana IDE import divalidasi?
- [ ] Bagaimana artifact parity dicek?
- [ ] Bagaimana dependency resolution difference dicek?
- [ ] Bagaimana CI cache diamankan?

### Go/no-go rule

Jangan migrasi jika jawaban utamanya hanya:

```text
Karena tool baru lebih bagus.
```

Migrasi hanya sehat jika ada measurable improvement atau risk reduction.

---

## 32. Red Flags dalam Maven Build

Waspadai Maven build jika:

- parent POM terlalu besar;
- banyak profile environment-specific;
- plugin version tidak dipin;
- dependency version tersebar di child modules;
- SNAPSHOT dependency masuk release;
- `system` scope digunakan;
- `dependency:tree` tidak pernah dicek;
- Enforcer tidak dipakai;
- build lokal berbeda dengan CI;
- release membutuhkan langkah manual tidak terdokumentasi;
- POM menjalankan script eksternal tidak versioned;
- aggregator dan parent dicampur tanpa sadar;
- `mvn clean install` menjadi satu-satunya command yang orang tahu.

---

## 33. Red Flags dalam Gradle Build

Waspadai Gradle build jika:

- root `build.gradle` terlalu besar;
- semua logic ada di `subprojects {}`;
- banyak `afterEvaluate`;
- task dibuat eager dengan `create`;
- task tidak punya input/output;
- build cache tidak efektif;
- configuration cache tidak bisa aktif;
- build script melakukan network call;
- generated sources tidak dimodelkan sebagai task output;
- dependency version tersebar;
- version catalog tidak ada;
- custom plugin tidak dites;
- IDE import lambat;
- engineer tidak tahu bedanya configuration dan execution phase;
- `./gradlew clean build` selalu dipakai karena incremental build tidak dipercaya.

---

## 34. Practical Recommendation Patterns

### Pattern A — Maven Standard Enterprise

Cocok untuk banyak service seragam.

```text
company-parent-pom
company-bom
service-a
service-b
service-c
```

Gunakan:

- Maven Wrapper;
- pinned pluginManagement;
- dependencyManagement;
- Enforcer;
- Surefire/Failsafe;
- JaCoCo;
- SpotBugs/Checkstyle/PMD;
- CycloneDX SBOM;
- CI template.

### Pattern B — Gradle Enterprise Platform

Cocok untuk repo besar/custom build.

```text
settings.gradle.kts
build.gradle.kts
build-logic/
  conventions/
gradle/libs.versions.toml
service-a/
service-b/
library-c/
```

Gunakan:

- convention plugins;
- version catalogs;
- platforms;
- dependency locking;
- dependency verification;
- configuration cache;
- build cache;
- toolchains;
- TestKit for build logic;
- build scans.

### Pattern C — Hybrid Reality

Banyak organisasi memakai keduanya.

Contoh:

```text
- legacy enterprise apps: Maven
- new monorepo platform: Gradle
- internal libraries: Maven or Gradle, publish to Maven repository
- Android/Kotlin: Gradle
- simple Java services: Maven
```

Hybrid tidak masalah jika governance jelas.

Yang berbahaya adalah hybrid tanpa policy.

---

## 35. Maven vs Gradle for Java 8–25: Special Considerations

### Java 8

Maven sering ditemukan di legacy Java 8 enterprise projects.

Gradle tetap bisa, tetapi versi Gradle terbaru memiliki compatibility requirement sendiri untuk JVM yang menjalankan Gradle.

Jangan samakan:

```text
JDK untuk menjalankan build tool
```

Dengan:

```text
JDK target aplikasi
```

Toolchains membantu memisahkan keduanya.

### Java 11/17

Ini era modern baseline yang umum untuk enterprise migration.

Keduanya matang.

### Java 21

Java 21 sebagai LTS banyak dipakai untuk modern Spring Boot/Jakarta workloads.

Gradle dan Maven sama-sama cocok, tetapi pastikan plugin/framework version mendukung.

### Java 25

Untuk Java 25, pastikan:

- build tool version mendukung;
- compiler plugin mendukung;
- test plugin mendukung;
- annotation processor mendukung;
- framework plugin mendukung;
- CI image tersedia;
- runtime container sesuai;
- bytecode target tidak salah.

### Prinsip

Semakin baru Java version, semakin penting compatibility matrix build tool/plugin.

---

## 36. Decision Framework Final

Gunakan pertanyaan ini.

### Pertanyaan 1 — Apa bentuk build Anda?

Jika jawabannya:

```text
Lifecycle Java standar
```

Maven sangat masuk akal.

Jika jawabannya:

```text
Graph kompleks dengan banyak generated code, variants, cache, dan orchestration
```

Gradle sangat masuk akal.

### Pertanyaan 2 — Apa risiko terbesar Anda?

Jika risiko terbesar:

```text
Inconsistency, onboarding, audit, vendor maintainability
```

Maven cenderung lebih rendah risiko.

Jika risiko terbesar:

```text
Build time, monorepo scale, repeated work, custom orchestration
```

Gradle cenderung lebih memberi leverage.

### Pertanyaan 3 — Apakah organisasi punya build engineering owner?

Jika tidak, Maven sering lebih aman.

Jika ya, Gradle bisa menjadi platform kuat.

### Pertanyaan 4 — Apakah migration punya measurable target?

Jika tidak, jangan migrasi.

### Pertanyaan 5 — Apakah build tool choice mendukung arsitektur 3–5 tahun ke depan?

Jangan memilih hanya untuk keadaan hari ini.

Pertimbangkan:

- Java upgrade roadmap;
- jumlah module;
- CI cost;
- security requirement;
- release frequency;
- developer count;
- vendor involvement;
- monorepo/polyrepo direction.

---

## 37. Kesimpulan

Tidak ada jawaban universal untuk Maven vs Gradle.

Jawaban yang matang selalu berbentuk:

```text
Given these constraints, this tool is the better trade-off.
```

Maven unggul ketika organisasi membutuhkan:

- standardisasi;
- predictable lifecycle;
- auditability;
- onboarding cepat;
- governance sederhana;
- Java enterprise convention;
- build yang tidak terlalu custom.

Gradle unggul ketika organisasi membutuhkan:

- programmable graph;
- incremental build;
- build cache;
- custom build platform;
- monorepo optimization;
- variant-aware dependency;
- complex codegen;
- high-performance CI/local feedback.

Top 1% engineer tidak berhenti pada “pakai Maven” atau “pakai Gradle”.

Top 1% engineer mampu menjelaskan:

- constraint apa yang sedang dioptimalkan;
- risiko apa yang sedang dikurangi;
- trade-off apa yang diterima;
- failure mode apa yang akan muncul;
- governance apa yang harus disiapkan;
- bagaimana mengukur apakah keputusan itu berhasil.

---

## 38. Checklist Review Keputusan

Sebelum final memilih Maven atau Gradle, isi checklist ini.

```text
Project/repo topology:
[ ] single repo
[ ] multi repo
[ ] monorepo
[ ] multi-module kecil
[ ] multi-module besar

Build complexity:
[ ] lifecycle standar
[ ] custom codegen
[ ] multi-language
[ ] integration test kompleks
[ ] custom packaging
[ ] variant publishing

Governance:
[ ] parent/BOM cukup
[ ] butuh convention plugin
[ ] dependency locking wajib
[ ] dependency verification wajib
[ ] SBOM wajib
[ ] license policy wajib

Performance:
[ ] clean build acceptable
[ ] incremental build lambat
[ ] CI mahal
[ ] test mahal
[ ] generated code mahal
[ ] remote cache worth it

People:
[ ] tim familiar Maven
[ ] tim familiar Gradle
[ ] ada build/platform owner
[ ] vendor perlu maintain
[ ] training tersedia

Release:
[ ] publish library
[ ] deploy app only
[ ] artifact signing
[ ] release promotion
[ ] rollback required
[ ] audit traceability required

Decision:
[ ] Maven lower risk
[ ] Gradle higher leverage
[ ] hybrid needed
[ ] migration justified
[ ] no migration yet; improve current build first
```

---

## 39. Apa yang Tidak Dibahas Lagi di Bagian Berikutnya

Bagian ini sudah menetapkan framework pemilihan Maven vs Gradle.

Bagian berikutnya tidak akan mengulang debat “mana yang lebih baik”.

Selanjutnya kita masuk ke struktur project yang lebih konkret:

- single module;
- multi-module;
- parent;
- aggregator;
- BOM;
- Gradle multi-project;
- composite build;
- included build;
- platform;
- module boundary.

---

## 40. Status Seri

```text
[x] Part 0  — Build Engineering Mental Model
[x] Part 1  — Java Version Strategy: Java 8–25
[x] Part 2  — Maven Core Mental Model
[x] Part 3  — Gradle Core Mental Model
[x] Part 4  — Maven vs Gradle Decision Framework
[ ] Part 5  — Project Layout Engineering: Single Module, Multi-Module, Composite Build, Parent, BOM, Platform
[ ] Part 6  — Dependency Graph Fundamentals
[ ] Part 7  — Dependency Version Management
[ ] Part 8  — Repository Engineering
[ ] Part 9  — Build Reproducibility
[ ] Part 10 — Compiler Engineering
[ ] Part 11 — Testing Build Pipeline
[ ] Part 12 — Packaging Engineering
[ ] Part 13 — Resource Processing, Filtering, Profiles, Properties
[ ] Part 14 — Plugin System Deep Dive
[ ] Part 15 — Maven Advanced Plugin Engineering
[ ] Part 16 — Gradle Advanced Plugin Engineering
[ ] Part 17 — Performance Engineering
[ ] Part 18 — CI/CD Build Architecture
[ ] Part 19 — Release Engineering
[ ] Part 20 — Security Engineering
[ ] Part 21 — Enterprise Governance
[ ] Part 22 — Multi-Module Architecture for Large Java Systems
[ ] Part 23 — Jakarta/Spring/Enterprise Java Build Integration
[ ] Part 24 — Code Generation Pipelines
[ ] Part 25 — Static Analysis and Quality Gates
[ ] Part 26 — Dependency Conflict Case Studies
[ ] Part 27 — Migration Engineering
[ ] Part 28 — Troubleshooting Build Failures
[ ] Part 29 — Advanced Gradle: Variants, Capabilities, Attributes
[ ] Part 30 — Advanced Maven: Reactor, Effective Model, Resolver, Enforcer, Extensions
[ ] Part 31 — Build Observability
[ ] Part 32 — Monorepo, Polyrepo, and Enterprise Build Topologies
[ ] Part 33 — Real-World Case Study
[ ] Part 34 — Top 1% Build Engineer Playbook
```

Seri belum selesai.

Lanjut ke Part 5.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 3 — Gradle Core Mental Model: Task Graph, Configuration Phase, Execution Phase, Provider API](./03-gradle-core-mental-model.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 5 — Project Layout Engineering: Single Module, Multi-Module, Composite Build, Parent, BOM, Platform](./05-project-layout-engineering.md)

</div>