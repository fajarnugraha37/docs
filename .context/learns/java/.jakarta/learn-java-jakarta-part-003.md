# learn-java-jakarta-part-003.md

# Bagian 3 — Dependency Management: API, Implementation, Runtime, dan BOM

> Target pembaca: Java engineer yang ingin memakai Jakarta EE secara benar di Maven/Gradle, memahami kenapa `jakarta.*-api` bukan implementation, kapan memakai `provided`, kapan memakai `compileOnly`, bagaimana memilih Platform/Web/Core API, bagaimana menghindari classpath conflict, dan bagaimana mengelola dependency Jakarta EE secara production-grade.
>
> Fokus utama: membangun **mental model dependency Jakarta EE**. Bagian ini sengaja sangat detail karena banyak bug migrasi `javax → jakarta`, runtime mismatch, deployment failure, dan classpath hell berasal dari dependency yang salah.

---

## Daftar Isi

1. [Orientasi: Dependency Jakarta EE Tidak Sama dengan Library Biasa](#1-orientasi-dependency-jakarta-ee-tidak-sama-dengan-library-biasa)
2. [Mental Model 4 Layer: Specification, API, Implementation, Runtime](#2-mental-model-4-layer-specification-api-implementation-runtime)
3. [API Jar: Apa Fungsinya dan Apa yang Tidak Ia Lakukan](#3-api-jar-apa-fungsinya-dan-apa-yang-tidak-ia-lakukan)
4. [Implementation Jar: Siapa yang Menjalankan Behavior?](#4-implementation-jar-siapa-yang-menjalankan-behavior)
5. [Runtime / Container: Tempat Jakarta EE Benar-Benar Hidup](#5-runtime--container-tempat-jakarta-ee-benar-benar-hidup)
6. [TCK dan Compatible Runtime](#6-tck-dan-compatible-runtime)
7. [Maven Coordinates Jakarta EE 11](#7-maven-coordinates-jakarta-ee-11)
8. [Scope `provided`: Kenapa Sering Dipakai di Jakarta EE](#8-scope-provided-kenapa-sering-dipakai-di-jakarta-ee)
9. [Maven Setup: Platform, Web Profile, Core Profile](#9-maven-setup-platform-web-profile-core-profile)
10. [Gradle Setup: `compileOnly`, `implementation`, `runtimeOnly`, dan Platform](#10-gradle-setup-compileonly-implementation-runtimeonly-dan-platform)
11. [BOM dan Version Alignment](#11-bom-dan-version-alignment)
12. [Individual Specification Dependencies](#12-individual-specification-dependencies)
13. [Container-Provided vs Application-Provided Dependencies](#13-container-provided-vs-application-provided-dependencies)
14. [WAR, EAR, Thin Deployment, Fat Jar, dan Executable Runtime](#14-war-ear-thin-deployment-fat-jar-dan-executable-runtime)
15. [Classpath Conflict dan Duplicate API Jar](#15-classpath-conflict-dan-duplicate-api-jar)
16. [`javax.*` dan `jakarta.*` Dependency Conflict](#16-javax-dan-jakarta-dependency-conflict)
17. [Transitive Dependency Trap](#17-transitive-dependency-trap)
18. [Runtime Mismatch: Compile Berhasil, Deploy Gagal](#18-runtime-mismatch-compile-berhasil-deploy-gagal)
19. [Testing Dependency Strategy](#19-testing-dependency-strategy)
20. [Dependency Management untuk Spring Boot, Quarkus, dan Jakarta Runtime](#20-dependency-management-untuk-spring-boot-quarkus-dan-jakarta-runtime)
21. [Dependency Security dan Supply Chain](#21-dependency-security-dan-supply-chain)
22. [Dependency Review Checklist](#22-dependency-review-checklist)
23. [Common Failure Modes](#23-common-failure-modes)
24. [Case Study 1: `jakarta.ws.rs-api` Ada, Tapi Endpoint Tidak Jalan](#24-case-study-1-jakartawsrs-api-ada-tapi-endpoint-tidak-jalan)
25. [Case Study 2: WAR Membawa API Jar dan Konflik dengan Container](#25-case-study-2-war-membawa-api-jar-dan-konflik-dengan-container)
26. [Case Study 3: Spring Boot 2 Library Masih Menarik `javax.servlet`](#26-case-study-3-spring-boot-2-library-masih-menarik-javaxservlet)
27. [Case Study 4: JPA API Ada, Tapi Provider Tidak Ada](#27-case-study-4-jpa-api-ada-tapi-provider-tidak-ada)
28. [Case Study 5: Jakarta EE Platform API Dipakai untuk Microservice Kecil](#28-case-study-5-jakarta-ee-platform-api-dipakai-untuk-microservice-kecil)
29. [Latihan Bertahap](#29-latihan-bertahap)
30. [Mini Project: Jakarta Dependency Matrix Lab](#30-mini-project-jakarta-dependency-matrix-lab)
31. [Referensi Resmi](#31-referensi-resmi)

---

# 1. Orientasi: Dependency Jakarta EE Tidak Sama dengan Library Biasa

Di Java biasa, dependency sering berarti:

```text
Tambahkan jar → class tersedia → behavior tersedia
```

Contoh:

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
  <version>...</version>
</dependency>
```

Jika kamu menambahkan `jackson-databind`, kamu membawa API dan implementation yang bisa langsung dipakai.

Tetapi Jakarta EE berbeda.

Dalam Jakarta EE, dependency sering berarti:

```text
Tambahkan API jar untuk compile-time
Behavior runtime disediakan oleh container/runtime
```

Contoh:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-web-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

Dependency ini membuat compiler mengenal:

```java
jakarta.ws.rs.GET
jakarta.inject.Inject
jakarta.persistence.Entity
jakarta.transaction.Transactional
```

Namun dependency ini **tidak** otomatis membuat:

- HTTP server;
- JAX-RS runtime;
- CDI container;
- JPA provider;
- transaction manager;
- servlet container;
- validation engine;
- JSON-B implementation.

Semua itu harus disediakan oleh:

- Jakarta EE compatible runtime/container;
- runtime-specific implementation;
- framework/launcher;
- atau dependency implementation yang kamu bawa sendiri.

## 1.1 Kenapa ini penting?

Kesalahan dependency Jakarta dapat menyebabkan:

- aplikasi compile tapi gagal deploy;
- endpoint tidak ter-register;
- injection tidak berjalan;
- `ClassNotFoundException`;
- `NoClassDefFoundError`;
- `ClassCastException`;
- duplicate class;
- API version mismatch;
- `javax.*` dan `jakarta.*` tercampur;
- runtime behavior berbeda antara local dan production;
- WAR membawa jar yang seharusnya disediakan container;
- fat jar tidak membawa implementation yang dibutuhkan.

## 1.2 Contoh kesalahan umum

### Kesalahan 1 — Menganggap API jar sebagai implementation

```xml
<dependency>
  <groupId>jakarta.ws.rs</groupId>
  <artifactId>jakarta.ws.rs-api</artifactId>
  <version>4.0.0</version>
</dependency>
```

Lalu berharap:

```bash
java -jar app.jar
```

menjalankan REST server.

Tidak bisa. Itu hanya API.

### Kesalahan 2 — Membawa full Jakarta EE API ke semua service

Untuk service kecil yang hanya butuh REST/JSON/CDI, memakai full Platform API bisa membuat compile-time surface terlalu luas. Developer bisa tidak sengaja memakai spec yang runtime target tidak sediakan.

### Kesalahan 3 — Menggunakan `compile` scope untuk API yang disediakan container

Jika WAR membawa API jar sendiri, bisa konflik dengan API yang sudah ada di container.

### Kesalahan 4 — Mencampur `javax.*` dan `jakarta.*`

Contoh:

```java
import javax.persistence.Entity;
import jakarta.transaction.Transactional;
```

Ini tanda dependency stack tidak selaras.

## 1.3 Goal bagian ini

Setelah bagian ini, kamu harus bisa menjawab:

1. Apa bedanya API jar dan implementation jar?
2. Kenapa Jakarta EE sering memakai `provided`?
3. Kapan `provided` salah?
4. Bagaimana setup Maven untuk Platform/Web/Core?
5. Bagaimana setup Gradle equivalent?
6. Apa itu BOM/version alignment?
7. Bagaimana membaca dependency tree Jakarta?
8. Bagaimana mendeteksi `javax`/`jakarta` conflict?
9. Bagaimana testing dependency strategy?
10. Bagaimana membuat dependency policy production-grade?

---

# 2. Mental Model 4 Layer: Specification, API, Implementation, Runtime

Pegang model ini:

```text
Specification
  ↓
API Jar
  ↓
Implementation
  ↓
Runtime / Container
```

## 2.1 Specification

Specification adalah dokumen standar.

Ia mendefinisikan:

- API contract;
- behavior;
- lifecycle;
- integration rules;
- required features;
- compatibility requirements.

Contoh:

```text
Jakarta RESTful Web Services Specification
Jakarta Persistence Specification
Jakarta Validation Specification
Jakarta Transactions Specification
```

Specification bukan jar yang kamu jalankan.

## 2.2 API Jar

API jar berisi:

- interfaces;
- annotations;
- exception classes;
- enums;
- contracts;
- sometimes abstract classes.

Contoh:

```text
jakarta.ws.rs-api
jakarta.persistence-api
jakarta.validation-api
jakarta.transaction-api
jakarta.jakartaee-web-api
```

API jar membuat code bisa compile.

## 2.3 Implementation

Implementation menjalankan behavior specification.

Contoh konsep:

| Spec | API | Possible implementation category |
|---|---|---|
| Jakarta Persistence | `jakarta.persistence-api` | Hibernate, EclipseLink, provider lain |
| Jakarta Validation | `jakarta.validation-api` | Hibernate Validator, provider lain |
| Jakarta REST | `jakarta.ws.rs-api` | Jersey, RESTEasy, CXF, runtime-integrated provider |
| Jakarta JSON Binding | `jakarta.json.bind-api` | Yasson, provider lain |
| Jakarta Servlet | `jakarta.servlet-api` | Tomcat, Jetty, Undertow, runtime servlet engine |
| Jakarta Transactions | `jakarta.transaction-api` | transaction manager/container |
| Jakarta CDI | CDI API | Weld, OpenWebBeans, runtime CDI implementation |

Implementation bisa datang dari:

- Jakarta EE runtime;
- standalone provider dependency;
- framework integration;
- vendor runtime module.

## 2.4 Runtime / Container

Runtime/container menyatukan banyak implementation dan mengelola lifecycle.

Runtime menyediakan:

- classloading;
- component discovery;
- dependency injection;
- lifecycle callback;
- transaction manager;
- servlet engine;
- request context;
- security context;
- resource lookup;
- managed thread/concurrency;
- deployment processing;
- integration antar spec.

Contoh:

```text
Deploy WAR
  → runtime scans classes
  → registers REST resources
  → creates CDI beans
  → injects dependencies
  → manages transactions
  → handles HTTP request
  → serializes JSON
```

## 2.5 Kenapa layer ini harus dipisahkan?

Karena bug sering terjadi saat engineer mencampur layer.

Contoh:

```text
API ada di compile classpath
tapi implementation tidak ada di runtime
```

Atau:

```text
implementation ada di app
tapi container punya versi API berbeda
```

Atau:

```text
runtime menyediakan Web Profile
tapi aplikasi compile against full Platform
```

---

# 3. API Jar: Apa Fungsinya dan Apa yang Tidak Ia Lakukan

## 3.1 API jar berisi contract, bukan behavior penuh

Contoh annotation:

```java
@Path("/cases")
public class CaseResource {
    @GET
    public List<CaseDto> list() {
        ...
    }
}
```

Annotation `@Path` berasal dari API jar. Tetapi yang membaca annotation, membuat routing, memanggil method, dan mengirim response adalah JAX-RS implementation/runtime.

## 3.2 API jar seperti header file

Analogi C/C++:

```text
header file memberi compiler bentuk fungsi
library memberi linker/runtime behavior
```

Jakarta API jar:

```text
memberi compiler class/annotation/interface
```

Runtime:

```text
memberi behavior
```

## 3.3 API jar tidak cukup untuk plain `java -jar`

Jika kamu membuat plain Java application:

```bash
java -jar app.jar
```

dan hanya menambahkan:

```xml
jakarta.ws.rs-api
```

maka tidak ada HTTP server.

Jika hanya menambahkan:

```xml
jakarta.persistence-api
```

maka tidak ada JPA provider.

Jika hanya menambahkan:

```xml
jakarta.validation-api
```

maka tidak ada validation engine.

## 3.4 API jar cocok untuk compile-time dependency

Dalam Jakarta EE WAR deployment:

```text
runtime already provides implementation
application needs API at compile time
```

Karena itu scope `provided`.

## 3.5 API jar bisa dipakai standalone jika implementation ditambahkan

Contoh standalone validation:

```xml
<dependency>
  <groupId>jakarta.validation</groupId>
  <artifactId>jakarta.validation-api</artifactId>
</dependency>

<dependency>
  <groupId>org.hibernate.validator</groupId>
  <artifactId>hibernate-validator</artifactId>
</dependency>
```

Di sini API + implementation ada di aplikasi.

Namun jika aplikasi berjalan dalam Jakarta EE runtime yang sudah menyediakan validation, hati-hati duplicate provider/version.

---

# 4. Implementation Jar: Siapa yang Menjalankan Behavior?

Implementation jar menyediakan behavior actual.

## 4.1 Implementation dapat berupa provider

Contoh JPA:

```text
API:
  jakarta.persistence.EntityManager

Implementation:
  Hibernate ORM / EclipseLink
```

Code kamu:

```java
@PersistenceContext
EntityManager em;
```

Yang benar-benar membuat SQL, dirty checking, flush, persistence context adalah provider.

## 4.2 Implementation dapat berupa container subsystem

Contoh Servlet:

```text
API:
  jakarta.servlet.http.HttpServlet

Implementation:
  servlet container engine
```

Container:

- menerima socket/request;
- membuat request/response;
- menjalankan filter chain;
- memanggil servlet/resource;
- mengelola session;
- melakukan async dispatch.

## 4.3 Implementation discovery

Beberapa API memakai discovery mechanism:

- `ServiceLoader`;
- provider configuration;
- container integration;
- CDI extension;
- runtime module;
- deployment descriptor;
- annotation scanning.

Jika provider tidak ada, error bisa muncul runtime.

## 4.4 Implementation version harus cocok dengan API version

Mismatched API/implementation bisa menyebabkan:

- `NoSuchMethodError`;
- `AbstractMethodError`;
- `ClassCastException`;
- undefined behavior;
- deployment failure.

Contoh:

```text
Compile with Jakarta Persistence 3.2
Runtime provider supports only older API
```

Atau:

```text
WAR bundles jakarta.validation-api 3.1
Container provides validation implementation for 3.0
```

## 4.5 Implementation bisa membawa transitive dependencies

Provider seperti ORM/JSON/REST implementation bisa menarik banyak dependencies:

- bytecode library;
- logging;
- parser;
- annotation library;
- expression language;
- classmate/reflection utility;
- connection pool integration.

Dependency tree wajib dicek.

---

# 5. Runtime / Container: Tempat Jakarta EE Benar-Benar Hidup

## 5.1 Container-managed world

Jakarta EE runtime menjalankan aplikasi dalam container-managed environment.

Artinya runtime mengelola:

- object creation;
- dependency injection;
- request lifecycle;
- transactions;
- security;
- persistence context;
- resource injection;
- thread/concurrency context;
- serialization provider;
- message listener;
- batch lifecycle;
- deployment.

## 5.2 Plain object vs container-managed component

Plain object:

```java
new CaseResource()
```

Tidak otomatis punya injection, transaction, lifecycle callback.

Container-managed object:

```text
runtime creates CaseResource
runtime injects dependency
runtime calls lifecycle callback
runtime maps HTTP request
```

Dependency hanya bekerja jika object ada dalam lifecycle container.

## 5.3 Runtime profiles

Runtime bisa compatible dengan:

- Core Profile;
- Web Profile;
- Platform.

Aplikasi harus menargetkan runtime yang menyediakan capability yang digunakan.

## 5.4 Runtime-specific launch model

Ada beberapa model:

### External application server

```text
build WAR
deploy to server
server provides Jakarta implementation
```

### Embedded/executable runtime

```text
build runnable jar/image
runtime included with application
```

### Framework-style runtime

```text
framework extension brings runtime integration
```

### Test runtime

```text
embedded container / Testcontainers / Arquillian-like setup
```

Setiap model mengubah dependency scope.

## 5.5 Runtime is part of dependency architecture

Runtime bukan hanya “infrastructure”. Runtime adalah bagian dari dependency graph operational.

Dokumentasikan:

```text
Jakarta EE version:
Profile:
Runtime:
Runtime version:
Java version:
Deployment packaging:
Container image:
Vendor extensions:
```

---

# 6. TCK dan Compatible Runtime

## 6.1 Apa itu TCK?

Technology Compatibility Kit adalah test suite untuk membuktikan implementation sesuai specification.

Jakarta EE compatibility bergantung pada TCK.

## 6.2 Kenapa TCK penting?

Tanpa TCK, kamu hanya tahu:

```text
library ini tampaknya jalan
```

Dengan TCK-compatible runtime, kamu punya confidence bahwa runtime memenuhi contract spec/profile.

## 6.3 Compatible implementation

Compatible implementation bisa untuk:

- individual specification;
- Core Profile;
- Web Profile;
- Platform.

Jika kamu target Web Profile 11, gunakan runtime yang compatible dengan Web Profile 11.

## 6.4 TCK bukan guarantee tanpa bug

Compatible runtime masih bisa punya bug atau vendor-specific behavior. Tetapi TCK memberi baseline standard behavior.

## 6.5 Production implication

Dalam production review, tanyakan:

- runtime compatible dengan profile target?
- versi runtime mendukung Jakarta EE version target?
- Java version supported?
- vendor patch/security cadence?
- TCK claim jelas?
- extension yang dipakai di luar spec?

---

# 7. Maven Coordinates Jakarta EE 11

## 7.1 Platform API

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

Target:

```text
Full Jakarta EE Platform
```

## 7.2 Web Profile API

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-web-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

Target:

```text
Jakarta EE Web Profile
```

## 7.3 Core Profile API

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-core-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

Target:

```text
Jakarta EE Core Profile
```

## 7.4 Individual API dependency

Contoh REST only:

```xml
<dependency>
  <groupId>jakarta.ws.rs</groupId>
  <artifactId>jakarta.ws.rs-api</artifactId>
  <version>4.0.0</version>
  <scope>provided</scope>
</dependency>
```

Contoh Persistence only:

```xml
<dependency>
  <groupId>jakarta.persistence</groupId>
  <artifactId>jakarta.persistence-api</artifactId>
  <version>3.2.0</version>
  <scope>provided</scope>
</dependency>
```

Gunakan individual API jika:

- kamu membuat library;
- kamu hanya butuh spec tertentu;
- kamu tidak ingin expose full profile API;
- runtime/framework mengelola sisanya.

## 7.5 Jangan campur tanpa alasan

Buruk:

```xml
jakarta.jakartaee-api 11.0.0
jakarta.servlet-api 6.0.0
jakarta.persistence-api 3.1.0
jakarta.ws.rs-api 3.1.0
```

Ini bisa menyebabkan mismatch.

Jika sudah memakai platform aggregate API, biasanya tidak perlu menambahkan individual API lagi kecuali ada alasan.

---

# 8. Scope `provided`: Kenapa Sering Dipakai di Jakarta EE

## 8.1 Maven scope recap

Maven scope menentukan kapan dependency tersedia:

- compile;
- runtime;
- test;
- provided;
- system;
- import.

Dalam Maven, scope membatasi transitivity dan menentukan classpath mana yang berisi dependency.

## 8.2 Makna `provided`

`provided` berarti:

```text
needed to compile and test
but expected to be provided by runtime/container
not packaged into final artifact like WAR
```

Untuk Jakarta EE:

```text
API jar needed for compilation
container provides API + implementation at runtime
```

## 8.3 Contoh WAR

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-web-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

Hasil:

```text
compile sees Jakarta classes
WAR does not include API jar
container provides them
```

## 8.4 Kenapa bukan `compile`?

Jika scope compile, jar bisa masuk artifact.

Risiko:

- duplicate API class;
- classloader conflict;
- incompatible API with runtime;
- weird `ClassCastException`;
- deployment failure.

## 8.5 Kapan `provided` salah?

`provided` salah jika runtime tidak menyediakan dependency tersebut.

Contoh plain executable jar:

```bash
java -jar myapp.jar
```

Jika app butuh REST runtime, tetapi semua Jakarta API scope `provided` dan tidak ada runtime implementation, app gagal.

Dalam executable runtime packaging, kamu perlu mengikuti model dependency runtime yang ditentukan runtime/framework.

## 8.6 `provided` bukan berarti dependency tidak penting

`provided` tetap bagian dari contract.

Kamu harus memastikan production runtime menyediakan versi yang kompatibel.

---

# 9. Maven Setup: Platform, Web Profile, Core Profile

## 9.1 Web Profile WAR example

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.example</groupId>
  <artifactId>case-web</artifactId>
  <version>1.0.0</version>
  <packaging>war</packaging>

  <properties>
    <maven.compiler.release>17</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <jakartaee.version>11.0.0</jakartaee.version>
  </properties>

  <dependencies>
    <dependency>
      <groupId>jakarta.platform</groupId>
      <artifactId>jakarta.jakartaee-web-api</artifactId>
      <version>${jakartaee.version}</version>
      <scope>provided</scope>
    </dependency>
  </dependencies>
</project>
```

## 9.2 Full Platform WAR/EAR example

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

Use when app genuinely targets full Platform.

## 9.3 Core Profile example

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-core-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

But ensure runtime supports Core Profile.

## 9.4 Maven compiler

Jakarta EE 11 minimum is Java SE 17 or higher.

```xml
<properties>
  <maven.compiler.release>17</maven.compiler.release>
</properties>
```

If your target runtime supports Java 21/25 and you intentionally compile with newer release, document it.

## 9.5 Maven Enforcer

Use Enforcer for:

- Java version;
- Maven version;
- banned dependencies;
- dependency convergence;
- no `javax.*` API;
- no duplicate Jakarta API jar.

Conceptual:

```xml
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
          <requireJavaVersion>
            <version>[17,)</version>
          </requireJavaVersion>
          <dependencyConvergence/>
        </rules>
      </configuration>
    </execution>
  </executions>
</plugin>
```

## 9.6 Dependency tree

Always run:

```bash
mvn dependency:tree
```

For Jakarta migration:

```bash
mvn dependency:tree | grep javax
mvn dependency:tree | grep jakarta
```

On Windows PowerShell:

```powershell
mvn dependency:tree | Select-String "javax"
mvn dependency:tree | Select-String "jakarta"
```

---

# 10. Gradle Setup: `compileOnly`, `implementation`, `runtimeOnly`, dan Platform

## 10.1 Gradle equivalent of Maven `provided`

For Java library/application compilation where runtime provides API:

```kotlin
dependencies {
    compileOnly("jakarta.platform:jakarta.jakartaee-web-api:11.0.0")
    testCompileOnly("jakarta.platform:jakarta.jakartaee-web-api:11.0.0")
}
```

Depending on test setup, you may need test runtime/container dependencies.

## 10.2 WAR plugin

```kotlin
plugins {
    java
    war
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}

dependencies {
    compileOnly("jakarta.platform:jakarta.jakartaee-web-api:11.0.0")
}
```

## 10.3 `implementation`

Use `implementation` for libraries packaged with application.

Example standalone app:

```kotlin
dependencies {
    implementation("org.hibernate.validator:hibernate-validator:...")
}
```

But if container provides validation implementation, do not package another incompatible one without reason.

## 10.4 `runtimeOnly`

Use `runtimeOnly` when compile uses API but runtime needs provider.

Example plain Java validation app:

```kotlin
dependencies {
    implementation("jakarta.validation:jakarta.validation-api:...")
    runtimeOnly("org.hibernate.validator:hibernate-validator:...")
}
```

## 10.5 Gradle platform/BOM

Gradle supports importing Maven BOMs as platforms.

Example conceptual:

```kotlin
dependencies {
    implementation(platform("some.group:some-bom:1.0.0"))
}
```

For Jakarta aggregate APIs, often you directly depend on profile API artifact. For broader ecosystem such as Spring Boot/Quarkus, use their platform/BOM to align versions.

## 10.6 Gradle dependency insight

Use:

```bash
./gradlew dependencies
./gradlew dependencyInsight --dependency jakarta.servlet
./gradlew dependencyInsight --dependency javax.servlet
```

Powerful for tracking transitive conflicts.

---

# 11. BOM dan Version Alignment

## 11.1 Apa itu BOM?

BOM = Bill of Materials.

Dalam Maven, BOM biasanya POM yang berisi `dependencyManagement` untuk mengatur versi banyak dependency.

Tujuan:

```text
align versions across dependency set
```

## 11.2 Jakarta aggregate API bukan selalu BOM dalam pemakaian sehari-hari

`jakarta.jakartaee-api`, `jakarta.jakartaee-web-api`, dan `jakarta.jakartaee-core-api` adalah aggregate API artifacts.

Mereka menggabungkan API dari individual projects.

Maven Central menunjukkan `jakarta.jakartaee-api` 11.0.0 sebagai artifact di namespace `jakarta.platform`.

## 11.3 Kapan memakai BOM?

Gunakan BOM saat:

- framework menyediakan managed versions;
- runtime vendor punya BOM;
- multi-module project butuh alignment;
- kamu memakai banyak individual APIs/providers;
- kamu ingin centralized dependency version.

Contoh framework BOM:

- Spring Boot BOM;
- Quarkus platform BOM;
- runtime/vendor BOM;
- internal company platform BOM.

## 11.4 Internal company BOM

Untuk enterprise, sering berguna punya internal BOM:

```text
company-java-platform-bom
  Java version baseline
  Jakarta EE version
  Spring/Quarkus/runtime version
  Jackson
  Hibernate
  Testcontainers
  JUnit
  Mockito
  OpenTelemetry
  logging
```

Tujuan:

- version alignment;
- vulnerability patch rollout;
- standardization;
- faster service bootstrap;
- easier migration.

## 11.5 Dependency management rule

One owner for versions.

Bad:

```text
parent POM manages Jakarta 10
service overrides servlet 6
library pulls validation 3.0
runtime expects Jakarta 11
```

Good:

```text
platform BOM defines versions
services do not override casually
exceptions documented
```

---

# 12. Individual Specification Dependencies

## 12.1 When to use individual spec dependency

Use individual API dependencies when:

- building a library;
- targeting plain Java SE with specific provider;
- avoiding full profile compile surface;
- writing test utilities;
- implementing adapter that only needs one API;
- documenting exact spec usage.

Example library that exposes JAX-RS annotations:

```xml
<dependency>
  <groupId>jakarta.ws.rs</groupId>
  <artifactId>jakarta.ws.rs-api</artifactId>
  <version>4.0.0</version>
  <scope>provided</scope>
</dependency>
```

## 12.2 Be careful exposing Jakarta API from library

If your public library API exposes Jakarta classes:

```java
public Response handle(ContainerRequestContext ctx)
```

then all consumers inherit Jakarta dependency.

If library should be framework-neutral, hide Jakarta API in adapter layer.

## 12.3 Individual API plus implementation

Plain Java example with JSON-B:

```xml
<dependency>
  <groupId>jakarta.json.bind</groupId>
  <artifactId>jakarta.json.bind-api</artifactId>
  <version>...</version>
</dependency>
<dependency>
  <groupId>org.eclipse</groupId>
  <artifactId>yasson</artifactId>
  <version>...</version>
</dependency>
```

But check exact compatible versions.

## 12.4 Avoid random mixing

Do not manually assemble half of Jakarta EE unless you understand integration.

Example risk:

```text
JAX-RS implementation + CDI implementation + JSON-B implementation + Validation implementation
```

These need integration. A compatible runtime may be safer.

---

# 13. Container-Provided vs Application-Provided Dependencies

## 13.1 Container-provided

Container-provided dependencies are supplied by runtime.

Examples in full Jakarta runtime:

- Servlet API + engine;
- CDI API + implementation;
- JPA API + configured provider;
- Transaction API + manager;
- Validation API + provider;
- REST API + implementation;
- JSON provider;
- Security integration.

Application compiles against APIs and deploys.

## 13.2 Application-provided

Application-provided dependencies are packaged with app.

Examples:

- domain library;
- utility library;
- internal shared module;
- application-specific adapter;
- third-party client;
- OpenTelemetry API/instrumentation if not runtime-provided;
- runtime-specific bootstrap if executable jar.

## 13.3 Decision table

| Dependency | WAR in Jakarta runtime | Plain executable jar |
|---|---|---|
| Jakarta API | provided | maybe implementation/framework-managed |
| Jakarta implementation | container-provided | packaged/embedded |
| JDBC driver | often application/server config | packaged or runtime configured |
| Domain libs | packaged | packaged |
| JSON utility custom | packaged | packaged |
| JPA provider | container or app depending runtime | packaged |
| Servlet engine | container | embedded if needed |

## 13.4 Who owns the version?

Container-provided:

```text
runtime owner controls version
```

Application-provided:

```text
application build controls version
```

This affects patching.

If CVE appears in a container-provided library, updating application POM may not fix it. You must patch runtime/container image.

---

# 14. WAR, EAR, Thin Deployment, Fat Jar, dan Executable Runtime

## 14.1 WAR model

```text
WAR contains app classes/resources/libs
Runtime contains Jakarta APIs/implementations
```

Scope:

```text
Jakarta API = provided
App libraries = compile/runtime packaged
```

## 14.2 EAR model

```text
EAR groups multiple modules:
  web module
  EJB module
  application client
  shared libs
```

Mostly relevant for legacy/full enterprise.

## 14.3 Thin deployment

Thin deployment means artifact depends heavily on runtime.

Pros:

- smaller artifact;
- runtime manages implementations;
- standard app server model.

Cons:

- runtime/app version coupling;
- local reproduction harder;
- server patching separate;
- classloader nuance.

## 14.4 Fat jar / uber jar

Fat jar packages dependencies in one jar.

In Jakarta EE, fat jar is not automatically portable unless runtime bootstrap is included correctly.

Risk:

- duplicate APIs;
- shaded packages;
- service loader breakage;
- reflection/resource path issue;
- classpath conflict;
- larger image.

## 14.5 Executable runtime image

Some Jakarta runtimes build executable app with runtime included.

Pros:

- container-friendly;
- predictable runtime;
- easier local/prod parity.

Cons:

- runtime-specific packaging;
- portability changes;
- update runtime requires rebuild.

## 14.6 Packaging rule

Choose packaging based on runtime model, not habit.

```text
External compatible server → WAR/EAR + provided APIs
Embedded runtime → runtime-specific dependencies
Plain Java SE → API + implementation dependencies
Spring Boot → Spring Boot dependency model
Quarkus/Micronaut → extension/platform model
```

---

# 15. Classpath Conflict dan Duplicate API Jar

## 15.1 What is duplicate API problem?

Container has:

```text
jakarta.servlet-api 6.1
```

WAR includes:

```text
jakarta.servlet-api 6.0
```

Now classloading may choose one in different places.

Symptoms:

- `ClassCastException`;
- `NoSuchMethodError`;
- deployment error;
- provider not found;
- annotation not recognized;
- behavior differs local/prod.

## 15.2 Why annotations can fail

If annotation class loaded by app classloader differs from annotation class expected by container, runtime scanning may fail or behave strangely.

Class identity:

```text
class name + classloader
```

Two classes with same name but different classloader are different.

## 15.3 How to detect duplicate API

Maven:

```bash
mvn dependency:tree | grep jakarta.servlet
mvn dependency:tree | grep jakarta.platform
```

Inspect WAR:

```bash
jar tf target/app.war | grep WEB-INF/lib | grep jakarta
```

PowerShell:

```powershell
jar tf target/app.war | Select-String "WEB-INF/lib.*jakarta"
```

## 15.4 Rule

For container-deployed WAR:

```text
Jakarta profile API should usually be provided, not packaged.
```

For executable runtime:

```text
Follow runtime/framework packaging guidance.
```

---

# 16. `javax.*` dan `jakarta.*` Dependency Conflict

## 16.1 The namespace split

Jakarta EE 8 used `javax.*`.

Jakarta EE 9+ uses `jakarta.*`.

Mixing them often means ecosystem mismatch.

## 16.2 Common conflict

```text
Spring Boot 3 app
  uses jakarta.servlet

Old library
  depends on javax.servlet-api
```

Symptoms:

- compile errors;
- runtime `ClassNotFoundException`;
- method signature mismatch;
- filters/listeners not registered;
- validation annotations not recognized.

## 16.3 Not all `javax` is wrong

Do not blind-replace all `javax`.

Still Java SE:

- `javax.crypto`;
- `javax.net.ssl`;
- `javax.sql`;
- `javax.management`;
- `javax.naming` may still appear depending usage;
- other Java SE `javax` packages.

The migration is for Java EE/Jakarta EE specifications, not every `javax` package in the JDK.

## 16.4 Detection

```bash
mvn dependency:tree | grep javax
mvn dependency:tree | grep jakarta
```

Also scan source:

```bash
grep -R "import javax\." src/main/java
grep -R "import jakarta\." src/main/java
```

## 16.5 Migration policy

- For Jakarta EE 10/11 stack, use `jakarta.*` enterprise APIs.
- Upgrade libraries to Jakarta-compatible versions.
- Avoid adapters that expose `javax.*` in public API.
- If stuck with old library, isolate behind adapter or keep old runtime until migration.

---

# 17. Transitive Dependency Trap

## 17.1 Transitive dependencies are hidden risk

You add:

```xml
<dependency>
  <groupId>com.vendor</groupId>
  <artifactId>legacy-client</artifactId>
</dependency>
```

It pulls:

```text
javax.ws.rs-api
javax.validation-api
old jackson
old byte buddy
old servlet
```

Now your Jakarta EE 11 app has hidden conflict.

## 17.2 Dependency tree must be part of review

Every new dependency PR should include:

```bash
mvn dependency:tree
```

or Gradle:

```bash
./gradlew dependencyInsight --dependency <artifact>
```

## 17.3 Exclusions

Use exclusions carefully.

```xml
<exclusion>
  <groupId>javax.servlet</groupId>
  <artifactId>javax.servlet-api</artifactId>
</exclusion>
```

But ensure library actually works without it or with Jakarta equivalent. Package rename is binary incompatible; exclusion alone may not fix.

## 17.4 Old library may be impossible to migrate safely

If library compiled against `javax.servlet.Filter`, it will not automatically work with `jakarta.servlet.Filter`.

You may need:

- upgraded version;
- migration transformer;
- adapter layer;
- replacement library;
- keep old stack.

## 17.5 Dependency convergence

Use Maven Enforcer or Gradle constraints to avoid multiple versions of same family.

---

# 18. Runtime Mismatch: Compile Berhasil, Deploy Gagal

## 18.1 Why compile is not enough

Compile only checks:

```text
Are classes available to compiler?
```

Deploy checks:

```text
Can runtime provide required components and behavior?
```

## 18.2 Example

Compile against full Platform:

```xml
jakarta.jakartaee-api
```

Use:

```java
import jakarta.jms.Message;
```

Deploy to Web Profile runtime.

Result:

```text
JMS not available
deployment fails or runtime error
```

## 18.3 Prevention

- compile against target profile, not larger profile;
- test on same runtime/profile as production;
- use integration tests in container;
- avoid full API dependency unless target full Platform;
- document runtime compatibility.

## 18.4 Target profile should be build-time guard

If target is Web Profile, depend on:

```xml
jakarta.jakartaee-web-api
```

not full platform.

Then compiler prevents accidental JMS/Batch/Mail usage.

This is a powerful design guard.

---

# 19. Testing Dependency Strategy

## 19.1 Unit tests

Domain unit tests should not need Jakarta EE runtime.

Keep domain pure.

## 19.2 Component tests

If testing CDI/JAX-RS/JPA behavior, you need runtime support.

Options:

- embedded runtime;
- Testcontainers with real server/runtime;
- Arquillian-like approach;
- framework-specific test extension;
- local compatible runtime.

## 19.3 Test dependency trap

Using implementation in test but different implementation in production can hide bugs.

Example:

```text
test uses H2 + Hibernate
prod uses PostgreSQL + EclipseLink
```

Behavior can differ.

## 19.4 Test scope

Maven:

```xml
<dependency>
  <groupId>...</groupId>
  <artifactId>...</artifactId>
  <scope>test</scope>
</dependency>
```

Test dependencies should not leak into production artifact.

## 19.5 Contract tests

For profile/runtime:

- deploy artifact to target runtime;
- verify endpoints;
- verify injection;
- verify transaction;
- verify validation;
- verify JSON binding;
- verify persistence;
- verify security.

## 19.6 Dependency snapshot tests

For enterprise migration, keep dependency reports:

```text
DEPENDENCY_TREE_BEFORE.txt
DEPENDENCY_TREE_AFTER.txt
```

Review diff.

---

# 20. Dependency Management untuk Spring Boot, Quarkus, dan Jakarta Runtime

## 20.1 Spring Boot

Spring Boot manages dependencies via its BOM/dependency management.

For Spring Boot 3+:

- Jakarta namespace used;
- Servlet/JPA/Validation packages are `jakarta.*`;
- do not manually force Jakarta API versions unless needed;
- let Boot manage compatible versions;
- use starters.

Bad:

```xml
spring-boot-starter-web
+ random jakarta.servlet-api version override
```

Good:

```xml
spring-boot-starter-web
```

and Boot BOM controls versions.

## 20.2 Quarkus

Quarkus uses platform BOM/extensions.

Use Quarkus extension model:

```text
quarkus-resteasy-reactive
quarkus-hibernate-orm
quarkus-jdbc-postgresql
```

Do not assemble Jakarta implementations manually unless advanced.

## 20.3 Micronaut

Micronaut has its own BOM/platform and Jakarta support.

Follow Micronaut dependency management.

## 20.4 Jakarta EE runtime

For classic Jakarta runtime:

- use profile API with `provided`;
- deploy to compatible runtime;
- runtime provides implementation.

## 20.5 Mixed ecosystem warning

Combining Spring Boot embedded runtime with Jakarta EE container model can be confusing.

Example:

```text
Spring Boot executable jar deployed inside external Jakarta EE server
```

Usually not recommended unless intentionally designed.

---

# 21. Dependency Security dan Supply Chain

## 21.1 Dependency is attack surface

Every dependency can bring:

- vulnerabilities;
- transitive vulnerabilities;
- malicious package risk;
- license issue;
- abandoned maintenance;
- classpath conflict;
- runtime behavior changes.

## 21.2 Jakarta-specific security concerns

- outdated runtime server;
- outdated provider implementation;
- old XML parser/JAXB stack;
- old REST provider;
- old validation provider;
- old JSON binding provider;
- old servlet container;
- old JMS client/provider;
- `javax` legacy library with known CVEs.

## 21.3 Scan both app and runtime image

If dependency is container-provided, scanning app POM is not enough.

Scan:

- application dependencies;
- runtime/container image;
- base image;
- server libraries;
- deployment plugins;
- build dependencies.

## 21.4 SBOM

Generate SBOM for:

- application artifact;
- container image;
- runtime image.

## 21.5 Version pinning

Avoid dynamic versions:

```text
[1.0,)
LATEST
RELEASE
+
```

Use pinned versions through BOM.

## 21.6 Dependency approval policy

For new dependency:

- why needed?
- maintained?
- license?
- security history?
- transitive dependencies?
- Jakarta namespace compatibility?
- runtime compatibility?
- replacement alternatives?
- owner?

---

# 22. Dependency Review Checklist

## 22.1 Profile alignment

- [ ] Does dependency match target profile?
- [ ] Are you compiling against larger profile than runtime?
- [ ] Is full Platform API justified?
- [ ] Is Core/Web enough?

## 22.2 Scope

- [ ] Jakarta API dependency is `provided` / `compileOnly` for container deployment?
- [ ] Implementation dependency is packaged only when app owns runtime?
- [ ] Test dependencies do not leak?
- [ ] Runtime dependencies present for executable jar?

## 22.3 Version

- [ ] Jakarta EE version aligned?
- [ ] API and implementation compatible?
- [ ] Runtime supports target Jakarta version?
- [ ] Java version baseline compatible?
- [ ] BOM/platform used?

## 22.4 Namespace

- [ ] No accidental `javax` enterprise API in Jakarta stack?
- [ ] No blind replacement of Java SE `javax` packages?
- [ ] Transitive dependencies checked?

## 22.5 Packaging

- [ ] WAR does not include container-provided API jars?
- [ ] Fat jar does not duplicate runtime APIs?
- [ ] Container image includes correct runtime?
- [ ] Deployment artifact inspected?

## 22.6 Security

- [ ] Dependency scanned?
- [ ] Runtime image scanned?
- [ ] License checked?
- [ ] Vulnerability owner assigned?
- [ ] SBOM generated?

## 22.7 Testing

- [ ] Tested on target runtime?
- [ ] Integration test covers container-managed behavior?
- [ ] Dependency tree saved?
- [ ] Runtime mismatch tested?

---

# 23. Common Failure Modes

## 23.1 `ClassNotFoundException`

Example:

```text
ClassNotFoundException: jakarta.servlet.Filter
```

Possible causes:

- runtime too old;
- wrong namespace;
- dependency not packaged when needed;
- API jar missing in test runtime.

## 23.2 `NoClassDefFoundError`

Class was present at compile but missing at runtime.

Common when:

- API dependency scope `provided` but no runtime container;
- deployment to wrong runtime;
- transitive dependency missing.

## 23.3 `NoSuchMethodError`

Usually version mismatch.

Example:

```text
API version newer than runtime implementation
```

## 23.4 `ClassCastException`

Possible duplicate classes loaded by different classloaders.

Often caused by packaging API jar that container already provides.

## 23.5 Provider not found

Example:

```text
No Persistence provider for EntityManager
```

API exists but implementation/provider not configured.

## 23.6 Annotation ignored

Possible causes:

- wrong namespace annotation;
- annotation class loaded from different classloader;
- runtime not scanning package;
- missing implementation;
- deployment descriptor mismatch.

## 23.7 Works locally, fails on server

Likely local runtime differs from server runtime.

Fix:

- containerized integration test;
- same runtime version;
- dependency tree comparison;
- deployment artifact inspection.

---

# 24. Case Study 1: `jakarta.ws.rs-api` Ada, Tapi Endpoint Tidak Jalan

## 24.1 Setup

Developer creates:

```java
@Path("/hello")
public class HelloResource {
    @GET
    public String hello() {
        return "hello";
    }
}
```

POM:

```xml
<dependency>
  <groupId>jakarta.ws.rs</groupId>
  <artifactId>jakarta.ws.rs-api</artifactId>
  <version>4.0.0</version>
</dependency>
```

Run:

```bash
java -jar app.jar
```

Nothing listens on HTTP port.

## 24.2 Root cause

`jakarta.ws.rs-api` contains annotations and interfaces, not HTTP server or JAX-RS runtime.

## 24.3 Fix options

- deploy to Jakarta EE runtime with JAX-RS implementation;
- use runtime/framework that packages JAX-RS implementation;
- add specific JAX-RS implementation and server bootstrap;
- use Spring Boot/Quarkus/Micronaut model if chosen.

## 24.4 Lesson

API dependency does not imply runtime behavior.

---

# 25. Case Study 2: WAR Membawa API Jar dan Konflik dengan Container

## 25.1 Setup

WAR contains:

```text
WEB-INF/lib/jakarta.servlet-api-6.0.0.jar
```

Container provides:

```text
jakarta.servlet-api-6.1.0
```

## 25.2 Symptom

Deployment weird:

- filters not invoked;
- `ClassCastException`;
- `NoSuchMethodError`;
- annotation scanning mismatch.

## 25.3 Root cause

API jar should have been `provided`.

## 25.4 Fix

POM:

```xml
<scope>provided</scope>
```

Inspect WAR:

```bash
jar tf target/app.war | grep jakarta.servlet
```

Should not include container-provided API jar.

## 25.5 Lesson

Class identity includes classloader. Duplicate API classes can break container integration.

---

# 26. Case Study 3: Spring Boot 2 Library Masih Menarik `javax.servlet`

## 26.1 Setup

Spring Boot 3 app uses `jakarta.servlet`.

A legacy internal library depends on:

```xml
javax.servlet:javax.servlet-api
```

## 26.2 Symptom

Compile/runtime failures.

Library method signature:

```java
void filter(javax.servlet.http.HttpServletRequest request)
```

Cannot accept:

```java
jakarta.servlet.http.HttpServletRequest
```

## 26.3 Root cause

Namespace migration is binary/source incompatible.

## 26.4 Fix options

- upgrade internal library to Jakarta-compatible version;
- create new major version;
- isolate legacy behind adapter;
- avoid using old library in Jakarta stack.

## 26.5 Lesson

`javax` to `jakarta` is not just dependency version change. It changes package names and method signatures.

---

# 27. Case Study 4: JPA API Ada, Tapi Provider Tidak Ada

## 27.1 Setup

Plain Java app:

```xml
<dependency>
  <groupId>jakarta.persistence</groupId>
  <artifactId>jakarta.persistence-api</artifactId>
</dependency>
```

Code:

```java
Persistence.createEntityManagerFactory("app");
```

## 27.2 Symptom

```text
No Persistence provider for EntityManager named app
```

## 27.3 Root cause

JPA API exists, but no provider implementation.

## 27.4 Fix

Add provider and database dependencies, or run in Jakarta EE runtime that provides configured provider.

Example concept:

```xml
<dependency>
  <groupId>org.hibernate.orm</groupId>
  <artifactId>hibernate-core</artifactId>
</dependency>
```

plus JDBC driver/config.

## 27.5 Lesson

Persistence API is only contract. Provider does ORM behavior.

---

# 28. Case Study 5: Jakarta EE Platform API Dipakai untuk Microservice Kecil

## 28.1 Setup

Small JSON transformation service uses:

```xml
jakarta.jakartaee-api
```

Then developer accidentally imports:

```java
jakarta.jms.Message
jakarta.batch.api.Batchlet
```

## 28.2 Symptom

Compile passes, but runtime Core Profile does not provide JMS/Batch.

## 28.3 Root cause

Compiled against larger API surface than runtime target.

## 28.4 Fix

Compile against Core Profile API:

```xml
jakarta.jakartaee-core-api
```

Now compiler prevents accidental use of out-of-profile APIs.

## 28.5 Lesson

Choose compile-time API to match runtime/profile target. Dependency is an architecture guard.

---

# 29. Latihan Bertahap

## Latihan 1 — Inspect API jar

Create project with:

```xml
jakarta.jakartaee-web-api
```

Run:

```bash
mvn dependency:tree
```

Inspect what APIs are available.

## Latihan 2 — Provided vs compile

Create WAR with Jakarta API dependency as compile. Inspect:

```bash
jar tf target/app.war | grep WEB-INF/lib
```

Then change to provided and compare.

## Latihan 3 — Runtime missing implementation

Create plain Java app with only `jakarta.validation-api`.

Try to validate a bean.

Add validation provider and compare.

## Latihan 4 — Web Profile guard

Compile service with Web Profile API and try importing `jakarta.jms.Message`.

Observe compile failure if not available through that profile.

## Latihan 5 — Transitive `javax`

Add an old dependency that pulls `javax.servlet`.

Use:

```bash
mvn dependency:tree | grep javax
```

Document mitigation.

## Latihan 6 — Gradle dependency insight

In Gradle:

```bash
./gradlew dependencyInsight --dependency jakarta.servlet
./gradlew dependencyInsight --dependency javax.servlet
```

Explain result.

## Latihan 7 — Dependency ADR

Write ADR:

```text
ADR: Use jakarta.jakartaee-web-api:11.0.0 with provided scope for case-web WAR
```

Include:

- target runtime;
- profile;
- packaging;
- scope rationale;
- risks;
- validation plan.

---

# 30. Mini Project: Jakarta Dependency Matrix Lab

## 30.1 Goal

Build repository:

```text
jakarta-dependency-matrix-lab/
  core-service/
  web-service/
  platform-service/
  plain-java-validation/
  docs/
```

## 30.2 Modules

### `core-service`

- compile against `jakarta.jakartaee-core-api`;
- REST + JSON + CDI style classes;
- no JPA/JMS.

### `web-service`

- compile against `jakarta.jakartaee-web-api`;
- REST + JPA + Transaction + Validation.

### `platform-service`

- compile against `jakarta.jakartaee-api`;
- includes JMS/Batch/Mail conceptual usage.

### `plain-java-validation`

- uses `jakarta.validation-api`;
- adds validation provider explicitly;
- runs with plain `java -jar`.

## 30.3 Docs

Create:

```text
DEPENDENCY-MATRIX.md
PROFILE-RUNTIME-MATRIX.md
SCOPE-EXPLANATION.md
FAILURE-MODES.md
```

## 30.4 Required experiments

1. Compile with wrong profile and observe failure.
2. Package WAR with API jar and inspect artifact.
3. Remove implementation from plain Java validation and observe provider failure.
4. Add old `javax` dependency and detect it.
5. Use dependency tree and dependency insight.
6. Document runtime compatibility.

## 30.5 Evaluation questions

1. Which dependencies are compile-time only?
2. Which dependencies are runtime-provided?
3. Which dependencies are application-provided?
4. Which profile prevents accidental API usage?
5. Which module can run as plain Java?
6. Which module requires compatible runtime?
7. How do you know provider exists?
8. How do you detect namespace conflict?
9. What should be scanned for CVE: app or runtime?
10. What goes into ADR?

---

# 31. Referensi Resmi

Referensi utama:

1. Jakarta EE Platform 11  
   https://jakarta.ee/specifications/platform/11/

2. Jakarta EE Web Profile 11  
   https://jakarta.ee/specifications/webprofile/11/

3. Jakarta EE Core Profile 11  
   https://jakarta.ee/specifications/coreprofile/11/

4. Jakarta EE Compatible Implementations and Compatible Products  
   https://jakarta.ee/committees/specification/compatibility/

5. Jakarta EE API GitHub Project  
   https://github.com/jakartaee/jakartaee-api

6. Maven Central — `jakarta.platform:jakarta.jakartaee-api:11.0.0`  
   https://central.sonatype.com/artifact/jakarta.platform/jakarta.jakartaee-api/11.0.0/jar

7. Maven Central — `jakarta.platform:jakarta.jakartaee-web-api:11.0.0`  
   https://central.sonatype.com/artifact/jakarta.platform/jakarta.jakartaee-web-api/11.0.0/jar

8. Apache Maven — Introduction to the Dependency Mechanism  
   https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html

9. Apache Maven — POM Reference, Dependency Management  
   https://maven.apache.org/pom.html

10. Gradle Java Library Plugin  
    https://docs.gradle.org/current/userguide/java_library_plugin.html

11. Gradle Platforms/BOM Support  
    https://docs.gradle.org/current/userguide/platforms.html

12. Jakarta EE Tutorial  
    https://jakarta.ee/learn/docs/jakartaee-tutorial/current/

---

# Penutup

Dependency management Jakarta EE harus dipahami sebagai arsitektur, bukan sekadar snippet POM.

Mental model paling penting:

```text
Specification defines contract.
API jar lets code compile.
Implementation executes behavior.
Runtime/container integrates and manages lifecycle.
```

Karena itu:

```text
jakarta.*-api dependency ≠ running Jakarta EE application
```

Scope `provided` bukan kebiasaan lama tanpa alasan. Ia menyatakan:

```text
This dependency is needed to compile,
but the runtime/container is responsible for providing it.
```

Namun untuk executable jar atau plain Java SE, `provided` bisa salah karena tidak ada container yang menyediakan behavior.

Engineer top-tier tidak hanya menambahkan dependency sampai compile hijau. Ia memastikan:

- API sesuai profile;
- runtime compatible;
- implementation tersedia;
- scope benar;
- artifact tidak membawa duplicate API;
- `javax` dan `jakarta` tidak tercampur;
- transitive dependency terkendali;
- security scanning mencakup app dan runtime;
- decision didokumentasikan.

Bagian berikutnya akan membahas **Runtime / Container Model** lebih dalam: bagaimana Jakarta EE container membuat object, mengelola lifecycle, injection, transaction, security, classloading, deployment, dan kenapa behavior container-managed berbeda dari plain Java object.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jakarta-part-002.md">⬅️ Bagian 2 — Jakarta EE Platform, Web Profile, dan Core Profile</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-java-jakarta-part-004.md">Bagian 4 — Runtime / Container Model: Cara Jakarta EE Benar-Benar Menjalankan Aplikasi ➡️</a>
</div>
