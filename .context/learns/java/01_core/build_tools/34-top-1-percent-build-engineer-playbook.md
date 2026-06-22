# Part 34 — Top 1% Build Engineer Playbook

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `34-top-1-percent-build-engineer-playbook.md`  
> Scope: Java 8–25, Maven, Gradle, enterprise build engineering, dependency governance, CI/CD, reproducibility, release, security, observability, migration, and operational excellence.

---

## 0. Tujuan Bagian Ini

Bagian ini adalah penutup seluruh seri. Fokusnya bukan lagi membahas satu fitur Maven atau Gradle secara terisolasi, tetapi menyatukan semua konsep menjadi **playbook berpikir dan bertindak**.

Seorang engineer yang sangat kuat di build engineering tidak hanya tahu:

```bash
mvn clean install
./gradlew build
```

Ia memahami bahwa build adalah:

- model arsitektur software;
- graph dependency dan graph task;
- supply-chain boundary;
- kontrak reproducibility;
- mekanisme governance;
- sistem observability;
- state machine release;
- alat untuk menekan risiko organisasi.

Target bagian ini adalah membentuk cara berpikir seperti build/platform engineer senior yang mampu:

1. mendesain build system untuk banyak service/module/team;
2. men-debug kegagalan build tanpa tebak-tebakan;
3. mengontrol dependency graph secara sadar;
4. menjaga artifact tetap reproducible, secure, dan auditable;
5. memilih Maven/Gradle berdasarkan constraint nyata;
6. membuat build cepat tanpa mengorbankan correctness;
7. mengubah build dari script lokal menjadi sistem engineering yang bisa dipercaya.

---

## 1. Top 1% Build Engineer: Definisi Praktis

Di konteks build engineering, “top 1%” bukan berarti hafal semua plugin. Itu berarti mampu melihat build sebagai **sistem kompleks dengan invariant**.

Engineer biasa melihat build seperti ini:

```text
source code -> command -> artifact
```

Engineer kuat melihat build seperti ini:

```text
source code
  + build definition
  + dependency graph
  + plugin graph
  + compiler/toolchain
  + generated sources
  + test environment
  + repository state
  + CI environment
  + signing/provenance policy
  + release process
  -> trusted artifact
```

Perbedaannya ada pada kedalaman diagnosis. Saat build gagal, engineer biasa bertanya:

```text
Error-nya apa?
```

Engineer kuat bertanya:

```text
Boundary mana yang berubah?
- source?
- dependency?
- plugin?
- JDK?
- compiler flags?
- repository metadata?
- cache?
- generated code?
- test runtime?
- CI environment?
- release policy?
```

---

## 2. Prinsip Inti: Build Adalah Kontrak, Bukan Script

Build script yang baik bukan sekadar kumpulan command. Build script adalah deklarasi kontrak:

```text
Diberikan source, konfigurasi, dependency, toolchain, dan environment yang sama,
build harus menghasilkan artifact yang sama atau gagal dengan alasan yang jelas.
```

Kontrak build punya beberapa lapisan:

| Lapisan | Pertanyaan Kunci |
|---|---|
| Source contract | Source mana yang masuk build? |
| Dependency contract | Library mana, versi mana, dari repository mana? |
| Toolchain contract | JDK/compiler/tool mana yang dipakai? |
| Task/lifecycle contract | Step apa yang berjalan dan urutannya bagaimana? |
| Quality contract | Test/static analysis/security gate apa yang wajib lulus? |
| Artifact contract | Artifact apa yang dihasilkan dan metadata-nya apa? |
| Release contract | Artifact ini immutable, signed, traceable, dan promotable atau tidak? |
| Runtime contract | Artifact ini kompatibel dengan runtime target atau tidak? |

Jika build tidak punya kontrak eksplisit, maka organisasi akan mengandalkan kebiasaan, tribal knowledge, dan “yang penting jalan di laptop saya”.

---

## 3. Invariant Utama Build Engineering

Invariant adalah aturan yang harus tetap benar meskipun project membesar, dependency berubah, atau team bertambah.

### 3.1 Invariant Reproducibility

Artifact release harus bisa ditelusuri kembali ke:

- commit source;
- versi dependency;
- versi plugin;
- versi JDK;
- konfigurasi build;
- CI run;
- hasil test;
- hasil scan;
- metadata release.

Minimal invariant:

```text
Release artifact tidak boleh dibangun dari laptop developer.
```

Lebih kuat:

```text
Release artifact hanya boleh berasal dari CI trusted runner, menggunakan pinned toolchain,
pinned plugin, pinned dependency, normalized timestamp, signed artifact, SBOM, dan provenance.
```

Maven sendiri mendefinisikan reproducible build sebagai kemampuan menghasilkan artifact bit-by-bit identical dari source code, build environment, dan instruksi build yang sama. Ini bukan kosmetik; ini fondasi audit dan supply-chain integrity.

### 3.2 Invariant Dependency

Dependency graph harus:

- eksplisit;
- bisa dijelaskan;
- dikontrol versi-nya;
- bisa di-debug;
- tidak bergantung pada dynamic version di release;
- tidak mengambil artifact dari repository sembarang;
- tidak membawa dependency runtime yang tidak dipahami.

Minimal invariant:

```text
Tidak ada dependency tanpa alasan ownership.
```

Artinya, setiap dependency penting harus jelas:

- kenapa dipakai;
- siapa pemiliknya;
- scope/configuration-nya apa;
- update policy-nya bagaimana;
- risiko security/license-nya apa;
- apakah dependency itu masuk compile, runtime, test, atau annotation processing.

### 3.3 Invariant Java Compatibility

Untuk Java 8–25, build harus membedakan:

```text
JDK yang menjalankan build != JDK yang dipakai compile != JDK runtime target
```

Contoh masalah klasik:

```text
Code dikompilasi di JDK 21 dengan target 8,
tetapi tanpa --release 8,
sehingga tidak sengaja memakai API yang tidak ada di Java 8.
```

Invariant yang lebih benar:

```text
Jika target runtime Java 8, compile harus memakai --release 8 atau toolchain valid yang menjamin API compatibility.
```

### 3.4 Invariant CI

CI bukan formalitas. CI adalah environment canonical.

Invariant:

```text
Build yang tidak bisa direproduksi di CI belum layak disebut reliable.
```

Local build boleh lebih cepat dan lebih permisif, tetapi release build harus:

- clean;
- pinned;
- auditable;
- deterministic;
- punya artifact evidence;
- punya test/security/quality report;
- tidak bergantung pada state lokal.

### 3.5 Invariant Release

Release artifact harus immutable.

Anti-invariant:

```text
Build ulang versi 1.2.3 dengan isi berbeda.
```

Ini berbahaya karena:

- audit rusak;
- rollback tidak jelas;
- debugging produksi ambigu;
- downstream consumer tidak bisa percaya artifact;
- checksum dan SBOM kehilangan makna.

Invariant:

```text
Versi release yang sudah dipublish tidak boleh berubah.
Jika ada perbaikan, buat versi baru.
```

---

## 4. Mental Model Paling Penting: Build sebagai Graph

Hampir semua masalah build bisa dipahami sebagai masalah graph.

### 4.1 Dependency Graph

```text
application
 ├─ spring-web
 │   ├─ spring-core
 │   └─ jackson-databind
 ├─ internal-common
 │   └─ guava
 └─ keycloak-spi-extension
     └─ keycloak-server-spi
```

Pertanyaan top-level:

- dependency mana direct?
- dependency mana transitive?
- versi mana yang menang?
- classpath mana yang terkena?
- dependency masuk compile atau runtime?
- dependency hanya untuk test atau ikut artifact?
- ada duplicate classes?
- ada split package?
- ada Java version mismatch?

### 4.2 Task Graph

Gradle sangat eksplisit sebagai task graph:

```text
compileJava
  -> processResources
  -> classes
  -> test
  -> jar
  -> check
  -> build
```

Maven lebih lifecycle-oriented, tetapi tetap membentuk execution plan:

```text
validate -> compile -> test -> package -> verify -> install/deploy
```

Pertanyaan penting:

- task/phase mana yang menghasilkan output?
- input mana yang memengaruhi output?
- apakah task cacheable?
- apakah output deterministic?
- apakah step ini boleh berjalan paralel?
- apakah step ini butuh external service?
- apakah step ini seharusnya ada di PR build atau release build saja?

### 4.3 Ownership Graph

Build besar tidak hanya teknis. Ada ownership graph:

```text
platform team owns:
  - corporate BOM
  - parent POM/convention plugin
  - repository policy
  - security baseline
  - CI template

service team owns:
  - service module
  - runtime config
  - domain tests
  - release readiness

security team owns:
  - vulnerability policy
  - waiver approval
  - SBOM/provenance requirements
```

Jika ownership graph tidak jelas, build governance akan menjadi bottleneck atau chaos.

---

## 5. Maven vs Gradle: Heuristic Cepat

### 5.1 Pilih Maven Jika

Maven lebih cocok ketika:

- organisasi butuh standardisasi tinggi;
- project mengikuti lifecycle Java/Jakarta/Spring umum;
- banyak engineer sudah familiar dengan Maven;
- governance parent POM/BOM cukup untuk kebutuhan;
- build logic tidak terlalu custom;
- auditability lebih penting daripada expressiveness;
- migrasi harus minim risiko;
- enterprise environment memakai Nexus/Artifactory dengan pattern Maven tradisional.

Heuristic:

```text
Jika build bisa dijelaskan sebagai lifecycle standar + plugin standar + dependency management,
Maven biasanya cukup dan lebih mudah distandardisasi.
```

### 5.2 Pilih Gradle Jika

Gradle lebih cocok ketika:

- build sangat besar dan perlu optimasi performa serius;
- banyak custom task/code generation;
- monorepo atau multi-project kompleks;
- perlu build cache/configuration cache;
- perlu variant-aware dependency management;
- perlu convention plugin yang expressive;
- banyak language/toolchain campuran;
- incremental build dan task modeling memberi nilai besar.

Heuristic:

```text
Jika build adalah graph kompleks yang perlu dimodelkan eksplisit,
Gradle biasanya lebih kuat.
```

### 5.3 Jangan Memilih Berdasarkan Hype

Pilihan buruk:

```text
Pakai Gradle karena modern.
Pakai Maven karena semua orang pakai.
```

Pilihan baik:

```text
Pakai Maven karena constraint governance, skill team, dan lifecycle standar cocok.
Pakai Gradle karena constraint graph, performance, dan custom build logic membutuhkan expressiveness.
```

---

## 6. Decision Matrix Maven vs Gradle

| Constraint | Maven Lebih Kuat | Gradle Lebih Kuat |
|---|---:|---:|
| Lifecycle Java standar | Sangat kuat | Cukup kuat |
| Enterprise standardization | Sangat kuat | Kuat jika convention plugin matang |
| Custom task graph | Terbatas | Sangat kuat |
| Build cache | Terbatas/native gap | Sangat kuat |
| Configuration performance tuning | Sederhana | Sangat advanced |
| Learning curve | Lebih rendah | Lebih tinggi |
| Plugin authoring | Stabil tapi verbose | Sangat expressive |
| Variant-aware dependency | Terbatas | Sangat kuat |
| Monorepo large-scale | Bisa, tapi berat | Lebih natural |
| Auditability | Kuat | Kuat jika governance rapi |
| Migration risk | Biasanya rendah untuk Java enterprise | Bisa tinggi jika team belum siap |

Kesimpulan playbook:

```text
Maven = standard lifecycle governance engine.
Gradle = programmable build graph engine.
```

---

## 7. Build Review Checklist: 15 Menit Pertama

Saat masuk ke project baru, jangan langsung edit POM/build.gradle. Lakukan observasi.

### 7.1 Pertanyaan Awal

1. Build tool apa dan versi berapa?
2. Apakah wrapper dipakai?
3. JDK apa yang menjalankan build?
4. Target runtime Java berapa?
5. Apakah dependency version dipusatkan?
6. Apakah plugin version dipin?
7. Apakah build bisa jalan offline setelah cache warm?
8. Apakah artifact release immutable?
9. Apakah CI build sama dengan local build?
10. Apakah ada dependency/security/quality report?
11. Apakah test dibagi unit/integration?
12. Apakah generated source masuk source control?
13. Apakah secrets masuk build file/log?
14. Apakah ada dynamic version/SNAPSHOT di release?
15. Apakah ada build scan/log/report yang bisa dianalisis?

### 7.2 Maven Commands

```bash
mvn -version
mvn help:effective-pom
mvn help:effective-settings
mvn dependency:tree
mvn dependency:analyze
mvn -DskipTests package
mvn clean verify
mvn -X -e clean verify
```

Untuk multi-module:

```bash
mvn -pl module-a -am test
mvn -pl module-a -amd test
mvn -rf :failed-module verify
```

### 7.3 Gradle Commands

```bash
./gradlew --version
./gradlew projects
./gradlew tasks
./gradlew dependencies
./gradlew dependencyInsight --dependency jackson-databind --configuration runtimeClasspath
./gradlew build --scan
./gradlew build --configuration-cache
./gradlew clean build --info
```

Untuk multi-project:

```bash
./gradlew :module-a:test
./gradlew :module-a:dependencies --configuration runtimeClasspath
./gradlew :module-a:dependencyInsight --dependency guava --configuration compileClasspath
```

---

## 8. Build Smell Catalog

### 8.1 Dependency Smells

| Smell | Dampak | Perbaikan |
|---|---|---|
| Dynamic version di release | Build tidak deterministic | Pin version/lock |
| Banyak exclusion acak | Graph tidak dipahami | Align dengan BOM/platform |
| Duplicate direct dependency | Confusion ownership | Centralize version management |
| Semua dependency pakai compile | Runtime/classpath bengkak | Scope/configuration hygiene |
| Test dependency leak ke runtime | Artifact berisiko | Pisahkan test/runtime classpath |
| javax dan jakarta campur | Runtime/class incompatibility | Pilih namespace strategy |
| Multiple logging bindings | Runtime warning/error | Satu backend logging |
| Annotation processor masuk runtime | Artifact kotor | Pakai annotationProcessor path |

### 8.2 Build Logic Smells

| Smell | Dampak | Perbaikan |
|---|---|---|
| Logic besar di root build file | Sulit maintain | Extract convention plugin |
| Copy-paste config antar module | Drift | Parent/convention plugin |
| Plugin tanpa version pin | Build berubah diam-diam | Pin/pluginManagement |
| Build tergantung local path | CI gagal | Model input/repository benar |
| Build download dari URL arbitrary | Supply-chain risk | Repository manager |
| Task selalu rerun | Lambat | Deklarasikan input/output |
| `clean build` selalu jadi default | Cache/incremental tidak dimanfaatkan | Gunakan incremental build |

### 8.3 CI Smells

| Smell | Dampak | Perbaikan |
|---|---|---|
| CI hanya menjalankan compile | Bug lolos | Minimal test + package smoke |
| Release dari laptop | Tidak auditable | Release dari CI trusted runner |
| Cache tanpa key benar | Flaky/poisoned build | Cache key berdasar lock/toolchain |
| Secret tampil di log | Incident security | Masking + least privilege |
| Artifact rebuilt per environment | Drift | Build once, promote same artifact |
| Tidak menyimpan reports | Diagnosis lemah | Archive reports |

---

## 9. Troubleshooting Playbook Universal

Saat build gagal, gunakan loop ini:

```text
1. Identify first meaningful failure.
2. Classify failure type.
3. Reduce scope.
4. Inspect graph.
5. Inspect environment.
6. Reproduce locally or in isolated CI.
7. Fix root cause, not symptom.
8. Add guardrail so failure does not recur silently.
```

### 9.1 First Meaningful Failure

Jangan langsung fokus ke error paling bawah. Banyak build menampilkan ratusan baris noise.

Cari:

- exception pertama;
- dependency resolution pertama yang gagal;
- class pertama yang tidak ditemukan;
- test pertama yang gagal karena setup;
- plugin execution pertama yang error.

### 9.2 Failure Taxonomy

| Failure Type | Gejala Umum |
|---|---|
| Dependency resolution | Could not resolve artifact, 401/403/404, checksum failed |
| Dependency conflict | NoSuchMethodError, ClassNotFoundException, duplicate class |
| Compiler | cannot find symbol, release version not supported |
| Annotation processor | generated class missing, processor not found |
| Test runtime | port conflict, flaky test, Testcontainers failure |
| Packaging | missing manifest, duplicate resource, invalid fat jar |
| Repository | metadata timeout, snapshot stale, proxy broken |
| Cache | stale output, inconsistent local/CI result |
| Toolchain | Unsupported class file major version |
| Environment | path/env var/locale/timezone/JDK mismatch |

### 9.3 Reduce Scope

Maven:

```bash
mvn -pl :module-name -am test
```

Gradle:

```bash
./gradlew :module-name:test --info
```

Tujuan reduce scope bukan mempercepat saja. Tujuannya adalah mengisolasi graph.

---

## 10. Dependency Governance Playbook

### 10.1 Rule: Version Ownership Harus Jelas

Jangan biarkan versi dependency tersebar di puluhan module.

Maven:

- parent POM untuk plugin/config umum;
- BOM untuk dependency version alignment;
- `dependencyManagement` untuk central version policy;
- Enforcer untuk rule.

Gradle:

- version catalog untuk alias dan versi;
- platform/java-platform untuk alignment;
- convention plugin untuk standard config;
- dependency locking dan verification untuk release integrity.

### 10.2 Rule: Update Dependency adalah Change, Bukan Routine Noise

Dependency update bisa memengaruhi:

- binary compatibility;
- behavior runtime;
- transitive dependency;
- security posture;
- performance;
- license;
- Java baseline.

Minimal update process:

```text
dependency update PR
  -> dependency diff
  -> compile/test
  -> affected integration test
  -> security scan
  -> runtime smoke test
  -> release notes check jika major/minor penting
```

### 10.3 Rule: Exclusion Harus Punya Alasan

Exclusion adalah operasi bedah dependency graph.

Komentar yang baik:

```xml
<exclusion>
  <!-- Excluded because runtime uses logback as the single SLF4J provider. -->
  <groupId>org.slf4j</groupId>
  <artifactId>slf4j-simple</artifactId>
</exclusion>
```

Komentar buruk:

```xml
<!-- fix build -->
```

---

## 11. Java 8–25 Playbook

### 11.1 Bedakan Empat Angka Versi

| Jenis Versi | Makna |
|---|---|
| Build JDK | JDK yang menjalankan Maven/Gradle |
| Compile release | API dan bytecode target saat compile |
| Test JDK | JDK yang menjalankan test |
| Runtime JDK | JDK tempat artifact berjalan |

Contoh strategi library:

```text
Build JDK: 21 atau 25
Compile release: 8 atau 11
Test matrix: 8, 11, 17, 21, 25
Runtime target: tergantung consumer
```

Contoh strategi application modern:

```text
Build JDK: 21 atau 25
Compile release: 21
Test JDK: 21 + smoke 25
Runtime JDK: 21 LTS atau 25 LTS sesuai policy
```

### 11.2 Jangan Salah Memakai `source`/`target`

Jika target runtime Java lama, gunakan `--release` jika memungkinkan.

Maven:

```xml
<configuration>
  <release>8</release>
</configuration>
```

Gradle:

```kotlin
tasks.withType<JavaCompile>().configureEach {
    options.release.set(8)
}
```

### 11.3 Class File Version Error

Gejala:

```text
Unsupported class file major version 65
```

Artinya runtime/tool membaca class file dari Java yang lebih baru daripada yang didukung.

Diagnosis:

```bash
javap -verbose SomeClass.class | grep "major"
```

Mapping umum:

| Java | Major Version |
|---:|---:|
| 8 | 52 |
| 11 | 55 |
| 17 | 61 |
| 21 | 65 |
| 25 | 69 |

---

## 12. Reproducibility Playbook

### 12.1 Minimum Controls

Maven:

```xml
<properties>
  <project.build.outputTimestamp>${git.commit.time}</project.build.outputTimestamp>
</properties>
```

Gradle:

```kotlin
tasks.withType<AbstractArchiveTask>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}
```

Build controls:

- wrapper committed;
- plugin versions pinned;
- dependency versions pinned/managed;
- no dynamic versions in release;
- no local filesystem dependency;
- timestamp normalized;
- generated code deterministic;
- CI release runner controlled;
- artifact checksum stored;
- SBOM generated;
- release metadata attached.

### 12.2 Stronger Controls

- Gradle dependency verification;
- dependency locking;
- Maven checksum policy and repository manager enforcement;
- containerized CI build image;
- signed artifact;
- provenance attestation;
- reproducibility verification job;
- artifact promotion instead of rebuild.

---

## 13. Security Playbook

### 13.1 Build Threat Model

Build can be attacked through:

- malicious dependency;
- compromised transitive dependency;
- malicious plugin;
- dependency confusion;
- poisoned repository;
- leaked CI token;
- tampered artifact;
- unsafe generated code;
- compromised base image;
- weak release process.

### 13.2 Minimum Security Gate

```text
PR build:
  - compile
  - unit test
  - dependency vulnerability scan with reasonable threshold
  - static analysis

main build:
  - full test
  - integration test
  - SBOM
  - dependency report

release build:
  - clean environment
  - pinned dependency/toolchain
  - SBOM
  - vulnerability scan
  - artifact signing
  - checksum
  - provenance/release metadata
```

### 13.3 Waiver Governance

Security waiver harus punya:

- CVE/advisory ID;
- affected component;
- reason;
- compensating control;
- owner;
- expiry date;
- approval;
- tracking ticket.

Waiver tanpa expiry adalah technical debt yang disamarkan.

---

## 14. Performance Playbook

### 14.1 Jangan Optimasi Sebelum Mengukur

Kumpulkan baseline:

- clean build time;
- warm build time;
- incremental build time;
- test time;
- dependency resolution time;
- cache hit rate;
- configuration time;
- slowest module/task;
- flaky test rate.

### 14.2 Maven Performance Levers

```bash
mvn -T 1C clean verify
mvn -pl :module-a -am test
mvn -DskipTests package
mvn -DskipITs verify
```

Gunakan hati-hati:

- parallel reactor;
- split unit/integration test;
- reduce plugin executions;
- avoid unnecessary aggregation in every PR;
- cache local repository di CI dengan key benar.

### 14.3 Gradle Performance Levers

```bash
./gradlew build --parallel
./gradlew build --build-cache
./gradlew build --configuration-cache
./gradlew :module-a:test
```

Optimasi utama:

- configuration avoidance;
- Provider API;
- build cache;
- configuration cache;
- incremental task inputs/outputs;
- test parallelization;
- avoid `allprojects/subprojects` heavy config;
- convention plugins.

### 14.4 Performance Invariant

```text
Build cepat yang salah lebih buruk daripada build lambat yang benar.
```

Urutan prioritas:

```text
correctness -> reproducibility -> security -> observability -> performance
```

Tetapi setelah correctness ada, performance menjadi faktor produktivitas besar.

---

## 15. CI/CD Playbook

### 15.1 Pipeline sebagai State Machine

```text
PR_CREATED
  -> VALIDATING
  -> TESTING
  -> QUALITY_CHECKING
  -> MERGEABLE

MAIN_COMMIT
  -> BUILDING
  -> VERIFYING
  -> PUBLISHING_SNAPSHOT

RELEASE_REQUESTED
  -> LOCKED
  -> CLEAN_BUILD
  -> FULL_VERIFY
  -> SIGN
  -> PUBLISH
  -> PROMOTE
  -> RELEASED
```

### 15.2 Build Once, Promote Same Artifact

Anti-pattern:

```text
build dev artifact
build staging artifact
build prod artifact
```

Pattern:

```text
build once -> publish artifact -> deploy same artifact to dev/staging/prod with external config
```

### 15.3 CI Cache Policy

Cache boleh mempercepat build, tetapi tidak boleh menjadi sumber kebenaran.

Good cache keys include:

- OS;
- JDK version;
- build tool version;
- dependency lock/checksum files;
- build scripts;
- plugin versions.

Release build sebaiknya bisa berjalan clean tanpa bergantung pada cache lama.

---

## 16. Release Playbook

### 16.1 Release Checklist

Sebelum release:

- version final, bukan SNAPSHOT;
- changelog siap;
- dependency graph stabil;
- test full pass;
- vulnerability scan acceptable;
- SBOM generated;
- artifact signed;
- checksum stored;
- tag created;
- release metadata stored;
- rollback strategy jelas.

### 16.2 Versioning Heuristics

| Change Type | Version Impact |
|---|---|
| Bug fix backward-compatible | Patch |
| Feature backward-compatible | Minor |
| API breaking change | Major |
| Java baseline naik | Biasanya major untuk library |
| Dependency major affecting API | Bisa major |
| Internal implementation only | Patch/minor tergantung risk |

### 16.3 Snapshot Discipline

SNAPSHOT boleh untuk integration cepat, tetapi jangan menjadi runtime dependency produksi.

Invariant:

```text
Production deployment references immutable release version.
```

---

## 17. Plugin Governance Playbook

### 17.1 Plugin adalah Code Execution

Maven/Gradle plugin bukan metadata pasif. Plugin mengeksekusi code saat build.

Risikonya:

- bisa membaca environment;
- bisa mengakses file;
- bisa membuka network;
- bisa menulis output;
- bisa mencetak secret;
- bisa mengubah artifact.

Maka plugin harus diperlakukan seperti dependency runtime dengan trust boundary.

### 17.2 Plugin Review Checklist

- sumber plugin resmi?
- maintainer aktif?
- versi dipin?
- transitive dependency plugin dipahami?
- plugin berjalan di phase/task mana?
- plugin butuh network?
- plugin compatible dengan JDK/build tool?
- plugin output deterministic?
- plugin compatible dengan Gradle configuration cache jika Gradle?
- plugin safe untuk parallel build?

---

## 18. Multi-Module Architecture Playbook

### 18.1 Module Boundary Rules

Module baik punya:

- purpose jelas;
- owner jelas;
- dependency direction jelas;
- public API minimal;
- test strategy jelas;
- artifact identity jelas.

Module buruk:

- bernama `common` tetapi berisi semuanya;
- saling circular;
- semua module depend ke semua module;
- API module leak implementation dependency;
- test fixture masuk production dependency;
- generated code campur manual code tanpa boundary.

### 18.2 Dependency Direction

Contoh layering:

```text
runtime/app
  -> adapter-web
  -> adapter-persistence
  -> application
  -> domain
```

Domain tidak boleh depend ke adapter.

Jika build graph melanggar dependency direction, arsitektur juga biasanya sudah bocor.

---

## 19. Observability Playbook

### 19.1 Build Health Dashboard

Metric penting:

| Metric | Kenapa Penting |
|---|---|
| PR build duration | Developer feedback loop |
| Main build duration | Delivery throughput |
| Release build duration | Release predictability |
| Failure rate | Build reliability |
| Flaky test rate | Trust terhadap CI |
| Cache hit rate | Performance effectiveness |
| Dependency age | Security/maintenance risk |
| Vulnerability count | Supply-chain risk |
| Waiver count | Risk acceptance tracking |
| Artifact reproducibility status | Audit confidence |

### 19.2 Report Retention

Simpan:

- test reports;
- coverage reports;
- static analysis reports;
- dependency tree/report;
- SBOM;
- vulnerability report;
- artifact checksums;
- release notes;
- provenance metadata.

Tanpa evidence, release hanya klaim.

---

## 20. Migration Playbook

### 20.1 Migration Invariants

Saat migrasi build tool atau Java version, jaga invariant:

```text
artifact identity sama atau perubahan diketahui;
dependency graph sama atau perubahan diketahui;
test behavior sama atau perubahan diketahui;
runtime behavior sama atau perubahan diketahui;
release process tidak kehilangan auditability.
```

### 20.2 Maven → Gradle

Validasi:

- dependency tree equivalent;
- generated sources equivalent;
- test task equivalent;
- artifact layout equivalent;
- publishing metadata equivalent;
- CI command equivalent;
- release process equivalent.

### 20.3 Gradle → Maven

Perhatikan hilangnya:

- variant-aware model;
- custom task graph flexibility;
- build cache semantics;
- convention plugin expressiveness;
- composite build substitution.

Migrasi balik ke Maven bisa benar jika organisasi lebih membutuhkan standardization daripada advanced graph modeling.

### 20.4 Java 8 → 25

Migrasi besar harus bertahap:

```text
1. Stabilkan build di Java 8.
2. Pin dependency dan plugin.
3. Tambah test matrix.
4. Naikkan build JDK dulu jika aman.
5. Fix illegal reflective access / removed APIs.
6. Update dependency yang tidak compatible.
7. Naikkan runtime target.
8. Baru gunakan language features baru.
```

---

## 21. Anti-Pattern Paling Mahal

### 21.1 “Clean Build Always”

Selalu menjalankan `clean` menghapus manfaat incremental build dan cache.

Gunakan `clean` untuk:

- release verification tertentu;
- troubleshooting;
- baseline benchmark;
- suspected stale output.

Jangan jadikan `clean` sebagai refleks harian jika build system sudah benar.

### 21.2 “Just Exclude It”

Exclusion tanpa memahami graph bisa menyembunyikan problem.

Lebih baik:

1. lihat dependency tree;
2. pahami kenapa dependency masuk;
3. align versi dengan BOM/platform;
4. exclude hanya jika memang dependency tidak valid;
5. tambahkan komentar.

### 21.3 “One Common Module to Rule Them All”

`common` sering menjadi tempat pembuangan:

- util;
- DTO;
- constants;
- persistence helper;
- security helper;
- web helper;
- test helper;
- integration client.

Akibat:

- dependency menyebar;
- compile classpath bengkak;
- perubahan kecil memicu rebuild besar;
- boundary domain hilang.

### 21.4 “Environment-Specific Artifact”

Artifact berbeda untuk dev/staging/prod membuat release tidak auditable.

Lebih baik:

```text
same artifact + environment-specific runtime configuration
```

### 21.5 “Build Script as Dumping Ground”

Build script bukan tempat semua logic.

Jika logic:

- dipakai banyak module;
- butuh test;
- punya state;
- punya input/output;
- memengaruhi release/security;

maka ekstrak menjadi plugin/convention.

---

## 22. Senior-Level Heuristics

### 22.1 Jika Build Lambat

Tanya:

1. Lambat di configuration atau execution?
2. Lambat di compile atau test?
3. Lambat karena dependency resolution?
4. Lambat karena generated code?
5. Lambat karena integration test?
6. Lambat karena no cache?
7. Lambat karena semua module dibuild?
8. Lambat karena task tidak deklarasi input/output?

### 22.2 Jika Build Flaky

Tanya:

1. Apakah test tergantung waktu?
2. Apakah test tergantung urutan?
3. Apakah port fixed?
4. Apakah external service unstable?
5. Apakah shared database tidak isolated?
6. Apakah parallel test unsafe?
7. Apakah cache menyimpan output yang tidak valid?
8. Apakah dependency SNAPSHOT berubah?

### 22.3 Jika Build Berbeda Local vs CI

Tanya:

1. JDK sama?
2. Maven/Gradle sama?
3. OS sama?
4. Locale/timezone sama?
5. Environment variables sama?
6. Repository credential sama?
7. Cache state sama?
8. Generated sources sama?
9. Test data sama?
10. Command sama?

### 22.4 Jika Runtime Error Setelah Build Sukses

Tanya:

1. Compile classpath beda dari runtime classpath?
2. Dependency scope salah?
3. Dependency version conflict?
4. Provided dependency hilang di runtime?
5. Shaded dependency conflict?
6. Java baseline mismatch?
7. Container/app server menyediakan library berbeda?
8. Multi-release JAR behavior berbeda?

---

## 23. Practical Enterprise Blueprint

### 23.1 Maven Enterprise Blueprint

```text
corporate-parent-pom
  - pluginManagement
  - compiler policy
  - surefire/failsafe policy
  - reproducible build timestamp
  - enforcer rules
  - repository policy reference

corporate-bom
  - approved dependency versions
  - security overrides
  - platform alignment

service-parent
  - service-specific plugin config
  - codegen config
  - packaging config

service modules
  - app
  - domain
  - application
  - adapter-web
  - adapter-persistence
  - test-fixtures
```

### 23.2 Gradle Enterprise Blueprint

```text
settings.gradle.kts
  - pluginManagement
  - dependencyResolutionManagement
  - repository policy
  - version catalog

build-logic/
  - java-conventions
  - spring-service-conventions
  - quality-conventions
  - security-conventions
  - publishing-conventions

platform/
  - java-platform dependency constraints

modules/
  - domain
  - application
  - adapter-web
  - adapter-persistence
  - app
```

### 23.3 CI Blueprint

```text
PR:
  - affected compile
  - unit test
  - static analysis fast
  - dependency policy check

Main:
  - full build
  - integration test
  - coverage
  - SBOM
  - publish snapshot/internal candidate

Release:
  - clean build
  - full verification
  - security scan
  - sign
  - publish immutable artifact
  - provenance
  - promote
```

---

## 24. Final Top 1% Checklist

Gunakan checklist ini untuk menilai build system.

### 24.1 Correctness

- [ ] Build berhasil dari clean checkout.
- [ ] Build berhasil di CI canonical environment.
- [ ] Test lifecycle jelas.
- [ ] Integration test tidak tercampur sembarangan dengan unit test.
- [ ] Runtime classpath dipahami.
- [ ] Artifact packaging sesuai runtime target.

### 24.2 Dependency Control

- [ ] Dependency versions centralized.
- [ ] Plugin versions pinned.
- [ ] No dynamic versions in release.
- [ ] Dependency tree bisa dijelaskan.
- [ ] Exclusion terdokumentasi.
- [ ] BOM/platform digunakan dengan sadar.
- [ ] Java baseline dependency dicek.

### 24.3 Reproducibility

- [ ] Wrapper committed.
- [ ] Toolchain pinned.
- [ ] Timestamp normalized.
- [ ] Generated code deterministic.
- [ ] Release build clean and auditable.
- [ ] Artifact checksum stored.
- [ ] Build metadata stored.

### 24.4 Security

- [ ] Repository allowlist.
- [ ] Credentials tidak masuk source/log.
- [ ] Dependency vulnerability scan.
- [ ] SBOM generated.
- [ ] Artifact signed jika release policy membutuhkan.
- [ ] Waiver punya owner dan expiry.
- [ ] Plugin trust policy ada.

### 24.5 Performance

- [ ] Build time measured.
- [ ] Slowest tasks/modules known.
- [ ] Incremental build efektif.
- [ ] Cache policy aman.
- [ ] Unit/integration tests dipisah.
- [ ] Multi-module affected build digunakan jika worth it.

### 24.6 Governance

- [ ] Parent/convention plugin jelas.
- [ ] Corporate BOM/platform jelas.
- [ ] Exception process ada.
- [ ] Ownership module jelas.
- [ ] Release process documented.
- [ ] Migration strategy documented.

### 24.7 Observability

- [ ] Test reports archived.
- [ ] Dependency reports available.
- [ ] Security reports available.
- [ ] Build failure trend visible.
- [ ] Flaky tests tracked.
- [ ] Release evidence retained.

---

## 25. Cara Berpikir Akhir

Build engineering yang kuat selalu kembali ke beberapa pertanyaan:

```text
Apa input-nya?
Apa output-nya?
Apa graph-nya?
Apa boundary-nya?
Apa invariant-nya?
Apa failure mode-nya?
Apa evidence-nya?
Apa policy-nya?
Apa trade-off-nya?
```

Jika Anda bisa menjawab pertanyaan itu untuk Maven/Gradle project besar, Anda bukan lagi sekadar pengguna build tool. Anda sudah berpikir sebagai engineer yang mampu mendesain sistem build yang reliable, scalable, secure, dan auditable.

---

## 26. Rangkuman Seri

Seri `learn-java-build-gradle-maven-engineering` telah membangun jalur pemahaman dari fondasi sampai playbook:

1. Build mental model.
2. Java 8–25 version strategy.
3. Maven core.
4. Gradle core.
5. Maven vs Gradle decision framework.
6. Project layout.
7. Dependency graph.
8. Version management.
9. Repository engineering.
10. Reproducibility.
11. Compiler engineering.
12. Testing pipeline.
13. Packaging.
14. Resource/profile/environment separation.
15. Plugin system.
16. Maven plugin engineering.
17. Gradle plugin engineering.
18. Performance.
19. CI/CD architecture.
20. Release engineering.
21. Security.
22. Enterprise governance.
23. Multi-module architecture.
24. Jakarta/Spring integration.
25. Code generation.
26. Static analysis.
27. Dependency conflict case studies.
28. Migration engineering.
29. Troubleshooting.
30. Advanced Gradle.
31. Advanced Maven.
32. Build observability.
33. Enterprise build topology.
34. Real-world case study.
35. Top 1% playbook.

---

## 27. References

- Apache Maven — Guides: https://maven.apache.org/guides/index.html
- Apache Maven — Introduction to the Build Lifecycle: https://maven.apache.org/guides/introduction/introduction-to-the-lifecycle.html
- Apache Maven — Configuring for Reproducible Builds: https://maven.apache.org/guides/mini/guide-reproducible-builds.html
- Gradle — Java Toolchains: https://docs.gradle.org/current/userguide/toolchains.html
- Gradle — Configuration Cache: https://docs.gradle.org/current/userguide/configuration_cache.html
- Gradle — Build Cache Performance: https://docs.gradle.org/current/userguide/build_cache_performance.html
- Gradle — Dependency Verification: https://docs.gradle.org/current/userguide/dependency_verification.html
- SLSA Specification: https://slsa.dev/spec/v1.2/
- SLSA Provenance: https://slsa.dev/spec/v0.1/provenance
- CycloneDX Maven Plugin: https://cyclonedx.github.io/cyclonedx-maven-plugin/
- CycloneDX Gradle Plugin: https://github.com/CycloneDX/cyclonedx-gradle-plugin

---

## 28. Status Seri

Seri **selesai**.

```text
[x] Part 0  — Build Engineering Mental Model
[x] Part 1  — Java Version Strategy: Java 8–25
[x] Part 2  — Maven Core Mental Model
[x] Part 3  — Gradle Core Mental Model
[x] Part 4  — Maven vs Gradle Decision Framework
[x] Part 5  — Project Layout Engineering
[x] Part 6  — Dependency Graph Fundamentals
[x] Part 7  — Dependency Version Management
[x] Part 8  — Repository Engineering
[x] Part 9  — Build Reproducibility
[x] Part 10 — Compiler Engineering
[x] Part 11 — Testing Build Pipeline
[x] Part 12 — Packaging Engineering
[x] Part 13 — Resource Processing, Filtering, Profiles, Properties, Environment Separation
[x] Part 14 — Plugin System Deep Dive
[x] Part 15 — Maven Advanced Plugin Engineering
[x] Part 16 — Gradle Advanced Plugin Engineering
[x] Part 17 — Performance Engineering
[x] Part 18 — CI/CD Build Architecture
[x] Part 19 — Release Engineering
[x] Part 20 — Security Engineering
[x] Part 21 — Enterprise Governance
[x] Part 22 — Multi-Module Architecture for Large Java Systems
[x] Part 23 — Jakarta/Spring/Enterprise Java Build Integration
[x] Part 24 — Code Generation Pipelines
[x] Part 25 — Static Analysis and Quality Gates
[x] Part 26 — Dependency Conflict Case Studies
[x] Part 27 — Migration Engineering
[x] Part 28 — Troubleshooting Build Failures
[x] Part 29 — Advanced Gradle
[x] Part 30 — Advanced Maven
[x] Part 31 — Build Observability
[x] Part 32 — Monorepo, Polyrepo, and Enterprise Build Topologies
[x] Part 33 — Real-World Case Study
[x] Part 34 — Top 1% Build Engineer Playbook
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./33-real-world-case-study-enterprise-java-platform-build-system.md">⬅️ Part 33 — Real-World Case Study: Designing Build System for Enterprise Java Platform</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
