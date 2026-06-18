# Part 12 — Packaging Engineering: JAR, Fat JAR, Thin JAR, WAR, EAR, Modular JAR, Native Image

Series: `learn-java-build-gradle-maven-engineering`  
File: `12-packaging-engineering.md`  
Scope: Java 8 sampai Java 25, Maven, Gradle, enterprise Java, Spring Boot, Jakarta EE, JPMS, container, native image

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas build dari sudut compiler dan testing. Sekarang kita masuk ke tahap yang sering terlihat sederhana tetapi sebenarnya sangat menentukan: **packaging**.

Banyak engineer menganggap packaging hanya sebagai tahap akhir untuk menghasilkan file `.jar`, `.war`, atau image. Cara berpikir seperti itu terlalu sempit. Packaging adalah proses mengubah hasil kompilasi, resource, metadata, dependency, dan konfigurasi build menjadi **runtime contract**.

Sebuah package menjawab pertanyaan besar:

> “Apa persisnya unit software yang akan dijalankan, dipublikasikan, dipindahkan, diverifikasi, di-scan, di-deploy, di-rollback, dan dipercaya?”

Karena itu packaging bukan hanya urusan `mvn package`, `gradle jar`, atau `bootJar`. Packaging adalah boundary antara:

- source code dan runtime;
- build system dan deployment system;
- developer machine dan production environment;
- dependency graph dan classloader;
- artifact repository dan runtime platform;
- release engineering dan incident response;
- application architecture dan operational behavior.

Top 1% engineer tidak hanya tahu cara membuat JAR. Mereka paham konsekuensi dari setiap format packaging: classpath, classloader, resource collision, reproducibility, startup time, patchability, scanability, container layering, supply-chain trust, dan rollback semantics.

---

## 1. Mental Model Utama: Package adalah Runtime Boundary

Source code masih berupa intent. Compile output sudah berupa bytecode. Tetapi package adalah unit yang mulai memiliki identitas operasional.

Secara konseptual:

```text
source code
  -> compile
     -> classes/resources
        -> test verification
           -> package
              -> artifact
                 -> publish
                    -> deploy
                       -> execute
```

Package bukan sekadar “folder yang di-zip”. Ia membawa beberapa kontrak:

| Kontrak | Pertanyaan |
|---|---|
| Identity contract | Artifact ini siapa? group, artifact, version, classifier, digest? |
| Runtime contract | Bagaimana artifact dijalankan? `java -jar`, app server, module path, native binary? |
| Dependency contract | Dependency dibundel, disediakan runtime, atau di-resolve eksternal? |
| Classloading contract | Class ditemukan dari mana dan dalam urutan apa? |
| Resource contract | Resource mana yang menang saat ada duplikasi? |
| Security contract | Artifact ini bisa diverifikasi? ditandatangani? punya SBOM? |
| Reproducibility contract | Build ulang menghasilkan artifact sama? |
| Deployment contract | Artifact ini immutable, layerable, rollbackable? |
| Observability contract | Metadata build/version tersedia saat runtime? |

Kesalahan packaging sering tidak muncul saat compile. Ia muncul saat runtime:

- `ClassNotFoundException`;
- `NoClassDefFoundError`;
- `NoSuchMethodError`;
- `ServiceConfigurationError`;
- duplicate logging binding;
- missing `Main-Class`;
- resource yang tertimpa;
- dependency yang tidak masuk WAR;
- dependency yang seharusnya `provided` tetapi ikut dibundel;
- native image gagal karena reflection metadata tidak lengkap;
- container image besar dan lambat karena layering buruk.

---

## 2. Taxonomy Artifact Java

Dalam ekosistem Java, format packaging utama bisa dikelompokkan seperti ini:

```text
Java package taxonomy

1. Library artifact
   - plain JAR
   - sources JAR
   - javadoc JAR
   - modular JAR
   - multi-release JAR

2. Application artifact
   - executable JAR
   - fat/uber/shaded JAR
   - thin JAR
   - layered JAR
   - WAR
   - EAR

3. Platform/runtime artifact
   - container image
   - native executable
   - custom runtime image dengan jlink
   - distribution ZIP/TAR

4. Metadata artifact
   - POM
   - Gradle Module Metadata
   - SBOM
   - signatures
   - checksums
   - build-info
```

Satu sistem enterprise sering memakai lebih dari satu jenis artifact. Contoh:

```text
shared-domain-lib.jar       -> library internal
case-service.jar            -> Spring Boot executable service
legacy-admin.war            -> deployed ke application server
keycloak-custom-spi.jar     -> plugin/provider artifact
openapi-client.jar          -> generated client library
platform-bom.pom            -> version alignment artifact
cyclonedx.json              -> SBOM
case-service-container      -> runtime image
```

Top 1% engineer melihat semua artifact ini sebagai satu supply chain, bukan file terpisah.

---

## 3. Plain JAR: Format Dasar tapi Bukan Format Sederhana

Plain JAR adalah ZIP archive berisi `.class`, resource, dan metadata `META-INF`. Ia bisa digunakan sebagai library atau executable sederhana.

Struktur umum:

```text
my-library.jar
├── META-INF/
│   ├── MANIFEST.MF
│   └── services/
│       └── com.example.spi.Plugin
└── com/
    └── example/
        ├── Customer.class
        └── CustomerService.class
```

Plain JAR biasanya tidak membundel dependency eksternal. Ia hanya berisi output module itu sendiri.

### 3.1 Library JAR vs Application JAR

Perbedaan besar:

| Aspek | Library JAR | Application JAR |
|---|---|---|
| Tujuan | Dipakai oleh project lain | Dijalankan sebagai program |
| Dependency | Dinyatakan sebagai metadata | Harus tersedia saat runtime |
| Main class | Biasanya tidak ada | Perlu entry point |
| Compatibility | API/binary compatibility penting | Operational compatibility penting |
| Publishing | Maven Central/private repo | artifact repo/container registry |

Library JAR yang baik harus kecil, jelas API-nya, tidak membawa dependency yang tidak perlu, dan tidak mengunci runtime policy consumer.

Application JAR harus bisa dijalankan secara predictable di environment target.

### 3.2 Maven Plain JAR

Maven default packaging untuk project Java biasanya `jar`.

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.example</groupId>
  <artifactId>billing-core</artifactId>
  <version>1.0.0</version>
  <packaging>jar</packaging>
</project>
```

Command:

```bash
mvn clean package
```

Output umum:

```text
target/billing-core-1.0.0.jar
```

Untuk manifest:

```xml
<build>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-jar-plugin</artifactId>
      <version>3.4.2</version>
      <configuration>
        <archive>
          <manifest>
            <addDefaultImplementationEntries>true</addDefaultImplementationEntries>
            <addDefaultSpecificationEntries>true</addDefaultSpecificationEntries>
          </manifest>
          <manifestEntries>
            <Build-Jdk-Spec>${java.version}</Build-Jdk-Spec>
          </manifestEntries>
        </archive>
      </configuration>
    </plugin>
  </plugins>
</build>
```

### 3.3 Gradle Plain JAR

Gradle Java plugin menyediakan task `jar`.

```kotlin
plugins {
    `java-library`
}

group = "com.example"
version = "1.0.0"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.jar {
    manifest {
        attributes(
            "Implementation-Title" to project.name,
            "Implementation-Version" to project.version
        )
    }
}
```

Command:

```bash
./gradlew clean jar
```

Output umum:

```text
build/libs/billing-core-1.0.0.jar
```

---

## 4. Manifest Engineering

`META-INF/MANIFEST.MF` tampak kecil, tetapi sering menjadi sumber masalah runtime.

Contoh manifest:

```text
Manifest-Version: 1.0
Implementation-Title: billing-service
Implementation-Version: 1.0.0
Main-Class: com.example.billing.Main
Build-Jdk-Spec: 21
```

### 4.1 Manifest untuk Executable JAR

Agar JAR bisa dijalankan dengan:

```bash
java -jar app.jar
```

manifest harus punya:

```text
Main-Class: com.example.Main
```

Tanpa itu:

```text
no main manifest attribute, in app.jar
```

### 4.2 Manifest Class-Path

JAR juga bisa menunjuk dependency eksternal melalui manifest `Class-Path`:

```text
Class-Path: lib/jackson-databind.jar lib/slf4j-api.jar
```

Ini sering dipakai pada thin distribution ZIP.

Kelemahannya:

- path relatif harus benar;
- dependency harus disalin ke layout yang tepat;
- sulit untuk container immutable jika tidak distandarkan;
- tidak cocok untuk semua deployment model;
- lebih mudah rusak dibanding executable/fat JAR.

### 4.3 Metadata Build di Manifest

Metadata yang sering berguna:

```text
Implementation-Version
Implementation-Commit
Build-Time
Build-Jdk-Spec
Created-By
```

Tetapi hati-hati: `Build-Time` yang memakai timestamp aktual dapat merusak reproducibility. Jika perlu metadata waktu, gunakan timestamp release yang stabil atau SCM commit time yang terkendali.

---

## 5. Executable JAR

Executable JAR adalah JAR yang dapat dijalankan langsung.

```bash
java -jar application.jar
```

Ada dua model besar:

1. **Simple executable JAR**: berisi class aplikasi, dependency disediakan terpisah via classpath/manifest.
2. **Self-contained executable JAR**: dependency dibundel, contohnya Spring Boot executable JAR.

### 5.1 Simple Executable JAR dengan Maven

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-jar-plugin</artifactId>
  <version>3.4.2</version>
  <configuration>
    <archive>
      <manifest>
        <mainClass>com.example.Main</mainClass>
      </manifest>
    </archive>
  </configuration>
</plugin>
```

Tetapi dependency tidak otomatis masuk ke JAR. Menjalankan aplikasi mungkin perlu:

```bash
java -cp "target/app.jar:target/lib/*" com.example.Main
```

### 5.2 Simple Executable JAR dengan Gradle

```kotlin
plugins {
    application
}

application {
    mainClass.set("com.example.Main")
}
```

Gradle Application Plugin lebih cocok jika ingin distribution ZIP/TAR dengan dependency terpisah.

Command:

```bash
./gradlew installDist
```

Layout:

```text
build/install/my-app/
├── bin/
│   └── my-app
└── lib/
    ├── my-app.jar
    ├── jackson-databind.jar
    └── slf4j-api.jar
```

Ini adalah **thin distribution**: artifact aplikasi terpisah dari dependency.

---

## 6. Fat JAR, Uber JAR, dan Shaded JAR

Istilah ini sering dipakai campur aduk, padahal ada perbedaan penting.

| Istilah | Arti praktis |
|---|---|
| Fat JAR | JAR besar yang membundel dependency |
| Uber JAR | Sinonim umum fat JAR |
| Shaded JAR | Fat JAR yang dapat melakukan relocation/package renaming |
| Executable JAR | JAR dengan entry point; bisa fat atau tidak |

### 6.1 Masalah yang Diselesaikan Fat JAR

Fat JAR menyelesaikan problem distribusi:

```text
Daripada deploy:
- app.jar
- lib/a.jar
- lib/b.jar
- lib/c.jar

deploy satu file:
- app-all.jar
```

Kelebihan:

- mudah dipindahkan;
- mudah dijalankan;
- cocok untuk CLI/simple service;
- mengurangi error “dependency missing”.

Kekurangan:

- artifact besar;
- duplikasi dependency antar service;
- resource collision;
- class relocation bisa membingungkan;
- vulnerability scanning perlu melihat isi JAR;
- patch dependency perlu rebuild artifact;
- tidak selalu optimal untuk container layering.

### 6.2 Resource Collision

Jika dua dependency punya resource sama:

```text
META-INF/services/com.example.Plugin
META-INF/spring.factories
META-INF/LICENSE
reference.conf
application.properties
```

Saat digabung ke satu JAR, salah satu bisa menimpa yang lain jika transformer/merge strategy tidak tepat.

Ini dapat menyebabkan bug runtime yang sulit didiagnosis.

Contoh failure:

```text
java.util.ServiceConfigurationError: com.example.Plugin: Provider not found
```

Penyebab: file `META-INF/services/...` tidak digabung, hanya salah satu yang menang.

### 6.3 Maven Shade Plugin

Contoh Maven Shade:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-shade-plugin</artifactId>
  <version>3.6.0</version>
  <executions>
    <execution>
      <phase>package</phase>
      <goals>
        <goal>shade</goal>
      </goals>
      <configuration>
        <createDependencyReducedPom>true</createDependencyReducedPom>
        <transformers>
          <transformer implementation="org.apache.maven.plugins.shade.resource.ManifestResourceTransformer">
            <mainClass>com.example.Main</mainClass>
          </transformer>
          <transformer implementation="org.apache.maven.plugins.shade.resource.ServicesResourceTransformer" />
        </transformers>
        <relocations>
          <relocation>
            <pattern>com.google.common</pattern>
            <shadedPattern>com.example.shadow.com.google.common</shadedPattern>
          </relocation>
        </relocations>
      </configuration>
    </execution>
  </executions>
</plugin>
```

Relocation mengubah package dependency agar tidak konflik dengan consumer/runtime lain.

Sebelum:

```text
com.google.common.collect.ImmutableList
```

Sesudah:

```text
com.example.shadow.com.google.common.collect.ImmutableList
```

### 6.4 Gradle Shadow Plugin

Contoh Gradle:

```kotlin
plugins {
    java
    id("com.gradleup.shadow") version "8.3.6"
}

tasks.shadowJar {
    archiveClassifier.set("all")
    mergeServiceFiles()
    manifest {
        attributes("Main-Class" to "com.example.Main")
    }
    relocate("com.google.common", "com.example.shadow.com.google.common")
}
```

Command:

```bash
./gradlew shadowJar
```

Output:

```text
build/libs/app-1.0.0-all.jar
```

### 6.5 Kapan Shading Tepat?

Shading tepat ketika:

- membuat CLI tool yang harus self-contained;
- membuat plugin yang berjalan di host runtime dengan dependency berbeda;
- menghindari konflik dependency dengan platform/container;
- dependency internal tidak ingin terekspos ke consumer;
- membundel library kecil yang stabil.

Shading kurang tepat ketika:

- membuat library umum tanpa alasan kuat;
- dependency besar dan sering security patch;
- consumer perlu mengontrol dependency version;
- relocation memecahkan reflective access/resource loading;
- sistem butuh SBOM dan vulnerability management yang transparan.

### 6.6 Shading sebagai Boundary, Bukan Shortcut

Anti-pattern umum:

```text
Ada conflict dependency -> shade semuanya -> problem hilang
```

Masalahnya: shading dapat menyembunyikan conflict, bukan menyelesaikan desain dependency.

Gunakan shading sebagai boundary sadar:

```text
Saya sengaja mengisolasi dependency X karena artifact ini berjalan sebagai plugin di runtime eksternal yang tidak saya kontrol.
```

Bukan:

```text
Saya tidak paham dependency graph, jadi saya bungkus semua ke fat JAR.
```

---

## 7. Thin JAR dan Thin Distribution

Thin JAR adalah JAR aplikasi yang tidak membundel semua dependency. Dependency disediakan di luar artifact utama.

Layout umum:

```text
app-distribution/
├── app.jar
├── lib/
│   ├── jackson-databind-2.17.2.jar
│   ├── slf4j-api-2.0.13.jar
│   └── logback-classic-1.5.6.jar
└── config/
    └── application.yaml
```

Kelebihan:

- dependency dapat terlihat jelas;
- patch dependency bisa lebih fleksibel jika policy mengizinkan;
- startup classpath eksplisit;
- container layer bisa memisahkan dependency dan app;
- lebih mudah inspect dependency.

Kekurangan:

- deployment lebih kompleks;
- classpath script harus benar;
- risiko dependency missing;
- artifact tidak satu file;
- perlu packaging distribution yang disiplin.

Gradle Application Plugin cocok untuk thin distribution.

Maven bisa memakai Maven Dependency Plugin untuk copy dependency:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-dependency-plugin</artifactId>
  <version>3.8.1</version>
  <executions>
    <execution>
      <id>copy-dependencies</id>
      <phase>package</phase>
      <goals>
        <goal>copy-dependencies</goal>
      </goals>
      <configuration>
        <outputDirectory>${project.build.directory}/lib</outputDirectory>
        <includeScope>runtime</includeScope>
      </configuration>
    </execution>
  </executions>
</plugin>
```

---

## 8. Spring Boot Executable JAR

Spring Boot executable JAR bukan sekadar fat JAR biasa. Ia punya layout khusus dan launcher sendiri.

Struktur umum:

```text
app.jar
├── META-INF/
│   └── MANIFEST.MF
├── BOOT-INF/
│   ├── classes/
│   │   └── com/example/App.class
│   └── lib/
│       ├── spring-core.jar
│       ├── jackson-databind.jar
│       └── logback-classic.jar
└── org/springframework/boot/loader/...
```

Manifest biasanya menunjuk launcher:

```text
Main-Class: org.springframework.boot.loader.launch.JarLauncher
Start-Class: com.example.App
```

Artinya:

- dependency tidak di-unzip dan digabung ke root seperti shade;
- dependency tetap sebagai nested JAR di `BOOT-INF/lib`;
- Spring Boot loader mengatur classloading;
- resource collision antar dependency lebih terjaga dibanding naive fat JAR;
- executable dengan `java -jar`.

### 8.1 Maven Spring Boot Repackage

```xml
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
```

`repackage` mengambil JAR biasa lalu mengubahnya menjadi executable archive.

### 8.2 Gradle Spring Boot Plugin

```kotlin
plugins {
    java
    id("org.springframework.boot") version "3.5.0"
    id("io.spring.dependency-management") version "1.1.7"
}

tasks.bootJar {
    archiveFileName.set("billing-service.jar")
}
```

Gradle Spring Boot plugin membuat task `bootJar`.

### 8.3 Boot JAR vs Plain JAR untuk Library

Jangan publish Boot executable JAR sebagai dependency library.

Alasannya:

- layout `BOOT-INF/classes` tidak sama dengan plain library JAR;
- consumer Maven/Gradle tidak memperlakukan nested JAR sebagai normal classpath;
- artifact executable punya tujuan runtime, bukan compile dependency.

Untuk module yang sekaligus application dan library, pisahkan:

```text
billing-api        -> plain JAR
billing-core       -> plain JAR
billing-service    -> bootJar/executable app
```

### 8.4 Layered JAR untuk Container

Spring Boot mendukung layered JAR agar container image bisa memisahkan layer:

```text
dependencies
spring-boot-loader
snapshot-dependencies
application
```

Manfaat:

- dependency yang jarang berubah dapat berada di layer bawah;
- class aplikasi di layer atas;
- rebuild image lebih efisien;
- push/pull layer lebih cepat.

Gradle:

```kotlin
tasks.bootJar {
    layered {
        enabled.set(true)
    }
}
```

Maven:

```xml
<plugin>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-maven-plugin</artifactId>
  <configuration>
    <layers>
      <enabled>true</enabled>
    </layers>
  </configuration>
</plugin>
```

---

## 9. WAR Packaging

WAR adalah Web Application Archive. Ia dirancang untuk web application yang berjalan di servlet container atau application server.

Struktur:

```text
app.war
├── META-INF/
├── WEB-INF/
│   ├── web.xml
│   ├── classes/
│   │   └── com/example/App.class
│   └── lib/
│       ├── app-dependency.jar
│       └── jackson-databind.jar
└── static/
    └── index.html
```

### 9.1 WAR untuk Servlet Container

Dalam WAR tradisional, container menyediakan beberapa API/runtime:

- Servlet API;
- JSP/JSTL tergantung container;
- Jakarta EE APIs tergantung server;
- JNDI/DataSource;
- transaction manager;
- security integration.

Karena itu scope dependency penting.

Maven:

```xml
<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
  <version>6.1.0</version>
  <scope>provided</scope>
</dependency>
```

Gradle:

```kotlin
dependencies {
    providedCompile("jakarta.servlet:jakarta.servlet-api:6.1.0")
}
```

Atau dengan War plugin:

```kotlin
plugins {
    war
}

dependencies {
    providedCompile("jakarta.servlet:jakarta.servlet-api:6.1.0")
}
```

### 9.2 Provided Scope adalah Runtime Contract

`provided` bukan optimisasi ukuran. Ia menyatakan:

> “Dependency ini dibutuhkan untuk compile, tetapi akan disediakan oleh runtime/container.”

Jika salah:

- dependency tidak ada di runtime -> `ClassNotFoundException`;
- dependency ikut dibundel padahal container sudah punya -> classloader conflict;
- versi API tidak cocok dengan container -> `NoSuchMethodError` atau subtle behavior mismatch.

### 9.3 Executable WAR

Spring Boot dapat membuat executable WAR yang bisa:

```bash
java -jar app.war
```

atau deploy ke servlet container.

Ini berguna untuk transisi dari deployment tradisional ke executable deployment.

Tetapi hati-hati: dual-mode WAR menambah kompleksitas dependency scope dan startup behavior.

---

## 10. EAR Packaging

EAR adalah Enterprise Application Archive. Ia digunakan dalam Jakarta EE/full application server untuk membungkus beberapa module:

```text
enterprise-app.ear
├── META-INF/
│   └── application.xml
├── web-module.war
├── ejb-module.jar
└── lib/
    └── shared-library.jar
```

EAR umum di sistem legacy enterprise.

Kelebihan:

- bisa deploy satu unit enterprise besar;
- berbagi library antar module;
- cocok untuk app server dengan EJB/JMS/JTA/JCA;
- deployment descriptor eksplisit.

Kekurangan:

- classloader lebih kompleks;
- deployment lebih berat;
- rollback granular sulit;
- kurang cocok untuk microservice modern;
- sering menciptakan shared mutable enterprise runtime boundary.

### 10.1 Maven EAR Plugin

```xml
<packaging>ear</packaging>

<build>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-ear-plugin</artifactId>
      <version>3.4.0</version>
      <configuration>
        <version>10</version>
        <modules>
          <webModule>
            <groupId>com.example</groupId>
            <artifactId>admin-web</artifactId>
            <contextRoot>/admin</contextRoot>
          </webModule>
        </modules>
      </configuration>
    </plugin>
  </plugins>
</build>
```

### 10.2 Gradle EAR Plugin

```kotlin
plugins {
    ear
}

dependencies {
    deploy(project(path = ":admin-web", configuration = "archives"))
    earlib(project(":shared-lib"))
}
```

### 10.3 EAR sebagai Boundary Lama

Dalam arsitektur modern, EAR sering menjadi tanda bahwa boundary deployment dan boundary domain belum dipisahkan.

Tetapi bukan berarti EAR selalu buruk. Untuk sistem regulasi/enterprise dengan application server standard, JTA, EJB, JMS, dan governance container-level, EAR bisa masih relevan.

Pertanyaan yang tepat bukan:

```text
EAR kuno atau modern?
```

Melainkan:

```text
Apakah runtime contract kita memang membutuhkan satu enterprise deployment unit dengan shared container services?
```

---

## 11. Modular JAR dan JPMS

Sejak Java 9, Java Platform Module System memperkenalkan `module-info.java`.

Contoh:

```java
module com.example.billing {
    requires java.sql;
    requires com.fasterxml.jackson.databind;

    exports com.example.billing.api;
}
```

Modular JAR berisi:

```text
module-info.class
com/example/billing/api/BillingService.class
```

### 11.1 Classpath vs Module Path

Classpath:

```text
Semua class berada dalam satu namespace besar.
```

Module path:

```text
Module punya nama, requires, exports, opens.
```

Perbedaan penting:

| Aspek | Classpath | Module Path |
|---|---|---|
| Encapsulation | Lemah | Lebih kuat |
| Dependency declaration | Build metadata | module-info juga |
| Split package | Bisa terjadi | Dilarang/bermasalah |
| Reflection | Umumnya bebas | Perlu `opens` |
| Legacy compatibility | Tinggi | Perlu disiplin |

### 11.2 Modular JAR untuk Library

Library yang ingin mendukung JPMS bisa menambahkan `module-info.java`.

Tetapi jika target masih Java 8, tidak bisa compile module-info langsung dengan baseline Java 8 kecuali memakai strategi multi-release atau source set khusus.

### 11.3 Automatic Module Name

Untuk library non-modular, manifest bisa menyertakan:

```text
Automatic-Module-Name: com.example.billing
```

Ini memberikan nama module stabil saat library dipakai di module path.

Maven:

```xml
<manifestEntries>
  <Automatic-Module-Name>com.example.billing</Automatic-Module-Name>
</manifestEntries>
```

Gradle:

```kotlin
tasks.jar {
    manifest {
        attributes("Automatic-Module-Name" to "com.example.billing")
    }
}
```

### 11.4 Split Package Failure

JPMS tidak suka split package:

```text
jar-a: com.example.common.User
jar-b: com.example.common.Address
```

Jika dua module mengekspor package sama, module resolution dapat gagal.

Ini sering terjadi pada library lama atau module internal yang tidak punya boundary package jelas.

---

## 12. Multi-Release JAR

Multi-Release JAR memungkinkan satu JAR memiliki class khusus untuk versi Java tertentu.

Struktur:

```text
my-lib.jar
├── com/example/Feature.class                  # base version, misalnya Java 8
└── META-INF/versions/11/com/example/Feature.class
└── META-INF/versions/17/com/example/Feature.class
```

Manifest:

```text
Multi-Release: true
```

Runtime Java memilih class versi tertinggi yang kompatibel.

Contoh:

- Java 8 memakai base class;
- Java 11 memakai `META-INF/versions/11` jika ada;
- Java 17 memakai `META-INF/versions/17` jika ada.

### 12.1 Kapan MR-JAR Berguna?

MR-JAR berguna ketika:

- library ingin tetap support Java 8;
- tetapi ingin memanfaatkan API Java 11/17/21 jika runtime lebih baru;
- ingin menghindari reflection kompleks untuk version-specific implementation;
- public API tetap sama.

Contoh use case:

```text
Base API: Java 8
Implementation Java 11: pakai HttpClient bawaan
Implementation Java 17: pakai API runtime tertentu
```

### 12.2 Risiko MR-JAR

Risiko:

- build lebih kompleks;
- testing harus multi-JDK;
- behavior bisa berbeda antar runtime;
- sulit dipahami engineer baru;
- tooling lama mungkin tidak support penuh;
- reproducibility lebih sulit.

Gunakan MR-JAR hanya jika benefit compatibility jelas.

---

## 13. Source JAR dan Javadoc JAR

Untuk library yang dipublikasikan, biasanya dibutuhkan:

```text
artifact.jar
artifact-sources.jar
artifact-javadoc.jar
```

Manfaat:

- IDE dapat menampilkan source;
- debugging library lebih mudah;
- Maven Central biasanya mengharapkan source/javadoc untuk publikasi library;
- dokumentasi API lebih mudah dikonsumsi.

Maven:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-source-plugin</artifactId>
  <version>3.3.1</version>
  <executions>
    <execution>
      <id>attach-sources</id>
      <goals>
        <goal>jar-no-fork</goal>
      </goals>
    </execution>
  </executions>
</plugin>

<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-javadoc-plugin</artifactId>
  <version>3.8.0</version>
  <executions>
    <execution>
      <id>attach-javadocs</id>
      <goals>
        <goal>jar</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

Gradle:

```kotlin
java {
    withSourcesJar()
    withJavadocJar()
}
```

---

## 14. Classifier Engineering

Artifact coordinate tidak hanya:

```text
groupId:artifactId:version
```

Ada juga classifier dan extension:

```text
com.example:billing-core:1.0.0
com.example:billing-core:1.0.0:sources
com.example:billing-core:1.0.0:javadoc
com.example:billing-core:1.0.0:tests
com.example:billing-core:1.0.0:all
```

Classifier membantu membedakan artifact tambahan dari project yang sama.

Contoh Maven attach test JAR:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-jar-plugin</artifactId>
  <version>3.4.2</version>
  <executions>
    <execution>
      <goals>
        <goal>test-jar</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

Tetapi hati-hati dengan test JAR sebagai shared test fixture. Terlalu sering memakai test JAR antar module bisa menandakan test boundary tidak jelas. Gradle memiliki `java-test-fixtures` yang lebih eksplisit.

---

## 15. Container Image sebagai Packaging Layer Berikutnya

Untuk aplikasi modern, artifact final sering bukan JAR tetapi container image.

```text
source -> classes -> jar -> image -> deploy
```

Container image memperluas packaging contract:

| Layer | Kontrak |
|---|---|
| Base image | OS/JRE/native libs/security patch baseline |
| Dependency layer | Library runtime aplikasi |
| Application layer | Classes/resource aplikasi |
| Config/runtime layer | Entrypoint, user, env, filesystem |

### 15.1 Dockerfile Sederhana

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY target/app.jar /app/app.jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Ini mudah, tetapi layering kurang optimal. Setiap app.jar berubah, seluruh layer JAR berubah.

### 15.2 Layered JAR Extraction

Dengan Spring Boot layered JAR:

```dockerfile
FROM eclipse-temurin:21-jre AS builder
WORKDIR /workspace
COPY target/app.jar app.jar
RUN java -Djarmode=tools -jar app.jar extract --layers --destination extracted

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=builder /workspace/extracted/dependencies/ ./
COPY --from=builder /workspace/extracted/spring-boot-loader/ ./
COPY --from=builder /workspace/extracted/snapshot-dependencies/ ./
COPY --from=builder /workspace/extracted/application/ ./
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

Konsepnya:

```text
dependencies          -> jarang berubah
spring boot loader    -> jarang berubah
snapshot dependencies -> kadang berubah
application           -> sering berubah
```

### 15.3 Jib

Jib dapat membangun container image Java tanpa Dockerfile manual.

Gradle:

```kotlin
plugins {
    id("com.google.cloud.tools.jib") version "3.4.4"
}

jib {
    from {
        image = "eclipse-temurin:21-jre"
    }
    to {
        image = "registry.example.com/billing-service:${project.version}"
    }
    container {
        mainClass = "com.example.billing.App"
        ports = listOf("8080")
    }
}
```

Maven:

```xml
<plugin>
  <groupId>com.google.cloud.tools</groupId>
  <artifactId>jib-maven-plugin</artifactId>
  <version>3.4.4</version>
  <configuration>
    <from>
      <image>eclipse-temurin:21-jre</image>
    </from>
    <to>
      <image>registry.example.com/billing-service:${project.version}</image>
    </to>
  </configuration>
</plugin>
```

### 15.4 Buildpacks

Spring Boot plugin dapat membangun image via Cloud Native Buildpacks.

Maven:

```bash
mvn spring-boot:build-image
```

Gradle:

```bash
./gradlew bootBuildImage
```

Buildpacks berguna jika organisasi ingin standardisasi image build tanpa Dockerfile per service.

### 15.5 Image Packaging Decision

Pertanyaan penting:

```text
Apakah artifact release kita JAR atau image?
```

Jika release artifact adalah JAR:

- image bisa dibangun di deployment pipeline;
- satu JAR bisa dipakai banyak runtime;
- base image bisa berubah tanpa rebuild source artifact;
- tetapi perlu kontrol kompatibilitas JAR-image.

Jika release artifact adalah image:

- runtime environment lebih lengkap dan immutable;
- rollback lebih sederhana;
- vulnerability scan lebih konkret;
- tetapi image rebuild diperlukan untuk base patch.

Enterprise biasanya perlu keduanya:

```text
JAR sebagai build artifact
Image sebagai deployable artifact
SBOM untuk keduanya
Digest sebagai release identity
```

---

## 16. Native Image Packaging

GraalVM Native Image mengompilasi aplikasi Java menjadi executable native ahead-of-time.

```text
Java bytecode + closed-world analysis -> native executable
```

Output:

```text
billing-service
```

Bukan:

```text
billing-service.jar
```

Kelebihan:

- startup sangat cepat;
- memory footprint bisa lebih kecil;
- cocok untuk serverless/CLI/short-lived process;
- tidak butuh JVM runtime penuh di image final.

Kekurangan:

- build jauh lebih berat;
- reflection/proxy/resource harus dikonfigurasi;
- dynamic classloading terbatas;
- debugging berbeda;
- library compatibility harus diverifikasi;
- profiling/JIT behavior hilang;
- native binary target OS/architecture-specific.

### 16.1 Maven Native Build Tools

```xml
<plugin>
  <groupId>org.graalvm.buildtools</groupId>
  <artifactId>native-maven-plugin</artifactId>
  <version>0.10.4</version>
  <extensions>true</extensions>
</plugin>
```

Command umum:

```bash
mvn -Pnative native:compile
```

### 16.2 Gradle Native Build Tools

```kotlin
plugins {
    id("org.graalvm.buildtools.native") version "0.10.4"
}

graalvmNative {
    binaries {
        named("main") {
            imageName.set("billing-service")
            mainClass.set("com.example.billing.App")
        }
    }
}
```

Command:

```bash
./gradlew nativeCompile
```

### 16.3 Native Image Metadata

Dynamic features perlu metadata:

- reflection config;
- resource config;
- proxy config;
- serialization config;
- JNI config.

Contoh reflection config:

```json
[
  {
    "name": "com.example.billing.Customer",
    "allDeclaredConstructors": true,
    "allPublicMethods": true
  }
]
```

Framework modern seperti Spring Boot native support, Micronaut, dan Quarkus membantu generate metadata, tetapi engineer tetap harus paham closed-world assumption.

### 16.4 Native Image Decision

Native image cocok untuk:

- CLI;
- function/serverless;
- low-latency startup;
- memory-constrained deployment;
- short-lived jobs;
- edge deployment.

Kurang cocok jika:

- aplikasi sangat dynamic;
- banyak reflection/plugin runtime;
- build time sangat kritis;
- peak throughput JIT lebih penting;
- library belum native-friendly;
- perlu observability agent yang belum kompatibel.

---

## 17. jlink dan Custom Runtime Image

Sejak Java 9, `jlink` dapat membuat runtime image yang hanya berisi module JDK yang dibutuhkan.

```bash
jlink \
  --add-modules java.base,java.logging,java.sql \
  --output runtime-image \
  --strip-debug \
  --compress=2 \
  --no-header-files \
  --no-man-pages
```

Output:

```text
runtime-image/
├── bin/java
├── conf/
├── legal/
└── lib/
```

Manfaat:

- runtime lebih kecil;
- JDK modules eksplisit;
- cocok untuk container image minimal;
- mengurangi surface area.

Risiko:

- module yang kurang menyebabkan runtime failure;
- perlu memahami JPMS/JDK module dependency;
- third-party libs di classpath belum otomatis menjadi named module;
- operational debugging perlu standardisasi.

jlink adalah packaging runtime, bukan packaging aplikasi saja.

---

## 18. Packaging dan Classloader

Banyak bug packaging sebenarnya bug classloader.

### 18.1 Classpath Linear

Saat menjalankan:

```bash
java -cp "a.jar:b.jar:c.jar" com.example.Main
```

Jika class yang sama ada di dua JAR:

```text
a.jar -> com.example.Util
b.jar -> com.example.Util
```

Yang menang tergantung urutan classpath.

Ini sumber `jar hell`.

### 18.2 App Server Classloader

Application server memiliki hierarchy:

```text
Bootstrap ClassLoader
  -> Platform/System ClassLoader
     -> Server ClassLoader
        -> Application ClassLoader
           -> Web Module ClassLoader
```

Tiap server bisa punya policy parent-first atau parent-last pada area tertentu.

Masalah umum:

- aplikasi membundel API yang container sediakan;
- server punya library versi lama;
- WAR punya dependency yang bertabrakan dengan shared server lib;
- dua app dalam server berbagi classloader tidak sengaja;
- Jakarta/Javax mix.

### 18.3 Spring Boot LaunchedURLClassLoader

Spring Boot executable JAR memakai classloader khusus untuk nested JAR. Ini berbeda dari classpath biasa.

Konsekuensi:

- beberapa tool yang mengasumsikan file system path bisa bermasalah;
- scanning nested JAR perlu dukungan;
- agent/instrumentation tertentu perlu verifikasi;
- resource loading harus memakai classloader API, bukan asumsi path file.

---

## 19. Resource Packaging

Resource adalah bagian dari runtime contract.

Contoh resource:

```text
application.yaml
logback.xml
META-INF/services/...
META-INF/spring.factories
META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
db/migration/V1__init.sql
templates/email.html
static/index.html
```

### 19.1 Resource Collision

Jika beberapa dependency punya resource sama, hasil packaging menentukan behavior.

Contoh:

```text
reference.conf
META-INF/services/java.sql.Driver
META-INF/spring.factories
```

Shading perlu merge strategy. Spring Boot nested JAR biasanya tidak merge dependency content ke root, sehingga collision antar dependency lebih kecil.

### 19.2 Filtering Resource

Maven resource filtering:

```xml
<resource>
  <directory>src/main/resources</directory>
  <filtering>true</filtering>
</resource>
```

Gradle:

```kotlin
tasks.processResources {
    filesMatching("application.properties") {
        expand("version" to project.version)
    }
}
```

Hati-hati:

- filtering bisa merusak file binary;
- secret bisa ikut masuk artifact;
- environment-specific value bisa membuat artifact tidak immutable;
- timestamp/build number bisa merusak reproducibility.

Prinsip sehat:

```text
Artifact berisi default config non-secret.
Runtime environment menyuplai secret dan environment-specific config.
```

---

## 20. Reproducible Packaging

Packaging mudah menjadi non-deterministic karena:

- timestamp file;
- urutan file dalam ZIP/JAR;
- manifest `Created-By`;
- absolute path;
- generated file dengan timestamp;
- dependency SNAPSHOT;
- resource filtering waktu build;
- OS file permission;
- line ending.

### 20.1 Maven Reproducible Packaging

Maven mendukung property:

```xml
<properties>
  <project.build.outputTimestamp>2026-01-01T00:00:00Z</project.build.outputTimestamp>
</properties>
```

Banyak plugin Maven modern memakai property ini untuk timestamp archive.

### 20.2 Gradle Reproducible Archives

Gradle archive tasks memiliki properti:

```kotlin
tasks.withType<AbstractArchiveTask>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}
```

Pada Gradle modern, default reproducibility archive semakin ditingkatkan, tetapi explicit policy tetap berguna terutama untuk build lama atau plugin custom.

### 20.3 Packaging Reproducibility Checklist

Pastikan:

- plugin version pinned;
- dependency locked;
- timestamp distabilkan;
- file order deterministik;
- generated source deterministik;
- manifest tidak memuat waktu random;
- build-info tidak memuat hostname/path lokal;
- archive permission konsisten;
- CI environment distandarkan;
- artifact diverifikasi via checksum.

---

## 21. SBOM dan Metadata Packaging

Package modern harus bisa dijawab:

```text
Apa isi artifact ini?
Dependency apa saja?
Versinya apa?
License-nya apa?
Ada vulnerability apa?
Dibangun dari commit mana?
Dengan toolchain apa?
```

SBOM umum:

- CycloneDX;
- SPDX.

Maven CycloneDX:

```xml
<plugin>
  <groupId>org.cyclonedx</groupId>
  <artifactId>cyclonedx-maven-plugin</artifactId>
  <version>2.9.0</version>
</plugin>
```

Gradle CycloneDX:

```kotlin
plugins {
    id("org.cyclonedx.bom") version "1.10.0"
}
```

Packaging metadata tidak selalu dimasukkan ke JAR. Bisa juga dipublish sebagai artifact terpisah:

```text
app.jar
app.jar.sha256
app.jar.asc
bom.json
provenance.json
```

---

## 22. Packaging untuk Library vs Application

### 22.1 Library Packaging Invariants

Library JAR yang sehat:

- tidak executable kecuali memang CLI library;
- tidak membundel dependency tanpa alasan;
- POM metadata benar;
- dependency scope benar;
- public API stabil;
- source/javadoc artifact tersedia;
- automatic module name stabil jika ingin JPMS-friendly;
- tidak membawa resource global yang mengganggu consumer;
- tidak menginisialisasi runtime behavior diam-diam.

### 22.2 Application Packaging Invariants

Application artifact yang sehat:

- runnable secara eksplisit;
- dependency runtime lengkap;
- config externalization jelas;
- version/build metadata tersedia;
- health/diagnostic metadata tersedia;
- reproducible;
- scanable;
- immutable;
- rollbackable;
- compatible dengan target runtime.

### 22.3 Plugin Packaging Invariants

Plugin artifact, misalnya Keycloak SPI, Maven plugin, Gradle plugin, application-server extension:

- harus mengikuti classloader host;
- dependency harus disediakan/diisolasi dengan sadar;
- shading sering relevan;
- manifest/service descriptor harus benar;
- runtime version compatibility sangat penting;
- jangan membundel dependency yang host sudah wajibkan kecuali di-relocate.

---

## 23. Publishing Packaging Output

Package belum selesai sampai dipublish atau disimpan sebagai artifact release.

### 23.1 Maven Publish

```bash
mvn deploy
```

Maven deploy mengirim artifact ke remote repository sesuai `distributionManagement`.

```xml
<distributionManagement>
  <repository>
    <id>internal-releases</id>
    <url>https://repo.example.com/releases</url>
  </repository>
  <snapshotRepository>
    <id>internal-snapshots</id>
    <url>https://repo.example.com/snapshots</url>
  </snapshotRepository>
</distributionManagement>
```

### 23.2 Gradle Maven Publish

```kotlin
plugins {
    `maven-publish`
}

publishing {
    publications {
        create<MavenPublication>("mavenJava") {
            from(components["java"])
        }
    }
    repositories {
        maven {
            name = "internal"
            url = uri("https://repo.example.com/releases")
            credentials {
                username = providers.gradleProperty("repoUser").get()
                password = providers.gradleProperty("repoPassword").get()
            }
        }
    }
}
```

### 23.3 Publish Plain JAR vs Boot JAR

Dalam Gradle Spring Boot project, hati-hati dengan artifact yang dipublish.

Untuk application:

- publish bootJar jika repository menyimpan deployable application artifact;
- jangan publish bootJar sebagai library dependency.

Untuk library:

- disable `bootJar`, enable `jar`.

```kotlin
tasks.bootJar {
    enabled = false
}

tasks.jar {
    enabled = true
}
```

---

## 24. Packaging Decision Matrix

| Scenario | Packaging disarankan | Alasan |
|---|---|---|
| Shared Java library | Plain JAR + sources/javadoc | Consumer mengontrol runtime dependency |
| Spring Boot microservice | Boot executable layered JAR atau image | Mudah deploy, dependency lengkap, layerable |
| CLI internal tool | Shaded executable JAR atau native image | Distribusi sederhana |
| Jakarta EE app server | WAR/EAR dengan provided scope | Container menyediakan runtime services |
| Keycloak SPI/plugin | Plain/shaded JAR sesuai host classloader | Harus kompatibel dengan host runtime |
| Serverless Java | Native image atau optimized executable JAR | Startup penting |
| Air-gapped enterprise | JAR + SBOM + checksums + private repo | Auditability dan reproducibility |
| Monorepo multi-service | Plain module JAR + service executable artifacts | Boundary jelas |
| Container-first deployment | Image digest sebagai deployable artifact | Runtime immutable |

---

## 25. Failure Mode Packaging

### 25.1 `no main manifest attribute`

Penyebab:

- manifest tidak punya `Main-Class`;
- salah artifact yang dijalankan;
- menjalankan plain JAR, bukan boot/shaded JAR.

Diagnosis:

```bash
jar tf app.jar | grep MANIFEST
unzip -p app.jar META-INF/MANIFEST.MF
```

### 25.2 `ClassNotFoundException`

Penyebab:

- dependency tidak masuk runtime classpath;
- scope salah;
- dependency marked optional;
- packaging thin tetapi lib tidak disalin;
- container tidak menyediakan dependency yang diasumsikan provided.

Diagnosis:

```bash
jar tf app.jar | grep MissingClass
mvn dependency:tree
./gradlew dependencies --configuration runtimeClasspath
```

### 25.3 `NoSuchMethodError`

Penyebab:

- compile memakai versi dependency lebih baru;
- runtime membawa versi lebih lama;
- app server shared library menang;
- shaded/relocated dependency tidak konsisten.

Diagnosis:

```bash
mvn dependency:tree -Dverbose
./gradlew dependencyInsight --dependency jackson-databind --configuration runtimeClasspath
```

### 25.4 Duplicate Logging Binding

Penyebab:

- lebih dari satu SLF4J binding;
- dependency transitive membawa logback/log4j binding;
- fat JAR menggabungkan binding tidak diinginkan.

Diagnosis:

```bash
jar tf app.jar | grep -E 'slf4j|logback|log4j'
```

### 25.5 Broken ServiceLoader

Penyebab:

- `META-INF/services` tidak ter-merge saat shading;
- resource descriptor tertimpa.

Solusi:

- Maven Shade `ServicesResourceTransformer`;
- Gradle Shadow `mergeServiceFiles()`.

### 25.6 Native Image Runtime Failure

Penyebab:

- reflection metadata kurang;
- resource tidak dimasukkan;
- dynamic proxy tidak terdaftar;
- initialization time salah build-time vs runtime.

Diagnosis:

- cek native-image build report;
- aktifkan tracing agent;
- test native binary di CI;
- jangan hanya test JVM mode.

---

## 26. Packaging Review Checklist

Gunakan checklist ini saat review PR build/package.

### 26.1 Artifact Identity

- Apakah `group`, `artifact`, `version` benar?
- Apakah classifier jelas?
- Apakah artifact application dan library dipisahkan?
- Apakah artifact punya checksum/signature jika perlu?
- Apakah artifact immutable setelah release?

### 26.2 Runtime Contract

- Bagaimana artifact dijalankan?
- Apakah entry point eksplisit?
- Apakah target JDK/runtime jelas?
- Apakah dependency runtime lengkap?
- Apakah ada dependency yang diasumsikan `provided`?

### 26.3 Classpath/Classloader

- Apakah ada duplicate class?
- Apakah ada duplicate logging binding?
- Apakah WAR membundel API yang disediakan container?
- Apakah plugin dependency conflict dengan host?
- Apakah shaded dependency sudah direlokasi dengan benar?

### 26.4 Resource

- Apakah `META-INF/services` ter-merge?
- Apakah resource filtering aman?
- Apakah secret tidak masuk artifact?
- Apakah config environment-specific tidak dibake ke artifact?

### 26.5 Reproducibility

- Apakah timestamp archive stabil?
- Apakah file order deterministik?
- Apakah generated metadata deterministik?
- Apakah dependency locked/pinned?
- Apakah artifact bisa diverifikasi ulang?

### 26.6 Security

- Apakah SBOM dibuat?
- Apakah vulnerability scan melihat dependency nested?
- Apakah base image discan?
- Apakah signature/provenance tersedia?
- Apakah dependency shaded tetap terdeteksi scanner?

### 26.7 Operations

- Apakah artifact bisa dirollback?
- Apakah image layer efisien?
- Apakah version info terlihat di runtime?
- Apakah startup command distandarkan?
- Apakah health/diagnostic endpoint tahu build version?

---

## 27. Case Study: Enterprise Java Platform Packaging

Misal ada platform enterprise dengan module:

```text
platform-bom
shared-domain
shared-security
case-api
case-core
case-service
admin-web
keycloak-spi
batch-worker
openapi-client
```

Packaging sehat:

```text
platform-bom       -> pom/BOM only
shared-domain      -> plain JAR + sources/javadoc
shared-security    -> plain JAR
case-api           -> plain JAR
case-core          -> plain JAR
case-service       -> Spring Boot layered executable JAR + container image
admin-web          -> WAR jika deploy ke servlet container
keycloak-spi       -> provider JAR, mungkin shaded untuk isolated dependency
batch-worker       -> executable JAR atau native image jika startup penting
openapi-client     -> generated plain JAR
```

Dependency direction:

```text
case-service -> case-core -> case-api -> shared-domain
case-service -> shared-security
admin-web    -> case-api
keycloak-spi -> shared-security subset, hati-hati classloader host
```

Yang harus dihindari:

```text
shared-domain -> case-service
case-api -> case-core
keycloak-spi membundel semua Spring Boot dependency
admin-web membundel servlet-api padahal container provide
library module menghasilkan bootJar
```

CI packaging pipeline:

```text
validate
  -> compile
     -> unit test
        -> integration test
           -> package plain libs
              -> package executable apps
                 -> generate SBOM
                    -> scan
                       -> publish artifacts
                          -> build images
                             -> scan images
                                -> sign/provenance
```

---

## 28. Maven Template: Library Module

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.example.platform</groupId>
  <artifactId>shared-domain</artifactId>
  <version>1.0.0</version>
  <packaging>jar</packaging>

  <properties>
    <maven.compiler.release>8</maven.compiler.release>
    <project.build.outputTimestamp>2026-01-01T00:00:00Z</project.build.outputTimestamp>
  </properties>

  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-jar-plugin</artifactId>
        <version>3.4.2</version>
        <configuration>
          <archive>
            <manifestEntries>
              <Automatic-Module-Name>com.example.platform.shared.domain</Automatic-Module-Name>
            </manifestEntries>
          </archive>
        </configuration>
      </plugin>

      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-source-plugin</artifactId>
        <version>3.3.1</version>
        <executions>
          <execution>
            <id>attach-sources</id>
            <goals>
              <goal>jar-no-fork</goal>
            </goals>
          </execution>
        </executions>
      </plugin>
    </plugins>
  </build>
</project>
```

---

## 29. Gradle Template: Library Module

```kotlin
plugins {
    `java-library`
    `maven-publish`
}

group = "com.example.platform"
version = "1.0.0"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
    withSourcesJar()
    withJavadocJar()
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(8)
}

tasks.jar {
    manifest {
        attributes(
            "Automatic-Module-Name" to "com.example.platform.shared.domain",
            "Implementation-Version" to project.version
        )
    }
}

tasks.withType<AbstractArchiveTask>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}

publishing {
    publications {
        create<MavenPublication>("mavenJava") {
            from(components["java"])
        }
    }
}
```

---

## 30. Maven Template: Spring Boot Application

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.example.platform</groupId>
  <artifactId>case-service</artifactId>
  <version>1.0.0</version>
  <packaging>jar</packaging>

  <properties>
    <java.version>21</java.version>
    <project.build.outputTimestamp>2026-01-01T00:00:00Z</project.build.outputTimestamp>
  </properties>

  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
        <version>${spring-boot.version}</version>
        <configuration>
          <layers>
            <enabled>true</enabled>
          </layers>
        </configuration>
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

---

## 31. Gradle Template: Spring Boot Application

```kotlin
plugins {
    java
    id("org.springframework.boot") version "3.5.0"
    id("io.spring.dependency-management") version "1.1.7"
}

group = "com.example.platform"
version = "1.0.0"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.bootJar {
    archiveFileName.set("case-service.jar")
    layered {
        enabled.set(true)
    }
    manifest {
        attributes("Implementation-Version" to project.version)
    }
}

tasks.jar {
    enabled = false
}
```

---

## 32. Anti-Patterns Packaging

### 32.1 Semua Module Menghasilkan Boot JAR

Salah:

```text
shared-domain -> bootJar
shared-security -> bootJar
case-core -> bootJar
case-service -> bootJar
```

Benar:

```text
shared-domain -> plain JAR
shared-security -> plain JAR
case-core -> plain JAR
case-service -> bootJar
```

### 32.2 Library Membundel Dependency Besar

Library seharusnya tidak sembarangan membundel dependency. Consumer kehilangan kontrol version.

### 32.3 WAR Membundel Container API

Jika servlet/app server sudah menyediakan API, jangan bundel versi sendiri kecuali tahu classloader policy-nya.

### 32.4 Shading Tanpa Relocation/Merge Strategy

Fat JAR tanpa merge resource bisa rusak diam-diam.

### 32.5 Artifact Environment-Specific

Buruk:

```text
app-dev.jar
app-uat.jar
app-prod.jar
```

Lebih sehat:

```text
app.jar immutable
runtime config berbeda per environment
```

### 32.6 Publish SNAPSHOT sebagai Release

Artifact release harus immutable dan traceable. SNAPSHOT bukan release contract.

### 32.7 Tidak Ada SBOM untuk Executable Artifact

Terutama untuk Boot JAR/native image/container image, scanner harus tahu dependency aktual yang dibundel.

---

## 33. Heuristik Top 1% untuk Packaging

Gunakan prinsip berikut:

1. **Package adalah kontrak runtime, bukan output folder.**
2. **Library dan application artifact harus dipisahkan secara tegas.**
3. **Dependency yang dibundel harus bisa dijelaskan alasannya.**
4. **Provided scope adalah kontrak dengan runtime, bukan cara mengecilkan artifact.**
5. **Shading adalah isolasi dependency, bukan solusi malas untuk conflict.**
6. **Executable JAR harus bisa dijalankan dan diobservasi secara deterministic.**
7. **WAR/EAR berarti sebagian runtime contract dimiliki container.**
8. **Container image adalah package juga, bukan sekadar deployment wrapper.**
9. **Native image mengubah model runtime secara fundamental.**
10. **Artifact release harus immutable, reproducible, scanable, dan rollbackable.**

---

## 34. Ringkasan Mental Model

Packaging adalah tahap saat build menghasilkan unit yang dipercaya oleh dunia luar.

```text
Compiler menghasilkan bytecode.
Test memberi confidence.
Packaging membuat runtime contract.
Publishing membuat artifact dapat dikonsumsi.
Deployment menjalankan artifact dalam environment target.
```

Kalau packaging salah, compile dan test bisa tetap hijau, tetapi runtime gagal.

Karena itu engineer senior selalu bertanya:

```text
Artifact ini untuk siapa?
Dijalankan di mana?
Dependency-nya dari mana?
Classloader-nya bagaimana?
Resource collision-nya bagaimana?
Bisa direbuild sama persis?
Bisa discan?
Bisa rollback?
Bisa dijelaskan saat incident?
```

Ketika pertanyaan itu terjawab, packaging berubah dari ritual build menjadi engineering discipline.

---

## 35. Koneksi ke Part Berikutnya

Part ini membahas bagaimana output build dikemas. Bagian berikutnya akan membahas hal yang sering menjadi penyebab artifact berbeda antar environment: **resource processing, filtering, profiles, properties, dan environment separation**.

Packaging dan environment separation harus dipisahkan secara bersih. Artifact harus immutable, sedangkan konfigurasi environment harus diinjeksi saat runtime dengan cara yang aman, audit-able, dan repeatable.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 11 — Testing Build Pipeline: Unit, Integration, Functional, Contract, Mutation, Benchmark](./11-testing-build-pipeline.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 13 — Resource Processing, Filtering, Profiles, Properties, Environment Separation](./13-resource-processing-filtering-profiles-properties-environment-separation.md)

</div>