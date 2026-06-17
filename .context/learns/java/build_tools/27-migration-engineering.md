# Part 27 — Migration Engineering: Maven to Gradle, Gradle to Maven, Legacy Ant, Java 8 to 25

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `27-migration-engineering.md`  
> Target: Java 8 sampai Java 25  
> Fokus: migration engineering untuk build system dan Java baseline secara aman, terukur, reversible, dan defensible.

---

## 1. Tujuan Bagian Ini

Migrasi build bukan sekadar mengganti file:

```text
pom.xml  -> build.gradle.kts
build.gradle -> pom.xml
build.xml -> pom.xml / build.gradle.kts
Java 8 -> Java 17 / 21 / 25
```

Migrasi build adalah perubahan pada **sistem produksi yang menghasilkan artifact produksi**.

Kalau build salah, aplikasi mungkin tetap compile tetapi:

- dependency runtime berbeda;
- test yang dulu jalan tidak lagi ikut pipeline;
- annotation processor tidak aktif;
- resource filtering berubah;
- artifact layout berubah;
- classpath berubah;
- release metadata berubah;
- container image berbeda;
- vulnerability scan melewati dependency tertentu;
- plugin lifecycle berubah;
- Java bytecode baseline berubah;
- deploy berhasil tapi runtime gagal.

Top 1% engineer tidak melihat migrasi build sebagai pekerjaan administratif. Mereka melihatnya sebagai **controlled transformation of a software supply chain**.

---

## 2. Prinsip Utama Migration Engineering

### 2.1 Migrasi harus menjaga invariants

Sebelum mengganti tool, tentukan invariants yang tidak boleh berubah.

Contoh invariants:

```text
Artifact identity:
- groupId/name/version tetap benar
- classifier tetap benar
- artifact extension tetap benar

Compilation:
- source compatibility sama
- target bytecode sama
- annotation processor sama
- generated sources sama

Dependency:
- compile classpath ekuivalen
- runtime classpath ekuivalen
- test classpath ekuivalen
- dependency versions terkunci atau sengaja berubah

Testing:
- unit test tetap jalan
- integration test tetap jalan
- coverage tidak turun tanpa alasan

Packaging:
- JAR/WAR layout kompatibel
- manifest benar
- service loader metadata benar
- resource files tetap masuk

Release:
- artifact publish ke repository benar
- signing/checksum/SBOM tetap jalan
- CI versioning tidak rusak
```

Migrasi yang tidak punya invariants akan berubah menjadi trial-and-error.

---

### 2.2 Migrasi harus punya parity proof

Jangan puas dengan “build baru berhasil”. Pertanyaan yang benar:

```text
Apakah hasil build baru ekuivalen dengan hasil build lama untuk tujuan yang sama?
```

Bukti parity bisa berupa:

- dependency tree comparison;
- bytecode target comparison;
- generated source comparison;
- artifact content diff;
- test result comparison;
- coverage comparison;
- container image layer comparison;
- runtime smoke test;
- deployment test;
- vulnerability/SBOM comparison.

---

### 2.3 Migrasi harus phased dan reversible

Migrasi build yang sehat jarang dilakukan dengan big bang.

Lebih aman:

```text
Phase 0: observe existing build
Phase 1: freeze versions and document behavior
Phase 2: introduce new build in parallel
Phase 3: compare outputs
Phase 4: migrate CI non-release path
Phase 5: migrate release path
Phase 6: remove old build after confidence window
```

Reversibility penting karena build system adalah jalur produksi.

---

## 3. Build Migration Mental Model

Migrasi build sebenarnya memindahkan beberapa layer:

```text
+--------------------------------------------------+
| Release semantics                                |
| version, tag, changelog, signing, publish        |
+--------------------------------------------------+
| CI orchestration                                 |
| cache, matrix, stages, secrets, promotion        |
+--------------------------------------------------+
| Quality gates                                    |
| tests, coverage, static analysis, security scan  |
+--------------------------------------------------+
| Packaging                                        |
| jar, war, boot jar, shaded jar, native image      |
+--------------------------------------------------+
| Compilation and code generation                  |
| javac, annotation processor, generated sources   |
+--------------------------------------------------+
| Dependency graph                                 |
| scopes, configs, BOM/platform, exclusions        |
+--------------------------------------------------+
| Project model                                    |
| modules, source sets, lifecycle, tasks           |
+--------------------------------------------------+
```

Kalau Anda hanya menerjemahkan syntax, Anda baru menyentuh layer bawah. Migration engineering harus memverifikasi seluruh layer.

---

## 4. Jenis Migrasi yang Umum

### 4.1 Maven ke Gradle

Biasanya dilakukan karena:

- build Maven lambat di multi-module besar;
- butuh flexible task graph;
- butuh build cache;
- butuh composite build;
- butuh variant-aware dependency model;
- ingin central convention plugin;
- monorepo semakin besar.

Risiko utama:

- Maven lifecycle implicit tidak otomatis sama di Gradle;
- Maven scopes tidak selalu 1:1 dengan Gradle configurations;
- plugin behavior tidak identik;
- generated sources bisa tidak ikut compile;
- integration test phase bisa hilang;
- Maven BOM import perlu diterjemahkan ke platform/version catalog;
- release pipeline berubah drastis.

---

### 4.2 Gradle ke Maven

Biasanya dilakukan karena:

- organisasi ingin standardisasi kuat;
- tim tidak nyaman dengan programmable build logic;
- build script terlalu imperative dan sulit diaudit;
- compliance lebih mudah dengan POM convention;
- library publishing ke Maven ecosystem ingin lebih sederhana;
- mengurangi custom build logic.

Risiko utama:

- Gradle variant model sulit direpresentasikan di Maven POM;
- composite build tidak punya padanan langsung;
- custom task graph perlu plugin Maven khusus;
- build cache/incrementality tidak setara;
- Gradle source sets custom perlu mapping manual;
- dependency capabilities/attributes hilang.

---

### 4.3 Ant ke Maven/Gradle

Biasanya legacy enterprise.

Ant build sering berisi:

- explicit `javac` task;
- manual copy resource;
- manual jar/war task;
- custom classpath fileset;
- local library folder `lib/`;
- environment-specific deployment target;
- shell command;
- vendor-specific app server task.

Risiko utama:

- Ant tidak punya dependency model native seperti Maven/Gradle;
- behavior banyak tersembunyi di script;
- dependency versi mungkin tidak terdokumentasi;
- output lama mungkin bergantung pada urutan copy/file timestamp;
- build bisa mencampur compile/package/deploy dalam satu target.

---

### 4.4 Java 8 ke Java 17/21/25

Ini bukan hanya upgrade JDK.

Yang berubah:

- class file version;
- removed/deprecated APIs;
- stronger encapsulation module system;
- default GC/runtime behavior;
- TLS/security defaults;
- illegal reflective access behavior;
- annotation processor compatibility;
- bytecode manipulation libraries;
- Maven/Gradle runtime compatibility;
- test framework compatibility;
- container memory ergonomics;
- Jakarta namespace migration jika ikut pindah ecosystem.

Java upgrade harus dipandang sebagai **runtime platform migration**.

---

## 5. Inventory: Langkah Pertama Sebelum Migrasi

Sebelum menulis build baru, lakukan inventory.

### 5.1 Project inventory

Catat:

```text
- daftar module
- packaging type setiap module
- public artifact yang dipublish
- internal-only module
- generated-code module
- test fixture module
- runtime application module
- plugin/custom build logic
```

### 5.2 Build command inventory

Catat command yang benar-benar dipakai:

```bash
mvn clean verify
mvn clean package -Pprod
mvn deploy -DskipTests
mvn -pl app -am test
./gradlew build
./gradlew publish
ant clean dist
```

Jangan hanya lihat file build. Lihat command CI dan release script.

### 5.3 Dependency inventory

Untuk Maven:

```bash
mvn dependency:tree -Dscope=compile
mvn dependency:tree -Dscope=runtime
mvn dependency:tree -Dscope=test
mvn help:effective-pom
```

Untuk Gradle:

```bash
./gradlew dependencies --configuration compileClasspath
./gradlew dependencies --configuration runtimeClasspath
./gradlew dependencies --configuration testRuntimeClasspath
./gradlew dependencyInsight --dependency jackson-databind --configuration runtimeClasspath
```

Untuk Ant:

```text
- list semua JAR di lib/
- cari fileset classpath
- cari environment-specific path
- cari external command
- cari copy/delete/jar/war task
```

### 5.4 Artifact inventory

Simpan artifact lama sebagai baseline:

```bash
jar tf old-app.jar > old-jar-list.txt
unzip -l old-app.war > old-war-list.txt
sha256sum old-app.jar
```

Bandingkan nanti dengan artifact baru.

---

## 6. Maven to Gradle Mapping

### 6.1 POM ke Gradle project model

Maven:

```xml
<groupId>com.example</groupId>
<artifactId>order-service</artifactId>
<version>1.0.0</version>
<packaging>jar</packaging>
```

Gradle Kotlin DSL:

```kotlin
group = "com.example"
version = "1.0.0"

plugins {
    `java-library`
}
```

Untuk application:

```kotlin
plugins {
    application
}

application {
    mainClass.set("com.example.Main")
}
```

---

### 6.2 Maven lifecycle ke Gradle tasks

Maven lifecycle:

```text
validate -> compile -> test -> package -> verify -> install -> deploy
```

Gradle biasanya:

```text
compileJava
processResources
classes
test
jar
assemble
check
build
publish
```

Mapping konseptual:

| Maven | Gradle | Catatan |
|---|---|---|
| `validate` | custom validation task / `check` dependency | Gradle tidak punya phase validate identik |
| `compile` | `compileJava` | source set aware |
| `test` | `test` | unit test default |
| `package` | `jar`, `war`, `bootJar` | packaging plugin-specific |
| `verify` | `check` | quality/test verification |
| `install` | `publishToMavenLocal` | tidak identik secara lifecycle |
| `deploy` | `publish` | butuh `maven-publish` |

Jebakan: `gradle build` tidak otomatis menjalankan semua hal yang dulu terikat ke Maven `verify`, kecuali Anda mendaftarkannya ke `check` atau `build`.

---

### 6.3 Maven scopes ke Gradle configurations

| Maven scope | Gradle equivalent | Catatan |
|---|---|---|
| `compile` | `api` atau `implementation` | library perlu pilih apakah exposed |
| `runtime` | `runtimeOnly` | hanya runtime |
| `test` | `testImplementation` / `testRuntimeOnly` | test classpath |
| `provided` | `compileOnly` | Servlet/Jakarta container API |
| `import` | `platform(...)` | BOM import |
| `optional` | tidak langsung sama | perlu API design/feature variant/metadata |

Contoh Maven:

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
</dependency>
```

Gradle:

```kotlin
dependencies {
    implementation("com.fasterxml.jackson.core:jackson-databind")
}
```

Untuk library yang expose type dari dependency:

```kotlin
dependencies {
    api("com.fasterxml.jackson.core:jackson-databind")
}
```

Kalau salah memilih `implementation` padahal public API expose type dependency tersebut, consumer bisa gagal compile.

---

### 6.4 Maven BOM ke Gradle platform

Maven:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-dependencies</artifactId>
      <version>3.4.1</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Gradle:

```kotlin
dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:3.4.1"))
    implementation("org.springframework.boot:spring-boot-starter-web")
}
```

Atau dengan Spring Boot Gradle plugin, BOM management bisa otomatis tergantung konfigurasi plugin.

---

### 6.5 Maven plugin ke Gradle plugin/task

Maven plugin execution:

```xml
<plugin>
  <groupId>org.codehaus.mojo</groupId>
  <artifactId>build-helper-maven-plugin</artifactId>
  <executions>
    <execution>
      <phase>generate-sources</phase>
      <goals>
        <goal>add-source</goal>
      </goals>
      <configuration>
        <sources>
          <source>${project.build.directory}/generated-sources/openapi</source>
        </sources>
      </configuration>
    </execution>
  </executions>
</plugin>
```

Gradle:

```kotlin
sourceSets {
    main {
        java.srcDir(layout.buildDirectory.dir("generated/sources/openapi"))
    }
}
```

Tetapi yang penting bukan sekadar source dir. Yang penting adalah task dependency:

```kotlin
tasks.named("compileJava") {
    dependsOn("openApiGenerate")
}
```

Lebih baik gunakan Provider API bila task output tersedia.

---

## 7. Gradle to Maven Mapping

### 7.1 Gradle project ke Maven POM

Gradle:

```kotlin
plugins {
    `java-library`
}

group = "com.example"
version = "1.0.0"
```

Maven:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>my-lib</artifactId>
  <version>1.0.0</version>
  <packaging>jar</packaging>
</project>
```

---

### 7.2 Gradle `api` dan `implementation` ke Maven

Gradle membedakan API exposure:

```kotlin
dependencies {
    api("com.example:public-contract:1.0.0")
    implementation("com.example:internal-helper:1.0.0")
}
```

Maven POM tidak punya konsep yang setara sempurna.

Biasanya keduanya menjadi Maven compile dependency:

```xml
<dependency>
  <groupId>com.example</groupId>
  <artifactId>public-contract</artifactId>
  <version>1.0.0</version>
</dependency>

<dependency>
  <groupId>com.example</groupId>
  <artifactId>internal-helper</artifactId>
  <version>1.0.0</version>
</dependency>
```

Konsekuensi:

- Maven consumer bisa melihat lebih banyak transitive dependency;
- encapsulation dependency lebih lemah;
- Anda mungkin perlu memecah module atau memakai optional/exclusion dengan hati-hati.

---

### 7.3 Gradle custom source set ke Maven

Gradle:

```kotlin
sourceSets {
    create("integrationTest") {
        java.srcDir("src/integrationTest/java")
        resources.srcDir("src/integrationTest/resources")
    }
}
```

Maven tidak punya source set arbitrary secara native seperti Gradle. Biasanya dipetakan ke:

- Maven Failsafe Plugin;
- Build Helper Maven Plugin;
- naming convention `*IT.java`;
- module test terpisah.

Contoh pendekatan Maven:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-failsafe-plugin</artifactId>
  <version>3.5.2</version>
  <executions>
    <execution>
      <goals>
        <goal>integration-test</goal>
        <goal>verify</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

---

### 7.4 Gradle composite build ke Maven

Gradle composite build:

```kotlin
includeBuild("../shared-lib")
```

Maven tidak memiliki padanan langsung yang sama. Alternatif:

- multi-module reactor;
- install local snapshot;
- publish snapshot ke repository internal;
- gunakan source dependency strategy di CI;
- pakai mono-repo aggregator.

Trade-off:

```text
Gradle composite build:
+ nyaman untuk local development antar repo
+ tidak harus publish local
- lebih sulit dipetakan ke Maven

Maven reactor:
+ deterministic dalam satu checkout
+ mudah dipahami CI
- kurang fleksibel untuk repo terpisah
```

---

## 8. Ant to Maven/Gradle Migration

### 8.1 Jangan langsung rewrite

Ant build sering menyimpan knowledge historis.

Contoh target Ant:

```xml
<target name="dist" depends="compile">
    <copy todir="${build.dir}/classes">
        <fileset dir="config/prod" />
    </copy>
    <jar destfile="dist/app.jar" basedir="${build.dir}/classes" />
</target>
```

Ini bukan sekadar packaging. Ada environment config `config/prod` yang ikut dimasukkan ke artifact. Itu adalah design decision, mungkin buruk, tapi harus diidentifikasi.

---

### 8.2 Inventory Ant target graph

Buat mapping:

```text
clean
  -> delete build dir
compile
  -> javac src to build/classes
resources
  -> copy config/resources
jar
  -> jar classes/resources
war
  -> assemble WEB-INF/classes and lib
deploy
  -> copy to app server
```

Lalu kelompokkan ke modern build concerns:

| Ant behavior | Maven/Gradle concern |
|---|---|
| `javac` | compile task/plugin |
| `copy resources` | resource processing |
| `jar/war` | packaging |
| `lib/*.jar` | dependency declaration |
| `deploy copy` | deployment pipeline, not build artifact |
| `replace tokens` | filtering/config boundary |
| `exec` | custom task/plugin |

---

### 8.3 Migrasi local JAR dependency

Legacy Ant sering punya:

```text
lib/ojdbc8.jar
lib/commons-lang3-3.9.jar
lib/vendor-client.jar
```

Strategi:

1. identifikasi GAV publik jika ada;
2. upload vendor/private jar ke repository internal;
3. deklarasikan dependency di Maven/Gradle;
4. hapus `lib/` dari classpath manual;
5. dokumentasikan license dan ownership.

Maven:

```xml
<dependency>
  <groupId>com.vendor</groupId>
  <artifactId>vendor-client</artifactId>
  <version>1.2.3</version>
</dependency>
```

Gradle:

```kotlin
dependencies {
    implementation("com.vendor:vendor-client:1.2.3")
}
```

Hindari `system` scope Maven kecuali benar-benar legacy emergency.

---

## 9. Java 8 to 25 Migration Strategy

### 9.1 Bedakan empat hal

Saat bicara “upgrade Java”, bedakan:

```text
1. JDK used to run build tool
2. JDK used by compiler
3. bytecode target release
4. JDK used by runtime/deployment
```

Contoh kombinasi valid:

```text
Gradle runs on JDK 21
compile with toolchain JDK 17
--release 8
tests run on JDK 17 and 21
production runtime JDK 17
```

---

### 9.2 Migration ladder

Untuk sistem besar, jangan lompat tanpa checkpoint.

Contoh ladder:

```text
Java 8 codebase
  -> build tool modernized while still targeting Java 8
  -> dependencies upgraded to Java 8-compatible latest safe versions
  -> tests stabilized
  -> run build on JDK 11/17 with --release 8
  -> runtime test on Java 17
  -> target Java 17
  -> runtime Java 21/25 compatibility check
```

Prinsip:

```text
Jangan upgrade JDK, build tool, dependency major version, framework namespace, dan deployment runtime sekaligus kecuali Anda punya test coverage dan rollback sangat kuat.
```

---

### 9.3 Common Java migration failures

#### Failure 1 — Unsupported class file major version

Gejala:

```text
Unsupported class file major version 65
```

Artinya ada class dikompilasi untuk Java 21 tetapi runtime/tool membaca dengan Java lebih lama.

Diagnosis:

```bash
javap -verbose SomeClass.class | grep "major"
java -version
mvn -version
./gradlew --version
```

---

#### Failure 2 — NoClassDefFoundError untuk JAXB

Java 8 menyertakan banyak Java EE/JAXB API di JDK. Di Java modern, banyak API tersebut tidak lagi bagian dari JDK.

Solusi konseptual:

- deklarasikan JAXB/Jakarta XML Binding dependency eksplisit;
- pastikan namespace sesuai `javax` vs `jakarta`;
- jangan mengandalkan JDK menyediakan API enterprise lama.

---

#### Failure 3 — Illegal reflective access / InaccessibleObjectException

Banyak library lama memakai reflection ke JDK internals.

Solusi:

- upgrade library;
- hindari long-term `--add-opens` sebagai solusi permanen;
- isolasi temporary JVM args di test/runtime;
- catat waiver jika belum bisa upgrade.

---

#### Failure 4 — Annotation processor tidak kompatibel

Contoh area rawan:

- Lombok;
- MapStruct;
- QueryDSL;
- Hibernate JPA metamodel;
- custom annotation processor;
- Error Prone;
- bytecode enhancement.

Jangan hanya upgrade compiler. Pastikan processor kompatibel dengan JDK compiler yang menjalankannya.

---

## 10. Build Parity Framework

### 10.1 Dependency parity

Maven baseline:

```bash
mvn dependency:tree -Dscope=runtime -DoutputFile=runtime-maven.txt
```

Gradle new build:

```bash
./gradlew dependencies --configuration runtimeClasspath > runtime-gradle.txt
```

Bandingkan:

```text
- group/name/version
- classifier
- duplicate libraries
- missing runtime dependency
- extra test dependency masuk runtime
- javax/jakarta mixed graph
```

---

### 10.2 Artifact parity

```bash
jar tf old.jar | sort > old-files.txt
jar tf new.jar | sort > new-files.txt
diff -u old-files.txt new-files.txt
```

Cek:

```text
- META-INF/MANIFEST.MF
- META-INF/services/*
- application.properties / yaml
- generated resources
- license files
- native libraries
- shaded packages
- duplicate resources
```

---

### 10.3 Bytecode parity

```bash
javap -verbose target/classes/com/example/App.class | grep "major"
```

Atau scan semua class:

```bash
find build/classes -name "*.class" -print
```

Untuk enterprise, buat script kecil untuk membaca class file major version.

---

### 10.4 Test parity

Bandingkan:

```text
- jumlah test ditemukan
- jumlah test dijalankan
- jumlah skipped
- durasi test
- failure/flaky pattern
- report path
- integration test ikut atau tidak
```

Maven Surefire/Failsafe dan Gradle Test task bisa punya discovery pattern berbeda.

---

### 10.5 Runtime parity

Minimal smoke test:

```text
- app starts
- health endpoint OK
- DB migration dry-run OK
- one endpoint/controller OK
- one repository query OK
- one external client mocked OK
- logging works
- metrics exposed
```

Build parity belum lengkap tanpa runtime smoke.

---

## 11. Maven to Gradle Migration Blueprint

### 11.1 Phase 0 — Freeze existing behavior

```bash
mvn -version
mvn help:effective-pom -Doutput=effective-pom.xml
mvn dependency:tree -DoutputFile=dependency-tree.txt
mvn clean verify
```

Simpan:

```text
- effective POM
- dependency tree
- test report
- artifact file list
- CI command
- release command
```

---

### 11.2 Phase 1 — Create Gradle skeleton

```kotlin
// settings.gradle.kts
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
    }
}

rootProject.name = "order-platform"
include("order-domain", "order-api", "order-app")
```

```kotlin
// build.gradle.kts root
plugins {
    `java-library` apply false
}

subprojects {
    group = "com.example"
    version = "1.0.0-SNAPSHOT"

    plugins.apply("java-library")

    extensions.configure<JavaPluginExtension> {
        toolchain {
            languageVersion.set(JavaLanguageVersion.of(17))
        }
    }
}
```

---

### 11.3 Phase 2 — Map dependencies

Gunakan version catalog:

```toml
# gradle/libs.versions.toml
[versions]
jackson = "2.17.2"
junit = "5.10.3"

[libraries]
jackson-databind = { module = "com.fasterxml.jackson.core:jackson-databind", version.ref = "jackson" }
junit-jupiter = { module = "org.junit.jupiter:junit-jupiter", version.ref = "junit" }
```

Build:

```kotlin
dependencies {
    implementation(libs.jackson.databind)
    testImplementation(libs.junit.jupiter)
}
```

---

### 11.4 Phase 3 — Restore test lifecycle

```kotlin
tasks.test {
    useJUnitPlatform()
}
```

Integration test:

```kotlin
val integrationTest by sourceSets.creating {
    compileClasspath += sourceSets.main.get().output + configurations.testRuntimeClasspath.get()
    runtimeClasspath += output + compileClasspath
}

val integrationTestTask = tasks.register<Test>("integrationTest") {
    description = "Runs integration tests."
    group = LifecycleBasePlugin.VERIFICATION_GROUP
    testClassesDirs = integrationTest.output.classesDirs
    classpath = integrationTest.runtimeClasspath
    shouldRunAfter(tasks.test)
    useJUnitPlatform()
}

tasks.check {
    dependsOn(integrationTestTask)
}
```

---

### 11.5 Phase 4 — Restore packaging

Plain JAR:

```kotlin
tasks.jar {
    archiveBaseName.set("order-app")
    manifest {
        attributes("Implementation-Version" to project.version)
    }
}
```

Spring Boot:

```kotlin
plugins {
    id("org.springframework.boot") version "3.4.1"
    id("io.spring.dependency-management") version "1.1.7"
}
```

---

### 11.6 Phase 5 — Restore publishing

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
            url = uri("https://repo.example.com/releases")
            credentials {
                username = providers.gradleProperty("repoUser").orNull
                password = providers.gradleProperty("repoPassword").orNull
            }
        }
    }
}
```

---

### 11.7 Phase 6 — CI parallel run

CI sementara:

```text
Stage 1: Maven build old path
Stage 2: Gradle build new path
Stage 3: compare dependency/artifact/test reports
Stage 4: publish only from old path
Stage 5: after confidence, switch publishing to new path
```

---

## 12. Gradle to Maven Migration Blueprint

### 12.1 Freeze Gradle behavior

```bash
./gradlew --version
./gradlew dependencies --configuration runtimeClasspath > runtime.txt
./gradlew build
./gradlew publishToMavenLocal
```

Simpan:

```text
- dependency reports
- generated POM if publishing
- task graph for build/release
- artifact file list
- test reports
```

---

### 12.2 Create Maven parent/aggregator

```xml
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>order-platform</artifactId>
  <version>1.0.0-SNAPSHOT</version>
  <packaging>pom</packaging>

  <modules>
    <module>order-domain</module>
    <module>order-api</module>
    <module>order-app</module>
  </modules>

  <properties>
    <maven.compiler.release>17</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
</project>
```

---

### 12.3 Restore plugin management

```xml
<build>
  <pluginManagement>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.14.0</version>
        <configuration>
          <release>${maven.compiler.release}</release>
        </configuration>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.5.2</version>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-failsafe-plugin</artifactId>
        <version>3.5.2</version>
      </plugin>
    </plugins>
  </pluginManagement>
</build>
```

---

### 12.4 Replace Gradle convention plugin

Gradle convention plugin often centralizes policy. Maven equivalent usually uses:

- parent POM;
- pluginManagement;
- dependencyManagement;
- Maven Enforcer;
- shared profile;
- corporate settings.xml;
- custom Maven plugin if logic is complex.

---

## 13. Risk Register Template

Gunakan risk register sebelum migrasi.

| Risk | Impact | Likelihood | Detection | Mitigation | Owner |
|---|---:|---:|---|---|---|
| Runtime classpath berbeda | High | Medium | dependency diff, smoke test | lock versions, compare graph | Build owner |
| Integration test tidak jalan | High | Medium | report count diff | bind Failsafe/check task | QA/build owner |
| Annotation processor hilang | High | Medium | generated source diff | configure processor path | Module owner |
| Java bytecode naik tanpa sadar | High | Medium | class major scan | enforce `--release` | Build owner |
| Release artifact layout berubah | High | Medium | jar/war diff | packaging parity test | Release owner |
| CI cache menyembunyikan error | Medium | Medium | clean build scheduled | periodic no-cache build | DevOps |
| Plugin behavior tidak sama | Medium | High | targeted tests | plugin-specific migration | Build owner |
| Secret bocor di build logs | High | Low/Med | log scan | credentials provider/masked env | DevSecOps |

---

## 14. Migration Decision Matrix

### 14.1 Kapan Maven ke Gradle masuk akal

Pertimbangkan Gradle bila:

```text
- multi-module sangat besar
- build time menjadi bottleneck signifikan
- butuh remote build cache
- banyak custom source set/codegen
- butuh composite build untuk local development
- platform team mampu maintain convention plugin
- CI graph perlu affected-module build
```

Jangan pindah ke Gradle hanya karena “lebih modern”. Gradle memberi power, tetapi power itu harus dikelola.

---

### 14.2 Kapan Gradle ke Maven masuk akal

Pertimbangkan Maven bila:

```text
- build logic terlalu custom dan tidak bisa diaudit
- organisasi butuh convention yang sangat standar
- module/library publishing sederhana
- compliance lebih nyaman dengan POM model
- tim tidak punya kapasitas maintain Gradle build logic
- variasi build tidak kompleks
```

Jangan pindah ke Maven jika build Anda sangat bergantung pada Gradle variants/composite/custom task graph kecuali Anda siap mengurangi capability.

---

### 14.3 Kapan tidak perlu migrasi

Tidak semua pain harus diselesaikan dengan migrasi.

Jika masalahnya:

```text
- dependency tidak terkontrol
- test flaky
- plugin version tidak dipin
- CI cache buruk
- artifact tidak reproducible
- module boundary kacau
```

maka Maven/Gradle migration mungkin hanya memindahkan kekacauan ke syntax baru.

Perbaiki governance lebih dulu.

---

## 15. Java Upgrade Decision Matrix

| Current | Target | Strategy |
|---|---|---|
| Java 8 app legacy | Java 17 runtime | upgrade dependencies, run build on modern JDK with `--release 8`, then target 17 |
| Java 8 library | support Java 8 consumers | keep `--release 8`, test on 8/11/17/21/25 if feasible |
| Java 11 service | Java 21 | update build tool/plugins, test reflection/security, then runtime uplift |
| Java 17 service | Java 21/25 | usually smaller, but check agents, bytecode libs, annotation processors |
| Jakarta EE app | modern Jakarta | handle javax→jakarta namespace separately from Java upgrade |

---

## 16. Migration Testing Strategy

### 16.1 Test categories

```text
Build-level:
- clean build
- incremental build
- no-cache build
- offline build if required

Artifact-level:
- jar/war content diff
- manifest check
- dependency graph diff

Runtime-level:
- smoke start
- endpoint check
- integration test
- app server deploy test

Release-level:
- publish to staging repo
- consume published artifact from sample project
- verify signing/checksum/SBOM
```

---

### 16.2 Consumer test

Untuk library migration, consumer test penting.

Buat sample consumer:

```text
sample-consumer-maven
sample-consumer-gradle
```

Test:

```text
- can resolve artifact
- can compile against public API
- runtime dependency complete
- no unwanted dependency leaks
```

Ini menangkap masalah yang tidak terlihat dari module itu sendiri.

---

## 17. CI Rollout Pattern

### 17.1 Shadow build

```text
Old build: blocking
New build: non-blocking
```

Tujuannya mengumpulkan data failure tanpa menghentikan delivery.

### 17.2 Dual build

```text
Old build: blocking
New build: blocking for selected branches/modules
```

### 17.3 Switch build

```text
New build: blocking and publishing
Old build: fallback/manual only
```

### 17.4 Decommission

```text
Old build removed
Docs updated
CI scripts removed
Team trained
Runbook updated
```

---

## 18. Common Anti-Patterns

### Anti-pattern 1 — Syntax translation migration

Mengubah XML ke Kotlin DSL tanpa memahami lifecycle.

Akibat:

- test hilang;
- generated code tidak compile;
- artifact berubah;
- release rusak.

---

### Anti-pattern 2 — Big bang migration

Semua berubah sekaligus:

```text
Maven -> Gradle
Java 8 -> 21
Spring Boot 2 -> 3
javax -> jakarta
JUnit 4 -> 5
CI image changed
repository changed
```

Kalau gagal, root cause hampir mustahil dipersempit.

---

### Anti-pattern 3 — No artifact comparison

“Build green” dianggap cukup.

Padahal artifact bisa berbeda.

---

### Anti-pattern 4 — Keep both builds forever

Dual build permanen mahal dan rawan drift.

Jika kedua build dipertahankan, harus ada aturan:

```text
- siapa source of truth
- kapan update keduanya
- bagaimana parity diuji
- kapan salah satu dihapus
```

---

### Anti-pattern 5 — Over-custom Gradle build

Gradle memberi kebebasan, tetapi build script yang terlalu imperative membuat setiap module menjadi sistem unik.

Gunakan convention plugin.

---

### Anti-pattern 6 — Corporate parent POM terlalu memaksa

Maven governance bisa terlalu kaku.

Jika parent POM mengatur semua hal tanpa extension point, tim akan membuat workaround.

Governance harus punya exception mechanism.

---

## 19. Troubleshooting Migration Failures

### 19.1 Build lama sukses, build baru compile gagal

Kemungkinan:

```text
- source dir belum termap
- generated source belum ditambahkan
- annotation processor belum aktif
- dependency scope/configuration salah
- Java release berbeda
- resource generated class tidak ada
```

Diagnosis:

```bash
# Maven
mvn -X compile
mvn dependency:tree

# Gradle
./gradlew compileJava --info
./gradlew dependencies --configuration compileClasspath
```

---

### 19.2 Compile sukses, test gagal

Kemungkinan:

```text
- test resource tidak masuk
- test dependency hilang
- JUnit engine tidak aktif
- integration test masuk unit test
- system properties berbeda
- timezone/locale berbeda
```

---

### 19.3 Test sukses, runtime gagal

Kemungkinan:

```text
- runtimeOnly dependency hilang
- provided/compileOnly salah
- service loader metadata tidak masuk
- resource filtering berubah
- shaded relocation salah
- manifest/main class salah
```

---

### 19.4 Runtime sukses lokal, CI gagal

Kemungkinan:

```text
- JDK CI berbeda
- cache stale
- environment variable tidak tersedia
- repository credential berbeda
- file path case sensitivity
- timezone/locale berbeda
- network/proxy repository issue
```

---

## 20. Practical Checklists

### 20.1 Pre-migration checklist

```text
[ ] Existing build commands documented
[ ] Existing CI/release commands documented
[ ] Effective POM or Gradle dependency reports captured
[ ] Artifact baseline captured
[ ] Test report baseline captured
[ ] Java version and bytecode target documented
[ ] Plugin versions documented
[ ] Repository settings documented
[ ] Generated source pipeline documented
[ ] Release/publish process documented
[ ] Rollback plan defined
```

---

### 20.2 During migration checklist

```text
[ ] Keep old build working
[ ] Add new build in parallel
[ ] Do not upgrade unrelated frameworks unnecessarily
[ ] Map dependency scopes/configurations explicitly
[ ] Restore generated source pipeline
[ ] Restore test lifecycle
[ ] Restore packaging
[ ] Restore quality gates
[ ] Restore publishing
[ ] Compare dependency graph
[ ] Compare artifact content
[ ] Run smoke test
[ ] Run CI shadow build
```

---

### 20.3 Post-migration checklist

```text
[ ] New build is source of truth
[ ] Old build removed or clearly deprecated
[ ] CI uses new build for release
[ ] Documentation updated
[ ] Team trained
[ ] Build troubleshooting runbook updated
[ ] Dependency update process updated
[ ] Security scanning still active
[ ] SBOM/provenance still generated
[ ] Release rollback tested
[ ] Metrics monitored for at least one release cycle
```

---

## 21. Top 1% Mental Model

A top-level engineer treats migration as a controlled state transition:

```text
Current build state
  + known behavior
  + known artifact
  + known risks

Transition plan
  + explicit invariants
  + parity proof
  + staged rollout
  + rollback path

Target build state
  + documented behavior
  + governed dependencies
  + reproducible artifact
  + observable CI
  + maintainable ownership
```

The goal is not “we use Gradle” or “we use Maven”.

The goal is:

```text
We can produce, test, verify, publish, and reproduce trusted Java artifacts across Java versions with predictable behavior and controlled change.
```

That is migration engineering.

---

## 22. Ringkasan

Bagian ini membahas migrasi build dan Java baseline sebagai engineering discipline:

- migrasi build adalah perubahan supply chain;
- invariants harus didefinisikan sebelum tool diganti;
- Maven dan Gradle tidak memiliki mapping 1:1 penuh;
- Ant migration membutuhkan archaeology, bukan sekadar rewrite;
- Java 8→25 migration harus membedakan build JDK, compile JDK, bytecode target, dan runtime JDK;
- parity proof lebih penting daripada build green;
- CI rollout harus phased;
- rollback path harus tersedia;
- dual build tidak boleh dibiarkan drift tanpa ownership;
- top engineer memigrasikan sistem dengan evidence, bukan feeling.

---

## 23. Referensi Lanjutan

- Apache Maven — Introduction to the Build Lifecycle: https://maven.apache.org/guides/introduction/introduction-to-the-lifecycle.html
- Apache Maven — Guide to Working with Multiple Modules: https://maven.apache.org/guides/mini/guide-multiple-modules.html
- Apache Maven — Dependency Mechanism: https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html
- Apache Maven — Maven Compiler Plugin: https://maven.apache.org/plugins/maven-compiler-plugin/
- Apache Maven — Maven Failsafe Plugin: https://maven.apache.org/surefire/maven-failsafe-plugin/
- Gradle User Manual — Migrating from Maven: https://docs.gradle.org/current/userguide/migrating_from_maven.html
- Gradle User Manual — Multi-Project Builds: https://docs.gradle.org/current/userguide/multi_project_builds.html
- Gradle User Manual — Java Toolchains: https://docs.gradle.org/current/userguide/toolchains.html
- Gradle User Manual — Dependency Management: https://docs.gradle.org/current/userguide/dependency_management.html
- Gradle User Manual — Publishing Maven Publications: https://docs.gradle.org/current/userguide/publishing_maven.html
- Oracle javac documentation: https://docs.oracle.com/en/java/javase/23/docs/specs/man/javac.html
- OpenJDK JEP index: https://openjdk.org/jeps/0
