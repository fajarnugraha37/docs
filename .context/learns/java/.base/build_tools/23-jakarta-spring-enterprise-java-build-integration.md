# Part 23 — Jakarta/Spring/Enterprise Java Build Integration

Series: `learn-java-build-gradle-maven-engineering`  
File: `23-jakarta-spring-enterprise-java-build-integration.md`  
Scope: Java 8–25, Maven, Gradle, Jakarta EE, Spring Boot, enterprise integration build pipelines

---

## 0. Orientasi: apa yang sedang kita pelajari?

Pada bagian sebelumnya kita sudah membangun fondasi besar tentang:

- build mental model;
- Java version strategy;
- Maven core;
- Gradle core;
- dependency graph;
- repository engineering;
- reproducibility;
- compiler engineering;
- testing pipeline;
- packaging;
- plugin engineering;
- CI/CD;
- release;
- security;
- enterprise governance;
- multi-module architecture.

Bagian ini menghubungkan semua fondasi itu ke dunia nyata enterprise Java: **Jakarta EE, Spring Boot, application server, generated code, database migration, identity provider extension, container image, dan deployment artifact**.

Tujuan bagian ini bukan mengulang materi Spring/Jakarta yang sudah dipelajari sebelumnya. Fokusnya adalah:

> Bagaimana Maven/Gradle harus didesain agar project Jakarta/Spring enterprise bisa dibangun, diuji, dipaketkan, dirilis, dan dioperasikan secara aman, reproducible, serta maintainable.

Dengan kata lain, kita melihat Jakarta/Spring bukan sebagai framework API, tetapi sebagai **build integration surface**.

---

## 1. Mental model utama: framework bukan hanya runtime, framework juga mengubah build

Banyak engineer melihat framework seperti ini:

```text
Source code -> framework runtime -> application works
```

Engineer yang lebih matang melihatnya seperti ini:

```text
Source code
  -> annotation processing
  -> generated sources/resources
  -> dependency graph
  -> test runtime classpath
  -> packaging format
  -> deployment model
  -> runtime container contract
  -> operational artifact
```

Spring Boot dan Jakarta EE berbeda bukan hanya pada API, tetapi pada **build contract**.

### 1.1 Spring Boot build contract

Spring Boot umumnya membawa model:

```text
Application owns runtime.
```

Biasanya artifact-nya:

```text
executable JAR / executable WAR / OCI image
```

Konsekuensi build:

- dependency runtime banyak ikut masuk ke artifact;
- plugin repackage mengubah bentuk JAR/WAR;
- dependency management sering berasal dari Spring Boot BOM;
- test sering berjalan dengan embedded runtime;
- container image bisa dibuat langsung dari build tool;
- upgrade Spring Boot sering berarti upgrade dependency ecosystem besar.

### 1.2 Jakarta EE build contract

Jakarta EE tradisional sering membawa model:

```text
Application server owns much of runtime.
```

Artifact-nya bisa berupa:

```text
WAR / EAR / thin JAR / provider JAR / resource adapter / application client
```

Konsekuensi build:

- banyak API harus `provided`, bukan dibundel;
- artifact harus kompatibel dengan application server target;
- classloader boundary sangat penting;
- deployment descriptor/resource packaging masih relevan;
- dependency conflict bisa terjadi antara aplikasi dan server module;
- server version menjadi bagian dari compatibility matrix.

### 1.3 Enterprise integration build contract

Enterprise Java sering tidak hanya Spring atau Jakarta. Di satu sistem bisa ada:

- Spring Boot microservices;
- Jakarta EE WAR legacy;
- Keycloak SPI provider;
- OpenAPI-generated clients;
- SOAP/JAXB-generated code;
- JPA metamodel;
- jOOQ generated DSL;
- Flyway/Liquibase migration;
- Testcontainers integration test;
- container image;
- SBOM;
- internal BOM;
- corporate parent POM/convention plugin.

Maka build harus diperlakukan sebagai **integration orchestrator**, bukan hanya compile command.

---

## 2. Build integration surface: daftar hal yang harus dikontrol

Saat sebuah enterprise Java project memakai Spring/Jakarta, build biasanya harus mengontrol minimal area berikut:

| Area | Pertanyaan build |
|---|---|
| Java version | compile dengan Java berapa, runtime dengan Java berapa? |
| API baseline | Jakarta EE 8/9/10/11? Spring Boot 2/3/4? |
| Dependency management | versi dikontrol oleh BOM siapa? |
| Packaging | JAR, bootJar, WAR, EAR, provider JAR, image? |
| Runtime ownership | runtime dibundel aplikasi atau disediakan container? |
| Annotation processing | Lombok, MapStruct, JPA metamodel, QueryDSL? |
| Code generation | OpenAPI, JAXB, WSDL, Protobuf, jOOQ? |
| Migration | Flyway/Liquibase dijalankan kapan? |
| Test runtime | embedded, containerized, external server, Testcontainers? |
| Security | dependency scan, SBOM, signing, secret boundary? |
| Reproducibility | generated code deterministic atau tidak? |
| CI/CD | build once, promote same artifact? |
| Deployment | artifact metadata sesuai target platform? |

Top 1% engineer tidak hanya bertanya:

```text
Command build-nya apa?
```

Tetapi:

```text
Apa kontrak artifact ini terhadap runtime, dependency graph, deployment platform, dan release governance?
```

---

## 3. Spring Boot build integration mental model

Spring Boot plugin, baik di Maven maupun Gradle, melakukan lebih dari sekadar compile.

Ia biasanya mengatur:

- executable archive;
- dependency layering;
- build image;
- main class detection;
- devtools exclusion;
- dependency management integration;
- native image support;
- repackaging lifecycle;
- launch script;
- AOT/native support untuk versi modern.

Spring Boot Gradle plugin dapat membuat executable jar/war yang berisi dependency aplikasi dan bisa dijalankan dengan `java -jar`. Spring Boot Maven plugin juga memiliki goal seperti `repackage` dan `build-image` untuk mengubah archive biasa menjadi executable archive atau OCI image.

### 3.1 Spring Boot Maven basic model

Contoh Maven Spring Boot application:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.5.0</version>
    <relativePath/>
  </parent>

  <groupId>com.example</groupId>
  <artifactId>order-service</artifactId>
  <version>1.0.0</version>

  <properties>
    <java.version>21</java.version>
  </properties>

  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>

    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-test</artifactId>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>
```

Kekuatan pendekatan ini:

- sederhana;
- dependency versions dikelola Spring Boot parent;
- plugin default sudah sensible;
- cocok untuk service independen.

Risiko:

- parent POM aplikasi dikendalikan Spring Boot, bukan corporate parent;
- sulit jika organisasi ingin satu parent POM sendiri;
- dependency version override bisa tidak sadar merusak alignment;
- upgrade Boot bisa membawa upgrade besar dependency ecosystem.

### 3.2 Spring Boot Maven tanpa parent

Di enterprise, sering lebih sehat memakai corporate parent sendiri dan import Boot BOM:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>com.company.platform</groupId>
    <artifactId>company-parent</artifactId>
    <version>2026.06.0</version>
  </parent>

  <artifactId>order-service</artifactId>

  <properties>
    <java.version>21</java.version>
    <spring-boot.version>3.5.0</spring-boot.version>
  </properties>

  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-dependencies</artifactId>
        <version>${spring-boot.version}</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>

  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
        <version>${spring-boot.version}</version>
        <executions>
          <execution>
            <goals>
              <goal>repackage</goal>
            </goals>
          </execution>
        </executions>
      </plugin>
    </plugins>
  </build>
</project>
```

Mental model:

```text
corporate parent = policy
Spring Boot BOM = dependency alignment
Spring Boot plugin = packaging behavior
```

Jangan mencampur tiga peran ini secara sembarangan.

### 3.3 Spring Boot Gradle model

Contoh Gradle Kotlin DSL:

```kotlin
plugins {
    java
    id("org.springframework.boot") version "3.5.0"
    id("io.spring.dependency-management") version "1.1.7"
}

group = "com.example"
version = "1.0.0"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    testImplementation("org.springframework.boot:spring-boot-starter-test")
}

tasks.test {
    useJUnitPlatform()
}
```

Gradle mental model:

```text
Spring Boot plugin contributes tasks:
- bootJar
- bootWar
- bootRun
- bootBuildImage
```

Java plugin contributes:

```text
jar
compileJava
processResources
test
```

Build engineer harus tahu artifact mana yang dipakai:

```text
jar      = plain library jar
bootJar  = executable Spring Boot jar
war      = plain war
bootWar  = executable/deployable Spring Boot war
```

Kesalahan umum:

```text
CI publish plain jar padahal deploy system mengharapkan bootJar.
```

Atau:

```text
Dockerfile COPY build/libs/app.jar, tapi actual artifact bernama app-plain.jar.
```

---

## 4. Spring Boot executable JAR vs plain JAR

### 4.1 Plain JAR

Plain JAR berisi:

```text
BOOT-INF tidak ada
application classes langsung di root package
manifest sederhana
biasanya dependency tidak ikut masuk
```

Cocok untuk:

- library;
- shared module;
- internal SDK;
- plugin dependency;
- test fixtures.

Tidak cocok sebagai runnable Spring Boot application kecuali classpath eksternal disediakan.

### 4.2 Boot executable JAR

Boot JAR biasanya berisi:

```text
BOOT-INF/classes/
BOOT-INF/lib/
org/springframework/boot/loader/...
META-INF/MANIFEST.MF
```

Cocok untuk:

- deploy `java -jar app.jar`;
- container image sederhana;
- service runtime ownership penuh.

Build implication:

- artifact lebih besar;
- dependency masuk archive;
- classloader behavior berbeda dari plain classpath;
- nested JAR harus didukung launcher;
- shading biasanya tidak perlu;
- reproducibility perlu diperhatikan.

### 4.3 Maven artifact conflict: plain vs repackaged

Spring Boot Maven plugin `repackage` bisa mengganti main artifact. Kadang perlu menjaga plain JAR dengan classifier:

```xml
<plugin>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-maven-plugin</artifactId>
  <configuration>
    <classifier>exec</classifier>
  </configuration>
</plugin>
```

Mental model:

```text
main artifact      = dependency-consumable artifact
classifier artifact = deployment artifact
```

Untuk application, main artifact executable sering oke. Untuk module yang juga dikonsumsi sebagai library, jangan jadikan Boot JAR sebagai dependency orang lain.

---

## 5. Spring Boot dependency management: starter bukan dependency biasa

Spring Boot starter adalah dependency aggregator.

Contoh:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-web</artifactId>
</dependency>
```

Ini membawa banyak dependency transitif, seperti:

- Spring Web MVC;
- embedded servlet container;
- Jackson;
- validation;
- logging;
- Spring core.

Mental model:

```text
starter = curated runtime opinion
```

Jangan perlakukan starter seperti library kecil.

### 5.1 Starter di application module

Baik:

```text
order-service uses spring-boot-starter-web
payment-service uses spring-boot-starter-data-jpa
```

### 5.2 Starter di shared library

Hati-hati:

```text
common-utils depends on spring-boot-starter-web
```

Ini buruk karena:

- shared library memaksa web runtime ke semua consumer;
- dependency graph melebar;
- test classpath menjadi noisy;
- library tidak lagi framework-neutral.

Lebih baik:

```text
common-web-support depends on specific Spring Web API if needed
common-core has no Boot starter
```

### 5.3 Boot BOM sebagai alignment boundary

Spring Boot BOM menjaga versi dependency yang umum dipakai. Tetapi enterprise tetap harus punya policy:

- kapan override dependency boleh dilakukan;
- siapa approve security override;
- bagaimana mengecek compatibility setelah override;
- apakah override disimpan di corporate BOM atau service POM.

Rule praktis:

```text
Security override jangka pendek boleh.
Permanent divergence dari Boot BOM harus punya alasan kuat.
```

---

## 6. Spring Boot WAR: executable vs deployable

Spring Boot juga bisa membuat WAR.

Ada dua model:

```text
1. Executable WAR
   Bisa java -jar app.war

2. Deployable WAR
   Dideploy ke external servlet container/application server
```

### 6.1 Maven Boot WAR

```xml
<packaging>war</packaging>

<dependencies>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
  </dependency>

  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-tomcat</artifactId>
    <scope>provided</scope>
  </dependency>
</dependencies>
```

`provided` berarti embedded Tomcat tidak dibundel ke WAR deployment target.

### 6.2 Gradle Boot WAR

```kotlin
plugins {
    java
    war
    id("org.springframework.boot") version "3.5.0"
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    providedRuntime("org.springframework.boot:spring-boot-starter-tomcat")
}
```

Mental model:

```text
providedRuntime = runtime owned by container, not artifact
```

### 6.3 Common failure

```text
ClassNotFoundException in external Tomcat
```

Kemungkinan:

- dependency yang dibutuhkan diberi `provided` padahal container tidak menyediakan;
- wrong servlet API version;
- Spring Boot version tidak kompatibel dengan container;
- Jakarta vs javax namespace mismatch.

```text
Duplicate class / weird runtime behavior
```

Kemungkinan:

- servlet container ikut dibundel padahal external server sudah punya;
- logging implementation double;
- container library conflict.

---

## 7. Jakarta EE build integration mental model

Jakarta EE build harus dimulai dari pertanyaan:

```text
Target runtime menyediakan API dan implementation apa?
```

Contoh target runtime:

- GlassFish;
- Payara;
- WildFly;
- Open Liberty;
- WebLogic;
- TomEE;
- embedded test container;
- internal certified runtime.

Jakarta EE API artifact seperti `jakarta.jakartaee-api` adalah API bundle. Pada deployment ke full Jakarta EE application server, dependency ini biasanya **provided**, karena server menyediakan implementation-nya.

### 7.1 Maven Jakarta EE WAR

```xml
<packaging>war</packaging>

<dependencies>
  <dependency>
    <groupId>jakarta.platform</groupId>
    <artifactId>jakarta.jakartaee-api</artifactId>
    <version>10.0.0</version>
    <scope>provided</scope>
  </dependency>
</dependencies>
```

Mental model:

```text
compile against API
run against server implementation
```

### 7.2 Gradle Jakarta EE WAR

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

repositories {
    mavenCentral()
}

dependencies {
    compileOnly("jakarta.platform:jakarta.jakartaee-api:10.0.0")
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.0")
}

tasks.test {
    useJUnitPlatform()
}
```

In Gradle:

```text
compileOnly ~= Maven provided for compile classpath only
providedRuntime exists via war plugin for runtime packaging behavior
```

### 7.3 Jakarta API version vs Java version

Jangan campur dua baseline:

```text
Java baseline: Java 8, 11, 17, 21, 25
Jakarta baseline: Jakarta EE 8, 9, 10, 11
```

Mereka berkaitan, tetapi tidak identik.

Contoh konseptual:

| Stack | Namespace | Typical Java implication |
|---|---|---|
| Java EE 8 / Jakarta EE 8 | `javax.*` | sering legacy Java 8/11 |
| Jakarta EE 9+ | `jakarta.*` | migration namespace besar |
| Jakarta EE 10+ | `jakarta.*` | modern app server baseline |
| Jakarta EE 11 | `jakarta.*` | semakin modern runtime baseline |

Risiko terbesar bukan hanya versi Java, tetapi namespace split:

```text
javax.persistence.Entity
vs
jakarta.persistence.Entity
```

Jika dependency graph mencampur keduanya, build bisa berhasil tetapi runtime gagal.

---

## 8. Provided scope: salah satu konsep paling penting di enterprise Java

`provided` berarti:

```text
Dibutuhkan untuk compile/test tertentu, tetapi tidak dibundel ke artifact final karena runtime menyediakan.
```

Contoh dependency yang sering `provided`:

- Servlet API;
- Jakarta EE API;
- application server APIs;
- container-provided logging bridge;
- Keycloak server SPI dalam provider extension;
- Lombok sebagai compile-only annotation tool;
- sometimes JPA API jika server menyediakan.

### 8.1 Kesalahan 1: API dibundel ke WAR

```text
WAR contains jakarta.servlet-api.jar
External server also provides servlet API
```

Potential result:

- duplicate class;
- classloader conflict;
- `ClassCastException`;
- subtle behavior difference;
- deployment warning/error.

### 8.2 Kesalahan 2: dependency diberi provided padahal runtime tidak menyediakan

```text
Application compiles
WAR deploys
Runtime ClassNotFoundException
```

Contoh:

```text
compileOnly("com.fasterxml.jackson.core:jackson-databind")
```

Jika server tidak menyediakan Jackson versi itu, runtime gagal.

### 8.3 Rule praktis

Gunakan pertanyaan ini:

```text
Siapa owner dependency saat runtime?

- application artifact?
- application server?
- platform image?
- sidecar?
- JDK?
```

Jika owner runtime adalah application server, gunakan provided/compileOnly.  
Jika owner runtime adalah aplikasi, bundel sebagai runtime dependency.  
Jika owner runtime adalah base image, dokumentasikan dan test smoke runtime.

---

## 9. WAR dan EAR packaging dalam build modern

### 9.1 WAR

WAR adalah packaging untuk web application.

Struktur konseptual:

```text
app.war
  WEB-INF/classes/
  WEB-INF/lib/
  WEB-INF/web.xml
  META-INF/
```

Build concern:

- classpath WEB-INF/lib;
- provided dependency tidak masuk WEB-INF/lib;
- resources masuk lokasi yang benar;
- descriptor optional tetapi masih relevan untuk beberapa target;
- server-specific descriptor mungkin dibutuhkan.

### 9.2 Maven WAR Plugin

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-war-plugin</artifactId>
  <version>3.4.0</version>
  <configuration>
    <failOnMissingWebXml>false</failOnMissingWebXml>
  </configuration>
</plugin>
```

### 9.3 Gradle WAR Plugin

```kotlin
plugins {
    war
}

// produces build/libs/app.war
```

### 9.4 EAR

EAR adalah packaging untuk enterprise application yang bisa berisi:

```text
application.ear
  module-a.war
  module-b.jar
  lib/shared.jar
  META-INF/application.xml
```

EAR masih muncul di enterprise legacy karena:

- centralized deployment unit;
- shared classloader dalam application server;
- EJB/JMS/resource adapter integration;
- vendor deployment model.

Tetapi EAR juga membawa risiko:

- classloader lebih rumit;
- module coupling tersembunyi;
- upgrade lebih berat;
- CI artifact lebih kompleks;
- troubleshooting lebih sulit.

Rule modern:

```text
Gunakan EAR hanya jika target runtime dan governance masih membutuhkan.
Jangan gunakan EAR hanya karena “enterprise”.
```

---

## 10. Jakarta/Spring hybrid: when worlds collide

Banyak sistem enterprise tidak murni.

Contoh:

```text
Spring Boot application memakai Jakarta Persistence
Spring Boot WAR deploy ke external app server
Jakarta EE module memanggil Spring library
Legacy javax module coexist dengan jakarta module
```

### 10.1 Spring Boot 3+ dan Jakarta namespace

Spring Boot 3 pindah ke Jakarta EE 9+ namespace. Implikasinya:

```text
javax.* dependencies harus dimigrasikan ke jakarta.*
```

Build harus mendeteksi:

- dependency masih membawa `javax.servlet`;
- generated code masih memakai `javax.xml.bind`;
- library lama masih compile terhadap `javax.persistence`;
- annotation processor menghasilkan javax classes.

### 10.2 Guardrail Maven

Gunakan Maven Enforcer banned dependencies:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-enforcer-plugin</artifactId>
  <version>3.5.0</version>
  <executions>
    <execution>
      <id>ban-legacy-javax</id>
      <goals>
        <goal>enforce</goal>
      </goals>
      <configuration>
        <rules>
          <bannedDependencies>
            <excludes>
              <exclude>javax.servlet:javax.servlet-api</exclude>
              <exclude>javax.persistence:javax.persistence-api</exclude>
            </excludes>
          </bannedDependencies>
        </rules>
      </configuration>
    </execution>
  </executions>
</plugin>
```

### 10.3 Guardrail Gradle

```kotlin
configurations.configureEach {
    resolutionStrategy.eachDependency {
        if (requested.group == "javax.servlet") {
            throw GradleException("Legacy javax.servlet dependency is not allowed in Jakarta baseline")
        }
    }
}
```

Lebih baik lagi, implementasikan sebagai convention plugin agar konsisten lintas project.

---

## 11. JPA/Hibernate build integration

JPA terlihat runtime-heavy, tetapi build integration-nya penting.

Build concern:

- JPA API version;
- Hibernate version alignment;
- annotation processing untuk static metamodel;
- enhancement/weaving;
- test database;
- schema migration;
- generated query DSL;
- bytecode enhancement;
- reflection/native image metadata.

### 11.1 Dependency model Spring Boot JPA

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-data-jpa</artifactId>
</dependency>
```

Ini membawa:

- Spring Data JPA;
- Hibernate;
- transaction integration;
- JPA API;
- JDBC integration pieces.

Dependency version sebaiknya aligned via Boot BOM.

### 11.2 Jakarta EE JPA model

Pada full Jakarta server:

```xml
<dependency>
  <groupId>jakarta.persistence</groupId>
  <artifactId>jakarta.persistence-api</artifactId>
  <version>3.1.0</version>
  <scope>provided</scope>
</dependency>
```

Tetapi jika menggunakan Hibernate sendiri di non-full server:

```xml
<dependency>
  <groupId>org.hibernate.orm</groupId>
  <artifactId>hibernate-core</artifactId>
  <version>...</version>
</dependency>
```

Pertanyaan penting:

```text
Apakah persistence provider disediakan server atau aplikasi?
```

### 11.3 JPA static metamodel

Static metamodel membantu type-safe Criteria API.

Build concern:

```text
annotation processor generates classes during compile
```

Maven contoh:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <version>3.13.0</version>
  <configuration>
    <release>21</release>
    <annotationProcessorPaths>
      <path>
        <groupId>org.hibernate.orm</groupId>
        <artifactId>hibernate-jpamodelgen</artifactId>
        <version>${hibernate.version}</version>
      </path>
    </annotationProcessorPaths>
  </configuration>
</plugin>
```

Gradle contoh:

```kotlin
dependencies {
    annotationProcessor("org.hibernate.orm:hibernate-jpamodelgen:6.6.0.Final")
    compileOnly("jakarta.persistence:jakarta.persistence-api:3.1.0")
}
```

Failure modes:

- generated metamodel tidak muncul;
- stale generated source;
- processor memakai namespace javax saat project jakarta;
- incremental compile terganggu;
- CI berbeda dengan local karena annotation processor tidak dipin.

### 11.4 Hibernate bytecode enhancement

Hibernate bisa melakukan bytecode enhancement untuk fitur seperti lazy loading enhancement, dirty tracking, association management.

Build decision:

```text
enhance at build time or runtime?
```

Build-time enhancement lebih predictable tetapi menambah step build.

Governance rule:

```text
Jika enhancement wajib untuk correctness/performance, jadikan task eksplisit dan test artifact hasil enhancement.
```

---

## 12. Database migration integration: Flyway dan Liquibase

Database migration sering disalahletakkan dalam build.

Ada beberapa model:

```text
1. Migration validated during build
2. Migration packaged in artifact
3. Migration executed during deployment
4. Migration executed by application startup
5. Migration executed by separate pipeline/job
```

Top 1% engineer membedakan semua ini.

### 12.1 Build should usually validate, not mutate shared DB

Build CI sebaiknya tidak sembarangan mutate shared DB.

Baik:

```text
CI starts ephemeral DB
runs migration
runs integration test
tears down DB
```

Buruk:

```text
PR build applies migration to shared DEV database
```

### 12.2 Flyway Maven

```xml
<plugin>
  <groupId>org.flywaydb</groupId>
  <artifactId>flyway-maven-plugin</artifactId>
  <version>${flyway.version}</version>
  <configuration>
    <url>${db.url}</url>
    <user>${db.user}</user>
    <password>${db.password}</password>
  </configuration>
</plugin>
```

Jangan hardcode password di POM.

### 12.3 Flyway Gradle

```kotlin
plugins {
    id("org.flywaydb.flyway") version "10.0.0"
}

flyway {
    url = providers.environmentVariable("DB_URL").orNull
    user = providers.environmentVariable("DB_USER").orNull
    password = providers.environmentVariable("DB_PASSWORD").orNull
}
```

### 12.4 Liquibase mental model

Liquibase membawa changelog model:

```text
changelog file -> changeset -> checksum -> databasechangelog table
```

Build integration concern:

- validate changelog;
- generate SQL preview;
- package changelog;
- run against ephemeral DB;
- avoid direct mutation of shared environments in normal build.

### 12.5 Migration compatibility rule

Untuk enterprise release:

```text
Database migration must be backward-compatible across rolling deployment window.
```

Build can enforce:

- naming convention;
- SQL lint;
- changelog validation;
- destructive migration detection;
- migration dry-run;
- rollback script check.

---

## 13. OpenAPI build integration

OpenAPI generator sering menjadi sumber build complexity.

Ada dua arah:

```text
1. Server stub generation
2. Client SDK generation
```

Pertanyaan utama:

```text
Apakah generated code disimpan di repository atau dihasilkan saat build?
```

### 13.1 Generate-on-build

Kelebihan:

- source of truth spec;
- generated code selalu konsisten;
- tidak ada noise diff besar.

Kekurangan:

- build lebih lambat;
- generator version harus dipin;
- hasil generator bisa berubah karena versi/config;
- IDE setup lebih rumit.

### 13.2 Commit generated code

Kelebihan:

- IDE mudah;
- build tidak butuh generator;
- diff API client terlihat.

Kekurangan:

- risk stale generated code;
- huge diff noise;
- manual edit generated code;
- sulit enforce determinism.

### 13.3 Maven OpenAPI Generator

```xml
<plugin>
  <groupId>org.openapitools</groupId>
  <artifactId>openapi-generator-maven-plugin</artifactId>
  <version>${openapi-generator.version}</version>
  <executions>
    <execution>
      <id>generate-api-client</id>
      <phase>generate-sources</phase>
      <goals>
        <goal>generate</goal>
      </goals>
      <configuration>
        <inputSpec>${project.basedir}/src/main/openapi/payment.yaml</inputSpec>
        <generatorName>java</generatorName>
        <library>webclient</library>
        <output>${project.build.directory}/generated-sources/openapi</output>
        <apiPackage>com.example.payment.client.api</apiPackage>
        <modelPackage>com.example.payment.client.model</modelPackage>
      </configuration>
    </execution>
  </executions>
</plugin>
```

### 13.4 Gradle OpenAPI Generator

```kotlin
plugins {
    id("org.openapi.generator") version "7.8.0"
}

openApiGenerate {
    generatorName.set("java")
    library.set("webclient")
    inputSpec.set("$rootDir/specs/payment.yaml")
    outputDir.set("$buildDir/generated/openapi")
    apiPackage.set("com.example.payment.client.api")
    modelPackage.set("com.example.payment.client.model")
}

sourceSets {
    main {
        java.srcDir("$buildDir/generated/openapi/src/main/java")
    }
}

tasks.compileJava {
    dependsOn(tasks.openApiGenerate)
}
```

### 13.5 OpenAPI deterministic build checklist

- pin generator version;
- pin template version;
- avoid timestamp banner;
- avoid generator metadata changing per machine;
- normalize line endings;
- validate spec before generation;
- separate generated module if large;
- ensure generated source directory is cleaned;
- do not manually edit generated code;
- expose generated client behind stable internal interface.

---

## 14. SOAP, JAXB, and JAX-WS code generation

Enterprise Java sering masih punya SOAP/WSDL/XSD.

Build concern:

- JDK 8 included some Java EE tools historically;
- modern JDK no longer bundles many Java EE/Jakarta EE APIs/tools;
- generated code namespace may be `javax.*` or `jakarta.*`;
- WSDL/XSD source must be versioned;
- generated code must be deterministic.

### 14.1 JAXB mental model

Jakarta XML Binding maps XML documents to Java objects. Build often generates Java classes from XSD:

```text
XSD -> xjc -> Java classes
```

Questions:

- Which JAXB version?
- javax or jakarta package?
- Are generated classes committed?
- Does runtime include JAXB implementation?
- Is schema versioned with API contract?

### 14.2 Maven JAXB generation

```xml
<plugin>
  <groupId>org.codehaus.mojo</groupId>
  <artifactId>jaxb2-maven-plugin</artifactId>
  <version>${jaxb2.plugin.version}</version>
  <executions>
    <execution>
      <id>xjc</id>
      <goals>
        <goal>xjc</goal>
      </goals>
    </execution>
  </executions>
  <configuration>
    <sources>
      <source>src/main/xsd</source>
    </sources>
    <packageName>com.example.integration.schema</packageName>
  </configuration>
</plugin>
```

### 14.3 Gradle JAXB generation pattern

Gradle often uses custom tasks or community plugins.

Conceptual pattern:

```kotlin
val generatedJaxbDir = layout.buildDirectory.dir("generated/sources/jaxb")

// Register generator task using JavaExec or plugin
// Add generatedJaxbDir to sourceSets.main.java
// compileJava dependsOn generateJaxb
```

For enterprise governance, wrap this in convention plugin.

### 14.4 SOAP client generation

WSDL generation pattern:

```text
WSDL -> wsimport / CXF plugin -> Java client stubs
```

Failure modes:

- generated code uses javax while app uses jakarta;
- WSDL imports remote URL during build;
- remote schema changes break build;
- generator version differs local vs CI;
- generated classes duplicate across modules;
- XML binding runtime missing in Java 11+ runtime.

Rule:

```text
Do not depend on mutable remote WSDL/XSD during reproducible builds.
Vendor or mirror the contract artifact.
```

---

## 15. jOOQ build integration

jOOQ generation turns database schema into Java DSL.

Build concern:

```text
Database schema becomes source input to code generation.
```

This creates a question:

```text
Which schema is the source of truth?

- live dev database?
- migration scripts?
- generated DDL?
- schema snapshot?
```

### 15.1 Bad pattern

```text
Build connects to shared DEV database to generate jOOQ classes.
```

Why bad:

- non-reproducible;
- build depends on network/database state;
- schema drift affects unrelated builds;
- PR build may produce different code than release build.

### 15.2 Better pattern

```text
Migration scripts -> ephemeral DB -> jOOQ generation -> compile -> tests
```

This ensures:

- schema generated from versioned migration;
- codegen deterministic;
- tests use same schema;
- CI can reproduce.

### 15.3 Multi-module pattern

```text
:db-migration
:db-codegen-jooq
:domain
:repository-jooq
:application
```

Dependency direction:

```text
repository-jooq -> db-codegen-jooq
application -> repository-jooq
```

Do not let domain depend on jOOQ generated DSL unless domain is intentionally persistence-coupled.

---

## 16. QueryDSL build integration

QueryDSL generates Q-classes from annotated entities.

Build concern:

- annotation processor path;
- generated source directory;
- javax/jakarta classifier/version;
- incremental compile;
- IDE recognition;
- test source generation.

Maven conceptual config:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <configuration>
    <annotationProcessorPaths>
      <path>
        <groupId>com.querydsl</groupId>
        <artifactId>querydsl-apt</artifactId>
        <version>${querydsl.version}</version>
        <classifier>jakarta</classifier>
      </path>
    </annotationProcessorPaths>
  </configuration>
</plugin>
```

Gradle conceptual config:

```kotlin
dependencies {
    annotationProcessor("com.querydsl:querydsl-apt:${querydslVersion}:jakarta")
    annotationProcessor("jakarta.persistence:jakarta.persistence-api:3.1.0")
}
```

Failure mode:

```text
Q classes not generated
```

Checklist:

- annotation processor dependency present?
- correct classifier `jakarta` vs default?
- entities visible in source set?
- generated sources recognized by IDE?
- clean build works?

---

## 17. MapStruct and Lombok integration

MapStruct and Lombok are very common in enterprise projects.

### 17.1 Lombok

Lombok modifies compile-time AST.

Build implication:

- should be `compileOnly`/`provided`, not runtime;
- annotation processor must be configured;
- IDE plugin required for developer experience;
- Java version compatibility matters;
- Lombok can break on new JDK internals.

Gradle:

```kotlin
dependencies {
    compileOnly("org.projectlombok:lombok:1.18.36")
    annotationProcessor("org.projectlombok:lombok:1.18.36")

    testCompileOnly("org.projectlombok:lombok:1.18.36")
    testAnnotationProcessor("org.projectlombok:lombok:1.18.36")
}
```

Maven:

```xml
<dependency>
  <groupId>org.projectlombok</groupId>
  <artifactId>lombok</artifactId>
  <version>${lombok.version}</version>
  <scope>provided</scope>
</dependency>
```

### 17.2 MapStruct

MapStruct generates mapper implementation classes.

Gradle:

```kotlin
dependencies {
    implementation("org.mapstruct:mapstruct:1.6.3")
    annotationProcessor("org.mapstruct:mapstruct-processor:1.6.3")
}
```

Maven:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <configuration>
    <annotationProcessorPaths>
      <path>
        <groupId>org.mapstruct</groupId>
        <artifactId>mapstruct-processor</artifactId>
        <version>${mapstruct.version}</version>
      </path>
    </annotationProcessorPaths>
  </configuration>
</plugin>
```

### 17.3 Lombok + MapStruct ordering

Lombok and MapStruct can interact because MapStruct needs to see Lombok-generated methods.

In some setups, use binding support:

```text
lombok-mapstruct-binding
```

Mental model:

```text
Annotation processors are part of compiler pipeline.
Their compatibility and order affect generated code.
```

---

## 18. Keycloak SPI build integration

Keycloak SPI/provider packaging is a very practical enterprise build case.

A custom Keycloak provider might implement:

- IdentityProvider;
- Authenticator;
- RequiredActionProvider;
- EventListenerProvider;
- UserStorageProvider;
- ProtocolMapper;
- RealmResourceProvider;
- custom theme/resource provider.

Keycloak provider discovery uses service provider metadata under `META-INF/services`. Provider JAR is copied into Keycloak `providers/`, and for modern Keycloak distribution the server should be built/optimized after adding providers.

### 18.1 Keycloak provider artifact model

```text
custom-provider.jar
  com/company/keycloak/...
  META-INF/services/org.keycloak.authentication.AuthenticatorFactory
  META-INF/services/...
```

Build concerns:

- Keycloak version alignment;
- SPI dependencies usually provided by Keycloak server;
- provider dependencies may need bundling/copying;
- avoid bundling duplicate Keycloak server libraries;
- Java version must match Keycloak runtime;
- Quarkus augmentation/build step matters;
- provider JAR must be tested in real Keycloak container.

### 18.2 Maven Keycloak provider pattern

```xml
<dependencies>
  <dependency>
    <groupId>org.keycloak</groupId>
    <artifactId>keycloak-server-spi</artifactId>
    <version>${keycloak.version}</version>
    <scope>provided</scope>
  </dependency>
  <dependency>
    <groupId>org.keycloak</groupId>
    <artifactId>keycloak-server-spi-private</artifactId>
    <version>${keycloak.version}</version>
    <scope>provided</scope>
  </dependency>
  <dependency>
    <groupId>org.keycloak</groupId>
    <artifactId>keycloak-services</artifactId>
    <version>${keycloak.version}</version>
    <scope>provided</scope>
  </dependency>
</dependencies>
```

Why `provided`?

```text
Keycloak runtime owns Keycloak classes.
Provider JAR should not bring its own conflicting Keycloak copy.
```

### 18.3 Service loader file

Example:

```text
src/main/resources/META-INF/services/org.keycloak.authentication.AuthenticatorFactory
```

Content:

```text
com.company.keycloak.auth.CustomAuthenticatorFactory
```

Build must package this resource correctly.

### 18.4 Provider dependency strategy

If provider needs a third-party library not already in Keycloak:

Options:

```text
1. Copy dependency JARs into providers/ as separate files
2. Shade/relocate dependency into provider JAR
3. Avoid dependency by using JDK/Keycloak existing APIs
```

Trade-off:

| Strategy | Pros | Cons |
|---|---|---|
| Separate dependency JAR | transparent | version conflicts possible |
| Shade relocate | avoids conflict | harder debugging, larger artifact |
| Avoid dependency | simple runtime | may require more code |

Rule:

```text
Never casually shade Keycloak classes.
Only shade isolated third-party libs when conflict risk is understood.
```

### 18.5 Keycloak provider CI test

Good CI should include:

```text
mvn verify
copy provider jar to Keycloak providers/
run kc build
start Keycloak container
execute smoke test against provider behavior
```

This catches:

- missing service file;
- wrong Keycloak SPI version;
- classloading conflict;
- missing third-party dependency;
- Java class file version mismatch;
- Quarkus augmentation failure.

---

## 19. Container image integration: Jib, Buildpacks, Dockerfile

Enterprise Java build often produces container image.

Three common models:

```text
1. Dockerfile
2. Jib
3. Cloud Native Buildpacks / Spring Boot build-image
```

### 19.1 Dockerfile model

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY target/app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Pros:

- explicit;
- universal;
- easy to reason.

Cons:

- Docker daemon usually required;
- layering must be manually optimized;
- reproducibility depends on base image tag discipline;
- easy to leak files accidentally.

### 19.2 Jib model

Jib builds container images for Java applications without needing Dockerfile in many flows.

Maven conceptual:

```xml
<plugin>
  <groupId>com.google.cloud.tools</groupId>
  <artifactId>jib-maven-plugin</artifactId>
  <version>${jib.version}</version>
  <configuration>
    <from>
      <image>eclipse-temurin:21-jre</image>
    </from>
    <to>
      <image>registry.example.com/order-service:${project.version}</image>
    </to>
  </configuration>
</plugin>
```

Gradle conceptual:

```kotlin
plugins {
    id("com.google.cloud.tools.jib") version "3.4.4"
}

jib {
    from {
        image = "eclipse-temurin:21-jre"
    }
    to {
        image = "registry.example.com/order-service:$version"
    }
}
```

### 19.3 Buildpacks / Spring Boot build-image

Spring Boot plugin can build OCI images using Cloud Native Buildpacks.

Maven:

```bash
mvn spring-boot:build-image
```

Gradle:

```bash
./gradlew bootBuildImage
```

Pros:

- standard buildpack lifecycle;
- good defaults;
- layered image;
- non-root runtime defaults in many buildpack flows;
- native image integration paths.

Cons:

- builder image behavior must be governed;
- less explicit than Dockerfile;
- enterprise proxy/cert setup can be harder;
- reproducibility depends on builder/run image pinning.

### 19.4 Container image reproducibility rules

- pin base image by digest for release;
- do not rely on mutable `latest`;
- separate build image and runtime image;
- include SBOM if possible;
- scan image after build;
- publish image digest, not only tag;
- map app version to image label;
- keep same artifact across environments.

---

## 20. Native image and AOT integration

GraalVM native image and Spring AOT introduce additional build complexity.

Build concerns:

- reflection metadata;
- resource configuration;
- dynamic proxy configuration;
- JNI configuration;
- class initialization timing;
- native test;
- different behavior from JVM runtime;
- longer build time;
- OS/architecture-specific artifact.

### 20.1 Spring Boot native build mental model

```text
Java source
  -> compile
  -> AOT processing
  -> generated hints/sources
  -> native-image compile
  -> native executable/container image
```

This is not just packaging. It is a different compilation target.

### 20.2 Maven native profile pattern

Spring Boot parent commonly provides a native profile in supported setups. Custom enterprise parent can model:

```xml
<profiles>
  <profile>
    <id>native</id>
    <build>
      <plugins>
        <plugin>
          <groupId>org.graalvm.buildtools</groupId>
          <artifactId>native-maven-plugin</artifactId>
        </plugin>
      </plugins>
    </build>
  </profile>
</profiles>
```

### 20.3 Gradle native pattern

```kotlin
plugins {
    id("org.graalvm.buildtools.native") version "0.10.3"
}
```

### 20.4 Native image policy

Do not introduce native image just because it is trendy.

Use if:

- startup time matters;
- memory footprint matters;
- serverless/function deployment needs it;
- operational trade-off is accepted.

Avoid if:

- reflection-heavy legacy system;
- dynamic plugin architecture;
- frequent native build failures slow CI;
- team lacks native debugging capability.

---

## 21. Application server integration testing

Enterprise build should test against the real runtime contract when feasible.

### 21.1 Spring Boot tests

Common levels:

```text
unit test
slice test
@SpringBootTest
web environment random port
testcontainers-backed integration test
packaged artifact smoke test
```

Important distinction:

```text
@SpringBootTest from classes != java -jar packaged artifact
```

A mature pipeline includes artifact smoke test:

```bash
java -jar target/app.jar
curl /actuator/health
```

### 21.2 Jakarta EE tests

Options:

- Arquillian;
- Cargo plugin;
- Testcontainers with application server image;
- vendor CLI deploy in CI;
- smoke tests after deployment to ephemeral environment.

Mental model:

```text
If runtime behavior depends on application server, unit test is insufficient.
```

### 21.3 WAR deployment smoke test

Pipeline:

```text
mvn package
start app server container
copy/deploy WAR
wait for server ready
hit health endpoint
run minimal integration test
collect server logs
stop container
```

This catches:

- missing provided dependency;
- deployment descriptor issue;
- classloader conflict;
- wrong Jakarta namespace;
- server module conflict;
- resource lookup issue.

---

## 22. Configuration and secrets in enterprise framework builds

Frameworks often encourage configuration files:

- `application.properties`;
- `application.yml`;
- `persistence.xml`;
- `web.xml`;
- `beans.xml`;
- `keycloak.conf`;
- `liquibase.properties`;
- `flyway.conf`.

Build must separate:

```text
build-time config
runtime config
deployment config
secret config
```

### 22.1 Bad pattern

```text
src/main/resources/application-prod.yml contains production DB password
```

### 22.2 Better pattern

```text
Artifact contains non-secret defaults.
Runtime injects environment-specific values.
Secrets come from secret manager / Kubernetes secret / vault.
```

### 22.3 Build filtering warning

Do not overuse resource filtering for runtime config.

Resource filtering is okay for:

- build metadata;
- version info;
- non-secret static constants;
- generated manifest entries.

Dangerous for:

- secrets;
- environment-specific endpoints;
- mutable runtime config;
- binary resources.

---

## 23. Enterprise BOM/platform integration strategy

A large organization should not let each service independently decide every framework version.

Recommended layers:

```text
company-parent / convention plugin
  -> Java baseline policy
  -> compiler/test/plugin versions
  -> repository policy
  -> security gates

company-bom / Gradle platform
  -> approved dependency versions
  -> Spring Boot version
  -> Jakarta API version
  -> Hibernate/Jackson/Netty alignment

service build
  -> declares actual dependencies needed
  -> does not define random versions
```

### 23.1 Maven layering

```xml
<parent>
  <groupId>com.company.platform</groupId>
  <artifactId>company-parent</artifactId>
  <version>2026.06.0</version>
</parent>

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
```

### 23.2 Gradle layering

```kotlin
plugins {
    id("com.company.java-application") version "2026.06.0"
}

dependencies {
    implementation(platform("com.company.platform:company-platform:2026.06.0"))
    implementation("org.springframework.boot:spring-boot-starter-web")
}
```

### 23.3 Avoid dependency governance ambiguity

Bad:

```text
Spring Boot BOM imports Jackson 2.x
Company BOM imports different Jackson version
Service overrides another Jackson module manually
Security patch overrides only jackson-databind
```

Better:

```text
Company platform owns final Jackson alignment.
Security override updates all related Jackson modules consistently.
Service cannot override without waiver.
```

---

## 24. Java 8–25 compatibility in framework integration

Framework integration is constrained by Java versions.

### 24.1 Java 8 legacy

Common characteristics:

- older Spring Boot 2.x line;
- Java EE/Jakarta EE 8 style `javax.*`;
- older plugin compatibility;
- limited modern Gradle/Maven plugin support;
- JAXB included historically in JDK 8 but not modern JDKs;
- weaker module support.

Build strategy:

- pin older compatible plugin versions;
- compile with `--release 8` where possible;
- test on actual Java 8 runtime;
- avoid accidentally introducing Java 11+ bytecode dependency;
- dependency graph bytecode scan.

### 24.2 Java 11/17 transition

Common issues:

- JAXB/JAX-WS no longer in JDK;
- module system warnings;
- illegal reflective access;
- Spring/Jakarta upgrade pressure;
- Docker base image changes;
- TLS/security provider differences.

### 24.3 Java 21/25 modern baseline

Benefits:

- modern language/runtime;
- better GC/runtime capabilities;
- current framework support;
- newer build tool support;
- easier alignment with modern Spring Boot/Jakarta.

Risks:

- older annotation processors fail;
- old Maven/Gradle plugin cannot run;
- Lombok/ByteBuddy/ASM need current versions;
- old app server may not support runtime;
- generated bytecode too new for older environment.

### 24.4 Compatibility matrix example

| Artifact | Compile JDK | `--release` | Test JDKs | Runtime target |
|---|---:|---:|---|---|
| legacy SDK | 17 | 8 | 8, 11, 17 | Java 8+ consumers |
| modern Spring Boot service | 21 | 21 | 21, 25 | container JRE 21 |
| Jakarta WAR | 17 | 17 | 17 | app server Java 17 |
| Keycloak provider | 21 | 21 | 21 | matching Keycloak runtime |
| codegen module | 21 | 17 | 17, 21 | generated code consumer baseline |

Principle:

```text
Compile runtime of build tool can be newer than target bytecode,
but generated artifact must match consumer runtime.
```

---

## 25. Multi-module enterprise blueprint

Example large Java system:

```text
enterprise-platform/
  settings.gradle.kts or pom.xml

  platform-bom/
  build-conventions/

  domain-core/
  application-service/
  adapter-rest-spring/
  adapter-persistence-jpa/
  adapter-messaging/
  db-migration/
  api-openapi-spec/
  api-openapi-client/
  keycloak-provider/
  webapp-war/
  boot-app/
  integration-tests/
```

### 25.1 Boundary model

```text
domain-core
  no Spring Boot starter
  no Jakarta server API unless domain intentionally uses annotations

application-service
  orchestrates use cases
  depends on domain

adapter-rest-spring
  owns Spring MVC/WebFlux details

adapter-persistence-jpa
  owns JPA/Hibernate details

boot-app
  composes runtime
  owns bootJar/container image

webapp-war
  composes WAR deployment

keycloak-provider
  separate artifact, provided Keycloak SPI

integration-tests
  starts packaged runtime and verifies contract
```

### 25.2 Build advantage

This structure allows:

- faster incremental build;
- clearer dependency graph;
- separate artifact type per runtime;
- different Java baseline if necessary;
- clear ownership;
- easier migration from legacy to modern.

---

## 26. Failure taxonomy for Jakarta/Spring build integration

### 26.1 Compile-time failure

Symptoms:

```text
package jakarta.servlet does not exist
cannot find symbol QEntity
NoSuchMethodError during annotation processing
```

Likely causes:

- missing API dependency;
- wrong javax/jakarta namespace;
- annotation processor not configured;
- Java release mismatch;
- generated source not added.

### 26.2 Test-time failure

Symptoms:

```text
ApplicationContext failed to start
NoSuchBeanDefinitionException
Testcontainers cannot start
Flyway migration failed
```

Likely causes:

- test runtime classpath differs from application runtime;
- missing test profile;
- migration order issue;
- dependency conflict;
- container resource issue.

### 26.3 Package-time failure

Symptoms:

```text
repackage failed
duplicate entry
invalid WAR structure
native image failed
```

Likely causes:

- plugin misconfiguration;
- duplicate resources;
- broken manifest;
- incompatible dependency;
- unsupported reflection/native behavior.

### 26.4 Deployment-time failure

Symptoms:

```text
ClassNotFoundException
NoClassDefFoundError
ClassCastException
DeploymentException
Keycloak provider not found
```

Likely causes:

- provided scope wrong;
- classloader conflict;
- missing service provider file;
- wrong server version;
- Java bytecode too new;
- dependency not copied to runtime.

### 26.5 Runtime behavior failure

Symptoms:

```text
Endpoint exists locally but not in server
JPA entity not found
JSON serialization differs
SOAP client fails in prod
```

Likely causes:

- different runtime container;
- dependency version mismatch;
- reflection/resource missing;
- environment config drift;
- generated code mismatch.

---

## 27. Debugging workflow

When Jakarta/Spring build integration fails, do not randomly edit POM/Gradle.

Use this workflow:

### Step 1: Identify failure phase

```text
compile?
test?
package?
publish?
deploy?
runtime?
```

### Step 2: Identify artifact type

```text
plain JAR?
bootJar?
WAR?
EAR?
provider JAR?
container image?
native executable?
```

### Step 3: Identify runtime owner

```text
application owns runtime?
application server owns runtime?
Keycloak owns runtime?
container image owns runtime?
```

### Step 4: Inspect dependency graph

Maven:

```bash
mvn dependency:tree
mvn dependency:tree -Dincludes=jakarta.*
mvn dependency:tree -Dincludes=javax.*
mvn help:effective-pom
```

Gradle:

```bash
./gradlew dependencies --configuration runtimeClasspath
./gradlew dependencyInsight --dependency jakarta.servlet --configuration runtimeClasspath
./gradlew dependencyInsight --dependency javax.servlet --configuration runtimeClasspath
```

### Step 5: Inspect artifact content

```bash
jar tf target/app.war | sort | less
jar tf target/app.jar | grep BOOT-INF/lib
jar tf keycloak-provider.jar | grep META-INF/services
```

### Step 6: Run same artifact locally

```bash
java -jar target/app.jar
```

For WAR:

```text
Deploy actual WAR to same server family/version.
```

For Keycloak provider:

```text
Copy provider to providers/, run kc build, start server, smoke test.
```

### Step 7: Verify Java version

```bash
java -version
javap -verbose SomeClass.class | grep "major version"
```

### Step 8: Make fix at correct layer

Do not fix dependency conflict by adding random direct dependency to application if the correct fix is BOM/platform alignment.

---

## 28. Maven blueprint: enterprise Spring Boot + Jakarta-aware build

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>com.company.platform</groupId>
    <artifactId>company-parent</artifactId>
    <version>2026.06.0</version>
  </parent>

  <artifactId>case-service</artifactId>
  <version>${revision}</version>

  <properties>
    <revision>1.0.0-SNAPSHOT</revision>
    <java.version>21</java.version>
    <spring-boot.version>3.5.0</spring-boot.version>
  </properties>

  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-dependencies</artifactId>
        <version>${spring-boot.version}</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>

  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>

    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-validation</artifactId>
    </dependency>

    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-test</artifactId>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <configuration>
          <release>${java.version}</release>
        </configuration>
      </plugin>

      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
        <version>${spring-boot.version}</version>
        <executions>
          <execution>
            <goals>
              <goal>repackage</goal>
            </goals>
          </execution>
        </executions>
      </plugin>

      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-enforcer-plugin</artifactId>
        <executions>
          <execution>
            <id>enforce-build-policy</id>
            <goals>
              <goal>enforce</goal>
            </goals>
          </execution>
        </executions>
      </plugin>
    </plugins>
  </build>
</project>
```

---

## 29. Gradle blueprint: enterprise Spring Boot convention

In service build:

```kotlin
plugins {
    id("com.company.spring-boot-service") version "2026.06.0"
}

group = "com.company.case"
version = "1.0.0-SNAPSHOT"

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    testImplementation("org.springframework.boot:spring-boot-starter-test")
}
```

In convention plugin:

```kotlin
class CompanySpringBootServicePlugin : Plugin<Project> {
    override fun apply(project: Project) = with(project) {
        pluginManager.apply("java")
        pluginManager.apply("org.springframework.boot")

        extensions.configure<JavaPluginExtension> {
            toolchain {
                languageVersion.set(JavaLanguageVersion.of(21))
            }
        }

        tasks.withType<Test>().configureEach {
            useJUnitPlatform()
        }

        configurations.configureEach {
            resolutionStrategy.eachDependency {
                if (requested.group == "javax.servlet") {
                    throw GradleException("javax.servlet is banned in Jakarta/Spring Boot 3 baseline")
                }
            }
        }
    }
}
```

Mental model:

```text
Service build declares business dependencies.
Convention plugin enforces platform behavior.
```

---

## 30. Anti-pattern catalog

### Anti-pattern 1: Starter in common library

```text
common-utils -> spring-boot-starter-web
```

Problem:

- framework leakage;
- dependency graph explosion;
- difficult reuse.

Better:

```text
common-core no framework
common-spring-web explicit Spring API only if needed
```

### Anti-pattern 2: javax/jakarta mixed graph

Problem:

- compile may pass;
- runtime class mismatch;
- generated code conflict.

Better:

- enforce namespace baseline;
- scan dependency tree;
- align framework generation tooling.

### Anti-pattern 3: WAR bundles server API

Problem:

- duplicate container classes;
- classloader conflict.

Better:

- API dependencies as provided/compileOnly;
- smoke test in target server.

### Anti-pattern 4: Codegen from live remote system

Problem:

- non-reproducible;
- flaky CI;
- hidden contract drift.

Better:

- version contract files;
- generate from checked-in spec/schema;
- pin generator.

### Anti-pattern 5: Migration runs against shared DB in build

Problem:

- build mutates environment;
- PR builds interfere;
- failure difficult to rollback.

Better:

- ephemeral DB;
- validate/dry-run;
- deployment-owned migration.

### Anti-pattern 6: Keycloak provider bundles Keycloak itself

Problem:

- classloader conflict;
- provider fails after server upgrade.

Better:

- Keycloak SPI dependencies `provided`;
- copy only needed third-party deps;
- smoke test with real server.

### Anti-pattern 7: Docker image rebuilds from source differently from CI artifact

Problem:

- build once principle broken;
- artifact not traceable;
- release reproducibility weak.

Better:

- build artifact once;
- image packaging consumes same artifact;
- publish artifact digest and image digest.

---

## 31. Practical review checklist

Use this checklist when reviewing enterprise Java build integration.

### 31.1 Dependency and framework baseline

- [ ] Spring Boot version is explicit and governed.
- [ ] Jakarta EE version is explicit and governed.
- [ ] Java baseline is explicit.
- [ ] `javax.*` vs `jakarta.*` baseline is clear.
- [ ] Dependency versions are controlled by BOM/platform.
- [ ] No random version override without reason.

### 31.2 Packaging

- [ ] Application artifact type is clear: bootJar, WAR, EAR, provider JAR, image.
- [ ] CI publishes the correct artifact.
- [ ] Plain JAR is not confused with executable JAR.
- [ ] Provided dependencies are not accidentally bundled.
- [ ] Runtime-owned dependencies are documented.

### 31.3 Code generation

- [ ] OpenAPI/WSDL/XSD/schema source is versioned.
- [ ] Generator versions are pinned.
- [ ] Generated source output is deterministic.
- [ ] Generated source is not manually edited.
- [ ] Generated code namespace matches project baseline.

### 31.4 Annotation processing

- [ ] Annotation processors are configured explicitly.
- [ ] Lombok/MapStruct/JPA metamodel versions are compatible with Java version.
- [ ] Processor classpath is separate from runtime classpath.
- [ ] Clean CI build generates required classes.

### 31.5 Database migration

- [ ] Build does not mutate shared database by default.
- [ ] Migration validation runs in CI.
- [ ] Ephemeral DB integration test exists for critical schema.
- [ ] Destructive migrations are governed.
- [ ] Rollout compatibility is reviewed.

### 31.6 Runtime smoke test

- [ ] `java -jar` smoke test for Boot app.
- [ ] WAR deploy smoke test for app server target.
- [ ] Keycloak provider smoke test for provider artifact.
- [ ] Container image health check test.
- [ ] Java runtime version verified.

### 31.7 Security and reproducibility

- [ ] SBOM generated.
- [ ] Dependency scan runs.
- [ ] Build uses pinned plugin versions.
- [ ] Repository policy enforced.
- [ ] Secrets are not embedded in artifact.
- [ ] Release artifact is promoted, not rebuilt per environment.

---

## 32. How top 1% engineers think about this area

A surface-level engineer asks:

```text
What dependency do I add so it compiles?
```

A strong engineer asks:

```text
Who owns this dependency at runtime?
```

A senior engineer asks:

```text
What artifact contract am I creating, and how will it behave under CI, release, deployment, security scanning, and future framework upgrades?
```

A top 1% engineer asks:

```text
How do I design the build so the framework integration remains explicit, governed, reproducible, observable, and evolvable across multiple teams and Java versions?
```

That means:

- framework dependency must not leak across module boundaries;
- generated code must be deterministic;
- packaging must match runtime ownership;
- server/container assumptions must be tested;
- BOM/platform must align dependency families;
- Java baseline must be enforced;
- CI must test actual deployable artifacts;
- release must promote the same artifact;
- security scanning must include dependencies, plugin, image, and generated artifact.

---

## 33. Ringkasan inti

Jakarta/Spring enterprise build integration adalah tentang **runtime contract**.

Spring Boot usually says:

```text
Application owns runtime.
Package an executable artifact.
```

Jakarta EE often says:

```text
Application server owns runtime.
Package a deployable artifact.
```

Generated code says:

```text
External contract/schema becomes source input.
```

Database migration says:

```text
Schema evolution is part of release engineering.
```

Keycloak SPI says:

```text
Provider artifact must obey host runtime classloader and SPI discovery contract.
```

Container image says:

```text
Build output becomes operational unit.
```

The build engineer’s job is to make these contracts explicit.

---

## 34. Latihan eksplorasi

### Latihan 1 — Inspect artifact

Build Spring Boot app lalu inspect:

```bash
mvn package
jar tf target/*.jar | head -100
jar tf target/*.jar | grep BOOT-INF/lib | head
```

Pertanyaan:

- Apakah artifact executable?
- Dependency apa yang masuk?
- Apa beda dengan plain JAR?

### Latihan 2 — Jakarta provided dependency

Buat WAR dengan `jakarta.servlet-api` sebagai compile/runtime biasa, lalu bandingkan dengan `provided`.

Pertanyaan:

- Apakah JAR servlet API masuk `WEB-INF/lib`?
- Apa risikonya jika deploy ke external server?

### Latihan 3 — Detect javax/jakarta split

Jalankan:

```bash
mvn dependency:tree | grep javax
mvn dependency:tree | grep jakarta
```

atau:

```bash
./gradlew dependencies --configuration runtimeClasspath | grep javax
./gradlew dependencies --configuration runtimeClasspath | grep jakarta
```

Pertanyaan:

- Apakah project mencampur namespace?
- Apakah itu disengaja atau bug?

### Latihan 4 — Keycloak provider smoke test

Buat provider sederhana dan pastikan:

```text
META-INF/services exists
provider JAR copied to providers/
kc build succeeds
server starts
provider visible/usable
```

### Latihan 5 — Codegen determinism

Generate OpenAPI client dua kali dari clean checkout.

Pertanyaan:

- Apakah output identik?
- Ada timestamp/random path?
- Generator version dipin?

---

## 35. Penutup

Bagian ini menjembatani build engineering dengan realitas enterprise Java framework. Setelah ini, kita akan masuk ke area yang masih terkait tetapi lebih spesifik: **code generation pipelines**.

Bagian berikutnya:

```text
Part 24 — Code Generation Pipelines: OpenAPI, JAXB, Protobuf, gRPC, jOOQ, QueryDSL
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 22 — Multi-Module Architecture for Large Java Systems](./22-multi-module-architecture-large-java-systems.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 24 — Code Generation Pipelines: OpenAPI, JAXB, Protobuf, gRPC, jOOQ, QueryDSL](./24-code-generation-pipelines.md)
