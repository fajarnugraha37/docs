# learn-java-oop-functional-reflection-codegen-modules-part-028

# Maven/Gradle Dependency Governance for Serious Java Systems

> Seri: **Java OOP, Functional, Reflection, Code Generation, Modules & Package Management**  
> Part: **028**  
> Topik: **Maven/Gradle Dependency Governance for Serious Java Systems**

---

## 0. Tujuan Part Ini

Pada part sebelumnya, kita membahas package architecture dan JPMS. Di sana boundary masih terlihat sebagai boundary **source code** dan **module descriptor**.

Part ini naik satu level lagi: boundary **artifact** dan **dependency graph**.

Dalam sistem Java serius, terutama enterprise systems, microservices, platform libraries, regulatory systems, dan long-lived products, dependency bukan sekadar “library yang dibutuhkan agar compile”. Dependency adalah:

1. **bagian dari architecture**,
2. **bagian dari supply chain**,
3. **bagian dari runtime behavior**,
4. **bagian dari security posture**,
5. **bagian dari upgrade strategy**,
6. **bagian dari compatibility contract**,
7. **bagian dari operational risk**.

Engineer biasa bertanya:

> “Library apa yang perlu ditambahkan?”

Engineer matang bertanya:

> “Apa konsekuensi dependency ini terhadap API surface, transitive graph, security, runtime image, module boundary, upgrade path, test determinism, and long-term ownership?”

Itulah fokus part ini.

---

## 1. Mental Model Besar: Package, Module, Artifact, Dependency

Jangan campur empat konsep ini.

```text
Java source package
  ↓ compiled into
.class files
  ↓ packaged into
artifact: jar / war / test-jar / sources jar / annotation processor jar
  ↓ declared as
build dependency: Maven / Gradle coordinate
  ↓ resolved into
runtime classpath / module path
  ↓ loaded by
class loader / module layer / application runtime
```

### 1.1 Package

Package adalah namespace dan visibility boundary di source code.

Contoh:

```java
package com.acme.casework.escalation;
```

Package menjawab:

- class ini berada di namespace apa?
- siapa yang bisa akses package-private member?
- apakah package ini public API atau internal implementation?

### 1.2 Module

JPMS module adalah boundary eksplisit di level Java platform.

Contoh:

```java
module com.acme.casework.escalation {
    requires com.acme.casework.core;
    exports com.acme.casework.escalation.api;
}
```

Module menjawab:

- module ini membaca module apa?
- package mana yang diekspor?
- package mana yang dibuka untuk reflection?
- service apa yang disediakan/digunakan?

### 1.3 Artifact

Artifact adalah unit distribusi build.

Contoh Maven coordinate:

```text
com.acme.casework:casework-escalation:1.4.2
```

Artifact menjawab:

- binary apa yang dipublish?
- version berapa?
- metadata dependency apa yang dibawa?
- siapa yang mengkonsumsi artifact ini?

### 1.4 Dependency

Dependency adalah hubungan antar artifact atau antar project.

Contoh Maven:

```xml
<dependency>
  <groupId>com.acme.casework</groupId>
  <artifactId>casework-core</artifactId>
  <version>1.4.2</version>
</dependency>
```

Contoh Gradle:

```kotlin
dependencies {
    implementation("com.acme.casework:casework-core:1.4.2")
}
```

Dependency menjawab:

- artifact ini butuh artifact apa?
- untuk compile saja atau runtime juga?
- transitive dependencies apa yang ikut masuk?
- siapa yang memilih versi akhir?
- apakah dependency ini boleh bocor ke consumer API?

---

## 2. Invariant Utama Dependency Governance

Dependency governance yang baik punya beberapa invariant.

### 2.1 Build harus reproducible

Build hari ini dan build minggu depan dengan source commit yang sama seharusnya menghasilkan dependency graph yang sama.

Anti-pattern:

```xml
<version>LATEST</version>
```

Atau Gradle:

```kotlin
implementation("com.fasterxml.jackson.core:jackson-databind:2.+")
```

Dynamic version membuat dependency graph bisa berubah tanpa perubahan source.

### 2.2 Dependency graph harus explainable

Setiap dependency penting harus bisa dijawab:

- siapa yang menambahkan?
- untuk use case apa?
- dipakai di compile/runtime/test/annotation processor?
- apakah direct atau transitive?
- apakah boleh menjadi API dependency?
- siapa owner upgrade-nya?

Kalau tidak bisa dijelaskan, dependency itu technical debt.

### 2.3 Public API tidak boleh bocor dependency internal

Jika public API library mengekspos type dari dependency eksternal, dependency itu menjadi bagian dari contract.

Buruk:

```java
public interface CaseExporter {
    com.fasterxml.jackson.databind.JsonNode export(CaseFile caseFile);
}
```

Sekarang `jackson-databind` menjadi bagian dari API contract. Consumer dipaksa tahu Jackson.

Lebih stabil:

```java
public interface CaseExporter {
    ExportedCase export(CaseFile caseFile);
}
```

Jackson bisa tetap dipakai internal.

### 2.4 Dependency direction harus mengikuti architecture direction

Dependency graph build harus mencerminkan architecture graph.

Contoh buruk:

```text
casework-domain -> casework-persistence
```

Domain menjadi tahu persistence.

Lebih baik:

```text
casework-application -> casework-domain
casework-persistence -> casework-domain
casework-app-runtime -> casework-application
casework-app-runtime -> casework-persistence
```

Domain tidak bergantung pada infrastructure.

### 2.5 Transitive dependency adalah risk, bukan convenience saja

Transitive dependency memudahkan development, tetapi juga membawa:

- version conflict,
- CVE exposure,
- duplicate logging binding,
- classpath shadowing,
- incompatible API,
- unexpected runtime behavior,
- larger container image,
- slower startup,
- harder upgrade.

---

## 3. Maven Mental Model

Maven bekerja dengan POM, lifecycle, plugin, dependency coordinates, scopes, dan transitive dependency resolution.

### 3.1 Maven coordinate

Satu Maven artifact umumnya diidentifikasi oleh:

```text
groupId:artifactId:version[:packaging][:classifier]
```

Contoh:

```text
org.slf4j:slf4j-api:2.0.17
```

Komponen penting:

| Komponen | Makna |
|---|---|
| `groupId` | organisasi/namespace artifact |
| `artifactId` | nama artifact |
| `version` | versi artifact |
| `packaging` | `jar`, `war`, `pom`, dll |
| `classifier` | variasi artifact, misalnya `sources`, `javadoc`, `tests` |

### 3.2 `dependencies` vs `dependencyManagement`

Ini salah satu hal Maven yang paling sering disalahpahami.

`dependencies` berarti:

> project ini benar-benar memakai dependency tersebut.

`dependencyManagement` berarti:

> jika dependency tersebut dipakai, gunakan version/scope/exclusion yang dikelola di sini.

Contoh parent/BOM management:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.fasterxml.jackson</groupId>
      <artifactId>jackson-bom</artifactId>
      <version>2.18.3</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Lalu di module:

```xml
<dependencies>
  <dependency>
    <groupId>com.fasterxml.jackson.core</groupId>
    <artifactId>jackson-databind</artifactId>
  </dependency>
</dependencies>
```

Version tidak ditulis di dependency karena sudah dikelola.

### 3.3 Parent POM vs BOM

Parent POM biasanya mengelola:

- dependency management,
- plugin management,
- repositories,
- properties,
- build settings,
- reporting,
- organization metadata.

BOM biasanya fokus pada:

- dependency versions,
- dependency alignment,
- compatible dependency set.

Gunakan parent untuk project internal multi-module.

Gunakan BOM untuk membagikan dependency version alignment ke project lain tanpa mewariskan seluruh build configuration.

### 3.4 Maven scopes

Scope menentukan classpath mana yang mendapatkan dependency.

| Scope | Compile classpath | Runtime classpath | Test classpath | Transitive ke consumer | Use case |
|---|---:|---:|---:|---:|---|
| `compile` | yes | yes | yes | yes | default library API/runtime |
| `provided` | yes | no | yes | no-ish | servlet API/container-provided API |
| `runtime` | no | yes | yes | yes runtime | JDBC driver, runtime impl |
| `test` | no | no | yes | no | JUnit, AssertJ, testcontainers |
| `system` | yes | maybe | yes | not recommended | legacy local jar |
| `import` | only in dependencyManagement | no | no | n/a | BOM import |

### 3.5 Scope smell

Buruk:

```xml
<dependency>
  <groupId>org.postgresql</groupId>
  <artifactId>postgresql</artifactId>
  <version>42.7.5</version>
</dependency>
```

Jika JDBC driver hanya dibutuhkan saat runtime, scope bisa menjadi:

```xml
<dependency>
  <groupId>org.postgresql</groupId>
  <artifactId>postgresql</artifactId>
  <scope>runtime</scope>
</dependency>
```

Namun pada Spring Boot executable application, dependency runtime tetap akan dipack ke boot jar. Jadi scope harus dipahami dalam konteks packaging.

### 3.6 Optional dependency

Optional dependency berarti dependency tersebut tidak otomatis ikut transitively ke consumer.

Contoh library yang mendukung optional integration:

```xml
<dependency>
  <groupId>com.github.ben-manes.caffeine</groupId>
  <artifactId>caffeine</artifactId>
  <optional>true</optional>
</dependency>
```

Maknanya:

- library bisa memakai Caffeine untuk fitur tertentu,
- consumer tidak otomatis mendapat Caffeine,
- consumer harus menambahkan dependency secara eksplisit jika butuh integration itu.

Optional cocok untuk library dengan multiple optional integrations.

Tidak cocok untuk menyembunyikan dependency yang sebenarnya wajib.

### 3.7 Exclusions

Exclusion memotong transitive dependency tertentu.

```xml
<dependency>
  <groupId>com.example</groupId>
  <artifactId>legacy-client</artifactId>
  <version>1.2.0</version>
  <exclusions>
    <exclusion>
      <groupId>commons-logging</groupId>
      <artifactId>commons-logging</artifactId>
    </exclusion>
  </exclusions>
</dependency>
```

Exclusion harus menjadi keputusan sadar.

Pertanyaan wajib:

1. Kenapa dependency ini dikeluarkan?
2. Apakah library upstream tetap berjalan tanpa dependency itu?
3. Apakah kita menggantinya dengan alternative compatible?
4. Apakah ada test runtime yang membuktikan aman?

---

## 4. Maven Dependency Mediation

Jika dua dependency membawa versi berbeda dari artifact yang sama, Maven harus memilih satu.

Contoh:

```text
app
 ├─ A -> C:1.0
 └─ B -> D -> C:2.0
```

Maven memakai prinsip **nearest definition**: dependency dengan jarak terdekat dari root graph biasanya menang.

Jika jarak sama, deklarasi yang muncul lebih dulu bisa menang.

Masalahnya: hasil akhir bisa tidak intuitif.

### 4.1 Dependency mediation bug

Misalnya:

```text
app
 ├─ framework-x -> json-lib:2.12
 └─ framework-y -> json-lib:2.17
```

Jika Maven memilih `json-lib:2.12`, framework-y mungkin compile dengan API 2.17 tetapi runtime mendapat 2.12.

Akibat:

```text
NoSuchMethodError
NoClassDefFoundError
ClassCastException
LinkageError
```

Ini bukan bug compiler. Ini bug dependency graph.

### 4.2 Governance rule

Untuk library besar dan aplikasi enterprise:

- semua dependency penting harus version-managed,
- dependency tree harus dicek di CI,
- dependency convergence harus enforced,
- version conflict harus diselesaikan eksplisit,
- tidak mengandalkan kebetulan nearest-wins.

---

## 5. Maven Plugin Management

Dependency management mengatur library dependencies.

Plugin management mengatur build plugins.

Contoh:

```xml
<build>
  <pluginManagement>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.13.0</version>
        <configuration>
          <release>25</release>
        </configuration>
      </plugin>
    </plugins>
  </pluginManagement>
</build>
```

Tanpa plugin version pinning, build bisa bergantung pada default plugin resolution yang berubah antar Maven version atau parent.

Rule:

> Pin plugin versions seperti dependency versions.

---

## 6. Maven Multi-Module Architecture

Maven multi-module umum dipakai untuk monorepo Java.

```text
casework-parent/
  pom.xml
  casework-domain/
    pom.xml
  casework-application/
    pom.xml
  casework-persistence/
    pom.xml
  casework-api/
    pom.xml
  casework-runtime/
    pom.xml
```

Root POM:

```xml
<packaging>pom</packaging>

<modules>
  <module>casework-domain</module>
  <module>casework-application</module>
  <module>casework-persistence</module>
  <module>casework-api</module>
  <module>casework-runtime</module>
</modules>
```

### 6.1 Parent aggregator vs parent inheritance

Root POM bisa berfungsi sebagai:

1. aggregator: mendaftarkan modules,
2. parent: diwarisi child modules.

Keduanya sering digabung, tapi secara mental berbeda.

Aggregator menjawab:

> “Build module apa saja bersama?”

Parent menjawab:

> “Konfigurasi apa yang diwariskan child?”

### 6.2 Dependency direction dalam multi-module

Contoh baik:

```text
casework-domain
  no dependency to application/infrastructure

casework-application
  depends on casework-domain

casework-persistence
  depends on casework-domain
  depends on jdbc/jpa library

casework-runtime
  depends on application
  depends on persistence
  wires all together
```

Contoh buruk:

```text
casework-domain -> casework-runtime
casework-domain -> spring-web
casework-domain -> persistence
```

Domain menjadi polluted.

---

## 7. Gradle Mental Model

Gradle lebih model-based dan task-oriented dibanding Maven. Dependency management di Gradle memakai configuration seperti `api`, `implementation`, `runtimeOnly`, `compileOnly`, `testImplementation`, dan lain-lain.

### 7.1 Gradle configurations

Untuk Java Library plugin:

```kotlin
plugins {
    `java-library`
}

dependencies {
    api("org.slf4j:slf4j-api:2.0.17")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.18.3")
    runtimeOnly("org.postgresql:postgresql:42.7.5")
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
}
```

### 7.2 `api` vs `implementation`

Ini konsep penting.

`api` berarti dependency terlihat pada compile classpath consumer.

`implementation` berarti dependency internal implementation dan tidak perlu bocor ke consumer compile classpath.

Contoh:

```java
public interface CaseNotifier {
    org.slf4j.Logger logger(); // bad public API leak
}
```

Jika API public mengekspos `org.slf4j.Logger`, maka `slf4j-api` perlu menjadi `api` dependency.

Jika dependency hanya dipakai internal:

```java
final class JacksonCaseJsonCodec {
    private final ObjectMapper mapper = new ObjectMapper();
}
```

Maka Jackson cukup `implementation`.

### 7.3 Gradle scopes/configurations map

| Gradle | Makna |
|---|---|
| `api` | dependency bocor ke consumer compile classpath |
| `implementation` | dependency internal compile/runtime module ini |
| `compileOnly` | compile only, tidak runtime |
| `runtimeOnly` | runtime only |
| `testImplementation` | test compile/runtime |
| `testRuntimeOnly` | test runtime only |
| `annotationProcessor` | processor compile-time |
| `testAnnotationProcessor` | processor untuk test source |

### 7.4 Version catalogs

Gradle version catalog memusatkan dependency aliases dan versions.

Contoh `gradle/libs.versions.toml`:

```toml
[versions]
jackson = "2.18.3"
junit = "5.11.4"

[libraries]
jackson-databind = { module = "com.fasterxml.jackson.core:jackson-databind", version.ref = "jackson" }
junit-jupiter = { module = "org.junit.jupiter:junit-jupiter", version.ref = "junit" }
```

Build file:

```kotlin
dependencies {
    implementation(libs.jackson.databind)
    testImplementation(libs.junit.jupiter)
}
```

Version catalog menyelesaikan masalah:

- duplicate coordinate string,
- inconsistent version declaration,
- hard-to-review upgrades,
- multi-project dependency sprawl.

Namun version catalog bukan lock file. Ia mengatur declared versions, bukan selalu resolved graph.

### 7.5 Gradle platforms

Gradle platform/BOM digunakan untuk alignment transitive dependency versions.

```kotlin
dependencies {
    implementation(platform("com.fasterxml.jackson:jackson-bom:2.18.3"))
    implementation("com.fasterxml.jackson.core:jackson-databind")
    implementation("com.fasterxml.jackson.datatype:jackson-datatype-jsr310")
}
```

Atau enforced platform:

```kotlin
dependencies {
    implementation(enforcedPlatform("com.acme:platform-bom:1.0.0"))
}
```

Gunakan enforced platform hati-hati karena bisa memaksa versi ke consumer dan membuat conflict resolution lebih keras.

### 7.6 Dependency locking

Dependency locking menyimpan resolved versions ke lock file.

Contoh konsep:

```text
gradle.lockfile
```

Tujuan:

- build lebih reproducible,
- dynamic/range versions tidak berubah diam-diam,
- transitive dependency upgrades terlihat dalam diff,
- CI dan local lebih konsisten.

### 7.7 Dependency verification

Dependency verification mengecek checksum/signature dependency.

Tujuan:

- mengurangi supply-chain tampering risk,
- memastikan artifact yang didownload sama dengan metadata yang dipercaya,
- membuat build fail saat checksum/signature tidak cocok.

Ini berbeda dari vulnerability scanning.

Verification menjawab:

> “Artifact ini adalah artifact yang sama dengan yang sudah kita trust?”

Vulnerability scanning menjawab:

> “Artifact ini punya known vulnerability?”

---

## 8. Maven vs Gradle: Architectural Comparison

| Aspek | Maven | Gradle |
|---|---|---|
| Model | declarative POM lifecycle | programmable build model |
| Dependency declaration | XML POM | Groovy/Kotlin DSL |
| Standardization | sangat convention-heavy | flexible, expressive |
| Multi-module | reactor build | multi-project build |
| Version centralization | parent/BOM/dependencyManagement | version catalog/platform/convention plugin |
| API vs implementation separation | tidak native sejelas Gradle Java Library | native via `api`/`implementation` |
| Build logic reuse | parent/plugin | convention plugin/buildSrc/included build |
| Risk | verbose, mediation surprises | over-customization, hidden build logic |
| Best for | stable enterprise conventions | complex build automation/multi-language |

Tidak ada jawaban universal.

Rule praktis:

- Maven bagus jika organization menghargai convention, auditability, dan low custom build logic.
- Gradle bagus jika project butuh build automation yang kompleks, multi-project besar, atau fine-grained dependency exposure.
- Build tool yang dipakai buruk jika dependency graph tidak bisa dijelaskan.

---

## 9. Dependency Categories: Jangan Semua Dianggap Sama

Satu dependency bisa masuk kategori berbeda.

### 9.1 API dependency

Dependency yang type-nya muncul di public API.

```java
public interface AuditSerializer {
    JsonNode serialize(AuditRecord record);
}
```

`JsonNode` membuat Jackson menjadi API dependency.

### 9.2 Implementation dependency

Dependency yang hanya dipakai internal.

```java
final class JacksonAuditSerializer implements AuditSerializer {
    private final ObjectMapper mapper;
}
```

Jackson internal.

### 9.3 Runtime dependency

Dependency yang dibutuhkan runtime tapi tidak compile.

Contoh:

- JDBC driver,
- logging implementation,
- metrics exporter implementation,
- service provider implementation.

### 9.4 Annotation processor dependency

Dependency yang dipakai compiler, bukan aplikasi runtime.

Gradle:

```kotlin
dependencies {
    annotationProcessor("org.mapstruct:mapstruct-processor:1.6.3")
    implementation("org.mapstruct:mapstruct:1.6.3")
}
```

Processor harus dipisah dari runtime dependency.

### 9.5 Test dependency

Dependency yang hanya untuk test.

Contoh:

- JUnit,
- AssertJ,
- Mockito,
- Testcontainers,
- ArchUnit.

Test dependency tidak boleh bocor ke production artifact.

### 9.6 Build plugin dependency

Dependency yang menjalankan build.

Contoh:

- Maven compiler plugin,
- Maven surefire plugin,
- Gradle plugins,
- code generator plugin,
- formatter plugin,
- vulnerability scanner plugin.

Build plugin juga supply-chain risk.

---

## 10. Dependency Boundary Design

### 10.1 Domain module harus miskin dependency

Domain module idealnya bergantung pada:

- Java standard library,
- maybe small annotation-only library,
- maybe internal shared kernel yang stabil.

Domain module sebaiknya tidak bergantung pada:

- Spring Web,
- persistence framework,
- serialization framework,
- HTTP client,
- cloud SDK,
- database driver,
- generated OpenAPI client,
- vendor SDK.

Kenapa?

Karena domain adalah bagian paling stabil. Dependency eksternal adalah bagian yang sering berubah.

### 10.2 Application module boleh tahu port, bukan adapter

Contoh:

```java
public interface CaseRepository {
    Optional<CaseFile> findById(CaseId id);
}
```

Application bergantung pada abstraction.

Persistence adapter mengimplementasikan abstraction.

```text
casework-application -> casework-domain
casework-persistence -> casework-application
casework-persistence -> jdbc/jpa
```

Atau abstraction ditempatkan di domain/application tergantung architecture.

### 10.3 Runtime composition module mengikat semuanya

```text
casework-runtime
  depends on casework-application
  depends on casework-persistence
  depends on casework-web
  depends on casework-security
```

Runtime module boleh menjadi dependency-rich karena tugasnya wiring.

---

## 11. Common Dependency Smells

### 11.1 “Just add dependency” smell

Setiap library kecil tampak murah.

Tetapi total graph bisa menjadi besar.

Sebelum menambah dependency, tanya:

- apakah JDK sudah cukup?
- apakah kita hanya butuh 1 function kecil?
- apakah library ini maintained?
- apakah dependency graph-nya kecil?
- apakah license acceptable?
- apakah ada CVE history?
- apakah dependency ini akan bocor ke API?
- apakah ada alternatif internal sederhana?

### 11.2 Utility dependency for trivial logic

Buruk:

```text
Add a large utility framework just for one String helper.
```

Lebih baik:

```java
static boolean isBlank(String value) {
    return value == null || value.isBlank();
}
```

JDK modern sudah punya banyak utility.

### 11.3 Dependency trainwreck

```text
app -> framework-a -> framework-b -> framework-c -> logging-x -> old-json-lib
```

Semakin dalam graph, semakin sulit ownership.

### 11.4 Duplicate abstraction libraries

Contoh:

- multiple JSON libraries,
- multiple HTTP clients,
- multiple logging APIs,
- multiple validation frameworks,
- multiple date/time abstraction libraries.

Tidak selalu salah, tapi harus dijustifikasi.

### 11.5 Mixed major versions

Contoh buruk:

```text
jackson-core:2.18
jackson-databind:2.13
jackson-annotations:2.15
```

Library family harus aligned.

Gunakan BOM/platform.

### 11.6 Hidden dependency through reflection

Framework bisa membutuhkan dependency yang tidak tampak dari compile usage.

Contoh:

- class referenced by configuration string,
- provider loaded via `ServiceLoader`,
- driver loaded by class name,
- generated code referenced by annotation,
- native image reflection config.

Dependency governance harus mencakup runtime discovery.

---

## 12. BOM and Platform Strategy

### 12.1 Apa itu BOM?

BOM adalah POM dengan dependency management yang menyatakan set version yang compatible.

Contoh:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.acme.platform</groupId>
      <artifactId>acme-platform-bom</artifactId>
      <version>2026.06.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

### 12.2 Kapan membuat internal BOM?

Buat internal BOM jika organisasi punya banyak services/libraries yang harus konsisten untuk:

- logging stack,
- Jackson,
- Netty,
- Spring,
- Jakarta,
- database drivers,
- observability libraries,
- testing libraries,
- cloud SDK,
- internal libraries.

### 12.3 BOM bukan dumping ground

BOM buruk:

```text
Semua dependency yang pernah dipakai organisasi dimasukkan.
```

BOM baik:

```text
Dependency set yang memang dikelola, diuji, dan direkomendasikan sebagai platform baseline.
```

### 12.4 BOM versioning

Gunakan versioning jelas:

```text
2026.06.0
2026.06.1
2026.09.0
```

Atau semver:

```text
1.8.0
1.8.1
2.0.0
```

Major change BOM berarti bisa ada breaking dependency alignment.

---

## 13. Reproducible Build Strategy

### 13.1 Pin versions

Semua direct dependencies harus punya versi, kecuali version dikelola BOM/platform.

Semua plugins harus punya versi.

### 13.2 Avoid dynamic versions

Hindari:

```text
LATEST
RELEASE
SNAPSHOT for release build
2.+
[1.0,2.0)
```

Version range bisa dipakai untuk library metadata tertentu, tapi biasanya buruk untuk reproducibility.

### 13.3 Lock resolved graph

Untuk Gradle, aktifkan dependency locking di project serius.

Untuk Maven, gunakan combination:

- pinned direct versions,
- BOM,
- dependency convergence enforcement,
- CI dependency tree diff,
- artifact repository proxy,
- release plugin/versioning discipline.

### 13.4 Repository governance

Jangan biarkan build mengambil dependency dari repository acak.

Gunakan internal repository manager/proxy seperti:

- Nexus,
- Artifactory,
- internal Maven proxy.

Atur allowlist repository.

Buruk:

```xml
<repositories>
  <repository>
    <id>random-repo</id>
    <url>https://some-random-domain/repo</url>
  </repository>
</repositories>
```

Repository adalah supply-chain boundary.

---

## 14. Security and Supply Chain Governance

Dependency security bukan hanya CVE scanning.

### 14.1 Risk categories

| Risiko | Contoh |
|---|---|
| Known vulnerability | vulnerable transitive dependency |
| Malicious artifact | compromised package/repository |
| Typosquatting | artifact name mirip library populer |
| Dependency confusion | internal package name diambil dari public repo |
| Abandoned library | no patch path |
| License issue | incompatible license |
| Build plugin compromise | malicious build-time code |
| Generated code injection | compromised generator/plugin |

### 14.2 Scanner bukan governance

Scanner hanya memberitahu sinyal.

Governance menjawab:

- siapa owner remediation?
- berapa SLA upgrade?
- kapan exception boleh diberikan?
- apakah vulnerable code path reachable?
- apakah ada compensating control?
- apakah major upgrade butuh migration project?

### 14.3 Direct vs transitive vulnerability

Direct dependency vulnerability mudah terlihat.

Transitive vulnerability sering tersembunyi.

Contoh:

```text
app -> reporting-lib -> old-template-engine -> vulnerable-parser
```

App tidak pernah menulis dependency parser, tapi tetap terkena risk.

### 14.4 Build-time dependency risk

Annotation processor, Gradle plugin, Maven plugin, code generator, dan Java agent berjalan sebagai code saat build/test/runtime.

Mereka harus diperlakukan sebagai trusted executable.

Rule:

> Jangan menganggap build dependency lebih aman daripada runtime dependency.

---

## 15. License Governance

Dependency juga membawa license.

Contoh kategori:

- permissive: Apache-2.0, MIT, BSD,
- weak copyleft: EPL, LGPL,
- strong copyleft: GPL,
- proprietary/commercial,
- unclear/no license.

Engineering policy harus menentukan:

- license apa yang boleh dipakai,
- license apa yang butuh approval,
- license apa yang dilarang,
- bagaimana transitive license diperiksa,
- bagaimana NOTICE file dikelola,
- bagaimana source distribution obligations dipenuhi.

Untuk enterprise/government/regulatory systems, license governance bukan opsional.

---

## 16. Shading and Relocation

Shading berarti memasukkan dependency ke artifact sendiri.

Relocation berarti mengganti package dependency agar tidak konflik.

Contoh use case:

- library ingin embed helper kecil,
- mencegah version conflict,
- membuat standalone CLI,
- agent/instrumentation library perlu isolate dependency.

### 16.1 Shading risk

Shading bisa menyebabkan:

- duplicate classes,
- broken service loader metadata,
- broken reflection resource names,
- larger artifact,
- security scanner false negative/false positive,
- license/notice complexity,
- debugging confusion.

### 16.2 Rule

Jangan shading sebagai default.

Gunakan shading hanya jika:

1. conflict nyata dan sulit dihindari,
2. dependency tidak seharusnya bocor,
3. relocation dilakukan benar,
4. metadata/service/resource ditangani,
5. license compliance jelas,
6. scanner tetap bisa mendeteksi.

---

## 17. Annotation Processor and Generated Code Dependency Governance

Annotation processor punya dependency graph sendiri.

Gradle:

```kotlin
dependencies {
    compileOnly("org.projectlombok:lombok:1.18.36")
    annotationProcessor("org.projectlombok:lombok:1.18.36")
}
```

MapStruct style:

```kotlin
dependencies {
    implementation("org.mapstruct:mapstruct:1.6.3")
    annotationProcessor("org.mapstruct:mapstruct-processor:1.6.3")
}
```

Governance questions:

- apakah generated source committed?
- apakah processor deterministic?
- apakah processor version pinned?
- apakah processor compatible dengan JDK version?
- apakah generated code expose dependency types?
- apakah generated code masuk module/package yang benar?
- apakah incremental compilation aman?

---

## 18. JPMS and Dependency Governance

JPMS menambah constraint:

- dependency artifact mungkin punya module descriptor,
- mungkin automatic module,
- mungkin unnamed module,
- mungkin split package,
- mungkin butuh `opens`,
- mungkin punya unstable automatic module name.

### 18.1 Automatic module hazard

Jar tanpa `module-info.class` bisa menjadi automatic module saat berada di module path.

Nama automatic module bisa berasal dari jar name atau manifest `Automatic-Module-Name`.

Risiko:

- module name berubah saat artifact name berubah,
- package exposure terlalu luas,
- transitive readability behavior bisa tidak ideal,
- migration terasa berhasil padahal boundary belum matang.

### 18.2 Split package hazard

Dua artifacts mengandung package sama:

```text
artifact-a.jar -> com.acme.common
artifact-b.jar -> com.acme.common
```

Classpath mungkin masih menerima, module path tidak.

Ini alasan package architecture harus konsisten dengan artifact architecture.

### 18.3 Reflection and `opens`

Jika dependency framework butuh deep reflection, module descriptor harus menyatakan boundary.

```java
opens com.acme.casework.persistence.entity to org.hibernate.orm.core;
```

Ini lebih baik daripada membuka semua package secara liar.

---

## 19. Dependency Governance in Microservices

Microservices sering punya masalah dependency berbeda.

### 19.1 Banyak service, banyak drift

Tanpa governance:

```text
service-a: Jackson 2.14, Spring 3.1, Java 17
service-b: Jackson 2.17, Spring 3.3, Java 21
service-c: Jackson 2.12, Spring 2.7, Java 11
```

Akibat:

- patching lambat,
- CVE remediation sulit,
- inconsistent behavior,
- shared libraries sulit evolve,
- platform team overload.

### 19.2 Platform BOM untuk fleet

Internal platform BOM dapat menyatukan baseline.

```text
acme-platform-bom:2026.06.0
  Java baseline: 25
  Spring baseline: x
  Jackson baseline: y
  Logging baseline: z
  Observability baseline: q
```

Service tetap bisa punya exception, tapi exception harus eksplisit.

### 19.3 Upgrade waves

Untuk banyak services, upgrade dependency harus dikelola sebagai wave:

1. inventory,
2. compatibility assessment,
3. platform BOM update,
4. pilot service,
5. automated PR,
6. CI/test validation,
7. staged rollout,
8. exception tracking.

---

## 20. Dependency Governance in Libraries

Library lebih sensitif daripada application.

Application dependency graph berhenti di application.

Library dependency graph bocor ke consumer.

### 20.1 Library rule

Library harus:

- minimize dependencies,
- avoid exposing third-party types,
- use optional dependencies for integrations,
- avoid heavy runtime dependencies,
- document supported dependency versions,
- avoid forcing logging implementation,
- avoid global static initialization,
- avoid classpath scanning at load time,
- avoid dependency version pinning that conflicts with consumer.

### 20.2 Logging example

Library boleh depend on logging API:

```kotlin
api("org.slf4j:slf4j-api:2.0.17")
```

Library jangan depend on logging implementation:

```kotlin
implementation("ch.qos.logback:logback-classic:1.5.16") // bad for library
```

Application yang memilih implementation.

---

## 21. Dependency Convergence and CI Enforcement

CI harus mengecek dependency graph.

### 21.1 Maven Enforcer style checks

Useful checks:

- dependency convergence,
- require upper bound dependencies,
- ban duplicate classes,
- ban snapshots in release,
- require Maven/Java version,
- ban dependencies,
- enforce plugin versions.

Contoh konsep:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-enforcer-plugin</artifactId>
  <version>3.5.0</version>
  <executions>
    <execution>
      <goals>
        <goal>enforce</goal>
      </goals>
      <configuration>
        <rules>
          <dependencyConvergence />
          <requirePluginVersions />
        </rules>
      </configuration>
    </execution>
  </executions>
</plugin>
```

### 21.2 Gradle checks

Gradle dapat memakai:

- dependency locking,
- dependency verification,
- version catalogs,
- platforms,
- dependency insight,
- build scans,
- custom verification tasks,
- third-party plugins for analysis/security/license.

### 21.3 Dependency tree as artifact

Untuk system penting, simpan dependency tree sebagai CI artifact.

Tujuan:

- audit,
- diff antar release,
- incident investigation,
- security review,
- upgrade planning.

---

## 22. Practical Commands

### 22.1 Maven dependency tree

```bash
mvn dependency:tree
```

Filter:

```bash
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core
```

Analyze unused/undeclared:

```bash
mvn dependency:analyze
```

Effective POM:

```bash
mvn help:effective-pom
```

### 22.2 Gradle dependency report

```bash
./gradlew dependencies
```

Specific configuration:

```bash
./gradlew dependencies --configuration runtimeClasspath
```

Dependency insight:

```bash
./gradlew dependencyInsight --dependency jackson-databind --configuration runtimeClasspath
```

Write locks:

```bash
./gradlew dependencies --write-locks
```

Generate verification metadata:

```bash
./gradlew --write-verification-metadata sha256 help
```

---

## 23. Dependency Decision Record

Untuk dependency penting, buat mini decision record.

```markdown
# Dependency Decision Record: jackson-databind

## Dependency
- group: com.fasterxml.jackson.core
- artifact: jackson-databind
- version source: platform BOM
- scope: implementation

## Reason
Used for internal JSON serialization/deserialization in adapter layer.

## Boundary
Not exposed in public domain/application API.

## Alternatives considered
- JDK JSON: not available as standard API for this use case
- Gson: less aligned with organization baseline
- JSON-B: not chosen because project already standardizes on Jackson

## Risks
- CVE history requires active patching
- ObjectMapper configuration must be centralized
- Avoid polymorphic default typing unless explicitly reviewed

## Governance
- Version managed by platform BOM
- Upgrade owner: platform team
- Security scan required in CI
```

This seems bureaucratic for tiny projects. For regulated, long-lived systems, it is cheap insurance.

---

## 24. Dependency Review Checklist

Before adding a dependency:

```text
1. Is this dependency necessary?
2. Is the JDK enough?
3. Is the library actively maintained?
4. Is the license allowed?
5. Is the dependency direct or transitive?
6. What is the scope/configuration?
7. Does it expose third-party types in public API?
8. Does it bring large transitive graph?
9. Does it conflict with existing versions?
10. Does it need reflection, agents, native libs, or service loading?
11. Does it support our Java version?
12. Does it work with JPMS/module path if needed?
13. Does it have known vulnerabilities?
14. Does it require special runtime config?
15. Who owns upgrades?
```

Before upgrading a dependency:

```text
1. Is this patch/minor/major upgrade?
2. Are release notes reviewed?
3. Are breaking changes identified?
4. Are transitive changes reviewed?
5. Are generated code/build plugins affected?
6. Are serialization formats affected?
7. Are public APIs affected?
8. Are runtime configs affected?
9. Are performance/startup changes expected?
10. Is rollback possible?
```

---

## 25. Case Study: Regulatory Case Management Dependency Governance

Imagine modular case management system:

```text
case-domain
case-application
case-workflow
case-persistence
case-web-api
case-eventing
case-runtime
```

### 25.1 Bad dependency graph

```text
case-domain -> spring-context
case-domain -> jackson-databind
case-domain -> hibernate-core
case-application -> spring-web
case-persistence -> case-runtime
case-web-api -> case-persistence
case-eventing -> case-web-api
```

Problems:

- domain polluted by framework,
- runtime dependency cycles,
- API and persistence coupled,
- hard to test domain,
- hard to migrate framework,
- impossible clean JPMS modularization,
- dependency graph does not reflect business boundary.

### 25.2 Better dependency graph

```text
case-domain
  -> java.base only

case-application
  -> case-domain

case-workflow
  -> case-domain
  -> case-application

case-persistence
  -> case-domain
  -> case-application
  -> jdbc/jpa dependencies

case-web-api
  -> case-domain
  -> case-application
  -> web framework
  -> json framework

case-eventing
  -> case-domain
  -> case-application
  -> messaging dependency

case-runtime
  -> case-application
  -> case-workflow
  -> case-persistence
  -> case-web-api
  -> case-eventing
```

### 25.3 Dependency governance policy

| Module | Allowed dependency style |
|---|---|
| `case-domain` | JDK + internal value/common only |
| `case-application` | domain + ports + minimal annotations if justified |
| `case-persistence` | persistence frameworks allowed |
| `case-web-api` | web/json dependencies allowed |
| `case-eventing` | messaging dependencies allowed |
| `case-runtime` | wiring/framework dependencies allowed |
| `case-test-support` | test utilities only, not production dependency |

### 25.4 Enforcement

Use:

- Maven/Gradle module dependencies,
- ArchUnit tests,
- package visibility,
- JPMS exports/opens,
- dependency convergence checks,
- banned dependency rules,
- CI dependency tree diff.

---

## 26. Failure Model

### 26.1 `NoSuchMethodError`

Usually caused by compile-time version and runtime version mismatch.

Example:

```text
Compiled against library 2.0
Runtime loads library 1.5
```

Fix:

- inspect runtime dependency tree,
- align versions with BOM/platform,
- exclude old transitive dependency,
- enforce convergence.

### 26.2 `ClassNotFoundException`

Class requested dynamically not found.

Common causes:

- missing runtime dependency,
- wrong scope,
- optional dependency not declared,
- service provider missing,
- module not resolved.

### 26.3 `NoClassDefFoundError`

Class existed during compile or earlier load attempt but unavailable/failing at runtime.

Common causes:

- missing transitive dependency,
- static initialization failure,
- classloader isolation,
- incompatible runtime packaging.

### 26.4 `LinkageError`

Binary incompatibility/class loading conflict.

Causes:

- duplicate classes,
- incompatible versions,
- classloader split,
- JPMS package conflict,
- shading mistakes.

### 26.5 `ServiceConfigurationError`

`ServiceLoader` provider configuration broken.

Causes:

- provider class missing,
- provider not accessible,
- module descriptor missing `provides`,
- shaded resource not merged,
- constructor failure.

### 26.6 Build works locally but fails in CI

Causes:

- unpinned plugin version,
- repository difference,
- dynamic version,
- local cache pollution,
- generated source not deterministic,
- JDK/Maven/Gradle version mismatch.

---

## 27. Top 1% Mental Model

Dependency governance is architecture governance.

A top engineer does not merely “fix dependency conflicts”. They design dependency systems with clear invariants:

```text
1. Domain depends on stable abstractions.
2. External frameworks stay at edges.
3. Public API does not leak accidental dependencies.
4. Versions are aligned deliberately.
5. Build is reproducible.
6. Transitive graph is observable.
7. Security/license risk is owned.
8. Build plugins and processors are treated as executable supply chain.
9. Upgrade path is planned.
10. Dependency graph mirrors architecture graph.
```

---

## 28. Practical Governance Template

For a serious Java project, start with this baseline.

### 28.1 Maven baseline

```text
- parent POM pins plugin versions
- dependencyManagement imports platform BOMs
- no direct dependency versions outside dependencyManagement unless justified
- no SNAPSHOT in release builds
- enforcer checks enabled
- dependency tree exported in CI
- dependency analyze reviewed periodically
- internal repository proxy used
- security/license scanning enabled
```

### 28.2 Gradle baseline

```text
- version catalog for coordinates
- platform/BOM for aligned dependency families
- dependency locking enabled for applications
- dependency verification enabled for high-assurance projects
- convention plugins for shared build logic
- no dynamic versions unless locked and justified
- dependencyInsight used for conflict review
- CI exports dependency reports
- security/license scanning enabled
```

### 28.3 Library baseline

```text
- minimal dependencies
- third-party types avoided in public API
- optional integrations are optional dependencies
- logging API only, no logging implementation
- no hidden classpath scanning at static init
- no forced global configuration
- semantic versioning and binary compatibility checks
```

---

## 29. Summary

Kita sudah membangun model bahwa dependency management bukan aktivitas administratif.

Dependency menentukan:

- apa yang bisa dicompile,
- apa yang masuk runtime,
- apa yang bocor ke public API,
- apa yang dapat di-reflect,
- apa yang bisa di-load sebagai service,
- apa yang bisa menjadi vulnerability,
- apa yang membuat build reproducible atau nondeterministic,
- apa yang memperkuat atau merusak module boundary.

Maven dan Gradle punya mekanisme berbeda, tetapi tujuan governance-nya sama:

> make the dependency graph intentional, explainable, reproducible, secure, and aligned with architecture.

---

## 30. Checklist Akhir

Setelah part ini, Anda harus bisa:

- membedakan package/module/artifact/dependency,
- menjelaskan Maven `dependencies` vs `dependencyManagement`,
- menjelaskan Gradle `api` vs `implementation`,
- memahami BOM/platform,
- memahami transitive dependency mediation,
- mendesain dependency boundary antar module enterprise,
- menghindari dependency leakage ke public API,
- mengelola annotation processor/build plugin dependency,
- memahami dependency locking dan verification,
- membaca dependency tree sebagai architecture graph,
- membuat dependency decision record,
- menghubungkan dependency governance dengan JPMS, reflection, generated code, dan runtime failure.

---

## 31. Status Seri

Seri **belum selesai**.

Part berikutnya:

```text
learn-java-oop-functional-reflection-codegen-modules-part-029.md
```

Topik berikutnya:

```text
API Evolution, Binary Compatibility, Semantic Versioning, and Library Design
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-oop-functional-reflection-codegen-modules-part-027](./learn-java-oop-functional-reflection-codegen-modules-part-027.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-oop-functional-reflection-codegen-modules-part-029](./learn-java-oop-functional-reflection-codegen-modules-part-029.md)

</div>