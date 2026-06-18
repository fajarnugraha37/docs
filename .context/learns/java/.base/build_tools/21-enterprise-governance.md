# Part 21 — Enterprise Governance: Corporate Parent POM, Convention Plugin, Policy-as-Build

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `21-enterprise-governance.md`  
> Target: Java 8 sampai Java 25  
> Fokus: Maven, Gradle, governance build, policy-as-code, enterprise platform engineering

---

## 1. Tujuan Bagian Ini

Pada level junior sampai menengah, build system biasanya dipahami sebagai alat untuk:

```text
compile -> test -> package
```

Pada level senior/enterprise, build system adalah **control plane** untuk menjaga kualitas engineering lintas banyak repository, banyak service, banyak tim, banyak versi Java, dan banyak jenis artifact.

Build governance menjawab pertanyaan seperti:

- Apakah semua project memakai versi Java yang benar?
- Apakah semua plugin dipin versinya?
- Apakah dependency hanya boleh diambil dari repository resmi perusahaan?
- Apakah dependency rentan bisa masuk release?
- Apakah semua artifact punya metadata yang cukup untuk audit?
- Apakah semua module punya testing dan quality gate minimum?
- Apakah tim boleh override policy? Jika boleh, siapa yang approve dan bagaimana tracking-nya?
- Apakah build cukup standar untuk dioperasikan organisasi, tetapi cukup fleksibel untuk kebutuhan tim?

Bagian ini bukan hanya tentang `parent pom` atau `buildSrc`. Ini tentang **mendesain sistem governance build**.

---

## 2. Mental Model: Governance Bukan Sekadar Standarisasi

Banyak organisasi salah memahami governance sebagai:

```text
Semua project harus sama.
```

Itu terlalu dangkal.

Governance yang sehat adalah:

```text
Semua project harus mematuhi invariant penting,
tetapi boleh berbeda pada aspek yang memang domain-specific.
```

Contoh invariant yang harus dipaksa:

- dependency repository harus resmi;
- plugin version harus eksplisit;
- Java baseline harus jelas;
- build harus bisa berjalan di CI;
- release artifact harus immutable;
- secret tidak boleh masuk artifact;
- vulnerability severity tertentu harus block release;
- generated artifact harus reproducible;
- artifact harus punya group/artifact/version/commit/build metadata yang jelas.

Contoh variasi yang boleh dibiarkan:

- service A memakai Spring Boot;
- service B memakai Jakarta EE;
- library C support Java 8;
- service D baseline Java 21;
- module tertentu butuh OpenAPI generation;
- module lain butuh Protobuf/gRPC;
- batch workload punya testing pipeline berbeda dari REST API.

Governance buruk memaksa semua project identik. Governance baik menjaga **invariant** dan memberi **extension point**.

---

## 3. Build Governance sebagai Sistem Kontrol

Bayangkan enterprise build governance sebagai lapisan kontrol berikut:

```text
┌────────────────────────────────────────────────────────────┐
│                    Enterprise Build Governance              │
├────────────────────────────────────────────────────────────┤
│  Policy Layer                                               │
│  - allowed Java versions                                    │
│  - allowed repositories                                     │
│  - allowed licenses                                         │
│  - vulnerability threshold                                  │
│  - plugin/dependency version policy                         │
├────────────────────────────────────────────────────────────┤
│  Distribution Layer                                         │
│  - corporate parent POM                                     │
│  - corporate BOM                                            │
│  - Gradle convention plugin                                 │
│  - Gradle version catalog/platform                          │
├────────────────────────────────────────────────────────────┤
│  Enforcement Layer                                          │
│  - Maven Enforcer                                           │
│  - Gradle custom/convention plugin                          │
│  - dependency verification                                  │
│  - CI gates                                                 │
│  - repository manager policy                                │
├────────────────────────────────────────────────────────────┤
│  Exception Layer                                            │
│  - waiver                                                   │
│  - expiry date                                              │
│  - owner                                                    │
│  - risk acceptance                                          │
├────────────────────────────────────────────────────────────┤
│  Observability Layer                                        │
│  - dependency dashboard                                     │
│  - build failure trend                                      │
│  - Java baseline adoption                                   │
│  - vulnerability aging                                      │
│  - policy violation trend                                   │
└────────────────────────────────────────────────────────────┘
```

Kunci mental model:

> Governance bukan hanya aturan. Governance adalah kombinasi antara aturan, mekanisme distribusi, enforcement, exception handling, dan observability.

Tanpa observability, governance berubah menjadi opini. Tanpa exception handling, governance berubah menjadi bottleneck. Tanpa enforcement, governance berubah menjadi dokumentasi yang diabaikan.

---

## 4. Jenis Policy dalam Enterprise Build

### 4.1 Java Baseline Policy

Policy ini mengatur versi Java yang boleh digunakan.

Contoh:

```text
Library internal umum:
- minimum runtime: Java 8
- compile with: JDK 17 or 21 using --release 8
- test matrix: 8, 11, 17, 21, 25

New backend services:
- minimum runtime: Java 21
- compile with: Java 21 toolchain
- optional test matrix: 21 and 25

Legacy enterprise apps:
- runtime: Java 8 or 11
- migration target: Java 17/21
- no Java 21 API usage until runtime upgraded
```

Policy ini harus menjawab:

- apakah Java 8 masih didukung?
- apakah Java 11 sudah deprecated?
- kapan Java 17/21/25 menjadi target?
- apakah library boleh memakai API Java terbaru?
- apakah build harus memakai toolchain?
- apakah runtime container sudah sesuai compile target?

Kesalahan umum:

```text
sourceCompatibility = 8
```

dianggap cukup. Padahal tanpa `--release`, kode masih bisa tidak sengaja memakai API dari JDK compile yang lebih baru.

---

### 4.2 Repository Policy

Policy ini mengatur dari mana dependency/plugin boleh diambil.

Contoh policy:

```text
Allowed:
- internal Nexus/Artifactory group repository
- internal release repository
- internal snapshot repository untuk CI tertentu

Blocked:
- direct Maven Central access dari CI
- JCenter
- arbitrary GitHub Packages
- HTTP repository
- repository didefinisikan langsung di module tanpa approval
```

Tujuannya:

- mengurangi dependency confusion;
- memastikan artifact cache internal;
- memungkinkan audit;
- mencegah build mengambil artifact berbeda tergantung developer machine;
- mengontrol supply-chain boundary.

Maven biasanya mengandalkan `settings.xml` mirror:

```xml
<settings>
  <mirrors>
    <mirror>
      <id>corporate-repository</id>
      <mirrorOf>*</mirrorOf>
      <url>https://repo.company.example/repository/maven-all</url>
    </mirror>
  </mirrors>
</settings>
```

Gradle bisa mengandalkan centralized repositories di `settings.gradle.kts`:

```kotlin
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven("https://repo.company.example/repository/maven-all")
    }
}

pluginManagement {
    repositories {
        maven("https://repo.company.example/repository/gradle-plugins")
    }
}
```

Invariant penting:

> Repository policy sebaiknya tidak diserahkan ke masing-masing module.

---

### 4.3 Dependency Version Policy

Policy ini mengatur versi dependency.

Pertanyaan yang harus dijawab:

- apakah dependency version boleh didefinisikan di module?
- apakah semua versi harus lewat BOM/platform/catalog?
- apakah dynamic version seperti `1.+` boleh?
- apakah SNAPSHOT boleh di production build?
- siapa yang approve major upgrade?
- bagaimana emergency security override dilakukan?

Contoh policy:

```text
Production release:
- no SNAPSHOT
- no dynamic version
- no version ranges
- all major libraries aligned via corporate BOM/platform
- critical security override allowed with ticket and expiry
```

Maven enforcement:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-enforcer-plugin</artifactId>
  <version>${maven-enforcer-plugin.version}</version>
  <executions>
    <execution>
      <id>enforce-dependency-policy</id>
      <goals>
        <goal>enforce</goal>
      </goals>
      <configuration>
        <rules>
          <requireReleaseDeps>
            <message>No SNAPSHOT dependencies are allowed in release builds.</message>
          </requireReleaseDeps>
          <requirePluginVersions />
          <dependencyConvergence />
          <banDuplicatePomDependencyVersions />
        </rules>
      </configuration>
    </execution>
  </executions>
</plugin>
```

Gradle enforcement concept:

```kotlin
configurations.configureEach {
    resolutionStrategy.eachDependency {
        if (requested.version?.contains("SNAPSHOT") == true) {
            throw GradleException("SNAPSHOT dependency is not allowed: $requested")
        }
        if (requested.version?.contains("+") == true) {
            throw GradleException("Dynamic dependency version is not allowed: $requested")
        }
    }
}
```

Tetapi untuk enterprise, logic seperti ini sebaiknya tidak disalin ke setiap `build.gradle.kts`; ia harus berada di convention plugin.

---

### 4.4 Plugin Version Policy

Plugin adalah kode yang berjalan saat build. Dari perspektif supply chain, plugin bahkan lebih sensitif daripada dependency runtime karena plugin bisa:

- membaca file source;
- membaca environment variable;
- mengakses credential;
- menulis artifact;
- publish ke repository;
- menjalankan process eksternal.

Policy minimum:

```text
- all plugin versions must be pinned
- no plugin from unapproved repository
- plugin upgrade requires changelog review for high-risk plugin
- release/signing/deploy plugin must be restricted
- custom internal plugin should be versioned and published immutably
```

Maven:

```xml
<build>
  <pluginManagement>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.14.1</version>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.5.3</version>
      </plugin>
    </plugins>
  </pluginManagement>
</build>
```

Gradle:

```kotlin
pluginManagement {
    plugins {
        id("com.company.java-service") version "2.7.0"
        id("org.springframework.boot") version "3.5.0"
    }
}
```

Anti-pattern:

```kotlin
plugins {
    id("some-plugin") version "+"
}
```

Atau Maven plugin tanpa version eksplisit.

---

### 4.5 License Policy

Enterprise harus tahu apakah dependency boleh digunakan dari sisi license.

Contoh:

```text
Allowed:
- Apache-2.0
- MIT
- BSD-2-Clause
- BSD-3-Clause
- EPL, sesuai konteks legal

Requires review:
- LGPL
- MPL
- custom commercial license

Blocked:
- GPL for linked application dependency, sesuai policy legal internal
- unknown license untuk production artifact
```

Build bisa membantu:

- generate license report;
- fail jika license unknown;
- fail jika blocked license;
- attach license metadata ke release artifact.

Namun, jangan pura-pura build bisa menggantikan legal review. Build hanya enforcement technical layer.

---

### 4.6 Vulnerability Policy

Security policy harus eksplisit.

Contoh:

```text
Fail release build if:
- CVSS >= 9.0 and fix exists
- known exploited vulnerability exists
- vulnerable dependency is reachable/runtime and no waiver exists

Warn only if:
- vulnerable dependency is test-only
- no fixed version exists and risk accepted
- vulnerability is in unused optional path
```

Policy yang matang membedakan:

- direct dependency vs transitive dependency;
- compile/runtime/test scope;
- reachable vs not reachable;
- fix available vs no fix;
- exploit maturity;
- public-facing service vs internal batch;
- waiver expiration.

Kesalahan umum:

```text
CVSS >= 7 always fail everything.
```

Ini sering menghasilkan noise dan waiver massal. Policy security yang baik harus tegas tetapi kontekstual.

---

### 4.7 Build Reproducibility Policy

Policy ini mengatur apakah artifact harus bisa dibangun ulang.

Contoh:

```text
Release artifact must:
- use fixed dependency versions
- use pinned plugin versions
- normalize archive timestamps
- record source commit
- record build JDK
- produce SBOM
- be built by CI, not developer machine
- be promoted, not rebuilt per environment
```

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

---

## 5. Maven Enterprise Governance

Maven governance biasanya dibangun dari beberapa komponen:

```text
corporate-parent-pom
corporate-bom
maven-settings.xml
maven-enforcer-plugin
repository manager
CI release pipeline
```

---

## 6. Corporate Parent POM

Corporate parent POM adalah POM yang diwarisi project Maven untuk mendapatkan default enterprise.

Contoh struktur:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.company.platform</groupId>
  <artifactId>company-parent</artifactId>
  <version>5.3.0</version>
  <packaging>pom</packaging>

  <properties>
    <java.release>21</java.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <maven.compiler.release>${java.release}</maven.compiler.release>
  </properties>

  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>com.company.platform</groupId>
        <artifactId>company-bom</artifactId>
        <version>2026.06.0</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>

  <build>
    <pluginManagement>
      <plugins>
        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-compiler-plugin</artifactId>
          <version>3.14.1</version>
          <configuration>
            <release>${java.release}</release>
          </configuration>
        </plugin>

        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-surefire-plugin</artifactId>
          <version>3.5.3</version>
        </plugin>

        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-failsafe-plugin</artifactId>
          <version>3.5.3</version>
        </plugin>
      </plugins>
    </pluginManagement>

    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-enforcer-plugin</artifactId>
        <version>3.5.0</version>
        <executions>
          <execution>
            <id>enforce-company-policy</id>
            <goals>
              <goal>enforce</goal>
            </goals>
            <configuration>
              <rules>
                <requireMavenVersion>
                  <version>[3.9.0,)</version>
                </requireMavenVersion>
                <requireJavaVersion>
                  <version>[21,)</version>
                </requireJavaVersion>
                <requirePluginVersions />
                <requireReleaseDeps />
                <dependencyConvergence />
              </rules>
            </configuration>
          </execution>
        </executions>
      </plugin>
    </plugins>
  </build>
</project>
```

### 6.1 Apa yang Cocok Masuk Parent POM?

Cocok:

- Java baseline default;
- encoding;
- plugin version management;
- default compiler behavior;
- default surefire/failsafe behavior;
- reproducibility settings;
- enforcer policy;
- distribution management default jika organisasi seragam;
- reporting/quality plugin default.

Tidak cocok:

- dependency aplikasi spesifik;
- business library yang tidak semua project butuhkan;
- profile environment production/staging yang mengubah artifact;
- secret;
- terlalu banyak execution plugin yang tidak relevan untuk semua project;
- logic rumit yang seharusnya menjadi plugin.

---

### 6.2 Parent POM vs BOM

Ini salah satu sumber kekacauan Maven enterprise.

```text
Parent POM:
- diwarisi via <parent>
- membawa build config, pluginManagement, properties, dependencyManagement
- hanya satu parent langsung

BOM:
- di-import via dependencyManagement
- fokus mengatur versi dependency
- bisa lebih dari satu, meski urutan penting
```

Rule of thumb:

```text
Gunakan parent untuk build policy.
Gunakan BOM untuk dependency version alignment.
```

Jangan memasukkan semua hal ke parent hanya karena mudah.

---

## 7. Corporate BOM

Corporate BOM adalah kontrak versi dependency.

Contoh:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.company.platform</groupId>
  <artifactId>company-bom</artifactId>
  <version>2026.06.0</version>
  <packaging>pom</packaging>

  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>org.slf4j</groupId>
        <artifactId>slf4j-api</artifactId>
        <version>2.0.17</version>
      </dependency>

      <dependency>
        <groupId>ch.qos.logback</groupId>
        <artifactId>logback-classic</artifactId>
        <version>1.5.18</version>
      </dependency>

      <dependency>
        <groupId>com.fasterxml.jackson</groupId>
        <artifactId>jackson-bom</artifactId>
        <version>2.19.0</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>
</project>
```

BOM sebaiknya punya release note:

```text
company-bom 2026.06.0
- Jackson 2.18.x -> 2.19.x
- Netty 4.1.x patch update
- Logback security patch
- removed legacy javax servlet alignment
- Java 8 compatible libraries still maintained
```

BOM tanpa release note akan sulit dipakai tim aplikasi karena mereka tidak tahu risiko upgrade.

---

## 8. Maven Enforcer sebagai Policy Engine

Maven Enforcer adalah salah satu mekanisme paling umum untuk policy-as-build.

Contoh rules penting:

- `requireMavenVersion`
- `requireJavaVersion`
- `requirePluginVersions`
- `requireReleaseDeps`
- `dependencyConvergence`
- `bannedDependencies`
- `banDuplicatePomDependencyVersions`
- `requireUpperBoundDeps`

Contoh banned dependency:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-enforcer-plugin</artifactId>
  <version>3.5.0</version>
  <executions>
    <execution>
      <id>ban-dangerous-dependencies</id>
      <goals>
        <goal>enforce</goal>
      </goals>
      <configuration>
        <rules>
          <bannedDependencies>
            <excludes>
              <exclude>log4j:log4j</exclude>
              <exclude>commons-logging:commons-logging</exclude>
              <exclude>javax.servlet:servlet-api</exclude>
            </excludes>
            <searchTransitive>true</searchTransitive>
          </bannedDependencies>
        </rules>
      </configuration>
    </execution>
  </executions>
</plugin>
```

Penting:

> Enforcer rule harus memberi error message yang actionable.

Buruk:

```text
Build failed because dependency is banned.
```

Baik:

```text
log4j:log4j is banned. Use org.apache.logging.log4j:log4j-api/log4j-core 2.x only if approved, or use company-logging-starter. See BUILD-POLICY-LOGGING-001.
```

---

## 9. Maven Settings Governance

`settings.xml` adalah boundary antara project dan environment.

Biasanya berisi:

- mirror;
- server credentials;
- proxy;
- active profiles untuk repository internal;
- corporate repository routing.

Policy:

```text
Project POM should not contain developer-specific repository credentials.
Credentials must live in CI secret manager or local settings.xml.
```

Contoh server credential:

```xml
<servers>
  <server>
    <id>company-releases</id>
    <username>${env.MAVEN_REPO_USER}</username>
    <password>${env.MAVEN_REPO_PASSWORD}</password>
  </server>
</servers>
```

Jangan commit credential ke POM.

---

## 10. Gradle Enterprise Governance

Gradle governance biasanya dibangun dari:

```text
settings.gradle(.kts)
build.gradle(.kts) root conventions
convention plugins
version catalogs
java-platform projects
dependency verification
repository mode enforcement
CI wrapper validation
```

Gradle memberi fleksibilitas lebih tinggi daripada Maven. Itu berarti governance harus lebih sadar design.

---

## 11. Gradle Convention Plugin

Convention plugin adalah cara utama untuk mendistribusikan build policy di Gradle.

Contoh layout:

```text
company-build-logic/
  settings.gradle.kts
  build.gradle.kts
  src/main/kotlin/
    com.company.java-library-conventions.gradle.kts
    com.company.java-service-conventions.gradle.kts
    com.company.security-conventions.gradle.kts
    com.company.publishing-conventions.gradle.kts
```

Contoh convention plugin untuk Java library:

```kotlin
plugins {
    `java-library`
    jacoco
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(21)
    options.encoding = "UTF-8"
    options.compilerArgs.addAll(listOf("-Xlint:deprecation", "-Xlint:unchecked"))
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
    failFast = false
    testLogging {
        events("failed", "skipped")
    }
}

tasks.withType<AbstractArchiveTask>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}
```

Aplikasi memakai:

```kotlin
plugins {
    id("com.company.java-library-conventions")
}
```

Keuntungan:

- central policy;
- minimal boilerplate;
- versioned build logic;
- testing build logic;
- dapat migrate bertahap;
- dapat menyediakan beberapa profile convention.

---

## 12. `buildSrc` vs Included Build vs Published Plugin

Gradle punya beberapa tempat untuk build logic.

### 12.1 `buildSrc`

```text
root/
  buildSrc/
    src/main/kotlin/...
```

Kelebihan:

- mudah;
- otomatis tersedia untuk build;
- bagus untuk project kecil-menengah.

Kekurangan:

- perubahan kecil di `buildSrc` bisa invalidate configuration;
- sulit dibagi lintas repository;
- versioning kurang eksplisit.

### 12.2 Included Build / Composite Build

```kotlin
pluginManagement {
    includeBuild("build-logic")
}
```

Kelebihan:

- lebih eksplisit;
- bisa modular;
- cocok untuk monorepo;
- lebih bersih daripada `buildSrc`.

### 12.3 Published Plugin

```kotlin
plugins {
    id("com.company.java-service") version "3.1.0"
}
```

Kelebihan:

- cocok untuk enterprise multi-repo;
- versioned;
- immutable;
- bisa release tested;
- bisa rollback ke versi plugin sebelumnya.

Rekomendasi:

```text
Small repo        -> buildSrc okay
Large monorepo    -> included build build-logic
Enterprise multi-repo -> published convention plugin
```

---

## 13. Gradle Version Catalog Governance

`libs.versions.toml` membantu centralize dependency coordinates.

Contoh:

```toml
[versions]
junit = "5.11.4"
jackson = "2.19.0"
slf4j = "2.0.17"

[libraries]
junit-jupiter = { module = "org.junit.jupiter:junit-jupiter", version.ref = "junit" }
jackson-databind = { module = "com.fasterxml.jackson.core:jackson-databind", version.ref = "jackson" }
slf4j-api = { module = "org.slf4j:slf4j-api", version.ref = "slf4j" }

[plugins]
spotbugs = { id = "com.github.spotbugs", version = "6.1.0" }
```

Version catalog bagus untuk readability dan central coordinates, tetapi bukan enforcement lengkap.

Catalog tidak otomatis:

- mencegah dependency langsung tanpa catalog;
- mencegah dynamic version;
- menjamin alignment transitive;
- menggantikan platform/BOM.

Untuk enterprise, version catalog sering dikombinasikan dengan:

- Gradle platform;
- dependency constraints;
- custom rule;
- dependency verification;
- repository centralization.

---

## 14. Gradle Platform Governance

Gradle `java-platform` mirip BOM Maven.

Contoh:

```kotlin
plugins {
    `java-platform`
}

javaPlatform {
    allowDependencies()
}

dependencies {
    api(platform("com.fasterxml.jackson:jackson-bom:2.19.0"))

    constraints {
        api("org.slf4j:slf4j-api:2.0.17")
        api("ch.qos.logback:logback-classic:1.5.18")
    }
}
```

Project memakai:

```kotlin
dependencies {
    implementation(platform("com.company.platform:company-platform:2026.06.0"))
    implementation("org.slf4j:slf4j-api")
    implementation("com.fasterxml.jackson.core:jackson-databind")
}
```

Gunakan platform untuk alignment. Gunakan catalog untuk ergonomics. Gunakan convention plugin untuk behavior/policy.

---

## 15. Policy-as-Build

Policy-as-build berarti aturan organisasi dieksekusi saat build, bukan hanya ditulis di wiki.

Contoh policy:

```text
No direct repository declarations in subprojects.
No dynamic versions.
No SNAPSHOT in release build.
No unapproved license.
No Java version below baseline.
No test skipping in release pipeline.
No plugin without version.
No artifact publish from developer machine.
```

Policy-as-build harus memenuhi 5 kualitas:

1. **Explicit** — aturan jelas.
2. **Automated** — dicek otomatis.
3. **Actionable** — error message memberi solusi.
4. **Versioned** — policy berubah lewat release.
5. **Waivable** — exception bisa dikelola.

Tanpa waiver, policy akan dibypass. Dengan waiver tanpa expiry, policy kehilangan kekuatan.

---

## 16. Exception Governance

Enterprise nyata tidak pernah 100% bersih. Selalu ada legacy app, vendor dependency, runtime lama, emergency release, dan constraint business.

Karena itu perlu exception model.

Contoh waiver metadata:

```yaml
waivers:
  - id: BUILD-WAIVER-2026-014
    project: payment-legacy-adapter
    rule: java-baseline
    current: Java 8
    required: Java 17
    reason: Vendor SDK only supports Java 8 until Q4 migration
    owner: team-payment-platform
    approver: architecture-board
    expires: 2026-12-31
    mitigation:
      - isolated deployment
      - vulnerability scan weekly
      - migration ticket ARCH-9123
```

Build plugin bisa membaca waiver file dan memutuskan:

```text
Rule violated + valid waiver    -> warn
Rule violated + expired waiver  -> fail
Rule violated + no waiver       -> fail
```

Ini jauh lebih sehat daripada mematikan rule.

---

## 17. Governance Maturity Model

### Level 0 — Ad Hoc

Ciri-ciri:

- tiap repo punya cara sendiri;
- dependency version random;
- plugin version tidak dipin;
- CI sering beda dengan local;
- release dibangun manual.

Risiko:

- sulit audit;
- build sering rusak;
- vulnerability tidak terkendali;
- upgrade Java mahal.

---

### Level 1 — Documented Standard

Ciri-ciri:

- ada wiki standard;
- ada contoh Maven/Gradle template;
- belum enforcement kuat.

Risiko:

- template drift;
- project lama tidak ikut;
- developer bisa lupa.

---

### Level 2 — Shared Parent/Convention

Ciri-ciri:

- Maven parent POM;
- Gradle convention plugin;
- central plugin versions;
- central dependency versions.

Risiko:

- policy belum lengkap;
- exception belum rapi;
- visibility belum matang.

---

### Level 3 — Enforced Governance

Ciri-ciri:

- enforcer/custom rules;
- repository policy;
- vulnerability gate;
- release artifact immutable;
- CI required;
- no direct publish.

Risiko:

- false positives;
- developer frustration jika message buruk;
- bottleneck jika waiver lambat.

---

### Level 4 — Observable Governance

Ciri-ciri:

- dashboard dependency drift;
- Java baseline adoption tracked;
- vulnerability aging tracked;
- build failure taxonomy tracked;
- policy exception tracked.

Risiko:

- data overload;
- metrics dipakai menghukum, bukan memperbaiki.

---

### Level 5 — Platform Engineering

Ciri-ciri:

- build platform sebagai product;
- self-service templates;
- automated upgrade PR;
- internal plugin ecosystem;
- policy-as-code;
- exception workflow;
- migration playbook;
- developer experience dijaga.

Target top 1% engineer bukan hanya menulis build file bagus. Targetnya adalah mampu mendesain build platform seperti ini.

---

## 18. Governance untuk Java 8 sampai Java 25

Enterprise sering punya campuran:

```text
Java 8  -> legacy libraries, old app server, vendor SDK
Java 11 -> transitional runtime
Java 17 -> common modern enterprise baseline
Java 21 -> modern LTS baseline
Java 25 -> latest LTS / forward compatibility testing
```

Governance harus menghindari dua ekstrem:

1. Semua dipaksa upgrade sekaligus.
2. Legacy dibiarkan selamanya.

Strategi sehat:

```text
- Define current baseline.
- Define allowed legacy baseline.
- Define target baseline.
- Define deprecation date.
- Define test matrix.
- Define migration exception.
```

Contoh:

```text
Policy 2026:
- New service: Java 21 minimum
- Shared library: Java 8 only if consumed by legacy apps
- Java 11 app: must provide migration plan to Java 17/21
- Java 25: required in nightly compatibility test for platform libraries
```

Maven parent bisa punya variant:

```text
company-parent-java8
company-parent-java17
company-parent-java21
```

Gradle convention plugin bisa punya variant:

```kotlin
plugins {
    id("com.company.java8-library")
    // or
    id("com.company.java21-service")
}
```

Jangan membuat satu policy monolitik yang tidak bisa memodelkan realitas.

---

## 19. Standard Template vs Platform Contract

Template adalah starter. Contract adalah invariant jangka panjang.

Template:

```text
Generated once.
Developer can modify freely.
Drifts over time.
```

Platform contract:

```text
Versioned.
Updated centrally.
Enforced.
Observable.
```

Banyak organisasi merasa sudah punya governance karena punya template repo. Itu belum cukup.

Template membantu project baru. Governance menjaga project selama bertahun-tahun.

---

## 20. Enterprise Maven Blueprint

Contoh blueprint untuk organisasi Maven-heavy:

```text
company-build/
  company-parent/
    pom.xml
  company-bom/
    pom.xml
  company-enforcer-rules/
    pom.xml
  company-maven-plugin/
    pom.xml
  docs/
    policy.md
    migration-guide.md
```

Project aplikasi:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>com.company.platform</groupId>
    <artifactId>company-parent-java21</artifactId>
    <version>5.3.0</version>
  </parent>

  <groupId>com.company.case</groupId>
  <artifactId>case-service</artifactId>
  <version>${revision}</version>

  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
  </dependencies>
</project>
```

CI command:

```bash
mvn -B -ntp verify
```

Release command:

```bash
mvn -B -ntp -Drevision=1.12.0 -Dchangelist= clean verify deploy
```

Governance points:

- parent controls plugin behavior;
- BOM controls dependency versions;
- settings controls repositories;
- CI controls release identity;
- Enforcer controls policy violation.

---

## 21. Enterprise Gradle Blueprint

Contoh blueprint Gradle-heavy:

```text
company-build-platform/
  settings.gradle.kts
  build.gradle.kts
  build-logic/
    src/main/kotlin/
      com.company.java-library.gradle.kts
      com.company.java-service.gradle.kts
      com.company.security.gradle.kts
      com.company.publishing.gradle.kts
  platform/
    build.gradle.kts
  gradle/
    libs.versions.toml
```

Project aplikasi:

```kotlin
plugins {
    id("com.company.java-service") version "3.4.0"
}

dependencies {
    implementation(platform("com.company.platform:company-platform:2026.06.0"))
    implementation(libs.spring.boot.starter.web)
}
```

`settings.gradle.kts`:

```kotlin
pluginManagement {
    repositories {
        maven("https://repo.company.example/repository/gradle-plugins")
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven("https://repo.company.example/repository/maven-all")
    }
}
```

CI command:

```bash
./gradlew clean check --configuration-cache --build-cache
```

Release command:

```bash
./gradlew clean check publish \
  -Pversion=1.12.0 \
  --configuration-cache \
  --build-cache
```

Governance points:

- convention plugin controls behavior;
- platform controls dependency alignment;
- catalog controls ergonomic aliases;
- dependency verification controls artifact trust;
- settings controls repository boundary;
- CI controls publishing.

---

## 22. Policy Distribution Patterns

### Pattern A — Central Parent POM

Cocok untuk:

- Maven-heavy organization;
- banyak service seragam;
- lifecycle Maven cukup;
- tim butuh standard kuat.

Kelemahan:

- single inheritance;
- sulit untuk multiple orthogonal policies;
- parent version upgrade perlu PR ke semua repo.

---

### Pattern B — Corporate BOM Only

Cocok untuk:

- organisasi ingin mengontrol dependency version saja;
- project punya build style berbeda;
- library platform dipakai eksternal.

Kelemahan:

- tidak mengontrol plugin/build behavior;
- tidak cukup untuk governance penuh.

---

### Pattern C — Gradle Convention Plugin

Cocok untuk:

- Gradle-heavy organization;
- banyak variasi build;
- butuh composable policy;
- butuh advanced build logic.

Kelemahan:

- butuh skill Gradle lebih tinggi;
- plugin harus dijaga compatibility;
- salah design bisa membuat build lambat.

---

### Pattern D — CI Central Enforcement

Cocok untuk:

- organisasi polyglot;
- semua repo lewat CI sama;
- ingin enforce tanpa menyentuh build file terlalu banyak.

Kelemahan:

- local feedback lambat;
- developer baru tahu violation setelah push;
- sulit memberi fix otomatis.

---

### Pattern E — Repository Manager Enforcement

Cocok untuk:

- dependency ingress control;
- blocking vulnerable artifact;
- license control;
- artifact retention policy.

Kelemahan:

- tidak tahu konteks project;
- tidak menggantikan build policy;
- false positive bisa memblokir banyak tim.

---

## 23. Governance Anti-Patterns

### 23.1 God Parent POM

Parent POM terlalu banyak mengatur:

- semua plugin;
- semua dependency;
- semua profile;
- semua resource filtering;
- semua environment;
- semua framework;
- semua deployment.

Akibat:

- susah override;
- fragile;
- satu perubahan merusak banyak project;
- project tidak mengerti build-nya sendiri.

Solusi:

```text
Split parent, BOM, plugins, CI templates, and documentation.
```

---

### 23.2 Copy-Paste Governance

Setiap repo punya blok build policy copy-paste.

Akibat:

- drift;
- bug fix harus massal;
- standard terlihat sama tapi beda detail;
- audit sulit.

Solusi:

```text
Centralize behavior in parent/convention plugin.
```

---

### 23.3 Governance Without Escape Hatch

Semua violation fail, tidak ada waiver.

Akibat:

- tim bypass rule;
- custom local hack;
- build policy dimatikan;
- governance dianggap musuh delivery.

Solusi:

```text
Create waiver with owner, reason, mitigation, expiry.
```

---

### 23.4 Silent Override

Tim bisa override policy tanpa terlihat.

Contoh:

```xml
<properties>
  <maven.compiler.release>8</maven.compiler.release>
</properties>
```

padahal policy Java 21.

Solusi:

- enforce effective value;
- fail jika override tidak diizinkan;
- expose override report.

---

### 23.5 Security Theater

Build menghasilkan SBOM dan scan, tetapi:

- tidak ada threshold;
- tidak ada owner;
- tidak ada remediation SLA;
- waiver tidak expire;
- report tidak dibaca.

Solusi:

```text
Security scan must produce action, owner, and decision.
```

---

### 23.6 One Policy for All

Legacy library Java 8, Spring Boot service Java 21, Jakarta WAR, batch job, CLI tool, dan shared BOM dipaksa aturan sama.

Akibat:

- banyak exception;
- rule kehilangan kredibilitas;
- tim frustrasi.

Solusi:

```text
Define policy profiles by artifact type and lifecycle stage.
```

---

## 24. Policy Profile Berdasarkan Artifact Type

Governance lebih realistis jika membedakan tipe artifact.

### 24.1 Internal Library

Policy:

- strict API compatibility;
- semantic versioning;
- no runtime framework leakage;
- Java baseline jelas;
- publish source/javadoc;
- no SNAPSHOT release;
- dependency minimal.

### 24.2 Backend Service

Policy:

- runtime Java baseline;
- container image build;
- SBOM required;
- vulnerability gate;
- integration tests;
- config externalized;
- no environment-specific artifact.

### 24.3 Jakarta WAR/EAR

Policy:

- container-provided dependency as `provided`;
- no embedded server unless intended;
- classloader conflict check;
- Jakarta/Javax namespace policy;
- deployment descriptor validation.

### 24.4 Build Plugin

Policy:

- stricter security;
- minimal dependency;
- compatibility matrix;
- functional tests;
- versioned release;
- no secret access unless required;
- plugin metadata.

### 24.5 BOM/Platform

Policy:

- release notes mandatory;
- compatibility testing;
- dependency convergence check;
- no app-specific dependency;
- emergency patch flow.

---

## 25. Developer Experience dalam Governance

Governance yang benar bukan membuat developer menderita.

Error message harus menjawab:

1. Apa yang salah?
2. Kenapa ini salah?
3. Apa dampaknya?
4. Bagaimana memperbaikinya?
5. Bagaimana meminta exception jika memang perlu?

Contoh buruk:

```text
Execution failed for task ':checkPolicy'.
```

Contoh baik:

```text
Policy violation: Dynamic dependency version is not allowed.

Found:
  org.example:client:1.+ in :payment-service

Why this is blocked:
  Dynamic versions make release builds non-reproducible.

Fix:
  Use an explicit version from libs.versions.toml or company-platform.

Exception:
  Create BUILD-WAIVER with owner, reason, expiry <= 30 days.
```

Top 1% engineer peduli dengan enforcement dan usability.

---

## 26. Automated Upgrade Governance

Governance bukan hanya melarang. Governance juga harus membantu update.

Tools/process yang umum:

- automated dependency update PR;
- scheduled BOM/platform upgrade;
- generated changelog;
- test matrix run;
- compatibility report;
- security patch lane;
- deprecation dashboard.

Flow sehat:

```text
1. Platform team releases company-bom 2026.07.0.
2. Bot opens PR to services.
3. CI runs affected tests.
4. Failure categorized.
5. Service owner fixes or files exception.
6. Dashboard tracks adoption.
```

Tanpa upgrade automation, policy akan menua dan akhirnya menjadi beban.

---

## 27. Observability untuk Build Governance

Metric yang berguna:

```text
Dependency:
- number of unique versions per dependency family
- vulnerable dependency count
- vulnerability aging
- SNAPSHOT usage
- dynamic version usage

Java:
- project count by Java baseline
- migration progress
- unsupported Java usage

Build:
- median CI build time
- p95 CI build time
- flaky test rate
- cache hit rate
- top failing policy rules

Release:
- release frequency
- failed release count
- rollback count
- artifact promotion violations

Governance:
- active waivers
- expired waivers
- waivers by team
- policy adoption percentage
```

Jangan terlalu banyak metric. Pilih metric yang menghasilkan keputusan.

---

## 28. Governance Rollout Strategy

Jangan menerapkan semua rule dalam mode fail pada hari pertama.

Strategi rollout:

```text
Phase 1 — Observe
- scan all projects
- report violations
- no fail

Phase 2 — Warn
- local/CI warning
- dashboard published
- docs and fix examples

Phase 3 — Fail new violations
- existing violations grandfathered with waiver
- new violations fail

Phase 4 — Expire legacy violations
- require remediation plan
- fail expired waivers

Phase 5 — Continuous governance
- scheduled upgrades
- metrics
- exception review
```

Ini membuat governance dapat diterima secara sosial dan teknis.

---

## 29. Case Study: Java 8 Legacy + Java 21 New Services

### Situasi

Organisasi punya:

```text
- 20 legacy Java 8 libraries
- 30 Java 11 services
- 15 new Java 21 services
- Maven dan Gradle campur
- private Nexus
- security scan wajib
```

### Masalah

- dependency version berbeda-beda;
- beberapa service langsung akses Maven Central;
- plugin version tidak dipin;
- Java 8 library tidak sengaja memakai API Java 11;
- build release bisa dilakukan dari laptop;
- security report banyak tetapi tidak actionable.

### Desain Governance

```text
1. Repository:
   - all builds use Nexus group repository
   - direct external repo blocked in CI

2. Java policy:
   - Java 8 library must use --release 8
   - new service must use Java 21
   - Java 11 service must have migration plan

3. Maven:
   - company-parent-java8
   - company-parent-java21
   - company-bom
   - Maven Enforcer

4. Gradle:
   - com.company.java8-library plugin
   - com.company.java21-service plugin
   - company-platform
   - dependency verification

5. Security:
   - fail critical reachable runtime vulnerability
   - warning for test-only vulnerability
   - waiver with expiry

6. Release:
   - only CI publishes
   - artifact immutable
   - SBOM generated

7. Observability:
   - Java baseline dashboard
   - vulnerability aging dashboard
   - dependency drift dashboard
```

### Result yang Diharapkan

Bukan semua langsung bersih, tetapi:

- new violations berhenti;
- legacy terlihat jelas;
- migration punya prioritas;
- release lebih audit-friendly;
- dependency upgrade lebih terkendali;
- developer punya jalur fix dan exception.

---

## 30. Checklist Enterprise Governance Review

Gunakan checklist ini saat mereview build platform organisasi.

### 30.1 Policy

- [ ] Java baseline policy jelas.
- [ ] Repository policy jelas.
- [ ] Dependency version policy jelas.
- [ ] Plugin version policy jelas.
- [ ] Vulnerability threshold jelas.
- [ ] License policy jelas.
- [ ] Release artifact policy jelas.
- [ ] Exception policy jelas.

### 30.2 Maven

- [ ] Parent POM tidak menjadi God Parent.
- [ ] BOM dipisah dari parent behavior.
- [ ] Plugin versions dipin via `pluginManagement`.
- [ ] Maven Enforcer aktif.
- [ ] `settings.xml` mengatur mirror/repository.
- [ ] Release tidak memakai SNAPSHOT.
- [ ] Effective POM dapat diaudit.

### 30.3 Gradle

- [ ] Repository declaration centralized di settings.
- [ ] Convention plugin dipakai untuk shared behavior.
- [ ] Version catalog tidak dipakai sebagai satu-satunya governance.
- [ ] Platform/constraints dipakai untuk alignment.
- [ ] Dynamic versions diblokir.
- [ ] Dependency verification dipertimbangkan.
- [ ] Configuration cache compatibility dijaga.

### 30.4 CI/CD

- [ ] CI adalah satu-satunya jalur publish release.
- [ ] Cache tidak mengorbankan reproducibility.
- [ ] Secret tidak muncul di log.
- [ ] Build wrapper diverifikasi.
- [ ] SBOM/provenance dibuat untuk release penting.
- [ ] Artifact dipromosikan, bukan rebuild per environment.

### 30.5 Observability

- [ ] Ada dashboard Java baseline.
- [ ] Ada dashboard vulnerability aging.
- [ ] Ada dashboard dependency drift.
- [ ] Ada daftar waiver aktif dan expired.
- [ ] Build failure trend dianalisis.
- [ ] Policy adoption bisa diukur.

---

## 31. Prinsip Desain Governance untuk Top 1% Engineer

### 31.1 Govern Invariants, Not Preferences

Jangan enforce hal yang hanya selera.

Enforce:

- reproducibility;
- security;
- compatibility;
- artifact identity;
- repository trust;
- release integrity.

Jangan terlalu cepat enforce:

- style build script kecil;
- nama task custom jika tidak berdampak;
- framework pilihan jika tidak ada alasan platform.

---

### 31.2 Make the Right Path the Easy Path

Jika policy benar tetapi sulit dipatuhi, developer akan mencari jalan lain.

Contoh:

- sediakan starter;
- sediakan convention plugin;
- sediakan dependency alias;
- sediakan troubleshooting guide;
- sediakan auto-fix PR;
- sediakan waiver workflow.

---

### 31.3 Separate Policy from Mechanism

Policy:

```text
No SNAPSHOT dependencies in release.
```

Mechanism:

```text
Maven Enforcer rule
Gradle convention plugin check
CI release gate
Repository manager block
```

Policy harus bisa tetap sama meskipun mekanismenya berbeda antara Maven dan Gradle.

---

### 31.4 Version the Governance

Build governance harus versioned.

```text
company-parent 5.3.0
company-bom 2026.06.0
company-gradle-plugin 3.4.0
company-platform 2026.06.0
```

Jangan ubah behavior global tanpa versioning dan release note.

---

### 31.5 Prefer Gradual Enforcement

Policy baru sebaiknya:

```text
observe -> warn -> fail new violations -> fail all after deadline
```

Ini membuat governance credible dan manageable.

---

### 31.6 Treat Waiver as First-Class

Waiver bukan kegagalan. Waiver adalah cara mengelola realitas.

Waiver buruk:

```text
skipChecks=true
```

Waiver baik:

```text
id, owner, reason, expiry, mitigation, approver
```

---

### 31.7 Measure Drift

Enterprise build membusuk secara alami jika tidak diamati.

Drift muncul pada:

- dependency version;
- plugin version;
- Java baseline;
- repository usage;
- test discipline;
- release process;
- security waiver.

Governance matang mengukur drift dan memperbaikinya terus-menerus.

---

## 32. Kesimpulan

Enterprise build governance adalah kemampuan untuk membuat banyak tim bergerak cepat tanpa kehilangan kontrol atas keamanan, kualitas, reproducibility, dan release integrity.

Maven dan Gradle memberi mekanisme berbeda:

```text
Maven:
- parent POM
- BOM
- pluginManagement
- Maven Enforcer
- settings.xml
- reactor conventions

Gradle:
- convention plugin
- version catalog
- platform/constraints
- settings-level repository control
- dependency verification
- build cache/configuration cache policy
```

Tetapi prinsipnya sama:

```text
Define invariant.
Distribute policy.
Enforce automatically.
Allow explicit exception.
Observe drift.
Continuously improve.
```

Top 1% software engineer tidak hanya tahu cara membuat build sukses. Ia mampu mendesain build system sebagai platform organisasi: aman, reproducible, scalable, observable, dan manusiawi untuk developer yang menggunakannya.

---

## 33. Hubungan ke Part Berikutnya

Bagian ini membahas governance lintas organisasi. Part berikutnya akan masuk ke **Multi-Module Architecture for Large Java Systems**.

Kita akan membahas bagaimana module boundary, dependency direction, API/implementation split, test fixture, generated module, cyclic dependency prevention, dan build graph smell membentuk arsitektur sistem Java besar.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 20 — Security Engineering: Dependency Vulnerability, Plugin Trust, SBOM, Signing, SLSA, Supply Chain](./20-security-engineering.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 22 — Multi-Module Architecture for Large Java Systems](./22-multi-module-architecture-large-java-systems.md)

</div>