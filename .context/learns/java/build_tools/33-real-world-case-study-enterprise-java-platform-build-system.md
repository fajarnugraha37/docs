# Part 33 — Real-World Case Study: Designing Build System for Enterprise Java Platform

Seri: `learn-java-build-gradle-maven-engineering`  
File: `33-real-world-case-study-enterprise-java-platform-build-system.md`  
Target: Java 8–25, Maven, Gradle, enterprise platform engineering

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas komponen build engineering secara terpisah: Maven, Gradle, dependency graph, repository, reproducibility, CI/CD, release, security, governance, static analysis, observability, dan topologi repository.

Bagian ini menyatukan semuanya ke dalam satu studi kasus nyata:

> Bagaimana mendesain build system untuk enterprise Java platform besar yang punya banyak service, banyak module, banyak environment, regulatory pressure, security gate, legacy Java 8, modern Java 21/25, Jakarta/Spring workloads, generated code, private repository, CI/CD, dan release governance?

Tujuan utama bukan membuat contoh `pom.xml` atau `build.gradle.kts` yang terlihat rapi, tetapi membangun cara berpikir top-tier:

1. build system sebagai **control plane engineering**, bukan hanya automation script;
2. dependency sebagai **risk graph**, bukan hanya library list;
3. artifact sebagai **legal/operational evidence**, bukan hanya `.jar`;
4. CI/CD sebagai **state machine**, bukan hanya sequence job;
5. governance sebagai **guardrail**, bukan birokrasi;
6. observability sebagai **feedback loop**, bukan report kosmetik.

---

## 1. Case Study Context

Bayangkan sebuah enterprise/regulatory platform bernama:

```text
Regulatory Enforcement Platform (REP)
```

Platform ini menangani lifecycle enforcement case:

```text
intake -> validation -> screening -> assignment -> investigation -> escalation
       -> legal review -> decision -> correspondence -> payment/fine -> closure
       -> appeal -> audit/reporting
```

Karakteristik teknis:

```text
Language baseline:
- legacy shared libraries masih Java 8
- mayoritas service baru Java 17/21
- target strategis Java 25 untuk build/runtime modernization

Build tools:
- beberapa legacy module memakai Maven
- beberapa service baru ingin Gradle
- enterprise belum bisa migrasi sekaligus

Application stack:
- Spring Boot service
- Jakarta EE/WAR module legacy
- Keycloak SPI provider
- OpenAPI-generated client/server stubs
- jOOQ/JPA metamodel/generated code
- database migration Flyway/Liquibase
- contract tests
- container images

Repository model:
- polyrepo untuk service besar
- shared library repo
- central platform BOM repo
- internal Nexus/Artifactory repository

Quality/security:
- dependency vulnerability scan
- SBOM
- signing/checksum
- static analysis
- coverage threshold
- architecture rule
- release audit evidence

Operational constraint:
- build harus reproducible enough untuk audit
- release harus traceable dari Git commit ke deployed artifact
- hotfix harus cepat tetapi tetap aman
- dependency upgrade harus governed
```

Masalah nyata yang sering muncul:

```text
- service A build di lokal, gagal di CI
- service B runtime error karena Jackson mismatch
- service C compile Java 8 tapi transitive dependency sudah Java 11 bytecode
- module D generated code berubah tiap build karena timestamp/order tidak stabil
- WAR legacy membawa jakarta API yang seharusnya provided
- Keycloak SPI dikompilasi dengan versi dependency yang beda dari runtime Keycloak
- CI lambat karena semua module dites setiap PR
- parent POM terlalu banyak memaksa, tim melakukan bypass
- Gradle build cache tidak dipercaya karena task custom tidak benar input/output-nya
- release artifact di-rebuild per environment
- dependency scan ada critical CVE tapi tidak jelas owner remediation-nya
```

---

## 2. Core Design Principle

Untuk platform seperti ini, build system harus didesain dengan prinsip berikut:

```text
Source code + build definition + locked dependency + toolchain + CI policy
       -> reproducible/verifiable artifact
       -> promoted across environment
       -> observable and auditable release evidence
```

Dengan kata lain:

```text
Build bukan hanya menghasilkan artifact.
Build menghasilkan confidence.
```

Confidence yang dimaksud:

| Confidence | Pertanyaan yang Harus Bisa Dijawab |
|---|---|
| Compilation confidence | Apakah source valid untuk Java baseline yang ditentukan? |
| Dependency confidence | Dependency mana yang masuk compile/runtime/test? Versinya dari mana? |
| Compatibility confidence | Apakah artifact kompatibel dengan runtime Java/app server/container? |
| Test confidence | Test apa yang sudah berjalan dan apa boundary-nya? |
| Security confidence | Vulnerability, license, checksum, signing, SBOM sudah dicek? |
| Release confidence | Artifact ini berasal dari commit/tag mana? Dibangun oleh pipeline mana? |
| Reproducibility confidence | Artifact bisa direkonstruksi atau minimal diverifikasi lineage-nya? |
| Operational confidence | Build failure bisa didiagnosis cepat dan sistematis? |

---

## 3. Decide Build Tool Strategy: Maven, Gradle, atau Hybrid?

Karena platform memiliki legacy Maven dan service baru yang ingin Gradle, keputusan paling realistis bukan memilih satu tool secara dogmatis.

### 3.1 Pilihan A — Full Maven Standardization

Cocok bila:

```text
- organisasi sangat mengutamakan standard lifecycle
- banyak developer familiar Maven
- enterprise parent POM sudah matang
- build logic tidak terlalu dinamis
- governance lebih penting daripada build expressiveness
```

Kelebihan:

```text
- predictable lifecycle
- mudah diaudit
- banyak enterprise tool support
- dependencyManagement/BOM familiar
- cocok untuk library dan Jakarta/WAR legacy
```

Kekurangan:

```text
- advanced graph modeling lebih terbatas
- tidak ada native lockfile sekuat Gradle dependency locking
- custom behavior sering tersebar di plugin/profile
- affected build/test lebih sulit tanpa tooling tambahan
```

### 3.2 Pilihan B — Full Gradle Standardization

Cocok bila:

```text
- platform punya banyak module dan butuh build performance serius
- banyak code generation/task custom
- butuh remote build cache
- butuh composite build/convention plugin
- team punya skill build engineering cukup kuat
```

Kelebihan:

```text
- expressive task graph
- build cache/configuration cache
- lazy configuration
- variant-aware dependency management
- convention plugin kuat untuk enterprise governance
```

Kekurangan:

```text
- build logic bisa terlalu bebas
- debugging butuh mental model lebih dalam
- plugin custom harus cache/configuration-cache aware
- governance buruk bisa membuat build tidak konsisten
```

### 3.3 Pilihan C — Hybrid dengan Platform Governance Bersama

Untuk case study ini, pilihan terbaik adalah hybrid terkendali:

```text
- Maven tetap untuk legacy/Jakarta/library tertentu
- Gradle dipakai untuk service baru dan build yang butuh performance/custom graph
- governance disatukan via:
  - corporate BOM/platform
  - approved repository policy
  - security scanning standard
  - Java baseline policy
  - CI/release state machine yang sama
  - artifact metadata/SBOM/provenance yang sama
```

Penting:

```text
Hybrid tidak boleh berarti setiap tim bebas seenaknya.
Hybrid hanya sehat bila policy-nya sama, walau implementation tool-nya berbeda.
```

---

## 4. Target Architecture: Build Control Plane

Untuk enterprise platform, buat lapisan build control plane seperti berikut:

```text
                          +---------------------------+
                          | Enterprise Build Policy   |
                          | Java baseline, security,  |
                          | repository, release rules |
                          +-------------+-------------+
                                        |
           +----------------------------+-----------------------------+
           |                                                          |
+----------v-----------+                                  +-----------v----------+
| Maven Governance     |                                  | Gradle Governance    |
| parent POM           |                                  | convention plugins   |
| corporate BOM        |                                  | version catalog      |
| enforcer rules       |                                  | platform constraints |
+----------+-----------+                                  +-----------+----------+
           |                                                          |
+----------v-----------+                                  +-----------v----------+
| Maven Projects       |                                  | Gradle Projects      |
| legacy WAR/library   |                                  | services/platform    |
+----------+-----------+                                  +-----------+----------+
           |                                                          |
           +----------------------------+-----------------------------+
                                        |
                          +-------------v-------------+
                          | CI/CD State Machine       |
                          | validate/test/package/    |
                          | scan/publish/promote      |
                          +-------------+-------------+
                                        |
                          +-------------v-------------+
                          | Artifact Evidence Store   |
                          | JAR/WAR/image/SBOM/logs/  |
                          | test report/provenance    |
                          +---------------------------+
```

Mental model:

```text
Maven parent POM dan Gradle convention plugin adalah implementation detail.
Policy-nya harus sama.
```

---

## 5. Repository Topology

Gunakan hybrid polyrepo dengan shared governance repository.

```text
rep-platform-governance/
  maven-parent/
  maven-bom/
  gradle-platform/
  gradle-version-catalog/
  gradle-convention-plugins/
  quality-rules/
  ci-templates/
  release-policy/

rep-shared-libraries/
  rep-common-domain/
  rep-common-security/
  rep-common-audit/
  rep-common-test-fixtures/

rep-case-service/
  build.gradle.kts or pom.xml
  src/main/java
  src/test/java
  src/integrationTest/java

rep-correspondence-service/
  ...

rep-legacy-jakarta-war/
  pom.xml
  src/main/java
  src/main/webapp

rep-keycloak-spi/
  pom.xml or build.gradle.kts
  src/main/java
  src/main/resources/META-INF/services

rep-openapi-contracts/
  case-api.yaml
  correspondence-api.yaml
  screening-api.yaml

rep-deployment/
  helm/kustomize/terraform/pipeline manifests
```

Kunci desain:

```text
- governance repo bukan tempat business code
- shared libraries tidak boleh menjadi dumping ground
- contracts punya lifecycle sendiri
- deployment repo tidak boleh rebuild application artifact
- setiap service punya ownership jelas
```

---

## 6. Module Topology for One Service

Contoh service besar: `case-service`.

```text
case-service/
  settings.gradle.kts
  build.gradle.kts

  build-logic/                         # optional included build untuk convention local

  case-api/                            # DTO/API contract internal
  case-domain/                         # domain model, state machine, invariants
  case-application/                    # use case orchestration
  case-persistence-jpa/                # JPA adapter
  case-web-rest/                       # REST adapter
  case-messaging/                      # event/Rabbit/Kafka adapter
  case-client-generated/               # generated OpenAPI/gRPC client
  case-db-migration/                   # Flyway/Liquibase migrations
  case-test-fixtures/                  # shared fixtures for tests
  case-app/                            # runtime assembly / Spring Boot main
```

Dependency direction:

```text
case-app
  -> case-web-rest
  -> case-messaging
  -> case-persistence-jpa
  -> case-application
  -> case-domain
  -> case-api

case-application -> case-domain
case-persistence-jpa -> case-domain
case-web-rest -> case-application
case-messaging -> case-application
case-client-generated -> external contract artifacts
```

Forbidden direction:

```text
case-domain -> case-persistence-jpa       # forbidden
case-domain -> case-web-rest              # forbidden
case-domain -> Spring/Jakarta runtime     # mostly forbidden
case-api -> case-application              # forbidden
case-test-fixtures -> production runtime  # forbidden, except test scope
```

Why this matters for build:

```text
Build graph exposes architecture graph.
If build dependency direction is messy, architecture is probably messy too.
```

---

## 7. Java Version Policy: Java 8–25

Enterprise Java platform rarely upgrades all modules at once. Define baseline categories.

| Category | Example | Compile Target | Runtime | Rule |
|---|---|---:|---:|---|
| Legacy library | `rep-common-legacy` | Java 8 | 8/11/17/21/25 | Must use `--release 8` or equivalent |
| Shared modern library | `rep-common-audit` | Java 17 | 17/21/25 | No Java 21 API unless baseline raised |
| Service app | Spring Boot service | Java 21 | 21/25 | Toolchain pinned |
| Experimental service | internal only | Java 25 | 25 | Not used by Java 21 consumers |
| Keycloak SPI | provider JAR | Keycloak runtime baseline | Keycloak runtime | Must match runtime server compatibility |
| Jakarta WAR legacy | WAR | app server JDK | app server JDK | Container APIs `provided` |

Policy examples:

```text
P1. Libraries consumed by Java 8 applications must compile with Java 8 bytecode.
P2. Services may run Java 21, but cannot publish libraries requiring Java 21 unless declared.
P3. Java 25 is allowed for build/test experimentation only until runtime platform certification.
P4. Annotation processors must be compatible with the JDK used to compile.
P5. CI must verify at least compile/test matrix for supported runtimes.
```

Maven example:

```xml
<properties>
  <maven.compiler.release>17</maven.compiler.release>
</properties>
```

Gradle example:

```kotlin
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(17)
}
```

Important distinction:

```text
JDK that runs the build != JDK used by javac != JDK used by tests != JDK used in production.
```

---

## 8. Governance Artifacts

### 8.1 Maven Corporate Parent

`rep-parent-pom` controls:

```text
- Java baseline defaults
- plugin versions
- reproducible build timestamp policy
- compiler plugin
- surefire/failsafe
- jacoco
- enforcer
- dependency plugin
- source/javadoc jars
- signing/publishing defaults
```

Example structure:

```xml
<project>
  <groupId>com.company.rep</groupId>
  <artifactId>rep-parent</artifactId>
  <version>2026.06.0</version>
  <packaging>pom</packaging>

  <properties>
    <project.build.outputTimestamp>${git.commit.time}</project.build.outputTimestamp>
    <maven.compiler.release>17</maven.compiler.release>
    <project.reporting.outputEncoding>UTF-8</project.reporting.outputEncoding>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>

  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>com.company.rep</groupId>
        <artifactId>rep-bom</artifactId>
        <version>${revision}</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>

  <build>
    <pluginManagement>
      <!-- Pin plugin versions here -->
    </pluginManagement>
  </build>
</project>
```

Rule:

```text
Parent configures build behavior.
BOM configures dependency versions.
Do not mix responsibilities casually.
```

### 8.2 Corporate BOM

`rep-bom` controls approved dependency versions:

```text
- Spring Boot version alignment
- Jackson version
- Netty version
- logging stack
- Jakarta APIs
- testing stack
- security patches
- generated-code tool runtime libraries
```

Example:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-dependencies</artifactId>
      <version>3.x.y</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>

    <dependency>
      <groupId>com.fasterxml.jackson</groupId>
      <artifactId>jackson-bom</artifactId>
      <version>...</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

### 8.3 Gradle Version Catalog

`libs.versions.toml`:

```toml
[versions]
springBoot = "3.x.y"
jackson = "2.x.y"
junit = "5.x.y"

[libraries]
junit-jupiter = { module = "org.junit.jupiter:junit-jupiter", version.ref = "junit" }
jackson-databind = { module = "com.fasterxml.jackson.core:jackson-databind", version.ref = "jackson" }

[plugins]
spring-boot = { id = "org.springframework.boot", version.ref = "springBoot" }
```

Rule:

```text
Version catalog improves readability.
Platform/constraints enforce graph alignment.
Use both intentionally.
```

### 8.4 Gradle Convention Plugin

Example plugin responsibilities:

```text
com.company.rep.java-library-conventions
com.company.rep.spring-service-conventions
com.company.rep.quality-conventions
com.company.rep.security-conventions
com.company.rep.publishing-conventions
```

Convention plugin example:

```kotlin
class RepJavaLibraryConventionPlugin : Plugin<Project> {
    override fun apply(project: Project) = with(project) {
        pluginManager.apply("java-library")
        pluginManager.apply("jacoco")

        extensions.configure<JavaPluginExtension> {
            toolchain.languageVersion.set(JavaLanguageVersion.of(21))
            withSourcesJar()
            withJavadocJar()
        }

        tasks.withType<Test>().configureEach {
            useJUnitPlatform()
        }
    }
}
```

---

## 9. Dependency Governance

### 9.1 Dependency Classification

Classify dependency by risk:

| Class | Example | Governance |
|---|---|---|
| Platform-managed | Spring Boot, Jackson, Netty | Version from BOM/platform only |
| Security-sensitive | crypto, auth, JWT, XML parser | Security review required |
| Runtime container-provided | Servlet/Jakarta API | `provided`/`compileOnly` |
| Test-only | JUnit, Mockito, Testcontainers | Test scope only |
| Codegen tool | OpenAPI generator, jOOQ generator | Build/codegen configuration only |
| Internal shared lib | `rep-common-*` | Published via internal repo |
| Legacy exception | Java 8-only lib | Waiver + migration owner |

### 9.2 Maven Policy

```xml
<dependencyManagement>
  <!-- versions centralized -->
</dependencyManagement>

<build>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-enforcer-plugin</artifactId>
      <executions>
        <execution>
          <goals>
            <goal>enforce</goal>
          </goals>
          <configuration>
            <rules>
              <dependencyConvergence />
              <requireUpperBoundDeps />
              <requireMavenVersion>
                <version>[3.9,)</version>
              </requireMavenVersion>
              <requireJavaVersion>
                <version>[17,)</version>
              </requireJavaVersion>
            </rules>
          </configuration>
        </execution>
      </executions>
    </plugin>
  </plugins>
</build>
```

### 9.3 Gradle Policy

```kotlin
dependencies {
    implementation(platform("com.company.rep:rep-platform:2026.06.0"))
    testImplementation(libs.junit.jupiter)
}

configurations.configureEach {
    resolutionStrategy {
        failOnVersionConflict()
    }
}
```

Dependency verification:

```bash
./gradlew --write-verification-metadata sha256 help
```

### 9.4 Forbidden Dependencies

Examples:

```text
- no log4j 1.x
- no commons-collections vulnerable versions
- no javax.servlet in Jakarta Boot 3 services unless legacy-specific
- no jakarta.servlet-api bundled in executable app unless required
- no snapshot dependency in release branch
- no dynamic versions in release build
- no direct dependency on internal implementation module from external service
```

---

## 10. Repository Engineering for the Platform

Repository topology:

```text
Developer/CI
   |
   v
Internal Repository Group
   |-- internal-releases
   |-- internal-snapshots
   |-- maven-central-proxy
   |-- gradle-plugin-proxy
   |-- approved-third-party
```

Rules:

```text
R1. Builds do not access Maven Central directly in CI.
R2. All dependency resolution goes through internal repository manager.
R3. Release artifacts are immutable.
R4. Snapshots are not promoted to production.
R5. External repository additions require platform approval.
R6. Credentials are injected by CI, not committed.
```

Maven `settings.xml` pattern:

```xml
<mirrors>
  <mirror>
    <id>company-repository</id>
    <mirrorOf>*</mirrorOf>
    <url>https://repo.company.example/repository/maven-group/</url>
  </mirror>
</mirrors>
```

Gradle repository centralization:

```kotlin
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven("https://repo.company.example/repository/maven-group/")
    }
}
```

---

## 11. Reproducible Artifact Strategy

The platform defines three levels:

### Level 1 — Repeatable Build

```text
Same branch usually builds successfully.
```

Good for local dev. Not enough for release.

### Level 2 — Reproducible Enough for Enterprise Release

```text
- wrapper/tool version pinned
- plugin versions pinned
- dependency versions pinned/locked
- artifact metadata captured
- timestamp normalized where possible
- CI image version recorded
- SBOM generated
- artifact promoted, not rebuilt per environment
```

This is realistic target for most enterprise systems.

### Level 3 — Bit-for-Bit Reproducible

```text
Given same source, environment, and instructions,
artifact output is byte-identical.
```

Harder, but should be pursued for shared libraries/security-sensitive artifacts.

Maven pattern:

```xml
<properties>
  <project.build.outputTimestamp>${git.commit.time}</project.build.outputTimestamp>
</properties>
```

Gradle pattern:

```kotlin
tasks.withType<AbstractArchiveTask>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}
```

Release rule:

```text
Build once. Scan once. Publish once. Promote same artifact across environments.
```

Anti-pattern:

```text
DEV artifact != UAT artifact != PROD artifact because each environment rebuilds from source.
```

---

## 12. CI/CD State Machine

Model CI/CD as state machine.

```text
[Source Commit]
      |
      v
[Validate Build Definition]
      |
      v
[Compile]
      |
      v
[Unit Test]
      |
      v
[Static Analysis]
      |
      v
[Integration Test]
      |
      v
[Package Artifact]
      |
      v
[Security Scan + SBOM]
      |
      v
[Publish Candidate Artifact]
      |
      v
[Deploy to Test Environment]
      |
      v
[Promotion Approval]
      |
      v
[Promote Same Artifact]
      |
      v
[Production Release]
```

Each transition has gate conditions.

| Transition | Gate |
|---|---|
| Commit -> Compile | wrapper validated, dependency metadata valid |
| Compile -> Unit Test | no compile errors, Java baseline respected |
| Unit Test -> Static Analysis | unit tests pass |
| Static Analysis -> Integration | no blocking quality issue |
| Integration -> Package | integration tests pass |
| Package -> Scan | artifact produced with metadata |
| Scan -> Publish | vulnerabilities/license policy pass or waiver exists |
| Publish -> Deploy | artifact immutable and traceable |
| Deploy -> Promote | smoke/UAT evidence attached |
| Promote -> Prod | approval + rollback plan |

---

## 13. CI Pipeline Blueprint

### 13.1 Pull Request Pipeline

Goal: fast feedback.

```text
- validate wrapper
- validate build files
- compile affected modules
- unit tests affected modules
- lightweight static analysis
- dependency policy check
- no publishing
```

Example commands:

Maven:

```bash
./mvnw -B -ntp -pl :case-app -am verify
```

Gradle:

```bash
./gradlew build --continue
```

With affected build tooling:

```bash
./gradlew :case-app:test :case-application:test
```

### 13.2 Main Branch Pipeline

Goal: integration confidence.

```text
- full compile
- full unit test
- integration test
- static analysis
- dependency vulnerability scan
- SBOM generation
- package candidate artifact
- publish snapshot/candidate
```

### 13.3 Release Pipeline

Goal: auditable artifact.

```text
- clean checkout by tag/release commit
- no dynamic versions
- release version only
- compile/test/package
- security scan
- SBOM
- signing/checksum
- publish release artifact
- produce release evidence bundle
```

### 13.4 Nightly Pipeline

Goal: broad risk discovery.

```text
- full matrix test across Java 17/21/25 where relevant
- slow integration tests
- mutation testing subset
- dependency update simulation
- performance benchmark smoke
- container vulnerability scan
```

---

## 14. Testing Architecture

Testing tiers:

```text
Unit tests:
- fast
- no external dependency
- run on every PR

Integration tests:
- DB/message broker/container
- run on main and release
- selected subset on PR when affected

Contract tests:
- validate API producer/consumer compatibility
- run on contract changes and release

Functional tests:
- test deployed service behavior
- run after deployment to test env

Smoke tests:
- minimal confidence after deployment
- run on every deployment

Benchmark tests:
- JMH or performance smoke
- nightly/release candidate only
```

Recommended module arrangement:

```text
case-domain/src/test/java
case-application/src/test/java
case-persistence-jpa/src/integrationTest/java
case-web-rest/src/integrationTest/java
case-app/src/smokeTest/java
```

Maven:

```text
Surefire -> unit tests
Failsafe -> integration tests
```

Gradle:

```text
test -> unit tests
integrationTest -> integration tests
functionalTest -> functional tests
```

---

## 15. Code Generation Pipeline

Example generated sources:

```text
- OpenAPI client/server stubs
- Protobuf/gRPC Java classes
- jOOQ database DSL
- JPA static metamodel
- JAXB from XSD
- QueryDSL Q-types
```

Rule:

```text
Generated code must have explicit source of truth.
```

Source-of-truth table:

| Generated Code | Source of Truth | Build Rule |
|---|---|---|
| OpenAPI client | `rep-openapi-contracts/*.yaml` | generate in dedicated module |
| jOOQ | database schema/migration snapshot | generate in build or controlled CI step |
| JPA metamodel | JPA entities | annotation processor output not committed |
| Protobuf | `.proto` files | generate during build |
| JAXB | `.xsd` files | generate during build |

Determinism rules:

```text
- pin generator version
- pin input schema version
- disable timestamps/banner if possible
- generate into build directory, not src/main/java, unless consciously committed
- generated module has clear artifact boundary
- contract drift checked in CI
```

Anti-pattern:

```text
Developer manually regenerates code locally, commits partial output, CI regenerates different output.
```

---

## 16. Packaging Strategy

Artifact types:

| Workload | Packaging | Rule |
|---|---|---|
| Spring Boot service | executable JAR/container image | build once, promote image/artifact |
| Legacy Jakarta app | WAR | APIs provided by app server |
| Keycloak SPI | provider JAR | no conflicting runtime server libs |
| Shared library | plain JAR + sources/javadoc | no app config/secrets |
| CLI/batch | executable JAR or distribution | runtime dependencies explicit |
| Native experiment | native image | separate artifact class |

Spring service packaging:

```text
source -> compiled classes -> tested JAR -> SBOM -> image -> signed/published artifact
```

WAR packaging:

```text
source -> WAR -> deploy to certified app server -> container-provided API checked
```

Keycloak SPI packaging:

```text
source -> provider JAR -> service loader file -> no bundled Keycloak runtime duplicates -> deploy into providers/
```

---

## 17. Security Architecture

Security gates by stage:

| Stage | Security Control |
|---|---|
| Dependency resolution | internal repository only, checksum verification, dependency verification |
| Build definition | wrapper validation, plugin version pinning |
| Compile/test | no secret logs, no network test unless explicit |
| Package | no secrets in artifact, no forbidden classes |
| Scan | dependency vulnerability, license, container scan |
| Publish | signing/checksum, SBOM, provenance metadata |
| Deploy | least-privilege token, environment-specific secret injection |

SBOM rule:

```text
Every release artifact must have SBOM tied to artifact digest/version.
```

Waiver rule:

```text
Security waiver requires owner, expiry, CVE/license reference, compensating control, and remediation date.
```

Dependency confusion prevention:

```text
- internal groupId namespace reserved
- repository order controlled
- CI uses internal mirror only
- no project-defined ad-hoc external repositories
- plugin portal access proxied/controlled
```

---

## 18. Static Analysis and Architecture Enforcement

Quality gates:

```text
- compile warnings policy
- Checkstyle/formatting baseline
- SpotBugs/Error Prone for high-value checks
- ArchUnit for module/layer boundaries
- JaCoCo for meaningful coverage threshold
- mutation testing for critical domain modules
- Revapi/japicmp for public library compatibility
```

Architecture rules example:

```text
- domain package must not depend on Spring Web/JPA implementation
- application package must not depend on REST controller
- adapter modules can depend inward only
- generated client module must not leak generator runtime unnecessarily
- test fixtures must not be on production runtime classpath
```

Important:

```text
Quality gate should protect invariants, not enforce arbitrary taste.
```

---

## 19. Observability and Evidence

Every build should emit evidence:

```text
- Git commit SHA
- branch/tag
- build tool version
- JDK version
- dependency graph report
- test report
- coverage report
- static analysis report
- vulnerability scan report
- SBOM
- artifact checksum
- container digest if applicable
- release notes/changelog
- deployment target
```

Evidence bundle:

```text
release-evidence/
  artifact-metadata.json
  dependency-tree.txt
  sbom.cdx.json
  test-report.zip
  coverage-report.zip
  static-analysis-report.zip
  vulnerability-report.json
  checksums.txt
  provenance.json
  changelog.md
```

Build health metrics:

```text
- PR feedback time
- main build duration
- release build duration
- flaky test rate
- cache hit rate
- dependency vulnerability aging
- dependency freshness
- number of waivers by age
- failed builds by category
- average time to diagnose build failure
```

---

## 20. Release Engineering Model

Release state machine:

```text
SNAPSHOT
   -> CANDIDATE
   -> RELEASED
   -> DEPLOYED_TO_TEST
   -> APPROVED_FOR_PROD
   -> DEPLOYED_TO_PROD
   -> SUPERSEDED / ROLLED_BACK
```

Rules:

```text
- Release artifact is immutable.
- Production deployment uses promoted artifact, not rebuild.
- Release version must not contain SNAPSHOT dependencies.
- Release tag maps to exactly one artifact set.
- Rollback deploys previous known-good artifact, not source revert rebuild.
```

Versioning examples:

```text
Service app:
  2026.06.17.1 or 1.24.0

Shared library:
  semantic versioning: 2.3.1

BOM/platform:
  2026.06.0

Hotfix:
  1.24.1 or 2026.06.17.2
```

Release checklist:

```text
[ ] release version set
[ ] dependency graph frozen
[ ] tests passed
[ ] security scan passed or waiver attached
[ ] SBOM generated
[ ] artifact checksum captured
[ ] artifact published to release repository
[ ] release tag created
[ ] changelog generated
[ ] deployment plan approved
[ ] rollback target identified
```

---

## 21. Migration Roadmap

This platform cannot become ideal overnight. Use phased migration.

### Phase 0 — Inventory

Collect:

```text
- all repositories
- build tools and versions
- Java versions
- published artifacts
- dependency graph
- CI pipelines
- repository usage
- security scan status
- owners
- release frequency
```

### Phase 1 — Standardize Baseline

Introduce:

```text
- wrapper required
- no direct external repo in CI
- plugin versions pinned
- Java baseline documented
- artifact publishing rules
- security scan minimum
```

### Phase 2 — Centralize Version Management

Introduce:

```text
- Maven BOM
- Gradle platform/catalog
- dependency update process
- forbidden dependency list
- dependency conflict playbook
```

### Phase 3 — Improve CI/CD

Introduce:

```text
- build once/promote same artifact
- PR/main/release pipeline distinction
- cache strategy
- evidence bundle
- failure taxonomy dashboard
```

### Phase 4 — Governance as Code

Introduce:

```text
- Maven Enforcer rules
- Gradle convention plugins
- ArchUnit rules
- SBOM/provenance gate
- waiver workflow
```

### Phase 5 — Optimize and Modernize

Introduce:

```text
- affected module builds
- remote build cache
- Java 21/25 migration
- module boundary refactoring
- reproducibility improvements
- dependency freshness automation
```

---

## 22. Example Maven Service Blueprint

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>com.company.rep</groupId>
    <artifactId>rep-parent</artifactId>
    <version>2026.06.0</version>
  </parent>

  <groupId>com.company.rep.case</groupId>
  <artifactId>case-service</artifactId>
  <version>${revision}</version>
  <packaging>jar</packaging>

  <properties>
    <revision>1.24.0-SNAPSHOT</revision>
    <maven.compiler.release>21</maven.compiler.release>
  </properties>

  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>com.company.rep</groupId>
        <artifactId>rep-bom</artifactId>
        <version>2026.06.0</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>

  <dependencies>
    <dependency>
      <groupId>com.company.rep</groupId>
      <artifactId>rep-common-audit</artifactId>
    </dependency>

    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <!-- compiler/surefire/failsafe/jacoco/enforcer inherited or configured from parent -->
    </plugins>
  </build>
</project>
```

---

## 23. Example Gradle Service Blueprint

`settings.gradle.kts`:

```kotlin
pluginManagement {
    repositories {
        maven("https://repo.company.example/repository/gradle-plugins/")
        maven("https://repo.company.example/repository/maven-group/")
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven("https://repo.company.example/repository/maven-group/")
    }
}

rootProject.name = "case-service"
include(
    "case-api",
    "case-domain",
    "case-application",
    "case-persistence-jpa",
    "case-web-rest",
    "case-app"
)
```

`build.gradle.kts`:

```kotlin
plugins {
    id("com.company.rep.spring-service-conventions") version "2026.06.0" apply false
    id("com.company.rep.java-library-conventions") version "2026.06.0" apply false
}

subprojects {
    group = "com.company.rep.case"
    version = providers.gradleProperty("releaseVersion").orElse("1.24.0-SNAPSHOT").get()
}
```

`case-domain/build.gradle.kts`:

```kotlin
plugins {
    id("com.company.rep.java-library-conventions")
}

dependencies {
    api(project(":case-api"))
    testImplementation(libs.junit.jupiter)
}
```

`case-app/build.gradle.kts`:

```kotlin
plugins {
    id("com.company.rep.spring-service-conventions")
}

dependencies {
    implementation(project(":case-web-rest"))
    implementation(project(":case-persistence-jpa"))
    implementation(project(":case-application"))
}
```

---

## 24. Failure Scenario Walkthroughs

### Scenario 1 — CI Fails but Local Passes

Symptoms:

```text
CI: UnsupportedClassVersionError
Local: pass
```

Likely causes:

```text
- local uses Java 21, CI runtime uses Java 17
- dependency compiled for higher Java version
- toolchain not pinned
- test runtime differs from compile target
```

Diagnosis:

```bash
java -version
./mvnw -version
./gradlew -version
mvn dependency:tree
./gradlew dependencyInsight --dependency problematic-lib --configuration runtimeClasspath
javap -verbose SomeClass.class | grep "major"
```

Fix:

```text
- pin toolchain
- enforce dependency bytecode baseline
- update CI image
- downgrade/replace dependency
```

### Scenario 2 — WAR Fails on App Server

Symptoms:

```text
ClassCastException or NoSuchMethodError involving Jakarta/Servlet classes
```

Likely causes:

```text
- bundled servlet/jakarta API should be provided
- app server has different implementation version
- javax/jakarta namespace mixed
```

Fix:

```text
- mark container APIs as provided/compileOnly
- align Jakarta EE version with server
- inspect WAR contents
```

### Scenario 3 — Keycloak SPI Works in Dev but Fails in Runtime

Symptoms:

```text
Provider JAR builds, but Keycloak fails to start/load provider
```

Likely causes:

```text
- missing META-INF/services entry
- provider compiled against incompatible Keycloak version
- bundled dependencies conflict with Keycloak runtime
- Java version mismatch
```

Fix:

```text
- align provider compile dependencies with target Keycloak server
- avoid bundling server-provided dependencies
- test in container matching runtime
```

### Scenario 4 — Generated Code Changes Every Build

Symptoms:

```text
git diff shows generated files changed even without schema change
```

Likely causes:

```text
- timestamp banner
- nondeterministic ordering
- generator version not pinned
- local generator config differs
```

Fix:

```text
- pin generator version
- disable timestamp
- sort inputs
- generate in build directory
- fail CI if committed generated code is stale
```

### Scenario 5 — Dependency Scan Blocks Release

Symptoms:

```text
Critical CVE in transitive dependency
```

Process:

```text
1. identify path to dependency
2. identify whether runtime reachable
3. check fixed version
4. apply BOM/platform override
5. run regression tests
6. produce waiver only if immediate fix impossible
7. attach owner and expiry
```

---

## 25. Build Decision Records

For enterprise systems, major build choices should be recorded.

Example ADR:

```markdown
# ADR-012: Use Hybrid Maven/Gradle Build Governance

## Status
Accepted

## Context
The platform has legacy Maven modules and newer Gradle services. Full migration would delay product delivery and increase risk.

## Decision
Use hybrid build tools with shared governance:
- Maven corporate parent and BOM
- Gradle convention plugins and platform/catalog
- same repository policy
- same CI security/release gates
- same artifact evidence model

## Consequences
Positive:
- gradual migration possible
- legacy stable modules remain low-risk
- modern services can use Gradle performance features

Negative:
- platform team must maintain two governance implementations
- engineers must understand both tools
- CI templates must support both
```

---

## 26. Operating Model

Roles:

| Role | Responsibility |
|---|---|
| Platform/build team | parent POM, convention plugin, CI templates, repository policy |
| Service team | service build, tests, dependency usage, release readiness |
| Security team | vulnerability policy, waiver approval, supply-chain requirements |
| Architecture team | module boundary, dependency direction, public API compatibility |
| Release manager | promotion, release notes, rollback readiness |
| DevOps/SRE | CI runners, repository manager, deployment pipeline, observability |

RACI example:

| Activity | Platform | Service | Security | Release |
|---|---|---|---|---|
| Add new external dependency | C | R | A for sensitive | I |
| Upgrade corporate BOM | R | C | C | I |
| Release service | C | R | C | A |
| Approve critical CVE waiver | C | R | A | I |
| Change Java baseline | R | C | C | A |

---

## 27. Enterprise Build Maturity Model

### Level 0 — Script Chaos

```text
- no wrapper
- random versions
- direct external repositories
- environment-specific artifacts
- no evidence
```

### Level 1 — Basic Standardization

```text
- wrapper used
- CI exists
- plugin versions mostly pinned
- basic tests
```

### Level 2 — Governed Build

```text
- corporate parent/BOM or Gradle convention/platform
- repository policy
- security scan
- artifact publishing rules
```

### Level 3 — Reproducible and Observable

```text
- SBOM
- dependency locking/verification where applicable
- evidence bundle
- test/coverage/security reports
- build metrics dashboard
```

### Level 4 — Optimized Platform

```text
- affected builds
- remote build cache
- build performance SLAs
- automated dependency update workflow
- policy-as-code
```

### Level 5 — Top-Tier Build Engineering

```text
- supply-chain provenance
- strong reproducibility for critical artifacts
- organization-wide build intelligence
- rapid safe migration across Java versions
- self-service but governed developer experience
```

---

## 28. Top 1% Heuristics from the Case Study

1. **Do not start with tool preference. Start with invariants.**

   Maven vs Gradle is secondary. The first question is: what must never be violated?

2. **Artifact identity matters more than pipeline aesthetics.**

   A beautiful pipeline that rebuilds per environment is weaker than a plain pipeline that promotes the same verified artifact.

3. **Dependency graph is architecture evidence.**

   If forbidden dependencies are easy to add, architecture rules are not real.

4. **Build governance must be executable.**

   Wiki rules rot. Parent POM, convention plugin, enforcer, CI gate, and repository policy enforce reality.

5. **Do not over-centralize everything.**

   Centralize policy. Decentralize service implementation within guardrails.

6. **Generated code needs ownership.**

   Generated code without source-of-truth policy creates drift and blame loops.

7. **Security scanning without remediation workflow creates noise.**

   Every finding needs owner, severity, path, fix/waiver, and expiry.

8. **Performance is part of developer experience.**

   Slow builds cause bypass behavior. Bypass behavior causes governance failure.

9. **Reproducibility is a spectrum.**

   Aim bit-for-bit where needed. Aim traceable/verifiable everywhere else.

10. **Build failures should become taxonomy, not folklore.**

    Every recurring failure deserves a playbook or policy improvement.

---

## 29. Final Blueprint Summary

Recommended architecture for this case:

```text
Topology:
- hybrid polyrepo
- shared governance repo
- contract repo
- deployment repo separate from source build

Build tools:
- Maven for legacy/Jakarta/library where lifecycle standardization wins
- Gradle for modern services/custom graph/performance-sensitive builds

Governance:
- Maven parent POM
- Maven BOM
- Gradle convention plugins
- Gradle platform/catalog
- internal repository mirror/group
- dependency/security policy as code

Java strategy:
- Java 8 only for required legacy libraries
- Java 17/21 for mainstream services
- Java 25 as strategic future runtime/build target after certification
- explicit toolchains and matrix testing

CI/CD:
- PR pipeline fast feedback
- main pipeline integration confidence
- release pipeline auditable artifact
- nightly pipeline broad risk discovery

Security:
- SBOM for release artifacts
- dependency scan
- checksum/signing/verification
- waiver with expiry
- no direct public repo in CI

Release:
- immutable artifact
- build once, promote same artifact
- release evidence bundle
- rollback to previous artifact

Observability:
- build metrics
- failure taxonomy
- dependency reports
- security aging
- flaky test trend
```

---

## 30. Checklist: Enterprise Build System Design Review

### Build Tool

```text
[ ] Is build tool choice based on constraints, not fashion?
[ ] Are Maven/Gradle policies equivalent if hybrid?
[ ] Are wrappers required?
[ ] Are plugin versions pinned?
```

### Java Version

```text
[ ] Is Java baseline declared per artifact type?
[ ] Are toolchains configured?
[ ] Are compile/test/runtime JDKs explicit?
[ ] Are Java 8 consumers protected from higher bytecode dependencies?
```

### Dependency

```text
[ ] Is version management centralized?
[ ] Are dynamic/SNAPSHOT dependencies blocked for release?
[ ] Are dependency conflicts detectable?
[ ] Are forbidden dependencies enforced?
[ ] Is repository access controlled?
```

### Module Architecture

```text
[ ] Are module boundaries meaningful?
[ ] Are dependency directions enforced?
[ ] Is common/shared code controlled?
[ ] Are test fixtures separated from production runtime?
```

### CI/CD

```text
[ ] Are PR/main/release/nightly pipelines distinct?
[ ] Is artifact built once and promoted?
[ ] Are caches safe and scoped?
[ ] Is release evidence retained?
```

### Security

```text
[ ] Is SBOM generated?
[ ] Are vulnerability scans enforced?
[ ] Is waiver governance defined?
[ ] Are secrets excluded from artifacts/logs?
[ ] Are dependency checksums/signatures verified where feasible?
```

### Reproducibility

```text
[ ] Are timestamps normalized where possible?
[ ] Are dependency versions locked/pinned?
[ ] Is build environment recorded?
[ ] Is artifact checksum captured?
```

### Observability

```text
[ ] Are build/test/security reports retained?
[ ] Are build failures categorized?
[ ] Are flaky tests tracked?
[ ] Are build duration and cache hit rate monitored?
```

---

## 31. Closing Mental Model

Enterprise build engineering is not about making `mvn clean install` or `gradle build` work.

It is about designing a system where:

```text
- engineers can move fast,
- architecture boundaries are protected,
- dependency risk is visible,
- releases are traceable,
- failures are diagnosable,
- security is built into the pipeline,
- and artifacts can be trusted.
```

At top-tier level, a build engineer does not only ask:

```text
How do I build this project?
```

They ask:

```text
What guarantees does this build provide?
What risks does it hide?
What invariants does it enforce?
What evidence does it produce?
How will it fail, and how quickly can we diagnose it?
```

That is the difference between using Maven/Gradle and engineering a build platform.

---

## 32. Referensi Resmi dan Lanjutan

- Apache Maven — Guide to Working with Multiple Modules: https://maven.apache.org/guides/mini/guide-multiple-modules.html
- Apache Maven — Configuring for Reproducible Builds: https://maven.apache.org/guides/mini/guide-reproducible-builds.html
- Apache Maven — Dependency Mechanism: https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html
- Gradle — Multi-Project Builds: https://docs.gradle.org/current/userguide/multi_project_builds.html
- Gradle — Best Practices for Structuring Builds: https://docs.gradle.org/current/userguide/best_practices_structuring_builds.html
- Gradle — Build Cache: https://docs.gradle.org/current/userguide/build_cache.html
- Gradle — Dependency Verification: https://docs.gradle.org/current/userguide/dependency_verification.html
- Gradle — Version Catalogs: https://docs.gradle.org/current/userguide/version_catalogs.html
- Gradle — Platforms: https://docs.gradle.org/current/userguide/platforms.html
- SLSA — Supply-chain Levels for Software Artifacts: https://slsa.dev/
- CycloneDX — SBOM Standard: https://cyclonedx.org/
- OWASP Dependency-Check: https://owasp.org/www-project-dependency-check/
