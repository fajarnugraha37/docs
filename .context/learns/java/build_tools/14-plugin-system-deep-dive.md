# Part 14 — Plugin System Deep Dive: Maven Plugin Anatomy dan Gradle Plugin Anatomy

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `14-plugin-system-deep-dive.md`  
> Target: Java 8–25, Maven, Gradle, enterprise build engineering

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas resource processing, profiles, properties, dan environment separation. Sekarang kita masuk ke salah satu bagian yang membedakan engineer biasa dengan build/platform engineer yang matang: **plugin system**.

Sebagian besar developer memakai plugin sebagai konfigurasi:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <version>...</version>
</plugin>
```

atau:

```kotlin
plugins {
    java
    id("org.springframework.boot") version "..."
}
```

Tetapi top engineer tidak hanya bertanya:

> Plugin apa yang harus dipasang?

Mereka bertanya:

> Apa kontrak plugin ini terhadap lifecycle, graph, input/output, dependency resolution, classpath, artifact, cache, security, dan CI determinism?

Plugin adalah cara build system diperluas. Karena itu, plugin adalah **power amplifier** sekaligus **risk amplifier**. Plugin yang baik membuat ratusan project konsisten. Plugin yang buruk membuat build lambat, non-deterministic, sulit di-debug, dan berisiko supply-chain.

Tujuan bagian ini:

1. memahami plugin sebagai extension mechanism, bukan sekadar potongan konfigurasi;
2. memahami anatomi plugin Maven: goal, Mojo, parameter, descriptor, lifecycle binding, execution;
3. memahami anatomi plugin Gradle: Plugin class, task, extension, Provider API, convention plugin, binary plugin;
4. mengetahui kapan cukup memakai plugin, kapan mengonfigurasi plugin, kapan membuat custom plugin;
5. memahami failure mode plugin di build enterprise;
6. membangun mental model untuk membaca plugin behavior tanpa bergantung pada trial-and-error.

---

## 1. Plugin Sebagai Extension Boundary

Build system core tidak mungkin tahu semua kebutuhan project:

- compile Java;
- run test;
- generate OpenAPI client;
- generate protobuf;
- run database migration;
- package Spring Boot JAR;
- build Docker image;
- publish artifact;
- generate SBOM;
- scan vulnerability;
- enforce dependency policy;
- validate license;
- sign release artifact.

Karena itu build system menyediakan extension mechanism.

Plugin berfungsi untuk:

1. menambahkan task/goal baru;
2. mengikat pekerjaan ke lifecycle/graph;
3. menambahkan DSL/configuration model;
4. memodifikasi dependency resolution;
5. menghasilkan artifact;
6. menjalankan analysis/check;
7. menyediakan convention lintas project.

Plugin bukan hanya utility. Plugin adalah **kode yang ikut menentukan hasil build**.

Konsekuensinya:

- plugin harus versioned;
- plugin harus trusted;
- plugin harus reproducible;
- plugin harus observable;
- plugin harus predictable;
- plugin harus compatible dengan Java/build tool version;
- plugin harus punya boundary yang jelas.

---

## 2. Mental Model: Build Core vs Plugin

Bayangkan build system sebagai kernel kecil.

```text
Build System Core
├─ model project
├─ lifecycle / graph engine
├─ dependency resolution
├─ task/goal execution engine
├─ logging/reporting
├─ cache/up-to-date engine
└─ plugin loading mechanism

Plugins
├─ compiler plugin
├─ test plugin
├─ package plugin
├─ publish plugin
├─ quality plugin
├─ codegen plugin
├─ security plugin
└─ custom enterprise policy plugin
```

Core memberi aturan eksekusi. Plugin memberi pekerjaan spesifik.

Perbedaan besar Maven dan Gradle:

```text
Maven:
  Core menyediakan lifecycle tetap.
  Plugin menyediakan goals.
  Goals diikat ke phases.
  POM mengonfigurasi plugin executions.

Gradle:
  Core menyediakan task graph engine.
  Plugin menambahkan tasks/extensions/configurations/conventions.
  Build script/plugin membentuk graph.
  Task dependency menentukan execution order.
```

Dengan kata lain:

```text
Maven plugin = goal provider for lifecycle phases
Gradle plugin = graph/DSL/model contributor
```

---

## 3. Plugin Sebagai Contract

Plugin punya beberapa kontrak penting.

### 3.1 Execution Contract

Kapan plugin berjalan?

Maven:

- langsung via `mvn plugin:goal`;
- otomatis karena default lifecycle binding;
- otomatis karena execution di POM bound ke phase.

Gradle:

- task dijalankan eksplisit: `gradle myTask`;
- task menjadi dependency task lain;
- plugin menambahkan task lifecycle seperti `check`, `build`, `assemble`;
- task graph menentukan apakah task masuk execution plan.

### 3.2 Input Contract

Apa input plugin?

- source files;
- resources;
- classpath;
- configuration values;
- generated files;
- system properties;
- environment variables;
- remote metadata;
- repository credentials;
- toolchain/JDK;
- plugin dependencies.

### 3.3 Output Contract

Apa output plugin?

- compiled classes;
- generated source;
- reports;
- JAR/WAR/EAR;
- test result;
- coverage XML;
- SBOM;
- published artifact;
- modified metadata;
- local cache entries.

### 3.4 Ordering Contract

Plugin jarang hidup sendiri. Ia bergantung pada urutan.

Contoh:

```text
generate-sources -> compile -> test-compile -> test -> package -> verify
```

Jika codegen berjalan setelah compile, build gagal. Jika shading berjalan sebelum artifact lengkap, artifact rusak. Jika coverage report berjalan sebelum test, report kosong.

### 3.5 Isolation Contract

Plugin seharusnya tidak sembarangan:

- mengubah file di luar build directory;
- membaca environment tanpa deklarasi;
- memodifikasi dependency graph diam-diam;
- memakai network saat release build tanpa kontrol;
- menulis output yang tidak deterministic;
- membuat task selalu out-of-date.

Plugin yang melanggar isolation membuat build sulit dipercaya.

---

## 4. Maven Plugin System — Gambaran Besar

Maven plugin adalah artifact Java yang berisi satu atau lebih **goals**. Goal diimplementasikan oleh class yang disebut **Mojo**.

Maven resmi mendeskripsikan plugin descriptor sebagai metadata plugin yang disimpan di `META-INF/maven/plugin.xml`, biasanya digenerate dari source plugin oleh Maven Plugin Plugin. Dokumentasi Maven juga menunjukkan bahwa plugin Java dibangun dengan Mojo dan goal yang dapat dieksekusi dari command line atau diikat ke lifecycle. citeturn245511search0turn245511search1

Struktur mental:

```text
Maven Plugin Artifact
├─ groupId
├─ artifactId
├─ version
├─ META-INF/maven/plugin.xml
└─ Mojo classes
   ├─ goal A
   ├─ goal B
   └─ goal C
```

Contoh plugin umum:

```text
maven-compiler-plugin
├─ compile goal
└─ testCompile goal

maven-surefire-plugin
└─ test goal

maven-failsafe-plugin
├─ integration-test goal
└─ verify goal

maven-jar-plugin
└─ jar goal

maven-deploy-plugin
└─ deploy goal
```

Maven build bukan menjalankan plugin secara acak. Maven menjalankan lifecycle phase, lalu goal plugin yang bound ke phase tersebut.

---

## 5. Maven: Lifecycle, Phase, Goal, Mojo, Execution

Istilah ini harus benar-benar jelas.

### 5.1 Lifecycle

Lifecycle adalah rangkaian phase.

Maven punya lifecycle built-in utama:

- `default`;
- `clean`;
- `site`.

Dokumentasi Maven menyebut tiga built-in lifecycle tersebut: `default` untuk project deployment, `clean` untuk membersihkan project, dan `site` untuk membuat site project. citeturn245511search7

### 5.2 Phase

Phase adalah checkpoint dalam lifecycle.

Contoh default lifecycle:

```text
validate
compile
test
package
verify
install
deploy
```

Saat menjalankan:

```bash
mvn package
```

Maven menjalankan semua phase dari awal sampai `package`.

### 5.3 Goal

Goal adalah unit pekerjaan yang disediakan plugin.

Contoh:

```bash
mvn compiler:compile
mvn surefire:test
mvn jar:jar
mvn dependency:tree
```

Format umum:

```text
plugin-prefix:goal
```

### 5.4 Mojo

Mojo adalah class Java yang mengimplementasikan goal. Maven Plugin Tools menyediakan annotation `@Mojo` untuk menandai class sebagai goal dalam Maven plugin. citeturn245511search6

Contoh konseptual:

```java
@Mojo(name = "validate-policy", defaultPhase = LifecyclePhase.VALIDATE)
public class ValidatePolicyMojo extends AbstractMojo {
    @Parameter(property = "policy.strict", defaultValue = "true")
    private boolean strict;

    public void execute() throws MojoExecutionException {
        getLog().info("Validating enterprise policy...");
    }
}
```

### 5.5 Execution

Execution adalah konfigurasi binding goal ke phase.

Contoh:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-antrun-plugin</artifactId>
  <version>3.1.0</version>
  <executions>
    <execution>
      <id>echo-during-validate</id>
      <phase>validate</phase>
      <goals>
        <goal>run</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

Artinya:

```text
Saat phase validate dijalankan,
jalankan goal antrun:run dengan execution id echo-during-validate.
```

---

## 6. Maven Plugin Binding

Ada dua jenis binding penting.

### 6.1 Default Lifecycle Binding

Maven punya default binding berdasarkan packaging.

Misalnya project `jar` biasanya mengikat:

```text
compile       -> maven-compiler-plugin:compile
test-compile  -> maven-compiler-plugin:testCompile
test          -> maven-surefire-plugin:test
package       -> maven-jar-plugin:jar
install       -> maven-install-plugin:install
deploy        -> maven-deploy-plugin:deploy
```

Jadi ketika kita menjalankan:

```bash
mvn package
```

Maven tahu goal apa yang harus dijalankan karena packaging memberi binding default.

### 6.2 Explicit Plugin Execution

Kita bisa menambahkan binding sendiri.

Contoh code generation:

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
        <inputSpec>${project.basedir}/src/main/openapi/api.yaml</inputSpec>
        <generatorName>java</generatorName>
      </configuration>
    </execution>
  </executions>
</plugin>
```

Ini mengikat codegen ke `generate-sources`, sehingga generated source tersedia sebelum compile.

---

## 7. Maven Plugin Configuration Model

Maven plugin biasanya dikonfigurasi melalui:

```xml
<configuration>
  ...
</configuration>
```

Ada beberapa level konfigurasi.

### 7.1 Plugin-Level Configuration

```xml
<plugin>
  <artifactId>maven-compiler-plugin</artifactId>
  <version>${maven-compiler-plugin.version}</version>
  <configuration>
    <release>21</release>
    <parameters>true</parameters>
  </configuration>
</plugin>
```

Konfigurasi berlaku untuk semua goal/execution plugin tersebut, kecuali dioverride.

### 7.2 Execution-Level Configuration

```xml
<execution>
  <id>compile-main</id>
  <goals>
    <goal>compile</goal>
  </goals>
  <configuration>
    <release>17</release>
  </configuration>
</execution>
```

Konfigurasi lebih spesifik untuk execution tertentu.

### 7.3 Plugin Management

`pluginManagement` tidak otomatis menjalankan plugin. Ia menyediakan default version/configuration untuk child module.

Maven menekankan praktik baik untuk menentukan version setiap build plugin di `<pluginManagement>` untuk menjamin reproducibility. citeturn245511search3

Contoh:

```xml
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
    </plugins>
  </pluginManagement>
</build>
```

Child module tetap perlu menggunakan plugin jika ingin execution khusus. Tetapi version/configuration bisa diwarisi.

---

## 8. Maven Plugin Classpath dan Isolation

Maven plugin berjalan dengan classpath plugin sendiri, berbeda dari dependency project.

Ini penting.

```text
Project Dependencies
├─ application libraries
├─ test libraries
└─ runtime libraries

Plugin Dependencies
├─ plugin implementation classes
├─ plugin internal libraries
└─ plugin-specific dependencies
```

Plugin dependency bisa ditambahkan di dalam plugin declaration:

```xml
<plugin>
  <groupId>some.group</groupId>
  <artifactId>some-plugin</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>some.group</groupId>
      <artifactId>plugin-extension</artifactId>
      <version>1.2.3</version>
    </dependency>
  </dependencies>
</plugin>
```

Jangan keliru:

```text
<dependencies> di root project = dependency aplikasi
<dependencies> di dalam <plugin> = dependency plugin execution
```

Failure mode umum:

- plugin butuh library versi tertentu;
- developer menaruh dependency di project dependencies, bukan plugin dependencies;
- plugin tidak melihat class yang diharapkan;
- build gagal dengan `ClassNotFoundException` atau `NoSuchMethodError` saat plugin execution.

---

## 9. Maven Plugin Prefix Resolution

Ketika menjalankan:

```bash
mvn dependency:tree
```

Maven harus mengetahui bahwa prefix `dependency` merujuk ke:

```text
org.apache.maven.plugins:maven-dependency-plugin
```

Prefix resolution bisa berasal dari metadata plugin group dan repository.

Untuk plugin internal enterprise, kadang perlu menambahkan plugin group di `settings.xml`:

```xml
<pluginGroups>
  <pluginGroup>com.company.maven.plugins</pluginGroup>
</pluginGroups>
```

Tetapi dalam build CI/release, lebih aman menjalankan plugin dengan koordinat eksplisit saat diperlukan:

```bash
mvn com.company.maven.plugins:policy-plugin:1.4.0:validate-policy
```

Atau deklarasikan plugin di POM dengan version jelas.

---

## 10. Maven Plugin Anti-Patterns

### 10.1 Plugin Version Tidak Dipin

Buruk:

```xml
<plugin>
  <artifactId>maven-compiler-plugin</artifactId>
</plugin>
```

Risiko:

- version berasal dari super POM/default Maven version;
- hasil berubah saat Maven version berubah;
- CI dan local bisa beda;
- reproducibility lemah.

Lebih baik:

```xml
<pluginManagement>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-compiler-plugin</artifactId>
      <version>${maven-compiler-plugin.version}</version>
    </plugin>
  </plugins>
</pluginManagement>
```

### 10.2 Execution ID Tidak Jelas

Buruk:

```xml
<execution>
  <id>default</id>
</execution>
```

Lebih baik:

```xml
<execution>
  <id>generate-openapi-client</id>
</execution>
```

Execution ID harus menjawab:

> pekerjaan apa ini dan kenapa ada?

### 10.3 Binding ke Phase yang Salah

Contoh buruk:

```xml
<phase>compile</phase>
```

untuk generated source.

Seharusnya:

```xml
<phase>generate-sources</phase>
```

Karena source harus digenerate sebelum compile.

### 10.4 Plugin Mengubah Source Directory

Plugin sebaiknya output ke:

```text
target/generated-sources/...
target/generated-test-sources/...
target/reports/...
```

Bukan menulis ke:

```text
src/main/java
src/test/java
```

Generated output di source directory membuat repository kotor, merge conflict, dan determinism lemah.

### 10.5 Plugin Mengandalkan Environment Implisit

Buruk:

```text
Plugin membaca JAVA_HOME, HOME, PATH, AWS_PROFILE, atau local file tanpa dokumentasi.
```

Lebih baik:

- parameter eksplisit;
- toolchains;
- CI secret injection;
- fail-fast jika config tidak tersedia;
- no network by default saat release build.

---

## 11. Gradle Plugin System — Gambaran Besar

Gradle plugin adalah kode yang diterapkan ke `Project`, `Settings`, atau Gradle instance untuk menambahkan build logic.

Gradle plugin bisa:

- menambahkan task;
- menambahkan extension DSL;
- menambahkan configurations;
- menambahkan dependencies;
- mengonfigurasi existing plugins;
- membuat convention;
- mempublikasikan artifact;
- mengatur toolchain;
- menghubungkan tasks ke lifecycle task seperti `build`, `check`, `assemble`.

Dokumentasi Gradle mendeskripsikan convention plugin sebagai plugin, sering berupa precompiled script plugin, yang mengonfigurasi core/community plugins dengan convention/default organisasi, dan dapat apply/configure plugins, membuat tasks/extensions, serta menetapkan dependencies. citeturn245511search4turn245511search14

Mental model:

```text
Gradle Plugin
├─ apply(Project)
├─ register extensions
├─ register tasks lazily
├─ configure tasks/providers
├─ configure dependencies/configurations
├─ connect tasks to lifecycle tasks
└─ expose convention to build users
```

---

## 12. Gradle Plugin Types

Ada beberapa bentuk plugin Gradle.

### 12.1 Core Plugin

Plugin bawaan Gradle.

Contoh:

```kotlin
plugins {
    java
    `java-library`
    `maven-publish`
}
```

### 12.2 Community Plugin

Plugin dari Gradle Plugin Portal atau repository lain.

Contoh:

```kotlin
plugins {
    id("org.springframework.boot") version "..."
    id("com.diffplug.spotless") version "..."
}
```

### 12.3 Script Plugin

File Gradle biasa yang di-apply.

```kotlin
apply(from = "gradle/common-java.gradle.kts")
```

Ini mudah, tetapi kurang ideal untuk enterprise karena:

- tidak typed sekuat binary/precompiled plugin;
- lebih sulit dites;
- lebih mudah bergantung pada urutan apply;
- bisa menjadi dumping ground.

### 12.4 Precompiled Script Plugin

Build logic ditulis seperti build script, tapi dikompilasi menjadi plugin.

Contoh lokasi:

```text
build-logic/src/main/kotlin/company.java-conventions.gradle.kts
```

Dipakai:

```kotlin
plugins {
    id("company.java-conventions")
}
```

Cocok untuk convention plugin.

### 12.5 Binary Plugin

Plugin ditulis dengan Kotlin/Java/Groovy sebagai class.

Contoh:

```kotlin
class CompanyJavaPlugin : Plugin<Project> {
    override fun apply(project: Project) {
        project.pluginManager.apply("java-library")
    }
}
```

Cocok untuk build logic kompleks, reusable, testable, dan publishable.

Gradle Java Gradle Plugin development plugin membantu pengembangan plugin Gradle, menerapkan Java Library plugin, menambahkan `gradleApi()` dependency, dan melakukan validasi metadata plugin saat `jar`. citeturn245511search5

---

## 13. Gradle Plugin Anatomy

Plugin minimal:

```kotlin
import org.gradle.api.Plugin
import org.gradle.api.Project

class CompanyJavaConventionsPlugin : Plugin<Project> {
    override fun apply(project: Project) {
        project.pluginManager.apply("java-library")

        project.tasks.withType(JavaCompile::class.java).configureEach {
            options.compilerArgs.add("-Xlint:all")
        }
    }
}
```

Tetapi plugin matang biasanya punya:

```text
Plugin class
├─ extension model
├─ task registrations
├─ conventions/defaults
├─ validation
├─ integration with lifecycle tasks
├─ dependency/configuration setup
├─ provider-based lazy wiring
└─ tests
```

---

## 14. Gradle Extension Model

Extension adalah DSL yang dipakai user untuk mengonfigurasi plugin.

Contoh pemakaian:

```kotlin
companyJava {
    javaVersion.set(21)
    warningsAsErrors.set(true)
}
```

Extension class:

```kotlin
abstract class CompanyJavaExtension @Inject constructor(objects: ObjectFactory) {
    val javaVersion: Property<Int> = objects.property(Int::class.java)
    val warningsAsErrors: Property<Boolean> = objects.property(Boolean::class.java)
}
```

Plugin:

```kotlin
class CompanyJavaPlugin : Plugin<Project> {
    override fun apply(project: Project) {
        val extension = project.extensions.create(
            "companyJava",
            CompanyJavaExtension::class.java
        )

        extension.javaVersion.convention(21)
        extension.warningsAsErrors.convention(true)
    }
}
```

Mengapa pakai `Property<T>` dan Provider API?

Karena Gradle modern mendorong lazy configuration:

- nilai bisa belum final saat plugin apply;
- task bisa dikonfigurasi tanpa langsung direalisasi;
- configuration cache lebih aman;
- task input bisa dilacak;
- plugin tidak memaksa eager evaluation.

---

## 15. Gradle Task Model di Plugin

Gradle custom task yang baik mendeklarasikan input/output.

Dokumentasi Gradle menjelaskan custom actionable task dibuat dengan extend `DefaultTask` dan mendefinisikan inputs, outputs, dan actions. citeturn245511search12

Contoh:

```kotlin
abstract class ValidateDependencyPolicyTask : DefaultTask() {

    @get:InputFile
    abstract val policyFile: RegularFileProperty

    @get:InputFiles
    abstract val dependencyLockFiles: ConfigurableFileCollection

    @get:OutputFile
    abstract val reportFile: RegularFileProperty

    @TaskAction
    fun validate() {
        val report = reportFile.get().asFile
        report.parentFile.mkdirs()
        report.writeText("Dependency policy valid\n")
    }
}
```

Register task secara lazy:

```kotlin
val validatePolicy = project.tasks.register(
    "validateDependencyPolicy",
    ValidateDependencyPolicyTask::class.java
) {
    policyFile.set(project.layout.projectDirectory.file("gradle/dependency-policy.yml"))
    dependencyLockFiles.from(project.layout.projectDirectory.file("gradle.lockfile"))
    reportFile.set(project.layout.buildDirectory.file("reports/dependency-policy.txt"))
}

project.tasks.named("check") {
    dependsOn(validatePolicy)
}
```

Prinsip:

```text
Plugin should register, not realize.
Plugin should wire providers, not concrete values too early.
Plugin should declare inputs/outputs.
```

---

## 16. Gradle Plugin Application Order

Plugin sering bergantung pada plugin lain.

Buruk:

```kotlin
project.tasks.named("compileJava") { ... }
```

Jika Java plugin belum diterapkan, task tidak ada.

Lebih baik:

```kotlin
project.pluginManager.withPlugin("java") {
    project.tasks.named("compileJava", JavaCompile::class.java) {
        options.compilerArgs.add("-Xlint:all")
    }
}
```

Atau plugin kita apply Java plugin sendiri:

```kotlin
project.pluginManager.apply("java-library")
```

Decision:

```text
Jika plugin kita adalah convention plugin Java -> apply java/java-library.
Jika plugin kita optional integration -> pakai withPlugin.
```

---

## 17. Gradle Lifecycle Tasks dan Plugin Wiring

Gradle punya lifecycle tasks seperti:

```text
assemble
check
build
clean
```

Plugin sebaiknya menghubungkan task ke lifecycle yang tepat.

Contoh:

```kotlin
project.tasks.named("check") {
    dependsOn(validatePolicy)
}
```

Artinya:

```text
Setiap gradle check/build menjalankan validateDependencyPolicy.
```

Jangan menghubungkan task berat ke lifecycle yang terlalu sering tanpa alasan.

Contoh buruk:

```text
generateLargeReport selalu ikut build lokal, padahal hanya perlu saat release.
```

Lebih baik:

```text
check -> fast validation
releaseCheck -> heavy validation
publish -> releaseCheck
```

---

## 18. Maven vs Gradle Plugin: Perbedaan Fundamental

| Aspek | Maven | Gradle |
|---|---|---|
| Eksekusi utama | lifecycle phase | task graph |
| Unit kerja plugin | goal/Mojo | task/action/model contribution |
| Konfigurasi | XML model | DSL/programmatic model |
| Default behavior | packaging lifecycle binding | plugin-applied task graph |
| Reuse convention | parent POM/pluginManagement | convention plugin/precompiled/binary plugin |
| Lazy model | terbatas | sangat penting |
| Input/output tracking | plugin-specific | first-class task model |
| Cacheability | tidak sekuat Gradle task cache model | built-in task up-to-date/cache model |
| Complexity risk | hidden lifecycle binding | arbitrary code/configuration phase side effect |

Maven plugin biasanya menjawab:

> Goal apa yang dijalankan di phase apa?

Gradle plugin biasanya menjawab:

> Model, task, dependency, dan convention apa yang ditambahkan ke graph?

---

## 19. Plugin as Enterprise Governance

Di enterprise, plugin bukan hanya helper. Plugin adalah governance enforcement.

Contoh policy:

- semua module harus pakai Java toolchain tertentu;
- semua dependency harus berasal dari repository internal;
- plugin version harus dipin;
- SNAPSHOT dependency dilarang saat release;
- license tertentu dilarang;
- artifact harus punya SBOM;
- test report wajib dipublish;
- generated code harus masuk build directory;
- Docker image harus punya label standard;
- manifest harus punya build metadata;
- semua service harus expose `/actuator/health` smoke test.

Maven approach:

```text
corporate-parent-pom
├─ pluginManagement
├─ dependencyManagement
├─ maven-enforcer-plugin
├─ build profiles
└─ standard executions
```

Gradle approach:

```text
build-logic / convention plugins
├─ company.java-library
├─ company.spring-boot-service
├─ company.quality-gates
├─ company.publishing
├─ company.security
└─ company.release
```

Gradle convention plugin biasanya lebih fleksibel untuk enterprise build logic kompleks. Maven parent POM lebih sederhana untuk standard lifecycle policy.

---

## 20. Kapan Cukup Konfigurasi Plugin, Kapan Membuat Plugin?

Gunakan konfigurasi biasa jika:

- hanya satu project;
- konfigurasi pendek;
- tidak ada branching logic;
- tidak perlu reuse;
- tidak perlu test build logic;
- tidak perlu enforce standard lintas team.

Gunakan parent POM/convention plugin jika:

- konfigurasi diulang di banyak module;
- version policy harus dikendalikan centrally;
- perlu default enterprise;
- perlu mengurangi copy-paste;
- perlu upgrade serentak.

Buat custom plugin jika:

- logic procedural mulai besar;
- perlu task custom;
- perlu validasi custom;
- perlu input/output/cacheability;
- perlu test build logic;
- perlu publish internal;
- perlu integrasi dengan API eksternal/internal;
- perlu enforce rule yang tidak tersedia di plugin existing.

Red flag build script harus diekstrak menjadi plugin:

```text
- build.gradle.kts > 300 baris dan banyak logic if/else
- root POM berisi execution kompleks yang disalin ke banyak repo
- banyak subproject punya konfigurasi hampir sama
- build behavior berubah tergantung urutan apply
- CI punya script tambahan untuk menambal build tool
- policy organisasi ada di wiki, bukan di build
```

---

## 21. Plugin Versioning Strategy

Plugin adalah dependency build. Maka plugin harus di-version seperti production dependency.

### 21.1 Maven

Pin plugin version di parent:

```xml
<properties>
  <maven.compiler.plugin.version>3.14.1</maven.compiler.plugin.version>
  <maven.surefire.plugin.version>3.5.3</maven.surefire.plugin.version>
</properties>

<build>
  <pluginManagement>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>${maven.compiler.plugin.version}</version>
      </plugin>
    </plugins>
  </pluginManagement>
</build>
```

### 21.2 Gradle

Pin plugin version di `settings.gradle.kts`:

```kotlin
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        maven("https://repo.company.example/gradle-plugins")
    }
}
```

Atau via version catalog:

```toml
[plugins]
spring-boot = { id = "org.springframework.boot", version = "3.5.0" }
spotless = { id = "com.diffplug.spotless", version = "7.0.0" }
```

Dipakai:

```kotlin
plugins {
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.spotless)
}
```

### 21.3 Internal Plugin Versioning

Untuk plugin internal:

```text
company-build-logic:1.0.0
company-build-logic:1.1.0
company-build-logic:2.0.0
```

Gunakan semantic versioning jika plugin dipakai banyak repo.

Breaking change contoh:

- task name berubah;
- extension property berubah;
- default Java version berubah;
- plugin mulai fail build untuk policy baru;
- output path berubah;
- published artifact metadata berubah.

---

## 22. Plugin Security Model

Plugin punya akses besar:

- membaca file project;
- membaca environment;
- mengakses network;
- menjalankan process;
- menulis artifact;
- mempublikasikan ke repository;
- membaca credentials;
- memodifikasi dependency graph.

Jadi plugin adalah supply-chain risk.

Checklist security:

```text
[ ] Plugin berasal dari source trusted?
[ ] Version dipin?
[ ] Checksum/signature diverifikasi?
[ ] Plugin repository dikendalikan?
[ ] Plugin update direview?
[ ] Plugin punya CVE history?
[ ] Plugin membaca secret?
[ ] Plugin melakukan network call saat build?
[ ] Plugin menjalankan executable eksternal?
[ ] Plugin output deterministic?
[ ] Plugin bisa dipakai offline?
```

Jangan menganggap plugin “aman” hanya karena populer.

Risk pattern:

```text
Unpinned plugin version
+ public plugin repository
+ CI credential access
+ publish token
= supply-chain attack surface
```

---

## 23. Plugin Performance Model

Plugin bisa membuat build lambat melalui beberapa cara.

### 23.1 Maven Performance Risks

- plugin berjalan di phase terlalu awal/sering;
- plugin scanning seluruh repository;
- plugin melakukan network call;
- plugin tidak mendukung incremental behavior;
- plugin generate source setiap build;
- plugin test/analysis berat selalu aktif;
- plugin tidak thread-safe saat parallel build.

### 23.2 Gradle Performance Risks

- eager task creation;
- configuration-time dependency resolution;
- membaca file saat configuration phase;
- memakai `afterEvaluate` berlebihan;
- tidak memakai Provider API;
- task input/output tidak dideklarasikan;
- task selalu out-of-date;
- tidak configuration-cache compatible;
- plugin melakukan IO/network saat apply.

Gradle plugin yang buruk sering membuat build lambat bahkan sebelum task dieksekusi, karena banyak kerja dilakukan saat configuration phase.

Prinsip Gradle:

```text
Do not do work at apply time.
Register work, declare model, wire providers.
Let execution phase do the work.
```

---

## 24. Plugin Observability

Plugin yang matang harus mudah dipahami saat gagal.

Good plugin behavior:

- log jelas;
- error message actionable;
- report file tersedia;
- path output jelas;
- parameter efektif bisa dilihat;
- mendukung verbose/debug mode;
- fail-fast untuk config invalid;
- tidak swallow exception;
- tidak menghasilkan stack trace besar tanpa konteks.

Bad plugin behavior:

```text
BUILD FAILED
Error: null
```

atau:

```text
Execution failed for task ':generateSomething'.
> Process exited with code 1
```

tanpa command, input, output, atau diagnostic.

Plugin internal enterprise harus punya diagnostic discipline.

---

## 25. Maven Plugin Debugging Workflow

Saat plugin Maven bermasalah, gunakan workflow sistematis.

### 25.1 Lihat Effective POM

```bash
mvn help:effective-pom
```

Pertanyaan:

- plugin version apa yang benar-benar dipakai?
- configuration berasal dari mana?
- execution id apa saja yang aktif?
- phase binding benar?
- profile mengubah apa?

### 25.2 Lihat Effective Settings

```bash
mvn help:effective-settings
```

Pertanyaan:

- repository mana yang dipakai?
- mirror aktif?
- credential profile benar?
- plugin group ada?

### 25.3 Jalankan Goal Langsung

```bash
mvn compiler:compile -X
mvn dependency:tree -Dverbose
```

### 25.4 Debug Lifecycle

```bash
mvn -X clean package
```

Cek:

- plugin realm/classpath;
- execution plan;
- parameter injection;
- dependency resolution;
- profile activation.

### 25.5 Isolasi Module

```bash
mvn -pl module-a -am clean package
```

Jika multi-module, jangan langsung debug seluruh reactor.

---

## 26. Gradle Plugin Debugging Workflow

### 26.1 Lihat Tasks

```bash
./gradlew tasks --all
```

Pertanyaan:

- task yang diharapkan ada?
- task masuk group benar?
- lifecycle task wired?

### 26.2 Dry Run

```bash
./gradlew build --dry-run
```

Cek task graph tanpa menjalankan task.

### 26.3 Info/Debug

```bash
./gradlew build --info
./gradlew build --debug
```

### 26.4 Dependency Insight

```bash
./gradlew dependencyInsight --dependency jackson-databind --configuration runtimeClasspath
```

### 26.5 Build Scan

```bash
./gradlew build --scan
```

Berguna untuk:

- task time;
- configuration time;
- cache miss reason;
- dependency resolution;
- environment.

### 26.6 Configuration Cache Problems

```bash
./gradlew build --configuration-cache
```

Jika plugin tidak compatible, Gradle biasanya memberi diagnostic.

---

## 27. Plugin Testing

Build logic adalah production code. Ia harus dites.

### 27.1 Maven Plugin Testing

Maven plugin bisa diuji dengan:

- unit test Mojo;
- integration test dengan sample project;
- Maven Plugin Testing Harness;
- invoker plugin;
- golden output comparison;
- failure scenario test.

Test case penting:

```text
[ ] minimal project
[ ] multi-module project
[ ] missing config
[ ] invalid config
[ ] Java 8 baseline
[ ] Java 17/21/25 runtime
[ ] offline mode
[ ] Windows path
[ ] Linux path
[ ] CI environment
```

### 27.2 Gradle Plugin Testing

Gradle plugin bisa dites dengan Gradle TestKit.

Test case penting:

```text
[ ] plugin applies successfully
[ ] task registered lazily
[ ] extension default works
[ ] custom extension value affects task
[ ] task output generated correctly
[ ] up-to-date behavior works
[ ] configuration cache works
[ ] multi-project works
[ ] build fails with clear message for invalid config
```

Plugin tanpa test akan menjadi sumber regression saat organisasi tumbuh.

---

## 28. Convention Plugin Pattern

Convention plugin adalah salah satu pattern paling penting untuk build engineering modern.

Daripada setiap module menulis:

```kotlin
plugins {
    `java-library`
    jacoco
    checkstyle
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}
```

Buat plugin:

```kotlin
plugins {
    id("company.java-library-conventions")
}
```

Isi convention plugin:

```kotlin
plugins {
    `java-library`
    jacoco
    checkstyle
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}
```

Manfaat:

- standar tersebar otomatis;
- module build file bersih;
- upgrade policy centralized;
- onboarding mudah;
- CI behavior konsisten;
- quality gate tidak bergantung pada ingatan developer.

---

## 29. Maven Equivalent: Corporate Parent POM Pattern

Maven tidak punya convention plugin dengan model yang sama seperti Gradle, tetapi punya parent POM.

Contoh:

```xml
<parent>
  <groupId>com.company.build</groupId>
  <artifactId>company-java-parent</artifactId>
  <version>1.8.0</version>
</parent>
```

Parent POM mengatur:

- pluginManagement;
- dependencyManagement;
- properties;
- default plugin executions;
- enforcer rules;
- distributionManagement;
- repository policy;
- reporting;
- release profile.

Manfaat:

- standardization kuat;
- simple untuk team;
- cocok untuk banyak service seragam;
- mudah dikontrol via version parent.

Risiko:

- inheritance terlalu dalam;
- parent menjadi terlalu besar;
- profile logic kompleks;
- sulit untuk case yang sangat berbeda;
- child module override tidak terkendali.

---

## 30. Plugin Design Heuristics

### 30.1 Buat API Kecil

Plugin extension sebaiknya expose sedikit parameter.

Buruk:

```kotlin
companyBuild {
    enableA.set(true)
    enableB.set(true)
    enableC.set(false)
    path1.set("...")
    path2.set("...")
    mode.set("custom")
    strategy.set("legacy")
}
```

Lebih baik:

```kotlin
companyService {
    type.set(ServiceType.SPRING_BOOT_API)
    javaRelease.set(21)
}
```

Convention harus menyembunyikan detail, bukan memindahkan kompleksitas.

### 30.2 Default Harus Aman

Default plugin harus:

- tidak publish tanpa perintah eksplisit;
- tidak menghapus file source;
- tidak mengirim data ke network tanpa opt-in;
- tidak membaca secret tanpa perlu;
- tidak silent skip critical validation.

### 30.3 Fail Fast

Jika config invalid, gagal di awal.

```text
Wrong: fail during publish after 12 minutes.
Right: fail during configuration/validate with clear message.
```

### 30.4 Jangan Campur Semua Concern

Pisahkan plugin:

```text
company.java-conventions
company.testing-conventions
company.quality-conventions
company.publishing-conventions
company.spring-boot-service
company.security-checks
```

Jangan buat satu plugin monster:

```text
company.everything-plugin
```

### 30.5 Stable Task Names

Task name adalah API.

Jika user/CI memakai:

```bash
./gradlew validateDependencyPolicy
```

mengubah task name adalah breaking change.

---

## 31. Plugin Failure Taxonomy

### 31.1 Configuration Failure

Contoh:

- parameter wajib kosong;
- path salah;
- invalid enum;
- incompatible plugin version.

### 31.2 Resolution Failure

Contoh:

- plugin artifact tidak ditemukan;
- plugin dependency conflict;
- repository credential salah;
- plugin portal tidak accessible.

### 31.3 Execution Failure

Contoh:

- generator gagal;
- compiler plugin gagal;
- report plugin gagal;
- external command exit non-zero.

### 31.4 Ordering Failure

Contoh:

- generated source belum ada saat compile;
- test report dibuat sebelum test;
- shading sebelum package;
- publish sebelum signing.

### 31.5 Environment Failure

Contoh:

- JDK salah;
- PATH berbeda;
- file separator Windows/Linux;
- locale/timezone beda;
- network unavailable;
- container tidak punya executable.

### 31.6 Determinism Failure

Contoh:

- timestamp berubah;
- file order berubah;
- generated UUID;
- remote latest version;
- plugin membaca current date;
- output tergantung local machine path.

### 31.7 Performance Failure

Contoh:

- plugin scan seluruh filesystem;
- task selalu out-of-date;
- plugin resolve dependency saat configuration;
- plugin tidak parallel-safe.

---

## 32. Java 8–25 Compatibility untuk Plugin

Build plugin sendiri juga punya Java compatibility.

Pertanyaan penting:

```text
JDK berapa yang menjalankan build tool?
JDK berapa yang dipakai compile source aplikasi?
JDK berapa bytecode plugin dikompilasi?
Gradle/Maven version apa yang support JDK tersebut?
```

Contoh risiko:

```text
Aplikasi target Java 8.
Developer memakai JDK 21.
Custom Maven plugin dikompilasi dengan Java 21.
CI Maven berjalan di JDK 17.
Plugin gagal load: class file version too new.
```

Build plugin internal sebaiknya punya baseline jelas.

Contoh policy:

```text
Internal Maven plugins compile with --release 8 or 11.
Internal Gradle plugins follow minimum Gradle runtime JDK policy.
Application source target can be separately controlled via toolchain.
```

Jangan samakan:

```text
Java version aplikasi = Java version plugin = Java version build runtime
```

Tiga hal itu bisa berbeda.

---

## 33. Case Study 1 — Codegen Plugin Salah Phase

### Gejala

CI gagal:

```text
cannot find symbol: class GeneratedApiClient
```

Local kadang berhasil.

### Root Cause

OpenAPI generator diikat ke phase `compile`, bukan `generate-sources`.

```xml
<phase>compile</phase>
```

Pada local, generated source lama masih ada di `target`, sehingga compile terlihat berhasil.

Pada clean CI, generated source belum tersedia saat compile dimulai.

### Fix

```xml
<phase>generate-sources</phase>
```

Pastikan generated source didaftarkan sebagai source root jika plugin tidak otomatis melakukannya.

### Lesson

Plugin correctness bukan hanya “goal benar”, tetapi **phase benar**.

---

## 34. Case Study 2 — Gradle Plugin Membuat Configuration Phase Lambat

### Gejala

`./gradlew tasks` butuh 45 detik.

Padahal tidak menjalankan compile/test.

### Root Cause

Custom plugin melakukan ini saat `apply`:

```kotlin
val files = project.fileTree(project.rootDir).matching {
    include("**/*.java")
}.files

files.forEach { validateHeader(it) }
```

Artinya scanning dan validasi file terjadi saat configuration phase.

### Fix

Pindahkan ke task:

```kotlin
abstract class ValidateHeadersTask : DefaultTask() {
    @get:InputFiles
    abstract val sourceFiles: ConfigurableFileCollection

    @TaskAction
    fun validate() {
        sourceFiles.files.forEach { validateHeader(it) }
    }
}
```

Register lazy dan wire ke `check`.

### Lesson

Plugin apply phase harus membentuk graph, bukan melakukan kerja berat.

---

## 35. Case Study 3 — Plugin Version Drift

### Gejala

Build lokal dan CI menghasilkan artifact berbeda.

### Root Cause

Maven plugin version tidak dipin. Maven versi berbeda mengambil default plugin berbeda.

### Fix

- pin semua plugin version;
- gunakan parent POM;
- gunakan Maven Wrapper;
- enforce dengan Maven Enforcer;
- review effective POM di CI.

### Lesson

Plugin adalah bagian dari build input. Jika plugin version tidak terkunci, build tidak reproducible.

---

## 36. Case Study 4 — Gradle Convention Plugin Terlalu Agresif

### Gejala

Semua module tiba-tiba menjadi Spring Boot executable JAR, termasuk library module.

### Root Cause

Convention plugin `company.java` otomatis apply `org.springframework.boot` dan disable normal JAR.

### Fix

Pisahkan plugin:

```text
company.java-library
company.spring-boot-application
```

Library module:

```kotlin
plugins {
    id("company.java-library")
}
```

Application module:

```kotlin
plugins {
    id("company.spring-boot-application")
}
```

### Lesson

Convention plugin harus merepresentasikan tipe module yang jelas.

---

## 37. Practical Maven Template — Plugin Management Parent

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.company.build</groupId>
  <artifactId>company-java-parent</artifactId>
  <version>1.0.0</version>
  <packaging>pom</packaging>

  <properties>
    <java.release>21</java.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <maven.compiler.plugin.version>3.14.1</maven.compiler.plugin.version>
    <maven.surefire.plugin.version>3.5.3</maven.surefire.plugin.version>
    <maven.failsafe.plugin.version>3.5.3</maven.failsafe.plugin.version>
  </properties>

  <build>
    <pluginManagement>
      <plugins>
        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-compiler-plugin</artifactId>
          <version>${maven.compiler.plugin.version}</version>
          <configuration>
            <release>${java.release}</release>
            <parameters>true</parameters>
            <showWarnings>true</showWarnings>
          </configuration>
        </plugin>

        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-surefire-plugin</artifactId>
          <version>${maven.surefire.plugin.version}</version>
          <configuration>
            <useModulePath>false</useModulePath>
          </configuration>
        </plugin>

        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-failsafe-plugin</artifactId>
          <version>${maven.failsafe.plugin.version}</version>
          <executions>
            <execution>
              <id>integration-tests</id>
              <goals>
                <goal>integration-test</goal>
                <goal>verify</goal>
              </goals>
            </execution>
          </executions>
        </plugin>
      </plugins>
    </pluginManagement>
  </build>
</project>
```

Catatan:

- version plugin dipin;
- default compile policy ada di parent;
- integration test binding eksplisit;
- child project tidak perlu copy-paste semua detail.

---

## 38. Practical Gradle Template — Convention Plugin

Struktur:

```text
settings.gradle.kts
build.gradle.kts
build-logic/
  build.gradle.kts
  src/main/kotlin/company.java-library-conventions.gradle.kts
```

`settings.gradle.kts`:

```kotlin
pluginManagement {
    includeBuild("build-logic")
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
```

`build-logic/build.gradle.kts`:

```kotlin
plugins {
    `kotlin-dsl`
}

repositories {
    gradlePluginPortal()
    mavenCentral()
}
```

`build-logic/src/main/kotlin/company.java-library-conventions.gradle.kts`:

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
    options.compilerArgs.addAll(listOf("-Xlint:all"))
    options.encoding = "UTF-8"
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}

tasks.named("check") {
    dependsOn(tasks.named("jacocoTestReport"))
}
```

Module:

```kotlin
plugins {
    id("company.java-library-conventions")
}
```

---

## 39. Review Checklist — Maven Plugin Usage

Gunakan checklist ini saat review POM.

```text
[ ] Semua plugin version dipin?
[ ] Plugin version dikontrol via pluginManagement?
[ ] Plugin execution punya id jelas?
[ ] Goal diikat ke phase yang benar?
[ ] Plugin configuration tidak duplicate di banyak module?
[ ] Generated source masuk target/generated-sources?
[ ] Plugin dependencies tidak tercampur dengan project dependencies?
[ ] Profile tidak mengubah plugin secara mengejutkan?
[ ] Release build tidak memakai SNAPSHOT plugin?
[ ] Plugin bisa berjalan di JDK build runtime yang dipakai CI?
[ ] Plugin tidak membutuhkan local machine path?
[ ] Plugin error message cukup jelas?
[ ] Plugin behavior terlihat di effective POM?
```

---

## 40. Review Checklist — Gradle Plugin Usage

Gunakan checklist ini saat review Gradle build.

```text
[ ] Plugin version dipin via pluginManagement/version catalog?
[ ] Build logic reusable diekstrak ke convention plugin?
[ ] Plugin tidak melakukan work berat saat apply/configuration phase?
[ ] Task diregister lazy dengan tasks.register?
[ ] Task input/output dideklarasikan?
[ ] Task cache/up-to-date friendly?
[ ] Plugin memakai Provider API?
[ ] Tidak ada afterEvaluate kecuali benar-benar perlu?
[ ] Plugin compatible dengan configuration cache?
[ ] Plugin application order aman dengan pluginManager.withPlugin?
[ ] Lifecycle task wiring masuk akal?
[ ] Plugin tidak membaca secret/env tanpa deklarasi?
[ ] Plugin tidak resolve dependency saat configuration phase?
[ ] Plugin dites dengan TestKit jika custom?
```

---

## 41. Top 1% Mental Model

Top engineer melihat plugin dari beberapa sudut sekaligus.

### 41.1 Plugin sebagai Code

Plugin bukan konfigurasi pasif. Plugin adalah kode yang berjalan saat build.

Maka:

```text
Plugin must be reviewed like code.
Plugin must be versioned like dependency.
Plugin must be secured like supply-chain component.
```

### 41.2 Plugin sebagai Build API

Task name, goal name, extension property, default behavior, dan output path adalah API.

Mengubahnya sembarangan berarti breaking change.

### 41.3 Plugin sebagai Governance Vehicle

Standard organisasi tidak cukup ditulis di wiki. Standard harus masuk build.

```text
Policy in document = suggestion
Policy in build plugin = enforceable contract
```

### 41.4 Plugin sebagai Failure Boundary

Saat build gagal, tanyakan:

```text
Apakah ini failure source code?
Apakah ini failure dependency?
Apakah ini failure plugin?
Apakah ini failure lifecycle/graph ordering?
Apakah ini failure environment?
```

Jangan langsung mengubah source code jika root cause ada di plugin execution.

### 41.5 Plugin sebagai Performance Boundary

Plugin yang salah bisa membuat semua repo lambat.

Top engineer selalu bertanya:

```text
Apa yang dilakukan saat configuration/model phase?
Apa yang dilakukan saat execution phase?
Input/output apa yang dideklarasikan?
Apakah output bisa di-cache?
Apakah task bisa di-skip?
```

---

## 42. Ringkasan

Plugin system adalah jantung extensibility Maven dan Gradle.

Maven plugin mental model:

```text
Plugin artifact -> Mojo -> goal -> execution -> lifecycle phase
```

Gradle plugin mental model:

```text
Plugin apply -> extension/configuration/task registration -> task graph -> execution
```

Hal terpenting:

1. plugin adalah kode yang memengaruhi build output;
2. plugin version harus dipin;
3. Maven plugin correctness banyak bergantung pada lifecycle binding;
4. Gradle plugin correctness banyak bergantung pada lazy configuration, Provider API, dan task input/output;
5. convention plugin/parent POM adalah alat governance enterprise;
6. custom plugin harus dites dan didesain seperti production code;
7. plugin failure harus didebug sebagai bagian dari build graph, bukan ditebak dari error terakhir;
8. plugin security dan performance adalah bagian dari build engineering maturity.

Jika dependency adalah graph risiko, maka plugin adalah **program yang membangun, mengubah, dan memvalidasi graph itu**. Karena itu, menguasai plugin system berarti menguasai cara build system bisa diperluas tanpa kehilangan determinism, governance, dan trust.

---

## 43. Latihan Praktis

### Latihan 1 — Maven Plugin Audit

Ambil satu project Maven dan jalankan:

```bash
mvn help:effective-pom > effective-pom.xml
```

Cari:

- plugin tanpa version;
- execution tanpa id jelas;
- plugin bound ke phase yang mencurigakan;
- plugin config duplicate;
- profile yang mengubah plugin behavior.

Tulis temuan dalam format:

```text
Plugin:
Current behavior:
Risk:
Recommended fix:
```

### Latihan 2 — Gradle Task Graph Audit

Jalankan:

```bash
./gradlew build --dry-run
./gradlew tasks --all
```

Cari:

- task yang tidak seharusnya ikut `build`;
- task custom tanpa group/description;
- plugin yang membuat terlalu banyak task;
- task berat yang selalu jalan.

### Latihan 3 — Extract Convention Plugin

Ambil konfigurasi Gradle yang di-copy-paste di minimal 3 module. Ekstrak menjadi precompiled convention plugin.

Target:

```kotlin
plugins {
    id("company.java-library-conventions")
}
```

Bukan:

```kotlin
// 80 lines repeated in every module
```

### Latihan 4 — Plugin Failure Diagnosis

Simulasikan codegen plugin salah phase. Dokumentasikan:

- gejala;
- command yang gagal;
- expected lifecycle order;
- actual lifecycle order;
- fix;
- preventive checklist.

---

## 44. Referensi Resmi

- Apache Maven — Plugin Descriptor dan plugin API.  
- Apache Maven — Guide to Developing Java Plugins.  
- Apache Maven — Guide to Configuring Plug-ins.  
- Apache Maven — Introduction to the Build Lifecycle.  
- Apache Maven Plugin Tools Annotations — `@Mojo`.  
- Gradle User Manual — Plugins.  
- Gradle User Manual — Gradle Plugin Development Plugin.  
- Gradle User Manual — Implementing Custom Tasks.  
- Gradle User Manual — Precompiled Script Plugins.  

---

## 45. Posisi dalam Seri

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
[ ] Part 15 — Maven Advanced Plugin Engineering
[ ] Part 16 — Gradle Advanced Plugin Engineering
[ ] Part 17 — Performance Engineering
[ ] Part 18 — CI/CD Build Architecture
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
[ ] Part 29 — Advanced Gradle: Variant-Aware Dependency Management
[ ] Part 30 — Advanced Maven: Reactor, Effective Model, Resolver, Enforcer, Extensions
[ ] Part 31 — Build Observability
[ ] Part 32 — Monorepo, Polyrepo, and Enterprise Build Topologies
[ ] Part 33 — Real-World Case Study
[ ] Part 34 — Top 1% Build Engineer Playbook
```

Seri belum selesai. Bagian berikutnya adalah **Part 15 — Maven Advanced Plugin Engineering: Custom Mojo, Parameter Injection, Lifecycle Binding**.
