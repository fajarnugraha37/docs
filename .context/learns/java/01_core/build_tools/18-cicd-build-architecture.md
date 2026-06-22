# Part 18 — CI/CD Build Architecture: Pipeline Design, Cache Strategy, Matrix Build, Release Promotion

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `18-cicd-build-architecture.md`  
> Scope: Java 8–25, Maven, Gradle, CI/CD, build pipeline, cache, artifact promotion, release gate, supply-chain boundary

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas performance build secara lokal maupun CI. Bagian ini naik satu level: **bagaimana merancang arsitektur CI/CD build** agar build bukan sekadar job otomatis, tetapi menjadi sistem yang:

1. cepat memberi feedback;
2. reproducible;
3. aman dari dependency/plugin/repository attack;
4. mampu membedakan snapshot, candidate, release, dan promoted artifact;
5. mendukung Java 8 sampai 25 tanpa environment drift;
6. mudah di-debug saat gagal;
7. cocok untuk enterprise multi-module/multi-service.

CI/CD build architecture adalah desain tentang **kapan build dijalankan, environment apa yang dipakai, cache apa yang boleh dipercaya, artifact mana yang boleh dipromosikan, dan gate mana yang harus memblokir perubahan**.

Mental model utama:

```text
CI/CD pipeline is not automation glue.
It is the enforcement layer between source code and trusted runtime artifact.
```

Kalau build lokal menjawab:

```text
Can this change work on my machine?
```

CI menjawab:

```text
Can this change work in a clean, governed, repeatable environment?
```

CD/release pipeline menjawab:

```text
Is this exact artifact trusted enough to be promoted to a real environment?
```

---

## 1. Apa Itu CI/CD Build Architecture?

CI/CD build architecture adalah susunan keputusan mengenai:

- pipeline stages;
- job dependency;
- trigger strategy;
- branch strategy;
- cache strategy;
- Java/toolchain strategy;
- Maven/Gradle command strategy;
- test staging;
- quality/security gates;
- artifact publishing;
- artifact promotion;
- secret/credential boundary;
- rollback/debugging workflow.

Pipeline yang buruk biasanya tampak seperti ini:

```text
checkout
run mvn clean install
build docker image
push image
deploy
```

Ini terlihat sederhana, tetapi menyembunyikan banyak masalah:

- semua test dicampur dalam satu stage;
- tidak jelas artifact mana yang dipercaya;
- cache mungkin tidak aman;
- release build mungkin berbeda dari PR build;
- dependency bisa berubah diam-diam;
- snapshot dan release tidak dibedakan;
- secrets bisa bocor ke log;
- deployment bisa rebuild ulang, bukan promote artifact yang sama.

Pipeline yang sehat biasanya memisahkan concern:

```text
Source Validation
  -> Build & Compile
  -> Unit Test
  -> Static Analysis
  -> Integration Test
  -> Package
  -> Security/SBOM/Provenance
  -> Publish Candidate Artifact
  -> Promote Artifact
  -> Deploy Artifact
  -> Verify Runtime
```

Prinsipnya:

```text
Build once. Verify many times. Promote the same artifact.
```

Bukan:

```text
Rebuild separately for each environment.
```

---

## 2. CI, CD, Release, dan Promotion: Jangan Dicampur

Istilah sering bercampur. Untuk build engineering, bedanya penting.

### 2.1 Continuous Integration

CI adalah proses otomatis untuk memastikan perubahan code bisa digabung dengan baseline utama.

CI fokus pada:

- compile;
- unit test;
- dependency validation;
- static analysis;
- fast integration test;
- packaging smoke test;
- feedback cepat ke developer.

CI bukan tempat ideal untuk:

- deploy ke production tanpa gate;
- melakukan manual release mutation;
- mengubah source code untuk release;
- menyimpan secret production terlalu luas.

### 2.2 Continuous Delivery

Continuous Delivery berarti artifact yang lolos pipeline selalu berada dalam kondisi siap deploy, meskipun deploy ke production bisa tetap manual/approval-based.

Fokusnya:

- artifact immutable;
- release candidate;
- environment promotion;
- deploy automation;
- rollback readiness;
- auditability.

### 2.3 Continuous Deployment

Continuous Deployment berarti perubahan yang lolos semua gate otomatis deploy ke production.

Ini hanya aman jika:

- test coverage pipeline matang;
- observability runtime matang;
- rollback cepat;
- feature flag siap;
- blast radius terkendali;
- approval manual memang tidak diperlukan.

Untuk enterprise/regulatory systems, sering lebih realistis memakai:

```text
Continuous Integration + Continuous Delivery + Controlled Production Promotion
```

bukan full continuous deployment.

### 2.4 Release vs Promotion

Release build menghasilkan artifact yang bisa dirilis.

Promotion memindahkan artifact yang sama dari satu trust level ke trust level berikutnya.

Contoh:

```text
commit abc123
  -> build artifact app-1.8.0-rc.3.jar
  -> publish to candidate repo
  -> deploy to DEV
  -> promote same artifact to UAT
  -> promote same artifact to PROD
```

Yang tidak boleh:

```text
DEV  : build app from branch develop
UAT  : rebuild app from branch release
PROD : rebuild app from tag
```

Karena itu menghasilkan tiga artifact berbeda yang kebetulan punya nama mirip.

---

## 3. Pipeline sebagai State Machine

Engineer advanced melihat pipeline sebagai state machine, bukan list step.

Contoh state:

```text
SOURCE_CHANGED
  -> CHECKOUT_OK
  -> BUILD_MODEL_VALID
  -> COMPILE_OK
  -> UNIT_TEST_OK
  -> STATIC_ANALYSIS_OK
  -> PACKAGE_OK
  -> INTEGRATION_TEST_OK
  -> SECURITY_GATE_OK
  -> ARTIFACT_PUBLISHED
  -> ARTIFACT_PROMOTED
  -> DEPLOYED
  -> RUNTIME_VERIFIED
```

Setiap transition punya invariant.

Contoh invariant:

| Transition | Invariant |
|---|---|
| `SOURCE_CHANGED -> CHECKOUT_OK` | commit immutable, branch known, shallow clone cukup/tidak cukup dipahami |
| `CHECKOUT_OK -> BUILD_MODEL_VALID` | Maven/Gradle wrapper valid, plugin versions pinned |
| `BUILD_MODEL_VALID -> COMPILE_OK` | Java toolchain sesuai, dependency resolved dari approved repo |
| `COMPILE_OK -> UNIT_TEST_OK` | unit test deterministic, tidak butuh external service |
| `UNIT_TEST_OK -> PACKAGE_OK` | artifact berisi metadata benar, tidak ada secret |
| `PACKAGE_OK -> SECURITY_GATE_OK` | vulnerability/license/SBOM policy terpenuhi |
| `SECURITY_GATE_OK -> ARTIFACT_PUBLISHED` | artifact immutable, checksum/signature tersedia |
| `ARTIFACT_PUBLISHED -> ARTIFACT_PROMOTED` | artifact yang sama, tidak rebuild |

Dengan state machine, debugging menjadi lebih mudah:

```text
Failure is a broken transition, not a random pipeline error.
```

---

## 4. Golden Rule: Build Once, Promote Same Artifact

Salah satu prinsip paling penting:

```text
Never rebuild for each environment when the goal is release confidence.
```

Kenapa?

Karena rebuild membuka variasi:

- dependency bisa resolve berbeda;
- plugin bisa resolve berbeda;
- timestamp berbeda;
- generated code berbeda;
- resource filtering berbeda;
- environment variable berbeda;
- JDK patch berbeda;
- repository cache berbeda.

Ideal release flow:

```text
Source commit
  -> CI builds binary artifact
  -> CI attaches metadata/checksum/SBOM
  -> artifact stored in repository
  -> deploy pipeline pulls exact artifact
  -> environment-specific config injected outside artifact
```

Untuk aplikasi container:

```text
Source commit
  -> build JAR
  -> build container image containing exact JAR
  -> sign image / generate SBOM
  -> push image digest
  -> deploy by digest, not mutable tag
```

Yang harus dihindari:

```text
kubectl apply image: app:latest
```

Lebih baik:

```text
image: registry.company.com/app@sha256:<digest>
```

atau minimal:

```text
image: registry.company.com/app:1.8.0-rc.3+abc123
```

Tetapi digest tetap lebih kuat daripada tag.

---

## 5. Pipeline Stage Design

Pipeline besar sebaiknya dipisah berdasarkan feedback value dan cost.

### 5.1 Stage 1 — Source and Build Metadata Validation

Tujuan: memastikan pipeline tahu apa yang sedang dibangun.

Validasi:

- branch;
- commit SHA;
- tag;
- PR number;
- actor;
- build number;
- Maven/Gradle wrapper;
- Java version;
- repository source;
- changed files;
- build script changes.

Contoh metadata yang harus dicetak di awal pipeline:

```text
Commit      : abc1234
Branch      : feature/payment-timeout
Build       : 2026.06.17.1182
Java runtime: Temurin 21.0.x
Build tool  : Maven 3.9.x / Gradle 9.x
OS          : linux-amd64
```

Ini penting untuk debugging. Banyak pipeline gagal karena environment tidak jelas.

### 5.2 Stage 2 — Build Model Validation

Untuk Maven:

```bash
mvn -B -ntp help:effective-pom
mvn -B -ntp validate
```

Untuk Gradle:

```bash
./gradlew help --warning-mode=all
./gradlew projects
./gradlew tasks --all
```

Validasi penting:

- plugin versions pinned;
- no dynamic versions;
- repository only approved;
- wrapper checksum valid;
- no local file dependencies;
- no secret in build files;
- no environment-specific artifact mutation.

### 5.3 Stage 3 — Compile

Compile harus berjalan sebelum test mahal.

Maven:

```bash
mvn -B -ntp -DskipTests compile test-compile
```

Gradle:

```bash
./gradlew classes testClasses
```

Compile gate menangkap:

- syntax error;
- bytecode mismatch;
- annotation processor error;
- missing generated source;
- dependency API mismatch;
- Java release mismatch.

### 5.4 Stage 4 — Unit Test

Unit test harus cepat, deterministic, dan tidak membutuhkan service eksternal.

Maven:

```bash
mvn -B -ntp test
```

Gradle:

```bash
./gradlew test
```

Policy:

- no real database;
- no real HTTP service;
- no time-dependent flakiness;
- no test ordering dependency;
- fixed timezone/locale jika perlu;
- reports always uploaded.

### 5.5 Stage 5 — Static Analysis and Quality Gate

Contoh:

- Checkstyle;
- PMD;
- SpotBugs;
- Error Prone;
- ArchUnit;
- JaCoCo coverage;
- forbidden APIs;
- duplicate class check;
- dependency convergence.

Maven:

```bash
mvn -B -ntp verify -DskipITs
```

Gradle:

```bash
./gradlew check
```

Catatan: `verify` Maven sering berisi banyak plugin tambahan. Pastikan tidak diam-diam menjalankan integration test mahal kalau stage ini dimaksudkan cepat.

### 5.6 Stage 6 — Package

Package menghasilkan artifact.

Maven:

```bash
mvn -B -ntp package -DskipTests
```

Gradle:

```bash
./gradlew assemble
```

Package stage harus memvalidasi:

- manifest;
- artifact name;
- version;
- classifier;
- reproducible timestamp;
- no secrets;
- resource filtering benar;
- executable jar bisa start minimal;
- WAR punya dependency provided benar.

### 5.7 Stage 7 — Integration Test

Integration test mahal sebaiknya dipisah.

Maven:

```bash
mvn -B -ntp verify -DskipUnitTests
```

Gradle:

```bash
./gradlew integrationTest
```

Integration test bisa menggunakan:

- Testcontainers;
- local database container;
- WireMock;
- embedded service;
- ephemeral environment.

Policy penting:

```text
Integration test may use controlled external-like systems.
It must not depend on unstable shared development services unless explicitly designed as environment test.
```

### 5.8 Stage 8 — Security and Supply Chain Gate

Gate ini memeriksa:

- dependency vulnerability;
- license;
- dependency verification;
- SBOM;
- secret scan;
- container scan;
- artifact signing;
- provenance;
- allowed repository;
- plugin trust.

Untuk Gradle, dependency verification dapat memverifikasi checksum/signature dependency melalui metadata file. Untuk Maven, checksum/signature/repository policy biasanya dikombinasikan dengan repository manager, enforcer, dependency-check, dan artifact signing.

### 5.9 Stage 9 — Publish Candidate Artifact

Artifact yang lolos gate dipublish ke repository.

Maven:

```bash
mvn -B -ntp deploy -DskipTests
```

Gradle:

```bash
./gradlew publish
```

Bedakan repository:

```text
snapshots/
candidates/
releases/
```

atau:

```text
maven-snapshots
maven-staging
maven-releases
```

### 5.10 Stage 10 — Deploy and Runtime Verification

Deploy stage harus mengambil artifact yang sudah dipublish.

Tidak boleh rebuild.

Validasi setelah deploy:

- health endpoint;
- startup log;
- DB migration status;
- smoke API;
- metrics emitted;
- no crash loop;
- no classpath error;
- no missing config.

---

## 6. Branch, PR, Main, Release: Pipeline Tidak Harus Sama

Pipeline berbeda boleh memiliki coverage berbeda.

### 6.1 Pull Request Pipeline

Tujuan: feedback cepat dan aman sebelum merge.

Biasanya menjalankan:

- build model validation;
- compile;
- unit test;
- static analysis cepat;
- affected module build;
- selected integration test;
- dependency/security quick scan.

Jangan terlalu lambat sampai developer menunggu berjam-jam untuk setiap PR kecil.

### 6.2 Main Branch Pipeline

Tujuan: menjaga baseline utama selalu sehat.

Biasanya menjalankan:

- full compile;
- full unit test;
- full integration test;
- coverage;
- quality gate;
- package;
- publish snapshot/candidate;
- optional deploy to DEV.

### 6.3 Nightly Pipeline

Tujuan: menjalankan test mahal yang tidak cocok di PR.

Contoh:

- full matrix Java 8/11/17/21/25;
- long integration test;
- mutation testing;
- dependency update simulation;
- performance benchmark;
- container image scan;
- flaky test detection.

### 6.4 Release Pipeline

Tujuan: menghasilkan artifact release/promotable.

Biasanya:

- checkout tag/release commit;
- clean environment;
- no uncommitted changes;
- locked dependencies;
- full tests;
- security gate;
- SBOM;
- sign artifact;
- publish immutable release;
- create release notes;
- promote artifact.

---

## 7. Maven CI Command Strategy

Maven sering disalahgunakan di CI karena command terlalu besar atau terlalu kabur.

### 7.1 Common Maven Flags

```bash
mvn -B -ntp clean verify
```

Makna:

- `-B`: batch mode, cocok untuk CI;
- `-ntp`: no transfer progress, log lebih bersih;
- `clean`: hapus output lama;
- `verify`: jalankan lifecycle sampai verify.

Namun `clean verify` tidak selalu ideal untuk semua job.

Untuk PR cepat:

```bash
mvn -B -ntp verify -DskipITs
```

Untuk integration test:

```bash
mvn -B -ntp verify -DskipUnitTests=false
```

Untuk module tertentu:

```bash
mvn -B -ntp -pl service-order -am verify
```

Makna:

- `-pl service-order`: build project list tertentu;
- `-am`: also make dependencies yang dibutuhkan.

Untuk resume setelah failure:

```bash
mvn -B -ntp -rf :failed-module verify
```

### 7.2 Maven Snapshot vs Release in CI

SNAPSHOT cocok untuk main/develop branch internal.

Release artifact harus:

- version final;
- immutable;
- tagged;
- signed jika perlu;
- deployed ke release repository;
- tidak overwrite.

Maven CI-friendly versions mendukung placeholder seperti `${revision}`, `${sha1}`, dan `${changelist}` untuk memudahkan version injection di CI.

Contoh:

```xml
<version>${revision}${changelist}</version>

<properties>
  <revision>1.8.0</revision>
  <changelist>-SNAPSHOT</changelist>
</properties>
```

CI release:

```bash
mvn -B -ntp deploy -Drevision=1.8.0 -Dchangelist=
```

CI snapshot:

```bash
mvn -B -ntp deploy -Drevision=1.8.0 -Dchangelist=-SNAPSHOT
```

### 7.3 Maven Local Repository in CI

Default local repo:

```text
~/.m2/repository
```

Dalam CI, cache ini harus diperlakukan hati-hati.

Aman untuk cache dependency download, tetapi jangan menganggap cache sebagai source of truth.

Praktik baik:

```bash
mvn -B -ntp -Dmaven.repo.local=$CI_WORKSPACE/.m2/repository verify
```

Lalu cache key berdasarkan:

- OS;
- Java version;
- Maven version;
- hash `pom.xml`/parent/BOM;
- hash `settings.xml` jika relevant.

Jangan cache `target/` sebagai dependency cache umum.

### 7.4 Maven Parallel Build

```bash
mvn -B -ntp -T 1C verify
```

`-T 1C` berarti thread per core.

Risiko:

- plugin tidak thread-safe;
- integration test port collision;
- shared file output collision;
- flaky test meningkat;
- DB container conflict.

Parallel build cocok setelah plugin/test dicek thread safety.

---

## 8. Gradle CI Command Strategy

Gradle lebih graph-aware dan cache-aware, sehingga command strategy sangat penting.

### 8.1 Common Gradle Flags

```bash
./gradlew build --no-daemon
```

Di CI ephemeral, `--no-daemon` sering digunakan agar process bersih. Namun di CI worker persistent, daemon bisa menguntungkan.

Command umum:

```bash
./gradlew clean build
```

Tapi `clean` menghapus peluang incremental build dan cache lokal. Untuk CI clean runner, `clean` sering redundant.

PR cepat:

```bash
./gradlew check
```

Package saja:

```bash
./gradlew assemble
```

Integration test:

```bash
./gradlew integrationTest
```

Full release verification:

```bash
./gradlew clean build publish
```

### 8.2 Gradle Build Cache in CI

Gradle build cache menyimpan output task berdasarkan input. Jika input sama, output bisa diambil dari cache lokal/remote.

Contoh `settings.gradle.kts`:

```kotlin
buildCache {
    local {
        isEnabled = true
    }
    remote<HttpBuildCache> {
        url = uri("https://gradle-cache.company.internal/cache/")
        isPush = providers.environmentVariable("CI_BRANCH")
            .map { it == "main" }
            .getOrElse(false)
    }
}
```

Policy umum:

```text
PR builds may read cache.
Main branch builds may push cache.
Release builds may read only from trusted cache or disable remote cache.
```

Kenapa PR jangan push remote cache?

Karena untrusted code bisa mencoba menghasilkan poisoned cache output.

### 8.3 Gradle Configuration Cache in CI

Configuration cache menyimpan hasil configuration phase sehingga build berikutnya lebih cepat.

Command:

```bash
./gradlew build --configuration-cache
```

Namun configuration cache menuntut plugin/build logic kompatibel.

CI policy:

- aktifkan di branch utama setelah kompatibilitas stabil;
- untuk PR, boleh `--configuration-cache-problems=warn` pada fase adopsi;
- jangan abaikan warning selamanya;
- build logic custom harus diuji.

### 8.4 Gradle Dependency Verification

Gradle dependency verification menggunakan metadata file untuk memverifikasi checksum/signature dependency.

Generate awal:

```bash
./gradlew --write-verification-metadata sha256 help
```

Lalu commit:

```text
gradle/verification-metadata.xml
```

CI akan gagal jika dependency checksum berubah tanpa update metadata.

Ini sangat berguna untuk mencegah supply-chain tampering.

### 8.5 Gradle Wrapper Validation

Wrapper adalah binary/script yang menentukan Gradle distribution.

Periksa:

- `gradle-wrapper.jar` valid;
- `distributionUrl` approved;
- distribution checksum tersedia;
- tidak download dari mirror liar.

Contoh:

```properties
distributionUrl=https\://services.gradle.org/distributions/gradle-9.0-bin.zip
distributionSha256Sum=<sha256>
```

---

## 9. Java 8–25 Matrix Build Strategy

Java matrix tidak selalu berarti semua job harus jalan di semua versi.

Bedakan:

1. JDK yang menjalankan build tool;
2. JDK yang compile source;
3. target bytecode/API;
4. JDK yang menjalankan test;
5. JDK runtime production.

Contoh library yang mendukung Java 8:

```text
Build tool JDK : 21
Compile target : --release 8
Test matrix    : 8, 11, 17, 21, 25
```

Contoh application yang production Java 21:

```text
Build tool JDK : 21
Compile target : --release 21
Test matrix    : 21, 25 optional compatibility preview
Production     : 21
```

Contoh modernization project:

```text
Current prod   : Java 8
Next prod      : Java 17/21
Compile target : 8 during transition
Test matrix    : 8 and 17/21
```

### 9.1 Maven Toolchains in CI

`~/.m2/toolchains.xml`:

```xml
<toolchains>
  <toolchain>
    <type>jdk</type>
    <provides>
      <version>8</version>
      <vendor>temurin</vendor>
    </provides>
    <configuration>
      <jdkHome>/opt/jdk/temurin-8</jdkHome>
    </configuration>
  </toolchain>
  <toolchain>
    <type>jdk</type>
    <provides>
      <version>21</version>
      <vendor>temurin</vendor>
    </provides>
    <configuration>
      <jdkHome>/opt/jdk/temurin-21</jdkHome>
    </configuration>
  </toolchain>
</toolchains>
```

Build:

```bash
mvn -B -ntp verify
```

Toolchain plugin memilih JDK sesuai konfigurasi POM.

### 9.2 Gradle Toolchains in CI

```kotlin
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}
```

Test dengan JDK berbeda:

```kotlin
tasks.register<Test>("testOnJava25") {
    javaLauncher.set(
        javaToolchains.launcherFor {
            languageVersion.set(JavaLanguageVersion.of(25))
        }
    )
    testClassesDirs = tasks.test.get().testClassesDirs
    classpath = tasks.test.get().classpath
}
```

### 9.3 Matrix Explosion Control

Jangan semua kombinasi dijalankan di semua PR.

Contoh strategi:

```text
PR:
  Java 21 compile + unit test
  Java 8 compile check if library supports 8

Main:
  Java 8, 17, 21 test matrix

Nightly:
  Java 8, 11, 17, 21, 25 full matrix

Release:
  supported runtime matrix only
```

Matrix harus dipilih berdasarkan risiko, bukan kesempurnaan teoritis.

---

## 10. Cache Strategy: Cepat Tapi Jangan Buta

Cache bisa menghemat waktu, tetapi juga bisa memperkenalkan failure dan security risk.

Jenis cache:

| Cache | Isi | Risiko |
|---|---|---|
| Maven local repo | downloaded artifacts | stale/corrupt dependency, snapshot drift |
| Gradle dependency cache | module metadata/artifacts | dynamic version stale, corrupted metadata |
| Gradle build cache | task outputs | cache poisoning jika untrusted push |
| Gradle configuration cache | configured build state | plugin incompatible, env-sensitive state |
| Docker layer cache | image layers | stale base image, secret leakage |
| Testcontainers cache | container images | old service version |
| Node/npm cache for frontend hybrid | packages | supply-chain drift |

### 10.1 Cache Key Design

Cache key harus berubah saat input penting berubah.

Untuk Maven dependency cache:

```text
m2-${os}-${java}-${maven}-${hash(pom.xml, parent-pom, bom, settings.xml)}
```

Untuk Gradle:

```text
gradle-${os}-${java}-${gradle-version}-${hash(settings.gradle, build.gradle, gradle/libs.versions.toml)}
```

Untuk Docker:

```text
docker-${base-image-digest}-${dockerfile-hash}-${lockfile-hash}
```

### 10.2 Cache Trust Levels

Tidak semua pipeline boleh menulis cache.

Recommended:

```text
Untrusted PR from fork : no cache push, limited cache read
Internal PR           : cache read, maybe no push
Main branch           : cache read/write
Release branch/tag    : read trusted cache or disable mutable cache
```

### 10.3 Cache Failure Playbook

Kalau CI gagal aneh:

1. rerun without cache;
2. compare dependency tree;
3. delete local repo/cache;
4. check snapshot dependency;
5. verify plugin versions;
6. check generated sources;
7. inspect Gradle cacheability/configuration cache warnings;
8. check CI image version.

Command examples:

```bash
mvn -B -ntp -U clean verify
```

```bash
./gradlew clean build --no-build-cache --rerun-tasks
```

---

## 11. Artifact Publishing and Promotion

### 11.1 Maven Artifact Publishing

Maven publish biasanya melalui `deploy` phase.

```bash
mvn -B -ntp deploy
```

Deploy plugin digunakan untuk menambahkan artifact ke remote repository agar bisa dipakai project/developer lain.

Konfigurasi distribusi:

```xml
<distributionManagement>
  <repository>
    <id>company-releases</id>
    <url>https://repo.company.internal/repository/maven-releases</url>
  </repository>
  <snapshotRepository>
    <id>company-snapshots</id>
    <url>https://repo.company.internal/repository/maven-snapshots</url>
  </snapshotRepository>
</distributionManagement>
```

Credentials di `settings.xml`, bukan POM:

```xml
<servers>
  <server>
    <id>company-releases</id>
    <username>${env.MAVEN_REPO_USER}</username>
    <password>${env.MAVEN_REPO_PASSWORD}</password>
  </server>
</servers>
```

### 11.2 Gradle Artifact Publishing

Gradle:

```kotlin
publishing {
    publications {
        create<MavenPublication>("mavenJava") {
            from(components["java"])
        }
    }
    repositories {
        maven {
            name = "company"
            url = uri(
                if (version.toString().endsWith("SNAPSHOT"))
                    "https://repo.company.internal/repository/maven-snapshots"
                else
                    "https://repo.company.internal/repository/maven-releases"
            )
            credentials {
                username = providers.environmentVariable("MAVEN_REPO_USER").orNull
                password = providers.environmentVariable("MAVEN_REPO_PASSWORD").orNull
            }
        }
    }
}
```

Command:

```bash
./gradlew publish
```

### 11.3 Candidate vs Release Repository

Ideal enterprise flow:

```text
maven-snapshots
  - mutable-ish internal development artifacts

maven-candidates
  - immutable release candidates
  - tested in DEV/UAT

maven-releases
  - approved immutable releases
```

Jika repository manager tidak mendukung promotion, metadata bisa disimpan di release management system.

### 11.4 Artifact Metadata

Setiap artifact sebaiknya punya metadata:

- group/artifact/version;
- commit SHA;
- build number;
- branch/tag;
- build timestamp normalized;
- Java version;
- Maven/Gradle version;
- dependency lock hash;
- SBOM reference;
- checksum;
- signature/provenance.

Manifest example:

```text
Implementation-Title: order-service
Implementation-Version: 1.8.0
Build-Commit: abc1234
Build-Time: 2026-06-17T00:00:00Z
Build-Jdk: 21.0.x
Build-Tool: Gradle 9.x
```

Jangan memasukkan secret, username, local path, atau machine hostname ke artifact metadata.

---

## 12. Snapshot Discipline

SNAPSHOT itu berguna, tetapi berbahaya jika tidak disiplin.

SNAPSHOT artinya:

```text
This coordinate may resolve to different bits over time.
```

Risiko:

- build hari ini dan besok berbeda;
- rollback sulit;
- dependency tree berubah diam-diam;
- cache menyembunyikan update;
- release accidentally depends on snapshot.

Policy:

```text
PR/main may consume selected internal SNAPSHOT if controlled.
Release must not consume SNAPSHOT.
```

Maven Enforcer bisa melarang snapshot dependency di release.

Gradle bisa memakai resolution strategy/custom validation untuk gagal jika dependency snapshot ditemukan di release build.

Contoh Gradle validation sederhana:

```kotlin
gradle.projectsEvaluated {
    if (version.toString().contains("SNAPSHOT").not()) {
        configurations
            .filter { it.isCanBeResolved }
            .forEach { configuration ->
                configuration.incoming.beforeResolve {
                    configuration.dependencies.forEach { dep ->
                        if (dep.version?.contains("SNAPSHOT") == true) {
                            throw GradleException("Release build cannot depend on SNAPSHOT: $dep")
                        }
                    }
                }
            }
    }
}
```

Untuk production, lebih baik gunakan released internal library atau promoted candidate artifact.

---

## 13. CI Security Boundary

CI punya akses besar:

- source code;
- dependency repository;
- signing key;
- deploy credentials;
- container registry;
- cloud credentials;
- environment secrets.

Karena itu CI adalah high-value target.

### 13.1 Principle of Least Privilege

Pisahkan credentials:

| Pipeline | Credentials |
|---|---|
| PR from fork | no secrets |
| internal PR | read-only repository token |
| main | publish snapshot/candidate token |
| release | signing + release publish token |
| deploy DEV | DEV deploy token |
| deploy PROD | PROD deploy token with approval |

Jangan satu token untuk semua.

### 13.2 Untrusted Code Problem

PR build menjalankan code dari contributor. Build script sendiri adalah executable code.

Gradle build script bisa menjalankan arbitrary code saat configuration phase. Maven plugin juga bisa menjalankan code.

Karena itu:

- PR from fork tidak boleh mendapat secret;
- jangan otomatis publish dari PR;
- jangan push remote build cache dari PR;
- jangan execute deployment step dari PR;
- batasi permissions token.

### 13.3 Build Script Changes as High-Risk Changes

Perubahan pada file ini harus diperlakukan lebih ketat:

```text
pom.xml
settings.xml
build.gradle
build.gradle.kts
settings.gradle
settings.gradle.kts
gradle.properties
gradle/libs.versions.toml
gradle/wrapper/*
buildSrc/**
build-logic/**
.github/workflows/**
.gitlab-ci.yml
Jenkinsfile
Dockerfile
```

Karena perubahan build logic bisa:

- mengambil secret;
- mengubah dependency;
- skip test;
- publish artifact palsu;
- mematikan security scan;
- menulis cache berbahaya.

### 13.4 Secret Handling

Jangan:

```bash
echo $TOKEN
mvn deploy -Dpassword=$TOKEN
./gradlew publish -Ppassword=$TOKEN
```

Lebih baik:

- secret injection dari CI secret manager;
- masked logs;
- environment variable terbatas;
- credentials hanya di job yang perlu;
- no secrets in build cache;
- no secrets in artifact;
- no secrets in test reports.

---

## 14. Quality Gate Architecture

Quality gate harus dibagi menjadi blocking dan non-blocking secara sadar.

### 14.1 Fast Blocking Gates

Cocok untuk PR:

- compile;
- unit test;
- format/lint;
- dependency convergence;
- forbidden snapshot for release branch;
- no known critical vulnerability;
- no secret detected;
- wrapper validation.

### 14.2 Slow Blocking Gates

Cocok untuk main/release:

- full integration test;
- coverage threshold;
- license compliance;
- container scan;
- SBOM generation;
- mutation score if required;
- performance smoke;
- compatibility matrix.

### 14.3 Informational Gates

Tidak langsung block, tetapi dikirim ke dashboard:

- dependency update availability;
- minor vulnerability with accepted risk;
- test duration trend;
- flaky test trend;
- cache hit rate;
- code coverage trend;
- build duration trend.

Masalah umum: semua gate dibuat blocking dari awal, pipeline jadi terlalu lambat, developer mulai mencari cara bypass.

Lebih sehat:

```text
Observe -> Warn -> Enforce for new code -> Enforce globally
```

---

## 15. Multi-Module CI Strategy

Untuk multi-module besar, jangan selalu full build kalau tidak perlu.

### 15.1 Maven Affected Module Build

Jika module `service-order` berubah:

```bash
mvn -B -ntp -pl service-order -am verify
```

Untuk membangun module yang bergantung pada module tersebut:

```bash
mvn -B -ntp -pl shared-domain -amd verify
```

Kombinasi:

```bash
mvn -B -ntp -pl shared-domain -am -amd verify
```

Hati-hati: impacted module detection manual bisa salah jika resource/config/plugin berubah.

### 15.2 Gradle Affected Build

Gradle task graph bisa menjalankan task spesifik:

```bash
./gradlew :service-order:build
```

Dengan dependency project, Gradle akan menjalankan task yang dibutuhkan.

Untuk monorepo besar, bisa pakai:

- affected project detection;
- build cache;
- composite build;
- dependency graph metadata;
- CI path filters.

### 15.3 Files That Should Trigger Full Build

Full build wajib jika berubah:

- parent POM;
- BOM/platform;
- settings.gradle;
- root build script;
- convention plugin;
- version catalog;
- CI pipeline config;
- Docker base image;
- codegen schema shared;
- compiler plugin config;
- test framework config.

---

## 16. Docker/Container Build Integration

Untuk Java app modern, CI sering menghasilkan container image.

Dua strategi:

1. Build JAR lalu Dockerfile;
2. Build image langsung via Jib/Buildpacks.

### 16.1 Dockerfile Strategy

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY target/app.jar /app/app.jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

CI:

```bash
mvn -B -ntp package
docker build -t registry/app:${VERSION} .
docker push registry/app:${VERSION}
```

Risiko:

- Docker context membawa file tak perlu;
- base image mutable jika pakai tag bukan digest;
- layer cache stale;
- secret ikut copy;
- JDK/JRE mismatch.

### 16.2 Jib Strategy

Maven:

```bash
mvn -B -ntp compile jib:build
```

Gradle:

```bash
./gradlew jib
```

Keuntungan:

- tidak perlu Docker daemon;
- layer Java-aware;
- reproducibility lebih mudah;
- registry publish langsung.

Tetap perlu:

- base image digest policy;
- credential boundary;
- scan image;
- SBOM/provenance.

### 16.3 Buildpacks Strategy

Spring Boot Buildpacks:

Maven:

```bash
mvn -B -ntp spring-boot:build-image
```

Gradle:

```bash
./gradlew bootBuildImage
```

Cocok jika ingin standardized runtime image dan lifecycle buildpack.

Risiko:

- hasil image tergantung builder/run image;
- perlu pin builder version/digest;
- cache behavior harus dipahami.

---

## 17. Database Migration in CI/CD

Build pipeline sering salah memasukkan DB migration.

Pisahkan:

- validate migration script di CI;
- package migration bersama artifact;
- apply migration di deploy stage;
- verify migration status setelah deploy.

CI validation:

```bash
mvn -B -ntp test -Pdb-migration-validation
```

atau:

```bash
./gradlew flywayValidate
```

Deploy stage:

```text
apply migration to target DB
start app
verify schema version
```

Jangan menjalankan migration production dari PR pipeline.

Untuk regulatory/enterprise systems, migration harus punya:

- rollback/forward-fix strategy;
- DDL review;
- data migration estimate;
- lock impact analysis;
- backup/restore plan;
- audit trail.

---

## 18. Release Versioning Strategy in CI

### 18.1 Common Version Inputs

- semantic version: `1.8.0`;
- pre-release: `1.8.0-rc.3`;
- build metadata: `1.8.0+abc123`;
- Maven snapshot: `1.8.0-SNAPSHOT`;
- date version: `2026.06.17`;
- internal build number.

### 18.2 Maven Version Caveat

Maven version ordering has its own semantics. Avoid overly clever versions.

Safer:

```text
1.8.0-SNAPSHOT
1.8.0-rc.1
1.8.0
```

### 18.3 Application vs Library

Library versioning cares about API compatibility.

Application versioning cares about deploy traceability.

Library:

```text
com.company:case-domain-api:2.4.0
```

Application:

```text
case-service:2026.06.17.1182+abc123
```

Do not force one scheme for all artifact types.

---

## 19. Deployment Pipeline Should Not Be Build Pipeline

Deployment pipeline should receive artifact identity:

```text
artifact: com.company:case-service:1.8.0-rc.3
image: registry/case-service@sha256:...
```

Then it deploys that artifact.

Bad:

```text
Deploy UAT:
  checkout branch release/1.8
  run mvn package
  docker build
  deploy
```

Good:

```text
Deploy UAT:
  pull image digest sha256:...
  apply config for UAT
  deploy
  smoke test
```

This separation gives:

- auditability;
- rollback;
- consistency;
- faster deploy;
- less repository dependency during deploy.

---

## 20. Rollback Strategy

Rollback is only possible if artifact identity is clear.

Minimum metadata:

```text
Current PROD image digest: sha256:aaa
Previous PROD image digest: sha256:bbb
Deployment config version: config-2026-06-17-1
DB schema version: 182
```

Rollback cases:

| Failure | Rollback Strategy |
|---|---|
| app bug, no DB change | redeploy previous artifact |
| app bug with backward-compatible DB | redeploy previous app if schema supports it |
| destructive DB migration | forward fix often safer than rollback |
| config issue | rollback config only |
| dependency/runtime issue | redeploy previous image digest |

Build pipeline should produce artifacts that support rollback:

- immutable artifact;
- versioned config references;
- migration compatibility checks;
- release notes;
- known previous artifact.

---

## 21. Pipeline Observability

CI/CD system needs metrics.

Track:

- build duration;
- queue time;
- test duration;
- flaky test count;
- failed stage distribution;
- cache hit rate;
- dependency resolution time;
- artifact publish time;
- deployment duration;
- rollback count;
- release frequency;
- mean time to restore pipeline;
- top failing modules;
- slowest tests;
- security scan findings trend.

Without observability, optimization becomes guesswork.

### 21.1 Useful Logs

At start:

```bash
java -version
mvn -version
./gradlew --version
uname -a
```

For Maven dependency debugging:

```bash
mvn -B -ntp dependency:tree
```

For Gradle dependency debugging:

```bash
./gradlew dependencies
./gradlew dependencyInsight --dependency jackson-databind --configuration runtimeClasspath
```

For test reports:

- always upload XML reports;
- always upload HTML reports on failure;
- keep logs for long enough;
- link failed test to report.

---

## 22. Failure Taxonomy in CI/CD

### 22.1 Source Failure

Examples:

- merge conflict;
- missing submodule;
- wrong branch;
- shallow clone breaks version plugin;
- generated version needs Git tag but tag missing.

Fix:

- fetch depth policy;
- explicit branch/tag;
- validate Git metadata.

### 22.2 Environment Failure

Examples:

- wrong JDK;
- wrong Maven/Gradle;
- missing toolchain;
- OS package missing;
- timezone/locale mismatch.

Fix:

- pinned CI image;
- wrapper;
- toolchains;
- environment printout.

### 22.3 Dependency Failure

Examples:

- repository unavailable;
- snapshot changed;
- checksum mismatch;
- dependency conflict;
- private artifact missing.

Fix:

- repository manager;
- lock/verification;
- retry policy with limit;
- dependency tree artifact.

### 22.4 Test Failure

Examples:

- flaky test;
- test order dependency;
- port collision;
- Testcontainers pull failure;
- external service unstable.

Fix:

- isolate test;
- retry only known flaky with tracking;
- use ephemeral services;
- reserve ports dynamically;
- avoid shared mutable test data.

### 22.5 Artifact Failure

Examples:

- missing main class;
- duplicate resource;
- wrong manifest;
- WAR includes provided dependency;
- container image missing certificate.

Fix:

- packaging smoke test;
- inspect artifact;
- classpath report;
- container startup test.

### 22.6 Publish/Deploy Failure

Examples:

- credentials expired;
- repository rejects redeploy;
- version already exists;
- registry unavailable;
- deployment config invalid.

Fix:

- immutable versioning;
- credential rotation;
- repository health check;
- dry run deploy validation.

---

## 23. Example Maven Pipeline Blueprint

Generic CI flow:

```yaml
stages:
  - validate
  - compile
  - test
  - verify
  - package
  - security
  - publish

validate:
  script:
    - java -version
    - mvn -version
    - mvn -B -ntp validate

compile:
  script:
    - mvn -B -ntp -DskipTests compile test-compile

test:
  script:
    - mvn -B -ntp test
  artifacts:
    reports:
      junit: '**/target/surefire-reports/*.xml'

verify:
  script:
    - mvn -B -ntp verify -DskipITs=false

package:
  script:
    - mvn -B -ntp package -DskipTests
  artifacts:
    paths:
      - '**/target/*.jar'
      - '**/target/*.war'

publish:
  script:
    - mvn -B -ntp deploy -DskipTests
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
```

For multi-module partial PR:

```bash
mvn -B -ntp -pl changed-module -am verify
```

For release:

```bash
mvn -B -ntp clean deploy \
  -Drevision=1.8.0 \
  -Dchangelist= \
  -DskipTests=false
```

---

## 24. Example Gradle Pipeline Blueprint

```yaml
stages:
  - validate
  - compile
  - test
  - check
  - package
  - publish

validate:
  script:
    - java -version
    - ./gradlew --version
    - ./gradlew help --warning-mode=all

compile:
  script:
    - ./gradlew classes testClasses

test:
  script:
    - ./gradlew test
  artifacts:
    reports:
      junit: '**/build/test-results/test/*.xml'

check:
  script:
    - ./gradlew check

package:
  script:
    - ./gradlew assemble
  artifacts:
    paths:
      - '**/build/libs/*.jar'

publish:
  script:
    - ./gradlew publish
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
```

With cache:

```bash
./gradlew build --build-cache --configuration-cache
```

For release hardening:

```bash
./gradlew clean build publish \
  --no-build-cache \
  --dependency-verification=strict
```

Whether to disable build cache for release depends on organizational trust model. A stricter organization may disable remote build cache for release; a mature organization may use a trusted remote cache with verification and restricted writers.

---

## 25. Enterprise Pipeline Topology

For many Java services:

```text
platform-build-logic
  - parent POM / Gradle convention plugin
  - BOM/platform
  - quality rules
  - repository policy

service pipelines
  - use platform build logic
  - run service-specific tests
  - publish service artifact

release orchestrator
  - selects artifact versions
  - promotes across environments
  - records approval/audit
```

Do not copy-paste CI logic into 50 repos without governance.

Better:

- shared CI templates;
- shared Maven parent;
- shared Gradle convention plugin;
- shared container base image;
- shared security scanner config;
- shared release metadata format.

But avoid over-centralization where every small service change requires platform team intervention.

Good governance is:

```text
centralized policy, decentralized delivery.
```

---

## 26. Case Study: Enterprise Java Service Pipeline

Scenario:

- Java 21 Spring/Jakarta service;
- supports internal library compiled for Java 8;
- Maven multi-module;
- Oracle integration test;
- container deployment to Kubernetes;
- release promotion DEV -> UAT -> PROD.

Pipeline:

```text
PR Pipeline
  1. validate wrapper/settings
  2. compile Java 21
  3. unit test
  4. dependency tree + enforcer
  5. static analysis
  6. affected integration test only

Main Pipeline
  1. full clean verify
  2. integration test with Oracle-compatible container/service
  3. package executable jar
  4. generate SBOM
  5. scan dependency
  6. build container image
  7. publish image by digest
  8. deploy DEV
  9. smoke test

Release Pipeline
  1. checkout tag
  2. clean environment
  3. full verify
  4. no SNAPSHOT dependency
  5. sign artifact
  6. publish release candidate
  7. promote same image digest to UAT
  8. approval
  9. promote same digest to PROD
```

Key invariant:

```text
The artifact tested in UAT is the artifact promoted to PROD.
```

---

## 27. Anti-Patterns

### 27.1 Rebuild Per Environment

```text
DEV build != UAT build != PROD build
```

This destroys confidence.

### 27.2 CI Uses Developer Machine Assumptions

Examples:

- relies on locally installed Maven;
- relies on global `~/.m2/settings.xml` unknown;
- relies on local JDK;
- relies on implicit env vars.

### 27.3 Cache as Correctness Mechanism

Cache should optimize, not define correctness.

A build that only passes with cache is broken.

### 27.4 PR Pipeline Has Production Secrets

Untrusted build scripts can exfiltrate secrets.

### 27.5 Release Build Uses Dynamic Versions

Examples:

- Maven version range;
- Gradle `latest.release`;
- SNAPSHOT dependency;
- changing plugin version.

### 27.6 Deployment Pipeline Rebuilds

Deployment should deploy/pull artifact, not compile source.

### 27.7 One Giant Pipeline Job

One job that compiles/tests/packages/scans/deploys makes failures hard to isolate and feedback slow.

### 27.8 Test Reports Not Uploaded

A failed pipeline without test reports wastes engineering time.

### 27.9 All Gates Blocking from Day One

This creates bypass culture.

Better enforcement rollout:

```text
measure -> warn -> block critical -> block progressively
```

---

## 28. Checklist: CI/CD Build Architecture Review

### 28.1 Build Identity

- [ ] Commit SHA printed.
- [ ] Branch/tag printed.
- [ ] Build number printed.
- [ ] Java version printed.
- [ ] Maven/Gradle version printed.
- [ ] Artifact version deterministic.

### 28.2 Build Tool

- [ ] Maven/Gradle wrapper used.
- [ ] Plugin versions pinned.
- [ ] No dynamic dependency versions in release.
- [ ] Toolchain configured.
- [ ] Build scripts reviewed as executable code.

### 28.3 Dependency

- [ ] Approved repositories only.
- [ ] Dependency tree/report available.
- [ ] Locking/verification strategy exists.
- [ ] No SNAPSHOT in release.
- [ ] Vulnerability scan integrated.

### 28.4 Cache

- [ ] Cache keys include relevant build files.
- [ ] PR cache write restricted.
- [ ] Release cache policy explicit.
- [ ] Cache-bypass command documented.
- [ ] Cache hit rate measured.

### 28.5 Test

- [ ] Unit and integration test separated.
- [ ] Reports uploaded.
- [ ] Flaky test policy exists.
- [ ] Matrix strategy defined.
- [ ] Testcontainers/external dependency policy defined.

### 28.6 Artifact

- [ ] Build once, promote same artifact.
- [ ] Artifact checksum available.
- [ ] SBOM generated where required.
- [ ] Artifact contains build metadata.
- [ ] Artifact does not contain secret.
- [ ] Container image pinned by digest for deploy.

### 28.7 Security

- [ ] PR from fork has no secrets.
- [ ] Least privilege token policy.
- [ ] Signing key restricted to release job.
- [ ] Build logs mask secrets.
- [ ] Dependency/plugin verification in place.

### 28.8 Deployment

- [ ] Deploy pipeline does not rebuild.
- [ ] Environment config injected outside artifact.
- [ ] Smoke test after deploy.
- [ ] Rollback artifact known.
- [ ] Approval/audit trail exists for production.

---

## 29. Top 1% Mental Model

A strong build engineer does not ask only:

```text
How do I make CI green?
```

They ask:

```text
What exactly does this green build prove?
What does it not prove?
Can I reproduce the artifact?
Can I trust the dependencies?
Can I promote the exact same artifact?
Can I debug failure from logs and metadata?
Can an attacker abuse this pipeline?
Can a future team operate this safely?
```

CI/CD build architecture is about designing proof.

Each stage should answer a precise question:

```text
validate  -> Is the build model acceptable?
compile   -> Can the code compile against declared API boundaries?
test      -> Does behavior satisfy fast deterministic checks?
verify    -> Does the system hold under deeper integration checks?
package   -> Is the runtime artifact structurally correct?
security  -> Is the artifact acceptable under supply-chain policy?
publish   -> Can the artifact be stored immutably?
promote   -> Can the same artifact move through environments?
deploy    -> Can the runtime accept and run this artifact?
observe   -> Is the deployed system healthy?
```

If a pipeline stage does not answer a clear question, it is noise.
If a release artifact cannot be traced back to exact source, dependency graph, build environment, and CI run, it is not sufficiently governed.
If production deploy rebuilds source, promotion confidence is weak.

The target is not merely automation.

The target is:

```text
trusted, explainable, repeatable delivery.
```

---

## 30. Ringkasan

Di bagian ini kita membangun mental model CI/CD build architecture:

- CI/CD adalah enforcement layer antara source code dan trusted runtime artifact.
- Pipeline sebaiknya dilihat sebagai state machine dengan invariant per transition.
- Prinsip paling penting adalah build once, promote same artifact.
- PR, main, nightly, dan release pipeline tidak harus identik.
- Maven dan Gradle butuh command strategy yang berbeda.
- Java 8–25 matrix harus dibangun berdasarkan risiko, bukan kombinasi membabi buta.
- Cache mempercepat build tetapi tidak boleh menjadi sumber kebenaran.
- Artifact publishing dan promotion harus immutable dan traceable.
- CI adalah security boundary karena menjalankan executable build logic.
- Deployment pipeline tidak seharusnya rebuild source.
- Observability pipeline wajib untuk debugging dan continuous improvement.

---

## 31. Referensi Resmi dan Lanjutan

- Apache Maven — CI Friendly Versions: https://maven.apache.org/guides/mini/guide-maven-ci-friendly.html
- Apache Maven Deploy Plugin: https://maven.apache.org/plugins/maven-deploy-plugin/
- Apache Maven Deploy Plugin Documentation: https://maven.apache.org/plugins/maven-deploy-plugin/plugin-info.html
- Gradle Build Cache User Guide: https://docs.gradle.org/current/userguide/build_cache.html
- Gradle Dependency Verification: https://docs.gradle.org/current/userguide/dependency_verification.html
- Gradle User Manual: https://docs.gradle.org/current/userguide/userguide.html
- Gradle Build Environment: https://docs.gradle.org/current/userguide/build_environment.html
- SLSA Framework: https://slsa.dev/
- CycloneDX: https://cyclonedx.org/
- SPDX: https://spdx.dev/

---

## 32. Status Seri

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
[ ] Part 29 — Advanced Gradle
[ ] Part 30 — Advanced Maven
[ ] Part 31 — Build Observability
[ ] Part 32 — Monorepo, Polyrepo, and Enterprise Build Topologies
[ ] Part 33 — Real-World Case Study
[ ] Part 34 — Top 1% Build Engineer Playbook
```

Seri belum selesai. Bagian berikutnya: **Part 19 — Release Engineering: Semantic Versioning, Snapshot, Release, Tagging, Changelog, Publishing**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./17-performance-engineering.md">⬅️ Part 17 — Performance Engineering: Build Time, Configuration Cache, Daemon, Parallelism, Incrementality</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./19-release-engineering.md">Part 19 — Release Engineering: Semantic Versioning, Snapshot, Release, Tagging, Changelog, Publishing ➡️</a>
</div>
