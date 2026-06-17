# Part 0 — Build Engineering Mental Model: Dari Source Code ke Artifact yang Bisa Dipercaya

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `00-build-engineering-mental-model.md`  
> Fokus: fondasi mental model build engineering untuk Java 8 sampai Java 25, sebagai dasar sebelum masuk ke Maven dan Gradle secara detail.

---

## 0.1. Tujuan Bagian Ini

Bagian ini menjawab pertanyaan dasar yang sering terlihat sederhana tetapi sebenarnya sangat dalam:

> Apa sebenarnya yang terjadi ketika kita menjalankan `mvn package`, `mvn verify`, `gradle build`, atau `./gradlew test`?

Banyak engineer menganggap build system sebagai alat untuk:

```text
source code -> compile -> jar
```

Padahal dalam sistem Java modern, terutama di enterprise, build system adalah mesin yang mengatur:

1. struktur project;
2. versi Java;
3. dependency graph;
4. compiler behavior;
5. annotation processing;
6. generated sources;
7. test orchestration;
8. static analysis;
9. packaging;
10. artifact publication;
11. reproducibility;
12. security scanning;
13. CI/CD contract;
14. release traceability;
15. supply-chain trust.

Dengan kata lain:

> Build system bukan hanya alat untuk membuat artifact. Build system adalah kontrak antara source code, dependency, environment, policy, dan release process.

Di level engineer biasa, Maven/Gradle dipakai sebagai command runner.  
Di level engineer senior, Maven/Gradle dipakai sebagai dependency manager dan lifecycle runner.  
Di level build/platform engineer yang kuat, Maven/Gradle dipahami sebagai **graph engine, policy boundary, reproducibility system, dan supply-chain control point**.

Bagian ini membangun mental model tersebut.

---

## 0.2. Definisi Build Secara Praktis

Secara praktis, build adalah proses mengubah sekumpulan input menjadi output yang bisa dipercaya.

```text
Input:
  - source code
  - test code
  - resources
  - dependency declarations
  - build scripts
  - plugin versions
  - Java version
  - environment variables
  - generated code schemas
  - repository state
  - CI configuration

Process:
  - dependency resolution
  - source generation
  - compilation
  - test execution
  - static analysis
  - resource processing
  - packaging
  - signing
  - publication

Output:
  - class files
  - JAR/WAR/EAR/native image/container image
  - test reports
  - coverage reports
  - SBOM
  - checksums
  - build metadata
  - published artifact
```

Namun definisi yang lebih kuat adalah:

> Build adalah fungsi deterministik yang idealnya memetakan input yang terkontrol menjadi output yang dapat diverifikasi.

Secara ideal:

```text
artifact = build(source, build_logic, dependencies, toolchain, environment)
```

Jika semua input sama, output seharusnya sama.

Kalau output berubah tanpa perubahan input yang jelas, berarti ada input tersembunyi.

Contoh input tersembunyi:

- timestamp saat build;
- urutan file dari filesystem;
- default timezone;
- locale mesin;
- versi JDK lokal;
- versi Maven/Gradle lokal;
- plugin version yang tidak dipin;
- dependency SNAPSHOT;
- remote repository yang berubah;
- environment variable lokal;
- generated file yang bergantung network;
- test yang bergantung waktu;
- test yang bergantung urutan eksekusi;
- local Maven repository yang berisi artifact custom.

Top 1% engineer tidak hanya bertanya:

```text
Kenapa build gagal?
```

Tapi bertanya:

```text
Input mana yang berubah?
Input mana yang tidak kita kontrol?
Kontrak mana yang dilanggar?
Output mana yang tidak bisa dipercaya?
```

---

## 0.3. Build System Sebagai Boundary of Trust

Dalam sistem enterprise, artifact yang dihasilkan build akan berjalan di environment nyata: UAT, staging, production, batch worker, web container, Kubernetes, serverless runtime, atau application server.

Artifact tersebut bisa berisi:

- business logic;
- regulatory workflow;
- data access logic;
- security configuration;
- cryptographic library;
- logging library;
- transitive dependency;
- generated client;
- migration script;
- packaged resources;
- default configuration.

Maka build system menjadi boundary penting:

```text
Developer laptop
      |
      v
Build system
      |
      v
Artifact repository
      |
      v
Deployment pipeline
      |
      v
Runtime environment
```

Kalau build system longgar, production risk ikut naik.

Contoh:

- dependency tidak dipin -> build hari ini dan minggu depan menghasilkan artifact berbeda;
- plugin tidak dipin -> behavior packaging berubah;
- Java target salah -> artifact jalan di local JDK 21 tetapi gagal di server JDK 17;
- test integration tidak masuk lifecycle -> artifact lolos meski broken;
- generated OpenAPI client tidak deterministic -> diff random dan bug sulit dilacak;
- dependency vulnerable masuk transitively -> production ikut exposed;
- artifact tidak signed -> provenance lemah;
- CI cache tercemar -> build sukses karena state lama;
- local build berbeda dari CI -> developer kehilangan trust pada pipeline.

Build engineering yang baik bukan sekadar mempercepat build. Build engineering yang baik membuat organisasi bisa menjawab:

```text
Artifact ini dibuat dari commit mana?
Dengan JDK versi berapa?
Dengan dependency versi apa?
Dengan plugin versi apa?
Apakah test yang relevan sudah jalan?
Apakah dependency vulnerable?
Apakah artifact bisa dibuat ulang?
Apakah artifact ini sama dengan yang diuji?
Apakah artifact ini sama dengan yang dideploy?
```

Kalau pertanyaan-pertanyaan itu tidak bisa dijawab, build system belum menjadi trust boundary yang matang.

---

## 0.4. Maven dan Gradle dari Kacamata Mental Model

Sebelum masuk detail di part berikutnya, kita perlu membedakan dua keluarga mental model.

### 0.4.1. Maven: Lifecycle-Centric Build

Maven berpusat pada **Project Object Model** dan lifecycle.

POM adalah model project. Maven membaca POM, membangun effective model, menyelesaikan dependency, lalu menjalankan lifecycle phases dan plugin goals.

Secara mental:

```text
POM + conventions + lifecycle bindings + plugins -> ordered build execution
```

Maven cocok dipahami sebagai:

```text
standardized lifecycle engine
```

Maven sangat kuat ketika organisasi menginginkan:

- struktur yang seragam;
- lifecycle yang predictable;
- convention over configuration;
- dependency management berbasis BOM/parent;
- governance lewat parent POM dan enforcer;
- onboarding lebih mudah;
- build yang tidak terlalu programmable.

Tapi Maven bisa terasa kaku ketika:

- build membutuhkan graph custom yang kompleks;
- banyak source generation dengan dependency antar task;
- incremental execution sangat penting;
- monorepo besar butuh partial build cerdas;
- build logic butuh reuse yang type-safe dan modular.

Maven bukan “jelek karena XML”. Maven adalah model dengan constraint kuat. Constraint itu bisa menjadi keuntungan enterprise.

---

### 0.4.2. Gradle: Graph-Centric Build

Gradle berpusat pada task graph dan lazy configuration.

Gradle membaca settings dan build scripts, mengkonfigurasi project, membangun graph task yang perlu dijalankan, lalu mengeksekusi task berdasarkan dependency antar task.

Secara mental:

```text
settings + build logic + plugins + tasks + inputs/outputs -> executable task graph
```

Gradle cocok dipahami sebagai:

```text
programmable build graph engine
```

Gradle sangat kuat ketika organisasi membutuhkan:

- build multi-project yang besar;
- incremental build;
- build cache lokal/remote;
- custom task/plugin;
- source generation pipeline yang kompleks;
- variant-aware dependency resolution;
- convention plugin untuk governance;
- flexible build architecture.

Tapi Gradle bisa berbahaya ketika:

- build scripts menjadi imperative spaghetti;
- dependency resolution terlalu magic;
- configuration phase lambat;
- plugin custom tidak cache-friendly;
- build logic tidak punya ownership;
- tim tidak memahami Provider API dan lazy configuration.

Gradle bukan “lebih modern jadi pasti lebih baik”. Gradle adalah alat yang lebih ekspresif. Ekspresivitas tanpa disiplin menghasilkan build yang sulit dirawat.

---

## 0.5. Build Bukan Script, Build Adalah Model

Kesalahan umum engineer adalah melihat build file sebagai script command.

Contoh pemikiran dangkal:

```text
pom.xml berisi dependency dan plugin.
build.gradle berisi dependency dan task.
```

Pemikiran yang lebih matang:

```text
Build file mendeskripsikan model project, dependency graph, task graph, lifecycle binding, artifact contract, quality gate, dan release behavior.
```

Perbedaan ini penting.

Script berpikir linear:

```text
step 1 -> step 2 -> step 3 -> step 4
```

Build system modern berpikir graph:

```text
          generateSources
                |
                v
resources -> compileJava -> classes -> test -> check
                |                    |
                v                    v
              jar                jacocoReport
                |
                v
             publish
```

Pada Maven, graph ini lebih tersembunyi di balik lifecycle dan plugin binding.  
Pada Gradle, graph ini lebih eksplisit dalam task graph.

Tetapi keduanya tetap memiliki konsep dependency antar pekerjaan.

Mental model penting:

> Build bukan daftar command. Build adalah graph transformasi artifact antara intermediate states.

---

## 0.6. Anatomy of a Java Build

Mari pecah Java build menjadi tahapan konseptual.

### 0.6.1. Project Discovery

Build tool harus menemukan project.

Maven:

```text
current directory -> pom.xml -> project model
```

Gradle:

```text
settings.gradle(.kts) -> included projects -> build.gradle(.kts)
```

Hal yang diputuskan di tahap ini:

- apakah project single-module atau multi-module;
- root project apa;
- child modules apa;
- project identity apa;
- group/artifact/version apa;
- plugin management dari mana;
- dependency management dari mana.

Failure mode:

- command dijalankan dari directory salah;
- module tidak masuk reactor/settings;
- parent POM tidak ditemukan;
- Gradle included build tidak resolve;
- duplicate project name;
- artifact coordinates bentrok.

---

### 0.6.2. Build Model Construction

Build tool membangun model efektif dari semua konfigurasi.

Maven:

- parent inheritance;
- dependency management;
- plugin management;
- profiles;
- properties;
- lifecycle bindings;
- effective POM.

Gradle:

- settings evaluation;
- plugin resolution;
- project configuration;
- convention plugins;
- extensions;
- configurations;
- tasks;
- providers;
- task graph.

Failure mode:

- property override tidak sesuai harapan;
- profile aktif tanpa disadari;
- plugin version inherited dari parent yang berbeda;
- Gradle configuration terlalu eagerly evaluated;
- task dibuat terlalu cepat;
- configuration cache gagal karena build logic membaca state eksternal.

Mental model:

```text
Apa yang tertulis di file build belum tentu sama dengan model efektif yang dieksekusi.
```

Karena itu Maven punya `effective-pom`, Gradle punya dependency/task/reporting tools.

---

### 0.6.3. Dependency Resolution

Build tool menyelesaikan dependency.

Input:

- direct dependencies;
- transitive dependencies;
- BOM/platform;
- exclusions;
- scopes/configurations;
- repositories;
- metadata;
- constraints;
- conflict resolution rules.

Output:

- compile classpath;
- runtime classpath;
- test compile classpath;
- test runtime classpath;
- annotation processor path;
- plugin classpath;
- buildscript classpath.

Dependency resolution adalah salah satu sumber problem terbesar di Java.

Contoh failure:

```text
java.lang.NoSuchMethodError
java.lang.ClassNotFoundException
java.lang.NoClassDefFoundError
LinkageError
duplicate class
UnsupportedClassVersionError
ServiceLoader tidak menemukan provider
SLF4J multiple bindings
Jackson method mismatch
Netty native conflict
javax/jakarta namespace collision
```

Banyak error runtime sebenarnya adalah dependency graph error yang baru muncul saat classloading.

Top 1% engineer melihat error seperti `NoSuchMethodError` bukan sebagai “bug Java random”, tetapi sebagai sinyal:

```text
Compile classpath dan runtime classpath tidak konsisten.
```

---

### 0.6.4. Source Generation

Banyak project Java modern tidak hanya compile source handwritten.

Sumber code bisa berasal dari:

- OpenAPI spec;
- protobuf schema;
- gRPC IDL;
- JAXB XSD;
- jOOQ database schema;
- QueryDSL annotation processing;
- JPA static metamodel;
- MapStruct generated mapper;
- Lombok AST transformation;
- custom codegen;
- build-time templating.

Mental model:

```text
Generated source adalah input compiler, tetapi output dari task lain.
```

Artinya build graph harus benar:

```text
generateOpenApiClient -> compileJava
generateJooq -> compileJava
processResources -> classes
```

Failure mode:

- generated source tidak masuk source set;
- generated source stale;
- generated source dikomit tetapi generator berubah;
- codegen butuh database live sehingga build tidak reproducible;
- codegen output berbeda antar OS;
- annotation processor tidak ada di processor path;
- generated code memakai Java version lebih tinggi dari target.

---

### 0.6.5. Compilation

Compilation bukan hanya `javac`.

Compiler dipengaruhi oleh:

- JDK yang menjalankan compiler;
- source level;
- target bytecode;
- `--release`;
- classpath;
- module path;
- annotation processor;
- compiler flags;
- encoding;
- preview features;
- warnings policy;
- generated sources;
- incremental compilation.

Untuk Java 8–25, compile strategy menjadi penting karena organisasi sering memiliki kombinasi:

```text
library harus support Java 8
service berjalan di Java 17
new platform mulai Java 21
future migration ke Java 25
```

Masalah umum:

```text
Dikompilasi dengan JDK 21 target 8, tetapi tidak pakai --release 8.
```

Akibatnya source bisa tidak sengaja memakai API yang tidak ada di Java 8, walaupun bytecode target-nya 8.

Mental model:

```text
source/target mengontrol syntax dan bytecode level.
--release mengontrol API surface platform target.
```

Ini akan dibahas lebih dalam di Part 1.

---

### 0.6.6. Resource Processing

Resource bukan sekadar file yang dicopy.

Resource bisa mencakup:

- `application.yml`;
- XML mapping;
- SQL migration;
- template email;
- keystore/truststore placeholder;
- static assets;
- logging config;
- `META-INF/services/*`;
- `module-info.class` related metadata;
- native image config;
- generated metadata.

Build bisa melakukan filtering:

```text
${project.version} -> 1.2.3
${build.time} -> 2026-06-16T...
```

Filtering harus hati-hati karena bisa merusak reproducibility.

Anti-pattern:

```text
Build dev menghasilkan artifact dev.
Build uat menghasilkan artifact uat.
Build prod menghasilkan artifact prod.
```

Untuk aplikasi modern, prinsip lebih sehat:

```text
Build once, configure at runtime.
```

Artifact seharusnya immutable. Environment-specific configuration masuk dari runtime config, secret manager, env var, mounted config, atau deployment manifest.

---

### 0.6.7. Testing

Testing dalam build bukan satu hal.

Jenis test:

- unit test;
- integration test;
- component test;
- contract test;
- functional test;
- smoke test;
- mutation test;
- benchmark;
- architecture test;
- compatibility test;
- migration test.

Pertanyaan build engineering:

```text
Test mana yang harus jalan di lifecycle mana?
Test mana yang blocking?
Test mana yang boleh nightly?
Test mana yang butuh external resource?
Test mana yang deterministic?
Test mana yang flaky?
```

Maven biasanya memisahkan:

```text
Surefire  -> unit test
Failsafe  -> integration test
```

Gradle bisa memodelkan test suites/source sets/tasks lebih fleksibel.

Failure mode:

- integration test dinamai seperti unit test lalu jalan terlalu awal;
- integration test tidak pernah jalan di CI;
- test butuh timezone tertentu;
- test paralel saling mengganggu;
- flaky test di-retry tanpa diagnosis;
- testcontainers image berubah;
- database migration test tidak masuk verify stage;
- JaCoCo report dibuat tetapi tidak menjadi gate.

Mental model:

```text
Test bukan aktivitas setelah build. Test adalah bagian dari build graph yang menentukan apakah artifact layak dipercaya.
```

---

### 0.6.8. Static Analysis and Verification

Build yang kuat tidak hanya menjalankan test.

Ia juga memverifikasi:

- style;
- bug pattern;
- nullness;
- forbidden API;
- dependency vulnerability;
- license;
- architecture layering;
- binary compatibility;
- code coverage;
- mutation coverage;
- generated SBOM;
- reproducibility;
- dependency convergence.

Contoh tools:

- Checkstyle;
- PMD;
- SpotBugs;
- Error Prone;
- NullAway;
- ArchUnit;
- Revapi;
- Maven Enforcer;
- OWASP Dependency-Check;
- CycloneDX;
- Gradle dependency verification;
- forbidden-apis.

Quality gate yang baik bukan “semua harus sempurna hari ini”.

Quality gate yang baik punya strategi:

```text
1. tetapkan baseline;
2. cegah regresi baru;
3. naikkan standar bertahap;
4. buat exception eksplisit;
5. jadikan rule sebagai policy, bukan tribal knowledge.
```

---

### 0.6.9. Packaging

Packaging mengubah hasil compile menjadi artifact.

Jenis artifact:

- plain JAR;
- executable JAR;
- fat/uber JAR;
- thin JAR;
- WAR;
- EAR;
- modular JAR;
- multi-release JAR;
- native image;
- container image;
- source JAR;
- javadoc JAR;
- test fixtures JAR.

Pertanyaan penting:

```text
Artifact ini untuk siapa?
Library atau application?
Dijalankan langsung atau dideploy ke container?
Dependency ikut dipaketkan atau disediakan runtime?
Perlu relocation/shading?
Perlu signed?
Perlu metadata SBOM?
Perlu reproducible bit-by-bit?
```

Kesalahan umum:

- library dipublish sebagai fat JAR;
- application butuh provided dependency tetapi dipaketkan salah;
- WAR membawa servlet API padahal container sudah menyediakan;
- Keycloak SPI salah packaging;
- shading tidak melakukan relocation;
- duplicate resource `META-INF/services` tertimpa;
- artifact local berbeda dari artifact CI.

---

### 0.6.10. Publication

Build belum selesai kalau artifact belum bisa dikonsumsi secara benar.

Publication mencakup:

- artifact coordinates;
- repository target;
- snapshot/release semantics;
- POM metadata;
- Gradle module metadata;
- source/javadoc artifact;
- checksum;
- signing;
- staging;
- promotion;
- release tag;
- changelog;
- provenance.

Artifact yang sudah dipublish harus diperlakukan sebagai kontrak.

Masalah serius:

```text
Artifact release 1.2.3 diubah diam-diam.
```

Ini merusak trust karena consumer tidak bisa tahu artifact mana yang sebenarnya mereka pakai.

Prinsip:

```text
Release artifact should be immutable.
```

Kalau ada bug, release versi baru. Jangan rewrite release lama.

---

## 0.7. Lifecycle vs Graph

Maven dan Gradle sering dibandingkan secara dangkal:

```text
Maven XML, Gradle Groovy/Kotlin.
```

Perbandingan yang lebih penting:

```text
Maven: lifecycle-first
Gradle: graph-first
```

### 0.7.1. Maven Lifecycle

Maven memiliki lifecycle bawaan seperti `clean`, `default`, dan `site`. Lifecycle default memiliki phase seperti validate, compile, test, package, verify, install, deploy.

Mental model:

```text
mvn verify
```

berarti:

```text
jalankan semua phase dari awal lifecycle default sampai verify,
termasuk plugin goals yang bound ke phase-phase tersebut.
```

Maven phase bukan task konkret. Phase adalah titik dalam lifecycle. Work nyata dilakukan oleh plugin goal yang terikat ke phase.

Contoh konseptual:

```text
phase compile  -> maven-compiler-plugin:compile
phase test     -> maven-surefire-plugin:test
phase package  -> maven-jar-plugin:jar
```

Karena itu, saat debugging Maven, pertanyaan penting adalah:

```text
Goal apa yang bound ke phase ini?
Binding-nya datang dari mana?
Plugin version-nya apa?
Execution id-nya apa?
Configuration efektifnya apa?
Profile apa yang aktif?
```

---

### 0.7.2. Gradle Task Graph

Gradle task adalah unit kerja.

Contoh:

```text
./gradlew build
```

`build` adalah task lifecycle yang bergantung pada task lain seperti `assemble` dan `check`. Task-task tersebut memiliki dependencies ke task lain seperti `compileJava`, `processResources`, `classes`, `test`, `jar`.

Mental model:

```text
requested task -> dependency closure -> task graph -> execute necessary tasks
```

Gradle bisa memutuskan task tidak perlu dijalankan jika input/output tidak berubah.

Contoh output:

```text
> Task :compileJava UP-TO-DATE
> Task :test FROM-CACHE
```

Ini bukan sekadar optimasi kosmetik. Ini berarti Gradle memodelkan task sebagai fungsi dari input ke output.

Jika task tidak mendeklarasikan input/output dengan benar, cache dan incremental build menjadi tidak valid.

---

## 0.8. Artifact Trust Ladder

Untuk memahami maturity build, gunakan ladder berikut.

### Level 0 — Manual Build

```text
Developer menjalankan command lokal.
Artifact dikirim manual.
```

Ciri:

- tidak reproducible;
- tidak ada version traceability;
- local environment sangat menentukan;
- rawan human error.

Ini level paling berbahaya.

---

### Level 1 — Scripted Build

```text
Ada Maven/Gradle command standar.
```

Ciri:

- build bisa dijalankan ulang;
- dependency masih mungkin tidak terkunci;
- plugin version mungkin implicit;
- local vs CI bisa beda;
- test mungkin belum lengkap.

Ini level banyak project kecil.

---

### Level 2 — CI Build

```text
CI menjalankan build untuk setiap commit/PR.
```

Ciri:

- artifact dibuat oleh sistem terpusat;
- test otomatis;
- report tersedia;
- cache mulai dipakai.

Masalah yang masih sering ada:

- CI cache tidak disiplin;
- build tidak reproducible;
- artifact dev/UAT/prod berbeda;
- security scanning belum blocking;
- release masih manual.

---

### Level 3 — Governed Build

```text
Build menjalankan policy organisasi.
```

Ciri:

- dependency version dikelola;
- plugin version dipin;
- Java baseline jelas;
- vulnerability scanning;
- license policy;
- test/coverage gate;
- artifact repository terpusat;
- release process terstandar.

Ini level enterprise yang sehat.

---

### Level 4 — Reproducible and Auditable Build

```text
Artifact bisa dibuat ulang dan diverifikasi.
```

Ciri:

- wrapper dipakai;
- toolchain dikontrol;
- dependency lock/verification;
- output timestamp stabil;
- checksum/signature;
- SBOM;
- provenance;
- immutable release;
- build metadata jelas;
- source-to-binary traceability.

Ini level yang dibutuhkan untuk sistem kritikal.

---

### Level 5 — Platform Build System

```text
Build menjadi platform internal untuk banyak tim.
```

Ciri:

- convention plugin/parent POM corporate;
- reusable pipeline;
- remote build cache;
- dependency governance;
- automated upgrade;
- security policy-as-code;
- observability build;
- impact-based CI;
- migration automation;
- developer experience kuat.

Ini level build/platform engineering yang matang.

---

## 0.9. Reproducibility: Build yang Bisa Dibuat Ulang

Reproducible build berarti pihak lain bisa membangun ulang artifact dari source, environment, dan instruksi yang sama, lalu mendapatkan output yang identik bit-by-bit.

Mengapa penting?

1. **Auditability**  
   Kita bisa membuktikan artifact berasal dari source tertentu.

2. **Security**  
   Mengurangi risiko artifact disisipkan perubahan berbahaya di luar source control.

3. **Debugging**  
   Kita bisa membandingkan artifact secara objektif.

4. **Compliance**  
   Sistem regulated sering perlu traceability.

5. **Trust**  
   Consumer artifact tidak harus percaya buta pada build machine tertentu.

### 0.9.1. Sumber Non-Reproducibility

Contoh sumber output berbeda:

```text
- current timestamp masuk MANIFEST.MF
- file order dalam ZIP/JAR berbeda
- absolute path masuk generated source
- username mesin masuk metadata
- OS newline berbeda
- locale/timezone mempengaruhi output
- dependency SNAPSHOT berubah
- plugin version floating
- annotation processor generate urutan berbeda
- test generate resource random
- build number auto-increment tanpa kontrol
```

### 0.9.2. Prinsip Reproducible Build

Prinsipnya:

```text
1. Pin tool version.
2. Pin plugin version.
3. Pin dependency version.
4. Hindari SNAPSHOT untuk release.
5. Stabilkan timestamp.
6. Stabilkan file ordering.
7. Hindari absolute path dalam artifact.
8. Pisahkan build-time dan runtime config.
9. Jalankan build di environment terkontrol.
10. Verifikasi artifact dengan checksum/compare.
```

### 0.9.3. Maven dan Reproducibility

Maven modern mendukung reproducible build melalui konfigurasi seperti `project.build.outputTimestamp`, selama plugin yang dipakai mendukung timestamp tersebut.

Namun Maven project tetap perlu disiplin:

- plugin versions eksplisit;
- dependency versions eksplisit atau via BOM terkendali;
- encoding eksplisit;
- source/target/release eksplisit;
- hindari SNAPSHOT saat release;
- gunakan plugin versi baru yang mendukung reproducible output;
- validasi dengan artifact comparison.

### 0.9.4. Gradle dan Reproducibility

Gradle memiliki beberapa mekanisme yang membantu:

- Gradle Wrapper;
- dependency locking;
- dependency verification;
- build cache;
- reproducible archive options;
- task input/output modeling;
- Java toolchains;
- configuration cache jika build logic kompatibel.

Namun Gradle juga bisa tidak reproducible jika build script terlalu imperative dan membaca state eksternal tanpa mendeklarasikannya sebagai input.

Contoh buruk:

```kotlin
val buildTime = LocalDateTime.now().toString()

tasks.jar {
    manifest {
        attributes("Build-Time" to buildTime)
    }
}
```

Ini membuat artifact berubah setiap build.

Contoh lebih sehat:

```kotlin
val buildTimestamp = providers.gradleProperty("buildTimestamp")

tasks.jar {
    manifest {
        attributes("Build-Time" to buildTimestamp.orNull)
    }
}
```

Masih perlu diputuskan apakah timestamp memang harus ada di artifact. Untuk reproducible release, sering kali metadata build lebih baik disimpan di luar artifact atau distabilkan dari commit timestamp.

---

## 0.10. Dependency Graph Sebagai Risk Graph

Dependency bukan hanya library tambahan. Dependency adalah risk surface.

Setiap dependency membawa:

- API;
- transitive dependencies;
- vulnerabilities;
- licenses;
- classpath entries;
- initialization behavior;
- logging behavior;
- service providers;
- native libraries;
- annotation processors;
- plugin code;
- supply-chain risk.

Dependency graph bisa digambarkan sebagai:

```text
application
 ├─ spring-boot-starter-web
 │   ├─ spring-webmvc
 │   ├─ jackson-databind
 │   └─ tomcat-embed-core
 ├─ database-driver
 ├─ internal-common-lib
 │   ├─ guava
 │   └─ commons-lang3
 └─ security-lib
     └─ jwt-lib
```

Masalahnya, dependency graph yang dilihat developer sering hanya direct dependencies.

Padahal runtime melihat keseluruhan classpath.

```text
Developer melihat: 10 dependencies.
Runtime melihat: 150 JARs.
Security scanner melihat: 150 attack surfaces.
ClassLoader melihat: urutan classpath dan duplicate classes.
```

### 0.10.1. Transitive Dependency Trap

Misalnya:

```text
A -> B -> C:1.0
A -> D -> C:2.0
```

Versi C mana yang dipakai?

Jawaban bergantung pada tool dan rules.

Maven punya dependency mediation dengan prinsip nearest definition. Gradle memiliki mekanisme conflict resolution dan variant-aware resolution yang berbeda.

Top 1% engineer tidak menghafal semua versi. Ia menguasai cara membaca dependency graph dan mengontrolnya.

Command mental:

```text
Maven:
  mvn dependency:tree
  mvn help:effective-pom

Gradle:
  ./gradlew dependencies
  ./gradlew dependencyInsight --dependency <name>
```

---

## 0.11. Build Environment: Mesin Adalah Input

Build tidak terjadi di ruang hampa.

Environment mempengaruhi output.

Input environment:

- OS;
- CPU architecture;
- filesystem case sensitivity;
- shell;
- locale;
- timezone;
- JDK distribution;
- JDK version;
- Maven/Gradle version;
- Docker version;
- network access;
- repository mirror;
- credentials;
- environment variables;
- local cache;
- memory limits;
- CPU limits.

Contoh problem nyata:

```text
Local Windows sukses, CI Linux gagal karena path separator.
Local Mac sukses, CI gagal karena filesystem case-sensitive.
Local JDK 21 sukses, server JDK 17 gagal dengan UnsupportedClassVersionError.
Local punya dependency di ~/.m2, CI tidak punya.
CI sukses karena cache lama, clean runner gagal.
```

Prinsip:

```text
Build environment harus dibuat eksplisit sejauh mungkin.
```

Tools:

- Maven Wrapper;
- Gradle Wrapper;
- Java Toolchains;
- Dockerized CI runner;
- pinned image digest;
- repository proxy;
- CI cache policy;
- `.mvn/` config;
- `gradle.properties`;
- `.java-version` atau toolchain file;
- dependency locks;
- checksum verification.

---

## 0.12. The Four Classpaths of Java Build

Banyak engineer hanya berpikir “classpath”. Sebenarnya ada beberapa classpath berbeda.

### 0.12.1. Build Tool Classpath

Classpath yang dipakai Maven/Gradle untuk menjalankan dirinya dan plugin.

Contoh:

- Maven core;
- Maven plugin dependencies;
- Gradle runtime;
- Gradle plugin dependencies;
- buildscript dependencies.

Risk:

```text
Plugin adalah code yang dieksekusi di build machine.
```

Plugin berbahaya bisa membaca environment variables, secrets, filesystem, dan network.

---

### 0.12.2. Compile Classpath

Classpath yang dipakai `javac` untuk compile production source.

Risk:

- compile sukses karena dependency tersedia;
- runtime gagal karena dependency tidak ikut dipaketkan;
- API dari dependency transitive terpakai tanpa direct declaration.

---

### 0.12.3. Runtime Classpath

Classpath saat aplikasi berjalan.

Risk:

- versi runtime berbeda dari compile;
- container menyediakan dependency berbeda;
- shaded JAR bentrok;
- servlet/Jakarta API salah scope;
- classloader application server punya hierarchy khusus.

---

### 0.12.4. Test Classpath

Classpath untuk compile/run test.

Risk:

- test dependency menyembunyikan missing runtime dependency;
- test berjalan dengan library yang tidak ada di production;
- embedded server berbeda dari production server;
- testcontainers dependency bocor ke runtime artifact.

---

### 0.12.5. Annotation Processor Path

Sejak Java 9 era module/security awareness, annotation processor idealnya dipisah dari compile classpath.

Risk:

- processor tidak sengaja masuk runtime dependency;
- processor version mismatch;
- Lombok/MapStruct tidak kompatibel dengan JDK baru;
- generated code berubah tanpa source berubah.

Mental model:

```text
Classpath bukan satu daftar JAR. Build memiliki beberapa graph dependency dengan tujuan berbeda.
```

---

## 0.13. Build Failure Taxonomy

Supaya debugging tidak acak, gunakan taxonomy.

### 0.13.1. Discovery Failure

Build tidak menemukan project atau module.

Contoh:

```text
Non-resolvable parent POM
Project not found in root project
Module path does not exist
```

Kemungkinan akar:

- directory salah;
- parent belum dipublish;
- relativePath salah;
- settings Gradle tidak include module;
- Git submodule belum checkout.

---

### 0.13.2. Model Configuration Failure

Build model gagal dibentuk.

Contoh:

```text
Plugin not found
Could not apply plugin
Cannot set property after it has been finalized
Profile activation unexpected
```

Kemungkinan akar:

- plugin repository salah;
- plugin version tidak kompatibel;
- Gradle lazy configuration dilanggar;
- property override salah;
- parent POM berubah.

---

### 0.13.3. Dependency Resolution Failure

Dependency tidak bisa diresolve.

Contoh:

```text
Could not find artifact
Could not resolve all files
PKIX path building failed
401 Unauthorized
Checksum failed
```

Kemungkinan akar:

- repository down;
- credential salah;
- proxy corporate;
- artifact belum publish;
- metadata stale;
- TLS certificate;
- dependency typo;
- mirror misconfiguration.

---

### 0.13.4. Compilation Failure

Source gagal compile.

Contoh:

```text
cannot find symbol
package does not exist
release version not supported
invalid target release
```

Kemungkinan akar:

- dependency scope salah;
- generated source belum dibuat;
- JDK salah;
- source/target/release salah;
- annotation processor tidak jalan;
- incompatible library version.

---

### 0.13.5. Test Failure

Test gagal.

Bedakan:

```text
Test assertion failure
Test infrastructure failure
Test environment failure
Test flakiness
Test classpath failure
```

Jangan langsung retry tanpa klasifikasi.

---

### 0.13.6. Packaging Failure

Artifact gagal dibuat.

Contoh:

```text
duplicate entry
invalid signature file digest
cannot create shaded jar
resource conflict
```

Kemungkinan akar:

- duplicate classes/resources;
- shading salah;
- signed dependency dishade;
- file path terlalu panjang;
- generated metadata bentrok.

---

### 0.13.7. Publication Failure

Artifact gagal dipublish.

Contoh:

```text
401 Unauthorized
409 Conflict
staging repository close failed
signing failed
version already exists
```

Kemungkinan akar:

- credential/token salah;
- release version sudah immutable;
- signing key tidak tersedia;
- metadata POM invalid;
- repository policy menolak SNAPSHOT/release.

---

### 0.13.8. Runtime Failure After Successful Build

Build sukses tetapi aplikasi gagal jalan.

Contoh:

```text
NoSuchMethodError
ClassNotFoundException
UnsupportedClassVersionError
ServiceConfigurationError
Bean creation failure due to missing class
```

Kemungkinan akar:

- runtime classpath beda;
- container dependency conflict;
- Java runtime lebih rendah;
- optional dependency tidak ada;
- shading/relocation salah;
- generated resource tidak dipaketkan.

Mental model:

```text
Build success hanya berarti lifecycle yang dijalankan sukses, bukan berarti semua runtime invariant terpenuhi.
```

---

## 0.14. Local Build vs CI Build vs Release Build

Jangan samakan semua build.

### 0.14.1. Local Build

Tujuan:

- feedback cepat;
- developer productivity;
- incremental loop;
- selective tests.

Karakter:

- boleh pakai local cache;
- boleh skip beberapa heavy checks saat development;
- harus tetap cukup mirip CI agar tidak menipu.

---

### 0.14.2. CI Build

Tujuan:

- validate commit/PR;
- detect regression;
- enforce team policy;
- produce reports.

Karakter:

- clean-ish environment;
- deterministic lebih penting;
- cache harus aman;
- test lebih lengkap;
- quality gates aktif.

---

### 0.14.3. Release Build

Tujuan:

- menghasilkan artifact yang akan dikonsumsi/dideploy;
- traceability;
- immutability;
- provenance.

Karakter:

- tidak memakai SNAPSHOT;
- version final;
- signing/checksum;
- SBOM;
- vulnerability gate;
- tag source;
- publish artifact;
- reproducibility lebih ketat.

Prinsip penting:

```text
Artifact yang dirilis harus berasal dari release build, bukan dari laptop developer.
```

---

## 0.15. Build as Contract

Build harus dipahami sebagai kontrak.

### 0.15.1. Contract dengan Developer

Developer butuh:

- command yang jelas;
- error yang actionable;
- build cepat;
- local/CI parity;
- dependency update yang terkontrol.

Kontrak contoh:

```text
./mvnw verify
./gradlew build
```

harus menjadi command yang meaningful.

Kalau `verify` tidak menjalankan integration test penting, nama command memberi rasa aman palsu.

---

### 0.15.2. Contract dengan CI/CD

Pipeline butuh:

- exit code reliable;
- report path standar;
- artifact path standar;
- cache key jelas;
- environment input jelas;
- secret boundary jelas.

Build yang baik memudahkan pipeline.

Build yang buruk membuat pipeline penuh shell script tambalan.

---

### 0.15.3. Contract dengan Runtime

Runtime butuh artifact yang:

- kompatibel dengan Java runtime;
- membawa dependency yang tepat;
- tidak membawa dependency yang seharusnya provided;
- memiliki metadata yang cukup;
- dapat dikonfigurasi runtime;
- tidak bergantung local path;
- tidak membawa secret.

---

### 0.15.4. Contract dengan Security/Compliance

Security butuh:

- dependency list;
- vulnerability status;
- license status;
- SBOM;
- provenance;
- signing;
- audit trail;
- policy exceptions.

Kalau build tidak menghasilkan data ini, security bekerja dengan blind spot.

---

## 0.16. Build Smells

Build smell adalah tanda build system mulai tidak sehat.

### 0.16.1. “Clean Build Required” Smell

Kalau developer sering harus menjalankan:

```text
mvn clean install
./gradlew clean build
```

untuk memperbaiki error random, berarti incremental state tidak dipercaya.

Kemungkinan akar:

- generated sources stale;
- task input/output salah;
- plugin tidak incremental;
- output directory dicampur;
- annotation processor menghasilkan file tidak stabil;
- test meninggalkan state.

---

### 0.16.2. “Works on My Machine” Smell

Kemungkinan akar:

- environment implicit;
- local dependency cache;
- JDK beda;
- profile lokal aktif;
- credential lokal;
- path lokal;
- timezone/locale.

Solusi bukan menyalahkan developer, tapi membuat environment contract eksplisit.

---

### 0.16.3. “Common Module Everything” Smell

Semua utility masuk satu module `common`.

Akibat:

- dependency graph membesar;
- transitive dependency bocor;
- cyclic design tersembunyi;
- perubahan kecil trigger rebuild besar;
- boundary arsitektur kabur.

Build graph sering mengungkap architecture smell.

---

### 0.16.4. “Skip Tests by Default” Smell

Kalau build normal selalu:

```text
-DskipTests
-x test
```

maka build tidak lagi menjadi trust mechanism.

Memang ada kasus valid untuk skip test, tetapi bukan default untuk validation build.

---

### 0.16.5. “Floating Version” Smell

Contoh:

```text
LATEST
RELEASE
1.+
SNAPSHOT di release path
plugin version tidak eksplisit
```

Akibat:

- build tidak reproducible;
- perubahan dependency tidak lewat review;
- production risk meningkat.

---

### 0.16.6. “Shell Script Around Build Tool” Smell

Kalau pipeline penuh script seperti:

```bash
cp file here
sed replace there
run mvn
move target manually
zip manually
upload manually
```

mungkin build logic salah tempat.

Tidak semua shell script buruk. Tetapi jika shell script menentukan artifact content, maka artifact contract berada di luar Maven/Gradle dan sulit diaudit.

---

## 0.17. Build Invariants

Top engineer berpikir dalam invariant.

Invariant adalah kondisi yang harus selalu benar.

### 0.17.1. Source-to-Artifact Invariant

```text
Setiap artifact release harus bisa ditrace ke commit source tertentu.
```

Implikasi:

- release tag;
- build metadata;
- CI build ID;
- commit hash;
- artifact repository metadata.

---

### 0.17.2. Dependency Invariant

```text
Dependency production harus eksplisit, terkontrol, dan dapat diaudit.
```

Implikasi:

- dependency tree diperiksa;
- direct dependency untuk API yang dipakai langsung;
- BOM/platform;
- lock/verification;
- vulnerability scanning.

---

### 0.17.3. Java Compatibility Invariant

```text
Artifact harus kompatibel dengan runtime Java yang ditargetkan.
```

Implikasi:

- `--release`;
- toolchains;
- runtime test matrix;
- no accidental newer API;
- class file version check.

---

### 0.17.4. Test Contract Invariant

```text
Build verification harus menjalankan test yang cukup untuk memberi trust pada artifact.
```

Implikasi:

- unit test;
- integration test;
- contract test;
- architecture test;
- clear lifecycle placement.

---

### 0.17.5. Artifact Immutability Invariant

```text
Release artifact tidak boleh berubah setelah dipublish.
```

Implikasi:

- version uniqueness;
- no overwrite release;
- repository policy;
- checksum/signature;
- release rollback via new version.

---

### 0.17.6. Build Logic Ownership Invariant

```text
Build logic harus punya owner, review process, dan compatibility policy.
```

Implikasi:

- parent POM/convention plugin tidak diubah sembarangan;
- breaking build logic changes dikomunikasikan;
- migration path tersedia;
- versioned build platform.

---

## 0.18. Build Inputs: Explicit vs Implicit

Salah satu skill paling penting adalah membedakan input eksplisit dan implisit.

### 0.18.1. Input Eksplisit

Contoh:

- source files;
- `pom.xml`;
- `build.gradle.kts`;
- `settings.gradle.kts`;
- dependency versions;
- plugin versions;
- Java toolchain declaration;
- test resources;
- OpenAPI spec committed;
- lock files.

Input ini visible di repo.

---

### 0.18.2. Input Implisit

Contoh:

- local JDK;
- Maven/Gradle installed version;
- local Maven repository;
- local Gradle cache;
- environment variables;
- current date/time;
- timezone;
- network state;
- repository latest metadata;
- database schema live;
- generated file dari luar repo;
- secret manager content;
- OS-specific behavior.

Input implisit membuat build sulit dipercaya.

Target build engineering:

```text
Ubah input implisit menjadi eksplisit, atau isolasi dampaknya.
```

---

## 0.19. Build Output: Primary vs Secondary

### 0.19.1. Primary Outputs

Output utama:

- JAR/WAR/EAR;
- native image;
- container image;
- published library;
- generated client artifact.

### 0.19.2. Secondary Outputs

Output pendukung:

- test reports;
- coverage reports;
- static analysis reports;
- dependency reports;
- SBOM;
- build scan;
- logs;
- checksums;
- signatures;
- provenance statement.

Secondary output sering lebih penting untuk governance daripada artifact itu sendiri.

Tanpa report, build hanya berkata:

```text
success/failure
```

Dengan report, build menjelaskan:

```text
apa yang diuji,
apa yang dipaketkan,
apa yang rentan,
apa yang berubah,
dan kenapa artifact bisa dipercaya.
```

---

## 0.20. Build Performance Mental Model

Build cepat bukan sekadar “pakai cache”.

Build time terdiri dari:

```text
T_total = T_startup
        + T_configuration
        + T_dependency_resolution
        + T_codegen
        + T_compilation
        + T_tests
        + T_analysis
        + T_packaging
        + T_publication
        + T_queue/CI overhead
```

Optimasi harus berdasarkan bottleneck.

### 0.20.1. Maven Performance Levers

- parallel reactor build;
- dependency cache warmed;
- skip unnecessary phases locally;
- split unit/integration tests;
- optimize annotation processors;
- reduce module coupling;
- avoid unnecessary `clean`;
- tune Surefire/Failsafe parallelism;
- avoid heavy plugin execution in default local lifecycle.

### 0.20.2. Gradle Performance Levers

- Gradle daemon;
- configuration avoidance;
- build cache;
- configuration cache;
- incremental tasks;
- parallel execution;
- remote cache;
- proper task inputs/outputs;
- convention plugins instead of repeated script logic;
- avoid `allprojects/subprojects` abuse;
- avoid eager dependency resolution.

### 0.20.3. Performance Trade-Off

Build tercepat bukan selalu build terbaik.

Pertanyaan penting:

```text
Cepat untuk siapa?
Local developer?
CI PR?
Release build?
Nightly build?
```

Release build boleh lebih lambat kalau memberi trust lebih tinggi. Local build harus cepat untuk feedback loop. CI PR harus seimbang antara speed dan signal.

---

## 0.21. Build Security Mental Model

Build machine adalah target menarik karena memiliki akses ke:

- source code;
- secrets;
- signing keys;
- artifact repository tokens;
- deployment credentials;
- internal network;
- CI variables;
- dependency cache.

Build menjalankan code dari:

- Maven plugins;
- Gradle plugins;
- annotation processors;
- test dependencies;
- code generators;
- custom scripts;
- Docker images;
- downloaded binaries.

Maka dependency/plugin bukan hanya compile input, tapi executable supply-chain input.

### 0.21.1. Security Questions

Untuk setiap build dependency/plugin:

```text
Siapa publisher-nya?
Apakah version dipin?
Apakah checksum diverifikasi?
Apakah vulnerability discan?
Apakah license sesuai?
Apakah artifact berasal dari repository yang dipercaya?
Apakah plugin butuh network?
Apakah plugin bisa membaca secret?
```

### 0.21.2. Dependency Confusion

Dependency confusion terjadi ketika build mengambil artifact dari repository publik padahal seharusnya dari repository internal, atau sebaliknya.

Mitigasi:

- repository order jelas;
- group ownership jelas;
- internal group tidak resolve dari publik;
- repository proxy policy;
- checksum/signature verification;
- dependency verification.

### 0.21.3. Secret Leakage

Build sering membocorkan secret lewat:

- logs;
- test output;
- generated resources;
- packaged config;
- environment dump;
- stacktrace;
- dependency publish metadata;
- Docker layer.

Prinsip:

```text
Secret boleh tersedia untuk build hanya jika benar-benar dibutuhkan, dengan scope minimum, dan tidak boleh masuk artifact/log.
```

---

## 0.22. Build and Architecture

Build graph sering mencerminkan architecture graph.

Jika module A depends on module B, berarti A tahu B.

Contoh:

```text
application-service -> domain-model
application-service -> persistence-adapter
persistence-adapter -> domain-model
web-adapter -> application-service
```

Ini mungkin sehat.

Tapi jika:

```text
domain-model -> persistence-adapter
common -> everything
everything -> common
case-module -> appeal-module -> case-module
```

maka build graph mengungkap architecture smell.

Build tool bisa dipakai untuk enforce architecture:

- module dependency direction;
- forbidden dependency;
- API/implementation separation;
- architecture tests;
- dependency analysis;
- package cycle detection.

Top engineer tidak melihat build sebagai hal terpisah dari architecture.

> Build structure adalah executable architecture map.

---

## 0.23. Build for Libraries vs Applications

Library dan application punya build concern berbeda.

### 0.23.1. Library Build

Library harus memikirkan consumer.

Concern:

- API stability;
- semantic versioning;
- binary compatibility;
- minimal dependencies;
- no unnecessary transitive dependency;
- source/javadoc artifacts;
- published POM metadata;
- Java baseline;
- no fat JAR;
- optional dependency clarity;
- JPMS module name;
- reproducible published artifact.

Library yang buruk memaksa consumer membawa konflik.

---

### 0.23.2. Application Build

Application harus memikirkan runtime.

Concern:

- executable artifact;
- runtime dependency completeness;
- config externalization;
- container layering;
- startup behavior;
- environment compatibility;
- migration scripts;
- deployment metadata;
- SBOM;
- vulnerability gate;
- integration tests;
- image provenance.

Application boleh mengunci dependency lebih agresif karena tidak diekspor sebagai API ke consumer lain.

---

## 0.24. Build for Java 8–25

Karena seri ini mencakup Java 8 sampai 25, build engineering harus memikirkan beberapa era Java.

### 0.24.1. Java 8 Era

Karakter:

- classpath-centric;
- no module system;
- older plugin compatibility;
- banyak enterprise legacy;
- masih umum untuk library baseline;
- annotation processor pattern sudah luas;
- `--release` belum ada saat JDK 8 sebagai compiler.

### 0.24.2. Java 9–16 Era

Karakter:

- JPMS diperkenalkan;
- module path muncul;
- illegal reflective access warning;
- JDK internal API makin dibatasi;
- `--release` menjadi penting;
- multi-release JAR muncul.

### 0.24.3. Java 17 Era

Karakter:

- LTS modern yang banyak dipakai enterprise;
- stronger encapsulation;
- Spring Boot 3/Jakarta modern banyak baseline di Java 17+;
- javax to jakarta migration makin relevan;
- build plugin lama sering mulai bermasalah.

### 0.24.4. Java 21 Era

Karakter:

- LTS modern sebelumnya;
- virtual threads stabil;
- build/test matrix mulai memasukkan Java 21;
- toolchain awareness makin penting;
- library perlu memastikan compatibility.

### 0.24.5. Java 25 Era

Karakter:

- LTS terbaru sejak September 2025;
- target masa depan banyak platform;
- plugin, annotation processor, bytecode tools harus kompatibel;
- CI matrix perlu mulai memasukkan Java 25;
- enterprise perlu migration path dari Java 17/21.

Build concern lintas versi:

```text
- JDK untuk menjalankan build tool
- JDK untuk compile
- JDK untuk test
- target runtime JDK
- dependency bytecode compatibility
- plugin compatibility dengan JDK terbaru
- annotation processor compatibility
- preview feature policy
```

---

## 0.25. The Build Engineer's Debugging Loop

Saat build gagal, gunakan loop berikut.

### Step 1 — Klasifikasikan Failure

Tentukan jenisnya:

```text
discovery?
model?
dependency resolution?
compile?
test?
packaging?
publish?
runtime after build?
```

Jangan langsung mengubah dependency/plugin tanpa klasifikasi.

---

### Step 2 — Identifikasi Input yang Berubah

Tanya:

```text
Apa commit terakhir?
Dependency berubah?
Plugin berubah?
JDK berubah?
CI image berubah?
Repository berubah?
Profile berubah?
Generated source berubah?
Cache berubah?
```

---

### Step 3 — Bandingkan Local vs CI

Periksa:

```text
JDK version
Maven/Gradle version
OS
command
profiles/properties
environment variables
repository settings
cache state
```

---

### Step 4 — Buat Failure Reproducible

Goal:

```text
satu command yang konsisten menghasilkan failure
```

Contoh:

```bash
./mvnw -U -e -X clean verify
./gradlew clean build --stacktrace --info --no-build-cache
```

Tidak selalu harus pakai `clean`, tetapi saat diagnosis awal, clean build membantu membedakan cache issue dari real issue.

---

### Step 5 — Inspect Effective Model/Graph

Maven:

```bash
./mvnw help:effective-pom
./mvnw dependency:tree
./mvnw help:active-profiles
```

Gradle:

```bash
./gradlew tasks
./gradlew dependencies
./gradlew dependencyInsight --dependency <name>
./gradlew buildEnvironment
```

---

### Step 6 — Kurangi Scope

Cari module/task terkecil yang gagal.

```bash
./mvnw -pl module-a -am verify
./gradlew :module-a:test
```

Tujuannya mempercepat feedback dan mengisolasi graph.

---

### Step 7 — Fix Contract, Bukan Gejala

Contoh fix gejala:

```text
Tambahkan dependency transitive secara random sampai compile sukses.
```

Fix kontrak:

```text
Tambahkan direct dependency karena source memakai API tersebut.
Pastikan scope benar.
Pastikan runtime classpath sesuai.
Tambahkan dependency convergence rule.
```

---

## 0.26. Example: Membaca Error dengan Mental Model Build

### Case 1 — `UnsupportedClassVersionError`

Error:

```text
UnsupportedClassVersionError: class file version 65.0, this runtime only recognizes up to 61.0
```

Interpretasi:

```text
Class dikompilasi untuk Java 21, tetapi runtime hanya Java 17.
```

Bukan bug business logic.

Area investigasi:

- JDK compile;
- target/release;
- dependency bytecode version;
- CI image;
- runtime image;
- plugin/toolchain config.

Fix sehat:

- set toolchain dan `--release` sesuai target;
- upgrade runtime;
- downgrade dependency yang butuh Java lebih tinggi;
- tambahkan check bytecode version di CI.

---

### Case 2 — `NoSuchMethodError`

Error:

```text
java.lang.NoSuchMethodError: com.fasterxml.jackson.databind.ObjectMapper.someMethod()
```

Interpretasi:

```text
Code dikompilasi terhadap versi Jackson yang punya method itu,
tetapi runtime memakai versi Jackson yang tidak punya method itu.
```

Area investigasi:

- compile classpath;
- runtime classpath;
- dependency mediation;
- transitive dependency;
- container-provided library;
- fat JAR duplicate.

Fix sehat:

- align Jackson via BOM;
- inspect dependency tree;
- enforce convergence;
- remove duplicate/shaded conflict;
- pastikan runtime classpath sama.

---

### Case 3 — Build CI Gagal, Local Sukses

Interpretasi awal:

```text
Ada input environment berbeda atau local state menyembunyikan masalah.
```

Checklist:

- JDK version sama?
- Maven/Gradle wrapper dipakai?
- dependency ada di local cache saja?
- CI memakai profile berbeda?
- env var berbeda?
- test butuh timezone?
- repository credential beda?
- generated file belum committed?
- case-sensitive filename issue?

Fix sehat:

- gunakan wrapper;
- deklarasikan toolchain;
- clean runner test;
- hilangkan dependency pada local state;
- jadikan generated source lifecycle eksplisit.

---

## 0.27. Minimal Build Contract untuk Project Java Serius

Untuk project Java enterprise, minimal kontrak yang sehat:

### 0.27.1. Command Contract

Maven:

```bash
./mvnw verify
```

Gradle:

```bash
./gradlew build
```

Command tersebut harus menjalankan validasi yang cukup.

---

### 0.27.2. Version Contract

Harus jelas:

```text
Java version untuk compile
Java version untuk runtime
Maven/Gradle version
Plugin versions
Dependency versions
```

---

### 0.27.3. Dependency Contract

Harus jelas:

```text
dependency graph
BOM/platform
scope/configuration
repository source
vulnerability policy
license policy
```

---

### 0.27.4. Test Contract

Harus jelas:

```text
unit test command
integration test command
CI blocking checks
nightly checks
coverage threshold
flaky test policy
```

---

### 0.27.5. Release Contract

Harus jelas:

```text
versioning strategy
artifact repository
snapshot/release policy
tagging
signing/checksum
SBOM/provenance
immutability
rollback strategy
```

---

## 0.28. Practical Checklist: Assess Build Maturity

Gunakan checklist ini untuk menilai project.

### Project Identity

- [ ] group/artifact/version jelas;
- [ ] module structure jelas;
- [ ] parent/aggregator tidak tercampur sembarangan;
- [ ] naming artifact konsisten.

### Java Compatibility

- [ ] target Java runtime jelas;
- [ ] compile toolchain jelas;
- [ ] `--release` atau equivalent digunakan dengan benar;
- [ ] dependency bytecode compatibility dicek;
- [ ] CI matrix mencakup target penting.

### Dependency

- [ ] dependency direct yang dipakai source dideklarasikan langsung;
- [ ] dependency versions dikontrol via BOM/platform/constraints;
- [ ] tidak ada floating release;
- [ ] SNAPSHOT tidak masuk release;
- [ ] dependency tree bisa diaudit;
- [ ] vulnerability scanning ada.

### Plugin

- [ ] plugin versions dipin;
- [ ] plugin repository dipercaya;
- [ ] plugin execution jelas;
- [ ] custom plugin punya owner;
- [ ] plugin kompatibel dengan JDK target.

### Reproducibility

- [ ] wrapper digunakan;
- [ ] timestamp artifact distabilkan;
- [ ] encoding eksplisit;
- [ ] environment input diminimalkan;
- [ ] release artifact immutable;
- [ ] checksum/signature tersedia.

### CI/CD

- [ ] CI memakai wrapper;
- [ ] CI command sama dengan kontrak build;
- [ ] cache policy aman;
- [ ] artifact dari CI, bukan local;
- [ ] reports dipublish;
- [ ] release build berbeda dari PR build.

### Security

- [ ] dependency scan;
- [ ] license scan;
- [ ] SBOM;
- [ ] secret tidak masuk artifact/log;
- [ ] repository internal/publik dipisah jelas;
- [ ] signing/provenance untuk release penting.

### Observability

- [ ] test report mudah dibaca;
- [ ] coverage trend ada;
- [ ] build time dipantau;
- [ ] flaky test dipantau;
- [ ] dependency update terlihat;
- [ ] failure taxonomy dipakai.

---

## 0.29. Cara Berpikir Top 1% tentang Build

Engineer biasa:

```text
Build gagal, cari error, patch sampai hijau.
```

Engineer kuat:

```text
Build gagal, klasifikasikan failure, inspect graph/model, cari input yang berubah, fix invariant.
```

Engineer biasa:

```text
Tambahkan dependency supaya compile.
```

Engineer kuat:

```text
Tentukan apakah dependency itu API, implementation, runtime, test, provided, annotationProcessor, atau plugin dependency.
```

Engineer biasa:

```text
Pakai latest version agar update.
```

Engineer kuat:

```text
Pin version, audit changelog, jalankan compatibility tests, update via controlled process.
```

Engineer biasa:

```text
Skip test supaya build cepat.
```

Engineer kuat:

```text
Pisahkan fast feedback, CI validation, nightly deep checks, dan release verification.
```

Engineer biasa:

```text
CI error aneh.
```

Engineer kuat:

```text
Local dan CI punya input berbeda. Mari buat environment contract eksplisit.
```

Engineer biasa:

```text
Maven vs Gradle mana lebih bagus?
```

Engineer kuat:

```text
Constraint organisasi apa? Lifecycle standardization, graph complexity, governance, build performance, plugin ecosystem, migration cost, dan skill distribution seperti apa?
```

---

## 0.30. Ringkasan Mental Model

Bagian ini bisa diringkas menjadi beberapa prinsip inti:

1. **Build adalah transformasi input menjadi artifact yang bisa dipercaya.**
2. **Build file bukan script biasa, tetapi model project, graph, policy, dan release contract.**
3. **Maven lifecycle-first; Gradle graph-first.**
4. **Dependency graph adalah risk graph.**
5. **Classpath tidak tunggal: build, compile, runtime, test, annotation processor punya graph berbeda.**
6. **Local build, CI build, dan release build punya tujuan berbeda.**
7. **Reproducibility berarti artifact bisa dibuat ulang dari input yang sama.**
8. **Build failure harus diklasifikasikan sebelum diperbaiki.**
9. **Build graph sering mencerminkan architecture graph.**
10. **Artifact release harus immutable, traceable, dan auditable.**

Kalau mental model ini sudah kuat, Maven dan Gradle tidak lagi terlihat sebagai kumpulan command dan konfigurasi. Keduanya menjadi alat untuk mengendalikan lifecycle software dari source code sampai artifact yang dipercaya.

---

## 0.31. Latihan Mandiri

### Latihan 1 — Audit Build Project yang Ada

Ambil satu project Java yang pernah kamu kerjakan. Jawab:

```text
1. Command validasi utama apa?
2. Java compile version apa?
3. Java runtime target apa?
4. Dependency versions dikontrol dari mana?
5. Plugin versions eksplisit atau implicit?
6. Artifact yang diproduksi apa?
7. Test apa saja yang jalan di build utama?
8. Integration test masuk lifecycle atau tidak?
9. Artifact bisa ditrace ke commit atau tidak?
10. Release artifact bisa dibuat ulang atau tidak?
```

### Latihan 2 — Dependency Graph Reading

Jalankan:

```bash
./mvnw dependency:tree
```

atau:

```bash
./gradlew dependencies
```

Cari:

```text
1. dependency paling banyak membawa transitive dependency;
2. duplicate family version seperti Jackson/Netty/Guava;
3. dependency test yang tidak seharusnya masuk runtime;
4. dependency internal yang membawa terlalu banyak hal;
5. dependency yang seharusnya direct tapi hanya muncul transitively.
```

### Latihan 3 — Reproducibility Thought Experiment

Tanyakan:

```text
Kalau project ini dibuild ulang 6 bulan lagi dari commit yang sama,
apakah artifact-nya sama?
```

Jika jawabannya tidak pasti, identifikasi input tersembunyi.

### Latihan 4 — Failure Taxonomy

Ambil 5 build failure terakhir dari projectmu. Klasifikasikan:

```text
discovery / model / dependency / compile / test / packaging / publish / runtime
```

Lalu cari pattern dominan.

---

## 0.32. Referensi Resmi dan Bacaan Lanjutan

Referensi berikut dipakai sebagai landasan bagian ini dan akan sering muncul lagi di part berikutnya:

1. Apache Maven — Introduction to the Build Lifecycle  
   https://maven.apache.org/guides/introduction/introduction-to-the-lifecycle.html

2. Apache Maven — Introduction to the POM  
   https://maven.apache.org/guides/introduction/introduction-to-the-pom.html

3. Apache Maven — Introduction to the Dependency Mechanism  
   https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html

4. Apache Maven — Configuring for Reproducible Builds  
   https://maven.apache.org/guides/mini/guide-reproducible-builds.html

5. Apache Maven — Download / Maven 3.9.x JDK requirement  
   https://maven.apache.org/download.cgi

6. Gradle User Manual — Build Lifecycle  
   https://docs.gradle.org/current/userguide/build_lifecycle.html

7. Gradle User Manual — Understanding Tasks  
   https://docs.gradle.org/current/userguide/more_about_tasks.html

8. Gradle User Manual — Incremental Build  
   https://docs.gradle.org/current/userguide/incremental_build.html

9. Gradle User Manual — Build Cache  
   https://docs.gradle.org/current/userguide/build_cache.html

10. Gradle User Manual — Performance  
    https://docs.gradle.org/current/userguide/performance.html

11. Oracle Java Downloads — JDK 25 as latest LTS, JDK 21 as previous LTS  
    https://www.oracle.com/java/technologies/downloads/

12. OpenJDK — JDK 25 Project  
    https://openjdk.org/projects/jdk/25/

---

## 0.33. Status Seri

Part ini adalah **Part 0 dari 35** dalam seri:

```text
learn-java-build-gradle-maven-engineering
```

Status:

```text
[x] Part 0 — Build Engineering Mental Model
[ ] Part 1 — Java Version Strategy: Java 8–25, Source/Target/Release, Toolchains, dan Compatibility Boundary
[ ] Part 2 — Maven Core Mental Model
[ ] Part 3 — Gradle Core Mental Model
...
[ ] Part 34 — Top 1% Build Engineer Playbook
```

Seri **belum selesai**. Bagian berikutnya adalah:

```text
Part 1 — Java Version Strategy: Java 8–25, Source/Target/Release, Toolchains, dan Compatibility Boundary
```
